// apps/api/src/modules/collab/collab-write.controller.spec.ts
// Y0c T27→Y1c T32：POST /api/collab/doc/exec-status——worker 内部 exec 状态投影写端点
// （RuntimeEvent feed——CollabDocumentService.writeExecStatus；零 doc 写）。端点面职责：
// ①body 形态 {projectId,nodeId,patch}（patch.status 非空 string）⇒ 400；②status 黑名单=done
// 禁经 worker 通道（WORKER_EXEC_DONE_FORBIDDEN——done=投影 poller deliverArtifact 复合事务专写）；
// ③x-worker-scope HMAC 验签（伪造他 project/intent/execSeq/nodeId ⇒ 403；裸档=pre-claim 断言
// 路径跳过行核）；④瞬态 503 显式传递（Z99 端点半——docs.writeExecStatus throw SUE 原样上抛）。
// T32 改造注记：原 write-batch 端点（doc 批写/WORKER_CHANNEL_OPS 白名单）随 doc.exec 读写链
// 退役删除——本 spec 随迁（op 白名单族用例不再适用：端点天然 exec 单条面）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'reflect-metadata';
import { RequestMethod, ServiceUnavailableException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { NO_TRANSFORM_KEY } from '../../common/decorators/no-transform.decorator';
import { CollabWriteController } from './collab-write.controller';
import { WorkerWriteAuthGuard } from './worker-write-auth.guard';
import { mintWorkerScopeToken } from './worker-scope-token';

const TOKEN = 'tok-t13-ctrl';

/** 最小 docs stub（writeExecStatus 记录调用+可编程返回/抛错）。 */
function docsStub(impl?: (projectId: string, nodeId: string, patch: unknown) => Promise<void>) {
  return {
    writeExecStatus: vi.fn(impl ?? (async () => undefined)),
  };
}

/** intent 行 stub（scope 全档绑定校验读点——null=行灭失）。 */
function mkController(docs: ReturnType<typeof docsStub>, row: { projectId: string; nodeId: string; execSeq: bigint } | null = null) {
  return new CollabWriteController(
    docs as any,
    { generationIntent: { findUnique: vi.fn().mockResolvedValue(row) } } as any,
  );
}

const okBody = { projectId: 'p1', nodeId: 'n1', patch: { status: 'loading', attempts: 1 } };

describe('Y1c T32 CollabWriteController（POST exec-status——路由形态+鉴权复用）', () => {
  it('路由形态：POST api/collab/doc + exec-status；@NoTransform；WorkerWriteAuthGuard（T26 模板复用——偏离 32 形态）', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CollabWriteController)).toBe('api/collab/doc');
    const handler = CollabWriteController.prototype.writeExecStatus;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('exec-status');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);   // Nest 数字枚举（POST=1）
    expect(Reflect.getMetadata(NO_TRANSFORM_KEY, handler)).toBe(true);
    const guards: any[] = Reflect.getMetadata('__guards__', handler) ?? [];
    expect(guards.map((g) => g.name ?? String(g))).toContain('WorkerWriteAuthGuard');
    expect(new WorkerWriteAuthGuard()).toBeInstanceOf(WorkerWriteAuthGuard);   // guard 可无参实例化（Nest DI 零依赖）
  });
});

