// 批7 E2E 测试中 DB 操纵工具（playwright 用例经 execSync 调用，一次一命令）。
// 用法：pnpm exec tsx prisma/collab-db.ts <command> <args...>
//   set-session-expiring <email> —— 该账号全部 session expiresAt 置 now+10s（场景 4 会话过期：
//       快照死线在 authenticate 时定格——必须**连接前**置（连后续置不进快照、永不触发；置已过期
//       则鉴权即拒无从连入）。authenticate 时仍有效 ⇒ 可入 doc，死线 10s 后自然越界 ⇒
//       tick（≤60s）+复验+5s grace 内 close(4401)。真协议链路验证见批7 S4）
//   set-viewer <email> <projectId>   —— 显式 ProjectMember PROJECT_VIEWER（场景 5 只读降级）
//   clear-viewer <email> <projectId> —— 删除显式记录（回退团队角色，测试复位）
//   intent-status <projectId> <nodeId> —— 最新意图行 JSON（场景 3 mid-flight 佐证）
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'set-session-expiring': {
      const [email] = args;
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) throw new Error(`user not found: ${email}`);
      const r = await prisma.session.updateMany({
        where: { userId: user.id, expiresAt: { gt: new Date() } },
        data: { expiresAt: new Date(Date.now() + 10_000) },
      });
      console.log(JSON.stringify({ ok: true, updated: r.count }));
      return;
    }
    case 'set-viewer': {
      const [email, projectId] = args;
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) throw new Error(`user not found: ${email}`);
      const existing = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: user.id } },
      });
      if (existing) {
        await prisma.projectMember.update({ where: { id: existing.id }, data: { role: 'PROJECT_VIEWER' } });
      } else {
        await prisma.projectMember.create({ data: { projectId, userId: user.id, role: 'PROJECT_VIEWER' } });
      }
      console.log(JSON.stringify({ ok: true }));
      return;
    }
    case 'clear-viewer': {
      const [email, projectId] = args;
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) throw new Error(`user not found: ${email}`);
      await prisma.projectMember.deleteMany({ where: { projectId, userId: user.id } });
      console.log(JSON.stringify({ ok: true }));
      return;
    }
    case 'intent-status': {
      const [projectId, nodeId] = args;
      const rows = await prisma.generationIntent.findMany({
        where: { projectId, nodeId },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { intentId: true, status: true, jobId: true, updatedAt: true },
      });
      console.log(JSON.stringify(rows[0] ?? null));
      return;
    }
    default:
      throw new Error(`unknown command: ${cmd}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
