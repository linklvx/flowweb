// packages/shared/src/collab/system-history.ts
// Y1c T5b（plan v1.7 Task 5 业务 DDL 段——spec v5.4 §4.4/§6：SystemHistory 全局单行唯一权威+
// CanvasDocUpdate.actorRanges Json 单表示+updateHash canonical+DocAuditEvent）。
// **CONTRACT-FREEZE**（T21 解冻窗口已消费——头注改记消费落地）：类型+常量+纯函数；
// 消费方=T7（DDL/genesis）/**已落地**/T10（批装配 actorRanges/updateHash——api batchUpdateHash
// 经 §3 canonical 委托单一化）/T21（**已落地**：R2 双 preimage 退役+审计落库）。契约测试=system-history.spec.ts（TDD 红先行）。

// ═══ §1 SystemHistory 全局单行唯一权威（v5.4⑦——删 CanvasDoc.historyId 列）══════════════════

/** SystemHistory 行（spec §6 DDL——`id Int @id @default(1)`+historyId+epochStartedAt+updatedAt；
 *  extends T5a doc-protocol SystemHistoryState（两字段单源不重复——本行补全 DDL 列集）：
 *  restore 恒整库恢复；WAL 段头 historyId 直存本行值；feed cursor=(historyId,generation,feedSeq) 三元首元） */
export interface SystemHistoryRow {
  /** 恒 1——全局单行唯一权威 */
  id: 1;
  historyId: string;
  epochStartedAtMs: number;
  updatedAtMs: number;
}

/** bump 纪律（plan v1.7：bump 单事务提交后才允许启动；启动任一不匹配/缺失/为零=fail-closed 不自动修复） */
export const SYSTEM_HISTORY_BUMP_CONTRACT = {
  bump: 'bump 单事务（更新 SystemHistory+trigger 同步缓存）提交后才允许启动；--rebuild-db/restore 类工具收尾必须 bump historyId（§4.4）',
  failClosed: '启动任一不匹配/缺失/为零=fail-closed 不自动修复（--adopt-wal 窄窗=historyId 已匹配+operator 显式确认+审计三条件缺一不可）',
} as const;

/** 删除列登记（v1.7 删 CanvasDoc.historyId——负控常量：T7 迁移后本列不得复生） */
export const CANVAS_DOC_HISTORY_COLUMN_REMOVED = 'historyId' as const;

// ═══ §2 CanvasDocUpdate.actorRanges Json 单表示（v1.7——删 actor 列）══════════════════════════

/** 写者类别（批装配定值——T10 消费；system=维护/服务端写通道） */
export type CanvasActorKind = 'user' | 'system';

/** 单 actor 区间（plan v1.7 DDL 注记 `[{from,to,userId,actorKind}]`）：
 *  - **from/to=十进制字符串**（半开 [from,to)——to=下一区间起点/末段 to=批 lastWalSeq+1；
 *    **BigInt 禁入 JSON number**：2^53 精度损失——number 类型即拒，校验见 isDecimalBigintString）
 *  - 区间覆盖每帧**不重叠无空洞**（批级校验 validateActorRanges）；userId 仅内部 ID */
export interface ActorRange {
  from: string;
  to: string;
  userId: string;
  actorKind: CanvasActorKind;
}

/** 十进制字符串判据（canonical：无前导零/无符号/无小数——负控 number 直拒） */
export const DECIMAL_BIGINT_STRING_RE = /^(0|[1-9][0-9]*)$/;

/** 十进制字符串类型守卫（纯函数——`typeof v === 'string'` 先行：number/其他类型一律 false） */
export function isDecimalBigintString(v: unknown): v is string {
  return typeof v === 'string' && DECIMAL_BIGINT_STRING_RE.test(v);
}

/** 单区间校验（纯函数）：两端十进制字符串且 to>from（非空半开区间） */
export function validateActorRange(r: ActorRange): boolean {
  if (!isDecimalBigintString(r.from) || !isDecimalBigintString(r.to)) return false;
  return BigInt(r.to) > BigInt(r.from);
}

export type ActorRangesVerdict =
  | { ok: true }
  | { ok: false; reason: 'empty' | 'non-decimal' | 'inverted' | 'overlap' | 'hole' | 'coverage'; detail: string };

