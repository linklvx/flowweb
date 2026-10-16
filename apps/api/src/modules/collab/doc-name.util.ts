// apps/api/src/modules/collab/doc-name.util.ts
// Y0c T40（B1/§0.6 偏离 67）：docName 解析纯函数族自 collab.gateway.ts 平移（逐字保留）——
// CollabPersistenceService 消费 parseDocName 的 gateway↔service 运行时循环 import 消解
// （gateway 必 import service 类〔直构自建+常量再导出〕；循环下 CollabGateway 类定义期
// design:paramtypes 求值装载序敏感=结构性风险）。gateway 侧 `export { … } from './doc-name.util'`
// 再导出保全部既有 import 面（消费方零触碰）；doc-like.util.ts/pg-error.util.ts 同址同形先例。
// B2/B3（SessionGuard/DocRegistry 域同消费本族）继承同一 util 不再迁移。

/** Y0c T4（E23/R0c-4+K11）：docName 解析换代——parseDocName 管语法 `project:<id>#g<N>`。
 *  世代段规范形（T4 二轮收紧）：禁前导零（`0|[1-9]\d{0,8}`——#g007 与 #g7 别名形态必须可分），
 *  #g0 合法是唯一例外（世代 0=无世代段语义已在测试钉死）；9 位上界=Number 精度安全域
 *  （30 位数字解析即精度丢失）。大写 #G 不匹配（只收小写规范形）。
 *  世代真源=DB 列 canvasProject.generation（Y0b-4 T9a；vacuumReplace 递增不恒 0）——本批只铺位：
 *  generationFromName 与 DB 列对比的接线归 Y1c-1（closeTeamDocuments 全世代等六处连带同批，
 *  spec E23 裁剪）。现状 docName 全量无世代段（generationFromName=undefined）。 */
const DOC_NAME_RE = /^project:([A-Za-z0-9_-]{1,64})(?:#g(0|[1-9]\d{0,8}))?$/;

export interface ParsedDocName {
  projectId: string;
  /** name 世代段值（无段=undefined——与显式 #g0 可分；世代真源=DB 列非本值，仅作对比输入） */
  generationFromName: number | undefined;
}

export function parseDocName(docName: string): ParsedDocName | null {
  const m = DOC_NAME_RE.exec(docName);
  if (!m) return null;
  return { projectId: m[1], generationFromName: m[2] === undefined ? undefined : Number(m[2]) };
}

/** Y0b-5 T16（裁定 23⑹/24⑿）全匹配守卫语义保持：现状档=无世代段才放行——裸 replace 前身下
 *  别名 docName（"abc"≡"project:abc"）解析同 pid=同一 projectId 双 doc 实例：freezeQuota/
 *  beginVacuumEra/closeTeamDocuments 均按 `project:${pid}` 寻址 ⇒ 别名实例绕过冻结通告/vacuum
 *  关闭=执法分叉。世代段（#g<N>）语法已冻结但语义 Y1c-1 才启用——现状拒放（#g 实例=同型别名
 *  分叉）；Y1c-1 启用时改本谓词放行+走 isGenerationMismatch 对比 DB 列（onAuthenticate∧
 *  onLoadDocument 双校验）。三入口统一：onAuthenticate/loadDocument/withDoc。 */
export function isValidDocName(documentName: string): boolean {
  const parsed = parseDocName(documentName);
  return parsed !== null && parsed.generationFromName === undefined;
}

/** 世代一致性拒因判定（铺位——纯函数可单测；接线归 Y1c-1 双校验点）：只在有世代段时对比
 *  （无段=现状形态不判）；name 段 ≠ DB 列=独立拒因（防 Y1c-1 第二真源）。 */
export function isGenerationMismatch(generationFromName: number | undefined, generationInDb: number): boolean {
  return generationFromName !== undefined && generationFromName !== generationInDb;
}
