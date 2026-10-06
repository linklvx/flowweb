import { Injectable, Inject } from '@nestjs/common';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CanvasDocUpdateRepository {
  // 显式 @Inject：vitest esbuild 不生成设计时类型元数据（同 collab-document.service 模式）
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 全局 Postgres SEQUENCE 取号：多实例并发下全局单调（spec 2.1） */
  async nextSeq(): Promise<bigint> {
    const rows = await this.prisma.$queryRaw<{ seq: bigint }[]>`SELECT nextval('canvas_doc_update_seq') AS seq`;
    return rows[0].seq;
  }

  /** Y0a-1：单语句原子 append（取号+插入同一语句——消灭两语句间进程死窗口）。
   *  返回契约（spec v2.4 §1.2/契约 15）：AppendResult 判别类型——fenced=0 行**不抛异常**，调用方
   *  禁以"未抛错"判成功；本批无租约断言恒 {ok:true}（WHERE owner+TTL 断言 Y0a-3 追加，届时 0 行
   *  返回 {ok:false,reason:'fenced'}——签名本批一步定死，防 Y0a-3 中途改签名连锁）。 */
  async append(projectId: string, update: Uint8Array): Promise<{ ok: true; seq: bigint } | { ok: false; reason: 'fenced' | 'no-row' }> {
    const rows = await this.prisma.$queryRaw<{ seq: bigint }[]>`
      INSERT INTO "CanvasDocUpdate" (id, "projectId", seq, update, "createdAt")
      SELECT gen_random_uuid()::text, ${projectId}, nextval('canvas_doc_update_seq')::bigint, ${Buffer.from(update)}, now()
      RETURNING seq`;
    return rows.length === 0 ? { ok: false, reason: 'no-row' } : { ok: true, seq: rows[0].seq };
  }

  async loadUpdates(projectId: string): Promise<Buffer[]> {
    const rows = await this.prisma.canvasDocUpdate.findMany({
      where: { projectId },
      orderBy: { seq: 'asc' },
      select: { update: true },
    });
    return rows.map((r) => r.update);
  }

  async count(projectId: string): Promise<number> {
    return this.prisma.canvasDocUpdate.count({ where: { projectId } });
  }

  /**
   * flush-then-compact 的 compaction 事务（spec 2.2）：
   * 快照从 Postgres 权威数据重放构建（不信任内存）；DELETE 带 seq <= maxSeq
   * 防误删事务期间其他实例新 append 的行。
   * 调用方（gateway）不消费返回值——水位由 pending 队列自身表达。
   * 临时 doc 用完即弃、不广播，不违反"严禁自建 Y.Doc"双轨铁律。
   */
  async compact(projectId: string): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId})::bigint)`;
        const maxRows = await tx.$queryRaw<{ max: bigint | null }[]>`
          SELECT max(seq) AS max FROM "CanvasDocUpdate" WHERE "projectId" = ${projectId}`;
        const maxSeq = maxRows[0]?.max;
        if (maxSeq == null) return;
        const docRow = await tx.canvasDoc.findUnique({ where: { projectId } });
        const updates = await tx.canvasDocUpdate.findMany({
          where: { projectId, seq: { lte: maxSeq } },
          orderBy: { seq: 'asc' },
          select: { update: true },
        });
        const temp = new Y.Doc();
        if (docRow) Y.applyUpdate(temp, new Uint8Array(docRow.state));
        for (const u of updates) Y.applyUpdate(temp, new Uint8Array(u.update));
        const newSnapshot = Y.encodeStateAsUpdate(temp);
        temp.destroy();
        await tx.canvasDoc.upsert({
          where: { projectId },
          update: { state: Buffer.from(newSnapshot) },
          create: { projectId, state: Buffer.from(newSnapshot) },
        });
        await tx.canvasDocUpdate.deleteMany({ where: { projectId, seq: { lte: maxSeq } } });
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
