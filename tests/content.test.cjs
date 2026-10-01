const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/content.js', 'utf8');
const tick = () => new Promise(setImmediate);
async function setup(options = {}) {
  const handlers = new Map(), callbacks = new Map(), documentEvents = new Map(), globalEvents = new Map(), timers = new Map();
  const state = { available: true, panels: 0, constructors: 0, ...options };
  let id = 0;
  const video = { readyState: 4, videoWidth: 1280, videoHeight: 720, paused: true,
    addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener: name => handlers.delete(name),
    requestVideoFrameCallback: fn => { callbacks.set(++id, fn); return id; }, cancelVideoFrameCallback: n => callbacks.delete(n),
  };
  class Adapter {
    async waitForPlayer() { assert(state.panel, 'UI must exist before player discovery'); return state.available; }
    mount(onGeometry) {
      if (state.mountFailure) throw new Error('mount failed');
      this.geometry = { canvasWidth: 1200, canvasHeight: 2000 };
      onGeometry(1200, 2000, state.geometryMissing ? null : this.geometry);
      if (state.geometryMissing) this.geometry = null;
      return { canvas: {}, video };
    }
    syncSize() { return this.geometry; }
    setEnabled(value) { this.enabled = value; } destroy() {}
  }
  class Renderer {
    constructor() { state.constructors++; if (state.constructorFailure) throw new Error('renderer failed'); state.renderer = this; this.draws = 0; }
    draw() { if (state.drawFailure) throw new Error('frame failed'); this.draws++; }
    resize() {} invalidate() {} destroy() { this.destroyed = true; }
  }
  class Panel {
    constructor(onChange) { state.panels++; state.panel = this; this.onChange = onChange; this.settings = { enabled: state.enabled ?? true }; this.mounts = 0; }
    mountControlButton() { this.mounts++; } destroy() { this.destroyed = true; }
  }
  const sandbox = { BiliAmbient: { AmbientRenderer: Renderer, BilibiliAdapter: Adapter, SettingsPanel: Panel, BarDetector: class { detect() { return [0, 0, 0, 0]; } } },
    document: { readyState: 'complete', hidden: false, addEventListener: (n, fn) => documentEvents.set(n, fn), removeEventListener: n => documentEvents.delete(n) },
    addEventListener: (n, fn) => globalEvents.set(n, fn), removeEventListener: n => globalEvents.delete(n),
    console: { warn() {}, error() {}, info() {} }, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    setTimeout: fn => { timers.set(++id, fn); return id; }, clearTimeout: n => timers.delete(n),
  };
  vm.runInNewContext(source, sandbox); await tick();
  return { state, sandbox, handlers, callbacks, documentEvents, globalEvents, timers, video };
}
(async () => {
  const normal = await setup();
  const { state, video, handlers, callbacks, globalEvents, documentEvents, sandbox } = normal;
  assert.equal(state.renderer.draws, 1); assert.equal(callbacks.size, 0);
  state.panel.onChange({ enabled: true, blur: 80 }); assert.equal(state.renderer.draws, 2);
  video.paused = false; handlers.get('play')(); assert.equal(callbacks.size, 1);
  const [key, cb] = [...callbacks][0]; callbacks.delete(key); cb(); assert.equal(callbacks.size, 1);
  state.panel.onChange({ enabled: false }); assert.equal(callbacks.size, 0); assert(!state.panel.destroyed);
  state.panel.onChange({ enabled: true }); assert.equal(callbacks.size, 1);
  video.paused = true; handlers.get('pause')(); assert.equal(callbacks.size, 0);
  globalEvents.get('pagehide')({ persisted: true }); assert(!state.panel.destroyed);
  globalEvents.get('pageshow')(); assert(!state.panel.destroyed);
  const mounts = state.panel.mounts;
  sandbox.document.hidden = false; documentEvents.get('visibilitychange')(); assert(state.panel.mounts > mounts);
  globalEvents.get('pagehide')({ persisted: false }); assert.equal(handlers.size, 0); assert(state.panel.destroyed);

  const disabled = await setup({ enabled: false, constructorFailure: true });
  assert.equal(disabled.state.constructors, 0, 'Disabled refresh must not initialize a renderer');
  assert.equal(disabled.state.panels, 1); assert(!disabled.state.panel.destroyed);
  disabled.state.panel.onChange({ enabled: true });
  assert.equal(disabled.state.constructors, 1); assert(!disabled.state.panel.destroyed);
  assert.equal(disabled.timers.size, 1, 'Rendering can retry independently of video callbacks');
  disabled.state.constructorFailure = false;
  for (const [id, fn] of [...disabled.timers]) { disabled.timers.delete(id); fn(); }
  assert(disabled.state.renderer.draws > 0); assert.equal(disabled.state.panels, 1);
  disabled.globalEvents.get('pagehide')();

  for (const scenario of [{ available: false }, { mountFailure: true }, { geometryMissing: true }, { drawFailure: true }]) {
    const test = await setup(scenario);
    assert.equal(test.state.panels, 1); assert(!test.state.panel.destroyed, JSON.stringify(scenario));
    assert.equal(test.callbacks.size, 0);
    test.globalEvents.get('pagehide')(); assert.equal(test.timers.size, 0);
  }
  console.log('PASS: UI before discovery, disabled refresh, init/draw/mount faults, retry without frame callbacks, BFCache/background, cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
