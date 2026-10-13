// apps/api/src/middleware/request-trace.middleware.ts —— Y0b-5 T13（W3C traceparent 折中）
// 入站读 traceparent 头严格校验（W3C 明文：version=00∧32hex trace-id∧16hex parent-id∧2hex flags∧
// trace-id/parent-id 非全零）→ 合法取 trace-id；否则 crypto.randomBytes(16) 新建——不合法丢弃禁宽松
// 解析（客户端可控输入）。ALS（node:async_hooks 内置）存 {traceId}；响应头 x-request-id=traceId 恒等；
// 不回声 traceparent 响应头（未开 tracing——采样位不回声）。
// ALS 不过 Redis：跨进程（BullMQ worker）显式 job.data.traceId 携带（execution.controller enqueue 点）
// ——processor 首行重建（execution.processor）。外呼出站/客户端上行 traceparent 不做（折中范围外）。
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface TraceContext {
  traceId: string;
}

/** HTTP 请求链 trace 上下文——WS 不经本中间件（collab connectionId=T11 独立，traceId 保持 null 预留位）。 */
export const requestTraceStorage = new AsyncLocalStorage<TraceContext>();

const TRACEPARENT_RE = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

/** W3C traceparent 严格校验（10.x：version 必须 00；全零 trace-id/parent-id 明文禁）——不合法返回 null。 */
export function parseInboundTraceparent(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string' || !TRACEPARENT_RE.test(header)) return null;
  const [version, traceId, parentId] = header.split('-');
  if (version !== '00') return null;
  if (/^0+$/.test(traceId) || /^0+$/.test(parentId)) return null;
  return traceId;
}

/** 服务端生成 32hex（零新依赖）。 */
export const newTraceId = (): string => randomBytes(16).toString('hex');

export function requestTraceMiddleware(req: Request, res: Response, next: NextFunction): void {
  const traceId = parseInboundTraceparent(req.headers['traceparent']) ?? newTraceId();
  res.setHeader('x-request-id', traceId); // ≡traceId 恒等；禁设 traceparent 响应头（未开 tracing 不回声采样位）
  requestTraceStorage.run({ traceId }, next);
}
