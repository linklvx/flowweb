// apps/web/src/stores/runtimeStore.exec-status.spec.ts —— Y3 Task 4（plan 2026-11-19-y3-
// protocol-retirement 第一笔）：客户端投影链三处契约测试。先红→绿。
// - slotOfEventWire exec.status 分支改调 shared execStatusSlotOfPayload：删 ?? e.feedSeq 伪造
//   nodeVersion 兜底——缺合法 nodeVersion 的事件=unknown 计数、不产槽；error/intentId/execSeq
//   等八键随 payload 有值才拷。
// - projectRuntimeExecToNodeStore：补 error 拷贝+删 intentId 回落 execSeq 垫片行——execSeq-only
//   载荷 ⇒ entry.intentId===undefined（无行身份键不冒充手势 token）。
// - selectRuntimeEntry 返回类型补 error/nodeVersion（T7 工具条读面）。
import { describe, it, expect, beforeEach } from 'vitest';
import type { RuntimeProjection } from '@flowweb/shared';
import {
  applyEventsToProjection, useRuntimeFeedStore, projectRuntimeExecToNodeStore,
  selectRuntimeEntry, resetRuntimeFeed,
} from './runtimeStore';
import { useNodeStore } from './nodeStore';
import type { RuntimeEventWireRow } from './runtimeFeedTypes';

const proj = (over: Partial<RuntimeProjection> = {}): RuntimeProjection => ({
  projectId: 'p1', generation: 3, feedSeq: '0', pgSeq: '0', nodes: {}, ...over,
});
const cursor = (feedSeq: string) => ({ historyId: 'h-2026-11-19', generation: 3, feedSeq });
const ev = (feedSeq: string, payload: Record<string, unknown>, kind = 'exec.status'): RuntimeEventWireRow =>
  ({ id: `e${feedSeq}`, feedSeq, generation: 3, kind, payload: { v: 1, ...payload }, docSeq: null, createdAtMs: 0 });

describe('Y3 Task4：slotOfEventWire exec.status 改调 shared execStatusSlotOfPayload', () => {
  beforeEach(() => { resetRuntimeFeed(); useNodeStore.setState({ execStatus: new Map() }); });

  it('error 封闭句/intentId/execSeq 随事件落槽：applyEventsToProjection 喂含 error:「积分不足」的 exec.status → 槽面八键齐全', () => {
    const r = applyEventsToProjection(proj(), cursor('0'), [
      ev('1', {
        kind: 'exec.status', nodeId: 'n1', status: 'error', attempts: 2, execSeq: '42',
        errorCode: 'CREDIT_INSUFFICIENT', intentId: 'intent-token-1', rearmable: true,
        error: '积分不足', nodeVersion: '1',
      }),
    ]);
    expect(r.unknown).toBe(0);
    const fact = r.projection.nodes.n1?.execStatus;
    expect(fact?.status).toBe('error');
    expect(fact?.error).toBe('积分不足');   // 修前 slotOfEventWire 手拼面不拷 error
    expect(fact?.intentId).toBe('intent-token-1');
    expect(fact?.execSeq).toBe('42');
    expect(fact?.rearmable).toBe(true);
    expect(fact?.errorCode).toBe('CREDIT_INSUFFICIENT');
    expect(fact?.attempts).toBe(2);
    expect(fact?.nodeVersion).toBe('1');
  });

  it('缺合法 nodeVersion 的事件=unknown 计数+1、投影无新槽（删 ?? e.feedSeq 伪造兜底）', () => {
    const r = applyEventsToProjection(proj(), cursor('0'), [
      ev('1', { kind: 'exec.status', nodeId: 'n1', status: 'loading', attempts: 0 }),   // 无 nodeVersion
      ev('2', { kind: 'exec.status', nodeId: 'n1', status: 'loading', attempts: 0, nodeVersion: 'abc' }),   // 非十进制
    ]);
    expect(r.unknown).toBe(2);
    expect(r.projection.nodes.n1).toBeUndefined();   // 不产槽（修前 ?? e.feedSeq 伪造 nodeVersion 兜底产槽）
  });

  it('缺的可选键不写成 undefined（execSeq-only 载荷——键有值才拷）', () => {
    const r = applyEventsToProjection(proj(), cursor('0'), [
      ev('1', { kind: 'exec.status', nodeId: 'n2', status: 'loading', attempts: 1, execSeq: '7', nodeVersion: '1' }),
    ]);
    const fact = r.projection.nodes.n2?.execStatus;
    expect(fact).toEqual({ status: 'loading', attempts: 1, execSeq: '7', nodeVersion: '1' });
    expect('intentId' in (fact ?? {})).toBe(false);
    expect('error' in (fact ?? {})).toBe(false);
  });
});