describe('Y1c T32 exec-status body/黑名单面（dev 未设 token=fail-open 同 guard）', () => {
  it('body 形态：projectId/nodeId 非空 string+patch 对象——缺/错 ⇒ 400（writeExecStatus 零调用）；patch.status 非空 string ⇒ 400', async () => {
    const docs = docsStub();
    const c = mkController(docs);
    await expect(c.writeExecStatus({ nodeId: 'n1', patch: { status: 'loading', attempts: 1 } } as any)).rejects.toMatchObject({ status: 400 });
    await expect(c.writeExecStatus({ projectId: '', nodeId: 'n1', patch: { status: 'loading' } } as any)).rejects.toMatchObject({ status: 400 });
    await expect(c.writeExecStatus({ projectId: 'p1', patch: { status: 'loading' } } as any)).rejects.toMatchObject({ status: 400 });
    await expect(c.writeExecStatus({ projectId: 'p1', nodeId: 'n1', patch: null } as any)).rejects.toMatchObject({ status: 400 });
    await expect(c.writeExecStatus({ projectId: 'p1', nodeId: 'n1', patch: { attempts: 1 } } as any)).rejects.toMatchObject({ status: 400 });
    await expect(c.writeExecStatus(undefined as any)).rejects.toMatchObject({ status: 400 });
    expect(docs.writeExecStatus).not.toHaveBeenCalled();
  });

  it('status 黑名单：done ⇒ 403 WORKER_EXEC_STATUS_NOT_ALLOWED（done=deliverArtifact 复合事务专写；writeExecStatus 零调用）', async () => {
    const docs = docsStub();
    const c = mkController(docs);
    const err: any = await c.writeExecStatus({ projectId: 'p1', nodeId: 'n1', patch: { status: 'done', attempts: 1 } }).catch((e) => e);
    expect(err.status).toBe(403);
    expect(err.response?.code).toBe('WORKER_EXEC_STATUS_NOT_ALLOWED');
    expect(docs.writeExecStatus).not.toHaveBeenCalled();
  });

  it('合法批：docs.writeExecStatus(projectId, nodeId, patch) 直调，返回 {written:true}（loading/skipped/error=claim 期在案面）', async () => {
    const docs = docsStub();
    const c = mkController(docs);
    await expect(c.writeExecStatus(okBody)).resolves.toEqual({ written: true });
    expect(docs.writeExecStatus).toHaveBeenCalledWith('p1', 'n1', okBody.patch);
  });

  it('瞬态 503 显式传递（Z99 端点半）：docs.writeExecStatus throw SUE ⇒ 原样上抛（不吞不换码——worker 侧按瞬态族退避重试）', async () => {
    const docs = docsStub(async () => { throw new ServiceUnavailableException({ code: 'COLLAB_NOT_SERVING', message: 'lease' }); });
    const c = mkController(docs);
    await expect(c.writeExecStatus(okBody)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('T13（plan v11.2 ①）scope 验签+全档绑定（token 已设档）', () => {
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

  it('全档合法：writeExecStatus（loading）过验签+intent 行绑定匹配——docs 直调', async () => {
    const docs = docsStub();
    const c = mkController(docs, intentRow);
    await expect(c.writeExecStatus(okBody, fullScope())).resolves.toBeDefined();
    expect(docs.writeExecStatus).toHaveBeenCalledWith('p1', 'n1', okBody.patch);
  });

  it('scope 缺失/伪造签名（自铸 token 无 HMAC 密钥）⇒ 403 WORKER_SCOPE_INVALID', async () => {
    const docs = docsStub();
    const c = mkController(docs, intentRow);
    await expect(c.writeExecStatus(okBody, undefined)).rejects.toMatchObject({ status: 403 });
    await expect(c.writeExecStatus(okBody, mintWorkerScopeToken('attacker-token', 'p1'))).rejects.toMatchObject({ status: 403 });
    expect(docs.writeExecStatus).not.toHaveBeenCalled();
  });

  it('伪造他 project 的写请求（token 绑 p1、body 载荷 p2）⇒ 403 WORKER_SCOPE_PROJECT_MISMATCH', async () => {
    const docs = docsStub();
    const c = mkController(docs, { ...intentRow, projectId: 'p2' });
    const err: any = await c.writeExecStatus({ ...okBody, projectId: 'p2' }, fullScope()).catch((e) => e);
    expect(err.status).toBe(403);
    expect(err.response?.code).toBe('WORKER_SCOPE_PROJECT_MISMATCH');
    expect(docs.writeExecStatus).not.toHaveBeenCalled();
  });

  it('伪造他 intent/execSeq（token 绑 gi-1/77，DB 行 execSeq=88）⇒ 403 WORKER_SCOPE_INTENT_MISMATCH；伪造他 nodeId（载荷指向 n2）⇒ 403 WORKER_SCOPE_NODE_MISMATCH', async () => {
    const docs = docsStub();
    const cExec = mkController(docs, { projectId: 'p1', nodeId: 'n1', execSeq: 88n });
    const errExec: any = await cExec.writeExecStatus(okBody, fullScope()).catch((e) => e);
    expect(errExec.status).toBe(403);
    expect(errExec.response?.code).toBe('WORKER_SCOPE_INTENT_MISMATCH');

    // 攻击面：token 绑定 intent 行（nodeId=n1）但载荷指向他节点 n2——绑定校验拒
    const cNode = mkController(docs, intentRow);
    const errNode: any = await cNode.writeExecStatus({ ...okBody, nodeId: 'n2' }, fullScope()).catch((e) => e);
    expect(errNode.status).toBe(403);
    expect(errNode.response?.code).toBe('WORKER_SCOPE_NODE_MISMATCH');
    expect(docs.writeExecStatus).not.toHaveBeenCalled();
  });

  it('裸项目档：跳过行核放行（pre-claim 断言路径——PLAN_MISSING/claim 抛错的 error 投影无 intent 行可绑）', async () => {
    const docs = docsStub();
    const c = mkController(docs, null);
    await expect(c.writeExecStatus({ projectId: 'p1', nodeId: 'n1', patch: { status: 'error', attempts: 0, errorCode: 'PLAN_MISSING' } }, bareScope())).resolves.toBeDefined();
    expect(docs.writeExecStatus).toHaveBeenCalledTimes(1);
  });
});
