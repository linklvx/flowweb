// apps/api/src/modules/collab/project-erasure.assert.ts
// C4-c1（plan Task C4-3 ★红⑯——生产就绪收尾批·project-erasure）：擦除完成**列级机器断言**模块
// （registry 驱动——scope-column.registry PROJECT_COLUMN_MODELS+PROJECT_SCOPE_ALIASES 全表清点）。
// 断言面（C4-c1 PURGING_DB 尾步消费；C4-c2 VERIFYING stage 复用——本文件=纯读断言零写面）：
//  ① 直列模型（PROJECT_COLUMN_MODELS）：除 allowlist 外 `WHERE projectId=pid` **零行**；
//  ② 别名模型（PROJECT_SCOPE_ALIASES）：VideoWork.detach/桥表（ExecutionNodePlan/ExecutionInput 经
//     ExecutionRequest.requestId 桥、RefundObligation/ReconcileAction 经 GenerationIntent.intentRowId
//     桥——raw SQL 子查询单源）/VideoTrimTask·VideoSeparateTask.workflowId 各自谓词零行；VideoProject=
//     FK Cascade（CanvasProject 行删除级联——不直查）；**未登记谓词的新别名条目=违规红**（未来
//     registry 扩展强制断言面同步——防清点面死洞）；
//  ③ allowlist 内容列全空：GenerationIntent（resultText/gestureKey/resultRef=NULL——计费列保留不查）、
//     ExecutionRequest（计费行整行保留——零行断言豁免）、VideoWork（detach 行：canvasProjectId=pid 零行
//     ——detach 后=NULL 不再命中谓词）、Media（同左：projectId=pid 零行=detach NULL/独占已删）；
//  ④ AuditLog 擦除谓词行（targetType='PROJECT' AND targetId=pid）**保留但内容列脱敏**：beforeValue/
//     afterValue JSON 不得含被擦内容（forbiddenContent=介质键族——谓词行是操作留痕非项目内容的语义钉死）；
//     team 维同构（targetType='TEAM' AND targetId=tid——team run PURGING_TEAM 阶段消费）；
//  ⑤ CanvasProject 行本体已删（FK Cascade 载体——行在=级联面未清）。
// allowlist 语义单源：与 project-erasure.stages.ts PURGING_DB 执行体同一张处置表（stage 删/保留/scrub
// 的模型集合在此镜像——两侧漂移=断言红或清点面死洞，评审面覆盖）。
import { PROJECT_COLUMN_MODELS, PROJECT_SCOPE_ALIASES } from './scope-column.registry';

/** FK Cascade 族（CanvasProject 行删除时 DB 级联——断言经 ⑤ 行本体删除承载，不逐表计数）。 */
const FK_CASCADE_PROJECT_MODELS = new Set(['CanvasDoc', 'CanvasDocSnapshot', 'CanvasDocUpdate', 'ProjectMember']);

/** 断言 DB 结构面（PrismaService/PrismaClient 三面可赋〔调用点 as 桥——类无索引签名〕；$queryRaw=桥谓词）。 */
export interface ErasureAssertDb {
  canvasProject: { count(args: unknown): Promise<number> };
  auditLog: { findMany(args: unknown): Promise<Array<{ id: string; beforeValue: unknown; afterValue: unknown }>> };
  $queryRaw: <T = unknown>(q: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
  /** registry 模型 delegate（camelCase 键——fillWriteGateRegistry 同款键形转换）。 */
  [model: string]: unknown;
}

/** 断言结果（violations 空=ok；非空即红——调用方决定 throw/告警）。 */
export interface ErasureAssertionResult {
  ok: boolean;
  violations: string[];
}

/** 模型名→delegate 键（camelCase 首字母小写——registry 单词模型恒一跳）。 */
function delegateKey(model: string): string {
  return model[0]!.toLowerCase() + model.slice(1);
}

async function countWhere(db: ErasureAssertDb, model: string, where: unknown): Promise<number> {
  const delegate = db[delegateKey(model)] as { count(args: unknown): Promise<number> };
  return delegate.count({ where });
}

/** AuditLog 谓词行内容脱敏断言（PROJECT/TEAM 双维共用）：行保留+beforeValue/afterValue 不含被擦内容。 */
async function auditContentViolations(
  db: ErasureAssertDb, targetType: 'PROJECT' | 'TEAM', targetId: string, forbidden: readonly string[],
): Promise<string[]> {
  const violations: string[] = [];
  const rows = await db.auditLog.findMany({
    where: { targetType, targetId },
    select: { id: true, beforeValue: true, afterValue: true },
  });
  for (const row of rows) {
    const blob = JSON.stringify({ b: row.beforeValue, a: row.afterValue });
    for (const needle of forbidden) {
      if (needle.length > 0 && blob.includes(needle)) {
        violations.push(`AuditLog(${targetType}/${targetId}) 行 ${row.id} 内容列含被擦内容「${needle.slice(0, 48)}」（谓词行=操作留痕非项目内容——脱敏语义违例）`);
        break;   // 每行首个命中即报（逐行定性非逐键枚举）
      }
    }
  }
  return violations;
}

/** 桥表零行断言（ExecutionNodePlan/ExecutionInput 经 requestId 桥、RefundObligation/ReconcileAction 经
 *  intentRowId 桥——Prisma where 子查询不可表达，raw SQL 单源）。 */
async function bridgeViolations(db: ErasureAssertDb, pid: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ model: string; n: bigint }[]>`
    SELECT 'ExecutionNodePlan' AS model, count(*)::bigint AS n FROM "ExecutionNodePlan" WHERE "requestId" IN (SELECT id FROM "ExecutionRequest" WHERE "projectId" = ${pid}::text)
    UNION ALL SELECT 'ExecutionInput', count(*) FROM "ExecutionInput" WHERE "requestId" IN (SELECT id FROM "ExecutionRequest" WHERE "projectId" = ${pid}::text)
    UNION ALL SELECT 'RefundObligation', count(*) FROM "RefundObligation" WHERE "intentRowId" IN (SELECT id FROM "GenerationIntent" WHERE "projectId" = ${pid}::text)
    UNION ALL SELECT 'ReconcileAction', count(*) FROM "ReconcileAction" WHERE "intentRowId" IN (SELECT id FROM "GenerationIntent" WHERE "projectId" = ${pid}::text)`;
  return rows.filter((r) => r.n > 0n).map((r) => `${r.model} 桥残留（projectId=${pid} 经 requestId/intentRowId 桥）${r.n} 行`);
}
/**
 * 项目擦除 DB 完成态机器断言（★红⑯——registry 驱动全表清点）。纯读零写；forbiddenContent=介质键族
 * （Media.key/thumbnailKey/objectKey+VideoWork.videoKey/coverKey——调用方从并集 manifest 派生）。
 */
