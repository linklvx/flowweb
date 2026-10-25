import { EventEmitter2 } from '@nestjs/event-emitter';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { Document } from '@hocuspocus/server';
import * as Y from 'yjs';
import { CollabGateway, UnloadDrainRefusedError } from './collab.gateway';
import { CollabDocumentService } from './collab-document.service';
import {
  CollabAuthReason, CLIENT_PROTOCOL_VERSION, type DocLike, type DocMapLike } from '@flowweb/shared';

/** 测试内 Y.Doc→DocLike 适配（历史版本门夹具形态——T18 起版本=PG 列，适配保留供读面） */
function toDocLike(doc: Y.Doc): DocLike {
  return {
    getMap: (name) => doc.getMap(name) as unknown as DocMapLike,
    createMap: () => new Y.Map() as unknown as DocMapLike,
  };
}
import { register } from 'prom-client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startDualClientServer, makeHeaderWs } from '../../test-utils/dual-client-server';
import { CollabSpoolService } from './collab-spool.service';
import { registerPendingCollector, unregisterPendingCollector, yjsPendingBatches } from './store.metrics';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { failingRepo } from '../../test-utils/failing-repo';
import { createMockRepo, type MockRepo } from '../../test-utils/mock-repo';
import { pollUntil } from '../../test-utils/poll-until';
import { createLeaseStub } from './test-utils/lease-stub';
import { gatewayFacade } from './test-utils/collab-gateway-test-facade';   // Y0c T39b B0：内部状态访问经 façade（check-collab-test-facade 门禁——cast∧私有成员违规替换）
import { appendFile, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';


function buildDocState(): Buffer {
  const doc = new Y.Doc();
  // T18：meta 零写（版本=PG 列——夹具行值经 repo mock schemaVersion 缺省 null=懒建档放行）
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

/** Y1c T9：维护写播种面——provider 写=connection 帧（actor 管线）不入维护队列；以 null-origin
 *  服务端 doc 写入（update 监听入队面=非 gate origin——同生产维护写形态）同步落队。 */
function seedMaintenance(gw: CollabGateway, pid: string, key: string, val: unknown = 1): Y.Doc {
  const sdoc = gw.server.hocuspocus.documents.get(`project:${pid}`) as unknown as Y.Doc | undefined;
  if (!sdoc) throw new Error(`server doc missing for ${pid}`);
  sdoc.getMap('nodes').set(key, val);
  return sdoc;
}

describe('CollabGateway + CollabDocumentService（integration）', () => {
  let prisma: any;
  let repo: any;
  let durableRows: Uint8Array[] = [];   // 持久化台账：只记真正 resolve 落库的 append 行（beforeEach 重置）
  let permSvc: { resolve: ReturnType<typeof vi.fn>; resolveWithTeam: ReturnType<typeof vi.fn> };   // Y0b-3 T3：F-3 换轨 resolveWithTeam 单源——类型注解同批（kit 已预置 mock）
  let gateway: CollabGateway;
  let service: CollabDocumentService;
  let residency: import('./collab-residency.service').CollabResidencyService;   // Y0c T15：会话释放面（afterEach destroy 前置）
  let emitter: EventEmitter2;
  let url: string;
  let spool: CollabSpoolService;   // Y0a-2：kit 注入的 spool 实例（peek 断言与装置用）
  const providers: HocuspocusProvider[] = [];

  beforeEach(async () => {
    durableRows = [];
    // Y0a-1：装置提取——fixture 构造收敛 dual-client-server（repo 台账经 over.appendBatch 注入；
    // prisma/permSvc/emitter 注入面随 kit 暴露，既有覆写路径不变）
    const kit = await startDualClientServer({
      appendBatch: vi.fn(async (_pid: string, rows: Array<{ update: Uint8Array }>) => { for (const r of rows) durableRows.push(new Uint8Array(r.update)); return { ok: true as const, rows: rows.length }; }),   // AppendResult 契约（Y0a-2 判别消费——禁 resolve undefined）；once 队列（mockRejectedValueOnce/mockImplementationOnce）优先于基础实现，失败调用不进台账（探针实证 mock.results 过滤不可用——rejected promise 是同步 return，results.type 恒 'return'）
    }, 300);
    ({ gateway, repo, url, prisma, permSvc, emitter, spool, docService: service, residency } = kit);
  });

  afterEach(async () => {
    for (const p of providers.splice(0)) await p.destroy();
    // Y0c T15：常驻会话先释放（读路径改道后 readCanvas 池化 doc——direct 在则库 runDestroy 永不 settle）
    for (const pid of residency.residentProjectIds()) await residency.releaseSessionFor(pid);
    await (gateway as any).server.destroy();
  });

  // T1.5：注入式 ws（Origin+Cookie header）——token 语义=cookie 值，URL 无 query token
  function connect(name: string, token = 'tok'): { ydoc: Y.Doc; provider: HocuspocusProvider; synced: Promise<void> } {
    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `${url}?csv=${CLIENT_PROTOCOL_VERSION}`,   // Y0b-3 T5 版本门：装置带当前协议版
      name,
      document: ydoc,
      WebSocketPolyfill: makeHeaderWs({ origin: 'http://localhost:5173', cookie: `flowweb.session_token=${token}` }),
      // WebSocketPolyfill 运行时透传支持、顶层 HocuspocusProviderConfiguration 未声明（先例 ws-polyfill.gate.spec:47）
    } as any);
    providers.push(provider);
    const synced = new Promise<void>((resolve) => provider.on('synced', () => resolve()));
    return { ydoc, provider, synced };
  }

    function extractHooks() {
      return (gateway as any).hooks as {
        onLoadDocument: (p: any) => Promise<any>;
        onStoreDocument: (p: any) => Promise<boolean>;   // Y1c T9：telemetry-only 探针（旧 store 链已拆——维护写显式 flush）
        onDisconnect: (p: any) => Promise<void>;
      };
    }

    /** Y1c T9（偏离 38①）：onStoreDocument 旧链拆除——维护写显式 flush 面（trigger='maintenance'，
     *  语义=旧 debounce 直调：null-origin 写经 update 监听入维护队列→维护通道 sink〔WAL+PG〕落定）。 */
    async function maintenanceFlush(document: any, documentName: string): Promise<boolean> {
      // 白盒直调 Unlocked（旧 onStoreDocument 钩子直通同形——hook 文档无 saveMutex，禁再包=A14）
      return gatewayFacade(gateway).storeDocumentUnlocked({ document, documentName }, 'maintenance');
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
      const g = gatewayFacade(gateway);
      const pending = g.pendingQueueRefForDoc(doc) as Uint8Array[] | undefined;
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
    // T1.5：token 语义改 cookie 值（'bad' 经 Cookie 头承载——session 查 null 仍拒）
    const provider = new HocuspocusProvider({
      url: `${url}?csv=${CLIENT_PROTOCOL_VERSION}`,   // Y0b-3 T5 版本门：装置带当前协议版（测的是无 session 拒——须过版本门）
      name: 'project:p2',
      document: new Y.Doc(),
      WebSocketPolyfill: makeHeaderWs({ origin: 'http://localhost:5173', cookie: 'flowweb.session_token=bad' }),
    } as any);
    providers.push(provider);
    await new Promise((r) => setTimeout(r, 1500));
    expect(provider.isSynced).toBe(false);
  }, 8000);

  it('① 非团队成员拒绝：连接永不完成 sync', async () => {
    permSvc.resolveWithTeam.mockResolvedValue({ role: null, teamId: 't1' });   // Y0b-3 T3 F-3 换轨：权限判据走 resolveWithTeam（原打 teamMember.findUnique 已不在判据链）
    const provider = new HocuspocusProvider({
      url: `${url}?csv=${CLIENT_PROTOCOL_VERSION}`,   // Y0b-3 T5 版本门：装置带当前协议版（测的是非成员拒——须过版本门）
      name: 'project:p3',
      document: new Y.Doc(),
      WebSocketPolyfill: makeHeaderWs({ origin: 'http://localhost:5173', cookie: 'flowweb.session_token=tok' }),
    } as any);
    providers.push(provider);
    await new Promise((r) => setTimeout(r, 1500));
    expect(provider.isSynced).toBe(false);
  }, 8000);

  describe('onAuthenticate：VIEWER 只读贯通（spec 1.2）', () => {
    function authPayload(connectionConfig: { readOnly: boolean; isAuthenticated: boolean }) {
      return {
        requestHeaders: new Headers({ cookie: 'flowweb.session_token=tok' }),
        requestParameters: new URLSearchParams(`csv=${CLIENT_PROTOCOL_VERSION}`),   // Y0b-3 T5 版本门：装置带当前协议版
        documentName: 'project:p1',
        connectionConfig,
      };
    }

    it('PROJECT_VIEWER：auth 期意图（freezeIntent=viewer）+connected 登记 writeFreeze→readOnly（Y0b-5 T16：config 直写退役——census ⑪ 3→2）', async () => {
      permSvc.resolveWithTeam.mockResolvedValue({ role: 'PROJECT_VIEWER', teamId: 't1' });   // Y0b-3 T3 F-3 换轨：覆写点同步 resolveWithTeam
      const connectionConfig = { readOnly: false, isAuthenticated: false };
      const ctx = await gateway.hooks.onAuthenticate(authPayload(connectionConfig) as any);
      expect(connectionConfig.readOnly).toBe(false);   // 直写退役——只读面归 writeFreeze 单源
      expect(ctx).toMatchObject({ user: { id: 'u1' }, readOnly: true, freezeIntent: 'viewer' });
      // connected 登记（库在 onAuthenticate 返回后 new Connection——意图经 context 在此施加；
      // connected 先于任何帧处理 ⇒ readOnly 库级首帧拦截等价）
      const conn: any = { socketId: 'sock-v1', context: { ...(ctx as any), token: 'tok' }, readOnly: false, sendStateless: vi.fn() };
      await gateway.hooks.connected({ socketId: 'sock-v1', connection: conn, documentName: 'project:p1' } as any);
      expect(conn.readOnly).toBe(true);
      expect(conn.sendStateless).toHaveBeenCalledWith(JSON.stringify({ type: 'conn-status', readOnly: true }));
    });

    it('EDITOR：正常可写', async () => {
      permSvc.resolveWithTeam.mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' });   // Y0b-3 T3 F-3 换轨
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
      expect(repo.appendBatch).toHaveBeenCalled();
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

  // Y0b-2 T7：readCanvas SV 等待三用例随 sv 参数/waitForSV 机制退役删除
  //（客户端同步判定移受理端点 SV 支配门 sync-admission.ts——sv-admission.int.spec.ts 承接）。

  it('readCanvas 无 sv：直接读', async () => {
    // Y0c T15：readCanvas 改道 withSession（会话读面）——stub seam 同步（原 withDoc spy）
    vi.spyOn(service, 'withSession').mockImplementation(async (_p: string, fn: any) => fn(new Y.Doc()));
    await expect(service.readCanvas('p1')).resolves.toBeTruthy();
  });

  it('⑦ e2e：远端删除 → destroy 断连 flush → 真实卸载后重连从持久层重放不复活', async () => {
    const errSpy = gatewayFacade(gateway).spyLogger('error').mockImplementation(() => {});
    try {
      const a = connect('project:pe1');
      await a.synced;
      const n = new Y.Map();
      n.set('type', 'textInput');
      a.ydoc.getMap('nodes').set('n1', n);
      await vi.waitFor(() => expect(repo.appendBatch.mock.calls.length).toBeGreaterThanOrEqual(1), { timeout: 4000 });   // Y1c T9：actor 即时落库（无 debounce 窗）——插入帧已落 PG
      a.ydoc.getMap('nodes').delete('n1');
      await a.provider.destroy();   // 真实断连 → onClose → onDisconnect flush
      providers.splice(providers.indexOf(a.provider), 1);   // 用例内已销毁——从 afterEach 清理数组移除，防双 destroy（collab.gateway flaky 面收敛）
      await vi.waitFor(() => expect(repo.appendBatch.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 4000 });   // 删除帧亦落（断连 flush 前 actor 已即时落）
      // 关键：等 doc 真正卸载（卸载交接 + unload 守卫）——否则重连命中内存缓存、测不到持久层
      await vi.waitFor(() => expect(gateway.server.hocuspocus.documents.has('project:pe1')).toBe(false), { timeout: 4000 });
      const loadCallsBefore = (repo.hydrateWithRecovery as any).mock.calls.length;
      repo.hydrateWithRecovery.mockResolvedValue({ state: null, updates: appendedRows(), stateSeq: 0n });   // 持久层 = 已落库行（插入行 + 删除行）
      const b = connect('project:pe1');
      await b.synced;
      expect((repo.hydrateWithRecovery as any).mock.calls.length).toBeGreaterThan(loadCallsBefore);   // 确实走了持久层重放（非缓存命中）
      // Y1c T9 判别力锚（批合并形态）：插入内容真实落库（前缀重放过程中 n1 可见——防"空 doc 恒绿"）
      { const rev = new Y.Doc(); let saw = false; for (const u of appendedRows()) { Y.applyUpdate(rev, u); if (rev.getMap('nodes').has('n1')) saw = true; } expect(saw).toBe(true); }
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
      await maintenanceFlush(doc, 'project:p1');
      expect(repo.appendBatch).toHaveBeenCalledTimes(1);
      // 再触发一次无变化：不 append（契约：readCanvas 无条件触发零写放大）
      await maintenanceFlush(doc, 'project:p1');
      expect(repo.appendBatch).toHaveBeenCalledTimes(1);
    });

    it('onLoadDocument：快照 + 增量按序重放', async () => {
      const { onLoadDocument } = extractHooks();
      const snapDoc = new Y.Doc(); snapDoc.getMap('nodes').set('a', 1);
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
      gatewayFacade(gateway).backdateLastCompactAt('p1', Date.now() - 61_000);   // 批3-4 时间门限：窗口达标才 compact（本例焦点是 flush-then-compact 耦合）
      doc.getMap('nodes').set('x', 1);
      await onDisconnect({ document: doc, documentName: 'project:p1' });
      expect(repo.appendBatch).toHaveBeenCalledTimes(1);
      expect(repo.compact).toHaveBeenCalledTimes(1);
      expect((repo.appendBatch as any).mock.invocationCallOrder[0]).toBeLessThan((repo.compact as any).mock.invocationCallOrder[0]);
    });

    it('onDisconnect：非最后连接早退——不 flush 不 compact', async () => {
      const { onLoadDocument, onDisconnect } = extractHooks();
      const doc = new Document('project:p1');   // Y0a-2：真 Document（saveMutex）——非最后连接形态
      await onLoadDocument({ document: doc, documentName: 'project:p1' });   // 同实例：queue 有内容，若早退守卫被删则 append 会被调 → 红
      doc.getMap('nodes').set('x', 1);
      // Y0b-3 T6：早退判据改读 payload.clientsCount（库 esm:1059 removeConnection 后现算——
      // 原 doc.getConnectionsCount() mock 随契约替换退役）
      await onDisconnect({ document: doc, documentName: 'project:p1', clientsCount: 1 });
      expect(repo.appendBatch).not.toHaveBeenCalled();
      expect(repo.compact).not.toHaveBeenCalled();
    });

    it('红1：纯删除 diff append——SV 不变不得当"无变化"跳过', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', new Y.Map());
      await maintenanceFlush(doc, 'project:p1');
      expect(repo.appendBatch).toHaveBeenCalledTimes(1);   // 插入 append#1（新旧实现都成立）
      const svBefore = Y.encodeStateVector(doc);
      doc.getMap('nodes').delete('n1');
      // 不变量 4：删除不产生新 struct、SV 字节不变（本次事故根因的反直觉事实）
      expect(Buffer.from(Y.encodeStateVector(doc))).toEqual(Buffer.from(svBefore));
      await maintenanceFlush(doc, 'project:p1');
      expect(repo.appendBatch).toHaveBeenCalledTimes(2);   // 红：现状 SV 判等挡住，恒 1
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
      gatewayFacade(gateway).backdateLastCompactAt('p1', Date.now() - 61_000);   // 批3-4：compact 时间窗达标（焦点在 flush 不在门限）
      doc.getMap('nodes').set('n1', new Y.Map());
      await maintenanceFlush(doc, 'project:p1');   // append#1 插入
      doc.getMap('nodes').delete('n1');
      await onDisconnect({ document: doc, documentName: 'project:p1' });
      expect(repo.appendBatch).toHaveBeenCalledTimes(2);   // 红：现状 flush 被 SV 判等挡住
      expect((repo.appendBatch as any).mock.invocationCallOrder[0]).toBeLessThan((repo.compact as any).mock.invocationCallOrder[0]);  // flush 先于 compact
      const rows = appendedRows();
      expect(replayOf([rows[0]]).getMap('nodes').has('n1')).toBe(true);
      expect(replayOf(rows).getMap('nodes').has('n1')).toBe(false);
    });

    it('红2b：删完断连后同 doc 再变更——重放等价（次数从序列推导，旧实现=1、新实现=3）', async () => {
      const { onLoadDocument, onStoreDocument, onDisconnect } = extractHooks();
      const doc = new Document('project:p1');   // Y0a-2：真 Document（disconnect 走 storeDocumentSerialized——saveMutex 需真锁载体；连接数缺省=0）
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', new Y.Map());
      await maintenanceFlush(doc, 'project:p1');   // #1 插入
      doc.getMap('nodes').delete('n1');
      await onDisconnect({ document: doc, documentName: 'project:p1' });       // #2 flush 删除（现状被挡）
      doc.getMap('nodes').set('n2', new Y.Map());                              // 缓存复用后再写入
      await maintenanceFlush(doc, 'project:p1');   // #3（现状 !lastSV 静默）
      expectDurableEquivalent(doc);                    // 主判据
      expect(repo.appendBatch).toHaveBeenCalledTimes(3);     // 辅助断言：新实现序列 =3
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
      await maintenanceFlush(doc, 'project:p1'); // 红：现状 !lastSV 静默 return，恒 1
      expect(repo.appendBatch).toHaveBeenCalledTimes(2);
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
      release();
      await loading;
      const pending = gatewayFacade(gateway).pendingQueueRefForDoc(doc) as Uint8Array[];   // Y4：两跳（V4 projectId 键控）——façade 归并单操作
      expect(pending).toHaveLength(1);                    // 窗口写 win1 进 pending（T18：原 +1=stamp 自愈行——meta 零写）
      await maintenanceFlush(doc, 'project:p1');
      expect(repo.appendBatch).toHaveBeenCalledTimes(1);
      expect(replayOf(appendedRows()).getMap('nodes').has('win1')).toBe(true);
    });

    it('绿1（T18 改写）：无戳空档 load 零自愈写——空 doc store 零 append（原 stamp 落库行删除）+连续 store 维持 noop', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      expect(doc.getMap('meta').size).toBe(0);         // T18：meta 零键（版本=PG 列）
      await maintenanceFlush(doc, 'project:p1');
      expect(repo.appendBatch).not.toHaveBeenCalled();     // 空 doc 零写（无 stamp 自愈 update）
      await maintenanceFlush(doc, 'project:p1');
      await maintenanceFlush(doc, 'project:p1');
      expect(repo.appendBatch).not.toHaveBeenCalled();     // 无变更不 append（零写放大契约保持）
    });

    it('绿1b：tombstone 三段——真实删除落库 / 重复 tombstone 0 事件不落行 / 对端新 struct 必须落库', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', new Y.Map());
      doc.getMap('nodes').set('n2', new Y.Map());
      await maintenanceFlush(doc, 'project:p1');   // append#1（两个插入）
      // 自源构造 doc 自己的删除增量（外源 tombstone 引用他人 clock：0 事件、删不掉、还悬挂 pendingDs 污染 canonical——实测）
      const own: Uint8Array[] = [];
      const capture = (u: Uint8Array) => own.push(u);
      doc.on('update', capture);
      doc.getMap('nodes').delete('n2');
      doc.off('update', capture);
      const tombstone = own[0];
      await maintenanceFlush(doc, 'project:p1');
      expect(repo.appendBatch).toHaveBeenCalledTimes(2);   // ① 真实删除（1 事件 → 进 pending）落库
      let events = 0;
      const count = () => { events += 1; };
      doc.on('update', count);
      Y.applyUpdate(doc, tombstone);   // ② 重复应用已知 tombstone：0 事件
      doc.off('update', count);
      expect(events).toBe(0);
      await maintenanceFlush(doc, 'project:p1');
      expect(repo.appendBatch).toHaveBeenCalledTimes(2);   // ② 不落行（这才是判据——上一行断言的是"重复=0事件"，本行断言"0事件不落行"）
      const peer = new Y.Doc();   // ③ 对照：带新 struct 的对端 diff → 1 事件 → 真实新信息必须落库
      peer.getMap('nodes').set('peer1', new Y.Map());
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
      await maintenanceFlush(doc, 'project:p1');
      expect(repo.appendBatch).toHaveBeenCalledTimes(3);
      expectDurableEquivalent(doc);
    });

    it('绿1c：重放不进队列——load 完成后 pending 为空', async () => {
      const { onLoadDocument } = extractHooks();
      const snapDoc = new Y.Doc(); snapDoc.getMap('nodes').set('a', 1);
      repo.hydrateWithRecovery.mockResolvedValue({ state: Buffer.from(Y.encodeStateAsUpdate(snapDoc)), updates: [Buffer.from(Y.encodeStateAsUpdate((() => { const d = new Y.Doc(); d.getMap('nodes').set('b', 2); return d; })()))], stateSeq: 0n });
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      expect(doc.getMap('nodes').get('a')).toBe(1);
      expect(doc.getMap('nodes').get('b')).toBe(2);
      expect(gatewayFacade(gateway).pendingQueueRefForDoc(doc)).toHaveLength(0);   // 重放被抑制，不污染队列（Y4：两跳）
    });

    it('绿2：append 失败抛错回灌——再 store 重试成功，无部分批', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', new Y.Map());
      doc.getMap('nodes').set('n2', new Y.Map());
      repo.appendBatch.mockRejectedValueOnce(new Error('db down'));
      await expect(maintenanceFlush(doc, 'project:p1')).resolves.toBe(false);   // Y0a-2 契约 3 反转：任何路径不 throw（失败批走 spool——旧断言 rejects.toThrow 必红点）
      expect(await spool.peek('p1')).toHaveLength(1);   // Y0a-2：失败批已入 spool 帧（新家落定——旧实现批留队列，V4 后批的失败归属=spool）
      await maintenanceFlush(doc, 'project:p1');
      expect(repo.appendBatch).toHaveBeenCalledTimes(2);   // 重试成功（第一次失败 + 第二次成功）
      expect(gatewayFacade(gateway).pendingQueueRefForDoc(doc)).toHaveLength(0);
      expectDurableEquivalent(doc);
    });

    it('绿3：GC 场景（删除后无关事务触发 gc）——重放删净 + canonical 等价', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();   // gc 默认 true（与 Hocuspocus 生产一致）
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', new Y.Map());
      doc.getMap('nodes').set('n2', new Y.Map());
      await maintenanceFlush(doc, 'project:p1');
      doc.getMap('nodes').delete('n2');
      doc.getMap('other').set('z', 1);   // 无关事务推进 GC
      doc.getMap('other').set('w', 2);
      await maintenanceFlush(doc, 'project:p1');
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
      await maintenanceFlush(doc, 'project:p1');
      expect(repo.appendBatch).toHaveBeenCalledTimes(1);   // mergeUpdates 单行（否决逐行：302 行会击穿 compact 门限）
      expect(appendedRows()[0].length).toBeLessThan(20000);   // 合并后远小于逐行总和（~6KB 量级）
      expect(repo.compact).not.toHaveBeenCalled();   // 批3-4 时间门限：load 播种基线，60s 内不 compact
    });

    it('绿5：compact 时间门限（批3-4，代行数门限 COMPACT_THRESHOLD=32）——基线 60s 内不 compact，超窗 compact 在 append 后被调', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', 1);
      await maintenanceFlush(doc, 'project:p1');
      expect(repo.compact).not.toHaveBeenCalled();   // load 刚播种基线：未满 60s 窗口

      gatewayFacade(gateway).backdateLastCompactAt('p1', Date.now() - 61_000);   // 回拨基线模拟窗口已过
      doc.getMap('nodes').set('n2', 2);
      await maintenanceFlush(doc, 'project:p1');
      expect(repo.compact).toHaveBeenCalledTimes(1);
      expect((repo.appendBatch as any).mock.invocationCallOrder[0]).toBeLessThan((repo.compact as any).mock.invocationCallOrder[0]);
      // compact 后基线重置：紧接的再 store 不复发
      doc.getMap('nodes').set('n3', 3);
      await maintenanceFlush(doc, 'project:p1');
      expect(repo.compact).toHaveBeenCalledTimes(1);
    });

    it('绿5b：disconnect 的 wrote 契约——没写就不 compact，写了才 compact（时间窗达标前提）', async () => {
      const { onLoadDocument, onStoreDocument, onDisconnect } = extractHooks();
      const docA = new Document('project:p1');   // Y0a-2：真 Document（saveMutex——disconnect 直调路径）
      await onLoadDocument({ document: docA, documentName: 'project:p1' });
      await maintenanceFlush(docA, 'project:p1');   // O0b-0：stamp 自愈行先落库——队列净空
      (repo.appendBatch as any).mockClear();
      gatewayFacade(gateway).backdateLastCompactAt('p1', Date.now() - 61_000);   // 窗口达标：排除时间门限干扰，只测 wrote 耦合
      await onDisconnect({ document: docA, documentName: 'project:p1' });   // 队列空 → wrote=false
      expect(repo.compact).not.toHaveBeenCalled();
      const docB = new Document('project:p2');
      await onLoadDocument({ document: docB, documentName: 'project:p2' });
      await maintenanceFlush(docB, 'project:p2');   // stamp 落库
      (repo.appendBatch as any).mockClear();
      gatewayFacade(gateway).backdateLastCompactAt('p2', Date.now() - 61_000);
      docB.getMap('nodes').set('x', 1);
      await onDisconnect({ document: docB, documentName: 'project:p2' });
      expect(repo.compact).toHaveBeenCalledTimes(1);   // wrote=true → compact
    });

    it('绿6：disconnect 不抛——compact reject 时 onDisconnect 必须 resolve（进程守门）', async () => {
      const { onLoadDocument, onDisconnect } = extractHooks();
      const doc = new Document('project:p1');   // Y0a-2：真 Document（saveMutex——disconnect 直调路径）
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      gatewayFacade(gateway).backdateLastCompactAt('p1', Date.now() - 61_000);   // 批3-4 时间门限：窗口达标才会碰 compact
      doc.getMap('nodes').set('x', 1);
      repo.compact.mockRejectedValueOnce(new Error('lock timeout'));
      await expect(onDisconnect({ document: doc, documentName: 'project:p1' })).resolves.toBeUndefined();
      expect(repo.appendBatch).toHaveBeenCalledTimes(1);   // 行已落库
    });

    it('绿6b：flush 失败吞错契约——append reject 时 onDisconnect 仍 resolve（stash 兜底不抛）', async () => {
      const { onLoadDocument, onDisconnect } = extractHooks();
      const doc = new Document('project:p1');   // Y0a-2：真 Document（saveMutex——disconnect 直调路径）
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('x', 1);
      repo.appendBatch.mockRejectedValueOnce(new Error('db down'));
      // 吞错契约显式断言（进程守门）：onDisconnect 是 onClose 的不-await 回调，抛错 = unhandled rejection = 进程退出
      await expect(onDisconnect({ document: doc, documentName: 'project:p1' })).resolves.toBeUndefined();
      expect(await spool.peek('p1')).toHaveLength(1);   // Y0a-2：失败批已入 spool（fsync 落定——兜底生效，契约清单 A peek 替换）
    });

    it('绿7：tripwire 双向——未注册 doc 的 store / update 事件都 ERROR 且不静默', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const errSpy = gatewayFacade(gateway).spyLogger('error').mockImplementation(() => {});
      try {
        const stranger = new Y.Doc();   // ① store 侧：未 load 的 doc 直接 store
        stranger.getMap('nodes').set('x', 1);
        await maintenanceFlush(stranger, 'project:p9');
        expect(repo.appendBatch).not.toHaveBeenCalled();
        expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('unobserved'));
        const doc = new Y.Doc();   // ② 监听器侧：注册后条目异常丢失 → update 事件 ERROR
        await onLoadDocument({ document: doc, documentName: 'project:p1' });
        gatewayFacade(gateway).clearPendingQueue('p1');   // Y4：条目丢失模拟改 projectId 键控形态（update 回调经 docProject 解析队列——条目缺失=untracked）
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
      await maintenanceFlush(docA, 'project:p1');   // append#1 插入落库
      const insertRow = appendedRows()[0];   // 显式捕获插入行（避免对 append 调用序的隐式依赖）
      docA.getMap('nodes').delete('n2');
      repo.appendBatch.mockRejectedValueOnce(new Error('db down'));
      await onDisconnect({ document: docA, documentName: 'project:p1' });      // flush 失败 → 批入 spool（契约 3 不抛）
      expect(await spool.peek('p1')).toHaveLength(1);   // Y0a-2：失败批已入 spool（fsync 落定）
      repo.hydrateWithRecovery.mockResolvedValue({ state: null, updates: [insertRow], stateSeq: 0n });   // 新实例从"DB"重放插入行
      const docB = new Y.Doc();
      await onLoadDocument({ document: docB, documentName: 'project:p1' });
      expect(gatewayFacade(gateway).pendingQueueRefForDoc(docB)).toHaveLength(1);   // 帧窗口外回灌进 pending（不编辑）
      expect(await spool.peek('p1')).toHaveLength(1);   // Y0a-2：帧保留至 append 成功（confirm 恒在成功后，契约 12）——段回收见下方落库断言
      await maintenanceFlush(docB, 'project:p1');   // 提前 drain：帧随本批落库并 confirm
      expect(await spool.peek('p1')).toHaveLength(0);   // 段回收（append 成功 → confirm → unlink）
      expect(repo.appendBatch).toHaveBeenCalledTimes(3);   // #1 成功 + #2 失败 + #3 帧落库
      const all = appendedRows();
      expect(replayOf([all[0]]).getMap('nodes').has('n2')).toBe(true);    // 插入行真实含 n2
      expect(replayOf(all).getMap('nodes').has('n2')).toBe(false);        // stash（删除）生效
      await maintenanceFlush(docB, 'project:p1');
      expect(repo.appendBatch).toHaveBeenCalledTimes(3);   // 再 store 不 append（无重复入队）
    });

    it('绿8b：stash 提前 drain——disconnect 失败产生 stash 后，同 doc（不重载）下次 store 即落 stash', async () => {
      const { onLoadDocument, onStoreDocument, onDisconnect } = extractHooks();
      const doc = new Document('project:p1');   // Y0a-2：真 Document（saveMutex——disconnect 直调路径）
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', new Y.Map());
      await maintenanceFlush(doc, 'project:p1');   // #1 插入成功
      doc.getMap('nodes').delete('n1');
      repo.appendBatch.mockRejectedValueOnce(new Error('db down'));
      await onDisconnect({ document: doc, documentName: 'project:p1' });      // flush 失败 → 批入 spool（契约 3 不抛）
      expect(await spool.peek('p1')).toHaveLength(1);   // Y0a-2：失败批已入 spool
      const wrote = await maintenanceFlush(doc, 'project:p1');   // 提前 drain 随本批落库
      expect(wrote).toBe(true);
      expect(await spool.peek('p1')).toHaveLength(0);   // 段回收（append 成功 → confirm → unlink）
      const all = appendedRows();
      expect(replayOf([all[0]]).getMap('nodes').has('n1')).toBe(true);
      expect(replayOf(all).getMap('nodes').has('n1')).toBe(false);   // 删除随 stash 落库
    });

    it('绿8c：stash-已在-DB 引理——stash 与 DB 同源（同 clientID）→ load 回灌 0 事件 → store 不 append', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const snapDoc = new Y.Doc(); snapDoc.getMap('nodes').set('a', 1);
      repo.hydrateWithRecovery.mockResolvedValue({ state: Buffer.from(Y.encodeStateAsUpdate(snapDoc)), updates: [], stateSeq: 0n });
      await spool.append('p1', Y.encodeStateAsUpdate(snapDoc));   // Y0a-2：装置行改 spool 帧（与快照同源——apply 0 事件）
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      expect(await spool.peek('p1')).toHaveLength(1);   // Y0a-2：帧保留至 append 成功（Y0a-1"消费后清空"语义随契约 12 反转）
      expect(gatewayFacade(gateway).pendingQueueRefForDoc(doc)).toHaveLength(0);   // 同源 apply=0 事件，队列零污染
      await maintenanceFlush(doc, 'project:p1');   // 帧回收行（与 DB 同源=幂等冗余——confirm 恒在 append 成功后）
      expect(repo.appendBatch).toHaveBeenCalledTimes(1);   // 帧回收落库（零写放大契约由"帧保留"语义取代）
      expect(await spool.peek('p1')).toHaveLength(0);   // confirm → 段回收
    });

    it('Y0a-1 peek/consume：版本门拒绝 ⇒ stash 存活；正常档 ⇒ 消费后清空', async () => {
      const { onLoadDocument } = extractHooks();
      // 拒绝档：行 schemaVersion=2（T18 PG 列门——doc meta 残留非判据）
      const bad = new Y.Doc();
      bad.getMap('nodes').set('n', new Y.Map());
      repo.hydrateWithRecovery.mockResolvedValueOnce({ state: Buffer.from(Y.encodeStateAsUpdate(bad)), updates: [], stateSeq: 0n, schemaVersion: 2 });
      await spool.append('p-peek', Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())));   // Y0a-2：装置行改 spool 帧
      await expect(onLoadDocument({ document: new Y.Doc(), documentName: 'project:p-peek' }))
        .rejects.toMatchObject({ schemaRefusal: true });
      expect(await spool.peek('p-peek')).toHaveLength(1);      // 拒档：帧存活（蒸发路径已关）
      // 正常档：空 doc（行缺失懒建档——T18 无 stamp 自愈）⇒ 帧 apply 保留（confirm 出口=下次 store 提前 drain）
      repo.hydrateWithRecovery.mockResolvedValueOnce({ state: null, updates: [], stateSeq: 0n });
      const okDoc = new Y.Doc();
      await onLoadDocument({ document: okDoc, documentName: 'project:p-peek' });
      expect(await spool.peek('p-peek')).toHaveLength(1);      // Y0a-2：帧保留（Y0a-1"消费后清空"随契约 12 反转）
      await gatewayFacade(gateway).storeDocumentUnlocked({ document: okDoc, documentName: 'project:p-peek' } as any, 'maintenance');   // store 直调：帧随批落库并 confirm（白盒直调）
      expect(await spool.peek('p-peek')).toHaveLength(0);      // confirm → 段回收
    });

    it('绿9：队列身份恒定——软阈跨点闩锁 flush（禁 set 替换数组）', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      const firstRef = gatewayFacade(gateway).pendingQueueRefForDoc(doc);   // Y4：两跳取队列（façade 归并——真实数组引用）
      for (let i = 0; i < 70; i++) doc.getMap('nodes').set(`k${i}`, { v: i });   // >64 跨软阈（X10：WS 路径零折并——批全留队列，闩锁 setImmediate 提前 store）
      expect(gatewayFacade(gateway).pendingQueueRefForDoc(doc)).toBe(firstRef);   // toBe 同一对象（数组身份恒定不变量——set 替换写法必红）
      await maintenanceFlush(doc, 'project:p1');
      expect(repo.appendBatch).toHaveBeenCalledTimes(1);   // 70 条一次 drain 单行（直调 store 微任务链先于 setImmediate flush 完成——flush 见空队列静默返回）
      await maintenanceFlush(doc, 'project:p1');
      expect(repo.appendBatch).toHaveBeenCalledTimes(1);   // 无积压重复（drain 后队列净空；身份违例形态由上方 toBe 钉死——突变实证：set 替换下本断言仍绿，勿靠它守身份）
      expectDurableEquivalent(doc);
    });

    it('绿9b：失败+交错回归——await 窗口注入更新触发封顶后 append 失败，失败批仍在归属地（契约 3：任何路径不 throw）', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', new Y.Map());
      let rejectAppend!: (e: Error) => void;
      repo.appendBatch.mockImplementationOnce(() => new Promise((_res, rej) => { rejectAppend = rej; }));
      const g = gatewayFacade(gateway);
      const storePromise = maintenanceFlush(doc, 'project:p1');   // Y1c T9：维护显式 flush（旧 onStoreDocument 钩子已拆 telemetry-only）
      // Y1c T9：维护通道序=WAL fsync→PG append（真 IO 异步）——跑到 await append 的确定性判据
      await vi.waitFor(() => expect(typeof rejectAppend).toBe('function'), { timeout: 4000 });
      for (let i = 0; i < 70; i++) doc.getMap('nodes').set(`k${i}`, { v: i });   // 窗口内注入 >64 条 → 软阈闩锁（白盒 doc 未注册进库 documents——flush 见无 doc 静默返回，零串扰）
      rejectAppend(new Error('db down'));
      await expect(storePromise).resolves.toBe(false);   // Y0a-2 契约 3 反转：任何路径不 throw（旧断言 rejects.toThrow 必红点）
      const queue = g.pendingQueueRefForDoc(doc) as Uint8Array[];
      const frames = await spool.peek('p1');
      expect(queue.length + frames.length).toBeGreaterThan(0);   // BOI：失败批仍在归属地（V4 队列 ∪ spool 帧——两者其一非空）
      await maintenanceFlush(doc, 'project:p1');
      expect(repo.appendBatch).toHaveBeenCalledTimes(2);   // 失败 1 + 重试成功 1
      expect(gatewayFacade(gateway).pendingQueueRefForDoc(doc)).toHaveLength(0);
      expectDurableEquivalent(doc);
    });

    it('绿10：compact 失败降级——append 成功 + compact reject → 不抛、行已落库、WARN、不 stash', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const warnSpy = gatewayFacade(gateway).spyLogger('warn').mockImplementation(() => {});
      try {
        const doc = new Y.Doc();
        await onLoadDocument({ document: doc, documentName: 'project:p1' });
        gatewayFacade(gateway).backdateLastCompactAt('p1', Date.now() - 61_000);   // 批3-4 时间门限：窗口达标才会碰 compact
        doc.getMap('nodes').set('n1', 1);
        repo.compact.mockRejectedValueOnce(new Error('lock timeout'));
        const wrote = await maintenanceFlush(doc, 'project:p1');
        expect(wrote).toBe(true);
        expect(repo.appendBatch).toHaveBeenCalledTimes(1);
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
    const kit = await startDualClientServer({ appendBatch: vi.fn(() => new Promise((r) => { release = r; })) }, 200);
    try {
      const doc = new Y.Doc();
      const name = 'project:p-boi1';
      const g = gatewayFacade(kit.gateway);
      g.seedPendingQueue('p-boi1', [new Uint8Array([1, 2, 3])]);                 // Y19：projectId 键控装置（V4——旧字段 pendingUpdates 直插=种子不可见）
      const errSpy = g.spyLogger('error');
      void g.storeDocumentUnlocked({ document: doc, documentName: name } as any, 'maintenance');   // 不 await——append 挂起（白盒直调：Y.Doc 非 Document 满型——Step 3b 注）
      await pollUntil(() => (kit.repo.appendBatch as MockRepo['append']).mock.calls.length >= 1, 2_000);   // Y4：等 append 真被调——防 tripwire 早退的空转绿
      try {
        expect(errSpy.mock.calls.some((c) => String(c[0]).includes('unobserved'))).toBe(false);   // Y4 反向断言：tripwire 未吞掉用例
        expect(g.pendingQueueRef('p-boi1')).toHaveLength(1);                     // copy-first：批仍在旧归属地（旧实现 splice 后=0 → 红）
      } finally {
        release({ ok: true, seq: 1n });                                          // M8：断言红时也释放挂起——dispose 不挂死
      }
    } finally { await kit.dispose(); }
  });

  it('BOI-2 三代红相（fenced 0 行不抛错）：append resolve {ok:false,reason:"fenced"} → 批走 spool（新家）+不排重试——旧实现不检查返回值照常 splice=帧蒸发', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a2-boi2-');
    try {
      const spool = new CollabSpoolService(dir);
      const repo = createMockRepo({ appendBatch: vi.fn(async () => ({ ok: false as const, reason: 'fenced' as const })) });
      const kit = await startDualClientServer({ ...repo }, 200, spool);
      try {
        const g = gatewayFacade(kit.gateway);
        g.seedPendingQueue('p-boi2', [new Uint8Array([9, 9])]);                  // Y19：projectId 键控
        const r = await g.storeDocumentUnlocked({ document: new Y.Doc(), documentName: 'project:p-boi2' } as any, 'maintenance');   // 白盒直调（Y.Doc 非 Document 满型）
        expect(r).toBe(false);
        expect(g.pendingQueueRef('p-boi2')).toHaveLength(0);                     // 批已迁 spool 新家（splice 恒在新家 fsync 落定之后——旧实现 splice 后批两头蒸发：队列空∧spool 空，红相由下行 peek 断言承担）
        expect(await spool.peek('p-boi2')).toHaveLength(1);                      // 批入 spool（旧实现无 spool 写入 → 红）
        expect(g.persistRetrySize()).toBe(0);                                    // fenced=终态禁退避梯（契约 15）
      } finally { await kit.dispose(); }
    } finally { await cleanup(); }
  });

  it('BOI-3 一代断链：append 持续失败 → 断连卸载 doc → 批必须在 spool（磁盘）——旧实现 stash 进内存 unflushed=崩溃丢（红）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a2-boi3-');
    try {
      const spool = new CollabSpoolService(dir);
      const kit = await startDualClientServer({ appendBatch: failingRepo({ failAppend: 99 }).appendBatch }, 200, spool);   // Y1c T9：注入面=appendBatch（connection 帧 PG 腿）
      try {
        const name = 'project:p-boi3';
        const { provider, synced } = kit.connect(name);
        await synced;
        provider.document.getMap('nodes').set('n', new Y.Map([['x', 1]]));
        await pollUntil(() => (kit.repo.appendBatch as MockRepo['append']).mock.calls.length >= 1, 5_000);   // 首次 store 已失败
        // 注意时序：repo.appendBatch 调用点先于 spool fsync 完成（copy-first：splice 恒在新家落定之后）——
        // 全量并发下断言与 fsync 竞速会伪红，peek 落定必须轮询（帧可见=fsync 完成的直接证据）
        await pollUntil(async () => { const fr = await spool.peek('p-boi3'); return fr.some((f) => { const t = new Y.Doc(); try { Y.applyUpdate(t, f.payload); } catch { return false; } return t.getMap('nodes').has('n'); }); }, 5_000);   // BOI 失败路径：新家=WAL 已 fsync（含所写节点帧——Y1c T9 逐帧入账：空 SS2 帧亦独立在册；旧实现=内存 Map，spool 空 → 红）
        await provider.destroy();
        kit.forget(provider);   // 自管 destroy 后移出 dispose 清理数组——防双 destroy（flaky 源，惯例同上方 spec:262）
        // Y1c T10（偏离 37⑩+38⑤）翻转：PG 恒败 → applied 前缀不可 drain → beforeUnloadDocument 拒绝卸载
        // （doc 常驻 fail-closed——旧断言「卸载发生」=T9 形态）。BOI 主轴不变：批必须在 spool（磁盘）
        // ——常驻窗下逐帧检所写节点在册（帧已 fsync=新家落定；旧实现 stash 内存=spool 空 → 红）。
        // Q-M7（T10 收口）：固定 500ms sleep 改硬信号——卸载拒绝实际发生（doc_unload_blocked_total
        // 递增）才断常驻（sleep=竞态宽限非证据）。
        const unloadBlocked = async () => (register.getSingleMetric('doc_unload_blocked_total') as { get(): Promise<{ values: Array<{ value: number }> }> }).get().then((m) => m.values[0]?.value ?? 0);
        const blockedBefore = await unloadBlocked();
        await pollUntil(async () => (await unloadBlocked()) > blockedBefore, 12_000);   // 拒绝在 drain 预算（5s）耗尽后——窗宽 > 预算
        expect(kit.gateway.server.hocuspocus.documents.has(name)).toBe(true);   // 拒绝卸载=常驻——硬信号后直读
        {
          const fr = await spool.peek('p-boi3');
          expect(fr.length).toBeGreaterThanOrEqual(1);
          const revived = new Y.Doc();
          for (const f of fr) { try { Y.applyUpdate(revived, f.payload); } catch { /* 帧级容错 */ } }
          expect(revived.getMap('nodes').has('n')).toBe(true);
        }
      } finally { await kit.dispose(); }
    } finally { await cleanup(); }
  }, 20_000);

  it('Q-I3 卸载拒绝分类=typed（UnloadDrainRefusedError·instanceof）——改文案不影响分类：无关键词的 typed 拒绝原样上抛且不双计 doc_unload_blocked_total（红=旧 message 子串分类误判意外异常）', async () => {
    const kit = await startDualClientServer({}, 200);
    try {
      const read = async () => (register.getSingleMetric('doc_unload_blocked_total') as { get(): Promise<{ values: Array<{ value: number }> }> }).get().then((m) => m.values[0]?.value ?? 0);
      const before = await read();
      // 文案已改（无「拒绝卸载」子串）的 typed 拒绝——分类必须按类型：原样上抛（取消卸载）+零双计
      const refusal = new UnloadDrainRefusedError('drain refused — wording changed（Q-I3 红轴：文案无关）');
      vi.spyOn(kit.gateway.projectActor, 'drainAppliedForUnload').mockImplementation(async () => { throw refusal; });
      await expect(kit.gateway.hooks.beforeUnloadDocument({ documentName: 'project:p-qi3' } as never)).rejects.toBe(refusal);
      expect(await read()).toBe(before);   // 红：旧 message 子串分类落「意外异常」档=再计 +1
    } finally { await kit.dispose(); }
  }, 10_000);

  it('BOI-4 崩溃模拟（V19 红相层）：append 失败 → 丢弃 gateway 实例（等价进程死）→ 同 spool 目录新实例 → 批存活可回灌（旧实现批在内存=红）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a2-boi4-');
    try {
      const kit1 = await startDualClientServer({ appendBatch: failingRepo({ failAppend: 99 }).appendBatch }, 200, new CollabSpoolService(dir));   // Y1c T9：注入面=appendBatch（PG 腿）
      const { provider, synced } = kit1.connect('project:p-boi4');
      await synced;
      provider.document.getMap('nodes').set('k', new Y.Map([['x', 1]]));
      await pollUntil(() => (kit1.repo.appendBatch as MockRepo['appendBatch']).mock.calls.length >= 1, 5_000);   // 失败已发生 → 帧已入 WAL（未 confirm）
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
      const rows = kit2.repo.appendBatch.mock.calls as unknown as Array<[string, Array<{ update: Uint8Array }>]>;
      const revived = new Y.Doc();
      for (const c of rows) for (const row of c[1]) Y.applyUpdate(revived, new Uint8Array(row.update));   // Y1c T9：rows[].update（新表形态）
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
    const kit = await startDualClientServer({ appendBatch: vi.fn(() => new Promise<{ ok: true; seq: bigint }>((r) => { release = r; })) }, 200);
    try {
      const g = gatewayFacade(kit.gateway);
      const upd = (n: number) => { const d = new Y.Doc(); d.getMap('nodes').set(`k${n}`, n); return Y.encodeStateAsUpdate(d); };   // 合法 Y update（mergeUpdates 对裸字节 throw——Y2 兜底吞错必 pollUntil 超时）
      g.seedPendingQueue('p-i2', [upd(1), upd(2), upd(3)]);   // Y19：projectId 键控装置（3 条——折并后 1 条，判据 length<n 必命中）
      const readAnomaly = async () => {
        const metrics = await register.getMetricsAsJSON();
        return ((metrics.find((m: any) => m.name === 'yjs_store_tail_anomaly_total') as any)?.values?.[0]?.value ?? 0) as number;
      };
      const before = await readAnomaly();
      const storeP = g.storeDocumentUnlocked({ document: new Y.Doc(), documentName: 'project:p-i2' } as any, 'maintenance');   // 不 await——append 挂起（白盒直调同 BOI-1）
      await pollUntil(() => (kit.repo.appendBatch as MockRepo['append']).mock.calls.length >= 1, 2_000);
      const q = g.pendingQueueRef('p-i2') as Uint8Array[];
      q.splice(0, q.length, Y.mergeUpdates(q));   // 白盒模拟 update 监听器封顶折并（await 交织窗——合并元素含快照后内容）
      try {
        expect(q).toHaveLength(1);                // 前置：折并已发生（1 < n=3 → Y8 判据必命中）
      } finally { release({ ok: true, seq: 1n }); }
      await storeP;
      const qAfter = g.pendingQueueRef('p-i2') as Uint8Array[];
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
      const wrote = await gatewayFacade(kit.gateway).storeDocumentUnlocked({ document: doc, documentName: 'project:p-cap' } as any, 'maintenance');
      expect(wrote).toBe(true);                                 // PG 腿健康：容量态不挡 store（帧消化到 PG——独立故障域）
      expect(await spool.peek('p-cap')).toHaveLength(0);        // confirm → 段回收 → depth 回落
      expect((spool as any).overCapacityFlag).toBe(false);      // confirm 自评解除（旧实现滞留 true → 红）
      expect(spool.onRecovered).toHaveBeenCalledTimes(1);       // 唤醒 seam（rearm 退避梯+受理面恢复）
    } finally { await kit.dispose(); }
  });

  it('E71（Y0b-2 T8）：store append 成功 → emit canvas.doc-saved {projectId}（消费面=video-work process 快照双层失效）', async () => {
    const kit = await startDualClientServer({}, 200);
    try {
      const doc = new Y.Doc();
      await kit.gateway.hooks.onLoadDocument({ document: doc, documentName: 'project:p-e71' } as any);
      doc.getMap('nodes').set('n1', new Y.Map());
      const emitSpy = gatewayFacade(kit.gateway).spyEventEmit();
      const wrote = await gatewayFacade(kit.gateway).storeDocumentUnlocked({ document: doc, documentName: 'project:p-e71' } as any, 'maintenance');
      expect(wrote).toBe(true);                                  // 前置：走 appended 成功支（emit 唯一位）
      expect(emitSpy).toHaveBeenCalledWith('canvas.doc-saved', { projectId: 'p-e71' });
    } finally { await kit.dispose(); }
  });

  it('M1：draining 白盒——受理门拒新连接（X9 DRAINING 档前置于租约门——draining 分型准确不误报 lease-not-ready）', async () => {
    const kit = await startDualClientServer({}, 200);
    try {
      kit.gateway.beginDraining();   // Y0a-3 T5：draining 布尔退役——beginDraining 置 collabState=draining（isShuttingDown 派生读点不变）
      expect(kit.gateway.isShuttingDown()).toBe(true);   // X9 受理门读点翻转
      await expect(kit.gateway.hooks.onAuthenticate({
        requestHeaders: new Headers({ cookie: 'flowweb.session_token=tok' }),   // Y0b-3 T2 cookie-only：token 只来自 cookie
        requestParameters: new URLSearchParams(`token=tok&csv=${CLIENT_PROTOCOL_VERSION}`),   // Y0b-3 T5 版本门：装置带当前协议版
        documentName: 'project:p-m1',
        connectionConfig: { readOnly: false, isAuthenticated: false },
      } as any)).rejects.toMatchObject({ reason: CollabAuthReason.DRAINING });   // draining 档先于租约门（瞬态：客户端继续重连）
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
      const kit = await startDualClientServer({ appendBatch: repo.appendBatch }, 10_000 /* 大 debounce：只走 retry 梯 */, spool);
      try {
        const doc = new Y.Doc();
        const name = 'project:p-retry';
        gatewayFacade(kit.gateway).seedPendingQueue('p-retry', [new Uint8Array([1])]);   // Y19：projectId 键控装置
        const r1 = await gatewayFacade(kit.gateway).storeDocumentUnlocked({ document: doc, documentName: name } as any, 'maintenance');
        expect(r1).toBe(false);
        // 第一次失败即入 spool（BOI）+排程——spool 键命中 ⇒ 本用例只验证"排程不耗尽"：
        // 手工把 rung 推到 5+（模拟多轮失败）再断言 schedulePersistRetry 仍重排
        const entry = gatewayFacade(kit.gateway).persistRetryEntry(name)!;
        expect(entry).toBeTruthy();
        // V17⑤：先作废既有 1s 档定时器再推 rung——不清则 schedulePersistRetry 因已有 timer 早退=恒真绿
        clearTimeout(entry.timer!); entry.timer = null;
        entry.rung = 7;
        gatewayFacade(kit.gateway).schedulePersistRetry(name);
        const entry2 = gatewayFacade(kit.gateway).persistRetryEntry(name)!;
        expect(entry2.timer).toBeTruthy();     // rung 7 仍重排（旧实现 :541 耗尽 return → timer null=红）
      } finally { await kit.dispose(); }
    } finally { await cleanup(); }
  });

  it('V22 afterStoreDocument=存活计数（yjs_store_hook_calls_total）；去抖窗新写入零误报（v1 判据已撤——真对账=Task 3 splice 点自检）', async () => {
    const kit = await startDualClientServer();
    try {
      const callsBefore = (await register.getSingleMetric('yjs_store_hook_calls_total')!.get()).values[0]?.value ?? 0;
      const g = gatewayFacade(kit.gateway);
      const doc = new Y.Doc();
      g.seedDocProject(doc, 'p-tail'); g.seedPendingQueue('p-tail', [new Uint8Array([1])]);
      await g.storeDocumentUnlocked({ document: doc, documentName: 'project:p-tail' } as any, 'maintenance');   // append ok→队列清空
      await kit.gateway.hooks.afterStoreDocument({ document: doc, documentName: 'project:p-tail' } as any);
      const callsAfter = (await register.getSingleMetric('yjs_store_hook_calls_total')!.get()).values[0]?.value ?? 0;
      expect(callsAfter - callsBefore).toBe(1);          // 存活计数（V17⑥：metric.get() 公开 API——hashMap 内部读取作废）
      const anomalyBefore = (await register.getSingleMetric('yjs_store_tail_anomaly_total')!.get()).values[0]?.value ?? 0;
      const q = g.pendingQueueRef('p-tail') as Uint8Array[];
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
        const g = gatewayFacade(kit.gateway);
        g.seedPendingQueue('pd1', [new Uint8Array([1]), new Uint8Array([2])]);
        g.seedPendingQueue('pd2', []);   // 空条目不计 projects（验证语义）
        const p = kit.gateway.computePending();
        expect(p).toMatchObject({ projects: 1, batches: 2, spoolFiles: 1, spoolBytes: 164 + 52 + 2 });   // T8 v1.7：段头 164+帧 52B 头+载荷 2
      } finally { await kit.dispose(); }
    } finally { await cleanup(); }
  });
});

