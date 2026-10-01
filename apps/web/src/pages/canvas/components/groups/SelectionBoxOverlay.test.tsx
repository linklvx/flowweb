// apps/web/src/pages/canvas/components/groups/SelectionBoxOverlay.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const rf = vi.hoisted(() => {
  const state = { nodes: [] as any[], vp: { x: 0, y: 0, zoom: 1 }, marqueeSelecting: false };
  return { state };
});

// getNodesBounds mock：node.positionAbsolute 存在时取 min/max，否则固定 bounds
vi.mock('@xyflow/react', () => ({
  useStore: (sel: any) => sel({ nodeLookup: new Map(rf.state.nodes.map((n) => [n.id, n])) }),
  useViewport: () => rf.state.vp,
  getNodesBounds: (ns: any[]) => {
    const xs = ns.map((n) => (n.positionAbsolute ?? { x: 100, y: 200 }).x);
    const ys = ns.map((n) => (n.positionAbsolute ?? { x: 100, y: 200 }).y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, width: 50, height: 40 };
  },
}));

const storeApi: any = {};
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: (sel: any) => sel({ nodes: rf.state.nodes.filter((n) => n.selected), groupNodes: storeApi.groupNodes, marqueeSelecting: rf.state.marqueeSelecting, arrangeSelection: storeApi.arrangeSelection, duplicateNodes: storeApi.duplicateNodes }),
}));

import { SelectionBoxOverlay } from './SelectionBoxOverlay';

