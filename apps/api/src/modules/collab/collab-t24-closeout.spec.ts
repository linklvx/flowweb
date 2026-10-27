// apps/api/src/modules/collab/collab-t24-closeout.spec.ts
// Y1c T24 双评审收口批红测（Controller 裁定 C-1/C-2/I-1/I-2/I-5/M-1——红先行，断言差/挂起形态差非崩溃）。
// 各用例红相（修前）：
//  - C-1：既有边键改写（子 map 事件）→ validateAppliedL2 在 applyGate try/catch 外抛「compute changes
//    after event-handler」→ unhandled rejection+submit promise 永不 settle=挂起形态红（HUNG 哨兵）。
//  - C-2：两帧各 100KB 合法续写（每帧单 ContentString ≤128KiB、L1 各过）→ 第二帧 L2 按**整树累计**
//    字节判违规=毒帧循环红；修后=事件增量面（帧新增串）判定放行。
//  - I-1：DR 装载序（hydrate→replay）后 actor docIndex 仍缺装载前节点（rebuild 挂在重放前对空 doc
//    执行+重放经 withReplaySuppressed 零 effects）→ 直调 seam 假绿根治：走真 DR 装载序断言。
//  - I-2：①DS-only 帧（0 structs）毒帧违规零计数→第 4 帧仍放行；②同连接轮换 clientID（每毒帧新
//    clientID=新绑定新计数）→计数永不清零累计不达限→第 4 帧放行。修=计数键改 conn 身份+DS-only 同计。
//  - I-5：graph_anomaly_total 仅 dangling-edge/duplicate-edge 两 kind 计数——dangling-parent/
//    parent-cycle/cross-group-parent 三 kind 恒 0 红；修=读模型屏蔽面（maskGraphAnomalies 同一纯函数）。
//  - M-1：版本门三元 schemaVersion 腿自环（client 直填服务端常量=恒真）——无 sv/错 sv 的 fake bundle
//    放行红；修=sv 上行承载（缺失=不匹配 4406，与旧 bundle DENY 意图一致）。
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CollabGateway } from './collab.gateway';
import { CollabProjectActorService } from './collab-project-actor.service';
import { CollabSpoolService } from './collab-spool.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createLeaseStub } from './test-utils/lease-stub';
import { gatewayFacade } from './test-utils/collab-gateway-test-facade';
import { register } from 'prom-client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { CANVAS_DOC_SCHEMA_VERSION, CLIENT_PROTOCOL_VERSION } from '@flowweb/shared';
import type { Logger } from '@nestjs/common';

let spoolDir: { dir: string; cleanup: () => Promise<void> };
beforeEach(async () => { spoolDir = await makeSpoolDir('t24-co-'); });
afterEach(async () => { await spoolDir.cleanup(); });

// ═══ actor 级装置（deny-matrix spec 同族）═══

function makeConn(userId = 'u1', socketId?: string) {
  return {
    socketId: socketId ?? 'sock-' + Math.random().toString(36).slice(2, 8),
    readOnly: false,
    sendStateless: (): void => {},
    context: { user: { id: userId } },
  } as never;
}

function buildActor(doc: Y.Doc, pid = 'p1') {
  const spool = new CollabSpoolService(spoolDir.dir);
  spool.setOwner('t24co-owner');
  spool.setWalHistory('t24co-history');
  const repo = createMockRepo();
  const documents = new Map<string, Y.Doc>([[`project:${pid}`, doc]]);
  const hardCloseCalls: Array<{ code: number; reason: string }> = [];
  const actor = new CollabProjectActorService(spool as never, repo as never);
  (actor as unknown as { bindHost(h: unknown): void }).bindHost({
    logger: { log: (): void => {}, warn: (): void => {}, error: (): void => {}, debug: (): void => {}, verbose: (): void => {}, fatal: (): void => {}, localInstance: true } as unknown as Logger,
    documents: () => documents,
    hardClose: (conn: unknown, code: number, reason: string) => { hardCloseCalls.push({ code, reason }); },
    isQuotaFrozen: () => false,
    generationOf: () => 0,
    noteReadOnlyDrop: () => false,
    onFencedByWrite: async () => {},
  });
  return { actor, hardCloseCalls };
}

