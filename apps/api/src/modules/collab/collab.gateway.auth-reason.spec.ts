// apps/api/src/modules/collab/collab.gateway.auth-reason.spec.ts
// 批3-1：鉴权拒绝 reason 五档 + onLoadDocument DB 兜底（F6——库把 hook 异常折成裸
// permission-denied，客户端无法分型"该重登"vs"该重试"）。
// 形态：直构单元组（shadow-sweep spec 先例——mock prisma/repo/redisSync，不 listen）
// + 真协议 DENY 透传一例（collab.gateway.spec 先例——断言 reason 经 writePermissionDenied
// 到达客户端 authenticationFailed 且服务端不关 socket）。
import { EventEmitter2 } from '@nestjs/event-emitter';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { CollabGateway } from './collab.gateway';
import { CollabSpoolService } from './collab-spool.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createLeaseStub } from './test-utils/lease-stub';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Y0a-2：gateway 构造签名扩必填 spool——本 spec 临时目录域（beforeEach 建/afterEach 清）
let spoolDir: string;
let spoolCleanup: () => Promise<void> = async () => {};
beforeEach(async () => {
  const d = await makeSpoolDir('y0a2-auth-');
  spoolDir = d.dir;
  spoolCleanup = d.cleanup;
});
afterEach(async () => { await spoolCleanup(); });

