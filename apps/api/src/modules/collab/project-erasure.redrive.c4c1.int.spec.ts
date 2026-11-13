// apps/api/src/modules/collab/project-erasure.redrive.c4c1.int.spec.ts
// C4-c1（plan Task C4-3 FAILED re-drive+admin includeDeleted wiring——生产就绪收尾批·project-erasure）：
// FAILED run 重驱+admin 读面 int spec（真 PG）。断言面：
//  - re-drive 语义：FAILED→PENDING+attempts 保留+error/claim/completedAt 清空+恢复锚
//   （manifestPath/manifestSha256）保留+同事务 audit 行（action='erasure_re_drive'）；
//  - 非 FAILED 拒（STATE_*——活跃 run 轮询自愈面已覆盖）/缺失 404 形态（MISSING）；
//  - 重驱后端到端收敛：FAILED〔PURGING_DB 位毒化〕→re-drive→poller 续跑→PURGING_OBJECTS 前置位
//   （恢复锚 manifest 幂等复用——零重复落盘）；
//  - admin 读面（红⑦「admin 可见 DELETING」缺补）：GET runs 经 runWithIncludeDeleted 可见
//   DELETING 项目名/态（读过滤 Proxy 开关接线 admin 面）；PURGING_DB 完成后已删行=null 非错。
// 运行：DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { ErasureContextService, lockProject } from './project-lock';
import { openProjectErasure, reDriveErasureRun } from './project-erasure';
import { ProjectErasureRunPoller } from './project-erasure.poller';
import type { DeletionBarrierPort } from './deletion-barrier.port';   // C3b-5：删除窗 barrier stub
import { pendingMediaMarkerPath, type MediaRefsCollector } from './project-erasure.stages';
import { AdminErasureController } from '../admin/erasure/erasure.controller';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

