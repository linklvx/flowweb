// apps/web/src/test/fixtures/fakeHocuspocusProvider.ts
// Y0b-5 T3（裁定 24⑪⑤）：10 个 spec 手搓 websocketProvider mock 收敛为唯一载体——
// 库契约一改 mock 静默各漂的问题随单源消失。库契约建模面（与真实库逐条对应）：
//   - connect()：首行置回 shouldConnect=true（esm:225）+新建 socket（socketsConstructed 计数）+返回 promise
//     （真实形态：maxAttempts:1 下 ladder 用尽 reject——本 fixture 建模成功路径，reject 形态归
//     connection-supervisor.test.ts 的真实库装置）；
//   - disconnect()：置 shouldConnect=false（esm:367-376）；
//   - setConfiguration({autoConnect:false})：置 shouldConnect=false（esm:211-217——open 归零锚消费点）；
//   - destroy()：契约锁㉔/㉖ 建模（removeAllListeners+awareness 序列推 meta clock 至 N+2）+ws 层 disconnect。
// 消费方式（各 spec 统一形态）：
//   vi.mock('@hocuspocus/provider', async () => {
//     const { FakeHocuspocusProvider } = await import('@/test/fixtures/fakeHocuspocusProvider');
//     return { HocuspocusProvider: FakeHocuspocusProvider };
//   });
import { vi } from 'vitest';

export class FakeHocuspocusProvider {
  static instances: FakeHocuspocusProvider[] = [];
  /** 库真开关建模的 socket 构造计数面（输出级锚——t9 输出级锚消费） */
  private static socketCount = 0;
  static socketsConstructed() { return FakeHocuspocusProvider.socketCount; }
  static resetSockets() { FakeHocuspocusProvider.socketCount = 0; }

  isAuthenticated = false;
  isSynced = false;
  /** 终态判据（G1 级别选择）——库契约：仅 destroy 的 detach 序列置 false */
  isAttached = true;
  unsyncedChanges = 0;
  destroyCalls = 0;
  /** R23 交错装置：测试注入的首次 destroy 挂起 promise */
  destroyGate: Promise<void> | null = null;
  handlers: Record<string, Array<(payload: any) => void>> = {};
  configuration: any;
  awareness: any;
  /** 构造入参原样保留（version-channel spec 断言 url/csv/cb 消费） */
  cfg: any;
  forceSync = vi.fn();

  constructor(cfg: any = {}) {
    FakeHocuspocusProvider.instances.push(this);
    this.cfg = cfg;
    // y-protocols 契约：awareness.clientID = doc.clientID（同 doc 重建 ⇒ 同 clientID——clock 播种前提）
    const clientId = cfg?.document?.clientID ?? 0;
    this.awareness = {
      clientID: clientId,
      meta: new Map<number, { clock: number; lastUpdated: number }>(),
      localState: null as any,
      setLocalState: vi.fn((s: any) => { this.awareness.localState = s; }),
      getLocalState: () => this.awareness.localState,
    };
    const ws = {
      shouldConnect: true,
      /** 库真开关建模：connect 首行置回 shouldConnect=true（esm:225）+新 socket 计数 */
      connect: vi.fn(() => {
        ws.shouldConnect = true;
        FakeHocuspocusProvider.socketCount++;
        return Promise.resolve();
      }),
      /** esm:367-376：disconnect 置 shouldConnect=false——onClose 定时器因 !shouldConnect 不再排程 */
      disconnect: vi.fn(() => { ws.shouldConnect = false; }),
      /** esm:211-217：setConfiguration 显式 `if (!autoConnect) this.shouldConnect = false`（open 归零锚） */
      setConfiguration: vi.fn((c: any = {}) => { if (c && c.autoConnect === false) ws.shouldConnect = false; }),
    };
    this.configuration = { websocketProvider: ws };
  }

  get hasUnsyncedChanges() { return this.unsyncedChanges > 0; }

  on(event: string, cb: (payload: any) => void) { (this.handlers[event] ??= []).push(cb); }
  off(event: string, cb: (payload: any) => void) {
    const arr = this.handlers[event];
    if (!arr) return;
    const i = arr.indexOf(cb);
    if (i >= 0) arr.splice(i, 1);
  }
  emit(event: string, payload: any) { for (const cb of [...this.handlers[event] ?? []]) cb(payload); }

  setAwarenessField(field: string, value: unknown) {
    const cur = this.awareness.getLocalState() ?? {};
    this.awareness.setLocalState({ ...cur, [field]: value });
  }

  async destroy() {
    this.destroyCalls++;
    if (this.destroyCalls === 1 && this.destroyGate) await this.destroyGate;
    // 契约锁㉔/㉖ 建模：destroy=removeAllListeners + awareness 序列推 meta clock 至 N+2 + ws 层 disconnect
    this.handlers = {};
    this.configuration?.websocketProvider?.disconnect?.();
    const cur = this.awareness.meta.get(this.awareness.clientID)?.clock ?? 0;
    this.awareness.meta.set(this.awareness.clientID, { clock: cur + 2, lastUpdated: Date.now() });
  }
}
