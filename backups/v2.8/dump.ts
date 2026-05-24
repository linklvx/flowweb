// v2.8 database backup — run from apps/api:  npx ts-node --compiler-options '{"module":"CommonJS"}' ../../backups/v2.8/dump-db.ts
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const p = new PrismaClient();

async function dump() {
  const outPath = '../../backups/v2.8/database.json';
  const counts: Record<string, number> = {};
  const data: Record<string, any> = {};

  const projects = await p.canvasProject.findMany();
  counts.projects = projects.length;
  data.projects = projects;

  const users = await p.user.findMany({ select: { id: true, email: true, name: true, role: true, credits: true, createdAt: true } });
  counts.users = users.length;
  data.users = users;

  const media = await p.media.findMany({ select: { id: true, type: true, fileName: true, fileSize: true, userId: true, createdAt: true } });
  counts.media = media.length;
  data.media = media;

  const templates = await p.template.findMany({ select: { id: true, name: true, type: true, isOfficial: true, userId: true } });
  counts.templates = templates.length;
  data.templates = templates;

  const nodeTypes = await p.nodeType.findMany();
  counts.nodeTypes = nodeTypes.length;
  data.nodeTypes = nodeTypes;

  const nodes = await p.canvasNode.findMany({ select: { id: true, type: true, projectId: true, data: true, createdAt: true } });
  counts.nodes = nodes.length;
  data.nodes = nodes;

  const edges = await p.canvasEdge.findMany({ select: { id: true, sourceId: true, targetId: true, projectId: true } });
  counts.edges = edges.length;
  data.edges = edges;

  await p.$disconnect();

  fs.writeFileSync(outPath, JSON.stringify({ exportedAt: new Date().toISOString(), counts, data }, null, 2));
  console.log('✅ Backup complete');
  console.log('Counts:', JSON.stringify(counts));
}

dump().catch((e) => { console.error(e); process.exit(1); });
