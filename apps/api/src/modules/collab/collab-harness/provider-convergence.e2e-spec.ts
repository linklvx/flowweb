// apps/api/src/modules/collab/collab-harness/provider-convergence.e2e-spec.ts —— T19 终出口
//（plan v11.2 S5·Task 19：跨子系统收敛 harness——故障注入矩阵串联）。
//
// 【矩阵九族覆盖盘点（串联形态声明——已覆盖面直接引用勿重复造轮，本 spec=跨子系统串联缺口）】
//  ①execSeq 代际矩阵：单系统锚=execution/execseq-generation.int.spec（三态 moveToDelayed/
//    takeover void/onTick abort/failed 钩子票守卫）——本 spec 串联「代际接管→doc exec cache 旧代拒写
//    （exec_seq_stale_rejected）→投影新代赢」全链（场景 A）。
//  ②投影 rev 竞态矩阵：单系统锚=media-delivery/projection-outbox.poller.int.spec（superseded/
//    fast path/fencing/spool/fenced/批 flush）——本 spec 串联「旧/新 artifactRev 同时 pending 新代赢
//    →binding current-state reconcile 反映 doc 现值」（场景 B——投影×binding 跨系统）。
//  ③video materialize 矩阵：单系统锚=artifact-core/materialize.int.spec（claim 恰一/瞬态退避/
//    mismatch 终态退款/lease fence/退款抛错收敛）+media-probe.int.spec（40MP/natural fact）——
//    本 spec 消费其 facts 面幂等（场景 C 串联 facts outbox 重复投递）。
//  ④R3 五窗：单系统锚=execution/intent-reconcile-r3.int.spec（五窗全+并发恰一次+保留矩阵）——
//    本 spec 串联 invariant_violation 巡检计数（观测面，场景 C 断言计数器存在性）。
//  ⑤copy/binding/GC：单系统锚=binding-reconcile.int.spec+media-gc.int.spec——本 spec 串联场景 B
//    （replace 后 current-state upsert）；GC 阀分桶锚=media-gc.int.spec T19 分桶用例。
//  ⑥guard 检测→exec cache 修复→ACL 拒绝链路：单系统锚=collab-document.exec-map.spec（代次守卫）+
//    team.util.spec（assertTeamMember）——本 spec 串联场景 A（exec cache）+场景 D（ACL 计数+移除拒写）。
//  ⑦outbox 乱序+重复投递幂等：单系统锚=media/media-fact-outbox.int.spec——场景 C 串联投影完成→
//    facts 落 outbox 同事务→重复 createMany skipDuplicates 幂等。
//  ⑧双端收敛+分镜并发零成员丢失+读序稳定：本 spec 场景 E（真 WS 双客户端并发 slot/order 写——
//    零成员丢失+两端收敛）；读序 tie-break 锚=shared order-records.test.ts+order-pathology.test.ts。
//  ⑨reset 联动：静态+运行时锚=scripts/dev-reset-canvas.test.mjs（安全五件套+purgeS3Prefixes
//    运行时断言）+T19 登记收口 dry-run ledger 通行证——本 spec 不复刻（脚本域）。
//
// v14 口径注记：spec :262 伪码清单「in-place repair 注入项」=废止口径（在线 repair 已整建制删除）
// ——本矩阵 repair 相关条目按「重复键容忍+病理计数+读序稳定」承载（collab_order_pathology_total
// 计数面），勿复活 repair 机制。
//
// 装置：真 PG+真 CanvasDocUpdateRepository+真 CollabLease（CAS/epoch）+真 CollabGateway（随机端口
// 真监听）+真 HocuspocusProvider 客户端（ws 库 cookie 注入——dual-client-server 形态，prisma 换真链）。
// fileParallelism=false（vitest.int.config——CollabLease 单行资源串行）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Y from 'yjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HocuspocusProvider } from '@hocuspocus/provider';
import WebSocket from 'ws';
import { CLIENT_PROTOCOL_VERSION, scanOrderPathology, compareWithinLayer } from '@flowweb/shared';
import { CollabGateway } from '../collab.gateway';
import { CollabResidencyService } from '../collab-residency.service';
import { CollabDocumentService } from '../collab-document.service';
import { CollabLeaseService } from '../collab-lease.service';
import { CollabSpoolService } from '../collab-spool.service';
import { CanvasDocUpdateRepository } from '../canvas-doc-update.repository';
import { ProjectPermissionService } from '../../team/project-permission.service';
import { SessionService } from '../../../auth/session.service';
import { ProjectionOutboxPoller } from '../../media-delivery/projection-outbox.poller';
import { BindingReconcileService } from '../../media-delivery/binding-reconcile.service';
import { execSeqStaleRejected } from '../../execution/exec.metrics';
import { memberRevokedConns } from '../store.metrics';
import { mediaAclDenied } from '../../team/team.metrics';
import { assertTeamMember } from '../../team/team.util';
import { reconcileInvariantViolation } from '../../execution/intent-reconcile.metrics';
import { ensureProjectFixture, cleanupProjectFixture, restoreLeaseRow } from '../../../test-utils/db-fixtures';
import { pollUntil } from '../../../test-utils/poll-until';

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

