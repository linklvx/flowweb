<!-- doc-status: historical | verified_at: n/a -->
# Plan: 图片标注功能 (Image Annotation)

> 日期: 2026-06-28
> 状态: 待确认
> 基于 Spec: docs/superpowers/specs/annotation-feature.md

## 1. 架构概览

```
ImageGenNode (orchestrator)
├─ AnnotationToolbar (标注专用工具栏，createPortal 到 document.body)
│   ├─ 退出按钮 [← 标注]
│   ├─ 绘制工具切换 (画笔/矩形/直线) — 单选，选中态高亮
│   ├─ 颜色预设 × 6 + Ant Design ColorPicker
│   ├─ Ant Design Slider 线宽调节 (1-40px)
│   ├─ 撤销/重做 (含 tooltip 提示快捷键)
│   └─ 保存按钮 (白色，isSaving 置灰)
└─ AnnotationCanvas (三层 Canvas 叠加)
    ├─ 显示层 — 底层历史 Canvas（仅在 history 变化时全量重绘）
    ├─ 显示层 — 顶层临时 Canvas（仅绘制当前拖拽中未提交的图形，pointermove 时清空重绘）
    └─ 离屏层 Canvas（透明背景，仅存储标注内容，原图分辨率 1:1）
```

## 2. 核心设计原则

1. **Store 为唯一真相源** — AnnotationCanvas 不独立维护 history，通过 selector 读取 nodeStore.annotationState.history，所有变更走 Store action
2. **离屏 Canvas 永久纯净** — 仅存储透明背景标注内容，导出时创建临时合成画布
3. **坐标换算无冗余 DPR** — canvas.width 即物理像素，rect.width 即 CSS 像素，比值即为正确缩放系数

## 3. 文件清单

### 新建文件（4 个）
| 文件 | 用途 |
|------|------|
| `apps/web/src/pages/canvas/components/nodes/AnnotationCanvas.tsx` | 三层 Canvas 绘制组件 |
| `apps/web/src/pages/canvas/components/nodes/AnnotationToolbar.tsx` | 标注专用工具栏 |
| `apps/web/src/pages/canvas/components/nodes/__tests__/AnnotationCanvas.test.tsx` | Canvas 单元测试（jest-canvas-mock） |
| `apps/web/src/pages/canvas/components/nodes/__tests__/AnnotationToolbar.test.tsx` | 工具栏单元测试 |

### 修改文件（4 个）
| 文件 | 改动 |
|------|------|
| `nodeStore.ts` | editMode 增加 `'annotate'`；新增 `annotationState` + DrawOp 类型 + actions |
| `ImageNodeToolbar.tsx` | 增加 `onAnnotate` prop，标注按钮绑定 onClick |
| `ImageGenNode.tsx` | 接入标注模式全流程：进入/退出/保存/快捷键/原图校验/resize锁定 |
| `EditToolbar.tsx` | editMode 类型增加 `'annotate'`（仅类型兼容，实际渲染走 AnnotationToolbar） |

### 不改动文件
canvasStore.ts（复用 addChildNode）、CanvasView.tsx（复用 activeEditNodeId 锁定/点击外部退出）、EraseCanvas.tsx、EraseBottomToolbar.tsx

## 4. 实现步骤（TDD 顺序）

### Step 1: 类型定义 + Store 常量子

**文件:** `nodeStore.ts`

**1.1 全局常量（文件顶部）:**
```ts
export const ANNOTATION_DEFAULTS = {
  color: '#FF0000',
  lineWidth: 4,
  maxHistory: 50,
  minLineWidth: 1,
  maxLineWidth: 40,
  pressureMin: 0.2,
  mousePressure: 0.5,
} as const;
```

