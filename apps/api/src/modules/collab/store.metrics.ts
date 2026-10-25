import { Counter, Gauge, Histogram, register } from 'prom-client';
import { monitorEventLoopDelay } from 'node:perf_hooks';

export const yjsStoreDrainTotal = new Counter({
  name: 'yjs_store_drain_total',
  help: 'storeDocument drain 结果：noop=空转（readCanvas 无条件触发的空转率观测）/ appended=落库一行',
  labelNames: ['result'],
  registers: [register],
});

export const yjsStoreAppendFailureTotal = new Counter({
  name: 'yjs_store_append_failure_total',
  help: 'store append 失败次数（队列保留待重试，at-least-once）',
  registers: [register],
});

/** Y0a-2（Y8）：取批后队列被并发改动的探测计数（splice 前 length<n 或批尾引用不符）；
 *  真对账=storeDocument 成功路径自检（collect 注册模式归 Task 4 观测批——定义先行供 Task 3 编译）。 */
export const yjsStoreTailAnomalyTotal = new Counter({
  name: 'yjs_store_tail_anomaly_total',
  help: '取批后队列被并发改动（splice 前 length<n 或批尾引用不符——Y8）的探测计数；真对账=storeDocument 成功路径自检',
  registers: [register],
});

export const yjsStoreCompactFailureTotal = new Counter({
  name: 'yjs_store_compact_failure_total',
  help: 'compaction 失败次数（行已落库，仅一致性问题）',
  registers: [register],
});

/** C1②（Y1c T11 双评审 Critical）：appendBatch walSeq 重置 tripwire 计数——新帧调用形
 *  （actor CAS/维护无 wm）lastWalSeq≤CanvasDoc.pgSeq 且非幂等重放在档的 fail-closed 拒收。
 *  配合 C1① PG 播种（spool.seedWalSeqFromPg）正常路径零触发；触发=播种面缺口（计数器重置纪
 *  新帧将落已发布快照基线之下=装载尾跳过+purgeBelow 永删的静默丢数据链）即侦测。 */
export const walSeqResetTripwireTotal = new Counter({
  name: 'yjs_store_wal_seq_reset_tripwire_total',
  help: 'appendBatch walSeq 重置 tripwire：新帧 lastWalSeq≤CanvasDoc.pgSeq 且非幂等重放在档 fail-closed 拒收（C1① 播种面缺口侦测——正常路径零触发）',
  registers: [register],
});

/** Q-M4（Y1c T11 双评审）：compact ④提交后清理段（purgeBelow 分批删/pruneSnapshots 保留策略/
 *  Q-M3 义务衰减）失败计数——发布已落定非 compact 失败（独立于 yjs_store_compact_failure_total
 *  防污染告警线）；清理义务由 purgeBelowSeq 持久承载（boot/tick resumePurges 续跑）。 */
export const yjsCompactPurgeDeferredTotal = new Counter({
  name: 'yjs_compact_purge_deferred_total',
  help: 'compact ④提交后清理段失败（发布已落定——义务由 purgeBelowSeq 持久承载 boot/tick 续跑；与 compact 失败告警线分立）',
  registers: [register],
});

/** ===== Y0b-5 T10（spec §5.8②③/E19 回归）：服务端指标面 ===== */

/** E19「改尺寸直方图」原文回归：yjs_canvas_doc_bytes（projectId gauge——标签基数随项目数无界）退役，
 *  改无标签尺寸直方图；「哪个项目病态」由 top-N 结构化日志承担（E54 基调）。与 yjs_loaded_doc_bytes
 *  分工互写：直方图=尺寸分布（三锚观测），gauge=驻留总量 Σ(truth+delta)。三锚=装载播种（cheap 或
 *  付费编码值——docTruth 既有播种值零新增编码）/compact 全量编码（repo snapshotBytes 既有上报）/
 *  shrink 活文档再编码（白名单点③同一编码）——禁在锚外加观测点（quota 实测是有偏采样不进本图）。 */
export const yjsDocBytes = new Histogram({
  name: 'yjs_doc_bytes',
  help: 'doc 编码字节尺寸分布（三锚观测：装载播种/compact 全量编码/shrink 活文档再编码——既有 docTruth 事件零新增编码；无 projectId 标签——病态 doc 归 top-N 结构化日志）',
  buckets: [64 * 1024, 256 * 1024, 1_048_576, 4_194_304, 16_777_216],
  registers: [register],
});

/** 超阈计数（E19「无标签超阈计数」）——阈值=直方图顶桶 16MiB（对齐 maxPayload DoS 兜底界；
 *  与 quota maxDocBytes 分立——quota 是执法阈值（env 可调），本计数是病态观测阈值（常量）。 */
export const DOC_BYTES_OVER_THRESHOLD_BYTES = 16_777_216;
export const yjsDocBytesOverThresholdTotal = new Counter({
  name: 'yjs_doc_bytes_over_threshold_total',
  help: 'doc 编码字节 >16MiB 的观测次数（与 yjs_doc_bytes 同点计数——病态观测非执法；quota 超限执法面归 collab_quota_*）',
  registers: [register],
});

/** append 增量直方图（E54②）——store 成功路径逐片 payload 字节（切批 ≤1MB 口径）。
 *  退役 yjs_canvas_doc_bytes 的 inc 语义继任：原 gauge 的 projectId 键控近似累计由直方图+聚合
 *  gauge（yjs_loaded_doc_bytes）共同覆盖。 */
export const yjsStorePayloadBytes = new Histogram({
  name: 'yjs_store_payload_bytes',
  help: 'store append 落库 payload 字节分布（成功路径逐片 observe——切批 ≤1MB 口径）',
  buckets: [16 * 1024, 64 * 1024, 256 * 1024, 512 * 1024, 1_048_576, 4_194_304],
  registers: [register],
});

/** awareness 两 gauge（spec §5.2/E40）——collect reader 注册模式（yjs_loaded_doc_bytes 同族惯例：
 *  gateway 注册读数回调，metrics 文件不 import gateway）。onAwarenessUpdate 未注册禁依赖（观测钩子
 *  禁改写——E73）——collect 现算 Σ。不解码不取字段仅 Σ 编码字节（无 PII 面）。 */
let awarenessReader: (() => { states: number; bytes: number }) | null = null;
export function registerAwarenessReader(fn: () => { states: number; bytes: number }): void { awarenessReader = fn; }
export function unregisterAwarenessReader(): void { awarenessReader = null; }
export const awarenessStates = new Gauge({
  name: 'awareness_states',
  help: 'Σ 在飞 awareness 条目数（collect 现算——不解码不取字段仅 Σ 编码字节口径的条目半边）',
  registers: [register],
  collect() { try { this.set(awarenessReader?.().states ?? 0); } catch { this.set(0); } },
});
export const awarenessBytes = new Gauge({
  name: 'awareness_bytes',
  help: 'Σ 在飞 awareness 编码字节（collect 现算——不解码不取字段仅 Σ 编码字节；onAwarenessUpdate 未注册禁依赖）',
  registers: [register],
  collect() { try { this.set(awarenessReader?.().bytes ?? 0); } catch { this.set(0); } },
});

/** heap 倍率（spec §5.8③ v2.1）：装载/卸载边界 heapUsed 差÷编码字节——与 yjs_doc_bytes 采样点
 *  时机相邻但量纲不同（堆差 vs 编码字节），禁合并实现。合成值待标定：卸载后 GC 时延致负数/噪声
 *  （采样点最小化——只在装载/卸载边界采，非正差跳过保持上一次有效样本）。 */
export const yjsDocHeapAmplification = new Gauge({
  name: 'yjs_doc_heap_amplification',
  help: 'doc heap 倍率合成值（装载/卸载边界 heapUsed 差÷编码字节——GC 时延噪声、待标定；非正差跳过）',
  registers: [register],
});

/** 耗时直方图四件（spec §5.8③）：store（取批→落定）/compact（repo.compact 实跑）/load（装载
 *  try 段）/withDoc（REST 直连全路径含 disconnect）。withDoc 高频路径——Date.now() 计时本身
 *  零成本可接受（采集挂 finally：时长面非成功面）。 */
const DURATION_BUCKETS_SECONDS = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
export const yjsStoreDuration = new Histogram({
  name: 'yjs_store_duration_seconds',
  help: 'store 取批→落定耗时秒（saveMutex 内主体路径——含 append/spool 落定；noop 空转不计时）',
  buckets: DURATION_BUCKETS_SECONDS,
  registers: [register],
});
export const yjsCompactDuration = new Histogram({
  name: 'yjs_compact_duration_seconds',
  help: 'repo.compact 实跑耗时秒（时间门通过后的真实 compact——门早退不计时）',
  buckets: DURATION_BUCKETS_SECONDS,
  registers: [register],
});
export const yjsLoadDuration = new Histogram({
  name: 'yjs_load_duration_seconds',
  help: 'loadDocument 装载耗时秒（hydrate+replay+播种段——拒绝早退不计时）',
  buckets: DURATION_BUCKETS_SECONDS,
  registers: [register],
});
export const yjsWithdocDuration = new Histogram({
  name: 'yjs_withdoc_duration_seconds',
  help: 'REST withDoc 直连全路径耗时秒（transact→disconnect——open 后起算；T15 起载体=非常驻保留面 shrink/exportFresh/write.port；REST 主路径已迁 withSession 会话——count 塌缩非流量塌缩）',
  buckets: DURATION_BUCKETS_SECONDS,
  registers: [register],
});

/** compact 删除行数/tombstone 字节（spec §5.8③；计数=histogram_count 口径——每次成功 compact
 *  恰一个观测，_count 即 compact 次数）。tombstone=新快照 delete set 编码字节（全 SV 滤零
 *  structs 段后的余量近似——repo.compact 单点测量）。 */
export const yjsCompactDeletedRows = new Histogram({
  name: 'yjs_compact_deleted_rows',
  help: 'compact 删除增量行数分布（每次成功 compact 一观测——_count 口径即 compact 次数）',
  buckets: [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024],
  registers: [register],
});
export const yjsCompactTombstoneBytes = new Histogram({
  name: 'yjs_compact_tombstone_bytes',
  help: 'compact 时 delete set 编码字节分布（全 SV 滤零 structs 段余量近似；_count 口径即 compact 次数——墓碑主导文档判读面）',
  buckets: [16, 64, 256, 1024, 4096, 16384, 65536, 262144, 1_048_576],
  registers: [register],
});

/** snapshot-doc-cache 条目 gauge（T10 容量上界配套——与 LRU 同源的第二条无界增长路径可见化）。
 *  reader 注册模式同族（CollabDocumentService 构造注册）。 */
let snapshotCacheEntriesReader: (() => number) | null = null;
export function registerSnapshotCacheEntriesReader(fn: () => number): void { snapshotCacheEntriesReader = fn; }
export function unregisterSnapshotCacheEntriesReader(): void { snapshotCacheEntriesReader = null; }
export const yjsSnapshotCacheEntries = new Gauge({
  name: 'yjs_snapshot_cache_entries',
  help: '快照解码缓存条目数（容量上界 32 的占用观测——collect 现算）',
  registers: [register],
  collect() { try { this.set(snapshotCacheEntriesReader?.() ?? 0); } catch { this.set(0); } },
});

/** Y0b-5 T14（spec §5.8② E54⑤）：最老未 flush 窗口年龄 gauge——数据源=gateway pendingSince 台账
 *  （pending 队列空→非空转变播种=update 监听单点；reader 自愈漏清：队列已空即除账）。口径=内存
 *  pending 队列（与 dirtyDocs/yjs_pending_projects 同族）；spool 落定即窗口闭合（fsync=落定点②），
 *  磁盘滞留另见 yjs_spool_depth_bytes。reader 注册模式=pendingCollector 惯例（gateway 注册读数
 *  回调，metrics 文件不 import gateway——反向依赖禁止）。 */
