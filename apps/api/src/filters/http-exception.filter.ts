import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { Response } from 'express';

// 【T19 评审#8·信封键碰撞语义钉明】透传段 custom 字段若与信封键同名（code/data/message）会
// **覆盖**信封值（spread 序在后胜出）——语义裁定：①HTTP 状态码恒以 getStatus() 为准（response
// .status 先行，body 内键不改变真实状态码——碰撞只影响 body 字段）；②custom.message 覆盖
// message=异常构造方显式意图（对象响应体形态 HttpException({message,...}) 本就携带自定义
// message——透传优先于 exception.message 是 T19 登记收口的修复目标本体）；③custom.code/data
// 覆盖同理（全仓 BusinessException 族只携 errorCode——现实零碰撞；未来携带方自担显式意图）。
// web 消费面论证（碰撞不可见的路径依据）：apps/web apiFetch（client.ts）分两路——非 2xx（本
// filter 管辖域）读 body.message/errorCode/retryAfter+HTTP status（**不读 body.code**——code 检查
// 仅在 2xx 成功路 `json.code !== 0`，而成功信封 code:0 产自 TransformInterceptor 非 filter 域）；
// 故 custom.code 覆盖信封 -1 对 web 错误消费路径不可见；服务端响应码权威=status() 不受影响。
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
