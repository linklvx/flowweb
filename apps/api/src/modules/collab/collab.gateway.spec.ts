import { EventEmitter2 } from '@nestjs/event-emitter';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { Document } from '@hocuspocus/server';
import * as Y from 'yjs';
import { CollabGateway } from './collab.gateway';
import { CollabDocumentService } from './collab-document.service';
import { stampDocSchema, type DocLike, type DocMapLike } from '@flowweb/shared';

/** 测试内 Y.Doc→DocLike 适配（stampDocSchema 消费——loadDocument 版本门夹具用） */
function toDocLike(doc: Y.Doc): DocLike {
  return {
    getMap: (name) => doc.getMap(name) as unknown as DocMapLike,
    createMap: () => new Y.Map() as unknown as DocMapLike,
  };
}
import { register } from 'prom-client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startDualClientServer } from '../../test-utils/dual-client-server';
import { CollabSpoolService } from './collab-spool.service';
import { unregisterPendingCollector, yjsPendingBatches } from './store.metrics';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { failingRepo } from '../../test-utils/failing-repo';
import { createMockRepo, type MockRepo } from '../../test-utils/mock-repo';
import { pollUntil } from '../../test-utils/poll-until';


function buildDocState(): Buffer {
  const doc = new Y.Doc();
  // O0b-0：v2 档快照——loadDocument 版本门放行前提（无戳有节点会被拒）
  stampDocSchema({
    getMap: (name) => doc.getMap(name) as unknown as DocMapLike,
  } as DocLike);
  const nodes = doc.getMap('nodes');
  const n = new Y.Map();
  n.set('type', 'textInput');
  const pos = new Y.Map();
  pos.set('x', 1);
  pos.set('y', 2);
  n.set('position', pos);
  const data = new Y.Map();
  data.set('text', 'hi');
  n.set('data', data);
  nodes.set('n1', n);
  const edges = doc.getMap('edges');
  const e = new Y.Map();
  e.set('source', 'n1');
  e.set('target', 'n2');
  edges.set('e1', e);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

describe('CollabGateway + CollabDocumentService（integration）', () => {
  let prisma: any;
  let repo: any;
  let durableRows: Uint8Array[] = [];   // 持久化台账：只记真正 resolve 落库的 append 行（beforeEach 重置）
  let permSvc: { resolve: ReturnType<typeof vi.fn> };
  let gateway: CollabGateway;
  let service: CollabDocumentService;
  let emitter: EventEmitter2;
  let url: string;
  let spool: CollabSpoolService;   // Y0a-2：kit 注入的 spool 实例（peek 断言与装置用）
  const providers: HocuspocusProvider[] = [];

  beforeEach(async () => {
    durableRows = [];
    // Y0a-1：装置提取——fixture 构造收敛 dual-client-server（repo 台账经 over.append 注入；
    // prisma/permSvc/emitter 注入面随 kit 暴露，既有覆写路径不变）
    const kit = await startDualClientServer({
      append: vi.fn(async (_pid: string, u: Uint8Array) => { durableRows.push(new Uint8Array(u)); return { ok: true as const, seq: 1n }; }),   // AppendResult 契约（Y0a-2 判别消费——禁 resolve undefined）；once 队列（mockRejectedValueOnce/mockImplementationOnce）优先于基础实现，失败调用不进台账（探针实证 mock.results 过滤不可用——rejected promise 是同步 return，results.type 恒 'return'）
    }, 300);
    ({ gateway, repo, url, prisma, permSvc, emitter, spool, docService: service } = kit);
  });

  afterEach(async () => {
    for (const p of providers.splice(0)) await p.destroy();
    await (gateway as any).server.destroy();
  });

  function connect(name: string, token = 'tok'): { ydoc: Y.Doc; provider: HocuspocusProvider; synced: Promise<void> } {
    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({ url: `${url}?token=${token}`, name, document: ydoc });
    providers.push(provider);
    const synced = new Promise<void>((resolve) => provider.on('synced', () => resolve()));
    return { ydoc, provider, synced };
  }

    function extractHooks() {
      return (gateway as any).hooks as {
        onLoadDocument: (p: any) => Promise<any>;
        onStoreDocument: (p: any) => Promise<boolean>;   // 类型与实现一致（绿8b 消费 boolean 返回值）
        onDisconnect: (p: any) => Promise<void>;
      };
    }

    /** canonical 规范化：经新 doc 再编码，消除 GC 历史差异（不变量 1 主判据；raw 字节等价仅辅助锚——
     *  GC 历史差异可致伪红，比例随操作分布浮动，勿当定理；fuzz 实验记录见 spec 绿11：60 次试验 10 次伪红、canonical 0 次） */
    const canonical = (d: Y.Doc) => {
      const t = new Y.Doc();
      Y.applyUpdate(t, Y.encodeStateAsUpdate(d));
      return Buffer.from(Y.encodeStateAsUpdate(t));
    };
    const bufEq = (a: Uint8Array | Buffer, b: Uint8Array | Buffer) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
    const replayOf = (rows: Uint8Array[]) => {
      const d = new Y.Doc();
      for (const u of rows) Y.applyUpdate(d, u);
      return d;
    };
    /** 已落库的 append 行（台账快照）——失败注入用例里被 reject 的批不得算作持久化状态（Step 1a 台账保证） */
    const appendedRows = (): Uint8Array[] => durableRows.slice();
    /** 持久化等价断言（唯一入口）：前置——pending 必须已 drain（否则"等价"无意义）；重放成功行 ≡ 内存 doc（canonical + 语义双判据）。
     *  Y0a-2（Y4）：队列读点两跳（pendingQueues[docProject[doc]]——V4 projectId 键控化后 doc 直取恒 undefined） */
    const expectDurableEquivalent = (doc: Y.Doc) => {
      const g = gateway as any;
      const pending = g.pendingQueues.get(g.docProject.get(doc)) as Uint8Array[] | undefined;
      expect(pending).toBeDefined();   // 前置实在化：未注册 doc 的"等价"无意义（防 vacuous 通过）
      expect(pending!).toHaveLength(0);   // 前置——pending 必须已 drain
      const d = new Y.Doc();
      for (const u of appendedRows()) Y.applyUpdate(d, u);
      expect(bufEq(canonical(d), canonical(doc))).toBe(true);
      expect(d.getMap('nodes').toJSON()).toEqual(doc.getMap('nodes').toJSON());
      return d;
    };

  it('① onAuthenticate：成员连接成功', async () => {
    const { synced } = connect('project:p1');
    await Promise.race([synced, new Promise((_, rej) => setTimeout(() => rej(new Error('sync timeout')), 3000))]);
  });

  it('① 无 session 拒绝：连接永不完成 sync', async () => {
    prisma.session.findUnique.mockResolvedValue(null);
    const provider = new HocuspocusProvider({ url: `${url}?token=bad`, name: 'project:p2', document: new Y.Doc() });
    providers.push(provider);
    await new Promise((r) => setTimeout(r, 1500));
    expect(provider.isSynced).toBe(false);
  }, 8000);

  it('① 非团队成员拒绝：连接永不完成 sync', async () => {
    prisma.teamMember.findUnique.mockResolvedValue(null);
    const provider = new HocuspocusProvider({ url: `${url}?token=tok`, name: 'project:p3', document: new Y.Doc() });
    providers.push(provider);
    await new Promise((r) => setTimeout(r, 1500));
    expect(provider.isSynced).toBe(false);
  }, 8000);

  describe('onAuthenticate：VIEWER 只读贯通（spec 1.2）', () => {
    function authPayload(connectionConfig: { readOnly: boolean; isAuthenticated: boolean }) {
      return {
        requestHeaders: new Headers({ cookie: 'flowweb.session_token=tok' }),
        requestParameters: new URLSearchParams(),
        documentName: 'project:p1',
        connectionConfig,
      };
    }

    it('PROJECT_VIEWER：connectionConfig.readOnly 置 true（Hocuspocus 拒绝连接写更新）', async () => {
      permSvc.resolve.mockResolvedValue('PROJECT_VIEWER');
      const connectionConfig = { readOnly: false, isAuthenticated: false };
      const ctx = await gateway.hooks.onAuthenticate(authPayload(connectionConfig) as any);
      expect(connectionConfig.readOnly).toBe(true);
      expect(ctx).toMatchObject({ user: { id: 'u1' }, readOnly: true });
    });

    it('EDITOR：正常可写', async () => {
      permSvc.resolve.mockResolvedValue('PROJECT_EDITOR');
      const connectionConfig = { readOnly: false, isAuthenticated: false };
      const ctx = await gateway.hooks.onAuthenticate(authPayload(connectionConfig) as any);
      expect(connectionConfig.readOnly).toBe(false);
      expect(ctx.readOnly).toBeFalsy();
    });
  });

  it('② onLoadDocument：有 CanvasDoc 时客户端连后能读到节点', async () => {
    repo.hydrateWithRecovery.mockResolvedValue({ state: buildDocState(), updates: [], stateSeq: 1n });
    const { ydoc, synced } = connect('project:p1');
    await synced;
    await vi.waitFor(() => {
      expect((ydoc.getMap('nodes').get('n1') as Y.Map<any>)?.get('type')).toBe('textInput');
    });
  });

  it('③ onStoreDocument：写变更后 debounce 落库（短 debounce 配置）', async () => {
    const { ydoc, synced } = connect('project:p1');
    await synced;
    const m = new Y.Map();
    m.set('type', 'group');
    ydoc.getMap('nodes').set('g1', m);
    await vi.waitFor(() => {
      expect(repo.append).toHaveBeenCalled();
    }, { timeout: 4000 });
  }, 8000);

  it('④⑤ withDoc + readCanvas：直连写入广播给客户端；返回 plain 形状', async () => {
    const { ydoc, synced } = connect('project:p1');
    await synced;

    await service.withDoc('p1', (doc) => {
      const n = new Y.Map();
      n.set('type', 'imageGen');
      const pos = new Y.Map();
      pos.set('x', 10);
      pos.set('y', 20);
      n.set('position', pos);
      n.set('data', new Y.Map());
      doc.getMap('nodes').set('srv1', n);
    });

    await vi.waitFor(() => {
      expect((ydoc.getMap('nodes').get('srv1') as Y.Map<any>)?.get('type')).toBe('imageGen');
    });

    const canvas = await service.readCanvas('p1');
    expect(canvas.nodes.find((n: any) => n.id === 'srv1')).toMatchObject({
      type: 'imageGen', position: { x: 10, y: 20 },
    });
  });

  it('readCanvas SV 等待（真实 withDoc 直连）：update 到达后返回数据而非 undefined', async () => {
    const peerDoc = new Y.Doc();
    peerDoc.getMap('nodes').set('n1', new Y.Map());
    const requiredSV = Y.encodeStateVector(peerDoc);
    // 直连建立（openDirectConnection 触发 onLoadDocument）后，向 gateway 内存中的同一 Document 注入对端更新
    setTimeout(() => {
      const serverDoc = gateway.server.hocuspocus.documents.get('project:p1');
      if (serverDoc) Y.applyUpdate(serverDoc as unknown as Y.Doc, Y.encodeStateAsUpdate(peerDoc));
    }, 20);
    const t0 = Date.now();
    const canvas = await service.readCanvas('p1', requiredSV, 3000);
    const elapsed = Date.now() - t0;
    expect(canvas?.nodes).toHaveLength(1); // 修复前 withDoc 提前返回 undefined → 此处红
    // 等待成功路径 ≈ 20ms 等待 + RedisExtension disconnect 固定 2×1000ms（disconnectDelay）≈ 2.1s；
    // 若 SV 等待超时降级（3s）则 >5s——3000ms 稳定区分两路径
    expect(elapsed).toBeLessThan(3000);
  }, 12000);

  it('readCanvas 带 sv：doc 落后时等待 update 事件追上', async () => {
    const peerDoc = new Y.Doc();
    peerDoc.getMap('nodes').set('n1', new Y.Map());
    const requiredSV = Y.encodeStateVector(peerDoc);
    const serverDoc = new Y.Doc(); // 空的，落后
    vi.spyOn(service, 'withDoc').mockImplementation(async (_pid: string, fn: any) => {
      setTimeout(() => { Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(peerDoc)); }, 20);
      return fn(serverDoc);
    });
    const t0 = Date.now();
    await service.readCanvas('p1', requiredSV);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(15);
    expect(elapsed).toBeLessThan(1000); // 等待成功路径：远早于 3s 超时
  });

  it('readCanvas 带 sv：3s 超时降级不抛错', async () => {
    const peerDoc = new Y.Doc(); peerDoc.getMap('nodes').set('n1', 1);
    vi.spyOn(service, 'withDoc').mockImplementation(async (_p: string, fn: any) => fn(new Y.Doc()));
    await expect(service.readCanvas('p1', Y.encodeStateVector(peerDoc), 50)).resolves.toBeTruthy();
  });

  it('readCanvas 无 sv：直接读', async () => {
    vi.spyOn(service, 'withDoc').mockImplementation(async (_p: string, fn: any) => fn(new Y.Doc()));
    await expect(service.readCanvas('p1')).resolves.toBeTruthy();
  });

  it('⑦ e2e：远端删除 → destroy 断连 flush → 真实卸载后重连从持久层重放不复活', async () => {
    const errSpy = vi.spyOn((gateway as any).logger, 'error').mockImplementation(() => {});
    try {
      const a = connect('project:pe1');
      await a.synced;
      const n = new Y.Map();
      n.set('type', 'textInput');
      a.ydoc.getMap('nodes').set('n1', n);
      await vi.waitFor(() => expect(repo.append).toHaveBeenCalledTimes(1), { timeout: 4000 });   // debounce 落库（短 debounce 配置）
      a.ydoc.getMap('nodes').delete('n1');
      await a.provider.destroy();   // 真实断连 → onClose → onDisconnect flush
      providers.splice(providers.indexOf(a.provider), 1);   // 用例内已销毁——从 afterEach 清理数组移除，防双 destroy（collab.gateway flaky 面收敛）
      await vi.waitFor(() => expect(repo.append).toHaveBeenCalledTimes(2), { timeout: 4000 });
      // 关键：等 doc 真正卸载（disconnectDelay + unload 守卫）——否则重连命中内存缓存、测不到持久层
      await vi.waitFor(() => expect(gateway.server.hocuspocus.documents.has('project:pe1')).toBe(false), { timeout: 4000 });
      const loadCallsBefore = (repo.hydrateWithRecovery as any).mock.calls.length;
      repo.hydrateWithRecovery.mockResolvedValue({ state: null, updates: appendedRows(), stateSeq: 0n });   // 持久层 = 已落库行（插入行 + 删除行）
      const b = connect('project:pe1');
      await b.synced;
      expect((repo.hydrateWithRecovery as any).mock.calls.length).toBeGreaterThan(loadCallsBefore);   // 确实走了持久层重放（非缓存命中）
      expect(replayOf([appendedRows()[0]]).getMap('nodes').has('n1')).toBe(true);   // 判别力锚：插入行真实含 n1（防"空 doc 恒绿"）
      expect(b.ydoc.getMap('nodes').has('n1')).toBe(false);   // 不复活
      expect(errSpy).not.toHaveBeenCalled();   // happy path：tripwire/stash 一次不命中（自动化日志契约，与验收判据同源）
    } finally {
      errSpy.mockRestore();
    }
  }, 15000);

  it('⑥ closeTeamDocuments：disband 事件按 payload.projectIds 关连接', async () => {
    const { provider, synced } = connect('project:p9');
    await synced;
    expect(provider.isSynced).toBe(true);

    emitter.emitAsync('team.disbanded', { teamId: 't1', projectIds: ['p9'] });

    await vi.waitFor(() => {
      expect(provider.isSynced).toBe(false);
    }, { timeout: 4000 });
    // 不查库：关闭路径仅用 payload.projectIds（认证期的 findUnique 调用次数不增加）
    const callsBeforeClose = prisma.canvasProject.findUnique.mock.calls.length;
    emitter.emitAsync('team.disbanded', { teamId: 't1', projectIds: ['p9'] });
    await new Promise((r) => setTimeout(r, 200));
    expect(prisma.canvasProject.findUnique.mock.calls.length).toBe(callsBeforeClose);
  }, 8000);

  describe('增量持久化（spec 2.2/2.3）', () => {
    it('onStoreDocument：写入 append + 无变化不 append', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', 'a');
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(1);
      // 再触发一次无变化：不 append（契约：readCanvas 无条件触发零写放大）
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(1);
    });

    it('onLoadDocument：快照 + 增量按序重放', async () => {
      const { onLoadDocument } = extractHooks();
      const snapDoc = new Y.Doc(); snapDoc.getMap('nodes').set('a', 1);
      stampDocSchema(toDocLike(snapDoc));   // O0b-0：v2 档快照（版本门放行前提）
      const incDoc = new Y.Doc(); incDoc.getMap('nodes').set('b', 2);
      repo.hydrateWithRecovery.mockResolvedValue({ state: Buffer.from(Y.encodeStateAsUpdate(snapDoc)), updates: [Buffer.from(Y.encodeStateAsUpdate(incDoc))], stateSeq: 0n });
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      expect(doc.getMap('nodes').get('a')).toBe(1);
      expect(doc.getMap('nodes').get('b')).toBe(2);
    });

    it('onDisconnect：最后连接断开触发 flush-then-compact', async () => {
      const { onLoadDocument, onDisconnect } = extractHooks();
      const doc = new Document('project:p1');   // Y0a-2：真 Document（disconnect 走 storeDocumentSerialized——saveMutex 需真锁载体；连接数缺省=0）
      await onLoadDocument({ document: doc, documentName: 'project:p1' });   // 同实例建立队列
      (gateway as any).lastCompactAt.set('p1', Date.now() - 61_000);   // 批3-4 时间门限：窗口达标才 compact（本例焦点是 flush-then-compact 耦合）
      doc.getMap('nodes').set('x', 1);
      await onDisconnect({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(1);
      expect(repo.compact).toHaveBeenCalledTimes(1);
      expect((repo.append as any).mock.invocationCallOrder[0]).toBeLessThan((repo.compact as any).mock.invocationCallOrder[0]);
    });

    it('onDisconnect：非最后连接早退——不 flush 不 compact', async () => {
      const { onLoadDocument, onDisconnect } = extractHooks();
      const doc = new Document('project:p1');   // Y0a-2：真 Document（saveMutex）——非最后连接形态
      (doc as any).getConnectionsCount = () => 1;
      await onLoadDocument({ document: doc, documentName: 'project:p1' });   // 同实例：queue 有内容，若早退守卫被删则 append 会被调 → 红
      doc.getMap('nodes').set('x', 1);
      await onDisconnect({ document: doc, documentName: 'project:p1' });
      expect(repo.append).not.toHaveBeenCalled();
      expect(repo.compact).not.toHaveBeenCalled();
    });

    it('红1：纯删除 diff append——SV 不变不得当"无变化"跳过', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', new Y.Map());
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(1);   // 插入 append#1（新旧实现都成立）
      const svBefore = Y.encodeStateVector(doc);
      doc.getMap('nodes').delete('n1');
      // 不变量 4：删除不产生新 struct、SV 字节不变（本次事故根因的反直觉事实）
      expect(Buffer.from(Y.encodeStateVector(doc))).toEqual(Buffer.from(svBefore));
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(2);   // 红：现状 SV 判等挡住，恒 1
      // 判别力锚两段：插入行真实被捕 + 删除真实生效（防"重放空 doc"恒真）
      const rows = appendedRows();
      expect(replayOf([rows[0]]).getMap('nodes').has('n1')).toBe(true);
      expectDurableEquivalent(doc);
      expect(replayOf(rows).getMap('nodes').has('n1')).toBe(false);
    });

    it('红2a：判据2 精复现——纯删除后无编辑，断连 flush 落库', async () => {
      const { onLoadDocument, onStoreDocument, onDisconnect } = extractHooks();
      const doc = new Document('project:p1');   // Y0a-2：真 Document（disconnect 走 storeDocumentSerialized——saveMutex 需真锁载体；连接数缺省=0）
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      (gateway as any).lastCompactAt.set('p1', Date.now() - 61_000);   // 批3-4：compact 时间窗达标（焦点在 flush 不在门限）
      doc.getMap('nodes').set('n1', new Y.Map());
      await onStoreDocument({ document: doc, documentName: 'project:p1' });   // append#1 插入
      doc.getMap('nodes').delete('n1');
      await onDisconnect({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(2);   // 红：现状 flush 被 SV 判等挡住
      expect((repo.append as any).mock.invocationCallOrder[0]).toBeLessThan((repo.compact as any).mock.invocationCallOrder[0]);  // flush 先于 compact
      const rows = appendedRows();
      expect(replayOf([rows[0]]).getMap('nodes').has('n1')).toBe(true);
      expect(replayOf(rows).getMap('nodes').has('n1')).toBe(false);
    });

    it('红2b：删完断连后同 doc 再变更——重放等价（次数从序列推导，旧实现=1、新实现=3）', async () => {
      const { onLoadDocument, onStoreDocument, onDisconnect } = extractHooks();
      const doc = new Document('project:p1');   // Y0a-2：真 Document（disconnect 走 storeDocumentSerialized——saveMutex 需真锁载体；连接数缺省=0）
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', new Y.Map());
      await onStoreDocument({ document: doc, documentName: 'project:p1' });   // #1 插入
      doc.getMap('nodes').delete('n1');
      await onDisconnect({ document: doc, documentName: 'project:p1' });       // #2 flush 删除（现状被挡）
      doc.getMap('nodes').set('n2', new Y.Map());                              // 缓存复用后再写入
      await onStoreDocument({ document: doc, documentName: 'project:p1' });   // #3（现状 !lastSV 静默）
      expectDurableEquivalent(doc);                    // 主判据
      expect(repo.append).toHaveBeenCalledTimes(3);     // 辅助断言：新实现序列 =3
      expect(replayOf(appendedRows()).getMap('nodes').has('n1')).toBe(false);
      expect(replayOf(appendedRows()).getMap('nodes').has('n2')).toBe(true);
    });

    it('红3：117 直测——flush 删 SV 后同 doc 写入不得静默丢', async () => {
      const { onLoadDocument, onDisconnect, onStoreDocument } = extractHooks();
      const doc = new Document('project:p1');   // Y0a-2：真 Document（disconnect 走 storeDocumentSerialized——saveMutex 需真锁载体；连接数缺省=0）
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('u1', new Y.Map());
      await onDisconnect({ document: doc, documentName: 'project:p1' });   // #1 flush（现状 append 成功 + finally 删 SV）
      doc.getMap('nodes').set('u2', new Y.Map());
      await onStoreDocument({ document: doc, documentName: 'project:p1' }); // 红：现状 !lastSV 静默 return，恒 1
      expect(repo.append).toHaveBeenCalledTimes(2);
      expectDurableEquivalent(doc);
    });

    it('红4：加载窗口（loadUpdates await 挂起期）的真实写入必须进 pending 并落库【白盒防御性构造——生产不可达（loadingDocuments 门控 + redis 在 afterLoadDocument 才订阅），价值是防未来重构退化，勿去浏览器复现】', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      let release!: () => void;
      // Y0a-1：挂起注入移 loadForHydration（gateway 经工厂委托调它——挂起经委托等价传导：不 reject 不进 catch）
      repo.loadForHydration.mockImplementationOnce(() => new Promise<{ state: Buffer | null; updates: Buffer[]; stateSeq: bigint }>((resolve) => { release = () => resolve({ state: null, updates: [], stateSeq: 0n }); }));
      const doc = new Y.Doc();
      const loading = onLoadDocument({ document: doc, documentName: 'project:p1' });
      await new Promise((r) => setImmediate(r));          // 让 loadDocument 跑到 await hydrateWithRecovery（委托内 loadForHydration）
      doc.getMap('nodes').set('win1', new Y.Map());       // 加载窗口内写入（模板导入/AI 影子节点场景）
      stampDocSchema(toDocLike(doc));                     // O0b-0：窗口写入的 doc 视为已盖章形态（版本门放行）
      release();
      await loading;
      const pending = (gateway as any).pendingQueues.get((gateway as any).docProject.get(doc)) as Uint8Array[];   // Y4：两跳（V4 projectId 键控）
      expect(pending).toHaveLength(2);                    // 窗口写 win1 + 盖章 meta set（两 update 都进 pending）
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(1);
      expect(replayOf(appendedRows()).getMap('nodes').has('win1')).toBe(true);
    });

    it('绿1（O0b-0 改写）：无戳空档 load 自愈 stamp 恰落库一次——后续连续 store 全部 noop', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(1);   // stamp 自愈 update 落库（每 doc 至多一次幂等戳）
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(1);   // 无变更不 append（零写放大契约对已戳 doc 保持）
    });

    it('绿1b：tombstone 三段——真实删除落库 / 重复 tombstone 0 事件不落行 / 对端新 struct 必须落库', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', new Y.Map());
      doc.getMap('nodes').set('n2', new Y.Map());
      await onStoreDocument({ document: doc, documentName: 'project:p1' });   // append#1（两个插入）
      // 自源构造 doc 自己的删除增量（外源 tombstone 引用他人 clock：0 事件、删不掉、还悬挂 pendingDs 污染 canonical——实测）
      const own: Uint8Array[] = [];
      const capture = (u: Uint8Array) => own.push(u);
      doc.on('update', capture);
      doc.getMap('nodes').delete('n2');
      doc.off('update', capture);
      const tombstone = own[0];
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(2);   // ① 真实删除（1 事件 → 进 pending）落库
      let events = 0;
      const count = () => { events += 1; };
      doc.on('update', count);
      Y.applyUpdate(doc, tombstone);   // ② 重复应用已知 tombstone：0 事件
      doc.off('update', count);
      expect(events).toBe(0);
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(2);   // ② 不落行（这才是判据——上一行断言的是"重复=0事件"，本行断言"0事件不落行"）
      const peer = new Y.Doc();   // ③ 对照：带新 struct 的对端 diff → 1 事件 → 真实新信息必须落库
      peer.getMap('nodes').set('peer1', new Y.Map());
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(3);
      expectDurableEquivalent(doc);
    });

    it('绿1c：重放不进队列——load 完成后 pending 为空', async () => {
      const { onLoadDocument } = extractHooks();
      const snapDoc = new Y.Doc(); snapDoc.getMap('nodes').set('a', 1);
      stampDocSchema(toDocLike(snapDoc));   // O0b-0：v2 档快照（已戳重放零新增写——断言前提）
      repo.hydrateWithRecovery.mockResolvedValue({ state: Buffer.from(Y.encodeStateAsUpdate(snapDoc)), updates: [Buffer.from(Y.encodeStateAsUpdate((() => { const d = new Y.Doc(); d.getMap('nodes').set('b', 2); stampDocSchema(toDocLike(d)); return d; })()))], stateSeq: 0n });
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      expect(doc.getMap('nodes').get('a')).toBe(1);
      expect(doc.getMap('nodes').get('b')).toBe(2);
      expect((gateway as any).pendingQueues.get((gateway as any).docProject.get(doc))).toHaveLength(0);   // 重放被抑制，不污染队列（Y4：两跳）
    });

    it('绿2：append 失败抛错回灌——再 store 重试成功，无部分批', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', new Y.Map());
      doc.getMap('nodes').set('n2', new Y.Map());
      repo.append.mockRejectedValueOnce(new Error('db down'));
      await expect(onStoreDocument({ document: doc, documentName: 'project:p1' })).resolves.toBe(false);   // Y0a-2 契约 3 反转：任何路径不 throw（失败批走 spool——旧断言 rejects.toThrow 必红点）
      expect(await spool.peek('p1')).toHaveLength(1);   // Y0a-2：失败批已入 spool 帧（新家落定——旧实现批留队列，V4 后批的失败归属=spool）
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(2);   // 重试成功（第一次失败 + 第二次成功）
      expect((gateway as any).pendingQueues.get((gateway as any).docProject.get(doc))).toHaveLength(0);
      expectDurableEquivalent(doc);
    });

    it('绿3：GC 场景（删除后无关事务触发 gc）——重放删净 + canonical 等价', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();   // gc 默认 true（与 Hocuspocus 生产一致）
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', new Y.Map());
      doc.getMap('nodes').set('n2', new Y.Map());
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').delete('n2');
      doc.getMap('other').set('z', 1);   // 无关事务推进 GC
      doc.getMap('other').set('w', 2);
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      const replayed = expectDurableEquivalent(doc);
      expect(replayed.getMap('nodes').has('n2')).toBe(false);
      expect(replayed.getMap('nodes').has('n1')).toBe(true);
    });

    it('绿4：写放大守护——300 次事务一次 store 恰 append 1 次', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      const nodes = doc.getMap('nodes');
      for (let i = 0; i < 300; i++) doc.transact(() => { nodes.set(`d${i}`, i); });
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(1);   // mergeUpdates 单行（否决逐行：302 行会击穿 compact 门限）
      expect(appendedRows()[0].length).toBeLessThan(20000);   // 合并后远小于逐行总和（~6KB 量级）
      expect(repo.compact).not.toHaveBeenCalled();   // 批3-4 时间门限：load 播种基线，60s 内不 compact
    });

    it('绿5：compact 时间门限（批3-4，代行数门限 COMPACT_THRESHOLD=32）——基线 60s 内不 compact，超窗 compact 在 append 后被调', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', 1);
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.compact).not.toHaveBeenCalled();   // load 刚播种基线：未满 60s 窗口

      (gateway as any).lastCompactAt.set('p1', Date.now() - 61_000);   // 回拨基线模拟窗口已过
      doc.getMap('nodes').set('n2', 2);
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.compact).toHaveBeenCalledTimes(1);
      expect((repo.append as any).mock.invocationCallOrder[0]).toBeLessThan((repo.compact as any).mock.invocationCallOrder[0]);
      // compact 后基线重置：紧接的再 store 不复发
      doc.getMap('nodes').set('n3', 3);
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.compact).toHaveBeenCalledTimes(1);
    });

    it('绿5b：disconnect 的 wrote 契约——没写就不 compact，写了才 compact（时间窗达标前提）', async () => {
      const { onLoadDocument, onStoreDocument, onDisconnect } = extractHooks();
      const docA = new Document('project:p1');   // Y0a-2：真 Document（saveMutex——disconnect 直调路径）
      await onLoadDocument({ document: docA, documentName: 'project:p1' });
      await onStoreDocument({ document: docA, documentName: 'project:p1' });   // O0b-0：stamp 自愈行先落库——队列净空
      (repo.append as any).mockClear();
      (gateway as any).lastCompactAt.set('p1', Date.now() - 61_000);   // 窗口达标：排除时间门限干扰，只测 wrote 耦合
      await onDisconnect({ document: docA, documentName: 'project:p1' });   // 队列空 → wrote=false
      expect(repo.compact).not.toHaveBeenCalled();
      const docB = new Document('project:p2');
      await onLoadDocument({ document: docB, documentName: 'project:p2' });
      await onStoreDocument({ document: docB, documentName: 'project:p2' });   // stamp 落库
      (repo.append as any).mockClear();
      (gateway as any).lastCompactAt.set('p2', Date.now() - 61_000);
      docB.getMap('nodes').set('x', 1);
      await onDisconnect({ document: docB, documentName: 'project:p2' });
      expect(repo.compact).toHaveBeenCalledTimes(1);   // wrote=true → compact
    });

    it('绿6：disconnect 不抛——compact reject 时 onDisconnect 必须 resolve（进程守门）', async () => {
      const { onLoadDocument, onDisconnect } = extractHooks();
      const doc = new Document('project:p1');   // Y0a-2：真 Document（saveMutex——disconnect 直调路径）
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      (gateway as any).lastCompactAt.set('p1', Date.now() - 61_000);   // 批3-4 时间门限：窗口达标才会碰 compact
      doc.getMap('nodes').set('x', 1);
      repo.compact.mockRejectedValueOnce(new Error('lock timeout'));
      await expect(onDisconnect({ document: doc, documentName: 'project:p1' })).resolves.toBeUndefined();
      expect(repo.append).toHaveBeenCalledTimes(1);   // 行已落库
    });

    it('绿6b：flush 失败吞错契约——append reject 时 onDisconnect 仍 resolve（stash 兜底不抛）', async () => {
      const { onLoadDocument, onDisconnect } = extractHooks();
      const doc = new Document('project:p1');   // Y0a-2：真 Document（saveMutex——disconnect 直调路径）
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('x', 1);
      repo.append.mockRejectedValueOnce(new Error('db down'));
      // 吞错契约显式断言（进程守门）：onDisconnect 是 onClose 的不-await 回调，抛错 = unhandled rejection = 进程退出
      await expect(onDisconnect({ document: doc, documentName: 'project:p1' })).resolves.toBeUndefined();
      expect(await spool.peek('p1')).toHaveLength(1);   // Y0a-2：失败批已入 spool（fsync 落定——兜底生效，契约清单 A peek 替换）
    });

    it('绿7：tripwire 双向——未注册 doc 的 store / update 事件都 ERROR 且不静默', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const errSpy = vi.spyOn((gateway as any).logger, 'error').mockImplementation(() => {});
      try {
        const stranger = new Y.Doc();   // ① store 侧：未 load 的 doc 直接 store
        stranger.getMap('nodes').set('x', 1);
        await onStoreDocument({ document: stranger, documentName: 'project:p9' });
        expect(repo.append).not.toHaveBeenCalled();
        expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('unobserved'));
        const doc = new Y.Doc();   // ② 监听器侧：注册后条目异常丢失 → update 事件 ERROR
        await onLoadDocument({ document: doc, documentName: 'project:p1' });
        (gateway as any).pendingQueues.delete('p1');   // Y4：条目丢失模拟改 projectId 键控形态（update 回调经 docProject 解析队列——条目缺失=untracked）
        doc.getMap('nodes').set('y', 1);
        expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('untracked'));
      } finally {
        errSpy.mockRestore();
      }
    });

    it('绿8：spool 帧兜底全链——flush 失败 → 批入 spool → 新实例 load（帧保留回灌）→ store 落库并 confirm → 再 store 不 append', async () => {
      const { onLoadDocument, onStoreDocument, onDisconnect } = extractHooks();
      const docA = new Document('project:p1');   // Y0a-2：真 Document（saveMutex——disconnect 直调路径）
      await onLoadDocument({ document: docA, documentName: 'project:p1' });
      docA.getMap('nodes').set('n1', new Y.Map());
      docA.getMap('nodes').set('n2', new Y.Map());
      await onStoreDocument({ document: docA, documentName: 'project:p1' });   // append#1 插入落库
      const insertRow = appendedRows()[0];   // 显式捕获插入行（避免对 append 调用序的隐式依赖）
      docA.getMap('nodes').delete('n2');
      repo.append.mockRejectedValueOnce(new Error('db down'));
      await onDisconnect({ document: docA, documentName: 'project:p1' });      // flush 失败 → 批入 spool（契约 3 不抛）
      expect(await spool.peek('p1')).toHaveLength(1);   // Y0a-2：失败批已入 spool（fsync 落定）
      repo.hydrateWithRecovery.mockResolvedValue({ state: null, updates: [insertRow], stateSeq: 0n });   // 新实例从"DB"重放插入行
      const docB = new Y.Doc();
      await onLoadDocument({ document: docB, documentName: 'project:p1' });
      expect((gateway as any).pendingQueues.get((gateway as any).docProject.get(docB))).toHaveLength(1);   // 帧窗口外回灌进 pending（不编辑）
      expect(await spool.peek('p1')).toHaveLength(1);   // Y0a-2：帧保留至 append 成功（confirm 恒在成功后，契约 12）——段回收见下方落库断言
      await onStoreDocument({ document: docB, documentName: 'project:p1' });   // 提前 drain：帧随本批落库并 confirm
      expect(await spool.peek('p1')).toHaveLength(0);   // 段回收（append 成功 → confirm → unlink）
      expect(repo.append).toHaveBeenCalledTimes(3);   // #1 成功 + #2 失败 + #3 帧落库
      const all = appendedRows();
      expect(replayOf([all[0]]).getMap('nodes').has('n2')).toBe(true);    // 插入行真实含 n2
      expect(replayOf(all).getMap('nodes').has('n2')).toBe(false);        // stash（删除）生效
      await onStoreDocument({ document: docB, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(3);   // 再 store 不 append（无重复入队）
    });

    it('绿8b：stash 提前 drain——disconnect 失败产生 stash 后，同 doc（不重载）下次 store 即落 stash', async () => {
      const { onLoadDocument, onStoreDocument, onDisconnect } = extractHooks();
      const doc = new Document('project:p1');   // Y0a-2：真 Document（saveMutex——disconnect 直调路径）
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', new Y.Map());
      await onStoreDocument({ document: doc, documentName: 'project:p1' });   // #1 插入成功
      doc.getMap('nodes').delete('n1');
      repo.append.mockRejectedValueOnce(new Error('db down'));
      await onDisconnect({ document: doc, documentName: 'project:p1' });      // flush 失败 → 批入 spool（契约 3 不抛）
      expect(await spool.peek('p1')).toHaveLength(1);   // Y0a-2：失败批已入 spool
      const wrote = await onStoreDocument({ document: doc, documentName: 'project:p1' });   // 提前 drain 随本批落库
      expect(wrote).toBe(true);
      expect(await spool.peek('p1')).toHaveLength(0);   // 段回收（append 成功 → confirm → unlink）
      const all = appendedRows();
      expect(replayOf([all[0]]).getMap('nodes').has('n1')).toBe(true);
      expect(replayOf(all).getMap('nodes').has('n1')).toBe(false);   // 删除随 stash 落库
    });

    it('绿8c：stash-已在-DB 引理——stash 与 DB 同源（同 clientID）→ load 回灌 0 事件 → store 不 append', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const snapDoc = new Y.Doc(); snapDoc.getMap('nodes').set('a', 1);
      stampDocSchema(toDocLike(snapDoc));   // O0b-0：v2 档快照
      repo.hydrateWithRecovery.mockResolvedValue({ state: Buffer.from(Y.encodeStateAsUpdate(snapDoc)), updates: [], stateSeq: 0n });
      await spool.append('p1', Y.encodeStateAsUpdate(snapDoc));   // Y0a-2：装置行改 spool 帧（与快照同源——apply 0 事件）
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      expect(await spool.peek('p1')).toHaveLength(1);   // Y0a-2：帧保留至 append 成功（Y0a-1"消费后清空"语义随契约 12 反转）
      expect((gateway as any).pendingQueues.get((gateway as any).docProject.get(doc))).toHaveLength(0);   // 同源 apply=0 事件，队列零污染
      await onStoreDocument({ document: doc, documentName: 'project:p1' });   // 帧回收行（与 DB 同源=幂等冗余——confirm 恒在 append 成功后）
      expect(repo.append).toHaveBeenCalledTimes(1);   // 帧回收落库（零写放大契约由"帧保留"语义取代）
      expect(await spool.peek('p1')).toHaveLength(0);   // confirm → 段回收
    });

    it('Y0a-1 peek/consume：版本门拒绝 ⇒ stash 存活；正常档 ⇒ 消费后清空', async () => {
      const { onLoadDocument } = extractHooks();
      // 拒绝档：meta.schemaVersion=999（ensureSchemaVersion 判据=戳存在且≠当前版本）
      const bad = new Y.Doc();
      bad.getMap('meta').set('schemaVersion', 999);
      bad.getMap('nodes').set('n', new Y.Map());
      repo.hydrateWithRecovery.mockResolvedValueOnce({ state: Buffer.from(Y.encodeStateAsUpdate(bad)), updates: [], stateSeq: 0n });
      await spool.append('p-peek', Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())));   // Y0a-2：装置行改 spool 帧
      await expect(onLoadDocument({ document: new Y.Doc(), documentName: 'project:p-peek' }))
        .rejects.toMatchObject({ schemaRefusal: true });
      expect(await spool.peek('p-peek')).toHaveLength(1);      // 拒档：帧存活（蒸发路径已关）
      // 正常档：无戳空 doc（stamp 自愈路径）⇒ 帧 apply 保留（confirm 出口=下次 store 提前 drain）
      repo.hydrateWithRecovery.mockResolvedValueOnce({ state: null, updates: [], stateSeq: 0n });
      const okDoc = new Y.Doc();
      await onLoadDocument({ document: okDoc, documentName: 'project:p-peek' });
      expect(await spool.peek('p-peek')).toHaveLength(1);      // Y0a-2：帧保留（Y0a-1"消费后清空"随契约 12 反转）
      await gateway.hooks.onStoreDocument({ document: okDoc, documentName: 'project:p-peek' } as any);   // store 直调：帧随批落库并 confirm（白盒直调）
      expect(await spool.peek('p-peek')).toHaveLength(0);      // confirm → 段回收
    });

    it('绿9：队列身份恒定——软阈跨点闩锁 flush（禁 set 替换数组）', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      const firstRef = (gateway as any).pendingQueues.get((gateway as any).docProject.get(doc));   // Y4：两跳取队列
      for (let i = 0; i < 70; i++) doc.getMap('nodes').set(`k${i}`, { v: i });   // >64 跨软阈（X10：WS 路径零折并——批全留队列，闩锁 setImmediate 提前 store）
      expect((gateway as any).pendingQueues.get((gateway as any).docProject.get(doc))).toBe(firstRef);   // toBe 同一对象（数组身份恒定不变量——set 替换写法必红）
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(1);   // 70 条一次 drain 单行（直调 store 微任务链先于 setImmediate flush 完成——flush 见空队列静默返回）
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(1);   // 无积压重复（drain 后队列净空；身份违例形态由上方 toBe 钉死——突变实证：set 替换下本断言仍绿，勿靠它守身份）
      expectDurableEquivalent(doc);
    });

    it('绿9b：失败+交错回归——await 窗口注入更新触发封顶后 append 失败，失败批仍在归属地（契约 3：任何路径不 throw）', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', new Y.Map());
      let rejectAppend!: (e: Error) => void;
      repo.append.mockImplementationOnce(() => new Promise((_res, rej) => { rejectAppend = rej; }));
      const g = gateway as any;
      const storePromise = onStoreDocument({ document: doc, documentName: 'project:p1' });
      await new Promise((r) => setImmediate(r));   // 跑到 await append
      for (let i = 0; i < 70; i++) doc.getMap('nodes').set(`k${i}`, { v: i });   // 窗口内注入 >64 条 → 软阈闩锁（白盒 doc 未注册进库 documents——flush 见无 doc 静默返回，零串扰）
      rejectAppend(new Error('db down'));
      await expect(storePromise).resolves.toBe(false);   // Y0a-2 契约 3 反转：任何路径不 throw（旧断言 rejects.toThrow 必红点）
      const queue = g.pendingQueues.get(g.docProject.get(doc)) as Uint8Array[];
      const frames = await spool.peek('p1');
      expect(queue.length + frames.length).toBeGreaterThan(0);   // BOI：失败批仍在归属地（V4 队列 ∪ spool 帧——两者其一非空）
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(2);   // 失败 1 + 重试成功 1
      expect((gateway as any).pendingQueues.get((gateway as any).docProject.get(doc))).toHaveLength(0);
      expectDurableEquivalent(doc);
    });

    it('绿10：compact 失败降级——append 成功 + compact reject → 不抛、行已落库、WARN、不 stash', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const warnSpy = vi.spyOn((gateway as any).logger, 'warn').mockImplementation(() => {});
      try {
        const doc = new Y.Doc();
        await onLoadDocument({ document: doc, documentName: 'project:p1' });
        (gateway as any).lastCompactAt.set('p1', Date.now() - 61_000);   // 批3-4 时间门限：窗口达标才会碰 compact
        doc.getMap('nodes').set('n1', 1);
        repo.compact.mockRejectedValueOnce(new Error('lock timeout'));
        const wrote = await onStoreDocument({ document: doc, documentName: 'project:p1' });
        expect(wrote).toBe(true);
        expect(repo.append).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('compact failed'));
        expect(await spool.peek('p1')).toHaveLength(0);   // Y0a-2：健康路径零 spool 写入（清单 A peek 替换）
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('绿11：canonical 自证——同批 update 不同切分应用，40 seeds canonical 全等（raw 字节等价可因 GC 历史差异伪红、比例随操作分布浮动，不可作主判据）', () => {
      for (let seed = 1; seed <= 40; seed++) {
        let s = seed * 2654435761 % 2147483647;
        const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
        const src = new Y.Doc();
        const ups: Uint8Array[] = [];
        src.on('update', (u) => ups.push(u));
        const n = 10 + Math.floor(rnd() * 20);
        for (let i = 0; i < n; i++) {
          const nodes = src.getMap('nodes');
          const r = rnd();
          if (r < 0.6 || nodes.size === 0) nodes.set(`k${i}`, { v: i });
          else {
            const keys = [...nodes.keys()];
            nodes.delete(keys[Math.floor(rnd() * keys.length)]);
          }
        }
        const oneShot = new Y.Doc();
        Y.applyUpdate(oneShot, Y.encodeStateAsUpdate(src));   // 单次全量
        const piecewise = new Y.Doc();
        const cut = 1 + Math.floor(rnd() * (ups.length - 1));   // 随机切分点（保证两段非空）
        for (const u of ups.slice(0, cut)) Y.applyUpdate(piecewise, u);
        Y.applyUpdate(piecewise, Y.mergeUpdates(ups.slice(cut)));   // 剩余合并一次
        expect(bufEq(canonical(oneShot), canonical(piecewise))).toBe(true);
        expect(oneShot.getMap('nodes').toJSON()).toEqual(piecewise.getMap('nodes').toJSON());
      }
    });
  });
});

