import path from 'path';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Y0a-3（P15/B10）：int 从默认池排除——单行 CollabLease 全局资源×文件级并行=互踩；
    // verify/test job 不再触真库。int 归 test:int（专用配置串行）。
    // Y0c T0.5 回归根修：apps/api/scripts=node:test 运维装置面（soak/exec-smoke 等），
    // 归 verify 链 scripts-node-test 步（node --test 直跑）——禁 vitest glob 误收（node:test
    // 文件在 vitest 运行时必炸，api-test 步假红）。
    exclude: [...configDefaults.exclude, '**/*.int.spec.ts', 'scripts/**'],
  },
  resolve: {
    alias: {
      '@flowweb/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
});
