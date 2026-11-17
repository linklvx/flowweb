// apps/web/src/stores/projectCanvas.equivalence.test.ts
// Y2 第①步（A2a 红测宿主）：projectCanvas 等价域对拍+墓碑+格子覆盖——projectCanvas 在 apps/web，
// packages/shared 无法反向 import，本文件=等价域唯一宿主（编译级红先例 frame-deny.spec:2 头注）。
// 等价域定义（spec D1）：gesture/runtime/mediaFacts/localPreview 皆空 + liveFrame 不传时，
// projectCanvas 的节点几何/parent/hidden 剔除/边集与 deriveRenderCanvas 逐位相等——
// 禁手写第二套帧算法（反目标 2）。比较面=几何/parent/hidden 剔除/边集（执行覆盖叠 data 键
// 不在比较面——覆盖语义本来如此）。
// 墓碑（spec D1 装配序步 1）：活动墓碑节点在进内核之前剔除——死节点不进 auto 组帧（组 origin
// 不受死节点影响）、不进 cellNodes；谓词=现有 isActiveTombstone（不重写）。
// 分镜子被 hidden 剔除时 cellNodes 仍有内容——格子覆盖按格子 id 回到剔除前作者记录取值
//（只遍历 React Flow 输出节点的格子是空的——真红锚）。
import { describe, it, expect } from 'vitest';
import { projectCanvas } from '../utils/projectCanvas';
import {
  deriveRenderCanvas, isActiveTombstone, GROUP_PADDING,
  type RenderSourceNode, type RuntimeProjection,
} from '@flowweb/shared';

/** 对拍夹具：manual/auto/storyboard/collapsed 四组态+顶层+悬空边（几何族全模式覆盖）。 */
const RECORDS: RenderSourceNode[] = [
  { id: 'g1', type: 'group', position: { x: 100, y: 50 }, width: 400, height: 300, data: { groupType: 'normal' } },
  { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 120, y: 80 }, width: 100, height: 60, data: { fileId: 'm-c1' } },
  { id: 'g2', type: 'group', data: { groupType: 'normal' } },
  { id: 'c2', type: 'imageGen', parentId: 'g2', position: { x: 300, y: 100 }, width: 200, height: 100, data: {} },
  { id: 'c3', type: 'imageGen', parentId: 'g2', position: { x: 550, y: 100 }, width: 150, height: 80, data: {} },
  {
    id: 'sb', type: 'group', position: { x: 0, y: 400 },
    data: { groupType: 'storyboard', storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: true, stitchResolution: '2K' } },
  },
  { id: 's1', type: 'imageGen', parentId: 'sb', width: 320, height: 180, data: { slot: 0, fileId: 'm-s1' } },
  { id: 's2', type: 'imageGen', parentId: 'sb', width: 320, height: 180, data: { slot: 1 } },
  { id: 't1', type: 'textInput', position: { x: 700, y: 0 }, data: {} },
  { id: 'col', type: 'group', data: { groupType: 'normal', collapsed: true } },
  { id: 'cc1', type: 'textInput', parentId: 'col', position: { x: 10, y: 10 }, data: {} },
];
const EDGES = [
  { id: 'e1', source: 't1', target: 'c2' },
  { id: 'e2', source: 'cc1', target: 't1' },   // cc1 被折叠组剔除→悬空删
  { id: 'e3', source: 't1', target: 'ghost' }, // 未知端→悬空删
];

const EMPTY_OVERLAYS = {
  mediaFacts: new Map(),
  gesture: new Map(),
  localPreview: new Map(),
};

/** 等价域比较投影：几何/parent/hidden 剔除面（id 集即剔除面）。 */
const geom = (n: { id: string; type: string; parentId?: string; position: { x: number; y: number }; width?: number; height?: number }) => ({
  id: n.id, type: n.type, parentId: n.parentId, position: n.position, width: n.width, height: n.height,
});

