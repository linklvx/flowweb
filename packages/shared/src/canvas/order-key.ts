// packages/shared/src/canvas/order-key.ts
// T17（plan v11.2 S5 片·spec Z12''/§2.2·Z4''-v14）：单一有界 order 键域——**自实现分数索引**
// （禁第三方分数索引库——方案 A 已裁 2026-10-18）。
//
// 键形（canonical 规范形）：
//   key := <int>[.<frac>]
//   - int：十进制正整数、无前导零、域 [1, ORDER_KEY_MAX_INT]（"单一有界"——2^53 安全整数上沿，
//     Number 算术安全；下沿 1 起=键域非零起点，before(1)=null 即键域下界）。
//   - frac：可选小数尾，规范形=无尾零（"5"/"5.5"/"5.505" 合法；"5.50"=等值非规范形非法——
//     等值消除使 canonical 键与数值一一对应）。
//   - 例："1" < "5" < "5.5" < "5.55" < "5.6" < "6" < "9" < "10" < "10.5"。
//
// 序比较：**数值序单源（compareOrderKeys）**——裸字符串序在整数跨长度（"9" vs "10"）下得反序，
// 全仓禁裸字符串比较 order 键（读序单源=order-records.ts 的 compareWithinLayer 消费本函数）。
//
// 四曲线（§2.2 维持 v10）：
//   ①尾插 after：整数 +1——长度对数增长（1000 次尾插键长 ≤4），禁"逐次 +1 字符"病态。
//   ②头插 before：整数 −1；floor（=1）返 null（调用方容忍重复键+病理计数——repair 归 T18 CLI）。
//   ③④中插 between：邻接整数档落 .5 族；邻接小数档首差位 +1 / 追加 '5'——随机中插长度期望
//     对数增长（soft 24 告警 / hard 128 损坏上限）。
//
// 读写两侧严格（§2.2）：isValidOrderKey 是唯一合法性谓词——分配器只产合法键；读侧（读序/校验）
// 对非法键不抛（fail-closed 到"排序兜底+病理报告"，E68 读侧全函数）。等值邻居（并发/离线合并
// 产生的重复键）不 repair：读序 (order,id) tie-break 容忍（Z4''-v14），equalValueNeighbors
// 供病理计数（soft/hard 告警）与 T18 CLI renumber-layer 消费。

/** 键域上沿（2^53 安全整数——"单一有界"）。 */
export const ORDER_KEY_MAX_INT = 2 ** 53;
/** 键长软限（告警——病理计数消费；spec §0.2-⑤ 维持 v10）。 */
export const ORDER_KEY_SOFT_LIMIT = 24;
/** 键长硬限（损坏上限——超限键非法，读侧排序兜底+病理报告）。 */
export const ORDER_KEY_HARD_LIMIT = 128;
/** 空层首键（层生成起点——中位点，双向留增长余量）。 */
export const FIRST_ORDER_KEY = '5000';

const CANONICAL_RE = /^[1-9][0-9]*$/;
const MAX_INT_BIGINT = BigInt(2 ** 53);

/** canonical 合法性（读写两侧严格单源）。int ≤ MAX_INT（BigInt 判定——2^53 邻域浮点精度坑）；
 *  frac 无尾零；总长 ≤ HARD_LIMIT。 */
export function isValidOrderKey(key: unknown): key is string {
  if (typeof key !== 'string' || key.length === 0 || key.length > ORDER_KEY_HARD_LIMIT) return false;
  const dot = key.indexOf('.');
  const int = dot === -1 ? key : key.slice(0, dot);
  if (!CANONICAL_RE.test(int)) return false; // 无前导零；键域 [1,·)（"0" 非法）
  if (BigInt(int) > MAX_INT_BIGINT) return false; // 有界上沿
  if (dot === -1) return true;
  if (dot === key.length - 1 || key.indexOf('.', dot + 1) !== -1) return false; // 空小数尾/双点
  const frac = key.slice(dot + 1);
  return /^[0-9]+$/.test(frac) && !frac.endsWith('0'); // 尾零=等值非规范形
}

