// apps/api/src/modules/collab/collab-awareness-guard.spec.ts
// Y0b-3 T7（E73/spec §3.3）：awareness states 归属三分支+身份覆写——真连装置（dual-client-server 双客户端
// +对端可见性判官）。锚族：伪造锚（对端可见性非仅服务端 states）/无条件注入（局部帧绕过面）/归属锚
// （伪造他人 clientId 丢弃非改写）/首帧可见性锚（登记与注入同一趟）/上限 4/DirectConnection 放行/
// 库 clients 集漂移探针/同用户双标签 socketId 隔离。
// 伪造帧发送形态：裸 ws 帧（lib0 变长整数手编——AwarenessMessage 非 provider 运行时出口）——
// 绕过客户端 awareness 状态机，伪造=任意 clientId+任意 user 载荷（meta 手播种 clock 过 y-protocols 时钟门）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { register } from 'prom-client';
import { startDualClientServer, type DualClientKit } from '../../test-utils/dual-client-server';
import { pollUntil } from '../../test-utils/poll-until';
import { userColorOfUserId } from '@flowweb/shared';

const DOC = 'project:ap1';
const FUTURE = new Date(Date.now() + 24 * 3600 * 1000);
const USERS: Record<string, { id: string; name: string }> = {
  tokA: { id: 'u1', name: '张三' },   // VIEWER——E73 缺口本尊（awareness 分支无 readOnly 门）
  tokB: { id: 'u2', name: '李四' },
};
const serverUserOf = (token: string) => {
  const u = USERS[token];
  const role = u.id === 'u1' ? 'PROJECT_VIEWER' : 'PROJECT_EDITOR';
  return { id: u.id, name: u.name, role, color: userColorOfUserId(u.id) };
};

let kit: DualClientKit;

// —— awareness 帧 wire 编码（lib0 变长整数手编——behavior-anchors.gate.spec 手解同款；apps/api 无 lib0
// 直依赖，AwarenessMessage 类亦非 provider 运行时出口——裸帧构造=伪造路径的最小可行形态）——
function pushVarUint(out: number[], num: number): void {
  for (;;) {
    if (num < 0x80) { out.push(num); return; }
    out.push((num & 0x7f) | 0x80);
    num = Math.floor(num / 0x80);
  }
}
function pushVarString(out: number[], s: string): void {
  const bytes = Array.from(new TextEncoder().encode(s));
  pushVarUint(out, bytes.length);
  out.push(...bytes);
}
function pushVarUint8Array(out: number[], arr: Uint8Array): void {
  pushVarUint(out, arr.length);
  out.push(...Array.from(arr));
}
function awarenessFrame(documentName: string, entries: Array<{ clientId: number; clock: number; state: unknown }>): Uint8Array {
  const upd: number[] = [];
  pushVarUint(upd, entries.length);
  for (const e of entries) {
    pushVarUint(upd, e.clientId);
    pushVarUint(upd, e.clock);
    pushVarString(upd, JSON.stringify(e.state));
  }
  const frame: number[] = [];
  pushVarString(frame, documentName);
  pushVarUint(frame, 1);   // MessageType.Awareness
  pushVarUint8Array(frame, Uint8Array.from(upd));
  return Uint8Array.from(frame);
}

/** 伪造 awareness 帧发送：绕过客户端 awareness 状态机——裸 ws 帧直发（clientId 可为任意值，state
 *  任意形状；meta 播种 clock 保证帧过 y-protocols 时钟门——若非丢弃路径，doc 侧必真应用）。 */
function sendAwareness(provider: HocuspocusProvider, clientId: number, state: Record<string, unknown>): void {
  const meta = (provider.awareness as any).meta as Map<number, { clock: number; lastUpdated: number }>;
  const clock = (meta.get(clientId)?.clock ?? 0) + 1;
  meta.set(clientId, { clock, lastUpdated: Date.now() });
  const ws = (provider as any).configuration.websocketProvider.webSocket;
  ws.send(awarenessFrame(DOC, [{ clientId, clock, state }]));
}