// Y0a-2 BOI 用例（白盒层直调 storeDocumentUnlocked——不经库 debouncer/saveMutex 包裹，V19 红相层注记）
describe('Y0a-2 BOI（批次所有权不变量——契约 §4.3-11；红相三代见用例名）', () => {
  it('BOI-1 一代红相（splice-first）：append 挂起 → 批必须仍在队列（copy-first）——旧实现 splice(0) 先取走=队列空（进程死即蒸发）', async () => {
    let release!: (v: { ok: true; seq: bigint }) => void;                       // Y13：可释放 deferred（永挂 promise 留悬挂引用）
    const kit = await startDualClientServer({ append: vi.fn(() => new Promise((r) => { release = r; })) }, 200);
    try {
      const doc = new Y.Doc();
      const name = 'project:p-boi1';
      const g = kit.gateway as any;
      g.pendingQueues.set('p-boi1', [new Uint8Array([1, 2, 3])]);                // Y19：projectId 键控装置（V4——旧字段 pendingUpdates 直插=种子不可见）
      const errSpy = vi.spyOn(g.logger, 'error');
      void kit.gateway.hooks.onStoreDocument({ document: doc, documentName: name } as any);   // 不 await——append 挂起（白盒直调：Y.Doc 非 Document 满型——Step 3b 注）
      await pollUntil(() => (kit.repo.append as MockRepo['append']).mock.calls.length >= 1, 2_000);   // Y4：等 append 真被调——防 tripwire 早退的空转绿
      try {
        expect(errSpy.mock.calls.some((c) => String(c[0]).includes('unobserved'))).toBe(false);   // Y4 反向断言：tripwire 未吞掉用例
        expect(g.pendingQueues.get('p-boi1')).toHaveLength(1);                   // copy-first：批仍在旧归属地（旧实现 splice 后=0 → 红）
      } finally {
        release({ ok: true, seq: 1n });                                          // M8：断言红时也释放挂起——dispose 不挂死
      }
    } finally { await kit.dispose(); }
  });

  it('BOI-2 三代红相（fenced 0 行不抛错）：append resolve {ok:false,reason:"fenced"} → 批走 spool（新家）+不排重试——旧实现不检查返回值照常 splice=帧蒸发', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a2-boi2-');
    try {
      const spool = new CollabSpoolService(dir);
      const repo = createMockRepo({ append: vi.fn(async () => ({ ok: false as const, reason: 'fenced' as const })) });
      const kit = await startDualClientServer({ ...repo }, 200, spool);
      try {
        const g = kit.gateway as any;
        g.pendingQueues.set('p-boi2', [new Uint8Array([9, 9])]);                 // Y19：projectId 键控
        const r = await kit.gateway.hooks.onStoreDocument({ document: new Y.Doc(), documentName: 'project:p-boi2' } as any);   // 白盒直调（Y.Doc 非 Document 满型）
        expect(r).toBe(false);
        expect(g.pendingQueues.get('p-boi2')).toHaveLength(0);                   // 批已迁 spool 新家（splice 恒在新家 fsync 落定之后——旧实现 splice 后批两头蒸发：队列空∧spool 空，红相由下行 peek 断言承担）
        expect(await spool.peek('p-boi2')).toHaveLength(1);                      // 批入 spool（旧实现无 spool 写入 → 红）
        expect(g.persistRetry.size).toBe(0);                                     // fenced=终态禁退避梯（契约 15）
      } finally { await kit.dispose(); }
    } finally { await cleanup(); }
  });

  it('BOI-3 一代断链：append 持续失败 → 断连卸载 doc → 批必须在 spool（磁盘）——旧实现 stash 进内存 unflushed=崩溃丢（红）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a2-boi3-');
    try {
      const spool = new CollabSpoolService(dir);
      const kit = await startDualClientServer({ append: failingRepo({ failAppend: 99 }).append }, 200, spool);
      try {
        const name = 'project:p-boi3';
        const { provider, synced } = kit.connect(name);
        await synced;
        provider.document.getMap('nodes').set('n', new Y.Map([['x', 1]]));
        await pollUntil(() => (kit.repo.append as MockRepo['append']).mock.calls.length >= 1, 5_000);   // 首次 store 已失败
        // 注意时序：repo.append 调用点先于 spool fsync 完成（copy-first：splice 恒在新家落定之后）——
        // 全量并发下断言与 fsync 竞速会伪红，peek 落定必须轮询（帧可见=fsync 完成的直接证据）
        await pollUntil(async () => (await spool.peek('p-boi3')).length >= 1, 5_000);   // BOI 失败路径：新家=spool 已 fsync（旧实现=内存 Map，spool 空 → 红）
        await provider.destroy();
        kit.forget(provider);   // 自管 destroy 后移出 dispose 清理数组——防双 destroy（flaky 源，惯例同上方 spec:262）
        await pollUntil(() => !kit.gateway.server.hocuspocus.documents.has(name), 8_000);   // A9：卸载发生
        expect(await spool.peek('p-boi3')).toHaveLength(1);       // 卸载后批仍在磁盘（旧实现随 doc 消失+内存 Map 崩溃丢 → 红）
      } finally { await kit.dispose(); }
    } finally { await cleanup(); }
  });

  it('BOI-4 崩溃模拟（V19 红相层）：append 失败 → 丢弃 gateway 实例（等价进程死）→ 同 spool 目录新实例 → 批存活可回灌（旧实现批在内存=红）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a2-boi4-');
    try {
      const kit1 = await startDualClientServer({ append: failingRepo({ failAppend: 99 }).append }, 200, new CollabSpoolService(dir));
      const { provider, synced } = kit1.connect('project:p-boi4');
      await synced;
      provider.document.getMap('nodes').set('k', new Y.Map([['x', 1]]));
      await pollUntil(() => (kit1.repo.append as MockRepo['append']).mock.calls.length >= 1, 5_000);   // 失败已发生 → 批已入 spool
      await provider.destroy();
      kit1.forget(provider);                    // 自管 destroy 后移出 dispose 清理数组——防双 destroy（惯例同上）
      await kit1.dispose();                     // 丢弃实例=进程死（内存队列随之消失——旧实现红相源）
      const kit2 = await startDualClientServer({}, 200, new CollabSpoolService(dir));   // 同 spool 目录新实例
      // 启动接线（onModuleInit 内 scan+replayAll 回灌）归 Task 4——本 Task 显式调 spool 公共 API scan()
      // 重建帧索引（新实例 index 空、磁盘帧不可见=无 scan 时空转假绿），再经"load 帧回灌 + store confirm"链验证批存活。
      await kit2.spool.scan();
      const { provider: p2, synced: s2 } = kit2.connect('project:p-boi4');
      await s2;
      p2.document.getMap('nodes').set('k2', new Y.Map([['x', 1]]));
      await pollUntil(async () => (await kit2.spool.peek('p-boi4')).length === 0, 5_000);   // 段回收（peek 必经 kit2 同一实例——新开实例 index 空=恒真假绿）
      const rows = kit2.repo.append.mock.calls;    // 回灌 append 的 payload 含所写节点
      const revived = new Y.Doc();
      for (const c of rows) Y.applyUpdate(revived, new Uint8Array(c[1] as Uint8Array));
      expect(revived.getMap('nodes').has('k')).toBe(true);   // 批经 spool 存活——旧实现（内存 unflushed）必红
      await p2.destroy();
      kit2.forget(p2);
      await kit2.dispose();
    } finally { await cleanup(); }
  });

  it('Y9/X9 降级通告：spool 白盒熔断 → 新连接放行但 readOnly + stateless persist-status{healthy:false,reason:"spool-unwritable"}（静默只读=禁）', async () => {
    const kit = await startDualClientServer({}, 200);
    try {
      (kit.spool as any).ioBroken = true;   // V14 白盒：IO 熔断态字段直置（绕过 5 连败触发——白盒更稳）
      const stateless: string[] = [];
      const { provider, synced } = kit.connect('project:p-y9');
      provider.on('stateless', ({ payload }: { payload: string }) => stateless.push(payload));
      await synced;                                          // ① 连接成功（只读降级不停服——V13 粒度修正）
      const doc = kit.gateway.server.hocuspocus.documents.get('project:p-y9')!;
      const conn = [...doc.connections.keys()][0] as any;
      expect(conn.readOnly).toBe(true);                      // ② 协议层拒写（复用 VIEWER readOnly 机制）
      await pollUntil(() => stateless.some((p) => p.includes('spool-unwritable')), 1_500);   // ③ Y9 通告（broadcastSpoolDegraded 500ms 延迟窗内必达）
      const parsed = JSON.parse(stateless.find((p) => p.includes('spool-unwritable'))!);
      expect(parsed).toMatchObject({ type: 'persist-status', healthy: false, reason: 'spool-unwritable' });
    } finally { await kit.dispose(); }
  });

  it('I-2 红相（Y8 判据命中后旧代码无条件 splice=折并交织窗丢"快照后"更新）：append deferred 挂起 → 取批后白盒模拟折并 → release 成功 → 合并元素必须存活+tail anomaly 计数递增', async () => {
    let release!: (v: { ok: true; seq: bigint }) => void;
    const kit = await startDualClientServer({ append: vi.fn(() => new Promise<{ ok: true; seq: bigint }>((r) => { release = r; })) }, 200);
    try {
      const g = kit.gateway as any;
      const upd = (n: number) => { const d = new Y.Doc(); d.getMap('nodes').set(`k${n}`, n); return Y.encodeStateAsUpdate(d); };   // 合法 Y update（mergeUpdates 对裸字节 throw——Y2 兜底吞错必 pollUntil 超时）
      g.pendingQueues.set('p-i2', [upd(1), upd(2), upd(3)]);   // Y19：projectId 键控装置（3 条——折并后 1 条，判据 length<n 必命中）
      const readAnomaly = async () => {
        const metrics = await register.getMetricsAsJSON();
        return ((metrics.find((m: any) => m.name === 'yjs_store_tail_anomaly_total') as any)?.values?.[0]?.value ?? 0) as number;
      };
      const before = await readAnomaly();
      const storeP = kit.gateway.hooks.onStoreDocument({ document: new Y.Doc(), documentName: 'project:p-i2' } as any);   // 不 await——append 挂起（白盒直调同 BOI-1）
      await pollUntil(() => (kit.repo.append as MockRepo['append']).mock.calls.length >= 1, 2_000);
      const q = g.pendingQueues.get('p-i2') as Uint8Array[];
      q.splice(0, q.length, Y.mergeUpdates(q));   // 白盒模拟 update 监听器封顶折并（await 交织窗——合并元素含快照后内容）
      try {
        expect(q).toHaveLength(1);                // 前置：折并已发生（1 < n=3 → Y8 判据必命中）
      } finally { release({ ok: true, seq: 1n }); }
      await storeP;
      const qAfter = g.pendingQueues.get('p-i2') as Uint8Array[];
      expect(qAfter).toBe(q);                     // 数组身份恒定不变量（合并元素存活其中）
      expect(qAfter).toHaveLength(1);             // 旧实现 splice(0,n) 连合并元素一起删=队列空 → 红；修后留队重发（CRDT 幂等吸收）
      expect(await readAnomaly()).toBe(before + 1);   // Y8 探测计数命中
    } finally { await kit.dispose(); }
  });

  it('I-3 红相（X6×X9 容量恢复死锁缝）：容量态白盒置位 → store 成功 confirm 旧帧段回收 → confirm 自评必须解除容量态+唤醒 onRecovered（旧实现容量滞留=全恢后受理面半瘫需重启）', async () => {
    const kit = await startDualClientServer({}, 200);
    try {
      const spool = kit.spool;
      await spool.append('p-cap', Y.encodeStateAsUpdate(new Y.Doc()));   // 先 append 真帧（合法 update 且零节点——有节点无戳会被 O0b-0 版本门拒载；容量态 append throw——先落帧再白盒置位）
      (spool as any).overCapacityFlag = true;                   // 白盒：容量态（同 Y9 ioBroken 白盒形态）
      spool.onRecovered = vi.fn();
      expect(spool.overCapacity()).toBe(true);                  // 前置：容量态就位
      const doc = new Y.Doc();
      await kit.gateway.hooks.onLoadDocument({ document: doc, documentName: 'project:p-cap' } as any);
      doc.getMap('nodes').set('n1', new Y.Map());
      const wrote = await kit.gateway.hooks.onStoreDocument({ document: doc, documentName: 'project:p-cap' } as any);
      expect(wrote).toBe(true);                                 // PG 腿健康：容量态不挡 store（帧消化到 PG——独立故障域）
      expect(await spool.peek('p-cap')).toHaveLength(0);        // confirm → 段回收 → depth 回落
      expect((spool as any).overCapacityFlag).toBe(false);      // confirm 自评解除（旧实现滞留 true → 红）
      expect(spool.onRecovered).toHaveBeenCalledTimes(1);       // 唤醒 seam（rearm 退避梯+受理面恢复）
    } finally { await kit.dispose(); }
  });

  it('M1：draining 白盒——受理门拒新连接 reason=draining（瞬态档：客户端继续重连，DRAINING 非 terminal）', async () => {
    const kit = await startDualClientServer({}, 200);
    try {
      (kit.gateway as any).draining = true;
      expect(kit.gateway.isShuttingDown()).toBe(true);   // X9 受理门读点翻转
      await expect(kit.gateway.hooks.onAuthenticate({
        requestHeaders: new Headers(),
        requestParameters: new URLSearchParams('token=tok'),
        documentName: 'project:p-m1',
        connectionConfig: { readOnly: false, isAuthenticated: false },
      } as any)).rejects.toMatchObject({ reason: 'draining' });   // reason 即线上协议串（shared 枚举同源）
    } finally { await kit.dispose(); }
  });
});