let oldestUnflushedReader: (() => number) | null = null;
export function registerOldestUnflushedReader(fn: () => number): void { oldestUnflushedReader = fn; }
export function unregisterOldestUnflushedReader(): void { oldestUnflushedReader = null; }
export const yjsOldestUnflushedAgeSeconds = new Gauge({
  name: 'yjs_oldest_unflushed_age_seconds',
  help: '最老未 flush（pending 队列非空）doc 的窗口年龄秒（空→非空转变播种；dirtyDocs=0 时恒 0；spool 落定=窗口闭合，磁盘滞留见 yjs_spool_depth_bytes）',
  registers: [register],
  collect() { try { this.set(oldestUnflushedReader?.() ?? 0); } catch { this.set(0); } },
});

/** 批3-4：session sweep 关闭计数（cause=revoked 复验确认 / db-fail 连续复验异常兜底关）；
 *  Y0b-3 T1 起默认开——COLLAB_SWEEP_ENABLED='false' 为逃生阀。 */
export const collabSweepCloseTotal = new Counter({
  name: 'collab_sweep_close_total',
  help: 'session sweep close(4401) 次数（默认开——COLLAB_SWEEP_ENABLED=false 逃生阀关闭后无效）',
  labelNames: ['cause'],
  registers: [register],
});

/** T19（plan v11.2 ③ 观测补）：成员移除 WS 清理结果计数（spec 钉名 member_revoked_conns）——
 *  wirePermChangedEvents removed:true 分支每 scheduleSweepClose 一次 +1（移除成员的存量匹配连接数
 *  ——清理结果观测：0=无存量连接，N=已排队关闭 N 条）。与 collab_sweep_close_total{cause='revoked'}
 *  消费链上下游关系（本计数=事件入队侧即时值，彼=close 完成侧——逃生阀关闭时本计数仍计）。 */
export const memberRevokedConns = new Counter({
  name: 'member_revoked_conns',
  help: 'T19（v11.2 ③）：成员移除 WS 清理结果计数（wirePermChangedEvents removed:true——匹配存量连接 scheduleSweepClose 入队数；上游即时值与 collab_sweep_close_total{cause=revoked} 完成侧互补）',
  registers: [register],
});

/** Y0b-3 T1（P14）：进程级 unhandledRejection 兜底计数——库内未 await async 钩子 rethrow 的安全网
 *  （T10 证伪 onStateless 必要性后，真正买单者=T2 onUpgrade catch→throw 路径+库内部未 await 路径）。
 *  消费点=bootstrap/guard.ts installProcessErrorGuards（计数不退出；T11 起 source 增 'uncaught' 档）。 */
export const collabUnhandledRejectionTotal = new Counter({
  name: 'collab_unhandled_rejection_total',
  help: '进程级 unhandledRejection 兜底计数（P14：库内未 await async 钩子 rethrow 的安全网——计数不退出）',
  labelNames: ['source'],
  registers: [register],
});

/** Y0b-3 T2（P-R）：WS 升级面拒绝计数——reason=origin（Origin 白名单外/缺失）/ rate-limited
 *  （同 IP 超 60/min+burst 20）。拒绝形态=socket 直写 403/429+end（§3.1ter——hook throw=库
 *  async 监听器内 unhandled rejection 形同虚设，必须 socket 直写）。 */
export const collabUpgradeRejectedTotal = new Counter({
  name: 'collab_upgrade_rejected_total',
  help: 'WS 升级拒绝次数（reason=origin 白名单外/缺失；rate-limited 同 IP 超限——socket 直写 403/429+end）',
  labelNames: ['reason'],
  registers: [register],
});

/** Y0b-3 T3（§3.1bis 防线族）：onAuthenticate 拒绝计数——deny 工厂单点埋入（§5.1-5 拒绝必计数）。
 *  source=拒绝位六分位：state=inner 业务状态拒绝（凭据/会话/权限/项目分型+DB 折叠桶）；
 *  semaphore/bucket/heap/version=外层防线各自层位（P-F 结构分离）；cache=refusalCache 命中重放。 */
export const collabAuthRejectTotal = new Counter({
  name: 'collab_auth_reject_total',
  help: 'collab onAuthenticate 拒绝次数（reason=CollabAuthReason 词表；source=拒绝位 state/semaphore/bucket/heap/version/cache）',
  labelNames: ['reason', 'source'],
  registers: [register],
});
/** Y0b-3 T3：在飞 onAuthenticate gauge——collect 现算（reader 注册同 pendingCollector 惯例，
 *  读 gateway authInflight 字段）。口径：计数≠DB 在飞——AUTH_DB_DEADLINE 到期即释放槽位
 *  但底层查询仍在飞，DB 真实并发由池 connection_limit 兜底。 */
let authInflightReader: (() => number) | null = null;
export function registerAuthInflightReader(fn: () => number): void { authInflightReader = fn; }
export function unregisterAuthInflightReader(): void { authInflightReader = null; }
export const collabAuthInflight = new Gauge({
  name: 'collab_auth_inflight',
  help: '在飞 onAuthenticate 数（信号量口径——deadline 到期即释放槽位，非 DB 真实并发）',
  registers: [register],
  collect() { try { this.set(authInflightReader?.() ?? 0); } catch { this.set(0); } },
});
/** Y0b-3 T5（版本门）：客户端协议协商拒绝计数——negotiateClientVersion 四档（allow 不计）。
 *  reason=client-version-missing|client-version-invalid|schema-outdated|server-outdated；
 *  与 collab_auth_reject_total{source:'version'} 同点双计（门面总账与分型账分离）。 */
export const collabVersionNegotiationRejectTotal = new Counter({
  name: 'collab_version_negotiation_reject_total',
  help: '客户端协议版本协商拒绝次数（reason 四档；allow 不计——与 auth_reject{source:version} 双计分离）',
  labelNames: ['reason'],
  registers: [register],
});
/** Y0b-3 T7（spec §3.3）：awareness states 三分支丢弃计数——reason=forged（他人登记 clientId 的伪造帧
 *  整体丢弃）/owner-limit（单连接 clientId 上限 4 触发丢弃）/ghost（空态首见帧剔除——T10 补：
 *  scratch 幽灵与真身空态帧同判据，ghost 异常增高=客户端非空态播种退化信号）。
 *  Y0b-4 T12（E38）：+frame-too-large（解码后 states 字节>4KB 整帧丢弃——客户端 setSelection 4KB
 *  前置拒的兜底；异常增高=旧 bundle/裸帧残余路径）。
 *  ghost 判读基线（T11 巡检口径）：正常=每入站 awareness 帧恒剔 1 条 scratch 幽灵（≈帧率 ~4/min/连接，
 *  随帧率线性）；退化=恒 ×2/帧且伴 4408 上涨（真身空态帧被同判据误杀→客户端 30-45s 重连循环）；
 *  部署窗口旧 bundle 短暂 ×2 后回落（版本门兜住→reload 自愈）。S-3："用户光标消失"
 *  类故障的可观测出口（owner-limit>0=单连接 clientId 泄漏，客户端版本核对——runbook 巡检项）。 */
export const collabAwarenessRejectTotal = new Counter({
  name: 'collab_awareness_reject_total',
  help: 'awareness states 丢弃次数（reason=forged 伪造他人 clientId 整帧丢弃/owner-limit 单连接上限 4 触发/ghost 空态首见帧剔除/frame-too-large 解码后 states 字节>4KB 整帧丢弃——光标消失类故障观测出口）',
  labelNames: ['reason'],
  registers: [register],
});
/** Y0b-3 T6（P-O）：应用侧主动 close 分布——code=CollabCloseCode 分配表值（1000/1008/1009/1011/
 *  1012/4401/4402/4404/4410），reason=close 时附语义串。边界（v3 钉死）：库自发/自然断连的服务端
 *  观测结构性不可达（onDisconnectPayload 无 close code 字段——归 Y0b-5 客户端遥测）；ws 层自发
 *  close（如 1009 maxPayload）不经本指标。**计数点全枚举（恰七个 .inc——新增必须同批补注）**：
 *  ①beginDrainAutoRelease（1012 drain released）②enforceConnMaxLifetime（4402 max-lifetime）
 *  ③scheduleSweepClose（4401 session-expired）④closeAllConnections1012（1012 service restart）
 *  ⑤closeTeamDocuments（1000 team disbanded）⑥hardClose 汇聚点（Y0b-4 拒绝链唯一出口——
 *  调用方九处：vacuum serving 门/terminal close/generation-stale 三处 4410、awareness/sync
 *  帧闸两处 1009 frame-too-large、msg/bytes/awareness 三处 1008、overPush 升级 4404）
 *  ⑦hardCloseWs=wrapBackpressure 二级（1011 slow-consumer，Y0b-4 T7——ws 级变体，
 *  conn 级拒绝链仍走 hardClose）。 */
export const collabWsCloseTotal = new Counter({
  name: 'collab_ws_close_total',
  help: 'collab 应用侧主动 webSocket.close 分布（code=分配表值；reason=close 语义串——库自发断连不可观测归客户端遥测）',
  labelNames: ['code', 'reason'],
  registers: [register],
});
/** Y0b-3 T3：AUTH DB deadline 超时计数（折 db-unavailable——防慢 DB 挂满信号量） */
export const collabAuthTimeoutTotal = new Counter({
  name: 'collab_auth_timeout_total',
  help: 'AUTH DB deadline(3s) 超时次数（折 db-unavailable；约束信号量槽位占用非 DB 工作量）',
  registers: [register],
});

/** Y0a-3（E35/E44/V22）：租约指标族——labelNames 必须与全部 .inc({}) 调用点一一对应
 *  （B8：prom-client 对未声明标签 throw——隔离路径会炸，先于任何消费方落地）。 */
export const collabLeaseDeniedTotal = new Counter({
  name: 'collab_lease_denied_total',
  help: '租约获取失败次数（reason=contention：CAS 0 行；reason=revoked：everHeld 门命中 break-glass 哨兵；reason=error：语句失败/超时）',
  labelNames: ['reason'],
  registers: [register],
});
export const collabLeaseLostTotal = new Counter({
  name: 'collab_lease_lost_total',
  help: '租约失守次数（cause=fenced-by-write/heartbeat-fenced/heartbeat-unknown-expired/revoked——gateway.selfIsolate 单点 inc）',
  labelNames: ['cause'],
  registers: [register],
});
export const collabStartFailureTotal = new Counter({
  name: 'collab_start_failure_total',
  help: 'collab 面启动失败次数（scan/listen 抛错/onHeld 接线失败；看门狗每 episode 至多补 1 次——W22）',
  registers: [register],
});
export const collabLeaseEpoch = new Gauge({
  name: 'collab_lease_epoch',
  help: '当前持有租约的 epoch（onHeld 时 set——单调观测）',
  registers: [register],
});
export const collabLeaseRowMissingTotal = new Counter({
  name: 'collab_lease_row_missing_total',
  help: '写路径遇 CollabLease 行缺失次数（配置错误——批走 spool 不排梯，SV13）',
  registers: [register],
});
/** Y0a-3（SV8）原 compact 租约档拒绝计数 yjs_compact_not_owner_total 已随 Y1c T11 compact 授权换轴
 *  退役（行锁+generation/pgSeq CAS 仲裁——与写入方 lease 正交；并发败者={compacted:false,reason:'miss'}
 *  正常折返非告警档，不再有 not-owner 形态）。 */

/** Y1c T11（卡文「snapshot 独立观测 gauge」）：doc_snapshot_bytes——快照发布字节独立观测面。
 *  set 点=canvas-doc-update.repository compact 发布成功单点（最近一次发布快照字节；与 yjs_doc_bytes
 *  直方图分工：彼=doc 编码尺寸分布三锚〔装载播种/compact/shrink〕，此=发布产物字节 gauge——
 *  worker 进程 compact 管线同点覆盖〔3002 侧同族可读〕）。 */
