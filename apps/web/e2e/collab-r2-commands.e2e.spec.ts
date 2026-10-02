// R2 批尾双端脚本化回归（plan 2d-8 Step 4b——每分片批尾人肉双标签页手测升级为持久回归资产）：
// R2 命令链（A 端经真实 UI 驱动）→ B 端逐命令收敛断言 → A undo 一步 → B 回滚断言；
// 外加 B 端 duplicateGroup（跨端复制 + getId 防碰撞——B 写 doc 回灌 A）。
// 装置与 collab-recovery 同款：双 browser context（storageState）+ gate 控制面（必须经
// `node scripts/gate-collab.mjs` 运行）。判据全部走 DOM 投影（recovery 既有收敛口径）：
// 节点数（.react-flow__node）/ 节点 transform（rel 位置）/ 组框 border（data.color 唯一投影）/
// 折叠卡（collapsed 分支唯一渲染体）。
// 画布隔离：每用例 A 经 /canvas 无参路径新建项目（page.tsx openSession 漏斗，teamId=默认团队
// →B 以 MEMBER 同权访问），doc 从零开始——不与 collab-gate-canvas 共画布，零清理协调。
import { test, expect, type Page } from '@playwright/test';
import { COLLAB_GATE, expectConnected, addNodeViaMenu, nodeCount } from './collab-helpers';

const STATE_A = 'e2e/.auth/collab-a.json';
const STATE_B = 'e2e/.auth/collab-b.json';

/** 节点数精确收敛（本 spec 有 hidden/删除方向的计数变化——helpers 的 ≥n 口径不够用） */
function expectCountIs(page: Page, n: number, timeout = 30_000) {
  return expect.poll(() => nodeCount(page), { timeout, message: `节点数未收敛到 ${n}` }).toBe(n);
}

async function currentNodeIds(page: Page): Promise<string[]> {
  return page.locator('.react-flow__node').evaluateAll((els) =>
    els.map((e) => (e as HTMLElement).dataset.id ?? '').filter(Boolean),
  );
}

/** 节点 rel 位置（react-flow 包裹层 transform=translate(x px, y px)——doc 同值则两端字符串全等） */
function nodeTransform(page: Page, nodeId: string): Promise<string> {
  return page.locator(`.react-flow__node[data-id="${nodeId}"]`).evaluate((el) => el.style.transform);
}

/** 组框 border 内联样式（NormalGroupRenderer 唯一色投影：1px solid var(--canvas-group-color-<key>)） */
function groupBoxBorder(page: Page, groupId: string): Promise<string> {
  return page.locator(`.react-flow__node[data-id="${groupId}"] [data-testid="group-box"]`)
    .evaluate((el) => el.style.border);
}

function collapsedCard(page: Page, groupId: string) {
  return page.locator(`.react-flow__node[data-id="${groupId}"] [data-testid="collapsed-preview-card"]`);
}

/** 空白 pane 点（节点群左下方，避开 FAB x≤77/顶栏/底部工具条）——点掉 RF NodesSelection 残留框 */
const PANE_BLANK = { x: 180, y: 600 };

/** 框选多选（selectionOnDrag——左键在 pane 拖出选择框，Partial 模式部分相交即选中），
 *  锚定首个节点 bbox 外扩 */
async function marqueeSelectAllNodes(page: Page): Promise<void> {
  const box = await page.locator('.react-flow__node').first().boundingBox();
  if (!box) throw new Error('画布上无节点可框选');
  const start = { x: box.x - 120, y: box.y - 100 };
  const end = { x: box.x + box.width + 120, y: box.y + box.height + 30 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 5 });
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('selection-box')).toBeVisible({ timeout: 10_000 });
}

/** 单选组节点（先点空白 pane 清 RF NodesSelection 残留框——其 z 层压过节点且打组后不自动消失，
 *  不清则后续节点点击全部被 intercept；再点组节点 title 带内左缘空白点——子节点 rel(20,50) 起
 *  与 +40 偏移副本均不覆盖该点，resize 手柄 8×8 只在四角），以 GroupToolbar 可见为完成信号 */
async function selectGroupAlone(page: Page, groupId: string): Promise<void> {
  await page.mouse.click(PANE_BLANK.x, PANE_BLANK.y);
  await page.locator(`.react-flow__node[data-id="${groupId}"]`).click({ position: { x: 15, y: 35 } });
  await expect(page.getByRole('button', { name: /排列子节点/ })).toBeVisible({ timeout: 10_000 });
}

