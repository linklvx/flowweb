<!-- doc-status: historical | verified_at: n/a -->
# Edit Toolbar UX Improvements 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化擦除编辑模式工具栏体验——降低高度、退出直接退出、添加 tooltip、底部工具栏抗缩放

**Architecture:** 4 项独立 UI 改动，仅涉及 `EditToolbar.tsx` 和 `ImageGenNode.tsx`。全部为表层渲染调整，不改数据流。

**Tech Stack:** React 18, TypeScript strict, Tailwind CSS, vitest + @testing-library/react

---

### Task 1: PaintToolbar 高度调低

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/EditToolbar.tsx` (PaintToolbar sub-component, lines 107-244)
- Test: `apps/web/src/pages/canvas/components/nodes/EditToolbar.test.tsx`

- [ ] **Step 1: Write tests for reduced toolbar dimensions**

In `EditToolbar.test.tsx`, add after existing erase mode tests:

```tsx
describe('PaintToolbar dimensions', () => {
  it('uses h-7 and w-7 for tool buttons instead of h-8 w-8', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} editMode="erase" />);
    const brushBtn = screen.getByLabelText('画笔工具');
    expect(brushBtn.className).toContain('h-7');
    expect(brushBtn.className).toContain('w-7');
    expect(brushBtn.className).not.toContain('h-8');
    expect(brushBtn.className).not.toContain('w-8');
  });

  it('uses h-7 for exit button instead of h-8', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} editMode="erase" />);
    const exitBtn = screen.getByText('退出').closest('button')!;
    expect(exitBtn.className).toContain('h-7');
    expect(exitBtn.className).not.toContain('h-8');
  });

  it('uses p-1.5 container padding instead of p-2', () => {
    setupPortalTarget();
    const { container } = render(<EditToolbar {...baseProps} editMode="erase" />);
    // PaintToolbar outermost div: flex w-fit items-center gap-2 rounded-xl p-1.5
    const portalRoot = document.getElementById('node-toolbar-portal')!;
    const paintBar = portalRoot.querySelector('.rounded-xl') as HTMLElement;
    expect(paintBar.className).toContain('p-1.5');
    expect(paintBar.className).not.toContain('p-2');
  });

  it('uses 20px divider height instead of 24px', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} editMode="erase" />);
    const portalRoot = document.getElementById('node-toolbar-portal')!;
    const dividers = portalRoot.querySelectorAll('[style*="height"]');
    const divider = Array.from(dividers).find((d) => (d as HTMLElement).style.height === '20px') as HTMLElement | undefined;
    expect(divider).toBeTruthy();
  });

  it('uses 14px icon size via h-3.5 w-3.5', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} editMode="erase" />);
    const brushBtn = screen.getByLabelText('画笔工具');
    const svg = brushBtn.querySelector('svg')!;
    expect(svg.className).toContain('h-3.5');
    expect(svg.className).toContain('w-3.5');
  });
});
```

- [ ] **Step 2: Run tests — expect 5 failures**

Run: `cd D:/flowweb/apps/web && npx vitest run src/pages/canvas/components/nodes/EditToolbar.test.tsx --reporter=verbose 2>&1`

Expected: 5 new tests FAIL.

- [ ] **Step 3: Implement reduced dimensions in PaintToolbar**

In `EditToolbar.tsx`, make these changes in the `PaintToolbar` function:

**Container padding** (line 133): `p-2` → `p-1.5`

```tsx
<div
  className="flex w-fit items-center gap-2 rounded-xl p-1.5"
```

**Exit button height** (line 144): `h-8` → `h-7`, `py-2` → `py-1.5`

```tsx
<button
  type="button"
  className="inline-flex select-none items-center justify-center rounded-lg transition-colors h-7 gap-1 px-3 py-1.5 hover:bg-[rgba(255,255,255,0.08)] active:bg-[rgba(255,255,255,0.1)] cursor-pointer border-0"
```

**toolBtnClass** (line 120-121): `h-8 w-8 min-w-8` → `h-7 w-7 min-w-7`

```tsx
const toolBtnClass =
  'inline-flex select-none items-center justify-center rounded-lg transition-colors h-7 w-7 min-w-7 gap-0 p-2 hover:bg-[rgba(255,255,255,0.08)] active:bg-[rgba(255,255,255,0.1)] cursor-pointer border-0';
