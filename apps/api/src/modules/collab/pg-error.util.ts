// Y0a-2（X15）：PG 错误判别单源——gateway/spool 双消费（独立 util 防循环依赖）。
// V6：FK 违反的 DB 权威证据双形状：Prisma P2003（typed throw）与 $queryRaw 失败 P2010+meta.code=SQLSTATE 23503
// （本地真库实测形态——raw 路径唯此可证，见 collab-spool.int.spec.ts）。命中即"项目已删"终态：按终态丢弃+计数。
export function isFkGone(e: unknown): boolean {
  const err = e as { code?: string; meta?: { code?: string } };
  return err?.code === 'P2003' || err?.meta?.code === '23503';
}
/** V8：append 超时/瞬断分类（可重试=true——排退避梯；FK/终态=false）。 */
export function isRetryableAppendError(e: unknown): boolean {
  if (isFkGone(e)) return false;
  const code = (e as { code?: string })?.code;
  return code === 'P1001' || code === 'P2024' || code === 'P2010' || code === undefined;
}
