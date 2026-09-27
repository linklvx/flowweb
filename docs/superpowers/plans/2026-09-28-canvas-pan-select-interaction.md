# 画布平移/框选交互重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画布交互切换为官方 selection-on-drag 配方——空格/中键平移、左键拖空白框选（Partial 相交即选）、滚轮缩放；配套 marqueeSelecting 拖拽期 UI 抑制、isLocked transform 根因修、Ctrl+滚轮双 writer 消除、快捷键面板与文档同步。

**Architecture:** 三层改动——①canvasStore 新增 `marqueeSelecting` 标志 + `useMarqueeSelectionGuard` 兜底 hook（五通道复位，标志作用域监听）；②CanvasView 交互 props 重配（`panOnDrag=[1]`/`selectionOnDrag`/`selectionMode=Partial`/删 `panOnScroll`）+ isLocked 双定义修正（含 activeTransformNodeId）；③七个操作浮层消费点抑制 + CSS（中键光标/库框视觉拆出）+ 面板与文档同步。

**Tech Stack:** @xyflow/react@12.10.2、zustand、vitest + @testing-library/react（jsdom）。

**Spec:** `docs/superpowers/specs/2026-09-28-canvas-pan-select-interaction-design.md`（五修已确认版）。本 plan 中 §N 引用均指该 spec。

**测试命令约定：** 全部在 `apps/web` 下运行。Bash CWD 会漂移，每条命令显式 `cd /d/flowweb/apps/web && npx vitest run <路径>`。预期失败的报错形态写在各 Step。

**关键事实（勿在实现期重新争论，spec 已五轮审核定稿）：**

- `panOnDrag` 三态：`[1]`=仅中键（**禁 `[1,2]`**——含 2 杀死右键菜单）；`true`=参考选择期保左键平移（D19）；`false`=锁定。
- `panOnScroll` 行整行删除（不写显式 false）；`'panOnScroll' in props === false` 是断言目标。
- `SNAP_GRID` 必须 tuple 标注 `: SnapGrid`（hoist 丢上下文类型 → strict 下 TS2322）；`as const`/`Object.freeze` 与可变 tuple 不兼容，禁用。
- zustand 复位必须函数式返回同引用 `setState((s) => (s.marqueeSelecting ? { marqueeSelecting: false } : s))`——对象字面量必通知全部裸订阅者（4 处，500ms 快照写/O(n) diff 等每次点击白跑）。
- TransformToolbar（消费点 7）**豁免不加标志**——transform 期 isLocked=true（根因修）→ 无框选可达；枚举注释须写豁免理由。
- VideoEditNode.tsx:89 副作用（框选经过停迷你播放）**接受不修**（§5-1 消费点 8，既有选中语义）。
- `lastPointerShiftKey` 与 `marqueeSelecting` 并存非替代：前者覆盖 Shift+点击，后者覆盖框选进行态。

---

### Task 1: canvasStore 新增 marqueeSelecting 字段 + 白名单负向护栏

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts:98`（interface）、`:173`（初始值）
- Test: `apps/web/src/stores/canvasStore.marqueeSelecting.test.ts`（新建）
- Test: `apps/web/src/stores/canvasHistory.test.ts`（追加负向断言）

- [ ] **Step 1: 写失败测试（新建 canvasStore.marqueeSelecting.test.ts）**

```ts
// apps/web/src/stores/canvasStore.marqueeSelecting.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { useCanvasStore } from './canvasStore';
import { pickStructNodes } from './canvasHistory';

