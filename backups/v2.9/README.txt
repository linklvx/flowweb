FlowWeb v2.9 — 音频节点前端完整实现
========================================

## 版本概述
Canvas 新增音频节点（audioGen），包括节点主体、底部面板、节点面板入口，全面复刻文本节点 + 视频/图片节点交互模式。

## 主要变更

### 音频节点主体 (AudioGenNode)
- 固定尺寸 380×170px 矩形
- 可编辑标题（默认 "Audio"，音乐音符 SVG 图标）
- 悬浮上传按钮（接受 audio/*，仅选中时显示）
- 替换按钮（用户上传音频时右上角 hover 显示，AI 生成不显示）
- Audio 元素预览（有文件时显示 controls）
- 空白占位：音乐音符 SVG（48×48，opacity 0.35）
- Socket.io 实时状态更新（loading → done/error）
- Handle 颜色：绿色 #4ade80

### 音频底部面板 (AudioConfigPanel)
- 复刻 TextConfigPanel 架构（无缩略图上传）
- 模型选择器 → /api/node-types/audio/models
- Textarea 提示词输入
- 语音输入 + 积分显示 + 执行按钮
- 最大化/还原按钮（140px ↔ 350px）

### 视频节点增强（本版本累计）
- Socket.io 实时状态更新
- ratioDimensions 尺寸计算（16:9 → 548×309）
- 类型守卫（非 videoGen 节点返回 null）
- 配置按钮：比例图标 + 比例 · 清晰度 · 时长 + 音量 SVG
- 弹窗：清晰度(1080p/4K) + 比例(7种) + 时长(5s/10s/15s) + 声音(开/关)
- 音量图标切换：开→VolumeUp，关→VolumeMute(删除线)

### 节点面板
- NodePalette 新增音频生成选项（🎵 音频生成, 绿色 #4ade80）
- canvasStore nodeTypeMap 新增 audio → audioGen 映射
- CanvasView nodeTypes 注册 AudioGenNode
- nodeStore 新增 AudioNodeData 类型

## 类型系统
- AudioNodeData: { model, content, status, fileId?, referenceAudio? }
- NodeData union 新增 AudioNodeData

## 测试
- 全局测试：381 tests passing, 45 test files
- AudioGenNode: 18 tests — 标题、固定尺寸、占位、音频元素、上传、替换、Socket.io
- AudioConfigPanel: 13 tests — textarea、模型选择、最大化、语音、积分、类型守卫、无缩略图
- VideoGenNode: 25 tests — 新增 socket.io(6)、ratioDimensions(1)
- VideoConfigPanel: 22 tests — 新增类型守卫(1)、配置按钮+弹窗(9)、音量图标(2)

## 数据库备份
- database.json (705KB) — 1675 projects, 5 users, 247 media, 4 templates, 3 nodeTypes, 84 nodes, 57 edges

## 环境
- 前端 Vite: http://localhost:5173
- 后端 NestJS: http://localhost:3000
- PostgreSQL: localhost:5432
- Redis: localhost:6379
- MinIO: :9000 (API) / :9001 (Console)
