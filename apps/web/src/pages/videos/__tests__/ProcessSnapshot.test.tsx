import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ProcessSnapshot, FALLBACK } from '../ProcessSnapshot';
import { VIDEO_WORK_NODE_TYPES } from '@flowweb/shared';
import type { ProcessSnapshotData } from '@flowweb/shared';

const snap: ProcessSnapshotData = {
  workId: 'w1', title: 't',
  nodes: [
    { id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { content: '一只猫在窗台上' } },
    { id: 'n2', type: 'imageGen', position: { x: 300, y: 0 }, data: { prompt: 'cat', thumbnailUrl: '/flowai/th.webp' } },
    { id: 'g1', type: 'group', position: { x: 500, y: 0 }, data: { groupType: 'storyboard', cells: ['n3'] } },
    { id: 'n3', type: 'videoGen', position: { x: 520, y: 20 }, parentId: 'g1', data: { label: '导出 1' } },
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
};

describe('ProcessSnapshot（spec §5.3 红线）', () => {
  it('每个节点渲染默认 Handle×2：.react-flow__handle 数 === nodes×2', () => {
    const { container } = render(<ProcessSnapshot snapshot={snap} />);
    const handles = container.querySelectorAll('.react-flow__handle');
    expect(handles.length).toBe(snap.nodes.length * 2);   // 缺 Handle → 边全丢（isNodeInitialized 早退静默丢弃、不报 error008——spec §5.3 第八轮措辞，plan 第九轮对齐）
  });

  it('纯文本渲染：content 含 XSS 载荷时以字面文本显示、不产生 img（第八轮：真喂载荷——旧夹具无任何 HTML 是恒真断言，"XSS 夹具"名不副实）', () => {
    const withXssPayload = { ...snap, nodes: [{ ...snap.nodes[0], data: { content: '<img src=x onerror=alert(1)>一只猫在窗台上' } }] };
    const { container, getByText } = render(<ProcessSnapshot snapshot={withXssPayload} />);
    expect(getByText('<img src=x onerror=alert(1)>一只猫在窗台上')).toBeInTheDocument(); // 字面文本整串（React 文本节点自动转义）
    expect(container.querySelectorAll('img')).toHaveLength(0); // 该 fixture 无 thumbnailUrl——出现任何 img 即 dangerouslySetInnerHTML 侧漏
  });

  it('缩略图展示：thumbnailUrl 渲染为 img', () => {
    const { container } = render(<ProcessSnapshot snapshot={snap} />);
    expect(container.querySelector('img[src="/flowai/th.webp"]')).toBeTruthy();
  });

  it('组框：groupType=storyboard 渲染分镜样式（data-group-type 标记）', () => {
    const { container } = render(<ProcessSnapshot snapshot={snap} />);
    expect(container.querySelector('[data-group-type="storyboard"]')).toBeTruthy();
  });
});

// ─── 兜底表与满框版式（spec v3.1 P5a）───
// fixture 追加：ve1=videoEdit 无持久化尺寸（canvasStore 建节点只设 width、协作持久化只存 width/height，
// 未拖拽的 videoEdit 快照无 height——兜底表是主路径）；cx1=未知类型（snapshot-filter 保留未知类型节点）
const snap2: ProcessSnapshotData = {
  ...snap,
  nodes: [
    ...snap.nodes,
    { id: 've1', type: 'videoEdit', position: { x: 800, y: 0 }, data: {} },
    { id: 'cx1', type: 'customX', position: { x: 900, y: 0 }, data: {} },
  ],
};

describe('ProcessSnapshot 兜底表（spec v3.1 P5a 红线）', () => {
  it('videoEdit 无持久化尺寸 → wrapper inline style 320×110', () => {
    render(<ProcessSnapshot snapshot={snap2} />);
    const ve = screen.getByTestId('rf__node-ve1');
    expect(ve.style.width).toBe('320px');
    expect(ve.style.height).toBe('110px');
  });

  it('未知类型 → 280×120（nodeHasDimensions && 判定的兜底默认）', () => {
    render(<ProcessSnapshot snapshot={snap2} />);
    const cx = screen.getByTestId('rf__node-cx1');
    expect(cx.style.width).toBe('280px');
    expect(cx.style.height).toBe('120px');
  });

  it('红线：全部节点 visibility 非 hidden 且 inline 尺寸非空（jsdom RO no-op → measured 恒 undefined，钉兜底表穷尽性）', () => {
    const { container } = render(<ProcessSnapshot snapshot={snap2} />);
    const nodes = container.querySelectorAll('.react-flow__node');
    expect(nodes.length).toBe(snap2.nodes.length);
    for (const n of nodes) {
      const el = n as HTMLElement;
      expect(el.style.visibility).not.toBe('hidden');
      expect(el.style.width).not.toBe('');
      expect(el.style.height).not.toBe('');
    }
  });

  it('coverage：FALLBACK ⊇ VIDEO_WORK_NODE_TYPES（与 canvas 侧 nodeTypes ⊆ 清单构成两环全链条——删任一侧不红，勿拆）', () => {
    for (const t of VIDEO_WORK_NODE_TYPES) {
      expect(FALLBACK[t]).toBeDefined();
    }
  });

  it('SimpleNode 满框版式：根 w-full h-full + 缩略图铺满 + 底部信息条', () => {
    const { container } = render(<ProcessSnapshot snapshot={snap2} />);
    const inner = screen.getByTestId('rf__node-n2').querySelector('div'); // wrapper 之下第一个 div = SimpleNode 根
    expect(inner?.className).toContain('w-full');
    expect(inner?.className).toContain('h-full');
    const thumb = container.querySelector('img[src="/flowai/th.webp"]');
    expect(thumb?.className).toContain('absolute');
    expect(thumb?.className).toContain('inset-0');
    expect(screen.getByTestId('rf__node-n2').innerHTML).toContain('bg-black/60'); // 底部信息条
  });

  it('transform 对齐：wrapper translate 与快照 position 一致（模板无空格；有 parentId 的 n3 按 positionAbsolute 绝对坐标 g1(500,0)+n3(520,20)）', () => {
    render(<ProcessSnapshot snapshot={snap2} />);
    expect(screen.getByTestId('rf__node-n1').style.transform).toMatch(/translate\(0px,0px\)/);
    expect(screen.getByTestId('rf__node-n2').style.transform).toMatch(/translate\(300px,0px\)/);
    expect(screen.getByTestId('rf__node-n3').style.transform).toMatch(/translate\(1020px,20px\)/);
  });
});
