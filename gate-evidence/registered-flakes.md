# 登记不修 flake 台账（Controller 台账——Y1c T19 双评审 spec-M-4 落痕）

- **ENOTEMPTY rmdir 竞态**（collab-project-actor.spec.ts per-connection 入站排队用例收尾）：
  复现条件=Windows 全池并发下偶现（2026-10-24 两次全池一次复现，单跑恒绿）；归因=collab-spool
  临时目录清理竞态存量（fs.rm/rmdir 与并发句柄释放窗口——非 Y1c T19 引入，T9 actor 落地起在库）；
  处置=CI 复现时单独收口（本批零动作——登记留痕防误判回归）。

- 2026-10-26（Y1c T21 收口批登记）：apps/api collab-harness 系 spec 偶发端口竞态（`collab_state: starting→start-failed`——多套件并行抢 COLLAB_PORT/监听窗；净跑全绿〔api 全池 2957/2957 复验〕；quality 复核裁定=可接受环境 flake 需登记非回归）。

- 2026-10-26（Y1c T22 G5 末轮小收口登记①）：web 池 stale-transform-cache flake——陈旧 vitest transform 缓存间歇供给旧版
  `@flowweb/shared`（症状=read-model-census compose 用例/runtimeStore 乱序·墓碑三例「undefined」形态=旧 merge/词表在跑）；
  处置=清 `node_modules/.vite/vitest`（web+root+shared 三处）复绿；建议=CI 缓存键纳 git SHA 或 vitest `cache:false`
  （登记留痕防误判代码回归——症状面=纯语义旧版供给非逻辑红）。

- 2026-10-26（Y1c T22 G5 末轮小收口登记②）：soak heavy echo p95 环境敏感——实测 18-42s 超预算 50ms（本机负载态放大
  echo 回声累积窗）；A/B 判定=pre-T22 基线 9d3ada45 同机同败 ⇒ 环境态非回归；该 spec 自注「环境抖动=单次重跑处置禁松阈值」
  （重跑绿即过，禁以环境态调预算——阈值口径冻结归 T33 负载基准卡）。

- 2026-10-26（Y1c T23 收口批补登记——派发词在册口径与台账文件对齐）：media-content/media-probe 两 int spec=
  MinIO ECONNREFUSED 127.0.0.1:9000 环境缺失（本机 MinIO 未起——T21/T22/T26 批 commit message 同款
  「media 两件=MinIO 环境存量」口径在批注而未落台账行）；处置=环境态非回归，起 MinIO 后复绿。

- 2026-10-27（Y1c T23 双评审收口 M-6 登记行）：collab.gateway.spec Y7 硬阈 coalesce 用例（600×8KB 累积折并
  队列元素 ≤1MB）本机全池负载态 20s 超时间歇红（T23 批 2980/2981 一例）、隔离跑 371ms 绿——T15 时已三员
  证实环境性（负载放大 coalesce 窗）；处置=复现时单独复跑收口（禁以环境态调阈值——与 soak echo p95 同款口径）。
- 2026-10-27（Y1c T24 收口批）：collab-rate-gate 两例（「成对用例 maxDocBytes+30B SS2」与「红门⑧
  8MB 回灌」）满载并行下 pollUntil 超时——spec 评审机满载触发（ms 级时序窗）；单独重跑 9/9 绿
  （口径同 Y7/soak 行——环境负载态非回归，禁以环境态调阈值）。
- 2026-10-27（Y1c T24 终验微批）：collab.gateway.auth-reason「session-expired 真协议透传」在 verify full
  背靠背满载轮下 10s 用例超时（用例含完整 onModuleInit 启动链——负载放大启动窗）；隔离 3/3 绿+同码
  冷却后 verify full 30/30 PASS（口径同 Y7 行——环境负载态非回归，禁以环境态调阈值）。
  **T28 复击中（2026-10-28）**：T28 出口 verify full 首轮〔四池跑完背靠背〕同例 10s 超时——隔离
  12/12 绿+冷却重跑 verify full PASS（同款处置；本行为族时间序列第三击，非回归）。