**1.2 DrawOp 按工具类型差异化定义（统一存储 CSS 逻辑坐标）:**
```ts
// ★ 所有坐标统一为图片显示区域的 CSS 逻辑坐标（与 displayWidth/displayHeight 同单位）
// 即：CSS 像素，未经 devicePixelRatio 缩放
// 写入时：物理像素坐标 ÷ dpr → 逻辑坐标
// 读取时（显示层）：逻辑坐标 × dpr → 物理像素坐标
// 读取时（离屏层）：逻辑坐标 × naturalScale → 原图像素坐标

export interface PenOp {
  type: 'pen';
  points: { x: number; y: number; pressure?: number }[];  // CSS 逻辑坐标
  color: string;
  lineWidth: number;  // CSS 逻辑像素线宽
}

export interface RectOp {
  type: 'rect';
  x1: number; y1: number; x2: number; y2: number;  // CSS 逻辑坐标
  color: string;
  lineWidth: number;
}

export interface LineOp {
  type: 'line';
  x1: number; y1: number; x2: number; y2: number;  // CSS 逻辑坐标
  color: string;
  lineWidth: number;
}

export type DrawOp = PenOp | RectOp | LineOp;
```

**★ drawOpToCanvas 绘制规范（统一入口）:**
```ts
function drawOpToCanvas(
  ctx: CanvasRenderingContext2D,
  op: DrawOp,
  scale: number,  // 显示层传 dpr，离屏层传 naturalScale
  isOffscreen: boolean
): void {
  ctx.save();
  ctx.strokeStyle = op.color;
  ctx.lineWidth = op.lineWidth * scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // ... 按 op.type 分支绘制，所有坐标 × scale
  ctx.restore();
}
```

**1.3 AnnotationState 接口:**
```ts
interface AnnotationState {
  tool: 'pen' | 'rect' | 'line';
  color: string;
  lineWidth: number;
  history: DrawOp[];
  redoStack: DrawOp[];
}
```

**1.4 editMode 类型扩展:**
```ts
editMode?: 'crop' | 'outpaint' | 'erase' | 'redraw' | 'annotate' | null;
```

**1.5 Store 新增 state + actions:**
```ts
annotationState: AnnotationState | null;

// 初始化 — 增加 activeEditNodeId 存在性校验
initAnnotationState: () => {
  if (!get().activeEditNodeId) return;
  set({
    annotationState: {
      tool: 'pen',
      color: ANNOTATION_DEFAULTS.color,
      lineWidth: ANNOTATION_DEFAULTS.lineWidth,
      history: [],
      redoStack: [],
    },
    cancelRequestedAt: 0,
  });
},

// 更新工具/颜色/线宽（不触发重绘）
updateAnnotationTool: (tool) => {
  set(s => ({ annotationState: s.annotationState ? { ...s.annotationState, tool } : null }));
},
updateAnnotationColor: (color) => { ... },
updateAnnotationLineWidth: (lineWidth) => { ... },

// 绘制操作 — 唯一写入 history 的入口
pushDrawOp: (op) => {
  const state = get().annotationState;
  if (!state) return;
  const next = [...state.history, op];
  if (next.length > ANNOTATION_DEFAULTS.maxHistory) next.shift();
  set({ annotationState: { ...state, history: next, redoStack: [] } });
},

// 撤销 — 返回被撤销的 op（供 Canvas 重绘用）
undoDrawOp: () => {
  const state = get().annotationState;
  if (!state || state.history.length === 0) return null;
  const history = [...state.history];
  const op = history.pop()!;
  set({ annotationState: { ...state, history, redoStack: [...state.redoStack, op] } });
  return op;  // Canvas 使用此返回值决定是否需要重绘
},

// 重做 — 返回被恢复的 op
redoDrawOp: () => {
  const state = get().annotationState;
  if (!state || state.redoStack.length === 0) return null;
  const redoStack = [...state.redoStack];
  const op = redoStack.pop()!;
  set({ annotationState: { ...state, history: [...state.history, op], redoStack } });
  return op;
},

// 清空
clearAnnotationState: () => set({ annotationState: null }),
```

**测试 (nodeStore.test.ts 扩展):**
- initAnnotationState 在 activeEditNodeId 为 null 时安全跳过
- pushDrawOp 推入 + 清空 redoStack + 50 步上限截断
- undoDrawOp / redoDrawOp 所有边界
- 工具/颜色/线宽更新不改变 history 和 redoStack
- clearAnnotationState 置 null

---

### Step 2: AnnotationCanvas 组件

**文件:** `AnnotationCanvas.tsx`

**关键架构：三层 Canvas + 单一数据源**

