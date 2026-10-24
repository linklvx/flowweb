// packages/shared/src/collab/frame-effects.spec.ts
// Y1c T5b（plan v1.7 Task 5 业务 DDL 段；spec v5.4 §6.5——偏离 38⑮）：FrameEffects/ProjectDocIndex 契约冻结的
// 契约测试——八 effect kind 精确冻结（均带 walSeq）、收集管线次序（per-transaction 收集器→walSeq 标注→
// PG 批同事务）、ProjectDocIndex 契约面五成员（类型级双向冻结——解 T24↔T26 循环引用）、重建同源契约。
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  FRAME_EFFECTS_COLLECTION_PIPELINE, FRAME_EFFECT_KINDS, FrameEffect, FrameEffectKind,
  FRAME_EFFECTS_TIMING_AUTHORITY, FRAME_EFFECT_NODE_TYPE_VOCABULARY, FrameNodeTypeName,
  isFrameNodeTypeName, ProjectDocIndex, PROJECT_DOC_INDEX_REBUILD_CONTRACT,
} from './frame-effects';
import { VIDEO_WORK_NODE_TYPES } from '../types/video-work';
import { DOC_SCHEMA_V4 } from '../canvas/doc-schema-v4';

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
      { kind: 'NODE_CREATED', nodeId: 'n1', type: 'imageGen', walSeq: 1n },
      { kind: 'NODE_DELETED', nodeId: 'n1', walSeq: 2n },
      { kind: 'NODE_RESTORED', nodeId: 'n1', type: 'group', walSeq: 3n },
      { kind: 'EDGE_ADDED', edgeId: 'e1', source: 'n1', target: 'n2', walSeq: 4n },
      { kind: 'EDGE_REMOVED', edgeId: 'e1', source: 'n1', target: 'n2', walSeq: 5n },
      { kind: 'MEDIA_REF_ADDED', nodeId: 'n1', mediaId: 'm1', walSeq: 6n },
      { kind: 'MEDIA_REF_REMOVED', nodeId: 'n1', mediaId: 'm1', walSeq: 7n },
      { kind: 'FIELD_CHANGED', nodeId: 'n1', key: 'width', walSeq: 8n },
    ];
    const kinds = effects.map((e) => e.kind);
    expect(new Set(kinds).size).toBe(8);   // 八 variant 各一
    for (const e of effects) expect(typeof e.walSeq).toBe('bigint');
    expect(Object.keys(effects[0]!).sort()).toEqual(['kind', 'nodeId', 'type', 'walSeq']);
    expect(Object.keys(effects[2]!).sort()).toEqual(['kind', 'nodeId', 'type', 'walSeq']);
    expect(Object.keys(effects[3]!).sort()).toEqual(['edgeId', 'kind', 'source', 'target', 'walSeq']);
    expect(Object.keys(effects[6]!).sort()).toEqual(['kind', 'mediaId', 'nodeId', 'walSeq']);
    expect(Object.keys(effects[7]!).sort()).toEqual(['key', 'kind', 'nodeId', 'walSeq']);
    // FrameEffectKind=kind 判别键收编 union（窄化可用）
    const narrow = (e: FrameEffect): FrameEffectKind => e.kind;
    expect(narrow(effects[0]!)).toBe('NODE_CREATED');
  });
});