maybe('C4-c1 FAILED re-drive+admin 读面（真 PG）', () => {
  const prisma = new PrismaClient();
  const prismaService = new PrismaService();
  const ledger = new CreditLedgerService(prismaService as never);
  const collector: MediaRefsCollector = async () => [];
/** C3b-5：删除窗 barrier stub（verified 档——消费面切换后删除窗经 barrier；真 barrier 全链=
 *  deletion-barrier.int.spec+media-gc.shadow.c3b5）。 */
const okBarrier = (): DeletionBarrierPort => ({
  prepare: async () => ({ outcome: 'verified', barrierId: `stub-${randomUUID()}`, projects: [], expiresAt: Date.now() + 60_000 }),
  release: async () => true,
}) as unknown as DeletionBarrierPort;

  const poller = new ProjectErasureRunPoller(prismaService as never, ledger as never, new ErasureContextService(), collector, undefined, undefined, undefined, okBarrier());
  const admin = new AdminErasureController(prismaService as never);
  const stamp = Date.now().toString(36);
  const owner = `c4c1rd-owner-${stamp}`;
  const teamId = `c4c1rd-team-${stamp}`;
  let seq = 0;
  let manifestDir: string;
  const projects: string[] = [];

  const seedProject = async (nameSuffix: string): Promise<string> => {
    const pid = `c4c1rd-p-${stamp}-${seq++}-${nameSuffix}`;
    await prisma.canvasProject.create({ data: { id: pid, name: `proj-${nameSuffix}`, teamId, userId: owner } });
    projects.push(pid);
    await prisma.media.create({
      data: { id: `${pid}-m-exc`, userId: owner, teamId, projectId: pid, bucket: 'flowai', key: `${pid}/exc.bin`, originalName: 'exc', mimeType: 'application/octet-stream', size: 1n, type: 'generated' },
    });
    await prisma.media.create({
      data: { id: `${pid}-m-lib`, userId: owner, teamId, projectId: pid, bucket: 'flowai', key: `${pid}/lib.bin`, originalName: 'lib', mimeType: 'application/octet-stream', size: 1n, type: 'uploaded' },
    });
    return pid;
  };

  beforeAll(async () => {
    manifestDir = mkdtempSync(join(tmpdir(), 'c4c1rd-manifest-'));
    process.env.ERASURE_MANIFEST_DIR = manifestDir;
    await prisma.user.upsert({ where: { id: owner }, update: {}, create: { id: owner, name: owner, email: `${owner}@local.test`, emailVerified: true } });
    await prisma.team.create({ data: { id: teamId, name: 'c4c1rd-team', ownerId: owner } });
    await prisma.teamMember.create({ data: { teamId, userId: owner, role: 'OWNER' } });
  });

  afterAll(async () => {
    const pids = [...projects];
    await prisma.auditLog.deleteMany({ where: { targetId: { in: [...pids, teamId] } } }).catch(() => undefined);
    await prisma.projectErasureRun.deleteMany({ where: { scopeId: { in: pids } } }).catch(() => undefined);
    await prisma.media.deleteMany({ where: { key: { startsWith: `c4c1rd-p-${stamp}` } } }).catch(() => undefined);
    await prisma.canvasProject.deleteMany({ where: { id: { in: pids } } }).catch(() => undefined);
    await prisma.teamMember.deleteMany({ where: { teamId } }).catch(() => undefined);
    await prisma.team.deleteMany({ where: { id: teamId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: owner } }).catch(() => undefined);
    rmSync(manifestDir, { recursive: true, force: true });
    await prisma.$disconnect();
    await prismaService.$disconnect().catch(() => undefined);
  }, 30_000);

  it('re-drive 语义：FAILED→PENDING+attempts 保留+error/claim 清空+恢复锚保留+audit 同事务；非 FAILED 拒/缺失 404', async () => {
    const pid = await seedProject('sem');
    await prisma.$transaction(async (tx) => {
      await lockProject(tx as never, pid);
      return openProjectErasure(tx as never, { projectId: pid, requestedBy: owner });
    });
    await poller.tick();   // DRAINING+manifest+PURGING_DB
    let run = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeId: pid } });
    expect(run.state).toBe('PURGING_DB');
    // 毒化形态：手动置 FAILED（attempts=2+error 留痕——运维观察到的失败 run）
    await prisma.projectErasureRun.update({
      where: { erasureId: run.erasureId },
      data: { state: 'FAILED', error: 'PURGING_DB 列级断言红（演练）', attempts: 2, claimOwner: null, leaseUntil: null, completedAt: new Date() },
    });
    // admin 读面：FAILED run 可见+DELETING 项目名可见（includeDeleted 接线）
    const list = await admin.listRuns('FAILED');
    const row = list.runs.find((r) => r.erasureId === run.erasureId);
    expect(row).toMatchObject({ state: 'FAILED', error: expect.stringContaining('断言红'), attempts: 2, projectName: 'proj-sem', projectLifecycle: 'DELETING' });
    // re-drive（恢复锚在=直回 PURGING_DB 执行体——禁回 PENDING 重走 DRAINING〔manifest 缩水丢
    // C4-c2 对象重放面〕）
    const res = await prisma.$transaction((tx) => reDriveErasureRun(tx as never, { erasureId: run.erasureId, operatorId: owner, operatorName: owner }));
    expect(res).toMatchObject({ ok: true, attempts: 0 });   // C4-c2 P2-2：re-drive 清 attempts 重数
    if (res.ok) expect(res.run.state).toBe('PURGING_DB');
    run = await prisma.projectErasureRun.findUniqueOrThrow({ where: { erasureId: run.erasureId } });
    expect(run.state).toBe('PURGING_DB');
    expect(run.error).toBeNull();
    expect(run.attempts).toBe(0);   // C4-c2 P2-2：清零重数（人工处置=毒化根因已排除——FAILED 上界 ERASURE_RUN_MAX_ATTEMPTS=5 全新计数）
    expect(run.claimOwner).toBeNull();
    expect(run.completedAt).toBeNull();
    expect(run.manifestPath).toBeTruthy();   // 恢复锚保留
    expect(run.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    const audits = await prisma.auditLog.findMany({ where: { targetType: 'PROJECT', targetId: pid, action: 'erasure_re_drive' } });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.afterValue).toMatchObject({ state: 'PURGING_DB', attempts: 0 });
    // 非 FAILED 拒（PURGING_DB 活跃态——轮询自愈面已覆盖）
    const again = await prisma.$transaction((tx) => reDriveErasureRun(tx as never, { erasureId: run.erasureId, operatorId: owner, operatorName: owner }));
    expect(again).toEqual({ ok: false, reason: 'STATE_PURGING_DB' });
    expect((await prisma.auditLog.findMany({ where: { targetId: pid, action: 'erasure_re_drive' } })).length).toBe(1);   // 拒档零 audit
    // 缺失 404 形态
    expect(await prisma.$transaction((tx) => reDriveErasureRun(tx as never, { erasureId: 'no-such-run', operatorId: owner, operatorName: owner }))).toEqual({ ok: false, reason: 'MISSING' });
  }, 60_000);

  it('重驱后端到端收敛：FAILED〔PURGING_DB 位〕→re-drive→poller 续跑→PURGING_OBJECTS（恢复锚幂等复用）', async () => {
    const pid = await seedProject('conv');
    await prisma.$transaction(async (tx) => {
      await lockProject(tx as never, pid);
      return openProjectErasure(tx as never, { projectId: pid, requestedBy: owner });
    });
    await poller.tick();   // DRAINING+PURGING_DB
    let run = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeId: pid } });
    const manifestPath = run.manifestPath!;
    const manifestSha = run.manifestSha256!;
    await poller.tick();   // 执行体首扫（标记独占 sidecar——停 PURGING_DB 待复核）
    run = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeId: pid } });
    expect(run.state).toBe('PURGING_DB');
    // 毒化+重驱（恢复锚在=直回 PURGING_DB——sidecar/manifest 双锚原样）
    await prisma.projectErasureRun.update({ where: { erasureId: run.erasureId }, data: { state: 'FAILED', error: '演练毒化', attempts: 1 } });
    await prisma.$transaction((tx) => reDriveErasureRun(tx as never, { erasureId: run.erasureId, operatorId: owner, operatorName: owner }));
    run = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeId: pid } });
    expect(run.state).toBe('PURGING_DB');
    expect(run.manifestPath).toBe(manifestPath);   // 恢复锚同 path（禁重走 DRAINING=manifest 不缩水）
    // 续跑：tick=claim+执行体（复核窗内——sidecar 未跨周期仍 pending）→age→tick 收敛
    await poller.tick();
    run = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeId: pid } });
    expect(run.state).toBe('PURGING_DB');   // 执行体复核窗内 pending-review
    const { readFile, writeFile } = await import('node:fs/promises');
    const markerPath = pendingMediaMarkerPath(manifestDir, run.erasureId);
    const aged = { ...(JSON.parse(await readFile(markerPath, 'utf8')) as { markAt: string }), markAt: new Date(Date.now() - 120_000).toISOString() };
    await writeFile(markerPath, `${JSON.stringify(aged)}\n`, 'utf8');
    await poller.tick();   // 复核窗已满→独占删+断言+前置位
    run = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeId: pid } });
    expect(run.state).toBe('PURGING_OBJECTS');
    expect(run.stage).toBe('PURGING_DB');
    expect(await prisma.media.count({ where: { projectId: pid } })).toBe(0);   // exc 删+lib detach
    // 并集只增不减钉死：重驱全程 manifest 含全行（lib=detach 行也留册——C4-c2 对象重放面禁缩水）
    const { readErasureManifest } = await import('./project-erasure.manifest');
    const manifestFinal = await readErasureManifest(manifestPath);
    expect(manifestFinal.media.map((m) => m.id).sort()).toEqual([`${pid}-m-exc`, `${pid}-m-lib`]);
    expect(run.manifestSha256).toBe(manifestSha);   // 恢复锚 sha 幂等（重驱+并集重写不改既有行集）
    // admin 读面：PURGING_DB 完成后已删项目行=null 非错（DELETING 可见档=上一用例已证）
    const list = await admin.listRuns(undefined);
    const row = list.runs.find((r) => r.erasureId === run.erasureId);
    expect(row).toMatchObject({ state: 'PURGING_OBJECTS', projectName: null, projectLifecycle: null });
  }, 60_000);

  it('C4-c2 P2-2 毒丸上界：连续处理失败 ERASURE_RUN_MAX_ATTEMPTS 次→FAILED+error 留档；re-drive 清零重数', async () => {
    const pid = await seedProject('poison');
    await prisma.$transaction(async (tx) => {
      await lockProject(tx as never, pid);
      return openProjectErasure(tx as never, { projectId: pid, requestedBy: owner });
    });
    await poller.tick();   // DRAINING+PURGING_DB
    await poller.tick();   // 首扫（team 零他项目=doc 扫描跳过档——sidecar 标记）
    let run = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeId: pid } });
    expect(run.state).toBe('PURGING_DB');
    // 毒化：置 PURGING_OBJECTS+manifest 指向不存在路径（readErasureManifest 抛=每 tick 失败）
    await prisma.projectErasureRun.update({
      where: { erasureId: run.erasureId },
      data: { state: 'PURGING_OBJECTS', manifestPath: join(manifestDir, 'poison-no-such.ndjson') },
    });
    // 坏对象端口（持续抛——poller 构造注入）：连续失败至上界→FAILED（attempts=5+error 留档）。
    // 先清租约（前两 tick 由好 poller 持新鲜租约——CAS 谓词不放行他实例）：
    await prisma.projectErasureRun.update({ where: { erasureId: run.erasureId }, data: { claimOwner: null, leaseUntil: new Date(Date.now() - 60_000) } });
    const badPoller = new ProjectErasureRunPoller(
      prismaService as never, ledger as never, new ErasureContextService(),
      async () => [],
      { getBucketVersioningStatus: async () => { throw new Error('演练：对象存储不可达'); } } as never,
      {} as never, async () => true, okBarrier(),
    );
    /** 退避窗流逝模拟（P2-1：失败后 leaseUntil 刷 now+60s——同实例 attempts>0 须待窗过期才重认领；
     *  手动置过去=窗已过形态〔评审钦定免注入面〕）。 */
    const expireLease = () => prisma.projectErasureRun.update({ where: { erasureId: run.erasureId }, data: { leaseUntil: new Date(Date.now() - 5_000) } });
    for (let i = 0; i < 4; i++) { await expireLease(); await badPoller.tick(); }   // attempts 1..4（每次窗已过重认领失败一次）
    run = await prisma.projectErasureRun.findUniqueOrThrow({ where: { erasureId: run.erasureId } });
    expect(run.state).toBe('PURGING_OBJECTS');   // 未达界仍在位
    expect(run.attempts).toBe(4);
    // ★P2-1 真退避保护锚：**不**过期租约连发 tick——attempts 不递增（claim attempts>0∧lease 未过期
    // ⇒同实例不重认领——变异〔移除 claim attempts 约束〕时本断言红：attempts 将每 tick +1）
    for (let i = 0; i < 3; i++) await badPoller.tick();
    expect((await prisma.projectErasureRun.findUniqueOrThrow({ where: { erasureId: run.erasureId } })).attempts).toBe(4);
    await expireLease(); await badPoller.tick();   // 第 5 次（窗已过）→FAILED
    run = await prisma.projectErasureRun.findUniqueOrThrow({ where: { erasureId: run.erasureId } });
    expect(run.state).toBe('FAILED');
    expect(run.attempts).toBe(5);
    expect(run.error).toContain('poison-no-such');   // manifest 读首步即抛（ENOENT——毒丸形态本体）
    expect(run.completedAt).not.toBeNull();
    expect(run.claimOwner).toBeNull();
    // 再 tick：FAILED 非候选（零重试——毒丸上界语义）+attempts 不再涨
    await badPoller.tick();
    expect((await prisma.projectErasureRun.findUniqueOrThrow({ where: { erasureId: run.erasureId } })).attempts).toBe(5);
    // re-drive：attempts 清零重数（P2-2——人工处置=根因排除后全新计数）
    const res = await prisma.$transaction((tx) => reDriveErasureRun(tx as never, { erasureId: run.erasureId, operatorId: owner, operatorName: owner }));
    expect(res).toMatchObject({ ok: true, attempts: 0 });
    // 清理：置 DONE 释放（该 fixture 已被首扫批删——直接终态防活跃 run 残留 dev 库）
    await prisma.projectErasureRun.update({ where: { erasureId: run.erasureId }, data: { state: 'DONE', completedAt: new Date(), claimOwner: null, leaseUntil: null } }).catch(() => undefined);
  }, 60_000);
});
