// apps/api/src/modules/collab/collab-project-actor.service.ts
// Y1c T9（plan v1.7 Task 9——偏离 38③/§4.1 v5.4）：spool-first 写管线核心——per-project 单例
// CollabProjectActor。submit(frame,conn)→Promise 入队；单 drain 循环批量（≤20ms 自最老帧/≤1MiB/
// 空闲即收——ACTOR_DRAIN_* 契约常量）→一次 WAL appendBatch+fsync→逐帧 Y.applyUpdate（origin=
// GateApplyOrigin——isGateApplyOrigin 判过 {source:'connection'} 形）→逐帧 resolve（beforeSync
// await 本 promise=ACK 时帧必已 fsync——spool 先于 apply/resolve 的次序铁律）→appliedSeq=walSeq
// →PG drain 批同事务多行 append（Controller 裁定 1）→confirm spool 帧。
//
// 准入链（APPLY_ADMISSION_STAGES ⓪-⑤，次序冻结——actor 串行段内逐帧）：
//  ⓪ readOnly/writeFreeze/quota 短路**最先**（库 readOnly 检查在 beforeSync 之后 esm:264-276——
//     gate 先 apply 则 VIEWER 帧已入 doc，F-5；故 apply 归 actor 后必须自判——VIEWER 发 Update→
//     doc 不变，noop resolve 交库 SyncStatus(false)）
//  ① 每帧对照世代权威验证 generation（host.generationOf——装载播种/vacuum 换代刷新，非连接建立时
//     缓存〔偏离 36-②〕）+身份/权限/格式→P1 shape fixture（root/预算/通用格式——全类型最终矩阵
//     运行时准入在 T24 激活）
//  ② pending 区间预检（契约 analyzePendingIntervals——修正 #2 三分精化：扣除 SV 已覆盖前缀/SV 覆盖
//     的 Skip 放行/DS-only 未知 clock→4412 零 WAL 零 apply 零 ACK）
//  ③ 帧字节精确 copy 至独立 buffer（禁 subarray 共享——lib0 越界读实测）+SHA-256 去重 promise map
//     （去重后才分配 walSeq；命中 inflight=await 原帧 fsync+apply 完成才放行、原帧失败重复帧同错；
//     命中 applied=no-op——「零重复 walSeq」进程内防线；跨重启由 WAL 去重索引承接〔偏离 38④〕）
//  ④ WAL 批量追加+fsync（spool.appendBatch——单 fsync；新段含目录 fsync）
//  ⑤ actor 内 pre-apply→appliedSeq=walSeq→Hocuspocus 幂等重放（yjs.cjs:3385-3390 零 update 事件）
//
// FrameEffects 收集器（修正 #1——FRAME_EFFECTS_TIMING_AUTHORITY：apply 后 actor 临界区内为准；
// afterTransaction 事务清理面+根 observeDeep+typeIdToNodeId；apply 前清空 apply 后取走，失败/pending
// 丢弃不残留）+ProjectDocIndex（修正 #1——T9 建/T24·T26 复用同实例；只消费 effects 不直接
// observeDeep，崩溃 rebuild(doc) 从 PG 前缀重建）。
//
// 毒帧（POISON_FRAME_PROTOCOL——fsync 成功+apply 失败）：同步关项目全部连接（广播 flush 前——
// 坏帧不漏给其他在线端）+停写+WAL 截断至 appliedSeq（spool.truncateWalAfter——不跳帧续提交）+
// close 4411+从 pgSeq 重放（doc 卸载后装载=PG 前缀重建；恢复编排归 T13）。
//
// SS2 大帧并发信号量（偏离 38⑱：全局内存预算 SS2_SEMAPHORE_GLOBAL_BUDGET_BYTES+per-project
// SS2_SEMAPHORE_PER_PROJECT——超预算=瞬态拒 close 1008）+认证后 per-connection 入站排队字节上限
// （INBOUND_QUEUE_LIMIT_BYTES=2×ss2FrameGate 超限 close 1009）+per-project 写入背压（偏离 36-③
// ——队列上限拒收，单项目不拖垮其他项目）。
//
// census 登记义务：本文件 Y.applyUpdate 调用点=gate 档（check-collab-census ㉜ 白名单+⑮ worker
// 闭包登记红 until 片D——见两登记面注释）。
import { Injectable, Optional, Inject, Logger } from '@nestjs/common';
import * as Y from 'yjs';
import { createHash } from 'node:crypto';
import {
  ACTOR_DRAIN_BATCH_MAX_BYTES,
  ACTOR_DRAIN_BATCH_MAX_MS,
  analyzePendingIntervals,
  SS2_SEMAPHORE_GLOBAL_BUDGET_BYTES,
  SS2_SEMAPHORE_PER_PROJECT,
  INBOUND_QUEUE_LIMIT_BYTES,
  INBOUND_QUEUE_OVER_LIMIT_CLOSE_CODE,
  WAL_DEDUP_INDEX_TTL_MS,
  WAL_DEDUP_INDEX_MAX_ENTRIES,
  CollabCloseCode,
  DOC_OVER_QUOTA_TERMINAL_REASON,
  DOC_GENERATION_STALE_TERMINAL_REASON,
  QUOTA_DEFAULTS,
} from '@flowweb/shared';
import {
  MEDIA_REF_TARGET_FIELDS,
  isFrameNodeTypeName,
  type FrameEffect,
  type ProjectDocIndex,
  type GateApplyOrigin,
} from '@flowweb/shared';
import { CollabSpoolService } from './collab-spool.service';
import { CollabPgBreakerService } from './collab-pg-breaker.service';
import { projectDocName } from './doc-name.util';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { captureCollabException } from '../../utils/sentry-scrub';
import { actorDrainBatchTotal, actorDrainBatchFrames, actorDedupHitTotal, actorFrameOutcomeTotal, actorPoisonFrameTotal, collabQuotaFrameRejectedTotal, frameEffectsTotal, inboundQueueOverLimitTotal, projectBackpressureTotal, ss2SemaphoreTotal, yjsStorePayloadBytes, yjsStoreTotal } from './store.metrics';
import type { CollabConnection } from './collab.gateway';

/** 帧受理结果（resolve 形态——ACK 档位前置面：walSeq=帧序号；noop=true=零 WAL 零 apply 放行
 *  （readOnly/冻结短路——库侧自送 SyncStatus(false)/applied 去重命中）。 */
export interface ActorFrameResult { walSeq: bigint; noop?: boolean }

/** PG 腿失败档（Q-I2：随 flushBatchToPg 返回元组走——'fenced'=写权 fencing；Error=PG 异常
 *  （leaseRowMissing/leaseNotHeld 挂 Error——repo appendBatch 契约）；null=breaker-open 短路。 */
type PgFlushErrorKind = 'fenced' | Error | null;
/** PG 批 flush 结果元组（Q-I2——单批单源，替代跨 await 共享字段 lastPgError）。 */
type PgFlushOutcome = { landed: boolean; errorKind: PgFlushErrorKind };

/** 帧拒绝（reject 形态——码权威投递由 gate/actor host.hardClose 先行，本错误仅中止 beforeSync）。 */
export class FrameRejectError extends Error {
  constructor(readonly code: number, readonly frameReason: string) { super(`frame rejected: ${code} ${frameReason}`); }
}

