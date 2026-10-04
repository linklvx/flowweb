<!-- doc-status: historical | verified_at: n/a -->
# Spec: Image & Video Node Resize

**Date:** 2026-06-14
**Status:** Approved

## Overview

为图片节点（ImageGenNode）和视频节点（VideoGenNode）增加节点缩放功能，参考文本节点（TextInputNode）的 `NodeResizeControl` 实现，支持四个角手柄拖拽等比例缩放。

---

## 1. Requirements

### 1.1 显示条件

缩放手柄显隐逻辑：

| 条件 | 行为 |
|------|------|
| `isSingleSelected && hasMedia && !isEditMode` | 显示 4 个角手柄 |
| `!hasMedia`（新节点/未加载素材） | 隐藏手柄 |
| `isEditMode`（裁剪/擦除/重绘/扩图/旋转变换） | 隐藏手柄 |
| `!isSingleSelected`（多选或无选中） | 隐藏手柄 |

### 1.2 等比例缩放

- 以原始素材的 `naturalWidth / naturalHeight` 为宽高比基准（定义为 `ratio = width / height`）
- 拖拽过程中实时强制按比例计算，不接受 `keepAspectRatio` 的"当前节点宽高比"
- 像素取整前置到 `onResize` 实时执行（`Math.round`），避免松手 1px 跳动
- `onResizeEnd` 仅做持久化写入，不重复计算

### 1.3 边界钳制

- ratio 定义：`宽 / 高`，代码中加注释
- 执行顺序：
  1. 先等比内切于 max(3000, 3000)
  2. 再检查最短边 ≥ min(100)
  3. 若不满足，以最短边 = 100 等比放大（长边可突破 3000）
- min 为硬约束，max 为软约束

### 1.4 锚点补偿

不依赖 `onResize` 回调的 x/y，用 delta 差值独立计算：

| 手柄 | 固定锚点 | x 补偿 | y 补偿 |
|------|---------|--------|--------|
| `bottom-right` | 左上 | 不变 | 不变 |
| `bottom-left` | 右上 | `x - deltaW` | 不变 |
| `top-right` | 左下 | 不变 | `y - deltaH` |
| `top-left` | 右下 | `x - deltaW` | `y - deltaH` |

### 1.5 尺寸持久化

- 新增 `node.data.customSize: { width: number; height: number }` 字段
- 新增 `node.data.aspectRatio: number` 字段（素材加载时缓存，直接保留 `naturalWidth / naturalHeight` 原生浮点精度，不做小数位截断，避免多次缩放后像素级累积偏差）
- 尺寸优先级：`customSize` > `calcConstrainedSize()`
- `calcConstrainedSize` 仅作为素材首次加载的初始尺寸
- 初始尺寸写入规则：首次加载时 `calcConstrainedSize` 结果仅写入 `node.width` / `node.height` 与 `node.data.aspectRatio`，**不**写入 `customSize`，保留「用户未手动缩放」的原生状态标记
- 缩放结束（`onResizeEnd`）写入 `customSize`，此时推入撤销重做历史栈
- 缩放过程中（`onResize`）不入历史栈

### 1.6 素材更换适配

更换素材时按以下规则处理 `customSize`：
- 同节点重新生成素材，新素材比例与原 `aspectRatio` 一致 → 保留当前 `customSize` 不变
- 同节点更换不同比例素材 → 不清空 `customSize`，执行 contain 适配逻辑（以当前 `customSize` 为外接矩形）
- 当前版本无主动「重置节点尺寸」入口，暂不提供清空能力

contain 适配算法：

```ts
// ratio = width / height
function adaptCustomSize(customSize, newRatio) {
  const fitByWidth = customSize.width / newRatio;
  if (fitByWidth <= customSize.height) {
    return { width: customSize.width, height: Math.round(fitByWidth) };
  }
  return { width: Math.round(customSize.height * newRatio), height: customSize.height };
}
```

### 1.7 渲染方式

图片和视频元素统一使用：

```css
.container { overflow: hidden; }
img, video { display: block; width: 100%; height: 100%; object-fit: cover; }
```

### 1.8 视频节点 pointer-events

- `onResizeStart`：给 `<video>` 元素设置 `pointer-events: none`，同时 `window` 绑定 `mouseup`、`blur` 兜底事件
- `onResizeEnd`：恢复 `pointer-events: auto`，移除所有兜底事件监听
- 兜底 fallback 函数需执行完整的 `onResizeEnd` 逻辑：尺寸校验取整 → 写入 customSize → 推入撤销栈 → 恢复样式 → 移除事件
- 组件 `useEffect` cleanup 中兜底清理 `pointer-events` 和 window 事件

### 1.9 撤销重做对接

- `onResize` 实时更新节点尺寸，不推入历史快照栈
- `onResizeEnd`（含 fallback）最终确认后推入历史记录
- 一次完整缩放操作对应一次撤销

### 1.10 编辑模式切换

- 通过条件渲染（`!isEditMode &&`）卸载 `NodeResizeControl` 组件
- 组件卸载自动清理内部事件 + 触发 cleanup 函数恢复视频状态

### 1.11 事件冒泡防护

- `NodeResizeControl` 原生阻止指针事件向画布冒泡（避免拖拽缩放触发画布平移）
- 纳入验收校验项

---

## 2. Implementation Approach

采用 `@xyflow/react` 的 `NodeResizeControl` + `shouldResize={() => false}` 完全接管尺寸计算：

