// C0a spike：分数索引 base32 中点实现 + property 验证 + 头插/同锚/随机增长曲线
// 依据 spec v6 §2.2：typed result/严格递增字母表/不得以最小字符结尾/头尾虚拟边界/等值键定死
import { createRequire } from 'module';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUV'; // 32 位严格递增（'9'→'A' 差 8——ASCII 序与数值序一致）
const N = 32;
const D = (i) => DIGITS[i];
const I = (c) => DIGITS.indexOf(c);

// 闭区间开边界中点：lo/hi 为数字索引或 null（开放）；返回 (lo,hi) 开区间内中位索引或 null
function midBetween(lo, hi) {
  const l = lo == null ? -1 : lo;
  const h = hi == null ? N : hi;
  if (h - l < 2) return null;
  return l + 1 + Math.floor((h - l - 1) / 2);
}

/** generateKeyBetween(a,b)：a/b 为 string|null（null=头/尾虚拟边界）；typed result */
export function generateKeyBetween(a, b, bias) {
  if (a != null && b != null) {
    if (a === b) return { ok: false, reason: 'equal-key' };
    if (a > b) return { ok: false, reason: 'a-gt-b' };
  }
  if (a == null && b == null) return { ok: true, key: D(16) }; // 首键中位前缀 'G'
  if (a == null) return genHead(b, bias);
  if (b == null) return genTail(a);
  return genMid(a, b);
}

function genTail(a) { // a=当前最大键
  const last = I(a[a.length - 1]);
  if (last < N - 1) return { ok: true, key: a.slice(0, -1) + D(last + 1) };
  return { ok: true, key: a + D(16) }; // 末位 V：追加中位
}

function genHead(b, bias) { // b=当前最小键；bias='mid'|'decrement'（降档变体——头插对数化实验）
  const b0 = I(b[0]);
  if (b0 >= 2) {
    const m = bias === 'decrement' ? b0 - 1 : midBetween(null, b0); // m>=1（b0>=2 ⇒ m>=1）——不触尾 0
    return { ok: true, key: D(m) };
  }
  if (b0 === 1) return { ok: true, key: '0' + D(16) }; // 单字符只剩 '0'（禁）——降级 '0G'
  // b 首位 '0'：递归尾部（b 不可能为 '0' 本身——尾 0 不变量）
  if (b.length === 1) return { ok: false, reason: 'head-exhausted' };
  const inner = genHead(b.slice(1), bias);
  if (!inner.ok) return inner;
  return { ok: true, key: '0' + inner.key };
}

function genMid(a, b) { // a<b 均存在
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length) { // a 是 b 前缀：key = a+X，X<b[i] 且 X≠0
    const bi = I(b[i]);
    const m = midBetween(null, bi);
    if (m != null && m >= 1) return { ok: true, key: a + D(m) };
    if (m === 0) return { ok: true, key: a + '0' + D(16) }; // b[i]='1'
    // b[i]='0'：递归（b 不会以 '0' 结尾——若 b.slice(i) 全 0 则 b 非法）
    const rest = b.slice(i + 1);
    if (rest === '') return { ok: false, reason: 'prefix-exhausted' };
    const inner = genHead(rest);
    if (!inner.ok) return inner;
    return { ok: true, key: a + '0' + inner.key };
  }
  // 首异位 i：ai<bi（a<b 保证）
  const ai = I(a[i]);
  const bi = I(b[i]);
  const m = midBetween(ai, bi);
  if (m != null) return { ok: true, key: a.slice(0, i) + D(m) };
  // 邻接：a+'G'（首异位 a[i]<b[i] ⇒ 任意 a 前缀扩展 < b）
  return { ok: true, key: a + D(16) };
}

