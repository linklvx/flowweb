// apps/api/src/modules/execution/sv-admission.int.spec.ts —— Y0b-2 T7 红用例（真库）
// SV 支配准入门（spec §2.6①——钱的门权威，移四受理端点 claim 之前）：
// ①改 prompt 立即 execute 携编辑后当前 SV → SYNC_PENDING 零外呼零冻结零 intent 行
// ②编辑已上行（server doc 含客户端 update）→ 放行（真 claim/外呼照常）
// ③改上游执行下游 → SYNC_PENDING（SV 是 doc 全局量——下游执行也拦）
// ④enqueue 门在 controller（拒时零入队）+ job.data 零 SV 断言（载荷零客户端状态）
// ⑤缺 stateVector → 400 SYNC_STATE_VECTOR_REQUIRED（fail-closed——缺省静默放行是垫片，第四轮 P1）。
// 装置：ExecutionService 直构（funds-four-way 形态——collab 面记录器 stub）+ 真 DB claim/ledger；
// serverDoc/clientDoc 真 Y.Doc 对（readServerSV stub 读 serverDoc——SV 支配判定走真 sv.util 语义）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ExecutionController } from './execution.controller';
import { ExecutionService } from './execution.service';
import { GenerationIntentService } from './generation-intent.service';
import { TopologyService } from './topology.service';
import { ValidationService } from './validation.service';
import { ApiCallerService } from './api-caller.service';
import { PricingResolverService } from './pricing-resolver.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { TeamCreditService } from '../team/team-credit.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { ledgerWipe, deleteTeamsWithPass } from '../../test-utils/intent-fixture';

// 无 DATABASE_URL（CI 未起库）自动 skip
const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();
const ledger = new CreditLedgerService(prisma as unknown as PrismaService);
const teamCredit = new TeamCreditService(prisma as unknown as PrismaService, ledger);
const intentSvc = new GenerationIntentService(prisma as unknown as PrismaService);
const resolver = new PricingResolverService(prisma as unknown as PrismaService);
const validation = new ValidationService(prisma as unknown as PrismaService, resolver);
const perm = new ProjectPermissionService(prisma as unknown as PrismaService);

const UID = `int-sv-owner-${Date.now()}`;
const PID = `int-sv-${Date.now()}`;
let TID = '';

/** 服务端 doc（readServerSV stub 读源）与客户端 doc（构造客户端 SV——两 doc 独立推进） */
const serverDoc = new Y.Doc();
const clientDoc = new Y.Doc();
const svB64 = (doc: Y.Doc) => Buffer.from(Y.encodeStateVector(doc)).toString('base64');

/** 夹具节点（funds-four-way 同款——真 seed 规则键：text=kimi） */
const textNode = (id: string) => ({ id, type: 'textInput', data: { model: 'seed-model-kimi' } });

/** 客户端本地编辑（推进客户端 SV clock——服务端未见） */
function clientEdit(nodeId: string, content: string) {
  const n = new Y.Map();
  n.set('type', 'textInput');
  n.set('data', new Y.Map(Object.entries({ model: 'seed-model-kimi', content })));
  clientDoc.getMap('nodes').set(nodeId, n);
}

/** 客户端编辑上行（update 到达服务端 doc——SV 支配成立） */
function uploadToServer() {
  Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(clientDoc));
}

let apiCaller: ApiCallerService;
let queueAdd: ReturnType<typeof vi.fn>;

function makeController(nodes: any[]): ExecutionController {
  apiCaller = new ApiCallerService(prisma as unknown as PrismaService);
  vi.spyOn(apiCaller, 'callTextGen').mockResolvedValue({ content: '文本结果' } as any);
  const collabDoc: any = {
    readCanvas: async () => ({ nodes, edges: [] }),
    readServerSV: async () => Y.encodeStateVector(serverDoc),   // T7：SV 门唯一服务端读点
    isLeaseServing: () => true,
    writeNodeData: vi.fn(async () => ({ written: true })),
    writeExecStatus: vi.fn(async () => {}),
  };
  const svc = new ExecutionService(
    prisma as unknown as PrismaService,
    new TopologyService(),
    validation,
    apiCaller,
    teamCredit,
    perm,
    collabDoc,
    { emitNodeStatus: vi.fn() } as any,
    { add: vi.fn() } as any,
    intentSvc,
  );
  queueAdd = vi.fn(async () => ({ id: 'job-sv-1' }));
  // collabDoc 第 5 参=T7 门依赖（readServerSV）——controller 直构同 app 装配形态
  return new ExecutionController(svc, perm, { add: queueAdd } as any, intentSvc, collabDoc);
}

const intentCount = (nodeId?: string) =>
  prisma.generationIntent.count({ where: { projectId: PID, ...(nodeId ? { nodeId } : {}) } });
const reserveCount = () => prisma.teamCreditTransaction.count({ where: { teamId: TID, type: 'reserve' } });

