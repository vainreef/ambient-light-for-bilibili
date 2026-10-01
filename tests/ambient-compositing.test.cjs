const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the actual HTML script with recording canvases; no copied renderer math.
const html = fs.readFileSync(path.join(__dirname, '../recursive-copies-page.html'), 'utf8');
const bodyStyle = html.match(/\n\s*body\s*\{([^}]+)\}/)[1];
const layerStyle = html.match(/\.ambient-layer\s*\{([^}]+)\}/)[1];
assert.match(bodyStyle, /overflow:\s*visible\s*;/, 'Body must not create a second scrolling container');
assert.match(bodyStyle, /display:\s*flow-root\s*;/, 'Keep body margin containment without a scroll container');
assert.match(layerStyle, /overflow:\s*clip\s*;/, 'Decorative canvas overflow must not enlarge document scrolling');
assert.match(html, /<div class="ambient-layer"[^>]*>\s*<canvas id="ambient"[^>]*><\/canvas>\s*<\/div>/);
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)][0][1];
const canvases = [];
const frames = [];
const elements = new Map();
const images = [];

function makeCanvas(id = '') {
  const ops = [];
  const stack = [];
  const context = {
    filter: 'none',
    fillStyle: '',
    setTransform(...args) { ops.push({ type: 'transform', args }); },
    clearRect(...args) { ops.push({ type: 'clear', args }); },
    fillRect(...args) { ops.push({ type: 'fill', args, fillStyle: this.fillStyle, filter: this.filter }); },
    drawImage(...args) { ops.push({ type: 'draw', args, filter: this.filter }); },
    save() { stack.push({ filter: this.filter, fillStyle: this.fillStyle }); },
    restore() { Object.assign(this, stack.pop()); },
    translate() {}, scale() {}, fillText() {}, strokeRect() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
  };
  const canvas = { id, width: 300, height: 150, style: {}, ops, context, getContext: () => context };
  canvases.push(canvas);
  return canvas;
}

function element(id) {
  if (!elements.has(id)) {
    const listeners = {};
    const classes = new Set();
    const base = id === 'ambient' || id === 'mock-video' ? makeCanvas(id) : { style: {} };
    elements.set(id, Object.assign(base, {
      id, value: '', listeners,
      addEventListener(type, fn) { listeners[type] = fn; },
      classList: {
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
        toggle(name) { classes.has(name) ? classes.delete(name) : classes.add(name); },
      },
      getBoundingClientRect: () => ({ left: 36, top: 170, width: 958, height: 539 }),
    }));
  }
  return elements.get(id);
}

class FakeImage {
  constructor() { this.naturalWidth = 3840; this.naturalHeight = 2160; images.push(this); }
}

const sandbox = {
  document: { getElementById: element, createElement: () => makeCanvas(), documentElement: { clientWidth: 1425, scrollHeight: 3000 }, body: { scrollHeight: 3000 } },
  window: { devicePixelRatio: 1, innerHeight: 900, scrollX: 0, scrollY: 0, addEventListener() {} },
  Image: FakeImage, HTMLImageElement: FakeImage, URL, console,
  requestAnimationFrame: fn => frames.push(fn),
};
vm.runInNewContext(script, sandbox, { filename: 'recursive-copies-page.html' });
images[0].onload();
function flush() { while (frames.length) frames.shift()(); }
function input(id, value) {
  const control = element(id);
  control.value = value;
  control.listeners.input.call(control);
  flush();
}
flush();

const display = element('ambient');
const buffer = canvases.find(c => c !== display && c.ops.some(op => op.type === 'fill' && op.fillStyle === 'rgb(255, 255, 255)'));
assert(buffer, 'The geometry buffer must preserve the white page background');
assert.equal(buffer.width, display.width + 640);
assert.equal(buffer.height, display.height + 640);
const base = buffer.ops.find(op => op.type === 'fill');
assert.deepEqual(base.args, [-320, -320, buffer.width, buffer.height]);
assert(buffer.ops.filter(op => op.type === 'draw').every(op => op.filter === 'none'));
const composite = display.ops.find(op => op.type === 'draw');
assert.equal(composite.args[0], buffer);
assert.deepEqual(composite.args.slice(1), [-320, -320, buffer.width, buffer.height]);
assert.equal(composite.filter, 'blur(28px)');
assert(!html.includes('rangeShadow'));
assert(!html.includes('rangeFade'));
assert(!html.includes('applyDarkEdgeShadow'));
assert(!html.includes('drawRightWhiteFade'));

const geometryOperations = buffer.ops.filter(op => op.type === 'draw' || op.type === 'fill').length;
const originalSize = [buffer.width, buffer.height];
input('rangeBlur', '80');
input('rangeBlur', '0');
assert.equal(buffer.ops.filter(op => op.type === 'draw' || op.type === 'fill').length, geometryOperations);
assert.deepEqual([buffer.width, buffer.height], originalSize);
assert.deepEqual(display.ops.filter(op => op.type === 'draw').map(op => op.filter), ['blur(28px)', 'blur(80px)', 'none']);

element('btnForward').listeners.click();
flush();
assert(buffer.ops.filter(op => op.type === 'fill' && op.fillStyle === 'rgb(255, 255, 255)').length >= 2);
assert(buffer.ops.some(op => op.type === 'draw' && op.args.length === 9 && op.args[5] === 36 && op.args[6] === 170));
assert(buffer.ops.filter(op => op.type === 'draw').every(op => op.filter === 'none'));

console.log('PASS: single document scroll structure, clipped decorative layer, opaque halo buffer, fixed blur overscan, cache reuse, single blur pass, removed shadow/fade controls');
