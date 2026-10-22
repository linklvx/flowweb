import path from 'path';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/modules/collab/collab-rate-gate.spec.ts', 'src/modules/collab/collab-idle-anchor.spec.ts', 'src/modules/collab/collab-heartbeat.heavy.spec.ts', 'src/modules/collab/collab-soak-t19.heavy.spec.ts'],   // heavy include 集 ≡ 主套件 vitest.config.ts exclude heavy 集——双侧同步维护（T8 Minor-1；T19 增 soak 阻断门 ~75s）
    fileParallelism: false,   // R4a'：8MB 分配与 90s 实时等待禁并行（B10 根因——同池抢 2 核）
    maxWorkers: 1,
    testTimeout: 180_000,
    exclude: [...configDefaults.exclude, '**/*.int.spec.ts', '**/*.e2e-spec.ts', 'scripts/**'],
  },
  resolve: {
    alias: { '@flowweb/shared': path.resolve(__dirname, '../../packages/shared/src') },
  },
});
