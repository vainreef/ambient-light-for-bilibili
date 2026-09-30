/**
 * Bilibili player adapter and geometry synchronization module.
 * Responsibilities:
 * 1. Player Discovery: locates the primary video player and detects mini-player mode.
 * 2. Projector Canvas Mounting: injects the ambient layer behind the player.
 * 3. Geometry Sync: maps player position/scale to the WebGL ambient canvas.
 * 4. Header Scroll Sync: smoothly transitions top navigation bar between transparent and solid.
 */
(function (global) {
  'use strict';

  const api = global.BiliAmbient = global.BiliAmbient || {};

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
      this.pendingRefresh = false;
      this.pendingHeaderScrollSync = false;
      this.lastHeaderAlpha = null;

      this.boundResize = () => this.queueSync();
      this.boundScroll = () => this.queueHeaderScrollSync();
      this.boundFullscreenChange = () => {
        this.syncLayerHost();
        this.queueSync();
      };
    }

    // ---------------------------------------------------------------------------
    // 1. Player Discovery & State
    // ---------------------------------------------------------------------------

    findPlayer() {
      const candidates = [];
      const mainPlayer = document.querySelector('#bilibili-player .bpx-player-container') || document.querySelector('#bilibili-player');
      if (mainPlayer) candidates.push(mainPlayer);

      const allContainers = [...document.querySelectorAll('.bpx-player-container')];
      for (const c of allContainers) {
        if (!candidates.includes(c)) candidates.push(c);
      }

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
          if (rect.width >= 320) {
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
        let shouldRefresh = false;
        for (const m of mutations) {
          if (m.type === 'attributes' && m.attributeName === 'data-screen') {
            shouldRefresh = true;
            break;
          }
          if (m.type === 'childList') {
            for (const n of m.addedNodes) {
              if (n.nodeType === 1 && (n.classList?.contains('bpx-player-container') || n.id === 'bilibili-player')) {
                shouldRefresh = true;
                break;
              }
            }
          }
        }
        if (shouldRefresh) this.queueRefresh();
      });

      const playerHost = this.container || document.querySelector('.bpx-player-container') || document.querySelector('#bilibili-player') || document.body;
      this.mutationObserver.observe(playerHost, {
        childList: true,
        subtree: false,
        attributes: true,
        attributeFilter: ['data-screen'],
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
      if (this.video) this.resizeObserver.observe(this.video);
      if (this.videoArea) this.resizeObserver.observe(this.videoArea);
      if (this.container) this.resizeObserver.observe(this.container);
    }

    destroy() {
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
        if (!this.miniMode) this.layer?.classList.remove('is-hidden');
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

    queueSync() {
      if (this.pendingSync) return;
      this.pendingSync = true;
      requestAnimationFrame(() => {
        this.pendingSync = false;
        this.syncSize();
      });
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

    syncSize() {
      if (!this.layer || !this.canvas || !this.videoArea) return;

      const mini = this.isMiniPlayer();
      if (mini !== this.miniMode) this.setMiniMode(mini);

      const viewportWidth = Math.max(1, window.innerWidth);
      const viewportHeight = Math.max(1, window.innerHeight);

      const targetEl = (this.video && this.video.isConnected && this.video.clientWidth > 80) ? this.video : this.videoArea;
      let videoRect = targetEl.getBoundingClientRect();
      const fullscreen = Boolean(document.fullscreenElement && document.fullscreenElement.contains(this.videoArea));

      // Cache normal in-flow video page coordinates for mini-player continuity
      if (!mini && !fullscreen && videoRect.width > 80 && videoRect.height > 50) {
        this.lastNormalVideoRect = {
          docLeft: videoRect.left + window.scrollX,
          docTop: videoRect.top + window.scrollY,
          width: videoRect.width,
          height: videoRect.height,
        };
      }

      let videoDocLeft, videoDocTop, videoLeft, videoTop, videoWidth, videoHeight;
      if (fullscreen) {
        videoDocLeft = videoRect.left;
        videoDocTop = videoRect.top;
        videoLeft = 0;
        videoTop = 0;
        videoWidth = viewportWidth;
        videoHeight = viewportHeight;
      } else if (mini && this.lastNormalVideoRect) {
        videoDocLeft = this.lastNormalVideoRect.docLeft;
        videoDocTop = this.lastNormalVideoRect.docTop;
        videoWidth = this.lastNormalVideoRect.width;
        videoHeight = this.lastNormalVideoRect.height;
        videoLeft = videoDocLeft - window.scrollX;
        videoTop = videoDocTop - window.scrollY;
      } else {
        if (videoRect.width < 1 || videoRect.height < 1) return;
        videoDocLeft = videoRect.left + window.scrollX;
        videoDocTop = videoRect.top + window.scrollY;
        videoLeft = videoRect.left;
        videoTop = videoRect.top;
        videoWidth = videoRect.width;
        videoHeight = videoRect.height;
      }

      const isDocumentMode = !fullscreen;
      this.layer.classList.toggle('is-fullscreen', fullscreen);

      if (isDocumentMode) {
        this.layer.style.width = '100%';
        this.layer.style.height = `${Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0, window.innerHeight)}px`;
        this.projectors.style.left = `${videoDocLeft}px`;
        this.projectors.style.top = `${videoDocTop}px`;
        const videoBottom = videoDocTop + videoHeight;
        document.documentElement.style.setProperty('--bili-ambient-video-bottom', `${videoBottom}px`);
      } else {
        this.layer.style.width = '100vw';
        this.layer.style.height = '100vh';
        this.projectors.style.left = `${videoLeft}px`;
        this.projectors.style.top = `${videoTop}px`;
      }
      this.projectors.style.width = `${videoWidth}px`;
      this.projectors.style.height = `${videoHeight}px`;

      this.geometry = {
        videoDocLeft,
        videoDocTop,
        videoLeft,
        videoTop,
        videoWidth,
        videoHeight,
        canvasWidth: videoWidth,
        canvasHeight: videoHeight,
        fullscreen,
      };

      this.layer.dataset.videoRect = `${videoLeft},${videoTop},${videoWidth},${videoHeight}`;

      if (this.onGeometry) this.onGeometry(videoWidth, videoHeight, this.geometry);
      this.updateHeaderScroll();
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
        if (!this.miniMode) this.layer?.classList.remove('is-hidden');
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
        if (this.onVideoChange) this.onVideoChange(this.video);
      }
      return surfaceChanged || videoChanged;
    }
  }

  api.BilibiliAdapter = BilibiliAdapter;
})(globalThis);
