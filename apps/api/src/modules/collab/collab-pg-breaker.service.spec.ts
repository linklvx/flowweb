// apps/api/src/modules/collab/collab-pg-breaker.service.spec.ts
// Y0b-5 T16（spec §5.9 E57/plan 红测）：PG 熔断（准入+store 短路 spool）+docName 全匹配守卫。
// - describe A：码表+分类单源（PG_CONNECTION_CODES 参与推闸；P2024 池满/业务错只观测）+死代码处置锚。
// - describe B：breaker 状态机（30s 窗≥5 次∧失败率>50%/半开探测/三态 gauge）。
// - describe C：gateway 接线（两入口准入零 Prisma+store PG 分支直落 spool+范围静态锚恰三调用点）。
// - describe D：docName 全匹配守卫（别名执法分叉根修——onAuthenticate/loadDocument/direct 三入口统一）。
// 形态：直构单元组（auth-defense spec 先例——mock prisma/repo/lease+真 spool 临时目录）。
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Y from 'yjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { register } from 'prom-client';
import { CollabGateway } from './collab.gateway';
import { CollabDocumentService } from './collab-document.service';
import { CollabPgBreakerService, BREAKER_COOLDOWN_MS, BREAKER_MIN_SAMPLES, BREAKER_WINDOW_MS } from './collab-pg-breaker.service';
import { PG_CONNECTION_CODES, classifyPgError } from './pg-error.util';
import { CollabSpoolService } from './collab-spool.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createLeaseStub } from './test-utils/lease-stub';
import { gatewayFacade } from './test-utils/collab-gateway-test-facade';   // Y0c T39b 波 2：内部状态访问经 façade（check-collab-test-facade 门禁）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CLIENT_PROTOCOL_VERSION } from '@flowweb/shared';

/** 真 Prisma 错误形态（hydration int 先例——P 码手造但形状与真库一致；真 P1001 注入归 int spec） */
const p1001 = () => Object.assign(new Error("Can't reach database server"), { code: 'P1001' });
const p2024 = () => Object.assign(new Error('Timed out fetching a new connection from the connection pool'), { code: 'P2024' });
/** 合法 Yjs update（store 链 spool 兜底/合并要真解码——裸字节会炸 mergeUpdates 走 Y2 兜底绕过断言面） */
const yupdate = (): Uint8Array => {
  const d = new Y.Doc(); d.getMap('m').set('k', Math.random());
  return Y.encodeStateAsUpdate(d);
};

async function gaugeValue(name: string): Promise<number | undefined> {
  const m = register.getSingleMetric(name) as any;
  if (!m) return undefined;
  return (await m.get()).values[0]?.value;
}

async function counterDelta(name: string, labels: Record<string, string>, fn: () => unknown): Promise<number> {
  const metric: any = register.getSingleMetric(name);
  const read = async () =>
    (await metric.get()).values.find((s: any) => Object.entries(labels).every(([k, v]) => s.labels[k] === v))?.value ?? 0;
  const before = await read();
  fn();
  return (await read()) - before;
}

// ===== describe A：码表+分类单源 =====
describe('Y0b-5 T16 A：PG_CONNECTION_CODES 码表+classify 单源（同模块两策略——禁把业务错/池满算成 PG 故障推开闸门）', () => {
  it('码表导出=连接族三码（P1001 不可达/P1002 服务端连接饱和/P1008 连接超时）——参与 open 判定', () => {
    expect(PG_CONNECTION_CODES).toEqual(['P1001', 'P1002', 'P1008']);
  });

  it('classify：连接族三码→connection；P2024 池满→pool；业务错 P2002/无 code→other（池满=压力期拒新装载赶走用户方向反了——只计观测）', () => {
    expect(classifyPgError(p1001())).toBe('connection');
    expect(classifyPgError({ code: 'P1002' })).toBe('connection');
    expect(classifyPgError({ code: 'P1008' })).toBe('connection');
    expect(classifyPgError(p2024())).toBe('pool');
    expect(classifyPgError({ code: 'P2002' })).toBe('other');
    expect(classifyPgError(new Error('plain timeout'))).toBe('other');
    expect(classifyPgError(undefined)).toBe('other');
  });

  it('★死代码处置：isRetryableAppendError 零生产调用点——删除（码表单源归 classify，禁留考古层）', () => {
    const src = readFileSync(resolve(__dirname, 'pg-error.util.ts'), 'utf8');
    expect(src).not.toMatch(/export function isRetryableAppendError/);
  });

  it('真库实证形状（int 停机注入 Prisma 5.22）：PrismaClientInitializationError 无 code——按 P1001 官方文案回退 connection（纯 code 分类器对真停机恒 other=熔断永不触发）', () => {
    const real = Object.assign(new Error("\nInvalid `prisma.$queryRaw()` invocation:\n\nCan't reach database server at `localhost:1`"), { name: 'PrismaClientInitializationError', clientVersion: '5.22.0' });
    expect((real as any).code).toBeUndefined();   // 前提锚：真形状无 code
    expect(classifyPgError(real)).toBe('connection');
  });
});

