// 批7 双客户端 E2E globalSetup：collab fixtures（apps/api 侧）→ 双账号真实 UI 登录 → 双 storageState。
// API 由 scripts/gate-collab.mjs 自拉（COLLAB_FAKE_AI=1）——本 setup 只探活，webServer 只管 web preview。
// 契约：账号/项目 id 常量与 apps/api/prisma/collab-gate-seed.ts 保持同值。
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5173'; // localhost——better-auth trustedOrigins 拒 127.0.0.1
const USERS = [
  { email: 'collab-a@flowweb.local', password: 'collab12345678', state: 'collab-a.json' },
  { email: 'collab-b@flowweb.local', password: 'collab12345678', state: 'collab-b.json' },
  // Spec B B7-2：C 端账号（三端用例只读端——测试经 collab-db set-viewer 降级）
  { email: 'collab-c@flowweb.local', password: 'collab12345678', state: 'collab-c.json' },
];
const HERE = import.meta.dirname!; // apps/web 是 ESM 包——无 __dirname
const AUTH_DIR = path.join(HERE, '.auth');

/** TCP 探活（global-setup.ts 同款）：API(3000) HTTP 健康由 gate 脚本负责，这里只补 3001 WS 端口 */
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

/** 真实 UI 登录（global-setup.ts 同款流程——AuthModal 链路，选择器锚定其 :108/:116） */
async function loginAndSaveState(email: string, password: string, stateFile: string): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();

  await page.goto('/login');
  await page.getByRole('button', { name: '邮箱登录' }).click();
  await page.getByPlaceholder('邮箱').fill(email);
  await page.getByPlaceholder('密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByTestId('auth-modal-backdrop')).toBeHidden({ timeout: 15_000 });

  // 会话自证：authed 路由可达（RequireAuth 无会话会 replace 到 /login）
  await page.goto('/works');
  await expect(page).toHaveURL(/\/works/);

  await context.storageState({ path: path.join(AUTH_DIR, stateFile) });
  await browser.close();
}

export default async function globalSetup() {
  execSync('pnpm exec tsx prisma/collab-gate-seed.ts', {
    cwd: path.resolve(HERE, '../../../apps/api'),
    stdio: 'inherit',
  });
  // Spec B B7-2 fixtures（collab-c/公开页作品/500 节点性能画布——幂等，specb-gate-seed.ts 同款自愈）
  execSync('pnpm exec tsx prisma/specb-gate-seed.ts', {
    cwd: path.resolve(HERE, '../../../apps/api'),
    stdio: 'inherit',
  });

  await waitForPort(3001);

  mkdirSync(AUTH_DIR, { recursive: true });
  for (const u of USERS) await loginAndSaveState(u.email, u.password, u.state);
}
