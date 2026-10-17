// R6'（v2）：保活心跳独立模块——B15 恶化者同批缓解（本批 close 抬升延长丢 awareness 窗口）。
// unit：sweep 对登记 conn sendStateless；链路端到端见 collab-heartbeat.heavy.spec.ts。
import { describe, it, expect, vi } from 'vitest';
import { CollabHeartbeat } from './collab-heartbeat';

describe('R6\' collab-heartbeat（B15——awareness 丢弃与保活解耦）', () => {
  it('sweep：对 Map<socketId,conn> 登记连接 sendStateless({"type":"heartbeat"})——摘除后不再发', () => {
    const hb = new CollabHeartbeat();
    const conn = { sendStateless: vi.fn() } as any;
    hb.register('sid-1', conn);
    hb.sweepOnce();
    expect(conn.sendStateless).toHaveBeenCalledWith(JSON.stringify({ type: 'heartbeat' }));
    hb.unregister('sid-1');   // v2：onDisconnectPayload 无 connection——按 socketId 摘除（SG:260 佐证）
    hb.sweepOnce();
    expect(conn.sendStateless).toHaveBeenCalledTimes(1);
  });

  it('已断连接 sendStateless 抛错：吞+自动摘除（强引用 Set 泄漏根修）', () => {
    // 真实库死连接走 close→disconnect→unregister 主链，此为 send 同步抛的纵深兜底（T9 Minor-2）
    const hb = new CollabHeartbeat();
    const conn = { sendStateless: vi.fn(() => { throw new Error('closed'); }) } as any;
    hb.register('sid-2', conn);
    expect(() => hb.sweepOnce()).not.toThrow();
    hb.sweepOnce();
    expect(conn.sendStateless).toHaveBeenCalledTimes(1);   // 第二轮不再发（已摘）
  });
});