**Props:**
```ts
interface AnnotationCanvasProps {
  // ★ 使用图片内容实际渲染尺寸（getBoundingClientRect），而非节点容器尺寸
  // 兼容 object-fit: contain/cover 等所有模式，消除留白偏移
  displayWidth: number;   // 图片内容 CSS 像素宽
  displayHeight: number;  // 图片内容 CSS 像素高
  naturalWidth: number;   // 原图像素宽
  naturalHeight: number;  // 原图像素高
  offsetX: number;        // ★ 图片内容相对于容器的水平偏移（居中留白区域）
  offsetY: number;        // ★ 图片内容相对于容器的垂直偏移
  imageRef: React.RefObject<HTMLImageElement | null>;
  imageUrl?: string;
  disabled: boolean;
}
```

**Ref API (AnnotationCanvasHandle):**
```ts
export interface AnnotationCanvasHandle {
  hasContent: () => boolean;
  getAnnotatedBlob: () => Promise<Blob>;
}
```

注：undo/redo 通过 Store action 驱动 + history 变化自动重绘，不需要暴露 ref 方法。

**坐标换算（修正版 — 无冗余 DPR + 存储逻辑坐标）:**
```ts
// canvas.width 已是物理像素（= displayWidth × dpr）
// rect.width 是 CSS 像素（= displayWidth）
const rect = canvas.getBoundingClientRect();
const scaleX = canvas.width / rect.width;        // = dpr
const scaleY = canvas.height / rect.height;       // = dpr
const physicalX = (e.clientX - rect.left) * scaleX;  // 物理像素坐标
const physicalY = (e.clientY - rect.top) * scaleY;

// ★ 写入 Store 前：物理坐标 ÷ dpr → CSS 逻辑坐标（统一存储维度）
const logicalX = physicalX / dpr;
const logicalY = physicalY / dpr;

// 离屏映射：逻辑坐标 × naturalScale → 原图像素坐标
const naturalScale = naturalWidth / displayWidth;
const offscreenX = logicalX * naturalScale;
const offscreenY = logicalY * naturalScale;
```

**★ 统一显示层双 Canvas 尺寸规则:**
```ts
// 两层 Canvas 严格一致：
const dpr = window.devicePixelRatio || 1;
const canvasWidth = displayWidth * dpr;
const canvasHeight = displayHeight * dpr;

// 历史层
historyCanvas.width = canvasWidth;
historyCanvas.height = canvasHeight;
historyCanvas.style.width = `${displayWidth}px`;
historyCanvas.style.height = `${displayHeight}px`;
historyCtx.setTransform(dpr, 0, 0, dpr, 0, 0);  // 统一 DPR 缩放

// 临时层（叠加在历史层正上方）
tempCanvas.width = canvasWidth;
tempCanvas.height = canvasHeight;
tempCanvas.style.width = `${displayWidth}px`;
tempCanvas.style.height = `${displayHeight}px`;
tempCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
```

临时层 CSS:
```ts
position: absolute; left: 0; top: 0; // 像素级对齐历史层
pointer-events: none;  // 事件由历史层处理，临时层仅负责展示
```

**三层 Canvas 结构（object-fit 对齐修正）:**
```tsx
// ★ Canvas 绝对定位于图片内容区域正上方，offset 处理 contain 模式的留白
<div style={{
  position: 'absolute',
  left: offsetX,      // ★ 图片内容相对容器的水平偏移
  top: offsetY,       // ★ 图片内容相对容器的垂直偏移
  width: displayWidth,
  height: displayHeight,
}}>
  {/* 底层：历史 Canvas — 仅在 history 变化时全量重绘 */}
  <canvas ref={historyCanvasRef} style={{ position: 'absolute', left: 0, top: 0 }} />
  {/* 顶层：临时 Canvas — pointermove 时清空重绘当前图形 */}
  <canvas ref={tempCanvasRef} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }} />
</div>
// 离屏 Canvas（内存中，不渲染）
// const offscreenCanvas = document.createElement('canvas');
```
displayWidth/displayHeight/offsetX/offsetY 在 ImageGenNode 中通过 `imgRef.current.getBoundingClientRect()` 与容器 `getBoundingClientRect()` 的差值实时计算。