export const docSnapshotBytes = new Gauge({
  name: 'doc_snapshot_bytes',
  help: '最近发布快照字节（Y1c T11 compact 发布成功单点 set——独立观测面；与 yjs_doc_bytes 直方图分工：尺寸分布 vs 发布产物 gauge）',
  registers: [register],
});

/** Y1c T11（卡文「compact 时长」）：doc_compaction_duration——新 compact 管线全程（授权读+前缀重放+
 *  发布事务+提交后分批删）耗时。与 yjs_compact_duration_seconds（maybeCompact 门内 repo.compact 实跑
 *  ——api 触发路径）分工：本表在管线内部观测=worker 进程轮询触发亦覆盖；采集挂 finally（家族纪律：
 *  throw 的慢尾恰是最该被看见的样本）。 */
export const docCompactionDuration = new Histogram({
  name: 'doc_compaction_duration_seconds',
  help: 'compact 管线全程耗时秒（授权读+PG 前缀重放+发布事务+提交后分批删——管线内部单点，worker 轮询触发同覆盖；采集挂 finally）',
  buckets: DURATION_BUCKETS_SECONDS,
  registers: [register],
});
/** Y0a-3（§3.2）：投影类快照读计数（readSnapshotOnly 出口） */
export const yjsSnapshotReadTotal = new Counter({
  name: 'yjs_snapshot_read_total',
  help: 'readSnapshotOnly 投影出口快照读次数（video-work 快照/克隆）',
  registers: [register],
});

/** Y0b-2 T3（Z108）：快照读回退活读计数——readCanvasSnapshotCached 谓词门（isPersistedComplete）
 *  不满足（drain 进行中/spool 有帧/doc 常驻——PG 快照可能滞后）时 inc+活读承接。 */
export const yjsSnapshotFallbackTotal = new Counter({
  name: 'yjs_snapshot_fallback_total',
  help: 'Y0b-2：快照读谓词不满足回退活读计数（快照不可信定义性不使用）',
  registers: [register],
});

/** Y0b-2 T5（Z112）→Y0c T20 注释定案（Z92③/Z105）：reconcile 探针（ArtifactProbe）装载**无人看**
 *  doc 计数——Z105 后 wasResident=hasActiveWsConnection（零 WS 即计数，常驻会话持有不豁免）；
 *  reconcile 装载=**ephemeral 即用即释非常驻**（spec :526——用完即断不入会话表，防 5min 一次钉住
 *  几十个无人项目）。钱事实探测允许强制装载但有界（take:100 行限探测条数），本计数=heap 闸/E39
 *  归因面（探测引发的装载量观测）。 */
export const yjsDocLoadedByReconcilerTotal = new Counter({
  name: 'yjs_doc_loaded_by_reconciler_total',
  help: 'Y0b-2（Z112）/Y0c T20：reconcile 产物探针装载无人看 doc 计数（ephemeral 即用即释非常驻——钱事实有界装载，heap 闸归因）',
  registers: [register],
});

/** Y0a-1：compact 健康度唯一真实指标（v2.2 升 P0 告警线）——pendingStructs!=null 放弃本次；
 *  放弃不开窗=下次 store 立即重试（spec v2.4 E23——pendingStructs!=null 是需人工介入的异常态，
 *  活跃编辑期每 debounce 窗一次 ERROR+计数递增正是 P0 线要的最响信号；未编辑 doc 无 store 触发源不空转）。
 *  计数+ERROR 单点落 repo 的 abandoned 分支（gateway 与装载自愈两路覆盖，防双计）。 */
export const yjsCompactAbandonedTotal = new Counter({
  name: 'yjs_compact_abandoned_total',
  help: 'compact 写快照前 pendingStructs!=null 放弃本次的次数（放弃不开窗·下次 store 立即重试；连续命中=P0 人工介入信号）',
  registers: [register],
});

/** Y0a-1：装载单行 >4MB 观测计数（spec §1.4 WARN+计数——硬拒绝归 Y0b 配额批，本批只观测不 DoS 自己） */
export const yjsHydrationHugeRowTotal = new Counter({
  name: 'yjs_hydration_huge_row_total',
  help: 'loadForHydration 读到单行 >4MB 的次数（观测不拒绝；源头治理归 Y0b 配额批）',
  registers: [register],
});

/** Y0a-2（P1）：pending 快照 gauges（collect 注册模式——采集时现算，零手动维护点）。
 *  Y5：字段/指标名统一 projects 口径（V4 后按 projectId 计——字段名诚实；drill barrier 同步读
 *  yjs_pending_projects）。G-1/G-2 演练经 /api/metrics 轮询；Y0a-3 /api/ready.pending 消费同一 computePending()。
 *  稳态行为（spec §3.3）：活跃编辑时 batches>0 恒成立——只能作"停止写入后是否排空"的判据。
 *  Y0a-4/N16：快照源扩容 loadedDocs/connections——容量观测 gauge 同源供数（同一 setter 注册，禁第二套机制）。 */
type PendingSnapshot = { projects: number; batches: number; spoolFiles: number; spoolBytes: number; strandedFiles: number; strandedBytes: number; loadedDocs: number; connections: number };
let pendingCollector: (() => PendingSnapshot) | null = null;
export function registerPendingCollector(fn: () => PendingSnapshot): void { pendingCollector = fn; }
export function unregisterPendingCollector(): void { pendingCollector = null; }   // Y5：onApplicationShutdown 调用——防多 gateway 覆盖+destroy 后闭包悬挂

/** Y0a-2：spool 族指标（spec §5.2——事后取证口径：PROMETHEUS_TOKEN 手 curl；告警路由归 Y0b/E54）。
 *  V14：容量口径含隔离字节（隔离段同占盘——"排除"=磁盘被隔离字节填满而熔断永不触发）。
 *  X11/X17：depth 双 gauge 改 collect 形态（经 pendingCollector 现算——scrape 崩=整个 /api/metrics 500，故 collect 体 try/catch）。
 *  Y0a-3 R3/V2/B15/I8：gauge 取 total=own+stranded 磁盘真值（容量告警+G-1 barrier 判据——外来段同占盘
 *  不得排除）；部署门读 /api/ready.pending 的 own 口径（P16 双口径分立）。 */
export const yjsSpoolDepthFiles = new Gauge({
  name: 'yjs_spool_depth_files',
  help: 'spool 段文件数（total=own+stranded 磁盘真值——容量告警+G-1 barrier 判据；部署门读 /api/ready.pending 的 own 口径，P16）',
  registers: [register],
  // ?? 0：容错测试 stub 注入旧快照形态（computePending 自 T4 起恒产 stranded 字段）
  collect() { try { const p = pendingCollector?.(); this.set(p ? p.spoolFiles + (p.strandedFiles ?? 0) : 0); } catch { this.set(0); } },
});
export const yjsSpoolDepthBytes = new Gauge({
  name: 'yjs_spool_depth_bytes',
  help: 'spool 段文件字节总和（total=own+stranded，**含**隔离/外来字节——容量核算同口径，V14）',
  registers: [register],
  collect() { try { const p = pendingCollector?.(); this.set(p ? p.spoolBytes + (p.strandedBytes ?? 0) : 0); } catch { this.set(0); } },
});
export const yjsPendingProjects = new Gauge({
  name: 'yjs_pending_projects',
  help: 'pending 队列非空的项目数（G-1 演练 quiescence 判据；Y0a-3 ready.pending.projects 同源）',
  registers: [register],
  collect() { try { this.set(pendingCollector?.().projects ?? 0); } catch { this.set(0); } },
});
export const yjsPendingBatches = new Gauge({
  name: 'yjs_pending_batches',
  help: 'pending 队列 update 条数（update 条数口径，非合并后批数——与 storeInFlight 不同量纲）',
  registers: [register],
  collect() { try { this.set(pendingCollector?.().batches ?? 0); } catch { this.set(0); } },
});

/** Y0a-4/N16：容量观测三件套前二（enforcement 归 Y1c-3）——collect 现算形态（同 pendingCollector 惯例，
 *  同一快照源供数禁第二套机制；X11/X17：collect 抛错=整个 /api/metrics 500，故 collect 体 catch 后 set(0)）。
 *  loadedDocs 口径=WS 活跃 doc+在飞直连（REST 直连 disconnect 在 connectionsCount>0 时不卸载 doc）。 */
export const yjsLoadedDocuments = new Gauge({
  name: 'yjs_loaded_documents',
  help: 'Y0a-4/N16: 在飞 Y.Doc 数（Hocuspocus documents.size）——容量三数观测，enforcement 归 Y1c-3',
  registers: [register],
  collect() { try { this.set(pendingCollector?.().loadedDocs ?? 0); } catch { this.set(0); } },
});
export const yjsConnectionCount = new Gauge({
  name: 'yjs_connection_count',
  help: 'Y0a-4/N16: collab WS 连接数（口径=server.getConnectionsCount() 已聚合 WS 连接；documents 的 directConnectionsCount 单独累加、勿重复计）',
  registers: [register],
  collect() { try { this.set(pendingCollector?.().connections ?? 0); } catch { this.set(0); } },
});
export const yjsStoreHookCallsTotal = new Counter({
  name: 'yjs_store_hook_calls_total',
  help: 'afterStoreDocument 钩子链存活计数（V22 收缩形态——库钩子健康面）',
  registers: [register],
});
export const yjsSpoolTruncatedTotal = new Counter({
  name: 'yjs_spool_truncated_total',
  help: '尾部截断/坏帧停读次数（禁静默续读；连续命中=磁盘故障信号）',
  registers: [register],
});
export const yjsSpoolWriteFailuresTotal = new Counter({
  name: 'yjs_spool_write_failures_total',
  help: 'spool append/fsync 失败次数（ioBroken 熔断素材——批次留队列，BOI）',
  registers: [register],
});
export const yjsSpoolCapacityTotal = new Counter({
  name: 'yjs_spool_capacity_total',
  help: 'spool 容量超限熔断次数（overCapacity 态——与 ioBroken 分离，V14；不丢最旧）',
  registers: [register],
});
export const yjsSpoolQuarantinedTotal = new Counter({
  name: 'yjs_spool_quarantined_total',
  help: '隔离处置段数（坏尾字节区间隔离——显式接受的有界丢失，需人工判定；重复调用不重复递增，V3）',
  registers: [register],
});

/** ===== Y1c T8（spec v5.4 §4.3/§4.4+ADR-01）：WAL 帧协议升级指标族 ===== */

/** fsync 失败分档计数（契约 WAL_FSYNC_TIER_SEMANTICS——tier=EIO fail-stop 不自动重试/ENOSPC
 *  截断复用档/fsync-fail-pre 写前失败；device=固定稳定标签 'spool-root'——M7（Q-M11）：绝对
 *  路径不入指标标签（跨部署/迁移不可比且标签基数随配置漂移；单实例单卷部署下无稳定设备 id，
 *  常量标签即诚实形态）。 */
export const walFsyncErrorTotal = new Counter({
  name: 'wal_fsync_error_total',
  help: 'WAL append/fsync 失败分档（tier=EIO fail-stop：walHealthy=false 停收要求重启+磁盘检查/ENOSPC 截断复用档/fsync-fail-pre 写前失败——EIO 不自动重试；device=固定标签 spool-root）',
  labelNames: ['device', 'tier'],
  registers: [register],
});

/** 坏段四档分类（tier=契约 WalBadSegmentTier：bad-crc/truncated/missing-seq/dup-hash——
 *  分类码单源=walDefectTier 穷尽映射，实现禁散写）。 */
export const yjsSpoolBadSegmentTotal = new Counter({
  name: 'yjs_spool_bad_segment_total',
  help: 'WAL 恢复扫描坏段四档分类计数（tier=bad-crc 含骗过 CRC 网的 hash/generation 校验失败/truncated 撕裂/missing-seq 缺号/dup-hash 重复——含良性 dup 观测）',
  labelNames: ['tier'],
  registers: [register],
});

