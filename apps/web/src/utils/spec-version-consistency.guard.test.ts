// apps/web/src/utils/spec-version-consistency.guard.test.ts
// B7-1（Spec B 终裁 63②+78⑥+第二十五轮）：附录版本一致性 census——正则抓 `v3\.\d+` 三处互比
// [冻结表标题/附录一标题/spec 文件标题] ∧三处相等。禁硬编码版本值（写死必再 stale——升级版本时
// 只改三处标题本身，本断言零改动跟随）。
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function findRepoRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(cur, 'pnpm-workspace.yaml'))) return cur;
    cur = join(cur, '..');
  }
  throw new Error('repo root not found');
}
const REPO_ROOT = findRepoRoot(process.cwd());

const PLAN = join(REPO_ROOT, 'docs/superpowers/plans/2026-10-02-canvas-group-spec-b-geometry-batch.md');
const SPEC = join(REPO_ROOT, 'docs/superpowers/specs/2026-09-28-group-geometry-batch-connect-design.md');

/** 标题行抓取：predicate 命中的首行；版本串=该行内最后一个 v3.N（附录一标题含沿革多版本——
 *  末位=当前终裁版；"=v3.N"同值锚定）。 */
function titleLine(file: string, pred: (l: string) => boolean): string {
  const line = readFileSync(file, 'utf8').split('\n').find(pred);
  if (line == null) throw new Error(`标题行缺失（扫描面自证——文件被改名/标题措辞改动须同批改本测试）: ${file}`);
  return line;
}
const versionOf = (line: string): string | undefined => [...line.matchAll(/v3\.\d+/g)].at(-1)?.[0];

describe('B7-1 census：附录版本一致性（冻结表标题 ≡ 附录一标题 ≡ spec 文件标题——三处互比）', () => {
  it('三处标题的 v3.N（末位）相等（禁硬编码版本值——改版本只改三处标题）', () => {
    const freeze = titleLine(PLAN, (l) => l.startsWith('## 数字冻结表'));
    const appendix = titleLine(PLAN, (l) => l.startsWith('## 附录一'));
    const specTitle = titleLine(SPEC, (l) => l.startsWith('# ') && l.includes('spec'));
    const versions = {
      冻结表: versionOf(freeze),
      附录一: versionOf(appendix),
      spec标题: versionOf(specTitle),
    };
    // 三处均抓到版本串（扫描面自证——标题缺失版本串即红，防 undefined===undefined 恒真）
    expect(versions.冻结表).toMatch(/^v3\.\d+$/);
    expect(versions.附录一).toMatch(/^v3\.\d+$/);
    expect(versions.spec标题).toMatch(/^v3\.\d+$/);
    expect(new Set(Object.values(versions)).size, JSON.stringify(versions)).toBe(1);
  });
});