/** 批级区间校验（纯函数——T10 批装配后调用）：排序后必须**铺满** [firstWalSeq, lastWalSeq+1)
 *  半开区间——首段 from=firstWalSeq、相邻 from==前段 to（无洞无重叠）、末段 to=lastWalSeq+1。
 *  frameCount>0 ⇒ ranges 非空（每帧必有认领 actor）。 */
export function validateActorRanges(
  ranges: readonly ActorRange[],
  batch: { firstWalSeq: bigint; lastWalSeq: bigint },
): ActorRangesVerdict {
  if (ranges.length === 0) return { ok: false, reason: 'empty', detail: 'frameCount>0 必有认领 actor（空 ranges 非法）' };
  for (const r of ranges) {
    if (!isDecimalBigintString(r.from) || !isDecimalBigintString(r.to)) {
      return { ok: false, reason: 'non-decimal', detail: `from/to 须十进制字符串（BigInt 禁入 JSON number）：${JSON.stringify(r)}` };
    }
    if (BigInt(r.to) <= BigInt(r.from)) {
      return { ok: false, reason: 'inverted', detail: `空/倒置区间：[${r.from},${r.to})` };
    }
  }
  const sorted = [...ranges].sort((a, b) => (BigInt(a.from) < BigInt(b.from) ? -1 : BigInt(a.from) > BigInt(b.from) ? 1 : 0));
  if (BigInt(sorted[0]!.from) !== batch.firstWalSeq || BigInt(sorted[sorted.length - 1]!.to) !== batch.lastWalSeq + 1n) {
    return { ok: false, reason: 'coverage', detail: `首尾未覆盖 [${batch.firstWalSeq},${batch.lastWalSeq + 1n})` };
  }
  for (let i = 1; i < sorted.length; i++) {
    const prevTo = BigInt(sorted[i - 1]!.to);
    const curFrom = BigInt(sorted[i]!.from);
    if (curFrom < prevTo) return { ok: false, reason: 'overlap', detail: `重叠：[${sorted[i - 1]!.from},${prevTo}) × [${curFrom},${sorted[i]!.to})` };
    if (curFrom > prevTo) return { ok: false, reason: 'hole', detail: `空洞：(${prevTo},${curFrom}) 无认领` };
  }
  return { ok: true };
}

// ═══ §3 updateHash=有序 frameHash 列表 SHA-256（v1.7）════════════════════════════════════════

/** updateHash canonical payload（纯函数——**不含 sha256**：shared 无 crypto 先例且需 web 同构，
 *  sha256hex 调用点=api 侧唯一委托 **CanvasDocUpdateRepository.batchUpdateHash**〔T21 R2 单一化
 *  ——T12 评审移交双 preimage 退役：raw-bytes concat 旧形态作废，本函数为唯一 canonical 真源〕；
 *  不引第三方库）：
 *  =JSON.stringify(有序 frameHash 列表)——frameHash=帧记录 64hex（WAL_FRAME_LAYOUT.frameHash 列的
 *  hex 串，doc-protocol.ts 同源）、序=批内 walSeq 升序。**非 merged update 字节**——重试/重组批幂等
 *  （同帧集任意重组 canonical 相同；`@@unique([projectId,generation,updateHash])` 判重锚）。 */
export function canonicalUpdateHashPayload(frameHashes: readonly string[]): string {
  return JSON.stringify(frameHashes);
}

// ═══ §4 DocAuditEvent（敏感操作同 PG 事务审计——180d 保留）════════════════════════════════════

/** 审计种类（closed 五值——v1.2 DocWriteAudit 残留替代：审计=actorRanges+DocAuditEvent） */
export const DOC_AUDIT_KINDS = ['delete', 'execute', 'permission', 'maintenance', 'refund'] as const;
export type DocAuditKind = typeof DOC_AUDIT_KINDS[number];

/** 审计保留期（spec §6 DDL 注记「敏感操作同 PG 事务审计（180d 保留）」——清理 worker 归 T29） */
export const DOC_AUDIT_RETENTION_DAYS = 180 as const;

/** DocAuditEvent 行（spec §6 DDL——`@@index([projectId, createdAt])`；payload **不含正文**；
 *  requestId 关联执行请求（可空——delete/permission 类无请求） */
export interface DocAuditEventRow {
  id: string;
  projectId: string;
  kind: DocAuditKind;
  userId: string;
  requestId?: string;
  payload?: unknown;
  createdAtMs: number;
}
