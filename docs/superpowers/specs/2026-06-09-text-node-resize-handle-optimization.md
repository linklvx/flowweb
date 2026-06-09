# 文本节点缩放手柄灵敏度优化与按需显示 — 功能规格说明书

**版本**: 1.1
**日期**: 2026-06-09
**状态**: 待确认

---

## 1. 概述

### 1.1 问题

当前 `TextInputNode` 使用 React Flow 内置 `NodeResizer` 组件（[源码:140-147](apps/web/src/pages/canvas/components/nodes/TextInputNode.tsx#L140-L147)），仅在单节点选中时显示全部 8 个方向手柄。存在两个痛点：

1. **四角缩放触发区域太小**：`NodeResizer` 默认手柄尺寸 ~8px，鼠标必须精确点到小方块才能拖拽
2. **所有手柄同时显示**：8 个手柄和 4 条边线始终可见，视觉干扰大

### 1.2 解决方案

用 React Flow 官方 `useNodeResizer` 钩子替代 `NodeResizer` 组件，完全自定义手柄渲染：

- **触发区域扩大 3 倍**：24×24px 透明事件捕获区（视觉手柄保持 14px 圆形白底）
- **按需显示单个手柄**：鼠标移到哪个角才显示哪个角
- **拖拽中保持显示**：`isResizing` 为 true 时不隐藏手柄
- **自动适配画布缩放**：触发区大小 = `hitAreaSize / zoom`
- **悬浮时白色圆角样式 + 对应方向双向箭头光标**

### 1.3 不做什么

- 不改变缩放约束（min/max 限制、持久化、撤销重做均保留）
- 不保留四边中点手柄 — 仅保留四角
- 不修改其他节点类型（ImageGenNode、VideoGenNode 等）
- 不影响全屏编辑模式（`TextNodeFullscreen`）
- 不修改 `CanvasView.tsx` 中的 `syncNodeDimensions` 防抖同步逻辑

---

## 2. 数据结构

### 2.1 handleMouseDown 方向参数（强制要求）

React Flow 12.x 方向参数**严格大小写敏感**，必须使用连字符分隔的**完整小写**名称。传入错误格式会**静默失败**（无报错，缩放不生效）：

```typescript
// ✅ 正确 — 仅此四种
type CornerType = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
handleMouseDown(e, 'bottom-right');

// ❌ 静默失败 — 绝不允许
handleMouseDown(e, 'bottomRight');   // 驼峰
handleMouseDown(e, 'Bottom-Right');  // 大写
handleMouseDown(e, 'se');            // 缩写
handleMouseDown(e, 'nw');            // 缩写
```

### 2.2 配置常量

```typescript
const RESIZE_CONFIG = {
  minWidth: 300,          // 与当前 NodeResizer 一致
  minHeight: 300,
  maxWidth: 2000,
  maxHeight: 1500,
  hitAreaSize: 24,        // 透明触发区域 (px)，自动按 zoom 缩放
  visualHandleSize: 14,   // 视觉手柄大小 (px)
  handleOffset: -7,       // 手柄中心相对节点边缘的偏移
  handleColor: '#9CA3AF', // 与选中边框色一致
} as const;
```

### 2.3 状态

```typescript
const [activeCorner, setActiveCorner] = useState<CornerType>(null);
// null = 不显示任何手柄
```

### 2.4 useNodeResizer 钩子参数

```typescript
const { isResizing, handleMouseDown } = useNodeResizer({
  nodeId: id,
  minWidth: RESIZE_CONFIG.minWidth,
  minHeight: RESIZE_CONFIG.minHeight,
  maxWidth: RESIZE_CONFIG.maxWidth,
  maxHeight: RESIZE_CONFIG.maxHeight,
  keepAspectRatio: false,    // 默认 false，显式声明
  shouldResize: () => true,  // 默认 undefined=允许，显式声明
});
```

---

## 3. DOM 结构（关键约束）

### 3.1 当前结构 vs 目标结构

当前 `NodeResizer` 组件渲染在 card body（`overflow-hidden`）内部。自定义手柄**必须**渲染在最外层容器，否则会被裁剪：

```
✅ 目标结构（必须严格遵循）：

div.relative.canvas-node                        ← 最外层：绑定 onMouseMove / onMouseLeave
  ├── Toolbar (absolute, z-10)
  ├── Title bar (absolute, -translate-y-full)
  ├── NodeHandle (target)
  │
  ├── ★ 自定义缩放手柄 (仅选中 + activeCorner 时渲染)  ← 在 overflow-hidden 外层！
  │     onMouseDown → e.stopPropagation() + handleMouseDown(e, activeCorner)
  │
  ├── div.overflow-hidden (card body)           ← 内容区保持 overflow-hidden
  │   ├── div.absolute.inset-0 (编辑器区)
  │   │   └── EditorContent (TipTap)
  │   └── Border overlay (z-index: 10, pointer-events: none)
  │
  ├── NodeHandle (source)
  ├── TextConfigPanel
  └── TextNodeFullscreen
```

### 3.2 事件绑定规则

| 事件 | 绑定位置 | 原因 |
|------|---------|------|
| `onMouseMove` | 最外层 `div.canvas-node` | 需要覆盖整个节点区域（含手柄触发区） |
| `onMouseLeave` | 最外层 `div.canvas-node` | 鼠标离开节点时隐藏手柄 |
| `onMouseDown` | 手柄元素自身 | 阻止冒泡到 React Flow（否则触发节点拖拽） |

---

## 4. 交互行为

### 4.1 手柄显示逻辑

| 条件 | 手柄显示 |
|------|---------|
| 未选中 (`selected === false`) | 无 |
| 多节点选中 | 无 |
| 单节点选中 + 鼠标未靠近任何角 | 无 |
| 单节点选中 + 鼠标靠近某个角 | 仅显示该角手柄 |
| 拖拽缩放进行中 (`isResizing === true`) | 保持显示拖拽角手柄，忽略鼠标位置 |

### 4.2 触发区域计算

```typescript
const hitSize = RESIZE_CONFIG.hitAreaSize / zoom;
// zoom=1.0 → 24px, zoom=0.5 → 48px, zoom=2.0 → 12px
```

四个角的检测区域基于 `nodeContainerRef.current.getBoundingClientRect()`。

### 4.3 状态更新（优化重渲染）

```typescript
// 仅当角真正变化时才更新 state，避免冗余渲染
setActiveCorner((prev) => (prev !== corner ? corner : prev));
```

不使用 debounce — `mousemove` 约 60Hz (16ms/次)，10ms debounce 几乎无效果，比较判断已足够。

### 4.4 事件冲突处理

```typescript
// 手柄 onMouseDown — 三个关键操作
onMouseDown={(e) => {
  if (e.button !== 0) return;    // 1. 只响应左键，右键/中键忽略
  e.stopPropagation();           // 2. 阻止冒泡 → 不触发节点拖拽
  handleMouseDown(e, activeCorner); // 3. 委托给 React Flow
}}
```

### 4.5 窗口失焦处理

```typescript
// 拖拽中切换窗口 → 自动取消拖拽，防止卡死
useEffect(() => {
  const handleBlur = () => {
    if (isResizing) {
      document.dispatchEvent(new MouseEvent('mouseup'));
      // 兜底：微任务级延迟确保 React Flow 内部状态同步后清理
      setTimeout(() => setActiveCorner(null), 0);
    }
  };
  window.addEventListener('blur', handleBlur);
  return () => window.removeEventListener('blur', handleBlur);
}, [isResizing]);
```

### 4.6 手柄样式

| 属性 | 值 |
|------|-----|
| 形状 | 圆形 (`border-radius: 50%`) |
| 尺寸 | 14×14px |
| 背景 | `white` |
| 边框 | `2px solid #9CA3AF` |
| 阴影 | `0 2px 8px rgba(0,0,0,0.3)` |
| z-index | `9999`（确保不被内容遮挡） |
| 过渡 | `opacity 0.15s ease-out` |
| cursor | 按角方向映射（见 4.7） |

### 4.7 光标映射

| 角 | cursor |
|----|--------|
| `top-left` | `nwse-resize` |
| `bottom-right` | `nwse-resize` |
| `top-right` | `nesw-resize` |
| `bottom-left` | `nesw-resize` |

---

## 5. 视觉规范

### 5.1 手柄位置

手柄中心位于节点 card body 四角，向外偏移 -7px：

```
  ●────────────────●    ← top-left / top-right (top: -7px)
  │                │
  │    节点内容    │
  │                │
  ●────────────────●    ← bottom-left / bottom-right (bottom: -7px)
```

### 5.2 与现有一致性

- 手柄颜色 `#9CA3AF` 与选中 border overlay 颜色一致
- border overlay (`z-index: 10, pointer-events: none`) 保持不变
- 编辑器区 `nodrag` class 保持不变，确保文本选择不触发节点拖拽

---

## 6. 修改范围

| 文件 | 操作 | 说明 |
|------|------|------|
| `TextInputNode.tsx` | **修改** | 替换 NodeResizer → useNodeResizer + 自定义手柄 |
| `TextInputNode.test.tsx` | **修改** | 更新/新增 resize 相关测试 |

### 6.1 不修改的文件

- `CanvasView.tsx` — `syncNodeDimensions` 不变（dimensions change 自动触发）
- `nodeStore.ts` / `canvasStore.ts` — 不修改
- 后端 API / Prisma Schema — 不修改
- CSS 文件 — 手柄样式全部内联，不新建 CSS 文件

---

## 7. 边界情况

| 场景 | 行为 |
|------|------|
| 未选中 | 无手柄 |
| 单节点选中 + 鼠标在节点中央 | 无手柄 |
| 单节点选中 + 鼠标靠近右下角 | 仅右下角出现白色圆手柄 |
| 鼠标移出节点 | 手柄消失（除非正在拖拽缩放） |
| `mousedown` 手柄 → 拖拽缩放 | 手柄保持显示直到 `mouseup` |
| 拖拽中鼠标移出角区域 | 手柄不消失（`isResizing` 保护） |
| 释放拖拽 + 鼠标仍在角上 | 重新检测并显示 |
| 右键点击手柄 | 忽略，不触发缩放 |
| 拖拽中 Alt+Tab 切窗 | 自动取消拖拽，手柄消失 |
| 多节点选中 | 不渲染任何手柄 |
| 从单选中变为多选中 | 手柄立即消失 |
| zoom = 0.5 | 触发区扩大到 48px |
| zoom = 2.0 | 触发区缩小到 12px |
| 节点缩放到 minWidth/minHeight | 四角触发区不重叠（300px >> 24px×2） |
| TipTap 编辑 + 鼠标在角上 | 手柄正常显示，编辑和缩放互不干扰 |

### 7.1 关于 `getBoundingClientRect()` 缓存的说明

**不使用缓存**，每次 `mousemove` 实时调用。原因：
- 节点拖拽移动时 React Flow 用 CSS transform 更新位置，不触发 React 重新渲染
- 缓存依赖 `nodeWidth`/`nodeHeight`/`position` 等 props 不会在拖拽中更新
- 缓存会在节点拖拽时变 stale
- `getBoundingClientRect()` 对单个节点调用耗时 < 0.1ms，不是性能瓶颈

### 7.2 关于 `pointer-events: none` 的说明

不在 card body 添加 `pointer-events: none`。原因：
- TipTap 编辑器需要响应点击、选择、右键菜单等指针事件
- 当前 `nodrag` class 已正确处理拖拽冲突
- border overlay 已有 `pointer-events: none`

---

## 8. 测试用例

| # | 场景 | 预期 |
|---|------|------|
| 1 | 未选中节点 | 无手柄元素渲染 |
| 2 | 单节点选中 + 鼠标在节点中央 | 无手柄渲染 |
| 3 | 单节点选中 + 鼠标靠近右下角 | 右下角出现手柄 |
| 4 | 单节点选中 + 鼠标靠近左上角 | 左上角出现手柄 |
| 5 | 手柄 `mousedown` 左键 | `handleMouseDown` 被调用 |
| 6 | 手柄 `mousedown` 右键 | 不触发缩放 |
| 7 | 拖拽中鼠标移出角区域 | 手柄保持显示 |
| 8 | 拖拽结束 (`isResizing` → false) | 手柄消失（除非鼠标仍在角上） |
| 9 | 多节点选中 | 不渲染任何手柄 |
| 10 | 从单选中变为多选中 | 手柄消失 |
| 11 | `mousedown` 不冒泡到 React Flow | 节点不开始拖拽移动 |
| 12 | 窗口 blur 时正在缩放 | 自动取消，手柄消失 |
| 13 | 节点缩放到 minWidth/minHeight | 四角触发区不重叠 |
| 14 | 保留现有 resize 测试兼容 | 适配后全部通过 |
| 15 | 拖拽缩放到最小限制 (300×300) | React Flow 阻止继续缩小，手柄位置正确 |
| 16 | 拖拽缩放到最大限制 (2000×1500) | React Flow 阻止继续放大，手柄位置正确 |
