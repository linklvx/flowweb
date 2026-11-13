// apps/api/src/modules/collab/project-erasure.restore.c4c2.int.spec.ts
// C4-c2（plan Task C4-3 ★红⑱——生产就绪收尾批·project-erasure）：restore-reerase.mjs 恢复重擦除
// int spec（真 PG+真 MinIO+真 Redis+真脚本模块——import scripts/restore-reerase.mjs 直调核心）。
// 断言面：
//  ★恢复旧备份→重擦零残留：manifest 在（外部耐久面）+DB 行复原（备份恢复形态）→plan 建 run 行
//   （state=PURGING_DB+恢复锚+tombstone）→worker saga 全链→DONE——对象/DB/Redis 三面零残留
//   （对象删除面=manifest−DB 现存——worker 承接单源，脚本零删除逻辑）；
//  ★幂等：sidecar replayed 标记→二次 plan 零新行（already-replayed 档）；
//  ★双失→RESIDUAL_RISK 非成功（R16 诚实披露）：DB 擦除证据（run 行 manifestPath）指向缺失文件
//   →residualRisk 非空（CLI exit 2 语义——plan 返回面断言）。
// 运行：DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import {
  S3Client, CreateBucketCommand, DeleteBucketCommand, PutBucketVersioningCommand,
  ListObjectVersionsCommand, DeleteObjectsCommand, ListMultipartUploadsCommand, AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { MinioService } from '../minio/minio.service';
import { ErasureContextService } from './project-lock';
import { ProjectErasureRunPoller } from './project-erasure.poller';
import type { DeletionBarrierPort } from './deletion-barrier.port';   // C3b-5：删除窗 barrier stub
import { pendingMediaMarkerPath } from './project-erasure.stages';
import { writeErasureManifest } from './project-erasure.manifest';
import { scanPrefixKeys } from './project-erasure.cache';
/** 脚本核心直调（.mjs 动态 import 惰性加载——禁 top-level await〔spec tsconfig module 档〕；
 *  声明缺失折 any 后 cast 收窄〔脚本域无 .d.ts——脚本自身测试归 scripts/ node:test 面〕）。 */
type PlanFn = (opts: { manifestDir?: string; prisma?: unknown }) => Promise<{
  planned: Array<{ erasureId: string; scopeId: string }>;
  skipped: Array<{ manifestPath: string; reason: string }>;
  residualRisk: Array<{ kind: string; erasureId?: string; manifestPath?: string }>;
}>;
let planFn: PlanFn | null = null;
const planRestoreReerase: PlanFn = async (opts) => {
  if (planFn == null) {
    // @ts-expect-error C4-c2：脚本域 .mjs 无类型声明（脚本自测归 scripts/ node:test 面）——cast 收窄
    const mod = (await import('../../../../../scripts/restore-reerase.mjs')) as { planRestoreReerase: PlanFn };
    planFn = mod.planRestoreReerase;
  }
  return planFn(opts);
};

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

