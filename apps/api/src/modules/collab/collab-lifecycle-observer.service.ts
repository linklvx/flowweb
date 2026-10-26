// apps/api/src/modules/collab/collab-lifecycle-observer.service.ts
// Y1c T26（plan v1.7——P3 排序 T21→T26→T22，偏离 38⑳）：生命周期义务观察器（spec v5.4 §6.5）。
// 服务端**只读观察**已受理帧的 FrameEffects（T9 收集器产物——AppliedEntry.effects per-walSeq buffer）
// → NodeLifecycle（lifecycleSeq per-project 数值序+当前行 partial unique）/DeliveryFence/LifecycleObligation
// **与对应帧前缀的 PG 批事务同事务落库**（帧↔义务原子——挂点=CanvasDocUpdateRepository.appendBatch
// inTx 钩，actor flushPrefixToPg 闭包注入）；义务可从帧前缀确定性重建（deriveLifecycleWrites 纯函数=
// 重建锚：同 frames+同 DB 基线态 → 同 writes——崩溃后重放前缀恢复义务，不依赖进程内状态）。
//
// 消费单源（禁复制逻辑——shared 冻结面）：
//  - effect→obligation 映射=execution-chain.ts §5 obligationsForFrameEffect（NODE_DELETED→
//    [FEED_TOMBSTONE,NODE_DELETED,EXEC_FINALIZE]；RESTORE/EDGE/MEDIA 族零义务）；
//  - 删除发射判定=lifecycle.ts shouldEmitDeleteObligation（仅当前 ACTIVE——DELETED/从未在册 no-op）；
//  - 义务种类 closed enum=lifecycle.ts OBLIGATION_KINDS；状态机/租约=execution-chain.ts §5
//    （本卡落生成面 PENDING 行；claim/complete 消费面=T22+/sweeper——nextObligationQueueState）。
//
// genesis 播种（T7/T21 未 seed NodeLifecycle——本卡补「每项目/节点按需」形态）：seedPresence 于
// actor 首批前按 doc 在册 presence 注册 ACTIVE 当前行（幂等——已注册跳过；walSeq=0=genesis 锚非帧）。
// 换代/重启后 doc 从 PG 前缀重载 → presence 播种恢复在册态；帧创建节点经 NODE_CREATED 注册。
//
// 交付 fence（T22 消费前置面）：deliveryFenceCheck=deliverArtifact 写 artifact 前的 node-deleted
// 权威判定（DELIVERY_FENCE_CONTRACT：fenceSeq==当前 lifecycleSeq 且 state=ACTIVE 才放行——
// 不匹配=丢弃不退款；doc data.written:false 观察自 T22 起弃用）。
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type * as Y from 'yjs';
import {
  obligationsForFrameEffect,
  shouldEmitDeleteObligation,
  type FrameEffect,
  type NodeLifecycleState,
  type ObligationKind,
} from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';

/** per-walSeq 义务 buffer 形态（AppliedEntry.effects 的帧前缀投影——T9 收集器单源，无第二套解析器）。 */
export interface LifecycleFrame {
  walSeq: bigint;
  effects: readonly FrameEffect[];
}

/** 节点当前在册态（NodeLifecycle isCurrent 行投影）。 */
export interface NodeCurrentState {
  lifecycleSeq: bigint;
  state: NodeLifecycleState;
}

/** derive 上下文（全部来自 DB 读——确定性重建不依赖进程内状态）。 */
export interface DeriveContext {
  /** isCurrent 行投影（无键=从未在册） */
  current: ReadonlyMap<string, NodeCurrentState>;
  /** 已落帧事件键 `${nodeId}\u0000${walSeq}\u0000${state}`（幂等重derive 跳过——flush 重试/重建路径） */
  seen: ReadonlySet<string>;
  /** per-project 下一 lifecycleSeq（MAX+1 起点——数值序分配单点） */
  nextSeq: bigint;
}

