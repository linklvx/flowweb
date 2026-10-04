<!-- doc-status: historical | verified_at: n/a -->
# Image Fullscreen Viewer Spec

## 概述

为 Canvas 图片节点悬浮工具栏的"放大查看"按钮实现全屏图片查看功能，点击后弹出全屏覆盖层，展示图片及其元数据信息。

## 现状

- `ImageNodeToolbar.tsx` Row 2 已有 `ExpandIcon`（放大查看）按钮（line 338），`ariaLabel="放大查看"`，但 **无 onClick 处理函数**
- 项目已有 `TextNodeFullscreen.tsx` 作为全屏覆盖层的参考模式（`createPortal` → `document.body`）
- 图片节点数据包含：`fileId`, `referenceImage`, `prompt`, `model`, `quality`, `ratio` 等
- 项目 z-index 层级分布：通用浮层 9999、`#node-toolbar-portal` 99999、MaterialLibraryModal 100000

## 功能需求

### 入口

- 位置：ImageNodeToolbar Row 2，九宫格按钮右侧，"放大查看"按钮（已存在，需激活）
- 触发：点击按钮
- 关闭后焦点归还至该按钮（通过 `triggerRef`）

### 全屏查看器

#### 遮罩与容器布局

- 遮罩层：`fixed inset-0 z-[100000] flex items-center justify-center bg-black/60 backdrop-blur-sm`
- 遮罩内部：中性 ARIA 容器（基座提供，承载 `role="dialog"` `aria-modal` `aria-label`，无预设尺寸样式）
- 业务容器（ImageFullscreenViewer 提供）：`w-full mx-5 max-w-[1400px] h-[calc(100vh-40px)] max-h-[876px] rounded-[16px] bg-[#1C1C1C]/80 border border-white/10 flex overflow-hidden`

#### 内部布局

```
┌──────────────────────────────────────────────┬─────────────────┐
│                                              │  ✕ 关闭 (shrink-0)│
│                                              │     w-8 h-8     │
│                                              ├─────────────────┤
│           图片展示区                           │  提示词           │
│     flex items-center justify-center          │  (可滚动)        │
│           (flex-1)                            ├─────────────────┤
│                                              │  信息             │
│                                              │  模型 / 质量 ...  │
│                                              │  (可滚动)        │
│                                              ├─────────────────┤
│                                              │ 下载图片 <a> (shrink-0)│
└──────────────────────────────────────────────┴─────────────────┘
```

- 左侧：图片展示区 `flex-1 min-w-0 flex items-center justify-center`
- 右侧：侧边栏 `w-[284px] shrink-0 flex flex-col p-5 gap-5`
  - **顶部固定**（`shrink-0`）：关闭按钮（`w-8 h-8 flex items-center justify-center`，`aria-label="关闭全屏查看"`），flex 流式布局
  - **中间滚动**（`flex-1 min-h-0 overflow-y-auto`）：提示词 + 信息区，项目统一滚动条样式
  - **底部固定**（`shrink-0`）：下载按钮 `<a>` 标签，文案 "下载图片"

#### 侧边栏模块样式规范

- 容器内边距：`p-5`，模块间距 `gap-5`
- 模块标题（"提示词"/"信息"）：`text-sm font-semibold leading-5 text-neutral-400`
- 元数据行：`flex items-start text-sm gap-3`
  - 标签：`text-sm font-normal leading-[150%] text-muted-foreground shrink-0`
  - 值：`text-sm font-normal leading-[150%] text-popover-foreground truncate min-w-0`

#### 图片元素

`max-w-full max-h-full object-contain cursor-zoom-in select-none draggable={false}`

禁止选中、禁止拖拽，符合预览类组件的通用交互预期。

### 交互

- **打开**：点击工具栏"放大查看"按钮
- **关闭**：
  - 点击 ✕ 按钮（`aria-label="关闭全屏查看"`）
  - 点击遮罩空白区域（`onClick` + `e.target === e.currentTarget` 防冒泡，使用 `onClick` 而非 `onMouseDown`）
  - 按 Escape 键（`keydown` 事件 + `e.preventDefault()` + `e.stopImmediatePropagation()` 彻底阻止画布层其他 document keydown 监听器执行）
- **下载**：使用原生 `<a>` 标签 + `download` 属性，文案 "下载图片"
  - **可用态**：`href={displayUrl}` + 默认可聚焦 + `download`
  - **禁用态**（图片加载失败 / URL 为空）：
    - 移除 `href`（置为 `undefined`）
    - `tabIndex={-1}` 取消可聚焦性
    - `aria-disabled="true"` 语义标识
    - 视觉置灰 + hover 提示"图片加载失败，无法下载"
  - 跨域时浏览器降级为新标签页打开，为预期行为
- **图片缩放**：`cursor-zoom-in`（后续可扩展缩放/平移功能）

### 状态处理

#### 图片加载状态（与图片元素同级互斥渲染）

