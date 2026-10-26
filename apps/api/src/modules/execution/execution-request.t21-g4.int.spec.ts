// apps/api/src/modules/execution/execution-request.t21-g4.int.spec.ts
// Y1c T21（G4 门先红①②③④⑤⑦——真 PG）：ExecutionRequest 受理冻结七红例的真库组。
// 红前置：本套件先于 ExecutionRequestService 实现空转跑=模块缺失红；实现后逐例转绿。
// G4-⑥（frozenDocSeq 竞态）=actor 单元面（collab-project-actor.t21-freeze.spec——临界区语义
// 无 PG 依赖）；本组受理路径走 PG 前缀重建档（int 上下文无常驻 doc——MVCC 一致前缀语义等价：
// frozenDocSeq=hydration pgSeq）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { fillDoc, CANVAS_DOC_SCHEMA_VERSION } from '@flowweb/shared';
import { toDocLike } from '../collab/doc-like.util';
import { PrismaService } from '../../prisma/prisma.service';
import { ExecutionRequestService } from './execution-request.service';
import { ValidationService } from './validation.service';
import { TopologyService } from './topology.service';
import { TeamCreditService } from '../team/team-credit.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { ledgerWipe } from '../../test-utils/intent-fixture';
import { PricingResolverService } from './pricing-resolver.service';
import { CanvasDocUpdateRepository } from '../collab/canvas-doc-update.repository';
import { deleteTeamsWithPass } from '../../test-utils/intent-fixture';

const hasDb = !!process.env.DATABASE_URL;
const prisma = new PrismaClient();
const PID = 'int-t21-g4';
const UID = 'int-t21-g4-owner';
const REQ = (s: string) => `int-t21-req-${s}`;

// 装置：无 actor（doc 非常驻）→ 受理走 PG 前缀重建档（frozenDocSeq=hydration pgSeq——MVCC 一致前缀）
const ledger = new CreditLedgerService(prisma as unknown as PrismaService);
const svc = new ExecutionRequestService(
  prisma as unknown as PrismaService,
  new ValidationService(prisma as unknown as PrismaService, new PricingResolverService(prisma as unknown as PrismaService)),
  new TopologyService(),
  new TeamCreditService(prisma as unknown as PrismaService, new CreditLedgerService(prisma as unknown as PrismaService)),
  null as never,   // actor 缺席=PG 重建档（G4-⑥ 临界区在 actor 单元面锁——T21 受理缝 null 容忍）
  new CanvasDocUpdateRepository(prisma as unknown as PrismaService),
);

let TID = '';
/** 定价可解析的节点 data（resolveExact 精确键：modelId+resolutionId+durationId 随 rule 形态） */
let ND: Record<string, unknown> = {};

/** 服务端 doc 真值载体（种子+变更帧同 clientID——同 client 后写必胜，跨 client CRDT 并发插值
 *  由 clientID 决胜负不保证胜出——测试变更帧确定性前提）。 */
let serverDoc: Y.Doc;
function fillBaseline(doc: Y.Doc): void {
  fillDoc(toDocLike(doc), [
    // textInput.prompt=Y.Map{text:Y.Text} 域（T15 终形）——resolvePromptText 读 {text} 腿
    { id: 'n1', type: 'textInput', data: { ...ND, prompt: { text: 'frozen-prompt-甲-n1' } } },
    { id: 'n2', type: 'textInput', data: { ...ND, prompt: { text: 'frozen-prompt-乙-n2' } } },
  ], [{ id: 'e1', source: 'n1', target: 'n2' }]);
}

async function seedDocPrefix(doc: Y.Doc) {
  const state = Buffer.from(Y.encodeStateAsUpdate(doc));
  await prisma.canvasDocSnapshot.upsert({
    where: { projectId_generation_snapshotRev: { projectId: PID, generation: 0, snapshotRev: 0n } },
    create: { projectId: PID, generation: 0, snapshotRev: 0n, stateSeq: 0n, state, stateHash: '0'.repeat(64), vacuumEpoch: 0, schemaVersion: CANVAS_DOC_SCHEMA_VERSION },
    update: { state },
  });
  await prisma.canvasDoc.upsert({
    where: { projectId: PID },
    create: { projectId: PID, generation: 0, pgSeq: 0n, walCheckpointSeq: 0n, currentSnapshotRev: 0n },
    update: { pgSeq: 0n, walCheckpointSeq: 0n, currentSnapshotRev: 0n },
  });
}

