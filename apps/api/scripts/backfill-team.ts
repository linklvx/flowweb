import { PrismaClient } from '@prisma/client'
import * as Y from 'yjs'

const prisma = new PrismaClient()

function buildDocState(
  nodes: { id: string; type: string; parentId: string | null; width: number | null; height: number | null; position: unknown; data: unknown }[],
  edges: { id: string; sourceId: string; targetId: string }[],
): Buffer {
  const doc = new Y.Doc()
  const nodesMap = doc.getMap('nodes')
  for (const n of nodes) {
    const nodeMap = new Y.Map()
    nodeMap.set('type', n.type)
    if (n.parentId != null) nodeMap.set('parentId', n.parentId)
    if (n.width != null) nodeMap.set('width', n.width)
    if (n.height != null) nodeMap.set('height', n.height)
    const position = new Y.Map()
    position.set('x', (n.position as { x: number }).x)
    position.set('y', (n.position as { y: number }).y)
    nodeMap.set('position', position)
    const data = new Y.Map()
    for (const [k, v] of Object.entries((n.data as Record<string, unknown>) ?? {})) {
      data.set(k, v)
    }
    nodeMap.set('data', data)
    nodesMap.set(n.id, nodeMap)
  }
  const edgesMap = doc.getMap('edges')
  for (const e of edges) {
    const edgeMap = new Y.Map()
    edgeMap.set('source', e.sourceId)
    edgeMap.set('target', e.targetId)
    edgesMap.set(e.id, edgeMap)
  }
  return Buffer.from(Y.encodeStateAsUpdate(doc))
}

async function main() {
  // ① 清理无主项目（2026-08-27 用户裁定全删；nodes/edges 级联，templates SetNull 保留）
  const deleted = await prisma.canvasProject.deleteMany({ where: { userId: null } })
  console.log(`deleted ownerless projects: ${deleted.count}`)

  // ② 有项目的用户建默认团队四件套（幂等：已有团队跳过）
  const users = await prisma.user.findMany({
    where: { OR: [{ canvasProjects: { some: {} } }, { media: { some: {} } }] },
    select: { id: true, name: true },
  })
  for (const u of users) {
    const existing = await prisma.team.findFirst({ where: { ownerId: u.id }, select: { id: true } })
    if (existing) continue
    await prisma.$transaction(async (tx) => {
      const team = await tx.team.create({ data: { name: `${u.name}的团队`, ownerId: u.id } })
      await tx.teamMember.create({ data: { teamId: team.id, userId: u.id, role: 'OWNER' } })
      await tx.teamBalance.create({ data: { teamId: team.id, credits: 100 } })
      await tx.teamCreditTransaction.create({
        data: {
          teamId: team.id,
          operatorUserId: u.id,
          amount: 100,
          type: 'register_grant',
          creditType: 'regular',
          balanceAfter: 100,
        },
      })
    })
    console.log(`created default team for ${u.name}`)
  }

  // ③ 回填 teamId
  const teams = await prisma.team.findMany({ select: { id: true, ownerId: true } })
  for (const t of teams) {
    const projects = await prisma.canvasProject.updateMany({ where: { userId: t.ownerId, teamId: null }, data: { teamId: t.id } })
    const media = await prisma.media.updateMany({ where: { userId: t.ownerId, teamId: null }, data: { teamId: t.id } })
    if (projects.count || media.count) {
      console.log(`backfilled ${t.id}: projects=${projects.count} media=${media.count}`)
    }
  }

  // ④ CanvasDoc 序列化（幂等：已有跳过）
  const projects = await prisma.canvasProject.findMany({ select: { id: true } })
  let docCount = 0
  for (const p of projects) {
    const existing = await prisma.canvasDoc.findUnique({ where: { projectId: p.id }, select: { projectId: true } })
    if (existing) continue
    const [nodes, edges] = await Promise.all([
      prisma.canvasNode.findMany({ where: { projectId: p.id } }),
      prisma.canvasEdge.findMany({ where: { projectId: p.id } }),
    ])
    await prisma.canvasDoc.create({
      data: { projectId: p.id, state: buildDocState(nodes, edges) },
    })
    docCount++
  }
  console.log(`serialized CanvasDoc: ${docCount} (total projects: ${projects.length})`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