- **URL 变更时**：`useEffect` 监听 `displayUrl`，URL 更新时重置状态（有效→加载中，空→失败），避免上一张图片状态残留
- **加载中**（`displayUrl` 有效且未 onLoad/onError）：居中显示 Loading 占位
- **加载成功**（`img.onLoad`）：显示图片
- **加载失败**（`displayUrl` 为空 或 `img.onError`）：显示统一占位图 + "图片加载失败" 提示文字
- 三种状态互斥、同级渲染，避免嵌套导致的布局跳动

#### 图片无障碍
- `alt` 属性：优先提示词文本 → 无提示词时 `"生成的图片"` → 加载失败时 `"图片加载失败"`

#### 元数据空值
所有元数据字段均需空值兜底：

| 显示字段 | 数据来源 | 空值兜底 |
|---------|---------|---------|
| 提示词 | `nodeData.prompt?.text` | "暂无提示词" |
| 模型 | `nodeData.model` | "未知" |
| 质量 | `nodeData.quality` | "未知" |
| 宽高比 | `nodeData.ratio` | "未知" |
| 图片尺寸 | `img.naturalWidth × img.naturalHeight`（onLoad 获取） | 加载中"计算中"，失败"未知" |

#### 节点卸载
弹窗打开时若节点被删除（组件卸载），useEffect cleanup 中：
- 还原 `document.body.style.overflow`
- 移除 Escape keydown 监听器
- 执行 `triggerRef.current?.focus()` 归还焦点（兜底）

#### 选中状态联动
节点取消选中时，全屏弹窗保持打开状态，不随工具栏消失而关闭。

### 渲染时机与焦点时序

#### 渲染规则
- `open === false`：`BaseFullscreenModal` 返回 `null`，不创建 Portal、不挂载任何 DOM
- `open === true`：创建 Portal，挂载遮罩 + ARIA 容器 + children

#### 焦点时序
```
open: false → true  →  initialFocusRef.current?.focus()   （打开时聚焦关闭按钮）
open: true → false  →  triggerRef.current?.focus()        （关闭时归还触发按钮）
组件卸载 (cleanup)   →  triggerRef.current?.focus()        （异常场景兜底）
```

### 滚动锁定

- 存储方式：使用 `useRef` 保存原始 `overflow` 值（不触发重渲染）
- 保存时机：仅在 `open` 由 `false → true` 时写入一次 `overflowRef.current = document.body.style.overflow`
- 打开时：`document.body.style.overflow = 'hidden'`
- 关闭时：`document.body.style.overflow = overflowRef.current`
- 卸载时：cleanup 兜底还原

### 无障碍（WAI-ARIA Dialog）

- 基座在遮罩内、children 外包裹中性 `<div>` 承载 `role="dialog"` + `aria-modal="true"` + `aria-label`
- 该 div 无预设样式，不侵入业务布局
- 打开时聚焦 `initialFocusRef`（关闭按钮）；关闭时归还 `triggerRef`（放大查看按钮）
- 关闭按钮：`w-8 h-8 flex items-center justify-center`，`aria-label="关闭全屏查看"`

### 焦点与关闭按钮权责

```
ImageGenNode 创建:
  triggerRef (useRef<HTMLButtonElement>)   → 绑定到 ImageNodeToolbar 的 ExpandIcon 按钮
  closeBtnRef (useRef<HTMLButtonElement>)  → 传给 ImageFullscreenViewer → BaseFullscreenModal 的 initialFocusRef

  ├─ ImageNodeToolbar: triggerRef 绑定到 ExpandIcon ref
  └─ ImageFullscreenViewer: closeBtnRef 传给 BaseFullscreenModal
```

- `BaseFullscreenModal` **不内置关闭按钮**，仅提供 `onClose` + `triggerRef` + `initialFocusRef` 能力
- 关闭按钮由业务组件自行渲染，基座仅负责打开时聚焦 `initialFocusRef`

### Escape 键冲突防护

- 监听 `keydown` 事件（非 `keyup`）
- 回调中依次调用：
  1. `e.preventDefault()` — 阻止浏览器默认行为
  2. `e.stopImmediatePropagation()` — 阻止 document 上其他同类型监听器执行，彻底隔离画布全局快捷键
- 监听仅在 `open === true` 时挂载，关闭后立即移除

## 组件结构

### BaseFullscreenModal（新建通用基座）

**位置：** `src/components/BaseFullscreenModal.tsx`

**DOM 结构：**
```
createPortal → document.body
  └─ 遮罩 div (fixed inset-0 z-[100000] flex items-center justify-center bg-black/60 backdrop-blur-sm, onClick 关闭)
       └─ ARIA 中性 div (role="dialog" aria-modal="true" aria-label={label})
            └─ {children}  ← 业务容器
```

