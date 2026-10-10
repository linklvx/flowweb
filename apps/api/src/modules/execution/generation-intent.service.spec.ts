import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service';
import {
  GenerationIntentService,
  NodeBusyError,
  IntentExhaustedError,
} from './generation-intent.service';
import { deriveIdemKey, normalizeRegenToken as normalizeRegenTokenImport } from './intent-key.util';

/** 构造一行 GenerationIntent（默认值=RUNNING 在飞，覆盖式调整；Y0b-2 T1：idemKey/heartbeatAt/deadlineAt/gestureKey 新列） */
const row = (over: Record<string, unknown> = {}) => ({
  id: 'gi-1',
  projectId: 'p1',
  nodeId: 'n1',
  userId: 'u1',
  teamId: 'team-1',
  intentId: 'row-uuid-1',
  idemKey: deriveIdemKey({ projectId: 'p1', nodeId: 'n1', kind: 'image', paramsHash: 'h1' }),
  gestureKey: null,
  kind: 'image',
  paramsHash: 'h1',
  status: 'RUNNING',
  jobId: null,
  heartbeatAt: new Date(),
  deadlineAt: new Date(Date.now() + 90_000),
  startedAt: null,
  providerTaskId: null,
  pricingRuleId: 'pr1',
  modelId: 'm1',
  resolutionId: null,
  durationId: null,
  creditCost: 1,
  creditsConsumed: 0,
  attempts: 1,
  resultRef: null,
  error: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  completedAt: null,
  ...over,
});

/** claim 输入（默认与 row 同上下文；Y0b-2：gestureToken 替代 intentId 入参——行身份由 claim 铸造） */
const input = (over: Record<string, unknown> = {}) => ({
  projectId: 'p1',
  nodeId: 'n1',
  userId: 'u1',
  kind: 'image',
  paramsHash: 'h1',
  teamId: 'team-1',
  pricing: { pricingRuleId: 'pr1', modelId: 'm1', resolutionId: null, durationId: null, creditCost: 1 },
  ...over,
});

