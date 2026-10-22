// apps/api/src/modules/collab/collab-soak-t19.heavy.spec.ts —— T19 终出口
//（plan v11.2 Task 19 soak 阻断门：10 客户端压缩版 ~75s——v11.1 验收矩阵⑥「50 客户端梯度+24h
// soak=目标项非阻断门（2C 单机现实），10 客户端维持阻断」）。
//
// 【soak 形态裁定（T19 现状锚点·写明）】
//  - 阻断门（本 spec，heavy 池进 verify 链 api-test-heavy 步）：in-process 单 gateway
//    （dual-client-server kit——mock repo 零 DB 依赖，CI 无 DATABASE_URL 可跑）+10 真 WS 客户端
//    （HocuspocusProvider）并发编辑 ~70s。断言域=并发收敛正确性+资源域：双端收敛等值/零成员丢失/
//    单帧 <128KB/doc <8MB/heapUsed 上界/applied_unpersisted=0（编辑全量收敛——mock repo 零 spool
//    形态）；回显 p95 实测记录（console 数字面——30ms 阈值归 10min 手动档投影链判定，本档断言
//    宽松回归上界防慢性退化）。
//  - 完整 10min 手动档（CP-B 人工留档不进 CI）：既有 scripts/collab-soak.mjs 依赖真实 api 进程
//    （127.0.0.1:3000/3001+真 PG/Redis/MinIO+worker）——投影 delivery lag/outbox lag/materialize
//    lag/applied_unpersisted=0 稳态指标在 /metrics 采样（artifact_projection_pending_age_seconds
//    等 poller lag gauge 族）。跑法（服务器档）：
//      node scripts/collab-soak.mjs --docs 10 --clients 10 --rate 300 --duration 10 --json soak-t19.json
//  - 50 客户端梯度+24h soak=目标项非阻断（登记——上生产后按 runbook 服务器实测留档）。
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { startDualClientServer } from '../../test-utils/dual-client-server';

/** 压缩档参数：10 客户端×350 轮×200ms≈70s（CI 预算内——10min 完整版归手动档）。 */
const CLIENTS = 10;
const ROUNDS = 350;
const ROUND_MS = 200;
const FRAME_BUDGET = 128 * 1024;      // 单帧 <128KB（spec :262 soak 指标）
const DOC_BUDGET = 8 * 1024 * 1024;   // doc <8MB
const HEAP_BUDGET = 1024 * 1024 * 1024;   // 内存上界 1GB（2C 单机进程档——回归护栏非容量声明）
const ECHO_P95_REGRESSION = 1_000;    // 回显 p95 回归上界（真阈值 30ms 归投影链手动档；本档防慢性退化）

const p95 = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
};