**★ Store 订阅触发机制（响应式联动）:**
```ts
// 通过 Zustand selector 订阅，history 变更时自动触发重绘
const history = useNodeStore(state => state.annotationState?.history ?? []);
const redoStack = useNodeStore(state => state.annotationState?.redoStack ?? []);

// history 变更 → 全量重绘
useEffect(() => {
  const hCtx = historyCanvasRef.current?.getContext('2d');
  if (!hCtx) return;
  hCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  hCtx.clearRect(0, 0, displayWidth, displayHeight);
  for (const op of history) drawOpToCanvas(hCtx, op, dpr, false);

  // 同步离屏层
  const naturalScale = naturalWidth / displayWidth;
  const oCtx = offscreenCanvas.getContext('2d')!;
  oCtx.clearRect(0, 0, naturalWidth, naturalHeight);
  for (const op of history) drawOpToCanvas(oCtx, op, naturalScale, true);
}, [history]);  // Zustand selector 驱动，Store 变更即重绘
```

**★ 组件挂载初始化（关键！）:**
```ts
// 首次挂载 / 卸载后重挂载时，从 Store 恢复所有标注内容
// 注意：首次挂载时 history 可能已有值（Zustand selector 首次返回当前值），
// 上面的 useEffect 已覆盖。但 Canvas 元素在首次渲染时可能尚未就位，
// 需在 Canvas ref 就位后额外触发一次基准重绘。
useEffect(() => {
  // Canvas DOM 就位后立即执行一次恢复
  if (!historyCanvasRef.current) return;
  const hCtx = historyCanvasRef.current.getContext('2d');
  if (!hCtx) return;
  hCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  hCtx.clearRect(0, 0, displayWidth, displayHeight);
  for (const op of history) drawOpToCanvas(hCtx, op, dpr, false);

  // 离屏层同步
  const naturalScale = naturalWidth / displayWidth;
  const oCtx = offscreenCanvas.getContext('2d')!;
  oCtx.clearRect(0, 0, naturalWidth, naturalHeight);
  for (const op of history) drawOpToCanvas(oCtx, op, naturalScale, true);
}, []);  // 空依赖，仅 mount 时执行一次（canvas ref 就位）
```
双重保障：history useEffect 处理后续变更，mount useEffect 处理 canvas DOM 就位后的首次恢复。"
```

**交互流程:**
```
pointerdown → 记录起点，saveSnapshot（保存离屏状态用于 rect/line 预览回滚）
pointermove → 清空 tempCanvas → 绘制当前未提交图形（极快，不触发全量重绘）
pointerup   → 构建 DrawOp → store.pushDrawOp(op)
              → history 变化触发 useEffect → 全量重绘 historyCanvas + 离屏 Canvas
              → 清空 tempCanvas
