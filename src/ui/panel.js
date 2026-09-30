/** Settings panel and local preference persistence. */
(function (global) {
  'use strict';

  const api = global.BiliAmbient = global.BiliAmbient || {};
  const STORAGE_KEY = 'bili_ambient_light_settings_v4';

  const defaultSettings = Object.freeze({
    enabled: true,
    blur: 1.0,
    band: 0.06,
    inertia: 140,
    resolution: 1.0,
  });

  class SettingsPanel {
    constructor(onChange) {
      this.onChange = onChange;
      this.settings = this.load();
      this.panel = null;
      this.ctrlButton = null;
      this.createPanel();
      this.mountControlButton();
    }

    load() {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        const merged = { ...defaultSettings, ...saved };
        merged.blur = this.clamp(merged.blur, 0, 3, defaultSettings.blur);
        merged.band = this.clamp(merged.band, 0.01, 0.50, defaultSettings.band);
        merged.inertia = this.clamp(merged.inertia, 0, 500, defaultSettings.inertia);
        merged.resolution = this.clamp(merged.resolution, 0.5, 2.0, defaultSettings.resolution);
        merged.enabled = Boolean(merged.enabled);
        return merged;
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
      this.panel.setAttribute('aria-label', '流光氛围灯设置');
      this.panel.innerHTML = `
        <div class="bili-ambient-panel-header">
          <strong>流光氛围灯设置</strong>
          <div class="bili-ambient-header-actions">
            <button class="bili-ambient-toggle-btn" type="button" data-setting="enabled"></button>
            <button class="bili-ambient-close-btn" type="button" aria-label="关闭面板" title="关闭">×</button>
          </div>
        </div>
        <label class="bili-ambient-row">渲染分辨率
          <input type="range" min="0.5" max="2.0" step="0.25" data-setting="resolution">
          <span data-value="resolution"></span>
        </label>
        <label class="bili-ambient-row">模糊强度
          <input type="range" min="0" max="3" step="0.1" data-setting="blur">
          <span data-value="blur"></span>
        </label>
        <label class="bili-ambient-row">环带宽度
          <input type="range" min="0.01" max="0.50" step="0.01" data-setting="band">
          <span data-value="band"></span>
        </label>
        <label class="bili-ambient-row">过渡惯性
          <input type="range" min="0" max="400" step="20" data-setting="inertia">
          <span data-value="inertia"></span>
        </label>
      `;
      document.body.appendChild(this.panel);

      const closeBtn = this.panel.querySelector('.bili-ambient-close-btn');
      if (closeBtn) {
        closeBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          this.panel.classList.add('is-collapsed');
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
          this.settings[key] = Number(input.value);
          this.syncControls();
          this.notify();
        });
      });
      this.syncControls();
    }

    mountControlButton() {
      if (this.ctrlButton && this.ctrlButton.isConnected) return;
      const settingBtn = document.querySelector('.bpx-player-ctrl-setting');
      if (!settingBtn || !settingBtn.parentNode) return;

      if (!this.ctrlButton) {
        this.ctrlButton = document.createElement('div');
        this.ctrlButton.className = 'bpx-player-ctrl-btn bpx-player-ctrl-ambient';
        this.ctrlButton.setAttribute('role', 'button');
        this.ctrlButton.setAttribute('aria-label', '氛围光设置');
        this.ctrlButton.setAttribute('tabindex', '0');
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
          <div class="bili-ambient-btn-tooltip">氛围光设置</div>
        `;
        this.ctrlButton.addEventListener('click', (event) => {
          event.stopPropagation();
          this.toggleVisibility();
        });
      }

      settingBtn.after(this.ctrlButton);
      this.syncControls();
    }

    syncControls() {
      if (this.panel) {
        const power = this.panel.querySelector('[data-setting="enabled"]');
        if (power) {
          power.textContent = this.settings.enabled ? '已开启' : '已关闭';
          power.setAttribute('aria-pressed', String(this.settings.enabled));
          power.classList.toggle('is-disabled', !this.settings.enabled);
        }
        const resValue = this.panel.querySelector('[data-value="resolution"]');
        if (resValue) resValue.textContent = `${Math.round((this.settings.resolution ?? 1.0) * 100)}%`;
        const blurValue = this.panel.querySelector('[data-value="blur"]');
        if (blurValue) blurValue.textContent = `×${this.settings.blur.toFixed(1)}`;
        const bandValue = this.panel.querySelector('[data-value="band"]');
        if (bandValue) bandValue.textContent = `${Math.round(this.settings.band * 100)}%`;
        const inertiaValue = this.panel.querySelector('[data-value="inertia"]');
        if (inertiaValue) inertiaValue.textContent = this.settings.inertia > 0 ? `${this.settings.inertia}ms` : '关闭';
      }

      if (this.ctrlButton) {
        this.ctrlButton.classList.toggle('is-active', this.settings.enabled);
        this.ctrlButton.classList.toggle('is-disabled', !this.settings.enabled);
        this.ctrlButton.setAttribute('aria-pressed', String(this.settings.enabled));
      }
    }

    toggleVisibility() {
      if (this.panel) this.panel.classList.toggle('is-collapsed');
    }

    notify() {
      this.save();
      if (this.onChange) this.onChange({ ...this.settings });
    }

    destroy() {
      if (this.panel) this.panel.remove();
      if (this.ctrlButton) this.ctrlButton.remove();
      this.panel = null;
      this.ctrlButton = null;
    }
  }

  api.defaultSettings = defaultSettings;
  api.SettingsPanel = SettingsPanel;
})(globalThis);
