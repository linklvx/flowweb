// Y.Doc 结构构造/反序列化纯函数（结构契约与后端 canvas 序列化一致）
import * as Y from 'yjs';

export interface PlainNode {
  id: string;
  type: string;
  parentId?: string | null;
  width?: number | null;
  height?: number | null;
  position?: { x: number; y: number };
  data?: Record<string, any>;
}

export interface PlainEdge {
  id: string;
  source?: string;
  target?: string;
  sourceId?: string;
  targetId?: string;
}

export function buildDocFromSnapshot(nodes: PlainNode[], edges: PlainEdge[]): Y.Doc {
  const doc = new Y.Doc();
  fillDoc(doc, nodes, edges);
  return doc;
}

export function fillDoc(doc: Y.Doc, nodes: PlainNode[], edges: PlainEdge[]): void {
  const nodesMap = doc.getMap('nodes');
  for (const n of nodes) {
    const m = new Y.Map();
    m.set('type', n.type);
    if (n.parentId != null) m.set('parentId', n.parentId);
    if (n.width != null) m.set('width', n.width);
    if (n.height != null) m.set('height', n.height);
    const position = new Y.Map();
    position.set('x', n.position?.x ?? 0);
    position.set('y', n.position?.y ?? 0);
    m.set('position', position);
    const data = new Y.Map();
    for (const [k, v] of Object.entries(n.data ?? {})) data.set(k, v);
    m.set('data', data);
    nodesMap.set(n.id, m);
  }
  const edgesMap = doc.getMap('edges');
  for (const e of edges) {
    const m = new Y.Map();
    m.set('source', e.source ?? e.sourceId ?? '');
    m.set('target', e.target ?? e.targetId ?? '');
    edgesMap.set(e.id, m);
  }
}

export function readCanvasFromDoc(doc: Y.Doc): { nodes: PlainNode[]; edges: PlainEdge[] } {
  const nodes = [...doc.getMap('nodes').entries()]
    .filter(([nodeId]) => !nodeId.startsWith('shadow-')) // 影子节点不进 store（spec 双重过滤——投影层；后端 __ephemeral 为另一半）
    .map(([id, v]) => {
    const m = v as Y.Map<any>;
    return {
      id,
      type: m.get('type'),
      parentId: m.get('parentId') ?? null,
      width: m.get('width') ?? null,
      height: m.get('height') ?? null,
      position: m.get('position')?.toJSON(),
      data: m.get('data')?.toJSON() ?? {},
    };
  });
  const edges = [...doc.getMap('edges').entries()].map(([id, v]) => {
    const m = v as Y.Map<any>;
    return { id, source: m.get('source'), target: m.get('target') };
  });
  return { nodes, edges };
}
