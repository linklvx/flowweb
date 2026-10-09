// 批7 双客户端 E2E fixtures（collab-global-setup 调用）：两个测试账号（A=OWNER/B=成员）+ 共享画布。
// 幂等：账号存在即跳过、其余 upsert；重跑零增量残留。
// 契约：apps/web/e2e/collab-global-setup.ts（账号）与 collab-recovery.e2e.spec.ts（projectId）引用同值。
import 'dotenv/config';
import * as Y from 'yjs';
import { PrismaClient } from '@prisma/client';
import { auth } from '../src/auth/auth';

const prisma = new PrismaClient();

export const COLLAB_GATE = {
  aEmail: 'collab-a@flowweb.local',
  password: 'collab12345678', // better-auth minPasswordLength=8
  bEmail: 'collab-b@flowweb.local',
  projectId: 'collab-gate-canvas',
};

async function ensureUser(email: string, name: string) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    await auth.api.signUpEmail({ body: { email, password: COLLAB_GATE.password, name } });
    console.log(`Collab gate user created: ${email}`);
  }
  return prisma.user.findUniqueOrThrow({ where: { email } });
}

async function main() {
  // A：画布属主（个人默认团队——bootstrap 自带 100 积分，text 生成 2 积分足够）
  const userA = await ensureUser(COLLAB_GATE.aEmail, 'Collab Gate A');
  const teamA = await prisma.team.findFirst({ where: { ownerId: userA.id, isDefault: true } });
  if (!teamA) throw new Error('collab gate user A default team missing (bootstrapPersonalTeam failed?)');

  // B：以 MEMBER 加入 A 的团队（resolve 链回退 PROJECT_EDITOR——场景 1-4 双端可编辑；
  // 场景 5 由 collab-db.ts set-viewer 显式降级，测试尾 clear-viewer 复位）
  const userB = await ensureUser(COLLAB_GATE.bEmail, 'Collab Gate B');
  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId: teamA.id, userId: userB.id } },
    update: { role: 'MEMBER' },
    create: { teamId: teamA.id, userId: userB.id, role: 'MEMBER' },
  });

  // 图片节点 E2E 定价：Y0b-1 起走真源——定价数据在迁移（seed-pricing-* 固定 id 规则）+UI 从模型声明行
  // 渲染并存行 id（Z36②a）+resolver 归一化精确匹配。旧"词表 1K/2K/4K 兜底规则"段已删（其兜底的
  // 产品缺陷——面板补写词表串后定价永不命中——已被 Y0b-1 根修；2026-10-09 部署实测该段持续写
  // 悬空键脏行污染 funds-four-way ①的 findFirst 反推夹具）。

  // 共享画布：空 doc 快照（与 gate-seed.ts 同款自愈——快照重写 + 增量行清残）
  await prisma.canvasProject.upsert({
    where: { id: COLLAB_GATE.projectId },
    update: {},
    create: { id: COLLAB_GATE.projectId, name: '批7 E2E 协作画布', userId: userA.id, teamId: teamA.id },
  });
  const state = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()));
  await prisma.canvasDocUpdate.deleteMany({ where: { projectId: COLLAB_GATE.projectId } });
  await prisma.canvasDoc.upsert({
    where: { projectId: COLLAB_GATE.projectId },
    update: { state },
    create: { projectId: COLLAB_GATE.projectId, state },
  });

  console.log('Collab gate fixtures ready: userA/userB/member/shared canvas');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0); // auth.ts 顶层 ioredis 连接会让进程挂起，必须显式退出（seed.ts 同款）
  });
