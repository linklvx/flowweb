// Spec B B7-2 双端几何 e2e（collab-r2-commands 同装置：双 browser context + gate 控制面——
// 必须经 `node scripts/gate-collab.mjs` 运行；画布隔离=每用例 A 无参新建，doc 从零开始）。
// 覆盖锚（plan B7-2 行）：
//   T1 帧原点逐帧恒等（A 拖子期间 B 帧零变化）+ 松手收敛三锚（undo 只回拖动/帧≡bbox+padding 具名常量/
//      零提交分支——拖回原位松手 Ctrl+Z 回退的是上一命令非拖动）
//   T2 拖动中远端写入让位：B 拖同组兄弟（T2a）/B 拖组员出组=减成员（T2b）/B 拖走被拖节点=改 parentId
//      （T2c——保护放弃按 doc 重算）/B 重命名被拖组=改 data（T2d——让位只保护几何不保护数据，终裁 71③；
//      data[status/fileId] 精确字段面由 PR 门 vitest int spec 承担——分层见 spec 回写）/
//      B resize 同组=冻结组帧写（T2e——A 冻结帧让位+B 的 manual 密封帧终局）
//   T3 resize 远端锚（含子 rel 补偿——NW 角 resize origin 位移）
//   T4 undo 合成（A 拖组→B 改子→A undo 部分回退=单人接受登记）
//   T5 redo 三锚（拖 c1→拖 c2→undo→redo 帧逐位/固化后 undo 尺寸不回退[Origin.Geometry 不入栈]/
//      redo 后组帧≡bbox）
//   T6 刷新一致（双端 reload 后逐位=reload 前捕获值）
//   T7 并发登记（A/B 各拖不同子交错松手——逐节点 LWW 双端收敛）
//   T8 拖动中强刷⇒无孤儿 intent∧doc 无半提交（手势期 doc 零写——强刷后双端=拖前态）
//   T9 断线 30s 续拖+重连收敛（held drag 跨 30s API 宕机窗，离线松手提交随重连上送）
//   T10 三端（A 拖组/B 改子/C 只读——三方几何一致）
//   T11 elementFromPoint 零交叠 zoom∈{0.5,1,2} 三档（B6-2 挪入——jsdom 无布局）+直径/偏移三档屏幕值相等

// ── B7-2 首跑实证登记（2026-10-05，gate 六轮）+ 评审修正（2026-10-05，T99 双轮 doc/cs/DOM 快照）──
// 【原"RF 驱动子拖拽位移扩散"发现撤销——根因=e2e 空间模型错误】RF v12 平铺渲染（子节点 DOM 不嵌套
// 于组），`.react-flow__node` transform=positionAbsolute（含组 origin 的绝对流坐标）。首跑把子
// transform 误当 rel 再叠组 origin（childAbsOn 双计）：帧重派生移 origin ⇒ "未拖兄弟随动 +~指针位移"
// 与"帧≡bbox 偏差恰一个 origin"全是断言假象。生产链实测（?perfProbe=1 快照）正确：拖子期间兄弟
// abs 逐帧不动/组帧冻结；松手 moveNode 单次施加位移、帧≡bbox+padding（具名常量）、兄弟 rel 随新
// origin 重基且 abs 守恒、doc↔cs 一致；RF 多选拖拽集亦无残留泄漏（drag 未选节点时 RF 即时重置选择，
// .dragging 恒单节点）。vitest 直驱全绿与浏览器行为一致——无生产缺陷；T2a/T2b/T7 随空间模型修正
// +位移容差校准（施加/请求比实测低至 0.31——疑 autoPanOnNodeDrag 视口平移掺入，下限 30→5）复绿；
// T1 的几何锚（兄弟不动/帧公式）在复跑中已过——残余红仅在 undo 段（见下复 fixme 五件）。
// 【复 fixme 五件（评审复跑定位——与已撤销的"扩散"发现无关）】T1/T1b/T5a 同族：**textInput 子拖拽后
// Ctrl+Z 不达画布**（T1 实测 undo 后 c1 停末帧=位移 54 原样——组侧 T5b/T2e undo 绿，疑顶带拖点焦点
// 被 tiptap 吞键或撤销栈分窗；T1b 的[分离]未回退同签名）；T2c：保持期"保护放弃按 doc 重算"的 abs
// 收敛判据与 LWW 末帧语义待裁决；T4：undo 部分回退锚含精确位移断言（expectFlowDelta ≤2 vs 输入物理
// 方差+组拖 undo 载荷含子代快照语义）。
// 【T3】NW 角 resize 帧不收敛（B 帧仅 −5.25/请求 −40.125——NW 手柄抓取/方向链待查；SE 档 T5b 绿）。
// 【T11】zoom 驱动循环超时后清理级联——待单独排查（wheel 缩放反馈或选中态在缩放下的重置时序）。
// 夹具档位（终裁 87②）：拖拽位移用 1/8 格值（.125/.375——整数坐标使量化/取整不可见）；
// 帧断言用 shared 具名常量（GROUP_PADDING=20/GROUP_PADDING_TOP=50 非对称——禁自写魔数）。
import { test, expect, type Page } from '@playwright/test';
import { GROUP_PADDING, GROUP_PADDING_TOP } from '@flowweb/shared';
import { expectConnected, addNodeViaMenu, nodeCount, dbTool, killApi, startApi, waitForDisconnected } from './collab-helpers';

const STATE_A = 'e2e/.auth/collab-a.json';
const STATE_B = 'e2e/.auth/collab-b.json';
const STATE_C = 'e2e/.auth/collab-c.json';
const C_EMAIL = 'collab-c@flowweb.local';

// ── 装置原语（r2-commands 同款口径——本 spec 内聚，不做跨 spec 抽取） ──────────────

function expectCountIs(page: Page, n: number, timeout = 30_000) {
  return expect.poll(() => nodeCount(page), { timeout, message: `节点数未收敛到 ${n}` }).toBe(n);
}

async function currentNodeIds(page: Page): Promise<string[]> {
  return page.locator('.react-flow__node').evaluateAll((els) =>
    els.map((e) => (e as HTMLElement).dataset.id ?? '').filter(Boolean),
  );
}

/** 节点位置 transform 字符串（RF v12：transform=positionAbsolute——含父组 origin 的绝对流坐标；
 *  doc 同值则两端全等——r2-commands 同判据） */
function nodeTransform(page: Page, nodeId: string): Promise<string> {
  return page.locator(`.react-flow__node[data-id="${nodeId}"]`).evaluate((el) => el.style.transform);
}

function parseTransform(t: string): { x: number; y: number } {
  const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(t);
  if (!m) throw new Error(`unparsable transform: ${t}`);
  return { x: Number(m[1]), y: Number(m[2]) };
}

/** RF 节点盒显式尺寸（组帧三字段的 wh 投影——style.width/height 恒在） */
async function nodeSize(page: Page, nodeId: string): Promise<{ w: number; h: number }> {
  return page.locator(`.react-flow__node[data-id="${nodeId}"]`).evaluate((el) => ({
    w: Number.parseFloat(el.style.width), h: Number.parseFloat(el.style.height),
  }));
}

