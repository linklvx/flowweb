// apps/web/src/pages/canvas/components/groups/AddOutputHandle.test.tsx
// B6-2（Spec B 需求 6 / 撞车② B 案）：+号输出按钮组件面——可见性矩阵 / 屏幕恒定几何（三档 zoom）/
// 拖线层手势（DRAG_THRESHOLD_PX 分类）/ Esc 取消 / isLocked 不响应 / 撞车①a portal+①b stopPropagation。
// rect 读 cs（v3.16 终裁 57②）：useCanvasStore 订阅+useViewport——不读 RF internals.measured。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

const rf = vi.hoisted(() => ({ vp: { x: 0, y: 0, zoom: 1 } as { x: number; y: number; zoom: number } }));
const cs = vi.hoisted(() => ({ state: {} as any }));
const ns = vi.hoisted(() => ({ state: { activeEditNodeId: null as string | null, activeTransformNodeId: null as string | null } }));

vi.mock('@xyflow/react', () => ({ useViewport: () => rf.vp }));
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: Object.assign((sel: any) => sel(cs.state), { getState: () => cs.state }),
}));
vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: Object.assign((sel: any) => sel(ns.state), { getState: () => ns.state }),
}));

import { AddOutputHandle } from './AddOutputHandle';

let portal: HTMLDivElement;
beforeEach(() => {
  portal = document.createElement('div');
  portal.id = 'node-toolbar-portal';
  document.body.appendChild(portal);
  rf.vp = { x: 0, y: 0, zoom: 1 }; // 几何 it.each 会改写——逐用例复位防泄漏
  cs.state = { nodes: [], marqueeSelecting: false, localCollapsed: {}, hydration: 'ready', collabReadOnly: false, wsAuthNotice: null };
  ns.state = { activeEditNodeId: null, activeTransformNodeId: null };
});
afterEach(() => portal.remove());

type N = any;
const mk = (id: string, over: Partial<N> = {}): N => ({
  id, type: 'imageGen', data: {}, position: { x: 0, y: 0 }, width: 200, height: 100, selected: true, ...over,
});
// 双选中叶节点：a=(100,100,200,100) b=(200,300,200,100) → bbox {100,100,300,300}：right=400, vcy=250
const twoSelected = (): N[] => [
  mk('a', { position: { x: 100, y: 100 } }),
  mk('b', { position: { x: 200, y: 300 } }),
];
const group = (over: Partial<N> = {}): N => mk('g', {
  id: 'g', type: 'group', position: { x: 100, y: 50 }, width: 300, height: 200, ...over,
});

const btn = (): HTMLElement => portal.querySelector('[data-testid="add-output-handle"]') as HTMLElement;
const circle = (): HTMLElement => btn().firstElementChild as HTMLElement;

/** jsdom 缺 PointerEvent——统一用 MouseEvent 承载原生派发（repo 先例 VideoTrimTimeline.test:46）；
 *  实测 fireEvent.pointerDown 的 init 属性不达 React 合成面（clientX undefined）——原生派发冒泡至
 *  root 可达，但须包 act 使 drag state 与监听器 effect 同步落定后再发后续事件 */
const firePointer = (target: Element | Window, type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number) => {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, buttons: 1, bubbles: true, cancelable: true }));
  });
};

