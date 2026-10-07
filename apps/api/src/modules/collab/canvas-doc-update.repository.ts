import { Injectable, Inject, Logger } from '@nestjs/common';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma/prisma.service';
import {
  yjsCompactAbandonedTotal,
  yjsCompactNotOwnerTotal,
  yjsHydrationHugeRowTotal,
  yjsSnapshotReadTotal,
  yjsStoreCompactFailureTotal,
} from './store.metrics';

@Injectable()
export class CanvasDocUpdateRepository {
  private readonly logger = new Logger(CanvasDocUpdateRepository.name);

  // 显式 @Inject：vitest esbuild 不生成设计时类型元数据（同 collab-document.service 模式）
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 契约 16（v2.5）：唯一写者=CollabLeaseService（获取/失守/释放时调用）；owner=null ⇒
   *  append/compact 断言恒不通过=天然 fail-closed（P7：null 显式 throw——"lease service 从未注入"
   *  是排序/配置 bug，伪装 fenced 会误导自隔离方向）。禁逐调用点传参（漏传=静默破防）。 */
  private leaseOwner: string | null = null;
  setLeaseOwner(owner: string | null): void { this.leaseOwner = owner; }

  /** P23/V26 锁键单源：append/compact 共用——任何一处漂移=stateSeq 静默变谎话（配合
   *  canvas-doc-insert-ratchet.spec.ts 静态断言"INSERT 仅在本文件"形成双守卫）。 */
  private lockProject(
    tx: { $executeRaw: (q: TemplateStringsArray, ...values: unknown[]) => Promise<unknown> },
    projectId: string,
  ): Promise<unknown> {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId})::bigint)`;
  }

  /** Y0a-3 T3 fence 下沉：单语句原子 append（取号+插入同一语句——消灭两语句间进程死窗口）+
   *  owner-only 写断言（SV1：WHERE EXISTS CollabLease owner——去 TTL，TTL 不参与正确性判定）+
   *  与 compact 同 key advisory lock（SV3：seq 序≡提交序，stateSeq 保持可信水位）。
   *  返回契约（spec v2.5 契约 15）：AppendResult 判别类型——fenced=0 行**不抛异常**，调用方
   *  禁以"未抛错"判成功。0 行时二次查区分（v2.5 消静默）：行在=真 fenced；行被删=leaseRowMissing
   *  throw（配置错误，重试无用——gateway 落 spool 不排梯 SV13）。 */
  async append(projectId: string, update: Uint8Array): Promise<{ ok: true; seq: bigint } | { ok: false; reason: 'fenced' }> {
    const owner = this.leaseOwner;
    if (owner == null) throw Object.assign(new Error('append blocked: lease owner not set（契约 16 fail-closed）'), { leaseNotHeld: true });
    // V8（Y0a-2 复审 I-1 落地）：交互式事务显式上界（5s/1s）——裸 $queryRaw 无超时=挂起的 PG append
    // 无上界持 saveMutex→shutdown drain 等 doc 归零永不满足→恒走 destroy_timeout。与 loadForHydration
    // 同族（单语句事务体）；P2024（事务超时）以 throw 形态冒出——isRetryableAppendError 已含 P2024。
    const rows = await this.prisma.$transaction(
      async (tx) => {
        // SV3/W14：与 compact 同 key advisory lock——seq 序≡提交序（stateSeq 保持可信水位），
        // append×compact 竞态结构性消失；单锁无死锁面；亚毫秒级（仅同项目并发写时排队）。
        await this.lockProject(tx, projectId);
        return tx.$queryRaw<{ seq: bigint }[]>`
        INSERT INTO "CanvasDocUpdate" (id, "projectId", seq, update, "createdAt")
        SELECT gen_random_uuid()::text, ${projectId}, nextval('canvas_doc_update_seq')::bigint, ${Buffer.from(update)}, now()
        WHERE EXISTS (SELECT 1 FROM "CollabLease"
                       WHERE scope = 'primary' AND owner = ${owner})
        RETURNING seq`;
      },
      { timeout: 5_000, maxWait: 1_000 },
    );
    if (rows.length > 0) return { ok: true, seq: rows[0].seq };
    // 0 行=fenced（B2 不抛）。二次查区分（v2.5 消静默）：行被删=配置错误（leaseRowMissing，重试无用
    // ——gateway 落 spool 不排梯 SV13）；行在=确为 fenced（owner≠me）。
    const lease = await this.prisma.$queryRaw<{ owner: string | null }[]>`
      SELECT owner FROM "CollabLease" WHERE scope = 'primary'`;
    if (lease.length === 0) {
      throw Object.assign(
        new Error('CollabLease row missing（行被删——配置错误非 fenced；修复=补行后重启回灌）'),
        { leaseRowMissing: true },
      );
    }
    return { ok: false, reason: 'fenced' };
  }

  private static readonly PAGE_ROWS = 500;

  /** Y0a-1 装载读唯一入口（spec §4.3-1）：委托 readConsistent（契约 1"一个实现、两出口"——
   *  装载出口；opts 供自愈路径重试时收紧预算透传）。 */
  async loadForHydration(
    projectId: string,
    opts?: { timeoutMs?: number; maxWaitMs?: number },
  ): Promise<{ state: Buffer | null; updates: Buffer[]; stateSeq: bigint }> {
    return this.readConsistent(projectId, opts);
  }

  /** 契约 1（"一个实现、两出口"）：投影出口（video-work 快照）——不 apply 到 doc、不触 store/
   *  compact；与装载出口共用同一单 RR 事务实现，禁复制第二份。 */
  async readSnapshotOnly(projectId: string): Promise<{ state: Buffer | null; updates: Buffer[]; stateSeq: bigint }> {
    yjsSnapshotReadTotal.inc();
    return this.readConsistent(projectId);
  }

  /** 两出口共用实现体：单 RR 事务覆盖快照+全部分页增量（E42①(i)——MVCC 使 compact 的 DELETE
   *  对本快照不可见，撕裂结构性不存在）。apply 由调用方在事务外执行。
   *  SV3/W15：游标初值恒 0n——nextval 取号与提交序无绑定，水位过滤在绕锁路径下=静默丢内容；
   *  append 侧 advisory lock 已使 seq 序≡提交序（stateSeq 重新可信），读侧全量为双保险且正常路径等价。
   *  分页 seq>cursor 谓词保留——去掉谓词=满页死循环。
   *  预算规则：timeout 8s < 客户端 synced 死线 10s−2s；maxWait 2s（池排队由 connection_limit 承担）；
   *  opts 供自愈路径重试时收紧预算（契约 13 v2.4）。
   *  raw SQL 规则：bigint 参数一律显式 ::bigint。 */
  private async readConsistent(
    projectId: string,
    opts?: { timeoutMs?: number; maxWaitMs?: number },
  ): Promise<{ state: Buffer | null; updates: Buffer[]; stateSeq: bigint }> {
    return this.prisma.$transaction(
      async (tx) => {
        const docRow = await tx.canvasDoc.findUnique({ where: { projectId }, select: { state: true, stateSeq: true } });
        const updates: Buffer[] = [];
        let cursor = 0n;
        for (;;) {
          const page = await tx.$queryRaw<{ seq: bigint; update: Buffer }[]>`
            SELECT seq, update FROM "CanvasDocUpdate"
            WHERE "projectId" = ${projectId} AND seq > ${cursor}::bigint
            ORDER BY seq ASC LIMIT ${CanvasDocUpdateRepository.PAGE_ROWS}`;
          if (page.length === 0) break;
          for (const r of page) {
            if (r.update.length > 4 * 1024 * 1024) {
              // 单行巨帧：观测不拒绝（源头治理归 Y0b 配额批——已入库数据不该在装载侧 DoS 自己）
              yjsHydrationHugeRowTotal.inc();
              this.logger.warn(`huge hydration row ${projectId} seq=${r.seq} bytes=${r.update.length}`);
            }
            updates.push(r.update);
          }
          cursor = page[page.length - 1].seq;
          if (page.length < CanvasDocUpdateRepository.PAGE_ROWS) break;
        }
        return { state: docRow?.state ?? null, updates, stateSeq: docRow?.stateSeq ?? 0n };
      },
      { isolationLevel: 'RepeatableRead', timeout: opts?.timeoutMs ?? 8_000, maxWait: opts?.maxWaitMs ?? 2_000 },
    );
  }

  /** Y0a-1 超时自愈一次（契约 §4.3-13·v2.4：**仅可重试类触发，P2024 排除**）：装载事务失败且属
   *  P2028/P1008 或 timeout 语义 → 串行跑 compact{6s/1s}（装载事务已回滚，无并发装载——与 E42⑤
   *  "装载进行中 compact"警示不同态，注释写明时序）→ 以收紧预算 {2s/500ms} 重试装载一次——
   *  **自愈增量总 ≤8s**（v2.4 从 60s 下调：60s 挂在客户端已放弃的请求上下文=零收益纯挂 Nest handler
   *  与池连接，违 §7.2 预算规则；例外路径声明见 §7.2）。
   *  P2024（连接池取连接超时——池饥饿非事务超时）**不在自愈集**：compact 是交互式事务自身需持池
   *  连接，饥饿期执行=零成功率纯放大——直接上抛 fail-closed；P1000/P1001/P1010/P1017 同不放大。
   *  compact 自身失败→WARN+`yjsStoreCompactFailureTotal` 计数后**仍重试装载**（契约 13：不构成新
   *  fail-closed 死锁）；仍失败才向上抛（外层折 db-unavailable）。禁前置全量聚合探测（v2.2 证伪）。 */
  private static readonly RETRYABLE_HYDRATION_CODES = new Set(['P2028', 'P1008']);   // v2.4：P2024 移出（池饥饿）
  private isRetryableHydrationError(e: unknown): boolean {
    const code = (e as { code?: string })?.code;
    // code 存在即终判（不走 message 回退）：P2024 的排除不得依赖 Prisma 措辞——未来消息若改成
    // "connection pool timeout" 字样，message 回退会把池饥饿重新拉进自愈集=饥饿期零成功率纯放大
    if (code != null) return CanvasDocUpdateRepository.RETRYABLE_HYDRATION_CODES.has(code);
    return e instanceof Error && /timeout/i.test(e.message);
  }

  async hydrateWithRecovery(projectId: string): Promise<{ state: Buffer | null; updates: Buffer[]; stateSeq: bigint }> {
    try {
      return await this.loadForHydration(projectId);
    } catch (first) {
      if (!this.isRetryableHydrationError(first)) throw first;
      try {
        await this.compact(projectId, { timeoutMs: 6_000, maxWaitMs: 1_000 });
      } catch (compactErr) {
        yjsStoreCompactFailureTotal.inc();
        this.logger.warn(`hydrate recovery compact failed for ${projectId}: ${(compactErr as Error).message}`);
      }
      return this.loadForHydration(projectId, { timeoutMs: 2_000, maxWaitMs: 500 });   // 重试一次；仍失败向上抛
    }
  }

  async count(projectId: string): Promise<number> {
    return this.prisma.canvasDocUpdate.count({ where: { projectId } });
  }

  /** Y0a-1 compact（spec v2.5 §1.3）：事务首行租约断言（SV8：owner-only，先于 advisory lock——
   *  无权者不排队不删行）后按实读行 id 精确删除（被删集≡被重放集）；stateSeq 精确 =maxSeq
   *  （精确赋值依赖 advisory lock 串行——去锁并发化必须先落 Y1c-1 CAS 形态，禁 GREATEST/单调化包装）；
   *  返回契约 {compacted,reason}：empty=无行静默；not-owner=租约档拒绝（SV8 分立计数，行数不减）；
   *  abandoned=pendingStructs!=null 放弃本次——计数+ERROR 落本分支单点（gateway 与装载自愈两路覆盖，
   *  防双计），**禁 throw**（gateway :297-301 catch 会把它计入 yjsStoreCompactFailureTotal=污染
   *  abandoned 的 P0 告警线；not-owner 同理不抛——调用方只看 compacted）。
   *  （SV inline 哨兵已删——pendingStructs 检查通过前提下 per-row SV 支配性恒真，探针证伪见 spec §1.5。）
   *  opts：交互式事务独立预算（自愈路径 6s/1s·运维脚本 120s/5s；默认 5s/2s 与 Prisma 隐含值对齐）。 */
  async compact(
    projectId: string,
    opts?: { timeoutMs?: number; maxWaitMs?: number },
  ): Promise<{ compacted: boolean; reason?: 'abandoned' | 'empty' | 'not-owner' }> {
    return this.prisma.$transaction(
      async (tx) => {
        const owner = this.leaseOwner;
        if (owner == null) throw Object.assign(new Error('compact blocked: lease owner not set（契约 16 fail-closed）'), { leaseNotHeld: true });
        const fence = await tx.$queryRaw<{ ok: number }[]>`
          SELECT 1 AS ok WHERE EXISTS (SELECT 1 FROM "CollabLease" WHERE scope = 'primary' AND owner = ${owner})`;
        if (fence.length === 0) {
          const row = await tx.$queryRaw<{ owner: string | null }[]>`
            SELECT owner FROM "CollabLease" WHERE scope = 'primary'`;
          if (row.length === 0) {
            throw Object.assign(new Error('CollabLease row missing（compact fence）'), { leaseRowMissing: true });
          }
          yjsCompactNotOwnerTotal.inc();   // SV8：not-owner 分立（abandoned=pendingStructs 专用不污染）
          this.logger.warn(`compact not-owner for ${projectId}（租约档——行数不减）`);
          return { compacted: false, reason: 'not-owner' as const };
        }
        await this.lockProject(tx, projectId);   // P23：锁键单源（与 append 同 helper）
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
