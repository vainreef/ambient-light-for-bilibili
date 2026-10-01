/** Standard dual-mode projector: 96 parallel strips, opaque overscan, one blur. */
(function (global) {
  'use strict';
  const api = global.BiliAmbient = global.BiliAmbient || {};
  const BLUR_PADDING = 320;
  const WHITE_FADE_LENGTH = 600;
  const MAX_BUFFER_PIXELS = 24 * 1024 * 1024;
  const clamp = (n, lo, hi, fallback) => Number.isFinite(Number(n)) ? Math.max(lo, Math.min(hi, Number(n))) : fallback;

  function getDisplayFade(playerBottom, distance, videoDocTop, videoHeight) {
    const dist = clamp(distance, 0, 500, 200);
    const vTop = Number.isFinite(Number(videoDocTop)) ? Number(videoDocTop) : (playerBottom - (videoHeight || 450));
    const vHeight = Number.isFinite(Number(videoHeight)) && videoHeight > 0 ? Number(videoHeight) : (playerBottom - vTop || 450);
    const videoCenter = vTop + vHeight * 0.5;
    const start = videoCenter + dist;
    return { start, end: start + WHITE_FADE_LENGTH, length: WHITE_FADE_LENGTH };
  }

  function fadeAlpha(t) {
    t = Math.max(0, Math.min(1, t));
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function getRings(rect, band, layers) {
    const step = 1 + 2 * band;
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const rings = [];
    for (let k = layers; k >= 1; k--) {
      const innerS = step ** (k - 1), outerS = step ** k;
      rings.push({ k, innerS, outerS, mirrored: k % 2 === 1,
        inL: cx - rect.width * innerS / 2, inR: cx + rect.width * innerS / 2,
        inT: cy - rect.height * innerS / 2, inB: cy + rect.height * innerS / 2,
        outL: cx - rect.width * outerS / 2, outR: cx + rect.width * outerS / 2,
        outT: cy - rect.height * outerS / 2, outB: cy + rect.height * outerS / 2 });
    }
    return rings;
  }
  var STRIP_COUNT = 96;

  function drawTopTrapezoid(ctx, texture, inL, inR, inY, outL, outR, outY) {
    var n = STRIP_COUNT;
    for (var i = 0; i < n; i++) {
      var v0 = i / n;
      var v1 = (i + 1) / n;
      var vm = (v0 + v1) * 0.5;

      var y0 = outY + (inY - outY) * v0;
      var y1 = outY + (inY - outY) * v1;
      var left = outL + (inL - outL) * vm;
      var right = outR + (inR - outR) * vm;

      var sy = texture.height * v0;
      var sh = texture.height / n + 1;

      ctx.drawImage(texture, 0, sy, texture.width, sh, left, y0, right - left, y1 - y0 + 0.6);
    }
  }

  function drawBottomTrapezoid(ctx, texture, inL, inR, inY, outL, outR, outY) {
    var n = STRIP_COUNT;
    for (var i = 0; i < n; i++) {
      var v0 = i / n;
      var v1 = (i + 1) / n;
      var vm = (v0 + v1) * 0.5;

      var y0 = inY + (outY - inY) * v0;
      var y1 = inY + (outY - inY) * v1;
      var left = inL + (outL - inL) * vm;
      var right = inR + (outR - inR) * vm;

      var sy = texture.height * v0;
      var sh = texture.height / n + 1;

      ctx.drawImage(texture, 0, sy, texture.width, sh, left, y0, right - left, y1 - y0 + 0.6);
    }
  }

  function drawLeftTrapezoid(ctx, texture, inT, inB, inX, outT, outB, outX) {
    var n = STRIP_COUNT;
    for (var i = 0; i < n; i++) {
      var v0 = i / n;
      var v1 = (i + 1) / n;
      var vm = (v0 + v1) * 0.5;

      var x0 = outX + (inX - outX) * v0;
      var x1 = outX + (inX - outX) * v1;
      var top = outT + (inT - outT) * vm;
      var bottom = outB + (inB - outB) * vm;

      var sx = texture.width * v0;
      var sw = texture.width / n + 1;

      ctx.drawImage(texture, sx, 0, sw, texture.height, x0, top, x1 - x0 + 0.6, bottom - top);
    }
  }

  function drawRightTrapezoid(ctx, texture, inT, inB, inX, outT, outB, outX) {
    var n = STRIP_COUNT;
    for (var i = 0; i < n; i++) {
      var v0 = i / n;
      var v1 = (i + 1) / n;
      var vm = (v0 + v1) * 0.5;

      var x0 = inX + (outX - inX) * v0;
      var x1 = inX + (outX - inX) * v1;
      var top = inT + (outT - inT) * vm;
      var bottom = inB + (outB - inB) * vm;

      var sx = texture.width * v0;
      var sw = texture.width / n + 1;

      ctx.drawImage(texture, sx, 0, sw, texture.height, x0, top, x1 - x0 + 0.6, bottom - top);
    }
  }


  class AmbientRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: true });
      this.buffer = document.createElement('canvas');
      this.bctx = this.buffer.getContext('2d', { alpha: false });
      this.frameBuffer = document.createElement('canvas');
      this.fctx = this.frameBuffer.getContext('2d', { alpha: false });
      if (!this.ctx || !this.bctx || !this.fctx) throw new Error('Canvas 2D context is unavailable');
      this.edges = null;
      this.edgeKey = '';
      this.geometryKey = '';
      this.frameKey = '';
      this.source = null;
      this.frames = 0;
      this.geometryBuilds = 0;
      this.bufferBuilds = 0;
      this.firstFrame = true;
      this.lastFrameTime = 0;
      this.width = 1;
      this.height = 1;
    }

    resize(width, height) {
      this.width = Math.max(1, Math.round(width));
      this.height = Math.max(1, Math.round(height));
    }

    invalidate() {
      this.frameKey = '';
      this.source = null;
      this.firstFrame = true;
      this.lastFrameTime = 0;
    }

    computeInertiaAlpha(inertiaMs, now) {
      if (this.firstFrame || this.lastFrameTime <= 0) {
        this.firstFrame = false;
        this.lastFrameTime = now;
        return 1.0;
      }
      const dt = Math.max(1, Math.min(100, now - this.lastFrameTime));
      this.lastFrameTime = now;
      if (!inertiaMs || inertiaMs <= 0) return 1.0;
      const alpha = 1.0 - Math.exp(-dt / Math.max(10, inertiaMs));
      return Math.max(0.02, Math.min(1.0, alpha));
    }

    prepareEdges(video, crop, band, resolution, rect) {
      const sw = video.videoWidth, sh = video.videoHeight;
      const [left, top, right, bottom] = crop;
      const sx = left * sw, sy = top * sh;
      const cw = Math.max(1, sw * (1 - left - right)), ch = Math.max(1, sh * (1 - top - bottom));
      const tw = Math.max(1, Math.round(Math.min(cw, rect.width * resolution)));
      const th = Math.max(1, Math.round(tw * ch / cw));
      const bw = Math.max(1, Math.round(tw * band)), bh = Math.max(1, Math.round(th * band));
      const key = [tw, th, bw, bh].join(',');
      if (key !== this.edgeKey) {
        this.edges = {};
        for (const side of ['top', 'bottom', 'left', 'right']) {
          for (const version of ['Normal', 'Mirror']) {
            const c = document.createElement('canvas');
            c.width = side === 'top' || side === 'bottom' ? tw : bw;
            c.height = side === 'top' || side === 'bottom' ? bh : th;
            this.edges[side + version] = c;
          }
        }
        this.edgeKey = key;
      }
      const slices = {
        top: [sx, sy, cw, ch * band], bottom: [sx, sy + ch * (1 - band), cw, ch * band],
        left: [sx, sy, cw * band, ch], right: [sx + cw * (1 - band), sy, cw * band, ch],
      };
      for (const side of Object.keys(slices)) {
        const normal = this.edges[side + 'Normal'], mirror = this.edges[side + 'Mirror'];
        const nctx = normal.getContext('2d'), mctx = mirror.getContext('2d');
        nctx.drawImage(video, ...slices[side], 0, 0, normal.width, normal.height);
        mctx.save();
        if (side === 'top' || side === 'bottom') {
          mctx.translate(0, mirror.height); mctx.scale(1, -1);
        } else {
          mctx.translate(mirror.width, 0); mctx.scale(-1, 1);
        }
        mctx.drawImage(normal, 0, 0); mctx.restore();
      }
      return this.edges;
    }

    draw(video, settings, crop = [0, 0, 0, 0], geometry) {
      if (!video || video.readyState < 2 || !video.videoWidth || !geometry) return;
      const mode = settings.mode === 'mirror' ? 'mirror' : 'forward';
      const band = clamp(settings.band, 0.05, 1.0, 1.0);
      const layers = Math.round(clamp(settings.layers, 1, 12, 12));
      const blur = clamp(settings.blur, 0, 80, 18);
      const requestedResolution = clamp(settings.resolution, 0.5, 2, 1);
      const dimming = clamp(settings.dimming ?? settings.brightness, 0, 100, 0);
      const bFactor = (100 - dimming) / 100;
      const sourceCrop = geometry.sourceCrop || [0, 0, 0, 0];
      crop = crop.map((value, i) => Math.max(value, sourceCrop[i]));
      const visibleW = Math.max(0.001, 1 - sourceCrop[0] - sourceCrop[2]);
      const visibleH = Math.max(0.001, 1 - sourceCrop[1] - sourceCrop[3]);
      // Crop and destination refer to the same visible source area; never stretch
      // cropped content across the letterboxed player's original height.
      const rect = { left: geometry.videoDocLeft + geometry.videoWidth * (crop[0] - sourceCrop[0]) / visibleW,
        top: geometry.videoDocTop + geometry.videoHeight * (crop[1] - sourceCrop[1]) / visibleH,
        width: geometry.videoWidth * (1 - crop[0] - crop[2]) / visibleW,
        height: geometry.videoHeight * (1 - crop[1] - crop[3]) / visibleH };
      const width = Math.max(1, Math.round(geometry.canvasWidth || this.width));
      const fade = getDisplayFade(geometry.playerBottom ?? geometry.videoDocTop + geometry.videoHeight,
        settings.displayDistance, geometry.videoDocTop, geometry.videoHeight);
      // A 12-layer geometric scale must not allocate an exponentially tall canvas.
      const height = Math.max(1, Math.min(Math.round(geometry.canvasHeight || this.height),
        geometry.fullscreen ? geometry.viewportHeight || geometry.canvasHeight : Math.ceil(fade.end + 1)));
      const resolution = Math.min(requestedResolution,
        16384 / (width + 2 * BLUR_PADDING), 16384 / (height + 2 * BLUR_PADDING),
        Math.sqrt(MAX_BUFFER_PIXELS / ((width + 2 * BLUR_PADDING) * (height + 2 * BLUR_PADDING))));
      const key = JSON.stringify([mode, band, layers, resolution, rect, width, height, crop]);
      const changed = key !== this.geometryKey;
      if (changed) {
        this.rings = getRings(rect, band, layers);
        this.geometryKey = key;
        this.geometryBuilds++;
      }
      const w = Math.max(1, Math.round(width * resolution)), h = Math.max(1, Math.round(height * resolution));
      const bw = Math.round((width + 2 * BLUR_PADDING) * resolution);
      const bh = Math.round((height + 2 * BLUR_PADDING) * resolution);
      const resize = this.buffer.width !== bw || this.buffer.height !== bh;
      if (resize) {
        this.buffer.width = bw; this.buffer.height = bh;
        this.frameBuffer.width = bw; this.frameBuffer.height = bh;
        this.firstFrame = true;
      }
      if (changed) this.firstFrame = true;
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
      const frameKey = `${video.currentTime}:${video.getVideoPlaybackQuality?.().totalVideoFrames ?? ''}`;
      const newFrame = video !== this.source || frameKey !== this.frameKey;
      try {
        if (changed || resize || newFrame) {
          const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
          const alpha = this.computeInertiaAlpha(settings.inertia, now);
          const targetCtx = (alpha < 0.999 && !this.firstFrame) ? this.fctx : this.bctx;

          targetCtx.setTransform(resolution, 0, 0, resolution, BLUR_PADDING * resolution, BLUR_PADDING * resolution);
          targetCtx.filter = 'none';
          // Preserve Bilibili's white page outside the projected rings.
          targetCtx.fillStyle = 'rgb(255, 255, 255)';
          targetCtx.fillRect(-BLUR_PADDING, -BLUR_PADDING, width + 2 * BLUR_PADDING, height + 2 * BLUR_PADDING);
          const sx = crop[0] * video.videoWidth, sy = crop[1] * video.videoHeight;
          const sw = video.videoWidth * (1 - crop[0] - crop[2]);
          const sh = video.videoHeight * (1 - crop[1] - crop[3]);
          if (mode === 'forward') {
            for (const r of this.rings) targetCtx.drawImage(video, sx, sy, sw, sh, r.outL, r.outT, r.outR - r.outL, r.outB - r.outT);
          } else {
            const tex = this.prepareEdges(video, crop, band, resolution, rect);
            for (const r of this.rings) {
              if (r.inL <= -BLUR_PADDING && r.inR >= width + BLUR_PADDING &&
                  r.inT <= -BLUR_PADDING && r.inB >= height + BLUR_PADDING) continue;
              const v = r.mirrored ? 'Mirror' : 'Normal';
              drawTopTrapezoid(targetCtx, tex['top' + v], r.inL, r.inR, r.inT, r.outL, r.outR, r.outT);
              drawBottomTrapezoid(targetCtx, tex['bottom' + v], r.inL, r.inR, r.inB, r.outL, r.outR, r.outB);
              drawLeftTrapezoid(targetCtx, tex['left' + v], r.inT, r.inB, r.inL, r.outT, r.outB, r.outL);
              drawRightTrapezoid(targetCtx, tex['right' + v], r.inT, r.inB, r.inR, r.outT, r.outB, r.outR);
            }
          }
          // Fill the covered interior with the actual current frame, not a dark
          // rectangle. Blur now samples matching image content across the seam.
          targetCtx.drawImage(video, sx, sy, sw, sh, rect.left, rect.top, rect.width, rect.height);

          if (targetCtx === this.fctx) {
            this.bctx.setTransform(1, 0, 0, 1, 0, 0);
            this.bctx.filter = 'none';
            this.bctx.globalAlpha = alpha;
            this.bctx.drawImage(this.frameBuffer, 0, 0);
            this.bctx.globalAlpha = 1.0;
          }

          this.bufferBuilds++;
          this.frameKey = frameKey; this.source = video;
        }
        this.ctx.setTransform(resolution, 0, 0, resolution, 0, 0);
        this.ctx.clearRect(0, 0, width, height);
        this.ctx.save();
        const filters = [];
        if (blur) filters.push(`blur(${blur * resolution}px)`);
        if (bFactor < 0.999) filters.push(`brightness(${bFactor})`);
        this.ctx.filter = filters.length > 0 ? filters.join(' ') : 'none';
        this.ctx.drawImage(this.buffer, -BLUR_PADDING, -BLUR_PADDING, width + 2 * BLUR_PADDING, height + 2 * BLUR_PADDING);
        this.ctx.restore();
        // White pixels are composited AFTER blur, never fed back into its kernel.
        if (!geometry.fullscreen && fade.start < height) {
          const gradient = this.ctx.createLinearGradient(0, fade.start, 0, fade.end);
          for (let i = 0; i <= 64; i++) {
            const t = i / 64;
            gradient.addColorStop(t, `rgba(255, 255, 255, ${fadeAlpha(t)})`);
          }
          this.ctx.save();
          this.ctx.filter = 'none';
          this.ctx.fillStyle = gradient;
          this.ctx.fillRect(0, fade.start, width, height - fade.start);
          this.ctx.restore();
        }
        this.frames++;
        Object.assign(this.canvas.dataset, { mode, band: String(band), step: String(1 + 2 * band), layers: String(layers),
          blur: String(blur), frames: String(this.frames), geometryBuilds: String(this.geometryBuilds),
          bufferBuilds: String(this.bufferBuilds), res: `${w}x${h}`,
          displayDistance: String(clamp(settings.displayDistance, 0, 500, 200)),
          inertia: String(clamp(settings.inertia, 0, 400, 120)),
          dimming: String(dimming),
          shadow: String(clamp(settings.shadow, 0, 100, 50)),
          fadeStart: geometry.fullscreen ? '' : String(fade.start), fadeEnd: geometry.fullscreen ? '' : String(fade.end) });
        this.lastError = false;
      } catch (error) {
        if (!this.lastError) console.warn('[AmbientLight] Frame rendering failed.', error);
        this.lastError = true;
      }
    }

    destroy() {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.buffer.width = this.buffer.height = 1;
      this.frameBuffer.width = this.frameBuffer.height = 1;
      this.edges = null; this.source = null;
    }
  }
  api.buildAmbientRings = getRings;
  api.getDisplayFade = getDisplayFade;
  api.fadeAlpha = fadeAlpha;
  api.computeInertiaAlpha = AmbientRenderer.prototype.computeInertiaAlpha;
  api.AmbientRenderer = AmbientRenderer;
})(globalThis);
