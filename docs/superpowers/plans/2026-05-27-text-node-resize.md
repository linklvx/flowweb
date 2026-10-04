<!-- doc-status: historical | verified_at: n/a -->
# TextNode Resize 实施计划 v2.0

> **Goal:** 为 TextInputNode 添加 NodeResizer，支持拖拽调整大小，尺寸持久化到数据库
> **Tech Stack:** React 18 + @xyflow/react 12.x + TipTap + Prisma + NestJS + Vitest

---

## 架构概览

```
NodeResizer (@xyflow/react)
    ↓ 更新 node.width / node.height
onNodesChange → applyNodeChanges + syncNodeDimensions (debounce)
    ↓ 500ms debounce + 3 次重试
PATCH /api/projects/:id/nodes/dimensions
    ↓ $transaction
Prisma CanvasNode.width / height 持久化

项目保存 (syncNodes PUT) → 兜底全量同步
页面加载 (loadProjectIntoStore) → width ?? 280 / height ?? 120 → React Flow 节点
```

---

## 文件结构

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/api/prisma/schema.prisma` | 修改 | Node 模型 + `width`/`height` |
| `apps/api/src/modules/project/dto/update-node-dimensions.dto.ts` | 新建 | DTO 验证 |
| `apps/api/src/modules/project/project.controller.ts` | 修改 | + `PATCH dimensions` |
| `apps/api/src/modules/project/project.service.ts` | 修改 | `syncNodes` 含 width/height + `updateDimensions` |
| `apps/web/src/utils/debounce.ts` | 新建 | 防抖工具函数 |
| `apps/web/src/stores/canvasStore.ts` | 修改 | `addNode` 初始尺寸 + `copyNode` |
| `apps/web/src/pages/canvas/components/nodes/TextInputNode.tsx` | 修改 | NodeResizer + 动态尺寸 + 高度公式 |
| `apps/web/src/pages/canvas/components/nodes/TextInputNode.module.css` | 新建 | 手柄样式覆盖 |
| `apps/web/src/pages/canvas/components/nodes/TextInputNode.test.tsx` | 修改 | 13 条 resize 测试 |
| `apps/web/src/pages/canvas/components/CanvasView.tsx` | 修改 | `onNodesChange` 防抖同步 |
| `apps/web/src/pages/canvas/page.tsx` | 修改 | `loadProjectIntoStore` / `syncNodes` 含尺寸 |

---

## Task 1: 基础设施 — Prisma Migration + debounce 工具

### Step 1: schema.prisma

在 `CanvasNode` 模型添加：

```prisma
width     Float    @default(280)
height    Float    @default(120)
```

### Step 2: 运行 Migration

```bash
cd apps/api && npx prisma migrate dev --name add_node_dimensions
```

Verify: `npx prisma db push --preview-feature` 无错误

### Step 3: debounce 工具函数

新建 `apps/web/src/utils/debounce.ts`：

```typescript
export function debounce<T extends (...args: any[]) => any>(
  fn: T, ms: number
): T & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout>;
  const debounced = (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced as any;
}
```

Verify: `cd apps/api && npx prisma migrate dev --name add_node_dimensions` + `cd apps/web && npx tsc --noEmit`

---

## Task 2: 后端 API — width/height 支持 + DTO 验证

### Step 1: DTO 验证文件

新建 `apps/api/src/modules/project/dto/update-node-dimensions.dto.ts`：

```typescript
import { IsString, IsNumber, Min, Max } from 'class-validator';

export class UpdateNodeDimensionsDto {
  @IsString()
  id: string;

  @IsNumber()
  @Min(280)
  @Max(2000)
  width: number;

