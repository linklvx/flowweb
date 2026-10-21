// apps/api/src/modules/collab/collab-write.controller.spec.ts
// Y0c T27：POST /api/collab/doc/write-batch——worker 内部写端点（P8 单端点；api 进程内直调
// CollabDocWriterService.writeBatch）。端点面职责三钉：①Z108 内容校验进门=T4 manifest 校验表
// 执法档 requireIdempotentOps:true（Z148①——idempotent:false 的 op 直接 4xx 拒收+键集/字节 Σ/
// op 数上限/拒 __proto__ 族，全七码违规清单进 400 body）②响应=WriteOpResult[] 裸数组
// （@NoTransform——TransformInterceptor 包裹壳会破坏 HttpCollabWritePort.writeOpsBatch 直接 cast 契约）
// ③瞬态 503 显式传递（Z99 端点半——writer throw SUE 原样上抛不吞不换码，worker 侧按瞬态族重试）。
// T13（plan v11.2 ①）双收窄红测：④op 白名单=WORKER_CHANNEL_OPS 且 writeNodeData 键⊆
// WORKER_WRITE_NODE_DATA_KEYS〔{fileId,result}〕（worker token 写 content/videoUrl 即 400——比旧
// 6 键全开真收窄）；⑤x-worker-scope HMAC 验签（伪造他 project/intent/execSeq ⇒ 403——作用域
// 不匹配；writeNodeData 需全档；裸档仅 writeExecStatus）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'reflect-metadata';
import { RequestMethod, ServiceUnavailableException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { NO_TRANSFORM_KEY } from '../../common/decorators/no-transform.decorator';
import { CollabWriteController } from './collab-write.controller';
import { WorkerWriteAuthGuard } from './worker-write-auth.guard';
import { CollabDocWriterService, type WriteOpResult } from './collab-doc-writer.service';
import { mintWorkerScopeToken } from './worker-scope-token';

const TOKEN = 'tok-t13-ctrl';

/** 最小 writer stub（writeBatch 记录调用+可编程返回/抛错）。 */
function writerStub(impl?: (projectId: string, ops: readonly any[]) => Promise<WriteOpResult[]>) {
  return {
    writeBatch: vi.fn(impl ?? (async (_p: string, ops: readonly any[]) =>
      ops.map((op, index) => ({ index, op: (op as any).op, written: true })))),
  };
}

/** intent 行 stub（scope 全档绑定校验读点——null=行灭失）。 */
function mkController(writer: ReturnType<typeof writerStub>, row: { projectId: string; nodeId: string; execSeq: bigint } | null = null) {
  return new CollabWriteController(
    writer as unknown as CollabDocWriterService,
    { generationIntent: { findUnique: vi.fn().mockResolvedValue(row) } } as any,
  );
}

describe('Y0c T27 CollabWriteController（POST write-batch——路由形态+鉴权复用）', () => {
  it('路由形态：POST api/collab/doc + write-batch；@NoTransform（裸 WriteOpResult[]——端口契约）；WorkerWriteAuthGuard（T26 模板复用——偏离 32 形态）', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CollabWriteController)).toBe('api/collab/doc');
    const handler = CollabWriteController.prototype.writeBatch;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('write-batch');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);   // Nest 数字枚举（POST=1）
    expect(Reflect.getMetadata(NO_TRANSFORM_KEY, handler)).toBe(true);
    const guards: any[] = Reflect.getMetadata('__guards__', handler) ?? [];
    expect(guards.map((g) => g.name ?? String(g))).toContain('WorkerWriteAuthGuard');
    expect(new WorkerWriteAuthGuard()).toBeInstanceOf(WorkerWriteAuthGuard);   // guard 可无参实例化（Nest DI 零依赖）
  });
});

