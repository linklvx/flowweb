<!-- doc-status: historical | verified_at: n/a -->
# TextNode 可调整大小 — 功能规格说明书 v3.0

**版本**: 3.0
**日期**: 2026-05-27
**状态**: 待确认

---

## 1. 概述

### 1.1 问题
当前 TextInputNode 使用固定尺寸（`w-[360px]` / `h-[186px]`），用户无法根据内容长度调整节点大小。

### 1.2 解决方案
使用 React Flow 12.x 内置 `NodeResizer` 组件。单节点选中时显示 8 方向拖拽手柄，尺寸通过 `node.width` / `node.height` 顶级字段持久化到数据库。

### 1.3 不做什么
- 不做等比缩放锁定
- 不做内容字体与容器大小联动
- 不修改其他节点类型
- 全屏模式 resize 独立，不受影响

---

## 2. 数据结构

### 2.1 React Flow 节点字段

`@xyflow/react` 12.10.2 中，`NodeResizer` 仅更新 `node.width` / `node.height` **顶级字段**，不修改 `node.style`：

```typescript
// ✅ 正确
node.width = 280;
node.height = 120;

// ❌ 错误
// node.style = { width: 280, height: 120 };
```

### 2.2 canvasStore.ts — addNode 初始尺寸

```typescript
if (type === 'text') {
  node.width = 280;
  node.height = 120;
}
```

### 2.3 canvasStore.ts — copyNode 显式复制

```typescript
const newNode = {
  ...originalNode,
  id: generateId(),
  x: originalNode.x + 50,
  y: originalNode.y + 50,
  width: originalNode.width,
  height: originalNode.height,
};
```

### 2.4 Prisma Schema

```prisma
model Node {
  // ... 现有字段 ...
  width     Float    @default(280)
  height    Float    @default(120)
}
```

迁移：`npx prisma migrate dev --name add_node_dimensions`

### 2.5 组件读取尺寸

```typescript
const nodeWidth = appNode?.width ?? 280;
const nodeHeight = appNode?.height ?? 120;
```

---

## 3. 交互行为

### 3.1 NodeResizer 显示条件

```typescript
const isSingleSelected = selected && selectedNodes.length === 1;
const isLocked = appNode?.data?.locked ?? false;

<NodeResizer
  minWidth={280}
  minHeight={120}
  maxWidth={2000}
  maxHeight={1500}
  isVisible={isSingleSelected && !isLocked}
  disabled={isLocked}
  color="#9CA3AF"
/>
```

| 条件 | 手柄 |
|------|------|
| 单节点选中 + 未锁定 | 显示 8 个手柄 |
| 多节点选中 | 不显示 |
| 锁定节点 | 不显示（`disabled` 双重保险） |
| 未选中 | 不显示 |

### 3.2 内部高度分配

```
节点总高度 = 标题栏(32px) + 编辑器高度 + 底部内边距(8px)
编辑器高度 = max(80px, nodeHeight - 40px)
```

节点最小 120px → 编辑器 80px。

```typescript
const editorMinHeight = 80;
const editorHeight = Math.max(editorMinHeight, nodeHeight - 40);
```

### 3.3 数据同步策略

**"拖拽结束后批量同步"**，非实时同步。

CanvasView.tsx 监听 `onNodesChange`：

```typescript
import { type NodeChange, type DimensionsChange } from '@xyflow/react';
import debounce from 'lodash/debounce';

const syncNodeDimensions = useMemo(
  () => debounce(async (changes: NodeChange[]) => {
    const dimChanges = changes.filter(
      (change): change is DimensionsChange => change.type === 'dimensions'
    );
    if (dimChanges.length === 0) return;

    const data = dimChanges.map(change => ({
      id: change.id,
      width: change.dimensions.width,
      height: change.dimensions.height,
    }));

    // 最多重试 3 次，指数退避
    for (let i = 0; i < 3; i++) {
      try {
        await fetch('/api/nodes/dimensions', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        return;
      } catch (error) {
        if (i === 2) {
          console.error('节点尺寸同步失败，将在项目保存时重试', error);
        }
        await new Promise(r => setTimeout(r, 100 * Math.pow(2, i)));
      }
    }
  }, 500),
  []
);

useEffect(() => {
  return () => { syncNodeDimensions.cancel(); };
}, [syncNodeDimensions]);
```

**兜底**：项目保存时全量同步，确保不丢失。

### 3.4 后端接口

