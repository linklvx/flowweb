// 决策门 A（F11）——载体已裁决（2026-09-30）：候选 1（inboundAttemptId === attemptId）胜出。
// 实测依据：双发第一发（onOpen）connAttempt 非 null、第二发（resolveConnectionAttempt，首帧触发）已 null；
// resolve 与 message 由同一入站帧同同步栈驱动（行为等价）——候选 1 仅依赖公开事件（mock 零内部状态伪造），
// 候选 2 需 mock 建模 connectionAttempt 生命周期与双发第二发的时序耦合（F11 立门要防的"mock 继承错误信念"）。
// 本夹具保留为契约锁夹具常驻 CI：kick 单 socket 锚（㉝）+ 双发事件序锚。
// 丢弃式真协议夹具：真 Server + 真 provider（R12 手法），无 Prisma——onAuthenticate 直接放行。
import { describe, it, expect, vi } from 'vitest';
import * as net from 'net';
import { Server } from '@hocuspocus/server';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

function freePort(): Promise<number> {
  return new Promise((r) => {
    const n = net.createServer();
    n.listen(0, () => { const p = (n.address() as any).port; n.close(() => r(p)); });
  });
}

describe('F11 健康判据载体裁决夹具', () => {
  it('4408 形态：记录 status/message/authenticated/synced 事件序与 connectionAttempt 取值', async () => {
    const port = await freePort();
    const server = new Server({ port, async onAuthenticate() { return {}; } });
    await server.listen();
    const log: string[] = [];
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${port}`,
      name: 'gate:carrier',
      document: doc,
      token: 'gate',
    });
    const ws: any = (provider as any).configuration.websocketProvider;
    const createdSpy = vi.spyOn(ws, 'createWebSocketConnection');   // socket 建连计数（裁决点 3：kick 后是否只建一个）
    const connectedAttemptNotNull: boolean[] = [];                   // 双发两轮的 connAttempt 取值锚（载体裁决依据）
    provider.on('status', (e: any) => {
      if (e.status === 'connected') connectedAttemptNotNull.push(ws?.connectionAttempt != null);
      log.push(`status:${e.status} wsStatus=${ws?.status} connAttempt=${JSON.stringify(ws?.connectionAttempt)} connAttemptIsNull=${ws?.connectionAttempt == null}`);
    });
    provider.on('message', () => {
      log.push(`message connAttempt=${JSON.stringify(ws?.connectionAttempt)} connAttemptIsNull=${ws?.connectionAttempt == null}`);
    });
    provider.on('authenticated', () => log.push(`authenticated connAttempt=${JSON.stringify(ws?.connectionAttempt)}`));
    provider.on('synced', () => log.push(`synced connAttempt=${JSON.stringify(ws?.connectionAttempt)}`));

    await new Promise<void>((r) => provider.on('synced', r));
    // kick 前快照：布尔基线（裁决点 2：kick 后是否陈旧 true）+ socket 建连基线（裁决点 3）
    const sockBefore = ws.webSocket;
    const createdBeforeKick = createdSpy.mock.calls.length;
    log.push(`--- PRE-KICK isSynced=${provider.isSynced} isAuthenticated=${provider.isAuthenticated} socketCreated=${createdBeforeKick} wsStatus=${ws.status} readyState=${sockBefore?.readyState}`);

    log.push('--- KICK 4408 ---');
    // 合成 4408（v5.3 瞬态原语同款——公开方法）
    (provider as any).onClose?.();
    const afterProviderOnClose = { isSynced: provider.isSynced, isAuthenticated: provider.isAuthenticated };
    log.push(`post-provider-onClose isSynced=${provider.isSynced} isAuthenticated=${provider.isAuthenticated}`);
    ws.onClose({ event: { code: 4408, reason: 'gate-kick' } });
    log.push(`post-ws-onClose isSynced=${provider.isSynced} isAuthenticated=${provider.isAuthenticated} wsStatus=${ws.status}`);
    // kick 后同同步栈无条件 connect（㉝ 处方）
    void ws.connect();
    // 等待重连完成（第二个 synced 或 10s）
    let secondSynced = false;
    provider.on('synced', () => { secondSynced = true; });
    await new Promise<void>((r) => setTimeout(r, 10000));

    log.push(`--- POST-WAIT secondSynced=${secondSynced} isSynced=${provider.isSynced} isAuthenticated=${provider.isAuthenticated} socketCreated=${createdSpy.mock.calls.length} socketsAfterKick=${createdSpy.mock.calls.length - createdBeforeKick} ws-instance-changed=${(provider as any).configuration.websocketProvider !== ws} socket-instance-changed=${ws.webSocket !== sockBefore} readyState=${ws.webSocket?.readyState} wsStatus=${ws.status}`);

    console.log(log.join('\n'));
    // —— 实测事件序断言（决策门 A 固化）——
    // 双发×两轮：每轮第一发（onOpen）connAttempt 非 null（attempt 在飞）、第二发（resolveConnectionAttempt，
    // 首帧触发）已 null——候选 2 数据面成立但 mock 形状劣于候选 1（见文件头注释），载体=候选 1。
    expect(connectedAttemptNotNull).toEqual([true, false, true, false]);
    // kick 处方半边锚：显式 provider.onClose() 复位布尔——L13 库自发 4408 不 emit 'close' ⇒ 布尔陈旧 true，
    // 恢复原语必须显式调用（实测：调用后 isSynced/isAuthenticated 均 false）。
    expect(afterProviderOnClose).toEqual({ isSynced: false, isAuthenticated: false });
    // ㉝ 同栈锚（F11 保留进 CI 常跑）：kick 后恰建一个新 socket——防 kick 与 connect 之间静默插 await 回归。
    expect(createdSpy.mock.calls.length - createdBeforeKick).toBe(1);
    // 恢复闭环：4408 kick → 重连 → 第二个 synced。
    expect(secondSynced).toBe(true);
    expect(provider.isSynced).toBe(true);
    provider.destroy();
    await server.destroy();
  }, 30000);
});
