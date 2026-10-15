// apps/api/src/modules/collab/collab-read.controller.spec.ts
// Y0c T26（偏离 29/32）：worker 读端点 GET /api/collab/doc/:projectId/canvas——api 进程内经
// CollabWritePort（Direct 形态）readCanvas 直调；@NoTransform 裸 {nodes,edges}（HttpCollabWritePort
// .readCanvas 直接 cast body——TransformInterceptor 包裹壳会破坏契约）；鉴权=WorkerWriteAuthGuard
// （Bearer WORKER_WRITE_TOKEN+timingSafeEqual+production 未设 403 fail-closed+dev fail-open——
// T27 write-batch 复用同 guard，production 拒启归 T27）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { NO_TRANSFORM_KEY } from '../../common/decorators/no-transform.decorator';
import { CollabReadController } from './collab-read.controller';
import { WorkerWriteAuthGuard } from './worker-write-auth.guard';
import { CollabWritePort } from './collab-write.port';

function ctxFor(headers: Record<string, string> = {}) {
  const req = { headers };
  return { ctx: { switchToHttp: () => ({ getRequest: () => req }) } as any, req };
}

describe('Y0c T26 WorkerWriteAuthGuard（偏离 32——WORKER_WRITE_TOKEN Bearer+timingSafeEqual）', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ['WORKER_WRITE_TOKEN', 'NODE_ENV']) { saved[k] = process.env[k]; delete process.env[k]; }
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    vi.unstubAllEnvs();
  });

  it('production 未设 token ⇒ 403 fail-closed（拒启形态归 T27——请求级先落守门）', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { ctx } = ctxFor();
    expect(() => new WorkerWriteAuthGuard().canActivate(ctx)).toThrow(/WORKER_WRITE_TOKEN/);
  });

  it('development 未设 token ⇒ fail-open（COLLAB_ADMIN_TOKEN/PrometheusAuthGuard 同源）', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { ctx } = ctxFor();
    expect(new WorkerWriteAuthGuard().canActivate(ctx)).toBe(true);
  });

  it('Bearer 匹配 ⇒ 放行', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WORKER_WRITE_TOKEN', 'tok-abc123');
    const { ctx } = ctxFor({ authorization: 'Bearer tok-abc123' });
    expect(new WorkerWriteAuthGuard().canActivate(ctx)).toBe(true);
  });

  it('Bearer 失配 ⇒ 403；非 Bearer 形态 ⇒ 403；长度不等 ⇒ 403（timingSafeEqual 前置守卫）', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WORKER_WRITE_TOKEN', 'tok-abc123');
    const g = new WorkerWriteAuthGuard();
    expect(() => g.canActivate(ctxFor({ authorization: 'Bearer wrong' }).ctx)).toThrow('Forbidden');
    expect(() => g.canActivate(ctxFor({ authorization: 'tok-abc123' }).ctx)).toThrow('Forbidden');
    expect(() => g.canActivate(ctxFor({ authorization: 'Bearer tok-abc123-extra-length' }).ctx)).toThrow('Forbidden');
    expect(() => g.canActivate(ctxFor({}).ctx)).toThrow('Forbidden');
  });
});

describe('Y0c T26 CollabReadController（偏离 29——GET :projectId/canvas）', () => {
  it('路由形态：GET api/collab/doc + :projectId/canvas；@NoTransform（裸 {nodes,edges}——端口契约）', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CollabReadController)).toBe('api/collab/doc');
    const handler = CollabReadController.prototype.readCanvas;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':projectId/canvas');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);   // Nest 数字枚举（GET=0）
    expect(Reflect.getMetadata(NO_TRANSFORM_KEY, handler)).toBe(true);
  });

  it('readCanvas 透传（CollabWritePort.readCanvas→{nodes,edges} 响应体原样）', async () => {
    const port = { readCanvas: vi.fn(async () => ({ nodes: [{ id: 'n1' }], edges: [] })) } as unknown as CollabWritePort;
    const c = new CollabReadController(port);
    await expect(c.readCanvas('p1')).resolves.toEqual({ nodes: [{ id: 'n1' }], edges: [] });
    expect((port as any).readCanvas).toHaveBeenCalledWith('p1');
  });
});