/** prom-client 计数增量断言（collab.gateway.sweep.spec 同款） */
async function metricDelta(name: string, labels: Record<string, string>, fn: () => Promise<unknown> | unknown): Promise<number> {
  const metric: any = register.getSingleMetric(name);
  const countOf = async () =>
    (await metric.get()).values.find((s: any) => Object.entries(labels).every(([k, v]) => s.labels[k] === v))?.value ?? 0;
  const before = await countOf();
  await fn();
  return (await countOf()) - before;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

beforeEach(async () => {
  kit = await startDualClientServer({}, 300);
  // 多用户身份分型：token→user（SessionService.resolve 直查 prisma.session.findUnique）
  kit.prisma.session.findUnique.mockImplementation(async ({ where: { token } }: any) =>
    USERS[token] ? { userId: USERS[token].id, expiresAt: FUTURE, user: USERS[token] } : null);
  // 权限分型：u1=VIEWER（伪造攻击主体——E73 实证缺口即 VIEWER/匿名可广播任意 user 字段）
  kit.permSvc.resolveWithTeam.mockImplementation(async (_pid: string, userId: string) =>
    ({ role: userId === 'u1' ? 'PROJECT_VIEWER' : 'PROJECT_EDITOR', teamId: 't1' }));
});

afterEach(async () => {
  await kit.dispose();
});

/** kit.connect 外包——provider 台账归 kit（dispose 统一销毁） */
async function connect(token: string): Promise<HocuspocusProvider> {
  const { provider, synced } = kit.connect(DOC, token);
  await synced;
  return provider;
}

describe('Y0b-3 T7 awareness 覆写+归属三分支（E73/spec §3.3）', () => {
  it('伪造锚：VIEWER 伪造 user 字段→对端看到=服务端身份（改前红：客户端自写直进 states；断言对端可见性）', async () => {
    const a = await connect('tokA');
    const b = await connect('tokB');
    sendAwareness(a, 111, { user: { id: 'fake-admin', name: 'x', role: 'owner' } });
    await pollUntil(() => (b.awareness!.getStates().get(111) as any)?.user?.id !== undefined);
    expect((b.awareness!.getStates().get(111) as any).user).toEqual(serverUserOf('tokA'));
  });

  it('无条件注入：局部帧（只带 cursor 不带 user）也覆写——伪造者先发真身再发局部帧不保留旧伪造（P0-2 绕过修正）', async () => {
    const a = await connect('tokA');
    const b = await connect('tokB');
    sendAwareness(a, 111, { user: { id: 'fake-admin', name: 'x', role: 'owner' } });
    await pollUntil(() => (b.awareness!.getStates().get(111) as any)?.user?.id === 'u1');
    sendAwareness(a, 111, { cursor: { x: 1 } });   // 不带 user 的局部帧
    // 帧确已应用（防丢弃路径假绿）：Y0b-4 T6 起 VIEWER cursor 被剔字段（Q-L——条目不删仍广播），
    // 应用证据改对端 meta.clock 前进（剥离帧含原 clock 恒广播）
    await pollUntil(() => ((b.awareness as any).meta.get(111)?.clock ?? 0) >= 2);
    expect((b.awareness!.getStates().get(111) as any).cursor).toBeUndefined();   // T6：VIEWER cursor 零广播
    expect((b.awareness!.getStates().get(111) as any).user).toEqual(serverUserOf('tokA'));   // user 恒为服务端值
  });

  it('归属锚：伪造他人 clientId 帧（跨用户）→对端 state 不被覆盖（丢弃非改写——不替别人发声）', async () => {
    const a = await connect('tokA');
    const b = await connect('tokB');
    sendAwareness(a, 111, { user: { id: 'fake', name: 'x' } });   // A 首帧登记 111
    await pollUntil(() => (b.awareness!.getStates().get(111) as any)?.user?.id === 'u1');
    await metricDelta('collab_awareness_reject_total', { reason: 'forged' }, async () => {
      sendAwareness(b, 111, { cursor: { x: 1 } });   // B 伪造 A 已登记的 clientId
    });
    expect((b.awareness!.getStates().get(111) as any).cursor).toBeUndefined();   // 伪造帧整体不进广播
    expect((b.awareness!.getStates().get(111) as any).user).toEqual(serverUserOf('tokA'));   // 原主 state 完整
  });

  it('首帧可见性锚：新 clientId 首个 awareness 帧即含 user→对端最终可见（登记与注入同一趟——首帧不被丢弃）', async () => {
    const a = await connect('tokA');
    const b = await connect('tokB');
    sendAwareness(a, 222, { user: { id: 'fake', name: 'x' } });   // 首帧=首见 clientId
    await pollUntil(() => (b.awareness!.getStates().get(222) as any)?.user?.id === 'u1');
    expect((b.awareness!.getStates().get(222) as any).user).toEqual(serverUserOf('tokA'));
  });

  it('单连接 clientId 上限 4（第 5 个丢弃+计数 owner-limit——spec §3.3 终裁值）', async () => {
    const a = await connect('tokA');
    const b = await connect('tokB');
    // 连接自身占位（clock=0）被 y-protocols 时钟门剥离、scratch 幽灵被 guard 空态判据剔除——
    // 上限槽位=纯真内容 clientId（plan 原型：4 登记+第 5 丢弃）
    for (const cid of [301, 302, 303, 304]) {
      sendAwareness(a, cid, { user: { id: 'fake', name: 'x' } });
      await pollUntil(() => (b.awareness!.getStates().get(cid) as any)?.user?.id === 'u1');
    }
    const own = (kit.gateway as any).ownedClientIds.get((kit.gateway as any).clientIdOwner.get(301)) as Set<number>;
    expect(own.size).toBe(4);   // 恰 4 个真内容 clientId
    await metricDelta('collab_awareness_reject_total', { reason: 'owner-limit' }, async () => {
      sendAwareness(a, 305, { user: { id: 'fake', name: 'x' } });   // 第 5 个
    });
    expect(b.awareness!.getStates().get(305)).toBeUndefined();   // 超限帧不进广播
    expect((kit.gateway as any).clientIdOwner.has(305)).toBe(false);
    expect(own.size).toBe(4);   // 上限不被超限帧突破
  });

  it('scratch 幽灵剔除计数：空态首见帧被剔时 ghost 计数（T10 观测盲区根修——改前剔除无计数=红；真身空态续期帧同判据被剔=空闲重连循环根因，计数异常增高=客户端播种退化信号）', async () => {
    const a = await connect('tokA');
    const b = await connect('tokB');
    // ghost 帧被剔=零可观测副作用，唯一证据=计数本身；计数经真连异步到账——先静置基线（两读一致）
    // 再断言该帧增量（metricDelta 包 send 不可用：fn 返回时帧尚未抵达服务端=恒读 0）
    const ghostCount = async () => {
      const metric: any = register.getSingleMetric('collab_awareness_reject_total');
      return (await metric.get()).values.find((s: any) => s.labels.reason === 'ghost')?.value ?? 0;
    };
    let before = await ghostCount();
    for (let i = 0; i < 10; i++) {
      await sleep(150);
      const next = await ghostCount();
      if (next === before) break;
      before = next;
    }
    sendAwareness(a, 555, {});   // 空态首见=幽灵形态指纹（库构造器 setLocalState({}) 同款）
    await pollUntil(async () => (await ghostCount()) === before + 2);
    expect((await ghostCount()) - before).toBe(2);   // 每帧恰两条空态剔除：scratch 构造幽灵+555 真条目（改前：剔除无计数→轮询超时必红）
    expect(b.awareness!.getStates().get(555)).toBeUndefined();   // 幽灵帧不进广播
    expect((kit.gateway as any).clientIdOwner.has(555)).toBe(false);   // 不登记（不吃上限槽位）
  });

  it('DirectConnection/服务端内部写（connection undefined 或 context undefined 或 socketId 空串）→整体放行禁删禁改（P0-1）', async () => {
    const states = new Map([[999, { user: { id: 'ghost' }, cursor: { x: 1 } }]]);
    const docStub = { getClients: () => new Set<number>(), awareness: { states: new Map() } };
    await kit.gateway.hooks.beforeHandleAwareness({
      states, socketId: '', context: undefined, connection: undefined, document: docStub,
    } as any);
    expect(states.get(999)).toEqual({ user: { id: 'ghost' }, cursor: { x: 1 } });   // 禁删禁改
    expect((kit.gateway as any).clientIdOwner.size).toBe(0);   // 不登记
    const states2 = new Map([[999, { user: { id: 'ghost' } }]]);
    await kit.gateway.hooks.beforeHandleAwareness({
      states: states2, socketId: 'sock-x', context: undefined, connection: { socketId: 'sock-x' }, document: docStub,
    } as any);
    expect(states2.get(999)).toEqual({ user: { id: 'ghost' } });   // context 缺失同放行（Direct 形态变体）
  });

  it('一致性校验源：库 clients 集相对归属表差异→结构化告警（spec §3.3 ③——不信赖库内部也为漂移留探针）', async () => {
    const a = await connect('tokA');
    const b = await connect('tokB');
    sendAwareness(a, 111, { user: { id: 'fake', name: 'x' } });
    await pollUntil(() => (b.awareness!.getStates().get(111) as any)?.user?.id === 'u1');
    const doc = kit.gateway.server.hocuspocus.documents.get(DOC)! as any;
    for (const [, entry] of doc.connections) entry.clients.add(424242);   // 库集人工混入归属表外的 id=漂移形态
    const warn = vi.spyOn((kit.gateway as any).logger, 'warn');
    sendAwareness(a, 111, { cursor: { x: 2 } });   // 正常帧驱动探针
    await pollUntil(() => warn.mock.calls.some((c) => String(c[0]).includes('collab_awareness_drift')));
    expect(JSON.parse(warn.mock.calls.find((c) => String(c[0]).includes('collab_awareness_drift'))![0] as string).event).toBe('collab_awareness_drift');
  });

  it('同用户双标签断连不冻结对端光标（socketId 隔离回归锚）：标签1 断连只清自己登记的 clientId', async () => {
    const a1 = await connect('tokA');
    const a2 = await connect('tokA');
    const b = await connect('tokB');
    sendAwareness(a1, 111, { user: { id: 'fake', name: 'x' } });   // 标签1 登记 111
    await pollUntil(() => (b.awareness!.getStates().get(111) as any)?.user?.id === 'u1');
    sendAwareness(a2, 222, { user: { id: 'fake', name: 'x' } });   // 标签2 登记 222
    await pollUntil(() => (b.awareness!.getStates().get(222) as any)?.user?.id === 'u1');
    const sock1 = (kit.gateway as any).clientIdOwner.get(111) as string;
    const sock2 = (kit.gateway as any).clientIdOwner.get(222) as string;
    expect(sock1).not.toBe(sock2);   // socketId 逐连接唯一——双标签天然隔离
    await a1.destroy();   // 标签1 断连
    kit.forget(a1);   // 用例自管 destroy 后从 dispose 台账移除（双 destroy=本仓已知 flaky 源——kit 注释）
    await pollUntil(() => !(kit.gateway as any).clientIdOwner.has(111));   // 只清自己登记的
    expect((kit.gateway as any).clientIdOwner.get(222)).toBe(sock2);   // 标签2 所有权不动
    expect((kit.gateway as any).socketIdentity.has(sock1)).toBe(false);
    sendAwareness(a2, 222, { cursor: { x: 9 } });   // 对端 awareness 仍流动（Y0b-4 T6：VIEWER cursor 被剔字段——锚改 meta.clock 前进）
    await pollUntil(() => ((b.awareness as any).meta.get(222)?.clock ?? 0) >= 2);
    expect((b.awareness!.getStates().get(222) as any).cursor).toBeUndefined();   // T6：VIEWER cursor 零广播
    expect((b.awareness!.getStates().get(222) as any).user).toEqual(serverUserOf('tokA'));
  });
});
