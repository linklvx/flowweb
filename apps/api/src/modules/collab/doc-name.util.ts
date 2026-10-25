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
 *  世代真源=CanvasDoc.generation PG 列（Y1c T7 起——Y0b-4 T9a 时代注释所指 canvasProject 列随
 *  载体族迁移作废）；Y1c T12（偏离 27/D2/E23）：#g 段**激活**为世代身份载体——vacuum=generation++
 *  →新 docName(#g)，陈旧世代名 auth/load 双拒（S2 复活链关闭）。 */
const DOC_NAME_RE = /^project:([A-Za-z0-9_-]{1,64})(?:#g(0|[1-9]\d{0,8}))?$/;

export interface ParsedDocName {
  projectId: string;
  /** name 世代段值（无段=undefined——与显式 #g0 可分；世代真源=DB 列非本值，仅作对比输入） */
  generationFromName: number | undefined;
}

/** Y1c T9：`project:${pid}` docName 构造单源（㉚ 裸构造门——新增裸模板字面量即红，统一走此）。
 *  **内部寻址专用**（metrics docName 标签/重试键——pid 维度单源）；wire 名（库 documents Map 键）
 *  一律经 canvasDocName（世代 canonical 形）——两者混用=别名双实例执法分叉（E23）。 */
export function projectDocName(projectId: string): string {
  return `project:${projectId}`;
}

/** Y1c T12：世代 canonical wire 名（库 documents Map 键+客户端连接名单源）——gen0=裸名（存量
 *  零破坏+#g0 别名拒）；gen>0=`#g<N>`（vacuum 换代后唯一合法名——「同 name 换代」v1.3 语义死，
 *  偏离 27）。跨代互异=换代通道的 name 面（缓存键五元 generation 维为客户端对应面）。 */
export function canvasDocName(projectId: string, generation: number): string {
  return generation > 0 ? `${projectDocName(projectId)}#g${generation}` : projectDocName(projectId);
}

export function parseDocName(docName: string): ParsedDocName | null {
  const m = DOC_NAME_RE.exec(docName);
  if (!m) return null;
  return { projectId: m[1], generationFromName: m[2] === undefined ? undefined : Number(m[2]) };
}

/** Y0b-5 T16（裁定 23⑹/24⑿）全匹配守卫：裸 `project:` 前缀别名（"abc"≡"project:abc"）拒——别名
 *  docName 解析同 pid=同一 projectId 双 doc 实例：freezeQuota/beginVacuumEra/closeTeamDocuments
 *  均按 canonical 名寻址 ⇒ 别名实例绕过冻结通告/vacuum 关闭=执法分叉。
 *  Y1c T12 激活：#g 规范段**语法放行**（世代身份载体——偏离 27）；世代真值匹配（≠DB 列=拒）归
 *  admitDocNameForGeneration（auth/load 双校验单源，非语法层）；#g007/#G7/超 9 位照拒（parse null）。 */
export function isValidDocName(documentName: string): boolean {
  return parseDocName(documentName) !== null;
}

/** 世代一致性拒因判定（铺位纯函数——Y1c T12 接线）：只在有世代段时对比（无段=不判）；
 *  name 段 ≠ DB 列=独立拒因（防第二真源）。T12 世代执法主谓词=admitDocNameForGeneration
 *  （canonical 形判定，含裸名@gen>0 拒）——本函数保留为段级判据（语义铺位钉死，行为锁测试在档）。 */
export function isGenerationMismatch(generationFromName: number | undefined, generationInDb: number): boolean {
  return generationFromName !== undefined && generationFromName !== generationInDb;
}

/** Y1c T12：docName 世代准入（onAuthenticate∧onLoadDocument 双校验单源——E23「双校验+独立 reason」）。
 *  判据三面：①语法（parse null=拒）②canonical 形（gen0=裸名唯一合法形——#g0 显式段=别名拒；
 *  gen>0=#g<N> 唯一合法形——裸名≡g0<g_server 拒：S2 形态②〔全 clock<pre 无世代声明〕唯一可达
 *  复活面在此关闭）③段值=DB 真值（陈旧 #g 拒——形态①③出口，载荷携带目标世代供
 *  reconnect-new-generation/export-draft-then-clear 客户端链（T25）取新名）。
 *  违反拒因=CollabAuthReason.GENERATION_STALE（auth reason 第十五值——终态档：同名盲目重连
 *  无限循环，恢复=携目标世代重连）。 */
export function admitDocNameForGeneration(
  documentName: string,
  generationInDb: number,
): { ok: true } | { ok: false; generation: number } {
  const parsed = parseDocName(documentName);
  if (parsed == null) return { ok: false, generation: generationInDb };
  const canonical = generationInDb === 0 ? undefined : generationInDb;
  if (parsed.generationFromName === canonical) return { ok: true };
  return { ok: false, generation: generationInDb };
}
