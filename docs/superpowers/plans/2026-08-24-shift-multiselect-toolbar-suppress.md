# Shift 多选抑制节点悬浮工具条 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shift+左键多选操作期间及之后（重新普通单击前），所有节点悬浮工具条与 GroupToolbar 不弹出。

**Architecture:** canvasStore 新增 `lastPointerShiftKey` 持久标志（最近一次画布内主键 pointerdown 的 shiftKey）；新 hook `useTrackCanvasPointerShift` 以 capture 阶段监听 wrapper 采样标志；`useIsSingleSelected` 与 CanvasView 的 `selectedGroup` 融合该标志实现抑制。Spec: docs/superpowers/specs/2026-08-24-shift-multiselect-toolbar-suppress.md（v3）。

**Tech Stack:** React 18 + @xyflow/react v12 + zustand + Vitest + @testing-library/react（jsdom）

---

## 文件结构

| 文件 | 动作 | 职责 |
|------|------|------|
| `apps/web/src/stores/canvasStore.ts` | Modify | State 接口 + 初始 state 加 `lastPointerShiftKey` |
| `apps/web/src/hooks/useIsSingleSelected.ts` | Modify | 融合 flag 到单选判定 |
| `apps/web/src/hooks/useIsSingleSelected.test.tsx` | Modify | mock 工厂补导出 + 3 个新用例（真实 canvasStore） |
| `apps/web/src/hooks/useTrackCanvasPointerShift.ts` | Create | pointerdown 采样 hook |
| `apps/web/src/hooks/useTrackCanvasPointerShift.test.tsx` | Create | hook 单测（7 用例） |
| `apps/web/src/pages/canvas/components/CanvasView.tsx` | Modify | 挂 hook + selectedGroup 融合 |
| `apps/web/src/pages/canvas/components/CanvasView.test.tsx` | Modify | mock 扩展 + GroupToolbar stub + 4 个新用例 |
| `apps/web/src/pages/canvas/components/CanvasToolbar.tsx` | Modify | 根 div 加 `id="canvas-toolbar"`（1 行） |
| `apps/web/src/pages/canvas/components/nodes/ImageGenNode.test.tsx` | Modify | canvasStore mock 补字段 + 3 个接线回归用例 |

测试环境关键约束：

- jsdom 无 `PointerEvent` 构造器 → 用 `new MouseEvent('pointerdown', {...})` dispatch（addEventListener 只匹配 type 字符串，shiftKey/button 属性 MouseEvent 均有）。
- `useIsSingleSelected.test.tsx` 现有 `vi.mock('@xyflow/react', () => ({ useStore }))` 工厂缺 `applyNodeChanges/applyEdgeChanges` 导出，而 canvasStore.ts:4 运行时引用它们 → 必须补全，否则 Vitest 报 "No export is defined on the mock"。
- 「flag true→false 恢复」用例需要 zustand 真实订阅触发重渲染（二轮评审 P1 的核心语义）→ 该文件用**真实 canvasStore**（canvasStore.test.ts 已证明 canvasStore 可在 Vitest 直接 import，无循环依赖问题）。
- `GroupToolbar.tsx:30-32` 在 jsdom 下因 `measured` 缺失 w=0 return null → CanvasView 测试中 mock 为 stub，只断言 selectedGroup 计算结果。

---

