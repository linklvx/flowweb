<!-- doc-status: draft-v2.5 | created_at: 2026-10-06 | note: Y0a 数据完整性批 design spec v2.5——v2.1 经第四轮外审（2026-10-06，针对 Y0a-1 plan 的三份报告，含 yjs SV 语义探针实证）收敛修订：SV inline 哨兵删除（pendingStructs 检查通过前提下恒真+每 compact N 次编码纯成本——svDominates 沉纯函数锚复用 sv.util decodeStateVector）/预检自愈改"超时自愈一次"（原预检=每次装载全量 detoast 聚合且 48MB 阈对 116KB 存量永不触发）/Proxy 故障器砍除（failingRepo stub+Y0a-2 DB 触发器注入）/storeInFlight 移 Y0a-2（Y0a-1 挂回灌路径恒 0=死代码）；探针前置纪律立项（新守卫/哨兵必须附 5 分钟证伪探针）；v2.3（同日第五轮 plan 外审回馈）：超时自愈改**分类触发**（契约 13/§3-1.4/§7.2——仅 P2028/P2024/P1008/timeout 类自愈+compact 独立预算 maxWait:2s，非可重试类直接 fail-closed；§7.2 残留 v2.1 预检句同步清除）、Y0a-3 登记 gateway.spec disconnectDelay 时序注记重写、E43② 注记 load 回灌位点 peek/consume 已随 Y0a-1 前移落地；v2.4（同日第五~七轮外审收敛）：**append 返回契约 AppendResult**（fenced=0 行不抛异常，BOI 伪代码照常 splice=静默蒸发——fenced 并入失败路径+契约 15）、**readSnapshotOnly 撤"无事务单读者"**（重开 E20 撕裂+违契约 1——改 readConsistent 单 RR 事务两出口）、**自愈分类去 P2024**（池饥饿非事务超时，自愈动作自身需池连接=零成功率纯放大；预算 60s→自愈增量 ≤8s）、**G-1 改双模式 quiescence barrier**（去抖窗观测盲区致已接受集录小=假通过）、**G-2 拆 a/b**（"构造性为 0"不可证伪违 D13）、**部署拒重启改 /api/drain 三步**（前置判据稳态恒假=每次必 force=门禁失效；draining 60s 自动解除防僵尸）、**fence 加 TTL 双校验+leaseRowMissing 区分**（租约行缺失静默 fence 全部写入=伪装正常 fence 的配置错误）、**compact 返回 {compacted,reason}**（实现走 throw 会被 :297-301 catch 记 WARN=污染 abandoned P0 告警线）、**quarantine 改 sidecar**（追加-only 段内移帧物理不可行→坏帧段永不回收→256MB 慢速只读）、**project.gone 不动 spool 段**（emit 先于事务提交，回滚即丢台账）、**关停预算压 ≤22s**（原加算 30s≠28s 且步骤 1 直连无界）、epoch BigInt 序列化改 string、FORCE_TAKEOVER 审计复用 AuditLog、setLeaseOwner 单点注入、冒烟自建 FK 行、§3.1 补 1.10 stash 工作项；v2.5（2026-10-08）：Y0a-3 SV1-16 回填——fence owner-only/break-glass 替 FORCE/rejoin 状态机/八值 ready+collabState/drain 冻结/读侧三分法/spool 子目录+两口径/int 专用池；v2.5 落地=Y0a-3 执行（2026-10-08） -->
# Y0a 数据完整性批——设计 spec（v2.5）

日期：2026-10-06（v1-v2.3 同日；v2.4 第五~七轮外审收敛——新机制失败分支推演回馈 spec）；v2.5（2026-10-08，Y0a-3 SV1-16 回填）
批次定位：Y0 系拆分 1/3（E31）。**上线门槛组成批**（E39：★上线门槛=0 号+**Y0a**+Y0b+Y0.5+Y1a+Y1b+Y1c-2 三项）。
执行方式：TDD（superpowers，红-绿-重构）；TypeScript strict。

---

## 0. 顶层目标（可证伪出口；非门禁清单）

> **Y0a 出口 = 以下四条全部成立：**
>
> 1. **`kill -9` 后重放 ⊇ 崩溃前"已接受"的编辑集**——RPO 故障腿 0 行丢失。**判定 oracle（v2.4 双模式 quiescence barrier——原"轮询 batches===0 即录集"在去抖定时器观测盲区会录小已接受集=假通过）**：`/api/ready` 暴露 `pending{projects,batches,spoolFiles,spoolBytes}`（字段定义见 §3.3）。**正常模式**：驱动脚本**停写**→轮询 `pending.projects===0 ∧ pending.batches===0` 且该状态**持续 ≥maxDebounce(3s)**→此刻序号集=已接受集（全部已落 PG）→kill -9→重启→断言恢复态 ⊇ 该集合。**故障注入模式**（DB 触发器拒写，§2.3 已定）：停写→轮询 `projects===0 ∧ batches===0 ∧ spoolBytes 连续 2 次采样不变`→已接受集=已写序号全集（全部在 spool）→kill -9→重启回灌→断言 ⊇。`spoolFiles>0` 只作故障模式的附加证据，不作接受条件；正常腿 ≤maxDebounce 3s 内存窗口明示不属此判据（见 §5.1）。
> 2. **`SIGTERM` 后批次归属要么落定、要么被如实点名（v2.4 拆 G-2a/G-2b——原"force-spool 使 storeInFlight 构造性为 0"依赖 spool 可写这一 spec 自认可能不成立的先决条件，判据取值由被测对象自身决定=不可证伪，违 D13）**。storeInFlight 口径 v2.1 重定义：**进入过 store 取批路径、但退出时既未 append 成功也未 fsync 入 spool 的批次数**（计数器载体随 Y0a-2 spool 同批落地；形态=prom-client Gauge+enter/leave 与批次归属转移同点，增减点恒 2 处见契约 14）。**G-2a（运维后置条件）**：SIGTERM 演练后——(i) storeInFlight===0；或 (ii) spool 不可写（演练注入磁盘/权限故障）时，关停结构化日志 `{event:'shutdown_undrained', batches, docs}` 与 storeInFlight 值一致、且 ready 在关停前已转 not-ready（熔断可见）——判据是"归属要么落定、要么被如实点名"，不是"恒为 0"；drain 末步**尝试** force-spool：成功则该批归属落定，失败则留 doc 队列并如实点名（不得声称 0）。**G-2b（机制判据，storeInFlight 口径的真正证明载体）**：注入"append 失败+spool 写失败"→断言批仍在 doc 队列（BOI 红→绿，§6.1 已有此门）。库去抖定时器内未被取走的批=正常腿窗口，明示不属此判据（v2 原口径对去抖窗口恒真=假门禁，违 D13）。
> 3. **第二实例结构性无法接流**——未持租约的进程：不 listen、WS 升级拒绝、REST→doc 写路径（withDoc/loadDocument）被门拒绝（三入口门）；且**被接管的原持有者写语句被 fence**（append 返回 `{ok:false, reason:'fenced'}`（AppendResult，§3.2）/compact 不删行——写语句级断言，非仅内存布尔，见 Y0a-3；**fenced=终态：自隔离+批走 spool，不进退避梯**，契约 15）。
> 4. **`/api/ready` 在 PG / 租约故障下给出可读 reason**（字面量封闭枚举+holder/epoch 等独立字段；Redis 故障不 gating，仅报状态）。
>
> **明示非目标：UI 可见变更 = 0。** 本批不改善用户可感知的任何功能；服务端新增信号（readSnapshotOnly/503 fail-closed/ready）的客户端消费归 Y0b（E24 终端 UX 映射），§2.2 登记为硬依赖。

### 0.1 立项纪律自检（v8 九条）

| # | 纪律 | 本批落点 |
|---|------|----------|
| 1 | 基线快照表 | §1（2026-10-06 当日 grep 一手核验；v2 已修正 v1 两处 census 错误） |
| 2 | 删除类任务五行 census | §1.3（extension-redis+CollabRedisSync 删除面，含 pin 列表联动） |
| 3 | 出口判据+回滚动作+冻结契约 | §4（按子批独立出口+总出口） |
| 4 | 禁止垫片/兼容层 | 迁移无去重/无 down（§4.2）；无运行时开关式回滚 |
| 5 | 门禁先红（D13） | §6 门禁表按**真红门 / 结构不变量锚**两分类——红相承诺只写在物理可造的门上 |
| 6 | RPO/RTO+观测面+CI 载体 | §5（RPO 三腿；观测=事后取证+启动自检，不写纸告警线） |
| 7 | 门禁载体声明制 | §6 表（载体/阻塞/变红证据三列） |
| 8 | 运行面三件套 | §7（三项全变：进程定义入库/内存档位实测后定/关停 10s→45s+有界 drain——SV6） |
| 9 | 同步工作预算+库选项 pin | §7.2（mergeUpdates 出 WS 路径/装载事务预算/库语义锚固化） |

---

## 1. 基线快照（2026-10-06 当日一手核验；行号以当日 master=10bf0d7d 为准）

