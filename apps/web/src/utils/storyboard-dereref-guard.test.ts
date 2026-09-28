// apps/web/src/utils/storyboard-dereref-guard.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import * as path from 'path';

const SRC = path.resolve(process.cwd(), 'src');

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

/** spec §4.6：全仓 \.storyboard\b 裸解引用只允许出现在 storyboardConfig 模块（解析器本体）。
 *  v3：canvasStore.ts 不预授权——Task 6 改完后它本就零命中，预授权=给 R2 开后门（门禁形同虚设）；
 *  R2 新命令真需要豁免时扩本表并同步 spec。 */
const ALLOW_FILES = ['utils/storyboardConfig.ts'];

describe('.storyboard 裸解引用门禁（F2 冻结面——防新消费点绕过 resolver）', () => {
  it('扫描面非空自证（防 cwd 错位→空集→门禁恒绿——spec §5 最贵失误模式）', () => {
    const files = listTsFiles(SRC);
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.includes('canvasStore'))).toBe(true);
  });

  it('allowlist 外零命中', () => {
    const offenders: string[] = [];
    for (const file of listTsFiles(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      if (ALLOW_FILES.includes(rel)) continue;
      const src = readFileSync(file, 'utf8');
      if (/\.storyboard\b/.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
