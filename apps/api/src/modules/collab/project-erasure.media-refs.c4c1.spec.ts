// apps/api/src/modules/collab/project-erasure.media-refs.c4c1.spec.ts
// C4-c1（plan C4——project-erasure）：collectMediaRefs 内部端点+worker 侧采集器单测（无 DB——
// 守卫三分+分片+不可达折 null fail-closed）。断言面：
//  - service 守卫：限批（>ERASURE_MEDIA_REFS_BATCH→400）/非 serving（docs 未注入裸构造∧lease 未持
//    有→503）/他项目超扫描上界（503）——「容量事故防护」两道+保守拒；
//  - 扫描面：team 他项目（含被排除项目过滤）doc 引用交集返回；
//  - httpMediaRefsCollector：200 引用子集返回/非 200+网络错误→null（fail-closed 本轮暂停）/
//    >限批自动分片（两次 fetch）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { CollabSpoolService, ERASURE_MEDIA_REFS_BATCH, type MediaRefsDocsPort } from './collab-spool.service';
import { httpMediaRefsCollector } from './project-erasure.stages';

/** docs 端口 stub（withSession 形——直接回 refs 载荷，绕开真 doc 扫描回调〔端点行为=透传扫描结果〕）。 */
const docsStub = (refsByProject: Record<string, string[]>, serving = true) => ({
  isLeaseServing: () => serving,
  withSession: async (pid: string, _fn: unknown) => (refsByProject[pid] ?? []).map((mediaId) => ({ mediaId })),
});
const prismaStub = (projectIds: string[]) => ({
  canvasProject: { findMany: async () => projectIds.map((id) => ({ id })) },
});

describe('C4-c1 collectMediaRefs 内部端点（service 面）', () => {
  it('非 serving（lease 未持有）→503 fail-closed（调用方本轮暂停不删）', async () => {
    const spool = new CollabSpoolService();
    await expect(spool.collectProjectMediaRefs(
      { teamId: 't', excludeProjectId: 'p1', mediaIds: ['m1'] },
      { docs: docsStub({}, false) as unknown as MediaRefsDocsPort, prisma: prismaStub(['p2']) as never },
    )).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('限批：mediaIds 超限批→400（worker 侧应分片——容量防护）', async () => {
    const spool = new CollabSpoolService();
    const tooMany = Array.from({ length: ERASURE_MEDIA_REFS_BATCH + 1 }, (_, i) => `m${i}`);
    await expect(spool.collectProjectMediaRefs(
      { teamId: 't', excludeProjectId: 'p1', mediaIds: tooMany },
      { docs: docsStub({}) as unknown as MediaRefsDocsPort, prisma: prismaStub(['p2']) as never },
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it('他项目超扫描上界→503 保守拒（引用图不完整禁判）', async () => {
    const spool = new CollabSpoolService();
    const many = Array.from({ length: 501 }, (_, i) => `p${i}`);
    await expect(spool.collectProjectMediaRefs(
      { teamId: 't', excludeProjectId: 'p-not-in-list', mediaIds: ['m1'] },
      { docs: docsStub({}) as unknown as MediaRefsDocsPort, prisma: prismaStub(many) as never },
    )).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('扫描面：他项目 doc 引用交集返回（excludeProjectId 过滤+wanted 交集）', async () => {
    const spool = new CollabSpoolService();
    const refs = await spool.collectProjectMediaRefs(
      { teamId: 't', excludeProjectId: 'p1', mediaIds: ['m1', 'm2', 'm3'] },
      { docs: docsStub({ p2: ['m1', 'm9'], p3: ['m2'] }) as unknown as MediaRefsDocsPort, prisma: prismaStub(['p1', 'p2', 'p3']) as never },
    );
    expect([...refs].sort()).toEqual(['m1', 'm2']);   // p1 被排除（自引用不算）；m9 非 wanted 不返
  });
});

describe('C4-c1 httpMediaRefsCollector（worker 侧客户端面）', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('200 引用子集返回；非 200→null（fail-closed）；网络错误→null', async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, json: async () => ({ referenced: ['m1'] }) }));
    vi.stubGlobal('fetch', fetchMock);
    const collect = httpMediaRefsCollector({ baseUrl: 'http://127.0.0.1:3000', token: 'tk' });
    expect(await collect({ teamId: 't', excludeProjectId: 'p1', mediaIds: ['m1', 'm2'] })).toEqual(['m1']);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:3000/api/collab/doc/media-refs', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer tk' }),
    }));
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 503, json: async () => ({}) })));
    expect(await collect({ teamId: 't', excludeProjectId: 'p1', mediaIds: ['m1'] })).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    expect(await collect({ teamId: 't', excludeProjectId: 'p1', mediaIds: ['m1'] })).toBeNull();
  });

  it('分片：mediaIds 超限批→两次 fetch（chunk=ERASURE_MEDIA_REFS_BATCH）', async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: { body?: string }) => ({ status: 200, json: async () => ({ referenced: [] }), body: init?.body }));
    vi.stubGlobal('fetch', fetchMock);
    const collect = httpMediaRefsCollector();
    const ids = Array.from({ length: ERASURE_MEDIA_REFS_BATCH + 1 }, (_, i) => `m${i}`);
    expect(await collect({ teamId: 't', excludeProjectId: 'p1', mediaIds: ids })).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String((fetchMock.mock.calls[0]![1] as { body?: string }).body)).toContain(`m${ERASURE_MEDIA_REFS_BATCH - 1}`);
  });
});