// Y0a-2 Task 4：退避无上限+afterStoreDocument 最小对账+computePending（plan Step 1——红相先行）
describe('Y0a-2 退避无上限+afterStoreDocument 对账+computePending', () => {
  it('persistRetryDelayMs 纯函数：前 5 档 [1,2,5,15,30]s，rung≥5 恒 60s（永不耗尽——锚 A5：库不补）', async () => {
    const { persistRetryDelayMs } = await import('./collab.gateway');
    expect([0, 1, 2, 3, 4].map(persistRetryDelayMs)).toEqual([1_000, 2_000, 5_000, 15_000, 30_000]);
    expect(persistRetryDelayMs(5)).toBe(60_000);
    expect(persistRetryDelayMs(999)).toBe(60_000);
  });

  it('持续失败不弃批：append 永败+spool 可用 → 退避排程永不耗尽（rung=7 仍重排——旧实现 :541 耗尽 return → timer null=红）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a2-retry-');
    try {
      const spool = new CollabSpoolService(dir);
      const repo = failingRepo({ failAppend: 99 });
      const kit = await startDualClientServer({ append: repo.append }, 10_000 /* 大 debounce：只走 retry 梯 */, spool);
      try {
        const doc = new Y.Doc();
        const name = 'project:p-retry';
        (kit.gateway as any).pendingQueues.set('p-retry', [new Uint8Array([1])]);   // Y19：projectId 键控装置
        const r1 = await kit.gateway.hooks.onStoreDocument({ document: doc, documentName: name } as any);
        expect(r1).toBe(false);
        // 第一次失败即入 spool（BOI）+排程——spool 键命中 ⇒ 本用例只验证"排程不耗尽"：
        // 手工把 rung 推到 5+（模拟多轮失败）再断言 schedulePersistRetry 仍重排
        const entry = (kit.gateway as any).persistRetry.get(name);
        expect(entry).toBeTruthy();
        // V17⑤：先作废既有 1s 档定时器再推 rung——不清则 schedulePersistRetry 因已有 timer 早退=恒真绿
        clearTimeout(entry.timer); entry.timer = null;
        entry.rung = 7;
        (kit.gateway as any).schedulePersistRetry(name);
        const entry2 = (kit.gateway as any).persistRetry.get(name);
        expect(entry2.timer).toBeTruthy();     // rung 7 仍重排（旧实现 :541 耗尽 return → timer null=红）
      } finally { await kit.dispose(); }
    } finally { await cleanup(); }
  });

  it('V22 afterStoreDocument=存活计数（yjs_store_hook_calls_total）；去抖窗新写入零误报（v1 判据已撤——真对账=Task 3 splice 点自检）', async () => {
    const kit = await startDualClientServer();
    try {
      const callsBefore = (await register.getSingleMetric('yjs_store_hook_calls_total')!.get()).values[0]?.value ?? 0;
      const g = kit.gateway as any;
      const doc = new Y.Doc();
      g.docProject.set(doc, 'p-tail'); g.pendingQueues.set('p-tail', [new Uint8Array([1])]);
      await kit.gateway.hooks.onStoreDocument({ document: doc, documentName: 'project:p-tail' } as any);   // append ok→队列清空
      await kit.gateway.hooks.afterStoreDocument({ document: doc, documentName: 'project:p-tail' } as any);
      const callsAfter = (await register.getSingleMetric('yjs_store_hook_calls_total')!.get()).values[0]?.value ?? 0;
      expect(callsAfter - callsBefore).toBe(1);          // 存活计数（V17⑥：metric.get() 公开 API——hashMap 内部读取作废）
      const anomalyBefore = (await register.getSingleMetric('yjs_store_tail_anomaly_total')!.get()).values[0]?.value ?? 0;
      const q = g.pendingQueues.get('p-tail') as Uint8Array[];
      q.push(new Uint8Array([2]));                       // 白盒模拟 store 完成后去抖窗内新写入（合法归属）
      await kit.gateway.hooks.afterStoreDocument({ document: doc, documentName: 'project:p-tail' } as any);
      const anomalyAfter = (await register.getSingleMetric('yjs_store_tail_anomaly_total')!.get()).values[0]?.value ?? 0;
      expect(anomalyAfter - anomalyBefore).toBe(0);      // 零误报（v1 判据在此场景必计 1=红——判据已撤；delta 形态：I-2 先行用例已推高计数，绝对 0 恒假红）
    } finally { await kit.dispose(); }
  });

  it('computePending：projects=队列非空项目数/batches=条数（空条目不计）；spool 深度并入（G-1 演练的轮询面——P1/Y5）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a2-cp-');
    try {
      const spool = new CollabSpoolService(dir);
      const kit = await startDualClientServer({}, 300, spool);
      try {
        // 装置行在 kit 起动之后：onModuleInit 启动回灌（scan+replayAll→confirm→段回收）会消费 kit 前已存在的帧，
        // 先投帧则 spoolFiles 断言恒 0 假红——本用例焦点是 computePending 口径，非回灌链（BOI-4 已覆盖）
        await spool.append('p-cp', new Uint8Array([1, 1]));
        const g = kit.gateway as any;
        g.pendingQueues.set('pd1', [new Uint8Array([1]), new Uint8Array([2])]);
        g.pendingQueues.set('pd2', []);   // 空条目不计 projects（验证语义）
        const p = g.computePending();
        expect(p).toMatchObject({ projects: 1, batches: 2, spoolFiles: 1, spoolBytes: 8 + 2 });
      } finally { await kit.dispose(); }
    } finally { await cleanup(); }
  });
});

