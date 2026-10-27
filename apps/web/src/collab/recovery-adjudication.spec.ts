// apps/web/src/collab/recovery-adjudication.spec.ts
// Y1c T25b 面 B（spec I-1 承接——plan :338 登记）：恢复用户面数据层用例。
//   ★B2 红形态=「现不可达」——DRAFT_MERGE_ANOMALY_KINDS（shared draft-envelope.ts:95-110 冻结
//     词表）零生产消费面：检测函数不存在（import 红）→实装绿（不阻断语义=只读检测纯函数）。
//   ★B1 红形态=「现不可达」——DRAFT_FIELD_CHOICE_DEFAULT/resolveAdjudicatedFieldValues 已在
//     （shared 冻结）零 UI 数据面：裁定视图/采纳信封函数不存在（import 红）→实装绿。
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  DRAFT_FIELD_CHOICE_DEFAULT, DRAFT_MERGE_ANOMALY_KINDS, resolveAdjudicatedFieldValues,
  sha256HexSource, type DraftEnvelope,
} from './recovery-adjudication';

const node = (id: string, data: Record<string, unknown>, parentId?: string, type = 'imageGen') =>
  ({ id, type, ...(parentId ? { parentId } : {}), position: { x: 0, y: 0 }, data });
const edge = (id: string, source: string, target: string) => ({ id, source, target });

describe('T25b B2：A 场景合并异常检测（DRAFT_MERGE_ANOMALY_KINDS 接通——不阻断只读观察）', () => {
  it('★五 kind 词表逐项可检测（duplicate-order/duplicate-slot/dangling-edge/cross-group-parent/cells-out-of-bounds）', () => {
    const nodes = [
      node('a', { order: 'o1' }),
      node('b', { order: 'o1' }),                                    // duplicate-order（同层同 order）
      node('c', { slot: 1 }, 'g1'),
      node('d', { slot: 1 }, 'g1'),                                  // duplicate-slot（同组同格位）
      node('e', { slot: 9 }, 'g1'),                                  // cells-out-of-bounds（2x2 容量 slot 9 越界）
      node('f', {}, 'n1'),                                           // cross-group-parent（父非组——n1 是 imageGen）
      node('g1', { groupType: 'storyboard', storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: false, stitchResolution: '2K' } }, undefined, 'group'),
      node('n1', {}),
    ];
    const edges = [edge('e1', 'a', 'b'), edge('e-dangling', 'a', 'ghost')];   // 后者悬挂
    const r = detectDraftMergeAnomaliesForTest({ nodes, edges });
    expect(Object.keys(r).sort()).toEqual([...DRAFT_MERGE_ANOMALY_KINDS].sort());
    expect(r['duplicate-order']).toBe(2);
    expect(r['duplicate-slot']).toBe(2);
    expect(r['dangling-edge']).toBe(1);
    expect(r['cross-group-parent']).toBe(1);
    expect(r['cells-out-of-bounds']).toBe(1);
  });

  it('干净画布=空报告（无 kind 键——不谎报）', () => {
    const r = detectDraftMergeAnomaliesForTest({
      nodes: [node('a', { order: 'o1' }), node('b', { order: 'o2' })],
      edges: [edge('e1', 'a', 'b')],
    });
    expect(r).toEqual({});
  });
});

// 检测面 re-export 断言（生产接线 import 单源）
import { detectDraftMergeAnomalies } from './recovery-adjudication';
const detectDraftMergeAnomaliesForTest = detectDraftMergeAnomalies;

describe('T25b B1：B 场景逐字段裁定数据面（默认保留当前+删除显式确认+新增导入）', () => {
  const envelope = (): DraftEnvelope => ({
    draftId: 'd-1', projectId: 'p1', generation: 3, schemaVersion: 3, historyId: 'h1',
    capturedAtMs: 1, tabId: 't1',
    nodes: [
      { id: 'n1', type: 'imageGen', data: { prompt: '草稿文案', style: 'same' } } as never,
      { id: 'n2', type: 'imageGen', data: { prompt: '新增节点' } } as never,
    ],
    edges: [],
    meta: {},
    hashes: { nodes: 'x', edges: 'y' },
  });
  const current = [
    node('n1', { prompt: '当前文案', style: 'same' }),   // prompt 冲突；style 等值非冲突
    node('n3', { prompt: '被删节点' }),                   // current-only=删除确认候选
  ];

  it('★裁定视图：修改字段逐字段冲突行（等值字段不入）+新增节点+删除候选三分派', () => {
    const v = buildRecoveryAdjudicationViewForTest(envelope(), current);
    expect(v.conflicts).toEqual([
      { nodeId: 'n1', key: 'prompt', currentValue: '当前文案', draftValue: '草稿文案' },
    ]);
    expect(v.additions.map((a) => a.id)).toEqual(['n2']);
    expect(v.deletions.map((d) => d.id)).toEqual(['n3']);
  });

  it('★默认保留当前（DRAFT_FIELD_CHOICE_DEFAULT 单源——未选字段 resolve 出口 chosen=current）', () => {
    const conflicts = [{ nodeId: 'n1', key: 'prompt', currentValue: '当前文案', draftValue: '草稿文案' }];
    const r = resolveAdjudicatedFieldValues(conflicts, { adoptedNodeIds: [], fieldChoices: {}, deletionConfirmations: [] });
    expect(r[0]).toEqual({ nodeId: 'n1', key: 'prompt', chosen: 'current', value: '当前文案' });
    expect(DRAFT_FIELD_CHOICE_DEFAULT).toBe('current');
  });

  it('★采纳信封：仅新增节点（新 draftId+重算 hashes——服务端 hash 完整性门可过）', async () => {
    const adopted = await buildAdoptedEnvelopeForTest(envelope(), ['n2']);
    expect(adopted).not.toBeNull();
    expect(adopted!.draftId).not.toBe('d-1');
    expect(adopted!.nodes.map((n) => n.id)).toEqual(['n2']);
    expect(adopted!.hashes.nodes).toBe(await sha256HexSource(JSON.stringify(adopted!.nodes)));
    expect(adopted!.hashes.edges).toBe(await sha256HexSource(JSON.stringify(adopted!.edges)));
    // 空采纳=null（无 REST 调用——调用面短路）
    expect(await buildAdoptedEnvelopeForTest(envelope(), [])).toBeNull();
  });
});

// 检测面/视图面生产单源 import（红锚=模块不存在→import 失败）
import { buildRecoveryAdjudicationView, buildAdoptedEnvelope } from './recovery-adjudication';
const buildRecoveryAdjudicationViewForTest = buildRecoveryAdjudicationView;
const buildAdoptedEnvelopeForTest = buildAdoptedEnvelope;

// Y.Doc 型 not-used 守卫（装置保留位）
void Y;
