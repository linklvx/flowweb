// 批7 双客户端 E2E 发布门禁（collab 断连恢复——spec v5.10 目标 8 链路）。
// 装置：双 browser context（collab-a OWNER / collab-b MEMBER 各自 storageState）+ gate 控制面
// （scripts/gate-collab.mjs 自拉 API：COLLAB_FAKE_AI=1 + COLLAB_SWEEP_ENABLED=true）。
// 前置：必须经 `node scripts/gate-collab.mjs` 运行（playwright webServer 自起的 API 杀不掉——
// 直跑时 killApi/startApi 会因控制面缺失而报错，这是有意设计）。
// 判据源：master plan 批7 行 + collab-e2e-gate-checklist.md 历史底稿归并节；串行执行（config workers:1）。
import { test, expect, type Page } from '@playwright/test';
import {
  COLLAB_GATE,
  killApi,
  startApi,
  dbTool,
  openCanvasConnected,
  expectConnected,
  waitForDisconnected,
  addNodeViaMenu,
  nodeCount,
  expectNodeCount,
  enqueueExecution,
  expectNodeLoading,
  expectNodeNotLoading,
} from './collab-helpers';

const STATE_A = 'e2e/.auth/collab-a.json';
const STATE_B = 'e2e/.auth/collab-b.json';
const PROJECT = COLLAB_GATE.projectId;

/** AuthModal 邮箱登录（global-setup 同款流程）——S4 重登复用 */
async function loginViaAuthModal(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: '邮箱登录' }).click();
  await page.getByPlaceholder('邮箱').fill(email);
  await page.getByPlaceholder('密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByTestId('auth-modal-backdrop')).toBeHidden({ timeout: 15_000 });
}

async function currentNodeIds(page: Page): Promise<string[]> {
  return page.locator('.react-flow__node').evaluateAll((els) =>
    els.map((e) => (e as HTMLElement).dataset.id ?? '').filter(Boolean),
  );
}

/** 等待出现一个不在 known 集合内的新节点（协作同步到达判据），返回其 id */
async function waitForNewNode(page: Page, known: string[], timeout = 20_000): Promise<string> {
  let newId = '';
  await expect.poll(async () => {
    const ids = await currentNodeIds(page);
    newId = ids.find((id) => !known.includes(id)) ?? '';
    return newId;
  }, { timeout, message: '新节点未在窗口内到达' }).toBeTruthy();
  return newId;
}

test.beforeEach(async () => {
  // 上一个杀 API 的用例异常退出时的安全网：控制面确认 API 存活（不在则拉起）
  const res = await fetch(`${process.env.COLLAB_E2E_API_CONTROL ?? 'http://127.0.0.1:3100'}/status`);
  const { up } = await res.json();
  if (!up) await startApi();
});

// ── 场景 1：杀 API → 双端自动恢复 + 断连期 A 编辑到达 B ──────────────────────
test('S1 杀 API→双端零刷新自动恢复 connected，断连期 A 编辑经重启同步到 B', async ({ browser }) => {
  const ctxA = await browser.newContext({ storageState: STATE_A });
  const ctxB = await browser.newContext({ storageState: STATE_B });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  await openCanvasConnected(pageA, PROJECT);
  await openCanvasConnected(pageB, PROJECT);
  const base = await nodeCount(pageA);
  expect(await nodeCount(pageB)).toBe(base); // 双端基线一致

  await killApi();
  await waitForDisconnected(pageA); // offline/connecting——不允许停留在已连接
  await waitForDisconnected(pageB);

  // 断连期 A 加节点（失联非阻断——本地 doc 挂起更新）
  await addNodeViaMenu(pageA, '文本');
  await expectNodeCount(pageA, base + 1, 10_000);

  await startApi();
  await expectConnected(pageA); // 零刷新自动恢复（R1 症状根修判据）
  await expectConnected(pageB);

  // B 无需刷新即见 A 断连期编辑（L19：A 挂起更新随重连上送→服务端广播）
  await expectNodeCount(pageB, base + 1, 30_000);
  await ctxA.close();
  await ctxB.close();
});

