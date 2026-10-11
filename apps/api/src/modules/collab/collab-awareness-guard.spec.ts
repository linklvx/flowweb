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
import { makeAwarenessFrame as awarenessFrame } from '../../test-utils/frame-encoder';   // T6 外审 M1：varint 手编单源（原 pushVar 族+awarenessFrame 收口）
import { userColorOfUserId } from '@flowweb/shared';
import { AWARENESS_STATES_LIMIT_BYTES, AWARENESS_DISTINCT_USER_STRIP_OVER } from './collab.gateway';   // T12：解码后 states 判常量绑定（改值本测试红——帧闸 M4 同款）；T13：over-8 阈值同款绑定

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

// awareness 帧 wire 编码=frame-encoder 单源（原 pushVarUint/pushVarString/pushVarUint8Array/
// awarenessFrame 手编收口——apps/api 无 lib0 直依赖，AwarenessMessage 类亦非 provider 运行时出口，
// 裸帧构造=伪造路径的最小可行形态）。

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

describe('Y0b-4 T12（E38）：解码后 states 4KB 判（与 64KB 入站帧闸两实体两名）', () => {
  it('states JSON 字节>AWARENESS_STATES_LIMIT_BYTES ⇒ 整帧丢弃+awareness_reject{frame-too-large}（丢帧不 close——同连接后续帧照常；不登记不占上限槽）', async () => {
    const a = await connect('tokA');   // 对端判官（VIEWER 只影响其自身发帧——收帧无碍）
    const b = await connect('tokB');   // EDITOR 发帧（避开 readOnly 剔字段交叉——剔后字节缩小绕过 4KB 判）
    // T13：文档全量播种 2 distinct users（a/b 各发 user 帧）——避开 solo 剔字段交叉（solo 剔后
    // selection 消失字节缩小，同样绕过 4KB 判；与 readOnly 交叉同机理）
    sendAwareness(a, 601, { user: { id: 'x1', name: 'x' } });
    sendAwareness(b, 602, { user: { id: 'x2', name: 'x' } });
    await pollUntil(() => {
      const doc = kit.gateway.server.hocuspocus.documents.get(DOC)! as any;
      const ids = new Set([...doc.awareness.states.values()].map((s: any) => s?.user?.id).filter(Boolean));
      return ids.size >= 2;
    });
    const rejectCount = async () => {
      const metric: any = register.getSingleMetric('collab_awareness_reject_total');
      return (await metric.get()).values.find((s: any) => s.labels.reason === 'frame-too-large')?.value ?? 0;
    };
    let before = await rejectCount();
    for (let i = 0; i < 10; i++) {   // 计数基线静置（真连异步到账——先两读一致再断言增量，ghost 用例同款）
      await sleep(150);
      const next = await rejectCount();
      if (next === before) break;
      before = next;
    }
    // 单 id 超限：states JSON≈LIMIT+封套——帧总长 ~4.2KB < 64KB 不触入站帧闸（两实体正交）
    sendAwareness(b, 404, { selection: { nodeIds: ['n'.repeat(AWARENESS_STATES_LIMIT_BYTES + 64)] } });
    await pollUntil(async () => (await rejectCount()) === before + 1);
    expect(a.awareness!.getStates().get(404)).toBeUndefined();   // 整帧丢弃——对端零可见
    expect((kit.gateway as any).clientIdOwner.has(404)).toBe(false);   // 不登记（不占上限槽）
    sendAwareness(b, 405, { cursor: { x: 1 } });   // 丢帧不 close——同连接后续正常帧照常广播
    await pollUntil(() => (a.awareness!.getStates().get(405) as any)?.user?.id === 'u2');
  });
});