### Task 1: canvasStore 状态 + useIsSingleSelected 融合

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts`（CanvasState 接口 ~83-87 行；create 初始 state ~156 行）
- Modify: `apps/web/src/hooks/useIsSingleSelected.ts`
- Test: `apps/web/src/hooks/useIsSingleSelected.test.tsx`

- [ ] **Step 1: 写失败测试**

`useIsSingleSelected.test.tsx` 全量替换为（保留现有 4 用例 + mock 工厂补导出 + 真实 canvasStore + 3 新用例）：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import * as react from 'react';

const rf = vi.hoisted(() => {
  let nodes: any[] = [];
  const listeners = new Set<() => void>();
  return {
    setNodes: (n: any[]) => { nodes = n; listeners.forEach((l) => l()); },
    useStore: (selector: any) =>
      react.useSyncExternalStore(
        (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb); },
        () => selector({ nodes }),
      ),
  };
});

// canvasStore.ts:4 运行时 import applyNodeChanges/applyEdgeChanges，mock 工厂必须补导出
vi.mock('@xyflow/react', () => ({
  useStore: rf.useStore,
  applyNodeChanges: vi.fn(),
  applyEdgeChanges: vi.fn(),
}));

import { useIsSingleSelected } from './useIsSingleSelected';
import { useCanvasStore } from '@/stores/canvasStore';

function Probe({ selected }: { selected: boolean }) {
  const single = useIsSingleSelected(selected);
  return <div data-testid="probe">{single ? 'single' : 'multi'}</div>;
}

describe('useIsSingleSelected', () => {
  beforeEach(() => {
    useCanvasStore.setState({ lastPointerShiftKey: false });
  });

  it('单选时为 true', () => {
    rf.setNodes([{ id: 'a', selected: true }]);
    render(<Probe selected />);
    expect(screen.getByTestId('probe').textContent).toBe('single');
  });

  it('Bug A 残留时序：先选中 A（count=1）再加选 B → A 的单选态消失', () => {
    rf.setNodes([{ id: 'a', selected: true }]);
    render(<Probe selected />);
    expect(screen.getByTestId('probe').textContent).toBe('single');
    act(() => { rf.setNodes([{ id: 'a', selected: true }, { id: 'b', selected: true }]); });
    expect(screen.getByTestId('probe').textContent).toBe('multi');
  });

  it('减选回单选恢复 true', () => {
    rf.setNodes([{ id: 'a', selected: true }, { id: 'b', selected: true }]);
    render(<Probe selected />);
    act(() => { rf.setNodes([{ id: 'a', selected: true }, { id: 'b', selected: false }]); });
    expect(screen.getByTestId('probe').textContent).toBe('single');
  });

  it('节点自身未选中恒为 false', () => {
    rf.setNodes([{ id: 'a', selected: false }]);
    render(<Probe selected={false} />);
    expect(screen.getByTestId('probe').textContent).toBe('multi');
  });

  it('Shift 多选抑制：flag=true 时单选也返回 false', () => {
    useCanvasStore.setState({ lastPointerShiftKey: true });
    rf.setNodes([{ id: 'a', selected: true }]);
    render(<Probe selected />);
    expect(screen.getByTestId('probe').textContent).toBe('multi');
  });

  it('边界：count=0 + flag=true 为 false', () => {
    useCanvasStore.setState({ lastPointerShiftKey: true });
    rf.setNodes([]);
    render(<Probe selected />);
    expect(screen.getByTestId('probe').textContent).toBe('multi');
  });

  it('恢复路径：flag true→false 且选中数不变时恢复 true（依赖 flag 订阅触发重渲染）', () => {
    useCanvasStore.setState({ lastPointerShiftKey: true });
    rf.setNodes([{ id: 'a', selected: true }]);
    render(<Probe selected />);
    expect(screen.getByTestId('probe').textContent).toBe('multi');
    act(() => { useCanvasStore.setState({ lastPointerShiftKey: false }); });
    expect(screen.getByTestId('probe').textContent).toBe('single');
  });
});
```

- [ ] **Step 2: 运行确认失败（红）**

```bash
cd D:/flowweb/apps/web && npx vitest run src/hooks/useIsSingleSelected.test.tsx
```

预期：新增 3 用例中「Shift 多选抑制」「恢复路径」FAIL（hook 未读 flag）；注意运行时 zustand `setState` 可合并未声明字段不抛错，失败来自断言而非编译。

- [ ] **Step 3: 最小实现**

`canvasStore.ts` CanvasState 接口（`selectedId: string | null;` 下一行加）：

```ts
  lastPointerShiftKey: boolean;
```

create 初始 state（`selectedId: null,` 下一行加）：

```ts
  lastPointerShiftKey: false,
```

`useIsSingleSelected.ts` 全量替换：

