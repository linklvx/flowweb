// apps/web/src/hooks/useDragGestureGuard.test.tsx
// B4'-1（Spec B）：常驻指针监听+pointerdown 缓存 id+capture 抑制。
//
// 锚（plan B4'-1 / 终裁 37①·31③·58 小项）：
//   ① 常驻注册（[] 依赖挂载一次+session 引用守卫）——监听清单模板=useMarqueeSelectionGuard，
//      先例只借清单、终形常驻（先例实为条件注册，终裁 37①）。
//   ② pointerup 按 pointerId 移除、不继承 button===0 过滤（window 级 up 不按 button 判——
//      终裁 37①）；touchend+pointerup 同帧双上报 ⇒ 集合仍含首指 id（键控 delete 幂等）。
//   ③ pointermove[buttons===0]/blur = 吞 pointerup 检出（自愈）⇒ endGesture('healed')。
//   ④ pointermove[buttons!==0] = 活动刷新（noteDragActivity——lastActivityAt+watchdog 重挂）。
//   ⑤ pointerdown 缓存 id（wrapper capture）：仅 session 未活跃时更新缓存——session 内第二指
//      down 不覆盖；连续两次拖动第二次缓存覆盖第一次。
//   ⑥ capture 抑制（session∧drag∧touches>1 ⇒ touchmove preventDefault，{capture,passive:false}，
//      不含 touchcancel——终裁 31③）。
//
// jsdom 缺 PointerEvent——MouseEvent 承载原生派发（repo 先例 AddOutputHandle.test:49），
// pointerId 以 expando 挂载。
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
vi.mock('@hocuspocus/provider', () => ({ HocuspocusProvider: class MockProvider {} }));
import { act, renderHook } from '@testing-library/react';
import { useDragGestureGuard } from './useDragGestureGuard';
import { useCanvasStore, DRAG_STALE_MS } from '@/stores/canvasStore';
import { seedCanvas, resetCanvasStores } from '@/test/fixtures/canvas';

const session = () => useCanvasStore.getState().dragSession;
const begin = (ids: string[], pointerId: number | null) =>
  useCanvasStore.getState().beginDragGesture(ids.map((id) => ({ id })), pointerId);

/** jsdom 无 PointerEvent 构造器——MouseEvent 承载（type=pointer*）+expando pointerId。 */
const firePointer = (type: 'pointerup' | 'pointercancel' | 'pointermove', init: { pointerId: number; buttons?: number; button?: number }) => {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, buttons: init.buttons ?? 0, button: init.button ?? 0 });
  (ev as unknown as { pointerId: number }).pointerId = init.pointerId;
  act(() => { window.dispatchEvent(ev); });
};

const fireTouch = (touches: number, type: 'touchmove' | 'touchcancel' = 'touchmove') => {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  (ev as unknown as { touches: unknown[] }).touches = Array.from({ length: touches }, () => ({}));
  act(() => { window.dispatchEvent(ev); });
  return ev;
};

const dragFrame = (id: string, pos: { x: number; y: number }) => {
  seedCanvas(useCanvasStore.getState().nodes.map((n: any) => (
    n.id === id ? { ...n, position: { ...pos } } : n
  )));
};

beforeEach(() => {
  seedCanvas([{ id: 't1', type: 'textInput', position: { x: 700, y: 0 }, data: {} } as any]);
});

afterEach(() => {
  if (useCanvasStore.getState().dragSession) useCanvasStore.getState().endGesture('aborted');
  vi.useRealTimers();
  resetCanvasStores();
});