/** 单节点事件写集（一个 NODE_* effect 的落库投影）。 */
export interface LifecycleEventWrite {
  nodeId: string;
  /** 触发帧（帧↔义务原子锚） */
  walSeq: bigint;
  /** 新行 lifecycleSeq（per-project 数值序递增分配） */
  newSeq: bigint;
  /** 新行态（ACTIVE=注册/重建；DELETED=删除） */
  state: NodeLifecycleState;
  /** 翻转旧当前行（isCurrent=false——历史行保留；false=从未在册直建） */
  flipPrev: boolean;
  /** 应发射义务（closed enum——仅 NODE_DELETED 于 ACTIVE 当前态三义务；其余零） */
  obligations: readonly ObligationKind[];
}

export const lifecycleSeenKey = (nodeId: string, walSeq: bigint, state: NodeLifecycleState): string =>
  `${nodeId}\u0000${walSeq}\u0000${state}`;

/**
 * 确定性派生（纯函数——重建路径锚+语义四则单源）：
 *  - NODE_CREATED/NODE_RESTORED：已在册 ACTIVE=presence 已注册 no-op（幂等面）；否则新 ACTIVE 行
 *    （undo 重建=新 lifecycleSeq+恢复态——「重建」语义两 kind 同构：presence 注册即态机目的）；
 *  - NODE_DELETED：仅当前 ACTIVE 发射（shouldEmitDeleteObligation 冻结 truth table——DELETED/从未在册
 *    no-op 不二次退款）；发射=新 DELETED 行+三义务（obligationsForFrameEffect 单源）；
 *  - 同 frameset 内重复事件按 seen 键去重（结构性防御）；EDGE/MEDIA/FIELD 族零生命周期写（负控）。
 */
export function deriveLifecycleWrites(
  frames: readonly LifecycleFrame[],
  ctx: DeriveContext,
): { writes: LifecycleEventWrite[]; nextSeq: bigint } {
  const writes: LifecycleEventWrite[] = [];
  const seen = new Set(ctx.seen);
  const current = new Map(ctx.current);
  let nextSeq = ctx.nextSeq;
  for (const frame of frames) {
    for (const effect of frame.effects) {
      if (effect.kind === 'NODE_CREATED' || effect.kind === 'NODE_RESTORED') {
        const key = lifecycleSeenKey(effect.nodeId, frame.walSeq, 'ACTIVE');
        if (seen.has(key)) continue;
        seen.add(key);
        const cur = current.get(effect.nodeId);
        if (cur?.state === 'ACTIVE') continue;   // presence 已注册（幂等重derive/重复 effect）
        writes.push({
          nodeId: effect.nodeId, walSeq: frame.walSeq, newSeq: nextSeq++, state: 'ACTIVE',
          flipPrev: cur != null, obligations: obligationsForFrameEffect(effect.kind),
        });
        current.set(effect.nodeId, { lifecycleSeq: nextSeq - 1n, state: 'ACTIVE' });
      } else if (effect.kind === 'NODE_DELETED') {
        const key = lifecycleSeenKey(effect.nodeId, frame.walSeq, 'DELETED');
        if (seen.has(key)) continue;
        seen.add(key);
        const cur = current.get(effect.nodeId);
        if (!shouldEmitDeleteObligation(cur?.state)) continue;   // DELETED/从未在册=no-op（冻结 truth table）
        writes.push({
          nodeId: effect.nodeId, walSeq: frame.walSeq, newSeq: nextSeq++, state: 'DELETED',
          flipPrev: true, obligations: obligationsForFrameEffect('NODE_DELETED'),
        });
        current.set(effect.nodeId, { lifecycleSeq: nextSeq - 1n, state: 'DELETED' });
      }
      // EDGE_*/MEDIA_REF_*/FIELD_CHANGED：零生命周期写（义务种类 closed enum——清扫=NODE_DELETED 消费面）
    }
  }
  return { writes, nextSeq };
}

/** 交付 fence 判定（纯函数——DELIVERY_FENCE_CONTRACT 真值表）。 */
export type DeliveryFenceVerdict =
  | { allow: true; fenceSeq: bigint; state: 'ACTIVE' }
  | { allow: false; reason: 'node-deleted' | 'fence-stale' | 'unregistered'; fenceSeq?: bigint; currentSeq?: bigint; state?: NodeLifecycleState };

