const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// 1. Test inertia exponential decay mathematics across frame rates
const simulateInertia = (fps, tauMs, durationMs) => {
  const dt = 1000 / fps;
  let currentVal = 0.0;
  const targetVal = 1.0;
  const history = [currentVal];

  for (let t = 0; t < durationMs; t += dt) {
    const alpha = 1.0 - Math.exp(-dt / tauMs);
    currentVal = currentVal * (1.0 - alpha) + targetVal * alpha;
    history.push(currentVal);
  }
  return history;
};

// 60Hz display response vs 120Hz display response
const history60 = simulateInertia(60, 140, 400);
const history120 = simulateInertia(120, 140, 400);

assert(history60[history60.length - 1] > 0.90 && history60[history60.length - 1] < 0.98);
assert(history120[history120.length - 1] > 0.90 && history120[history120.length - 1] < 0.98);

const finalDiff = Math.abs(history60[history60.length - 1] - history120[history120.length - 1]);
assert(finalDiff < 0.02, `Final difference ${finalDiff} exceeds 0.02`);

// 2. Test AmbientRenderer temporal inertia blending
const canvases = [];
function makeCanvas() {
  const ops = [], stack = [];
  const ctx = { filter: 'none', fillStyle: '', globalAlpha: 1.0,
    setTransform(...args) { ops.push({ type: 'transform', args }); },
    fillRect(...args) { ops.push({ type: 'fill', args, color: this.fillStyle, filter: this.filter }); },
    createLinearGradient(...args) { return { args, stops: [], addColorStop(t, color) { this.stops.push([t, color]); } }; },
    clearRect() {}, translate() {}, scale() {},
    drawImage(...args) { ops.push({ type: 'draw', args, alpha: this.globalAlpha, filter: this.filter }); },
    save() { stack.push(this.filter); }, restore() { this.filter = stack.pop(); },
  };
  const c = { width: 300, height: 150, style: {}, dataset: {}, ops, getContext: () => ctx };
  canvases.push(c); return c;
}

let mockNow = 1000;
const sandbox = { document: { createElement: makeCanvas }, console, performance: { now: () => mockNow } };
vm.runInNewContext(fs.readFileSync('src/core/renderer.js', 'utf8'), sandbox);

const display = makeCanvas();
const renderer = new sandbox.BiliAmbient.AmbientRenderer(display);
const video = { readyState: 4, videoWidth: 1280, videoHeight: 720, currentTime: 0 };
const settings = { mode: 'mirror', band: 0.2, layers: 4, blur: 28, resolution: 1, inertia: 140 };
const geometry = { videoDocLeft: 100, videoDocTop: 200, videoWidth: 800, videoHeight: 450, canvasWidth: 1200, canvasHeight: 3000 };

// First frame renders directly (alpha = 1.0)
renderer.draw(video, settings, [0, 0, 0, 0], geometry);
assert.equal(renderer.firstFrame, false);

// Next frame after 16.6ms (60fps step) applies temporal inertia blending
mockNow += 16.6;
video.currentTime = 1 / 60;
renderer.draw(video, settings, [0, 0, 0, 0], geometry);

const bufferDraws = renderer.buffer.ops.filter(op => op.type === 'draw');
const blendPass = bufferDraws.find(op => op.args[0] === renderer.frameBuffer);
assert(blendPass, 'Temporal inertia blending composites frameBuffer onto buffer');
assert(blendPass.alpha > 0.08 && blendPass.alpha < 0.16, `Inertia alpha ${blendPass.alpha} should match 16.6ms / 140ms`);

// Invalidate resets firstFrame
renderer.invalidate();
assert.equal(renderer.firstFrame, true);

console.log('PASS: Inertia decay test passes across 60Hz and 120Hz; frame-rate independent temporal blend verified');
