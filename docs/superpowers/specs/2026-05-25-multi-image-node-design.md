# MultiImageNode 多图堆叠节点 — 功能规格说明书

**版本**: 1.2
**日期**: 2026-05-25
**状态**: 待确认（实现细节补充）

---

## 1. 概述

### 1.1 问题
现有 ImageGenNode 仅支持展示单张图片（`fileId: string`）。用户一次生成多张图片时，无法在画布上集中展示。

### 1.2 解决方案
新建独立节点类型 `MultiImageNode`（多图堆叠节点），支持：
- 堆叠视图（主图 + 偏移层）展示多图概览
- 展开网格视图浏览全部图片
- 多图上传、主图切换、拖拽排序

### 1.3 不做什么
- 不修改现有 ImageGenNode
- 不做图片编辑/裁剪/滤镜
- 不做 AI 批量生成对接（预留接口，后续版本）
- 不做右键菜单（后续版本）

---

## 2. 数据结构

### 2.1 节点数据类型

```typescript
// 新增到 nodeStore.ts NodeData 联合类型
export interface MultiImageNodeData {
  label?: string;               // 可编辑标题，与其他节点保持一致
  images: ImageItem[];          // 复用现有 ImageItem 类型
  mainImageIndex: number;       // 主图索引，默认 0，无图时为 -1
  expanded: boolean;            // 是否展开网格
  nodeStatus: 'idle' | 'loading' | 'done' | 'error'; // nodeStatus 避免与 ImageItem.status 混淆
  // 预留字段（不在本版本实现）
  generationBatchId?: string;   // 批量生成批次 ID
  prompt?: string;              // 生成所用的 prompt
}
```

### 2.2 复用现有类型

```typescript
// 现有 ImageItem（nodeStore.ts 已定义，无需修改）
export interface ImageItem {
  id: string;
  url: string;
  name: string;
  status: 'uploading' | 'success' | 'error';
  progress?: number;
}
```

### 2.3 Store Actions（新增到 nodeStore.ts）

| Action | 签名 | 用途 |
|--------|------|------|
| `updateMultiImageImages` | `(nodeId, images: ImageItem[])` | 替换整个 images 数组 |
| `setMainImageIndex` | `(nodeId, index: number)` | 设置主图索引 |
| `toggleExpanded` | `(nodeId)` | 切换展开/收起 |
| `updateMultiImageNodeStatus` | `(nodeId, status: MultiImageNodeData['nodeStatus'])` | 更新节点状态 |

`deleteNode` 现有逻辑已处理 ImageItem 清理，复用即可。

### 2.5 Undo/Redo 支持

所有新增 Store Actions 需支持撤销/重做。当前项目无 `undoable` middleware，需在实现时：

- **方案 A（优先）**: 创建 `@/stores/middleware/undoable.ts`，实现 Zustand 的 undo 中间件，将 `updateMultiImageImages`、`setMainImageIndex`、`toggleExpanded`、`updateMultiImageNodeStatus` 纳入 `include` 列表
- **方案 B**: 若 undoable 中间件创建工作量过大，记 TODO 标记，先用基础 set/get 实现，后续补充

**判断标准**: 在 Plan 阶段评估 undoable middleware 的复杂度。若超过 50 行且与其他 store action 耦合，先方案 B。

### 2.4 类型守卫

```typescript
export function isMultiImageNode(node: AppNode): node is AppNode & { data: MultiImageNodeData } {
  return node.type === 'multiImageGen';
}
```

---

## 3. 交互行为

### 3.1 状态机

```
                    ┌──────────┐
         upload     │   idle   │  upload
    ┌──────────────→│ (0 images)│←──────────────┐
    │               └─────┬────┘               │
    │                     │ has images          │
    │                     ▼                     │
    │               ┌──────────┐               │
    │               │ stacked  │               │
    │               │ (收起)   │               │
    │               └────┬─────┘               │
    │                    │ click badge          │
    │                    ▼                     │
    │               ┌──────────┐    set main   │
    │               │ expanded │──→ auto close  │
    │               │ (展开)   │               │
    │               └────┬─────┘               │
    │                    │ click ✕              │
    │                    ▼                     │
    │               ┌──────────┐               │
    └───────────────│ stacked  │───────────────┘
                    └──────────┘
```

### 3.2 堆叠视图（默认状态）

- 显示主图（`images[mainImageIndex]`），`object-cover`，圆角 12px
- 主图后方显示最多 3 层偏移背景（z-index 从高到低排列）：
  - 主图: z-index 4（最上层，确保不被背景层覆盖）
  - 层 1: `scale(0.97) rotate(5deg) translateX(12px)`，z-index 3
  - 层 2: `scale(0.94) rotate(10deg) translateX(24px)`，z-index 2
  - 层 3: `scale(0.91) rotate(15deg) translateX(36px)`，z-index 1
  - 仅当 `images.length >= layerIndex + 2` 时才渲染对应层
