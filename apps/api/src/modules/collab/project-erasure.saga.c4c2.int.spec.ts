// apps/api/src/modules/collab/project-erasure.saga.c4c2.int.spec.ts
// C4-c2（plan Task C4-3 ★红⑪ 完整锚——生产就绪收尾批·project-erasure）：PURGING_OBJECTS→
// PURGING_CACHE→VERIFYING→DONE 全链（真 PG+真 MinIO 版本化桶+真 Redis；poller.tick 真 saga 路由）。
// 断言面：
//  ★红⑪ 完整锚：kill -9 于各新 stage（对象批中途/Redis 清除中途/复验重跑）→tick 重认领续跑
//   **DONE**——零双删（对象/audit 恰量）零泄漏（三面复验全绿）；
//  ★资金行计费列存活（plan C4-3 尾条）：DONE 后 GenerationIntent.creditCost/creditsConsumed+
//   ExecutionRequest.totalCredit 原样（allowlist 计费面在 VERIFYING 复用时显式断言）；
//  ★C1 互斥（plan :191 尾条）：tombstone（DELETING）后 retention sweeper 扫面对本项目零命中
//   （ACTIVE join 过滤——不误伤）；擦除 DONE 后行集已空零残留；
//  ★team 会合自动推进：子 run 真 saga 到 DONE→team run tick→PURGING_TEAM→删 Team 行→team run DONE。
// 运行：DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import {
  S3Client, CreateBucketCommand, DeleteBucketCommand, PutBucketVersioningCommand,
  ListObjectVersionsCommand, DeleteObjectsCommand, ListMultipartUploadsCommand, AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { MinioService } from '../minio/minio.service';
import { RuntimeFeedRetentionService } from './runtime-feed.retention.service';
import { ErasureContextService, lockProject } from './project-lock';
import { openProjectErasure } from './project-erasure';
import { ProjectErasureRunPoller } from './project-erasure.poller';
import { pendingMediaMarkerPath } from './project-erasure.stages';
import { scanPrefixKeys } from './project-erasure.cache';

const hasDb = !!process.env.DATABASE_URL;
const endpoint = process.env.MINIO_ENDPOINT ?? 'http://127.0.0.1:9000';
const accessKey = process.env.MINIO_ACCESS_KEY ?? 'minioadmin';
const secretKey = process.env.MINIO_SECRET_KEY ?? 'minioadmin';

