// packages/shared/src/canvas/docShape.census.test.ts
// C0 census 守卫：docShape/brands stub 零生产调用点（C0 期间生产代码不 import 这两个模块——
// 出口接入 index.ts 是 O0a 分片的事，届时随本守卫拆除）。node fs 扫描 apps/*/src + packages/*/src，
// 排除 *.test.* / *.spec.* / test 目录 / dist / 两个定义文件自身。
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

// 只扫源码扩展名——import 只发生在代码文件，非代码文件里的 'brands' 字样是误报源
const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
// 定义文件自身不是"调用点"——豁免
const DEFINITIONS = new Set([
  'packages/shared/src/canvas/docShape.ts',
  'packages/shared/src/canvas/brands.ts',
]);

function scanRoots(): string[] {
  const roots = [
    join(REPO_ROOT, 'apps', 'web', 'src'),
    join(REPO_ROOT, 'apps', 'api', 'src'),
  ];
  const packagesDir = join(REPO_ROOT, 'packages');
  for (const name of readdirSync(packagesDir)) {
    if (!statSync(join(packagesDir, name)).isDirectory()) continue;
    const src = join(packagesDir, name, 'src');
    if (existsSync(src)) roots.push(src);
  }
  return roots;
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === 'test' || entry.name === 'node_modules') continue;
      yield* walk(full);
    } else if (entry.isFile() && CODE_EXTS.has(entry.name.slice(entry.name.lastIndexOf('.')))) {
      yield full;
    }
  }
}

// brands 只搜 import 行（防 'brands' 出现在普通文本/字符串字面量的误报）
function mentionsBrandsImport(line: string): boolean {
  if (!line.includes('brands')) return false;
  const t = line.trim();
  return t.startsWith('import ')
    || /\bfrom\s+['"]/.test(t)
    || /\brequire\(\s*['"]/.test(t)
    || /import\s*\(\s*['"]/.test(t);
}

describe('C0 census：docShape/brands stub 零生产调用点', () => {
  it('apps/*/src + packages/*/src 生产代码不 import canvas/docShape 与 canvas/brands', () => {
    const offenders: string[] = [];
    for (const root of scanRoots()) {
      for (const file of walk(root)) {
        const rel = relative(REPO_ROOT, file).split(sep).join('/');
        if (/\.test\.|\.spec\./.test(rel)) continue;
        if (DEFINITIONS.has(rel)) continue;
        const text = readFileSync(file, 'utf8');
        if (text.includes('docShape')) offenders.push(`${rel}: 含 docShape 引用`);
        if (text.split(/\r?\n/).some(mentionsBrandsImport)) offenders.push(`${rel}: import brands`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
