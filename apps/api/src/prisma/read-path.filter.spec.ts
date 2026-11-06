// C4-a（plan Task C4-1 红⑦ 前置——生产就绪收尾批·project-erasure）：读路径过滤单点注入单测。
// 断言面：①applyReadPathFilter 后 CanvasProject 读操作（findUnique/findFirst/findMany/count/OrThrow 族）
// where 注入 lifecycleState='ACTIVE'（AND 包裹既有 where——不吞调用方谓词）；②非读操作/其他模型 delegate
// 直通；③runWithIncludeDeleted（ALS 显式开关）包裹内全量放行（admin/worker/erasure 面）；④交互式
// $transaction 回调 tx 同过滤（tx 内读径不旁路）；⑤数组形态事务元素构造期已过 delegate（读在构造期注入）。
// 运行：pnpm --filter @flowweb/api test（主池）
import { describe, it, expect } from 'vitest';
import { applyReadPathFilter, runWithIncludeDeleted } from './read-path.filter';

/** stub client：canvasProject delegate 读操作记录 args 透传；team delegate 旁证面。 */
function makeStubClient() {
  const calls: { model: string; op: string; args: unknown }[] = [];
  const delegate = (model: string) => {
    const d: Record<string, (...a: unknown[]) => Promise<unknown>> = {};
    for (const op of ['findUnique', 'findFirst', 'findMany', 'count', 'findUniqueOrThrow', 'findFirstOrThrow', 'update', 'delete']) {
      d[op] = async (...a: unknown[]) => { calls.push({ model, op, args: a[0] }); return { ok: true }; };
    }
    return d;
  };
  const raw = {
    canvasProject: delegate('canvasProject'),
    team: delegate('team'),
    $transaction: async (arg: any) => {
      if (typeof arg === 'function') return arg(raw);
      return Promise.all(arg);
    },
  };
  return { raw, calls };
}

describe('C4-a 红⑦ read-path.filter（CanvasProject 读单点注入 lifecycleState=ACTIVE）', () => {
  it('读操作 where 注入：无 where/既有 where 均 AND 包裹（不吞调用方谓词）', async () => {
    const { raw, calls } = makeStubClient();
    const client = applyReadPathFilter(raw);
    await client.canvasProject.findMany({ where: { teamId: 't1' } });
    await client.canvasProject.findUnique({ where: { id: 'p1' } });
    await client.canvasProject.findFirst(undefined as never);
    await client.canvasProject.count({});
    await client.canvasProject.findUniqueOrThrow({ where: { id: 'p2' } });
    await client.canvasProject.findFirstOrThrow({ where: { userId: 'u1' } });
    const expected = { AND: [{ teamId: 't1' }, { lifecycleState: 'ACTIVE' }] };
    expect((calls[0].args as { where: unknown }).where).toEqual(expected);
    // findUnique 族=extendedWhereUnique 形态（唯一键顶层+非唯一过滤并列——AND 包裹唯一键不被识别）
    expect((calls[1].args as { where: unknown }).where).toEqual({ id: 'p1', lifecycleState: 'ACTIVE' });
    expect((calls[2].args as { where: unknown }).where).toEqual({ AND: [{}, { lifecycleState: 'ACTIVE' }] });   // args 缺省档
    expect((calls[3].args as { where: unknown }).where).toEqual({ AND: [{}, { lifecycleState: 'ACTIVE' }] });
    expect((calls[4].args as { where: unknown }).where).toEqual({ id: 'p2', lifecycleState: 'ACTIVE' });
    expect((calls[5].args as { where: unknown }).where).toEqual({ AND: [{ userId: 'u1' }, { lifecycleState: 'ACTIVE' }] });
  });

  it('非读操作与其他模型 delegate 直通（写径不走本过滤——fence 域=锁序单源）', async () => {
    const { raw, calls } = makeStubClient();
    const client = applyReadPathFilter(raw);
    await client.canvasProject.update({ where: { id: 'p1' }, data: { name: 'x' } });
    await client.team.findMany({ where: { ownerId: 'u1' } });
    expect((calls[0].args as { where: unknown }).where).toEqual({ id: 'p1' });
    expect((calls[1].args as { where: unknown }).where).toEqual({ ownerId: 'u1' });   // team 读不注入（lifecycleState 列不存在）
  });

  it('runWithIncludeDeleted（ALS 显式开关）包裹内全量放行；作用域外恢复过滤（作用域边界=泄漏防护）', async () => {
    const { raw, calls } = makeStubClient();
    const client = applyReadPathFilter(raw);
    await runWithIncludeDeleted(async () => {
      await client.canvasProject.findMany({ where: { teamId: 't1' } });
    });
    expect((calls[0].args as { where: unknown }).where).toEqual({ teamId: 't1' });   // 开关=全量（admin 面看 DELETING/FAILED）
    await client.canvasProject.findMany({ where: { teamId: 't1' } });
    expect((calls[1].args as { where: unknown }).where).toEqual({ AND: [{ teamId: 't1' }, { lifecycleState: 'ACTIVE' }] });
  });

  it('交互式 $transaction 回调 tx 同过滤（tx 读径不旁路）；数组形态元素构造期已注入', async () => {
    const { raw, calls } = makeStubClient();
    const client = applyReadPathFilter(raw);
    await client.$transaction(async (tx: { canvasProject: { findMany: (a: unknown) => Promise<unknown> } }) => {
      await tx.canvasProject.findMany({ where: { teamId: 't1' } });
    });
    expect((calls[0].args as { where: unknown }).where).toEqual({ AND: [{ teamId: 't1' }, { lifecycleState: 'ACTIVE' }] });
    await client.$transaction([
      client.canvasProject.findMany({ where: { teamId: 't2' } }) as never,
    ]);
    expect((calls[1].args as { where: unknown }).where).toEqual({ AND: [{ teamId: 't2' }, { lifecycleState: 'ACTIVE' }] });
  });
});
