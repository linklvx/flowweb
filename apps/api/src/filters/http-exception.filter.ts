import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const message = exception.message;

    // 批3-3：BusinessException.getResponse() 携带 errorCode（37 处业务码此前全被丢弃）——透出进 body，
    // 消费面只做 collab 相关档位（0.5-8b 已透）；非 BusinessException 不伪造该字段
    const body = exception.getResponse();
    const errorCode = typeof body === 'object' && body !== null ? (body as { errorCode?: string }).errorCode : undefined;

    response.status(status).json({
      code: -1,
      data: null,
      message,
      ...(errorCode ? { errorCode } : {}),
    });
  }
}