// ══ C1'（T11 复核 round-2 Critical）boot 三元组播种接线：pgSeqFloors（含 generation）先于 replayAll ══
//  缺陷形态（真 PG 复现）：真空纪 doc（gen-2+snapshot(g2,rev0)）崩溃幸存段→boot scan 不播种
//  projectGeneration→replayAll 以 genOf=??1 插行→compact ② 代辖重放滤掉错代行=帧不可见+僵尸行永留。
// 本用例钉 gateway 接线（int 侧链路语义=walseq-seeding.int.spec C1' 两用例）。
describe('Y1c T11 复核 round-2：boot 三元组播种接线（generation+walSeq floor 先于 replayAll）', () => {
  it("C1' 接线：startCollabAfterLease 读 pgSeqFloors→setProjectGeneration+seedWalSeqFromPg→replayAll 回灌行落当代（红=不播种→行落 g1×compact ② 代辖滤除）+无段项目计数器自 PG 抬底", async () => {
    const { dir, cleanup } = await makeSpoolDir('y1c-c1p-');
    try {
      const spool = new CollabSpoolService(dir);
      spool.setOwner('test-owner');
      spool.setProjectGeneration('p-gen', 7);   // 运行中形态：帧属 g7（真空纪后当代）
      spool.seedWalSeqFromPg('p-gen', 3n);      // 运行中形态：计数器=pgSeq+1=4（帧 walSeq=4>已发布基线 3）
      await spool.append('p-gen', Y.encodeStateAsUpdate(new Y.Doc()));   // 崩溃幸存段帧（未 confirm）
      const appendBatch = vi.fn(async (_pid: string, rows: unknown[] = []) => ({ ok: true as const, rows: rows.length }));
      const kit = await startDualClientServer({
        appendBatch,
        pgSeqFloors: vi.fn(async () => [
          { projectId: 'p-gen', generation: 7, pgSeq: 3n },
          { projectId: 'p-floor', generation: 1, pgSeq: 9n },   // 无段项目：walSeq floor 单独生效（scan 面=1）
        ]),
      }, 200, spool);
      try {
        // ①generation 接线：回灌行落当代 g7（replayAll 的 genOf 读播种值——红=缺省 1 落错代）
        const replayRows = appendBatch.mock.calls.filter((c) => c[0] === 'p-gen').flatMap((c) => c[1] as { generation: number }[]);
        expect(replayRows.length, '幸存段帧经 boot replayAll 回灌').toBeGreaterThan(0);
        expect(replayRows.every((r) => r.generation === 7), 'boot 播种先于 replayAll——回灌行代辖=CanvasDoc.generation').toBe(true);
        // ②walSeq floor 接线：无段项目计数器自 PG 抬底（scan 面零段=1 → pgSeq=9 播种 10）
        expect(spool.peekNextWalSeq('p-floor')).toBe(10n);
        // ③generation map 接线：后续帧通道（append）落当代段
        expect(spool.currentGeneration('p-gen')).toBe(7);
      } finally { await kit.dispose(); }
    } finally { await cleanup(); }
  }, 15_000);
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
      spool.setOwner('test-owner');   // R3：早于 kit 的直接 append 需自设 owner（kit 装置只覆盖 start 之后的路径）
      await spool.append('p-i1', Y.encodeStateAsUpdate(new Y.Doc()));   // 预投帧：kit onModuleInit 的 scan+replayAll 读它（append 永败→3 次尝试≈400ms 后 failed=1，帧保留）
      const kit = await startDualClientServer({ appendBatch: vi.fn(async () => { throw new Error('pg down'); }) }, 200, spool);
      try {
        // 判定点：回灌失败项目必须经退避梯运行期自愈（R1 拒绝理由的自洽前提）——梯入口=onModuleInit 回灌后 rearmQueues()
        expect(gatewayFacade(kit.gateway).persistRetryEntry('project:p-i1')).toBeTruthy();   // 旧实现 undefined → 红
        expect(await spool.peek('p-i1')).toHaveLength(1);   // 对照组：帧保留（回灌失败不删帧）
      } finally { await kit.dispose(); }
    } finally { await cleanup(); }
  }, 15_000);

  it('审查 I-2 红相（retryingPersist 单布尔跨项目误罩）：A 项目梯在飞 → B 项目（独立 saveMutex）store 失败仍必须自排退避梯——旧实现共享布尔=被 A 误罩（B 批滞留无恢复路径）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a2-i2-');
    try {
      const spool = new CollabSpoolService(dir);
      const kit = await startDualClientServer({ appendBatch: failingRepo({ failAppend: 99 }).appendBatch }, 200, spool);   // Y1c T9：注入面=appendBatch
      try {
        const g = gatewayFacade(kit.gateway);
        // 双形态装置（红绿同源）：旧代码读布尔 retryingPersist=true → B 守卫被罩（红相条件）；
        // 新代码读 Set → add('project:p-i2-a') 等价语义（旧代码字段不存在，可选链无害）
        g.seedLegacyRetryingFlag();
        g.addRetryingPersistDoc('project:p-i2-a');
        g.seedPendingQueue('p-i2-b', [new Uint8Array([1])]);   // Y19：projectId 键控装置（B 独立批）
        const r = await g.storeDocumentUnlocked({ document: new Y.Doc(), documentName: 'project:p-i2-b' } as any, 'maintenance');
        expect(r).toBe(false);   // 契约 3：任何路径不 throw
        expect(await spool.peek('p-i2-b')).toHaveLength(1);   // 对照组：B 失败批已入 spool（fsync 落定，spool 腿独立可用）
        expect(g.persistRetryEntry('project:p-i2-b')).toBeTruthy();   // 判定点：旧实现被 A 的布尔误罩 → undefined → 红
      } finally { await kit.dispose(); }
    } finally { await cleanup(); }
  }, 15_000);

  it('审查 M-2：unregisterPendingCollector 后 pending gauge 读 0（collect 现算——collector 缺位=0，防 destroy 后闭包悬挂）', async () => {
    const kit = await startDualClientServer();
    try {
      const g = gatewayFacade(kit.gateway);
      g.seedPendingQueue('p-m2', [new Uint8Array([1])]);   // 前置：collector 在位且队列非空 → gauge 读 1
      const before = (await register.getSingleMetric('yjs_pending_projects')!.get()).values[0]?.value ?? 0;
      expect(before).toBe(1);
      unregisterPendingCollector();   // onApplicationShutdown 首行同源调用（本用例为文件末测试——不再注册无污染）
      const after = (await register.getSingleMetric('yjs_pending_projects')!.get()).values[0]?.value ?? 0;
      expect(after).toBe(0);
    } finally { await kit.dispose(); }
  });
});

