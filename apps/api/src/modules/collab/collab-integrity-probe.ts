// apps/api/src/modules/collab/collab-integrity-probe.ts
// Y0c T22（Z111 周期完整性巡检——纯函数面）：PG 快照重放成 doc + SV 对拍。
// 消费面=apps/api/scripts/collab-soak.mjs integrityProbe（经 dist import——脚本侧 .mjs 无类型面，
// 与 CreditLedgerService 同惯例）；本文件=可单测的判别力载体，零 Nest 依赖零副作用。
// 语义：巡检是**观测项非门禁**（Z111——A7a 档「整行缺失不可探测」的唯一探测手段；常驻把盲区
// 从分钟级拉到小时级，故对拍「常驻 doc（内存）↔ PG 重放」SV 不一致即报告差异，不拦服务）。
import * as Y from 'yjs';
import { createCanvasDoc } from './canvas-doc.factory';

/** PG 行集全重放：快照行（CanvasDoc.state——compact 产物，可 null）+增量行（CanvasDocUpdate.update
 *  按 seq 升序）。apply 顺序=快照先行（repo readConsistent 契约同构）；CRDT 幂等——重复帧无害。 */
export function replayPgSnapshot(state: Uint8Array | Buffer | null, updates: Array<Uint8Array | Buffer>): Y.Doc {
  const doc = createCanvasDoc();   // census ⑯：Y.Doc 构造经工厂单源
  if (state && state.byteLength > 0) Y.applyUpdate(doc, new Uint8Array(state));
  for (const u of updates) Y.applyUpdate(doc, new Uint8Array(u));
  return doc;
}

/** SV 字节级比对（encodeStateVector 产物——同 update 集合 ⇔ 同 clock 向量 ⇒ 全等；漂移=丢落/滞后
 * 任一都使 clock 向量分叉）。Uint8Array/Buffer 混源安全（Buffer 是 Uint8Array 子类）。 */
export function stateVectorsEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
