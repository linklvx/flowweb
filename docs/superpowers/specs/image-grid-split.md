# Spec: 图片节点宫格切分 (Image Grid Split)

> 版本: 6.0 | 日期: 2026-06-17

## 1. 功能概述

在 ImageNodeToolbar 的"宫格切分"按钮上添加交互：点击弹出下拉菜单，用户选择预设宫格或自定义行列数，将图片按网格切分为多个子图，上传后批量生成网格状排列的新节点并与原节点自动连线。

## 2. UI 交互

### 2.1 Dropdown 实现方案

使用 antd `Dropdown` + `dropdownRender` 完全自定义菜单内容。主菜单与子面板包裹在同一容器中。

**受控状态**：

```ts
const [open, setOpen] = useState(false);
const [subMenuOpen, setSubMenuOpen] = useState(false);

<Dropdown
  open={open}
  onOpenChange={(next) => setOpen(next)}
  trigger={['click']}
  getPopupContainer={() => canvasRootElement}
  dropdownRender={() => (
    <div className="flex relative">  {/* 公共外层容器，position: relative 为子面板锚点 */}
      <div className="flex flex-col gap-0.5 p-1.5">
        {/* 预设项: onClick → 执行切分 + setOpen(false) */}
        {/* 自定义: onMouseEnter → setSubMenuOpen(true); onClick → toggle */}
      </div>
      {subMenuOpen && (
        <div className="absolute" style={{ left: '100%', marginLeft: 6, top: 0 }}>
          {/* 5x5 网格 + 确认按钮 */}
          {/* 右侧空间不足时: right: '100%', marginRight: 6, left: 'auto' */}
        </div>
      )}
    </div>
  )}
/>
```

**关闭职责拆分**：

| 关闭目标 | 触发方式 | 说明 |
|----------|----------|------|
| 子面板 | mouse 移到主菜单其他项 | 立即 `setSubMenuOpen(false)` |
| 子面板 | mouseleave 公共容器 | 150ms debounce → `setSubMenuOpen(false)` |
| 子面板 | 点击"确认切分" | `setSubMenuOpen(false)` + `setOpen(false)` |
| 主菜单 | 点击预设项 | `setOpen(false)` |
| 主菜单 | 点击菜单外部 | antd `onOpenChange(false)` 自动处理 |
| 主菜单 | 点击触发按钮 | `setOpen(!open)` 切换 |

> mouseleave 公共容器**仅关闭子面板**，不关闭主菜单。主菜单关闭统一由 `onOpenChange` 和显式点击控制。

### 2.2 自定义宫格子面板

- **网格选中规则**: 点击第 `r` 行第 `c` 列 → 行列数 = `r × c`，高亮 `[1..r]` 行 × `[1..c]` 列的矩形范围
- **hover 预览**: hover 第 `r` 行第 `c` 列时，显示与点击选中规则一致的半透明蓝色预览矩形
- **默认值**: 打开时默认选中 `2×2`
- **置灰**: 第 1 行（1×n）和第 1 列（n×1）disabled
- **确认按钮**: 底部「确认切分」；单元格均为置灰状态时按钮 disabled
- **视口边界**: 以画布根容器为基准；打开时计算一次，右侧不足则改为 `right: 100% + 6px`
- **记忆**: 组件 state 级别有效，切换节点后重置

### 2.3 层级

| 层级 | z-index |
|------|---------|
| 画布节点 | ~10 |
| 工具栏 | 10000 |
| 下拉菜单 | 10500 |
| antd Modal | 20000 |

### 2.4 状态反馈

同 v4.0，略。

## 3. 核心切分逻辑

### 3.1 完整流程