// Y0a-4/N16（红相先行）：容量观测三件套前二——loaded docs/connections gauge。供数必须复用
// pendingCollector 的快照机制（同一 setter 注册/同一快照源，禁第二套机制）；collect 现算形态
// （X11/X17：collect 抛错=整个 /api/metrics 500，故 collect 体 catch 后 set(0)）。
describe('Y0a-4/N16 容量观测 gauge（yjs_loaded_documents/yjs_connection_count——pendingCollector 同源快照）', () => {
  it('两 gauge 注册且经 registerPendingCollector 快照采数（collect 现算）', async () => {
    registerPendingCollector(() => ({
      projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0, strandedFiles: 0, strandedBytes: 0,
      loadedDocs: 7, connections: 9,
    }));
    try {
      const loaded = await register.getSingleMetric('yjs_loaded_documents');
      const conns = await register.getSingleMetric('yjs_connection_count');
      expect(loaded).toBeTruthy();   // 旧实现未注册 → 红
      expect(conns).toBeTruthy();
      expect((await loaded!.get()).values[0]?.value).toBe(7);   // 采数走 pendingCollector 快照（同源判据）
      expect((await conns!.get()).values[0]?.value).toBe(9);
    } finally { unregisterPendingCollector(); }   // 自清理——后续用例零污染
  });
});

