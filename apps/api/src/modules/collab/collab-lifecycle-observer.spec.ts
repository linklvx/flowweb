// apps/api/src/modules/collab/collab-lifecycle-observer.spec.ts
// Y1c T26（plan v1.7）：生命周期义务观察器纯函数面用例——deriveLifecycleWrites 语义四则+负控+
// 幂等重建（义务可从帧前缀确定性重建——重建路径锚）+evaluateDeliveryFence 权威判定（T22 前置）。
// 红形态：模块先于实现（导入红）+int 侧真库运行时红（collab-lifecycle-observer.t26.int.spec 红①②）。
import { describe, it, expect, vi } from 'vitest';
import {
  deriveLifecycleWrites,
  evaluateDeliveryFence,
  type LifecycleFrame,
  type NodeCurrentState,
} from './collab-lifecycle-observer.service';

const cur = (lifecycleSeq: bigint, state: NodeCurrentState['state']): NodeCurrentState => ({ lifecycleSeq, state });

describe('Y1c T26 deriveLifecycleWrites：语义四则+负控+幂等重建', () => {
  it('NODE_CREATED=per-node genesis 注册（ACTIVE 当前行，零义务）', () => {
    const frames: LifecycleFrame[] = [{ walSeq: 5n, effects: [{ kind: 'NODE_CREATED', nodeId: 'n1', type: 'textInput', walSeq: 5n }] }];
    const r = deriveLifecycleWrites(frames, { current: new Map(), seen: new Set(), nextSeq: 1n });
    expect(r.writes).toHaveLength(1);
    expect(r.writes[0]).toMatchObject({ nodeId: 'n1', walSeq: 5n, newSeq: 1n, state: 'ACTIVE', flipPrev: false });
    expect(r.writes[0].obligations).toEqual([]);   // 零义务负控
    expect(r.nextSeq).toBe(2n);
  });

  it('NODE_DELETED（当前 ACTIVE）=新 DELETED 行+翻转旧行+三义务（closed enum 单源映射）', () => {
    const frames: LifecycleFrame[] = [{ walSeq: 9n, effects: [{ kind: 'NODE_DELETED', nodeId: 'n1', walSeq: 9n }] }];
    const r = deriveLifecycleWrites(frames, { current: new Map([['n1', cur(3n, 'ACTIVE')]]), seen: new Set(), nextSeq: 4n });
    expect(r.writes).toHaveLength(1);
    expect(r.writes[0]).toMatchObject({ nodeId: 'n1', walSeq: 9n, newSeq: 4n, state: 'DELETED', flipPrev: true });
    expect(r.writes[0].obligations).toEqual(['FEED_TOMBSTONE', 'NODE_DELETED', 'EXEC_FINALIZE']);
  });

  it('四则①：delete 已删=no-op 不二次退款（当前 DELETED 零写零义务）', () => {
    const frames: LifecycleFrame[] = [{ walSeq: 9n, effects: [{ kind: 'NODE_DELETED', nodeId: 'n1', walSeq: 9n }] }];
    const r = deriveLifecycleWrites(frames, { current: new Map([['n1', cur(3n, 'DELETED')]]), seen: new Set(), nextSeq: 4n });
    expect(r.writes).toEqual([]);
    expect(r.nextSeq).toBe(4n);   // seq 不烧
  });

  it('truth table：从未在册 delete=no-op（shouldEmitDeleteObligation 冻结语义）', () => {
    const frames: LifecycleFrame[] = [{ walSeq: 9n, effects: [{ kind: 'NODE_DELETED', nodeId: 'ghost', walSeq: 9n }] }];
    const r = deriveLifecycleWrites(frames, { current: new Map(), seen: new Set(), nextSeq: 1n });
    expect(r.writes).toEqual([]);
  });

  it('四则②：undo 重建=新 lifecycleSeq+恢复态（NODE_CREATED 于 DELETED 后=新 ACTIVE 行零义务）', () => {
    const frames: LifecycleFrame[] = [{ walSeq: 12n, effects: [{ kind: 'NODE_CREATED', nodeId: 'n1', type: 'textInput', walSeq: 12n }] }];
    const r = deriveLifecycleWrites(frames, { current: new Map([['n1', cur(4n, 'DELETED')]]), seen: new Set(), nextSeq: 5n });
    expect(r.writes).toHaveLength(1);
    expect(r.writes[0]).toMatchObject({ nodeId: 'n1', newSeq: 5n, state: 'ACTIVE', flipPrev: true });
    expect(r.writes[0].obligations).toEqual([]);   // 重建无删除义务（负控）
  });

  it('四则③：delete+restore 同帧=两行（两 lifecycleSeq 次序可分辨；先 DELETED 三义务后 ACTIVE）', () => {
    const frames: LifecycleFrame[] = [{
      walSeq: 7n,
      effects: [
        { kind: 'NODE_DELETED', nodeId: 'n1', walSeq: 7n },
        { kind: 'NODE_RESTORED', nodeId: 'n1', type: 'textInput', walSeq: 7n },
      ],
    }];
    const r = deriveLifecycleWrites(frames, { current: new Map([['n1', cur(2n, 'ACTIVE')]]), seen: new Set(), nextSeq: 3n });
    expect(r.writes).toHaveLength(2);
    expect(r.writes[0]).toMatchObject({ state: 'DELETED', newSeq: 3n, walSeq: 7n, flipPrev: true });
    expect(r.writes[0].obligations).toEqual(['FEED_TOMBSTONE', 'NODE_DELETED', 'EXEC_FINALIZE']);
    expect(r.writes[1]).toMatchObject({ state: 'ACTIVE', newSeq: 4n, walSeq: 7n, flipPrev: true });
    expect(r.writes[1].obligations).toEqual([]);
  });

  it('跨帧序列：create→delete→restore 逐帧推进（current 随 frameset 内演进——帧序=状态机序）', () => {
    const frames: LifecycleFrame[] = [
      { walSeq: 1n, effects: [{ kind: 'NODE_CREATED', nodeId: 'n1', type: 'textInput', walSeq: 1n }] },
      { walSeq: 2n, effects: [{ kind: 'NODE_DELETED', nodeId: 'n1', walSeq: 2n }] },
      { walSeq: 3n, effects: [{ kind: 'NODE_CREATED', nodeId: 'n1', type: 'textInput', walSeq: 3n }] },
    ];
    const r = deriveLifecycleWrites(frames, { current: new Map(), seen: new Set(), nextSeq: 1n });
    expect(r.writes.map((w) => `${w.state}@${w.newSeq}`)).toEqual(['ACTIVE@1', 'DELETED@2', 'ACTIVE@3']);
    expect(r.writes[1].obligations).toHaveLength(3);
    expect(r.nextSeq).toBe(4n);
  });

  it('幂等重建（重建路径锚）：已落事件（seen）重derive=零写——义务从帧前缀确定性重建不依赖进程内状态', () => {
    const frames: LifecycleFrame[] = [
      { walSeq: 1n, effects: [{ kind: 'NODE_CREATED', nodeId: 'n1', type: 'textInput', walSeq: 1n }] },
      { walSeq: 2n, effects: [{ kind: 'NODE_DELETED', nodeId: 'n1', walSeq: 2n }] },
    ];
    // 重放后 DB 态：终态 DELETED@2 + 两事件已在册（seen 按 `${nodeId}\u0000${walSeq}\u0000${state}` 匹配）
    const seen = new Set(['n1\u00001\u0000ACTIVE', 'n1\u00002\u0000DELETED']);
    const r = deriveLifecycleWrites(frames, { current: new Map([['n1', cur(2n, 'DELETED')]]), seen, nextSeq: 3n });
    expect(r.writes).toEqual([]);
    expect(r.nextSeq).toBe(3n);
  });

  it('负控：EDGE_*/MEDIA_REF_*/FIELD_CHANGED 零生命周期写（义务种类=closed enum——仅 NODE_* 族入态机）', () => {
    const frames: LifecycleFrame[] = [{
      walSeq: 4n,
      effects: [
        { kind: 'EDGE_ADDED', edgeId: 'e1', source: 'a', target: 'b', walSeq: 4n },
        { kind: 'EDGE_REMOVED', edgeId: 'e1', source: 'a', target: 'b', walSeq: 4n },
        { kind: 'MEDIA_REF_ADDED', nodeId: 'a', mediaId: 'm1', walSeq: 4n },
        { kind: 'MEDIA_REF_REMOVED', nodeId: 'a', mediaId: 'm1', walSeq: 4n },
        { kind: 'FIELD_CHANGED', nodeId: 'a', key: 'width', walSeq: 4n },
      ],
    }];
    const r = deriveLifecycleWrites(frames, { current: new Map(), seen: new Set(), nextSeq: 1n });
    expect(r.writes).toEqual([]);
  });

  it('per-project 数值序：同帧集多节点依次分配递增 lifecycleSeq（次序可分辨）', () => {
    const frames: LifecycleFrame[] = [{
      walSeq: 2n,
      effects: [
        { kind: 'NODE_CREATED', nodeId: 'x', type: 'textInput', walSeq: 2n },
        { kind: 'NODE_CREATED', nodeId: 'y', type: 'textInput', walSeq: 2n },
      ],
    }];
    const r = deriveLifecycleWrites(frames, { current: new Map(), seen: new Set(), nextSeq: 10n });
    expect(r.writes.map((w) => w.newSeq)).toEqual([10n, 11n]);
    expect(r.nextSeq).toBe(12n);
  });

  it('重复 effect 同 frameset 内去重（同 (nodeId,walSeq,state) 事件只写一次——幂等键在 frameset 内同样成立）', () => {
    const frames: LifecycleFrame[] = [{
      walSeq: 6n,
      effects: [
        { kind: 'NODE_DELETED', nodeId: 'n1', walSeq: 6n },
        { kind: 'NODE_DELETED', nodeId: 'n1', walSeq: 6n },   // 结构性重复（防御面）
      ],
    }];
    const r = deriveLifecycleWrites(frames, { current: new Map([['n1', cur(1n, 'ACTIVE')]]), seen: new Set(), nextSeq: 2n });
    expect(r.writes).toHaveLength(1);
  });
});

