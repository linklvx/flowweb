// 决策门 B（F6）——恢复原语形态裁决 spike（丢弃式，未 commit）：WebSocketPolyfill 自定义传输。
// 已核实依据：@hocuspocus/provider esm :171 构造器 WebSocketPolyfill ?? WebSocket、:292 new WebSocketPolyfill(this.url)
// ——传类不触发 ㉔ 禁令（㉔ 禁 websocketProvider 实例注入）。四点验证：
// ①构造签名（子类收 url 后库正常驱动）②onOpen 派发（库事件链在自定义类上照常）
// ③onClose 注入（4408 kick 形态可用 + 重连走自定义类）④destroy 清理（无泄漏/异常）。
// 通过 ⇒ 批1 恢复原语改 transport.reconnect()（㉕/㉝ 契约约束大半消失）；不通过 ⇒ kick 方案（合理退路）。
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
});