describe('SelectionBoxOverlay', () => {
  let portal: HTMLDivElement;
  beforeEach(() => {
    portal = document.createElement('div');
    portal.id = 'node-toolbar-portal';
    document.body.appendChild(portal);
    storeApi.groupNodes = vi.fn();
    storeApi.arrangeSelection = vi.fn();
    storeApi.duplicateNodes = vi.fn();
  });
  afterEach(() => portal.remove());

  const mk = (id: string, type: string, data: Record<string, unknown> = {}, pos?: any) =>
    ({ id, type, data, selected: true, ...(pos ?? {}) });

  it('选中 <2 不渲染', () => {
    rf.state.nodes = [mk('n1', 'imageGen')];
    rf.state.vp = { x: 0, y: 0, zoom: 1 };
    const { container } = render(<SelectionBoxOverlay />);
    expect(container).toBeEmptyDOMElement();
  });

  it('坐标：bounds 变换 + padding 屏幕常量外加（zoom=2 时 padding 不缩放）；顶部含标题浮层 titleExtra×zoom', () => {
    rf.state.nodes = [mk('n1', 'imageGen', {}, { positionAbsolute: { x: 100, y: 200 } }), mk('n2', 'imageGen', {}, { positionAbsolute: { x: 110, y: 210 } })];
    rf.state.vp = { x: 10, y: 20, zoom: 2 };
    render(<SelectionBoxOverlay />);
    const box = portal.firstElementChild as HTMLElement;
    expect(box.style.left).toBe('180px');  // 100*2+10-30
    expect(box.style.top).toBe('338px');   // 200*2+20-30-26*2（标题浮层随流坐标缩放）
    expect(box.style.width).toBe('160px'); // 50*2+60
    expect(box.style.height).toBe('192px');// 40*2+60+26*2
  });

  it('框本体 pointerEvents none；徽标显示「N 项」', () => {
    rf.state.nodes = [mk('n1', 'imageGen', {}, { positionAbsolute: { x: 0, y: 300 } }), mk('n2', 'imageGen', {}, { positionAbsolute: { x: 10, y: 310 } })];
    rf.state.vp = { x: 0, y: 0, zoom: 1 };
    render(<SelectionBoxOverlay />);
    const box = portal.firstElementChild as HTMLElement;
    expect(box.style.pointerEvents).toBe('none');
    expect(screen.getByText('2 项')).toBeTruthy();
  });

  it('顶部边界：框贴顶时工具条翻转到下方', () => {
    rf.state.nodes = [mk('n1', 'imageGen', {}, { positionAbsolute: { x: 0, y: 0 } }), mk('n2', 'imageGen', {}, { positionAbsolute: { x: 10, y: 10 } })];
    rf.state.vp = { x: 0, y: 0, zoom: 1 };
    render(<SelectionBoxOverlay />);
    const toolbar = portal.children[1] as HTMLElement;
    expect(toolbar.style.top).toBe('84px'); // -30 - 26 + (40×1 + 60 + 26) + 14（height = 126）
  });

  it('原 MultiSelectToolbar 用例迁移：点击打组调用回调（onGroup）', () => {
    rf.state.nodes = [
      mk('n1', 'imageGen', { status: 'done', fileId: 'f1' }, { positionAbsolute: { x: 0, y: 300 } }),
      mk('n2', 'textInput', {}, { positionAbsolute: { x: 10, y: 310 } }),
    ];
    rf.state.vp = { x: 0, y: 0, zoom: 1 };
    const spy = vi.fn();
    render(<SelectionBoxOverlay onGroup={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /打组/ }));
    fireEvent.click(screen.getByText('打组（Ctrl+G）'));
    expect(spy).toHaveBeenCalledWith(['n1', 'n2']);
  });

  it('框选拖拽中 ≥2 选中不渲染几何体（消费点 3，spec §5-1 不变式）', () => {
    rf.state.marqueeSelecting = true;
    rf.state.nodes = [mk('n1', 'imageGen', {}, { positionAbsolute: { x: 100, y: 200 } }), mk('n2', 'imageGen', {}, { positionAbsolute: { x: 110, y: 210 } })];
    rf.state.vp = { x: 0, y: 0, zoom: 1 };
    const { container } = render(<SelectionBoxOverlay />);
    expect(container).toBeEmptyDOMElement();
    expect(portal.children.length).toBe(0);
    rf.state.marqueeSelecting = false; // 复位防污染
  });

  it('hidden 选中节点不入选框集合（R2a-0 B 端兜底——A 端折叠清 selected 不进投影，B 端 stale selected+hidden 由读点过滤 !n.hidden 兜住；R3 登记：键盘命令面另立任务）', () => {
    rf.state.nodes = [
      { id: 'h1', type: 'imageGen', data: {}, selected: true, hidden: true, positionAbsolute: { x: 0, y: 0 } },
      mk('n2', 'imageGen', {}, { positionAbsolute: { x: 10, y: 310 } }),
    ];
    rf.state.vp = { x: 0, y: 0, zoom: 1 };
    const { container } = render(<SelectionBoxOverlay />);
    expect(container).toBeEmptyDOMElement();   // 可见选中仅 1 个（hidden 被读点过滤）< 2——不渲染
    expect(portal.children.length).toBe(0);
  });

  it('工具条含排列菜单（网格/水平/垂直）+创建副本按钮；点外/Esc 关闭；aria 齐全（§4.3 浮层规格）', () => {
    rf.state.nodes = [mk('n1', 'imageGen', {}, { positionAbsolute: { x: 0, y: 300 } }), mk('n2', 'imageGen', {}, { positionAbsolute: { x: 10, y: 310 } })];
    rf.state.vp = { x: 0, y: 0, zoom: 1 };
    render(<SelectionBoxOverlay />);
    const arrangeBtn = screen.getByRole('button', { name: /排列/ });
    expect(arrangeBtn).toHaveAttribute('aria-expanded', 'false');
    expect(arrangeBtn).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(arrangeBtn);
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((el) => el.textContent)).toEqual(['网格', '水平', '垂直']);
    fireEvent.click(within(menu).getByText('水平'));
    expect(storeApi.arrangeSelection).toHaveBeenCalledWith(['n1', 'n2'], 'horizontal');
    expect(screen.queryByRole('menu')).toBeNull();      // 选中即收起
    fireEvent.click(arrangeBtn);                        // 再开 → Esc 关
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(arrangeBtn);                        // 再开 → 点外（mousedown outside）关
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: /创建副本/ })).toBeTruthy();
  });

  it('创建副本按钮调 duplicateNodes(选中 ids 全量)', () => {
    rf.state.nodes = [mk('n1', 'imageGen', {}, { positionAbsolute: { x: 0, y: 300 } }), mk('n2', 'imageGen', {}, { positionAbsolute: { x: 10, y: 310 } })];
    rf.state.vp = { x: 0, y: 0, zoom: 1 };
    render(<SelectionBoxOverlay />);
    fireEvent.click(screen.getByRole('button', { name: /创建副本/ }));
    expect(storeApi.duplicateNodes).toHaveBeenCalledWith(['n1', 'n2']);
  });

  it('水平夹取：选框近左缘时工具条 left ≥ 8（clampToolbarX 接线——测量源=portal clientWidth + 工具条 offsetWidth，jsdom stub）', () => {
    rf.state.vp = { x: 0, y: 0, zoom: 1 };
    const portalEl = document.getElementById('node-toolbar-portal')!;
    Object.defineProperty(portalEl, 'clientWidth', { configurable: true, value: 1000 });
    const proto = HTMLElement.prototype as any;
    const orig = Object.getOwnPropertyDescriptor(proto, 'offsetWidth');
    Object.defineProperty(proto, 'offsetWidth', { configurable: true, value: 200 });
    try {
      // 近左缘：box left=-30 width=110 → centerX=25 → raw left=25-100=-75 → clamp 至 8
      rf.state.nodes = [mk('n1', 'imageGen', {}, { positionAbsolute: { x: 0, y: 300 } }), mk('n2', 'imageGen', {}, { positionAbsolute: { x: 10, y: 310 } })];
      const { unmount } = render(<SelectionBoxOverlay />);
      const toolbar = portal.children[1] as HTMLElement;
      expect(toolbar.style.left).toBe('8px');
      unmount();
      // 界内：box left=370 width=110 → centerX=425 → raw=325 在 [8, 792] 内取原值（translate(-50%) 已移除——left 即最终左缘）
      rf.state.nodes = [mk('n1', 'imageGen', {}, { positionAbsolute: { x: 400, y: 300 } }), mk('n2', 'imageGen', {}, { positionAbsolute: { x: 410, y: 310 } })];
      render(<SelectionBoxOverlay />);
      const toolbar2 = portal.children[1] as HTMLElement;
      expect(toolbar2.style.left).toBe('325px');
      expect(toolbar2.style.transform).toBe('translateY(-100%)');   // 翻转公式不变，仅 x 分量移除
    } finally {
      if (orig) Object.defineProperty(proto, 'offsetWidth', orig);
      else delete proto.offsetWidth;
      delete (portalEl as any).clientWidth;
    }
  });
});
