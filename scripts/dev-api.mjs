#!/usr/bin/env node
// Y0c T26（F5 裁定/spec §0.6 偏离 33）：本地 dev 默认 COLLAB_ROLE=all 注入通道。
// 为什么是 spawn 形态而非 inline 前缀（`COLLAB_ROLE=all nest start --watch`）：npm/pnpm 在 Windows
// 默认 script-shell=cmd.exe——无 `VAR=x` 前缀语法，inline 形态跨平台不可用；gate-collab.mjs API_ENV
// 同款 spawn 注入先例。为什么不放 .env：COLLAB_ROLE 是分叉键（Z89/㉑ 方向 A——进 .env 即打死
// census），.env.example 的活行也会诱导全量复制踩红——故 example 注释化+本通道承担 dev 默认 all。
// 透传退出码+SIGINT/SIGTERM 转发（Ctrl+C 终止 watch 子进程）。
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 显式解析本地 bin（node 直驱 @nestjs/cli 入口）：不依赖 PATH 上的 node_modules/.bin——
// npm/pnpm script 上下文才有该注入，任何裸 node 调用形态（如工具链/调试器）下同样可用
const NEST_CLI = path.join(ROOT, 'apps/api/node_modules/@nestjs/cli/bin/nest.js');

const child = spawn(process.execPath, [NEST_CLI, 'start', '--watch'], {
  stdio: 'inherit',
  cwd: path.join(ROOT, 'apps/api'),   // nest start 的项目根（nest-cli.json 所在）
  env: { ...process.env, COLLAB_ROLE: 'all' },
});
const forward = (signal) => () => { try { child.kill(signal); } catch { /* 已退出 */ } };
process.on('SIGINT', forward('SIGINT'));
process.on('SIGTERM', forward('SIGTERM'));
child.on('exit', (code) => process.exit(code ?? 0));
