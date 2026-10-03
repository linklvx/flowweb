import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import * as path from 'path';
import * as shared from '@flowweb/shared';

function findRepoRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(cur, 'pnpm-workspace.yaml'))) return cur;
    cur = path.dirname(cur);
  }
  throw new Error('repo root not found');
}
const REPO_ROOT = findRepoRoot(process.cwd());
const FILE = path.join(REPO_ROOT, 'apps/web/src/stores/canvasStore.ts');

/** O0b-5 census 扫描域=apps 与 packages 两族的 src 目录（终裁 54②——排除 dist/docs/vendor/backups/node_modules；
 *  test/spec 文件不入生产计数——删除类红相由本文件其余断言+夹具改写承担）。 */
function collectProdFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', 'docs', 'vendor', 'backups'].includes(entry.name)) continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(path.join(REPO_ROOT, 'apps'));
  walk(path.join(REPO_ROOT, 'packages'));
  return out;
}

describe('组几何写点门禁（R1b/§4.8 v11——tripwire ≠ proof：行为证明靠守恒/幂等/rel 界断言）', () => {
  // 函数级允许清单（R2a-5 扩 arrangeSelection: / R2c-4 扩 arrangeGroupChildren:——新命令是合法几何写者，登记而非绕开。
  // O0b-5：applyGroupFrame 退役摘除——组框收缩/重算统一归 reconcile 单写者）
  const ALLOW_FN = new Set(['addToGroup:', 'dropIntoGroup:', 'arrangeSelection:', 'arrangeGroupChildren:']);
  // 函数声明行形态 "  name: (…) => {"（store 工厂两空格缩进）——块从声明行到下一个声明行
  const declRe = /^  ([a-zA-Z]+):/;

  it('refitGroupBounds 零残留', () => {
    expect(readFileSync(FILE, 'utf8')).not.toMatch(/refitGroupBounds/);
  });

  it('O0b-5 census：refit 族+markManuallyResized+manuallyResized 生产 0 命中（计数形态=非注释/import/re-export/类型声明/函数定义行；扫描域=apps+packages 生产源码）', () => {
    // refitExpandedGroups 不在列——O0b-4 census（canvasO0b4.derivation.test，含 test 面零命中）已钉；
    // 本处再列字面量会反噬该 census（符号串必须活在某测试里）
    const SYMBOLS = [
      'refitGroupGeometry(', 'shouldAutoRefit',
      'applyGroupFrame(', 'applyGroupFrameRect(', 'markManuallyResized', 'manuallyResized',
    ];
    const offenders: { rel: string; line: string }[] = [];
    for (const file of collectProdFiles()) {
      for (const raw of readFileSync(file, 'utf8').split('\n')) {
        const hit = SYMBOLS.find((s) => raw.includes(s));
        if (!hit) continue;
        const line = raw.trim();
        if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue; // 注释
        if (line.startsWith('import ') || line.startsWith('export {') || line.startsWith('export *') || line.startsWith('export type')) continue; // import/re-export/类型出口
        offenders.push({ rel: path.relative(REPO_ROOT, file).split(path.sep).join('/'), line: raw.trim() });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('O0b-5：refitGroupGeometry/shouldAutoRefit 函数本体+shared 导出删（几何纯函数收口 deriveGroupFrame 单源）', () => {
    const geomSrc = readFileSync(path.join(REPO_ROOT, 'packages/shared/src/canvas/geometry.ts'), 'utf8');
    expect(geomSrc).not.toMatch(/export function (refitGroupGeometry|shouldAutoRefit)/);
    expect((shared as unknown as Record<string, unknown>).refitGroupGeometry).toBeUndefined();
    expect((shared as unknown as Record<string, unknown>).shouldAutoRefit).toBeUndefined();
  });

  it('arrangeSelection 内允许直写 position（R2a-5 几何写者登记正例——ALLOW_FN 白名单在册 + 块内直写 position 实证）', () => {
    expect(ALLOW_FN.has('arrangeSelection:')).toBe(true);
    const lines = readFileSync(FILE, 'utf8').split('\n');
    const block: string[] = [];
    let inBlock = false;
    for (const line of lines) {
      // 锚实现行（`=> {` 结尾）而非 CanvasState 接口内的同名声明行（`;` 结尾——先于实现出现，误入会空块）；
      // \s*$ 容 CRLF（Windows 检出 split('\n') 残留 \r）
      if (/^  arrangeSelection:.*=> \{\s*$/.test(line)) { inBlock = true; continue; }
      if (inBlock && declRe.test(line)) break;
      if (inBlock) block.push(line);
    }
    expect(block.length).toBeGreaterThan(0);                        // 块存在（防正例对空集恒真）
    expect(block.some((l) => l.includes('position:'))).toBe(true);  // 块内直写 position（排列写回语义）
  });

  it('arrangeGroupChildren 内允许直写 position（R2c-4 几何写者登记正例——子 rel 直写是合法几何写）', () => {
    expect(ALLOW_FN.has('arrangeGroupChildren:')).toBe(true);
    const lines = readFileSync(FILE, 'utf8').split('\n');
    const block: string[] = [];
    let inBlock = false;
    for (const line of lines) {
      // 锚实现行（`=> {` 结尾）而非 CanvasState 接口内的同名声明行（`;` 结尾——照 arrangeSelection 正例先例）
      if (/^  arrangeGroupChildren:.*=> \{\s*$/.test(line)) { inBlock = true; continue; }
      if (inBlock && declRe.test(line)) break;
      if (inBlock) block.push(line);
    }
    expect(block.length).toBeGreaterThan(0);                        // 块存在（防正例对空集恒真）
    expect(block.some((l) => l.includes('position:'))).toBe(true);  // 块内直写 position（子 rel+组框写回语义）
  });

  it('折叠尺寸直写零处（O0b-5——折叠分支 envelope 写删：折叠档尺寸派生统一归 reconcile 写域① collapsed 档；canvasStore 代码行零引用+220×160 字面量零命中——R2d-2 起禁当前值内联，防回退硬编码）', () => {
    const src = readFileSync(FILE, 'utf8');
    expect(src).not.toMatch(/width:\s*220,\s*height:\s*160/);
    // 代码行零引用（注释行豁免——JSDoc 合法描述派生语义；终裁 54② 计数形态同口径）
    const codeLines = src.split('\n').map((l) => l.trim())
      .filter((l) => !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'));
    expect(codeLines.some((l) => l.includes('COLLAPSED_SIZE'))).toBe(false);   // 单意图化后 store 代码零折叠尺寸引用（引用复活即红）
  });
});
