// apps/api/src/modules/collab/collab-replay-canary.service.ts
// C2-2a（plan Task C2-2 捕获侧——生产就绪收尾批，spec v5 §3 C2）：replay canary 捕获协议单源。
// 比对侧（worker verify/语义兜底/compare-and-delete/续租）归 C2-2b——本文件只承载捕获面。
//
// ═══ CAPTURING pin-first 捕获（v3.1 竞态三修——五步） ═══════════════════════════
// 调用形态=withFrozenPrefix 的 fn 内（collab-replay-canary.poller——冻结临界区保证活 doc==PG@appliedSeq，
// 捕获坐标 pgSeqAt 即冻结前缀真值）：
//   ① 短事务首语句 `SELECT … FROM "CanvasDoc" WHERE projectId=${pid} FOR SHARE`——与 compact ③ 发布
//     事务的 CanvasDoc FOR UPDATE 互斥（C2-1 红③ 同族行锁序：gate→doc 行，无 advisory 无环）：
//     pin INSERT 与指针发布串行化，**pin 在 prune 前可见**（红⑤-a 创建窗根修半边）；
//   ② 快照选择=**stateSeq≤pgSeqAt 的最新快照行**（currentSnapshotRev 可能指向 stateSeq>pgSeqAt 的
//     新快照〔发布后冻结读坐标滞后形态〕——坐错标根除；无满足快照→**回退 genesis rev 0**）；
//   ③ INSERT CanaryPin(status='CAPTURING', leaseUntil, expiresAt, 坐标)——先落库后算哈希
//     （pin-first：④⑤ 失败窗内坐标已被 prune/purge 谓词保护）；
//   ④ fn 内（事务外）算 SV+canonical hash：pendingStructs===null 口径（compact abandoned 同判——
//     非空=canonical 不成立拒捕获）+encodeStateAsUpdate canonical 编码（compact ② 同口径——hash
//     算法复用 canvas-doc-genesis seedStateHash 单源）+尺寸阈值（超限 hashSkipped=true 只取 SV——
//     10k doc 单次捕获阻塞预算护栏）+canary_capture_ms 计时；
//   ⑤ UPDATE pin status='READY'+contentHash/hashSkipped（失败→DELETE pin 残留自清）。
// 漂移守卫：① 行读 generation/pgSeq ≠ 调用方冻结坐标 ⇒ 拒捕获零 pin（fail-safe——冻结读后换代/推进
// 形态；正常路径 withFrozenPrefix 已断言 pgSeq==appliedSeq）。
// 形态裁定（free-function 非 @Injectable）：消费方=poller（api 进程，持 prisma 直面）——
// collab-ops-gate.service/project-governance.service 同族先例。
import * as Y from 'yjs';
import { seedStateHash } from './canvas-doc-genesis';
import { hasPendingStructs } from './canvas-doc.factory';
import { collabCanaryCaptureMs, collabCanaryHashSkippedTotal, collabCanaryPinRetryTotal } from './collab-canary.metrics';

/** pin TTL 15min（spec §3 C2：TTL 15min＋worker 续租〔C2-2b〕＋过期清扫〔poller 每 tick 顺带
 *  DELETE WHERE expiresAt<now〕）；leaseUntil 初始=同 TTL（续租归 C2-2b worker verify 面）。 */
export const CANARY_PIN_TTL_MS = 15 * 60_000;
/** hash 算法版本（pin.hashVersion 列承载——C2-2b 比对侧按版本分档，红⑦ hashVersion 演进不误报）。 */
export const CANARY_HASH_VERSION = 1;
/** canonical 编码尺寸阈值（超限 hashSkipped=true 只取 SV——10k doc 单次捕获阻塞预算护栏；
 *  测试缝=captureCanaryPin maxHashBytes 参数压小值触发，生产不传=本常量单源）。 */
export const CANARY_HASH_MAX_BYTES = 8 * 1024 * 1024;

/** 捕获结果：ok=true=pin READY 落定；拒档=零 pin 残留（失败自清）。error 档附 detail（C2-2a 评审
 *  Important#1：零日志吞异常根除——free-function 家族「返回类型化结果、调用方记日志」形态补齐）。 */
export type CanaryCaptureResult =
  | { ok: true; snapshotRev: bigint; stateSeq: bigint; pgSeqAt: bigint; contentHash: string | null; hashSkipped: boolean }
  | { ok: false; reason: 'no-doc' | 'generation-drift' | 'pg-drift' | 'pending-structs' | 'error'; detail?: string };