/** 整段隔离计数（reason=bad-header/history-mismatch（契约档）/generation-switch 换代切段/
 *  pg-prefix-violation 证据保全/truncate-failed 截断失败拒服务（M1——契约 fsync 分档档内档）
 *  ——fail-closed 零帧重放面。 */
export const walSegmentQuarantinedTotal = new Counter({
  name: 'wal_segment_quarantined_total',
  help: 'WAL 整段隔离计数（reason=bad-header 坏段头/history-mismatch≠SystemHistory fail-closed/generation-switch 换代切段/pg-prefix-violation PG 前缀校验证据保全/truncate-failed 截断失败段拒服务）',
  labelNames: ['reason'],
  registers: [register],
});

/** 修正 #6：时间戳栅栏触发的恢复怀疑态段计数（recoverySuspect——自动扫描零重放，重放归恢复流
 *  裁定非静默丢段；非零=存在待人工裁定的「忘 bump」形态段）。 */
export const walRecoverySuspectTotal = new Counter({
  name: 'wal_recovery_suspect_total',
  help: 'WAL 时间戳栅栏触发段计数（lastWriteAt>epochStartedAt 仅恢复怀疑态求值——F-S4-5；recoverySuspect 恢复怀疑态自动扫描零重放，重放归恢复流裁定）',
});

/** ===== Y1c T13（G6a——spec §9.3 六指标落地）：恢复观测族 =====
 *  六指标核实账：doc_frame_rejected_total{reason}=既有等价面 collab_actor_frame_outcome_total
 *  {outcome='reject-4411'|'reject-4412'}+collab_quota_frame_rejected_total（帧闸档）——不重复新增
 *  （spec §9.3 为全批清单非逐卡新增义务）；本族新增其余五项。 */

/** WAL fsync 时延（S4/T33 硬门「WAL fsync p95>20ms」的观测源——syncSegmentHandle 单点包裹，
 *  含截断后 sync 与批单 fsync；EIO/ENOSPC 失败路径经 wal_fsync_error_total 分档，不入本图尾）。 */
export const walFsyncLatency = new Histogram({
  name: 'wal_fsync_latency',
  help: 'WAL 段 fsync 时延毫秒（syncSegmentHandle 单点——append 批单 fsync/截断后 sync；失败分档见 wal_fsync_error_total）',
  buckets: [1, 2, 5, 10, 20, 50, 100, 250, 500, 1_000, 5_000],
  registers: [register],
});

/** wal_pending_bytes/doc_pg_lag_seq collect 源（heapObserverReader 同惯例——注册时序
 *  wireCollabMetricsReaders；api 侧持有 gateway⇒worker 进程无 reader 折 0 同款语义）。 */
let walObserverReader: (() => { pendingBytes: number; maxLagSeq: number }) | null = null;
export function registerWalObserverReader(fn: () => { pendingBytes: number; maxLagSeq: number }): void { walObserverReader = fn; }
export function unregisterWalObserverReader(): void { walObserverReader = null; }

/** WAL 待落 PG 字节（own 段未全 confirm 字节和——段级口径：存在未 confirm 帧的段计全段 bytes，
 *  上界观测；全 confirm 段待回收字节归 yjs_spool_depth_bytes 容量口径，两图分工不重复计「待 flush」语义）。 */
export const walPendingBytes = new Gauge({
  name: 'wal_pending_bytes',
  help: 'WAL own 段待落 PG 字节和（段级上界口径：存在未 confirm 帧的段计全段——机损 RPO=PG 批延迟的观测面；磁盘总字节归 yjs_spool_depth_bytes）',
  collect() { try { this.set(walObserverReader?.().pendingBytes ?? 0); } catch { this.set(0); } },
});

/** doc 已 apply 未提交 PG 的最大水位滞后（跨项目 max(appliedSeq−pgSeq)——G6a 恢复正确性观测：
 *  重启恢复后应归零（replayAll catch-up）；持续非零=flush 链滞留）。 */
export const docPgLagSeq = new Gauge({
  name: 'doc_pg_lag_seq',
  help: '跨项目 max(appliedSeq−pgSeq)（doc 帧已 apply 未提交 PG 的最大滞后——恢复后 catch-up 应归零；spoolHeadSeq−pgSeq 积压分轴见 §9.4）',
  collect() { try { this.set(walObserverReader?.().maxLagSeq ?? 0); } catch { this.set(0); } },
});

/** 恢复扫描发现的前缀缺口事件（每轮 recoverScan：帧级 fatal 停链截断/段级隔离停链/unproven-tail/
 *  PG 前缀 violation——「有效前缀」断点计数；正常重启恒 0，非零=崩溃窗口有帧不可证）。 */
export const docPrefixGapTotal = new Counter({
  name: 'doc_prefix_gap_total',
  help: 'WAL 恢复扫描前缀缺口事件计数（帧级致命缺陷截断/段级隔离停链/unproven-tail 链断续段/PG 前缀 violation——正常重启恒 0）',
  registers: [register],
});

/** boot 恢复结果（result=ok 正常开放写/blocked fail-closed 拒服务——violation 或 recoverySuspect
 *  人工裁定解除前每次重试均计 blocked；ready 面 walRecoverySuspect 兄弟字段同源）。 */
export const docRecoveryTotal = new Counter({
  name: 'doc_recovery_total',
  help: 'boot 恢复扫描结果计数（result=ok 恢复顺序全过开放写/blocked fail-closed 拒服务——PG 前缀 violation 或恢复怀疑态，人工裁定解除）',
  labelNames: ['result'],
  registers: [register],
});

/** Y0a-2（X17 更名+标签统一口径）：已删项目的更新丢弃计数——source 标签区分 gateway 终态拦截与
 *  spool 回灌 FK 收割两条路径（无标签调用会产出 source="" 的脏 series——禁）。 */
export const yjsUpdatesDiscardedDeletedTotal = new Counter({
  name: 'yjs_updates_discarded_deleted_total',
  help: '项目已删的更新丢弃数（gateway 拦截/spool FK 收割——显式接受的有界丢失）',
  labelNames: ['source'],
  registers: [register],
});

/** Y0a-2（V22+X2）：flush-at-risk 口径（契约 14/P5）=承载"进过取批且未落定批次"的项目数——
 *  enter=storeDocumentUnlocked 取批路径开始；leave=四落定点（①append ok ②spool fsync 成功含降级/
 *  交接/force-spool ③FK 丢弃 ④project.gone 丢弃——Y1/retryPersist detached/意外异常兜底 leave 同源）；
 *  spool 失败回队列不清（批未落定）；drain force-spool 复用 leave 点；库去抖窗口不属此口径。 */
export const storeInFlightDocs = new Gauge({
  name: 'yjs_store_in_flight_docs',
  help: '进入取批未落定（append/spool）的项目数（G-2 断言对象；spec §5.2 表同批改名）',
  registers: [register],
});

/** Y0a-2（V25+V10）：项目消失终态集大小——进程寿命内**真删除**项目数，永久无界的可见化接受
 *  （spec §9.10）；V11 emit 后置后无假终态（回滚=无 emit=不进集）。写入点=project.gone/
 *  team.disbanded 事件处理器（Task 6 单点收敛）。 */
export const yjsDeletedProjects = new Gauge({
  name: 'yjs_deleted_projects',
  help: '终态集大小（进程寿命内真删除项目数——永久无界的可见化，spec §9.10）',
  registers: [register],
});

/** Y0b-3 T4（spec §3.2 heap 压力自保闸族）：load 拒绝计数——auth 面与 loadDocument 汇聚点双落点
 *  同计数（仅拒新物化：!documents.has 前置，存量编辑放行防自伤）。 */
export const collabLoadRejectedTotal = new Counter({
  name: 'collab_load_rejected_total',
  help: 'heap 压力期拒绝 doc 物化次数（reason=server-overloaded；authenticate 面与 loadDocument 汇聚点双落点同计数）',
  labelNames: ['reason'],
  registers: [register],
});
/** Y0b-3 T4：heap 压力闸状态（互斥两 series——"熔断开着"与"真挂了"可区分；巡检：tripped 持续>10min=人工 drain+有序重启） */
export const collabOverloadState = new Gauge({
  name: 'collab_overload_state',
  help: 'heap 压力闸状态（state=ok|tripped 互斥两 series——安全阀静默降级=全站少服务而无人知）',
  labelNames: ['state'],
  registers: [register],
});
/** Y0b-3 T4：疑似卡住 doc 计数（纯观测——v3 裁定卸载动作删除，卸载归库自愈排程；非零=真问题该告警而非被 reaper 掩盖） */
export const yjsDocStuckTotal = new Counter({
  name: 'yjs_doc_stuck_total',
  help: '零连接∧自队列空∧库卸载守卫不满足连续 2 轮的疑似卡住 doc 计数（纯观测无卸载动作——卸载归库自愈排程）',
  registers: [register],
});
/** Y0b-3 T4：storeDocumentUnlocked Y2 兜底 catch 命中计数（意外异常留痕——原仅 ERROR 日志） */
export const yjsStoreUnexpectedThrowTotal = new Counter({
  name: 'yjs_store_unexpected_throw_total',
  help: 'store 意外异常兜底计数（契约 3 最后一道闸——批保留原归属地；出现即 Y.mergeUpdates/IO 逃逸类意外）',
  registers: [register],
});
/** Y0b-3 T4：观测 gauge collect 源（authInflightReader 同惯例——collect 现算零手动维护点）。 */
let heapObserverReader: (() => { pendingBytes: number; zeroConnDocs: number }) | null = null;
export function registerHeapObserverReader(fn: () => { pendingBytes: number; zeroConnDocs: number }): void { heapObserverReader = fn; }
export function unregisterHeapObserverReader(): void { heapObserverReader = null; }
export const yjsPendingBytes = new Gauge({
  name: 'yjs_pending_bytes',
  help: 'pendingQueues 字节和（池外内存在 external 不进 heapUsed——早于 RSS 可见）',
  registers: [register],
  collect() { try { this.set(heapObserverReader?.().pendingBytes ?? 0); } catch { this.set(0); } },
});
export const yjsZeroConnDocs = new Gauge({
  name: 'yjs_zero_conn_docs',
  help: 'Y0c T20（Z73）：真零连接 doc 数（仅 WS 零且无 direct 持有——常驻会话持有的 doc 不计；旧口径在常驻化后=常态噪声。卡住观测候选池规模）',
  registers: [register],
  collect() { try { this.set(heapObserverReader?.().zeroConnDocs ?? 0); } catch { this.set(0); } },
});

/** Y0b-4 T3（Q-O）：装载降级可观测——装载后 pendingStructs/pendingDs 非空分列计数（因果链丢失
 *  可观测非沉默）。labelNames 必须声明（B8 功能性：prom-client 未声明 label 的 .inc({field}) throw
 *  →装载降级路径抛错被 catch 折成 DB_UNAVAILABLE=画布打不开——与 Q-O 目标相反）。 */
export const collabHydrationDeferredTotal = new Counter({
  name: 'collab_hydration_deferred_total',
  help: '装载后 pendingStructs/pendingDs 非空计数（field=structs 因果依赖悬置/ds 删除集悬置——装载不拒行但降级可观测，Q-O）',
  labelNames: ['field'],
  registers: [register],
});

/** Y0b-4 T3（Q-B）：装载 doc 容量聚合 gauge——口径=最近实测+插值上界 Σ(truth+delta)（GC 回收在
 *  测量点回落；enforcement 归 Y1c-3）。reader 注册模式=registerPendingCollector 惯例
 *  （gateway 注册读数回调，metrics 文件不 import gateway——反向依赖禁止）。 */
