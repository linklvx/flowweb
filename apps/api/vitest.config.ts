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
    exclude: [...configDefaults.exclude, '**/*.int.spec.ts', 'scripts/**',
      'src/modules/collab/collab-rate-gate.spec.ts', 'src/modules/collab/collab-idle-anchor.spec.ts',
      'src/modules/collab/collab-heartbeat.heavy.spec.ts'],   // R4a'：heavy 文件移出主套件（vitest.heavy.config 串行跑——v3 增 heartbeat.heavy；防双跑假隔离）——本 exclude heavy 集 ≡ heavy include 集，双侧同步维护（T8 Minor-1）
  },
  resolve: {
    alias: {
      '@flowweb/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
});
