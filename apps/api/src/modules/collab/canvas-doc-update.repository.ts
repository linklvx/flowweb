import { Injectable, Inject, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { createCanvasDoc } from './canvas-doc.factory';
import { PrismaService } from '../../prisma/prisma.service';
import { captureCollabException } from '../../utils/sentry-scrub';
import {
  yjsCompactAbandonedTotal,
  yjsCompactNotOwnerTotal,
  yjsHydrationHugeRowTotal,
  yjsSnapshotReadTotal,
  yjsStoreCompactFailureTotal,
} from './store.metrics';

/** T18（Y1b T2）：一致读行形状（readConsistent 单源——装载/快照两出口共用）。
 *  schemaVersion=CanvasDoc PG 列（版本门唯一判据；null=行缺失——懒建档，装载门放行）。 */
export interface HydrationRow {
  state: Buffer | null;
  updates: Buffer[];
  stateSeq: bigint;
  preVacuumSv?: Buffer | null;
  generation?: number;
  schemaVersion?: number | null;
}

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

  /** P23/V26 锁键单源：**T10 后仅 vacuumReplace 消费**（T12 状态机化收口）——append/compact 已去锁
   *  （census⑩：actor 单写者+WAL walSeq 构造性保证 seq 序≡提交序；compact 一致性=RR 快照）。跨进程
   *  同键消费=scripts/collab-renumber-layer.mjs（离线 CLI——api 停写前提下与 vacuumReplace 互斥保险）。 */
  private lockProject(
    tx: { $executeRaw: (q: TemplateStringsArray, ...values: unknown[]) => Promise<unknown> },
    projectId: string,
  ): Promise<unknown> {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId})::bigint)`;
  }

  /** T9：批 updateHash 单源（=有序 frameHash 列表 SHA-256——非 merged update 字节；重试/重组批幂等键）。
   *  actor drain 批/维护单帧/回灌行共用（禁第二份实现）。frameHash=SHA-256(payload) 32B 原始字节。 */
  static batchUpdateHash(frameHashes: ReadonlyArray<Uint8Array>): string {
    return createHash('sha256').update(Buffer.concat(frameHashes.map((h) => Buffer.from(h)))).digest('hex');
  }

  /** T9：单帧行构造便捷面（frameHash 由调用方算好——spool/actor 共用 walSeq 口径）。 */
  static singleFrameRow(input: { generation: number; walSeq: bigint; frameHash: Uint8Array; update: Uint8Array; actorRanges?: unknown }) {
    return {
      generation: input.generation,
      firstWalSeq: input.walSeq,
      lastWalSeq: input.walSeq,
      frameCount: 1,
      updateHash: CanvasDocUpdateRepository.batchUpdateHash([input.frameHash]),
      update: input.update,
      ...(input.actorRanges !== undefined ? { actorRanges: input.actorRanges } : {}),
    };
  }

  /** Y0a-3 T3 fence 下沉：单语句原子 append（取号+插入同一语句——消灭两语句间进程死窗口）+
   *  owner-only 写断言（SV1：WHERE EXISTS CollabLease owner——去 TTL，TTL 不参与正确性判定）+
   *  与 compact 同 key advisory lock（SV3：seq 序≡提交序，stateSeq 保持可信水位）。
   *  返回契约（spec v2.5 契约 15）：AppendResult 判别类型——fenced=0 行**不抛异常**，调用方
   *  禁以"未抛错"判成功。0 行时二次查区分（v2.5 消静默）：行在=真 fenced；行被删=leaseRowMissing
   *  throw（配置错误，重试无用——gateway 落 spool 不排梯 SV13）。 */
  /** Y1c T9 批行（新表形态——Controller 裁定 1：actor drain 批同事务多行 append；T10 精化 applied-driven
   *  连续批+水位 CAS）：行 seq=WAL 帧序号（firstWalSeq..lastWalSeq 单调）；ON CONFLICT DO NOTHING
   *  （无目标谓词=覆盖 PK+updateHash 双唯一）——updateHash=有序 frameHash 列表 SHA-256（重试/重组批幂等）。
   *  **T10 水位 CAS（v1.7 拆义——同事务原子）**：wm.expectedPgSeq 非 null=actor 单写者 CAS 形态
   *  （`UPDATE CanvasDoc SET walCheckpointSeq=<提交时刻 spoolHeadSeq>, pgSeq=$new WHERE projectId AND
   *  generation AND pgSeq=$expected RETURNING`——永不写 appliedSeq 口径）；null=恢复回灌 catch-up 形态
   *  （`SET pgSeq=$new WHERE pgSeq<$new` 单调追赶——replayAll 消费，禁回退）。CAS 0 行两分：pgSeq 已
   *  ≥new（回灌/reconciler 并发收敛——updateHash 幂等已覆盖）=ok；否则 fenced。
   *  **T10 删 advisory lock（census⑩）**：append/compact 不再取锁——actor 单写者+WAL walSeq 使「seq 序≡
   *  提交序」由构造保证（行 seq=已 fsync 的 walSeq，非 DB 取号）；compact 一致性=RR 快照（DELETE 只删
   *  快照可见行=被重放集，新 append 行天然幸存）。vacuumReplace 保留同键锁（T12 状态机化收口锚——
   *  CLI renumber 跨进程保险）。旧取号序列（canvas doc update seq——T9 退役 nextval 单帧取号）同批 DROP
   *  （迁移 20261024140000——行 seq=WAL walSeq 非取号）。返回 rows=实插行数（conflict 命中=幂等视为已提交）。 */
  async appendBatch(projectId: string, rows: ReadonlyArray<{
    generation: number; firstWalSeq: bigint; lastWalSeq: bigint; frameCount: number;
    updateHash: string; update: Uint8Array; actorRanges?: unknown;
  }>, wm?: { expectedPgSeq: bigint | null; newPgSeq: bigint; walCheckpointSeq: bigint }): Promise<{ ok: true; rows: number } | { ok: false, reason: 'fenced' }> {
    const owner = this.leaseOwner;
    if (owner == null) throw Object.assign(new Error('append blocked: lease owner not set（契约 16 fail-closed）'), { leaseNotHeld: true });
    if (rows.length === 0) return { ok: true, rows: 0 };
    // V8（Y0a-2 复审 I-1 落地）：交互式事务显式上界（5s/1s）——同旧单帧 append 语义
    const watermarkLanded = await this.prisma.$transaction(
      async (tx) => {
        let n = 0;
        for (const r of rows) {
          // 显式类型 cast（PG 参数类型推断：无 cast 的 unknown 参数在 INSERT..SELECT 列位会折
          // FK 判定失误——text/int/char(64) 三 cast 后真 PG 实测通过）
          const res = await tx.$queryRaw<{ seq: bigint }[]>`
          INSERT INTO "CanvasDocUpdate" ("projectId", generation, seq, "firstWalSeq", "frameCount", "updateHash", "actorRanges", update, "createdAt")
          SELECT ${projectId}::text, ${r.generation}::int, ${r.lastWalSeq}::bigint, ${r.firstWalSeq}::bigint, ${r.frameCount}::int, ${r.updateHash}::char(64), ${r.actorRanges === undefined ? null : JSON.stringify(r.actorRanges)}::jsonb, ${Buffer.from(r.update)}, now()
          WHERE EXISTS (SELECT 1 FROM "CollabLease"
                         WHERE scope = 'primary' AND owner = ${owner})
          ON CONFLICT DO NOTHING
          RETURNING seq`;
          n += res.length;
        }
        if (!wm) return { inserted: n, watermark: 'skipped' as const };
        // —— 水位推进（与行插入同事务——崩溃恢复=从 pgSeq 重放 WAL，不依赖进程内状态）——
        const newPg = wm.newPgSeq;
        const wc = wm.walCheckpointSeq > newPg ? wm.walCheckpointSeq : newPg;   // CHECK pgSeq≤walCheckpointSeq 守恒
        const updated = wm.expectedPgSeq != null
          ? await tx.$queryRaw<{ pgSeq: bigint }[]>`
              UPDATE "CanvasDoc" SET "walCheckpointSeq" = ${wc}::bigint, "pgSeq" = ${newPg}::bigint
              WHERE "projectId" = ${projectId}::text AND generation = ${rows[0].generation}::int AND "pgSeq" = ${wm.expectedPgSeq}::bigint
              RETURNING "pgSeq"`
          : await tx.$queryRaw<{ pgSeq: bigint }[]>`
              UPDATE "CanvasDoc" SET "walCheckpointSeq" = GREATEST("walCheckpointSeq", ${wc}::bigint), "pgSeq" = ${newPg}::bigint
              WHERE "projectId" = ${projectId}::text AND "pgSeq" < ${newPg}::bigint
              RETURNING "pgSeq"`;
        return { inserted: n, watermark: updated.length > 0 ? 'advanced' as const : (wm.expectedPgSeq != null ? 'cas-miss' as const : 'noop' as const) };
      },
      { timeout: 5_000, maxWait: 1_000 },
    );
    if (watermarkLanded.watermark === 'cas-miss') {
      // CAS 0 行两分：pgSeq 已 ≥ newPgSeq（回灌/reconciler 并发先收敛——行 updateHash 幂等已覆盖）=ok；
      // 行缺失=懒建档（旧链 compact create 同语义——首 CAS 建行）；其余=真 fenced（二次查区分同旧契约）。
      const row = await this.prisma.$queryRaw<{ pgSeq: bigint }[]>`
        SELECT "pgSeq" FROM "CanvasDoc" WHERE "projectId" = ${projectId}::text LIMIT 1`;
      if (row.length === 0) {
        // 懒建档（genesis 双路之外的老项目首写——行不在与 fenced 不可区分，单写者下 INSERT 幂等收敛；
        // updatedAt=Prisma @updatedAt 无 DB 默认——raw INSERT 须显式给值；state=空 doc 合法 update 字节
        // ——禁空 bytea〔读侧 if(docRow.state) 形态直 applyUpdate=lib0 解码 throw〕）
        await this.prisma.$executeRaw`
          INSERT INTO "CanvasDoc" ("projectId", state, "stateSeq", generation, "schemaVersion", "updatedAt", "pgSeq", "walCheckpointSeq")
          VALUES (${projectId}::text, ${Buffer.from(Y.encodeStateAsUpdate(createCanvasDoc()))}, 0, ${rows[0].generation}::int, 3, now(), ${wm!.newPgSeq}::bigint, ${wm!.walCheckpointSeq > wm!.newPgSeq ? wm!.walCheckpointSeq : wm!.newPgSeq}::bigint)
          ON CONFLICT DO NOTHING`;
        return { ok: true, rows: watermarkLanded.inserted };
      }
      if (row[0].pgSeq >= wm!.newPgSeq) return { ok: true, rows: watermarkLanded.inserted };   // 并发收敛（幂等）
      {
        // 单写者内存水位滞后（T10 G2 ④：CAS 已提交但 confirm 未跑——崩溃窗/confirm 静默）：
        // 行已入（cas-miss 事务行照常提交+updateHash 幂等）——以 PG 行真值重试 CAS 一次（adopt）。
        const adopt = await this.prisma.$queryRaw<{ pgSeq: bigint }[]>`
          UPDATE "CanvasDoc" SET "walCheckpointSeq" = GREATEST("walCheckpointSeq", ${wm!.walCheckpointSeq > wm!.newPgSeq ? wm!.walCheckpointSeq : wm!.newPgSeq}::bigint), "pgSeq" = ${wm!.newPgSeq}::bigint
          WHERE "projectId" = ${projectId}::text AND "pgSeq" = ${row[0].pgSeq}::bigint
          RETURNING "pgSeq"`;
        if (adopt.length > 0) return { ok: true, rows: watermarkLanded.inserted };
      }
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
    if (watermarkLanded.inserted > 0) return { ok: true, rows: watermarkLanded.inserted };
    // 0 行两分（Y1c T9 幂等轴）：行已存在（updateHash 幂等命中——重试/重组批 no-op）=ok rows:0；
    // 全新行零插入=fenced（B2 不抛——二次查区分：CollabLease 行删=leaseRowMissing 配置错误〔重试
    // 无用——gateway 落 spool 不排梯 SV13〕；行在=确 fenced〔owner≠me〕）。
    for (const r of rows) {
      const exists = await this.prisma.$queryRaw<{ seq: bigint }[]>`
        SELECT seq FROM "CanvasDocUpdate"
        WHERE "projectId" = ${projectId}::text AND generation = ${r.generation}::int
          AND "updateHash" = ${r.updateHash}::char(64) LIMIT 1`;
      if (exists.length === 0) {
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
    }
    return { ok: true, rows: 0 };   // 幂等重发：全部 updateHash 已在（DO NOTHING 吞行=正确 no-op）
  }

  /** T10：CanvasDoc 水位读面（恢复链/测试——pgSeq 权威从 PG 行读，非进程内状态）。 */
  async readWatermark(projectId: string): Promise<{ pgSeq: bigint; walCheckpointSeq: bigint; generation: number } | null> {
    const row = await this.prisma.$queryRaw<{ pgSeq: bigint; walCheckpointSeq: bigint; generation: number }[]>`
      SELECT "pgSeq", "walCheckpointSeq", generation FROM "CanvasDoc" WHERE "projectId" = ${projectId}::text LIMIT 1`;
    return row[0] ?? null;
  }

  private static readonly PAGE_ROWS = 500;

  /** Y0a-1 装载读唯一入口（spec §4.3-1）：委托 readConsistent（契约 1"一个实现、两出口"——
   *  装载出口；opts 供自愈路径重试时收紧预算透传）。Y0b-4 T9a：返回扩 preVacuumSv/generation
   *  （装载播种代际门缓存——gateway loadDocument 消费；readSnapshotOnly 共用实现同带，不消费）。
   *  T18（Y1b T2）：返回扩 schemaVersion（CanvasDoc PG 列——装载版本门唯一判据；行缺失=null=
   *  懒建档放行，首 store 建行走 @default(3)）。 */
  async loadForHydration(
    projectId: string,
    opts?: { timeoutMs?: number; maxWaitMs?: number },
  ): Promise<HydrationRow> {
    return this.readConsistent(projectId, opts);
  }

  /** 契约 1（"一个实现、两出口"）：投影出口（video-work 快照）——不 apply 到 doc、不触 store/
   *  compact；与装载出口共用同一单 RR 事务实现，禁复制第二份。T18：schemaVersion 随行（快照
   *  解码侧版本门——readConsistent 行值单源）。 */
  async readSnapshotOnly(projectId: string): Promise<HydrationRow> {
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
  ): Promise<HydrationRow> {
    return this.prisma.$transaction(
      async (tx) => {
        const docRow = await tx.canvasDoc.findUnique({ where: { projectId }, select: { state: true, stateSeq: true, preVacuumSv: true, generation: true, schemaVersion: true } });
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
        return { state: docRow?.state ?? null, updates, stateSeq: docRow?.stateSeq ?? 0n, preVacuumSv: docRow?.preVacuumSv ?? null, generation: docRow?.generation ?? 0, schemaVersion: docRow?.schemaVersion ?? null };
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

  async hydrateWithRecovery(projectId: string): Promise<HydrationRow> {
    try {
      return await this.loadForHydration(projectId);
    } catch (first) {
      if (!this.isRetryableHydrationError(first)) throw first;
      try {
        await this.compact(projectId, { timeoutMs: 6_000, maxWaitMs: 1_000 });
      } catch (compactErr) {
        yjsStoreCompactFailureTotal.inc();
        this.logger.warn(`hydrate recovery compact failed for ${projectId}: ${(compactErr as Error).message}`);
        captureCollabException(compactErr, { docName: `project:${projectId}`, reason: 'hydrate-compact-failed', connectionId: '-' });   // T11：自愈 compact 放弃（契约 13：仍重试装载）
      }
      return this.loadForHydration(projectId, { timeoutMs: 2_000, maxWaitMs: 500 });   // 重试一次；仍失败向上抛
    }
  }

  async count(projectId: string): Promise<number> {
    return this.prisma.canvasDocUpdate.count({ where: { projectId } });
  }

  /** Y0b-4 T9a（Q-U v6 报告1 P1-2/报告2 G-3）：vacuum ⑥ 单事务——快照代际替换。
   *  首行 lockProject（与 append/compact 同键——P23/V26 锁键单源：serving 门是概率保证，
   *  advisory lock 是结构保证〔scheduler/运维脚本/未 drain spool 残路径〕）；被删增量行精确
   *  取号基准=锁内实读行集（禁 0/GREATEST 包装——canvas-doc-insert-ratchet 红线）；expected
   *  行数守卫=④ 读与锁内读之间有并发 append ⇒ 中止（行集在锁协议下只增不删〔append-only+
   *  compact 同键排队〕——长度相等即同一集合）；upsert {state=真空编码, 取号基准, preVacuumSv=
   *  真空前 SV, generation=n+1}+deleteMany 按实读行 id（compact 同式）。 */
  async vacuumReplace(
    projectId: string,
    state: Buffer,
    preVacuumSv: Buffer,
    expectedRowCount: number,
  ): Promise<{ generation: number }> {
    return this.prisma.$transaction(
      async (tx) => {
        await this.lockProject(tx, projectId);
        const liveRows = await tx.canvasDocUpdate.findMany({
          where: { projectId },
          orderBy: { seq: 'asc' },
          select: { projectId: true, generation: true, seq: true },
        });
        if (liveRows.length !== expectedRowCount) {
          throw Object.assign(new Error('vacuum 增量行集在锁内漂移（读后有并发写——中止重试）'), { vacuumRowsDrifted: true });
        }
        const liveDoc = await tx.canvasDoc.findUnique({ where: { projectId }, select: { stateSeq: true, generation: true } });
        const maxSeq = liveRows.length > 0 ? liveRows[liveRows.length - 1].seq : (liveDoc?.stateSeq ?? 0n);
        const generation = (liveDoc?.generation ?? 0) + 1;
        await tx.canvasDoc.upsert({
          where: { projectId },
          update: { state, stateSeq: maxSeq, preVacuumSv, generation },
          create: { projectId, state, stateSeq: maxSeq, preVacuumSv, generation },
        });
        // T9 新表形态：锁内实读=该项目全部增量行（append-only+compact 同键排队）——按 projectId 整删（行集=被删集等价）
        await tx.canvasDocUpdate.deleteMany({ where: { projectId } });
        return { generation };
      },
      { timeout: 10_000, maxWait: 2_000 },
    );
  }

  /** Y0a-1 compact（spec v2.5 §1.3）：事务首行租约断言（SV8：owner-only，先于 advisory lock——
   *  无权者不排队不删行）后按实读行 id 精确删除（被删集≡被重放集）；stateSeq 精确 =maxSeq
   *  （精确赋值依赖 advisory lock 串行——去锁并发化必须先落 Y1c-1 CAS 形态，禁 GREATEST/单调化包装）；
   *  返回契约 {compacted,reason}：empty=无行静默；not-owner=租约档拒绝（SV8 分立计数，行数不减）；
   *  abandoned=pendingStructs!=null 放弃本次——计数+ERROR 落本分支单点（gateway 与装载自愈两路覆盖，
   *  防双计），**禁 throw**（gateway :297-301 catch 会把它计入 yjsStoreCompactFailureTotal=污染
   *  abandoned 的 P0 告警线；not-owner 同理不抛——调用方只看 compacted）。
   *  （SV inline 哨兵已删——pendingStructs 检查通过前提下 per-row SV 支配性恒真，探针证伪见 spec §1.5。）
   *  Y0b-4 T3（Q-B 白名单点②）：成功分支附 snapshotBytes（newSnapshot 实测编码字节——编码已在做，
   *  byteLength 零新增）；gateway maybeCompact 判 pending 空才采纳为 docTruth（持久化真值口径）。
   *  Y0b-5 T10（spec §5.8③）：成功分支扩 deletedRows（被删增量行数）+tombstoneBytes（delete set
   *  编码字节——encodeStateAsUpdate(temp, 全 SV) 把 structs 段滤零后的余量近似；compact 受 ≥60s
   *  时间门约束，附加编码成本有界）。
   *  opts：交互式事务独立预算（自愈路径 6s/1s·运维脚本 120s/5s；默认 5s/2s 与 Prisma 隐含值对齐）。 */
  async compact(
    projectId: string,
    opts?: { timeoutMs?: number; maxWaitMs?: number },
  ): Promise<{ compacted: true; snapshotBytes: number; deletedRows: number; tombstoneBytes: number } | { compacted: false; reason?: 'abandoned' | 'empty' | 'not-owner' }> {
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
        // Y1c T10（census⑩）：compact 去 advisory lock——被删集≡被重放集由 RR 快照保证（DELETE 只删
        // 事务快照可见行；并发 appendBatch 新行幸存）；「seq 序≡提交序」由 actor 单写者+WAL walSeq
        // 构造性保证（行 seq=已 fsync walSeq 非 DB 取号）。与 appendBatch 水位 CAS 的 CanvasDoc 行
        // 写写冲突=compact 侧 P2034 序列化失败→调用方 WARN+下窗重试（compact=优化非不变量载体）。
        const rows = await tx.canvasDocUpdate.findMany({
          where: { projectId },
          orderBy: { seq: 'asc' },
          select: { projectId: true, generation: true, seq: true, update: true },
        });
        if (rows.length === 0) return { compacted: false, reason: 'empty' as const };
        const maxSeq = rows[rows.length - 1].seq;
        const docRow = await tx.canvasDoc.findUnique({ where: { projectId } });
        const temp = createCanvasDoc();
        if (docRow) Y.applyUpdate(temp, new Uint8Array(docRow.state));
        for (const r of rows) Y.applyUpdate(temp, new Uint8Array(r.update));
        if (temp.store.pendingStructs !== null) {
          yjsCompactAbandonedTotal.inc();
          this.logger.error(`compact abandoned (pendingStructs non-null) for ${projectId}——保留全部行，下次 store 立即重试`);
          return { compacted: false, reason: 'abandoned' as const };   // 空事务提交：不写不删，行全保留
        }
        const newSnapshot = Y.encodeStateAsUpdate(temp);
        // Y0b-5 T10：tombstone 近似——全 SV 使 structs 段滤零，余量≈delete set 编码（temp 尚未 destroy）
        const tombstone = Y.encodeStateAsUpdate(temp, Y.encodeStateVector(temp));
        temp.destroy();
        await tx.canvasDoc.upsert({
          where: { projectId },
          update: { state: Buffer.from(newSnapshot), stateSeq: maxSeq },
          create: { projectId, state: Buffer.from(newSnapshot), stateSeq: maxSeq },
        });
        await tx.canvasDocUpdate.deleteMany({ where: { projectId } });   // T9：行集=锁内实读全部行（同 vacuumReplace 口径）
        return { compacted: true, snapshotBytes: newSnapshot.length, deletedRows: rows.length, tombstoneBytes: tombstone.length };   // Y0b-4 T3 真值上报+Y0b-5 T10 行数/tombstone
      },
      { isolationLevel: 'RepeatableRead', timeout: opts?.timeoutMs ?? 5_000, maxWait: opts?.maxWaitMs ?? 2_000 },
    );
  }
}
