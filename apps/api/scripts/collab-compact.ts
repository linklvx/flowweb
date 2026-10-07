// apps/api/scripts/collab-compact.ts —— Y0a-1 compact 人工出口（装载超时自愈也失败时的最终运维动作）
// 运行：DATABASE_URL=... pnpm --filter @flowweb/api exec tsx scripts/collab-compact.ts <projectId> [--json] [--force]
// 载体：tsconfig.scripts.json include "scripts"（pnpm verify 的 `tsc -p tsconfig.scripts.json --noEmit`
// 步覆盖——运维出口有静态 typecheck，不在事故中才发现坏了）；tsx 是 api 包 devDependency（仓根
// npx 解析不到）；直调 repo.compact=唯一实现（禁脚本重抄 SQL——双源）。
// Y0a-3（SV8/W20）：经租约行接管获得 fence 权限（诚实形态；热路径零豁免口）。守卫：租约有活跃
// 持有者（expiresAt>now()）时拒绝——改 owner 会让健康实例立刻 fenced→isolate→踢用户一轮，确认
// 实例已停或加 --force。60s 接管窗+finally 释放（异常退出也不阻塞生产实例获取——runbook 注明）。
import { PrismaClient } from '@prisma/client';
import { CanvasDocUpdateRepository } from '../src/modules/collab/canvas-doc-update.repository';

const OPS_OWNER = 'ops:collab-compact';

async function main(): Promise<void> {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error('usage: pnpm --filter @flowweb/api exec tsx scripts/collab-compact.ts <projectId> [--json] [--force]');
    process.exit(1);
  }
  const json = process.argv.includes('--json');
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as any);   // 构造签名收 PrismaService——脚本侧窄化转型
  try {
    // SV8/W20 守卫：健康持有者在位即拒（--force 才越）；revoked 行无 TTL 不算健康（break-glass 后本就无实例持有）
    const rows = await prisma.$queryRawUnsafe<{ owner: string | null; expiresAt: Date | null }[]>(
      `SELECT owner, "expiresAt" FROM "CollabLease" WHERE scope = 'primary'`,
    );
    const row = rows[0] ?? null;
    const healthy = row != null && row.owner != null && row.owner !== 'revoked'
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
    };
    await takeover();
    try {
      const before = await prisma.canvasDocUpdate.count({ where: { projectId } });
      const r = await repo.compact(projectId, { timeoutMs: 120_000, maxWaitMs: 5_000 });   // 运维出口独立长预算
      const after = await prisma.canvasDocUpdate.count({ where: { projectId } });
      if (!r.compacted) {
        // abandoned（pendingStructs!=null——人工介入场景本体）/empty/not-owner：如实打印 reason，非零退出码提示运维
        const msg = `compact 未执行：reason=${r.reason}（${before} 行 → ${after} 行增量，行未动）`;
        console.log(json ? JSON.stringify({ projectId, before, after, ...r }) : msg);
        process.exitCode = 2;
        return;
      }
      console.log(json ? JSON.stringify({ projectId, before, after, compacted: true }) : `compact 完成：${before} 行 → ${after} 行增量`);
    } finally {
      // V8：异常退出也释放——防脚本崩溃后生产实例 60s+ 内无法获取租约（runbook 注明）；
      // 带 owner 守卫：已被他方接管时不越权清行
      await prisma.$executeRawUnsafe(
        `UPDATE "CollabLease" SET owner = NULL, "expiresAt" = NULL, "renewedAt" = NULL WHERE scope = 'primary' AND owner = $1`,
        OPS_OWNER,
      ).catch(() => {});
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e) => { console.error(e); process.exitCode = 1; });   // 退出码契约自包含——不依赖 Node unhandled-rejections 默认策略（warn 策略下会假成功 exit 0）