describe('AddOutputHandle 可见性矩阵（显隐单源 resolveAddOutputTarget）', () => {
  it('多选 ≥2 → 渲染（+号锚选框 bbox 右缘中点）', () => {
    cs.state.nodes = twoSelected();
    const { container } = render(<AddOutputHandle />);
    const b = btn();
    expect(b).toBeTruthy();
    expect(b.style.left).toBe('400px'); // bbox {100,100,300,300} 右缘
    expect(b.style.top).toBe('222px');  // vcy 250 − 28
  });

  it('marquee 进行中 → 不渲染', () => {
    cs.state.nodes = twoSelected();
    cs.state.marqueeSelecting = true;
    render(<AddOutputHandle />);
    expect(btn()).toBeNull();
    expect(portal.children.length).toBe(0);
  });

  it('普通组单选未折叠 → 渲染（组帧=cs 三字段）', () => {
    cs.state.nodes = [group()];
    render(<AddOutputHandle />);
    const b = btn();
    expect(b).toBeTruthy();
    expect(b.style.left).toBe('400px'); // right=(100+300)*1
    expect(b.style.top).toBe('122px');  // vcy=(50+100)−28
  });

  it('折叠组（data.collapsed / localCollapsed override）→ 不渲染', () => {
    cs.state.nodes = [group({ data: { collapsed: true } })];
    render(<AddOutputHandle />);
    expect(btn()).toBeNull();
    cs.state.nodes = [group({ data: { collapsed: false } })];
    cs.state.localCollapsed = { g: true };
    const { unmount } = render(<AddOutputHandle />);
    expect(btn()).toBeNull();
    unmount();
  });

  it('分镜组 → 不渲染', () => {
    cs.state.nodes = [group({ data: { groupType: 'storyboard' } })];
    render(<AddOutputHandle />);
    expect(btn()).toBeNull();
  });

  it('!canEdit → 不渲染（useCanvasStore(s=>canEdit(s)) 订阅——viewer 下渲染必被 dispatch 静默拦，口径 26）', () => {
    cs.state.nodes = twoSelected();
    cs.state.collabReadOnly = true;
    render(<AddOutputHandle />);
    expect(btn()).toBeNull();
  });
});

describe('AddOutputHandle 几何（B 案——屏幕恒定：尺寸与偏移均屏幕 px）', () => {
  it.each([0.5, 1, 2] as const)('zoom=%s：直径 24 屏幕px 恒定+圆心外移框外 12px 恒定（左缘=框右缘）', (zoom) => {
    cs.state.nodes = twoSelected();
    rf.vp = zoom === 2 ? { x: 10, y: 20, zoom } : { x: 0, y: 0, zoom };
    const { unmount } = render(<AddOutputHandle />);
    const b = btn();
    const right = 400 * zoom + rf.vp.x;        // bbox 右缘屏幕坐标
    const vcy = 250 * zoom + rf.vp.y;          // bbox 垂直中点屏幕坐标
    expect(b.style.left).toBe(`${right}px`);   // 命中区自框右缘向框外展开
    expect(b.style.top).toBe(`${vcy - 28}px`);
    expect(b.style.width).toBe('40px');        // 命中区屏幕常量
    expect(b.style.height).toBe('56px');
    const c = circle();
    expect(c.style.width).toBe('24px');        // 圆直径三档相等（屏幕 px 不随 zoom）
    expect(c.style.height).toBe('24px');
    // 圆心外移框外 offset(12)：圆左缘偏移=offset−半径=0（贴框右缘）+按钮左缘=框右缘 ⇒ 圆心=right+12
    expect(c.style.left).toBe('0px');
    // 垂直居中：(hitHeight−diameter)/2=16 ⇒ 圆心=框右缘垂直中点
    expect(c.style.top).toBe('16px');
    unmount();
  });
});

describe('AddOutputHandle 撞车①（+号↔handle 菜单互不触发）', () => {
  it('①a：渲染于 #node-toolbar-portal（handle 兄弟层——非节点 DOM/Handle 子元素）', () => {
    cs.state.nodes = twoSelected();
    const { container } = render(<AddOutputHandle />);
    expect(container).toBeEmptyDOMElement();
    expect(portal.contains(btn())).toBe(true);
  });

  it('①b：nodrag+nopan class + pointerdown stopPropagation（React 树父不收事件——RF 不平移不拖拽）', () => {
    cs.state.nodes = twoSelected();
    const parentSpy = vi.fn();
    render(
      <div onPointerDown={parentSpy}>
        <AddOutputHandle />
      </div>,
    );
    const b = btn();
    expect(b.classList.contains('nodrag')).toBe(true);
    expect(b.classList.contains('nopan')).toBe(true);
    firePointer(b, 'pointerdown', 412, 250);
    expect(parentSpy).not.toHaveBeenCalled();
  });
});

