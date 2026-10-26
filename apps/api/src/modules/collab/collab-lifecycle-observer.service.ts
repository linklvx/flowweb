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
import {
  isFrameNodeTypeName,
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
  /** R-1② form a：stale 标记 projectId 集（进程内——observer 单例；staleProjectFencesInTx 落点登记，
   *  actor 下一帧批见标记则本批同事务跑 presence 重对齐后清除。进程内丢失（重启）无害：重启=doc
   *  重载→首批播种天然重对齐。事务回滚残留标记无害：presence 重对齐按 doc 真值幂等正确）。 */
  private readonly staleFenceProjects = new Set<string>();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** R-1②：项目存在 stale fence 标记（actor 播种触发器——同实例无需重载）。 */
  hasStaleFences(projectId: string): boolean { return this.staleFenceProjects.has(projectId); }
  /** R-1②：stale 标记清除（seed-bearing flush 落定后由 actor 调——重对齐已完成）。 */
  clearStaleFenceMark(projectId: string): void { this.staleFenceProjects.delete(projectId); }

  /** lifecycleSeq 分配读基线：per-project MAX+1（单写者=actor flush 临界区——分配序≡提交序，
   *  迁移二未建 DB sequence（T21 表形无序列对象），MAX+1 事务内读满足「per-project 单调数值序」）。 */
  private async nextSeqBase(tx: Prisma.TransactionClient, projectId: string): Promise<bigint> {
    const r = await tx.$queryRaw<{ max: bigint | null }[]>`
      SELECT MAX("lifecycleSeq") AS max FROM "NodeLifecycle" WHERE "projectId" = ${projectId}::text`;
    return (r[0]?.max ?? 0n) + 1n;
  }

  /** fence 批量 upsert（I-2：单条 INSERT..ON CONFLICT DO UPDATE 多值——unnest 三数组；按 nodeId 去重
   *  防同批同行二次影响〔ON CONFLICT DO UPDATE 不允许同行两次〕，后值胜=末事件语义）。 */
  private async upsertFencesInTx(
    tx: Prisma.TransactionClient,
    projectId: string,
    vals: ReadonlyArray<{ nodeId: string; fenceSeq: bigint; state: NodeLifecycleState }>,
  ): Promise<void> {
    if (vals.length === 0) return;
    const byNode = new Map<string, { nodeId: string; fenceSeq: bigint; state: NodeLifecycleState }>();
    for (const v of vals) byNode.set(v.nodeId, v);
    const rows = [...byNode.values()];
    await tx.$executeRaw`
      INSERT INTO "DeliveryFence" ("projectId", "nodeId", "fenceSeq", "state", "updatedAt")
      SELECT ${projectId}::text, n, s, st, now()
      FROM unnest(${rows.map((r) => r.nodeId)}::text[], ${rows.map((r) => r.fenceSeq)}::bigint[], ${rows.map((r) => r.state)}::text[]) AS t(n, s, st)
      ON CONFLICT ("projectId", "nodeId") DO UPDATE SET "fenceSeq" = EXCLUDED."fenceSeq", "state" = EXCLUDED."state", "updatedAt" = now()`;
  }

  /**
   * genesis 播种派生（纯函数——M-4 词表门：isFrameNodeTypeName 与 collector NODE_CREATED/RESTORED
   * 门同滤〔词表外 type 节点零播种——「存活期无行/重载后播种/删除时反发义务」漂移消除〕）。
   * presence=doc 在册节点 id→type 快照（actor 首批前捕获）；registered=DB isCurrent 行投影；
   * 已注册节点产 fence 重对齐值（I-1 恢复回路：fenceSeq==当前行 lifecycleSeq 不变量重建——
   * replayAll stale 后 presence 观测即复活），未注册节点产 genesis 行（walSeq=0 锚）。
   */
  static deriveSeedWrites(
    presence: ReadonlyMap<string, string>,
    registered: ReadonlyMap<string, NodeCurrentState>,
    nextSeq: bigint,
  ): { rows: Array<{ nodeId: string; lifecycleSeq: bigint }>; fences: Array<{ nodeId: string; fenceSeq: bigint; state: NodeLifecycleState }>; nextSeq: bigint } {
    const rows: Array<{ nodeId: string; lifecycleSeq: bigint }> = [];
    const fences: Array<{ nodeId: string; fenceSeq: bigint; state: NodeLifecycleState }> = [];
    let seq = nextSeq;
    for (const [id, type] of presence) {
      if (!isFrameNodeTypeName(type)) continue;                       // M-4：词表门（collector 对齐）
      const cur = registered.get(id);
      if (cur) {
        fences.push({ nodeId: id, fenceSeq: cur.lifecycleSeq, state: cur.state });   // 重对齐（不写 lifecycle 行）
      } else {
        const lifecycleSeq = seq++;
        rows.push({ nodeId: id, lifecycleSeq });
        fences.push({ nodeId: id, fenceSeq: lifecycleSeq, state: 'ACTIVE' });
      }
    }
    return { rows, fences, nextSeq: seq };
  }

  /**
   * 帧前缀义务落库（帧↔义务原子——经 appendBatch inTx 钩在帧行+水位 CAS 同事务内执行；I-2 批量化：
   * 事务内 round trip O(事件数)→O(1)——翻转合一 updateMany/新行一次 createMany/fence 单条 raw 多值/
   * 义务一次 createMany）。失败=整事务回滚（帧行同回滚——原子性双向）。幂等：seen 键跳过重derive+
   * 义务 unique(projectId,nodeId,kind,walSeq)——flush 重试/ambiguous commit 安全。
   * M-1：opts.seedPresence=首批 genesis 播种（presence 与帧派生同事务=单写者临界区统一——选型论证：
   * 独立事务形态=第二写者〔与 flush 临界区的 MAX+1 分配无序〕，同事务收编后 seed/派生/帧行/水位四者
   * 原子且分配单点；skipDuplicates 静默跳行结构性不可达〔同事务 findMany 先见已注册集〕，实插计数经
   * createMany 返回值显式可观测）。
   */
  async persistFramesInTx(
    tx: Prisma.TransactionClient,
    projectId: string,
    frames: readonly LifecycleFrame[],
    opts?: { seedPresence?: ReadonlyMap<string, string> },
  ): Promise<{ writes: number; seeded: number; obligations: number; obligationsByKind: Partial<Record<ObligationKind, number>> }> {
    const counts = { writes: 0, seeded: 0, obligations: 0, obligationsByKind: {} as Partial<Record<ObligationKind, number>> };
    let baseSeq = 0n;
    // —— ① genesis 播种（M-1：先于帧派生——删除真值以在册 presence 为基线）——
    if (opts?.seedPresence && opts.seedPresence.size > 0) {
      const regRows = await tx.nodeLifecycle.findMany({
        where: { projectId, nodeId: { in: [...opts.seedPresence.keys()] }, isCurrent: true },
        select: { nodeId: true, lifecycleSeq: true, state: true },
      });
      const registered = new Map<string, NodeCurrentState>();
      for (const r of regRows) registered.set(r.nodeId, { lifecycleSeq: r.lifecycleSeq, state: r.state as NodeLifecycleState });
      baseSeq = await this.nextSeqBase(tx, projectId);
      const seed = CollabLifecycleObserverService.deriveSeedWrites(opts.seedPresence, registered, baseSeq);
      if (seed.rows.length > 0) {
        const ins = await tx.nodeLifecycle.createMany({
          data: seed.rows.map((r) => ({ projectId, nodeId: r.nodeId, lifecycleSeq: r.lifecycleSeq, isCurrent: true, state: 'ACTIVE' as NodeLifecycleState, walSeq: 0n })),
          skipDuplicates: true,
        });
        counts.seeded = ins.count;   // 显式实插计数（M-1：静默跳行不可达——同事务先读已注册集）
      }
      await this.upsertFencesInTx(tx, projectId, seed.fences);
      baseSeq = seed.nextSeq;
    }
    // —— ② 帧事件派生（I-2 批量化）——
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
    if (nodeIds.size === 0) return counts;
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
    const { writes } = deriveLifecycleWrites(frames, { current, seen, nextSeq: baseSeq > 0n ? baseSeq : await this.nextSeqBase(tx, projectId) });
    if (writes.length === 0) return counts;
    // 翻转合一：节点首事件 flipPrev=true ⇒ DB 存在旧当前行（批内后续事件的翻转目标=批内前行——直插 isCurrent=false）
    const firstIdxByNode = new Map<string, number>();
    for (let i = 0; i < writes.length; i++) if (!firstIdxByNode.has(writes[i].nodeId)) firstIdxByNode.set(writes[i].nodeId, i);
    const flipNodes = [...new Set(writes.filter((w, i) => w.flipPrev && firstIdxByNode.get(w.nodeId) === i).map((w) => w.nodeId))];
    if (flipNodes.length > 0) {
      await tx.nodeLifecycle.updateMany({
        where: { projectId, nodeId: { in: flipNodes }, isCurrent: true },
        data: { isCurrent: false },
      });
    }
    // 每节点末事件=当前行（同帧 delete+restore 两行次序可分辨：中间行 isCurrent=false）
    const lastByNode = new Map<string, LifecycleEventWrite>();
    for (const w of writes) lastByNode.set(w.nodeId, w);
    await tx.nodeLifecycle.createMany({
      data: writes.map((w) => ({
        projectId, nodeId: w.nodeId, lifecycleSeq: w.newSeq,
        isCurrent: lastByNode.get(w.nodeId) === w,
        state: w.state, walSeq: w.walSeq,
      })),
      skipDuplicates: true,
    });
    // fence=每节点末事件行（批量单条 raw——中间事件行不投影 fence）
    await this.upsertFencesInTx(tx, projectId, [...lastByNode.values()].map((w) => ({ nodeId: w.nodeId, fenceSeq: w.newSeq, state: w.state })));
    const obligations = writes.flatMap((w) => w.obligations.map((kind) => ({ projectId, nodeId: w.nodeId, kind, walSeq: w.walSeq })));
    if (obligations.length > 0) {
      await tx.lifecycleObligation.createMany({ data: obligations, skipDuplicates: true });
      counts.obligations = obligations.length;
      for (const o of obligations) counts.obligationsByKind[o.kind] = (counts.obligationsByKind[o.kind] ?? 0) + 1;
    }
    counts.writes = writes.length;
    return counts;
  }

  /**
   * 项目级 fence stale（I-1 收口：replayAll 回灌窗——replay 机械落帧行不派生 effects，生命周期表
   * 维持 stale-ACTIVE 且 fenceSeq==lifecycleSeq 双陈旧匹配=交付逃逸洞）。fenceSeq 置 0 制造不匹配
   * →fence-stale fail-closed（交付拒）直至下一生命周期事件/presence 播种重对齐；与回灌帧行同事务
   * （appendBatch inTx——原子：行在 ⇒ fence 已 stale）。语义终态（帧前缀重 derive）归 T27 恢复链。
   */
  async staleProjectFencesInTx(tx: Prisma.TransactionClient, projectId: string): Promise<number> {
    const n = await tx.$executeRaw`
      UPDATE "DeliveryFence" SET "fenceSeq" = 0, "updatedAt" = now()
      WHERE "projectId" = ${projectId}::text AND "fenceSeq" <> 0`;
    this.staleFenceProjects.add(projectId);   // R-1② form a：stale 标记（进程内——回滚残留无害，见字段注记）
    return n;   // M-7：计数归调用点（落定后 observe——本方法在 tx 内，回滚不计数由调用点 r.ok 门保证）
  }

  /**
   * 交付 fence 权威判定（M-2：tx 版=T22 deliverArtifact 交付事务内消费面——DeliveryFence 行
   * FOR UPDATE 锁读串行化：判定与后续 artifact 写同事务不可插队）。判定单源=evaluateDeliveryFence。
   */
  async deliveryFenceCheckInTx(tx: Prisma.TransactionClient, projectId: string, nodeId: string): Promise<DeliveryFenceVerdict> {
    const fenceRows = await tx.$queryRaw<{ fenceSeq: bigint; state: string }[]>`
      SELECT "fenceSeq", state FROM "DeliveryFence"
      WHERE "projectId" = ${projectId}::text AND "nodeId" = ${nodeId}::text FOR UPDATE`;
    const currentRow = await tx.nodeLifecycle.findFirst({
      where: { projectId, nodeId, isCurrent: true },
      select: { lifecycleSeq: true, state: true },
    });
    return evaluateDeliveryFence(
      fenceRows[0] ? { fenceSeq: fenceRows[0].fenceSeq, state: fenceRows[0].state } : null,
      currentRow ? { lifecycleSeq: currentRow.lifecycleSeq, state: currentRow.state as NodeLifecycleState } : undefined,
    );
  }

  /**
   * 交付 fence 权威判定（非事务版——**advisory-only**：无行锁，交付事务外预检/观测面；权威消费
   * 必须用 deliveryFenceCheckInTx〔M-2〕——判定与 artifact 写之间存在 TOCTOU 窗）。
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

/** genesis 播种派生（模块级导出=静态方法别名——deriveSeedWrites 单源；词表门 M-4）。 */
export const deriveSeedWrites = CollabLifecycleObserverService.deriveSeedWrites;
