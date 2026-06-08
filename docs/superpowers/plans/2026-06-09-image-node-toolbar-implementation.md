# ImageNodeToolbar 实施计划

## 概述

在 `ImageGenNode` 图片加载后，将上方悬浮上传按钮替换为 2 行工具条，提供图片操作入口。纯 UI 实现，不含功能逻辑。

## 实施步骤

### Step 1: 写 ImageNodeToolbar 测试 (RED)

**文件**: `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx`

#### Mock 设置

```typescript
const mockUseViewport = vi.fn(() => ({ x: 0, y: 0, zoom: 1 }));
vi.mock('@xyflow/react', () => ({
  useViewport: mockUseViewport,
}));

// 每个测试后重置 Mock，避免测试间状态污染
afterEach(() => {
  vi.clearAllMocks();
});
```

> 注：`zoom` 和 `viewport` 改为通过 props 传入组件（非内部 `useViewport`），测试时直接传递不同值即可覆盖边界检测场景，无需 mock `useViewport` 切换。`useViewport` mock 仅用于 `ImageGenNode` 集成测试。

#### 测试用例

| # | 测试 | 验证方式 |
|---|------|---------|
| 1 | `fileId` 为空、selected=true 时渲染上传按钮 | `getByText('上传')` |
| 2 | `fileId` 存在、selected=true 时渲染 2 行工具条 | `getByText('分离')` + `getByText('打光')` |
| 3 | `selected=false` 时不渲染任何内容 | `container.firstChild` 为空 |
| 4 | 上传按钮样式正确（rounded-full） | `getByText('上传').closest('button')?.className` 包含 `rounded-full` |
| 5 | 第一行包含所有按钮 | 逆/顺时针旋转、分离、裁切、扩图、擦除、重绘、文字、换装 |
| 6 | 第二行包含所有按钮 | 打光、3D角度、涂鸦、高清增强、九宫格、放大查看、上传、下载、复制、删除 |
| 7 | 三根分隔线存在 | `querySelectorAll` 验证 `w-px` + `bg-gray-600` 数量为 3 |
| 8 | 缩放适配 `scale(1/zoom)`，zoom=2 时 `scale(0.5)` | inline style 精确匹配 |
| 9 | 容器含 `nodrag nopan` | `classList.contains` |
| 10 | 容器 `role="toolbar"` | `getByRole('toolbar')` |
| 11 | 纯图标按钮均有 `aria-label` | 逐个 `getByLabelText` |
| 12 | 边界检测：`availableTopSpace < 104` 时显示在下方 | nodeY=100, viewportY=50, zoom=1 → 空间=50 < 104，验证 `style.top: calc(100% + 10px)` |
| 13 | 边界检测：`availableTopSpace >= 104` 时显示在上方 | nodeY=200, viewportY=0, zoom=1 → 空间=200 >= 104，验证 `style.bottom: calc(100% + 10px)` |
| 14 | 容器含 `transition-opacity duration-150` | className 匹配 |
| 15 | 行容器 `bg-gray-900/95` | className 匹配 |
| 16 | 行容器 `gap-0.5` 按钮间距 | className 匹配 |
| 17 | 删除按钮有危险操作样式 | className 包含 `hover:text-red-400` 和 `hover:bg-red-500/10`（非阻塞） |
| 18 | `onUpload` 回调正确触发 | fileId=undefined, 点击「上传」按钮 → `expect(mockOnUpload).toHaveBeenCalledTimes(1)` |

### Step 2: 实现 ImageNodeToolbar 组件 (GREEN)

**文件**: `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.tsx`

#### 组件接口

```typescript
interface ImageNodeToolbarProps {
  fileId?: string;
  selected: boolean;
  zoom: number;
  nodeX: number;
  nodeY: number;
  viewportX: number;
  viewportY: number;
  onUpload?: () => void;
}
```

> 使用**扁平化原始值 props**（`nodeX`/`nodeY`、`viewportX`/`viewportY` 而非对象），确保 `React.memo` 浅比较能正确命中，避免每次渲染都创建新对象导致 memo 失效。