**职责（仅通用能力）：**
- `open === false` 时返回 null
- `createPortal` → `document.body`
- 遮罩层 + `onClick` + `e.target === e.currentTarget` 冒泡防护
- Escape `keydown` 监听（`preventDefault` + `stopImmediatePropagation`）+ `onClose`
- 滚动锁定（`useRef` 存储原始值，仅 false→true 时保存）+ cleanup 兜底
- ARIA 属性（中性 `<div>` 承载 `role="dialog"` `aria-modal` `aria-label`）
- 焦点管理（false→true 聚焦 `initialFocusRef`，true→false / cleanup 归还 `triggerRef`）

**不负责：** 关闭按钮渲染、业务内容、容器尺寸/样式

**Props 接口：**
```typescript
interface BaseFullscreenModalProps {
  open: boolean;
  onClose: () => void;
  label: string;
  triggerRef?: React.RefObject<HTMLElement>;
  initialFocusRef?: React.RefObject<HTMLElement>;
  children: React.ReactNode;
}
```

### ImageFullscreenViewer（新建图片全屏查看器）

**位置：** `src/pages/canvas/components/nodes/ImageFullscreenViewer.tsx`

**职责：** 使用 `BaseFullscreenModal`，children 内渲染业务容器（图片展示 + 侧边栏），内部管理图片加载状态（含 URL 变更时状态重置）。

**Props 接口：**
```typescript
interface ImageFullscreenViewerProps {
  open: boolean;
  onClose: () => void;
  displayUrl: string | undefined;
  nodeData: ImageNodeData;
  triggerRef: React.RefObject<HTMLButtonElement>;
}
```

`ImageFullscreenViewer` 内部创建 `closeBtnRef`，传给 `BaseFullscreenModal` 的 `initialFocusRef`。

### 修改点

```
src/components/BaseFullscreenModal.tsx               ← 新建
src/pages/canvas/components/nodes/ImageFullscreenViewer.tsx  ← 新建
src/pages/canvas/components/nodes/ImageGenNode.tsx    ← 修改：fullscreenOpen + triggerRef + closeBtnRef + onFullscreen
src/pages/canvas/components/nodes/ImageNodeToolbar.tsx ← 修改：ExpandIcon 增加 onClick + ref
```

## 技术约束

- TypeScript strict mode
- 使用 Tailwind CSS + 内联样式（与项目一致）
- 图标使用内联 SVG（与项目一致，不使用外部图标库）
- 不使用新的 npm 依赖
- 平台：Web（React）

## 不在范围内（本次）

- 图片缩放/平移（仅预留 cursor-zoom-in）
- 多图切换
- 编辑功能
- 小屏响应式（< 768px）
- 缩略图→原图过渡
- 下载文件名语义化
- 滚动条宽度补偿（padding-right）
- Tab 焦点循环（focus trapping）—— 基座预留扩展能力
- 打开/关闭过渡动画
- 多弹窗层级栈管理
- 图片右键菜单定制
- 图片加载失败"重新加载"入口
- TextNodeFullscreen 重构迁移

## 测试用例

| 分类 | 场景 | 预期 |
|------|------|------|
| 基础 | 点击放大查看按钮 | 弹窗打开，图片居中，背景不可滚动 |
| 基础 | 点击关闭按钮 | 弹窗关闭，焦点归还原按钮，滚动恢复 |
| 基础 | 点击遮罩空白处 | 弹窗关闭（`e.target === e.currentTarget`） |
| 基础 | 按 Escape 键 | 弹窗关闭，不触发画布全局快捷键 |
| 边界 | 点击侧边栏内部任意区域 | 弹窗不关闭（冒泡防护） |
| 边界 | Escape 键连续快速按 | 仅消费一次，无重复关闭异常 |
| 边界 | displayUrl 为空 | 显示错误占位，下载 `<a>` 无 href + tabIndex=-1 |
| 边界 | 图片加载失败（onError） | 显示错误占位 + 提示，下载 disabled |
| 边界 | 图片加载中 | 显示 Loading，与图片/错误状态互斥 |
| 边界 | displayUrl 变更 | 加载状态重置，不残留上一张图片状态 |
| 边界 | 元数据字段为空 | 显示兜底文案，布局不塌陷 |
| 边界 | 弹窗打开时删除当前节点 | 弹窗卸载，body overflow 还原，焦点归还触发按钮 |
| 边界 | 节点取消选中 | 弹窗保持打开 |
| 键盘 | 下载按钮可用态 | Tab 可聚焦，Enter/Space 触发下载 |
| 键盘 | 下载按钮禁用态 | Tab 无法聚焦，Enter/Space 无效果 |
| 功能 | 下载按钮点击 | `<a download>` 触发下载或新标签页打开 |
| 无障碍 | 打开弹窗 | role="dialog" 语义正确，焦点移至关闭按钮 |
| 无障碍 | 关闭弹窗 | 焦点归还放大查看按钮 |
| 无障碍 | 图片 alt | 提示词/生成的图片/图片加载失败 三态正确 |
| 无障碍 | 关闭按钮 | `aria-label="关闭全屏查看"`，w-8 h-8 热区 |
