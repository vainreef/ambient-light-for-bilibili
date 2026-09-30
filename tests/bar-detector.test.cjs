const assert = require('node:assert/strict');

// Mock browser globals needed for BarDetector
globalThis.document = {
  createElement: (tag) => {
    if (tag === 'canvas') {
      return {
        width: 64,
        height: 36,
        getContext: () => ({
          drawImage: () => {},
          getImageData: (x, y, w, h) => ({
            data: new Uint8Array(w * h * 4).fill(0), // all black
          }),
        }),
      };
    }
    return {};
  },
};

globalThis.performance = {
  now: () => Date.now(),
};

require('../src/core/bar-detector.js');

const BarDetector = globalThis.BiliAmbient.BarDetector;
assert(BarDetector, 'BarDetector should be exported');

const detector = new BarDetector();
const mockVideo = { readyState: 4 };

// 1. Initial call with black frame (should detect symmetric letterbox)
const crop1 = detector.detect(mockVideo);
assert(Array.isArray(crop1), 'Crop should be an array');
assert.equal(crop1.length, 4);
assert.equal(crop1[1], crop1[3], 'Top and bottom crop should be strictly symmetric');

// 2. Advance time past interval and check second detection
detector.lastCheck = 0;
const crop2 = detector.detect(mockVideo);
assert.equal(crop2[1], crop2[3], 'Top and bottom crop must remain symmetric');

console.log('PASS: BarDetector unit test passed, symmetric crop verified');
