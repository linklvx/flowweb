// apps/web/src/pages/canvas/offline-route.spec.ts
// Y5 T9：离线路由决定纯函数单测（P6——本任务只钉决定表，不接页面/不开库）。
// 决定表优先级：401 > 403/404 > 无 projectId > 瞬态失败 > session 单活未过期 > binding 三合取。
// 三合取=session 行未过期 ∧ binding.uid===session.uid ∧ localStorage historyId===binding.historyToken。
import { describe, it, expect } from 'vitest';
import { decideOfflineRoute, type OfflineRouteInput } from './offline-route';

const NOW = 1_000_000;
const SESSION_UID = 'u1';
const PID = 'p1';

const binding = () => ({
  uid: SESSION_UID,
  generation: 3,
  schemaVersion: 3,
  historyToken: 'tok-1',
  name: '离线项目名',
  teamId: 'team-9' as string | null,
});

const sessionRow = (overrides: Partial<{ uid: string; localDeadline: number }> = {}) => ({
  uid: SESSION_UID,
  localDeadline: NOW + 60_000,
  userSnapshot: { id: SESSION_UID },
  ...overrides,
});

/** 合法离线开库基线：5xx + 单活未过期行 + 匹配 binding + 匹配 historyId。 */
const base = (overrides: Partial<OfflineRouteInput> = {}): OfflineRouteInput => ({
  projectId: PID,
  status: 503,
  sessionRows: [sessionRow()],
  binding: binding(),
  historyId: 'tok-1',
  now: NOW,
  ...overrides,
});

describe('T9 离线路由决定（验收 11/16/17 路由腿）', () => {
  it('5xx+未过期 session+binding uid 一致+historyId 一致 ⇒ open-local（name/teamId 来自 binding）', () => {
    const decision = decideOfflineRoute(base());
    expect(decision).toEqual({
      kind: 'open-local',
      binding: {
        uid: SESSION_UID,
        generation: 3,
        schemaVersion: 3,
        historyToken: 'tok-1',
        name: '离线项目名',
        teamId: 'team-9',
      },
    });
  });

  it('HTTP 401 ⇒ http-expired（本地三合取全满足也不得覆盖显式否认）', () => {
    expect(decideOfflineRoute(base({ status: 401 }))).toEqual({ kind: 'http-expired' });
  });

  it('session.uid !== binding.uid ⇒ unavailable（验收 16——不跨账号开库）', () => {
    expect(decideOfflineRoute(base({ binding: { ...binding(), uid: 'u2' } })))
      .toEqual({ kind: 'unavailable' });
  });

  it('无 session 行 ⇒ unavailable', () => {
    expect(decideOfflineRoute(base({ sessionRows: [] }))).toEqual({ kind: 'unavailable' });
  });

  it('session 行已过期（localDeadline === now / < now）⇒ unavailable', () => {
    expect(decideOfflineRoute(base({ sessionRows: [sessionRow({ localDeadline: NOW })] })))
      .toEqual({ kind: 'unavailable' });
    expect(decideOfflineRoute(base({ sessionRows: [sessionRow({ localDeadline: NOW - 1 })] })))
      .toEqual({ kind: 'unavailable' });
  });

  it('两行 session（单活不变量被破坏）⇒ unavailable（fail-closed）', () => {
    const rows = [sessionRow(), sessionRow({ uid: 'u2' })];
    expect(decideOfflineRoute(base({ sessionRows: rows }))).toEqual({ kind: 'unavailable' });
  });

  it('无 projectId ⇒ unavailable（禁 createUntitledProject——本地行/binding 再全也不建）', () => {
    expect(decideOfflineRoute(base({ projectId: null }))).toEqual({ kind: 'unavailable' });
  });

  it('无 binding ⇒ unavailable', () => {
    expect(decideOfflineRoute(base({ binding: null }))).toEqual({ kind: 'unavailable' });
  });

  it('historyId 缺失 ⇒ unavailable', () => {
    expect(decideOfflineRoute(base({ historyId: undefined }))).toEqual({ kind: 'unavailable' });
  });

  it('historyId 不匹配 binding.historyToken ⇒ unavailable', () => {
    expect(decideOfflineRoute(base({ historyId: 'tok-other' }))).toEqual({ kind: 'unavailable' });
  });

  it('HTTP 403 / 404 ⇒ no-read-access（显式否认优先于本地放行）', () => {
    expect(decideOfflineRoute(base({ status: 403 }))).toEqual({ kind: 'no-read-access' });
    expect(decideOfflineRoute(base({ status: 404 }))).toEqual({ kind: 'no-read-access' });
  });

  it('408 / 429 / 无 status 均按瞬态处理（其余合法 ⇒ open-local）', () => {
    expect(decideOfflineRoute(base({ status: 408 })).kind).toBe('open-local');
    expect(decideOfflineRoute(base({ status: 429 })).kind).toBe('open-local');
    expect(decideOfflineRoute(base({ status: undefined })).kind).toBe('open-local');
  });

  it('非瞬态非否认状态（409）⇒ unavailable', () => {
    expect(decideOfflineRoute(base({ status: 409 }))).toEqual({ kind: 'unavailable' });
    expect(decideOfflineRoute(base({ status: 400 }))).toEqual({ kind: 'unavailable' });
  });

  it('优先级：401 先于无 projectId（仍 http-expired）', () => {
    expect(decideOfflineRoute(base({ status: 401, projectId: null }))).toEqual({ kind: 'http-expired' });
  });

  it('优先级：403/404 先于无 projectId（仍 no-read-access）', () => {
    expect(decideOfflineRoute(base({ status: 404, projectId: null }))).toEqual({ kind: 'no-read-access' });
  });
});
