// apps/api/src/modules/media/media-content.controller.spec.ts —— Y1a+Y1b T5 红测（unit）
// content 两态的映射层：ready=X-Accel（生产 env 门）/流式（dev——Range/HEAD/ETag/304/206/416）；
// processing=SafeRemoteFetch 代理（no-store+超限 410/未就绪 425+Retry-After+上游非 2xx 502）；
// nosniff+非白名单 attachment。真 S3/真 PG 的 ready 态全链归 media-content.int.spec（CI rustfs/本地 MinIO）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Writable, Readable } from 'node:stream';
import type { Response } from 'express';
import { MediaContentController } from './media-content.controller';
import type { MediaService } from './media.service';
import type { MinioService } from '../minio/minio.service';
import type { SafeRemoteFetchService } from './safe-remote-fetch.service';

const mediaRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'm1', teamId: 't1', bucket: 'flowai', key: 'results/u/p/n/d/a.mp4',
  mimeType: 'video/mp4', sniffedMimeType: null, status: 'completed',
  sourceUrl: null, originalName: 'a.mp4', deletedAt: null, thumbnailKey: 'thumb/t1.jpg', ...over,
});

function fakeRes(): Response & { chunks: Buffer[]; statusCode: number; headers: Record<string, unknown> } {
  const r: any = new Writable({
    write(chunk, _enc, cb) { r.chunks.push(Buffer.from(chunk)); cb(); },
  });
  r.chunks = [];
  r.statusCode = 200;
  r.headers = {};
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.setHeader = (k: string, v: unknown) => { r.headers[k.toLowerCase()] = v; return r; };
  r.getHeader = (k: string) => r.headers[String(k).toLowerCase()];
  return r as never;
}

const nodeStream = (bytes: string | Buffer) =>
  new Readable({ read() { this.push(Buffer.from(bytes)); this.push(null); } });

