// apps/web/src/stores/canvasCollabRuntime.cache.spec.ts
// Y0b-5 T5：世代可见通道四维缓存键接线——session 扩展/fail-closed 遥测/purge 挂点
// （世代变化两路顺序锚=await purge() 后 reload；terminal 无读权读权分型；team disbanded 字面量）。
// mock 形态承 canvasCollabRuntime.quota.spec（fakeHocuspocusProvider+fake timers）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useCanvasStore } from './canvasStore';
import * as runtime from './canvasCollabRuntime';
import { getRecentCollabDiag, _resetCollabDiagForTest } from '@/utils/collabDiagnostics';
import {
  buildLocalCacheKey,
  purgeForeignCaches, purgePidCaches,
} from '@/collab/local-cache-key';

vi.mock('@hocuspocus/provider', async () => {
  const { FakeHocuspocusProvider } = await import('@/test/fixtures/fakeHocuspocusProvider');
  return { HocuspocusProvider: FakeHocuspocusProvider };
});

// 键合成保真（真实实现）；purge 面 mock（挂点调用断言——真实行为归 local-cache-key.test）
vi.mock('@/collab/local-cache-key', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/collab/local-cache-key')>()),
  purgeForeignCaches: vi.fn().mockResolvedValue(undefined),
  purgePidCaches: vi.fn().mockResolvedValue(undefined),
}));

const lastInstance = () => (HocuspocusProvider as any).instances.at(-1) as any;

const META = { collabGeneration: 3, collabSchemaVersion: 2, viewerUid: 'u1' };
const CACHE_KEY = buildLocalCacheKey({ uid: 'u1', pid: 'p1', generation: 3, schemaVersion: 2 });

const docStatus = (rev: number, generation?: number) => JSON.stringify({
  type: 'doc-status', rev, writeFrozen: false,
  ...(generation !== undefined ? { generation } : {}),
  quota: { state: 'ok', bytes: 1234, limit: 8_388_608, maxTxBytes: 262_144, softLimitBytes: 6_710_886 },
});

const resetStore = () => useCanvasStore.setState({
  connStatus: 'connecting', nodes: [], edges: [], connUi: 'ok', hydration: 'idle',
  collabReadOnly: true, wsAuthNotice: null, writeFrozen: false, collabEscapePending: false,
  connReadOnly: false, quotaOver: false, quotaLimitBytes: 0, quotaTxBytes: 0,
  quotaSoftLimitBytes: 0, quotaResidueBytes: undefined, lastDocStatusRev: 0,
  localDocBytes: 0, localDelta: 0, pendingGenerationReload: 0, wsQuotaTerminal: null,
});