#### 组件装饰

```typescript
export const ImageNodeToolbar = memo(ImageNodeToolbarComponent);
```

> `React.memo` 避免父组件因 `useViewport` 触发重渲染时不必要的子组件更新。

#### 组件树

```
ImageNodeToolbar ({ fileId, selected, zoom, nodeX, nodeY, viewportX, viewportY, onUpload })
├── [!selected] → 不渲染 (return null)
├── [selected && !fileId] → 上传按钮 (rounded-full, 现有样式)
│   └── <IconButton icon={upload} aria-label="上传" onClick={onUpload} />
└── [selected && fileId] → 工具条容器 (nodrag nopan, role="toolbar", transition-opacity duration-150)
    ├── Row 1 (bg-gray-900/95 rounded-xl border border-gray-700/50 px-1 py-1 shadow-xl backdrop-blur-md)
    │   ├── IconButton (rotate-ccw, aria-label="逆时针旋转")
    │   ├── IconButton (rotate-cw, aria-label="顺时针旋转")
    │   ├── Divider
    │   ├── TextIconButton (layers, "分离")
    │   ├── TextIconButton (crop, "裁切")
    │   ├── TextIconButton (expand-image, "扩图")  ← 自定义 SVG
    │   ├── TextIconButton (eraser, "擦除")
    │   ├── TextIconButton (paintbrush, "重绘")
    │   ├── TextIconButton (type, "文字")
    │   └── TextIconButton (shirt, "换装")
    └── Row 2 (bg-gray-900/95 rounded-xl border border-gray-700/50 px-1 py-1 shadow-xl backdrop-blur-md)
        ├── TextIconButton (sun, "打光")          ← 自定义 SVG
        ├── TextIconButton (camera-3d, "3D 角度")  ← 自定义 SVG
        ├── TextIconButton (pen-line, "涂鸦")
        ├── TextIconButton (hd, "高清增强")         ← 自定义 SVG
        ├── TextIconButton (grid-3x3, "九宫格")    ← 自定义 SVG
        ├── Divider
        ├── IconButton (expand, aria-label="放大查看")
        ├── IconButton (upload, aria-label="上传")
        ├── IconButton (download, aria-label="下载")
        ├── Divider
        ├── IconButton (copy, aria-label="复制")
        └── IconButton (trash-2, aria-label="删除", hover:text-red-400 hover:bg-red-500/10)
```

#### 关键实现细节

**边界检测逻辑**（全部使用原始值 props）:
```typescript
const TOOLBAR_HEIGHT = 84;  // 两行工具条总高度（含 gap-1）
const MARGIN = 20;          // 安全边距
const availableTopSpace = (nodeY - viewportY) / zoom;
const showBelow = availableTopSpace < TOOLBAR_HEIGHT + MARGIN;
```

> 边界检测依赖 `nodePosition`、`viewport`、`zoom` 三个 prop，仅在这些值变化时重新计算（`React.memo` 下的引用比较），不会产生额外性能开销。

**定位 + 缩放**:
```typescript
style={{
  position: 'absolute',
  left: '50%',
  transform: `translateX(-50%) scale(${1 / zoom})`,
  transformOrigin: showBelow ? 'top center' : 'bottom center',
  transition: 'all 0.15s ease',  // 边界切换时平滑过渡
  zIndex: 10000,
  ...(showBelow
    ? { top: 'calc(100% + 10px)' }
    : { bottom: 'calc(100% + 10px)' }
  ),
}}
```

**子组件**（同文件内，不导出）:
- `IconButton` — `{ icon: ReactNode; ariaLabel: string; onClick?: () => void; disabled?: boolean; className?: string }`，tabIndex=0
  - 内部：`<button aria-label={ariaLabel} ...>`（TS prop 使用驼峰，映射到 HTML 属性）
- `TextIconButton` — `{ icon: ReactNode; text: string; disabled?: boolean }`，tabIndex=0
- `onUpload` 参数默认值：`onUpload = () => {}`，避免未传入时 TypeError
- `Divider` — `<div className="mx-1 h-5 w-px bg-gray-600" />`

