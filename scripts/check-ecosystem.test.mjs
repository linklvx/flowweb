// scripts/check-ecosystem.test.mjs —— 判据载体自测（node --test scripts/ 消费——import 零副作用）
// Y0c T30（Z10/Z67④/Z84/Z118/Z126③/Z142③）：checkEcosystem(apps, deploySrc) 双 app 按 role 遍历——
// api+worker 完整性/双向 role 显式断言/kill_timeout 按 role 下限/worker nice=10/RSS 口径 per-role
// 余量/heap 闸 per-role 合并算术式（全 fail-closed）。heap 数值面读真实 heap-pressure.ts（提取锚
// 纪律——正样本绿即证明 per-role 解析对当前文件形态可达）。
// Y0c T31（RB1/RB2/RB3/RB8）：deploy.sh 断言族扩展——三步序（--only 双 app+wait_api_ready）/
// 双进程端口归属（ss -tlnp）/spool fail-closed（case 守卫+cwd 一致）+extractRoleBytes 终结符对抗例。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEcosystem, extractBashFunction, extractRoleBytes } from './check-ecosystem.mjs';

const okApiApp = { name: 'flowweb-api', exec_mode: 'fork', instances: 1, kill_timeout: 45000, kill_signal: 'SIGTERM',
  node_args: '--max-old-space-size=512', max_memory_restart: '1G', cwd: '/home/ubuntu/flowweb', script: 'apps/api/dist/main.js',
  env: { COLLAB_ROLE: 'api', COLLAB_SPOOL_DIR: '/abs', COLLAB_BIND_ADDR: '127.0.0.1' } };
const okWorkerApp = { name: 'flowweb-worker', exec_mode: 'fork', instances: 1, kill_timeout: 120000, kill_signal: 'SIGTERM',
  nice: 10, node_args: '--max-old-space-size=512', max_memory_restart: '1G', cwd: '/home/ubuntu/flowweb', script: 'apps/api/dist/main-worker.js',
  env: { COLLAB_ROLE: 'worker' } };