/**
 * 数值序比较（单源——全仓禁裸字符串比较 order 键）。读侧全函数：非法键**不抛且殿后**
 * （int=null 档排在一切合法键后——E68 读侧全函数承诺在单源原语兑现；双非法=0 等值，
 * id tie-break 归调用方）。合法键间为纯数值序（BigInt 防邻域精度）。
 */
export function compareOrderKeys(a: string, b: string): number {
  const [ai, af] = splitKey(a);
  const [bi, bf] = splitKey(b);
  if (ai === null && bi === null) return 0;
  if (ai === null) return 1;    // 非法殿后
  if (bi === null) return -1;
  if (ai !== bi) return ai < bi ? -1 : 1;
  return compareFrac(af, bf);
}

/** 安全拆键（质评 Important#2）：非法整数段（BigInt SyntaxError 面）→ int=null——比较器判
 *  非法键殿后（读侧全函数在单源原语兑现，禁抛穿透调用方）。frac 段保留原文参与字典序（compareFrac
 *  自身纯字符比较零抛）。 */
const splitKey = (k: string): [bigint | null, string] => {
  const dot = k.indexOf('.');
  const intPart = dot === -1 ? (k === '' ? '0' : k) : (k.slice(0, dot) || '0');
  let int: bigint | null;
  try {
    int = BigInt(intPart);
  } catch {
    int = null;   // 非法键（如 'abc'/'1e5'/空档）——不抛，殿后语义
  }
  return [int, dot === -1 ? '' : k.slice(dot + 1)];
};

/** canonical 小数尾字典序=数值序（无尾零规范形下前缀=更小）。 */
const compareFrac = (a: string, b: string): number => {
  if (a === b) return 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length > b.length ? 1 : -1; // 前缀关系：短者小（"5"<"55"）
};

/** 规范化：小数尾剥尾零；全零尾→消小数部（等值消除单源）。 */
function normalize(int: string, frac: string): string {
  if (frac === '') return int;
  let end = frac.length;
  while (end > 0 && frac[end - 1] === '0') end--;
  const f = frac.slice(0, end);
  return f === '' ? int : `${int}.${f}`;
}

const intToStr = (n: number | bigint): string => n.toString();

/** 尾插键（层末追加）：max.int+1（>max ⇒ 与既有键零碰撞）。非法/越上沿 → null。 */
export function orderKeyAfter(key: string): string | null {
  if (!isValidOrderKey(key)) return null;   // isValid 已过 ⇒ splitKey int 非 null（守卫序钉死）
  const [i] = splitKey(key);
  if (i! >= BigInt(ORDER_KEY_MAX_INT)) return null; // 有界上沿
  return intToStr(i! + 1n); // 丢弃小数尾：next-int 恒 > 任意 (int, frac)
}

/** 头插键（层首前插）：min.int−1（<min ⇒ 零碰撞）。floor（=1）/非法 → null（键域下界）。 */
export function orderKeyBefore(key: string): string | null {
  if (!isValidOrderKey(key)) return null;   // isValid 已过 ⇒ splitKey int 非 null（守卫序钉死）
  const [i] = splitKey(key);
  if (i! <= 1n) return null; // 键域 [1,·) 下界
  return intToStr(i! - 1n);
}

/**
 * 中插键（strict: a < m < b；b=null 为无上界=尾插语义的数值续）。
 * 邻接不可表达（a、b 等值——等值邻居）→ null（needs-layer-repair 域，读序 tie-break 容忍）。
 * 非法入参/非严格序（a ≥ b）→ null（fail-closed 不抛）。
 */
