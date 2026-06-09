# ImageNode + TextNode Toolbar Portal 重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 `createPortal` 将 ImageNodeToolbar 和 TextNodeToolbar 渲染到 Canvas 根容器层级，跳出节点 `.canvas-node` 的 stacking context，从根本上消除 Ctrl+滚轮缩放后工具条 z-order 遮挡 bug。

**Architecture:** 在 CanvasView.tsx 的 `reactFlowWrapper` 内添加 Portal 挂载点 `<div id="node-toolbar-portal">`。ImageNodeToolbar 和 TextNodeToolbar 内部通过 `useInternalNode(id)` 获取节点的 measured 尺寸，结合 `useViewport()` 将画布坐标转为视口像素坐标，经 `useMemo` 缓存后通过 `createPortal` 渲染到挂载点。工具条不再依赖 `scale(1/zoom)` 补偿（Portal 渲染在原生像素坐标系中），不再作为节点的绝对定位子元素（消除 stacking context 冲突）。

**Tech Stack:** React 18, @xyflow/react v12.10.2, Vitest, @testing-library/react, TypeScript strict mode

---

### Task 1: CanvasView — 添加 Portal 挂载点

**Files:**
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx`
- Verify: `apps/web/src/pages/canvas/components/CanvasView.test.tsx`

- [ ] **Step 1: 在 CanvasView 中添加 Portal 挂载点**

在 `<ReactFlow>` 同级的 `reactFlowWrapper` 容器内添加 portal 挂载 div：

```tsx
// CanvasView.tsx, return block (line 146-202)
return (
  <div ref={reactFlowWrapper} className="w-full h-full">
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={wrappedOnNodesChange as OnNodesChange}
      onEdgesChange={onEdgesChange as OnEdgesChange}
      onConnect={onConnect as any}
      isValidConnection={isValidConnection as any}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultViewport={viewport}
      onViewportChange={updateViewport}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      deleteKeyCode={['Backspace', 'Delete']}
      multiSelectionKeyCode="Shift"
      minZoom={0.2}
      maxZoom={3}
      fitView={false}
      zoomOnScroll={false}
      panOnScroll={true}
      snapToGrid={snapEnabled}
      snapGrid={[20, 20]}
      noWheelClassName="nowheel"
      proOptions={{ hideAttribution: true }}
      className="bg-[#000000]"
    >
      <Background variant={BackgroundVariant.Dots} color="#555555" gap={16} size={1} />
      {minimapOpen && (
        <MiniMap
          style={{
            width: 160,
            height: 120,
            backgroundColor: 'rgb(50, 50, 50)',
            border: '0.5px solid rgb(70, 70, 70)',
            borderRadius: '8px',
          }}
          nodeColor={() => 'rgb(160, 160, 160)'}
          maskColor="rgba(0, 0, 0, 0.35)"
        />
      )}
      <CanvasToolbar
        zoom={viewport.zoom}
        onFitView={handleFitView}
        onZoomIn={() => zoomIn({ duration: 100 })}
        onZoomOut={() => zoomOut({ duration: 100 })}
        minimapOpen={minimapOpen}
        onToggleMinimap={() => setMinimapOpen((v) => !v)}
        snapEnabled={snapEnabled}
        onToggleSnap={() => setSnapEnabled((v) => !v)}
      />
    </ReactFlow>
    {/* 工具条 Portal 挂载点：最高层级，不拦截鼠标事件 */}
    <div
      id="node-toolbar-portal"
      className="absolute inset-0 pointer-events-none z-[99999]"
    />
  </div>
);
```

- [ ] **Step 2: 运行现有测试确认无回归**

```bash
npx vitest run apps/web/src/pages/canvas/components/CanvasView.test.tsx
```
Expected: PASS（现有用例全部通过）

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/canvas/components/CanvasView.tsx
git commit -m "feat: add portal mount point for node toolbars in CanvasView"
```

---

