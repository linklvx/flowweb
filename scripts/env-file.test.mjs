// scripts/env-file.test.mjs —— dotenv 对拍（评四 P1-1：解析差异比失效更贵，误诊"TOKEN 未设置"的根因防线）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readEnvFile } from './lib/env-file.mjs';

const here = fileURLToPath(import.meta.url);
const hereDir = dirname(here);   // join(here, …) 会把文件当目录段——../ 从 scripts/ 起算须以所在目录为基
const dotenv = createRequire(join(hereDir, '../apps/api/package.json'))('dotenv');

const KEYS = ['A_PLAIN', 'B_DQ', 'B2_DQ_CMT', 'C_SQ', 'D_DUP', 'E_EXPORT', 'F_HASH', 'G_NOHASHSPACE', 'H_DQ_HASH', 'I_SQ_HASH', 'PRIVATE_KEY', 'UNCLOSED'];

function parseBoth(text) {
  const dir = mkdtempSync(join(tmpdir(), 'envfile-'));
  const f = join(dir, '.env');
  writeFileSync(f, text);
  try { return { ours: readEnvFile(f, KEYS), dotenv: dotenv.parse(text) }; } finally { rmSync(dir, { recursive: true, force: true }); }
}

// 九形态（B27 实测语义）——对拍基准值来自 dotenv parse 实测输出：
// F_HASH→'before'、G_NOHASHSPACE→'a'、H_DQ_HASH→'a #b'、I_SQ_HASH→'x # y'、D_DUP→'second'
test('dotenv 对拍九形态：plain/dq/引号+注释/sq/重复键后者胜/export/行内注释三形态', () => {
  const text = [
    'A_PLAIN=novalue',
    'B_DQ="quoted value"',
    'B2_DQ_CMT="q" # trailing',
    "C_SQ='sq value'",
    'D_DUP=first',
    'D_DUP=second',
    'export E_EXPORT=yes',
    'F_HASH=before # not-a-comment-for-dotenv',   // 引号外注释（有空格）截断
    'G_NOHASHSPACE=a#b',                          // 无空格 # 也截（dotenv [^#\r\n]+ 语义）
    'H_DQ_HASH="a #b"',                           // 引号内 # 保留
    "I_SQ_HASH='x # y'",                          // 单引号内 # 保留
  ].join('\n');
  const { ours, dotenv: dp } = parseBoth(text);
  for (const k of KEYS) {
    if (k === 'PRIVATE_KEY') continue;
    assert.equal(ours[k], dp[k], `${k}: ours=${JSON.stringify(ours[k])} dotenv=${JSON.stringify(dp[k])}`);
  }
  // 锚死三组关键值（对拍对象本身坏掉时仍有独立红相）
  assert.equal(ours.F_HASH, 'before');
  assert.equal(ours.G_NOHASHSPACE, 'a');
  assert.equal(ours.H_DQ_HASH, 'a #b');
});
test('多行 PEM（keys 含 PRIVATE_KEY）——单行契约差异形态记录（dotenv 17.4.2 实测）+不误吞下一行', () => {
  const { ours, dotenv: dp } = parseBoth('PRIVATE_KEY="-----BEGIN-----\nMIIB\n-----END-----"');
  // dotenv 17.4.2 实测：引号分支 [^"] 可跨行——闭引号在前→取整块；未闭合才回落首行原样（含引号字符）。
  // 我们=单行契约（只认单行 KEY=VALUE）：首行无闭引号→去引号取首行截断。消费者键（COLLAB_ADMIN_TOKEN 等单行令牌）不受此差异影响；
  // 若未来需读 PEM 类多行键，先扩展实现再消费（真实 .env 对拍测试为实际内容守门）。
  assert.equal(dp.PRIVATE_KEY, '-----BEGIN-----\nMIIB\n-----END-----');
  assert.equal(ours.PRIVATE_KEY, '-----BEGIN-----');
  assert.equal(ours.MIIB, undefined);               // 不误吞下一行（中间行非 KEY=VALUE）
  assert.deepEqual(Object.keys(ours).filter((k) => ours[k] !== undefined && k !== 'PRIVATE_KEY'), []);
  // 未闭合引号（差异有意记录）：dotenv 回落未引号分支 [^#\r\n]+ → 保留引号字符原样；ours end<0 分支 → t.slice(1) 去开引号
  const { ours: u2, dotenv: d2 } = parseBoth('UNCLOSED="abc');
  assert.equal(d2.UNCLOSED, '"abc');
  assert.equal(u2.UNCLOSED, 'abc');
});
test('真实 apps/api/.env 对拍（存在即逐键相等——本地开发机必有，CI 无则跳过）', () => {
  const p = join(hereDir, '../apps/api/.env');
  if (!existsSync(p)) return;
  const parsed = dotenv.parse(readFileSync(p, 'utf8'));
  const keys = Object.keys(parsed);
  const ours = readEnvFile(p, keys);
  for (const k of keys) assert.equal(ours[k], parsed[k], k);
});
