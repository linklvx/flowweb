// Spec B B7-2 性能冒烟 nightly（500 节点/20 组——v3.16 终裁 58②+v3.17 终裁 68④ 数字冻结）。
// 装置：specb-gate-seed 的 specb-perf-canvas（20 auto 组×25 textInput 子=520 节点；子 abs 定位
// 含 1/8 格值——非整数坐标档）+ prod 构建探针 window.__specbPerf（URL ?perfProbe=1 显式 opt-in，
// specbPerfProbe.ts——store/reconcile/getDoc 同源模块引用）。
// 四锚（预算=命名常量，首次测量→固化）：
//   ① 首开固化单批 N=500：goto→520 节点渲染+已连接 的墙钟预算（端到端口径：连接+快照+hydrate+reconcile+渲染）
//   ② reconcile 单次≤5ms：page 上下文直呼 reconcileGroupGeometry(doc,'doc')×20 取 max（稳态零差异遍历成本）
//   ③ 零差异⇒订阅回调=0：稳态 reconcile 一次，store.subscribe 计数=0（全表零差异⇒零 setState 锚）
//   ④ 拖拽帧 p95≤16ms：60Hz 节拍合成拖拽期间的 rAF 帧间隔 p95——预算=max(16, 空转基线+1)：
//      冻结数字 16=无节流环境（rAF 不限频时 p95 即纯处理成本）的硬预算；vsync 量化环境（headless
//      60Hz BeginFrame——空转基线 16.67ms）按基线+1ms 容差（健康=vsync 锁相，病态=掉帧 33ms+ 必红）。
//      两环境都以「p95 不显著高于空转」为判据心——超标处置（plan 冻结）：先证伪零差异短路、再谈脏域。
import { test, expect } from '@playwright/test';

const PERF_PROJECT = 'specb-perf-canvas';
const NODE_TOTAL = 520; // 20 组 + 500 子

/** 首开固化单批预算（首次实测→固化：2026-10-03 本地首跑实测 2520ms——固化 15s≈6× 余量容纳 nightly
 *  CI 慢机；超标处置=先证伪零差异短路、再谈脏域——脏域优化不做） */
const FIRST_OPEN_BUDGET_MS = 15_000;
/** reconcile 单次预算（数字冻结 v3.16 终裁 58②） */
const RECONCILE_BUDGET_MS = 5;
/** 拖拽帧 p95 预算下限（数字冻结——无节流环境硬预算；vsync 环境按空转基线+1ms） */
const DRAG_FRAME_P95_BUDGET_MS = 16;

test.beforeEach(async () => {
  const res = await fetch(`${process.env.COLLAB_E2E_API_CONTROL ?? 'http://127.0.0.1:3100'}/status`);
  const { up } = await res.json();
  if (!up) throw new Error('gate 控制面 API 不在线——本 spec 必须经 scripts/gate-collab.mjs 运行');
});

