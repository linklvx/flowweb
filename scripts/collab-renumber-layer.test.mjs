// scripts/collab-renumber-layer.test.mjs —— T18：CLI renumber-layer 元测试。
// 纯函数面（shared planner 的 DB 编排壳）：dry-run 零写语义/主入口守卫。真 PG 幂等往返属
// 手工验收（两轮零变更——dev 库实跑，见 commit message 记录）；规划单源行为测在
// packages/shared/src/canvas/renumber-layer.test.ts（vitest）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('模块可导入且不触发 main（直跑守卫——import 面=纯函数导出零副作用）', async () => {
  const mod = await import('./collab-renumber-layer.mjs');
  assert.equal(typeof mod.renumberProject, 'function');
  assert.equal(typeof mod.listProjectIds, 'function');
});

test('★T19（P2#7）listProjectIds 并集：CanvasDoc ∪ CanvasDocUpdate（updates-only doc 不再整体漏掉）+ 排序去重', async () => {
  const { listProjectIds } = await import('./collab-renumber-layer.mjs');
  const queries = [];
  const fakeClient = {
    query: async (sql) => {
      queries.push(sql);
      if (sql.includes('FROM "CanvasDocUpdate"')) {
        return { rows: [{ projectId: 'p-updates-only' }, { projectId: 'p-both' }, { projectId: 'p-updates-only' }] };   // DISTINCT 在 SQL——mock 含重复形态亦验归并
      }
      return { rows: [{ projectId: 'p-state-only' }, { projectId: 'p-both' }] };
    },
  };
  const ids = await listProjectIds(fakeClient);
  // 并集三源形态全可见（改前红=只查 CanvasDoc——p-updates-only 漏）；sort 稳定
  assert.deepEqual(ids, ['p-both', 'p-state-only', 'p-updates-only']);
  assert.equal(queries.length, 2, '两源各一查（CanvasDoc+CanvasDocUpdate DISTINCT）');
});

test('用法守卫：无 projectId 且无 --all ⇒ usage 退出码 2（fail-closed 非静默空跑）', async () => {
  // main 仅在直跑时执行（isMain 守卫）——子进程直跑无参形态断言
  const { execFileSync } = await import('node:child_process');
  const path = await import('node:path');
  const url = await import('node:url');
  const script = path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'collab-renumber-layer.mjs');
  let failed = false;
  try {
    execFileSync(process.execPath, [script], { stdio: 'pipe' });
  } catch (e) {
    failed = true;
    assert.equal(e.status, 2, '退出码=2（usage 档）');
    assert.match(String(e.stderr), /用法: node scripts\/collab-renumber-layer\.mjs/);
  }
  assert.ok(failed, '无参必须非零退出');
});