(hasDb ? describe : describe.skip)('Y0b-2 T7：SV 支配准入门（受理端点 claim 之前，真库）', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: UID },
      create: { id: UID, name: 'int-sv-owner', email: `${UID}@test.local`, emailVerified: false },
      update: {},
    });
    const team = await prisma.team.create({ data: { name: 'int-sv-team', ownerId: UID } });
    TID = team.id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER' } });
    await ledger.runInTx((tx) => ledger.ensureBalance(tx, TID));
    await ledger.runInTx((tx) => ledger.mutate(tx, {
      teamId: TID, operatorUserId: UID, type: 'register_grant', creditType: 'regular',
      balanceDelta: 200, frozenDelta: 0, referenceId: `it-sv-fund-${Date.now()}`,
    }));
    await prisma.canvasProject.create({ data: { id: PID, name: 'int-sv', userId: UID, teamId: TID } });
  }, 20_000);

  afterAll(async () => {
    await prisma.generationIntent.deleteMany({ where: { projectId: PID } });
    await prisma.canvasProject.deleteMany({ where: { id: PID } });
    await ledgerWipe(ledger, { teamId: TID });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID]);
    await prisma.user.deleteMany({ where: { id: UID } });
    await prisma.$disconnect();
  }, 20_000);

  it('①改 prompt 立即 execute 携编辑后当前 SV → 409 SYNC_PENDING：零外呼零冻结零 intent 行（claim 之前拦截）', async () => {
    const n1 = textNode(`n1-${randomUUID().slice(0, 6)}`);
    const controller = makeController([n1]);
    clientEdit(n1.id, '改完立刻执行');   // 客户端 SV 领先——服务端 doc 未见
    const err = await controller.execute(
      { projectId: PID, nodeId: n1.id, stateVector: svB64(clientDoc) } as any,
      { user: { id: UID } } as any,
    ).catch((e: unknown) => e);
    expect(err).toMatchObject({ errorCode: 'SYNC_PENDING' });
    expect((err as any).getStatus()).toBe(409);
    expect(apiCaller.callTextGen).not.toHaveBeenCalled();   // 零外呼
    expect(await reserveCount()).toBe(0);                   // 零冻结（无 reserve 行）
    expect(await intentCount(n1.id)).toBe(0);               // 零意图行（不烧 attempts）
  });

  it('②编辑已上行 → 放行：真 claim/外呼/settle 照常（intent 行落地+产物交付）', async () => {
    const n2 = textNode(`n2-${randomUUID().slice(0, 6)}`);
    const controller = makeController([n2]);
    clientEdit(n2.id, '已同步内容');
    uploadToServer();                                        // update 到达服务端 doc
    const r = await controller.execute(
      { projectId: PID, nodeId: n2.id, stateVector: svB64(clientDoc) } as any,
      { user: { id: UID } } as any,
    );
    expect(r.success).toBe(true);
    expect(apiCaller.callTextGen).toHaveBeenCalledTimes(1);
    expect(await intentCount(n2.id)).toBe(1);
  });

  it('③改上游执行下游 → SYNC_PENDING（SV 是 doc 全局量——非执行节点的未同步编辑同拦）', async () => {
    const up = textNode(`up-${randomUUID().slice(0, 6)}`);
    const down = textNode(`down-${randomUUID().slice(0, 6)}`);
    const controller = makeController([up, down]);
    clientEdit(up.id, '上游刚改');                           // 编辑的是上游——执行的是下游
    const err = await controller.execute(
      { projectId: PID, nodeIds: [down.id], stateVector: svB64(clientDoc) } as any,
      { user: { id: UID } } as any,
    ).catch((e: unknown) => e);
    expect(err).toMatchObject({ errorCode: 'SYNC_PENDING' });
    expect(await intentCount(down.id)).toBe(0);
  });

  it('④enqueue：门在 controller（拒时零入队）；放行时 job.data 零 SV 断言（载荷零客户端状态）', async () => {
    const n3 = textNode(`n3-${randomUUID().slice(0, 6)}`);
    const controller = makeController([n3]);
    clientEdit(n3.id, 'enqueue 未同步');
    await expect(controller.enqueue(
      { projectId: PID, nodeId: n3.id, stateVector: svB64(clientDoc) } as any,
      { user: { id: UID } } as any,
    )).rejects.toMatchObject({ errorCode: 'SYNC_PENDING' });
    expect(queueAdd).not.toHaveBeenCalled();                 // 门在 controller——拒时零入队

    uploadToServer();
    const r = await controller.enqueue(
      { projectId: PID, nodeId: n3.id, stateVector: svB64(clientDoc) } as any,
      { user: { id: UID } } as any,
    );
    expect(r.status).toBe('queued');
    expect(queueAdd).toHaveBeenCalledTimes(1);
    const payload = queueAdd.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('sv');                // 载荷零 SV（sv 全链退役）
    expect(payload).not.toHaveProperty('stateVector');       // SV 判定不入队——受理时已毕
  });

  it('⑤缺 stateVector → 400 SYNC_STATE_VECTOR_REQUIRED（fail-closed）', async () => {
    const n4 = textNode(`n4-${randomUUID().slice(0, 6)}`);
    const controller = makeController([n4]);
    const err = await controller.execute(
      { projectId: PID, nodeId: n4.id } as any,
      { user: { id: UID } } as any,
    ).catch((e: unknown) => e);
    expect(err).toMatchObject({ errorCode: 'SYNC_STATE_VECTOR_REQUIRED' });
    expect((err as any).getStatus()).toBe(400);
    expect(await intentCount(n4.id)).toBe(0);
  });
});
