// ProcessSnapshot.purity.test.ts —— O0c-2（Spec B）import 图断言：
// "ProcessSnapshot 传递依赖不含 useCanvasStore"（spec v3.12：抽取组件落点=components/storyboard/
// ——防 videos→canvas 深层依赖架空"零 store 依赖"红线）。静态图遍历（BFS 解析本地 import），
// 包依赖（react/@xyflow/@flowweb/shared/antd 等）为叶子不展开——断言辖域=web 本地传递闭包。
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
const REPO_ROOT = findRepoRoot(process.cwd());
const WEB_SRC = path.join(REPO_ROOT, 'apps/web/src');
const ENTRY = path.join(WEB_SRC, 'pages/videos/ProcessSnapshot.tsx');

/** 本地说明符解析（@/ 别名+相对路径；扩展名/index 补全）。包说明符→null（叶子）。 */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string | null = null;
  if (spec.startsWith('@/')) base = path.join(WEB_SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  if (base == null) return null; // 包依赖叶子（react/@xyflow/react/@flowweb/shared/…）+样式等非模块
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    try { readFileSync(cand, 'utf8'); return cand; } catch { /* 不存在/目录——试下一候选 */ }
  }
  return null;
}

describe('ProcessSnapshot 传递依赖纯度（O0c-2——零 store 红线）', () => {
  it('传递闭包（含入口）不含 useCanvasStore：零 canvasStore 文件入图+零符号引用', () => {
    const reached: string[] = [];
    const seen = new Set<string>();
    const queue = [ENTRY];
    while (queue.length > 0) {
      const file = queue.shift()!;
      if (seen.has(file)) continue;
      seen.add(file);
      reached.push(file);
      const src = readFileSync(file, 'utf8');
      const specifiers = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const spec of specifiers) {
        const resolved = resolveSpecifier(file, spec);
        if (resolved && !seen.has(resolved)) queue.push(resolved);
      }
    }
    expect(reached.length).toBeGreaterThan(1); // 防空图恒真（至少含入口+抽取组件）
    // 文件级：canvasStore 不入图
    const offenders = reached.filter((f) => f.replaceAll('\\', '/').includes('/stores/canvasStore'));
    expect(offenders).toEqual([]);
    // 符号级：闭包内任一文件源码零 useCanvasStore 引用（import/调用/注释文案均拦——红线字面钉死）
    for (const file of reached) {
      expect(
        readFileSync(file, 'utf8').includes('useCanvasStore'),
        `${path.relative(REPO_ROOT, file)} 引用 useCanvasStore`,
      ).toBe(false);
    }
  });
});
