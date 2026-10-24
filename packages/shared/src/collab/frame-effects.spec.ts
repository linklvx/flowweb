// packages/shared/src/collab/frame-effects.spec.ts
// Y1c T5b（plan v1.7 Task 5 业务 DDL 段；spec v5.4 §6.5——偏离 38⑮）：FrameEffects/ProjectDocIndex 契约冻结的
// 契约测试——八 effect kind 精确冻结（均带 walSeq）、收集管线次序（per-transaction 收集器→walSeq 标注→
// PG 批同事务）、ProjectDocIndex 契约面五成员（类型级双向冻结——解 T24↔T26 循环引用）、重建同源契约。
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  FRAME_EFFECTS_COLLECTION_PIPELINE, FRAME_EFFECT_KINDS, FrameEffect, FrameEffectKind,
  ProjectDocIndex, PROJECT_DOC_INDEX_REBUILD_CONTRACT,
} from './frame-effects';

describe('Y1c T5b 契约冻结：FrameEffect union（偏离 38⑮——八 kind 带 walSeq）', () => {
  it('FRAME_EFFECT_KINDS 八值精确冻结：NODE_CREATED/NODE_DELETED/NODE_RESTORED/EDGE_ADDED/EDGE_REMOVED/MEDIA_REF_ADDED/MEDIA_REF_REMOVED/FIELD_CHANGED', () => {
    expect([...FRAME_EFFECT_KINDS]).toEqual([
      'NODE_CREATED', 'NODE_DELETED', 'NODE_RESTORED', 'EDGE_ADDED', 'EDGE_REMOVED',
      'MEDIA_REF_ADDED', 'MEDIA_REF_REMOVED', 'FIELD_CHANGED',
    ]);
    expect(new Set(FRAME_EFFECT_KINDS).size).toBe(8);
  });
  it('各 variant 形状冻结：节点/媒体/字段带 nodeId；边带 edgeId+source+target（DocEdgeRecord 同域）；全员带 walSeq（BigInt）', () => {
    const effects: FrameEffect[] = [
      { kind: 'NODE_CREATED', nodeId: 'n1', walSeq: 1n },
      { kind: 'NODE_DELETED', nodeId: 'n1', walSeq: 2n },
      { kind: 'NODE_RESTORED', nodeId: 'n1', walSeq: 3n },
      { kind: 'EDGE_ADDED', edgeId: 'e1', source: 'n1', target: 'n2', walSeq: 4n },
      { kind: 'EDGE_REMOVED', edgeId: 'e1', source: 'n1', target: 'n2', walSeq: 5n },
      { kind: 'MEDIA_REF_ADDED', nodeId: 'n1', mediaId: 'm1', walSeq: 6n },
      { kind: 'MEDIA_REF_REMOVED', nodeId: 'n1', mediaId: 'm1', walSeq: 7n },
      { kind: 'FIELD_CHANGED', nodeId: 'n1', key: 'width', walSeq: 8n },
    ];
    const kinds = effects.map((e) => e.kind);
    expect(new Set(kinds).size).toBe(8);   // 八 variant 各一
    for (const e of effects) expect(typeof e.walSeq).toBe('bigint');
    expect(Object.keys(effects[3]!).sort()).toEqual(['edgeId', 'kind', 'source', 'target', 'walSeq']);
    expect(Object.keys(effects[6]!).sort()).toEqual(['kind', 'mediaId', 'nodeId', 'walSeq']);
    expect(Object.keys(effects[7]!).sort()).toEqual(['key', 'kind', 'nodeId', 'walSeq']);
    // FrameEffectKind=kind 判别键收编 union（窄化可用）
    const narrow = (e: FrameEffect): FrameEffectKind => e.kind;
    expect(narrow(effects[0]!)).toBe('NODE_CREATED');
  });
});

describe('Y1c T5b 契约冻结：effects 收集管线（actor pre-apply 计算——禁第二套解析器）', () => {
  it('收集管线次序冻结：per-transaction 收集器→标 walSeq 进 observer buffer→与 PG 批同事务（帧↔义务原子）', () => {
    expect([...FRAME_EFFECTS_COLLECTION_PIPELINE]).toEqual([
      'per-transaction-collector',
      'tag-walSeq-into-observer-buffer',
      'pg-batch-same-transaction',
    ]);
  });
  it('重建契约：索引与 appliedSeq 同源/崩溃从 WAL/PG 前缀重建/只消费 effects 不直接 observeDeep/T24 建 T26 复用', () => {
    expect(PROJECT_DOC_INDEX_REBUILD_CONTRACT.sameSourceAs).toBe('appliedSeq');
    expect(PROJECT_DOC_INDEX_REBUILD_CONTRACT.rebuild).toContain('前缀重建');
    expect(PROJECT_DOC_INDEX_REBUILD_CONTRACT.consume).toContain('只消费 effects');
    expect(PROJECT_DOC_INDEX_REBUILD_CONTRACT.builders).toContain('T24');
    expect(PROJECT_DOC_INDEX_REBUILD_CONTRACT.builders).toContain('T26');
  });
});

describe('Y1c T5b 契约冻结：ProjectDocIndex 契约面（类型级双向冻结——多余/缺失成员均编译红）', () => {
  it('五成员恰齐：nodeType/edgesByNode/mediaRefsByNode/apply(effects)/rebuild(doc)——对象字面量可满足接口（编译级锁）', () => {
    const emptySet = new Set<string>();
    const stub: ProjectDocIndex = {
      nodeType: (nodeId: string) => (nodeId === 'n1' ? 'imageGen' : undefined),
      edgesByNode: new Map([['n1', emptySet]]),
      mediaRefsByNode: new Map([['n1', emptySet]]),
      apply: (_effects: readonly FrameEffect[]) => { /* 测试 stub——契约只锁成员面与签名 */ },
      rebuild: (_doc: Y.Doc) => { /* 同上 */ },
    };
    expect(Object.keys(stub).sort()).toEqual(['apply', 'edgesByNode', 'mediaRefsByNode', 'nodeType', 'rebuild']);
    expect(stub.nodeType('n1')).toBe('imageGen');
    expect(stub.nodeType('unknown')).toBeUndefined();
  });
});