- 2026-10-28（Y1c T25b 双评审收口 spec M-2 登记）：collab-soak-t19.heavy.spec.ts 负载敏感 flake——本机高载态
  （多全池并行/宿主后台高 CPU）时间歇红，隔离/净载跑绿；baseline 高载同爆实证已录（T25b 批全池并行验证期）。
  处置=负载敏感族隔离重跑绿即过（禁以环境态调阈值——与 soak echo p95/Y7 同款口径；plan 收口批注同步）。

- 2026-10-28（Y1c T25b 终验 quality 残留注记登记；**Y1c T27 收尾 nano① 勘正：原「collab-delivery int」
  为台账文件名笔误——实际套件=collab-lifecycle-observer.t26.int.spec.ts（DeliveryFence 交付域）**）：
  collab-lifecycle-observer.t26.int「两项目同 nodeId 不互串」用例
  间歇红——T25b 终验轮单文件隔离态亦间歇（2 红 3 绿）；1caaaf6f 池轮同爆、与 T25b 三 commit 零代码
  交叠=先置时序/负载 flake 非回归。处置=隔离重跑绿即过（禁以环境态调阈值——与 soak 族同款口径）。

- 2026-10-28（Y1c T27 首跑批登记；双评审 M-4(spec) 收口并入 mr4-1 枚举）：web canvasCollabRuntime.t25.spec
  **文件级顺序敏感间歇红**——单文件跑 closeout-1/closeout-2c/mr1-2/mr4-1/b1-1/b4-1 六例（mr4-1=T25b 批
  既有预算放宽族成员——本批观察并入同族枚举）中 1-4 例间歇红（逐例 -t 隔离恒绿；同日全 web 池两轮
  4168/4168 全绿）；**stash A/B 实证 HEAD（无 T27 改动+dist 同步重建）同形态复现**=先置状态非本批回归
  （怀疑面=fake timers+模块级 runtime 状态跨用例泄漏的时序窗口）。处置=隔离重跑绿即过；根修（文件内
  用例间状态隔离）归 T28 出口复核窗呈报 Controller 裁定。

- 2026-10-28（Y1c T27 双评审 M-6(quality) 两新观察例登记）：
  ① collab.gateway.persist-status 批3-4 族用例在高载池轮下间歇超时（负载放大真协议透传窗——与
    auth-reason T24 终验行同款口径）；
  ② collab-quota-gate「编码成本⑤」用例（真空编码全根重建段）满载并行下偶超（重编码 8MiB 级源 doc
    的 CPU 窗被并发池放大——隔离跑绿）。两例处置均=隔离重跑绿即过（禁以环境态调阈值——Y7/soak 同款）。

- 2026-10-28（Y1c T28 出口复核登记——T27 spec 复核移交 web 超时族入册）：web 池 admin/team 页测试族
  高载池轮超时（admin/TeamPage·TeamBillingPage·TeamSidebar·AdminLayout 四 .test.tsx——T27 spec 复核
  观察移交）。隔离绿证据=T28 出口 HEAD 单跑四文件 29/29 绿；零代码交叠=两目录 Y1c 全程零 commit
  （admin 末触 2026-10-13 3f327eec/team 末触 2026-09-19 a2f3b292——均先置）。处置=负载敏感族隔离重跑
  绿即过（与 soak/Y7 同款口径，禁以环境态调阈值）。

- 2026-10-28（Y1c T28 出口复核新观察例）：collab.gateway.spec「绿9：队列身份恒定——软阈跨点闩锁
  flush」满载池轮单红（T28 四池轮 api 3061/3062 唯一失败）；定向 -t 隔离 2/2 绿+全文件隔离 92/92 绿。
  零代码交叠=夹具为 plain-object 节点值（无 data 信封/媒体字段——T28 collect 媒体引用差分根修分支
  结构性不可达）；断言面=队列身份/闩锁 flush（无 effects 消费）。处置=隔离重跑绿即过（Y7/persist-status
  同款负载族口径——禁以环境态调阈值）。

