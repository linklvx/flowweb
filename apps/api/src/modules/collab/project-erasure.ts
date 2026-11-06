// apps/api/src/modules/collab/project-erasure.ts
// C4-a（plan Task C4-1——生产就绪收尾批·project-erasure）：tombstone-only 四入口共用 run 面。
// **tombstone-only**：请求事务只置状态（CanvasProject.lifecycleState='DELETING'/Team.status=
// 'DISBANDING'）+插 ProjectErasureRun 行（O(1)；team=O(N) 批置归 worker 分批）——物理删除全归
// worker saga（C4-c）。free function 形态（ensureProjectGovernance 同款跨模块助手先例——四入口
// 分属 project/template/team 三模块，DI 注入面成环不可达）。
//
// 状态机值域（schema ProjectErasureRun 头注单源）：PENDING|RUNNING|DRAINING|WAITING_CHILDREN|
// PURGING_DB|PURGING_OBJECTS|PURGING_CACHE|VERIFYING|DONE|FAILED——active 态=partial unique
// project_erasure_active_uq 域（迁移笔四起 dryRun 不占真实唯一——dry-run 后真实擦合法）。
// 请求面本文件只消费 PENDING 置入+幂等回读；worker 面归 project-erasure.poller.ts（claim+分批+
// 会合判定骨架——C4-c 扩完整 saga 态机）。
import type { Prisma, ProjectErasureRun } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';

/** active 态词表（与迁移笔 partial unique 谓词同源——dryRun 行不占〔迁移笔四〕）。 */
export const ERASURE_ACTIVE_STATES = [
  'PENDING', 'RUNNING', 'DRAINING', 'WAITING_CHILDREN',
  'PURGING_DB', 'PURGING_OBJECTS', 'PURGING_CACHE', 'VERIFYING',
] as const;

/** run 视图（HTTP 202 响应面——四入口统一形状）。 */
export interface ErasureRunView {
  erasureId: string;
  scopeType: string;
  scopeId: string;
  state: string;
  dryRun: boolean;
}

/** 事务客户端最小结构面（run 行读/写+FenceTx——PrismaService/TransactionClient/stub 三面可赋；
 *  delegate 参数用 Prisma 生成类型=与真 delegate 精确协变/逆变匹配）。 */
export type ErasureTx = {
  $queryRaw: <T = unknown>(q: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
  projectErasureRun: {
    findFirst: (args: Prisma.ProjectErasureRunFindFirstArgs) => Promise<ProjectErasureRun | null>;
    create: (args: Prisma.ProjectErasureRunCreateArgs) => Promise<ProjectErasureRun>;
  };
};

/** openProjectErasure 消费面（ErasureTx+tombstone 写）。 */
export type ErasureWriteTx = ErasureTx & {
  canvasProject: { update: (args: Prisma.CanvasProjectUpdateArgs) => Promise<unknown> };
};

export function toRunView(run: ProjectErasureRun): ErasureRunView {
  return { erasureId: run.erasureId, scopeType: run.scopeType, scopeId: run.scopeId, state: run.state, dryRun: run.dryRun };
}

/** scope 现存活跃 run（非 dryRun）——幂等判据：重复删除/解散请求返回既有 run（202）而非二行
 *  （dryRun 行不占真实唯一不参与幂等——dry-run 后真实删=新 run）。 */
export async function findActiveErasureRun(
  tx: ErasureTx, scopeType: 'project' | 'team', scopeId: string,
): Promise<ProjectErasureRun | null> {
  return tx.projectErasureRun.findFirst({
    where: {
      scopeType, scopeId, dryRun: false,
      state: { in: [...ERASURE_ACTIVE_STATES] },
    },
    orderBy: { requestedAt: 'desc' },
  });
}

/** run 行置入（请求事务尾——状态恒 PENDING；worker claim 后推进）。 */
export async function createErasureRun(
  tx: ErasureTx,
  args: { scopeType: 'project' | 'team'; scopeId: string; requestedBy: string; dryRun?: boolean; parentRunId?: string; teamId?: string },
): Promise<ProjectErasureRun> {
  return tx.projectErasureRun.create({
    data: {
      scopeType: args.scopeType,
      scopeId: args.scopeId,
      requestedBy: args.requestedBy,
      dryRun: args.dryRun ?? false,
      parentRunId: args.parentRunId ?? null,
      teamId: args.teamId ?? null,
      state: 'PENDING',
    },
  });
}

/**
 * 项目擦除入口事务体（project.delete/template.delete 两入口共用；cleanDrafts 批内逐项目同谓词）：
 * ①FOR SHARE 行锁读 lifecycleState（擦除置位与并发写事务的序列化点——锁序③位）；
 * ②幂等：DELETING∧活跃 run 存在 ⇒ 返回该 run（重复删除请求 202 同 run）；DELETING∧无活跃 run
 *   （前 run FAILED/DONE——DONE 后再删=restore 形态）⇒ 跳过置位新开 run（partial unique 允许）；
 * ③资金门（gate 回调——fence 后置位前，不过回滚 409）；
 * ④置 lifecycleState='DELETING'（dryRun 跳过——项目不隐藏）+插 run 行（PENDING）。
 * 行缺失 ⇒ 404（FK 守卫域前置——老实现 P2025 裸 500 收口）。advisory lockProject=调用方事务
 * **首语句**先行（锁序①位——本函数禁自取 advisory）。
 */
export async function openProjectErasure<Tx extends ErasureWriteTx>(
  tx: Tx,
  args: {
    projectId: string;
    requestedBy: string;
    dryRun?: boolean;
    /** 资金门回调（in-tx 持锁检查——TeamFundsGateService.assertSettled 传入侧包装；Tx 泛型=
     *  gate 收到的即事务客户端本身〔assertSettled tx 参数面直用〕）。
     *  缺省=调用方已批量过门（cleanDrafts 批级门先行——逐项目不重复过）。 */
    gate?: (tx: Tx) => Promise<void>;
  },
): Promise<ErasureRunView> {
  const rows = await tx.$queryRaw<{ lifecycleState: string | null }[]>`
    SELECT "lifecycleState" FROM "CanvasProject" WHERE "id" = ${args.projectId}::text FOR SHARE`;
  if (rows.length === 0) throw new NotFoundException('Project not found');
  const existing = await findActiveErasureRun(tx, 'project', args.projectId);
  if (existing) return toRunView(existing);   // 幂等：重复删除请求→返回活跃 run（202 同 run）
  if (args.gate) await args.gate(tx);         // 资金门（不过上抛=整事务回滚）
  if (rows[0].lifecycleState !== 'DELETING' && !args.dryRun) {
    await tx.canvasProject.update({
      where: { id: args.projectId },
      data: { lifecycleState: 'DELETING' },
    });
  }
  return toRunView(await createErasureRun(tx, {
    scopeType: 'project', scopeId: args.projectId, requestedBy: args.requestedBy, dryRun: args.dryRun,
  }));
}
