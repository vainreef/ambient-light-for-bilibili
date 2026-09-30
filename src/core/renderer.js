/**
 * WebGL projector: YouTube Ambilight halo architecture.
 * Features:
 * - Multi-scale edge projection (multiTexture)
 * - Temporal inertia smoothing (Exponential Moving Average)
 * - Aspect-ratio corrected full-bleed transform
 * - Hardware Skia GPU Gaussian blur diffusion
 */
(function (global) {
  'use strict';
  const api = global.BiliAmbient = global.BiliAmbient || {};
  const INNER_RATIO = 0.88;
  const SCALE_STEP = 1 / INNER_RATIO;

  const VERTEX = `
    attribute vec2 aPosition;
    varying vec2 vUV;
    void main() {
      vUV = vec2((aPosition.x + 1.0) * 0.5, (1.0 - aPosition.y) * 0.5);
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const FRAGMENT = `
    precision highp float;
    varying vec2 vUV;
    uniform sampler2D uFrame;
    uniform sampler2D uPrevHalo;
    uniform float uAlpha;
    uniform vec4 uCrop;
    uniform vec2 uScale;
    uniform vec2 uScaleStep;
    uniform float uVibrance;
    uniform float uFadeCurve;

    vec4 sampleHalo(vec2 uv) {
      vec2 clamped = clamp(uv, 0.001, 0.999);
      vec2 cropped = uCrop.xy + clamped * (vec2(1.0) - uCrop.xy - uCrop.zw);
      return texture2D(uFrame, cropped);
    }

    vec3 rgb2hsv(vec3 c) {
      vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
      vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
      vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
      float d = q.x - min(q.w, q.y);
      float e = 1.0e-10;
      return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }

    vec3 hsv2rgb(vec3 c) {
      vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
      vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
      return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }

    float satCurve(float c, float v) {
      float x = c;
      if (v < 0.0) x = 1.0 - c;
      float a = 1.0 + 5.0 * (1.0 - abs(v));
      float y = a * a - x * ((a * a - 1.0) / (a * a)) - (a - x / a) * (a - x / a);
      float d = y - x;
      y = min(1.0, x + d * 5.0);
      return v >= 0.0 ? y : 1.0 - y;
    }

    void main() {
      // 24-level concentric recursive halo projection outward from video boundary
      vec2 edgeDist = 1.0 - 2.0 * abs(vUV - 0.5);
      vec2 iUV = (edgeDist * uScale) / max(vec2(0.0001), uScaleStep);
      float minI = min(iUV.x, iUV.y);
      int targetI = int(clamp(minI, 0.0, 23.0));
      vec4 rawCol = vec4(0.0);
      for (int preciseI = 0; preciseI <= 23; preciseI++) {
        if (preciseI < targetI) continue;
        float level = float(preciseI);
        vec2 denom = max(vec2(1.0), uScale - uScaleStep * level);
        vec2 scaledUV = (vUV - 0.5) * (uScale / denom);
        vec2 sampleUV = 0.5 + scaledUV;
        rawCol = sampleHalo(sampleUV);
        break;
      }

      // Symmetric 4-direction radial falloff around the video player
      vec2 videoBound = vec2(0.5 / uScale.x, 0.5 / uScale.y);
      vec2 distFromVideo = max(vec2(0.0), abs(vUV - 0.5) - videoBound);
      vec2 maxDist = max(vec2(0.001), vec2(0.5) - videoBound);
      vec2 normDist = distFromVideo / maxDist;
      float t = clamp(max(normDist.x, normDist.y), 0.0, 1.0);
      float smoothFade = 1.0 - (t * t * t * (t * (t * 6.0 - 15.0) + 10.0));
      float lightAlpha = pow(smoothFade, uFadeCurve);

      // Enhance vibrance and limit oversaturation
      vec3 hsv = rgb2hsv(rawCol.rgb);
      hsv.y = satCurve(hsv.y, uVibrance);
      hsv.z = min(hsv.z, 0.88 + 0.12 * hsv.y);
      vec3 rgb = hsv2rgb(hsv);
      vec4 targetOutput = vec4(rgb * lightAlpha, lightAlpha);

      // Inertia EMA blending (inverted Y for OpenGL subimage compatibility)
      vec4 prevOutput = texture2D(uPrevHalo, vec2(vUV.x, 1.0 - vUV.y));
      gl_FragColor = mix(prevOutput, targetOutput, clamp(uAlpha, 0.0, 1.0));
    }
  `;

  // ---------------------------------------------------------------------------
  // WebGL Pipeline Utilities
  // ---------------------------------------------------------------------------

  function createProgram(gl, vsSource, fsSource) {
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const error = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(error);
      }
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, vsSource);
    const fs = compile(gl.FRAGMENT_SHADER, fsSource);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, 'aPosition');
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program));
    }
    return program;
  }

  function createLinearTexture(gl) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    return tex;
  }

  // ---------------------------------------------------------------------------
  // Renderer Implementation
  // ---------------------------------------------------------------------------

  class AmbientWebGLRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx2d = canvas.getContext('2d', { alpha: true });
      if (!this.ctx2d) throw new Error('2D context is not available on display canvas');

      this.glCanvas = document.createElement('canvas');
      const attrs = { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true };
      this.gl = this.glCanvas.getContext('webgl2', attrs) || this.glCanvas.getContext('webgl', attrs);
      if (!this.gl) throw new Error('WebGL is not available');

      const gl = this.gl;
      this.program = createProgram(gl, VERTEX, FRAGMENT);

      const uniformNames = ['uFrame', 'uPrevHalo', 'uAlpha', 'uCrop', 'uScale', 'uScaleStep', 'uVibrance', 'uFadeCurve'];
      this.uniforms = {};
      for (const name of uniformNames) this.uniforms[name] = gl.getUniformLocation(this.program, name);

      this.buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      this.videoTexture = createLinearTexture(gl);
      this.prevHaloTexture = createLinearTexture(gl);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));

      this.firstFrame = true;
      this.lastFrameTime = 0;
      this.width = canvas.width || 1;
      this.height = canvas.height || 1;
      this.frames = 0;
      this.lastUploadError = false;
    }

    resize(width, height) {
      this.width = Math.max(1, Math.round(width));
      this.height = Math.max(1, Math.round(height));
    }

    calculateScale(videoWidth, videoHeight, geometry, settings) {
      const band = settings?.band ?? 0.06;

      // Symmetric physical expansion around the video player in all 4 directions
      // At band = 0.01 (1%): tight hairline edge ("只有一细边")
      // At band = 0.50 (50%): extends outward by exactly half-frame dimensions ("整个画幅的一半，上下左右一半一半")
      let spreadX = videoWidth * band;
      let spreadY = videoHeight * band;
      if (geometry?.fullscreen) {
        const vpW = window.innerWidth || videoWidth;
        const vpH = window.innerHeight || videoHeight;
        spreadX = Math.max(spreadX, (vpW - videoWidth) / 2);
        spreadY = Math.max(spreadY, (vpH - videoHeight) / 2);
      }

      const totalScaleX = Math.max(1.01, 1.0 + (2.0 * spreadX) / videoWidth);
      const totalScaleY = Math.max(1.01, 1.0 + (2.0 * spreadY) / videoHeight);

      const levels = 24;
      const scaleStepX = (totalScaleX - 1.0) / (levels - 1);
      const scaleStepY = (totalScaleY - 1.0) / (levels - 1);

      return { totalScaleX, totalScaleY, scaleStepX, scaleStepY, band };
    }

    computeInertiaAlpha(settings, now) {
      if (this.firstFrame || this.lastFrameTime <= 0) {
        this.firstFrame = false;
        this.lastFrameTime = now;
        return 1.0;
      }
      const dt = Math.max(1, Math.min(100, now - this.lastFrameTime));
      this.lastFrameTime = now;
      const inertiaVal = settings?.inertia ?? 140.0;
      if (inertiaVal <= 0) return 1.0;
      const alpha = 1.0 - Math.exp(-dt / Math.max(10, inertiaVal));
      return Math.max(0.04, Math.min(1.0, alpha));
    }

    prepareBuffers(glW, glH, totalScaleX, totalScaleY) {
      if (this.glCanvas.width !== glW || this.glCanvas.height !== glH) {
        this.glCanvas.width = glW;
        this.glCanvas.height = glH;
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.prevHaloTexture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, glW, glH, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);
        this.firstFrame = true;
      }
      if (this.canvas.width !== glW || this.canvas.height !== glH) {
        this.canvas.width = glW;
        this.canvas.height = glH;
      }
      const transformStr = `scale(${totalScaleX.toFixed(4)}, ${totalScaleY.toFixed(4)})`;
      if (this.canvas.style.transform !== transformStr) {
        this.canvas.style.transform = transformStr;
      }
    }

    renderHaloPass(video, glW, glH, crop, scales, alpha, settings) {
      const gl = this.gl;
      gl.viewport(0, 0, glW, glH);
      gl.useProgram(this.program);

      // Direct full native resolution video texture upload
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      gl.uniform1i(this.uniforms.uFrame, 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.prevHaloTexture);
      gl.uniform1i(this.uniforms.uPrevHalo, 1);

      gl.uniform1f(this.uniforms.uAlpha, alpha);
      gl.uniform4fv(this.uniforms.uCrop, crop);
      gl.uniform2f(this.uniforms.uScale, scales.totalScaleX, scales.totalScaleY);
      gl.uniform2f(this.uniforms.uScaleStep, scales.scaleStepX, scales.scaleStepY);
      gl.uniform1f(this.uniforms.uVibrance, 0.28);
      gl.uniform1f(this.uniforms.uFadeCurve, 0.72);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // Store in VRAM for next frame's temporal inertia
      gl.bindTexture(gl.TEXTURE_2D, this.prevHaloTexture);
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, glW, glH);
    }

    renderDisplayBlur(glW, glH, blurVal = 1.0) {
      const baseScale = Math.max(1, glW / 960);
      const blurPx = Math.max(0, Math.round(blurVal * 3.5 * baseScale));
      this.ctx2d.clearRect(0, 0, glW, glH);
      this.ctx2d.filter = blurPx > 0 ? `blur(${blurPx}px)` : 'none';
      this.ctx2d.drawImage(this.glCanvas, 0, 0, glW, glH);
      return blurPx;
    }

    draw(video, settings, crop, geometry) {
      if (!video || video.readyState < 2 || !geometry) return;
      const displayWidth = geometry.videoWidth || this.width || 800;
      const displayHeight = geometry.videoHeight || this.height || 450;

      const scales = this.calculateScale(displayWidth, displayHeight, geometry, settings);
      const res = settings?.resolution ?? 1.0;
      const glW = Math.max(320, Math.min(3840, Math.round(displayWidth * scales.totalScaleX * res)));
      const glH = Math.max(180, Math.min(2160, Math.round(displayHeight * scales.totalScaleY * res)));
      this.prepareBuffers(glW, glH, scales.totalScaleX, scales.totalScaleY);

      try {
        const alpha = this.computeInertiaAlpha(settings, performance.now());
        this.renderHaloPass(video, glW, glH, crop, scales, alpha, settings);
        const blurPx = this.renderDisplayBlur(glW, glH, settings?.blur);

        this.frames += 1;
        this.canvas.dataset.blur = blurPx.toFixed(1);
        this.canvas.dataset.frames = String(this.frames);
        this.canvas.dataset.res = `${glW}x${glH}`;
        this.lastUploadError = false;
      } catch (error) {
        if (!this.lastUploadError) console.warn('[AmbientLight] Frame upload failed.', error);
        this.lastUploadError = true;
      }
    }

    destroy() {
      if (this.videoTexture) this.gl.deleteTexture(this.videoTexture);
      if (this.prevHaloTexture) this.gl.deleteTexture(this.prevHaloTexture);
      this.gl.deleteBuffer(this.buffer);
      this.gl.deleteProgram(this.program);
      this.ctx2d.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  // CPU mathematical reference for regression tests
  api.projectAnnulus = (qx, qy) => {
    const radius = Math.max(Math.abs(qx), Math.abs(qy));
    if (radius <= 1) return null;
    const index = Math.floor(Math.log(radius) / Math.log(SCALE_STEP));
    const scale = Math.pow(SCALE_STEP, index + 1);
    return { index, scale, u: 0.5 + 0.5 * qx / scale, v: 0.5 + 0.5 * qy / scale };
  };

  api.AmbientWebGLRenderer = AmbientWebGLRenderer;
})(globalThis);
