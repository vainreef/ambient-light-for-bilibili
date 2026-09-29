# Ambient Light for Bilibili

为哔哩哔哩（Bilibili）视频提供硬件级 WebGL 沉浸式流光氛围灯效果的浏览器扩展。

基于 YouTube Ambilight 的着色器内核重构，专为 B 站播放器架构做针对性适配。

---

## 核心特性

- **硬件级 WebGL 渲染管线**：避免传统扩展使用 CSS `filter: blur(...)` 导致的 GPU 显存带宽暴涨与发热掉帧，以极低功耗在显卡片元着色器中完成多重采样模糊。
- **逐帧精准同步**：使用 `video.requestVideoFrameCallback` API，直接对齐解码器渲染帧率，不空转、不丢帧。
- **去色带噪点抖动（Debanding / Dithering）**：在着色器层混入微量随机高频噪点，消除暗部光晕容易出现的色阶断层。
- **动态黑边自适应裁剪（Bar Detection）**：实时检测带黑边的宽荧幕视频，裁剪无效黑边后再投射，防止四周出现发黑死区。
- **自适应多种播放形态**：自动贴合 B 站普通窗口、宽屏模式、网页全屏与系统全屏。
- **轻量设置面板**：无需打开扩展独立后台页面，快捷键 `Alt + A` 即可调出悬浮控制浮窗，实时调节扩散范围、模糊核半径、亮度与色彩饱和度。

---

## B 站架构适配要点

B 站现代播放器组件层级较深，存在一个关键的样式限制：

```text
#playerWrap
 └─ #bilibili-player
     └─ .bpx-docker-major
         └─ .bpx-player-container
             └─ .bpx-player-primary-area
                 └─ .bpx-player-video-area (overflow: hidden; 背景为 rgb(0,0,0))
```

若将氛围灯直接挂载在视频同级，向外扩散的光晕会被 `.bpx-player-video-area` 的 `overflow: hidden` 裁切成死板方块。

本项目通过将容器挂载至 `.bpx-player-container` 首节点（`z-index: 0`），利用视频区域自身的天然遮挡，使光晕柔和漫射至网页背景与上层信息栏，同时完全不遮挡原有的弹幕渲染层（`z-index: 11`）与播放控制栏（`z-index: 75`）。

---

## 安装与使用

### 开发者模式加载

1. 克隆或下载本项目至本地；
2. 打开 Chrome / Edge 等 Chromium 浏览器，进入扩展管理页 `chrome://extensions/`；
3. 打开右上角「开发者模式」；
4. 点击「加载已解压的扩展程序」，选择当前项目根目录即可。

### 快捷键

- 在 B 站视频播放页面按下 `Alt + A`，即可调出或收起氛围灯浮动控制面板。

---

## 协议与致谢

- 核心着色器思路与黑边检测借鉴自开源项目 [youtube-ambilight](https://github.com/WesselKroos/youtube-ambilight) (MIT License)。
- 本项目遵循 MIT 协议。
