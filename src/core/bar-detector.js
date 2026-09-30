/** Detects horizontal letterboxing without treating a few dark scene pixels as bars. */
(function (global) {
  'use strict';

  const api = global.BiliAmbient = global.BiliAmbient || {};

  class BarDetector {
    constructor() {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 64;
      this.canvas.height = 36;
      this.context = this.canvas.getContext('2d', { willReadFrequently: true });
      this.lastCheck = 0;
      this.interval = 1000;
      this.crop = [0, 0, 0, 0];
    }

    detect(video) {
      const now = performance.now();
      if (now - this.lastCheck < this.interval || !video || video.readyState < 2 || !this.context) {
        return this.crop;
      }
      this.lastCheck = now;

      let pixels;
      try {
        this.context.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
        pixels = this.context.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
      } catch {
        // If a CDN frame is temporarily not readable, keep the previous crop.
        return this.crop;
      }

      const width = this.canvas.width;
      const height = this.canvas.height;
      const darkRatio = (y) => {
        let darkPixels = 0;
        for (let x = 0; x < width; x += 2) {
          const index = (y * width + x) * 4;
          const luma = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
          if (luma < 20) darkPixels++;
        }
        return darkPixels / Math.ceil(width / 2);
      };

      const scan = (start, end, step) => {
        let rows = 0;
        for (let y = start; step > 0 ? y < end : y > end; y += step) {
          // A genuine letterbox is near-uniform across almost the entire row.
          if (darkRatio(y) < 0.985) break;
          rows++;
        }
        return rows >= 2 ? rows / height : 0;
      };

      const nextTop = Math.min(0.32, scan(0, Math.floor(height * 0.34), 1));
      const nextBottom = Math.min(0.32, scan(height - 1, Math.ceil(height * 0.66), -1));
      const hasLetterbox = nextTop >= 0.03 && nextBottom >= 0.03;
      const barY = hasLetterbox ? Math.min(nextTop, nextBottom) : 0;
      const smoothY = this.crop[1] * 0.65 + barY * 0.35;
      this.crop[1] = smoothY;
      this.crop[3] = smoothY;
      return this.crop;
    }
  }

  api.BarDetector = BarDetector;
})(globalThis);