// ── 场景 2：断连期双端编辑 → 重连合并（双向） ────────────────────────────────
test('S2 断连窗口 A/B 各自加节点→恢复后两端均见对方编辑', async ({ browser }) => {
  const ctxA = await browser.newContext({ storageState: STATE_A });
  const ctxB = await browser.newContext({ storageState: STATE_B });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  await openCanvasConnected(pageA, PROJECT);
  await openCanvasConnected(pageB, PROJECT);
  const base = await nodeCount(pageA);

  await killApi();
  await waitForDisconnected(pageA);
  await addNodeViaMenu(pageA, '文本'); // A 断连期编辑
  await expectNodeCount(pageA, base + 1, 10_000);
  await addNodeViaMenu(pageB, '文本'); // B 断连期编辑（同一断连窗口）
  await expectNodeCount(pageB, base + 1, 10_000);

  await startApi();
  await expectConnected(pageA);
  await expectConnected(pageB);

  // 双向合并：两端最终一致（L19 双向——各自挂起更新均上送）
  await expectNodeCount(pageA, base + 2, 30_000);
  await expectNodeCount(pageB, base + 2, 30_000);
  await ctxA.close();
  await ctxB.close();
});

// ── 场景 3：AI 执行态对齐（fake AI）─────────────────────────────────────────
// 3a 完成路径：loading 经 exec map 到达 B → fake 完成 → B 收敛；
// 3b 中断路径：外呼在飞时杀 API → 重启 → BullMQ stalled 重排（同 jobId 可重入 claim）→
//    节点在窗口内退出 loading——「不永转圈」的强判据（≤150s，含 60s 锁恢复 + 30s stalled 扫描）。
test('S3 AI 执行态对齐：loading 双端可见→完成收敛；外呼中断→重启后 stalled 重跑不永转圈', async ({ browser }) => {
  test.setTimeout(360_000);
  const ctxA = await browser.newContext({ storageState: STATE_A });
  const ctxB = await browser.newContext({ storageState: STATE_B });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  await openCanvasConnected(pageA, PROJECT);
  await openCanvasConnected(pageB, PROJECT);
  const known = await currentNodeIds(pageA);

  // 图片节点（ImageGenNode 有可见 loading 投影「⏳ 生成中...」）；选中后配置面板自动落模型
  await addNodeViaMenu(pageA, '图片');
  const nodeId = await waitForNewNode(pageA, known);
  await pageA.locator(`.react-flow__node[data-id="${nodeId}"]`).click();
  await expect(pageA.getByTestId('canvas-node-image-model-select')).toBeVisible({ timeout: 10_000 });
  // settle：面板可见 ≠ model 已落 doc（fetchModels→applyNodeDataPatch 异步）——enqueue 早于补丁
  // 会让服务端 validation 静默拒（"模型不存在"，无 loading 窗口——探针对比实证）
  await pageA.waitForTimeout(1_000);

  // 3a 完成路径：enqueue（真实链路 enqueue→BullMQ→execute→exec map/doc）→ B 见 loading → 收敛
  const jobId = await enqueueExecution(pageA, PROJECT, nodeId);
  try {
    await expectNodeLoading(pageB, nodeId);
  } catch (e) {
    // 现场转储（失败诊断——B/A 节点实时文本 + 意图行 + jobId）
    const dump = async (tag: string, p: Page) => p.locator(`.react-flow__node[data-id="${nodeId}"]`)
      .evaluate((el) => (el.textContent ?? '').slice(0, 120))
      .catch((err) => `evaluate-failed: ${err.message}`);
    console.log(`[S3-diag] jobId=${jobId} intent=${JSON.stringify(latestIntentStatus(PROJECT, nodeId))}`);
    console.log(`[S3-diag] B-node="${await dump('B', pageB)}"`);
    console.log(`[S3-diag] A-node="${await dump('A', pageA)}"`);
    throw e;
  }
  await expectNodeNotLoading(pageB, nodeId, 30_000);
  await expectNodeNotLoading(pageA, nodeId, 30_000); // 双端对齐（完成收敛）

  // 3b 中断路径：**新图片节点**再发起——同一节点复用会被 exec map 终态防倒退吞掉 loading
  // （批0.5-5 设计："迟到 loading 不倒退终态"——新执行在该节点上 loading 不可见，换节点才是
  // 真实"再次发起"链路）→ loading 在飞 → 杀 API → 重启 → stalled 重跑收敛
  const known2 = await currentNodeIds(pageA);
  await addNodeViaMenu(pageA, '图片');
  const nodeId2 = await waitForNewNode(pageA, known2);
  await pageA.locator(`.react-flow__node[data-id="${nodeId2}"]`).click();
  await expect(pageA.getByTestId('canvas-node-image-model-select')).toBeVisible({ timeout: 10_000 });
  await pageA.waitForTimeout(1_000); // settle：model 补丁落 doc（同 3a）
  await enqueueExecution(pageA, PROJECT, nodeId2);
  await expectNodeLoading(pageB, nodeId2);
  await pageA.waitForTimeout(300); // 稳定进入外呼在飞窗口（fake 延迟 1.5~2s）
  await killApi();
  await startApi();
  await expectConnected(pageA);
  await expectConnected(pageB);
  // 重启后意图仍在飞（未被误判终态）——stalled 重排的输入
  const intent = dbTool('intent-status', PROJECT, nodeId2);
  expect(['RUNNING', 'SUCCEEDED']).toContain(intent.status); // SUCCEEDED=杀慢了已完成（收敛判据仍有效）
  await expectNodeNotLoading(pageB, nodeId2, 150_000); // 不永转圈（stalled 重跑 → fake → done）
  await expectNodeNotLoading(pageA, nodeId2, 30_000);
  await ctxA.close();
  await ctxB.close();
});

