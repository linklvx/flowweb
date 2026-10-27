// apps/api/src/modules/artifact-core/object-manifest.service.ts —— Y1c T23（迁移三——spec §6.3
// 资源回收：ObjectManifest 对象登记+delete-claim）。T23 收口批 C-1 根修：GC 清扫 TOCTOU——
// 删除动作以**删除时点谓词**为准（候选谓词只在 SELECT 评估一次的旧形态：select→逐行 MinIO IO
// 秒级窗内新代 claim 同键/锚定先行 ⇒ 误删在飞对象）。修=先 CAS 后删：行 LIVE→SWEEPING 的 CAS
// 携删除时点谓词复检（claim 过期/行龄门仍成立∧无 Media.key 引用），命中才 minio.delete；
// SWEEPING 崩溃行由下轮候选重派（谓词复检后同序收尾；期间被 claim/锚定=归还 LIVE 让渡）。
// 机制（T19 登记 Y2「GC 变体枚举误删在飞对象」的收口）：**claimOwner/claimUntil 在位未过=GC
// 禁删**——物化链上传 content-addressed 键前 claim（owner=materialize:<mediaId>——一行物化一
// 个当次持有者）、锚定（Media.key 引用/事务提交）后 release；claim 语义=同键新代无条件接管
// （content-addressed 键的当次持有者=最后一次 claim——release 为 owner CAS，旧代 release 不得
// 清新代 claim）。
// 有界 orphan=**manifest 行域内清扫**（禁全桶枚举）：SWEEPING CAS 谓词命中（claim 已过期∧无
// Media.key 引用）⇒对象删+行 DELETED；从未 claim 的行（claimUntil NULL）按行龄门
// （ORPHAN_MIN_AGE_MS——防御档，正常写路径恒经 claim）。sweep 周期轮询（R28 纪律：原生
// setInterval+unref）。
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

  /** 有界 orphan 清扫（manifest 行域内——禁全桶枚举）。C-1（收口批）先 CAS 后删：
   *  ①候选 SELECT（LIVE∨SWEEPING〔上轮崩溃重派〕∧claim 过期/行龄门）仅作行集圈定（advisory）；
   *  ②逐行 CAS=UPDATE state→'SWEEPING' 携**删除时点谓词复检**（claim 过期/行龄门仍成立∧
   *    NOT EXISTS Media.key 引用——select 后窗内新代 claim 同键/锚定先行=CAS 0 命中跳过，
   *    SWEEPING 崩溃行归还 LIVE）；
   *  ③CAS 命中才 minio.delete（对象删除永远是最后一步——404 容忍；其他错误行回 LIVE 保留下轮）；
   *  ④行 → DELETED。
   *  afterSelect=并发窗测试缝（C-1 红测注入点——候选 SELECT 之后逐行处理之前；生产恒缺省）。 */
  async sweepOrphans(now = Date.now(), afterSelect?: () => Promise<void>): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    try {
      const candidates = await this.prisma.$queryRaw<Array<{ id: string; objectKey: string }>>`
        SELECT "id" AS id, "objectKey" AS "objectKey" FROM "ObjectManifest"
        WHERE "state" IN ('LIVE', 'SWEEPING')
          AND (
            ("claimUntil" IS NOT NULL AND "claimUntil" < ${now}::bigint)
            OR ("claimUntil" IS NULL AND "createdAt" < (now() AT TIME ZONE 'utc') - interval '24 hours')
          )
        ORDER BY "createdAt"
        LIMIT ${SWEEP_PAGE}`;
      if (afterSelect) await afterSelect();
      let removed = 0;
      for (const c of candidates) {
        // CAS：删除时点谓词复检（claim 门+无 Media.key 引用——与候选谓词同式但于删除时点评估）
        const cas = await this.prisma.$queryRaw<Array<{ objectKey: string }>>`
          UPDATE "ObjectManifest" SET "state" = 'SWEEPING', "updatedAt" = (now() AT TIME ZONE 'utc')
          WHERE "id" = ${c.id}::text AND "state" IN ('LIVE', 'SWEEPING')
            AND (
              ("claimUntil" IS NOT NULL AND "claimUntil" < ${now}::bigint)
              OR ("claimUntil" IS NULL AND "createdAt" < (now() AT TIME ZONE 'utc') - interval '24 hours')
            )
            AND NOT EXISTS (SELECT 1 FROM "Media" d WHERE d."key" = "ObjectManifest"."objectKey")
          RETURNING "objectKey"`;
        if (cas.length === 0) {
          // 删除时点保护命中（select 后窗内新代 claim 在位/已锚定）——不删；SWEEPING 崩溃行归还 LIVE
          await this.prisma.objectManifest.updateMany({
            where: { id: c.id, state: 'SWEEPING' },
            data: { state: 'LIVE' },
          }).catch(() => undefined);
          continue;
        }
        try {
          await this.minio.delete(c.objectKey);
        } catch (e) {
          const status = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
            ?? (e as { name?: string }).name;
          if (status !== 404 && status !== 'NoSuchKey') {
            this.logger.warn(`objectManifestSweep 对象删除失败（行保留待下轮）key=${c.objectKey}: ${e}`);
            await this.prisma.objectManifest.updateMany({
              where: { id: c.id, state: 'SWEEPING' },
              data: { state: 'LIVE' },
            }).catch(() => undefined);
            continue;
          }
        }
        const r = await this.prisma.objectManifest.updateMany({
          where: { id: c.id, state: 'SWEEPING' },
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
