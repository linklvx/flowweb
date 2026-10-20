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
export function compareExecSeq(a: string, b: string): number {
  const ba = parseExecSeq(a);
  const bb = parseExecSeq(b);
  return ba < bb ? -1 : ba > bb ? 1 : 0;
}
