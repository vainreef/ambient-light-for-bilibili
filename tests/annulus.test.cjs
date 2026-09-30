const assert = require('node:assert/strict');
require('../src/core/renderer.js');
const project = globalThis.BiliAmbient.projectAnnulus;
assert.equal(project(0, 0), null);
assert.equal(project(1, 1), null);
const step = 1 / 0.88;
for (let n = 0; n < 24; n++) {
  for (const angle of [0, 0.2, 0.7, 1.2, 2.3, 3.8, 5.4]) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const radius = step ** (n + 0.5);
    const normalizer = Math.max(Math.abs(dx), Math.abs(dy));
    const p = project(dx / normalizer * radius, dy / normalizer * radius);
    assert.equal(p.index, n);
    const sourceRadius = Math.max(Math.abs(p.u * 2 - 1), Math.abs(p.v * 2 - 1));
    assert(sourceRadius >= 0.88 - 1e-9 && sourceRadius <= 1 + 1e-9);
    assert(Math.abs((p.u * 2 - 1) * p.scale - dx / normalizer * radius) < 1e-8);
  }
}
const a = project(1.04, 0.6), b = project(1.04 * step, 0.6 * step);
assert.equal(b.index, a.index + 1);
assert(Math.abs(a.u - b.u) < 1e-10 && Math.abs(a.v - b.v) < 1e-10);

// Wide band (50%) scale and projection verification
const calcScale = globalThis.BiliAmbient.AmbientWebGLRenderer.prototype.calculateScale;
const defScale = calcScale(800, 450, {}, { band: 0.06 });
assert(defScale.totalScaleX > 1.0 && defScale.totalScaleY > 1.0);
assert(defScale.step > 1.0);

const wideScale = calcScale(800, 450, {}, { band: 0.50 });
// At 50% band, totalScale expands to fill the screen (scale >= 2.0)
assert(wideScale.totalScaleX >= 2.0);
assert(wideScale.totalScaleY >= 2.0);
assert(wideScale.step > 1.0 && wideScale.step < 1.15);

// Verify that the 24 concentric levels span outward cleanly with wideScale.step
for (let n = 0; n < 24; n++) {
  const r = (wideScale.step ** (n + 0.5));
  const p = project(r, 0, wideScale.step);
  assert.equal(p.index, n);
}

console.log('PASS: 24 full-ring copies, source annulus bounds, corner directions, scale invariance, wide band 50% screen fill');
