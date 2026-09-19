/**
 * 产物侧斜杠存在性门禁（B5，spec 2026-09-18-css-base-layer-theme §3.1「DOM class→产物 CSS 存在性」
 * 的构建期静态近似；plan B0 实现偏差登记的兜底项——「B5/B6 验收电池补产物存在性检查」）：
 *   - 扫 src 类名现场中的 `token-utility/NN` 形（15 个 var() 单值颜色键，与 css-audit --slash-gate 同源表）；
 *   - 对每个命中形，在 dist/assets/*.css 产物中查对应转义选择器（`bg-surface\/50`）是否存在——
 *     不存在 = 零输出（class 留在 DOM、样式表无该条、无警告）→ FAIL；
 *   - 源码门禁（node scripts/css-audit.mjs --slash-gate）拦字面量新增；本门禁在构建产物侧复核同表，
 *     兜住源码扫描语义之外滑入构建的用法；运行时动态拼接残余归 B6 Playwright DOM 级检查。
 *
 * 用法（B6/C7 验收电池调用）：先构建再验——
 *   pnpm --filter @flowweb/web build && node scripts/slash-product-gate.mjs
 *
 * 退出码契约：0 = PASS（src 无斜杠形，或命中形在产物 CSS 全部存在）；1 = 存在性违例；2 = dist 缺失/运行异常。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_ASSETS = path.join(APP_ROOT, 'dist', 'assets');

/** var() 单值颜色键（与 css-audit collectRoute4 同一提取正则；剔除 borderColor.DEFAULT 桥——非可斜杠的颜色键，15 语义键） */
function varValuedColorKeys() {
  const configText = readFileSync(path.join(APP_ROOT, 'tailwind.config.ts'), 'utf8');
  return [
    ...configText.matchAll(/['"]?([a-zA-Z][a-zA-Z0-9-]*)['"]?\s*:\s*['"](var\(--[a-zA-Z0-9-]+\))['"]/g),
  ]
    .map((m) => m[1])
    .filter((k) => k !== 'DEFAULT');
}

function listSourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|css)$/.test(e.name)) out.push(p);
    }
  };
  walk(path.join(APP_ROOT, 'src'));
  return out;
}

function listProdCss() {
  if (!existsSync(DIST_ASSETS)) return null;
  return readdirSync(DIST_ASSETS)
    .filter((f) => f.endsWith('.css'))
    .map((f) => path.join(DIST_ASSETS, f));
}

function main() {
  const keys = varValuedColorKeys();
  console.log(`[slash-product-gate] var() 单值颜色键 ${keys.length} 个：${keys.join(', ')}`);

  // src 类名现场中的 token-utility/NN 形（含变体前缀/!；完整 token 判定同 no-theme-utility 边界口径）
  const COLOR_PROPS = 'bg|text|border|ring|divide|from|via|to|fill|stroke|placeholder|outline|shadow|accent|caret|decoration';
  const formRe = new RegExp(
    `(?:^|[\\s\"'\`])((?:[a-zA-Z][\\w-]*:)*)!?(${COLOR_PROPS})-(${keys.join('|')})\\/(\\d{1,3})(?=$|[\\s\"'\`])`,
    'g',
  );
  const forms = new Map(); // form -> [{file, line}]
  for (const file of listSourceFiles()) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/u);
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(formRe)) {
        const form = `${m[2]}-${m[3]}/${m[4]}`;
        if (!forms.has(form)) forms.set(form, []);
        forms.get(form).push({ file: path.relative(APP_ROOT, file), line: i + 1 });
      }
    }
  }

  if (forms.size === 0) {
    console.log('[slash-product-gate] src 斜杠形 0 处；产物 CSS 存在性检查无事可验 → PASS');
    return; // exit 0
  }

  const prodCssFiles = listProdCss();
  if (!prodCssFiles || prodCssFiles.length === 0) {
    console.error('[slash-product-gate] dist/assets/*.css 不存在——先 pnpm --filter @flowweb/web build。');
    process.exitCode = 2;
    return;
  }
  const prodCss = prodCssFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

  // 存在性判定：产物 CSS 中查转义选择器 `bg-surface\/50`（斜杠在 CSS 里转义为 \/）
  const violations = [];
  for (const [form, sites] of forms) {
    const escaped = `${form.replace(/\//g, '\\/')}`;
    if (!prodCss.includes(escaped)) violations.push({ form, escaped, sites });
  }

  if (violations.length > 0) {
    for (const v of violations) {
      const at = v.sites.map((s) => `${s.file}:${s.line}`).join(', ');
      console.error(`[slash-product-gate] 违例 \`${v.form}\`（产物 CSS 无 ${v.escaped}）——var() 单值键配 /NN 零输出；src: ${at}`);
    }
    console.error(`[slash-product-gate] FAIL：${violations.length}/${forms.size} 形零输出`);
    process.exitCode = 1;
    return;
  }
  console.log(`[slash-product-gate] PASS：src 斜杠形 ${forms.size} 处全部存在于产物 CSS`);
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exitCode = 2;
}