// ── property 验证 ──
function propertyTest() {
  const keys = [];
  const seen = new Set();
  const check = (k, lo, hi) => {
    if (typeof k !== 'string' || k.length === 0) throw new Error(`非字符串/空键: ${k}`);
    if (I(k[k.length - 1]) === 0) throw new Error(`尾 0 违反: ${k}`);
    for (const c of k) if (I(c) < 0) throw new Error(`表外字符: ${k}`);
    if (seen.has(k)) throw new Error(`重复键: ${k}`);
    seen.add(k);
    if (lo != null && !(k > lo)) throw new Error(`不大于左邻: ${k} vs ${lo}`);
    if (hi != null && !(k < hi)) throw new Error(`不小于右邻: ${k} vs ${hi}`);
    if (lo != null && hi != null && !(lo < hi)) throw new Error(`邻居序错误: ${lo} >= ${hi}`);
    return k;
  };
  const insertAt = (pos) => {
    const lo = pos > 0 ? keys[pos - 1] : null;
    const hi = pos < keys.length ? keys[pos] : null;
    const r = generateKeyBetween(lo, hi);
    if (!r.ok) throw new Error(`生成失败 pos=${pos}: ${r.reason}`);
    keys.splice(pos, 0, check(r.key, lo, hi));
  };
  insertAt(0);
  let seed = 42;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let i = 0; i < 3000; i++) {
    // 混合头/尾/中随机插
    const mode = i % 10;
    if (mode === 0) insertAt(0);
    else if (mode === 1) insertAt(keys.length);
    else insertAt(1 + rand(Math.max(1, keys.length - 1)));
  }
  return keys.length;
}

// ── 增长曲线 ──
function runScenario(name, count, posFn, bias) {
  const keys = [];
  const r0 = generateKeyBetween(null, null, bias);
  keys.push(r0.key);
  const t0 = performance.now();
  let maxLen = r0.key.length, sumLen = r0.key.length;
  for (let i = 1; i < count; i++) {
    const pos = posFn(keys);
    const lo = pos > 0 ? keys[pos - 1] : null;
    const hi = pos < keys.length ? keys[pos] : null;
    const r = generateKeyBetween(lo, hi, bias);
    if (!r.ok) return { name, count: i, failed: r.reason };
    keys.splice(pos, 0, r.key);
    maxLen = Math.max(maxLen, r.key.length);
    sumLen += r.key.length;
  }
  const dt = performance.now() - t0;
  return {
    name, count,
    maxLen, avgLen: +(sumLen / keys.length).toFixed(1),
    perOpUs: +((dt * 1000) / count).toFixed(2),
    first: keys[0], last: keys[keys.length - 1],
    sampleLen9: keys[9]?.length, sampleLen99: keys[99]?.length,
  };
}

console.log('── property 验证 ──');
try {
  const n = propertyTest();
  console.log(`PASS：${n} 键随机插入全不变量成立（序/唯一/尾0/表内字符）`);
} catch (e) {
  console.log('FAIL：', e.message);
  process.exitCode = 1;
}

console.log('\n── 增长曲线（1000 次/场景）──');
const rows = [
  runScenario('头插（pos 恒 0）', 1000, () => 0),
  runScenario('同锚插入（pos 恒 1——「同样两个邻居之间」）', 1000, (k) => 1),
  runScenario('尾插（pos 恒 end）', 1000, (k) => k.length),
  runScenario('随机插入', 1000, (k) => Math.floor(Math.random() * (k.length + 1))),
  runScenario('同锚 2000 次（超 hard 128 探界）', 2000, () => 1),
  runScenario('头插·降档变体（b0-1 非中点）', 1000, () => 0, 'decrement'),
  runScenario('头插·降档变体 5000 次', 5000, () => 0, 'decrement'),
];
for (const r of rows) console.log(JSON.stringify(r));

// 耗尽探界：同锚连续插入直到失败或 3000 次
{
  const keys = [generateKeyBetween(null, null).key];
  let i = 0, failAt = null;
  const t0 = performance.now();
  while (i < 3000) {
    const r = generateKeyBetween(keys[0], keys[1]);
    if (!r.ok) { failAt = i; break; }
    keys.splice(1, 0, r.key);
    i++;
  }
  console.log(`\n── 耗尽探界：同锚左界固定，连续插入 ${i} 次${failAt != null ? `后失败(${failAt})` : '未失败'}；最长键 ${Math.max(...keys.map(k => k.length))}；总耗时 ${((performance.now() - t0) / 1000).toFixed(2)}s`);
  // 等值键定死
  console.log('── between(a,a) 定死 ──');
  console.log(JSON.stringify(generateKeyBetween('K', 'K')));
  console.log(JSON.stringify(generateKeyBetween('L', 'K')));
}
