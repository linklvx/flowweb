// 时区族修复（第九轮用户裁决）：微信支付 time_expire 契约=北京时间 RFC3339——
// 三处实现（wechat-payment.provider / subscription-order.service / team-recharge.service）
// 原用本地时区方法（getHours 等），UTC 环境（CI runner）上数字与 +08:00 标注错位。
// 本 spec 断言恒定 +08:00 偏移：用例一律以绝对时刻（Z 后缀/纪元毫秒）构造，
// 在任意 TZ 环境下期望值不变（时区无关性本身即被测对象）。
import { describe, it, expect } from 'vitest';
import { formatBeijingRfc3339 } from './beijing-time';

describe('formatBeijingRfc3339（三处合一 util）', () => {
  it('UTC 06:00:00 → 北京 14:00:00（恒定偏移，与 runner 时区无关）', () => {
    expect(formatBeijingRfc3339(new Date('2026-07-26T06:00:00Z'))).toBe('2026-07-26T14:00:00+08:00');
  });

  it('跨日边界：UTC 16:05:09 → 北京次日 00:05:09（+08 越日进位）', () => {
    expect(formatBeijingRfc3339(new Date('2026-01-05T16:05:09Z'))).toBe('2026-01-06T00:05:09+08:00');
  });

  it('秒精度与补零：UTC 01:02:03 → 北京 09:02:03，月/日/时分秒双位补零', () => {
    expect(formatBeijingRfc3339(new Date('2026-03-07T01:02:03Z'))).toBe('2026-03-07T09:02:03+08:00');
  });

  it('北京时刻即 UTC+8 本身（无偏移损失）：UTC 23:59:59 → 北京 07:59:59', () => {
    expect(formatBeijingRfc3339(new Date('2026-12-31T23:59:59Z'))).toBe('2027-01-01T07:59:59+08:00');
  });
});
