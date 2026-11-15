// TD-33/C1b T13：终态错误识别四形状单测（SpoolProjectBlockedError 两 state/4414/reason/ProjectErasingError）。
import { describe, it, expect } from 'vitest';
import { CollabCloseCode, PROJECT_ERASED_TERMINAL_REASON } from '@flowweb/shared';
import { isProjectErasedError } from './collab-erased-error';
import { SpoolProjectBlockedError } from './collab-spool.service';
import { ProjectErasingError } from './project-lock';

describe('TD-33 T13：isProjectErasedError 四形状', () => {
  it('SpoolProjectBlockedError 两 state 均识别', () => {
    expect(isProjectErasedError(new SpoolProjectBlockedError('ERASING'))).toBe(true);
    expect(isProjectErasedError(new SpoolProjectBlockedError('ERASED'))).toBe(true);
  });

  it('4414 码形态（FrameRejectError 生产 sink 路径）与 reason 关闭原因形态均识别', () => {
    expect(isProjectErasedError(Object.assign(new Error('x'), { code: CollabCloseCode.PROJECT_ERASED }))).toBe(true);
    expect(isProjectErasedError(Object.assign(new Error('x'), { reason: PROJECT_ERASED_TERMINAL_REASON }))).toBe(true);
  });

  it('ProjectErasingError（PG fence 终态族）识别', () => {
    expect(isProjectErasedError(new ProjectErasingError('project', 'p1', 'DELETING'))).toBe(true);
  });

  it('普通错误/空值=false（不误吞可重试档）', () => {
    expect(isProjectErasedError(new Error('pg down'))).toBe(false);
    expect(isProjectErasedError(Object.assign(new Error('x'), { code: CollabCloseCode.SLOW_CONSUMER }))).toBe(false);
    expect(isProjectErasedError(null)).toBe(false);
    expect(isProjectErasedError(undefined)).toBe(false);
  });
});
