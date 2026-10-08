// scripts/deploy-preflight-int.mjs —— preflight int 单源链（P32）：读 apps/api/.env 的 DATABASE_URL（去引号）
// → 注入子进程 env 跑 int 套件（产 int.json）→ check-int-coverage 四判据（集合≡执行集/零失败/零跳过/≥26）
// P41：子进程禁 spawnSync('pnpm')（Windows ENOENT——pnpm=.ps1/.cmd Node 不解析）——
// 直跑 vitest JS 入口：createRequire(apps/api/package.json).resolve('vitest/vitest.mjs')（resolve 比 hardcode 稳），
// 参数等价 test:int:ci（package.json 的 -c vitest.int.config.ts+双 reporter+outputFile）。
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readEnvFile } from './lib/env-file.mjs';

const here = fileURLToPath(import.meta.url);
const ROOT = resolve(here, '../..');
const API_DIR = resolve(ROOT, 'apps/api');

// 已设 process.env 优先（B12 不覆盖语义——调用方展开 {...readEnvFile(...), ...process.env}）
const { DATABASE_URL } = { ...readEnvFile(resolve(API_DIR, '.env'), ['DATABASE_URL']), ...process.env };
if (!DATABASE_URL) { console.error('preflight-int FAIL: apps/api/.env 无 DATABASE_URL'); process.exit(1); }

const req = createRequire(resolve(API_DIR, 'package.json'));
let vitestEntry;
try { vitestEntry = req.resolve('vitest/vitest.mjs'); }
catch { console.error('preflight-int FAIL: 解析 vitest 入口失败（apps/api 未 install？先 pnpm install）'); process.exit(1); }

const r = spawnSync(process.execPath, [vitestEntry, 'run', '-c', 'vitest.int.config.ts',
  '--reporter=default', '--reporter=json', '--outputFile=int.json'],
  { stdio: 'inherit', env: { ...process.env, DATABASE_URL }, cwd: API_DIR });
// J6：spawn 失败（ENOENT/EPERM）不抛异常而返回 {status:null,error}——三分法退出码：2=环境错误（防裸 exit 1 诱使 --skip-preflight 绕过唯一强制链）
if (r.error) { console.error(`preflight-int 环境错误（exit 2）：无法启动 vitest——${r.error.message}（先 pnpm install？）`); process.exit(2); }
if (r.status !== 0) { console.error(`preflight-int FAIL: int 套件退出 ${r.status}`); process.exit(r.status ?? 1); }

// check-int-coverage 必须在仓根运行（apps/api/int.json 相对路径+git ls-files 按根 CWD）
const c = spawnSync(process.execPath, [resolve(ROOT, 'scripts/check-int-coverage.mjs')], { stdio: 'inherit', cwd: ROOT });
process.exit(c.status ?? 1);
