/**
 * WebGL 硬件加速氛围灯渲染管线
 * 包含：多重采样模糊、HSV色彩增益、去色带噪点抖动、黑边裁剪
 */

const VERTEX_SHADER_SRC = `
  attribute vec2 aPosition;
  attribute vec2 aUV;
  varying vec2 vUV;
  void main() {
    vUV = aUV;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER_SRC = `
  precision mediump float;
  varying vec2 vUV;

  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uBlurRadius;
  uniform float uBrightness;
  uniform float uSaturation;
  uniform vec4 uCrop; // vec4(left, top, right, bottom) 归一化裁剪范围

  // 伪随机噪点：用于去色带（Debanding / Dithering）
  float rand(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
  }

  // RGB 转 HSV
  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }

  // HSV 转 RGB
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    // 映射裁剪后的 UV 坐标
    vec2 cropScale = vec2(1.0 - uCrop.x - uCrop.z, 1.0 - uCrop.y - uCrop.w);
    vec2 mappedUV = uCrop.xy + vUV * cropScale;
    mappedUV = clamp(mappedUV, 0.001, 0.999);

    // 9点圆周采样模拟快速高斯平滑
    vec2 texel = (1.0 / uResolution) * uBlurRadius;
    vec4 color = texture2D(uTexture, mappedUV) * 0.28;

    color += texture2D(uTexture, mappedUV + vec2( texel.x,  0.0)) * 0.12;
    color += texture2D(uTexture, mappedUV + vec2(-texel.x,  0.0)) * 0.12;
    color += texture2D(uTexture, mappedUV + vec2(0.0,  texel.y)) * 0.12;
    color += texture2D(uTexture, mappedUV + vec2(0.0, -texel.y)) * 0.12;

    color += texture2D(uTexture, mappedUV + vec2( texel.x,  texel.y) * 0.707) * 0.06;
    color += texture2D(uTexture, mappedUV + vec2(-texel.x,  texel.y) * 0.707) * 0.06;
    color += texture2D(uTexture, mappedUV + vec2( texel.x, -texel.y) * 0.707) * 0.06;
    color += texture2D(uTexture, mappedUV + vec2(-texel.x, -texel.y) * 0.707) * 0.06;

    // 颜色调整：明度与饱和度
    vec3 rgb = color.rgb * uBrightness;
    vec3 hsv = rgb2hsv(rgb);
    hsv.y = clamp(hsv.y * uSaturation, 0.0, 1.0);
    rgb = hsv2rgb(hsv);

    // 去色带微噪点抖动（Dithering）：消除低亮度下的色阶断层
    float noise = (rand(vUV) - 0.5) / 255.0 * 2.0;
    rgb += noise;

    gl_FragColor = vec4(rgb, 1.0);
  }
`;

export class AmbientWebGLRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });

    if (!this.gl) {
      throw new Error('WebGL not supported');
    }

    this.program = null;
    this.texture = null;
    this.vertexBuffer = null;
    this.uvBuffer = null;
    this.uniforms = {};

    this.initGL();
  }

  createShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compile error: ${info}`);
    }
    return shader;
  }

  initGL() {
    const gl = this.gl;

    const vs = this.createShader(gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
    const fs = this.createShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);

    this.program = gl.createProgram();
    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.linkProgram(this.program);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error(`Program link error: ${gl.getProgramInfoLog(this.program)}`);
    }

    gl.useProgram(this.program);

    // 顶点坐标（四边形覆盖整块画布）
    const positions = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ]);
    this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const aPosition = gl.getAttribLocation(this.program, 'aPosition');
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    // 纹理 UV 坐标
    const uvs = new Float32Array([
      0, 1,
      1, 1,
      0, 0,
      0, 0,
      1, 1,
      1, 0,
    ]);
    this.uvBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);

    const aUV = gl.getAttribLocation(this.program, 'aUV');
    gl.enableVertexAttribArray(aUV);
    gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 0, 0);

    // 创建纹理
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // 统一变量位置缓存
    this.uniforms = {
      uTexture: gl.getUniformLocation(this.program, 'uTexture'),
      uResolution: gl.getUniformLocation(this.program, 'uResolution'),
      uBlurRadius: gl.getUniformLocation(this.program, 'uBlurRadius'),
      uBrightness: gl.getUniformLocation(this.program, 'uBrightness'),
      uSaturation: gl.getUniformLocation(this.program, 'uSaturation'),
      uCrop: gl.getUniformLocation(this.program, 'uCrop'),
    };
  }

  resize(width, height) {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.gl.viewport(0, 0, width, height);
    }
  }

  draw(video, settings = {}, crop = [0, 0, 0, 0]) {
    const gl = this.gl;
    if (!gl || !video || video.readyState < 2) return;

    gl.useProgram(this.program);

    // 上传当前视频帧为纹理
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

    gl.uniform1i(this.uniforms.uTexture, 0);
    gl.uniform2f(this.uniforms.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniforms.uBlurRadius, settings.blurRadius ?? 12.0);
    gl.uniform1f(this.uniforms.uBrightness, settings.brightness ?? 1.15);
    gl.uniform1f(this.uniforms.uSaturation, settings.saturation ?? 1.35);
    gl.uniform4f(this.uniforms.uCrop, crop[0], crop[1], crop[2], crop[3]);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  destroy() {
    const gl = this.gl;
    if (!gl) return;
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
    if (this.uvBuffer) gl.deleteBuffer(this.uvBuffer);
    if (this.program) gl.deleteProgram(this.program);
  }
}
