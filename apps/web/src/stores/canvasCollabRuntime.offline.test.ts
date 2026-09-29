// apps/web/src/stores/canvasCollabRuntime.offline.test.ts
// 离线廉价兜底超时分支（Task 12 审查观察 A/B）：
// 红=commit 701d748c 现状——超时仅置 offline 不销毁 provider，晚重连 status 事件把蒙层打回
// connecting，而 observeDeep/bindBridge 未挂接、store 未水合 → 空画布可编辑脏窗口；
// 绿=超时分支先 destroyCollab 再置 offline——销毁后事件无投递通道，蒙层钉死引导刷新。
// mock 面（最小可行）：HocuspocusProvider 构造记录实例、on 登记 handler、destroy 异步幂等。
// attachUndoManager 用模块自建真实 Y.Doc（非 provider.document），AwarenessBridge 在超时路径
// 不构造——均无需 mock。fake timers 推进 10s 触发超时 resolve。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useCanvasStore } from './canvasStore';
import { initCollab, getDoc } from './canvasCollabRuntime';

vi.mock('@hocuspocus/provider', () => {
  class MockProvider {
    static instances: MockProvider[] = [];
    config: unknown;
    handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    destroyCalls = 0;
    constructor(config: unknown) {
      this.config = config;
      MockProvider.instances.push(this);
    }
    on(event: string, cb: (...args: unknown[]) => void) {
      (this.handlers[event] ??= []).push(cb);
    }
    // 模拟真实 provider.destroy 可观测语义：销毁后 socket 关闭、任何事件不再出站
    // （晚重连 status/synced 无投递通道）。emit 走监听表——destroy 后 emit 为 no-op。
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
  handlers: Record<string, Array<(...args: unknown[]) => void>>;
  destroyCalls: number;
  emit(event: string, payload: unknown): void;
};
const lastInstance = () => (HocuspocusProvider as any).instances.at(-1) as MockInst;

describe('initCollab 离线兜底：10s 超时分支（Task 12 审查 A/B）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (HocuspocusProvider as any).instances.length = 0;
    useCanvasStore.setState({ connStatus: 'connecting', nodes: [], edges: [] });
  });
  afterEach(async () => {
    vi.useRealTimers();
  });

  it('超时兜底：销毁 provider + connStatus offline + store 未水合 + doc 清理', async () => {
    const p = initCollab('p1'); // 内部先 destroyCollab（provider=null 幂等安全）
    await vi.advanceTimersByTimeAsync(10_000);
    await p;

    const cs = useCanvasStore.getState();
    expect(cs.connStatus).toBe('offline');
    expect(cs.nodes).toEqual([]); // 未 applyDocToStore（不抬 hydrate 门、空 doc 不入 store）
    expect(getDoc()).toBeNull(); // doc 已随 destroyCollab 销毁置 null
    // 现状红相：此断言 0 ≠ 1——provider 存活 → 晚重连可能 → 蒙层消失但 store 未水合
    expect(lastInstance().destroyCalls).toBe(1);
    expect(lastInstance().config.name).toBe('project:p1');
  });

  it('晚重连不再影响：destroy 摘除监听——status connected 无处投递，蒙层钉死 offline', async () => {
    const p = initCollab('p1');
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    const inst = lastInstance();
    expect(inst.destroyCalls).toBe(1);

    // 等价断言形态（如实报告）：真实 provider.destroy 后不再有任何事件出站；
    // mock 以"destroy 清空监听表 + emit 走监听表投递"模拟同一边界。断言两层：
    // ① handler 被摘除（监听表空）；② 即便手动 emit，connStatus 仍 offline（蒙层不消失）。
    expect(inst.handlers['status']).toBeUndefined(); // ① handler 被摘除（监听表已随 destroy 清空）
    inst.emit('status', { status: 'connected' });
    expect(useCanvasStore.getState().connStatus).toBe('offline');
    // 晚到 synced 同理：observeDeep/bindBridge 永不挂接，store 不水合、doc 保持清理态
    inst.emit('synced', {});
    expect(getDoc()).toBeNull();
    expect(useCanvasStore.getState().nodes).toEqual([]);
  });
});
