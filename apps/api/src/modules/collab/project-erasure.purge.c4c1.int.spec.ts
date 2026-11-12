// apps/api/src/modules/collab/project-erasure.purge.c4c1.int.spec.ts
// C4-c1（plan Task C4-3 ★红⑫⑬⑯+二扫并集+audit 补位——生产就绪收尾批·project-erasure）：PURGING_DB
// 执行体 int spec（真 PG——project-erasure.stages 消费面）。断言面：
//  ★二扫并集（spec 评审 P1 定形）：DRAINING manifest 采集后落新 Media 行（在飞 finalize 形态模拟）
//   →PURGING_DB 首步重扫取并集并重写 manifest（新行入册+DB 索引 sha 同步）——「DRAINING 前等待
//   在飞 intent 清算」备选不采的实证面；
//  ★红⑫ Media 三档：库资产（uploaded）→detach（projectId=NULL+清 nodeId/taskId）；他项目引用
//   （MediaBinding 他项目行）→detach；已发布作品引用（VideoWork.videoMediaId）→detach；独占
//   （generated 无引用）→两阶段复核（首扫标记 sidecar→跨 claim 周期复核仍独占才删 DB 行）；
//   **他引用矩阵**（评审 P1-1 补钉）：引用图八要素逐要素独立 fixture——VideoProject.data 深扫/
//   LightingTask.resultMediaId/VideoTrimTask source·output/VideoWork.coverKey/ObjectManifest claim/
//   NodeArtifact.mediaId 各一例 detach 断言（删行决策面=误删不可逆——逐要素变异保护）；
//  ★红⑬ VideoWork detach：canvasProjectId=NULL——作品行/视频键/计费（viewCount）保留+getProcessSnapshot
//   404+clone 404（video-work.service :370/clone-service :28 !canvasProjectId→NotFound 实证）；
//  ★红⑯ 列级机器断言（registry 全表）：擦除后除 allowlist（GenerationIntent 内容列全空+计费保留/
//   ExecutionRequest 计费行保留/AuditLog 谓词行保留且内容脱敏/VideoWork·Media detach 行）外零行；
//   注入残留行（RuntimeEvent）→断言红（违例文含模型名）；
//  ⑤ GenerationIntent scrub（resultText/gestureKey/resultRef→NULL+creditsConsumed 计费保留）+
//   ExecutionRequest 整行保留+桥表（ExecutionInput/ExecutionNodePlan/RefundObligation/ReconcileAction）删；
//  擦除动作 AuditLog 补位（openProjectErasure 单源——action='erase_project'）+幂等重复删零二行。
// 运行：DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { ErasureContextService } from './project-lock';
import { ProjectErasureRunPoller } from './project-erasure.poller';
import { readErasureManifest } from './project-erasure.manifest';
import {
  executePurgingDbStage, pendingMediaMarkerPath, type MediaRefsCollector,
} from './project-erasure.stages';
import { assertProjectErasureDbComplete, assertTeamErasureAuditContent } from './project-erasure.assert';
import { VideoWorkService } from '../video-work/video-work.service';
import { VideoWorkCloneService } from '../video-work/video-work-clone.service';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