test('perf 500 节点/20 组：首开预算+reconcile≤5ms+零差异订阅=0+拖拽帧 p95', async ({ browser }) => {
  test.setTimeout(300_000);
  const ctxA = await browser.newContext({ storageState: 'e2e/.auth/collab-a.json' });
  const pageA = await ctxA.newPage();

  // ① 首开固化单批（墙钟：goto→520 节点+已连接）
  const t0 = Date.now();
  await pageA.goto(`/canvas?projectId=${PERF_PROJECT}&perfProbe=1`);
  await expect(pageA.locator('.react-flow__node')).toHaveCount(NODE_TOTAL, { timeout: FIRST_OPEN_BUDGET_MS });
  await expect(pageA.getByText('已连接').first()).toBeVisible({ timeout: 30_000 });
  const firstOpenMs = Date.now() - t0;
  console.log(`[specb-perf] 首开固化单批 N=${NODE_TOTAL}: ${firstOpenMs}ms（预算 ${FIRST_OPEN_BUDGET_MS}ms）`);

  // 探针在场自证（prod 构建——?perfProbe=1 门控）
  const hasProbe = await pageA.evaluate(() => typeof (window as any).__specbPerf === 'object');
  expect(hasProbe, 'window.__specbPerf 探针未挂载（?perfProbe=1 门控失效）').toBe(true);

  // ② reconcile 单次≤5ms + ③ 零差异⇒订阅回调=0
  const { reconcileMaxMs, zeroDiffNotifications } = await pageA.evaluate(() => {
    const probe = (window as any).__specbPerf as {
      store: { subscribe: (fn: () => void) => () => void };
      getDoc: () => unknown;
      reconcile: (d: unknown, s: 'doc') => void;
    };
    const doc = probe.getDoc();
    probe.reconcile(doc, 'doc'); // 预热（JIT/隐藏层首遍）
    probe.reconcile(doc, 'doc');
    let notifications = 0;
    const un = probe.store.subscribe(() => { notifications++; });
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      probe.reconcile(doc, 'doc');
      samples.push(performance.now() - t);
    }
    un();
    return {
      reconcileMaxMs: Math.max(...samples),
      zeroDiffNotifications: notifications, // ③ 期望 0——20 次稳态零差异 reconcile 零订阅回调
    };
  });
  console.log(`[specb-perf] reconcile max: ${reconcileMaxMs.toFixed(3)}ms（预算 ${RECONCILE_BUDGET_MS}ms）；零差异订阅回调=${zeroDiffNotifications}`);
  expect(reconcileMaxMs, 'reconcile 单次超 5ms（先证伪零差异短路，再谈脏域——脏域优化不做）').toBeLessThanOrEqual(RECONCILE_BUDGET_MS);
  expect(zeroDiffNotifications, '零差异 reconcile 不得触发订阅回调（全表零差异⇒零 setState）').toBe(0);

  // ④ 拖拽帧 p95：先采空转基线，再 60Hz 节拍合成拖拽
  const collectIdleP95 = () => pageA.evaluate(() => new Promise<number>((resolve) => {
    const frames: number[] = [];
    const rec = (t: number) => {
      frames.push(t);
      if (frames.length < 90) requestAnimationFrame(rec);
      else {
        const d: number[] = [];
        for (let i = 1; i < frames.length; i++) d.push(frames[i] - frames[i - 1]);
        d.sort((a, b) => a - b);
        resolve(d[Math.floor(d.length * 0.95)]);
      }
    };
    requestAnimationFrame(rec);
  }));
  const idleP95 = await collectIdleP95();

  await pageA.evaluate(() => {
    (window as any).__specbPerfFrames = [];
    const rec = (t: number) => {
      (window as any).__specbPerfFrames.push(t);
      if ((window as any).__specbPerfFrames.length < 600) requestAnimationFrame(rec);
    };
    requestAnimationFrame(rec);
  });
  const dragTarget = pageA.locator('.react-flow__node[data-id="pc0-0"]');
  const box = await dragTarget.boundingBox();
  expect(box, 'perf 夹具首子节点不可见（viewport 未覆盖 pc0-0）').toBeTruthy();
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;
  await pageA.mouse.move(cx, cy);
  await pageA.mouse.down();
  for (let i = 1; i <= 40; i++) {
    await pageA.mouse.move(cx + (73.125 * i) / 40, cy + (41.375 * i) / 40);
    await pageA.waitForTimeout(16); // ~60Hz 输入节拍（真实拖拽节奏）
  }
  await pageA.mouse.up();

  const dragP95 = await pageA.evaluate(() => {
    const f: number[] = (window as any).__specbPerfFrames;
    const d: number[] = [];
    for (let i = 1; i < f.length; i++) d.push(f[i] - f[i - 1]);
    d.sort((a, b) => a - b);
    return d[Math.floor(d.length * 0.95)];
  });
  const budget = Math.max(DRAG_FRAME_P95_BUDGET_MS, idleP95 + 1);
  console.log(`[specb-perf] 拖拽帧 p95: ${dragP95.toFixed(2)}ms（空转基线 p95 ${idleP95.toFixed(2)}ms；预算 ${budget.toFixed(2)}ms）`);
  expect(dragP95, `拖拽帧 p95 超预算（掉帧——先证伪零差异短路再谈脏域）`).toBeLessThanOrEqual(budget);

  await ctxA.close();
});