const okApps = [okApiApp, okWorkerApp];
// 夹具多行形态（对齐真实 deploy.sh）+provision_tarball/rollback_api/wait_api_ready 定义（提取锚正样本）
// T31：cutover/rollback 三步序（--only api→wait_api_ready→--only worker）+spool fail-closed（case 守卫）
// +RB2 端口归属（ss -tlnp/pid=$WORKER_PID/cwd 一致）+:138 3001 断言——文本锚与真实 deploy.sh 同形
const okDeploy = [
  'wait_api_ready() {',
  '  ssh srv \'i=0; body=""; while [ $i -lt 60 ]; do i=$((i+1)); body=$(curl -s http://127.0.0.1:3000/api/ready 2>/dev/null); echo "$body" | grep -q ready && exit 0; sleep 1; done; exit 1\'',
  '}',
  'cutover_api() {',
  '  ssh srv \'f(){ echo "spool FAIL"; exit 1; }; API_PID=$(pm2 pid flowweb-api); case "$API_PID" in ""|*[!0-9]*) f "pid undefined";; esac; OLD_DIR=$(sudo readlink "/proc/$API_PID/cwd")/.data/collab-spool\'',
  '  ssh srv "export GIT_COMMIT_HASH=$(node -e \\"console.log(require(\'./apps/api/dist/build-info.json\').git)\\") && pm2 startOrReload ecosystem.config.cjs --only flowweb-api --update-env"',
  '  wait_api_ready deploy',
  '  ssh srv "pm2 startOrReload ecosystem.config.cjs --only flowweb-worker --update-env && pm2 save"',
  '  ssh srv \'node -e "require(\\"net\\").connect(3001,\\"127.0.0.1\\")"\'',
  '  ssh srv \'SS=$(ss -tlnp); API_CWD=$(sudo readlink "/proc/$API_PID/cwd"); WORKER_PID=$(pm2 pid flowweb-worker); echo "$SS" | grep ":3000 " | grep -q "pid=$API_PID,"; echo "$SS" | grep ":3002 " | grep -q "pid=$WORKER_PID,"; echo "$SS" | grep "pid=$WORKER_PID," | grep -qE ":(3000|3001) "; WORKER_CWD=$(sudo readlink "/proc/$WORKER_PID/cwd"); [ "$API_CWD" = "$WORKER_CWD" ]\'',
  '}',
  'rollback_api() {',
  '  ssh srv "cd apps/api && mv dist dist.next && mv dist.prev dist"',
  '  ssh srv "export GIT_COMMIT_HASH=$(node -e \\"console.log(require(\'./apps/api/dist/build-info.json\').git)\\" 2>/dev/null || echo unknown) && pm2 startOrReload ecosystem.config.cjs --only flowweb-api --update-env"',
  '  wait_api_ready rollback',
  '  ssh srv "pm2 startOrReload ecosystem.config.cjs --only flowweb-worker --update-env && pm2 save"',
  '}',
  'deploy_web() {',
  '  ( cd apps/web && rm -rf dist && npx vite build )',   // 本地构建=合法（零构建锚只扫 ssh 行）
  '}',
  'provision_tarball() {',                                 // P48：铺底入口（无服务器构建）
  '  tar czf - --exclude=node_modules apps/ scripts/ ecosystem.config.cjs package.json | ssh srv "tar xzf -"',
  '}',
  'deploy_api() {',
  '  scp ecosystem.config.cjs srv:',
  '  tar czf - -C scripts . | ssh srv "tar xzf -"',
  '  tar czf - -C apps/api/scripts . | ssh srv "tar xzf -"',
  '  cutover_api',
  '}',
  'deploy_full() {',                                       // P48：三行顺次
  '  provision_tarball',
  '  deploy_web',
  '  deploy_api',
  '}',
  'case "$MODE" in',
  '  api) if [[ $ROLLBACK == 1 ]]; then deploy_api; else preflight; deploy_api; fi ;;',
  'esac',
].join('\n');