/** A 端建组（真实 UI 链路：加 2 文本节点 → 框选 → ⊞ 打组）：返回新组 id。
 *  收尾把组置为单选（工具条就绪）并确认 RF 打组禁用态已解除残留框 */
async function createGroupOfTwo(page: Page): Promise<string> {
  const before = await currentNodeIds(page);
  await addNodeViaMenu(page, '文本');
  await addNodeViaMenu(page, '文本');
  let childIds: string[] = [];
  await expect.poll(async () => {
    childIds = (await currentNodeIds(page)).filter((id) => !before.includes(id));
    return childIds.length;
  }, { timeout: 15_000, message: '两个文本节点未就绪' }).toBe(2);
  await marqueeSelectAllNodes(page);
  const groupBtn = page.getByRole('toolbar').getByRole('button', { name: /打组/ });
  await expect(groupBtn).toBeEnabled({ timeout: 10_000 }); // 框选混入组时打组禁用（守护断言）
  await groupBtn.click();
  await page.getByRole('menuitem', { name: '打组（Ctrl+G）' }).click();
  let groupId = '';
  await expect.poll(async () => {
    const ids = await currentNodeIds(page);
    groupId = ids.find((id) => !before.includes(id) && !childIds.includes(id)) ?? '';
    return groupId;
  }, { timeout: 15_000, message: '打组后新组节点未出现' }).toBeTruthy();
  await expectCountIs(page, before.length + 3);
  await selectGroupAlone(page, groupId);
  return groupId;
}

test.beforeEach(async () => {
  // 与 collab-recovery 同款安全网：控制面确认 API 存活（不在则拉起）
  const res = await fetch(`${process.env.COLLAB_E2E_API_CONTROL ?? 'http://127.0.0.1:3100'}/status`);
  const { up } = await res.json();
  if (!up) throw new Error('gate 控制面 API 不在线——本 spec 必须经 scripts/gate-collab.mjs 运行');
});

/** 双端开同一张全新画布：A 无参新建（teamId=默认团队），B 以 MEMBER 打开同项目 */
async function openFreshCanvas(pageA: Page, pageB: Page): Promise<string> {
  await pageA.goto('/canvas');
  await expect(pageA.locator('.react-flow')).toBeVisible({ timeout: 20_000 });
  await expectConnected(pageA);
  const projectId = await pageA.evaluate(() => localStorage.getItem('flowweb_projectId'));
  expect(projectId).toBeTruthy();
  await pageB.goto(`/canvas?projectId=${projectId}`);
  await expect(pageB.locator('.react-flow')).toBeVisible({ timeout: 20_000 });
  await expectConnected(pageB);
  expect(await nodeCount(pageA)).toBe(0); // 全新画布（零残留——用例间天然隔离）
  expect(await nodeCount(pageB)).toBe(0);
  return projectId!;
}