  @IsNumber()
  @Min(120)
  @Max(1500)
  height: number;
}
```

### Step 2: Service 层

修改 `syncNodes` (PUT) 包含 width/height：

```typescript
await tx.canvasNode.createMany({
  data: nodes.map(n => ({
    id: n.id, projectId, type: n.type,
    position: n.position || { x: 0, y: 0 },
    data: n.data || {},
    width: n.width ?? 280, height: n.height ?? 120,
  })),
});
```

新增 `updateDimensions`:

```typescript
async updateDimensions(projectId: string, dto: { id: string; width: number; height: number }[]) {
  await this.prisma.$transaction(async (tx) => {
    await Promise.all(dto.map(({ id, width, height }) =>
      tx.canvasNode.update({ where: { id }, data: { width, height } })
    ));
  });
}
```

### Step 3: Controller

```typescript
@Patch(':id/nodes/dimensions')
async updateDimensions(
  @Param('id') id: string,
  @Body(new ValidationPipe({ transform: true })) dto: UpdateNodeDimensionsDto[]
) {
  await this.service.updateDimensions(id, dto);
  return { success: true };
}
```

---

## Task 3: canvasStore 扩展 (TDD)

### RED: 写测试 `canvasStore.test.ts`

新增 3 条：
1. `addNode('text', ...)` 创建的节点 width=280, height=120
2. `copyNode(id)` 新节点 width/height == 原节点，且 nodeStore 中也传递了 width/height
3. `onNodesChange` 正确应用 dimensions 类型的变化

### GREEN: 实现

**canvasStore.ts `addNode`**:
```typescript
if (type === 'text' || resolvedType === 'textInput') {
  node.width = 280;
  node.height = 120;
}
```

**canvasStore.ts `copyNode`** (新增方法):
```typescript
copyNode: (nodeId: string) => {
  const node = get().nodes.find(n => n.id === nodeId);
  if (!node) return null;
  const id = getId('node');
  const newNode: Node = {
    ...node, id,
    position: { x: node.position.x + 50, y: node.position.y + 50 },
    width: node.width, height: node.height,
    selected: true,
  };
  set((s) => ({
    nodes: [...s.nodes.map(n => ({ ...n, selected: false })), newNode],
    selectedId: id,
  }));
  useNodeStore.getState().addNode({
    id, type: node.type!, position: newNode.position,
    data: node.data as any,
    width: node.width,   // ← 关键：传递尺寸给 nodeStore
    height: node.height, // ← 关键
  });
  return id;
},
```

**NodeState 接口**添加 `copyNode` 签名 + `addNode` 参数类型扩展 `width`/`height`。

---

## Task 4: TextInputNode.tsx — NodeResizer 集成 (TDD)

### RED: 写/更新测试 `TextInputNode.test.tsx`

13 条测试：

| # | 测试 |
|---|------|
| 1 | 初始未传 width/height 时使用默认 280×120 |
| 2 | `appNode.width/height` 存在时卡片使用该值 |
| 3 | 单节点选中显示 8 个 resize 手柄 (`querySelectorAll('[class*="resize-handle"]')`) |
| 4 | 多节点选中无手柄 |
| 5 | 未选中无手柄 |
| 6 | NodeResizer 有 minHeight=120 |
| 7 | NodeResizer isVisible 仅 selected=true + 单选中时 true |
| 8 | 选中时存在 border overlay (`data-testid="border-overlay"`) |
| 9 | 编辑器高度 = max(80, nodeHeight - 40) |
| 10 | Handle 位置存在（target + source 各 1） |
| 11 | 动态宽度应用于卡片 body |
| 12 | 标题栏存在且可编辑 |
| 13 | 工具栏可见 |

### GREEN: 实现 TextInputNode.tsx

关键改动：

```typescript
import { NodeResizer, useReactFlow, Handle, Position, type NodeProps } from '@xyflow/react';

// 组件内
const { getSelectedNodes } = useReactFlow();
const nodeWidth = appNode?.width ?? 280;
const nodeHeight = appNode?.height ?? 120;
const isSingleSelected = selected && getSelectedNodes().length === 1;
const editorHeight = Math.max(80, nodeHeight - 40);

<NodeResizer
  minWidth={280}
  minHeight={120}
  maxWidth={2000}
  maxHeight={1500}
  isVisible={isSingleSelected}
  color="#9CA3AF"
/>
```

**border overlay**: z-index: 10（低于 NodeResizer 默认 z-index: 20，避免遮挡手柄），`pointer-events: none`。

**卡片 body**: 宽度 `nodeWidth`，内边距包裹编辑器，编辑器 `minHeight: editorHeight`。

---

## Task 5: CSS 手柄样式覆盖

创建 `TextInputNode.module.css`：

```css
.border-overlay {
  position: absolute;
  inset: 0;
  border-radius: 8px;
  z-index: 10; /* 低于 NodeResizer 默认 z-index: 20 */
  pointer-events: none;
}

