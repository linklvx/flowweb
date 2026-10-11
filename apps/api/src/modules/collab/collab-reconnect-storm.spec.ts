// apps/api/src/modules/collab/collab-reconnect-storm.spec.ts
// Y0b-3 T11 Step 3bis：重连风暴演练（plan v3 硬判据——部署窗口 N 客户端同时重连的准生产证据，
// 常驻=准入门：未来 admission 管线改动若破坏"一次部署不批量 4205"前提，此锚必红）。
// 装置=dual-client-server 单实例真 listen（真握手+真认证管线），N=50 客户端（csv+cookie 全通道）
// 同 doc 建立→全部断开→**同一 tick 同时重连**（50 个 HocuspocusProvider 构造于同一同步块=真同时握手）。
// 拓扑对齐生产：COLLAB_TRUSTED_PROXY='1'+逐客户端 X-Real-IP（nginx 同机+X-Real-IP 的装置镜像——
// 升级限流桶 per-IP capacity 20 常量，单桶最坏形态会在第 21+ 握手 429〔那是限流器自己的 spec 的对象〕，
// 生产 50 客户端=50 独立 IP=50 独立桶，演练按同拓扑逐客户端独立 IP）。
// 五判据（plan T11 Step 3bis）：
// ①全部 authenticated ≤30s——可观测代理='synced'（认证先于同步，synced≤30s 强于 authenticated≤30s）；
// ②零 4205/4408——由演练客户端记录的原始 ws close code 断言（v3.1 F9：库自发码唯一可观测面=客户端）；
// ③collab_auth_inflight 峰值≤4——gateway authInflightPeak（演练前置零——槽位口径，含 deadline 释放）；
// ④collab_unhandled_rejection_total 与 collab_overload_state{tripped} 均不增；
// ⑤进程级未认证文档积压峰值<50（硬判据——否则一次部署即批量 4205）。库 getPendingDocumentCount
//  是 ClientConnection 单连接方法（hocuspocus-server.esm.js:1038，无进程级注册表）⇒ 进程级聚合=
//  演练内包一层 handleConnection 捕获全部连接实例求和（close 后 hookPayloads 清空=closed 连接自然
//  归零贡献）；旁证采样 hocuspocus.loadingDocuments.size（进程级装载中文档）。
// 认证 stub 微任务级解析=本演练是准入管线的**最优时序**下界证据；生产 DB 毫秒级延迟由
//  INFLIGHT_MAX=4+AUTH deadline 3s 兜底（§3.1bis 序），spec §3.6 以本锚+防线单测合围。
// env 纪律：TRUSTED_PROXY 在 it 体内 save/restore（仓惯例 collab-admin-auth.guard.spec——防 worker 内泄漏）。
import { describe, it, expect } from 'vitest';
import { register } from 'prom-client';
import type { WebSocket as WsSocket } from 'ws';
import { startDualClientServer, type DualClientKit } from '../../test-utils/dual-client-server';

const N = 50;
const ALL_SYNCED_DEADLINE_MS = 30_000;
/** 演练客户端独立限流键（per-IP 桶）——i 固定映射，两波同客户端同 IP（真实重连语义） */
const clientIp = (i: number) => `10.0.${Math.floor(i / 250) + 1}.${(i % 250) + 1}`;

/** prom 单指标取值（rejection=Counter 多 label 求和；overload=取 state=tripped series） */
async function metricSnapshot(): Promise<{ rejection: number; tripped: number }> {
  const rejection = register.getSingleMetric('collab_unhandled_rejection_total');
  const overload = register.getSingleMetric('collab_overload_state');
  const r = rejection ? await rejection.get() : { values: [] };
  const o = overload ? await overload.get() : { values: [] };
  return {
    rejection: r.values.reduce((s, v) => s + v.value, 0),
    tripped: o.values.find((v) => v.labels.state === 'tripped')?.value ?? 0,
  };
}

