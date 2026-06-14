# Edge Flow Animation — 选中节点连线动画

**日期**: 2026-06-14
**状态**: Draft

## 概述

在 React Flow 画布中，当节点被选中时，与该节点相连的所有边显示双向粒子流动动画。视觉上传达"数据流经该节点"的感觉。

## 设计决策

| 维度 | 决策 | 理由 |
|------|------|------|
| 触发范围 | 选中节点的所有相连边（入 + 出，1 跳） | 选中 → 周边完整连接关系 |
| 动画效果 | `<animateMotion>` SVG 粒子 | 官方推荐，GPU 加速，性能优于 stroke-dasharray |
| 流向 | 双向 | 选中↔邻居对向流动 |
| 粒子颜色 | 统一定义 CSS 变量 `--edge-flow-color`，默认 `#3B82F6` | 不区分方向，对接设计系统，兼容主题切换 |
| 多选 | 所有选中节点各自触发 | 多节点选中时所有关系边都动 |
| 非激活态 | 粒子 DOM 不挂载 | 减少 SVG 节点数，降低渲染压力 |
| 过渡 | 300ms CSS opacity 淡入淡出 + 延迟卸载 + 定时器清理 | 避免硬切闪烁，防止内存泄漏 |
| 大片降级 | 预留 `maxConnectedEdges` 配置项，本次不启用 | 单节点关联边 > 20 条时可降级为仅高亮连线 |

## 文件结构

```
apps/web/src/pages/canvas/components/edges/
├── ConnectionLine.tsx        ← 主边组件（改造）
├── EdgeFlowParticles.tsx     ← 粒子动画组件（新建）
└── edgeParticleConfig.ts     ← 动画参数常量（新建）
```

## 架构

### 组件层级

```
ConnectionLine
├── BaseEdge ────────────────────── 底层贝塞尔路径（现有 stroke 逻辑不变）
├── HighlightOverlay ────────────── 端点选中高亮叠加层
│                                  条件: isActive && !isEdgeSelected
├── <g> class="edge-flow-particles" 过渡容器
│     (transition: opacity 300ms ease, pointer-events: none)
│   ├── EdgeFlowParticles (dir="outward")
│   └── EdgeFlowParticles (dir="inward")
└── EdgeLabelRenderer ───────────── 边选中时的删除按钮（现有逻辑不变）
```

### 样式优先级（连线）

优先级从高到低：

1. **边自身选中**：橙色加粗 `#f59e0b` / width 3（现有逻辑，不改）
2. **端点节点选中（新增）**：叠加层高亮路径 `#999` / width 2，条件 `isActive && !isEdgeSelected`
3. **默认态**：`#888` / width 2（现有逻辑，不改）

叠加层仅在端点选中且边自身未被选中时显示。边自身选中时叠加层自动隐藏，完全让位给原生选中样式。

### 数据流

```ts
// 单 selector，一次订阅，返回原始布尔值（Object.is 精准命中缓存）
const isActive = useStore((state) => {
  const sourceSelected = state.nodeInternals.get(source)?.selected ?? false;
  const targetSelected = state.nodeInternals.get(target)?.selected ?? false;
  return sourceSelected || targetSelected;
});
```

- 每条边仅一次 `useStore` 订阅
- O(1) 查找 `nodeInternals` Map
- 返回原始 boolean，`Object.is` 可比
- 仅 source 或 target 选中状态变化时触发重渲染

不修改 canvasStore、nodeStore、任何 node 组件。

## 视觉设计

### 粒子参数 (`edgeParticleConfig.ts`)

```ts
export const EDGE_PARTICLE_CONFIG = {
  count: 3,              // 单方向粒子数
  radius: 3,             // 粒子半径 (px)
  duration: 2000,        // 单次流动时长 (ms)
  stagger: duration / count,  // 同方向粒子时间间隔 (~667ms)
  directionOffset: duration / 2,  // 双向粒子组错开半周期，避免路径中点扎堆
  maxConnectedEdges: 20, // 预留：超阈值自动降级为仅高亮，本次不实现
} as const;
```

### 粒子颜色

```css
--edge-flow-color: #3B82F6;
```

粒子组件通过 CSS 变量引用颜色，兼容深色/浅色主题切换。

### 双向粒子 SVG 实现

正向粒子（source → target）：
```tsx
<circle r={radius} fill={`var(--edge-flow-color)`}>
  <animateMotion
    path={pathD}
    dur={`${duration}ms`}
    begin={`${index * stagger}ms`}
    repeatCount="indefinite"
    calcMode="linear"
  />
</circle>
```