// ===== describe B：breaker 状态机 =====
describe('Y0b-5 T16 B：熔断状态机（closed/open/half-open——窗口失败率+半开探测）', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('open 判据=30s 窗≥5 次∧失败率>50%（4 连败不开——窗口下限采纳防低 QPS 假阳性；4F+1S 比率 0.8>0.5 开）', () => {
    const b = new CollabPgBreakerService();
    for (let i = 0; i < BREAKER_MIN_SAMPLES - 1; i++) b.recordFailure(p1001());
    expect(b.stateName()).toBe('closed');   // 4 连败：样本 <5 不开（纯连续计数低 QPS 假阳性防线）
    b.recordSuccess();                       // 第 5 样本：4F+1S 比率 0.8
    expect(b.stateName()).toBe('open');
    expect(b.admitQuery()).toBe(false);
    expect(b.isOpen()).toBe(true);
  });

  it('失败率≤50% 不开（2F+3S=0.4）——且仅连接族失败参与：5×P2024 池满只计观测恒 closed', async () => {
    const b = new CollabPgBreakerService();
    b.recordFailure(p1001()); b.recordFailure(p1001());
    for (let i = 0; i < 3; i++) b.recordSuccess();
    expect(b.stateName()).toBe('closed');
    for (let i = 0; i < 10; i++) b.recordFailure(p2024());
    expect(b.stateName()).toBe('closed');   // 池满不参与 open（P2024 推闸=压力期赶走用户方向反）
    expect(await counterDelta('collab_pg_breaker_failures_total', { class: 'pool' }, () => b.recordFailure(p2024()))).toBe(1);
  });

  it('窗口 30s 滚动：样本出窗后不再计入（2F+3S closed→advance 31s→2F 仍 closed）', () => {
    const b = new CollabPgBreakerService();
    b.recordFailure(p1001()); b.recordFailure(p1001());
    for (let i = 0; i < 3; i++) b.recordSuccess();
    vi.advanceTimersByTime(BREAKER_WINDOW_MS + 1_000);
    b.recordFailure(p1001()); b.recordFailure(p1001());
    expect(b.stateName()).toBe('closed');   // 旧 5 样本已出窗——窗内仅 2 失败 <5
  });

  it('冷却期后半开：open→advance 冷却→half-open（准入放行=下一调用为探测）', () => {
    const b = new CollabPgBreakerService();
    for (let i = 0; i < 5; i++) b.recordFailure(p1001());
    expect(b.stateName()).toBe('open');
    vi.advanceTimersByTime(BREAKER_COOLDOWN_MS + 1);
    expect(b.stateName()).toBe('half-open');
    expect(b.admitQuery()).toBe(true);   // half-open 放行探测
    expect(b.isOpen()).toBe(false);      // store 不再短路——探测走 PG
  });

  it('half-open 探测成功→closed+onRecovered 回调恰一次（refusalCache 清空钩子缝）+窗清空', () => {
    const b = new CollabPgBreakerService();
    const recovered = vi.fn();
    b.setOnRecovered(recovered);
    for (let i = 0; i < 5; i++) b.recordFailure(p1001());
    vi.advanceTimersByTime(BREAKER_COOLDOWN_MS + 1);
    b.recordSuccess();
    expect(b.stateName()).toBe('closed');
    expect(recovered).toHaveBeenCalledTimes(1);
    // 窗已清空：此后 4 次失败不立即 open（需重新积满窗口）
    for (let i = 0; i < 4; i++) b.recordFailure(p1001());
    expect(b.stateName()).toBe('closed');
  });

  it('half-open 探测失败→回 open（冷却重启——再经冷却才第二次探测）', () => {
    const b = new CollabPgBreakerService();
    for (let i = 0; i < 5; i++) b.recordFailure(p1001());
    vi.advanceTimersByTime(BREAKER_COOLDOWN_MS + 1);
    b.recordFailure(p1001());
    expect(b.stateName()).toBe('open');
    vi.advanceTimersByTime(BREAKER_COOLDOWN_MS - 1);
    expect(b.stateName()).toBe('open');      // 冷却未满——不探测
    vi.advanceTimersByTime(2);
    expect(b.stateName()).toBe('half-open');
  });

  it('三态 gauge collab_pg_breaker_state：closed=0/open=1/half-open=2', async () => {
    const b = new CollabPgBreakerService();
    expect(await gaugeValue('collab_pg_breaker_state')).toBe(0);
    for (let i = 0; i < 5; i++) b.recordFailure(p1001());
    expect(await gaugeValue('collab_pg_breaker_state')).toBe(1);
    vi.advanceTimersByTime(BREAKER_COOLDOWN_MS + 1);
    expect(await gaugeValue('collab_pg_breaker_state')).toBe(2);
    b.recordSuccess();
    expect(await gaugeValue('collab_pg_breaker_state')).toBe(0);
  });

  it('failures_total{class} 连接族/池满/未知三档可见（全类观测——code undefined 也留痕）', async () => {
    const b = new CollabPgBreakerService();
    expect(await counterDelta('collab_pg_breaker_failures_total', { class: 'connection' }, () => b.recordFailure(p1001()))).toBe(1);
    expect(await counterDelta('collab_pg_breaker_failures_total', { class: 'other' }, () => b.recordFailure(new Error('x')))).toBe(1);
  });
});

