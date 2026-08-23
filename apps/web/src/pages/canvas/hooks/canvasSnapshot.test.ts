// apps/web/src/pages/canvas/hooks/canvasSnapshot.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadSnapshot, snapshotKey, SNAPSHOT_VERSION } from './canvasSnapshot';

const baseSnapshot = (over: Record<string, unknown> = {}) => ({
  version: SNAPSHOT_VERSION,
  nodes: { n1: { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } },
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  ...over,
});

describe('canvasSnapshot（parentMap 字段，Bug F）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('含合法 parentMap 的快照可加载', () => {
    localStorage.setItem(snapshotKey('p1'), JSON.stringify(baseSnapshot({
      parentMap: { n1: 'g1' },
    })));
    const snap = loadSnapshot('p1');
    expect(snap).not.toBeNull();
    expect(snap!.parentMap).toEqual({ n1: 'g1' });
  });

  it('旧快照（无 parentMap）仍可加载（向后兼容，不升版本）', () => {
    localStorage.setItem(snapshotKey('p1'), JSON.stringify(baseSnapshot()));
    const snap = loadSnapshot('p1');
    expect(snap).not.toBeNull();
    expect(snap!.parentMap).toBeUndefined();
  });

  it('parentMap 类型非法（数组）→ 校验失败，清除返回 null', () => {
    localStorage.setItem(snapshotKey('p1'), JSON.stringify(baseSnapshot({
      parentMap: [['n1', 'g1']],
    })));
    expect(loadSnapshot('p1')).toBeNull();
    expect(localStorage.getItem(snapshotKey('p1'))).toBeNull();
  });

  it('parentMap 值非字符串 → 校验失败，清除返回 null', () => {
    localStorage.setItem(snapshotKey('p1'), JSON.stringify(baseSnapshot({
      parentMap: { n1: 123 },
    })));
    expect(loadSnapshot('p1')).toBeNull();
  });

  it('parentMap 为 null → 宽松通过（可选字段语义）', () => {
    localStorage.setItem(snapshotKey('p1'), JSON.stringify(baseSnapshot({
      parentMap: null,
    })));
    expect(loadSnapshot('p1')).not.toBeNull();
  });
});
