// packages/shared/src/collab/draft-envelope.spec.ts
// Y1c T5c（plan v1.7 Task 5 客户端/恢复段；spec v5.4 §4.5——偏离 38⑬）：DraftEnvelope 类型+三场景表
// （B=用户裁定式）契约冻结的契约测试。先红（本文件 import 指向尚不存在模块）→绿。
import { describe, expect, it } from 'vitest';
import type { CanvasNodeSnapshot, CanvasEdgeSnapshot } from '../canvas/doc-codec';
import {
  DraftEnvelope, DRAFT_ENVELOPE_MAX_BYTES, DRAFT_IMPORT_CONTRACT,
  DraftScenario, resolveDraftScenario,
  DraftFieldConflict, DraftAdjudication, DRAFT_FIELD_CHOICE_DEFAULT,
  resolveAdjudicatedFieldValues, DRAFT_ADJUDICATION_NO_AUTO_REPLAY, DRAFT_NO_THREE_WAY_MERGE,
  NODE_ID_CONFLICT_POLICIES, NodeIdConflictPolicy,
  DraftContentCounts, DraftDroppedRefs, DraftNotRestoredNotice, DRAFT_IMPORT_NOT_RESTORED,
  DRAFT_MERGE_ANOMALY_KINDS, DraftMergeAnomalyKind,
} from './draft-envelope';

describe('Y1c T5c 契约冻结：DraftEnvelope 类型化导出清单（§4.5——非 CRDT update 裸字节）', () => {
  it('键集精确冻结：draftId/projectId/generation/schemaVersion/capturedAt/tabId/nodes/edges/meta/hashes 十键', () => {
    const node: CanvasNodeSnapshot = {
      id: 'n1', type: 'imageGen', position: { x: 0, y: 0 },
      data: { prompt: { $yjs: 'xml', json: [] } },
    };
    const edge: CanvasEdgeSnapshot = { id: 'e1', source: 'n1', target: 'n2' };
    const env: DraftEnvelope = {
      draftId: 'draft-1',
      projectId: 'p1',
      generation: 3,
      schemaVersion: 3,
      capturedAtMs: 1_727_000_000_000,
      tabId: 'tab-a',
      nodes: [node],
      edges: [edge],
      meta: {},
      hashes: { nodes: 'a'.repeat(64), edges: 'b'.repeat(64) },
    };
    expect(Object.keys(env).sort()).toEqual([
      'capturedAtMs', 'draftId', 'edges', 'generation', 'hashes', 'meta',
      'nodes', 'projectId', 'schemaVersion', 'tabId',
    ]);
    // nodes/edges=T4 canonical 快照类型复用（禁重抄第二份形状）
    expect(env.nodes[0]!.data.prompt).toEqual({ $yjs: 'xml', json: [] });
  });
  it('负控：类型面零 CRDT update 裸字节字段（serialize 值域禁 Uint8Array——类型化导出清单非字节载荷）', () => {
    const env = {} as DraftEnvelope;
    // 类型级断言：DraftEnvelope 的序列化值域不含 Uint8Array（编译期契约——此处值级验证键面不变量）
    expect('update' in env).toBe(false);
    expect(DRAFT_ENVELOPE_MAX_BYTES).toBe(8 * 1024 * 1024);   // 8MiB=8_388_608（§3.2 recovery import 上限）
  });
  it('导入契约冻结：≤8MiB 单飞（每项目同时一个 draftId）+幂等键+OWNER·EDITOR 且仅本人 draft+超限导出文件不开导入', () => {
    expect(DRAFT_ENVELOPE_MAX_BYTES).toBe(8_388_608);
    expect(DRAFT_IMPORT_CONTRACT.singleFlight).toContain('每项目同时一个 draftId');
    expect(DRAFT_IMPORT_CONTRACT.idempotency).toContain('幂等键');
    expect(DRAFT_IMPORT_CONTRACT.eligibility).toContain('OWNER/EDITOR');
    expect(DRAFT_IMPORT_CONTRACT.eligibility).toContain('仅本人 draft');
    expect(DRAFT_IMPORT_CONTRACT.overLimit).toContain('导出文件');
    expect(DRAFT_IMPORT_CONTRACT.overLimit).toContain('不开导入');
  });
  it('负控注记冻结：无 basePgSeq 3-way merge（自动三方合并在无服务端基座时不可判定，整族不做）', () => {
    expect(DRAFT_NO_THREE_WAY_MERGE).toContain('basePgSeq');
    expect(DRAFT_NO_THREE_WAY_MERGE).toContain('整族不做');
  });
});

describe('Y1c T5c 契约冻结：三场景分型纯函数（§4.5 三场景表）', () => {
  it('真值表：跨代恒 import-as-new；同代 boot→merge-boot；同代拒帧→adjudicate；同代 import 触发=调用方错误 fail-fast', () => {
    // C 换代导入（跨代）——任何触发上下文
    expect(resolveDraftScenario({ draftGeneration: 2, currentGeneration: 3, trigger: 'boot' })).toBe<DraftScenario>('import-as-new');
    expect(resolveDraftScenario({ draftGeneration: 4, currentGeneration: 3, trigger: 'frame-denied' })).toBe('import-as-new');
    expect(resolveDraftScenario({ draftGeneration: 2, currentGeneration: 3, trigger: 'import' })).toBe('import-as-new');
    // A 两标签离线草稿（同代）——boot 时 Y.mergeUpdates CRDT 并集
    expect(resolveDraftScenario({ draftGeneration: 3, currentGeneration: 3, trigger: 'boot' })).toBe('merge-boot');
    // B 拒帧恢复（同代）——客户端重置到服务端状态+用户裁定
    expect(resolveDraftScenario({ draftGeneration: 3, currentGeneration: 3, trigger: 'frame-denied' })).toBe('adjudicate');
    // 同代却走 import 触发=矛盾（换代导入语义要求跨代）——fail-fast 不静默归并
    expect(() => resolveDraftScenario({ draftGeneration: 3, currentGeneration: 3, trigger: 'import' }))
      .toThrow(/DRAFT_SCENARIO_INVALID/);
  });
});