```
splitImageNode(nodeId, rows, cols) → Promise<Result | null>

  ├─ 防御: splittingNodeId !== null → return null
  ├─ 防御: rows/cols ∉ [2,5] → return null
  │
  ├─ set splittingNodeId = nodeId, 创建 AbortController
  ├─ 快照: 图片 URL + 原节点坐标 position
  │
  ├─ img.crossOrigin = 'anonymous'（必须在设置 src 之前）
  ├─ img.src = url → 10s 超时加载（AbortSignal 控制）
  │   ├─ 超时 → isTimeout=true → ac.abort() → message.error → return null
  │   └─ 主动取消 → ac.abort()（isTimeout=false）→ 静默 return null
  │
  ├─ 防御: naturalWidth===0 || naturalHeight===0 → error → return null
  ├─ 防御: 长边>4096 → 等比缩放（imageSmoothingQuality='high'）
  ├─ 防御: 子图长边 < 10px → warning → return null
  │
  ├─ 复用单个 Canvas 实例:
  │   for each (row, col):
  │     ctx.clearRect(0, 0, cw, ch)        // 清屏，避免残留像素
  │     canvas.width = cellW; canvas.height = cellH
  │     ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh)
  │     blob = await new Promise<Blob | null>(resolve =>
  │       canvas.toBlob(resolve, 'image/webp', 0.9)
  │     )
  │     if (!blob) → 计入失败（浏览器绘制异常，极少数情况）
  │     上传后立即释放 blob 引用
  │
  ├─ 上传（并发上限 3，单张最多重试 1 次）
  │   presignUpload({ contentType:'image/webp', signal })
  │   → PUT blob（signal）→ confirmUpload({ signal })
  │   ├─ 网络错误 / 5xx → 重试 1 次 → 仍失败 → 计入失败
  │   └─ 4xx → 不重试，直接计入失败
  │
  ├─ 每并发批次完成后（即每 3 张上传完成）双重校验原节点存在性
  │   不存在 → abort 静默 return null（25 宫格 ≈ 8~9 次校验，开销可忽略）
  │
  ├─ addChildNodes(sourceId, nodeDataList) → newIds[]
  │
  ├─ return { newIds: string[], sourcePosition: XYPosition, sourceSize: {w,h} }
  │
  └─ finally: splittingNodeId=null, delete splitAbortMap[nodeId]
               释放 Canvas, 释放 Image, clearTimeout
               if (url.startsWith('blob:')) URL.revokeObjectURL(url)
```

### 3.2 接口契约

```ts
interface SplitResult {
  newIds: string[];
  sourcePosition: { x: number; y: number };
  sourceSize: { w: number; h: number };
}

splitImageNode(id, rows, cols): Promise<SplitResult | null>
```

| 结果 | 返回值 | 异常 |
|------|--------|------|
| 成功 | `SplitResult` | 无 |
| 失败/取消 | `null` | 函数内部全部 catch，不向外抛出 |

> `sourcePosition`/`sourceSize` 为预留字段，可用于后续扩展偏移计算等场景；本期仅 `newIds` 被 `fitView` 消费。

### 3.3 超时与取消区分

```ts
let isTimeout = false;
const timer = setTimeout(() => { isTimeout = true; ac.abort(); }, 10_000);

try { /* 加载 + 切分 + 上传 */ }
catch (err) {
  if (isTimeout) return message.error('图片加载超时，请检查网络'), null;
  if (err.name === 'AbortError') return null; // 静默
  return message.error('切分失败：' + err.message), null;
}
```

### 3.4 AbortController 信号传递

| 环节 | 方式 |
|------|------|
| 图片加载 | abort 时 `img.src = ''` + 解绑 onload/onerror |
| presignUpload / PUT / confirmUpload | axios/fetch `{ signal }` 参数透传 |

### 3.5 子图像素精度

```ts
function computeGridSizes(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) =>
    i < count - 1 ? base : total - base * (count - 1)
  );
}
```

### 3.6 输出规格

| 属性 | 值 |
|------|-----|
| 格式 | `image/webp`（质量 0.9） |
| 文件命名 | 优先 `fileName`，fallback `fileId`，后缀 `_r{row}_c{col}.webp` |
| Content-Type | `image/webp` |
| 重试 | 网络错误 / 5xx → 1 次；4xx → 不重试 |

## 4. 任务生命周期

| 场景 | 行为 |
|------|------|
| 源节点删除 | abort → 静默 return null |
| Canvas 页面卸载 | 遍历 splitAbortMap 批量 abort |
| 工具栏卸载（取消选中） | **不终止**，任务继续 |
| 原节点中途被拖动 | 新节点位置以**任务启动时坐标快照**为准 |
| 原节点中途换图 | 以**任务启动时 URL 快照**为准 |

## 5. 架构设计

### 5.1 文件职责

| 文件 | 职责 |
|------|------|
| `utils/imageSplit.ts` | 纯函数: 坐标计算、Canvas 裁剪生成 Blob（含 clearRect） |
| `utils/splitUploadService.ts` | 编排: Blob[] → Promise 队列(并发3+重试1) → 汇总 |
| `stores/canvasStore.ts` | `splitImageNode` + `addChildNodes` + `splittingNodeId` + `splitAbortMap` |
| `ImageNodeToolbar.tsx` | 宫格 Dropdown + 子面板 |
| `ImageGenNode.tsx` | 调用 splitImageNode + fitView |
| `ImageNodeToolbar.test.tsx` | 菜单交互测试 |
| `utils/imageSplit.test.ts` | 纯函数单测 |
| `utils/splitUploadService.test.ts` | 上传编排测试 |

### 5.2 Store 扩展

```ts
splittingNodeId: string | null;
splitAbortMap: Record<string, AbortController>;

addChildNodes: (
  sourceId: string,
  nodeDataList: Array<{
    data: Record<string, unknown>;
    gridRow: number;  // 0-based，第一行=0
    gridCol: number;  // 0-based，第一列=0
  }>
) => string[];

splitImageNode: (id: string, rows: number, cols: number) => Promise<SplitResult | null>;
```

