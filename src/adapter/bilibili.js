/**
 * Bilibili 播放器专属 DOM 挂载与尺寸适配器
 */

export class BilibiliAdapter {
  constructor() {
    this.container = null;
    this.videoArea = null;
    this.video = null;
    this.wrapper = null;
    this.canvas = null;
    this.resizeObserver = null;
    this.onResizeCallback = null;
  }

  /**
   * 探测并等待 B 站播放器与视频节点渲染
   */
  async waitForPlayer(timeout = 15000) {
    const startTime = performance.now();
    while (performance.now() - startTime < timeout) {
      const container = document.querySelector('.bpx-player-container') || document.querySelector('#bilibili-player');
      const video = document.querySelector('video');
      const videoArea = document.querySelector('.bpx-player-video-area');

      if (container && video && videoArea) {
        this.container = container;
        this.video = video;
        this.videoArea = videoArea;
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    return false;
  }

  /**
   * 挂载氛围灯包装层到容器底层
   */
  mount(onResize) {
    this.onResizeCallback = onResize;

    // 清理可能存在的残留
    const existing = document.querySelector('.bili-ambient-wrapper');
    if (existing) existing.remove();

    this.wrapper = document.createElement('div');
    this.wrapper.className = 'bili-ambient-wrapper';

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'bili-ambient-canvas';
    this.wrapper.appendChild(this.canvas);

    // 关键挂载逻辑：挂载到 .bpx-player-container 首节点，避开 video-area 的 overflow: hidden 裁切
    this.container.prepend(this.wrapper);

    // 尺寸监听：使用 ResizeObserver 跟踪视频区域的变化
    this.resizeObserver = new ResizeObserver(() => {
      this.syncSize();
    });
    this.resizeObserver.observe(this.videoArea);

    this.syncSize();
    return { wrapper: this.wrapper, canvas: this.canvas, video: this.video };
  }

  /**
   * 同步当前尺寸并调整扩散比例
   */
  syncSize() {
    if (!this.videoArea || !this.canvas) return;

    const rect = this.videoArea.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);

    if (width === 0 || height === 0) return;

    // 内部渲染缓冲分辨率（低分辨率保障超高性能）
    const renderWidth = Math.min(320, Math.round(width / 3));
    const renderHeight = Math.min(180, Math.round(height / 3));

    if (this.onResizeCallback) {
      this.onResizeCallback(renderWidth, renderHeight);
    }
  }

  /**
   * 检查视频元素是否被单页路由切换重新创建
   */
  checkVideoRefresh() {
    const currentVideo = document.querySelector('video');
    if (currentVideo && currentVideo !== this.video) {
      this.video = currentVideo;
      return true;
    }
    return false;
  }

  destroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.wrapper) {
      this.wrapper.remove();
    }
  }
}