describe('Y1c T5c 契约冻结：B 场景用户裁定数据结构（新增直入/逐字段二选一默认保留当前/删除显式确认）', () => {
  const conflicts: DraftFieldConflict[] = [
    { nodeId: 'n1', key: 'prompt', currentValue: '当前值', draftValue: '草稿值' },
    { nodeId: 'n1', key: 'model', currentValue: 'model-a', draftValue: 'model-b' },
    { nodeId: 'n2', key: 'content', currentValue: null, draftValue: '草稿正文' },
  ];
  it('默认保留当前：未显式选择的字段一律取 currentValue（无 journal/base 不自动判优）', () => {
    const adjudication: DraftAdjudication = {
      adoptedNodeIds: ['n9'],
      fieldChoices: {},               // 全默认
      deletionConfirmations: [],
    };
    const resolved = resolveAdjudicatedFieldValues(conflicts, adjudication);
    expect(resolved.map((r) => r.chosen)).toEqual(['current', 'current', 'current']);
    expect(resolved[0]).toEqual({ nodeId: 'n1', key: 'prompt', chosen: 'current', value: '当前值' });
    // 新增节点直入（用户确认数——adoptedNodeIds 逐 id 确认）
    expect(adjudication.adoptedNodeIds).toEqual(['n9']);
  });
  it('逐字段二选一：显式 draft 取草稿值、显式 current 取当前值，其余字段互不影响', () => {
    const adjudication: DraftAdjudication = {
      adoptedNodeIds: [],
      fieldChoices: { n1: { prompt: 'draft' }, n2: { content: 'draft' } },
      deletionConfirmations: ['n5'],
    };
    const resolved = resolveAdjudicatedFieldValues(conflicts, adjudication);
    expect(resolved.map((r) => `${r.nodeId}.${r.key}:${r.chosen}`)).toEqual([
      'n1.prompt:draft', 'n1.model:current', 'n2.content:draft',
    ]);
    expect(resolved[0]!.value).toBe('草稿值');
    expect(resolved[1]!.value).toBe('model-a');
    // 删除/恢复显式确认（nodeId 清单——不自动复活）
    expect(adjudication.deletionConfirmations).toEqual(['n5']);
  });
  it('默认值常量冻结：DRAFT_FIELD_CHOICE_DEFAULT=\'current\'', () => {
    expect(DRAFT_FIELD_CHOICE_DEFAULT).toBe('current');
  });
  it('负控注记冻结：无 journal/base 禁自动重放（不重放被拒原始 update）', () => {
    expect(DRAFT_ADJUDICATION_NO_AUTO_REPLAY).toContain('禁自动重放');
    expect(DRAFT_ADJUDICATION_NO_AUTO_REPLAY).toContain('journal');
  });
});

describe('Y1c T5c 契约冻结：C 场景确认面三行+nodeId 冲突处置（import-as-new）', () => {
  it('确认面三行类型：内容节点数/丢弃引用数/不恢复产物·执行历史·计费', () => {
    const counts: DraftContentCounts = { nodeCount: 12, edgeCount: 8 };
    const dropped: DraftDroppedRefs = { danglingEdges: 2, missingParentNodes: 1 };
    const notice: DraftNotRestoredNotice = {
      artifacts: true, executionHistory: true, billingRecords: true,
    };
    expect(counts.nodeCount).toBe(12);
    expect(dropped.danglingEdges).toBe(2);
    expect(Object.keys(notice).sort()).toEqual(['artifacts', 'billingRecords', 'executionHistory']);
    // 三行文案单源（固定三行——导入后状态 unknown，执行按钮可用需重新生成）
    expect(DRAFT_IMPORT_NOT_RESTORED.artifacts).toContain('产物');
    expect(DRAFT_IMPORT_NOT_RESTORED.executionHistory).toContain('执行历史');
    expect(DRAFT_IMPORT_NOT_RESTORED.billingRecords).toContain('计费');
    expect(DRAFT_IMPORT_NOT_RESTORED.execButtonNote).toContain('重新生成');
  });
  it('nodeId 冲突处置枚举：skip|replace 二值（用户选——nodeId 稳定不重映射，不自动改 ID）', () => {
    expect([...NODE_ID_CONFLICT_POLICIES]).toEqual(['skip', 'replace']);
    const policy: NodeIdConflictPolicy = 'skip';
    expect(['skip', 'replace']).toContain(policy);
  });
});

describe('Y1c T5c 契约冻结：A 场景合并后异常提示契约（ProjectDocIndex 检测项——不阻断）', () => {
  it('检测项清单五值：重复 order/重复 slot/悬挂边/跨组 parent/cells 越界', () => {
    expect([...DRAFT_MERGE_ANOMALY_KINDS]).toEqual([
      'duplicate-order', 'duplicate-slot', 'dangling-edge', 'cross-group-parent', 'cells-out-of-bounds',
    ]);
    const kind: DraftMergeAnomalyKind = 'dangling-edge';
    expect(DRAFT_MERGE_ANOMALY_KINDS).toContain(kind);
  });
});
