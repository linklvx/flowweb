// apps/api/src/modules/collab/collab-harness/collab-t24-clientid-single-active.e2e-spec.ts
// T31 发现②定案红锚（真 WS 栈中间层——非 actor 直调〔t24 spec〕非 drill 全栈装置）：
//  场景1=裸 ws 手搓 sync 协议帧（真 gateway+真 cookie 认证+真装载+真 beforeSync→actor drain 链——
//   绕开客户端 yjs 库行为）：同 clientID 两连接先后提交同 doc 增量帧→断言旧连接 close 1008
//   'clientid-superseded'（接管档——偏离 38⑰「旧连接活跃→先 close 旧再纳新」）+两帧落 PG。
//  场景2=真 HocuspocusProvider synced 形态（drill cl2 同款）——分歧点钉子：yjs 客户端自防轮换
//   （yjs 13.6 transaction：非本地事务推进本 doc clientID clock→generateNewClientId）——second doc
//   synced 时 apply 服务端 SS2（含 first 同 clientID structs）即轮换，编辑帧已换 clientID=合法
//   多设备形态，服务端不执法（四元不同键）。即「同 clientID 并发帧」经真客户端 synced 形态
//   构造不出来，唯一可达服务端的形态=未 sync 先发帧/恶意手搓帧（场景1 正是该形态）。
// 线格式手搓（lib0 非直接依赖——varUint/varStr/varUint8 三函数内联；对照 y-protocols/sync.js
// writeSyncStep1/writeUpdate 与 @hocuspocus/provider OutgoingMessage：varStr(docName)+varUint(0=Sync)）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Y from 'yjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { CANVAS_DOC_SCHEMA_VERSION, CLIENT_PROTOCOL_VERSION } from '@flowweb/shared';
import { CollabGateway } from '../collab.gateway';
import { CollabResidencyService } from '../collab-residency.service';
import { CollabLeaseService } from '../collab-lease.service';
import { CollabSpoolService } from '../collab-spool.service';
import { CanvasDocUpdateRepository } from '../canvas-doc-update.repository';
import { ProjectPermissionService } from '../../team/project-permission.service';
import { SessionService } from '../../../auth/session.service';
import { ensureProjectFixture, cleanupProjectFixture, restoreLeaseRow } from '../../../test-utils/db-fixtures';
import { pollUntil } from '../../../test-utils/poll-until';

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;
const TID = 'y0a-fixture-team';
const CLIENT_ID = 987654321;

// ── 最小 wire 编码（LEB128 varUint——lib0 encoding 语义子集）──
function appendVarUint(parts: number[], v: number): void {
  let n = v;
  while (n > 127) { parts.push((n & 0b01111111) | 0b10000000); n >>>= 7; }
  parts.push(n);
}
function encodeWire(docName: string, syncMessageKind: number, payload: Uint8Array): Uint8Array {
  const name = Buffer.from(docName, 'utf8');
  const parts: number[] = [];
  appendVarUint(parts, name.byteLength);
  for (const b of name) parts.push(b);
  appendVarUint(parts, 0);   // MessageType.Sync（provider OutgoingMessage 定界）
  appendVarUint(parts, syncMessageKind);   // messageYjsSyncStep1=0 / messageYjsUpdate=2
  appendVarUint(parts, payload.byteLength);
  for (const b of payload) parts.push(b);
  return new Uint8Array(parts);
}
const ss1Of = (docName: string, doc: Y.Doc): Uint8Array => encodeWire(docName, 0, Y.encodeStateVector(doc));
const updateOf = (docName: string, update: Uint8Array): Uint8Array => encodeWire(docName, 2, update);
/** hocuspocus 认证握手先行帧（gateway cookie-only——token 恒占位；无此帧 onAuthenticate 不触发）。 */
function authOf(docName: string): Uint8Array {
  const name = Buffer.from(docName, 'utf8');
  const token = Buffer.from('t24sa-cookie-placeholder', 'utf8');
  const parts: number[] = [];
  appendVarUint(parts, name.byteLength);
  for (const b of name) parts.push(b);
  appendVarUint(parts, 2);   // MessageType.Auth
  appendVarUint(parts, 0);   // AuthMessageType.Token
  appendVarUint(parts, token.byteLength);
  for (const b of token) parts.push(b);
  return new Uint8Array(parts);
}