### 5.3 fitView 调用（组件层）

```ts
// ImageGenNode.tsx
const { fitView } = useReactFlow();

const handleGridSplit = useCallback(async (rows: number, cols: number) => {
  const result = await splitImageNode(id, rows, cols);
  if (!result) return;
  fitView({
    nodes: [
      { id },  // 原节点
      ...result.newIds.map(id => ({ id })),
    ],
    padding: 0.2,
    duration: 300,
  });
}, [id, fitView, splitImageNode]);
```

### 5.4 批量节点布局公式

```ts
// 0-based 索引：gridRow ∈ [0, rows-1], gridCol ∈ [0, cols-1]
const sourceW = sourceNode.measured?.width ?? sourceNode.width ?? 400;
const sourceH = sourceNode.measured?.height ?? sourceNode.height ?? 300;
const startX = sourceNode.position.x + sourceW + 120;  // 原节点右侧
const startY = sourceNode.position.y;                     // 顶部对齐

const position = {
  x: startX + gridCol * (sourceW + 20),  // 列间距 20px
  y: startY + gridRow * (sourceH + 20),  // 行间距 20px
};
```

### 5.5 新节点数据

**继承**: `fileId`（新上传的）、`status: 'done'`、`width/height`（同原节点）
**不继承**: `style`、`model`、`quality`、`ratio`、`prompt`、`referenceImage`、`transformMode`、`editMode`
**节点类型**: `imageGen`（项目无纯图片展示类型，通过 `status: 'done'` 屏蔽生成 UI）

### 5.6 连线

项目使用默认 Handle（无 handleId），连线仅需 `{ id, source, target }`，React Flow 自动匹配 Position.Left/Right 端口。与现有 `addChildNode` 模式完全一致。

## 6. 边界表

| 场景 | 处理 |
|------|------|
| 无图片 | 按钮 disabled |
| 子图长边 < 10px | 终止 + warning |
| 子图长边 = 10px | 允许执行 |
| 原图长边 = 4096px | 不缩放 |
| 原图长边 > 4096px | 缩至 4096px |
| naturalWidth = 0 | 终止 + error |
| 重复触发 | splittingNodeId 非 null → return null |
| 切分中点击其他节点 | 不打断 + message.info |
| 工具栏卸载 | 不终止任务 |
| Canvas 页面卸载 | 批量 abort |
| 源节点删除 | abort 静默 |
| 源节点换图 | 以任务启动时 URL 快照为准 |
| 源节点被拖动 | 以任务启动时坐标快照为准 |
| 10s 超时 | message.error → return null |
| 主动取消 | AbortError → 静默 return null |
| 网络/5xx | 重试 1 次 → 仍失败计入失败 |
| 4xx | 不重试 → 直接计入失败 |
| 右侧空间不足 | 子面板向左弹出 |

## 7. 测试用例

### 7.1 纯函数

- `computeGridSizes(1000,2)` → `[500,500]`
- `computeGridSizes(100,3)` → `[33,33,34]` sum=100
- 整数倍整除: 100×100 / 2×2 → 子图 50×50，无像素偏差
- 8000×4000 → 4096×2048
- 4096×4096 → 不缩放
- rows=1/6 → 拒绝
- 子图 10px → 通过；9px → 拒绝
- `canvas.toBlob` 返回 `null` → 计入失败（模拟浏览器异常）

### 7.2 组件

- 点击按钮 → open=true
- 点击"4宫格" → onGridSplit(2,2) + open=false
- hover "自定义" → subMenuOpen=true + 默认高亮 2×2
- hover 网格 [3,2] → 预览矩形 [1..3]×[1..2]
- 点击网格 [3,2] → 选中 [1..3]×[1..2]
- mouse 移到"9宫格" → subMenuOpen=false（立即）
- splitting=true → 按钮 disabled

### 7.3 集成

- 切分后 nodes = rows×cols，edges = rows×cols
- 新节点不含 style/model/prompt
- 节点删除 → abort 静默
- fitView({ nodes: [source, ...newIds] })
- naturalWidth=0 → error message

### 7.4 关键场景

- 工具栏卸载 → 任务继续执行完成
- 超时 → error 提示（非静默）
- 主动取消 → 静默（非 error）
- 5xx → 重试 1 次；4xx → 不重试
- Canvas 复用 → 子图无残留像素
- 原节点被拖动后 → 新节点基于原始坐标
- `canvas.toBlob` 返回 `null` → 计入失败
- 并发 ≤ 3

## 8. 可选扩展（本期不做）

- 批量预签名接口
- 切分后自动选中新节点
- Esc 关闭菜单
- 原节点 spinner 进度指示
- 画布级别撤销/重做
