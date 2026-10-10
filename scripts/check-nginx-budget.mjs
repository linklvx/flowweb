#!/usr/bin/env node
// Y0b-2 T8（Z117④）：nginx /api 墙钟 ↔ EXEC_SYNC_HARD_CAP 算术关系锚——进根 verify 链。
// 读 deploy/nginx/api-location.replace.conf 文本解析 proxy_read_timeout（秒），断言
// ≥ EXEC_DEFAULTS.SYNC_HARD_CAP + 60_000（ms）——常量单源=apps/api/src/config/env.ts 文本提取
// （mjs 无法 import TS，env.ts 为源：改 EXEC_DEFAULTS.SYNC_HARD_CAP 而不改 conf 即红——同步义务钉死）。
// Y0b-3 T5（M-10）：扩模板文本断言——collab snippet access_log off + index-html snippet no-store
// （运行态断言=deploy.sh verify_nginx 服务器侧 nginx -T；本地无 nginx，模板文本断言在此）。
// DB-free 纯静态。退出码：0=PASS；1=预算违规；2=结构性错误（conf/env.ts 形态不可解析——doc-gate 先例）。
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONF = path.join(ROOT, 'deploy/nginx/api-location.replace.conf');
const COLLAB_CONF = path.join(ROOT, 'deploy/nginx/collab-location.replace.conf');
const INDEX_CONF = path.join(ROOT, 'deploy/nginx/index-html.replace.conf');
const ENV_TS = path.join(ROOT, 'apps/api/src/config/env.ts');

const structural = (m) => { console.error(`check-nginx-budget: 结构性错误（exit 2）——${m}`); process.exit(2); };

const conf = readFileSync(CONF, 'utf8');
const envSrc = readFileSync(ENV_TS, 'utf8');

// EXEC_DEFAULTS.SYNC_HARD_CAP 字面量提取（`SYNC_HARD_CAP: 1_800_000,` 形态——数字分隔符容忍）
const capMatch = envSrc.match(/SYNC_HARD_CAP:\s*(\d[\d_]*)\s*,/);
if (!capMatch) structural('env.ts 未找到 EXEC_DEFAULTS.SYNC_HARD_CAP 字面量');
const hardCapMs = Number(capMatch[1].replace(/_/g, ''));

// conf 内 proxy_read_timeout 数值（秒）——**非注释行**锚定（行首空白后指令名——T8 审查 M-4：
// 无锚全文匹配会把头注/尾注里的同名字样误读为指令值，方向可误红也可误绿）
const directiveLines = conf.split(/\r?\n/).filter((l) => /^\s*proxy_(?:read|send)_timeout\s+\d+s\s*;/.test(l));
if (directiveLines.length < 2) structural('api-location.replace.conf 未同时解析到非注释行 proxy_read_timeout+proxy_send_timeout');
const readSec = Number(directiveLines.find((l) => l.includes('proxy_read_timeout'))?.match(/proxy_read_timeout\s+(\d+)s/)?.[1]);
const sendSec = Number(directiveLines.find((l) => l.includes('proxy_send_timeout'))?.match(/proxy_send_timeout\s+(\d+)s/)?.[1]);
if (!Number.isFinite(readSec) || !Number.isFinite(sendSec)) structural('timeout 数值不可解析');

const problems = [];
// 60s 核销/响应余量（conf 头注的算术关系——两值同批同锚）
if (readSec * 1000 < hardCapMs + 60_000)
  problems.push(`proxy_read_timeout ${readSec}s < EXEC_SYNC_HARD_CAP(${hardCapMs}ms)+60s——合法批（Σdeadline=HARD_CAP）必被 nginx 504 剪断`);
if (sendSec !== readSec)
  problems.push(`proxy_send_timeout ${sendSec}s ≠ proxy_read_timeout ${readSec}s（两旋钮同批同值——runbook 联动行）`);

// Y0b-3 T5（M-10）：版本门通道模板断言——非注释行锚定（T8 审查 M-4 同款：头注同名字样不算数）
const directive = (file, re) => file.split(/\r?\n/).filter((l) => !l.trim().startsWith('#')).some((l) => re.test(l));
if (!existsSync(COLLAB_CONF)) structural('deploy/nginx/collab-location.replace.conf 缺失');
if (!existsSync(INDEX_CONF)) structural('deploy/nginx/index-html.replace.conf 缺失（Y0b-3 T5 index.html no-store 指令清单）');
const collabConf = readFileSync(COLLAB_CONF, 'utf8');
const indexConf = readFileSync(INDEX_CONF, 'utf8');
if (!directive(collabConf, /^\s*access_log\s+off\s*;/))
  problems.push('collab-location.replace.conf 非注释行缺 access_log off;——WS query（csv/cb）会落 access log');
if (!directive(indexConf, /^\s*add_header\s+Cache-Control\s+"no-store"[^;]*;/))
  problems.push('index-html.replace.conf 非注释行缺 add_header Cache-Control "no-store"——旧 bundle 缓存钉死=版本拒绝循环');
if (!directive(indexConf, /^\s*location\s*=\s*\/index\.html\s*\{/))
  problems.push('index-html.replace.conf 非注释行缺 location = /index.html block——no-store 指令无处附着');

if (problems.length) { console.error('nginx 预算锚异常：\n' + problems.join('\n')); process.exit(1); }
console.log(`nginx 预算锚 ✓ proxy_read/send_timeout=${readSec}s ≥ EXEC_SYNC_HARD_CAP(${hardCapMs}ms)+60s；版本门模板锚 ✓ collab access_log off + index.html no-store`);
