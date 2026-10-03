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
 *  O0d（Spec B）census 清扫：nodeEnvelope.ts/ydocBuilder.ts（O0a-1 起零命中——函数迁入 docShape）
 *  + gate-seed.ts（O0b-0 gate-seed 经 docShape 一次到位后零命中）三死行撤——position 子 Map
 *  构造唯一在位者=docShape（fillDoc/setDocPosition/applyRecordToYMap——两咽喉单源）。 */
const ALLOW_FILES = new Set([
  // O0a-1（Spec B）：fillDoc/applyRecordToYMap/setDocPosition 收编 docShape 单源——position 子 Map 构造随函数迁移
  'packages/shared/src/canvas/docShape.ts',
]);

describe('信封序列化门禁（R1a——防手抄本复活）', () => {
  it('扫描面非空自证（四目录都有文件；关键模块在位）', () => {
    const files = SCAN_DIRS.flatMap(listTsFiles);
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.includes('ydocBuilder'))).toBe(true);
    expect(files.some((f) => f.includes('doc-like.util'))).toBe(true);  // O0a-2 起 api 侧适配物（node-doc.util 整删）
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

  it('doc 读写两咽喉符号级（O0d）：readDocCanvas/writeNodeToYMap 在 web 生产面零命中（O0a-2 收编 shared docShape 单源后符号整删；api 侧同款断言=doc-shape-single-source.guard.spec.ts）', () => {
    const offenders: string[] = [];
    for (const file of listTsFiles(path.join(ROOT, 'apps/web/src'))) {
      if (/readDocCanvas|writeNodeToYMap/.test(readFileSync(file, 'utf8'))) {
        offenders.push(path.relative(ROOT, file).split(path.sep).join('/'));
      }
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
