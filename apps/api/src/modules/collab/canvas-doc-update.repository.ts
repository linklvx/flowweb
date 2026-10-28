import { Injectable, Inject, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import * as Y from 'yjs';
import { CANVAS_DOC_SCHEMA_VERSION, canonicalUpdateHashPayload } from '@flowweb/shared';
import { createCanvasDoc } from './canvas-doc.factory';
import { projectDocName } from './doc-name.util';
import { PrismaService } from '../../prisma/prisma.service';
import { captureCollabException } from '../../utils/sentry-scrub';
import {
  docCompactionDuration,
  docSnapshotBytes,
  walSeqResetTripwireTotal,
  yjsCompactAbandonedTotal,
  yjsCompactPurgeDeferredTotal,
  yjsHydrationHugeRowTotal,
  yjsSnapshotReadTotal,
  yjsStoreCompactFailureTotal,
} from './store.metrics';

/** T18（Y1b T2）：一致读行形状（readConsistent 单源——装载/快照两出口共用）。
 *  Y1c T11（快照权威切换）：state/stateSeq 改源自 CanvasDocSnapshot（按 CanvasDoc.currentSnapshotRev
 *  指针行——非 CanvasDoc 旧列，旧列随本卡退役）；updates=增量尾（CanvasDocUpdate seq>stateSeq）。
 *  schemaVersion=CanvasDoc PG 列（版本门唯一判据；null=行缺失——懒建档，装载门放行）。
 *  state=null 两形态：CanvasDoc 行缺失（懒建档——全量行重放）∨ 指针行缺失（结构性不发生——
 *  genesis/发布/换代三写点与指针同事务；防御性折空尾全量重放，内容安全）。 */
export interface HydrationRow {
  state: Buffer | null;
  updates: Buffer[];
  stateSeq: bigint;
  generation?: number;
  schemaVersion?: number | null;
  /** C1①（T11 双评审）：CanvasDoc.pgSeq 随行（walSeq 计数器 PG 真值播种消费面——loadDocument 缝
   *  转发 spool.seedWalSeqFromPg；行缺失=null=懒建档无需播种）。 */
  pgSeq?: bigint | null;
  /** Y1c T19：公开快照缓存键轨 (pid,g,snapshotRev) 的 rev 维（CanvasDoc.currentSnapshotRev 随行——
   *  行缺失=null=懒建档）。 */
  currentSnapshotRev?: bigint | null;
}

@Injectable()
export class CanvasDocUpdateRepository {
  private readonly logger = new Logger(CanvasDocUpdateRepository.name);

  // 显式 @Inject：vitest esbuild 不生成设计时类型元数据（同 collab-document.service 模式）
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 契约 16（v2.5）：唯一写者=CollabLeaseService（获取/失守/释放时调用）；owner=null ⇒
   *  append 断言恒不通过=天然 fail-closed（P7：null 显式 throw——"lease service 从未注入"
   *  是排序/配置 bug，伪装 fenced 会误导自隔离方向）。禁逐调用点传参（漏传=静默破防）。
   *  Y1c T11：compact 授权换轴（行锁+generation/pgSeq CAS）——**不再读本值**（与写入方 lease
   *  正交：worker 进程无租约照常 compact）；本值辖 append 族（appendBatch/懒建档/adopt）。 */
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
   *  actor drain 批/维护单帧/回灌行共用（禁第二份实现）。
   *  **T21 R2 双 preimage 退役（T12 评审移交「T21 审计/T32 核验」）**：本方法=唯一哈希入口，
   *  canonical 形态**委托 shared canonicalUpdateHashPayload**（system-history.ts T5b 冻结——
   *  JSON.stringify(有序 hex 列表)）→sha256hex。取舍论证：①JSON canonical 形态=T5b 冻结契约文本
   *  原意（「sha256hex 调用点归 api 侧消费」即本委托形态），payload 可打印可审计（排障直读批内帧序）；
   *  ②raw bytes 传递链（frameHash 在 api 侧是 Uint8Array）在**唯一入口处**一次 hex 化（≤512 帧×64
   *  字符——微不足道）；③开发期无兼容包袱：DB 既有 dev 行 hash 值随之更换（旧 raw-concat 值作废，
   *  不留兼容层）。raw-bytes concat 旧 preimage 就地退役（禁复活——canvas-doc-update.repository.spec
   *  T21 R2 用例锁「同输入同哈希≡shared canonical」）。 */
  static batchUpdateHash(frameHashes: ReadonlyArray<Uint8Array>): string {
    return createHash('sha256')
      .update(canonicalUpdateHashPayload(frameHashes.map((h) => Buffer.from(h).toString('hex'))))
      .digest('hex');
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
  /** C1（T10 收口）：缺行判定的 fenced 分型单点——CollabLease 行删=leaseRowMissing throw
   *  （配置错误非 fenced，重试无用——gateway 落 spool 不排梯 SV13）；行在=确 fenced〔owner≠me〕。 */
  private async fencedClassify(projectId: string): Promise<{ ok: false, reason: 'fenced' }> {
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

  /** C1（T10 收口）：部分插入（inserted<rows.length——RC 批内租约易主窗）回查单点——**按 PK**（
   *  (projectId,generation,seq)）验证全行已落才放行 ok；缺行=按 fenced 档返回（调用方不 confirm
   *  对应前缀——缺行帧 WAL 副本保留，DB 水位亦不越过缺行）。禁以 inserted>0 短路吞缺口。 */
  private async verifyRowsLanded(projectId: string, rows: ReadonlyArray<{ generation: number; lastWalSeq: bigint }>): Promise<boolean> {
    for (const r of rows) {
      const exists = await this.prisma.$queryRaw<{ seq: bigint }[]>`
        SELECT seq FROM "CanvasDocUpdate"
        WHERE "projectId" = ${projectId}::text AND generation = ${r.generation}::int AND seq = ${r.lastWalSeq}::bigint
        LIMIT 1`;
      if (exists.length === 0) return false;
    }
    return true;
  }

  async appendBatch(projectId: string, rows: ReadonlyArray<{
    generation: number; firstWalSeq: bigint; lastWalSeq: bigint; frameCount: number;
    updateHash: string; update: Uint8Array; actorRanges?: unknown;
  }>, wm?: { expectedPgSeq: bigint | null; newPgSeq: bigint; walCheckpointSeq: bigint }, inTx?: (tx: Prisma.TransactionClient) => Promise<void>): Promise<{ ok: true; rows: number } | { ok: false, reason: 'fenced' | 'wal-seq-reset' }> {
    const owner = this.leaseOwner;
    if (owner == null) throw Object.assign(new Error('append blocked: lease owner not set（契约 16 fail-closed）'), { leaseNotHeld: true });
    if (rows.length === 0) return { ok: true, rows: 0 };
    // —— C1②（T11 双评审 Critical）fail-closed tripwire：新帧调用形（actor CAS〔expectedPgSeq≠null〕/
    // 维护无 wm 形）若 lastWalSeq≤doc.pgSeq 且**非幂等重放在档**（同 seq 同 updateHash 行不在）→拒收。
    // 配合 C1① PG 播种（spool.seedWalSeqFromPg——boot+loadDocument 两缝）正常路径永不触发；触发=
    // 播种面缺口（计数器重置纪新帧落已发布 stateSeq 之下——readConsistent 尾谓词跳过+purgeBelow
    // 永删的静默丢数据链）。豁免面：replayAll 回灌 catch-up 形（expectedPgSeq=null——旧 seq 行幂等
    // 重放合法）不查；幂等重试（committed-未-confirm：行在+同 hash——ordered-commit 纪律下
    // walSeq≤pgSeq 必为此形态）放行。调用方（actor/维护回退）对 !ok 统一 fenced→selfIsolate——
    // tripwire 触发即进程级 fail-stop（数据完整性级事故面，禁静默续跑）。
    if (wm?.expectedPgSeq !== null) {
      const doc = await this.prisma.$queryRaw<{ pgSeq: bigint | null }[]>`
        SELECT "pgSeq" FROM "CanvasDoc" WHERE "projectId" = ${projectId}::text LIMIT 1`;
      const docPg = doc[0]?.pgSeq;
      if (docPg != null) {
        for (const r of rows.filter((x) => x.lastWalSeq <= docPg)) {
          const present = await this.prisma.$queryRaw<{ seq: bigint }[]>`
            SELECT seq FROM "CanvasDocUpdate"
            WHERE "projectId" = ${projectId}::text AND generation = ${r.generation}::int
              AND seq = ${r.lastWalSeq}::bigint AND "updateHash" = ${r.updateHash}::char(64) LIMIT 1`;
          if (present.length === 0) {
            walSeqResetTripwireTotal.inc();
            const err = new Error(`appendBatch walSeq reset tripwire: 新帧 lastWalSeq(${r.lastWalSeq})≤CanvasDoc.pgSeq(${docPg}) 且非幂等重放在档——C1① 播种面缺口（计数器重置纪），fail-closed 拒收（红链=行落已发布 stateSeq 之下装载尾跳过）`);
            this.logger.error(err.message);
            captureCollabException(err, { docName: projectDocName(projectId), reason: 'wal-seq-reset-tripwire', connectionId: '-' });
            return { ok: false, reason: 'wal-seq-reset' };
          }
        }
      }
    }
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
        // Y1c T26：帧前缀同事务钩（帧↔义务原子——inTx 写失败=整事务回滚，帧行/水位/义务三方同生共死；
        // 调用方=actor flushPrefixToPg 闭包注入 CollabLifecycleObserverService.persistFramesInTx）
        if (inTx) await inTx(tx);
        if (!wm) return { inserted: n, watermark: 'skipped' as const };
        // —— 水位推进（与行插入同事务——崩溃恢复=从 pgSeq 重放 WAL，不依赖进程内状态）——
        // C1（T10 收口）：两条 UPDATE 的 WHERE 各带 lease fence（与 INSERT fence 同 owner 语义）——
        // 否则「全 fenced」facet（租约丢失窗 CAS expected 恰匹配）INSERT 0 行而 CAS 照常推 pgSeq
        // =newPgSeq → DB 水位越过未插入行（恢复基线被污染——重启回灌从 pgSeq 起放将跳过缺行）。
        const newPg = wm.newPgSeq;
        const wc = wm.walCheckpointSeq > newPg ? wm.walCheckpointSeq : newPg;   // CHECK pgSeq≤walCheckpointSeq 守恒
        const updated = wm.expectedPgSeq != null
          ? await tx.$queryRaw<{ pgSeq: bigint }[]>`
              UPDATE "CanvasDoc" SET "walCheckpointSeq" = ${wc}::bigint, "pgSeq" = ${newPg}::bigint
              WHERE "projectId" = ${projectId}::text AND generation = ${rows[0].generation}::int AND "pgSeq" = ${wm.expectedPgSeq}::bigint
                AND EXISTS (SELECT 1 FROM "CollabLease" WHERE scope = 'primary' AND owner = ${owner})
              RETURNING "pgSeq"`
          : await tx.$queryRaw<{ pgSeq: bigint }[]>`
              UPDATE "CanvasDoc" SET "walCheckpointSeq" = GREATEST("walCheckpointSeq", ${wc}::bigint), "pgSeq" = ${newPg}::bigint
              WHERE "projectId" = ${projectId}::text AND "pgSeq" < ${newPg}::bigint
                AND EXISTS (SELECT 1 FROM "CollabLease" WHERE scope = 'primary' AND owner = ${owner})
              RETURNING "pgSeq"`;
        return { inserted: n, watermark: updated.length > 0 ? 'advanced' as const : (wm.expectedPgSeq != null ? 'cas-miss' as const : 'noop' as const) };
      },
      { timeout: 5_000, maxWait: 1_000 },
    );
    if (watermarkLanded.watermark === 'cas-miss') {
      // CAS 0 行两分：pgSeq 已 ≥ newPgSeq（回灌/reconciler 并发先收敛——行 updateHash 幂等已覆盖）=ok；
      // 行缺失=懒建档（旧链 compact create 同语义——首 CAS 建行）；其余=真 fenced（二次查区分同旧契约）。
      // C1（T10 收口）：本块内全部 ok 出口在 inserted<rows.length 时一律按 PK 回查全行在才 ok——
      // 「部分 fenced」facet（RC 批内两 INSERT 之间租约易主）缺行禁随 ok 放行（调用方会 splice+confirm
      // 全前缀=缺行帧 WAL 副本被段回收=不可恢复丢失）；缺行=按 fenced 档（不 confirm 对应前缀）。
      const row = await this.prisma.$queryRaw<{ pgSeq: bigint }[]>`
        SELECT "pgSeq" FROM "CanvasDoc" WHERE "projectId" = ${projectId}::text LIMIT 1`;
      // T10 Minor 移交（Y1c T11 根修）：adopt UPDATE 与懒建档 INSERT **先回查行全在**才执行——
      // lease「批内失→adopt/建档前复得」翻覆窗下，旧序（先提交水位再 partialOk）会把 pgSeq 推过
      // 缺行后折 fenced 返回=DB 恢复基线污染（重启从 pgSeq 起放跳过缺行）。行缺=按 fenced 档，
      // 水位零触碰（fenced 返回保 WAL 副本，自愈重发收敛）。
      if (!(await this.verifyRowsLanded(projectId, rows))) return this.fencedClassify(projectId);
      if (row.length === 0) {
        // 懒建档（genesis 双路之外的老项目首写——行不在与 fenced 不可区分，单写者下 INSERT 幂等收敛；
        // updatedAt=Prisma @updatedAt 无 DB 默认——raw INSERT 须显式给值。Y1c T11：state/stateSeq 列
        // 退役（快照权威=CanvasDocSnapshot；懒建档 doc 无快照行 → 装载折空态全量行重放，内容安全）。
        // C1：建档 INSERT 同带 lease fence（建档即写 pgSeq——租约不在我手禁推水位，否则懒建档 facet
        // 同「水位越过未插入行」污染）。
        // T12 收口 M4：schemaVersion 绑 CANVAS_DOC_SCHEMA_VERSION 常量参数（原字面量 3 与 @default(3)
        // +常量三源——单源化；@default 保留为 DDL 兜底）。
        await this.prisma.$executeRaw`
          INSERT INTO "CanvasDoc" ("projectId", generation, "schemaVersion", "updatedAt", "pgSeq", "walCheckpointSeq")
          SELECT ${projectId}::text, ${rows[0].generation}::int, ${CANVAS_DOC_SCHEMA_VERSION}::int, now(), ${wm!.newPgSeq}::bigint, ${wm!.walCheckpointSeq > wm!.newPgSeq ? wm!.walCheckpointSeq : wm!.newPgSeq}::bigint
          WHERE EXISTS (SELECT 1 FROM "CollabLease" WHERE scope = 'primary' AND owner = ${owner})
          ON CONFLICT DO NOTHING`;
        return { ok: true, rows: watermarkLanded.inserted };
      }
      if (row[0].pgSeq >= wm!.newPgSeq) return { ok: true, rows: watermarkLanded.inserted };   // 并发收敛（幂等——行全在已由上方回查担保）
      {
        // 单写者内存水位滞后（T10 G2 ④：CAS 已提交但 confirm 未跑——崩溃窗/confirm 静默）：
        // 行已入（cas-miss 事务行照常提交+updateHash 幂等）——以 PG 行真值重试 CAS 一次（adopt）。
        // Q-M8：adopt 补 generation 谓词（与 CAS 主路径同判——T12 换代窗口防陈旧 adopt：doc 已换代
        // 时旧代 actor 不得推水位）。C1：同带 lease fence（行全在已验）。
        const adopt = await this.prisma.$queryRaw<{ pgSeq: bigint }[]>`
          UPDATE "CanvasDoc" SET "walCheckpointSeq" = GREATEST("walCheckpointSeq", ${wm!.walCheckpointSeq > wm!.newPgSeq ? wm!.walCheckpointSeq : wm!.newPgSeq}::bigint), "pgSeq" = ${wm!.newPgSeq}::bigint
          WHERE "projectId" = ${projectId}::text AND generation = ${rows[0].generation}::int AND "pgSeq" = ${row[0].pgSeq}::bigint
            AND EXISTS (SELECT 1 FROM "CollabLease" WHERE scope = 'primary' AND owner = ${owner})
          RETURNING "pgSeq"`;
        if (adopt.length > 0) return { ok: true, rows: watermarkLanded.inserted };
      }
      return this.fencedClassify(projectId);
    }
    if (watermarkLanded.inserted === rows.length) return { ok: true, rows: watermarkLanded.inserted };
    if (watermarkLanded.inserted > 0) {
      // C1（T10 收口）：部分插入禁「inserted>0 即 ok」短路——按 PK 回查全行在才 ok（fence 窗后段
      // UPDATE 亦被拦/或 lease 失而复得的窗），缺行=按 fenced 档（不 confirm 对应前缀）。
      if (await this.verifyRowsLanded(projectId, rows)) return { ok: true, rows: watermarkLanded.inserted };
      return this.fencedClassify(projectId);
    }
    // 0 行两分（Y1c T9 幂等轴）：行已存在（updateHash 幂等命中——重试/重组批 no-op）=ok rows:0；
    // 全新行零插入=fenced（B2 不抛——二次查区分：CollabLease 行删=leaseRowMissing 配置错误〔重试
    // 无用——gateway 落 spool 不排梯 SV13〕；行在=确 fenced〔owner≠me〕）。
    for (const r of rows) {
      const exists = await this.prisma.$queryRaw<{ seq: bigint }[]>`
        SELECT seq FROM "CanvasDocUpdate"
        WHERE "projectId" = ${projectId}::text AND generation = ${r.generation}::int
          AND "updateHash" = ${r.updateHash}::char(64) LIMIT 1`;
      if (exists.length === 0) return this.fencedClassify(projectId);
    }
    return { ok: true, rows: 0 };   // 幂等重发：全部 updateHash 已在（DO NOTHING 吞行=正确 no-op）
  }

  /** Y1c T12（契约 1——CanvasDoc 读单源在 repository）：世代真值读面（auth 准入消费——E23 双校验①；
   *  行缺失=null ⇒ 调用方折 0〔懒建档 canonical=裸名〕）。 */
  async readGeneration(projectId: string): Promise<number | null> {
    const row = await this.prisma.$queryRaw<{ generation: number }[]>`
      SELECT generation FROM "CanvasDoc" WHERE "projectId" = ${projectId}::text LIMIT 1`;
    return row[0]?.generation ?? null;
  }

  /** T10：CanvasDoc 水位读面（恢复链/测试——pgSeq 权威从 PG 行读，非进程内状态）。 */
  /** Y1c T19：+currentSnapshotRev（公开快照缓存键 rev 维——readCanvasSnapshotCached fallback 活读
   *  包装水位三元消费；既有三列消费面零变化——纯增量列）。 */
  async readWatermark(projectId: string): Promise<{ pgSeq: bigint; walCheckpointSeq: bigint; generation: number; currentSnapshotRev: bigint } | null> {
    const row = await this.prisma.$queryRaw<{ pgSeq: bigint; walCheckpointSeq: bigint; generation: number; currentSnapshotRev: bigint }[]>`
      SELECT "pgSeq", "walCheckpointSeq", generation, "currentSnapshotRev" FROM "CanvasDoc" WHERE "projectId" = ${projectId}::text LIMIT 1`;
    return row[0] ?? null;
  }

  private static readonly PAGE_ROWS = 500;

  /** Y0a-1 装载读唯一入口（spec §4.3-1）：委托 readConsistent（契约 1"一个实现、两出口"——
   *  装载出口；opts 供自愈路径重试时收紧预算透传）。
   *  T18（Y1b T2）：返回扩 schemaVersion（CanvasDoc PG 列——装载版本门唯一判据；行缺失=null=
   *  懒建档放行，首 store 建行走 @default(3)）。
   *  Y1c T12（偏离 27）：preVacuumSv 随 SV 代际门退役删除（列 Drop=迁移 20261024160000；世代
   *  执法改道 docName 段——admitDocNameForGeneration auth/load 双校验）。 */
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

  /** 两出口共用实现体：单 RR 事务覆盖「指针快照+增量尾」（Y1c T11 快照权威——CanvasDocSnapshot
   *  按 currentSnapshotRev 指针行 + CanvasDocUpdate >stateSeq 分页尾；E42①(i) MVCC 使发布事务对
   *  本快照不可见，指针与尾集恒一致——撕裂结构性不存在）。apply 由调用方在事务外执行。
   *  游标初值=指针快照 stateSeq（旧 SV3「恒 0n 全量」双保险随快照权威退役：单写者+WAL walSeq 构造性
   *  保证 seq 序≡提交序〔census⑩〕+insert-ratchet 静态门+本仓唯一 INSERT 单源——合法行结构性
   *  不可能落在 stateSeq 之下；绕锁直插行按设计排除在装载尾外）。分页 seq>cursor 谓词保留——
   *  去掉谓词=满页死循环（W15）。
   *  预算规则：timeout 8s < 客户端 synced 死线 10s−2s；maxWait 2s（池排队由 connection_limit 承担）；
   *  opts 供自愈路径重试时收紧预算（契约 13 v2.4）。
   *  raw SQL 规则：bigint 参数一律显式 ::bigint。 */
  private async readConsistent(
    projectId: string,
    opts?: { timeoutMs?: number; maxWaitMs?: number },
  ): Promise<HydrationRow> {
    return this.prisma.$transaction(
      async (tx) => {
        const docRow = await tx.canvasDoc.findUnique({ where: { projectId }, select: { generation: true, schemaVersion: true, currentSnapshotRev: true, pgSeq: true } });
        let state: Buffer | null = null;
        let stateSeq = 0n;
        if (docRow) {
          const snap = await tx.canvasDocSnapshot.findUnique({
            where: { projectId_generation_snapshotRev: { projectId, generation: docRow.generation, snapshotRev: docRow.currentSnapshotRev } },
            select: { state: true, stateSeq: true },
          });
          state = snap?.state ?? null;   // 指针行缺失=防御折空（全量行重放——内容安全）
          stateSeq = snap?.stateSeq ?? 0n;
        }
        const updates: Buffer[] = [];
        let cursor = stateSeq;
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
        return { state, updates, stateSeq, generation: docRow?.generation ?? 0, schemaVersion: docRow?.schemaVersion ?? null, pgSeq: docRow?.pgSeq ?? null, currentSnapshotRev: docRow?.currentSnapshotRev ?? null };
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
   *  首行 lockProject（T10 后仅 vacuumReplace 消费——T27 状态机化收口）；被删增量行精确
   *  取号基准=锁内实读行集（禁 0/GREATEST 包装——canvas-doc-insert-ratchet 红线）；expected
   *  行数守卫=④ 读与锁内读之间有并发 append ⇒ 中止（行集在锁协议下只增不删〔append-only+
   *  compact 排队〕——长度相等即同一集合）。
   *  T12 收口 I1.2：锁内实读 generation 复核（头注「漂移即整体中止」的缺落实装）——
   *  锁内头行 generation ≠ 调用方传入 expectedGeneration（vacuumCore ④ 装载读行值——post-quiesce，
   *  复核窗口=④→⑥）⇒ 并发换代窗（跨进程 CLI/另一 vacuumer）⇒ 返回 aborted 档整体中止
   *  （先于任何写=事务提交零变更）。
   *  Y1c T11（快照权威过渡形态）：CanvasDoc.state/stateSeq 列退役——真空态字节落 **CanvasDocSnapshot
   *  (g+1, rev 0)**（新代权威快照，stateHash 同 genesis 口径）+指针 currentSnapshotRev=0+purgeBelowSeq
   *  清档（行已同事务整删）+generation 落列+按 projectId 整删。
   *  Y1c T12（换代通道定形——I2 三对齐**落定形态=跨代连续 seq**）：①新代快照 stateSeq=旧代 maxSeq
   *  （连续语义唯一自洽形——与 ②C1① 播种面〔seedWalSeqFromPg pgSeq+1 不分代/boot+装载两缝〕与
   *  spool.switchGeneration〔T12 起计数器/水位保留不重置〕三方单源对齐；「换代 walSeq 自 1 重起」
   *  形态废止——并存=新代帧落旧基线之下→readConsistent 尾谓词跳过=C1 重置链复刻）；③pgSeq/
   *  walCheckpointSeq **不重置**（连续 seq 下载入尾/compact 前缀/purgeBelow 谓词跨代单调恒成立；
   *  spec §4.4「水位重置」=T27 维护状态机 SWITCHING 事务单入口语义——本处为其 rebuild payload
   *  预演，快照替换+purgeBelow 清档两义务已兑现）。「水位重置预演」=本形态。
   *  T12（偏离 27）：preVacuumSv 参数/列写随 SV 代际门退役删除（迁移 20261024160000——世代执法
   *  =docName 段 auth/load 双校验）。 */
  async vacuumReplace(
    projectId: string,
    state: Buffer,
    expectedRowCount: number,
    expectedGeneration: number,
    /** Y1c T27：同事务钩（SWITCHING stage 写与换代 DB 族同生共死——appendBatch inTx 先例；
     *  消费方=CollabMaintenanceService.switchingStage）。 */
    inTx?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<{ generation: number } | { aborted: 'generation-drift'; dbGeneration: number }> {
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
        const liveDoc = await tx.canvasDoc.findUnique({ where: { projectId }, select: { generation: true, schemaVersion: true, vacuumEpoch: true, currentSnapshotRev: true } });
        // I1.2：锁内 generation 复核——≠expectedGeneration（调用方 ④ 装载读行值）⇒ aborted 档（先于任何写=DB 零变更）
        const dbGeneration = liveDoc?.generation ?? 0;
        if (dbGeneration !== expectedGeneration) {
          return { aborted: 'generation-drift' as const, dbGeneration };
        }
        // 取号基准：有行=末行 seq；零行=当前指针快照 stateSeq（锁内实读——禁 0/GREATEST 包装）
        const curSnap = liveDoc
          ? await tx.canvasDocSnapshot.findUnique({
              where: { projectId_generation_snapshotRev: { projectId, generation: liveDoc.generation, snapshotRev: liveDoc.currentSnapshotRev } },
              select: { stateSeq: true },
            })
          : null;
        const maxSeq = liveRows.length > 0 ? liveRows[liveRows.length - 1].seq : (curSnap?.stateSeq ?? 0n);
        const generation = dbGeneration + 1;   // I1.2 复核后锁内实读单源（=expectedGeneration+1）
        // T12：vacuumEpoch=纯遥测计数列（spec §2 v5-5「不做任何 fence」——每次真空 +1；快照行随行携带）
        const vacuumEpoch = (liveDoc?.vacuumEpoch ?? 0) + 1;
        // 新代权威快照 (g+1, rev 0)：真空态字节（快照权威——T11 起 CanvasDoc 不再承载 doc 态列）
        await tx.canvasDocSnapshot.upsert({
          where: { projectId_generation_snapshotRev: { projectId, generation, snapshotRev: 0n } },
          create: {
            projectId, generation, snapshotRev: 0n, stateSeq: maxSeq, state,
            stateHash: createHash('sha256').update(state).digest('hex'),
            vacuumEpoch,
            schemaVersion: liveDoc?.schemaVersion ?? CANVAS_DOC_SCHEMA_VERSION,
          },
          update: {},
        });
        await tx.canvasDoc.upsert({
          where: { projectId },
          update: { generation, vacuumEpoch, currentSnapshotRev: 0n, purgeBelowSeq: null },
          create: { projectId, generation, vacuumEpoch },
        });
        // 锁内实读=该项目全部增量行（append-only+compact 排队）——按 projectId 整删（行集=被删集等价）
        await tx.canvasDocUpdate.deleteMany({ where: { projectId } });
        if (inTx) await inTx(tx);
        return { generation };
      },
      { timeout: 10_000, maxWait: 2_000 },
    );
  }

  /** Y1c T11 compact 重写（plan Task 11——快照发布+WAL 清理）：快照只从 **PG 前缀**生成且只到
   *  **pgSeq**。四段管线：
   *   ①授权读（无事务）：CanvasDoc 行 {generation,pgSeq,currentSnapshotRev}——compact 授权=行锁+
   *     generation/pgSeq CAS（**不拿租约**——与写入方 lease 正交：worker 进程无租约照常 compact，
   *     并发单写者 append 推 pgSeq ⇒ 发布 CAS miss 正常折返）。
   *   ②前缀重放（worker 进程内存，无事务）：指针快照行 (g,currentSnapshotRev) + 增量尾
   *     (stateSeq0, pgSeq] 分页重放 → encodeStateAsUpdate canonical 编码（genesis 同口径字节形态）
   *     +SHA-256 stateHash。pendingStructs!=null → abandoned（P0 计数+ERROR 落本分支单点，**禁
   *     throw**——gateway/hydrate 两路 catch 会把它计入 compact_failure 污染 abandoned 告警线）。
   *   ③发布事务（短事务·默认 RC+FOR UPDATE 行锁）：锁内复核三元组 {generation,pgSeq,rev} 未漂移
   *     （漂移=miss——写入方推进/并发 compact 已发布；正常折返非异常）→ INSERT CanvasDocSnapshot
   *     ON CONFLICT DO NOTHING（0 行=miss）→ 条件 UPDATE 指针 currentSnapshotRev+purgeBelowSeq
   *     **同事务持久**（WHERE 三元组 CAS=跨表不变量 Snapshot.stateSeq≤pgSeq 的发布事务内验证
   *     ——偏离 26 v5.2 非 CHECK：锁内 pgSeq 已复核且 stateSeq≡捕获 pgSeq ⇒ 提交时刻不变量恒真）。
   *     **失败保留原可用快照与 WAL 不提前清理**（发布前零删除；purgeBelowSeq 与指针同事务落定）。
   *   ④提交后分批删（worker 分批）：CanvasDocUpdate (projectId,generation,seq≤purgeBelowSeq) 批删
   *     （500/批）+保留策略收敛（当前代 top-2+旧代各 top-1——指针行恒保留）+snapshot gauge/duration。
   *  返回契约：empty=指针快照已覆盖 pgSeq（无前缀可折）；abandoned/miss 同上；deletedRows=本次
   *  实删增量行数（发布后批删真值——Y0b-5 T10 口径承继）。opts 预算辖发布事务（重放/批删无事务）。
   *  触发面（T9 后收敛=takeActorLanded/维护直调点/装载自愈）经 maybeCompact 原位接入，不断链；
   *  worker 进程轮询触发面=CollabCompactPoller（COLLAB_ROLE worker 调度——启动续跑同载体）。 */
  private static readonly PURGE_BATCH_ROWS = 500;

  async compact(
    projectId: string,
    opts?: { timeoutMs?: number; maxWaitMs?: number },
  ): Promise<
    | { compacted: true; snapshotBytes: number; deletedRows: number; tombstoneBytes: number; snapshotRev: bigint; stateSeq: bigint; purgeBelowSeq: bigint }
    | { compacted: false; reason?: 'abandoned' | 'empty' | 'miss' }
  > {
    const t0 = Date.now();
    try {
      // ①授权读（无事务——真值即捕获值；漂移由 ③ 锁内复核收口）
      const head = await this.prisma.$queryRaw<{ generation: number; pgSeq: bigint; currentSnapshotRev: bigint }[]>`
        SELECT generation, "pgSeq", "currentSnapshotRev" FROM "CanvasDoc" WHERE "projectId" = ${projectId}::text LIMIT 1`;
      if (head.length === 0) return { compacted: false, reason: 'empty' as const };
      const g = head[0].generation, pg = head[0].pgSeq, rev0 = head[0].currentSnapshotRev;
      const snap0 = await this.prisma.canvasDocSnapshot.findUnique({
        where: { projectId_generation_snapshotRev: { projectId, generation: g, snapshotRev: rev0 } },
        select: { stateSeq: true },
      });
      const stateSeq0 = snap0?.stateSeq ?? 0n;
      if (pg <= stateSeq0) return { compacted: false, reason: 'empty' as const };   // 指针快照已覆盖 pgSeq

      // ②前缀重放（worker 进程内存——快照+增量尾 (stateSeq0, pgSeq] 全页推进，禁 take/LIMIT 截断集）
      const temp = createCanvasDoc();
      let replayed = 0;
      try {
        const snapState = await this.prisma.canvasDocSnapshot.findUnique({
          where: { projectId_generation_snapshotRev: { projectId, generation: g, snapshotRev: rev0 } },
          select: { state: true },
        });
        if (snapState?.state) Y.applyUpdate(temp, new Uint8Array(snapState.state));
        let cursor = stateSeq0;
        for (;;) {
          const page = await this.prisma.$queryRaw<{ seq: bigint; update: Buffer }[]>`
            SELECT seq, update FROM "CanvasDocUpdate"
            WHERE "projectId" = ${projectId} AND generation = ${g}::int AND seq > ${cursor}::bigint AND seq <= ${pg}::bigint
            ORDER BY seq ASC LIMIT ${CanvasDocUpdateRepository.PAGE_ROWS}`;
          if (page.length === 0) break;
          for (const r of page) Y.applyUpdate(temp, new Uint8Array(r.update));
          replayed += page.length;
          cursor = page[page.length - 1].seq;
          if (page.length < CanvasDocUpdateRepository.PAGE_ROWS) break;
        }
        if (temp.store.pendingStructs !== null) {
          yjsCompactAbandonedTotal.inc();
          this.logger.error(`compact abandoned (pendingStructs non-null) for ${projectId}——保留全部行与原快照，下次触发立即重试`);
          return { compacted: false, reason: 'abandoned' as const };   // 零写零删：原可用快照与 WAL 全保留
        }
        const newSnapshot = Buffer.from(Y.encodeStateAsUpdate(temp));   // canonical 编码（genesis 种子同形态）
        const tombstone = Y.encodeStateAsUpdate(temp, Y.encodeStateVector(temp));   // Y0b-5 T10 口径承继（全 SV 滤零 structs 段余量近似）
        const stateHash = createHash('sha256').update(newSnapshot).digest('hex');

        // ③发布事务（短事务：行锁+三元组 CAS+指针/purgeBelowSeq 同事务持久）
        const publish = await this.prisma.$transaction(
          async (tx) => {
            // Q-M5（T11 双评审）TOCTOU 收口：schemaVersion/vacuumEpoch 读入 ③ 锁内（随 FOR UPDATE
            // 行锁同读——旧实现锁前无锁读，读-锁间隙换代/升级列写=快照行携带陈旧版本对）。
            const locked = await tx.$queryRaw<{ generation: number; pgSeq: bigint; currentSnapshotRev: bigint; schemaVersion: number | null; vacuumEpoch: number | null }[]>`
              SELECT generation, "pgSeq", "currentSnapshotRev", "schemaVersion", "vacuumEpoch" FROM "CanvasDoc"
              WHERE "projectId" = ${projectId}::text FOR UPDATE`;
            if (locked.length === 0) return { ok: false as const, reason: 'empty' as const };
            if (locked[0].generation !== g || locked[0].pgSeq !== pg || locked[0].currentSnapshotRev !== rev0) {
              return { ok: false as const, reason: 'miss' as const };   // 行锁+generation/pgSeq CAS 授权：写入方推进/并发 compact 已发布
            }
            const inserted = await tx.$queryRaw<{ snapshotRev: bigint }[]>`
              INSERT INTO "CanvasDocSnapshot" ("projectId", generation, "snapshotRev", "stateSeq", state, "stateHash", "vacuumEpoch", "schemaVersion", "createdAt")
              SELECT ${projectId}::text, ${g}::int, ${pg}::bigint, ${pg}::bigint, ${newSnapshot}, ${stateHash}::char(64), ${locked[0].vacuumEpoch ?? 0}::int, ${(locked[0].schemaVersion ?? CANVAS_DOC_SCHEMA_VERSION)}::int, now()
              ON CONFLICT DO NOTHING
              RETURNING "snapshotRev"`;
            if (inserted.length === 0) return { ok: false as const, reason: 'miss' as const };   // 同 rev 已在（并发发布者先到）
            // 指针短事务+purgeBelowSeq 同事务持久；条件 UPDATE=跨表不变量 Snapshot.stateSeq≤pgSeq 的
            // 发布事务内验证（WHERE pgSeq=捕获值 ⇒ 锁内 pgSeq 未动且 stateSeq≡pgSeq——非 CHECK，偏离 26 v5.2）
            const moved = await tx.$queryRaw<{ currentSnapshotRev: bigint }[]>`
              UPDATE "CanvasDoc" SET "currentSnapshotRev" = ${pg}::bigint,
                "purgeBelowSeq" = GREATEST(COALESCE("purgeBelowSeq", 0), ${pg}::bigint), "updatedAt" = now()
              WHERE "projectId" = ${projectId}::text AND generation = ${g}::int
                AND "pgSeq" = ${pg}::bigint AND "currentSnapshotRev" = ${rev0}::bigint
              RETURNING "currentSnapshotRev"`;
            if (moved.length === 0) return { ok: false as const, reason: 'miss' as const };
            return { ok: true as const };
          },
          { timeout: opts?.timeoutMs ?? 5_000, maxWait: opts?.maxWaitMs ?? 2_000 },
        );
        if (!publish.ok) return { compacted: false, reason: publish.reason };

        // ④提交后 worker 分批删+保留策略（发布已落定——清理义务由 purgeBelowSeq 持久承载，中途崩=启动续跑）。
        // Q-M4（T11 双评审）：④段错误不再以 throw 逸出 compact()——发布已成功，throw 会被
        // maybeCompact/hydrateWithRecovery 两路 catch 计入 yjsStoreCompactFailureTotal 污染 compact
        // 失败告警线；改 WARN+独立计数（yjsCompactPurgeDeferredTotal），义务由 purgeBelowSeq 持久
        // 承载（boot/tick resumePurges 续跑——Q-M3 衰减前）。deletedRows=本次实删真值（清理被
        // 延迟=0——「发布成功+清理延迟」与「发布失败」在返回契约上可区分）。
        let deletedRows = 0;
        try {
          deletedRows = await this.purgeBelow(projectId, g, pg);
          await this.pruneSnapshots(projectId, g, pg);
          await this.dischargePurgeObligation(projectId, g);   // Q-M3：两段全成→义务衰减（boot 空转扫描收敛）
        } catch (err) {
          yjsCompactPurgeDeferredTotal.inc();
          this.logger.warn(`compact ④清理段延迟 for ${projectId}（发布已落定——义务由 purgeBelowSeq 持久承载，boot/tick 续跑）: ${(err as Error).message}`);
          captureCollabException(err, { docName: projectDocName(projectId), reason: 'compact-purge-deferred', connectionId: '-' });
        }
        docSnapshotBytes.set(newSnapshot.length);   // T11：snapshot 独立观测 gauge（发布成功单点）
        return {
          compacted: true, snapshotBytes: newSnapshot.length, deletedRows, tombstoneBytes: tombstone.length,
          snapshotRev: pg, stateSeq: pg, purgeBelowSeq: pg,
        };
      } finally {
        temp.destroy();
      }
    } finally {
      docCompactionDuration.observe((Date.now() - t0) / 1000);   // 采集挂 finally（家族纪律）：throw 的慢尾恰是最该被看见的样本
    }
  }

  /** T11 提交后分批删（幂等·续跑安全）：删 (projectId,generation,seq≤below) 增量行——500/批循环。
   *  行集=发布事务折叠的前缀（≤purgeBelowSeq=新快照 stateSeq）——快照权威已覆盖其内容；被删集⊆
   *  被重放集由 purgeBelowSeq≡发布 stateSeq 构造保证。跨代行不删：**现行语义=跨代连续 seq（T12 落定
   *  ——I2/Q-I2 钉锚）**：旧代行由 vacuumReplace 换代事务**同事务整删**（本 generation 谓词=换代竞态
   *  窗防御）；连续 seq 下跨代行 seq 单调（新代帧承接旧代 maxSeq）——若未来改「换代自 1 重起」须同步
   *  把本谓词改新代域+新代快照重定基+C1① 播种分代，否则跨代同 seq 撞行（repository 本头注=偏离面
   *  钉锚——readConsistent 尾谓词无 generation 过滤**同为设计**：换代正确性由「插行代辖正确+旧代行
   *  同事务整删」构造性保证，非读侧过滤）。返回实删行数。 */
  async purgeBelow(projectId: string, generation: number, belowSeq: bigint): Promise<number> {
    let deleted = 0;
    for (;;) {
      const r = await this.prisma.$queryRaw<{ n: number }[]>`
        WITH victims AS (
          SELECT ctid FROM "CanvasDocUpdate"
          WHERE "projectId" = ${projectId}::text AND generation = ${generation}::int AND seq <= ${belowSeq}::bigint
          ORDER BY seq ASC LIMIT ${CanvasDocUpdateRepository.PURGE_BATCH_ROWS}
        )
        DELETE FROM "CanvasDocUpdate" WHERE ctid IN (SELECT ctid FROM victims) RETURNING 1`;
      const n = r.length;
      deleted += n;
      if (n < CanvasDocUpdateRepository.PURGE_BATCH_ROWS) return deleted;
    }
  }

  /** T11 保留策略：当前代 2 份（指针行+其前一 rev）+旧代各最终 1 份（新快照发布后删旧）。
   *  指针行恒保留（两式删除域均排除 top 集合；currentSnapshotRev∈当代 top-1）。 */
  async pruneSnapshots(projectId: string, currentGeneration: number, currentRev: bigint): Promise<void> {
    // 当代：保留 top-2 rev（指针+前一发布）
    await this.prisma.$executeRaw`
      DELETE FROM "CanvasDocSnapshot" s
      WHERE s."projectId" = ${projectId}::text AND s.generation = ${currentGeneration}::int
        AND s."snapshotRev" < (
          SELECT COALESCE(MIN(t.rev), 0) FROM (
            SELECT "snapshotRev" AS rev FROM "CanvasDocSnapshot"
            WHERE "projectId" = ${projectId}::text AND generation = ${currentGeneration}::int
            ORDER BY "snapshotRev" DESC LIMIT 2
          ) t
        )`;
    // 旧代：各代保留最大 rev 一份（vacuum 换代后的历史代快照收敛）
    await this.prisma.$executeRaw`
      DELETE FROM "CanvasDocSnapshot" s
      WHERE s."projectId" = ${projectId}::text AND s.generation < ${currentGeneration}::int
        AND s."snapshotRev" < (
          SELECT MAX(s2."snapshotRev") FROM "CanvasDocSnapshot" s2
          WHERE s2."projectId" = s."projectId" AND s2.generation = s.generation
        )`;
    void currentRev;   // 指针行∈当代 top-1（rev 单调=pgSeq）——显式钉锚：删除域结构性排除指针行
  }

  /** Q-M3（T11 双评审）：清理义务衰减——purgeBelowSeq 在「分批删+保留策略两段全成」后置 null
   *  （义务闭环）。防随时间单调增长的空转扫描：resumePurges 的 NOT NULL 全量扫描在无衰减语义下
   *  恒命中全部已发布 doc（每 doc 每次发布 GREATEST 落定一次，永不清理）；衰减后稳态 boot/tick
   *  扫描=仅 kill 窗残留义务。幂等（WHERE IS NOT NULL——0 行 no-op）；换代竞态窗（vacuum 置
   *  null 后本 UPDATE 0 行）无害。 */
  private async dischargePurgeObligation(projectId: string, generation: number): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "CanvasDoc" SET "purgeBelowSeq" = NULL
      WHERE "projectId" = ${projectId}::text AND generation = ${generation}::int AND "purgeBelowSeq" IS NOT NULL`;
  }

  /** T11 启动续跑（kill 在指针发布后/分批删完成前 ⇒ 重启不丢清理义务）：扫全部 purgeBelowSeq 已
   *  持久化 doc，续跑批删+保留策略收敛。幂等（无残留行=no-op）；消费方=CollabCompactPoller
   *  onModuleInit（worker 进程）。返回续跑 doc 数（Q-M3 衰减后稳态=0——仅 kill 窗残留命中）。 */
  async resumePurges(): Promise<number> {
    const pending = await this.prisma.$queryRaw<{ projectId: string; generation: number; purgeBelowSeq: bigint; currentSnapshotRev: bigint }[]>`
      SELECT "projectId", generation, "purgeBelowSeq", "currentSnapshotRev" FROM "CanvasDoc"
      WHERE "purgeBelowSeq" IS NOT NULL`;
    for (const p of pending) {
      await this.purgeBelow(p.projectId, p.generation, p.purgeBelowSeq);
      await this.pruneSnapshots(p.projectId, p.generation, p.currentSnapshotRev);
      await this.dischargePurgeObligation(p.projectId, p.generation);   // Q-M3：两段全成→衰减（下轮扫描不再命中）
    }
    return pending.length;
  }

  /** C1①（T11 双评审 Critical）boot 播种读面：CanvasDoc (projectId,generation,pgSeq) 全集——gateway
   *  startCollabAfterLease init 步消费（逐行 spool.setProjectGeneration+spool.seedWalSeqFromPg——
   *  boot 三元组播种，**先于 replayAll**：generation 是回灌插行代辖单源〔C1' 复核 round-2 Critical——
   *  不播种则 genOf=??1 落错代×compact ② 代辖滤除=真空纪静默丢数据链〕；walSeq floor max 语义，段全
   *  回收项目计数器自 PG 真值重建，scan 面零段不可得）。单查询全表（CanvasDoc 每项目一行）。 */
  async pgSeqFloors(): Promise<Array<{ projectId: string; generation: number; pgSeq: bigint }>> {
    return this.prisma.$queryRaw`SELECT "projectId", generation, "pgSeq" FROM "CanvasDoc"`;
  }

  /** Y1c T12：schemaVersion⇒generation 启动断言（spec §2 v5-5「维持（违反拒绝启动）」——gateway
   *  boot init 消费，违例 throw=start-failed 有界重试不自动修复）。deploy 纪律：schema 硬切换
   *  （CANVAS_DOC_SCHEMA_VERSION bump）必伴随换代（generation++——docName/缓存键失效链）或行清理
   *  （reset-collab——本仓 schema 切换批既定「无迁移」纪律）。违例两类：
   *  ①schemaVersion≠current ∧ generation=0——旧 schema 残行未按纪律收口（换代或清理二选一）；
   *  ②schemaVersion>current——代码 downgrade 于数据（任何 generation 形态皆拒——新版数据结构
   *  不可由旧代码解释，per-row 版本门拒载=静默半服务，不如拒启显性）。 */
  async assertSchemaGenerationDiscipline(): Promise<void> {
    const violations = await this.prisma.$queryRaw<{ projectId: string; schemaVersion: number | null; generation: number }[]>`
      SELECT "projectId", "schemaVersion", generation FROM "CanvasDoc"
      WHERE ("schemaVersion" IS DISTINCT FROM ${CANVAS_DOC_SCHEMA_VERSION}::int AND generation = 0)
         OR "schemaVersion" > ${CANVAS_DOC_SCHEMA_VERSION}::int`;
    if (violations.length > 0) {
      throw Object.assign(
        new Error(`schemaVersion⇒generation 启动断言违反（${violations.length} 行——schema 硬切换未伴随换代/清理，或数据 schemaVersion 新于代码）：${violations.slice(0, 5).map((v) => `${v.projectId}(sv=${v.schemaVersion},g=${v.generation})`).join(',')}${violations.length > 5 ? '…' : ''}——拒启（deploy 纪律=换代或 reset-collab 清行）`),
        { schemaGenerationViolation: true },
      );
    }
  }
}
