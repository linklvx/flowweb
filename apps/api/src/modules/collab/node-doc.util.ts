// apps/api/src/modules/collab/node-doc.util.ts
import * as Y from 'yjs';

export interface ShadowNodeInput {
  id: string; // 必须以 'shadow-' 前缀命名——前端 onRemote 以此为短路判据（origin 不过网，见 spec v3.6 修正）
  type: 'videoGen' | 'audioGen';
  position: { x: number; y: number };
  data: Record<string, unknown>; // 必含 __ephemeral: true
  width?: number; // plan 笔误修正：实现条件写 n.width/n.height，接口需字段存在性可判
  height?: number;
}

/** 与前端 ydocBuilder.fillDoc 逐键同构：type / parentId?(null 省略) / width?/height?(可选条件写) / position(Y.Map 必写) / data(Y.Map) */
export function buildShadowNodeYMap(n: ShadowNodeInput): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set('type', n.type);
  if (n.width != null) m.set('width', n.width);
  if (n.height != null) m.set('height', n.height);
  const position = new Y.Map<unknown>();
  position.set('x', n.position.x);
  position.set('y', n.position.y);
  m.set('position', position);
  const data = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(n.data)) data.set(k, v);
  m.set('data', data);
  return m;
}