/** actor host 最小接口（bindHost 后置绑定——B1/W3a 同款形态；gateway 1 行转发接线）。 */
export interface CollabProjectActorHost {
  readonly logger: Logger;
  /** 库 documents Map 只读访问器（apply 目标 doc 定位）。 */
  documents(): ReadonlyMap<string, Y.Doc>;
  /** code 权威投递关闭（SG 能力经 gateway 转发——hardClose 先行 throw 兜底）。 */
  hardClose(conn: CollabConnection | undefined | null, code: number, reason: string): void;
  /** 配额冻结判定（DR quotaFrozenDocs——⓪ 短路面）。 */
  isQuotaFrozen(pid: string): boolean;
  /** 世代权威读面（DR docGeneration——装载播种/vacuum 换代刷新；undefined=未装载未知）。 */
  generationOf(pid: string): number | undefined;
  /** readOnly 丢帧计数+per-conn overPush 升级判定（DR 冻结族——true=升级 4404 关闭）。 */
  noteReadOnlyDrop(conn: CollabConnection, pid: string, bytes: number): boolean;
  /** PG append fenced（RC4 承接：fenced→selfIsolate→closeAll→释放 listener——gateway selfIsolate 同链）。 */
  onFencedByWrite(): Promise<void>;
}

/** P1 shape fixture 校验（准入链 ①——root/预算/通用格式；全类型最终矩阵运行时准入在 T24 激活）。 */
const P1_ALLOWED_ROOTS = new Set(['nodes', 'edges', 'exec', 'meta']);
/** P1 结构预算工程值（T24 矩阵激活时收紧——本卡防 DoS 级上界：structs ≤8×maxNodesPerTx、
 *  ds 区间 ≤4096；帧字节闸在 gate ⓪ 先行（Update 2×maxTxBytes/SS2 maxDocBytes+ALLOWANCE）。 */
const P1_MAX_STRUCTS = 8 * QUOTA_DEFAULTS.maxNodesPerTx;
const P1_MAX_DS_RANGES = 4096;

export function validateP1Shape(update: Uint8Array): { ok: true } | { ok: false; code: number; reason: string } {
  let decoded: ReturnType<typeof Y.decodeUpdate>;
  try {
    decoded = Y.decodeUpdate(update);   // ① 通用格式：解码失败=4411 毒帧面（零 WAL 零 apply）
  } catch {
    return { ok: false, code: CollabCloseCode.FRAME_MALFORMED, reason: 'frame-malformed' };
  }
  if (decoded.structs.length > P1_MAX_STRUCTS || decoded.ds.clients.size > P1_MAX_DS_RANGES) {
    return { ok: false, code: CollabCloseCode.FRAME_MALFORMED, reason: 'frame-budget-exceeded' };
  }
  // root 白名单：根级 struct 的 parent=根名（string）；嵌套（parent=ID）归 T24 全类型矩阵
  for (const st of decoded.structs) {
    const parent = (st as unknown as { parent?: unknown }).parent;
    if (typeof parent === 'string' && !P1_ALLOWED_ROOTS.has(parent)) {
      return { ok: false, code: CollabCloseCode.FRAME_MALFORMED, reason: `unknown-root:${parent}` };
    }
  }
  return { ok: true };
}

/** SV wire 编码（Map<client,clock> → Uint8Array——Y.decodeStateVector 同格式：varUint n + n×(client,clock)）。
 *  批内逐帧 pending 预检的覆盖演进面（同批同 client 后继帧以前驱已准入区间为覆盖——防批合帧误判 4412）。 */
function encodeSvMap(sv: Map<number, number>): Uint8Array {
  const out: number[] = [];
  const wv = (n: number) => {   // lib0 varUint 手写（LEB128）——零 import 面
    let v = n;
    for (;;) { const b = v & 0b01111111; v >>>= 7; if (v === 0) { out.push(b); return; } out.push(b | 0b10000000); }
  };
  wv(sv.size);
  for (const [client, clock] of sv) { wv(client); wv(clock); }
  return Uint8Array.from(out);
}

// ═══════════════════ FrameEffects 收集器+ProjectDocIndex（修正 #1——T9 建）═══════════════════

const mediaIdListOf = (v: unknown): string[] => {
  if (typeof v === 'string') return v === '' ? [] : [v];
  if (Array.isArray(v)) return v.map((it) => (typeof it === 'string' ? it : typeof (it as { id?: unknown })?.id === 'string' ? (it as { id: string }).id : '')).filter((s) => s !== '');
  if (v && typeof v === 'object' && 'toArray' in (v as object) && typeof (v as { toArray?: unknown }).toArray === 'function') {
    try { return mediaIdListOf((v as { toArray: () => unknown[] }).toArray()); } catch { return []; }
  }
  return [];
};

/** per-doc 收集器（WeakMap 键控——doc 消亡即失联；事件签名结构性窄化，零 @hocuspocus import）。 */
class FrameEffectsCollector {
  private buffer: FrameEffect[] = [];
  private walSeq: bigint = 0n;
  private frameDeleted = new Set<string>();
  private installed = new WeakSet<Y.Doc>();
  private nodeIds = new WeakMap<object, string>();   // typeIdToNodeId：node Y.Map 实例→nodeId

  /** apply 前清空（失败/pending 丢弃不残留——契约 collector 语义）。 */
  begin(walSeq: bigint): void {
    this.buffer = [];
    this.walSeq = walSeq;
    this.frameDeleted = new Set();
  }

  /** apply 后取走（T24/T26 消费 buffer 的取走面）。 */
  take(): FrameEffect[] {
    const out = this.buffer;
    this.buffer = [];
    return out;
  }

  install(doc: Y.Doc): void {
    if (this.installed.has(doc)) return;
    this.installed.add(doc);
    const nodes = doc.getMap('nodes');
    const edges = doc.getMap('edges');
    // typeIdToNodeId 播种：既有节点（rebuild 后增量维护——索引与 appliedSeq 同源推进）
    for (const [id, v] of nodes.entries()) if (v && typeof v === 'object') this.nodeIds.set(v as object, id);
    nodes.observeDeep((events) => {
      for (const ev of events) {
        const path = ev.path;
        const target = ev.target as unknown as { get?: (k: string) => unknown };
        if (path.length === 0) {
          // nodes 根：keysAdded→NODE_CREATED/RESTORED；keysDeleted→NODE_DELETED
          for (const [key, ch] of ev.changes.keys) {
            if (ch.action === 'add') {
              const val = target?.get?.(key);
              const type = val && typeof val === 'object' ? (val as { get?: (k: string) => unknown }).get?.('type') : undefined;
              if (typeof val === 'object' && val !== null) this.nodeIds.set(val as object, key);
              if (isFrameNodeTypeName(type)) {
                this.buffer.push(this.frameDeleted.has(key)
                  ? { kind: 'NODE_RESTORED', nodeId: key, type, walSeq: this.walSeq }   // delete+restore 同帧=两枚 effect 两行义务
                  : { kind: 'NODE_CREATED', nodeId: key, type, walSeq: this.walSeq });
              }
              // 同事务新建的 data 子 map 不产独立事件（实测）——媒体引用在节点新增面一并差分
              const dm = val && typeof val === 'object' ? (val as { get?: (k: string) => unknown }).get?.('data') : undefined;
              if (dm && typeof dm === 'object' && 'get' in (dm as object)) {
                for (const f of MEDIA_REF_TARGET_FIELDS) {
                  for (const mid of mediaIdListOf((dm as { get: (k2: string) => unknown }).get(f))) {
                    this.buffer.push({ kind: 'MEDIA_REF_ADDED', nodeId: key, mediaId: mid, walSeq: this.walSeq });
                  }
                }
              }
            } else if (ch.action === 'delete') {
              this.frameDeleted.add(key);
              this.buffer.push({ kind: 'NODE_DELETED', nodeId: key, walSeq: this.walSeq });
            }
          }
        } else {
          const nodeId = String(path[0]);
          // 节点级/子 map 级：变更键 k=字段（path 尾名=子 map 身份〔data/position〕非字段——媒体字段
          // 判定恒用 k）；媒体引用字段→MEDIA_REF_*；其余→FIELD_CHANGED（逐键粒度）
          for (const [k, ch] of ev.changes.keys) {
            if ((MEDIA_REF_TARGET_FIELDS as readonly string[]).includes(k)) {
              for (const mid of mediaIdListOf(ch.action === 'delete' ? ch.oldValue : target?.get?.(k))) {
                this.buffer.push(ch.action === 'delete'
                  ? { kind: 'MEDIA_REF_REMOVED', nodeId, mediaId: mid, walSeq: this.walSeq }
                  : { kind: 'MEDIA_REF_ADDED', nodeId, mediaId: mid, walSeq: this.walSeq });
              }
            } else if (k === 'data') {
              // data map 整键变更（同事务新建/覆写——嵌套新建 map 不产独立事件）：新旧值媒体字段差分
              const readFields = (m: unknown) => {
                const out = new Set<string>();
                if (!m || typeof m !== 'object' || !('get' in (m as object))) return out;
                for (const f of MEDIA_REF_TARGET_FIELDS) for (const mid of mediaIdListOf((m as { get: (k2: string) => unknown }).get(f))) out.add(mid);
                return out;
              };
              const olds = readFields(ch.oldValue);
              const news = readFields(target?.get?.('data'));
              for (const mid of news) if (!olds.has(mid)) this.buffer.push({ kind: 'MEDIA_REF_ADDED', nodeId, mediaId: mid, walSeq: this.walSeq });
              for (const mid of olds) if (!news.has(mid)) this.buffer.push({ kind: 'MEDIA_REF_REMOVED', nodeId, mediaId: mid, walSeq: this.walSeq });
            } else {
              this.buffer.push({ kind: 'FIELD_CHANGED', nodeId, key: k, walSeq: this.walSeq });
            }
          }
        }
      }
    });
    edges.observeDeep((events) => {
      for (const ev of events) {
        if (ev.path.length !== 0) continue;   // 边端点改写归 T24 矩阵（键级足够）
        for (const [edgeId, ch] of ev.changes.keys) {
          const val = ch.action === 'delete' ? ch.oldValue : (ev.target as unknown as { get?: (k: string) => unknown })?.get?.(edgeId);
          const src = val && typeof val === 'object' ? String((val as { get?: (k: string) => unknown }).get?.('source') ?? '') : '';
          const tgt = val && typeof val === 'object' ? String((val as { get?: (k: string) => unknown }).get?.('target') ?? '') : '';
          this.buffer.push(ch.action === 'delete'
            ? { kind: 'EDGE_REMOVED', edgeId, source: src, target: tgt, walSeq: this.walSeq }
            : { kind: 'EDGE_ADDED', edgeId, source: src, target: tgt, walSeq: this.walSeq });
        }
      }
    });
  }
}