反向粒子（target → source）：
```tsx
<circle r={radius} fill={`var(--edge-flow-color)`}>
  <animateMotion
    path={pathD}
    dur={`${duration}ms`}
    begin={`${directionOffset + index * stagger}ms`}
    repeatCount="indefinite"
    calcMode="linear"
    keyPoints="1;0"
    keyTimes="0;1"
  />
</circle>
```

关键规则：
- 反向不反转 pathD，通过 `keyPoints="1;0"` + `keyTimes="0;1"`（严格递增）实现
- 正反双向均声明 `calcMode="linear"`，确保时间与路径位置线性对应，跨浏览器一致
- 双向粒子组错开 `directionOffset`（半周期），避免双向粒子在路径中点扎堆
- 同方向粒子依次延迟 `index * stagger`

## 过渡效果

### 淡入淡出

作用于粒子外层 `<g>` 容器：

```css
.edge-flow-particles {
  transition: opacity 300ms ease;
  pointer-events: none;  /* 不遮挡连线的点击、悬停交互 */
}
```

### 淡入淡出 + 延迟卸载

```
激活:  setVisible(true) → 下一帧 opacity 0→1 (300ms ease)
退出:  opacity 1→0 (300ms ease) → setTimeout 300ms → setVisible(false)
```

### 定时器清理（防泄漏）

```ts
const unmountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

useEffect(() => {
  if (isActive) {
    setVisible(true);
    if (unmountTimerRef.current) {
      clearTimeout(unmountTimerRef.current);
      unmountTimerRef.current = null;
    }
  } else {
    unmountTimerRef.current = setTimeout(() => setVisible(false), 300);
  }
  return () => {
    if (unmountTimerRef.current) {
      clearTimeout(unmountTimerRef.current);
    }
  };
}, [isActive]);
```

规则：
- 退出过渡过程中重新激活 → 清除卸载定时器
- 组件卸载 → 清除所有定时器
- `useRef` 持有 timer ID，避免闭包过期

### GPU 加速

粒子容器设置 `will-change: transform`，强制走 GPU 合成层。

## 无障碍

```css
@media (prefers-reduced-motion: reduce) {
  .edge-flow-particles {
    display: none;
  }
}
```

开启系统"减少动画"偏好时，隐藏粒子动画，仅保留连线提亮效果。

## 边界场景验证清单

实现后逐项验证：

| 场景 | 预期行为 | 原理 |
|------|---------|------|
| 自连边（self-loop） | 双向粒子正常流动，无重叠 | source === target，判断逻辑仍返回 true，keyPoints 错位 |
| 两端同时选中 | isActive 仍为 true，无双倍粒子 | `||` 短路求值，只返回一个 true |
| 节点删除瞬间 | 无报错，粒子消失 | `nodeInternals.get()` 返回 undefined，`?? false` 兜底 |
| 画布缩放/平移 | 粒子随节点位置同步，动画连续无跳变 | 粒子复用连线 pathD，路径随节点实时更新 |
| 临时拖拽连线 | 不触发动画 | 走独立 `connectionLineComponent`，非 ConnectionLine |
| 边隐藏/禁用 | 粒子同步不渲染 | 继承 `hidden` 逻辑 |

## 测试策略

### 单元测试

1. `EdgeFlowParticles` — 传入 pathD + direction，验证正确数量的粒子；outward 不使用 keyPoints，inward 使用 `keyPoints="1;0"` + `calcMode="linear"`
2. `ConnectionLine` — mock `useStore` 返回不同 `nodeInternals`，验证 isActive 判断和粒子组挂载/卸载
3. 延迟卸载 — fake timers 验证 300ms 后 visible 变 false
4. 定时器清理 — 退出激活 + 300ms 内重新激活，验证 timer 被清除
5. 高亮叠加层 — `isActive && !isEdgeSelected` 时渲染，`isEdgeSelected=true` 时不渲染
6. 边界场景 — nodeInternals.get 返回 undefined 时不报错

### 集成测试

1. 点击节点选中 → 相连边出现粒子 + 高亮叠加层
2. 点击空白取消选中 → 粒子 300ms 淡出后消失
3. Ctrl+点击两个节点 → 两个节点的相连边都出现粒子
4. 拖拽选中节点 → 粒子不闪烁（验证订阅粒度）
5. 删除选中节点 → 粒子消失 + 定时器清理
6. 多节点密集场景 → 粒子不卡顿（性能验证）

## 不变项

- 现有 `ConnectionLine` 的选中/删除按钮逻辑不改变
- 现有 node 组件不做任何修改
- 现有 store 不做任何修改
- 现有 React Flow edgeTypes 注册方式不变（仍为 `default: ConnectionLine`）