// ── 场景 1：A 命令链 → B 逐命令收敛；A undo 一步 → B 回滚 ─────────────────────
test('R2 命令链：A 建组→排列→创建副本→设色→折叠，B 逐命令收敛；A undo 一步→B 回滚', async ({ browser }) => {
  const ctxA = await browser.newContext({ storageState: STATE_A });
  const ctxB = await browser.newContext({ storageState: STATE_B });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  await openFreshCanvas(pageA, pageB);

  // 建组（addNode×2 各占一条 undo——其后 4 条 R2 命令各一条，共 6 条在栈）
  const groupId = await createGroupOfTwo(pageA);
  const childIds = (await currentNodeIds(pageA)).filter((id) => id !== groupId);
  expect(childIds).toHaveLength(2);
  // B 收敛：同组节点到达（doc 同 id）
  await expect(pageB.locator(`.react-flow__node[data-id="${groupId}"]`)).toBeVisible({ timeout: 30_000 });
  await expectCountIs(pageB, 3);

  // ① A 排列子节点（GroupToolbar ▾ → 网格）→ B 子节点 rel 位置收敛到与 A 全等
  const preArrange = await nodeTransform(pageA, childIds[0]);
  await pageA.getByRole('button', { name: /排列子节点/ }).click();
  await pageA.getByRole('menuitem', { name: '网格' }).click();
  await expect.poll(async () => nodeTransform(pageA, childIds[0]), {
    timeout: 15_000, message: 'A 端排列未改变子节点位置',
  }).not.toBe(preArrange);
  for (const id of childIds) {
    await expect.poll(async () => nodeTransform(pageB, id), {
      timeout: 30_000, message: `B 端子节点 ${id} 位置未收敛`,
    }).toBe(await nodeTransform(pageA, id));
  }

  // ② A 创建副本（右键组 → duplicateGroup）→ B 节点数收敛 +3（新组+2 子）
  await pageA.locator(`.react-flow__node[data-id="${groupId}"]`)
    .click({ button: 'right', position: { x: 15, y: 35 } });
  await pageA.getByRole('button', { name: '创建副本' }).click();
  await expectCountIs(pageA, 6);
  await expectCountIs(pageB, 6);

  // ③ A 设色（GroupToolbar 色点 → 紫）→ B 组框 border 收敛（唯一色投影）
  await selectGroupAlone(pageA, groupId); // 副本夺选后重选原组
  await pageA.getByRole('button', { name: '组颜色' }).click();
  await pageA.getByRole('option', { name: '紫' }).click();
  await expect.poll(() => groupBoxBorder(pageA, groupId), { timeout: 15_000 })
    .toContain('var(--canvas-group-color-purple)');
  await expect.poll(() => groupBoxBorder(pageB, groupId), {
    timeout: 30_000, message: 'B 端组色未收敛',
  }).toContain('var(--canvas-group-color-purple)');

  // ④ 前静置 >500ms（canvasUndo Y.UndoManager captureTimeout——相邻 LocalUser 事务在窗口内
  //  会合并成同一撤销栈项，紧贴着设色后立即折叠会让 Ctrl+Z 连色带折叠一起回滚）。
  //  本等待=把「用户分步操作」的节奏显式编码进脚本——非垫片。
  await pageA.waitForTimeout(600);

  // ④ A 折叠 → 子节点隐藏（双端计数 -2）+ B 折叠卡到达
  await pageA.getByRole('button', { name: '折叠', exact: true }).click();
  await expectCountIs(pageA, 4);
  await expect(collapsedCard(pageA, groupId)).toBeVisible({ timeout: 15_000 });
  await expectCountIs(pageB, 4);
  await expect(collapsedCard(pageB, groupId)).toBeVisible({ timeout: 30_000 });

  // ⑤ A undo 一步（只回滚折叠——色/副本仍在）→ B 回滚收敛
  await pageA.keyboard.press('Control+z');
  await expectCountIs(pageA, 6);
  await expect(collapsedCard(pageA, groupId)).toBeHidden({ timeout: 15_000 });
  await expectCountIs(pageB, 6);
  await expect(collapsedCard(pageB, groupId)).toBeHidden({ timeout: 30_000 });
  await expect.poll(() => groupBoxBorder(pageB, groupId), { timeout: 15_000 })
    .toContain('var(--canvas-group-color-purple)'); // 未被过度回滚
  await ctxA.close();
  await ctxB.close();
});

// ── 场景 2：B 端 duplicateGroup（跨端复制 + getId 防碰撞——B 写 doc 回灌 A） ──
test('跨端复制：A 建组→B 端右键创建副本成功→A 亦收敛（getId 防碰撞）', async ({ browser }) => {
  const ctxA = await browser.newContext({ storageState: STATE_A });
  const ctxB = await browser.newContext({ storageState: STATE_B });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  await openFreshCanvas(pageA, pageB);

  const groupId = await createGroupOfTwo(pageA);
  await expect(pageB.locator(`.react-flow__node[data-id="${groupId}"]`)).toBeVisible({ timeout: 30_000 });
  await expectCountIs(pageB, 3);

  // B 端对组执行 duplicateGroup（右键 → 创建副本）——MEMBER 可编辑
  const idsBefore = await currentNodeIds(pageB);
  await pageB.locator(`.react-flow__node[data-id="${groupId}"]`)
    .click({ button: 'right', position: { x: 15, y: 35 } });
  await pageB.getByRole('button', { name: '创建副本' }).click();
  await expectCountIs(pageB, 6);
  // getId 防碰撞：B 的 3 个新副本 id 全新（与建组后既有 id 无一重合——撞 id 会被 doc merge 吞成更少节点）
  const copies = (await currentNodeIds(pageB)).filter((id) => !idsBefore.includes(id));
  expect(copies).toHaveLength(3);
  // 跨端回灌：A 无刷新收敛到 B 的编辑（同 id 到达）
  await expectCountIs(pageA, 6);
  for (const id of copies) {
    await expect(pageA.locator(`.react-flow__node[data-id="${id}"]`)).toBeVisible({ timeout: 30_000 });
  }
  await ctxA.close();
  await ctxB.close();
});