/** ProjectDocIndex 实现（契约成员面冻结于 shared frame-effects.ts——轻量反向索引：nodeId→类型/
 * incident-edge/media 引用；只消费 effects 增量维护+rebuild(doc) 崩溃重建）。 */
export class ProjectDocIndexImpl implements ProjectDocIndex {
  private readonly nodeTypes = new Map<string, string>();
  private readonly edgesByNodeMap = new Map<string, Set<string>>();
  private readonly mediaRefsByNodeMap = new Map<string, Set<string>>();

  nodeType(nodeId: string): string | undefined { return this.nodeTypes.get(nodeId); }
  get edgesByNode(): ReadonlyMap<string, ReadonlySet<string>> { return this.edgesByNodeMap; }
  get mediaRefsByNode(): ReadonlyMap<string, ReadonlySet<string>> { return this.mediaRefsByNodeMap; }

  apply(effects: readonly FrameEffect[]): void {
    for (const e of effects) {
      switch (e.kind) {
        case 'NODE_CREATED':
        case 'NODE_RESTORED':
          this.nodeTypes.set(e.nodeId, e.type);
          break;
        case 'NODE_DELETED':
          this.nodeTypes.delete(e.nodeId);
          this.edgesByNodeMap.delete(e.nodeId);   // 节点自身反查面随删；悬挂边（对端 entry）清理归 T24 NORMALIZE（读侧确定性屏蔽——非 gate 职责）
          this.mediaRefsByNodeMap.delete(e.nodeId);
          break;
        case 'EDGE_ADDED': {
          for (const n of [e.source, e.target]) {
            const s = this.edgesByNodeMap.get(n) ?? new Set<string>();
            s.add(e.edgeId);
            this.edgesByNodeMap.set(n, s);
          }
          break;
        }
        case 'EDGE_REMOVED': {
          for (const n of [e.source, e.target]) this.edgesByNodeMap.get(n)?.delete(e.edgeId);
          break;
        }
        case 'MEDIA_REF_ADDED': {
          const s = this.mediaRefsByNodeMap.get(e.nodeId) ?? new Set<string>();
          s.add(e.mediaId);
          this.mediaRefsByNodeMap.set(e.nodeId, s);
          break;
        }
        case 'MEDIA_REF_REMOVED':
          this.mediaRefsByNodeMap.get(e.nodeId)?.delete(e.mediaId);
          break;
        case 'FIELD_CHANGED':
          break;
      }
    }
  }

  rebuild(doc: Y.Doc): void {
    this.nodeTypes.clear();
    this.edgesByNodeMap.clear();
    this.mediaRefsByNodeMap.clear();
    const nodes = doc.getMap('nodes');
    for (const [id, v] of nodes.entries()) {
      if (!v || typeof v !== 'object') continue;
      const type = (v as { get?: (k: string) => unknown }).get?.('type');
      if (typeof type === 'string') this.nodeTypes.set(id, type);
      const data = (v as { get?: (k: string) => unknown }).get?.('data');
      if (data && typeof data === 'object' && 'get' in (data as object)) {
        for (const f of MEDIA_REF_TARGET_FIELDS) {
          for (const mid of mediaIdListOf((data as { get: (k: string) => unknown }).get(f))) {
            const s = this.mediaRefsByNodeMap.get(id) ?? new Set<string>();
            s.add(mid);
            this.mediaRefsByNodeMap.set(id, s);
          }
        }
      }
    }
    for (const [eid, v] of doc.getMap('edges').entries()) {
      if (!v || typeof v !== 'object') continue;
      const src = String((v as { get?: (k: string) => unknown }).get?.('source') ?? '');
      const tgt = String((v as { get?: (k: string) => unknown }).get?.('target') ?? '');
      for (const n of [src, tgt]) {
        const s = this.edgesByNodeMap.get(n) ?? new Set<string>();
        s.add(eid);
        this.edgesByNodeMap.set(n, s);
      }
    }
  }
}

// ═══════════════════ 队列/drain 状态 ═══════════════════

interface QueueItem {
  payload: Uint8Array;          // 帧字节精确 copy（禁 subarray 共享——③）
  hashHex: string;
  conn: CollabConnection | null;
  kind: 'update' | 'ss2' | 'maintenance';
  bytes: number;
  enqueuedAt: number;
  submitGeneration: number | undefined;
  resolve: (r: ActorFrameResult) => void;
  reject: (e: FrameRejectError) => void;
}

interface ProjectActorState {
  queue: QueueItem[];
  draining: boolean;
  appliedSeq: bigint;
  readonly docIndex: ProjectDocIndexImpl;
}

/** per-project 写入背压上限（偏离 36-③——工程值：512 帧/2×入站限〔33.8MB——容纳 SS2 大帧对〕；
 *  超限=瞬态拒 close 1008 单项目不拖垮其他项目）。 */
const PROJECT_QUEUE_MAX_FRAMES = 512;
const PROJECT_QUEUE_MAX_BYTES = 2 * INBOUND_QUEUE_LIMIT_BYTES;