class Client {
  readonly doc = new Y.Doc();
  constructor(seed?: Y.Doc) { if (seed) Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(seed)); }
  frame(mutation: (d: Y.Doc) => void): Uint8Array {
    const captured: Uint8Array[] = [];
    const h = (u: Uint8Array): void => { captured.push(u); };
    this.doc.on('update', h);
    try { mutation(this.doc); } finally { this.doc.off('update', h); }
    if (captured.length === 0) throw new Error('零 update');
    return captured.reduce((acc, u) => Y.mergeUpdates([acc, u]));
  }
}

/** 合法基线：textInput（content=XmlFragment{paragraph>XmlText('seed')}+prompt map）+边 e1(n1→n2)。 */
function seedDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const mk = (id: string): void => {
      const node = new Y.Map();
      const data = new Y.Map();
      const frag = new Y.XmlFragment();
      const p = new Y.XmlElement('paragraph');
      const t = new Y.XmlText(); t.insert(0, 'seed');
      p.insert(0, [t]);
      frag.insert(0, [p]);
      data.set('content', frag);
      const prompt = new Y.Map(); prompt.set('text', new Y.Text());
      data.set('prompt', prompt);
      data.set('model', 'm');
      data.set('order', 'a1');
      node.set('type', 'textInput');
      node.set('data', data);
      node.set('position', new Y.Map());
      doc.getMap('nodes').set(id, node);
    };
    mk('n1'); mk('n2');
    const edge = new Y.Map();
    edge.set('id', 'e1'); edge.set('source', 'n1'); edge.set('target', 'n2');
    doc.getMap('edges').set('e1', edge);
  });
  return doc;
}

const contentFragOf = (d: Y.Doc): Y.XmlFragment =>
  ((d.getMap('nodes').get('n1') as Y.Map<unknown>).get('data') as Y.Map<unknown>).get('content') as Y.XmlFragment;
const dataMapOf = (d: Y.Doc, id = 'n1'): Y.Map<unknown> =>
  (d.getMap('nodes').get(id) as Y.Map<unknown>).get('data') as Y.Map<unknown>;

async function seedAndConnect(doc: Y.Doc, actor: CollabProjectActorService): Promise<void> {
  await actor.submit('p1', Y.encodeStateAsUpdate(doc), makeConn(), 'ss2');
}

// ═══ C-1：edges 子 map 事件 changes 未物化 ═══

describe('T24 收口 C-1：既有边键改写（edges 子 map 事件）——L2 不崩不挂', () => {
  it('改写既有边 source（合法键）→ submit 有界落定（修前=挂起形态：L2 throw 进 unhandled，promise 永不 settle）', async () => {
    const seed = seedDoc();
    const { actor } = buildActor(seed);
    await seedAndConnect(seed, actor);
    const attacker = new Client(seed);
    const attack = attacker.frame((d) => {
      (d.getMap('edges').get('e1') as Y.Map<unknown>).set('source', 'n2');
    });
    const outcome = await Promise.race([
      actor.submit('p1', attack, makeConn('u2'), 'update').then(() => 'settled' as const),
      new Promise<'HUNG'>((r) => setTimeout(() => r('HUNG'), 1_500)),
    ]);
    expect(outcome).toBe('settled');   // 红=HUNG（崩溃/挂起形态差）；绿=干净放行（source∈DOC_EDGE_RECORD_KEYS）
  }, 10_000);
});

// ═══ C-2：XML 字节域 L1/L2 语义对齐（事件增量面）═══

