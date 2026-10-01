/**
 * Bilibili player adapter and geometry synchronization module.
 * Responsibilities:
 * 1. Player Discovery: locates the primary video player and detects mini-player mode.
 * 2. Projector Canvas Mounting: injects the ambient layer behind the player.
 * 3. Geometry Sync: maps player position/scale to the dual-mode ambient canvas.
 * 4. Header Scroll Sync: smoothly transitions top navigation bar between transparent and solid.
 */
(function (global) {
  'use strict';

  const api = global.BiliAmbient = global.BiliAmbient || {};

  function getVideoContentRect(box, video, style = {}) {
    const rect = { left: box.left, top: box.top, width: box.width, height: box.height,
      sourceCrop: [0, 0, 0, 0] };
    const fit = style.objectFit;
    if (!video?.videoWidth || !video?.videoHeight || !['contain', 'scale-down', 'cover'].includes(fit)) return rect;
    const minScale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
    const scale = fit === 'cover' ? Math.max(box.width / video.videoWidth, box.height / video.videoHeight)
      : fit === 'scale-down' ? Math.min(1, minScale) : minScale;
    const w = video.videoWidth * scale, h = video.videoHeight * scale;
    const positions = (style.objectPosition || '50% 50%').split(/\s+/);
    const fraction = value => value === 'left' || value === 'top' ? 0 : value === 'right' || value === 'bottom' ? 1
      : value?.endsWith('%') ? Math.max(0, Math.min(1, parseFloat(value) / 100)) : 0.5;
    const px = fraction(positions[0]), py = fraction(positions[1]);
    if (fit === 'cover') {
      const left = (w - box.width) * px / w, top = (h - box.height) * py / h;
      rect.sourceCrop = [left, top, (w - box.width) * (1 - px) / w, (h - box.height) * (1 - py) / h];
    } else {
      rect.left += (box.width - w) * px; rect.top += (box.height - h) * py;
      rect.width = w; rect.height = h;
    }
    return rect;
  }

  class BilibiliAdapter {
    constructor() {
      this.container = null;
      this.videoArea = null;
      this.video = null;
      this.layer = null;
      this.projectors = null;
      this.canvas = null;

      this.resizeObserver = null;
      this.mutationObserver = null;
      this.onGeometry = null;
      this.onVideoChange = null;

      this.geometry = null;
      this.enabled = true;
      this.miniMode = false;
      this.pageModeActive = false;
      this.lastNormalVideoRect = null;

      this.pendingSync = false;
      this.syncUntil = 0;
      this.syncRafId = null;
      this.pendingRefresh = false;
      this.pendingHeaderScrollSync = false;
      this.lastHeaderAlpha = null;

      this.boundResize = () => this.queueSync(400);
      this.boundScroll = () => { this.queueHeaderScrollSync(); this.queueSync(); };
      this.boundFullscreenChange = () => {
        this.syncLayerHost();
        this.queueSync();
      };
    }

    // ---------------------------------------------------------------------------
    // 1. Player Discovery & State
    // ---------------------------------------------------------------------------

    findPlayer() {
      const mainPlayer = document.querySelector('#bilibili-player .bpx-player-container') ||
        document.querySelector('#bilibili-player') ||
        document.querySelector('.player-wrap .bpx-player-container') ||
        document.querySelector('.player-wrap');
      if (mainPlayer) {
        const videoArea = mainPlayer.querySelector('.bpx-player-video-area') || mainPlayer;
        const video = mainPlayer.querySelector('video') || document.querySelector('#bilibili-player video, .player-wrap video');
        if (videoArea && video) return { container: mainPlayer, videoArea, video };
      }

      const candidates = [...document.querySelectorAll('.bpx-player-container')];
      // Prioritize the largest player container (the main video player) over small preview cards
      candidates.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return (rb.width * rb.height) - (ra.width * ra.height);
      });

      for (const container of candidates) {
        if (container.dataset?.screen === 'mini' && candidates.length > 1) continue;
        const videoArea = container.querySelector('.bpx-player-video-area') || container;
        const video = container.querySelector('video');
        if (videoArea && video) {
          const rect = videoArea.getBoundingClientRect();
          if (rect.width >= 320 || candidates.length === 1) {
            return { container, videoArea, video };
          }
        }
      }

      for (const container of candidates) {
        const videoArea = container.querySelector('.bpx-player-video-area') || container;
        const video = container.querySelector('video');
        if (videoArea && video) return { container, videoArea, video };
      }
      return null;
    }

    isMiniPlayer(container, videoArea) {
      const host = container || this.container;
      if (host?.dataset?.screen === 'mini' || host?.querySelector?.('.bpx-player-mini-warp')) return true;
      const area = videoArea || this.videoArea;
      if (area?.isConnected) {
        const rect = area.getBoundingClientRect();
        const position = getComputedStyle(area).position;
        if (rect.width > 0 && rect.width < 480 && (position === 'fixed' || position === 'sticky')) return true;
      }
      return false;
    }

    setMiniMode(mini) {
      mini = Boolean(mini);
      if (mini === this.miniMode) return;
      this.miniMode = mini;
      if (this.layer) {
        this.layer.dataset.miniMode = mini ? '1' : '0';
        if (this.enabled) this.layer.classList.remove('is-hidden');
      }
      this.queueSync();
    }

    async waitForPlayer(timeout = 20000) {
      const deadline = performance.now() + timeout;
      while (performance.now() < deadline) {
        const player = this.findPlayer();
        if (player) {
          this.container = player.container;
          this.videoArea = player.videoArea;
          this.video = player.video;
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return false;
    }

    // ---------------------------------------------------------------------------
    // 2. DOM Mounting & Lifecycle
    // ---------------------------------------------------------------------------

    mount(onGeometry, onVideoChange) {
      this.onGeometry = onGeometry;
      this.onVideoChange = onVideoChange;

      this.layer = document.createElement('div');
      this.layer.className = 'bili-ambient-page-layer is-hidden';
      this.layer.setAttribute('aria-hidden', 'true');

      this.projectors = document.createElement('div');
      this.projectors.className = 'bili-ambient-projectors';
      this.layer.appendChild(this.projectors);

      this.canvas = document.createElement('canvas');
      this.canvas.className = 'bili-ambient-canvas bili-ambient-page-canvas';
      this.projectors.appendChild(this.canvas);
      document.body.prepend(this.layer);

      this.setEnabled(this.enabled);

      document.addEventListener('fullscreenchange', this.boundFullscreenChange);
      document.addEventListener('webkitfullscreenchange', this.boundFullscreenChange);
      window.addEventListener('resize', this.boundResize, { passive: true });
      window.visualViewport?.addEventListener('resize', this.boundResize, { passive: true });
      window.addEventListener('scroll', this.boundScroll, { passive: true });

      this.resizeObserver = new ResizeObserver(() => this.queueSync());
      this.observePlayerSizes();

      this.mutationObserver = new MutationObserver((mutations) => {
        let shouldRefresh = false, layoutChanged = false;
        for (const m of mutations) {
          // Ignore our own canvas sizing, settings text and button states.
          if (m.target === this.layer || this.layer?.contains(m.target) ||
              m.target.closest?.('.bili-ambient-ui-host, .bili-ambient-panel, .bpx-player-ctrl-ambient')) continue;
          layoutChanged = true;
          if (m.type === 'attributes' && m.attributeName === 'data-screen') shouldRefresh = true;
          if (m.type === 'childList') {
            if (m.removedNodes.length && (!this.video?.isConnected || !this.container?.isConnected)) shouldRefresh = true;
            for (const n of m.addedNodes) {
              if (n.nodeType === 1 && (n.tagName === 'VIDEO' || n.classList?.contains('bpx-player-container') ||
                  n.id === 'bilibili-player' || n.querySelector?.('video, .bpx-player-container'))) shouldRefresh = true;
            }
          }
        }
        if (shouldRefresh) this.queueRefresh();
        if (layoutChanged) this.queueSync(400);
      });
      this.mutationObserver.observe(document.body, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['data-screen', 'style', 'class'],
      });
      this.mutationObserver.observe(document.documentElement, {
        attributes: true, attributeFilter: ['style', 'class'],
      });

      this.syncSize();
      return { layer: this.layer, canvas: this.canvas, video: this.video };
    }

    syncLayerHost() {
      if (!this.layer) return;
      const host = document.fullscreenElement || document.body;
      if (this.layer.parentElement !== host) host.prepend(this.layer);
    }

    observePlayerSizes() {
      if (!this.resizeObserver) return;
      this.resizeObserver.disconnect();
      const observed = new Set();
      for (const target of [this.video, this.videoArea, this.container, document.body]) {
        // Ancestor columns can change height/width while the video size stays fixed.
        for (let element = target; element; element = element.parentElement) {
          if (!observed.has(element)) { observed.add(element); this.resizeObserver.observe(element); }
          if (element === document.body) break;
        }
      }
    }

    destroy() {
      if (this.syncRafId !== null) cancelAnimationFrame(this.syncRafId);
      this.syncRafId = null;
      this.disablePageBackgroundMode();
      if (this.resizeObserver) this.resizeObserver.disconnect();
      if (this.mutationObserver) this.mutationObserver.disconnect();

      window.removeEventListener('resize', this.boundResize);
      window.visualViewport?.removeEventListener('resize', this.boundResize);
      if (this.boundScroll) window.removeEventListener('scroll', this.boundScroll);
      document.removeEventListener('fullscreenchange', this.boundFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', this.boundFullscreenChange);

      if (this.layer) this.layer.remove();
      this.resizeObserver = null;
      this.mutationObserver = null;
      this.layer = null;
      this.projectors = null;
      this.canvas = null;
      this.container = null;
      this.videoArea = null;
      this.video = null;
    }

    // ---------------------------------------------------------------------------
    // 3. Page Background & Header Scroll Sync
    // ---------------------------------------------------------------------------

    setEnabled(enabled) {
      this.enabled = Boolean(enabled);
      if (this.enabled) {
        this.enablePageBackgroundMode();
        this.layer?.classList.remove('is-hidden');
      } else {
        this.disablePageBackgroundMode();
        this.layer?.classList.add('is-hidden');
      }
    }

    enablePageBackgroundMode() {
      if (this.pageModeActive || !document.documentElement || !document.body) return;
      document.documentElement.classList.add('bili-ambient-page-mode');
      this.pageModeActive = true;
      this.updateHeaderScroll();
    }

    disablePageBackgroundMode() {
      if (!this.pageModeActive) return;
      document.documentElement?.classList.remove('bili-ambient-page-mode');
      document.documentElement?.style.removeProperty('--bili-header-bg-alpha');
      document.documentElement?.style.removeProperty('--bili-ambient-video-bottom');
      this.lastHeaderAlpha = null;
      this.pageModeActive = false;
    }

    queueHeaderScrollSync() {
      if (this.pendingHeaderScrollSync) return;
      this.pendingHeaderScrollSync = true;
      requestAnimationFrame(() => {
        this.pendingHeaderScrollSync = false;
        this.updateHeaderScroll();
      });
    }

    updateHeaderScroll() {
      if (!this.enabled || !this.pageModeActive) return;
      const wrap = this.videoArea?.closest('.player-wrap') || document.querySelector('.player-wrap') || this.container || document.querySelector('#bilibili-player');
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();

      // Top navigation bar height is 64px.
      // Transition range: starts when player bottom approaches header (200px),
      // and completes as player bottom passes into the header bar (50px).
      const startY = 200;
      const endY = 50;
      let alpha = 0;
      if (rect.bottom >= startY) {
        alpha = 0;
      } else if (rect.bottom <= endY) {
        alpha = 1;
      } else {
        alpha = (startY - rect.bottom) / (startY - endY);
      }

      if (this.lastHeaderAlpha === null || Math.abs(alpha - this.lastHeaderAlpha) > 0.005 || (alpha === 0 && this.lastHeaderAlpha !== 0) || (alpha === 1 && this.lastHeaderAlpha !== 1)) {
        this.lastHeaderAlpha = alpha;
        document.documentElement.style.setProperty('--bili-header-bg-alpha', alpha.toFixed(3));
      }
    }

    // ---------------------------------------------------------------------------
    // 4. Geometry Calculation & Synchronization
    // ---------------------------------------------------------------------------

    queueSync(settleMs = 0) {
      this.syncUntil = Math.max(this.syncUntil, performance.now() + settleMs);
      if (this.pendingSync) return;
      this.pendingSync = true;
      const run = () => {
        this.syncRafId = null;
        this.syncSize();
        // Catch responsive/transition updates that land after the resize event,
        // including a paused video. Only changed geometry triggers rendering.
        if (this.layer && performance.now() < this.syncUntil) this.syncRafId = requestAnimationFrame(run);
        else this.pendingSync = false;
      };
      this.syncRafId = requestAnimationFrame(run);
    }

    queueRefresh() {
      if (this.pendingRefresh) return;
      this.pendingRefresh = true;
      global.setTimeout(() => {
        this.pendingRefresh = false;
        this.refresh();
        this.queueSync();
      }, 160);
    }

    syncSize(notify = true) {
      if (!this.layer || !this.canvas || !this.videoArea?.isConnected) return null;
      const mini = this.isMiniPlayer();
      if (mini !== this.miniMode) this.setMiniMode(mini);
      const viewportWidth = Math.max(1, window.innerWidth);
      const viewportHeight = Math.max(1, window.innerHeight);
      const target = this.videoArea?.isConnected ? this.videoArea : (this.video?.isConnected ? this.video : null);
      if (!target) return null;
      const box = target.getBoundingClientRect();
      let videoRect = getVideoContentRect(box, this.video, this.video ? getComputedStyle(this.video) : {});
      const area = this.videoArea ? this.videoArea.getBoundingClientRect() : box;
      const fullscreen = Boolean(document.fullscreenElement && document.fullscreenElement.contains(target));
      let playerBottom = area.bottom;
      if (!mini && !fullscreen && videoRect.width > 0 && videoRect.height > 0) {
        this.lastNormalVideoRect = {
          docLeft: videoRect.left + window.scrollX, docTop: videoRect.top + window.scrollY,
          width: videoRect.width, height: videoRect.height, sourceCrop: videoRect.sourceCrop,
          playerBottomDoc: area.bottom + window.scrollY,
        };
      } else if (mini && this.lastNormalVideoRect && !fullscreen) {
        const normal = this.lastNormalVideoRect;
        videoRect = { left: normal.docLeft - window.scrollX, top: normal.docTop - window.scrollY,
          width: normal.width, height: normal.height, sourceCrop: normal.sourceCrop };
        playerBottom = normal.playerBottomDoc - window.scrollY;
      }
      if (videoRect.width <= 0 || videoRect.height <= 0) return null;
      this.layer.classList.toggle('is-fullscreen', fullscreen);
      const docWidth = fullscreen ? viewportWidth : Math.max(1, document.documentElement.clientWidth);
      const docHeight = fullscreen ? viewportHeight : Math.max(viewportHeight,
        document.body?.scrollHeight || 0, document.documentElement.scrollHeight);
      const setStyle = (element, property, value) => {
        if (element.style[property] !== value) element.style[property] = value;
      };
      setStyle(this.layer, 'width', fullscreen ? '100vw' : '100%');
      setStyle(this.layer, 'height', fullscreen ? '100vh' : '100%');
      setStyle(this.projectors, 'left', '0px'); setStyle(this.projectors, 'top', '0px');
      setStyle(this.projectors, 'width', `${docWidth}px`);
      setStyle(this.projectors, 'height', `${docHeight}px`);
      const origin = this.projectors.getBoundingClientRect();
      const next = {
        // Renderer coordinates are LOCAL to the canvas host, not to document.body.
        videoDocLeft: videoRect.left - origin.left, videoDocTop: videoRect.top - origin.top,
        videoLeft: videoRect.left, videoTop: videoRect.top,
        videoWidth: videoRect.width, videoHeight: videoRect.height,
        playerBottom: playerBottom - origin.top, sourceCrop: videoRect.sourceCrop,
        canvasWidth: docWidth, canvasHeight: docHeight, viewportHeight, fullscreen,
      };
      // Scrolling changes viewport coordinates, not the document-anchored field.
      const { videoLeft, videoTop, ...projection } = next;
      const key = JSON.stringify(projection);
      const changed = key !== this.geometryKey;
      this.geometry = next; this.geometryKey = key;
      if (changed) {
        this.layer.dataset.videoRect = `${next.videoDocLeft},${next.videoDocTop},${next.videoWidth},${next.videoHeight}`;
        if (notify && this.onGeometry) this.onGeometry(docWidth, docHeight, next);
      }
      if (notify) this.updateHeaderScroll();
      return next;
    }

    refresh() {
      if (this.container) {
        const mini = this.isMiniPlayer();
        if (mini !== this.miniMode) this.setMiniMode(mini);
      }
      const player = this.findPlayer();
      if (!player) {
        if (this.container && (!this.container.isConnected || !this.videoArea?.isConnected || !this.video?.isConnected)) {
          this.container = null;
          this.videoArea = null;
          this.video = null;
          this.setMiniMode(false);
          this.layer?.classList.add('is-hidden');
          this.disablePageBackgroundMode();
          if (this.onVideoChange) this.onVideoChange(null);
        }
        return false;
      }

      if (this.enabled && !this.pageModeActive) {
        this.enablePageBackgroundMode();
        this.layer?.classList.remove('is-hidden');
      }

      const surfaceChanged = player.container !== this.container || player.videoArea !== this.videoArea;
      const videoChanged = player.video !== this.video;
      if (surfaceChanged) {
        this.container = player.container;
        this.videoArea = player.videoArea;
        this.observePlayerSizes();
        this.queueSync();
      }
      if (videoChanged) {
        this.video = player.video;
        this.observePlayerSizes();
        if (this.onVideoChange) this.onVideoChange(this.video);
      }
      return surfaceChanged || videoChanged;
    }
  }

  api.getVideoContentRect = getVideoContentRect;
  api.BilibiliAdapter = BilibiliAdapter;
})(globalThis);
