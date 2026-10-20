// scripts/check-exact-pins.mjs —— Y1a T0（plan v11.2）：exact pin 门禁（check-hocuspocus-pin 同族）。
// 语义：三面锁死——①workspace 包的 dependencies spec 逐字等于常量（禁 ^/~ range：range 下 lockfile
// 重解析即可漂移，spec 本身必须是 exact）；②根 pnpm.overrides 存在且值正确（防传递面漂移——
// workspace 全局强制单版本）；③lockfile packages 段存在 pinned 条目（package.json 改后未 install=红）。
// file-type 特例：**故意不进 overrides**——@nestjs/common@10.4.18 硬依赖 file-type 20.4.1（lockfile
// 实证），全局 override 会把 Nest 内部用面强降到 16.x（17+ 纯 ESM/CJS 兼容面+API 代差=破坏面）；
// api 自身消费面由直接依赖 exact 16.5.4 锁死（≥17 纯 ESM 禁用——tsconfig commonjs）。
// 接入点：verify-manifest check-exact-pins 步（fast 外；CI test job 经 pnpm verify 同跑）。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 逐字 exact 断言表（file → dep → 版本常量）。升级=改常量=有意识动作（本表即门禁契约）。 */
export const EXACT_PINS = {
  'apps/api/package.json': {
    yjs: '13.6.32',          // 与 @hocuspocus 契约锁同版（check-hocuspocus-pin 锁 lockfile 面）
    sharp: '0.34.5',         // Y1a probe 40MP+并发 1 的行为基线版本
    'file-type': '16.5.4',   // 16.x 末版（CJS）；17+ 纯 ESM 禁用（T6④ sniff.ts 唯一 import 点）
    undici: '7.30.1',        // T6① SafeRemoteFetch dispatcher 载体（Agent 钉 IP——TOCTOU 闭环）；与 global fetch 分实例
  },
  'apps/web/package.json': {
    yjs: '13.6.32',
    'fast-deep-equal': '3.1.3',
  },
};

/** overrides 必备键（值=exact；防传递面漂移——对当前解析集全为 no-op，纯防回归）。 */
export const OVERRIDES = {
  yjs: '13.6.32',
  sharp: '0.34.5',
  'fast-deep-equal': '3.1.3',
};

/** overrides 禁入键（进了即红——见文件头 file-type 特例说明）。 */
export const OVERRIDES_FORBIDDEN = ['file-type'];

/** lockfile 中必须存在的 pinned 条目（两空格行首锚）。pnpm v9 的 packages 与 snapshots 两段顶层
 *  键同为两空格缩进（本仓 lockfile 行 8951/10613 实证）——锚同时命中两段；存在性断言下重叠无害：
 *  snapshots 条目必有对应 packages 条目（pnpm 生成不变量），故锚未命中 ⇔ 两段皆缺，假绿/假红均不可能。 */
export const LOCKFILE_ENTRIES = {
  sharp: '0.34.5',
  'fast-deep-equal': '3.1.3',
  'file-type': '16.5.4',
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** 纯判据函数（自测消费）：pkgJsons={file:json} / rootJson=根 package.json / lock=lockfile 文本。
 *  返回违反清单（空数组=过）。 */
export function checkExactPins({ pkgJsons, rootJson, lock }) {
  const violations = [];
  for (const [file, deps] of Object.entries(EXACT_PINS)) {
    const pkg = pkgJsons?.[file];
    if (!pkg) {
      violations.push(`${file}: 不可读`);
      continue;
    }
    for (const [name, version] of Object.entries(deps)) {
      const spec = pkg.dependencies?.[name];
      if (spec === undefined) violations.push(`${file}: dependencies.${name} 缺失`);
      else if (spec !== version) violations.push(`${file}: dependencies.${name}="${spec}"（必须 exact "${version}"——禁 ^/~ range）`);
    }
  }
  const ov = rootJson?.pnpm?.overrides ?? {};
  for (const [name, version] of Object.entries(OVERRIDES)) {
    if (ov[name] !== version) violations.push(`package.json pnpm.overrides.${name}="${ov[name] ?? '(缺失)'}"（必须 "${version}"）`);
  }
  for (const name of OVERRIDES_FORBIDDEN) {
    if (name in ov) violations.push(`package.json pnpm.overrides 含 ${name}（禁——@nestjs/common 硬依赖 file-type 20.x，全局 override 强降=破坏 Nest 用面；api 直依赖 exact 已锁自身消费面）`);
  }
  for (const [name, version] of Object.entries(LOCKFILE_ENTRIES)) {
    const re = new RegExp(`^  ${escapeRe(name)}@${escapeRe(version)}:`, 'm');
    if (!re.test(lock ?? '')) violations.push(`pnpm-lock.yaml: ${name}@${version} packages 段条目缺失（改 package.json 后须 pnpm install 更新 lockfile）`);
  }
  return violations;
}

function main() {
  const readJson = (f) => JSON.parse(readFileSync(path.join(ROOT, f), 'utf8'));
  const violations = checkExactPins({
    pkgJsons: Object.fromEntries(Object.keys(EXACT_PINS).map((f) => [f, readJson(f)])),
    rootJson: readJson('package.json'),
    lock: readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8'),
  });
  if (violations.length) {
    console.error('exact pin 门禁红（Y1a T0）：');
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log('exact pins ✓', { api: EXACT_PINS['apps/api/package.json'], web: EXACT_PINS['apps/web/package.json'], overrides: OVERRIDES });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