describe('T24 收口 C-2：两段各 100KB 合法续写不毒帧；单串>128KiB 跨帧仍毒帧', () => {
  it('帧 1/帧 2 各 100KB 单串插入既有 XmlText（每帧 L1 单串合法）→ 双帧放行（修前=第二帧整树累计 200KB 毒帧循环）', async () => {
    const seed = seedDoc();
    const { actor } = buildActor(seed);
    await seedAndConnect(seed, actor);
    const attacker = new Client(seed);
    const f1 = attacker.frame((d) => {
      ((contentFragOf(d).get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, 'a'.repeat(100 * 1024));
    });
    await expect(actor.submit('p1', f1, makeConn('u2'), 'update')).resolves.toBeDefined();
    const f2 = attacker.frame((d) => {
      ((contentFragOf(d).get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, 'b'.repeat(100 * 1024));
    });
    await expect(actor.submit('p1', f2, makeConn('u2'), 'update')).resolves.toBeDefined();   // 红=4411 毒帧（整树累计语义）
  }, 10_000);

  it('单串 200KB 跨帧挂接既有 XmlText（帧内父——L1 盲区）→ L2 事件增量面毒帧 4411', async () => {
    const seed = seedDoc();
    const { actor } = buildActor(seed);
    await seedAndConnect(seed, actor);
    const attacker = new Client(seed);
    const attack = attacker.frame((d) => {
      ((contentFragOf(d).get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, 'x'.repeat(200 * 1024));
    });
    await expect(actor.submit('p1', attack, makeConn('u2'), 'update')).rejects.toMatchObject({ code: 4411 });
  }, 10_000);
});

// ═══ I-2：毒帧速率限制两绕过 ═══

describe('T24 收口 I-2：毒帧计数 conn 身份化+DS-only 执法', () => {
  it('DS-only 帧（0 structs）连续 3 违规 → 第 4 帧 1008 poison-rate-limited（修前=零计数恒放行）', async () => {
    const seed = seedDoc();
    const { actor, hardCloseCalls } = buildActor(seed);
    await seedAndConnect(seed, actor);
    const attacker = new Client(seed);
    const conn = makeConn('u9');
    // 先导 benign 帧（本连接 client 建立已知 clock——纯 DS 删帧过 pending 预检修正 #2 的
    // 「DS-only 未知 clock→4412」面；红相不改：违规计数在 DS-only 帧仍恒零）
    const bind = attacker.frame((d) => { dataMapOf(d).set('model', 'bind'); });
    await expect(actor.submit('p1', bind, conn, 'update')).resolves.toBeDefined();
    for (let i = 0; i < 3; i++) {
      const dsOnly = attacker.frame((d) => { dataMapOf(d).delete('content'); });   // 删容器键=L2 key-not-deletable（0 structs 纯 DS）
      await expect(actor.submit('p1', dsOnly, conn, 'update')).rejects.toMatchObject({ code: 4411 });   // 红（round0 实证）=第 4 帧仍放行
      if (i < 2) {
        // 重建容器并提交（下一轮可再删——重建帧合法过闸，服务端 SV 认领新容器 clocks）；
        // 第 3 违规后封禁即生效（阈值=3），round-3 重建不再送（封禁面即下一断言）
        const rebuild = attacker.frame((d) => {
          const frag = new Y.XmlFragment();
          const p = new Y.XmlElement('paragraph'); p.insert(0, [new Y.XmlText()]);
          frag.insert(0, [p]);
          dataMapOf(d).set('content', frag);
        });
        await expect(actor.submit('p1', rebuild, conn, 'update')).resolves.toBeDefined();
      }
    }
    const benign = attacker.frame((d) => { dataMapOf(d).set('model', 'm2'); });
    await expect(actor.submit('p1', benign, conn, 'update')).rejects.toMatchObject({ code: 1008, frameReason: CollabProjectActorService.CLIENT_BINDING_WIRE_REASONS.poisonRateLimited });   // 红=resolved（DS-only 违规零计数）
    expect(hardCloseCalls.some((c) => c.reason === 'poison-rate-limited')).toBe(true);
  }, 20_000);

  it('同连接轮换 clientID（每毒帧新 clientID=新绑定）→ 计数不清零：3 违规后第 4 帧 1008（修前=新绑定各计 1 恒放行）', async () => {
    const seed = seedDoc();
    const { actor } = buildActor(seed);
    await seedAndConnect(seed, actor);
    const conn = makeConn('u-rot');
    for (let i = 0; i < 3; i++) {
      const fresh = new Client(seed);   // 每轮新 clientID（轮换形态）
      const benign = fresh.frame((d) => { dataMapOf(d).set('model', `bind-${i}`); });
      await expect(actor.submit('p1', benign, conn, 'update')).resolves.toBeDefined();   // 新 client 首帧（SV 连续）
      const violation = fresh.frame((d) => { dataMapOf(d).set('hax', i); });   // 未知键=L2 毒帧
      await expect(actor.submit('p1', violation, conn, 'update')).rejects.toMatchObject({ code: 4411 });
    }
    const probe = new Client(seed);
    const benign4 = probe.frame((d) => { dataMapOf(d).set('model', 'after'); });
    await expect(actor.submit('p1', benign4, conn, 'update')).rejects.toMatchObject({ code: 1008, frameReason: CollabProjectActorService.CLIENT_BINDING_WIRE_REASONS.poisonRateLimited });
  }, 20_000);
});

// ═══ I-5：graph_anomaly_total 六 kind ═══

describe('T24 收口 I-5：dangling-parent/parent-cycle/cross-group-parent 三 kind 计数（读模型屏蔽面）', () => {
  const anomalyCount = async (kind: string): Promise<number> => {
    const m = register.getSingleMetric('graph_anomaly_total') as never as { get(): Promise<{ values: Array<{ labels: Record<string, string>; value: number }> }> };
    const v = await m.get();
    return v.values.find((s) => s.labels.kind === kind)?.value ?? 0;
  };

  it('dangling-parent：节点 parentId 指向不存在节点 → 计数 ≥1（修前恒 0）', async () => {
    const before = await anomalyCount('dangling-parent');
    const doc = new Y.Doc();
    const { actor } = buildActor(doc);
    const c = new Client();
    const f = c.frame((d) => {
      const node = new Y.Map();
      const data = new Y.Map(); data.set('model', 'x');
      node.set('type', 'textInput'); node.set('data', data);
      node.set('parentId', 'ghost-node');
      node.set('position', new Y.Map());
      d.getMap('nodes').set('np1', node);
    });
    await expect(actor.submit('p1', f, makeConn(), 'update')).resolves.toBeDefined();
    expect(await anomalyCount('dangling-parent')).toBeGreaterThan(before);
  }, 10_000);

  it('parent-cycle：两节点互为 parent → 计数 ≥1（修前恒 0）', async () => {
    const before = await anomalyCount('parent-cycle');
    const doc = new Y.Doc();
    const { actor } = buildActor(doc);
    const c = new Client();
    const f = c.frame((d) => {
      const mk = (id: string, parent: string): void => {
        const node = new Y.Map();
        const data = new Y.Map(); data.set('model', 'x');
        node.set('type', 'textInput'); node.set('data', data);
        node.set('parentId', parent);
        node.set('position', new Y.Map());
        d.getMap('nodes').set(id, node);
      };
      mk('c-a', 'c-b'); mk('c-b', 'c-a');
    });
    await expect(actor.submit('p1', f, makeConn(), 'update')).resolves.toBeDefined();
    expect(await anomalyCount('parent-cycle')).toBeGreaterThan(before);
  }, 10_000);

  it('cross-group-parent：parent 为非 group 节点 → 计数 ≥1（修前恒 0）', async () => {
    const before = await anomalyCount('cross-group-parent');
    const doc = new Y.Doc();
    const { actor } = buildActor(doc);
    const c = new Client();
    const f = c.frame((d) => {
      const mk = (id: string, type: string, parent?: string): void => {
        const node = new Y.Map();
        const data = new Y.Map(); data.set('order', 'a');
        node.set('type', type); node.set('data', data);
        if (parent != null) node.set('parentId', parent);
        node.set('position', new Y.Map());
        d.getMap('nodes').set(id, node);
      };
      mk('x-p', 'textInput'); mk('x-c', 'textInput', 'x-p');
    });
    await expect(actor.submit('p1', f, makeConn(), 'update')).resolves.toBeDefined();
    expect(await anomalyCount('cross-group-parent')).toBeGreaterThan(before);
  }, 10_000);
});

// ═══ gateway 级装置（I-1/M-1——version-gate spec 同族）═══

function buildGateway() {
  const prisma = {
    systemHistory: { findUnique: vi.fn().mockResolvedValue({ historyId: 't24co-history', epochStartedAt: new Date() }) },
    session: {
      findUnique: vi.fn().mockResolvedValue({ user: { id: 'u1', name: '张三' }, userId: 'u1', expiresAt: new Date(Date.now() + 24 * 3600 * 1000) }),
    },
    canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1', userId: 'other' }) },
    projectMember: { findUnique: vi.fn().mockResolvedValue(null) },
    teamMember: { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER', userId: 'u1' }) },
  };
  const repo = createMockRepo();
  const lease = createLeaseStub();
  const perm = { resolve: vi.fn(), resolveWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' }) };
  const spool = new CollabSpoolService(spoolDir.dir);
  spool.setOwner('t24co-gw');
  const gateway = new CollabGateway(
    prisma as any, new EventEmitter2() as any, repo as any, lease as any,
    perm as any, 48000 + Math.floor(Math.random() * 2000),
    undefined, undefined, undefined, spool,
  );
  gatewayFacade(gateway).forceCollabState('serving');
  return { gateway, repo };
}

describe('T24 收口 I-1：docIndex 装载 rebuild 挂点=装载重放完成后（DR 装载序——禁直调 seam）', () => {
  it('hydrate 带存量 state（含 seed 节点）→ onLoadDocument 后 actor 索引含装载前节点（修前=rebuild 在重放前对空 doc 执行=索引恒缺）', async () => {
    // 真 DR/persistence 装配（startDualClientServer kit——直构 gateway 缺 persistence 链=seam 假绿面根除）
    const { startDualClientServer } = await import('../../test-utils/dual-client-server');
    const kit = await startDualClientServer({}, 300);
    try {
      // 存量 PG state：合法 textInput 节点帧（hydrateWithRecovery.state 载荷）
      const persisted = new Y.Doc();
      persisted.transact(() => {
        const node = new Y.Map();
        const data = new Y.Map(); data.set('model', 'persisted');
        node.set('type', 'textInput'); node.set('data', data);
        node.set('position', new Y.Map());
        persisted.getMap('nodes').set('n-seed', node);
      });
      kit.repo.hydrateWithRecovery.mockResolvedValue({
        state: Y.encodeStateAsUpdate(persisted), updates: [], generation: 0, schemaVersion: CANVAS_DOC_SCHEMA_VERSION, pgSeq: 0n,
      });
      const doc = new Y.Doc();
      await (kit.gateway as unknown as { hooks: { onLoadDocument(p: unknown): Promise<unknown> } }).hooks.onLoadDocument({
        document: doc, documentName: 'project:p-i1', socketId: 'sock-i1', instance: undefined,
      } as never);
      // 装载序真值断言：doc 含存量节点（重放发生）且 actor 索引同含（rebuild 在重放后执行）
      expect(doc.getMap('nodes').has('n-seed')).toBe(true);
      expect(kit.gateway.projectActor.docIndexOf('p-i1').nodeType('n-seed')).toBe('textInput');   // 红=undefined（空 doc rebuild+重放零 effects）
    } finally { await kit.dispose(); }
  }, 30_000);
});

// ═══ M-1：版本门 schemaVersion 上行承载 ═══

describe('T24 收口 M-1：sv 上行承载——缺 sv/错 sv=fake bundle 4406（修前=client 直填服务端常量恒真放行）', () => {
  function fakeSocket() {
    const writes: Buffer[] = [];
    return {
      writes,
      socket: { write: (b: Buffer) => { writes.push(Buffer.from(b)); return true; }, end: vi.fn(), on: vi.fn() },
    };
  }
  const parseClose = (b: Buffer): number => b.readUInt16BE(2);

  it('csv=当前 但无 sv（旧 bundle 形态）→ schema-outdated 拒+升级 socket close 4406（红=放行 resolves+writes 空）', async () => {
    const { gateway } = buildGateway();
    gateway.sessionGuard.setServerHistory({ historyId: 't24co-history' });
    const fs = fakeSocket();
    const req = { headers: { origin: 'http://localhost:5173' }, url: '/collab' };
    await (gateway as unknown as { hooks: { onUpgrade(p: unknown): Promise<void> } }).hooks.onUpgrade({ request: req as never, socket: fs.socket as never, head: null, instance: undefined } as never);
    const authP = (gateway as unknown as { hooks: { onAuthenticate(p: unknown): Promise<unknown> } }).hooks.onAuthenticate({
      requestHeaders: new Headers({ cookie: 'flowweb.session_token=tok' }),
      requestParameters: new URLSearchParams(`csv=${CLIENT_PROTOCOL_VERSION}`),
      socketId: 'sock-sv1', documentName: 'project:vg',
      connectionConfig: { readOnly: false, isAuthenticated: false },
      request: req as never,
    } as never);
    await expect(authP).rejects.toMatchObject({ reason: 'schema-outdated' });   // 红=resolves（三元恒真放行）
    expect(fs.writes.length).toBeGreaterThan(0);
    expect(parseClose(fs.writes[0]!)).toBe(4406);
  }, 10_000);

  it('csv=当前 且 sv=999（错版 bundle）→ 同拒 4406（红=放行）', async () => {
    const { gateway } = buildGateway();
    gateway.sessionGuard.setServerHistory({ historyId: 't24co-history' });
    const fs = fakeSocket();
    const req = { headers: { origin: 'http://localhost:5173' }, url: '/collav' };
    await (gateway as unknown as { hooks: { onUpgrade(p: unknown): Promise<void> } }).hooks.onUpgrade({ request: req as never, socket: fs.socket as never, head: null, instance: undefined } as never);
    const authP = (gateway as unknown as { hooks: { onAuthenticate(p: unknown): Promise<unknown> } }).hooks.onAuthenticate({
      requestHeaders: new Headers({ cookie: 'flowweb.session_token=tok' }),
      requestParameters: new URLSearchParams(`csv=${CLIENT_PROTOCOL_VERSION}&sv=999`),
      socketId: 'sock-sv2', documentName: 'project:vg',
      connectionConfig: { readOnly: false, isAuthenticated: false },
      request: req as never,
    } as never);
    await expect(authP).rejects.toMatchObject({ reason: 'schema-outdated' });
    expect(fs.writes.length).toBeGreaterThan(0);
    expect(parseClose(fs.writes[0]!)).toBe(4406);
  }, 10_000);

  it('csv=当前 且 sv=当前 且 hid 匹配 → 放行（三元真承载后的正路回归）', async () => {
    const { gateway } = buildGateway();
    gateway.sessionGuard.setServerHistory({ historyId: 't24co-history' });
    await expect((gateway as unknown as { hooks: { onAuthenticate(p: unknown): Promise<unknown> } }).hooks.onAuthenticate({
      requestHeaders: new Headers({ cookie: 'flowweb.session_token=tok' }),
      requestParameters: new URLSearchParams(`csv=${CLIENT_PROTOCOL_VERSION}&sv=${CANVAS_DOC_SCHEMA_VERSION}&hid=t24co-history`),
      socketId: 'sock-sv3', documentName: 'project:vg',
      connectionConfig: { readOnly: false, isAuthenticated: false },
      request: { headers: { origin: 'http://localhost:5173' } } as never,
    } as never)).resolves.toBeDefined();
  }, 10_000);
});
