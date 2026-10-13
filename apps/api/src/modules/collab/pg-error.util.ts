// Y0a-2（X15）：PG 错误判别单源——gateway/spool/breaker 多消费（独立 util 防循环依赖）。
// V6：FK 违反的 DB 权威证据双形状：Prisma P2003（typed throw）与 $queryRaw 失败 P2010+meta.code=SQLSTATE 23503
// （本地真库实测形态——raw 路径唯此可证，见 collab-spool.int.spec.ts）。命中即"项目已删"终态：按终态丢弃+计数。
export function isFkGone(e: unknown): boolean {
  const err = e as { code?: string; meta?: { code?: string } };
  return err?.code === 'P2003' || err?.meta?.code === '23503';
}

/** Y0b-5 T16（spec §5.9 E57）：连接族码表——参与熔断 open 判定的唯一错误集。
 *  P1001=Can't reach database server／P1002=database server reached max connections（服务端连接饱和）／
 *  P1008=Operations timed out（连接超时）。码表单源归本文件：熔断推闸只认 connection 族（classifyPgError）。 */
export const PG_CONNECTION_CODES: readonly string[] = ['P1001', 'P1002', 'P1008'];

/** 真库实证（int 停机注入，Prisma 5.22）：连接失败抛 PrismaClientInitializationError 且 **code=undefined**
 *  （P 码只在 KnownRequestError 上）——纯 code 分类器对真停机恒 other=熔断永不触发。无 code 时按消息
 *  回退连接族（P1001 官方文案特征串——非连接错不加白，禁宽匹配）。 */
const CONNECTION_MESSAGE_PATTERNS: readonly string[] = ["Can't reach database server"];

/** Y0b-5 T16 三档失败分类（collab_pg_breaker_failures_total{class} 单源）：
 *  connection=连接族（推闸——code 码表 ∪ 无 code 的初始化连接失败消息回退）；pool=P2024 池满
 *  （压力期拒新装载=赶走用户方向反了——只观测不推闸）；other=业务错（P2002 等）与其余无 code 错误
 *  （auth deadline/未知——只观测不推闸）。 */
export type PgErrorClass = 'connection' | 'pool' | 'other';

export function classifyPgError(e: unknown): PgErrorClass {
  const err = e as { code?: string; message?: string } | null;
  if (err?.code === 'P2024') return 'pool';
  if (err?.code !== undefined && PG_CONNECTION_CODES.includes(err.code)) return 'connection';
  if (err?.code === undefined && typeof err?.message === 'string'
    && CONNECTION_MESSAGE_PATTERNS.some((p) => err.message!.includes(p))) return 'connection';
  return 'other';
}