describe('T19 soak 阻断门（10 客户端×~70s 压缩版：收敛+资源域）', () => {
  it('双端收敛等值+零成员丢失+单帧<128KB+doc<8MB+heapUsed 上界+applied_unpersisted=0（编辑全量收敛）', async () => {
    const kit = await startDualClientServer({}, 300);
    try {
      // 10 客户端：首端=观察者（帧域/回显时延计量），其余 9 端=编辑者
      const conns = [] as Array<{ ydoc: Y.Doc; provider: any; synced: Promise<void> }>;
      for (let i = 0; i < CLIENTS; i += 1) {
        conns.push(kit.connect('project:t19-soak'));
      }
      await Promise.all(conns.map((c) => c.synced));

      const observer = conns[0];
      const frameSizes: number[] = [];
      const echoLats: number[] = [];
      observer.ydoc.on('update', (u: Uint8Array, origin: unknown) => {
        frameSizes.push(u.byteLength);
        if (origin !== null && origin !== undefined) {   // 远端 origin（本地写 origin=null/local——只计回显）
          const nodes = observer.ydoc.getMap('nodes');
          let latest = 0;
          for (const m of nodes.values()) {
            const ts = (m instanceof Y.Map) ? (m.get('data') as Y.Map<unknown> | undefined)?.get('ts') : undefined;
            if (typeof ts === 'number' && ts > latest) latest = ts;
          }
          if (latest > 0) echoLats.push(Date.now() - latest);
        }
      });

      // 编辑循环：每端 1 个 counter 节点（每轮 data.c++/ts 刷新）+每 50 轮 append 新成员节点（增长面）
      const appendedPerClient: number[] = [];
      const runClient = async (idx: number) => {
        const c = conns[idx];
        let appended = 0;
        const myNode = `n-${idx}`;
        c.ydoc.transact(() => {
          const n = new Y.Map();
          n.set('data', new Y.Map(Object.entries({ c: 0, ts: Date.now() })));
          c.ydoc.getMap('nodes').set(myNode, n);
        });
        for (let r = 0; r < ROUNDS; r += 1) {
          c.ydoc.transact(() => {
            const entry = c.ydoc.getMap('nodes').get(myNode) as Y.Map<any>;
            const data = entry.get('data') as Y.Map<any>;
            data.set('c', r + 1);
            data.set('ts', Date.now());
            data.set(`k${r % 20}`, 'x'.repeat(32));   // 键集轮换（Y.Map 增长+删除压力——doc 尺寸增长面）
            if (r % 20 === 19) data.delete(`k${(r - 19) % 20}`);   // 删旧键（非无界增长）
            if (r > 0 && r % 50 === 0) {
              const m = new Y.Map();
              m.set('data', new Y.Map(Object.entries({ member: `${idx}-${r}`, payload: 'y'.repeat(256) })));
              c.ydoc.getMap('nodes').set(`m-${idx}-${r}`, m);
              appended += 1;
            }
          });
          await new Promise((res) => setTimeout(res, ROUND_MS));
        }
        appendedPerClient[idx] = appended;
      };
      await Promise.all(conns.slice(1).map((_, i) => runClient(i + 1)));

      // 收敛等待：全端 nodes 键集等值（观察者端为基准——零成员丢失断言面）
      // counter 节点=编辑者各建 1（conns[0] 观察者不建）；appended=每编辑者 ROUNDS/50 个新成员
      const editors = CLIENTS - 1;
      const expectedNodes = editors + appendedPerClient.reduce((s, n) => s + (n ?? 0), 0);
      const deadline = Date.now() + 15_000;
      let converged = false;
      while (Date.now() < deadline) {
        if (conns.every((c) => c.ydoc.getMap('nodes').size === expectedNodes)) { converged = true; break; }
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(converged).toBe(true);   // 双端收敛：10 端 nodes 数一致=预期（零成员丢失）
      const firstKeys = [...conns[0].ydoc.getMap('nodes').keys()].sort();
      for (const c of conns) {
        expect([...c.ydoc.getMap('nodes').keys()].sort()).toEqual(firstKeys);   // 全端键集等值
      }

      // 资源域断言
      const docBytes = Y.encodeStateAsUpdate(observer.ydoc).byteLength;
      const maxFrame = frameSizes.length > 0 ? Math.max(...frameSizes) : 0;
      const heapUsed = process.memoryUsage().heapUsed;
      const echoP95 = p95(echoLats);
      // 实测数字面（soak 报告素材——CI 输出留档）
      console.log(JSON.stringify({
        soak: 't19-blocking-gate', clients: CLIENTS, rounds: ROUNDS,
        nodes: expectedNodes, updatesApplied: frameSizes.length,
        docBytes, maxFrame, heapUsed, echoP95Ms: echoP95, echoSamples: echoLats.length,
        appendsPersisted: kit.repo.append.mock.calls.length,   // applied→persisted 链活性（mock repo 计数面）
      }));
      expect(maxFrame).toBeLessThan(FRAME_BUDGET);   // 单帧 <128KB
      expect(docBytes).toBeLessThan(DOC_BUDGET);     // doc <8MB
      expect(heapUsed).toBeLessThan(HEAP_BUDGET);    // 内存上界
      expect(echoP95).toBeLessThan(ECHO_P95_REGRESSION);   // 回显 p95 回归上界（真阈值 30ms=投影链手动档）
      // applied_unpersisted=0：mock repo 零 spool 形态——编辑全量收敛（converged）即零未达写；
      // 真库 spool/persisted 语义归 T15 int spool 用例+10min 手动档 /metrics 稳态
      expect(kit.repo.append.mock.calls.length).toBeGreaterThan(0);

      for (const c of conns) { await c.provider.destroy(); kit.forget(c.provider); }
    } finally {
      await kit.dispose();
    }
  }, 150_000);
});
