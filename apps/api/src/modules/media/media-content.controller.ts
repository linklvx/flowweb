// apps/api/src/modules/media/media-content.controller.ts —— Y1a+Y1b T5（v11 骨架「读 ACL 团队级单门+content 两态」）
// 读路径唯一入口：GET/HEAD /api/media/:fileId/content（鉴权=AuthGuard 会话；单门=MediaService.findReadable
// →assertTeamMember(Media.teamId)+已发布作品兜底）。两态：
//  ready(completed)：生产档 MEDIA_X_ACCEL_PREFIX 已设 → X-Accel-Redirect /internal-media/<bucket>/<key>
//   （nginx internal location 承载字节/Range/ETag——**不 302 公网 presign**；部署窗手测项，见
//   deploy/nginx/internal-media-location.replace.conf）；未设（dev/CI）→ API 直流 S3（Range/HEAD/ETag/304/206/416）。
//  processing：SafeRemoteFetch allowlist 流式代理 sourceUrl（no-store+限长；超限 410/未就绪 425+Retry-After）。
// 安全响应头：nosniff 恒置；非白名单 MIME（isAllowedUploadMime）一律 attachment。
// 旁路删除注记：GET /:fileId/url 端点已删（404）；POST /media/batch 响应降级 content 路由引用（media-batch.service）。
import { Controller, Get, Head, Req, Param, Query, Res, Inject } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
// Readable.fromWeb 消费点：cappedStream（web ReadableStream——SafeRemoteFetch 限长包装）→ Node 管道
import { MediaService } from './media.service';
import { MinioService } from '../minio/minio.service';
import { SafeRemoteFetchService } from './safe-remote-fetch.service';
import { isAllowedUploadMime } from './media-registration.service';

const RETRY_AFTER_SEC = '60';

@Controller('api/media')
export class MediaContentController {
  // 显式 @Inject（media.controller 同款——vitest esbuild 不发射 decorator metadata，类型注入仅生产 tsc 可用）
  constructor(
    @Inject(MediaService) private readonly mediaService: MediaService,
    @Inject(MinioService) private readonly minio: MinioService,
    @Inject(SafeRemoteFetchService) private readonly safeFetch: SafeRemoteFetchService,
  ) {}

  @Get(':fileId/content')
  @Head(':fileId/content')
  async content(
    @Req() req: Request & { user?: { id: string } },
    @Param('fileId') fileId: string,
    @Query('variant') variant: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const media = await this.mediaService.findReadable(fileId, req.user?.id);
    if (!media) { res.status(404).end(); return; }

    if (media.status === 'failed') { res.status(410).end(); return; }
    if (media.status !== 'completed' && media.status !== 'processing') { res.status(404).end(); return; } // pending：对象未 confirm 不可读

    if (variant === 'thumbnail') {
      if (media.status !== 'completed' || !media.thumbnailKey) { res.status(404).end(); return; }
      await this.serveReady(req, res, media, media.thumbnailKey);
      return;
    }
    if (media.status === 'processing') {
      await this.serveProcessing(req, res, media);
      return;
    }
    await this.serveReady(req, res, media, media.key);
  }