@Injectable()
export class CollabProjectActorService {
  private host!: CollabProjectActorHost;
  private readonly collectorsByDoc = new WeakMap<Y.Doc, FrameEffectsCollector>();   // per-doc（多项目 drain 并发不混 buffer）
  private readonly states = new Map<string, ProjectActorState>();
  /** SHA-256 去重 promise map（键 `${pid}\u0000${hashHex}`——inflight=await 原帧；settled-applied=no-op；
   *  原帧失败重复帧同错（promise 链自然传播）。有界：TTL 24h/100k（与 WAL 去重索引同界——偏离 38④）。 */
  private readonly dedupMap = new Map<string, { state: 'inflight' | 'applied'; promise?: Promise<ActorFrameResult>; walSeq?: bigint; at: number }>();
  /** SS2 大帧并发信号量（全局内存预算字节+per-project 占用集——偏离 38⑱）。inFlight=apply 段占用；
   *  pending=submit 已入队未落定（预算预检含 pending——防「批在途而预算空转」滞后窗）。 */
  private ss2BytesInFlight = 0;
  private ss2PendingBytes = 0;
  private readonly ss2Projects = new Set<string>();
  private readonly ss2PendingProjects = new Set<string>();
  /** 认证后 per-connection 入站排队字节（submit 未落定面——超 2×ss2FrameGate close 1009）。 */
  private readonly inboundBytesByConn = new WeakMap<object, number>();

  constructor(
    @Inject(CollabSpoolService) private readonly spool: CollabSpoolService,
    @Inject(CanvasDocUpdateRepository) private readonly repo: CanvasDocUpdateRepository,
    @Optional() @Inject(CollabPgBreakerService) private readonly pgBreaker?: CollabPgBreakerService,
  ) {}

  bindHost(host: CollabProjectActorHost): void { this.host = host; }

  /** repo 重绑缝（Y1c T9：pg-breaker int 装置「换接真库 repo」——测试专用面，生产禁调。
   *  actor 构造持有 repo 引用，façade stubRepo 换 gateway.repo 不及此处=探测腿仍打旧桩。 */
  rebindRepoForTest(repo: CanvasDocUpdateRepository): void {
    (this as unknown as { repo: CanvasDocUpdateRepository }).repo = repo;
  }

  /** actor 读面（测试/观测）：per-project appliedSeq（内存级——重启由 WAL+pgSeq 前缀校验重建）。 */
  appliedSeqOf(pid: string): bigint { return this.states.get(pid)?.appliedSeq ?? 0n; }
  /** ProjectDocIndex 读面（T24/T26 复用同实例——修正 #1：由 T9 建）。 */
  docIndexOf(pid: string): ProjectDocIndex { return this.stateOf(pid).docIndex; }

  /** Q-I1：doc 卸载/项目消失的 per-project actor 状态清理（BEFORE_UNLOAD_DRAIN_CONTRACT.cleanupKey
   *  '(projectId,generation)' 契约兑现——gateway afterUnloadDocument/handleProjectsGone 链接线；
   *  无此钩=per-project ProjectDocIndex/states 无界驻留）。守卫：仅在队列空且 drain 静止时删除
   *  （在飞/残留帧=落定中，删除+重建会破单 drain 串行不变量+丢 appliedSeq——留驻待下次钩，doc 重装
   *  后 stateOf 重建=「卸载+装载」既有语义：appliedSeq 归零**不靠 spool 水位钳制兜底**——正确性由
   *  spool 侧 noteApplied 单调门+min 钳制（applied≤spoolHead，磁盘为准）+assertWatermarkInvariants
   *  tripwire 保序，重建一致性交恢复链〔重启 WAL+pgSeq 前缀校验〕）。dedupMap 有界
   *  （TTL/100k 驱逐）不随删；landedSince 残留标记随清（已卸载 doc 的 disconnect 判据无消费面）。
   *  幂等（无键 no-op）。 */
  onProjectStateCleanup(projectId: string): void {
    this.landedSince.delete(projectId);
    const st = this.states.get(projectId);
    if (!st) return;
    if (st.draining || st.queue.length > 0) return;   // 帧落定中——保守留驻
    this.states.delete(projectId);
  }

  private stateOf(pid: string): ProjectActorState {
    let st = this.states.get(pid);
    if (!st) {
      st = { queue: [], draining: false, appliedSeq: 0n, docIndex: new ProjectDocIndexImpl() };
      this.states.set(pid, st);
    }
    return st;
  }

  /** connection 帧受理入口（gate beforeSync await 本 promise——resolve=fsync+apply 完成）。
   *  拒绝形态=reject（FrameRejectError）——码权威投递（hardClose）已在提交前由本方法完成。 */
  submit(projectId: string, frame: Uint8Array, conn: CollabConnection | null, kind: 'update' | 'ss2'): Promise<ActorFrameResult> {
    const hashHex = createHash('sha256').update(frame).digest('hex');
    const key = `${projectId}\u0000${hashHex}`;
    // ③ SHA-256 去重 promise map（去重后才分配 walSeq——命中不烧 seq）
    const hit = this.dedupMap.get(key);
    if (hit) {
      if (Date.now() - hit.at > WAL_DEDUP_INDEX_TTL_MS) this.dedupMap.delete(key);
      else if (hit.state === 'applied') {
        actorDedupHitTotal.inc({ state: 'applied' });
        actorFrameOutcomeTotal.inc({ outcome: 'noop-dedup' });
        return Promise.resolve({ walSeq: hit.walSeq ?? 0n, noop: true });   // 命中 applied=no-op 确认
      } else if (hit.promise) {
        actorDedupHitTotal.inc({ state: 'inflight' });
        return hit.promise.then((r) => ({ walSeq: r.walSeq, noop: true }));   // await 原帧 fsync+apply 完成才放行；原帧失败重复帧同错（reject 传播）
      }
    }
    // 帧字节精确 copy（真拷贝——subarray 共享底层 buffer 的 lib0 越界读反例为验收锚）
    const payload = new Uint8Array(frame.byteLength);
    payload.set(frame);
    const st = this.stateOf(projectId);
    // per-project 写入背压（偏离 36-③——单项目不拖垮其他项目）
    const queuedBytes = st.queue.reduce((s, i) => s + i.bytes, 0);
    if (st.queue.length >= PROJECT_QUEUE_MAX_FRAMES || queuedBytes + payload.byteLength > PROJECT_QUEUE_MAX_BYTES) {
      projectBackpressureTotal.inc();
      this.host.hardClose(conn, CollabCloseCode.RATE_LIMITED_CLOSE, 'project-write-backpressure');
      return Promise.reject(new FrameRejectError(CollabCloseCode.RATE_LIMITED_CLOSE, 'project-write-backpressure'));
    }
    // 认证后 per-connection 入站排队字节上限（2×ss2FrameGate 超限 1009）
    if (conn) {
      const cur = this.inboundBytesByConn.get(conn) ?? 0;
      if (cur + payload.byteLength > INBOUND_QUEUE_LIMIT_BYTES) {
        inboundQueueOverLimitTotal.inc();
        this.host.hardClose(conn, INBOUND_QUEUE_OVER_LIMIT_CLOSE_CODE, 'inbound-queue-over-limit');
        return Promise.reject(new FrameRejectError(INBOUND_QUEUE_OVER_LIMIT_CLOSE_CODE, 'inbound-queue-over-limit'));
      }
      this.inboundBytesByConn.set(conn, cur + payload.byteLength);
    }
    // SS2 大帧并发信号量预算预检（全局内存预算+per-project 1——瞬态拒 1008；pending+inFlight 双计）。
    //  自愈：pending 集残留键（队列与在飞均无该项目 SS2）先行摘除——settle 清理竞态残留不拒真帧。
    if (this.ss2PendingProjects.has(projectId)) {
      const stillQueued = (this.states.get(projectId)?.queue ?? []).some((i) => i.kind === 'ss2');
      if (!stillQueued && !this.ss2Projects.has(projectId)) this.ss2PendingProjects.delete(projectId);
    }
    if (kind === 'ss2' && (this.ss2BytesInFlight + this.ss2PendingBytes + payload.byteLength > SS2_SEMAPHORE_GLOBAL_BUDGET_BYTES || this.ss2PendingProjects.has(projectId))) {
      ss2SemaphoreTotal.inc({ outcome: 'deny' });
      this.host.hardClose(conn, CollabCloseCode.RATE_LIMITED_CLOSE, 'ss2-budget-exceeded');
      return Promise.reject(new FrameRejectError(CollabCloseCode.RATE_LIMITED_CLOSE, 'ss2-budget-exceeded'));
    }
    if (kind === 'ss2') { this.ss2PendingBytes += payload.byteLength; this.ss2PendingProjects.add(projectId); }
    const promise = new Promise<ActorFrameResult>((resolve, reject) => {
      st.queue.push({
        payload, hashHex, conn, kind, bytes: payload.byteLength, enqueuedAt: Date.now(),
        submitGeneration: this.host.generationOf(projectId),
        resolve: (r) => { this.settleConnBytes(conn, payload.byteLength, projectId, kind); resolve(r); },
        reject: (e) => { this.settleConnBytes(conn, payload.byteLength, projectId, kind); reject(e); },
      });
    });
    this.dedupMap.set(key, { state: 'inflight', promise, at: Date.now() });
    this.evictDedupMap();
    void this.drain(projectId);
    return promise;
  }

