/** 两常量分离（spec §3.4）：CANVAS_DOC_SCHEMA_VERSION（docShape.ts=2，既有——文档结构，Y1c bump）
 * ≠ CLIENT_PROTOCOL_VERSION（本文件——客户端代码/线路协议，URL ?csv= 所指）。两常量分属 api/shared 两包
 * ——禁跨包 import（shared→apps 反向依赖=构建环，v3 S-2）；分离性由命名+注释表达，doc 版本核对归 T5 Step 5bis 只读。
 * 通道=query（R-6 终裁：provider 无 query 配置项，URL 由调用方构造；csv/cb 非凭证，与 cookie-only 不矛盾）。
 * 4.6.0 onAuthenticatePayload.providerVersion 为库内部硬编码值（d.ts:483）——与本协议无关，禁用（P6 勘误）。
 * v3：PROTOCOL_COMPAT 矩阵删除（单键 satisfies 恒满足——"tsc 强制 bump"论证证伪，偏离 14 登记）；
 * 运行时=字面量精确比较；无区间协商（开发期禁兼容层，R 终裁）。 */
export const CLIENT_PROTOCOL_VERSION = 2 as const;
export type ClientProtocolVersion = typeof CLIENT_PROTOCOL_VERSION;

export type VersionVerdict =
  | 'allow' | 'client-version-missing' | 'client-version-invalid'
  | 'schema-outdated'   // csv < current：客户端旧——reload 有效档
  | 'server-outdated';  // csv > current：客户端新于服务端——reload 无效档（v2 M-4 第四档）

export function negotiateClientVersion(csv: string | null | undefined, current: number = CLIENT_PROTOCOL_VERSION): VersionVerdict {
  // current 参数=测试注入位（Y0b-4 T1 bump csv=2 后 csv=1 即真实旧客户端——schema-outdated 档已天然可达，
  // 版本门 spec 注入 mock 已随之拆除；参数保留=签名稳定，当前无消费方）；生产恒默认。
  // 类型放宽为 number：ClientProtocolVersion 字面量类型(=2)会把注入值判 TS2345——注入测无法编译（strict）；默认值仍单点常量
  if (!csv) return 'client-version-missing';
  const n = Number(csv);
  if (!Number.isInteger(n) || n <= 0 || String(n) !== csv.trim()) return 'client-version-invalid';
  if (n === current) return 'allow';
  return n < current ? 'schema-outdated' : 'server-outdated';
}