describe('Y0b-3 T11 重连风暴演练（N=50——plan v3 硬判据）', () => {
  it('50 客户端全部断开后同时重连：全 synced≤30s+零 4205/4408+inflight≤4+rejection/overload 不增+pending 峰值<50', async () => {
    const prevTrusted = process.env.COLLAB_TRUSTED_PROXY;
    process.env.COLLAB_TRUSTED_PROXY = '1';   // T11 演练拓扑=生产拓扑（部署清单第 1 项的装置镜像）；trustedProxyEnabled 每升级现读 env
    const kit: DualClientKit = await startDualClientServer();
    const conns: Array<{ getPendingDocumentCount(): number }> = [];
    const hp = (kit.gateway as unknown as { server: { hocuspocus: Record<string, unknown> } }).server.hocuspocus;
    // 进程级 pending 聚合的唯一可行面：包一层 handleConnection 捕获连接实例（测试装置形态——
    // 生产代码零改动；close 清 hookPayloads 后 closed 连接贡献恒 0，无需摘除）
    const origHandleConnection = (hp.handleConnection as (...a: unknown[]) => unknown).bind(hp);
    hp.handleConnection = (...args: unknown[]) => {
      const conn = origHandleConnection(...args) as { getPendingDocumentCount(): number };
      conns.push(conn);
      return conn;
    };
    const before = await metricSnapshot();

    try {
      // Phase 1：N 客户端各自 doc 全建立（部署窗口真实形态——各浏览器各画布）
      const firstWave = Array.from({ length: N }, (_, i) =>
        kit.connect(`storm-doc-${i}`, undefined, { extraHeaders: { 'x-real-ip': clientIp(i) } }),
      );
      await Promise.all(firstWave.map((s) => s.synced));

      // Phase 2：全部断开（self-managed destroy+forget——双 destroy 是仓内已知 flaky 源）
      await Promise.all(firstWave.map(async (s) => { await s.provider.destroy(); kit.forget(s.provider); }));

      // Phase 3：同一同步块构造 N 个新客户端=真同时重连；原始 ws 挂 close/error 记录（判据②——
      // close code 面（4205/4408 库自发码）+error 面（升级 429/403 在握手期=ws error 非 close code）
      const closeCodes: number[] = [];
      const wsErrors: string[] = [];
      (kit.gateway as unknown as { authInflightPeak: number }).authInflightPeak = 0;   // 演练专用前置零
      let pendingPeak = 0;
      let loadingPeak = 0;
      const sample = () => {
        const total = conns.reduce((s, c) => { try { return s + c.getPendingDocumentCount(); } catch { return s; } }, 0);
        pendingPeak = Math.max(pendingPeak, total);
        loadingPeak = Math.max(loadingPeak, (hp.loadingDocuments as Map<string, unknown>).size);
      };
      const sampler = setInterval(sample, 5);
      let secondWave: Array<{ provider: unknown; synced: Promise<void> }> = [];
      try {
        secondWave = Array.from({ length: N }, (_, i) =>
          kit.connect(`storm-doc-${i}`, undefined, {
            extraHeaders: { 'x-real-ip': clientIp(i) },   // 同客户端同 IP——真实重连拓扑
            onSocket: (ws: WsSocket) => {
              ws.on('close', (code: number) => closeCodes.push(code));
              ws.on('error', (err: Error) => wsErrors.push(err.message));
            },
          }),
        );
        sample();   // 同步构造后即采——全 pending 零认证处理的瞬时最坏点
        // 判据①：race 超时侧只 resolve 不 reject（败者 promise 悬挂无 unhandled rejection 面）
        const outcome = await Promise.race([
          Promise.all(secondWave.map((s) => s.synced)).then(() => 'all-synced' as const),
          new Promise((resolve) => setTimeout(() => resolve('timeout' as const), ALL_SYNCED_DEADLINE_MS)),
        ]);
        expect(outcome).toBe('all-synced');
      } finally {
        clearInterval(sampler);
        sample();   // 收尾终采
      }

      // 装置活性断言（聚合面非空真——两波各 N 连接全被捕获）
      expect(conns.length).toBe(2 * N);
      // 演练数字留档（T11 出口报告引用；后续回归此行即基线）
      console.error(
        `[storm-drill] N=${N} conns=${conns.length} closeCodes=${closeCodes.length} wsErrors=${wsErrors.length} authInflightPeak=${(kit.gateway as unknown as { authInflightPeak: number }).authInflightPeak} pendingPeak=${pendingPeak} loadingPeak=${loadingPeak}`,
      );
      // 判据②：客户端记录的 close code 零 4205/4408+零握手期 error（升级 429/403 形态）
      expect(closeCodes.filter((c) => c === 4205 || c === 4408)).toEqual([]);
      expect(wsErrors).toEqual([]);
      // 判据③：在飞认证峰值≤INFLIGHT_MAX=4
      expect((kit.gateway as unknown as { authInflightPeak: number }).authInflightPeak).toBeLessThanOrEqual(4);
      // 判据④：unhandled rejection 与 overload tripped 均不增
      const after = await metricSnapshot();
      expect(after.rejection).toBe(before.rejection);
      expect(after.tripped).toBe(before.tripped);
      // 判据⑤（硬）：进程级未认证文档积压峰值<50
      expect(pendingPeak).toBeLessThan(N);
      // 旁证观测（不设门——装载中文档峰值留档演练报告）
      expect(loadingPeak).toBeGreaterThanOrEqual(0);
    } finally {
      await kit.dispose();
      if (prevTrusted === undefined) delete process.env.COLLAB_TRUSTED_PROXY; else process.env.COLLAB_TRUSTED_PROXY = prevTrusted;
    }
  }, 90_000);
});
