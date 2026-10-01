/** Settings panel and local preference persistence. */
(function (global) {
  'use strict';

  const api = global.BiliAmbient = global.BiliAmbient || {};
  const STORAGE_KEY = 'bili_ambient_light_settings_v5';

  const defaultSettings = Object.freeze({
    enabled: true,
    mode: 'forward',
    blur: 18,
    band: 1.00,
    layers: 12,
    displayDistance: 200,
    inertia: 120,
    dimming: 0,
    shadow: 50,
    resolution: 1.0,
  });

  function computeDropShadow(shadow) {
    const s = Number(shadow) || 0;
    if (s <= 0) return 'none';
    const l1 = `0 0 ${(s * 0.1).toFixed(1)}px rgba(0, 0, 0, 0.12)`;
    const l2 = `0 0 ${(s * 0.25).toFixed(1)}px rgba(0, 0, 0, 0.09)`;
    const l3 = `0 0 ${(s * 0.55).toFixed(1)}px rgba(0, 0, 0, 0.065)`;
    const l4 = `0 0 ${(s * 1.1).toFixed(1)}px rgba(0, 0, 0, 0.045)`;
    const l5 = `0 0 ${(s * 2.0).toFixed(1)}px rgba(0, 0, 0, 0.028)`;
    const l6 = `0 0 ${(s * 3.2).toFixed(1)}px rgba(0, 0, 0, 0.015)`;
    return `${l1}, ${l2}, ${l3}, ${l4}, ${l5}, ${l6}`;
  }

  class SettingsPanel {
    constructor(onChange) {
      api.settingsPanel?.destroy();
      api.settingsPanel = this;
      this.onChange = onChange;
      this.settings = this.load();
      this.panel = null;
      this.ctrlButton = null;
      this.mountTimer = null;
      this.mountObserver = null;
      this.uiHost = null;
      this.player = null;
      this.open = false;
      this.destroyed = false;
      this.hideTimer = null;
      this.mountFrame = null;
      this.dragging = false;
      this.buttonHovered = false;
      this.panelHovered = false;
      this.hoverOpenTimer = null;
      this.createPanel();
      this.startMountWatcher();
    }

    load() {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        const merged = { ...defaultSettings, ...saved };
        merged.blur = this.clamp(merged.blur, 0, 80, defaultSettings.blur);
        merged.band = this.clamp(merged.band, 0.05, 1.00, defaultSettings.band);
        merged.mode = saved.mode === 'mirror' ? 'mirror' : (saved.mode === 'forward' ? 'forward' : defaultSettings.mode);
        merged.layers = Math.round(this.clamp(merged.layers, 1, 12, defaultSettings.layers));
        merged.displayDistance = this.clamp(merged.displayDistance, 0, 500, defaultSettings.displayDistance);
        merged.inertia = this.clamp(merged.inertia, 0, 400, defaultSettings.inertia);
        merged.dimming = this.clamp(merged.dimming ?? merged.brightness, 0, 100, defaultSettings.dimming);
        merged.shadow = this.clamp(merged.shadow, 0, 100, defaultSettings.shadow);
        merged.resolution = 1.0;
        merged.enabled = Boolean(merged.enabled);
        return { enabled: merged.enabled, mode: merged.mode, band: merged.band,
          blur: merged.blur, layers: merged.layers, displayDistance: merged.displayDistance,
          inertia: merged.inertia, dimming: merged.dimming, shadow: merged.shadow,
          resolution: 1.0 };
      } catch {
        return { ...defaultSettings };
      }
    }

    clamp(value, min, max, fallback) {
      const number = Number(value);
      return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
    }

    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
      } catch {
        // Preferences remain active for the current page if storage is blocked.
      }
    }

    createPanel() {
      const previous = document.querySelector('.bili-ambient-panel');
      if (previous) previous.remove();

      this.panel = document.createElement('section');
      this.panel.className = 'bili-ambient-panel is-collapsed';
      this.panel.id = 'bili-ambient-settings-panel';
      this.panel.setAttribute('role', 'dialog');
      this.panel.setAttribute('aria-label', '流光氛围灯设置');
      this.panel.innerHTML = `
        <div class="bili-ambient-panel-header">
          <strong>流光氛围灯设置</strong>
          <button class="bili-ambient-close-btn" type="button" aria-label="关闭面板" title="关闭">×</button>
        </div>
        <div class="bili-ambient-mode-switch" role="group" aria-label="氛围灯模式">
          <button type="button" data-mode="forward">正向模式</button>
          <button type="button" data-mode="mirror">镜像模式</button>
        </div>
        <label class="bili-ambient-row">模糊强度
          <input type="range" min="0" max="80" step="1" data-setting="blur">
          <span data-value="blur"></span>
        </label>
        <label class="bili-ambient-row">环带比例
          <input type="range" min="0.05" max="1.00" step="0.01" data-setting="band">
          <span data-value="band"></span>
        </label>
        <label class="bili-ambient-row">外展层数
          <input type="range" min="1" max="12" step="1" data-setting="layers">
          <span data-value="layers"></span>
        </label>
        <label class="bili-ambient-row">下方显示距离
          <input type="range" min="0" max="500" step="10" data-setting="displayDistance">
          <span data-value="displayDistance"></span>
        </label>
        <label class="bili-ambient-row">过渡延迟
          <input type="range" min="0" max="400" step="20" data-setting="inertia">
          <span data-value="inertia"></span>
        </label>
        <label class="bili-ambient-row">背景暗度
          <input type="range" min="0" max="100" step="5" data-setting="dimming">
          <span data-value="dimming"></span>
        </label>
        <label class="bili-ambient-row">视频阴影
          <input type="range" min="0" max="100" step="2" data-setting="shadow">
          <span data-value="shadow"></span>
        </label>
        <div class="bili-ambient-footer">
          <button class="bili-ambient-toggle-btn" type="button" data-setting="enabled"></button>
        </div>
      `;


      const closeBtn = this.panel.querySelector('.bili-ambient-close-btn');
      if (closeBtn) {
        closeBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          this.closePanel();
        });
      }

      const power = this.panel.querySelector('[data-setting="enabled"]');
      power.addEventListener('click', () => {
        this.settings.enabled = !this.settings.enabled;
        this.syncControls();
        this.notify();
      });

      this.panel.querySelectorAll('input[data-setting]').forEach((input) => {
        const key = input.dataset.setting;
        input.value = String(this.settings[key]);
        input.addEventListener('input', () => {
          this.settings[key] = input.type === 'color' ? input.value : Number(input.value);
          this.syncControls();
          this.notify();
        });
      });
      this.panel.querySelectorAll('[data-mode]').forEach(button => {
        button.addEventListener('click', () => {
          this.settings.mode = button.dataset.mode;
          this.syncControls(); this.notify();
        });
      });
      this.panel.addEventListener('mouseenter', () => { this.panelHovered = true; this.cancelHide(); });
      this.panel.addEventListener('mouseleave', () => { this.panelHovered = false; this.scheduleHide(); });
      this.panel.addEventListener('pointerdown', event => { this.dragging = true; event.stopPropagation(); });
      this.panel.addEventListener('click', event => event.stopPropagation());
      this.panel.addEventListener('keydown', event => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          this.closePanel(); this.suppressFocusOpen = true;
          this.ctrlButton?.focus(); this.suppressFocusOpen = false;
        }
      });
      this.panel.addEventListener('focusout', event => {
        if (!this.panel.contains(event.relatedTarget) && !this.ctrlButton?.contains(event.relatedTarget)) this.scheduleHide();
      });
      this.boundPointerUp = () => { this.dragging = false; this.scheduleHide(); };
      this.boundOutsidePointer = event => {
        if (this.open && !this.panel.contains(event.target) && !this.ctrlButton?.contains(event.target)) this.closePanel();
      };
      this.boundReposition = () => this.queueMount();
      this.boundWake = () => {
        if (document.hidden) this.closePanel();
        else this.mountControlButton();
      };
      document.addEventListener('pointerup', this.boundPointerUp, true);
      document.addEventListener('pointerdown', this.boundOutsidePointer, true);
      document.addEventListener('pointercancel', this.boundPointerUp, true);
      document.addEventListener('fullscreenchange', this.boundReposition);
      document.addEventListener('visibilitychange', this.boundWake);
      global.addEventListener('resize', this.boundReposition);
      global.addEventListener('scroll', this.boundReposition, true);
      global.addEventListener('pageshow', this.boundWake);
      this.hostObserver = new ResizeObserver(this.boundReposition);
      this.syncControls();
    }

    startMountWatcher() {
      this.mountControlButton();
      this.mountTimer = global.setInterval(() => {
        if (!document.hidden) this.mountControlButton();
      }, 1000);
      this.mountObserver = new MutationObserver(mutations => {
        const external = mutations.some(m => {
          const target = m.target.nodeType === 1 ? m.target : m.target.parentElement;
          return target && !this.panel.contains(target) && !this.ctrlButton?.contains(target) &&
            !this.uiHost?.contains(target) && !target.closest?.('.bili-ambient-page-layer');
        });
        if (external) this.queueMount();
      });
      // The document survives a player/control-bar replacement; the old player does not.
      this.mountObserver.observe(document.documentElement, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['data-screen'],
      });
    }

    queueMount() {
      if (this.destroyed || this.mountFrame !== null) return;
      this.mountFrame = global.requestAnimationFrame(() => {
        this.mountFrame = null;
        if (!this.destroyed) this.mountControlButton();
      });
    }

    findControlTarget() {
      const roots = [...document.querySelectorAll('.bpx-player-container, #bilibili-player')]
        .filter(root => root.classList.contains('bpx-player-container') || !root.querySelector('.bpx-player-container'));
      roots.sort((a, b) => {
        const ap = a.id === 'bilibili-player' || Boolean(a.closest('#bilibili-player'));
        const bp = b.id === 'bilibili-player' || Boolean(b.closest('#bilibili-player'));
        if (ap !== bp) return Number(bp) - Number(ap);
        const av = Boolean(a.querySelector('video')), bv = Boolean(b.querySelector('video'));
        if (av !== bv) return Number(bv) - Number(av);
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return rb.width * rb.height - ra.width * ra.height;
      });
      for (const player of roots) {
        const rect = player.getBoundingClientRect();
        if (!player.isConnected || rect.width < 1 || rect.height < 1) continue;
        const playerStyle = getComputedStyle(player);
        if (playerStyle.visibility === 'hidden' || playerStyle.opacity === '0') continue;
        const candidates = ['.bpx-player-ctrl-setting', '.bpx-player-ctrl-web',
          '.bpx-player-control-bottom-right', '.bpx-player-ctrl-volume']
          .flatMap(selector => [...player.querySelectorAll(selector)]).filter(element => element.parentElement);
        // Retired control bars can remain connected but have display:none.
        // Hover-hidden native controls still have a nonzero layout rectangle.
        const laidOut = element => { const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const anchor = candidates.find(element => laidOut(element) && getComputedStyle(element).visibility !== 'hidden')
          || candidates.find(laidOut) || candidates[0];
        if (!anchor?.parentElement) continue;
        const fs = document.fullscreenElement;
        const host = fs && fs.tagName !== 'VIDEO' && (fs.contains(player) || player.contains(fs)) ? fs : player;
        return { player, anchor, host };
      }
      return null;
    }

    restoreHostPosition() {
      if (this.positionedHost && this.positionedHost.style.position === 'relative') {
        this.positionedHost.style.position = this.previousHostPosition;
      }
      this.positionedHost = null;
    }

    mountControlButton() {
      if (this.destroyed) return false;
      const target = this.findControlTarget();
      if (!target) { this.closePanel(); return false; }
      const { player, anchor, host } = target;
      if (!this.ctrlButton) {
        this.ctrlButton = document.createElement('div');
        this.ctrlButton.className = 'bpx-player-ctrl-btn bpx-player-ctrl-ambient';
        this.ctrlButton.setAttribute('role', 'button');
        this.ctrlButton.setAttribute('aria-label', '氛围光设置');
        this.ctrlButton.setAttribute('tabindex', '0');
        this.ctrlButton.setAttribute('aria-haspopup', 'dialog');
        this.ctrlButton.setAttribute('aria-controls', this.panel.id);
        this.ctrlButton.setAttribute('aria-expanded', 'false');
        this.ctrlButton.innerHTML = `
          <div class="bpx-player-ctrl-btn-icon">
            <span class="bpx-common-svg-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" preserveAspectRatio="xMidYMid meet" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="5.5" y="6.5" width="13" height="9.5" rx="1.5" />
                <path d="M9.5 19.5h5" />
                <path d="M12 16v3.5" />
                <path d="M2.2 9c-.6 1.4-.6 3 0 4.4" />
                <path d="M21.8 9c.6 1.4.6 3 0 4.4" />
                <path d="M8.5 3.2c2.2-.6 4.8-.6 7 0" />
              </svg>
            </span>
          </div>
        `;
        this.ctrlButton.addEventListener('mouseenter', () => {
          this.buttonHovered = true;
          this.cancelHide();
          this.scheduleHoverOpen(280);
        });
        this.ctrlButton.addEventListener('mouseleave', () => {
          this.buttonHovered = false;
          this.cancelHoverOpen();
          this.scheduleHide();
        });
        this.ctrlButton.addEventListener('focus', () => {
          if (!this.suppressFocusOpen) {
            this.cancelHoverOpen();
            this.openPanel();
          }
        });
        this.ctrlButton.addEventListener('focusout', event => {
          if (!this.panel.contains(event.relatedTarget)) {
            this.cancelHoverOpen();
            this.scheduleHide();
          }
        });
        this.ctrlButton.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault(); event.stopPropagation();
            this.cancelHoverOpen();
            this.openPanel();
            this.panel.querySelector('[data-setting="enabled"]').focus();
          } else if (event.key === 'Escape') {
            event.stopPropagation();
            this.cancelHoverOpen();
            this.closePanel();
          }
        });
        this.ctrlButton.addEventListener('click', event => {
          event.stopPropagation();
          this.cancelHoverOpen();
          this.openPanel();
        });
        this.syncControls();
      }
      // Remove stale copies left by an earlier player instance or script instance.
      document.querySelectorAll('.bpx-player-ctrl-ambient').forEach(button => {
        if (button !== this.ctrlButton) button.remove();
      });
      const bar = anchor.classList.contains('bpx-player-control-bottom-right') ? anchor : anchor.parentElement;
      if (this.ctrlButton.parentElement !== bar || (anchor !== bar && anchor.nextElementSibling !== this.ctrlButton)) {
        if (anchor === bar) bar.appendChild(this.ctrlButton);
        else anchor.after(this.ctrlButton);
      }
      if (!this.uiHost) {
        this.uiHost = document.createElement('div');
        this.uiHost.className = 'bili-ambient-ui-host';
      }
      if (this.uiHost.parentElement !== host) {
        this.closePanel(); this.restoreHostPosition();
        if (getComputedStyle(host).position === 'static') {
          this.positionedHost = host; this.previousHostPosition = host.style.position;
          host.style.position = 'relative';
        }
        host.appendChild(this.uiHost);
        this.hostObserver.disconnect();
        this.hostObserver.observe(host);
        this.hostObserver.observe(this.ctrlButton);
      }
      if (this.panel.parentElement !== this.uiHost) this.uiHost.appendChild(this.panel);
      this.player = player;
      // The switch controls the light, never the launcher's availability.
      this.ctrlButton.classList.remove('is-disabled', 'disabled');
      this.ctrlButton.removeAttribute('disabled');
      this.ctrlButton.removeAttribute('aria-disabled');
      if (this.open) this.positionPanel();
      return true;
    }

    positionPanel() {
      if (!this.uiHost?.isConnected || !this.ctrlButton?.isConnected) return;
      const host = this.uiHost.getBoundingClientRect(), button = this.ctrlButton.getBoundingClientRect();
      const width = this.uiHost.clientWidth || host.width, height = this.uiHost.clientHeight || host.height;
      if (!width || !height) return;
      this.panel.style.width = `${Math.max(1, Math.min(320, width - 16))}px`;
      this.panel.style.maxHeight = `${Math.max(1, height - 16)}px`;
      const panelWidth = this.panel.offsetWidth, panelHeight = this.panel.offsetHeight;
      const buttonCenterX = button.width ? (button.left + button.width / 2 - host.left) * width / host.width : width / 2;
      const top = button.height ? (button.top - host.top) * height / host.height : height - 48;
      const left = buttonCenterX - panelWidth / 2;
      this.panel.style.left = `${Math.max(8, Math.min(width - panelWidth - 8, left))}px`;
      this.panel.style.top = `${Math.max(8, Math.min(height - panelHeight - 8, top - panelHeight - 10))}px`;
    }

    cancelHide() {
      if (this.hideTimer !== null) global.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    cancelHoverOpen() {
      if (this.hoverOpenTimer !== null) global.clearTimeout(this.hoverOpenTimer);
      this.hoverOpenTimer = null;
    }

    scheduleHoverOpen(delay = 280) {
      this.cancelHoverOpen();
      this.hoverOpenTimer = global.setTimeout(() => {
        this.hoverOpenTimer = null;
        if (this.buttonHovered && !this.open && !this.destroyed) {
          this.openPanel();
        }
      }, delay);
    }

    scheduleHide() {
      this.cancelHide();
      if (!this.open || this.dragging || this.buttonHovered || this.panelHovered) return;
      this.hideTimer = global.setTimeout(() => {
        this.hideTimer = null;
        if (!this.dragging && !this.buttonHovered && !this.panelHovered) this.closePanel();
      }, 280);
    }

    openPanel() {
      this.cancelHoverOpen();
      if (!this.mountControlButton()) return;
      this.cancelHide(); this.open = true;
      this.panel.classList.remove('is-collapsed');
      this.ctrlButton.setAttribute('aria-expanded', 'true');
      this.positionPanel();
    }

    closePanel() {
      this.cancelHoverOpen();
      this.cancelHide(); this.open = false; this.dragging = false;
      this.buttonHovered = this.panelHovered = false;
      this.panel?.classList.add('is-collapsed');
      this.ctrlButton?.setAttribute('aria-expanded', 'false');
    }

    syncControls() {
      if (this.panel) {
        const power = this.panel.querySelector('[data-setting="enabled"]');
        if (power) {
          power.textContent = this.settings.enabled ? '关闭氛围灯' : '开启氛围灯';
          power.setAttribute('aria-pressed', String(this.settings.enabled));
          power.classList.toggle('bili-ambient-is-off', !this.settings.enabled);
        }
        const blurValue = this.panel.querySelector('[data-value="blur"]');
        if (blurValue) blurValue.textContent = `${Math.round(this.settings.blur)}px`;
        const bandValue = this.panel.querySelector('[data-value="band"]');
        if (bandValue) bandValue.textContent = `${Math.round(this.settings.band * 100)}%`;
        const layersValue = this.panel.querySelector('[data-value="layers"]');
        if (layersValue) layersValue.textContent = `${this.settings.layers}层`;
        const distanceValue = this.panel.querySelector('[data-value="displayDistance"]');
        if (distanceValue) distanceValue.textContent = `${Math.round(this.settings.displayDistance)}px`;
        const inertiaValue = this.panel.querySelector('[data-value="inertia"]');
        if (inertiaValue) inertiaValue.textContent = this.settings.inertia > 0 ? `${Math.round(this.settings.inertia)}ms` : '0ms';
        const dimmingValue = this.panel.querySelector('[data-value="dimming"]');
        if (dimmingValue) dimmingValue.textContent = `${Math.round(this.settings.dimming || 0)}%`;
        const shadowValue = this.panel.querySelector('[data-value="shadow"]');
        if (shadowValue) shadowValue.textContent = `${Math.round(this.settings.shadow || 0)}px`;
        this.panel.querySelectorAll('[data-mode]').forEach(button => {
          button.classList.toggle('is-active', button.dataset.mode === this.settings.mode);
          button.setAttribute('aria-pressed', String(button.dataset.mode === this.settings.mode));
        });
      }

      if (this.ctrlButton) {
        this.ctrlButton.classList.toggle('bili-ambient-is-on', this.settings.enabled);
        this.ctrlButton.classList.toggle('bili-ambient-is-off', !this.settings.enabled);
        this.ctrlButton.removeAttribute('aria-pressed');
      }

      if (typeof document !== 'undefined' && document.documentElement?.style) {
        const shadowVal = Number(this.settings?.shadow) || 0;
        if (shadowVal > 0 && typeof document.documentElement.style.setProperty === 'function') {
          document.documentElement.style.setProperty('--bili-ambient-shadow', computeDropShadow(shadowVal));
        } else if (typeof document.documentElement.style.removeProperty === 'function') {
          document.documentElement.style.removeProperty('--bili-ambient-shadow');
        } else if (document.documentElement.style) {
          delete document.documentElement.style['--bili-ambient-shadow'];
        }
      }
    }

    toggleVisibility() { this.open ? this.closePanel() : this.openPanel(); }

    notify() {
      this.save();
      try { this.onChange?.({ ...this.settings }); }
      catch (error) { console.error('[AmbientLight] Settings application failed; controls remain available.', error); }
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true; this.closePanel();
      document.removeEventListener('pointerup', this.boundPointerUp, true);
      document.removeEventListener('pointerdown', this.boundOutsidePointer, true);
      document.removeEventListener('pointercancel', this.boundPointerUp, true);
      document.removeEventListener('fullscreenchange', this.boundReposition);
      document.removeEventListener('visibilitychange', this.boundWake);
      global.removeEventListener('resize', this.boundReposition);
      global.removeEventListener('scroll', this.boundReposition, true);
      global.removeEventListener('pageshow', this.boundWake);
      if (this.mountTimer !== null) global.clearInterval(this.mountTimer);
      if (this.mountFrame !== null) global.cancelAnimationFrame(this.mountFrame);
      this.mountObserver?.disconnect(); this.hostObserver?.disconnect();
      this.panel?.remove(); this.ctrlButton?.remove(); this.uiHost?.remove();
      this.restoreHostPosition();
      this.mountTimer = this.mountFrame = null;
      if (api.settingsPanel === this) api.settingsPanel = null;
    }

  }

  api.defaultSettings = defaultSettings;
  api.computeDropShadow = computeDropShadow;
  api.SettingsPanel = SettingsPanel;
})(globalThis);
