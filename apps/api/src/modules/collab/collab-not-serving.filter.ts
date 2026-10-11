// apps/api/src/modules/collab/collab-not-serving.filter.ts
// Y0a-3（V21）：COLLAB_NOT_SERVING 503 统一附 Retry-After: 2（Y0b 前端分型消费的跨端契约——本批定死）。
// Nest10 异常过滤链=首中即止（selectExceptionFilterMetadata 为 find 语义，filter 内 rethrow 不落
// 后续 filter——链式透传不成立），故按 plan 预案走**完整写响应**；非标记异常委托默认
// HttpExceptionFilter 同壳透出（不误伤其他 ServiceUnavailableException）。
// Y0b-4 T8：扩 SHRINK_BUSY 码（shrink 信号量排队超时——Retry-After: 10 与队列超时上界同值）。
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { Response } from 'express';
import { HttpExceptionFilter } from '../../filters/http-exception.filter';

/** 标记码→Retry-After 秒（COLLAB_NOT_SERVING 族同壳——503 语义化分型） */
const RETRY_AFTER_BY_CODE: Record<string, string> = {
  COLLAB_NOT_SERVING: '2',
  SHRINK_BUSY: '10',
};

@Catch(ServiceUnavailableException)
export class CollabNotServingFilter implements ExceptionFilter {
  private readonly fallback = new HttpExceptionFilter();

  catch(exception: HttpException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const body = exception.getResponse();
    const code = typeof body === 'object' && body !== null ? (body as { code?: string }).code : undefined;
    const retryAfter = code !== undefined ? RETRY_AFTER_BY_CODE[code] : undefined;
    if (retryAfter !== undefined) {
      res.status(exception.getStatus()).setHeader('Retry-After', retryAfter).json(body);
      return;
    }
    this.fallback.catch(exception, host);
  }
}