- 2026-11-03/04（Y1c T30b 演练批登记①——t25 族复发扩枚举）：web canvasCollabRuntime.t25.spec
  满载/新 shared 构建后 1-4 例轮换红（closeout/mr 族六例成员轮换）——同族先例行=2026-10-28 T27 首跑批
  登记条（mr4-1 族）；T30b 窗 clean HEAD 同机同红+逐例隔离绿实证已备（plan T30b 收尾批注备注段）。
  处置=同族口径隔离重跑绿即过；根修（文件内用例间状态隔离）仍归后续复核窗呈报裁定。

- 2026-11-03/04（Y1c T30b 演练批登记②——specb-perf reconcile 热机超限，**未定性**）：
  collab-specb-perf「reconcile≤5ms」断言高载窗超限观察（隔离跑绿）；T30b 收尾独立跑 perf 首试绿
  （首开 1845ms/reconcile 2.8ms——演练记录【五】）。**如实标注：clean-HEAD 同红 A/B 实证未做**
  （quality 双评审 P2 指出证据链缺）——现按负载敏感族处置（隔离重跑绿即过）；若确定性复现须先
  A/B 定性再归 flake 或立缺陷（禁无实证定性）。

- 2026-11-03/04（Y1c T30b 演练批登记③——drill --cutover 退出期噪声）：演练装置收尾 summary
  打印后 provider WS 清理竞态偶发噪声栈（演练已达终态、判据面全绿）；影响面=进程退出噪声非判据面。
  处置=不阻断（装置产物已定）；若后续复现于判据期再行登记升级。


- 2026-11-05（Y1c T32 收口批登记①——满载池轮三处；quality 双评审 P1 台账落位）：T32 六 commit
  满载窗观察=①web ThemeToggleButton.test.tsx 2 例高载池轮红（满载两轮后单跑+连跑两次 2/2 绿
  ——收口批定向复取证 2/2）②api order-no.spec ③api managed-redis.spec 满载偶红（定向单跑绿；
  收口批复取证两文件 10/10）。三处零代码交叠=工具域/通用域文件 T32 链零触碰。处置=隔离重跑绿
  即过（负载族同款口径——禁以环境态调阈值）。

- 2026-11-05（Y1c T32 收口批登记②——t27 int 红② standing red 复合定性+根修归档）：collab-
  maintenance.t27.int「红② FAILED 只读维持跨重启」expected 2 to be 1=T31 演练批残留 1 行 FAILED
  MaintenanceOperation（t31-vac 夹具、created 2026-11-04T13:15Z 先于 T32 链）× resumeActiveOnBoot
  全局域计数（boot 语义正确）×测试绝对值断言——环境残留×测试隔离缺陷复合（quality 员 PG 实测
  1+1=2 精确吻合+clean HEAD 同红=非 T32 回归）。**根修已落（本批）**：①断言改紧前基线等值
  （判别性双向亲证：残留在库旧断言红 2≠1/新断言绿 2=2——清残留后 14/14）②装置 cleanupFixtures
  补 maintenanceOperation 清理面（防复发）③残留行已清（演练证据在 t31-fault-drill.txt 不依赖 PG 行）。

- 2026-11-05（Y1c T33 收口批登记——t9-actor 临时目录清理族复发扩枚举）：T33 收尾满载轮
  collab-project-actor.spec（t9-actor）临时目录清理用例单红——同族先例=2026-10-24 ENOTEMPTY 条
  （同套件同根因：Windows rmdir×mkdir 竞态窗）。单跑 23/23 绿（implementer 收尾批）+quality 员
  定向复核绿。处置=隔离重跑绿即过（Windows fs 竞态族既有口径）。

- 2026-11-05（Y1c T34 发布门批登记——t25 族 verify:full 背靠背满载轮三击实录）：T34 verify:full
  终跑窗 run2/run3 连续两轮 web-test 唯一失败=t25.spec mr1-2（60s 超时）+单文件隔离一次 mr4-1
  成员轮换红（24/25）——族内成员轮换形态与 2026-10-28/11-03 两条登记吻合；逐例 -t 隔离双绿
  （mr1-2+mr4-1）=环境态定性成立；run4 冷却后 31/31 全绿（web 4157/4157 族未复发——T24 终验/
  T28 复击「背靠背满载轮冷却后 PASS」同款先例）。处置=冷却重跑全链（本窗已达成单次连续全绿）；
  根修（文件内用例间状态隔离）维持 Controller 裁定项（T28 出口复核窗呈报承袭——本卡不越权）。

