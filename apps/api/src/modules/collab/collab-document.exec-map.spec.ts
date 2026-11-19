// apps/api/src/modules/collab/collab-document.exec-map.spec.ts
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { CollabDocumentService } from './collab-document.service';

/** B2/F2 批0.5-5→Y1c T22（G5 同切片——doc.exec 停写）：writeExecStatus=RuntimeEvent exec.status
 *  PG 写（Z99/Z111 代次守卫随 doc 写面退役——客户端 reducer nodeVersion 大者胜承担旧事件丢弃）。
 *  本 spec 焦点：方法面事件发射契约（payload 形状/attempts 兜底）+零 doc 写（不变量⑦）。
 *  Y1c T32：applyWriteExecStatusToDoc 原语域用例随 doc.exec 读写链退役删除（Z4 守卫=doc 写面
 *  语义——feed 写面无条目无孤儿面；计数族 exec_projection_dropped/orphan_blocked 同批退役）。 */
import { vi } from 'vitest';

function buildService(doc: Y.Doc, feedEvents: Array<Record<string, unknown>> = []): CollabDocumentService {
  const fakeFeed = {
    appendEvent: vi.fn(async (_pid: string, kind: string, factory: (seq: bigint) => Record<string, unknown>) => {
      const payload = factory(1n);
      feedEvents.push({ kind, ...payload });
      return { feedSeq: 1n, generation: 0, docSeq: 0n };
    }),
    notifyProject: vi.fn(),
  };
  const service = new CollabDocumentService(
    { isWritableOrDegraded: () => 'ok', isLeaseServing: () => true } as any,
    { readSnapshotOnly: async () => ({ state: null, updates: [], stateSeq: 0n }) } as any,
    undefined,
    fakeFeed as never,
  );
  (service as any).withSession = (_projectId: string, fn: (doc: Y.Doc) => unknown, _opts?: unknown) => fn(doc);
  return service;
}

/** Y0c T11（Z4）守卫后：exec 写目标节点必须存在（不存在⇒不建条目）——夹具对齐
 *  （collab-doc-writer.service.spec seedNode 同手法；Z4 前本文件用例不种节点=守卫域旧形态）。 */
function seedNode(doc: Y.Doc, id = 'n1'): void {
  doc.getMap('nodes').set(id, new Y.Map());
}

const execEntry = (doc: Y.Doc, nodeId: string): Record<string, unknown> | undefined => {
  const m = doc.getMap('exec').get(nodeId);
  return m instanceof Y.Map ? (m.toJSON() as Record<string, unknown>) : undefined;
};

describe('Y1c T22：writeExecStatus 改 PG 写（RuntimeEvent exec.status——doc.exec 停写）', () => {
  it('发射 exec.status 事件（nodeId/status/attempts——缺 attempts 兜 0）+零 doc 写（不变量⑦）+提交后 notify', async () => {
    const doc = new Y.Doc();
    seedNode(doc);
    const events: Array<Record<string, unknown>> = [];
    const svc = buildService(doc, events);
    await svc.writeExecStatus('p1', 'n1', { status: 'loading', attempts: 1, jobId: 'j1', intentId: 'i1' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'exec.status', nodeId: 'n1', status: 'loading', attempts: 1 });
    expect(doc.getMap('exec').size).toBe(0);   // 零 doc 写
    expect((svc as any).feed.notifyProject).toHaveBeenCalledWith('p1');   // 事务提交后通知
  });
  it('attempts/execSeq/errorCode 透传（payload 键集=EXEC_STATUS_KEYS 域）', async () => {
    const doc = new Y.Doc();
    seedNode(doc);
    const events: Array<Record<string, unknown>> = [];
    await buildService(doc, events).writeExecStatus('p1', 'n1', { status: 'error', attempts: 2, errorCode: 'E_X', execSeq: '7' });
    expect(events[0]).toMatchObject({ nodeId: 'n1', status: 'error', attempts: 2, errorCode: 'E_X', execSeq: '7' });
  });
  it('受理门先行：lease 未持 → 503（事件零发射——与旧写面同门）', async () => {
    const doc = new Y.Doc();
    const service = new CollabDocumentService(
      { isWritableOrDegraded: () => 'ok', isLeaseServing: () => false } as any,
      { readSnapshotOnly: async () => ({ state: null, updates: [], stateSeq: 0n }) } as any,
    );
    await expect(service.writeExecStatus('p1', 'n1', { status: 'loading', attempts: 1 })).rejects.toThrow(/503|ServiceUnavailable|collab/);
  });
  it('Z99/Z111 代次守卫随 doc 写面退役：迟到旧事件照发（客户端 reducer nodeVersion 大者胜丢弃——T22 语义迁移注记）', async () => {
    const doc = new Y.Doc();
    seedNode(doc);
    const events: Array<Record<string, unknown>> = [];
    await buildService(doc, events).writeExecStatus('p1', 'n1', { status: 'error', attempts: 1 });
    await buildService(doc, events).writeExecStatus('p1', 'n1', { status: 'loading', attempts: 2 });
    expect(events).toHaveLength(2);   // 守卫不拦（旧 dropped 计数面退役——服务端不再持 exec 条目状态）
  });
});

