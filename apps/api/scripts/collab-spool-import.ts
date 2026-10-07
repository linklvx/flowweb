// apps/api/scripts/collab-spool-import.ts —— Y0a-2 回滚 runbook（spec §4.2）：读帧→repo.append→confirm。
// 回滚窗口=服务停机后手动回灌残留帧（运行期回灌由 gateway onModuleInit replayAll 承担——残留文件不读
// =回滚动作本身丢数据）。运行：DATABASE_URL=... COLLAB_SPOOL_DIR=... pnpm --filter @flowweb/api exec tsx scripts/collab-spool-import.ts <projectId|--all> [--force]
// Y0a-3（SV8/W20）：经租约行接管获得 fence 权限——scan()/replayAll 内 repo.append 需 owner 断言通过，
// 故**必须** spool.setOwner+repo.setLeaseOwner 同步接线（漏 spool 侧=scan 后帧归属目录漂移）。
// 守卫/60s 窗/finally 释放同 collab-compact（多项目长循环每轮续期——guarded 不夺他人）。
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { REVOKED_OWNER } from '../src/modules/collab/collab-lease.service';
import { CollabSpoolService } from '../src/modules/collab/collab-spool.service';
import { CanvasDocUpdateRepository } from '../src/modules/collab/canvas-doc-update.repository';

const OPS_OWNER = 'collab-spool-import';   // spool 子目录名形态（fs 安全字符集校验同款）

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: pnpm --filter @flowweb/api exec tsx scripts/collab-spool-import.ts <projectId|--all> [--force]');
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
    // SV8/W20 守卫：健康持有者在位即拒（--force 才越）
    const rows = await prisma.$queryRawUnsafe<{ owner: string | null; expiresAt: Date | null }[]>(
      `SELECT owner, "expiresAt" FROM "CollabLease" WHERE scope = 'primary'`,
    );
    const row = rows[0] ?? null;
    const healthy = row != null && row.owner != null && row.owner !== REVOKED_OWNER
      && row.expiresAt != null && row.expiresAt.getTime() > Date.now();
    if (healthy && !process.argv.includes('--force')) {
      console.error(`拒绝：租约有活跃持有者 ${row!.owner}——确认实例已停或加 --force`);
      process.exit(1);
    }
    const takeover = async () => {
      await prisma.$executeRawUnsafe(
        `UPDATE "CollabLease" SET owner = $1, epoch = epoch + 1, "expiresAt" = now() + interval '60 seconds' WHERE scope = 'primary'`,
        OPS_OWNER,
      );
      repo.setLeaseOwner(OPS_OWNER);
      spool.setOwner(OPS_OWNER);
    };
    await takeover();
    try {
      await spool.scan();
      const ids = target === '--all' ? spool.keys() : [target];
      let replayed = 0;
      for (const projectId of ids) {
        // 长操作续期：每轮 guarded（AND owner=OPS——已被他方接管时不越权夺回，fenced 由 replay 计数暴露）
        await prisma.$executeRawUnsafe(
          `UPDATE "CollabLease" SET "expiresAt" = now() + interval '60 seconds' WHERE scope = 'primary' AND owner = $1`,
          OPS_OWNER,
        ).catch(() => {});
        const r = await spool.replayAll(repo, { projectIds: [projectId] });   // 按项目点名回灌——单项目目标不旁及他项目
        replayed += r.replayed;
        console.log(`${projectId}: replayed=${r.replayed} failed=${r.failed} discarded=${r.discarded}`);
      }
      console.log(`共回灌 ${replayed} 帧`);
    } finally {
      // V8：异常退出也释放（带 owner 守卫——不越权清行）
      await prisma.$executeRawUnsafe(
        `UPDATE "CollabLease" SET owner = NULL, "expiresAt" = NULL, "renewedAt" = NULL WHERE scope = 'primary' AND owner = $1`,
        OPS_OWNER,
      ).catch(() => {});
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e) => { console.error(e); process.exitCode = 1; });   // 退出码契约自包含（collab-compact 同款）