```

**绘制逻辑（三种工具）:**
- `pen`: pointermove 时在 tempCanvas 绘制当前连线；pointerup 构建 PenOp（points 数组含 pressure）
- `rect`: pointermove 时在 tempCanvas 绘制预览矩形；pointerup 构建 RectOp（x1,y1,x2,y2）
- `line`: pointermove 时在 tempCanvas 绘制预览直线；pointerup 构建 LineOp（x1,y1,x2,y2）

**离屏 Canvas 重建（尺寸变化时）:**
```ts
useEffect(() => {
  if (naturalWidth !== prevNaturalWidth || naturalHeight !== prevNaturalHeight) {
    // 销毁旧离屏 Canvas
    offscreenCanvas.width = 0;
    offscreenCanvas.height = 0;
    // 创建新离屏 Canvas
    offscreenCanvas.width = naturalWidth;
    offscreenCanvas.height = naturalHeight;
    // 全量重绘所有 history 到新离屏 Canvas
    redrawAll();
  }
}, [naturalWidth, naturalHeight]);
```

**合成导出（修正版 — 优先复用已加载 DOM 元素，零额外请求）:**
```ts
getAnnotatedBlob: async (): Promise<Blob> => {
  // ★ 优先使用节点内已加载完成的 <img> DOM 元素
  let img: HTMLImageElement | null = imageRef?.current ?? null;

  // 兜底：通过 URL 重新加载（必须先设 crossOrigin 再赋 src）
  if (!img && imageUrl) {
    img = new Image();
    img.crossOrigin = 'anonymous';  // 必须在 src 之前设置，避免浏览器缓存绕过
    img.src = imageUrl;
    await new Promise<void>((resolve, reject) => {
      img!.onload = () => resolve();
      img!.onerror = () => reject(new Error('图片加载失败'));
    });
  }

  if (!img) throw new Error('无可用的图片源');
  if (!img.complete) throw new Error('图片尚未加载完成');

  // 尺寸上限检查（Chrome ~16384px）
  let exportW = naturalWidth, exportH = naturalHeight;
  const MAX = 16384;
  if (exportW > MAX || exportH > MAX) {
    const ratio = Math.min(MAX / exportW, MAX / exportH);
    exportW = Math.round(exportW * ratio);
    exportH = Math.round(exportH * ratio);
  }

  // 创建临时合成画布（此次导出专用，不污染离屏层）
  const composite = document.createElement('canvas');
  composite.width = exportW;
  composite.height = exportH;
  const ctx = composite.getContext('2d')!;
  ctx.drawImage(img, 0, 0, exportW, exportH);      // 1. 原图
  ctx.drawImage(offscreenCanvas, 0, 0, exportW, exportH);  // 2. 标注层

  return new Promise((resolve, reject) => {
    composite.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('标注导出失败'));
    }, 'image/png');
  });
}
```

**压感处理:**
```ts
const pressure = e.pressure || ANNOTATION_DEFAULTS.mousePressure;
const effectivePressure = Math.max(ANNOTATION_DEFAULTS.pressureMin, pressure);
const currentLineWidth = baseLineWidth * effectivePressure;
```

**disabled 状态:** isSaving 时所有 pointer 事件提前 return

**交互流程（参数快照模式）:**
```
pointerdown → 快照当前 tool/color/lineWidth 到 ref
               isDrawing = true
               保存离屏快照（用于 rect/line 预览回滚）
pointermove → tempCanvas 清空 + 绘制当前图形（使用快照参数）
pointerup   → 用快照参数构建 DrawOp（逻辑坐标）
               store.pushDrawOp(op)
               isDrawing = false
               清空 tempCanvas
               → history 变更 → useEffect → historyCanvas + 离屏全量重绘
```

**★ 绘制中途参数切换（快照隔离 + 变更中断）:**
```ts
// pointerdown 时快照当前参数到 ref（本次绘制全程使用）
const toolRef = useRef(tool);
const colorRef = useRef(color);
const lineWidthRef = useRef(lineWidth);

// pointerdown:
toolRef.current = tool;
colorRef.current = color;
lineWidthRef.current = lineWidth;

// pointermove 使用 ref 中的快照值（不受 Store 更新影响）
const currentTool = toolRef.current;
// ... 绘制使用 currentTool / colorRef.current / lineWidthRef.current

