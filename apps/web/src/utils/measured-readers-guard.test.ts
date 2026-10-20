// apps/web/src/utils/measured-readers-guard.test.ts
// B7-1（Spec B 终裁 84+91）：measured 读者集合相等断言——apps/web/src（排除 *.test.*/*.spec.*/
// test/）.measured 命中逐行 ≡ 三列分类表（本文件内嵌=C0-3 表 B7-1 对账版），新增即红。
//
// A/B 表头判据句（终裁 92）：A=值参与投影布局（doc wh 权威——三档链 n.width ?? m?.width ?? 常量）/
// B=值只影响屏幕像素（measured 权威禁进投影；RF internals internalNode.measured=公开 API）。
// B7-1 对账基线（2026-10-03 实测 vs C0-3 冻结表 40 行/14 文件）：
//   - C 类 3 行（canvasStore:792-794 拖拽 clamp）随 Inner 化批去闸门删除——表内注销；
//   - B 类 +6 行：groups/addOutput.ts（B6-2/B6-3 新建 +号输出按钮/批量连线纯函数层——
//     屏幕空间 UI[+号锚框/源锚点/落点命中]，三档链形态[width 第一档]——固化窗口期无跳变）；
//   - 终态=43 行/15 文件（A 18 + B 25；总数由表推导禁独立写死）。
//   - Y0b-4 T12：B 类 +2 行——RemoteCursors selection 高亮层（presence 节点框 overlay，屏幕空间
//     可化不进投影；三档链 width 第一档=addOutput 同款）；终态=45 行/16 文件（A 18 + B 27）。
// A 形态断言（终裁 91+第二十六轮拆域）：每 A 行必含 ?? 链且链首=普通字段（首 `??` 先于首
// `.measured`——抓"分类 A 却 measured 优先"）；B 类 internalNode/node.measured 直读豁免不受
// 链形约束（样板=TextNodeToolbar:171/ImageNodeToolbar:363，防实现者"补链"）。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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
const WEB_SRC = join(REPO_ROOT, 'apps/web/src');

/** 三列分类表（B7-1 对账终态——file[相对 apps/web/src] → line[] → 类别；改动 .measured 行必须同批改本表）。 */
const CLASSIFICATION: Record<'A' | 'B', Record<string, number[]>> = {
  A: {
    // 派生/布局/复制（doc wh 权威）=18 行：canvasStore 复制/落位族 13 + GroupNode 2 +
    // handleMenu 2 + product-node 1
    // Y0b-2 T7：writeFrozen 字段两处插入（interface +3/初始值 +1）——canvasStore 13 行 +4；
    // GroupToolbar canExecute prop（interface +2）——81,82→83,84；ImageGenNode import +3——160,161→163,164
    // Y0b-3 T9：collabEscapePending 字段两处插入（interface +4/初始值 +1）——canvasStore 13 行再 +5（行号漂移）
    // Y0b-4 T5：doc-status 快照族字段两处插入（interface +16/初始值 +10——本表 13 行 +25）
    // Y0b-4 T10：分块粘贴块工具族插入（assembleRecords 后 +68——本表 13 行同步漂移，集合不变）
    // Y0b-4 T11 存量漂移修复+登记：f709b5fb（T10 toast 动态容量/软阈单源）改 canvasStore 未同步本表
    //（+13 漂移——T11 全量回归暴露）；本批 wsQuotaTerminal 字段两处插入（interface +4/初始值 +1）再 +5
    // Y0b-4 T13：applyQuotaWatermark 单写者 action 两处插入（interface +4/实现 +3——实现在 1701 之后，
    // 本表 13 行仅 interface 段 +4 漂移，集合不变）
    // Y0b-5 T4：localCacheReady/readyProbeHint 字段两处插入（interface +9/初始值 +2）——13 行整体 +11 漂移
    // Y0b-5 T6：横幅单链字段族两处插入（interface +20/初始值 +6——本表 13 行整体再 +20 漂移，集合不变）
    // Y0b-5 T8：pendingBacklog 字段两处插入（interface +4/初始值 +1——本表 13 行整体再 +4 漂移，集合不变）
    'stores/canvasStore.ts': [912, 913, 919, 920, 975, 976, 1045, 1046, 1052, 1053, 1199, 1739, 1740],
    'pages/canvas/components/groups/GroupNode.tsx': [21, 22],
    'utils/handleMenu.ts': [49, 50],
    'pages/canvas/video-editor/export/product-node.ts': [15],
  },
  B: {
    // 屏幕空间 UI+RF internals（measured 权威禁进投影）=27 行：六 Toolbar 12 + ImageGen setCenter 2 +
    // Banner setCenter 2 + VideoGen 落位 1 + TextInput 盒镜像 2 + addOutput 6（B6-2 屏幕空间 +号/连线）+
    // RemoteCursors 2（Y0b-4 T12 selection 高亮层——presence 节点框 overlay 不进投影，width 第一档三档链）
    'pages/canvas/components/groups/GroupToolbar.tsx': [83, 84],
    'pages/canvas/components/nodes/AnnotationToolbar.tsx': [117, 118],
    'pages/canvas/components/nodes/EditToolbar.tsx': [301, 302],
    'pages/canvas/components/nodes/ImageNodeToolbar.tsx': [363, 364],
    'pages/canvas/components/nodes/TextNodeToolbar.tsx': [166, 171],
    'pages/canvas/components/nodes/TransformToolbar.tsx': [94, 95],
    'pages/canvas/components/nodes/ImageGenNode.tsx': [165, 166], // Y0b-2 T6：旧手势 id 记忆 ref 两行删除+3（搬运=重审）；T7：import +3——160,161→163,164；Y0b-5 T6：unloadGuard import +1——→164,165；Y1a+Y1b T6③：toFlowaiUrl import +1——→165,166
    'pages/canvas/components/CanvasReferenceSelectBanner.tsx': [32, 33],
    'pages/canvas/components/nodes/VideoGenNode.tsx': [399],   // Y1a+Y1b T6③：toFlowaiUrl import +1——398→399
    'pages/canvas/components/nodes/TextInputNode.tsx': [31, 32],
    'pages/canvas/components/groups/addOutput.ts': [79, 80, 137, 138, 198, 199],
    'pages/canvas/components/RemoteCursors.tsx': [26, 27],   // Y0b-4 T12 E38：selection 高亮层（overlay 屏幕空间）
  },
};