### Task 2: ImageNodeToolbar — 更新接口与 mock，写失败测试

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx`
- (实现文件暂不改，测试先红)

- [ ] **Step 1: 升级 mock，添加 `useInternalNode` mock**

```tsx
// ImageNodeToolbar.test.tsx — 替换现有 mock
const mockUseViewport = vi.fn(() => ({ x: 0, y: 0, zoom: 1 }));
const mockUseInternalNode = vi.fn(() => ({
  position: { x: 100, y: 200 },
  measured: { width: 300, height: 250 },
}));

vi.mock('@xyflow/react', () => ({
  useViewport: mockUseViewport,
  useInternalNode: mockUseInternalNode,
}));
```

- [ ] **Step 2: 更新 defaultProps，移除不需要的 props（zoom, nodeX/Y, viewportX/Y 由 hooks 内部获取）**

```tsx
const defaultProps = {
  fileId: 'img-123' as string | undefined,
  referenceImage: undefined as string | undefined,
  selected: true as boolean,
  nodeId: 'node-1',
  onUpload: undefined as (() => void) | undefined,
};
```

- [ ] **Step 3: 添加 Portal 渲染测试 — 工具条不在组件自身 DOM 中**

```tsx
it('renders toolbar via Portal (not as direct child of component)', () => {
  const portalRoot = document.createElement('div');
  portalRoot.id = 'node-toolbar-portal';
  document.body.appendChild(portalRoot);

  const { container } = render(<ImageNodeToolbar {...defaultProps} />);
  // 组件自身容器应该为空（Portal 将内容渲染到外部）
  expect(container.innerHTML).toBe('');

  document.body.removeChild(portalRoot);
});
```

- [ ] **Step 4: 添加无 scale transform 的测试**

```tsx
it('does NOT apply scale transform (Portal renders in native pixels)', () => {
  const portalRoot = document.createElement('div');
  portalRoot.id = 'node-toolbar-portal';
  document.body.appendChild(portalRoot);

  render(<ImageNodeToolbar {...defaultProps} />);
  const toolbar = screen.getByRole('toolbar');
  expect(toolbar.style.transform).not.toContain('scale');
  // 只应有 translateX(-50%) 水平居中
  expect(toolbar.style.transform).toContain('translateX(-50%)');

  document.body.removeChild(portalRoot);
});
```

- [ ] **Step 5: 添加视口坐标定位测试**

```tsx
it('positions toolbar using viewport pixel coordinates', () => {
  const portalRoot = document.createElement('div');
  portalRoot.id = 'node-toolbar-portal';
  document.body.appendChild(portalRoot);

  // nodeX=100, nodeWidth=300, zoom=1, vpX=0
  // viewCenterX = (100 + 300/2) * 1 + 0 = 250
  // viewTopY = 200 * 1 + 0 = 200 — enough space above (200 > 104) → showAbove
  // toolbarTop = 200 - 84 - 20 = 96
  render(<ImageNodeToolbar {...defaultProps} />);
  const toolbar = screen.getByRole('toolbar');
  expect(toolbar.style.left).toBe('250px');
  expect(toolbar.style.top).toBe('96px');

  document.body.removeChild(portalRoot);
});
```

- [ ] **Step 6: 添加 useInternalNode 返回 null 时不渲染的测试**

```tsx
it('renders nothing when useInternalNode returns no dimensions', () => {
  const portalRoot = document.createElement('div');
  portalRoot.id = 'node-toolbar-portal';
  document.body.appendChild(portalRoot);

  mockUseInternalNode.mockReturnValueOnce(null);

  const { container } = render(<ImageNodeToolbar {...defaultProps} />);
  expect(container.innerHTML).toBe('');

  document.body.removeChild(portalRoot);
});
```

- [ ] **Step 7: 更新受 Portal 影响的旧测试**

以下旧测试因 `container.firstChild` 指向空（Portal 渲染到外部）需要改为通过 `screen` API 或查询 portal target 验证：

| 旧测试 | 问题 | 修改 |
|--------|------|------|
| test 8 (scale) | scale 已被移除 | 改为验证 `transform` 不含 `scale` |
| test 9 (nodrag/nopan) | `container.firstChild` 为空 | 改为 `screen.getByRole('toolbar').classList.contains('nodrag')` |
| test 12 (showBelow) | `container.firstChild` 为空 | 改为 `screen.getByRole('toolbar').style.top` + 验证数值 |
| test 13 (showAbove) | `container.firstChild` 为空 | 改为 `screen.getByRole('toolbar').style.top` + 验证数值 |
| test 14 (transition-opacity) | `container.firstChild` 为空 | 改为 `screen.getByRole('toolbar').className` |
| test 15 (rounded-xl) | 查询从 `container` 改为 portal target | 改为 `document.querySelectorAll('[role="toolbar"] .rounded-xl')` |
| test 16 (gap-0.5) | 同上 | 改为 `document.querySelectorAll('[role="toolbar"] [class*="gap-0\\.5"]')` |

```tsx
// 示例：test 8 替换为
it('does NOT apply scale transform (Portal renders in native pixels)', () => {
  const portalRoot = document.createElement('div');
  portalRoot.id = 'node-toolbar-portal';
  document.body.appendChild(portalRoot);
  render(<ImageNodeToolbar {...defaultProps} />);
  const toolbar = screen.getByRole('toolbar');
  expect(toolbar.style.transform).not.toContain('scale');
  expect(toolbar.style.transform).toContain('translateX(-50%)');
  document.body.removeChild(portalRoot);
});