describe('Y1c T26 evaluateDeliveryFence：T22 node-deleted 权威判定（DELIVERY_FENCE_CONTRACT）', () => {
  it('ACTIVE+fenceSeq==当前 lifecycleSeq=放行', () => {
    expect(evaluateDeliveryFence({ fenceSeq: 4n, state: 'ACTIVE' }, cur(4n, 'ACTIVE')))
      .toEqual({ allow: true, fenceSeq: 4n, state: 'ACTIVE' });
  });

  it('fence.state=DELETED=丢弃不退款（node-deleted）', () => {
    const v = evaluateDeliveryFence({ fenceSeq: 4n, state: 'DELETED' }, cur(4n, 'DELETED'));
    expect(v).toMatchObject({ allow: false, reason: 'node-deleted', fenceSeq: 4n });
  });

  it('fence 与当前 lifecycleSeq 不匹配=丢弃（fence-stale fail-closed）', () => {
    const v = evaluateDeliveryFence({ fenceSeq: 3n, state: 'ACTIVE' }, cur(4n, 'ACTIVE'));
    expect(v).toMatchObject({ allow: false, reason: 'fence-stale', fenceSeq: 3n, currentSeq: 4n });
  });

  it('无 fence 行=unregistered 丢弃（fail-closed——契约字面「不匹配=丢弃」；T22 消费可显式放宽）', () => {
    const v = evaluateDeliveryFence(null, undefined);
    expect(v).toMatchObject({ allow: false, reason: 'unregistered' });
  });
});