```

**Divider height** (line 153): `24` → `20`

```tsx
<div style={{ backgroundColor: BAR_BORDER, width: 1, height: 20 }} className="shrink-0" />
```

Three dividers at lines 153, 187, 220 — change all `height: 24` to `height: 20`.

**Slider container** (line 190): `h-8` → `h-7`, `py-2` → `py-1.5`

```tsx
<div className="inline-flex h-7 items-center justify-center rounded-lg border-0 bg-transparent gap-1 px-3 py-1.5" style={{ color: 'rgb(163, 163, 163)' }}>
```

**All SVG icons** in the file (BrushIcon, RectSelectIcon, LassoIcon, EraserIcon, BrushSizeIcon, UndoIcon, RedoIcon, ArrowLeftIcon at lines 34, 41, 47, 53, 59, 66, 72, 78):
Change `className="h-4 w-4 ..."` to `className="h-3.5 w-3.5 ..."` for the tool icons. Also change SVG `width`/`height` from 16 to 14.

For ArrowLeftIcon (line 34): `width="16" height="16"` → `width="14" height="14"`
For BrushIcon (line 41): `width="16" height="16"` → `width="14" height="14"`
For RectSelectIcon (line 47): `width="16" height="16"` → `width="14" height="14"`
For LassoIcon (line 53): `width="16" height="16"` → `width="14" height="14"`
For EraserIcon (line 59): `width="16" height="16"` → `width="14" height="14"`
For BrushSizeIcon (line 66): `width="16" height="16"` → `width="14" height="14"`
For UndoIcon (line 72): `width="15" height="14"` → `width="13" height="12"`
For RedoIcon (line 78): `width="15" height="14"` → `width="13" height="12"`

- [ ] **Step 4: Run tests — expect all pass**

Run: `cd D:/flowweb/apps/web && npx vitest run src/pages/canvas/components/nodes/EditToolbar.test.tsx --reporter=verbose 2>&1`

Expected: All tests PASS (existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/EditToolbar.tsx apps/web/src/pages/canvas/components/nodes/EditToolbar.test.tsx
git commit -m "feat: reduce PaintToolbar height from 48px to ~40px

- Container padding: p-2 → p-1.5
- Button height: h-8 → h-7, tool buttons 32px → 28px
- Divider height: 24px → 20px
- Icon size: 16px → 14px (SVG and Tailwind classes)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: 退出按钮直接退出编辑模式

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx` (handleEditCancel function, lines 353-393)

- [ ] **Step 1: Write test verifying exit button calls onCancel without confirm modal**

In `EditToolbar.test.tsx`, add:

```tsx
it('calls onCancel when exit button is clicked in erase mode', () => {
  setupPortalTarget();
  const onCancel = vi.fn();
  render(<EditToolbar {...baseProps} editMode="erase" onCancel={onCancel} />);
  fireEvent.click(screen.getByText('退出'));
  expect(onCancel).toHaveBeenCalledTimes(1);
});
```

Note: The existing test "calls onCancel when '退出' button is clicked" is for crop mode. This one verifies erase mode too.

- [ ] **Step 2: Run test — verify pass (already works)**

Run: `cd D:/flowweb/apps/web && npx vitest run src/pages/canvas/components/nodes/EditToolbar.test.tsx --reporter=verbose 2>&1`

This test should pass already — the exit button already calls onCancel. The change is in ImageGenNode's handleEditCancel, not in EditToolbar.

- [ ] **Step 3: Implement direct exit in handleEditCancel**

In `ImageGenNode.tsx`, replace the `handleEditCancel` function (lines 353-393):

Before:
```typescript
const handleEditCancel = useCallback(() => {
  setEditError(null);
  if (isProcessing) return;

  let hasChanges = false;
  if (editMode === 'outpaint') {
    hasChanges =
      Math.abs(outpaintRect.x + baseWidth * 0.1) >= 1 ||
      Math.abs(outpaintRect.y + baseHeight * 0.1) >= 1 ||
      Math.abs(outpaintRect.width - baseWidth * 1.2) >= 1 ||
      Math.abs(outpaintRect.height - baseHeight * 1.2) >= 1;
  } else {
    const editState = {
      cropRect: cropRectRef.current,
      outpaintRect,
      maskPaths: eraseRef.current?.hasContent() ? [{ points: [] }] : [],
    };
    hasChanges = hasEditChanges(editMode!, editState);
  }

  if (!hasChanges || editMode === 'outpaint') {
    updateConfig(id, { editMode: null });
    useNodeStore.getState().setActiveEditNodeId(null);
    return;
  }

  useConfirmModalStore.getState().show({
    title: '放弃未保存的编辑？',
    content: '当前编辑尚未保存，请选择如何处理。',
    cancelText: '取消',
    primaryText: '放弃并退出',
    primaryType: 'danger',
    onClose: () => useConfirmModalStore.getState().close(),
    onPrimary: () => {
      updateConfig(id, { editMode: null });
      useNodeStore.getState().setActiveEditNodeId(null);
      eraseRef.current?.clear();
      useConfirmModalStore.getState().close();
    },
  });
}, [id, editMode, isProcessing, outpaintRect, baseWidth, baseHeight, updateConfig]);
```