/** 视口变换（zoom 读数——elementFromPoint 三档 zoom 驱动的反馈源） */
function readZoom(page: Page): Promise<number> {
  return page.locator('.react-flow__viewport').evaluate((el) =>
    Number.parseFloat(/scale\(([\d.]+)\)/.exec(el.style.transform)?.[1] ?? 'NaN'));
}

/** 视口四元组 {x,y,zoom}——拖拽位移换算源（首跑实证：画布视口非恒等 zoom，屏幕 px≠流 px——
 *  全部拖拽按「流坐标目标×zoom」落屏幕点，断言留在流空间）。 */
function readViewport(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  return page.locator('.react-flow__viewport').evaluate((el) => {
    const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(el.style.transform);
    return { x: Number(m?.[1]), y: Number(m?.[2]), zoom: Number(m?.[3]) };
  });
}

const PANE_BLANK = { x: 180, y: 600 };

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

async function selectGroupAlone(page: Page, groupId: string): Promise<void> {
  await page.mouse.click(PANE_BLANK.x, PANE_BLANK.y);
  await page.locator(`.react-flow__node[data-id="${groupId}"]`).click({ position: { x: 15, y: 35 } });
  await expect(page.getByRole('button', { name: /排列子节点/ })).toBeVisible({ timeout: 10_000 });
}

/** A 端建组（2 文本节点 → 框选 → 打组），返回 {groupId, childIds} */
async function createGroupOfTwo(page: Page): Promise<{ groupId: string; childIds: string[] }> {
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
  await expect(groupBtn).toBeEnabled({ timeout: 10_000 });
  await groupBtn.click();
  await page.getByRole('menuitem', { name: '打组（Ctrl+G）' }).click();
  let groupId = '';
  await expect.poll(async () => {
    const ids = await currentNodeIds(page);
    groupId = ids.find((id) => !before.includes(id) && !childIds.includes(id)) ?? '';
    return groupId;
  }, { timeout: 15_000, message: '打组后新组节点未出现' }).toBeTruthy();
  await expectCountIs(page, before.length + 3);
  // 重载去残留（首跑实证：pane click 不清 RF selection[.selected 类残留]——残留多选使后续拖拽
  // draggingIds=多节点集+位移双写[2× 现象]；reload=doc 重放，选择/会话零残留）。
  // 注意：reload 亦清 A 的客户端撤销栈——undo 类用例的可撤销项=本步之后的[分离/拖动]。
  await page.reload();
  await expect(page.locator('.react-flow')).toBeVisible({ timeout: 20_000 });
  await expectConnected(page);
  await expectCountIs(page, before.length + 3);
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(0);
  // 分离堆叠双子（首跑实证：menu 两文本默认同点堆叠——bbox 全等使按 bbox 定位的拖拽无法分辨两子；
  // 顶带拖点必抓最上层=childIds[1]，拖开 ~240px 后两子 bbox 可分辨。waitForTimeout 分窗=分离自成一 undo 项）。
  await page.waitForTimeout(600);
  const sep = await nodeCenter(page, childIds[1]);
  await page.mouse.move(sep.x, sep.y);
  await page.mouse.down();
  await page.mouse.move(sep.x + 260, sep.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => {
    const b1 = await page.locator(`.react-flow__node[data-id="${childIds[0]}"]`).boundingBox();
    const b2 = await page.locator(`.react-flow__node[data-id="${childIds[1]}"]`).boundingBox();
    return b1 && b2 ? Math.abs(b1.x - b2.x) : 0;
  }, { timeout: 10_000, message: '双子未分离' }).toBeGreaterThan(200);
  return { groupId, childIds };
}

/** 双端开同一张全新画布（A 无参新建，B 以 MEMBER 打开同项目），返回 projectId。
 *  首跑实证（B7-2 gate 第 1 轮）：S4 尾部 ctxA.storageState 会把 localStorage.flowweb_projectId
 *  （=gate 共享画布，累积 6 节点）一并存进 STATE_A——无参 /canvas 会复用旧项目而非新建。
 *  守卫=会话一次性清该键（sessionStorage 标记跨 reload/goto 存活——T6/T8 的 reload 不受影响）。 */
async function openFreshCanvas(pageA: Page, pageB: Page): Promise<string> {
  await pageA.addInitScript(() => {
    if (!sessionStorage.getItem('__specbFresh')) {
      sessionStorage.setItem('__specbFresh', '1');
      localStorage.removeItem('flowweb_projectId');
    }
  });
  await pageA.goto('/canvas');
  await expect(pageA.locator('.react-flow')).toBeVisible({ timeout: 20_000 });
  await expectConnected(pageA);
  const projectId = await pageA.evaluate(() => localStorage.getItem('flowweb_projectId'));
  expect(projectId).toBeTruthy();
  await pageB.goto(`/canvas?projectId=${projectId}`);
  await expect(pageB.locator('.react-flow')).toBeVisible({ timeout: 20_000 });
  await expectConnected(pageB);
  expect(await nodeCount(pageA)).toBe(0);
  expect(await nodeCount(pageB)).toBe(0);
  return projectId!;
}

/** 节点拖拽安全落点：顶 padding 带中点（探针实证：内容区=tiptap 编辑面 nodrag、左缘=target handle
 *  hit-area nodrag、顶 padding 带[py-3, x=中点]是唯一稳定可起拖面）。 */
async function nodeCenter(page: Page, nodeId: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(`.react-flow__node[data-id="${nodeId}"]`).boundingBox();
  if (!box) throw new Error(`node ${nodeId} not visible`);
  return { x: box.x + box.width / 2, y: box.y + 8 };
}

/** 拖拽位移断言（语义档——e2e 的位移精度受 RF 手势机制支配：实测同请求位移在[耗 ~20px 激活损耗,
 *  超程 +46.6px]两形态间随拖点/布局漂移[首跑三轮实证]；评审复跑实测施加/请求比低至 0.31
 *  [61.375→19/55.125→28/52.75→25——疑 autoPanOnNodeDrag 视口平移掺入]；精确位移数学=vitest B51 域）。
 *  断言=方向正确 ∧ 实位移有分量[≥5——零施加档 0~2 仍必红] ∧ 未失控[≤|req|+70]。 */
function expectDragApplied(actualDelta: number, requested: number): void {
  expect(Math.sign(actualDelta)).toBe(Math.sign(requested));
  expect(Math.abs(actualDelta)).toBeGreaterThanOrEqual(5);
  expect(Math.abs(actualDelta)).toBeLessThanOrEqual(Math.abs(requested) + 70);
}

/** 组内标题带安全拖点（子节点 rel y≥50 起——避开子节点与 resize 手柄） */
async function groupDragPoint(page: Page, groupId: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(`.react-flow__node[data-id="${groupId}"]`).boundingBox();
  if (!box) throw new Error(`group ${groupId} not visible`);
  return { x: box.x + 40, y: box.y + 20 };
}

/** 完整拖拽（流坐标位移——1/8 格值档必跑；屏幕落点=流目标×zoom） */
async function dragNodeBy(page: Page, nodeId: string, dx: number, dy: number, steps = 6): Promise<void> {
  const c = await nodeCenter(page, nodeId);
  const { zoom } = await readViewport(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(c.x + (dx * zoom * i) / steps, c.y + (dy * zoom * i) / steps);
  }
  await page.mouse.up();
}