export function orderKeyBetween(a: string, b: string | null): string | null {
  if (!isValidOrderKey(a) || (b != null && !isValidOrderKey(b))) return null;
  if (b != null && compareOrderKeys(a, b) >= 0) return null;
  const [ai, af] = splitKey(a);   // isValid 双守卫已过 ⇒ ai 非 null
  const [bi, bf] = b == null ? [null, null] as const : splitKey(b);

  // 情形一：整数部可推进（b 缺或 b.int - a.int ≥ 2，或 a 有小数尾而 b 是更大整数）
  if (bi == null || bi - ai! >= 2n) {
    return intToStr(ai! + 1n); // a < a+1 ≤ b-1 < b（a 带小数尾时 a < a+1 仍成立）
  }
  if (bi === ai! + 1n) {
    // 情形二：邻接整数——落 a 整数档与 b 之间：frac 向 1.0 取中（"5"→"5.5"；"5.5"→"5.75"）
    const fracToTop = midpointFracToCeiling(af);
    return fracToTop == null ? null : normalize(intToStr(ai!), fracToTop);
  }
  // 情形三：同整数部——小数尾中插（a.frac < b.frac 严格，因 a<b 且 int 相等）
  const mid = midpointFrac(af, bf);
  return mid == null ? null : normalize(intToStr(ai!), mid);
}

/** frac → 1.0（槽顶）的**真中位**（邻接档复用——首差位取中位数字，逐层折半 ⇒ 长度对数增长）。 */
function midpointFracToCeiling(frac: string): string | null {
  return midToTop(frac);
}

/**
 * canonical frac 中插：fa < fb（数值=字典序）严格；返回规范中点（fa < m < fb）。
 * 折半策略（四曲线 §2.2——**真中位**非最小增长）：首差位数字间隙 ≥2 → 中位数字
 * (da+db)/2；邻接 → 取 da 位+尾段向槽顶取中（midToTop）；fa 为 fb 前缀 → 隐 '0' 与 fb
 * 续位比对（同一循环自然覆盖）。重复同区间中插长度对数增长（soft 24 告警锚）。
 */
function midpointFrac(fa: string, fb: string): string | null {
  let prefix = '';
  let i = 0;
  for (;;) {
    const da = i < fa.length ? fa[i] : '0';
    const db = i < fb.length ? fb[i] : '0';
    if (da !== db) {
      const gap = db.charCodeAt(0) - da.charCodeAt(0);
      if (gap >= 2) {
        return `${prefix}${String.fromCharCode((da.charCodeAt(0) + db.charCodeAt(0)) >> 1)}`; // 真中位
      }
      // 邻接数字：取 da 位 + fa 尾段向槽顶取中（> fa 恒成立——首差位即超越）
      return `${prefix}${da}${midToTop(i + 1 < fa.length ? fa.slice(i + 1) : '')}`;
    }
    if (i >= fa.length && i >= fb.length) return null; // fa==fb（调用方已排——防御性死循环兜底）
    prefix += db; // 相等位推进（fa 耗尽侧按 '0' 与 fb 的 '0' 继续比对——前缀含 fb 中显式 '0'）
    i++;
  }
}

/** [t, 槽顶 1.0) 区间折半：首字符与 '9' 的中位数字（单字符即落入区间且 > t）；'8'/'9' 嵌位深入；
 *  空 t → '5'。返回恒为规范形（无尾零——首位 ≥ '4' 或深入原尾）。 */
function midToTop(t: string): string {
  if (t === '') return '5';
  const d = t.charCodeAt(0);
  if (d <= 55) return String.fromCharCode((d + 57) >> 1); // ('9'-d ≥ 2 ⇒ d ≤ '7')
  return t[0] + midToTop(t.slice(1)); // d ∈ {'8','9'}：同位保持+深入（全 9 尾自然终止于 '5' 追加）
}

/**
 * 等值邻居计数（needs-layer-repair 判据——Z4''-v14：重复可容忍，病理计数归 T18 CLI）。
 * 输入=层内键集合（无序）；输出=数值等值相邻对数（去重后计数）。非法键行不参与（读侧全函数）。
 */
export function equalValueNeighbors(keys: readonly string[]): number {
  const valid = keys.filter((k) => isValidOrderKey(k));
  const sorted = [...valid].sort((a, b) => compareOrderKeys(a, b));
  let pairs = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (compareOrderKeys(sorted[i - 1], sorted[i]) === 0) pairs++;
  }
  return pairs;
}

/** 重复键存在性（(order,id) tie-break 兜底容忍的判定面）。 */
export function hasDuplicateOrderKeys(keys: readonly string[]): boolean {
  return equalValueNeighbors(keys) > 0;
}
