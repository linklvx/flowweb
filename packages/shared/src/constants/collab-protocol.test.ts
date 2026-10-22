import { describe, it, expect } from 'vitest';
import { CLIENT_PROTOCOL_VERSION, negotiateClientVersion } from './collab-protocol';

describe('CLIENT_PROTOCOL_VERSION（spec §3.4 两常量分离——≠ docShape CANVAS_DOC_SCHEMA_VERSION）', () => {
  it('版本 bump 纪律锚：CLIENT_PROTOCOL_VERSION 值断言（v3：PROTOCOL_COMPAT 矩阵已删——常量单点+bump 时本测改值即红）', () => {
    expect(CLIENT_PROTOCOL_VERSION).toBe(3);   // T18 版本硬切（Y1c）：csv=2→3（与 CANVAS_DOC_SCHEMA_VERSION 同 bump——双常量=3）
  });
});

describe('negotiateClientVersion 四档分型（v2 M-4+v3 修正）', () => {
  it('csv 缺失/不可解析不进比较——分档在 negotiate 前置分支', () => {
    expect(negotiateClientVersion(null)).toBe('client-version-missing');
    expect(negotiateClientVersion('')).toBe('client-version-missing');
    expect(negotiateClientVersion('abc')).toBe('client-version-invalid');
    expect(negotiateClientVersion('1.5')).toBe('client-version-invalid');
  });
  it("精确相等——'0'（非正整数）=client-version-invalid（v3 三处矛盾统一：csv=0 只可能来自伪造/第三方客户端，无法推断语义）", () => {
    expect(negotiateClientVersion('3')).toBe('allow');
    expect(negotiateClientVersion('0')).toBe('client-version-invalid');
  });
  it('csv>current=server-outdated（reload 无效档）；csv<current=schema-outdated——T18 bump csv=3 后 csv=2 即真实旧客户端形态（硬切批线上存量 bundle），csv=1 历史档同拒', () => {
    expect(negotiateClientVersion('999')).toBe('server-outdated'); // 999 > 3
    expect(negotiateClientVersion('2')).toBe('schema-outdated');   // T18 真实旧客户端：v2 存量 bundle——reload 有效档
    expect(negotiateClientVersion('1')).toBe('schema-outdated');   // 历史档同拒
  });
});