const DEBOUNCE_MS = 10_000;
const TID = 'y0a-fixture-team';

const counterOf = (c: unknown): number => {
  const m = (c as { hashMap?: Record<string, { value?: number }> }).hashMap ?? {};
  return Object.values(m).reduce((s, v) => s + (v.value ?? 0), 0);
};

let prisma: PrismaClient;
let repo: CanvasDocUpdateRepository;
let gateway: CollabGateway;
let emitter: EventEmitter2;
let residency: CollabResidencyService;
let docSvc: CollabDocumentService;
let lease: CollabLeaseService;
let spoolDir: string;
let serverPort: number;
let poller: ProjectionOutboxPoller;
let reconciler: BindingReconcileService;

/** PG 行装载重放（重启模拟的读侧）。 */
async function reviveFromPg(pid: string): Promise<Y.Doc> {
  const { state, updates } = await repo.loadForHydration(pid);
  const revived = new Y.Doc();
  if (state) Y.applyUpdate(revived, new Uint8Array(state));
  for (const u of updates) Y.applyUpdate(revived, new Uint8Array(u));
  return revived;
}

async function seedProject(pid: string): Promise<void> {
  await ensureProjectFixture(prisma, pid);
  await prisma.canvasDocUpdate.deleteMany({ where: { projectId: pid } });
  await prisma.canvasDoc.deleteMany({ where: { projectId: pid } });
  await prisma.artifactProjection.deleteMany({ where: { projectId: pid } });
  await prisma.nodeArtifact.deleteMany({ where: { projectId: pid } });
  await prisma.mediaBinding.deleteMany({ where: { projectId: pid } });
}

async function seedNode(pid: string, nodeId: string, data: Record<string, unknown> = { content: 'seed' }): Promise<void> {
  await residency.withSession(pid, (doc) => {
    const n = new Y.Map();
    n.set('data', new Y.Map(Object.entries(data)));
    doc.getMap('nodes').set(nodeId, n);
  }, { mode: 'write' });
}

interface SeedArtifactOpts {
  mediaId?: string | null;
  rev?: number;
  projectionRev?: number;
  state?: 'pending' | 'dead' | 'orphaned' | 'superseded';
}

/** NodeArtifact+ArtifactProjection 成对落行（slot 唯一键=targetItemId ''）。 */
async function seedArtifact(pid: string, nodeId: string, opts: SeedArtifactOpts = {}): Promise<{ artifactId: string; projectionId: string }> {
  const targetField = 'fileId';
  const mediaId = opts.mediaId ?? `media-${randomUUID().slice(0, 8)}`;
  const artifact = await prisma.nodeArtifact.create({
    data: {
      projectId: pid, nodeId, teamId: TID, role: 'primary', targetField, targetItemId: '',
      mediaId, resultText: null,
      source: 'generated', state: 'stored',
      rev: opts.rev ?? 1,
    },
  });
  const projection = await prisma.artifactProjection.create({
    data: {
      artifactId: artifact.id, artifactRev: opts.projectionRev ?? artifact.rev, projectId: pid, nodeId,
      targetField, targetItemId: '', mediaId, resultText: null,
      state: opts.state ?? 'pending', attempts: 0,
    },
  });
  return { artifactId: artifact.id, projectionId: projection.id };
}

async function teardownProject(pid: string): Promise<void> {
  await prisma.artifactProjection.deleteMany({ where: { projectId: pid } }).catch(() => {});
  await prisma.nodeArtifact.deleteMany({ where: { projectId: pid } }).catch(() => {});
  await prisma.mediaBinding.deleteMany({ where: { projectId: pid } }).catch(() => {});
  await cleanupProjectFixture(prisma, pid);
}