/** 扫描面自证非空+收集命中（file 相对路径:行号 → 行文本）。 */
function scanMeasuredHits(): Map<string, string> {
  const hits = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === 'test' || entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walk(join(dir, entry.name));
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name) || /\.(test|spec)\./.test(entry.name)) continue;
      const full = join(dir, entry.name);
      const rel = full.slice(WEB_SRC.length + 1).split('\\').join('/');
      readFileSync(full, 'utf8').split('\n').forEach((raw, i) => {
        const t = raw.trim();
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return; // 注释行不入计数
        if (raw.includes('.measured')) hits.set(`${rel}:${i + 1}`, raw);
      });
    }
  };
  walk(WEB_SRC);
  return hits;
}

describe('B7-1 census：measured 读者集合相等断言（终裁 84——命中逐行≡分类表，新增即红）', () => {
  it('扫描面非空自证 + 命中集合 ≡ 三列分类表（45 行/16 文件=表推导：A 18+B 27）', () => {
    const hits = scanMeasuredHits();
    expect(hits.size).toBeGreaterThan(0);   // 扫描面非空自证（防路径漂移恒绿）
    const expected = new Set<string>();
    let expectedCount = 0;
    for (const cls of ['A', 'B'] as const) {
      for (const [file, lines] of Object.entries(CLASSIFICATION[cls])) {
        for (const ln of lines) { expected.add(`${file}:${ln}`); expectedCount += 1; }
      }
    }
    const unexpected = [...hits.keys()].filter((k) => !expected.has(k));
    const missing = [...expected].filter((k) => !hits.has(k));
    expect(
      { unexpected, missing, hitCount: hits.size, expectedCount },
      '新增 .measured 读者须同批入表（并判 A/B 类）；表内行被移动/删除须同批改表',
    ).toEqual({ unexpected: [], missing: [], hitCount: expectedCount, expectedCount });
  });

  it('A 形态断言（终裁 91）：每 A 类行含 ?? 链且链首=普通字段——首 `??` 先于首 `.measured`（抓 measured 优先）', () => {
    const hits = scanMeasuredHits();
    const violations: string[] = [];
    for (const [file, lines] of Object.entries(CLASSIFICATION.A)) {
      for (const ln of lines) {
        const line = hits.get(`${file}:${ln}`);
        if (line == null) continue;   // 缺行由集合相等断言报
        const q = line.indexOf('??');
        const m = line.indexOf('.measured');
        if (q < 0 || m < 0 || q > m) violations.push(`${file}:${ln}: ${line.trim()}`);
      }
    }
    expect(violations, `A 类行链首不得是 .measured（三档链 doc wh 第一档）：\n${violations.join('\n')}`).toEqual([]);
  });

  it('B 类直读豁免样板在表（internalNode.measured 直读不受链形约束——防实现者"补链"）', () => {
    const hits = scanMeasuredHits();
    // 样板行（终裁 91 点名）：B 类 internalNode.measured 直读合法——不得为过 A 形态断言而"补链"
    expect(hits.get('pages/canvas/components/nodes/TextNodeToolbar.tsx:171')?.trim())
      .toBe('const { width: nodeWidth, height: nodeHeight } = internalNode.measured;');
    expect(hits.get('pages/canvas/components/nodes/ImageNodeToolbar.tsx:363')?.trim())
      .toBe('const nodeWidth = internalNode?.measured?.width;');
  });
});
