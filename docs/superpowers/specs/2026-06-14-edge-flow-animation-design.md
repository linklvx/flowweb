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
├── BaseEdge ─────────────────── 底层贝塞尔路径（现有 stroke 逻辑不变）
├── HighlightOverlay ─────────── 端点选中时的高亮叠加层（新增 <path>，独立 opacity 控制）
├── <g> (visible && opacity) ─── 过渡容器
│   ├── EdgeFlowParticles (dir="outward")
│   └── EdgeFlowParticles (dir="inward")
└── EdgeLabelRenderer ────────── 边选中时的删除按钮（现有逻辑不变）
```

### 样式优先级（连线）

优先级从高到低：

1. **边自身选中**：橙色加粗 `#f59e0b` / width 3（现有逻辑，不改）
2. **端点节点选中（新增）**：叠加层高亮路径 `#999` / width 2
3. **默认态**：`#888` / width 2（现有逻辑，不改）

实现方式：不修改原有底层 path 的 stroke。端点选中时额外渲染一条透明度的叠加层 `<path>`，通过 CSS 类控制显隐。原有边选中、悬停等交互样式完全不受影响。

### 数据流

```
React Flow internal Store
  → useStore(nodeInternals.get(source))  ← O(1) 查找，只查当前边的两端节点
  → useStore(nodeInternals.get(target))  ← 同上
  → sourceNode?.selected || targetNode?.selected
  → isActive: boolean
  → 渲染粒子 + 高亮叠加层 / 不渲染
```

不修改 canvasStore、nodeStore、任何 node 组件。

## 视觉设计

### 粒子参数 (`edgeParticleConfig.ts`)

```ts
export const EDGE_PARTICLE_CONFIG = {
  count: 3,           // 单方向粒子数
  radius: 3,          // 粒子半径 (px)
  duration: 2000,     // 单次流动时长 (ms)
  stagger: duration / count,  // 粒子时间间隔
} as const;
```

### 粒子颜色

```css
--edge-flow-color: #3B82F6;
```

粒子组件通过 CSS 变量引用颜色，兼容深色/浅色主题切换，不写死色值。

### 双向粒子 SVG 实现

- **正向粒子（source → target）**：直接使用 `edgePath`，`<animateMotion>` 默认沿路径正向运动
- **反向粒子（target → source）**：使用 `keyPoints="1;0"` + `keyTimes="0;1"` 实现路径反向运动，**不反转 pathD**，保证路径与底层连线完全重合

## 性能设计

### 订阅粒度：仅查询当前边两端节点

利用 React Flow Store 内置的 `nodeInternals`（Map 结构，O(1) 查找）：

```ts
const isActive = useStore((state) => {
  const sourceNode = state.nodeInternals.get(source);
  const targetNode = state.nodeInternals.get(target);
  return !!(sourceNode?.selected || targetNode?.selected);
});
```

- 每个边仅查询自身 source 和 target 两个节点
- selector 计算成本固定 O(1)，不随节点总数增长
- 只有两端节点的选中状态变化时，才触发当前边重渲染
- 其余节点的任何变更（位置、数据、选中状态）完全不影响当前边

### 粒子 DOM 按需创建

```
isActive: false → <g> 不渲染（0 DOM 节点）
isActive: true  → 挂载 <g> + 6 个 <circle> + 6 个 <animateMotion>
退出激活       → opacity 1→0 过渡 300ms → 延迟 300ms 卸载
```

### GPU 加速

粒子容器设置 `will-change: transform`，强制动画走 GPU 合成层。

## 过渡与生命周期

### 淡入淡出 + 延迟卸载

```
激活:  setVisible(true) → 下一帧 opacity 0→1 (300ms ease)
退出:  opacity 1→0 (300ms ease) → setTimeout 300ms → setVisible(false)
```

### 定时器清理（防泄漏）

```ts
useEffect(() => {
  if (isActive) {
    setVisible(true);
    // 激活时清除待执行的卸载定时器
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

关键规则：
- 退出激活的 300ms 过渡过程中，若组件重新激活，必须清除待执行的卸载定时器
- 组件卸载时，必须清除所有待执行定时器
- 使用 `useRef` 持有 timer ID，避免闭包过期问题

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

以下场景天然兼容，实现后逐项验证：

- **自连边（self-loop）**：source 与 target 为同一 ID，`||` 判断正常生效，双向粒子通过 `keyPoints` 错位后无重叠问题
- **画布缩放**：粒子使用 SVG 原生单位，随画布 zoom 同步缩放，与连线粗细比例保持一致
- **临时拖拽连线**：走独立的 React Flow `connectionLineComponent`，不会误触发动画
- **边隐藏/禁用**：继承原有 `hidden` / `animated` 逻辑，边隐藏时粒子同步不渲染

## 测试策略

### 单元测试

1. `EdgeFlowParticles` — 传入 pathD + direction，验证渲染正确数量的粒子，反向粒子使用 keyPoints 属性
2. `ConnectionLine` — mock `useStore` 返回不同 nodeInternals 值，验证 isActive 判断和粒子组挂载/卸载
3. 延迟卸载逻辑 — 使用 fake timers 验证 300ms 后 visible 变 false
4. 定时器清理 — 模拟退出激活 + 300ms 内重新激活，验证 timer 被清除
5. 高亮叠加层 — 验证端点选中时叠加层渲染，边自身选中时叠加层让位于选中样式

### 集成测试

1. 点击节点 → 选中 → 相连边出现粒子动画 + 高亮叠加层
2. 点击空白 → 取消选中 → 粒子 300ms 淡出后消失
3. Ctrl+点击两个节点 → 两个节点的相连边都出现粒子
4. 拖拽选中节点 → 粒子不闪烁（验证订阅粒度）
5. 删除选中节点 → 粒子消失 + 定时器清理
6. 多节点密集场景 → 粒子不卡顿（性能验证）

## 不变项

- 现有 `ConnectionLine` 的选中/删除按钮逻辑不改变
- 现有 node 组件不做任何修改
- 现有 store 不做任何修改
- 现有 React Flow edgeTypes 注册方式不变（仍为 `default: ConnectionLine`）
