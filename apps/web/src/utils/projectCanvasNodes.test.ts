import { describe, it, expect } from 'vitest';
import { projectCanvasNodes } from './projectCanvasNodes';

describe('projectCanvasNodes（几何取 cs、data 按所有权分型）', () => {
  it('组节点 data 取 cs（F42——组真值在 cs，ns 侧陈旧不污染）；普通节点 data 取 ns、ns 缺席回落 cs', () => {
    const cs = [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, parentId: null, width: 300, height: 250,
        data: { groupType: 'storyboard', storyboard: { aspectRatio: '1:1' } } },
      { id: 'n1', type: 'imageGen', position: { x: 5, y: 5 }, parentId: 'g1', width: 100, height: 60,
        data: { fileId: 'old' } },
    ];
    const ns = {
      g1: { id: 'g1', type: 'group', data: { groupType: 'storyboard' } },
      n1: { id: 'n1', type: 'imageGen', data: { fileId: 'new' } },
    };
    const out = projectCanvasNodes(cs as any, ns as any);
    expect(out.find((n) => n.id === 'g1')!.data.storyboard).toEqual({ aspectRatio: '1:1' });
    expect(out.find((n) => n.id === 'n1')!.data.fileId).toBe('new');
    const out2 = projectCanvasNodes([{ id: 'n2', type: 'textInput', position: { x: 0, y: 0 }, data: { content: 'x' } }] as any, {} as any);
    expect(out2[0].data).toEqual({ content: 'x' });
  });

  it('几何：width ?? null（不含 measured——v6 纪律三：渲染期量→doc 漂移源）；输出经 normalizeCanvasRecord（写侧真删键——无 null 键）', () => {
    const cs = [{ id: 'a', type: 'group', position: { x: 10, y: 20 }, parentId: null, width: undefined, height: 100, measured: { width: 280, height: 120 }, data: {} }];
    const out = projectCanvasNodes(cs as any, {} as any);
    expect(out[0].width).toBeUndefined();   // 注意：width 缺→normalizeCanvasRecord 真删键→undefined 而非 null
    expect(Object.keys(out[0]).includes('parentId')).toBe(false);
  });
});