// Y0a-2 Task 7（plan Step 1——红相先行）：beforeUnloadDocument 清理钩子（X4 永不抛+Y3 顺序）+
// mergeUpdates 出 WS 消息路径（X10 入队只 push——软阈 setImmediate 提前 flush+Y7 硬阈异步 coalesce）+
// 卸载交接三形态（成功/失败/Y11 重连同数组身份）。
describe('Y0a-2 beforeUnloadDocument 清理+mergeUpdates 出 WS 路径', () => {
  it('卸载清理钩子：lastCompactAt/persistUnhealthy/persistRetry/pendingQueues 空条目残留随 doc 卸载清（真泄漏唯 lastCompactAt 的修点）', async () => {
    const kit = await startDualClientServer();
    try {
      const g = gatewayFacade(kit.gateway);
      g.backdateLastCompactAt('p-ul', 1);
      g.addPersistUnhealthy('project:p-ul');
      g.seedPersistRetry('project:p-ul', { rung: 2, timer: null });
      await kit.gateway.hooks.beforeUnloadDocument({ documentName: 'project:p-ul', document: new Y.Doc() } as any);
      expect(g.lastCompactAtHas('p-ul')).toBe(false);
      expect(g.persistUnhealthyHas('project:p-ul')).toBe(false);
      expect(g.persistRetryHas('project:p-ul')).toBe(false);   // ①cancelPersistRetry 先于③（Y3 顺序——残留梯随卸载清）
      g.seedPendingQueue('p-ul2', []);   // X17：空条目装置（非空条目留存语义由卸载交接失败用例覆盖）
      await kit.gateway.hooks.beforeUnloadDocument({ documentName: 'project:p-ul2', document: new Y.Doc() } as any);
      expect(g.pendingQueueHas('p-ul2')).toBe(false);   // X17：空条目回收（交接失败时 q2 非空自然保留）
    } finally { await kit.dispose(); }
  });

  it('I-1 僵尸 doc 空条目禁回收：doc 仍在库 documents Map（钩子后复检取消卸载形态）时空条目必须保留——重连复用 doc 不重跑 loadDocument=条目不重建，删则活编辑命中 !q 静默丢弃；doc 真卸载后 X17 照常回收', async () => {
    const kit = await startDualClientServer();
    const g = gatewayFacade(kit.gateway);
    const zombie = new Y.Doc();
    kit.gateway.server.hocuspocus.documents.set('project:p-zombie', zombie as any);   // doc 仍活=库复检取消卸载形态
    try {
      g.seedPendingQueue('p-zombie', []);   // 空条目装置（store 失败过→交接 splice 清空后的形态）
      await kit.gateway.hooks.beforeUnloadDocument({ documentName: 'project:p-zombie', document: zombie } as any);
      expect(g.pendingQueueHas('p-zombie')).toBe(true);   // 判定点：旧代码无前置删除=红（活编辑丢弃窗）
      kit.gateway.server.hocuspocus.documents.delete('project:p-zombie');   // doc 真卸载
      await kit.gateway.hooks.beforeUnloadDocument({ documentName: 'project:p-zombie', document: zombie } as any);
      expect(g.pendingQueueHas('p-zombie')).toBe(false);   // X17：doc 真消失才回收
    } finally {
      // 红相防御：断言失败不残留裸 doc 毒化 dispose（裸 Y.Doc 无 connections——closeConnections 炸=destroy 挂死）
      kit.gateway.server.hocuspocus.documents.delete('project:p-zombie');
      await kit.dispose();
    }
  });

  it('清理钩子永不抛：内部异常被吞（库对 beforeUnloadDocument 抛错=取消卸载→destroy 永不 resolve→8s race+内存泄漏）', async () => {
    const kit = await startDualClientServer();
    try {
      const g = gatewayFacade(kit.gateway);
      g.stubSpool({ hasFrames: () => { throw new Error('boom'); } });   // 内部依赖炸（整体替换）
      await expect(kit.gateway.hooks.beforeUnloadDocument({ documentName: 'project:p-x', document: new Y.Doc() } as any)).resolves.toBeUndefined();
    } finally { await kit.dispose(); }
  });

  it('入队只 push 不折叠：70 条全留队列+软阈触发 setImmediate 提前 flush（旧实现 :207 封顶合并后=1=红相）', async () => {
    // Y1c T10：applied-driven flusher 对多前缀多次 appendBatch（维护帧+连接 SS2 空帧各成前缀）——
    // 挂起阀改「释放后全放行」形态（T9 单 release 单批形态不再覆盖多前缀；Y13 dispose 干净语义保持）。
    const OK = { ok: true as const, rows: 1 };
    let released = false;
    const pending: Array<(v: typeof OK) => void> = [];
    const release = () => { released = true; for (const r of pending.splice(0)) r(OK); };   // Y13：可释放 deferred（append 挂起持 saveMutex→不释放则 dispose 挂死）
    const kit = await startDualClientServer({ appendBatch: vi.fn(() => new Promise((r) => { if (released) r(OK); else pending.push(r); })) }, 60_000);   // 大 debounce+append 挂起：只看入队形态
    try {
      const g = gatewayFacade(kit.gateway);
      const { provider, synced } = kit.connect('project:p-many');   // 真路径装载（pendingQueues 由 loadDocument 播种——Y19 禁裸插装置）
      await synced;
      // Y1c T9：入队面=维护写（connection 帧=actor 管线不入队列）——server-doc null-origin 逐条直注（同生产维护写形态）
      const sdoc = kit.gateway.server.hocuspocus.documents.get('project:p-many') as unknown as Y.Doc;
      for (let i = 0; i < 70; i++) sdoc.getMap('nodes').set(`k${i}`, new Y.Map([['x', i]]));
      await new Promise((r) => setTimeout(r, 300));
      const q = g.pendingQueueRef('p-many') as Uint8Array[];
      expect(q).toBeDefined();
      expect(q.length).toBeGreaterThan(60);      // 不折叠（监听面只 push——折叠归 store 取批点；软阈 flush 已尝试=append 挂起批留队，BOI copy-first）
      expect((kit.repo.appendBatch as MockRepo['appendBatch']).mock.calls.length).toBeGreaterThanOrEqual(1);   // 提前 flush 确已触发（防空转）
      release();                                  // 释放（已挂起+后续 appendBatch 全放行）——mutex 归还，dispose 干净
      await provider.destroy();
      kit.forget(provider);   // 自管 destroy 后移出 dispose 清理数组（双 destroy=已知 flaky 源，惯例同上）
    } finally { await kit.dispose(); }
  }, 15_000);

  it('M-4(a) 软阈闩锁去重：同 tick N 次跨阈恰 1 次排程 store（旧实现无 has 守卫=70 次 setImmediate=70 次重入排程——debounce 臂重复调度）', async () => {
    const kit = await startDualClientServer({}, 60_000);   // 大 debounce：排程全部归软阈闩锁（排除 debounce 竞争）
    const doc = new Y.Doc();
    try {
      const g = gatewayFacade(kit.gateway);
      kit.gateway.server.hocuspocus.documents.set('project:p-latch', doc as any);   // 闩锁档位查 documents Map——直调路径须自播（I-1 僵尸 doc 同款装置）
      await kit.gateway.hooks.onLoadDocument({ document: doc, documentName: 'project:p-latch' } as any);
      // 白盒 spy：只计排程数，不真落库（resolve 值原样 undefined——façade 恢复真实类型
      // Promise<boolean> 后需断言；any 时代 mockResolvedValue(undefined) 类型宽松不红的还原）
      const storeSpy = g.spyStoreSerialized().mockResolvedValue(undefined as unknown as boolean);
      for (let i = 0; i < 70; i++) doc.getMap('nodes').set(`k${i}`, new Y.Map([['x', i]]));   // 70 次跨阈（>64 严格大于——每条 update 同步触发 scheduleSoftFlush）
      expect(g.flushScheduledHas('p-latch')).toBe(true);   // 闩锁在位（N 次调用仅排 1 条 immediate）
      await new Promise((r) => setImmediate(r));   // 闩锁档位执行
      expect(storeSpy).toHaveBeenCalledTimes(1);   // 旧实现无去重=70 次=红
      expect(g.flushScheduledHas('p-latch')).toBe(false);   // 档位自清（下次跨阈可重臂——去重非禁用）
    } finally {
      kit.gateway.server.hocuspocus.documents.delete('project:p-latch');   // 裸 doc 无 connections——dispose 防毒（I-1 同款）
      await kit.dispose();
    }
  }, 15_000);

  it('卸载交接成功：队列批落 spool（append 成功→splice——新家落定后才离旧归属）+leaveInFlight（X2 落定点②）', async () => {
    const kit = await startDualClientServer({}, 60_000);   // 大 debounce：防 debounce store 先行清队列
    try {
      const g = gatewayFacade(kit.gateway);
      const { provider, synced } = kit.connect('project:p-handoff');
      await synced;
      const handoffDoc = seedMaintenance(kit.gateway, 'p-handoff', 'k1');   // Y1c T9：维护写播种（null-origin 服务端 doc——同步入队）
      await kit.gateway.hooks.beforeUnloadDocument({ documentName: 'project:p-handoff', document: provider.document } as any);
      expect(g.pendingQueueRef('p-handoff')).toHaveLength(0);   // 批新家=WAL/PG（splice 落定）；空条目保留（I-1：doc 仍在 documents Map——直调非真卸载，回收禁行）
      expect(await kit.spool.peek('p-handoff')).toHaveLength(0);  // Y1c T9：PG 行随通道落定→confirm 段回收（帧曾 fsync 落定——磁盘不留残段）
      expect(g.inFlightHas('p-handoff')).toBe(false);    // X2 落定点②：卸载交接 leave
      void handoffDoc;
    } finally { await kit.dispose(); }
  });

  it('M-4(b) 交接 I-2 anomaly 分支：append 挂起窗内锁内折并改写队列（批尾身份断）→跳过 splice+tail_anomaly 恰 1 计数（旧实现无条件 splice=折并产物被误删=丢更新）', async () => {
    const kit = await startDualClientServer({}, 60_000);   // 大 debounce：窗内唯一变更=注入的折并交织
    let release!: () => void;
    const appendSpy = vi.spyOn(kit.spool, 'appendBatch').mockImplementationOnce(() => new Promise<Array<{ frameId: string; walSeq: bigint }>>((r) => { release = () => r([{ frameId: 'seg:0', walSeq: 1n }]); }));   // 挂起窗：维护通道 WAL 批不落定（Once——250ms 有机维护 flush 的重复项走真实现，防 dispose 悬挂）
    try {
      const g = gatewayFacade(kit.gateway);
      const { provider, synced } = kit.connect('project:p-anomaly');
      await synced;
      seedMaintenance(kit.gateway, 'p-anomaly', 'k1');   // Y1c T9：维护写播种（同步入队——身份锚即取即得）
      const q = g.pendingQueueRef('p-anomaly') as Uint8Array[];
      const n = q.length; const tailRef = q[n - 1];
      const anomaly = register.getSingleMetric('yjs_store_tail_anomaly_total')!;
      const before = (await anomaly.get()).values[0]?.value ?? 0;
      const unloading = kit.gateway.hooks.beforeUnloadDocument({ documentName: 'project:p-anomaly', document: provider.document } as any);
      await pollUntil(() => release !== undefined, 2_000);   // append 挂起窗已开
      q.unshift(new Uint8Array([9, 9]));                     // 折并交织形态：前缀改写（生产=锁内取批/折并 splice 前缀——n-1 身份破坏）
      release();
      await unloading;
      expect(q).toHaveLength(n + 1);                         // 未 splice（旧实现无条件 splice(0,n)=折并产物被删=红）
      expect(q[n]).toBe(tailRef);                            // 交接批原样留队（CRDT 幂等重发）
      expect(((await anomaly.get()).values[0]?.value ?? 0) - before).toBe(1);   // tail_anomaly 恰 1 计数
    } finally { appendSpy.mockRestore(); await kit.dispose(); }
  });

  it('卸载交接失败：钩子 resolves 不 reject（X4）+队列仍在（BOI）+persistRetry 已排（Y3——①cancel 后③重排，entry.timer 真值）+Y18 计数递增', async () => {
    const kit = await startDualClientServer({}, 60_000);
    const appendSpy = vi.spyOn(kit.spool, 'appendBatch').mockRejectedValue(new Error('spool down'));   // 裁定 1：恒抛不触盘（Y1c T9：维护通道 WAL 批面）
    try {
      const g = gatewayFacade(kit.gateway);
      const { provider, synced } = kit.connect('project:p-unload-fail');
      await synced;
      const ufDoc = seedMaintenance(kit.gateway, 'p-unload-fail', 'k1');   // Y1c T9：维护写播种（同步入队）
      const failMetric = register.getSingleMetric('yjs_unload_handoff_failure_total')!;
      const before = (await failMetric.get()).values[0]?.value ?? 0;   // V17⑥：metric.get() 公开 API（v15 异步）
      await expect(kit.gateway.hooks.beforeUnloadDocument({ documentName: 'project:p-unload-fail', document: provider.document } as any)).resolves.toBeUndefined();
      expect(g.pendingQueueRef('p-unload-fail')).toHaveLength(1);   // 批留队列（唯一归属地仍在——k1 update 原样；T18 stamp 退役
      expect(g.persistRetryEntry('project:p-unload-fail')?.timer).toBeTruthy();   // 保活已排且在 ①cancel 之后（排程在 cancel 前=timer 被①清掉=红）
      expect(((await failMetric.get()).values[0]?.value ?? 0) - before).toBeGreaterThanOrEqual(1);   // Y18 指标接线
      appendSpy.mockRestore();
      await g.storeDocumentSerialized({ document: ufDoc, documentName: 'project:p-unload-fail' } as any, 'maintenance');   // Y1c T9：维护显式 flush 收尾（成功路径 cancel 保活梯）
      expect(g.pendingQueueRef('p-unload-fail')).toHaveLength(0);
    } finally { appendSpy.mockRestore(); await kit.dispose(); }
  });

  // ══ Y0c T16 I-2（测试漂移防线）：handoffPendingToSpool 生产面——reaper spec 全 mock（true/false
  //    两态）未钉队列副作用；以下三用例复刻上方卸载交接用例构造形态（真路径入队+生产方法直调） ══
  it('T16 强制淘汰交接成功（生产面 handoffPendingToSpool）：队列帧落 spool+队列 splice 清空', async () => {
    const kit = await startDualClientServer({}, 60_000);   // 大 debounce：防 debounce store 先行清队列
    try {
      const g = gatewayFacade(kit.gateway);
      const { provider, synced } = kit.connect('project:p-fevict');
      await synced;
      void provider;
      seedMaintenance(kit.gateway, 'p-fevict', 'k1');   // Y1c T9：维护写播种（同步入队）
      await expect(kit.gateway.handoffPendingToSpool('p-fevict')).resolves.toBe(true);
      expect(g.pendingQueueRef('p-fevict')).toHaveLength(0);   // 批新家=WAL/PG（splice 清空——fsync 落定后才离旧归属）
      expect(await kit.spool.peek('p-fevict')).toHaveLength(0);  // Y1c T9：PG 行随通道落定→confirm 段回收
    } finally { await kit.dispose(); }
  });

  it('T16 强制淘汰交接 drain 并发（I-2 织防御）：append 挂起窗内折并改写队列前缀⇒批尾身份断（tailRef!==queue[n-1]）⇒返 false（批留队列不丢）', async () => {
    const kit = await startDualClientServer({}, 60_000);   // 大 debounce：窗内唯一变更=注入的折并交织
    let release!: () => void;
    const appendSpy = vi.spyOn(kit.spool, 'appendBatch').mockImplementationOnce(() => new Promise<Array<{ frameId: string; walSeq: bigint }>>((r) => { release = () => r([{ frameId: 'seg:0', walSeq: 1n }]); }));   // 挂起窗：维护通道 WAL 批不落定（M-4(b) 同款——Once 防 250ms 有机 flush 重复项悬挂 dispose）
    try {
      const g = gatewayFacade(kit.gateway);
      const { provider, synced } = kit.connect('project:p-fevict-race');
      await synced;
      void provider;
      seedMaintenance(kit.gateway, 'p-fevict-race', 'k1');   // Y1c T9：维护写播种（同步入队）
      const q = g.pendingQueueRef('p-fevict-race') as Uint8Array[];
      const n = q.length; const tailRef = q[n - 1];
      const handing = kit.gateway.handoffPendingToSpool('p-fevict-race');
      await pollUntil(() => release !== undefined, 2_000);   // append 挂起窗已开
      q.unshift(new Uint8Array([9, 9]));                     // 折并交织形态（生产=锁内取批/折并 splice 前缀——n-1 身份破坏，长度判据不命中、纯尾身份分支）
      release();
      await expect(handing).resolves.toBe(false);            // 拒淘汰（批留队列重发，CRDT 幂等吸收）
      expect(q).toHaveLength(n + 1);                         // 未 splice（旧实现无条件 splice(0,n)=折并产物被删=红）
      expect(q[n]).toBe(tailRef);                            // 交接批尾原样留队
    } finally { appendSpy.mockRestore(); await kit.dispose(); }
  });

  it('T16 强制淘汰交接失败（生产面）：spool append 抛错⇒返 false+队列原样保留（批不丢——BOI 归属地不变）', async () => {
    const kit = await startDualClientServer({}, 60_000);
    const appendSpy = vi.spyOn(kit.spool, 'appendBatch').mockRejectedValue(new Error('spool down'));   // 恒抛不触盘（卸载交接失败用例同款——Y1c T9 appendBatch 面）
    try {
      const g = gatewayFacade(kit.gateway);
      const { provider, synced } = kit.connect('project:p-fevict-fail');
      await synced;
      void provider;
      seedMaintenance(kit.gateway, 'p-fevict-fail', 'k1');   // Y1c T9：维护写播种（同步入队）
      const before = g.pendingQueueRef('p-fevict-fail') as Uint8Array[];
      const refs = [...before];
      await expect(kit.gateway.handoffPendingToSpool('p-fevict-fail')).resolves.toBe(false);
      const after = g.pendingQueueRef('p-fevict-fail');
      expect(after).toBe(before);                            // 同一数组（未 splice）
      expect(after).toHaveLength(refs.length);               // 批原样（逐元素身份不断）
      appendSpy.mockRestore();
      const fd = kit.gateway.server.hocuspocus.documents.get('project:p-fevict-fail');
      await g.storeDocumentSerialized({ document: fd, documentName: 'project:p-fevict-fail' } as any, 'maintenance');   // Y1c T9：维护显式 flush 收尾
      expect(g.pendingQueueRef('p-fevict-fail')).toHaveLength(0);
    } finally { appendSpy.mockRestore(); await kit.dispose(); }
  });

  it('Y11 重连同数组身份：交接失败→重连 loadDocument get-or-create 撞同一条目（toBe 同引用+长度不减）→批经 store 落库一次', async () => {
    const kit = await startDualClientServer({}, 60_000);
    const appendSpy = vi.spyOn(kit.spool, 'appendBatch').mockRejectedValue(new Error('spool down'));   // Y1c T9：维护通道 WAL 批面
    try {
      const g = gatewayFacade(kit.gateway);
      const { provider, synced } = kit.connect('project:p-reconn');
      await synced;
      // Y1c T9：维护写播种（null-origin 服务端 doc——两条同步入队；provider 写=actor 管线不入维护队列）
      const reconnDoc = kit.gateway.server.hocuspocus.documents.get('project:p-reconn') as unknown as Y.Doc;
      reconnDoc.getMap('nodes').set('k1', 1);
      reconnDoc.getMap('nodes').set('k2', 2);
      const before = g.pendingQueueRef('p-reconn')!;
      const beforeLen = before.length;
      await kit.gateway.hooks.beforeUnloadDocument({ documentName: 'project:p-reconn', document: provider.document } as any);
      expect(g.pendingQueueRef('p-reconn')).toBe(before);        // 同一数组引用（V4 get-or-create：set 替换写法必红）
      expect(g.pendingQueueRef('p-reconn')).toHaveLength(beforeLen);   // 批留存
      g.cancelPersistRetry('project:p-reconn');                    // 梯定时器随断言即清（防 1s 档并发扰动——落库由下方直调承担）
      appendSpy.mockRestore();
      await kit.gateway.hooks.onLoadDocument({ document: new Y.Doc(), documentName: 'project:p-reconn' } as any);   // 重连装载（白盒——库 documents 缓存使真重连不重走 load）
      expect(g.pendingQueueRef('p-reconn')).toBe(before);        // get-or-create 撞已有条目=同身份（批未因重连蒸发）
      await g.storeDocumentSerialized({ document: reconnDoc, documentName: 'project:p-reconn' } as any, 'maintenance');
      expect(g.pendingQueueRef('p-reconn')).toHaveLength(0);     // 批落库
      expect((kit.repo.appendBatch as MockRepo['appendBatch']).mock.calls.length).toBe(1);   // 一次（无重复入队）
    } finally { appendSpy.mockRestore(); await kit.dispose(); }
  });

  it('Y7 硬阈 coalesce：真双败故障期（WAL+PG 双拒）600 条推入→队列收敛 ≤513（Y24 内存上界门）+yjs_pending_batches 不随 update 数线性增长', async () => {
    let passthrough = false;   // 释放后双腿直通（dispose drain 不挂死）
    const kit = await startDualClientServer({
      appendBatch: vi.fn(() => { if (passthrough) return Promise.resolve({ ok: true as const, rows: 1 }); return Promise.reject(new Error('pg down')); }),
    }, 60_000);
    const walSpy = vi.spyOn(kit.spool, 'appendBatch').mockImplementation(() => { if (passthrough) return Promise.resolve([{ frameId: 'seg:0', walSeq: 1n }]); return Promise.reject(new Error('wal down')); });   // Y1c T9：WAL 批面（旧 spool.append 面=通道内置）
    try {
      const { provider, synced } = kit.connect('project:p-coalesce');
      await synced;
      // 确定性装置：600 条经**服务端 doc 直注**——客户端推入经 WS 送达是异步的（实测 loop 完成时队列仅 stamp 1 条，
      // 软阈 flush 中途取批使水位随机、"600 条在队"不可观测）。直注使入队/软阈闩锁/硬阈折并同步落定，判据零竞态。
      const serverDoc = kit.gateway.server.hocuspocus.documents.get('project:p-coalesce')!;
      const src = new Y.Doc(); const ups: Uint8Array[] = [];
      src.on('update', (u) => ups.push(u));
      for (let i = 0; i < 600; i++) src.getMap('nodes').set(`k${i}`, new Y.Map([['x', i]]));
      for (const u of ups) Y.applyUpdate(serverDoc as unknown as Y.Doc, u);   // 600 push 同步入队（第 65 条闩锁 setImmediate）
      await pollUntil(() => { const b = kit.gateway.computePending().batches; return b > 0 && b <= 513; }, 5_000);   // 排除空队列空转绿（b>0）+线性增长红（≤512+1——折并 601→合并组）
      const gauge = (await yjsPendingBatches.get()).values[0]?.value ?? 0;
      expect(gauge).toBeLessThanOrEqual(513);   // gauge 与队列同源收敛（不随 update 数线性增长）
      walSpy.mockRestore(); passthrough = true;   // 双腿恢复——下轮 store 落定（合并元素 CRDT 幂等）
      await gatewayFacade(kit.gateway).storeDocumentUnlocked({ document: provider.document, documentName: 'project:p-coalesce' } as any, 'maintenance').catch(() => {});
      await pollUntil(() => kit.gateway.computePending().batches === 0, 5_000);   // 排空（dispose 干净）
      expect(kit.gateway.computePending().batches).toBe(0);
    } finally { walSpy.mockRestore(); await kit.dispose(); }
  }, 20_000);

  it('Y7 硬阈 coalesce 外审修复（Y0b-4 T3 第七处切批缺口）：600×8KB 累积折并后队列元素 ≤1MB（合并产物可再分）+身份恒定+内容不丢', async () => {
    // 旧实现 splice(0,len,mergeUpdates(queue)) 整批单 merge → ~4.9MB 单元素经 splitPersistChunks
    // "单 update 超限独立成组"不拆 → PG 行/spool 帧可超 1MB（Q-O"超限行结构性不可产生"破约——本测试红点）
    let release!: (v: { ok: true; seq: bigint }) => void;
    let passthrough = false;
    const kit = await startDualClientServer({
      appendBatch: vi.fn(() => new Promise<{ ok: true; seq: bigint }>((r) => { if (passthrough) r({ ok: true, seq: 1n }); else release = r; })),
    }, 60_000);
    const appendSpy = vi.spyOn(kit.spool, 'append').mockRejectedValue(new Error('spool down'));   // 双败注入=上方 Y7 同款（append 挂起窗内折并必经取批点）
    try {
      const g = gatewayFacade(kit.gateway);
      const { provider, synced } = kit.connect('project:p-coalesce2');
      await synced;
      const serverDoc = kit.gateway.server.hocuspocus.documents.get('project:p-coalesce2')!;
      // 600 条 ×~8.2KB（总量 ≈4.9MB：>1MB 可造超限单元素、<8MB 不触发字节阈——条数阈 601>512 唯一触发）
      const src = new Y.Doc(); const ups: Uint8Array[] = [];
      src.on('update', (u) => ups.push(u));
      for (let i = 0; i < 600; i++) src.getMap('nodes').set(`k${i}`, 'x'.repeat(8192));
      const qBefore = g.pendingQueueRef('p-coalesce2') as Uint8Array[];   // 同步取引用（setImmediate 折并前——身份锚）
      for (const u of ups) Y.applyUpdate(serverDoc as unknown as Y.Doc, u);   // 601 条 push 同步入队（stamp+600——同上方确定性直注装置）
      // Y1c T9：折并已发生 ∧ store 已达 await append（release 就位=PG 腿挂起窗确定性判据——防仅折并未触 sink 的竞态）
      await pollUntil(() => { const b = kit.gateway.computePending().batches; return b > 0 && b < 512 && typeof release === 'function'; }, 5_000);
      const q = g.pendingQueueRef('p-coalesce2') as Uint8Array[];
      expect(q).toBe(qBefore);                                        // 数组身份恒定不变量（splice 原地——set 替换整队列必红）
      for (const el of q) expect(el.byteLength).toBeLessThanOrEqual(1_048_576);   // 与实现 PERSIST_MERGE_MAX_BYTES 同值（quota-truth spec 先例）——旧实现单 merge 元素 ~4.9MB 红
      const revived = new Y.Doc();                                    // 内容不丢：落回的合并组可逐个 apply（合并产物可再分性）
      for (const el of q) Y.applyUpdate(revived, el);
      expect(revived.getMap('nodes').get('k599')).toBe('x'.repeat(8192));
      appendSpy.mockRestore();
      passthrough = true; if (release) release({ ok: true, seq: 1n });   // Y1c T9：passthrough 先置（多 chunk 逐个 deferred——后继调用直通，防 release 重定义悬挂窗）
      await g.storeDocumentUnlocked({ document: kit.gateway.server.hocuspocus.documents.get('project:p-coalesce2'), documentName: 'project:p-coalesce2' } as any, 'maintenance');   // 直调排空（dispose 干净）
      expect(kit.gateway.computePending().batches).toBe(0);
    } finally { appendSpy.mockRestore(); if (release) release({ ok: true, seq: 1n }); await kit.dispose(); }
  }, 20_000);
});