// ═══ Y1c T26 双评审收口批（Controller 裁定：I-1/I-2 必修+M-2/M-4 面）════════════════════════
describe('Y1c T26 收口批 I-2：persistFramesInTx 批量化（事务内 round trip O(事件数)→O(1)）', () => {
  it('红（I-2）：300 删除事件单批——事务内调用次数有界（mock tx 计数：findMany 恰 2/updateMany 恰 1/createMany 恰 1/fence $executeRaw 恰 1/义务 createMany 恰 1）', async () => {
    const { CollabLifecycleObserverService } = await import('./collab-lifecycle-observer.service');
    const calls = { findMany: 0, nlCreateMany: 0, nlUpdateMany: 0, fenceUpsert: 0, oblCreateMany: 0, executeRaw: 0, queryRaw: 0 };
    let findManyIdx = 0;
    const tx = {
      nodeLifecycle: {
        findMany: vi.fn(async () => {
          findManyIdx += 1; calls.findMany += 1;
          // 第 1 读=当前行投影（300 节点全 ACTIVE 在册——删除全发）；第 2 读=批 walSeq 区间已落事件（空）
          return findManyIdx === 1
            ? Array.from({ length: 300 }, (_, i) => ({ nodeId: `n${i}`, lifecycleSeq: BigInt(i + 1), state: 'ACTIVE' }))
            : [];
        }),
        createMany: vi.fn(async () => { calls.nlCreateMany += 1; return { count: 0 }; }),
        updateMany: vi.fn(async () => { calls.nlUpdateMany += 1; return { count: 0 }; }),
      },
      deliveryFence: { upsert: vi.fn(async () => { calls.fenceUpsert += 1; }) },
      lifecycleObligation: { createMany: vi.fn(async () => { calls.oblCreateMany += 1; return { count: 0 }; }) },
      $executeRaw: vi.fn(async () => { calls.executeRaw += 1; return 0; }),
      $queryRaw: vi.fn(async () => { calls.queryRaw += 1; return [{ max: 300n }]; }),
    } as never;
    const effects = Array.from({ length: 300 }, (_, i) => ({ kind: 'NODE_DELETED' as const, nodeId: `n${i}`, walSeq: 7n }));
    const observer = new CollabLifecycleObserverService(null as never);
    const counts = await observer.persistFramesInTx(tx, 'p1', [{ walSeq: 7n, effects }]);
    expect(counts.writes).toBe(300);
    expect(counts.obligations).toBe(900);                            // 300×三义务
    expect(calls.findMany).toBe(2);                                  // 当前行+已落事件两读（红=现行同两读——非红轴）
    expect(calls.nlUpdateMany).toBe(1);                              // 红=现行 300 次（逐事件翻转）
    expect(calls.nlCreateMany).toBe(1);                              // 红=现行 300 次（逐事件新行）
    expect(calls.fenceUpsert).toBe(0);                               // fence 改 raw 单条（红=现行 300 次 upsert）
    expect(calls.executeRaw).toBe(1);                                // fence INSERT..ON CONFLICT 多值恰一次
    expect(calls.oblCreateMany).toBe(1);                             // 红=现行 300 次（逐事件义务）
    expect(calls.queryRaw).toBe(1);                                  // nextSeqBase 单读
  });

  it('红（M-4）：deriveSeedWrites 词表门——无效 type 节点零播种（isFrameNodeTypeName 与 collector NODE_* 门对齐）', async () => {
    const { deriveSeedWrites } = await import('./collab-lifecycle-observer.service');
    const presence = new Map([['nOk', 'textInput'], ['nBogus', 'not-a-real-type']]);
    const r = deriveSeedWrites(presence, new Map(), 1n);
    expect(r.rows.map((x) => x.nodeId)).toEqual(['nOk']);            // 红=deriveSeedWrites 不存在（导出缺）
    expect(r.fences.map((x) => x.nodeId)).toEqual(['nOk']);
    expect(r.nextSeq).toBe(2n);
  });

  it('红（M-2）：deliveryFenceCheckInTx=交付事务权威面（fence 行 FOR UPDATE 锁读+evaluateDeliveryFence 判定）', async () => {
    const { CollabLifecycleObserverService } = await import('./collab-lifecycle-observer.service');
    const raws: string[] = [];
    const tx = {
      $queryRaw: vi.fn(async (strings: TemplateStringsArray, ..._vals: unknown[]) => {
        raws.push(strings.join('?'));
        return strings.includes('FOR UPDATE') || strings.join('').includes('FOR UPDATE')
          ? [{ fenceSeq: 5n, state: 'DELETED' }]
          : [{ lifecycleSeq: 5n, state: 'DELETED' }];
      }),
      nodeLifecycle: { findFirst: vi.fn(async () => ({ lifecycleSeq: 5n, state: 'DELETED' })) },
    } as never;
    const observer = new CollabLifecycleObserverService(null as never);
    const v = await observer.deliveryFenceCheckInTx(tx, 'p1', 'n1');
    expect(v).toMatchObject({ allow: false, reason: 'node-deleted' });
    expect(raws.some((sql) => sql.includes('FOR UPDATE'))).toBe(true);   // 锁读锚（交付事务内串行化）
  });
});
