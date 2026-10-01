// apps/web/src/utils/collectDownloadables.test.ts
import { describe, it, expect } from 'vitest';
import type { CanvasNodeRecord } from '@flowweb/shared';
import { collectDownloadables } from './collectDownloadables';

const node = (id: string, type: string, data: Record<string, unknown>, parentId?: string): CanvasNodeRecord =>
  ({ id, type, position: { x: 0, y: 0 }, ...(parentId ? { parentId } : {}), data });

const toNsMap = (nodes: CanvasNodeRecord[]) => (): Record<string, CanvasNodeRecord> =>
  nodes.reduce((m, n) => ({ ...m, [n.id]: n }), {} as Record<string, CanvasNodeRecord>);

describe('collectDownloadables（participation download=闭包全展开含 hidden）', () => {
  it('图片三型：imageGen 完成=fileId||referenceImage；multiImageGen 主图=images[mainImageIndex]（success）否则首个 success 否则跳过（F15）', () => {
    const nodes: CanvasNodeRecord[] = [
      node('i1', 'imageGen', { status: 'done', fileId: 'f1' }),
      node('i2', 'imageGen', { status: 'done', referenceImage: 'r1' }),
      node('m1', 'multiImageGen', { images: [{ id: 'x1', status: 'failed' }, { id: 'x2', status: 'success' }], mainImageIndex: 0 }),
      node('v1', 'videoGen', { status: 'done', fileId: 'vf1' }),
    ];
    const r = collectDownloadables(nodes, nodes.map((n) => n.id), toNsMap(nodes));
    expect(r.map((x) => x.fileId)).toEqual(['f1', 'r1', 'x2', 'vf1']);
    expect(r.map((x) => x.filename)).toContain('图片-i1');
  });

  it('选组 → 闭包展开为成员（含折叠组 hidden 成员——v1 空壳缺陷回归锚）', () => {
    const g = node('g1', 'group', { collapsed: true });
    const c1 = node('c1', 'imageGen', { status: 'done', fileId: 'cf1' }, 'g1');
    const c2 = node('c2', 'videoGen', { status: 'done', fileId: 'cv1' }, 'g1');
    const nodes = [g, c1, c2];
    const r = collectDownloadables(nodes, ['g1'], toNsMap(nodes));
    expect(r.map((x) => x.fileId)).toEqual(['cf1', 'cv1']);
  });

  it('mainImageIndex 探针（M8）：cs 陈旧 + ns 新值 → 取 ns 新值（resolveNodeData ns 优先）', () => {
    // cs 快照陈旧（旧图 old + 旧主图下标 0）；ns 已再生（新图集 + 主图下标 1）→ 必须采 ns
    const cs = [node('m1', 'multiImageGen', { images: [{ id: 'old', status: 'success' }], mainImageIndex: 0 })];
    const ns = [node('m1', 'multiImageGen', { images: [{ id: 'x1', status: 'failed' }, { id: 'x2', status: 'success' }], mainImageIndex: 1 })];
    const r = collectDownloadables(cs, ['m1'], toNsMap(ns));
    expect(r.map((x) => x.fileId)).toEqual(['x2']);
  });
});
