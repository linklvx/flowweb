<!-- doc-status: historical | verified_at: n/a -->
# Edit Toolbar UX Improvements

## Summary

优化擦除编辑模式下的工具栏体验：降低上方工具栏高度、移除退出确认对话框、为按钮添加 tooltip 提示、底部工具栏抗缩放。

## 1. 上方工具栏高度调低

**目标**: 减少 `PaintToolbar` 视觉高度，降低遮挡

**改动点**: `EditToolbar.tsx` → `PaintToolbar` 组件

| 项目 | 当前 | 新值 |
|------|------|------|
| 容器内边距 | `p-2` (8px) | `p-1.5` (6px) |
| 按钮高度 | `h-8` (32px) | `h-7` (28px) |
| 分隔线高度 | 24px | 20px |
| 工具按钮尺寸 | `h-8 w-8` (32x32) | `h-7 w-7` (28x28) |
| 整体高度 | ~48px | ~40px |

**影响范围**: 仅 `PaintToolbar` 子组件（擦除、重绘模式）

## 2. 退出按钮直接退出编辑模式

**目标**: 所有编辑模式下点击退出按钮直接退出，不弹确认对话框

**改动点**: `ImageGenNode.tsx` → `handleEditCancel` 函数

移除 `hasEditChanges()` 检查逻辑和 `useConfirmModalStore` 调用。对于所有编辑模式（crop / outpaint / erase / redraw），点击退出按钮直接执行：

```typescript
updateConfig(id, { editMode: null });
useNodeStore.getState().setActiveEditNodeId(null);
```

不影响 `handleCancel`（点击 canvas 空白区域、ESC 键），该路径保持现有逻辑不变。

## 3. 按钮悬停向下弹出圆角提示框

**目标**: 为 `PaintToolbar` 的 6 个按钮添加 tooltip

**改动点**: `EditToolbar.tsx` → `PaintToolbar` 组件

从左到右的 tooltip 文字：
- 关闭并退出
- 画笔
- 矩形
- 橡皮擦
- 撤销
- 重做

实现方式：纯 CSS tooltip，每个按钮包裹在 position:relative 容器中，hover 时显示绝对定位的向下弹出层。

规格：
- 背景色: `rgb(64, 64, 64)`
- 文字色: `rgb(247, 247, 247)`
- 字号: 12px
- 圆角: 6px
- 定位: 按钮下方 `top: 100%` + `margin-top: 4px`，居中
- 小三角箭头朝上指向按钮

## 4. 底部工具栏不随画布缩放改变大小

**目标**: `EraseBottomToolbar` 在画布缩放时保持固定视觉大小

**改动点**: `ImageGenNode.tsx` → 底部工具栏渲染处（line 882-886）

当前底部工具栏在节点 DOM 内部，受 ReactFlow CSS `scale(zoom)` 影响。对工具栏 wrapper 应用反向缩放：

```tsx
{editMode === 'erase' && (
  <div
    className="absolute top-full left-1/2 z-50 pt-4"
    style={{ transform: `translateX(-50%) scale(${1/zoom})`, transformOrigin: 'top center' }}
  >
    <EraseBottomToolbar ... />
  </div>
)}
```

`zoom` 可从已有的 `useViewport()` 获取。

## Self-review

- 无 placeholder、TODOs
- 4 项改动相互独立，无冲突
- 仅涉及 2 个文件：`EditToolbar.tsx`、`ImageGenNode.tsx`
- 所有修改为表层 UI 调整，不涉及数据流或状态逻辑变更
