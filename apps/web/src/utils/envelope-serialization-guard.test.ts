import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import * as path from 'path';

/** 仓根定位：从 cwd 向上找 pnpm-workspace.yaml（防 cwd 错位——process.cwd() 在 vitest 下是包根） */
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
  path.join(ROOT, 'apps/api/src'),
  path.join(ROOT, 'apps/api/prisma'),
  // M0-2：apps/api/scripts 随 backfill-team.ts 死码整删退出扫描面（目录不复存在）
  path.join(ROOT, 'packages/shared/src'),
];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) out.push(...listTsFiles(p));
    else if (/\.(ts|tsx)$/.test(e) && !/\.(test|spec)\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

/** 整信封写者不变量：`.set('position'` / `.set("position"`（构造 position 子 Map）只允许出现在
 *  信封单源与 Y.Map 适配器内。position 子 Map 构造是整信封写入的最强单判据。
 *  gate-seed.ts 豁免登记（v6 裁决）：2 节点 e2e fixture 非产品写者——接 writeNodeToYMap 会给
 *  Playwright tsx 直跑路径引入 shared→dist 新鲜度耦合（e2e 无内联门禁），接受手写例外。 */
const ALLOW_FILES = new Set([
  'packages/shared/src/canvas/nodeEnvelope.ts',
  'apps/web/src/collab/ydocBuilder.ts',
  'apps/api/src/modules/collab/node-doc.util.ts',
  'apps/api/prisma/gate-seed.ts',
  // 批4b-1（门 C 裁决·意图漏斗）：canvasIntents applyIntentToDoc 是新合法 doc 写者——
  // moveNode intent 的 position 子 Map 构造（与 ydocBuilder 同级的 Y.Map 适配器）
  'apps/web/src/stores/canvasIntents.ts',
]);

describe('信封序列化门禁（R1a——防手抄本复活）', () => {
  it('扫描面非空自证（四目录都有文件；关键模块在位）', () => {
    const files = SCAN_DIRS.flatMap(listTsFiles);
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.includes('ydocBuilder'))).toBe(true);
    expect(files.some((f) => f.includes('node-doc.util'))).toBe(true);
    expect(files.some((f) => f.includes('gate-seed'))).toBe(true);   // prisma 脚本面自证（M0-2 起 scripts 目录已删）
    expect(files.some((f) => f.includes('canvasStore'))).toBe(true);
  });

  it('allowlist 外零 set(position 命中', () => {
    const offenders: string[] = [];
    for (const file of SCAN_DIRS.flatMap(listTsFiles)) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (ALLOW_FILES.has(rel)) continue;
      if (/\.set\(['"]position['"]/.test(readFileSync(file, 'utf8'))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('edges 单形状 tripwire（扫描面六模块目录；判据"任一出现即违规"（v6：同行共现抓不到分两行的类型声明；注释提及也算——文本门禁有意保守，注释写 sourceId 即违规）', () => {
    const EDGE_DIRS = [
      path.join(ROOT, 'apps/api/src/modules/collab'),
      path.join(ROOT, 'apps/api/src/modules/canvas'),
      path.join(ROOT, 'apps/api/src/modules/project'),
      path.join(ROOT, 'apps/api/src/modules/template'),
      path.join(ROOT, 'apps/api/src/modules/video-work'),
      path.join(ROOT, 'apps/api/src/modules/execution'),
    ];
    const offenders: string[] = [];
    for (const file of EDGE_DIRS.flatMap(listTsFiles)) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (/\.(test|spec)\.(ts|tsx)$/.test(file)) continue;   // 夹具在 Task 7 已收敛，tsc 首段把关
      if (/(sourceId|targetId)/.test(readFileSync(file, 'utf8'))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
