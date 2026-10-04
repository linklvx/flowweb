<!-- doc-status: historical | verified_at: n/a -->
# 宫格切分自定义选择器交互优化

## 问题

ImageNodeToolbar 的宫格切分下拉菜单中，"自定义宫格"子面板存在交互缺陷：

1. 打开面板时默认选中 2×2，用户未必需要
2. 选中格子后需要移动鼠标到"确认切分"按钮，但鼠标移动过程会触发 hover 改变选中区域，导致确认按钮形同虚设

## 改动

仅涉及 `ImageNodeToolbar.tsx` 中的 `SubGridPanel` 组件及其父级状态管理。

### 1. 去掉默认选择

- `previewRows`/`previewCols` 初始值从 `2` 改为 `0`
- 打开子面板时无高亮格子

### 2. 点击格子即确认切分

- 移除 `selectedRows`/`selectedCols` 状态（不再需要两步选择）
- `SubGridPanel` 的 `onClick` 直接触发 `onCommit(row, col)`
- 父级 `onCommit` 调用 `onGridSplit(row, col)` 并关闭下拉菜单

### 3. 移除"确认切分"按钮

- 删除 `SubGridPanel` 底部的确认按钮

### 4. 网格移出复位

- 给 5×5 网格容器添加 `onMouseLeave`，鼠标移出时重置 `previewRows`/`previewCols` 为 `0`
- 保持面板初始态与移出态一致，避免高亮残留

### 5. 禁用格交互隔离

- 第 1 行、第 1 列的禁用单元格：`onMouseEnter` 不触发预览更新，`onClick` 无任何响应
- 避免鼠标经过禁用格时出现预览闪烁（当前实现已有 `isDisabled` 判断，需确认覆盖完整）

### 6. 提交即时闭环

- 点击有效格子后，同步执行三件事：
  1. 触发切分 `onGridSplit(row, col)`
  2. 关闭整个下拉菜单（`setGridSplitOpen(false)` + `setSubMenuOpen(false)`）
  3. 按钮进入 loading 态（`splitting` prop 已由 store 的 `splittingNodeId !== null` 控制，无需额外处理）

### Props 简化

```
SubGridPanel
  保留: previewRows, previewCols, onHover
  新增: onCommit (替代 onSelect + onConfirm)
  移除: selectedRows, selectedCols, onSelect, onConfirm
```

## 影响范围

- `ImageNodeToolbar.tsx` 单文件
- 预设宫格选项（2×2, 3×3, 4×4, 5×5）不受影响
- `SubGridPanel` 的 hover 预览行为不变
- 1×N 和 N×1 的格子仍然 disabled（不可切分单行/单列）
- `splitting` loading 态由 store 的 `splittingNodeId` 控制，提交闭环无需新增状态

### 7. 边界检测 DOM 定位健壮性

- `SubGridPanel` 的左右翻转逻辑改用 `containerRef.current?.closest('.ant-dropdown')` 向上查找最近的 `.ant-dropdown`
- 替代当前 `document.querySelector('.ant-dropdown')` 全局查询，避免多 Dropdown 实例或 DOM 类名变更时定位错误

### 8. 0×0 显示占位符

- 当 `previewRows` 或 `previewCols` 为 `0` 时，顶部显示 `-- × --` 替代 `0 × 0`
- 语义更友好，明确表示"未选择"而非"选择 0 宫格"
