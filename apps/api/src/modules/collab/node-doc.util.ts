// apps/api/src/modules/collab/node-doc.util.ts
import * as Y from 'yjs';
import { normalizeCanvasRecord, type CanvasNodeRecord } from '@flowweb/shared';

/** 整信封写入共享入口（R1a 收敛）。返回节点 Y.Map；data 子 Map 经 m.get('data') 取。
 *  消费方：project.service fillDoc / backfill-team（批5-1 删信箱后 collab-document
 *  insertNode 已随影子机制消失）。data 全量写入——漏写则模板导入丢全部节点数据。 */
export function writeNodeToYMap(nodesMap: Y.Map<any>, n: CanvasNodeRecord): Y.Map<any> {
  const rec = normalizeCanvasRecord(n);
  const m = new Y.Map();
  m.set('type', rec.type);
  for (const key of ['parentId', 'width', 'height'] as const) {
    if ((rec as any)[key] !== undefined) m.set(key, (rec as any)[key]);
  }
  const pos = new Y.Map();
  pos.set('x', rec.position.x);
  pos.set('y', rec.position.y);
  m.set('position', pos);
  const data = new Y.Map();
  for (const [k, v] of Object.entries(rec.data)) data.set(k, v); // 全量写入——空 Map 会静默丢数据
  m.set('data', data);
  nodesMap.set(rec.id, m);
  return m;
}
