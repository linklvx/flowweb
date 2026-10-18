// C0a spike：装载期 rebalance 基准（2k/5k/10k）——先算后写/耗时/字节/docTruth 重测 + 中途 throw partial 实验
// 对应 Z4''-v6：Yjs transact 无回滚（yjs.cjs:3438-3463）——「异常→保留长键」不成立，须先算后写
import { createRequire } from 'module';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const Y = require('yjs');

const D31 = '123456789ABCDEFGHIJKLMNOPQRSTUV'; // 双射 base31——天然无 '0'（尾 0 不变量免检）
function b31(i) { let n = i + 1, s = ''; while (n > 0) { n--; s = D31[n % 31] + s; n = Math.floor(n / 31); } return s; }

/** 构造 N 节点 doc：全 root 层，placement.order 为 >32 长键（模拟需重排态） */
function buildDoc(n) {
  const t0 = performance.now();
  const doc = new Y.Doc();
  const nodes = doc.getMap('nodes');
  doc.transact(() => {
    for (let i = 0; i < n; i++) {
      const longKey = 'K' + i.toString(32).toUpperCase().padStart(40, '0'); // 41 字符长键
      nodes.set(`n${i}`, new Y.Map([
        ['type', 'image'],
        ['placement', { parentId: null, order: longKey }],
        ['position', { x: i, y: i }],
        ['data', new Y.Map([['fileId', `m${i}`]])],
      ]));
    }
  }, 'seed');
  return { doc, tBuildMs: performance.now() - t0 };
}

/** rebalance：先算（纯函数可中止）后写（apply 段只 set 预校验值） */
function rebalance(doc) {
  const nodes = doc.getMap('nodes');
  // ── 计算段（不写 doc——异常/超预算在此中止=零写入）──
  const tC0 = performance.now();
  const entries = [];
  for (const [id, m] of nodes.entries()) {
    if (!(m instanceof Y.Map)) return { aborted: 'no-node-map' };
    const p = m.get('placement');
    if (p == null || typeof p.order !== 'string') continue; // 缺 placement=非本层职责（计数口径）
    if (p.order.length <= 32) continue; // 仅重排键长>32 层
    entries.push({ id, oldOrder: p.order, newOrder: b31(entries.length) });
  }
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.newOrder)) throw new Error('newOrder 重复——计算段 bug');
    seen.add(e.newOrder);
    if (!/^[0-9A-V]{1,128}$/.test(e.newOrder) || e.newOrder.endsWith('0')) throw new Error('newOrder 非法');
  }
  const tCompute = performance.now() - tC0;
  // ── apply 段（只 set 预校验值——不再抛）──
  const tA0 = performance.now();
  let applied = 0;
  doc.transact(() => {
    for (const e of entries) {
      const m = nodes.get(e.id);
      m.set('placement', { parentId: null, order: e.newOrder });
      applied++;
    }
  }, 'maintenance');
  const tApply = performance.now() - tA0;
  return { entries: entries.length, tComputeMs: tCompute, tApplyMs: tApply, applied };
}

console.log('── rebalance 基准（先算后写；全 root 层、初始键长 41）──');
console.log('N\tbuildMs\tcomputeMs\tapplyMs\tbytesBefore\tbytesAfter\tshrink%\tdocTruthMs(重测)');
for (const n of [2000, 5000, 10000]) {
  const { doc, tBuildMs } = buildDoc(n);
  const bytesBefore = Y.encodeStateAsUpdate(doc).byteLength;
  const r = rebalance(doc);
  const tT0 = performance.now();
  const bytesAfter = Y.encodeStateAsUpdate(doc).byteLength; // docTruth 重测=同一次 encode
  const docTruthMs = performance.now() - tT0;
  console.log(`${n}\t${tBuildMs.toFixed(0)}\t${r.tComputeMs.toFixed(1)}\t\t${r.tApplyMs.toFixed(1)}\t${bytesBefore}\t\t${bytesAfter}\t${(100 * (1 - bytesAfter / bytesBefore)).toFixed(1)}\t${docTruthMs.toFixed(1)}`);
}

console.log('\n── 中途 throw partial 实验（证明 transact 无回滚——apply 段抛错留半重排）──');
{
  const { doc } = buildDoc(1000);
  const nodes = doc.getMap('nodes');
  let threw = false;
  try {
    doc.transact(() => {
      let i = 0;
      for (const [id, m] of nodes.entries()) {
        if (i === 500) throw new Error('simulated mid-apply failure');
        m.set('placement', { parentId: null, order: b31(i) });
        i++;
      }
    }, 'maintenance');
  } catch (e) { threw = true; }
  let newKeys = 0, oldKeys = 0;
  for (const [, m] of doc.getMap('nodes').entries()) {
    const o = m.get('placement').order;
    if (o.length <= 32) newKeys++; else oldKeys++;
  }
  console.log(`throw 上抛=${threw}；apply 后：新短键 ${newKeys} 个 / 旧长键 ${oldKeys} 个（半重排态实存——计算段中止才零写入）`);
  // 再验证 cleanup 照常执行（update 已广播/入队语义）：observer 在 finally 后触发
  let updateFired = false;
  doc.on('update', () => { updateFired = true; });
  try {
    doc.transact(() => {
      doc.getMap('nodes').get('n0').set('placement', { parentId: null, order: b31(9999) });
      throw new Error('again');
    }, 'maintenance');
  } catch { /* swallow */ }
  console.log(`throw 事务的 update 事件仍触发=${updateFired}（cleanup 照常——半重排会广播/持久化）`);
}