describe('Y2 等价域：projectCanvas ≡ deriveRenderCanvas（空覆盖逐位对拍）', () => {
  it('空覆盖下节点几何/parent/hidden 剔除/边集逐位相等', () => {
    const out = projectCanvas({ readModel: { records: RECORDS, edges: EDGES }, runtime: null, ...EMPTY_OVERLAYS });
    const ref = deriveRenderCanvas({ records: RECORDS, edges: EDGES });
    expect(out.nodes.map(geom)).toEqual(ref.nodes.map(geom));
    expect(out.edges).toEqual(ref.edges);
    // 折叠子 cc1 剔除、分镜子 s1/s2 剔除（storyboard hidesChildren）——剔除面一致
    expect(out.nodes.map((n) => n.id)).toEqual(ref.nodes.map((n) => n.id));
    expect(out.nodes.map((n) => n.id)).not.toContain('cc1');
  });

  it('liveFrame 不传形态：公开页同参直调 deriveRenderCanvas 与 projectCanvas 空覆盖输出一致', () => {
    const out = projectCanvas({ readModel: { records: RECORDS }, runtime: null, ...EMPTY_OVERLAYS });
    const ref = deriveRenderCanvas({ records: RECORDS });
    expect(out.nodes.map(geom)).toEqual(ref.nodes.map(geom));
    expect(out.edges).toEqual([]);
  });
});

describe('Y2 墓碑：前置剔除（进内核之前）', () => {
  const tombstone = (v: string): RuntimeProjection => ({
    projectId: 'p', generation: 1, feedSeq: '0', pgSeq: '0',
    nodes: { c2: { deletedAt: { lifecycleSeq: '1', nodeVersion: v } } },
  });

  it('活动墓碑节点不进 auto 组帧——组 origin 不受死节点影响', () => {
    expect(isActiveTombstone(tombstone('5').nodes.c2!)).toBe(true);
    const out = projectCanvas({ readModel: { records: RECORDS, edges: EDGES }, runtime: tombstone('5'), ...EMPTY_OVERLAYS });
    // 参照=从记录里删掉 c2 再 deriveRenderCanvas（墓碑≡前置剔除）
    const ref = deriveRenderCanvas({ records: RECORDS.filter((r) => r.id !== 'c2'), edges: EDGES });
    expect(out.nodes.map(geom)).toEqual(ref.nodes.map(geom));
    // c2 在左（x=300）、c3 在右（x=550）：墓碑后 g2 origin 只剩 c3（x=550−padding——calcGroupBounds 单源）
    const g2 = out.nodes.find((n) => n.id === 'g2')!;
    expect(g2.position.x).toBe(550 - GROUP_PADDING);
  });

  it('活动墓碑节点不进 cellNodes', () => {
    const runtime: RuntimeProjection = {
      projectId: 'p', generation: 1, feedSeq: '0', pgSeq: '0',
      nodes: { s1: { deletedAt: { lifecycleSeq: '1', nodeVersion: '5' } } },
    };
    const out = projectCanvas({ readModel: { records: RECORDS, edges: EDGES }, runtime, ...EMPTY_OVERLAYS });
    const sb = out.nodes.find((n) => n.id === 'sb')!;
    const cellIds = (sb.data.cellNodes as Array<{ id: string }>).map((c) => c.id);
    expect(cellIds).toEqual(['s2']);
  });
});