  /** 维护写独立 append 通道（偏离 38①——非 connection 帧的 WAL+PG 落定：payload 已在 doc（update
   *  监听捕获的已生效字节），只做 WAL 帧+PG 行+confirm，不 apply 不准入）。resolve 语义（Q-M5 钉死
   *  实际行为）：**延后至 PG 批落定**——强于 connection 帧的「fsync+apply 即 resolve」档（维护帧
   *  无 ACK 面，等 PG 是零代价更强承诺）；PG 失败帧 WAL 安全未 confirm→reject（pgPending 族旗标）
   *  交维护方退避梯回灌〔spool 去重幂等〕。维护帧豁免 per-project 背压/入站上限/SS2 预算=服务端帧
   *  设计内豁免（payload 已生效字节非连接面放大源；WAL 容量界仍由 spool 自守）。 */
  submitMaintenance(projectId: string, payload: Uint8Array): Promise<ActorFrameResult> {
    const st = this.stateOf(projectId);
    return new Promise<ActorFrameResult>((resolve, reject) => {
      st.queue.push({
        payload, hashHex: createHash('sha256').update(payload).digest('hex'), conn: null, kind: 'maintenance',
        bytes: payload.byteLength, enqueuedAt: Date.now(), submitGeneration: undefined,
        resolve: (r) => resolve(r), reject: (e) => reject(e),
      });
      void this.drain(projectId);
    });
  }

  private settleConnBytes(conn: CollabConnection | null, bytes: number, pid?: string, kind?: string): void {
    if (conn) {
      const cur = this.inboundBytesByConn.get(conn) ?? 0;
      this.inboundBytesByConn.set(conn, Math.max(0, cur - bytes));
    }
    if (kind === 'ss2' && pid) {
      this.ss2PendingBytes = Math.max(0, this.ss2PendingBytes - bytes);
      // per-project pending 释放：该 pid 队列与在飞均无 ss2 时摘键（保守判定——apply 段占用由 ss2Projects 管）
      const stillQueued = (this.states.get(pid)?.queue ?? []).some((i) => i.kind === 'ss2');
      if (!stillQueued && !this.ss2Projects.has(pid)) this.ss2PendingProjects.delete(pid);
    }
  }

  private evictDedupMap(): void {
    let oldest: string | undefined;
    while (this.dedupMap.size > WAL_DEDUP_INDEX_MAX_ENTRIES) {
      oldest = this.dedupMap.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.dedupMap.delete(oldest);
    }
    if (this.dedupMap.size < WAL_DEDUP_INDEX_MAX_ENTRIES / 2) return;
    const now = Date.now();
    for (const [k, v] of [...this.dedupMap.entries()]) if (now - v.at > WAL_DEDUP_INDEX_TTL_MS) this.dedupMap.delete(k);
  }

  /** settle 转移：applied 帧入 settled 态（后续同字节=no-op）；失败帧清除（重复帧同错已由 promise
   *  链传播完成——清除后重发按新帧处理）。
   *  双层去重关系（S-I1 钉死）：本 map=进程内 submit 层（in-flight/applied 态）；spool dedupIndex=
   *  WAL 磁床位。毒帧截断时两层必须**同步作废**——actor 侧本方法/clearDedup 于 reject 面，spool 侧
   *  truncateWalAfter 逐被截帧清条目；任一层残留=客户端重发同字节命中陈旧条目→返回已截 walSeq 零
   *  WAL 写入→ACK 声称的 walSeq 在 WAL 不存在（ACK 铁律破口）。截断保留前缀的帧两层条目均有效
   *  （WAL 帧在——dedup 命中=no-op 语义正确）。 */
  private settleDedup(pid: string, hashHex: string, walSeq: bigint): void {
    const key = `${pid}\u0000${hashHex}`;
    this.dedupMap.set(key, { state: 'applied', walSeq, at: Date.now() });
  }
  private clearDedup(pid: string, hashHex: string): void {
    this.dedupMap.delete(`${pid}\u0000${hashHex}`);
  }

  // ═══════════════════ drain 循环 ═══════════════════

  private async drain(pid: string): Promise<void> {
    const st = this.stateOf(pid);
    if (st.draining) return;
    st.draining = true;
    try {
      for (;;) {
        // 微任务合批（F-S4-3 空闲即收的零定时器实现：同 tick submit 全部落队再收批——单批单 fsync；
        // 禁 setTimeout 空闲窗〔含 1ms〕：fake-timer 宿主下永不触发=drain 悬挂，且跨 tick 帧本就
        // 允许成第二批〔批窗由最老帧龄/字节界约束〕）
        await Promise.resolve();
        const batch = this.collectBatch(st);
        if (batch.length === 0) break;
        await this.processBatch(pid, st, batch);
      }
    } finally {
      st.draining = false;
    }
  }

  /** 批窗三条件（F-S4-3——上界非 dwell）：≤20ms 自最老帧 ∨ ≤1MiB ∨ 队列空闲即收（空闲 1ms 语义=
   *  无新帧立即收批——drain 由 submit 同 tick 触发，同 tick 多帧自然合批）。 */
  private collectBatch(st: ProjectActorState): QueueItem[] {
    if (st.queue.length === 0) return [];
    const firstAt = st.queue[0].enqueuedAt;
    const batch: QueueItem[] = [];
    let bytes = 0;
    while (st.queue.length > 0) {
      const it = st.queue[0];
      if (batch.length > 0 && (Date.now() - firstAt >= ACTOR_DRAIN_BATCH_MAX_MS || bytes + it.bytes > ACTOR_DRAIN_BATCH_MAX_BYTES)) break;
      batch.push(st.queue.shift()!);
      bytes += it.bytes;
    }
    return batch;
  }

