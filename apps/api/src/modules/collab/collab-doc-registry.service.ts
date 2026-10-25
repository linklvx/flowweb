// apps/api/src/modules/collab/collab-doc-registry.service.ts
// Y0c T41（W3a/B2）：DocRegistry 切出——doc 生命周期账目单一所有者（Z24「按状态所有权界定边界」；
// 设计单源=t41-b2-design.md §1.2 三列清单+§12 RC1=B/RC2=A/RC3=A 裁决）。状态键=projectId/document
// 对象：truth 三件套+降级+测量预算/卸载锚+top-N+doc 代际/quota 四值+冻结族（含 overPush——RC2：
// guardSyncFrame 全链⓪→④分层判定不得切两半）/真空代际进程态/doc-status 广播账目/stuck 观测账目
// （RC3：heapPressureSample 采样闸经 host 缝留 GW，W3b 迁 SG）/residency 释放入口+探针（RC1=B 组合
// 持有——residency 文件零改动，attach 缝后置绑定）。
// 行数锚 ≤1100（§0.6 偏离 65 重标建议值——W5 出口实测重标）。构造器零 gateway/Server 依赖（显式
// @Inject=esbuild 无 metadata 先例）；DI/直构双兼容（gateway 尾参缺省自建+bindHost——B1 persistence
// 同款；自建传同 pgBreaker 防脑裂）。行为零变化红线：方法体=gateway 前文逐字平移，仅 host 缝机械
// 替换（logger/documents 读面/SG 能力三位——bytes 桶/freezeReasons/hardClose 经 host=W3b 改接 sg.*
// 转发，本文件与 host 接口签名两波零改动）。doc-name 解析经 doc-name.util（偏离 67）。
// E35 owner 抽象落点（§3.3-4）：DR 的 owner 门=bindHost 谓词组 isServingState()/isDrainingState()
// （GW 实现=collabState 派生+lease 接线）——单实例租约=平凡实现；Y7 多实例只换 host 实现不重写。

import { Injectable, Logger, Optional, Inject, ServiceUnavailableException } from '@nestjs/common';
import { OutgoingMessage } from '@hocuspocus/server';
import type { Document, onLoadDocumentPayload, beforeSyncPayload } from '@hocuspocus/server';
import * as Y from 'yjs';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabPgBreakerService } from './collab-pg-breaker.service';
import { CollabPersistenceService } from './collab-persistence.service';
import { parseDocName, isValidDocName, admitDocNameForGeneration, canvasDocName, projectDocName } from './doc-name.util';
import { CollabAuthReason, CANVAS_DOC_SCHEMA_VERSION, CollabCloseCode, QUOTA_DEFAULTS, SERVER_TRANSACT_ORIGIN, DOC_VACUUMING_TERMINAL_REASON, DOC_GENERATION_STALE_TERMINAL_REASON, DOC_STATUS_REV_SEED, fillDoc, toReadModel, type CollabAuthReasonCode, type CollabDocStatusPayload } from '@flowweb/shared';
import { observeOrderPathologyOnLoad } from './collab-pathology';
import { toDocLike } from './doc-like.util';
import { createCanvasDoc } from './canvas-doc.factory';
import { captureCollabException } from '../../utils/sentry-scrub';
import type { HeapPressureSample } from './heap-pressure';
import type { TryReleaseMotive, TryReleaseOutcome } from './collab-residency.service';
import type { CollabConnection, FreezeReason } from './collab.gateway';   // W3a：type-only 零运行时边（无 design:paramtypes 环——偏离 67 循环前提对纯类型不成立；collab-conn.util 候选否因 census ⑤/backpressure 锚词面冲突，commit 披露）
import { collabLoadRejectedTotal, collabHydrationDeferredTotal, collabVacuumAutotriggerStackedTotal, yjsDocStuckTotal, yjsDocLoadTotal, consumeDirectLoad, yjsLoadDuration, yjsLoadUnloadingWindowTotal, yjsDocHeapAmplification, yjsDocBytes, yjsDocBytesOverThresholdTotal, DOC_BYTES_OVER_THRESHOLD_BYTES, collabQuotaWritesDroppedTotal, collabQuotaFastpathTotal, collabQuotaTruthMeasuredTotal, collabQuotaTruthMeasureDuration, collabQuotaSoftThresholdTotal } from './store.metrics';

/** Y0b-4 T3（Q-B）：真值测量冷却窗——窗口内最坏编码 CPU 占用 <5% 单核。定标=T0 探针⑦实测
 *  8MB doc 编码 p50=50ms/p95=80.6ms（本机；生产 2 核机 ×2-4）——2000ms 窗下 duty≈4%。
 *  T4 beforeSync 判据④消费（本 Task 定义导出——冷却窗内不重测，按上界决策）。W3a 随域迁
 *  DocRegistry（gateway 再导出保 import 面——B1 COMPACT_INTERVAL_MS 先例）。 */
export const TRUTH_COOLDOWN_MS = 2_000;

/** Y0b-4 T2：配额四值契约（gateway 构造注入面——Partial 允许部分覆盖 env 默认）。W3a 随域迁
 *  DocRegistry（配额执法唯一落点 guardSyncFrame/freeze 族/buildDocStatus 全 DR——§1.2；gateway
 *  再导出保 import 面〔type QuotaConfig spec ×6〕）。 */
export interface QuotaConfig { maxDocBytes: number; maxTxBytes: number; msgRate: number; bytesRate: number; }

/** Y0b-4 T2：env 正整数解析——0/NaN/''/未设一律回退 fallback（'' 与未设同语义〔B13 同款〕；
 *  gateway 内导出供 api 测试直接 import）。W3a 随 quota 四值解析迁 DR 构造器（唯一消费体随迁——
 *  gateway 再导出保 import 面〔quota-config spec ×1〕；census ㉒ 四键条目同迁）。 */
