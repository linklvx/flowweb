import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

// S0.1（2026-10-20）：MediaFactOutbox 唯一键 factType 入键——真 PG 实证（约束语义在 DB 层，勿 mock）。
// 背景：旧 @@unique([mediaId,projectId,factVersion]) 下同 factVersion 的 natural/state 两类事实互撞
// （T7 probe done/T16 processing fact 写入点必炸）；新键 [mediaId,projectId,factType,factVersion] 后
// 两类并存、同类（同四元组）仍唯一互斥。
// 无 DATABASE_URL（CI 未起库）自动 skip；vitest 不自动加载 apps/api/.env——靠 shell export 注入
const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();
// 本地真库可能有开发数据——全部测试行收拢到专属 projectId 前缀，清理只删该前缀
const PID = 'int-outbox-051';

(hasDb ? describe : describe.skip)('MediaFactOutbox factType 唯一键（int）', () => {
  afterAll(async () => {
    await prisma.mediaFactOutbox.deleteMany({ where: { projectId: { startsWith: 'int-outbox-' } } });
    await prisma.$disconnect();
  });

  it('同 media/project/factVersion：factType natural 与 state 两行共存成功（旧三列唯一键下必炸——T7/T16 前置）', async () => {
    const mediaId = `m-s051-a-${Date.now()}`;
    const factVersion = 1n;
    await prisma.mediaFactOutbox.create({
      data: { mediaId, projectId: PID, factType: 'natural', factVersion, payload: { natural: 'k1' } },
    });
    await prisma.mediaFactOutbox.create({
      data: { mediaId, projectId: PID, factType: 'state', factVersion, payload: { state: 'processing' } },
    });
    const rows = await prisma.mediaFactOutbox.findMany({ where: { mediaId, projectId: PID, factVersion } });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.factType))).toEqual(new Set(['natural', 'state']));
  });

  it('同 media/project/factVersion/factType：第二行唯一冲突 P2002（同类事实四元组仍互斥——幂等重插不双行）', async () => {
    const mediaId = `m-s051-b-${Date.now()}`;
    const data = { mediaId, projectId: PID, factType: 'state', factVersion: 2n, payload: { state: 'processing' } };
    await prisma.mediaFactOutbox.create({ data });
    // 裸 create 直捕原始 P2002（绕过 service 层——本卡消费代码尚不存在）
    let code: string | undefined;
    try {
      await prisma.mediaFactOutbox.create({ data });
      expect.unreachable('应撞 factType 四元组唯一键');
    } catch (e) {
      code = (e as { code?: string }).code;
    }
    expect(code).toBe('P2002');
  });
});
