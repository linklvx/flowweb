// GroupToolbar.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const rf = vi.hoisted(() => ({ vp: { x: 0, y: 0, zoom: 1 }, node: null as any }));
const cs = vi.hoisted(() => ({ nodes: [] as any[] }));
const ns = vi.hoisted(() => ({ state: {} as Record<string, any> }));
const storeApi = vi.hoisted(() => ({
  setGroupColor: vi.fn(),
  arrangeGroupChildren: vi.fn(),
}));
const batchDl = vi.hoisted(() => ({ runBatchDownload: vi.fn() }));

vi.mock('@xyflow/react', () => ({
  useViewport: () => rf.vp,
  useInternalNode: () => rf.node,
}));
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: (sel: any) => sel({ nodes: cs.nodes, setGroupColor: storeApi.setGroupColor, arrangeGroupChildren: storeApi.arrangeGroupChildren }),
}));
vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: (sel: any) => sel({ nodes: ns.state }),
}));
vi.mock('@/utils/batchDownload', () => ({ runBatchDownload: batchDl.runBatchDownload }));

import { GroupToolbar } from './GroupToolbar';

const baseProps = {
  groupId: 'g1',
  groupType: 'normal' as const,
  collapsed: false,
  executing: false,
  onCollapse: vi.fn(), onExecute: vi.fn(), onUngroup: vi.fn(), onConvert: vi.fn(),
};

// 全局 portal setup（对所有 describe 生效）
beforeEach(() => {
  const portal = document.createElement('div');
  portal.id = 'node-toolbar-portal';
  document.body.appendChild(portal);
  storeApi.setGroupColor.mockClear();
  storeApi.arrangeGroupChildren.mockClear();
  batchDl.runBatchDownload.mockClear();
  cs.nodes = [{ id: 'g1', type: 'group', data: {} }];
  ns.state = {};
});
afterEach(() => document.getElementById('node-toolbar-portal')?.remove());

// 定位用最小 internalNode mock
const mkRfNode = (absX: number, absY: number) => ({
  id: 'g1', measured: { width: 400, height: 300 }, internals: { positionAbsolute: { x: absX, y: absY } },
});

