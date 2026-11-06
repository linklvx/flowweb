// apps/api/src/modules/collab/project-erasure.cache.c4c2.int.spec.ts
// C4-c2（plan Task C4-3 ★红⑭——生产就绪收尾批·project-erasure）：PURGING_CACHE 执行体（真 Redis——
// R18 键=workId 非 pid）：
//  - **purgeWorkCaches**：workIds→targeted SCAN `videoWork:process:{workId}:*` **全前缀**（旧代体键
//    TTL 残留废止——跨代 v* 全清非仅当前指针键）+meta 键；urlKeys→`videoWork:url:{key}` 族删；
//  - **like/view 随作品 detach 保留**（`videoWork:like:`/`videoWork:view:` 键不扫不删——红⑭ detach
//    作品键保留断言面）；
//  - **purgeScope 首步 fail-closed**：api 不可达（null）→本轮暂停（state 保持 PURGING_CACHE+心跳
//    续租）零 Redis 动作——同 c1 collector 律；
//  - **VERIFYING 复验面**：verifyRedisPurged SCAN 零残留断言（注入残键→violations 非空）；
//  - dryRun：purgeScope/Redis 清除零调用（预览计数）。
// Redis 不可达=skip（本地 dev Redis 常驻；CI 无 Redis——红⑭ 断言面归本地 gate 必跑）。
// 运行：DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { writeErasureManifest, readErasureManifest } from './project-erasure.manifest';
import {
  executePurgingCacheStage, purgeWorkCaches, verifyRedisPurged, scanPrefixKeys,
  type PurgeScopeClient,
} from './project-erasure.cache';

const hasDb = !!process.env.DATABASE_URL;

const maybe = hasDb ? describe : describe.skip;
let redisReachable = false;   // beforeAll 探测（it 运行期 ctx.skip 门——禁 top-level await：spec tsconfig module 档）   // ioredis disconnect() 返回 void——禁挂 .catch（undefined.catch=TypeError 假阴性）