describe('Y0b-4 T13（E39/Q-L 后两档）：solo/over-8 剔字段（distinct user 判定=文档全量∪本帧）', () => {
  /** stripped 计数读取（reason 键控） */
  const strippedCount = async (reason: string) => {
    const metric: any = register.getSingleMetric('collab_awareness_stripped_total');
    return (await metric.get()).values.find((s: any) => s.labels.reason === reason)?.value ?? 0;
  };
  /** 计数基线静置（真连异步到账——先两读一致再断言增量；ghost 用例同款） */
  async function settleStripped(reason: string): Promise<number> {
    let before = await strippedCount(reason);
    for (let i = 0; i < 10; i++) {
      await sleep(150);
      const next = await strippedCount(reason);
      if (next === before) break;
      before = next;
    }
    return before;
  }

  it('solo：distinct user.id≤1（两 tab 同人=solo——连接数判据=口径偏离红相）剔 cursor/selection 后回显照常+stripped{solo}', async () => {
    const b1 = await connect('tokB');
    const b2 = await connect('tokB');   // 同人双标签——连接数 2 但 distinct user 恒 1（口径=用户非连接）
    sendAwareness(b1, 111, { user: { id: 'fake', name: 'x' } });   // 播种本人（注入后 u2——文档全量 distinct=1）
    await pollUntil(() => (b2.awareness!.getStates().get(111) as any)?.user?.id === 'u2');
    const before = await settleStripped('solo');
    sendAwareness(b1, 111, { cursor: { x: 5, y: 5 } });   // 单人 cursor 帧
    await pollUntil(async () => (await strippedCount('solo')) === before + 1);
    // 回显照常：条目永不删+clock 保持原值（禁递增）——b2 meta.clock 前进=帧真到达
    await pollUntil(() => ((b2.awareness as any).meta.get(111)?.clock ?? 0) >= 2);
    const st = b2.awareness!.getStates().get(111) as any;
    expect('cursor' in st).toBe(false);   // cursor 剥离（undefined JSON 序列化丢键）
    expect(st.user).toEqual(serverUserOf('tokB'));   // user 保留（成员表/presence 面不受影响）
  });

  it('over-8：distinct user.id>8 剔字段+成员表数据源（user/presence）不受影响+stripped{over-8}', async () => {
    const a = await connect('tokA');   // 对端判官（VIEWER 只影响其自身发帧——收帧无碍）
    const b = await connect('tokB');   // EDITOR 发帧者
    // 文档全量播种至 9 distinct users（OVER+1 个直写 doc awareness——判据源=文档全量，与真连 user 无异）
    const doc = kit.gateway.server.hocuspocus.documents.get(DOC)! as any;
    for (let i = 0; i <= AWARENESS_DISTINCT_USER_STRIP_OVER; i++) {
      doc.awareness.states.set(9000 + i, { user: { id: `seed-u${i}`, name: `seed${i}` } });
    }
    const before = await settleStripped('over-8');
    sendAwareness(b, 777, { presence: true, cursor: { x: 1, y: 1 } });
    await pollUntil(async () => (await strippedCount('over-8')) === before + 1);
    await pollUntil(() => (a.awareness!.getStates().get(777) as any)?.user?.id === 'u2');
    const st = a.awareness!.getStates().get(777) as any;
    expect('cursor' in st).toBe(false);   // cursor 剥离
    expect(st.presence).toBe(true);   // 成员表数据源（user/presence）不受影响
    expect(st.user).toEqual(serverUserOf('tokB'));
  });

  it('反例（P1-6）：多人画布（文档全量已有 2+ user）单帧只含发帧者 ⇒ 不触发 solo 剥离（取数源=文档全量∪本帧，非本帧单源）', async () => {
    const a = await connect('tokA');
    const b = await connect('tokB');
    // 文档全量播种 2 distinct users（a/b 各发 user 帧——注入后 u1/u2 落 doc）
    sendAwareness(a, 601, { user: { id: 'x1', name: 'x' } });
    sendAwareness(b, 602, { user: { id: 'x2', name: 'x' } });
    await pollUntil(() => {
      const doc = kit.gateway.server.hocuspocus.documents.get(DOC)! as any;
      const ids = new Set([...doc.awareness.states.values()].map((s: any) => s?.user?.id).filter(Boolean));
      return ids.size >= 2;
    });
    const before = await settleStripped('solo');
    sendAwareness(b, 603, { cursor: { x: 3, y: 3 } });   // 单帧只含发帧者（无 user 字段）——本帧单源会误判 solo
    await pollUntil(() => (a.awareness!.getStates().get(603) as any)?.cursor?.x === 3);   // cursor 全须到达（不剥离）
    expect((a.awareness!.getStates().get(603) as any).user).toEqual(serverUserOf('tokB'));
    expect(await strippedCount('solo')).toBe(before);   // 无 solo 剥离计数
  });
});
