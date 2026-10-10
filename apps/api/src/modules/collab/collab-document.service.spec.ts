// apps/api/src/modules/collab/collab-document.service.spec.ts
// O0a-2（Spec B）：api 读≡web 读——readCanvas 收编 shared readRecordsFromMaps 后，
// 同一真 Y.Doc 双跑对照（api 收编后读出口 vs web readCanvasFromDoc 同款手法
// readRecordsFromMaps(toDocLike(doc))）逐位相等。
// O0b-0（Spec B）格式批：REST 读入口版本门 v2.1 fail-closed——v1 档/无戳∧有节点拒、
// 无戳∧零节点放行（REST 不盖戳）、sv 路径两锚（v1 同拒/v2 正常不退化）。
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { ServiceUnavailableException } from '@nestjs/common';
import { CollabDocumentService } from './collab-document.service';
import { readRecordsFromMaps, stampDocSchema, CANVAS_DOC_SCHEMA_VERSION, type DocLike, type DocMapLike } from '@flowweb/shared';

/** web ydocBuilder.toDocLike 同款手法（api 侧不可 import apps/web——测试内联同构对照半边） */
function toDocLike(doc: Y.Doc): DocLike {
  return {
    getMap: (name) => doc.getMap(name) as unknown as DocMapLike,
    createMap: () => new Y.Map() as unknown as DocMapLike,
  };
}

/** 真 Y.Doc 夹具：全键节点+缺键节点（无 parentId/width/height/position）+单边 */
function buildDoc(): Y.Doc {
  const doc = new Y.Doc();
  const nodes = doc.getMap('nodes');

  const full = new Y.Map();
  full.set('type', 'textInput');
  full.set('parentId', 'g1');
  full.set('width', 320);
  full.set('height', 120);
  const pos = new Y.Map();
  pos.set('x', 10);
  pos.set('y', 20);
  full.set('position', pos);
  const data = new Y.Map();
  data.set('text', 'a');
  full.set('data', data);
  nodes.set('full', full);

  const bare = new Y.Map(); // 缺键节点——读出口键消除判据（doc 无键⇄records 无键）
  bare.set('type', 'imageGen');
  nodes.set('bare', bare);

  const edges = doc.getMap('edges');
  const e = new Y.Map();
  e.set('source', 'full');
  e.set('target', 'bare');
  edges.set('e1', e);
  return doc;
}

function buildService(doc: Y.Doc): CollabDocumentService {
  const service = new CollabDocumentService({} as any, { readSnapshotOnly: vi.fn() } as any);
  vi.spyOn(service, 'withDoc').mockImplementation(async (_pid: string, fn: (d: Y.Doc) => unknown) => fn(doc) as any);
  return service;
}

describe('CollabDocumentService.readCanvas（O0a-2 收编 readRecordsFromMaps——api 读≡web 读）', () => {
  it('同一 doc 双端比：api readCanvas 输出 ≡ web 手法 readRecordsFromMaps(toDocLike(doc)) 逐位相等', async () => {
    const doc = buildDoc();
    stampDocSchema(toDocLike(doc));   // O0b-0：REST 读需 v2 戳——夹具显式盖章（生产由 WS loadDocument 自愈/api 种子盖章）
    const service = buildService(doc);
    const apiOut = await service.readCanvas('p1');
    const webOut = readRecordsFromMaps(toDocLike(doc)); // web readCanvasFromDoc = 本调用（ydocBuilder 薄委托）
    expect(apiOut).toEqual(webOut);
  });

  it('读出口=作者态 DocNodeRecord：doc 缺键→出口无键（null 消除——批4a 契约/键集表同形）', async () => {
    const doc = buildDoc();
    stampDocSchema(toDocLike(doc));
    const service = buildService(doc);
    const { nodes } = await service.readCanvas('p1');
    const bare = nodes.find((n: any) => n.id === 'bare') as any;
    expect(bare.type).toBe('imageGen');
    expect('parentId' in bare).toBe(false);   // 旧实现此处为 null——收编后键消失
    expect('position' in bare).toBe(false);   // 旧实现此处为 {x:0,y:0} 兜底——键消失
    expect('width' in bare).toBe(false);
    expect(bare.data).toEqual({});
  });

  it('edges 单形状键集锁定（R1a 语义锁保留——toEqual 键集敏感）', async () => {
    const doc = buildDoc();
    stampDocSchema(toDocLike(doc));
    const service = buildService(doc);
    const { edges } = await service.readCanvas('p1');
    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({ id: 'e1', source: 'full', target: 'bare' }); // 无双键名别名键
  });
});