// Y0a-2 Task 4 审查修复（红相先行）：I-1 回灌后 rearm 排程（X5 必修漏落——onRecovered seam 只在
// ioBroken 翻转时回调，spool 健康时启动回灌失败无任何唤醒路径）+ I-2 retryingPersist 单布尔改
// per-doc 集合（A 项目梯在飞窗跨 saveMutex 等待+append 5s 上界，误罩 B 项目三处守卫→B 批滞留无恢复）
// + M-2 unregisterPendingCollector 后 pending gauge 读 0（collect 现算形态的缺位语义）。
describe('Y0a-2 审查修复：I-1 回灌后 rearm / I-2 per-doc 在飞集合 / M-2 unregister gauge', () => {
  it('审查 I-1 红相（回灌后 rearm 漏排）：启动回灌失败（PG down）→ spool 残帧必须有退避梯排程——旧实现仅 seam 注入不调用=梯空转（R1 自愈承诺破约）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a2-i1-');
    try {
      const spool = new CollabSpoolService(dir);
      await spool.append('p-i1', Y.encodeStateAsUpdate(new Y.Doc()));   // 预投帧：kit onModuleInit 的 scan+replayAll 读它（append 永败→3 次尝试≈400ms 后 failed=1，帧保留）
      const kit = await startDualClientServer({ append: vi.fn(async () => { throw new Error('pg down'); }) }, 200, spool);
      try {
        // 判定点：回灌失败项目必须经退避梯运行期自愈（R1 拒绝理由的自洽前提）——梯入口=onModuleInit 回灌后 rearmQueues()
        expect((kit.gateway as any).persistRetry.get('project:p-i1')).toBeTruthy();   // 旧实现 undefined → 红
        expect(await spool.peek('p-i1')).toHaveLength(1);   // 对照组：帧保留（回灌失败不删帧）
      } finally { await kit.dispose(); }
    } finally { await cleanup(); }
  }, 15_000);

  it('审查 I-2 红相（retryingPersist 单布尔跨项目误罩）：A 项目梯在飞 → B 项目（独立 saveMutex）store 失败仍必须自排退避梯——旧实现共享布尔=被 A 误罩（B 批滞留无恢复路径）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a2-i2-');
    try {
      const spool = new CollabSpoolService(dir);
      const kit = await startDualClientServer({ append: failingRepo({ failAppend: 99 }).append }, 200, spool);
      try {
        const g = kit.gateway as any;
        // 双形态装置（红绿同源）：旧代码读布尔 retryingPersist=true → B 守卫被罩（红相条件）；
        // 新代码读 Set → add('project:p-i2-a') 等价语义（旧代码字段不存在，可选链无害）
        g.retryingPersist = true;
        g.retryingPersistDocs?.add('project:p-i2-a');
        g.pendingQueues.set('p-i2-b', [new Uint8Array([1])]);   // Y19：projectId 键控装置（B 独立批）
        const r = await kit.gateway.hooks.onStoreDocument({ document: new Y.Doc(), documentName: 'project:p-i2-b' } as any);
        expect(r).toBe(false);   // 契约 3：任何路径不 throw
        expect(await spool.peek('p-i2-b')).toHaveLength(1);   // 对照组：B 失败批已入 spool（fsync 落定，spool 腿独立可用）
        expect(g.persistRetry.get('project:p-i2-b')).toBeTruthy();   // 判定点：旧实现被 A 的布尔误罩 → undefined → 红
      } finally { await kit.dispose(); }
    } finally { await cleanup(); }
  }, 15_000);

  it('审查 M-2：unregisterPendingCollector 后 pending gauge 读 0（collect 现算——collector 缺位=0，防 destroy 后闭包悬挂）', async () => {
    const kit = await startDualClientServer();
    try {
      const g = kit.gateway as any;
      g.pendingQueues.set('p-m2', [new Uint8Array([1])]);   // 前置：collector 在位且队列非空 → gauge 读 1
      const before = (await register.getSingleMetric('yjs_pending_projects')!.get()).values[0]?.value ?? 0;
      expect(before).toBe(1);
      unregisterPendingCollector();   // onApplicationShutdown 首行同源调用（本用例为文件末测试——不再注册无污染）
      const after = (await register.getSingleMetric('yjs_pending_projects')!.get()).values[0]?.value ?? 0;
      expect(after).toBe(0);
    } finally { await kit.dispose(); }
  });
});

