/**
 * Ambient Light for Bilibili - Content Script
 * 纯原生、无依赖、开箱即用
 */

(function () {
  'use strict';

  // 1. WebGL 着色器源码
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
    uniform vec4 uCrop;

    float rand(vec2 co) {
      return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
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

    void main() {
      vec2 cropScale = vec2(1.0 - uCrop.x - uCrop.z, 1.0 - uCrop.y - uCrop.w);
      vec2 mappedUV = uCrop.xy + vUV * cropScale;
      mappedUV = clamp(mappedUV, 0.001, 0.999);

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

      vec3 rgb = color.rgb * uBrightness;
      vec3 hsv = rgb2hsv(rgb);
      hsv.y = clamp(hsv.y * uSaturation, 0.0, 1.0);
      rgb = hsv2rgb(hsv);

      float noise = (rand(vUV) - 0.5) / 255.0 * 2.0;
      rgb += noise;

      gl_FragColor = vec4(rgb, 1.0);
    }
  `;

  // 2. WebGL 渲染器
  class AmbientWebGLRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = canvas.getContext('webgl', {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
      });

      if (!this.gl) throw new Error('WebGL not supported');

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

      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

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

    draw(video, settings, crop) {
      const gl = this.gl;
      if (!gl || !video || video.readyState < 2) return;

      gl.useProgram(this.program);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

      gl.uniform1i(this.uniforms.uTexture, 0);
      gl.uniform2f(this.uniforms.uResolution, this.canvas.width, this.canvas.height);
      gl.uniform1f(this.uniforms.uBlurRadius, settings.blurRadius);
      gl.uniform1f(this.uniforms.uBrightness, settings.brightness);
      gl.uniform1f(this.uniforms.uSaturation, settings.saturation);
      gl.uniform4f(this.uniforms.uCrop, crop[0], crop[1], crop[2], crop[3]);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  // 3. 黑边检测器
  class BarDetector {
    constructor() {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 64;
      this.canvas.height = 36;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      this.lastCheck = 0;
      this.interval = 1200;
      this.crop = [0, 0, 0, 0];
    }

    detect(video) {
      const now = performance.now();
      if (now - this.lastCheck < this.interval || !video || video.readyState < 2) {
        return this.crop;
      }
      this.lastCheck = now;

      const w = this.canvas.width;
      const h = this.canvas.height;
      this.ctx.drawImage(video, 0, 0, w, h);

      const data = this.ctx.getImageData(0, 0, w, h).data;
      const threshold = 18;
      const isDark = (idx) => (data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114) < threshold;

      let topBars = 0;
      for (let y = 0; y < h / 3; y++) {
        let allDark = true;
        for (let x = 0; x < w; x += 4) {
          if (!isDark((y * w + x) * 4)) {
            allDark = false;
            break;
          }
        }
        if (allDark) topBars++;
        else break;
      }

      let bottomBars = 0;
      for (let y = h - 1; y > (h * 2) / 3; y--) {
        let allDark = true;
        for (let x = 0; x < w; x += 4) {
          if (!isDark((y * w + x) * 4)) {
            allDark = false;
            break;
          }
        }
        if (allDark) bottomBars++;
        else break;
      }

      const normTop = Math.min(0.35, topBars / h);
      const normBottom = Math.min(0.35, bottomBars / h);

      this.crop[1] = this.crop[1] * 0.7 + normTop * 0.3;
      this.crop[3] = this.crop[3] * 0.7 + normBottom * 0.3;
      return this.crop;
    }
  }

  // 4. 设置与状态管理
  const STORAGE_KEY = 'bili_ambient_light_settings';
  const defaultSettings = {
    enabled: true,
    spread: 1.25,
    blurRadius: 18.0,
    brightness: 1.15,
    saturation: 1.4,
  };

  const loadSettings = () => {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      return s ? { ...defaultSettings, ...JSON.parse(s) } : { ...defaultSettings };
    } catch {
      return { ...defaultSettings };
    }
  };

  const saveSettings = (s) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {}
  };

  // 5. 主程序启动
  async function init() {
    console.log('[AmbientLight] 正在初始化 Bilibili 流光氛围灯...');

    // 等待播放器与视频节点加载
    let container = null;
    let video = null;
    let videoArea = null;

    for (let i = 0; i < 60; i++) {
      container = document.querySelector('.bpx-player-container') || document.querySelector('#bilibili-player');
      video = document.querySelector('video');
      videoArea = document.querySelector('.bpx-player-video-area');
      if (container && video && videoArea) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    if (!container || !video || !videoArea) {
      console.warn('[AmbientLight] 未找到 B 站播放器，取消挂载');
      return;
    }

    const settings = loadSettings();

    // 挂载包裹层
    const existing = document.querySelector('.bili-ambient-wrapper');
    if (existing) existing.remove();

    const wrapper = document.createElement('div');
    wrapper.className = 'bili-ambient-wrapper';

    const canvas = document.createElement('canvas');
    canvas.className = 'bili-ambient-canvas';
    canvas.style.transform = `scale(${settings.spread})`;
    wrapper.appendChild(canvas);

    container.prepend(wrapper);

    let renderer;
    try {
      renderer = new AmbientWebGLRenderer(canvas);
    } catch (err) {
      console.error('[AmbientLight] WebGL 初始化失败:', err);
      return;
    }

    const detector = new BarDetector();

    // 尺寸监听与同步
    const syncSize = () => {
      const rect = videoArea.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (w === 0 || h === 0) return;

      const rw = Math.min(320, Math.round(w / 3));
      const rh = Math.min(180, Math.round(h / 3));
      renderer.resize(rw, rh);
    };

    const resizeObserver = new ResizeObserver(syncSize);
    resizeObserver.observe(videoArea);
    syncSize();

    // 帧渲染循环
    let isRunning = true;
    function renderFrame() {
      if (!isRunning) return;

      // 跟踪可能的换 P 视频重载
      const currentVideo = document.querySelector('video');
      if (currentVideo && currentVideo !== video) {
        video = currentVideo;
      }

      if (settings.enabled && video && video.readyState >= 2 && !video.paused) {
        wrapper.classList.remove('is-hidden');
        const crop = detector.detect(video);
        renderer.draw(video, settings, crop);
      } else if (!settings.enabled || (video && video.paused)) {
        // 暂停时保持最后一帧或渐隐
      }

      if ('requestVideoFrameCallback' in video) {
        video.requestVideoFrameCallback(renderFrame);
      } else {
        requestAnimationFrame(renderFrame);
      }
    }

    if ('requestVideoFrameCallback' in video) {
      video.requestVideoFrameCallback(renderFrame);
    } else {
      requestAnimationFrame(renderFrame);
    }

    // 快捷键面板：Alt + A
    window.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'a' || e.key === 'A')) {
        let panel = document.querySelector('.bili-ambient-panel');
        if (!panel) {
          panel = document.createElement('div');
          panel.className = 'bili-ambient-panel';
          panel.innerHTML = `
            <div class="bili-ambient-panel-header">
              <span>流光氛围灯设置</span>
              <button class="bili-ambient-toggle-btn" id="bili-amb-toggle">
                ${settings.enabled ? '已开启' : '已关闭'}
              </button>
            </div>
            <div class="bili-ambient-row">
              <label>扩散范围</label>
              <input type="range" id="bili-amb-spread" min="1.0" max="1.6" step="0.05" value="${settings.spread}">
            </div>
            <div class="bili-ambient-row">
              <label>模糊半径</label>
              <input type="range" id="bili-amb-blur" min="4" max="40" step="2" value="${settings.blurRadius}">
            </div>
            <div class="bili-ambient-row">
              <label>发光亮度</label>
              <input type="range" id="bili-amb-bright" min="0.5" max="2.0" step="0.05" value="${settings.brightness}">
            </div>
            <div class="bili-ambient-row">
              <label>色彩饱和度</label>
              <input type="range" id="bili-amb-sat" min="0.5" max="2.5" step="0.1" value="${settings.saturation}">
            </div>
          `;
          document.body.appendChild(panel);

          const toggleBtn = panel.querySelector('#bili-amb-toggle');
          toggleBtn.addEventListener('click', () => {
            settings.enabled = !settings.enabled;
            toggleBtn.textContent = settings.enabled ? '已开启' : '已关闭';
            toggleBtn.style.background = settings.enabled ? '#00aeec' : '#555';
            wrapper.classList.toggle('is-hidden', !settings.enabled);
            saveSettings(settings);
          });

          const bindInput = (id, key, cb) => {
            panel.querySelector(`#${id}`).addEventListener('input', (e) => {
              settings[key] = parseFloat(e.target.value);
              if (cb) cb(settings[key]);
              saveSettings(settings);
            });
          };

          bindInput('bili-amb-spread', 'spread', (v) => {
            canvas.style.transform = `scale(${v})`;
          });
          bindInput('bili-amb-blur', 'blurRadius');
          bindInput('bili-amb-bright', 'brightness');
          bindInput('bili-amb-sat', 'saturation');
        } else {
          panel.classList.toggle('is-collapsed');
        }
      }
    });

    console.log('[AmbientLight] Bilibili 流光氛围灯启动就绪 (快捷键 Alt+A 调出设置)');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
