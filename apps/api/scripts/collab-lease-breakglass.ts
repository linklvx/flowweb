// Y0a-3（SV2/W7）：运维逃生阀——撤销当前持有者。写 'revoked' 哨兵+expiresAt=now()+epoch+1：
//  新实例 CAS 经 expiresAt<now() 支路立即可得；被撤销实例 renew 0 行→owner='revoked'→revoked
//  终态不 rejoin（防 1s 内抢回）。epoch 单调由下次 CAS +1 保持。
// runbook 三步（spec §5.2）：①本脚本 ②确认旧实例日志 collab_lease_revoked+listener 已释放
//  ③起新实例。缺第②步=一次不可审计的停机。
import { PrismaClient } from '@prisma/client';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const prev = await prisma.$queryRaw<{ owner: string | null; epoch: bigint; expiresAt: Date | null }[]>`
      SELECT owner, epoch, "expiresAt" FROM "CollabLease" WHERE scope = 'primary'`;
    if (prev.length === 0) { console.error('CollabLease 行缺失——无需撤销（seed 会自建）'); process.exitCode = 1; return; }
    console.log(JSON.stringify({ event: 'breakglass_prev', owner: prev[0].owner, epoch: prev[0].epoch.toString(), expiresAt: prev[0].expiresAt?.toISOString() ?? null }));
    await prisma.$executeRawUnsafe(
      `UPDATE "CollabLease" SET owner = 'revoked', epoch = epoch + 1, "expiresAt" = now(), "renewedAt" = NULL WHERE scope = 'primary'`,
    );
    // AuditLog 审计行（字段名经 tsconfig.scripts 的 tsc --noEmit 编译期校验——V31 核验确认；
    // V8：审计是旁路不是前置——写失败只 WARN（UPDATE 已生效=撤销事实优先，勿让值班误判"撤销失败"重跑））
    try {
      await prisma.auditLog.create({
        data: {
          operatorId: 'system:breakglass', operatorName: 'system:breakglass',
          targetType: 'COLLAB_LEASE', targetId: 'primary', action: 'collab_breakglass',
          afterValue: { owner: 'revoked', epoch: (prev[0].epoch + 1n).toString() },
          remark: `前任 owner=${prev[0].owner} epoch=${prev[0].epoch} expiresAt=${prev[0].expiresAt?.toISOString() ?? null}`,
        },
      });
    } catch (e) { console.warn(`breakglass 审计写失败（撤销已生效）: ${(e as Error).message}`); }
    console.log(JSON.stringify({ event: 'breakglass_done', note: '确认旧实例日志 collab_lease_revoked + listener 释放后，起新实例' }));
  } finally { await prisma.$disconnect(); }
}
void main().catch((e) => { console.error(e); process.exitCode = 1; });
