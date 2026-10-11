import { describe, it, expect } from 'vitest';
import { CLIENT_PROTOCOL_VERSION, negotiateClientVersion } from './collab-protocol';

describe('CLIENT_PROTOCOL_VERSION（spec §3.4 两常量分离——≠ docShape CANVAS_DOC_SCHEMA_VERSION）', () => {
  it('版本 bump 纪律锚：CLIENT_PROTOCOL_VERSION 值断言（v3：PROTOCOL_COMPAT 矩阵已删——常量单点+bump 时本测改值即红）', () => {
    expect(CLIENT_PROTOCOL_VERSION).toBe(2);   // Y0b-4 T1 bump（Q-S）：csv=2
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
    expect(negotiateClientVersion('2')).toBe('allow');
    expect(negotiateClientVersion('0')).toBe('client-version-invalid');
  });
  it('csv>current=server-outdated（reload 无效档）；csv<current=schema-outdated——Y0b-4 bump csv=2 后 csv=1 即真实旧客户端形态（首版=1 下结构性不可达已消除，注入位退役）', () => {
    expect(negotiateClientVersion('999')).toBe('server-outdated'); // 999 > 2
    expect(negotiateClientVersion('1')).toBe('schema-outdated');   // csv=1 < 2——旧 bundle reload 有效档
  });
});
