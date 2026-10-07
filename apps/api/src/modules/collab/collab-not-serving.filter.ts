// apps/api/src/modules/collab/collab-not-serving.filter.ts
// Y0a-3（V21）：COLLAB_NOT_SERVING 503 统一附 Retry-After: 2（Y0b 前端分型消费的跨端契约——本批定死）。
// Nest10 异常过滤链=首中即止（selectExceptionFilterMetadata 为 find 语义，filter 内 rethrow 不落
// 后续 filter——链式透传不成立），故按 plan 预案走**完整写响应**；非标记异常委托默认
// HttpExceptionFilter 同壳透出（不误伤其他 ServiceUnavailableException）。
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { Response } from 'express';
import { HttpExceptionFilter } from '../../filters/http-exception.filter';

@Catch(ServiceUnavailableException)
export class CollabNotServingFilter implements ExceptionFilter {
  private readonly fallback = new HttpExceptionFilter();

  catch(exception: HttpException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const body = exception.getResponse();
    const marked =
      typeof body === 'object' && body !== null && (body as { code?: string }).code === 'COLLAB_NOT_SERVING';
    if (marked) {
      res.status(exception.getStatus()).setHeader('Retry-After', '2').json(body);
      return;
    }
    this.fallback.catch(exception, host);
  }
}