**5 个自定义 SVG 图标**（同文件内）:
| 图标 | SVG 结构 |
|------|---------|
| 扩图 | `rect x=6 y=6 w=12 h=12 rx=1` + 上下左右 4 条路径 |
| 打光 | `circle cx=12 cy=12 r=4` + 8 条放射光线 |
| 3D 角度 | `path` (相机造型) + `<text>3D</text>` |
| 高清增强 | `rect x=2 y=4 w=20 h=16 rx=2` + `<text>HD</text>` |
| 九宫格 | 9 个 `rect` 3×3 排列 |

所有 SVG 统一：`width=16 height=16 viewBox="0 0 24 24"`，`stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"`

### Step 3: 集成到 ImageGenNode (REFACTOR)

**文件**: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx`

**改动内容**:
1. 导入 `ImageNodeToolbar` from `'./ImageNodeToolbar'`
2. 调用 `useViewport()` 获取 `zoom`、`viewport.{x, y}`
3. 从 `useNodeStore` 获取当前节点 position
4. 删除现有 JSX 中的 `{selected && (<button>上传</button>)}` 代码块（约第 189-212 行）
5. 替换为：

```tsx
<ImageNodeToolbar
  fileId={fileId}
  selected={selected ?? false}
  zoom={zoom}
  nodeX={nodeData?.position?.x ?? 0}
  nodeY={nodeData?.position?.y ?? 0}
  viewportX={vpX}
  viewportY={vpY}
  onUpload={() => fileInputRef.current?.click()}
/>
```

6. 保留 hidden file input 和上传逻辑（`handleUploadFile`、`fileInputRef`）不变

### Step 4: 验证 (VERIFY)

```bash
cd apps/web && npx vitest run --reporter=verbose ImageNodeToolbar
```

确认测试全部通过后，调整 `ImageGenNode.test.tsx` 中受影响的测试断言。

## 不改动的部分

- `ImageGenNode.tsx` 的上传逻辑（`handleUploadFile`、`fileInputRef`、`useEffect` socket、标题编辑）
- `ImageGenNode.test.tsx` 的现有测试断言（仅微调与工具条相关的断言）
- `MultiImageNode`、`VideoGenNode`、`AudioGenNode`
- `ImageConfigPanel`
- `nodeStore.ts` 类型定义

## 潜在风险与应对

| 风险 | 应对 |
|------|------|
| `ImageGenNode.test.tsx` 原有上传按钮测试失败 | 将原有上传按钮相关测试迁移到 `ImageNodeToolbar.test.tsx`，`ImageGenNode.test.tsx` 改为验证 Toolbar 组件是否渲染 |
| 工具条被其他节点遮挡 | `z-index: 10000`，高于节点默认 z-index（通常 1-100） |
| 按钮点击触发节点拖拽 | `nodrag nopan` 必须在**最外层容器**上（非内部行容器），确保所有子元素不受拖拽影响 |
| 边界检测在缩放时不准确 | 严格使用 `(nodeY - viewportY) / zoom` 计算真实可用空间 |
| 边界切换时位置跳变 | 对外层容器添加 `transition: all 0.15s ease`，使上下切换平滑过渡 |
| useViewport 导致父组件频繁重渲染 | `ImageNodeToolbar` 使用 `React.memo` + 扁平化原始值 props（`nodeX`/`nodeY` 等），确保浅比较命中；子组件无 hook 依赖 |
| 大量内联 SVG 增加文件体积 | 5 个自定义图标控制在 ~50 行以内，可接受 |

## 文件清单

| 操作 | 文件 |
|------|------|
| 新建 | `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.tsx` (~270 行) |
| 新建 | `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx` (~120 行) |
| 修改 | `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx` (替换 ~25 行) |
| 修改 | `apps/web/src/pages/canvas/components/nodes/ImageGenNode.test.tsx` (微调上传按钮断言) |
