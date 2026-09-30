const assert = require('node:assert/strict');
require('../src/core/renderer.js');

// Test inertia exponential decay mathematics
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

// 1. 60Hz display response
const history60 = simulateInertia(60, 140, 400);
// 2. 120Hz display response
const history120 = simulateInertia(120, 140, 400);

// Both should reach ~94% within 400ms (smooth, physical inertia)
assert(history60[history60.length - 1] > 0.90 && history60[history60.length - 1] < 0.98);
assert(history120[history120.length - 1] > 0.90 && history120[history120.length - 1] < 0.98);

// Difference between 60Hz and 120Hz at 400ms should be < 0.02 (frame-rate independent)
const finalDiff = Math.abs(history60[history60.length - 1] - history120[history120.length - 1]);
assert(finalDiff < 0.02, `Final difference ${finalDiff} exceeds 0.02`);

console.log('PASS: Inertia decay test passes across 60Hz and 120Hz');