- 2026-11-05（Y1c P4 CI 终验批登记——两族 CI/本地双面复发实录+CI 侧处置形态首立）：确认点⑤签认
  后 push 终验窗。①t25 族 CI 面复发：run #84 web-test 唯一失败=t25.spec 三例（closeout-1/closeout-
  2c/mr1-2）——#80 同位绿（池序非确定性）+本地 verify:full 同窗 t25.spec ★b1-1 单例红；族内成员
  轮换形态与 10-28/11-03/11-05(T34) 三条登记吻合。②ThemeToggleButton 族本地复发：本机 verify:full
  web-test 2 例（getByRole 多元素）+全套隔离复跑 1 文件 2 例红→定向连跑 2/2 绿（T32 登记①形态
  原样）。处置=CI 侧首立 rerun-failed-jobs（隔离重跑绿即过——台账「隔离重跑」处置的 CI 等价形态，
  run #84 attempt2 终态补登 t34-release-gate.txt【七】）；本地侧冷却+定向双绿维持既有口径。两族根修
  维持 Controller 裁定项不越权（t25=文件内用例间状态隔离；Theme=高载池轮）。
- 2026-11-05（Y1c P4 CI 终验批补登——t25 族 CI 确定性定性升级）：#84 test job attempt1/attempt2
  （fresh runner×2）同三例复现（closeout-1/closeout-2c/mr1-2）——CI 慢机形态=确定性红非池序轮换
  （本地间歇面维持池序定性）；断言形态=provider 实例同一性未换新+排程计数 2≠1（时序敏感）。
  影响面=verify 链 [19/31] web-test 恒红（CI 侧）——**根修（文件内用例间状态隔离）优先级上调
  建议：CI 阻塞性**（required check=collab-core 不受影响；本地 verify:full 经定向复跑口径可全绿）。

- 2026-11-05（Y1c t25 族根修销案——提前开窗 2026-11-05 用户裁定）：根修落地 b313c033=①runtime
  resyncFull 会话同一性守卫（悬挂真异步链跨用例/跨卸载复活会话——CI #84 两 attempt 同三例确定
  性+本地红锚 29ms 同签名「expected 2 to be 1」机制坐实）②spec 固定窗族泵改造（closeout-1 重建
  等待+b1-1/b4-1/逃生口三循环+b4-1 resume 尾——pumpUntil 确定性排水）。验证=t25 文件 5/5 连跑
  26/26+全 web 池 t25 零红+**CI #87（b313c033）push run 全绿——test job 自 #75（2026-10-23）以来
  首绿**（doc-gate/test/gitleaks/collab-core 四 job success）。本族历史登记（2026-10-27 T27 首登/
  11-03/04 T30b 扩枚举/11-05 T34 三击/11-05 CI 终验两批）全部销案归档；ThemeToggleButton 族
  （T32 登记①）维持登记——本地高载形态、CI 未红，不在本次开窗范围。

- 2026-11-05（Y1c ThemeToggleButton 族根修销案+specb-perf A/B 收口）：①Theme 族机制解剖（webfull1
  实录+CI #78 签名比对）——test1=**墙钟超时**（满载池 CPU 饥饿下 5820ms＞5000 默认，非断言红）；
  test2 多元素=超时弃测后**被弃异步体迟到续跑**（vitest 不杀 promise——`await import→render()` 迟到
  落进下一用例窗、读的恰是 test2 的 localStorage='light'→注入第二个同 aria 按钮）。修=testTimeout
  20s 文件级带宽（t25/mr1-2 60s 先例）；RTL afterEach 清理救不了迟到注入（清理先于迟到体）——不做
  无证据基建改动。验证=全池 382/382 ×2 连跑全绿。②specb-perf「reconcile≤5ms」A/B 收口：clean HEAD
  （已提交态）静机 gate 定向 ×3 全绿——2.8/2.5/2.2ms（峰值=预算 56%）+历史独立跑 2.8ms 同值→
  **「clean-HEAD 不复现」定性成立**，超限观察=负载窗环境态，5ms 预算冻结维持、处置（隔离重跑绿
  即过）维持。v4.1 基线对照腿=worktree 环境受阻观察（gate-managed dist 对同库同凭证 401 而同树
  tsx 源码 201——dist/src 运行时差异待专窗；非 perf 信号，A/B 核心结论不受影响）。