// ===== 直构 gateway 装置（auth-defense spec 同款） =====
let spoolDir: string;
let spoolCleanup: () => Promise<void> = async () => {};
beforeEach(async () => {
  const d = await makeSpoolDir('y0b5-breaker-');
  spoolDir = d.dir;
  spoolCleanup = d.cleanup;
});
afterEach(async () => { await spoolCleanup(); });

function buildGateway() {
  const prisma = {
    systemHistory: { findUnique: vi.fn().mockResolvedValue({ historyId: 'spec-history-id', epochStartedAt: new Date() }) },  // Y1c T9（T8 接线）：listenCollab requireSystemHistory fail-closed 读面 mock

    session: {
      findUnique: vi.fn().mockResolvedValue({ user: { id: 'u1', name: '张三' }, userId: 'u1', expiresAt: new Date(Date.now() + 24 * 3600 * 1000) }),
      update: vi.fn(async (args: any) => ({ user: { id: 'u1', name: '张三' }, expiresAt: args.data.expiresAt })),
    },
    canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1', userId: 'other' }) },
    projectMember: { findUnique: vi.fn().mockResolvedValue(null) },
    teamMember: { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER', userId: 'u1' }) },
  };
  const repo = createMockRepo();
  const lease = createLeaseStub();
  const perm = {
    resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
    resolveWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' }),
  };
  const spool = new CollabSpoolService(spoolDir);
  spool.setOwner('test-owner');
  const gateway = new CollabGateway(
    prisma as any, new EventEmitter2() as any, repo as any, lease as any,
    perm as any, 48000 + Math.floor(Math.random() * 2000),
    undefined, undefined, undefined, spool,
  );
  gatewayFacade(gateway).forceCollabState('serving');
  return { gateway, prisma, repo, perm, spool };
}

function authPayload(documentName = 'project:p1') {
  return {
    requestHeaders: new Headers({ cookie: 'flowweb.session_token=tok' }),
    requestParameters: new URLSearchParams(`csv=${CLIENT_PROTOCOL_VERSION}`),
    socketId: 'sock-breaker-1',
    documentName,
    connectionConfig: { readOnly: false, isAuthenticated: false },
  };
}

function openBreaker(gateway: CollabGateway): void {
  const b = gatewayFacade(gateway).pgBreakerRef();
  for (let i = 0; i < 5; i++) b.recordFailure(p1001());
}

// ===== describe C：gateway 接线 =====
describe('Y0b-5 T16 C：gateway 两熔断面+三调用点静态锚', () => {
  it('熔断面①auth 准入：open 时 onAuthenticate 直接 db-unavailable 且零 Prisma（防每条新会话等满 deadline）', async () => {
    const { gateway, prisma } = buildGateway();
    openBreaker(gateway);
    await expect(gateway.hooks.onAuthenticate(authPayload() as any)).rejects.toMatchObject({ reason: 'db-unavailable' });
    expect(prisma.session.findUnique).not.toHaveBeenCalled();   // 零 Prisma 断言
    const metric: any = register.getSingleMetric('collab_auth_reject_total');
    const hit = (await metric.get()).values.find((s: any) => s.labels.reason === 'db-unavailable' && s.labels.source === 'state');
    expect(hit?.value).toBeGreaterThan(0);
  });

  it('熔断面①loadDocument 准入：open 时拒装载（503 COLLAB_NOT_SERVING 面+reason db-unavailable）且零 repo 调用', async () => {
    const { gateway, repo } = buildGateway();
    openBreaker(gateway);
    await expect(gateway.hooks.onLoadDocument({ document: new Y.Doc(), documentName: 'project:p1', socketId: 's1' } as any))
      .rejects.toMatchObject({ reason: 'db-unavailable' });
    expect(repo.hydrateWithRecovery).not.toHaveBeenCalled();   // 零 Prisma 断言
  });

  it('熔断面②store 短路：open 时 storeDocumentUnlocked PG 分支首行短路——批直落 spool（返回 false+队列清空+spool 有帧+零 repo）', async () => {
    const { gateway, repo, spool } = buildGateway();
    openBreaker(gateway);
    gatewayFacade(gateway).seedPendingQueue('p1', [yupdate()]);
    const ok = await gateway.persistence.storeDocumentUnlocked({ document: {} as any, documentName: 'project:p1' } as any, 'maintenance');
    expect(ok).toBe(false);
    expect(gatewayFacade(gateway).pendingQueueRef('p1')).toHaveLength(0);   // 队列清空=批已落新家
    expect(spool.hasFrames('p1')).toBe(true);                            // 新家=spool（BOI 契约——不拒 append 同语义）
    expect(repo.appendBatch).not.toHaveBeenCalled();                          // 零 PG 等待（省 5s 事务上界）
  });

  it('half-open 成功→store 走 PG+补排空 spool（帧 confirm 段回收）+breaker 回 closed', async () => {
    vi.useFakeTimers();
    try {
      const { gateway, repo, spool } = buildGateway();
      openBreaker(gateway);
      gatewayFacade(gateway).seedPendingQueue('p1', [yupdate()]);
      await gateway.persistence.storeDocumentUnlocked({ document: {} as any, documentName: 'project:p1' } as any, 'maintenance');   // open 期落 spool
      expect(spool.hasFrames('p1')).toBe(true);
      gatewayFacade(gateway).cancelPersistRetry('project:p1');   // 撤退避梯（既有自愈通道——不撤会抢先排空帧，隔离本断言面）
      vi.advanceTimersByTime(BREAKER_COOLDOWN_MS + 1);   // →half-open
      const ok = await gateway.persistence.storeDocumentUnlocked({ document: {} as any, documentName: 'project:p1' } as any, 'maintenance');   // 探测=走 PG
      expect(ok).toBe(true);         // 帧并入 append（新家=PG）→confirm 排空=真成功路径
      expect(repo.appendBatch).toHaveBeenCalledTimes(1);   // 探测真打 PG（stash 帧回收通道）
      expect(spool.hasFrames('p1')).toBe(false);      // 补排空：帧已 confirm
      expect(gatewayFacade(gateway).pgBreakerRef().stateName()).toBe('closed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('gateway 接线推闸：repo.appendBatch 连续连接族失败 5 次→breaker open（经 catch recordFailure）', async () => {
    const { gateway, repo } = buildGateway();
    repo.appendBatch.mockRejectedValue(p1001());
    for (let i = 0; i < 5; i++) {
      gatewayFacade(gateway).seedPendingQueue('p1', [yupdate()]);
      await gateway.persistence.storeDocumentUnlocked({ document: {} as any, documentName: 'project:p1' } as any, 'maintenance');
    }
    expect(gatewayFacade(gateway).pgBreakerRef().stateName()).toBe('open');
  });

  it('★范围静态锚：breaker 闸门调用点+状态谓词恰四（auth/load 准入+store 短路+isPgBreakerOpen 谓词）——不裹 lease 心跳/不拒 WS 帧路径（T41 W3b 锚随迁终态〔§0.6 偏离 70④〕：auth 准入点 .admitQuery() 随 authenticateInner 迁 collab-session-guard.service〔W3a load 准入点已迁 collab-doc-registry.service〕——四点判据=gateway〔stateName×1〕+session-guard〔admitQuery×1〕+persistence〔isOpen×1〕+doc-registry〔admitQuery×1〕四文件求和恰 4；「恰四+不裹心跳/不拒 WS 帧」逐字保留）', () => {
    const gw = readFileSync(resolve(__dirname, 'collab.gateway.ts'), 'utf8');
    const sg = readFileSync(resolve(__dirname, 'collab-session-guard.service.ts'), 'utf8');
    const svc = readFileSync(resolve(__dirname, 'collab-persistence.service.ts'), 'utf8');
    const dr = readFileSync(resolve(__dirname, 'collab-doc-registry.service.ts'), 'utf8');
    const gateRe = () => /\.admitQuery\(\)|\.isOpen\(|\.stateName\(/g;
    expect((gw.match(gateRe()) ?? []).length + (sg.match(gateRe()) ?? []).length + (svc.match(gateRe()) ?? []).length + (dr.match(gateRe()) ?? []).length).toBe(4);
  });
});

// ===== describe D：docName 全匹配守卫（第 14 reason——别名执法分叉根修） =====
describe('Y0b-5 T16 D：docName 全匹配 ^project:[A-Za-z0-9_-]{1,64}$（invalid-doc-name 三入口统一）', () => {
  it.each([
    ['abc'],                    // 别名（裸 replace 下≡project:abc——同 pid 双 doc 实例）
    ['project:'],               // 空名
    [`project:${'a'.repeat(65)}`],   // 超长（>64）
    ['project:a$b'],            // 异常字符
    ['project:画布'],            // 非 ASCII
    ['xproject:p1'],            // 前缀外字符串（非 project: 开头）
  ])('docName=%s → onAuthenticate 拒 invalid-doc-name（零 DB）', async (name) => {
    const { gateway, prisma } = buildGateway();
    await expect(gateway.hooks.onAuthenticate(authPayload(name) as any)).rejects.toMatchObject({ reason: 'invalid-doc-name' });
    expect(prisma.session.findUnique).not.toHaveBeenCalled();
  });

  it('正常名零回归：合法 docName 走完整链成功', async () => {
    const { gateway } = buildGateway();
    const ctx = await gateway.hooks.onAuthenticate(authPayload() as any);
    expect(ctx).toMatchObject({ user: { id: 'u1' } });
  });

  it('loadDocument 同守卫：别名 docName 拒 invalid-doc-name（零 repo）', async () => {
    const { gateway, repo } = buildGateway();
    await expect(gateway.hooks.onLoadDocument({ document: new Y.Doc(), documentName: 'abc', socketId: 's1' } as any))
      .rejects.toMatchObject({ reason: 'invalid-doc-name' });
    expect(repo.hydrateWithRecovery).not.toHaveBeenCalled();
  });

  it('direct 入口（withDoc）同守卫：非法 projectId 拒 invalid-doc-name 且不 openDirectConnection', async () => {
    const { gateway } = buildGateway();
    const openSpy = vi.spyOn(gateway.server.hocuspocus, 'openDirectConnection').mockResolvedValue({} as any);
    const svc = new CollabDocumentService(gateway, createMockRepo() as any);
    await expect(svc.withDoc('a$b', () => 'x')).rejects.toMatchObject({ reason: 'invalid-doc-name' });
    expect(openSpy).not.toHaveBeenCalled();   // 守卫先于直连——零装载
  });

  it('auth_reject 计数 reason=invalid-doc-name 可见（deny 工厂单点）', async () => {
    const { gateway } = buildGateway();
    await gateway.hooks.onAuthenticate(authPayload('abc') as any).catch(() => {});
    const metric: any = register.getSingleMetric('collab_auth_reject_total');
    const hit = (await metric.get()).values.find((s: any) => s.labels.reason === 'invalid-doc-name');
    expect(hit?.value).toBeGreaterThan(0);
  });
});
