// apps/web/src/collab/rejected-recovery.spec.ts
// Y1c T25：rejected-recovery 模块单测——含 ★CRDT 单调性反例时序实锤（真 yjs 形态）：
//   同 doc 重连恢复（现状）的 SS2 差分上行=被拒毒帧内容被服务器「修复」接受（复活实锤）；
//   resync-full（fresh doc）的差分=零本地增量（被拒内容只存在于信封——用户裁定面）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { CollabCloseCode } from '@flowweb/shared';
import {
  collabDocNameOf, parseY1cClosePayload, parseAuthReceipt,
  loadPersistedHistoryId, persistHistoryId, appendHistoryParam,
  buildDraftEnvelope, sha256Hex, RecoveryDenyTracker, DENY_ESCAPE_THRESHOLD,
  broadcastRecoveryState, GENERIC_RECONNECT_BACKOFF_CODES,
} from './rejected-recovery';
import { getCollabTabId } from './local-collab-cache';

function stubBlobUrls(): void {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:mock' });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
}

beforeEach(() => {
  localStorage.clear();
  stubBlobUrls();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ══════════ ★CRDT 单调性反例：毒帧重放被「修复」接受的时序实锤（真 yjs） ══════════
describe('T25 ★红①机理证明：被拒后重复 apply 服务器态「修复」（真 yjs 时序）', () => {
  const seedNode = (id: string): Y.Map<any> => new Y.Map<any>([
    ['type', 'textInput'],
    ['position', new Y.Map([['x', 0], ['y', 0]])],
    ['data', new Y.Map([['v', id]])],
  ]);

  it('现状恢复（同 doc 重连）：SS2 差分上行=被拒毒内容被服务器接受（「修复」复活实锤——4412 resync 后旧帧重放不得被接受的反面证明）', () => {
    // 时序①：服务端 doc 与客户端 doc 同基线（服务端已 apply 的合法内容）
    const server = new Y.Doc();
    server.getMap('nodes').set('n-base', seedNode('base'));
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
    expect(client.getMap('nodes').size).toBe(1);

    // 时序②：客户端本地毒增量（被服务端 4411/4412 拒的帧——未上行确认）
    client.getMap('nodes').set('n-poison', seedNode('poison'));

    // 时序③（现状恢复=同 doc 重连）：provider 初同步上行 SS2 差分（self-contained——起点≤SV 连续覆盖
    // 为合法放行形态）→服务器 apply=被拒内容复活：deny 决策被重放击穿（「修复」接受实锤）
    const replayDiff = Y.encodeStateAsUpdate(client, Y.encodeStateVector(server));
    Y.applyUpdate(server, replayDiff);
    expect((server.getMap('nodes').get('n-poison') as Y.Map<any>).get('data').get('v')).toBe('poison');
    // ↑ 这正是红①要禁的形态：拒绝态被客户端重连重放「修复」——CRDT 单调性反例
  });

  it('绿形恢复（resync-full=fresh doc）：差分上行=零本地增量（毒内容只进信封——服务器态不被「修复」）', () => {
    const server = new Y.Doc();
    server.getMap('nodes').set('n-base', seedNode('base'));
    const oldClient = new Y.Doc();
    Y.applyUpdate(oldClient, Y.encodeStateAsUpdate(server));
    oldClient.getMap('nodes').set('n-poison', seedNode('poison'));

    // resync-full：fresh doc（零本地 structs）重连——上行差分恒空（内容保全走信封用户裁定）
    const fresh = new Y.Doc();
    const freshDiff = Y.encodeStateAsUpdate(fresh, Y.encodeStateVector(server));
    Y.applyUpdate(server, freshDiff);
    expect(server.getMap('nodes').has('n-poison')).toBe(false);   // 毒内容不复活
    expect(server.getMap('nodes').size).toBe(1);
  });
});

// ══════════ docName #g 镜像（T12） ══════════
describe('T25 collabDocNameOf（api canvasDocName 镜像——规范形）', () => {
  it('gen0/缺省=裸名；gen>0=#g<N>（禁前导零禁大写——api DOC_NAME_RE 同形）', () => {
    expect(collabDocNameOf('p1', 0)).toBe('project:p1');
    expect(collabDocNameOf('p1', undefined)).toBe('project:p1');
    expect(collabDocNameOf('p1', 3)).toBe('project:p1#g3');
    expect(collabDocNameOf('p1', 12)).toBe('project:p1#g12');
  });
});

// ══════════ 载荷解析 ══════════
describe('T25 parseY1cClosePayload / parseAuthReceipt', () => {
  it('Y1c close 载荷：code+reason 必备；generation/discardLocalCache/retryAfterMs 可选透传', () => {
    expect(parseY1cClosePayload(JSON.stringify({ code: 4410, reason: 'doc-vacuuming', generation: 4, discardLocalCache: true })))
      .toEqual({ code: 4410, reason: 'doc-vacuuming', generation: 4, discardLocalCache: true });
    expect(parseY1cClosePayload(JSON.stringify({ code: 4413, reason: 'maintenance-freeze', retryAfterMs: 30_000 })))
      .toEqual({ code: 4413, reason: 'maintenance-freeze', retryAfterMs: 30_000 });
    expect(parseY1cClosePayload('not-json')).toBeNull();
    expect(parseY1cClosePayload(JSON.stringify({ type: 'doc-status', rev: 1 }))).toBeNull();
  });
  it('auth-receipt：type+非空 historyId 才收（坏形状/坏 JSON 静默 null）', () => {
    expect(parseAuthReceipt(JSON.stringify({ type: 'auth-receipt', historyId: 'h1', protocolVersion: 1, schemaVersion: 3 })))
      .toEqual({ type: 'auth-receipt', historyId: 'h1', protocolVersion: 1, schemaVersion: 3 });
    expect(parseAuthReceipt(JSON.stringify({ type: 'auth-receipt', historyId: '' }))).toBeNull();
    expect(parseAuthReceipt('x')).toBeNull();
  });
});

// ══════════ historyId 半链（持久化+h= 参数） ══════════
describe('T25 historyId 客户端半链', () => {
  it('persist→load 往返；未持久化=null；appendHistoryParam 无值不追加', () => {
    expect(loadPersistedHistoryId()).toBeNull();
    persistHistoryId('h-abc');
    expect(loadPersistedHistoryId()).toBe('h-abc');
    expect(appendHistoryParam('ws://x/collab?csv=1', null)).toBe('ws://x/collab?csv=1');
    expect(appendHistoryParam('ws://x/collab?csv=1', 'h 1&=')).toBe('ws://x/collab?csv=1&h=h%201%26%3D');
  });
});

// ══════════ DraftEnvelope 构建（#9 historyId 随行） ══════════
describe('T25 buildDraftEnvelope（类型化导出——#9）', () => {
  it('真 doc→canonical 快照信封：historyId 随行+64hex hashes+空 doc=null（无可保全内容）', async () => {
    const d = new Y.Doc();
    d.getMap('nodes').set('n1', seedNodeAny('n1'));
    const env = await buildDraftEnvelope({
      doc: d, projectId: 'p1', generation: 3, schemaVersion: 3,
      historyId: 'hist-9', tabId: getCollabTabId(), draftId: 'draft-x',
    });
    expect(env).not.toBeNull();
    expect(env!.historyId).toBe('hist-9');          // #9：捕获纪元随行
    expect(env!.draftId).toBe('draft-x');
    expect(env!.nodes.length).toBe(1);
    expect(env!.hashes.nodes).toMatch(/^[0-9a-f]{64}$/);
    expect(env!.hashes.edges).toMatch(/^[0-9a-f]{64}$/);
    const empty = await buildDraftEnvelope({
      doc: new Y.Doc(), projectId: 'p1', generation: 3, schemaVersion: 3,
      historyId: 'hist-9', tabId: 't',
    });
    expect(empty).toBeNull();
  });
  it('sha256Hex：确定性+已知向量（空串=e3b0c442…；subtle 缺席环境=零填充占位）', async () => {
    const a = await sha256Hex('');
    const b = await sha256Hex('');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ══════════ 逃生口状态机（N=3——shared 转移单源+模式粘住） ══════════
describe('T25 RecoveryDenyTracker（重复 DENY 逃生口）', () => {
  it('N=3 次 4411→recovery 模式边沿回调恰一次；sync-ok 清计数但模式粘住；recovery-complete 回 normal', () => {
    const t = new RecoveryDenyTracker();
    expect(DENY_ESCAPE_THRESHOLD).toBe(3);
    const edge = vi.fn();
    t.onRecoveryMode = edge;
    t.deny4411();
    t.deny4411();
    expect(t.snapshot).toEqual({ consecutiveDenyCount: 2, mode: 'normal' });
    expect(edge).not.toHaveBeenCalled();
    t.deny4411();
    expect(t.snapshot.mode).toBe('recovery');
    expect(edge).toHaveBeenCalledTimes(1);
    // recovery 态 sync-ok：计数清零但模式粘住（退出仅经 recovery-complete——禁无限重连循环）
    t.syncOk();
    expect(t.snapshot).toEqual({ consecutiveDenyCount: 0, mode: 'recovery' });
    t.deny4411();   // recovery 态 deny 不重进不回退
    expect(t.snapshot.mode).toBe('recovery');
    t.recoveryComplete();
    expect(t.snapshot).toEqual({ consecutiveDenyCount: 0, mode: 'normal' });
  });
  it('1-2 次瞬态：sync-ok 清零重新起算（不提前切换）', () => {
    const t = new RecoveryDenyTracker();
    t.deny4411();
    t.syncOk();
    t.deny4411();
    expect(t.snapshot).toEqual({ consecutiveDenyCount: 1, mode: 'normal' });
  });
});

// ══════════ 装配守卫+BroadcastChannel ══════════
describe('T25 装配守卫（修正 #7）+多标签 BroadcastChannel', () => {
  it('GENERIC_RECONNECT_BACKOFF_CODES 不含 Y1c 四码（模块加载守卫已过——负控在 shared 单源测试）', () => {
    for (const code of [CollabCloseCode.CLIENT_OUTDATED, CollabCloseCode.FRAME_MALFORMED, CollabCloseCode.RESYNC_REQUIRED, CollabCloseCode.MAINTENANCE_FREEZE]) {
      expect(GENERIC_RECONNECT_BACKOFF_CODES).not.toContain(code);
    }
  });
  it('broadcastRecoveryState：BroadcastChannel postMessage（环境缺席静默降级不抛）', () => {
    expect(() => broadcastRecoveryState({ type: 'collab-recovery', pid: 'p1', kind: 'deny-escape' })).not.toThrow();
  });
});

function seedNodeAny(id: string): Y.Map<any> {
  return new Y.Map<any>([
    ['type', 'textInput'],
    ['position', new Y.Map([['x', 0], ['y', 0]])],
    ['data', new Y.Map([['v', id]])],
  ]);
}