describe('GenerationIntentService claim 状态机（F13→Y0b-2 Z82 idemKey 化）', () => {
  let service: GenerationIntentService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      generationIntent: {
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        createMany: vi.fn(),
        updateMany: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
      },
      // Y0b-1（Z26/Z33）：claim 交互式事务——mock 直通（tx=同一 mock 对象）
      $transaction: vi.fn((fn: (tx: any) => Promise<unknown>) => fn(prisma)),
      // Z26 准入谓词：FOR SHARE 查 Team.status——默认 ACTIVE 放行
      $queryRaw: vi.fn().mockResolvedValue([{ status: 'ACTIVE' }]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GenerationIntentService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(GenerationIntentService);
  });

  describe('Y0b-2 T1（Z82/Z109）：idemKey 判据+三列写入', () => {
    it('E1+Z82：无 token claim → createMany data 带 idemKey（内容键）+intentId（铸造 UUID）+heartbeatAt/deadlineAt/gestureKey:null+五字段快照', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue(null);
      prisma.generationIntent.createMany.mockResolvedValue({ count: 1 });
      const created = row({ creditCost: 0, pricingRuleId: 'pr1', modelId: 'm1' });
      prisma.generationIntent.findUniqueOrThrow.mockResolvedValue(created);

      const r = await service.claim(input({ pricing: { pricingRuleId: 'pr1', modelId: 'm1', resolutionId: null, durationId: null, creditCost: 0 } }));

      expect(r.created).toBe(true);
      expect(r.intent).toBe(created);
      const arg = prisma.generationIntent.createMany.mock.calls[0][0];
      expect(arg.skipDuplicates).toBe(true);
      expect(arg.data[0].idemKey).toBe(deriveIdemKey({ projectId: 'p1', nodeId: 'n1', kind: 'image', paramsHash: 'h1' })); // 无 token=内容键（'run' 末段）
      expect(arg.data[0].intentId).toMatch(/^[0-9a-f-]{36}$/); // 行身份=服务端铸造
      expect(arg.data[0].gestureKey).toBeNull();
      expect(arg.data[0].heartbeatAt).toBeInstanceOf(Date);
      expect(arg.data[0].deadlineAt).toBeInstanceOf(Date);
      expect(arg.data[0].deadlineAt.getTime()).toBeGreaterThan(Date.now());
      expect(arg.data[0].creditCost).toBe(0); // 无条件固化——creditCost:0 也不例外（E1/A2）
      // 判据键=findUnique({where:{idemKey}})（Z82——复合 projectId_intentId 判据退役）
      expect(prisma.generationIntent.findUnique).toHaveBeenCalledWith({ where: { idemKey: arg.data[0].idemKey } });
    });

    it('Z109：gestureToken 入参 → idemKey 末段 regen:<token>+gestureKey 落库（客户端原始 token 位）', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue(null);
      prisma.generationIntent.createMany.mockResolvedValue({ count: 1 });
      prisma.generationIntent.findUniqueOrThrow.mockResolvedValue(row());

      await service.claim(input({ gestureToken: 'held-token-1' }));

      const arg = prisma.generationIntent.createMany.mock.calls[0][0];
      expect(arg.data[0].idemKey).toBe(deriveIdemKey({ projectId: 'p1', nodeId: 'n1', kind: 'image', paramsHash: 'h1', regenToken: 'held-token-1' }));
      expect(arg.data[0].idemKey).not.toBe(deriveIdemKey({ projectId: 'p1', nodeId: 'n1', kind: 'image', paramsHash: 'h1' })); // token 位真实参与
      expect(arg.data[0].gestureKey).toBe('held-token-1');
    });

    it('Z79→T6 转严格：超长 token（65 位）⇒ 400 IDEMPOTENCY_TOKEN_INVALID（截断+warn 过渡退役——禁静默截断）', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue(null);
      await expect(service.claim(input({ gestureToken: 'x'.repeat(65) }))).rejects.toMatchObject({
        errorCode: 'IDEMPOTENCY_TOKEN_INVALID',
        status: HttpStatus.BAD_REQUEST,
      });
      expect(prisma.generationIntent.createMany).not.toHaveBeenCalled(); // 零新行零外呼面
    });

    it('pricing 缺省 ⇒ 编译期即拒（必填参数——无条件固化由类型保证非运行时约定）', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue(null);
      prisma.generationIntent.createMany.mockResolvedValue({ count: 1 });
      prisma.generationIntent.findUniqueOrThrow.mockResolvedValue(row());
      await expect(
        // @ts-expect-error pricing 必填——缺省即类型错误（tsc --noEmit 红相=本用例红相）
        service.claim({ projectId: 'p1', nodeId: 'n1', userId: 'u1', kind: 'image', paramsHash: 'h1', teamId: 'team-1' }),
      ).rejects.toThrow(); // 运行时：pricing undefined → 固化字段访问 TypeError → 拒绝（无静默免费路径）
    });

    it('Z26：团队非 ACTIVE（FOR SHARE 谓词）⇒ TEAM_CLOSED 409——零意图行写入', async () => {
      prisma.$queryRaw.mockResolvedValue([{ status: 'DISBANDED' }]);
      await expect(service.claim(input())).rejects.toMatchObject({
        errorCode: 'TEAM_CLOSED',
        status: HttpStatus.CONFLICT,
      });
      expect(prisma.generationIntent.createMany).not.toHaveBeenCalled();
    });
  });

  describe('① 无行 → create RUNNING = 新执行权', () => {
    it('findUnique 空 → createMany RUNNING（skipDuplicates）→ created:true', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue(null);
      prisma.generationIntent.createMany.mockResolvedValue({ count: 1 });
      const created = row({ id: 'gi-new' });
      prisma.generationIntent.findUniqueOrThrow.mockResolvedValue(created);

      const r = await service.claim(input());

      expect(r.created).toBe(true);
      expect(r.intent).toBe(created);
      expect(prisma.generationIntent.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({
          projectId: 'p1', nodeId: 'n1', userId: 'u1',
          kind: 'image', paramsHash: 'h1', jobId: null, status: 'RUNNING', teamId: 'team-1',
        })],
        skipDuplicates: true,
      });
    });

    it('带 jobId → createMany data 写入 jobId', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue(null);
      prisma.generationIntent.createMany.mockResolvedValue({ count: 1 });
      prisma.generationIntent.findUniqueOrThrow.mockResolvedValue(row({ jobId: 'job-9' }));

      await service.claim(input({ jobId: 'job-9' }));

      expect(prisma.generationIntent.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ jobId: 'job-9', status: 'RUNNING' })],
        skipDuplicates: true,
      });
    });
  });

  describe('② RUNNING 同 jobId → 可重入续跑（stalled 重排不自锁）', () => {
    it('input.jobId 与 existing.jobId 相等 → created:true + 重锚（Y0b-2 T4：新执行段刷新 heartbeat/deadline，不刷则重排任务被 deadline 批误收）', async () => {
      const existing = row({ status: 'RUNNING', jobId: 'job-1' });
      prisma.generationIntent.findUnique
        .mockResolvedValueOnce(existing) // claim 首查
        .mockResolvedValueOnce(existing); // 重锚后回读
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 1 });

      const r = await service.claim(input({ jobId: 'job-1' }));

      expect(r.created).toBe(true);
      expect(prisma.generationIntent.create).not.toHaveBeenCalled();
      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: existing.id, status: 'RUNNING', jobId: 'job-1' },
        data: { resultRef: null, heartbeatAt: expect.any(Date), deadlineAt: expect.any(Date) }, // Y0b-2 T5：清 resultRef 保留 providerTaskId
      });
    });
  });

  describe('③ RUNNING 异 jobId → NodeBusy（双击互斥——Y0b-2 T6 起由⓪ 前置闸拦截）', () => {
    it('异 jobId → NODE_BUSY 409', async () => {
      // Y0b-2 T6（Z94）：⓪ 前置索引查命中在飞行（异 jobId）——不再等到 createMany 分义
      prisma.generationIntent.findFirst.mockResolvedValue(row({ status: 'RUNNING', jobId: 'job-1' }));

      await expect(service.claim(input({ jobId: 'job-2' }))).rejects.toMatchObject({
        errorCode: 'NODE_BUSY',
        status: HttpStatus.CONFLICT,
      });
      await expect(service.claim(input({ jobId: 'job-2' }))).rejects.toBeInstanceOf(NodeBusyError);
    });

    it('无 jobId（同步路径双击）→ NODE_BUSY 默认文案', async () => {
      prisma.generationIntent.findFirst.mockResolvedValue(row({ status: 'RUNNING', jobId: null }));

      await expect(service.claim(input())).rejects.toMatchObject({
        errorCode: 'NODE_BUSY',
        message: '该节点正在生成中',
      });
    });

    it('heartbeatAt 龄 >10min（同步孤儿）→ 回收窗口文案分义（Y0b-2 T4 判据单源——外呼 tick 刷心跳不刷 updatedAt）', async () => {
      prisma.generationIntent.findFirst.mockResolvedValue(
        row({ status: 'RUNNING', jobId: null, heartbeatAt: new Date(Date.now() - 11 * 60_000) }),
      );

      await expect(service.claim(input())).rejects.toMatchObject({
        errorCode: 'NODE_BUSY',
        message: '系统回收中（约 15 分钟），请稍后重试',
      });
    });
  });

  describe('④ FAILED/VOIDED → 守卫式原子再激活', () => {
    it.each([['FAILED'], ['VOIDED']])('%s 且 count===1 → created:true + attempts 自增+心跳/deadline 重置', async (status) => {
      const existing = row({ status, attempts: 1, jobId: 'job-old', error: 'x', completedAt: new Date() });
      prisma.generationIntent.findUnique
        .mockResolvedValueOnce(existing) // claim 首查
        .mockResolvedValueOnce(row({ status: 'RUNNING', attempts: 2, jobId: 'job-1', error: null, completedAt: null })); // rearm 后回读
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 1 });

      const r = await service.claim(input({ jobId: 'job-1' }));

      expect(r.created).toBe(true);
      expect(r.intent.attempts).toBe(2);
      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: existing.id, status: { in: ['FAILED', 'VOIDED'] } },
        data: {
          status: 'RUNNING',
          error: null,
          resultRef: null,   // Y0b-2 T5（Z83/Z95）：清 resultRef 保留 providerTaskId——重试 query-first
          jobId: 'job-1',
          completedAt: null,
          attempts: { increment: 1 },
          heartbeatAt: expect.any(Date),   // Z68：rearm 重置生命线
          deadlineAt: expect.any(Date),
        },
      });
    });

    it('并发抢走（count===0）→ NodeBusy', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue(row({ status: 'FAILED' }));
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.claim(input())).rejects.toMatchObject({ errorCode: 'NODE_BUSY' });
    });
  });

  describe('⑤ SUCCEEDED → created:false 幂等重放', () => {
    it('返回既有行（含 resultRef），零外呼零写库', async () => {
      const existing = row({ status: 'SUCCEEDED', resultRef: 'media-123' });
      prisma.generationIntent.findUnique.mockResolvedValue(existing);

      const r = await service.claim(input());

      expect(r.created).toBe(false);
      expect(r.intent.resultRef).toBe('media-123');
      expect(prisma.generationIntent.create).not.toHaveBeenCalled();
      expect(prisma.generationIntent.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('⑥ attempts≥3 的 FAILED/VOIDED → INTENT_EXHAUSTED', () => {
    it.each([['FAILED'], ['VOIDED']])('%s attempts=3 → 409 且不再激活', async (status) => {
      prisma.generationIntent.findUnique.mockResolvedValue(row({ status, attempts: 3 }));

      await expect(service.claim(input())).rejects.toBeInstanceOf(IntentExhaustedError);
      await expect(service.claim(input())).rejects.toMatchObject({
        errorCode: 'INTENT_EXHAUSTED',
        status: HttpStatus.CONFLICT,
      });
      expect(prisma.generationIntent.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('Y0b-2 T1：异上下文=异 idemKey=走①新行（mismatch 409 语义退役）', () => {
    it('nodeId/kind/paramsHash 漂移 ⇒ 键不同 ⇒ findUnique 落空 ⇒ createMany 新行（新扣费）——IntentContextMismatchError 已删', async () => {
      // 首查无行（漂移后的新键）→ createMany 胜出
      prisma.generationIntent.findUnique.mockResolvedValue(null);
      prisma.generationIntent.createMany.mockResolvedValue({ count: 1 });
      prisma.generationIntent.findUniqueOrThrow.mockResolvedValue(row({ nodeId: 'n2' }));

      for (const over of [{ nodeId: 'n2' }, { kind: 'redraw' }, { paramsHash: 'h2' }] as const) {
        const r = await service.claim(input(over));
        expect(r.created).toBe(true); // 改参重试=新意图新扣费（Z109 红测①的单元面）
      }
    });
  });

  describe('⑧ createMany 撞 active partial unique（同节点异 idemKey 在飞）→ count=0 → NodeBusy', () => {
    it('count=0 且本 idemKey 无行（again=null）→ NODE_BUSY（Z33：健康事务内分义非 25P02）', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue(null); // 本 idemKey 无行（异 idemKey 才是在飞方）
      prisma.generationIntent.createMany.mockResolvedValue({ count: 0 }); // ON CONFLICT DO NOTHING 吞撞

      await expect(service.claim(input({ gestureToken: 'g2-token-abcd' }))).rejects.toMatchObject({ errorCode: 'NODE_BUSY' });
    });
  });

  describe('⑨ createMany count=0 路径：同 idemKey 异 jobId（并发同内容超时重发）→ NodeBusy；同 jobId → 可重入', () => {
    it('撞 idemKey 唯一 + again 行 RUNNING 异 jobId → NODE_BUSY', async () => {
      prisma.generationIntent.findUnique
        .mockResolvedValueOnce(null) // 首查无行 → 走 createMany
        .mockResolvedValueOnce(row({ status: 'RUNNING', jobId: 'job-first' })); // count=0 后复查=并发赢家
      prisma.generationIntent.createMany.mockResolvedValue({ count: 0 });

      await expect(service.claim(input({ jobId: 'job-second' }))).rejects.toBeInstanceOf(NodeBusyError);
    });

    it('count=0 路径同 jobId 同 RUNNING → 可重入（create 与重入并发）', async () => {
      prisma.generationIntent.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(row({ status: 'RUNNING', jobId: 'job-1' }));
      prisma.generationIntent.createMany.mockResolvedValue({ count: 0 });

      const r = await service.claim(input({ jobId: 'job-1' }));
      expect(r.created).toBe(true);
    });
  });

  describe('complete/fail 幂等迁移（where ACTIVE 守卫）', () => {
    it('complete：RUNNING 行 → SUCCEEDED 返回 count=1', async () => {
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 1 });

      const count = await service.complete('gi-1', 'media-9');

      expect(count).toBe(1);
      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'gi-1', status: { in: ['RUNNING'] } },
        data: { status: 'SUCCEEDED', resultRef: 'media-9', completedAt: expect.any(Date), heartbeatAt: expect.any(Date) }, // Y0b-2 T4：终态时刻审计戳
      });
    });

    it('complete 幂等：行已 SUCCEEDED（被 VOIDED/已完成）→ where 零匹配 count=0', async () => {
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 0 });
      // 真库语义：where status in ACTIVE 对终态行匹配零行——mock 直接以 count=0 表达
      const count = await service.complete('gi-1', 'media-9');
      expect(count).toBe(0);
    });

    it('fail：RUNNING 行 → FAILED 且 error 截断 500', async () => {
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 1 });
      const longError = 'x'.repeat(600);

      await service.fail('gi-1', longError);

      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'gi-1', status: { in: ['RUNNING'] } },
        data: { status: 'FAILED', error: 'x'.repeat(500), completedAt: expect.any(Date), heartbeatAt: expect.any(Date) },
      });
    });

    it('Y0b-1（Z27）：fail 带 jobId → where 补 jobId 限定（迟到钩子不误杀 rearm 换 job 的新活意图）', async () => {
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 1 });

      await service.fail('gi-1', 'late hook', 'job-old');

      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'gi-1', status: { in: ['RUNNING'] }, jobId: 'job-old' },
        data: { status: 'FAILED', error: 'late hook', completedAt: expect.any(Date), heartbeatAt: expect.any(Date) },
      });
    });

    it('Y0b-1（N4）：findByActiveNode 反查 RUNNING 行——projectId/nodeId/jobId 三键', async () => {
      const mock = row(); // 单实例复用——row() 内嵌 new Date()，两次调用毫秒漂移=toEqual 假红（T7 verify 实证）
      prisma.generationIntent.findFirst.mockResolvedValue(mock);

      const r = await service.findByActiveNode('p1', 'n1', 'job-1');

      expect(r).toEqual(mock);
      expect(prisma.generationIntent.findFirst).toHaveBeenCalledWith({
        where: { projectId: 'p1', nodeId: 'n1', status: 'RUNNING', jobId: 'job-1' },
      });
    });

    it('fail 幂等：终态行再 fail → where ACTIVE 零匹配（updateMany 守卫即幂等）', async () => {
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 0 });
      await service.fail('gi-1', 'boom');
      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'gi-1', status: { in: ['RUNNING'] } },
        data: expect.objectContaining({ status: 'FAILED' }),
      });
    });

    it('批0.5-9 void_：RUNNING 行 → VOIDED 且 error 截断 500（reserve 失败——零扣费终态，重试照常扣费）', async () => {
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 1 });
      const longError = 'x'.repeat(600);

      await service.void_('gi-1', longError);

      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'gi-1', status: { in: ['RUNNING'] } },
        data: { status: 'VOIDED', error: 'x'.repeat(500), completedAt: expect.any(Date), heartbeatAt: expect.any(Date) },
      });
    });

    it('批0.5-9 void_ 幂等：终态行再 void → where ACTIVE 零匹配', async () => {
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 0 });
      await service.void_('gi-1', 'boom');
      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'gi-1', status: { in: ['RUNNING'] } },
        data: expect.objectContaining({ status: 'VOIDED' }),
      });
    });
  });

  describe('attachJob/listByNode 冒烟', () => {
    it('attachJob → update 回写 jobId（reconcile A 路径前提）', async () => {
      prisma.generationIntent.update.mockResolvedValue(row({ jobId: 'job-1' }));

      await service.attachJob('gi-1', 'job-1');

      expect(prisma.generationIntent.update).toHaveBeenCalledWith({
        where: { id: 'gi-1' },
        data: { jobId: 'job-1' },
      });
    });

    it('Y0b-2 T6（Z94）⓪ RUNNING 闸：同 nodeId 有 RUNNING 行（异 jobId）且内容键 SUCCEEDED 行存在 → NodeBusy 零新行零回放（改前红：findUnique 命中 SUCCEEDED 直接 replay 旧产物）', async () => {
      const succeededOld = row({ id: 'gi-old', idemKey: deriveIdemKey({ projectId: 'p1', nodeId: 'n1', kind: 'image', paramsHash: 'h1' }), status: 'SUCCEEDED', resultRef: 'http://x/old.png' });
      const runningOther = row({ id: 'gi-run', idemKey: 'other-key', status: 'RUNNING', jobId: 'job-other' });
      prisma.generationIntent.findUnique.mockResolvedValue(succeededOld); // 内容键行（老版本 SUCCEEDED）
      prisma.generationIntent.findFirst.mockResolvedValue(runningOther);  // ⓪ 的 RUNNING 索引查

      await expect(service.claim(input())).rejects.toBeInstanceOf(NodeBusyError);
      expect(prisma.generationIntent.createMany).not.toHaveBeenCalled(); // 零新行
    });

    it('Y0b-2 T6 ⓪ 同 jobId 豁免（Z104 合取）：RUNNING 行 jobId===input.jobId → 不拦（走①同 job 重入续跑）', async () => {
      const runningSameJob = row({ id: 'gi-run', idemKey: deriveIdemKey({ projectId: 'p1', nodeId: 'n1', kind: 'image', paramsHash: 'h1' }), status: 'RUNNING', jobId: 'job-9' });
      // findFirst 两次调用序列：⓪ 的 RUNNING 查（返回行——同 job 豁免）→ ② 的 SUCCEEDED 查（无行）
      prisma.generationIntent.findFirst
        .mockResolvedValueOnce(runningSameJob)
        .mockResolvedValueOnce(null);
      prisma.generationIntent.findUnique.mockResolvedValue(runningSameJob); // ③ 内容键命中 RUNNING 同 job
      prisma.generationIntent.findUniqueOrThrow.mockResolvedValue(runningSameJob);
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 1 });

      const r = await service.claim(input({ jobId: 'job-9' }));

      expect(r.created).toBe(true); // 同 job 重入=执行权（stalled 重排不自锁）
      expect(prisma.generationIntent.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ projectId: 'p1', nodeId: 'n1', status: 'RUNNING' }),
      }));
    });

    it('Y0b-2 T6 ② 无 token 最新回放：内容键无行但同参数最新 SUCCEEDED（手势键行）→ replay 最新（改前红：createMany 建新行新扣费=regenerate 后普通点击回放第一版倒退）', async () => {
      const latestGesture = row({ id: 'gi-new', idemKey: 'gesture-key-xyz', status: 'SUCCEEDED', resultRef: 'http://x/v2.png', createdAt: new Date('2026-01-02') });
      // findFirst 序列：⓪ RUNNING 查（无在飞）→ ② SUCCEEDED 查（最新手势键行）
      prisma.generationIntent.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(latestGesture);
      prisma.generationIntent.findUnique.mockResolvedValue(null); // 内容键无行

      const r = await service.claim(input());

      expect(r.created).toBe(false);
      expect(r.intent.id).toBe('gi-new'); // 最新 SUCCEEDED（createdAt desc 首行）
      expect(prisma.generationIntent.createMany).not.toHaveBeenCalled(); // 零新行零扣费
      expect(prisma.generationIntent.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
        where: expect.objectContaining({ projectId: 'p1', nodeId: 'n1', kind: 'image', paramsHash: 'h1', status: 'SUCCEEDED' }),
        orderBy: { createdAt: 'desc' },
      }));
    });

    it('Y0b-2 T6 ② 边界：同参数仅 FAILED 行（无 SUCCEEDED）→ 不回放，走③内容键 rearm', async () => {
      const contentRow = row({ id: 'gi-c', idemKey: deriveIdemKey({ projectId: 'p1', nodeId: 'n1', kind: 'image', paramsHash: 'h1' }), status: 'FAILED', attempts: 1 });
      // findFirst 序列：⓪ RUNNING 查（无在飞）→ ② SUCCEEDED 查（无行——仅 FAILED 存在）
      prisma.generationIntent.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      prisma.generationIntent.findUnique.mockResolvedValue(contentRow); // ③ 内容键命中 FAILED
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 1 });
      prisma.generationIntent.findUnique
        .mockResolvedValueOnce(contentRow) // ③ 首查
        .mockResolvedValueOnce(row({ id: 'gi-c', status: 'RUNNING', attempts: 2 })); // rearm 后回读

      const r = await service.claim(input());

      expect(r.created).toBe(true); // rearm=执行权
      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: 'gi-c', status: expect.anything() }),
      }));
    });

    it('listByNode → take 20 + 投影 select', async () => {
      const list = [row()];
      prisma.generationIntent.findMany.mockResolvedValue(list);

      const r = await service.listByNode('p1', 'n1');

      expect(r).toBe(list);
      expect(prisma.generationIntent.findMany).toHaveBeenCalledWith({
        where: { projectId: 'p1', nodeId: 'n1' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true, intentId: true, kind: true, status: true, resultRef: true,
          error: true, creditsConsumed: true, createdAt: true, completedAt: true,
          attempts: true,   // Y0b-2 T5（Z99/Z111）：投影代次判据——web ExecStatusEntry.attempts 对齐
        },
      });
    });
  });
});

