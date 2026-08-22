// apps/web/src/utils/groupDerive.test.ts
import { describe, it, expect } from 'vitest';
import { deriveHidden, repairStoryboardCells } from './groupDerive';

const group = (over: Record<string, unknown> = {}) => ({
  id: 'g1', type: 'group',
  data: { groupType: 'storyboard', ...over },
});

describe('deriveHidden', () => {
  it('parentId 指向分镜组 → 节点 hidden', () => {
    const { nodes } = deriveHidden(
      [group() as any, { id: 'n1', parentId: 'g1' } as any],
      [] as any,
    );
    expect(nodes.find((n) => n.id === 'n1')?.hidden).toBe(true);
  });

  it('parentId 指向 collapsed 普通组 → 节点 hidden', () => {
    const { nodes } = deriveHidden(
      [group({ groupType: 'normal', collapsed: true }) as any, { id: 'n1', parentId: 'g1' } as any],
      [] as any,
    );
    expect(nodes.find((n) => n.id === 'n1')?.hidden).toBe(true);
  });

  it('展开的普通组子节点不 hidden', () => {
    const { nodes } = deriveHidden(
      [group({ groupType: 'normal', collapsed: false }) as any, { id: 'n1', parentId: 'g1' } as any],
      [] as any,
    );
    expect(nodes.find((n) => n.id === 'n1')?.hidden).toBe(false);
  });

  it('任一端 hidden 的边 → 边 hidden', () => {
    const { edges } = deriveHidden(
      [group() as any, { id: 'n1', parentId: 'g1' } as any, { id: 'n2' } as any],
      [{ id: 'e1', source: 'n1', target: 'n2' }, { id: 'e2', source: 'n2', target: 'n2' }],
    );
    expect(edges.find((e) => e.id === 'e1')?.hidden).toBe(true);
    expect(edges.find((e) => e.id === 'e2')?.hidden).toBe(false);
  });
});

describe('repairStoryboardCells（cells/parentId 一致性守卫）', () => {
  it('子节点不在 cells 中 → 移出组并给绝对坐标（不堆叠原点）', () => {
    const g = { id: 'g1', type: 'group', position: { x: 500, y: 500 }, width: 642, height: 182,
      data: { groupType: 'storyboard', cells: ['a'] } };
    const stray = { id: 'stray', parentId: 'g1', extent: 'parent', position: { x: 0, y: 0 } };
    const nodes = repairStoryboardCells([
      g as any, { id: 'a', parentId: 'g1' } as any, stray as any,
    ] as any);
    const s = nodes.find((n: any) => n.id === 'stray')!;
    expect(s.parentId).toBeUndefined();
    expect(s.extent).toBeUndefined();
    expect(s.position.x).toBeGreaterThanOrEqual(500); // 绝对坐标 = 组位置 + 偏移
    expect(s.position.y).toBeGreaterThanOrEqual(500 + 182); // 排在组下方
  });

  it('cells 与子节点一致 → 原样返回', () => {
    const input = [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 },
        data: { groupType: 'storyboard', cells: ['a'] } },
      { id: 'a', parentId: 'g1', position: { x: 0, y: 0 } },
    ] as any;
    expect(repairStoryboardCells(input)).toEqual(input);
  });
});