describe('Y3 Task4：projectRuntimeExecToNodeStore 补 error 拷贝+删 intentId 回落 execSeq 垫片', () => {
  beforeEach(() => { resetRuntimeFeed(); useNodeStore.setState({ execStatus: new Map() }); });

  it("error:「积分不足」事件链 → nodeStore entry.error==='积分不足' 且 entry.intentId===载荷 intentId", () => {
    const r = applyEventsToProjection(proj(), cursor('0'), [
      ev('1', {
        kind: 'exec.status', nodeId: 'n1', status: 'error', attempts: 2, execSeq: '42',
        errorCode: 'CREDIT_INSUFFICIENT', intentId: 'intent-token-1', rearmable: true,
        error: '积分不足', nodeVersion: '1',
      }),
    ]);
    useRuntimeFeedStore.setState({ projection: r.projection });
    projectRuntimeExecToNodeStore();
    const entry = useNodeStore.getState().execStatus.get('n1')!;
    expect(entry.error).toBe('积分不足');   // 修前不拷 error
    expect(entry.intentId).toBe('intent-token-1');   // 修前 intentId 回落 execSeq 垫片——error 载荷恒带 intentId 走真键
    expect(entry.rearmable).toBe(true);
  });

  it('execSeq-only 载荷（无 intentId）→ entry.intentId===undefined（垫片行已删——无行身份键不冒充手势 token）', () => {
    const r = applyEventsToProjection(proj(), cursor('0'), [
      ev('1', { kind: 'exec.status', nodeId: 'n2', status: 'loading', attempts: 1, execSeq: '7', nodeVersion: '1' }),
    ]);
    useRuntimeFeedStore.setState({ projection: r.projection });
    projectRuntimeExecToNodeStore();
    const entry = useNodeStore.getState().execStatus.get('n2')!;
    expect(entry.status).toBe('loading');
    expect(entry.intentId).toBeUndefined();   // 修前回落 execSeq='7' 冒充 intentId
  });

  it('投影槽直挂（快照面）：error/intentId/execSeq 随槽拷进 nodeStore', () => {
    useRuntimeFeedStore.setState({
      projectId: 'p1', cursor: cursor('5'),
      projection: proj({
        feedSeq: '5',
        nodes: { nA: { execStatus: { status: 'error', attempts: 3, execSeq: '9', intentId: 'intent-x', rearmable: false, error: '生成失败', nodeVersion: '5' } } },
      }),
      fetchedAtMs: Date.now(),
    });
    projectRuntimeExecToNodeStore();
    const entry = useNodeStore.getState().execStatus.get('nA')!;
    expect(entry.error).toBe('生成失败');
    expect(entry.intentId).toBe('intent-x');
    expect(entry.rearmable).toBe(false);
  });
});

describe('Y3 Task4：selectRuntimeEntry 返回类型补 error/nodeVersion（T7 工具条读面）', () => {
  beforeEach(() => { resetRuntimeFeed(); });

  it('投影槽含 error+nodeVersion → selectRuntimeEntry 两键可达', () => {
    useRuntimeFeedStore.setState({
      projectId: 'p1', cursor: cursor('2'),
      projection: proj({
        feedSeq: '2',
        nodes: { nS: { execStatus: { status: 'error', error: '积分不足', nodeVersion: '2', intentId: 'intent-s', execSeq: '4' } } },
      }),
      fetchedAtMs: Date.now(),
    });
    const e = selectRuntimeEntry('nS');
    expect(e?.execStatus?.error).toBe('积分不足');
    expect(e?.execStatus?.nodeVersion).toBe('2');
    expect(e?.execStatus?.intentId).toBe('intent-s');
    expect(e?.execStatus?.execSeq).toBe('4');
  });
});
