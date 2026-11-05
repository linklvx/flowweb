// apps/api/src/modules/collab/project-governance.service.ts
// C2-0（plan Task C2-0——生产就绪收尾批，spec v5 §3 C2 前置）：项目 governance 单源——创建路径
// 必经的 OpsGate 项目行+origin 谱系写点（漏接=该路径项目 compact 永久 fail-closed——C2-1 两行校验
// 缺项目行即拒；执法面=census ㊱「canvasProject.create 调用点必经 governance」）。
//
// 形态裁定（free function 非 @Injectable——模块边界实证）：ProjectService（ProjectModule）与
// CanvasService（CanvasModule）两消费方中，CollabModule→CanvasModule 单向 import 既有依赖
// （collab.module.ts CanvasModule import——Y0b-4 T9）⇒ CanvasModule 反向 import CollabModule 成环，
// DI 注入面不可达；本文件与 ensureCanvasDocHead（canvas-doc-genesis.ts）同族=跨模块 collab 助手
// free-function import 先例（两创建路径已各引 genesis——同链第二件），零 DI 接线。
//
// 事务位序：项目创建事务内、canvasProject.create 之后随行调用（governance 行与项目行/genesis
// 头集原子——fail-closed 抛错=整事务回滚无部分写入）。幂等=ON CONFLICT DO NOTHING（重复调用
// 零副作用）+origin IS DISTINCT FROM 谓词（同值重入不写——updatedAt 不被虚 bump）。
//
// 全局哨兵行（'compact',projectId=''）非本函数职责——迁移笔二回填时落（建库常驻行）；
// 三档语义/两阶段读/freeze（C2-1）与 pin/游标消费（C2-2）不在本文件。
import type { CanvasProjectOrigin } from '@flowweb/shared';

/** OpsGate gate 值域（本批唯一 gate；C2-1 compact 发布事务两行校验消费同键）。 */
export const OPS_GATE_COMPACT = 'compact' as const;

/** governance 事务客户端最小结构面（$executeRaw 语义锚——PrismaService/TransactionClient/stub
 *  三面可赋，与 project-lock.ts LockableTx 同族局部命名）。 */
export type GovernanceTx = { $executeRaw: (q: TemplateStringsArray, ...values: unknown[]) => Promise<unknown> };

/**
 * 建项目 governance（幂等可重入）：OpsGate ('compact',pid,'OPEN') 项目行 + CanvasProject.origin
 * 谱系单源写点。两创建路径共用（ProjectService.create / CanvasService.create——值域
 * CANVAS_PROJECT_ORIGINS；本批两路径均 'user'，'clone' 谱系 C4 VideoWorkCloneService 接线）。
 */
export async function ensureProjectGovernance(
  tx: GovernanceTx,
  args: { projectId: string; origin: CanvasProjectOrigin },
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "CollabOpsGate" ("gate", "projectId", "state")
    VALUES (${OPS_GATE_COMPACT}, ${args.projectId}, 'OPEN')
    ON CONFLICT DO NOTHING`;
  await tx.$executeRaw`
    UPDATE "CanvasProject" SET "origin" = ${args.origin}
    WHERE "id" = ${args.projectId} AND "origin" IS DISTINCT FROM ${args.origin}`;
}
