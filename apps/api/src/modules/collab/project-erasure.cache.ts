// apps/api/src/modules/collab/project-erasure.cache.ts
// C4-c2（plan Task C4-3 ★红⑭——生产就绪收尾批·project-erasure）：PURGING_CACHE **执行体**
// （objects 同族；census ⑰ 闭包纯度=prisma/manifest 族+redis 结构端口，零 controller/Http 面——
// httpPurgeScope 经原生 fetch 不引 HttpModule）。
//
// 承接契约（spec §2 R18——Redis 擦除=workId 映射；**禁 SCAN {pid}:***〔键首段=workId 非 pid——
// video-work.service.ts :46-47 注释实证：键空间按作品隔离+delProcessCacheFamily(workId) :216 既有
// 语义；pid 经 VideoWork.canvasProjectId 映射进 workIds——manifest redis 段 deriveRedisKeys :101 已派生〕）：
//  ①**purgeScope 首步**（api 进程内存面——dedup/水位/世代计数/段索引+快照缓存 evict）：经内部端点
//    （collectMediaRefs 同族：限批+isLeaseServing+WorkerWriteAuthGuard）；不可达（null）→**本轮暂停
//    fail-closed**（state 保持 PURGING_CACHE+心跳续租——同 c1 collector 律，下一 tick 重试）；
//  ②**purgeWorkCaches**（自 manifest redis 段）：workIds→targeted SCAN `videoWork:process:{workId}:*`
//    **全前缀**（跨代 v* 体键+meta——**旧代体键 TTL 残留废止**：invalidation 路径的指针式精确删
//    〔video-work.service delProcessCacheFamily :216——meta 指针+当前体键双删〕只清当前代，擦除域
//    须全代清）；urlKeys→`videoWork:url:{key}` 族删（manifest 已派生全键形——:144 presign 缓存）；
//  ③**like/view 随作品 detach 保留**（`videoWork:like:{workId}:{userId}`/:488 `videoWork:view:` 键
//    不扫不删——作品行在册浏览/点赞语义保持——产品裁定 2026-11-05）；
//  ④完成=state='VERIFYING' 即停（列级断言+对象/Redis 零残留复验+DONE 归 verifying 执行体）；dryRun=
//    purgeScope/Redis 清除零调用（poller 不消费 dryRun 行——直调测试/admin 预览面）。
// kill -9 幂等：SCAN+DEL 谓词幂等（清后重扫零键）；purgeScope 端点幂等（键不在=零动作）。
import { Logger } from '@nestjs/common';
import type { ProjectErasureRun } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ErasureContextService } from './project-lock';
import { readErasureManifest, type ErasureManifest } from './project-erasure.manifest';
import { ERASURE_RUN_LEASE_MS } from './project-erasure';
import { erasureStageDuration, erasureRunsTotal } from './erasure.metrics';

/**
 * Redis 清除端口（ioredis 结构子集——scan 'MATCH'+'COUNT' 组合重载形/del/exists 三面可赋
 * 〔ioredis/stub〕；keys 恒禁——SCAN 渐进非阻塞）。 */
export interface RedisPurgePort {
  scan(cursor: string, patternToken: 'MATCH', pattern: string, countToken: 'COUNT', count: string): Promise<[string, string[]]>;
  del(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
}

/** purgeScope 客户端（worker→api 内部端点——null=不可达 fail-closed 本轮暂停）。 */
export type PurgeScopeClient = (projectIds: string[]) => Promise<boolean | null>;

/** SCAN 游标批量（渐进枚举步长——ioredis 惯例值：单轮候选键数非总上界）。 */
const SCAN_COUNT = 500;
/** DEL 批量上界（单命令键数防超大参数包）。 */
const DEL_BATCH = 1000;

/** 键形锚（R18 单源注记——真源=video-work.service.ts :52-56/:144；本文件=擦除域消费侧拷贝
 *  〔manifest.deriveRedisKeys 先例同源〕，漂移由红⑭ SCAN 断言钉住：键形错位=零清残留即红）。 */
const PROCESS_PREFIX = (workId: string) => `videoWork:process:${workId}:`;

/** SCAN 全前缀枚举（cursor 游标至 '0'——渐进非阻塞；count=步长）。 */
export async function scanPrefixKeys(redis: Pick<RedisPurgePort, 'scan'>, pattern: string): Promise<string[]> {
  const out: string[] = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', String(SCAN_COUNT));
    cursor = next;
    out.push(...keys);
  } while (cursor !== '0');
  return out;
}

/**
 * purgeWorkCaches（R18——manifest redis 段消费）：workIds 全前缀 SCAN 删+urlKeys 族删。
 * 返回删除键数（幂等——清后重跑零键零删）。like/view 键不在面（:60 likeKey/:488 view 键形
 * 与 process/url 前缀恒不相交——结构性保留非白名单豁免）。
 */
export async function purgeWorkCaches(
  redis: RedisPurgePort, workIds: readonly string[], urlKeys: readonly string[],
): Promise<number> {
  let purged = 0;
  for (const workId of workIds) {
    const keys = await scanPrefixKeys(redis, `${PROCESS_PREFIX(workId)}*`);
    for (let i = 0; i < keys.length; i += DEL_BATCH) {
      purged += await redis.del(...keys.slice(i, i + DEL_BATCH));
    }
  }
  for (let i = 0; i < urlKeys.length; i += DEL_BATCH) {
    purged += await redis.del(...urlKeys.slice(i, i + DEL_BATCH));
  }
  return purged;
}

/**
 * Redis 零残留复验（VERIFYING 消费——红⑭ 断言面）：process 全前缀 SCAN+url 键 exists。
 * 返回 violations（空=零残留）。
 */