```typescript
// PATCH /api/nodes/dimensions
// Body: [{ id: string, width: number, height: number }]

@Patch('dimensions')
async updateDimensions(@Body() dto: UpdateNodeDimensionsDto[]) {
  return await this.prisma.$transaction(async (tx) => {
    return Promise.all(
      dto.map(({ id, width, height }) =>
        tx.node.update({ where: { id }, data: { width, height } })
      )
    );
  });
}
```

- 使用数据库事务保证幂等性
- 全部成功或全部失败

---

## 4. 视觉规范

| 属性 | 值 |
|------|-----|
| 最小/默认宽度 | 280px |
| 最小/默认高度 | 120px |
| 最大宽度 | 2000px |
| 最大高度 | 1500px |
| 手柄颜色 | `#9CA3AF` |
| 手柄线宽 | 3px |
| 手柄角标 | 8px × 8px，圆角 2px，白底 |

### 4.1 CSS 覆盖（TextInputNode.module.css）

```css
/* 手柄角标样式 */
.react-flow__resize-handle {
  width: 8px !important;
  height: 8px !important;
  border-radius: 2px !important;
  border-width: 3px !important;
  border-color: #9CA3AF !important;
  background-color: white !important;
}

/* 手柄线样式 */
.react-flow__resize-line {
  border-width: 3px !important;
  border-color: #9CA3AF !important;
}

/* 拖拽光标样式 */
.react-flow__resize-handle.top,
.react-flow__resize-handle.bottom {
  cursor: ns-resize;
}
.react-flow__resize-handle.left,
.react-flow__resize-handle.right {
  cursor: ew-resize;
}
.react-flow__resize-handle.top-left,
.react-flow__resize-handle.bottom-right {
  cursor: nwse-resize;
}
.react-flow__resize-handle.top-right,
.react-flow__resize-handle.bottom-left {
  cursor: nesw-resize;
}
```

---

## 5. 修改范围

| 文件 | 操作 | 说明 |
|------|------|------|
| `TextInputNode.tsx` | 修改 | NodeResizer + 动态尺寸 + `disabled` + 高度公式 |
| `TextInputNode.module.css` | **新建** | 手柄样式 + 光标覆盖 |
| `TextInputNode.test.tsx` | 修改 | 13 条 resize 测试 |
| `canvasStore.ts` | 修改 | `addNode` 初始尺寸 + `copyNode` 显式复制 |
| `CanvasView.tsx` | 修改 | `onNodesChange` 防抖同步 |
| `schema.prisma` | 修改 | Node 模型 + `width`/`height` |
| 后端 Node 路由 | 修改 | GET/PATCH + `width`/`height` + `PATCH /api/nodes/dimensions` |
| 前端画布初始化 | 修改 | 加载节点时同步后端尺寸 |

---

## 6. 边界情况

| 场景 | 行为 |
|------|------|
| 初始创建 | 280×120 默认尺寸 |
| 单节点选中 + 未锁定 | 8 个 resize 手柄 |
| 多节点选中 | 无手柄 |
| 锁定节点 | 无手柄，`disabled` 双重保险 |
| 低于 min | NodeResizer 自动限制 |
| 超过 max | NodeResizer 自动限制 |
| 内容很长 | 编辑器内部 `overflow-y-auto` 滚动 |
| 撤销/重做 | `useUndoRedo` 自动记录 |
| 复制节点 | `copyNode` 显式复制 `width`/`height` |
| 粘贴节点 | 使用复制的尺寸 |
| 后端加载 | 初始化时同步后端 `width`/`height` |
| 刷新页面 | 尺寸持久化，不丢失 |
| 同步失败 | 重试 3 次，仍失败则在保存时兜底 |
| Handle 连接点 | `position: absolute` 相对节点容器，resize 后自动正确 |
| 全屏模式 | 独立对话框，不受 resize 影响 |

---

## 7. 测试用例

| # | 测试场景 | 预期 |
|---|---------|------|
| 1 | 初始创建节点 | 尺寸 280×120 |
| 2 | 单节点选中 | 8 个 resize 手柄 |
| 3 | 多节点选中 | 无手柄 |
| 4 | 锁定节点 | 无手柄 |
| 5 | 右下角放大 | 尺寸随拖拽更新 |
| 6 | 拖到最小限制 | 停在 280×120 |
| 7 | 拖到最大限制 | 停在 2000×1500 |
| 8 | resize 后内容 reflow | 文字正确重排 |
| 9 | resize 后 Handle 位置 | 连接点在边缘 |
| 10 | copyNode 保留尺寸 | width/height == 原节点 |
| 11 | 撤销 resize | 恢复到调整前 |
| 12 | 重做 resize | 恢复到调整后 |
| 13 | 后端加载保留尺寸 | 刷新后尺寸一致 |