```
onResize({ handle, width, height }):
  1. 校验 aspectRatio 有效性（非空、>0、有限值）
  2. 取缓存 aspectRatio，避免 DOM 读取
  3. 主边计算规则：
     所有角手柄统一以拖拽回调的 width 为主基准边
     height = Math.round(width / aspectRatio)
     边界钳制阶段若高度先触达 min/max 约束，则自动切换为以高度为主基准边反推宽度
  4. 边界钳制（先 max 内切，再 min 硬约束）
  5. delta 差值锚点补偿
  6. Math.round 取整
  7. setNodes() 函数式更新 + 单节点局部更新，仅修改当前节点的 width/height/x/y，避免全量 nodes 数组替换引发画布大面积重渲染
```

---

## 3. Data Model Changes

### 3.1 nodeStore.ts

```ts
// ImageNodeData & VideoNodeData 各新增：
customSize?: { width: number; height: number };
aspectRatio?: number;
```

### 3.2 共享常量

```ts
const RESIZE_CONFIG = {
  minSide: 100,
  maxSide: 3000,
} as const;

const HANDLE_STYLE = {
  width: 24,
  height: 24,
  background: 'transparent',
  border: 'none',
  zIndex: 9999,
} as const;

const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
```

`HANDLE_STYLE` 样式、尺寸与 `TextInputNode` 文本节点的缩放手柄完全保持一致，保证全画布节点交互体验统一。

### 3.3 工具函数抽离

核心工具函数统一抽离至 `src/utils/resizeUtils.ts` 共享文件：

- `clampWithAspectRatio(w, h, ratio, min, max)` — 等比例边界钳制
- `adaptCustomSize(customSize, newRatio)` — 素材更换时的 contain 适配
- `calcAnchorCompensation(handle, node, deltaW, deltaH)` — 锚点补偿计算

`ImageGenNode` 与 `VideoGenNode` 共同引用，避免重复实现。

---

## 4. Files to Modify

| 文件 | 变更 |
|------|------|
| `ImageGenNode.tsx` | 添加缩放手柄、尺寸计算、aspectRatio 缓存 |
| `VideoGenNode.tsx` | 同上 + pointer-events 切换 + 兜底事件 |
| `nodeStore.ts` | 新增 `customSize`、`aspectRatio` 字段 |
| `ImageGenNode.test.tsx` | 新增缩放相关测试用例 |
| `VideoGenNode.test.tsx` | 新增缩放 + pointer-events 测试用例 |

---

## 5. Test Plan

### 5.1 ImageGenNode

| 测试 | 验证点 |
|------|--------|
| 未加载素材时无手柄 | `!hasMedia` → 不渲染 `NodeResizeControl` |
| 编辑模式时无手柄 | `isEditMode` → 不渲染 |
| 单选有素材时显示手柄 | 4 个 corner 手柄均渲染 |
| 多选时无手柄 | 多节点选中 → 手柄隐藏 |
| 等比例缩放（bottom-right） | `width / height ≈ aspectRatio` |
| 锚点补偿（top-left） | 右下角坐标不变 |
| 边界钳制 - 最短边 ≥ 100 | 无法缩到 100 以下 |
| 边界钳制 - 最长边 ≤ 3000 | 不会超出 3000（常规比例） |
| 极端比例（10:1） | 最短边强制 = 100px，长边可突破 3000px，比例不变 |
| customSize 持久化 | resize end 后 `data.customSize` 非空 |
| 素材更换适配 | 换素材后 customSize 按 contain 适配 |
| 事件冒泡阻断 | 拖拽手柄不触发画布平移 |

### 5.2 VideoGenNode

| 测试 | 验证点 |
|------|--------|
| 同上所有 ImageGenNode 测试 | 行为一致 |
| pointer-events 切换 | resize start → `none`，end → `auto` |
| window.blur 兜底 | blur 触发 → 恢复 pointer-events + 清理事件 |
| window.mouseup 兜底 | 异常 mouseup → 执行完整 onResizeEnd 逻辑 |
| 组件卸载清理 | 卸载时 pointer-events 强制恢复 + 事件移除 |
| 失焦时尺寸持久化 | blur 触发 fallback → customSize 写入 + 撤销栈可回退 |

---

## 6. Acceptance Checklist

- [ ] 新图片/视频节点（未加载素材）无缩放手柄
- [ ] 加载素材后有缩放手柄，编辑模式下隐藏
- [ ] 拖拽任意角手柄等比例缩放，比例零漂移
- [ ] 锚点位置稳定，无跳动
- [ ] 边界约束生效：最短边 ≥ 100px，最长边 ≤ 3000px（不冲突时）
- [ ] 极端比例素材（如 100:1）：min 硬约束优先
- [ ] 缩放过程中画面流畅，无 1px 跳动
- [ ] 缩放结束后 customSize 持久化，刷新页面可还原
- [ ] 缩放操作可撤销（一次操作一次撤销）
- [ ] 视频节点 resize 时 pointer-events: none，mouseup 穿透
- [ ] 缩放过程中切换窗口/失焦：缩放终止，尺寸持久化，可撤销
- [ ] 缩放过程中进入编辑模式：缩放终止，状态恢复
- [ ] 拖拽手柄不触发画布平移
- [ ] 多选时所有节点均无缩放手柄
- [ ] 缩放后节点输入/输出锚点与节点边缘对齐，无错位、无偏移
- [ ] 画布 zoom 缩放后，手柄大小和拖拽精度正常，与文本节点表现一致