describe('MediaContentController（content 两态映射）', () => {
  let minio: any;
  let safeFetch: any;
  let controller: MediaContentController;
  let mediaService: { findReadable: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.unstubAllEnvs();
    minio = {
      statObject: vi.fn().mockResolvedValue({ ETag: '"etag1"', ContentLength: 5 }),
      getObjectRanged: vi.fn().mockResolvedValue({ status: 200, stream: nodeStream('hello'), contentLength: 5, contentRange: null, etag: '"etag1"' }),
    };
    safeFetch = { open: vi.fn() };
    mediaService = { findReadable: vi.fn().mockResolvedValue(mediaRow()) };
    controller = new MediaContentController(mediaService as unknown as MediaService, minio as MinioService, safeFetch as SafeRemoteFetchService);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('ready 流式 GET：200+Content-Type(sniffed 优先)+nosniff+ETag+Accept-Ranges+Content-Length+inline 白名单 disposition', async () => {
    mediaService.findReadable.mockResolvedValue(mediaRow({ sniffedMimeType: 'video/mp4' }));
    const res = fakeRes();
    await controller.content({ user: { id: 'u1' }, method: 'GET', headers: {} } as never, 'm1', undefined, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('video/mp4');           // sniffed 优先于 declared
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['etag']).toBe('"etag1"');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-length']).toBe(5);
    expect(String(res.headers['content-disposition'])).toMatch(/^inline/);
    expect(res.chunks.map((c) => c.toString()).join('')).toBe('hello');
  });

  it('非白名单 MIME → attachment（filename* 编码）+nosniff 不变', async () => {
    mediaService.findReadable.mockResolvedValue(mediaRow({ mimeType: 'application/zip', sniffedMimeType: 'application/zip', originalName: 'a.zip' }));
    const res = fakeRes();
    await controller.content({ user: { id: 'u1' }, method: 'GET', headers: {} } as never, 'm1', undefined, res);
    expect(String(res.headers['content-disposition'])).toMatch(/^attachment; filename\*=UTF-8''/);
  });

  it('Range 透传：206+Content-Range（视频可拖动——mediabunny UrlSource 依赖顺序读）', async () => {
    minio.getObjectRanged.mockResolvedValue({ status: 206, stream: nodeStream('ell'), contentLength: 3, contentRange: 'bytes 1-3/5', etag: '"etag1"' });
    const res = fakeRes();
    await controller.content({ user: { id: 'u1' }, method: 'GET', headers: { range: 'bytes=1-3' } } as never, 'm1', undefined, res);
    expect(minio.getObjectRanged).toHaveBeenCalledWith(expect.any(String), 'bytes=1-3');
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 1-3/5');
  });

  it('Range 不可满足：416+Content-Range: bytes */size', async () => {
    minio.getObjectRanged.mockRejectedValue(Object.assign(new Error('InvalidRange'), { $metadata: { httpStatusCode: 416 } }));
    const res = fakeRes();
    await controller.content({ user: { id: 'u1' }, method: 'GET', headers: { range: 'bytes=999-' } } as never, 'm1', undefined, res);
    expect(res.statusCode).toBe(416);
    expect(res.headers['content-range']).toBe('bytes */5');
  });

  it('HEAD：statObject 头元数据无 body；If-None-Match 命中 → 304+ETag', async () => {
    const head = fakeRes();
    await controller.content({ user: { id: 'u1' }, method: 'HEAD', headers: {} } as never, 'm1', undefined, head);
    expect(head.statusCode).toBe(200);
    expect(head.headers['content-length']).toBe(5);
    expect(head.chunks).toHaveLength(0);
    const notMod = fakeRes();
    await controller.content({ user: { id: 'u1' }, method: 'GET', headers: { 'if-none-match': '"etag1"' } } as never, 'm1', undefined, notMod);
    expect(notMod.statusCode).toBe(304);
    expect(notMod.headers['etag']).toBe('"etag1"');
    expect(notMod.chunks).toHaveLength(0);
  });

  it('X-Accel 生产档（MEDIA_X_ACCEL_PREFIX 已设）：X-Accel-Redirect=/internal-media/<bucket>/<key>——不 302 公网 presign，零对象读（nginx 内部 location 承载 Range/ETag）', async () => {
    vi.stubEnv('MEDIA_X_ACCEL_PREFIX', '/internal-media');
    const res = fakeRes();
    await controller.content({ user: { id: 'u1' }, method: 'GET', headers: { range: 'bytes=1-3' } } as never, 'm1', undefined, res);
    expect(res.headers['x-accel-redirect']).toBe('/internal-media/flowai/results/u/p/n/d/a.mp4');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(minio.getObjectRanged).not.toHaveBeenCalled();   // API 零字节搬运
    expect(res.headers['content-length']).toBeUndefined();  // nginx 按文件自算
    expect(res.chunks).toHaveLength(0);
  });

  it('processing 代理：no-store+nosniff+上游流透传（2xx）', async () => {
    safeFetch.open.mockResolvedValue({ oversize: false, upstream: { status: 200, headers: new Headers({ 'content-type': 'video/mp4' }) }, cappedStream: Readable.toWeb(nodeStream('prox')) });
    mediaService.findReadable.mockResolvedValue(mediaRow({ status: 'processing', sourceUrl: 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/x.mp4', mimeType: 'video/mp4' }));
    const res = fakeRes();
    await controller.content({ user: { id: 'u1' }, method: 'GET', headers: {} } as never, 'm1', undefined, res);
    expect(safeFetch.open).toHaveBeenCalledWith('https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/x.mp4', expect.anything());
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.chunks.map((c) => c.toString()).join('')).toBe('prox');
  });

  it('processing 超限：410+Retry-After（materialize 后走 ready——代理侧拒绝大对象）', async () => {
    safeFetch.open.mockResolvedValue({ oversize: true, upstream: null, cappedStream: null });
    mediaService.findReadable.mockResolvedValue(mediaRow({ status: 'processing', sourceUrl: 'https://x.aliyuncs.com/big.mp4' }));
    const res = fakeRes();
    await controller.content({ user: { id: 'u1' }, method: 'GET', headers: {} } as never, 'm1', undefined, res);
    expect(res.statusCode).toBe(410);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('processing 无 sourceUrl：425 Too Early+Retry-After', async () => {
    mediaService.findReadable.mockResolvedValue(mediaRow({ status: 'processing', sourceUrl: null }));
    const res = fakeRes();
    await controller.content({ user: { id: 'u1' }, method: 'GET', headers: {} } as never, 'm1', undefined, res);
    expect(res.statusCode).toBe(425);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('processing 上游拒绝/SSRF 门拒/网络错：一律 502（不透传上游状态——防探测）', async () => {
    safeFetch.open.mockRejectedValue(new Error('not in allowlist'));
    mediaService.findReadable.mockResolvedValue(mediaRow({ status: 'processing', sourceUrl: 'https://evil.com/x' }));
    const res = fakeRes();
    await controller.content({ user: { id: 'u1' }, method: 'GET', headers: {} } as never, 'm1', undefined, res);
    expect(res.statusCode).toBe(502);

    safeFetch.open.mockResolvedValue({ oversize: false, upstream: { status: 403, headers: new Headers() }, cappedStream: null });
    const res2 = fakeRes();
    await controller.content({ user: { id: 'u1' }, method: 'GET', headers: {} } as never, 'm1', undefined, res2);
    expect(res2.statusCode).toBe(502);
  });

  it('状态路由：pending→404；failed→410；行缺失→404；thumbnail 变体无 thumbnailKey→404；thumbnail 变体读 thumbnailKey 对象', async () => {
    const run = async (row: Record<string, unknown> | null, variant?: string) => {
      mediaService.findReadable.mockResolvedValueOnce(row);
      const res = fakeRes();
      await controller.content({ user: { id: 'u1' }, method: 'GET', headers: {} } as never, 'm1', variant, res);
      return res;
    };
    expect((await run(mediaRow({ status: 'pending' }))).statusCode).toBe(404);
    expect((await run(mediaRow({ status: 'failed' }))).statusCode).toBe(410);
    expect((await run(null)).statusCode).toBe(404);
    expect((await run(mediaRow({ thumbnailKey: null }), 'thumbnail')).statusCode).toBe(404);
    const thumb = await run(mediaRow({}), 'thumbnail');
    expect(minio.getObjectRanged).toHaveBeenCalledWith('thumb/t1.jpg', undefined);
    expect(thumb.statusCode).toBe(200);
  });
});