test('正样本零错误（双 app：api+worker）', () => assert.deepEqual(checkEcosystem(okApps, okDeploy), []));
test('提取器自测：多行/嵌套大括号/单行体/未闭合与缺失=提取失败/${#var} 与行尾注释不截', () => {
  assert.match(extractBashFunction(okDeploy, 'deploy_api'), /cutover_api/);
  const nested = ['f() {', '  if [ -d x ]; then', '    { a; }', '  fi', '}'].join('\n');
  assert.match(extractBashFunction(nested, 'f'), /if \[ -d x \]/);   // 嵌套 { a; } 不提前截断
  assert.match(extractBashFunction('f() { single; }', 'f'), /single/);
  assert.equal(extractBashFunction(['f() {', '  x'].join('\n'), 'f'), '');   // 未闭合=''
  assert.equal(extractBashFunction('function missing { }', 'f'), '');        // 定义缺失=''
  const hashVar = ['g() {', '  n=${#arr[@]}', '}'].join('\n');
  assert.match(extractBashFunction(hashVar, 'g'), /\$\{#arr\[@\]\}/);        // # 前非空白=不截
  const inlineCmt = ['h() {   # 行尾注释含 { 括号', '  x', '}'].join('\n');
  // 注释剥离只作用于配平计数，返回体保真原行——若注释 { 被计入配平则 depth 失衡=提取失败=''，match 必失败
  assert.match(extractBashFunction(inlineCmt, 'h'), /# 行尾注释含 \{ 括号/);
});
test('I-1 末行守卫：引号内孤立 } 提前截断→末行是含 } 的命令行非独立 }→返回 \'\'（fail-closed 防 export 扫描面收窄）', () => {
  const quoted = ['f() {', '  echo "}"', '  x', '}'].join('\n');
  assert.equal(extractBashFunction(quoted, 'f'), '');
});
test('extractRoleBytes：Record<role,bytes> 字面量三键全提取；缺块/缺任一 role/值不可解析=null（fail-closed Z142③）', () => {
  const src = 'export const RSS_TRIP_BYTES: Record<CollabRole, number> = {\n  api: 786_432_000,\n  all: 786_432_000,\n  worker: 1_000,\n};';
  assert.deepEqual(extractRoleBytes(src, 'RSS_TRIP_BYTES'), { api: 786432000, all: 786432000, worker: 1000 });
  assert.equal(extractRoleBytes(src, 'RSS_MISSING'), null);                                    // 块缺失
  assert.equal(extractRoleBytes('export const X = {\n  api: 1,\n};', 'X'), null);              // 缺 all/worker
  assert.equal(extractRoleBytes('export const X = {\n  api: 1,\n  all: NaN,\n  worker: 2,\n};', 'X'), null); // 值不可解析
});
test('Z67④ 双向 role 断言：两 app env.COLLAB_ROLE 必须显式且值对——缺省/异值/错位皆红', () => {
  const { COLLAB_ROLE: _drop, ...apiEnvNoRole } = okApiApp.env;
  assert.ok(checkEcosystem([{ ...okApiApp, env: apiEnvNoRole }, okWorkerApp], okDeploy)
    .some((e) => e.includes("flowweb-api env.COLLAB_ROLE 必须显式==='api'")), 'api 缺 role 键');
  assert.ok(checkEcosystem([okApiApp, { ...okWorkerApp, env: {} }], okDeploy)
    .some((e) => e.includes("flowweb-worker env.COLLAB_ROLE 必须显式==='worker'")), 'worker 缺 role 键');
  assert.ok(checkEcosystem([okApiApp, { ...okWorkerApp, env: { COLLAB_ROLE: 'all' } }], okDeploy)
    .some((e) => e.includes("flowweb-worker env.COLLAB_ROLE 必须显式==='worker'")), 'worker role 异值');
  assert.ok(checkEcosystem([{ ...okApiApp, env: { ...okApiApp.env, COLLAB_ROLE: 'worker' } }, okWorkerApp], okDeploy)
    .some((e) => e.includes("flowweb-api env.COLLAB_ROLE 必须显式==='api'")), 'api role 错位');
});
test('双 app 完整性（Z10）：缺 worker app 红；apps 非恰 2 红；未知 app 名红', () => {
  assert.ok(checkEcosystem([okApiApp], okDeploy).some((e) => e.includes('缺少 app flowweb-worker')), '单 app（现状 apps[0] 形态）必须红');
  assert.ok(checkEcosystem([okApiApp, okWorkerApp, { ...okWorkerApp, name: 'flowweb-extra' }], okDeploy).some((e) => e.includes('恰 2')), '三 app 红');
  assert.ok(checkEcosystem([okApiApp, { ...okWorkerApp, name: 'flowweb-wroker' }], okDeploy).some((e) => e.includes('未知 app 名')), '拼错名红');
});
test('kill_timeout 按 role 下限（Z10）：api≥45000/worker≥120000', () => {
  assert.ok(checkEcosystem([{ ...okApiApp, kill_timeout: 44999 }, okWorkerApp], okDeploy).some((e) => e.includes('flowweb-api kill_timeout')), 'api 低于 45000');
  assert.ok(checkEcosystem([okApiApp, { ...okWorkerApp, kill_timeout: 45000 }], okDeploy).some((e) => e.includes('flowweb-worker kill_timeout')), 'worker 用 api 下限值必红');
  assert.ok(checkEcosystem([okApiApp, { ...okWorkerApp, kill_timeout: 119999 }], okDeploy).some((e) => e.includes('flowweb-worker kill_timeout')), 'worker 低于 120000');
});
test('worker nice=10 断言（Z10——CPU 优先级=拆分真实收益）：缺失/异值红', () => {
  const { nice: _drop, ...workerNoNice } = okWorkerApp;
  assert.ok(checkEcosystem([okApiApp, workerNoNice], okDeploy).some((e) => e.includes('nice')), 'nice 缺失');
  assert.ok(checkEcosystem([okApiApp, { ...okWorkerApp, nice: 0 }], okDeploy).some((e) => e.includes('nice')), 'nice 异值');
});
test('RSS 口径 per-role 余量（Z84①：api 176M/worker 160M——512M 堆下 650M 线双侧红）', () => {
  assert.ok(checkEcosystem([{ ...okApiApp, max_memory_restart: '650M' }, okWorkerApp], okDeploy).some((e) => e.includes('RSS 口径[api]')), 'api 512+176>650');
  assert.ok(checkEcosystem([okApiApp, { ...okWorkerApp, max_memory_restart: '650M' }], okDeploy).some((e) => e.includes('RSS 口径[worker]')), 'worker 512+160>650');
});
test('fail-closed：max_memory_restart 不可解析（1g/1GB/1.5G）即红，禁静默跳过', () => {
  for (const bad of ['1g', '1GB', '1.5G', 'garbage']) {
    assert.ok(checkEcosystem([{ ...okApiApp, max_memory_restart: bad }, okWorkerApp], okDeploy).some((e) => e.includes('不可解析')), bad);
  }
});
test('Z118+Z126③ 合并算术式（per role fail-closed）：TRIP[role]+200MiB ≤ mmr[role]——700M 线红（heap 750MiB+200MiB>700M）', () => {
  assert.ok(checkEcosystem([{ ...okApiApp, max_memory_restart: '700M' }, okWorkerApp], okDeploy).some((e) => e.includes('Z118 算术[api]')), 'api 700M 撞缓解时延预算');
  assert.ok(checkEcosystem([okApiApp, { ...okWorkerApp, max_memory_restart: '700M' }], okDeploy).some((e) => e.includes('Z118 算术[worker]')), 'worker 700M 撞缓解时延预算');
});
test('env 白名单：COLLAB_ROLE 合法（Z89 分叉键口径）；密钥/NODE_ENV/GIT_COMMIT_HASH 三者皆红；api 面 SPOOL_DIR/BIND_ADDR 断言维持', () => {
  assert.ok(checkEcosystem([{ ...okApiApp, env: { ...okApiApp.env, MINIO_SECRET_KEY: 'x' } }, okWorkerApp], okDeploy).some((e) => e.includes('白名单')));
  assert.ok(checkEcosystem([okApiApp, { ...okWorkerApp, env: { ...okWorkerApp.env, NODE_ENV: 'production' } }], okDeploy).some((e) => e.includes('白名单')));
  assert.ok(checkEcosystem([{ ...okApiApp, env: { ...okApiApp.env, GIT_COMMIT_HASH: 'abc' } }, okWorkerApp], okDeploy).some((e) => e.includes('白名单')));
  const { COLLAB_SPOOL_DIR: _d1, COLLAB_ROLE: r1, ...apiEnvNoSpool } = okApiApp.env;
  assert.ok(checkEcosystem([{ ...okApiApp, env: { COLLAB_ROLE: r1, ...apiEnvNoSpool } }, okWorkerApp], okDeploy).some((e) => e.includes('COLLAB_SPOOL_DIR')), 'api 缺 SPOOL_DIR');
  assert.ok(checkEcosystem([{ ...okApiApp, env: { ...okApiApp.env, COLLAB_BIND_ADDR: '0.0.0.0' } }, okWorkerApp], okDeploy).some((e) => e.includes('COLLAB_BIND_ADDR')), 'api BIND_ADDR 公网');
});
test('调用图：deploy_full 缺 deploy_api 调用必红；cutover 缺 GIT_COMMIT_HASH= 必红', () => {
  const bad1 = okDeploy.replace(/  deploy_api\n\}/, '}');   // deploy_full 只剩 deploy_web
  assert.ok(checkEcosystem(okApps, bad1).some((e) => e.includes('deploy_full')));
  const bad2 = okDeploy.replace('export GIT_COMMIT_HASH=$(node -e \\"console.log(require(\'./apps/api/dist/build-info.json\').git)\\") && pm2 startOrReload ecosystem.config.cjs --only flowweb-api --update-env',
    'pm2 startOrReload ecosystem.config.cjs --only flowweb-api --update-env');
  assert.ok(checkEcosystem(okApps, bad2).some((e) => e.includes('GIT_COMMIT_HASH')));
});
test('内联 kill-timeout 残留即红（契约 9）', () => {
  assert.ok(checkEcosystem(okApps, okDeploy + '\nssh srv "pm2 restart flowweb-api --kill-timeout 45000"').some((e) => e.includes('kill-timeout')));
});
test('零构建锚 ssh 作用域：ssh 内构建红/本地构建绿', () => {
  assert.ok(checkEcosystem(okApps, okDeploy + '\nssh srv "cd apps/api && npx nest build"').some((e) => e.includes('服务器构建')));
  assert.ok(checkEcosystem(okApps, okDeploy + '\nssh srv "npx tsc -p packages/shared/tsconfig.build.json"').some((e) => e.includes('服务器构建')));
});
test('rollback 分派锚：`api)` 行缺 ROLLBACK 条件必红', () => {
  const bad = okDeploy.replace('api) if [[ $ROLLBACK == 1 ]]; then deploy_api; else preflight; deploy_api; fi ;;', 'api) preflight; deploy_api ;;');
  assert.ok(checkEcosystem(okApps, bad).some((e) => e.includes('rollback')));
});
test('上传面三件缺一即红（P33）', () => {
  for (const drop of [/ecosystem\.config\.cjs[^|]*\|\|\s*ssh|scp[^&]*ecosystem\.config\.cjs/, /-C scripts \./, /-C apps\/api\/scripts \./]) {
    const src = okDeploy.replace(drop, 'MISSING');
    assert.ok(checkEcosystem(okApps, src).some((e) => e.includes('上传') || e.includes('ecosystem.config.cjs') || e.includes('scripts')), String(drop));
  }
});
test('provision_tarball 定义缺失必红（P48）', () => {
  const bad = okDeploy.replace(/^provision_tarball\(\) \{[\s\S]*?\n\}\n/m, '');
  assert.ok(checkEcosystem(okApps, bad).some((e) => e.includes('provision_tarball')), '定义缺失应红');
});
test('cutover/rollback 内非 GIT_COMMIT_HASH 的 export 必红（B25 纪律升锚）', () => {
  const bad = okDeploy.replace('export GIT_COMMIT_HASH=$(node -e \\"console.log(require(\'./apps/api/dist/build-info.json\').git)\\") && pm2 startOrReload ecosystem.config.cjs --only flowweb-api --update-env',
    'export FOO_BAR=1 && export GIT_COMMIT_HASH=x && pm2 startOrReload ecosystem.config.cjs --only flowweb-api --update-env');
  assert.ok(checkEcosystem(okApps, bad).some((e) => e.includes('非 GIT_COMMIT_HASH 的 export')), '杂 export 应红');
});
test('provision_tarball 内含 ssh 服务器构建必红', () => {
  const bad = okDeploy.replace('tar czf - --exclude=node_modules apps/ scripts/ ecosystem.config.cjs package.json | ssh srv "tar xzf -"',
    'ssh srv "cd apps/api && npx nest build"');
  assert.ok(checkEcosystem(okApps, bad).some((e) => e.includes('服务器构建')), '铺底内构建应红');
});
test('T31/RB1 三步序锚：--only 双 app 形态缺（cutover 与 rollback 各自）/wait_api_ready 调用缺/定义缺 ⇒ 红', () => {
  const noOnly = okDeploy.replaceAll('--only flowweb-api ', '').replaceAll('--only flowweb-worker ', '');   // 退回单命令形态（探针不通过退路）⇒ 断言族必须红（退回须同批改锚——二选一显式结论）
  const errs = checkEcosystem(okApps, noOnly);
  assert.ok(errs.some((e) => e.includes('cutover_api 缺三步序①')), 'cutover ① 红');
  assert.ok(errs.some((e) => e.includes('cutover_api 缺三步序③')), 'cutover ③ 红');
  assert.ok(errs.some((e) => e.includes('rollback_api 缺三步序①')), 'rollback ① 红');
  assert.ok(errs.some((e) => e.includes('rollback_api 缺三步序③')), 'rollback ③ 红');
  assert.ok(checkEcosystem(okApps, okDeploy.replace('  wait_api_ready rollback', '  true'))
    .some((e) => e.includes('rollback_api 缺 wait_api_ready')), 'rollback wait 调用缺红');
  assert.ok(checkEcosystem(okApps, okDeploy.replace('  wait_api_ready deploy', '  true'))
    .some((e) => e.includes('cutover_api 缺 wait_api_ready')), 'cutover wait 调用缺红');
  assert.ok(checkEcosystem(okApps, okDeploy.replace(/^wait_api_ready\(\) \{[\s\S]*?\n\}\n/m, ''))
    .some((e) => e.includes('wait_api_ready() 提取失败')), '定义缺失红（P48 同款）');
});
test('T31/RB3 spool fail-closed：pid case 守卫缺/pm2 pid 按 app 名缺/cwd 一致断言缺 ⇒ 红', () => {
  assert.ok(checkEcosystem(okApps, okDeploy.replace('case "$API_PID" in ""|*[!0-9]*) f "pid undefined";; esac; ', ''))
    .some((e) => e.includes('fail-closed 守卫')), 'case 守卫缺红（Z9④ 未定义态不放行）');
  assert.ok(checkEcosystem(okApps, okDeploy.replace('pm2 pid flowweb-api', 'pm2 pid 0'))
    .some((e) => e.includes('按 app 名显式定位 pid')), 'pid 按名缺红');
  assert.ok(checkEcosystem(okApps, okDeploy.replaceAll('/proc/$WORKER_PID/cwd', '/proc/$API_PID/cwd'))
    .some((e) => e.includes('cwd 一致断言')), 'cwd 断言缺红');
});
test('T31/RB2 端口归属：ss -tlnp 缺/pid=$WORKER_PID 比较面缺/3001 断言缺 ⇒ 红', () => {
  assert.ok(checkEcosystem(okApps, okDeploy.replace('SS=$(ss -tlnp)', 'SS=$(netstat -tln)'))
    .some((e) => e.includes('端口归属')), 'ss -tlnp 缺红');
  assert.ok(checkEcosystem(okApps, okDeploy.replaceAll('pid=$WORKER_PID', 'pid=$API_PID'))
    .some((e) => e.includes('worker pid 比较面')), 'worker pid 比较缺红');
  assert.ok(checkEcosystem(okApps, okDeploy.replace('connect(3001', 'connect(3002'))
    .some((e) => e.includes('3001 监听断言')), '3001 断言缺红（:138 既有形态维持）');
});
test('RB8（T30 评审 Minor-1）：extractRoleBytes 对抗例——表达式值/小数值 ⇒ null（终结符锚防 [\\d_]+ 前缀静默截断）', () => {
  const expr = 'export const RSS_TRIP_BYTES: Record<CollabRole, number> = {\n  api: 750 * MiB,\n  all: 786_432_000,\n  worker: 786_432_000,\n};';
  assert.equal(extractRoleBytes(expr, 'RSS_TRIP_BYTES'), null, '表达式值必须整体 null（旧形态静默截 750）');
  const frac = 'export const RSS_TRIP_BYTES: Record<CollabRole, number> = {\n  api: 1.5,\n  all: 2,\n  worker: 3,\n};';
  assert.equal(extractRoleBytes(frac, 'RSS_TRIP_BYTES'), null, '小数值必须整体 null（旧形态静默截 1）');
});
