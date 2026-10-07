// apps/api/scripts/collab-spool-import.ts —— Y0a-2 回滚 runbook（spec §4.2）：读帧→repo.append→confirm。
// 回滚窗口=服务停机后手动回灌残留帧（运行期回灌由 gateway onModuleInit replayAll 承担——残留文件不读
// =回滚动作本身丢数据）。运行：DATABASE_URL=... COLLAB_SPOOL_DIR=... pnpm --filter @flowweb/api exec tsx scripts/collab-spool-import.ts <projectId|--all>
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { CollabSpoolService } from '../src/modules/collab/collab-spool.service';
import { CanvasDocUpdateRepository } from '../src/modules/collab/canvas-doc-update.repository';

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: pnpm --filter @flowweb/api exec tsx scripts/collab-spool-import.ts <projectId|--all>');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as any);   // 构造签名收 PrismaService——脚本侧窄化转型（collab-compact 同款）
  const spool = new CollabSpoolService();                       // 目录取 COLLAB_SPOOL_DIR env/CWD 默认——运维经 env 指定账本
  // 目录预检（口径同 service 构造——env/CWD 默认后 resolve）：scan() 内 mkdir recursive，
  // 拼错 COLLAB_SPOOL_DIR 会静默建幽灵目录→扫 0 帧→"共回灌 0 帧"绿色假成功（真实账本残帧未回灌无告警）。
  const dir = resolve(process.env.COLLAB_SPOOL_DIR ?? join(process.cwd(), '.data', 'collab-spool'));
  try {
    await stat(dir);
  } catch {
    console.error('spool 目录不存在: ' + dir + '（回滚 runbook：检查 COLLAB_SPOOL_DIR）');
    process.exit(1);
  }
  try {
    await spool.scan();
    const ids = target === '--all' ? spool.keys() : [target];
    let replayed = 0;
    for (const projectId of ids) {
      const r = await spool.replayAll(repo, { projectIds: [projectId] });   // 按项目点名回灌——单项目目标不旁及他项目
      replayed += r.replayed;
      console.log(`${projectId}: replayed=${r.replayed} failed=${r.failed} discarded=${r.discarded}`);
    }
    console.log(`共回灌 ${replayed} 帧`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e) => { console.error(e); process.exitCode = 1; });   // 退出码契约自包含（collab-compact 同款）