### 1.1 代码基线表

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| `apps/api/src/modules/collab/collab.gateway.ts:218-223` | loadDocument **非事务两步读**（findUnique→apply→loadUpdates）。**当期不可达撕裂**：库 loadingDocuments 按 docName 串行化+compact 只在 storeDocument 内被 await（:296）且 store 钩子在 saveMutex 内——同 doc 一边装载一边 compact 结构性不可达（库源码锚 A2/A4，§1.5） | E20/E42⑤ |
| `collab.gateway.ts:289` | append 失败回灌内存队列后 **`throw err`**——与"onStoreDocument 不 throw"目标契约冲突（v1 内部矛盾，v2 修） | E43①/D-2 |
| `collab.gateway.ts:279-290` | 失败路径完整蒸发链：unshift 回**内存**队列→退避梯 5 档≈53s 耗尽（:34/:389-392，耗尽时 cancelPersistRetry **会** delete 条目）→库失败后不重武装 debounce（锚 A5）→期间无新 update 则库永不再 store→断连→shouldUnloadDocument 四条件满足（锚 A2）→unload→WeakMap 条目随 doc 消失 | E11②/E43② |
| `collab.gateway.ts:380-382` | retryPersist stash 级：takeStash **先删内存**→append 失败 payload 为局部变量，不回灌不入账→下轮 takeStash=undefined→cancel=**取走后静默蒸发** | E43② |
| `collab.gateway.ts:224-237` | load 路径第四条蒸发路径：takeStash 先删（:224）→后续 syncFromPeers（:226）/版本门（:232-237）抛错→库 closeConnections+unloadDocument 丢弃 doc→stash 已删又随 doc 消失=净丢 | v2 新增（外审二发现） |
| `collab.gateway.ts:434-438` | onModuleInit **无条件 listen()**；且租约缺失时 REST 写路径（withDoc→openDirectConnection→createDocument→loadDocument，绕过 onAuthenticate）整条在门外 | E35/E44/P0-1（v2 三入口门） |
| `collab.gateway.ts:249-260` | takeStash/putStash=内存 unflushed Map 唯一出入口（进程崩溃丢） | E21/E37 |
| `collab.gateway.ts:207` | WS 消息路径内同步 `Y.mergeUpdates(q)`（PENDING_MAX_ENTRIES=64 封顶；实测 3000 条 4.8s 同步阻塞） | E21/纪律 9 |
| `collab.gateway.ts:533-545` | onApplicationShutdown：closeAllConnections1012→destroy 与 **8s race**；未调库 `flushPendingStores()`（库自持 debounce 队列，且它只处理"仍在 debounce 中"的 store——对已失败、队列非空的 doc 无效，v2.1 注记）；destroy 仅在 doc 归零时 resolve（锚 A6）。**卸载语义 v2.1 精确化**（撤"永不卸载=设计稳态"宽表述）：失败路径自身不安排卸载（锚 A1/A5），但**最后一条连接关闭时 onClose else 分支直接 unloadDocument（锚 A9）——日常断连即销毁脏 doc**；"永不卸载"仅对"0 连接+已失败+destroy 无人调用"窄场景成立（destroy 挂起至 8s race 即此场景）。A9=spool 承重性的库级依据（无磁盘台账则故障腿原理性不可修） | P0-2/事实 A/A9 |
| `collab.gateway.ts:58/:64/:65` | 内存容器 10 个；**真泄漏唯 `lastCompactAt`**（仅 has/get/set，全仓无 delete；键=projectId 量级每项目几十字节）。persistUnhealthy 有 delete（:317 healthy 转折）；persistRetry 耗尽档经 cancelPersistRetry delete（:361） | E45（v2 修正 v1 census） |
| `collab.gateway.ts:440-442` | 仅 `team.disbanded` 事件关连接；**两个项目消失入口都无清账**（team.service 级联删 CanvasDoc 后 stash 无限重试撞 FK） | E21/P0-5 |
| `apps/api/src/modules/collab/canvas-doc-update.repository.ts:16-21` | append=nextval+INSERT 两语句无事务（缺口=取号后进程死得序号空洞，**非重复 seq**——nextval 原子永不重复，v1"高并发撞约束"红相物理不可造，v2 修正） | E11① |
| `canvas-doc-update.repository.ts:23-30` | loadUpdates 全量 findMany（无分页/无 seq 水位过滤） | E34 |
| `canvas-doc-update.repository.ts:43-71` | compact：RR 事务+pg_advisory_xact_lock（:46）+读删同快照 seq<=maxSeq（:53/:67）+事务内同步重放（:57-59）；**写侧本无丢数据**（E42②）——advisory lock 保留（单实例不构成瓶颈；替换为 CAS 形态随 Y1c-1 快照追加表） | E11①/E42② |
| `apps/api/prisma/schema.prisma:808-813/:834-843` | CanvasDoc 无 stateSeq 列；CanvasDocUpdate `@@index([projectId, seq])` **无唯一约束**；两表 projectId 均 FK→CanvasProject（:810/:840，Cascade）——**marker doc 冒烟必败**（v1 W6 设计跑不通，v2 改只读冒烟） | E11①/E34 |
| `apps/api/src/modules/collab/collab.gateway.spec.ts:43/:95/:436` | **已有真 Provider+真 WS+真 Server integration 夹具**；:436 红4 用例先例自注"生产不可达、白盒防御性构造"——防御性白盒用例是仓库既有惯例 | E40（v2 W9 改复用） |
| `apps/api/src/modules/collab/*.spec.ts` | collab 套件**全 mock Prisma**（$transaction.mockImplementation(fn=>fn(prisma)) 等）——零真 PG 隔离级别验证；既有真库惯例=hasDb 门控 `*.int.spec.ts`（generation-intent.int.spec.ts:12），CI test job 设 DATABASE_URL（ci.yml:32）真跑 | E70/v2 真库用例基线 |
| `apps/api/src/auth/auth.guard.ts:5-18` + `app.module.ts:57` | `/api/ready` 未进 PUBLIC_PREFIXES；ThrottlerGuard 全局 300/min 且 nginx 后 req.ip=代理 IP（TD）→探针轮询会吃全站共享限流桶 | G7-1 |
| `apps/api/src/auth/auth.ts:10` | 模块级 PrismaClient 永不 disconnect（同文件 authRedis :18-21 已有受管先例：顶层单例+AuthModule.onApplicationShutdown 关闭） | E46 |
| `apps/api/src/main.ts:40-51` | ConfigPreload 临时 PrismaClient 用后 $disconnect（容器外，**裁定保持现状**——短暂占用可接受，E46 旁路实例此处置=显式登记非纳管） | E46 |
| `apps/api/src/modules/health/health.service.ts:14-28` | /api/health 仅 SELECT 1 | E44 |
| `scripts/gate-collab.mjs:44-59` | waitForApiHealth 轮询 /api/health（3000）+waitForPort(3001) | E44 切换目标 |
| `deploy.sh:59/:95` | `pm2 restart --kill-timeout 10000` 内联参数（**v2.5/SV6：Y0a-3 随批内联改 45000**——HTTP dispose 等在飞请求；ecosystem 归 Y0a-4 取同值）；仓内无 ecosystem 文件（**pm2 对旧内联进程的参数归属未验证=换文件后可能起第二实例**） | E43⑤/E46/D-8 |
| `deploy.sh:75-81`（deploy_api） | 上传面缺 **apps/api/prisma**（迁移文件到不了服务器，:87 migrate deploy 空转）**与 scripts/**（冒烟/演练脚本不在服务器）——两处均随批补 | E69②/v2 补 scripts |
| `.github/workflows/ci.yml` | test job（pg+redis+DATABASE_URL+verify）/doc-gate/gitleaks/e2e-collab(dispatch-only)——collab-core 新 job 只跑增量防双源 | E69③ |
| `apps/api/package.json:18` | `@hocuspocus/extension-redis: 4.6.0` | E23 删除面 |
| 本地 CanvasDoc 存量 | 6 doc/116KB/246 增量行；**无生产环境**（E41 裁定远程仅开发测试）——迁移零去重正当性 | E11①/G3 |

### 1.2 库行为锚（@hocuspocus/server@4.6.0 包内 src 一手实证；随批落成断言，D-13）

| # | 事实 | 源码位置 | 本批消费点 |
|---|------|----------|-----------|
| A1 | store 钩子抛错→库打日志后 return，**不 unload**（doc 留内存） | Hocuspocus.ts:532-536 | Y0a-2 契约前提 |
| A2 | 卸载条件=四条件与：!isDebounced ∧ !isCurrentlyExecuting ∧ !saveMutex.isLocked ∧ **getConnectionsCount()===0** | Hocuspocus.ts:591-598 | Y0a-2 蒸发链论证 |
| A3 | getConnectionsCount() **含 directConnectionsCount** | Document.ts:205-207 | LRU 移交 Y1c-3 时必用 |
| A4 | 装载按 docName 串行化（loadingDocuments） | Hocuspocus.ts:341-371 | 撕裂不可达论证 |
| A5 | 仅成功路径 setTimeout(0) 试卸载；**失败路径不重武装 debounce** | Hocuspocus.ts:539-543 | Y0a-2 蒸发链论证 |
| A6 | DirectConnection.disconnect 的 unloadImmediately 默认 true 且 await store；**destroy() 仅 doc 归零才 resolve** | DirectConnection.ts:47-74 / Hocuspocus.ts:1725-1738 | Y0a-2 drain 有界化 |
| A7 | `doc.store.pendingStructs` 为 yjs 公开字段（d.ts 声明），只在"收到行且时钟超前"时产生，**整行缺失不产生** | yjs StructStore.d.ts:9-12 / encoding.js:396/416/530 | Y0a-1 compact 前检查 |
| A8 | store 钩子跳过判据：redis 源→跳过；local→看 skipStoreHooks；connection→不跳过。**`shouldSkipStoreHooks` 是包公开导出（index.d.ts:247）——锚用例直接 import，禁手写等价判据（第二真源）** | types.ts:40-50 | 删 extension-redis 后回归；withDoc 写入（transact source=local 无 skipStoreHooks）必触发 store——断此前提 |
| A9 | **最后一条连接关闭且无 debounce 在飞时，onClose else 分支直接 unloadDocument——脏 doc 随断连销毁**（pending 队列 WeakMap 随之消失）。**分支分立（Y0a-1 库锚探针实证 2026-10-06）**：debounce 在途时断连走 executeNow 分支（dist:1384-1385）→ store 失败被吞（:1547"Document stays in memory"）→ doc **留内存**（A1 WS 面——唯一恢复源=gateway 自管退避）；仅 else 分支（:1386）无条件卸载 | Hocuspocus.ts clientConnection.onClose else 分支 | spool 承重性依据（Y0a-2）；v2.1 新增（撤"永不卸载"宽表述） |
| A10 | `Document.saveMutex`（async-mutex）为公开字段——gateway 侧 store 直调可统一走 `saveMutex.runExclusive` 串行 | index.d.ts:761 | Y0a-2 入口串行化 |

（E29 全量锚表 5 条扩表仍归 Y0c；本批只固化上述与本批设计承重的锚。）

### 1.3 删除类任务五行 census（纪律 2）

**删除对象：`@hocuspocus/extension-redis` + `CollabRedisSync`（E23：单实例租约钉死后判据"冗余"升"无用途"；连带消灭 E11③ Redlock skip 路径——SkipFurtherHooksError 随依赖消失，`yjs_store_skipped_total` 不再立项）**

| 类别 | 位置 | 处置 |
|------|------|------|
| 生产调用点 | collab.gateway.ts:5(import)/:91(注入)/:120-128(extensions 挂载+disconnectDelay)/:226(syncFromPeers，装载少 1s 阻塞=确定性收益)/:436(getDocument 注入)/:13；collab.module.ts:6/:17-23(COLLAB_REDIS)/:27 | 删 |
| 测试夹具引用 | collab-redis-sync.service.spec.ts（整删）；collab.gateway.multi-instance.spec.ts:6/:24（**改写**为租约 fail-fast 用例）；其余 *.spec 中 redisSync/COLLAB_REDIS mock（plan 阶段 grep 全量清点） | 删/改写 |
| 扫描门禁命中 | check-hocuspocus-pin.mjs EXPECTED 含 extension-redis → 移除 pin 项，**EXPECTED 改三包**（server/provider/yjs）；**v2.1 注：@hocuspocus/\* 与 yjs 非同一 scope——EXPECTED 需两条匹配正则，只改数组项则 yjs 永不匹配=门禁静默绿**（plan 阶段核对脚本结构落地）；pin 变更→库行为锚强制重跑（collab-core 常跑即载体） | 改写 |
| allow 自证 | 无 | — |
| re-export | 无（COLLAB_REDIS token 仅模块内） | — |
| 依赖清单 | apps/api/package.json:18 | pnpm remove |

### 1.4 本批有效裁决内联（E30 纪律；**每条标注执行状态**——v2 消灭"引用了但没执行"）

> 引号为 v8 目录 §0.1 原文（裁剪批次归属句）。〔执行状态〕以 v2 裁定为准。

**E11（P0 持久化三修）**：①硬化三件套+装载事务化〔**Y0a-1 执行**（append 侧同 key advisory lock 补强随 **Y0a-3 落地**——SV3 半边，stateSeq 重新可信，详 E34 行）；判据以 E20/E34/E42 修订为准；"重放移出长事务"→**移交 Y1c-1**（E62 快照追加表同批），§2.2 登记〕②失败蒸发〔**Y0a-2 执行**；`yjs_unflushed_projects/bytes` 告警→本批落地为**启动自检+结构化日志**（§5.2，告警路由归 Y0b/E54）；beforeUnloadDocument 队列非空拒卸载→**随单源 spool 不再需要**（E43③ tripwire 裁定吸收）〕③Redlock skip〔**随依赖删除消灭**（Y0a-3）；`afterStoreDocument` 对账→本批最小版（Y0a-2：store 后队列未清空即计数）〕。

**E20（读侧撕裂+判据升级）**：真路径=读侧撕裂；三守卫；SV 支配性〔**拆分执行（v2.2 修订）**：compact 写快照前 pendingStructs 检查=Y0a-1（compact 健康度唯一真实指标，P0 告警线）；**SV inline 哨兵删除**（恒真+纯成本，探针证伪——svDominates 沉纯函数单测锚 Y0a-1，破坏后结构锚随 Y1c-1）；**读侧守卫三处/readCanvas 独立 reason/装载降级出口→整体移交 Y1c-1**（撕裂真正可达的批次：Y.Text/XmlFragment 使缺行=静默内容丢失在线化之时）——v2 裁定，理由：守卫判据对整行缺失结构性失明（锚 A7）、当期不可达（锚 A4）、防御自身需更多防御（fail-stuck）。§2.2 登记〕"首件事=三方交错红用例"〔**修订执行**（E42⑤ 改判吸收）：改为真 PG 隔离性质验证用例+可达性固化（§6 结构锚），不造"复现撕裂"假红相〕。

**E21（对偶配对）**：失败即入账先于一切/落盘 spool+启动回灌/项目删除清账/关停停收→drain→放行/mergeUpdates 挪出 WS 路径/持久化模型显式声明〔**全部 Y0a-2 执行完毕**（2026-10-07 收口）；"doc bytes/行数按去重口径标注"→**移交 Y0b**（观测收口），§2.2 登记〕。

**E23（拓扑前移，本批取拓扑段）**：单实例+启动租约+删 extension-redis/CollabRedisSync/双 Server 用例改 fail-fast〔**Y0a-3 执行（2026-10-08）**——PG 租约行 CAS（scope 常量 `COLLAB_LEASE_SCOPE` 导出）+extension-redis/CollabRedisSync 整删（census 清零）+双 Server 用例改租约 fail-fast（不 listen+三入口拒）；collabState 七态主导派生（P6）〕；compact 守卫连续 3 败→世代重建出口〔**v2.4 修订执行**：守卫降为"放弃本次+计数+保留全部行——**放弃不开窗**（`lastCompactAt` 仅 compacted===true 时更新）：下次 store 立即重试（门限从上次成功起算，放弃后窗口早已过）——pendingStructs!=null 属异常态，每次 store 一次尝试是可接受的诊断成本且 abandoned 计数/ERROR 一路涨正是 P0 告警线所要；接口形态见 §1.3 compact 返回契约。**本批自洽，不依赖 Y1c-1**；世代重建手工命令（scripts/collab-compact.mjs 人工出口）随 Y1c-1 落地，§2.2 显式登记为已知限制〕；世代连带（docName 世代 6 处）〔移交 Y1c-1，不属本批〕。

**E34（修法收敛+判据豁免+可达性）**：单事务 RR 覆盖快照+全部分页+stateSeq 三件套+SV 豁免写死+read fail-closed 降级出口〔**Y0a-1 执行单事务+stateSeq+SV 豁免**；~~同事务复查~~不做了（E42①）；**v2.5/SV3：装载 `seq>stateSeq` 水位过滤删除**——readConsistent cursor 恒 0n 全量 apply（水位不是正确性载体，正确性=读侧全量+CRDT 幂等；stateSeq 留作诊断/未来增量装载水位，诚实性由 append 同 key advisory lock 保证——**该锁已随 Y0a-3 落地**（取 compact 同 key，INSERT ratchet 静态断言守单源），两出口（readSnapshotOnly/loadForHydration）同构 int 用例同批绿）；**降级出口随读侧守卫移交 Y1c-1**；lease-lost 场景的降级**读**通道保留在 Y0a-3（租约语义非完整性守卫——**已随批执行**：快照出口 readCanvasFromSnapshot 不经租约门）〕；可达性证明〔**Y0a-1 固化装置执行**（§6 结构锚）〕。

**E35（租约四语义+fencing）**：TTL≤10s/心跳≤3s 独立 timer/续租失败自隔离（不自杀不硬撑；租约只 gate collab 就绪度）/有界重试+就绪门/FORCE_TAKEOVER 逃生阀/pm2 禁 reload/关停末尾显式释放/fencing token/语义=活性机制非数据完整性〔**Y0a-3 执行（2026-10-08）**——启动链单点负责制（onAcquired 唯一入口+initDone 成功后置，缺②即 start-failed 自愈再调度）；心跳三态 owner-only+单调钟；"独立 timer/子进程"落为独立 unref timer；**v2.5/SV2：FORCE_TAKEOVER 逃生阀→break-glass 运维脚本**（'revoked' 哨兵+AuditLog，被撤实例终态不 rejoin+everHeld 前置门）；**v2.5/SV5：续租失败自隔离改 isolate→rejoin 状态机**（关 listener 让位+有界退避重获取+re-listen；revoked 终态除外）〕。

**E37（spool 细则）**：帧格式=长度前缀+CRC/回灌先于对外服务/世代作用域/容量上限明写/写入次序二选一〔**Y0a-2 执行完毕**（2026-10-07 收口）：选"失败→落盘"ms 窗口（与 E43⑥"收即写不采"同判）；世代字段 Y1c-1 引入 generation 时扩展（本批键=projectId）；目录绝对路径随 ecosystem cwd 钉死（Y0a-4）〕。

**E40（三门装置）**："无 MinIO/无外部依赖的双 client+单进程单 Server 装置"〔**Y0a-1 执行，复用现有 integration 夹具提取**（collab.gateway.spec.ts:43/:95 已是真 Provider+真 WS 形态），不新建〕。

**E42（装载读一致性终裁）**：①单 RR 事务=(i) 推荐形态+删"同事务复查"假门禁〔**Y0a-1 执行**〕②写侧现状无丢数据，三件套=防走样契约〔**Y0a-1 执行**〕③pendingStructs 判据边界〔**Y0a-1 执行**（compact 前检查）〕④SV 支配性=对账哨兵非放行判据〔**v2.2 修订执行**：inline 哨兵删除（恒真+纯成本，探针证伪）；svDominates 沉**纯函数单测锚**（Y0a-1）+破坏后结构锚随 Y1c-1 评估——E42④ 的"对账"定位不变，载体从 compact 内联改为函数级〕⑤可达性固化〔**Y0a-1 执行**〕。

**E43（store 失败路径终裁+RPO 三腿）**：①库语义锚定〔**Y0a-1 落断言**（§1.2，D-13）〕②stash 级蒸发=spool 唯一真修法+入账先于一切〔**Y0a-2 执行，且 v2 强化**：删失败路径 unshift 回灌+catch 返回 false 不 throw（D-2）+takeStash 全调用点 peek 语义化（D-3；load 回灌位点已随 Y0a-1 前移落地 peek/consume——本批余 store 提前 drain/retry 两处）+spool 单源落盘删内存 unflushed Map〕③拒卸载降 tripwire〔**随单源 spool 吸收**——脏 doc 不再依赖"留在内存"保数据〕④drain 先于放行〔**Y0a-2 执行**〕⑤kill-timeout 45000〔**Y0a-3 执行（2026-10-08）**（deploy.sh 两处内联已改 45000——HTTP dispose 等在飞请求，v2.5/SV6；ecosystem 归 Y0a-4 取 45000 同值+生效核验）〕⑥RPO 三腿〔**§5.1 执行**〕。

**E44（租约改 PG+ready 拆分〔v8-A〕）**：PG 租约行 CAS+RETURNING epoch/四语义保留/数据屏障/FORCE_TAKEOVER 打印清单/ready=PG+Redis+租约/gate 与 deploy 等待目标切换〔**Y0a-3 执行（2026-10-08），v2 修订**：**删数据屏障与 drainedAt/drainBy 列**（"自然过期∨drainedAt"恒真=空操作；单实例 PG delta 日志=硬保证，屏障是死代码）；**ready 503 判据=PG+租约**（Redis 仅响应体字段不 gating——消灭"Redis 抖动否决部署链"；八档矩阵表驱动用例封派生链）；**门扩三入口**（loadDocument 钩子+withDoc+onAuthenticate——v1 只 gate listen，REST 写路径在门外=P0-1）；租约行由迁移 seed（本地/生产同路径）；gate-collab 等待目标已切 /api/ready 双验（T10）；**v2.5/SV2：FORCE_TAKEOVER 一次性语义+ready forceTakeover 字段删除，改 break-glass 运维脚本**（'revoked' 哨兵+AuditLog；ready 公开/授权两档（V17——无 token 四键/持 token 全字段），SV16）〕。

**E45（注册表准入）**：maxLoadedDocs/装载队列/单 doc 字节上限/LRU/RSS 软阈/内存表清理/上限进 env zod〔**v2 降级执行（用户裁定）**：本批只留 **lastCompactAt 清理**（真泄漏，3 行）+ **env 预留默认关闭**（COLLAB_MAX_LOADED_DOCS=0=不限，仅 zod 解析无消费逻辑）；**准入 deny/LRU/RSS 软阈/字节上限整块移交 Y1c-3**（与 D7 预算同批，数值才有依据；库锚 A2/A5 证明无连接 doc 会被自动卸载，常驻内存场景当期不存在）；"kill -9 前内存曲线落档"降可选〕。

**E46（进程定义入库+连接池）**：ecosystem/kill_timeout 45000/DATABASE_URL connection_limit/pool_timeout/旁路 PrismaClient 清或纳管〔**Y0a-4 执行**；main.ts preload=显式登记保持现状（短暂实例用后即断）；auth.ts:10=循 authRedis 受管先例纳管；**内存档位数值=实测前置**（服务器画像 free -m/ps rss 落档后定，结构约束写死：RSS 软阈（若启用）<max_memory_restart；v1 的 1.2GB 软阈>1G 硬重启线=死代码，v2 废弃该组数）〕。

**E69（门禁强制基底〔v8-G〕，本批取②③⑥⑦）**：①⑤ 0 号已落地 ✓；②migrate deploy 已进部署链+**本批补 deploy_api 上传面 prisma+scripts 两目录**〔Y0a-4〕；③collab-core PR 必跑 job（零 MinIO）〔**Y0a-4，v2 修订：只跑增量**——int 用例+kill -9/SIGTERM 演练+fail-fast+库锚+对抗语料+双 client 装置；不重跑 verify 已含的 mock 套件（防"collab 绿"双源漂移）；演练用轮询等待非固定 sleep（防 required check 抖红）〕；⑥post-deploy 冒烟〔**Y0a-4，v2 修订**：/api/ready 轮询（60s）+对**既有 seed 项目**一次只读 readCanvas 往返（marker doc 因 FK 必败，弃）；执行链路冒烟挂 Y0b（资金路径批后有意义）〕；⑦每门标注〔§6〕。

**E70（对抗语料）**：shared doc 生成器+读者全函数〔**Y0a-1 最小版执行**：生成器（种子化）+api 侧读者（readRecordsFromMaps/ensureSchemaVersion/toDocLike）全函数断言；随机交错收敛 harness→Y1a；web 投影读者→Y2 随投影出口接入〕。

（E9 判据随 E23 内联生效：单实例钉死后"无用途"，整删。）

### 1.5 修正记录（v1→v2 事实订正，防后读按 v1 施工）

| v1 错误 | v2 事实 |
|---------|---------|
| §4.1 判据 3"旧两语句 append 高并发可撞唯一约束（先红）" | nextval 原子永不重复——物理不可造红。改结构锚：直插重复 (projectId,seq) 断言约束拒绝 |
| §1.2 persistRetry"耗尽档留 entry" | 耗尽走 cancelPersistRetry→delete（:361），条目已清。真泄漏唯 lastCompactAt |
| W6 冒烟 smoke:\<ts\> marker doc | FK→CanvasProject 必败（schema:840）。改只读往返 |
| W7"复用既有 test-utils 惯例" | 惯例不存在（无 test-utils 目录；tsconfig 只排 *.spec.ts）。新立排除+dist 断言 |
| W9 新建 dual-client-harness | collab.gateway.spec.ts 已有 integration 夹具，提取复用 |
| W1.2"先增量后快照"换序 | 自相矛盾（水位来自快照行）；E42① 单事务下换序无意义。删 |
| "内存表 9 张" | 10 个容器（笔误） |
| §4.2"新迁移 down" | Prisma 无标准 down 流程；开发期回滚=revert+migrate reset（G3/D-6） |

**v2→v2.1 修正记录（第三轮外审，2026-10-06；防按 v2 施工）**

| v2 错误 | v2.1 事实/裁定 |
|---------|---------------|
| §1.3.3 `stateSeq: GREATEST(stateSeq, maxSeq)` | **撤回**——当前 advisory lock 下与精确赋值等价（无行为差异），但未来 compact 去锁并发化时（正是其声称防护的场景）GREATEST 让慢事务把只覆盖到 100 的快照标成 stateSeq=105→装载过滤掉 101-105=静默内容丢失。改**精确 `maxSeq`**+冻结契约禁令 |
| §2.3 主路径 `queue.splice(0)` 先取走+§2.2 putStash tripwire **throw** | **组合缺陷**：磁盘满时 splice 已执行+putStash 抛错=批为栈上局部变量彻底蒸发（锚 A5 保证库不重试）——在消灭 v1 蒸发窗口的同时于主路径新开蒸发窗口。改 **BOI 不变量**（copy-first：merge 不动队列→新家落定才 splice；spool 失败不 throw 改熔断只读） |
| §0 目标 2"既不在 PG 也不在 spool 的批数==0" | **恒真假门禁**——去抖定时器内未取走的批不属任何一边。改 **storeInFlight** 口径+drain 末步 force-spool |
| §3.2 lease-lost 降级读（全部消费者，含 execution） | **D1 风险扩大化**——计费输入按陈旧快照执行违背 v8-C/E49 资金 fail-closed。改**按消费者拆分**：计费类 503 fail-closed；投影类 readSnapshotOnly（state+增量重放） |
| §1.5"marker doc FK 必败，改只读往返" | "必败"仅在未插项目行时成立（CanvasProject.userId nullable+default-team 可显式插行）；且"只读往返"被已加载内存 doc 假绿。改**冒烟三步**（自插项目+新 Y.Doc 重放 DB 验证） |
| §3.1.7 "tsconfig.build.json excludes 补 test-utils" | **该文件不存在**（apps/api 仅 tsconfig.json/tsconfig.scripts.json/tsconfig.spec.json；nest build 走 tsconfig.json）——在订正"惯例不存在"的同一行引用了另一个不存在的文件。改 tsconfig.json exclude |
| §1.1 "store 失败 doc 永不卸载=设计稳态" | 宽表述撤回（A9 锚：断连即销毁；"永不卸载"仅窄场景）——见 §1.1 修订行 |
| seed.ts 有可冒烟项目 | **偏差**：seed 只建 user/team 等，**无 CanvasProject**——v2"对既有 seed 项目只读往返"目标不存在（并入上面冒烟三步修正） |
| `lease-held-by:*` 进封闭枚举 | 通配串与"封闭枚举"矛盾。拆 `reason: 'lease-held'` + `holder` 独立字段（+补 lease-error 档） |

**v2.1→v2.2 修正记录（第四轮外审——Y0a-1 plan 级机制证伪回馈，2026-10-06；防按 v2.1 施工）**

| v2.1 错误 | v2.2 事实/裁定 |
|-----------|---------------|
| §1.3 SV inline 哨兵+delete-only 豁免+"SV 豁免先红后绿"出口 | **探针三重证伪**：①`decodeStateVector` 是 yjs 公开导出且 `sv.util.ts` 同目录已有 `decodeStateVector/svSatisfied`（手写 varuint 解码器=自造风险）②"delete-only SV≈1 字节"仅对 diffUpdate 形态成立、对全量态编码不成立（实测 13 字节含条目）③**inline 恒真**（快照由被删行集构建，pendingStructs 检查通过前提下行 clock 必被集成）+每 compact N 次编码纯成本。裁定=inline 删、svDominates 沉纯函数单测锚（阳性+阴性对照）、破坏后结构锚随 Y1c-1、指标删、`yjs_compact_abandoned_total` 升 P0 告警线 |
| §1.4 预检自愈（前置 count/sum 聚合+48MB 阈） | `sum(length(update))` 每次装载全量 detoast 聚合（装载=withDoc 高频路径）；48MB 阈对 116KB 存量永不触发=纯成本。改**超时自愈一次**（真实超时才触发，零常态成本；compact 失败不构成新 fail-closed 死锁） |
| §1.5 storeInFlight Y0a-1 落地 | Y0a-1 挂现有回灌路径恒 0=**死代码**（"回到内存队列"恰是 Y0a-2 要消灭的蒸发点），出口不可证伪。移 Y0a-2（Gauge+归属转移同点+ready.pending） |
| §1.7 Proxy 故障器（60 行可编程） | 无消费者且与"dist 无 test-utils"矛盾（Y0a-2 演练需子进程注入，dist 排除之下不可达）。砍——单测层 failingRepo stub（15 行）+Y0a-2 演练层 DB 触发器注入（零生产足迹更真实） |
| （plan 级低级错一并记档）唯一约束用例"nextSeq 新号→期望 rejects"方向反；`$queryRaw<Buffer[]>` 实返对象数组；`gateway.hooks.onStoreDocument` 事后覆盖对库无效（构造时捕获闭包）；对抗语料纯对象≠DocLike 接口 | plan v2 已全量重写修正——**根因：机制写进 spec 时没人跑 4 行探针**。新增立项纪律第 10 条（探针前置，v8 目录） |

**v2.3→v2.4 修正记录（第五~七轮外审收敛，2026-10-06；防按 v2.3 施工）**

| v2.3 错误/缺口 | v2.4 事实/裁定 |
|---------------|----------------|
| §3.2"fenced=0 行"仅口头约定；§2.3 BOI 伪代码对"不抛异常的 0 行"照常 splice | **fenced 蒸发**：$queryRaw 0 行不抛异常→splice 出队→批既不在 PG 也不在 spool（spool 回灌路径同构中招：append"无异常"→confirm 删帧→两处皆空）。改 **AppendResult 判别返回**（§1.2）+BOI 把 `!r.ok` 并入失败路径（fenced=终态+批走 spool+自隔离，禁 splice）+契约 15+G-3b 三断言用例 |
| §3.2 readSnapshotOnly"无事务单读者" | 重开 E20 撕裂：先读快照→compact 并发提交（删 ≤S1）→读 `seq>S0` 增量→(S0,S1] 静默缺行；服务公开作品页+违冻结契约 1。改 **readConsistent 单 RR 事务两出口**（§3.2） |
| §3-1.4/契约 13：P2024 归可自愈类+compact 独立预算 60s | P2024=**连接池取连接超时**（池饥饿，非事务超时）——自愈动作自身需池连接=饥饿期零成功率纯放大；60s 挂在客户端已放弃的请求=纯池占用且违 §7.2 预算规则。**P2024 移出**（直接 fail-closed）+自愈增量预算 **≤8s**（compact 6s+重试装载 2s，§1.4） |
| §0 目标 1 oracle"轮询 batches===0 即录集" | 批在去抖定时器的观测盲区→已接受集录小→kill -9 丢批仍断言通过=假门禁。改**双模式 quiescence barrier**（停写+`projects===0 ∧ batches===0` 持续 ≥maxDebounce；故障模式加 spoolBytes 两次采样不变） |
| §0 目标 2"drain force-spool 使 storeInFlight 构造性为 0" | spool 熔断态下 force-spool 失败→判据取值由被测对象自身决定=不可证伪（D13 同罪复发）。改 **G-2a（归属落定或如实点名）/G-2b（BOI 注入=机制载体）**+契约 14 计数器两点+drain force-spool 复用同落定点 |
| §4.4 部署拒重启无前置停写阶段 | 活跃编辑下去抖窗口内必有 pending 批→`batches===0` 稳态不可达→每次 exit 1→force-restart 沦为日常=门禁失效。改**三步**：`POST /api/drain`（v2.4 新增端点，§3.3）→轮询 pending 排空→restart；draining 60s 未收到 SIGTERM 自动解除（防部署链中止留只读僵尸） |
| §3.2 fence 仅校验 owner | 租约行缺失→标量子查询 NULL→**静默 fence 全部写入**（配置错误伪装成正常 fence，日志无线索）；过期自有租约仍可写。改 **EXISTS+owner+TTL 双校验**+0 行时二次查租约行区分 `leaseRowMissing`（lease-error 档+ERROR，不进自隔离——重试无用）（§3.2） |
| §1.3 compact 放弃语义未定形（返回值/告警级/开窗规则） | 实现若走 throw 会被 :297-301 catch 记 WARN+StoreCompactFailureTotal=**污染 abandoned P0 告警线**；若照抄现状 :306-311 无条件重置窗=放弃后再等 60s。改 **compact 返回 `{compacted,reason}`+仅成功开窗+abandoned 走 ERROR 结构化日志**（§1.3） |
| §2.5 project.gone 处理器清 spool 段文件 | emit 先于删除事务提交→删除回滚即丢已接受台账；unlink+fsync 违反自家"处理器禁慢操作"。**处理器只做内存终态**，残留段由 FK 23503 收割（§2.5） |
| §2.2 quarantine"移帧"+契约 12"只用追加与整段 unlink"+容量熔断三规则互斥 | 追加-only 段内移帧物理不可行（重写段=违契约 12/整段搬=误伤好帧）→含 1 坏帧的段永不回收→累计 256MB 慢速只读。改 **sidecar 标记**（`<seg>.quarantine` 追加写）+段 unlink 条件=**非隔离帧全 confirm**+容量核算**排除隔离字节**+脚本角色改"外置导出+人工判定后删段"（§2.2） |
| §2.4 预算表加算 30s≠28s（零余量），步骤 1"直连超时"无界 | 压至**合计 ≤22s+垫 ≥8s**；直连宽限 2s 后放弃计 `hangReason:'direct-open'`（直连滞留是 RTO 问题非数据问题）；步骤 6"必须执行到"优先级（SIGKILL 后下一实例等满 TTL 直接吃进 RTO）（§2.4） |
| §3.3 `ready.epoch?: number` | CollabLease.epoch=BigInt——JSON.stringify(bigint) 抛 TypeError，**在租约路径（最需它的时刻）炸**。改 `epoch?: string`（§3.3） |
| §3.2 FORCE_TAKEOVER"审计行落库"无落库对象 | CollabLease 仅 4 列、迁移未新增审计表。**复用 AuditLog**（action='collab_force_takeover'，operatorId 系统哨兵值+remark 记前任 owner/epoch/expiresAt；audit.log 先例 team.service.ts:188）（§3.2） |
| §4.4 冒烟依赖 seed 的 default-user/default-team ↔ §4.5"冒烟均自建 FK 行"自相矛盾 | 部署链不跑 `prisma db seed`（deploy.sh 实核）。统一**自建哨兵行**（与 §1.6 同纪律）（§4.4） |
| fence owner 逐调用点传参（append/compact/drain 共 3+ 处） | 未来新增调用点漏传=静默破防。改 **`repo.setLeaseOwner(owner)` 单点注入**（唯一写者=lease service；owner=null ⇒ 断言恒 0 行=天然 fail-closed），契约 16（§3.2） |
| §3.1 无 takeStash→peek/consume 工作项（§4.1 Y0a-1 出口与 E43② 均引用"已前移落地"） | "声明已落地但工作项不存在"=E30 要消灭的形态。补 **1.10 工作项**+版本门拒绝对应用例 |
| §7.1 残留"drain ≤5s"（双源）/§1.4 标题残留"预检自愈"/§3.3 `@SkipThrottle` 引证"/metrics 先例"（实核 /metrics 未用该装饰器，自持 PrometheusAuthGuard） | §7.1 改单源指向 §2.4 预算表；标题同步"超时自愈"；真先例=execution.gateway.ts:16/payment.gateway.ts:14（WS context） |

---

## 2. 范围

### 2.1 执行结构：4 子批（同 Y1c 拆片先例——立项一个 spec，plan 按片推进，**每子批出口=用户确认点**）

| 子批 | 主题 | 依赖 |
|------|------|------|
| **Y0a-1** | 写读一致性+测试基座（硬化三件套/单事务装载/stateSeq/库锚/故障器/真库用例/语料最小版/装置提取） | — |
| **Y0a-2** | 失败路径与关停（spool 单源+三段式+无上限重试+drain+清账+lastCompactAt 清理） | Y0a-1 故障器 |
| **Y0a-3** | 拓扑（删扩展/PG 租约+三入口门/ready+/api/drain 拆分） | —（可与 Y0a-2 并行，但 drain 释放租约衔接 Y0a-2 关停序） |
| **Y0a-4** | 进程与部署（ecosystem/连接池/纳管/部署链/CI job/nginx） | Y0a-1~3 产物 |

### 2.2 Out of scope + 移交登记（显式声明，防"引用了但没执行"与隐形依赖）

| 项 | 去向 | 性质 |
|----|------|------|
| 读侧守卫三处/readCanvas doc-incomplete reason/装载降级出口/verifiedDocs 台账 | **Y1c-1**（撕裂可达之时：Y.Text/XmlFragment 使缺行=静默内容丢失在线化） | 移交+登记 |
| compact"重放移出长事务"+分块+显式 timeout 增强 / advisory lock 替换为 revision CAS / 快照追加表 CanvasDocSnapshot | **Y1c-1**（E62；本批保留 advisory lock——单实例不构成瓶颈，替换收益随追加表落地） | 移交+登记 |
| 世代重建手工命令 / spool 帧世代字段扩展 / docName 世代通道 | **Y1c-1** | 移交+登记 |
| 准入 deny/LRU/RSS 软阈/单 doc 字节上限/server-busy reason 码 | **Y1c-3**（与 D7 预算同批；本批 env 预留默认关闭零消费） | 移交+登记（**上游 E45 范围变更，回填 v8 目录**） |
| 随机交错收敛属性测试 harness | **Y1a**（E70 完整版） | 移交 |
| web 投影读者对抗语料接入 | **Y2**（随投影出口） | 移交 |
| 前端消费：计费类 503 fail-closed 提示、新 close/reason 终端 UX 映射、server-busy 分型、ready 驱动的重启中视图（含 10s synced 死线改造） | **Y0b**（E24 四档终端 UX）——**硬依赖**：Y0a 落地后 Y0b 落地前，服务端新信号是哑的（客户端按通用错误处理）；计划内重启已有 1012 短退避先例（canvasCollabRuntime:837-847），真缺口=崩溃路径 | 硬依赖登记 |
| yjs_unflushed/spool 告警路由、doc bytes 去重口径标注、Sentry/HTTP RED 观测收口 | **Y0b**（E54；本批指标=事后取证+启动自检） | 移交 |
| D1 已知风险接受记录承接 | **Y0b spec 必写**："删除在途窗口可能按陈旧节点集计费，fail-closed 不覆盖此盲区"（E49③ 要求 Y0 链登记——本 spec 代登记，Y0b spec 正式落档） | 代登记 |
| withDoc 驻留优化（disconnect{unloadImmediately:false}+空闲回收器） | **Y0c/Y2**（E14；v2 裁定不前移——spool 已覆盖失败路径，驻留是性能优化非正确性） | 移交 |
| 库行为锚全量 5 条扩表/yjs pin 精确化 | **Y0c**（E29；本批只固化 §1.2 承重锚） | 移交 |
| worker 拆分/NODE_ENV 档位/PITR 备份/XFF | **Y0.5** | 移交 |
| 多实例全家桶/租约改 advisory lock 形态再评估/所有权注册表 | **Y7** | 移交 |
| Redis 持久化（AOF）裁定 | **Y0.5**（E58②） | 移交 |

---

## 3. 工作项设计（按子批）

### Y0a-1 写读一致性+测试基座

**1.1 迁移（schema 变更，无去重/无兼容——零用户数据）**

- CanvasDocUpdate 加 `@@unique([projectId, seq])`（直加约束；存量 246 行若撞=开发库脏数据先人工清洗再迁移，迁移内不写去重分支）+**随批 DROP 既有冗余 `@@index([projectId, seq])`**（唯一约束自带同列序唯一索引，PG 中二者重复=永久双份写放大）。
- CanvasDoc 加 `stateSeq BigInt @default(0)`（语义="本快照已覆盖到的 maxSeq"；**唯一写者=compact 事务**（Y1c-1 前不变），append 不触碰——防走样）。
- `CollabLease { scope String @id, owner String?, epoch BigInt @default(0), expiresAt DateTime? }` 单行表，**迁移 seed**（scope='primary', owner=NULL, epoch=0）——本地/生产同路径，不引入 LEASE_ENABLED 开关（第二语义=测试覆盖不到的垫片）。（无 drainedAt/drainBy——数据屏障删除，E44 v2 修订。）
- `verify-indexes.sql` 加块：上述唯一约束（pg_constraint 存在性，不查索引名）+CollabLease 表+stateSeq 列 NOT NULL/default 0（迁移形态自证）。

**1.2 append 单语句（防走样契约）**

```sql
INSERT INTO "CanvasDocUpdate" (id, "projectId", seq, update, "createdAt")
SELECT gen_random_uuid()::text, ${projectId}, nextval('canvas_doc_update_seq')::bigint, ${update}, now()
RETURNING seq
```
（Prisma $queryRaw；`::text`/`::bigint` 显式转型防驱动回字符串；id 侧自生成不改 schema @default(cuid())——Prisma 应用层默认与 raw SQL 并存不漂移：raw 路径自带 id，Client 路径走 cuid。）
**返回契约（v2.4，Y0a-1 定死——防 Y0a-3 加 fence 时中途改签名连锁）**：`append(projectId, update): Promise<{ ok: true; seq: bigint } | { ok: false; reason: 'fenced' | 'no-row' }>`——Y0a-1 阶段恒返回 `{ok:true}`（fence 断言 Y0a-3 才追加）；mock/用例同步该签名。**fenced 时 0 行不抛异常**（$queryRaw 返回空数组）——调用方禁以"未抛错"判成功，见契约 15。

**1.3 compact 强化**

- 按实读行 id 精确删除：findMany `select:{id,update}` → `deleteMany({where:{id:{in:ids}}})`（弃水位删除）。
- 同事务 `stateSeq: maxSeq` **精确赋值**（v2.1 撤 GREATEST——见 §1.5；与本次事务实际删除集严格同批同界。代码注释写死："若未来 compact 去锁并发化，此处必须随 Y1c-1 CAS 形态重设计——GREATEST/单调化包装在此语义下制造静默丢失，禁用"）。Prisma upsert 无法表达 GREATEST 亦非需求（advisory lock 下同 project compact 串行，精确=充分）。
- **compact 返回契约（v2.4 定形——实现若走 throw 会被 storeDocument 的 compact catch（:297-301）记成 WARN+`yjsStoreCompactFailureTotal`=污染 abandoned 的 P0 告警线）**：`compact(projectId): Promise<{ compacted: boolean; reason?: 'abandoned' | 'empty' | 'not-owner' }>`（**v2.5/SV8：`'not-owner'`=租约失守档（Y0a-3 fence 断言返回），`abandoned`=pendingStructs 专用不再混用**）。窗口策略（gateway 侧 maybeCompact）：`compacted===true` → `lastCompactAt.set`（**仅成功开新窗**）；`'empty'`（无行）静默。**计数+ERROR 单点落 repo 的 abandoned 分支**（`yjs_compact_abandoned_total`+`{event:'compact_abandoned', projectId}`——覆盖 gateway 与装载自愈两路调用，防双计；P0 线，不走 throw）。
- **写快照前检查**：temp doc `pendingStructs === null`；非 null→**放弃本次（返回 `{compacted:false, reason:'abandoned'}`）+保留全部行**——放弃不开窗，下次 store 立即重试（E23 v2.4；弹性，非永久放弃；fail-stuck 面消灭）。**abandoned 计数为 compact 健康度唯一真实指标，升 P0 告警线（§5.2，v2.2）**。
- ~~SV 对账哨兵~~（**v2.2 删除 inline 形态**——探针证伪：快照由被删行集构建，pendingStructs 检查通过前提下行 clock 必被快照集成→**inline 恒真**+每 compact N 次 `encodeStateVectorFromUpdate` 编码=纯成本；"delete-only SV≈1 字节"仅对 diffUpdate 形态成立、对全量态编码不成立）。**svDominates 语义沉为纯函数单测锚**（复用 `sv.util.ts` 既有 `decodeStateVector`/`svSatisfied`——同目录现成能力，禁手写 varuint 解码）；"破坏后 compact（重放集≠删除集）"结构锚随 **Y1c-1** 读侧守卫批评估（届时才有判定对象）；`yjs_compact_sv_violation_total` 指标随之删除。
- **Y0a-3 联动**：事务首行 fence 断言（见 3.2）。

**1.4 loadForHydration 单 RR 事务（E42① (i) 形态）+ 超时自愈一次（v2.4 分类触发）**

- 事务内只 SELECT，顺序写死：**先读快照行（state, stateSeq——诊断/未来增量装载水位，不作读侧过滤）→按 `seq > cursor` 分页读全量增量（cursor 恒 0n——水位过滤已删，契约 1；正确性=读侧全量+CRDT 幂等）**（ORDER BY seq ASC，页 500 行，同事务内游标循环至取尽）。apply 全部在事务外（gateway applyReplayed 抑制语义不变）。
- 事务选项显式：`{ isolationLevel: 'RepeatableRead', timeout: 8_000, maxWait: 2_000 }`（v2.1 从 15s/5s 下调）。**预算规则进 spec**：服务端任何单次可等待操作的预算 < 客户端 synced 硬死线（canvasCollabRuntime:985，10s）− 2s；冷启动池排队由 connection_limit=10 承担而非放大 maxWait；超时/异常 fail-closed 抛出，外层折 db-unavailable 不变。
- **超时自愈一次（v2.2 改预检形态——原前置预检=每次装载全量 `sum(length(update))` detoast 聚合，且 48MB 阈对 116KB 存量永不触发=纯成本零收益；plan 外审证伪；v2.4 修分类与预算）**："装载超时 fail-closed→doc 打不开→无 store→compact 60s 门限不触发→积压永不消化"自锁闭环仍须消灭，但触发时机=**真实超时**而非前置探测：`loadForHydration` 捕获装载事务失败后**先分类（v2.4：仅 P2028/P1008 或 timeout 语义错误触发自愈；**P2024（连接池取连接超时——池饥饿，非事务超时）排除**：自愈的 compact 是交互式事务、自身需持池连接，饥饿期执行=零成功率纯放大，直接 fail-closed；P1000/P1001/P1010/P1017 认证/不可达/拒连类同不放大）**→**串行**跑一次 compact，**自愈增量预算 ≤8s（v2.4 从 60s 下调——60s 挂在客户端已放弃的请求上下文里零收益、纯挂住 Nest handler 与池连接）：compact `{timeout:6_000, maxWait:1_000}`（装载事务已回滚，无并发装载——与 E42⑤"装载进行中 compact"警示不同态，注释写明时序）→重试装载一次 `{timeout:2_000, maxWait:500}`**；compact 自身失败→WARN+计数（**不构成新 fail-closed 死锁**）→仍以剩余预算重试装载→仍失败才 fail-closed。零常态成本。`scripts/collab-compact.mjs` 为最终人工出口（compact+装载双失败时运维动作）。自愈路径（连同崩溃接管租约等待）为 §7.2 预算规则的两条例外路径——预期超出客户端 synced 死线，客户端承接归 Y0b 同批发布（§9.7）。
- 单行 update>4MB：WARN+计数（硬拒绝归 Y0b 配额批——已入库数据不该在装载侧 DoS 自己）。
- MVCC 语义注记（写进方法头注释）：RR 快照下 compact 的 DELETE 对本事务不可见——缺口结构性不存在。
- **人工出口**：`scripts/collab-compact.mjs <projectId>`（直调 repo.compact+打印前后水位/行数/字节）。脚本属运维工具非运行时路径，与"compact 必须 await"扫描门禁的边界在门禁声明中写清（扫描范围=src/）。（**Y0a-1 执行载体裁定**：落地为 `apps/api/scripts/collab-compact.ts`+tsx——静态 typecheck 载体（tsconfig.scripts.json 经 verify 常检）+直调 TS repo 单源；输出=前后行数+`{compacted,reason}` 契约（水位/字节从简）。）

**1.5 库行为锚断言（§1.2 表承重锚，每条一用例）**

装最小 Server+直连：A1（store 钩子抛错→doc 仍在 documents）/A2（卸载四条件）/A5（失败后不重武装 debounce——debounce id 在 run 起始删除，两条 catch 分支均不重排）/A6（disconnect unloadImmediately 默认 true 且 await store）/A7（pendingStructs 边界：构造超前行产生 pending、整行缺失不产生）/**A8（直接 `import { shouldSkipStoreHooks } from '@hocuspocus/server'` 断言 withDoc 写入（source=local 无 skipStoreHooks）必触发 store——公开导出禁手写等价物）**/**A9（最后连接关闭→脏 doc 被销毁——spool 承重性的库级依据）**。锚与 pin 联动：pin 变更（本批移除 extension-redis）→锚随 collab-core 常跑自动重验。
- **storeInFlight 计数器移 Y0a-2（v2.2——Y0a-1 挂现有回灌路径恒 0=死代码，出口判据不可证伪）**：Y0a-2 形态=prom-client Gauge（/api/metrics 可取，spec §5.2 事后取证口径）+enter/leave 与批次归属转移**同点**（try/finally 单点，防双扣）+关停结构化日志+Y0a-3 经 /api/ready.pending 消费。

