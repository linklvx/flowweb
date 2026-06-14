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
| 粒子颜色 | 统一蓝色 `--edge-flow-color`，默认 `#3B82F6` | 不区分方向，视觉简洁 |
| 多选 | 所有选中节点各自触发 | 多节点选中时所有关系边都动 |
| 非激活态 | 粒子 DOM 不挂载 | 减少 SVG 节点数，降低渲染压力 |
| 过渡 | 300ms CSS opacity 淡入淡出 + 延迟卸载 | 避免硬切闪烁 |

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
├── BaseEdge ─────────────────── 底层贝塞尔路径
├── <g> (visible && opacity) ─── 过渡容器
│   ├── EdgeFlowParticles (dir="outward")
│   └── EdgeFlowParticles (dir="inward")
└── EdgeLabelRenderer ────────── 边选中时的删除按钮（现有逻辑不变）
```

### 数据流

```
React Flow internal Store
  → useStore(精准 selector: 选中节点 ID 串)
  → source/target 是否在选中集合中？
  → isActive: boolean
  → 渲染粒子 / 不渲染
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

### 连线样式

| 状态 | 连线颜色 | 线宽 |
|------|---------|------|
| 无选中（默认） | `#888`（现有） | 2（现有） |
| 边自身选中 | `#f59e0b`（现有） | 3（现有） |
| 端点节点选中（新增） | 提亮至 `#999` | 2 |

### CSS 变量

```css
--edge-flow-color: #3B82F6;  /* 粒子颜色 */
```

## 性能设计

### 订阅粒度

使用 `useStore` 精准 selector，提取选中节点 ID 拼接为字符串：

```ts
const selectedIdStr = useStore((state) =>
  state.nodes
    .filter(n => n.selected)
    .map(n => n.id)
    .sort()
    .join(',')
);
```

- 字符串值稳定时 `Object.is` 命中，组件不重渲染
- 拖拽、缩放、改 data 等操作不触发边重渲染
- 仅在选中集实际变化时触发

### 粒子 DOM 按需创建

```
isActive: false → <g> 不渲染（0 DOM 节点）
isActive: true  → 挂载 <g> + 6 个 <circle> + <animateMotion>
退出激活       → opacity 0→1 过渡 300ms → 延迟 300ms 卸载
```

## 过渡效果

```
激活:  挂载 DOM → opacity 0→1 (300ms ease)
退出:  opacity 1→0 (300ms ease) → 300ms 后卸载 DOM
```

实现：`visible` 状态 + `isActive` 状态双变量控制挂载时机。

## 测试策略

### 单元测试

1. `EdgeFlowParticles` — 传入 pathD + direction，验证渲染正确数量的粒子
2. `ConnectionLine` — mock useStore 返回不同选中集，验证粒子组挂载/卸载
3. 延迟卸载逻辑 — 使用 fake timers 验证 300ms 后 visible 变 false

### 集成测试

1. 点击节点 → 选中 → 相连边出现粒子动画
2. 点击空白 → 取消选中 → 粒子消失（含过渡）
3. Ctrl+点击两个节点 → 两个节点的相连边都出现粒子
4. 拖拽选中节点 → 粒子不闪烁（验证订阅粒度）
5. 删除选中节点 → 粒子消失

## 不变项

- 现有 `ConnectionLine` 的选中/删除按钮逻辑不改变
- 现有 node 组件不做任何修改
- 现有 store 不做任何修改
- 现有 React Flow edgeTypes 注册方式不变（仍为 `default: ConnectionLine`）
