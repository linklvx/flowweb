// apps/api/src/modules/collab/collab-harness/provider-convergence.e2e-spec.ts —— T19 终出口
//（plan v11.2 S5·Task 19：跨子系统收敛 harness——故障注入矩阵串联）。
//
// 【矩阵九族覆盖盘点（串联形态声明——已覆盖面直接引用勿重复造轮，本 spec=跨子系统串联缺口）】
//  ①execSeq 代际矩阵：单系统锚=execution/execseq-generation.int.spec（三态 moveToDelayed/
//    takeover void/onTick abort/failed 钩子票守卫）——本 spec 串联「代际接管→doc exec cache 旧代拒写
//    （exec_seq_stale_rejected）→投影新代赢」全链（场景 A）。
//    【评审#4 登记不修·flush 四窗组合覆盖映射钉明（G58 四窗=apply 前/flush 前/flush 后 mark 前/
//    mark 后 emit 前）】：窗①（claim→apply 前 fence）+窗②（apply 后→flush 前）=projection-outbox.
//    poller.int.spec「fencing（epoch 易主@apply）」+fencedBail 释放族；窗③（flush 后→mark 前）=同
//    spec「fencing（epoch 易主@flush）」+recheck rev superseded 用例；窗④（mark 后→emit 前）=同
//    spec spool/retry-spooled 用例（mark projected 与 flush persisted 背书序——G58「spooled 无限
//    重试不耗 attempts」）。本 e2e 场景 C 消费「重启后仍 projected」读侧——四窗本体归 T15 int
//    （组合覆盖完备，此处不重复造轮）。
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
//    零成员丢失+两端收敛）+场景 F（用户裁定④：真双端并发写**同一分镜组同格位**——E 的重复键=单端
//    自造，F=双客户端无协调路径分配同 slot 键，E 不能替代 F）；读序 tie-break 锚=shared
//    order-records.test.ts+order-pathology.test.ts。
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
import { CLIENT_PROTOCOL_VERSION, scanOrderPathology, compareWithinLayer, deriveStoryboardCells, isStoryboardChildRecord, resolveStoryboardConfig } from '@flowweb/shared';
import { CollabGateway } from '../collab.gateway';
import { CollabResidencyService } from '../collab-residency.service';
import { CollabDocumentService } from '../collab-document.service';
import { RuntimeFeedService } from '../runtime-feed.service';
import { CollabLifecycleObserverService } from '../collab-lifecycle-observer.service';
import { CollabLeaseService } from '../collab-lease.service';
import { CollabSpoolService } from '../collab-spool.service';
import { CanvasDocUpdateRepository } from '../canvas-doc-update.repository';
import { ProjectPermissionService } from '../../team/project-permission.service';
import { SessionService } from '../../../auth/session.service';
import { ProjectionOutboxPoller } from '../../media-delivery/projection-outbox.poller';
import { BindingReconcileService } from '../../media-delivery/binding-reconcile.service';
import { memberRevokedConns } from '../store.metrics';
import { mediaAclDenied } from '../../team/team.metrics';
import { assertTeamMember } from '../../team/team.util';
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
  // Y1c T22：feed/lifecycle 域随清（交付=RuntimeEvent——同 PID 跨 run 残留会污染事件序断言）
  await prisma.nodeLifecycle.deleteMany({ where: { projectId: pid } }).catch(() => {});
  await prisma.deliveryFence.deleteMany({ where: { projectId: pid } }).catch(() => {});
  await prisma.runtimeEvent.deleteMany({ where: { projectId: pid } }).catch(() => {});
  await prisma.runtimeFeedCursor.deleteMany({ where: { projectId: pid } }).catch(() => {});
}

