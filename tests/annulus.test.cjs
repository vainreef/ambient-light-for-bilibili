const assert = require('node:assert/strict');
require('../src/core/renderer.js');
const build = globalThis.BiliAmbient.buildAmbientRings;
const rect = { left: 100, top: 200, width: 800, height: 450 };
for (const band of [0.05, 0.2, 0.32, 0.5, 1.0]) {
  for (const layers of [1, 4, 6, 12]) {
    const rings = build(rect, band, layers);
    assert.equal(rings.length, layers);
    for (const r of rings) {
      assert.equal(r.innerS, (1 + 2 * band) ** (r.k - 1));
      assert.equal(r.outerS, (1 + 2 * band) ** r.k);
      assert.equal(r.mirrored, r.k % 2 === 1);
      assert(Math.abs((r.outR - r.outL) / (r.outB - r.outT) - 800 / 450) < 1e-10);
      const cx = 500, cy = 425;
      assert(Math.abs((r.outT - cy) / (r.outL - cx) - 450 / 800) < 1e-10);
      assert(Math.abs((r.inT - cy) / (r.inL - cx) - 450 / 800) < 1e-10);
    }
    const ascending = [...rings].reverse();
    for (let i = 1; i < ascending.length; i++) {
      assert.equal(ascending[i].inL, ascending[i - 1].outL);
      assert.equal(ascending[i].inT, ascending[i - 1].outT);
    }
  }
}
assert.equal(build(rect, 0.5, 1)[0].outerS, 2);
assert.equal(build(rect, 1.0, 1)[0].outerS, 3);
console.log('PASS: step=1+2a, concentric aspect ratio, diagonal closure, alternating mirror rings');
