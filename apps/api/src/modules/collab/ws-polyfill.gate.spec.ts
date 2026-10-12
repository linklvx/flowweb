// 决策门 B（F6）——恢复原语形态裁决 spike（丢弃式，未 commit）：WebSocketPolyfill 自定义传输。
// 已核实依据：@hocuspocus/provider esm :171 构造器 WebSocketPolyfill ?? WebSocket、:292 new WebSocketPolyfill(this.url)
// ——传类不触发 ㉔ 禁令（㉔ 禁 websocketProvider 实例注入）。四点验证：
// ①构造签名（子类收 url 后库正常驱动）②onOpen 派发（库事件链在自定义类上照常）
// ③onClose 注入（4408 kick 形态可用 + 重连走自定义类）④destroy 清理（无泄漏/异常）。
// 通过 ⇒ 批1 恢复原语改 transport.reconnect()（㉕/㉝ 契约约束大半消失）；不通过 ⇒ kick 方案（合理退路）。
// Y0b-5 T3a：第二用例（批1-0 close(1000) 库自持重连裁决）随归零模型改写——见用例处注释。
import { describe, it, expect } from 'vitest';
import * as net from 'net';
import { Server } from '@hocuspocus/server';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

/** F6 spike：自定义 WebSocket 类与库假设的兼容性探测（实例钉住用于 destroy 泄漏检查）。 */
class PinnedWebSocket extends WebSocket {
  static created = 0;
  static instances: PinnedWebSocket[] = [];
  constructor(url: string | URL) {
    super(url as string);
    PinnedWebSocket.created++;
    PinnedWebSocket.instances.push(this);
  }
}

function freePort(): Promise<number> {
  return new Promise((r) => {
    const n = net.createServer();
    n.listen(0, () => { const p = (n.address() as any).port; n.close(() => r(p)); });
  });
}