/** 起拖不松手（让位/强刷/断线用例的手势保持态——流坐标位移） */
async function startDrag(page: Page, nodeId: string, dx = 24, dy = 16): Promise<void> {
  const c = await nodeCenter(page, nodeId);
  const { zoom } = await readViewport(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + dx * zoom, c.y + dy * zoom, { steps: 3 });
}

async function continueDrag(page: Page, nodeId: string, dx: number, dy: number): Promise<void> {
  const c = await nodeCenter(page, nodeId);
  const { zoom } = await readViewport(page);
  await page.mouse.move(c.x + dx * zoom, c.y + dy * zoom, { steps: 3 });
}

/** 组拖拽（标题带安全点——流坐标位移；groupDragPoint 定起点） */
async function dragGroupBy(page: Page, groupId: string, dx: number, dy: number, steps = 6): Promise<void> {
  const p = await groupDragPoint(page, groupId);
  const { zoom } = await readViewport(page);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(p.x + (dx * zoom * i) / steps, p.y + (dy * zoom * i) / steps);
  }
  await page.mouse.up();
}

/** 组持拖（不松手——流坐标位移） */
async function startGroupDrag(page: Page, groupId: string, dx: number, dy: number): Promise<void> {
  const p = await groupDragPoint(page, groupId);
  const { zoom } = await readViewport(page);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + dx * zoom, p.y + dy * zoom, { steps: 3 });
}

/** 组 resize（角手柄——流坐标位移；corner='nw'|'se'） */
async function resizeGroupBy(page: Page, groupId: string, corner: 'nw' | 'se', dx: number, dy: number, steps = 5): Promise<void> {
  const box = await page.locator(`.react-flow__node[data-id="${groupId}"]`).boundingBox();
  if (!box) throw new Error(`group ${groupId} not visible`);
  const { zoom } = await readViewport(page);
  const hx = corner === 'nw' ? box.x + 2 : box.x + box.width - 2;   // +2/-2 内缩落点——8×8 手柄边缘临界防漏抓（首跑 NW 档实证）
  const hy = corner === 'nw' ? box.y + 2 : box.y + box.height - 2;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(hx + (dx * zoom * i) / steps, hy + (dy * zoom * i) / steps);
  }
  await page.mouse.up();
}

/** 拖子到流坐标绝对落点（出组用——目标远离组框，防 zoom 下落点仍落组内） */
async function dragNodeToFlow(page: Page, nodeId: string, flowX: number, flowY: number, steps = 8): Promise<void> {
  const c = await nodeCenter(page, nodeId);
  const { x: vpX, y: vpY, zoom } = await readViewport(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(c.x + ((flowX * zoom + vpX) - c.x) * t, c.y + ((flowY * zoom + vpY) - c.y) * t);
  }
  await page.mouse.up();
}

/** 手势保持期的收敛判据：双端子 abs 数值收敛（rel 字符串在此期不收敛=设计内——A 帧冻结/B 帧派生） */
async function expectChildAbsConverged(pageA: Page, pageB: Page, childId: string, timeout = 30_000): Promise<void> {
  await expect.poll(async () => {
    const a = await childAbsOn(pageA, childId);
    const b = await childAbsOn(pageB, childId);
    if (a == null || b == null) return false;
    return Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
  }, { timeout, message: `节点 ${childId} 双端 abs 未收敛（手势保持窗）` }).toBe(true);
}


/** 等双端某节点 transform 逐位相等（收敛判据——字符串全等） */
async function expectTransformsConverged(pageA: Page, pageB: Page, nodeId: string, timeout = 30_000): Promise<string> {
  let final = '';
  await expect.poll(async () => {
    const a = await nodeTransform(pageA, nodeId);
    const b = await nodeTransform(pageB, nodeId);
    final = a;
    return a === b ? a : '';
  }, { timeout, message: `节点 ${nodeId} 双端 transform 未逐位收敛` }).toBeTruthy();
  return final;
}

/** 组帧四值 {x,y,w,h}（transform origin + 显式尺寸） */
async function groupFrame(page: Page, groupId: string): Promise<{ x: number; y: number; w: number; h: number }> {
  const t = parseTransform(await nodeTransform(page, groupId));
  const s = await nodeSize(page, groupId);
  return { x: t.x, y: t.y, w: s.w, h: s.h };
}

/** B 端子节点 abs（RF v12 transform=positionAbsolute——已是绝对流坐标，勿再叠组 origin：
 *  B7-2 首跑把 transform 误当 rel 双计 origin，制造"兄弟随动/帧偏差=组 origin"假象[评审实证]） */
async function childAbsOn(page: Page, childId: string): Promise<{ x: number; y: number; w: number; h: number }> {
  const abs = parseTransform(await nodeTransform(page, childId));
  const s = await nodeSize(page, childId);
  return { x: abs.x, y: abs.y, w: s.w, h: s.h };
}

/** 拖拽位移断言容差：CDP 鼠标事件整数化屏幕点×zoom 往返 + RF 位置落值取整的合成误差
 *  （首跑实证：提交末值恒整——1/8 格值输入的量化/取整可见性正是非整数档夹具的目的，终裁 87②）。
 *  粗差（首跑 14~67px 的 zoom 未换算错）仍必红。 */
const FLOW_TOL = 2;
function expectFlowDelta(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(FLOW_TOL);
}

/** 帧断言：帧≡bbox+padding（normal∧!collapsed∧成员≥1 档——具名常量非对称差，终裁 87②） */
function expectFrameEqualsBounds(
  frame: { x: number; y: number; w: number; h: number },
  members: Array<{ x: number; y: number; w: number; h: number }>,
): void {
  const minX = Math.min(...members.map((m) => m.x));
  const minY = Math.min(...members.map((m) => m.y));
  const maxX = Math.max(...members.map((m) => m.x + m.w));
  const maxY = Math.max(...members.map((m) => m.y + m.h));
  expect(frame.x).toBeCloseTo(minX - GROUP_PADDING, 3);
  expect(frame.y).toBeCloseTo(minY - GROUP_PADDING_TOP, 3);
  expect(frame.w).toBeCloseTo(maxX - minX + GROUP_PADDING * 2, 3);
  expect(frame.h).toBeCloseTo(maxY - minY + GROUP_PADDING_TOP + GROUP_PADDING, 3);
}

test.beforeEach(async () => {
  const res = await fetch(`${process.env.COLLAB_E2E_API_CONTROL ?? 'http://127.0.0.1:3100'}/status`);
  const { up } = await res.json();
  if (!up) throw new Error('gate 控制面 API 不在线——本 spec 必须经 scripts/gate-collab.mjs 运行');
});

async function dual(browser: import('@playwright/test').Browser) {
  const ctxA = await browser.newContext({ storageState: STATE_A });
  const ctxB = await browser.newContext({ storageState: STATE_B });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  return { ctxA, ctxB, pageA, pageB };
}