// ── 场景 5：VIEWER 只读（零 doc 写）─────────────────────────────────────────
test('S5 VIEWER 角色：B 加节点被回弹（零 doc 写——A 不可见 + B 刷新后消失）', async ({ browser }) => {
  dbTool('set-viewer', COLLAB_GATE.bEmail, PROJECT);
  try {
    const ctxA = await browser.newContext({ storageState: STATE_A });
    const ctxB = await browser.newContext({ storageState: STATE_B });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await openCanvasConnected(pageA, PROJECT);
    await openCanvasConnected(pageB, PROJECT); // VIEWER 也 hydration ready（只读会话）
    const base = await nodeCount(pageA);

    // B（VIEWER）尝试加节点——dispatch 前置 canEdit=false ⇒ doc 零写
    await addNodeViaMenu(pageB, '文本');
    await pageB.waitForTimeout(3_000);

    // 判据①：EDITOR 端（A）全程不见该节点（doc 从未收到写）
    await expect.poll(async () => nodeCount(pageA), { timeout: 5_000 }).toBe(base);
    // 判据②：B 刷新后本地幻影消失（store 重建自 doc——doc 无此节点）
    await pageB.reload();
    await expect(pageB.locator('.react-flow')).toBeVisible({ timeout: 20_000 });
    await expectConnected(pageB);
    await expect.poll(async () => nodeCount(pageB), { timeout: 10_000 }).toBe(base);
    await ctxA.close();
    await ctxB.close();
  } finally {
    dbTool('clear-viewer', COLLAB_GATE.bEmail, PROJECT); // 复位团队角色（后续用例依赖 B 可编辑）
  }
});

// ── 场景 6：新建画布刷新仍在（R5 终验）───────────────────────────────────────
test('S6 新建画布→加节点→刷新：项目指针与编辑均在', async ({ browser }) => {
  const ctxA = await browser.newContext({ storageState: STATE_A });
  const pageA = await ctxA.newPage();
  await pageA.goto('/canvas'); // 无参路径——自动新建项目（openSession 漏斗）
  await expect(pageA.locator('.react-flow')).toBeVisible({ timeout: 20_000 });
  await expectConnected(pageA);

  const storedId = await pageA.evaluate(() => localStorage.getItem('flowweb_projectId'));
  expect(storedId).toBeTruthy();

  await addNodeViaMenu(pageA, '文本');
  await expectNodeCount(pageA, 1, 10_000);

  await pageA.reload(); // 刷新＝R5 蒸发路径的终验
  await expect(pageA.locator('.react-flow')).toBeVisible({ timeout: 20_000 });
  await expectConnected(pageA);
  await expectNodeCount(pageA, 1, 15_000); // 编辑仍在
  const storedIdAfter = await pageA.evaluate(() => localStorage.getItem('flowweb_projectId'));
  expect(storedIdAfter).toBe(storedId); // 指针未被散射（F14）
  await ctxA.close();
});

