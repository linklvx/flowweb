// apps/web/src/stores/canvasCollabRuntime.force-sync.spec.ts
// Y0b-2 T7（Z67）：forceSyncAndWaitUnsynced——等 unsyncedChanges 归零边沿（禁用 'synced'：
// 一次性握手事件，已 synced 的 provider 同态提前 return 不再 emit——同态重等待结构性挂死）。
// 装置仿 conn.spec：mock @hocuspocus/provider（on/off/emit/forceSync）+ initCollab 真模块会话。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useCanvasStore } from './canvasStore';
import * as runtime from './canvasCollabRuntime';

vi.mock('@hocuspocus/provider', () => {
  class MockProvider {
    static instances: MockProvider[] = [];
    isAuthenticated = false;
    isSynced = false;
    isAttached = true;
    unsyncedChanges = 0;
    handlers: Record<string, Array<(payload: any) => void>> = {};
    awareness: any;
    configuration: any;
    forceSync = vi.fn();
    constructor(cfg: any = {}) {
      MockProvider.instances.push(this);
      const clientId = cfg?.document?.clientID ?? 0;
      this.awareness = {
        clientID: clientId,
        meta: new Map(),
        localState: null as any,
        setLocalState: vi.fn(),
        getLocalState: () => this.awareness.localState,
      };
      this.configuration = { websocketProvider: { shouldConnect: true, connect: vi.fn() } };
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
    async destroy() { this.handlers = {}; }
  }
  return { HocuspocusProvider: MockProvider };
});

const lastInstance = () => (HocuspocusProvider as any).instances.at(-1) as any;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** 启动会话并驱动到 synced（forceSyncAndWaitUnsynced 的常态前置——发起执行的客户端必已 synced） */
async function syncedProvider(pid = 'p-fs') {
  const done = runtime.initCollab(pid);
  await tick();
  const p = lastInstance();
  p.emit('status', { status: 'connected' });
  p.emit('status', { status: 'connected' });
  p.isAuthenticated = true;
  p.emit('authenticated', { scope: 'read-write' });
  p.isSynced = true;
  p.emit('synced', {});
  await done;
  return p;
}

/** unsyncedChanges 常驻监听基线（批1-4 rebuildPending 清除链——非本用例监听） */
const listenerBaseline = (p: any) => (p.handlers['unsyncedChanges'] ?? []).length;

describe('Y0b-2 T7（Z67）：forceSyncAndWaitUnsynced 归零边沿（禁 synced 一次性事件）', () => {
  beforeEach(() => {
    (HocuspocusProvider as any).instances.length = 0;
    useCanvasStore.setState({ connStatus: 'connecting', nodes: [], edges: [], hydration: 'idle' });
  });
  afterEach(async () => {
    await runtime.destroyCollab();
  });

  it('已 synced 态：forceSync 被调 + unsyncedChanges{number:0} 边沿 → true（零 synced 依赖）', async () => {
    const p = await syncedProvider();
    const base = listenerBaseline(p);
    const wait = runtime.forceSyncAndWaitUnsynced(2_000);
    expect(p.forceSync).toHaveBeenCalledTimes(1);
    p.emit('unsyncedChanges', { number: 0 });   // ack 归零 emit（HP decrement 无条件 emit）
    await expect(wait).resolves.toBe(true);
    expect(listenerBaseline(p)).toBe(base);     // 本用例监听已清（常驻基线不动）
  });

  it('非 0 边沿不 resolve——{number:2} 悬置，随后 {number:0} → true', async () => {
    const p = await syncedProvider('p-fs2');
    const wait = runtime.forceSyncAndWaitUnsynced(2_000);
    p.emit('unsyncedChanges', { number: 2 });   // 在飞未归零——不得提前放行
    const early = Promise.race([
      wait.then(() => 'resolved' as const),
      new Promise<string>((r) => setTimeout(() => r('pending' as const), 30)),
    ]);
    expect(await early).toBe('pending');        // number:2 时点确实未 resolve
    p.emit('unsyncedChanges', { number: 0 });
    await expect(wait).resolves.toBe(true);
  });

  it('归零前超时 → false（不抛错——claim 前判定零代价，调用方照发一次）', async () => {
    const p = await syncedProvider('p-fs3');
    const base = listenerBaseline(p);
    const wait = runtime.forceSyncAndWaitUnsynced(50);
    await expect(wait).resolves.toBe(false);
    expect(listenerBaseline(p)).toBe(base);     // 超时分支同样清监听（常驻基线不动）
  });
});