- 右上角徽章：`rounded-full`，`bg-[#f59e0b]`，显示 `images.length`
  - `images.length <= 1` 时不显示
  - 点击徽章 → 切换到展开视图
- 节点默认尺寸：400×300

### 3.3 展开网格视图

- 点击徽章切换到展开，点击 ✕ 按钮收起
- 网格列数：`images.length <= 4` → 2 列，`> 4` → 3 列
- 每格 `aspect-ratio: 1/1`，`object-cover`，间距 8px
- 节点尺寸动态扩展以容纳网格：
  - 2 列: `min((150*2+8+32), 548) × auto`
  - 3 列: `min((150*3+16+32), 548) × auto`
  - 保持 max-width 548（与 ImageGenNode 一致）
- 当前主图格：橙色边框 `border-[#f59e0b]`，右上角 ✓ 标记
- 非主图格 hover：显示半透明 overlay + "设为主图" 按钮
- 点击"设为主图" → 更新 `mainImageIndex`，自动收起回堆叠视图
- 右上角 ✕ 按钮收起回堆叠视图

### 3.4 上传

- 选中节点时显示浮动上传按钮（与 ImageGenNode 相同的 `nodrag` 模式）
- 点击触发 `<input type="file" multiple accept="image/*">`
- 复用现有 `presignUpload` → `axios POST` → `confirmUpload` 管线
- 每张图片独立上传，显示进度
- 上传完成后调用 `updateMultiImageImages` 追加到数组末尾
- 上限：9 张（与现有 `prompt.allImages` maxCount 一致）

### 3.5 空状态

- 0 张图片时显示相机 SVG 占位图标（灰色 `#555`）
- 堆叠层和徽章均不渲染

### 3.6 单图状态

- 仅 1 张图片时：只显示图片，无堆叠层，无徽章
- 行为退化为简单图片展示

---

## 4. 配置面板

### 4.1 面板内容

选中节点时，下方显示 `MultiImageConfigPanel`：

| 功能 | 说明 |
|------|------|
| 上传按钮 | 同 3.4 上传流程 |
| 图片列表 | 显示所有已上传图片缩略图 |
| 拖拽排序 | 使用 `dnd-kit`（项目已有依赖）拖拽调整顺序 |
| 单张删除 | 每张图片有 ✕ 删除按钮 |
| 设为封面 | 每张图片有"设为封面"按钮（同"设为主图"） |
| 清空全部 | 底部清空按钮，需二次确认 |

### 4.2 面板样式

- 遵循现有 ConfigPanel 模式：
  - `absolute top-full left-1/2 -translate-x-1/2`
  - `useViewport()` 缩放 `transform: scale(1/zoom)`
  - `nodrag nopan` 类名
  - `bg-[#222222]` 背景

---

## 5. 视觉规范

### 5.1 颜色

| 元素 | 颜色 | 用途 |
|------|------|------|
| 节点背景 | `#222222` | 卡片主体 |
| 选中边框 | `#f59e0b` (amber-500) | 选中时 2px 边框 |
| Handle | `#f59e0b` (amber-500) | 左右连接点 |
| 徽章 | `#f59e0b` (amber-500) | 图片数量圆标 |
| 主图标记 | `#f59e0b` (amber-500) | 展开网格当前主图边框 |
| 堆叠层背景 | `#2a2a3a` | 偏移背景层 |
| 堆叠层边框 | `#3a3a4a` | 偏移层边线 |
| 占位图标 | `#555555` | 空状态相机 SVG |

### 5.2 尺寸

| 属性 | 值 |
|------|------|
| 收起默认 | 400px × 300px |
| 展开最大宽度 | 548px（与 ImageGenNode 一致） |
| 展开最小宽度 | 332px（2 列: 150×2 + 8 + 24 padding） |
| 标题字体 | 12px, #9ca3af |
| Handle 大小 | 8px × 8px |
| 徽章大小 | 28px × 28px |
| 圆角 | 12px（主体）、8px（网格格）、50%（徽章） |

### 5.3 标题

- 同现有节点模式：绝对定位在节点上方
- 左侧图标：SVG 图片图标（同现有 ImageGenNode 标题图标）
- 文字：`"Multi-Image (N)"` 或用户自定义（可编辑，20 字限制）
- 编辑模式：同 ImageGenNode 的 `label/draft/titleInputRef` 模式

---

## 6. 节点注册

### 6.1 canvasStore.ts

```typescript
const nodeTypeMap: Record<string, string> = {
  text: 'textInput',
  image: 'imageGen',
  video: 'videoGen',
  audio: 'audioGen',
  multiImage: 'multiImageGen',  // 新增
};
```

### 6.2 CanvasView.tsx

```typescript
const nodeTypes: NodeTypes = {
  textInput: TextInputNode,
  imageGen: ImageGenNode,
  videoGen: VideoGenNode,
  audioGen: AudioGenNode,
  multiImageGen: MultiImageNode,  // 新增
};
```

