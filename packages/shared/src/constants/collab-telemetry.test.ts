// Y0b-5 T0 红测（spec §5.6 冻结契约 11）：遥测白名单 12 值+detail 逐 type 受控 schema（裁定 24⑹/25⑵）。
import { describe, it, expect } from 'vitest';
import {
  COLLAB_TELEMETRY_EVENT_TYPES, isKnownTelemetryType,
  MAX_TELEMETRY_EVENTS_PER_BATCH, MAX_TELEMETRY_EVENT_BYTES,
  sanitizeTelemetryDetail, TELEMETRY_DETAIL_SCHEMA, QUOTA_REJECT_REASONS,
} from './collab-telemetry';
import { CollabCloseCode } from './collab-close-code';
import { COLLAB_AUTH_REASONS } from './collab-auth-reason';

describe('遥测白名单+detail 受控四键（冻结契约 11）', () => {
  it('12 值封闭：ring 九类+close_code/unsynced_close/projection_duration', () => {
    expect(COLLAB_TELEMETRY_EVENT_TYPES).toHaveLength(12);
    for (const t of ['ws_status','recover_triggered','watchdog_fire','hydration_fail','auth_reject','write_reject','invariant_violation','sync_pending_retry','conn_scope','close_code','unsynced_close','projection_duration'] as const)
      expect(isKnownTelemetryType(t)).toBe(true);
  });
  it('detail 键白名单={code,reason,ms,n}——其余键剥除（projectId/docName/query/hash 全剥）', () => {
    const out = sanitizeTelemetryDetail('close_code', { code: 4408, projectId: 'p1', evil: 'x' });
    expect(out).toEqual({ code: 4408 });
  });
  it('code/reason 值域校验：code∉CollabCloseCode 值域→other；reason∉CollabAuthReason 13 值→other（ws_status.reason 另含 unsynced-lag/local-cache-degraded 受控值）', () => {
    expect(sanitizeTelemetryDetail('close_code', { code: 9999 })).toEqual({ code: 'other' });
    expect(sanitizeTelemetryDetail('auth_reject', { reason: 'made-up' })).toEqual({ reason: 'other' });
  });
  it('批量上限 12 条按【复合聚合键 type|code|reason 聚合后的条数】计（单 type 多 code=多条——分布不被压掉）/单条 512B 常量', () => {
    expect(MAX_TELEMETRY_EVENTS_PER_BATCH).toBe(12); expect(MAX_TELEMETRY_EVENT_BYTES).toBe(512);
  });
});