let loadedDocBytesReader: (() => number) | null = null;
export function registerLoadedDocBytesReader(fn: () => number): void { loadedDocBytesReader = fn; }
export function unregisterLoadedDocBytesReader(): void { loadedDocBytesReader = null; }
export const yjsLoadedDocBytes = new Gauge({
  name: 'yjs_loaded_doc_bytes',
  help: '装载 doc 真值总和（驻留总量口径=Σ(实测 truth+delta 插值上界)——与 yjs_doc_bytes 直方图分工：本表=聚合驻留量/直方图=尺寸分布三锚；GC 回收在测量点回落；观测非 enforcement，Y1c-3）',
  registers: [register],
  collect() { try { this.set(loadedDocBytesReader?.() ?? 0); } catch { this.set(0); } },
});

/** Y0a-2（Y18）：卸载交接两计数——handoff=spool append 失败（批留队列+退避梯续排，X4 钩子仍 resolve）；
 *  cleanup=清理体自身异常被吞的计数留痕（X4：库对钩子抛错=取消卸载→destroy 永不 resolve，故只吞+计数）。 */
export const yjsUnloadHandoffFailureTotal = new Counter({
  name: 'yjs_unload_handoff_failure_total',
  help: 'beforeUnloadDocument 卸载交接 spool append 失败次数（批留队列+退避梯续排；钩子仍 resolve——X4）',
  registers: [register],
});
export const yjsUnloadCleanupFailureTotal = new Counter({
  name: 'yjs_unload_cleanup_failure_total',
  help: 'beforeUnloadDocument 清理体异常被吞次数（钩子永不抛——X4 destroy 不可被取消）',
  registers: [register],
});
/** Y0c T19（Z64② 生产守卫）：卸载窗口内新装载被瞬态 503 拒绝的次数——窗口=库 unloadDocument
 *  内部段（esm:1598 置键→:1600 清键；守卫读面=公开字段 unloadingDocuments）。稳态应近零
 *  （窗口=微秒级尾段）；持续非零=重试风暴或卸载管线挂起的人工线索。 */
export const yjsLoadUnloadingWindowTotal = new Counter({
  name: 'yjs_load_unloading_window_total',
  help: '卸载窗口内新装载被瞬态 503 拒绝次数（Z64②——unloadingDocuments 有键 ∧ documents 无键子窗；调用方 backoff 重试可达）',
  registers: [register],
});

/** ===== Y0b-4 T4（spec §5.2 配额族）：beforeSync 分层判据观测 ===== */

/** 软阈冻结翻转计数（action=enter 进入冻结/exit thaw 解除——滞回 0.8 进 0.6 出）。 */
export const collabQuotaSoftThresholdTotal = new Counter({
  name: 'collab_quota_soft_threshold_total',
  help: '配额软阈冻结翻转次数（action=enter 进入冻结/exit thaw 解除——滞回 softEnter 0.8/softExit 0.6）',
  labelNames: ['action'],
  registers: [register],
});
/** 拒绝链计数（reason=doc-over-quota 持续强推 4404 升级/frame-too-large 帧闸 1009——与认证桶不并轨）。 */
export const collabQuotaFrameRejectedTotal = new Counter({
  name: 'collab_quota_frame_rejected_total',
  help: 'beforeSync 拒绝链次数（reason=doc-over-quota 持续强推 4404 升级/frame-too-large 帧闸 1009）',
  labelNames: ['reason'],
  registers: [register],
});
/** readOnly 早退吞帧计数（reason 四分位=quota|viewer|draining|spool——静默分叉唯一服务端证据）。 */
export const collabQuotaWritesDroppedTotal = new Counter({
  name: 'collab_quota_writes_dropped_total',
  help: 'readOnly 连接写帧被库吞次数（reason=quota|viewer|draining|spool 冻结原因分列——静默分叉唯一服务端证据）',
  labelNames: ['reason'],
  registers: [register],
});
/** 全量编码触发次数（P0-1 直接证据——measured/(measured+fastpath) 应 >0.99）。 */
export const collabQuotaTruthMeasuredTotal = new Counter({
  name: 'collab_quota_truth_measured_total',
  help: 'docTruth 全量编码（encodeStateAsUpdate）触发次数（快路径比值验证——measured/(measured+fastpath)>0.99）',
  registers: [register],
});
/** 快路径 O(1) 放行次数（判据③——truth+delta+bytes ≤ soft 零编码）。 */
export const collabQuotaFastpathTotal = new Counter({
  name: 'collab_quota_fastpath_total',
  help: 'beforeSync 快路径 O(1) 放行次数（判据③ truth+delta+bytes ≤ soft 零编码）',
  registers: [register],
});
/** 单次全量编码耗时（进程预算 duty 验证——≤1 次/200ms+duty≤5%）。 */
export const collabQuotaTruthMeasureDuration = new Histogram({
  name: 'collab_quota_truth_measure_duration_seconds',
  help: 'docTruth 单次全量编码耗时秒（进程测量预算 duty 验证——冷却窗 2s+预算器双闸）',
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
});
/** 冻结面现状 gauge（collect=quotaFrozenDocs.size——文档级注册表，与在线无关；reader 注册模式同 pendingCollector 惯例）。 */
let frozenDocsReader: (() => number) | null = null;
export function registerFrozenDocsReader(fn: () => number): void { frozenDocsReader = fn; }
export function unregisterFrozenDocsReader(): void { frozenDocsReader = null; }
export const collabQuotaFrozenDocs = new Gauge({
  name: 'collab_quota_frozen_docs',
  help: '配额冻结 doc 数（文档级注册表 quotaFrozenDocs.size——与连接在线无关）',
  registers: [register],
  collect() { try { this.set(frozenDocsReader?.() ?? 0); } catch { this.set(0); } },
});
/** 入站 sync 帧字节分布（collab 模块 Histogram 首例——exec.metrics 先例；maxTxBytes/maxDocBytes 闸界观测）。 */
export const yjsInboundFrameBytes = new Histogram({
  name: 'yjs_inbound_frame_bytes',
  help: '入站 sync 帧字节分布（beforeSync Update/Step2——帧闸 2×maxTxBytes/maxDocBytes 界内分布）',
  buckets: [1024, 16 * 1024, 64 * 1024, 256 * 1024, 512 * 1024, 1_048_576, 4_194_304, 8_388_608],
  registers: [register],
});

/** ===== Y0b-4 T6（spec §5.2 速率闸三桶+awareness 治理）：1008 断连三计数+剔字段计数 ===== */

/** msg 桶断连（400 帧容量+msgRate/s 补充——close 1008 msg-rate-exceeded，backoff 档瞬态）。 */
export const collabMsgRateExceededTotal = new Counter({
  name: 'collab_msg_rate_exceeded_total',
  help: 'msg 桶断连次数（per-conn 400 帧容量+msgRate/s 补充——close 1008 msg-rate-exceeded）',
  registers: [register],
});
/** bytes 桶断连（容量=maxDocBytes+bytesRate/s 补充——close 1008 bytes-rate-exceeded；"桶容量≥最大合法帧"不变量见 gateway 构造注释）。 */
export const collabBytesRateExceededTotal = new Counter({
  name: 'collab_bytes_rate_exceeded_total',
  help: 'bytes 桶断连次数（per-conn 容量=maxDocBytes+bytesRate/s 补充——close 1008 bytes-rate-exceeded）',
  registers: [register],
});
/** awareness 独立限速断连（共享桶实例+键前缀 aware:${sid}——capacity 60+30/s；close 1008 awareness-rate-exceeded）。 */
export const collabAwarenessRateExceededTotal = new Counter({
  name: 'collab_awareness_rate_exceeded_total',
  help: 'awareness 独立限速断连次数（共享桶+键前缀 aware:${sid}，capacity 60+30/s 补充——close 1008 awareness-rate-exceeded）',
  registers: [register],
});
/** awareness 剔字段计数（reason 值域 read-only|solo|over-8 三档同一原语 stripTransientFields——剔
 *  cursor/selection 保 user/presence 回显；solo/over-8 档 distinct user 判定=文档全量∪本帧，T13）。 */
export const collabAwarenessStrippedTotal = new Counter({
  name: 'collab_awareness_stripped_total',
  help: 'awareness 剔字段次数（reason=read-only|solo|over-8 三档——剔 cursor/selection 保 user/presence 回显；distinct user 判定=文档全量∪本帧）',
  labelNames: ['reason'],
  registers: [register],
});

/** ===== Y0b-4 T7（spec §5.2/Q-F v2）：出站背压三指标 ===== */

/** 一级降级：backlog>1MB 的 awareness 帧 drop 计数（只丢 presence 不丢 doc 同步；判型=readFrameType 单源）。 */
export const collabAwarenessDroppedTotal = new Counter({
  name: 'collab_awareness_dropped_total',
  help: '出站背压一级 awareness 帧丢弃次数（backlog>1MB——只丢 presence 不丢 doc 同步；判型=readFrameType 库解析单源）',
  registers: [register],
});
/** 二级断连：backlog>4MB close(1011) slow-consumer（每 send 判非采样——停滞 socket 内存上界保护）。 */
export const collabSlowConsumerDisconnectTotal = new Counter({
  name: 'collab_slow_consumer_disconnect_total',
  help: '出站背压二级断连次数（backlog>4MB——close(1011) slow-consumer；每 send 判非采样）',
  registers: [register],
});
/** 出站 backlog 直方图（1/10 采样**只归观测**——drop/close 决策每 send 判与采样分离，外审 P1-3；
 *  help 不写 ws 库字段名——census ⑤ 生产读点唯一=wrapBackpressure〔collab.gateway.ts〕）。 */
export const yjsOutboundBacklogBytes = new Histogram({
  name: 'yjs_outbound_backlog_bytes',
  help: '出站 ws 发送积压字节分布（1/10 采样只归观测——决策每 send 判与采样分离）',
  buckets: [16 * 1024, 64 * 1024, 256 * 1024, 1_048_576, 2_097_152, 4_194_304, 8_388_608, 16_777_216],
  registers: [register],
});
/** R4b'（v3）：出站全局预算同步记账 gauge——OutboundBudget.total 单源维护（reserve/release/
 *  close 兜底/60s 对账四处 set；0=无在飞预扣。定义单源=本文件〔SG:39 import 族先例形态〕，
 *  collab-outbound-budget 模块消费）。 */
export const yjsOutboundQueuedBytes = new Gauge({
  name: 'yjs_outbound_queued_bytes',
  help: '出站全局预算预扣字节（OutboundBudget total——预扣-释放+close 兜底+60s 对账回填；0=无在飞预扣）',
  registers: [register],
});
/** R4b'（v3）：全局预算 close 计数——total+frame>outboundBudgetBytes 大帧组 close(1011)
 *  global-budget 的**唯一**计数点（hardCloseWs 内 collabWsCloseTotal 记 close 事件——双计分离）。 */
export const collabOutboundBudgetCloseTotal = new Counter({
  name: 'collab_outbound_budget_close_total',
  help: '出站全局预算 close 次数（大帧组 total+frame>outboundBudgetBytes → 1011 global-budget；与 collab_ws_close_total 事件计数分离——本计数为 global-budget 唯一出口）',
  registers: [register],
});

/** ===== Y0b-4 T8（spec §5.2/Q-G）：shrink 审计四档+同步段时长直方图 ===== */

/** shrink 结果四档：ok=删成达标 / recalibrated=纯校准（含空体）/ still-over=预演超限未写活 doc
 *  （422 同点计数）/ noop=显式空 delete 集。 */
