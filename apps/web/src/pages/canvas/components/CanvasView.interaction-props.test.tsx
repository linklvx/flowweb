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
vi.mock('@/utils/handleMenu', () => ({
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
    act(() => {
      useNodeStore.setState({ activeEditNodeId: null, activeTransformNodeId: null, referenceSelect: null });
      useCanvasStore.setState((s) => (s.marqueeSelecting ? { marqueeSelecting: false } : s));
    });
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
