# v1.30 Backup

**日期**: 2026-05-19
**版本**: v1.30
**基础**: v1.9 (Tiptap WYSIWYG + voice input + model selector + edge delete)

## 新增功能

### 节点选中边框统一修复（inline style）
- **根因**: React Flow 的 `.react-flow__node.selected` CSS 仅匹配内置节点类型（default/input/output/group），自定义节点类型（textInput/imageGen/videoGen）完全无选中视觉反馈
- **解决**: 全部改用 inline style 确保最高 CSS 特异性，不受 Tailwind 类构建缓存和 React Flow 内部样式影响
- 卡片主体选中态：`borderColor: #9CA3AF, borderWidth: 2px`（浅灰，清晰可见）
- 卡片主体未选中态：`border-white/10`（细微边界）
- 悬浮工具条/配置面板：`border: 1px solid #3F3F46`（几乎不可见的边界感）
- 三节点类型（text/image/video）风格完全统一

### 配置面板边框
- TextConfigPanel / ImageConfigPanel / VideoConfigPanel 统一 inline style 边框
- 移除绿色/蓝色/紫色顶线，四边统一 `#3F3F46`

### VideoConfigPanel 修复
- 补充缺失的 `useViewport()` zoom 缩放适配（之前面板不受缩放控制）

### 测试
- 更新 TextInputNode.test.tsx：inline style 断言
- 修复 VideoConfigPanel.test.tsx：添加 ReactFlowProvider 包裹

## 测试状态
- Web: 182 tests passed (34 files)
- 全部通过 ✅

## 数据库快照
| 表 | 行数 |
|----|------|
| Users | 5 |
| Accounts | 3 |
| Sessions | 95 |
| Announcements | 1 |
| ContentCards | 8 |
| CanvasProjects | 698 |
| CanvasNodes | 84 |
| CanvasEdges | 57 |
| NodeTypes | 3 |
| AIModels | 6 |
| ModelResolutions | 7 |
| ModelDurations | 3 |
| PricingRules | 12 |
| UserBalances | 3 |
| Templates | 4 |

## Git 标签
- `v1.30` (annotated tag)
