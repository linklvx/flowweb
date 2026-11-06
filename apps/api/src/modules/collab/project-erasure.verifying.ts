// apps/api/src/modules/collab/project-erasure.verifying.ts
// C4-c2（plan Task C4-3 ★红⑪ 完整锚——生产就绪收尾批·project-erasure）：VERIFYING **执行体**
// （objects/cache 同族；census ⑰ 闭包纯度=prisma/manifest/assert 族，零 controller/Http 面）。
//
// 三重复验→DONE（spec §3 C4 saga 终段）：
//  ①**列级断言复用**（assertProjectErasureDbComplete——C4-c1 红⑯ registry 全表清点+AuditLog 脱敏；
//    forbiddenContent=并集 manifest 介质键族派生）；
//  ②**对象零残留复验**（删除面=manifest−DB 现存——同 PURGING_OBJECTS 派生单源；逐键版本化/Head 核验
//    ——kill -9 于各删除批后重算面幂等收敛）；
//  ③**Redis 零残留复验**（verifyRedisPurged——process 全前缀 SCAN+url 键 exists）；
//  ④violations 非空=throw（租约恢复面重试——不折零假绿）；全绿→state=DONE（**team run
//    WAITING_CHILDREN 会合判定由此自动推进——子 run DONE 链：poller processTeamRun 每 tick 重判）。
//  dryRun=三重复验只读面照跑（断言面完整）但**零状态写**（DONE 不置——介质未删断言必红属预期预览）；
//  poller 不消费 dryRun 行（直调测试/admin 预览面——完整 DRY_RUN 语义定形）。
import { Logger } from '@nestjs/common';
import type { ProjectErasureRun } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ErasureContextService } from './project-lock';
import { readErasureManifest, type ErasureManifest } from './project-erasure.manifest';
import { assertProjectErasureDbComplete, type ErasureAssertDb } from './project-erasure.assert';
import { deriveObjectDeletionSurface, querySurvivingMediaIds, verifyObjectsPurged, type ErasureObjectPort } from './project-erasure.objects';
import { verifyRedisPurged, type RedisPurgePort } from './project-erasure.cache';
import { erasureStageDuration, erasureRunsTotal } from './erasure.metrics';

/** stage 结果。 */
export type VerifyingStageResult =
  | { outcome: 'done'; objectKeys: number; workIds: number; urlKeys: number }
  | { outcome: 'dry-run'; violationsPreview: number };

export interface VerifyingStageDeps {
  prisma: PrismaService;
  run: ProjectErasureRun;
  objects: ErasureObjectPort;
  redis: RedisPurgePort;
  /** manifest 覆写（**测试缝**——stub 面免盘/免 header-footer 全形；生产恒缺省走 readErasureManifest(manifestPath)）。 */
  manifestOverride?: Pick<ErasureManifest, 'media' | 'work' | 'spool' | 'redis'>;
  /** DB 现存 id 覆写（**测试缝**——同上）。 */
  survivingMediaIdsOverride?: ReadonlySet<string>;
}

/**
 * VERIFYING 执行体（poller processProjectRun 消费——state=VERIFYING 前置位起）。自包裹
 * ErasureContext（poller 双包裹幂等）。kill -9/复验红重跑幂等（三面全只读重算）。
 */
export async function executeVerifyingStage(deps: VerifyingStageDeps): Promise<VerifyingStageResult> {
  const { prisma, run, objects, redis } = deps;
  const logger = new Logger('ProjectErasureVerifying');
  const erasureCtx = new ErasureContextService();
  return erasureCtx.withErasure(run.erasureId, async () => {
    const t0 = Date.now();
    let result: VerifyingStageResult;
    try {
      const pid = run.scopeId;
      // ① manifest 读+删除面重算（与 PURGING_OBJECTS 同派生单源——幂等）
      const manifest = deps.manifestOverride ?? await readErasureManifest(run.manifestPath!);
      const surviving = deps.survivingMediaIdsOverride ?? await querySurvivingMediaIds(prisma, manifest.media.map((m) => m.id));
      const surface = deriveObjectDeletionSurface(manifest.media, surviving);
      // ② 三重复验（violations 聚合——非空即 throw 走租约恢复面）
      const violations: string[] = [];
      violations.push(...(await assertProjectErasureDbComplete(prisma as unknown as ErasureAssertDb, pid, {
        forbiddenContent: [
          ...manifest.media.flatMap((m) => [m.key, m.thumbnailKey, m.objectKey]),
          ...manifest.work.flatMap((w) => [w.videoKey, w.coverKey]),
        ].filter((k): k is string => typeof k === 'string' && k.length > 0),
      })).violations);
      violations.push(...await verifyObjectsPurged(objects, surface.keys));
      violations.push(...await verifyRedisPurged(redis, manifest.redis.workIds, manifest.redis.urlKeys));
      if (violations.length > 0) {
        throw new Error(`VERIFYING 复验红（${pid}）: ${violations.join('；')}`);
      }
      // ③ dryRun：三重复验只读面已跑、零状态写（预览=violations 恒 0 才到此——介质未删时上方已 throw）
      if (run.dryRun) return { outcome: 'dry-run', violationsPreview: 0 };
      // ④ DONE（终态：completedAt 落档+claim/lease 清——team run 会合判定自动推进面）
      await prisma.projectErasureRun.update({
        where: { erasureId: run.erasureId },
        data: { state: 'DONE', stage: 'VERIFYING', completedAt: new Date(), claimOwner: null, leaseUntil: null },
      });
      erasureRunsTotal.inc({ state: 'DONE' });
      logger.log(JSON.stringify({ event: 'erasure_done', erasureId: run.erasureId, projectId: pid, objectKeys: surface.keys.length, workIds: manifest.redis.workIds.length, urlKeys: manifest.redis.urlKeys.length }));
      result = { outcome: 'done', objectKeys: surface.keys.length, workIds: manifest.redis.workIds.length, urlKeys: manifest.redis.urlKeys.length };
      return result;
    } finally {
      erasureStageDuration.observe({ stage: 'VERIFYING' }, (Date.now() - t0) / 1000);
    }
  });
}
