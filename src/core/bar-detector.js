/**
 * 视频黑边/彩边自动检测器
 * 通过低频读取边缘像素均值，动态裁剪掉无内容黑边，避免氛围灯投射出黑框
 */

export class BarDetector {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 64;
    this.canvas.height = 36;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.lastCheck = 0;
    this.interval = 1000; // 每秒检测一次黑边
    this.crop = [0, 0, 0, 0]; // 归一化裁剪值：[left, top, right, bottom]
  }

  detect(video) {
    const now = performance.now();
    if (now - this.lastCheck < this.interval || !video || video.readyState < 2) {
      return this.crop;
    }
    this.lastCheck = now;

    const w = this.canvas.width;
    const h = this.canvas.height;
    this.ctx.drawImage(video, 0, 0, w, h);

    const imgData = this.ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    const threshold = 18; // 亮度阈值
    const isDark = (idx) => {
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      return (r * 0.299 + g * 0.587 + b * 0.114) < threshold;
    };

    // 检测顶部黑边
    let topBars = 0;
    for (let y = 0; y < h / 3; y++) {
      let allDark = true;
      for (let x = 0; x < w; x += 4) {
        const idx = (y * w + x) * 4;
        if (!isDark(idx)) {
          allDark = false;
          break;
        }
      }
      if (allDark) topBars++;
      else break;
    }

    // 检测底部黑边
    let bottomBars = 0;
    for (let y = h - 1; y > (h * 2) / 3; y--) {
      let allDark = true;
      for (let x = 0; x < w; x += 4) {
        const idx = (y * w + x) * 4;
        if (!isDark(idx)) {
          allDark = false;
          break;
        }
      }
      if (allDark) bottomBars++;
      else break;
    }

    const normTop = Math.min(0.35, topBars / h);
    const normBottom = Math.min(0.35, bottomBars / h);

    // 平滑过渡
    this.crop[1] = this.crop[1] * 0.7 + normTop * 0.3;
    this.crop[3] = this.crop[3] * 0.7 + normBottom * 0.3;

    return this.crop;
  }
}
