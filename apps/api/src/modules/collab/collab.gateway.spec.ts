import { EventEmitter2 } from '@nestjs/event-emitter';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { COMPACT_THRESHOLD, CollabGateway } from './collab.gateway';
import { CollabDocumentService } from './collab-document.service';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';


function buildDocState(): Buffer {
  const doc = new Y.Doc();
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
  const providers: HocuspocusProvider[] = [];

  beforeEach(async () => {
    permSvc = { resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR') };
    prisma = {
      session: {
        findUnique: vi.fn().mockResolvedValue({ user: { id: 'u1', name: '张三' }, expiresAt: new Date(Date.now() + 86400000) }),
      },
      canvasProject: {
        findUnique: vi.fn().mockResolvedValue({ teamId: 't1' }),
      },
      teamMember: {
        findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER', userId: 'u1' }),
      },
      canvasDoc: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
      },
    };
    durableRows = [];
    repo = {
      append: vi.fn(async (_pid: string, u: Uint8Array) => { durableRows.push(new Uint8Array(u)); }),   // 台账：once 队列（mockRejectedValueOnce/mockImplementationOnce）优先于基础实现，失败调用不进台账（探针实证 mock.results 过滤不可用——rejected promise 是同步 return，results.type 恒 'return'）
      loadUpdates: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      compact: vi.fn().mockResolvedValue(null),
    };


    emitter = new EventEmitter2();
    const port = 20000 + Math.floor(Math.random() * 20000);
    gateway = new CollabGateway(prisma as any, emitter as any, repo, { syncFromPeers: vi.fn(async () => {}) } as any, permSvc as any, port, 300);
    await gateway.onModuleInit();
    url = `ws://127.0.0.1:${port}`;
    service = new CollabDocumentService(gateway);
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
    /** 持久化等价断言（唯一入口）：前置——pending 必须已 drain（否则"等价"无意义）；重放成功行 ≡ 内存 doc（canonical + 语义双判据） */
    const expectDurableEquivalent = (doc: Y.Doc) => {
      const pending = (gateway as any).pendingUpdates.get(doc) as Uint8Array[] | undefined;
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
    prisma.canvasDoc.findUnique.mockResolvedValue({ projectId: 'p1', state: buildDocState() });
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
      prisma.canvasDoc.findUnique.mockResolvedValue({ state: Buffer.from(Y.encodeStateAsUpdate(snapDoc)) });
      const incDoc = new Y.Doc(); incDoc.getMap('nodes').set('b', 2);
      repo.loadUpdates.mockResolvedValue([Buffer.from(Y.encodeStateAsUpdate(incDoc))]);
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      expect(doc.getMap('nodes').get('a')).toBe(1);
      expect(doc.getMap('nodes').get('b')).toBe(2);
    });

    it('onDisconnect：最后连接断开触发 flush-then-compact', async () => {
      const { onLoadDocument, onDisconnect } = extractHooks();
      const doc: any = new Y.Doc();
      doc.getConnectionsCount = () => 0;
      await onLoadDocument({ document: doc, documentName: 'project:p1' });   // 同实例建立队列
      doc.getMap('nodes').set('x', 1);
      await onDisconnect({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(1);
      expect(repo.compact).toHaveBeenCalledTimes(1);
      expect((repo.append as any).mock.invocationCallOrder[0]).toBeLessThan((repo.compact as any).mock.invocationCallOrder[0]);
    });

    it('onDisconnect：非最后连接早退——不 flush 不 compact', async () => {
      const { onLoadDocument, onDisconnect } = extractHooks();
      const doc: any = new Y.Doc();
      doc.getConnectionsCount = () => 1;
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
      const doc: any = new Y.Doc();
      doc.getConnectionsCount = () => 0;
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
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
      const doc: any = new Y.Doc();
      doc.getConnectionsCount = () => 0;
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
      const doc: any = new Y.Doc();
      doc.getConnectionsCount = () => 0;
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
      repo.loadUpdates.mockImplementationOnce(() => new Promise<Buffer[]>((resolve) => { release = () => resolve([]); }));
      const doc = new Y.Doc();
      const loading = onLoadDocument({ document: doc, documentName: 'project:p1' });
      await new Promise((r) => setImmediate(r));          // 让 loadDocument 跑到 await loadUpdates
      doc.getMap('nodes').set('win1', new Y.Map());       // 加载窗口内写入（模板导入/AI 影子节点场景）
      release();
      await loading;
      const pending = (gateway as any).pendingUpdates.get(doc) as Uint8Array[];
      expect(pending).toHaveLength(1);                    // 红：现状无监听器概念，pending undefined
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(1);
      expect(replayOf(appendedRows()).getMap('nodes').has('win1')).toBe(true);
    });

    it('绿1：无变更连续 store 3 次——全部不 append（noop）', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).not.toHaveBeenCalled();
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
      prisma.canvasDoc.findUnique.mockResolvedValue({ state: Buffer.from(Y.encodeStateAsUpdate(snapDoc)) });
      repo.loadUpdates.mockResolvedValue([Buffer.from(Y.encodeStateAsUpdate((() => { const d = new Y.Doc(); d.getMap('nodes').set('b', 2); return d; })()))]);
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      expect(doc.getMap('nodes').get('a')).toBe(1);
      expect(doc.getMap('nodes').get('b')).toBe(2);
      expect((gateway as any).pendingUpdates.get(doc)).toHaveLength(0);   // 重放被抑制，不污染队列
    });

    it('绿2：append 失败抛错回灌——再 store 重试成功，无部分批', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', new Y.Map());
      doc.getMap('nodes').set('n2', new Y.Map());
      repo.append.mockRejectedValueOnce(new Error('db down'));
      await expect(onStoreDocument({ document: doc, documentName: 'project:p1' })).rejects.toThrow('db down');
      expect((gateway as any).pendingUpdates.get(doc)).toHaveLength(1);   // 队列保留——回灌的是合并单行 payload（batch.length===2 但 unshift(payload) 单元素）
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(2);   // 重试成功（第一次失败 + 第二次成功）
      expect((gateway as any).pendingUpdates.get(doc)).toHaveLength(0);
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
      expect(repo.append).toHaveBeenCalledTimes(1);   // mergeUpdates 单行（否决逐行：302 行会击穿 COMPACT_THRESHOLD）
      expect(appendedRows()[0].length).toBeLessThan(20000);   // 合并后远小于逐行总和（~6KB 量级）
      expect(repo.compact).not.toHaveBeenCalled();   // count(0) < 32
    });

    it('绿5：COMPACT_THRESHOLD 分支——count 达阈值时 compact 在 append 后被调', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', 1);
      repo.count.mockResolvedValue(COMPACT_THRESHOLD);
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.compact).toHaveBeenCalledTimes(1);
      expect((repo.append as any).mock.invocationCallOrder[0]).toBeLessThan((repo.compact as any).mock.invocationCallOrder[0]);
    });

    it('绿5b：disconnect 的 wrote 契约——没写就不 compact，写了才 compact', async () => {
      const { onLoadDocument, onDisconnect } = extractHooks();
      const docA: any = new Y.Doc(); docA.getConnectionsCount = () => 0;
      await onLoadDocument({ document: docA, documentName: 'project:p1' });
      await onDisconnect({ document: docA, documentName: 'project:p1' });   // 队列空 → wrote=false
      expect(repo.compact).not.toHaveBeenCalled();
      const docB: any = new Y.Doc(); docB.getConnectionsCount = () => 0;
      await onLoadDocument({ document: docB, documentName: 'project:p2' });
      docB.getMap('nodes').set('x', 1);
      await onDisconnect({ document: docB, documentName: 'project:p2' });
      expect(repo.compact).toHaveBeenCalledTimes(1);   // wrote=true → compact
    });

    it('绿6：disconnect 不抛——compact reject 时 onDisconnect 必须 resolve（进程守门）', async () => {
      const { onLoadDocument, onDisconnect } = extractHooks();
      const doc: any = new Y.Doc(); doc.getConnectionsCount = () => 0;
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('x', 1);
      repo.compact.mockRejectedValueOnce(new Error('lock timeout'));
      await expect(onDisconnect({ document: doc, documentName: 'project:p1' })).resolves.toBeUndefined();
      expect(repo.append).toHaveBeenCalledTimes(1);   // 行已落库
    });

    it('绿6b：flush 失败吞错契约——append reject 时 onDisconnect 仍 resolve（stash 兜底不抛）', async () => {
      const { onLoadDocument, onDisconnect } = extractHooks();
      const doc: any = new Y.Doc(); doc.getConnectionsCount = () => 0;
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('x', 1);
      repo.append.mockRejectedValueOnce(new Error('db down'));
      // 吞错契约显式断言（进程守门）：onDisconnect 是 onClose 的不-await 回调，抛错 = unhandled rejection = 进程退出
      await expect(onDisconnect({ document: doc, documentName: 'project:p1' })).resolves.toBeUndefined();
      expect((gateway as any).unflushed.get('p1')).toBeTruthy();   // 兜底生效：pending 已转移 stash
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
        (gateway as any).pendingUpdates.delete(doc);
        doc.getMap('nodes').set('y', 1);
        expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('untracked'));
      } finally {
        errSpy.mockRestore();
      }
    });

    it('绿8：unflushed 兜底全链——flush 失败 → stash → 新实例 load（不编辑）→ store 落库 → 再 store 不 append', async () => {
      const { onLoadDocument, onStoreDocument, onDisconnect } = extractHooks();
      const docA: any = new Y.Doc(); docA.getConnectionsCount = () => 0;
      await onLoadDocument({ document: docA, documentName: 'project:p1' });
      docA.getMap('nodes').set('n1', new Y.Map());
      docA.getMap('nodes').set('n2', new Y.Map());
      await onStoreDocument({ document: docA, documentName: 'project:p1' });   // append#1 插入落库
      const insertRow = appendedRows()[0];   // 显式捕获插入行（避免对 append 调用序的隐式依赖）
      docA.getMap('nodes').delete('n2');
      repo.append.mockRejectedValueOnce(new Error('db down'));
      await onDisconnect({ document: docA, documentName: 'project:p1' });      // flush 失败 → stash（吞错）
      expect((gateway as any).unflushed.get('p1')).toBeTruthy();
      repo.loadUpdates.mockResolvedValue([insertRow]);   // 新实例从"DB"重放插入行
      const docB = new Y.Doc();
      await onLoadDocument({ document: docB, documentName: 'project:p1' });
      expect((gateway as any).pendingUpdates.get(docB)).toHaveLength(1);   // stash 窗口外回灌进 pending（不编辑）
      expect((gateway as any).unflushed.has('p1')).toBe(false);
      await onStoreDocument({ document: docB, documentName: 'project:p1' });   // stash 落库
      expect(repo.append).toHaveBeenCalledTimes(3);   // #1 成功 + #2 失败 + #3 stash 落库
      const all = appendedRows();
      expect(replayOf([all[0]]).getMap('nodes').has('n2')).toBe(true);    // 插入行真实含 n2
      expect(replayOf(all).getMap('nodes').has('n2')).toBe(false);        // stash（删除）生效
      await onStoreDocument({ document: docB, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(3);   // 再 store 不 append（无重复入队）
    });

    it('绿8b：stash 提前 drain——disconnect 失败产生 stash 后，同 doc（不重载）下次 store 即落 stash', async () => {
      const { onLoadDocument, onStoreDocument, onDisconnect } = extractHooks();
      const doc: any = new Y.Doc(); doc.getConnectionsCount = () => 0;
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', new Y.Map());
      await onStoreDocument({ document: doc, documentName: 'project:p1' });   // #1 插入成功
      doc.getMap('nodes').delete('n1');
      repo.append.mockRejectedValueOnce(new Error('db down'));
      await onDisconnect({ document: doc, documentName: 'project:p1' });      // flush 失败 → stash
      expect((gateway as any).unflushed.get('p1')).toBeTruthy();
      const wrote = await onStoreDocument({ document: doc, documentName: 'project:p1' });   // 提前 drain 随本批落库
      expect(wrote).toBe(true);
      expect((gateway as any).unflushed.has('p1')).toBe(false);
      const all = appendedRows();
      expect(replayOf([all[0]]).getMap('nodes').has('n1')).toBe(true);
      expect(replayOf(all).getMap('nodes').has('n1')).toBe(false);   // 删除随 stash 落库
    });

    it('绿8c：stash-已在-DB 引理——stash 与 DB 同源（同 clientID）→ load 回灌 0 事件 → store 不 append', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const snapDoc = new Y.Doc(); snapDoc.getMap('nodes').set('a', 1);
      prisma.canvasDoc.findUnique.mockResolvedValue({ state: Buffer.from(Y.encodeStateAsUpdate(snapDoc)) });
      (gateway as any).unflushed.set('p1', Y.encodeStateAsUpdate(snapDoc));   // 与快照同源：apply 0 事件
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      expect((gateway as any).unflushed.has('p1')).toBe(false);
      expect((gateway as any).pendingUpdates.get(doc)).toHaveLength(0);
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).not.toHaveBeenCalled();
    });

    it('绿9：队列身份恒定——计数封顶原地合并（禁 set 替换数组）', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      const firstRef = (gateway as any).pendingUpdates.get(doc);
      for (let i = 0; i < 70; i++) doc.getMap('nodes').set(`k${i}`, { v: i });   // >64 触发原地折叠（第 65 条时折为 1，继续 push）
      expect((gateway as any).pendingUpdates.get(doc)).toBe(firstRef);   // toBe 同一对象（set 替换写法必红）
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(1);   // 折叠 + drain 合并 = 单行
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(1);   // 无积压重复（drain 后队列净空；身份违例形态由上方 toBe 钉死——突变实证：set 替换下本断言仍绿，勿靠它守身份）
      expectDurableEquivalent(doc);
    });

    it('绿9b：失败+交错回归——await 窗口注入更新触发封顶后 reject，失败批仍在活队列', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', new Y.Map());
      let rejectAppend!: (e: Error) => void;
      repo.append.mockImplementationOnce(() => new Promise((_res, rej) => { rejectAppend = rej; }));
      const storePromise = onStoreDocument({ document: doc, documentName: 'project:p1' });
      await new Promise((r) => setImmediate(r));   // 跑到 await append
      for (let i = 0; i < 70; i++) doc.getMap('nodes').set(`k${i}`, { v: i });   // 窗口内注入 >64 条 → 原地折叠
      rejectAppend(new Error('db down'));
      await expect(storePromise).rejects.toThrow('db down');
      const queue = (gateway as any).pendingUpdates.get(doc);
      expect(queue.length).toBeGreaterThan(0);   // 失败批经 WeakMap 读出仍在（孤儿数组形态 = 队列空/丢失）
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(2);   // 失败 1 + 重试成功 1
      expect((gateway as any).pendingUpdates.get(doc)).toHaveLength(0);
      expectDurableEquivalent(doc);
    });

    it('绿10：compact 失败降级——append 成功 + compact reject → 不抛、行已落库、WARN、不 stash', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const warnSpy = vi.spyOn((gateway as any).logger, 'warn').mockImplementation(() => {});
      try {
        const doc = new Y.Doc();
        await onLoadDocument({ document: doc, documentName: 'project:p1' });
        doc.getMap('nodes').set('n1', 1);
        repo.count.mockResolvedValue(32);
        repo.compact.mockRejectedValueOnce(new Error('lock timeout'));
        const wrote = await onStoreDocument({ document: doc, documentName: 'project:p1' });
        expect(wrote).toBe(true);
        expect(repo.append).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('compact failed'));
        expect((gateway as any).unflushed.has('p1')).toBe(false);
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