  private async processBatch(pid: string, st: ProjectActorState, batch: QueueItem[]): Promise<void> {
    const document = this.host.documents().get(projectDocName(pid));
    const authGen = this.host.generationOf(pid);
    const admitted: QueueItem[] = [];
    // 批内覆盖演进基准（document SV 快照——准入循环单点演进）
    const svMap = new Map<number, number>();
    if (document) for (const [c, k] of Y.decodeStateVector(Y.encodeStateVector(document))) svMap.set(c, k);
    // —— 准入链（actor 串行段内逐帧：⓪→①→②）——
    for (const item of batch) {
      if (item.kind === 'maintenance') { admitted.push(item); continue; }   // 维护帧：已生效字节——只走 WAL+PG
      try {
        // ⓪ readOnly/writeFreeze/quota 短路最先（防 VIEWER 帧先入 doc——F-5）
        if (item.conn) {
          if (item.conn.readOnly) {
            const escalate = this.host.noteReadOnlyDrop(item.conn, pid, item.bytes);
            if (escalate) {
              collabQuotaFrameRejectedTotal.inc({ reason: 'doc-over-quota' });   // Q-D v5/v6 升级档计数（guardSyncFrame ① 承继位）
              // Q-M4：doc-status stateless 先行通告=DR.noteReadOnlyDrop 升级点单发（4404 关闭前自救面
              // ——旧链 guardSyncFrame ① 同位语义补回；通告尽力不阻关闭）
              this.host.hardClose(item.conn, CollabCloseCode.DOC_OVER_QUOTA, DOC_OVER_QUOTA_TERMINAL_REASON);
              this.rejectItem(item, new FrameRejectError(CollabCloseCode.DOC_OVER_QUOTA, DOC_OVER_QUOTA_TERMINAL_REASON));
              this.clearDedup(pid, item.hashHex);
              continue;
            }
            actorFrameOutcomeTotal.inc({ outcome: 'noop-readonly' });
            this.resolveItem(item, { walSeq: 0n, noop: true });
            this.clearDedup(pid, item.hashHex);
            continue;
          }
          // draining/spool 冻结面=conn.readOnly 单源标志（applyWriteFreeze 唯一出口置位——freezeReasons
          // 的未登记回退档含 'viewer' 默认，禁在 readOnly 外消费〔旧 guardSyncFrame ① 同界〕）
        }
        if (this.host.isQuotaFrozen(pid)) {
          actorFrameOutcomeTotal.inc({ outcome: 'noop-frozen' });
          this.resolveItem(item, { walSeq: 0n, noop: true });
          this.clearDedup(pid, item.hashHex);
          continue;
        }
        // ① 每帧对照世代权威验证 generation（submit 时捕获 vs drain 时权威——换代=4410 终态）
        if (item.submitGeneration != null && authGen != null && item.submitGeneration !== authGen) {
          this.host.hardClose(item.conn, CollabCloseCode.GENERATION_SUPERSEDED, DOC_GENERATION_STALE_TERMINAL_REASON);
          this.rejectItem(item, new FrameRejectError(CollabCloseCode.GENERATION_SUPERSEDED, DOC_GENERATION_STALE_TERMINAL_REASON));
          this.clearDedup(pid, item.hashHex);
          continue;
        }
        // ① P1 shape fixture（root/预算/通用格式——解码失败=4411 毒帧面）
        const shape = validateP1Shape(item.payload);
        if (!shape.ok) {
          this.host.hardClose(item.conn, shape.code, shape.reason);
          this.rejectItem(item, new FrameRejectError(shape.code, shape.reason));
          this.clearDedup(pid, item.hashHex);
          continue;
        }
        // ② pending 区间预检（修正 #2 三分——缺前驱/区间有洞/DS-only 未知 clock→4412 零 WAL 零 apply 零 ACK）。
        //    批内覆盖演进：同批先导帧已准入 ⇒ 其区间计入覆盖面（后继帧相对「doc+批内前驱」判自包含——
        //    否则同 client 连发帧第 2 帧起必误判 4412）。
        if (document) {
          const analysis = analyzePendingIntervals(item.payload, encodeSvMap(svMap));
          if (analysis.kind === 'missing-predecessor') {
            this.host.hardClose(item.conn, CollabCloseCode.RESYNC_REQUIRED, 'resync-required');
            this.rejectItem(item, new FrameRejectError(CollabCloseCode.RESYNC_REQUIRED, 'resync-required'));
            this.clearDedup(pid, item.hashHex);
            continue;
          }
          for (const st of Y.decodeUpdate(item.payload).structs) {
            const end = st.id.clock + st.length;
            const prev = svMap.get(st.id.client) ?? 0;
            if (end > prev) svMap.set(st.id.client, end);
          }
        }
        admitted.push(item);
      } catch (err) {
        this.host.hardClose(item.conn, CollabCloseCode.FRAME_MALFORMED, 'frame-malformed');
        this.rejectItem(item, new FrameRejectError(CollabCloseCode.FRAME_MALFORMED, 'frame-malformed'));
        this.clearDedup(pid, item.hashHex);
        void err;
      }
    }
    if (admitted.length === 0) { actorDrainBatchTotal.inc({ result: 'empty' }); return; }
    if (!document) {
      // doc 不在库 documents Map：connection 帧无处 apply——拒绝（4411 档，连接必已关）；维护帧
      // 不 apply（payload 已生效字节）——照常 WAL+PG（detached 回灌形态：persistence 白盒直调/tests）。
      for (const item of admitted) {
        if (item.kind === 'maintenance') continue;
        this.rejectItem(item, new FrameRejectError(CollabCloseCode.FRAME_MALFORMED, 'doc-unloaded'));
        this.clearDedup(pid, item.hashHex);
      }
      const maintOnly = admitted.filter((i) => i.kind === 'maintenance');
      if (maintOnly.length === 0) { actorDrainBatchTotal.inc({ result: 'doc-missing' }); return; }
      let maintAppended: Awaited<ReturnType<CollabSpoolService['appendBatch']>>;
      try {
        maintAppended = await this.spool.appendBatch(pid, maintOnly.map((i) => i.payload));
      } catch (err) {
        // C1（quality Critical）：detached 维护批 WAL 失败守卫（对照正常路径 appendBatch catch 同款）
        // ——WAL 容量/EIO 异常穿透 drain=void this.drain() 未处理拒绝+维护 promise 永不 settle=
        // saveMutex/handoff 永挂。全批拒绝 SLOW_CONSUMER 'wal-append-failed'（**不带 pgPending**
        // ——WAL 未落定语义，与 FK/pg-pending 档〔帧 WAL 安全〕区分）。
        for (const item of maintOnly) {
          this.rejectItem(item, new FrameRejectError(CollabCloseCode.SLOW_CONSUMER, 'wal-append-failed'));
          this.clearDedup(pid, item.hashHex);
        }
        actorDrainBatchTotal.inc({ result: 'wal-failed' });
        captureCollabException(err, { docName: projectDocName(pid), reason: 'actor-wal-append-failed', connectionId: '-' });
        this.host.logger.error(`actor WAL append failed for ${pid}（detached 维护批：${(err as Error).message}）——帧拒绝，fail-stop/容量档由 spool 内部处置`);
        return;
      }
      // 维护帧 appliedSeq 推进（detached 形态同正常路径：payload 已生效——confirm 推 pgSeq 的不变量前提）
      for (let k = 0; k < maintOnly.length; k++) this.spool.noteApplied(pid, maintAppended[k].walSeq);
      let detachedFlush: PgFlushOutcome;
      try {
        detachedFlush = await this.flushBatchToPg(pid, maintOnly, maintAppended, maintOnly.map(() => []));
      } catch (flushErr) {
        // FK 重抛面（同正常路径）：维护帧按 FK 拒绝透传——drain 批不悬挂
        for (let k = 0; k < maintOnly.length; k++) {
          this.rejectItem(maintOnly[k], Object.assign(new FrameRejectError(CollabCloseCode.SLOW_CONSUMER, 'maintenance-pg-fk'), { pgPending: true, fk: true, cause: flushErr }));
          this.clearDedup(pid, maintOnly[k].hashHex);
        }
        actorDrainBatchTotal.inc({ result: 'pg-fk' });
        return;
      }
      for (let k = 0; k < maintOnly.length; k++) {
        if (detachedFlush.landed) this.resolveItem(maintOnly[k], { walSeq: maintAppended[k].walSeq });
        else {
          // Q-I2：失败旗标随 flush 返回元组走（跨 await 共享字段在并发 drain 下错挂——元组=批内单源）
          this.rejectItem(maintOnly[k], Object.assign(new FrameRejectError(CollabCloseCode.SLOW_CONSUMER, 'maintenance-pg-pending'), this.pgPendingFlags(detachedFlush.errorKind)));
          this.clearDedup(pid, maintOnly[k].hashHex);
        }
      }
      actorDrainBatchTotal.inc({ result: 'maintenance-detached' });
      return;
    }
    // —— ④ WAL 批量追加+fsync（单 fsync；per-frame SHA-256 去重已在 submit 层）——
    let appended: Awaited<ReturnType<CollabSpoolService['appendBatch']>>;
    try {
      appended = await this.spool.appendBatch(pid, admitted.map((i) => i.payload));
    } catch (err) {
      // WAL 失败（容量/EIO/截断失败档——spool 内部已分类+fail-stop 链触发）：批全拒绝同错（原帧失败重复帧同错）
      for (const item of admitted) {
        this.rejectItem(item, Object.assign(new FrameRejectError(CollabCloseCode.SLOW_CONSUMER, 'wal-append-failed')));
        this.clearDedup(pid, item.hashHex);
      }
      actorDrainBatchTotal.inc({ result: 'wal-failed' });
      captureCollabException(err, { docName: projectDocName(pid), reason: 'actor-wal-append-failed', connectionId: '-' });
      this.host.logger.error(`actor WAL append failed for ${pid}（批 ${(err as Error).message}）——帧拒绝，fail-stop/容量档由 spool 内部处置`);
      return;
    }
    // —— 维护帧处置面（payload 已生效不 apply；**resolve 延后至 PG 批落定**——PG 失败帧 WAL 安全但
    //    未 confirm，reject 交维护方退避梯重发〔spool 去重幂等——flushDocument retry/spooled 档语义〕；
    //    connection 帧不受影响：fsync+apply 即 resolve〔Applied 档——ACK 等级〕）——
    const maintIdx: number[] = [];
    for (let k = 0; k < admitted.length; k++) if (admitted[k].kind === 'maintenance') maintIdx.push(k);
    // 维护帧 appliedSeq 推进：payload=已生效字节（update 监听捕获源）——WAL fsync 即视同 applied
    //（confirm 推 pgSeq 时不变量 pgSeq≤appliedSeq 由本位保持；connection 帧的 noteApplied 在 apply 后）
    for (const k of maintIdx) this.spool.noteApplied(pid, appended[k].walSeq);
    // —— ⑤ 逐帧 apply（gate origin——Hocuspocus 随后幂等重放零事件）+逐帧 resolve ——
    const effectsByFrame: FrameEffect[][] = [];
    let collector = this.collectorsByDoc.get(document);
    if (!collector) { collector = new FrameEffectsCollector(); this.collectorsByDoc.set(document, collector); }
    collector.install(document);
    // SS2 大帧信号量占位（全局字节+per-project——apply 段独占；串行 drain 天然 per-project ≤1）
    const ss2Bytes = admitted.reduce((s, i) => s + (i.kind === 'ss2' ? i.bytes : 0), 0);
    if (ss2Bytes > 0) { this.ss2BytesInFlight += ss2Bytes; this.ss2Projects.add(pid); ss2SemaphoreTotal.inc({ outcome: 'acquire' }); }
    try {
      for (let k = 0; k < admitted.length; k++) {
        const item = admitted[k];
        if (item.kind === 'maintenance') { effectsByFrame.push([]); continue; }   // 已生效字节——不 apply（上方已 resolve）
        const walSeq = appended[k].walSeq;
        collector.begin(walSeq);
        try {
          // ③④⑤ apply：origin={source:'connection',connection,gate:true}——isGateApplyOrigin 判过
          this.applyGate(document, item.payload, { source: 'connection', connection: item.conn, gate: true } satisfies GateApplyOrigin);
        } catch (err) {
          // ═══ 毒帧协议（POISON_FRAME_PROTOCOL——次序冻结）═══
          actorPoisonFrameTotal.inc();
          actorDrainBatchTotal.inc({ result: 'poison' });
          const appliedSeq = st.appliedSeq;
          try {
            this.host.hardClose(item.conn, CollabCloseCode.FRAME_MALFORMED, 'frame-malformed');   // culprit 连接先行（码权威投递）
            // isolate-doc/stop-visible-writes：同步关项目全部连接（广播 flush 前——坏帧不漏给其他在线端）
            // （Hocuspocus Document 结构面：connections=Map<Connection, unknown>——PersistenceDocument 同款窄化）
            const conns = (document as unknown as { connections?: Map<object, unknown> }).connections;
            for (const c of [...(conns?.keys() ?? [])]) {
              this.host.hardClose(c as unknown as CollabConnection, CollabCloseCode.FRAME_MALFORMED, 'frame-malformed');
            }
            // truncate-wal-to-appliedSeq（不得跳过毒帧继续提交后续序号）
            await this.spool.truncateWalAfter(pid, appliedSeq);
          } catch (tErr) {
            this.host.logger.error(`poison protocol truncate/close failed for ${pid}: ${(tErr as Error).message}——walHealthy 已由 spool 侧 fail-closed`);
          }
          this.host.logger.error(`毒帧 4411 for ${pid} walSeq=${walSeq}: ${(err as Error).message}——WAL 截断至 appliedSeq=${appliedSeq}+全连接 close+doc 重装载=从 pgSeq 重放`);
          // 毒帧与其后批内帧全部拒绝（4411）；批内先前帧已 apply+resolve（截断保其下帧）
          for (let m = k; m < admitted.length; m++) {
            this.rejectItem(admitted[m], new FrameRejectError(CollabCloseCode.FRAME_MALFORMED, 'frame-malformed'));
            this.clearDedup(pid, admitted[m].hashHex);
          }
          captureCollabException(err, { docName: projectDocName(pid), reason: 'actor-poison-frame', connectionId: '-' });
          return;
        }
        // appliedSeq=walSeq（apply 成功）+FrameEffects 取走（apply 后 actor 临界区内为准——修正 #1）
        st.appliedSeq = walSeq;
        this.spool.noteApplied(pid, walSeq);
        this.settleDedup(pid, item.hashHex, walSeq);
        const effects = collector.take();
        effectsByFrame.push(effects);
        for (const e of effects) frameEffectsTotal.inc({ kind: e.kind });
        st.docIndex.apply(effects);
        actorFrameOutcomeTotal.inc({ outcome: 'applied' });
        this.resolveItem(item, { walSeq });   // 逐帧 resolve（beforeSync await——ACK 时帧必已 fsync+apply）
      }
    } finally {
      if (ss2Bytes > 0) { this.ss2BytesInFlight -= ss2Bytes; this.ss2Projects.delete(pid); }
    }
    actorDrainBatchFrames.observe(admitted.length);
    actorDrainBatchTotal.inc({ result: 'appended' });
    // —— PG drain 批同事务多行 append（Controller 裁定 1——connection 批=单行〔firstWalSeq..lastWalSeq/
    //    frameCount/updateHash=frameHash 列表 SHA〕；维护帧=逐帧行）→confirm spool 帧 ——
    let pgFlush: PgFlushOutcome;
    try {
      pgFlush = await this.flushBatchToPg(pid, admitted, appended, effectsByFrame);
    } catch (flushErr) {
      // FK 重抛面（项目已删写路径发现点）：维护帧按 FK 拒绝透传（维护方收割/终态）；connection 帧已
      // resolve（Applied 档——PG 归属由恢复链）；drain 批不悬挂（未 settle 项=僵尸 promise 禁径）。
      for (const k of maintIdx) {
        this.rejectItem(admitted[k], Object.assign(new FrameRejectError(CollabCloseCode.SLOW_CONSUMER, 'maintenance-pg-fk'), { pgPending: true, fk: true, cause: flushErr }));
        this.clearDedup(pid, admitted[k].hashHex);
      }
      actorDrainBatchTotal.inc({ result: 'pg-fk' });
      return;
    }
    for (const k of maintIdx) {
      if (pgFlush.landed) {
        actorFrameOutcomeTotal.inc({ outcome: 'applied' });
        this.resolveItem(admitted[k], { walSeq: appended[k].walSeq });
      } else {
        // PG 未落定：帧 WAL 安全未 confirm——reject 交维护方（pgPending 标志=批可出队〔WAL 已落定〕，
        // 退避梯只加速 PG 回灌——旧 spool 兜底「新家先落定才 splice」语义承继；终态族旗标透传）。
        // Q-I2：旗标随 flush 返回元组推导（共享字段 lastPgError 在两项目 drain 并发下错挂——
        // 一批 fenced 残留+他批 breaker-open 短路读档=维护帧 fenced/leaseRowMissing 走错分支）。
        this.rejectItem(admitted[k], Object.assign(new FrameRejectError(CollabCloseCode.SLOW_CONSUMER, 'maintenance-pg-pending'), this.pgPendingFlags(pgFlush.errorKind)));
        this.clearDedup(pid, admitted[k].hashHex);
      }
    }
  }