**1.6 真 PG 隔离性质用例（仓库第一条真库隔离验证——现有 collab 套件全 mock）**

- 沿用 hasDb 门控惯例（`*.int.spec.ts`；CI test job 已设 DATABASE_URL 真跑，本地无库跳过）；**int 用例自建所需 FK 行（自包含，不依赖 seed）**；collab-core 加"int 用例执行条数 ≥N"断言（vitest --reporter=json 计数——防"本地跳过+CI 也跳过"双假绿，v2.1）。
- 用例：真 PG 开 RR 事务走 loadForHydration 分页读（页间 pause）→并发提交一次 compact→断言事务读到的行集自洽完整（MVCC 快照一致性，无缺行）。**不包装为"撕裂复现"**——是隔离级别性质验证（结构锚）。
- 可达性固化：装载进行中直调 compact→断言装载结果完整+库调度串行（锚 A4 的回归防线，防未来 fire-and-forget compact）。
- stateSeq 一致性：compact 后断言 `stateSeq === max(被删行 seq)`（精确赋值的回归锚，v2.1）。

**1.7 故障注入器（测试基建）**

- **故障注入两层（v2.2 砍 Proxy 形态——无消费者且与"dist 无 test-utils"矛盾：Y0a-2 演练需子进程注入，Proxy 在 dist 排除之下不可达）**：①单测/int 层=`test-utils/failing-repo.ts` **repo 边界 stub 助手**（~15 行，stub append/compact 抛错——循既有 repo stub 惯例）；②演练层（**Y0a-2 落地并登记**）=**DB 级注入**：`CanvasDocUpdate` 挂临时 `BEFORE INSERT ... RAISE EXCEPTION` 触发器（或 `REVOKE INSERT`），演练结束 drop——零生产足迹，比应用层开关更真实（"PG 拒写"本就是真实故障模式）。构建排除（tsconfig.json exclude `**/test-utils/**`）+dist 断言保留为廉价保险。

