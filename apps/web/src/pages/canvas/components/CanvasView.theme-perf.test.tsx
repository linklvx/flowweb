// C8 性能实测①render 计数（spec §11.1，D2 落点 + D4 复验）：切换主题一次，节点组件 render 增量预期 0
// ——只有 CanvasView 重渲染（禁 useTheme 的机制验证）。若红：先查 nodes 数组引用稳定性（store 选择器
// 每次返回新数组会让 ReactFlow 重渲全部节点），修法是消费处 memo 化，不是给 colorMode 让步。
// nodeTypes 是 CanvasView 导出常量（CanvasView.tsx:43-52），测试无法注入 counting 类型——走组件 mock 路线；
// nodes/ 下无 TextNode.tsx，文本节点是 TextInputNode.tsx、nodeTypes 键为 'textInput'。
// ReactFlowProvider 必须与 CanvasView 同批动态 import（vi.resetModules 会重执行 @xyflow/react 产出新
// context——静态 import 的 provider 在旧 copy 上，CanvasView 的 useReactFlow 读不到 provider 即 #001 红）。
import { render, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const renders = { nodes: 0 };

vi.mock('./nodes/TextInputNode', () => ({
  TextInputNode: () => { renders.nodes++; return <div data-testid="perf-node" />; },
}));

// vi.mock 不跨文件——canvasStore mock 照抄 CanvasView.test.tsx:35-70 既有骨架改造（缺则前置自证红）：
// ⚠ 计数用途下 state 与 actions 必须工厂域一次性建、逐次调用复用同一引用——真 store 的 zustand actions
// 是模块级稳定引用，若照抄原骨架"每次调用现建 vi.fn()"，CanvasView 的 useCallback 依赖（如 onNodeClick←
// selectNode）每渲染翻新 → NodeWrapper memo 链断裂 → 节点假重渲（首跑实测增量 2 的根因，修 mock 忠实化，
// 非放宽断言）。mockNodes 铺 ≥2 个 type:'textInput' 节点（走被 mock 的 TextInputNode）。
let mockNodes: any[] = [];

vi.mock('@/stores/canvasStore', () => {
  const actions = {
    toggleCollapse: vi.fn(),
    ungroup: vi.fn(),
    convertGroup: vi.fn(),
    onNodesChange: vi.fn(),
    onEdgesChange: vi.fn(),
    onConnect: vi.fn(),
    updateViewport: vi.fn(),
    addNode: vi.fn(),
    selectNode: vi.fn(),
    requestAddMediaNode: vi.fn(),
  };
  const stable = {
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    pendingMediaFile: null,
    lastPointerShiftKey: false,
    marqueeSelecting: false,
  };
  const state = { nodes: mockNodes, ...stable, ...actions };
  const useCanvasStore: any = vi.fn((selector?: any) =>
    typeof selector === 'function' ? selector(state) : state
  );
  return {
    useCanvasStore: Object.assign(useCanvasStore, {
      getState: () => state,
      setState: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    }),
  };
});

describe('CanvasView 主题切换性能（render 计数）', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    renders.nodes = 0;
    mockNodes = [
      { id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} },
      { id: 'n2', type: 'textInput', position: { x: 400, y: 0 }, data: {} },
    ];
  });

  // 30s 超时：jsdom 全量挂载 ReactFlow 重（单跑 ~3.6-6s；全仓并发下 5s→15s 两轮放宽仍不够——
  // 批3 取证：干净树全仓并发实测 14.3s/15s 贴线，机器负载下必越界。放宽的是时钟预算不是断言口径）
  it('setMode 切换一次：节点确已渲染（前置自证）且节点 render 增量 = 0', { timeout: 30_000 }, async () => {
    const { setMode } = await import('@/stores/themeStore');
    const { ReactFlowProvider } = await import('@xyflow/react');
    const { CanvasView } = await import('./CanvasView');
    render(<ReactFlowProvider><CanvasView projectId="p1" /></ReactFlowProvider>);
    expect(renders.nodes, '前置自证：节点确已渲染（mock 空转则此断言红，防"0 重渲"假绿）').toBeGreaterThan(0);
    const before = renders.nodes;
    act(() => setMode('light'));
    expect(document.documentElement.classList.contains('light')).toBe(true);
    // 测量有效前提（quality review 登记）：同步 uSES 冲刷 + before→断言间零宏任务（test-setup rAF polyfill=
    // setTimeout(0) 不入窗）。若未来主题传播改异步（useDeferredValue/debounce），延迟渲染会落到同步窗外→
    // 增量恒 0 假绿——届时须改 await act(async) + 二次冲刷再计增量
    expect(renders.nodes - before, '节点组件不得因主题切换重渲染').toBe(0);
    // 防"节点消失/延迟后从未渲染"的假绿载体：切换后节点仍在 DOM（Suspense 永久 fallback 会让前置自证失锚）
    expect(document.querySelectorAll('[data-testid="perf-node"]').length).toBe(2);
  });
});