  /** per-project 自上次取走后有无 actor 落定行（disconnect flush-then-compact 判据——
   *  connection 帧不经 maintenance 队列，旧 wrote 契约的继任信号；取走即清）。 */
  private readonly landedSince = new Set<string>();
  /** 读并清落定标记（gateway onDisconnect 消费——flush-then-compact 触发承接）。 */
  takeActorLanded(pid: string): boolean {
    const landed = this.landedSince.has(pid);
    this.landedSince.delete(pid);
    return landed;
  }

  /** PG 批落定结果（Q-I2：fenced/lease 族失败档随返回值走——**禁跨 await 共享字段**，两项目 drain
   *  并发时共享旗标会错挂：本批 connection-only 失败残留的旗标被他批 breaker-open 短路读档）。
   *  errorKind：'fenced'=写权 fencing；Error=PG 腿异常（leaseRowMissing/leaseNotHeld 旗标挂 Error
   *  上——repo appendBatch 契约）；null=breaker-open 短路（无新失败样本）。 */
  private pgPendingFlags(errorKind: PgFlushErrorKind): Record<string, unknown> {
    const flags: Record<string, unknown> = { pgPending: true };
    if (errorKind === 'fenced') flags.fenced = true;
    else if (errorKind) {
      if ((errorKind as Error & { leaseRowMissing?: boolean }).leaseRowMissing) flags.leaseRowMissing = true;
      if ((errorKind as Error & { leaseNotHeld?: boolean }).leaseNotHeld) flags.leaseNotHeld = true;
    }
    return flags;
  }

