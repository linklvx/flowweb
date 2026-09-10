# opencut-classic vendor 快照

- 来源: https://github.com/OpenCut-app/opencut-classic
- commit: cf5e79e919144200294fb9fed22a222592a0aeea
- 许可证: MIT（见本目录 LICENSE）
- 引入日期: 2026-09-10
- 用途: 视频剪辑器参考代码（只读，不参与构建）。移植清单:
  - apps/web/src/timeline/ —— 时间轴交互（drag-utils/snapping/group-move/track-capabilities）
  - apps/web/src/services/renderer/ —— scene-builder/canvas-renderer/scene-exporter(mediabunny 171 行)
  - apps/web/src/services/video-cache/ —— LRU 帧缓存设计
- 移植注意: 原库 React19/zustand5/Tailwind4，移植时适配本项目 React18/zustand4/antd5
