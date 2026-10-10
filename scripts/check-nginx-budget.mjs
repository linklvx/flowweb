#!/usr/bin/env node
// Y0b-2 T8（Z117④）：nginx /api 墙钟 ↔ EXEC_SYNC_HARD_CAP 算术关系锚——进根 verify 链。
// 读 deploy/nginx/api-location.replace.conf 文本解析 proxy_read_timeout（秒），断言
// ≥ EXEC_DEFAULTS.SYNC_HARD_CAP + 60_000（ms）——常量单源=apps/api/src/config/env.ts 文本提取
// （mjs 无法 import TS，env.ts 为源：改 EXEC_DEFAULTS.SYNC_HARD_CAP 而不改 conf 即红——同步义务钉死）。
// DB-free 纯静态。退出码：0=PASS；1=预算违规；2=结构性错误（conf/env.ts 形态不可解析——doc-gate 先例）。
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONF = path.join(ROOT, 'deploy/nginx/api-location.replace.conf');
const ENV_TS = path.join(ROOT, 'apps/api/src/config/env.ts');

const structural = (m) => { console.error(`check-nginx-budget: 结构性错误（exit 2）——${m}`); process.exit(2); };

const conf = readFileSync(CONF, 'utf8');
const envSrc = readFileSync(ENV_TS, 'utf8');

// EXEC_DEFAULTS.SYNC_HARD_CAP 字面量提取（`SYNC_HARD_CAP: 1_800_000,` 形态——数字分隔符容忍）
const capMatch = envSrc.match(/SYNC_HARD_CAP:\s*(\d[\d_]*)\s*,/);
if (!capMatch) structural('env.ts 未找到 EXEC_DEFAULTS.SYNC_HARD_CAP 字面量');
const hardCapMs = Number(capMatch[1].replace(/_/g, ''));

// conf 内 proxy_read_timeout 数值（秒）——location /api 块内
const timeoutMatch = conf.match(/proxy_(?:read|send)_timeout\s+(\d+)s\s*;/g) ?? [];
if (timeoutMatch.length < 2) structural('api-location.replace.conf 未同时解析到 proxy_read_timeout+proxy_send_timeout');
const readSec = Number(conf.match(/proxy_read_timeout\s+(\d+)s/)?.[1]);
const sendSec = Number(conf.match(/proxy_send_timeout\s+(\d+)s/)?.[1]);
if (!Number.isFinite(readSec) || !Number.isFinite(sendSec)) structural('timeout 数值不可解析');

const problems = [];
// 60s 核销/响应余量（conf 头注的算术关系——两值同批同锚）
if (readSec * 1000 < hardCapMs + 60_000)
  problems.push(`proxy_read_timeout ${readSec}s < EXEC_SYNC_HARD_CAP(${hardCapMs}ms)+60s——合法批（Σdeadline=HARD_CAP）必被 nginx 504 剪断`);
if (sendSec !== readSec)
  problems.push(`proxy_send_timeout ${sendSec}s ≠ proxy_read_timeout ${readSec}s（两旋钮同批同值——runbook 联动行）`);

if (problems.length) { console.error('nginx 预算锚异常：\n' + problems.join('\n')); process.exit(1); }
console.log(`nginx 预算锚 ✓ proxy_read/send_timeout=${readSec}s ≥ EXEC_SYNC_HARD_CAP(${hardCapMs}ms)+60s`);
