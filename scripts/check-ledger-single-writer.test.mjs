// scripts/check-ledger-single-writer.test.mjs —— 扫描锚自测（node --test scripts/ 消费——import 零副作用）。
// 合成夹具各档证红 + 正样本零误报（对齐仓内真实代码形态：where 变量前置/private async 方法/SET LOCAL 窗口）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanFiles } from './check-ledger-single-writer.mjs';

const LEDGER_REL = 'apps/api/src/modules/team/credit-ledger.service.ts';
const fundRels = {
  ledger: LEDGER_REL,
  teamCredit: 'apps/api/src/modules/team/team-credit.service.ts',
  reconcile: 'apps/api/src/modules/execution/intent-reconcile.service.ts',
};
const mk = (entries) => entries.map(([rel, src]) => ({ rel, src }));

// ledger 服务正样本：全写操作集+raw TeamBalance INSERT 都在本文件=全部豁免
const okLedger = `export class CreditLedgerService {
  async mutate(tx: LedgerTx, input: LedgerMutateInput) {
    await this.lockBalance(tx, input.teamId);
    await tx.teamBalance.update({ where: { teamId: input.teamId }, data: { credits: { increment: 1 } } });
    const row = await tx.teamCreditTransaction.create({ data: { teamId: input.teamId } });
    await tx.$executeRaw\`INSERT INTO "TeamBalance" ("teamId") VALUES (\${input.teamId})\`;
    return row;
  }
}`;

test('正样本零误报：ledger 本文件全豁免+调用方真实形态（where 变量前置/GI 写在 lock 后/private async 分割）', () => {
  const caller = [
    'export class Funds {',
    '  async listTransactions(id: string) {',
    '    const where = { teamId: id };',
    '    return this.prisma.teamCreditTransaction.findMany({ where, take: 20 });',
    '  }',
    '  private async refund(row: any) {',
    "    await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;",
    '    await this.ledger.lockBalance(tx, row.teamId);',
    '    await tx.generationIntent.updateMany({ where: { id: 1 }, data: {} });',
    '  }',
    '}',
  ].join('\n');
  assert.deepEqual(scanFiles(mk([
    [fundRels.ledger, okLedger],
    [fundRels.teamCredit, caller],
  ])), []);
});

test('① 写入口唯一：TeamCreditTransaction 写操作集（create/update/upsert/delete 各档）ledger 外=红，ledger 内=绿', () => {
  for (const op of ['create', 'update', 'upsert', 'deleteMany']) {
    const src = `await tx.teamCreditTransaction.${op}({});`;
    assert.ok(scanFiles(mk([['apps/api/src/modules/team/other.service.ts', src]]))
      .some((p) => p.includes('唯一写入口违规')), op);
    assert.deepEqual(scanFiles(mk([[fundRels.ledger, src]])), []);
  }
});

test('② balance 写白名单：非 ledger 非 spec=红；.spec. 豁免=绿；ledger=绿', () => {
  const src = 'prisma.teamBalance.update({});';
  assert.ok(scanFiles(mk([['apps/api/src/modules/team/team.service.ts', src]]))
    .some((p) => p.includes('TeamBalance 写操作越权')));
  assert.deepEqual(scanFiles(mk([['apps/api/src/modules/team/team.service.spec.ts', src]])), []);
  assert.deepEqual(scanFiles(mk([[fundRels.ledger, src]])), []);
});

test('③ raw 形态：$queryRaw 触及 TeamCreditTransaction 且 800 字符内无 teamId=红；带 teamId=绿', () => {
  const bad = 'prisma.$queryRaw`SELECT * FROM "TeamCreditTransaction" WHERE id = 1`;';
  const ok = 'prisma.$queryRaw`SELECT * FROM "TeamCreditTransaction" WHERE r."teamId" = ${t} AND id = 1`;';
  assert.ok(scanFiles(mk([['apps/api/src/modules/x/x.service.ts', bad]]))
    .some((p) => p.includes('800 字符内无 teamId')));
  assert.deepEqual(scanFiles(mk([['apps/api/src/modules/x/x.service.ts', ok]])), []);
});

test('④ raw 写 TeamBalance：ledger 外 UPDATE/INSERT/DELETE=红；T5 巡检 raw SELECT 不误伤=绿', () => {
  for (const stmt of ['UPDATE "TeamBalance" SET credits = 999', 'INSERT INTO "TeamBalance" ("teamId") VALUES (1)', 'DELETE FROM "TeamBalance" WHERE "teamId" = 1']) {
    const src = 'await prisma.$executeRaw`' + stmt + '`;';
    assert.ok(scanFiles(mk([['apps/api/src/modules/x/x.service.ts', src]]))
      .some((p) => p.includes('raw SQL 写 TeamBalance')), stmt);
  }
  const sel = 'const r = await prisma.$queryRaw`SELECT credits FROM "TeamBalance" WHERE "teamId" = 1`;';
  assert.deepEqual(scanFiles(mk([['apps/api/src/modules/x/x.service.ts', sel]])), []);
});

test('⑤ 资金分支禁 readCanvas：三个资金服务文件=红；其他文件不拦=绿', () => {
  for (const rel of Object.values(fundRels)) {
    assert.ok(scanFiles(mk([[rel, 'const snap = await this.collabDoc.readCanvas(pid);']]))
      .some((p) => p.includes('禁 readCanvas')), rel);
  }
  assert.deepEqual(scanFiles(mk([['apps/api/src/modules/canvas/canvas.service.ts', 'this.readCanvas(pid);']])), []);
});

test('⑥ findMany 自有键：where 缺 teamId=红；teamIdSnapshot 子串不满足自有键判定=仍红；含 teamId:=绿', () => {
  const missing = "prisma.teamCreditTransaction.findMany({ where: { referenceId: 'x' } });";
  const snapshot = "const teamIdSnapshot = 'x';\nprisma.teamCreditTransaction.findMany({ where: { status: 'RUNNING' } });";
  assert.ok(scanFiles(mk([['apps/api/src/modules/x/x.service.ts', missing]]))
    .some((p) => p.includes('findMany where 自有键缺 teamId')));
  assert.ok(scanFiles(mk([['apps/api/src/modules/x/x.service.ts', snapshot]]))
    .some((p) => p.includes('findMany where 自有键缺 teamId')));
  const ok = "prisma.teamCreditTransaction.findMany({ where: { teamId: id, referenceId: 'x' } });";
  assert.deepEqual(scanFiles(mk([['apps/api/src/modules/x/x.service.ts', ok]])), []);
});

test('⑦ 锁序静态锚（同函数内序）：private async 方法内 GI 写先于 lockBalance=红；反序=绿；跨方法不串=绿', () => {
  const bad = [
    'export class S {',
    '  private async refund(row: any) {',
    '    await tx.generationIntent.updateMany({ where: { id: 1 }, data: {} });',
    '    await this.ledger.lockBalance(tx, row.teamId);',
    '  }',
    '}',
  ].join('\n');
  assert.ok(scanFiles(mk([[fundRels.teamCredit, bad]]))
    .some((p) => p.includes('锁序违规')));
  const good = [
    'export class S {',
    '  private async refund(row: any) {',
    '    await this.ledger.lockBalance(tx, row.teamId);',
    '    await tx.generationIntent.updateMany({ where: { id: 1 }, data: {} });',
    '  }',
    '  private async sweep() {',
    '    await tx.generationIntent.deleteMany({ where: { status: "VOIDED" } });', // 本函数无 lock——不参与比较
    '  }',
    '}',
  ].join('\n');
  assert.deepEqual(scanFiles(mk([[fundRels.teamCredit, good]])), []);
});
