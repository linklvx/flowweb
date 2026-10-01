import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import * as path from 'path';

function findRepoRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(cur, 'pnpm-workspace.yaml'))) return cur;
    cur = path.dirname(cur);
  }
  throw new Error('repo root not found');
}
const FILE = path.join(findRepoRoot(process.cwd()), 'apps/web/src/stores/canvasStore.ts');

describe('组几何写点门禁（R1b/§4.8 v11——tripwire ≠ proof：行为证明靠 Task 18 守恒/幂等/rel 界断言）', () => {
  // 函数级允许清单（R2a-5 扩 arrangeSelection:——新命令是合法几何写者，登记而非绕开）
  const ALLOW_FN = new Set(['applyGroupFrame:', 'addToGroup:', 'dropIntoGroup:', 'arrangeSelection:']);
  // 函数声明行形态 "  name: (…) => {"（store 工厂两空格缩进）——块从声明行到下一个声明行
  const declRe = /^  ([a-zA-Z]+):/;

  it('refitGroupBounds 零残留', () => {
    expect(readFileSync(FILE, 'utf8')).not.toMatch(/refitGroupBounds/);
  });

  it('refitGroupGeometry 调用仅出现在函数级允许清单内（v4：按函数声明行分块判定，替代脆弱的全文件硬计数——第 4 个合法调用点不再误红）', () => {
    const src = readFileSync(FILE, 'utf8');
    const lines = src.split('\n');
    const offenders: string[] = [];
    let currentFn = '<preamble>';
    for (const line of lines) {
      const m = declRe.exec(line);
      if (m) currentFn = m[1] + ':';
      if (line.includes('refitGroupGeometry(') && !ALLOW_FN.has(currentFn)) offenders.push(currentFn);
    }
    expect(offenders).toEqual([]);
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

  it('折叠尺寸直写仅 COLLAPSED_SIZE 一处（200×64 字面量零命中——两处内联已单源化）', () => {
    const src = readFileSync(FILE, 'utf8');
    expect(src).not.toMatch(/width:\s*200,\s*height:\s*64/);
    expect(src.includes('COLLAPSED_SIZE')).toBe(true);
  });
});