export async function verifyRedisPurged(
  redis: RedisPurgePort, workIds: readonly string[], urlKeys: readonly string[],
): Promise<string[]> {
  const violations: string[] = [];
  for (const workId of workIds) {
    const left = await scanPrefixKeys(redis, `${PROCESS_PREFIX(workId)}*`);
    if (left.length > 0) violations.push(`Redis process 键残留 workId=${workId} ${left.length} 键（SCAN 全前缀零残留应成立）`);
  }
  for (let i = 0; i < urlKeys.length; i += DEL_BATCH) {
    const n = await redis.exists(...urlKeys.slice(i, i + DEL_BATCH));
    if (n > 0) violations.push(`Redis url 键残留 ${n} 键（videoWork:url:{key} 族应清）`);
  }
  return violations;
}

/** worker→api purgeScope 原生 fetch 客户端（httpMediaRefsCollector 同族：loopback+WORKER_WRITE_TOKEN
 *  bearer；单发不重试——不可达即 null 由下一 tick 兜底）。 */
export function httpPurgeScope(opts: { baseUrl?: string; token?: string } = {}): PurgeScopeClient {
  return async (projectIds) => {
    const baseUrl = (opts.baseUrl ?? `http://127.0.0.1:${process.env.PORT ?? '3000'}`).replace(/\/+$/, '');
    const token = opts.token ?? process.env.WORKER_WRITE_TOKEN;
    try {
      const res = await fetch(`${baseUrl}/api/collab/doc/purge-scope`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ projectIds }),
        signal: AbortSignal.timeout(10_000),
      });
      return res.status === 200;
    } catch {
      return null;   // 网络错误族（ECONNREFUSED/超时）——不可达档
    }
  };
}

/** stage 结果。 */
export type PurgingCacheStageResult =
  | { outcome: 'verifying'; purgedKeys: number }
  | { outcome: 'pending-api' }                       // purgeScope 不可达：停 PURGING_CACHE 续租等下轮
  | { outcome: 'dry-run'; workIds: number; urlKeys: number };

export interface PurgingCacheStageDeps {
  prisma: PrismaService;
  run: ProjectErasureRun;
  redis: RedisPurgePort;
  purgeScope?: PurgeScopeClient;
  /** manifest 覆写（**测试缝**——stub 面免盘/免 header-footer 全形；生产恒缺省走 readErasureManifest(manifestPath)）。 */
  manifestOverride?: Pick<ErasureManifest, 'redis'>;
}

/**
 * PURGING_CACHE 执行体（poller processProjectRun 消费——state=PURGING_CACHE 前置位起）。
 * 自包裹 ErasureContext（poller 双包裹幂等）。
 */
export async function executePurgingCacheStage(deps: PurgingCacheStageDeps): Promise<PurgingCacheStageResult> {
  const { prisma, run, redis } = deps;
  const logger = new Logger('ProjectErasureCache');
  const erasureCtx = new ErasureContextService();
  return erasureCtx.withErasure(run.erasureId, async () => {
    const t0 = Date.now();
    let result: PurgingCacheStageResult;
    try {
      // ① manifest 读（redis 段消费——workIds/urlKeys 派生面）
      const manifest = deps.manifestOverride ?? await readErasureManifest(run.manifestPath!);
      // ② dryRun：purgeScope/Redis 清除零调用（预览计数——完整 DRY_RUN 语义：介质清除跳过）
      if (run.dryRun) {
        return { outcome: 'dry-run', workIds: manifest.redis.workIds.length, urlKeys: manifest.redis.urlKeys.length };
      }
      // ③ purgeScope 首步（api 内存面——dedup/水位/世代计数/段索引+快照缓存 evict；不可达=本轮暂停）
      const purgeScope = deps.purgeScope ?? httpPurgeScope();
      const purgedApi = await purgeScope([run.scopeId]);
      if (purgedApi !== true) {
        const now = new Date();
        await prisma.projectErasureRun.update({
          where: { erasureId: run.erasureId },
          data: { state: 'PURGING_CACHE', heartbeatAt: now, leaseUntil: new Date(now.getTime() + ERASURE_RUN_LEASE_MS) },
        });
        logger.warn(JSON.stringify({ event: 'erasure_purge_scope_unreachable', erasureId: run.erasureId, projectId: run.scopeId, note: 'fail-closed 本轮暂停（api 内存面清键先行——下一 tick 重试）' }));
        return { outcome: 'pending-api' };
      }
      // ④ purgeWorkCaches（R18——全前缀 SCAN+url 族；like/view 保留）
      const purgedKeys = await purgeWorkCaches(redis, manifest.redis.workIds, manifest.redis.urlKeys);
      // ⑤ 前置位：VERIFYING 即停（列级断言+复验+DONE 归 verifying 执行体）
      const now = new Date();
      await prisma.projectErasureRun.update({
        where: { erasureId: run.erasureId },
        data: { state: 'VERIFYING', stage: 'PURGING_CACHE', heartbeatAt: now, leaseUntil: new Date(now.getTime() + ERASURE_RUN_LEASE_MS) },
      });
      erasureRunsTotal.inc({ state: 'VERIFYING' });
      logger.log(JSON.stringify({ event: 'erasure_purging_cache_done', erasureId: run.erasureId, projectId: run.scopeId, workIds: manifest.redis.workIds.length, urlKeys: manifest.redis.urlKeys.length, purgedKeys }));
      result = { outcome: 'verifying', purgedKeys };
      return result;
    } finally {
      erasureStageDuration.observe({ stage: 'PURGING_CACHE' }, (Date.now() - t0) / 1000);
    }
  });
}
