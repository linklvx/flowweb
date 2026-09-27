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
- **锁定态三个库级旁路（六修核实）**：①system:2824 的 node/edge 中键特例先于一切判定 → wrapper capture 闸门封死（Task 4 3f）；②删除路径 deleteElements 无任何 lock 闸门（react:1225-1236 直取 selected）→ deleteKeyCode 并入 isLocked（Task 4 3e 首行）——app 层另有 StoryboardGroupRenderer.tsx:17-32 的格子级 Backspace 路径（window capture keydown、无 lock 守卫、删格子对应子节点〔canvasStore.ts:1396-1405 nodes.filter+edges 过滤+nodeStore.deleteNode〕、焦点在输入框时有 :20 守卫；其 window capture stopPropagation 先于 xyflow 的 document 监听→两条 Backspace 路径互斥），与 deleteKeyCode 锁定语义正交，登记不扩 scope（spec §7 同步登记行）；③Ctrl+滚轮缩放旁路（zoomActivationKeyPressed 覆盖 zoomOnScroll=false）→ 登记不修（Task 7 注释明示"与今天行为一致"，防验收误报缺陷）。
- **消费点 8 同格登记（接受不修）**：VideoGenNode.tsx:105-109 的 HD 面板副作用（`!selected || !isSingleSelected || dragging → setHdPanelOpen(false)`）——框选扫过开着的 HD 面板会将其收起（状态复位非闪现，松手不自动恢复）；属选中态驱动既有语义、低频，与 VideoEditNode 停迷你播放同族。ConnectionLine 的选中态视觉三件（边变色加粗 stroke #f59e0b/strokeWidth 3〔:89-90，框选扫过最显眼的 churn〕/isActive 高亮/粒子）按不变式不抑制——框选扫过密集连线区的视觉 churn 属预期，§9-25 验收确认无 jank 异常。
- **订阅税决策**：marqueeSelecting 留 canvasStore（与 lastPointerShiftKey 同处置，spec 已选）；代价补偿=两处裸订阅加输入引用早退（Task 3 Step 8-9）——框选的两次真实翻转不再白排 500ms 全量快照写与 O(n) collab diff。

---

### Task 1: canvasStore 新增 marqueeSelecting 字段 + 白名单负向护栏

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts:98`（interface）、`:173`（初始值）
- Test: `apps/web/src/stores/canvasStore.marqueeSelecting.test.ts`（新建）
- Test: `apps/web/src/pages/canvas/hooks/useCanvasPersistence.test.ts`（快照 JSON 键集合断言，spec §8 负向护栏第二条）

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

- [ ] **Step 2: useCanvasPersistence.test.ts 追加快照 JSON 键集合固定断言（spec §8 负向护栏第二条）**

（原设计在此步给 canvasHistory.test.ts 加 `Object.keys` 断言——与既有 `:11-14` 的 `toEqual` 全字段断言重复，删去不落：toEqual 挡得住新增有值字段（现实回归形态），但忽略 undefined 值键（Vitest 递归相等语义），`Object.keys` 两者都挡——这正是把负向护栏落在快照 JSON 键集合的理由；真正的风险面是 localStorage 快照写出，落在既有先例 :75-78 处。）

在该文件「带组 store 保存」用例的 `const snap = JSON.parse(raw!);`（:77）之后追加一行（同用例内，复用既有 fake timers/renderHook 骨架）：

```ts
    expect(Object.keys(snap)).toEqual(['version', 'nodes', 'edges', 'viewport', 'parentMap']);
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

- [ ] **Step 5: 运行确认通过（含 useCanvasPersistence.test 全绿）**

Run: `cd /d/flowweb/apps/web && npx vitest run src/stores/canvasStore.marqueeSelecting.test.ts src/pages/canvas/hooks/useCanvasPersistence.test.ts`
Expected: PASS 全部（快照键断言在字段落地前即应绿——它守的是快照构造白名单，与本任务新增字段正交，属钉死现状的护栏）。

- [ ] **Step 6: Commit**

```bash
cd /d/flowweb && git add apps/web/src/stores/canvasStore.ts apps/web/src/stores/canvasStore.marqueeSelecting.test.ts apps/web/src/pages/canvas/hooks/useCanvasPersistence.test.ts && git commit -m "feat(web): canvasStore 新增 marqueeSelecting 标志+白名单负向护栏断言（结构投影/快照 JSON 键集合，spec §5-1.4——抑制态不入 undo 栈/持久化）"
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
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx`（挂 handlers + hook + 中键闸门〔Task 4〕）
- Test: `apps/web/src/pages/canvas/components/CanvasView.test.tsx`（mock 加可变变量）
- Test: `apps/web/src/pages/canvas/components/CanvasView.theme-perf.test.tsx:41`（stable 补静态字段）
- Modify: `apps/web/src/pages/canvas/hooks/useCanvasPersistence.ts:116-118`（订阅输入引用早退）
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts:210-214`（同型早退）
- Test（仅回归纳入，不改内容）: `apps/web/src/pages/canvas/hooks/__tests__/useCanvasPersistence.test.ts`（镜像副本——该 hook 的主行为套件：单写者防抖/S1 抑制/恢复派生；其触发全为结构（:105-108）或 nodeStore 路径，早退前后均绿，但订阅契约变更必须回归它）
- Test: `apps/web/src/pages/canvas/hooks/useCanvasPersistence.test.ts`（快照税用例）

- [ ] **Step 1: 写失败测试（useMarqueeSelectionGuard.test.tsx）**

**写法硬约束（jsdom/RTL 实装核实）**：①`fireEvent.window` 不是 RTL API（fireEvent 只为 eventMap 键挂方法）——window 原生事件一律 `window.dispatchEvent(new Event(...))`；②jsdom 25 无 `PointerEvent`——`pointermove` 必须用 `new MouseEvent('pointermove', { buttons: 0 })`（MouseEventInit 含 buttons）；**禁用 `fireEvent.pointerMove` 兜底**（createEvent 对缺失构造器回退 `window.Event`，`{buttons:0}` 被静默丢弃 → `e.buttons === undefined` → 用例假红且红因与守卫实现无关）。

```tsx
// apps/web/src/hooks/useMarqueeSelectionGuard.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useMarqueeSelectionGuard } from './useMarqueeSelectionGuard';
import { useCanvasStore } from '@/stores/canvasStore';

function GuardProbe() {
  useMarqueeSelectionGuard();
  return <div data-testid="guard" />;
}

const setTrue = () =>
  useCanvasStore.setState((s) => (s.marqueeSelecting ? s : { marqueeSelecting: true }));