describe('detail schema 表（裁定 24⑹ 逐 type 表=键域唯一来源；裁定 25⑵ sink 列逐键必填）', () => {
  it('12 type 全覆盖且每键 sink 必填（metric:<name>{label}｜log-only——无 sink 的允许键=过 sanitize 仍被指标层丢弃）', () => {
    for (const t of COLLAB_TELEMETRY_EVENT_TYPES) {
      const table = TELEMETRY_DETAIL_SCHEMA[t];
      expect(table, `type=${t} 缺 schema 表`).toBeDefined();
      for (const [key, spec] of Object.entries(table)) {
        expect(spec.sink.startsWith('metric:') || spec.sink === 'log-only', `${t}.${key} sink 非法: ${spec.sink}`).toBe(true);
      }
    }
  });
  it('仓内既有调用点实测形状全保留（runtime/awareness/canvasIntents/canvasStore/canvasUndo/executionApi——census 锚起始必须绿）', () => {
    // runtime:946 迁移对
    expect(sanitizeTelemetryDetail('ws_status', { from: 'connected', to: 'disconnected' }))
      .toEqual({ from: 'connected', to: 'disconnected' });
    // runtime:197
    expect(sanitizeTelemetryDetail('recover_triggered', { level: 'transient' })).toEqual({ level: 'transient' });
    expect(sanitizeTelemetryDetail('recover_triggered', { level: 'terminal' })).toEqual({ level: 'terminal' });
    // runtime:1200
    expect(sanitizeTelemetryDetail('watchdog_fire', { executed: false })).toEqual({ executed: false });
    expect(sanitizeTelemetryDetail('watchdog_fire', { executed: true })).toEqual({ executed: true });
    // runtime:1012（reason 值域 13 值闭集+terminal 布尔）
    expect(sanitizeTelemetryDetail('auth_reject', { reason: 'draining', terminal: false }))
      .toEqual({ reason: 'draining', terminal: false });
    // awareness:111 / runtime:1002 / canvasIntents:327 / canvasStore:1900/:2892 / canvasUndo:100
    expect(sanitizeTelemetryDetail('write_reject', { reason: 'selection-too-large' })).toEqual({ reason: 'selection-too-large' });
    expect(sanitizeTelemetryDetail('write_reject', { reason: 'quota-soft' })).toEqual({ reason: 'quota-soft' });
    expect(sanitizeTelemetryDetail('write_reject', { reason: 'key-too-large', via: 'dispatch-fallback' }))
      .toEqual({ reason: 'key-too-large', via: 'dispatch-fallback' });
    expect(sanitizeTelemetryDetail('write_reject', { reason: 'doc-over-budget', via: 'redo-precheck' }))
      .toEqual({ reason: 'doc-over-budget', via: 'redo-precheck' });
    expect(sanitizeTelemetryDetail('write_reject', { reason: 'tx-too-large' })).toEqual({ reason: 'tx-too-large' });
    expect(sanitizeTelemetryDetail('write_reject', { reason: 'too-many-nodes' })).toEqual({ reason: 'too-many-nodes' });
    // runtime:1267（where 值域含 T2 ErrorBoundary 'react-boundary' 与 'applyBootstrap'）
    expect(sanitizeTelemetryDetail('invariant_violation', { where: 'applyRemote' })).toEqual({ where: 'applyRemote' });
    expect(sanitizeTelemetryDetail('invariant_violation', { where: 'applyBootstrap' })).toEqual({ where: 'applyBootstrap' });
    expect(sanitizeTelemetryDetail('invariant_violation', { where: 'react-boundary' })).toEqual({ where: 'react-boundary' });
    // executionApi:43（无 detail）/runtime:1234（无 detail）
    expect(sanitizeTelemetryDetail('hydration_fail')).toEqual({});
    expect(sanitizeTelemetryDetail('hydration_fail', { evil: 'x' })).toEqual({});
    // runtime:955（scope ?? null——authenticated 载荷 L23 scope∈{read-write,readonly}）
    expect(sanitizeTelemetryDetail('conn_scope', { scope: null })).toEqual({ scope: null });
    expect(sanitizeTelemetryDetail('conn_scope', { scope: 'read-write' })).toEqual({ scope: 'read-write' });
    expect(sanitizeTelemetryDetail('conn_scope', { scope: 'readonly' })).toEqual({ scope: 'readonly' });
    // T2 接线三 type（close_code/unsynced_close/projection_duration 按 plan 表）
    expect(sanitizeTelemetryDetail('projection_duration', { ms: 123 })).toEqual({ ms: 123 });
    expect(sanitizeTelemetryDetail('unsynced_close', { n: 3 })).toEqual({ n: 3 });
    expect(sanitizeTelemetryDetail('sync_pending_retry', { n: 1 })).toEqual({ n: 1 });
  });
  it('枚举键越界值折 other（where/scope/level/via/reason——值域闭集外一律 other 防基数）', () => {
    expect(sanitizeTelemetryDetail('invariant_violation', { where: 'surface' })).toEqual({ where: 'other' });
    expect(sanitizeTelemetryDetail('conn_scope', { scope: 'evil' })).toEqual({ scope: 'other' });
    expect(sanitizeTelemetryDetail('recover_triggered', { level: 'weird' })).toEqual({ level: 'other' });
    expect(sanitizeTelemetryDetail('watchdog_fire', { reason: 'made-up' })).toEqual({ reason: 'other' });
    expect(sanitizeTelemetryDetail('write_reject', { reason: 'msg-rate-exceeded' })).toEqual({ reason: 'other' }); // 服务端词表客户端零产生（裁定 25⑴）
    expect(sanitizeTelemetryDetail('write_reject', { reason: 'doc-over-quota' })).toEqual({ reason: 'other' });   // 同上
    expect(sanitizeTelemetryDetail('write_reject', { reason: 'doc-over-budget', via: 'evil' }))
      .toEqual({ reason: 'doc-over-budget', via: 'other' });
    expect(sanitizeTelemetryDetail('ws_status', { reason: 'made-up' })).toEqual({ reason: 'other' });
    expect(sanitizeTelemetryDetail('ws_status', { reason: 'unsynced-lag' })).toEqual({ reason: 'unsynced-lag' });
    expect(sanitizeTelemetryDetail('ws_status', { reason: 'local-cache-degraded' })).toEqual({ reason: 'local-cache-degraded' });
  });
  it('close_code.code 查 CollabCloseCode 值域（应用码+库码全集——Object.values 单源）', () => {
    for (const code of Object.values(CollabCloseCode)) {
      expect(sanitizeTelemetryDetail('close_code', { code })).toEqual({ code });
    }
    expect(sanitizeTelemetryDetail('close_code', { code: 9999 })).toEqual({ code: 'other' });
    expect(sanitizeTelemetryDetail('close_code', { code: '4408' })).toEqual({ code: 'other' }); // 数值域——字符串形态不收
  });
  it('auth_reject.reason 查 CollabAuthReason 13 值域（COLLAB_AUTH_REASONS 单源）', () => {
    for (const r of COLLAB_AUTH_REASONS) {
      expect(sanitizeTelemetryDetail('auth_reject', { reason: r })).toEqual({ reason: r });
    }
  });
  it('QuotaRejectReason 四值单源上移 shared（canvasIntents re-export——裁定 25⑴）', () => {
    expect(QUOTA_REJECT_REASONS).toEqual(['key-too-large', 'tx-too-large', 'too-many-nodes', 'doc-over-budget']);
  });
});
