// apps/api/src/modules/collab/project-erasure.kill9.c4c1.int.spec.ts
// C4-c1（plan Task C4-3 ★红⑪——生产就绪收尾批·project-erasure）：PURGING_DB kill -9 各内步幂等
// 收敛（真 PG）。kill -9 形态模拟=分步调用 stage 导出的内步函数后「中断」（进程内等价——各内步
// 与执行体逐字同源，断言面=重跑收敛而非信号语义）。断言面：
//  ①二扫后 kill：并集 manifest 已重写、批删未起 → 重跑收敛 PURGING_OBJECTS（late 行入册且删）；
//  ②批删中途 kill：批二部分表已删（Template/RuntimeEvent/VideoTrimTask 先删、余表在）→ 重跑
//   收敛（全表清点零残留+零双删——audit 行恰 1/detach 行不重复动）；
//  ③scrub 后 kill：intent 内容列已置 NULL、行删未起 → 重跑收敛；
//  ④lease 过期他实例重认领（C4-b claim 谓词不破坏）：claimOwner=他实例∧leaseUntil 过去 → tick
//   重认领推进至 PURGING_OBJECTS。
// 全链「resume 到 DONE」锚归 C4-c2（本批止步 PURGING_OBJECTS 前置位）。
// 运行：DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { ErasureContextService, lockProject } from './project-lock';
import { openProjectErasure } from './project-erasure';
import { ProjectErasureRunPoller } from './project-erasure.poller';
import { readErasureManifest, writeErasureManifest, collectSpoolSegments } from './project-erasure.manifest';
import {
  executePurgingDbStage, rescanProjectMediaWork, unionManifestRows, pendingMediaMarkerPath,
  type MediaRefsCollector,
} from './project-erasure.stages';
import { assertProjectErasureDbComplete } from './project-erasure.assert';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