/** prisma/tx 最小结构面（OpsGateReadClient 同族局部命名——$transaction+$executeRaw 两面）。 */
export type CanaryClient = {
  $transaction<T>(fn: (tx: CanaryTx) => Promise<T>, opts?: { timeout?: number; maxWaitMs?: number; isolationLevel?: 'ReadCommitted' | 'RepeatableRead' }): Promise<T>;
};
export type CanaryTx = {
  $queryRaw<T = unknown>(q: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(q: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
};

/** canonical 编码（compact ② stateHash 同口径——encodeStateAsUpdate 单点；C2-2b verify worker
 *  重算 hash 消费面：捕获/比对两侧同一编码函数=口径单源）。尺寸超限返回 null（=捕获 hashSkipped
 *  档/verify 侧降级 SV 判——超限侧不 hash）。 */
export function encodeCanonicalUpdate(doc: Y.Doc, maxBytes: number = CANARY_HASH_MAX_BYTES): Buffer | null {
  const buf = Buffer.from(Y.encodeStateAsUpdate(doc));
  return buf.length > maxBytes ? null : buf;
}

/**
 * 捕获协议五步（fn 内调用——见文件头注）。args.doc=冻结临界区活 doc（==PG@appliedSeq）。
 * 失败档一律 best-effort DELETE 自清（compare 谓词=本坐标 CAPTURING 行——不误删他 pin）。
 */
export async function captureCanaryPin(
  client: CanaryClient,
  args: { projectId: string; generation: number; pgSeqAt: bigint; doc: Y.Doc; maxHashBytes?: number },
): Promise<CanaryCaptureResult> {
  const t0 = Date.now();
  const maxBytes = args.maxHashBytes ?? CANARY_HASH_MAX_BYTES;
  try {
    // ①-③ 短事务（FOR SHARE 与 compact ③ 发布 FOR UPDATE 互斥——pin 在 prune 前可见）
    const pinned = await client.$transaction(
      async (tx) => {
        const head = await tx.$queryRaw<{ generation: number; pgSeq: bigint; currentSnapshotRev: bigint }[]>`
          SELECT generation, "pgSeq", "currentSnapshotRev" FROM "CanvasDoc"
          WHERE "projectId" = ${args.projectId}::text FOR SHARE`;
        if (head.length === 0) return { kind: 'no-doc' as const };
        if (head[0]!.generation !== args.generation) return { kind: 'generation-drift' as const };
        if (head[0]!.pgSeq !== args.pgSeqAt) return { kind: 'pg-drift' as const };
        // ② 快照选择：stateSeq≤pgSeqAt 的最新快照行（ORDER 双键稳序）；无满足→genesis rev 0 回退
        const snap = await tx.$queryRaw<{ snapshotRev: bigint; stateSeq: bigint }[]>`
          SELECT "snapshotRev", "stateSeq" FROM "CanvasDocSnapshot"
          WHERE "projectId" = ${args.projectId}::text AND generation = ${args.generation}::int AND "stateSeq" <= ${args.pgSeqAt}::bigint
          ORDER BY "stateSeq" DESC, "snapshotRev" DESC LIMIT 1`;
        const snapshotRev = snap[0]?.snapshotRev ?? 0n;
        const stateSeq = snap[0]?.stateSeq ?? 0n;
        // ③ pin-first INSERT（CAPTURING+坐标+TTL/lease——同 pid 旧 pin 在场=PK 冲突 throw（调用方
        //    pre-check skip-pin-active 后的竞态窗——catch 折 error 档，TTL 清扫兜底不误删他 pin）。
        //    TTL 时钟=PG now() 单源（raw Date 参数按连接时区序列化=非 UTC 机漂移面——make_interval 根除）
        await tx.$executeRaw`
          INSERT INTO "CanaryPin" ("projectId", status, generation, "snapshotRev", "stateSeq", "pgSeqAt", "hashVersion", "leaseUntil", "expiresAt")
          VALUES (${args.projectId}::text, 'CAPTURING', ${args.generation}::int, ${snapshotRev}::bigint, ${stateSeq}::bigint,
            ${args.pgSeqAt}::bigint, ${CANARY_HASH_VERSION}::int,
            now() + make_interval(secs => ${CANARY_PIN_TTL_MS / 1000}), now() + make_interval(secs => ${CANARY_PIN_TTL_MS / 1000}))`;
        return { kind: 'pinned' as const, snapshotRev, stateSeq };
      },
      { timeout: 5_000, maxWaitMs: 2_000 },
    );
    if (pinned.kind !== 'pinned') {
      // C2-2b（C2-2a 评审 Minor#4）：no-doc=候选面 skip 档（poller skip-no-doc 计数承担）非 pin
      // 建立失败——pin_retry 词表（help：漂移守卫/pendingStructs/落库异常）排除该档不虚计。
      if (pinned.kind !== 'no-doc') collabCanaryPinRetryTotal.inc();
      return { ok: false, reason: pinned.kind };
    }
    // ④ fn 内（事务外）：SV 恒落；hash=canonical 口径（pendingStructs===null 先决——compact abandoned 同判）
    const stateVector = Buffer.from(Y.encodeStateVector(args.doc));
    if (hasPendingStructs(args.doc)) {
      await deleteOwnPin(client, args, pinned.snapshotRev);
      collabCanaryPinRetryTotal.inc();
      return { ok: false, reason: 'pending-structs' };
    }
    const canonical = encodeCanonicalUpdate(args.doc, maxBytes);   // canonical 编码（compact ② 同口径——C2-2b worker 重算同函数单源）
    let contentHash: string | null = null;
    let hashSkipped = false;
    if (canonical == null) {
      hashSkipped = true;
      collabCanaryHashSkippedTotal.inc();
    } else {
      contentHash = seedStateHash(canonical);   // hash 算法单源复用（genesis/compact stateHash 同口径）
    }
    // ⑤ READY（contentHash∨hashSkipped 档落定）
    await client.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE "CanaryPin" SET status = 'READY', "contentHash" = ${contentHash}::char(64), "hashSkipped" = ${hashSkipped},
          "stateVector" = ${stateVector}
        WHERE "projectId" = ${args.projectId}::text AND status = 'CAPTURING'
          AND "snapshotRev" = ${pinned.snapshotRev}::bigint AND "pgSeqAt" = ${args.pgSeqAt}::bigint`;
    }, { timeout: 5_000, maxWaitMs: 2_000 });
    return { ok: true, snapshotRev: pinned.snapshotRev, stateSeq: pinned.stateSeq, pgSeqAt: args.pgSeqAt, contentHash, hashSkipped };
  } catch (e) {
    // 落库异常（含 INSERT PK 冲突竞态窗）：best-effort 自清（compare 谓词护他 pin）+error 档附
    // detail（Important#1——调用方 poller 记 warn，本函数不吞零日志）
    await deleteOwnPin(client, args, null).catch(() => undefined);
    collabCanaryPinRetryTotal.inc();
    return { ok: false, reason: 'error', detail: (e as Error).message };
  } finally {
    collabCanaryCaptureMs.observe(Date.now() - t0);   // 采集挂 finally（家族纪律）：失败样本同观测
  }
}

/** 失败自清：只删本坐标 CAPTURING 行（snapshotRev 已知时收紧谓词；null=捕获事务本身失败——
 *  CAPTURING 残留即本进程所插，compare 兜底不触 READY pin/他项目）。 */
async function deleteOwnPin(client: CanaryClient, args: { projectId: string; pgSeqAt: bigint }, snapshotRev: bigint | null): Promise<void> {
  await client.$transaction(async (tx) => {
    if (snapshotRev != null) {
      await tx.$executeRaw`
        DELETE FROM "CanaryPin" WHERE "projectId" = ${args.projectId}::text AND status = 'CAPTURING'
          AND "snapshotRev" = ${snapshotRev}::bigint AND "pgSeqAt" = ${args.pgSeqAt}::bigint`;
    } else {
      await tx.$executeRaw`
        DELETE FROM "CanaryPin" WHERE "projectId" = ${args.projectId}::text AND status = 'CAPTURING' AND "pgSeqAt" = ${args.pgSeqAt}::bigint`;
    }
  }, { timeout: 5_000, maxWaitMs: 2_000 });
}

/**
 * CollabCanaryCursor 写（poller 每次捕获判定后——lastCheckedAt/lastResult/generation；
 * nextDueAt=now()+nextDueInSec〔poller=轮转间隔排程占位：覆盖节奏 N=ceil(active×1.25/24) 归 C2-2b
 * 重写，列 NOT NULL 故先落占位〕——PG now() 单源时钟，raw Date 参数连接时区序列化漂移面根除〔③ 同判〕）。
 * generation 随捕获真值覆写=换代游标重置（旧代游标永 skip 根除——C2-0 表注）。
 */
export async function writeCanaryCursor(
  client: { $executeRaw(q: TemplateStringsArray, ...values: unknown[]): Promise<unknown> },
  projectId: string,
  generation: number,
  lastResult: string,
  nextDueInSec: number,
): Promise<void> {
  await client.$executeRaw`
    INSERT INTO "CollabCanaryCursor" ("projectId", generation, "lastCheckedAt", "lastResult", "nextDueAt")
    VALUES (${projectId}::text, ${generation}::int, now(), ${lastResult}::text, now() + make_interval(secs => ${nextDueInSec}))
    ON CONFLICT ("projectId") DO UPDATE
      SET generation = EXCLUDED.generation, "lastCheckedAt" = EXCLUDED."lastCheckedAt",
          "lastResult" = EXCLUDED."lastResult", "nextDueAt" = EXCLUDED."nextDueAt"`;
}
