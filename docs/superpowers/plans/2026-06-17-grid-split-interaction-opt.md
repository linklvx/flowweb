<!-- doc-status: historical | verified_at: n/a -->
# 宫格切分自定义选择器交互优化 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化 ImageNodeToolbar 宫格切分 SubGridPanel 交互——去掉默认选择、点击格子即确认切分、移除确认按钮

**Architecture:** 单文件改动 `ImageNodeToolbar.tsx`，简化 `SubGridPanel` props，移除两步选择状态，点击格子直接提交

**Tech Stack:** React 18, TypeScript strict, Ant Design 5.22.5, Vitest + React Testing Library

---

### Task 1: 更新 SubGridPanel 测试用例

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx`

- [ ] **Step 1: 添加 SubGridPanel 新交互的测试**

在 `ImageNodeToolbar.test.tsx` 中已有测试基础上，添加针对 SubGridPanel 优化后行为的测试：

```typescript
describe('SubGridPanel', () => {
  it('should have no default grid selection on mount', () => {
    // 打开自定义子面板后，preview 显示 -- × --
  });

  it('should trigger onCommit when clicking a valid grid cell', () => {
    // 点击 2×2 位置的格子 → onCommit(2, 2) 被调用
  });

  it('should not trigger onCommit when clicking disabled cell (row=1 or col=1)', () => {
    // 点击第1行或第1列的格子 → onCommit 不被调用
  });

  it('should reset preview on mouse leave from grid', () => {
    // 鼠标移出网格 → previewRows/previewCols 重置为 0
  });

  it('should not trigger onHover on disabled cells (row=1 or col=1)', () => {
    // 鼠标经过禁用格 → onHover 不被调用
  });

  it('should not show confirm button', () => {
    // 确认切分按钮不存在
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx --no-coverage
```

预期：新测试 FAIL（因为功能尚未实现）

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx
git commit -m "test: add failing tests for SubGridPanel interaction optimization

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: 实现 SubGridPanel 交互优化

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.tsx:204-355`

- [ ] **Step 1: 更新 SubGridPanelProps 接口**

修改 `ImageNodeToolbar.tsx` 第 204-212 行：

```typescript
interface SubGridPanelProps {
  previewRows: number;
  previewCols: number;
  onHover: (r: number, c: number) => void;
  onMouseLeave: () => void;
  onCommit: (r: number, c: number) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}
```

- [ ] **Step 2: 重写 SubGridPanel 组件**

替换第 214-309 行的 `SubGridPanel` 函数体。核心改动：
- 移除 `selectedRows`, `selectedCols`, `onSelect`, `onConfirm` prop
- 新增 `onMouseLeave`, `onCommit`, `containerRef` prop
- DOM 定位改用 `containerRef.current?.closest('.ant-dropdown')` 替代全局 `document.querySelector`
- 网格容器添加 `onMouseLeave` → 调 `onMouseLeave()`
- 有效格 `onClick` → 调 `onCommit(row, col)`
- 顶部显示 `-- × --` 替代 `0 × 0`（无预览时）
- 移除底部"确认切分"按钮

```typescript
function SubGridPanel({
  previewRows,
  previewCols,
  onHover,
  onMouseLeave,
  onCommit,
  containerRef,
}: SubGridPanelProps) {
  const [flipLeft, setFlipLeft] = useState(false);

  useEffect(() => {
    const el = containerRef.current?.closest('.ant-dropdown') as HTMLElement | null;
    if (el) {
      const rect = el.getBoundingClientRect();
      setFlipLeft(rect.right + 220 > window.innerWidth);
    }
  }, [containerRef]);

  return (
    <div
      ref={containerRef}
      className="absolute"
      style={{
        left: flipLeft ? 'auto' : '100%',
        right: flipLeft ? '100%' : 'auto',
        marginLeft: flipLeft ? 0 : 6,
        marginRight: flipLeft ? 6 : 0,
        top: 0,
      }}
    >
      <div
        className="p-1.5 font-sans"
        style={{
          borderRadius: '12px',
          border: '0.5px solid #363636',
          background: 'rgba(31,31,31,0.92)',
          boxShadow: '0 4px 10px rgba(0,0,0,0.2)',
          backdropFilter: 'blur(16px)',
        }}
      >
        <div className="flex flex-col gap-2.5 p-2">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[13px]" style={{ color: 'rgb(168,168,168)' }}>自定义宫格</span>
            <span className="text-[13px] font-medium" style={{ color: 'rgb(247,247,247)' }}>
              {previewRows > 0 && previewCols > 0 ? `${previewRows} × ${previewCols}` : '-- × --'}
            </span>
          </div>

          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}
            onMouseLeave={onMouseLeave}
          >
            {Array.from({ length: 5 }, (_, r) =>
              Array.from({ length: 5 }, (_, c) => {
                const row = r + 1;
                const col = c + 1;
                const isPreview = row <= previewRows && col <= previewCols;
                const isDisabled = row === 1 || col === 1;
                return (
                  <button
                    key={`${row}-${col}`}
                    type="button"
                    disabled={isDisabled}
                    className="h-8 w-8 rounded border transition-colors duration-75"
                    style={{
                      borderColor: isPreview ? 'rgba(96,165,250,0.6)' : 'rgb(82,82,82)',
                      backgroundColor: isPreview ? 'rgba(59,130,246,0.4)' : 'rgba(64,64,64,0.5)',
                      opacity: isDisabled ? 0.3 : 1,
                      cursor: isDisabled ? 'not-allowed' : 'pointer',
                    }}
                    onMouseEnter={() => { if (!isDisabled) onHover(row, col); }}
                    onClick={() => { if (!isDisabled) onCommit(row, col); }}
                  />
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 添加 containerRef 并更新父组件状态**

添加 `subPanelRef`，同时修改状态声明：

```typescript
// Grid split dropdown state
const [gridSplitOpen, setGridSplitOpen] = useState(false);
const [subMenuOpen, setSubMenuOpen] = useState(false);
const [previewRows, setPreviewRows] = useState(0);
const [previewCols, setPreviewCols] = useState(0);
const subCloseTimerRef = useRef<number>(0);
const subPanelRef = useRef<HTMLDivElement | null>(null);
```

移除两行：
- `const [selectedRows, setSelectedRows] = useState(2);`
- `const [selectedCols, setSelectedCols] = useState(2);`

- [ ] **Step 4: 添加 onCommit 回调函数**

在状态声明之后（约第 355 行之后），添加：

```typescript
const handleGridCommit = useCallback((rows: number, cols: number) => {
  onGridSplit?.(rows, cols);
  setGridSplitOpen(false);
  setSubMenuOpen(false);
}, [onGridSplit]);
```

- [ ] **Step 5: 更新 SubGridPanel 调用**

修改 `dropdownRender` 中 `SubGridPanel` 的使用（约第 543-556 行），替换为：

```typescript
{subMenuOpen && (
  <SubGridPanel
    previewRows={previewRows}
    previewCols={previewCols}
    onHover={(r, c) => { setPreviewRows(r); setPreviewCols(c); }}
    onMouseLeave={() => { setPreviewRows(0); setPreviewCols(0); }}
    onCommit={handleGridCommit}
    containerRef={subPanelRef}
  />
)}
```

- [ ] **Step 6: 确保 useCallback 已导入**

检查文件顶部第 1 行是否包含 `useCallback`：

```typescript
import { memo, useState, useEffect, useMemo, useRef, useCallback, type ReactNode, forwardRef } from 'react';
```

已有 `useCallback`，无需改动。

- [ ] **Step 7: 运行测试确认通过**

```bash
npx vitest run src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx --no-coverage
```

预期：所有测试 PASS

- [ ] **Step 8: TypeScript 类型检查**

```bash
npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | grep -i "ImageNodeToolbar"
```

预期：无新增类型错误

- [ ] **Step 9: 提交**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.tsx
git commit -m "feat: optimize grid split SubGridPanel — click-to-commit, remove confirm button

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: 浏览器验证

- [ ] **Step 1: 启动/确认 dev server 运行中**

```bash
# web 服务已运行在 port 5173
```

- [ ] **Step 2: 浏览器中验证交互**

手动验证以下场景：
1. 打开宫格切分下拉 → 自定义 → 面板无默认高亮（预览显示 `-- × --`）
2. 鼠标在网格上移动 → 高亮区域跟随变化，顶部显示对应数值
3. 鼠标移出网格 → 高亮消失（复位为 `-- × --`）
4. 鼠标经过第1行/第1列 → 无预览闪烁
5. 点击第1行/第1列格子 → 无反应
6. 点击 2×2 位置 → 触发切分，下拉关闭
7. 预设选项（2×2, 3×3, 4×4, 5×5）仍正常运作
8. 按钮在切分中显示 loading 态（splitting 状态）

- [ ] **Step 3: 截图留证**

成功后截图保存。
