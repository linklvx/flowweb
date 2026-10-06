import { Injectable, Inject, Logger } from '@nestjs/common';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma/prisma.service';
import { yjsCompactAbandonedTotal } from './store.metrics';

@Injectable()
export class CanvasDocUpdateRepository {
  private readonly logger = new Logger(CanvasDocUpdateRepository.name);

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

  /** Y0a-1 compact（spec v2.4 §1.3）：按实读行 id 精确删除（被删集≡被重放集）；stateSeq 精确 =maxSeq
   *  （精确赋值依赖 advisory lock 串行——去锁并发化必须先落 Y1c-1 CAS 形态，禁 GREATEST/单调化包装）；
   *  返回契约 {compacted,reason}：empty=无行静默；abandoned=pendingStructs!=null 放弃本次——计数+ERROR
   *  落本分支单点（gateway 与装载自愈两路覆盖，防双计），**禁 throw**（gateway :297-301 catch 会把它计入
   *  yjsStoreCompactFailureTotal=污染 abandoned 的 P0 告警线）。
   *  （SV inline 哨兵已删——pendingStructs 检查通过前提下 per-row SV 支配性恒真，探针证伪见 spec §1.5。）
   *  opts：交互式事务独立预算（自愈路径 6s/1s·运维脚本 120s/5s；默认 5s/2s 与 Prisma 隐含值对齐）。 */
  async compact(
    projectId: string,
    opts?: { timeoutMs?: number; maxWaitMs?: number },
  ): Promise<{ compacted: boolean; reason?: 'abandoned' | 'empty' }> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId})::bigint)`;
        const rows = await tx.canvasDocUpdate.findMany({
          where: { projectId },
          orderBy: { seq: 'asc' },
          select: { id: true, seq: true, update: true },
        });
        if (rows.length === 0) return { compacted: false, reason: 'empty' as const };
        const maxSeq = rows[rows.length - 1].seq;
        const docRow = await tx.canvasDoc.findUnique({ where: { projectId } });
        const temp = new Y.Doc();
        if (docRow) Y.applyUpdate(temp, new Uint8Array(docRow.state));
        for (const r of rows) Y.applyUpdate(temp, new Uint8Array(r.update));
        if (temp.store.pendingStructs !== null) {
          yjsCompactAbandonedTotal.inc();
          this.logger.error(`compact abandoned (pendingStructs non-null) for ${projectId}——保留全部行，下次 store 立即重试`);
          return { compacted: false, reason: 'abandoned' as const };   // 空事务提交：不写不删，行全保留
        }
        const newSnapshot = Y.encodeStateAsUpdate(temp);
        temp.destroy();
        await tx.canvasDoc.upsert({
          where: { projectId },
          update: { state: Buffer.from(newSnapshot), stateSeq: maxSeq },
          create: { projectId, state: Buffer.from(newSnapshot), stateSeq: maxSeq },
        });
        await tx.canvasDocUpdate.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
        return { compacted: true };
      },
      { isolationLevel: 'RepeatableRead', timeout: opts?.timeoutMs ?? 5_000, maxWait: opts?.maxWaitMs ?? 2_000 },
    );
  }
}