describe('Y2 格子覆盖：分镜子被 hidden 剔除时 cellNodes 仍有内容（回剔除前作者记录）', () => {
  it('格子 mediaId 按格子 id 回剔除前作者记录取值——作者键胜、产物回落', () => {
    const runtime: RuntimeProjection = {
      projectId: 'p', generation: 1, feedSeq: '0', pgSeq: '0',
      nodes: {
        s2: { artifact: { mediaId: 'm-art-s2', artifactRev: 1, nodeVersion: '3' } },
      },
    };
    const out = projectCanvas({ readModel: { records: RECORDS, edges: EDGES }, runtime, ...EMPTY_OVERLAYS });
    const sb = out.nodes.find((n) => n.id === 'sb')!;
    expect(sb.data.cellNodes).toBeDefined();
    const cells = sb.data.cellNodes as Array<{ id: string; mediaId?: string }>;
    expect(cells).toHaveLength(2);   // s1/s2 均被 hidden 剔除出 React Flow 列表，但格子仍在
    const s1cell = cells.find((c) => c.id === 's1')!;
    const s2cell = cells.find((c) => c.id === 's2')!;
    expect(s1cell.mediaId).toBe('m-s1');      // 作者键（data.fileId 过渡期）胜
    expect(s2cell.mediaId).toBe('m-art-s2');  // 无作者键→运行时产物回落
  });

  it('localPreview 只在主槽解析为空时盖面', () => {
    const out = projectCanvas({
      readModel: { records: RECORDS, edges: EDGES },
      runtime: null,
      ...EMPTY_OVERLAYS,
      localPreview: new Map([['s1', 'blob:preview-s1'], ['s2', 'blob:preview-s2'], ['t1', 'blob:preview-t']]),
    });
    const sb = out.nodes.find((n) => n.id === 'sb')!;
    const cells = sb.data.cellNodes as Array<{ id: string; mediaId?: string; previewUrl?: string }>;
    const s1cell = cells.find((c) => c.id === 's1')!;
    const s2cell = cells.find((c) => c.id === 's2')!;
    expect(s1cell.previewUrl).toBeUndefined(); // s1 有作者键→不盖
    expect(s2cell.previewUrl).toBe('blob:preview-s2'); // s2 解析为空→盖
    const t1 = out.nodes.find((n) => n.id === 't1')!;
    expect((t1.data as Record<string, unknown>).previewUrl).toBe('blob:preview-t');
  });
});

describe('Y2 手势折入：gesture 折进记录再进内核', () => {
  it('叶子 position 折入（会话活值），组 resize 会话矩形作 liveFrame（storyboard 帧尺寸=会话值）', () => {
    const gesture = new Map([
      ['c1', { position: { x: 999, y: 888 } }],
      ['sb', { position: { x: 0, y: 400 }, width: 640, height: 360 }],
    ]);
    const out = projectCanvas({ readModel: { records: RECORDS, edges: EDGES }, runtime: null, ...EMPTY_OVERLAYS, gesture });
    const c1 = out.nodes.find((n) => n.id === 'c1')!;
    expect(c1.position.x).toBe(999 - 100);   // rel=abs−组 origin（g1 manual origin=100）
    expect(c1.position.y).toBe(888 - 50);
    const sb = out.nodes.find((n) => n.id === 'sb')!;
    expect(sb.width).toBe(640);              // liveFrame 会话矩形（storyboard 值面）
    expect(sb.height).toBe(360);
  });
});

describe('Y2 执行覆盖：主槽解析雏形（过渡期 data.fileId 非空用它，否则运行时产物）', () => {
  it('渲染节点携带解析主槽+execStatus（只来自投影）', () => {
    const runtime: RuntimeProjection = {
      projectId: 'p', generation: 1, feedSeq: '0', pgSeq: '0',
      nodes: {
        c1: { execStatus: { status: 'running', nodeVersion: '2' }, artifact: { mediaId: 'm-art-c1', artifactRev: 1, nodeVersion: '3' } },
        c2: { execStatus: { status: 'done', nodeVersion: '4' } },
        t1: { artifact: { mediaId: 'm-art-t1', artifactRev: 1, nodeVersion: '1' } },
      },
    };
    const out = projectCanvas({ readModel: { records: RECORDS, edges: EDGES }, runtime, ...EMPTY_OVERLAYS });
    const c1 = out.nodes.find((n) => n.id === 'c1')!;
    expect((c1.data as Record<string, unknown>).mediaId).toBe('m-c1');   // 作者键胜过产物
    expect((c1.data as Record<string, unknown>).execStatus).toBe('running');
    const c2 = out.nodes.find((n) => n.id === 'c2')!;
    expect((c2.data as Record<string, unknown>).mediaId).toBeUndefined(); // 无作者键无产物→空
    expect((c2.data as Record<string, unknown>).execStatus).toBe('done');
    const t1 = out.nodes.find((n) => n.id === 't1')!;
    expect((t1.data as Record<string, unknown>).mediaId).toBe('m-art-t1'); // 产物回落
    expect((t1.data as Record<string, unknown>).execStatus).toBeUndefined(); // 无投影→无键（unknown≠idle）
  });
});