```ts
import { useStore } from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';

/**
 * 响应式单选判定。命令式 getNodes() 计数在"先选 A 再加选 B"时，
 * A 的 selected prop true→true 不触发重渲染，工具条残留（Bug A 残留根源）。
 * selector 返回 number，天然相等比较；for 循环避免拖拽每帧的中间数组分配。
 *
 * lastPointerShiftKey（最近一次画布内主键 pointerdown 的 shiftKey）抑制
 * Shift 多选操作中的 count===1 中间态工具条误弹；必须是订阅读取——
 * 「Shift+点节点 → 普通再点同节点」时 React Flow 选中态可能不变，
 * 恢复弹出仅由 flag 变化触发（spec v3 二轮评审 P1）。
 */
export function useIsSingleSelected(selected: boolean | undefined): boolean {
  const selectedCount = useStore((s) => {
    let count = 0;
    for (let i = 0; i < s.nodes.length; i++) if (s.nodes[i].selected) count++;
    return count;
  });
  const lastPointerShiftKey = useCanvasStore((s) => s.lastPointerShiftKey);
  return !!selected && selectedCount === 1 && !lastPointerShiftKey;
}
```

- [ ] **Step 4: 运行确认通过（绿）**

```bash
cd D:/flowweb/apps/web && npx vitest run src/hooks/useIsSingleSelected.test.tsx
```

预期：7 用例全 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/canvasStore.ts apps/web/src/hooks/useIsSingleSelected.ts apps/web/src/hooks/useIsSingleSelected.test.tsx
git commit -m "feat(web): useIsSingleSelected 融合 lastPointerShiftKey 抑制 Shift 多选工具条"
```

---

### Task 2: useTrackCanvasPointerShift hook

**Files:**
- Create: `apps/web/src/hooks/useTrackCanvasPointerShift.ts`
- Test: `apps/web/src/hooks/useTrackCanvasPointerShift.test.tsx`

- [ ] **Step 1: 写失败测试**

`useTrackCanvasPointerShift.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { useTrackCanvasPointerShift } from './useTrackCanvasPointerShift';
import { useCanvasStore } from '@/stores/canvasStore';

const flag = () => useCanvasStore.getState().lastPointerShiftKey;

let nodeEl: HTMLElement;

function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  useTrackCanvasPointerShift(ref);
  return (
    <div ref={ref}>
      <div className="react-flow">
        <div data-testid="node" ref={(el) => { if (el) nodeEl = el; }} />
        <div className="react-flow__minimap" data-testid="minimap" />
        <div id="canvas-toolbar" data-testid="ctoolbar" />
      </div>
      <div id="node-toolbar-portal" data-testid="portal" />
    </div>
  );
}

// jsdom 无 PointerEvent 构造器；addEventListener 按 type 匹配，MouseEvent 携带所需属性
function pd(target: Element, opts: { shiftKey?: boolean; button?: number } = {}) {
  target.dispatchEvent(new MouseEvent('pointerdown', {
    bubbles: true, cancelable: true, button: opts.button ?? 0, shiftKey: opts.shiftKey ?? false,
  }));
}

