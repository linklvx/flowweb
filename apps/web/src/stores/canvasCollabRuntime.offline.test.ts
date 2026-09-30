// apps/web/src/stores/canvasCollabRuntime.offline.test.ts
// 离线廉价兜底超时分支（Task 12 审查观察 A/B → 批2-1 修D 重写）：
// 旧绿=超时分支先 destroyCollab 再置 offline+syncFailed（销毁钉死蒙层——Task 12 时代方案）；
// 批2-1 修D（v5.3）=超时不再 destroyCollab——hydration='failed' 驱动蒙层行动，
//   provider/doc 保留（恢复门对象仍在、"断连期编辑仍在 doc"在 failed 态成立——
//   与恢复门互相踩出的"10s 超时↔15s 快线"重建循环随销毁一起消失）。
// mock 面（最小可行）：HocuspocusProvider 构造记录实例、on 登记 handler、destroy 异步幂等。
// attachUndoManager 用模块自建真实 Y.Doc（非 provider.document），AwarenessBridge 在超时路径
// 不构造——均无需 mock。fake timers 推进 10s 触发超时 resolve。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useCanvasStore } from './canvasStore';
import { initCollab, getDoc, destroyCollab } from './canvasCollabRuntime';

vi.mock('@hocuspocus/provider', () => {
  class MockProvider {
    static instances: MockProvider[] = [];
    config: unknown;
    // 批0a 库契约：isAuthenticated/isSynced 公开布尔（provider 无 status 字段——只有事件）
    isAuthenticated = false;
    isSynced = false;
    handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    destroyCalls = 0;
    constructor(config: unknown) {
      this.config = config;
      MockProvider.instances.push(this);
    }
    on(event: string, cb: (...args: unknown[]) => void) {
      (this.handlers[event] ??= []).push(cb);
    }
    // 模拟真实 provider.destroy 可观测语义：销毁后 socket 关闭、任何事件不再出站。emit 走监听表。
    async destroy() {
      this.destroyCalls++;
      this.handlers = {};
    }
    emit(event: string, payload: unknown) {
      for (const cb of this.handlers[event] ?? []) cb(payload);
    }
  }
  return { HocuspocusProvider: MockProvider };
});

type MockInst = {
  config: { name: string };
  isAuthenticated: boolean;
  isSynced: boolean;
  handlers: Record<string, Array<(...args: unknown[]) => void>>;
  destroyCalls: number;
  emit(event: string, payload: unknown): void;
};
const lastInstance = () => (HocuspocusProvider as any).instances.at(-1) as MockInst;

describe('initCollab 离线兜底：10s 超时分支（批2-1 修D——超时不销毁）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (HocuspocusProvider as any).instances.length = 0;
    useCanvasStore.setState({ connStatus: 'connecting', nodes: [], edges: [], hydration: 'idle' });
  });
  afterEach(async () => {
    // 修D 后超时路径 provider/心跳仍存活——销毁须在 fake timers 下先清
    await destroyCollab();
    vi.useRealTimers();
  });

  it('超时兜底（修D）：hydration=failed + store 未水合 + provider/doc 仍存活', async () => {
    const p = initCollab('p1'); // 内部先 teardown（provider=null 幂等安全）
    await vi.advanceTimersByTimeAsync(10_000);
    await p;

    const cs = useCanvasStore.getState();
    expect(cs.hydration).toBe('failed'); // 蒙层分型：failed → 重试行动（不再写 connStatus/syncFailed）
    expect(cs.nodes).toEqual([]); // 未 applyDocToStore（不抬 hydrate 门、空 doc 不入 store）
    expect(getDoc()).not.toBeNull(); // 修D：doc 保留——恢复门对象仍在
    expect(lastInstance().destroyCalls).toBe(0); // 修D：provider 保留（现状必红——旧分支 destroyCollab）
    expect(lastInstance().config.name).toBe('project:p1');
  });

  it('超时后晚到事件不清 failed、不 re-hydrate（completeHydration 单驱动属后续批次）', async () => {
    const p = initCollab('p1');
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    const inst = lastInstance();

    // provider 存活（修D）——晚到 status/synced 有投递通道；但 failed 蒙层不因此消失，
    // 迟到 synced 的水合自愈（completeHydration）不属本批——store 保持未水合
    inst.emit('status', { status: 'connected' });
    inst.emit('synced', {});
    expect(useCanvasStore.getState().hydration).toBe('failed');
    expect(useCanvasStore.getState().nodes).toEqual([]);
  });

  it('会话中途断连：hydration 保持 ready（蒙层不弹、指示器承担告知）', async () => {
    const p = initCollab('p1');
    await vi.advanceTimersByTimeAsync(0); // flush teardown 微任务 → provider 构造完成
    // 批0a 健康序（派生判据）：connected 事件 + 公开布尔 + synced + message 代际确认
    const inst = lastInstance();
    inst.emit('status', { status: 'connected' });
    inst.isAuthenticated = true;
    inst.isSynced = true;
    inst.emit('synced', {});
    await p;
    inst.emit('message', {});
    expect(useCanvasStore.getState().connStatus).toBe('connected');
    expect(useCanvasStore.getState().hydration).toBe('ready');

    // 会话中途断连（pm2 重启/网络抖动）：断连走自动重连，hydration 不动（蒙层不弹）
    lastInstance().emit('status', { status: 'disconnected' });
    expect(useCanvasStore.getState().connStatus).toBe('offline'); // SaveStatusIndicator 非阻断告知保留
    expect(useCanvasStore.getState().hydration).toBe('ready');    // 全屏蒙层条件不触发
  });

  it('陈旧 initCollab 超时 timer 不销毁后续同 pid 健康会话（I-1 epoch 判活回归锁）', async () => {
    const p1 = initCollab('p1');
    await vi.advanceTimersByTimeAsync(5_000); // 第一次超时中（timer 未触发、未 emit synced）
    const p2 = initCollab('p1'); // 退出重进/StrictMode 双挂载：入口 teardown 销毁实例 1，新建实例 2
    await vi.advanceTimersByTimeAsync(0); // flush → 实例 2 构造完成
    expect((HocuspocusProvider as any).instances.length).toBe(2);
    // 批0a 健康序（派生判据）：connected 事件 + 公开布尔 + synced + message 代际确认
    const inst2 = lastInstance();
    inst2.emit('status', { status: 'connected' });
    inst2.isAuthenticated = true;
    inst2.isSynced = true;
    inst2.emit('synced', {}); // 第二次健康完成
    await p2;
    inst2.emit('message', {});
    expect(getDoc()).not.toBeNull();
    expect(useCanvasStore.getState().connStatus).toBe('connected');

    await vi.advanceTimersByTimeAsync(10_000); // 越过第一次的 10s 陈旧 timer
    await p1;
    // 旧代码红相：同 pid 守卫放行 → !synced → destroyCollab() 销毁健康会话
    expect(((HocuspocusProvider as any).instances[1] as MockInst).destroyCalls).toBe(0); // 新会话未被销毁
    expect(getDoc()).not.toBeNull();
    expect(useCanvasStore.getState().connStatus).toBe('connected');
    expect(useCanvasStore.getState().hydration).toBe('ready'); // 陈旧超时不吞新会话的 ready
  });
});
