// A0-0 门禁 globalSetup：fixtures（apps/api 侧脚本）→ collab 端口探活 → 真实 UI 登录 → storageState。
// 契约：账号/ID 常量与 apps/api/prisma/gate-seed.ts 保持同值。
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5173'; // localhost——better-auth trustedOrigins 拒 127.0.0.1
const GATE_USER = { email: 'gate@flowweb.local', password: 'gate12345678' };
// apps/web 是 ESM 包（"type":"module"）——无 __dirname，用 import.meta.dirname
const HERE = import.meta.dirname!;
const STATE_FILE = path.join(HERE, '.auth', 'user.json');

/** TCP 探活：hocuspocus collab(3001) 与 API 同进程但无 HTTP 健康路径（WS-only），
 *  webServer 的 3000 健康检查不保证 3001 已 listen——此处显式等端口，失败报清晰错误。 */
function waitForPort(port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const socket = net.connect({ port, host: '127.0.0.1' });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`port ${port} not accepting connections within ${timeoutMs}ms`));
        else setTimeout(tryOnce, 500);
      });
    };
    tryOnce();
  });
}

export default async function globalSetup() {
  // (a)(b) fixtures：USER/画布/模板/视频——必须在 apps/api 包内跑（auth.api.signUpEmail 及其依赖按文件位置解析）
  execSync('pnpm exec tsx prisma/gate-seed.ts', {
    cwd: path.resolve(HERE, '../../../apps/api'),
    stdio: 'inherit',
  });

  await waitForPort(3001);

  // (c) 真实 UI 登录：浏览器填 /login 表单提交（非 API 直造 session），cookie 随 5173 同源落下
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();

  await page.goto('/login');
  await page.getByRole('button', { name: '邮箱登录' }).click(); // WeChatQRLogin 内的备选登录入口 → AuthModal
  await page.getByPlaceholder('邮箱').fill(GATE_USER.email);
  await page.getByPlaceholder('密码').fill(GATE_USER.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  // AuthModal 登录成功即 onClose()，无页面跳转（AuthModal.tsx:33-34）——以弹层消失为完成信号
  await expect(page.getByTestId('auth-modal-backdrop')).toBeHidden({ timeout: 15_000 });

  // 会话自证：authed 路由可达且渲染 fixture 内容（RequireAuth 无会话会 replace 到 /login）
  await page.goto('/works');
  await expect(page).toHaveURL(/\/works/);
  await expect(page.getByText('A0-0 门禁画布').first()).toBeVisible({ timeout: 15_000 });

  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  await context.storageState({ path: STATE_FILE });
  await browser.close();
}
