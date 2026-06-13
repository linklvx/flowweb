# Spec/Plan: 快捷键 — Tab / Ctrl+0 / Alt+Shift+F

**日期:** 2026-06-07 | **TDD 三步流程**

---

## Spec

| 快捷键 | 功能 | 条件 | 预期行为 |
|--------|------|------|----------|
| `Tab` | 新建节点 | canvas 页面可见、焦点不在 input/textarea | 打开 AddNodeMenu |
| `Ctrl+0` | 适应画布 | 同上 | `fitView({ duration: 300, padding: 0.2 })` |
| `Alt+Shift+F` | 整理画布 | 同上 | 同 fitView |

## 实现策略

**键位处理放在 `CanvasPageInner`**（page.tsx），因为需要同时访问 `useReactFlow()`（fitView）和 `useMenuOpen`（open menu）。

### 架构变更

```
现状:  useMenuOpen 在 NodePalette 内部
改为:  useMenuOpen 提升到 CanvasPageInner，通过 props 传给 NodePalette + AddNodeMenu
```

### 涉及文件

| 文件 | 变更 |
|------|------|
| `page.tsx` | 提升 useMenuOpen、添加 keydown handler、使用 useReactFlow |
| `NodePalette.tsx` | 改为接收 props（isOpen/toggle/open/close） |
| `page.test.tsx` | 新增测试（Tab/Ctrl+0/Alt+Shift+F） |
| `KeyboardShortcutsPanel.tsx` | 无需变更（仅展示） |

### 测试用例

1. Tab → 打开 AddNodeMenu
2. Ctrl+0 → 调用 fitView
3. Alt+Shift+F → 调用 fitView
4. 焦点在 input 时 Tab/Ctrl+0/Alt+Shift+F 不触发（由浏览器处理）
5. 现有其他键盘行为不受影响
