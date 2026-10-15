// apps/api/src/modules/collab/collab-write.controller.spec.ts
// Y0c T27：POST /api/collab/doc/write-batch——worker 内部写端点（P8 单端点；api 进程内直调
// CollabDocWriterService.writeBatch）。端点面职责三钉：①Z108 内容校验进门=T4 manifest 校验表
// 执法档 requireIdempotentOps:true（Z148①——idempotent:false 的 op 直接 4xx 拒收+键集/字节 Σ/
// op 数上限/拒 __proto__ 族，全七码违规清单进 400 body）②响应=WriteOpResult[] 裸数组
// （@NoTransform——TransformInterceptor 包裹壳会破坏 HttpCollabWritePort.writeOpsBatch 直接 cast 契约）
// ③瞬态 503 显式传递（Z99 端点半——writer throw SUE 原样上抛不吞不换码，worker 侧按瞬态族重试）。
import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { RequestMethod, ServiceUnavailableException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { NO_TRANSFORM_KEY } from '../../common/decorators/no-transform.decorator';
import { CollabWriteController } from './collab-write.controller';
import { WorkerWriteAuthGuard } from './worker-write-auth.guard';
import { CollabDocWriterService, type WriteOpResult } from './collab-doc-writer.service';

/** 最小 writer stub（writeBatch 记录调用+可编程返回/抛错）。 */
function writerStub(impl?: (projectId: string, ops: readonly any[]) => Promise<WriteOpResult[]>) {
  return {
    writeBatch: vi.fn(impl ?? (async (_p: string, ops: readonly any[]) =>
      ops.map((op, index) => ({ index, op: (op as any).op, written: true })))),
  };
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

describe('Y0c T27 write-batch 内容校验（Z108 执法档 requireIdempotentOps:true——T4 manifest 单源）', () => {
  it('body 形态：projectId 非空 string+ops 数组——缺/错 ⇒ 400（writer 零调用）', async () => {
    const writer = writerStub();
    const c = new CollabWriteController(writer as unknown as CollabDocWriterService);
    await expect(c.writeBatch({ ops: [{ op: 'deleteExecOrphans' }] } as any)).rejects.toMatchObject({ status: 400 });
    await expect(c.writeBatch({ projectId: '', ops: [] } as any)).rejects.toMatchObject({ status: 400 });
    await expect(c.writeBatch({ projectId: 'p1', ops: 'nope' } as any)).rejects.toMatchObject({ status: 400 });
    await expect(c.writeBatch(undefined as any)).rejects.toMatchObject({ status: 400 });
    expect(writer.writeBatch).not.toHaveBeenCalled();
  });

  it('Z148①：idempotent:false 的 op（fillDoc）⇒ 400 NON_IDEMPOTENT_OP——「端口只收幂等 op」可执行断言（writer 零调用）', async () => {
    const writer = writerStub();
    const c = new CollabWriteController(writer as unknown as CollabDocWriterService);
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
    const c = new CollabWriteController(writer as unknown as CollabDocWriterService);
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
    const c = new CollabWriteController(writer as unknown as CollabDocWriterService);
    const body = { projectId: 'p1', ops: [{ op: 'writeNodeData', nodeId: 'n1', patch: { fileId: 'f1' } }, { op: 'deleteExecOrphans' }] };
    await expect(c.writeBatch(body)).resolves.toBe(results);   // 同一引用裸透传（非包裹壳）
    expect(writer.writeBatch).toHaveBeenCalledWith('p1', body.ops);
  });

  it('空批：ops:[] 过门（零违规）——透传 writer（writeBatch 空批早退 []）', async () => {
    const writer = writerStub(async () => []);
    const c = new CollabWriteController(writer as unknown as CollabDocWriterService);
    await expect(c.writeBatch({ projectId: 'p1', ops: [] })).resolves.toEqual([]);
    expect(writer.writeBatch).toHaveBeenCalledWith('p1', []);
  });

  it('瞬态 503 显式传递（Z99 端点半）：writer throw SUE ⇒ 原样上抛（不吞不换码——worker 侧按瞬态族退避重试）', async () => {
    const writer = writerStub(async () => { throw new ServiceUnavailableException({ code: 'COLLAB_NOT_SERVING', message: 'lease' }); });
    const c = new CollabWriteController(writer as unknown as CollabDocWriterService);
    await expect(c.writeBatch({ projectId: 'p1', ops: [{ op: 'deleteExecOrphans' }] }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