describe('O0b-0 版本门 v2.1（REST 读入口 fail-closed——第五行：v1 档拒+明确信息，非按 abs 解释 rel 静默错位）', () => {
  it('戳=2 放行（盖章夹具正常返回）', async () => {
    const doc = buildDoc();
    stampDocSchema(toDocLike(doc));
    const service = buildService(doc);
    await expect(service.readCanvas('p1')).resolves.toBeTruthy();
  });

  it('戳=1（人为写 1）拒——v1 旧档 fail-closed', async () => {
    const doc = buildDoc();
    doc.getMap('meta').set('schemaVersion', 1);
    const service = buildService(doc);
    await expect(service.readCanvas('p1')).rejects.toThrow(/schemaVersion/);
  });

  it('无戳∧有节点 拒（裸 doc 手建节点不经 fillDoc——终裁 92 构造纪律防假绿）', async () => {
    const doc = buildDoc(); // buildDoc 无戳+有节点——门档构造纪律形态
    const service = buildService(doc);
    await expect(service.readCanvas('p1')).rejects.toThrow(/schemaVersion/);
  });

  it('无戳∧零节点 放行（空画布合法档——REST 侧不盖戳）', async () => {
    const service = buildService(new Y.Doc());
    await expect(service.readCanvas('p1')).resolves.toEqual({ nodes: [], edges: [] });
  });

  it('sv 下 v1 档同样拒（第五行 sv 路径——门从全量 doc 读 meta，不依赖 sv 差量）', async () => {
    const doc = buildDoc();
    doc.getMap('meta').set('schemaVersion', 1);
    const service = buildService(doc);
    const sv = Y.encodeStateVector(new Y.Doc()); // 客户端空 sv——等待语义与门无关
    await expect(service.readCanvas('p1', sv, 50)).rejects.toThrow(/schemaVersion/);
  });

  it('sv 下 v2 档正常返回（门不退化 sv 等待路径——不因 gate 改全量读语义）', async () => {
    const doc = buildDoc();
    stampDocSchema(toDocLike(doc));
    const service = buildService(doc);
    const sv = Y.encodeStateVector(doc);
    await expect(service.readCanvas('p1', sv, 50)).resolves.toBeTruthy();
    expect(CANVAS_DOC_SCHEMA_VERSION).toBe(2);
  });
});