  // ── ready 态 ──
  private async serveReady(
    req: Request & { user?: { id: string } },
    res: Response,
    media: { key: string; bucket: string; mimeType: string; sniffedMimeType: string | null; originalName: string },
    objectKey: string,
  ): Promise<void> {
    const contentType = media.sniffedMimeType || media.mimeType;
    this.setCommonHeaders(res, contentType, media.originalName, 'private, max-age=3600');

    const accelPrefix = process.env.MEDIA_X_ACCEL_PREFIX;   // 生产 nginx 内部 location（deploy/nginx 片段）
    if (accelPrefix) {
      // X-Accel：API 零字节搬运——nginx 按 internal location 读文件并原生处理 Range/If-None-Match/206/304
      res.status(200);
      res.setHeader('X-Accel-Redirect', `${accelPrefix}/${media.bucket}/${objectKey}`);
      res.end();
      return;
    }

    const range = req.headers.range as string | undefined;
    const ifNoneMatch = (req.headers['if-none-match'] as string | undefined)?.trim();

    // HEAD（或 If-None-Match 条件 GET，无 Range）：statObject 头元数据判定——304 不发 body
    if (req.method === 'HEAD' || (ifNoneMatch && !range)) {
      const stat = await this.stat(res, objectKey);
      if (!stat) return; // 已响应（stat 内部映射 404/416）
      const { etag, size } = stat;
      if (req.method === 'GET' && ifNoneMatch && etag && (ifNoneMatch === etag || ifNoneMatch === 'W/' + etag || ifNoneMatch === '*')) {
        res.status(304);
        if (etag) res.setHeader('ETag', etag);
        res.end();
        return;
      }
      if (req.method === 'HEAD') {
        res.status(200);
        res.setHeader('Content-Length', size);
        res.setHeader('Accept-Ranges', 'bytes');
        if (etag) res.setHeader('ETag', etag);
        res.end();
        return;
      }
      // 条件未命中：落到全量 GET
    }

    try {
      const r = await this.minio.getObjectRanged(objectKey, range);
      res.status(r.status);
      res.setHeader('Accept-Ranges', 'bytes');
      if (r.etag) res.setHeader('ETag', r.etag);
      if (r.contentLength != null) res.setHeader('Content-Length', r.contentLength);
      if (r.contentRange) res.setHeader('Content-Range', r.contentRange);
      await pipeline(r.stream, res);   // S3 SDK Body=Node Readable 直管道
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (status === 416) {
        const size = await this.minio.statObject(objectKey).then((s) => s.ContentLength ?? 0).catch(() => 0);
        res.status(416);
        res.setHeader('Content-Range', `bytes */${size}`);
        res.end();
        return;
      }
      if (status === 404) { res.status(404).end(); return; }  // 行在对象亡（孤儿）——不虚构内容
      throw err;
    }
  }

  /** statObject 统一出口（HEAD 与 416 补 size 复用）——对象缺失/异常映射 404 */
  private async stat(res: Response, objectKey: string): Promise<{ etag: string | null; size: number } | null> {
    try {
      const s = await this.minio.statObject(objectKey);
      return { etag: s.ETag ?? null, size: s.ContentLength ?? 0 };
    } catch {
      res.status(404).end();
      return null;
    }
  }

  // ── processing 态（SafeRemoteFetch allowlist 流式代理 sourceUrl）──
  private async serveProcessing(
    req: Request & { user?: { id: string } },
    res: Response,
    media: { sourceUrl: string | null; mimeType: string; sniffedMimeType: string | null; originalName: string },
  ): Promise<void> {
    if (!media.sourceUrl) {
      res.status(425);                        // Too Early：materialize 未落，稍后重试
      res.setHeader('Retry-After', RETRY_AFTER_SEC);
      res.end();
      return;
    }
    let opened: Awaited<ReturnType<SafeRemoteFetchService['open']>>;
    try {
      opened = await this.safeFetch.open(media.sourceUrl, { range: req.headers.range as string | undefined });
    } catch {
      // SSRF 门拒/DNS/网络/超时——不透传上游细节（防探测）；对象终将 materialize，客户端重试
      res.status(502).end();
      return;
    }
    if (opened.oversize) {
      await opened.upstream?.body?.cancel().catch(() => { /* upstream null（预检即拒）无面 */ });
      res.status(410);                        // 代理侧拒绝大对象——等 materialize 后走 ready
      res.setHeader('Retry-After', RETRY_AFTER_SEC);
      res.end();
      return;
    }
    const upstream = opened.upstream!;
    if (upstream.status < 200 || upstream.status >= 300) {
      await upstream.body?.cancel().catch(() => {});
      res.status(502).end();
      return;
    }
    const upstreamType = upstream.headers.get('content-type') || media.sniffedMimeType || media.mimeType;
    this.setCommonHeaders(res, upstreamType, media.originalName, 'no-store');
    res.status(upstream.status);
    const passthrough = ['content-length', 'content-range', 'etag', 'accept-ranges'] as const;
    for (const h of passthrough) {
      const v = upstream.headers.get(h);
      if (v != null) res.setHeader(h, v);
    }
    if (opened.cappedStream) {
      await pipeline(Readable.fromWeb(opened.cappedStream as never), res).catch(() => {
        /* 限长截断/上游中断：连接已半写——只能断流（Content-Length 若在则客户端自行察觉短读） */
      });
    } else {
      res.end();
    }
  }

  private setCommonHeaders(res: Response, contentType: string, originalName: string, cacheControl: string): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', cacheControl);
    const disposition = isAllowedUploadMime(contentType) ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(originalName ?? 'file')}`);
  }
}
