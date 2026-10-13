// apps/api/src/middleware/request-trace.middleware.spec.ts —— Y0b-5 T13 红测
// W3C traceparent 折中：入站严格校验（不合法丢弃新建——客户端可控输入禁宽松解析）+
// x-request-id≡traceId 恒等+ALS 上下文+采样位不回声（未开 tracing 不带 traceparent 响应头）。
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { requestTraceMiddleware, requestTraceStorage, parseInboundTraceparent, newTraceId } from './request-trace.middleware';

const VALID = (trace = '4bf92f3577b34da6a3ce929d0e0e4736', parent = '00f067aa0ba902b7', flags = '01') =>
  `00-${trace}-${parent}-${flags}`;

function mockReq(headers: Record<string, string> = {}): Request {
  return { headers, path: '/api/x', method: 'GET' } as unknown as Request;
}
type ResWithHeaders = Response & { stored: Record<string, unknown> };
function mockRes(): ResWithHeaders {
  const stored: Record<string, unknown> = {};
  const res = new EventEmitter() as unknown as ResWithHeaders;
  (res as any).stored = stored;
  (res as any).setHeader = (k: string, v: unknown) => { stored[k.toLowerCase()] = v; };
  (res as any).statusCode = 200;
  return res;
}

describe('Y0b-5 T13：入站 traceparent 严格校验（W3C 明文——不合法丢弃新建禁宽松解析）', () => {
  it('合法 traceparent（version=00+32hex trace-id+16hex parent-id+2hex flags）→ ALS.traceId=入站 trace-id', () => {
    const res = mockRes();
    let seen: string | undefined;
    requestTraceMiddleware(mockReq({ traceparent: VALID() }), res, () => {
      seen = requestTraceStorage.getStore()?.traceId;
    });
    expect(seen).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('version 非 00 → 丢弃入站、新建 32hex（客户端可控输入）', () => {
    const res = mockRes();
    let seen: string | undefined;
    requestTraceMiddleware(mockReq({ traceparent: `01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01` }), res, () => {
      seen = requestTraceStorage.getStore()?.traceId;
    });
    expect(seen).toMatch(/^[0-9a-f]{32}$/);
    expect(seen).not.toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('trace-id 全零（W3C 明文禁）→ 丢弃新建', () => {
    let seen: string | undefined;
    requestTraceMiddleware(
      mockReq({ traceparent: `00-${'0'.repeat(32)}-00f067aa0ba902b7-01` }),
      mockRes(),
      () => { seen = requestTraceStorage.getStore()?.traceId; },
    );
    expect(seen).toMatch(/^[0-9a-f]{32}$/);
  });

  it('parent-id 全零（W3C 明文禁）→ 丢弃新建', () => {
    let seen: string | undefined;
    requestTraceMiddleware(
      mockReq({ traceparent: `00-4bf92f3577b34da6a3ce929d0e0e4736-${'0'.repeat(16)}-01` }),
      mockRes(),
      () => { seen = requestTraceStorage.getStore()?.traceId; },
    );
    expect(seen).toMatch(/^[0-9a-f]{32}$/);
  });

  it('大写 hex / 长度错（31hex/15hex/flags 单字符）/非 hex 字符 → 全部丢弃新建（严格 [0-9a-f]）', () => {
    const bad = [
      `00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01`,  // 大写
      `00-4bf92f3577b34da6a3ce929d0e0e473-00f067aa0ba902b7-01`,   // trace-id 31 位
      `00-4bf92f3577b34da6a3ce929d0e0e47366-00f067aa0ba902b7-01`, // trace-id 33 位
      `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b-01`,   // parent-id 15 位
      `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-1`,   // flags 单字符
      `00-4bf92f3577b34da6a3ce929d0e0e47g6-00f067aa0ba902b7-01`,  // 非 hex 字符
      `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra`, // 多段
    ];
    for (const h of bad) {
      let seen: string | undefined;
      requestTraceMiddleware(mockReq({ traceparent: h }), mockRes(), () => {
        seen = requestTraceStorage.getStore()?.traceId;
      });
      expect(seen).toMatch(/^[0-9a-f]{32}$/);
      expect(seen).not.toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    }
  });

  it('无 traceparent 头 → 新建 32hex（crypto.randomBytes(16) 口径）', () => {
    const res = mockRes();
    let seen: string | undefined;
    requestTraceMiddleware(mockReq(), res, () => { seen = requestTraceStorage.getStore()?.traceId; });
    expect(seen).toMatch(/^[0-9a-f]{32}$/);
  });

  it('parseInboundTraceparent 表驱动：合法返回 trace-id，其余 null', () => {
    expect(parseInboundTraceparent(VALID())).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(parseInboundTraceparent(undefined)).toBeNull();
    expect(parseInboundTraceparent('')).toBeNull();
    expect(parseInboundTraceparent('garbage')).toBeNull();
    expect(parseInboundTraceparent(`00-${'0'.repeat(32)}-00f067aa0ba902b7-00`)).toBeNull();
  });

  it('newTraceId：32hex 且不重复', () => {
    const a = newTraceId();
    const b = newTraceId();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe('Y0b-5 T13：响应头 x-request-id≡traceId 恒等+采样位不回声', () => {
  it('x-request-id 响应头≡ALS traceId（id 我们生成故结构性成立——合法入站/新建两形态同断言）', () => {
    // 合法入站
    const r1 = mockRes();
    let seen1: string | undefined;
    requestTraceMiddleware(mockReq({ traceparent: VALID() }), r1, () => { seen1 = requestTraceStorage.getStore()?.traceId; });
    expect(r1.stored['x-request-id']).toBe(seen1);
    expect(r1.stored['x-request-id']).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    // 新建
    const r2 = mockRes();
    let seen2: string | undefined;
    requestTraceMiddleware(mockReq(), r2, () => { seen2 = requestTraceStorage.getStore()?.traceId; });
    expect(r2.stored['x-request-id']).toBe(seen2);
    expect(r2.stored['x-request-id']).toMatch(/^[0-9a-f]{32}$/);
  });

  it('不回声 traceparent 响应头（未开 tracing ⇒ 不带 traceparent 响应头）', () => {
    const res = mockRes();
    const next = vi.fn(() => {});
    requestTraceMiddleware(mockReq({ traceparent: VALID() }), res, next);
    expect(next).toHaveBeenCalled();
    expect(res.stored['traceparent']).toBeUndefined();
  });

  it('ALS 在 next 返回后关闭（无上下文泄漏）', () => {
    const res = mockRes();
    requestTraceMiddleware(mockReq(), res, () => {});
    expect(requestTraceStorage.getStore()).toBeUndefined();
  });
});