export const collabDocShrinkTotal = new Counter({
  name: 'collab_doc_shrink_total',
  help: 'doc shrink 结果四档（result=ok 删成达标/recalibrated 纯校准/still-over 预演超限未写活 doc/noop 空 delete 集）',
  labelNames: ['result'],
  registers: [register],
});
/** shrink 同步段耗时（读+影子预演+删+活文档再编码——不含信号量排队等待；8MB 标定的输入）。 */
export const collabDocShrinkDuration = new Histogram({
  name: 'collab_doc_shrink_duration_seconds',
  help: 'shrink 同步段耗时秒（读+预演+删+再编码——不含信号量排队；8MB doc 全量编码 ~50-100ms/次为标定输入）',
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

/** Y0b-4 T9（spec §5.2/Q-H）：export-fresh 审计——ok=导出成功落地 / in-flight=并发去重命中
 *  （latch 复用在飞 Promise——create 调用数=1 不变量，主请求/并发命中两档分列计）。 */
export const collabDocExportFreshTotal = new Counter({
  name: 'collab_doc_export_fresh_total',
  help: 'doc export-fresh 结果（result=ok 导出成功/in-flight 并发去重命中复用在飞请求）',
  labelNames: ['result'],
  registers: [register],
});

/** ===== Y0b-4 T9a（spec §5.2/Q-U v6）：vacuum 代际替换审计 ===== */

/** doc 真空残留字节 gauge——口径=Σ docResidue Map（per-doc truth−全根真空重建编码；recheck≥2 轮时
 *  更新）。无 projectId 标签（E54 基调：基数无界+项目 id 不进指标暴露面）；reader 注册模式=
 *  registerPendingCollector 惯例（gateway 注册读数回调，metrics 文件不 import gateway）。 */
let docResidueReader: (() => number) | null = null;
export function registerDocResidueReader(fn: () => number): void { docResidueReader = fn; }
export function unregisterDocResidueReader(): void { docResidueReader = null; }
export const collabDocResidueBytes = new Gauge({
  name: 'collab_doc_residue_bytes',
  help: 'doc 真空残留字节总和（per-doc truth−全根真空重建编码——recheck≥2 轮时更新；观测非 enforcement）',
  registers: [register],
  collect() { try { this.set(docResidueReader?.() ?? 0); } catch { this.set(0); } },
});

/** vacuum 结果七档（Q-U v6+T12 收口 I1.2）：ok=代际替换落地 / skip-low-residue=零连接自动路径
 *  残留不足跳过 / equivalence-failed=等价断言中止（DB 零变更） / unsupported-root=非 Map 根不支持
 *  中止（DB 零变更）/ quiesce-timeout=卸载等待 30s 超时中止（禁降级继续）/ generation-drift=锁内
 *  世代复核漂移中止（④ 装载读后并发换代——DB 零变更）/ error=意外。 */
export const collabDocVacuumTotal = new Counter({
  name: 'collab_doc_vacuum_total',
  help: 'vacuum 文档代际替换结果（result=ok 成功/skip-low-residue 自动路径残留不足跳过/equivalence-failed 等价断言中止 DB 零变更/unsupported-root 非 Map 根中止/quiesce-timeout 卸载等待超时中止/generation-drift 锁内世代漂移中止 DB 零变更/error 意外）',
  labelNames: ['result'],
  registers: [register],
});

/** Y0c T20（Z66 计数半边——四稳态③载体）：同 doc 30s 窗（recheck 周期==quiesce 上界的叠加面）内
 *  ≥2 次自动 vacuum 触发——稳态 0（check-collab-health Z122④ 消费）。计数随 T20 落地（触发判据
 *  同批改读零 WS ∧ 零 direct——Z73 读者③）。 */
export const collabVacuumAutotriggerStackedTotal = new Counter({
  name: 'collab_vacuum_autotrigger_stacked_total',
  help: 'Y0c T20（Z66）：同 doc 30s 窗内≥2 次自动 vacuum 触发计数（周期 30s==quiesce 上界 30s 会叠加——稳态 0；四稳态③判据面）',
  registers: [register],
});

/** ===== Y0b-5 T1（spec §5.6）：客户端遥测端点指标族（sendBeacon→/api/collab/telemetry 一律 204
 *  ——4xx/413=客户端盲重试风暴面）。label 全部服务端枚举有界：type=11 白名单 / code=分配表值+other /
 *  reason=受控词表 / from,to=三值闭集+other；批次级 clientBuild/csv/generation 只走结构化日志
 *  （客户端可控=无界 label 基数面，零 info gauge）。detail 键域唯一来源=shared TELEMETRY_DETAIL_SCHEMA
 *  （sanitizeTelemetryDetail 单源净化——本文件不复制值域表）。 */
export const collabTelemetryEventsTotal = new Counter({
  name: 'collab_telemetry_events_total',
  help: '客户端遥测事件计数（type=11 白名单枚举——未知 type 不进本指标见 unknown_total）',
  labelNames: ['type'],
  registers: [register],
});
export const collabTelemetryCloseTotal = new Counter({
  name: 'collab_telemetry_close_total',
  help: '客户端上报 close_code 分布（code=分配表值，越界折 other 防基数）',
  labelNames: ['code'],
  registers: [register],
});
export const collabTelemetryAuthRejectTotal = new Counter({
  name: 'collab_telemetry_auth_reject_total',
  help: '客户端上报 auth_reject 分布（reason=CollabAuthReason 词表，越界折 other）',
  labelNames: ['reason'],
  registers: [register],
});
export const collabTelemetryWsReasonTotal = new Counter({
  name: 'collab_telemetry_ws_reason_total',
  help: 'ws_status 异常原因（reason=unsynced-lag/local-cache-degraded，越界折 other）',
  labelNames: ['reason'],
  registers: [register],
});
export const collabTelemetryWsTransitionTotal = new Counter({
  name: 'collab_telemetry_ws_transition_total',
  help: 'ws 状态迁移计数（from/to∈connecting/connected/disconnected 三值闭集，越界折 other）',
  labelNames: ['from', 'to'],
  registers: [register],
});
export const collabTelemetryProjectionMs = new Histogram({
  name: 'collab_telemetry_projection_ms',
  help: '客户端投影耗时毫秒分布（projection_duration.ms——非 number 剥键防 observe 炸）',
  buckets: [5, 25, 100, 500, 2500],
  registers: [register],
});
/** Y0b-5 T2（控制器裁决——裁定 24 SLO 两条直方图，通道=ws_status detail ms 扩键）：hydration/reconnect
 *  时长毫秒分布。形态判别在 telemetry.service dispatch：hydration={from:'connecting',to:'connected'}
 *  （initCollab→ready）/reconnect={from:'disconnected',to:'connected'}（掉线→authenticated）——真实迁移对
 *  不携带 ms 不 observe（ms 数值守卫在 shared sanitize）。零 label（直方图按时长分桶——无基数面）。 */
export const collabTelemetryHydrationMs = new Histogram({
  name: 'collab_telemetry_hydration_ms',
  help: '客户端 hydration 时长毫秒分布（ws_status ms 携带——initCollab→ready，from=connecting,to=connected 形态分派）',
  buckets: [50, 250, 1000, 5000, 15000],
  registers: [register],
});
export const collabTelemetryReconnectMs = new Histogram({
  name: 'collab_telemetry_reconnect_ms',
  help: '客户端重连时长毫秒分布（ws_status ms 携带——掉线→authenticated，from=disconnected,to=connected 形态分派）',
  buckets: [50, 250, 1000, 5000, 15000],
  registers: [register],
});
export const collabTelemetryUnknownTotal = new Counter({
  name: 'collab_telemetry_unknown_total',
  help: '白名单外 type 计数（不记 type 值——客户端自由字符串禁进 label）',
  registers: [register],
});
/** Y0b-5 T8（E33 指定的 E26 重建触发源）：客户端本地 doc 编码字节分布——ws_status detail.docBytes
 *  随批量上送（记录点=最近一次快照尺寸，客户端零新增 encode）。观测非执法（E26 重构触发判读面）。 */
export const collabTelemetryClientDocBytes = new Histogram({
  name: 'collab_telemetry_client_doc_bytes',
  help: '客户端本地 doc 编码字节分布（ws_status docBytes 携带——最近快照尺寸；观测非执法）',
  buckets: [16 * 1024, 64 * 1024, 256 * 1024, 1_048_576, 4_194_304, 8_388_608],
  registers: [register],
});
export const collabTelemetryRejectedTotal = new Counter({
  name: 'collab_telemetry_rejected_total',
  help: '批次/单条拒绝计数（reason=batch-size 超12/event-bytes 单条>512B/sample-cap 单type>5）',
  labelNames: ['reason'],
  registers: [register],
});

/** ===== Y0b-5 T16（spec §5.9 E57）：PG 熔断两指标（范围=新装载/新会话准入+store PG 分支短路；
 *  不裹 lease 心跳/不拒 WS 帧路径——调用点恰三见 gateway 静态锚）===== */

/** 熔断三态 gauge（0=closed/1=open/2=half-open——单值语义，告警判据 >0）。
 *  open=准入拒+store 短路 spool（冷却 10s 后转 half-open，下一次调用为探测）。 */
export const collabPgBreakerState = new Gauge({
  name: 'collab_pg_breaker_state',
  help: 'PG 熔断三态（0=closed/1=open 准入拒+store 短路 spool/2=half-open 探测中——误开最长 10s 冷却窗快速失败自愈）',
  registers: [register],
});
/** 失败分类计数（class=connection 连接族参与推闸/pool P2024 池满与 other 业务错+无 code 只观测不推闸
 *  ——压力期拒新装载=赶走用户方向反了）。 */
export const collabPgBreakerFailuresTotal = new Counter({
  name: 'collab_pg_breaker_failures_total',
  help: 'PG 调用失败分类（class=connection 连接族 P1001/P1002/P1008 参与熔断推闸/pool P2024 池满/other 业务错与无 code——后两档只观测）',
  labelNames: ['class'],
  registers: [register],
});

/** ===== Y0c T15（片 A2 常驻化/Z59·Z109·Z111·Z113）：常驻会话面 ===== */

/** acquire 遇 releasing 有限等待超时计数（Z109③——同 pid acquire 永不因 releasing 无界等待；
 *  超时即新开 conn 入表，等待上界=RELEASE_TIMEOUT_MS 与释放硬超时同源）。 */
export const collabAcquireWaitTimeoutTotal = new Counter({
  name: 'acquire_wait_timeout_total',
  help: 'acquire 遇 releasing 有限等待超时次数（Z109——超时即新开 conn，同 pid acquire 永不无界等待；上界与释放硬超时 5s 同源）',
  registers: [register],
});

/** releaseSessionFor disconnect 5s 硬超时计数（Z109③ zombie 档——disconnect→store→spool fsync
 *  磁盘挂起无界，上界与 repo.append 事务上界同源；超时 conn 置 zombie+挂起释放自清理延续，
 *  懒重建=下次 acquire 自然新开并替换条目）。 */
export const collabWriteSessionReleaseTimeoutTotal = new Counter({
  name: 'collab_write_session_release_timeout_total',
  help: 'releaseSessionFor disconnect 5s 硬超时次数（Z109 zombie 档——store/spool fsync 挂起；懒重建：下次 acquire 自然新开）',
  registers: [register],
});

/** 会话表周期对账漂移计数（Z113②——不变量：held 条目 conn.document 在∧directConnectionsCount≥1；
 *  zombie/releasing 档例外豁免——disconnect 已 removeDirectConnection〔esm:1148〕count 恒 0 非漂移）。 */
export const collabResidencyReconcileDriftTotal = new Counter({
  name: 'collab_residency_reconcile_drift_total',
  help: '会话表对账漂移计数（Z113——held 条目 conn 引用缺失或 directConnectionsCount<1；非 held 档例外豁免）',
  registers: [register],
});

/** releaseSessionFor 入口 refCount>0 释放入口守卫计数（T15 收尾 M-5——释放时仍有在飞会话引用=
 *  调用方纪律违规观测；仅可见性不改行为——调用方纪律归 T17 tryRelease 统一收口，届时稳态 0）。 */
export const collabResidencyReleaseInflightTotal = new Counter({
  name: 'collab_residency_release_inflight_total',
  help: 'releaseSessionFor 入口 refCount>0 释放入口守卫计数（T15 M-5——释放时有在飞引用的调用方纪律违规观测，仅可见性；T17 tryRelease 收口后稳态 0）',
  registers: [register],
});

/** 装载降级 doc 数 gauge（Z111——pendingStructs/pendingDs 非空 degradedDocs 集合可见化；
 *  常驻阻断判据载体：degraded doc 不入会话表。reader 注册模式=pendingCollector 惯例
 *  （gateway 注册读数回调，metrics 文件不 import gateway——反向依赖禁止））。 */
let degradedDocsReader: (() => number) | null = null;
export function registerDegradedDocsReader(fn: () => number): void { degradedDocsReader = fn; }
export function unregisterDegradedDocsReader(): void { degradedDocsReader = null; }
export const yjsDegradedDocs = new Gauge({
  name: 'yjs_degraded_docs',
  help: '装载降级 doc 数（pendingStructs/pendingDs 非空——Q-O 降级可观测；Z111：degraded doc 不入常驻会话表，>0 挂巡检阈值归 T29 health）',
  registers: [register],
  collect() { try { this.set(degradedDocsReader?.() ?? 0); } catch { this.set(0); } },
});

/** canvasDocUpdate 总行数 gauge（Y0c T29-II——Z125-5 口径：**观测项非机制项**，不强制 compact；
 *  常驻后 store 频次结构性变高——行数突破 60s 稳态可预警〔health WARN〕；行数门归 Y1c-3 再裁）。
 *  reader 注册模式=registerDegradedDocsReader 同款（gateway 注册回调，metrics 文件不 import gateway
 *  ——反向依赖禁止）；reader 为 async（prisma canvasDocUpdate.count()，每 scrape 一次——每 5min
 *  巡检面可接受）——prom-client collect 支持 promise（register.metrics()/get() 等待）。worker 进程
 *  无 gateway⇒无 reader⇒折 0（degradedDocs 同款语义）。 */
let updatesRowsReader: (() => number | Promise<number>) | null = null;
export function registerUpdatesRowsReader(fn: () => number | Promise<number>): void { updatesRowsReader = fn; }
export function unregisterUpdatesRowsReader(): void { updatesRowsReader = null; }
export const yjsUpdatesRowsTotal = new Gauge({
  name: 'yjs_updates_rows_total',
  help: 'canvasDocUpdate 总行数（_total 后缀系 spec Z125-5 定名，实为 gauge；观测项非机制项——行数突破 60s 稳态可预警，行数门归 Y1c-3 再裁；reader=prisma count 每 scrape 一次）',
  registers: [register],
  async collect() { try { this.set(await (updatesRowsReader?.() ?? 0)); } catch { this.set(0); } },
});

/** ===== Y0c T16（片 A2 reaper/Z106·Z93·Z126·Z110·偏离 24）：常驻双层约束+驱逐观测 ===== */

/** 常驻会话面 gauge collect 源（bytes=Σ held 条目 bytes 缓存〔reaper tick 刷新——单源
 *  gateway.docBytesOf(truth+delta)〕/docs=held 条目数〔过渡档不计——与 bytes 口径对齐〕；
 *  reader 注册模式=awarenessReader 惯例——residency 注册读数回调，metrics 文件不 import service
 *  ——反向依赖禁止）。 */
let residentReader: (() => { bytes: number; docs: number }) | null = null;
export function registerResidentReader(fn: () => { bytes: number; docs: number }): void { residentReader = fn; }
export function unregisterResidentReader(): void { residentReader = null; }
export const yjsResidentBytes = new Gauge({
  name: 'yjs_resident_bytes',
  help: '常驻会话 doc 字节总和（Σ(truth+delta) 缓存——tick 刷新；字节主约束 Z106 判据载体，Z145 绝对主判据输入）',
  registers: [register],
  collect() { try { this.set(residentReader?.().bytes ?? 0); } catch { this.set(0); } },
});
export const yjsResidentDocs = new Gauge({
  name: 'yjs_resident_docs',
  help: '常驻会话 held 条目数（zombie/releasing 过渡档不计——与 yjs_resident_bytes Σheld 口径对齐；条目次约束护栏，默认 64=待实测校准近似 Z132②，T22 回填）',
  registers: [register],
  collect() { try { this.set(residentReader?.().docs ?? 0); } catch { this.set(0); } },
});

/** 双层约束超限计数（Z106④——超限=临时超过+WARN+本计数，永不拒载 Z55；稳态 0）。 */
export const yjsResidentOverLimitTotal = new Counter({
  name: 'yjs_resident_over_limit_total',
  help: '常驻双层约束超限计数（字节/条目任一超限的 tick 次数——超限=临时超过+WARN，永不拒载 Z55/Z106）',
  registers: [register],
});

/** 驱逐计数（Z93+偏离 24）：reason=ttl 空闲到期/lru 双层约束回收/forced heap 闸〔Z126①〕或
 *  store 失败强制淘汰〔Z110〕/degraded 运行期退化提前逐出〔偏离 24——诊断价值高于并入 ttl〕。 */
export const yjsDocEvictedTotal = new Counter({
  name: 'yjs_doc_evicted_total',
  help: '常驻会话驱逐计数（reason=ttl 空闲到期/lru 双层约束回收/forced heap 闸或 store 失败强制淘汰/degraded 运行期退化提前逐出）',
  labelNames: ['reason'],
  registers: [register],
});

/** 驱逐时驻留时长直方图（Z93——heldSince 起算；会话 TTL/双层约束/heap 闸三断点的驱逐时长分布，
 *  「环路有界」从事后论证变可读数）。 */
export const yjsDocEvictedResidencySeconds = new Histogram({
  name: 'yjs_doc_evicted_residency_seconds',
  help: '驱逐时驻留时长秒分布（Z93——冻结 doc 驻留时长落档，事故复盘自证 Z70 降级无环）',
  buckets: [1, 5, 15, 30, 60, 120, 300, 600, 1800, 3600],
  registers: [register],
});

/** 强制淘汰 unloadDocument 直调失败计数（Z110——条目已清不回滚；失败=库谓词未过〔saveMutex/
 *  残余连接〕或卸载钩子拒绝，残留 doc 由 disconnect 尾程/下轮 tick 承接）。 */
export const yjsForceEvictFailureTotal = new Counter({
  name: 'yjs_force_evict_failure_total',
  help: 'store 失败强制淘汰 unloadDocument 直调失败次数（Z110——淘汰本身不回滚，失败仅告警计数）',
  registers: [register],
});

/** ===== Y0c T17（Z129/Z143）：统一释放入口 tryRelease 两拒绝计数 ===== */

/** 常规档拒绝计数（Z129 字面+Z141 两前置+refCount 在用纪律收口）——四稳态判据
 *  release_with_pending=0 的载体（T20 扩表消费；稳态 0=三出口无批中强释）。 */
export const yjsReleaseWithPendingTotal = new Counter({
  name: 'yjs_release_with_pending_total',
  help: 'tryRelease 拒绝释放计数（motive 六档——常规档 Z141 两前置违例〔pending 批在途/取批在飞〕/会话在用 refCount>0；带批档取批在飞窗或交接后复用重验；四稳态判据载体，稳态 0）',
  labelNames: ['motive'],
  registers: [register],
});

/** 带批档（force-evict/shutdown）spool 交接失败拒绝（Z143②——与逐会话超预算〔归 T18〕两口径分离；
 *  关停 18s drain 前无声放弃会话的可观测出口）。 */
export const yjsReleaseHandoffFailedTotal = new Counter({
  name: 'yjs_release_handoff_failed_total',
  help: 'tryRelease 带批档 spool 交接失败拒绝计数（Z143：条目保留 hold 交 drainAllDocuments 兜底，拒绝该会话非放弃整批）',
  registers: [register],
});

/** ===== Y0c T18（Z81/Z143/Z114）：关停步骤 0 全形态观测 ===== */

/** releaseAllSessions 预算拒绝计数（Z143 双计数第三面——超预算）：scope=session 逐会话 disconnect
 *  段超 300ms（条目留表 zombie 档自延续）/scope=total 总预算 2s 破停止处理剩余会话（逐个点名留
 *  hold——shutdown 交 drainAllDocuments/self-isolate 交 reaper TTL 兜底）。与 handoff_failed
 *  （交接失败）口径分离——关停 18s drain 前会话被放弃的三面各自可观测。 */
export const yjsReleaseBudgetExceededTotal = new Counter({
  name: 'yjs_release_budget_exceeded_total',
  help: 'releaseAllSessions 预算拒绝计数（scope=session 逐会话 disconnect 段超 300ms/scope=total 总预算 2s 破剩余会话跳过——Z143 与交接失败计数分离；留 hold 交 drain/reaper 兜底）',
  labelNames: ['scope'],
  registers: [register],
});

/** 关停步骤 0 后 ΣdirectConnectionsCount 非零计数（Z81 硬失败口径——泄漏非预算：交接失败/取批在
 *  飞窗 rejected-pending/总预算跳过留 hold 的会话仍持 direct conn；每次关停至多 1——首报 latch，
 *  Nest DI 反序双调〔residency 钩子+gateway 步骤 0〕不双烧；非零=destroy_timeout 必发前的显式点名）。 */
export const yjsShutdownDirectLeakTotal = new Counter({
  name: 'yjs_shutdown_direct_leak_total',
  help: '关停步骤 0 释放后 ΣdirectConnectionsCount 非零计数（Z81 泄漏口径非预算——交接失败/取批在飞窗拒绝/预算跳过留 hold 均触发；每次关停至多 1：首报 latch，Nest DI 双调不双烧）',
  registers: [register],
});

/** Z114① drain 两数：时长 gauge（单次关停单值——last 即落档）+处理 doc 数 counter。常驻后 drain
 *  从秒级变数十秒级需可读数；18s hardDeadline 按实测重标归 T22 内存实测轮回填（Z114②）。 */
export const collabDrainDurationSeconds = new Gauge({
  name: 'collab_drain_duration_seconds',
  help: '关停 drainAllDocuments 时长秒（单次关停单值 last 即落档——Z114：常驻后 drain 从秒级变数十秒级需可读数）',
  registers: [register],
});
export const collabDrainProjectsTotal = new Counter({
  name: 'collab_drain_projects_total',
  help: '关停 drain 处理 doc 数（进入 drainAllDocuments 处理的 doc 计——空队列 continue 不计）',
  registers: [register],
});

/** ===== Y0c T0（spec 片 C0/Z3/Z107/Z134/Z138）：运行面观测基座 ===== */

/** Y0c T8（片 A1/Z108/Z40）：writeBatch 业务级拒绝计数——reason 闭集：
 *  ① Z108 校验码七值（UNKNOWN_KEY/PATCH_TOO_LARGE/OP_COUNT_EXCEEDED/UNKNOWN_OP/PROTO_KEY_BANNED/
 *  VALUE_TYPE_MISMATCH/NON_IDEMPOTENT_OP——shared WriteBatchViolationCode 单源）
 *  ② 写守卫 reason 五值（node-deleted/no-node-map/missing-attempts/older-attempts/terminal-superseded
 *  ——collab-doc-writer.service 头注词表；Z40② 守卫失败=合法结果进数组，本计数=其唯一统一观测面）
 *  ③ Y0c T9 增 DOC_SCHEMA_AHEAD（schema 前瞻档事务级 throw——throw 前计数，spec §6「拒写+reason 计数」）。 */
export const collabWriteRejectedTotal = new Counter({
  name: 'collab_write_rejected_total',
  help: 'writeBatch 业务级拒绝计数（reason=Z108 校验码七值+写守卫 reason 五值+DOC_SCHEMA_AHEAD 前瞻档——守卫失败亦计，统一观测面）',
  labelNames: ['reason'],
  registers: [register],
});


/** doc 物化装载计数——loadDocument hook 成功路径单点（拒绝早退不计；库 createDocument
 *  loadingDocuments 去重 ⇒ hook 每次物化至多触发一次）。trigger 归因=直连开窗标记
 *  （noteDirectLoad——withDoc openDirectConnection await 窗内命中即 direct）否则 ws；
 *  reconciler（对账探针）归因接线归片 A2（Z112 注释同批更新——探针现经 withDoc 走 direct 窗）。
 *  片 A 验收主锚：TTL 窗内 N 连续作业 load{trigger='direct'}==1（Z107 判据 A）。 */
export const yjsDocLoadTotal = new Counter({
  name: 'yjs_doc_load_total',
  help: 'doc 物化装载计数（loadDocument 成功路径单点；trigger=ws WS 连接引发/direct withDoc 直连引发/reconciler 对账探针引发——A2 接线）',
  labelNames: ['trigger'],
  registers: [register],
});

/** 直连开窗标记（模块级 Set——awarenessReader reader 同文件状态先例；gateway 与 doc service 双向
 *  不互 import，经本单源横贯即免 mock gateway 形态漂移）。标记=withDoc open await 窗；
 *  装载命中即消费（一次性），未装载（doc 常驻/open 失败）由 withDoc finally 消费清残留。
 *  并发语义：WS 物化与 withDoc open 窗重叠时，单次装载的一次性消费整体归其中一个触发方
 *  （标记只被消费一次，另一方计 ws——装载计数总量不变，纯归因级噪声，Z107 判据 A 场景不受影响）。 */
const directLoadHints = new Set<string>();
export function noteDirectLoad(projectId: string): void { directLoadHints.add(projectId); }
export function consumeDirectLoad(projectId: string): boolean { return directLoadHints.delete(projectId); }

/** store 非 noop 落库计数——storeDocumentUnlocked 取批后单点（noop 空转早退不计）。
 *  trigger=调用方归因（CollabStoreTrigger）：debounce hooks 直通（库防抖窗到期/断连冲刷同钩子）/
 *  soft 软阈提前（64 条/1MB 闩锁）/disconnect onDisconnect 收尾/retry 退避梯/drain 关停排空/
 *  flush flushDocument 显式交付判定（T14）。
 *  Z107 判据 C：单调 ≤⌈编辑窗/maxDebounce⌉+2；单节点执行链 ≤2 锚。 */
export type CollabStoreTrigger = 'debounce' | 'soft' | 'disconnect' | 'retry' | 'drain' | 'flush' | 'maintenance';
// Y1c T9（偏离 38①）：'debounce' 随 onStoreDocument 旧链拆除退出现役（telemetry-only 后零生产调用方
// ——登记保留历史读数）；'maintenance'=维护写独立 append 通道归因（非 connection 帧的 WAL+PG 落定）。
export const yjsStoreTotal = new Counter({
  name: 'yjs_store_total',
  help: 'store 非 noop 落库计数（取批后单点；trigger=debounce 库防抖窗+断连冲刷/soft 软阈提前/disconnect 断连收尾/retry 退避梯/drain 关停排空/flush flushDocument 显式交付判定）',
  labelNames: ['trigger'],
  registers: [register],
});

// ═══ Y1c T9：spool-first 写管线核心（CollabProjectActor）观测面 ═══
/** actor drain 批计数：批窗收批三条件（≤20ms 自最老帧/≤1MiB/空闲 1ms）+批帧数直方图锚。 */
export const actorDrainBatchTotal = new Counter({
  name: 'collab_actor_drain_batch_total',
  help: 'CollabProjectActor drain 批计数（一次 WAL appendBatch+fsync→逐帧 apply→逐帧 resolve）',
  labelNames: ['result'],
  registers: [register],
});
export const actorDrainBatchFrames = new Histogram({
  name: 'collab_actor_drain_batch_frames',
  help: 'actor drain 批帧数分布（批验证锚：5 连接×2 帧=单批 10 帧）',
  buckets: [1, 2, 5, 10, 20, 50, 100],
  registers: [register],
});
/** 帧级结果（ACK 档位前置面——resolve=fsync+apply 后放行；noop=readOnly/冻结/applied 去重命中）。 */
export const actorFrameOutcomeTotal = new Counter({
  name: 'collab_actor_frame_outcome_total',
  help: 'actor 帧级处置计数（applied=fsync+apply 后 resolve；noop-readonly/noop-frozen=短路；noop-dedup=SHA-256 命中；reject-4411=毒帧；reject-4412=pending 区间）',
  labelNames: ['outcome'],
  registers: [register],
});
/** SHA-256 去重 promise map 命中分档（inflight=await 原帧；applied=no-op）。 */
export const actorDedupHitTotal = new Counter({
  name: 'collab_actor_dedup_hit_total',
  help: 'actor in-flight/applied 去重命中计数（零重复 walSeq 的进程内防线——跨重启由 WAL 去重索引承接）',
  labelNames: ['state'],
  registers: [register],
});
/** SS2 大帧并发信号量：acquire/deny（全局内存预算+per-project 1——偏离 38⑱）。 */
export const ss2SemaphoreTotal = new Counter({
  name: 'collab_ss2_semaphore_total',
  help: 'SS2 大帧并发信号量计数（acquire=放行解码/apply；deny=预算拒——瞬态 close 1008）',
  labelNames: ['outcome'],
  registers: [register],
});
/** per-connection 入站排队字节上限超限 close 1009（2×ss2FrameGate）。 */
export const inboundQueueOverLimitTotal = new Counter({
  name: 'collab_inbound_queue_over_limit_total',
  help: '认证后 per-connection 入站排队字节超 2×ss2FrameGate 上限的 close 1009 计数',
  registers: [register],
});
/** per-project 写入背压（偏离 36-③）：队列上限拒收。 */
export const projectBackpressureTotal = new Counter({
  name: 'collab_project_backpressure_total',
  help: 'per-project actor 队列写入背压拒收计数（单项目不拖垮其他项目）',
  registers: [register],
});
/** 毒帧协议触发（WAL 截断至 appliedSeq+4411+从 pgSeq 重放——POISON_FRAME_PROTOCOL）。 */
export const actorPoisonFrameTotal = new Counter({
  name: 'collab_actor_poison_frame_total',
  help: '毒帧协议触发计数（同步关项目全部连接（广播 flush 前）+停写+WAL 截断至 appliedSeq+4411）',
  registers: [register],
});
/** onStoreDocument 旧链拆除后的 telemetry 探针（偏离 38①——所有权切换验收：connection-origin 恒 0）。 */
export const legacyStoreHookProbeTotal = new Counter({
  name: 'collab_legacy_store_hook_probe_total',
  help: 'onStoreDocument telemetry-only 探针（旧链已拆——connection-origin 恒 0；非 connection 维护写经独立通道不经此钩子）',
  labelNames: ['origin'],
  registers: [register],
});
/** FrameEffects 收集器产出（per-transaction 清空/取走——T24/T26 消费）。 */
export const frameEffectsTotal = new Counter({
  name: 'collab_frame_effects_total',
  help: 'FrameEffects 收集器按 kind 计数（apply 后 actor 临界区内为准——FRAME_EFFECTS_TIMING_AUTHORITY）',
  labelNames: ['kind'],
  registers: [register],
});

/** T14（plan v11.2 片 S4——Z18''④/:30 四分叉裁定④）：flushDocument 交付判定出口计数（五分支
 *  闭集——T15 投影 poller 落地前的观测面；retry-spooled 持续增长=G58「spooled 无限重试+告警」
 *  的告警载体——PG 长停机值班信号，非失败计数）。 */
export const collabFlushDocumentOutcomeTotal = new Counter({
  name: 'collab_flush_document_outcome_total',
  help: 'flushDocument 交付判定出口计数（outcome=persisted/retry-spooled〔磁盘安全无限重试——G58 告警面〕/retry-failed〔耗 attempts 档〕/terminal-fenced/terminal-fk）',
  labelNames: ['outcome'],
  registers: [register],
});

/** withDoc open 段耗时——起点=openDirectConnection 之前（Y0b-5 T10 原计时从 open 后起算，
 *  装载时间不可见）。与前移起点的 yjs_withdoc_duration_seconds（全路径）相减=落库+业务段，
 *  分辨「装载慢 vs 落库慢」。 */
export const yjsWithdocOpenDuration = new Histogram({
  name: 'yjs_withdoc_open_duration_seconds',
  help: 'withDoc open 段耗时秒（起点=open 之前——含物化装载段；与全路径 yjs_withdoc_duration_seconds 分辨装载慢 vs 落库慢）',
  buckets: DURATION_BUCKETS_SECONDS,
  registers: [register],
});

/** 逃生舱触发计数（kind 五值闭集；spec §4.3 sink=客户端遥测——现遥测 12 值封闭集无载体 type，
 *  接线随客户端上报归 Y1c-1 同批）。基线+趋势判据（Z54）：生产稳态=0，非零进 P0——
 *  每个计数=一个用户处于数据风险。 */
export const collabEscapeHatchTotal = new Counter({
  name: 'collab_escape_hatch_total',
  help: '逃生舱触发计数（kind=safeReload/generation/diverged/backup-export/client-doc-rebuild——生产稳态 0 非零进 P0；遥测 sink 接线归 Y1c-1）',
  labelNames: ['kind'],
  registers: [register],
});

/** event-loop lag（Z50——api/worker 两侧 {role} 由引导层 defaultLabels 注入，非本指标 labelName；
 *  Z134 族名=event_loop_lag）。实现=monitorEventLoopDelay 累计直方图 → sampleEventLoopLag 取窗均
 *  observe+reset（unref timer 30s 周期；空窗 0=真观测非缺样本）。worker 侧同款归 T29。 */
export const collabEventLoopLagSeconds = new Histogram({
  name: 'event_loop_lag_seconds',
  help: 'event-loop lag 秒分布（monitorEventLoopDelay 30s 窗均值采样+reset——主线程阻塞补充信号；sharp/ffmpeg 面归 worker T29）',
  buckets: DURATION_BUCKETS_SECONDS,
  registers: [register],
});
export const EVENT_LOOP_LAG_SAMPLE_INTERVAL_MS = 30_000;
const eventLoopLagSampler = monitorEventLoopDelay();
eventLoopLagSampler.enable();
/** 采样单步（导出供单测直调——生产由下方 unref timer 周期驱动） */
export function sampleEventLoopLag(): void {
  const meanNs = eventLoopLagSampler.mean;   // NaN=无样本（enable 后首窗前）
  collabEventLoopLagSeconds.observe(Number.isFinite(meanNs) ? meanNs / 1e9 : 0);
  eventLoopLagSampler.reset();
}
const eventLoopLagTimer = setInterval(sampleEventLoopLag, EVENT_LOOP_LAG_SAMPLE_INTERVAL_MS);
eventLoopLagTimer.unref();   // 不阻进程退出（Nest 关停/vitest 收尾）

/** Y0c T23（Z67③）：进程角色 info 型 gauge——值恒 1，role 标签携带 COLLAB_ROLE 值
 *  （api/worker/all）。set 点=main.ts 引导层（单点；worker 侧 main-worker 归 T26）——
 *  单进程 all 与生产 api/worker 分进程形态在 /metrics 读数上可区分。 */
export const collabRoleInfo = new Gauge({
  name: 'collab_role_info',
  help: '进程角色（COLLAB_ROLE=api|worker|all；info 型 gauge 恒 1，role 标签携带值——set 点在 main.ts 引导层）',
  labelNames: ['role'],
  registers: [register],
});

/** Y1c T10（偏离 37⑩+38⑤ doc 卸载纪律）：卸载被拒计数——beforeUnloadDocument drain applied→PG
 *  失败（PG 不可用/隔离态/fenced）时 throw=拒绝卸载（doc 常驻 fail-closed）的留痕面。 */
export const docUnloadBlockedTotal = new Counter({
  name: 'doc_unload_blocked_total',
  help: 'beforeUnloadDocument 拒绝卸载次数（applied 前缀未能 drain 至 PG——doc 常驻 fail-closed；PG 不可用/隔离/fenced 档）',
  registers: [register],
});