describe('Y0b-5 T5：世代可见通道+四维缓存键 purge 挂点', () => {
  const reloadSpy = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    (HocuspocusProvider as any).instances.length = 0;
    _resetCollabDiagForTest();
    resetStore();
    reloadSpy.mockClear();
    vi.mocked(purgeForeignCaches).mockClear();
    vi.mocked(purgePidCaches).mockClear();
    vi.stubGlobal('location', { reload: reloadSpy });
  });
  afterEach(async () => {
    await runtime.destroyCollab();   // fake interval 清理须在 useRealTimers 前
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function driveToSyncedFake(pid = 'p1', meta?: runtime.CollabSessionMeta) {
    const done = runtime.initCollab(pid, meta);
    await vi.advanceTimersByTimeAsync(0);
    const p = lastInstance();
    p.emit('status', { status: 'connected' });
    p.isAuthenticated = true;
    p.emit('authenticated', { scope: 'read-write' });
    p.isSynced = true;
    p.emit('synced', {});
    await done;
    return p;
  }

  // ── fail-closed（generation 未知⇒不启用本地缓存——undefined 键=F2 原样复发）──
  it('meta 缺失（fetchProjectMeta 字段缺失/旧后端）⇒ ws_status detail.reason="local-cache-degraded" 遥测（缓存从不生效可观测非静默）', async () => {
    await driveToSyncedFake('p1');
    expect(getRecentCollabDiag().some((e) => e.type === 'ws_status' && (e.detail as any)?.reason === 'local-cache-degraded')).toBe(true);
  });

  it('meta 缺 generation 单字段 ⇒ 同 fail-closed（三元完整才合成键）', async () => {
    await driveToSyncedFake('p1', { collabSchemaVersion: 2, viewerUid: 'u1' });
    expect(getRecentCollabDiag().some((e) => e.type === 'ws_status' && (e.detail as any)?.reason === 'local-cache-degraded')).toBe(true);
  });

  it('meta 完整 ⇒ 无降级遥测（缓存通道健康态零噪音）', async () => {
    await driveToSyncedFake('p1', META);
    expect(getRecentCollabDiag().some((e) => (e.detail as any)?.reason === 'local-cache-degraded')).toBe(false);
  });

  // ── 世代变化路径一：装载后首快照 generation 跳变（consumeGenerationJump 扩）──
  it('世代跳变（doc-status generation 5→9）⇒ purgeForeignCaches(四维键) 前置 await 后 reload（顺序锚：purge resolve 前 reload 不发生——反了=重载读脏库 F1 复发）', async () => {
    let resolvePurge!: () => void;
    vi.mocked(purgeForeignCaches).mockImplementation(() => new Promise<void>((r) => { resolvePurge = r; }));
    const p = await driveToSyncedFake('p1', META);
    p.emit('stateless', { payload: docStatus(1, 5) });   // 基线建立（首见代≠跳变）
    expect(purgeForeignCaches).not.toHaveBeenCalled();
    p.emit('stateless', { payload: docStatus(2, 9) });   // 真跳变
    await vi.advanceTimersByTimeAsync(1_500);            // reload 延时到点——purge 未 resolve
    expect(purgeForeignCaches).toHaveBeenCalledWith(CACHE_KEY);
    expect(reloadSpy).not.toHaveBeenCalled();            // 顺序锚：purge 在 reload 前
    resolvePurge();
    await vi.advanceTimersByTimeAsync(0);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('fail-closed 会话世代跳变 ⇒ 无键不 purge+reload 照常（purge 失败/缺席不阻断自愈主链）', async () => {
    const p = await driveToSyncedFake('p1');
    p.emit('stateless', { payload: docStatus(1, 5) });
    p.emit('stateless', { payload: docStatus(2, 9) });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(purgeForeignCaches).not.toHaveBeenCalled();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  // ── 世代变化路径二：4410 close（vacuuming/generation-stale）──
  it('close 4410 ⇒ purgeForeignCaches(四维键) 前置 await 后 reload（与首快照路径同款顺序锚）', async () => {
    let resolvePurge!: () => void;
    vi.mocked(purgeForeignCaches).mockImplementation(() => new Promise<void>((r) => { resolvePurge = r; }));
    const p = await driveToSyncedFake('p1', META);
    p.emit('close', { event: { code: 4410, reason: 'doc-vacuuming' } });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(purgeForeignCaches).toHaveBeenCalledWith(CACHE_KEY);
    expect(reloadSpy).not.toHaveBeenCalled();
    resolvePurge();
    await vi.advanceTimersByTimeAsync(0);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  // ── terminal 族：读权分型（裁定 22⑶）──
  it('authenticationFailed forbidden（无读权终态）⇒ purgePidCaches(viewerUid, pid) 全代清库且无导出（权限撤销后本地副本仍在=泄漏）', async () => {
    const p = await driveToSyncedFake('p1', META);
    p.emit('authenticationFailed', { reason: 'forbidden' });
    expect(purgePidCaches).toHaveBeenCalledWith('u1', 'p1');
    expect(reloadSpy).not.toHaveBeenCalled();            // 无读权终态禁导出禁 reload 逃生
  });

  it('authenticationFailed not-found/session-expired/版本族 ⇒ 同 purgePidCaches；unauthenticated ⇒ 不 purge（非权限撤销——重登即恢复）', async () => {
    const p = await driveToSyncedFake('p1', META);
    for (const reason of ['not-found', 'session-expired', 'schema-outdated', 'client-version-missing', 'client-version-invalid']) {
      vi.mocked(purgePidCaches).mockClear();
      p.emit('authenticationFailed', { reason });
      expect(purgePidCaches, `reason=${reason}`).toHaveBeenCalledWith('u1', 'p1');
    }
    vi.mocked(purgePidCaches).mockClear();
    p.emit('authenticationFailed', { reason: 'unauthenticated' });
    expect(purgePidCaches).not.toHaveBeenCalled();
  });

  it('close 4404 doc-over-quota（quota 终态仍有读权）⇒ 不 purge（保留缓存——T8 只读副本用）', async () => {
    const p = await driveToSyncedFake('p1', META);
    p.emit('close', { event: { code: 4404, reason: 'doc-over-quota' } });
    expect(purgePidCaches).not.toHaveBeenCalled();
    expect(purgeForeignCaches).not.toHaveBeenCalled();
  });

  it('close (1000, "team disbanded")（gateway 裸字面量——T6 升常量收敛）⇒ purgePidCaches（团队解散已无读权）', async () => {
    const p = await driveToSyncedFake('p1', META);
    p.emit('close', { event: { code: 1000, reason: 'team disbanded' } });
    expect(purgePidCaches).toHaveBeenCalledWith('u1', 'p1');
  });

  it('close 1009 message-too-big（内容终态——权限/内容健康，escape 导出是设计动作）⇒ 不 purge', async () => {
    const p = await driveToSyncedFake('p1', META);
    p.emit('close', { event: { code: 1009, reason: '' } });
    expect(purgePidCaches).not.toHaveBeenCalled();
    expect(purgeForeignCaches).not.toHaveBeenCalled();
  });
});