**1.8 对抗语料最小版（E70）**

- packages/shared **`src/testing/adversarial-doc.ts`**（v2.1：testing 子目录+check-shared-dist 显式排除/登记——生成器仅测试消费不进 dist 导出面）：种子化生成器（超长字符串 1MB/深嵌套 128 层/环自指互指/未知字段/空子 map/畸形类型）；api 读者全函数断言（readRecordsFromMaps/ensureSchemaVersion/toDocLike 任意语料不抛）。

**1.9 双 client 装置提取（E40）**

- 从 collab.gateway.spec.ts:43/:95 提取 integration 夹具为可复用 helper（真 Provider×2+真 Server 随机端口）：互写收敛+断连重连再收敛断言。Y1a/Y2 复用此装置扩展。

**1.10 load 路径 stash 语义 peek→apply→consume（E43② 第四条蒸发路径；v2.4 补工作项——§4.1 出口与 E43② 均声明"已前移落地"而本节原无对应项=E30 要消灭的形态）**

- `takeStash` 在 load 路径**不再存在**：改 peek→apply→consume，**consume 在版本门（ensureSchemaVersion）与 stamp 全部通过之后执行**（`unflushed` 有 stash+版本门拒绝的档→现在会"takeStash 已删+库 closeConnections+unloadDocument 丢弃 doc"=stash 双重蒸发）。
- 用例：unflushed 有 stash+构造会被版本门拒绝的档→断言抛 schemaRefusal **且 stash 仍在**；正常档消费后消失。
- store 提前 drain（:273）/retry stash 级（:380）两处 peek 语义化归 Y0a-2（E43② 本批余量）。

### Y0a-2 失败路径与关停

**2.1 契约声明（代码头注释钉死）**

> PG=单实例 delta 并集日志（append-only）；CRDT 幂等收敛（重复/乱序 apply 安全）；锁只管 compact；内存 pending 队列=去抖窗口非持久层；**spool 文件=store 故障期唯一权威待落库台账**；onStoreDocument **不 throw**（失败→putStash→返回 false；自有 hook 抛错跳链=锚 A1/A5 前提）。

**2.2 spool 单源落盘（删内存 unflushed Map；P0-3；v2.1 形态=分段+整段 unlink+帧 id confirm+quarantine）**

- `collab-spool.service.ts`，目录 `COLLAB_SPOOL_DIR`（默认 `<repo>/.data/collab-spool/`；ecosystem env 注入绝对路径——Y0a-4）。
- **每实例子目录（v2.5/SV10，R3）**：段文件落 `dir/<owner>/`——owner=租约 owner 同值（文件系统安全形态，禁路径逃逸字符）；`spool.setOwner(owner)` 必填 fail-closed（未设置即抛——禁"默认单机不分目录"）；多实例并存各写各的子目录互不覆盖。
- **分段文件形态**：`<projectId>.<segSeq>.spool` 段内追加帧 `[4B len][4B CRC32][payload]`，段满 4MB 滚动新段；**putStash=append 帧到当前段+同步 fsync 文件**（唯一持久动作）。**confirmStash=按帧 id 定位**（peek 返回 `{frameId,payload}[]`；confirm(frameIds) 在内存记 confirmed 集，**某段全部帧 confirmed→整段 unlink**——unlink 原子，天然消灭 v2"重写文件去帧"在重写中途崩溃=台账全丢的窗口；**禁按项目粒度删全部帧**——peek 与 confirm 之间新帧写入窗口会被误删）。**段 unlink 的两个触发点（v2.4 写死）**：①confirm(frameIds) 后段内全 confirmed→unlink；②**启动回灌成功后**对"全部帧已被 PG 覆盖"的段直接 unlink——防跨进程崩溃后"已 append 未 unlink 的段"只进不退；重启致已落库帧被重复回灌=常态，由 CRDT 幂等吸收（重复行性能代价，非正确性）。崩溃语义：confirmed 集丢失→重启重复 peek/append→**幂等降为第二道防线**（只承担重复行性能代价，不承担正确性——CRDT 幂等使重复 apply=no-op）；尾部截断（CRC 不符/长度越界）停在该帧+`yjs_spool_truncated_total`+ERROR，禁静默续读。
- **写失败（磁盘满/IO 错）不 throw（v2.1 撤 tripwire throw——与主路径 splice 叠加=新蒸发窗口，见 §1.5/2.3 BOI）**：`yjs_spool_write_failures_total` 计数+**批次留在原归属地（doc 队列不动）+调度退避重试**；连续 5 次写失败→**熔断**：collab 转只读（就绪门 not-ready，reason=spool-unwritable，停收新编辑）——"拒绝新写入"而非"丢已收批次"；**解熔断=每 30s 试写探针帧+删除，成功自动恢复**+计数（无手工开关）。容量：单段 4MB/总量 256MB，超限同熔断路径（不丢最旧——丢=蒸发同罪）。
- **启动回灌（先于一切对外服务）+硬上限（v2.1，防启动死锁）**：init 扫描目录→**单帧颗粒度**逐帧尝试 append+confirm（一帧坏不阻塞整项目）；回灌失败（PG 未起）按退避重试，**硬上限 5 次×指数退避封顶 60s**——超限后不再阻塞 ready：坏帧**记 sidecar 隔离标记**（见下）+`yjs_spool_quarantined_total`+ready 保持绿但响应体带 `spoolQuarantined: N`（**>0 应触发运营告警而非仅可见——§9.12 LWW 覆盖语义**）——消灭"坏帧/FK 永久失败→ready 永假→部署拒重启→运维锁死"（v2 会新引入的不可恢复状态，与 fail-stuck 同类错误）。FK 23503 识别=按 project.gone 终态丢弃（2.5）；其余不可解析帧走隔离标记。
- **外来段收养（v2.5/SV10）**：boot 回灌扫描 `dir/*/*`——**外来段（owner≠本实例）boot 即收养**（前任 kill 后段仍在=数据在，收养不挑 owner）；**截尾分档**：本 owner 段坏尾=truncated 报告+计数（既有语义）；外来段坏尾=**静默截断 sealed**（前任 kill 瞬间半写=常态非异常）；**运行期新出现的外来段归 reconciler**（mtime 静默 60s 后收养——写者死亡的段不再活跃）。
- **quarantine=sidecar 标记，不搬字节（v2.4——"移入 quarantine/ 子目录"与契约 12"只用追加与整段 unlink"互斥：追加-only 段内移帧物理不可行（重写段=违契约/整段搬=误伤好帧）→含 1 坏帧的段永不满足"全帧 confirmed"→永不 unlink→占用额度→累计 256MB 慢速只读）**：段内坏帧→在 `<seg>.quarantine` sidecar 追加写 `{frameOffset, len, crc, reason, firstSeenAt}`（自身 append-only）；**段 unlink 条件=所有非隔离帧已 confirm**（非"全部帧 confirmed"）；**容量核算含隔离字节**（Y0a-2 V3 执行态——256MB 总口径=段文件字节总和，坏尾字节持续占额度、可正常触发只读熔断：坏帧不豁免，防"隔离区无限增长永不熔断"；独立字段 `quarantinedBytes` 仅观测不豁免，处置出口=collab-spool-quarantine 人工脚本删段）。
- **逃生阀脚本**：`scripts/collab-spool-quarantine.mjs <projectId|--all> [--dry-run]`（**外置导出+人工判定后删段**——sidecar 形态下唯一允许删段的路径，人工可审计；打印内容摘要供人工判定）——与 collab-compact.mjs/collab-spool-import.mjs 同族（compact 有人工出口而 spool 没有=v2 不一致，v2.1 补齐）。
- 内存只留**键集缓存**（哪些 projectId 有段——putStash 加键/整段 unlink 删键/启动扫描重建；非权威数据副本）。
- 指标：`yjs_spool_depth{files,bytes}` gauge（**total 口径=own+stranded 全目录求和——磁盘真值，容量核算与 G-1 故障腿判据同口径，v2.5/SV11；部署门=own 分区（§3.3 pending）**）+四计数；**启动自检**：spool 非空或回灌失败→ERROR 结构化日志打印清单（§5.2 口径）。
- **既有断言改造清单（v2.1 登记，N6）**：`unflushed` 被两 spec 12 行消费（collab.gateway.spec.ts:611/633/644/649/668/671/682/685/738 绿8/绿8b/绿8c 三用例链+persist-status.spec.ts:111/119/123）——改断言 spool 帧存在（本就在测"失败后数据还在"，语义升级）；`yjsUnflushedProjects` gauge 改语义为 spool 键集大小（plan 阶段 grep 仪表盘消费者后定删或改）。