describe('Y1c T32：Z4 守卫域随 doc 写面退役——ghost 节点事件照发（孤儿观察归客户端墓碑）', () => {
  it('feed 写面无存在性守卫：节点不存在事件照发（客户端按墓碑忽略——spec §7 docSeq 应用规则）+零 doc 写', async () => {
    const doc = new Y.Doc();
    const events: Array<Record<string, unknown>> = [];
    await buildService(doc, events).writeExecStatus('p1', 'ghost', { status: 'done', attempts: 1 });
    expect(events).toHaveLength(1);   // 事件照发
    expect(doc.getMap('exec').size).toBe(0);   // 零 doc 写（不变量⑦——无条目即无孤儿面）
  });
});

// ── Y3 Task 2（plan 2026-11-19-y3-protocol-retirement 第二件服务端半）：两写面改调 shared 组装器──
//  writeExecStatus/deliverArtifact payload 体同调 assembleExecStatusPayload（八键恰+error 封闭句
//  等值检查）；nodeId 由调用方单独拼、nodeVersion 由 appendEventInTx 单源盖（组装器禁写）。
describe('Y3 Task2：writeExecStatus 改调 shared 组装器（error 封闭句等值检查+八键载荷）', () => {
  it('① error=词表句「积分不足」→appendEvent 载荷原样含该句（表内句透传）', async () => {
    const doc = new Y.Doc();
    const events: Array<Record<string, unknown>> = [];
    await buildService(doc, events).writeExecStatus('p1', 'n1', { status: 'error', attempts: 1, error: '积分不足' });
    expect(events[0]).toMatchObject({ kind: 'exec.status', nodeId: 'n1', status: 'error', attempts: 1, error: '积分不足' });
  });
  it('② error=表外句『see https://x』→载荷 error=『生成失败』（整段替换不截断）', async () => {
    const doc = new Y.Doc();
    const events: Array<Record<string, unknown>> = [];
    await buildService(doc, events).writeExecStatus('p1', 'n1', { status: 'error', attempts: 1, error: 'see https://x' });
    expect(events[0]).toMatchObject({ kind: 'exec.status', nodeId: 'n1', status: 'error', attempts: 1 });
    expect((events[0] as { error?: string }).error).toBe('生成失败');   // 表外句整段换 EXEC_GENERIC 句
  });
  it('载荷恰含 nodeId+八键面：禁写键（fileId/jobId/reason/v/kind）不出现（组装器收口）', async () => {
    const doc = new Y.Doc();
    const events: Array<Record<string, unknown>> = [];
    await buildService(doc, events).writeExecStatus('p1', 'n1', {
      status: 'loading', attempts: 1, jobId: 'j1', reason: 'R', fileId: 'f1', nodeVersion: '99', v: 2, kind: 'x',
    });
    const keys = Object.keys(events[0]!).filter((k) => k !== 'kind').sort();   // kind 由 fakeFeed 撒（appendEvent 面）
    expect(keys).toEqual(['attempts', 'nodeId', 'status']);   // 禁写键全档不出现（nodeId 调用方拼）
  });
});

// ── Y3 Task2 deliverArtifact ④段：exec.status done 字面量改同调组装器——execDonePatch 已带
//  intentId/execSeq（修前手抄三键丢弃），改调后自然透传（execDonePatch 本体零改）。──
describe('Y3 Task2：deliverArtifact ④段改调组装器——exec.status(done) 事件含 intentId/execSeq', () => {
  /** deliverArtifact 直构装置：fence 放行+幂等零在档——④段 exec.status 落事件即可断言。
   *  mock intent 行（execDonePatch 形态：status/attempts/intentId/execSeq——fileId 不进八键面）。 */
  function buildDeliveryService(feedKinds: Array<{ kind: string; payload: Record<string, unknown> }>): { svc: CollabDocumentService } {
    const fakeFeed = {
      appendEventTransaction: vi.fn(async (_pid: string, body: (tx: unknown, append: (kind: string, factory: (seq: bigint) => Record<string, unknown>) => Promise<void>) => Promise<unknown>) => {
        await body(undefined, async (kind: string, factory: (seq: bigint) => Record<string, unknown>) => {
          feedKinds.push({ kind, payload: factory(1n) });
        });
        return { rejected: false as const };
      }),
      notifyProject: vi.fn(),
      hasArtifactEvent: vi.fn(async () => false),
    };
    const fakeLifecycle = { deliveryFenceCheckInTx: vi.fn(async () => ({ allow: true as const })) };
    const svc = new CollabDocumentService(
      { isWritableOrDegraded: () => 'ok', isLeaseServing: () => true } as any,
      { readSnapshotOnly: async () => ({ state: null, updates: [], stateSeq: 0n }) } as any,
      undefined,
      fakeFeed as never,
      fakeLifecycle as never,
    );
    (svc as any).withSession = (_projectId: string, fn: (doc: Y.Doc) => unknown, _opts?: unknown) => fn(new Y.Doc());
    return { svc };
  }
  it('③ exec.status(done) 事件含 intentId/execSeq（修前手抄字面量只拷 status/attempts/errorCode 三键——两身份键被丢）', async () => {
    const feedKinds: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const { svc } = buildDeliveryService(feedKinds);
    await svc.deliverArtifact('p1', {
      nodeId: 'n1',
      targetField: 'mediaId',
      value: 'media-1',
      exec: { status: 'done', attempts: 2, intentId: 'intent-token-1', execSeq: '42', errorCode: 'E_X' },
    });
    const done = feedKinds.find((e) => e.kind === 'exec.status');
    expect(done).toBeDefined();
    expect(done!.payload).toMatchObject({ nodeId: 'n1', status: 'done', attempts: 2, intentId: 'intent-token-1', execSeq: '42' });
  });
});
