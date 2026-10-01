const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let doc, serial = 0;
const timers = new Map(), intervals = new Map(), frames = new Map(), observers = [];
function events(target) {
  target.listeners = new Map();
  target.addEventListener = (name, fn) => { const list = target.listeners.get(name) || []; list.push(fn); target.listeners.set(name, list); };
  target.removeEventListener = (name, fn) => target.listeners.set(name, (target.listeners.get(name) || []).filter(f => f !== fn));
  target.emit = (name, detail = {}) => { const e = { target, relatedTarget: null, stopPropagation() {}, preventDefault() {}, ...detail }; for (const fn of target.listeners.get(name) || []) fn(e); };
  return target;
}
function matches(element, selector) {
  if (selector.includes(',')) return selector.split(',').some(s => matches(element, s.trim()));
  const tag = selector.match(/^[\w-]+/);
  if (tag && element.tagName !== tag[0].toUpperCase()) return false;
  const id = selector.match(/#([\w-]+)/); if (id && element.id !== id[1]) return false;
  for (const m of selector.matchAll(/\.([\w-]+)/g)) if (!element.classList.contains(m[1])) return false;
  for (const m of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    if (!element.attributes.has(m[1]) || (m[2] !== undefined && element.getAttribute(m[1]) !== m[2])) return false;
  }
  return true;
}
class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.nodeType = 1; this.children = []; this.attributes = new Map(); this.style = {}; this.dataset = {}; events(this); }
  get classList() {
    const e = this; return {
      contains: c => (e.className || '').split(/\s+/).includes(c),
      add(...names) { e.className = [...new Set([...(e.className || '').split(/\s+/).filter(Boolean), ...names])].join(' '); },
      remove(...names) { e.className = (e.className || '').split(/\s+/).filter(c => !names.includes(c)).join(' '); },
      toggle(c, enabled) { if (enabled === undefined) enabled = !this.contains(c); enabled ? this.add(c) : this.remove(c); },
    };
  }
  get isConnected() { return this === doc.documentElement || Boolean(this.parentElement?.isConnected); }
  get parentNode() { return this.parentElement; }
  get nextElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
  appendChild(e) { e.remove(); this.children.push(e); e.parentElement = this; return e; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(x => x !== this); this.parentElement = null; }
  after(e) { e.remove(); const list = this.parentElement.children; list.splice(list.indexOf(this) + 1, 0, e); e.parentElement = this.parentElement; }
  contains(e) { return e === this || this.children.some(c => c.contains(e)); }
  querySelectorAll(selector) { return this.children.flatMap(c => [...(matches(c, selector) ? [c] : []), ...c.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return matches(this, selector) ? this : this.parentElement?.closest(selector) || null; }
  setAttribute(k, v) { v = String(v); this.attributes.set(k, v); if (k === 'class') this.className = v; if (k === 'id') this.id = v; if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v; }
  getAttribute(k) { return this.attributes.get(k) ?? null; }
  removeAttribute(k) { this.attributes.delete(k); }
  set innerHTML(html) {
    this.children = []; const stack = [this];
    for (const token of html.matchAll(/<(\/?)([\w-]+)([^>]*)>/g)) {
      if (token[1]) { if (stack.length > 1) stack.pop(); continue; }
      const e = new Element(token[2]);
      for (const attr of token[3].matchAll(/([\w-]+)="([^"]*)"/g)) e.setAttribute(attr[1], attr[2]);
      stack.at(-1).appendChild(e);
      if (!['input', 'path', 'rect', 'br'].includes(token[2]) && !token[3].endsWith('/')) stack.push(e);
    }
  }
  getBoundingClientRect() {
    if (this.classList.contains('bili-ambient-ui-host')) return this.parentElement.getBoundingClientRect();
    const box = this.box || (this.classList.contains('bpx-player-ctrl-ambient') ? { left: 810, top: 505, width: 36, height: 22 } : { left: 50, top: 100, width: 800, height: 450 });
    return { ...box, right: box.left + box.width, bottom: box.top + box.height };
  }
  get clientWidth() { return this.getBoundingClientRect().width; }
  get clientHeight() { return this.getBoundingClientRect().height; }
  get offsetWidth() { return parseFloat(this.style.width) || 320; }
  get offsetHeight() { return Math.min(360, parseFloat(this.style.maxHeight) || 360); }
  focus() { doc.activeElement = this; this.emit('focus'); }
}
doc = events({ hidden: false, fullscreenElement: null });
doc.documentElement = new Element('html'); doc.body = new Element('body'); doc.documentElement.appendChild(doc.body);
doc.createElement = tag => new Element(tag);
doc.querySelectorAll = selector => doc.documentElement.querySelectorAll(selector);
doc.querySelector = selector => doc.querySelectorAll(selector)[0] || null;
let stored = JSON.stringify({ enabled: false, mode: 'mirror', layers: 12 });
const sandbox = events({ document: doc, console,
  localStorage: { getItem: () => stored, setItem: (_, value) => { stored = value; } },
  setTimeout: fn => { timers.set(++serial, fn); return serial; }, clearTimeout: id => timers.delete(id),
  setInterval: fn => { intervals.set(++serial, fn); return serial; }, clearInterval: id => intervals.delete(id),
  requestAnimationFrame: fn => { frames.set(++serial, fn); return serial; }, cancelAnimationFrame: id => frames.delete(id),
  ResizeObserver: class { observe() {} disconnect() {} },
  MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe(root) { this.root = root; } disconnect() {} },
  getComputedStyle: () => ({ position: 'relative' }),
});
function player() {
  const p = new Element('div'); p.className = 'bpx-player-container';
  p.appendChild(new Element('video'));
  const bar = new Element('div'); bar.className = 'bpx-player-control-bottom-right';
  const gear = new Element('div'); gear.className = 'bpx-player-ctrl-setting'; bar.appendChild(gear); p.appendChild(bar); doc.body.appendChild(p);
  return { p, bar, gear };
}
function flush(map) { for (const [id, fn] of [...map]) { map.delete(id); fn(); } }
let first = player();
vm.runInNewContext(fs.readFileSync('src/ui/panel.js', 'utf8'), sandbox);
const Panel = sandbox.BiliAmbient.SettingsPanel;
let changes = 0;
const panel = new Panel(() => changes++);
const button = panel.ctrlButton;
assert(button.isConnected && button.parentElement === first.bar);
assert(!button.classList.contains('is-disabled'));
assert.equal(button.getAttribute('aria-disabled'), null);
assert.equal(panel.settings.enabled, false, 'A saved disabled setting still mounts the entry');
assert.equal(panel.uiHost.parentElement, first.p);
assert.equal(observers[0].root, doc.documentElement);
button.emit('mouseenter'); assert(panel.open);
button.emit('mouseleave'); assert.equal(timers.size, 1);
panel.panel.emit('mouseenter'); assert.equal(timers.size, 0);
panel.panel.querySelector('[data-setting="enabled"]').emit('click');
assert.equal(panel.settings.enabled, true); assert.equal(changes, 1);
panel.panel.querySelector('[data-setting="enabled"]').emit('click');
assert.equal(panel.settings.enabled, false); assert(button.isConnected && panel.open);
assert(!button.classList.contains('is-disabled'));
panel.panel.emit('pointerdown'); panel.panel.emit('mouseleave'); assert.equal(timers.size, 0, 'Dragging a slider keeps the panel open');
doc.emit('pointerup'); flush(timers); assert(!panel.open);
button.emit('keydown', { key: 'Enter' }); assert(panel.open);
panel.panel.emit('keydown', { key: 'Escape' }); assert(!panel.open, 'Escape must not reopen via launcher focus');
assert.equal(doc.activeElement, button);
// Control-bar replacement with the old launcher still connected in a retired bar.
const replacement = new Element('div'); replacement.className = 'bpx-player-control-bottom-right';
const newGear = new Element('div'); newGear.className = 'bpx-player-ctrl-setting'; replacement.appendChild(newGear);
first.gear.remove(); first.bar.className = 'retired'; first.p.appendChild(replacement);
panel.mountControlButton(); assert.equal(button.parentElement, replacement);
// A stale hidden gear must not win over the current visible controls.
const staleGear = new Element('div'); staleGear.className = 'bpx-player-ctrl-setting';
staleGear.box = { left: 0, top: 0, width: 0, height: 0 }; first.bar.appendChild(staleGear);
panel.mountControlButton(); assert.equal(button.parentElement, replacement);
// Whole player replacement.
first.p.remove(); const second = player();
observers[0].fn([{ target: doc.body, type: 'childList' }]); flush(frames);
assert.equal(button.parentElement, second.bar); assert.equal(panel.uiHost.parentElement, second.p);
assert.equal(doc.querySelectorAll('.bpx-player-ctrl-ambient').length, 1);
// Own UI text changes never cause a remount loop.
observers[0].fn([{ target: panel.panel, type: 'childList' }]); assert.equal(frames.size, 0);
// Fullscreen and background wake keep the same entry.
doc.fullscreenElement = second.p; doc.emit('fullscreenchange'); flush(frames); assert.equal(panel.uiHost.parentElement, second.p);
button.remove(); doc.hidden = false; doc.emit('visibilitychange'); assert(button.isConnected);
// Refresh reconstruction from saved disabled preferences.
panel.destroy(); const reloaded = new Panel(() => {});
assert.equal(reloaded.settings.enabled, false); assert(reloaded.ctrlButton.isConnected);
assert.equal(doc.querySelectorAll('.bpx-player-ctrl-ambient').length, 1);
const css = fs.readFileSync('src/styles/ambient.css', 'utf8');
assert(!/\.bili-ambient-panel\s*\{[^}]*position:\s*fixed/.test(css));
assert(!css.includes('.bpx-player-ctrl-ambient.is-disabled'));
reloaded.destroy(); assert.equal(intervals.size, 0); assert.equal(frames.size, 0); assert.equal(timers.size, 0);
console.log('PASS: disabled refresh entry, hover bridge/drag/Escape, current control host, player replacement, fullscreen/wake, cleanup');