/** 基线复位（逐用例独立前提：回填 n1/n2 原值——同 client 后写必胜）+帧推进。 */
async function restoreBaseline() {
  await appendPrefixFrame(serverDoc, () => fillBaseline(serverDoc));
}

/** 受理后变更帧（模拟用户编辑落 PG——受理面之外的前缀推进）。 */
async function appendPrefixFrame(live: Y.Doc, mutator: (d: Y.Doc) => void) {
  mutator(live);
  const update = Buffer.from(Y.encodeStateAsUpdate(live));
  const head = await prisma.canvasDoc.findUnique({ where: { projectId: PID }, select: { pgSeq: true } });
  const seq = (head?.pgSeq ?? 0n) + 1n;
  await prisma.canvasDocUpdate.create({ data: {
    projectId: PID, generation: 0, seq, firstWalSeq: seq, frameCount: 1,
    updateHash: randomUUID().replace(/-/g, ''), update,
  } });
  await prisma.canvasDoc.update({ where: { projectId: PID }, data: { pgSeq: seq, walCheckpointSeq: seq } });
}

/** 改写 textInput.prompt 初值（Y.Text insert——T15 域容器写形态）。 */
const mutatePrompt = (nodeId: string, insert: string) => (d: Y.Doc) => {
  const node = d.getMap('nodes').get(nodeId) as Y.Map<unknown>;
  const data = node.get('data') as Y.Map<unknown>;
  const prompt = data.get('prompt') as Y.Map<unknown>;
  (prompt.get('text') as Y.Text).insert(0, insert);
};
const deleteNode = (nodeId: string) => (d: Y.Doc) => { (d.getMap('nodes') as Y.Map<unknown>).delete(nodeId); };

async function balanceCredits(): Promise<number> {
  const b = await prisma.teamBalance.findUnique({ where: { teamId: TID } });
  return b?.credits ?? 0;
}

async function expectNoRows(requestId: string) {
  const req = await prisma.executionRequest.findUnique({ where: { projectId_requestId: { projectId: PID, requestId } } });
  expect(req, `requestId=${requestId} 不得落父行（不落半行）`).toBeNull();
  const plans = await prisma.executionNodePlan.count({ where: { requestId: req?.id ?? 'none' } });
  expect(plans).toBe(0);
  const inputs = await prisma.executionInput.count({ where: { requestId: req?.id ?? 'none' } });
  expect(inputs).toBe(0);
  const audits = await prisma.docAuditEvent.count({ where: { projectId: PID, requestId } });
  expect(audits).toBe(0);
}

const admit = (s: string, nodeIds: string[], docSeq = 0n) =>
  svc.admit({ projectId: PID, requestId: REQ(s), nodeIds, docSeq, userId: UID });