- 2026-11-05（Y1c t25 泵化收净批补登）：6141f387 CI 红 [19/31] :206 4412 用例（provider 同一性）=前批
  （b313c033）漏扫的第六族成员——该文件「resync 重建完成」语义的固定 50ms 窗共六处（红①/4412/清零
  ×3/9b 竞态/M-R2 salvage），本批全改 pumpUntil；四处「导出闸悬挂窗内」语义位（closeout-1/mr1-1/
  mr1-2/iso-1）保留。终局=**0372904b push CI 四 job 全绿**（test job CI 面二连绿——t25/Theme 两族
  彻底销案）+t25 文件 5/5×26/26+tsc 0。
- 2026-11-07（服务器窗部署 preflight 登记）：collab-spool-wal.spec C1①「gap 段收养后 peek=裁定前缀」
  于 deploy.sh preflight verify full 满载轮红一例（02:5x——web 池背靠背后 api 池起步负载态）；同码
  隔离跑 2/2 绿+全文件连跑 48/48×2 绿（00:45 出口门 verify FULL 同码 31 步亦全绿）；归因=该用例族
  标题即含「fsync 时延失败尾」——文件系统时序敏感面在满载窗放大（与 Y7 硬阈 coalesce/rate-gate
  pollUntil 同族口径）；处置=复现时单独复跑收口（禁以环境态调阈值/不动判据）。
- 2026-11-07（服务器窗部署 preflight 登记②——同夜第二例同族）：collab-spool.service.spec W21
  「adoptSilentForeignSegments(0) mtime 静默后收养」满载轮红一例（expect [] length 1 got 0——03:17
  deploy#3；同码隔离跑 30/30 绿+00:45 出口门 verify FULL 同码全绿）；与同夜 C1① 同族=段收养
  mtime/fsync 时序窗（ms 边界竞态——写入与 stat 同毫秒时 NTFS mtime 取整可后移一 tick）；归因口径
  同台账 Y7 coalesce/rate-gate 行=环境负载态非回归；处置=复现时单独复跑收口（禁调阈值/不动判据）。
- 2026-11-07（服务器窗部署 gate-collab 观测——台账 2026-11-03/04「未定性」行第三次观测）：
  specb-perf reconcile max=5.100ms（retry 5.500ms）vs 冻结预算 5ms（v3.16 终裁 58②数字冻结）——
  首开 1622ms≪15s+零差异订阅回调=0 双绿（「先证伪零差异短路」前置已过=短路在位，超限=全表遍历
  成本边际）；同机同夜 deploy#7 gate-collab 全绿（≤5ms 过）+deploy#9 两试 5.1/5.5——满载后热机
  边际形态与非定性先例一致（隔离跑须 gate-collab.mjs 形态——spec 头注 ECONNREFUSED 3100 预期）；
  处置=复跑收口（禁调冻结预算——脏域优化不做=plan 终裁；定性归后续 nightly 观测面）。
- 2026-11-11（改档部署 preflight 登记③——同夜第三例）：collab-upgrade.spec T2「Origin 校验真连
  onUpgrade socket 直写」满载 api 池轮红一例（改档部署 verify full [20/31]）；同码隔离跑 15/15 绿
  +同夜此前 verify FULL 多轮全绿；同族口径=真连 socket 时序窗满载放大（与 spool 族两例/Y7 coalesce
  同判——环境态非回归）；处置=复跑收口（禁调判据）。
