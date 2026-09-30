// Y.Doc 结构构造/反序列化纯函数（结构契约与后端 canvas 序列化一致）
import * as Y from 'yjs';
import { normalizeCanvasRecord, type CanvasNodeRecord } from '@flowweb/shared';

/** 批2-3（R1c 前置物）：doc meta schema 版本——结构迁移判据的持久锚点（随 update 传播/服务端持久） */
export const CANVAS_DOC_SCHEMA_VERSION = 1;

export interface PlainEdge {
  id: string;
  source?: string;
  target?: string;
}

export function buildDocFromSnapshot(nodes: CanvasNodeRecord[], edges: PlainEdge[]): Y.Doc {
  const doc = new Y.Doc();
  fillDoc(doc, nodes, edges);
  return doc;
}

export function fillDoc(doc: Y.Doc, nodes: CanvasNodeRecord[], edges: PlainEdge[]): void {
  // meta schemaVersion（批2-3）：同值 no-op 守卫——syncStoreToDoc 逐新节点也走 fillDoc，防 doc 膨胀
  const meta = doc.getMap('meta');
  if (meta.get('schemaVersion') !== CANVAS_DOC_SCHEMA_VERSION) {
    meta.set('schemaVersion', CANVAS_DOC_SCHEMA_VERSION);
  }
  const nodesMap = doc.getMap('nodes');
  for (const n of nodes) {
    // TODO(R1b/F35): 崩溃恢复快照的 AppNode 无 parentId——此路径恒不写组结构（组拍平），见 spec F35/R1b 契约 5
    // normalizeCanvasRecord：null 可选键真删键（不写 Y.Map）；position/data undefined/null 兜底
    const rec = normalizeCanvasRecord(n);
    const m = new Y.Map();
    m.set('type', rec.type);
    if (rec.parentId !== undefined) m.set('parentId', rec.parentId);
    if (rec.width !== undefined) m.set('width', rec.width);
    if (rec.height !== undefined) m.set('height', rec.height);
    const position = new Y.Map();
    position.set('x', rec.position.x);
    position.set('y', rec.position.y);
    m.set('position', position);
    const data = new Y.Map();
    for (const [k, v] of Object.entries(rec.data)) data.set(k, v);
    m.set('data', data);
    nodesMap.set(rec.id, m);
  }
  const edgesMap = doc.getMap('edges');
  for (const e of edges) {
    const m = new Y.Map();
    m.set('source', e.source ?? ''); // edges 单形状 source/target（R1a 收敛——崩溃快照 validate 已锁单形）
    m.set('target', e.target ?? '');
    edgesMap.set(e.id, m);
  }
}

export function readCanvasFromDoc(doc: Y.Doc): { nodes: CanvasNodeRecord[]; edges: PlainEdge[] } {
  const nodes = [...doc.getMap('nodes').entries()]
    .filter(([nodeId]) => !nodeId.startsWith('shadow-')) // 影子节点不进 store（spec 双重过滤——投影层；后端 __ephemeral 为另一半）
    .map(([id, v]) => {
    const m = v as Y.Map<any>;
    // 批4a 读归一：出口过 normalizeCanvasRecord——与写侧 projectCanvasNodes→normalize 同形
    //（消除"doc null 值键/缺键 → ?? null 出口"与写侧缺键形态的形状差；position/data 兜底
    //  收敛至 normalize 单源 {x:0,y:0}/{}）
    return normalizeCanvasRecord({
      id,
      type: m.get('type'),
      parentId: m.get('parentId') ?? null,
      width: m.get('width') ?? null,
      height: m.get('height') ?? null,
      position: m.get('position')?.toJSON(),
      data: m.get('data')?.toJSON(),
    });
  });
  const edges = [...doc.getMap('edges').entries()].map(([id, v]) => {
    const m = v as Y.Map<any>;
    return { id, source: m.get('source'), target: m.get('target') };
  });
  return { nodes, edges };
}

/** 增量写（syncStoreToDoc 逐键 diff 收敛）：record 缺键 → Y.Map delete；值变才 set（同值 no-op——
 *  本函数在 ns 每次变更都跑，无守卫=doc 膨胀）。data 逐键 diff 留 syncStoreToDoc 原有逻辑——业务域不属信封。 */
export function applyRecordToYMap(m: Y.Map<any>, r: CanvasNodeRecord): void {
  const n = normalizeCanvasRecord(r);
  for (const key of ['parentId', 'width', 'height'] as const) {
    const cur = m.get(key);
    const want = (n as any)[key];
    if (want === undefined) { if (cur !== undefined) m.delete(key); }
    else if (cur !== want) m.set(key, want);
  }
  if (m.get('type') !== n.type) m.set('type', n.type);
  let pos = m.get('position');
  if (!(pos instanceof Y.Map)) { pos = new Y.Map(); m.set('position', pos); }
  if (pos.get('x') !== n.position.x) pos.set('x', n.position.x);
  if (pos.get('y') !== n.position.y) pos.set('y', n.position.y);
}