maybe('C4-c2 ★红⑭ PURGING_CACHE 执行体（真 Redis——R18 workId 键空间）', () => {
  const prisma = new PrismaClient();
  const prismaService = new PrismaService();
  const stamp = Date.now().toString(36);
  const owner = `c4c2c-owner-${stamp}`;
  const teamId = `c4c2c-team-${stamp}`;
  let redis: Redis;
  let manifestDir: string;
  const projects: string[] = [];
  /** 擦除域唯一键前缀（测试隔离——workId/id 族全部带 stamp）。 */
  const w1 = `c4c2c-w-${stamp}-w1`;
  const w2 = `c4c2c-w-${stamp}-w2`;   // 对照组（他作品——不进擦除面）
  const k1 = `c4c2c-k-${stamp}-k1`;   // url 键媒质
  const k2 = `c4c2c-k-${stamp}-k2`;   // 对照 url 键

  const seedKeys = async () => {
    // w1 process 族：两代体键+meta（旧代 v1 残留=TTL 废止形态——SCAN 全前缀面）
    await redis.set(`videoWork:process:${w1}:v2:g3:r5:p7:body`, 'x');
    await redis.set(`videoWork:process:${w1}:v2:meta`, 'm');
    await redis.set(`videoWork:process:${w1}:v1:g1:r1:p0:body`, 'old-gen');   // 旧代残留键
    await redis.set(`videoWork:url:${k1}`, 'http://signed');
    // like/view（随作品 detach 保留——红⑭ 保留断言面）
    await redis.set(`videoWork:like:${w1}:u1`, '1');
    await redis.set(`videoWork:view:${w1}:iphash`, '1');
    // 对照组 w2（他作品键族不受本 scope 擦除波及）
    await redis.set(`videoWork:process:${w2}:v2:meta`, 'm2');
    await redis.set(`videoWork:url:${k2}`, 'http://other');
  };

  /** manifest 直建（redis 段=deriveRedisKeys 自 work/media 行派生）。 */
  const writeManifest = async (pid: string) => writeErasureManifest({
    erasureId: `c4c2c-${pid}`, scopeType: 'project', scopeId: pid, projectIds: [pid],
    requestedAt: new Date(),
    mediaRows: [{ id: `m-${k1}`, bucket: 'flowai', key: k1, thumbnailKey: null, objectKey: null, size: 1n }],
    workRows: [{ id: w1, canvasProjectId: pid, videoKey: k1, coverKey: null }],
    spoolSegs: [],
  }, manifestDir);

  beforeAll(async () => {
    manifestDir = mkdtempSync(join(tmpdir(), 'c4c2c-manifest-'));
    process.env.ERASURE_MANIFEST_DIR = manifestDir;
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379/0', { maxRetriesPerRequest: 1 });
    redisReachable = await redis.ping().then(() => true).catch(() => false);   // 构造期 eager 连接——ping 判可达
    await prisma.user.upsert({ where: { id: owner }, update: {}, create: { id: owner, name: owner, email: `${owner}@local.test`, emailVerified: true } });
    await prisma.team.create({ data: { id: teamId, name: 'c4c2c-team', ownerId: owner } });
    await prisma.teamMember.create({ data: { teamId, userId: owner, role: 'OWNER' } });
    for (let i = 0; i < 4; i++) {
      const pid = `c4c2c-p-${stamp}-${i}`;
      await prisma.canvasProject.create({ data: { id: pid, name: pid, teamId, userId: owner } });
      projects.push(pid);
    }
  });

  afterAll(async () => {
    for (const k of [
      `videoWork:process:${w1}:*`, `videoWork:url:${k1}`, `videoWork:like:${w1}:u1`, `videoWork:view:${w1}:iphash`,
      `videoWork:process:${w2}:*`, `videoWork:url:${k2}`,
    ]) {
      if (k.endsWith('*')) { for (const kk of await scanPrefixKeys(redis, k)) await redis.del(kk); }
      else await redis.del(k).catch(() => undefined);
    }
    await prisma.auditLog.deleteMany({ where: { targetId: { in: projects } } }).catch(() => undefined);
    await prisma.projectErasureRun.deleteMany({ where: { scopeId: { in: projects } } }).catch(() => undefined);
    await prisma.canvasProject.deleteMany({ where: { id: { in: projects } } }).catch(() => undefined);
    await prisma.teamMember.deleteMany({ where: { teamId } }).catch(() => undefined);
    await prisma.team.deleteMany({ where: { id: teamId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: owner } }).catch(() => undefined);
    rmSync(manifestDir, { recursive: true, force: true });
    redis.disconnect();
    await prisma.$disconnect();
    await prismaService.$disconnect().catch(() => undefined);
  }, 30_000);

  it('⑭-① purgeWorkCaches：process/meta/url 全族零残留+like/view 保留+他作品不受波及', async (ctx) => {
    if (!redisReachable) return ctx.skip();   // Redis 不可达=skip（本地 gate 必跑面——不假绿）
    await seedKeys();
    const purged = await purgeWorkCaches(redis, [w1], [`videoWork:url:${k1}`]);
    expect(purged).toBe(4);   // 两代体+meta+url（全前缀 SCAN——旧代 v1 残留同清）
    // SCAN 断言零残留（红⑭ 字面）
    expect(await scanPrefixKeys(redis, `videoWork:process:${w1}:*`)).toEqual([]);
    expect(await redis.exists(`videoWork:url:${k1}`)).toBe(0);
    // like/view 保留（随作品 detach——作品行在册浏览/点赞语义保持）
    expect(await redis.exists(`videoWork:like:${w1}:u1`)).toBe(1);
    expect(await redis.exists(`videoWork:view:${w1}:iphash`)).toBe(1);
    // 对照组不受波及
    expect(await redis.exists(`videoWork:process:${w2}:v2:meta`)).toBe(1);
    expect(await redis.exists(`videoWork:url:${k2}`)).toBe(1);
  });

  it('⑭-② executePurgingCacheStage：purgeScope 首步→Redis 清除→VERIFYING 前置位', async (ctx) => {
    if (!redisReachable) return ctx.skip();   // Redis 不可达=skip（本地 gate 必跑面——不假绿）
    await seedKeys();
    const pid = projects[1]!;
    const m = await writeManifest(pid);
    const run = await prisma.projectErasureRun.create({
      data: { erasureId: `c4c2c-${pid}`, scopeType: 'project', scopeId: pid, requestedBy: owner, state: 'PURGING_CACHE', stage: 'PURGING_OBJECTS', manifestPath: m.manifestPath, manifestSha256: (await readErasureManifest(m.manifestPath)).footer.sha256 },
    });
    let scopePurged: string[] | null = null;
    const purgeScope: PurgeScopeClient = async (projectIds) => { scopePurged = projectIds; return true; };
    const res = await executePurgingCacheStage({ prisma: prismaService, run, redis, purgeScope });
    expect(res.outcome).toBe('verifying');
    expect(scopePurged).toEqual([pid]);   // purgeScope 首步已调（api 内存面在先行）
    expect(await scanPrefixKeys(redis, `videoWork:process:${w1}:*`)).toEqual([]);
    expect(await redis.exists(`videoWork:url:${k1}`)).toBe(0);
    expect(await redis.exists(`videoWork:like:${w1}:u1`)).toBe(1);   // 保留
    expect((await prisma.projectErasureRun.findUniqueOrThrow({ where: { erasureId: run.erasureId } })).state).toBe('VERIFYING');
  });

  it('⑭-③ fail-closed：purgeScope 不可达（null）→本轮暂停零 Redis 动作（state 保持 PURGING_CACHE）', async (ctx) => {
    if (!redisReachable) return ctx.skip();   // Redis 不可达=skip（本地 gate 必跑面——不假绿）
    await seedKeys();
    const pid = projects[2]!;
    const m = await writeManifest(pid);
    const run = await prisma.projectErasureRun.create({
      data: { erasureId: `c4c2c-fc-${pid}`, scopeType: 'project', scopeId: pid, requestedBy: owner, state: 'PURGING_CACHE', stage: 'PURGING_OBJECTS', manifestPath: m.manifestPath, manifestSha256: (await readErasureManifest(m.manifestPath)).footer.sha256 },
    });
    const res = await executePurgingCacheStage({ prisma: prismaService, run, redis, purgeScope: async () => null });
    expect(res.outcome).toBe('pending-api');
    expect((await prisma.projectErasureRun.findUniqueOrThrow({ where: { erasureId: run.erasureId } })).state).toBe('PURGING_CACHE');   // 不前置位
    expect((await scanPrefixKeys(redis, `videoWork:process:${w1}:*`)).length).toBe(3);   // 零 Redis 动作
    expect(await redis.exists(`videoWork:url:${k1}`)).toBe(1);
  });

  it('⑭-④ verifyRedisPurged：清后零违例；注入残键→violations 非空（复验面）', async (ctx) => {
    if (!redisReachable) return ctx.skip();
    await purgeWorkCaches(redis, [w1], [`videoWork:url:${k1}`]);
    expect(await verifyRedisPurged(redis, [w1], [`videoWork:url:${k1}`])).toEqual([]);
    await redis.set(`videoWork:process:${w1}:v9:meta`, 'residual');
    const v1 = await verifyRedisPurged(redis, [w1], [`videoWork:url:${k1}`]);
    expect(v1.some((x) => x.includes('process'))).toBe(true);
    await redis.del(`videoWork:process:${w1}:v9:meta`);
    await redis.set(`videoWork:url:${k1}`, 'residual');
    const v2 = await verifyRedisPurged(redis, [w1], [`videoWork:url:${k1}`]);
    expect(v2.some((x) => x.includes('url'))).toBe(true);
    await redis.del(`videoWork:url:${k1}`);
  });

  it('⑭-⑤ dryRun：purgeScope/Redis 零调用（预览计数）', async (ctx) => {
    if (!redisReachable) return ctx.skip();   // Redis 不可达=skip（本地 gate 必跑面——不假绿）
    await seedKeys();
    let called = false;
    const pid = projects[3]!;
    const m5 = await writeManifest(pid);
    const run = await prisma.projectErasureRun.create({
      data: { erasureId: `c4c2c-dry-${pid}`, scopeType: 'project', scopeId: pid, requestedBy: owner, state: 'PURGING_CACHE', stage: 'PURGING_OBJECTS', dryRun: true, manifestPath: m5.manifestPath, manifestSha256: (await readErasureManifest(m5.manifestPath)).footer.sha256 },
    });
    const res = await executePurgingCacheStage({ prisma: prismaService, run, redis, purgeScope: async () => { called = true; return true; } });
    expect(res.outcome).toBe('dry-run');
    expect(called).toBe(false);   // purgeScope 零调用
    expect((await scanPrefixKeys(redis, `videoWork:process:${w1}:*`)).length).toBe(3);   // Redis 零清除
    expect((await prisma.projectErasureRun.findUniqueOrThrow({ where: { erasureId: run.erasureId } })).state).toBe('PURGING_CACHE');   // 状态零推进
    await purgeWorkCaches(redis, [w1], [`videoWork:url:${k1}`]);   // 收尾清理
  });
});