export async function assertProjectErasureDbComplete(
  db: ErasureAssertDb, pid: string, opts: { forbiddenContent?: readonly string[] } = {},
): Promise<ErasureAssertionResult> {
  const violations: string[] = [];
  // ① 直列模型（registry 闭包——新增模型自动进断言面：default 档=零行断言）
  for (const model of PROJECT_COLUMN_MODELS) {
    if (FK_CASCADE_PROJECT_MODELS.has(model)) continue;   // FK Cascade（⑤承载）
    if (model === 'Media') {
      const n = await countWhere(db, 'Media', { projectId: pid });
      if (n > 0) violations.push(`Media projectId=${pid} 残留 ${n} 行（detach 行应 projectId=NULL/独占行应已删）`);
      continue;
    }
    if (model === 'CollabOpsGate') {
      const n = await countWhere(db, 'CollabOpsGate', { projectId: pid });
      if (n > 0) violations.push(`CollabOpsGate projectId=${pid} 残留 ${n} 行（全局哨兵行 projectId='' 不受影响）`);
      continue;
    }
    if (model === 'GenerationIntent') {
      // allowlist 内容列断言：scrub 后三内容列全空（计费列保留不查）
      const n = await countWhere(db, 'GenerationIntent', {
        projectId: pid, OR: [{ resultText: { not: null } }, { gestureKey: { not: null } }, { resultRef: { not: null } }],
      });
      if (n > 0) violations.push(`GenerationIntent projectId=${pid} 内容列未 scrub ${n} 行（resultText/gestureKey/resultRef 应全 NULL——计费列保留）`);
      continue;
    }
    if (model === 'ExecutionRequest') continue;   // allowlist 计费行整行保留（spec C4：不删行不 scrub 计费列）
    const n = await countWhere(db, model, { projectId: pid });
    if (n > 0) violations.push(`${model} projectId=${pid} 残留 ${n} 行`);
  }
  // ② 别名模型（alias 条目驱动）
  for (const alias of PROJECT_SCOPE_ALIASES) {
    const key = `${alias.model}.${alias.column}`;
    if (alias.model === 'VideoProject') continue;   // FK Cascade（⑤承载——workflowId 级联随行删）
    if (alias.model === 'VideoWork' && alias.column === 'canvasProjectId') {
      const n = await countWhere(db, 'VideoWork', { canvasProjectId: pid });
      if (n > 0) violations.push(`VideoWork canvasProjectId=${pid} 残留 ${n} 行（detach 后应 NULL）`);
      continue;
    }
    if ((alias.model === 'VideoTrimTask' || alias.model === 'VideoSeparateTask') && alias.column === 'workflowId') {
      const n = await countWhere(db, alias.model, { workflowId: pid });
      if (n > 0) violations.push(`${key}=${pid} 残留 ${n} 行`);
      continue;
    }
    if ((alias.model === 'ExecutionNodePlan' || alias.model === 'ExecutionInput') && alias.column === 'requestId') continue;   // 桥（下方 raw 单源）
    if ((alias.model === 'RefundObligation' || alias.model === 'ReconcileAction') && alias.column === 'intentRowId') continue; // 同上
    if (alias.model === 'AuditLog' && alias.column === 'targetId') continue;   // 谓词行保留（④内容断言）
    violations.push(`别名 ${key} 无断言谓词（registry 扩展须同步断言面——防清点面死洞）`);
  }
  violations.push(...await bridgeViolations(db, pid));
  // ⑤ CanvasProject 行本体（FK Cascade 载体+读过滤真源）
  const projectRows = await db.canvasProject.count({ where: { id: pid } });
  if (projectRows > 0) violations.push(`CanvasProject id=${pid} 行残留 ${projectRows} 行（PURGING_DB 应已删——FK Cascade 载体）`);
  // ④ AuditLog 谓词行内容脱敏（行保留——forbidden 命中即红）
  violations.push(...await auditContentViolations(db, 'PROJECT', pid, opts.forbiddenContent ?? []));
  return { ok: violations.length === 0, violations };
}

/** team 维 AuditLog 谓词行内容断言（targetType='TEAM' AND targetId=tid——team run PURGING_TEAM 阶段消费）。 */
export async function assertTeamErasureAuditContent(
  db: ErasureAssertDb, tid: string, forbidden: readonly string[],
): Promise<ErasureAssertionResult> {
  const violations = await auditContentViolations(db, 'TEAM', tid, forbidden);
  return { ok: violations.length === 0, violations };
}