describe('F6 WebSocketPolyfill spike', () => {
  it('自定义类全程可用：连接/同步/注入 onClose 触发重连/销毁无泄漏', async () => {
    const port = await freePort();
    const server = new Server({ port, async onAuthenticate() { return {}; } });
    await server.listen();
    const log: string[] = [];
    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${port}`,
      name: 'gate:polyfill',
      document: new Y.Doc(),
      token: 'gate',
      WebSocketPolyfill: PinnedWebSocket as any,   // 关键：类注入（㉔ 只禁实例注入）
    } as any);
    const ws: any = (provider as any).configuration.websocketProvider;
    let syncedCount = 0;
    provider.on('synced', () => { syncedCount++; });
    await new Promise<void>((r) => provider.on('synced', r));
    // —— 断言组①②：首连走自定义类 + 事件链（onOpen 派发→synced）照常 ——
    log.push(`①created=${PinnedWebSocket.created} ②isSynced=${provider.isSynced} isAuthenticated=${provider.isAuthenticated} firstSocketReadyState=${(PinnedWebSocket.instances[0] as any)?.readyState}`);
    expect(PinnedWebSocket.created).toBe(1);
    expect(provider.isSynced).toBe(true);
    // —— 断言组③：kick 注入（自定义类实例上派发 CloseEvent 形态，health-carrier 同款）——
    log.push('--- KICK 4408 ---');
    (provider as any).onClose?.();
    ws.onClose({ event: { code: 4408, reason: 'gate' } });
    void ws.connect();
    await new Promise<void>((r) => setTimeout(r, 5000));
    const secondSynced = syncedCount >= 2;
    log.push(`③created=${PinnedWebSocket.created} secondSynced=${secondSynced} syncedCount=${syncedCount} isSynced=${provider.isSynced} kickSocketReadyState=${(PinnedWebSocket.instances[0] as any)?.readyState} currentSocketReadyState=${(PinnedWebSocket.instances[PinnedWebSocket.instances.length - 1] as any)?.readyState}`);
    expect(PinnedWebSocket.created).toBeGreaterThanOrEqual(2); // 重连走了自定义类
    expect(secondSynced).toBe(true);
    // —— 断言组④：destroy 清理 ——
    const liveBefore = PinnedWebSocket.instances.filter(i => (i as any).readyState <= 1).length;
    provider.destroy();
    await new Promise<void>((r) => setTimeout(r, 1000));
    const liveAfter = PinnedWebSocket.instances.filter(i => (i as any).readyState <= 1).length;
    log.push(`④liveBefore=${liveBefore} liveAfter=${liveAfter} created=${PinnedWebSocket.created}`);
    console.log(`[F6] ${log.join('\n[F6] ')}`);
    expect(liveAfter).toBeLessThan(liveBefore); // destroy 关闭了自定义类实例（无泄漏）
    await server.destroy();
  }, 30000);

  // Y0b-5 T3a（裁定 25⑶）：原批1-0"close(1000) 即触发库自持重连"裁决夹具随归零模型整体改写——
  // 归零模型下该行为不存在：open 归零 shouldConnect（esm:211-217）⇒ onClose 1s 定时器守卫
  // （esm:411 `!cancelWebsocketRetry && shouldConnect`）结构性不排程。重录形态：pin+归零装置
  // （与 runtime createProvider 同构）+真服务端——断言 ①close(1000) 后 3s 零新 socket（库零自持）
  // ②事件序列含 disconnect（anchor1b 同族）③调用方显式 connect() 恢复闭环（所有权=调用方）。
  it('归零模型：pin+open 归零后 close(1000) 不再触发库自持重连——恢复所有权归调用方', async () => {
    const port = await freePort();
    const server = new Server({ port, async onAuthenticate() { return {}; } });
    await server.listen();
    let provider: HocuspocusProvider | null = null;
    try {
      class Counting extends WebSocket {
        static created = 0;
        static first: WebSocket | null = null;
        constructor(u: string | URL) { super(u as string); Counting.created++; if (!Counting.first) Counting.first = this; }
      }
      provider = new HocuspocusProvider({
        url: `ws://127.0.0.1:${port}`,
        name: 'gate:zeroing',
        document: new Y.Doc(),
        token: 'gate',
        WebSocketPolyfill: Counting as any,
        // T3 pin——与 runtime createProvider 同构
        maxAttempts: 1, delay: 1_000, maxDelay: 30_000, messageReconnectTimeout: 30_000,
        autoConnect: false,
      } as any);
      const ws: any = (provider as any).configuration.websocketProvider;
      provider.on('open', () => ws.setConfiguration({ autoConnect: false }));   // ★归零挂点
      void ws.connect()?.catch?.(() => {});                                     // 显式首连
      let syncedCount = 0;
      provider.on('synced', () => { syncedCount++; });
      await new Promise<void>((r) => provider!.on('synced', r));
      expect(Counting.created).toBe(1);
      expect(ws.shouldConnect).toBe(false);                                     // open 归零已落
      const events: string[] = [];
      provider.on('close', (e: any) => events.push(`close(${e?.event?.code ?? '?'})`));
      provider.on('disconnect', () => events.push('disconnect'));
      // —— 真关停（服务端断 TCP）——断言库零自持重连：3s（>delay=1s）内零新 socket ——
      Counting.first!.close(1000, 'gate-zeroing');
      await new Promise<void>((r) => setTimeout(r, 3_000));
      expect(Counting.created).toBe(1);                 // ★归零锚：库零重连定时器（改前此形态 created≥2）
      expect(syncedCount).toBe(1);
      // —— 调用方显式 connect() 恢复闭环（所有权=调用方，非库自持）——
      void ws.connect()?.catch?.(() => {});
      await new Promise<void>((r) => setTimeout(r, 2_000));
      expect(Counting.created).toBe(2);                 // 新 socket 经注入类建立
      expect(syncedCount).toBeGreaterThanOrEqual(2);    // 重新 synced
      console.log(`[T3a 归零] events=${JSON.stringify(events)} created=${Counting.created} syncedCount=${syncedCount}`);
      expect(events).toContain('close(1000)');          // 事件序列含 close——真关停路径
      expect(events).toContain('disconnect');           // ★重录要点：事件序列含 disconnect（onClose 恒 emit）
      provider.destroy();
      await new Promise<void>((r) => setTimeout(r, 500));
    } finally {
      provider?.destroy();
      await server.destroy().catch(() => {});
    }
  }, 30000);
});
