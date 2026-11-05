// apps/api/src/modules/collab/runtime-feed.retention.service.ts
// C1-1（plan Task C1-1——生产就绪收尾批，spec v5 §7）：RuntimeEvent 保留期清理 worker 侧服务
// （自 api RuntimeFeedService.sweepRetention 迁 worker——api timer/武装移除；本文件=worker 专用面，
// api 进程不注册）。7d/100k 先到为准：
//  - 100k 上限=**lastSeq−100_000 feedSeq 边界法**（feedSeq 分配稠密 1..lastSeq〔cursor upsert +1〕
//    ⇒ feedSeq≤boundary 恒为保留窗外最旧 100k 次分配之外——原计数法 skip excess-1 全表扫废止；
//    lastSeq<100k ⇒ boundary 负数恒不命中=时间窗单判）；
//  - 7d 时间窗=createdAt<(now() AT TIME ZONE 'UTC')−7d（Prisma timestamp 列=UTC 墙钟——裸 now()
//    受会话时区 Asia/Shanghai +08 影响窗口平移 8h，实测同因）。
// 批内 DELETE ... RETURNING octet_length 循环至空（loop-to-empty——poller tick 事务内消费）。
// scope ACTIVE 过滤（C1）：join CanvasProject.lifecycleState='ACTIVE'+Team.status='ACTIVE'
// （DELETING/DISBANDING 零触碰——擦除中项目行集与 retention 不相交）。
// minRetainedSeq 推进=api 旧 sweep 语义原样（现存最小 feedSeq−1；全删空=lastSeq 快照档；
// 无删除轮亦收敛——红⑦ 迁移前后对拍锚）。bytes 面：sweep 返回删除字节（计数器维护素材——
// runtime_feed_bytes gauge 基线+累减在 poller；SUM 全表扫每轮废止）。
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { RUNTIME_EVENT_RETENTION_DAYS, RUNTIME_EVENT_RETENTION_MAX_PER_PROJECT } from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';

/** event 扫面单批删除行数（loop-to-empty——同 tick 内循环至空）。 */
export const RUNTIME_EVENT_DELETE_BATCH = 500;

@Injectable()
export class RuntimeFeedRetentionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * 单轮事件清理（poller tick 事务内）：ACTIVE 项目逐个批删至空+推进 minRetainedSeq。
   * 返回 {deleted, deletedBytes, projects}——deletedBytes=删除批 RETURNING octet_length 和
   * （runtime_feed_bytes 计数器维护素材；projects=有删除行的项目数）。
   */
  async sweepEventsInTx(tx: Prisma.TransactionClient): Promise<{ deleted: number; deletedBytes: number; projects: number }> {
    const projects = await tx.$queryRaw<{ projectId: string; lastSeq: bigint }[]>`
      SELECT f."projectId", f."lastSeq" FROM "RuntimeFeedCursor" f
      JOIN "CanvasProject" p ON p."id" = f."projectId" AND p."lifecycleState" = 'ACTIVE'
      JOIN "Team" t ON t."id" = p."teamId" AND t."status" = 'ACTIVE'`;
    let deleted = 0;
    let deletedBytes = 0;
    let touched = 0;
    for (const p of projects) {
      const boundary = p.lastSeq - BigInt(RUNTIME_EVENT_RETENTION_MAX_PER_PROJECT);   // 100k 边界法（负数恒不命中）
      let batchDeleted = 0;
      for (;;) {
        const rows = await tx.$queryRaw<{ bytes: number }[]>`
          DELETE FROM "RuntimeEvent"
          WHERE "id" IN (
            SELECT "id" FROM "RuntimeEvent"
            WHERE "projectId" = ${p.projectId}::text
              AND ("feedSeq" <= ${boundary}
                OR "createdAt" < ((now() AT TIME ZONE 'UTC') - (${RUNTIME_EVENT_RETENTION_DAYS} * interval '1 day')))
            ORDER BY "feedSeq" ASC
            LIMIT ${RUNTIME_EVENT_DELETE_BATCH}
          )
          RETURNING octet_length(payload::text) AS bytes`;
        batchDeleted += rows.length;
        deletedBytes += rows.reduce((s, r) => s + Number(r.bytes), 0);
        if (rows.length < RUNTIME_EVENT_DELETE_BATCH) break;   // 批不满=排空（loop-to-empty 出口）
      }
      deleted += batchDeleted;
      if (batchDeleted > 0) touched += 1;
      // minRetainedSeq=现存最小 feedSeq−1（全删空=lastSeq——api 旧 sweep 语义原样对拍）
      const minRow = await tx.runtimeEvent.findFirst({ where: { projectId: p.projectId }, orderBy: { feedSeq: 'asc' }, select: { feedSeq: true } });
      const minRetained = minRow ? minRow.feedSeq - 1n : p.lastSeq;
      const cursor = await tx.runtimeFeedCursor.findUnique({ where: { projectId: p.projectId } });
      if ((cursor?.minRetainedSeq ?? 0n) !== minRetained) {
        await tx.runtimeFeedCursor.updateMany({ where: { projectId: p.projectId }, data: { minRetainedSeq: minRetained } });
      }
    }
    return { deleted, deletedBytes, projects: touched };
  }

  /** boot 基线（runtime_feed_bytes 计数器维护——全表 SUM 仅此一次：此后删除批累减，
   *  api 侧每轮 SUM 扫废止。低估方向漂移〔boot 后 api 新写入不计数〕+worker 重启重播种）。 */
  async bytesBaseline(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ bytes: bigint | null }[]>`
      SELECT COALESCE(SUM(octet_length(payload::text)), 0) AS bytes FROM "RuntimeEvent"`;
    return Number(rows[0]?.bytes ?? 0n);
  }
}