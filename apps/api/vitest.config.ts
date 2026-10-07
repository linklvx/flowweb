import path from 'path';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Y0a-3（P15/B10）：int 从默认池排除——单行 CollabLease 全局资源×文件级并行=互踩；
    // verify/test job 不再触真库。int 归 test:int（专用配置串行）。
    exclude: [...configDefaults.exclude, '**/*.int.spec.ts'],
  },
  resolve: {
    alias: {
      '@flowweb/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
});