// ── 场景 7：编辑器打开杀 API → 保存失败可见 → 重启手动重试恢复 ────────────────
test('S7 编辑器打开→杀 API→编辑触保存失败（红点可见）→重启重试回已保存', async ({ browser }) => {
  const ctxA = await browser.newContext({ storageState: STATE_A });
  const pageA = await ctxA.newPage();
  await openCanvasConnected(pageA, PROJECT);
  const known = await currentNodeIds(pageA);

  await addNodeViaMenu(pageA, '多轨道剪辑');
  const nodeId = await waitForNewNode(pageA, known);
  await pageA.locator(`.react-flow__node[data-id="${nodeId}"]`).getByRole('button', { name: /全屏编辑/ }).click();
  await expect(pageA.getByTestId('video-editor-shell')).toBeVisible({ timeout: 20_000 });
  const dot = pageA.getByTestId('save-state-dot');
  await expect(dot).toHaveAttribute('title', '已保存', { timeout: 20_000 }); // upsert+load 完成基线

  await killApi();
  // 编辑（改画布比例→data 变更）→ autosave PATCH 失败 → 红点（编辑器层"横幅"——批6 SyncBanner 前的唯一可见信号）。
  // antd Dropdown 弹层 menu 无可访问名——直接按 menuitem 名锚定（S7 首跑实证：getByRole('menu',{name}) 空匹配）
  await pageA.getByTestId('aspect-ratio-button').click();
  await pageA.getByRole('menuitem', { name: '9:16（1080×1920）' }).click();
  await expect(dot).toHaveAttribute('title', '保存失败，点击重试', { timeout: 20_000 });

  await startApi();
  await dot.click(); // 手动重试（retry 补发当前 data）
  await expect(dot).toHaveAttribute('title', '已保存', { timeout: 30_000 });
  await pageA.getByRole('button', { name: '收起' }).click(); // 干净收起（latch 已清——无三选弹层）
  await expect(pageA.getByTestId('video-editor-shell')).toBeHidden({ timeout: 10_000 });
  await ctxA.close();
});

// ── 场景 8：routeWebSocket 传输级掐断 → 离线编辑 → 恢复后内容仍在 ─────────────
test('S8 routeWebSocket 掐断→离线编辑→恢复：内容仍在且回已连接', async ({ browser }) => {
  const ctxA = await browser.newContext({ storageState: STATE_A });
  // 透明管道：默认双向转发（connectToServer 后不挂 onMessage 即自动转发）；保留当前连接句柄供掐断
  let currentWs: { close: (o?: { code?: number; reason?: string }) => Promise<void> } | null = null;
  await ctxA.routeWebSocket(/\/collab/, (ws) => {
    currentWs = ws as any;
    (ws as any).connectToServer();
  });
  const pageA = await ctxA.newPage();
  await openCanvasConnected(pageA, PROJECT); // 管道透传下正常连通（判据前提）
  const base = await nodeCount(pageA);

  await currentWs!.close({ code: 1006, reason: 'e2e-cut' }); // 掐断页面侧 WS（网络级断连）
  await waitForDisconnected(pageA, 15_000);

  await addNodeViaMenu(pageA, '文本'); // 断连窗口离线编辑
  await expectNodeCount(pageA, base + 1, 10_000);

  // 库自持重连：新建 WS 再次被路由→透传→恢复（传输级恢复原语）
  await expectConnected(pageA);
  await expectNodeCount(pageA, base + 1, 15_000); // 内容仍在

  // 持久化佐证：刷新后节点仍从服务端 doc 回放
  await pageA.reload();
  await expect(pageA.locator('.react-flow')).toBeVisible({ timeout: 20_000 });
  await expectConnected(pageA);
  await expectNodeCount(pageA, base + 1, 20_000);
  await ctxA.close();
});

