// apps/web/src/utils/groupDerive.test.ts
import { describe, it, expect } from 'vitest';
import { deriveHiddenMap, edgeHidden } from './groupDerive';

const group = (over: Record<string, unknown> = {}, id = 'g1') => ({
  id, type: 'group',
  data: { groupType: 'storyboard', ...over },
});

describe('deriveHiddenMap（hidden 推导图——O0b-4 起 cs 写者唯一=reconcileGroupGeometry）', () => {
  it('parentId 指向分镜组 → 节点 hidden', () => {
    const map = deriveHiddenMap([group() as any, { id: 'n1', parentId: 'g1' } as any]);
    expect(map.get('n1')).toBe(true);
  });

  it('parentId 指向 collapsed 普通组 → 节点 hidden', () => {
    const map = deriveHiddenMap([group({ groupType: 'normal', collapsed: true }) as any, { id: 'n1', parentId: 'g1' } as any]);
    expect(map.get('n1')).toBe(true);
  });

  it('展开的普通组子节点不 hidden', () => {
    const map = deriveHiddenMap([group({ groupType: 'normal', collapsed: false }) as any, { id: 'n1', parentId: 'g1' } as any]);
    expect(map.get('n1')).toBe(false);
  });

  it('任一端 hidden 的边 → 边 hidden', () => {
    const map = deriveHiddenMap([group() as any, { id: 'n1', parentId: 'g1' } as any, { id: 'n2' } as any]);
    expect(edgeHidden({ source: 'n1', target: 'n2' }, map)).toBe(true);
    expect(edgeHidden({ source: 'n2', target: 'n2' }, map)).toBe(false);
  });
});
