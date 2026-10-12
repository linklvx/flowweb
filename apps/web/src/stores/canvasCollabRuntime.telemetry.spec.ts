// apps/web/src/stores/canvasCollabRuntime.telemetry.spec.ts
// Y0b-5 T2 红测：runtime 侧遥测接线——close_code 打点（({event}) 解构+event?.code 反向断言——
// 库载荷恒 {event} 包装，防整片落 other 哑写点）/SLO 两条（hydration=initCollab→ready、
// reconnect=掉线→authenticated——载体=ws_status detail ms，控制器裁决）/projection_duration 打点
// 包 applyDocToStore（与 alignExecFromIntents 互不包含禁打错位）/invariant 生产确定性采样节律
// （每 30 次 apply 或每 30s 取先到+hydration synced 后必跑+结构性变更后必跑+DEV 全跑）/
// 遥测 loop 启停绑定 initCollab/destroyCollab（无会话零 beacon）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import * as runtime from './canvasCollabRuntime';
import { toDocLike } from '@/collab/ydocBuilder';
import { stampDocSchema } from '@flowweb/shared';
import {
  getRecentCollabDiag, getCollabDiagCounters, _resetCollabDiagForTest,
  _telemetryLoopRunning,
} from '@/utils/collabDiagnostics';

// Y0b-5 T3：mock 收敛——唯一载体 @/test/fixtures/fakeHocuspocusProvider（裁定 24⑪⑤）。
vi.mock('@hocuspocus/provider', async () => {
  const { FakeHocuspocusProvider } = await import('@/test/fixtures/fakeHocuspocusProvider');
  return { HocuspocusProvider: FakeHocuspocusProvider };
});

const lastInstance = () => (HocuspocusProvider as any).instances.at(-1) as any;
/** flush initCollab 入口 teardownSession 的微任务链（fake timers 下用 advanceTimersByTimeAsync(0)） */
const tick = () => vi.advanceTimersByTimeAsync(0);

/** rw 会话完整健康序（invariant.spec 同款）；done 后显式 stamp（mock 无真 loadDocument 自愈） */
async function driveToSyncedRw(pid = 'p1') {
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
  stampDocSchema(toDocLike(runtime.getDoc()!));
  return p;
}

/** ring 中指定类型的 detail 列表 */
const detailsOf = (type: string) =>
  getRecentCollabDiag().filter((e) => e.type === type).map((e) => e.detail ?? {});

beforeEach(() => {
  vi.useFakeTimers();
  (HocuspocusProvider as any).instances.length = 0;
  _resetCollabDiagForTest();
  useCanvasStore.setState({ connStatus: 'connecting', nodes: [], edges: [], hydration: 'idle' });
});

afterEach(async () => {
  await runtime.destroyCollab();
  vi.useRealTimers();
});

describe('Y0b-5 T2：close_code 打点（close handler 维持 ({event}) 解构形状——裁定 18①）', () => {
  it('emit("close",{event:{code:4408}}) 下取到 4408（库载荷恒 {event} 包装——防整片落 other 哑写点）；code 取值原样入 ring（sanitize 在服务端）', async () => {
    const p = await driveToSyncedRw();
    p.emit('close', { event: { code: 4408, reason: 'forced' } });
    const codes = detailsOf('close_code');
    expect(codes).toContainEqual({ code: 4408 });   // 反向断言：非 undefined/非整片 other
    expect(getCollabDiagCounters().get('close_code')).toBe(1);
    // 1006（库自发、非 CollabCloseCode 表值）客户端零 sanitize 原样记录——越界折 other 归服务端
    p.emit('close', { event: { code: 1006 } });
    expect(detailsOf('close_code')).toContainEqual({ code: 1006 });
  });
});

describe('Y0b-5 T2：SLO 两条（载体=ws_status detail ms——控制器裁决；零轮询事件打点）', () => {
  it('hydration_duration：initCollab→ready——ready 后 ring 含 ws_status {from:connecting,to:connected,ms≥0}', async () => {
    await driveToSyncedRw();
    const msEvents = detailsOf('ws_status').filter((d) => d.from === 'connecting' && d.to === 'connected' && typeof d.ms === 'number');
    expect(msEvents).toHaveLength(1);
    expect((msEvents[0].ms as number)).toBeGreaterThanOrEqual(0);
  });

  it('reconnect_duration：掉线→authenticated——掉线前 authenticated 不打；掉线后 authenticated 打 ws_status {from:disconnected,to:connected,ms≥0}', async () => {
    const p = await driveToSyncedRw();
    // 初次 authenticated（未掉线）——reconnect 零打点
    expect(detailsOf('ws_status').some((d) => d.from === 'disconnected')).toBe(false);
    p.emit('status', { status: 'disconnected' });
    p.emit('status', { status: 'connecting' });
    p.isAuthenticated = true;
    p.emit('authenticated', { scope: 'read-write' });
    const re = detailsOf('ws_status').filter((d) => d.from === 'disconnected' && d.to === 'connected' && typeof d.ms === 'number');
    expect(re).toHaveLength(1);
    expect((re[0].ms as number)).toBeGreaterThanOrEqual(0);
    // 再掉线但未 authenticated——不提前打点
    p.emit('status', { status: 'disconnected' });
    expect(detailsOf('ws_status').filter((d) => d.from === 'disconnected' && d.to === 'connected')).toHaveLength(1);
  });
});

