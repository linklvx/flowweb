// apps/api/src/modules/collab/collab-canary-semantic.ts
// C2-2b P1 修复（spec 评审反例——语义兜底判据单源）：**Yjs 的 delete 操作不进 state vector**
// （SV 只编码 struct clock，delete 走 deleteSet）——丢失一条纯删除帧（f1 建节点+f2 删节点无新
// struct）时：SV 互支成立 / hash 红而 / 节点复活=语义不等——SV 互支作等价判据在此形态下漏报
// （归 hash-encoding-mismatch 只计数不 freeze）。本文件=语义摘要判据单源：捕获侧（C2-2a 捕获④
// 增算）与 verify 侧（C2-2b 兜底深比）同一函数——nodes+edges **两根** canonical JSON→SHA-256
// （评审 P3-b：旧 worker semanticViewDigest 只哈希 nodes 根——边根同为语义面必须并入）。
// 形态独立文件（非 service/worker 挂载）：两侧互引成环（worker 已 import service）——独立模块
// 零环；纯 yjs+crypto 闭包（census ⑰ 零 controller/Http 面）。
import { createHash } from 'node:crypto';
import * as Y from 'yjs';

/** 值域递归稳定序列化（Y 值经 toJSON 先折 plain〔Y.Map/Y.YText 递归转换+环切断〕；键排序+
 *  undefined 过滤；lighting.service stableStringify 同族形态）。 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  const asToJSON = value as { toJSON?: () => unknown };
  if (typeof asToJSON.toJSON === 'function') return stableStringify(asToJSON.toJSON());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** nodes+edges 两根 canonical JSON 视图（语义比对真值面——两根必须齐：节点复活/边丢失均为语义
 *  不等；「同逻辑状态不同 integration order」下两视图恒等〔deleteSet/tombstone 不进视图〕）。
 *  【未来根不变量（C2-2b 评审 Minor#6）】客户端新增可写根（vacuum U-2 守恒面明确预留未知未来根）
 *  时**必须**同步扩本视图两根列表——否则该根数据丢失在 canary 侧降归 hash-encoding-mismatch
 *  只计数不 freeze（digest 判据对未覆盖根不敏感）。 */
export function canonicalDocView(doc: Y.Doc): string {
  return (['nodes', 'edges'] as const)
    .map((r) => `${r}:${stableStringify(Object.fromEntries(doc.getMap(r).entries()))}`)
    .join('|');
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
