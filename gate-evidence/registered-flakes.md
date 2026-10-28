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

