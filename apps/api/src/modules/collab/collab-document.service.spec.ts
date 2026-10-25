// apps/api/src/modules/collab/collab-document.service.spec.ts
// O0a-2（Spec B）→Y1c T4：api 读≡web 读——readCanvas 读出口（Y1c T4 起=shared doc-codec
// toReadModel——readRecordsFromMaps 收编 codec 内部）同一真 Y.Doc 双跑对照（api 出口 vs
// toReadModel 直调=web readCanvasFromDoc 薄委托实现）逐位相等。
// O0b-0（Spec B）格式批：REST 读入口版本门 v2.1 fail-closed——v1 档/无戳∧有节点拒、
// 无戳∧零节点放行（REST 不盖戳）。Y0b-2 T7：sv 参数两锚随 SV 等待机制退役删除（门档判定不依赖 sv 差量）。
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { ServiceUnavailableException } from '@nestjs/common';
import { CollabDocumentService, applyWriteNodeDataToDoc } from './collab-document.service';
import type { CollabResidencyService } from './collab-residency.service';
import { SERVER_TRANSACT_ORIGIN, toReadModel } from '@flowweb/shared';

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
  // Y0c T15（A2 读写二分）：readCanvas 改道 withSession——seam 随改道迁移（withDoc 保留给非常驻面，
  // 本 spec 读面用例不再经它）。stub 直跑 fn(doc)（原 withDoc spy 同手法；typed cast 保 vitest mock 形状）。
  vi.spyOn((service as any).residency as CollabResidencyService, 'withSession')
    .mockImplementation(async (_pid, fn) => fn(doc) as any);
  return service;
}

describe('CollabDocumentService.readCanvas（O0a-2 收编→Y1c T4 改道 doc-codec toReadModel——api 读≡web 读）', () => {
  it('同一 doc 双端比：api readCanvas 输出 ≡ toReadModel(doc)（web readCanvasFromDoc 薄委托实现）逐位相等', async () => {
    const doc = buildDoc();
    const service = buildService(doc);
    const apiOut = await service.readCanvas('p1');
    const webOut = toReadModel(doc); // web readCanvasFromDoc = 本调用（ydocBuilder 薄委托）
    expect(apiOut).toEqual(webOut);
  });

  it('读出口=作者态 StoredNodeRecord：doc 缺键→出口无键（null 消除——批4a 契约/键集表同形）', async () => {
    const doc = buildDoc();
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
    const service = buildService(doc);
    const { edges } = await service.readCanvas('p1');
    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({ id: 'e1', source: 'full', target: 'bare' }); // 无双键名别名键
  });
});

describe('T18 版本门退役（REST 读面——版本判据=CanvasDoc.schemaVersion PG 列，装载门单源先于 withSession）', () => {
  it('meta 零键 doc（fillDoc 形态——doc 内容不再带版本）readCanvas 正常返回；meta 残留旧值（历史载荷）不再拦读', async () => {
    const doc = buildDoc();   // buildDoc=fillDoc 形态：无戳+有节点——旧门「无戳∧有节点拒」档退役
    const service = buildService(doc);
    await expect(service.readCanvas('p1')).resolves.toBeTruthy();

    const stale = buildDoc();
    stale.getMap('meta').set('schemaVersion', 1);   // 旧档残留载荷——读侧不解释
    const svc2 = buildService(stale);
    await expect(svc2.readCanvas('p1')).resolves.toBeTruthy();
  });

  it('空 doc（行缺失懒建档形态）放行（空画布合法档）', async () => {
    const service = buildService(new Y.Doc());
    await expect(service.readCanvas('p1')).resolves.toEqual({ nodes: [], edges: [] });
  });
});

