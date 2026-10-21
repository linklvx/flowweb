// packages/shared/src/canvas/media-fact.ts
// Y1a T3（片 S0）：media 事实域单源模块（本卡先落 compareExecSeq；T8 续入 resolveUpstreamMediaUrl——
// plan Files 点名本文件为 S2 上游媒体解析的载体）。execSeq wire/doc 形态=string（DB BigInt→JSON
// string 化——GenerationIntent.execSeq BigInt @unique；2^53 之上 Number 精度必损，禁 Number 中转）。
/** execSeq 合法域：十进制非负整数字符串（BigInt 可解析形态；容忍前导零——"007"≡7，禁负号/小数点/
 *  正号/空白/科学计数法——execSeq 语义域=DB sequence 单调正整数）。 */
const EXEC_SEQ_RE = /^\d+$/;
function parseExecSeq(s: string): bigint {
  if (!EXEC_SEQ_RE.test(s)) {
    throw new Error(`EXEC_SEQ_INVALID: execSeq "${s}" 非法（期望非负十进制整数字符串——BigInt wire 形态；fail-fast 非静默 drop）`);
  }
  return BigInt(s);
}
/** execSeq 比较单源（Y1a T3——T9 代际围栏/onTick abort/takeover void/T15 投影 recheck 共用）：
 *  数值比较非字典序（"10">"9"），BigInt 全程（2^53 边界精度保真），前后导零归一（"007"≡7），
 *  非法 string fail-fast throw（仓内惯例=assertions/copyPlan/docShape 同款——进程内 bug/数据损坏
 *  即刻暴露，禁静默 drop 吞代际错判）。返回 -1/0/1 三态（排序友好）。
 *  裸比较禁令：业务代码禁 `a.execSeq > b.execSeq` 字典序裸比——执法面=scripts/check-plan-census.mjs
 *  grep gate（lint 轻形态，仓内 check-*.mjs 惯例）。 */
export function compareExecSeq(a: string, b: string): -1 | 0 | 1 {
  const ba = parseExecSeq(a);
  const bb = parseExecSeq(b);
  return ba < bb ? -1 : ba > bb ? 1 : 0;
}

// ── Y1a T8：上游媒体 URL 解析（S2——上游注入读 NodeArtifact PG 权威后，外呼时身份→可达 URL） ──

/** /flowai URL → MinIO 对象键（同源路径与完整 presigned URL 两形态；query 签名参数剥离）。
 *  web 侧 toFlowaiUrl 改写（^https?://[^/]+/flowai → /flowai）的逆向提取——手工 doc URL
 *  （/flowai/ 形态）→ key → Media (bucket,key) 反查身份用。非 /flowai 域（外网 URL）→ null。 */
export function extractFlowaiObjectKey(url: string): string | null {
  const m = /^(?:https?:\/\/[^/]+)?\/flowai\/([^?#/][^?#]*)/.exec(url);
  return m ? m[1] : null;
}

/** 上游外呼 URL 解析决策输入（Media 行三列投影——sourceUrlExpiresAt 容忍 Date|string）。 */
export interface UpstreamMediaSource {
  sourceUrl: string | null;
  sourceUrlExpiresAt: Date | string | null;
  key: string; // MinIO 对象键（Media.key 非空列——降级 presign 目标）
}

/** 上游外呼 URL 解析单源（Y1a T8）：①Media.sourceUrl 未过期直传（provider 取自家 URL）；
 *  ②过期/缺失降级 MinIO presigned GET（调用方注入回调——生产=nginx /flowai 域名反代 MinIO，
 *  api 侧 minio.service generatePresignedGetUrl）。
 *  过期判定：sourceUrlExpiresAt 非空且 <= now 即过期（端点算过期）；null=无显式过期语义，
 *  按 provider URL 不校验过期直传（schema 列为准，勿臆造续期检查）。
 *  纯决策零 IO（零依赖叶子模块）——presign 产能与 DB 读行归调用方（upstream-media.service）。 */
export async function resolveUpstreamMediaUrl(
  media: UpstreamMediaSource,
  presignedGet: (key: string) => Promise<string>,
  now: Date = new Date(),
): Promise<string> {
  const expiresAt = media.sourceUrlExpiresAt == null
    ? null
    : new Date(media.sourceUrlExpiresAt).getTime();
  if (media.sourceUrl !== null && (expiresAt === null || expiresAt > now.getTime())) {
    return media.sourceUrl;
  }
  return presignedGet(media.key);
}
