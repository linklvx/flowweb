# Canvas 键盘快捷键面板 — 设计规格

## 概述

在 Canvas 页面左侧 NodePalette 侧边栏底部增加 ⌨️ 快捷键入口按钮，点击后在 Canvas 页面底部居中弹出快捷键参考面板。

## 功能描述

### 入口按钮
- 位置：NodePalette 侧边栏底部，节点类型列表下方
- 样式：与现有节点类型条目一致（`bg-[#252525]`，圆角 8px，`border`），使用 `#09CAF5` 青色边框
- 内容：⌨️ emoji + "快捷键" 文字
- 行为：点击切换面板显示/隐藏（toggle）

### 快捷键面板
- 位置：Canvas 页面底部居中（`fixed bottom-6 left-1/2 -translate-x-1/2`）
- 层级：`z-50`（高于画布内容，与 TopBar 同级）
- 样式：
  - 背景：`rgba(38,38,38,0.96)` + `backdrop-blur-xl`
  - 边框：`0.5px solid #363636`，圆角 `16px`
  - 内边距：`p-5`（20px）
  - 阴影：`box-shadow: 0px 4px 20px rgba(0,0,0,0.4)`
- 布局：4 列水平排列（创作 / 缩放 / 移动画布 / 其他），列间分割线
- 关闭：右上角 ✕ 按钮 + 点击面板外部关闭
- 打开动画：从底部滑入（`translateY(10px) → translateY(0)` + `opacity 0 → 1`，过渡 200ms）
- 关闭动画：向底部滑出（`translateY(0) → translateY(10px)` + `opacity 1 → 0`，过渡 200ms）
  - 实现方式：使用 CSS `transition` + 动态 class（`is-open` / `is-closing`），而非条件渲染直接卸载
  - 关闭动画播放完毕后（`transitionend` 事件）再从 DOM 移除/hide

### 快捷键列表（4 列）

**创作：**
| 操作 | 快捷键 |
|------|--------|
| 成组 | Ctrl + G |
| 合并分镜组 | Ctrl + Alt + G |
| 解组 | Ctrl + Shift + G |
| 连线 | Ctrl + L |
| 复制整组 | Ctrl + Shift + C |
| 生成 | Ctrl + Enter |
| 新建节点 | Tab |
| 节点复制 | Alt + 拖动节点 |
| 创建副本 | Ctrl + Alt + 拖动 |

**缩放：**
| 操作 | 快捷键 |
|------|--------|
| 放大 | Ctrl + ➕ |
| 缩小 | Ctrl + ➖ |
| 适应画布 | Ctrl + 0 |
| 触控板缩放 | 双指捏合 |
| 鼠标缩放 | Ctrl + 滚轮 |

**移动画布：**
| 操作 | 快捷键 |
|------|--------|
| 键盘平移 | Space + 拖动 |
| 触控板平移 | 双指拖动 |
| 鼠标平移 | 中键拖动 |
| 整理画布 | Alt + Shift + F |

**其他：**
| 操作 | 快捷键 |
|------|--------|
| 撤销 | Ctrl + Z |
| 重做 | Ctrl + Shift + Z |
| 删除 | Backspace / Delete |

### 键帽样式
- 单个键帽：`bg-[#2a2a2a] border-[0.5px] border-[#444] rounded-md px-1.5 py-0.5 text-sm`
- 分隔符 `+`：`text-[#888]`

## 组件结构

```
CanvasPage (page.tsx)
├── NodePalette (修改：底部增加快捷键按钮 + toggle 状态提升)
├── KeyboardShortcutsPanel (新增：底部居中浮动面板)
│   ├── 关键帽 (Kbd) 子组件
│   └── 4 列快捷键分组
```

## 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/pages/canvas/components/NodePalette.tsx` | 修改 | 底部增加 ⌨️ 快捷键按钮 |
| `src/pages/canvas/components/KeyboardShortcutsPanel.tsx` | 新增 | 底部居中浮动面板组件 |
| `src/pages/canvas/page.tsx` | 修改 | 引入面板，管理 open/close 状态 |

## 状态管理

- `isShortcutsOpen` 状态放在 `page.tsx`（`CanvasPageInner`），通过 props 传递给 NodePalette 和 KeyboardShortcutsPanel
- NodePalette 接收 `onToggleShortcuts` callback
- KeyboardShortcutsPanel 接收 `isOpen` + `onClose` props
- 面板外部点击通过 `useEffect` + `mousedown` 事件处理

## 边界情况
- 面板打开时，不影响画布交互（节点拖拽、连线等正常使用）
- 面板打开状态下点击画布 → 关闭面板
- 面板不响应画布 zoom/pan（使用 `nodrag nopan` 或独立于 ReactFlow 渲染）

## 测试用例
1. NodePalette 底部渲染 ⌨️ 快捷键按钮
2. 点击按钮 → 面板显示，再次点击 → 面板隐藏
3. 面板打开时点击关闭按钮 → 面板隐藏
4. 面板打开时点击面板外部区域 → 面板隐藏
5. 面板渲染 4 列完整的快捷键列表
6. 面板包含所有 22 个快捷键条目
