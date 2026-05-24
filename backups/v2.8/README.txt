FlowWeb v2.8 — 图片节点 UI 完整实现
========================================

## 版本概述
Canvas 图片节点底部面板完整功能实现，包括比例/分辨率选择弹窗、节点主体尺寸联动、默认比例调整。

## 主要变更

### 底部面板增强
- 模型选择器右侧添加分割线
- 比例/分辨率选择按钮（图标 + 比例 · 分辨率）
- 弹出弹窗：分辨率选择（2K/4K）+ 比例网格选择（7 种比例，各带图标）
- 弹窗交互优化：选择选项不自动关闭，再次点击按钮或点击外部关闭

### 比例与主体联动
- 新节点默认比例 16:9
- 主体容器尺寸根据比例动态计算：1:1→500×500, 16:9→548×309, 9:16→281×500 等
- 按钮图标、文字与弹窗选择实时同步

### 节点主体视觉
- 空白占位：图片节点→相机 SVG 图标（72×72），视频节点→播放三角图标（64×64）
- 视频节点标题图标替换为播放三角
- 图片节点占位图标调大调浅

### 文本节点优化
- 行距从 1.7 缩小至 1.5，段落间距减小
- 底部面板最大化/还原按钮
- textarea 右边距增大，避免与最大按钮重叠

## 测试
- 全局测试：331 tests passing, 43 test files
- imageGenNode: 17 tests — 标题、预览、手柄、尺寸联动、比例默认值
- imageConfigPanel: 15 tests — PromptInput、maximize、thumbnail、divider、ratio 按钮与弹窗
- textConfigPanel: 16 tests — voice、maximize、divider、textarea padding
- videoGenNode: 18 tests — 标题图标、占位 SVG、上传、替换、尺寸
- videoConfigPanel: 10 tests — divider、maximize、model select

## 数据库备份
- database.json (690KB) — 1627 projects, 5 users, 246 media, 4 templates, 3 nodeTypes, 84 nodes, 57 edges

## 环境
- 前端 Vite: http://localhost:5173
- 后端 NestJS: http://localhost:3000
- PostgreSQL: localhost:5432
- Redis: localhost:6379
- MinIO: :9000 (API) / :9001 (Console)