function buildGateway() {
  const prisma = {
    session: {
      findUnique: vi.fn().mockResolvedValue({ user: { id: 'u1', name: '张三' }, expiresAt: new Date(Date.now() + 86400000) }),
      update: vi.fn(async (args: any) => ({ user: { id: 'u1', name: '张三' }, expiresAt: args.data.expiresAt })),
    },
    canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1' }) },
    teamMember: { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER', userId: 'u1' }) },
  };
  const repo = createMockRepo();
  const lease = createLeaseStub();   // Y0a-3 T5：redisSync 退役——租约 stub（isServing 恒 true=租约已持有形态）
  const perm = { resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR') };
  const spool = new CollabSpoolService(spoolDir);
  spool.setOwner('test-owner');   // R3：onModuleInit 的 scan（Z13）与写路径必先 setOwner
  const gateway = new CollabGateway(
    prisma as any, new EventEmitter2() as any, repo as any, lease as any,
    perm as any, 43000 + Math.floor(Math.random() * 20000),
    undefined, undefined, undefined, spool,
  );
  (gateway as any).collabState = 'serving';   // Y0a-3：纯态门下直构网关须显式播种放行态（生产由 onModuleInit 状态机驱动）
  return { gateway, prisma, repo };
}

function authPayload(documentName = 'project:p1') {
  return {
    requestHeaders: new Headers(),
    requestParameters: new URLSearchParams('token=tok'),
    documentName,
    connectionConfig: { readOnly: false, isAuthenticated: false },
  };
}

describe('批3-1 鉴权拒绝 reason 分型（直构）', () => {
  it('session 无 → unauthenticated', async () => {
    const { gateway, prisma } = buildGateway();
    prisma.session.findUnique.mockResolvedValue(null);
    await expect(gateway.hooks.onAuthenticate(authPayload() as any))
      .rejects.toMatchObject({ reason: 'unauthenticated' });
  });

  it('session 过期 → session-expired', async () => {
    const { gateway, prisma } = buildGateway();
    prisma.session.findUnique.mockResolvedValue({ user: { id: 'u1', name: '张三' }, expiresAt: new Date(Date.now() - 1000) });
    await expect(gateway.hooks.onAuthenticate(authPayload() as any))
      .rejects.toMatchObject({ reason: 'session-expired' });
  });

  it('项目不存在 → not-found', async () => {
    const { gateway, prisma } = buildGateway();
    prisma.canvasProject.findUnique.mockResolvedValue(null);
    await expect(gateway.hooks.onAuthenticate(authPayload() as any))
      .rejects.toMatchObject({ reason: 'not-found' });
  });

  it('非团队成员 → forbidden', async () => {
    const { gateway, prisma } = buildGateway();
    prisma.teamMember.findUnique.mockResolvedValue(null);
    await expect(gateway.hooks.onAuthenticate(authPayload() as any))
      .rejects.toMatchObject({ reason: 'forbidden' });
  });

  it('鉴权期 DB 抖动（session 查询抛错）→ db-unavailable', async () => {
    const { gateway, prisma } = buildGateway();
    prisma.session.findUnique.mockRejectedValue(new Error('connection terminated'));
    await expect(gateway.hooks.onAuthenticate(authPayload() as any))
      .rejects.toMatchObject({ reason: 'db-unavailable' });
  });

  it('鉴权链中段 DB 抖动（teamMember 抛错）→ db-unavailable（未打标异常一律瞬态桶）', async () => {
    const { gateway, prisma } = buildGateway();
    prisma.teamMember.findUnique.mockRejectedValue(new Error('P1001'));
    await expect(gateway.hooks.onAuthenticate(authPayload() as any))
      .rejects.toMatchObject({ reason: 'db-unavailable' });
  });

  it('鉴权成功路径不附 reason（正常返回上下文）', async () => {
    const { gateway } = buildGateway();
    const ctx = await gateway.hooks.onAuthenticate(authPayload() as any);
    expect(ctx).toMatchObject({ user: { id: 'u1' }, readOnly: false });
  });

  it('批3-3：鉴权走 SessionService.touch——age>updateAge(1d) 的活跃连接被续期 7d（update 被调）', async () => {
    const { gateway, prisma } = buildGateway();
    const DAY = 24 * 3600 * 1000;
    prisma.session.findUnique.mockResolvedValue({
      user: { id: 'u1', name: '张三' },
      userId: 'u1',
      createdAt: new Date(Date.now() - 2 * DAY),   // age=2d > updateAge=1d
      expiresAt: new Date(Date.now() + 5 * DAY),
    });
    const ctx = await gateway.hooks.onAuthenticate(authPayload() as any);
    expect(ctx).toMatchObject({ user: { id: 'u1' } });
    expect(prisma.session.update).toHaveBeenCalledTimes(1);
    const arg = prisma.session.update.mock.calls[0][0];
    expect(arg.where).toEqual({ token: 'tok' });
    expect((arg.data.expiresAt as Date).getTime()).toBeGreaterThan(Date.now() + 7 * DAY - 5_000);   // ≈ now+7d
    // sweep 快照死线（批3-4）：context 携带续期后的 sessionExpiresAt
    expect((ctx as any).sessionExpiresAt).toEqual(arg.data.expiresAt);
  });

  it('批3-3：age<updateAge 的连接零写（update 不被调）——不是每次握手都写库', async () => {
    const { gateway, prisma } = buildGateway();
    prisma.session.findUnique.mockResolvedValue({
      user: { id: 'u1', name: '张三' },
      userId: 'u1',
      createdAt: new Date(Date.now() - 3_600_000),   // age=1h
      expiresAt: new Date(Date.now() + 6 * 24 * 3600 * 1000),
    });
    await gateway.hooks.onAuthenticate(authPayload() as any);
    expect(prisma.session.update).not.toHaveBeenCalled();
  });
});

describe('批3-1 onLoadDocument DB 兜底（不折成裸 permission-denied）', () => {
  it('快照查询抛错 → db-unavailable', async () => {
    const { gateway, repo } = buildGateway();
    // Y0a-1：快照查询已并入 loadForHydration 单事务（注入在其上——经 hydrateWithRecovery 委托传导）
    repo.loadForHydration.mockRejectedValue(new Error('connection terminated'));
    await expect(gateway.hooks.onLoadDocument({ document: new Y.Doc(), documentName: 'project:p1' } as any))
      .rejects.toMatchObject({ reason: 'db-unavailable' });
  });

  it('增量行查询抛错 → db-unavailable', async () => {
    const { gateway, repo } = buildGateway();
    repo.hydrateWithRecovery.mockRejectedValue(new Error('P1001'));
    await expect(gateway.hooks.onLoadDocument({ document: new Y.Doc(), documentName: 'project:p1' } as any))
      .rejects.toMatchObject({ reason: 'db-unavailable' });
  });
});

describe('批3-1 DENY reason 真协议透传（组④）', () => {
  it('session-expired 经 writePermissionDenied 到达客户端 authenticationFailed，且服务端不关 socket', async () => {
    const { gateway, prisma } = buildGateway();
    prisma.session.findUnique.mockResolvedValue({ user: { id: 'u1', name: '张三' }, expiresAt: new Date(Date.now() - 1000) });
    (gateway as any).collabState = 'initializing';   // 本用例走真实 onModuleInit 启动链——复位直构播种态，让状态机完整合法驱动（listen 单点）
    await gateway.onModuleInit();
    try {
      const url = `ws://127.0.0.1:${(gateway as any).server.configuration.port}`;
      const provider = new HocuspocusProvider({ url: `${url}?token=tok`, name: 'project:p1', document: new Y.Doc() });
      const denied = new Promise<string>((resolve) => provider.on('authenticationFailed', (p: { reason: string }) => resolve(p.reason)));
      expect(await denied).toBe('session-expired');
      expect(provider.isSynced).toBe(false);
      await new Promise((r) => setTimeout(r, 400));   // DENY 后观察窗：服务端 catch 分支只 writePermissionDenied、不 close
      const ws = (provider as any).configuration.websocketProvider?.webSocket;
      expect(ws?.readyState).toBe(WebSocket.OPEN);
      provider.destroy();
    } finally {
      await (gateway as any).server.destroy();
    }
  }, 10000);
});
