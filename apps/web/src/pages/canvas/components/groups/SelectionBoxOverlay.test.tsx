// apps/web/src/pages/canvas/components/groups/SelectionBoxOverlay.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const rf = vi.hoisted(() => {
  const state = { nodes: [] as any[], vp: { x: 0, y: 0, zoom: 1 } };
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
  useCanvasStore: (sel: any) => sel({ nodes: rf.state.nodes.filter((n) => n.selected), groupNodes: storeApi.groupNodes }),
}));

import { SelectionBoxOverlay } from './SelectionBoxOverlay';

describe('SelectionBoxOverlay', () => {
  let portal: HTMLDivElement;
  beforeEach(() => {
    portal = document.createElement('div');
    portal.id = 'node-toolbar-portal';
    document.body.appendChild(portal);
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
    expect(box.style.left).toBe('194px');  // 100*2+10-16
    expect(box.style.top).toBe('352px');   // 200*2+20-16-26*2（标题浮层随流坐标缩放）
    expect(box.style.width).toBe('132px'); // 50*2+32
    expect(box.style.height).toBe('164px');// 40*2+32+26*2
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
    expect(toolbar.style.top).toBe('68px'); // -16 + 72 + 12（height = 40×1 + 32 = 72）
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
});
