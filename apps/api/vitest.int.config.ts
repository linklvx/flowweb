import path from 'path';
import { defineConfig } from 'vitest/config';

// Y0a-3（P15/Z22）：int 专用池——CollabLease 单行全局资源，文件级并行互踩；fileParallelism=false 串行。
// 运行：DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.int.spec.ts'],
    fileParallelism: false,   // CollabLease 单行——串行（Z22 根修）
  },
  resolve: {
    alias: {
      '@flowweb/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
});
