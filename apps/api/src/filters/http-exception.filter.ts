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
    // 消费面只做 collab 相关档位（0.5-8b 已透）；非 BusinessException 不伪造该字段。
    // T19 登记收口（存量）：对象响应体的自定义字段整体透传（此前白名单只捞 errorCode——
    // V21 对象响应体等携带的自定义字段全丢）。剥离 Nest 内部结构键（statusCode/message/error）
    // 后 spread 剩余——裸 HttpException 零自定义字段=零变化。
    const body = exception.getResponse();
    let custom: Record<string, unknown> = {};
    if (typeof body === 'object' && body !== null) {
      const { statusCode: _s, message: _m, error: _e, ...rest } = body as Record<string, unknown>;
      custom = rest;
    }

    response.status(status).json({
      code: -1,
      data: null,
      message,
      ...custom,
    });
  }
}