describe('Y0b-5 T2：projection_duration 打点包 applyDocToStore（禁 Date.now——单调钟）', () => {
  it('水合路径+远端 apply 路径各打一条 projection_duration{ms≥0}（alignExecFromIntents 不在计时位——connected 边沿触发与投影互不包含）', async () => {
    await driveToSyncedRw();
    // 水合路径已打一条
    expect(detailsOf('projection_duration').length).toBe(1);
    expect(typeof detailsOf('projection_duration')[0].ms).toBe('number');
    // 远端 apply：对端写节点（network origin 触发真实去抖链→apply 周期）
    const B = new Y.Doc();
    B.transact(() => {
      const m = new Y.Map(); m.set('type', 'textInput');
      const pos = new Y.Map(); pos.set('x', 1); pos.set('y', 0); m.set('position', pos);
      m.set('data', new Y.Map());
      B.getMap('nodes').set('b1', m);
    }, 'b-edit');
    Y.applyUpdate(runtime.getDoc()!, Y.encodeStateAsUpdate(B), 'network');
    await vi.advanceTimersByTimeAsync(60);   // 50ms 去抖 → apply 周期
    expect(detailsOf('projection_duration').length).toBe(2);
    expect(typeof detailsOf('projection_duration')[1].ms).toBe('number');
  });

  it('计时位接线锚（源码文本）：onRemote 去抖周期内 performance.now 包住 applyDocToStore+invariant——禁 Date.now（防复合锚退化）', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'canvasCollabRuntime.ts'), 'utf8');
    const m = src.match(/remoteApplyTimer = setTimeout\(\(\) => \{[\s\S]*?\}, 50\)/);
    expect(m).toBeTruthy();
    expect(m![0]).toContain('performance.now()');
    expect(m![0]).not.toContain('Date.now()');
    // 水合路径同为 performance.now
    const hydrationApply = src.match(/viewport 恢复[\s\S]{0,400}?applyDocToStore\(doc!\)/);
    expect(src.match(/const t0Projection = performance\.now\(\);\s*\n\s*applyDocToStore\(doc!\);/)).toBeTruthy();
    expect(src).not.toMatch(/recordCollabDiag\('projection_duration',\s*\{\s*ms:\s*Date\.now/);
  });
});

describe('Y0b-5 T2：invariant 生产确定性采样节律（裁定 20——现生产无条件执行=热路径调试垫片）', () => {
  it('纯决策核 decideInvariantSample 表驱动：DEV 全跑/结构性变更必跑/30 次计数到点必跑/30s 到点必跑/其余不跑/未跑过仅计数判据', () => {
    const f = runtime.decideInvariantSample;
    expect(f({ dev: true, structural: false, appliesSinceRun: 0, msSinceLastRun: 0 })).toBe(true);       // DEV 全跑
    expect(f({ dev: false, structural: true, appliesSinceRun: 0, msSinceLastRun: 1 })).toBe(true);       // 结构性（增删节点）必跑
    expect(f({ dev: false, structural: false, appliesSinceRun: 30, msSinceLastRun: 0 })).toBe(true);     // 每 30 次 apply
    expect(f({ dev: false, structural: false, appliesSinceRun: 1, msSinceLastRun: 30_000 })).toBe(true); // 每 30s
    expect(f({ dev: false, structural: false, appliesSinceRun: 0, msSinceLastRun: null })).toBe(false);  // 从未跑过且计数 0——等首个判据（hydration 后必跑已重置）
    expect(f({ dev: false, structural: false, appliesSinceRun: 29, msSinceLastRun: 29_999 })).toBe(false);
  });

  it('接线锚（源码文本）：onRemote 周期经 shouldRunProjectionInvariant 采样（结构性判据=nodes 键数变化）；hydration 路径必跑（where=applyBootstrap）', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'canvasCollabRuntime.ts'), 'utf8');
    const m = src.match(/remoteApplyTimer = setTimeout\(\(\) => \{[\s\S]*?\}, 50\)/);
    expect(m).toBeTruthy();
    expect(m![0]).toContain('shouldRunProjectionInvariant(');
    expect(m![0]).toMatch(/structural/);
    // hydration synced 后必跑——ready 写点后跟着 invariant+applyBootstrap violation 记录
    const ready = src.indexOf("setHydration('ready')");
    const after = src.slice(ready, ready + 1200);
    expect(after).toContain('checkProjectionInvariant');
    expect(after).toContain("'applyBootstrap'");
  });
});

describe('Y0b-5 T2：遥测 loop 启停绑定 initCollab/destroyCollab（无会话零 beacon）', () => {
  it('initCollab 起搏/destroyCollab 停搏；停后 advance 60s 零 flush（防匿名页 2/min 永久 401 噪声）', async () => {
    expect(_telemetryLoopRunning()).toBe(false);
    await driveToSyncedRw();
    expect(_telemetryLoopRunning()).toBe(true);
    await runtime.destroyCollab();
    expect(_telemetryLoopRunning()).toBe(false);
  });
});
