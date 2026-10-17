// apps/api/src/modules/collab/collab-heartbeat.heavy.spec.ts
// R6'（v3）：心跳链路端到端——服务端 10s sweep 的 heartbeat stateless 帧到达客户端（provider 收到
// message=lastMessageReceived 刷新的链路证明）。35s 死线形态不可构造（FIFO——见 plan v3 裁决记录：
// pause 停读挡住心跳本身+心跳与大帧同出站顺序队列，大帧排空>30s 的链路心跳恒排其后），
// 有效域边界归 spec 登记（真根修=客户端字节流级判活/2MB doc，归客户端批·Y1c-3 登记）。
// 形态裁定：provider 'stateless' 事件流可观测（provider esm :449 receiveStateless→emit :841——
// 服务端 sendStateless 帧全链路真实传输，非 fake transport）。heavy：10-15s 实时等待。
import { describe, it, expect } from 'vitest';
import { startDualClientServer } from '../../test-utils/dual-client-server';

describe('R6\' 心跳链路（服务端 sweep → 客户端收到 heartbeat stateless）', () => {
  it('空闲连接 15s 内收到 ≥1 条 heartbeat 帧（provider stateless 流可观测——链路通）', async () => {
    const kit = await startDualClientServer({}, 300);
    try {
      const A = kit.connect('project:hb');
      await A.synced;
      const received: string[] = [];
      A.provider.on('stateless', ({ payload }: { payload: string }) => { received.push(payload); });
      await new Promise((r) => setTimeout(r, 15_000));   // >1 心跳周期（10s）+裕量
      const heartbeats = received.filter((p) => { try { return JSON.parse(p).type === 'heartbeat'; } catch { return false; } });
      expect(heartbeats.length).toBeGreaterThanOrEqual(1);   // 链路通：服务端发出→客户端收到
      A.provider.destroy();   // 装置形态适配：connect 返回 {ydoc,provider,synced}（无 destroy 成员——plan 快照偏差，语义等价）
      kit.forget(A.provider);   // 自管 destroy 后 forget（双 destroy=本仓已知 flaky 源——kit 惯例）
    } finally { await kit.dispose(); }
  }, 30_000);
});
