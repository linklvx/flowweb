// apps/api/src/modules/collab/deletion-barrier.port.spec.ts
// C3b-4a spec 评审 P1-1 红测：HttpDeletionBarrierPort 请求契约（fetchImpl 假体对拍——零网络零 DB）。
// 修前红相：请求 URL=/api/collab/deletion-barrier（漏 /doc 段——controller 实际路由
// @Controller('api/collab/doc')+@Post('deletion-barrier')=/api/collab/doc/deletion-barrier）⇒ 生产
// erasure worker 全 404 且原实现零测试覆盖（出厂即断）。本 spec 锚死五面：URL 全字面/方法/token
// Authorization 头/载荷 action 分发/响应解析（release.released+prepare wire 透传+非 2xx throw）。
import { describe, it, expect } from 'vitest';
import { HttpDeletionBarrierPort } from './deletion-barrier.port';

type Recorded = { url: string; init: { method: string; headers: Record<string, string>; body?: string } };

/** fetchImpl 假体（记录+可编程应答——CollabWritePort http.spec 同族装置）。 */
function fakeFetch(status: number, respond: () => unknown) {
  const calls: Recorded[] = [];
  const fetchImpl = async (url: string, init: Recorded['init']): Promise<{ status: number; json(): Promise<unknown> }> => {
    calls.push({ url, init });
    return { status, json: async () => respond() };
  };
  return { calls, fetchImpl };
}

describe('C3b-4a spec 评审 P1-1：HttpDeletionBarrierPort 请求契约（URL 含 /doc 段——修前必 404 面）', () => {
  it('release：URL/方法/token 头/载荷四面对拍+{released} 解析', async () => {
    const { calls, fetchImpl } = fakeFetch(200, () => ({ released: true }));
    const port = new HttpDeletionBarrierPort({ baseUrl: 'http://127.0.0.1:9', token: 'tok-p1', fetchImpl });
    await expect(port.release('t1', 'b1')).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://127.0.0.1:9/api/collab/doc/deletion-barrier');   // P1-1 锚：/doc 段全字面（漏段即红）
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers.authorization).toBe('Bearer tok-p1');   // WORKER_WRITE_TOKEN 传输层
    expect(calls[0].init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(calls[0].init.body ?? '{}')).toEqual({ action: 'release', teamId: 't1', barrierId: 'b1' });
  });

  it('prepare：excludeProjectId 载荷透传+wire 形 verified 解析（pgSeq string+expiresAt epoch ms——JSON 契约）', async () => {
    const { calls, fetchImpl } = fakeFetch(200, () => ({ outcome: 'verified', barrierId: 'bx', expiresAt: 123456, projects: [{ projectId: 'p1', pgSeq: '7' }] }));
    const port = new HttpDeletionBarrierPort({ baseUrl: 'http://127.0.0.1:9', token: 'tok-p1', fetchImpl });
    await expect(port.prepare('t1', { excludeProjectId: 'p2' })).resolves.toEqual({
      outcome: 'verified', barrierId: 'bx', expiresAt: 123456, projects: [{ projectId: 'p1', pgSeq: '7' }],   // C3b-5：expiresAt=消费方 budget 自查锚
    });
    expect(JSON.parse(calls[0].init.body ?? '{}')).toEqual({ action: 'prepare', teamId: 't1', excludeProjectId: 'p2' });
  });

  it('非 2xx=throw（调用方退避重试——错误档只剩传输/鉴权面）', async () => {
    const { fetchImpl } = fakeFetch(404, () => ({ message: 'not found' }));
    const port = new HttpDeletionBarrierPort({ baseUrl: 'http://127.0.0.1:9', token: 'tok-p1', fetchImpl });
    await expect(port.release('t1', 'b1')).rejects.toThrow('deletion-barrier endpoint 404');
  });
});