async function probeMinio(): Promise<boolean> {
  try {
    const u = new URL(endpoint);
    const res = await fetch(`${u.protocol}//${u.host}/minio/health/live`, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch { return false; }
}
async function probeRedis(): Promise<boolean> {
  const RedisCtor = (await import('ioredis')).default;
  const r = new RedisCtor(process.env.REDIS_URL ?? 'redis://localhost:6379/0', { lazyConnect: true, maxRetriesPerRequest: 1 });
  try { await r.connect(); return r.status === 'ready'; } catch { return false; } finally { r.disconnect(); }
}
let ready = false;   // beforeAll 探测（it 运行期 ctx.skip 门——禁 top-level await：spec tsconfig module 档）

const maybe = (hasDb ? describe : describe.skip);

maybe('C4-c2 ★红⑪ 完整锚 saga（真 PG+MinIO+Redis——kill -9 各新 stage→resume DONE）', () => {
  const prisma = new PrismaClient();
  const prismaService = new PrismaService();
  const ledger = new CreditLedgerService(prismaService as never);
  const stamp = Date.now().toString(36);
  const owner = `c4c2s-owner-${stamp}`;
  const teamId = `c4c2s-team-${stamp}`;
  let seq = 0;
  let manifestDir: string;
  let bucket: string;
  let minio: MinioService;
  let redis: Redis;
  /** purgeScope stub（api 内存面端点归单测——saga 面注入 true 防真 api 进程依赖）。 */
  const purgeScopeCalls: string[][] = [];
  const poller = () => new ProjectErasureRunPoller(
    prismaService as never, ledger as never, new ErasureContextService(),
    async () => [],                                   // collector：零他项目 doc 引用
    minio as never, redis as never,
    async (projectIds) => { purgeScopeCalls.push(projectIds); return true; },
  );
  let p: ProjectErasureRunPoller;
  const projects: string[] = [];
  const teams: string[] = [];
  let execSeq = BigInt(Date.now());
  const bucketCleaned = false;

  const adminClient = () => new S3Client({
    region: 'us-east-1', endpoint, forcePathStyle: true,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });

  /** 富 fixture：三档 media+work+资金+feed（版本化桶对象实弹上传）。 */
  const seedProject = async (opts: { withFeed?: boolean } = {}): Promise<string> => {
    const pid = `c4c2s-p-${stamp}-${seq++}`;
    await prisma.canvasProject.create({ data: { id: pid, name: pid, teamId, userId: owner } });
    projects.push(pid);
    const media = (suffix: string, type: string, extra: Record<string, unknown> = {}) => prisma.media.create({
      data: { id: `${pid}-m-${suffix}`, userId: owner, teamId, projectId: pid, bucket, key: `${pid}/${suffix}.bin`, originalName: suffix, mimeType: 'application/octet-stream', size: 1n, type, ...extra },
    });
    await media('lib', 'uploaded', { nodeId: 'n-lib' });     // detach 保留
    await media('exc', 'generated');                          // 独占→删行+对象
    // 对象实弹：lib（两版本——detach 行对象保留面）+exc
    await minio.upload(`${pid}/lib.bin`, Buffer.from('v1'), 'application/octet-stream');
    await minio.upload(`${pid}/lib.bin`, Buffer.from('v2'), 'application/octet-stream');
    await minio.upload(`${pid}/exc.bin`, Buffer.from('e'), 'application/octet-stream');
    await prisma.videoWork.create({
      data: { id: `${pid}-w0`, title: 'w', authorName: owner, videoKey: `${pid}/work.mp4`, coverKey: `${pid}/cover.jpg`, canvasProjectId: pid, videoMediaId: `${pid}-m-lib`, viewCount: 9 },
    });
    // Redis 键族实弹：process 两代+url+like/view
    await redis.set(`videoWork:process:${pid}-w0:v2:meta`, 'm');
    await redis.set(`videoWork:process:${pid}-w0:v1:g1:r1:p0`, 'old');
    await redis.set(`videoWork:url:${pid}/work.mp4`, 'http://u');
    await redis.set(`videoWork:url:${pid}/exc.bin`, 'http://e');
    await redis.set(`videoWork:like:${pid}-w0:u1`, '1');
    await redis.set(`videoWork:view:${pid}-w0:ip`, '1');
    // 资金族（计费列存活断言面）
    const intent = await prisma.generationIntent.create({
      data: { projectId: pid, nodeId: 'n1', userId: owner, teamId, intentId: `it-${pid}`, kind: 'text', paramsHash: 'ph', creditCost: 4, creditsConsumed: 4, resultText: '正文', gestureKey: 'gk', resultRef: `${pid}-m-exc`, heartbeatAt: new Date(), deadlineAt: new Date(), idemKey: `idem-${pid}`, execSeq: execSeq++ },
    });
    const request = await prisma.executionRequest.create({
      data: { requestId: `rq-${pid}`, projectId: pid, generation: 1, historyId: 'h', docSeq: 1n, frozenDocSeq: 1n, userId: owner, teamId, kind: 'text', state: 'DONE', reservedCredit: 0, totalCredit: 4, planHash: 'a'.repeat(64), inputHash: 'b'.repeat(64), expiresAt: new Date(Date.now() + 3_600_000) },
    });
    await prisma.executionInput.create({ data: { requestId: request.id, encoding: 'json+gzip', content: Buffer.from('x'), contentHash: 'c'.repeat(64), rawBytes: 1, storedBytes: 1, schemaVersion: 1, expiresAt: new Date() } });
    await prisma.refundObligation.create({ data: { intentRowId: intent.id, execSeq: 1n, reversesId: 'r1', creditAmount: 1, state: 'SETTLED' } });
    if (opts.withFeed) {
      // C1 互斥 fixture：cursor lastSeq=200k+feedSeq=1（边界法可删档——ACTIVE join 应过滤 DELETING）
      await prisma.runtimeFeedCursor.create({ data: { projectId: pid, lastSeq: 200_000n } });
      await prisma.runtimeEvent.create({ data: { projectId: pid, generation: 1, feedSeq: 1n, kind: 'exec.status', payload: {} } });
    }
    await prisma.auditLog.create({ data: { operatorId: owner, operatorName: owner, teamId, targetType: 'PROJECT', targetId: pid, action: 'note', afterValue: { note: 'op' } } });
    return pid;
  };

  const tombstone = async (pid: string): Promise<void> => {
    await prisma.$transaction(async (tx) => {
      await lockProject(tx as never, pid);
      return openProjectErasure(tx as never, { projectId: pid, requestedBy: owner });
    });
  };

  /** tick 至指定态（含二扫并集首扫→复核窗跨越——sidecar aging）。 */
  const tickTo = async (pid: string, target: string, maxTicks = 12): Promise<void> => {
    for (let i = 0; i < maxTicks; i++) {
      const run = await prisma.projectErasureRun.findFirst({ where: { scopeId: pid, dryRun: false } });
      if (run?.state === target) return;
      if (run && run.state === 'PURGING_DB') {
        const marker = pendingMediaMarkerPath(manifestDir, run.erasureId);
        if (existsSync(marker)) {
          const aged = { ...(JSON.parse(readFileSync(marker, 'utf8')) as { markAt: string }), markAt: new Date(Date.now() - 120_000).toISOString() };
          const { writeFile } = await import('node:fs/promises');
          await writeFile(marker, `${JSON.stringify(aged)}\n`, 'utf8');
        }
      }
      await p.tick();
    }
    const run = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeId: pid, dryRun: false } });
    throw new Error(`tickTo(${target}) 未达（现态 ${run.state}）`);
  };

  beforeAll(async () => {
    manifestDir = mkdtempSync(join(tmpdir(), 'c4c2s-manifest-'));
    process.env.ERASURE_MANIFEST_DIR = manifestDir;
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379/0', { maxRetriesPerRequest: 1 });
    // 版本化 temp bucket（红⑮ 同形态——saga 对象面在版本化语义下全链）
    bucket = `c4c2s-${stamp}`;
    const c = adminClient();
    await c.send(new CreateBucketCommand({ Bucket: bucket }));
    await c.send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: 'Enabled' } }));
    await c.destroy();
    minio = new MinioService({ endpoint, accessKey, secretKey, bucket, useSsl: false });
    p = poller();
    await prisma.user.upsert({ where: { id: owner }, update: {}, create: { id: owner, name: owner, email: `${owner}@local.test`, emailVerified: true } });
    await prisma.team.create({ data: { id: teamId, name: 'c4c2s-team', ownerId: owner } });
    await prisma.teamMember.create({ data: { teamId, userId: owner, role: 'OWNER' } });
    ready = (await probeMinio()) && (await probeRedis());
  });

  afterAll(async () => {
    const pids = [...projects];
    // 桶回收（版本化=全版本+残件清后删桶）
    if (bucket && !bucketCleaned) {
      try {
        const c = adminClient();
        for (;;) {
          const lv = await c.send(new ListObjectVersionsCommand({ Bucket: bucket, MaxKeys: 1000 }));
          const objs = [...(lv.Versions ?? []), ...(lv.DeleteMarkers ?? [])].map((v) => ({ Key: v.Key!, VersionId: v.VersionId }));
          if (objs.length === 0) break;
          await c.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objs } }));
        }
        const mu = await c.send(new ListMultipartUploadsCommand({ Bucket: bucket }));
        for (const u of mu.Uploads ?? []) await c.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: u.Key!, UploadId: u.UploadId! }));
        await c.send(new DeleteBucketCommand({ Bucket: bucket }));
        await c.destroy();
      } catch { /* best-effort */ }
    }
    for (const kk of await redis.keys(`videoWork:process:c4c2s-*`).catch(() => [] as string[])) await redis.del(kk).catch(() => undefined);
    for (const kk of await redis.keys(`videoWork:url:c4c2s-*`).catch(() => [] as string[])) await redis.del(kk).catch(() => undefined);
    for (const kk of await redis.keys(`videoWork:like:c4c2s-*`).catch(() => [] as string[])) await redis.del(kk).catch(() => undefined);
    for (const kk of await redis.keys(`videoWork:view:c4c2s-*`).catch(() => [] as string[])) await redis.del(kk).catch(() => undefined);
    await prisma.auditLog.deleteMany({ where: { targetId: { in: [...pids, ...teams] } } }).catch(() => undefined);
    await prisma.projectErasureRun.deleteMany({ where: { scopeId: { in: [...pids, ...teams] } } }).catch(() => undefined);
    for (const pid of pids) {
      await prisma.$queryRawUnsafe(`DELETE FROM "ExecutionInput" WHERE "requestId" IN (SELECT id FROM "ExecutionRequest" WHERE "projectId"='${pid}')`).catch(() => undefined);
      await prisma.$queryRawUnsafe(`DELETE FROM "RefundObligation" WHERE "intentRowId" IN (SELECT id FROM "GenerationIntent" WHERE "projectId"='${pid}')`).catch(() => undefined);
    }
    await prisma.generationIntent.deleteMany({ where: { projectId: { in: pids } } }).catch(() => undefined);
    await prisma.executionRequest.deleteMany({ where: { projectId: { in: pids } } }).catch(() => undefined);
    await prisma.executionInput.deleteMany({ where: { requestId: { startsWith: 'rq-c4c2s-' } } }).catch(() => undefined);
    await prisma.runtimeFeedCursor.deleteMany({ where: { projectId: { in: pids } } }).catch(() => undefined);
    await prisma.media.deleteMany({ where: { key: { startsWith: `c4c2s-p-${stamp}` } } }).catch(() => undefined);
    await prisma.videoWork.deleteMany({ where: { id: { startsWith: `c4c2s-p-${stamp}` } } }).catch(() => undefined);
    await prisma.canvasProject.deleteMany({ where: { id: { in: pids } } }).catch(() => undefined);
    for (const t of teams) {
      await prisma.teamMember.deleteMany({ where: { teamId: t } }).catch(() => undefined);
      await prisma.team.deleteMany({ where: { id: t } }).catch(() => undefined);
    }
    await prisma.teamMember.deleteMany({ where: { teamId } }).catch(() => undefined);
    await prisma.team.deleteMany({ where: { id: teamId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: owner } }).catch(() => undefined);
    rmSync(manifestDir, { recursive: true, force: true });
    redis.disconnect();
    await prisma.$disconnect();
    await prismaService.$disconnect().catch(() => undefined);
  }, 60_000);

  it('⑪-完整+计费存活+C1 互斥：全链 tick→DONE——对象版本全清/detach 保留/Redis 零残留+like/view 保留/计费列存活/sweeper 不误伤', async () => {
    const pid = await seedProject({ withFeed: true });
    // ★C1 互斥（plan :191 尾条）：tombstone（DELETING）后 retention 扫面零命中（ACTIVE join 过滤）
    await tombstone(pid);
    const retention = new RuntimeFeedRetentionService(prismaService as never);
    const before = await prisma.runtimeEvent.count({ where: { projectId: pid } });
    const swept = await prisma.$transaction((tx) => retention.sweepEventsInTx(tx, 10, [pid]));
    expect(swept.deleted).toBe(0);   // DELETING 不在 sweeper 扫面（不误伤——C1/C4 互斥实证）
    expect(await prisma.runtimeEvent.count({ where: { projectId: pid } })).toBe(before);
    // 全链 tick：DRAINING→PURGING_DB（二扫+首扫）→复核窗→PURGING_OBJECTS→PURGING_CACHE→VERIFYING→DONE
    await tickTo(pid, 'DONE');
    const run = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeId: pid } });
    expect(run.state).toBe('DONE');
    expect(run.completedAt).not.toBeNull();
    expect(run.claimOwner).toBeNull();
    // 对象面（版本化桶）：exc 全版本清；lib（detach 保留）旧版本仍在
    expect(await minio.listObjectVersionRefs(`${pid}/exc.bin`)).toEqual([]);
    expect((await minio.listObjectVersionRefs(`${pid}/lib.bin`)).length).toBeGreaterThanOrEqual(2);   // detach 行对象保留（含旧版本——非删除面）
    // Redis 面：process/url 零残留+like/view 保留（红⑭ 全链复核）
    expect(await scanPrefixKeys(redis, `videoWork:process:${pid}-w0:*`)).toEqual([]);
    expect(await redis.exists(`videoWork:url:${pid}/work.mp4`)).toBe(0);
    expect(await redis.exists(`videoWork:url:${pid}/exc.bin`)).toBe(0);
    expect(await redis.exists(`videoWork:like:${pid}-w0:u1`)).toBe(1);
    expect(await redis.exists(`videoWork:view:${pid}-w0:ip`)).toBe(1);
    // purgeScope 首步调用链（PURGING_CACHE 面）
    expect(purgeScopeCalls.some((c) => c.includes(pid))).toBe(true);
    // ★资金行计费列存活（plan C4-3 尾条——c1 allowlist 面在 VERIFYING 复用时显式断言）
    const gi = await prisma.generationIntent.findFirstOrThrow({ where: { projectId: pid } });
    expect(gi.creditCost).toBe(4);
    expect(gi.creditsConsumed).toBe(4);
    expect(gi.resultText).toBeNull();   // scrub 已落（内容列空+计费列活=allowlist 语义双面）
    const rq = await prisma.executionRequest.findFirstOrThrow({ where: { projectId: pid } });
    expect(rq.totalCredit).toBe(4);
    expect(await prisma.executionInput.count({ where: { requestId: rq.id } })).toBe(0);   // 桥删
    // feed 行已随 scope 批删（C1 sweeper 让位后由擦除域承载）
    expect(await prisma.runtimeEvent.count({ where: { projectId: pid } })).toBe(0);
    expect(await prisma.runtimeFeedCursor.count({ where: { projectId: pid } })).toBe(0);
    // 零双删形态：擦除动作 audit 恰 1
    expect((await prisma.auditLog.findMany({ where: { targetType: 'PROJECT', targetId: pid, action: 'erase_project' } })).length).toBe(1);
  }, 120_000);

  it('⑪-② kill -9 于 PURGING_OBJECTS 批中途（部分版本已删）→tick 续跑 DONE 零双删', async (ctx) => {
    if (!ready) return ctx.skip();
    const pid = await seedProject();
    await tombstone(pid);
    await tickTo(pid, 'PURGING_OBJECTS');
    // kill -9 模拟：执行体前手动删半数面（partial DeleteObjects 批形态——版本化桶现行删置 Marker）
    await minio.deleteObjectsByKeys([`${pid}/exc.bin`]);
    await tickTo(pid, 'DONE');
    expect(await minio.listObjectVersionRefs(`${pid}/exc.bin`)).toEqual([]);   // 全版本收敛（Marker 同清）
    expect((await minio.listObjectVersionRefs(`${pid}/lib.bin`)).length).toBeGreaterThanOrEqual(2);
    expect((await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeId: pid } })).state).toBe('DONE');
  }, 120_000);

  it('⑪-③ kill -9 于 PURGING_CACHE 中途（半数键已清）→tick 续跑 DONE；VERIFYING 重跑幂等（回置 VERIFYING 再 tick 仍 DONE）', async (ctx) => {
    if (!ready) return ctx.skip();
    const pid = await seedProject();
    await tombstone(pid);
    await tickTo(pid, 'PURGING_CACHE');
    // kill -9 模拟：半数 Redis 键手工清（partial purge 形态）
    await redis.del(`videoWork:process:${pid}-w0:v2:meta`, `videoWork:url:${pid}/exc.bin`);
    await tickTo(pid, 'DONE');
    expect(await scanPrefixKeys(redis, `videoWork:process:${pid}-w0:*`)).toEqual([]);
    // VERIFYING 重跑幂等：回置 VERIFYING（kill -9 于 DONE 写前形态）→tick 复验全绿再 DONE 零副作用
    await prisma.projectErasureRun.update({ where: { erasureId: (await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeId: pid } })).erasureId }, data: { state: 'VERIFYING', claimOwner: null, leaseUntil: null, completedAt: null } });
    await tickTo(pid, 'DONE');
    expect((await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeId: pid } })).state).toBe('DONE');
    expect((await prisma.auditLog.findMany({ where: { targetType: 'PROJECT', targetId: pid, action: 'erase_project' } })).length).toBe(1);   // 零双删
  }, 120_000);

  it('team 会合自动推进：子 run 真 saga DONE→team run tick→删 Team 行→team run DONE', async (ctx) => {
    if (!ready) return ctx.skip();
    const tid = `c4c2s-team-${stamp}-sub`;
    teams.push(tid);
    await prisma.team.create({ data: { id: tid, name: 'sub-team', ownerId: owner } });
    await prisma.teamMember.create({ data: { teamId: tid, userId: owner, role: 'OWNER' } });
    // 子项目（team 维）+team run（WAITING_CHILDREN 形态：项目先 tombstone 后手建 team run）
    const pid = await seedProject();
    await prisma.canvasProject.update({ where: { id: pid }, data: { teamId: tid } });
    await prisma.media.updateMany({ where: { projectId: pid }, data: { teamId: tid } });
    const teamRun = await prisma.projectErasureRun.create({
      data: { scopeType: 'team', scopeId: tid, teamId: tid, requestedBy: owner, state: 'WAITING_CHILDREN' },
    });
    // 子 run 走真 saga（tombstone→全链 DONE）——挂 parentRunId（会合判定读面）
    await tombstone(pid);
    await prisma.projectErasureRun.updateMany({ where: { scopeId: pid }, data: { parentRunId: teamRun.erasureId, teamId: tid } });
    await tickTo(pid, 'DONE');
    // 钱包行（ledger 单写者——team.delete 级联 TeamBalance 触发 ledger_guard 通行证面）
    await ledger.runInTx(async (tx) => ledger.ensureBalance(tx as never, tid));
    await p.tick();   // 会合：子 DONE→PURGING_TEAM→ledger→team.delete→DONE
    const after = await prisma.projectErasureRun.findUniqueOrThrow({ where: { erasureId: teamRun.erasureId } });
    expect(after.state).toBe('DONE');
    expect(await prisma.team.count({ where: { id: tid } })).toBe(0);   // Team 行删除
  }, 120_000);
});