**2.3 storeDocument 失败路径重写（D-2/D-3；v2.1 升格为 BOI 不变量）**

> **批次所有权不变量（BOI，进冻结契约 §4.3-11）**：任何批次在任意时刻必须至少归属于 {doc 队列, spool 已 fsync, PG 已提交} 之一；**离开旧归属必须先进入新归属**。

主路径重写（v2.4：append 改 **AppendResult 判别消费**——`$queryRaw` 对 fenced（0 行）**不抛异常**，原伪代码 `try/catch` 形状会把 0 行当成功照常 splice=批蒸发（Y0a-2 无 fence 时测试全绿、Y0a-3 加 fence 后静默丢批）：

```
const n = queue.length; if (n === 0) return false;
const payload = n === 1 ? queue[0] : Y.mergeUpdates(queue);   // 只读副本，不动队列（copy-first）
let appended = false, fenced = false;
try {
  const r = await repo.append(projectId, payload);            // AppendResult（§1.2 契约）
  if (r.ok) appended = true;
  else if (r.reason === 'fenced') {                           // fenced=终态
    fenced = true;
    collab_lease_lost_total.inc(); selfIsolate('fenced-by-write');   // 拒新 WS+closeAll+ready lease-lost
  }                                                           //   不调度重试梯：重试无意义且掩盖租约失守
  else throw new Error('append returned no row');             // 非 fence 空行=真异常，走同一下行
} catch (e) { /* append 失败（非 fenced）：落下行 */ }
if (!appended) {                                              // fenced 与失败同路：批必须入账
  try { const frameIds = await spool.append(projectId, payload);   // fsync 完成才返回；spool=本地磁盘，不受租约约束
        queue.splice(0, n);                                        // 新家落定后才移出旧归属
        /* frameIds 待下次 store/回灌 confirm；fenced 批的恢复见 §9.13 */ }
  catch (e2) { /* spool 也失败：队列原样不动——批仍在 doc 队列归属地（fenced∧spool 双败=极端事故态，§9 登记） */
        yjs_spool_write_failures_total.inc(); 熔断判定(); if (!fenced) schedulePersistRetry(); }
  return false;                                                    // 任何路径不 throw
}
queue.splice(0, n);                                                // append 成功（r.ok===true）：移出
await maybeCompact(projectId);   // 现状语义维持；compact 返回契约（§1.3）——仅 compacted 开窗/abandoned 走 ERROR
```

（三段式回灌路径 peek→append→confirm 同判：`!r.ok` 与 throw 合并为失败路径走"帧保留+不 confirm"，`confirm` 恒在 `r.ok===true` 之后——契约 15。）

三硬约束：①`queue.splice` 永远在"新家落定"（append `r.ok===true` 或 spool fsync 成功）之后——`:276` 现状 splice-first 列入改动面；②**onStoreDocument 任何路径不 throw**（含 spool 失败——熔断语义=停新写入+计数，不是丢批；v2 的"先 splice 再找家+putStash throw"组合在磁盘满时恰丢最不能丢的批）；③失败必须调度重试（锚 A5：库不补）。同形状两处一并改：`stashPending`（:422 splice 后 putStash）与 store 提前 drain（:273-274 spool 帧与内存批合并单行 append→成功统一 confirm）。
- takeStash **三调用点统一 peek 语义**（load 回灌 :224/store 提前 drain :273/retry stash 级 :380）：peek→append→confirm；append 失败帧在（含 1.1 表第四条路径：load 路径 takeStash 后续抛错不再丢 stash）。
- **gateway 侧 store 入口全走 `saveMutex.runExclusive` 串行**（v2.1，锚 A10）：retryPersist/drain/disconnect 对 storeDocument 的直调绕过库 mutex（库自己的 store 走它）——统一后消灭"卸载与 flush 竞争"（A2 第三条件天然成立）与并发取批交错。
- 重试无上限：退避 `[1s,2s,5s,15s,30s,60s,60s,…]` 封顶 60s，永不"耗尽"。
- **afterStoreDocument 最小对账**（E11③ 遗留）：store 钩子完成后队列非空且非 spool 键集命中→`yjs_store_tail_anomaly_total`+ERROR（第二道漂移探测器，与 storeInFlight 同源数据）。
- **Y0a-1 移入项登记（v2.2）**：①storeInFlight=prom Gauge+enter/leave 与批次归属转移同点（try/finally 单点）+关停结构化日志+Y0a-3 ready.pending 消费；**增减点恒 2 处（v2.4，契约 14）：进入取批 / 归属落定（append `r.ok===true` 或 spool fsync 成功）——drain 的 force-spool 必须复用同一落定点（禁旁路直调 spool.append 而不减计数，否则计数器测的是"经过取批的批次数"而非"批次数"）**；②演练层故障注入=DB 触发器/REVOKE（`CREATE TRIGGER ... BEFORE INSERT ON "CanvasDocUpdate" ... RAISE EXCEPTION`，演练结束 drop——kill9 演练脚本内置）。

**2.4 关停 drain（P0-2+A6 语义；v2.1 预算表化+force-spool+直连归还；v2.4 预算压 ≤22s——原表加算 30s≠28s（2+0+8+10+8+2=30 零余量）且步骤 1"直连超时"无界）**

onApplicationShutdown 重排（六步），**预算表写死（合计 ≤22s，kill_timeout 45s 内留 ≥23s 安全垫——v2.4 定表时按 30s 算垫 ≥8s，v2.5/SV6 随 kill_timeout 45000 同步）**：

| 步 | 内容 | 预算 |
|----|------|------|
| 1 | `draining=true`（就绪门翻 not-ready：拒新 WS 升级+REST 写路径门关闭——与 Y0a-3 联动；**与 /api/drain 同一状态位，幂等**）+在飞直连：withDoc 新进入者立即拒；已在飞的**宽限 2s 后不再等待归还**（disconnect 是 await 的，锚 A6；未归还者计入步骤 5 `hangReason:'direct-open'`——直连滞留是 RTO 问题非数据问题，store 不依赖连接计数；closeAllConnections1012 只遍历 WS connections 不触 direct（A3）） | ≤2s |
| 2 | closeAllConnections1012（停收新写） | 瞬时 |
| 3 | `flushPendingStores()`（库自持 debounce 队列）**可超时**（Promise.race ≤6s——重试梯 60s 封顶的 doc 会拖过预算；且它只处理"仍在 debounce 中"的 store（≤maxDebounce 3s 窗口），**对已失败队列非空的 doc 无效——主力是步骤 4**，此事实写进代码注释防误判） | ≤6s |
| 4 | 自管 drain：遍历 pendingUpdates 非空 doc→storeDocument（BOI 主路径）；**末步对仍未落库 doc 尝试 force-spool**（putStash fsync）——成功则该批归属落定；**失败则该批留在 doc 队列并在关停结构化日志中如实点名（不得声称 0）**（v2.4 撤"构造性成立"——G-2a 口径，§0 目标 2）；完成后记 `{event:'shutdown_drain_complete', pending:{projects,batches,spoolFiles,spoolBytes}, storeInFlight}`（**G-2a 可断言字段**） | ≤8s |
| 5 | server.destroy() 与 4s race（兜底——主力是步骤 4，此步只兜 destroy 挂起）；超时日志升**结构化 JSON 可断言**：`{event:'destroy_timeout', docs, pendingBatches, spoolFiles, spoolBytes, storeInFlight, hangReason:'store-undrained'|'direct-open'}`——**分型两种挂起原因**（store 未落库 vs 直连未归还，v2 混在一句），storeInFlight 终值随行输出 | ≤4s |
| 6 | 租约显式释放（Y0a-3：末尾、drain 之后；deploy 不等 TTL）。**必须执行到（v2.4 显式约束）：预算耗尽时宁可放弃步骤 5 剩余等待也要跑——释放被 SIGKILL 截断则下一实例必须等满 TTL 才 listen，直接吃进 RTO** | ≤2s |

**2.5 项目消失单点收敛（P0-5）**

- 新事件 `project.gone`（payload {projectIds}）：project.service delete(:112)+cleanDrafts FOR UPDATE 事务(:121-131，Y0a-2 X13——SELECT…FOR UPDATE 锁定集+deleteMany+提交后按确实被删集 emit)+template.service:163 删除**后** emit（Y0a-2 V11 后置——**提交后** emitAsync，回滚=无 emit=无假终态；emitAsync 形态循 team.service:408-429 既有约定——**处理器内禁慢操作**：await 全部监听器会拖长删除请求）；**team.disbanded 监听改双订阅汇入同一处理**（team.service 级联删=第二入口）；template 链 plan 阶段核对删除对象（防把模板删除误当项目消失）。
- 处理（与 team.disbanded 同址）：关连接（payload-only 不查库——规避 emit/删除时序问题）→清 persistRetry/lastCompactAt（**仅内存终态表——v2.4：spool 段一律不在删除路径上动**；Y0a-2 V11 后置态下"emit 先于提交"的回滚风险面已消（回滚=无 emit=不进终态集）——段不动现由"处理器内禁慢操作"独立承担：unlink+fsync 是磁盘 I/O，违反本节"处理器内禁慢操作"）→终态集 `deletedProjects: Set` →putStash/schedulePersistRetry 对已删项目 no-op+`yjs_stash_discarded_deleted_total`。FK 兜底断言：append 撞 FK→捕获识别 23503→按终态丢弃+计数（不进重试梯）。**残留 spool 段的收割路径=FK 23503 识别（下次启动回灌/append 时按终态丢弃）——一条收割路径、零回滚风险、删除请求零磁盘 I/O**。
- **`deletedProjects` 永久无界登记 §9**（v2.1：进程生命周期单调增长，不可安全清理——量级=进程寿命内删除项目数，接受并登记，防下轮"census 漏项"）。

**2.6 lastCompactAt 清理 + mergeUpdates 出 WS 路径**

- lastCompactAt/persistUnhealthy/键集清理点定稿（v2.1）：**Server 构造配置的 `beforeUnloadDocument` 钩子**（index.d.ts:322 公开配置项，库在卸载前 await 它——非 push 扩展；doc 生命周期结束的确定时点）：清 lastCompactAt+persistUnhealthy（陈旧电平：卸载后 setPersistStatus 无观察者，重连会补推失效横幅）+persistRetry 残留+键集缓存条目。project.gone 清账（2.5）为第二清理点。**钩子体全包 try/catch 永不抛（v2.4，写进钩子头注释）**：库 `unloadDocument` 对该钩子的抛错是 `catch → return`（取消卸载，hocuspocus-server.esm.js 实证）——钩子抛错一次=doc 永不卸载+`destroy()` 永不 resolve（锚 A6 语义）→退化成 8s race+内存泄漏。
- 入队回调只 push（删 :207 封顶合并）；超 64 条→setImmediate 调度提前 store（异步 flush）；合并只在取批时；spy 门禁断言消息回调零 merge 编码。

### Y0a-3 拓扑与租约

**3.1 删 extension-redis+CollabRedisSync**（§1.3 census 全量）+装载 P95 改善落档（确定性收益，:226 少 1s 阻塞）。`collab.gateway.spec.ts:242-244` 的 elapsed<3000 时序断言/注释建立在 RedisExtension disconnectDelay 2×1000ms 上——随扩展删除同批重写（2026-10-06 登记）；multi-instance spec 的 repo 形状随租约改写一并核对。

**3.2 PG 租约（E44 核心+E35 四语义；v2.1：fence 下沉写语句+心跳三态；v2.5/SV1：fence/renew 判据 owner-only；v2.5/SV2：break-glass 运维脚本替 FORCE_TAKEOVER）**

- **owner=每次启动 `crypto.randomUUID()`**（v2.1：事实身份而非主机名/常量；epoch 退化为诊断字段——owner 每启动唯一，比 epoch 更严格）。
- CAS 获取：`UPDATE "CollabLease" SET owner=$me, epoch=epoch+1, expiresAt=now()+$ttl WHERE scope='primary' AND (owner IS NULL OR owner=$me OR expiresAt<now()) RETURNING epoch`（空行=失败）。
- **break-glass 运维脚本（v2.5/SV2，替 COLLAB_FORCE_TAKEOVER env——普通 CAS 对未过期租约恒返空行=逃生阀拿不到锁）**：`apps/api/scripts/collab-lease-breakglass.ts`——**SELECT 前任 owner/epoch/expiresAt**→`UPDATE "CollabLease" SET owner='revoked', epoch=epoch+1, expiresAt=now() WHERE scope='primary'`（'revoked' 哨兵——**epoch 必递增**，fencing 单调性不得被逃生阀破坏）→**审计行落 AuditLog**（`action='collab_breakglass'`，`operatorId` 用系统哨兵值（SSH 执行者非 API 身份无用户态），`remark`/`afterValue` 记前任 owner/epoch/expiresAt；`audit.log` 先例 team.service.ts:188；审计失败 try/catch+finally 清行；**不新建表**——CollabLease 仅 4 列非审计载体）。**被撤实例续租 0 行且 owner='revoked'→revoked 终态不 rejoin**（进程保活但 collab 永久 not-ready，防 1s 内抢回）；**新实例 CAS 经 `expiresAt<now()` 支路立即可得**（expiresAt=now() 即刻过期）。runbook 三步：①跑脚本（打印前任+未 drain doc 清单）②确认旧实例 `collab_lease_revoked` 日志+listener 释放 ③起新实例。
- **心跳三态（v2.1/P3；v2.5/SV1：判据 owner-only——`expiresAt>=now()` 条件删除，TTL 只留 CAS 获取谓词）**：续租 `UPDATE ... SET expiresAt=now()+$ttl WHERE scope='primary' AND owner=$me RETURNING owner` → ①`renewed`（owner=$me）②`fenced`（0 行=owner≠me；二次查行分流：owner='revoked'→**revoked 终态不 rejoin**，他人→确认被接管→isolate+rejoin（SV5））③`unknown`（**抛错**——PG 抖动≠被接管：每 1s 重试直到 expiresAt，到期才 isolate）。**禁止把 unknown 当 fenced**——一次 PG 1s 抖动不得踢全队。
- **fence 下沉写语句（v2.1/P3；v2.5/SV1：判据 owner-only——v2.4 的 TTL 双校验撤销（TTL 只留 CAS 获取谓词），leaseRowMissing 区分+setLeaseOwner 单点注入保留）**：入口内存布尔只拦"进入"，事件循环卡顿期（mergeUpdates 批量编码/compact 重放/4MB 帧）"自以为 owner"窗口达秒级=租约要防的双写本身。落法：
  - **owner 单点注入（契约 16）**：`repo.setLeaseOwner(owner: string | null)`——**唯一写者=lease service**（获取/续租失守/释放时调用），append/compact 内部读取；**禁逐调用点传参**（append/compact/drain force-spool 共 3+ 处，未来新增调用点漏传=静默破防）；`owner===null` ⇒ 断言恒 0 行=天然 fail-closed。
  - **append 的 INSERT 追加（owner-only EXISTS，v2.5/SV1——TTL 双校验撤销：正确性由 owner 单值性+接管顺序保证，"过期自有租约仍可写"属接受态（TTL=RTO 参数）；租约行缺失静默 fence 的 v2.4 顾虑由 leaseRowMissing 区分承接，见下）**：

    ```sql
    WHERE EXISTS (SELECT 1 FROM "CollabLease"
                   WHERE scope = 'primary' AND owner = $myOwner)
    ```
    **0 行=fenced**（单行 PK 子查询热路径每 2s 一查无感——§7.2 预算表已列，非优化目标禁删）。**0 行时二次查租约行区分两种失败（消除静默）**：`SELECT owner, "expiresAt" FROM "CollabLease" WHERE scope='primary'` 返回空→`leaseRowMissing` 错误（**配置错误不伪装 fenced**：ready reason=`lease-error`+ERROR 日志；**v2.5/SV13：该档写路径=批走 spool（BOI）+不排梯+独立计数 `yjs_lease_row_missing_total`——不早退，内存滞留=重启丢批；修复=补行后重启回灌**；手工 seed 段漏跑/库重建即此态）；有行→确为 fenced，走正常失败路径（AppendResult `{ok:false, reason:'fenced'}`→isolate+批走 spool，§2.3）。
  - `repo.compact` 事务首行同款断言→不符即 return `{compacted:false, reason:'not-owner'}`（不删行——**v2.5/SV8：`not-owner` 分立档，`abandoned`=pendingStructs 专用不再混用**；leaseRowMissing 同样上抛区分）。落成后"卡顿进程继续写"从 3s 窗口变结构性不可能（G-3b 用例对象）。