describe('Y1c T5b 契约修正 #1：NODE_CREATED/NODE_RESTORED 加必填 type（节点类型词表同源）', () => {
  it('缺 type 的构造被类型拒绝（编译面——@ts-expect-error 在字段存在且必填时方被消费；缺字段时=未用指令=tsc 红）', () => {
    // @ts-expect-error 修正 #1：NODE_CREATED 缺必填 type——构造必须被类型拒绝
    const missingCreated: FrameEffect = { kind: 'NODE_CREATED', nodeId: 'n1', walSeq: 1n };
    // @ts-expect-error 修正 #1：NODE_RESTORED 缺必填 type——构造必须被类型拒绝
    const missingRestored: FrameEffect = { kind: 'NODE_RESTORED', nodeId: 'n1', walSeq: 2n };
    // 字面量外类型值同样拒绝（词表收编——非自由 string）
    // @ts-expect-error 修正 #1：type 必须属节点类型词表（'not-a-node-type' 不在册）
    const badVocab: FrameEffect = { kind: 'NODE_CREATED', nodeId: 'n1', type: 'not-a-node-type', walSeq: 3n };
    expect([missingCreated, missingRestored, badVocab]).toBeDefined();   // 编译面断言的占位引用
  });
  it('两 kind 带 type 的构造通过+窄化后 type 可达：FrameNodeTypeName 联合自词表派生', () => {
    const created: FrameEffect = { kind: 'NODE_CREATED', nodeId: 'n1', type: 'imageGen', walSeq: 1n };
    const restored: FrameEffect = { kind: 'NODE_RESTORED', nodeId: 'n2', type: 'videoEdit', walSeq: 2n };
    if (created.kind === 'NODE_CREATED') expect(created.type).toBe('imageGen');
    if (restored.kind === 'NODE_RESTORED') expect(restored.type).toBe('videoEdit');
    const t: FrameNodeTypeName = 'group';
    expect(t).toBe('group');
  });
  it('词表同源（禁重抄）：FRAME_EFFECT_NODE_TYPE_VOCABULARY 即 VIDEO_WORK_NODE_TYPES 引用，且与 DOC_SCHEMA_V4 键集相等（census ① 八类型）', () => {
    expect(FRAME_EFFECT_NODE_TYPE_VOCABULARY).toBe(VIDEO_WORK_NODE_TYPES);   // 同一引用非第二份清单
    const schemaKeys = Object.keys(DOC_SCHEMA_V4);
    expect(FRAME_EFFECT_NODE_TYPE_VOCABULARY.length).toBe(schemaKeys.length);
    for (const t of FRAME_EFFECT_NODE_TYPE_VOCABULARY) expect(schemaKeys).toContain(t);
    for (const k of schemaKeys) expect(FRAME_EFFECT_NODE_TYPE_VOCABULARY).toContain(k);
  });
  it('守卫 isFrameNodeTypeName：在册类型真/未在册与非法输入假', () => {
    expect(isFrameNodeTypeName('imageGen')).toBe(true);
    expect(isFrameNodeTypeName('textInput')).toBe(true);
    expect(isFrameNodeTypeName('videoEdit')).toBe(true);
    expect(isFrameNodeTypeName('not-a-node-type')).toBe(false);
    expect(isFrameNodeTypeName('')).toBe(false);
    expect(isFrameNodeTypeName(undefined)).toBe(false);
    expect(isFrameNodeTypeName(42)).toBe(false);
  });
});

describe('Y1c T5b 契约修正 #1：effects 计算时点=apply 后 actor 临界区内（头注语义冻结）', () => {
  it('FRAME_EFFECTS_TIMING_AUTHORITY：计算时点权威=apply-post-actor-critical-section（非 pre-apply decodeUpdate 推算）；per-transaction 收集器语义维持', () => {
    expect(FRAME_EFFECTS_TIMING_AUTHORITY.computePoint).toBe('apply-post-actor-critical-section');
    expect(FRAME_EFFECTS_TIMING_AUTHORITY.collector).toContain('per-transaction');
    expect(FRAME_EFFECTS_TIMING_AUTHORITY.collector).toContain('afterTransaction');
  });
  it('ProjectDocIndex 建方注记（修正 #1）：T9 建、T24/T26 复用（builders 串冻结——消费方排布）', () => {
    expect(PROJECT_DOC_INDEX_REBUILD_CONTRACT.builders).toContain('T9 建');
    expect(PROJECT_DOC_INDEX_REBUILD_CONTRACT.builders).toContain('T24/T26 复用');
  });
});

describe('Y1c T5b 契约冻结：effects 收集管线（修正 #1——apply 后 actor 临界区内；禁第二套解析器）', () => {
  it('收集管线次序冻结：per-transaction 收集器→标 walSeq 进 observer buffer→与 PG 批同事务（帧↔义务原子）', () => {
    expect([...FRAME_EFFECTS_COLLECTION_PIPELINE]).toEqual([
      'per-transaction-collector',
      'tag-walSeq-into-observer-buffer',
      'pg-batch-same-transaction',
    ]);
  });
  it('重建契约：索引与 appliedSeq 同源/崩溃从 WAL/PG 前缀重建/只消费 effects 不直接 observeDeep/T9 建 T24/T26 复用', () => {
    expect(PROJECT_DOC_INDEX_REBUILD_CONTRACT.sameSourceAs).toBe('appliedSeq');
    expect(PROJECT_DOC_INDEX_REBUILD_CONTRACT.rebuild).toContain('前缀重建');
    expect(PROJECT_DOC_INDEX_REBUILD_CONTRACT.consume).toContain('只消费 effects');
    expect(PROJECT_DOC_INDEX_REBUILD_CONTRACT.builders).toContain('T9');
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