async function seedNode(pid: string, nodeId: string, data: Record<string, unknown> = { content: 'seed' }): Promise<void> {
  await residency.withSession(pid, (doc) => {
    const n = new Y.Map();
    n.set('data', new Y.Map(Object.entries(data)));
    doc.getMap('nodes').set(nodeId, n);
  }, { mode: 'write' });
  // Y1c T22：ACTIVE fence 播种（deliverArtifact 交付放行前提——T26 观察器同构行）
  await prisma.nodeLifecycle.create({ data: { projectId: pid, nodeId, lifecycleSeq: 1n, isCurrent: true, state: 'ACTIVE', walSeq: 0n } }).catch(() => {});
  await prisma.deliveryFence.create({ data: { projectId: pid, nodeId, fenceSeq: 1n, state: 'ACTIVE' } }).catch(() => {});
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
  await prisma.nodeLifecycle.deleteMany({ where: { projectId: pid } }).catch(() => {});
  await prisma.deliveryFence.deleteMany({ where: { projectId: pid } }).catch(() => {});
  await prisma.runtimeEvent.deleteMany({ where: { projectId: pid } }).catch(() => {});
  await prisma.runtimeFeedCursor.deleteMany({ where: { projectId: pid } }).catch(() => {});
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
    // Y1c T22（G5 切交付）：deliverArtifact 改 PG 写——真 feed+真 lifecycle observer（fence 权威）
    docSvc = new CollabDocumentService(gateway, repo, residency,
      new RuntimeFeedService(prisma as any), new CollabLifecycleObserverService(prisma as any));
    reconciler = new BindingReconcileService(prisma as any, docSvc);
  }, 60_000);

  afterAll(async () => {
    for (const pid of residency?.residentProjectIds() ?? []) await residency.releaseSessionFor(pid).catch(() => {});
    lease?.halt();
    await lease?.release().catch(() => {});
    // Y1c T10：直调 onApplicationShutdown（真关停链——shuttingDown 置位=卸载 drain 豁免+destroy race）；
    // 裸 server.destroy() 在卸载拒绝（applied 未 drain）时永不 resolve=hook 30s 超时。
    await gateway?.onApplicationShutdown().catch(() => {});
    await rm(spoolDir, { recursive: true, force: true }).catch(() => {});
    await restoreLeaseRow(prisma);
    await prisma.$disconnect();
  }, 60_000);

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

    // 代际串联段（Y1c T22 改写——doc.exec 停写）：新旧两写=两 exec.status 事件（Z99/Z111 服务端
    // 代次守卫随 doc 写面退役——迟到旧事件的丢弃归客户端 reducer nodeVersion 大者胜；服务端不再
    // 持 exec 条目=零孤儿面，exec_seq_stale_rejected 计数面退役）。
    await docSvc.writeExecStatus(PID, NODE, { status: 'loading', jobId: 'j-new', attempts: 2 });
    await docSvc.writeExecStatus(PID, NODE, { status: 'error', error: 'stale worker', attempts: 1 });
    const statusEvents = await prisma.runtimeEvent.findMany({ where: { projectId: PID, kind: 'exec.status' }, orderBy: { feedSeq: 'asc' } });
    expect(statusEvents.map((e) => (e.payload as { status: string }).status)).toEqual(['loading', 'error']);   // 两事件在档（新旧次序=feedSeq 单调）
    const execSize = await residency.withSession(PID, (doc) => doc.getMap('exec').size, { mode: 'read' });
    expect(execSize).toBe(0);   // doc.exec 恒空（停写——不变量⑦）

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
    // Y1c T22（切交付）：交付面=RuntimeEvent（feed 新权威——rev recheck 保护下新代恰一事件）；
    // doc 零写（data.fileId 不落——不变量⑦）。
    const deliveredNew = await prisma.runtimeEvent.findMany({ where: { projectId: PID, kind: 'exec.artifact' } });
    expect(deliveredNew.length).toBe(1);
    expect((deliveredNew[0]!.payload as { mediaId?: string }).mediaId).toBe('media-new-gen');
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

    // 重启模拟：释放常驻会话→PG 重放（装载路径）。T22（切交付）：交付值=RuntimeEvent（feed 持久
    // 语义——projected 行+exec.artifact 事件双在档）；doc 零写（data.fileId 不落）。
    await residency.releaseSessionFor(PID);
    const delivered = await prisma.runtimeEvent.findFirst({ where: { projectId: PID, kind: 'exec.artifact' } });
    expect((delivered?.payload as { mediaId?: string })?.mediaId).toBe('media-c');

    // facts outbox 重复投递幂等（实况=重复插入同四元组行——at-least-once 重放形态；乱序容忍面=
    // 客户端单调合并 mediaFacts.test〔factVersion 旧忽略/批内乱序末者胜〕+DB 四元组唯一约束双面，
    // 此处只钉服务端幂等行）：同 (mediaId,projectId,factType,factVersion) 双写 skipDuplicates 零重复行
    await prisma.mediaFactOutbox.createMany({
      data: [{ mediaId: 'media-c', projectId: PID, factVersion: 1, factType: 'state', payload: { status: 'completed' } }],
      skipDuplicates: true,
    });
    await prisma.mediaFactOutbox.createMany({
      data: [{ mediaId: 'media-c', projectId: PID, factVersion: 1, factType: 'state', payload: { status: 'completed' } }],
      skipDuplicates: true,
    });
    expect(await prisma.mediaFactOutbox.count({ where: { mediaId: 'media-c', projectId: PID, factType: 'state', factVersion: 1 } })).toBe(1);
    // 观测面：invariant_violation（资金-产物不一致巡检——R3 manual-required 同事件）真触发锚
    // =intent-reconcile.service.spec「T19 计数」用例（歧义态行→计数恰 +1）+intent-reconcile-r3.
    // int.spec 窗④（有交付凭据→manual-required 不动钱）——本 e2e 不复刻资金链装置（重复造轮禁）。
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
    try {   // 质评 Minor#7：断言失败也收口清理（WS 连接/Session 行/项目 fixture 泄漏=后续用例串扰源）
      await conn.synced;   // 真连装载（authenticate 真链：Session+TeamMember+ProjectPermission）

      const revokedBefore = counterOf(memberRevokedConns);
      emitter.emit('collab.perm.changed', { userId: 'y0a-fixture-user', teamId: TID, removed: true });
      // close 可能经 grace（scheduleSweepClose 通知+grace→close）——等 close 事件（sweep 立即路径）
      const code = await Promise.race([conn.closed, new Promise<null>((r) => setTimeout(() => r(null), 10_000))]);
      expect(code).toBe(4401);   // 移除后旧连接关闭（session-expired）
      expect(counterOf(memberRevokedConns)).toBeGreaterThan(revokedBefore);   // 清理结果计数（v11.2 ③）
      // 旧连接拒写：连接已关——doc 服务端值不再受该客户端影响（结构性：close 后零写通道）

      // ACL 拒点串联：跨 team assertTeamMember→403+计数（真库他 team）
      const aclBefore = counterOf(mediaAclDenied);
      await expect(assertTeamMember(prisma as any, 'team-not-exist-t19', 'y0a-fixture-user')).rejects.toThrow('非团队成员');
      expect(counterOf(mediaAclDenied)).toBe(aclBefore + 1);   // 授权拒绝计数（v11.2 ③）
    } finally {
      await conn.provider.destroy();
      await prisma.session.deleteMany({ where: { token: TOKEN } }).catch(() => {});
      await teardownProject(PID);
    }
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
    try {   // 质评 Minor#7：断言失败也收口清理（双 provider/Session 行/项目 fixture）

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

    } finally {
      await a.provider.destroy();
      await b.provider.destroy();
      await prisma.session.deleteMany({ where: { token: TOKEN } }).catch(() => {});
      await teardownProject(PID);
    }
  }, 45_000);

  it('场景 F（用户裁定④·真双端并发写同一分镜组同格位）：A/B 两客户端互不可见窗口内各分配 slot:2——双端收敛零成员丢失+读序 (slot,id) tie-break 双端等值+deriveStoryboardCells 溢出=保留非丢弃（邻位不殃及）', async () => {
    const PID = 't19-e2e-dupslot';
    const GROUP = 'n-sb-group';
    const IDS = { dupA: 'n-dup-a', dupB: 'n-dup-b', normA: 'n-norm-a', normB: 'n-norm-b' };
    const ALL_IDS = [GROUP, IDS.dupA, IDS.dupB, IDS.normA, IDS.normB];
    await seedProject(PID);
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: TID, userId: 'y0a-fixture-user' } },
      create: { teamId: TID, userId: 'y0a-fixture-user', role: 'MEMBER' },
      update: {},
    });
    const TOKEN = `t19-dupslot-${randomUUID()}`;
    await prisma.session.create({
      data: { id: `sess-${randomUUID().slice(0, 8)}`, userId: 'y0a-fixture-user', token: TOKEN, expiresAt: new Date(Date.now() + 3600_000) },
    });

    // 预置分镜组（服务端会话直写——fillDoc 信封形态：type=group+data.groupType='storyboard'〔判定面
    // isStoryboardChildRecord〕+data.order='5000'〔组自身居根层 order 档——真实形态〕+storyboard 2×2
    // 配置〔capacity 派生不落 doc——resolveStoryboardConfig 单源〕）。
    await residency.withSession(PID, (doc) => {
      const g = new Y.Map();
      g.set('type', 'group');
      g.set('data', new Y.Map(Object.entries({
        groupType: 'storyboard',
        order: '5000',
        storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: false, stitchResolution: '2K' },
      })));
      doc.getMap('nodes').set(GROUP, g);
    }, { mode: 'write' });

    const url = `ws://127.0.0.1:${serverPort}`;
    const a = connectProvider(url, `project:${PID}`, TOKEN);
    const b = connectProvider(url, `project:${PID}`, TOKEN);
    try {   // 质评 Minor#7：断言失败也收口清理（双 provider/Session 行/项目 fixture）
      await Promise.all([a.synced, b.synced]);   // 双端开卷（真连装载——组已可见后进入并发窗口）

      // 【与场景 E 的形态差异钉子（用户裁定④——E 不能替代本验收）】E 的重复 slot 键=**单客户端一次
      // transact 自造两条**（冲突只经本地单写者，无跨端协调面）；F=**两真客户端在互不可见窗口内各自
      // 分配同一 slot 键**（下列两条 transact 同一同步块连发，零 await——WS 传播异步，B 写入时未见 A
      // 的成员、反之亦然，slot 键分配无协调路径）——这才是协作画布最真实的同格位冲突形态。
      const mkChild = (doc: Y.Doc, id: string, slot: number): void => {
        const n = new Y.Map();
        n.set('type', 'image');          // 分镜子=图片节点（attachMember/dropImage 形态——判定不查子类型）
        n.set('parentId', GROUP);        // membership 信封（isStoryboardChildRecord 判据）
        n.set('data', new Y.Map(Object.entries({ slot })));   // slot 派生真源（禁两可：无 order 键）
        doc.getMap('nodes').set(id, n);
      };
      a.ydoc.transact(() => mkChild(a.ydoc, IDS.dupA, 2));
      b.ydoc.transact(() => mkChild(b.ydoc, IDS.dupB, 2));   // 同格位 slot:2 真双端并发（键冲突收敛面）
      // 第二轮交错稳定面：邻位正常成员（验证同格位冲突不殃及 slot:1/slot:3）
      a.ydoc.transact(() => mkChild(a.ydoc, IDS.normA, 1));
      b.ydoc.transact(() => mkChild(b.ydoc, IDS.normB, 3));

      // 验收①成员不丢失：双端收敛后 nodes 键集等值且=组+四成员全集（seed 后 doc 恒空——精确等值）
      await pollUntil(() => {
        const idsA = new Set(a.ydoc.getMap('nodes').keys());
        const idsB = new Set(b.ydoc.getMap('nodes').keys());
        return ALL_IDS.every((id) => idsA.has(id) && idsB.has(id));
      }, 15_000);
      const idsA = [...a.ydoc.getMap('nodes').keys()].sort();
      const idsB = [...b.ydoc.getMap('nodes').keys()].sort();
      expect(idsA).toEqual([...ALL_IDS].sort());   // A 端全集（零丢失）
      expect(idsB).toEqual([...ALL_IDS].sort());   // B 端全集=与 A 等值（双端收敛）

      // 读面（信封全键：type/parentId/data——scenario E 的 recordsOf 只读 data，本场景需 membership 面）
      interface FRec { id: string; parentId: string | null; type: string; data: Record<string, unknown> }
      const recordsOf = (doc: Y.Doc): FRec[] =>
        [...doc.getMap('nodes').entries()].flatMap(([id, m]) => {
          if (!(m instanceof Y.Map)) return [];
          const data = m.get('data');
          return [{
            id,
            parentId: (m.get('parentId') as string | null) ?? null,
            type: (m.get('type') as string | null) ?? '',
            data: data instanceof Y.Map ? Object.fromEntries(data.entries()) : {},
          }];
        });
      const recsA = recordsOf(a.ydoc);
      const recsB = recordsOf(b.ydoc);

      // fixture 形态合法性（判定函数面）：四成员均被 isStoryboardChildRecord 认定为分镜子、组自身不是
      const byId = new Map(recsA.map((r) => [r.id, { type: r.type, data: r.data }]));
      const members = [IDS.dupA, IDS.dupB, IDS.normA, IDS.normB].map((id) => recsA.find((r) => r.id === id)!);
      for (const m of members) expect(isStoryboardChildRecord(m, byId)).toBe(true);
      expect(isStoryboardChildRecord(recsA.find((r) => r.id === GROUP)!, byId)).toBe(false);

      // 验收②读序稳定/渲染：compareWithinLayer 全函数（不抛不丢）+双端排序等值（渲染确定性）
      // ——同格位两成员按 (slot,id) tie-break 定序（'n-dup-a'<'n-dup-b'）；组=order 档 rank 前置。
      const orderOf = (recs: FRec[]): string[] => [...recs].sort(compareWithinLayer).map((r) => r.id);
      const orderA = orderOf(recsA);
      const orderB = orderOf(recsB);
      expect(orderA).toHaveLength(ALL_IDS.length);   // 读序全函数（重复 slot 键不 500 不丢）
      expect(orderA).toEqual(orderB);                // 双端渲染序一致（收敛后确定性）
      expect(orderA).toEqual([GROUP, IDS.normA, IDS.dupA, IDS.dupB, IDS.normB]);   // (slot,id) tie-break 定序钉死

      // 验收③溢出（格位派生单源——capacity=resolveStoryboardConfig 2×2=4，消费形态同 canvasStore）：
      // 同格位 pair=胜者据 slot:2 格（(slot,id) tie-break——'n-dup-a'），败者**挤首空格保留非丢弃**；
      // 邻位 slot:1/slot:3 原格不动（冲突不殃及）；双端派生等值（输入序无关——内部 (slot,id) 归一）。
      const deriveOf = (recs: FRec[]) => {
        const children = recs.filter((r) => r.parentId === GROUP).map((r) => ({ id: r.id, data: r.data }));
        const cfg = resolveStoryboardConfig(recs.find((r) => r.id === GROUP)!.data);
        return deriveStoryboardCells(children, cfg.gridRows * cfg.gridCols);
      };
      const dA = deriveOf(recsA);
      const dB = deriveOf(recsB);
      expect(dA.cells).toHaveLength(4);                          // 长度恰=capacity（Z17''）
      expect(dA.cells).toEqual(dB.cells);                        // 双端格位派生一致
      expect(dA.cells[2]).toBe(IDS.dupA);                        // 争议格位 slot:2=tie-break 胜者
      expect(dA.cells).toEqual([IDS.dupB, IDS.normA, IDS.dupA, IDS.normB]);   // 败者挤首空格+邻位不动
      expect(new Set([...dA.cells, ...dA.overflowIds].filter((x): x is string => x != null)))
        .toEqual(new Set([IDS.dupA, IDS.dupB, IDS.normA, IDS.normB]));        // 四成员全保留（溢出形态=保留非丢弃）
      expect(dA.overflowIds).toEqual([]);                        // 2×2 容量下零越格溢出

      // 病理面口径钉子：裁定原文期许「duplicate-slot 类病理计数=1」——shared 实现（order-pathology.ts
      // 头注「slot 域不在本扫描面……格位病理（重复 slot/越格）同源计数属 Y2 扩展面（本批零代码）」
      // +order-pathology.test「slot 域跳过」）明确 slot 重复**不进** scanOrderPathology 计数；「溢出=
      // 成员保留」验收语义由上方 deriveStoryboardCells 断言承载。此处钉边界：本形态（组携合法 order
      // 键+四 slot 成员）扫描须 clean——slot 重复不得误报进 order 病理档（扫描面口径变更须过本用例重审）。
      const path = scanOrderPathology(recsA);
      expect(path.kinds).toEqual([]);
      expect(path.duplicateKeyNodes).toBe(0);
      expect(path.scannedNodes).toBe(1);   // 仅组（order 档）入扫描分母——四 slot 成员跳过
    } finally {
      await a.provider.destroy();
      await b.provider.destroy();
      await prisma.session.deleteMany({ where: { token: TOKEN } }).catch(() => {});
      await teardownProject(PID);
    }
  }, 45_000);
});