// ★ 单独监听参数变更：若处于绘制中则立即终止
useEffect(() => {
  if (isDrawing.current) {
    // 终止当前未提交绘制
    clearTempCanvas();
    isDrawing.current = false;
    // 恢复离屏快照状态（若有）
  }
  // 新参数仅对下一次 pointerdown 生效（已通过 ref 快照隔离）
}, [tool, color, lineWidth]);
```
- **优势：** 无需在 pointermove 中频繁检测参数变化；新参数自动隔离到下次 pointerdown
- **行为：** 颜色/线宽修改不回溯已提交历史，对齐设计软件心智模型

**组件卸载清理:**
```ts
useEffect(() => () => {
  offscreenCanvas.width = 0; offscreenCanvas.height = 0;
  // 移除所有 pointer 事件监听（React 自动处理，若有手动 addEventListener 则清理）
}, []);
```

**测试 (AnnotationCanvas.test.tsx):**
- 使用 jest-canvas-mock，断言 2D 上下文方法调用
- pointer 事件模拟 → 验证 pushDrawOp 被调用
- hasContent 返回正确状态
- getAnnotatedBlob 返回非空 Blob
- disabled 时不响应事件
- 原图跨域时捕获 SecurityError
- 超大尺寸图片自动压缩

---

### Step 3: AnnotationToolbar 组件

**文件:** `AnnotationToolbar.tsx`

**Props:**
```ts
interface AnnotationToolbarProps {
  tool: 'pen' | 'rect' | 'line';
  onToolChange: (t: 'pen' | 'rect' | 'line') => void;
  color: string;
  onColorChange: (c: string) => void;
  lineWidth: number;
  onLineWidthChange: (w: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  hasContent: boolean;
  nodeWidth?: number;
}
```

**布局：** `[← 标注] | [画笔] [矩形] [直线] | [预设×6] [🎨ColorPicker] | [━━Slider━━] | [↩] [↪] | [保存]`

**实现要点:**
- 样式常量复用 EditToolbar 的 BAR_BG / BAR_BORDER / TEXT_COLOR
- **颜色预设：** 6 个圆形按钮（黑 #000 / 白 #FFF / 红 #FF0000 / 黄 #FFD700 / 蓝 #0066FF / 绿 #00AA55），点击选中态：边框高亮
- **自定义颜色：** 复用 Ant Design 5 `<ColorPicker>` 组件，format='hex'
- **线宽滑块：** 复用 Ant Design `<Slider>`，min=1 max=40 step=1，marks: {1,4,10,20,40}
- **Undo/Redo 按钮：** 增加 Ant Design `<Tooltip>` 提示快捷键（"撤销 (Ctrl+Z)" / "重做 (Ctrl+Shift+Z)"）
- **工具按钮：** 选中态 bg-[rgba(255,255,255,0.1)]
- **保存按钮：** 白色背景 + 黑色文字，isSaving 时显示"保存中..."并 disabled
- **createPortal 到 document.body**（id='node-toolbar-portal'）
- **定位：** 复用 `useViewport` + `useInternalNode` 计算节点上方位置
- **窄节点适配：** min-width: 360px（估算），width: fit-content

**测试 (AnnotationToolbar.test.tsx):**
- 渲染所有按钮/控件
- 工具切换 onToolChange 回调
- 颜色预设点击 + ColorPicker onChange
- Slider onChange 回调
- 保存按钮 disabled/isSaving 状态
- Undo/Redo disabled 状态跟随 canUndo/canRedo
- 退出按钮触发 onCancel

---

### Step 4: ImageNodeToolbar 接线

**文件:** `ImageNodeToolbar.tsx`

1. Props 增加 `onAnnotate?: () => void`
2. 标注按钮绑定：
```tsx
<TextIconButton
  icon={<EditOutlined style={{ fontSize: 16 }} />}
  ariaLabel="标注"
  text="标注"
  onClick={onAnnotate}
/>
```

---

### Step 5: ImageGenNode 接线

**文件:** `ImageGenNode.tsx`

**5.1 enterEditMode 类型扩展:**
```ts
const enterEditMode = useCallback((mode: 'crop' | 'outpaint' | 'erase' | 'redraw' | 'annotate') => { ... }
```

**5.2 进入标注模式:**
```ts
const handleAnnotate = useCallback(() => {
  // 原图加载校验
  if (!imgLoaded) {
    message.warning('图片尚未加载完成，请稍后重试');
    return;
  }
  enterEditMode('annotate');
  useNodeStore.getState().initAnnotationState();
}, [enterEditMode, imgLoaded]);
```

**5.3 保存标注:**
```ts
const handleAnnotationSave = useCallback(async () => {
  if (!annotationRef.current) return;
  setProcessing(true);
  setEditError(null);
  try {
    const blob = await annotationRef.current.getAnnotatedBlob();
    const nodeName = nodeData?.mediaName || fileId || 'image';
    const fileName = `${nodeName}_annotated.png`;
    const file = new File([blob], fileName, { type: 'image/png' });
    const { fileId: newId, uploadUrl, key, fields } = await presignUpload({
      fileName: file.name, fileSize: file.size, fileType: 'image/png', type: 'uploaded',
    });
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
    fd.append('file', file);
    const proxy = import.meta.env.DEV
      ? uploadUrl.replace(/^http:\/\/[^/]+\/flowai/, '/minio-storage')
      : uploadUrl;
    await axios.post(proxy, fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 30000 });
    await confirmUpload({ fileId: newId, key, fileSize: file.size });

    updateConfig(id, { editMode: null });
    // 补全新节点 type + name
    const newNodeId = useCanvasStore.getState().addChildNode(id, {
      fileId: newId,
      status: 'done',
      mediaName: fileName,
    });
    useNodeStore.getState().setActiveEditNodeId(null);
    useNodeStore.getState().clearAnnotationState();
    // 视口居中到新节点
    if (newNodeId) {
      setTimeout(() => {
        fitView({ nodes: [{ id }, { id: newNodeId }], padding: 0.2, duration: 300 });
      }, 100);
    }
    message.success('标注已保存');
  } catch (err: any) {
    console.error('标注保存失败:', err);
    // 保留标注内容，不退出模式
    setEditError('保存失败，请重试');
    message.error('保存失败，请重试');
  } finally {
    setProcessing(false);
  }
}, [id, displayUrl, fileId, nodeData, updateConfig, fitView]);
```

**5.4 取消退出（未保存确认）:**
```ts
const handleAnnotationCancel = useCallback(() => {
  if (isProcessing) return;
  if (useNodeStore.getState().getEditOverlayDragging()) return;
  const store = useNodeStore.getState();
  const hasContent = store.annotationState && store.annotationState.history.length > 0;
  const doExit = () => {
    updateConfig(id, { editMode: null });
    store.setActiveEditNodeId(null);
    store.clearAnnotationState();
  };
  if (hasContent) {
    Modal.confirm({
      title: '放弃标注？',
      content: '当前标注内容尚未保存，退出后将丢失。',
      okText: '放弃',
      cancelText: '继续标注',
      onOk: doExit,
    });
  } else {
    doExit();
  }
}, [id, isProcessing, updateConfig]);
```

**5.5 快捷键（作用域限定）:**
```ts
useEffect(() => {
  if (editMode !== 'annotate') return;
  const handler = (e: KeyboardEvent) => {
    const isActive = useNodeStore.getState().activeEditNodeId === id;
    if (!isActive) return;
    if (e.key === 'Escape') {
      // 绘制中 → 取消当前绘制；空闲 → 退出确认
      if (annotationDrawing.current) {
        annotationDrawing.current = false;
        return;
      }
      handleAnnotationCancel();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      useNodeStore.getState().undoDrawOp();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
      e.preventDefault();
      useNodeStore.getState().redoDrawOp();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
      e.preventDefault();
      useNodeStore.getState().redoDrawOp();
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [editMode, id, handleAnnotationCancel]);
```

**5.6 渲染切换（editMode 分支）:**
```tsx
// ImageNodeToolbar 条件渲染
{editMode === 'annotate' ? (
  <AnnotationToolbar ... />
) : editMode ? (
  <EditToolbar ... />
) : transformMode ? (
  <TransformToolbar ... />
) : (
  <ImageNodeToolbar onAnnotate={handleAnnotate} ... />
)}

// 标注 Canvas 叠加层
{editMode === 'annotate' && (
  <AnnotationCanvas
    ref={annotationRef}
    displayWidth={baseWidth}
    displayHeight={baseHeight}
    naturalWidth={imgSize?.w ?? baseWidth}
    naturalHeight={imgSize?.h ?? baseHeight}
    imageRef={imgRef}                // ★ 复用已加载的 <img> DOM 元素
    imageUrl={displayUrl}            // 兜底 URL
    disabled={isProcessing}
  />
)}
```

**5.7 Resize 锁定：** 标注模式下 `editMode !== null` 时隐藏 NodeResizeControl（现有逻辑已支持，无需额外改动）

**5.8 点击外部退出：** 复用现有 CanvasView 的 `onPaneClick → triggerCancelEdit` 机制，`getEditOverlayDragging()` 已防护绘制中不触发

---

### Step 6: EditToolbar 兼容

**文件:** `EditToolbar.tsx`

- `editMode` prop 类型增加 `'annotate'`
- 不需要新增 isPaint/isAi 判断分支
- 实际标注模式不渲染 EditToolbar（ImageGenNode 直接渲染 AnnotationToolbar）

---

## 5. 数据流图

```
点击「标注」
  → handleAnnotate()
    → imgLoaded 校验
    → nodeStore.setActiveEditNodeId(id)
    → nodeStore.initAnnotationState()
    → updateConfig(id, { editMode: 'annotate' })

绘制 (pointerdown/move/up)
  → tempCanvas 实时绘制（无全量重绘）
  → pointerup → store.pushDrawOp(op)
    → history 变化 → useEffect → historyCanvas 全量重绘 + 离屏 Canvas 同步

撤销 Ctrl+Z
  → store.undoDrawOp()
    → history 变化 → useEffect → 全量重绘

保存
  → annotationRef.getAnnotatedBlob()
    → ★ 优先 imageRef.current (零额外请求，跨域一致)
    → 兜底 new Image() with crossOrigin then src
    → 尺寸上限检查(16384px)
    → 临时合成 Canvas: drawImage(原图) → drawImage(离屏)
    → toBlob('image/png')
  → presignUpload → axios.post → confirmUpload
  → canvasStore.addChildNode(id, { fileId, status, mediaName })
    → 新节点 (原节点右侧)
    → Edge (原节点 → 新节点)
  → fitView 居中 → message.success
  → clearAnnotationState() + editMode = null

退出 (Escape/点击外部/退出按钮)
  → hasContent? → Modal.confirm → 确认 → doExit
  → hasContent? → Modal.confirm → 取消 → 保持模式
```

## 6. 关键技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 单一数据源 | Store.history 唯一，Canvas 被动重绘 | 避免组件卸载重渲染后状态不一致 |
| 离屏 Canvas 纯净 | 永久仅存储透明标注内容 | 导出时临时合成，不污染标注层 |
| 坐标体系 | CSS 逻辑坐标存储 + drawOpToCanvas 统一缩放 | 避免物理/逻辑坐标混乱，历史重绘与离屏映射一致 |
| object-fit 对齐 | img.getBoundingClientRect() + offsetX/Y | 消除 contain/cover 留白导致的坐标偏移 |
| 历史订阅 | Zustand selector `(state) => state.annotationState?.history` | 响应式联动，Store 变更自动触发重绘 |
| 参数切换 | pointerdown 快照 + useEffect 变更中断 | 隔离当前绘制，新参数仅影响下次绘制 |
| 三层 Canvas | 历史层 + 临时层 + 离屏层 | 临时层避免 pointermove 全量重绘卡顿；两层统一 dpr 尺寸 |
| 显示层尺寸 | 两层 canvas 共用物理/CSS/DPR 规则 | 像素级对齐，无偏移/粗细偏差 |
| DrawOp 差异化 | PenOp / RectOp / LineOp | 矩形/直线仅需起止点，减少冗余数据 |
| 颜色选择器 | Ant Design ColorPicker | 统一 hex 格式，UI 一致性 |
| 线宽滑块 | Ant Design Slider + marks | 操作精准度，项目已有依赖 |
| 新节点属性 | type + mediaName 完整 | 节点可识别，符合项目规范 |
| 视口跟随 | fitView 同时包含原节点+新节点 | 用户可立刻感知输出结果 |

## 7. 测试策略

| 测试文件 | 测试内容 | 工具 |
|------|------|------|
| `nodeStore.test.ts` (扩展) | annotationState actions 全部边界 | vitest |
| `AnnotationCanvas.test.tsx` | 三层 Canvas 渲染、挂载恢复、pointer 事件、绘制中断、hasContent、getAnnotatedBlob、disabled、跨域 | jest-canvas-mock |
| `AnnotationToolbar.test.tsx` | 工具切换、颜色选择、Slider、保存/退出回调、disabled 状态 | vitest + RTL |
| `ImageGenNode.test.tsx` (扩展) | 进入标注→绘制→保存→addChildNode 调用 → 退出确认 | vitest + RTL mock |

**边界测试用例：**
- 空历史状态下撤销/重做按钮禁用
- 历史达到 50 步上限后最早操作被丢弃
- 组件挂载 → 从 Store history 全量恢复 → Canvas 非空
- 组件卸载 → 重新挂载 → 标注内容完整恢复（模拟视口滚动场景）
- 绘制中途切换工具 → 当前未提交绘制丢弃，新工具生效
- 绘制中途修改颜色/线宽 → 当前绘制丢弃，新参数仅对后续生效
- 原图跨域时 getAnnotatedBlob 抛出可识别错误
- 原图未加载完成时 getAnnotatedBlob 抛出明确错误
- 保存过程中全工具栏 disabled + Canvas 不响应事件
- 原图未加载完成时点击标注按钮 → 校验拦截
- 超大图片（>16384px）自动等比压缩合成
