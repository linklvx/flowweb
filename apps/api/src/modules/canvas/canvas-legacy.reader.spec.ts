import { describe, it, expect, vi } from 'vitest'
import { readCanvasLegacy, buildLegacyDocState } from './canvas-legacy.reader'

describe('canvas-legacy.reader（Task 3-13 窗口期临时件）', () => {
  it('build → read 往返：节点/边字段无损还原（形状对齐原 include 结果）', async () => {
    const nodes = [
      {
        id: 'n1', type: 'textInput', parentId: 'g1', width: 320, height: 120,
        position: { x: 10, y: 20 }, data: { text: 'a', status: 'done' },
      },
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: {} },
    ]
    const edges = [{ id: 'e1', source: 'n1', target: 'g1' }]
    const state = buildLegacyDocState(nodes, edges)

    const prisma: any = { canvasDoc: { findUnique: vi.fn().mockResolvedValue({ projectId: 'p1', state }) } }
    const result = await readCanvasLegacy(prisma, 'p1')

    expect(result.nodes).toHaveLength(2)
    const n1 = result.nodes.find((n) => n.id === 'n1')
    expect(n1).toMatchObject({ type: 'textInput', parentId: 'g1', width: 320, height: 120 })
    expect(n1.position).toEqual({ x: 10, y: 20 })
    expect(n1.data).toEqual({ text: 'a', status: 'done' })
    const g1 = result.nodes.find((n) => n.id === 'g1')
    expect(g1.parentId).toBeNull()
    expect(g1.width).toBeNull()
    expect(result.edges).toEqual([{ id: 'e1', sourceId: 'n1', targetId: 'g1' }])
  })

  it('无 CanvasDoc 行返回空画布', async () => {
    const prisma: any = { canvasDoc: { findUnique: vi.fn().mockResolvedValue(null) } }
    const result = await readCanvasLegacy(prisma, 'p1')
    expect(result).toEqual({ nodes: [], edges: [] })
  })
})