describe('AddOutputHandle 手势（B6-2 拖线层——语义归 B6-3，本片只送达载荷）', () => {
  it('位移 ≥ DRAG_THRESHOLD_PX 进拖线态：BatchConnectLines 渲染 N 条线（每源右缘中点→指针）', () => {
    cs.state.nodes = [...twoSelected(), mk('tgt', { id: 'tgt', position: { x: 500, y: 100 }, selected: false })];
    render(<AddOutputHandle onGestureEnd={vi.fn()} />);
    firePointer(btn(), 'pointerdown', 412, 250);
    firePointer(window, 'pointermove', 418, 250); // ≥5px（阈值=DRAG_THRESHOLD_PX）
    const svg = portal.querySelector('[data-testid="batch-connect-lines"]') as SVGSVGElement;
    expect(svg).toBeTruthy();
    const lines = svg.querySelectorAll('line');
    expect(lines.length).toBe(2); // 源=2 选中节点（组无/hidden 无）
    expect(lines[0]).toHaveAttribute('x1', '300'); // a 右缘中点 (100+200, 100+50)
    expect(lines[0]).toHaveAttribute('y1', '150');
    expect(lines[1]).toHaveAttribute('x1', '400'); // b 右缘中点 (200+200, 300+50)
    expect(lines[1]).toHaveAttribute('y1', '350');
    expect(lines[0]).toHaveAttribute('x2', '418'); // 指针当前（portal 原点 0——client≡local）
    expect(lines[0]).toHaveAttribute('y2', '250');
  });

  it('拖线松手落目标节点 → onGestureEnd {kind:drop, hitNodeId}（client/flow 双坐标+源集）', () => {
    cs.state.nodes = [...twoSelected(), mk('tgt', { id: 'tgt', position: { x: 500, y: 100 }, selected: false })];
    const spy = vi.fn();
    render(<AddOutputHandle onGestureEnd={spy} />);
    firePointer(btn(), 'pointerdown', 412, 250);
    firePointer(window, 'pointermove', 500, 150);
    firePointer(window, 'pointerup', 550, 150);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      kind: 'drop',
      sourceIds: ['a', 'b'],
      clientPoint: { x: 550, y: 150 },
      flowPoint: { x: 550, y: 150 }, // zoom=1 vp=0
      hitNodeId: 'tgt',
    });
    expect(portal.querySelector('[data-testid="batch-connect-lines"]')).toBeNull(); // 线随松手收起
  });

  it('拖线松手落源自身/落空 → hitNodeId null（排除源自身 F9；落空语义归 B6-3）', () => {
    cs.state.nodes = twoSelected();
    const spy = vi.fn();
    render(<AddOutputHandle onGestureEnd={spy} />);
    firePointer(btn(), 'pointerdown', 412, 250);
    firePointer(window, 'pointermove', 160, 160);
    firePointer(window, 'pointerup', 150, 150); // a 矩形内（100..300,100..200）——源排除
    expect(spy.mock.calls[0][0]).toMatchObject({ kind: 'drop', hitNodeId: null });
  });

  it('pointerup 早于阈值 → {kind:click, anchorClient=+号圆心}（点击建点菜单归 B6-3）', () => {
    cs.state.nodes = twoSelected();
    const spy = vi.fn();
    render(<AddOutputHandle onGestureEnd={spy} />);
    firePointer(btn(), 'pointerdown', 412, 250);
    firePointer(window, 'pointerup', 413, 251); // 位移 ~1.4px < 5
    expect(spy).toHaveBeenCalledWith({ kind: 'click', sourceIds: ['a', 'b'], anchorClient: { x: 412, y: 250 } });
  });

  it('Esc 取消：拖线中线隐藏 + 状态复位（后续 up 不发载荷）', () => {
    cs.state.nodes = twoSelected();
    const spy = vi.fn();
    render(<AddOutputHandle onGestureEnd={spy} />);
    firePointer(btn(), 'pointerdown', 412, 250);
    firePointer(window, 'pointermove', 500, 250);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(portal.querySelector('[data-testid="batch-connect-lines"]')).toBeNull();
    firePointer(window, 'pointerup', 500, 250);
    expect(spy).not.toHaveBeenCalled();
  });

  it('isLocked 不响应（F10——编辑/transform 中 pointerdown 不启手势）', () => {
    cs.state.nodes = twoSelected();
    ns.state = { activeEditNodeId: 'x', activeTransformNodeId: null };
    const spy = vi.fn();
    render(<AddOutputHandle onGestureEnd={spy} />);
    firePointer(btn(), 'pointerdown', 412, 250);
    firePointer(window, 'pointermove', 500, 250);
    expect(portal.querySelector('[data-testid="batch-connect-lines"]')).toBeNull();
    firePointer(window, 'pointerup', 500, 250);
    expect(spy).not.toHaveBeenCalled();
  });
});
