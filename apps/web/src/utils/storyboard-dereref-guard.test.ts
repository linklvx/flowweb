// apps/web/src/utils/storyboard-dereref-guard.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import * as path from 'path';

/** 仓根定位：从 cwd 向上找 pnpm-workspace.yaml（防 cwd 错位——Task 8 envelope 门禁同款先例。
 *  R1b Task 17：扫描面扩 packages/shared/src/canvas——process.cwd()+'src' 看不见 shared） */
function findRepoRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(cur, 'pnpm-workspace.yaml'))) return cur;
    cur = path.dirname(cur);
  }
  throw new Error('repo root not found from ' + start);
}
const ROOT = findRepoRoot(process.cwd());

const SCAN_DIRS = [
  path.join(ROOT, 'apps/web/src'),
  path.join(ROOT, 'packages/shared/src/canvas'),
];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) out.push(...listTsFiles(p));
    // v3：排除式含 test+spec 双后缀——门禁自身文件名/正则字面量含 .storyboard，不排除会扫到自己永久红
    else if (/\.(ts|tsx)$/.test(e) && !/\.(test|spec)\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

/** spec §4.6：全仓 \.storyboard\b 裸解引用只允许出现在 storyboardConfig 模块（解析器本体）及
 *  向 resolver 纯转发的消费点。v3：canvasStore.ts 不预授权——Task 6 改完后它本就零命中，
 *  预授权=给 R2 开后门（门禁形同虚设）；R2 新命令真需要豁免时扩本表并同步 spec。
 *  R1b Task 17 扩面登记：
 *  - shared canvas/storyboardConfig.ts——解析器本体（自 web 迁入 shared）
 *  O0b-0：normalizeLoadedCanvas.ts 行随模块整删摘除（剥键/补缺层退役——消费点归 storyboardConfig 本体）。 */
const ALLOW_FILES = [
  'apps/web/src/utils/storyboardConfig.ts',
  'packages/shared/src/canvas/storyboardConfig.ts',
];

describe('.storyboard 裸解引用门禁（F2 冻结面——防新消费点绕过 resolver）', () => {
  it('扫描面非空自证（防 cwd 错位→空集→门禁恒绿——spec §5 最贵失误模式）', () => {
    const files = SCAN_DIRS.flatMap(listTsFiles);
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.includes('canvasStore'))).toBe(true);
    expect(files.some((f) => f.includes('docShape'))).toBe(true);   // 扩面覆盖 shared canvas 的自证（O0b-0：自证对象换仍在册模块）
  });

  it('allowlist 外零命中', () => {
    const offenders: string[] = [];
    for (const file of SCAN_DIRS.flatMap(listTsFiles)) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (ALLOW_FILES.includes(rel)) continue;
      const src = readFileSync(file, 'utf8');
      if (/\.storyboard\b/.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