maybe('C4-c2 ★红⑱ restore-reerase 恢复重擦除（真 PG+MinIO+Redis+脚本模块）', () => {
  const prisma = new PrismaClient();
  const prismaService = new PrismaService();
  const ledger = new CreditLedgerService(prismaService as never);
  const stamp = Date.now().toString(36);
  const owner = `c4c2r-owner-${stamp}`;
  const teamId = `c4c2r-team-${stamp}`;
  let seq = 0;
  let manifestDir: string;
  let bucket: string;
  let minio: MinioService;
  let redis: Redis;
/** C3b-5：删除窗 barrier stub（verified 档——消费面切换后删除窗经 barrier；真 barrier 全链=
 *  deletion-barrier.int.spec+media-gc.shadow.c3b5）。 */
const okBarrier = (): DeletionBarrierPort => ({
  prepare: async () => ({ outcome: 'verified', barrierId: `stub-${randomUUID()}`, projects: [], expiresAt: Date.now() + 60_000 }),
  release: async () => true,
}) as unknown as DeletionBarrierPort;

  let p: ProjectErasureRunPoller;
  const projects: string[] = [];

  const adminClient = () => new S3Client({
    region: 'us-east-1', endpoint, forcePathStyle: true,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });

  /** 备份恢复形态 fixture：项目+media+对象在位+Redis 键在位（=「恢复旧备份」后世界态）。 */
  const seedRestoredProject = async (): Promise<string> => {
    const pid = `c4c2r-p-${stamp}-${seq++}`;
    await prisma.canvasProject.create({ data: { id: pid, name: pid, teamId, userId: owner, lifecycleState: 'ACTIVE' } });
    projects.push(pid);
    for (const s of ['lib', 'exc']) {
      await prisma.media.create({
        data: { id: `${pid}-m-${s}`, userId: owner, teamId, projectId: pid, bucket, key: `${pid}/${s}.bin`, originalName: s, mimeType: 'application/octet-stream', size: 1n, type: s === 'lib' ? 'uploaded' : 'generated' },
      });
      await minio.upload(`${pid}/${s}.bin`, Buffer.from(s), 'application/octet-stream');
    }
    await prisma.videoWork.create({
      data: { id: `${pid}-w0`, title: 'w', authorName: owner, videoKey: `${pid}/work.mp4`, canvasProjectId: pid, videoMediaId: `${pid}-m-lib` },
    });
    await redis.set(`videoWork:process:${pid}-w0:v2:meta`, 'm');
    await redis.set(`videoWork:url:${pid}/exc.bin`, 'http://e');
    return pid;
  };

  /** tick 至指定态（PURGING_DB 复核窗 aging 内含）。 */
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
    manifestDir = mkdtempSync(join(tmpdir(), 'c4c2r-manifest-'));
    process.env.ERASURE_MANIFEST_DIR = manifestDir;
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379/0', { maxRetriesPerRequest: 1 });
    bucket = `c4c2r-${stamp}`;
    const c = adminClient();
    await c.send(new CreateBucketCommand({ Bucket: bucket }));
    await c.send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: 'Enabled' } }));
    await c.destroy();
    minio = new MinioService({ endpoint, accessKey, secretKey, bucket, useSsl: false });
    p = new ProjectErasureRunPoller(
      prismaService as never, ledger as never, new ErasureContextService(),
      async () => [], minio as never, redis as never, async () => true, okBarrier(),
    );
    await prisma.user.upsert({ where: { id: owner }, update: {}, create: { id: owner, name: owner, email: `${owner}@local.test`, emailVerified: true } });
    await prisma.team.create({ data: { id: teamId, name: 'c4c2r-team', ownerId: owner } });
    await prisma.teamMember.create({ data: { teamId, userId: owner, role: 'OWNER' } });
    ready = (await probeMinio()) && (await probeRedis());
  });

  afterAll(async () => {
    const pids = [...projects];
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
    for (const kk of await redis.keys(`videoWork:*c4c2r-*`).catch(() => [] as string[])) await redis.del(kk).catch(() => undefined);
    await prisma.auditLog.deleteMany({ where: { targetId: { in: pids } } }).catch(() => undefined);
    await prisma.projectErasureRun.deleteMany({ where: { scopeId: { in: pids } } }).catch(() => undefined);
    await prisma.media.deleteMany({ where: { key: { startsWith: `c4c2r-p-${stamp}` } } }).catch(() => undefined);
    await prisma.videoWork.deleteMany({ where: { id: { startsWith: `c4c2r-p-${stamp}` } } }).catch(() => undefined);
    await prisma.canvasProject.deleteMany({ where: { id: { in: pids } } }).catch(() => undefined);
    await prisma.teamMember.deleteMany({ where: { teamId } }).catch(() => undefined);
    await prisma.team.deleteMany({ where: { id: teamId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: owner } }).catch(() => undefined);
    rmSync(manifestDir, { recursive: true, force: true });
    redis.disconnect();
    await prisma.$disconnect();
    await prismaService.$disconnect().catch(() => undefined);
  }, 60_000);

  it('⑱-① 恢复旧备份→重擦零残留：plan 建 run（PURGING_DB+恢复锚+tombstone）→saga DONE 三面零残留；二次 plan 幂等零新行', async (ctx) => {
    if (!ready) return ctx.skip();
    const pid = await seedRestoredProject();
    // 「过往擦除的 manifest 在外部耐久面」形态：直建 manifest（并集档含全行——worker 二扫并集承接）
    await writeErasureManifest({
      erasureId: `c4c2r-er-${pid}`, scopeType: 'project', scopeId: pid, projectIds: [pid],
      requestedAt: new Date(),
      mediaRows: [
        { id: `${pid}-m-lib`, bucket, key: `${pid}/lib.bin`, thumbnailKey: null, objectKey: null, size: 1n },
        { id: `${pid}-m-exc`, bucket, key: `${pid}/exc.bin`, thumbnailKey: null, objectKey: null, size: 1n },
      ],
      workRows: [{ id: `${pid}-w0`, canvasProjectId: pid, videoKey: `${pid}/work.mp4`, coverKey: null }],
      spoolSegs: [],
    }, manifestDir);
    // ★plan：建 run 行（恢复锚——state=PURGING_DB 直进执行体）+tombstone+sidecar+audit
    const plan = await planRestoreReerase({ manifestDir, prisma: prisma as never });
    expect(plan.residualRisk).toEqual([]);
    expect(plan.planned).toEqual([{ erasureId: `c4c2r-er-${pid}`, scopeId: pid }]);
    expect((await prisma.canvasProject.findUniqueOrThrow({ where: { id: pid } })).lifecycleState).toBe('DELETING');   // tombstone（恢复后 ACTIVE→DELETING）
    expect(existsSync(join(manifestDir, `c4c2r-er-${pid}.replayed.json`))).toBe(true);   // replayedAt sidecar
    expect(await prisma.auditLog.count({ where: { targetType: 'PROJECT', targetId: pid, action: 'erasure_restore_replay' } })).toBe(1);
    // ★worker saga 全链（脚本零删除逻辑——run 行承接单源）
    await tickTo(pid, 'DONE');
    expect((await prisma.projectErasureRun.findUniqueOrThrow({ where: { erasureId: `c4c2r-er-${pid}` } })).state).toBe('DONE');
    // 三面零残留：DB（exc 删/lib detach）+对象（exc 全版本清/lib 保留）+Redis（process/url 清）
    expect(await prisma.media.count({ where: { projectId: pid } })).toBe(0);
    expect((await prisma.media.findUniqueOrThrow({ where: { id: `${pid}-m-lib` } })).projectId).toBeNull();
    expect(await minio.listObjectVersionRefs(`${pid}/exc.bin`)).toEqual([]);
    expect((await minio.listObjectVersionRefs(`${pid}/lib.bin`)).length).toBe(1);   // detach 行对象保留
    expect(await scanPrefixKeys(redis, `videoWork:process:${pid}-w0:*`)).toEqual([]);
    expect(await redis.exists(`videoWork:url:${pid}/exc.bin`)).toBe(0);
    // ★幂等：二次 plan 零新行（sidecar already-replayed 档）
    const plan2 = await planRestoreReerase({ manifestDir, prisma: prisma as never });
    expect(plan2.planned).toEqual([]);
    expect(plan2.skipped.some((s) => s.reason === 'already-replayed')).toBe(true);
    expect(plan2.residualRisk).toEqual([]);
  }, 180_000);

  it('⑱-② 双失→RESIDUAL_RISK 非成功（R16 诚实披露）：DB 擦除证据的 manifest 缺失→residualRisk 非空零重放', async (ctx) => {
    if (!ready) return ctx.skip();
    // DB 证据行（state=DONE+manifestPath 指向缺失文件——「DB 在 manifest 失」双失形态）
    const fake = await prisma.projectErasureRun.create({
      data: { scopeType: 'project', scopeId: `c4c2r-missing-${stamp}`, requestedBy: owner, state: 'DONE', manifestPath: join(manifestDir, 'gone.ndjson') },
    });
    try {
      const plan = await planRestoreReerase({ manifestDir, prisma: prisma as never });
      expect(plan.residualRisk.some((r) => r.kind === 'manifest-missing' && r.erasureId === fake.erasureId)).toBe(true);   // CLI 该档 exit 2（非成功）
      expect(plan.planned).toEqual([]);   // 零重放（不能对未知面声称已清）
    } finally {
      await prisma.projectErasureRun.delete({ where: { erasureId: fake.erasureId } }).catch(() => undefined);
    }
  }, 60_000);
});