- 参数进 env zod：`COLLAB_LEASE_TTL_MS=10000`/`COLLAB_LEASE_HEARTBEAT_MS=3000`（**v2.5/SV2：`COLLAB_FORCE_TAKEOVER` 删除**——夺锁唯一路径=break-glass 运维脚本；kill9/gate 演练子进程用 `COLLAB_LEASE_TTL_MS=2000` 短 TTL 起+演练脚本清租约行——防被上一持有者挡住致 CI 必红，无 FORCE env）。
- 四语义：独立 unref timer 心跳；续租失败（fenced 或 unknown 到期）=**isolate→rejoin 状态机（v2.5/SV5，lost 非终态）**：isolate=关 listener 让位（新持有者立即可 CAS）+拒新 WS+closeAllConnections+ready reason=lease-lost+`collab_lease_denied/lost_total`+**documents 清空前置**→有界退避 `[1,2,5,15,30]s`（封顶 30s）重获取+**re-listen**（B7 库实证可行）；**revoked 终态不 rejoin**（SV2）；**不自杀不硬撑**；租约只 gate collab——纯 DB REST 不受影响；启动有界重试 30 次（进程保活+ready not-ready 不退出）；关停末尾显式释放（2.4 步骤 6）。**TTL=10s 不为客户端死线下调**（保护对象=秒级同步阻塞；客户端 10s synced 死线改造归 Y0b，§2.2 登记依赖）。
- **三入口门（P0-1）**：`lease.isReady()` 统一判据挂三处——onAuthenticate 尾段（WS）、loadDocument 钩子第一行（**唯一汇聚点+正确性权威点**：WS 与 DirectConnection 都经此）、withDoc 入口（REST 直连前置——**只是省一次无谓装载的早退**，openDirectConnection 在 await 前有微窗口；落成注释写死防未来"优化"掉 loadDocument 那道）。未就绪抛 `{reason:'not-ready'}` 家族错误。
- **readCanvas 按消费者拆分（v2.1 撤 v2 全消费者降级读——计费输入按陈旧快照执行=D1 风险扩大化；v2.4 撤 readSnapshotOnly"无事务单读者"——该形态重开 E20 撕裂+违冻结契约 1；v2.5/SV15 改**按可变性三分法**——v2.4"投影类统一 readSnapshotOnly"把语义读错划进快照出口：clone 改读快照=静默丢去抖窗编辑）**：
  - **只读展示→`repo.readSnapshotOnly`**：仅 video-work.service:328 一处（公开作品页展示）——**与 loadForHydration 共用同一单 RR 事务实现（"一个实现、两出口"）**：

    ```
    private readConsistent(projectId): { state, updates, stateSeq }   // 单 RR 事务（loadForHydration 的实现体）
      ├─ loadForHydration(p) = readConsistent(p)      // 装载出口（含超时自愈包装）
      └─ readSnapshotOnly(p) = readConsistent(p)      // 只读展示出口（不 apply 到 doc、不触 store/compact）
    ```
    撤"无事务单读者"的理由（写进契约 1）：单读者无事务时"先读快照（S0）→compact 并发提交（删 ≤S1、快照=S1）→读 `seq>S0` 增量"拿到 (S0,S1] 已删且不在手上 state=**静默缺行**——正是 E20 要消灭的撕裂，且服务公开作品页。收益不变（不经 openDirectConnection/不装载/不触发 store/compact，顺带消一次全量装载=E14 收益前置一小块）+`yjs_snapshot_read_total{reason}` 计数；陈旧度登记 §9（增量已重放，最坏=进行中编辑未含，语义优于纯快照）；
  - **语义读（clone=video-work-clone.service:33 / video-project.service:92 regenerate 校验）→活读（withDoc）+租约门 503**——克隆/regenerate 产出以活 doc 为准：改读快照=**静默丢去抖窗编辑**（用户刚编辑未落库即克隆=产出缺编辑，比 503 拒服务更糟）；
  - **计费读（execution.service:74）→活读+503 fail-closed**（按陈旧快照烧钱比拒服务更糟，与 E1/E12/E25 口径一致）；
  - `yjs_doc_degraded_read_total` 与 warning 字段**删除**（少一个状态+少一个客户端契约；Y0b 只需消费 503）。**DB 真挂仍 503**（正确性不可保证≠数据不可得，两者分流）。
- 语义注释（service 头，v2.5/SV1 钉死）：租约=**互斥+接管顺序**的活性机制非数据完整性（数据面=PG delta 并集+CRDT 幂等+compact advisory lock）；**TTL=RTO 参数不参与正确性判定**——禁把 TTL 守卫加回 fence/renew 判据；防的是两实例各持 doc 客户端互不可见。advisory lock 替代形态→Y7 多实例时再评估（届时需所有权注册表）。

**3.3 /api/ready 与 /api/health 拆分（v2.1：reason 字面量封闭+独立字段结构）**

- ready：**503 判据=PG（SELECT 1）+租约持有**；响应体结构（shared 定义；v2.1 撤 `lease-held-by:*` 通配——通配串无法进封闭枚举且身份入 reason 是结构错位）：

```ts
{ ready: boolean,
  reason?: 'pg-down'|'lease-held'|'lease-lost'|'not-serving'|'lease-not-acquired'|'lease-error'|'spool-unwritable'|'draining',  // 八值字面量联合（v2.5/SV7 +not-serving），tsc 即封闭门（§6.2 锚）；reason 由 collabState 主导派生，优先级 P6：pg-down > draining > lease-error > lease-lost > not-serving > lease-held > lease-not-acquired > spool-unwritable
  collabState?: 'initializing'|'acquiring'|'starting'|'serving'|'draining'|'isolated'|'start-failed',  // 七态单枚举（v2.5/SV7——消灭布尔组合，状态机单真源）
  holder?: string, epoch?: string,                     // 独立取证字段（host/pid 属内部信息——仅授权档透出，v2.5/SV16），禁入 reason；
                                                       // epoch=String(BigInt)——v2.4 撤 number：JSON.stringify(bigint) 抛
                                                       // TypeError（恰在租约路径=最需它的时刻炸）；用例覆盖 lease-held/lease-lost 两态可序列化
  redis: 'up'|'down',                                  // 不参与状态码（残余用途=BullMQ，不获部署链一票否决权）
  pending: { projects: number, batches: number, spoolFiles: number, spoolBytes: number, strandedFiles: number, strandedBytes: number },  // 三条判据（G-1/G-2/部署拒重启）的唯一 oracle（定义见下注；spoolFiles/spoolBytes=own 口径+stranded 独立键，v2.5/SV11）
  spoolQuarantined?: number }
```

  **公开/授权两档（v2.5/SV16）**：/api 经 nginx 公网可达——无 `x-prometheus-token`（或无效）仅返回四键 `{ready, reason, redis, epoch}`；有效 token（`COLLAB_ADMIN_TOKEN`/`PROMETHEUS_TOKEN`）返回全字段（collabState/holder/pending 含 stranded/spoolQuarantined）。

  **`pending` 字段定义（v2.4 写死计量单位；v2.5/SV11 改 own 口径+stranded 独立透出——两口径：gauges=total（磁盘真值，容量核算+G-1 故障腿判据口径）、部署门=own（drainable））**：
  - `pending.projects` = pending 队列非空的项目数（pendingQueues 中 length>0 的键数——V4 projectId 键控，Y5 同批改名）；
  - `pending.batches` = 上述 doc 的队列条目总数（**update 条数，非合并后批数**——与 storeInFlight 不同量纲）；
  - `pending.spoolFiles` = **own** spool 段文件数（本实例子目录内段数）；`pending.spoolBytes` = own 段文件字节总和（**含隔离字节**，与 §2.2 容量核算同口径；`quarantinedBytes` 独立字段仅观测）；
  - `pending.strandedFiles`/`pending.strandedBytes` = 外来段（owner≠本实例）独立透出——部署门不背外来的账（boot 收养即消化，SV10/SV11）。
  - **稳态行为明示**：活跃编辑者在场时 `batches > 0` 恒成立（去抖窗口定义使然）——**只能作"停止写入后是否排空"的判据（G-1/部署拒重启均以停写为前提），不能作"当前是否安全"的判据**。
  - **可用时点**：Y0a-2 前恒 0（计数器 Y0a-2 才落地）——类型注释写死"恒 0（非缺失）"，防 Y0a-4 部署门拿恒 0 放行=假门禁；Y0a-4 落地时由 G-2b 演练证明该字段真的会非 0。

- **POST /api/drain（v2.4 新增——部署拒重启的"停止写入"入口，无此前置则 `batches===0` 判据在活跃编辑下稳态不可达=门禁失效；v2.5/SV12：**唯一停止写入入口**——Nest dispose 先于模块 shutdown，SIGTERM 后 ready 不可达，不存在"SIGTERM 后再 drain"的第二入口）**：受 PrometheusAuthGuard 同款保护（`x-prometheus-token` 头；先例 metrics.controller.ts:4——同一 guard 复用）。动作=**置 `draining=true`（与 §2.4 步骤 1 同一状态位，幂等）**：就绪门翻 not-ready（reason=`draining`）、拒新 WS 升级+REST 写路径门关闭、**冻结既有连接（v2.5/SV9：readOnly=true+write-frozen stateless 通告——已连客户端立即停写，不等自然超时）**；**不触发关停流程**——只停写、等去抖自然排空（≤maxDebounce 3s+store）。排空进度由 `GET /api/ready` 响应体 `pending` 字段轮询——**draining 档 503 属预期，部署判据读响应体不读状态码**。**自动解除：置位后 60s 未收到 SIGTERM 自动解除**（防部署链在 drain 后中止留下只读僵尸进程）；**幂等=刷新 60s deadline（v2.5/SV9——重复 POST 是续期非 no-op，防部署链重试中途被 60s 误解除）**；**自动解除时冻结连接 close(1012) 复连（v2.5/SV9——readOnly 直翻 false 会让冻结期单侧编辑静默分叉，1012 触发客户端全量重同步）**；内存态（重启即失）。消费方=deploy.sh 部署三步（§4.4）。

  （`lease-error`=PG 通但租约语句自身失败——与 pg-down 是两种运维动作，v2.1 新增档。）
- 进 PUBLIC_PREFIXES+`@SkipThrottle()`（WS context 先例：execution.gateway.ts:16/payment.gateway.ts:14——v2.4 修正引证：/metrics **未用**该装饰器（自持 PrometheusAuthGuard），但 ThrottlerGuard 全局故 /metrics 实际仍在限流域内；防探针吃全站共享限流桶）。
- 消费切换：gate-collab.mjs waitForApiHealth 改轮询 ready **且** waitForPort(3001) 双验（ready 200→3001 可连；**超时预算 ≥TTL+5s**——kill/start 循环按 TTL 计时，防"就绪≠监听"窗口抖红）；deploy.sh post-deploy 等待同目标（Y0a-4）；客户端消费 ready 归 Y0b（§2.2）。

### Y0a-4 进程与部署

**4.1 ecosystem.config.cjs 入库（进程定义唯一源；deploy.sh 内联参数删除）**

```js
module.exports = { apps: [{
  name: 'flowweb-api', script: 'apps/api/dist/main.js', cwd: '/home/ubuntu/flowweb',
  instances: 1, exec_mode: 'fork',            // 单实例钉死：禁 reload/cluster（E35）
  kill_timeout: 45000, kill_signal: 'SIGTERM', // 45s：HTTP dispose 等在飞请求+关停链 ≤22s+垫（E43⑤/SV6——与 deploy.sh 内联 45000 同值，替换原 10000）
  max_memory_restart: '1G', node_args: '--max-old-space-size=768',
  env: { NODE_ENV: 'production', COLLAB_SPOOL_DIR: '/home/ubuntu/flowweb/.data/collab-spool' },
  merge_logs: true, time: true,
}]};
```

- **内存档位=实测前置**（阻塞 Y0a-4 定稿不阻塞前三个子批）：`free -m`+`ps -o rss,comm -C node,postgres,redis-server,minio` 落档服务器画像（含协居组件）→据实测定 old-space/max_memory_restart/软阈组；结构约束写死：**RSS 软阈（Y1c-3 启用时）< max_memory_restart**（v1 的 1.2GB>1G=死代码教训）；三把尺子（堆/RSS/Buffer）不同口径备注。
- **pm2 一次性迁移 runbook**（D-8；M1 实测 pm2 describe 确认现状后执行）：`pm2 delete flowweb-api && pm2 start ecosystem.config.cjs && pm2 save`——防 startOrReload 对旧内联进程参数归属未明致第二实例（租约 fail-fast 会拦，但=全站 collab not-ready，须一次做对）。**迁移后自证（v2.1）**：`pm2 jlist` 断言 `exec_mode==='fork' && instances===1 && kill_timeout>=45000` 进 runbook（挡"起成 cluster→租约 fail-fast=全站 collab 不可用"）。
- spool 目录绝对路径随 env 注入（E37 runbook 闭环：PM2 重启不换 CWD）。

**4.2 DATABASE_URL 连接池显式**

服务器 .env 手工管理（deploy.sh 不覆盖）→runbook 步骤+deploy.sh echo 提示：`?connection_limit=10&pool_timeout=10`（2 核机：api 主池+auth 实例+preload 临时；与装载事务 maxWait=5s 配套——注意 Prisma 交互式事务 `timeout` 与 URL `pool_timeout` 同名不同量纲，代码注释显式区分）。本地默认不动。

**4.3 旁路 PrismaClient**

auth.ts:10 纳管：export `authPrisma`+AuthModule.onApplicationShutdown `$disconnect`（authRedis 受管同款）。main.ts:40 显式登记保持现状（§1.1）。

**4.4 部署链**

