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
  SAVE_BARRIER_FLUSH_THROTTLE_MS,
  EXEC_FREEZE_BUDGET_MS,
  EXEC_ADMISSION_TIMEOUT_MS,
  CollabCloseCode,
  DOC_OVER_QUOTA_TERMINAL_REASON,
  DOC_GENERATION_STALE_TERMINAL_REASON,
  QUOTA_DEFAULTS,
  type FlushThroughResult,
} from '@flowweb/shared';
import {
  MEDIA_REF_TARGET_FIELDS,
  isFrameNodeTypeName,
  validateActorRanges,
  validateXmlL1,
  type FrameEffect,
  type ProjectDocIndex,
  type GateApplyOrigin,
  type ActorRange,
  type CanvasActorKind,
} from '@flowweb/shared';
import { CollabSpoolService } from './collab-spool.service';
import { CollabPgBreakerService } from './collab-pg-breaker.service';
import { CollabLifecycleObserverService, type LifecycleFrame } from './collab-lifecycle-observer.service';
import { projectDocName, parseDocName, canvasDocName } from './doc-name.util';
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
  /** Y1c T10：维护/冻结窗口判定（barrier maintenance 拒绝语义——gateway 接线=DR.isVacuuming∨维护态；
   *  缺省 false=无维护窗口〔直构/测试〕；T27 维护状态机扩展同缝）。 */
  isMaintenanceBlocked?(pid: string): boolean;
}

/** P1 shape fixture 校验（准入链 ①——root/预算/通用格式；全类型最终矩阵运行时准入在 T24 激活）。 */
const P1_ALLOWED_ROOTS = new Set(['nodes', 'edges', 'exec', 'meta']);
/** P1 结构预算工程值（T24 矩阵激活时收紧——本卡防 DoS 级上界：structs ≤8×maxNodesPerTx、
 *  ds 区间 ≤4096；帧字节闸在 gate ⓪ 先行（Update 2×maxTxBytes/SS2 maxDocBytes+ALLOWANCE）。 */
const P1_MAX_STRUCTS = 8 * QUOTA_DEFAULTS.maxNodesPerTx;
const P1_MAX_DS_RANGES = 4096;
/** Y1c T16：L1 扫描 URL allowlist（真源住调用方——xml-schema XML_URL_ALLOWLIST_CONTRACT）：
 *  默认空表=deny-all http(s) 属性 URL（修正批#1：image.src=mediaId/link href 未启用——绝对
 *  URL 值 off-spec）；部署受控域经 COLLAB_XML_URL_HOSTS 逗号分隔注入（同源 MinIO/CDN 面）。 */
const XML_ATTR_URL_ALLOWED_HOSTS: readonly string[] = (process.env.COLLAB_XML_URL_HOSTS ?? '')
  .split(',').map((h) => h.trim()).filter((h) => h !== '');

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
  /** Y1c T10：帧认领者（actorRanges 事实源——submit 时捕获；维护帧='system'）。 */
  actor: { userId: string; actorKind: CanvasActorKind };
  resolve: (r: ActorFrameResult) => void;
  reject: (e: FrameRejectError) => void;
}

/** Y1c T10（applied-driven 批量 PG）：已 apply（维护帧=WAL fsync 即视同 applied）帧的待落库条目——
 *  批只从本队列取（连续前缀，上界=appliedSeq 构造性成立：仅 apply 成功帧入队）；行=512 条/8MiB 批+
 *  1MiB 行分片（复用旧链 COALESCE 数字）；维护帧 resolve 延后至本 flush 落定（Q-M5 更强承诺保持）。 */
interface AppliedEntry {
  walSeq: bigint;
  frameId: string;              // spool confirm 面
  frameHash: Uint8Array;        // sha256 原始 32B（updateHash=列表 SHA 单源）
  payload: Uint8Array;
  actor: { userId: string; actorKind: CanvasActorKind };
  kind: QueueItem['kind'];
  effects: FrameEffect[];       // T26 义务 buffer 承载（per-walSeq——帧↔义务同事务）
  /** 维护帧落定回调（resolve 延后至 PG 落定——null=connection 帧〔fsync+apply 即 resolved〕）。 */
  onLanded: (() => void) | null;
  onFailed: ((flags: Record<string, unknown>) => void) | null;
  hashHex: string;              // 失败面 clearDedup 用（connection 帧已 settle——仅维护帧消费）
}

interface ProjectActorState {
  queue: QueueItem[];
  draining: boolean;
  appliedSeq: bigint;
  readonly docIndex: ProjectDocIndexImpl;
  /** Y1c T10：applied 待落库队列+flusher 状态。Q-I2：appliedBytes=队列 payload 字节运行和
   *  （入队/出队单点维护——submit 背压 O(1) 判界，禁逐帧 reduce）。 */
  appliedQueue: AppliedEntry[];
  appliedBytes: number;
  flushing: boolean;
  /** Y1c T21：frozenDocSeq 受理临界区 gate（v5.4⑪——**per-project mutex 非布尔 flag**）：
   *  freeze 在持=drain 循环每批前让位（已过检查的 beforeSync 帧不得在读后 apply——提交中的帧
   *  排队待 release 后处理；fn 读到的 doc 恒=applied 前缀态）。同一时刻至多一个 freeze 在持
   *  （freezeWaiters 链串行化）。 */
  freeze: { active: boolean; released: Promise<void>; release: () => void } | null;
  /** T21：批处理在飞标志（freeze 等待面=apply 批非 PG flush——PG 挂起窗冻结读仍可进入
   *  并以 flush-timeout 拒绝，不被 drain 整体占位阻塞）。 */
  batchInFlight: boolean;
  lastFlushKickAt: number;
}

