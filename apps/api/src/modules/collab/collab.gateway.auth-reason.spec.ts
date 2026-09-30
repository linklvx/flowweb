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
import { describe, it, expect, vi } from 'vitest';

function buildGateway() {
  const prisma = {
    session: { findUnique: vi.fn().mockResolvedValue({ user: { id: 'u1', name: '张三' }, expiresAt: new Date(Date.now() + 86400000) }) },
    canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1' }) },
    teamMember: { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER', userId: 'u1' }) },
    canvasDoc: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  const repo = { loadUpdates: vi.fn().mockResolvedValue([]) };
  const redisSync = { syncFromPeers: vi.fn(async () => {}) };
  const perm = { resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR') };
  const gateway = new CollabGateway(
    prisma as any, new EventEmitter2() as any, repo as any, redisSync as any,
    perm as any, 43000 + Math.floor(Math.random() * 20000),
  );
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
});

describe('批3-1 onLoadDocument DB 兜底（不折成裸 permission-denied）', () => {
  it('快照查询抛错 → db-unavailable', async () => {
    const { gateway, prisma } = buildGateway();
    prisma.canvasDoc.findUnique.mockRejectedValue(new Error('connection terminated'));
    await expect(gateway.hooks.onLoadDocument({ document: new Y.Doc(), documentName: 'project:p1' } as any))
      .rejects.toMatchObject({ reason: 'db-unavailable' });
  });

  it('增量行查询抛错 → db-unavailable', async () => {
    const { gateway, repo } = buildGateway();
    repo.loadUpdates.mockRejectedValue(new Error('P1001'));
    await expect(gateway.hooks.onLoadDocument({ document: new Y.Doc(), documentName: 'project:p1' } as any))
      .rejects.toMatchObject({ reason: 'db-unavailable' });
  });
});

describe('批3-1 DENY reason 真协议透传（组④）', () => {
  it('session-expired 经 writePermissionDenied 到达客户端 authenticationFailed，且服务端不关 socket', async () => {
    const { gateway, prisma } = buildGateway();
    prisma.session.findUnique.mockResolvedValue({ user: { id: 'u1', name: '张三' }, expiresAt: new Date(Date.now() - 1000) });
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
