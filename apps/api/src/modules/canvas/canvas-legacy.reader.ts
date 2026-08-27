import * as Y from 'yjs'
import { PrismaService } from '../../prisma/prisma.service'

// 临时桥接件（Task 3 契约迁移 → Task 13 正式切 CollabDocumentService 的窗口期）：
// CanvasDoc.state 的只读反序列化与一次性序列化构造；不持有/不持久化 doc 实例，不违反 Q1 单实例铁律
// Task 13 删除本文件

export async function readCanvasLegacy(
  prisma: PrismaService,
  projectId: string,
): Promise<{ nodes: any[]; edges: any[] }> {
  const row = await prisma.canvasDoc.findUnique({ where: { projectId } })
  if (!row) return { nodes: [], edges: [] }
  const doc = new Y.Doc()
  Y.applyUpdate(doc, new Uint8Array(row.state))
  const nodes = [...doc.getMap('nodes').entries()].map(([id, v]) => {
    const m = v as Y.Map<any>
    return {
      id,
      type: m.get('type'),
      parentId: m.get('parentId') ?? null,
      width: m.get('width') ?? null,
      height: m.get('height') ?? null,
      position: m.get('position')?.toJSON(),
      data: m.get('data')?.toJSON(),
    }
  })
  const edges = [...doc.getMap('edges').entries()].map(([id, v]) => {
    const m = v as Y.Map<any>
    return { id, sourceId: m.get('source'), targetId: m.get('target') }
  })
  return { nodes, edges }
}

export function buildLegacyDocState(
  nodes: { id: string; type: string; position?: { x: number; y: number }; data?: Record<string, unknown>; parentId?: string | null; width?: number | null; height?: number | null }[],
  edges: { id: string; source?: string; target?: string; sourceId?: string; targetId?: string }[],
): Buffer {
  const doc = new Y.Doc()
  const nodesMap = doc.getMap('nodes')
  for (const n of nodes) {
    const m = new Y.Map()
    m.set('type', n.type)
    if (n.parentId != null) m.set('parentId', n.parentId)
    if (n.width != null) m.set('width', n.width)
    if (n.height != null) m.set('height', n.height)
    const position = new Y.Map()
    position.set('x', n.position?.x ?? 0)
    position.set('y', n.position?.y ?? 0)
    m.set('position', position)
    const data = new Y.Map()
    for (const [k, v] of Object.entries(n.data ?? {})) data.set(k, v)
    m.set('data', data)
    nodesMap.set(n.id, m)
  }
  const edgesMap = doc.getMap('edges')
  for (const e of edges) {
    const m = new Y.Map()
    m.set('source', e.source ?? e.sourceId ?? '')
    m.set('target', e.target ?? e.targetId ?? '')
    edgesMap.set(e.id, m)
  }
  return Buffer.from(Y.encodeStateAsUpdate(doc))
}
