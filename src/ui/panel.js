/**
 * 极简悬浮设置面板与配置存储
 */

const STORAGE_KEY = 'bili_ambient_light_settings';

export const defaultSettings = {
  enabled: true,
  spread: 1.25,     // 扩散比例
  blurRadius: 18.0, // WebGL 模糊核半径
  brightness: 1.15, // 亮度增强
  saturation: 1.4,  // 饱和度增强
  opacity: 0.85,    // 不透明度
};

export class SettingsPanel {
  constructor(onChange) {
    this.onChange = onChange;
    this.settings = this.load();
    this.panelElem = null;
    this.initPanel();
    this.initShortcuts();
  }

  load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? { ...defaultSettings, ...JSON.parse(saved) } : { ...defaultSettings };
    } catch {
      return { ...defaultSettings };
    }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {}
  }

  initPanel() {
    const existing = document.querySelector('.bili-ambient-panel');
    if (existing) existing.remove();

    this.panelElem = document.createElement('div');
    this.panelElem.className = 'bili-ambient-panel is-collapsed';
    this.panelElem.innerHTML = `
      <div class="bili-ambient-panel-header">
        <span>流光氛围灯设置</span>
        <button class="bili-ambient-toggle-btn" id="bili-ambient-power">
          ${this.settings.enabled ? '已开启' : '已关闭'}
        </button>
      </div>
      <div class="bili-ambient-row">
        <label>扩散范围</label>
        <input type="range" id="bili-ambient-spread" min="1.0" max="1.6" step="0.05" value="${this.settings.spread}">
      </div>
      <div class="bili-ambient-row">
        <label>模糊半径</label>
        <input type="range" id="bili-ambient-blur" min="4" max="40" step="2" value="${this.settings.blurRadius}">
      </div>
      <div class="bili-ambient-row">
        <label>发光亮度</label>
        <input type="range" id="bili-ambient-brightness" min="0.5" max="2.0" step="0.05" value="${this.settings.brightness}">
      </div>
      <div class="bili-ambient-row">
        <label>色彩饱和度</label>
        <input type="range" id="bili-ambient-saturation" min="0.5" max="2.5" step="0.1" value="${this.settings.saturation}">
      </div>
      <div style="font-size: 11px; color: #777; margin-top: 8px; text-align: center;">
        快捷键 Alt + A 显示/收起面板
      </div>
    `;

    document.body.appendChild(this.panelElem);
    this.bindEvents();
  }

  bindEvents() {
    const powerBtn = this.panelElem.querySelector('#bili-ambient-power');
    powerBtn.addEventListener('click', () => {
      this.settings.enabled = !this.settings.enabled;
      powerBtn.textContent = this.settings.enabled ? '已开启' : '已关闭';
      powerBtn.style.background = this.settings.enabled ? '#00aeec' : '#555';
      this.notify();
    });

    const bindRange = (id, key) => {
      const input = this.panelElem.querySelector(`#${id}`);
      input.addEventListener('input', (e) => {
        this.settings[key] = parseFloat(e.target.value);
        this.notify();
      });
    };

    bindRange('bili-ambient-spread', 'spread');
    bindRange('bili-ambient-blur', 'blurRadius');
    bindRange('bili-ambient-brightness', 'brightness');
    bindRange('bili-ambient-saturation', 'saturation');
  }

  initShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'a' || e.key === 'A')) {
        this.toggleVisibility();
      }
    });
  }

  toggleVisibility() {
    if (this.panelElem) {
      this.panelElem.classList.toggle('is-collapsed');
    }
  }

  notify() {
    this.save();
    if (this.onChange) {
      this.onChange(this.settings);
    }
  }
}
