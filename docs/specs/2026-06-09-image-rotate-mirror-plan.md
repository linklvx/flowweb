# Plan: 图片节点旋转与镜像功能

## 实施顺序（TDD 每阶段 test → implement → pass）

### Phase 1: 数据层 — nodeStore 类型与默认值

**涉及文件**: `apps/web/src/stores/nodeStore.ts`

**变更**:
1. `ImageNodeData` 新增字段:
   ```typescript
   imageRotation?: 0 | 90 | 180 | 270;
   flipH?: boolean;
   flipV?: boolean;
   transformMode?: boolean;
   ```
2. `mergeNodeData` 默认值补充 `imageRotation: 0, flipH: false, flipV: false, transformMode: false`

**验证**: `pnpm test -- --run apps/web/src/stores/nodeStore.test.ts`

---

### Phase 2: 工具栏 — ImageNodeToolbar 右键->"旋转与镜像"按钮

**涉及文件**:
- `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.tsx`
- `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx`

**变更**:
1. 删除 RotateCcwIcon / RotateCwIcon 两个 `IconButton`
2. 新增 `TextIconButton` "旋转与镜像"按钮（带箭头 SVG icon）
3. 无图片时按钮 disabled
4. Props 新增 `onRotateMirror?: () => void`

**验证**: `pnpm test -- --run apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx`

---

### Phase 3: 变换工具栏 — TransformToolbar 新组件

**涉及文件** (新建):
- `apps/web/src/pages/canvas/components/nodes/TransformToolbar.tsx`
- `apps/web/src/pages/canvas/components/nodes/TransformToolbar.test.tsx`

**组件结构**:
```
┌──────────────────────────────────────────────────────┐
│ [← 旋转与镜像] │ 90° │ [↻90°] [↔] [↕] │ [保存]     │
└──────────────────────────────────────────────────────┘
```

**Props**:
```typescript
interface TransformToolbarProps {
  nodeId: string;
  rotation: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  selected: boolean;
  isSaving: boolean;
  onRotate: () => void;
  onFlipH: () => void;
  onFlipV: () => void;
  onSave: () => void;
  onCancel: () => void;
}
```

**行为**:
- 顺时针旋转按钮 → `onRotate()`
- 水平镜像 → `onFlipH()`
- 垂直镜像 → `onFlipV()`
- 保存按钮 → `onSave()`，`isSaving` 时 disabled+loading
- "旋转与镜像"按钮 + Escape → `onCancel()`
- 角度输入框只读，固定显示 90°
- 复用 ImageNodeToolbar 的 Portal 定位逻辑
- 样式完全匹配用户提供的 CSS

**验证**: `pnpm test -- --run apps/web/src/pages/canvas/components/nodes/TransformToolbar.test.tsx`

---

### Phase 4: Canvas 变换工具函数 — transformImage

**涉及文件** (新建):
- `apps/web/src/utils/imageTransform.ts`
- `apps/web/src/utils/imageTransform.test.ts`

**核心逻辑**:
```typescript
export function transformImage(
  imageUrl: string,
  rotation: 0 | 90 | 180 | 270,
  flipH: boolean,
  flipV: boolean,
  maxSize: number = 2048
): Promise<Blob>
```

**绘制顺序** (严格):
1. Canvas 尺寸计算: 90°/270° 时交换宽高
2. `ctx.translate(cx, cy)`
3. `ctx.rotate(rad)`
4. `ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)`
5. `ctx.drawImage(img, -w/2, -h/2, w, h)`
6. `canvas.toBlob()` → PNG
7. 释放 `img.src=''`, `canvas.width=0, height=0`

**边界**: 超 2048px 等比缩小，Image 加载失败 reject，跨域设置 `crossOrigin='anonymous'`

**验证**: `pnpm test -- --run apps/web/src/utils/imageTransform.test.ts`

---

### Phase 5: ImageGenNode 变换模式集成

**涉及文件**: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx`

**变更**:
1. 判断 `nodeData.transformMode === true` 时渲染 TransformToolbar 替代 ImageNodeToolbar
2. `<img>` 应用 CSS transform 实时预览:
   ```css
   transform: rotate(Ndeg) scaleX(flipH?-1:1) scaleY(flipV?-1:1)
   transition: transform 0.3s ease
   ```
3. 旋转 90°/270° 时交换容器宽高 — 使用 `useUpdateNodeDimensions`
4. Escape 键 + Ctrl+S 快捷键（capture 阶段）
5. 保存逻辑: `transformImage` → `presignUpload` → `confirmUpload` → `updateConfig`
6. 取消逻辑: 判断 `hasChanges` → 确认弹窗 / 直接删除节点
7. `activeTransformNodeId` 互斥: nodeStore 新增该字段

**验证**: `pnpm test -- --run apps/web/src/pages/canvas/components/nodes/ImageGenNode.test.tsx`

---

### Phase 6: 创建节点+连线流程

**涉及文件**: `apps/web/src/stores/canvasStore.ts`

**变更**:
- 新增 `addNodeWithEdge` 方法: 复制节点数据 → 创建偏移位置的新节点 → 创建 source→target edge
- ImageNodeToolbar 的"旋转与镜像"按钮 onClick 调用此流程:
  1. `canvasStore.addNodeWithEdge(sourceNodeId)` → 创建节点B + Edge
  2. `updateConfig(newNodeId, { transformMode: true })` → 进入变换模式

**验证**: `pnpm test -- --run apps/web/src/stores/canvasStore.test.ts`

---

### Phase 7: 端到端验证

手动在浏览器中验证完整流程:
1. 选中图片节点 → 工具栏出现 "旋转与镜像" 按钮
2. 点击 → 创建新节点+连线 → 变换工具栏出现
3. 旋转90° → 图片旋转 + 节点尺寸跟随交换
4. 水平/垂直镜像 → CSS 实时预览
5. 保存 → Canvas 处理 → 上传 → 节点更新
6. 取消(无变更) → 删除节点
7. 取消(有变更) → 确认弹窗
8. Escape 退出变换模式
9. 同时只能一个节点处于变换模式

---

## 文件清单

| 文件 | 操作 | Phase |
|------|------|-------|
| `nodeStore.ts` | 修改类型 + 默认值 | 1 |
| `ImageNodeToolbar.tsx` | 修改按钮 | 2 |
| `ImageNodeToolbar.test.tsx` | 修改测试 | 2 |
| `TransformToolbar.tsx` | 新建 | 3 |
| `TransformToolbar.test.tsx` | 新建 | 3 |
| `imageTransform.ts` | 新建 | 4 |
| `imageTransform.test.ts` | 新建 | 4 |
| `ImageGenNode.tsx` | 修改集成 | 5 |
| `ImageGenNode.test.tsx` | 修改测试 | 5 |
| `canvasStore.ts` | 新增方法 | 6 |