describe('Y0c T27 write-batch 内容校验（Z108 执法档 requireIdempotentOps:true——T4 manifest 单源；dev 未设 token=双收窄面 fail-open 同 guard）', () => {
  it('body 形态：projectId 非空 string+ops 数组——缺/错 ⇒ 400（writer 零调用）', async () => {
    const writer = writerStub();
    const c = mkController(writer);
    await expect(c.writeBatch({ ops: [{ op: 'deleteExecOrphans' }] } as any)).rejects.toMatchObject({ status: 400 });
    await expect(c.writeBatch({ projectId: '', ops: [] } as any)).rejects.toMatchObject({ status: 400 });
    await expect(c.writeBatch({ projectId: 'p1', ops: 'nope' } as any)).rejects.toMatchObject({ status: 400 });
    await expect(c.writeBatch(undefined as any)).rejects.toMatchObject({ status: 400 });
    expect(writer.writeBatch).not.toHaveBeenCalled();
  });

  it('Z148①：idempotent:false 的 op（fillDoc）⇒ 400 NON_IDEMPOTENT_OP——「端口只收幂等 op」可执行断言（writer 零调用）', async () => {
    const writer = writerStub();
    const c = mkController(writer);
    const err: any = await c.writeBatch({ projectId: 'p1', ops: [{ op: 'fillDoc', nodes: [], edges: [] }] }).catch((e) => e);
    expect(err.status).toBe(400);
    const violations: Array<{ code: string }> = err.response?.violations ?? [];
    expect(violations.some((v) => v.code === 'NON_IDEMPOTENT_OP')).toBe(true);
    expect(writer.writeBatch).not.toHaveBeenCalled();
  });

  it.each([
    ['UNKNOWN_KEY', { projectId: 'p1', ops: [{ op: 'writeNodeData', nodeId: 'n1', patch: { evilKey: 'x' } }] }],
    ['PATCH_TOO_LARGE', { projectId: 'p1', ops: [{ op: 'writeNodeData', nodeId: 'n1', patch: { content: 'x'.repeat(65_537) } }] }],
    ['OP_COUNT_EXCEEDED', { projectId: 'p1', ops: Array.from({ length: 1001 }, () => ({ op: 'deleteExecOrphans' })) }],
    ['PROTO_KEY_BANNED', { projectId: 'p1', ops: [{ op: 'writeNodeData', nodeId: 'n1', patch: JSON.parse('{"__proto__":"x"}') }] }],   // JSON wire 形态（字面量 {__proto__:} 不建自有键——JSON.parse 才是端点实际收到面）
  ])('内容违规 %s ⇒ 400 违规清单携码（writer 零调用——业务拒绝在进门不进事务）', async (code, body) => {
    const writer = writerStub();
    const c = mkController(writer);
    const err: any = await c.writeBatch(body as any).catch((e) => e);
    expect(err.status).toBe(400);
    const violations: Array<{ code: string }> = err.response?.violations ?? [];
    expect(violations.some((v) => v.code === code)).toBe(true);
    expect(writer.writeBatch).not.toHaveBeenCalled();
  });
});