describe('useTrackCanvasPointerShift', () => {
  beforeEach(() => {
    useCanvasStore.setState({ lastPointerShiftKey: false });
    render(<Harness />);
  });
  afterEach(() => cleanup());

  it('.react-flow 内主键 Shift pointerdown → flag=true', () => {
    pd(nodeEl, { shiftKey: true });
    expect(flag()).toBe(true);
  });

  it('.react-flow 内主键无 Shift → flag=false', () => {
    useCanvasStore.setState({ lastPointerShiftKey: true });
    pd(nodeEl, { shiftKey: false });
    expect(flag()).toBe(false);
  });

  it('非主键（button=2）不改 flag', () => {
    useCanvasStore.setState({ lastPointerShiftKey: true });
    pd(nodeEl, { shiftKey: false, button: 2 });
    expect(flag()).toBe(true);
  });

  it('MiniMap / canvas-toolbar 内 pointerdown 不改 flag', () => {
    useCanvasStore.setState({ lastPointerShiftKey: true });
    pd(document.querySelector('.react-flow__minimap')!, { shiftKey: false });
    pd(document.querySelector('#canvas-toolbar')!, { shiftKey: false });
    expect(flag()).toBe(true);
  });

  it('.react-flow 外（node-toolbar-portal 同层）不改 flag', () => {
    useCanvasStore.setState({ lastPointerShiftKey: true });
    pd(document.querySelector('[data-testid="portal"]')!, { shiftKey: false });
    expect(flag()).toBe(true);
  });

  it('capture 写入先于 bubble 读取（核心时序保证）', () => {
    useCanvasStore.setState({ lastPointerShiftKey: true });
    let bubbleRead: boolean | undefined;
    nodeEl.addEventListener('pointerdown', () => { bubbleRead = flag(); });
    pd(nodeEl, { shiftKey: false });
    expect(bubbleRead).toBe(false); // bubble 读到 capture 已写入的 false，而非旧值 true
  });

  it('unmount 后 dispatch 不改 flag（cleanup）', () => {
    cleanup();
    pd(nodeEl, { shiftKey: true });
    expect(flag()).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败（红）**

```bash
cd D:/flowweb/apps/web && npx vitest run src/hooks/useTrackCanvasPointerShift.test.tsx
```

预期：FAIL，模块不存在（Cannot find module）。

- [ ] **Step 3: 最小实现**

`useTrackCanvasPointerShift.ts`：

```ts
import { useEffect, type RefObject } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';

/**
 * 采样「最近一次画布内主键 pointerdown 的 shiftKey」到 canvasStore.lastPointerShiftKey，
 * 供 useIsSingleSelected / selectedGroup 抑制 Shift 多选操作中的工具条误弹。
 *
 * - capture 阶段绑 wrapper（组件自身根 div，ref 必然存在），先于 React Flow d3-drag 写入；
 * - 运行时以 closest('.react-flow') 判定归属：node-toolbar-portal 挂在 .react-flow 外、
 *   wrapper 内（CanvasView.tsx:510-514），工具条按钮点击不更新 flag；
 * - 排除不改选中的画布控件（MiniMap / CanvasToolbar）；
 * - 仅主键（button 0）：右键/中键不改选中。
 */
export function useTrackCanvasPointerShift(wrapperRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target;
      // Element（含 SVGElement）：节点标题图标/波形等 SVG 目标也需采样；仅排除文本节点等非 Element
      if (!(target instanceof Element)) return;
      if (!target.closest('.react-flow')) return;
      if (target.closest('.react-flow__minimap, #canvas-toolbar')) return;
      useCanvasStore.setState({ lastPointerShiftKey: e.shiftKey });
    };
    wrapper.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => wrapper.removeEventListener('pointerdown', onPointerDown, { capture: true });
  }, [wrapperRef]);
}
```

- [ ] **Step 4: 运行确认通过（绿）**

```bash
cd D:/flowweb/apps/web && npx vitest run src/hooks/useTrackCanvasPointerShift.test.tsx
```

预期：7 用例全 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/useTrackCanvasPointerShift.ts apps/web/src/hooks/useTrackCanvasPointerShift.test.tsx
git commit -m "feat(web): 新增 useTrackCanvasPointerShift 采样画布 Shift 修饰标志"
```

---

### Task 3: CanvasView 接线 + selectedGroup 融合 + CanvasToolbar id

**Files:**
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx`（import 区、组件体、selectedGroup memo ~311-319）
- Modify: `apps/web/src/pages/canvas/components/CanvasToolbar.tsx:47-48`
- Test: `apps/web/src/pages/canvas/components/CanvasView.test.tsx`

- [ ] **Step 1: 写失败测试**

`CanvasView.test.tsx` 修改（新增部分）：

顶部 import 区后新增可变 mock 状态与 GroupToolbar stub：

```tsx
let mockNodes: any[] = [];
let mockLastPointerShiftKey = false;

vi.mock('./groups/GroupToolbar', () => ({
  GroupToolbar: () => <div data-testid="group-toolbar" />,
}));
```

（GroupToolbar 在 jsdom 下因 measured 缺失 w=0 不渲染，stub 用于隔离断言 selectedGroup 计算结果。）

mock 接线说明（三轮评审 P2-1/P2-2 核验结论，现有代码已满足，勿重复添加）：

- `mockSetState` 已存在：CanvasView.test.tsx:10 `vi.hoisted(() => vi.fn())` 声明、:53 挂载为 mock 的 `setState`——hook 内 `useCanvasStore.setState(...)` 直接命中它，新用例断言 `expect(mockSetState).toHaveBeenCalledWith({ lastPointerShiftKey: true })` 即可。
- mock 为动态工厂形态：state 对象在 vi.fn 回调体内每次调用时创建（:31-44），`nodes: mockNodes` / `lastPointerShiftKey: mockLastPointerShiftKey` 均为每次调用读取当前 let 值——模块级 let 重新赋值可被后续渲染感知（现有 `mockPendingMediaFile` 即同款已验证模式）。

mock canvasStore 的 state 对象（现有 `nodes: [],` 处）改为：

```tsx
        nodes: mockNodes,
        lastPointerShiftKey: mockLastPointerShiftKey,
        toggleCollapse: vi.fn(),
        ungroup: vi.fn(),
        convertGroup: vi.fn(),
```

describe 内新增用例（置于现有用例后）：

```tsx
  const groupNode = { id: 'g1', type: 'group', selected: true, data: { groupType: 'normal' }, position: { x: 0, y: 0 }, width: 300, height: 200 };

  it('组单选 + flag=false → GroupToolbar 渲染', () => {
    mockNodes = [groupNode];
    mockLastPointerShiftKey = false;
    render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    expect(screen.getByTestId('group-toolbar')).toBeInTheDocument();
  });

  it('组单选 + flag=true → GroupToolbar 抑制', () => {
    mockNodes = [groupNode];
    mockLastPointerShiftKey = true;
    render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    expect(screen.queryByTestId('group-toolbar')).not.toBeInTheDocument();
  });

  it('组单选 flag true→false 且 nodes 不变 → GroupToolbar 恢复（锁定订阅+memo deps）', () => {
    mockNodes = [groupNode];
    mockLastPointerShiftKey = true;
    const { rerender } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    expect(screen.queryByTestId('group-toolbar')).not.toBeInTheDocument();
    mockLastPointerShiftKey = false;
    rerender(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    expect(screen.getByTestId('group-toolbar')).toBeInTheDocument();
  });

  it('画布内 Shift pointerdown 接线：写入 lastPointerShiftKey', () => {
    mockNodes = [];
    mockLastPointerShiftKey = false;
    const { container } = render(
      <ReactFlowProvider>
        <CanvasView projectId="p1" />
      </ReactFlowProvider>
    );
    const pane = container.querySelector('.react-flow__pane');
    expect(pane).toBeInTheDocument();
    // 现有 mock 经 vi.importActual 真实渲染 ReactFlow（CanvasView.test.tsx:15-27），
    // .react-flow__pane 必然存在；万一为 null，降级 querySelector('.react-flow') 亦可
    //（事件 dispatch 经 capture 冒泡路径同样到达 wrapper 监听，测试意图不变）。
    pane!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, shiftKey: true }));
    expect(mockSetState).toHaveBeenCalledWith({ lastPointerShiftKey: true });
  });
```

注意：需在 import 中补 `screen`（@testing-library/react）。用例间 mock 变量重置——在 beforeEach 中补 `mockNodes = []; mockLastPointerShiftKey = false; mockSetState.mockClear();`。

- [ ] **Step 2: 运行确认失败（红）**

```bash
cd D:/flowweb/apps/web && npx vitest run src/pages/canvas/components/CanvasView.test.tsx
```

预期：4 新用例中——「flag=true 抑制」「恢复」「pointerdown 接线」FAIL（selectedGroup 未融合 flag；hook 未挂载 → mockSetState 未被调用）；「flag=false 渲染」PASS（现有行为）。

- [ ] **Step 3: 最小实现**

`CanvasView.tsx` 三处修改：

(a) import 区新增：

```tsx
import { useTrackCanvasPointerShift } from '@/hooks/useTrackCanvasPointerShift';
```

(b) 组件体内（`const nodes = useCanvasStore((s) => s.nodes);` 之后）：

```tsx
  const lastPointerShiftKey = useCanvasStore((s) => s.lastPointerShiftKey);
  useTrackCanvasPointerShift(reactFlowWrapper);
```

（`reactFlowWrapper` 已在组件内定义——确认其声明位于调用点之前；若声明在 JSX return 前（现状 ~337 行 return），将两行放在 `selectNode` 订阅之后即可。）

(c) selectedGroup memo 替换（~311-319）：

```tsx
  // 选中组节点时显示 GroupToolbar；多选（≥2）或 Shift 多选意图时不显示，仅普通单独选中时显示
  const selectedGroup = useMemo(() => {
    let count = 0;
    for (const n of nodes) {
      if (!n.selected) continue;
      count++;
      if (count > 1) return undefined;
    }
    return count === 1 && !lastPointerShiftKey
      ? nodes.find((n) => n.type === 'group' && n.selected)
      : undefined;
  }, [nodes, lastPointerShiftKey]);
```

`CanvasToolbar.tsx` 根 div（47-48 行）加 id：

```tsx
      <div
        id="canvas-toolbar"
        className="nodrag nopan absolute bottom-3 left-3 z-10 flex items-center gap-1 rounded-xl p-1.5"
```

- [ ] **Step 4: 运行确认通过（绿）**

```bash
cd D:/flowweb/apps/web && npx vitest run src/pages/canvas/components/CanvasView.test.tsx
```

预期：全部 PASS（含原有用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/components/CanvasView.tsx apps/web/src/pages/canvas/components/CanvasView.test.tsx apps/web/src/pages/canvas/components/CanvasToolbar.tsx
git commit -m "feat(web): CanvasView 挂 Shift 采样 hook 并融合 selectedGroup 抑制逻辑"
```

---

### Task 4: ImageGenNode 接线回归锁定

**Files:**
- Test: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.test.tsx`

性质说明：Task 1 已实现 hook 融合，本任务是组件级接线回归锁定（预期直接绿；若红说明接线遗漏）。ImageGenNode.tsx 本身无代码改动（已使用 isSingleSelected）。

- [ ] **Step 1: 补测试基础设施**

`ImageGenNode.test.tsx`：

(a) hoisted 区顶部（`let mockNodeData` 附近）新增：

```tsx
let mockLastPointerShiftKey = false;
```

(b) `canvasStoreFn` 的 state 对象（`selectedId: null,` 下）加：

```tsx
      lastPointerShiftKey: mockLastPointerShiftKey,
```

(c) describe 外新增 portal 容器管理（jsdom 下 ImageNodeToolbar 无 `#node-toolbar-portal` 则 return null）：

```tsx
beforeEach(() => {
  const el = document.createElement('div');
  el.id = 'node-toolbar-portal';
  document.body.appendChild(el);
  mockLastPointerShiftKey = false;
  mockNodeData.fileId = 'f1';
});
afterEach(() => {
  document.getElementById('node-toolbar-portal')?.remove();
});
```

（若文件已有 beforeEach/afterEach 则合并进去，勿重复注册。`fileId: 'f1'` 走完整工具条渲染路径——useMediaUrl 已 mock 返回 url。）

- [ ] **Step 2: 新增用例**

```tsx
  it('flag=true：单选图片节点不渲染悬浮工具条（Shift 多选抑制接线）', () => {
    mockLastPointerShiftKey = true;
    render(
      <ReactFlowProvider>
        <ImageGenNode id="img1" data={{}} selected type="imageGen" draggable={true} dragging={false} selectable={true} deletable={true} zIndex={0} {...{} as any} />
      </ReactFlowProvider>
    );
    expect(document.querySelector('#node-toolbar-portal [role="toolbar"]')).toBeNull();
  });

  it('flag=false：单选图片节点正常渲染悬浮工具条（接线回归）', () => {
    render(
      <ReactFlowProvider>
        <ImageGenNode id="img1" data={{}} selected type="imageGen" draggable={true} dragging={false} selectable={true} deletable={true} zIndex={0} {...{} as any} />
      </ReactFlowProvider>
    );
    expect(document.querySelector('#node-toolbar-portal [role="toolbar"]')).not.toBeNull();
  });

  it('flag true→false rerender 后工具条恢复（接线回归）', () => {
    mockLastPointerShiftKey = true;
    const { rerender } = render(
      <ReactFlowProvider>
        <ImageGenNode id="img1" data={{}} selected type="imageGen" draggable={true} dragging={false} selectable={true} deletable={true} zIndex={0} {...{} as any} />
      </ReactFlowProvider>
    );
    expect(document.querySelector('#node-toolbar-portal [role="toolbar"]')).toBeNull();
    mockLastPointerShiftKey = false;
    rerender(
      <ReactFlowProvider>
        <ImageGenNode id="img1" data={{}} selected type="imageGen" draggable={true} dragging={false} selectable={true} deletable={true} zIndex={0} {...{} as any} />
      </ReactFlowProvider>
    );
    expect(document.querySelector('#node-toolbar-portal [role="toolbar"]')).not.toBeNull();
  });
```

（节点 props 形态与现有用例 ImageGenNode.test.tsx:189 一致；mockGetNodes 默认返回单个 selected 节点 count=1。）

- [ ] **Step 3: 运行确认通过**

```bash
cd D:/flowweb/apps/web && npx vitest run src/pages/canvas/components/nodes/ImageGenNode.test.tsx
```

预期：3 新用例 PASS 且原有用例无回归。若「flag=true 抑制」用例 FAIL，检查 Task 1 hook 是否正确订阅。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageGenNode.test.tsx
git commit -m "test(web): ImageGenNode 悬浮工具条 Shift 抑制接线回归用例"
```

---

### Task 5: 全量回归 + 浏览器手测

**Files:** 无新改动（验证任务）

- [ ] **Step 1: 全量单测**

```bash
cd D:/flowweb/apps/web && npx vitest run
```

预期：全绿。重点关注 AudioGenNode/VideoGenNode/MultiImageNode/TextInputNode（同样消费 useIsSingleSelected，若其 canvasStore mock state 无 lastPointerShiftKey 字段 → selector 返回 undefined → `!undefined === true` 不影响判定，但需确认无 TypeError）。

若这些测试文件因新增订阅报错（`Cannot read properties of undefined`），在其 canvasStore mock state 中补 `lastPointerShiftKey: false`。

- [ ] **Step 1.5: 类型检查（TS 严格模式，CLAUDE.md 要求）**

```bash
cd D:/flowweb/apps/web && npx tsc --noEmit
```

预期：0 错误。捕获 `RefObject<HTMLDivElement | null>` 与 React 18 类型兼容性、mock 缺字段、memo deps 等编译期问题。（项目无独立 typecheck script，build 的 `tsc -b` 会写构建产物，故用 `--noEmit`；tsconfig include src 含测试文件。）

- [ ] **Step 2: 浏览器手测（spec 手测清单）**

前置：API/Web dev server 运行中（preview_start），打开 `http://localhost:5173/canvas`，画布上准备 2 个图片节点 + 1 个组节点。

1. 普通单击节点 → 工具条可见
2. 点击空白清空 → Shift+单击节点 → 工具条不可见 → 松开 Shift → 仍不可见
3. 普通单击同一节点 → 工具条恢复可见
4. Shift+拖拽框选（含只框住 1 个节点的松手）→ 全程及结束后工具条不可见
5. Shift+点击组节点 → GroupToolbar 不弹；普通单击组节点 → GroupToolbar 弹出
6. Shift+点击节点内 SVG 元素（如节点标题小图标）→ 工具条不弹（SVGElement 非 HTMLElement 子类，评审修复项）
7. flag=true 态（Shift+点节点后）点击左下角缩放按钮（CanvasToolbar，bottom-3 left-3）/ 右下角 MiniMap → 工具条不意外弹出

- [ ] **Step 3: 手测通过后收尾 commit（如有遗漏修正）**

```bash
git add -A
git commit -m "fix(web): Shift 多选工具条抑制遗漏修正（如手测发现问题）"
```

（无修正则跳过本步。）

---

## Self-Review 结论

- **Spec 覆盖**：修复方案 1（store 字段）→ Task 1；2（监听 hook）→ Task 2+3；3（useIsSingleSelected 融合）→ Task 1；4（selectedGroup 融合+订阅 deps）→ Task 3；CanvasToolbar id → Task 3；测试计划三节 → Task 1/2/3/4；手测清单 → Task 5。行为矩阵 11 场景由单测（7+7+4+3=21）+ 手测 6 步覆盖。
- **占位符**：无 TBD/TODO；所有代码步骤含完整代码。
- **类型一致性**：`lastPointerShiftKey`（boolean）跨 store/hook/测试一致；`useTrackCanvasPointerShift(ref: RefObject<HTMLDivElement | null>)` 与 CanvasView `reactFlowWrapper`（useRef<HTMLDivElement>(null)）兼容；`#canvas-toolbar` id 在 Task 2 测试（Harness 手写 div）与 Task 3 实现（CanvasToolbar 真实 div）一致。
