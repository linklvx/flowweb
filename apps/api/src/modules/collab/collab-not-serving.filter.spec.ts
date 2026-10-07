// apps/api/src/modules/collab/collab-not-serving.filter.spec.ts
// Y0a-3（V21）：COLLAB_NOT_SERVING 503 统一附 Retry-After: 2——跨端契约（Y0b 前端分型消费）意图锚：
// 响应体含 code:'COLLAB_NOT_SERVING' + 头含 Retry-After: 2；非标记异常不误伤（委托默认异常处理）。
import { describe, it, expect, vi } from 'vitest';
import { ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { CollabNotServingFilter } from './collab-not-serving.filter';

function makeRes() {
  const json = vi.fn();
  const res = {
    status: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    json,
  };
  return { res, json };
}
const makeHost = (res: any) =>
  ({ switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ url: '/x' }) }) }) as any;

describe('CollabNotServingFilter（V21）', () => {
  it('COLLAB_NOT_SERVING 503 → 完整写响应：Retry-After: 2 + 体含 code', () => {
    const filter = new CollabNotServingFilter();
    const { res, json } = makeRes();
    const ex = new ServiceUnavailableException({ code: 'COLLAB_NOT_SERVING', message: 'collab not serving' });

    filter.catch(ex, makeHost(res));

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '2');
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'COLLAB_NOT_SERVING' }));
  });

  it('非标记 503（spool degraded 等）→ 委托默认异常处理：不附 Retry-After、同壳 code:-1', () => {
    const filter = new CollabNotServingFilter();
    const { res, json } = makeRes();
    const ex = new ServiceUnavailableException('collab degraded: lease or spool');

    filter.catch(ex, makeHost(res));

    expect(res.setHeader).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: -1, message: 'collab degraded: lease or spool' }));
  });

  it('非 503 异常 → 委托默认异常处理（本 filter 不接管）', () => {
    const filter = new CollabNotServingFilter();
    const { res, json } = makeRes();
    const ex = new BadRequestException('bad');

    filter.catch(ex, makeHost(res));

    expect(res.setHeader).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: -1, message: 'bad' }));
  });
});
