/** Bilibili ambient-light content-script entry point. */
(function (global) {
  'use strict';

  if (global.__biliAmbientInstalled) return;
  global.__biliAmbientInstalled = true;

  async function start() {
    global.__biliAmbientInstalled = true;
    const { AmbientWebGLRenderer, BarDetector, BilibiliAdapter, SettingsPanel } = global.BiliAmbient || {};
    if (!AmbientWebGLRenderer || !BarDetector || !BilibiliAdapter || !SettingsPanel) {
      console.error('[AmbientLight] Required modules did not load.');
      return;
    }

    const adapter = new BilibiliAdapter();
    if (!(await adapter.waitForPlayer())) {
      console.info('[AmbientLight] Waiting for a Bilibili video player.');
      global.__biliAmbientInstalled = false;
      global.setTimeout(() => {
        if (!global.__biliAmbientInstalled && !document.hidden) start();
      }, 3000);
      return;
    }

    const detector = new BarDetector();
    let settingsDirty = false;
    let renderer = null;
    let geometry = null;
    let currentVideo = null;
    let generation = 0;
    let stopped = false;
    let scheduled = false;
    let currentVfcId = null;
    let lastDrawTime = 0;
    const MIN_DRAW_INTERVAL = 0; // Uncapped native framerate
    let videoInView = true;

    function renderImmediate() {
      if (stopped || !renderer) return;
      const activeVideo = currentVideo;
      if (!activeVideo || activeVideo.readyState < 2) return;
      if (settings.enabled) {
        if (adapter.layer && adapter.layer.classList.contains('is-hidden')) {
          adapter.layer.classList.remove('is-hidden');
        }
        renderer.draw(activeVideo, settings, detector.detect(activeVideo), geometry);
        settingsDirty = false;
      } else {
        if (adapter.layer && !adapter.layer.classList.contains('is-hidden')) {
          adapter.layer.classList.add('is-hidden');
        }
      }
    }

    const panel = new SettingsPanel((nextSettings) => {
      settings = nextSettings;
      settingsDirty = true;
      adapter.setEnabled(settings.enabled);
      renderImmediate();
      scheduleFrame();
    });
    let settings = panel.settings;

    const onGeometry = (width, height, nextGeometry) => {
      geometry = nextGeometry;
      if (renderer) {
        renderer.resize(width, height);
        renderImmediate();
      }
    };

    const onVideoChange = (video) => {
      panel.mountControlButton();
      if (video === currentVideo) return;
      if (currentVideo && currentVfcId && typeof currentVideo.cancelVideoFrameCallback === 'function') {
        currentVideo.cancelVideoFrameCallback(currentVfcId);
        currentVfcId = null;
      }
      scheduled = false;
      currentVideo = video;
      generation++;
      if (video) {
        const onVideoEvent = () => {
          renderImmediate();
          scheduleFrame();
        };
        video.addEventListener('play', onVideoEvent);
        video.addEventListener('pause', onVideoEvent);
        video.addEventListener('seeked', onVideoEvent);
        video.addEventListener('loadeddata', onVideoEvent);
      }
      renderImmediate();
      scheduleFrame();
    };

    try {
      const surface = adapter.mount(onGeometry, onVideoChange);
      renderer = new AmbientWebGLRenderer(surface.canvas);
      renderer.resize(geometry?.canvasWidth || window.innerWidth, geometry?.canvasHeight || window.innerHeight);
      adapter.setEnabled(settings.enabled);
      currentVideo = surface.video;
      panel.mountControlButton();
    } catch (error) {
      console.error('[AmbientLight] Player setup failed:', error);
      adapter.destroy();
      panel.destroy();
      global.__biliAmbientInstalled = false;
      return;
    }

    if (window.IntersectionObserver && adapter.videoArea) {
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          videoInView = entry.isIntersecting || entry.intersectionRatio > 0;
        }
        if (videoInView) {
          renderImmediate();
          scheduleFrame();
        }
      }, { threshold: [0, 0.1] });
      observer.observe(adapter.videoArea);
    }

    function scheduleFrame() {
      if (scheduled || stopped || document.hidden || !videoInView) return;
      const video = currentVideo;
      if (!video) return;

      scheduled = true;
      const token = generation;
      const run = () => {
        scheduled = false;
        currentVfcId = null;
        if (stopped || token !== generation || document.hidden || !videoInView) return;

        const activeVideo = currentVideo;
        const now = performance.now();
        if (!panel.ctrlButton || !panel.ctrlButton.isConnected) {
          panel.mountControlButton();
        }
        const shouldDraw = settings.enabled && activeVideo && activeVideo.readyState >= 2 && (!activeVideo.paused || settingsDirty);
        
        if (shouldDraw && (settingsDirty || MIN_DRAW_INTERVAL <= 0 || now - lastDrawTime >= MIN_DRAW_INTERVAL)) {
          lastDrawTime = now;
          if (adapter.layer && adapter.layer.classList.contains('is-hidden')) {
            adapter.layer.classList.remove('is-hidden');
          }
          renderer.draw(activeVideo, settings, detector.detect(activeVideo), geometry);
          settingsDirty = false;
        } else if (!settings.enabled && adapter.layer && !adapter.layer.classList.contains('is-hidden')) {
          adapter.layer.classList.add('is-hidden');
        }

        scheduleFrame();
      };

      if (typeof video.requestVideoFrameCallback === 'function' && !video.paused) {
        currentVfcId = video.requestVideoFrameCallback(run);
      } else if (!video.paused) {
        requestAnimationFrame(run);
      } else {
        global.setTimeout(run, activeVideo && activeVideo.readyState >= 2 ? 250 : 500);
      }
    }

    const onVisibilityChange = () => {
      if (!document.hidden && !stopped) {
        settingsDirty = true;
        scheduleFrame();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    scheduleFrame();
    console.info('[AmbientLight] Bilibili ambient light is ready.');

    global.addEventListener('pagehide', () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (currentVideo && currentVfcId && typeof currentVideo.cancelVideoFrameCallback === 'function') {
        currentVideo.cancelVideoFrameCallback(currentVfcId);
      }
      adapter.destroy();
      if (renderer) renderer.destroy();
      panel.destroy();
    }, { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})(globalThis);