describe('Y0b-2 T1：intent-key.util（Z82/Z79/Z68）', () => {
  it('deriveIdemKey：同输入同键（确定性）；异 token 异键；无 token 末段=run', () => {
    const base = { projectId: 'p1', nodeId: 'n1', kind: 'image', paramsHash: 'h1' };
    const a = deriveIdemKey(base);
    expect(deriveIdemKey({ ...base })).toBe(a);
    expect(deriveIdemKey({ ...base, regenToken: 't1' })).not.toBe(a);
    expect(deriveIdemKey({ ...base, regenToken: 't1' })).not.toBe(deriveIdemKey({ ...base, regenToken: 't2' }));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('deriveIdemKey：token 含 | 无注入（末段带前缀——跨字段重组结构性不可能）', () => {
    const base = { projectId: 'p1', nodeId: 'n1', kind: 'image', paramsHash: 'h1' };
    // 构造能拼接出同串的两组：token 'x|run' vs 任何其他组合都不可能等于无 token 键（前缀 regen: 区分）
    expect(deriveIdemKey({ ...base, regenToken: 'x|run' })).not.toBe(deriveIdemKey(base));
    expect(deriveIdemKey({ ...base, regenToken: 'run' })).not.toBe(deriveIdemKey(base));
  });

  it('Y0b-2 T6 normalizeRegenToken 转严格：合法形态原样；空白/null→undefined；非法（>64/非法字符/过短）→ throw IDEMPOTENCY_TOKEN_INVALID（禁静默忽略）', () => {
    expect(normalizeRegenTokenImport(undefined)).toBeUndefined();
    expect(normalizeRegenTokenImport('  ')).toBeUndefined();
    expect(normalizeRegenTokenImport('abcd1234')).toBe('abcd1234');           // 8=下界
    expect(normalizeRegenTokenImport('a'.repeat(64))).toBe('a'.repeat(64));   // 64=上界
    expect(normalizeRegenTokenImport('AbC-_-90')).toBe('AbC-_-90');           // [0-9a-zA-Z_-] 全字符类
    const uuid = '01234567-89ab-cdef-0123-456789abcdef';
    expect(normalizeRegenTokenImport(uuid)).toBe(uuid);                       // crypto.randomUUID 形态
    // 非法形态 → BusinessException{errorCode:IDEMPOTENCY_TOKEN_INVALID, 400}（超长=改前的截断+warn 静默退役）
    for (const bad of ['a'.repeat(65), 'abc', 'bad token!', '嵌套中文']) {
      try {
        normalizeRegenTokenImport(bad);
        expect.unreachable(`'${String(bad).slice(0, 8)}' 应拒`);
      } catch (e: any) {
        expect(e.errorCode).toBe('IDEMPOTENCY_TOKEN_INVALID');
        expect(e.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      }
    }
  });

  it('deadlineMsForKind：kind→默认档映射（env 缺省走 EXEC_DEFAULTS 单源）', async () => {
    const { deadlineMsForKind, } = await import('./intent-key.util');
    const { EXEC_DEFAULTS } = await import('../../config/env');
    expect(deadlineMsForKind('text')).toBe(EXEC_DEFAULTS.DEADLINE_TEXT);
    expect(deadlineMsForKind('image')).toBe(EXEC_DEFAULTS.DEADLINE_IMAGE);
    expect(deadlineMsForKind('video')).toBe(EXEC_DEFAULTS.DEADLINE_VIDEO);
    expect(deadlineMsForKind('redraw')).toBe(EXEC_DEFAULTS.DEADLINE_EDIT);
    expect(deadlineMsForKind('lighting')).toBe(EXEC_DEFAULTS.DEADLINE_LIGHTING);
    expect(deadlineMsForKind('unknown-kind')).toBe(EXEC_DEFAULTS.DEADLINE_EDIT); // 未知 kind 保守短档
  });
});
