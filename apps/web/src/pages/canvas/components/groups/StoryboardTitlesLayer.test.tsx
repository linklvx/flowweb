// StoryboardTitlesLayer.test.tsx — R2d-5 分镜智能标题屏幕层
// 范围裁定：jsdom getBoundingClientRect 恒 0——窄组「标题带/工具条带两 rect 不相交」在 vitest 里
// 恒真假绿，交由 2d-8 浏览器/Playwright 实测；本文件只锁两条带数值公式、13px/ellipsis 样式与 pointer-events 约定。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  vp: { x: 0, y: 0, zoom: 1 },
  vpCalls: 0,
}));
const cs = vi.hoisted(() => ({ nodes: [] as any[] }));

vi.mock('@xyflow/react', () => ({
  useViewport: () => { h.vpCalls += 1; return h.vp; },
}));
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: (sel: any) => sel({ nodes: cs.nodes }),
}));

import { StoryboardTitlesLayer } from './StoryboardTitlesLayer';

const sbGroup = (id: string, x: number, y: number, data: Record<string, unknown> = {}) => ({
  id, type: 'group', position: { x, y }, data: { groupType: 'storyboard', cells: ['a', 'b'], ...data },
});

beforeEach(() => {
  h.vp = { x: 0, y: 0, zoom: 1 };
  h.vpCalls = 0;
  cs.nodes = [];
});

describe('StoryboardTitlesLayer', () => {
  it('自动名：nameCustom 缺省 → 「分镜组 N 个节点」，N=cells.filter(Boolean).length（null/undefined 槽位不计）', () => {
    cs.nodes = [sbGroup('g1', 100, 200, { cells: ['a', null, 'b', undefined, 'c'] })];
    render(<StoryboardTitlesLayer />);
    expect(screen.getByText('分镜组 3 个节点')).toBeTruthy();
  });

  it('自定义名：nameCustom=true → 显示 data.name（2d-6 renameGroup 置位后的消费面）', () => {
    cs.nodes = [sbGroup('g1', 0, 0, { name: '我的分镜', nameCustom: true })];
    render(<StoryboardTitlesLayer />);
    expect(screen.getByText('我的分镜')).toBeTruthy();
  });

  it('单例共享层：N 组渲染 N 标题但仅 1 次 useViewport 订阅（Layer 实例数=1——非每组一订阅）', () => {
    cs.nodes = [sbGroup('g1', 0, 0), sbGroup('g2', 300, 0), sbGroup('g3', 600, 0)];
    render(<StoryboardTitlesLayer />);
    expect(screen.getAllByTestId('storyboard-title')).toHaveLength(3);
    expect(h.vpCalls).toBe(1);
  });

  it('标题带公式：top = frame.top·zoom + vp.y − 12，left = frame.left·zoom + vp.x（SelectionBoxOverlay flow→screen 同式）', () => {
    h.vp = { x: 10, y: 20, zoom: 2 };
    cs.nodes = [sbGroup('g1', 100, 200)];
    render(<StoryboardTitlesLayer />);
    const title = screen.getByTestId('storyboard-title') as HTMLElement;
    expect(title.style.top).toBe('408px'); // 200*2 + 20 − 12（标题带锚，translateY(-100%) 后行高 20 占 [top−20, top]）
    expect(title.style.left).toBe('210px'); // 100*2 + 10（左对齐组左缘）
    expect(title.style.transform).toBe('translateY(-100%)');
  });

  it('恒 13px 不随 zoom 缩放 + 限宽省略（maxWidth 240/ellipsis/nowrap）+ 弱化色 token', () => {
    h.vp = { x: 0, y: 0, zoom: 3 };
    cs.nodes = [sbGroup('g1', 0, 0)];
    render(<StoryboardTitlesLayer />);
    const title = screen.getByTestId('storyboard-title') as HTMLElement;
    expect(title.style.fontSize).toBe('13px'); // zoom=3 仍 13px 屏幕常量
    expect(title.style.maxWidth).toBe('240px');
    expect(title.style.overflow).toBe('hidden');
    expect(title.style.textOverflow).toBe('ellipsis');
    expect(title.style.whiteSpace).toBe('nowrap');
    expect(title.style.color).toBe('var(--fw-text-dim-3)');
  });

  it('pointer-events 约定：Layer 容器与标题文本均 none（标题不可点；SelectionBoxOverlay box none 先例）', () => {
    cs.nodes = [sbGroup('g1', 0, 0)];
    render(<StoryboardTitlesLayer />);
    const layer = screen.getByTestId('storyboard-titles-layer');
    const title = screen.getByTestId('storyboard-title') as HTMLElement;
    expect(layer.style.pointerEvents).toBe('none');
    expect(title.style.pointerEvents).toBe('none');
  });

  it('常驻非选中门控：只渲染 storyboard 组（normal 组/普通节点不进屏幕层；无任何选中态参与）', () => {
    cs.nodes = [
      sbGroup('g1', 0, 0),
      { id: 'n1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal', name: '普通组' } },
      { id: 'n2', type: 'imageGen', position: { x: 0, y: 0 }, data: {} },
    ];
    render(<StoryboardTitlesLayer />);
    expect(screen.getAllByTestId('storyboard-title')).toHaveLength(1);
    expect(screen.queryByText('普通组')).toBeNull();
  });
});
