import { describe, it, expect, vi } from 'vitest';
import { GATEWAY_OPTIONS } from '@nestjs/websockets/constants';
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
    session: {
      findUnique: vi.fn().mockResolvedValue(overrides.session ?? null),
      update: vi.fn(async (args: any) => ({ ...(overrides.session ?? {}), expiresAt: args.data.expiresAt })),   // 批3-3：touch 续期写面
    },
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

  it('批3-3：鉴权读面统一走 SessionService.touch——age>updateAge(1d) 的连接顺带续期（update 被调）', async () => {
    const DAY = 24 * 3600 * 1000;
    const prisma = makePrisma({
      session: { ...validSession, createdAt: new Date(Date.now() - 2 * DAY) },   // age=2d
      project: { teamId: 't1' },
      member: { teamId: 't1', userId: 'u1' },
    });
    const gw: any = new (ExecutionGateway as any)(prisma);
    const client: any = makeClient('flowweb.session_token=tok');
    await gw.handleJoin(client, 'p1');
    expect(client.join).toHaveBeenCalledWith('project:p1');
    expect(prisma.session.update).toHaveBeenCalledTimes(1);
    const arg = prisma.session.update.mock.calls[0][0];
    expect((arg.data.expiresAt as Date).getTime()).toBeGreaterThan(Date.now() + 7 * DAY - 5_000);
  });
});

// Y0c T34（Z79/RC3）：CORS_ORIGIN 装饰器实参惰性化——@WebSocketGateway 装饰器实参在模块加载期
// 求值（dotenv→validateEnv 写回之前=Z79 违规面；vi.stubEnv 对其无效）；改 cors origin 函数回调
// 形态（cors 包原生能力——请求期求值）。CORS_ORIGIN 无 default 归一化需求，dotenv 先行下加载期
// 读与运行期读等值——惰性化收益=形态合规+测试可注入。
describe('T34：@WebSocketGateway cors.origin 惰性函数（CORS_ORIGIN 调用期读）', () => {
  it('元数据 cors.origin=函数（旧数组形态⇒红）：白名单命中⇒回显/未命中⇒false/stub 改值即改读（惰性证明）', () => {
    const meta = Reflect.getMetadata(GATEWAY_OPTIONS, ExecutionGateway) as { cors: { origin: unknown } };
    expect(typeof meta.cors.origin).toBe('function');
    const origin = meta.cors.origin as (reqOrigin: string | undefined, cb: (err: Error | null, allow?: string | boolean) => void) => void;
    const cb = vi.fn();
    vi.stubEnv('CORS_ORIGIN', 'https://a.example.com');
    try {
      origin('https://a.example.com', cb);
      expect(cb).toHaveBeenLastCalledWith(null, 'https://a.example.com');
      origin('https://evil.example.com', cb);
      expect(cb).toHaveBeenLastCalledWith(null, false);
      vi.stubEnv('CORS_ORIGIN', 'https://b.example.com');   // 惰性求值：env 第二值即改即读
      origin('https://b.example.com', cb);
      expect(cb).toHaveBeenLastCalledWith(null, 'https://b.example.com');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