/** per-project 写入背压上限（偏离 36-③——工程值：512 帧/2×入站限〔33.8MB——容纳 SS2 大帧对〕；
 *  超限=瞬态拒 close 1008 单项目不拖垮其他项目）。 */
const PROJECT_QUEUE_MAX_FRAMES = 512;
const PROJECT_QUEUE_MAX_BYTES = 2 * INBOUND_QUEUE_LIMIT_BYTES;

/** applied 批上界（复用旧链 COALESCE 数字——512 条/8MiB 批+1MiB 行分片）。 */
const PG_BATCH_MAX_FRAMES = 512;
const PG_BATCH_MAX_BYTES = 8 * 1024 * 1024;
const PG_ROW_MERGE_MAX_BYTES = 1_048_576;
/** Q-I2（T10 收口）：applied 待落库队列上界（帧数/字节）——与 submit 背压同语义耦合：满=瞬态拒
 *  close 1008（applied-flush-backpressure）。根修选型（按代码实况）：PG 长期不可用时帧流过 drain
 *  在 appliedQueue 堆积且条目持完整 payload，卸载 fail-closed 使 doc 常驻=复合放大——方案取「上界+
 *  背压耦合」而非「去 payload 按 frameId 从 spool 重读」：peek 按 frameId 重读需逐 flush 全量解析未
 *  confirm 段（O(WAL depth) IO——健康路径每 drain 批一次的常态放大），且行合并/字节记账本就消费
 *  payload；上界方案与既有 512 帧背压同语义（瞬态拒+重连自愈），内存界确定（2×PG 批=一批在飞+
 *  一批准入余量，健康路径永不触界）。维护帧豁免（服务端帧低速率——与既有背压豁免同界）。 */
export const APPLIED_QUEUE_MAX_FRAMES = 2 * PG_BATCH_MAX_FRAMES;
export const APPLIED_QUEUE_MAX_BYTES = 2 * PG_BATCH_MAX_BYTES;
/** flushThrough 有界等待（barrier 回执上界——T33 save barrier p95<2s 预算带内）。 */
const FLUSH_THROUGH_MAX_WAIT_MS = 2_000;
/** barrier nonce 幂等回执台账上界（FIFO 驱逐+5min TTL——重试窗覆盖）。 */
const BARRIER_NONCE_CACHE_MAX = 256;
const BARRIER_NONCE_TTL_MS = 5 * 60_000;

