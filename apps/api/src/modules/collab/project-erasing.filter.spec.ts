// apps/api/src/modules/collab/project-erasing.filter.spec.ts
// C4-b（R15 fence 接线·质量评审 Important#2）：ProjectErasingError→409 统一映射意图锚——
// 响应体含 code:'PROJECT_ERASING'+scopeType/scopeId 透传（fence 写点窄竞窗兜底）。
import { describe, it, expect, vi } from 'vitest';
import { ProjectErasingFilter } from './project-erasing.filter';
import { ProjectErasingError } from './project-lock';

function makeRes() {
  const json = vi.fn();
  const res = { status: vi.fn().mockReturnThis(), json };
  return { res, json };
}
const makeHost = (res: unknown) =>
  ({ switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ url: '/x' }) }) }) as never;

describe('ProjectErasingFilter（C4-b）', () => {
  it('ProjectErasingError → 409：体含 code PROJECT_ERASING+scope 透传', () => {
    const filter = new ProjectErasingFilter();
    const { res, json } = makeRes();
    const ex = new ProjectErasingError('project', 'p1', 'DELETING');

    filter.catch(ex, makeHost(res));

    expect(res.status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'PROJECT_ERASING', scopeType: 'project', scopeId: 'p1',
    }));
  });

  it('team 维 scope 同判（DISBANDING fence 409 同映射）', () => {
    const filter = new ProjectErasingFilter();
    const { res, json } = makeRes();
    const ex = new ProjectErasingError('team', 't1', 'DISBANDING');

    filter.catch(ex, makeHost(res));

    expect(res.status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ scopeType: 'team', scopeId: 't1' }));
  });
});
