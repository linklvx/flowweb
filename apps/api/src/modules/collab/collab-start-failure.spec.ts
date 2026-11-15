// TD-33/C1a T6：启动失败面单源（isPortError 自 gateway 迁入——gateway 锚净零；C2 tracker 本文件扩展）。
import { describe, it, expect } from 'vitest';
import { isPortError } from './collab-start-failure';

describe('isPortError（C1a 迁入）', () => {
  it('EADDRINUSE / DOCS_NOT_UNLOADED / code 缺失但消息含 EADDRINUSE=端口类启动失败', () => {
    expect(isPortError(Object.assign(new Error('x'), { code: 'EADDRINUSE' }))).toBe(true);
    expect(isPortError(Object.assign(new Error('x'), { code: 'DOCS_NOT_UNLOADED' }))).toBe(true);
    expect(isPortError(new Error('listen EADDRINUSE: address already in use'))).toBe(true);
  });

  it('EACCES/EPERM/普通错误=false（typed DrillCollabStartFailed 面不换口）', () => {
    expect(isPortError(Object.assign(new Error('x'), { code: 'EACCES' }))).toBe(false);
    expect(isPortError(Object.assign(new Error('x'), { code: 'EPERM' }))).toBe(false);
    expect(isPortError(new Error('boom'))).toBe(false);
    expect(isPortError(null)).toBe(false);
  });
});