maybe('C4-c1 ★红⑫⑬⑯ PURGING_DB 执行体（真 PG）', () => {
  const prisma = new PrismaClient();
  const prismaService = new PrismaService();
  const ledger = new CreditLedgerService(prismaService as never);
  /** collector stub：可控他项目 doc 扫描面（默认零引用——引用命中由 PG 快判面承载）。 */
  let stubRefs: string[] | null = [];
  const collector: MediaRefsCollector = async () => stubRefs;
  const poller = new ProjectErasureRunPoller(prismaService as never, ledger as never, new ErasureContextService(), collector);
  const stamp = Date.now().toString(36);
  const owner = `c4c1-owner-${stamp}`;
  const teamId = `c4c1-team-${stamp}`;
  let seq = 0;
  let manifestDir: string;
  /** 已建项目集（afterAll 清理面）。 */
  const projects: string[] = [];
  let execSeq = BigInt(Date.now());

  /** 富项目 fixture：registry 全表行集（断言面=红⑯ 全表清点）。 */
  const seedRichProject = async (opts: { withOtherProject?: boolean } = {}): Promise<string> => {
    const pid = `c4c1-p-${stamp}-${seq++}`;
    await prisma.canvasProject.create({ data: { id: pid, name: pid, teamId, userId: owner } });
    projects.push(pid);
    const media = (suffix: string, data: Record<string, unknown> = {}) => prisma.media.create({
      data: { id: `${pid}-m-${suffix}`, userId: owner, teamId, projectId: pid, bucket: 'flowai', key: `${pid}/${suffix}.bin`, originalName: suffix, mimeType: 'application/octet-stream', size: 10n, type: 'generated', ...data },
    });
    // 三档样本：lib=库资产（uploaded）；refb=他项目 binding 引用；work=作品 videoMediaId 引用；exc=独占
    await media('lib', { type: 'uploaded', nodeId: 'n-lib', taskId: 't-lib' });
    await media('refb');
    await media('workm');
    await media('exc');
    await prisma.videoWork.create({
      data: { id: `${pid}-w0`, title: 'w0', authorName: owner, videoKey: `${pid}/work.mp4`, coverKey: `${pid}/cover.jpg`, canvasProjectId: pid, videoMediaId: `${pid}-m-workm`, viewCount: 7 },
    });
    // 资金族：intent（内容列+计费列）+request/input/plan+refund/reconcile 桥
    const intent = await prisma.generationIntent.create({
      data: { projectId: pid, nodeId: 'n1', userId: owner, teamId, intentId: `it-${pid}`, kind: 'text', paramsHash: 'ph', creditCost: 3, creditsConsumed: 3, resultText: '机密产物正文', gestureKey: 'gk', resultRef: `${pid}-m-exc`, heartbeatAt: new Date(), deadlineAt: new Date(), idemKey: `idem-${pid}`, execSeq: execSeq++ },
    });
    const request = await prisma.executionRequest.create({
      data: { requestId: `rq-${pid}`, projectId: pid, generation: 1, historyId: 'h', docSeq: 1n, frozenDocSeq: 1n, userId: owner, teamId, kind: 'text', state: 'DONE', reservedCredit: 0, totalCredit: 3, planHash: 'a'.repeat(64), inputHash: 'b'.repeat(64), expiresAt: new Date(Date.now() + 3_600_000) },
    });
    await prisma.executionNodePlan.create({ data: { requestId: request.id, nodeId: 'n1', order: 0, type: 'text', paramsHash: 'ph' } });
    await prisma.executionInput.create({ data: { requestId: request.id, encoding: 'json+gzip', content: Buffer.from('x'), contentHash: 'c'.repeat(64), rawBytes: 1, storedBytes: 1, schemaVersion: 1, expiresAt: new Date() } });
    await prisma.refundObligation.create({ data: { intentRowId: intent.id, execSeq: 1n, reversesId: 'r1', creditAmount: 1, state: 'SETTLED' } });
    await prisma.reconcileAction.create({ data: { intentRowId: intent.id, action: 'settle-backfill' } });
    // registry 直列族
    await prisma.template.create({ data: { name: 'tpl', userId: owner, projectId: pid, teamId } });
    await prisma.lightingTask.create({ data: { userId: owner, nodeId: 'n1', projectId: pid, originalImageUrl: 'http://x/l.png', params: {}, teamId } });
    await prisma.runtimeFeedCursor.create({ data: { projectId: pid } });
    await prisma.docAuditEvent.create({ data: { id: `${pid}-dae`, projectId: pid, kind: 'admit', userId: owner } });
    await prisma.maintenanceOperation.create({ data: { maintenanceId: `${pid}-mo`, projectId: pid, stage: 'COMPLETED', status: 'DONE', sourceGeneration: 1, targetGeneration: 1, schemaVersion: 1, cutoffPgSeq: 1n, idempotencyKey: `${pid}-mo` } });
    await prisma.runtimeEvent.create({ data: { projectId: pid, generation: 1, feedSeq: 1n, kind: 'exec.status', payload: {} } });
    await prisma.nodeExecution.create({ data: { projectId: pid, nodeId: 'n1', generation: 1, execSeq: 1n, status: 'done' } });
    await prisma.executionOutbox.create({ data: { projectId: pid, generation: 1, businessKey: 'bk', kind: 'exec' } });
    await prisma.materializeRun.create({ data: { projectId: pid, nodeId: 'n1', expectedExecSeq: 1n, state: 'done' } });
    await prisma.nodeLifecycle.create({ data: { projectId: pid, nodeId: 'n1', lifecycleSeq: 1n, state: 'ACTIVE', walSeq: 1n } });
    await prisma.deliveryFence.create({ data: { projectId: pid, nodeId: 'n1', fenceSeq: 1n, state: 'ACTIVE' } });
    await prisma.lifecycleObligation.create({ data: { projectId: pid, nodeId: 'n1', kind: 'purge', walSeq: 1n } });
    await prisma.canvasDocCoalesced.create({ data: { projectId: pid, generation: 1, seq: 1n, updateHash: 'd'.repeat(64), sourceSeq: 1n, reason: 't30b-coalesced' } });
    await prisma.nodeArtifact.create({ data: { projectId: pid, nodeId: 'n1', teamId, targetField: 'result' } });
    await prisma.artifactProjection.create({ data: { artifactId: `${pid}-na`, artifactRev: 0, projectId: pid, nodeId: 'n1', targetField: 'result' } });
    await prisma.mediaBinding.create({ data: { mediaId: `${pid}-m-exc`, projectId: pid, nodeId: 'n1', teamId } });
    await prisma.canaryPin.create({ data: { projectId: pid, generation: 1, snapshotRev: 1n, stateSeq: 1n, pgSeqAt: 1n, hashVersion: 1, leaseUntil: new Date(), expiresAt: new Date() } });
    await prisma.collabCanaryCursor.create({ data: { projectId: pid, generation: 1, lastCheckedAt: new Date(), lastResult: 'ok', nextDueAt: new Date() } });
    await prisma.collabOpsGate.create({ data: { gate: 'compact', projectId: pid, state: 'OPEN' } });
    // 别名族
    await prisma.videoTrimTask.create({ data: { userId: owner, workflowId: pid, nodeId: 'n1', sourceFileId: `${pid}-m-lib`, startTime: 0, endTime: 1, teamId } });
    await prisma.videoSeparateTask.create({ data: { userId: owner, workflowId: pid, nodeId: 'n1', sourceFileId: `${pid}-m-lib`, teamId } });
    // FK Cascade 族样本（行删除级联面）
    await prisma.projectMember.create({ data: { projectId: pid, userId: owner, role: 'PROJECT_OWNER' } });
    await prisma.videoProject.create({ data: { teamId, userId: owner, workflowId: pid, sourceNodeId: 'n1', title: 'vp', data: {} } });
    // AuditLog 谓词行（保留+内容脱敏断言面——干净行：操作留痕非项目内容）
    await prisma.auditLog.create({ data: { operatorId: owner, operatorName: owner, teamId, targetType: 'PROJECT', targetId: pid, action: 'freeze_compact', beforeValue: { state: 'OPEN' }, afterValue: { state: 'FROZEN' } } });
    if (opts.withOtherProject) {
      const other = `c4c1-p-${stamp}-${seq++}`;
      await prisma.canvasProject.create({ data: { id: other, name: other, teamId, userId: owner } });
      projects.push(other);
      // 他项目 binding 引用 refb（本 scope 外的引用面——refb 应 detach 保留）
      await prisma.mediaBinding.create({ data: { mediaId: `${pid}-m-refb`, projectId: other, nodeId: 'n1', teamId } });
    }
    return pid;
  };

  /** tombstone+run（PENDING）——openProjectErasure 真路径（audit 补位断言面：erase_project 行）。 */
  const tombstone = async (pid: string, opts: { dryRun?: boolean } = {}): Promise<void> => {
    const { lockProject } = await import('./project-lock');
    const { openProjectErasure } = await import('./project-erasure');
    await prisma.$transaction(async (tx) => {
      await lockProject(tx as never, pid);   // 锁序①（openProjectErasure 契约：调用方事务首句）
      return openProjectErasure(tx as never, { projectId: pid, requestedBy: owner, dryRun: opts.dryRun });
    });
  };

  beforeAll(async () => {
    manifestDir = mkdtempSync(join(tmpdir(), 'c4c1-manifest-'));
    process.env.ERASURE_MANIFEST_DIR = manifestDir;
    await prisma.user.upsert({ where: { id: owner }, update: {}, create: { id: owner, name: owner, email: `${owner}@local.test`, emailVerified: true } });
    await prisma.team.create({ data: { id: teamId, name: 'c4c1-team', ownerId: owner } });
    await prisma.teamMember.create({ data: { teamId, userId: owner, role: 'OWNER' } });
  });

  afterAll(async () => {
    const pids = [...projects];
    await prisma.auditLog.deleteMany({ where: { targetId: { in: pids } } }).catch(() => undefined);
    await prisma.projectErasureRun.deleteMany({ where: { scopeId: { in: pids } } }).catch(() => undefined);
    // 语义清理（无 FK 族按 scope 维；detached media 行按 key 前缀）
    for (const pid of pids) {
      await prisma.$queryRawUnsafe(`DELETE FROM "ExecutionNodePlan" WHERE "requestId" IN (SELECT id FROM "ExecutionRequest" WHERE "projectId"='${pid}')`).catch(() => undefined);
      await prisma.$queryRawUnsafe(`DELETE FROM "ExecutionInput" WHERE "requestId" IN (SELECT id FROM "ExecutionRequest" WHERE "projectId"='${pid}')`).catch(() => undefined);
      await prisma.$queryRawUnsafe(`DELETE FROM "RefundObligation" WHERE "intentRowId" IN (SELECT id FROM "GenerationIntent" WHERE "projectId"='${pid}')`).catch(() => undefined);
      await prisma.$queryRawUnsafe(`DELETE FROM "ReconcileAction" WHERE "intentRowId" IN (SELECT id FROM "GenerationIntent" WHERE "projectId"='${pid}')`).catch(() => undefined);
    }
    await prisma.mediaBinding.deleteMany({ where: { projectId: { in: pids } } }).catch(() => undefined);
    await prisma.generationIntent.deleteMany({ where: { projectId: { in: pids } } }).catch(() => undefined);
    await prisma.executionRequest.deleteMany({ where: { projectId: { in: pids } } }).catch(() => undefined);
    await prisma.media.deleteMany({ where: { key: { startsWith: `c4c1-p-${stamp}` } } }).catch(() => undefined);
    await prisma.videoWork.deleteMany({ where: { id: { startsWith: `c4c1-p-${stamp}` } } }).catch(() => undefined);
    await prisma.videoProject.deleteMany({ where: { workflowId: { in: pids } } }).catch(() => undefined);
    // C4-c1 评审 P1-1 他引用矩阵：p-other 侧引用行（stage 只清 pid 维——他项目行须显式回收）
    await prisma.lightingTask.deleteMany({ where: { projectId: { in: pids } } }).catch(() => undefined);
    await prisma.videoTrimTask.deleteMany({ where: { workflowId: { in: pids } } }).catch(() => undefined);
    await prisma.nodeArtifact.deleteMany({ where: { projectId: { in: pids } } }).catch(() => undefined);
    await prisma.objectManifest.deleteMany({ where: { objectKey: { startsWith: `c4c1-p-${stamp}` } } }).catch(() => undefined);
    await prisma.projectMember.deleteMany({ where: { projectId: { in: pids } } }).catch(() => undefined);
    // C4-c1 质量评审 I-1：dryRun 用例零删除=16 张无 FK registry 表 fixture 留库（实证历次运行逐套
    // 累积——仅 RuntimeEvent 有 7d retention 兜底）；收敛用例行已随 stage 批删不泄漏，此处统一回收
    for (const m of ['RuntimeFeedCursor', 'DocAuditEvent', 'MaintenanceOperation', 'RuntimeEvent', 'NodeExecution',
      'ExecutionOutbox', 'MaterializeRun', 'NodeLifecycle', 'DeliveryFence', 'LifecycleObligation', 'CanvasDocCoalesced',
      'ArtifactProjection', 'CanaryPin', 'CollabCanaryCursor', 'CollabOpsGate'] as const) {
      await (prisma as unknown as Record<string, { deleteMany(a: unknown): Promise<unknown> }>)[m[0]!.toLowerCase() + m.slice(1)]!
        .deleteMany({ where: { projectId: { in: pids } } }).catch(() => undefined);
    }
    await prisma.videoSeparateTask.deleteMany({ where: { workflowId: { in: pids } } }).catch(() => undefined);
    await prisma.canvasProject.deleteMany({ where: { id: { in: pids } } }).catch(() => undefined);
    await prisma.teamMember.deleteMany({ where: { teamId } }).catch(() => undefined);
    await prisma.team.deleteMany({ where: { id: teamId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: owner } }).catch(() => undefined);
    rmSync(manifestDir, { recursive: true, force: true });
    await prisma.$disconnect();
    await prismaService.$disconnect().catch(() => undefined);
  }, 30_000);

  it('红⑫⑬⑯ 端到端：二扫并集→三档 detach/两阶段独占删→scrub/detach→批删→列级断言→PURGING_OBJECTS 即停', async () => {
    stubRefs = [];
    const pid = await seedRichProject({ withOtherProject: true });
    await tombstone(pid);
    await poller.tick();   // DRAINING→manifest→PURGING_DB 前置位
    let run = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeId: pid } });
    expect(run.state).toBe('PURGING_DB');
    const manifest0 = await readErasureManifest(run.manifestPath!);
    expect(manifest0.media.map((m) => m.id)).toHaveLength(4);
    // ★二扫并集：manifest 采集后新落 Media 行（在飞 finalize 形态）——PURGING_DB 首步应并入
    await prisma.media.create({
      data: { id: `${pid}-m-late`, userId: owner, teamId, projectId: pid, bucket: 'flowai', key: `${pid}/late.bin`, originalName: 'late', mimeType: 'application/octet-stream', size: 1n, type: 'generated' },
    });
    await poller.tick();   // PURGING_DB 执行体（首扫：标记独占 sidecar+detach/scrub/批删/行删——停 PURGING_DB 待复核）
    run = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeId: pid } });
    expect(run.state).toBe('PURGING_DB');   // 两阶段首扫=不前置位（复核窗内）
    // 并集 manifest：4+1 行全入册（late 行=二扫发现面）+DB 索引 sha 同步
    const manifest1 = await readErasureManifest(run.manifestPath!);
    expect(manifest1.media.map((m) => m.id).sort()).toEqual([`${pid}-m-exc`, `${pid}-m-late`, `${pid}-m-lib`, `${pid}-m-refb`, `${pid}-m-workm`]);
    expect(manifest1.footer.sha256).toBe(run.manifestSha256);
    expect(manifest1.work.map((w) => w.id)).toEqual([`${pid}-w0`]);   // detach 前采集在册（C4-c2 对象重放面）
    // ★红⑫ 三档：库资产/他引用/作品引用=detach（projectId=NULL+清 nodeId/taskId）；独占=留待复核
    const lib = await prisma.media.findUniqueOrThrow({ where: { id: `${pid}-m-lib` } });
    expect(lib.projectId).toBeNull();
    expect(lib.nodeId).toBeNull();   // detach 清 nodeId
    expect(lib.taskId).toBeNull();   // detach 清 taskId
    expect(lib.key).toBe(`${pid}/lib.bin`);   // 行对象保留（C4-c2 对象删除面不含 detach 行）
    expect((await prisma.media.findUniqueOrThrow({ where: { id: `${pid}-m-refb` } })).projectId).toBeNull();   // 他项目 binding 引用→detach
    expect((await prisma.media.findUniqueOrThrow({ where: { id: `${pid}-m-workm` } })).projectId).toBeNull();  // 作品 videoMediaId 引用→detach
    const exc = await prisma.media.findUniqueOrThrow({ where: { id: `${pid}-m-exc` } });
    expect(exc.projectId).toBe(pid);   // 独占=两阶段首扫标记未删
    const late = await prisma.media.findUniqueOrThrow({ where: { id: `${pid}-m-late` } });
    expect(late.projectId).toBe(pid);   // 二扫发现行同进独占集（sidecar 应含）
    const marker = JSON.parse(readFileSync(pendingMediaMarkerPath(manifestDir, run.erasureId), 'utf8')) as { mediaIds: string[] };
    expect([...marker.mediaIds].sort()).toEqual([`${pid}-m-exc`, `${pid}-m-late`]);
    // 复核窗内（sidecar markAt 未跨 claim 周期）：再跑 stage 仍不删（两阶段语义——标记与删除不得同窗）
    const inWindow = await executePurgingDbStage({ prisma: prismaService, run, collectMediaRefs: collector, manifestDir, spoolDir: join(process.cwd(), '.data', 'collab-spool') });
    expect(inWindow).toEqual({ outcome: 'pending-review', remainingExclusive: 2, docScanFailed: false });
    expect(await prisma.media.count({ where: { id: { in: [`${pid}-m-exc`, `${pid}-m-late`] }, projectId: pid } })).toBe(2);   // 独占行未删
    // ★红⑬ VideoWork detach：行保留（视频键/计费）+canvasProjectId=NULL
    const w0 = await prisma.videoWork.findUniqueOrThrow({ where: { id: `${pid}-w0` } });
    expect(w0.canvasProjectId).toBeNull();
    expect(w0.videoKey).toBe(`${pid}/work.mp4`);
    expect(w0.viewCount).toBe(7);
    expect(w0.videoMediaId).toBe(`${pid}-m-workm`);   // 作品引用面原样（被引 media detach 保留）
    // /process 404+clone 404（:370/:28 !canvasProjectId→NotFound 实证——产品裁定 2026-11-05）
    const workService = new VideoWorkService(prismaService as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    await expect(workService.getProcessSnapshot(`${pid}-w0`)).rejects.toBeInstanceOf(NotFoundException);
    const cloneService = new VideoWorkCloneService(prismaService as never, {} as never, {} as never, { checkUserRateLimit: async () => true } as never);
    await expect(cloneService.clone(`${pid}-w0`, owner)).rejects.toBeInstanceOf(NotFoundException);
    // ⑤ scrub+计费保留+ExecutionRequest 保留+桥删
    const intent = await prisma.generationIntent.findFirstOrThrow({ where: { projectId: pid } });
    expect(intent.resultText).toBeNull();
    expect(intent.gestureKey).toBeNull();
    expect(intent.resultRef).toBeNull();
    expect(intent.creditCost).toBe(3);
    expect(intent.creditsConsumed).toBe(3);   // 计费列保留
    const request = await prisma.executionRequest.findFirstOrThrow({ where: { projectId: pid } });   // allowlist 计费行整行保留
    expect(request.totalCredit).toBe(3);
    expect(await prisma.executionNodePlan.count({ where: { requestId: request.id } })).toBe(0);   // 桥删
    expect(await prisma.executionInput.count({ where: { requestId: request.id } })).toBe(0);
    expect(await prisma.refundObligation.count({ where: { intentRowId: intent.id } })).toBe(0);
    expect(await prisma.reconcileAction.count({ where: { intentRowId: intent.id } })).toBe(0);
    // 批删族抽查（Template 显式删/registry 直列/FK Cascade）
    expect(await prisma.template.count({ where: { projectId: pid } })).toBe(0);
    expect(await prisma.runtimeEvent.count({ where: { projectId: pid } })).toBe(0);
    expect(await prisma.collabOpsGate.count({ where: { projectId: pid } })).toBe(0);
    expect(await prisma.videoTrimTask.count({ where: { workflowId: pid } })).toBe(0);
    expect(await prisma.projectMember.count({ where: { projectId: pid } })).toBe(0);   // FK Cascade（行删除级联）
    expect(await prisma.videoProject.count({ where: { workflowId: pid } })).toBe(0);
    expect(await prisma.canvasProject.count({ where: { id: pid } })).toBe(0);   // 行本体已删
    // 擦除动作 AuditLog：单行在册（补位）+谓词行保留（freeze_compact 行未删）
    const audits = await prisma.auditLog.findMany({ where: { targetType: 'PROJECT', targetId: pid } });
    expect(audits.filter((a) => a.action === 'erase_project')).toHaveLength(1);
    expect(audits.filter((a) => a.action === 'freeze_compact')).toHaveLength(1);   // 谓词行保留（操作留痕）
    // 幂等重复删：活跃 run 存在→同 run 零二行（openProjectErasure 幂等档不走 audit 二次落）
    // —— 已由 tombstone 直建，此处断 run 单行
    expect(await prisma.projectErasureRun.count({ where: { scopeId: pid } })).toBe(1);
    // 复核窗跨越（sidecar markAt 置过——跨 claim 周期形态）→独占复核删+前置位
    const markerPath = pendingMediaMarkerPath(manifestDir, run.erasureId);
    const aged = { ...(JSON.parse(readFileSync(markerPath, 'utf8')) as { markAt: string }), markAt: new Date(Date.now() - 120_000).toISOString() };
    const { writeFile } = await import('node:fs/promises');
    await writeFile(markerPath, `${JSON.stringify(aged)}\n`, 'utf8');
    const result = await executePurgingDbStage({ prisma: prismaService, run, collectMediaRefs: collector, manifestDir, spoolDir: join(process.cwd(), '.data', 'collab-spool') });
    expect(result).toEqual({ outcome: 'purging-objects' });
    expect(await prisma.media.count({ where: { id: { in: [`${pid}-m-exc`, `${pid}-m-late`] } } })).toBe(0);   // 独占行删（复核后）
    expect(existsSync(markerPath)).toBe(false);   // sidecar 收敛移除
    run = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeId: pid } });
    expect(run.state).toBe('PURGING_OBJECTS');   // ★即停（对象/Redis 归 C4-c2）
    expect(run.stage).toBe('PURGING_DB');
    // detach 行零复活（复核 tick 不回写 projectId）
    expect((await prisma.media.findUniqueOrThrow({ where: { id: `${pid}-m-lib` } })).projectId).toBeNull();
    // ★红⑯ 绿证：registry 全表清点零违例（forbidden=介质键族——AuditLog 脱敏断言含）
    const forbidden = [`${pid}/lib.bin`, `${pid}/work.mp4`, `${pid}/cover.jpg`];
    const assertion = await assertProjectErasureDbComplete(prisma as never, pid, { forbiddenContent: forbidden });
    expect(assertion.violations).toEqual([]);
    expect(assertion.ok).toBe(true);
  }, 60_000);

  it('红⑯ 负证：注入残留行（RuntimeEvent）→断言红（违例文含模型名）；AuditLog 内容列含被擦键→脱敏违例', async () => {
    const pid = await seedRichProject();
    await tombstone(pid);
    await poller.tick();   // DRAINING
    await poller.tick();   // PURGING_DB（首扫——team 仅本项目=doc 扫描跳过档）
    let run = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeId: pid } });
    // 复核窗跨越（本项目 team 零他项目→独占直接可删——sidecar aged 重写）
    const markerPath = pendingMediaMarkerPath(manifestDir, run.erasureId);
    if (existsSync(markerPath)) {
      const aged = { ...(JSON.parse(readFileSync(markerPath, 'utf8')) as { markAt: string }), markAt: new Date(Date.now() - 120_000).toISOString() };
      const { writeFile } = await import('node:fs/promises');
      await writeFile(markerPath, `${JSON.stringify(aged)}\n`, 'utf8');
    }
    await executePurgingDbStage({ prisma: prismaService, run, collectMediaRefs: collector, manifestDir, spoolDir: join(process.cwd(), '.data', 'collab-spool') });
    run = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeId: pid } });
    expect(run.state).toBe('PURGING_OBJECTS');
    // 注入残留行 → 断言红
    await prisma.runtimeEvent.create({ data: { projectId: pid, generation: 1, feedSeq: 9n, kind: 'exec.status', payload: {} } });
    const bad = await assertProjectErasureDbComplete(prisma as never, pid, { forbiddenContent: [] });
    expect(bad.ok).toBe(false);
    expect(bad.violations.some((v) => v.includes('RuntimeEvent'))).toBe(true);
    await prisma.runtimeEvent.deleteMany({ where: { projectId: pid } });
    // GenerationIntent 内容列未 scrub → 断言红（allowlist 内容列全空）
    const gi = await prisma.generationIntent.findFirst({ where: { projectId: pid } });
    if (gi) {
      await prisma.generationIntent.update({ where: { id: gi.id }, data: { resultText: '残留正文' } });
      const scrubBad = await assertProjectErasureDbComplete(prisma as never, pid, { forbiddenContent: [] });
      expect(scrubBad.ok).toBe(false);
      expect(scrubBad.violations.some((v) => v.includes('GenerationIntent'))).toBe(true);
      await prisma.generationIntent.update({ where: { id: gi.id }, data: { resultText: null } });
    }
    // AuditLog 谓词行内容列含被擦内容（介质键）→脱敏违例
    await prisma.auditLog.create({ data: { operatorId: owner, operatorName: owner, teamId, targetType: 'PROJECT', targetId: pid, action: 'leaky_action', afterValue: { key: `${pid}/lib.bin` } } });
    const leaky = await assertProjectErasureDbComplete(prisma as never, pid, { forbiddenContent: [`${pid}/lib.bin`] });
    expect(leaky.ok).toBe(false);
    expect(leaky.violations.some((v) => v.includes('AuditLog'))).toBe(true);
    await prisma.auditLog.deleteMany({ where: { targetId: pid, action: 'leaky_action' } });
    // team 维断言（PURGING_TEAM 阶段消费面）：干净行零违例
    const teamOk = await assertTeamErasureAuditContent(prisma as never, teamId, []);
    expect(teamOk.ok).toBe(true);
    await prisma.auditLog.create({ data: { operatorId: owner, operatorName: owner, teamId, targetType: 'TEAM', targetId: teamId, action: 'leaky_team', afterValue: { key: `${pid}/work.mp4` } } });
    const teamBad = await assertTeamErasureAuditContent(prisma as never, teamId, [`${pid}/work.mp4`]);
    expect(teamBad.ok).toBe(false);
    await prisma.auditLog.deleteMany({ where: { targetId: teamId, action: 'leaky_team' } });
  }, 60_000);

  it('红⑫ fail-closed：doc 扫描不可达（collector=null）→独占判别暂停（不删/不前置位）；恢复后收敛', async () => {
    const pid = await seedRichProject({ withOtherProject: true });   // 他项目在=doc 扫描必经
    await tombstone(pid);
    await poller.tick();   // DRAINING
    stubRefs = null;       // ★api 不可达形态
    await poller.tick();   // PURGING_DB 首扫：fail-closed
    const run = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeId: pid } });
    expect(run.state).toBe('PURGING_DB');   // 不前置位
    expect(await prisma.media.count({ where: { projectId: pid, type: 'generated' } })).toBe(3);   // 独占零删（refb/workm/exc——fail-closed 只停独占删除）
    expect(await prisma.canvasProject.count({ where: { id: pid } })).toBe(0);   // 批删/行删照常推进（fail-closed 只停独占删除）
    // 恢复（api 回达=stub 引用面）：直接执行体收敛
    stubRefs = [];
    const res1 = await executePurgingDbStage({ prisma: prismaService, run, collectMediaRefs: collector, manifestDir, spoolDir: join(process.cwd(), '.data', 'collab-spool') });
    expect(res1.outcome).toBe('pending-review');   // 首扫标记（恢复后窗重起——保守方向）
    const markerPath = pendingMediaMarkerPath(manifestDir, run.erasureId);
    const aged = { ...(JSON.parse(readFileSync(markerPath, 'utf8')) as { markAt: string }), markAt: new Date(Date.now() - 120_000).toISOString() };
    const { writeFile } = await import('node:fs/promises');
    await writeFile(markerPath, `${JSON.stringify(aged)}\n`, 'utf8');
    const res2 = await executePurgingDbStage({ prisma: prismaService, run, collectMediaRefs: collector, manifestDir, spoolDir: join(process.cwd(), '.data', 'collab-spool') });
    expect(res2).toEqual({ outcome: 'purging-objects' });
    expect(await prisma.media.count({ where: { projectId: pid } })).toBe(0);
    expect((await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeId: pid } })).state).toBe('PURGING_OBJECTS');
  }, 60_000);

  it('红⑫ 他引用矩阵：引用图八要素逐要素 detach（tier-b）——变异保护面（评审 P1-1 补钉）', async () => {
    stubRefs = [];   // doc 扫描零引用——tier-b 全部由 PG 快判面承载（逐要素独立命中）
    const pid = `c4c1-p-${stamp}-${seq++}`;
    const other = `c4c1-p-${stamp}-${seq++}`;
    await prisma.canvasProject.create({ data: { id: pid, name: 'matrix', teamId, userId: owner } });
    await prisma.canvasProject.create({ data: { id: other, name: 'matrix-other', teamId, userId: owner } });
    projects.push(pid, other);
    // 七候选全 generated（非库资产档）——各自仅被一种引用面命中（逐要素独立归因）
    const mk = (suffix: string, extra: Record<string, unknown> = {}) => prisma.media.create({
      data: { id: `${pid}-m-${suffix}`, userId: owner, teamId, projectId: pid, bucket: 'flowai', key: `${pid}/${suffix}.bin`, originalName: suffix, mimeType: 'application/octet-stream', size: 1n, type: 'generated', ...extra },
    });
    await mk('vp');                                                    // ① VideoProject.data 深扫
    await mk('light');                                                 // ② LightingTask.resultMediaId
    await mk('tsrc');                                                  // ③a VideoTrimTask.sourceFileId
    await mk('tout');                                                  // ③b VideoTrimTask.outputFileId
    await mk('cover');                                                 // ④ VideoWork.coverKey（键引用面）
    await mk('claim', { objectKey: `${pid}/claim-ref.obj` });          // ⑤ ObjectManifest claim 在位
    await mk('art');                                                   // ⑥ NodeArtifact.mediaId
    // ① 他项目 VideoProject.data 深扫（mediaId 词形**仅深嵌位**——顶层无：collectJsonMediaIds 递归实证）
    await prisma.videoProject.create({
      data: { teamId, userId: owner, workflowId: other, sourceNodeId: 'n-vp', title: 'other-vp',
        data: { timeline: { tracks: [{ clips: [{ meta: { layers: [{ mediaId: `${pid}-m-vp` }] } }] }] } } },
    });
    // ② 他项目 LightingTask.resultMediaId（projectId≠pid）
    await prisma.lightingTask.create({ data: { userId: owner, nodeId: 'n-lt', projectId: other, originalImageUrl: 'http://x/l.png', params: {}, resultMediaId: `${pid}-m-light`, teamId } });
    // ③ 他项目 VideoTrimTask source/output（workflowId≠pid——同 fixture 双写触发两谓词）
    await prisma.videoTrimTask.create({ data: { userId: owner, workflowId: other, nodeId: 'n-tt', sourceFileId: `${pid}-m-tsrc`, outputFileId: `${pid}-m-tout`, startTime: 0, endTime: 1, teamId } });
    // ④ 他项目作品 coverKey 命中候选键（cover-ref 键=videoWork.coverKey 字面值）
    await prisma.videoWork.create({ data: { id: `c4c1-p-${stamp}-other-w`, title: 'ow', authorName: owner, videoKey: `${other}/ow.mp4`, coverKey: `${pid}/cover.bin`, canvasProjectId: other } });
    // ⑤ 在位 ObjectManifest claim（claimUntil 未过期——在飞物化保守保留）
    await prisma.objectManifest.create({ data: { objectKey: `${pid}/claim-ref.obj`, claimOwner: 'materialize-inflight', claimUntil: BigInt(Date.now() + 60_000), state: 'LIVE' } });
    // ⑥ 他项目 NodeArtifact.mediaId
    await prisma.nodeArtifact.create({ data: { projectId: other, nodeId: 'n-na', teamId, targetField: 'fileId', mediaId: `${pid}-m-art` } });
    // 全 pipeline：tombstone→DRAINING→执行体（七候选全 tier-b ⇒ 零独占 ⇒ 同 tick detach+批删+断言+前置位）
    await tombstone(pid);
    await poller.tick();
    await poller.tick();
    // 逐要素断言先行（行在册未删+projectId=NULL——**独立归因**：变异破任一引用面 ⇒ 对应行漏进
    // 独占集 ⇒ 该行断言先红；state 断言殿后作整档门）
    const detached = (id: string) => prisma.media.findUniqueOrThrow({ where: { id } }).then((m) => {
      expect(m.projectId).toBeNull();
      expect(m.key).toContain(`${pid}/`);   // 行对象保留
    });
    await detached(`${pid}-m-vp`);     // ① VideoProject.data 深扫
    await detached(`${pid}-m-light`);  // ② LightingTask.resultMediaId
    await detached(`${pid}-m-tsrc`);   // ③a VideoTrimTask.sourceFileId
    await detached(`${pid}-m-tout`);   // ③b VideoTrimTask.outputFileId
    await detached(`${pid}-m-cover`);  // ④ VideoWork.coverKey
    await detached(`${pid}-m-claim`);  // ⑤ ObjectManifest claim
    await detached(`${pid}-m-art`);    // ⑥ NodeArtifact.mediaId
    expect(await prisma.media.count({ where: { id: { startsWith: `${pid}-m-` } } })).toBe(7);   // 零删（tier-b 全保留）
    const run = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeId: pid } });
    expect(run.state).toBe('PURGING_OBJECTS');   // 零独占=零 sidecar（变异 ⇒ 漏进独占集 ⇒ 滞留 PURGING_DB——整档门）
    // 引用行原样（他项目面不被擦除波及）
    expect(await prisma.lightingTask.count({ where: { projectId: other } })).toBe(1);
    expect(await prisma.videoTrimTask.count({ where: { workflowId: other } })).toBe(1);
    expect(await prisma.nodeArtifact.count({ where: { projectId: other } })).toBe(1);
    expect(await prisma.objectManifest.count({ where: { objectKey: `${pid}/claim-ref.obj` } })).toBe(1);
  }, 60_000);

  it('dryRun：走完整流程（二扫/判别）零写——不删行不 scrub 不改状态', async () => {
    const pid = await seedRichProject();
    // dryRun run 直建 PURGING_DB 前置位（poller 不消费 dryRun——完整 DRY_RUN 语义归 C4-c2）
    const inputs = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "Media" WHERE "projectId" = ${pid}::text`;
    const { writeErasureManifest } = await import('./project-erasure.manifest');
    const manifest = await writeErasureManifest({
      erasureId: `c4c1-dry-${pid}`, scopeType: 'project', scopeId: pid, projectIds: [pid],
      requestedAt: new Date(), mediaRows: [], workRows: [], spoolSegs: [],
    }, manifestDir);
    const run = await prisma.projectErasureRun.create({
      data: { erasureId: `c4c1-dry-${pid}`, scopeType: 'project', scopeId: pid, requestedBy: owner, state: 'PURGING_DB', dryRun: true, manifestPath: manifest.manifestPath, manifestSha256: manifest.manifestSha256 },
    });
    const before = await prisma.media.count({ where: { projectId: pid } });
    expect(before).toBe(inputs.length);
    const res = await executePurgingDbStage({ prisma: prismaService, run, collectMediaRefs: collector, manifestDir, spoolDir: join(process.cwd(), '.data', 'collab-spool') });
    expect(res).toEqual({ outcome: 'dry-run', detach: 2, exclusive: 2, docScanFailed: false });   // 判别跑全（lib=uploaded+workm=作品引用→detach 档；refb/exc→独占档）零写
    // 零写面：行集/内容列/状态/manifest 全原样
    expect(await prisma.media.count({ where: { projectId: pid } })).toBe(before);
    expect(await prisma.canvasProject.count({ where: { id: pid } })).toBe(1);
    expect(await prisma.template.count({ where: { projectId: pid } })).toBe(1);
    const gi = await prisma.generationIntent.findFirstOrThrow({ where: { projectId: pid } });
    expect(gi.resultText).toBe('机密产物正文');   // scrub 跳过
    expect((await prisma.projectErasureRun.findUniqueOrThrow({ where: { erasureId: run.erasureId } })).state).toBe('PURGING_DB');
    expect(existsSync(pendingMediaMarkerPath(manifestDir, run.erasureId))).toBe(false);   // sidecar 零写
    // 二扫并集=完整流程面（采集非删除——manifest 增补照做：dryRun 语义=「介质删除跳过含 DB 行删除」）；
    // DB 行集/内容列/状态零触碰（上方断言）＝「跳过一切删除与 scrub 写」字面。
    const manifestAfter = await readErasureManifest(manifest.manifestPath);
    expect(manifestAfter.footer.rows.media).toBe(4);   // live 4 行并入册（collect 完整流程）
    expect(manifestAfter.footer.rows.work).toBe(1);
  }, 60_000);
});
