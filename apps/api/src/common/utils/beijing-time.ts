/** 北京时刻格式化（微信支付 time_expire 契约：RFC3339 +08:00 秒精度）。
 *  恒定偏移计算（UTC+8）——与部署环境时区无关（CI runner=UTC；原三处实现用本地时区
 *  方法 getHours 等，UTC 环境数字与 +08:00 标注错位，2026-10-05 时区族修复三处合一）：
 *  wechat-payment.provider / subscription-order.service / team-recharge.service。 */
const BJ_OFFSET_MS = 8 * 3600 * 1000;

export function formatBeijingRfc3339(date: Date): string {
  const bj = new Date(date.getTime() + BJ_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${bj.getUTCFullYear()}-${p(bj.getUTCMonth() + 1)}-${p(bj.getUTCDate())}` +
    `T${p(bj.getUTCHours())}:${p(bj.getUTCMinutes())}:${p(bj.getUTCSeconds())}+08:00`
  );
}
