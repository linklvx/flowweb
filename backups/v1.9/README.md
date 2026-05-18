# v1.9 Backup

**日期**: 2026-05-19
**版本**: v1.9
**基础**: v1.8 (Tiptap WYSIWYG rich text editor)

## 新增功能

### 点击添加节点
- 点击面板节点类型 → 添加到画布视口中心
- 拖拽添加功能保留
- 使用 canvasStore.viewport 计算画布坐标

### Ctrl/Cmd + 滚轮缩放
- Ctrl+滚轮 (Win/Linux) / Cmd+滚轮 (Mac) → 缩放画布
- 普通滚轮 → 平移画布
- Capture 阶段拦截，ReactFlow panOnScroll + noWheelClassName

### 编辑器滚轮优化
- 编辑器区域滚轮 → 滚动内容（不被画布拦截）
- ReactFlow noWheelClassName="nowheel"

### 连线删除按钮优化
- 仅在连线选中时显示 × 删除按钮
- 防止误触删除

### 语音输入（Web Speech API）
- 浏览器原生语音识别（Chrome/Edge/Safari）
- 麦克风按钮 → 实时语音转文字填入输入框
- zh-CN 中文识别，continuous + interim results
- addEventListener + promptRef 防止重复文本

### 模型选择器重构
- 原生 select → AI sparkle 图标按钮 + 下拉菜单
- 选中项 bg-white/10 底色标识
- stopPropagation 修复选项切换

### UI 细节
- 语音按钮与积分位置互换 + 分割线
- 积分显示：⚡闪电图标 + 数字
- 间距 gap-2 → gap-3

## 测试状态
- Web: 181 tests passed (34 files)
- 全部通过 ✅

## 数据库快照
| 表 | 行数 |
|----|------|
| Users | 5 |
| Accounts | 3 |
| Sessions | 94 |
| Announcements | 1 |
| ContentCards | 8 |
| Templates | 4 |
| CanvasProjects | 668 |
| CanvasNodes | 84 |
| CanvasEdges | 57 |
| NodeTypes | 3 |
| AIModels | 6 |
| ModelResolutions | 7 |
| ModelDurations | 3 |
| PricingRules | 12 |
| UserBalances | 3 |

## Git 标签
- `v1.9` (annotated tag)
