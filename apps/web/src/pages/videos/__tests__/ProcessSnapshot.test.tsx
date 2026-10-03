import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ProcessSnapshot, FALLBACK } from '../ProcessSnapshot';
import { VIDEO_WORK_NODE_TYPES } from '@flowweb/shared';
import type { ProcessSnapshotData } from '@flowweb/shared';

// O0c-2 换芯后夹具语义：n3=分镜子（payload 保留 data——cellNodes 载荷取图）→ RF 不产独立节点；
// g1 无 storyboard config → resolveStoryboardConfig 默认 1×1 16:9 → 派生帧 320×180（≠280×120 兜底防撞锚）。
const snap: ProcessSnapshotData = {
  workId: 'w1', title: 't',
  nodes: [
    { id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { content: '一只猫在窗台上' } },
    { id: 'n2', type: 'imageGen', position: { x: 300, y: 0 }, data: { prompt: 'cat', thumbnailUrl: '/flowai/th.webp' } },
    { id: 'g1', type: 'group', position: { x: 500, y: 0 }, data: { groupType: 'storyboard', cells: ['n3'] } },
    { id: 'n3', type: 'videoGen', position: { x: 520, y: 20 }, parentId: 'g1', data: { label: '导出 1', thumbnailUrl: '/flowai/cell.webp' } },
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
};
/** 可见节点（RF 产出）——O0c-2 deriveRenderCanvas 剔除 hidden（分镜子/collapsed 子代）后 */
const VISIBLE = 3; // n1/n2/g1（n3 分镜子剔除）

describe('ProcessSnapshot（spec §5.3 红线）', () => {
  it('每个渲染节点默认 Handle×2：.react-flow__handle 数 === 可见节点数×2', () => {
    const { container } = render(<ProcessSnapshot snapshot={snap} />);
    const handles = container.querySelectorAll('.react-flow__handle');
    expect(handles.length).toBe(VISIBLE * 2);   // 缺 Handle → 边全丢（isNodeInitialized 早退静默丢弃、不报 error008——spec §5.3 第八轮措辞，plan 第九轮对齐）
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

  it('组框：groupType=storyboard 渲染分镜宫格 shell（O0c-2 复用抽取组件——data-group-type 标记随 GroupFrame 让位于 shell token）', () => {
    const { container } = render(<ProcessSnapshot snapshot={snap} />);
    expect(container.querySelector('[style*="--canvas-storyboard-shell-bg"]')).toBeTruthy(); // StoryboardGroupRenderer shell（与主画布同一 CSS grid 布局层）
  });
});

// ─── 兜底表与满框版式（spec v3.1 P5a）───
// fixture 追加：ve1=videoEdit 无持久化尺寸（canvasStore 建节点只设 width、协作持久化只存 width/height，
// 未拖拽的 videoEdit 快照无 height——兜底表是主路径）；cx1=未知类型（snapshot-filter 保留未知类型节点）；
// O0c-2 追加：g2=manual 组（三键密封 240×160@1000,200）+n4=组子（abs 1020,280→RenderNode rel 20,80——rel 语义验证面）
const snap2: ProcessSnapshotData = {
  ...snap,
  nodes: [
    ...snap.nodes,
    { id: 've1', type: 'videoEdit', position: { x: 800, y: 0 }, data: {} },
    { id: 'cx1', type: 'customX', position: { x: 900, y: 0 }, data: {} },
    { id: 'g2', type: 'group', position: { x: 1000, y: 200 }, width: 240, height: 160, data: { groupType: 'normal' } },
    { id: 'n4', type: 'textInput', position: { x: 1020, y: 280 }, parentId: 'g2', data: { content: '组内' } },
  ],
};
const VISIBLE2 = 7; // n1/n2/g1/ve1/cx1/g2/n4（n3 分镜子剔除）

describe('ProcessSnapshot 兜底表（spec v3.1 P5a 红线）', () => {
  it('videoEdit 无持久化尺寸 → wrapper inline style 320×110', () => {
    render(<ProcessSnapshot snapshot={snap2} />);
    const ve = screen.getByTestId('rf__node-ve1');
    expect(ve.style.width).toBe('320px');
    expect(ve.style.height).toBe('110px');
  });

  it('未知类型 → 280×120（nodeHasDimensions && 判定的兜底默认——组不走本兜底，O0c-2 组路径双删）', () => {
    render(<ProcessSnapshot snapshot={snap2} />);
    const cx = screen.getByTestId('rf__node-cx1');
    expect(cx.style.width).toBe('280px');
    expect(cx.style.height).toBe('120px');
  });

  it('红线：全部渲染节点 visibility 非 hidden 且 inline 尺寸非空；节点数=可见节点数（O0c-2 改写——分镜子/collapsed 子代不进 RF 数组）', () => {
    const { container } = render(<ProcessSnapshot snapshot={snap2} />);
    const nodes = container.querySelectorAll('.react-flow__node');
    expect(nodes.length).toBe(VISIBLE2);
    expect(screen.queryByTestId('rf__node-n3')).toBeNull(); // 分镜子无独立 RF 节点
    for (const n of nodes) {
      const el = n as HTMLElement;
      expect(el.style.visibility).not.toBe('hidden');
      expect(el.style.width).not.toBe('');
      expect(el.style.height).not.toBe('');
    }
  });

  it('coverage：FALLBACK ⊇ VIDEO_WORK_NODE_TYPES−{group}（O0c-2 组行删——组帧恒 deriveRenderCanvas 派生）∧ 符号级断言 FALLBACK 不含 group 键', () => {
    for (const t of VIDEO_WORK_NODE_TYPES) {
      if (t === 'group') continue; // 组兜底双删（与 canvas 侧 nodeTypes ⊆ 清单构成两环全链条——group 环由派生帧接管）
      expect(FALLBACK[t]).toBeDefined();
    }
    expect(Object.keys(FALLBACK)).not.toContain('group'); // 符号级：组路径在兜底表零残留
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

  it('transform 对齐（O0c-2 按 RenderNode rel 语义改写）：组子 wrapper=组帧 abs+rel ≡ 原 abs（双加链死）；模板无空格', () => {
    render(<ProcessSnapshot snapshot={snap2} />);
    expect(screen.getByTestId('rf__node-n1').style.transform).toMatch(/translate\(0px,0px\)/);
    expect(screen.getByTestId('rf__node-n2').style.transform).toMatch(/translate\(300px,0px\)/);
    expect(screen.getByTestId('rf__node-g1').style.transform).toMatch(/translate\(500px,0px\)/);       // 顶层组=帧 abs
    expect(screen.getByTestId('rf__node-g2').style.transform).toMatch(/translate\(1000px,200px\)/);    // manual 密封帧
    expect(screen.getByTestId('rf__node-n4').style.transform).toMatch(/translate\(1020px,280px\)/);    // g2(1000,200)+rel(20,80)≡abs——旧 translate(2020px,…) 双加形态已死
  });
});

// ─── O0c-2（Spec B）：deriveRenderCanvas 换芯——第 4 渲染面与主画布同一派生链 ───
// collapsed 夹具：g3=collapsed manual 组（三键密封 400×300@1500,100）→ 派生帧 COLLAPSED_SIZE 220×160@密封 origin；
// n5=collapsed 子代 → RF 剔除；e2 端点=n5 → 边集过滤（无悬空）。
const snapCollapsed: ProcessSnapshotData = {
  workId: 'w1', title: 't',
  nodes: [
    { id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { content: '一只猫在窗台上' } },
    { id: 'g3', type: 'group', position: { x: 1500, y: 100 }, width: 400, height: 300, data: { groupType: 'normal', collapsed: true } },
    { id: 'n5', type: 'imageGen', position: { x: 1560, y: 160 }, parentId: 'g3', data: { prompt: 'x', thumbnailUrl: '/flowai/hid.webp' } },
  ],
  edges: [
    { id: 'e1', source: 'n1', target: 'g3' },
    { id: 'e2', source: 'n1', target: 'n5' }, // 端点被剔除 → 整条过滤
  ],
};

describe('ProcessSnapshot deriveRenderCanvas 换芯（O0c-2）', () => {
  it('快照组帧≡deriveGroupFrame 逐位：storyboard 默认 1×1 16:9 → 320×180（≠280×120 兜底防撞锚——派生帧≠兜底值）', () => {
    render(<ProcessSnapshot snapshot={snap} />);
    const g1 = screen.getByTestId('rf__node-g1');
    expect(g1.style.width).toBe('320px');   // calcStoryboardSize(1,1,'16:9')
    expect(g1.style.height).toBe('180px');
  });

  it('分镜子不产独立节点但 data 经 cellNodes 保留：格子取图走 thumbnailUrl 通道（公开页无 fileId——泄漏红线）', () => {
    const { container } = render(<ProcessSnapshot snapshot={snap} />);
    expect(screen.queryByTestId('rf__node-n3')).toBeNull();                                   // RF 数组剔除
    expect(container.querySelector('img[src="/flowai/cell.webp"]')).toBeTruthy();              // payload 保留 data（cellNodes 载荷）
  });

  it('collapsed 组：派生帧=COLLAPSED_SIZE@密封 origin，子代剔除（边集无悬空断言在 shared renderCanvas.test——jsdom RO no-op 下 RF 恒零边渲染，DOM 级边数不可观测）', () => {
    render(<ProcessSnapshot snapshot={snapCollapsed} />);
    const g3 = screen.getByTestId('rf__node-g3');
    expect(g3.style.transform).toMatch(/translate\(1500px,100px\)/); // 密封 origin（帧键保持展开态值不动）
    expect(g3.style.width).toBe('220px');                            // COLLAPSED_SIZE
    expect(g3.style.height).toBe('160px');
    expect(screen.queryByTestId('rf__node-n5')).toBeNull();          // collapsed 子代剔除（e2 端点随剔——shared 侧钉边集过滤）
  });
});