describe("B4'-1 常驻监听（[] 依赖——终裁 37①）", () => {
  it('挂载一次：rerender 不重复注册+unmount 摘除（常驻防挂摘中间失败=泄漏类漂移入口）', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { rerender, unmount } = renderHook(() => useDragGestureGuard());
    const adds = addSpy.mock.calls.filter(([t]) => t === 'pointerup').length;
    expect(adds).toBe(1);
    rerender();
    rerender();
    expect(addSpy.mock.calls.filter(([t]) => t === 'pointerup').length).toBe(1);   // 常驻不随渲染挂摘
    unmount();
    expect(removeSpy.mock.calls.filter(([t]) => t === 'pointerup').length).toBe(1);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('pointerup 按 pointerId 移除（不继承 button===0——右键 up 也如实记账）', () => {
    renderHook(() => useDragGestureGuard());
    begin(['t1'], 1);
    firePointer('pointerup', { pointerId: 2, button: 2 });   // 非左键 up（marquee guard 形态会滤——本处不滤）
    expect([...session()!.activePointers]).toEqual([1]);     // 无命中删除=no-op，首指仍在
    firePointer('pointerup', { pointerId: 1, button: 0 });
    expect([...session()!.activePointers]).toEqual([]);      // 按 id 移除
    expect(session()).not.toBeNull();                        // pointerup 只维护集合——收尾归 watchdog/自愈
  });

  it('touchend+pointerup 同帧双上报 ⇒ 集合仍含首指 id（mouse/touchend 不参与计数——只 pointer 事件记账）', () => {
    renderHook(() => useDragGestureGuard());
    begin(['t1'], 1);
    session()!.activePointers.add(2);                        // 第二指在集（键控维护形态）
    firePointer('pointerup', { pointerId: 2 });              // 同帧双上报的 pointerup 半边
    expect([...session()!.activePointers]).toEqual([1]);     // 首指 id 存活——手势续命
  });

  it('pointermove[buttons===0] ⇒ 吞 pointerup 自愈：endGesture("healed")（session 清+回滚 baseline）', () => {
    renderHook(() => useDragGestureGuard());
    begin(['t1'], 1);
    dragFrame('t1', { x: 800, y: 10 });
    firePointer('pointermove', { pointerId: 1, buttons: 0 });
    expect(session()).toBeNull();                                  // 自愈收尾
    const t1 = useCanvasStore.getState().nodes.find((n: any) => n.id === 't1') as any;
    expect(t1.position).toEqual({ x: 700, y: 0 });                 // healed 同构收尾含回滚（spec §3.2.6）
  });

  it('pointermove[buttons!==0] ⇒ noteDragActivity（lastActivityAt 刷新+watchdog 重挂）', () => {
    vi.useFakeTimers();
    renderHook(() => useDragGestureGuard());
    begin(['t1'], 1);
    const t0 = session()!.lastActivityAt;
    vi.advanceTimersByTime(3_000);
    firePointer('pointermove', { pointerId: 1, buttons: 1 });
    expect(session()!.lastActivityAt).toBe(t0 + 3_000);            // 活动刷新
    vi.advanceTimersByTime(DRAG_STALE_MS - 1);                     // 重挂后未满窗——不触发
    expect(session()).not.toBeNull();
    vi.advanceTimersByTime(1);                                      // 满窗（活动后 5s）——activePointers 仍含 1=续挂
    expect(session()).not.toBeNull();
    expect(session()!.activePointers.size).toBe(1);
  });

  it('blur ⇒ 吞 pointerup 自愈（次级通道——alt-tab 窗外释手）', () => {
    renderHook(() => useDragGestureGuard());
    begin(['t1'], 1);
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(session()).toBeNull();
  });

  it('unmount 时会话仍活 ⇒ endGesture("aborted") 兜底（监听摘除后 activePointers 永不可排空——防僵尸会话 watchdog 无限续挂/让位保护悬挂）', () => {
    const { unmount } = renderHook(() => useDragGestureGuard());
    begin(['t1'], 1);
    dragFrame('t1', { x: 800, y: 10 });
    unmount();
    expect(session()).toBeNull();                                       // 会话不残留
    expect(useCanvasStore.getState().nodes.find((n: any) => n.id === 't1')!.position)
      .toEqual({ x: 700, y: 0 });                                       // abort 族回滚 baseline
  });
});

describe("B4'-1 pointerdown 缓存 id（wrapper capture——终裁 58 小项）", () => {
  it('连续两次拖动：第二次缓存覆盖第一次（begin 消费缓存为起始 pointerId）', () => {
    const { result } = renderHook(() => useDragGestureGuard());
    act(() => { result.current.onPointerDownCapture({ pointerId: 7 } as never); });
    begin(['t1'], result.current.pointerIdRef.current);
    expect([...session()!.activePointers]).toEqual([7]);
    useCanvasStore.getState().endGesture('aborted');
    act(() => { result.current.onPointerDownCapture({ pointerId: 9 } as never); });   // 第二次拖动
    begin(['t1'], result.current.pointerIdRef.current);
    expect([...session()!.activePointers]).toEqual([9]);           // 覆盖
  });

  it('session 内第二指 down 不覆盖缓存', () => {
    const { result } = renderHook(() => useDragGestureGuard());
    act(() => { result.current.onPointerDownCapture({ pointerId: 7 } as never); });
    begin(['t1'], result.current.pointerIdRef.current);
    act(() => { result.current.onPointerDownCapture({ pointerId: 8 } as never); });   // session 活跃期第二指
    expect(result.current.pointerIdRef.current).toBe(7);           // 不覆盖
  });
});

describe("B4'-1 capture 抑制（终裁 31③——不含 touchcancel）", () => {
  it('session∧drag∧touches>1 ⇒ touchmove preventDefault；无 session/touches=1/resize 档 ⇒ 不抑制', () => {
    renderHook(() => useDragGestureGuard());
    // 无 session
    expect(fireTouch(2).defaultPrevented).toBe(false);
    // session∧drag∧双指
    begin(['t1'], 1);
    expect(fireTouch(2).defaultPrevented).toBe(true);       // RF 多指 pan/zoom 抑制窗
    expect(fireTouch(1).defaultPrevented).toBe(false);      // 单指不抑制
    useCanvasStore.getState().endGesture('aborted');
    // resize 档（drag 限定）
    useCanvasStore.getState().beginResize('t1', 4);
    expect(fireTouch(2).defaultPrevented).toBe(false);
    // touchcancel 不在抑制面（终裁 31③）
    useCanvasStore.getState().endGesture('aborted');
    begin(['t1'], 1);
    expect(fireTouch(2, 'touchcancel').defaultPrevented).toBe(false);
  });
});