maybe('C4-c1 ★红⑪ PURGING_DB kill -9 各内步幂等收敛（真 PG）', () => {
  const prisma = new PrismaClient();
  const prismaService = new PrismaService();
  const ledger = new CreditLedgerService(prismaService as never);
  const collector: MediaRefsCollector = async () => [];   // stub：零他项目 doc 引用
  const poller = new ProjectErasureRunPoller(prismaService as never, ledger as never, new ErasureContextService(), collector);
  const stamp = Date.now().toString(36);
  const owner = `c4c1k9-owner-${stamp}`;
  const teamId = `c4c1k9-team-${stamp}`;
  const spoolDir = join(process.cwd(), '.data', 'collab-spool');
  let seq = 0;
  let manifestDir: string;
  const projects: string[] = [];
  let execSeq = BigInt(Date.now());

  const seedProject = async (): Promise<string> => {
    const pid = `c4c1k9-p-${stamp}-${seq++}`;
    await prisma.canvasProject.create({ data: { id: pid, name: pid, teamId, userId: owner } });
    projects.push(pid);
    for (const s of ['lib', 'exc1', 'exc2']) {
      await prisma.media.create({
        data: { id: `${pid}-m-${s}`, userId: owner, teamId, projectId: pid, bucket: 'flowai', key: `${pid}/${s}.bin`, originalName: s, mimeType: 'application/octet-stream', size: 1n, type: s === 'lib' ? 'uploaded' : 'generated' },
      });
    }
    await prisma.videoWork.create({ data: { id: `${pid}-w0`, title: 'w', authorName: owner, videoKey: `${pid}/work.mp4`, canvasProjectId: pid } });
    const intent = await prisma.generationIntent.create({
      data: { projectId: pid, nodeId: 'n1', userId: owner, teamId, intentId: `it-${pid}`, kind: 'text', paramsHash: 'ph', creditCost: 2, creditsConsumed: 2, resultText: '正文', gestureKey: 'gk', resultRef: 'ref', heartbeatAt: new Date(), deadlineAt: new Date(), idemKey: `idem-${pid}`, execSeq: execSeq++ },
    });
    await prisma.refundObligation.create({ data: { intentRowId: intent.id, execSeq: 1n, reversesId: 'r', creditAmount: 1, state: 'SETTLED' } });
    await prisma.template.create({ data: { name: 'tpl', userId: owner, projectId: pid, teamId } });
    await prisma.runtimeEvent.create({ data: { projectId: pid, generation: 1, feedSeq: 1n, kind: 'exec.status', payload: {} } });
    await prisma.videoTrimTask.create({ data: { userId: owner, workflowId: pid, nodeId: 'n1', sourceFileId: `${pid}-m-lib`, startTime: 0, endTime: 1, teamId } });
    await prisma.projectMember.create({ data: { projectId: pid, userId: owner, role: 'PROJECT_OWNER' } });
    await prisma.auditLog.create({ data: { operatorId: owner, operatorName: owner, teamId, targetType: 'PROJECT', targetId: pid, action: 'note', afterValue: { note: 'op-trace' } } });
    return pid;
  };

  /** DRAINING→PURGING_DB 前置位（tick 真 poller 面）。 */
  const toPurgingDb = async (pid: string): Promise<{ erasureId: string; manifestPath: string }> => {
    await prisma.$transaction(async (tx) => {
      await lockProject(tx as never, pid);
      return openProjectErasure(tx as never, { projectId: pid, requestedBy: owner });
    });
    await poller.tick();   // DRAINING+manifest+PURGING_DB
    const run = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeId: pid } });
    expect(run.state).toBe('PURGING_DB');
    return { erasureId: run.erasureId, manifestPath: run.manifestPath! };
  };

  /** 跨复核窗（sidecar markAt 置 120s 前——「下一轮 tick 跨 claim 周期」形态）。 */
  const ageSidecar = async (erasureId: string): Promise<void> => {
    const p = pendingMediaMarkerPath(manifestDir, erasureId);
    if (!existsSync(p)) return;
    const aged = { ...(JSON.parse(readFileSync(p, 'utf8')) as { markAt: string }), markAt: new Date(Date.now() - 120_000).toISOString() };
    const { writeFile } = await import('node:fs/promises');
    await writeFile(p, `${JSON.stringify(aged)}\n`, 'utf8');
  };

  /** 收敛断言（全链到 PURGING_OBJECTS 前置位+列级断言绿+audit 恰 1+零双删形态）。 */
  const expectConverged = async (pid: string, erasureId: string): Promise<void> => {
    const run = await prisma.projectErasureRun.findUniqueOrThrow({ where: { erasureId } });
    expect(run.state).toBe('PURGING_OBJECTS');   // 收敛到前置位（对象/Redis 归 C4-c2）
    expect(run.stage).toBe('PURGING_DB');
    const assertion = await assertProjectErasureDbComplete(prisma as never, pid, { forbiddenContent: [`${pid}/lib.bin`, `${pid}/work.mp4`] });
    expect(assertion.violations).toEqual([]);   // 零残留（registry 全表清点）
    expect(await prisma.media.count({ where: { projectId: pid } })).toBe(0);   // exc 独占已删+lib detach NULL
    // 零双删/零复活形态：擦除动作 audit 恰 1 行；detach 行不重复动（projectId 仍 NULL）
    expect((await prisma.auditLog.findMany({ where: { targetType: 'PROJECT', targetId: pid, action: 'erase_project' } })).length).toBe(1);
    const lib = await prisma.media.findUniqueOrThrow({ where: { id: `${pid}-m-lib` } });
    expect(lib.projectId).toBeNull();
    const w0 = await prisma.videoWork.findUniqueOrThrow({ where: { id: `${pid}-w0` } });
    expect(w0.canvasProjectId).toBeNull();
    expect(existsSync(pendingMediaMarkerPath(manifestDir, erasureId))).toBe(false);   // sidecar 收敛移除
  };

  beforeAll(async () => {
    manifestDir = mkdtempSync(join(tmpdir(), 'c4c1k9-manifest-'));
    process.env.ERASURE_MANIFEST_DIR = manifestDir;
    await prisma.user.upsert({ where: { id: owner }, update: {}, create: { id: owner, name: owner, email: `${owner}@local.test`, emailVerified: true } });
    await prisma.team.create({ data: { id: teamId, name: 'c4c1k9-team', ownerId: owner } });
    await prisma.teamMember.create({ data: { teamId, userId: owner, role: 'OWNER' } });
  });

  afterAll(async () => {
    const pids = [...projects];
    await prisma.auditLog.deleteMany({ where: { targetId: { in: pids } } }).catch(() => undefined);
    await prisma.projectErasureRun.deleteMany({ where: { scopeId: { in: pids } } }).catch(() => undefined);
    for (const pid of pids) {
      await prisma.$queryRawUnsafe(`DELETE FROM "RefundObligation" WHERE "intentRowId" IN (SELECT id FROM "GenerationIntent" WHERE "projectId"='${pid}')`).catch(() => undefined);
      await prisma.$queryRawUnsafe(`DELETE FROM "ExecutionNodePlan" WHERE "requestId" IN (SELECT id FROM "ExecutionRequest" WHERE "projectId"='${pid}')`).catch(() => undefined);
      await prisma.$queryRawUnsafe(`DELETE FROM "ExecutionInput" WHERE "requestId" IN (SELECT id FROM "ExecutionRequest" WHERE "projectId"='${pid}')`).catch(() => undefined);
    }
    await prisma.generationIntent.deleteMany({ where: { projectId: { in: pids } } }).catch(() => undefined);
    await prisma.executionRequest.deleteMany({ where: { projectId: { in: pids } } }).catch(() => undefined);
    await prisma.media.deleteMany({ where: { key: { startsWith: `c4c1k9-p-${stamp}` } } }).catch(() => undefined);
    await prisma.videoWork.deleteMany({ where: { id: { startsWith: `c4c1k9-p-${stamp}` } } }).catch(() => undefined);
    await prisma.projectMember.deleteMany({ where: { projectId: { in: pids } } }).catch(() => undefined);
    await prisma.canvasProject.deleteMany({ where: { id: { in: pids } } }).catch(() => undefined);
    await prisma.teamMember.deleteMany({ where: { teamId } }).catch(() => undefined);
    await prisma.team.deleteMany({ where: { id: teamId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: owner } }).catch(() => undefined);
    rmSync(manifestDir, { recursive: true, force: true });
    await prisma.$disconnect();
    await prismaService.$disconnect().catch(() => undefined);
  }, 30_000);

  it('⑪-① kill -9 于二扫后（并集 manifest 已重写、批删未起）→重跑收敛', async () => {
    const pid = await seedProject();
    const { erasureId, manifestPath } = await toPurgingDb(pid);
    // 在飞 finalize 落新行（二扫发现面）
    await prisma.media.create({
      data: { id: `${pid}-m-late`, userId: owner, teamId, projectId: pid, bucket: 'flowai', key: `${pid}/late.bin`, originalName: 'late', mimeType: 'application/octet-stream', size: 1n, type: 'generated' },
    });
    // ── kill -9 模拟：仅完成「二扫并集+manifest 重写」内步（stage ②），其后中断 ──
    const manifest = await readErasureManifest(manifestPath);
    const live = await rescanProjectMediaWork(prismaService, pid);
    const union = unionManifestRows(manifest, live);
    expect(union.grew).toBe(true);   // late 行=并集发现面
    const rewritten = await writeErasureManifest({
      erasureId, scopeType: 'project', scopeId: pid, projectIds: [pid],
      requestedAt: new Date(), mediaRows: union.media, workRows: union.work,
      spoolSegs: await collectSpoolSegments(spoolDir, [pid]),
    }, manifestDir);
    await prisma.projectErasureRun.update({ where: { erasureId }, data: { manifestSha256: rewritten.manifestSha256 } });
    // ── 重启重跑：执行体全量两轮（首扫标记→复核窗跨越）收敛 ──
    const run = await prisma.projectErasureRun.findUniqueOrThrow({ where: { erasureId } });
    const r1 = await executePurgingDbStage({ prisma: prismaService, run, collectMediaRefs: collector, manifestDir, spoolDir });
    expect(r1.outcome).toBe('pending-review');
    await ageSidecar(erasureId);
    const r2 = await executePurgingDbStage({ prisma: prismaService, run, collectMediaRefs: collector, manifestDir, spoolDir });
    expect(r2).toEqual({ outcome: 'purging-objects' });
    await expectConverged(pid, erasureId);
    // 并集 late 行入册（C4-c2 对象重放面）且 DB 行已删（manifest−DB 现存=对象删除面契约）
    const after = await readErasureManifest(run.manifestPath!);
    expect(after.media.map((m) => m.id)).toContain(`${pid}-m-late`);
    expect(await prisma.media.count({ where: { id: `${pid}-m-late` } })).toBe(0);
  }, 60_000);

  it('⑪-② kill -9 于批删中途（部分表已删、余表在）→重跑收敛零双删', async () => {
    const pid = await seedProject();
    const { erasureId } = await toPurgingDb(pid);
    // ── kill -9 模拟：批二中段崩溃形态（Template/RuntimeEvent/VideoTrimTask 已删、余表+行本体在）──
    await prisma.template.deleteMany({ where: { projectId: pid } });
    await prisma.runtimeEvent.deleteMany({ where: { projectId: pid } });
    await prisma.videoTrimTask.deleteMany({ where: { workflowId: pid } });
    // ── 重跑：两轮收敛 ──
    const run = await prisma.projectErasureRun.findUniqueOrThrow({ where: { erasureId } });
    const r1 = await executePurgingDbStage({ prisma: prismaService, run, collectMediaRefs: collector, manifestDir, spoolDir });
    expect(r1.outcome).toBe('pending-review');
    await ageSidecar(erasureId);
    const r2 = await executePurgingDbStage({ prisma: prismaService, run, collectMediaRefs: collector, manifestDir, spoolDir });
    expect(r2).toEqual({ outcome: 'purging-objects' });
    await expectConverged(pid, erasureId);   // 全表清点零残留+audit 恰 1（零双删形态）
  }, 60_000);

  it('⑪-③ kill -9 于 scrub 后（intent 内容列已 NULL、行删未起）→重跑收敛', async () => {
    const pid = await seedProject();
    const { erasureId } = await toPurgingDb(pid);
    // ── kill -9 模拟：批一 scrub 已落、批二未起 ──
    await new ErasureContextService().withErasure(erasureId, () =>
      prismaService.$transaction(async (tx) => {
        await lockProject(tx as never, pid);
        await tx.generationIntent.updateMany({ where: { projectId: pid }, data: { resultText: null, gestureKey: null, resultRef: null } });
      }));
    // ── 重跑收敛 ──
    const run = await prisma.projectErasureRun.findUniqueOrThrow({ where: { erasureId } });
    const r1 = await executePurgingDbStage({ prisma: prismaService, run, collectMediaRefs: collector, manifestDir, spoolDir });
    expect(r1.outcome).toBe('pending-review');
    await ageSidecar(erasureId);
    await executePurgingDbStage({ prisma: prismaService, run, collectMediaRefs: collector, manifestDir, spoolDir });
    await expectConverged(pid, erasureId);
    const gi = await prisma.generationIntent.findFirstOrThrow({ where: { projectId: pid } });
    expect(gi.resultText).toBeNull();
    expect(gi.creditsConsumed).toBe(2);   // 计费列保留（重跑不误伤）
  }, 60_000);

  it('⑪-④ lease 过期→他实例重认领（C4-b claim 谓词不破坏）：tick 重认领推进 PURGING_OBJECTS', async () => {
    const pid = await seedProject();
    const { erasureId } = await toPurgingDb(pid);
    // 首扫（标记）后置他实例持有+过期租约——kill -9 后租约到期形态
    let run = await prisma.projectErasureRun.findUniqueOrThrow({ where: { erasureId } });
    await executePurgingDbStage({ prisma: prismaService, run, collectMediaRefs: collector, manifestDir, spoolDir });
    run = await prisma.projectErasureRun.findUniqueOrThrow({ where: { erasureId } });
    expect(run.state).toBe('PURGING_DB');   // 复核窗内
    await ageSidecar(erasureId);
    await prisma.projectErasureRun.update({
      where: { erasureId },
      data: { claimOwner: 'erasure-other-instance-xyz', leaseUntil: new Date(Date.now() - 5_000) },
    });
    await poller.tick();   // 他实例租约过期→claim 谓词放行→本实例重认领执行
    run = await prisma.projectErasureRun.findUniqueOrThrow({ where: { erasureId } });
    expect(run.state).toBe('PURGING_OBJECTS');   // 重认领后收敛
    expect(run.claimOwner).not.toBe('erasure-other-instance-xyz');   // claim 已易主（C4-b 谓词实证）
    const assertion = await assertProjectErasureDbComplete(prisma as never, pid, { forbiddenContent: [`${pid}/lib.bin`] });
    expect(assertion.violations).toEqual([]);
  }, 60_000);
});
