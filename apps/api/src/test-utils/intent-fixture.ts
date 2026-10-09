// apps/api/src/test-utils/intent-fixture.ts —— Y0b-2 T1（Z116）：int/单测夹具工厂
// 三能力：意图行夹具（idemKey/heartbeatAt/deadlineAt 必填列统一铸造）、台账清理（ledgerWipe——
// 通行证经 runInTx 内置）、team 级联删除（deleteTeamsWithPass——TeamBalance 级联删触发行级触发器）。
// 纪律（Z116 测试能力制）：测试文件触碰台账/钱包表必须经本工厂三入口之一——直写会被 ledger_guard
// 触发器拦截（LEDGER_SINGLE_WRITER），吞错掩码（.catch(()=>{})）=假绿，禁用。
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreditLedgerService } from '../modules/team/credit-ledger.service';

/** 意图行夹具：三 NOT NULL 新列（heartbeatAt/deadlineAt/idemKey）统一铸造——缺省即随机/当下值。
 *  Unchecked 形态（扁平 FK 列 pricingRuleId/modelId 直填——夹具无嵌套 connect 需求）。 */
export async function createIntentFixture(
  prisma: PrismaService,
  over: Partial<Prisma.GenerationIntentUncheckedCreateInput> & {
    projectId: string; nodeId: string; userId: string; teamId: string; intentId: string; kind: string; paramsHash: string; creditCost: number;
  },
) {
  const data: Prisma.GenerationIntentUncheckedCreateInput = {
    ...over,
    status: over.status ?? 'RUNNING',
    idemKey: over.idemKey ?? randomUUID(),
    heartbeatAt: over.heartbeatAt ?? new Date(),
    deadlineAt: over.deadlineAt ?? new Date(Date.now() + 90_000),
  };
  return prisma.generationIntent.create({ data });
}

/** 台账清理（Z116 能力制）：通行证在 runInTx 内置——窗口（800 字符）内含 runInTx 即 checker 放行。 */
export async function ledgerWipe(ledger: CreditLedgerService, where: { teamId?: string } = {}) {
  await ledger.runInTx(async (tx) => {
    await tx.teamCreditTransaction.deleteMany(where.teamId ? { where: { teamId: where.teamId } } : undefined);
    await tx.teamBalance.deleteMany(where.teamId ? { where: { teamId: where.teamId } } : undefined);
  });
}

/** team.delete 级联删 TeamBalance 触发行级触发器——GUC 包裹让级联带证；deleteMany 幂等（Z116）。 */
export async function deleteTeamsWithPass(prisma: PrismaService, ids: string[]) {
  await prisma.$transaction(async (raw) => {
    await raw.$executeRaw`SET LOCAL app.ledger_tx = 'on'`;
    await raw.team.deleteMany({ where: { id: { in: ids } } });
  });
}