/** 本地帧工厂（固定 clientID；transact 捕获增量 update——t24 spec Client 同款）。 */
class FrameFactory {
  readonly doc = new Y.Doc();
  constructor() { this.doc.clientID = CLIENT_ID; }
  frame(nodeId: string): Uint8Array {
    const captured: Uint8Array[] = [];
    const h = (u: Uint8Array): void => { captured.push(u); };
    this.doc.on('update', h);
    try {
      this.doc.transact(() => {
        const n = new Y.Map();
        const data = new Y.Map();
        data.set('model', nodeId);
        n.set('type', 'textInput');
        n.set('data', data);
        this.doc.getMap('nodes').set(nodeId, n);
      });
    } finally { this.doc.off('update', h); }
    if (captured.length === 0) throw new Error('零 update');
    return captured.reduce((acc, u) => Y.mergeUpdates([acc, u]));
  }
}

interface RawConn {
  ws: WebSocket;
  opened: Promise<void>;
  replyOf: (n: number) => Promise<void>;   // 第 n 包（0=Authenticated 回执，1=SS1 后续包）——认证/装载完成判据
  closed: Promise<{ code: number; reason: string }>;
}
function rawConn(url: string, docName: string, token: string): RawConn {
  const origin = process.env.COLLAB_ALLOWED_ORIGINS?.split(',')[0]?.trim() || 'http://localhost:5173';
  const ws = new WebSocket(`${url}?csv=${CLIENT_PROTOCOL_VERSION}&sv=${CANVAS_DOC_SCHEMA_VERSION}`, {
    headers: { origin, cookie: `flowweb.session_token=${token}` },
  });
  const opened = new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', (e: Error) => reject(e));
  });
  const replies: Array<Array<() => void>> = [];
  let received = 0;
  ws.on('message', () => {
    const list = replies[received];
    received += 1;
    if (list) for (const w of list) w();
  });
  const replyOf = (n: number): Promise<void> => new Promise<void>((resolve) => {
    if (n < received) { resolve(); return; }
    (replies[n] ??= []).push(resolve);
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.once('close', (code: number, reason: Buffer) => resolve({ code, reason: reason.toString() })));
  return { ws, opened, replyOf, closed };
}

let prisma: PrismaClient;
let repo: CanvasDocUpdateRepository;
let gateway: CollabGateway;
let lease: CollabLeaseService;
let residency: CollabResidencyService;
let spoolDir: string;
let serverPort: number;

async function seedProject(pid: string): Promise<void> {
  await ensureProjectFixture(prisma, pid);
  await prisma.canvasDocUpdate.deleteMany({ where: { projectId: pid } });
  await prisma.canvasDoc.deleteMany({ where: { projectId: pid } });
}
async function mkToken(): Promise<string> {
  const token = `t24sa-${randomUUID()}`;
  await prisma.session.create({
    data: { id: `sess-${randomUUID().slice(0, 8)}`, userId: 'y0a-fixture-user', token, expiresAt: new Date(Date.now() + 3600_000) },
  });
  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId: TID, userId: 'y0a-fixture-user' } },
    create: { teamId: TID, userId: 'y0a-fixture-user', role: 'MEMBER' },
    update: {},
  });
  return token;
}
async function teardownProject(pid: string, token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { token } }).catch(() => {});
  await cleanupProjectFixture(prisma, pid);
}
const serverDocKeys = async (pid: string): Promise<Set<string>> =>
  residency.withSession(pid, (doc) => new Set(doc.getMap('nodes').keys()), { mode: 'read' });

