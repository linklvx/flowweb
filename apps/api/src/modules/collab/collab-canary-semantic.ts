// apps/api/src/modules/collab/collab-canary-semantic.ts
// C2-2b P1 修复（spec 评审反例——语义兜底判据单源）：**Yjs 的 delete 操作不进 state vector**
// （SV 只编码 struct clock，delete 走 deleteSet）——丢失一条纯删除帧（f1 建节点+f2 删节点无新
// struct）时：SV 互支成立 / hash 红而 / 节点复活=语义不等——SV 互支作等价判据在此形态下漏报
// （归 hash-encoding-mismatch 只计数不 freeze）。本文件=语义摘要判据单源：捕获侧（C2-2a 捕获④
// 增算）与 verify 侧（C2-2b 兜底深比）同一函数——nodes+edges **两根** canonical JSON→SHA-256
// （评审 P3-b：旧 worker semanticViewDigest 只哈希 nodes 根——边根同为语义面必须并入）。
// 形态独立文件（非 service/worker 挂载）：两侧互引成环（worker 已 import service）——独立模块
// 零环；纯 yjs+crypto 闭包（census ⑰ 零 controller/Http 面）。
// Y4a T2（spec §0 条 7/§3.2 表 canary 行）：根清单扩 timelines（三根）+stableStringify 导出
// （T9 vacuumEquivalent 内容比较与 maintenance 记录 hash 面共消费——单源禁私有函数）。
// Y4b T8（spec §0 条 2/7）：根清单扩 threads（四根）+exportThreadsView 导出（整棵
// Object.fromEntries——maintenance hash 面加 threads 腿同批）。
import { createHash } from 'node:crypto';
import * as Y from 'yjs';

/** 值域递归稳定序列化（Y 值经 toJSON 先折 plain〔Y.Map/Y.YText 递归转换+环切断〕；键排序+
 *  undefined 过滤；lighting.service stableStringify 同族形态）。
 *  Y4a T2 导出：maintenance recordsOfHydration 记录 hash 面与 T9 vacuumEquivalent
 *  timelines 内容比较共用本函数（spec §3.2 表——单源共享，禁第二份序列化实现）。 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  const asToJSON = value as { toJSON?: () => unknown };
  if (typeof asToJSON.toJSON === 'function') return stableStringify(asToJSON.toJSON());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** nodes+edges+timelines+threads 四根 canonical JSON 视图（语义比对真值面——四根必须齐：节点复活/
 *  边丢失/时间轴丢失/线程丢失或评论漂移均为语义不等；「同逻辑状态不同 integration order」下四视图
 *  恒等〔deleteSet/tombstone 不进视图〕）。
 *  【未来根不变量（C2-2b 评审 Minor#6）】客户端新增可写根（vacuum U-2 守恒面明确预留未知未来根）
 *  时**必须**同步扩本视图根列表——否则该根数据丢失在 canary 侧降归 hash-encoding-mismatch
 *  只计数不 freeze（digest 判据对未覆盖根不敏感）。
 *  Y4a T2：+timelines（spec §0 条 7「哈希和真空等价比较包含 timelines」——时间轴进 doc 后
 *  仅 timelines 差异=语义不等）。
 *  Y4a T9：timelines 腿改消费 exportTimelineView 单源（三消费面同源——见其注）。
 *  Y4b T8（spec §0 条 2/7）：+threads 腿（threads 进 doc 后仅线程差异=语义不等——A7′ 负控：
 *  少一条评论/resolved 翻转必致摘要不等；消费 exportThreadsView 单源整棵导出）。 */
export function canonicalDocView(doc: Y.Doc): string {
  return (['nodes', 'edges'] as const)
    .map((r) => `${r}:${stableStringify(Object.fromEntries(doc.getMap(r).entries()))}`)
    .concat([`timelines:${stableStringify(exportTimelineView(doc.getMap('timelines')))}`])
    .concat([`threads:${stableStringify(exportThreadsView(doc.getMap('threads')))}`])
    .join('|');
}

/** timelines 根读回视图单源（Y4a T9——spec §0 条 7）：`Object.fromEntries(root.entries())` 的
 *  唯一出口。**三消费面同源**（禁第二份实现）：
 *  ①canary canonicalDocView timelines 腿（本文件——canary 语义摘要）；
 *  ②maintenance recordsOfHydration timelines 腿（collab-maintenance.service——EXPORTING/
 *    VERIFYING 记录 hash 面；**hash 输出逐字节不变**〔canonical pin/历史 hash 锚不可漂移——
 *    换单源前后同 doc 实测相等〕）；
 *  ③DR vacuumEquivalent timelines 内容深比（collab-doc-registry.service——真空等价断言）。
 *  出口形状=plain record（Y.Map/Y.Text 值经 stableStringify 的 toJSON 递归折叠——与换源前
 *  inline `Object.fromEntries` 形态逐字节恒等）。 */
export function exportTimelineView(root: Y.Map<unknown>): Record<string, unknown> {
  return Object.fromEntries(root.entries());
}

/** threads 根读回视图单源（Y4b T8——spec §0 条 2/7）：`Object.fromEntries(root.entries())` 整棵
 *  导出（**禁手挑字段**——resolved/评论集合全部进守恒面；exportTimelineView 同形 :55）。
 *  三消费面同源（禁第二份实现）：
 *  ①canary canonicalDocView threads 腿（本文件——canary 语义摘要）；
 *  ②maintenance recordsOfHydration threads 腿（collab-maintenance.service——EXPORTING/VERIFYING
 *    记录 hash 面加 threads 腿，Y4b T8 起 hash 摘要随本批变更）；
 *  ③DR vacuumEquivalent threads 内容深比（collab-doc-registry.service——真空等价断言第六根腿）。
 *  出口形状=plain record（嵌套 entry/comments Y.Map 值经 stableStringify 的 toJSON 递归折叠——
 *  「同逻辑状态不同 integration order」恒等）。 */
export function exportThreadsView(root: Y.Map<unknown>): Record<string, unknown> {
  return Object.fromEntries(root.entries());
}

/** 语义摘要（SHA-256 hex 64——捕获④落 pin.semanticDigest〔迁移笔三 Char(64) 列〕/verify 兜底
 *  深比判据。**不含 deleteSet**：删除帧丢失⇒重放侧节点复活⇒视图不等⇒摘要不等⇒mismatch——
 *  评审 P1 反例的正确判据面）。 */
export function semanticDocDigest(doc: Y.Doc): string {
  return createHash('sha256').update(canonicalDocView(doc)).digest('hex');
}

/** 语义相等判定（两 doc 同在手的工具面——红⑥-a 两 doc 构造直证/api 侧可消费；doc 生命周期归
 *  调用方〔本函数不 destroy〕）。 */
export function semanticEqualDocs(a: Y.Doc, b: Y.Doc): boolean {
  return canonicalDocView(a) === canonicalDocView(b);
}