@Injectable()
export class CollabProjectActorService {
  private host!: CollabProjectActorHost;
  private readonly collectorsByDoc = new WeakMap<Y.Doc, FrameEffectsCollector>();   // per-doc（多项目 drain 并发不混 buffer）
  /** Y1c T26：genesis 播种标记（每 doc 实例一次——观察器按需注册在册 presence；WeakSet 随 doc 消亡） */
  private readonly lifecycleSeededDocs = new WeakSet<Y.Doc>();
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
    // Y1c T26：生命周期义务观察器（帧↔义务同事务挂点+genesis 播种——缺省 undefined=单元直构零接线）
    @Optional() @Inject(CollabLifecycleObserverService) private readonly lifecycleObserver?: CollabLifecycleObserverService,
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
    // T10 注记：applied 队列不设清理守卫——生产到达面=beforeUnloadDocument 已 drain（或关停豁免：
    // 帧 WAL 落定+启动回灌承接）；appliedQueue 随 states 键一并弃置（test 直调 afterUnload 的
    // PG-fail 形态同弃——恢复链以 WAL 为准）。barrier nonce 台账=全局有界（FIFO+TTL）不随单项目清。
    this.states.delete(projectId);
  }

  private stateOf(pid: string): ProjectActorState {
    let st = this.states.get(pid);
    if (!st) {
      st = { queue: [], draining: false, appliedSeq: 0n, docIndex: new ProjectDocIndexImpl(), appliedQueue: [], appliedBytes: 0, flushing: false, lastFlushKickAt: 0, freeze: null, batchInFlight: false };
      this.states.set(pid, st);
    }
    return st;
  }

  /** Y1c T10：连接帧认领者捕获（actorRanges 事实源——userId 仅内部 ID；缺认证面=空串占位）。 */
  private actorOfConn(conn: CollabConnection | null): { userId: string; actorKind: CanvasActorKind } {
    if (!conn) return { userId: 'system', actorKind: 'system' };
    const ctx = conn.context as { user?: { id?: unknown } } | undefined;
    const uid = typeof ctx?.user?.id === 'string' ? ctx.user.id : '';
    return { userId: uid, actorKind: 'user' };
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
    // Q-I2（T10 收口）：applied 待落库面上界（PG 长期不可用=帧流过 drain 堆积且卸载 fail-closed 使
    // doc 常驻——与既有背压同语义：满即瞬态拒 close 1008；PG 恢复→flush 落定→自愈重连）
    if (st.appliedQueue.length >= APPLIED_QUEUE_MAX_FRAMES || st.appliedBytes + payload.byteLength > APPLIED_QUEUE_MAX_BYTES) {
      projectBackpressureTotal.inc();
      this.host.hardClose(conn, CollabCloseCode.RATE_LIMITED_CLOSE, 'applied-flush-backpressure');
      return Promise.reject(new FrameRejectError(CollabCloseCode.RATE_LIMITED_CLOSE, 'applied-flush-backpressure'));
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
        actor: this.actorOfConn(conn),
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
        actor: { userId: 'system', actorKind: 'system' },
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
        // Y1c T21 frozenDocSeq 临界区 gate：freeze 在持=drain 让位（新帧排队待 release——
        // 冻结读后不得有新 apply，v5.4⑪「已过 flag 检查的 beforeSync 不得在读后 apply」）。
        while (st.freeze?.active) await st.freeze.released;
        const batch = this.collectBatch(st);
        if (batch.length === 0) break;
        st.batchInFlight = true;
        try {
          await this.processBatch(pid, st, batch);
        } finally {
          st.batchInFlight = false;
        }
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
    // Y1c T12：canonical wire 名（#g 换代通道——E23 内部寻址连带；generationOf 装载播种真值源）
    const document = this.host.documents().get(canvasDocName(pid, this.host.generationOf(pid) ?? 0));
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
        // ①' Y1c T16：XML 白名单 L1 frame-local struct 扫描（偏离 38⑫ 同卡激活——不留 P2 安全
        //    窗口）：元素名/format key/attr 白名单+ContentString 上限+URL allowlist+新子树深度；
        //    拒 XmlHook/嵌套 XmlFragment/未知 XmlElement。违规=4411 DENY（零 WAL 零 apply 零 ACK）。
        //    URL 执法档=XML_ATTR_URL_ALLOWED_HOSTS（空表 deny-all——修正批#1 后 src=mediaId，
        //    绝对 http(s) URL 属性值 off-spec）；L2 apply 后 changed-subtree walk 归 T24。
        const xmlL1 = validateXmlL1(item.payload, { allowedUrlHosts: XML_ATTR_URL_ALLOWED_HOSTS });
        if (!xmlL1.ok) {
          actorFrameOutcomeTotal.inc({ outcome: 'rejected' });
          this.host.hardClose(item.conn, CollabCloseCode.FRAME_MALFORMED, `xml-l1:${xmlL1.reason}`);
          this.rejectItem(item, new FrameRejectError(CollabCloseCode.FRAME_MALFORMED, `xml-l1:${xmlL1.reason}`));
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
      // Y1c T10（applied-driven）：detached 维护帧入 applied 队列——resolve 延后至 PG 批落定（Q-M5）。
      for (let k = 0; k < maintOnly.length; k++) this.pushApplied(pid, maintOnly[k], maintAppended[k].frameId, maintAppended[k].walSeq, []);
      void this.flushApplied(pid).catch(() => {});
      actorDrainBatchTotal.inc({ result: 'maintenance-detached' });
      return;
    }
    // —— ④ WAL 批量追加+fsync（单 fsync；per-frame SHA-256 去重已在 submit 层）——
    // Y1c T26：genesis 播种（每 doc 实例一次——先于本批任何帧 effect 派生：删除义务真值以
    // 在册 presence 为基线；失败=fail-closed 拒全批〔帧未入 WAL，clean reject 交重发自愈〕）。
    if (this.lifecycleObserver && !this.lifecycleSeededDocs.has(document)) {
      try {
        await this.lifecycleObserver.seedPresence(pid, document);
        this.lifecycleSeededDocs.add(document);
      } catch (err) {
        for (const item of admitted) {
          this.rejectItem(item, new FrameRejectError(CollabCloseCode.SLOW_CONSUMER, 'lifecycle-seed-failed'));
          this.clearDedup(pid, item.hashHex);
        }
        actorDrainBatchTotal.inc({ result: 'lifecycle-seed-failed' });
        captureCollabException(err, { docName: projectDocName(pid), reason: 'lifecycle-seed-failed', connectionId: '-' });
        this.host.logger.error(`lifecycle seed failed for ${pid}: ${(err as Error).message}——批全拒绝（fail-closed：义务真值以 PG 在册态为基线）`);
        return;
      }
    }
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
    // Y1c T10（applied-driven）：apply 成功（维护帧=WAL fsync）即建 applied 条目——**index 对齐 admitted**
    //（毒帧 cut 之前者入队、≥cut 者丢弃〔毒帧路径 reject 兜底〕）；批后统一按序入队（walSeq 密集前缀）。
    const entries: (AppliedEntry | undefined)[] = new Array(admitted.length).fill(undefined);
    let collector = this.collectorsByDoc.get(document);
    if (!collector) { collector = new FrameEffectsCollector(); this.collectorsByDoc.set(document, collector); }
    collector.install(document);
    // SS2 大帧信号量占位（全局字节+per-project——apply 段独占；串行 drain 天然 per-project ≤1）
    const ss2Bytes = admitted.reduce((s, i) => s + (i.kind === 'ss2' ? i.bytes : 0), 0);
    if (ss2Bytes > 0) { this.ss2BytesInFlight += ss2Bytes; this.ss2Projects.add(pid); ss2SemaphoreTotal.inc({ outcome: 'acquire' }); }
    try {
      for (let k = 0; k < admitted.length; k++) {
        const item = admitted[k];
        const walSeq = appended[k].walSeq;
        if (item.kind === 'maintenance') {
          // 维护帧：payload 已生效不 apply——applied 条目即建（resolve 延后至 PG 批落定——Q-M5）
          entries[k] = this.mkAppliedEntry(pid, item, appended[k].frameId, walSeq, []);
          continue;
        }
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
          // **已 apply 前缀（k 之前——含维护帧）仍须入 applied 队列落 PG**（⑦「不跳帧续提交」——
          // applied 前缀的 PG 行不因毒帧丢失，恢复重放面=从 pgSeq 起点连续）。
          for (let m = k; m < admitted.length; m++) {
            this.rejectItem(admitted[m], new FrameRejectError(CollabCloseCode.FRAME_MALFORMED, 'frame-malformed'));
            this.clearDedup(pid, admitted[m].hashHex);
            entries[m] = undefined;
          }
          for (let m = 0; m < k; m++) if (entries[m]) this.pushAppliedEntry(pid, entries[m]!);
          void this.flushApplied(pid).catch(() => {});
          captureCollabException(err, { docName: projectDocName(pid), reason: 'actor-poison-frame', connectionId: '-' });
          return;
        }
        // appliedSeq=walSeq（apply 成功）+FrameEffects 取走（apply 后 actor 临界区内为准——修正 #1）
        st.appliedSeq = walSeq;
        this.spool.noteApplied(pid, walSeq);
        this.settleDedup(pid, item.hashHex, walSeq);
        const effects = collector.take();
        for (const e of effects) frameEffectsTotal.inc({ kind: e.kind });
        st.docIndex.apply(effects);
        entries[k] = this.mkAppliedEntry(pid, item, appended[k].frameId, walSeq, effects);
        actorFrameOutcomeTotal.inc({ outcome: 'applied' });
        this.resolveItem(item, { walSeq });   // 逐帧 resolve（beforeSync await——ACK 时帧必已 fsync+apply）
      }
    } finally {
      if (ss2Bytes > 0) { this.ss2BytesInFlight -= ss2Bytes; this.ss2Projects.delete(pid); }
    }
    // 批内全帧 applied（walSeq 密集）按序入队 → applied-driven PG 批
    for (const e of entries) if (e) this.pushAppliedEntry(pid, e);
    actorDrainBatchFrames.observe(admitted.length);
    actorDrainBatchTotal.inc({ result: 'appended' });
    void this.flushApplied(pid).catch(() => {});
  }

  /** Y1c T10：applied 条目构造（维护帧 resolve/reject 延后至 flush 落定/失败——connection 帧已 settle）。 */
  private mkAppliedEntry(pid: string, item: QueueItem, frameId: string, walSeq: bigint, effects: FrameEffect[]): AppliedEntry {
    return {
      walSeq,
      frameId,
      frameHash: createHash('sha256').update(item.payload).digest(),
      payload: item.payload,
      actor: item.actor,
      kind: item.kind,
      effects,
      onLanded: item.kind === 'maintenance' ? () => { actorFrameOutcomeTotal.inc({ outcome: 'applied' }); this.resolveItem(item, { walSeq }); } : null,
      onFailed: item.kind === 'maintenance'
        ? (flags: Record<string, unknown>) => {
            // pgPending=帧 WAL 安全未 confirm（维护方可出队）；fk=项目已删终态（收割路径）；旗标随 flush 元组（Q-I2）
            this.rejectItem(item, Object.assign(
              new FrameRejectError(CollabCloseCode.SLOW_CONSUMER, flags.fk ? 'maintenance-pg-fk' : 'maintenance-pg-pending'), flags));
            this.clearDedup(pid, item.hashHex);
          }
        : null,
      hashHex: item.hashHex,
    };
  }

  /** 便捷面（detached 路径——维护条目直推）。 */
  private pushApplied(pid: string, item: QueueItem, frameId: string, walSeq: bigint, effects: FrameEffect[]): void {
    this.pushAppliedEntry(pid, this.mkAppliedEntry(pid, item, frameId, walSeq, effects));
  }

  /** applied 队列入队单点（**walSeq 严格递增守卫**——G2 ①零重复）：维护通道重发已 applied 帧
   *  （disconnect/退避梯回灌：spool dedup 命中原 walSeq——payload 与原帧同字节）不得二次入账：
   *  重复 walSeq 破坏 actorRanges 区间铺满（overlap/inverted）+双计 frameCount。处置：
   *  ①walSeq≤pgSeq（原条目已落定）→ 维护 promise 即刻 resolve（同承诺已兑现）；
   *  ②在队（同 walSeq 条目）→ 维护回调链挂既有条目（同 walSeq 的 PG 落定=同一承诺）；
   *  ③孤例（>pgSeq 不在队——理论不可达）→ 拒绝 pgPending 交维护方退避（fail-closed 方向）。 */
  private pushAppliedEntry(pid: string, entry: AppliedEntry): void {
    const st = this.stateOf(pid);
    const tail = st.appliedQueue[st.appliedQueue.length - 1];
    if (tail == null || entry.walSeq > tail.walSeq) {
      st.appliedQueue.push(entry);
      st.appliedBytes += entry.payload.byteLength;   // Q-I2：字节运行和单点（submit 背压判界）
      return;
    }
    const pg = this.spool.watermark(pid)?.pgSeq ?? 0n;
    if (entry.walSeq <= pg) { entry.onLanded?.(); return; }   // 原条目已 flush 落定
    const existing = st.appliedQueue.find((e) => e.walSeq === entry.walSeq);
    if (existing) {
      const prevL = existing.onLanded; const prevF = existing.onFailed;
      existing.onLanded = prevL ? () => { prevL(); entry.onLanded?.(); } : entry.onLanded;
      existing.onFailed = prevF ? (f: Record<string, unknown>) => { prevF(f); entry.onFailed?.(f); } : entry.onFailed;
      return;
    }
    entry.onFailed?.({ pgPending: true });
    this.host.logger.warn(`applied 队列重复 walSeq=${entry.walSeq} 孤例 for ${pid}——维护帧按 pgPending 拒绝（fail-closed）`);
  }

  /** actor 读面（barrier/卸载/观测）：applied 队列深度（PG 待落库帧数）。 */
  appliedQueueDepth(pid: string): number { return this.states.get(pid)?.appliedQueue.length ?? 0; }

  /** per-project 自上次取走后有无 actor 落定行（disconnect flush-then-compact 判据——
   *  connection 帧不经 maintenance 队列，旧 wrote 契约的继任信号；取走即清）。 */
  private readonly landedSince = new Set<string>();
  /** 读并清落定标记（gateway onDisconnect 消费——flush-then-compact 触发承接）。 */
  takeActorLanded(pid: string): boolean {
    const landed = this.landedSince.has(pid);
    this.landedSince.delete(pid);
    return landed;
  }

  /** Y1c T10：actorRanges 装配（T9 落空 Json 补真值——Controller 裁定 1）：按批内帧 **连续同 actor 段**
   *  聚合区间 [{from,to,userId,actorKind}]（from/to=十进制字符串半开 [from,to)；applied 队列=walSeq
   *  密集前缀 ⇒ 区间铺满 [firstWalSeq,lastWalSeq+1) 不重叠无空洞——T5b validateActorRanges 批级校验）。 */
  private buildActorRanges(entries: AppliedEntry[]): ActorRange[] {
    const ranges: ActorRange[] = [];
    let start = 0;
    for (let i = 1; i <= entries.length; i++) {
      const a = entries[start].actor;
      const b = i < entries.length ? entries[i].actor : null;
      if (b == null || b.userId !== a.userId || b.actorKind !== a.actorKind) {
        ranges.push({
          from: entries[start].walSeq.toString(),
          to: (entries[i - 1].walSeq + 1n).toString(),
          userId: a.userId,
          actorKind: a.actorKind,
        });
        start = i;
      }
    }
    return ranges;
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
  private async flushPrefixToPg(pid: string, prefix: AppliedEntry[]): Promise<PgFlushOutcome> {
    // 熔断面②（T16 承继）：open 期 PG 腿首行短路（零 PG 等待——省 5s 事务上界）——帧已 WAL 安全
    // 未 confirm，false 交维护方退避梯（half-open 放行=本次即探测）
    if (this.pgBreaker?.isOpen()) return { landed: false, errorKind: null };
    try {
      const generation = this.spool.currentGeneration(pid);
      // 行分片：贪心 ≤1MiB/行（单帧超限=独立行——CRDT 帧结构性不可再分；批上界 512 帧/8MiB 已在取前缀面）
      const rows: Array<{ generation: number; firstWalSeq: bigint; lastWalSeq: bigint; frameCount: number; updateHash: string; update: Uint8Array; actorRanges: ActorRange[] }> = [];
      let cur: AppliedEntry[] = [];
      let curBytes = 0;
      const flushRow = () => {
        if (cur.length === 0) return;
        const actorRanges = this.buildActorRanges(cur);
        const verdict = validateActorRanges(actorRanges, { firstWalSeq: cur[0].walSeq, lastWalSeq: cur[cur.length - 1].walSeq });
        if (!verdict.ok) throw Object.assign(new Error(`actorRanges 装配违约 ${verdict.reason}: ${verdict.detail}`), { actorRangesInvalid: true });
        rows.push({
          generation,
          firstWalSeq: cur[0].walSeq,
          lastWalSeq: cur[cur.length - 1].walSeq,
          frameCount: cur.length,
          updateHash: CanvasDocUpdateRepository.batchUpdateHash(cur.map((e) => e.frameHash)),
          update: cur.length === 1 ? cur[0].payload : Y.mergeUpdates(cur.map((e) => e.payload)),
          actorRanges,
        });
        cur = []; curBytes = 0;
      };
      for (const e of prefix) {
        if (cur.length > 0 && curBytes + e.payload.byteLength > PG_ROW_MERGE_MAX_BYTES) flushRow();
        cur.push(e); curBytes += e.payload.byteLength;
      }
      flushRow();
      for (const row of rows) yjsStorePayloadBytes.observe(row.update.byteLength);   // Y0b-5 T10 锚位承接：append 成功路径逐片 observe（actor PG 腿）
      // 水位 CAS（v1.7 拆义）：expected=spool 内存 pgSeq（confirm 单点推进——单写者口径）；
      // walCheckpointSeq=提交时刻 spoolHeadSeq 采样（永不写 appliedSeq 口径）；newPgSeq=批 lastWalSeq。
      const w = this.spool.watermark(pid);
      const lastWalSeq = prefix[prefix.length - 1].walSeq;
      // Y1c T26：帧前缀义务 payload（AppliedEntry.effects per-walSeq buffer）与帧行同事务落库
      //（帧↔义务原子——inTx 闭包在 appendBatch 事务内消费）
      const frames: LifecycleFrame[] | undefined = this.lifecycleObserver
        ? prefix.map((e) => ({ walSeq: e.walSeq, effects: e.effects }))
        : undefined;
      const r = await this.repo.appendBatch(pid, rows, {
        expectedPgSeq: w?.pgSeq ?? 0n,
        newPgSeq: lastWalSeq,
        walCheckpointSeq: w?.spoolHeadSeq ?? lastWalSeq,
      }, frames ? async (tx) => { await this.lifecycleObserver!.persistFramesInTx(tx, pid, frames); } : undefined);
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
      this.pgBreaker?.recordSuccess();
      return { landed: true, errorKind: null };
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2003' || /Foreign key constraint/i.test((err as Error).message)) {
        throw err;   // FK=项目已删写路径发现点——重抛交 flushApplied 终态处置（discard+notify+收割——V6/T14 同判）
      }
      yjsStoreTotal.inc({ trigger: 'maintenance' });   // 归因：actor PG 腿失败面（帧留 spool 未 confirm）
      this.pgBreaker?.recordFailure(err);              // PG 健康样本（连接族推闸——T16 熔断面②承继）
      // T11 store 失败样本承接（PG 腿唯一写点换代——tags 契约逐字保持）
      captureCollabException(err, { docName: projectDocName(pid), reason: 'store-append-failed', connectionId: '-' });
      this.host.logger.error(`actor PG append failed for ${pid}: ${(err as Error).message}——帧留 spool（磁盘安全），reconciler/退避梯回灌`);
      return { landed: false, errorKind: err as Error };
    }
  }

  /** **Y1c T10 applied-driven 批量 PG flusher**：批只从 applied 队列取（连续前缀——上界=appliedSeq
   *  构造性成立〔仅 applied 帧入队〕，≤512 帧/8MiB）→单事务多行 append+水位 CAS→confirm spool 帧
   *  →维护帧 resolve。失败：帧 WAL 安全留队（BOI）+re-kick 重试；fenced=隔离链+留队（恢复链承接）；
   *  FK=项目终态（条目弃置+维护帧 fk 拒绝——收割归维护方）。单 flusher（st.flushing 闸——重入合并）。 */
  private async flushApplied(pid: string): Promise<void> {
    const st = this.stateOf(pid);
    if (st.flushing) return;
    st.flushing = true;
    st.lastFlushKickAt = Date.now();
    try {
      for (;;) {
        const queue = st.appliedQueue;
        if (queue.length === 0) break;
        let n = 0;
        let bytes = 0;
        while (n < queue.length && n < PG_BATCH_MAX_FRAMES) {
          if (n > 0 && bytes + queue[n].payload.byteLength > PG_BATCH_MAX_BYTES) break;
          bytes += queue[n].payload.byteLength;
          n += 1;
        }
        const prefix = queue.slice(0, n);
        let outcome: PgFlushOutcome;
        try {
          outcome = await this.flushPrefixToPg(pid, prefix);
        } catch (err) {
          if ((err as { fk?: boolean })?.fk || (err as { code?: string })?.code === 'P2003' || /Foreign key constraint/i.test((err as Error).message)) {
            // FK=项目已删写路径发现点：条目终态弃置+维护帧 fk 拒绝（persistence 帧通道 confirm+收割）
            st.appliedQueue.splice(0, n);
            st.appliedBytes -= prefix.reduce((s, e) => s + e.payload.byteLength, 0);   // Q-I2：出队单点同步
            for (const e of prefix) e.onFailed?.({ pgPending: true, fk: true });
            actorDrainBatchTotal.inc({ result: 'pg-fk' });
            this.host.logger.warn(`actor PG flush FK for ${pid}——applied 条目弃置（项目已删），维护帧终态拒绝`);
            continue;
          }
          outcome = { landed: false, errorKind: err as Error };
        }
        if (!outcome.landed) {
          // 失败档：帧 WAL 安全留队（BOI 归属地=spool 未 confirm）+维护帧 pgPending 拒绝（可出队）。
          // **不排独立重试 timer**（与 persistence 退避梯/reconciler 职责去重）：再驱动面=①退避梯
          // （maintenance 帧——persistence 域）②flushThrough kick（barrier/卸载 drain）③下一 drain 批
          // kick ④生产 reconciler replayAll（30s 全帧兜底）。fenced 隔离链已在 flushPrefixToPg 内先行。
          for (const e of prefix) e.onFailed?.(this.pgPendingFlags(outcome.errorKind));
          return;
        }
        // 落定：新家=PG（CAS 同事务）——splice+confirm+维护帧 resolve（Q-M5：resolve 延后至此）
        st.appliedQueue.splice(0, n);
        st.appliedBytes -= prefix.reduce((s, e) => s + e.payload.byteLength, 0);   // Q-I2：出队单点同步
        await this.spool.confirm(pid, prefix.map((e) => e.frameId));
        for (const e of prefix) e.onLanded?.();
        this.landedSince.add(pid);   // disconnect flush-then-compact 判据（connection 帧不经维护队列——wrote 契约继任）
      }
    } finally {
      st.flushing = false;
    }
    // flush 期间新帧入队（drain 并行推进）→ 尾轮再跑（st.flushing 已复位=新单 flusher）
    if (st.appliedQueue.length > 0) void this.flushApplied(pid).catch(() => {});
  }

  // ═══════════════════ Y1c T21：frozenDocSeq 受理临界区（v5.4⑪——G4 门）═══════════════════

  /** **frozenDocSeq 正确临界区**（spec §6.1 v5.4⑪——次序冻结=FROZEN_DOC_SEQ_CRITICAL_SECTION_STAGES）：
   *  freeze=**先拿 gate per-project mutex**（非布尔 flag——drain 循环每批前让位，已过准入检查的
   *  beforeSync 帧不得在冻结读后 apply，提交中的帧排队待 release）→等当前 drain 批完成→
   *  flushThrough(appliedSeq)→断言 pgSeq==appliedSeq→校验 generation→fn 只读（调用方自限 scope
   *  节点+直接父节点——禁全量 readCanvas）→释放。
   *  预算：gate+drain 等待 ≤EXEC_FREEZE_BUDGET_MS（500ms）超时→`gate-timeout`（调用方回退 PG 前缀
   *  重建候选 doc——MVCC 一致前缀，不阻塞项目 actor）；flush 等待 ≤EXEC_ADMISSION_TIMEOUT_MS（2s）
   *  总预算超时→`flush-timeout`（调用方 503 不落行）。doc 未装载（无在内存 doc）→`no-doc`（调用方走
   *  PG 重建）。freeze 串行化：在持 freeze 期间新 freeze 等待 released（同项目受理互斥）。 */
  async withFrozenPrefix<T>(
    pid: string,
    fn: (ctx: { doc: Y.Doc; appliedSeq: bigint; pgSeq: bigint; generation: number | undefined }) => Promise<T>,
    opts?: { gateBudgetMs?: number; flushBudgetMs?: number },
  ): Promise<{ ok: true; value: T; appliedSeq: bigint; pgSeq: bigint; generation: number | undefined } | { ok: false; reason: 'gate-timeout' | 'flush-timeout' | 'no-doc' }> {
    const st = this.stateOf(pid);
    const t0 = Date.now();
    const gateBudget = opts?.gateBudgetMs ?? EXEC_FREEZE_BUDGET_MS;
    const totalBudget = opts?.flushBudgetMs ?? EXEC_ADMISSION_TIMEOUT_MS;
    // serialize freezers：在持 freeze 期间等待（gate 预算内让位）
    while (st.freeze?.active) {
      if (Date.now() - t0 >= gateBudget) return { ok: false, reason: 'gate-timeout' };
      await Promise.race([st.freeze.released, new Promise((r) => setTimeout(r, 5))]);
    }
    // 拿 mutex（drain 每批前让位——此后新 submit 帧只入队不 apply）
    let release!: () => void;
    const released = new Promise<void>((r) => { release = r; });
    st.freeze = { active: true, released, release };
    try {
      // 等当前 apply 批完成（batchInFlight=false=无在飞 apply；queue 中帧=未 apply，freeze 期间
      // 不再处理——PG flush 挂起不阻塞本等待：flushThrough 随后以 flush-timeout 拒绝该窗）
      while (st.batchInFlight) {
        if (Date.now() - t0 >= gateBudget) return { ok: false, reason: 'gate-timeout' };
        await new Promise((r) => setTimeout(r, 2));
      }
      const generation = this.host.generationOf(pid);
      const document = this.host.documents().get(canvasDocName(pid, generation ?? 0));
      if (!document) return { ok: false, reason: 'no-doc' };
      const applied = st.appliedSeq;
      const flushDeadline = t0 + totalBudget;
      const r = await this.flushThrough(pid, applied, { maxWaitMs: Math.max(1, flushDeadline - Date.now()) });
      if (!r.targetReached || r.pgSeq !== applied) return { ok: false, reason: 'flush-timeout' };
      // I-1（T21 收口）：verify-generation-unchanged——flush 等待窗内换代（vacuum/维护 SWITCHING）⇒
      // 冻结读作废（reason='gate-timeout'——调用方自然回退 PG 前缀重建档；
      // FROZEN_DOC_SEQ_CRITICAL_SECTION_STAGES 八阶段齐：acquire→wait-apply→flush→assert-pgSeq→
      // verify-generation→read-scope→set-frozenDocSeq→release）。
      if (this.host.generationOf(pid) !== generation) return { ok: false, reason: 'gate-timeout' };
      const value = await fn({ doc: document, appliedSeq: applied, pgSeq: r.pgSeq, generation });
      return { ok: true, value, appliedSeq: applied, pgSeq: r.pgSeq, generation };
    } finally {
      const cur = st.freeze;
      st.freeze = null;
      cur?.release();
    }
  }

  /** **flushThrough 契约（§4.2 v5.4——T10 实现）**：幂等（同 target 重复调用同结果）/有界等待（≤250ms
   *  节流合并——只承诺「目标前缀已提交」不承诺「立刻新建 PG 事务」）/不阻塞写入（drain 照常）/返回当前
   *  pgSeq。target=handler 首语句同步捕获的 appliedSeq；pgSeq≥target ⇒ 行已 CAS 提交（confirm 后置）。 */
  async flushThrough(pid: string, target: bigint, opts?: { maxWaitMs?: number }): Promise<FlushThroughResult> {
    const deadline = Date.now() + Math.max(1, Math.min(opts?.maxWaitMs ?? FLUSH_THROUGH_MAX_WAIT_MS, FLUSH_THROUGH_MAX_WAIT_MS));
    for (;;) {
      const w = this.spool.watermark(pid);
      const pg = w?.pgSeq ?? 0n;
      if (pg >= target) return { pgSeq: pg, targetReached: true };
      if (Date.now() >= deadline) return { pgSeq: pg, targetReached: false };
      const st = this.states.get(pid);
      // 项目级 flush 节流 ≤250ms（多 barrier 合并等待——节流窗内不新建 flush；在飞 flush/retry timer 承接）
      if (st && !st.flushing && st.appliedQueue.length > 0 && Date.now() - st.lastFlushKickAt >= SAVE_BARRIER_FLUSH_THROTTLE_MS) {
        void this.flushApplied(pid).catch(() => {});
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  // ═══════════════════ save barrier（Y1c T10——onStateless 接线）═══════════════════

  /** barrier nonce 幂等回执台账（FIFO 驱逐+TTL——重试同 nonce 回执逐字段等值）。 */
  private readonly barrierReceipts = new Map<string, { payload: string; at: number }>();
  private rememberBarrierReceipt(nonce: string, payload: string): void {
    this.barrierReceipts.set(nonce, { payload, at: Date.now() });
    while (this.barrierReceipts.size > BARRIER_NONCE_CACHE_MAX) {
      const oldest = this.barrierReceipts.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.barrierReceipts.delete(oldest);
    }
    if (this.barrierReceipts.size < BARRIER_NONCE_CACHE_MAX / 2) return;
    const now = Date.now();
    for (const [k, v] of [...this.barrierReceipts.entries()]) if (now - v.at > BARRIER_NONCE_TTL_MS) this.barrierReceipts.delete(k);
  }

  /** **onStateless handler（偏离 37⑦+38⑳）**：barrier 请求={nonce,clientSeq,tabId,sessionEpoch}（无
   *  type 域——T5a 冻结 wire 形态；含 string nonce+number clientSeq 即判 barrier，其余 payload 静默
   *  忽略）。**首语句同步捕获 target=appliedSeq**（任何 await 之前——捕 pgSeq 会少报已 apply 未落 PG
   *  的帧）；flushThrough(target)→有界等待→显式 connection.sendStateless 回执（库丢弃返回值）。
   *  nonce 幂等（重试同结果）；**永不 throw**（catch 回 BARRIER_FAILED 回执）；maintenance 冻结期回
   *  error:'maintenance' 档（不产生 Durable）。同连接串行=库 processMessages 队列（stateless 与 sync
   *  同队列序——契约测试锁定）。 */
  async handleStateless(p: { connection: unknown; documentName: string; payload: string }): Promise<void> {
    let request: { nonce: string; clientSeq: number } | null = null;
    try {
      const parsed: unknown = JSON.parse(p.payload);
      if (parsed && typeof parsed === 'object' && typeof (parsed as { nonce?: unknown }).nonce === 'string' && typeof (parsed as { clientSeq?: unknown }).clientSeq === 'number') {
        request = parsed as { nonce: string; clientSeq: number };
      }
    } catch { /* 非 JSON payload——非 barrier 面，静默忽略（永不 throw） */ }
    if (!request) return;
    const conn = p.connection as CollabConnection;
    const pid = parseDocName(p.documentName)?.projectId ?? '';
    const send = (payload: string) => {
      try { conn?.sendStateless?.(payload); } catch (err) { this.host.logger.warn(`barrier receipt send failed for ${p.documentName}: ${(err as Error).message}`); }
    };
    // nonce 幂等：重试同 nonce → 回执逐字段等值（T5a corpus nonceRetry 档）
    const cached = this.barrierReceipts.get(request.nonce);
    if (cached) { send(cached.payload); return; }
    // ★ 同步捕获 target=appliedSeq（首语句纪律——任何 await 之前）
    const target = this.appliedSeqOf(pid);
    try {
      if (this.host.isMaintenanceBlocked?.(pid)) {
        const receipt = JSON.stringify({ nonce: request.nonce, error: 'maintenance', committedSeq: (this.spool.watermark(pid)?.pgSeq ?? 0n).toString() });
        this.rememberBarrierReceipt(request.nonce, receipt);
        send(receipt);
        return;
      }
      const r = await this.flushThrough(pid, target);
      const receipt = r.targetReached
        ? JSON.stringify({ nonce: request.nonce, clientSeq: request.clientSeq, committedSeq: r.pgSeq.toString() })
        : JSON.stringify({ nonce: request.nonce, error: 'BARRIER_FAILED', committedSeq: r.pgSeq.toString() });
      this.rememberBarrierReceipt(request.nonce, receipt);
      send(receipt);
    } catch (err) {
      // 永不 throw（契约——库对 hook throw 重抛进连接消息环）：catch 回 BARRIER_FAILED 回执
      const receipt = JSON.stringify({ nonce: request.nonce, error: 'BARRIER_FAILED', committedSeq: (this.spool.watermark(pid)?.pgSeq ?? 0n).toString() });
      try { this.rememberBarrierReceipt(request.nonce, receipt); } catch { /* 台账失败不掩回执 */ }
      send(receipt);
      this.host.logger.warn(`barrier handler error for ${p.documentName}: ${(err as Error).message}——已回 BARRIER_FAILED 回执`);
    }
  }

  /** **doc 卸载纪律（偏离 37⑩+38⑤——beforeUnloadDocument drain 面）**：drain applied→PG（有界预算）
   *  或返回 false=拒绝卸载（throw 由调用方 gateway 钩子执行——doc 常驻 fail-closed；PG 不可用/隔离态
   *  均阻塞）；fenced 隔离链已由 flush 面（帧 WAL 安全——恢复链承接，但本实例无法证明落库=拒卸载）。 */
  async drainAppliedForUnload(pid: string, budgetMs = 5_000): Promise<boolean> {
    const deadline = Date.now() + budgetMs;
    for (;;) {
      if ((this.states.get(pid)?.appliedQueue.length ?? 0) === 0) return true;
      const wait = Math.max(50, deadline - Date.now());
      const r = await this.flushThrough(pid, this.appliedSeqOf(pid), { maxWaitMs: wait });
      if ((this.states.get(pid)?.appliedQueue.length ?? 0) === 0) return true;
      if (r.targetReached && (this.states.get(pid)?.appliedQueue.length ?? 0) === 0) return true;
      if (Date.now() >= deadline) return false;
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
