// 批7 E2E 装置帮助：gate 控制面（起/杀 API 子进程）+ DB 工具 + 画布操作原语。
// gate 控制面由 scripts/gate-collab.mjs 提供（HTTP :3100）——playwright webServer 自起的服务杀不掉，
// 故 API 进程归 gate 脚本所有，测试经控制面掐/拉。
import { execSync } from 'node:child_process';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

const HERE = import.meta.dirname!;
const API_CWD = path.resolve(HERE, '../../../apps/api');

export const COLLAB_GATE = {
  aEmail: 'collab-a@flowweb.local',
  bEmail: 'collab-b@flowweb.local',
  projectId: 'collab-gate-canvas',
};

// ── gate 控制面 ──────────────────────────────────────────────────────────────

const CONTROL = process.env.COLLAB_E2E_API_CONTROL ?? 'http://127.0.0.1:3100';

async function control(action: string): Promise<any> {
  const res = await fetch(`${CONTROL}/${action}`, { method: 'POST' });
  if (!res.ok) throw new Error(`api-control /${action} -> HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

/** 杀 API 子进程（树杀——3000/3001 同进程），等待端口关闭后返回 */
export const killApi = () => control('kill');
/** 重拉 API 子进程（同 env：COLLAB_FAKE_AI=1 等），等待 3000 健康 + 3001 listen 后返回 */
export const startApi = () => control('start');

// ── DB 工具（apps/api/prisma/collab-db.ts 一次一命令） ───────────────────────

export function dbTool(...args: string[]): any {
  const out = execSync(`pnpm exec tsx prisma/collab-db.ts ${args.join(' ')}`, {
    cwd: API_CWD,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const line = out.trim().split(/\r?\n/).pop() ?? '';
  return JSON.parse(line);
}

export function latestIntentStatus(projectId: string, nodeId: string): { status: string; intentId: string } | null {
  return dbTool('intent-status', projectId, nodeId);
}

// ── 画布操作原语 ─────────────────────────────────────────────────────────────

/** 打开协作画布并等「已连接」（SaveStatusIndicator——connStatus=connected 的唯一 UI 投影） */
export async function openCanvasConnected(page: Page, projectId: string): Promise<void> {
  await page.goto(`/canvas?projectId=${projectId}`);
  await expect(page.locator('.react-flow')).toBeVisible({ timeout: 20_000 });
  await expectConnected(page);
}

export function expectConnected(page: Page) {
  return expect(page.getByText('已连接').first()).toBeVisible({ timeout: 30_000 });
}

/** 指示器离开「已连接」（断连判据——offline/connecting 均不含该文案） */
export async function waitForDisconnected(page: Page, timeout = 20_000): Promise<void> {
  await expect(page.getByText('已连接').first()).toBeHidden({ timeout });
}

/** 经「添加节点菜单」加节点（真实 UI 写路径：addNode → dispatchCanvasIntent → doc）。
 *  条目名锚定 ^：菜单可访问名=label+desc 拼接（如「图片 海报、分镜、角色设计」），
 *  不锚定会同时命中「扩展图片」「堆叠图片」等（strict mode violation——S3 首跑实证）。 */
export async function addNodeViaMenu(page: Page, itemLabel: string): Promise<void> {
  await page.getByRole('button', { name: '添加节点', exact: true }).click();
  await page.getByRole('menu', { name: '添加节点菜单' }).getByRole('menuitem', { name: new RegExp(`^${itemLabel}`) }).click();
}

export function nodeCount(page: Page) {
  return page.locator('.react-flow__node').count();
}

/** 等画布节点数达到 n（协作同步到达判据） */
export async function expectNodeCount(page: Page, n: number, timeout = 30_000): Promise<void> {
  await expect.poll(async () => nodeCount(page), { timeout, message: `节点数未达到 ${n}` }).toBeGreaterThanOrEqual(n);
}

/** 画布上最新出现的节点 id（react-flow DOM data-id）——用于执行/断言锚定 */
export async function latestNodeId(page: Page): Promise<string> {
  const ids = await page.locator('.react-flow__node').evaluateAll((els) =>
    els.map((e) => (e as HTMLElement).dataset.id ?? ''),
  );
  const id = ids.filter(Boolean).pop();
  if (!id) throw new Error('画布上无节点');
  return id;
}

/** 在页面上下文内以登录态发起生成（真实链路：enqueue → BullMQ → execute → exec map/doc 写）。
 *  Y0b-2 T7：enqueue 受理门 stateVector 必填——从页面 Y.Doc 取（__flowwebGetSv 只读缝，canvasCollabRuntime
 *  挂载；页面须先 openCanvasConnected 否则 SV undefined=服务端必拒）。
 *  regenToken 必传（每次新 UUID——对齐真实 UI 的手势 token 语义）：stalled 重排的可重入 claim 依赖
 *  job.data.regenToken 与在飞意图行匹配——不传则走内容键路径，撞活跃 partial unique → NodeBusy
 *  静默失败（job "完成"但零副作用——S3 3b 首跑实证）。 */
export async function enqueueExecution(page: Page, projectId: string, nodeId: string): Promise<string> {
  return page.evaluate(async ({ projectId: pid, nodeId: nid }) => {
    const sv = (window as any).__flowwebGetSv?.();
    if (!sv) throw new Error('页面 Y.Doc 未就绪（须先 openCanvasConnected）——stateVector 不可得');
    const res = await fetch('/api/execution/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: pid, nodeId: nid, regenToken: crypto.randomUUID(), stateVector: sv }),
    });
    const json = await res.json();
    if (!res.ok || json.code !== 0) throw new Error(`enqueue failed: HTTP ${res.status} ${JSON.stringify(json)}`);
    return json.data.jobId as string;
  }, { projectId, nodeId });
}

// ── AI 执行态信号（ImageGenNode：⏳ 生成中... = exec map loading 的唯一 UI 投影） ──
// 采样用 textContent 含判断（探针实证）：fake 窗口仅 ~2.4s，waitFor(visible) 的可见性判定
// 在节点堆叠场景偶发漏采（S3 首两跑）——textContent 轮询 100% 捕获。

async function nodeLoadingFlag(page: Page, nodeId: string): Promise<boolean> {
  return page.locator(`.react-flow__node[data-id="${nodeId}"]`)
    .evaluate((el) => (el.textContent ?? '').includes('生成中'))
    .catch(() => false);
}

export async function expectNodeLoading(page: Page, nodeId: string, timeout = 30_000): Promise<void> {
  await expect.poll(() => nodeLoadingFlag(page, nodeId), { timeout, message: 'B 端未捕获 loading 窗口（exec map loading 未达）' }).toBe(true);
}

/** loading 收敛判据——「不永转圈」：生成中 标记消失（done/error 均满足；终态后节点回落占位图） */
export async function expectNodeNotLoading(page: Page, nodeId: string, timeout = 150_000): Promise<void> {
  await expect.poll(() => nodeLoadingFlag(page, nodeId), { timeout, message: '节点未在窗口内退出 loading（永转圈）' }).toBe(false);
}