.react-flow__resize-handle {
  width: 8px !important; height: 8px !important;
  border-radius: 2px !important; border-width: 3px !important;
  border-color: #9CA3AF !important; background-color: white !important;
}
.react-flow__resize-line {
  border-width: 3px !important; border-color: #9CA3AF !important;
}
/* 8 方向光标 */
.react-flow__resize-handle.top,
.react-flow__resize-handle.bottom { cursor: ns-resize; }
.react-flow__resize-handle.left,
.react-flow__resize-handle.right { cursor: ew-resize; }
.react-flow__resize-handle.top-left,
.react-flow__resize-handle.bottom-right { cursor: nwse-resize; }
.react-flow__resize-handle.top-right,
.react-flow__resize-handle.bottom-left { cursor: nesw-resize; }
```

---

## Task 6: CanvasView.tsx — 防抖同步

`syncNodeDimensions` 在组件内用 `useMemo` 管理生命周期，避免内存泄漏。

```typescript
import { useMemo, useEffect, useCallback } from 'react';
import { debounce } from '@/utils/debounce';
import { type NodeChange, type DimensionsChange } from '@xyflow/react';

const CanvasView = () => {
  const projectId = useCanvasStore(s => s.projectId);
  const onNodesChangeStore = useCanvasStore(s => s.onNodesChange);

  const syncNodeDimensions = useMemo(
    () => debounce(async (changes: NodeChange[]) => {
      const dimChanges = changes.filter(
        (c): c is DimensionsChange => c.type === 'dimensions'
      );
      if (dimChanges.length === 0) return;

      const data = dimChanges.map(c => ({
        id: c.id,
        width: c.dimensions.width,
        height: c.dimensions.height,
      }));

      for (let i = 0; i < 3; i++) {
        try {
          const res = await fetch(`/api/projects/${projectId}/nodes/dimensions`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          if (!res.ok) throw new Error('HTTP error');
          return;
        } catch (error) {
          if (i === 2) console.error('节点尺寸同步失败，将在项目保存时重试', error);
          await new Promise(r => setTimeout(r, 100 * Math.pow(2, i)));
        }
      }
    }, 500),
    [projectId]
  );

  useEffect(() => {
    return () => { syncNodeDimensions.cancel(); };
  }, [syncNodeDimensions]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    onNodesChangeStore(changes);
    syncNodeDimensions(changes);
  }, [onNodesChangeStore, syncNodeDimensions]);

  // ... <ReactFlow onNodesChange={onNodesChange}>
};
```

---

## Task 7: 前端初始化 — 加载 + 保存 width/height

### 7.1 page.tsx `loadProjectIntoStore`

```typescript
useCanvasStore.setState({
  nodes: (project.nodes || []).map((n: any) => ({
    id: n.id, type: n.type,
    position: n.position || { x: 0, y: 0 },
    data: n.data || {},
    width: n.width ?? 280,
    height: n.height ?? 120,
  })),
  // ...
});
```

nodeStore 同步也同样使用 `?? 280` / `?? 120`。

### 7.2 `syncNodes` 调用

```typescript
nodes: useCanvasStore.getState().nodes.map(n => ({
  id: n.id, type: n.type!, position: n.position,
  data: n.data, width: n.width, height: n.height,
})),
```

---

## Task 8: 全量验证

```bash
cd apps/api && npx prisma migrate dev --name add_node_dimensions
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
cd apps/web && npx vitest run
```

---

## 注意事项

1. **locked 字段**: 当前代码库中不存在，本版不实现。后续添加锁定功能时追加 `disabled={isLocked}`
2. **debounce**: 手写 10 行实现，不引入 lodash 依赖
3. **undo/redo**: React Flow `useUndoRedo` 自动记录 `node.width/height` 变化
4. **syncNodeDimensions 生命周期**: 在 CanvasView 组件内用 `useMemo` + `useEffect cleanup` 管理，避免内存泄漏
5. **border overlay z-index**: `z-index: 10`，低于 NodeResizer 默认 `z-index: 20`，确保手柄不被遮挡
6. **getSelectedNodes()**: 用内置 API 替代手动过滤全部节点，性能更优
