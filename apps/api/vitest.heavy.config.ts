import path from 'path';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/modules/collab/collab-rate-gate.spec.ts', 'src/modules/collab/collab-idle-anchor.spec.ts', 'src/modules/collab/collab-heartbeat.heavy.spec.ts'],
    fileParallelism: false,   // R4a'：8MB 分配与 90s 实时等待禁并行（B10 根因——同池抢 2 核）
    maxWorkers: 1,
    testTimeout: 180_000,
    // 过渡容错（偏离）：heartbeat.heavy T9 才建——include 列表一次到位（plan v3 不变），
    // T9 前无匹配文件 vitest 默认 exit 1，passWithNoTests 消化；T9 落地后无影响。
    passWithNoTests: true,
    exclude: [...configDefaults.exclude, '**/*.int.spec.ts', 'scripts/**'],
  },
  resolve: {
    alias: { '@flowweb/shared': path.resolve(__dirname, '../../packages/shared/src') },
  },
});