// Y0a-3 T5（plan Step 2）：租约三入口门+selfIsolate/启动链（G-3/G-3b mock 面）——
// kit 第 4 参=lease stub（V1 契约三件套：成功⇒repo/spool owner+await onAcquired——缺②则 scan throw=start-failed）。
describe('Y0a-3 租约三入口门+selfIsolate/启动链（G-3/G-3b mock 面）', () => {
  it('G-3：lease 未持有→authenticate 拒 LEASE_NOT_READY（瞬态档）+服务端不关 socket（J2 半边）', async () => {
    // V12 纯态门：门读 collabState——boot 期 lease 未持有=tryAcquireFast 失败⇒态停 acquiring（不 listen）⇒门拒
    const kit = await startDualClientServer({}, 300, undefined, createLeaseStub({ tryAcquireFast: vi.fn(async () => false) }));
    try {
      const conn = { socket: { close: vi.fn() } };
      await expect((kit.gateway as any).hooks.onAuthenticate({
        requestHeaders: new Headers({ cookie: 'flowweb.session_token=tok' }),   // Y0b-3 T2 cookie-only：token 只来自 cookie
        requestParameters: new URLSearchParams(`token=tok&csv=${CLIENT_PROTOCOL_VERSION}`),   // Y0b-3 T5 版本门：装置带当前协议版
        documentName: 'project:p1',
        connectionConfig: {},
        connection: conn as any,
      } as any)).rejects.toMatchObject({ reason: CollabAuthReason.LEASE_NOT_READY });
      expect(conn.socket.close).not.toHaveBeenCalled();   // 拒绝不关 socket——provider 自动重连消费瞬态档
    } finally { await kit.dispose(); }
  });

  it('G-3：lease 未持有→loadDocument 拒（P1：正确性门——与 spool 降级态的"永不 gate"分立）', async () => {
    // V12 纯态门：门读 collabState——boot 期 lease 未持有=tryAcquireFast 失败⇒态停 acquiring（不 listen）⇒门拒
    const kit = await startDualClientServer({}, 300, undefined, createLeaseStub({ tryAcquireFast: vi.fn(async () => false) }));
    try {
      await expect((kit.gateway as any).hooks.onLoadDocument({ document: new Y.Doc(), documentName: 'project:p1' } as any))
        .rejects.toMatchObject({ reason: CollabAuthReason.LEASE_NOT_READY });
      expect((kit.repo as any).hydrateWithRecovery).not.toHaveBeenCalled();   // 门在 DB 装载之前（不白打查询）
    } finally { await kit.dispose(); }
  });

  it('G-3：tryAcquireFast 失败→onModuleInit 返回但不 listen（detached acquireLoop 接管——W5 单点）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a3-g3-');
    try {
      const lease = createLeaseStub({ tryAcquireFast: vi.fn(async () => false) });
      const gateway = new CollabGateway({} as any, new EventEmitter2() as any, createMockRepo() as any,
        lease as any, { resolve: vi.fn() } as any, 48100, 300, undefined, undefined, new CollabSpoolService(dir));
      const listenSpy = gatewayFacade(gateway).spyListenServer().mockResolvedValue(undefined);
      try {
        await gateway.onModuleInit();
        expect(listenSpy).not.toHaveBeenCalled();   // 唯一 listen 单点（旧实现 onModuleInit 直 listen=红）
        expect(lease.acquireLoop).toHaveBeenCalledTimes(1);
        expect(gateway.getCollabState()).toBe('acquiring');
      } finally { listenSpy.mockRestore(); }
      await gateway.onApplicationShutdown();
    } finally { await cleanup(); }
  });

  it('启动链单点（W5）：stub 契约=成功⇒已 await onAcquired——onModuleInit 返回即 serving+已 listen', async () => {
    const kit = await startDualClientServer();   // 默认 stub（契约形态）
    try {
      expect(kit.gateway.getCollabState()).toBe('serving');   // await onModuleInit 后（kit 构造内）
      expect((kit.gateway as any).server.httpServer?.listening).toBe(true);
    } finally { await kit.dispose(); }
  });

  it('I3（V9）可红断言：scan 失败→start-failed+release（非端口类）；重试不跳过 scan——旧形态早置 initDone 会让第二次启动跳过 init 带半截索引上线', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a3-i3-');
    try {
      const lease = createLeaseStub();
      const spool = new CollabSpoolService(dir);
      const scanSpy = vi.spyOn(spool, 'scan')
        .mockRejectedValueOnce(new Error('scan boom'))
        .mockResolvedValue({ truncatedSegments: [] });
      const gateway = new CollabGateway({ systemHistory: { findUnique: vi.fn().mockResolvedValue({ historyId: 'i3-history' }) } } as any, new EventEmitter2() as any, createMockRepo() as any,
        lease as any, { resolve: vi.fn() } as any, 48100, 300, undefined, undefined, spool);   // Y1c T9（T8 接线）：listenCollab requireSystemHistory 读面 mock
      const facade = gatewayFacade(gateway);
      const listenSpy = facade.spyListenServer().mockResolvedValue(undefined);
      try {
        await facade.startCollabAfterLease();   // onAcquired 唯一入口直调（watchdog/5s 定时器同点）
        expect(gateway.getCollabState()).toBe('start-failed');
        expect(lease.release).toHaveBeenCalledTimes(1);   // 非端口类失败→释放（不占租约不服务）
        expect(scanSpy).toHaveBeenCalledTimes(1);
        await facade.startCollabAfterLease();   // 重获租约后的重入
        expect(scanSpy).toHaveBeenCalledTimes(2);         // 早置 initDone → 本行=1 次=红（init 被跳过）
        expect(facade.isInitDone()).toBe(true);     // 四步全成才置位（V9）
        expect(gateway.getCollabState()).toBe('serving');
      } finally { listenSpy.mockRestore(); }
      await gateway.onApplicationShutdown();
    } finally { await cleanup(); }
  });

  it('G-3b/必办①：append fenced→selfIsolate（closeAll1012+关 listener+lost{cause}）+批走 spool 不排梯', async () => {
    const kit = await startDualClientServer({ appendBatch: vi.fn(async () => ({ ok: false as const, reason: 'fenced' as const })) });
    try {
      const g = gatewayFacade(kit.gateway);
      const closeSpy = g.spyCloseAll1012().mockImplementation(() => {});   // 1012 面免真关（无连接面）
      g.seedPendingQueue('pf1', [new Uint8Array([1])]);
      await g.storeDocumentUnlocked({ document: new Y.Doc(), documentName: 'project:pf1' } as any, 'maintenance');
      expect(kit.gateway.getCollabState()).toBe('isolated');
      expect(closeSpy).toHaveBeenCalled();
      expect(await kit.spool.peek('pf1')).toHaveLength(1);                 // 批已落 spool（契约 15——fsync 落定）
      expect(g.persistRetryHas('project:pf1')).toBe(false);               // fenced=终态禁梯
    } finally { await kit.dispose(); }
  });

  it('必办⑧/I-3：isolated 后 schedulePersistRetry 不排（梯项目转 fenced 永续重排收口）', async () => {
    const kit = await startDualClientServer();
    try {
      const g = gatewayFacade(kit.gateway);
      g.forceCollabState('isolated');
      g.schedulePersistRetry('project:px');
      expect(g.persistRetryHas('project:px')).toBe(false);
    } finally { await kit.dispose(); }
  });

  it('必办⑨/M3：retryPersist 帧通道 FK 收割——已删项目帧 confirm+cancel 梯+discarded(source=spool) 计数', async () => {
    const kit = await startDualClientServer({ appendBatch: vi.fn(async () => { throw Object.assign(new Error('FK'), { code: 'P2003' }); }) });
    try {
      const g = gatewayFacade(kit.gateway);
      await kit.spool.append('pdel', new Uint8Array([1]));                 // 先落帧（append 注入只作用 repo 腿）
      g.seedPersistRetry('project:pdel', { rung: 0, timer: null });
      const discarded = register.getSingleMetric('yjs_updates_discarded_deleted_total')!;
      const before = (await discarded.get()).values.find((v) => v.labels?.source === 'spool')?.value ?? 0;
      const confirmSpy = vi.spyOn(kit.spool, 'confirm');
      await g.retryPersist('project:pdel');
      expect(confirmSpy).toHaveBeenCalledWith('pdel', [expect.any(String)]);   // 旧实现 FK 直接 throw 卡批=红
      expect(g.persistRetryHas('project:pdel')).toBe(false);
      expect(((await discarded.get()).values.find((v) => v.labels?.source === 'spool')?.value ?? 0) - before).toBe(1);
    } finally { await kit.dispose(); }
  });

  it('SV13/W11：leaseRowMissing→批落 spool（不早退）+不排梯+配置错误重试无用', async () => {
    const kit = await startDualClientServer({ appendBatch: vi.fn(async () => { throw Object.assign(new Error('row missing'), { leaseRowMissing: true }); }) });
    try {
      const g = gatewayFacade(kit.gateway);
      g.seedPendingQueue('prm1', [new Uint8Array([1])]);
      await g.storeDocumentUnlocked({ document: new Y.Doc(), documentName: 'project:prm1' } as any, 'maintenance');
      expect(await kit.spool.peek('prm1')).toHaveLength(1);                // 落 spool（早退=批只留内存重启即丢）
      expect(g.persistRetryHas('project:prm1')).toBe(false);              // 配置错误重试无用（旧实现排梯=红）
    } finally { await kit.dispose(); }
  });

  it('SV9/W10：beginDraining 冻结连接+60s 自动解除=1012 复连+响应体 {autoReleaseAt,pending}（fake timers 只罩 beginDraining 窗——kit 真定时器启动）', async () => {
    const kit = await startDualClientServer();
    try {
      const frozen = { readOnly: false, sendStateless: vi.fn(), webSocket: { close: vi.fn() } };
      (kit.gateway as any).server.hocuspocus.documents.set('project:pd1', {
        name: 'project:pd1', connections: new Map([[frozen as any, null]]),
        getConnections: () => [{ socketId: 'sv9-frozen' }],   // Y0a-4/N16：server 级 getConnectionsCount 遍历面（库 Document 形状补齐）
      });
      vi.useFakeTimers();
      const r = kit.gateway.beginDraining();
      expect(r.draining).toBe(true);
      expect(r.phase).toBe('draining');
      expect(r.pending).toMatchObject({ projects: expect.any(Number) });
      expect(frozen.readOnly).toBe(true);                    // 冻结（B12）
      // Y0b-4 T5：write-frozen stateless 退役——冻结通告并入 doc-status（writeFrozen:true+rev++）等价语义
      const drainNotices = frozen.sendStateless.mock.calls.map((c: any[]) => JSON.parse(c[0]))
        .filter((m: any) => m?.type === 'doc-status' && m?.writeFrozen === true);
      expect(drainNotices.length).toBeGreaterThanOrEqual(1);
      expect(drainNotices[0].rev).toBe(2);                   // 装载播种 1+冻结翻转自增
      expect(drainNotices[0].quota.state).toBe('ok');        // drain 冻结≠quota over
      expect(frozen.sendStateless.mock.calls.some((c: any[]) => JSON.parse(c[0])?.type === 'write-frozen')).toBe(false);   // 退役（census ⑧）
      await vi.advanceTimersByTimeAsync(60_000);
      expect(frozen.webSocket.close).toHaveBeenCalledWith(1012, 'drain released');   // 解除=1012 复连
      expect(kit.gateway.getCollabState()).toBe('serving');
    } finally {
      vi.useRealTimers();
      (kit.gateway.server.hocuspocus.documents as Map<string, unknown>).delete('project:pd1');   // 种子 doc 摘除（destroy 等 documents 清空）
      await kit.dispose();
    }
  });

  it('H-5：drain 解除先还原 readOnly 再 close（writeFreeze 原因集——解除只移 draining，spool 降级连接不被 drain 误赦免；close CLOSING no-op 边角下存活连接不再永久只读）', async () => {
    const kit = await startDualClientServer();
    try {
      // 两形态：普通连接（冻结前可写）；spool 熔断降级连接（connected 已登记 'spool' 原因——冻结前已只读）
      const normalConn = { readOnly: false, sendStateless: vi.fn(), webSocket: { close: vi.fn() } };
      const degradedConn = { readOnly: true, sendStateless: vi.fn(), webSocket: { close: vi.fn() } };
      gatewayFacade(kit.gateway).seedWriteFreeze(degradedConn, 'ph5', ['spool']);   // 真实 spool 降级连接的 writeFreeze 形态（connected 登记）
      (kit.gateway as any).server.hocuspocus.documents.set('project:ph5', {
        name: 'project:ph5', connections: new Map([[normalConn as any, null], [degradedConn as any, null]]),
        getConnections: () => [],
      });
      vi.useFakeTimers();
      kit.gateway.beginDraining();
      expect(normalConn.readOnly).toBe(true);    // 冻结生效（B12——writeFreeze 并入 'draining'）
      expect(degradedConn.readOnly).toBe(true);  // 已只读——冻结保持（{spool,draining}）
      await vi.advanceTimersByTimeAsync(60_000);
      expect(normalConn.readOnly).toBe(false);   // 解除=移除 'draining'（原因集空——改前恒 true=永久只读）
      expect(degradedConn.readOnly).toBe(true);  // 'spool' 原因保留——drain 不越权赦免（H-5 语义集合化继任）
      expect(normalConn.webSocket.close).toHaveBeenCalledWith(1012, 'drain released');
      expect(degradedConn.webSocket.close).toHaveBeenCalledWith(1012, 'drain released');
    } finally {
      vi.useRealTimers();
      (kit.gateway.server.hocuspocus.documents as Map<string, unknown>).delete('project:ph5');
      await kit.dispose();
    }
  });

  it('H-5×E13 嵌套：drain 冻结窗内复验 VIEWER 结论→writeFreeze 并入 viewer 原因——60s 解除只移 draining，viewer 保持（不打穿越权写窗；prev 快照跟随的集合化继任）', async () => {
    const kit = await startDualClientServer();
    try {
      const conn = { readOnly: false, sendStateless: vi.fn(), webSocket: { close: vi.fn() }, socketId: 'sock-h5e13', context: { token: 'tok' } };
      (kit.gateway as any).server.hocuspocus.documents.set('project:ph5e13', {
        name: 'project:ph5e13', connections: new Map([[conn as any, null]]),
        getConnections: () => [],
      });
      vi.useFakeTimers();
      kit.gateway.beginDraining();
      expect(conn.readOnly).toBe(true);                                                 // 冻结生效（B12）
      expect(gatewayFacade(kit.gateway).hasWriteFreezeReason(conn, 'draining')).toBe(true);   // 原因集={draining}
      // drain 窗口内 collab.perm.changed→即时 sweep→recheckConnection：DB 已翻 VIEWER（直调复验同路径）
      kit.permSvc.resolveWithTeam.mockResolvedValue({ role: 'PROJECT_VIEWER', teamId: 't1' });
      const re = await gatewayFacade(kit.gateway).recheckConnection(conn, 'project:ph5e13');
      expect(re).toMatchObject({ revoked: false });                                     // 降级不断连（E13 语义）
      expect(conn.readOnly).toBe(true);                                                 // 停写保持（冻结值——不因复验翻回）
      expect(gatewayFacade(kit.gateway).hasWriteFreezeReason(conn, 'viewer')).toBe(true);     // ★VIEWER 结论并入（改前红：无 viewer 原因）
      await vi.advanceTimersByTimeAsync(60_000);                                        // 60s 解除
      expect(conn.readOnly).toBe(true);                                                 // viewer 原因保持（改前红：还原 false=越权写窗）
      expect(conn.webSocket.close).toHaveBeenCalledWith(1012, 'drain released');
    } finally {
      vi.useRealTimers();
      (kit.gateway.server.hocuspocus.documents as Map<string, unknown>).delete('project:ph5e13');
      await kit.dispose();
    }
  });

  it('V12 判据唯一化：collabState=isolated ∧ lease 仍 held（fenced-by-write 窗口）⇒ 双入口全拒 LEASE_NOT_READY', async () => {
    const kit = await startDualClientServer({}, 300, undefined, createLeaseStub());   // isServing 恒 true（lease 视角仍 held——模拟心跳未到）
    try {
      const g = gatewayFacade(kit.gateway);
      g.selfIsolate('fenced-by-write');   // 写路径立即隔离——lease 侧要等 ≤1 心跳
      expect(kit.gateway.getCollabState()).toBe('isolated');
      await expect(kit.gateway.hooks.onAuthenticate({
        requestHeaders: new Headers({ cookie: 'flowweb.session_token=tok' }),   // Y0b-3 T2 cookie-only：token 只来自 cookie
        requestParameters: new URLSearchParams(`token=tok&csv=${CLIENT_PROTOCOL_VERSION}`),   // Y0b-3 T5 版本门：装置带当前协议版
        documentName: 'project:p1',
        connectionConfig: {},
      } as any)).rejects.toMatchObject({ reason: CollabAuthReason.LEASE_NOT_READY });   // 若门读 lease.isServing（true）=放行=判据分裂（本用例红）
      await expect(kit.gateway.hooks.onLoadDocument({ document: new Y.Doc(), documentName: 'project:p1' } as any))
        .rejects.toMatchObject({ reason: CollabAuthReason.LEASE_NOT_READY });
    } finally { await kit.dispose(); }
  });

  it('I4 rejoin 后 rearm：isolated→listenCollab 重入 ⇒ spool 残留 own 帧项目立即回到退避梯（部署门可收敛）', async () => {
    const kit = await startDualClientServer();
    try {
      const g = gatewayFacade(kit.gateway);
      (kit.spool as any).setOwner('owner-B');   // 残留段制造（前任视角）
      await kit.spool.append('porphan', new Uint8Array([1]));
      await kit.spool.scan();   // 重建 index 使 keys() 可见
      g.selfIsolate('fenced-by-write');
      g.forceCollabState('starting');   // 模拟 rejoin 的 startCollabAfterLease 重入路径
      await g.listenCollab();       // I4 执行点：listenCollab 末尾 rearmQueues
      expect(kit.gateway.getCollabState()).toBe('serving');
      expect(g.persistRetryHas('project:porphan')).toBe(true);   // 立即断言（1s 档即消费帧——3s 等待后断言恒假）
    } finally { gatewayFacade(kit.gateway).cancelPersistRetry('project:porphan'); await kit.dispose(); }
  });

  it('I4/Y10 seam：onRecovered 接线存在（v3 重排漏接的回归锚——spool IO 熔断恢复唤醒梯）', async () => {
    const kit = await startDualClientServer();
    try {
      expect(typeof (kit.spool as any).onRecovered).toBe('function');
    } finally { await kit.dispose(); }
  });

  // ═══ Y0c T17（Z129）：三释放出口改道 tryRelease——drain/隔离出口调用面+转发面 ═══
  describe('Y0c T17 Z129：三释放出口改道 tryRelease', () => {
    /** 裸直构 gateway（read-canvas-routing.spec makeGateway 同款——不 listen；releaser 未注册面天然就位；
     *  spool mock 补 depth=beginDraining 尾部 computePending 消费面） */
    function makeBareGateway(): CollabGateway {
      return new CollabGateway({} as any, new EventEmitter2() as any, {} as any, {} as any, { resolve: vi.fn() } as any,
        undefined, undefined, undefined, undefined,
        { hasFrames: () => false, depth: () => ({ ownFiles: 0, ownBytes: 0, strandedFiles: 0, strandedBytes: 0 }) } as any);
    }

    it('beginDraining ⇒ releaseAllResidentSessions("drain")（fire-and-forget——drain API 响应不被释放阻塞）', () => {
      const g = makeBareGateway();
      const spy = vi.spyOn(g, 'releaseAllResidentSessions').mockResolvedValue(undefined);
      g.beginDraining();
      expect(spy).toHaveBeenCalledWith('drain');
    });

    it('selfIsolate ⇒ 释放先行于 closeAllConnections1012（await 序——A2 :524 Σdirect===0 证明义务）+motive=self-isolate；I-2：释放 reject ⇒ closeAll1012 仍必达（try/finally 结构自证——不依赖转发面吞错推理链）', async () => {
      const g = makeBareGateway();
      const relSpy = vi.spyOn(g, 'releaseAllResidentSessions').mockResolvedValue(undefined);
      const closeSpy = gatewayFacade(g).spyCloseAll1012().mockImplementation(() => {});
      await gatewayFacade(g).selfIsolate('revoked');
      expect(relSpy).toHaveBeenCalledWith('self-isolate');
      expect(closeSpy).toHaveBeenCalledTimes(1);
      expect(relSpy.mock.invocationCallOrder[0]).toBeLessThan(closeSpy.mock.invocationCallOrder[0]);   // 先释放后关（顺序即证明义务）

      // I-2 臂（质量评审）：释放 reject ⇒ closeAll1012 仍执行（finally）且异常不吞（上抛语义不变）
      const g2 = makeBareGateway();
      vi.spyOn(g2, 'releaseAllResidentSessions').mockRejectedValue(new Error('release exploded'));
      const closeSpy2 = gatewayFacade(g2).spyCloseAll1012().mockImplementation(() => {});
      await expect(gatewayFacade(g2).selfIsolate('revoked')).rejects.toThrow('release exploded');
      expect(closeSpy2).toHaveBeenCalledTimes(1);                             // 修复前=0（无 finally）即红
    });

    it('tryReleaseResidentSession：releaser 未注册（直构无 residency）⇒no-op 不抛；注册后转发单 pid+motive（vacuum quiesce 消费形态）', async () => {
      const g = makeBareGateway();
      await expect(g.tryReleaseResidentSession('p1', 'vacuum')).resolves.toBeUndefined();   // 未注册=no-op
      const fn = vi.fn(async () => 'released');
      g.registerResidentSessionReleaser(fn);
      await g.tryReleaseResidentSession('p1', 'vacuum');
      expect(fn).toHaveBeenCalledWith('p1', 'vacuum');
    });
  });

  it('V11 终审收口：关停期 listen 迟到完成不转 serving（draining ⇒ ready≠true 契约——starting 态 listen 窗撞 SIGTERM 的竞态）', async () => {
    const kit = await startDualClientServer();
    try {
      const gw = gatewayFacade(kit.gateway);
      gw.transitionState('draining', 'test-shutdown');
      gw.forceShuttingDown();                        // 模拟 onApplicationShutdown 步骤 1 已置关停闸
      gw.stubTransition((next: string, cause?: string) => {   // 复检失败时原实现会调 transition('serving')——捕获即红
        throw new Error(`关停期非法迁移 → ${next}（${cause ?? ''}）——listenCollab 不得在 shuttingDown 后转 serving`);
      });
      const listenSpy = gw.spyListenServer().mockImplementation(async () => {});
      await gw.listenCollab();                       // listen"完成"（mock）——复检应在 transition 前拦下
      listenSpy.mockRestore();
      expect(kit.gateway.getCollabState()).toBe('draining');  // 仍是 draining（未翻 serving）
    } finally { await kit.dispose(); }
  });

  it('I4/reconciler 收养回收闭环：静默外来段（含坏尾）收养→隔离→回灌→confirm→整段 unlink（契约注记②——adopt 重建 meta 的 quarantinedRange=null ∧ goodBytes<bytes ⇒ tailSettled 恒 false=段永不回收）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a3-rec-');
    try {
      const spoolA = new CollabSpoolService(dir);
      spoolA.setOwner('owner-A');
      await spoolA.append('prc', Y.encodeStateAsUpdate(new Y.Doc()));
      const segPath = join(dir, 'owner-A', 'prc.g1.0.spool');   // T8 v1.7：g 域文件名
      await appendFile(segPath, Buffer.alloc(7, 0xAB));   // 1-7B 残尾=truncated（parseSegmentFrames 收口2 同判）
      const past = new Date(Date.now() - 120_000);
      await utimes(segPath, past, past);                  // 静默窗（≥60s 无写入=前任已死）
      const kit = await startDualClientServer({}, 300, spoolA);
      try {
        await gatewayFacade(kit.gateway).reconcileSpool();
        expect(kit.spool.depth()).toMatchObject({ strandedFiles: 0, ownFiles: 0 });   // 收养+回灌+回收闭环（缺 quarantine 步=段永不 unlink=红）
        await expect(stat(segPath)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(stat(`${segPath}.quarantine`)).rejects.toMatchObject({ code: 'ENOENT' });   // sidecar 随段回收
        expect(kit.repo.appendBatch).toHaveBeenCalledWith('prc', expect.anything(), expect.objectContaining({ expectedPgSeq: null }));   // 好帧已回灌 PG（Y1c T10：回灌带水位 catch-up——expectedPgSeq=null 单调追赶形态）
      } finally { await kit.dispose(); }
    } finally { await cleanup(); }
  });
});
