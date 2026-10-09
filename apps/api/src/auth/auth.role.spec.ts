import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { auth } from './auth';
import { deleteTeamsWithPass } from '../test-utils/intent-fixture';

const prisma = new PrismaClient();

/** 清理：先删个人团队再删用户（关系无级联的方向需显式）；
 *  Y0b-2（触发器）：team.delete 级联删 TeamBalance 须带通行证（经 deleteTeamsWithPass——Z116） */
async function cleanup(email: string) {
  const u = await prisma.user.findUnique({ where: { email } });
  if (u) {
    await deleteTeamsWithPass(prisma as any, (await prisma.team.findMany({ where: { ownerId: u.id }, select: { id: true } })).map((t) => t.id));
    await prisma.user.delete({ where: { id: u.id } });
  }
}

afterAll(async () => { await prisma.$disconnect(); });

describe('role 防提权回归（P0-1，双路径）', () => {
  it('sign-up body 带 role=ADMIN → 落库仍 USER（input:false+defaultValue 静默覆盖）', async () => {
    const email = `priv1-${Date.now()}@test.flowweb.local`;
    await auth.api.signUpEmail({
      body: { email, password: 'password123', name: 'p1', role: 'ADMIN' } as any,
    });
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user?.role).toBe('USER');
    await cleanup(email);
  });

  it('updateUser（PATCH /me 路径）带 role → 报错且不落库', async () => {
    const email = `priv2-${Date.now()}@test.flowweb.local`;
    await auth.api.signUpEmail({ body: { email, password: 'password123', name: 'p2' } });
    // session cookie 值是 HMAC 签名的 token.signature，裸 token 会 UNAUTHORIZED——
    // 必须经 returnHeaders 取 better-auth 实际下发的 Set-Cookie
    const signIn = await auth.api.signInEmail({
      body: { email, password: 'password123' },
      returnHeaders: true,
    });
    const setCookie: string = signIn.headers
      .getSetCookie()
      .find((c: string) => c.startsWith('flowweb.session_token='))!;
    const headers = new Headers({ cookie: setCookie.split(';')[0] });
    await expect(
      auth.api.updateUser({ body: { name: 'x', role: 'ADMIN' } as any, headers }),
    ).rejects.toThrow(/role is not allowed/);
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user?.role).toBe('USER');
    await cleanup(email);
  });
});