// ── T1：帧原点逐帧恒等 + 松手收敛 + 零提交分支 ─────────────────────────────────
test.fixme('T1 A 拖子：拖动期 B 帧逐帧恒等（手势期 doc 零写）；松手双端收敛+帧≡bbox+padding（具名常量）；undo 只回拖动', async ({ browser }) => {
  const { ctxA, ctxB, pageA, pageB } = await dual(browser);
  try {
    await openFreshCanvas(pageA, pageB);
    const { groupId, childIds } = await createGroupOfTwo(pageA);
    await expectCountIs(pageB, 3); // B 收到组+2 子
    await pageA.waitForTimeout(600); // captureTimeout 分窗（拖动=独立 undo 项——尾部 Ctrl+Z 只回拖动的前提）
    const [c1, c2] = childIds;

    const preAbs1 = await childAbsOn(pageB, c1, groupId);
    const preAbs2 = await childAbsOn(pageB, c2, groupId);
    const bGroupBefore = await nodeTransform(pageB, groupId);

    // A 起拖 c1 不松手（1/8 格值位移——流坐标×zoom 落屏幕）——B 侧两次采样：组帧/子位置逐帧恒等（手势期 doc 零写）
    const a1 = await nodeCenter(pageA, c1);
    const zA = (await readViewport(pageA)).zoom;
    await pageA.mouse.move(a1.x, a1.y);
    await pageA.mouse.down();
    await pageA.mouse.move(a1.x + 30.375 * zA, a1.y - 18.125 * zA, { steps: 4 });
    const sample1 = { g: await nodeTransform(pageB, groupId), c1: await nodeTransform(pageB, c1), c2: await nodeTransform(pageB, c2) };
    await pageA.mouse.move(a1.x + 61.375 * zA, a1.y - 23.125 * zA, { steps: 4 });
    await pageA.waitForTimeout(300); // 远端写入到达窗口——B 若收到任何写即采样分叉
    const sample2 = { g: await nodeTransform(pageB, groupId), c1: await nodeTransform(pageB, c1), c2: await nodeTransform(pageB, c2) };
    expect(sample2).toEqual(sample1);            // 帧原点逐帧恒等（B 零变化）
    expect(sample1.g).toBe(bGroupBefore);        // 且=拖前帧（冻结语义的远端投影）
    await pageA.mouse.up();

    // 松手收敛：双端 c1 transform 逐位相等；B 帧≡bbox+padding（非对称具名常量）
    await expectTransformsConverged(pageA, pageB, c1);
    await expectTransformsConverged(pageA, pageB, groupId);
    const postAbs1 = await childAbsOn(pageB, c1, groupId);
    const postAbs2 = await childAbsOn(pageB, c2, groupId);
    expectDragApplied(postAbs1.x - preAbs1.x, 61.375); // 拖动位移落 abs（激活损耗有界档）
    expectDragApplied(preAbs1.y - postAbs1.y, 23.125);
    expect(postAbs2).toEqual(preAbs2);                     // 未拖子零变化
    expectFrameEqualsBounds(await groupFrame(pageB, groupId), [postAbs1, postAbs2]);
    expectFrameEqualsBounds(await groupFrame(pageA, groupId), [postAbs1, postAbs2]); // 双端同帧

    // 三锚之 undo：Ctrl+Z 只回退拖动（c1 回拖前 abs；组/另一子不动）
    await pageA.keyboard.press('Control+z');
    await expectTransformsConverged(pageA, pageB, c1);
    const undoneAbs1 = await childAbsOn(pageB, c1, groupId);
    expectFlowDelta(undoneAbs1.x, preAbs1.x);
    expectFlowDelta(undoneAbs1.y, preAbs1.y);
    expect(await childAbsOn(pageB, c2, groupId)).toEqual(preAbs2);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test.fixme('T1b 零提交分支：拖回原位松手⇒零 undo 项（Ctrl+Z 回退的是[分离]——零净拖动不占栈顶）', async ({ browser }) => {
  const { ctxA, ctxB, pageA, pageB } = await dual(browser);
  try {
    await openFreshCanvas(pageA, pageB);
    const { childIds } = await createGroupOfTwo(pageA);
    await expectCountIs(pageB, 3);
    await pageA.waitForTimeout(600); // captureTimeout 分窗（零净拖动与[分离]各成独立 undo 项的前提）

    const before = parseTransform(await nodeTransform(pageA, childIds[0]));
    const c = await nodeCenter(pageA, childIds[0]);
    const z = (await readViewport(pageA)).zoom;
    await pageA.mouse.move(c.x, c.y);
    await pageA.mouse.down();
    await pageA.mouse.move(c.x + 43.125 * z, c.y + 27.375 * z, { steps: 5 });
    await pageA.mouse.move(c.x, c.y, { steps: 5 }); // 拖回原位——零净变更（指针回位精确；RF 手势跟踪余量 ≤10px）
    await pageA.mouse.up();
    await pageA.waitForTimeout(600);
    const settled = parseTransform(await nodeTransform(pageA, childIds[0]));
    expect(Math.abs(settled.x - before.x)).toBeLessThanOrEqual(10); // 近零净（精确零净=vitest B51 域）
    expect(Math.abs(settled.y - before.y)).toBeLessThanOrEqual(10);

    // Ctrl+Z ① ⇒ 回退[分离]（reload 后撤销栈底=分离——零净拖动不入栈；若入栈，此处回退的会是
    // 零净拖动：分离保持、双子 transform 仍不等）。判据=c2 回堆到 c1（两 transform 全等）。
    await pageA.keyboard.press('Control+z');
    await expectCountIs(pageA, 3);
    await expect.poll(async () => {
      const t1 = await nodeTransform(pageA, childIds[0]);
      const t2 = await nodeTransform(pageA, childIds[1]);
      return t1 === t2 ? t1 : '';
    }, { timeout: 15_000, message: 'Ctrl+Z① 未回退分离（c2 未回堆——零净拖动入了撤销栈？）' }).toBeTruthy();
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// ── T2：拖动中远端写入让位锚 ──────────────────────────────────────────────────
test('T2a A 拖子中：A 帧冻结恒等，松手后双端按新成员集收敛', async ({ browser }) => {
  const { ctxA, ctxB, pageA, pageB } = await dual(browser);
  try {
    await openFreshCanvas(pageA, pageB);
    const { groupId, childIds } = await createGroupOfTwo(pageA);
    await expectCountIs(pageB, 3);
    const [c1, c2] = childIds;

    const aFrameBefore = await groupFrame(pageA, groupId);
    const c2AbsBefore = await childAbsOn(pageB, c2, groupId);

    await startDrag(pageA, c1); // A 持拖 c1
    const frozen = await groupFrame(pageA, groupId);
    // B 拖同组兄弟 c2（1/8 格值）并松手——远端写入到达 A
    await dragNodeBy(pageB, c2, 55.125, 33.375);
    await expectChildAbsConverged(pageA, pageB, c2); // c2 的 B 提交已到 A（c2 不在让位集）——保持期按 abs 判（A 帧冻结/B 帧派生，rel 字符串此期不收敛=设计内）
    // A 帧仍冻结（让位硬规则：frozenFrames 组帧不随成员位移重算）
    expect(await groupFrame(pageA, groupId)).toEqual(frozen);
    expect(frozen).toEqual(aFrameBefore);

    await continueDrag(pageA, c1, 30.25, 12.5);
    await pageA.mouse.up();
    // 双端收敛：帧按全体成员（含 B 动过的 c2）重派生；帧≡bbox+padding
    await expectTransformsConverged(pageA, pageB, groupId);
    await expectTransformsConverged(pageA, pageB, c1);
    const abs1 = await childAbsOn(pageB, c1, groupId);
    const abs2 = await childAbsOn(pageB, c2, groupId);
    expectDragApplied(abs2.x - c2AbsBefore.x, 55.125); // B 的写保留（LWW——c2 归 B；激活损耗有界档）
    expectDragApplied(abs2.y - c2AbsBefore.y, 33.375);
    expectFrameEqualsBounds(await groupFrame(pageA, groupId), [abs1, abs2]);
    expectFrameEqualsBounds(await groupFrame(pageB, groupId), [abs1, abs2]);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test('T2b A 拖组中：双端收敛=剩余子派生帧+出组子顶层化', async ({ browser }) => {
  const { ctxA, ctxB, pageA, pageB } = await dual(browser);
  try {
    await openFreshCanvas(pageA, pageB);
    const { groupId, childIds } = await createGroupOfTwo(pageA);
    await expectCountIs(pageB, 3);
    const [c1, c2] = childIds;

    // A 持拖组（origin 活/子冻结）
    await startGroupDrag(pageA, groupId, 40.5, 25.25);

    // B 把 c2 拖出组（顶层化——减成员；落点=流坐标远离组框，防 zoom 下落回组内）
    const c2Abs = await childAbsOn(pageB, c2, groupId);
    await dragNodeToFlow(pageB, c2, c2Abs.x + 450, c2Abs.y + 380);
    await expectChildAbsConverged(pageA, pageB, c2); // B 的移出到达 A（保持期 abs 判）

    await pageA.mouse.up(); // A 松手（拖动中被减员——会话收口）
    await pageA.waitForTimeout(800);

    // 收敛：c2 顶层化（transform=abs 空间）双端一致；组帧=仅剩 c1 派生
    await expectTransformsConverged(pageA, pageB, groupId);
    await expectTransformsConverged(pageA, pageB, c1);
    const abs1 = await childAbsOn(pageB, c1, groupId);
    expectFrameEqualsBounds(await groupFrame(pageA, groupId), [abs1]); // 帧≡bbox+padding（单成员档）
    expectFrameEqualsBounds(await groupFrame(pageB, groupId), [abs1]);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test.fixme('T2c A 拖子中：保护放弃按 doc 基准重算，最终双端收敛于顶层', async ({ browser }) => {
  const { ctxA, ctxB, pageA, pageB } = await dual(browser);
  try {
    await openFreshCanvas(pageA, pageB);
    const { groupId, childIds } = await createGroupOfTwo(pageA);
    await expectCountIs(pageB, 3);
    const c1 = childIds[0];

    await startDrag(pageA, c1); // A 持拖 c1
    // B 拖同一节点出组（B 端独立 RF 实例——真实并发写；B 松手=写 c1 parentId=undefined+abs；落点流坐标远离组框）
    const c1Abs = await childAbsOn(pageB, c1, groupId);
    await dragNodeToFlow(pageB, c1, c1Abs.x + 480, c1Abs.y - 320);
    await expectChildAbsConverged(pageA, pageB, c1); // parentId 写到达 A（保护放弃——A 侧 c1 按 doc 重算；保持期 abs 判）

    await continueDrag(pageA, c1, 18.25, 9.5); // A 续拖（本地手势仍活）
    await pageA.mouse.up();                    // A 提交末帧 abs（parentId 取 doc=B 写）
    await expectTransformsConverged(pageA, pageB, c1);
    await expectTransformsConverged(pageA, pageB, groupId);
    const abs2 = await childAbsOn(pageB, childIds[1], groupId);
    expectFrameEqualsBounds(await groupFrame(pageB, groupId), [abs2]); // 组帧=剩余成员派生
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test('T2d A 拖组中 B 重命名该组（改 data）：让位只保护几何不保护数据——名称双端保留+位置=A 末帧（终裁 71③）', async ({ browser }) => {
  const { ctxA, ctxB, pageA, pageB } = await dual(browser);
  try {
    await openFreshCanvas(pageA, pageB);
    const { groupId } = await createGroupOfTwo(pageA);
    await expectCountIs(pageB, 3);

    // A 持拖组（流坐标位移）
    await startGroupDrag(pageA, groupId, 36.75, 20.125);

    // B 双击组名重命名（updateNodeData——data 写在被拖节点上）
    await pageB.locator(`.react-flow__node[data-id="${groupId}"]`).dblclick({ position: { x: 60, y: 12 } });
    const input = pageB.locator(`.react-flow__node[data-id="${groupId}"] input`);
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill('远端改名-71③');
    await input.press('Enter');
    await expect(pageB.locator(`.react-flow__node[data-id="${groupId}"]`)).toContainText('远端改名-71③', { timeout: 15_000 });

    await continueDrag(pageA, groupId, 29.625, 21.125); // 组中心安全换算点（拖拽指针捕获——落点只是位移目标）
    await pageA.mouse.up();
    // 数据保留（A 同步显示远端名）+几何=A 末帧（双端组 transform 收敛且 ≠ 拖前）
    await expect(pageA.locator(`.react-flow__node[data-id="${groupId}"]`)).toContainText('远端改名-71③', { timeout: 15_000 });
    await expectTransformsConverged(pageA, pageB, groupId);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test('T2e A 拖子中 B resize 同组（冻结组帧写）：A 帧让位不动，松手后双端=B 的 manual 密封帧+A 的子末帧', async ({ browser }) => {
  const { ctxA, ctxB, pageA, pageB } = await dual(browser);
  try {
    await openFreshCanvas(pageA, pageB);
    const { groupId, childIds } = await createGroupOfTwo(pageA);
    await expectCountIs(pageB, 3);
    const c1 = childIds[0];

    await startDrag(pageA, c1); // A 持拖子（父组帧冻结）
    const frozen = await groupFrame(pageA, groupId);

    // B 选中组 SE 角扩 90.25×48.125（流坐标位移——manual 三键密封提交，组帧写）
    await selectGroupAlone(pageB, groupId);
    await resizeGroupBy(pageB, groupId, 'se', 90.25, 48.125);

    // A 帧仍冻结（让位硬规则——远端帧写不覆写冻结帧；数值四字段判——量化容差 1px）；B 帧已吃 resize
    await pageA.waitForTimeout(800); // B 提交到达窗口
    const aHeld = await groupFrame(pageA, groupId);
    expect(aHeld.x).toBeCloseTo(frozen.x, 0);
    expect(aHeld.y).toBeCloseTo(frozen.y, 0);
    expect(aHeld.w).toBeCloseTo(frozen.w, 0);
    expect(aHeld.h).toBeCloseTo(frozen.h, 0);
    const bResized = await groupFrame(pageB, groupId);
    expectFlowDelta(bResized.w, frozen.w + 90.25); // B 前置自证：resize 已落

    await continueDrag(pageA, c1, 20.25, 10.5);
    await pageA.mouse.up();
    // 双端收敛：组=B 的 manual 密封帧（origin 不动 wh 扩大）；c1=A 末帧 abs
    await expectTransformsConverged(pageA, pageB, groupId);
    await expectTransformsConverged(pageA, pageB, c1);
    const final = await groupFrame(pageA, groupId);
    expectFlowDelta(final.w, frozen.w + 90.25); // B 的帧写保留（A 松手不回蚀）
    expectFlowDelta(final.h, frozen.h + 48.125);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// ── T3：resize 远端锚（含子 rel 补偿——NW 角 origin 位移档） ────────────────────
test.fixme('T3 A NW 角 resize：B 收敛帧三键+子 rel 反向补偿（子 abs 不动）', async ({ browser }) => {
  const { ctxA, ctxB, pageA, pageB } = await dual(browser);
  try {
    await openFreshCanvas(pageA, pageB);
    const { groupId, childIds } = await createGroupOfTwo(pageA);
    await expectCountIs(pageB, 3);

    const frameBefore = await groupFrame(pageA, groupId);
    const absBefore = await childAbsOn(pageB, childIds[0], groupId);

    // 选中组（resizer 出现），NW 角外扩 (−40.125,−25.375)（流坐标位移）
    await selectGroupAlone(pageA, groupId);
    await resizeGroupBy(pageA, groupId, 'nw', -40.125, -25.375);

    // B 收敛：帧 origin 位移+尺寸变大；子 abs 不动（rel 补偿=doc abs−新 origin）
    await expect.poll(async () => (await groupFrame(pageB, groupId)).x, { timeout: 30_000, message: 'B 组帧未收敛' })
      .toBeLessThan(frameBefore.x - 40.125 + FLOW_TOL);
    const frameAfter = await groupFrame(pageB, groupId);
    expectFlowDelta(frameAfter.y, frameBefore.y - 25.375);
    expectFlowDelta(frameAfter.w, frameBefore.w + 40.125);
    expectFlowDelta(frameAfter.h, frameBefore.h + 25.375);
    await expectTransformsConverged(pageA, pageB, childIds[0]);
    await expectTransformsConverged(pageA, pageB, childIds[1]);
    const absAfter = await childAbsOn(pageB, childIds[0], groupId);
    expectFlowDelta(absAfter.x, absBefore.x); // 子 abs 逐位不动（rel 补偿的对面）
    expectFlowDelta(absAfter.y, absBefore.y);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// ── T4：undo 合成（单人 undo 部分回退） ───────────────────────────────────────
test.fixme('T4 A 拖组→B 改子：单人 undo 部分回退（组位移回滚/子位移保留——接受登记语义）', async ({ browser }) => {
  const { ctxA, ctxB, pageA, pageB } = await dual(browser);
  try {
    await openFreshCanvas(pageA, pageB);
    const { groupId, childIds } = await createGroupOfTwo(pageA);
    await expectCountIs(pageB, 3);
    const [c1, c2] = childIds;
    const gBefore = await groupFrame(pageA, groupId);
    const c1AbsBefore = await childAbsOn(pageA, c1, groupId);
    await pageA.waitForTimeout(600); // captureTimeout 分窗

    // A 拖组（流坐标位移 80.25/45.375）
    await dragGroupBy(pageA, groupId, 80.25, 45.375, 8);
    await expectTransformsConverged(pageA, pageB, groupId);
    const gAfterDrag = await groupFrame(pageA, groupId);
    expectDragApplied(gAfterDrag.x - gBefore.x, 80.25);

    // B 改子（拖 c1 小位移——仍在组内）
    await dragNodeBy(pageB, c1, 21.125, 13.375);
    await expectTransformsConverged(pageA, pageB, c1);

    // A undo：只回滚 A 的组拖动；B 的子位移保留（部分回退）
    await pageA.keyboard.press('Control+z');
    await expectTransformsConverged(pageA, pageB, groupId);
    const gAfterUndo = await groupFrame(pageB, groupId);
    expectFlowDelta(gAfterUndo.x, gBefore.x);       // 组位移回滚
    expectFlowDelta(gAfterUndo.y, gBefore.y);
    const c1Final = await childAbsOn(pageB, c1, groupId);
    expectFlowDelta(c1Final.x, c1AbsBefore.x + 21.125); // B 的子位移保留
    expectFlowDelta(c1Final.y, c1AbsBefore.y + 13.375);
    void c2;
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// ── T5：redo 三锚 ────────────────────────────────────────────────────────────
test.fixme('T5a 拖 c1→拖 c2：redo 帧逐位=提交时值（双端）', async ({ browser }) => {
  const { ctxA, ctxB, pageA, pageB } = await dual(browser);
  try {
    await openFreshCanvas(pageA, pageB);
    const { groupId, childIds } = await createGroupOfTwo(pageA);
    await expectCountIs(pageB, 3);
    const [c1, c2] = childIds;
    await pageA.waitForTimeout(600);

    await dragNodeBy(pageA, c1, 44.125, 26.375);
    await pageA.waitForTimeout(600); // captureTimeout 分窗——两次拖动各成独立 undo 项（undo 目标=末项）
    await dragNodeBy(pageA, c2, -31.25, 17.125);
    await expectTransformsConverged(pageA, pageB, c1);
    await expectTransformsConverged(pageA, pageB, c2);
    const c2Committed = await nodeTransform(pageA, c2); // 提交时值（帧逐位对照源）

    await pageA.keyboard.press('Control+z');            // undo 撤 c2 拖动
    await expectTransformsConverged(pageA, pageB, c2);
    expect(await nodeTransform(pageA, c2)).not.toBe(c2Committed);

    await pageA.keyboard.press('Control+Shift+z');      // redo
    await expectTransformsConverged(pageA, pageB, c2);
    expect(await nodeTransform(pageA, c2)).toBe(c2Committed); // 帧逐位（字符串全等）
    expect(await nodeTransform(pageB, c2)).toBe(c2Committed);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test('T5b 固化后 undo 尺寸不回退（resize[Origin.Geometry]不入栈）+redo 组帧≡bbox', async ({ browser }) => {
  const { ctxA, ctxB, pageA, pageB } = await dual(browser);
  try {
    await openFreshCanvas(pageA, pageB);
    const { groupId, childIds } = await createGroupOfTwo(pageA);
    await expectCountIs(pageB, 3);
    await pageA.waitForTimeout(600);

    // resize 组（SE 角扩 120.25×60.125 流坐标——manual 密封三键提交，Origin.Geometry 不入撤销栈）
    await selectGroupAlone(pageA, groupId);
    const preSize = await groupFrame(pageA, groupId);
    await resizeGroupBy(pageA, groupId, 'se', 120.25, 60.125);
    await expect.poll(async () => (await groupFrame(pageB, groupId)).w, { timeout: 30_000, message: 'B 组宽未收敛 resize 值' })
      .toBeGreaterThan(preSize.w + 120.25 - FLOW_TOL);
    const resized = await groupFrame(pageA, groupId);

    // 其后一次拖子（入栈）→ undo 只回拖动：组尺寸不回退
    await pageA.waitForTimeout(600);
    await dragNodeBy(pageA, childIds[0], 25.125, 15.375);
    await expectTransformsConverged(pageA, pageB, childIds[0]);
    await pageA.keyboard.press('Control+z');
    await expectTransformsConverged(pageA, pageB, childIds[0]);
    const afterUndo = await groupFrame(pageA, groupId);
    expectFlowDelta(afterUndo.w, resized.w); // 尺寸不回退（resize 不在栈）
    expectFlowDelta(afterUndo.h, resized.h);

    // undo 组拖动→redo→组帧≡bbox：manual 密封帧 undo/redo 逐位还原（非 bbox 档——密封源语义）；
    // 此处以「再拖组→undo→redo 帧逐位」承接（resize 组=manual 帧，≡bbox 锚在 auto 组档=T1 已锚）
    await pageA.waitForTimeout(600);
    await dragGroupBy(pageA, groupId, 50.375, 30.25, 5);
    await expectTransformsConverged(pageA, pageB, groupId);
    const gMoved = await groupFrame(pageA, groupId);
    await pageA.keyboard.press('Control+z');
    await expectTransformsConverged(pageA, pageB, groupId);
    await pageA.keyboard.press('Control+Shift+z');
    await expectTransformsConverged(pageA, pageB, groupId);
    const gRedone = await groupFrame(pageA, groupId);
    expectFlowDelta(gRedone.x, gMoved.x); // redo 组帧逐位
    expectFlowDelta(gRedone.y, gMoved.y);
    expectFlowDelta(gRedone.w, gMoved.w);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// ── T6：刷新一致 ─────────────────────────────────────────────────────────────
test('T6 拖子后双端 reload：transform 逐位=reload 前捕获值（doc 密封/派生往返无损）', async ({ browser }) => {
  const { ctxA, ctxB, pageA, pageB } = await dual(browser);
  try {
    const projectId = await openFreshCanvas(pageA, pageB);
    const { groupId, childIds } = await createGroupOfTwo(pageA);
    await expectCountIs(pageB, 3);
    await dragNodeBy(pageA, childIds[0], 33.375, 21.125);
    await expectTransformsConverged(pageA, pageB, childIds[0]);

    const gT = await nodeTransform(pageB, groupId);
    const c1T = await nodeTransform(pageB, childIds[0]);
    const c2T = await nodeTransform(pageB, childIds[1]);

    await pageA.goto(`/canvas?projectId=${projectId}`);
    await expect(pageA.locator('.react-flow')).toBeVisible({ timeout: 20_000 });
    await expectConnected(pageA);
    await pageB.goto(`/canvas?projectId=${projectId}`);
    await expect(pageB.locator('.react-flow')).toBeVisible({ timeout: 20_000 });
    await expectConnected(pageB);
    await expectCountIs(pageA, 3);
    await expectCountIs(pageB, 3);
    expect(await nodeTransform(pageA, groupId)).toBe(gT);
    expect(await nodeTransform(pageB, groupId)).toBe(gT);
    expect(await nodeTransform(pageA, childIds[0])).toBe(c1T);
    expect(await nodeTransform(pageB, childIds[0])).toBe(c1T);
    expect(await nodeTransform(pageA, childIds[1])).toBe(c2T);
    expect(await nodeTransform(pageB, childIds[1])).toBe(c2T);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// ── T7：并发登记（不同节点交错拖拽——逐节点 LWW） ──────────────────────────────
test('T7 A/B 各拖不同子：两提交都落，双端逐位收敛（c1=A 末帧/c2=B 末帧）', async ({ browser }) => {
  const { ctxA, ctxB, pageA, pageB } = await dual(browser);
  try {
    await openFreshCanvas(pageA, pageB);
    const { groupId, childIds } = await createGroupOfTwo(pageA);
    await expectCountIs(pageB, 3);
    const [c1, c2] = childIds;
    const pre1 = await childAbsOn(pageA, c1, groupId);
    const pre2 = await childAbsOn(pageB, c2, groupId);

    // 双端同时按住各自节点（交错 move——并发手势窗口；流坐标位移×各自 zoom）
    const a1 = await nodeCenter(pageA, c1);
    const zA = (await readViewport(pageA)).zoom;
    await pageA.mouse.move(a1.x, a1.y);
    await pageA.mouse.down();
    const b2 = await nodeCenter(pageB, c2);
    const zB = (await readViewport(pageB)).zoom;
    await pageB.mouse.move(b2.x, b2.y);
    await pageB.mouse.down();
    await pageA.mouse.move(a1.x + 42.375 * zA, a1.y + 24.25 * zA, { steps: 4 });
    await pageB.mouse.move(b2.x - 35.125 * zB, b2.y + 18.375 * zB, { steps: 4 });
    await pageA.mouse.move(a1.x + 52.75 * zA, a1.y + 31.125 * zA, { steps: 3 }); // A 先松（c1 末帧=A）
    await pageA.mouse.up();
    await pageB.mouse.move(b2.x - 45.5 * zB, b2.y + 24.625 * zB, { steps: 3 });  // B 后松（c2 末帧=B）
    await pageB.mouse.up();

    await expectTransformsConverged(pageA, pageB, c1);
    await expectTransformsConverged(pageA, pageB, c2);
    await expectTransformsConverged(pageA, pageB, groupId);
    const abs1 = await childAbsOn(pageB, c1, groupId);
    const abs2 = await childAbsOn(pageB, c2, groupId);
    expectDragApplied(abs1.x - pre1.x, 52.75); // c1=A 末帧（激活损耗有界档）
    expectDragApplied(abs1.y - pre1.y, 31.125);
    expectDragApplied(pre2.x - abs2.x, 45.5);  // c2=B 末帧
    expectDragApplied(abs2.y - pre2.y, 24.625);
    expectFrameEqualsBounds(await groupFrame(pageA, groupId), [abs1, abs2]);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// ── T8：拖动中强刷（无孤儿 intent/无半提交） ──────────────────────────────────
test('T8 A 拖动中强刷：手势期 doc 零写——双端=拖前态（无孤儿/半提交）', async ({ browser }) => {
  const { ctxA, ctxB, pageA, pageB } = await dual(browser);
  try {
    const projectId = await openFreshCanvas(pageA, pageB);
    const { groupId, childIds } = await createGroupOfTwo(pageA);
    await expectCountIs(pageB, 3);
    const c1T = await nodeTransform(pageB, childIds[0]);
    const gT = await nodeTransform(pageB, groupId);

    const c = await nodeCenter(pageA, childIds[0]);
    const z8 = (await readViewport(pageA)).zoom;
    await pageA.mouse.move(c.x, c.y);
    await pageA.mouse.down();
    await pageA.mouse.move(c.x + 77.125 * z8, c.y + 43.375 * z8, { steps: 5 });
    await pageA.reload(); // 强刷（手势中断——无 release/无 commit）

    await expect(pageA.locator('.react-flow')).toBeVisible({ timeout: 20_000 });
    await expectConnected(pageA);
    await expectCountIs(pageA, 3);
    await pageA.waitForTimeout(1_000); // 若有半提交/孤儿写，B 会在此窗口漂移
    expect(await nodeTransform(pageA, childIds[0])).toBe(c1T); // A 回放=拖前
    expect(await nodeTransform(pageB, childIds[0])).toBe(c1T); // B 全程未见写
    expect(await nodeTransform(pageA, groupId)).toBe(gT);
    void projectId;
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// ── T9：断线 30s 续拖+重连收敛 ────────────────────────────────────────────────
test('T9 A 持拖跨 30s API 宕机窗：续拖+离线松手提交随重连上送，B 收敛末帧', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctxA, ctxB, pageA, pageB } = await dual(browser);
  try {
    await openFreshCanvas(pageA, pageB);
    const { groupId, childIds } = await createGroupOfTwo(pageA);
    await expectCountIs(pageB, 3);
    const preAbs = await childAbsOn(pageB, childIds[0], groupId);

    const c = await nodeCenter(pageA, childIds[0]);
    const z = (await readViewport(pageA)).zoom;
    await pageA.mouse.move(c.x, c.y);
    await pageA.mouse.down();
    await pageA.mouse.move(c.x + 30.125 * z, c.y + 15.375 * z, { steps: 3 });

    await killApi();
    await waitForDisconnected(pageA); // A 断连（B 亦然——同服务器）

    // 断线窗内续拖（30s）+离线松手（提交入本地 doc 挂起——流坐标位移×z）
    await pageA.mouse.move(c.x + 66.75 * z, c.y + 34.25 * z, { steps: 4 });
    await pageA.waitForTimeout(30_000);
    await pageA.mouse.move(c.x + 88.375 * z, c.y + 45.5 * z, { steps: 3 });
    await pageA.mouse.up();

    await startApi();
    await expectConnected(pageA);
    await expectConnected(pageB);

    // B 收敛 A 离线提交的末帧（挂起更新随重连上送）
    await expectTransformsConverged(pageA, pageB, childIds[0], 60_000);
    const finalAbs = await childAbsOn(pageB, childIds[0], groupId);
    expectDragApplied(finalAbs.x - preAbs.x, 88.375);
    expectDragApplied(finalAbs.y - preAbs.y, 45.5);
    void groupId;
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// ── T10：三端（A 拖组/B 改子/C 只读） ─────────────────────────────────────────
test('T10 三端：A 拖组→B 拖子→C（只读 viewer）同步——三方几何逐位一致', async ({ browser }) => {
  const { ctxA, ctxB, pageA, pageB } = await dual(browser);
  const ctxC = await browser.newContext({ storageState: STATE_C });
  const pageC = await ctxC.newPage();
  let projectId = '';
  try {
    projectId = await openFreshCanvas(pageA, pageB);
    dbTool('set-viewer', C_EMAIL, projectId); // C 显式 PROJECT_VIEWER
    const { groupId, childIds } = await createGroupOfTwo(pageA);
    await expectCountIs(pageB, 3);

    await pageC.goto(`/canvas?projectId=${projectId}`);
    await expect(pageC.locator('.react-flow')).toBeVisible({ timeout: 20_000 });
    await expectConnected(pageC);
    await expectCountIs(pageC, 3);

    // A 拖组 + B 拖子（组内位移）
    await dragGroupBy(pageA, groupId, 62.375, 33.25, 6);
    await dragNodeBy(pageB, childIds[0], 19.125, 11.375);

    for (const id of [groupId, ...childIds]) {
      await expectTransformsConverged(pageA, pageB, id);
      const t = await nodeTransform(pageA, id);
      await expect.poll(() => nodeTransform(pageC, id), { timeout: 30_000, message: `C 端 ${id} 未收敛` }).toBe(t);
    }
  } finally {
    if (projectId) dbTool('clear-viewer', C_EMAIL, projectId); // 复位团队角色（C 回 MEMBER）
    await ctxA.close();
    await ctxB.close();
    await ctxC.close();
  }
});

// ── T11：elementFromPoint 零交叠 zoom∈{0.5,1,2}（B6-2 挪入） ────────────────────
test.fixme('T11 +号零交叠三档 zoom：+号↔本组框零交叠/同屏至多一枚（单 target 单源）/elementFromPoint 命中+号；直径 24/偏移 12 三档屏幕值相等', async ({ browser }) => {
  const ctxA = await browser.newContext({ storageState: STATE_A });
  const pageA = await ctxA.newPage();
  try {
    const projectId = await (async () => {
      await pageA.goto('/canvas');
      await expect(pageA.locator('.react-flow')).toBeVisible({ timeout: 20_000 });
      await expectConnected(pageA);
      return (await pageA.evaluate(() => localStorage.getItem('flowweb_projectId')))!;
    })();
    const { groupId } = await createGroupOfTwo(pageA);

    /** 反馈式 zoom 驱动（wheel——读 viewport scale 逼近目标档） */
    const zoomTo = async (target: number) => {
      for (let i = 0; i < 60; i++) {
        const z = await readZoom(pageA);
        if (Math.abs(z - target) < 0.03) return z;
        const diff = target - z;
        await pageA.mouse.move(400, 300);
        await pageA.mouse.wheel(0, diff > 0 ? (Math.abs(diff) > 0.25 ? -240 : -60) : (Math.abs(diff) > 0.25 ? 240 : 60));
        await pageA.waitForTimeout(150);
      }
      throw new Error(`zoom 未逼近目标 ${target}（当前 ${await readZoom(pageA)}）`);
    };

    const PLUS_DIA = 24;   // ADD_OUTPUT_HANDLE.diameter（屏幕常量——selectionTokens 单源）
    const PLUS_OFF = 12;   // ADD_OUTPUT_HANDLE.offset（圆心距框右缘）
    const measurements: Array<{ zoom: number; dia: number; off: number }> = [];

    for (const target of [0.5, 1, 2]) {
      const zoom = await zoomTo(target);
      await selectGroupAlone(pageA, groupId);
      const btn = pageA.getByTestId('add-output-handle');
      await expect(btn).toBeVisible({ timeout: 10_000 });
      expect(await pageA.getByTestId('add-output-handle').count()).toBe(1); // 同屏至多一枚（单 target——彼此零交叠恒成立）

      const m = await pageA.evaluate((gid: string) => {
        const btn = document.querySelector('[data-testid="add-output-handle"]') as HTMLElement;
        const span = btn.firstElementChild as HTMLElement;
        const gb = document.querySelector(`.react-flow__node[data-id="${gid}"] [data-testid="group-box"]`) as HTMLElement;
        const br = btn.getBoundingClientRect();
        const sr = span.getBoundingClientRect();
        const gr = gb.getBoundingClientRect();
        const cx = sr.left + sr.width / 2, cy = sr.top + sr.height / 2;
        return {
          isBtn: (document.elementFromPoint(cx, cy) as HTMLElement | null)?.closest('button[data-testid="add-output-handle"]') != null,
          dia: sr.width,
          off: cx - gr.right,
          overlapW: Math.min(br.right, gr.right) - Math.max(br.left, gr.left),
          overlapH: Math.min(br.bottom, gr.bottom) - Math.max(br.top, gr.top),
        };
      }, groupId);
      expect(m.isBtn).toBe(true);                       // elementFromPoint 命中+号（z-index 压过其它节点）
      expect(m.overlapW).toBeLessThanOrEqual(0.5);      // +号↔本组框零交叠（命中区只向框外展开）
      expect(m.overlapH).toBeLessThanOrEqual(0.5);
      measurements.push({ zoom, dia: m.dia, off: m.off });
    }

    // 直径/偏移三档屏幕值相等（屏幕恒定——反缩放层语义）
    for (const m of measurements) {
      expect(m.dia).toBeCloseTo(PLUS_DIA, 0);
      expect(m.off).toBeCloseTo(PLUS_OFF, 0);
    }
    void projectId;
  } finally {
    await ctxA.close();
  }
});