After:
```typescript
const handleEditCancel = useCallback(() => {
  setEditError(null);
  if (isProcessing) return;
  updateConfig(id, { editMode: null });
  useNodeStore.getState().setActiveEditNodeId(null);
}, [id, isProcessing, updateConfig]);
```

- [ ] **Step 4: Remove unused `hasEditChanges` import**

In `ImageGenNode.tsx` line 5, change:
```typescript
import { useNodeStore, hasEditChanges } from '@/stores/nodeStore';
```
to:
```typescript
import { useNodeStore } from '@/stores/nodeStore';
```

- [ ] **Step 5: Remove unused `useConfirmModalStore` import (only if not used elsewhere)**

Check: `hasEditChanges` is only in handleEditCancel. `useConfirmModalStore` is still used in `handleCancel` (line 278) and `handleRotateMirror` (line 313). Keep it.

- [ ] **Step 6: Run existing tests to verify no regressions**

Run: `cd D:/flowweb/apps/web && npx vitest run src/pages/canvas/components/nodes/EditToolbar.test.tsx src/pages/canvas/components/nodes/EraseCanvas.test.tsx --reporter=verbose 2>&1`

Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx
git commit -m "feat: exit edit mode directly from toolbar without confirmation dialog

Remove hasEditChanges check and confirm modal from handleEditCancel.
All edit modes (crop/outpaint/erase/redraw) now exit immediately
when clicking the toolbar exit button.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: 按钮悬停下拉圆角提示框

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/EditToolbar.tsx` (PaintToolbar sub-component)
- Test: `apps/web/src/pages/canvas/components/nodes/EditToolbar.test.tsx`

- [ ] **Step 1: Write tests for tooltip presence**

In `EditToolbar.test.tsx`, add:

```tsx
describe('PaintToolbar tooltips', () => {
  const tooltipLabels = ['关闭并退出', '画笔', '矩形', '橡皮擦', '撤销', '重做'];

  it('renders a tooltip wrapper for each tool button', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} editMode="erase" />);
    const portalRoot = document.getElementById('node-toolbar-portal')!;
    const tooltips = portalRoot.querySelectorAll('[data-tooltip]');
    expect(tooltips.length).toBeGreaterThanOrEqual(6);
  });

  it('each tooltip has correct label text', () => {
    setupPortalTarget();
    render(<EditToolbar {...baseProps} editMode="erase" />);
    const portalRoot = document.getElementById('node-toolbar-portal')!;
    for (const label of tooltipLabels) {
      const el = portalRoot.querySelector(`[data-tooltip="${label}"]`);
      expect(el).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run tests — expect 2 failures**

Run: `cd D:/flowweb/apps/web && npx vitest run src/pages/canvas/components/nodes/EditToolbar.test.tsx --reporter=verbose 2>&1`

Expected: 2 new tests FAIL.

- [ ] **Step 3: Add tooltip CSS to PaintToolbar and wrap buttons**

In `EditToolbar.tsx`, add a `<style>` block inside PaintToolbar's return (similar to how the main component uses `<style>{...}</style>` at line 339):

Add this right before the PaintToolbar's return `<div>`:

```tsx
<style>{`
  .paint-tooltip-wrap {
    position: relative;
  }
  .paint-tooltip-wrap::after {
    content: attr(data-tooltip);
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-top: 4px;
    padding: 4px 8px;
    background: rgb(64, 64, 64);
    color: rgb(247, 247, 247);
    font-size: 12px;
    line-height: 1.4;
    border-radius: 6px;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    transition: opacity 100ms ease 150ms, visibility 100ms ease 150ms;
    z-index: 10001;
  }
  .paint-tooltip-wrap::before {
    content: '';
    position: absolute;
    top: calc(100% - 2px);
    left: 50%;
    transform: translateX(-50%);
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-bottom: 5px solid rgb(64, 64, 64);
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    transition: opacity 100ms ease 150ms, visibility 100ms ease 150ms;
    z-index: 10001;
  }
  .paint-tooltip-wrap:hover::after,
  .paint-tooltip-wrap:hover::before {
    opacity: 1;
    visibility: visible;
  }
  .paint-tooltip-wrap:first-child::after {
    left: 0;
    transform: translateX(0);
  }
  .paint-tooltip-wrap:first-child::before {
    left: 16px;
  }
  .paint-tooltip-wrap:last-child::after {
    left: auto;
    right: 0;
    transform: translateX(0);
  }
  .paint-tooltip-wrap:last-child::before {
    left: auto;
    right: 8px;
  }
`}</style>
```

Then wrap each of the 6 buttons in PaintToolbar with `<span className="paint-tooltip-wrap" data-tooltip="...">`:

1. Exit button (line 142): wrap with `data-tooltip="关闭并退出"`
2. Brush button (line 156): wrap with `data-tooltip="画笔"`
3. Rect button (line 166): wrap with `data-tooltip="矩形"`
4. Eraser button (line 176): wrap with `data-tooltip="橡皮擦"`
5. Undo button (line 223): wrap with `data-tooltip="撤销"`
6. Redo button (line 233): wrap with `data-tooltip="重做"`

For the undo/redo buttons, use `:nth-last-child(2)` and `:last-child` selectors respectively (redoing is last child in the flex container).

- [ ] **Step 4: Run tests — expect all pass**

Run: `cd D:/flowweb/apps/web && npx vitest run src/pages/canvas/components/nodes/EditToolbar.test.tsx --reporter=verbose 2>&1`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/EditToolbar.tsx apps/web/src/pages/canvas/components/nodes/EditToolbar.test.tsx
git commit -m "feat: add downward tooltip popups for PaintToolbar buttons

Six tooltip labels: 关闭并退出, 画笔, 矩形, 橡皮擦, 撤销, 重做.
Pure CSS implementation with 150ms show delay and arrow indicator.
First/last tooltips edge-aligned to prevent viewport overflow.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: 底部工具栏不随画布缩放改变大小

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx` (lines 882-886)

- [ ] **Step 1: Apply inverse scale transform to EraseBottomToolbar wrapper**

In `ImageGenNode.tsx` at line 64, `zoom` is already destructured from `useViewport()`:
```typescript
const { zoom, x: vpX, y: vpY } = useViewport();
```

Change the EraseBottomToolbar rendering (lines 882-886):

Before:
```tsx
{editMode === 'erase' && (
  <div className="absolute top-full left-1/2 -translate-x-1/2 z-50 pt-4">
    <EraseBottomToolbar nodeId={id} onGenerate={handleGenerate} isProcessing={isProcessing} />
  </div>
)}
```

After:
```tsx
{editMode === 'erase' && (
  <div
    className="absolute top-full left-1/2 z-50 pt-4"
    style={{
      transform: `translateX(-50%) scale(${1 / zoom})`,
      transformOrigin: 'top center',
      willChange: 'transform',
    }}
  >
    <EraseBottomToolbar nodeId={id} onGenerate={handleGenerate} isProcessing={isProcessing} />
  </div>
)}
```

Note: Remove `-translate-x-1/2` from className because inline `transform` overrides Tailwind transforms entirely. Include `translateX(-50%)` in the inline style instead.

- [ ] **Step 2: Run existing tests to verify no regressions**

Run: `cd D:/flowweb/apps/web && npx vitest run src/pages/canvas/components/nodes/EraseBottomToolbar.test.tsx src/pages/canvas/components/nodes/EditToolbar.test.tsx --reporter=verbose 2>&1`

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx
git commit -m "fix: keep EraseBottomToolbar visual size constant during canvas zoom

Apply inverse scale(1/zoom) to counter ReactFlow's CSS transform.
Use inline style with translateX(-50%) + scale for correct positioning.
Add will-change: transform for GPU-accelerated rendering.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: 集成验证

- [ ] **Step 1: Run full test suite for affected components**

```bash
cd D:/flowweb/apps/web && npx vitest run src/pages/canvas/components/nodes/EditToolbar.test.tsx src/pages/canvas/components/nodes/EraseCanvas.test.tsx src/pages/canvas/components/nodes/EraseBottomToolbar.test.tsx --reporter=verbose 2>&1
```

Expected: ALL tests PASS.

- [ ] **Step 2: Type-check**

```bash
cd D:/flowweb/apps/web && npx tsc --noEmit 2>&1
```

Expected: No new type errors.

- [ ] **Step 3: Verify in browser**

Start dev server and verify:
1. Enter erase mode → toolbar is shorter (~40px vs ~48px)
2. Hover over each tool button → tooltip appears below with correct text
3. Click exit button → directly exits without confirmation
4. Zoom canvas in/out → bottom toolbar maintains constant visual size