// Y0a-3 T8：readCanvas 可变性三分法——withDoc 三入口③租约门/投影快照出口/写意图门租约档
describe('Y0a-3 T8（三分法）', () => {
  const repoStub = () => ({ readSnapshotOnly: vi.fn().mockResolvedValue({ state: null, updates: [], stateSeq: 0n }) });

  it('withDoc 三入口③：lease 未持 → 503 早退（不触 openDirectConnection）', async () => {
    const gateway = { isLeaseServing: vi.fn(() => false) };
    const service = new CollabDocumentService(gateway as any, repoStub() as any);
    await expect(service.withDoc('p1', () => 'x')).rejects.toThrow(ServiceUnavailableException);
    expect(gateway.isLeaseServing).toHaveBeenCalledWith(); // 门读租约态
    expect((gateway as any).server).toBeUndefined();       // 早退：直连从未开启
  });

  it('readCanvasSnapshotCached（谓词满足档）不走 withDoc/租约：isLeaseServing=false 仍直查 repo 投影（只读档不受租约面影响）', async () => {
    const doc = buildDoc();
    stampDocSchema(toDocLike(doc));
    const repo = { readSnapshotOnly: vi.fn().mockResolvedValue({ state: Buffer.from(Y.encodeStateAsUpdate(doc)), updates: [], stateSeq: 1n }) };
    const gateway = { isLeaseServing: vi.fn(() => false), isPersistedComplete: vi.fn(() => true) };
    const service = new CollabDocumentService(gateway as any, repo as any);
    const withDocSpy = vi.spyOn(service, 'withDoc');

    const out = await service.readCanvasSnapshotCached('p1');

    expect(gateway.isPersistedComplete).toHaveBeenCalledWith('p1');   // 谓词门先行（Y0b-2 T3）
    expect(repo.readSnapshotOnly).toHaveBeenCalledWith('p1'); // 直查 repo 快照出口
    expect(withDocSpy).not.toHaveBeenCalled();                // 不经 openDirectConnection/装载
    expect(gateway.isLeaseServing).not.toHaveBeenCalled();    // 不窥探租约——投影读恒可用
    expect(out.nodes.map((n: any) => n.id).sort()).toEqual(['bare', 'full']); // 与 readCanvas 同出口 readRecordsFromMaps
    expect(out.edges).toHaveLength(1);
  });

  it('readCanvasSnapshotCached：state+分页增量同 doc 重放（投影=state∪updates）', async () => {
    const base = new Y.Doc();
    stampDocSchema(toDocLike(base)); // 生产快照恒有戳（种子无条件盖章）——ensureSchemaVersion 契约
    base.getMap('nodes').set('n1', new Y.Map(Object.entries({ type: 'textInput' })));
    const state = Buffer.from(Y.encodeStateAsUpdate(base));
    const inc = new Y.Doc();
    Y.applyUpdate(inc, new Uint8Array(state));
    inc.getMap('nodes').set('n2', new Y.Map(Object.entries({ type: 'imageGen' })));
    const update = Y.encodeStateAsUpdate(inc, Y.encodeStateVector(base)); // 仅增量

    const repo = { readSnapshotOnly: vi.fn().mockResolvedValue({ state, updates: [Buffer.from(update)], stateSeq: 2n }) };
    const service = new CollabDocumentService({ isLeaseServing: () => true, isPersistedComplete: () => true } as any, repo as any);

    const out = await service.readCanvasSnapshotCached('p1');
    expect(out.nodes.map((n: any) => n.id).sort()).toEqual(['n1', 'n2']);
  });

  it('writeNodeData 写意图门租约档（R4）：lease 未持∧spool ok → 503（既有门只含 spool 态不含 draining）', async () => {
    const gateway = { isLeaseServing: vi.fn(() => false), isWritableOrDegraded: vi.fn(() => 'ok') };
    const service = new CollabDocumentService(gateway as any, repoStub() as any);
    await expect(service.writeNodeData('p1', 'n1', { k: 'v' })).rejects.toThrow(ServiceUnavailableException);
    expect((service as any).withDoc).toBeDefined(); // withDoc 未被触（早退在门前）
  });

  it('writeExecStatus 同款租约档 → 503', async () => {
    const gateway = { isLeaseServing: vi.fn(() => false), isWritableOrDegraded: vi.fn(() => 'ok') };
    const service = new CollabDocumentService(gateway as any, repoStub() as any);
    // Y0b-2 T5（Z111）：attempts 必填（编译级守卫——patch 类型缺字段即红）
    await expect(service.writeExecStatus('p1', 'n1', { status: 'loading', attempts: 0 })).rejects.toThrow(ServiceUnavailableException);
  });

  it('isLeaseServing 透传 gateway（计费/语义读调用面查此档）', () => {
    const gateway = { isLeaseServing: vi.fn(() => true), isWritableOrDegraded: () => 'ok' as const };
    const service = new CollabDocumentService(gateway as any, repoStub() as any);
    expect(service.isLeaseServing()).toBe(true);
    expect(gateway.isLeaseServing).toHaveBeenCalledTimes(1);
  });
});

// Y0a-4/P24（红相先行）：Connection 级 unloadImmediately 双旋钮之一（B20）——A6 锚=DirectConnection
// disconnect options。B26：库默认即 true（options?.unloadImmediately ?? true），显式 pin=防升级翻转的
// 文档锚，非行为修复。
describe('Y0a-4 Connection 级 disconnect pin（unloadImmediately——withDoc finally）', () => {
  it('withDoc finally disconnect 显式 { unloadImmediately: true }（裸调依赖库默认 → 升级翻转无锚）', async () => {
    const doc = new Y.Doc();
    const disconnect = vi.fn(async () => {});
    const gateway = {
      isLeaseServing: vi.fn(() => true),
      server: { hocuspocus: { openDirectConnection: vi.fn(async () => ({ transact: (fn: (d: Y.Doc) => unknown) => fn(doc), disconnect })) } },
    };
    const service = new CollabDocumentService(gateway as any, { readSnapshotOnly: vi.fn() } as any);
    await service.withDoc('p1', () => 'x');
    expect(disconnect).toHaveBeenCalledWith({ unloadImmediately: true });   // 旧实现裸调（无参）→ 红
  });
});