---

## 7. 边界情况

| 场景 | 行为 |
|------|------|
| 0 张图 | 占位 SVG 图标，无徽章，无堆叠层 |
| 1 张图 | 单图显示，无徽章，无堆叠层 |
| 2 张图 | 1 主图 + 1 背景层，有徽章 |
| 3 张图 | 1 主图 + 2 背景层，有徽章 |
| 4 张图 | 1 主图 + 3 背景层（全部），有徽章 |
| 5+ 张图 | 1 主图 + 3 背景层，有徽章。展开为 3 列 |
| 9 张上限 | 选择超过 9 张时，`message.warning('最多支持上传9张图片')`，只取前 9 张 |
| 上传中 | 显示上传进度，`nodeStatus` 为 `loading` |
| 上传失败 | 单张标记 `error`，不影响其他图片 |
| 删除主图 | 自动将 `mainImageIndex` 设为剩余第一张的索引 |
| 删除最后一张图 | `mainImageIndex` 设为 -1，`nodeStatus` 回到 `idle` |
| 全部删除 | 回到空状态（占位 SVG），`nodeStatus` 为 `idle` |
| 图片加载失败 | `<img>` 的 `onError` 事件中替换为破损图标 SVG，居中显示 |

---

## 8. 未来预留

- `MultiImageNodeData` 预留字段不在此版本实现：
  - `generationBatchId?: string` — 批量生成批次 ID
  - `prompt?: string` — 生成所用的 prompt
- `updateMultiImageImages` 接口设计为通用方法，后续可从 socket.io 事件直接调用

---

## 9. 实现细节

### 9.1 图片加载失败处理：ImageWithFallback

创建通用组件 `apps/web/src/components/common/ImageWithFallback.tsx`：

```tsx
interface ImageWithFallbackProps {
  src: string;
  alt: string;
  className?: string;
}
```

- 正常加载：渲染 `<img>` 标签，`loading="lazy"` 懒加载
- 加载失败：`onError` 触发 `useState` → 切换为破损图标 SVG（灰色 #555，居中显示在容器内）
- 用于 MultiImageNode 的所有图片展示位置（主图、网格图、配置面板缩略图）

### 9.2 配置面板拖拽排序：dnd-kit

项目已有依赖：`@dnd-kit/core ^6.3.1`、`@dnd-kit/sortable ^10.0.0`、`@dnd-kit/utilities ^3.2.2`。

实现要点：
- 使用 `DndContext` + `SortableContext`（`verticalListSortingStrategy`）
- `PointerSensor` 激活距离设为 5px（避免误触拖拽）
- `onDragEnd` 中使用 `arrayMove` 重排数组
- **主图索引联动**：
  - 拖拽的是主图 → `mainImageIndex` 更新为目标位置
  - 主图被其他图片跨过 → `mainImageIndex` 相应调整（±1）
- 排序后调用 `updateMultiImageImages` 持久化
- 每个 `SortableImageItem` 添加 `nodrag` 类名（防止拖拽排序触发 React Flow 画布拖拽）

---

## 10. 测试策略

### 9.1 单元测试（MultiImageNode.test.tsx）

| # | 测试场景 | 预期结果 |
|---|---------|---------|
| 1 | 标题默认值 | 渲染 "Multi-Image" |
| 2 | 标题编辑保存 | blur 后更新 nodeStore |
| 3 | 标题取消 | Escape 恢复原值 |
| 4 | 0 张图占位 | 渲染相机 SVG |
| 5 | 1 张图 | 显示图片，无徽章，无堆叠层 |
| 6 | 2+ 张图堆叠层 | 渲染正确数量的背景层（带 offset） |
| 7 | 徽章数量 | 显示正确的 `images.length` |
| 8 | 徽章点击展开 | expanded=true，显示网格 |
| 9 | 展开网格列数 | ≤4 → 2列，>4 → 3列 |
| 10 | ✕ 收起 | expanded=false，回到堆叠 |
| 11 | "设为主图" hover | overlay 显示 |
| 12 | "设为主图" click | 更新 mainImageIndex，自动收起 |
| 13 | 悬浮上传按钮 | selected 时显示，未选隐藏 |
| 14 | 2 个 Handle | target + source 各 1 个 |
| 15 | 选中边框 | selected 时渲染橙色边框 |
| 16 | 删除最后一张图 | mainImageIndex=-1，nodeStatus=idle |
| 17 | 上传超 9 张 | message.warning 提示，只取前 9 张 |
| 18 | 图片加载失败 | onError 替换为破损 SVG 图标 |

### 9.2 ConfigPanel 测试

| # | 测试场景 |
|---|---------|
| 1 | 面板在 selected 时渲染 |
| 2 | 上传按钮存在 |
| 3 | 图片列表渲染缩略图 |
| 4 | 清空按钮存在 |