- **preflight 头部加本地 `prisma migrate deploy`（v2.1，防御性收口）**：verify 含 verify-indexes（连本地 DB），新迁移未应用到本地库时 preflight 红——正常流程（先 migrate dev）不触发，防御开发者漏迁移即部署；本地幂等几秒。
- deploy_api tar 源补 **apps/api/prisma + scripts/**（迁移文件+冒烟/演练脚本随批到服务器）。
- **post-deploy 冒烟三步（v2.1 重设计；v2.4 改自建哨兵行——原引用 seed 的 default-user/default-team，但部署链不跑 `prisma db seed`（deploy.sh 实核只有 migrate deploy），fresh-server 必挂且与 §4.5"冒烟均自建 FK 行"自相矛盾）**：
  1. prisma 直插**自建哨兵行**（`smoke-<ts>` 前缀的 user/team/CanvasProject 全链——与 §1.6"int 用例自建 FK 行"同一纪律，自包含不依赖 seed）；
  2. DirectConnection 写 marker 节点→断开（触发 store）；
  3. **构造全新 Y.Doc 重放 DB（state+seq>stateSeq）断言 marker 存在**——证明数据真落 PG（绕过内存 doc）→删除哨兵行（Cascade 清理）。
  附带 /api/ready 轮询（60s 超时）；执行链路冒烟挂 Y0b。
- **部署拒重启（v2.4 改"先 drain 再判据"三步——原"重启前 curl ready 判 batches===0"无前置停写阶段：活跃编辑下去抖窗口内必有 pending 批→判据稳态不可达→每次 exit 1→force-restart 沦为日常=门禁失效）**：deploy.sh 重启前**服务器侧**：
  1. `curl -X POST -H "x-prometheus-token: …" 127.0.0.1:3000/api/drain`——进入 draining（**POST /api/drain=唯一停止写入入口，v2.5/SV12**——Nest dispose 先于模块 shutdown，SIGTERM 后 ready 不可达，停写只能发生在 SIGTERM 之前；停收新写+冻结既有连接；**60s 未收到 SIGTERM 自动解除，防部署链中止留只读僵尸**；端点不可达=版本过旧未含 Y0a-3，首次部署跳过本步直接 restart——runbook 注明）；
  2. 轮询 `GET /api/ready`（预算 ≤15s=TTL+maxDebounce+余量；**draining 档 503 属预期，判据读响应体不读状态码**）：判据=**own 口径四零**（v2.5/SV11：`pending.projects===0 ∧ pending.batches===0 ∧ pending.spoolFiles===0 ∧ pending.spoolBytes===0`——pending=own 分区，本实例 drainable 账）；**stranded>0 仅 WARNING 不拒**（v2.5/SV4：外来段 boot 收养即消化，不属本实例账）；ready reason=`spool-unwritable` 时批无法入账、drain 必然超时→直接拒+打印 reason；
  3. 达标→`pm2 restart`（SIGTERM→§2.4 关停六步：pending 已空，drain 秒过）；超预算→打印 pending 清单+exit 1；逃生阀 `./deploy.sh api --force-restart`（打印 `WARNING: N batches at risk` 后继续——真实逃生阀非日常）。
  堵"PG 故障期部署=丢整段"人因窗口（spool 之外第二道防线）。
- **nginx 站点配置 snippet 入库**（deploy/nginx/ 或 docs/deploy/）——v2.1 补齐 `/collab` 的 `proxy_read_timeout`（心跳/长连接）与 `proxy_buffering off`（WS 帧不缓冲），两项现状只存在于服务器。

**4.5 collab-core CI job（E69③；required check；v2.1 补 migrate deploy+执行条数断言）**

- services：postgres+redis（零 MinIO）；步骤（**v2.4 收敛为增量三件+可选一件——原 8 步中④租约 fail-fast 用例/⑤库锚/⑥语料/⑦装置均为常规 vitest spec，`pnpm verify`（test job）已经常跑它们，collab-core 重跑=第二真源，与"防双源"原则自相矛盾**）=①**prisma migrate deploy**（与 test job 同位置——int 用例需要新 schema/约束/租约行 seed）②int 真库用例（显式 DATABASE_URL 跑 *.int.spec.ts）+**"int 用例执行条数 ≥N"断言**（vitest --reporter=json 计数——防"本地跳过+CI 也跳过"双假绿）+**int spec 专用池（v2.5/SV14，X16 根修）**：*.int.spec.ts 从 vitest 默认池 exclude（防默认池并行双跑同一文件）+`vitest.int.config.ts` 专用配置串行+**CI 文件级集合断言**（git ls-files 的 int 文件集 ≡ 实际执行集+零失败零跳过+条数下限）③kill -9/SIGTERM 演练（collab-kill9-drill.mjs——Y0a-2 产物；子进程+kill -9+DB 触发器注入，test job 无法跑；轮询等待非固定 sleep；**子进程 `COLLAB_LEASE_TTL_MS=2000` 短 TTL 起+演练脚本清租约行（v2.5/SV2——FORCE env 已删）**）④（可选）pin 漂移时锚/语料/装置聚焦重跑（注释写明：这些用例已在 test job 经 verify 常跑，此处仅为 pin 变更的聚焦信号）；**dist 无 test-utils 断言移入 verify 链**（构建产物检查属 verify 职责，非 collab-core）。**不重跑 verify 已含 mock 套件**（防双源——"collab 绿"唯一定义=test job）。seed 不进 CI（int 用例与冒烟均自建 FK 行，自包含）。
- 本地等价命令标注进 §6 表。

**4.6 env zod 收口（D-12）**

新增参数（LEASE_TTL/HEARTBEAT/SPOOL_DIR/MAX_LOADED_DOCS 预留——**v2.5/SV2：FORCE_TAKEOVER 不再立项**，夺锁唯一路径=break-glass 运维脚本）+既有 `COLLAB_PORT/COLLAB_DEBOUNCE/COLLAB_TIMEOUT/COLLAB_SWEEP_ENABLED/COMPACT_INTERVAL_MS` 一并进 config/env.ts zod（同批收口，消灭第三套 env 读法）。

**4.7 复审登记（Y0a-2 Task 5 复审遗留，随本批收口）**

- **M-2 装置收口**：dual-client kit 无"只关 listener"出口（dispose=整 server.destroy——种子 doc 留 documents Map 时库 destroy memoized 等 documents 清空永不满足，用例只能 destroy 打桩/摘 doc 规避）。collab-core 演练若复用该装置，先补 `closeListener()`（只关 HTTP listener 不动 documents Map）。**〔Y0a-4 执行注记：判定不触发——kill9-drill 对 dual-client kit 零 import（collab-kill9-drill.ts:139 实证——仅注释借 URL 形态）；T2 的 env 注入改动未引入 kit import，判定维持〕**
- **M-3 destroy 快速 reject 误分型**：onApplicationShutdown 步骤 5——destroy 快速 reject 时 catch 吞错且 `destroyed` 不置位→恒走 `destroy_timeout` 且 hangReason 按 pending 分型（"失败"误报成"挂起"）。演练采样/告警口径按 destroy-failed≠destroy-timeout 区分读日志；修复归 Y0a-3 destroy 链或独立小批，不随本批。**〔Y0a-4 执行注记：未修，归 Y0c——destroy_timeout 仍仅 hangReason 两分型（store-undrained/direct-open，collab.gateway.ts:1219），无 destroy-failed≠timeout 分型〕**

---

## 4. 出口判据+回滚动作+冻结契约

### 4.1 出口判据（§0 四条目标展开；每子批独立出口=用户确认点）

**总判据（对应 §0）**

| # | 判据 | 载体 |
|---|------|------|
| G-1 | kill -9 演练（**双模式 quiescence barrier，v2.4**）：**正常模式**=驱动脚本停写→轮询 `pending.projects===0 ∧ pending.batches===0` **持续 ≥maxDebounce(3s)**→此刻序号集=已接受集→kill -9→重启→断言重放行集 ⊇ 该集合；**故障注入模式**（DB 触发器拒写）=停写→`projects===0 ∧ batches===0 ∧ spoolBytes 连续 2 次采样不变`→已接受集（全部在 spool）→kill -9→重启回灌→断言 ⊇+spool 帧全部 CRC 通过（**目标 1**） | collab-kill9-drill.mjs（collab-core） |
| G-2 | SIGTERM 演练双判据（**v2.4 拆 a/b——原"storeInFlight===0"单一判据不覆盖"从未取批"的 doc 且"构造性为 0"不可证伪**）：**G-2a**=drain 结束、`server.destroy()` 之前构造性断言 `pending.projects===0 ∧ pending.batches===0`（写入步骤 4 的 `{event:'shutdown_drain_complete', pending}` 可断言字段；spool 不可写注入档=`shutdown_undrained` 日志与 storeInFlight 值一致且 ready 已转 draining——归属要么落定、要么被如实点名）∧ spool 可读帧全部可解析；**G-2b**=注入"append 失败+spool 写失败"→断言批仍在 doc 队列（BOI 红→绿——storeInFlight 口径的机制证明载体，§6.1 已有此门）（**目标 2**） | 同上 --signal 模式 |
| G-3 | 双进程 fail-fast：第二实例不 listen+WS 拒+REST 写路径拒（三入口门各一用例）（**目标 3 前半**） | collab-core（multi-instance 改写） |
| G-3b | **fenced-owner**：A 持锁→B break-glass 夺锁→断言 A 的 append 返回 `{ok:false,reason:'fenced'}`/compact 不删行、A 下次心跳自隔离、A 期间 writeExecStatus 不产生行（**目标 3 后半——写语句 fence 的验收**）；**+fenced-append 三断言（v2.4，契约 15 的证明载体）**：注入 A 的 append→断言 (a) A 的 spool 帧仍在（未被 confirm）(b) A 的 doc 队列未被 splice (c) A 在 1 个心跳周期内进入 lease-lost——红相=对"不检查返回值"的实现，帧消失+PG 无行 | vitest+collab-core |
| G-4 | ready 故障注入：PG 停→pg-down；租约被占→lease-held（+holder 字段）；租约语句失败→lease-error；spool 满→spool-unwritable（**目标 4**） | vitest+collab-core |

**子批出口（达成即请用户确认再进下一子批）**

| 子批 | 出口 |
|------|------|
| Y0a-1 | 隔离性质用例绿（真 PG，**载体=collab-core int 步骤**——本子批即建最小 job）；库锚（实际集合=A1/A5/A6/A7/A8/A9，**独立最小 Server 承载**）绿；svDominates 纯函数单测锚绿（阳性+阴性对照）；stateSeq 精确赋值断言绿+updatedAt 回归断言绿；语料全函数绿（DocLike 工厂+真 Y.Doc 双路径）；装置提取后既有 collab 套件全绿（mock-repo 工厂切换）；verify-indexes.sql 新块绿（含冗余索引 NOT EXISTS 否定块）；**四条扫描门禁落**（装载唯一入口/compact await/stateSeq 唯一写者/append 唯一入口）；takeStash 搬移用例绿（第四条蒸发路径本批关闭）；dist 无 test-utils；doc-gate canonical 无漂移 |
| Y0a-2 | **BOI 红→绿**（对 :276 splice-first 旧逻辑注入 spool 失败=丢批红相留档→copy-first 绿）；G-1/G-2 演练绿（**G-2a/G-2b 双判据口径，v2.4**）；quarantine 硬上限用例绿（坏帧不再阻塞 ready+**sidecar 形态段可回收**）；project.gone 清账+FK 兜底断言绿（**处理器零磁盘 I/O**）；mergeUpdates spy 红→绿；12 处 unflushed 断言改造完成；**pnpm verify 全绿** |
| Y0a-3 | 删除面 census 清零+pin 三包绿（正则两条——见 §1.3 注）+锚重跑绿；G-3/G-3b/G-4 绿；gate-collab 切 ready（双验+TTL 预算）后全绿；读侧三分法用例绿（只读展示=readSnapshotOnly 仅 video-work.service:328/语义读+计费读=活读+租约门 503——v2.5/SV15）；心跳三态用例绿（unknown 不误隔离）+rejoin 状态机用例绿（revoked 不复得） |
| Y0a-4 | 部署链 dry-run 全绿（preflight+migrate deploy+冒烟三步）；ecosystem+pm2 迁移一次成功+jlist 自证（M1 实测后）；collab-core required 生效（故意注入 failing spec 验证红+int 条数断言）；内存档位实测落档 |

### 4.2 回滚动作（revert 提交制；开发期回滚=`git revert`+`prisma migrate reset`，**不写 down 迁移**——Prisma 无标准 down 流程，为不存在的生产写 down=纯负债）

| 变更 | 回滚 |
|------|------|
| schema（@@unique/stateSeq/CollabLease） | revert+migrate reset（约束/列/表随 reset 重建基线；旧代码不读新列，revert 后无需 ALTER） |
| 删 extension-redis/CollabRedisSync | git revert+pnpm install |
| 租约三入口门 | revert（代码回滚即语义回滚；租约行留库无害） |
| spool | **回滚前先 drain**：`scripts/collab-spool-import.mjs`（随批交付：读帧→append→confirm，回滚 runbook 步骤）——否则"残留文件不读"=回滚动作本身丢数据 |
| ecosystem/deploy/pm2 | revert deploy.sh+删 ecosystem；pm2 侧一次性 `pm2 delete+start（旧命令内联）+save`（runbook） |

### 4.3 冻结契约（本批后不得绕过；11-14 为 v2.1 增补，15-16 为 v2.4 增补）

1. **装载/快照读唯一入口=repository 的单 RR 事务读（v2.4 改写："一个实现、两出口"——`readConsistent` 同一实现，`loadForHydration`（装载出口）/`readSnapshotOnly`（只读展示出口，v2.5/SV15 三分法下唯一快照消费者=video-work.service:328）共用）；**装载游标恒 0n 全量 apply——`seq>stateSeq` 水位过滤已删（v2.5/SV3）**：水位不是正确性载体（正确性=读侧全量+CRDT 幂等），stateSeq 仅作诊断/未来增量装载水位，其诚实性由 append 取 compact 同 key advisory lock 保证——**禁以"有锁了"为由把读侧过滤加回来**；两出口之外任何直读两表拼装的新代码（含"无事务单读者"形态）=违规（扫描门禁锚按"两出口之外零直读"实现）**。
2. append 唯一入口=`repo.append` 单语句；(projectId,seq) 唯一；INSERT 携带租约断言（**owner-only EXISTS 形态，v2.5/SV1——TTL 只留 CAS 获取谓词，禁把 TTL 守卫加回**）；INSERT 前取 compact 同 key advisory lock（v2.5/SV3——stateSeq 水位诚实性）；返回 **AppendResult**——fenced=`{ok:false, reason:'fenced'}`（0 行），禁以"未抛错"判成功。
3. **onStoreDocument 任何路径不 throw**（含 spool 失败——熔断语义=停新写入+计数，不是丢批）。
4. **spool=失败批唯一持久记录**：内存无 unflushed Map；peek→append→confirm 三段式全调用点；入账（fsync 完成前）先于一切返回。
5. compact 调用必须 await（src/ 范围扫描；scripts/ 运维工具豁免并显式登记）；事务首行租约断言。
6. 租约三入口门：未持租约不 listen、不接 WS、不进 loadDocument/withDoc；fence 落写语句非仅内存布尔。
7. /api/ready 语义：503 判据=PG+租约；Redis 仅报不 gating；reason=字面量封闭枚举；holder/epoch/pending 为并列字段禁入 reason。
8. spool 帧格式（len+CRC32+分段文件名）与目录（ecosystem 绝对路径）冻结——Y1c-1 世代扩展向后兼容。**confirm 语义（Y0a-2 V1）**：帧 confirm 恒在 PG append 成功之后；失败路径落盘的新帧（本批）在 PG 成功前永不 confirm——回收出口=后续恢复路径的 append 成功（store 提前 drain/断连 flush/退避梯/启动回灌）。
9. 进程定义唯一源=ecosystem.config.cjs（deploy.sh 禁内联 pm2 参数）。
10. stateSeq 唯一写者=compact 事务，**恒等于本次事务实际删除集的最大 seq（精确赋值）**；append 不触碰；**GREATEST/单调化包装禁用**——并发 compact 需先落 Y1c-1 CAS 形态。**append 取 compact 同 key advisory lock（v2.5/SV3）**——append 与 compact 同键串行，stateSeq 作为诊断/未来增量装载水位的诚实性由锁保证；**读侧 `seq>stateSeq` 水位过滤已删（readConsistent cursor 恒 0n 全量 apply）——水位不是正确性载体，禁以"有锁了"为由把读侧过滤加回来**。
11. **批次所有权不变量（BOI）**：任何批次任意时刻至少归属于 {doc 队列, spool 已 fsync, PG 已提交} 之一；离开旧归属必须先进入新归属；`queue.splice` 永远在新家落定之后。
12. **spool 帧删除恒在 append 成功之后**（"删帧先于 append"=数据蒸发，永久禁令——v1 takeStash 先删即此错）；帧文件变更只用追加与整段 unlink（禁原地重写）；**quarantine=sidecar 标记不搬字节；段 unlink 条件=非隔离帧全 confirm（v2.4）**。**truncated 段处置例外（Y0a-2 V2/V3 执行态）：置 `sealed` 标记+sidecar 记录坏尾区间——只置位、不删字节、禁 ftruncate**（坏尾字节保留在段内，unlink 原子性不受损；回收出口=collab-spool-quarantine 人工脚本整段删除）。
13. **大积压 doc 自愈是装载路径的义务（v2.4 形态=超时自愈一次·仅可重试类：装载事务失败且属 **P2028/P1008/timeout 类**触发——**P2024（池饥饿）排除**：自愈动作自身需持池连接，饥饿期执行=零成功率纯放大，直接 fail-closed→串行 compact{timeout:6s,maxWait:1s}→重试装载{timeout:2s,maxWait:500ms}（**自愈增量总预算 ≤8s**）；非可重试类直接 fail-closed；禁前置全量聚合探测），不是运维脚本的义务**；人工 compact 为最终出口。
14. flush-at-risk 口径=storeInFlight（已取批未落库未入账）；库去抖窗口不属此判据；**增减点恒 2 处：进入取批 / 归属落定（append `r.ok===true` 或 spool fsync 成功）——drain 的 force-spool 必须复用同一落定点（禁旁路直调 spool.append 而不减计数，v2.4）**。
15. **append 的"成功"判据=`AppendResult.ok===true`（seq 存在）；0 行/undefined 一律视为未写入——任何 confirmStash 与 queue.splice 必须先验 ok。"fenced"是终态：自隔离+批走 spool（spool=本地磁盘不受租约约束），不进退避梯（重试无意义且掩盖租约失守）**（v2.4）。
16. **`repo.setLeaseOwner(owner)` 唯一写者=lease service（获取/续租失守/释放时调用）；append/compact/drain force-spool 内部读取该值，禁逐调用点传参（漏传=静默破防）；`owner===null` ⇒ 断言恒 0 行=天然 fail-closed**（v2.4）。

---

## 5. RPO/RTO+观测面+CI 载体

### 5.1 RPO/RTO（E43⑥ 三腿）

| 腿 | 口径 | 本批动作 |
|----|------|----------|
| 正常腿 | ≤maxDebounce 3s（崩溃丢内存 pending 队列，spool 不改善——接受；<1s 根修"收即写"不采，写放大不值） | 契约写死（Y0a-2 头注释） |
| 故障腿 | **spool 覆盖**（putStash 同步 fsync；窗口=putStash 到 fsync 完成的 ms 级——同窗口崩溃丢=正常腿既有接受项，不新增风险面） | Y0a-2+G-1 演练证明；**部署拒重启**堵人因窗口（Y0a-4） |
| 客户端腿 | 现状=0（无 IndexedDB，浏览器内存即上限）——显式登记接受项；**崩溃路径基线（v2.4）：连接失败蒙层、用户重试即恢复（期间本地编辑仅存内存）——Y5 IDB 收益的对照基线**；Y5 IDB 压到近 0 | 登记（§2.2 硬依赖同族） |
| RTO | 正常路径（显式释放）≤10s；崩溃路径=TTL 10s+回灌+装载+重连（目标秒级，冒烟计时落档）；与客户端 10s synced 死线（canvasCollabRuntime:985）的余量问题=客户端消费 ready 归 Y0b（§2.2 登记） | Y0a-3/4 |

### 5.2 观测面（口径诚实：当前无 Prometheus/Alertmanager——**指标=事后取证（PROMETHEUS_TOKEN 手 curl）+启动自检结构化日志**；告警路由归 Y0b/E54，本批不写纸告警线）

| 指标/端点 | 类型 | 备注 |
|-----------|------|------|
| `yjs_snapshot_read_total{reason}` | counter | 只读展示快照读（readSnapshotOnly，v2.1 替 degraded_read；v2.5/SV15 三分法——消费者仅 video-work.service:328） |
| ~~`yjs_compact_sv_violation_total`~~ | — | **v2.2 删除**（inline 哨兵随探针证伪移除） |
| `yjs_compact_abandoned_total` | counter | pendingStructs!=null 放弃本次——**P0 告警线**（v2.2 升格：compact 健康度唯一真实指标，连续命中即人工介入=collab-compact.mjs；本批无 Alertmanager，载体=启动自检外另加"计数>0 即 ERROR 结构化日志"） |
| `yjs_hydration_huge_row_total` | counter | loadForHydration 读到单行 >4MB（Y0a-1 §1.4"WARN+计数"的计数载体——v2.4 执行时补入本表；硬拒归 Y0b 配额批） |
| `yjs_spool_depth_files` / `yjs_spool_depth_bytes`（**total 口径=own+stranded 全目录求和——磁盘真值，容量核算与 G-1 故障腿判据同口径，v2.5/SV11**；bytes **含隔离字节**，V14；双 gauge collect 现算） / `yjs_spool_write_failures_total` / `yjs_spool_truncated_total` / `yjs_spool_capacity_total` / `yjs_spool_quarantined_total` | gauge/counter | Y0a-2（quarantine 为 v2.1 新增） |
| `yjs_updates_discarded_deleted_total{source=gateway\|spool}` | counter | 项目已删的更新丢弃——gateway 终态拦截/spool FK 收割双路径标签（X17 改名；Y0a-2） |
| `yjs_store_tail_anomaly_total` | counter | 取批后队列并发改动探测（Y8 splice 前判据：length<n 或批尾引用不符；**V22 收缩**——afterStoreDocument 对账职责由本判据承接，钩子健康面归 `yjs_store_hook_calls_total`）（Y0a-2） |
| **storeInFlight**=`yjs_store_in_flight_docs` | gauge（**Y0a-2 落地**） | 取批未落定项目数（X2 四落定点口径）——G-2 断言对象+关停日志结构化字段+Y0a-3 ready.pending 消费（v2.2 移批；本表同批落真名） |
| `yjs_pending_projects` / `yjs_pending_batches` | gauge（collect 现算） | ready.pending 同源（computePending）；G-1 quiescence 判据同读；batches=update 条数口径（与 store_in_flight 不同量纲）（Y0a-2，Y5） |
| `yjs_unload_handoff_failure_total` / `yjs_unload_cleanup_failure_total` | counter | 卸载交接 append 失败（批留队列+退避梯续排，钩子仍 resolve——X4）/清理体异常吞计（钩子永不抛——destroy 不可被取消）（Y0a-2，Y18） |
| `yjs_store_hook_calls_total` | counter | afterStoreDocument 钩子链存活计数（V22 收缩——库钩子健康面）（Y0a-2） |
| `yjs_deleted_projects` | gauge | 终态集大小（进程寿命内真删除项目数——永久无界的可见化接受，§9.10）（Y0a-2，V25） |
| `collab_lease_lost_total{cause}` | counter | 租约失守（单点=selfIsolate；cause 四值：heartbeat-fenced/heartbeat-unknown-expired/fenced-by-write/revoked）（Y0a-3） |
| `collab_start_failure_total` | counter | collab 启动失败（scan/listen 类——startCollabAfterLease catch+看门狗每 episode ≤1 次，W22/V14）（Y0a-3） |
| `collab_lease_epoch` | gauge | 当前租约 epoch（BigInt 序列化 string——断言/告警均按数值变化率）；release 复位 0（Y0a-3） |
| `collab_lease_denied_total{reason=contention\|revoked\|error}` | counter | CAS 获取被拒三分（Y0a-3） |
| `collab_lease_row_missing_total` | counter | 租约行缺失（配置错误级——fence 二次查空+spool 落批不排梯，W11）（Y0a-3） |
| `yjs_compact_not_owner_total` | counter | compact 持锁期被夺（{compacted:false,reason:"not-owner"}——行数不减证明）（Y0a-3） |
| `yjs_snapshot_read_total` | counter | 只读展示快照读（V18 后 reason 标签撤——消费者仅 video-work.service:328 单点，计数即可）（Y0a-3 形态收敛） |

**PromQL 告警线 5 条（V30——告警路由仍归 Y0b/E54，此处只落判据口径；载体=事后取证+启动自检同口径）**：

1. `increase(collab_lease_lost_total[5m]) > 0`——租约失守（按 cause 分型定位：fenced 族=双实例嫌疑/unknown-expired=心跳阻塞/revoked=人工 break-glass）。
2. `increase(collab_lease_row_missing_total[1m]) > 0`——立即响应（配置错误：迁移未跑/行被手工删）。
3. `increase(collab_start_failure_total[10m])` 持续增长——启动反复失败（scan/listen 类，配 start-failed 自愈日志定位）。
4. `rate(collab_lease_epoch[5m]) > 0`——接管 flapping（epoch 变化率；稳态应恒 0）。
5. not-serving 持续 >1m——ready `reason=not-serving` 连续 1 分钟（PromQL 无直接表达式，观测口径=对 /api/ready 探针的 reason 字段做持续判定；归 Y0b 告警路由落地）。
| **启动自检** | ERROR 日志 | spool 非空/回灌失败/quarantine 非空→打印清单 |
| `/api/ready` | 端点 | **公开/授权两档（v2.5/SV16）**：无 token={ready,reason,redis,epoch}；有效 x-prometheus-token=全字段（collabState/holder/pending 含 stranded/spoolQuarantined） |
| 装载 P95+readCanvas P95 | e2e/gate 落档 | 删 extension 后装载路径少 1s syncFromPeers 阻塞+disconnectDelay(200ms×2) 消失——两处行为变化随批落档（e2e/gate 观察，非新测试；Y0a-3 gate-collab 本地跑已切 /api/ready 双验） |

### 5.3 CI 载体

collab-core job（§3 Y0a-4.5，required）+既有 test/doc-gate/gitleaks 不变；e2e-collab 维持 dispatch-only（C′ 终裁）。

---

## 6. 门禁载体声明表（纪律 5/7；**v2 按真红门/结构不变量锚分类**——红相承诺只写在物理可造的门上，防假红违 D13）

### 6.1 真红门（存在"今日会做错"的实现，可对旧实现先红）

| 门 | 载体 | 阻塞 | 变红证据（D13） |
|----|------|------|-----------------|
| **BOI（批次所有权不变量）** | vitest+故障器（collab-core） | 是 | 对 :276 splice-first 旧逻辑注入"append 失败+spool 失败"→批彻底蒸发（红相留档）；v2 形状（splice+putStash-throw）注入 spool 失败同样红；**v2.4 增补第三种红相：append 返回 `{ok:false}` 不抛异常（fenced 形态）→"以未抛错判成功"的实现照常 splice+confirm=帧蒸发（G-2b/G-3b 同源证明）——三代旧实现红相都留档→AppendResult 消费绿** |
| storeDocument 不 throw | vitest（故障器） | 是 | 旧逻辑 :289 throw 被 hook 链吞（A1 锚）→断言队列既空又不丢 |
| mergeUpdates 出 WS 路径 | vitest spy+src 扫描 | 是 | 恢复 :207 封顶合并→spy 红 |
| 租约 fail-fast 三入口 | collab-core（双进程/双 gateway 用例） | 是 | 对现状（无租约）写用例：第二 gateway 也能 loadDocument（红）→门后拒（绿） |
| **fenced-owner 写语句**（G-3b） | vitest+collab-core | 是 | A 持锁→B break-glass 夺锁→A 的 append 照常落行（对"仅内存布尔"实现红）→owner-only 断言后 `{ok:false,reason:'fenced'}`（绿）；**+fenced-append 三断言（v2.4）：A 的 spool 帧未被 confirm 删/A 的 doc 队列未 splice/A 1 个心跳周期内 lease-lost——红相=对"不检查 AppendResult"的实现，帧消失+PG 无行**；**leaseRowMissing 用例（v2.4）**：删租约行→append 0 行→断言抛 leaseRowMissing+ready=lease-error（而非伪装 fenced/自隔离） |
| project.gone 清账+FK 兜底 | vitest+故障器 | 是 | 旧逻辑删除后 stash 重试撞 FK 无限循环（红）→终态拦截+计数（绿） |
| svDominates 纯函数锚 | vitest | 是 | 手写 SV 构造 {rowSv ⊄ snapSv}→false/{⊆}→true（阳性+阴性对照——v2.2 替代"SV 豁免"行：inline 哨兵已删，纯函数必须两态都测） |
| kill -9/SIGTERM 演练 | collab-core（脚本） | 是 | 演练对无 spool 旧代码崩溃丢数据（红）→G-1/G-2 绿（storeInFlight 口径） |
| 心跳三态 | vitest | 是 | unknown（抛错）被当 fenced 立即自隔离（红）→重试至 expiresAt 才隔离（绿） |
| collab-core job 自身 | GitHub required | 是 | 注入 failing spec 验证 job 红+required 生效+int 条数断言 |
| dist 无 test-utils | collab-core | 是 | 移除 tsconfig.json exclude→dist 出现故障器→断言红 |

### 6.2 结构不变量锚（防未来走样；变红证据=对"破坏后的代码"红，非对现状红——**如实声明，不伪装红门**）

| 锚 | 载体 | 变红方式 |
|----|------|----------|
| (projectId,seq) 唯一约束 | int 用例+verify-indexes.sql | 直插重复行→约束拒绝（证明索引存在） |
| append 单语句 RETURNING | int 用例 | 改回两语句+kill 注入→序号空洞可观测（非"撞约束"——nextval 永不重复，v1 修正） |
| loadForHydration 单 RR 事务 | int 用例（1.6） | 拆成两条独立语句+并发 compact→行集撕裂（对破坏后代码红） |
| 装载读唯一入口扫描 | src 扫描（verify 内） | 测试文件直查两表拼装→红 |
| compact 必须 await | src 扫描 | 提交一处 `void this.maybeCompact()`→红 |
| 库行为锚 A1-A9 | collab-core 常跑 | 升级 Hocuspocus 改语义→锚红（pin 变更强制重跑=常跑保证；A8 用包公开导出 shouldSkipStoreHooks） |
| ready reason 封闭枚举 | shared 类型+用例 | 加枚举外 reason→tsc 红（字面量联合，v2.1 撤通配） |
| stateSeq 精确赋值 | int 用例（1.6）+代码注释 | compact 后断言 stateSeq===max(被删行 seq)；写成 GREATEST→断言红（v2.1） |
| 冗余索引已 DROP | verify-indexes.sql（索引名不存在断言） | 重建 @@index 同列序→红（v2.1） |

---

## 7. 运行面三件套+同步预算+库选项 pin

### 7.1 三件套（三项全变，同批更新；纪律 8）

| 项 | 变更 | 落点 |
|----|------|------|
| 进程定义 | 内联参数→ecosystem.config.cjs 入库（fork/instances:1/kill_timeout 45000/SIGTERM） | Y0a-4 |
| 内存上限 | max_memory_restart+old-space **实测后定**（服务器画像前置）；结构约束：软阈<硬重启线；准入上限移交 Y1c-3 | Y0a-4 |
| 关停时长 | 10s→45s（SIGKILL 兜底——**v2.5/SV6：kill_timeout 45000 提前 Y0a-3 落 deploy.sh 内联两处，HTTP dispose 等在飞请求；ecosystem 归 Y0a-4 取同值**）；drain/flush/force-spool/释放的预算**单源=§2.4 预算表（v2.4——此处禁复述数字，原"≤5s"残留与 §2.4 双源矛盾）**；destroy race 保留为兜底 | Y0a-2/3 |

### 7.2 同步预算+库选项 pin（纪律 9）

| 项 | 预算/契约 |
|----|----------|
| mergeUpdates | 禁入 WS 消息路径；取批合并每批 <100ms 断言；超预算分块归 Y1c-1 |
| compact 重放 | 事务内同步重放维持（写侧无丢数据 E42②；精准修改不重写）；耗时 WARN 阈值 500ms/万行；分块+事务外重放归 Y1c-1（E62） |
| loadForHydration | **{timeout:8s, maxWait:2s}（v2.1 从 15s/5s 下调——预算规则：服务端单次可等待 < 客户端 synced 死线 10s−2s；冷启动排队由 connection_limit=10 承担）**；页 500 行；单行 4MB WARN（硬拒归 Y0b 配额）；超时自愈一次仅可重试类触发（契约 13：**P2028/P1008/timeout——P2024 池饥饿 excluded，v2.4**），**自愈增量预算 compact{timeout:6s,maxWait:1s}+重试装载{timeout:2s,maxWait:500ms} 总 ≤8s（v2.4 从 60s 下调）**；**预算规则适用域（v2.4 声明）：该规则约束稳态路径；两条例外路径（崩溃接管租约等待 TTL 10s、装载超时自愈 ≤8s 增量）按各自上限单独约束且预期超出客户端 synced 死线——客户端承接=Y0b 同批发布（§9.7），非仅登记** |
| fence 断言开销 | 单行 PK 子查询（owner-only EXISTS 形态，v2.5/SV1——TTL 只留 CAS 谓词），append 热路径（~2s 一次）+1 次索引命中（可忽略）——非未来优化目标，禁删（v2.4 登记） |
| spool fsync | putStash 同步 fsync（追加帧）；**段 4MB 滚动（v2.1 分段形态）**；演练实测确认不阻塞事件循环（故障路径非常规路径，可接受） |
| 关停预算 | §2.4 预算表（**v2.4：flush ≤6s+drain ≤8s+race ≤4s+释放 ≤2s=合计 ≤22s，kill_timeout 45s 内垫 ≥23s（v2.5/SV6 随 45000 同步）**） |
| 库选项 pin | debounce=env/dev 1000/prod 2000、maxDebounce=×1.5、timeout=30000、stopOnSignals:false 维持；disconnectDelay 随 extension-redis 删除消失；unloadImmediately（默认 true）=锚 A6 固化；yjs pin 精确化归 Y0c（E29 联动） |
| PENDING_MAX_ENTRIES | 64→语义变更：仅"提前异步 flush"触发阈，不再同步合并 |

---

## 8. 实施顺序（每子批出口=用户确认点）

```
Y0a-1（基座先行：库锚+隔离用例+故障器——后续所有门的证明载体）
  → Y0a-2（spool+失败路径+关停；依赖故障器）
  → Y0a-3（删扩展+租约+ready；drain/释放衔接 Y0a-2 关停序，可部分并行）
  → Y0a-4（ecosystem+部署链+CI 组装；内存实测+pm2 M1 实测前置）
收尾：v8 目录 Y0a 行回填（spec/plan 链接+状态+范围变更登记）+D1 代登记确认
```

## 9. 已知风险与限制登记（诚实清单；9-12 为 v2.1 增补，13 为 v2.4 增补）

1. **正常腿 3s 窗口**：进程崩溃丢内存 pending 队列（含崩溃前 ≤3s 编辑与库去抖定时器内批次）——既有接受项，根修"收即写"裁定不采；**G-2 的 storeInFlight 口径明示不覆盖此窗口**。
2. **putStash→fsync 完成间 ms 窗口**：同窗口崩溃=该批丢——归入正常腿接受项（与 E37 选 A 裁定一致）。
3. **spool 不可写=拒新编辑**（v2.1 语义精确化；v2.4 措辞精确化——BOI 是进程内不变量）：熔断后**进程存活期内**已收批次不丢（BOI：留在 doc 队列重试）但**新写入被拒**（就绪门 not-ready+只读）；**spool 不可用 ∧ 进程退出（kill_timeout SIGKILL/崩溃）⇒ 该批丢失**。控制=部署拒重启门（§4.4 drain 排空判据+`spool-unwritable` 档必拒）+关停结构化日志逐 doc 打印 at-risk 字节数。探针成功自动恢复——"停止接纳≠放弃数据"，运维语义显式化。
4. **PG 故障期+断电/OOM 同时发生**：spool fsync 已完成的批不丢；fsync 前的丢（归 2）。
5. **删除在途窗口按陈旧节点集计费**（D1 同族；v2.1 收窄——计费类已改 503 fail-closed，残留面=删除在途窗口本身）：Y0b spec 正式落档（§2.2 代登记）。
6. **Y1c-1 前撕裂不可达前提**：单实例 loadingDocuments 串行化+compact 被 await 于 store 钩子（锚 A2/A4）——前提被破坏（fire-and-forget compact/管理端点直调/多实例）时由结构锚 6.2 拦截；读侧守卫随 Y1c-1 落地。
7. **Y0a→Y0b 间新信号哑窗**：ready/503 fail-closed/新 reason 客户端无消费（§2.2 硬依赖；客户端 10s synced 死线改造同批——计划内重启已有 1012 短退避覆盖（canvasCollabRuntime:837-847），真缺口=崩溃路径）。**发布顺序约束（v2.4 从"登记"升格）：Y0a 与 Y0b 同批部署上线**——两条例外路径（崩溃接管租约等待/装载超时自愈）预期超出客户端 synced 死线，若 Y0b 未同批上线，崩溃/自愈路径的用户体验=必然失败蒙层。
8. **对抗语料最小版**只覆盖 api 读者；web 投影读者随 Y2。
9. **readSnapshotOnly 陈旧度**（v2.1）：只读展示消费者（v2.5/SV15 三分法下仅 video-work.service:328）拿到 state+已重放增量——最坏缺"进行中未 store 的编辑"（去抖窗口级），语义优于纯快照但仍非实时；公开页 UX 按此登记（语义读 clone/regenerate 走活读，不在此登记面）。
10. **`deletedProjects` Set 永久无界**（v2.1）：进程生命周期内单调增长、不可安全清理（量级=寿命内删除项目数，接受）。
11. **E14（Y0c）×准入上限（Y1c-3）顺序风险**（v2.1 跨批提醒）：若 E14 先落地"doc 常驻"而准入上限未至→"常驻无上限"窗口。**Y0c spec 落 E14 时必须自带最小上限（或把 Y1c-3 准入前移同批）**——登记为 Y0c 立项前置检查项。
12. **quarantine 帧语义**：被隔离帧代表已接受但无法落库的编辑（该批丢失）——计数+ready 可见+人工脚本判定，属显式接受的有界丢失（远优于 v2 的启动死锁）。**v2.4 补关键事实：Yjs Y.Map 是 LWW——被隔离帧代表的键若之后被编辑，该编辑静默覆盖（无冲突提示）**；因此 `spoolQuarantined>0` 应触发运营告警（非仅 ready 可见），人工判定脚本（内容摘要）为处置必经环节。
13. **fenced 批的 spool 滞留（v2.4 新增登记；v2.5/SV4 自愈语义改写）**：被 fence 实例的批落 own 子目录 spool 后，新持有者的启动回灌窗口已过（其回灌在接管前完成）——**≤reconcile 周期自愈（最坏 ≤90s=首 tick 30s+静默窗 60s；boot 收养使重启场景即时）**：数据不丢但短暂滞留；`ready.pending.spoolFiles>0` 可见。fenced∧spool 写失败双败=极端事故态，批随进程退出丢失（BOI 内存归属地消亡）。
14. **租约失守的用户可见窗口（Y0a-3 增补——Y0b UX 阈值输入）**：持有者死亡→新实例 TTL 接管（默认 TTL 10s+心跳余量）→客户端 rejoin 退避+重连蒙层——**用户可见中断上界 ≈11s**（TTL 10s+心跳/重连余量）；客户端 10s synced 死线恰在界上，故 §9.7 同批部署约束成立（Y0b 蒙层分型/阈值按此校准）。