// Y0a-2 Task 7（plan Step 1——红相先行）：beforeUnloadDocument 清理钩子（X4 永不抛+Y3 顺序）+
// mergeUpdates 出 WS 消息路径（X10 入队只 push——软阈 setImmediate 提前 flush+Y7 硬阈异步 coalesce）+
// 卸载交接三形态（成功/失败/Y11 重连同数组身份）。
describe('Y0a-2 beforeUnloadDocument 清理+mergeUpdates 出 WS 路径', () => {
  it('卸载清理钩子：lastCompactAt/persistUnhealthy/persistRetry/pendingQueues 空条目残留随 doc 卸载清（真泄漏唯 lastCompactAt 的修点）', async () => {
    const kit = await startDualClientServer();
    try {
      const g = kit.gateway as any;
      g.lastCompactAt.set('p-ul', 1);
      g.persistUnhealthy.add('project:p-ul');
      g.persistRetry.set('project:p-ul', { rung: 2, timer: null });
      await g.hooks.beforeUnloadDocument({ documentName: 'project:p-ul', document: new Y.Doc() } as any);
      expect(g.lastCompactAt.has('p-ul')).toBe(false);
      expect(g.persistUnhealthy.has('project:p-ul')).toBe(false);
      expect(g.persistRetry.has('project:p-ul')).toBe(false);   // ①cancelPersistRetry 先于③（Y3 顺序——残留梯随卸载清）
      g.pendingQueues.set('p-ul2', []);   // X17：空条目装置（非空条目留存语义由卸载交接失败用例覆盖）
      await g.hooks.beforeUnloadDocument({ documentName: 'project:p-ul2', document: new Y.Doc() } as any);
      expect(g.pendingQueues.has('p-ul2')).toBe(false);   // X17：空条目回收（交接失败时 q2 非空自然保留）
    } finally { await kit.dispose(); }
  });

  it('I-1 僵尸 doc 空条目禁回收：doc 仍在库 documents Map（钩子后复检取消卸载形态）时空条目必须保留——重连复用 doc 不重跑 loadDocument=条目不重建，删则活编辑命中 !q 静默丢弃；doc 真卸载后 X17 照常回收', async () => {
    const kit = await startDualClientServer();
    const g = kit.gateway as any;
    const zombie = new Y.Doc();
    kit.gateway.server.hocuspocus.documents.set('project:p-zombie', zombie as any);   // doc 仍活=库复检取消卸载形态
    try {
      g.pendingQueues.set('p-zombie', []);   // 空条目装置（store 失败过→交接 splice 清空后的形态）
      await g.hooks.beforeUnloadDocument({ documentName: 'project:p-zombie', document: zombie } as any);
      expect(g.pendingQueues.has('p-zombie')).toBe(true);   // 判定点：旧代码无前置删除=红（活编辑丢弃窗）
      kit.gateway.server.hocuspocus.documents.delete('project:p-zombie');   // doc 真卸载
      await g.hooks.beforeUnloadDocument({ documentName: 'project:p-zombie', document: zombie } as any);
      expect(g.pendingQueues.has('p-zombie')).toBe(false);   // X17：doc 真消失才回收
    } finally {
      // 红相防御：断言失败不残留裸 doc 毒化 dispose（裸 Y.Doc 无 connections——closeConnections 炸=destroy 挂死）
      kit.gateway.server.hocuspocus.documents.delete('project:p-zombie');
      await kit.dispose();
    }
  });

  it('清理钩子永不抛：内部异常被吞（库对 beforeUnloadDocument 抛错=取消卸载→destroy 永不 resolve→8s race+内存泄漏）', async () => {
    const kit = await startDualClientServer();
    try {
      const g = kit.gateway as any;
      g.spool = { hasFrames: () => { throw new Error('boom'); } };   // 内部依赖炸（整体替换）
      await expect(g.hooks.beforeUnloadDocument({ documentName: 'project:p-x', document: new Y.Doc() } as any)).resolves.toBeUndefined();
    } finally { await kit.dispose(); }
  });

  it('入队只 push 不折叠：70 条全留队列+软阈触发 setImmediate 提前 flush（旧实现 :207 封顶合并后=1=红相）', async () => {
    let release!: (v: { ok: true; seq: bigint }) => void;   // Y13：可释放 deferred（append 挂起持 saveMutex→不释放则 dispose 挂死）
    const kit = await startDualClientServer({ append: vi.fn(() => new Promise((r) => { release = r; })) }, 60_000);   // 大 debounce+append 挂起：只看入队形态
    try {
      const g = kit.gateway as any;
      const { provider, synced } = kit.connect('project:p-many');   // 真路径装载（pendingQueues 由 loadDocument 播种——Y19 禁裸插装置）
      await synced;
      for (let i = 0; i < 70; i++) provider.document.getMap('nodes').set(`k${i}`, new Y.Map([['x', i]]));
      await new Promise((r) => setTimeout(r, 300));
      const q = g.pendingQueues.get('p-many') as Uint8Array[];
      expect(q).toBeDefined();
      expect(q.length).toBeGreaterThan(60);      // 不折叠（旧实现第 65 条封顶合并后≈6 条 → 红）；软阈 flush 已尝试（append 挂起=批留队列，BOI copy-first）
      expect((kit.repo.append as MockRepo['append']).mock.calls.length).toBeGreaterThanOrEqual(1);   // 提前 flush 确已触发（防空转）
      release({ ok: true, seq: 1n });            // 释放——mutex 归还，dispose 干净
      await provider.destroy();
      kit.forget(provider);   // 自管 destroy 后移出 dispose 清理数组（双 destroy=已知 flaky 源，惯例同上）
    } finally { await kit.dispose(); }
  }, 15_000);

  it('卸载交接成功：队列批落 spool（append 成功→splice——新家落定后才离旧归属）+leaveInFlight（X2 落定点②）', async () => {
    const kit = await startDualClientServer({}, 60_000);   // 大 debounce：防 debounce store 先行清队列
    try {
      const g = kit.gateway as any;
      const { provider, synced } = kit.connect('project:p-handoff');
      await synced;
      provider.document.getMap('nodes').set('k1', 1);
      // >=2（非 >0）：stamp 自愈行+k1 两 update 全部落队再交接——WS 送达异步，>0 会在 stamp 时提前放行（k1 迟到→交接后断言假红）
      await pollUntil(() => ((g.pendingQueues.get('p-handoff') as Uint8Array[] | undefined)?.length ?? 0) >= 2, 2_000);
      await g.hooks.beforeUnloadDocument({ documentName: 'project:p-handoff', document: provider.document } as any);
      expect(g.pendingQueues.get('p-handoff')).toHaveLength(0);   // 批新家=spool（splice 落定）；空条目保留（I-1：doc 仍在 documents Map——直调非真卸载，回收禁行）
      expect(await kit.spool.peek('p-handoff')).toHaveLength(1);  // 帧在 spool（fsync 已落定）
      expect(g.inFlightProjects.has('p-handoff')).toBe(false);    // X2 落定点②：卸载交接 leave
    } finally { await kit.dispose(); }
  });

  it('卸载交接失败：钩子 resolves 不 reject（X4）+队列仍在（BOI）+persistRetry 已排（Y3——①cancel 后③重排，entry.timer 真值）+Y18 计数递增', async () => {
    const kit = await startDualClientServer({}, 60_000);
    const appendSpy = vi.spyOn(kit.spool, 'append').mockRejectedValue(new Error('spool down'));   // 裁定 1：恒抛不触盘（禁白盒 overCapacityFlag——滞回自清=断言假红）
    try {
      const g = kit.gateway as any;
      const { provider, synced } = kit.connect('project:p-unload-fail');
      await synced;
      provider.document.getMap('nodes').set('k1', 1);
      // >=2 同交接成功用例：stamp+k1 全落队再触发（WS 送达异步——>0 提前放行会让 k1 在断言窗内迟到）
      await pollUntil(() => ((g.pendingQueues.get('p-unload-fail') as Uint8Array[] | undefined)?.length ?? 0) >= 2, 2_000);
      const failMetric = register.getSingleMetric('yjs_unload_handoff_failure_total')!;
      const before = (await failMetric.get()).values[0]?.value ?? 0;   // V17⑥：metric.get() 公开 API（v15 异步）
      await expect(g.hooks.beforeUnloadDocument({ documentName: 'project:p-unload-fail', document: provider.document } as any)).resolves.toBeUndefined();
      expect(g.pendingQueues.get('p-unload-fail')).toHaveLength(2);   // 批留队列（唯一归属地仍在——stamp+k1 两 update 原样）
      expect(g.persistRetry.get('project:p-unload-fail')?.timer).toBeTruthy();   // 保活已排且在 ①cancel 之后（排程在 cancel 前=timer 被①清掉=红）
      expect(((await failMetric.get()).values[0]?.value ?? 0) - before).toBeGreaterThanOrEqual(1);   // Y18 指标接线
      appendSpy.mockRestore();
      await kit.gateway.hooks.onStoreDocument({ document: provider.document, documentName: 'project:p-unload-fail' } as any);   // 直调落库收尾（成功路径 cancel 保活梯）
      expect(g.pendingQueues.get('p-unload-fail')).toHaveLength(0);
    } finally { appendSpy.mockRestore(); await kit.dispose(); }
  });

  it('Y11 重连同数组身份：交接失败→重连 loadDocument get-or-create 撞同一条目（toBe 同引用+长度不减）→批经 store 落库一次', async () => {
    const kit = await startDualClientServer({}, 60_000);
    const appendSpy = vi.spyOn(kit.spool, 'append').mockRejectedValue(new Error('spool down'));
    try {
      const g = kit.gateway as any;
      const { provider, synced } = kit.connect('project:p-reconn');
      await synced;
      provider.document.getMap('nodes').set('k1', 1);
      provider.document.getMap('nodes').set('k2', 2);
      // >=3（stamp+k1+k2 全落队再取引用——WS 送达异步，>0 会让 beforeLen 读到中间水位）
      await pollUntil(() => ((g.pendingQueues.get('p-reconn') as Uint8Array[] | undefined)?.length ?? 0) >= 3, 2_000);
      const before = g.pendingQueues.get('p-reconn');
      const beforeLen = before.length;
      await g.hooks.beforeUnloadDocument({ documentName: 'project:p-reconn', document: provider.document } as any);
      expect(g.pendingQueues.get('p-reconn')).toBe(before);        // 同一数组引用（V4 get-or-create：set 替换写法必红）
      expect(g.pendingQueues.get('p-reconn')).toHaveLength(beforeLen);   // 批留存
      g.cancelPersistRetry('project:p-reconn');                    // 梯定时器随断言即清（防 1s 档并发扰动——落库由下方直调承担）
      appendSpy.mockRestore();
      await kit.gateway.hooks.onLoadDocument({ document: new Y.Doc(), documentName: 'project:p-reconn' } as any);   // 重连装载（白盒——库 documents 缓存使真重连不重走 load）
      expect(g.pendingQueues.get('p-reconn')).toBe(before);        // get-or-create 撞已有条目=同身份（批未因重连蒸发）
      await kit.gateway.hooks.onStoreDocument({ document: provider.document, documentName: 'project:p-reconn' } as any);
      expect(g.pendingQueues.get('p-reconn')).toHaveLength(0);     // 批落库
      expect((kit.repo.append as MockRepo['append']).mock.calls.length).toBe(1);   // 一次（无重复入队）
    } finally { appendSpy.mockRestore(); await kit.dispose(); }
  });

  it('Y7 硬阈 coalesce：双败故障期 600 条推入→队列收敛 ≤513（Y24 内存上界门）+yjs_pending_batches 不随 update 数线性增长', async () => {
    let release!: (v: { ok: true; seq: bigint }) => void;
    let passthrough = false;   // Y13 增强：release 后二次 append 直通（dispose drain 不挂死）
    const kit = await startDualClientServer({
      append: vi.fn(() => new Promise<{ ok: true; seq: bigint }>((r) => { if (passthrough) r({ ok: true, seq: 1n }); else release = r; })),
    }, 60_000);
    const appendSpy = vi.spyOn(kit.spool, 'append').mockRejectedValue(new Error('spool down'));   // 双败注入=裁定 1 形态
    try {
      const g = kit.gateway as any;
      const { provider, synced } = kit.connect('project:p-coalesce');
      await synced;
      // 确定性装置：600 条经**服务端 doc 直注**——客户端推入经 WS 送达是异步的（实测 loop 完成时队列仅 stamp 1 条，
      // 软阈 flush 中途取批使水位随机、"600 条在队"不可观测）。直注使入队/软阈闩锁/硬阈折并同步落定，判据零竞态。
      const serverDoc = kit.gateway.server.hocuspocus.documents.get('project:p-coalesce')!;
      const src = new Y.Doc(); const ups: Uint8Array[] = [];
      src.on('update', (u) => ups.push(u));
      for (let i = 0; i < 600; i++) src.getMap('nodes').set(`k${i}`, new Y.Map([['x', i]]));
      for (const u of ups) Y.applyUpdate(serverDoc as unknown as Y.Doc, u);   // 600 push 同步入队（第 65 条闩锁 setImmediate）
      await pollUntil(() => { const b = (g.computePending() as { batches: number }).batches; return b > 0 && b <= 513; }, 5_000);   // 排除空队列空转绿（b>0）+线性增长红（≤512+1——折并 601→1）
      const gauge = (await yjsPendingBatches.get()).values[0]?.value ?? 0;
      expect(gauge).toBeLessThanOrEqual(513);   // gauge 与队列同源收敛（不随 update 数线性增长）
      appendSpy.mockRestore();
      release({ ok: true, seq: 1n }); passthrough = true;   // 挂起 attempt 释放（Y8 身份判据走 anomaly-skip——合并元素留队重发，CRDT 幂等吸收）
      await kit.gateway.hooks.onStoreDocument({ document: provider.document, documentName: 'project:p-coalesce' } as any);   // 直调排空（dispose 干净）
      expect(g.computePending().batches).toBe(0);
    } finally { appendSpy.mockRestore(); if (release) release({ ok: true, seq: 1n }); await kit.dispose(); }
  }, 20_000);
});
