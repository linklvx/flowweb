// apps/api/scripts/collab-compact.ts —— Y0a-1 compact 人工出口（装载超时自愈也失败时的最终运维动作）
// 运行：DATABASE_URL=... pnpm --filter @flowweb/api exec tsx scripts/collab-compact.ts <projectId> [--json]
// 载体：tsconfig.scripts.json include "scripts"（pnpm verify 的 `tsc -p tsconfig.scripts.json --noEmit`
// 步覆盖——运维出口有静态 typecheck，不在事故中才发现坏了）；tsx 是 api 包 devDependency（仓根
// npx 解析不到）；直调 repo.compact=唯一实现（禁脚本重抄 SQL——双源）。
import { PrismaClient } from '@prisma/client';
import { CanvasDocUpdateRepository } from '../src/modules/collab/canvas-doc-update.repository';

async function main(): Promise<void> {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error('usage: pnpm --filter @flowweb/api exec tsx scripts/collab-compact.ts <projectId> [--json]');
    process.exit(1);
  }
  const json = process.argv.includes('--json');
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as any);   // 构造签名收 PrismaService——脚本侧窄化转型
  try {
    const before = await prisma.canvasDocUpdate.count({ where: { projectId } });
    const r = await repo.compact(projectId, { timeoutMs: 120_000, maxWaitMs: 5_000 });   // 运维出口独立长预算
    const after = await prisma.canvasDocUpdate.count({ where: { projectId } });
    if (!r.compacted) {
      // abandoned（pendingStructs!=null——人工介入场景本体）/empty：如实打印 reason，非零退出码提示运维
      const msg = `compact 未执行：reason=${r.reason}（${before} 行 → ${after} 行增量，行未动）`;
      console.log(json ? JSON.stringify({ projectId, before, after, ...r }) : msg);
      process.exitCode = 2;
      return;
    }
    console.log(json ? JSON.stringify({ projectId, before, after, compacted: true }) : `compact 完成：${before} 行 → ${after} 行增量`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e) => { console.error(e); process.exitCode = 1; });   // 退出码契约自包含——不依赖 Node unhandled-rejections 默认策略（warn 策略下会假成功 exit 0）