describe('Y0a-3 T8（三分法）', () => {
  const repoStub = () => ({ readSnapshotOnly: vi.fn().mockResolvedValue({ state: null, updates: [], stateSeq: 0n }), readWatermark: vi.fn().mockResolvedValue(null) });   // Y1c T12：withDoc canonical 名读面（null=gen0 裸名）

  it('withDoc 三入口③：lease 未持 → 503 早退（不触 openDirectConnection）', async () => {
    const gateway = { isLeaseServing: vi.fn(() => false) };
    const service = new CollabDocumentService(gateway as any, repoStub() as any);
    await expect(service.withDoc('p1', () => 'x')).rejects.toThrow(ServiceUnavailableException);
    expect(gateway.isLeaseServing).toHaveBeenCalledWith(); // 门读租约态
    expect((gateway as any).server).toBeUndefined();       // 早退：直连从未开启
  });

  it('readCanvasSnapshotCached（谓词满足档）不走 withDoc/租约：isLeaseServing=false 仍直查 repo 投影（只读档不受租约面影响）', async () => {
    const doc = buildDoc();
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

  it('写意图门租约档（R4）：lease 未持∧spool ok → 503（既有门只含 spool 态不含 draining——T15 后写面=writeExecStatus/writeBatch/deliverArtifact 同门）', async () => {
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

// Y0c T9（Z5/A1）：单写面 undefined fail-fast + assertWriteAdmitted 单点（X9 三写入口共用）。
describe('Y0c T9 undefined fail-fast+assertWriteAdmitted 单点', () => {
  const repoStub = () => ({ readSnapshotOnly: vi.fn().mockResolvedValue({ state: null, updates: [], stateSeq: 0n }), readWatermark: vi.fn().mockResolvedValue(null) });   // Y1c T12：withDoc canonical 名读面（null=gen0 裸名）

  it('红·批面 writeNodeData patch 含 undefined ⇒ throw /UNDEFINED_PATCH_VALUE/（T15 删单写面——原语守卫覆盖面=writeBatch 进门扫描，本锚迁 collab-doc-writer.service.spec 同款用例）', () => {
    // 语义锚迁移说明：applyWriteNodeDataToDoc 原语首段 undefined fail-fast 仍在（deliverArtifact/
    // writeBatch 共用原语）；单写面入口已删——原语级用例归 writeBatch 批面（collab-doc-writer.service.spec
    // 「红·undefined fail-fast（Z5·批面）」），此处仅登记迁移面零行为变化。
    expect(typeof applyWriteNodeDataToDoc).toBe('function');
  });

  it('红·assertWriteAdmitted：lease 未持/degraded 两档 throw，ok 放行（writeNodeData/writeExecStatus/writeBatch 三入口共用单点）', () => {
    const denied = { isLeaseServing: vi.fn(() => false), isWritableOrDegraded: vi.fn(() => 'ok' as const) };
    expect(() => new CollabDocumentService(denied as any, repoStub() as any).assertWriteAdmitted())
      .toThrow(ServiceUnavailableException);
    const degraded = { isLeaseServing: vi.fn(() => true), isWritableOrDegraded: vi.fn(() => 'spool-unwritable' as const) };
    expect(() => new CollabDocumentService(degraded as any, repoStub() as any).assertWriteAdmitted())
      .toThrow(ServiceUnavailableException);
    const ok = { isLeaseServing: vi.fn(() => true), isWritableOrDegraded: vi.fn(() => 'ok' as const) };
    expect(() => new CollabDocumentService(ok as any, repoStub() as any).assertWriteAdmitted()).not.toThrow();
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
      isVacuuming: vi.fn(() => false),   // Y0b-4 T9a：vacuum serving 门（withDoc 第二门）
      server: { hocuspocus: { openDirectConnection: vi.fn(async () => ({ document: doc, transact: (fn: (d: Y.Doc) => unknown) => fn(doc), disconnect })) } },
    };
    const service = new CollabDocumentService(gateway as any, { readSnapshotOnly: vi.fn(), readWatermark: vi.fn().mockResolvedValue(null) } as any);   // Y1c T12：readWatermark 缺省 gen0
    await service.withDoc('p1', () => 'x');
    expect(disconnect).toHaveBeenCalledWith({ unloadImmediately: true });   // 旧实现裸调（无参）→ 红
  });
});

// Y0c T10（Z6/Z119 锚①）：origin=SERVER_TRANSACT_ORIGIN——withDoc 最外层写事务直测。
// 机制依据（库源码实测）：DirectConnection.transact 硬编码外层 origin {source:'local',context}
// （server esm:1136-1144）+yjs 嵌套 transact 忽略内层 origin（yjs.mjs:3397-3412）——最外层唯一
// 可行点=withDoc。原「undo 栈不受污染」用例作废（Z119：trackedOrigins=['local-user'] 而库默认
// 'local'——修复前恒绿=假门禁，D13 族）。
describe('Y0c T10 origin=SERVER_TRANSACT_ORIGIN（withDoc 最外层写事务——Z119 锚①）', () => {
  /** 库形态复刻夹具：connection.document 公开成员 + transact 硬编码外层 origin（@hocuspocus/server
   *  esm:1136-1144 逐行为复刻——mock 与真实行为对齐，TD-2 纪律）。 */
  function directConnectionStub(doc: Y.Doc, disconnect: ReturnType<typeof vi.fn>) {
    return {
      document: doc,
      transact: (fn: (d: Y.Doc) => unknown) => doc.transact(() => { fn(doc); }, { source: 'local', context: undefined }),
      disconnect,
    };
  }

  it('红·withDoc 事务内写 ⇒ update 事件 origin===SERVER_TRANSACT_ORIGIN（现状捕获={source:\'local\',context}——DirectConnection.transact 硬编码）', async () => {
    const doc = new Y.Doc();
    const captured: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => { captured.push(origin); });
    const disconnect = vi.fn(async () => {});
    const gateway = {
      isLeaseServing: vi.fn(() => true),
      isVacuuming: vi.fn(() => false),
      server: { hocuspocus: { openDirectConnection: vi.fn(async () => directConnectionStub(doc, disconnect)) } },
    };
    const service = new CollabDocumentService(gateway as any, { readSnapshotOnly: vi.fn(), readWatermark: vi.fn().mockResolvedValue(null) } as any);   // Y1c T12：readWatermark 缺省 gen0
    await service.withDoc('p1', (d) => { d.getMap('nodes').set('n1', new Y.Map([['type', 'text']])); });

    expect(captured).toHaveLength(1);                       // 单事务单写=单 update 帧
    expect(captured[0]).toBe(SERVER_TRANSACT_ORIGIN);      // 现状红：={source:'local',context} 对象
  });
});