// ── 场景 9：恢复风暴（10 并发 context 同项目）────────────────────────────────
// 在 S4 之前：S4 会作废 collab-a 的 storageState session（重登后自愈回写，但失败路径会级联）。
test('S9 恢复风暴：10 并发连接杀 API→重启→全部恢复 connected 且无 5xx', async ({ browser }) => {
  test.setTimeout(300_000);
  const contexts = await Promise.all(
    Array.from({ length: 10 }, () => browser.newContext({ storageState: STATE_A })),
  );
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  for (const p of pages) {
    await p.goto(`/canvas?projectId=${PROJECT}`);
    await expect(p.locator('.react-flow')).toBeVisible({ timeout: 45_000 });
  }
  for (const p of pages) await expectConnected(p); // 全员在线（服务端 10 连接同 doc）

  await killApi();
  for (const p of pages) await waitForDisconnected(p, 30_000);

  await startApi(); // 服务端重连突刺观测点（reconnect 风暴经 /logs 检查无异常）
  for (const p of pages) await expectConnected(p); // 全部恢复（120s 窗口含退避+jitter）

  // 无 5xx：每页健康探针 + 子进程日志无未捕获异常/端口占用
  for (const p of pages) {
    const status = await p.evaluate(async () => (await fetch('/api/health')).status);
    expect(status).toBeLessThan(500);
  }
  const logs = await (await fetch(`${process.env.COLLAB_E2E_API_CONTROL ?? 'http://127.0.0.1:3100'}/logs`)).text();
  expect(logs).not.toContain('UnhandledPromiseRejection');
  expect(logs).not.toContain('EADDRINUSE');
  await Promise.all(contexts.map((c) => c.close()));
});

// ── 场景 4：会话过期 → sweep 4401 → 重登回原画布（置于最末：作废 a 的 storageState——
//    成功路径重登后自愈回写；失败时不再级联后续用例）───────────────────────────
test('S4 会话过期→sweep 踢线→reload 引导登录→重登回原画布重连', async ({ browser }) => {
  test.setTimeout(300_000);
  const ctxA = await browser.newContext({ storageState: STATE_A });
  const pageA = await ctxA.newPage();
  const canvasUrl = `/canvas?projectId=${PROJECT}`;

  // 死线必须**连接前**置：sweep 快照（context.sessionExpiresAt）在 authenticate 时定格——
  // 连接后再改 DB 不影响快照（真协议诊断实证：连后续置永不触发；连前置 now+10s ⇒ 鉴权时仍有效
  // 可入 doc、快照死线 10s 后自然越界 ⇒ tick+复验+grace 内 close(4401)）。连接需在 10s 内完成
  // （正常 2-3s）。sweep 单测 mock 的 context 形态在真链路不可达——S4 是该链路首个真实回归锚
  dbTool('set-session-expiring', COLLAB_GATE.aEmail);
  await openCanvasConnected(pageA, PROJECT);

  // sweep：死线 10s 到达 + ≤60s tick + 复验 + 5s grace → close(4401)；重连 DENY 不再回已连接
  await waitForDisconnected(pageA, 150_000);

  // reload → RequireAuth me 401/null → /login?next=<原画布>（批2-3 redirect 矩阵）
  await pageA.goto(canvasUrl);
  await expect(pageA).toHaveURL(/\/login\?next=/, { timeout: 20_000 });
  const nextParam = new URL(pageA.url()).searchParams.get('next') ?? '';
  expect(decodeURIComponent(nextParam)).toBe(canvasUrl); // redirect 目标=原画布（白名单透传）

  // 重登（AuthModal 邮箱链路）→ 会话重建
  await loginViaAuthModal(pageA, COLLAB_GATE.aEmail, 'collab12345678');
  // 邮箱链路（@deprecated AuthModal）登录后无自动跳转（PhoneLoginForm 域）——手动回原画布；
  // next 参数正确性已由上方断言+loginRedirect 19 条矩阵单测覆盖（登记 checklist：LoginModal 替换时补自动跳转）
  await pageA.goto(canvasUrl);
  await expect(pageA).toHaveURL(new RegExp(`/canvas\\?projectId=${PROJECT}`), { timeout: 20_000 });
  await expectConnected(pageA); // 重登回原画布重连

  // 自愈 fixture：重登产生的新 session 回写 storageState（后续 gate 复跑继续可用）
  await ctxA.storageState({ path: STATE_A });
  await ctxA.close();
});
