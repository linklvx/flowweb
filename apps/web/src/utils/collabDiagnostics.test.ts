// apps/web/src/utils/collabDiagnostics.test.ts
// 批1-5 诊断模块单测：环形缓冲封顶覆盖 / 计数常开递增（不受覆盖影响）/ kill switch 读取时点求值。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  recordCollabDiag,
  getRecentCollabDiag,
  getCollabDiagCounters,
  isAutoRecoverDisabled,
  _resetCollabDiagForTest,
} from './collabDiagnostics';

describe('collabDiagnostics', () => {
  beforeEach(() => {
    _resetCollabDiagForTest();
  });

  it('环形缓冲封顶 500：最旧被覆盖（保最近）', () => {
    for (let i = 0; i < 600; i++) recordCollabDiag('watchdog_fire', { seq: i });
    const recent = getRecentCollabDiag();
    expect(recent).toHaveLength(500);
    expect(recent[0].detail).toEqual({ seq: 100 }); // 0..99 已被覆盖
    expect(recent[499].detail).toEqual({ seq: 599 });
  });

  it('计数不受环形覆盖影响（prod 常开计数语义——累计递增）', () => {
    for (let i = 0; i < 600; i++) recordCollabDiag('ws_status', { to: 'disconnected' });
    expect(getCollabDiagCounters().get('ws_status')).toBe(600);
  });

  it('kill switch：默认关；VITE_COLLAB_AUTO_RECOVER=off 时开（读取时点求值——stub 即生效）', () => {
    expect(isAutoRecoverDisabled()).toBe(false);
    vi.stubEnv('VITE_COLLAB_AUTO_RECOVER', 'off');
    expect(isAutoRecoverDisabled()).toBe(true);
    vi.unstubAllEnvs();
    expect(isAutoRecoverDisabled()).toBe(false);
  });
});
