const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let now = 0, frameId = 0, mutationObserver;
const frames = new Map();
const windowState = { innerWidth: 1200, innerHeight: 900, scrollX: 0, scrollY: 0, addEventListener() {}, removeEventListener() {} };
let videoBox = { left: 100, top: 200, width: 800, height: 500 };
function rect(box) { return { ...box, bottom: box.top + box.height, right: box.left + box.width }; }
function node(tag) {
  const children = [], classes = new Set();
  return { tagName: tag.toUpperCase(), nodeType: 1, style: {}, dataset: {}, children, isConnected: true,
    classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle(x, enabled) { enabled ? classes.add(x) : classes.delete(x); } },
    appendChild(child) { children.push(child); child.parentElement = this; },
    prepend(child) { children.unshift(child); child.parentElement = this; },
    contains(child) { return child === this || children.some(n => n.contains(child)); },
    querySelector() { return null; }, closest() { return null; }, setAttribute() {}, remove() {},
    getBoundingClientRect: () => rect({ left: 40 - windowState.scrollX, top: 50 - windowState.scrollY, width: 1200, height: 3000 }),
  };
}
const body = node('body'); body.scrollHeight = 3000;
const root = { clientWidth: 1200, scrollHeight: 3000, classList: body.classList,
  style: { setProperty() {}, removeProperty() {} } };
const documentState = { body, documentElement: root, fullscreenElement: null, createElement: node,
  addEventListener() {}, removeEventListener() {}, querySelector: () => null };
const sandbox = { document: documentState, window: windowState, performance: { now: () => now },
  getComputedStyle: e => e.tagName === 'VIDEO' ? { objectFit: 'contain', objectPosition: '50% 50%' } : { position: 'static' },
  requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame: id => frames.delete(id),
  ResizeObserver: class { observe() {} disconnect() {} },
  MutationObserver: class { constructor(fn) { mutationObserver = this; this.fn = fn; this.observations = []; } observe(host, options) { this.observations.push({ host, options }); } disconnect() {} },
  setTimeout() {}, console,
};
vm.runInNewContext(fs.readFileSync('src/adapter/bilibili.js', 'utf8'), sandbox);
const { BilibiliAdapter, getVideoContentRect } = sandbox.BiliAmbient;
const video = node('video'); video.videoWidth = 1280; video.videoHeight = 720; video.clientWidth = 800;
video.getBoundingClientRect = () => rect({ ...videoBox, left: videoBox.left - windowState.scrollX, top: videoBox.top - windowState.scrollY });
const area = node('div'); area.getBoundingClientRect = video.getBoundingClientRect; area.appendChild(video);
const container = node('div'); container.appendChild(area); body.appendChild(container);
const adapter = new BilibiliAdapter(); adapter.container = container; adapter.videoArea = area; adapter.video = video;
let notifications = 0;
adapter.mount(() => notifications++, () => {});
assert.equal(adapter.geometry.videoDocLeft, 60, 'Subtract the actual host origin, not just scrollX');
assert.equal(adapter.geometry.videoDocTop, 175, 'Native contain fit has a 25px top letterbox');
assert.equal(adapter.geometry.videoHeight, 450);
assert.equal(adapter.geometry.playerBottom, 650);
const initial = notifications;
videoBox.left = 240;
adapter.syncSize();
assert.equal(adapter.geometry.videoDocLeft, 200);
assert.equal(notifications, initial + 1, 'A position-only change triggers redraw');
windowState.scrollY = 500;
adapter.syncSize();
assert.equal(adapter.geometry.videoDocTop, 175);
assert.equal(notifications, initial + 1, 'Scrolling must not rebuild document-anchored geometry');
assert(mutationObserver.observations.some(o => o.host === body && o.options.attributeFilter.includes('style')));
assert(mutationObserver.observations.some(o => o.host === root && o.options.attributeFilter.includes('class')));
mutationObserver.fn([{ target: container, type: 'attributes', attributeName: 'class' }]);
// Simulate delayed responsive layout after the initial resize notification.
for (let i = 0; frames.size && i < 30; i++) {
  now += 20;
  if (i === 3) videoBox.left = 480;
  const [id, fn] = [...frames][0]; frames.delete(id); fn();
}
assert.equal(adapter.geometry.videoDocLeft, 440, 'Settling sync catches delayed responsive shifts while paused');
assert.equal(frames.size, 0, 'Settling watcher stops instead of spinning forever');
mutationObserver.fn([{ target: adapter.canvas, type: 'attributes', attributeName: 'style' }]);
assert.equal(frames.size, 0, 'Our own canvas updates cannot trigger a redraw loop');
const fitted = getVideoContentRect({ left: 0, top: 0, width: 800, height: 450 }, { videoWidth: 1000, videoHeight: 1000 }, { objectFit: 'contain' });
assert.equal(fitted.left, 175); assert.equal(fitted.width, 450);
const covered = getVideoContentRect({ left: 0, top: 0, width: 800, height: 450 }, { videoWidth: 1000, videoHeight: 1000 }, { objectFit: 'cover' });
assert.equal(covered.sourceCrop[1], 0.21875);
assert.equal(covered.sourceCrop[3], 0.21875);
adapter.destroy();
console.log('PASS: host-local coordinates, native object-fit, position-only resize, paused settling, scroll invariance, mutation loop avoidance');
