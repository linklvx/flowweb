// apps/api/src/modules/artifact-core/object-manifest.service.ts —— Y1c T23（迁移三——spec §6.3
// 资源回收：ObjectManifest 对象登记+delete-claim）。
// 机制（T19 登记 Y2「GC 变体枚举误删在飞对象」的收口）：**claimOwner/claimUntil 在位未过=GC 禁删**
// ——物化链上传 content-addressed 键前 claim（owner=materialize:<runId>）、锚定（Media.key 引用/
// 事务提交）后 release；claim 语义=同键新代无条件接管（content-addressed 键的当次持有者=最后一次
// claim——release 为 owner CAS，旧代 release 不得清新代 claim）。
// 有界 orphan=**manifest 行域内清扫**（禁全桶枚举）：claim 已过期∧无 Media.key 引用⇒对象删+行
// DELETED；从未 claim 的行（claimUntil NULL）按行龄门（ORPHAN_MIN_AGE_MS——防御档，正常写路径
// 恒经 claim）。sweep 周期轮询（R28 纪律：原生 setInterval+unref）。
import {
  Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';

/** sweep 轮询周期（orphan 面小时级足够——claim 保护期=物化 lease 20min 量级）。 */
export const OBJECT_MANIFEST_SWEEP_INTERVAL_MS = 3600_000;
/** 每轮清扫行上限（有界——单轮开销封顶，积压按轮消化）。 */
const SWEEP_PAGE = 100;
/** 从未 claim 行（claimUntil NULL）的行龄门——防御档（写路径恒经 claim；覆盖 materialize 崩溃窗
 *  与未接线遗留键的保守等待）。 */
export const ORPHAN_MIN_AGE_MS = 24 * 3600_000;

@Injectable()
export class ObjectManifestService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ObjectManifestService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private sweeping = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
  ) {}

  onModuleInit(): void {
    const t = setInterval(() => {
      void this.sweepOrphans().catch((e) => this.logger.warn(`objectManifestSweep: ${e}`));
    }, OBJECT_MANIFEST_SWEEP_INTERVAL_MS);
    t.unref?.();
    this.timer = t;
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** delete-claim（物化链上传前）：upsert 行+落 claimOwner/claimUntil——**同键新代无条件接管**
   *  （content-addressed 键当次持有者=最后一次 claim；旧代的 release 是 owner CAS 拒绝的——见
   *  releaseClaim）。claimUntil=epoch ms（BigInt 列）。 */
  async claim(objectKey: string, owner: string, untilMs: number): Promise<void> {
    await this.prisma.objectManifest.upsert({
      where: { objectKey },
      create: { objectKey, claimOwner: owner, claimUntil: BigInt(untilMs), state: 'LIVE' },
      update: { claimOwner: owner, claimUntil: BigInt(untilMs), state: 'LIVE' },
    });
  }

  /** release（锚定后——Media.key 已引用/事务已提交）：**owner CAS**——只有当次持有者能清自己的
   *  claim（旧代 release 对新代 claim 0 命中=不清新代保护）。 */
  async releaseClaim(objectKey: string, owner: string): Promise<void> {
    await this.prisma.objectManifest.updateMany({
      where: { objectKey, claimOwner: owner },
      data: { claimOwner: null, claimUntil: null },
    });
  }

  /** 有界 orphan 清扫（manifest 行域内——禁全桶枚举）：
   *  候选=state LIVE∧（claim 已过期 ∨ 〔claimUntil NULL∧行龄过界〕）∧无 Media.key 引用；
   *  动作=对象删（404 容忍）+行 state=DELETED。**claim 在位未过=禁删**（在飞物化键保护——GC 交
   *  错误删面收口）。返回本轮清扫行数。 */
  async sweepOrphans(now = Date.now()): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    try {
      const candidates = await this.prisma.$queryRaw<Array<{ id: string; objectKey: string }>>`
        SELECT m."id" AS id, m."objectKey" AS "objectKey" FROM "ObjectManifest" m
        WHERE m."state" = 'LIVE'
          AND (
            (m."claimUntil" IS NOT NULL AND m."claimUntil" < ${now}::bigint)
            OR (m."claimUntil" IS NULL AND m."createdAt" < (now() AT TIME ZONE 'utc') - interval '24 hours')
          )
          AND NOT EXISTS (SELECT 1 FROM "Media" d WHERE d."key" = m."objectKey")
        ORDER BY m."createdAt"
        LIMIT ${SWEEP_PAGE}`;
      let removed = 0;
      for (const c of candidates) {
        try {
          await this.minio.delete(c.objectKey);
        } catch (e) {
          const status = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
            ?? (e as { name?: string }).name;
          if (status !== 404 && status !== 'NoSuchKey') {
            this.logger.warn(`objectManifestSweep 对象删除失败（行保留待下轮）key=${c.objectKey}: ${e}`);
            continue;
          }
        }
        const r = await this.prisma.objectManifest.updateMany({
          where: { id: c.id, state: 'LIVE' },
          data: { state: 'DELETED' },
        });
        removed += r.count;
      }
      return removed;
    } finally {
      this.sweeping = false;
    }
  }
}
