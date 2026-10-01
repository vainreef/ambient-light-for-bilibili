/** Settings live independently of player discovery, projection and frame callbacks. */
(function (global) {
  'use strict';
  if (global.__biliAmbientInstalled) return;
  global.__biliAmbientInstalled = true;

  function start() {
    const api = global.BiliAmbient || {};
    if (!api.SettingsPanel) { global.__biliAmbientInstalled = false; return; }
    let adapter = null, detector = null, renderer = null, geometry = null, currentVideo = null;
    let stopped = false, mounting = false, mounted = false, suspended = false, renderFault = false;
    let vfcId = null, rafId = null, retryTimer = null, generation = 0;
    let settings;
    const videoEvents = ['play', 'pause', 'seeked', 'loadeddata', 'loadedmetadata', 'emptied'];

    // Create UI FIRST, even with saved enabled:false, a missing video or a broken renderer.
    const panel = new api.SettingsPanel(next => {
      settings = next; renderFault = false;
      cancelRetry();
      if (adapter) adapter.setEnabled(settings.enabled && mounted);
      if (!settings.enabled) cancelFrame();
      panel.mountControlButton();
      if (mounted) { renderImmediate(); scheduleFrame(); }
      else mountBackend();
    });
    settings = panel.settings;

    function cancelRetry() {
      if (retryTimer !== null) global.clearTimeout(retryTimer);
      retryTimer = null;
    }
    function retryLater() {
      if (stopped || suspended || retryTimer !== null) return;
      retryTimer = global.setTimeout(() => {
        retryTimer = null;
        if (!mounted) mountBackend();
        else if (settings.enabled && !document.hidden) {
          renderFault = false; renderImmediate(); scheduleFrame();
        }
      }, 3000);
    }
    function cancelFrame() {
      if (vfcId !== null && currentVideo?.cancelVideoFrameCallback) currentVideo.cancelVideoFrameCallback(vfcId);
      if (rafId !== null) global.cancelAnimationFrame(rafId);
      vfcId = rafId = null;
    }
    function failRendering(error) {
      cancelFrame();
      if (!renderFault) console.warn('[AmbientLight] Projection stopped; settings remain available.', error);
      renderFault = true;
      adapter?.setEnabled(false);
      // Do not delete UI, reset the user's preference, or bind recovery to video frames.
      if (settings.enabled) retryLater();
    }
    function renderImmediate() {
      if (stopped || suspended || !mounted || renderFault || !settings.enabled || document.hidden ||
          !currentVideo || currentVideo.readyState < 2) return;
      try {
        const next = adapter.syncSize(false);
        if (next) geometry = next;
        if (!geometry) return;
        if (!renderer) renderer = new api.AmbientRenderer(adapter.canvas);
        if (!detector) detector = new api.BarDetector();
        renderer.resize(geometry.canvasWidth, geometry.canvasHeight);
        adapter.setEnabled(true);
        renderer.draw(currentVideo, settings, detector.detect(currentVideo), geometry);
        if (renderer.lastError) throw new Error('Video frame projection failed');
        cancelRetry();
      } catch (error) { failRendering(error); }
    }
    function scheduleFrame() {
      if (stopped || suspended || !mounted || !renderer || renderFault || !settings.enabled || document.hidden ||
          !currentVideo || currentVideo.paused || vfcId !== null || rafId !== null) return;
      const token = generation;
      const run = () => {
        if (token !== generation || stopped || suspended) return;
        vfcId = rafId = null;
        renderImmediate(); scheduleFrame();
      };
      if (typeof currentVideo.requestVideoFrameCallback === 'function') vfcId = currentVideo.requestVideoFrameCallback(run);
      else rafId = global.requestAnimationFrame(run);
    }
    function onVideoEvent() {
      renderer?.invalidate(); renderFault = false;
      if (currentVideo?.paused) cancelFrame();
      renderImmediate(); scheduleFrame();
    }
    function bindVideo(video) {
      panel.mountControlButton();
      if (video === currentVideo) { renderImmediate(); scheduleFrame(); return; }
      cancelFrame(); generation++;
      if (currentVideo) for (const event of videoEvents) currentVideo.removeEventListener(event, onVideoEvent);
      currentVideo = video;
      if (detector) { detector.crop = [0, 0, 0, 0]; detector.lastCheck = 0; }
      renderer?.invalidate(); renderFault = false;
      if (video) for (const event of videoEvents) video.addEventListener(event, onVideoEvent);
      renderImmediate(); scheduleFrame();
    }
    async function mountBackend() {
      if (mounting || mounted || stopped || suspended) return;
      mounting = true;
      try {
        if (!api.BilibiliAdapter || !api.AmbientRenderer || !api.BarDetector) throw new Error('Projection modules are not ready');
        adapter = new api.BilibiliAdapter();
        if (!(await adapter.waitForPlayer())) { retryLater(); return; }
        if (stopped || suspended) return;
        adapter.setEnabled(false);
        const surface = adapter.mount((width, height, next) => {
          geometry = next;
          renderImmediate();
        }, bindVideo);
        adapter.canvas = surface.canvas;
        mounted = true;
        geometry = adapter.geometry || geometry;
        adapter.setEnabled(settings.enabled);
        bindVideo(surface.video);
      } catch (error) {
        console.warn('[AmbientLight] Player setup delayed; settings remain available.', error);
        try { adapter?.destroy(); } catch { /* A partial projection mount may already be detached. */ }
        adapter = null; mounted = false;
        retryLater();
      } finally { mounting = false; }
    }
    const onVisibility = () => {
      if (document.hidden) cancelFrame();
      else {
        panel.mountControlButton(); renderFault = false;
        if (mounted) { renderImmediate(); scheduleFrame(); }
        else mountBackend();
      }
    };
    const onPageShow = () => {
      suspended = false;
      panel.mountControlButton();
      if (!mounted) mountBackend();
      else { renderFault = false; renderImmediate(); scheduleFrame(); }
    };
    const onPageHide = event => {
      cancelFrame(); cancelRetry();
      if (event?.persisted) { suspended = true; return; }
      stopped = true;
      if (currentVideo) for (const e of videoEvents) currentVideo.removeEventListener(e, onVideoEvent);
      document.removeEventListener('visibilitychange', onVisibility);
      global.removeEventListener('pageshow', onPageShow);
      global.removeEventListener('pagehide', onPageHide);
      try { adapter?.destroy(); } finally { try { renderer?.destroy(); } finally { panel.destroy(); } }
      global.__biliAmbientInstalled = false;
    };
    document.addEventListener('visibilitychange', onVisibility);
    global.addEventListener('pageshow', onPageShow);
    global.addEventListener('pagehide', onPageHide);
    mountBackend();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})(globalThis);