describe('GroupToolbar（普通组）', () => {
  beforeEach(() => {
    rf.vp = { x: 0, y: 0, zoom: 1 };
    rf.node = mkRfNode(100, 200);
  });

  it('按钮行布局：[色点][排列子节点▾] │ [折叠][整组执行][转分镜组][解组] │ [批量下载]', () => {
    render(<GroupToolbar {...baseProps} />);
    const toolbar = document.getElementById('node-toolbar-portal')!.firstElementChild!;
    const labels = [...toolbar.querySelectorAll('button')].map(
      (b) => b.getAttribute('aria-label') ?? b.textContent ?? '',
    );
    expect(labels).toEqual([
      '组颜色', '排列子节点 ▾', '折叠', '▶ 整组执行', '▦ 转分镜组', '⧉ 解组', '批量下载',
    ]);
  });

  it('执行中禁用结构变更按钮', () => {
    render(<GroupToolbar {...baseProps} executing />);
    expect((screen.getByRole('button', { name: /解组/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /转分镜组/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /折叠/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('点击折叠触发 onCollapse', () => {
    render(<GroupToolbar {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /折叠/ }));
    expect(baseProps.onCollapse).toHaveBeenCalledWith('g1');
  });
});

describe('色板浮层（§4.3 listbox 规格）', () => {
  beforeEach(() => {
    rf.vp = { x: 0, y: 0, zoom: 1 };
    rf.node = mkRfNode(100, 200);
  });

  it('点击色点开浮层：7 色选项 + 默认，aria-selected 标当前色，选择即写色并收起', () => {
    cs.nodes = [{ id: 'g1', type: 'group', data: { color: 'red' } }];
    render(<GroupToolbar {...baseProps} />);
    const dotBtn = screen.getByRole('button', { name: '组颜色' });
    expect(dotBtn).toHaveAttribute('aria-haspopup', 'listbox');
    expect(dotBtn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(dotBtn);
    expect(dotBtn).toHaveAttribute('aria-expanded', 'true');
    const listbox = screen.getByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['红', '橙', '黄', '绿', '青', '蓝', '紫', '默认']);
    expect(within(listbox).getByRole('option', { name: '红' })).toHaveAttribute('aria-selected', 'true');
    expect(within(listbox).getByRole('option', { name: '蓝' })).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(within(listbox).getByRole('option', { name: '蓝' }));
    expect(storeApi.setGroupColor).toHaveBeenCalledWith('g1', 'blue');
    expect(screen.queryByRole('listbox')).toBeNull(); // 选中即收起
  });

  it('未设色时「默认」aria-selected=true；点默认 → setGroupColor(groupId, undefined)（清色）', () => {
    cs.nodes = [{ id: 'g1', type: 'group', data: {} }];
    render(<GroupToolbar {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '组颜色' }));
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByRole('option', { name: '默认' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(listbox).getByRole('option', { name: '默认' }));
    expect(storeApi.setGroupColor).toHaveBeenCalledWith('g1', undefined);
  });

  it('Esc 关 + mousedown 点外关', () => {
    render(<GroupToolbar {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '组颜色' }));
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '组颜色' }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('排列子节点（§4.3 menu 规格）', () => {
  beforeEach(() => {
    rf.vp = { x: 0, y: 0, zoom: 1 };
    rf.node = mkRfNode(100, 200);
  });

  it('菜单 3 项（网格/水平/垂直）→ arrangeGroupChildren(groupId, mode)，选中即收起', () => {
    render(<GroupToolbar {...baseProps} />);
    const btn = screen.getByRole('button', { name: /排列子节点/ });
    expect(btn).toHaveAttribute('aria-haspopup', 'menu');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((el) => el.textContent)).toEqual(['网格', '水平', '垂直']);
    fireEvent.click(within(menu).getByText('水平'));
    expect(storeApi.arrangeGroupChildren).toHaveBeenCalledWith('g1', 'horizontal');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('折叠组 → 排列按钮 disabled（store 守卫为第二层）', () => {
    render(<GroupToolbar {...baseProps} collapsed />);
    const btn = screen.getByRole('button', { name: /排列子节点/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

describe('批量下载（组闭包复用 runBatchDownload）', () => {
  beforeEach(() => {
    rf.vp = { x: 0, y: 0, zoom: 1 };
    rf.node = mkRfNode(100, 200);
  });

  it('组内含完成图片 → 点击以 collectDownloadables 结果调用 runBatchDownload', () => {
    cs.nodes = [
      { id: 'g1', type: 'group', data: {} },
      { id: 'i1', type: 'imageGen', parentId: 'g1', data: { status: 'done', fileId: 'f1', mediaName: '封面.png' } },
    ];
    ns.state = {
      g1: { id: 'g1', type: 'group', data: {} },
      i1: { id: 'i1', type: 'imageGen', data: { status: 'done', fileId: 'f1', mediaName: '封面.png' } },
    };
    render(<GroupToolbar {...baseProps} />);
    const btn = screen.getByRole('button', { name: '批量下载' });
    expect(btn).toHaveAttribute('aria-disabled', 'false');
    fireEvent.click(btn);
    expect(batchDl.runBatchDownload).toHaveBeenCalledTimes(1);
    expect(batchDl.runBatchDownload).toHaveBeenCalledWith([
      { fileId: 'f1', filename: '封面.png', type: 'imageGen' },
    ]);
  });

  it('无可下载成员 → aria-disabled=true，点击不触发', () => {
    cs.nodes = [
      { id: 'g1', type: 'group', data: {} },
      { id: 't1', type: 'textInput', parentId: 'g1', data: {} },
    ];
    ns.state = { g1: { id: 'g1', type: 'group', data: {} }, t1: { id: 't1', type: 'textInput', data: {} } };
    render(<GroupToolbar {...baseProps} />);
    const btn = screen.getByRole('button', { name: '批量下载' });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(btn);
    expect(batchDl.runBatchDownload).not.toHaveBeenCalled();
  });
});

describe('GroupToolbar 定位（GROUP_TOOLBAR 52/12）', () => {
  beforeEach(() => {
    rf.vp = { x: 0, y: 0, zoom: 1 };
    rf.node = mkRfNode(100, 200);
  });

  it('定位在组 bounds 上方居中（偏移 12 屏幕常量；isAbove 阈值含 height 52）', () => {
    rf.node = mkRfNode(100, 200);
    // left 断言经 clamp：jsdom clientWidth 恒 0（夹取下界收敛 8），stub 视口宽使 clamp 为无操作
    const portalEl = document.getElementById('node-toolbar-portal')!;
    Object.defineProperty(portalEl, 'clientWidth', { configurable: true, value: 1000 });
    try {
      render(<GroupToolbar {...baseProps} />);
      const toolbar = portalEl.firstElementChild as HTMLElement;
      expect(toolbar.style.left).toBe('300px'); // 100 + 400/2（centerX；toolbarW 未测得 0 → 原始左缘 = centerX）
      expect(toolbar.style.top).toBe('188px');  // 200 - 12，translateY(-100%)
    } finally {
      delete (portalEl as any).clientWidth;
    }
  });

  it('组贴顶时翻转到下方（isAbove = 0 - 12 - 52 < 0）', () => {
    rf.node = mkRfNode(100, 0);
    render(<GroupToolbar {...baseProps} />);
    const toolbar = document.getElementById('node-toolbar-portal')!.firstElementChild as HTMLElement;
    expect(toolbar.style.top).toBe('312px'); // 0 + 300 + 12，translateY(0)
  });

  it('internalNode 不可用时不渲染', () => {
    rf.node = null;
    const { container } = render(<GroupToolbar {...baseProps} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('水平夹取：组近左缘时工具条 left ≥ 8（clampToolbarX 接线——测量源=portal clientWidth + 工具条 offsetWidth，jsdom stub）', () => {
    rf.vp = { x: 0, y: 0, zoom: 1 };
    const portalEl = document.getElementById('node-toolbar-portal')!;
    Object.defineProperty(portalEl, 'clientWidth', { configurable: true, value: 1000 });
    const proto = HTMLElement.prototype as any;
    const orig = Object.getOwnPropertyDescriptor(proto, 'offsetWidth');
    Object.defineProperty(proto, 'offsetWidth', { configurable: true, value: 200 });
    try {
      // 近左缘：centerX = -100 + 400/2 = 100 → raw left = 100 - 200/2 = 0 → clamp 至 8
      rf.node = mkRfNode(-100, 200);
      const { unmount } = render(<GroupToolbar {...baseProps} />);
      const toolbar = portalEl.firstElementChild as HTMLElement;
      expect(toolbar.style.left).toBe('8px');
      expect(toolbar.style.transform).toBe('translateY(-100%)'); // 翻转公式仅保留纵向分量
      unmount();
      // 界内：centerX = 400 + 200 = 600 → raw = 500 在 [8, 792] 内取原值
      rf.node = mkRfNode(400, 200);
      render(<GroupToolbar {...baseProps} />);
      const toolbar2 = portalEl.firstElementChild as HTMLElement;
      expect(toolbar2.style.left).toBe('500px');
    } finally {
      if (orig) Object.defineProperty(proto, 'offsetWidth', orig);
      else delete proto.offsetWidth;
      delete (portalEl as any).clientWidth;
    }
  });
});

describe('GroupToolbar storyboard 分带（R2d-5 offset 12→32 = 标题带 gap 12 + titleRowH 20）', () => {
  beforeEach(() => {
    rf.vp = { x: 0, y: 0, zoom: 1 };
    rf.node = mkRfNode(100, 200);
  });

  it('storyboard 组工具条带锚 = frame.top − 32（上方让出标题带；normal 分支维持 188px 不受影响）', () => {
    // 双 render 共用同一 portal 容器——先卸载再挂 normal，避免 firstElementChild 取到上一实例
    const { unmount } = render(<GroupToolbar {...baseProps} groupType="storyboard" />);
    const toolbar = document.getElementById('node-toolbar-portal')!.firstElementChild as HTMLElement;
    expect(toolbar.style.top).toBe('168px'); // 200 − 12 − 20
    expect(toolbar.style.transform).toBe('translateY(-100%)');
    unmount();
    render(<GroupToolbar {...baseProps} groupType="normal" />);
    const normalToolbar = document.getElementById('node-toolbar-portal')!.firstElementChild as HTMLElement;
    expect(normalToolbar.style.top).toBe('188px'); // 200 − 12（分带只动 storyboard 分支）
  });

  it('storyboard 贴顶翻转到下方：下方分支同用 offset 32（isAbove = 0 − 32 − 52 < 0）', () => {
    rf.node = mkRfNode(100, 0);
    render(<GroupToolbar {...baseProps} groupType="storyboard" />);
    const toolbar = document.getElementById('node-toolbar-portal')!.firstElementChild as HTMLElement;
    expect(toolbar.style.top).toBe('332px'); // 0 + 300 + 32，translateY(0)
    expect(toolbar.style.transform).toBe('translateY(0)');
  });
});