// spec §5-1.4 白名单护栏：marqueeSelecting 是抑制用 UI 态，严禁进入结构投影
// （pickStructNodes/storeProjection）与持久化快照——否则框选拖拽会写 undo 栈/协作 doc。
describe('canvasStore.marqueeSelecting', () => {
  afterEach(() => {
    useCanvasStore.setState({ nodes: [], marqueeSelecting: false });
  });

  it('初始 false；setState 生效', () => {
    expect(useCanvasStore.getState().marqueeSelecting).toBe(false);
    useCanvasStore.setState({ marqueeSelecting: true });
    expect(useCanvasStore.getState().marqueeSelecting).toBe(true);
  });

  it('不入结构投影：标志为 true 时 pickStructNodes 键集合固定', () => {
    useCanvasStore.setState({
      nodes: [{ id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any],
      marqueeSelecting: true,
    });
    const picked = pickStructNodes(useCanvasStore.getState().nodes);
    expect(Object.keys(picked[0])).toEqual(['id', 'type', 'position', 'parentId', 'width', 'height']);
    expect(JSON.stringify(picked)).not.toContain('marqueeSelecting');
  });
});
```

- [ ] **Step 2: canvasHistory.test.ts 追加纯函数级键集合断言（先例 :11-14）**

在 `describe('pickStructNodes / pickStructEdges', ...)` 内追加：

```ts
  it('键集合固定（负向护栏：抑制类字段永不入投影）', () => {
    const picked = pickStructNodes([n({ id: 'a', selected: true })]);
    expect(Object.keys(picked[0])).toEqual(['id', 'type', 'position', 'parentId', 'width', 'height']);
  });
```

- [ ] **Step 3: 运行确认失败**

Run: `cd /d/flowweb/apps/web && npx vitest run src/stores/canvasStore.marqueeSelecting.test.ts`
Expected: FAIL —— `useCanvasStore.getState().marqueeSelecting` 为 `undefined`（`expect(undefined).toBe(false)` 红）。

- [ ] **Step 4: 最小实现（canvasStore.ts 两行）**

`CanvasState` interface 的 `lastPointerShiftKey: boolean;`（:98）后加：

```ts
  marqueeSelecting: boolean;
```

初始 state 的 `lastPointerShiftKey: false,`（:173）后加：

```ts
  marqueeSelecting: false,
```

- [ ] **Step 5: 运行确认通过（含 canvasHistory.test 全绿）**

Run: `cd /d/flowweb/apps/web && npx vitest run src/stores/canvasStore.marqueeSelecting.test.ts src/stores/canvasHistory.test.ts`
Expected: PASS 全部。

- [ ] **Step 6: Commit**

```bash
cd /d/flowweb && git add apps/web/src/stores/canvasStore.ts apps/web/src/stores/canvasStore.marqueeSelecting.test.ts apps/web/src/stores/canvasHistory.test.ts && git commit -m "feat(web): canvasStore 新增 marqueeSelecting 标志+白名单负向护栏断言（spec §5-1.4——抑制态不入结构投影/undo 栈）"
```

---

### Task 2: useIsSingleSelected 加 marqueeSelecting 抑制（消费点 1）+ 覆盖文件 mock 接线

**Files:**
- Modify: `apps/web/src/hooks/useIsSingleSelected.ts:14-22`
- Test: `apps/web/src/hooks/useIsSingleSelected.test.tsx`（真 canvasStore，加用例 + beforeEach 复位）
- Test（仅 mock 接线，防脱节）: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.test.tsx:37,109`、`AudioGenNode.test.tsx:65-74`、`MultiImageNode.test.tsx:60-66`

- [ ] **Step 1: useIsSingleSelected.test.tsx 加失败用例**

`beforeEach`（:34-36）改为同时复位两个字段：

```ts
  beforeEach(() => {
    useCanvasStore.setState({ lastPointerShiftKey: false, marqueeSelecting: false });
  });
```

文件末尾（`describe` 内）追加：

```tsx
  it('框选进行中抑制：marqueeSelecting=true 时单选返回 false', () => {
    useCanvasStore.setState({ marqueeSelecting: true });
    rf.setNodes([{ id: 'a', selected: true }]);
    render(<Probe selected />);
    expect(screen.getByTestId('probe').textContent).toBe('multi');
  });

  it('框选结束恢复：marqueeSelecting true→false 且选中数不变时恢复 single（依赖标志订阅触发重渲染）', () => {
    useCanvasStore.setState({ marqueeSelecting: true });
    rf.setNodes([{ id: 'a', selected: true }]);
    render(<Probe selected />);
    expect(screen.getByTestId('probe').textContent).toBe('multi');
    act(() => { useCanvasStore.setState({ marqueeSelecting: false }); });
    expect(screen.getByTestId('probe').textContent).toBe('single');
  });
```

注：该文件 mock 了 `@xyflow/react` 但用**真 canvasStore**（仅 `vi.mock('@xyflow/react')`，见 :18-23），无需改 store mock。

- [ ] **Step 2: 运行确认失败**

Run: `cd /d/flowweb/apps/web && npx vitest run src/hooks/useIsSingleSelected.test.tsx`
Expected: FAIL —— 第一条新用例 `single` ≠ `multi`（hook 尚未读标志）。

- [ ] **Step 3: 实现（合并单次订阅，spec §5-1.5）**

`useIsSingleSelected.ts` 全文替换 `:14-22`：

```ts
export function useIsSingleSelected(selected: boolean | undefined): boolean {
  const selectedCount = useStore((s) => {
    let count = 0;
    for (let i = 0; i < s.nodes.length; i++) if (s.nodes[i].selected) count++;
    return count;
  });
  // 抑制源两并存（spec §5-1）：lastPointerShiftKey=Shift+点击加选期；marqueeSelecting=框选拖拽期。
  // 合并为单次订阅返回布尔原语（zustand Object.is 相等比较稳定），语义恰为「抑制中」。
  const suppressed = useCanvasStore((s) => s.lastPointerShiftKey || s.marqueeSelecting);
  return !!selected && selectedCount === 1 && !suppressed;
}
```

（文件头部 JSDoc 注释保留，末段「lastPointerShiftKey（…）抑制」句后补一句：`marqueeSelecting（框选拖拽进行态）抑制框选途经 count===1 中间态的浮层误弹；两者并存非替代（spec 2026-09-28 §5-1）。`）

- [ ] **Step 4: 运行确认通过**

Run: `cd /d/flowweb/apps/web && npx vitest run src/hooks/useIsSingleSelected.test.tsx`
Expected: PASS 全部（含既有 7 条）。

- [ ] **Step 5: 三个覆盖文件 mock 加可变变量（防 mock 脱节，照 mockLastPointerShiftKey 先例）**

行为覆盖已由 Step 1-4 的真 store 用例承担；本步保证组件级测试环境的 mock 能**表达**该字段（补静态 `false` 与不补运行行为相同、零覆盖——必须是可变变量）。三个文件均不新增置 true 用例，故无需复位逻辑。

**ImageGenNode.test.tsx**（`let mockLastPointerShiftKey = false;` 在 :37）其后加：

```ts
let mockMarqueeSelecting = false;
```

hoisted 内 canvasStoreFn 的 state（`lastPointerShiftKey: mockLastPointerShiftKey,` :109）后加：

```ts
      marqueeSelecting: mockMarqueeSelecting,
```

**AudioGenNode.test.tsx**（:65-74 可调用形态）：mock 工厂外（:64 前）加 `let mockMarqueeSelecting = false;`，state 对象（:68）改为：

```ts
      const state = { projectId: 'test-project', marqueeSelecting: mockMarqueeSelecting };
```

**MultiImageNode.test.tsx**（:60-66 可调用形态）：同法——mock 工厂外加 `let mockMarqueeSelecting = false;`，state（:62）改为：

```ts
    const state = { selectedId: null, selectNode: vi.fn(), marqueeSelecting: mockMarqueeSelecting };
```

- [ ] **Step 6: 运行三个组件测试确认全绿（mock 接线无回归）**

Run: `cd /d/flowweb/apps/web && npx vitest run src/pages/canvas/components/nodes/ImageGenNode.test.tsx src/pages/canvas/components/nodes/AudioGenNode.test.tsx src/pages/canvas/components/nodes/MultiImageNode.test.tsx`
Expected: PASS 全部。

- [ ] **Step 7: Commit**

```bash
cd /d/flowweb && git add apps/web/src/hooks/useIsSingleSelected.ts apps/web/src/hooks/useIsSingleSelected.test.tsx apps/web/src/pages/canvas/components/nodes/ImageGenNode.test.tsx apps/web/src/pages/canvas/components/nodes/AudioGenNode.test.tsx apps/web/src/pages/canvas/components/nodes/MultiImageNode.test.tsx && git commit -m "feat(web): useIsSingleSelected 并入 marqueeSelecting 抑制（框选拖拽期 count===1 中间态浮层不弹，spec §5-1 消费点 1）+三覆盖文件 mock 可变变量接线"
```

---

### Task 3: useMarqueeSelectionGuard 兜底 hook + CanvasView onSelectionStart/End 接线

**Files:**
- Create: `apps/web/src/hooks/useMarqueeSelectionGuard.ts`
- Test: `apps/web/src/hooks/useMarqueeSelectionGuard.test.tsx`（新建，真 canvasStore）
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx`（挂 handlers + hook）
- Test: `apps/web/src/pages/canvas/components/CanvasView.test.tsx`（mock 加可变变量 + 接线断言）
- Test: `apps/web/src/pages/canvas/components/CanvasView.theme-perf.test.tsx:41`（stable 补静态字段）

- [ ] **Step 1: 写失败测试（useMarqueeSelectionGuard.test.tsx）**

```tsx
// apps/web/src/hooks/useMarqueeSelectionGuard.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import { useMarqueeSelectionGuard } from './useMarqueeSelectionGuard';
import { useCanvasStore } from '@/stores/canvasStore';

function GuardProbe() {
  useMarqueeSelectionGuard();
  return <div data-testid="guard" />;
}

const setTrue = () =>
  useCanvasStore.setState((s) => (s.marqueeSelecting ? s : { marqueeSelecting: true }));

describe('useMarqueeSelectionGuard（spec §5-1 兜底复位，标志作用域五通道）', () => {
  beforeEach(() => {
    useCanvasStore.setState({ marqueeSelecting: false });
  });
  afterEach(() => {
    useCanvasStore.setState({ marqueeSelecting: false });
  });

  it('标志 true 时挂载监听；window pointerup 复位 false', () => {
    render(<GuardProbe />);
    act(() => setTrue());
    expect(useCanvasStore.getState().marqueeSelecting).toBe(true);
    act(() => { fireEvent.window.dispatchEvent(new Event('pointerup')); });
    expect(useCanvasStore.getState().marqueeSelecting).toBe(false);
  });

  it('主通道 pointercancel 复位', () => {
    render(<GuardProbe />);
    act(() => setTrue());
    act(() => { fireEvent.window.dispatchEvent(new Event('pointercancel')); });
    expect(useCanvasStore.getState().marqueeSelecting).toBe(false);
  });

  it('补充通道 pointermove buttons===0 复位（窗口外释放）', () => {
    render(<GuardProbe />);
    act(() => setTrue());
    act(() => {
      fireEvent.window.dispatchEvent(new PointerEvent('pointermove', { buttons: 0 }));
    });
    expect(useCanvasStore.getState().marqueeSelecting).toBe(false);
  });

  it('次级通道 blur 复位', () => {
    render(<GuardProbe />);
    act(() => setTrue());
    act(() => { fireEvent.window.dispatchEvent(new Event('blur')); });
    expect(useCanvasStore.getState().marqueeSelecting).toBe(false);
  });

  it('标志 false 时零常驻监听：pointerup 不通知订阅者（函数式同引用守卫，spec §5-1.3）', () => {
    const listener = vi.fn();
    const unsub = useCanvasStore.subscribe(listener);
    render(<GuardProbe />);
    act(() => { fireEvent.window.dispatchEvent(new Event('pointerup')); });
    expect(useCanvasStore.getState().marqueeSelecting).toBe(false);
    // 普通对象字面量 setState 实现下此断言必红（zustand 对 partial 与整 state 做 Object.is，
    // 字面量必不等于整 state → 必通知）；函数式无变化返回原引用 → 不通知。
    expect(listener).not.toHaveBeenCalled();
    unsub();
  });

  it('标志复位即卸载监听：复位后再派发 pointerup 不触发 setState', () => {
    const spy = vi.spyOn(useCanvasStore, 'setState');
    render(<GuardProbe />);
    act(() => setTrue());
    act(() => { fireEvent.window.dispatchEvent(new Event('pointerup')); });
    spy.mockClear();
    act(() => { fireEvent.window.dispatchEvent(new Event('pointerup')); });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

注：`PointerEvent` 在 jsdom（vitest 环境 @rahamann/quilt 或 tsconfig lib）不可用时，用 `new MouseEvent('pointermove', { buttons: 0 } as any)` 构造后手动指派 type——实现时若 `new PointerEvent` 报 undefined，改为：

```ts
const ev = new MouseEvent('pointermove', { buttons: 0 }) as any;
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /d/flowweb/apps/web && npx vitest run src/hooks/useMarqueeSelectionGuard.test.tsx`
Expected: FAIL —— 模块不存在（resolve error: Cannot find .../useMarqueeSelectionGuard）。

- [ ] **Step 3: 实现 hook**

```ts
// apps/web/src/hooks/useMarqueeSelectionGuard.ts
import { useEffect } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';

/**
 * marqueeSelecting 兜底复位（spec 2026-09-28 §5-1.2）。
 * 标志为 true 期间全部操作浮层被抑制且无自愈——兜底是本设计唯一单点故障面，必须五通道：
 * 主通道 pointerup/pointercancel（触发即拖拽必已终止）；补充 pointermove(buttons===0)
 * （窗口外释放时浏览器对 pointerup 派发行为不一）；次级 blur（接受拖拽中 alt-tab 的极小残留窗口）。
 * 标志作用域挂载：非框选期全 app 零常驻开销，卡死时监听恰处激活态。
 * 复位必须函数式返回同引用：对象字面量 partial 永不 Object.is 等于整 state → 必通知全部
 * 裸订阅者（500ms 快照写 / collab O(n) diff 等，每次点击白跑）。
 */
export function useMarqueeSelectionGuard() {
  const marqueeSelecting = useCanvasStore((s) => s.marqueeSelecting);
  useEffect(() => {
    if (!marqueeSelecting) return;
    const reset = () => {
      useCanvasStore.setState((s) => (s.marqueeSelecting ? { marqueeSelecting: false } : s));
    };
    window.addEventListener('pointerup', reset);
    window.addEventListener('pointercancel', reset);
    window.addEventListener('blur', reset);
    const onMove = (e: PointerEvent) => {
      if (e.buttons === 0) reset();
    };
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointerup', reset);
      window.removeEventListener('pointercancel', reset);
      window.removeEventListener('blur', reset);
      window.removeEventListener('pointermove', onMove);
    };
  }, [marqueeSelecting]);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /d/flowweb/apps/web && npx vitest run src/hooks/useMarqueeSelectionGuard.test.tsx`
Expected: PASS 全部 6 条。特别确认「不通知订阅者」用例绿（若红，说明复位实现写成了对象字面量）。

- [ ] **Step 5: CanvasView.test.tsx 写接线失败断言（mock 先加可变变量）**

mock 区顶部变量（`let mockLastPointerShiftKey = false;` :15）后加：

```ts
let mockMarqueeSelecting = false;
```

mock state（`lastPointerShiftKey: mockLastPointerShiftKey,` :41）后加：

```ts
        marqueeSelecting: mockMarqueeSelecting,
```

`beforeEach`（:76-82）加 `mockMarqueeSelecting = false;`。

`describe` 末尾追加接线用例（该文件 mock 的 ReactFlow 是 `vi.importActual` 真渲染，无法直接拿 props 驱动 onSelectionStart——jsdom 不能合成 d3 手势，spec §8 边界已登记；此处验证订阅接线与 guard 在 mock store 下可挂载，**行为**验证由 Step 1-4 真 store 测试 + 浏览器验收 §9-3 承担）：

```tsx
  it('marqueeSelecting 订阅接线：mock 标志 true 渲染不崩溃（guard/消费点在 mock store 下可挂载）', () => {
    mockMarqueeSelecting = true;
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    expect(container.querySelector('.react-flow')).toBeInTheDocument();
  });
```

- [ ] **Step 6: CanvasView.tsx 接线（handlers + hook）**

import 区加：

```ts
import { useMarqueeSelectionGuard } from '@/hooks/useMarqueeSelectionGuard';
```

组件体内（`useTrackCanvasPointerShift(reactFlowWrapper);` :119 后）加：

```ts
  useMarqueeSelectionGuard();
```

ReactFlow props（`onPaneContextMenu={onPaneContextMenu}` :459 附近）后加两个 useCallback handlers（与文件内既有 handler 风格一致，定义在组件体 `onPaneContextMenu` 之后）：

```ts
  // 框选拖拽期 UI 抑制信号（spec §5-1）：onSelectionStart 触发点在 resetSelectedElements 与首次
  // triggerNodeChanges 之前的同一同步体——标志必然先于选中态变化落入同一 React 批次。
  const onSelectionStart = useCallback(() => {
    useCanvasStore.setState({ marqueeSelecting: true });
  }, []);
  const onSelectionEnd = useCallback(() => {
    useCanvasStore.setState((s) => (s.marqueeSelecting ? { marqueeSelecting: false } : s));
  }, []);
```

JSX props 加：

```tsx
        onSelectionStart={onSelectionStart}
        onSelectionEnd={onSelectionEnd}
```

（useCallback 稳定：一旦将来进入 effect deps 不放大为每帧 update()，spec §5-1.1。）

- [ ] **Step 7: theme-perf mock stable 补静态字段**

`CanvasView.theme-perf.test.tsx` stable 对象（`lastPointerShiftKey: false,` :41）后加：

```ts
    marqueeSelecting: false,
```

（该文件无抑制用例，静态字段仅保证 mock 与真 store 形状一致。）

- [ ] **Step 8: 运行 CanvasView 全部测试确认通过**

Run: `cd /d/flowweb/apps/web && npx vitest run src/pages/canvas/components/CanvasView.test.tsx src/pages/canvas/components/CanvasView.theme-perf.test.tsx`
Expected: PASS 全部（theme-perf 的 render 计数断言不受影响——新订阅返回布尔原语，Object.is 稳定）。

- [ ] **Step 9: Commit**

```bash
cd /d/flowweb && git add apps/web/src/hooks/useMarqueeSelectionGuard.ts apps/web/src/hooks/useMarqueeSelectionGuard.test.tsx apps/web/src/pages/canvas/components/CanvasView.tsx apps/web/src/pages/canvas/components/CanvasView.test.tsx apps/web/src/pages/canvas/components/CanvasView.theme-perf.test.tsx && git commit -m "feat(web): marqueeSelecting 驱动源——onSelectionStart/End 接线+useMarqueeSelectionGuard 五通道兜底（标志作用域监听/函数式同引用复位，spec §5-1）"
```

---

### Task 4: isLocked 双定义修正 + CanvasView 核心交互 props（主改动）

**Files:**
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx:2`（import）、`:49-62`（模块常量区）、`:108-109`（订阅式 isLocked）、`:299-300`（命令式 isLockedNow）、`:466-474`（ReactFlow props）
- Test: `apps/web/src/pages/canvas/components/CanvasView.interaction-props.test.tsx`（新建，props 契约断言主防线）
- Test: `apps/web/src/pages/canvas/components/CanvasView.test.tsx`（派生 class 断言 + transform 锁定用例 + afterEach 复位）

- [ ] **Step 1: 新建 CanvasView.interaction-props.test.tsx（写失败断言）**

```tsx
// apps/web/src/pages/canvas/components/CanvasView.interaction-props.test.tsx
// spec §8.1 props 契约断言（主防线）：mock 记录型 ReactFlow 捕获 props，精确值断言覆盖一切误改
// （含 [1,2]——其 class 表现与 [1] 相同，仅 props 断言能兜住）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { SelectionMode } from '@xyflow/react';
import { useNodeStore } from '@/stores/nodeStore';

const captured = vi.hoisted(() => ({ props: null as any }));

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual<any>('@xyflow/react');
  return {
    ...actual,
    ReactFlow: (props: any) => { captured.props = props; return <div data-testid="rf-captured" />; },
    useReactFlow: () => ({
      screenToFlowPosition: (p: any) => p,
      zoomIn: vi.fn(), zoomOut: vi.fn(), fitView: vi.fn(), setCenter: vi.fn(),
      getNodes: vi.fn(() => []), setNodes: vi.fn(),
    }),
  };
});

// 捕获 decideHandleMenu 入参——验证 onConnectEnd 内 isLockedNow 双定义同口径（spec §3）
const handleMenuSpy = vi.hoisted(() => ({ seen: null as any }));
vi.mock('./handleMenu', () => ({
  clientPoint: (e: any) => ({ x: e.clientX ?? 0, y: e.clientY ?? 0 }),
  absoluteRectsOf: () => [],
  decideHandleMenu: (args: any) => { handleMenuSpy.seen = args; return { kind: 'ignore' }; },
}));

import { CanvasView } from './CanvasView';

function renderCapture() {
  render(<CanvasView projectId="p1" />);
  expect(captured.props).toBeTruthy();
  return captured.props;
}

describe('CanvasView 交互 props 契约（spec §3/§8.1）', () => {
  beforeEach(() => {
    captured.props = null;
    handleMenuSpy.seen = null;
  });
  afterEach(() => {
    // 真 nodeStore 防跨用例污染（spec §8.6）
    useNodeStore.setState({ activeEditNodeId: null, activeTransformNodeId: null, referenceSelect: null });
  });

  it('非锁定：panOnDrag=[1]/selectionOnDrag/zoomOnScroll/Partial/无 panOnScroll/Space', () => {
    const p = renderCapture();
    expect(p.panOnDrag).toEqual([1]);
    expect(p.selectionOnDrag).toBe(true);
    expect(p.zoomOnScroll).toBe(true);
    expect(p.selectionMode).toBe(SelectionMode.Partial);
    expect('panOnScroll' in p).toBe(false); // 钉死删行而非显式 false
    expect(p.panActivationKeyCode).toBe('Space');
    expect(p.zoomOnDoubleClick).toBe(true);
  });

  it('锁定（activeEditNodeId）：四 prop 反转 + panActivationKeyCode=null', () => {
    useNodeStore.setState({ activeEditNodeId: 'node-1' });
    const p = renderCapture();
    expect(p.panOnDrag).toBe(false);
    expect(p.selectionOnDrag).toBe(false);
    expect(p.zoomOnScroll).toBe(false);
    expect(p.panActivationKeyCode).toBe(null);
  });

  it('锁定（activeTransformNodeId）：transform 调整中同锁定口径（§3 根因修）', () => {
    useNodeStore.setState({ activeTransformNodeId: 'node-1' });
    const p = renderCapture();
    expect(p.panOnDrag).toBe(false);
    expect(p.selectionOnDrag).toBe(false);
    expect(p.zoomOnScroll).toBe(false);
    expect(p.panActivationKeyCode).toBe(null);
  });

  it('参考选择期：panOnDrag=true（D19 保左键平移）', () => {
    useNodeStore.setState({ referenceSelect: { sourceNodeId: 'src-1' } as any });
    const p = renderCapture();
    expect(p.panOnDrag).toBe(true);
  });

  it('transform 期 handle 拖拽 isLocked 双定义同口径（onConnectEnd → decideHandleMenu）', () => {
    useNodeStore.setState({ activeTransformNodeId: 'node-1' });
    const p = renderCapture();
    const ev = new MouseEvent('mouseup', { clientX: 10, clientY: 10 });
    p.onConnectStart(ev, { nodeId: 'n1', handleId: null, handleType: 'source' });
    p.onConnectEnd(ev, { isValid: null, toHandle: null, toNode: null });
    expect(handleMenuSpy.seen).toBeTruthy();
    expect(handleMenuSpy.seen.isLocked).toBe(true);
  });
});
```

注：CanvasView import `RemoteCursors` → `getAwareness()`（canvasCollabRuntime）测试环境返回 null 则跳过渲染（CanvasView.test.tsx 同环境既有先例）。若运行报 collab 模块初始化错误，按 CanvasView.test.tsx 既通过的依赖环境排查（它未 mock 该模块）。

- [ ] **Step 2: 运行确认失败**

Run: `cd /d/flowweb/apps/web && npx vitest run src/pages/canvas/components/CanvasView.interaction-props.test.tsx`
Expected: FAIL —— 非锁定用例：`p.panOnDrag` 实际 `true`（现配置 `panOnDrag={!isLocked}`）≠ `[1]`；`'panOnScroll' in p` 实际 `true`。

- [ ] **Step 3: 实现 CanvasView.tsx 核心改动**

**3a. import 区**（`:2-9` 的 `@xyflow/react` import）追加类型与枚举：

```ts
import {
  ReactFlow, Background, BackgroundVariant, MiniMap,
  useReactFlow, SelectionMode,
  type Connection, type FinalConnectionState, type SnapGrid,
  type NodeTypes, type OnNodesChange, type OnEdgesChange,
} from '@xyflow/react';
```

**3b. 模块常量区**（`edgeTypes` 定义 `:60-62` 之后、`interface Props` 之前）：

```ts
// panOnDrag 不在 StoreUpdater fieldsToTrack（react:186-248，不写库）；真实代价在 ZoomPane 的
// update effect（react:1337-1377，deps 含 panOnDrag）——每帧重渲染链（defaultViewport 每帧新对象
// → GraphView memo 失效 → FlowRenderer 重建 children → effect 重跑 → update() 重建 wheel/start
// 处理器）。常量使引用稳定 → effect 不重跑。禁 [1,2]：数组含 2 时右键成为平移按钮且
// onContextMenu 直接 preventDefault+return，右键菜单路径彻底失效（spec §3.1）。
const PAN_ON_DRAG_MIDDLE = [1];
// snapGrid 在 fieldsToTrack 且原为内联——本文件真正每帧写 store 的是它，一并 hoist。
// 必须显式 tuple 标注：hoist 丢上下文类型后 [20,20] 退化为 number[] → strict TS2322；
// as const/Object.freeze 与可变 tuple 不兼容，禁用。勿原地改写（会 store.setState 进库共享引用）。
const SNAP_GRID: SnapGrid = [20, 20];
```

**3c. 订阅式 isLocked（`:108-109`）**：

```ts
  const activeEditNodeId = useNodeStore((s) => s.activeEditNodeId);
  const activeTransformNodeId = useNodeStore((s) => s.activeTransformNodeId);
  // 锁定=编辑中或 transform 调整中（spec §3 根因修）——与 useGroupKeyboard「模式中」口径对齐
  // （编辑与 transform 互斥，nodeStore.ts:383）。不修则 transform 期框选第一帧 resetSelectedElements
  // 反选调整中节点 → TransformToolbar 中途消失。
  const isLocked = activeEditNodeId !== null || activeTransformNodeId !== null;
```

**3d. 命令式 isLockedNow（onConnectEnd 内 `:299-300`）**——原注释 `// isLocked 来源=useNodeStore.activeEditNodeId（CanvasView L102-103 既有订阅同一 store，实证勿改读 canvasStore）` 一并刷新：

```ts
    // isLocked 双定义第二处（spec §3）：与 L109 订阅式同口径（编辑中或 transform 调整中），
    // 喂 decideHandleMenu——只改订阅式漏此处会「画布锁了 handle 菜单没锁」。
    const isLockedNow = useNodeStore.getState().activeEditNodeId !== null
      || useNodeStore.getState().activeTransformNodeId !== null;
```

**3e. ReactFlow props（`:466-474`）**：

```tsx
        zoomOnScroll={!isLocked}
        panOnDrag={isLocked ? false : inRefSelect ? true : PAN_ON_DRAG_MIDDLE}
        zoomOnDoubleClick={!isLocked}
        nodesDraggable={inRefSelect ? false : !isLocked}
        nodesFocusable={!isLocked}
        elementsSelectable={inRefSelect ? false : !isLocked}
        snapToGrid={snapEnabled}
        snapGrid={SNAP_GRID}
        selectionOnDrag={!isLocked}
        selectionMode={SelectionMode.Partial}
        panActivationKeyCode={isLocked ? null : 'Space'}
```

（即：删 `panOnScroll={!isLocked}` 整行；`zoomOnScroll={false}` → `{!isLocked}`；`panOnDrag={!isLocked}` → 三态；`snapGrid={[20, 20]}` → `{SNAP_GRID}`；新增 `selectionOnDrag`/`selectionMode`/`panActivationKeyCode` 三行。）

- [ ] **Step 4: 运行 interaction-props 确认通过**

Run: `cd /d/flowweb/apps/web && npx vitest run src/pages/canvas/components/CanvasView.interaction-props.test.tsx`
Expected: PASS 全部 5 条。

- [ ] **Step 5: CanvasView.test.tsx 加派生 class 断言（辅防线，真实渲染）**

`describe` 末尾追加（该文件 ReactFlow 是 `vi.importActual` 真渲染，pane 类由库计算）：

```tsx
  // ── 派生 class 断言（spec §8.2）：能抓含 0 的误改（[0,1]/true → draggable 挂）──
  // 真 nodeStore 驱动锁定；afterEach 复位防污染
  afterEach(() => {
    useNodeStore.setState({ activeEditNodeId: null, activeTransformNodeId: null });
  });

  it('非锁定：pane 有 selection 无 draggable（左键框选主路径）', () => {
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const pane = container.querySelector('.react-flow__pane')!;
    expect(pane).toBeInTheDocument();
    expect(pane.className).toContain('selection');
    expect(pane.className).not.toContain('draggable');
  });

  it('锁定：pane 两者皆无', () => {
    useNodeStore.setState({ activeEditNodeId: 'node-1' });
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const pane = container.querySelector('.react-flow__pane')!;
    expect(pane.className).not.toContain('selection');
    expect(pane.className).not.toContain('draggable');
  });

  it('transform 调整中：同锁定（根因修回归防线）', () => {
    useNodeStore.setState({ activeTransformNodeId: 'node-1' });
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const pane = container.querySelector('.react-flow__pane')!;
    expect(pane.className).not.toContain('selection');
    expect(pane.className).not.toContain('draggable');
  });

  it('空格按下 draggable 上、松开复位（空格平移在+框选让位；keyUp 必须复位防污染）', () => {
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const pane = () => container.querySelector('.react-flow__pane')!;
    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    expect(pane().className).toContain('draggable');
    expect(pane().className).not.toContain('selection');
    fireEvent.keyUp(window, { key: ' ', code: 'Space' });
    expect(pane().className).not.toContain('draggable');
    expect(pane().className).toContain('selection');
  });
```

import 区补 `useNodeStore`：

```ts
import { useNodeStore } from '@/stores/nodeStore';
```

（若文件已 import 则跳过；该文件此前未 mock nodeStore，即真 store。）

- [ ] **Step 6: 运行 CanvasView.test 全量确认通过**

Run: `cd /d/flowweb/apps/web && npx vitest run src/pages/canvas/components/CanvasView.test.tsx`
Expected: FAIL 可能出现在既有 4 条 wheel 用例（`should zoom in on Ctrl+wheel...` 等 L117-160）——它们断言 `mockZoomIn/mockZoomOut` 被调用，本任务尚未动 wheel effect（Task 7 才改），**应仍通过**；若因 props 变化意外红，检查是否误删 zoomOnDoubleClick 等。新增 4 条 class 用例 PASS。

- [ ] **Step 7: 运行 theme-perf 确认仍绿（SNAP_GRID hoist 的动机断言）**

Run: `cd /d/flowweb/apps/web && npx vitest run src/pages/canvas/components/CanvasView.theme-perf.test.tsx`
Expected: PASS（viewport 变更不触发 store 写——snapGrid 引用稳定后 fieldsToTrack 浅比较不再每帧写库）。

- [ ] **Step 8: Commit**

```bash
cd /d/flowweb && git add apps/web/src/pages/canvas/components/CanvasView.tsx apps/web/src/pages/canvas/components/CanvasView.interaction-props.test.tsx apps/web/src/pages/canvas/components/CanvasView.test.tsx && git commit -m "feat(web): 画布交互核心重配——panOnDrag=[1] 中键/空格平移+selectionOnDrag 左键框选 Partial+滚轮缩放+删 panOnScroll；isLocked 双定义并入 activeTransformNodeId（spec §3 根因修）；SNAP_GRID/PAN_ON_DRAG_MIDDLE 模块常量 hoist"
```

---

### Task 5: 消费点 2/3/4——selectedGroup / SelectionBoxOverlay / GroupNodeResizer 抑制

**Files:**
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx:405-416`（selectedGroup）
- Modify: `apps/web/src/pages/canvas/components/groups/SelectionBoxOverlay.tsx:14-26`
- Modify: `apps/web/src/pages/canvas/components/groups/GroupNode.tsx:35-45`
- Test: `CanvasView.test.tsx`、`SelectionBoxOverlay.test.tsx`、`GroupNode.test.tsx`（各加用例 + mock 可变变量）

- [ ] **Step 1: CanvasView.test.tsx 写 selectedGroup 抑制失败用例（照 lastPointerShiftKey 先例 :392-401）**

`describe` 末尾追加：

```tsx
  it('组单选 + marqueeSelecting=true → GroupToolbar 抑制（消费点 2）', () => {
    mockNodes = [groupNode];
    mockMarqueeSelecting = true;
    render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    expect(screen.queryByTestId('group-toolbar')).not.toBeInTheDocument();
  });

  it('组单选 marqueeSelecting true→false 且 nodes 不变 → GroupToolbar 恢复', () => {
    mockNodes = [groupNode];
    mockMarqueeSelecting = true;
    const { rerender } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    expect(screen.queryByTestId('group-toolbar')).not.toBeInTheDocument();
    mockMarqueeSelecting = false;
    rerender(
      <ReactFlowProvider>
        <CanvasView projectId="p2" />
      </ReactFlowProvider>
    );
    expect(screen.getByTestId('group-toolbar')).toBeInTheDocument();
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /d/flowweb/apps/web && npx vitest run src/pages/canvas/components/CanvasView.test.tsx -t 'GroupToolbar'`
Expected: FAIL —— 第一条：group-toolbar 仍渲染（selectedGroup 尚未读标志）。

- [ ] **Step 3: 实现 selectedGroup 合并订阅（CanvasView.tsx :405-416）**

```ts
  // 选中组节点时显示 GroupToolbar；多选（≥2）、Shift 加选意图或框选拖拽中不显示（spec §5-1 消费点 2）
  const selectedGroup = useMemo(() => {
    let count = 0;
    for (const n of nodes) {
      if (!n.selected) continue;
      count++;
      if (count > 1) return undefined;
    }
    return count === 1 && !lastPointerShiftKey && !marqueeSelecting
      ? nodes.find((n) => n.type === 'group' && n.selected)
      : undefined;
  }, [nodes, lastPointerShiftKey, marqueeSelecting]);
```

组件体订阅区（`lastPointerShiftKey` 订阅 `:118` 后）加：

```ts
  const marqueeSelecting = useCanvasStore((s) => s.marqueeSelecting);
```

- [ ] **Step 4: SelectionBoxOverlay.test.tsx 写失败用例 + mock 接线**

mock（:22-25）改为（rf.state 补字段）：

```ts
const rf = vi.hoisted(() => {
  const state = { nodes: [] as any[], vp: { x: 0, y: 0, zoom: 1 }, marqueeSelecting: false };
  return { state };
});
```

（`:24` 的 canvasStore mock selector 对象同步加 `marqueeSelecting: rf.state.marqueeSelecting`：）

```ts
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: (sel: any) => sel({ nodes: rf.state.nodes.filter((n) => n.selected), groupNodes: storeApi.groupNodes, marqueeSelecting: rf.state.marqueeSelecting }),
}));
```

`describe` 末尾追加：

```ts
  it('框选拖拽中 ≥2 选中不渲染几何体（消费点 3，spec §5-1 不变式）', () => {
    rf.state.marqueeSelecting = true;
    rf.state.nodes = [mk('n1', 'imageGen', {}, { positionAbsolute: { x: 100, y: 200 } }), mk('n2', 'imageGen', {}, { positionAbsolute: { x: 110, y: 210 } })];
    rf.state.vp = { x: 0, y: 0, zoom: 1 };
    const { container } = render(<SelectionBoxOverlay />);
    expect(container).toBeEmptyDOMElement();
    expect(portal.children.length).toBe(0);
    rf.state.marqueeSelecting = false; // 复位防污染
  });
```

（`beforeEach` 无需改——rf.state.nodes/vp 每用例自赋值；marqueeSelecting 在用例尾复位。）

- [ ] **Step 5: 实现 SelectionBoxOverlay geo 抑制（:14-26）**

组件体订阅区（`mergeStoryboard` 订阅后）加：

```ts
  const marqueeSelecting = useCanvasStore((s) => s.marqueeSelecting);
```

geo（:25-26）首行条件改：

```ts
  const geo = useMemo(() => {
    if (selectedInternal.length < 2 || marqueeSelecting) return null;
```

deps（:41）加 `marqueeSelecting`：

```ts
  }, [selectedInternal, vpX, vpY, zoom, marqueeSelecting]);
```

- [ ] **Step 6: GroupNode.test.tsx 写失败用例 + mock 接线**

hoisted（:6-12）扩为：

```ts
const { getMockNodes, setMockNodes, getMockMarqueeSelecting, setMockMarqueeSelecting } = vi.hoisted(() => {
  let mockNodes: any[] = [];
  let mockMarqueeSelecting = false;
  return {
    getMockNodes: () => mockNodes,
    setMockNodes: (n: any[]) => { mockNodes = n; },
    getMockMarqueeSelecting: () => mockMarqueeSelecting,
    setMockMarqueeSelecting: (v: boolean) => { mockMarqueeSelecting = v; },
  };
});
```

canvasStore mock（:14-19）state 加字段：

```ts
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: Object.assign(
    vi.fn((selector?: any) => selector({ nodes: getMockNodes(), marqueeSelecting: getMockMarqueeSelecting() })),
    { getState: () => ({ nodes: getMockNodes(), markManuallyResized: vi.fn() }) },
  ),
}));
```

`describe` 末尾追加：

```ts
describe('GroupNodeResizer 框选抑制（消费点 4）', () => {
  it('selected 且未折叠 + marqueeSelecting=true → Resizer 不渲染；false 恢复', () => {
    setMockNodes([]);
    setMockMarqueeSelecting(true);
    const { rerender } = render(
      <GroupNode id="g1" data={{ groupType: 'normal' }} selected {...{} as any} />
    );
    expect(screen.queryByTestId('node-resizer')).not.toBeInTheDocument();
    setMockMarqueeSelecting(false);
    rerender(<GroupNode id="g1" data={{ groupType: 'normal' }} selected {...{} as any} />);
    expect(screen.getByTestId('node-resizer')).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: 实现 GroupNodeResizer 条件（GroupNode.tsx :35-45）**

组件头加订阅（import 已有 useCanvasStore）：

```ts
function GroupNodeComponent({ id, data, selected }: NodeProps) {
  const marqueeSelecting = useCanvasStore((s) => s.marqueeSelecting);
  if ((data as any).groupType === 'storyboard') {
    return <StoryboardGroupRendererCellNodes id={id} data={data as any} />;
  }
  return (
    <>
      {selected && !(data as any).collapsed && !marqueeSelecting && <GroupNodeResizer id={id} />}
      <NormalGroupRenderer groupId={id} data={data as any} selected={!!selected} />
    </>
  );
}
```

- [ ] **Step 8: 运行三文件全量确认通过**

Run: `cd /d/flowweb/apps/web && npx vitest run src/pages/canvas/components/CanvasView.test.tsx src/pages/canvas/components/groups/SelectionBoxOverlay.test.tsx src/pages/canvas/components/groups/GroupNode.test.tsx`
Expected: PASS 全部。

- [ ] **Step 9: Commit**

```bash
cd /d/flowweb && git add apps/web/src/pages/canvas/components/CanvasView.tsx apps/web/src/pages/canvas/components/groups/SelectionBoxOverlay.tsx apps/web/src/pages/canvas/components/groups/GroupNode.tsx apps/web/src/pages/canvas/components/CanvasView.test.tsx apps/web/src/pages/canvas/components/groups/SelectionBoxOverlay.test.tsx apps/web/src/pages/canvas/components/groups/GroupNode.test.tsx && git commit -m "feat(web): 框选拖拽期操作浮层抑制——selectedGroup/SelectionBoxOverlay/GroupNodeResizer（spec §5-1 消费点 2/3/4）"
```

---

### Task 6: 消费点 5/6——VideoGenNode VideoConfigPanel / ConnectionLine 边×按钮

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx:792`
- Modify: `apps/web/src/pages/canvas/components/edges/ConnectionLine.tsx:107`
- Test: `VideoGenNode.test.tsx`（mock 可变变量 + 用例）、`ConnectionLine.test.tsx`（mock 升级可调用形态 + EdgeLabelRenderer mock + 用例）

- [ ] **Step 1: VideoGenNode.test.tsx mock 接线 + 失败用例**

mock 工厂外（:84 前）加 `let mockMarqueeSelecting = false;`；canvasStore mock state（:88）改：

```ts
      const state = { projectId: mockCanvasProjectId(), marqueeSelecting: mockMarqueeSelecting };
```

该文件既有 `renderNode(selected)` 辅助（:147-148，`baseNodeProps` 默认 fileId=undefined/trimMode=false——:243-245「should show config panel when selected」即对照先例）与 VideoConfigPanel mock 输出文本 `config panel`（:119-121）。`describe` 末尾追加：

```ts
  it('框选拖拽中 selected → 底部 VideoConfigPanel 不闪出（消费点 5）；结束恢复', () => {
    mockMarqueeSelecting = true;
    renderNode(true);
    expect(screen.queryByText('config panel')).not.toBeInTheDocument();
    mockMarqueeSelecting = false;
    renderNode(true);
    expect(screen.getByText('config panel')).toBeInTheDocument();
  });
```

- [ ] **Step 2: 实现 VideoGenNode.tsx:792**

组件体订阅区加（与其他 useCanvasStore 订阅并列）：

```ts
  const marqueeSelecting = useCanvasStore((s) => s.marqueeSelecting);
```

` :792` 条件追加：

```tsx
      {!trimMode && selected && !fileId && !referenceVideo && !hdPanelOpen && !marqueeSelecting && (
```

- [ ] **Step 3: ConnectionLine.test.tsx mock 升级 + 失败用例**

canvasStore mock（:6-12）从普通对象形态升级为可调用形态（spec §8.3 对照表：普通对象上加 `useCanvasStore((s)=>…)` 订阅立刻 TypeError）：

```ts
let mockMarqueeSelecting = false;

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: Object.assign(
    vi.fn((selector?: any) => selector({ onEdgesChange: vi.fn(), marqueeSelecting: mockMarqueeSelecting })),
    { getState: () => ({ onEdgesChange: vi.fn() }) },
  ),
}));
```

`@xyflow/react` mock（:16-22）补 EdgeLabelRenderer 直渲染（jsdom 无 `.react-flow__edgelabel-renderer` DOM，portal 到 null 不渲染 × 按钮——mock 为透传使断言可达）：

```ts
vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual('@xyflow/react');
  return {
    ...actual,
    useStore: vi.fn(),
    EdgeLabelRenderer: ({ children }: any) => <>{children}</>,
  };
});
```

`describe` 末尾追加：

```ts
  it('框选拖拽中 selected 边 × 删除按钮不渲染（消费点 6）；结束恢复', () => {
    mockMarqueeSelecting = true;
    setupMockUseStore(false, false);
    const { rerender } = renderWithProviders({ selected: true });
    expect(screen.queryByText('×')).not.toBeInTheDocument();
    mockMarqueeSelecting = false;
    rerender(
      <ReactFlowProvider>
        <svg>
          <ConnectionLine {...defaultProps} selected={true} />
        </svg>
      </ReactFlowProvider>,
    );
    expect(screen.getByText('×')).toBeInTheDocument();
    mockMarqueeSelecting = false;
  });
```

- [ ] **Step 4: 实现 ConnectionLine.tsx:107**

组件体加订阅（import 区补 `import { useCanvasStore } from '@/stores/canvasStore';`——若已 import 跳过）：

```ts
  const marqueeSelecting = useCanvasStore((s) => s.marqueeSelecting);
```

`:107` 条件改：

```tsx
      {selected && !marqueeSelecting && (
```

- [ ] **Step 5: 运行两文件全量确认通过**

Run: `cd /d/flowweb/apps/web && npx vitest run src/pages/canvas/components/nodes/VideoGenNode.test.tsx src/pages/canvas/components/edges/ConnectionLine.test.tsx`
Expected: PASS 全部。

- [ ] **Step 6: Commit**

```bash
cd /d/flowweb && git add apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx apps/web/src/pages/canvas/components/edges/ConnectionLine.tsx apps/web/src/pages/canvas/components/nodes/VideoGenNode.test.tsx apps/web/src/pages/canvas/components/edges/ConnectionLine.test.tsx && git commit -m "feat(web): 框选拖拽期操作浮层抑制——VideoConfigPanel/边×删除按钮（spec §5-1 消费点 5/6）+ConnectionLine mock 升级可调用形态"
```

---

### Task 7: Ctrl+滚轮双 writer 从根消除（§5-3）

**Files:**
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx:360-374`（wheel effect）
- Test: `apps/web/src/pages/canvas/components/CanvasView.test.tsx`（删 4 条旧断言 + 新增守卫用例）

- [ ] **Step 1: 改造 CanvasView.test.tsx wheel 用例（先红）**

删除既有 4 条（L117-160）：`should zoom in on Ctrl+wheel up` / `should zoom out on Ctrl+wheel down` / `should zoom on Cmd+wheel (Mac compatibility)` / `should NOT zoom on regular wheel without modifier`（语义已反，spec §8.5）。原位新增：

```tsx
  // ── Ctrl+滚轮守卫（spec §5-3：双 writer 步进已删，守卫保留）──
  it('画布内 Ctrl+滚轮：preventDefault 且不调 zoomIn（步进已删，xyflow 内建缩放唯一 writer）', () => {
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const wrapper = container.firstElementChild!;
    const e = new WheelEvent('wheel', { ctrlKey: true, cancelable: true, bubbles: true });
    wrapper.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(mockZoomIn).not.toHaveBeenCalled();
    expect(mockZoomOut).not.toHaveBeenCalled();
  });

  it('portal 区域（#node-toolbar-portal）Ctrl+滚轮 preventDefault（守卫真实价值：d3 wheel 挂 renderer 不可见）', () => {
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const portal = container.querySelector('#node-toolbar-portal')!;
    expect(portal).toBeInTheDocument();
    const e = new WheelEvent('wheel', { ctrlKey: true, cancelable: true, bubbles: true });
    portal.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it('画布外 Ctrl+滚轮不 preventDefault（恢复浏览器页面缩放，行为变化 spec §5-3）', () => {
    render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const e = new WheelEvent('wheel', { ctrlKey: true, cancelable: true });
    document.body.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /d/flowweb/apps/web && npx vitest run src/pages/canvas/components/CanvasView.test.tsx -t '滚轮'`
Expected: FAIL —— 第一条：`defaultPrevented` 为 false 时 `mockZoomIn` 已被调（现状双 writer）；或 `expect(e.defaultPrevented).toBe(true)` 红（守卫挂 document 且现状调 zoomIn）。以 `defaultPrevented`/`not.toHaveBeenCalled` 红为准。

- [ ] **Step 3: 实现 effect 改写（CanvasView.tsx :360-374 整段替换）**

```ts
  // Ctrl/Cmd+wheel 守卫（spec §5-3）：缩放步进已删——xyflow 内建 Ctrl 缩放是唯一 writer（双 writer
  // 双倍缩放从根消除）。守卫真实价值=①覆盖 #node-toolbar-portal（.react-flow 兄弟节点，d3 wheel
  // 挂 renderer 上不可见）②防御性兜底；范围收窄到画布内（wrapper 外恢复浏览器整页缩放）。
  // preventDefault 不阻断 d3（d3 不查 defaultPrevented），守卫不损伤库内缩放。
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (reactFlowWrapper.current?.contains(e.target as Node)) e.preventDefault();
    };
    document.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => document.removeEventListener('wheel', onWheel, { capture: true });
  }, []);
```

（deps `[]`：不再依赖 isLocked/zoomIn/zoomOut；工具栏缩放按钮 L512-513 的 zoomIn/zoomOut 不受影响。）

- [ ] **Step 4: 运行 CanvasView.test 全量确认通过**

Run: `cd /d/flowweb/apps/web && npx vitest run src/pages/canvas/components/CanvasView.test.tsx`
Expected: PASS 全部（含 Task 4/5 新增用例）。

- [ ] **Step 5: Commit**

```bash
cd /d/flowweb && git add apps/web/src/pages/canvas/components/CanvasView.tsx apps/web/src/pages/canvas/components/CanvasView.test.tsx && git commit -m "fix(web): Ctrl+滚轮双 writer 从根消除——删 document 级缩放步进只留 wrapper 内 preventDefault 守卫（portal 覆盖+画布外恢复页面缩放，spec §5-3）"
```

---

### Task 8: CSS——中键拖光标修正 + 库多选框视觉拆出

**Files:**
- Modify: `apps/web/src/index.css:219-229`

- [ ] **Step 1: index.css 改两处**

`:225-229` 组合选择器拆开（`.react-flow__nodesselection-rect` 从组合中移除、显式透明；`.react-flow__selection` 保留——框选拖拽中的虚线反馈）：

```css
/* 多选视觉由自定义 SelectionBoxOverlay 渲染；内置 selection rect 仅保留拖拽交互层 */
.react-flow__nodesselection-rect { fill: transparent; stroke: transparent; }

/* selection 钉值两档裁定（D2 定案——撤钉实验取消，xyflow 12.10.2 dist/style.css :39-40/:85-86 实测）：
 * 浅档=light 皮肤默认值（rgba(0,89,220,0.08/0.8) 与钉值逐字节重合，浅档冗余）；wrapper colorMode={mode}
 * 后深档承重——dark 皮肤默认是另一组 rgba(200,200,220,0.08/0.8) 浅灰蓝，无此钉值即被改写（A2 修复 Step2 实测冻结）。 */
.react-flow__selection {
  background: rgba(0, 89, 220, 0.08);
  border: 1px dotted rgba(0, 89, 220, 0.8);
}

/* 库框视觉移除（spec §6：拆自上组钉值——div 渲染下 fill/stroke 是 no-op、background+border 才真可见，
 * 与 app 框形成错位双虚线框且框选恰 1 节点时残留；拖拽交互层是 div 本身，透明不影响从已选区拖动选中集） */
.react-flow__nodesselection-rect {
  background: transparent;
  border: none;
}

/* 中键拖平移中光标 grabbing（spec §3：.dragging 与 .selection 同特异性 0,2,0 源序后者恒胜——
 * 官方 panOnDrag=true 时两类不同挂、从未暴露此组合，本次 [1] 配置引入的副作用修正） */
.react-flow__pane.selection.dragging { cursor: grabbing; }
```

- [ ] **Step 2: 运行全量画布相关测试确认无回归（CSS 无单测设施，防意外）**

Run: `cd /d/flowweb/apps/web && npx vitest run src/pages/canvas/components/ src/hooks/ src/stores/`
Expected: PASS 全部。视觉验证走浏览器验收（§9-6 中键光标 / §9-21 单一框）。

- [ ] **Step 3: Commit**

```bash
cd /d/flowweb && git add apps/web/src/index.css && git commit -m "fix(web): CSS——中键拖 grabbing 光标修正+库 nodesselection-rect 视觉拆出透明（防错位双框/1 节点残留，spec §3/§6）"
```

---

### Task 9: 快捷键面板同步（§5-2）

**Files:**
- Modify: `apps/web/src/pages/canvas/components/KeyboardShortcutsPanel.tsx:111-157`（SECTIONS）
- Test: `apps/web/src/pages/canvas/components/KeyboardShortcutsPanel.test.tsx:22-47`
- Modify: `docs/superpowers/specs/2026-05-28-canvas-keyboard-shortcuts-panel-design.md:57-59,109`

- [ ] **Step 1: 改测试（先红）**

`should render all shortcut entries` 用例（:22-47）中：

```ts
    // Labels that appear in multiple sections
    const trackpadItems = screen.getAllByText('触控板');
    expect(trackpadItems.length).toBe(1); // 仅移动画布（缩放栏"触控板"→"滚动"，spec §5-2）
    const mouseItems = screen.getAllByText('鼠标');
    expect(mouseItems.length).toBe(2); // 缩放 + 移动画布
    // Labels that appear once
    expect(screen.getByText('键盘')).toBeInTheDocument();
    expect(screen.getByText('整理画布')).toBeInTheDocument();
    // 新增（spec §5-2：框选升主路径，面板闭环）
    expect(screen.getByText('滚动')).toBeInTheDocument();
    expect(screen.getByText('框选')).toBeInTheDocument();
    expect(screen.getByText('加选')).toBeInTheDocument();
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /d/flowweb/apps/web && npx vitest run src/pages/canvas/components/KeyboardShortcutsPanel.test.tsx`
Expected: FAIL —— `getAllByText('触控板')` 得 2 ≠ 1；`getByText('滚动')` 找不到。

- [ ] **Step 3: 实现 SECTIONS（KeyboardShortcutsPanel.tsx）**

缩放栏（:127-137）：

```ts
  {
    title: '缩放',
    width: 'md:w-44 lg:w-[200px]',
    items: [
      { label: '放大', keys: ['Ctrl', { icon: 'zoomIn' }] },
      { label: '缩小', keys: ['Ctrl', { icon: 'zoomOut' }] },
      { label: '适应画布', keys: ['Ctrl', '0'] },
      { label: '滚动', keys: [{ icon: 'touchpadZoom' }] },
      { label: '鼠标', keys: ['Ctrl', { icon: 'mouseZoom' }] },
    ],
  },
```

移动画布栏（:138-147）：

```ts
  {
    title: '移动画布',
    width: 'md:w-48 lg:w-[220px]',
    items: [
      { label: '键盘', keys: ['Space', { icon: 'keyboardPan' }] },
      { label: '触控板', keys: ['Space', { icon: 'touchpadPan' }] },
      { label: '鼠标', keys: [{ icon: 'mousePan' }] },
      { label: '整理画布', keys: ['Alt', 'Shift', 'F'] },
    ],
  },
```

创作栏 items 末尾（:125 后）追加两条：

```ts
      { label: '框选', keys: ['左键', '拖动空白'] },
      { label: '加选', keys: ['Shift', '点击'] },
```

**icon 目视义务**：触控板行 icon 引用改为 `touchpadPan`、鼠标行改为 `mousePan`（原 :143-144 交叉错位）——现有 icon 组件命名与视觉语义存在矛盾（spec §5-2 不断言对调），实施后浏览器目视确认；不符则仅调 iconMap 引用不动 label。

- [ ] **Step 4: 运行确认通过**

Run: `cd /d/flowweb/apps/web && npx vitest run src/pages/canvas/components/KeyboardShortcutsPanel.test.tsx`
Expected: PASS 全部。

- [ ] **Step 5: 同步 2026-05-28 spec 数字与表格**

`2026-05-28-canvas-keyboard-shortcuts-panel-design.md` :57-59 表改：

```markdown
| 键盘平移 | Space + 拖动 |
| 触控板平移 | 空格 + 双指拖动（2026-09-28 交互重构：滚轮/双指=缩放） |
| 鼠标平移 | 中键拖动 |
```

:109 `6. 面板包含所有 22 个快捷键条目` → `6. 面板包含所有 23 个快捷键条目（2026-09-28 增框选/加选两条）`。

- [ ] **Step 6: Commit**

```bash
cd /d/flowweb && git add apps/web/src/pages/canvas/components/KeyboardShortcutsPanel.tsx apps/web/src/pages/canvas/components/KeyboardShortcutsPanel.test.tsx docs/superpowers/specs/2026-05-28-canvas-keyboard-shortcuts-panel-design.md && git commit -m "feat(web): 快捷键面板同步——滚动=缩放/空格+双指=平移/中键拖/新增框选加选条目（触控板 1 鼠标 2 计数自洽，spec §5-2）+2026-05-28 spec 数字更新"
```

---

### Task 10: 文档同步义务（§10 收尾）

**Files:**
- Modify: `docs/superpowers/specs/2026-08-24-shift-multiselect-toolbar-suppress.md:51` 后
- Modify: `docs/superpowers/specs/annotation-feature.md:86`

- [ ] **Step 1: 2026-08-24 spec :51 段后追加同步说明**

在 `用户确认的交互语义：……直到普通（无 Shift）单击重新选中才恢复弹出。` 段之后插入：

```markdown
> **2026-09-28 同步**（canvas-pan-select-interaction spec §10）：抑制源从 1 个（lastPointerShiftKey）扩为 2 个并存（+`marqueeSelecting`=框选拖拽进行态），抑制面扩至边 × 删除按钮、组缩放手柄、SelectionBoxOverlay、VideoConfigPanel。两者并存非替代：前者覆盖 Shift+点击加选（pointerdown 级采样），后者覆盖左键框选拖拽；删除任一必回归对应分支的中间态误弹。
```

- [ ] **Step 2: annotation-feature.md :86 锁定口径扩展**

`:86` `- 画布锁定不可平移/缩放（同擦除模式）` 改为：

```markdown
- 画布锁定不可平移/缩放（同擦除模式；锁定口径=节点编辑中**或 transform 旋转/镜像调整中**——2026-09-28 交互重构 spec §3 根因修，与 useGroupKeyboard「模式中」对齐；空格平移旁路已收窄 panActivationKeyCode=null，Ctrl+滚轮缩放旁路登记存在）
```

- [ ] **Step 3: Commit**

```bash
cd /d/flowweb && git add docs/superpowers/specs/2026-08-24-shift-multiselect-toolbar-suppress.md docs/superpowers/specs/annotation-feature.md && git commit -m "docs(web): 同步义务——2026-08-24 抑制源扩展说明+annotation-feature 锁定口径扩 transform（spec §10）"
```

---

## 完成后收尾

1. **全量回归**：`cd /d/flowweb/apps/web && npx vitest run`（全绿）+ `npx tsc --noEmit`（strict 通过——SNAP_GRID tuple 标注的验证点）。
2. **TypeScript 检查**：确认无 TS2322（snapGrid）；`SelectionMode`/`SnapGrid` 自 `@xyflow/react` 导入（spec §3 已核实 react index.d.ts:37 有导出）。
3. **浏览器人工验收**：按 spec §9 全部 27 条逐项执行（重点：§9-3 框选抑制、§9-6 中键罗盘、§9-8 无双倍缩放、§9-12 锁定全关、§9-21 单一框、§9-23 残留窗口口径、§9-27 transform 期四不动）。
4. **验收发现问题的处置**：CSS/手感类直接修；行为与 spec 冲突的回到 spec 层登记（§7 精准修改原则——登记不修清单勿顺手扩）。

## Self-Review 记录（plan 已自审）

- **Spec 覆盖**：§3 核心改动→Task 4；§3 CSS→Task 8；§3 isLocked 双定义→Task 4（3c/3d）；§5-1 全消费点（1→Task 2、2/3/4→Task 5、5/6→Task 6、7 豁免/8 接受不修→无需任务，登记在关键事实）；§5-1 兜底→Task 3；§5-2→Task 9；§5-3→Task 7；§6 库框视觉→Task 8；§8 测试策略→各任务 Step 分布（props 契约 Task 4 / class 断言 Task 4 / guard 用例 Task 3 / 负向护栏 Task 1 / theme-perf Task 4 Step 7 / 面板计数 Task 9 / 守卫用例 Task 7 / afterEach 复位 Task 4）；§9→收尾 3；§10→Task 9 Step 5 + Task 10。
- **占位符**：无 TBD/TODO；两处「按该文件既有方式渲染」的说明（VideoGenNode/ConnectionLine 用例）已给出断言目标与条件矩阵，实施者可从同文件既有用例复制渲染参数。
- **类型一致**：`marqueeSelecting` 布尔字段名全 plan 一致；`PAN_ON_DRAG_MIDDLE`/`SNAP_GRID` 命名与 spec §3 一致；`useMarqueeSelectionGuard` 单一定义。
