// scripts/check-ecosystem.test.mjs —— 判据载体自测（node --test scripts/ 消费——import 零副作用）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEcosystem, extractBashFunction } from './check-ecosystem.mjs';

const okApp = { name: 'flowweb-api', exec_mode: 'fork', instances: 1, kill_timeout: 45000, kill_signal: 'SIGTERM',
  node_args: '--max-old-space-size=512', max_memory_restart: '1G', cwd: '/home/ubuntu/flowweb', script: 'apps/api/dist/main.js',
  env: { COLLAB_SPOOL_DIR: '/abs', COLLAB_BIND_ADDR: '127.0.0.1' } };
// 夹具多行形态（对齐真实 deploy.sh）+provision_tarball/rollback_api 定义（提取锚正样本）
const okDeploy = [
  'cutover_api() {',
  '  ssh srv "export GIT_COMMIT_HASH=$(node -e \\"console.log(require(\'./apps/api/dist/build-info.json\').git)\\") && pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save"',
  '}',
  'rollback_api() {',
  '  ssh srv "cd apps/api && mv dist dist.next && mv dist.prev dist"',
  '  ssh srv "export GIT_COMMIT_HASH=$(node -e \\"console.log(require(\'./apps/api/dist/build-info.json\').git)\\") && pm2 startOrReload ecosystem.config.cjs --update-env"',
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

test('正样本零错误', () => assert.deepEqual(checkEcosystem(okApp, okDeploy), []));
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
test('RSS 口径（512M 堆+384M>700M 线）', () => {
  assert.ok(checkEcosystem({ ...okApp, max_memory_restart: '700M' }, okDeploy).some((e) => e.includes('RSS 口径')));
});
test('fail-closed：max_memory_restart 不可解析（1g/1GB/1.5G）即红，禁静默跳过', () => {
  for (const bad of ['1g', '1GB', '1.5G', 'garbage']) {
    assert.ok(checkEcosystem({ ...okApp, max_memory_restart: bad }, okDeploy).some((e) => e.includes('不可解析')), bad);
  }
});
test('调用图：deploy_full 缺 deploy_api 调用必红；cutover 缺 GIT_COMMIT_HASH= 必红', () => {
  const bad1 = okDeploy.replace(/  deploy_api\n\}/, '}');   // deploy_full 只剩 deploy_web
  assert.ok(checkEcosystem(okApp, bad1).some((e) => e.includes('deploy_full')));
  const bad2 = okDeploy.replace('export GIT_COMMIT_HASH=$(node -e \\"console.log(require(\'./apps/api/dist/build-info.json\').git)\\") && pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save"',
    'pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save');
  assert.ok(checkEcosystem(okApp, bad2).some((e) => e.includes('GIT_COMMIT_HASH')));
});
test('env 白名单：密钥/NODE_ENV/GIT_COMMIT_HASH 三者皆红', () => {
  assert.ok(checkEcosystem({ ...okApp, env: { ...okApp.env, MINIO_SECRET_KEY: 'x' } }, okDeploy).some((e) => e.includes('白名单')));
  assert.ok(checkEcosystem({ ...okApp, env: { ...okApp.env, NODE_ENV: 'production' } }, okDeploy).some((e) => e.includes('白名单')));
  assert.ok(checkEcosystem({ ...okApp, env: { ...okApp.env, GIT_COMMIT_HASH: 'abc' } }, okDeploy).some((e) => e.includes('白名单')));
});
test('内联 kill-timeout 残留即红（契约 9）', () => {
  assert.ok(checkEcosystem(okApp, okDeploy + '\nssh srv "pm2 restart flowweb-api --kill-timeout 45000"').some((e) => e.includes('kill-timeout')));
});
test('零构建锚 ssh 作用域：ssh 内构建红/本地构建绿', () => {
  assert.ok(checkEcosystem(okApp, okDeploy + '\nssh srv "cd apps/api && npx nest build"').some((e) => e.includes('服务器构建')));
  assert.ok(checkEcosystem(okApp, okDeploy + '\nssh srv "npx tsc -p packages/shared/tsconfig.build.json"').some((e) => e.includes('服务器构建')));
});
test('rollback 分派锚：`api)` 行缺 ROLLBACK 条件必红', () => {
  const bad = okDeploy.replace('api) if [[ $ROLLBACK == 1 ]]; then deploy_api; else preflight; deploy_api; fi ;;', 'api) preflight; deploy_api ;;');
  assert.ok(checkEcosystem(okApp, bad).some((e) => e.includes('rollback')));
});
test('上传面三件缺一即红（P33）', () => {
  for (const drop of [/ecosystem\.config\.cjs[^|]*\|\|\s*ssh|scp[^&]*ecosystem\.config\.cjs/, /-C scripts \./, /-C apps\/api\/scripts \./]) {
    const src = okDeploy.replace(drop, 'MISSING');
    assert.ok(checkEcosystem(okApp, src).some((e) => e.includes('上传') || e.includes('ecosystem.config.cjs') || e.includes('scripts')), String(drop));
  }
});
test('provision_tarball 定义缺失必红（P48）', () => {
  const bad = okDeploy.replace(/^provision_tarball\(\) \{[\s\S]*?\n\}\n/m, '');
  assert.ok(checkEcosystem(okApp, bad).some((e) => e.includes('provision_tarball')), '定义缺失应红');
});
test('cutover/rollback 内非 GIT_COMMIT_HASH 的 export 必红（B25 纪律升锚）', () => {
  const bad = okDeploy.replace('export GIT_COMMIT_HASH=$(node -e \\"console.log(require(\'./apps/api/dist/build-info.json\').git)\\") && pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save"',
    'export FOO_BAR=1 && export GIT_COMMIT_HASH=x && pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save');
  assert.ok(checkEcosystem(okApp, bad).some((e) => e.includes('非 GIT_COMMIT_HASH 的 export')), '杂 export 应红');
});
test('provision_tarball 内含 ssh 服务器构建必红', () => {
  const bad = okDeploy.replace('tar czf - --exclude=node_modules apps/ scripts/ ecosystem.config.cjs package.json | ssh srv "tar xzf -"',
    'ssh srv "cd apps/api && npx nest build"');
  assert.ok(checkEcosystem(okApp, bad).some((e) => e.includes('服务器构建')), '铺底内构建应红');
});
