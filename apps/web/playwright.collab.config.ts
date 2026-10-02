import { defineConfig } from '@playwright/test';

// 批7 双客户端 E2E（collab 断连恢复发布门禁）专用编排——与 playwright.config.ts（A0-0 环境门禁）分家：
// ① API 不归 playwright 管：webServer 自起的服务杀不掉（v5.7 注记），杀/重启 API 由
//    scripts/gate-collab.mjs 自拉子进程 + HTTP 控制面（:3100）承担，测试经 collab-helpers 的
//    killApi/startApi 操纵（env COLLAB_FAKE_AI=1/COLLAB_SWEEP_ENABLED=true 在彼处注入）；
// ② globalSetup 双账号登录（collab-a/collab-b storageState）——双 browser context 模拟双客户端；
// ③ 串行：单 worker 防多浏览器实例并发写同一画布 doc。
export default defineConfig({
  testDir: './e2e',
  // R2 批尾（2d-8 Step 4b）新增 collab-r2-commands 同设施双端回归——testMatch 从单文件字面量扩为正则
  testMatch: /collab-(recovery|r2-commands)\.e2e\.spec\.ts/,
  timeout: 240_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173', // localhost——better-auth trustedOrigins 只认 5173，禁 127.0.0.1
    trace: 'retain-on-failure',
  },
  globalSetup: './e2e/collab-global-setup.ts',
  outputDir: './test-results/collab',
  webServer: [
    {
      // 仅 web preview（/api、/collab WS 代理在 vite.config.ts preview 段——代理目标是 gate 拉起的 API）
      // reuse 必须 false：5173 被 dev server 占用而复用＝静默测开发产物（dev 版 collabUrl 直连 3001
      // 绕过 /collab 代理）——同 playwright.config.ts 注记
      command: 'pnpm build && pnpm exec vite preview',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 600_000,
    },
  ],
});
