// apps/api/src/metrics/role-labels-dual.spec.ts
// Y0c T29（Z138 B 内容断言——spec §0.6 偏离 37 仿真形态）：真实双端点文本交集断言需 api+worker
// 双进程真跑（归 T33 D 出口 exec-smoke 双进程轮；任务级出口 hermetic 纪律不起双进程驻留）——
// 本 spec 为进程内仿真：同一全局 register 先 setDefaultLabels({role:'worker'}) 捕文本、再
// setDefaultLabels({role:'api'}) 捕文本 → 族名交集内每一族两侧样本 role 值必须不同（worker 侧
// 漏调 setDefaultLabels ⇒ 该族两侧均无 role ⇒ 红——判别力保留）。
// 正向断言操作化口径（偏离 37）：「3002 可读 yjs_store_total{role="worker"} 且值恒 0」=
// ①族已注册（register.getSingleMetric 存在=「可读」的注册面语义）②文本内出现的每个样本带
// role="worker" 且值 0、样本总和 0——**无样本视同 0**（worker 不写 doc，counter 未 inc 即无样本行；
// 幻影零值变显式承认事实）。
// A 结构断言（必须面）=census 组⑳ 既有绿（setDefaultLabels 全仓恰 main.ts+main-worker.ts 各 1，
// 模块级禁入）——零新代码，红证据归任务报告。
// 清理义务：afterAll register.clear()（di-smoke.int.spec:47 同款惯例；vitest isolate:true 文件级
// 模块表隔离——clear 影响域封在本文件内，仓内 13 处 getSingleMetric().get() 断言不受波及）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { collectDefaultMetrics, register } from 'prom-client';
import '../modules/collab/store.metrics';   // yjs_store_total 族注册（模块级 Counter——import 即注册）

collectDefaultMetrics();

/** prom 文本 → 族名 → 样本行 [{labels, value}]（#/空行跳过；样本行形态 name{labels} value 或 name value） */
function parseFamilies(text: string): Map<string, { labels: Record<string, string>; value: number }[]> {
  const families = new Map<string, { labels: Record<string, string>; value: number }[]>();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})? ([0-9.eE+-]+)$/);
    if (!m) continue;
    const labels: Record<string, string> = {};
    if (m[2]) {
      for (const lm of m[2].matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g)) labels[lm[1]] = lm[2];
    }
    const arr = families.get(m[1]) ?? [];
    arr.push({ labels, value: Number(m[3]) });
    families.set(m[1], arr);
  }
  return families;
}

// 正确仿真（先红构造=worker 侧捕文本前漏调 setDefaultLabels ⇒ 交集断言红——TEMP-RED 已回退，
// 红输出摘录归任务报告；main-worker.ts 引导层真实调用点由 census ⑳ A 结构断言钉守）。
// 捕获落 beforeAll（tsconfig.spec 禁顶层 await——语义等同：任一测试前完成双文本捕获）。
let workerText = '';
let apiText = '';
beforeAll(async () => {
  register.setDefaultLabels({ role: 'worker' });
  workerText = await register.metrics();
  register.setDefaultLabels({ role: 'api' });
  apiText = await register.metrics();
});

afterAll(() => {
  register.clear();   // 清理义务：连 _defaultLabels 一起清（Z138 机制）——恢复 register 空态
});

describe('Y0c T29 Z138 B 内容断言（偏离 37 进程内仿真）：双 role 文本交集 role 值互异', () => {
  it('族名交集非空 ∧ 交集内每一族 worker 侧样本全带 role="worker" 且 api 侧全带 role="api"（任一侧缺 role 或两侧相同即红）', () => {
    const workerFamilies = parseFamilies(workerText);
    const apiFamilies = parseFamilies(apiText);
    const intersection = [...workerFamilies.keys()].filter((f) => apiFamilies.has(f));
    expect(intersection.length, '双端点仿真文本族名交集不得为空（collectDefaultMetrics 族两侧同 register 必共）').toBeGreaterThan(0);
    for (const family of intersection) {
      for (const s of workerFamilies.get(family) ?? []) {
        expect(s.labels.role, `${family} worker 侧样本应带 role="worker"（漏调 setDefaultLabels 即缺）`).toBe('worker');
      }
      for (const s of apiFamilies.get(family) ?? []) {
        expect(s.labels.role, `${family} api 侧样本应带 role="api"`).toBe('api');
      }
    }
  });

  it('正向断言：worker 侧文本 yjs_store_total 族——出现的每个样本带 role="worker" 且值 ≡0、样本总和 ≡0（无样本=0——worker 不写 doc）', () => {
    const samples = parseFamilies(workerText).get('yjs_store_total') ?? [];
    for (const s of samples) {
      expect(s.labels.role, 'yjs_store_total 样本必带 role="worker"').toBe('worker');
      expect(s.value, 'yjs_store_total 值恒 0（worker 不写 doc）').toBe(0);
    }
    expect(samples.reduce((a, s) => a + s.value, 0)).toBe(0);
  });

  it('「可读」的注册面语义：register.getSingleMetric("yjs_store_total") 存在（3002 承载面=MetricsCoreModule+collab 指标单源在 worker 装配）', () => {
    expect(register.getSingleMetric('yjs_store_total')).toBeTruthy();
  });
});
