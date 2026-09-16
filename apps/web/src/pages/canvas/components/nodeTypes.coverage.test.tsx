import { it, expect } from 'vitest'; // 第九轮补：web 侧显式导入 vitest——vite-env.d.ts 只有 vite/client、无 vitest/globals 类型声明，tsc -b 门禁下 it/expect 是 TS2304（vitest run 因 globals:true 反而能过，典型"只被 build 门禁抓到"）；全仓 244 个 web 测试文件同款惯例（CanvasView.test.tsx:1）
import { nodeTypes } from './CanvasView'; // 同目录 import（先例 CanvasView.test.tsx:3）。模块级 import 无渲染副作用——canvasCollabRuntime 顶层仅 import + let（连接惰性建），CanvasView.test.tsx 已有整图 import 先例；本测试仅 import 不渲染
import { VIDEO_WORK_NODE_TYPES } from '@flowweb/shared';

it('CanvasView nodeTypes 注册表键 ⊆ shared VIDEO_WORK_NODE_TYPES（快照白名单防演进遗漏——新增节点类型未同步清单时本测试红）', () => {
  const keys = Object.keys(nodeTypes);
  expect(keys.length).toBeGreaterThanOrEqual(8); // 现状 8 键
  for (const key of keys) expect(VIDEO_WORK_NODE_TYPES).toContain(key);
});