d('T31 发现②：clientID 单活跃接管——真 WS 栈中间层（真 gateway+真认证+真 actor drain）', () => {
  beforeAll(async () => {
    prisma = new PrismaClient();
    repo = new CanvasDocUpdateRepository(prisma as never);
    await restoreLeaseRow(prisma as never);
    spoolDir = await mkdtemp(join(tmpdir(), 't24sa-e2e-'));
    const spool = new CollabSpoolService(spoolDir);
    serverPort = 20000 + Math.floor(Math.random() * 20000);
    lease = new CollabLeaseService(prisma as never, repo, spool);
    gateway = new CollabGateway(
      prisma as never, new EventEmitter2() as never, repo, lease,
      new ProjectPermissionService(prisma as never), serverPort, 10_000, undefined,
      new SessionService(prisma as never), spool,
    );
    await gateway.onModuleInit();
    expect(lease.isServing()).toBe(true);
    residency = new CollabResidencyService(gateway);
  }, 60_000);

  afterAll(async () => {
    for (const pid of residency?.residentProjectIds() ?? []) await residency.releaseSessionFor(pid).catch(() => {});
    lease?.halt();
    await lease?.release().catch(() => {});
    await gateway?.onApplicationShutdown().catch(() => {});
    await rm(spoolDir, { recursive: true, force: true }).catch(() => {});
    await restoreLeaseRow(prisma as never);
    await prisma.$disconnect();
  }, 60_000);

  it('场景1（接管红锚）：裸 ws 手搓帧——同 clientID 两连接先后提交同 doc 增量帧→旧连接 close 1008 clientid-superseded+新连接帧落 PG', async () => {
    const PID = 't24sa-e2e-takeover';
    await seedProject(PID);
    const token = await mkToken();
    const url = `ws://127.0.0.1:${serverPort}`;
    const docName = `project:${PID}`;
    const factory = new FrameFactory();   // 单 doc 连发=两帧 clock 连续（[0,k1)/[k1,k2)——pending 预检自包含）
    const a = rawConn(url, docName, token);
    try {
      await a.opened;
      a.ws.send(authOf(docName));
      await a.replyOf(0);   // Authenticated 回执（onAuthenticate 完成——cookie 真链）
      a.ws.send(ss1Of(docName, factory.doc));
      await a.replyOf(1);   // SS2/SyncStatus 回包（装载完成）
      a.ws.send(updateOf(docName, factory.frame('t24sa-node-a')));
      await pollUntil(async () => (await serverDocKeys(PID)).has('t24sa-node-a'), 15_000);   // 帧 apply=绑定已登记（准入先行）

      const b = rawConn(url, docName, token);
      try {
        await b.opened;
        b.ws.send(authOf(docName));
        await b.replyOf(0);
        b.ws.send(ss1Of(docName, factory.doc));
        await b.replyOf(1);
        b.ws.send(updateOf(docName, factory.frame('t24sa-node-b')));   // 同四元第二连接帧→接管判定

        const closedA = await Promise.race([a.closed, new Promise<null>((r) => setTimeout(() => r(null), 10_000))]);
        expect(closedA).not.toBeNull();
        expect(closedA!.code).toBe(1008);   // RATE_LIMITED_CLOSE 可重试档（接管 close——38⑰）
        expect(closedA!.reason).toBe('clientid-superseded');
        await pollUntil(async () => (await serverDocKeys(PID)).has('t24sa-node-b'), 15_000);   // 新连接帧照常落（先 close 旧再纳新）
        const closedB = await Promise.race([b.closed, new Promise<null>((r) => setTimeout(() => r(null), 500))]);
        expect(closedB).toBeNull();   // 新连接不被关（单活跃=让位旧者非全拒）
        const { state, updates } = await repo.loadForHydration(PID);   // PG 重放判据（drill 同判别面）
        const revived = new Y.Doc();
        if (state) Y.applyUpdate(revived, new Uint8Array(state));
        for (const u of updates) Y.applyUpdate(revived, new Uint8Array(u));
        expect(revived.getMap('nodes').has('t24sa-node-a')).toBe(true);
        expect(revived.getMap('nodes').has('t24sa-node-b')).toBe(true);
      } finally {
        b.ws.close();
      }
    } finally {
      a.ws.close();
      await teardownProject(PID, token);
    }
  }, 60_000);

  it('场景2（分歧点钉子）：真 provider synced 形态（drill cl2 同款）——second doc apply 服务端同 clientID structs 即 yjs 自防轮换→帧已换 clientID，服务端不执法（合法多设备）', async () => {
    const PID = 't24sa-e2e-provider';
    await seedProject(PID);
    const token = await mkToken();
    const url = `ws://127.0.0.1:${serverPort}?csv=${CLIENT_PROTOCOL_VERSION}&sv=${CANVAS_DOC_SCHEMA_VERSION}`;
    const origin = process.env.COLLAB_ALLOWED_ORIGINS?.split(',')[0]?.trim() || 'http://localhost:5173';
    class HeaderWs extends WebSocket {
      constructor(u: string | URL) { super(u as string, { headers: { origin, cookie: `flowweb.session_token=${token}` } }); }
    }
    const mkProviderDoc = (): Y.Doc => {
      const doc = new Y.Doc();
      doc.clientID = CLIENT_ID;   // 并发同键构造（构造前设置——drill cl2 同形态）
      return doc;
    };
    const mkProvider = (doc: Y.Doc): { provider: HocuspocusProvider; synced: Promise<void>; closed: Promise<boolean> } => {
      const provider = new HocuspocusProvider({ url, name: `project:${PID}`, document: doc, WebSocketPolyfill: HeaderWs } as never);
      const synced = new Promise<void>((resolve) => provider.on('synced', () => resolve()));
      const closed = new Promise<boolean>((resolve) => provider.on('close', () => resolve(true)));
      return { provider, synced, closed };
    };
    const firstDoc = mkProviderDoc();
    const first = mkProvider(firstDoc);
    const secondDoc = mkProviderDoc();
    const second = mkProvider(secondDoc);
    try {
      await first.synced;
      firstDoc.transact(() => {
        const data = new Y.Map(); data.set('model', 'first');
        const n = new Y.Map(); n.set('type', 'textInput'); n.set('data', data);
        firstDoc.getMap('nodes').set('t24sa-provider-first', n);
      });
      await pollUntil(async () => (await serverDocKeys(PID)).has('t24sa-provider-first'), 15_000);   // first 帧落=绑定已登记

      await second.synced;   // second doc apply 服务端 SS2（含 client 987654321 structs）→ yjs 自防轮换
      expect(secondDoc.clientID).not.toBe(CLIENT_ID);   // 分歧点：真客户端 synced 后 clientID 已轮换（generateNewClientId）
      secondDoc.transact(() => {
        const data = new Y.Map(); data.set('model', 'second');
        const n = new Y.Map(); n.set('type', 'textInput'); n.set('data', data);
        secondDoc.getMap('nodes').set('t24sa-provider-second', n);
      });
      await pollUntil(async () => (await serverDocKeys(PID)).has('t24sa-provider-second'), 15_000);   // 帧照常落（新 clientID=新四元键合法并放）
      const firstClosed = await Promise.race([first.closed, new Promise<boolean>((r) => setTimeout(() => r(false), 3_000))]);
      expect(firstClosed).toBe(false);   // 不执法（非同键）——drill cl2「20s 无接管 close」即本形态（装置形态限界）
    } finally {
      first.provider.destroy();
      second.provider.destroy();
      await teardownProject(PID, token);
    }
  }, 60_000);
});