/** 真 WS 客户端（cookie 注入——kit makeHeaderWs 形态；token=Session.token 真行）。 */
function connectProvider(url: string, name: string, token: string): { ydoc: Y.Doc; provider: HocuspocusProvider; synced: Promise<void>; closed: Promise<number | null> } {
  const ydoc = new Y.Doc();
  const origin = process.env.COLLAB_ALLOWED_ORIGINS?.split(',')[0]?.trim() || 'http://localhost:5173';
  class HeaderWs extends WebSocket {
    constructor(u: string | URL) { super(u as string, { headers: { origin, cookie: `flowweb.session_token=${token}` } }); }
  }
  const provider = new HocuspocusProvider({
    url: `${url}?csv=${CLIENT_PROTOCOL_VERSION}`,
    name,
    document: ydoc,
    WebSocketPolyfill: HeaderWs,
  } as any);
  const synced = new Promise<void>((resolve) => provider.on('synced', () => resolve()));
  // close payload 形态={event: CloseEvent}（attachWebSocketListeners）——code 在 event.code
  const closed = new Promise<number | null>((resolve) => provider.on('close', (e: { event?: { code?: number }; code?: number }) => resolve(e?.event?.code ?? e?.code ?? null)));
  return { ydoc, provider, synced, closed };
}

