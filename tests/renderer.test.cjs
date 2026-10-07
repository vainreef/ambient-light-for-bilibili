const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const canvases = [];
function canvas() {
  const ops = [], stack = [];
  const ctx = { filter: 'none', fillStyle: '',
    setTransform(...args) { ops.push({ type: 'transform', args }); },
    fillRect(...args) { ops.push({ type: 'fill', args, color: this.fillStyle, filter: this.filter }); },
    createLinearGradient(...args) {
      const gradient = { args, stops: [], addColorStop(t, color) { this.stops.push([t, color]); } };
      return gradient;
    },
    clearRect() {}, translate() {}, scale() {},
    drawImage(...args) { ops.push({ type: 'draw', args, filter: this.filter }); },
    save() { stack.push(this.filter); }, restore() { this.filter = stack.pop(); },
  };
  const c = { width: 300, height: 150, style: {}, dataset: {}, ops, getContext: () => ctx };
  canvases.push(c); return c;
}
const sandbox = { document: { createElement: canvas }, console, performance };
vm.runInNewContext(fs.readFileSync('src/core/renderer.js', 'utf8'), sandbox);
const display = canvas(), renderer = new sandbox.BiliAmbient.AmbientRenderer(display);
const video = { readyState: 4, videoWidth: 1280, videoHeight: 720, currentTime: 0 };
const settings = { mode: 'mirror', band: 0.2, layers: 4, blur: 28, resolution: 1 };
const geometry = { videoDocLeft: 100, videoDocTop: 200, videoWidth: 800, videoHeight: 450, canvasWidth: 1200, canvasHeight: 3000, viewportHeight: 900 };
const draws = c => c.ops.filter(op => op.type === 'draw');
renderer.draw(video, settings, [0, 0, 0, 0], geometry);
assert.equal(renderer.buffer.width, display.width + 640);
assert.equal(renderer.buffer.height, display.height + 640);
assert.equal(draws(renderer.buffer).length, 1540);
assert(draws(renderer.buffer).every(op => op.filter === 'none'));
assert.equal(draws(display).length, 1);
assert.equal(draws(display)[0].filter, 'blur(28px)');
assert.equal(renderer.buffer.ops.find(op => op.type === 'fill').color, 'rgb(255, 255, 255)');
assert.equal(renderer.buffer.ops.filter(op => op.type === 'fill').length, 1, 'No synthetic dark interior rectangle');
assert.deepEqual(draws(renderer.buffer).at(-1).args.slice(5), [740, 200, 160, 450]);
const fadeFill = display.ops.find(op => op.type === 'fill');
assert.equal(fadeFill.filter, 'none');
assert.deepEqual(Array.from(fadeFill.color.args), [0, 625, 0, 1225]);
assert.equal(fadeFill.color.stops.length, 65);
assert(display.ops.indexOf(fadeFill) > display.ops.indexOf(draws(display)[0]), 'Fade is after the blur pass');
const left = renderer.edges.leftNormal;
assert.equal(draws(left)[0].args[4], 720, 'Left edge samples the full native video height');
assert.equal(draws(renderer.edges.rightNormal)[0].args[4], 720);
assert.equal(draws(renderer.edges.topNormal)[0].args[3], 1280);
const builds = renderer.bufferBuilds, geometryBuilds = renderer.geometryBuilds;
renderer.draw(video, { ...settings, blur: 80 }, [0, 0, 0, 0], geometry);
assert.equal(renderer.bufferBuilds, builds);
assert.equal(renderer.geometryBuilds, geometryBuilds);
assert.equal(draws(display).at(-1).filter, 'blur(80px)');
video.currentTime = 1 / 30;
renderer.draw(video, settings, [0, 0, 0, 0], geometry);
assert.equal(renderer.bufferBuilds, builds + 1, 'New decoded frame refreshes texture content');
assert.equal(renderer.geometryBuilds, geometryBuilds);
assert.equal(renderer.edges.leftNormal, left, 'New frames reuse texture canvases');
renderer.draw(video, { ...settings, mode: 'forward' }, [0, 0, 0, 0], geometry);
assert.equal(draws(renderer.buffer).filter(op => op.args[0] === video).length, 4);
renderer.draw(video, { ...settings, resolution: 2, blur: 80 }, [0, 0, 0, 0], geometry);
assert.equal(draws(display).at(-1).filter, 'blur(160px)');
assert.equal(display.dataset.mode, 'mirror');
assert.equal(display.dataset.step, '1.4');
assert.equal(display.dataset.layers, '4');
assert(!fs.readFileSync('src/core/renderer.js', 'utf8').includes('edgeShadow'));

renderer.draw(video, { ...settings, layers: 12, band: 1.0 }, [0, 0, 0, 0], geometry);
assert.equal(display.dataset.layers, '12');
assert.equal(display.dataset.step, '3');
assert.equal(renderer.rings.length, 12);
assert(display.height <= 2451, '12 rings cannot cause exponential buffer height');
renderer.draw(video, { ...settings, displayDistance: 0 }, [0, 0, 0, 0], { ...geometry, videoDocLeft: 250 });
assert.equal(display.dataset.fadeStart, '425');
assert.equal(display.dataset.fadeEnd, '1025');
assert.equal(draws(renderer.buffer).at(-1).args[5], 890, 'Position-only changes move the edge seam band');
renderer.draw(video, settings, [0, 0.1, 0, 0.1], geometry);
const cropped = draws(renderer.buffer).at(-1).args;
assert.equal(cropped[6], 245);
assert.equal(cropped[8], 360);
const topEdge = draws(renderer.edges.topNormal).at(-1).args;
assert.equal(topEdge[2], 72);
assert.equal(topEdge[4], 115.2);
renderer.draw(video, settings, [0, 0, 0, 0], { ...geometry, sourceCrop: [0.125, 0, 0.125, 0] });
const covered = draws(renderer.edges.leftNormal).at(-1).args;
assert.equal(covered[1], 160);
assert.equal(covered[3], 192);
assert.equal(draws(renderer.buffer).at(-1).args[8], 450, 'Native cover cropping maps to the visible video height');
const { fadeAlpha, getDisplayFade } = sandbox.BiliAmbient;
assert.equal(fadeAlpha(0), 0); assert.equal(fadeAlpha(1), 1); assert.equal(fadeAlpha(0.5), 0.5);
assert(fadeAlpha(0.01) < 0.00002 && fadeAlpha(0.99) > 0.99998);
assert.equal(getDisplayFade(650, 0, 200, 450).length, 600);
assert.equal(getDisplayFade(650, 80, 200, 450).start, 505);
assert.equal(getDisplayFade(650, 80, 200, 450).end, 1105);
const fillsBeforeFullscreen = display.ops.filter(op => op.type === 'fill').length;
renderer.draw(video, settings, [0, 0, 0, 0], { ...geometry, fullscreen: true });
assert.equal(display.ops.filter(op => op.type === 'fill').length, fillsBeforeFullscreen);

renderer.draw(video, { ...settings, dimming: 40, shadow: 15 }, [0, 0, 0, 0], geometry);
assert.equal(draws(display).at(-1).filter, 'blur(28px) brightness(0.6)');
assert.equal(display.dataset.dimming, '40');
assert.equal(display.dataset.shadow, '15');
console.log('PASS: real-frame central fill, responsive positions, 12 bounded rings, smooth 600px post-blur fade, dimming and shadow, native crop, pause cache');