describe('Y0c T27 write-batch 业务面透传（Z99 端点半——200 WriteOpResult[]/503 显式传递）', () => {
  it('合法批：writer.writeBatch(projectId, ops) 直调，结果裸透传（空批同——空批=合法 no-op 归 writer 早退）', async () => {
    const results: WriteOpResult[] = [
      { index: 0, op: 'writeNodeData', written: false, reason: 'node-deleted' },
      { index: 1, op: 'writeExecStatus', written: true },
    ];
    const writer = writerStub(async () => results);
    const c = mkController(writer);
    const body = { projectId: 'p1', ops: [{ op: 'writeNodeData', nodeId: 'n1', patch: { fileId: 'f1' } }, { op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'done', attempts: 1 } }] };
    await expect(c.writeBatch(body)).resolves.toBe(results);   // 同一引用裸透传（非包裹壳）
    expect(writer.writeBatch).toHaveBeenCalledWith('p1', body.ops);
  });

  it('空批：ops:[] 过门（零违规）——透传 writer（writeBatch 空批早退 []）', async () => {
    const writer = writerStub(async () => []);
    const c = mkController(writer);
    await expect(c.writeBatch({ projectId: 'p1', ops: [] })).resolves.toEqual([]);
    expect(writer.writeBatch).toHaveBeenCalledWith('p1', []);
  });

  it('瞬态 503 显式传递（Z99 端点半）：writer throw SUE ⇒ 原样上抛（不吞不换码——worker 侧按瞬态族退避重试）', async () => {
    const writer = writerStub(async () => { throw new ServiceUnavailableException({ code: 'COLLAB_NOT_SERVING', message: 'lease' }); });
    const c = mkController(writer);
    await expect(c.writeBatch({ projectId: 'p1', ops: [{ op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'done', attempts: 1 } }] }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('T13（plan v11.2 ①）双收窄——token 已设档（worker 通道 op 白名单+scope 验签）', () => {
  let savedToken: string | undefined;
  beforeEach(() => {
    savedToken = process.env.WORKER_WRITE_TOKEN;
    process.env.WORKER_WRITE_TOKEN = TOKEN;
  });
  afterEach(() => {
    if (savedToken === undefined) delete process.env.WORKER_WRITE_TOKEN; else process.env.WORKER_WRITE_TOKEN = savedToken;
  });

  const intentRow = { projectId: 'p1', nodeId: 'n1', execSeq: 77n };
  const fullScope = () => mintWorkerScopeToken(TOKEN, 'p1', { intentRowId: 'gi-1', execSeq: '77' });
  const bareScope = () => mintWorkerScopeToken(TOKEN, 'p1');

  it('绿·全档合法批：writeNodeData{fileId,result}+writeExecStatus 过收窄面（intent 行绑定匹配）——writer 直调', async () => {
    const writer = writerStub();
    const c = mkController(writer, intentRow);
    const body = { projectId: 'p1', ops: [
      { op: 'writeNodeData', nodeId: 'n1', patch: { fileId: 'f1', result: '文本产物' } },
      { op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'done', attempts: 1 } },
    ] };
    await expect(c.writeBatch(body, fullScope())).resolves.toBeDefined();
    expect(writer.writeBatch).toHaveBeenCalledWith('p1', body.ops);
  });

  it('红·绿：worker token 写白名单外键（content/videoUrl/resultUrl/errorCode——Z108 通用键域内但非 worker 通道键集）⇒ 400 WORKER_KEY_NOT_ALLOWED（writer 零调用）', async () => {
    const writer = writerStub();
    const c = mkController(writer, intentRow);
    for (const key of ['content', 'videoUrl', 'resultUrl', 'errorCode']) {
      const err: any = await c.writeBatch({ projectId: 'p1', ops: [{ op: 'writeNodeData', nodeId: 'n1', patch: { [key]: 'x' } }] }, fullScope()).catch((e) => e);
      expect(err.status, `键 ${key} 须 400`).toBe(400);
      expect(err.response?.code).toBe('WORKER_KEY_NOT_ALLOWED');
    }
    expect(writer.writeBatch).not.toHaveBeenCalled();
  });

  it('红·绿：op 白名单外（deleteExecOrphans/deleteNodeDataKeys/deleteNodes——api 进程内专用 op）⇒ 400 WORKER_OP_NOT_ALLOWED', async () => {
    const writer = writerStub();
    const c = mkController(writer, intentRow);
    for (const op of [{ op: 'deleteExecOrphans' }, { op: 'deleteNodeDataKeys', nodeId: 'n1', keys: ['fileId'] }, { op: 'deleteNodes', nodeIds: ['n1'] }]) {
      const err: any = await c.writeBatch({ projectId: 'p1', ops: [op] }, fullScope()).catch((e) => e);
      expect(err.status).toBe(400);
      expect(err.response?.code).toBe('WORKER_OP_NOT_ALLOWED');
    }
    expect(writer.writeBatch).not.toHaveBeenCalled();
  });

  it('红·绿：scope 缺失/伪造签名（自铸 token 无 HMAC 密钥）⇒ 403 WORKER_SCOPE_INVALID', async () => {
    const writer = writerStub();
    const c = mkController(writer, intentRow);
    await expect(c.writeBatch({ projectId: 'p1', ops: [{ op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'loading', attempts: 1 } }] }, undefined))
      .rejects.toMatchObject({ status: 403 });
    await expect(c.writeBatch({ projectId: 'p1', ops: [{ op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'loading', attempts: 1 } }] }, mintWorkerScopeToken('attacker-token', 'p1')))
      .rejects.toMatchObject({ status: 403 });
    expect(writer.writeBatch).not.toHaveBeenCalled();
  });

  it('红·绿：伪造他 project 的写请求（token 绑 p1、body 载荷 p2）⇒ 403 WORKER_SCOPE_PROJECT_MISMATCH', async () => {
    const writer = writerStub();
    const c = mkController(writer, { ...intentRow, projectId: 'p2' });
    const err: any = await c.writeBatch({ projectId: 'p2', ops: [{ op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'loading', attempts: 1 } }] }, fullScope()).catch((e) => e);
    expect(err.status).toBe(403);
    expect(err.response?.code).toBe('WORKER_SCOPE_PROJECT_MISMATCH');
    expect(writer.writeBatch).not.toHaveBeenCalled();
  });

  it('红·绿：伪造他 intent/execSeq（token 绑 gi-1/77，DB 行 execSeq=88）⇒ 403 WORKER_SCOPE_INTENT_MISMATCH；伪造他 nodeId（op 指向 n2）⇒ 403 WORKER_SCOPE_NODE_MISMATCH', async () => {
    const writer = writerStub();
    const cExec = mkController(writer, { projectId: 'p1', nodeId: 'n1', execSeq: 88n });
    const errExec: any = await cExec.writeBatch({ projectId: 'p1', ops: [{ op: 'writeNodeData', nodeId: 'n1', patch: { fileId: 'f1' } }] }, fullScope()).catch((e) => e);
    expect(errExec.status).toBe(403);
    expect(errExec.response?.code).toBe('WORKER_SCOPE_INTENT_MISMATCH');

    // 攻击面：token 绑定 intent 行（nodeId=n1）但 op 载荷指向他节点 n2——绑定校验拒
    const cNode = mkController(writer, intentRow);
    const errNode: any = await cNode.writeBatch({ projectId: 'p1', ops: [{ op: 'writeNodeData', nodeId: 'n2', patch: { fileId: 'f1' } }] }, fullScope()).catch((e) => e);
    expect(errNode.status).toBe(403);
    expect(errNode.response?.code).toBe('WORKER_SCOPE_NODE_MISMATCH');
    expect(writer.writeBatch).not.toHaveBeenCalled();
  });

  it('红·绿：裸项目档 writeNodeData（资金交付面需全档）⇒ 403 WORKER_SCOPE_LEVEL；裸档 writeExecStatus 放行（pre-claim 断言路径——PLAN_MISSING/claim 抛错的 error 投影无 intent 行可绑）', async () => {
    const writer = writerStub();
    const c = mkController(writer, null);
    const err: any = await c.writeBatch({ projectId: 'p1', ops: [{ op: 'writeNodeData', nodeId: 'n1', patch: { fileId: 'f1' } }] }, bareScope()).catch((e) => e);
    expect(err.status).toBe(403);
    expect(err.response?.code).toBe('WORKER_SCOPE_LEVEL');
    await expect(c.writeBatch({ projectId: 'p1', ops: [{ op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'error', attempts: 0, errorCode: 'PLAN_MISSING' } }] }, bareScope())).resolves.toBeDefined();
    expect(writer.writeBatch).toHaveBeenCalledTimes(1);
  });
});