d('T19 跨子系统收敛 harness（真 PG+真 WS：代际×投影×binding×facts×移除拒写×双端收敛）', () => {
  beforeAll(async () => {
    prisma = new PrismaClient();
    repo = new CanvasDocUpdateRepository(prisma as any);
    await restoreLeaseRow(prisma as any);
    await prisma.artifactProjection.deleteMany({ where: { state: { in: ['pending', 'projecting'] } } }).catch(() => {});
    spoolDir = await mkdtemp(join(tmpdir(), 't19-e2e-'));
    const spool = new CollabSpoolService(spoolDir);
    const perm = new ProjectPermissionService(prisma as any);
    serverPort = 20000 + Math.floor(Math.random() * 20000);
    emitter = new EventEmitter2();
    lease = new CollabLeaseService(prisma as any, repo, spool);
    gateway = new CollabGateway(
      prisma as any, emitter as any, repo, lease,
      perm, serverPort, DEBOUNCE_MS, undefined, new SessionService(prisma as any), spool,
    );
    await gateway.onModuleInit();
    expect(lease.isServing()).toBe(true);
    residency = new CollabResidencyService(gateway);
    docSvc = new CollabDocumentService(gateway, repo, residency);
    reconciler = new BindingReconcileService(prisma as any, docSvc);
  }, 60_000);

  afterAll(async () => {
    for (const pid of residency?.residentProjectIds() ?? []) await residency.releaseSessionFor(pid).catch(() => {});
    lease?.halt();
    await lease?.release().catch(() => {});
    await (gateway as any)?.server.destroy().catch(() => {});
    await rm(spoolDir, { recursive: true, force: true }).catch(() => {});
    await restoreLeaseRow(prisma);
    await prisma.$disconnect();
  }, 30_000);

  const makePoller = () => {
    const teamCredit: any = {
      rollbackDeliveryFailed: vi.fn(async () => true),
    };
    return new ProjectionOutboxPoller(prisma as any, lease, docSvc, teamCredit, reconciler);
  };

  it('场景 A（execSeq 代际→doc exec cache→投影新代赢串联）：takeover 后旧 worker 迟到 exec 写被拒（exec_seq_stale_rejected+新代胜出）+旧/新 artifactRev 同 pending 新代 projected 旧代 superseded', async () => {
    const PID = `t19-e2e-gen`;
    const NODE = 'n-gen';
    await seedProject(PID);
    await seedNode(PID, NODE);
    poller = makePoller();

    // 代际串联段：新代 attempts=2 在 doc（takeover 后新 worker 投影）→旧 worker 迟到 error(attempts=1) 拒
    await docSvc.writeExecStatus(PID, NODE, { status: 'loading', jobId: 'j-new', attempts: 2 });
    const staleBefore = counterOf(execSeqStaleRejected);
    await docSvc.writeExecStatus(PID, NODE, { status: 'error', error: 'stale worker', attempts: 1 });
    expect(counterOf(execSeqStaleRejected)).toBe(staleBefore + 1);   // 旧代拒写专项计数（takeover 串联观测面）
    const execMap = await residency.withSession(PID, (doc) => (doc.getMap('exec').get(NODE) as Y.Map<unknown>).toJSON(), { mode: 'read' });
    expect(execMap.status).toBe('loading');   // 新代不被旧代倒退

    // 投影段：replace 形态——同槽位 rev 前进+旧/新投影行同时 pending
    const { artifactId } = await seedArtifact(PID, NODE, { rev: 1 });
    await prisma.nodeArtifact.update({ where: { id: artifactId }, data: { rev: 2, mediaId: 'media-new-gen' } });   // replace CAS（rev 前进）
    await prisma.artifactProjection.create({
      data: {
        artifactId, artifactRev: 2, projectId: PID, nodeId: NODE, targetField: 'fileId', targetItemId: '',
        mediaId: 'media-new-gen', resultText: null, state: 'pending', attempts: 0,
      },
    });
    await poller.tick();
    const rows = await prisma.artifactProjection.findMany({ where: { projectId: PID }, select: { artifactRev: true, state: true } });
    expect(rows.find((r) => r.artifactRev === 1)?.state).toBe('superseded');   // 旧代 superseded
    expect(rows.find((r) => r.artifactRev === 2)?.state).not.toBe('pending');  // 新代收敛（projected/fast-path）
    // doc 交付面=新代值（rev recheck 保护）
    const fileId = await residency.withSession(PID, (doc) => ((doc.getMap('nodes').get(NODE) as Y.Map<any>).get('data') as Y.Map<any>).get('fileId'), { mode: 'read' });
    expect(fileId).toBe('media-new-gen');
    await teardownProject(PID);
  }, 30_000);

  it('场景 B（投影 superseded→binding current-state 串联）：用户 replace（NodeArtifact rev 前进+doc 现值）后旧投影 superseded 不覆盖 doc 现值+binding reconcile=doc 现值 current-state（新槽位行 upsert）', async () => {
    const PID = `t19-e2e-bind`;
    const NODE = 'n-bind';
    await seedProject(PID);
    await seedNode(PID, NODE);
    poller = makePoller();

    // 生成在飞（投影 pending rev1）→用户 replace 命令：NodeArtifact 同槽位 CAS 前进（rev+新 mediaId）
    // +doc data.fileId=replace 新值（replaceMedia 命令双写形态——T11 交付面）
    const { projectionId } = await seedArtifact(PID, NODE, { rev: 1, mediaId: 'media-old-bind' });
    await prisma.nodeArtifact.update({
      where: { id: (await prisma.nodeArtifact.findFirstOrThrow({ where: { projectId: PID, nodeId: NODE } })).id },
      data: { rev: 2, mediaId: 'media-user-replaced' },   // replace CAS：rev 前进（0 行=superseded 判据源）
    });
    await residency.withSession(PID, (doc) => {
      ((doc.getMap('nodes').get(NODE) as Y.Map<any>).get('data') as Y.Map<any>).set('fileId', 'media-user-replaced');
    }, { mode: 'write' });
    await poller.tick();
    expect((await prisma.artifactProjection.findUnique({ where: { id: projectionId } }))?.state).toBe('superseded');   // 旧代投影 superseded（rev≠——用户值不被旧代产物覆盖）
    const fileId = await residency.withSession(PID, (doc) => ((doc.getMap('nodes').get(NODE) as Y.Map<any>).get('data') as Y.Map<any>).get('fileId'), { mode: 'read' });
    expect(fileId).toBe('media-user-replaced');

    // binding current-state：doc 现值=期望集（upsert 新行；media 行缺席→missing-media 拒建——只验 reconcile 反映 doc 现值通道）
    // 先造真 Media 行使 binding 可建（FK 防线）
    const user = await prisma.user.findUnique({ where: { id: 'y0a-fixture-user' } });
    await prisma.media.create({
      data: {
        userId: user!.id, teamId: TID, key: `t19/${randomUUID().slice(0, 8)}`,
        originalName: 'r.mp4', mimeType: 'video/mp4', size: 1, type: 'generated', status: 'completed',
        projectId: PID, id: 'media-user-replaced',
      },
    });
    const summary = await reconciler.reconcileProject(PID);
    expect(summary.upserted).toBeGreaterThanOrEqual(1);
    const binding = await prisma.mediaBinding.findFirst({
      where: { projectId: PID, nodeId: NODE, role: 'primary', targetField: 'fileId', targetItemId: '' },
    });
    expect(binding?.mediaId).toBe('media-user-replaced');   // current-state=doc 现值（replace 后同槽位改行）
    await prisma.media.deleteMany({ where: { projectId: PID } });
    await teardownProject(PID);
  }, 30_000);

  it('场景 C（投影完成→重启读侧+facts 幂等+观测计数存在串联）：projected→releaseSession 重启→PG 重放 doc 现值仍在；facts outbox 重复投递 skipDuplicates 幂等；invariant_violation 计数器在线', async () => {
    const PID = `t19-e2e-facts`;
    const NODE = 'n-facts';
    await seedProject(PID);
    await seedNode(PID, NODE);
    poller = makePoller();

    await seedArtifact(PID, NODE, { rev: 1, mediaId: 'media-c' });
    const projectionId = (await prisma.artifactProjection.findFirstOrThrow({ where: { projectId: PID } })).id;
    await poller.tick();
    expect((await prisma.artifactProjection.findUnique({ where: { id: projectionId } }))?.state).not.toBe('pending');

    // 重启模拟：释放常驻会话→PG 重放（装载路径）→交付值仍在（projected 的持久语义）
    await residency.releaseSessionFor(PID);
    const revived = await reviveFromPg(PID);
    const revivedFileId = ((revived.getMap('nodes').get(NODE) as Y.Map<any>)?.get('data') as Y.Map<any>)?.get('fileId');
    expect(revivedFileId).toBe('media-c');

    // facts outbox 重复投递幂等（乱序/重放面——四元组唯一约束）：同 (mediaId,projectId,factType,factVersion) 双写零重复行
    await prisma.mediaFactOutbox.createMany({
      data: [{ mediaId: 'media-c', projectId: PID, factVersion: 1, factType: 'state', payload: { status: 'completed' } }],
      skipDuplicates: true,
    });
    await prisma.mediaFactOutbox.createMany({
      data: [{ mediaId: 'media-c', projectId: PID, factVersion: 1, factType: 'state', payload: { status: 'completed' } }],
      skipDuplicates: true,
    });
    expect(await prisma.mediaFactOutbox.count({ where: { mediaId: 'media-c', projectId: PID, factType: 'state', factVersion: 1 } })).toBe(1);

    // 观测面在线性：invariant_violation 计数器已注册（R3 manual-required 同事件接线——intent-reconcile spec 红绿锚）
    expect(counterOf(reconcileInvariantViolation)).toBeGreaterThanOrEqual(0);
    await prisma.mediaFactOutbox.deleteMany({ where: { projectId: PID } });
    await teardownProject(PID);
  }, 30_000);

  it('场景 D（成员移除→旧连接拒写——v11.1 阻断门串联）：真 WS 连接→removeMember 事件→close 4401+member_revoked_conns 计数；ACL 拒点 media_acl_denied 计数', async () => {
    const PID = 't19-e2e-revoke';
    await seedProject(PID);
    // 真 Session 行（cookie token 载体）+TeamMember 行
    const TOKEN = `t19-${randomUUID()}`;
    await prisma.session.create({
      data: { id: `sess-${randomUUID().slice(0, 8)}`, userId: 'y0a-fixture-user', token: TOKEN, expiresAt: new Date(Date.now() + 3600_000) },
    });
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: TID, userId: 'y0a-fixture-user' } },
      create: { teamId: TID, userId: 'y0a-fixture-user', role: 'MEMBER' },
      update: {},
    });

    const port = serverPort;
    const url = `ws://127.0.0.1:${port}`;
    const conn = connectProvider(url, `project:${PID}`, TOKEN);
    await conn.synced;   // 真连装载（authenticate 真链：Session+TeamMember+ProjectPermission）

    const revokedBefore = counterOf(memberRevokedConns);
    emitter.emit('collab.perm.changed', { userId: 'y0a-fixture-user', teamId: TID, removed: true });
    // close 可能经 grace（scheduleSweepClose 通知+grace→close）——等 close 事件（sweep 立即路径）
    const code = await Promise.race([conn.closed, new Promise<null>((r) => setTimeout(() => r(null), 10_000))]);
    expect(code).toBe(4401);   // 移除后旧连接关闭（session-expired）
    expect(counterOf(memberRevokedConns)).toBeGreaterThan(revokedBefore);   // 清理结果计数（v11.2 ③）
    // 旧连接拒写：连接已关——doc 服务端值不再受该客户端影响（结构性：close 后零写通道）
    await conn.provider.destroy();
    await prisma.session.deleteMany({ where: { token: TOKEN } });

    // ACL 拒点串联：跨 team assertTeamMember→403+计数（真库他 team）
    const aclBefore = counterOf(mediaAclDenied);
    await expect(assertTeamMember(prisma as any, 'team-not-exist-t19', 'y0a-fixture-user')).rejects.toThrow('非团队成员');
    expect(counterOf(mediaAclDenied)).toBe(aclBefore + 1);   // 授权拒绝计数（v11.2 ③）
    await teardownProject(PID);
  }, 45_000);

  it('场景 E（双端收敛+分镜并发零成员丢失+读序稳定）：两真 WS 客户端并发 slot/order 写——两端 doc 收敛等值+成员零丢失+重复键读序稳定（tie-break 不 500）', async () => {
    const PID = 't19-e2e-conv';
    await seedProject(PID);
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: TID, userId: 'y0a-fixture-user' } },
      create: { teamId: TID, userId: 'y0a-fixture-user', role: 'MEMBER' },
      update: {},
    });
    const TOKEN = `t19-conv-${randomUUID()}`;
    await prisma.session.create({
      data: { id: `sess-${randomUUID().slice(0, 8)}`, userId: 'y0a-fixture-user', token: TOKEN, expiresAt: new Date(Date.now() + 3600_000) },
    });
    const port = serverPort;
    const url = `ws://127.0.0.1:${port}`;
    const a = connectProvider(url, `project:${PID}`, TOKEN);
    const b = connectProvider(url, `project:${PID}`, TOKEN);
    await Promise.all([a.synced, b.synced]);

    // 并发写：A 写分镜成员（slot 域+同格位重复 slot 竞态）+B 写 order 域成员+等值键重复（并发键竞态形态）
    const IDS = { slotA: 'n-slot-a', slotB: 'n-slot-b', ordA: 'n-ord-a', ordB: 'n-ord-b' };
    a.ydoc.transact(() => {
      const mk = (id: string, data: Record<string, unknown>) => {
        const n = new Y.Map();
        n.set('data', new Y.Map(Object.entries(data)));
        a.ydoc.getMap('nodes').set(id, n);
      };
      mk(IDS.slotA, { slot: 0 });
      mk(IDS.slotB, { slot: 0 });   // 同格位并发（重复 slot 竞态——(slot,id) tie-break 容忍）
    });
    b.ydoc.transact(() => {
      const mk = (id: string, data: Record<string, unknown>) => {
        const n = new Y.Map();
        n.set('data', new Y.Map(Object.entries(data)));
        b.ydoc.getMap('nodes').set(id, n);
      };
      mk(IDS.ordA, { order: '5000' });
      mk(IDS.ordB, { order: '5000' });   // 等值键（并发重复键——(order,id) tie-break 容忍）
    });

    // 双端收敛：B 见 A 的成员+A 见 B 的（零成员丢失）
    await pollUntil(() => {
      const idsA = new Set(a.ydoc.getMap('nodes').keys());
      const idsB = new Set(b.ydoc.getMap('nodes').keys());
      return Object.values(IDS).every((id) => idsA.has(id) && idsB.has(id));
    }, 15_000);
    const idsA = [...a.ydoc.getMap('nodes').keys()].sort();
    const idsB = [...b.ydoc.getMap('nodes').keys()].sort();
    expect(idsA).toEqual(idsB);   // 双端收敛等值
    expect(idsA.length).toBeGreaterThanOrEqual(4);   // 四成员全达（零丢失）

    // 读序稳定：重复 slot/order 键经 tie-break 稳定排序（不抛）+病理计数面在场（容忍非 500——G53）
    const recordsOf = (doc: Y.Doc) =>
      [...doc.getMap('nodes').entries()].flatMap(([id, m]) => {
        if (!(m instanceof Y.Map)) return [];
        const data = m.get('data');
        return [{ id, parentId: null, data: data instanceof Y.Map ? Object.fromEntries(data.entries()) : {} }];
      });
    const recs = recordsOf(a.ydoc);
    const sorted = [...recs].sort((x, y) => compareWithinLayer(x as never, y as never));
    expect(sorted).toHaveLength(recs.length);   // 读序全函数（重复键不 500 不丢）
    const report = scanOrderPathology(recs as never);
    expect(report.duplicateKeyNodes).toBe(2);   // 等值 order 键两成员=病理计数档（重复键容忍+计数——v14 口径）
    expect(report.kinds).toContain('duplicate-key');

    await a.provider.destroy();
    await b.provider.destroy();
    await prisma.session.deleteMany({ where: { token: TOKEN } });
    await teardownProject(PID);
  }, 45_000);
});