  /** PG 批落定+confirm（失败=帧留 spool 未 confirm——磁盘安全，由 reconciler/退避梯回灌，
   *  appendBatch 幂等〔updateHash/seq 复用〕；返回 landed=true=PG 落定〔维护帧 resolve 判据〕+
   *  errorKind=失败档（Q-I2 元组——单批单源）。breaker 样本：repo throw=recordFailure〔连接族推闸〕；
   *  ok=recordSuccess。 */
  private async flushBatchToPg(pid: string, admitted: QueueItem[], appended: Awaited<ReturnType<CollabSpoolService['appendBatch']>>, effectsByFrame: FrameEffect[][]): Promise<PgFlushOutcome> {
    // 熔断面②（T16 承继）：open 期 PG 腿首行短路（零 PG 等待——省 5s 事务上界）——帧已 WAL 安全
    // 未 confirm，false 交维护方退避梯（half-open 放行=本次即探测）
    if (this.pgBreaker?.isOpen()) return { landed: false, errorKind: null };
    try {
      const generation = this.spool.currentGeneration(pid);
      const connFrames = admitted.map((i, k) => ({ item: i, frame: appended[k] })).filter((x) => x.item.kind !== 'maintenance');
      const maintFrames = admitted.map((i, k) => ({ item: i, frame: appended[k] })).filter((x) => x.item.kind === 'maintenance');
      const rows: Array<{ generation: number; firstWalSeq: bigint; lastWalSeq: bigint; frameCount: number; updateHash: string; update: Uint8Array }> = [];
      if (connFrames.length > 0) {
        const merged = connFrames.length === 1 ? connFrames[0].item.payload : Y.mergeUpdates(connFrames.map((x) => x.item.payload));
        rows.push({
          generation,
          firstWalSeq: connFrames[0].frame.walSeq,
          lastWalSeq: connFrames[connFrames.length - 1].frame.walSeq,
          frameCount: connFrames.length,
          updateHash: CanvasDocUpdateRepository.batchUpdateHash(connFrames.map((x) => createHash('sha256').update(x.item.payload).digest())),
          update: merged,
        });
      }
      for (const mf of maintFrames) {
        rows.push(CanvasDocUpdateRepository.singleFrameRow({
          generation, walSeq: mf.frame.walSeq,
          frameHash: createHash('sha256').update(mf.item.payload).digest(),
          update: mf.item.payload,
        }));
      }
      void effectsByFrame;
      for (const row of rows) yjsStorePayloadBytes.observe(row.update.byteLength);   // Y0b-5 T10 锚位承接：append 成功路径逐片 observe（actor PG 腿）
      const r = await this.repo.appendBatch(pid, rows);
      if (!r.ok) {
        this.host.logger.error(`actor PG append fenced for ${pid}——帧留 spool（磁盘安全），回灌由恢复链承接`);
        try {
          await this.host.onFencedByWrite();   // 必办①承接：fenced→selfIsolate（closeAll1012+listener 释放+lost{cause} 单点）
        } catch (isoErr) {
          // Q-M7：隔离链异常不掩 fenced 事实——repo 结果即判据，selfIsolate 失败仅留痕（旗标照返
          // 'fenced'；不包 try=异常落下方 catch 被 recordFailure 误归因普通 PG 错误档）
          this.host.logger.error(`onFencedByWrite self-isolate failed for ${pid}: ${(isoErr as Error).message}——fenced 旗标保持`);
        }
        return { landed: false, errorKind: 'fenced' };
      }
      await this.spool.confirm(pid, appended.map((a) => a.frameId));
      this.pgBreaker?.recordSuccess();
      this.landedSince.add(pid);   // disconnect flush-then-compact 判据（connection 帧不经维护队列——wrote 契约继任）
      return { landed: true, errorKind: null };
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2003' || /Foreign key constraint/i.test((err as Error).message)) {
        throw err;   // FK=项目已删写路径发现点——重抛交维护方终态处置（discard+confirm+收割——V6/T14 同判）
      }
      yjsStoreTotal.inc({ trigger: 'maintenance' });   // 归因：actor PG 腿失败面（帧留 spool 未 confirm）
      this.pgBreaker?.recordFailure(err);              // PG 健康样本（连接族推闸——T16 熔断面②承继）
      // T11 store 失败样本承接（PG 腿唯一写点换代——tags 契约逐字保持）
      captureCollabException(err, { docName: projectDocName(pid), reason: 'store-append-failed', connectionId: '-' });
      this.host.logger.error(`actor PG append failed for ${pid}: ${(err as Error).message}——帧留 spool（磁盘安全），reconciler/退避梯回灌`);
      return { landed: false, errorKind: err as Error };
    }
  }

  /** apply 注入缝（生产=Y.applyUpdate 直调；测试 subclass 注入毒帧/时序——syncSegmentHandle 同族先例）。 */
  protected applyGate(document: Y.Doc, payload: Uint8Array, origin: GateApplyOrigin): void {
    Y.applyUpdate(document, payload, origin);
  }

  private resolveItem(item: QueueItem, r: ActorFrameResult): void { item.resolve(r); }
  private rejectItem(item: QueueItem, e: FrameRejectError): void {
    actorFrameOutcomeTotal.inc({ outcome: `reject-${e.code}` });
    item.reject(e);
  }
}
