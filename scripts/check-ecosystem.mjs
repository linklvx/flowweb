// scripts/check-ecosystem.mjs —— Y0a-4：ecosystem 结构锚（冻结契约 9）+deploy.sh 调用图/上传面/零服务器构建探测
// Y0c T30（Z10/Z67④/Z84/Z118/Z126③/Z142③）：单 app（apps[0]）改**双 app 按 role 遍历**——
// api+worker 完整性/双向 role 显式断言/kill_timeout 按 role 下限（api≥45000/worker≥120000）/
// worker nice=10/RSS 口径余量按 role 分离（Z84①）/heap 闸 per-role 解析+Z118+Z126③ 合并算术式
// （双处取值：resident_cap=collab-residency.service.ts、maxDocBytes=shared collab-quota.ts、
// 基线=本脚本 RSS_BASELINE_BYTES、TRIP=heap-pressure.ts per-role、mmr=ecosystem per-role）。
// 全部解析 fail-closed（Z142③：取不到值即红——与 heap/rss 既有 fail-closed 形态一致，禁静默跳过）。
// Y0c T31（RB1/RB2/RB3/RB8）：deploy.sh 断言族扩展——cutover/rollback 三步序（--only 双 app+
// wait_api_ready 定义与调用）/spool fail-closed（case "$API_PID" 守卫+按 app 名 pid+cwd 一致断言）/
// 双进程端口归属（ss -tlnp+pid=$WORKER_PID）/:138 3001 断言维持；extractRoleBytes 数值终结符
// （表达式/小数值⇒null——T30 评审 Minor-1）。探针退路（P10 不通过⇒单命令 startOrReload）落地时
// 三步序锚必须同批改（二选一显式结论——禁锚与脚本各说各话）。
// 用法：node scripts/check-ecosystem.mjs [ecosystem-path]（默认 <ROOT>/ecosystem.config.cjs）
// 自测载体=scripts/check-ecosystem.test.mjs（node:test，唯一入口——防双源）；本文件 import 零副作用（isMain 守卫）
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(import.meta.url);
const ROOT = resolve(here, '../..');

const MiB = 1024 * 1024;
// Z84①：RSS 口径余量常量按 role 分离（设计源=spec §5.1 表——api 384+176=560M、worker 320+160=480M；
// 内存数字现制式 512/1G 维持〔Z103①实测前不下调〕，余量取 §5.1 表值——1G 制式下算术自洽：
// 512+176=688≤1024 / 512+160=672≤1024；实测后与设计值同批校准→T32）
const EXTERNAL_HEADROOM_BYTES = { api: 176 * MiB, worker: 160 * MiB };
const RSS_BASELINE_BYTES = 138_800_000; // server-profile F1 实测 138.8MB
const ROLES = ['api', 'all', 'worker'];

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

/** Y0c T30（Z84②）：per-role 字节映射提取——heap-pressure.ts `export const <name>: Record<CollabRole,
 *  number> = { api: …, all: …, worker: … }` 字面量。fail-closed（Z142③）：块缺失/任一 role 键缺失/
 *  值非 [\d_] 字面量 ⇒ null（调用方即红），禁"提取不到就算过"。
 *  T31（RB8/T30 评审 Minor-1）：数值带终结符 `\s*(?=,|$)`——对象字面量语法下非末位属性必以 `,` 结束、
 *  末位可省逗号（块捕获 [^}]* 不含右括号故用 $），表达式值（`750 * MiB`）/小数值（`1.5`）因此整体
 *  匹配失败 ⇒ null；旧注释「[\d_] 中段截断由 Number.isFinite 复核兜底」失实——isFinite 只挡 NaN 形态，
 *  挡不住前缀截断（`750 * MiB`→750 是有限数），如实勘正。 */
export function extractRoleBytes(src, constName) {
  const block = new RegExp(`export const ${constName}[^=]*=\\s*\\{([^}]*)\\}`).exec(src)?.[1];
  if (block === undefined) return null;
  const out = {};
  for (const role of ROLES) {
    const m = new RegExp(`(?:^|[,\\s])${role}:\\s*([\\d_]+)\\s*(?=,|$)`).exec(block);
    if (!m) return null;
    const v = Number(m[1].replace(/_/g, ''));
    if (!Number.isFinite(v)) return null;
    out[role] = v;
  }
  return out;
}

