<!-- doc-status: historical | verified_at: n/a -->
# Spec: 图片节点悬浮工具条 Ctrl+滚轮缩放后 z-order 异常

## 问题描述

Canvas 页面，选中图片节点后出现悬浮工具条。用户通过 Ctrl+鼠标滚轮缩放画布后，**有一定几率**工具条跑到图片节点下面（z-order 被遮挡）。

## 根因分析

### 核心根因：浏览器合成器时序竞态（Stacking Context 冲突）

```
div.relative.canvas-node          ← transform: translate(x,y) → stacking context A (React Flow 每帧更新)
├── ImageNodeToolbar              ← absolute, zIndex: 10000 → stacking context B (scale(1/zoom) 每帧更新)
├── div.absolute.z-[1]            ← 标题栏
├── div (static, no z-index)
│   └── div.relative.group        ← stacking context C (图片内容区)
└── ImageConfigPanel              ← absolute, z-50
```

**竞态过程：**

1. React Flow 在 100ms 动画期间**每一帧**更新 `.canvas-node` 的 `transform: translate(x,y)`
2. 同时，工具条也**每一帧**通过 `useViewport()` 获取新 zoom 值，更新自己的 `transform: scale(1/zoom)`
3. 当两个 transform 更新不在同一帧时，浏览器合成器临时重建 stacking context A
4. 重建过程中子元素 z-index 排序被重置，工具条被画到图片下面
5. 完全取决于 GPU 合成器线程调度顺序 → 解释"有一定几率"

### 次要因素：`1/zoom` 无安全保护

commit `f1e9fa6` 修复了 zoom=0/undefined 导致 Infinity 的问题，但 `ImageNodeToolbar` 和 `TextNodeToolbar` 的 `scale(1/zoom)` 未加保护，动画中间帧的极端值加剧合成器异常。

### ~~假设 B：浏览器原生缩放未被阻止~~（已排除）

浏览器原生缩放触发会是整页缩放，不会仅工具条 z-order 异常。且已正确设置 `preventDefault()` + `{ passive: false }`。

## 修复方案

### Portal 重构（根本解决，约 1.5 小时）

**原理**：用 `createPortal` 将工具条渲染到 Canvas 根容器层级，跳出 `.canvas-node` 的 stacking context。Portal 渲染的元素在原生 DOM 像素坐标系中，**不需要 `scale(1/zoom)`** 缩放补偿。

**坐标转换**（`viewport.x/y` = 画布原点在视口中的像素偏移）：

```
viewX = flowX * zoom + viewportX      // 画布坐标 → 视口像素坐标
viewY = flowY * zoom + viewportY
```

**改造清单**：

| # | 文件 | 改动 |
|---|------|------|
| 1 | `CanvasView.tsx` | 在 `reactFlowWrapper` 内添加 portal 挂载点 |
| 2 | `ImageNodeToolbar.tsx` | 用 `useInternalNode(id)` 获取 `measured.width/height`；视口坐标定位；`createPortal` 渲染；去掉 `scale(1/zoom)` |
| 3 | `TextNodeToolbar.tsx` | 同样 Portal 改造 |
| 4 | `ImageGenNode.tsx` | 工具栏改为通过 Portal 渲染（不再作为子元素） |

**ImageNodeToolbar 定位逻辑**：

```tsx
import { useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useInternalNode } from '@xyflow/react';

const TOOLBAR_HEIGHT = 84;
const MARGIN = 20;
const VIEWPORT_PADDING = 10;

// 窗口尺寸（轻量实现，无需额外依赖）
const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });
useEffect(() => {
  const onResize = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight });
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}, []);
const { width: windowWidth, height: windowHeight } = windowSize;

const node = useInternalNode(nodeId);

// 空值保护：节点未初始化或不完整时不渲染
if (!node?.measured?.width || !node?.measured?.height) return null;

const { x: nodeX, y: nodeY } = node.position;
const { width: nodeWidth, height: nodeHeight } = node.measured;

const position = useMemo(() => {
  const viewCenterX = (nodeX + nodeWidth / 2) * zoom + vpX;
  const viewTopY    = nodeY * zoom + vpY;
  const viewBottomY = (nodeY + nodeHeight) * zoom + vpY;

  // 上下切换：节点顶部太靠近视口顶部 → 显示在下方
  const showBelow = viewTopY < TOOLBAR_HEIGHT + MARGIN;
  const toolbarTop = showBelow
    ? viewBottomY + MARGIN
    : viewTopY - TOOLBAR_HEIGHT - MARGIN;

  // 水平边界裁剪，防止工具条超出视口
  const toolbarLeft = Math.max(
    VIEWPORT_PADDING,
    Math.min(viewCenterX, windowWidth - VIEWPORT_PADDING),
  );

  // 节点完全在视口外时不渲染
  const isVisible =
    viewBottomY > 0 &&
    viewTopY < windowHeight &&
    viewCenterX > -nodeWidth * zoom &&
    viewCenterX < windowWidth + nodeWidth * zoom;

  return { toolbarLeft, toolbarTop, isVisible };
}, [nodeX, nodeY, nodeWidth, nodeHeight, vpX, vpY, zoom, windowWidth, windowHeight]);

if (!position.isVisible) return null;

// 通过 Portal 渲染到 Canvas 根容器
style = {
  left: position.toolbarLeft,
  top: position.toolbarTop,
  transform: 'translateX(-50%)',   // 仅水平居中，无 scale！
  zIndex: 10000,
  willChange: 'left, top',
};
```

**旧代码清理**（Portal 完成后务必移除）：

- 工具条中的 `scale(1/zoom)` 变换
- 节点组件传递给工具条的 `width`/`height` props
- 工具条的 `absolute` 定位 + `bottom`/`top: calc(100% + 32px)` 样式
- ImageGenNode.tsx 中传递 `nodeX`/`nodeY`/`viewportX`/`viewportY` 的 props（工具条自行通过 hooks 获取）

**Portal 挂载点**（CanvasView.tsx）：

```tsx
<div ref={reactFlowWrapper} className="w-full h-full">
  <ReactFlow ... />
  {/* 工具条 Portal 挂载点：最高层级，不拦截鼠标事件 */}
  <div
    id="node-toolbar-portal"
    className="absolute inset-0 pointer-events-none z-[99999]"
  />
</div>
```

### 不推荐方案（仅作记录）

- ~~捕获阶段 wheel 监听~~：不能解决 stacking context 根因，可能干扰 React Flow
- ~~仅提升 z-index~~：在不同 stacking context 之间无效

## 验证方法

### 功能验证
1. 选中图片节点，工具条在节点上方正常显示
2. 快速连续 Ctrl+滚轮缩放到底（0.2x）再放大（3x），反复 20+ 次
3. 确认工具条始终在图片上方，不被遮挡
4. 不同缩放级别下工具条位置正确、按钮可点击
5. 工具条在节点上方空间不足时正确切换到下方显示

### Chrome DevTools 验证
6. Layers 面板确认工具条在独立合成层，z-order 高于所有节点层

### 边界场景
7. 同时拖拽节点 + Ctrl+滚轮缩放
8. 多个节点重叠时选中底层节点，工具条不被上层节点遮挡
9. 选中 5+ 节点同时显示工具条，快速缩放检查 FPS
10. 节点尺寸动态变化时（如图片加载完成），工具条位置自动更新
11. 节点被删除时工具条自动消失，无内存泄漏

### 回归验证
12. TextNodeToolbar 同样修复后功能正常
13. 工具条按钮交互（hover、点击上传、旋转等）不受影响
14. Safari 浏览器兼容性验证（合成器行为差异较大）
