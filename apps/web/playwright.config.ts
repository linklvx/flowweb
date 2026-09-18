import { defineConfig } from '@playwright/test';

// A0-0 门禁编排（baseURL 固定 localhost——better-auth trustedOrigins 只认 http://localhost:5173，禁 127.0.0.1）：
// ① DB 迁移+seed → ② API(3000，hocuspocus collab 3001 同进程——collab.gateway.ts onModuleInit server.listen，
//    故无独立进程条目；3001 为 WS-only 端口无 HTTP 健康路径，globalSetup 里 TCP 探活) → ③ vite build && vite preview(5173，
//    代理配置在 vite.config.ts preview 段——vite preview 不读 server.proxy)。
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // 门禁串行：单 worker 防多浏览器实例并发写同一画布 doc
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  globalSetup: './e2e/global-setup.ts',
  outputDir: './test-results',
  webServer: [
    {
      command: 'pnpm exec prisma migrate deploy && pnpm exec prisma db seed && pnpm exec nest start',
      cwd: '../api',
      url: 'http://localhost:3000/api/health',
      // dev 会话的 api 与本条目同构（同一 Nest 进程模型，collab 同样随进程监听 3001），复用无害；
      // 注意复用时整条 command（含 migrate/seed）跳过——种子幂等且 dev 库即门禁库，已由 dev 进程实证迁移就绪
      reuseExistingServer: true,
      timeout: 300_000,
    },
    {
      command: 'pnpm build && pnpm exec vite preview',
      url: 'http://localhost:5173',
      // 必须 false：5173 若被 dev server 占用而复用＝静默测开发产物（且 dev 版 collabUrl 直连 3001 绕过
      // /collab 代理，WS 代理断言失效）——门禁只能测自己 build 的 preview，端口冲突即显式报错
      reuseExistingServer: false,
      timeout: 600_000,
    },
  ],
});
