// A0-0 门禁环境冒烟：preview 产物 + /api 代理 + localhost 会话 + /collab WS 代理 + fixtures 生效。
// fixtures 由 e2e/global-setup.ts 经 apps/api/prisma/gate-seed.ts 生成（gate@flowweb.local / gate-canvas-1）。
// 加载稳定性纪律：目标元素出现即断言，固定超时上限；禁 networkidle（socket.io/ws 长连接 + antd 动画永不安定）。
import { test, expect } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/user.json' });

test('登录页在 preview 下渲染且 /api 代理连通', async ({ page }) => {
  // 页面自身发起的真实 API 请求（WeChatQRLogin 挂载即取 wechat/config）——经 preview /api 代理到达 API 的实证
  const wechatConfig = page.waitForResponse((r) => r.url().includes('/api/auth/wechat/config'));
  await page.goto('/login');
  await expect(page.getByRole('button', { name: '邮箱登录' })).toBeVisible();
  await expect((await wechatConfig).status()).toBeLessThan(500); // 5xx/断代理（502）即门禁失败
});

test('fixture USER 会话经 localhost 进入工作空间', async ({ page }) => {
  await page.goto('/works');
  await expect(page).toHaveURL(/\/works/); // RequireAuth 无会话会 replace 到 /login——URL 即 trustedOrigins 判据
  await expect(page.getByText('A0-0 门禁画布').first()).toBeVisible({ timeout: 15_000 });
});

test('React Flow 画布页经 /collab WS 代理同步协作文档', async ({ page }) => {
  await page.goto('/canvas?projectId=gate-canvas-1');
  await expect(page.locator('.react-flow')).toBeVisible({ timeout: 20_000 });
  // 强判据：节点只经 server doc 同步到达（测试上下文 localStorage 无该画布快照）——
  // 两 fixture 节点可见 = WS 经 preview /collab 代理（ws:true）双向打通
  await expect(page.locator('.react-flow__node[data-id="gate-node-1"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.react-flow__node[data-id="gate-node-2"]')).toBeVisible();
  // 辅判据：SaveStatusIndicator「已连接」仅 synced 后置位；canvasCollabRuntime 10s 兜底也会置位，
  // 故窗口压到 9s 内出现以区分真实同步与兜底
  await expect(page.getByText('已连接').first()).toBeVisible({ timeout: 9_000 });
});

test('/videos 列表渲染 fixture 视频', async ({ page }) => {
  await page.goto('/videos');
  await expect(page.getByText('A0-0 门禁样例视频').first()).toBeVisible({ timeout: 15_000 });
});