describe('useMarqueeSelectionGuard（spec §5-1 兜底复位——onSelectionEnd 主通道之外的 4 个 window 通道，标志作用域挂载）', () => {
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
    act(() => { window.dispatchEvent(new Event('pointerup')); });
    expect(useCanvasStore.getState().marqueeSelecting).toBe(false);
  });

  it('主通道 pointercancel 复位', () => {
    render(<GuardProbe />);
    act(() => setTrue());
    act(() => { window.dispatchEvent(new Event('pointercancel')); });
    expect(useCanvasStore.getState().marqueeSelecting).toBe(false);
  });

  it('补充通道 pointermove buttons===0 复位（窗口外释放）', () => {
    render(<GuardProbe />);
    act(() => setTrue());
    act(() => { window.dispatchEvent(new MouseEvent('pointermove', { buttons: 0 })); });
    expect(useCanvasStore.getState().marqueeSelecting).toBe(false);
  });

  it('非左键 pointerup 不复位（框选拖拽中误触右键松开不提前解除抑制）', () => {
    render(<GuardProbe />);
    act(() => setTrue());
    act(() => { window.dispatchEvent(new MouseEvent('pointerup', { button: 2 })); });
    expect(useCanvasStore.getState().marqueeSelecting).toBe(true);
  });

  it('次级通道 blur 复位', () => {
    render(<GuardProbe />);
    act(() => setTrue());
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(useCanvasStore.getState().marqueeSelecting).toBe(false);
  });

  it('卸载兜底：标志 true 时 unmount → 复位 false（拖拽中切路由/错误边界/HMR 不卡死）', () => {
    const { unmount } = render(<GuardProbe />);
    act(() => setTrue());
    unmount();
    expect(useCanvasStore.getState().marqueeSelecting).toBe(false);
  });

  it('标志复位即卸载监听：复位后再派发 pointerup 不触发 setState（标志作用域验证）', () => {
    const spy = vi.spyOn(useCanvasStore, 'setState');
    render(<GuardProbe />);
    act(() => setTrue());
    act(() => { window.dispatchEvent(new Event('pointerup')); });
    spy.mockClear();
    act(() => { window.dispatchEvent(new Event('pointerup')); });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('§5-1.3 复位写法依据（zustand vanilla 语义钉死——guard 与 onSelectionEnd 共用的写法前提）', () => {
  it('函数式同引用不通知、partial 字面量必通知', () => {
    const listener = vi.fn();
    const unsub = useCanvasStore.subscribe(listener);
    useCanvasStore.setState((s) => s);
    expect(listener).not.toHaveBeenCalled();
    useCanvasStore.setState({ marqueeSelecting: false });
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });
});
```

（注：原设计第 5 条「标志 false 时派发 pointerup 断言不通知」是空转断言——标志作用域下 false 时根本没挂监听，字面量实现同样绿，不能钉住函数式写法；真正的判别场景是**幂等复位**（标志已 false 时再复位零通知），该断言在 Task 4 的 interaction-props 测试里由 `onSelectionEnd` 二次驱动覆盖——本文件用上面的 store 级语义断言钉写法依据。）

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
 * 复位通道全景（5 个）：onSelectionEnd（CanvasView 主通道，正常路径）+ 本 hook 的 4 个 window
 * 通道——pointerup（左键，button 过滤——非左键时拖拽未必终止）/pointercancel（触发即拖拽必已
 * 终止）、pointermove(buttons===0)（窗口外释放时
 * 浏览器对 pointerup 派发行为不一）、blur（次级，接受拖拽中 alt-tab 的极小残留窗口）。
 * 标志为 true 期间全部操作浮层被抑制且无自愈——兜底是本设计唯一单点故障面。
 * 标志作用域挂载：非框选期全 app 零常驻开销，卡死时监听恰处激活态。
 * 复位必须函数式返回同引用：对象字面量 partial 永不 Object.is 等于整 state → 必通知全部
 * 裸订阅者（500ms 快照写 / collab O(n) diff 等，每次点击白跑）。
 * cleanup 复位：拖拽中组件卸载（切路由/错误边界/HMR）时标志不得卡 true（幂等——已是 false
 * 时同引用 no-op，早退于真实复位之后执行零副作用）。
 */
export function useMarqueeSelectionGuard() {
  const marqueeSelecting = useCanvasStore((s) => s.marqueeSelecting);
  useEffect(() => {
    if (!marqueeSelecting) return;
    const reset = () => {
      useCanvasStore.setState((s) => (s.marqueeSelecting ? { marqueeSelecting: false } : s));
    };
    const onMove = (e: MouseEvent) => {
      if (e.buttons === 0) reset();
    };
    // pointerup 只认左键（button 0；Event 无 button 字段时放行——jsdom 测试形态）：框选手势是
    // 左键，非左键 pointerup 时拖拽未必终止，提前复位会使剩余拖拽段浮层复现
    const onPointerUp = (e: Event) => {
      const button = (e as PointerEvent).button;
      if (button !== undefined && button !== 0) return;
      reset();
    };
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', reset);
    window.addEventListener('blur', reset);
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', reset);
      window.removeEventListener('blur', reset);
      window.removeEventListener('pointermove', onMove);
      reset();
    };
  }, [marqueeSelecting]);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /d/flowweb/apps/web && npx vitest run src/hooks/useMarqueeSelectionGuard.test.tsx`
Expected: PASS——guard 7 条（含卸载兜底与非左键 pointerup 过滤）+ 语义钉死 1 条。若「卸载兜底」红：cleanup 漏了 `reset()`；若语义钉死红：zustand 行为与预期不符（先停下核查，勿放宽断言）。

- [ ] **Step 5: CanvasView.test.tsx mock 加可变变量（供 Task 5 selectedGroup 用例消费）**

mock 区顶部变量（`let mockLastPointerShiftKey = false;` :15）后加：

```ts
let mockMarqueeSelecting = false;
```

mock state（`lastPointerShiftKey: mockLastPointerShiftKey,` :41）后加：

```ts
        marqueeSelecting: mockMarqueeSelecting,
```

`beforeEach`（:76-82）加 `mockMarqueeSelecting = false;`。

（本步骤**不加用例**：此文件的 canvasStore mock 非响应式，任何"置 true 后断言渲染"都构成空转断言；`onSelectionStart/End` 的接线与幂等断言落在 Task 4 的 interaction-props 测试——那里是真 store 且 props 可直接驱动。本步的 mock 字段非纯装饰——Task 5 Step 1 的 selectedGroup 用例经 `mockMarqueeSelecting` 初始读取 + rerender 消费此字段，勿当冗余删。）

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

- [ ] **Step 8: 订阅税消除——useCanvasPersistence 先写失败测试 + 既有 4 条用例触发契约迁移**

函数式复位只挡住了 no-op 那一半：每次框选标志两次**真实翻转**（true/false）仍通知全部裸订阅者——`useCanvasPersistence.ts:116-118` 裸订阅不过滤字段 → 500ms 去抖后全量 `JSON.stringify(nodeStore.nodes)` + `localStorage.setItem` 各两次（内容逐字节相同）；`canvasCollabRuntime.ts:210-214` 同理每次跑 `pickStructNodes` O(n) 投影 + isEqual 深比较 ×2（结果必为 unchanged）。给两处订阅加**输入引用早退**（快照/diff 的输入只有 nodes/edges/viewport，引用未变则输出必然不变）。

**契约变更登记（本步显式承担）**：早退把写入触发契约从「任意 canvasStore 变更」收窄为「结构变更（nodes/edges/viewport 引用）或 nodeStore 变更」。既有 4 条用例（:52/:72/:113/:142）全用 `setState({ selectedId: 'trigger…' })` 非结构字段当触发器——早退落地后它们必红（快照未写 → 恢复用例 `find(...)!` TypeError / `expect(raw).not.toBeNull()` 红）。本步同批迁移为 viewport 触发（三输入之一、4 条用例均不断言 viewport 内容、触发语义不变）——4 处触发行统一改为：

```ts
    useCanvasStore.setState({ viewport: { x: 1, y: 1, zoom: 1 } });
```

（收益顺带登记，防后人当"为框选特调"而回退：早退同时消灭 nodeProcessMap 生成进度每 tick 抖动〔实锤：updateNodeProcessProgress canvasStore.ts:764-770 只写 nodeProcessMap 不动 nodes/edges/viewport——旧代码下每次进度 tick 都排一次 500ms 全量快照写〕、selectedId/pendingMediaFile 抖动触发的快照写——比框选本身更大的收益面，且全仓除上述 4 条测试外无「任意变更即写」依赖〔__tests__ 镜像副本经逐条核对亦全为结构/nodeStore 触发〕。）

`useCanvasPersistence.test.ts` 追加用例（既有 fake timers + renderHook 先例 :51-77；`act` 若未 import 则补）：

```ts
  it('marqueeSelecting 翻转不触发快照写（订阅输入引用早退，spec §5-1 配套）', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    renderHook(() => useCanvasPersistence('p1'));
    vi.advanceTimersByTime(600); // 排空 mount 期可能挂起的写（防御——当前 beforeEach 播种 nodes 使 hydrate :35 早退、本无挂起；不依赖该前提）
    setItemSpy.mockClear();
    act(() => {
      useCanvasStore.setState({ marqueeSelecting: true });
      useCanvasStore.setState((s) => (s.marqueeSelecting ? { marqueeSelecting: false } : s));
    });
    vi.advanceTimersByTime(600);
    expect(setItemSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });
```

（`Storage.prototype` spy 覆盖 localStorage 实例。本步收尾跑一次该文件：新用例红（早退未实现，翻转通知 → 定时器 → setItem）、被迁移触发行的 4 条既有用例仍绿——早退未实现时 viewport 触发照常调度写。）

- [ ] **Step 9: 实现两处订阅早退**

`useCanvasPersistence.ts` 的 `useCanvasStore.subscribe` 回调（:116-118）改为：

```ts
    const unsub1 = useCanvasStore.subscribe((state, prevState) => {
      // 快照输入只有 nodes/edges/viewport（parentMap 由 canvasStore.nodes 派生）+ isHydrating 参与
      // 调度协议（S1：hydrate 窗口内清挂起定时器 + wasHydrating 过渡不调度）。wasHydrating 过渡分支
      // 的唯可达路径=纯 isHydrating 翻转（unsub2 的 (h,h) 同值组合不产生它；hydrate 前后 setHydrating
      // 不动 nodes/edges/viewport）——早退不比对 isHydrating 则该分支变死代码、S1 失去纯翻转入口。
      // 引用未变则内容必然不变，早退防 UI 态（marqueeSelecting 等）
      // 翻转白排 500ms 全量快照写——顺带消除 nodeProcessMap/selectedId/pendingMediaFile 抖动的同税。
      // 快照的 nodes 内容来自 nodeStore（定时器内现读 :105），由下方 unsub2 独立触发——勿删 unsub2，
      // 否则 nodeStore 变更将永久不落盘。
      if (state.isHydrating === prevState.isHydrating
        && state.nodes === prevState.nodes && state.edges === prevState.edges
        && state.viewport === prevState.viewport) return;
      scheduleWrite(state.isHydrating, prevState.isHydrating);
    });
```

`canvasCollabRuntime.ts` 的 `bindBridge` 内 `unsubCs` 回调（:210-214）在 isHydrating/projectId 守卫后加：

```ts
    const unsubCs = useCanvasStore.subscribe((state, prev) => {
      if (state.isHydrating || prev.isHydrating) return;
      if (state.projectId !== prev.projectId) return;
      // diff 输入只有 nodes/edges——引用未变早退（严格等价：同引用 ⇒ pickStruct 投影输出相同
      // ⇒ isEqual 恒真 ⇒ 原逻辑本就 no-op），防 UI 态翻转白跑 O(n) 投影+深比较
      if (state.nodes === prev.nodes && state.edges === prev.edges) return;
      const changed = ...（原逻辑不变）
```

（collab 侧不新增测试——运行时需 doc/hocuspocus 环境成本不匹配；早退是纯引用守卫，正确性由「diff 输入集合不变 ⇒ 输出不变」保证，且 storeProjection 白名单负向护栏已由 Task 1 覆盖输入端。）

- [ ] **Step 10: 运行确认通过**

Run: `cd /d/flowweb/apps/web && npx vitest run src/pages/canvas/hooks/ src/pages/canvas/components/CanvasView.test.tsx src/pages/canvas/components/CanvasView.theme-perf.test.tsx`
Expected: PASS 全部——目录级运行同时覆盖外层 useCanvasPersistence.test（4 条被迁移触发行的既有用例〔viewport 触发，语义不变〕+ 新增快照税用例）与 __tests__ 镜像副本（主行为套件，早退前后均绿）；theme-perf 的 render 计数断言不受影响（新订阅返回布尔原语，Object.is 稳定）。

- [ ] **Step 11: Commit**

```bash
cd /d/flowweb && git add apps/web/src/hooks/useMarqueeSelectionGuard.ts apps/web/src/hooks/useMarqueeSelectionGuard.test.tsx apps/web/src/pages/canvas/components/CanvasView.tsx apps/web/src/pages/canvas/components/CanvasView.test.tsx apps/web/src/pages/canvas/components/CanvasView.theme-perf.test.tsx apps/web/src/pages/canvas/hooks/useCanvasPersistence.ts apps/web/src/pages/canvas/hooks/useCanvasPersistence.test.ts apps/web/src/stores/canvasCollabRuntime.ts && git commit -m "feat(web): marqueeSelecting 驱动源——onSelectionStart/End 接线+useMarqueeSelectionGuard 兜底（4 window 通道/卸载复位/函数式同引用）+持久化与 collab 订阅输入引用早退（框选不交快照/diff 税，spec §5-1）"
```

---

### Task 4: isLocked 双定义修正 + CanvasView 核心交互 props（主改动）

**Files:**
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx:2`（import）、`:49-62`（模块常量区）、`:108-109`（订阅式 isLocked）、`:299-300`（命令式 isLockedNow）、`:437`（wrapper 中键闸门）、`:461`（deleteKeyCode）、`:466-474`（ReactFlow props 逐行改）
- Test: `apps/web/src/pages/canvas/components/CanvasView.interaction-props.test.tsx`（新建，props 契约断言主防线 + 接线幂等 + 引用稳定）
- Test: `apps/web/src/pages/canvas/components/CanvasView.test.tsx`（派生 class 断言 + transform 锁定 + 中键闸门用例 + afterEach 复位）

- [ ] **Step 1: 新建 CanvasView.interaction-props.test.tsx（写失败断言）**

```tsx
// apps/web/src/pages/canvas/components/CanvasView.interaction-props.test.tsx
// spec §8.1 props 契约断言（主防线）：mock 记录型 ReactFlow 捕获 props，精确值断言覆盖一切误改
// （含 [1,2]——其 class 表现与 [1] 相同，仅 props 断言能兜住）。canvasStore/nodeStore 均为真 store。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { ReactFlowProvider, SelectionMode } from '@xyflow/react';
import { useNodeStore } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';

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

// ReactFlowProvider 防御：mock ReactFlow 不渲染 children，但若将来 mock 策略变化导致 children
// 执行（SelectionBoxOverlay 等 xyflow store 消费者），无 Provider 会抛 zustandErrorMessage——
// 包裹成本为零（CanvasView.test.tsx 同写法）。
function renderCapture() {
  render(
    <ReactFlowProvider>
      <CanvasView projectId="p1" />
    </ReactFlowProvider>
  );
  expect(captured.props).toBeTruthy();
  return captured.props;
}

describe('CanvasView 交互 props 契约（spec §3/§8.1）', () => {
  beforeEach(() => {
    captured.props = null;
    handleMenuSpy.seen = null;
  });
  afterEach(() => {
    // 真 store 防跨用例污染（spec §8.6）
    useNodeStore.setState({ activeEditNodeId: null, activeTransformNodeId: null, referenceSelect: null });
    useCanvasStore.setState((s) => (s.marqueeSelecting ? { marqueeSelecting: false } : s));
  });

  it('非锁定：panOnDrag=[1]/selectionOnDrag/zoomOnScroll/Partial/无 panOnScroll/Space', () => {
    const p = renderCapture();
    expect(p.panOnDrag).toEqual([1]);
    expect(p.selectionOnDrag).toBe(true);
    expect(p.zoomOnScroll).toBe(true);
    expect(p.selectionMode).toBe(SelectionMode.Partial);
    // 代码形态断言（非行为守卫——panOnScroll={false} 行为等价）：钉死"删行"这一 spec §3 可达性
    // 推导的前提，防后人"顺手补全显式 false"
    expect('panOnScroll' in p).toBe(false);
    expect(p.panActivationKeyCode).toBe('Space');
    expect(p.zoomOnDoubleClick).toBe(true);
    expect(p.deleteKeyCode).toEqual(['Backspace', 'Delete']);
  });

  it('锁定（activeEditNodeId）：四 prop 反转 + panActivationKeyCode=null + deleteKeyCode=[]', () => {
    useNodeStore.setState({ activeEditNodeId: 'node-1' });
    const p = renderCapture();
    expect(p.panOnDrag).toBe(false);
    expect(p.selectionOnDrag).toBe(false);
    expect(p.zoomOnScroll).toBe(false);
    expect(p.panActivationKeyCode).toBe(null);
    // 六修：删除路径 deleteElements 无任何 lock 闸门（react:1225-1236 直取 selected）——
    // 不并 isLocked 则编辑/transform 中按 Backspace 删掉正在操作的节点（数据丢失路径）
    expect(p.deleteKeyCode).toEqual([]);
  });

  it('锁定（activeTransformNodeId）：transform 调整中同锁定口径（§3 根因修）', () => {
    useNodeStore.setState({ activeTransformNodeId: 'node-1' });
    const p = renderCapture();
    expect(p.panOnDrag).toBe(false);
    expect(p.selectionOnDrag).toBe(false);
    expect(p.zoomOnScroll).toBe(false);
    expect(p.panActivationKeyCode).toBe(null);
    expect(p.deleteKeyCode).toEqual([]);
  });

  it('参考选择期：panOnDrag=true（D19 保左键平移）', () => {
    useNodeStore.setState({ referenceSelect: { sourceNodeId: 'src-1' } as any });
    const p = renderCapture();
    expect(p.panOnDrag).toBe(true);
  });

  it('onSelectionStart/End 接线与幂等：翻转标志 + 已 false 时复位零通知（spec §8.3/§5-1.3）', () => {
    const p = renderCapture();
    const listener = vi.fn();
    const unsub = useCanvasStore.subscribe(listener);
    act(() => p.onSelectionStart());
    expect(useCanvasStore.getState().marqueeSelecting).toBe(true);
    act(() => p.onSelectionEnd());
    expect(useCanvasStore.getState().marqueeSelecting).toBe(false);
    listener.mockClear();
    act(() => p.onSelectionEnd()); // 已 false → 函数式同引用必须 no-op
    expect(listener).not.toHaveBeenCalled(); // 对象字面量实现下必红（partial 必通知全部裸订阅者）
    unsub();
  });

  it('常量引用稳定：rerender 后 panOnDrag/snapGrid 同引用（hoist 收益的直达断言——toBe 非 toEqual）', () => {
    const { rerender } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const p1 = captured.props;
    // projectId 变化强制穿透 CanvasView 的 memo bail-out（先例 CanvasView.test.tsx:415-419；
    // 同实例 rerender——双 render 双挂载时 captured.props 归属取决于最后重渲染实例，有假绿风险）
    rerender(
      <ReactFlowProvider>
        <CanvasView projectId="p2" />
      </ReactFlowProvider>
    );
    const p2 = captured.props;
    expect(p2).not.toBe(p1);                  // 新鲜度：rerender 未真正重渲染（捕获未换新）时此处红，防假绿
    expect(p2.panOnDrag).toBe(p1.panOnDrag); // 内联 [1] 回归时 toEqual 抓不住、toBe 必红
    expect(p2.snapGrid).toBe(p1.snapGrid);   // ZoomPane update effect / StoreUpdater 不重跑的前提
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
Expected: FAIL —— 非锁定用例：`p.panOnDrag` 实际 `true`（现配置 `panOnDrag={!isLocked}`）≠ `[1]`；`'panOnScroll' in p` 实际 `true`；接线用例：`p.onSelectionStart` 为 `undefined` → `act(() => p.onSelectionStart())` TypeError；锁定用例：`p.deleteKeyCode` 实际 `['Backspace','Delete']` ≠ `[]`。

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

**3e. ReactFlow props 逐行就地改（`:460-474` 区域）——禁止整块替换、禁止重排**：

| 行 | 改前 | 改后 |
|---|---|---|
| :461 | `deleteKeyCode={editorOpen || inRefSelect ? [] : ['Backspace', 'Delete']}` | `deleteKeyCode={isLocked || editorOpen || inRefSelect ? [] : ['Backspace', 'Delete']}`（六修：删除路径无 lock 闸门，react:1225-1236） |
| :466 | `zoomOnScroll={false}` | `zoomOnScroll={!isLocked}` |
| :467 | `panOnScroll={!isLocked}` | **整行删除**（false 即默认值，spec §3） |
| :468 | `panOnDrag={!isLocked}` | `panOnDrag={isLocked ? false : inRefSelect ? true : PAN_ON_DRAG_MIDDLE}` |
| — | （无） | 新增一行：`selectionOnDrag={!isLocked}` |
| — | （无） | 新增一行：`selectionMode={SelectionMode.Partial}` |
| — | （无） | 新增一行：`panActivationKeyCode={isLocked ? null : 'Space'}` |
| :474 | `snapGrid={[20, 20]}` | `snapGrid={SNAP_GRID}` |

**保留不动**（整块替换会静默删掉它们——deleteKeyCode 保护/min/max 缩放限幅等）：`:451 defaultViewport`、`:462 multiSelectionKeyCode="Shift"`、`:463-464 minZoom/maxZoom`、`:465 fitView={false}`、`:469 zoomOnDoubleClick`（值本就不变）、`:470-472 nodesDraggable/nodesFocusable/elementsSelectable`、`:473 snapToGrid`、`:475 noWheelClassName`、`:476-479 proOptions/className/colorMode`。

**3f. 锁定态中键特例闸门（spec §3 六修）**——组件体 handler 区（`onPaneContextMenu` 定义后）加：

```ts
  // 锁定态中键特例闸门（spec §3 六修）：system:2824 的 node/edge 中键放行先于 !panOnDrag/nopan
  // 一切判定（含 :2846 nopan——nopan 对该路径不可达，非可替代修法）；capture 先于 renderer 的
  // d3 冒泡 listener，stopPropagation 使锁定态中键手势无法启动。副作用：事件在 React root capture
  // 内被止后不再到达 root 下任何合成处理器（含 MiniMap/portal 内中键 mousedown）——锁定态中键
  // 本无合法语义，无害。非锁定中键平移（合法路径）不受影响。
  const handleWrapperMouseDownCapture = useCallback((e: React.MouseEvent) => {
    if (isLocked && e.button === 1) e.stopPropagation();
  }, [isLocked]);
```

wrapper div（`:437`）挂：

```tsx
    <div
      ref={reactFlowWrapper}
      className="w-full h-full overflow-hidden"
      onMouseMove={handleMouseMove}
      onMouseDownCapture={handleWrapperMouseDownCapture}
    >
```

（useCallback 对齐文件内 handler 风格〔onMouseMove 先例〕；SyntheticEvent.stopPropagation 会调用原生 stopPropagation——原生事件在 React root 的 capture 阶段被止，不再下潜到 renderer，d3 冒泡 listener 收不到。）

- [ ] **Step 4: 运行 interaction-props 确认通过**

Run: `cd /d/flowweb/apps/web && npx vitest run src/pages/canvas/components/CanvasView.interaction-props.test.tsx`
Expected: PASS 全部 7 条（含接线幂等与引用稳定——后者若红说明常量未真正 hoist 或被内联回归）。

- [ ] **Step 5: CanvasView.test.tsx 加派生 class 断言 + 中键闸门断言（回归护栏性质——非红先行；spec §8.2 定性 class 断言为辅防线，class 由库从 props 派生，主防线已在 Step 1）**

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

  // 靶子用 pane 是有判别力的形态：锁定态 pane 中键走 filter-false 路径（:2862 拒 → d3 不调
  // nopropagation → 无闸门时事件冒泡可达 document → spy 被调 → 红）。节点/边靶子在无闸门时命中
  // :2824 特例 → d3 mousedowned 调 nopropagation（stopImmediatePropagation 含止冒泡）→ document
  // 同样收不到 → spy 断言形态下恒绿（假绿）——勿"加强"成节点靶子（jsdom 无 d3 手势可观测）。
  it('中键闸门：锁定态 wrapper 内 button===1 mousedown 不冒泡到 document（spec §3 六修）', () => {
    useNodeStore.setState({ activeEditNodeId: 'node-1' });
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const pane = container.querySelector('.react-flow__pane')!;
    const spy = vi.fn();
    document.addEventListener('mousedown', spy); // 冒泡终点——闸门生效则收不到
    fireEvent.mouseDown(pane, { button: 1 });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.mouseDown(pane, { button: 0 }); // 左键不受闸门影响（对照）
    expect(spy).toHaveBeenCalledTimes(1);
    document.removeEventListener('mousedown', spy);
  });
```

import 区补 `useNodeStore`：

```ts
import { useNodeStore } from '@/stores/nodeStore';
```

（若文件已 import 则跳过；该文件此前未 mock nodeStore，即真 store。）

- [ ] **Step 6: 运行 CanvasView.test 全量确认通过**

Run: `cd /d/flowweb/apps/web && npx vitest run src/pages/canvas/components/CanvasView.test.tsx`
Expected: PASS 全部。既有 4 条 wheel 用例（L117-160）断言的是 app 层 `mockZoomIn/mockZoomOut`（本任务不动 wheel effect，Task 7 才改）——**若它们转红即视为误改**，排查点：是否误删/误改 `zoomOnDoubleClick`、`defaultViewport`、`deleteKeyCode`（对照 3e 的"保留不动"清单）。新增 5 条（4 class + 1 中键闸门）PASS。

- [ ] **Step 7: 运行 theme-perf 确认仍绿（回归护栏——hoist 收益的直达断言已在 Step 1 引用稳定用例，此文件 mock 的 setState 是 vi.fn、写库不可观测，挂不住动机断言）**

Run: `cd /d/flowweb/apps/web && npx vitest run src/pages/canvas/components/CanvasView.theme-perf.test.tsx`
Expected: PASS（render 计数断言不受影响）。

- [ ] **Step 8: Commit**

```bash
cd /d/flowweb && git add apps/web/src/pages/canvas/components/CanvasView.tsx apps/web/src/pages/canvas/components/CanvasView.interaction-props.test.tsx apps/web/src/pages/canvas/components/CanvasView.test.tsx && git commit -m "feat(web): 画布交互核心重配——panOnDrag=[1] 中键/空格平移+selectionOnDrag 左键框选 Partial+滚轮缩放+删 panOnScroll；isLocked 双定义并入 activeTransformNodeId+deleteKeyCode 同批（删除路径无 lock 闸门，spec §3 根因修+六修）；锁定态中键特例 wrapper 闸门（system:2824 先于一切判定）；SNAP_GRID/PAN_ON_DRAG_MIDDLE 常量 hoist+引用稳定断言"
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

该文件既有 `renderNode(selected)` 辅助（:147-148，`baseNodeProps` 默认 fileId=undefined/trimMode=false——:243-245「should show config panel when selected」即对照先例）、VideoConfigPanel mock 输出文本 `config panel`（:119-121）、afterEach 复位区（:128-131——已有复位其它 mock 变量的习惯）。`afterEach` 加 `mockMarqueeSelecting = false;`，`describe` 末尾追加：

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
  });
```

（`mockMarqueeSelecting = false;` 复位一行放该文件既有 `beforeEach`（:61 区，改为无条件 `mockMarqueeSelecting = false;`）——用例体末尾复位在断言失败时会污染后续用例；两处用例内的中间复位〔true→false 切换验证〕保留。）

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
Expected: FAIL —— 第一条：`expect(mockZoomOut).not.toHaveBeenCalled()` 红（`new WheelEvent` 的 deltaY 默认 0 → 现状 effect `e.deltaY < 0` 为假走 else 分支调 `zoomOut({duration:100})`；`defaultPrevented` 断言本就绿——现状 document 级守卫已无条件 preventDefault）；第三条：`expect(e.defaultPrevented).toBe(false)` 红（现状守卫挂 document，画布外也 preventDefault）。

- [ ] **Step 3: 实现 effect 改写（CanvasView.tsx :360-374 整段替换）**

```ts
  // Ctrl/Cmd+wheel 守卫（spec §5-3）：缩放步进已删——xyflow 内建 Ctrl 缩放是唯一 writer（双 writer
  // 双倍缩放从根消除）。守卫真实价值=①覆盖 #node-toolbar-portal（.react-flow 兄弟节点，d3 wheel
  // 挂 renderer 上不可见）②防御性兜底；范围收窄到画布内（wrapper 外恢复浏览器整页缩放）。
  // preventDefault 不阻断 d3（d3 不查 defaultPrevented），守卫不损伤库内缩放。
  // 锁定态口径：删除原 if (isLocked) return 后，锁定态 Ctrl+滚轮=仅 d3 旁路一次缩放
  // （zoomScroll = zoomActivationKeyPressed || zoomOnScroll 覆盖 false，§7 登记旁路）——
  // 与今天锁定态行为一致（今天 d3 一次 + JS 步进被 isLocked 挡 = 一次），非缺陷、无回归。
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

`:225-229` 组合选择器拆开（`.react-flow__nodesselection-rect` 从组合中移除、**并入 :220 既有同选择器规则一并写显式透明**——同一元素不留两条规则；`.react-flow__selection` 保留——框选拖拽中的虚线反馈）：

```css
/* 多选视觉由自定义 SelectionBoxOverlay 渲染；内置 selection rect 仅保留拖拽交互层。
 * 库框视觉移除（spec §6）：rect 是 div 渲染、fill/stroke 是 no-op、background/border 才真可见
 * （原组合钉值使库框与 app 框形成错位双虚线框，且框选恰 1 节点时只留库框并持续到下次点击）；
 * 拖拽交互层是 div 本身（position:absolute/pointer-events:all 挂其上），透明不影响从已选区拖动选中集 */
.react-flow__nodesselection-rect {
  fill: transparent; stroke: transparent;
  background: transparent; border: none;
}

/* selection 钉值两档裁定（D2 定案——撤钉实验取消，xyflow 12.10.2 dist/style.css :39-40/:85-86 实测）：
 * 浅档=light 皮肤默认值（rgba(0,89,220,0.08/0.8) 与钉值逐字节重合，浅档冗余）；wrapper colorMode={mode}
 * 后深档承重——dark 皮肤默认是另一组 rgba(200,200,220,0.08/0.8) 浅灰蓝，无此钉值即被改写（A2 修复 Step2 实测冻结）。 */
.react-flow__selection {
  background: rgba(0, 89, 220, 0.08);
  border: 1px dotted rgba(0, 89, 220, 0.8);
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

**label 精确串**：缩放栏新 label 就取 `'滚动'` 两个字——spec §5-2 写的"滚动（滚轮·双指）"是注解不入 label；测试 `getByText('滚动')` 默认精确匹配，label 写全括号必红。

**icon 引用**：触控板行改 `touchpadPan`、鼠标行改 `mousePan`（原 :143-144 交叉错位）。iconMap 处加一行注释记录实情（非"回退方案"——对调方向经图标实装核定为唯一正确解：`MousePanIcon`（:89-99）画的是**手形**+四向箭头=中键拖动语义，`TouchpadPanIcon`（:68-87）画触控板+双指+四向箭头）：

```ts
  touchpadPan: <TouchpadPanIcon />,
  mousePan: <MousePanIcon />, // MousePanIcon 实际画手形拖动（非鼠标图形）——命名遗留，勿据名回改
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /d/flowweb/apps/web && npx vitest run src/pages/canvas/components/KeyboardShortcutsPanel.test.tsx`
Expected: PASS 全部。

- [ ] **Step 5: 同步 2026-05-28 spec 与 plan 双文档**

`2026-05-28-canvas-keyboard-shortcuts-panel-design.md` :57-59 表改：

同文件缩放表 :51 `| 触控板缩放 | 双指捏合 |` 改 `| 触控板缩放 | 双指滚动/捏合 |`（滚轮语义变化后双指滚动也=缩放，与 :57-59 同批清零）。

```markdown
| 键盘平移 | Space + 拖动 |
| 触控板平移 | 空格 + 双指拖动（2026-09-28 交互重构：滚轮/双指=缩放） |
| 鼠标平移 | 中键拖动 |
```

:109 `6. 面板包含所有 22 个快捷键条目` → `6. 面板包含所有 23 个快捷键条目（2026-09-28 交互重构：框选/加选入面板；旧文 22 与实装本不符，按实装核对 21+2=23）`。

**同源 plan 文件一并同步**（同表逐字重复，不同步则结构性残留）：`docs/superpowers/plans/2026-05-28-canvas-keyboard-shortcuts-panel.md`——:238 `触控板 ['双指捏合']` → `滚动 ['滚轮·双指']`、:246 `触控板 ['双指拖动']` → `触控板 ['空格', '双指拖动']`、:247 不变、:136 测试名 `should render all 22 shortcut entries` → `23`。

**spec §5-2 栏位回填**：本 plan 定框选/加选两条放"创作"栏末尾（画布操作族；spec §5-2 未指定栏位，此处回填决定）——在 spec §5-2"新增'框选/多选'条目"句后补 `（放"创作"栏末尾，2026-09-28 plan 落位）`。

- [ ] **Step 6: Commit**

```bash
cd /d/flowweb && git add apps/web/src/pages/canvas/components/KeyboardShortcutsPanel.tsx apps/web/src/pages/canvas/components/KeyboardShortcutsPanel.test.tsx docs/superpowers/specs/2026-09-28-canvas-pan-select-interaction-design.md docs/superpowers/specs/2026-05-28-canvas-keyboard-shortcuts-panel-design.md docs/superpowers/plans/2026-05-28-canvas-keyboard-shortcuts-panel.md && git commit -m "feat(web): 快捷键面板同步——滚动=缩放/空格+双指=平移/中键拖/新增框选加选条目（触控板 1 鼠标 2 计数自洽，spec §5-2）+spec §5-2 栏位回填（框选/加选落创作栏，2026-09-28 spec 同 commit）+2026-05-28 spec/plan 双文档数字与表格更新"
```

---

### Task 10: 文档同步义务（§10 收尾）

**Files:**
- Modify: `docs/superpowers/specs/2026-08-24-shift-multiselect-toolbar-suppress.md:51` 后
- Modify: `docs/superpowers/specs/annotation-feature.md:86`、`:127`
- Modify: `docs/superpowers/specs/2026-09-26-image-node-panel-redesign.md:103`
- Modify: `apps/web/src/collab/awareness.ts:43`（死代码禁令注释，一行）

- [ ] **Step 1: 2026-08-24 spec :51 段后追加同步说明**

在 `用户确认的交互语义：……直到普通（无 Shift）单击重新选中才恢复弹出。` 段之后插入：

```markdown
> **2026-09-28 同步**（canvas-pan-select-interaction spec §10）：抑制源从 1 个（lastPointerShiftKey）扩为 2 个并存（+`marqueeSelecting`=框选拖拽进行态），抑制面扩至边 × 删除按钮、组缩放手柄、SelectionBoxOverlay、VideoConfigPanel。两者并存非替代：前者覆盖 Shift+点击加选（pointerdown 级采样），后者覆盖左键框选拖拽；删除任一必回归对应分支的中间态误弹。
```

- [ ] **Step 2: annotation-feature.md :86 锁定口径扩展**

`:86` `- 画布锁定不可平移/缩放（同擦除模式）` 改为：

```markdown
- 画布锁定不可平移/缩放（同擦除模式；锁定口径=节点编辑中**或 transform 旋转/镜像调整中**——2026-09-28 交互重构 spec §3 根因修，与 useGroupKeyboard「模式中」对齐；空格平移旁路已收窄 panActivationKeyCode=null，节点/边内部中键拖由 wrapper 闸门封死〔六修〕，Ctrl+滚轮缩放旁路登记存在）
```

- [ ] **Step 3: annotation-feature.md:127 触控阻断句更新**

`:127` `- **触控事件阻断：** 标注 Canvas 阻止 touchstart/touchmove 事件冒泡，避免触发画布原生平移/缩放手势` 句尾改为 `……避免触发画布原生平移/缩放/框选手势（2026-09-28 交互重构后空白拖=框选）`。

- [ ] **Step 4: 2026-09-26-image-node-panel-redesign.md :35 与 :103 两处 isLocked 口径同步**

`:103` `4. \`isLocked\` → 返回（不绕过锁定语义）；` 行后括注补 `（2026-09-28 起锁定口径扩为"编辑中或 transform 调整中"）`。

`:35` 同文件 §2 现状清单里的 `isLocked = activeEditNodeId !== null（L103）` 同批括注 `（2026-09-28 起口径扩为"编辑中或 transform 调整中"，实现现 L109）`——同文件两处旧口径一次清零，防半新半旧。

- [ ] **Step 5: awareness.ts setSelection 死代码加禁令注释（防未来坑）**

`apps/web/src/collab/awareness.ts:43` 的 `setSelection(nodeIds: string[]): void {` 上加一行注释：

```ts
  // ⚠️ 当前无生产调用方（仅测试）。勿接到画布选中态——框选逐帧改 selected 会使每次相交变化
  // 变成 WS awareness 写（2026-09-28 交互重构 spec 登记）。
```

- [ ] **Step 6: Commit**

```bash
cd /d/flowweb && git add docs/superpowers/specs/2026-08-24-shift-multiselect-toolbar-suppress.md docs/superpowers/specs/annotation-feature.md docs/superpowers/specs/2026-09-26-image-node-panel-redesign.md apps/web/src/collab/awareness.ts && git commit -m "docs(web): 同步义务——2026-08-24 抑制源扩展说明+annotation-feature 锁定口径扩 transform/触控阻断句+2026-09-26 isLocked 口径括注+awareness setSelection 死代码禁令注释（spec §10）"
```

---

## 完成后收尾

1. **全量回归**：`cd /d/flowweb/apps/web && npx vitest run`（全绿）+ `npx tsc --noEmit`（strict 通过——SNAP_GRID tuple 标注与 fireEvent/window 派发的验证点）。
2. **TypeScript 检查**：确认无 TS2322（snapGrid）；`SelectionMode`/`SnapGrid` 自 `@xyflow/react` 导入（spec §3 已核实 react index.d.ts:37 有导出）。
3. **浏览器人工验收**：按 spec §9 全部 27 条逐项执行（重点：§9-3 框选抑制、§9-6 中键罗盘、§9-8 无双倍缩放、§9-12 锁定全关〔含节点上中键拖不平移——六修闸门、Ctrl+滚轮旁路为登记非缺陷〕、§9-21 单一框、§9-23 残留窗口口径、§9-27 transform 期四不动）。
4. **验收发现问题的处置**：CSS/手感类直接修；行为与 spec 冲突的回到 spec 层登记（§7 精准修改原则——登记不修清单勿顺手扩）。
5. **目标→手测项对照（自动化锚点之外的必测项，防"真没测"被误当"漏测"）**：jsdom 不能合成 d3 手势，以下只活在线下验收——中键真平移（§9-6）/空格+左键真平移（§9-7）/滚轮真缩放与手感（§9-8、§9-15——**macOS 口径：xyflow 对 `event.ctrlKey && isMacOs()` 的 wheel delta ×10〔system:2685-2688〕，删自定义步进后 Mac 上 Ctrl+滚轮/捏合是 10× 步进、Win/Linux 与裸滚轮同阶，Mac 手感需单独过）/框选相交即选真节点（§9-1）/框选松手从已选区拖动选中集（§9-19）。

## Self-Review 记录（plan 已自审 + 第六轮三份外审 20 项修订）

- **Spec 覆盖**：§3 核心改动→Task 4（3a-3f，含六修中键闸门）；§3 CSS→Task 8；§3 isLocked 双定义→Task 4（3c/3d）；§5-1 全消费点（1→Task 2、2/3/4→Task 5、5/6→Task 6、7 豁免/8 同格登记〔含 HD 面板效应〕→关键事实区）；§5-1 兜底→Task 3（4 window 通道+卸载复位）；§5-1.3 订阅税→Task 3 Step 8-9；§5-2→Task 9；§5-3→Task 7；§6 库框视觉→Task 8；§8 测试策略→props 契约+接线幂等+引用稳定 Task 4 / class+中键闸门 Task 4 Step 5 / guard 用例 Task 3 / 负向护栏（投影键集合 Task 1 + 快照键集合 Task 1 Step 2）/ 面板计数 Task 9 / 守卫用例 Task 7 / afterEach 复位 Task 4；§9→收尾 3；§10→Task 9 Step 5 + Task 10。
- **第六轮修订摘要**（全部经实装核实后采纳）：fireEvent.window→window.dispatchEvent（RTL 无 window 键）；PointerEvent→MouseEvent 主写法+禁 fireEvent.pointerMove（构造器回退丢 buttons 的静默陷阱）；删两条空转断言（guard #5 换 store 级语义钉死、CanvasView 接线空用例删）→接线+幂等断言上移 interaction-props（act 驱动捕获 props）；3e 改逐行 diff 表+保留不动清单（防整块替换静默删 prop）；deleteKeyCode 并入 isLocked（react:1225-1236 删除路径无 lock 闸门，实锤数据丢失路径）；中键特例 wrapper 闸门（system:2824 先于一切判定，spec 六修同步）；guard cleanup 加 reset()（卸载不卡 true）；SNAP_GRID hoist 验证从 theme-perf（mock setState 不可观测）改引用稳定 toBe 断言；订阅输入引用早退×2（快照/diff 税）；负向断言去重（canvasHistory.test 重复项删，快照键断言落 useCanvasPersistence.test 先例处）；CSS 同选择器合一；面板 label 精确串/icon 注释/双文档同步/23 措辞；2026-05-28 plan 文件入 stage；annotation:127+2026-09-26:103+awareness 死代码禁令补入 Task 10；复位移 beforeEach/afterEach；Task 7 锁定态 Ctrl+滚轮口径注释；收尾加目标→手测项清单与 macOS ×10 口径。
- **第七轮修订摘要**（三份报告，实装核实后采纳 14 项）：订阅早退 P0——useCanvasPersistence 既有 4 用例触发行（:52/:72/:113/:142 selectedId poke）同批迁移 viewport 触发+契约变更登记（早退否则必红：恢复用例 TypeError/`not.toBeNull()` 红，Step 8 收尾跑一次钉"新红旧绿"、Step 10 预期同步改）；unsub1 守卫补 isHydrating 子句（S1 清定时器与 wasHydrating 分支的唯可达路径=纯 isHydrating 翻转，不补则死代码）+注释升级（快照 nodes 实来自 nodeStore 的 unsub2 勿删/收益点名 nodeProcessMap·selectedId·pendingMediaFile 抖动/collab 侧严格等价）；快照税用例加 mount 后排空行（防御性——当前 beforeEach 播种 nodes 使 hydrate :35 早退本无挂起，不依赖该前提）；引用稳定用例改同实例 rerender+`not.toBe(p1)` 新鲜度断言（照 CanvasView.test.tsx:415-419 先例，消双挂载归属歧义）；闸门 useCallback 化+注释补副作用（root capture 内止住波及 MiniMap/portal 合成处理器，无害）与 nopan 不可替代论证（顺带修 plan 内 tsx 注释行 `\` 笔误）；中键闸门用例加靶子判别力注释（pane=filter-false 路径有判别力；节点靶子无闸门时 d3 nopropagation 止冒泡→spy 形态假绿，勿加强）；guard pointerup 补非左键过滤（框选手势是左键，非左键 pointerup 拖拽未必终止；`button !== undefined && !== 0` 拦截、Event 无 button 放行兼容 jsdom）+新用例（Step 4 预期 6→7 条）；Task 7 Step 2 红因修正（WheelEvent deltaY 默认 0→现状走 zoomOut 分支，先红的是 mockZoomOut 非 mockZoomIn；第三条画布外 defaultPrevented 同红）；Task 9 git add 补 2026-09-28 spec（§5-2 栏位回填不入工作区）；2026-09-26 spec :35 半新半旧口径同批括注；ConnectionLine 边变色加粗（:89-90）补 any-selection 视觉登记；StoryboardGroupRenderer.tsx:17-32 格子级 Backspace 正交登记（spec §7 加行）；Task 1 Step 2 toEqual 论证修正（忽略 undefined 键）。
- **第八轮修订摘要**（三份报告，采纳 10 项）：**驳回④事实修正（认领）**——`hooks/__tests__/useCanvasPersistence.test.ts` 实为 `apps/web/src/pages/canvas/hooks/__tests__/useCanvasPersistence.test.ts`，七修 Glob 误用报告原文的相对路径（漏 pages/canvas 段）致判"不存在"；该镜像副本是该 hook 主行为套件（单写者防抖/S1 抑制/恢复派生），逐条核对其触发全为结构（:105-108）或 nodeStore 路径（:128/:135/:143/:145）→ 早退+isHydrating 子句前后均绿，仅需纳入回归：Task 3 Files 补条目 + Step 10 命令扩目录级 `src/pages/canvas/hooks/`；spec 四处 plan↔spec 冲突直接清零（开工前 spec 自洽，不走 Task 9 Step 5 回填——:178 label 精确串 '滚动' 注解不入 label、:181 icon 对调方向实装核定唯一正确+iconMap 勿据名回改、:248 幂等零通知断言改由 interaction-props onSelectionEnd 二次驱动+store 级语义钉死承担〔原"window pointerup 不通知"形态标志作用域下不可达必假绿〕、:250 hoist 直达断言=rerender toBe 同引用〔theme-perf mock setState 不可观测〕）；spec §5-1.3 补契约收窄句（任意变更→结构变更或 nodeStore 变更，纯 isHydrating 放行保 S1）；spec §7 补 awareness setSelection 死代码登记行（Task 10 Step 5 禁令注释的出处，闭环"登记有出处"）；StoryboardGroupRenderer 措辞修正——删的是格子对应子节点（canvasStore.ts:1396-1405 nodes.filter+edges 过滤+nodeStore.deleteNode）非"格子内容"，补互斥论证（window capture stopPropagation 先于 xyflow document 监听→两条 Backspace 路径互斥）；Step 9 注释 F2 收窄（wasHydrating 过渡分支才是唯纯翻转可达——S1 分支另有 unsub2 (true,true) 入口，"两分支死代码"过严）；Step 8 收益升格实锤+行号（updateNodeProcessProgress canvasStore.ts:764-770 只写 nodeProcessMap）；Task 9 Step 5 补 2026-05-28 :51（触控板缩放行"双指滚动/捏合"，与 :57-59 同批）。
- **驳回的审核建议**（理由存档）：bash 命令保持 `/d/flowweb` 形态——本环境 shell 是 git-bash（非 PowerShell），现形式可直接执行；Playwright 手势 spec 维持 spec §7 否决（门禁 build+preview 成本判断仍成立，27 条人工验收已覆盖）；marqueeSelecting 拆独立 UI store 维持 spec 已选（与 lastPointerShiftKey 同处置，税已由早退消除）；面板"总数===23"断言不加（SECTIONS 非导出、无可靠 DOM 锚点，脆断言不值）；「interaction-props 渲染即抛 zustandErrorMessage」的定性不成立（SelectionBoxOverlay 是 ReactFlow children 而非兄弟，mock ReactFlow 不渲染 children 则不执行——但 Provider 已防御性加入）。第七轮追加驳回：①报告二 S3「spec 三处口径未同步」不成立——六修已同步 §3/§3.1/§4/§6/§9-12/§9-27（该报告引用的原文与行号 :188 均为五修版，现 :196 已是闸门因果），仅采其残留风险节的 §9-12 锁定态罗盘目视句；②报告三「中键闸门用例加强为节点靶子」会引入假绿——无闸门时锁定态节点中键命中 system:2824 特例→d3 mousedowned 调 nopropagation（stopImmediatePropagation 含止冒泡）→document spy 同样收不到→用例恒绿；pane 靶子（:2862 filter-false→d3 不止冒泡→无闸门时 spy 被调→红）才有判别力，已加注释防后人误加强；③「nodeStore 原地改写理论收窄写入 spec §7」不加——canvasStore 无原地突变已核实、nodeStore 原地改不 setState 本身是 zustand 反模式，不为反模式理论场景加登记（简洁优先）；④报告三所引对照文件 `hooks/__tests__/useCanvasPersistence.test.ts` **——第八轮修正：该判断有误**。七修核实时误用报告原文相对路径（漏 `pages/canvas` 段）致 Glob 无匹配；实际文件为 `apps/web/src/pages/canvas/hooks/__tests__/useCanvasPersistence.test.ts`（150 行，存在）。结论侥幸不受影响：逐条核对该副本写入触发全为结构（:105-108 `setState({edges, viewport})`）或 nodeStore 路径（:128/:135/:143/:145 经 unsub2），早退+isHydrating 子句前后均绿；已纳入 Task 3 Files 与 Step 10 目录级回归（教训存档：全仓存在 __tests__ 镜像目录，Glob 判"文件不存在"前必须用完整路径模式复核）。第八轮追加驳回：⑤「快照税用例迁 __tests__ 副本（v2Writes helper 更严+免排空）」——"更严"不成立且方向相反：外层 `vi.spyOn(Storage.prototype, 'setItem')` + `not.toHaveBeenCalled()` 断言**任何** setItem 都违规，v2Writes 只统计目标 key 的写（其它 key 的写不算）；外层又与 Task 1 Step 2 快照键断言同文件聚集（持久化负向护栏集中一处）、排空行成本已付——维持外层落点，__tests__ 副本仅纳入回归；⑥「Task 1 Step 5 运行清单也带 __tests__ 副本（锁现状）」——Task 1 与该文件无涉（键断言落外层先例处），契约变更点在 Task 3、回归已由 Step 10 目录级覆盖，不扩（精准修改）。
- **占位符**：无 TBD/TODO。
- **类型一致**：`marqueeSelecting` 布尔字段名全 plan 一致；`PAN_ON_DRAG_MIDDLE`/`SNAP_GRID` 命名与 spec §3 一致；`useMarqueeSelectionGuard` 单一定义。