// 示例：test 9 替换为
it('outer container has nodrag and nopan classes', () => {
  const portalRoot = document.createElement('div');
  portalRoot.id = 'node-toolbar-portal';
  document.body.appendChild(portalRoot);
  render(<ImageNodeToolbar {...defaultProps} />);
  const toolbar = screen.getByRole('toolbar');
  expect(toolbar.classList.contains('nodrag')).toBe(true);
  expect(toolbar.classList.contains('nopan')).toBe(true);
  document.body.removeChild(portalRoot);
});

// 示例：test 12 替换为（nodeY=100, viewportY=50 → showBelow）
it('shows toolbar below when viewTopY < TOOLBAR_HEIGHT + MARGIN', () => {
  const portalRoot = document.createElement('div');
  portalRoot.id = 'node-toolbar-portal';
  document.body.appendChild(portalRoot);
  // nodeY=100, zoom=1, vpY=0 → viewTopY=100 < 104 → showBelow
  mockUseInternalNode.mockReturnValue({
    position: { x: 100, y: 100 },
    measured: { width: 300, height: 250 },
  });
  render(<ImageNodeToolbar {...defaultProps} />);
  const toolbar = screen.getByRole('toolbar');
  // viewBottomY = (100 + 250) * 1 + 0 = 350, toolbarTop = 350 + 20 = 370
  expect(toolbar.style.top).toBe('370px');
  document.body.removeChild(portalRoot);
});

// 示例：test 13 替换为（nodeY=300 → viewTopY=300 >= 104 → showAbove）
it('shows toolbar above when viewTopY >= TOOLBAR_HEIGHT + MARGIN', () => {
  const portalRoot = document.createElement('div');
  portalRoot.id = 'node-toolbar-portal';
  document.body.appendChild(portalRoot);
  mockUseInternalNode.mockReturnValue({
    position: { x: 100, y: 300 },
    measured: { width: 300, height: 250 },
  });
  render(<ImageNodeToolbar {...defaultProps} />);
  const toolbar = screen.getByRole('toolbar');
  // viewTopY = 300 * 1 + 0 = 300, toolbarTop = 300 - 84 - 20 = 196
  expect(toolbar.style.top).toBe('196px');
  document.body.removeChild(portalRoot);
});
```

- [ ] **Step 8: 运行测试确认全部失败（RED）**

```bash
npx vitest run apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx
```
Expected: 新增 Portal 测试 + 更新后的旧测试全部 FAIL（实现代码尚未修改）

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx
git commit -m "test: add failing Portal-render tests for ImageNodeToolbar"
```

---

### Task 3: ImageNodeToolbar — 实现 Portal 渲染

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.tsx`

- [ ] **Step 1: 更新 import 和 interface**

```tsx
import { memo, useState, useEffect, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useViewport, useInternalNode } from '@xyflow/react';

