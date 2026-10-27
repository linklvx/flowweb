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
import { buildRecoveryAdjudicationView, buildAdoptedEnvelope, buildAdjudicatedImport } from './recovery-adjudication';
const buildRecoveryAdjudicationViewForTest = buildRecoveryAdjudicationView;
const buildAdoptedEnvelopeForTest = buildAdoptedEnvelope;

// ═══ T25b 收口 I-3：裁定结果 typed REST 载荷（禁 doc 写承载裁定）═══
describe('T25b 收口 I-3：buildAdjudicatedImport（裁定→typed 导入载荷）', () => {
  const ENV = (): DraftEnvelope => ({
    draftId: 'd-i3', projectId: 'p1', generation: 3, schemaVersion: 3, historyId: 'h1',
    capturedAtMs: 1, tabId: 't1',
    nodes: [
      { id: 'n1', type: 'imageGen', data: { prompt: '草稿文案', style: '同值' } } as never,
      { id: 'n2', type: 'imageGen', data: { prompt: '新增节点' } } as never,
      { id: 'n9', type: 'imageGen', data: { prompt: '全保留节点' } } as never,   // 冲突面但全选 current=不导入
    ],
    edges: [{ id: 'e1', source: 'n1', target: 'n2' } as never, { id: 'e2', source: 'n1', target: 'ghost' } as never],
    meta: {},
    hashes: { nodes: 'x', edges: 'y' },
  });
  const SERVER = [
    { id: 'n1', type: 'imageGen', data: { prompt: '当前文案', style: '同值' } },
    { id: 'n9', type: 'imageGen', data: { prompt: '当前全保留', other: 'v' } },
    { id: 'n3', type: 'imageGen', data: { prompt: '被删节点' } },
  ];

  it('★裁定载荷三面：draft 选域节点 replace 导入（current 字段回写服务端值）+采纳新增+删除确认集——全 current 零动作面=null', async () => {
    const out = await buildAdjudicatedImport(ENV(), SERVER, {
      adoptedIds: ['n2'],
      fieldChoices: { n1: { prompt: 'draft', style: 'current' }, n9: {} },
      deletionIds: ['n3'],
    });
    expect(out).not.toBeNull();
    // 载荷节点=n1（replace——prompt 取草稿值）+n2（采纳新增）；n9 全 current 不入（服务端现态已正确）
    expect(out!.envelope.nodes.map((n) => n.id).sort()).toEqual(['n1', 'n2']);
    const n1 = out!.envelope.nodes.find((n) => n.id === 'n1')!;
    expect((n1.data as Record<string, unknown>).prompt).toBe('草稿文案');   // draft 选域=草稿值承载
    expect(out!.conflictChoices).toEqual({ n1: 'replace' });               // 冲突节点导入=显式 replace（#9 默认 skip 不覆盖）
    expect(out!.deletionNodeIds).toEqual(['n3']);                          // 删除确认 typed 承载
    // 边：e1 两端在载荷∪服务端集保留；e2 ghost 端缺席丢弃
    expect(out!.envelope.edges.map((e) => e.id)).toEqual(['e1']);
    // 新 draftId+重算 hashes（服务端完整性门）
    expect(out!.envelope.draftId).not.toBe('d-i3');
    expect(out!.envelope.hashes.nodes).toBe(await sha256HexSource(JSON.stringify(out!.envelope.nodes)));
    // 全 current+零采纳+零删除=null（零 REST 短路）
    const none = await buildAdjudicatedImport(ENV(), SERVER, { adoptedIds: [], fieldChoices: { n1: { prompt: 'current' } }, deletionIds: [] });
    expect(none).toBeNull();
  });

  it('★微批 I-1/I-5 mixed-pick：同节点多差异字段只显式选其一 draft——未触碰字段=服务端值（默认保留当前=DRAFT_FIELD_CHOICE_DEFAULT 单源语义；修前 {...draftData} 起底=未触碰字段以草稿值静默覆盖服务端）', async () => {
    const envMixed = (): DraftEnvelope => ({
      draftId: 'd-mix', projectId: 'p1', generation: 3, schemaVersion: 3, historyId: 'h1',
      capturedAtMs: 1, tabId: 't1',
      nodes: [
        { id: 'n1', type: 'imageGen', data: { prompt: '草稿文案', style: '草稿风格', ratio: '16:9' } } as never,
      ],
      edges: [], meta: {},
      hashes: { nodes: 'x', edges: 'y' },
    });
    const serverMixed = [
      { id: 'n1', type: 'imageGen', data: { prompt: '当前文案', style: '当前风格', ratio: '16:9' } },   // prompt+style 两差异字段；ratio 等值
    ];
    const out = await buildAdjudicatedImport(envMixed(), serverMixed, {
      adoptedIds: [],
      fieldChoices: { n1: { prompt: 'draft' } },   // 仅 prompt 显式 draft——style 未触碰（默认=保留当前）
      deletionIds: [],
    });
    const n1 = out!.envelope.nodes.find((n) => n.id === 'n1')!;
    const data = n1.data as Record<string, unknown>;
    expect(data.prompt).toBe('草稿文案');     // 显式 draft 选域=草稿值
    expect(data.style).toBe('当前风格');       // ★修前：'草稿风格'（未触碰字段草稿值混入=契约击穿〔红〕）
    expect(data.ratio).toBe('16:9');           // 等值字段不受扰
  });

  it('★微批 I-1/I-5 单源语义：等值字段显式 draft 选=同值 no-op（非冲突面零裁定行——node 不入载荷）；current 选域回写服务端值归 mixed-pick 用例锁', async () => {
    // n1 prompt 差异面选 current（默认保留当前=零写）+style 等值面显式 draft（值相同=no-op）
    // ⇒ 无任何冲突行 draft 胜出=node 不入载荷（全 current=服务端现态已正确——shared
    // resolveAdjudicatedFieldValues 单源：判定只及冲突行，等值键无裁定面）
    const out = await buildAdjudicatedImport(ENV(), SERVER, {
      adoptedIds: [],
      fieldChoices: { n1: { prompt: 'current', style: 'draft' } },
      deletionIds: [],
    });
    expect(out).toBeNull();
  });
});

// Y.Doc 型 not-used 守卫（装置保留位）
void Y;