export function parsePositiveInt(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Y0b-4 T4（Q-D v5/v6）：per-conn 持续强推升级窗——双阈（20 帧或 2×maxTxBytes）∧跨 10s
 *  （人类反应余量）；idle-reset=帧间隔>5s 重置（休眠恢复/慢速持续形态不计入持续）。 */
const OVER_PUSH_IDLE_RESET_MS = 5_000;
const OVER_PUSH_WINDOW_MS = 10_000;
const OVER_PUSH_COUNT = 20;
/** Y0b-4 T4（Q-C v5）：thaw 后复冻冷却窗——冷却内不因软阈复冻（实测>MAX 硬限除外），防贴阈抖动 UI 闪断。 */
const THAW_COOLDOWN_MS = 30_000;
/** Y0b-4 T4（Q-C v3）：冻结 doc 重测间隔（frozenRecheckTimer——冻结态唯一出口，禁挂 sweep 逃生阀）。 */
const FROZEN_RECHECK_INTERVAL_MS = 30_000;

/** Y0b-4 T9a（Q-U v6）：vacuum 纪元常量——thaw 回灌收敛窗（RTT+debounce+store 上界）/quiesce
 *  轮询周期与硬上界（"PG 完整性=文档已卸载的推论"——超时禁降级继续）/零连接自动触发判据
 *  （recheckRounds≥4+residue>60%×MAX——无在线用户=无强制刷新伤害）。 */
export const VACUUM_THAW_SETTLE_MS = 5_000;
export const VACUUM_QUIESCE_POLL_MS = 100;
export const VACUUM_QUIESCE_TIMEOUT_MS = 30_000;
/** residue 评估起步轮（recheck≥2 轮算 liveBytes——docResidue/快照 residueBytes 数据源）+自动触发轮 */
const RESIDUE_EVAL_ROUNDS = 2;
const AUTO_VACUUM_ROUNDS = 4;
const AUTO_VACUUM_RESIDUE_RATIO = 0.6;

/** Y0b-5 T10：top-N doc 结构日志节律（5min——日志非指标，v1「1s 去抖」废弃后唯一豁免定时器）；
 *  数据源=docTruth+delta（与 yjs_doc_bytes 直方图三锚同一数据源——零 encode：病态 doc 编码 ≈75×
 *  全量重编=风暴，top-N 只读既有 Map）。 */
export const TOPN_LOG_INTERVAL_MS = 5 * 60_000;
export const TOPN_LOG_LIMIT = 10;

/** Y0b-4 T9a：Y.Map 递归深拷贝（exec/meta/未知 Map 根的真空重建——生产写者〔writeExecStatus/
 *  meta 族〕值为 JSON 直拷；嵌套 Y.Map 条目逐层重建）。 */
function deepCopyYMap(src: Y.Map<unknown>, dst: Y.Map<unknown>): void {
  for (const [k, v] of src.entries()) {
    if (v instanceof Y.Map) {
      const m = new Y.Map();
      deepCopyYMap(v, m);
      dst.set(k, m);
    } else dst.set(k, v);
  }
}

/** W3a host 最小接口（设计 §4.3 终态设位+现场核补三位——逐位消费点证明见各行注；「全消费零投机」
 *  纪律：无消费点的位置禁设）。SG 能力位（consumeBytesBucket/applyWriteFreeze/releaseFreezeForDoc/
 *  hardClose/freezeReasons）W3a 阶段 host 实现=gateway 现存对应私有方法本体（SG 尚不存在——W3b 迁
 *  SG 后 gateway 侧接线改转发 sg.*，本接口签名两波零改动）。heapPressureSample 同（RC3：采样闸
 *  W3b 迁 SG）。设计 §4.3 表列 10 位，现场核实测 13 位（补 shouldUnloadDocument〔observeIdleDocs
 *  :781 库守卫消费〕/freezeReasons〔guardSyncFrame ① :1587 消费——任务卡 RC2「freezeReasons 读写
 *  经 SG 能力」点名〕/connectionIdOf〔loadDocument :1117 captureCollabException 消费〕三位——表漏
 *  列，commit message 披露）；documents/unloadingDocuments 两读面按 §4.3 括注「落地取两个只读访问
 *  器位」形态。 */
export interface CollabDocRegistryHost {
  readonly logger: Logger;
  /** 库 documents Map 只读访问器（freezeQuota/thawQuota/recheckFrozenDocs/scheduleFreezePending/
   *  beginVacuumEra/broadcastDocStatus/observeIdleDocs/loadDocument heap 闸 :1031 消费）。 */
  documents(): ReadonlyMap<string, Document>;
  /** 库 unloadingDocuments 只读访问器（loadDocument T19/Z64② 卸载窗门 :1018 消费）。 */
  unloadingDocuments(): { has(name: string): boolean };
  /** 库卸载守卫谓词（observeIdleDocs stuck 判据 :781 消费——守卫拒绝+零连接+队列空=疑似卡住）。 */
  shouldUnloadDocument(document: Document): boolean;
  /** collabState serving 谓词（loadDocument :983 P0-1 三入口②消费——V12 判据唯一化）。 */
  isServingState(): boolean;
  /** collabState draining 谓词（buildDocStatus :1880/broadcastDocStatus :1900 writeFrozen 复合键消费）。 */
  isDrainingState(): boolean;
  /** heap 压力采样（observeIdleDocs :774 F-2 每轮采样/loadDocument :1031 heap 闸消费——RC3：
   *  实现 W3a=gateway heapPressureSample 本体，W3b 迁 SG 后改转发 sg 同名公有）。 */
  heapPressureSample(): HeapPressureSample;
  /** writeFreeze 单源施加/解除（freezeQuota :1755/thawQuota :1772/beginVacuumEra :1411 消费——
   *  SG 域能力，W3b 改接 sg.applyWriteFreeze）。 */
  applyWriteFreeze(conn: CollabConnection, reason: FreezeReason, on: boolean): void;
  /** writeFreeze 条目按 pid 解除+返回受影响 socketId（purgeDocState :1438-1442 全原因解除+overPush
   *  连带清/abortVacuumRestore :1454-1456 仅 'quota' 原因〔reason 参数——两消费点形态差异，表列
   *  (pid) 单参为 purge 形态〕——循环体=gateway 侧逐字平移，SG 侧新语义操作 W3b 随迁）。 */
  releaseFreezeForDoc(pid: string, reason?: FreezeReason): string[];
  /** code 权威投递关闭（guardSyncFrame :1551/:1566/:1572/:1582/:1598/beginVacuumEra :1412 消费——
   *  SG 域能力，W3b 改接 sg.hardClose）。 */
  hardClose(conn: CollabConnection | undefined | null, code: number, reason: string): void;
  /** writeFreeze 单源查询（noteReadOnlyDrop 丢帧计数分档消费——W3b 改接 sg.freezeReasons；
   *  Y1c T9：guardSyncFrame ⓪′ bytes 桶缝随 gate 收编迁出（gate host 位））。 */
  freezeReasons(conn: CollabConnection): Set<FreezeReason>;
  /** Y1c T9（T8 接线）：世代播种缝（loadDocument generation 位——gateway 转发 spool.setProjectGeneration）。 */
  onGenerationSeeded?(projectId: string, generation: number): void;
  /** C1①（Y1c T11 双评审 Critical）：walSeq 计数器 PG 真值播种缝（loadDocument hydration 行 pgSeq
   *  位——gateway 转发 spool.seedWalSeqFromPg）。段全回收项目 scan 面为零（计数器自 1 重起），装载=
   *  新会话一切帧通道（actor/维护——observeDocument 在首 await 前已建队列面）的必经前置，此缝使
   *  新帧恒 walSeq>pgSeq（readConsistent 尾可见）。 */
  onWalSeqFloorSeeded?(projectId: string, pgSeq: bigint): void;
  /** WS connectionId 读面（loadDocument :1117 装载失败 Sentry 样本 consumption——台账 SG 域
   *  （connectionIds socketId 键），W3b 改接 sg 读面）。 */
  connectionIdOf(socketId: string): string | undefined;
}

/** doc 生命周期账目单一所有者（Z24；设计 §1.2）。公有面=既有外部消费方经 gateway 委托位背后的
 * 本体+测试直调族（gw.docRegistry.loadDocument 等——B1「公有化后 cast 消失」同款，§0.6 偏离 64②）。 */
@Injectable()
export class CollabDocRegistryService {
  private host!: CollabDocRegistryHost;
  /** Y0b-5 T16：PG 熔断器（loadDocument 准入+健康采样——直构缺省自建；gateway 自建路径传同实例防脑裂） */
  private readonly pgBreaker: CollabPgBreakerService;
  /** Y0b-4 T2：配额四值（构造期一次读入 env 默认+注入覆盖——运行期不再读 env，Q-P 禁模块级
   *  测试钩子）；消费=T3/T4/T6/T8/T9a 的 this.quota。W3a 随域迁：解析单点=本构造器（gateway
   *  桶容量读面经 activeQuota 单源——防双源 P3）。 */
  private readonly quota: QuotaConfig;
  /** Y0b-4 T3（Q-B v3）：真值三件套+降级标记（projectId 键控）——
   *  docTruth=实测编码真值（单变量；测量点白名单：装载 cheap 播种/付费实测、compact pending 空校准、
   *  shrink 预演〔T8〕、over 检查〔T4 冷却窗外〕）；docDelta=自上次实测的增量累加（触发器非真值——
   *  update 监听唯一写者）；truthMeasuredAt=冷却窗基线（TRUTH_COOLDOWN_MS）；degradedDocs=装载
   *  pendingStructs/pendingDs 非空的降级 doc（快照/健康面可见——Q-O）。清理=afterUnloadDocument+projectsGone。
   *  公有=gateway metrics reader 闭包+docBytesOf/isDocDegraded 委托位消费面（B1 storeFailedDocs 先例）。 */
  readonly docTruth = new Map<string, number>();
  readonly docDelta = new Map<string, number>();
  readonly truthMeasuredAt = new Map<string, number>();
  readonly degradedDocs = new Set<string>();
  /** Y0b-5 T10：卸载边界 heap 倍率锚（beforeUnload 播种→afterUnload 结算——docTruth 在 afterUnload
   *  被清所以先存编码字节；卸载取消时残留条目由装载路径同键覆写，无泄漏面） */
  private readonly unloadHeapAnchors = new Map<string, { before: number; truth: number }>();
  /** Y0b-5 T10：top-N 结构日志定时器（日志非指标——指标面零定时器纪律的唯一豁免） */
  private docTopNLogTimer: ReturnType<typeof setInterval> | null = null;
  /** 批3-4 doc epoch（R1c 前置物）：doc 实例代际——服务端 WeakMap 而非写 ydoc meta（meta 内容
   *  会随 doc 状态进 canonical 重放等价判据〔不变量 1〕，不持久化的 meta 字段会伪红全组契约；
   *  且持久化形态下重启换代会让每次 load 平添一行增量——破零写放大契约） */
  private readonly docEpoch = new WeakMap<Y.Doc, number>();
  /** Y0b-4 T4（Q-C v3）：文档级冻结注册表（冻结态唯一重测对象域——recheckTimer 仅遍历它）。
   *  公有=gateway registerFrozenDocsReader/connected 钩子/authenticateInner 兜底/freezeReasons
   *  回落分支消费面（isQuotaFrozen 委托位背后的本体读面）。 */
  readonly quotaFrozenDocs = new Set<string>();
  /** Y0b-4 T4（v6 G-1 两态分离）：账面触阈待确认集——只广播 over+挂确认定时器；帧继续走③④判据
   *  （禁 v5 的 quotaFrozenDocs.add 立即+readOnly 延后=判据②确认窗放行一切）；禁碰 readOnly。 */
  private readonly freezePending = new Set<string>();
  /** freezePending 确认定时器（单 doc 去重——cooldown 到期即测，豁免 truthBudget） */
  private readonly freezePendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** per-conn 持续强推台账（socketId 键——Q-D；复位只在 thawQuota，freeze 重入不清零）。RC2：
   *  主消费面=guardSyncFrame ①/thawQuota/purgeDocState 全 DR；SG 仅老化/断连清理（ageOverPush/
   *  dropOverPush 两公有缝位——sweepStaleAuthMaps/disconnect 消费）。 */
  private readonly overPush = new Map<string, { count: number; bytes: number; firstAt: number; lastAt: number }>();
  /** 冻结重测轮数（≥softEnter 连续计数——T9a liveBytes 评估脚手架）+thaw 复冻冷却基线 */
  private readonly recheckRounds = new Map<string, number>();
  private readonly thawCooldown = new Map<string, number>();
  /** ===== Y0b-4 T9a（Q-U v6）：vacuum 代际替换进程态 =====
   *  vacuumingDocs=serving 门（真空窗口内 WS connected→close 4410/REST withDoc→503/loadDocument→503）；
   *  Y1c T12（偏离 27）：preVacuumSvCache/SV 代际门**退役**（装载播种与 SyncStep1 门删除——SV clock
   *  关系层防不住 Update 帧路径〔S2 Phase C〕且形态②〔全 clock<pre〕结构性放行；世代执法改道 docName
   *  段 auth/load 双校验〔admitDocNameForGeneration 单源〕）；docGeneration=doc-status 顶层 generation
   *  产生源+**世代真值链**（装载恒播种当代真值——含 0：DR:403 缝修复，旧 `if (generation)` truthy 门
   *  使未换代项目永不播种=spool/PG 批行落缺省代 1 与 CanvasDoc.generation=0 分叉）+liveDocName 内部
   *  寻址源（#g canonical wire 名）；docResidue=truth−全根真空重建编码（recheck≥2 轮更新——gauge
   *  reader Σ+doc-status quota.residueBytes 产生源，公有=gateway registerDocResidueReader 消费面）。 */
  private readonly vacuumingDocs = new Set<string>();
  private readonly docGeneration = new Map<string, number>();
  readonly docResidue = new Map<string, number>();
  /** T12 收口 I1：真空纪元代投影会话态（beginVacuumEra 定格——**DB 真值**〔readGeneration——复核
   *  残留 I1.2 修：旧进程内源未装载形态恒 0〕：target=当代+1〔4410 载荷与 vacuumTargetGeneration
   *  投影源——⑥ 复核源已改 vacuumCore ④ 装载读行值，era 定格值此后仅供载荷/target〕）。独立于
   *  docGeneration 生命周期：purge ③/afterUnload 不清（真空后半窗 purge 已跑，onConnected 真空窗
   *  close 4410 投影恒 1 的根修），setVacuuming(false)〔vacuum ⑦ finally——成功/失败/中止统一出口〕
   *  +projectsGone 兜底清理。 */
  private readonly vacuumEraGen = new Map<string, { current: number; target: number }>();
  /** 零连接窄版自动 vacuum 注入点（CollabShrinkService 构造期后置注入——gateway↔service 循环依赖
   *  最小形态：service 单向注入 gateway，gateway 经回调反向调用）。 */
  private vacuumRunner: ((pid: string) => Promise<unknown>) | null = null;
  /** Y0c T20（Z66 计数半边）：同 doc 上次自动 vacuum 触发时点——30s 窗（FROZEN_RECHECK_INTERVAL_MS
   *  ==VACUUM_QUIESCE_TIMEOUT_MS 叠加面）内二次触发=collab_vacuum_autotrigger_stacked_total 稳态 0
   *  （四稳态③判据面，check-collab-health Z122④ 消费）；purgeDocState ③ 清进程态同批清理。 */
  private readonly autoVacuumLastAt = new Map<string, number>();
  /** doc-status rev（装载播种 1——初值 0 会被客户端 rev 守卫丢首快照；卸载删除=新 epoch 复位） +
   *  上次广播态（翻转检测——T5 起为 {quota 态:writeFrozen} 复合键，rev 仅快照翻转时 ++）。 */
  private readonly docStatusRev = new Map<string, number>();
  private readonly docStatusState = new Map<string, string>();
  /** 冻结 doc 重测 timer（独立——禁挂 sweep：SWEEP_ENABLED=false 逃生阀不得静默关掉冻结出口） */
  private frozenRecheckTimer: ReturnType<typeof setInterval> | null = null;
  /** Y0b-4 T4（报告2 D）：进程级测量预算器——≤1 次/200ms+duty≤5%（最近 5s 累计 >250ms 拒） */
  private readonly truthBudgetState = { lastAt: 0, durs: [] as { at: number; ms: number }[] };
  /** Y0b-3 T4（spec §3.2）：卡住观测连续轮数+观测 timer（独立——不挂 startSessionSweep，
   *  SWEEP_ENABLED=false 逃生阀不得静默关掉观测）。RC3：heap 采样闸（heapPressureSample/
   *  overloadTripped/syncOverloadGauge）留 GW（W3b 迁 SG）——stuck 账目=doc 生命周期账目归 DR。 */
  private readonly docStuckRounds = new Map<string, number>();
  /** Y0b-5 T14（E54⑤）：yjs_doc_stuck_total 同增点计数字段（prom-client Counter 无同步读 API——
   *  同一 inc 点双计，computeDegraded.stuckDocs 同步可读；进程寿命累计口径与 Counter 一致）。
   *  公有=gateway computeDegraded 委托位读面（§1.3「stuckDocsSeen 读→DR 缝」）。 */
  stuckDocsSeen = 0;
  private heapObserverTimer: ReturnType<typeof setInterval> | null = null;
  /** Y0c T17（Z129）：常驻会话统一释放回调（CollabResidencyService 构造期经 gateway register* 公有
   *  注册点 1 行转发 attach——setVacuumRunner 同款反向注入形态：residency→gateway 单向依赖，DR 经
   *  回调触达）。pid=null ⇒ 全部常驻会话（drain/隔离出口）；单 pid ⇒ vacuum quiesce 每轮。
   *  RC1=B 组合持有：字段+释放入口所有权迁 DR（residency 文件/注册缝断言零触碰）。 */
  private residentSessionReleaser: ((pid: string | null, motive: TryReleaseMotive) => Promise<unknown>) | null = null;
  /** Y0c T18：residency 条目读面（hangReason resident-session-open 档判据——destroy race 失败时
   *  条目非空=步骤 0 预算/交接拒绝留 hold；residency 构造期注册，未注册〔直构 gateway〕=0）。 */
  private residentSessionsProbe: (() => number) | null = null;

  constructor(
    // 显式 @Inject token（esbuild 无 metadata 先例）；@Optional 双尾参真可选——gateway 直构传同实例
    // （pgBreaker 防脑裂+persistence 同实例=façade stubRepo/stubSpool 双写装置同一性前提），Nest 注入
    // 单例；quota 缺省=构造期 env 解析（B1 pgBreaker 缺省自建同款独立实例化自足——注入覆盖形态与
    // gateway 前文 :444-450 逐字一致，默认值唯一定义点单源 P3 保持）。
    @Inject(CanvasDocUpdateRepository) private readonly repo: CanvasDocUpdateRepository,
    @Inject(CollabPersistenceService) private readonly persistence: CollabPersistenceService,
    @Optional() @Inject(CollabPgBreakerService) pgBreaker?: CollabPgBreakerService,
    @Optional() quota?: Partial<QuotaConfig>,
  ) {
    this.pgBreaker = pgBreaker ?? new CollabPgBreakerService();
    // Y0b-4 T2：配额四值构造期一次读入（env 默认+注入覆盖——默认值唯一定义点，防双源 P3）；
    // msgRate/bytesRate 为速率闸常量（非 QUOTA_DEFAULTS 域——shared 七值只锁配额量纲）。
    this.quota = {
      maxDocBytes: parsePositiveInt(process.env.COLLAB_MAX_DOC_BYTES, QUOTA_DEFAULTS.maxDocBytes),
      maxTxBytes: parsePositiveInt(process.env.COLLAB_MAX_TX_BYTES, QUOTA_DEFAULTS.maxTxBytes),
      msgRate: parsePositiveInt(process.env.COLLAB_MSG_RATE_PER_CONN, 200),
      bytesRate: parsePositiveInt(process.env.COLLAB_BYTES_RATE_PER_CONN, 2_097_152),
      ...quota,   // 注入覆盖 env 默认
    };
    // Y1c T10（偏离 38⑤）：全局驻留字节上界（load 入口闸——默认 384MiB；residency reaper LRU 为
    // 回收面、本门为 Z55「拒载归 Y1c-3」入口闸——到顶新项目 onLoad 503）。
    this.maxResidentDocBytes = parsePositiveInt(process.env.COLLAB_MAX_RESIDENT_DOC_BYTES, 402_653_184);
  }

  /** Y1c T10：全局驻留 doc 真值字节和（docTruth+docDelta——零 encode 现成台账求和）。 */
  private readonly maxResidentDocBytes: number;
  residentBytesOverCap(): boolean {
    let sum = 0;
    for (const [pid, t] of this.docTruth) sum += t + (this.docDelta.get(pid) ?? 0);
    return sum >= this.maxResidentDocBytes;
  }

  /** host 后置绑定（B1 persistence.bindHost 同形先例）——业务方法消费前必 bind。 */
  bindHost(host: CollabDocRegistryHost): void {
    this.host = host;
  }

  /** RC1=B 组合缝：residency 释放回调/探针后置 attach（gateway register* 公有注册点 1 行转发——
   *  residency 构造器注册缝与 reaper spec :494-497 mock 断言零触碰）。 */
  attachResidencyReleaser(fn: (pid: string | null, motive: TryReleaseMotive) => Promise<unknown>): void {
    this.residentSessionReleaser = fn;
  }
  attachResidencyProbe(fn: () => number): void { this.residentSessionsProbe = fn; }

  /** T17 Z129：单会话释放转发（vacuum quiesce 三态空轮消费；未注册〔直构 gateway 无 residency〕=
   *  undefined——会话表概念不存在即「会话已不在」）。I-3 透传 residency tryRelease outcome 供 quiesce
   *  break 判据（released=静默达成）；拒绝（批在途/在用/交接失败）由 residency 侧计数——本转发不抛
   *  （quiesce 循环 deadline 兜底，回调异常归 undefined）。 */
  tryReleaseResidentSession(pid: string, motive: TryReleaseMotive): Promise<TryReleaseOutcome | undefined> {
    const op = this.residentSessionReleaser?.(pid, motive);
    return op ? op.then((r) => r as TryReleaseOutcome | undefined, () => undefined) : Promise.resolve(undefined);
  }
  /** T17 Z129：全部常驻会话释放转发（drain/隔离出口消费——释放出口先行，A2 :524 Σdirect===0 证明
   *  义务的载体；未注册=no-op）。 */
  async releaseAllResidentSessions(motive: TryReleaseMotive): Promise<void> {
    const op = this.residentSessionReleaser?.(null, motive);
    if (op) await op.catch(() => undefined);
  }
  /** T18 hangReason 判据读面（机械提取自 gateway shutdown :2612 内联表达式 `residentSessionsProbe?.()
   *  ?? 0`——未注册=0 语义逐字保持；Z81 destroy_timeout 三分型链消费）。 */
  probeResidentSessions(): number { return this.residentSessionsProbe?.() ?? 0; }

  /** Y0b-4 T8：配额只读出口——shrink service 消费（实例级构造注入覆盖 env 默认后的单源读点，
   *  防 service 侧自读 env 与 gateway 注入值漂移）。W3a：gateway 桶容量构造读面同源（activeQuota
   *  单源——quota 解析随域迁后防双源 P3）。 */
  get activeQuota(): QuotaConfig {
    return this.quota;
  }

  /** Y0b-4 T3（Q-B）：delta 触发器累加——update 监听唯一写者（T4 beforeSync hook 只读不写——
   *  快路径回写+监听同帧双加=delta 2× 速涨）。未建键（truth 播种前的装载期 replay/spool 帧
   *  apply）不计——防 truth+delta 双计播种内容；已清理（卸载后残留帧）同样跳过。
   *  Y0c T10（Z119②）：docDelta=客户端配额口径（Q-B 真值三件套插值）——服务端写事务
   *  （SERVER_TRANSACT_ORIGIN，withDoc 最外层注入）不计；判据只翻转服务端写分类
   *  （null/其他 origin 维持现行计数——防重新分类 replay/spool 帧）。
   *  W3a：原 gateway persistence.bindHost onUpdateDelta 接线体逐字迁此（persistence host 接口
   *  签名不变——gateway 侧接线改指 this.docRegistry.onUpdateDelta，承接账⑤ persistence 零回写）。 */
  onUpdateDelta(pid: string, bytes: number, origin: unknown): void {
    const delta = this.docDelta.get(pid);
    if (delta !== undefined && origin !== SERVER_TRANSACT_ORIGIN) this.docDelta.set(pid, delta + bytes);
  }

  /** spec 2.3：快照 + 增量按 (projectId, seq ASC) 重放。
   *  承重细节（spec v4 不变量 5/6，勿"简化"）：
   *  - 监听注册必须在第一个 await 之前——否则 DB 往返窗口内的写入静默漏收；
   *  - 禁止改用框架 onChange：document.onUpdate 在本 hook 返回后才注册，syncFromPeers 的更新永不触发 onChange；
   *  - replaying 抑制只包裹每个 applyUpdate 的同步段（yjs update 事件在事务清理期同步发放，不漏不误放），不跨 await；
   *  - stash 回灌必须在抑制窗口外：stash 是未落库变更，apply → update 事件 → pending → 下次 store 落库，
   *    禁止只 apply 不入队（等于二次蒸发）；
   *  - 不 return document：Hocuspocus 对 undefined no-op（doc 已就地填充）。
   *  批3-1：主体整体 try/catch——DB 异常统一折成 db-unavailable（带 reason 抛出），否则被库
   *  折成裸 permission-denied（F6：客户端无从分型瞬态/终态）。
   *  O0b-0 版本门 v2.1：唯一戳源=本 hook——replay 完成后四档门（戳=2 放行 no-op / 无戳∧零节点
   *  ⇒ stamp 自愈〔update 进 pending 落库——每 doc 至多一次幂等戳〕/ 戳=1 或 无戳∧有节点 ⇒ 拒
   *  〔logger.error+throw——DEV 抛/prod 拒+日志同条件不分路径（终裁 92 防鬼影）；throw 由
   *  Hocuspocus 折成连接错误拒绝载入该 doc，非崩溃进程〕）。 */
  async loadDocument({ document, documentName, socketId }: onLoadDocumentPayload) {
    if (!this.host.isServingState()) {
      throw Object.assign(new Error('collab lease not held'), { reason: CollabAuthReason.LEASE_NOT_READY });   // P0-1 三入口②（P1 正确性门——外层 catch 对带 reason 异常透传）
    }
    // Y0b-5 T16 docName 全匹配守卫（三入口②）：WS 与 DirectConnection 共经本钩子——别名 docName
    // 拒于 parseDocName 之前（别名执法分叉根修）。
    if (!isValidDocName(documentName)) {
      throw Object.assign(new Error('invalid doc name'), { reason: CollabAuthReason.INVALID_DOC_NAME });
    }
    // Y0b-5 T16 熔断面①（调用点②准入）：open 期拒新装载（503 COLLAB_NOT_SERVING 面——CollabNotServingFilter
    // 附 Retry-After；零 Prisma——防「每条新装载等满 5s 交互事务超时」）；half-open 放行=本次即探测。
    if (!this.pgBreaker.admitQuery()) {
      collabLoadRejectedTotal.inc({ reason: 'db-unavailable' });
      throw Object.assign(
        new ServiceUnavailableException({ code: 'COLLAB_NOT_SERVING', message: 'db-unavailable' }),
        { reason: CollabAuthReason.DB_UNAVAILABLE },
      );
    }
    // Y0b-4 T9a serving 门（装载面）：真空窗口拒装载（connected close 4410 的结构保证补位——
    // 竞态窗内 loadDocument 先于 connected 的库时序；REST withDoc 面由此折 503 COLLAB_NOT_SERVING）
    if (this.vacuumingDocs.has(parseDocName(documentName)?.projectId ?? '')) {
      throw Object.assign(
        new ServiceUnavailableException({ code: 'COLLAB_NOT_SERVING', message: 'doc-vacuuming' }),
        { reason: CollabAuthReason.LEASE_NOT_READY },   // 瞬态档（客户端 backoff 重连——真空窗口 ≤30s 上界）
      );
    }
    // Y0c T19（Z64② 生产守卫——spec §A2 目标形态 5）：卸载窗口拒新装载。unloadingDocuments 有该
    // name（公开字段 esm:166/:1271——窗口生命周期=库 unloadDocument 内部段 :1598 置键→:1600 清键，
    // 卸载了结即清=重试可达）时新装载=B 窗口第二实例风险面（旧实例在飞卸载 vs 新实例 hydrate——
    // 守卫唯一可达子窗=有键∧documents 无键：库 createDocument 对 existingDoc 早退不触发本钩子）。
    // 落点依据：与 vacuuming 门同列非真首行——前置到真首行会把拒绝优先级提到 P0-1 lease 正确性门
    // 之前（无租约进程误报 doc-unloading 而非 lease-not-ready，四门排列语义勿扰动）；两 doc 级瞬态
    // 窗门相邻=门族分层（进程级 lease→校验 docName→DB 级 pgBreaker→doc 瞬态窗 vacuuming/unloading
    // →资源 heap）。throw 形态=vacuuming 门同款 SUE+COLLAB_NOT_SERVING——CollabNotServingFilter 附
    // Retry-After（REST 面 503 语义化）；reason=瞬态档客户端 backoff 重连；WS 面 err.reason 透传进
    // PermissionDenied 帧不变（本 throw 在下方 try 外——不经 loadDocument 兜底 catch）。
    if (this.host.unloadingDocuments().has(documentName)) {
      yjsLoadUnloadingWindowTotal.inc();
      throw Object.assign(
        new ServiceUnavailableException({ code: 'COLLAB_NOT_SERVING', message: 'doc-unloading' }),
        { reason: CollabAuthReason.LEASE_NOT_READY },
      );
    }
    // Y0b-3 T4 heap 闸（三入口汇聚点·WS/DirectConnection/REST withDoc——lease 门后）：仅拒新物化。
    // 可达性：库 createDocument 在 onLoadDocument hook 返回后才 documents.set（esm:1438）——hook 内
    // 对新 doc 恒 !has=两面可达；重放/复用窗（has=true）放行防自伤。throw 形态=SUE 带
    // code='COLLAB_NOT_SERVING'——CollabNotServingFilter 只认 body.code 才附 Retry-After: 2（REST
    // 面 503 语义化；字符串形态落 fallback 无 Retry-After=T9 retryAfter 消费静默降级）。WS 面
    // err.reason 透传进 PermissionDenied 帧不变（本 throw 在 try 外——不经 loadDocument 兜底 catch）。
    if (!this.host.documents().has(documentName) && this.host.heapPressureSample().tripped) {
      collabLoadRejectedTotal.inc({ reason: 'server-overloaded' });
      throw Object.assign(new ServiceUnavailableException({ code: 'COLLAB_NOT_SERVING', message: 'server overloaded' }), { reason: CollabAuthReason.SERVER_OVERLOADED });
    }
    // Y1c T10（偏离 38⑤ maxResidentDocBytes）：全局驻留字节上界——到顶拒**新项目**装载（503 档——
    // REST 面 CollabNotServingFilter 附 Retry-After；WS 面 err.reason 透传 PermissionDenied 帧重连退避
    // 〔4413 maintenance-freeze close 档归 T27 维护状态机——本门先落 load 拒绝事实面〕）。已装载 doc
    // 恒放行（重放/复用窗自伤防护——heap 闸同判据）；存量回收=residency reaper LRU（字节主序——
    // enforceResidentBudgets 既有面，「到顶拒载」补 Z55「拒载归 Y1c-3」的入口闸）。
    if (!this.host.documents().has(documentName) && this.residentBytesOverCap()) {
      collabLoadRejectedTotal.inc({ reason: 'resident-bytes-cap' });
      throw Object.assign(new ServiceUnavailableException({ code: 'COLLAB_NOT_SERVING', message: 'resident docs over cap' }), { reason: CollabAuthReason.SERVER_OVERLOADED });
    }
    const projectId = parseDocName(documentName)?.projectId ?? '';
    const loadT0 = Date.now();   // Y0b-5 T10：装载耗时（拒绝早退不计时——只测 hydrate+replay+播种段）
    const heapBefore = this.heapUsedNow();   // Y0b-5 T10：装载边界 heap 倍率前采样
    try {
      // Y11+B1（T40）：队列 get-or-create+docProject 播种+update 监听注册=persistence.observeDocument
      // （原 :1104-1134 内联块整体提取——数组身份恒定/push-only/软阈闩锁语义逐字随迁；delta 累加经
      // host.onUpdateDelta 回接线）；docEpoch 播种=DocRegistry 域（B1 时「留 gateway」注记——W3a 随域
      // 落位本文件；与 observeDocument 相互独立写面，先后序不可观测）。监听注册仍在装载第一个 await
      // 之前（spec v4 不变量 5 时序保持）。
      if (!this.docEpoch.has(document)) this.docEpoch.set(document, Date.now());
      this.persistence.observeDocument(document, projectId, documentName);
      const applyReplayed = (u: Uint8Array) => this.persistence.withReplaySuppressed(document, u);
      // 批3-4：compact 时间门限基线播种（首次 load 起算 60s 窗——B1 随域迁 service）
      this.persistence.seedCompactBaseline(projectId);
      // Y0a-1：装载读唯一入口（契约 §4.3-1）+超时自愈（契约 §4.3-13·仅可重试类）
      const { state, updates, generation, schemaVersion, pgSeq } = await this.repo.hydrateWithRecovery(projectId);
      // T18 版本硬切（Y1b T2/Y1c，Z9''-v14）：meta 门 v2.1 整链退役——版本判据唯一承载=
      // CanvasDoc.schemaVersion PG 列（readConsistent 行值单源）。行值≠current ⇒ 拒载（旧 doc 档
      // 无迁移，禁垫片）；行缺失 null ⇒ 放行（懒建档——首 store 建行 @default(3)）。
      // 评审 P2#5：判于行读取后**立即**（replay 前——旧档不付 state/updates/spool 重放成本）。
      if (schemaVersion != null && schemaVersion !== CANVAS_DOC_SCHEMA_VERSION) {
        this.host.logger.error(
          `[T18] 版本门拒绝载入 ${documentName}：CanvasDoc.schemaVersion=${schemaVersion} ≠ current ${CANVAS_DOC_SCHEMA_VERSION}（PG 列判定——旧 doc 档拒载，无迁移）`,
        );
        // schemaRefusal 标记+reason（E56 断链修复惯例）：外层 catch 透传（版本门拒≠db-unavailable——
        // 库 esm:939 透传 error.reason，客户端 authenticationFailed → handleVersionTerminal 一次 reload）。
        throw Object.assign(
          new Error(`DOC_SCHEMA_STALE: CanvasDoc.schemaVersion=${schemaVersion} ≠ current ${CANVAS_DOC_SCHEMA_VERSION}——拒载（版本硬切批无迁移）`),
          { schemaRefusal: true, reason: CollabAuthReason.SCHEMA_OUTDATED },
        );
      }
      // Y1c T12（偏离 27/E23 双校验②——onAuthenticate 为①）：docName 世代准入。装载读行值单源
      // （generation=CanvasDoc PG 列真值；行缺失=0〔懒建档〕）——canonical 形不符 ⇒ generationRefusal
      // 拒载（先于 state/updates/spool apply：不装载不 SS1 不上行——S2 复活链在装载面结构性关闭）。
      // auth 缝（SessionGuard.authenticateInner DB 段）同谓词前置执法；本处=防御第二道（Direct/竞态窗）。
      const dbGeneration = generation ?? 0;
      const admission = admitDocNameForGeneration(documentName, dbGeneration);
      if (!admission.ok) {
        throw Object.assign(
          new Error(`DOC_GENERATION_STALE: docName=${documentName} 世代段≠DB generation=${admission.generation}（真空换代后旧世代名——拒载；恢复=携 #g${admission.generation} 重连）`),
          { generationRefusal: true, reason: CollabAuthReason.GENERATION_STALE },
        );
      }
      // T12 真值链（DR:403 缝修复）：docGeneration 恒播种当代真值——含 0（旧 `if (generation)` truthy
      // 门使未换代项目永不播种 ⇒ spool 帧世代缺省 1 × CanvasDoc.generation=0 分叉 ⇒ compact ② 代辖
      // 滤除增量行=真空纪静默丢数据链）。docGeneration 三消费面：actor 准入链世代权威（generationOf）/
      // doc-status 顶层 generation/liveDocName 内部寻址（#g canonical wire 名）。
      this.docGeneration.set(projectId, dbGeneration);
      // Y1c T9（T8 接线）：世代权威播种缝——gateway 转发 spool.setProjectGeneration（帧内一律
      // 携带 generation 的 WAL 段单源；vacuum 换代=switchGeneration 显式切+此处装载重播）
      this.host.onGenerationSeeded?.(projectId, dbGeneration);
      // C1①（T11 双评审 Critical）：walSeq 计数器 PG 真值播种（max 语义——幸存段承载未落 PG 帧时
      // scan 重建值更高不回拨）。行缺失（懒建档）pgSeq=null 缝自 no-op。红链与双保险全貌见
      // canvas-doc-walseq-seeding.int.spec 头注。
      if (pgSeq != null) this.host.onWalSeqFloorSeeded?.(projectId, pgSeq);
      if (state) applyReplayed(new Uint8Array(state));
      for (const u of updates) applyReplayed(new Uint8Array(u));
      // Y0a-2：stash=spool 帧（peek→apply；帧不删——confirm 恒在 append 成功后，契约 12）。
      // apply 事件进 pending（窗口外回灌）；帧的 confirm 出口=下次 store 提前 drain / 断连 flush / 启动回灌。
      // Y0b-4 T3：帧数组显式持有——spool 字节计入 cheap 上界（帧在装载窗内，测量点必须在其后）。
      const spoolFrames = await this.persistence.peekSpoolFrames(projectId);
      for (const f of spoolFrames) Y.applyUpdate(document, f.payload);
      // T18（Z4''-v14）：order 病理装载档扫描（挂点选型见 collab-pathology.ts 头注——replay 完成
      // 后判；容忍不 500，计数+告警）。
      observeOrderPathologyOnLoad(this.host.logger, documentName, toReadModel(document).nodes);
      // Y0b-4 T3（Q-B 白名单点①）：docTruth 真值单变量播种——cheap 上界=|state|+Σ|updates|+Σspool
      // （state+updates+spool 帧全部 apply 之后算）；<softLimit 直接当 truth 跳过编码（上界≥真值=
      // 保守正确，99% 装载零新增成本）；≥softLimit 才付费实测 encodeStateAsUpdate（apply 即 GC——
      // 实测值≤求和值）。docDelta 归零+truthMeasuredAt 播种（冷却窗基线，T4 判据④消费）。
      const cheap = (state?.length ?? 0) + updates.reduce((n, u) => n + u.length, 0)
        + spoolFrames.reduce((n, f) => n + f.payload.byteLength, 0);
      const softLimit = Math.floor(this.quota.maxDocBytes * QUOTA_DEFAULTS.softEnterRatio);
      const seeded = cheap < softLimit ? cheap : Y.encodeStateAsUpdate(document).byteLength;
      this.docTruth.set(projectId, seeded);
      this.docDelta.set(projectId, 0);
      this.truthMeasuredAt.set(projectId, Date.now());
      // Y0b-5 T10 锚①装载播种：直方图 observe 既有播种值（零新增编码）+装载边界 heap 倍率
      // （heapUsed 差÷编码字节——GC 时延噪声只记正差，合成值待标定）。
      this.observeDocBytes(seeded);
      const heapDelta = this.heapUsedNow() - heapBefore;
      if (heapDelta > 0 && seeded > 0) yjsDocHeapAmplification.set(heapDelta / seeded);
      // Y0b-4 T4：docStatus rev 播种 1（DOC_STATUS_REV_SEED——初值 0 会被客户端 rev<=last 守卫丢首快照；
      // afterUnload 删除=重装载复位新 epoch——authenticated 时刻客户端 lastDocStatusRev 复位归 T10）
      if (!this.docStatusRev.has(projectId)) this.docStatusRev.set(projectId, DOC_STATUS_REV_SEED);
      // Y0b-4 T3（Q-O v5）：pendingStructs/pendingDs 双查断言——装载不拒任何行（病态行已入库=读它
      // 是唯一看到内容的途径；产生侧已对齐=结构性不可产生，此为防御），但跳行降级必须可观测：
      // 计数分列（只含删除的跳行仅触发 pendingDs 不触发 pendingStructs——两独立字段）+ERROR+degraded。
      const deferredField = document.store.pendingStructs !== null ? 'structs'
        : document.store.pendingDs !== null ? 'ds' : null;
      if (deferredField !== null) {
        collabHydrationDeferredTotal.inc({ field: deferredField });
        this.host.logger.error(`hydration deferred (${deferredField}): ${documentName}——因果链丢失可观测（Q-O 不拒行）`);
        this.degradedDocs.add(projectId);   // 快照/健康面可见——降级成为可观测状态非沉默
      }
      // Y0a-2：consumeStash 已退役——帧保留至 append 成功（confirm 恒在成功后，契约 12）
      this.pgBreaker.recordSuccess();   // Y0b-5 T16：装载成功=PG 健康样本（half-open 成功=探测成功→closed）
      yjsDocLoadTotal.inc({ trigger: consumeDirectLoad(projectId) ? 'direct' : 'ws' });   // Y0c T0（Z3）：物化装载单点（成功路径——拒绝早退不计；开窗标记消费=direct，否则 ws）
    } catch (err) {
      if ((err as { schemaRefusal?: boolean })?.schemaRefusal) throw err;
      if (err instanceof Error && (err as Error & { reason?: CollabAuthReasonCode }).reason) throw err;
      this.pgBreaker.recordFailure(err);   // Y0b-5 T16：装载失败=PG 健康采样（连接族推闸；schema 门/已分型异常早退不算）
      captureCollabException(err, { docName: documentName, reason: 'load-db-unavailable', connectionId: this.host.connectionIdOf(socketId) ?? '-' });   // T11：装载失败样本（auth 先于 load——socketId 有实值）
      throw Object.assign(new Error(`db unavailable: ${(err as Error).message}`), { reason: CollabAuthReason.DB_UNAVAILABLE });
    } finally {
      yjsLoadDuration.observe((Date.now() - loadT0) / 1000);   // Y0b-5 T10：时长面（成功/失败均计时）
    }
  }

  /** Y0a-2（V10/V11）项目消失终态的 DR 域清理子步（机械提取自 gateway handleProjectsGone :1139-1157
   *  ——B1 persistence.onProjectGone 同款提取；事件编排壳留 gateway，V11 禁慢操作纪律在壳）。
   *  truth/冻结/代际族 15 容器清理（14 键+vacuumingDocs 专属兜底——W2 穷举单测 D3 逐键钉死）。 */
  onProjectGoneStateCleanup(projectId: string): void {
    // Y0b-4 T3：truth 族+降级标记清理（真终态——无守卫直删，与 lastCompactAt 同点）
    this.docTruth.delete(projectId);
    this.docDelta.delete(projectId);
    this.truthMeasuredAt.delete(projectId);
    this.degradedDocs.delete(projectId);
    // Y0b-4 T4：冻结族同点清理（含确认定时器——防终态后迟到 fire）
    this.quotaFrozenDocs.delete(projectId);
    this.freezePending.delete(projectId);
    const pendingTimer = this.freezePendingTimers.get(projectId);
    if (pendingTimer) { clearTimeout(pendingTimer); this.freezePendingTimers.delete(projectId); }
    this.recheckRounds.delete(projectId);
    this.thawCooldown.delete(projectId);
    this.docStatusRev.delete(projectId);
    this.docStatusState.delete(projectId);
    // Y0b-4 T9a：代际/残留族同点清理（项目终态——与 afterUnload 同族）；Y1c T12：preVacuumSv 缓存
    // 随 SV 代际门退役删除（偏离 27——列 Drop 同批迁移 20261024160000）
    this.docGeneration.delete(projectId);
    this.docResidue.delete(projectId);
    this.vacuumingDocs.delete(projectId);   // 真空窗口中项目消失的兜底（service finally 也删——双保险）
    this.vacuumEraGen.delete(projectId);   // T12 收口 I1：纪元代投影同点兜底（普查表行）
  }

  /** Y0b-5 T10：yjs_doc_bytes 直方图单点 observe（三锚共用——超阈计数同点；锚外禁调）。
   *  gateway 侧两锚=装载播种/compact；shrink 锚在 CollabShrinkService（白名单点③同一编码）。 */
  observeDocBytes(bytes: number): void {
    yjsDocBytes.observe(bytes);
    if (bytes > DOC_BYTES_OVER_THRESHOLD_BYTES) yjsDocBytesOverThresholdTotal.inc();
  }

  /** Y0b-5 T10：heapUsed 采样单点（装载/卸载边界——合成值待标定；独立方法=测试 spy 缝） */
  private heapUsedNow(): number {
    return process.memoryUsage().heapUsed;
  }

  /** Y0b-5 T10：top-N doc 结构日志——数据源=docTruth+delta（与直方图三锚同一数据源，零 encode：
   *  病态 doc 全量重编≈75× 风暴，本方法只读既有 Map）；「哪个项目病态」的 E54 基调出口。 */
  logDocTopN(): void {
    const entries = [...this.docTruth.keys()]
      .map((pid) => ({ project: pid, bytes: (this.docTruth.get(pid) ?? 0) + (this.docDelta.get(pid) ?? 0) }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, TOPN_LOG_LIMIT);
    if (entries.length === 0) return;
    this.host.logger.log(JSON.stringify({ event: 'yjs_doc_topn', docs: entries }));
  }

  /** Y0b-4 T8 外审修复（Concern ①）+T9 收窄：配额**真冻结**判定（quotaFrozenDocs——与 readOnly
   *  同一 setImmediate 落地的正式冻结集；freezePending 确认窗不算——T8 外审 Minor：确认窗内
   *  shrink 达标不 thaw，pending 定时器自收敛〔到期实测<soft→calibrate+broadcast ok〕，无 enter
   *  不出 exit=计数配对不虚高）。消费=shrink thaw 前置；广播态域（quotaStateOf==='over'=冻结∪
   *  确认）与冻结判定域分立，禁混用。 */
  isQuotaFrozen(pid: string): boolean {
    return this.quotaFrozenDocs.has(pid);
  }

  /** Y0b-4 T8 外审修复（偏差③）：force 广播公共出口——shrink 成功未 thaw（滞回带/未冻结）时其他
   *  客户端 localDocBytes 需要新 truth；dedup 键 {state}:{frozen} 不含 bytes，state/frozen 未变
   *  会被吞。state 取 quotaStateOf 现值（调用方无需感知态）。 */
  broadcastDocStatusForce(pid: string): void {
    this.broadcastDocStatus(pid, this.quotaStateOf(pid), true);
  }

  /** Y0b-4 T3：真值校准单点（compact 成功+pending 空 / T8 shrink 校准复用——T8 起公共方法）——
   *  truth 覆写+delta 归零+冷却窗基线重置。未装载/已清理（无 docTruth 键）不复活条目——
   *  afterUnloadDocument 清理语义保持。
   *  Y0b-4 T8 外审修复（偏差③）：返回校准前 truth（无键=undefined）——shrink 消费判定
   *  "truth 实际变化"决定 force 广播（无变化不广播=dedup 语义反而正确）。 */
  calibrateTruth(projectId: string, bytes: number): number | undefined {
    const prev = this.docTruth.get(projectId);
    if (prev === undefined) return;
    this.docTruth.set(projectId, bytes);
    this.docDelta.set(projectId, 0);
    this.truthMeasuredAt.set(projectId, Date.now());
    return prev;
  }

  /** ===== Y0b-4 T9a（Q-U v6）：vacuum 代际替换——DR 侧（serving 门/纪元开启/清态/重建） ===== */

  /** serving 门读点（REST withDoc/readServerSV/readCanvas/writeExecStatus 同挂〔U-3/G-7〕+
   *  WS connected 钩子+loadDocument 三入口）。 */
  isVacuuming(pid: string): boolean {
    return this.vacuumingDocs.has(pid);
  }

  /** serving 门写点（service vacuumGate.runExclusive 内 add/finally delete——真空窗口=协议执行期）。
   *  T12 收口 I1：off=真空完成（成功/失败/中止统一出口）——纪元代投影会话态同点清（非真空期
   *  vacuumTargetGeneration 回落装载真值链投影）。 */
  setVacuuming(pid: string, on: boolean): void {
    if (on) this.vacuumingDocs.add(pid);
    else { this.vacuumingDocs.delete(pid); this.vacuumEraGen.delete(pid); }
  }

  /** 零连接窄版自动 vacuum 注入（service 构造期调用——recheckFrozenDocs 判据链消费）。 */
  setVacuumRunner(fn: (pid: string) => Promise<unknown>): void {
    this.vacuumRunner = fn;
  }

  /** docResidue 现值（skip-low-residue 判据源——recheck≥2 轮维护）。 */
  docResidueOf(pid: string): number {
    return this.docResidue.get(pid) ?? 0;
  }

  /** 纪元代开启（service vacuum ⓪①② 调用）：② serving 门先开（close 后新连接即被拦——竞态窗
   *  关闭）→⓪ thaw 回灌（U-5：冻结期客户端编辑靠 SyncStep1 回灌保命——vacuum 直接 close=真丢；
   *  收敛窗=RTT+debounce+store 上界，超时尽力继续〔残余在途帧由 close 语义+terminal reload 接住〕）
   *  →① freeze 全连接（applyWriteFreeze 单源——close 前拦截在飞写帧）+**4410 close 载荷先行**
   *  （Y1c T12：{code:4410, reason:'doc-vacuuming', generation:<目标代>, discardLocalCache:true}
   *  stateless 通告——契约 CollabY1cClosePayload 4410 档；客户端链=export-draft-then-clear+
   *  携新世代重连（T25 消费；WS close reason ≤123B 载不动结构化载荷——stateless 先行+close 权威
   *  投递两段式，auth-receipt 同款形态））+terminal close 4410 'doc-vacuuming'。
   *  目标代=当代+1（vacuumGate 并发 1+generation 唯一写点=vacuumReplace 事务——投影无竞态；
   *  ⑥ vacuumReplace 锁内实读复核，漂移即整体中止 DB 零变更）。 */
  async beginVacuumEra(pid: string): Promise<void> {
    this.vacuumingDocs.add(pid);
    // I1+复核残留 I1.2 修：纪元开启即定格代投影（先于 thaw/settle——beginVacuumEra 全程可用）。
    // 定格源=DB 真值（repo.readGeneration 单行 PK 读——行缺失折 0=懒建档）：旧源 docGeneration.get
    // (pid)??0（进程内）在 doc 未装载形态（REST 显式 vacuum 不要求装载——gen≥1 项目重启后首次/
    // 同进程第二次〔purge ③ 后 docGeneration 已清〕）投影恒 0 ⇒ ⑥ expectedGeneration≠DB=永久
    // generation-drift 中止+4410 载荷 target 错（=1 非真代+1）；装载形态 DB 读与 docGeneration
    // 等值（装载播种自 DB）——投影源直接替换，不保留进程内 fallback（根修禁双源）。真空期 generation
    // 唯一写点=vacuumReplace 事务（装载被 vacuuming 门拒）=投影无竞态前提保持。
    const dbGen = (await this.repo.readGeneration(pid)) ?? 0;
    this.vacuumEraGen.set(pid, { current: dbGen, target: dbGen + 1 });
    if (this.quotaFrozenDocs.has(pid)) {
      this.thawQuota(pid);
      const deadline = Date.now() + VACUUM_THAW_SETTLE_MS;
      while (!this.persistence.writesSettled(pid) && Date.now() < deadline) {   // B1：三态收敛谓词随域迁 service（pending 空+spool 无帧+无在飞——Z104 同口径注释见彼处）
        await new Promise((r) => setTimeout(r, VACUUM_QUIESCE_POLL_MS));
      }
    }
    const document = this.host.documents().get(this.liveDocName(pid));
    const targetGeneration = this.vacuumTargetGeneration(pid);
    if (document) {
      for (const c of [...document.connections.keys()]) {
        const conn = c as unknown as CollabConnection;
        this.host.applyWriteFreeze(conn, 'quota', true);
        try {
          conn.sendStateless?.(JSON.stringify({
            code: 4410, reason: DOC_VACUUMING_TERMINAL_REASON,
            generation: targetGeneration, discardLocalCache: true,
          }));
        } catch { /* 已断——载荷尽力，close 权威投递仍在 */ }
        this.host.hardClose(conn, CollabCloseCode.GENERATION_SUPERSEDED, DOC_VACUUMING_TERMINAL_REASON);
      }
    }
  }

  /** ③ 清进程态=共享状态普查表（v6：防旧代记账污染新代——vacuum 完成后所有按 pid 键控 Map/Set
   *  均无该键的断言测试守卫）。writeFreeze 条目经 host.releaseFreezeForDoc 缝逐原因解除（readOnly
   *  复位+conn-status 推送——禁绕过单源直删连接态；循环体=gateway/SG 侧逐字平移）；overPush 键
   *  =socketId——经缝返回的 socketId 连带清（条目 pid 反查语义在缝实现内保持）。 */
  purgeDocState(pid: string): void {
    this.docTruth.delete(pid);
    this.docDelta.delete(pid);
    this.truthMeasuredAt.delete(pid);
    this.degradedDocs.delete(pid);
    this.quotaFrozenDocs.delete(pid);
    this.freezePending.delete(pid);
    const pendingTimer = this.freezePendingTimers.get(pid);
    if (pendingTimer) { clearTimeout(pendingTimer); this.freezePendingTimers.delete(pid); }
    this.recheckRounds.delete(pid);
    this.thawCooldown.delete(pid);
    this.docStatusRev.delete(pid);
    this.docStatusState.delete(pid);
    this.docGeneration.delete(pid);
    this.docResidue.delete(pid);
    this.autoVacuumLastAt.delete(pid);   // Y0c T20（Z66）：自动触发时点台账同批清（pid 键控普查表）
    this.persistence.purgePersistenceState(pid);   // B1：lastCompactAt+persistUnhealthy 清账随域迁 service（普查表 Persistence 行）
    for (const socketId of this.host.releaseFreezeForDoc(pid)) this.overPush.delete(socketId);
    this.persistence.recycleEmptyQueue(pid);   // 空队列条目回收（M6 同款——quiesce 已保证空；原位保持=writeFreeze 解除之后）
  }

  /** 中止恢复（v6 报告3 P1-2：中止路径 503 永久+全员只读=比不 vacuum 更糟——不允许存在）：
   *  ③purge 后到达=幂等 no-op；①②间中止（beginVacuumEra 异常窗）=writeFreeze 条目解除 quota+
   *  冻结族清（③未达时的兜底）。 */
  abortVacuumRestore(pid: string): void {
    this.quotaFrozenDocs.delete(pid);
    this.freezePending.delete(pid);
    const pendingTimer = this.freezePendingTimers.get(pid);
    if (pendingTimer) { clearTimeout(pendingTimer); this.freezePendingTimers.delete(pid); }
    this.host.releaseFreezeForDoc(pid, 'quota');
  }

  /** ④ 全根真空重建（vacuum service 与 recheck residue 评估共用单源）：按 doc.share 枚举——
   *  nodes/edges → toReadModel+fillDoc（records 真值重放——墓碑/GC 壳/delete set 不随行；Y1c T4
   *  起读侧改道 doc-codec toReadModel）；
   *  其余 Y.Map 根（exec/meta/未来新增）→ 逐 key 深拷贝（未来新增根 map 不可能被静默丢弃〔U-2〕）；
   *  T18 起 meta 零键（版本=PG 列——深拷贝=透明搬运；旧档残留值随拷贝保留为历史载荷不解释）；
   *  非 Map 根（Y.Text 等）⇒ null（vacuum 不支持——降级导出通道，DB 零变更）。
   *  ⚠ yjs wire 根类型事实（实测 13.6.32）：applyUpdate 重建的 doc.share 根=AbstractType 占位
   *  （根类型不随 wire 承载——由访问侧 getMap/getText 声明）；序列型内容（Text/Array）挂占位
   *  ._start 链表。判定=非 Y.Map 实例且 _start 非空 ⇒ 非 Map 根；空根（无内容）按 Map 重建——
   *  内容无损。 */
  rebuildVacuumDoc(source: Y.Doc): Y.Doc | null {
    for (const root of source.share.values()) {
      const r = root as unknown as { _start?: unknown };
      if (!(root instanceof Y.Map) && r._start != null) return null;   // Text/Array 序列内容 ⇒ unsupported-root（wire 占位判定——见头注 yjs 根类型事实）
    }
    const fresh = createCanvasDoc();
    try {
      const records = toReadModel(source);   // 读侧建 nodes/edges 根（与 fillDoc 对称——根集合守恒；Y1c T4 改道 doc-codec）
      fillDoc(toDocLike(fresh), records.nodes, records.edges);
      fresh.transact(() => {
        for (const [name] of source.share) {
          if (name === 'nodes' || name === 'edges') continue;
          deepCopyYMap(source.getMap(name), fresh.getMap(name));   // getMap 规约化（占位→YMap 视图——服务端访问语义）
        }
      });
      return fresh;
    } catch (e) {
      fresh.destroy();
      throw e;
    }
  }

  /** ⑤ 等价断言扩全根（把信任 fillDoc 变成验证 fillDoc）：readRecords 深比+根类型集合相等
   *  +exec 键集合相等（三条 O(键数)——U-1/U-2 直接检测）。T18：meta.schemaVersion===current
   *  检查随版本移 PG 列退役（行值不随 vacuum 变）；JSON 序列化对比（键序=遍历序稳定）。 */
  vacuumEquivalent(oldDoc: Y.Doc, newDoc: Y.Doc): boolean {
    // 三常驻根规约化（装载路径同款——根集合对称口径；空源 doc 键集合口径由此对称）。
    // T18：meta 规约化删除——legacy 根两侧自然对称（source 有 ⇒ fresh 深拷贝亦有；无 ⇒ 双无；
    // 单侧 getMap 建根=制造形状差〔stamp 退役后装载不再建 meta——equivalence-failed 根因〕）。
    oldDoc.getMap('nodes'); oldDoc.getMap('edges');
    const shapeOf = (d: Y.Doc) => [...d.share.keys()].sort().join('|');   // 根键名集合（wire 占位与本地实例 constructor 不可比——类型保型由 rebuild 判定结构性保证）
    if (shapeOf(oldDoc) !== shapeOf(newDoc)) return false;
    if (JSON.stringify(toReadModel(oldDoc)) !== JSON.stringify(toReadModel(newDoc))) return false;
    if ([...oldDoc.getMap('exec').keys()].sort().join('\x00') !== [...newDoc.getMap('exec').keys()].sort().join('\x00')) return false;
    return true;
  }

  /** ===== Y1c T9：guardSyncFrame 收编重写（collab-frame-gate.service——偏离 38③）。本域保留
   *  配额判定/冻结族/overPush 台账（RC2=A：DR 单一所有者），两收编面如下（分层序注释随 gate 服务）：
   *  ① readOnly 丢帧计数+overPush 升级=noteReadOnlyDrop（actor ⓪ 消费）；
   *  ②③④ 配额判定=admitFrameQuota（gate 消费——over 短路/f快路径/账面实测+冻结决策）。
   *  Y1c T12：preVacuumSv 读面（preVacuumSvOf）随 SV 代际门退役删除——世代执法改道 docName 段
   *  （admitDocNameForGeneration auth/load 双校验，偏离 27）。 ===== */

  /** Y1c T12：世代 canonical wire 名读面（内部寻址单源——库 documents Map 键）。docGeneration
   *  装载播种（真值链）→已装载 doc 恒命中 canonical 名；未装载/已卸载（docGeneration 无键）折裸名
   *  =gen0 canonical（documents 无实例=结构性 miss，语义不变）。消费面=freeze/thaw/broadcast/
   *  vacuum 族查活 doc+gateway isDocResident+actor/SG/persistence 同名（E23 内部寻址连带）。 */
  liveDocName(pid: string): string {
    return canvasDocName(pid, this.docGeneration.get(pid) ?? 0);
  }

  /** Y1c T12：vacuum 目标代（4410 doc-vacuuming 载荷源——beginVacuumEra/onConnected 真空窗 close
   *  共用）：真空纪元内=beginVacuumEra 定格投影（I1——purge ③ 删 docGeneration 后半窗不漂移）；
   *  纪元外=当代真值+1（vacuumGate 并发 1+generation 唯一写点=vacuumReplace 事务=投影无竞态；
   *  ⑥ 锁内实读复核漂移即整体中止 DB 零变更）。 */
  vacuumTargetGeneration(pid: string): number {
    const era = this.vacuumEraGen.get(pid);
    if (era !== undefined) return era.target;
    return (this.docGeneration.get(pid) ?? 0) + 1;
  }

  /** T12 收口 I1.2：真空纪元当代/target 读面（beginVacuumEra 定格值——DB 真值；purge ③ 后
   *  docGeneration 无键仍可读；非真空期=undefined 调用方折 0）。复核残留 I1.2 修：vacuumCore ⑥
   *  expectedGeneration 源已改 ④ loadForHydration 行值（复核窗口最小化 ④→⑥）——era 定格值此后
   *  仅供 4410 载荷与 target 投影。 */
  vacuumEraGeneration(pid: string): { current: number; target: number } | undefined {
    return this.vacuumEraGen.get(pid);
  }

  /** Y1c T12（E23 双校验①——auth 面世代准入读面）：CanvasDoc.generation DB 真值（契约 1——
   *  CanvasDoc 读单源在 repository.readGeneration；行缺失=null〔懒建档——调用方折 0=裸名 canonical〕）。
   *  面判据 `typeof readGeneration`：极简 repo 桩（直构 spec 形态）缺面=返回 null=裸名放行
   *  ——load 面〔DR.loadDocument 装载读行值〕第二道恒在（双校验降级单校验非无校验）。 */
  async generationInDb(pid: string): Promise<number | null> {
    if (typeof this.repo.readGeneration !== 'function') return null;
    return this.repo.readGeneration(pid);
  }

  /** Y1c T9：世代权威读面（actor 准入链 ① 每帧对照——docGeneration 装载播种/vacuum 换代刷新，
   *  undefined=未装载未知〔首帧前〕）。 */
  generationOf(pid: string): number | undefined {
    return this.docGeneration.get(pid);
  }

  /** ① readOnly 丢帧计数+per-conn 持续强推升级判定（原 guardSyncFrame ① 段收编——actor ⓪ 短路面
   *  消费；返回 true=升级 4404 关闭〔Q-D v5/v6 双窗判据〕）。计数在①不在②——冻结落地后帧进此。 */
  noteReadOnlyDrop(conn: CollabConnection, pid: string, bytes: number): boolean {
    const reasons = this.host.freezeReasons(conn);
    collabQuotaWritesDroppedTotal.inc({ reason: reasons.has('quota') ? 'quota' : reasons.has('draining') ? 'draining' : reasons.has('spool') ? 'spool' : 'viewer' });
    if (!reasons.has('quota')) return false;
    const sid = conn.socketId ?? '';
    const st = this.overPush.get(sid) ?? { count: 0, bytes: 0, firstAt: Date.now(), lastAt: Date.now() };
    if (Date.now() - st.lastAt > OVER_PUSH_IDLE_RESET_MS) { st.count = 0; st.bytes = 0; st.firstAt = Date.now(); }
    st.count += 1; st.bytes += bytes; st.lastAt = Date.now();
    this.overPush.set(sid, st);
    const escalate = (st.count >= OVER_PUSH_COUNT || st.bytes >= 2 * this.quota.maxTxBytes) && Date.now() - st.firstAt >= OVER_PUSH_WINDOW_MS;
    if (escalate) {
      // Q-M4（旧链语义补回）：升级 4404 关闭前 doc-status stateless 先行通告——客户端收终态码前先
      // 得配额真相（自救面；原 guardSyncFrame ① 升级位同款 try 尽力，通告失败不阻关闭）
      try { conn.sendStateless?.(JSON.stringify(this.buildDocStatus(pid))); } catch { /* 先通告尽力 */ }
    }
    return escalate;
    // 复位只在 thawQuota（freeze 重入不清零）；内容靠 thaw 回灌（库交 SyncStatus(false)——客户端零动作）
  }

  /** ②③④ 配额判定（原 guardSyncFrame ②③④ 段收编——gate 消费；行为零变化平移）：
   *  ②over 短路（冻结面零编码）→'frozen'；③快路径 O(1)（hook 只读 delta 不回写——update 监听唯一
   *  写者）→'ok'；④账面触阈（冷却窗内上界决策/窗外实测+冻结决策〔Q-S：硬限首触=冻结+放行本帧，
   *  禁静默丢合法帧〕）→'ok'（触发帧照常放行——冻结落地=freezeQuota setImmediate 窗）。 */
  admitFrameQuota(pid: string, bytes: number, document: Y.Doc): 'ok' | 'frozen' {
    if (this.quotaFrozenDocs.has(pid)) return 'frozen';
    const truth = this.docTruth.get(pid) ?? 0;
    const delta = this.docDelta.get(pid) ?? 0;
    const soft = Math.floor(this.quota.maxDocBytes * QUOTA_DEFAULTS.softEnterRatio);
    if (truth + delta + bytes <= soft) { collabQuotaFastpathTotal.inc(); return 'ok'; }
    const cooled = Date.now() - (this.truthMeasuredAt.get(pid) ?? 0) < TRUTH_COOLDOWN_MS;
    if (cooled) {
      if (truth + delta + bytes > this.quota.maxDocBytes) this.scheduleFreezePending(pid);
      else collabQuotaFastpathTotal.inc();
      return 'ok';
    }
    if (!this.truthBudgetTryTake()) {   // 进程级测量预算超限——退上界决策
      if (truth + delta + bytes > this.quota.maxDocBytes) this.scheduleFreezePending(pid);
      return 'ok';
    }
    const t0 = Date.now();
    const measured = this.measureTruth(document);   // null=fail-open（pendingStructs/编码异常）
    if (measured !== null) {
      this.truthBudgetRecord(Date.now() - t0);
      collabQuotaTruthMeasuredTotal.inc();
      collabQuotaTruthMeasureDuration.observe((Date.now() - t0) / 1000);
      this.docTruth.set(pid, measured);
      this.docDelta.set(pid, 0);
      this.truthMeasuredAt.set(pid, Date.now());
      if (measured + bytes > this.quota.maxDocBytes) { this.freezeQuota(pid); return 'ok'; }
      if (measured + bytes >= soft && Date.now() - (this.thawCooldown.get(pid) ?? 0) >= THAW_COOLDOWN_MS) this.freezeQuota(pid);
      return 'ok';
    }
    // fail-open：沿用账面决策（不校准——实测重试等 pendingStructs 落定）
    if (truth + delta + bytes > this.quota.maxDocBytes) this.scheduleFreezePending(pid);
    return 'ok';
  }

  /** v6 G-1 两态分离——账面触阈：广播 over+挂 cooldown 到期确认定时器（单 doc 去重）。禁碰
   *  quotaFrozenDocs/readOnly；确认窗内帧继续走③④判据（触发帧照常放行）。确认实测**豁免
   *  truthBudget**（fail-closed：deferred/异常即当超限转 freezeQuota）；实测<soft 毫秒级纠错
   *  （broadcast ok+truth 校准）。 */
  scheduleFreezePending(pid: string): void {
    if (this.freezePendingTimers.has(pid)) return;   // 单 doc 去重（在飞确认窗内不重播）
    this.freezePending.add(pid);
    this.broadcastDocStatus(pid, 'over');
    const t = setTimeout(() => {
      this.freezePendingTimers.delete(pid);
      this.freezePending.delete(pid);
      const document = this.host.documents().get(this.liveDocName(pid));   // Y1c T12：canonical wire 名（#g 换代通道——E23 内部寻址连带）
      if (!document) return;   // 已卸载（afterUnload 已清——防御性）
      const measured = this.measureTruth(document);
      if (measured !== null && measured < Math.floor(this.quota.maxDocBytes * QUOTA_DEFAULTS.softEnterRatio)) {
        this.calibrateTruth(pid, measured);   // 误冻结毫秒级归零（truth 校准+冷却基线重置）
        this.broadcastDocStatus(pid, 'ok');
        return;
      }
      this.freezeQuota(pid);   // ≥soft/超限/fail-open deferred——fail-closed 正式冻结
    }, TRUTH_COOLDOWN_MS);
    t.unref?.();
    this.freezePendingTimers.set(pid, t);
  }

  /** Q-C：正式冻结——广播 over+setImmediate 落地（quotaFrozenDocs 与全部连接 readOnly 同一
   *  event-loop-turn：beforeSync 内同帧置 readOnly=触发帧被库静默吞——放行窗边界=one-turn）。
   *  T4 Minor：enter 计数移入回调+回调首行幂等复检——同步窗（add 落地前）二次进入的广播/计数
   *  双计根治（docStatusState 复合键已天然去重广播，此处补计数）；已卸载=冻结未落地不计数。 */
  freezeQuota(pid: string): void {
    if (this.quotaFrozenDocs.has(pid)) return;   // 幂等（recheck 复冻/双路径竞态）
    this.broadcastDocStatus(pid, 'over');
    setImmediate(() => {
      if (this.quotaFrozenDocs.has(pid)) return;   // 同步窗内二次 freezeQuota 已落地——去重
      const document = this.host.documents().get(this.liveDocName(pid));   // Y1c T12：canonical wire 名（#g 换代通道——E23 内部寻址连带）
      if (!document) return;   // 已卸载——afterUnload 清理域
      this.quotaFrozenDocs.add(pid);
      for (const c of document.connections.keys()) this.host.applyWriteFreeze(c as unknown as CollabConnection, 'quota', true);
      collabQuotaSoftThresholdTotal.inc({ action: 'enter' });
    });
  }

  /** thaw：解除 quota 冻结+overPush 复位（唯一复位点——freeze 重入不清零）+writeFirstSyncStepFor
   *  回灌（T0 探针⑧：客户端回 SyncStep2——冻结期被吞编辑由此无损落库）+broadcast(ok)+30s 复冻冷却。
   *  T4 Minor：document 缺席 early-return——无连接对象时禁前置突变（broadcast('ok') 谎报解冻；
   *  T8 shrink 通道复用前的防御收口）。Y0b-4 T8 起公共方法（shrink 滞回出口复用——阈值判定在
   *  调用方：truth<softExit 才 thaw，与 recheckFrozenDocs 同判据形态）。 */
  thawQuota(pid: string): void {
    const name = this.liveDocName(pid);   // Y1c T12：canonical wire 名寻址+writeFirstSyncStepFor 回灌连接集
    const document = this.host.documents().get(name);
    if (!document) return;   // 未装载——无冻结面可解除（quotaFrozenDocs 残留由 recheck/卸载清理收口）
    this.quotaFrozenDocs.delete(pid);
    for (const c of document.connections.keys()) {
      const conn = c as unknown as CollabConnection;
      this.host.applyWriteFreeze(conn, 'quota', false);
      if (conn.socketId) this.overPush.delete(conn.socketId);
      try {
        conn.send?.(new OutgoingMessage(conn.messageAddress ?? name).createSyncMessage().writeFirstSyncStepFor(document).toUint8Array());
      } catch { /* 已断 */ }
    }
    this.broadcastDocStatus(pid, 'ok');
    this.thawCooldown.set(pid, Date.now());
    this.recheckRounds.delete(pid);
    collabQuotaSoftThresholdTotal.inc({ action: 'exit' });
  }

  /** 冻结 doc 重测 timer（30s 独立 timer 仅遍历 quotaFrozenDocs——冻结 doc 极少成本可控；
   *  禁挂 sweep：SWEEP_ENABLED=false 逃生阀不得静默关掉冻结态唯一出口）。测量豁免 truthBudget。
   *  <softExit(0.6×MAX) → thaw（滞回出）；≥softEnter(0.8×MAX) → recheckRounds++（T9a liveBytes
   *  评估脚手架）；两阈之间=滞回带保持。 */
  startFrozenRecheckTimer(): void {
    if (this.frozenRecheckTimer) { clearInterval(this.frozenRecheckTimer); this.frozenRecheckTimer = null; }
    this.frozenRecheckTimer = setInterval(() => this.recheckFrozenDocs(), FROZEN_RECHECK_INTERVAL_MS);
    this.frozenRecheckTimer.unref?.();
  }
  recheckFrozenDocs(): void {
    for (const pid of [...this.quotaFrozenDocs]) {
      const document = this.host.documents().get(this.liveDocName(pid));   // Y1c T12：canonical wire 名（#g 换代通道——E23 内部寻址连带）
      if (!document) { this.quotaFrozenDocs.delete(pid); this.docResidue.delete(pid); continue; }   // 卸载残留（afterUnload 同清——双保险）
      const measured = this.measureTruth(document);
      if (measured === null) continue;   // fail-open deferred——保守保持冻结
      this.calibrateTruth(pid, measured);
      if (measured < Math.floor(this.quota.maxDocBytes * QUOTA_DEFAULTS.softExitRatio)) { this.thawQuota(pid); continue; }
      if (measured >= Math.floor(this.quota.maxDocBytes * QUOTA_DEFAULTS.softEnterRatio)) {
        const rounds = (this.recheckRounds.get(pid) ?? 0) + 1;
        this.recheckRounds.set(pid, rounds);
        // Y0b-4 T9a（Q-U v5/v6）：recheck≥2 轮评估 residue=truth−liveBytes（liveBytes=全根真空
        // 重建编码口径——U-6 修正：v4 只含 nodes+edges 会系统性高估 residue）——docResidue Map
        // 更新（gauge reader Σ+doc-status quota.residueBytes 数据源+零连接自动触发判据）。
        if (rounds >= RESIDUE_EVAL_ROUNDS) this.updateResidue(pid, document, measured);
        // 零连接窄版自动（v6 报告1 P2-3）：冻结∧连续≥4 轮≥soft∧零连接∧residue>60%×MAX ⇒ 后台
        // vacuum——无在线用户=无强制刷新伤害+避免画布无限期冻结（没人来点按钮）；serving 门挡
        // 中途进入。doc 常驻零连接=terminal close 路径由 vacuum ①承接（doc 不在=冻结已被卸载清理，
        // 本循环首行 continue——自动触发不可达〔无需 quiesce 一步到位分支〕）。
        // Y0c T20（Z73 读者③）：零连接判据改读 WS/direct 分解——零 WS ∧ 零 direct 才触发（旧
        // WS-only 判据在常驻会话持有〔direct≥1〕时误触 vacuum 撞在飞会话写）。Z66 计数半边同批
        // 落地：同 doc 30s 窗（recheck 周期==quiesce 上界的叠加面）内≥2 次触发=stacked 计数
        // （四稳态③稳态 0 判据面——check-collab-health Z122④）。
        if (rounds >= AUTO_VACUUM_ROUNDS && document.connections.size === 0 && (document.directConnectionsCount ?? 0) === 0 && this.vacuumRunner
          && (this.docResidue.get(pid) ?? 0) > Math.floor(this.quota.maxDocBytes * AUTO_VACUUM_RESIDUE_RATIO)) {
          const lastAt = this.autoVacuumLastAt.get(pid) ?? 0;
          if (Date.now() - lastAt < FROZEN_RECHECK_INTERVAL_MS) collabVacuumAutotriggerStackedTotal.inc();
          this.autoVacuumLastAt.set(pid, Date.now());
          void this.vacuumRunner(pid).catch((e) => this.host.logger.error(`auto vacuum failed for ${pid}: ${(e as Error).message}`));
        }
      }
    }
  }

  /** residue 评估（recheck≥2 轮）：truth−全根真空重建编码（rebuildVacuumDoc 单源——与 vacuum ④
   *  同一重建）；unsupported 根（Y.Text 等）不更新（自动触发结构性不可达——REST 显式通道降级导出）。 */
  private updateResidue(pid: string, document: Y.Doc, truth: number): void {
    const rebuilt = this.rebuildVacuumDoc(document);
    if (!rebuilt) return;
    try {
      this.docResidue.set(pid, Math.max(0, truth - Y.encodeStateAsUpdate(rebuilt).byteLength));
    } finally {
      rebuilt.destroy();
    }
  }

  /** 真值测量（白名单点③——T3 注释的"over 检查〔T4 冷却窗外〕"）：pendingStructs/pendingDs 非空或
   *  编码异常 → null（fail-open 沿用账面——测量体可能因 defer 状态失真）。T4 Minor：未用形参 pid 删。 */
  private measureTruth(document: Y.Doc): number | null {
    try {
      if (document.store.pendingStructs !== null || document.store.pendingDs !== null) return null;
      return Y.encodeStateAsUpdate(document).byteLength;
    } catch { return null; }
  }

  /** 进程级测量预算（报告2 D）：≤1 次/200ms + duty≤5%（最近 5s 累计测量 >250ms 拒）。 */
  private truthBudgetTryTake(): boolean {
    const now = Date.now();
    if (now - this.truthBudgetState.lastAt < 200) return false;
    this.truthBudgetState.durs = this.truthBudgetState.durs.filter((d) => now - d.at < 5_000);
    if (this.truthBudgetState.durs.reduce((s, d) => s + d.ms, 0) > 250) return false;
    this.truthBudgetState.lastAt = now;
    return true;
  }
  private truthBudgetRecord(ms: number): void {
    this.truthBudgetState.durs.push({ at: Date.now(), ms });
  }

  /** doc 当前 quota 态单源（'over'=冻结集∪确认集）——buildDocStatus 推导/drain 并轨广播取现值共用。 */
  quotaStateOf(pid: string): 'over' | 'ok' {
    return this.quotaFrozenDocs.has(pid) || this.freezePending.has(pid) ? 'over' : 'ok';
  }

  /** doc-status 最小形态（T5 完整化）：rev=装载播种 1+翻转自增；stateOverride=广播时显式态
   *  （freezeQuota 的 setImmediate 落地窗内集合推导滞后——广播点显式声明）。
   *  writeFrozen=quota over ∨ gateway 级 drain（两维度独立——drain 冻结不冒充 quota over）。
   *  Y0b-4 T9a（Q-U v6）：顶层 generation 可选（docGeneration 播种值>0 才带——T5 客户端
   *  pendingGenerationReload 消费跳变）+quota.residueBytes 可选（docResidue 有键才带——T11
   *  「重建画布历史」入口数据源）；未 vacuum 的 doc 两键缺省=五键 payload 形态不变。
   *  Y0b-5 T11：connectionId 可选（per-conn 推送面带上=回传客户端遥测 join；per-doc 广播缺省）。 */
  buildDocStatus(pid: string, stateOverride?: 'over' | 'ok', connectionId?: string): CollabDocStatusPayload {
    const over: boolean = stateOverride !== undefined ? stateOverride === 'over' : this.quotaStateOf(pid) === 'over';
    const gen = this.docGeneration.get(pid) ?? 0;
    const residue = this.docResidue.get(pid);
    return {
      type: 'doc-status',
      rev: this.docStatusRev.get(pid) ?? DOC_STATUS_REV_SEED,
      writeFrozen: over || this.host.isDrainingState(),
      ...(gen > 0 ? { generation: gen } : {}),
      ...(connectionId ? { connectionId } : {}),
      quota: {
        state: over ? 'over' : 'ok',
        bytes: (this.docTruth.get(pid) ?? 0) + (this.docDelta.get(pid) ?? 0),
        limit: this.quota.maxDocBytes,
        maxTxBytes: this.quota.maxTxBytes,
        softLimitBytes: Math.floor(this.quota.maxDocBytes * QUOTA_DEFAULTS.softEnterRatio),
        ...(residue !== undefined ? { residueBytes: residue } : {}),
      },
    };
  }

  /** doc-status 广播（对该 doc 全部连接 sendStateless）：rev 仅在快照翻转时 ++（重复同态不重播不爬 rev）。
   *  翻转面=T5 扩容的 {quota 态, writeFrozen} 复合——drain 冻结/解除不改变 quota 态但翻转 writeFrozen
   *  （docStatusState 存复合键——quota 单维判会漏 drain 通告=首快照竞态复活）。
   *  Y0b-4 T8 外审修复（偏差③）：forceRevBump=跳过 dedup 直接 rev++ 广播——dedup 键不含 bytes，
   *  state/frozen 未变但 bytes 变了的通告面（shrink 成功未 thaw 路径经 broadcastDocStatusForce 消费）。 */
  broadcastDocStatus(pid: string, state: 'over' | 'ok', forceRevBump = false): void {
    const frozen = state === 'over' || this.host.isDrainingState();
    const key = `${state}:${frozen}`;
    if (!forceRevBump && this.docStatusState.get(pid) === key) return;
    this.docStatusState.set(pid, key);
    this.docStatusRev.set(pid, (this.docStatusRev.get(pid) ?? DOC_STATUS_REV_SEED) + 1);
    const document = this.host.documents().get(this.liveDocName(pid));   // Y1c T12：canonical wire 名（#g 换代通道——E23 内部寻址连带）
    if (!document) return;
    const payload = JSON.stringify(this.buildDocStatus(pid, state));
    for (const c of document.connections.keys()) {
      try { (c as unknown as CollabConnection).sendStateless?.(payload); } catch { /* 已断 */ }
    }
  }

  /** Y0b-3 T4：5min 零连接 doc 观测器（纯观测零卸载动作——v3 裁定删除 reaper：自队列谓词与库守卫
   *  在可达状态同真+库 store 排程后必 setTimeout unload 自愈+保内存分支本仓不可达〔契约 3"任何路径
   *  不 throw"〕）。独立 timer 不挂 startSessionSweep——SWEEP_ENABLED=false 逃生阀不得静默关掉观测。
   *  stuck 判据=零连接∧!isLoading∧自队列空∧库守卫不满足（shouldUnloadDocument=false=debouncer/
   *  saveMutex 未清=应卸载而未卸）连续 2 轮；自队列非空=正常流转轮内跳过（≠stuck）。
   *  RC3：每轮首行 heapPressureSample 经 host 缝（采样闸 SG 域——W3b 迁 SG 后接线改 sg 同名公有）。 */
  startHeapObserver(): void {
    if (this.heapObserverTimer) { clearInterval(this.heapObserverTimer); this.heapObserverTimer = null; }
    this.heapObserverTimer = setInterval(() => this.observeIdleDocs(), 5 * 60_000);
    this.heapObserverTimer.unref?.();
  }
  private observeIdleDocs(): void {
    this.host.heapPressureSample();   // 评审 F-2：每轮周期采样——纯需求驱动（新 doc auth/load 才采样）下 tripped 后客户端放弃重试+内存回落时 overload_state 恒读 tripped=1 假阳性喂 runbook；周期消费 releaseHook 清 refusalCache+gauge 翻转
    for (const doc of this.host.documents().values()) {
      const name = doc.name;
      if (doc.connections.size > 0 || doc.isLoading) { this.docStuckRounds.delete(name); continue; }
      // pendingQueues 键=裸 projectId（播种/取用全裸键实证——get(doc.name) 恒 undefined=静默失效）
      const pid = parseDocName(name)?.projectId ?? '';
      if (this.persistence.hasPendingWrites(pid)) { this.docStuckRounds.delete(name); continue; }   // B1：队列读面随域迁 service（自队列非空=正常流转轮内跳过≠stuck 语义不变）
      if (!this.host.shouldUnloadDocument(doc)) {   // 守卫拒绝+零连接+队列空=疑似卡住
        const n = (this.docStuckRounds.get(name) ?? 0) + 1;
        this.docStuckRounds.set(name, n);
        if (n >= 2) { yjsDocStuckTotal.inc(); this.stuckDocsSeen += 1; this.docStuckRounds.delete(name); }   // 连续 2 轮=真 stuck（Y0b-5 T14：同点双计——degraded.stuckDocs 同步可读）
      } else {
        this.docStuckRounds.delete(name);
      }
    }
  }

  /** Y0b-5 T10：top-N doc 结构日志定时器启动（机械提取自 gateway 构造器 :599-601 内联两行——
   *  日志非指标，指标面零定时器纪律唯一豁免；随停=stopTimers）。 */
  startDocTopNLogTimer(): void {
    this.docTopNLogTimer = setInterval(() => this.logDocTopN(), TOPN_LOG_INTERVAL_MS);
    this.docTopNLogTimer.unref?.();
  }

  /** Y0b-5 T10：卸载边界 heap 倍率播种（机械提取自 gateway unloadDocument 壳 :1987-1989——
   *  truth 在 afterUnload 被清所以先存；结算在 afterUnloadDocument〔destroy 之后〕；卸载取消=
   *  残留条目下次装载同键覆写，无泄漏）。X4 永不抛语义在 gateway 壳。 */
  beforeUnloadAnchor(projectId: string): void {
    this.unloadHeapAnchors.set(projectId, { before: this.heapUsedNow(), truth: this.docTruth.get(projectId) ?? 0 });
  }

  /** Y0b-4 T3 外审修复（I-1）：真卸载终态清理——truth 四件套（docTruth/docDelta/truthMeasuredAt/
   *  degradedDocs）归此点。库时序（hocuspocus-server.esm.js v4.6.0:1574-1601，已实证）：beforeUnloadDocument
   *  钩子窗内 doc 恒在 documents Map（删键 L1590 在钩子之后），且钩子后另有复检取消（L1586-1589 两处
   *  return 不达本钩子）——故在 beforeUnload 内以 `!documents.get` 判"真卸载"恒 false=死路径，四件套
   *  永不清理 → yjs_loaded_doc_bytes（Σ(truth+delta)）随进程寿命漂向"Σ曾装载过的所有 doc"。本清理=
   *  documents.delete（L1590）+document.destroy()（L1591）之后才调（L1592-1595）——到达即必然真卸载，
   *  无守卫直删（取消卸载天然不触发）。X4 同款永不抛：Map/Set.delete 不 throw（库对本钩子抛错无
   *  try/catch 包裹——reject 会沿 unloadDocument 冒泡；钩子壳留 gateway）。
   *  Y0b-4 T4 扩容：冻结族六件（quotaFrozenDocs/freezePending+定时器/recheckRounds/thawCooldown/
   *  docStatusRev/docStatusState）同点清理（卸载=新 epoch：rev 复位播种 1 的前提）。 */
  afterUnloadDocument(documentName: string): void {
    const projectId = parseDocName(documentName)?.projectId ?? '';
    // Y0b-5 T10：卸载边界 heap 倍率结算（destroy 后采样——GC 时延噪声只记正差，合成值待标定）
    const anchor = this.unloadHeapAnchors.get(projectId);
    this.unloadHeapAnchors.delete(projectId);
    if (anchor && anchor.truth > 0) {
      const freed = anchor.before - this.heapUsedNow();
      if (freed > 0) yjsDocHeapAmplification.set(freed / anchor.truth);
    }
    this.docTruth.delete(projectId);
    this.docDelta.delete(projectId);
    this.truthMeasuredAt.delete(projectId);
    this.degradedDocs.delete(projectId);
    this.persistence.storeFailedDocs.delete(projectId);   // Y0c T16（Z110）：真卸载终态——淘汰标记随 doc 消亡（B1 台账随域迁 service）
    this.quotaFrozenDocs.delete(projectId);
    this.freezePending.delete(projectId);
    const pendingTimer = this.freezePendingTimers.get(projectId);
    if (pendingTimer) { clearTimeout(pendingTimer); this.freezePendingTimers.delete(projectId); }
    this.recheckRounds.delete(projectId);
    this.thawCooldown.delete(projectId);
    this.docStatusRev.delete(projectId);
    this.docStatusState.delete(projectId);
    // Y0b-4 T9a：代际/残留族同点清理（卸载=新 epoch：下次装载从 DB 重播种——世代准入/auth 面
    // 由装载重播收口；docResidue 过期记账同清）；Y1c T12：preVacuumSv 缓存随门退役删除
    this.docGeneration.delete(projectId);
    this.docResidue.delete(projectId);
  }

  /** Y0b-4 T4：overPush 台账老化（机械提取自 gateway sweepStaleAuthMaps :753 循环体——台账 DR
   *  所有，SG 老化缝位；断连清理之外的兜底——idle-reset 只清计数不清条目，防 socketId 复用期无界）。 */
  ageOverPush(now: number): void {
    for (const [k, v] of this.overPush) if (now - v.lastAt >= 60_000) this.overPush.delete(k);
  }
  /** overPush 台账断连清理（机械提取自 gateway disconnect :1952——sid 键直删，SG 清理缝位）。 */
  dropOverPush(socketId: string): void {
    this.overPush.delete(socketId);
  }

  /** W3a：DR 域定时器族随停（机械提取自 gateway onApplicationShutdown :2580-2582/:2585/:2595 清理行
   *  逐字平移——frozenRecheckTimer/freezePendingTimers/heapObserverTimer/docTopNLogTimer 四位；
   *  docTopNLogTimer 原位在 unregister readers 之后，收进本缝后前移至 frozenRecheckTimer 原位——
   *  同同步段零 await 间隔，interval 清除时点在同 tick 内不可观测，编排序语义不变〔§2.3〕）。 */
  stopTimers(): void {
    if (this.frozenRecheckTimer) { clearInterval(this.frozenRecheckTimer); this.frozenRecheckTimer = null; }   // Y0b-4 T4：冻结重测 timer 随停
    for (const t of this.freezePendingTimers.values()) clearTimeout(t);   // Y0b-4 T4：确认定时器随停
    this.freezePendingTimers.clear();
    if (this.heapObserverTimer) { clearInterval(this.heapObserverTimer); this.heapObserverTimer = null; }   // Y0b-3 T4：卡住观测 timer 随停
    if (this.docTopNLogTimer) { clearInterval(this.docTopNLogTimer); this.docTopNLogTimer = null; }   // Y0b-5 T10：top-N 日志定时器随停
  }
}