export function checkEcosystem(apps, deploySrc) {
  const errs = [];
  const fail = (m) => errs.push(m);
  const list = Array.isArray(apps) ? apps : [];

  // ── 双 app 完整性+双向 role 断言（Z10 遍历；Z67④：两键都必须显式——单向断言会被默认值掩盖） ──
  list.length === 2 || fail(`apps 必须恰 2（flowweb-api+flowweb-worker）：实际 ${Array.isArray(apps) ? apps.length : typeof apps}`);
  const byName = new Map(list.map((a) => [a?.name, a]));
  for (const [name, role] of [['flowweb-api', 'api'], ['flowweb-worker', 'worker']]) {
    const app = byName.get(name);
    if (!app) { fail(`缺少 app ${name}（Z10 双进程——apps[0] 单读取时代已终）`); continue; }
    app.env?.COLLAB_ROLE === role || fail(`${name} env.COLLAB_ROLE 必须显式==='${role}'（Z67④ 双向断言——实际 ${JSON.stringify(app.env?.COLLAB_ROLE)}，缺省/异值皆禁）`);
  }
  for (const app of list) {
    if (app?.name !== 'flowweb-api' && app?.name !== 'flowweb-worker') fail(`未知 app 名=${app?.name}（词表=flowweb-api/flowweb-worker）`);
  }

  // ── heap 闸 per-role 数值面（Z126③ 双处取值+Z142③ fail-closed）──
  // 提取锚=heap-pressure.ts RSS_TRIP_BYTES/RSS_RELEASE_BYTES per-role Record 字面量（Z84②——
  // 单值常量形态已被 T30 分离；\d+ 截断教训维持：提取失败必红禁静默）。
  const heapSrc = readFileSync(resolve(ROOT, 'apps/api/src/modules/collab/heap-pressure.ts'), 'utf8');
  const trip = extractRoleBytes(heapSrc, 'RSS_TRIP_BYTES');
  const release = extractRoleBytes(heapSrc, 'RSS_RELEASE_BYTES');
  (trip && release) || fail('HEAP per-role 常量提取失败（heap-pressure.ts RSS_TRIP_BYTES/RSS_RELEASE_BYTES 须为含 api/all/worker 三键的 Record 字面量——Z142③ fail-closed，禁"提取不到就算过"）');
  const residentCap = Number(/DEFAULT_MAX_RESIDENT_BYTES\s*=\s*([\d_]+)/.exec(
    readFileSync(resolve(ROOT, 'apps/api/src/modules/collab/collab-residency.service.ts'), 'utf8'))?.[1]?.replace(/_/g, ''));
  Number.isFinite(residentCap) || fail('resident_cap 提取失败（collab-residency.service.ts DEFAULT_MAX_RESIDENT_BYTES——Z126③/Z142③ fail-closed）');
  const maxDocBytes = Number(/maxDocBytes:\s*([\d_]+)/.exec(
    readFileSync(resolve(ROOT, 'packages/shared/src/constants/collab-quota.ts'), 'utf8'))?.[1]?.replace(/_/g, ''));
  Number.isFinite(maxDocBytes) || fail('maxDocBytes 提取失败（packages/shared/src/constants/collab-quota.ts QUOTA_DEFAULTS——Z126③/Z142③ fail-closed）');
  if (trip && release) {
    // 单调链 per role（Y0b-3 T4 既有断言的 per-role 化——迟滞方向+基线覆盖）
    for (const role of ROLES) {
      RSS_BASELINE_BYTES * 4 < release[role] || fail(`heap release[${role}](${release[role]}) 必须大于 baseline×4（${RSS_BASELINE_BYTES * 4}——无法覆盖基线膨胀）`);
      release[role] < trip[role] || fail(`heap release[${role}](${release[role]}) 必须小于 trip[${role}](${trip[role]})（迟滞方向）`);
    }
  }

  // ── 每 app 结构断言（原单 app 面+role 分档）──
  for (const app of list) {
    if (!app || (app.name !== 'flowweb-api' && app.name !== 'flowweb-worker')) continue;   // 缺失/未知名已在上段红
    const role = app.name === 'flowweb-worker' ? 'worker' : 'api';
    app.exec_mode === 'fork' || fail(`${app.name} exec_mode=${app.exec_mode}（E35 禁 cluster）`);
    app.instances === 1 || fail(`${app.name} instances=${app.instances}`);
    const ktMin = role === 'worker' ? 120000 : 45000;
    Number.isInteger(app.kill_timeout) && app.kill_timeout >= ktMin || fail(`${app.name} kill_timeout=${app.kill_timeout}（Z10 按 role 下限：api≥45000/worker≥120000——ffmpeg/4K 排空上界）`);
    app.kill_signal === 'SIGTERM' || fail(`${app.name} kill_signal=${app.kill_signal}`);
    if (role === 'worker') app.nice === 10 || fail(`flowweb-worker nice=${app.nice}（Z10 必须 10——CPU 优先级=拆分真实收益）`);
    const heap = Number(/--max-old-space-size=(\d+)/.exec(app.node_args ?? '')?.[1]);
    const rss = toBytes(app.max_memory_restart);
    // fail-closed：不可解析即红，禁静默跳过断言（'1g'/'1GB'/'1.5G' 等 pm2 接受但令门禁失效的形态）
    Number.isFinite(heap) || fail(`${app.name} node_args 缺 --max-old-space-size 或值不可解析: ${app.node_args}`);
    Number.isFinite(rss) || fail(`${app.name} max_memory_restart 不可解析: ${app.max_memory_restart}（支持 1024/1K/1M/1G 整数形态）`);
    if (Number.isFinite(heap) && Number.isFinite(rss)) {
      // Z84①：余量按 role（旧单值 384M 对 api 384/560、worker 320/480 设计值双侧红——§5.1 同源分离）
      rss >= heap * MiB + EXTERNAL_HEADROOM_BYTES[role] || fail(`RSS 口径[${role}]：max_memory_restart(${app.max_memory_restart}) 必须 ≥ old-space(${heap}M)+${EXTERNAL_HEADROOM_BYTES[role] / MiB}M（Yjs/原生外部内存余量）`);
      rss <= 1900 * MiB || fail(`${app.name} max_memory_restart(${app.max_memory_restart}) 超 1.9GB 物理粗线`);
    }
    // Z118+Z126③ 合并算术式（per role，替换旧 :73 单向单值断言；数值面缺失已由提取段红，此处只跳过比较）：
    //   api：resident_cap+maxDocBytes+基线 ≤ TRIP[api] ∧ TRIP[api]+200MiB ≤ mmr[api]
    //   worker：基线 ≤ TRIP[worker] ∧ TRIP[worker]+200MiB ≤ mmr[worker]（worker 无常驻 doc——
    //           resident_cap/maxDocBytes 项不适用，Z126③ worker 变式）
    if (trip && Number.isFinite(rss)) {
      if (role === 'api') {
        if (Number.isFinite(residentCap) && Number.isFinite(maxDocBytes)) {
          residentCap + maxDocBytes + RSS_BASELINE_BYTES <= trip.api || fail(`Z126③ 算术[api]：resident_cap(${residentCap})+maxDocBytes(${maxDocBytes})+基线(${RSS_BASELINE_BYTES}) ≤ TRIP[api](${trip.api}) 不成立`);
        }
        trip.api + 200 * MiB <= rss || fail(`Z118 算术[api]：TRIP[api](${trip.api})+200MiB ≤ max_memory_restart[api](${app.max_memory_restart}=${rss}) 不成立（缓解时延预算）`);
      } else {
        RSS_BASELINE_BYTES <= trip.worker || fail(`Z126③ 算术[worker]：基线(${RSS_BASELINE_BYTES}) ≤ TRIP[worker](${trip.worker}) 不成立`);
        trip.worker + 200 * MiB <= rss || fail(`Z118 算术[worker]：TRIP[worker](${trip.worker})+200MiB ≤ max_memory_restart[worker](${app.max_memory_restart}=${rss}) 不成立（缓解时延预算）`);
      }
    }
    // env 白名单（T30 扩 COLLAB_ROLE——Z89 分叉键口径）+NODE_ENV 禁令（Y0.5/E58 落地才解禁）
    // +B25：GIT_COMMIT_HASH 来自 shell 注入非 env{}。SPOOL_DIR/BIND_ADDR 是 api 面断言（gateway/spool
    // 只装配于 api|all——worker 无消费者）。
    const ENV_ALLOWLIST = new Set(['COLLAB_ROLE', 'COLLAB_SPOOL_DIR', 'COLLAB_BIND_ADDR']);
    for (const k of Object.keys(app.env ?? {})) ENV_ALLOWLIST.has(k) || fail(`${app.name} env 键 ${k} 不在白名单（禁密钥进 ecosystem——env 走服务器 .env）`);
    if (role === 'api') {
      isAbsolute(app.env?.COLLAB_SPOOL_DIR ?? '') || fail('COLLAB_SPOOL_DIR 必须绝对路径');
      app.env?.COLLAB_BIND_ADDR === '127.0.0.1' || fail('COLLAB_BIND_ADDR 必须 127.0.0.1（P25）');
    }
    typeof app.script === 'string' || fail(`${app.name} script 形态：${app.script}（必须字符串）`);
    typeof app.cwd === 'string' && isAbsolute(app.cwd) || fail(`${app.name} cwd 形态：${app.cwd}（必须绝对路径）`);
  }

  // ── deploy.sh 断言族（T31 扩展：RB1 三步序/RB2 双进程归属/RB3 spool fail-closed——文本锚照既有惯例）──
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

  // ── T31 断言组（RB1/RB2/RB3——deploy 顺序化+双进程归属+spool fail-closed；文本锚形态照既有惯例）──
  // RB1（Z9②）：cutover ⑤ 与 rollback 均三步序——`--only flowweb-api` 先起→wait_api_ready 绿→
  // `--only flowweb-worker`→pm2 save（worker 早于 api ready 消费撞 503 烧 attempts——付费队列 attempts:1）。
  // wait_api_ready 定义提取（P48 同款：未定义函数=调用点 command not found，顺序门语义必须显式锚定）。
  const waitFn = extractBashFunction(deploySrc, 'wait_api_ready');
  waitFn || fail('wait_api_ready() 提取失败（定义缺失或未闭合——RB1 三步序 ready 门的共享短轮询载体）');
  for (const [fnName, fnBody] of [['cutover_api', cutover], ['rollback_api', rollbackFn]]) {
    if (!fnBody) continue;   // 提取失败已在上段红
    /pm2 startOrReload ecosystem\.config\.cjs --only flowweb-api --update-env/.test(fnBody) || fail(`${fnName} 缺三步序①（pm2 startOrReload ecosystem.config.cjs --only flowweb-api --update-env——RB1/Z9② 按 app 名显式定位）`);
    /pm2 startOrReload ecosystem\.config\.cjs --only flowweb-worker --update-env/.test(fnBody) || fail(`${fnName} 缺三步序③（pm2 startOrReload ecosystem.config.cjs --only flowweb-worker --update-env——RB1/Z9②）`);
    /wait_api_ready\b/.test(fnBody) || fail(`${fnName} 缺 wait_api_ready 调用（三步序② ready 门——api 绿前不起 worker）`);
  }
  if (cutover) {
    // RB3（Z9④/偏离 42）：spool 步 fail-closed——pid 空/多值/非数 ⇒ 显式日志+exit 1（未定义态不放行）
    /pm2 pid flowweb-api/.test(cutover) || fail('cutover_api 缺按 app 名显式定位 pid（pm2 pid flowweb-api——Z9④ 多 app 下 readlink 对象必须按名解析）');
    /case "\$API_PID" in/.test(cutover) || fail('cutover_api spool 步缺 pid fail-closed 守卫（case "$API_PID" in 空/多值/非数⇒显式日志+exit 1——RB3/Z9④）');
    /\/proc\/\$WORKER_PID\/cwd/.test(cutover) || fail('cutover_api 缺 cwd 一致断言（/proc/$WORKER_PID/cwd readlink 与 api 等值比较——RB3：双进程必须同部署树）');
    // RB2（Z9③）：双进程端口归属——ss -tlnp 断言 3000/3001 listener pid=api ∧ 3002=worker ∧ worker 名下无 3000/3001
    /ss -tlnp/.test(cutover) || fail('cutover_api 缺双进程端口归属断言（ss -tlnp——RB2/Z9③ worker 无 HTTP 面的运行态操作化）');
    /pid=\$WORKER_PID/.test(cutover) || fail('cutover_api 端口归属断言缺 worker pid 比较面（pid=$WORKER_PID——RB2：3002=worker ∧ worker 名下无 3000/3001）');
    // :138 既有 3001 断言维持（T31 plan 显式项——ws 面存活探针）
    /connect\(3001/.test(cutover) || fail('cutover_api 缺 3001 监听断言（net.connect(3001) 既有形态维持——T31 plan）');
  }
  return errs;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const req = createRequire(here);
  const ecoPath = process.argv[2] ? resolve(process.argv[2]) : resolve(ROOT, 'ecosystem.config.cjs');
  const { apps } = req(ecoPath);
  const deploySrc = readFileSync(resolve(ROOT, 'deploy.sh'), 'utf8');
  const errs = checkEcosystem(apps, deploySrc);
  if (errs.length) { console.error(`check-ecosystem FAIL:\n  ${errs.join('\n  ')}`); process.exit(1); }
  console.log('check-ecosystem OK: 双app按role遍历（api+worker恰2）/Z67④双向role显式/fork/1实例/kill_timeout按role（api≥45000/worker≥120000）/worker nice=10/SIGTERM/RSS口径per-role余量fail-closed/heap闸per-role+Z118+Z126③合并算术式/env白名单（含COLLAB_ROLE）/SPOOL_DIR绝对+ BIND_ADDR（api面）/契约9无内联/cutover_api单源（含GIT_COMMIT_HASH行为锚）/上传面三件/T31三步序（cutover+rollback --only双app+wait_api_ready）/spool fail-closed（case守卫+按app名pid+cwd一致）/RB2端口归属（ss -tlnp+worker pid比较面）/3001断言维持');
}
