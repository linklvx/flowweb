# ImageNodeToolbar 悬浮工具条 UI 设计

## 背景

当前 `ImageGenNode` 选中时在上方显示一个"上传"按钮（圆角药丸形状）。用户上传图片或 AI 生成图片后，图片已加载到节点中，上传按钮仍显示。实际上图片加载后应提供更多操作入口。

## 目标

图片节点加载图片后（`fileId` 存在），上方悬浮区域从单个"上传"按钮切换为 2 行工具条，提供丰富的图片操作入口。

**本次只实现 UI 结构，不实现功能逻辑。**

## 显示条件

| 条件 | 显示内容 |
|------|---------|
| `fileId` 为空（无图片）且 selected | 单行上传按钮（现有行为） |
| `fileId` 存在（有图片）且 selected | 2 行工具条（新增） |
| 未选中 | 都不显示 |

## 边界检测

当节点靠近画布顶部导致工具条被裁剪时，自动切换为下方显示：

```typescript
const toolbarHeight = 84; // 两行工具条总高度（含间距）
const availableTopSpace = (nodePosition.y - viewport.y) / zoom;
const showBelow = availableTopSpace < toolbarHeight + 20; // 预留 20px 安全边距
```

| 条件 | 工具条位置 |
|------|----------|
| `showBelow === false`（顶部空间足够） | `bottom: calc(100% + 10px)`，`transformOrigin: bottom center` |
| `showBelow === true`（顶部空间不足） | `top: calc(100% + 10px)`，`transformOrigin: top center` |

## 工具条结构

### 第 1 行

| 按钮 | 图标 | 类型 |
|------|------|------|
| 逆时针旋转 | `lucide-rotate-ccw` | 纯图标 |
| 顺时针旋转 | `lucide-rotate-cw` | 纯图标 |
| 分隔线 | — | — |
| 分离 | `lucide-layers` | 图标+文字 |
| 裁切 | `lucide-crop` | 图标+文字 |
| 扩图 | 自定义 SVG (16x16) | 图标+文字 |
| 擦除 | `lucide-eraser` | 图标+文字 |
| 重绘 | `lucide-paintbrush` | 图标+文字 |
| 文字 | `lucide-type` | 图标+文字 |
| 换装 | `lucide-shirt` | 图标+文字 |

### 第 2 行

| 按钮 | 图标 | 类型 |
|------|------|------|
| 打光 | 自定义 SVG (sun, 16x16) | 图标+文字 |
| 3D 角度 | 自定义 SVG (camera 3D, 16x16) | 图标+文字 |
| 涂鸦 | `lucide-pen-line` | 图标+文字 |
| 高清增强 | 自定义 SVG (HD, 16x16) | 图标+文字 |
| 九宫格 | 自定义 SVG (grid 3x3, 16x16) | 图标+文字 |
| 分隔线 | — | — |
| 放大查看 | `lucide-expand` | 纯图标 |
| 上传 | `lucide-upload` | 纯图标 |
| 下载 | `lucide-download` | 纯图标 |
| 分隔线 | — | — |
| 复制 | `lucide-copy` | 纯图标 |
| 删除 | `lucide-trash-2` | 纯图标 |

## 样式规格

- 容器：`flex flex-col items-center gap-1 transition-opacity duration-150`，position absolute，`z-index: 10000`
  - `transition-opacity duration-150` 提供显示/隐藏淡入淡出效果
- 行容器：`bg-gray-900/95 flex items-center gap-0.5 rounded-xl border border-gray-700/50 px-1 py-1 shadow-xl backdrop-blur-md`
  - `bg-gray-900/95` 使用具体值而非项目别名，95% 不透明度保证文字清晰同时有层次感
  - 使用 `gap-0.5` 而非 `gap-0`，避免 hover 背景粘连
- **纯图标按钮 (IconButton)**：`rounded-lg p-1.5 text-gray-300 transition-all`
  - hover: `hover:bg-white/10 hover:text-gray-300`
  - active: `active:bg-white/15`
  - disabled: `opacity-50 pointer-events-none`
- **图标+文字按钮 (TextIconButton)**：`rounded-lg px-2.5 py-1.5 text-xs text-gray-300 transition-all flex items-center gap-1.5`
  - hover: `hover:bg-white/10 hover:text-gray-300`
  - active: `active:bg-white/15`
  - disabled: `opacity-50 pointer-events-none`
- **分隔线 (Divider)**：`mx-1 h-5 w-px bg-gray-600`
- 缩放适配：`transform: scale(1/zoom)`，`transformOrigin` 根据上下位置动态设置
- 类名：`nodrag nopan` 防止 React Flow 拦截事件
- 圆角差异说明：上传按钮 `rounded-full`（药丸形），工具条行 `rounded-xl`，按钮 `rounded-lg` —— 层级差异合理

## 组件拆分

为避免大量重复 Tailwind 类名，提取 3 个内部子组件（同一文件内定义，不单独导出）：

- `IconButton` — 纯图标按钮，接收 `icon: ReactNode`、`disabled?: boolean`
- `TextIconButton` — 图标+文字按钮，接收 `icon: ReactNode`、`text: string`、`disabled?: boolean`
- `Divider` — 分隔线，无 props

## 无障碍

- 工具条容器：`role="toolbar"`
- 纯图标按钮：`aria-label` 指定中文标签（如 `aria-label="逆时针旋转"`）
- 所有按钮：`tabIndex={0}` 支持键盘导航

## 自定义 SVG 图标（5 个）

以下图标需内联为 16x16 SVG，统一 `stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"`：

| 图标 | 描述 |
|------|------|
| 扩图 | 矩形 + 4 向外箭头（上下左右） |
| 打光 | 圆心 + 放射状光线 |
| 3D 角度 | 相机 + "3D" 文字标记 |
| 高清增强 | 矩形 + "HD" 文字标记 |
| 九宫格 | 3×3 网格矩形 |

## 改动文件

| 文件 | 改动 |
|------|------|
| `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.tsx` | 新建 — 工具条组件（含内部子组件和自定义 SVG 图标） |
| `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx` | 修改 — 根据 fileId 切换显示上传按钮或工具条，集成边界检测 |

## 不变更的部分

- `MultiImageNode` — 本次不改，后续再考虑
- `VideoGenNode` / `AudioGenNode` — 不涉及
- 底部 `ImageConfigPanel` — 不修改
- 所有功能逻辑 — 后续逐一实现

## 验证标准

1. 新创建的图片节点（无图片）→ 选中时显示上传按钮
2. 上传图片后（fileId 存在）→ 选中时显示 2 行工具条
3. AI 生成图片后（fileId 存在）→ 选中时显示 2 行工具条
4. 未选中节点 → 工具条/上传按钮都不显示
5. 画布缩放时工具条保持可读大小
6. 工具条不响应拖拽（nodrag nopan）
7. 工具条 hover 背景不粘连（gap-0.5 生效）
8. 按钮有 active 按压反馈
