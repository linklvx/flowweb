// apps/api/src/middleware/http-red.middleware.spec.ts —— Y0b-5 T13 红测
// HTTP RED：http_request_duration_seconds{method,route,status}+在飞 gauge inc/dec 配对+path 归一防基数。
// WS 帧不进 HTTP RED：collab 独立端口服务（hocuspocus 自管 http server）不经主 app express 链——静态断言。
import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Request, Response } from 'express';
import { httpRedMiddleware, normalizeRoute } from './http-red.middleware';
import { httpRequestDurationSeconds, httpRequestsInFlight } from './http-red.metrics';

type ResMock = Response & {
  stored: Record<string, unknown>;
  finish: () => void;
  close: () => void;
};
function mockReq(path: string, method = 'GET'): Request {
  return { headers: {}, path, method } as unknown as Request;
}
function mockRes(status = 200): ResMock {
  const stored: Record<string, unknown> = {};
  const res = new EventEmitter() as unknown as ResMock;
  (res as any).stored = stored;
  (res as any).setHeader = (k: string, v: unknown) => { stored[k.toLowerCase()] = v; };
  (res as any).statusCode = status;
  (res as any).finish = () => res.emit('finish');
  (res as any).close = () => res.emit('close');
  return res;
}

const inFlight = async () =>
  (await httpRequestsInFlight.get()).values.reduce((s, v) => s + v.value, 0);

beforeEach(() => {
  httpRequestDurationSeconds.reset();
  httpRequestsInFlight.reset();
});

describe('Y0b-5 T13：HTTP RED 计时+在飞 gauge', () => {
  it('finish 后 observe http_request_duration_seconds{method,route,status}+gauge 归零', async () => {
    const res = mockRes(201);
    httpRedMiddleware(mockReq('/api/execution/execute', 'POST'), res, () => {});
    expect(await inFlight()).toBe(1);
    res.finish();
    expect(await inFlight()).toBe(0);
    const v = (await httpRequestDurationSeconds.get()).values.find(
      (m) => m.metricName === 'http_request_duration_seconds_count',
    );
    expect(v).toBeDefined();
    expect(v?.labels).toMatchObject({ method: 'POST', route: '/api/execution/execute', status: '201' });
    expect(v?.value).toBe(1);
  });

  it('在飞 gauge inc/dec 配对：并发 3 峰值断言（3 未完成=3；全部完成=0）', async () => {
    const rs = [mockRes(), mockRes(), mockRes()];
    for (const r of rs) httpRedMiddleware(mockReq('/api/x'), r, () => {});
    expect(await inFlight()).toBe(3);
    for (const r of rs) r.finish();
    expect(await inFlight()).toBe(0);
  });

  it('异常路径：客户端 abort 只触发 close（无 finish）→ dec 配对+照常 observe（gauge 不悬挂）+status=499（nginx 惯例——abort 时 statusCode 停留默认 200，计为成功即失真）', async () => {
    const res = mockRes(200);
    httpRedMiddleware(mockReq('/api/x'), res, () => {});
    expect(await inFlight()).toBe(1);
    res.close();
    expect(await inFlight()).toBe(0);
    const count = (await httpRequestDurationSeconds.get()).values.find(
      (m) => m.metricName === 'http_request_duration_seconds_count',
    );
    expect(count?.value).toBe(1);
    expect(count?.labels).toMatchObject({ status: '499' });
  });

  it('finish 与 close 双触发只记一次（配对严格——双 dec 即负值）+status 取 finish 时真实 statusCode（close 被去重短路不得改记 499）', async () => {
    const res = mockRes();
    httpRedMiddleware(mockReq('/api/x'), res, () => {});
    res.finish();
    res.close();
    expect(await inFlight()).toBe(0);
    const count = (await httpRequestDurationSeconds.get()).values.find(
      (m) => m.metricName === 'http_request_duration_seconds_count',
    );
    expect(count?.value).toBe(1);
    expect(count?.labels).toMatchObject({ status: '200' });
  });
});

describe('Y0b-5 T13：path 归一（route 标签防基数）', () => {
  it.each([
    ['/api/execution/jobs/12345', '/api/execution/jobs/:id'],                                    // plan 明示 /\d+→:id
    ['/api/canvas/cmabc123def456ghi789jkl12/shrink', '/api/canvas/:id/shrink'],                  // prisma cuid 路径段
    ['/api/media/550e8400-e29b-41d4-a716-446655440000', '/api/media/:id'],                       // uuid 形态兜底
    ['/api/video-separate/task-1739347200000', '/api/video-separate/:id'],                       // task-<毫秒> 混合段
    ['/api/execution/execute', '/api/execution/execute'],                                        // 静态段保留
    ['/api/health', '/api/health'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeRoute(input)).toBe(expected);
  });

  it('metric 定义在 *.metrics.ts（glob 门禁——middleware 内联定义=静默逃逸禁）', () => {
    expect(httpRequestDurationSeconds).toBeDefined();
    expect(httpRequestsInFlight).toBeDefined();
  });

  it('WS 帧不进 HTTP RED（显式声明）：collab 模块源码零 http-red 引用（独立端口服务不经主 app express 链——connectionId=T11 独立观测）', () => {
    const collabDir = join(__dirname, '..', 'modules', 'collab');
    const walk = (p: string): string[] =>
      readdirSync(p, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(p, e.name)) : e.name.endsWith('.ts') ? [join(p, e.name)] : [],
      );
    for (const f of walk(collabDir)) {
      const src = readFileSync(f, 'utf8');
      expect(src.includes('http-red') || src.includes('http_request_duration')).toBe(false);
    }
  });
});