interface ImageNodeToolbarProps {
  nodeId: string;
  fileId?: string;
  referenceImage?: string;
  selected: boolean;
  onUpload?: () => void;
}
```

- [ ] **Step 2: 在主组件开头添加 hooks 和定位计算**

在 `function ImageNodeToolbarComponent` 函数体的最顶部（before the `if (!selected) return null` check）添加：

```tsx
function ImageNodeToolbarComponent({
  nodeId,
  fileId,
  referenceImage,
  selected,
  onUpload = () => {},
}: ImageNodeToolbarProps) {
  const { x: vpX, y: vpY, zoom } = useViewport();
  const internalNode = useInternalNode(nodeId);

  // 窗口尺寸追踪（轻量，无额外依赖）
  const [windowSize, setWindowSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  useEffect(() => {
    const onResize = () =>
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const { width: windowWidth, height: windowHeight } = windowSize;

  if (!selected) return null;

  // 空值保护
  if (!internalNode?.measured?.width || !internalNode?.measured?.height) return null;

  const { x: nodeX, y: nodeY } = internalNode.position;
  const { width: nodeWidth, height: nodeHeight } = internalNode.measured;

  const hasImage = !!fileId || !!referenceImage;

  const position = useMemo(() => {
    const viewCenterX = (nodeX + nodeWidth / 2) * zoom + vpX;
    const viewTopY = nodeY * zoom + vpY;
    const viewBottomY = (nodeY + nodeHeight) * zoom + vpY;

    const showBelow = viewTopY < TOOLBAR_HEIGHT + MARGIN;
    const toolbarTop = showBelow
      ? viewBottomY + MARGIN
      : viewTopY - TOOLBAR_HEIGHT - MARGIN;

    const toolbarLeft = Math.max(
      VIEWPORT_PADDING,
      Math.min(viewCenterX, windowWidth - VIEWPORT_PADDING),
    );

    const isVisible =
      viewBottomY > -nodeHeight * zoom &&
      viewTopY < windowHeight + nodeHeight * zoom;
    // (简化：只要节点不完全在视口很远之外就渲染)

    return { toolbarLeft, toolbarTop, isVisible };
  }, [nodeX, nodeY, nodeWidth, nodeHeight, vpX, vpY, zoom, windowWidth, windowHeight]);

  if (!position.isVisible) return null;

  // ... 继续使用 hasImage 渲染逻辑
```

- [ ] **Step 3: 无图片的上传按钮 — 用 Portal 渲染**

```tsx
if (!hasImage) {
  return createPortal(
    <div
      className="nodrag nopan flex flex-col items-center gap-1 transition-opacity duration-150 pointer-events-auto"
      style={{
        left: position.toolbarLeft,
        top: position.toolbarTop,
        transform: 'translateX(-50%)',
        zIndex: 10000,
        willChange: 'left, top',
      }}
    >
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-full border border-white/10 bg-[#222222]/80 backdrop-blur-lg text-[#ccc] px-3 py-2"
        onClick={onUpload}
      >
        <UploadIcon />
        <span className="text-sm">上传</span>
      </button>
    </div>,
    document.getElementById('node-toolbar-portal')!,
  );
}
```

- [ ] **Step 4: 有图片的完整工具栏 — 用 Portal 渲染**

```tsx
return createPortal(
  <div
    className="nodrag nopan flex flex-col items-center gap-1 transition-opacity duration-150 pointer-events-auto"
    role="toolbar"
    style={{
      left: position.toolbarLeft,
      top: position.toolbarTop,
      transform: 'translateX(-50%)',
      zIndex: 10000,
      willChange: 'left, top',
    }}
  >
    <style>{`
      .${BTN_CLASS}:hover {
        background-color: ${BTN_BG_HOVER} !important;
      }
    `}</style>

    {/* Row 1 — unchanged */}
    <div
      className="flex items-center gap-0.5 rounded-xl px-1 py-1"
      style={{
        backgroundColor: BAR_BG,
        border: `0.5px solid ${BAR_BORDER}`,
        backdropFilter: 'blur(8px)',
      }}
    >
      <IconButton icon={<RotateCcwIcon />} ariaLabel="逆时针旋转" />
      <IconButton icon={<RotateCwIcon />} ariaLabel="顺时针旋转" />
      <Divider />
      <TextIconButton icon={<LayersIcon />} ariaLabel="分离" text="分离" />
      <TextIconButton icon={<CropIcon />} ariaLabel="裁切" text="裁切" />
      <TextIconButton icon={<ExpandImageIcon />} ariaLabel="扩图" text="扩图" />
      <TextIconButton icon={<EraserIcon />} ariaLabel="擦除" text="擦除" />
      <TextIconButton icon={<PaintbrushIcon />} ariaLabel="重绘" text="重绘" />
      <TextIconButton icon={<TypeIcon />} ariaLabel="文字" text="文字" />
      <TextIconButton icon={<ShirtIcon />} ariaLabel="换装" text="换装" />
    </div>

    {/* Row 2 — unchanged */}
    <div
      className="flex items-center gap-0.5 rounded-xl px-1 py-1"
      style={{
        backgroundColor: BAR_BG,
        border: `0.5px solid ${BAR_BORDER}`,
        backdropFilter: 'blur(8px)',
      }}
    >
      <TextIconButton icon={<SunIcon />} ariaLabel="打光" text="打光" />
      <TextIconButton icon={<Camera3DIcon />} ariaLabel="3D 角度" text="3D 角度" />
      <TextIconButton icon={<PenLineIcon />} ariaLabel="涂鸦" text="涂鸦" />
      <TextIconButton icon={<HDIcon />} ariaLabel="高清增强" text="高清增强" />
      <TextIconButton icon={<Grid3x3Icon />} ariaLabel="九宫格" text="九宫格" />
      <Divider />
      <IconButton icon={<ExpandIcon />} ariaLabel="放大查看" />
      <IconButton icon={<UploadIcon />} ariaLabel="上传" />
      <IconButton icon={<DownloadIcon />} ariaLabel="下载" />
      <Divider />
      <IconButton icon={<CopyIcon />} ariaLabel="复制" />
      <IconButton
        icon={<TrashIcon />}
        ariaLabel="删除"
        className="hover:text-red-400 hover:bg-red-500/10"
      />
    </div>
  </div>,
  document.getElementById('node-toolbar-portal')!,
);
```

- [ ] **Step 5: 添加 VIEWPORT_PADDING 常量**

在已有的 `TOOLBAR_HEIGHT = 84` 和 `MARGIN = 20` 下面添加：

```tsx
const VIEWPORT_PADDING = 10;
```

- [ ] **Step 6: 运行测试确认通过（GREEN）**

```bash
npx vitest run apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx
```
Expected: 全部 PASS

- [ ] **Step 7: 运行全量测试确认无回归**

```bash
npx vitest run
```
Expected: PASS（或已有不相关失败不变）

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.tsx
git commit -m "feat: migrate ImageNodeToolbar to Portal rendering"
```

---

### Task 4: ImageGenNode — 清理旧 props

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx`

- [ ] **Step 1: 更新 ImageNodeToolbar 的 props 传递**

移除 `zoom`, `nodeX`, `nodeY`, `viewportX`, `viewportY` props，改用 `nodeId`：

```tsx
// 替换 lines 192-202 (ImageNodeToolbar 调用处)
<ImageNodeToolbar
  nodeId={id}
  fileId={fileId}
  referenceImage={referenceImage}
  selected={selected ?? false}
  onUpload={() => fileInputRef.current?.click()}
/>
```

- [ ] **Step 2: 清理不再需要的 viewport import**

移除 `useViewport` 的解构（line 51）中不再需要的变量。检查 `vpX` 和 `vpY` 是否被其他地方引用。

`vpX` 和 `vpY` 在 ImageGenNode 中仅用于传递给 ImageNodeToolbar。移除后检查整个组件：

```tsx
// line 51: 原来是 const { x: vpX, y: vpY, zoom } = useViewport();
// 改为:
const { zoom } = useViewport();
```

如果 `vpX`, `vpY` 在别处未使用，清理它们。

- [ ] **Step 3: 运行现有测试确认通过**

```bash
npx vitest run apps/web/src/pages/canvas/components/nodes/ImageGenNode.test.tsx
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx
git commit -m "refactor: simplify ImageGenNode, toolbar props now via hooks"
```

---

### Task 5: TextNodeToolbar — 更新 mock，写失败测试

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/TextNodeToolbar.test.tsx`

- [ ] **Step 1: 升级 mock，添加 `useInternalNode` mock**

```tsx
// TextNodeToolbar.test.tsx — 替换现有 mock
vi.mock('@xyflow/react', () => ({
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  useInternalNode: (id: string) => ({
    position: { x: 100, y: 200 },
    measured: { width: 400, height: 350 },
  }),
}));
```

- [ ] **Step 2: 添加 Portal 渲染测试**

```tsx
it('renders toolbar via Portal (not as direct child of component)', () => {
  const portalRoot = document.createElement('div');
  portalRoot.id = 'node-toolbar-portal';
  document.body.appendChild(portalRoot);

  const { container } = render(<TextNodeToolbar nodeId="n1" editor={mockEditor} />);
  expect(container.innerHTML).toBe('');

  document.body.removeChild(portalRoot);
});
```

- [ ] **Step 3: 添加无 scale transform 测试**

```tsx
it('does NOT apply scale transform (Portal renders in native pixels)', () => {
  const portalRoot = document.createElement('div');
  portalRoot.id = 'node-toolbar-portal';
  document.body.appendChild(portalRoot);

  render(<TextNodeToolbar nodeId="n1" editor={mockEditor} />);
  const toolbar = document.querySelector('[class*="nodrag"][class*="pointer-events-auto"]') as HTMLElement;
  expect(toolbar).not.toBeNull();
  expect(toolbar.style.transform).not.toContain('scale');
  expect(toolbar.style.transform).toContain('translateX(-50%)');

  document.body.removeChild(portalRoot);
});
```

- [ ] **Step 4: 运行测试确认新测试失败（RED）**

```bash
npx vitest run apps/web/src/pages/canvas/components/nodes/TextNodeToolbar.test.tsx
```
Expected: 2 个新增测试 FAIL

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/TextNodeToolbar.test.tsx
git commit -m "test: add failing Portal-render tests for TextNodeToolbar"
```

---

### Task 6: TextNodeToolbar — 实现 Portal 渲染

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/TextNodeToolbar.tsx`

- [ ] **Step 1: 添加 import 和定位 hooks**

```tsx
import { memo, useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useViewport, useInternalNode } from '@xyflow/react';
```

- [ ] **Step 2: 在组件函数体开头添加定位逻辑**

```tsx
function TextNodeToolbarComponent({ nodeId, editor, onBgColorChange, currentBgColor, onFullscreen }: Props) {
  const { x: vpX, y: vpY, zoom } = useViewport();
  const internalNode = useInternalNode(nodeId);

  // 窗口尺寸追踪
  const [windowSize, setWindowSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  useEffect(() => {
    const onResize = () =>
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const { width: windowWidth, height: windowHeight } = windowSize;

  // Force re-render when editor selection/state changes
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const update = () => setTick((t) => t + 1);
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
    };
  }, [editor]);

  // ... (background color dropdown state, callbacks, etc. — unchanged)

  // 空值保护
  if (!internalNode?.measured?.width || !internalNode?.measured?.height) return null;

  const { x: nodeX, y: nodeY } = internalNode.position;
  const { width: nodeWidth, height: nodeHeight } = internalNode.measured;

  const TOOLBAR_HEIGHT = 46; // 文本工具条单行高度约 46px
  const MARGIN = 20;
  const VIEWPORT_PADDING = 10;

  const position = useMemo(() => {
    const viewCenterX = (nodeX + nodeWidth / 2) * zoom + vpX;
    const viewTopY = nodeY * zoom + vpY;
    const viewBottomY = (nodeY + nodeHeight) * zoom + vpY;

    const showBelow = viewTopY < TOOLBAR_HEIGHT + MARGIN;
    const toolbarTop = showBelow
      ? viewBottomY + MARGIN
      : viewTopY - TOOLBAR_HEIGHT - MARGIN;

    const toolbarLeft = Math.max(
      VIEWPORT_PADDING,
      Math.min(viewCenterX, windowWidth - VIEWPORT_PADDING),
    );

    const isVisible =
      viewBottomY > -nodeHeight * zoom &&
      viewTopY < windowHeight + nodeHeight * zoom;

    return { toolbarLeft, toolbarTop, isVisible };
  }, [nodeX, nodeY, nodeWidth, nodeHeight, vpX, vpY, zoom, windowWidth, windowHeight]);

  if (!position.isVisible) return null;
```

- [ ] **Step 3: 用 createPortal 包裹现有 toolbar DOM，移除 scale 并添加定位**

将 `return (...)` 改为 `return createPortal(...)`，并更新最外层 div 的 style：

```tsx
return createPortal(
  <div
    className="nodrag pointer-events-auto flex items-center gap-[2px] px-1 py-1 rounded-full bg-[#222]/80 backdrop-blur-lg text-white/90"
    style={{
      left: position.toolbarLeft,
      top: position.toolbarTop,
      transform: 'translateX(-50%)',
      zIndex: 10000,
      willChange: 'left, top',
      border: '1px solid #3F3F46',
    }}
    onMouseDown={(e) => e.preventDefault()}
  >
    {/* ... 所有按钮内容保持不变 ... */}
  </div>,
  document.getElementById('node-toolbar-portal')!,
);
```

注意：原代码中的 `transform: scale(${1/zoom})` 和 `transformOrigin: 'bottom center'` 已移除。

- [ ] **Step 4: 运行测试确认通过（GREEN）**

```bash
npx vitest run apps/web/src/pages/canvas/components/nodes/TextNodeToolbar.test.tsx
```
Expected: 全部 PASS

- [ ] **Step 5: 运行全量测试确认无回归**

```bash
npx vitest run
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/TextNodeToolbar.tsx
git commit -m "feat: migrate TextNodeToolbar to Portal rendering"
```

---

### Task 7: TextInputNode — 清理旧 wrapper，更新测试

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/TextInputNode.tsx`
- Verify: `apps/web/src/pages/canvas/components/nodes/TextInputNode.test.tsx`

- [ ] **Step 1: 移除外层 absolute 定位 wrapper**

```tsx
// 替换 lines 198-209 (TextNodeToolbar 调用处)
// Before:
// {selected && (
//   <div className="absolute left-1/2 -translate-x-1/2 z-10" style={{ top: -80 }}>
//     <TextNodeToolbar ... />
//   </div>
// )}

// After:
{selected && (
  <TextNodeToolbar
    nodeId={id}
    editor={editor}
    onBgColorChange={setBgColor}
    currentBgColor={bgColor}
    onFullscreen={() => setFullscreen(true)}
  />
)}
```

- [ ] **Step 2: 运行测试确认通过**

```bash
npx vitest run apps/web/src/pages/canvas/components/nodes/TextInputNode.test.tsx
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/TextInputNode.tsx
git commit -m "refactor: remove absolute wrapper from TextNodeToolbar in TextInputNode"
```

---

### Task 8: 全量测试 + 浏览器验证

- [ ] **Step 1: 运行全量测试**

```bash
npx vitest run
```
Expected: 全部 PASS

- [ ] **Step 2: 启动 dev server 进行浏览器验证**

```bash
# Ensure dev server is running on port 5173
```

验证 checklist（需要登录 canvas 页面，选中图片/文本节点）：

1. 选中图片节点 → 工具条在节点上方正常显示
2. Ctrl+滚轮快速缩放 20+ 次 → 工具条始终在图片上方，不被遮挡
3. 不同缩放级别（0.2x ~ 3x）下工具条位置正确、按钮可点击
4. 拖动节点到视口顶部 → 工具条自动切换到下方显示
5. 选中文本节点 → 工具条在节点上方正常显示，格式化按钮可交互
6. Chrome DevTools Layers 面板 → 工具条在独立合成层，z-order 高于节点层
7. 多个节点选中时 → 工具条互不遮挡

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: final verification after toolbar Portal refactor"
```
