// scripts/check-ecosystem.mjs —— Y0a-4：ecosystem 结构锚（冻结契约 9）+deploy.sh 调用图/上传面/零服务器构建探测
// 用法：node scripts/check-ecosystem.mjs [ecosystem-path]（默认 <ROOT>/ecosystem.config.cjs）
// 自测载体=scripts/check-ecosystem.test.mjs（node:test，唯一入口——防双源）；本文件 import 零副作用（isMain 守卫）
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(import.meta.url);
const ROOT = resolve(here, '../..');

const toBytes = (v) => {
  if (typeof v === 'number') return v;
  const m = /^(\d+)([KMGT]?)$/.exec(String(v));
  return m ? Number(m[1]) * ({ '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 })[m[2]] : NaN;
};

/** P43：bash 函数体提取——大括号配平+注释剥离；提取失败返回 ''（调用方即 fail——"提取不到就算过"是空转源）。
 * 注释剥离="整行注释+空白前行尾注释"（全局 /#.*$/ 会把 ${#var} 截成 ${ =配平失衡；引号内 #（前非空白）不截——
 * 误截后果=提取失败 fail-closed 非静默过，本仓 deploy.sh 无引号内 # 形态）。
 * I-1：引号内孤立 `}` 可致提前截断=export 扫描面收窄——禁在 cutover/rollback 体内引号内裸大括号；
 * 提前截断时末行是含 `}` 的命令行而非独立 `}`——末行守卫返回 ''（fail-closed；单行体开闭同行除外）。
 * M-1：fn 必须为字面函数名（未转义直接进 RegExp——调用方禁传正则元字符）。 */
export function extractBashFunction(src, fn) {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^${fn}\\(\\)\\s*\\{`).test(l));
  if (start < 0) return '';
  let depth = 0;
  const body = [];
  for (let i = start; i < lines.length; i++) {
    body.push(lines[i]);
    const code = lines[i].replace(/(^\s*#.*$)|(\s#.*$)/, '');   // 整行注释或"# 前有空白"的行尾注释
    for (const ch of code) { if (ch === '{') depth++; else if (ch === '}') depth--; }
    if (depth === 0) {
      if (body.length === 1) return body.join('\n');   // 单行体：开闭同行=真闭合
      const lastLine = body[body.length - 1];
      return /^\s*\}\s*$/.test(lastLine) ? body.join('\n') : '';   // 提前截断（末行非独立 `}`）=fail-closed
    }
  }
  return '';   // 未闭合
}

export function checkEcosystem(app, deploySrc) {
  const errs = [];
  const fail = (m) => errs.push(m);
  app.name === 'flowweb-api' || fail(`name=${app.name}`);
  app.exec_mode === 'fork' || fail(`exec_mode=${app.exec_mode}（E35 禁 cluster）`);
  app.instances === 1 || fail(`instances=${app.instances}`);
  Number.isInteger(app.kill_timeout) && app.kill_timeout >= 45000 || fail(`kill_timeout=${app.kill_timeout}（E43⑤ ≥45000）`);
  app.kill_signal === 'SIGTERM' || fail(`kill_signal=${app.kill_signal}`);
  const heap = Number(/--max-old-space-size=(\d+)/.exec(app.node_args ?? '')?.[1]);
  const rss = toBytes(app.max_memory_restart);
  // fail-closed：不可解析即红，禁静默跳过断言（'1g'/'1GB'/'1.5G' 等 pm2 接受但令门禁失效的形态）
  Number.isFinite(heap) || fail(`node_args 缺 --max-old-space-size 或值不可解析: ${app.node_args}`);
  Number.isFinite(rss) || fail(`max_memory_restart 不可解析: ${app.max_memory_restart}（支持 1024/1K/1M/1G 整数形态）`);
  if (Number.isFinite(heap) && Number.isFinite(rss)) {
    rss >= heap * 1024 * 1024 + 384 * 1024 * 1024 || fail(`RSS 口径：max_memory_restart(${app.max_memory_restart}) 必须 ≥ old-space(${heap}M)+384M（Yjs 外部内存余量）`);
    rss <= 1900 * 1024 * 1024 || fail(`max_memory_restart(${app.max_memory_restart}) 超 1.9GB 物理粗线`);
  }
  isAbsolute(app.env?.COLLAB_SPOOL_DIR ?? '') || fail('COLLAB_SPOOL_DIR 必须绝对路径');
  app.env?.COLLAB_BIND_ADDR === '127.0.0.1' || fail('COLLAB_BIND_ADDR 必须 127.0.0.1（P25）');
  // NODE_ENV 禁令（Y0.5/E58 落地才解禁）+B25：GIT_COMMIT_HASH 移出白名单（它来自 shell 注入非 env{}）
  const ENV_ALLOWLIST = new Set(['COLLAB_SPOOL_DIR', 'COLLAB_BIND_ADDR']);
  for (const k of Object.keys(app.env ?? {})) ENV_ALLOWLIST.has(k) || fail(`env 键 ${k} 不在白名单（禁密钥进 ecosystem——env 走服务器 .env）`);
  typeof app.script === 'string' || fail(`script 形态：${app.script}（必须字符串）`);
  typeof app.cwd === 'string' && isAbsolute(app.cwd) || fail(`cwd 形态：${app.cwd}（必须绝对路径）`);
  /pm2 [^#]*--kill-timeout/.test(deploySrc) && fail('deploy.sh 残留 pm2 --kill-timeout 内联（契约 9：ecosystem 唯一源）');
  // P43 调用图断言（提取失败本身即 fail）
  const cutover = extractBashFunction(deploySrc, 'cutover_api');
  const dApi = extractBashFunction(deploySrc, 'deploy_api');
  const dFull = extractBashFunction(deploySrc, 'deploy_full');
  const prov = extractBashFunction(deploySrc, 'provision_tarball');
  const rollbackFn = extractBashFunction(deploySrc, 'rollback_api');
  cutover || fail('cutover_api() 提取失败（定义缺失或未闭合——禁静默过）');
  dApi || fail('deploy_api() 提取失败（定义缺失或未闭合）');
  dFull || fail('deploy_full() 提取失败（定义缺失或未闭合）');
  prov || fail('provision_tarball() 提取失败（v4.2/P48：未定义函数被 AND-OR 吞=首次 full 半铺底继续跑——定义缺失即红）');
  rollbackFn || fail('rollback_api() 提取失败（定义缺失或未闭合——禁静默过）');
  (deploySrc.match(/^cutover_api\(\)/gm) ?? []).length === 1 || fail('cutover_api 定义必须恰 1 处');
  if (cutover) /GIT_COMMIT_HASH=/.test(cutover) || fail('cutover_api 必须注入 GIT_COMMIT_HASH=（+3 溯源行为锚）');
  if (dApi) /cutover_api\b/.test(dApi) || fail('deploy_api 函数体必须调用 cutover_api');
  if (dFull) (/deploy_web\b/.test(dFull) && /deploy_api\b/.test(dFull)) || fail('deploy_full 函数体必须调用 deploy_web+deploy_api（间接经 deploy_api 达 cutover——调用图断言）');
  if (dFull) /provision_tarball\b/.test(dFull) || fail('deploy_full 函数体必须调用 provision_tarball（铺底入口——P48）');
  // P1-12②：export 白名单锚——B25（--update-env 记录当前 shell 全量 env 进 pm2_env）纪律升机器锚
  for (const [fnName, fnBody] of [['cutover_api', cutover], ['rollback_api', rollbackFn]]) {
    const badExport = fnBody?.match(/\bexport\s+(?!GIT_COMMIT_HASH=)[A-Za-z_][A-Za-z0-9_]*/);
    if (badExport) fail(`${fnName} 含非 GIT_COMMIT_HASH 的 export（B25：--update-env 会把它常驻进 pm2_env）: ${badExport[0]}`);
  }
  /api\)[^\n]*ROLLBACK/.test(deploySrc) || fail('`api)` 分派必须对 --rollback 跳过 preflight（v4：回滚 30s 快路径不被 15-20 分钟预检钉死）');
  // 零构建锚 ssh 作用域化：不变量=服务器侧零构建（deploy_web 本地 vite build 合法）
  /\bssh\b[^\n]*\b(nest build|vite build|tsc -p)\b/.test(deploySrc) && fail('存在经 ssh 在服务器构建的调用（部署形态=本地构建上传——服务器构建段必须移除）');
  // 上传面断言（P33——文本锚，"写了但传不上"已犯两次）
  /ecosystem\.config\.cjs[^|]*\|\|\s*ssh|scp[^&]*ecosystem\.config\.cjs/.test(deploySrc) || fail('deploy.sh 必须上传 ecosystem.config.cjs');
  /-C scripts \./.test(deploySrc) || fail('deploy.sh 必须上传根 scripts/');
  /-C apps\/api\/scripts \./.test(deploySrc) || fail('deploy.sh 必须上传 apps/api/scripts/（冒烟脚本所在）');
  return errs;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const req = createRequire(here);
  const ecoPath = process.argv[2] ? resolve(process.argv[2]) : resolve(ROOT, 'ecosystem.config.cjs');
  const app = req(ecoPath).apps[0];
  const deploySrc = readFileSync(resolve(ROOT, 'deploy.sh'), 'utf8');
  const errs = checkEcosystem(app, deploySrc);
  if (errs.length) { console.error(`check-ecosystem FAIL:\n  ${errs.join('\n  ')}`); process.exit(1); }
  console.log('check-ecosystem OK: fork/1实例/45000/SIGTERM/RSS口径fail-closed/env白名单/SPOOL_DIR绝对/BIND_ADDR/契约9无内联/cutover_api单源（含GIT_COMMIT_HASH行为锚）/上传面三件');
}
