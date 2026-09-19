#!/usr/bin/env node
// C8 对比度台账（spec §6-③）：输入 e2e/audit/contrast-pairs.json 配对表 → 输出 markdown 表；
// 内建 4 条自检向量（21.00 / 4.54 / 4.48 / 2.82），任一偏差 > tolerance 即 exit 1——历轮人工复算同格分歧以此终结。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'e2e', 'audit', 'contrast-pairs.json'), 'utf8'));

function channel(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
function luminance(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrast(fg, bg) {
  const l1 = luminance(fg), l2 = luminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const tol = data.meta.tolerance;
let fail = 0;
const fmt = (v) => v.toFixed(2);
const rows = [];
for (const c of data.meta.selfCheck) {
  const got = contrast(c.fg, c.bg);
  const ok = Math.abs(got - c.expect) <= tol;
  if (!ok) fail++;
  rows.push(`| 自检 | ${c.fg} | ${c.bg} | ${fmt(got)} | ${fmt(c.expect)} | ${ok ? '✅' : '❌'} | ${c.why} |`);
}
for (const p of data.pairs) {
  const got = contrast(p.fg, p.bg);
  const drift = p.specExpect != null && Math.abs(got - p.specExpect) > tol;
  if (drift) fail++; // drift 有牙齿：在册值机器核对，drift>0 即 exit 1（订正 spec 后复跑转绿）
  rows.push(`| ${p.id} | ${p.fg} | ${p.bg} | ${fmt(got)} | ${p.specExpect != null ? fmt(p.specExpect) : '—'} | ${drift ? '⚠︎drift' : '—'} | spec ${p.spec} |`);
}
const md = ['# C8 对比度台账（contrast-table.mjs 产出）', '', '| 配对 | 前景 | 底 | 实测 | spec 在册 | drift | 出处 |', '|---|---|---|---|---|---|---|', ...rows, ''].join('\n');
fs.writeFileSync(path.join(ROOT, 'e2e', 'audit', 'contrast-table.md'), md);
console.log(md);
process.exit(fail ? 1 : 0);