export function evaluateDeliveryFence(
  fence: { fenceSeq: bigint; state: string } | null,
  current: NodeCurrentState | undefined,
): DeliveryFenceVerdict {
  if (!fence) return { allow: false, reason: 'unregistered' };   // 无 fence 行=fail-closed 丢弃（契约字面「不匹配=丢弃」；T22 消费可显式放宽）
  if (fence.state !== 'ACTIVE') return { allow: false, reason: 'node-deleted', fenceSeq: fence.fenceSeq, state: fence.state as NodeLifecycleState };
  if (!current || current.lifecycleSeq !== fence.fenceSeq) {
    return { allow: false, reason: 'fence-stale', fenceSeq: fence.fenceSeq, currentSeq: current?.lifecycleSeq, state: current?.state };
  }
  return { allow: true, fenceSeq: fence.fenceSeq, state: 'ACTIVE' };
}

@Injectable()
export class CollabLifecycleObserverService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** lifecycleSeq 分配读基线：per-project MAX+1（单写者=actor flush 临界区——分配序≡提交序，
   *  迁移二未建 DB sequence（T21 表形无序列对象），MAX+1 事务内读满足「per-project 单调数值序」。 */
  private async nextSeqBase(tx: Prisma.TransactionClient, projectId: string): Promise<bigint> {
    const r = await tx.$queryRaw<{ max: bigint | null }[]>`
      SELECT MAX("lifecycleSeq") AS max FROM "NodeLifecycle" WHERE "projectId" = ${projectId}::text`;
    return (r[0]?.max ?? 0n) + 1n;
  }

  /**
   * genesis 播种（每项目/节点按需——T7/T21 未 seed 本卡补）：按 doc 在册 presence 注册 ACTIVE
   * 当前行（幂等：已注册节点跳过；两项目同 nodeId 不互串=键含 projectId）。walSeq=0=genesis 锚
   * （非帧触发——帧事件的 seen 键域 walSeq≥1 恒不冲突）。消费点=actor processBatch 首批前
   * （先于任何帧 effect 派生——删除真值以在册 presence 为基线）。
   */
  async seedPresence(projectId: string, doc: Y.Doc): Promise<number> {
    const nodeIds = [...doc.getMap('nodes').keys()].filter((id) => typeof id === 'string' && id !== '');
    if (nodeIds.length === 0) return 0;
    return this.prisma.$transaction(
      async (tx) => {
        const registered = await tx.nodeLifecycle.findMany({
          where: { projectId, nodeId: { in: nodeIds }, isCurrent: true },
          select: { nodeId: true },
        });
        const have = new Set(registered.map((r) => r.nodeId));
        const missing = nodeIds.filter((id) => !have.has(id));
        if (missing.length === 0) return 0;
        let nextSeq = await this.nextSeqBase(tx, projectId);
        const rows = missing.map((nodeId) => ({ projectId, nodeId, lifecycleSeq: nextSeq++, isCurrent: true, state: 'ACTIVE' as NodeLifecycleState, walSeq: 0n }));
        await tx.nodeLifecycle.createMany({ data: rows, skipDuplicates: true });
        await tx.deliveryFence.createMany({
          data: rows.map((r) => ({ projectId: r.projectId, nodeId: r.nodeId, fenceSeq: r.lifecycleSeq, state: 'ACTIVE' })),
          skipDuplicates: true,
        });
        return rows.length;
      },
      { timeout: 5_000, maxWait: 1_000 },
    );
  }

  /**
   * 帧前缀义务落库（帧↔义务原子——经 appendBatch inTx 钩在帧行+水位 CAS 同事务内执行）：
   * DB 读基线（isCurrent 投影+批 walSeq 区间已落事件）→ deriveLifecycleWrites 确定性派生 →
   * 写 NodeLifecycle（翻转旧行+新行）/DeliveryFence upsert/LifecycleObligation（PENDING，
   * unique(projectId,nodeId,kind,walSeq) 幂等）。失败=整事务回滚（帧行同回滚——原子性双向）。
   */
  async persistFramesInTx(
    tx: Prisma.TransactionClient,
    projectId: string,
    frames: readonly LifecycleFrame[],
  ): Promise<number> {
    // 生命周期 relevant 帧（NODE_* 族）+受影响节点集
    const nodeIds = new Set<string>();
    let minW: bigint | null = null;
    let maxW: bigint | null = null;
    for (const f of frames) {
      for (const e of f.effects) {
        if (e.kind === 'NODE_CREATED' || e.kind === 'NODE_RESTORED' || e.kind === 'NODE_DELETED') {
          nodeIds.add(e.nodeId);
          const w = f.walSeq;
          if (minW === null || w < minW) minW = w;
          if (maxW === null || w > maxW) maxW = w;
        }
      }
    }
    if (nodeIds.size === 0) return 0;
    // DB 基线读：当前行（isCurrent）+批 walSeq 区间已落事件（幂等重derive 跳过面）
    const ids = [...nodeIds];
    const currentRows = await tx.nodeLifecycle.findMany({
      where: { projectId, nodeId: { in: ids }, isCurrent: true },
      select: { nodeId: true, lifecycleSeq: true, state: true },
    });
    const seenRows = await tx.nodeLifecycle.findMany({
      where: { projectId, nodeId: { in: ids }, walSeq: { gte: minW ?? 0n, lte: maxW ?? 0n } },
      select: { nodeId: true, walSeq: true, state: true },
    });
    const current = new Map<string, NodeCurrentState>();
    const seen = new Set<string>();
    for (const r of currentRows) current.set(r.nodeId, { lifecycleSeq: r.lifecycleSeq, state: r.state as NodeLifecycleState });
    for (const r of seenRows) seen.add(lifecycleSeenKey(r.nodeId, r.walSeq, r.state as NodeLifecycleState));
    const { writes } = deriveLifecycleWrites(frames, { current, seen, nextSeq: await this.nextSeqBase(tx, projectId) });
    for (const w of writes) {
      if (w.flipPrev) {
        await tx.nodeLifecycle.updateMany({
          where: { projectId, nodeId: w.nodeId, isCurrent: true },
          data: { isCurrent: false },
        });
      }
      await tx.nodeLifecycle.createMany({
        data: [{ projectId, nodeId: w.nodeId, lifecycleSeq: w.newSeq, isCurrent: true, state: w.state, walSeq: w.walSeq }],
        skipDuplicates: true,
      });
      await tx.deliveryFence.upsert({
        where: { projectId_nodeId: { projectId, nodeId: w.nodeId } },
        create: { projectId, nodeId: w.nodeId, fenceSeq: w.newSeq, state: w.state },
        update: { fenceSeq: w.newSeq, state: w.state },
      });
      if (w.obligations.length > 0) {
        await tx.lifecycleObligation.createMany({
          data: w.obligations.map((kind) => ({ projectId, nodeId: w.nodeId, kind, walSeq: w.walSeq })),
          skipDuplicates: true,   // unique(projectId,nodeId,kind,walSeq)——flush 重试幂等
        });
      }
    }
    return writes.length;
  }

  /**
   * 交付 fence 权威判定（T22 deliverArtifact 消费面——node-deleted 权威自 T22 起从 doc
   * data.written:false 切换为本表）：fence 与当前 lifecycle 行两读对拍 evaluateDeliveryFence。
   */
  async deliveryFenceCheck(projectId: string, nodeId: string): Promise<DeliveryFenceVerdict> {
    const fence = await this.prisma.deliveryFence.findUnique({ where: { projectId_nodeId: { projectId, nodeId } } });
    const currentRow = await this.prisma.nodeLifecycle.findFirst({
      where: { projectId, nodeId, isCurrent: true },
      select: { lifecycleSeq: true, state: true },
    });
    return evaluateDeliveryFence(
      fence ? { fenceSeq: fence.fenceSeq, state: fence.state } : null,
      currentRow ? { lifecycleSeq: currentRow.lifecycleSeq, state: currentRow.state as NodeLifecycleState } : undefined,
    );
  }
}
