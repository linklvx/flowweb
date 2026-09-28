// dist 新鲜度门禁：src+构建配置的内容哈希 != dist/.src-manifest.json 即失败（陈旧=静默假绿的根源）。
// 模式：--write 构建后写 manifest；--check 严格模式（stale 即红不自动建，归 CI/红相实证）；
//      默认 ensure——stale/缺失时自动重建再校验（显式打印），失败才红。
// 实现契约（v6）：重建用 spawnSync 直跑 tsc 二进制（不递归调 pnpm——dev/build/test 段互相重入）；
// 自动重建显式打印一行；watch 在跑（dist 秒级内变化）直接红提示勿抢写。
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { statSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const srcDir = join(root, 'packages/shared/src');
const distDir = join(root, 'packages/shared/dist');
const manifestPath = join(distDir, '.src-manifest.json');
const buildCfg = join(root, 'packages/shared/tsconfig.build.json');
const sharedDir = join(root, 'packages/shared');

function computeManifest() {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
  const files = walk(srcDir).filter((f) => !/\.test\.(ts|tsx)$/.test(f)).sort();
  const h = createHash('sha256');
  // 构建配置三件全覆盖（tsconfig.build/tsconfig/tsconfig.base——改 target/outDir 类陈旧也检出）
  h.update(readFileSync(buildCfg, 'utf8'));
  h.update(readFileSync(join(sharedDir, 'tsconfig.json'), 'utf8'));
  h.update(readFileSync(join(root, 'tsconfig.base.json'), 'utf8'));
  for (const f of files) h.update(f + '\0' + readFileSync(f, 'utf8'));
  return { hash: h.digest('hex'), files: files.length };
}

const mode = process.argv[2] ?? 'ensure';

if (mode === '--write') {
  writeFileSync(manifestPath, JSON.stringify(computeManifest()));
  process.exit(0);
}

let distOk = true;
try { statSync(join(distDir, 'index.js')); } catch { distOk = false; }

let saved = null;
let manifestOk = false;
if (distOk) {
  try { saved = JSON.parse(readFileSync(manifestPath, 'utf8')); manifestOk = true; } catch { manifestOk = false; }
}

const fresh = distOk && manifestOk && saved.hash === computeManifest().hash;

if (fresh) {
  console.log('[check-shared-dist] ok');
  process.exit(0);
}

if (mode === '--check') {
  if (!distOk) console.error('[check-shared-dist] dist/index.js 不存在——先 pnpm --filter @flowweb/shared build');
  else if (!manifestOk) console.error('[check-shared-dist] dist/.src-manifest.json 缺失（旧 dist 或手写产物）——重建 shared');
  else console.error('[check-shared-dist] src/构建配置 与 dist 不一致（改了源码未重建）——先 pnpm --filter @flowweb/shared build');
  process.exit(1);
}

// ensure：watch 在跑检测（dist 秒级内在写——两个 tsc 并发写 dist 是损坏源）
if (distOk) {
  const m = statSync(join(distDir, 'index.js'));
  if (Date.now() - m.mtimeMs < 1500) {
    console.error('[check-shared-dist] shared dev --watch 疑似在跑（dist 秒级内在写）——勿抢写，先停 watch 再重试');
    process.exit(1);
  }
}

console.error('[check-shared-dist] dist 陈旧/缺失——自动重建 shared');
const tscBin = require.resolve('typescript/bin/tsc', { paths: [sharedDir] });
const build = spawnSync(process.execPath, [tscBin, '-p', 'tsconfig.build.json'], { cwd: sharedDir, stdio: 'inherit' });
if (build.status !== 0) {
  console.error('[check-shared-dist] 自动重建失败——tsc 报错见上');
  process.exit(1);
}
writeFileSync(manifestPath, JSON.stringify(computeManifest()));
console.error('[check-shared-dist] 已自动重建 shared');
console.log('[check-shared-dist] ok');
