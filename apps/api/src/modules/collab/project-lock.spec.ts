// apps/api/src/modules/collab/project-lock.spec.ts
// C1-0 ★红⓪（plan Task C1-0——生产就绪收尾批）：写锁门禁——registry 驱动·测试态 AsyncLocalStorage 断言。
// 双分支（R15 锁模型机器化禁人记）：
//   a) 未取锁分支：guarded 模型 $transaction 写路径（测试态）即抛 WriteLockRequiredError
//      （fail-closed——门禁断言面=非 DELETE 写操作；事务外直写面同判）；
//   b) 已取锁分支：事务内 lockProject 首语句先行 → 同事务写放行；事务结束 ALS 标记不残留到外层链
//      （锁/fence 上下文泄漏防护）→ 再写即抛；DELETE 恒放行（fence 层规则——delete/deleteMany 不在门禁断言面）。
// 面与边界：本文件=门禁机制本体（writeGateProxy 包裹的 stub client——真 PG 打点归 int/C4 面）；
//  registry 初始为空（登记面=C4-2 census 接线）——测试内注册 guarded 模型证双分支后 restore。
// fenceProject/fenceTeam 三态行为测试归 C4 红⑨（本任务不铺）。
import { describe, it, expect, vi, type Mock } from 'vitest';
import {
  writeGateActive, writeGateProxy, registerGuardedWriteModels, lockProject,
  WriteLockRequiredError,
} from './project-lock';

/** stub Prisma 面：guarded 模型 delegate（create/delete）+$transaction 直跑回调（tx=client 自身——
 *  真库的事务回调语义同构：cb 在调用链内同步开跑）+raw 两法。真 PG 面归 int/C4。 */
interface StubClient {
  fakeWidget: { create: Mock; delete: Mock };
  $executeRaw: Mock;
  $queryRaw: Mock;
  $transaction: Mock;
}
function buildStubClient(): StubClient {
  const client = {
    fakeWidget: {
      create: vi.fn(async () => ({ id: 'w1' })),
      delete: vi.fn(async () => ({ id: 'w1' })),
    },
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (fn: (tx: StubClient) => Promise<unknown>) => fn(client)),
  };
  return client as StubClient;
}

describe('C1-0 ★红⓪ 写锁门禁（registry 驱动——测试态 AsyncLocalStorage 断言）', () => {
  it('门禁激活判据：vitest 进程内 writeGateActive()===true（测试态生效单源；生产态直通零开销）', () => {
    expect(writeGateActive()).toBe(true);
  });

  it('a) 未取锁分支：guarded 模型 $transaction 写路径即抛（fail-closed）；事务外直写同判；底层 delegate 零触达', async () => {
    const restore = registerGuardedWriteModels(['fakeWidget']);
    try {
      const client = buildStubClient();
      const gated = writeGateProxy(client);
      await expect(
        gated.$transaction(async (tx: StubClient) => { await tx.fakeWidget.create({ data: {} }); }),
      ).rejects.toBeInstanceOf(WriteLockRequiredError);
      // 事务外直写：无 ALS store（未过门禁事务包裹器）——同判 fail-closed
      await expect(
        gated.fakeWidget.create({ data: {} }),
      ).rejects.toBeInstanceOf(WriteLockRequiredError);
      expect(client.fakeWidget.create).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('b) 已取锁分支：lockProject 事务内先行 → 写放行+DELETE 恒放行；事务后标记不残留（泄漏防护）', async () => {
    const restore = registerGuardedWriteModels(['fakeWidget']);
    try {
      const client = buildStubClient();
      const gated = writeGateProxy(client);
      await gated.$transaction(async (tx: StubClient) => {
        await lockProject(tx, 'p1');
        await tx.fakeWidget.create({ data: {} });
        await tx.fakeWidget.delete({ where: { id: 'w1' } });   // DELETE 恒放行（无锁亦过——fence 层规则）
      });
      expect(client.$executeRaw).toHaveBeenCalledTimes(1);       // advisory 锁语句真发（stub 面锁定调用形状）
      expect(client.fakeWidget.create).toHaveBeenCalledTimes(1);
      expect(client.fakeWidget.delete).toHaveBeenCalledTimes(1);
      // 事务结束 run() 作用域退出——锁标记不残留到外层链：再开事务写即抛（锁/fence 上下文泄漏防护）
      await expect(
        gated.$transaction(async (tx: StubClient) => { await tx.fakeWidget.create({ data: {} }); }),
      ).rejects.toBeInstanceOf(WriteLockRequiredError);
    } finally {
      restore();
    }
  });
});