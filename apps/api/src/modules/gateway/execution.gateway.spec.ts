import { describe, it, expect, vi } from 'vitest';
import { ExecutionGateway } from './execution.gateway';

/** 批0c-5 必红：handleJoin 今天无鉴权直接 join（任何人可订阅任意项目执行事件）。
 *  装置：gateway 直构注入 mock PrismaService；client 只提供 join/emit/handshake.headers.cookie。
 *  鉴权链镜像 collab.gateway.authenticate：session 直查（含 user）→ expiresAt 校验 →
 *  canvasProject 取 teamId → teamMember 成员校验。 */
function makePrisma(overrides: {
  session?: object | null;
  project?: object | null;
  member?: object | null;
} = {}) {
  return {
    session: { findUnique: vi.fn().mockResolvedValue(overrides.session ?? null) },
    canvasProject: { findUnique: vi.fn().mockResolvedValue(overrides.project ?? null) },
    teamMember: { findUnique: vi.fn().mockResolvedValue(overrides.member ?? null) },
  };
}

function makeClient(cookie?: string) {
  return {
    join: vi.fn(),
    emit: vi.fn(),
    handshake: { headers: cookie ? { cookie } : {} },
  };
}

const validSession = { token: 'tok', expiresAt: new Date(Date.now() + 86400_000), user: { id: 'u1' } };

describe('批0c-5 execution.gateway handleJoin 鉴权', () => {
  it('无有效 session → 拒绝 join', async () => {
    const prisma = makePrisma({ session: null });
    const gw: any = new (ExecutionGateway as any)(prisma);
    const client: any = makeClient('flowweb.session_token=bad');
    await gw.handleJoin(client, 'p1');
    expect(client.join).not.toHaveBeenCalled();
  });

  it('session 过期（expiresAt 过去）→ 拒绝 join', async () => {
    const expired = { ...validSession, expiresAt: new Date(Date.now() - 1000) };
    const prisma = makePrisma({ session: expired });
    const gw: any = new (ExecutionGateway as any)(prisma);
    const client: any = makeClient('flowweb.session_token=stale');
    await gw.handleJoin(client, 'p1');
    expect(client.join).not.toHaveBeenCalled();
  });

  it('合法 session + 团队成员 → join 被调（room project:p1）', async () => {
    const prisma = makePrisma({
      session: validSession,
      project: { teamId: 't1' },
      member: { teamId: 't1', userId: 'u1' },
    });
    const gw: any = new (ExecutionGateway as any)(prisma);
    const client: any = makeClient('flowweb.session_token=tok');
    await gw.handleJoin(client, 'p1');
    expect(client.join).toHaveBeenCalledWith('project:p1');
  });

  it('合法 session 但非团队成员 → 拒绝 join', async () => {
    const prisma = makePrisma({
      session: validSession,
      project: { teamId: 't1' },
      member: null,
    });
    const gw: any = new (ExecutionGateway as any)(prisma);
    const client: any = makeClient('flowweb.session_token=tok');
    await gw.handleJoin(client, 'p1');
    expect(client.join).not.toHaveBeenCalled();
  });

  it('无 cookie → 拒绝 join（不查库）', async () => {
    const prisma = makePrisma({ session: validSession });
    const gw: any = new (ExecutionGateway as any)(prisma);
    const client: any = makeClient();
    await gw.handleJoin(client, 'p1');
    expect(client.join).not.toHaveBeenCalled();
    expect(prisma.session.findUnique).not.toHaveBeenCalled();
  });
});