(hasDb ? describe : describe.skip)('Y1c T21 G4：ExecutionRequest 受理冻结（真 PG——红①②③④⑤⑦⑧）', () => {
  beforeAll(async () => {
    await prisma.executionRequest.deleteMany({ where: { projectId: PID } });
    await prisma.user.upsert({
      where: { id: UID },
      create: { id: UID, name: UID, email: `${UID}@test.local`, emailVerified: false },
      update: {},
    });
    const team = await prisma.team.create({ data: { name: 'int-t21-g4-team', ownerId: UID } });
    TID = team.id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER' } });
    // 钱包唯一口：ensureBalance+register_grant 500（TeamBalance 直写被 ledger_guard 触发器拦——真链注资）
    await ledger.runInTx((tx) => ledger.ensureBalance(tx, TID));
    await ledger.runInTx((tx) => ledger.mutate(tx, {
      teamId: TID, operatorUserId: UID, type: 'register_grant', creditType: 'regular',
      balanceDelta: 500, frozenDelta: 0, referenceId: `int-t21-fund-${Date.now()}`,
    }));
    // 定价可解析键：active 规则（modelId 非空）→ 节点 data 携带 model+已声明维度行 id（resolveExact 精确键）
    // 定价键取 executable 模型规则（validation MODEL_NOT_AVAILABLE 谓词=provider 适配器在册——
    // 最廉价规则可能是无适配器种子模型，须滤 model.active+apiModelName）
    const rule = await prisma.pricingRule.findFirst({
      where: { active: true, creditCost: { gt: 0 }, model: { active: true, apiModelName: { not: null } } },   // creditCost>0 防全局 0 成本测试规则污染夹具
      orderBy: { creditCost: 'asc' },
    });
    if (!rule) throw new Error('真库无 active PricingRule（executable 模型）');
    ND = {
      model: rule.modelId!,
      ...(rule.resolutionId ? { resolution: rule.resolutionId } : {}),
      ...(rule.durationId ? { duration: rule.durationId } : {}),
    };
    await prisma.canvasProject.create({ data: { id: PID, name: 'int-t21-g4', teamId: TID, userId: UID } });
    await prisma.projectMember.create({ data: { projectId: PID, userId: UID, role: 'PROJECT_OWNER' } });
    serverDoc = new Y.Doc();
    fillBaseline(serverDoc);
    await seedDocPrefix(serverDoc);
  });

  afterAll(async () => {
    await prisma.executionRequest.deleteMany({ where: { projectId: PID } });
    await prisma.executionInput.deleteMany({ where: { requestId: { startsWith: 'int' } } });
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDocSnapshot.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    await prisma.docAuditEvent.deleteMany({ where: { projectId: PID } });
    await prisma.projectMember.deleteMany({ where: { projectId: PID } });
    await prisma.canvasProject.deleteMany({ where: { id: PID } });
    await ledgerWipe(ledger, { teamId: TID });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID]);
    await prisma.user.deleteMany({ where: { id: UID } });
    serverDoc.destroy();
    await prisma.$disconnect();
  });

  it('红①：受理后改 prompt/删节点（前缀推进）→冻结计划不变（重放用例——执行读=子行+ExecutionInput）', async () => {
    const a = await admit('c1', ['n1', 'n2']);
    expect(a.ok).toBe(true);
    if (!a.ok) return;

    // 受理后变更：n1 prompt 改写+n2 删除（两帧前缀推进）
    await appendPrefixFrame(serverDoc, mutatePrompt('n1', 'MUTATED-after-admission'));
    await appendPrefixFrame(serverDoc, deleteNode('n2'));

    const frozen = await svc.loadForExecution(PID, REQ('c1'));
    expect(frozen).not.toBeNull();
    if (!frozen) return;
    // 冻结计划仍两行+受理时刻 prompt（服务端从受理时 PG 前缀恢复 doc 冻结——请求无 prompt 参数）
    expect(frozen.plans.map((p) => p.nodeId).sort()).toEqual(['n1', 'n2']);
    expect(frozen.input.nodes['n1']!.promptText).toBe('frozen-prompt-甲-n1');   // ≠MUTATED-after-admissionfrozen-...
    expect(frozen.input.nodes['n2']!.promptText).toBe('frozen-prompt-乙-n2');
    expect(frozen.request.planHash).toBe(a.planHash);
    expect(frozen.request.frozenDocSeq).toBe(0n);   // 受理时刻前缀（后续 2 帧不进冻结面）
    // 真库侧证：前缀确实推进了（pgSeq=2——受理后的变更真实发生，非测试未写进）
    const head = await prisma.canvasDoc.findUnique({ where: { projectId: PID }, select: { pgSeq: true } });
    expect(head?.pgSeq).toBe(2n);
  });

  it('红②：paramsHash/planHash 重放一致（同前缀两受理同哈希；prompt 变更后哈希漂移——敏感性）', async () => {
    const a1 = await admit('c2a', ['n1']);
    const a2 = await admit('c2b', ['n1']);
    expect(a1.ok && a2.ok).toBe(true);
    if (!a1.ok || !a2.ok) return;
    expect(a1.planHash).toBe(a2.planHash);   // 重放一致（canonical 确定性）
    expect(a1.inputHash).toBe(a2.inputHash);

    await restoreBaseline();
    await appendPrefixFrame(serverDoc, mutatePrompt('n1', 'CHANGED-prompt'));
    const a3 = await admit('c2c', ['n1']);
    expect(a3.ok).toBe(true);
    if (a3.ok) expect(a3.planHash).not.toBe(a1.planHash);   // 哈希覆盖冻结输入（paramsHash 盖 prompt）——敏感性非摆设
  });

  it('红③：并发两请求互串=负控（A scope=n1/B scope=n2 并发受理——计划/输入严格分区不交叉）', async () => {
    await restoreBaseline();
    const [ra, rb] = await Promise.all([admit('c3a', ['n1']), admit('c3b', ['n2'])]);
    expect(ra.ok && rb.ok).toBe(true);
    if (!ra.ok || !rb.ok) return;
    const fa = await svc.loadForExecution(PID, REQ('c3a'));
    const fb = await svc.loadForExecution(PID, REQ('c3b'));
    expect(fa?.plans.map((p) => p.nodeId)).toEqual(['n1']);
    expect(fb?.plans.map((p) => p.nodeId)).toEqual(['n2']);
    expect(Object.keys(fa?.input.nodes ?? {})).toEqual(['n1']);
    expect(Object.keys(fb?.input.nodes ?? {})).toEqual(['n2']);
    expect(fa?.input.nodes['n1']?.promptText).toBe('frozen-prompt-甲-n1');
    expect(fb?.input.nodes['n2']?.promptText).toBe('frozen-prompt-乙-n2');
  });

  it('红④：前缀校验失败（nodeId 不在冻结前缀）→4xx 且零半行（request/plan/input/audit 全空+资金零动）', async () => {
    const bal = await balanceCredits();
    const r = await admit('c4', ['n1', 'ghost-node']);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
    expect(r.code).toBe('UNKNOWN_NODE_IDS');
    await expectNoRows(REQ('c4'));
    expect(await balanceCredits()).toBe(bal);   // 资金零动（校验失败不预留）
  });

  it('红⑤：同 requestId 断线重试=幂等返回原 frozenDocSeq（零二次执行行+零二次预留）；同键异 body=409', async () => {
    await restoreBaseline();
    const first = await admit('c5', ['n1']);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const balAfterFirst = await balanceCredits();
    const rowsAfterFirst = await prisma.executionRequest.count({ where: { projectId: PID, requestId: REQ('c5') } });

    const retry = await admit('c5', ['n1']);
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.replayed).toBe(true);                       // 幂等重放档
    expect(retry.frozenDocSeq).toBe(first.frozenDocSeq);     // 原冻结值
    expect(retry.planHash).toBe(first.planHash);
    expect(await prisma.executionRequest.count({ where: { projectId: PID, requestId: REQ('c5') } })).toBe(rowsAfterFirst);
    expect(await balanceCredits()).toBe(balAfterFirst);      // 零二次预留

    const conflict = await admit('c5', ['n1', 'n2']);        // 同键不同 body（nodeIds 变化→planHash 不同）
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(conflict.status).toBe(409);
      expect(conflict.code).toBe('IDEMPOTENCY_CONFLICT');
    }
  });

  it('红⑦：ExecutionInput 超限（prompt>256KiB）→413 且零半行（不截断不分片——列超限 nodeId 不落请求）', async () => {
    const bal = await balanceCredits();
    await appendPrefixFrame(serverDoc, () => {
      const node = serverDoc.getMap('nodes').get('n1') as Y.Map<unknown>;
      const data = node.get('data') as Y.Map<unknown>;
      const prompt = data.get('prompt') as Y.Map<unknown>;
      (prompt.get('text') as Y.Text).insert(0, 'X'.repeat(256 * 1024 + 1));   // Y.Text 灌 256KiB+1
    });
    const r = await admit('c7', ['n1']);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(413);
    expect(r.code).toBe('PROMPT_TOO_LARGE');
    await expectNoRows(REQ('c7'));
    expect(await balanceCredits()).toBe(bal);
  });

  it('红⑧（资金 sweeper——per-item 预留续章）：过期未 claim→sweepExpired 逐 item void+state=VOIDED+余额还原', async () => {
    await restoreBaseline();
    const before = await balanceCredits();
    const a = await admit('c8', ['n1', 'n2']);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.reservedCredit).toBeGreaterThan(0);
    expect(await balanceCredits()).toBe(before - a.reservedCredit);   // 预留实扣（冻结池）

    await prisma.executionRequest.update({
      where: { projectId_requestId: { projectId: PID, requestId: REQ('c8') } },
      data: { expiresAt: new Date(Date.now() - 1) },   // 人工拨过期
    });
    const swept = await svc.sweepExpired();
    expect(swept).toBeGreaterThanOrEqual(1);
    const row = await prisma.executionRequest.findUnique({ where: { projectId_requestId: { projectId: PID, requestId: REQ('c8') } } });
    expect(row?.state).toBe('VOIDED');
    expect(row?.reservedCredit).toBe(0);
    const plans = await prisma.executionNodePlan.findMany({ where: { requestId: a.id } });
    expect(plans.every((p) => p.reservedCredit === 0)).toBe(true);   // 逐 item void
    expect(await balanceCredits()).toBe(before);   // 余额还原（release 台账）
  });
});

// Prisma 命名空间引用（防 tree-shake 误报——afterAll 清理用）
void Prisma;
