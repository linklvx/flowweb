<!-- doc-status: v4 | created: 2026-10-13 | 上游: docs/superpowers/specs/2026-10-13-y0c-y05-runtime-plane-design.md（v8 定稿） | note: v4 吸收第十三轮裁定 Z138-Z148（spec §0.5.9）：setDefaultLabels 只在 main/main-worker 引导层（register.clear() 连清 defaultLabels——模块级调用被 di-smoke clear 静默消灭）/族名交集断言改 A 结构+B 内容双断言（原判据恒绿假门禁）/MetricsModule 拆 Core·Http 第 7 模块+worker 依赖图含 MetricsCore（3002 三族验收）/B0 清单由枚举脚本产出+判据全形态+façade 按操作设计（数组身份 :693 保护）/tryRelease 前置两项（+inFlightProjects）/COLLAB_MAX_RESIDENT_BYTES 使用点默认 384MiB+T30 算术式 fail-closed/T22 耐久用例双向断言/占比判据改绝对主判据/thumbnail 事实更正（默认 1 非无上界）/env 裸读 28 文件枚举前置（T34）/census 新组编号⑭-⑲（T2）/manifest idempotent 列（T4/T27）/付费队列 enqueue fail-closed（T29）/T0.5 范围收敛（worker 指标标 T29 补）/关停带批释放顺序+双计数（T17/T18）/元纪律⑥（门禁会红声明须附真实变红输出）；每片出口=用户确认点；TDD 待启动（片 C0 T0） |
-->
# Y0c+Y0.5 运行面工程批 执行 plan（片序 C0→A1→A2→D→E→B）

日期：2026-10-13（spec v5 同日定稿；本 plan 为其唯一执行簿——设计论证/裁定/验收判据全在 spec，本 plan 只做任务分解+顺序+冲击面清点+执行门，不重复 spec 内容）

---

## 0. 执行总纲

### 0.1 片序与依赖

```
C0（度量与契约先行）──硬前置──▶ A1（写门面）──硬前置──▶ A2（常驻化）
                                                        │
                                        推荐先落（内存实测受常驻影响）
                                                        ▼
E（部署档位）◀──同窗──▶ D（worker 拆分）──▶ B（gateway 领域 service 化，殿后）
```

- **C0→A1**：A1 验收锚（yjs_doc_load_total 等）由 C0 落载体；census 先红证据由 C0 产出。
- **A1→A2**：写会话表由写门面承载（acquire/release API 在 A1 定义、A2 赋予常驻语义）。
- **A2→D**：非硬前置但推荐先落——D 的内存实测两数在常驻化后的形态才有意义（spec §1.1）。
- **D↔E 同窗**：E 的 NODE_ENV/网络面与 D 的进程拆分同部署窗落地。
- **B 殿后**：纯结构重构，在任何行为片之后（回滚面最小）。

### 0.2 全批执行纪律

1. **TDD**：每个任务先红后绿（门禁类任务红因与门禁声明一致——纪律 5/D13）；行为契约片（A1）的先红用例在实现 commit 前落测试文件。
2. **verify 链（v3=Z136② 边界明确）**：**任务级出口=`verify:fast`（15 步）**；**片出口=全量 `pnpm verify`**（25 步含 nest build+三套测试+全部新门禁）——FAST_PREFIX_LEN=15 ⇒ 本批新门禁（check-ecosystem :21/check-collab-census :23/api-test :19）**全在 fast 之外**：本地任务级自检不覆盖它们，片出口/CI 必跑（防「fast 绿=门禁绿」误读）。
3. **每片出口=用户确认点**（执行门）：片末任务汇总出口判据证据（spec §2 逐片验收判据），呈报用户确认后进下一片。
4. **偏离登记**：执行期任何与 spec 偏离（判据调整/实现替换/范围增减）登记 spec §0.6 偏离表——先登记后实施（Y0b 惯例）。
5. **commit 粒度**：一任务一 commit 组（测试+实现+门禁同步）；片出口 commit 含片级验收证据。
6. **元纪律⑥（Z148）**：凡本 plan 声明「先红/会红」的门禁或断言，落地时须附一次它真实变红的输出（或可复现构造）贴进 commit/出口证据——「会红」是能力声明与元纪律⑤ 装置能力同受实测约束（动因：D13 假门禁族+族名交集原判据反写）。

### 0.3 plan 期裁定（spec 标注「plan 期定」项的落地裁决）

| # | 项 | 裁定 | 依据 |
|---|---|------|------|
| P1 | **常驻会话表落点** | 独立 `CollabResidencyService`（gateway 装配，A2 落地）；片 B 切分时并入 CollabDocRegistryService（spec §2 片 B 表「常驻表归此」）——A2→B 过渡=服务搬迁非重写 | spec 片 B 表+Z65（唯一调用点=Registry 内部卸载函数——A2 时 Residency 即该职责载体） |
| P2 | **shrink thaw 实现选型（v2=Z120 勘正：一处赋值替换）** | **影子预演已在代码**（collab-shrink.service.ts:180-192 Y0b-4 T8 建——:185 `shrunk` 即「GC 已执行」口径）；修法=**thaw 判据（:206-207）改用 shrunk**（truth 继续用于 calibrateTruth/observe/force 广播）——mini-task：先跑 write-frozen-chain.int.spec:116,120 确认红因→改赋值→断言翻转 | Z120（v1 的「方案③」表述作废——预演不用建已在） |
| P3 | **systemd unit 形态（v2=Z115 pm2-runtime）** | `flowweb-pm2.service`：`Type=simple`+`User=ubuntu`+`Environment=PM2_HOME=/home/ubuntu/.pm2`+`ExecStart=/usr/bin/pm2-runtime start /home/ubuntu/flowweb/ecosystem.config.cjs`——前台模式不需要 PIDFile/forking（消 v1 的「一分钟探针」坑）+日志直进 journal | Z115 |
| P4 | **worker 指标 3002 实现（v2=Z116 不进 nginx）** | worker 引导内 `node:http` 独立 server（127.0.0.1:WORKER_METRICS_PORT 返 register.metrics() 文本）+**不进 nginx**（nginx 无 /metrics 路由是故意的）——check-collab-health/soak 读双 loopback 端点+3002 fail-closed（production 未设 token 拒启） | Z116 |
| P5 | **双等价索引 census 探针（Z58）** | 脚本读 prisma/schema.prisma 解析 `@@unique` → 按 Prisma 命名规则拼索引名（`<table>_<col1>_<col2>_key`）→ 查 pg_indexes 断言不存在等价索引——机制进 check-collab-census 扩组 | Z17/Z58 |
| P6 | **基线三场景装置（v2=Z121 一等任务 T0.5）** | **装置已存在**（apps/api/scripts/collab-soak.mjs）；T0.5 扩展=三场景装置化+双端点读取+TTL pin+完整性巡检挂点——一个装置四个消费者（T1 基线/T22 第一轮/T33 第二轮/Z91 采样） | Z121 |
| P7 | **内存实测载体（v2=Z117 指标面合成）** | worker 自暴露 `process_tree_rss_bytes{role='worker'}`（本进程+子进程求和，采集失败不上报）+soak 读双端点**只压不统计**（p95 由查询侧承担）——A2 出口（单进程常驻）与 D 出口（双进程）各一轮；「300MB 系统保留」改 `常驻上限×单 doc 实测 p95` 显式项 | Z117 |
| P8 | **write-batch 端点形态** | 单一 `POST /api/collab/doc/write-batch`（承接 DocWriter 批量事务语义）+**结果三分契约（Z99：瞬态 503 重试不上抛/业务 written:false 走退款/永久计数）+内容校验（Z108）** | E59+Z99/Z108 |
| P9 | **TTL 键值（v3=Z132 双向定标）** | `COLLAB_SESSION_IDLE_TTL_MS` 显式键+使用点默认 **120_000**——定标双向：**下界**=AI 作业单段间隔分钟级（30s 会使 loading→deliver 段间释放重载=常驻化对长作业失效）；**上界**=SIGKILL 丢数据窗与常驻 doc 数的权衡——A2 实测调+**判据 A 必带本轮 TTL 值**；soak 装置 pin 此键 | Z107/Z132 |
| P10 | **--only 探针+ready 门（v2 新增）** | deploy 演练时验证 `--only` 与 ecosystem env 块注入组合语义（未实证的 pm2 细节不押正确性）；worker 启动 ready 门=订阅队列前轮询 /api/ready 上限 60s 超限非零退出 | Z102 |

### 0.4 冲击面清点汇总（纪律 11：修改类任务逐点清单——plan 级前置，执行任务时逐点核对）

| 改动 | 生产消费点 | 测试消费点 | 处置 |
|------|-----------|-----------|------|
| writeExecStatus 签名**不改**（Z69） | 13 处（B3）零改动 | 8 文件零改动 | 减法收益——仅内部行为+计数 |
| writeNodeData undefined⇒throw（Z5） | 6 处（B2）逐点核无 undefined 传递 | exec-partial-success stub 形态核对 | 语义新增（原「直 set」不含 undefined 场景） |
| CollabModule 停止 exports CollabDocumentService→exports CollabWritePort | 注入面 13 文件（Z42 勘）逐个改道 | spec/int stub 注入形态 | 片 D 逐文件清单（T25 前置 grep 落实） |
| origin=Origin.Server（Z6） | canvasUndo.ts:9 常量已有 | execView.spec「零写」断言族核对 | 只增不改 |
| 键集收编 shared（EPHEMERAL_DATA_KEYS/CANVAS_BRIDGE_KEYS） | web 私有消费点：projectCanvasNodes.ts:7/nodeStore.ts:243 及 import 面 | docShape 三处适配测试 | 机械改 import；shared 单源+re-export 过渡**不设**（禁垫片） |
| parseDocName 收口 | gateway:159 parseProjectId 唯一定义点+isValidDocName:167 | gateway spec | 换函数保旧名不留（parseProjectName 删除） |
| NODE_ENV 8 读点+3 模块加载期 | main.ts:76/prometheus-auth:7/auth.ts:48/update-profile.dto:18,19,25/collab-admin-auth:12/gateway:42,605 | env.spec 形态改 vi.stubEnv（Z45③） | 模块加载期 3 处=useFactory/lazy resolver |
| 直写收编 | collab-shrink:114,154/intent-reconcile:493 | shrink/int-reconcile spec | 改道 writeBatch |
| ecosystem/check-ecosystem/heap-pressure | 三处同 commit（Z84） | check-ecosystem 自测 | 顺序=ecosystem→check→heap 断言链 |
| 片 B 切分搬移 | census 组④ ENCODE_WHITELIST 按文件计数同批更新（Z24） | collab 套件全量（行为零变化——任何断言修改=偏离登记） | B1→B2→B3 各自 verify 门 |

---

## 1. 片 C0：度量与契约先行（T0-T7）

> spec §2 片 C0 全文为本片验收基准。本片纯增量（指标+census+shared 文件+断言），回滚=revert。

| T | 任务 | 改动文件（新建\*） | 测试/门禁 | 出口 |
|---|------|------------------|----------|------|
| T0 | **观测三件+三键注册（v3=Z127/Z134）**：`yjs_doc_load_total{trigger}`/`yjs_store_total{trigger}` 注册（store.metrics.ts 单源）+withDoc 计时点前移（另落 `yjs_withdoc_open_duration_seconds`）+`collab_escape_hatch_total{kind}`+event-loop lag（`perf_hooks.monitorEventLoopDelay()`）+`collab_exec_projection_failed_total{cause}`（**14 处** `.catch(()=>{})` 加计数——execution.service 11+processor 1+ai-image-edit 2，B3 清单逐点）+**`register.setDefaultLabels({role:'api'})`（api 侧——worker 侧 T29 同款；一次区分全族含 up/scrape_duration。Z138 落点纪律：**只写在 main.ts 引导序列**（worker=main-worker.ts T26），**禁模块级调用**（store.metrics.ts/metrics.service.ts 顶层均禁——prom-client `register.clear()` 连 `_defaultLabels` 一起清，di-smoke.int.spec:47 既有 clear 会静默消灭模块级调用效果；`getSingleMetric().get()` 不读 defaultLabels⇒既有断言零影响〔我方 registry.js :109-120 实证〕）**+**三键一次性注册 envSchema（Z127：COLLAB_SESSION_IDLE_TTL_MS/COLLAB_MAX_RESIDENT_BYTES 均 optional 无 default——默认值落使用点纪律；否则 T15 首次 verify 以 census 裸读红爆发）+collab-env-single-source.spec 结构锚同步** | collab/store.metrics.ts、collab-document.service.ts、gateway 计时点、telemetry sink、config/env.ts | 指标注册单测+三场景手动触发计数可见+env 结构锚零红 | 新指标可见（{role} 标签默认带上）；`.catch` 计数先红；三键注册绿 |
| T0.5 | **soak 装置扩展（v2=Z121；v4=Z148③ 范围收敛——C0 时点无 worker 进程〔T23/T26/T29 才建〕）**：apps/api/scripts/collab-soak.mjs 扩展——①`sampleOne(url, role)` **多进程安全提取器**（现装置只读单端点首匹配 :52——多进程后拿到谁不可知；提取器先落，双端点读取 **T29 落地时补**——届时 worker 3002 才存在）②三场景装置化③`COLLAB_SESSION_IDLE_TTL_MS` pin（P9——判据 A 前提+**判据 A 必带本轮 TTL 值**）④完整性巡检挂点（Z111）⑤输出机器可读 JSON——**入口条件=先跑一次现装置当前输出贴档（元纪律⑤：装置存在≠装置具备能力）**；`process_tree_rss_bytes{role}` worker 侧自暴露**归 T29**（worker 引导存在后才有载体） | apps/api/scripts/collab-soak.mjs（worker 侧指标=T29） | 装置自证（三场景 JSON 输出+提取器对同族多序列的取数正确性——单进程下以多 trigger 序列代验） | **先建装置再谈数字**（T1/T22/T33/Z91 全依赖它） |
| T1 | **基线落档三场景**（T0.5 装置）：改造前跑①单节点执行链②关页作业完成③20 节点组执行——load/store/withdoc 计数与直方图落 runbook 附录表（**前置：T0 指标先落并部署——新指标在改造前不存在**） | runbook 附录表 | 装置自证 | 三场景基线数字落档（A2 验收对照组） |
| T2 | **census 扩组一（v4=Z147② 新组编号一次定死——现有组①-⑬ 不动，防与组④ ENCODE_WHITELIST 撞车）**：**⑭** withDoc 全枚举（B4 v2 形态：逐点标 read-only｜write-via-writer｜待收编）+**⑮ worker 符号级禁令先红**（Z43：禁 openDirectConnection/@hocuspocus.server import/长生命周期 applyUpdate；允许 yjs 纯函数——repository compact 白名单登记）；后续组号预登记：⑯ 裸 Y.Doc 清零（T3）/⑰ worker 模块图闭包（T25）/⑱ CanvasDocUpdate INSERT 唯一写点（T27）/⑲ 测试 façade（T39b） | check-collab-census.mjs 扩组 | **先红验证**：现状 processor 闭包内引用红（红因=符号命中非语法错——**元纪律⑥：红证据贴档**） | 两 census 进 verify 链红（待 A1/D 转绿的先红证据落档） |
| T3 | **census 扩组二**：生产裸 `new Y.Doc()` 清零（7 处清单 Z57——本片登记 createCanvasDoc() 工厂+迁移调用点，断言**此片即绿**）+**env 两分 census（Z89）**：分叉键（COLLAB_ROLE/BIND_ADDR/SPOOL_DIR）不在 .env ∧ 同值键不在 ecosystem+**env 裸读两分（Z79）**：模块级 const/useValue 读=违规（清单）／构造器直读=白名单（4 处） | collab/canvas-doc.factory.ts\*（createCanvasDoc）+7 调用点+census 扩组 | 工厂迁移后 census 绿；两分断言先红（COLLAB_ROLE 尚未落——红因与声明一致） | census 三组全部进 verify 链 |
| T4 | **契约冻结包（v2=Z108 manifest 升格）**：键集五处收编 shared（EPHEMERAL_DATA_KEYS/CANVAS_BRIDGE_KEYS 升 shared+web 消费点改 import）+**manifest TS 单源=执行期校验表**（四层类型+nodes/edges/exec 种子条目+**每 DocWriteOp 键集/每键值域与字节上限/op 数上限/批总字节 Σ≤256KB+拒 `__proto__/constructor/prototype`+每 op `idempotent:true|false` 列（Z148①——T27 端点对 false 4xx 拒收，把「端口只收幂等 op」从散文变可执行断言：新增 op 忘分类即红）**——packages/shared/canvas-doc-manifest.ts\*，A1 DocWriter 进门直接消费）+E27 嵌套创建者 census（`getMap().set(k,new Y.Map()/Array/Text)` 全命中登记）+不变量登记表 canvas-invariants.ts\*（五条三列+现状标注：①topology.sort 已执法✓/②④现状勘注/⑤=E22+Z4 本批闭环）+parseDocName 铺位（`parseDocName(docName)→{projectId,generationFromName}`；世代真源=DB 列；name-DB 不一致=独立拒因） | shared 两文件\*+web 两消费文件+gateway:159 换代+三新文件\* | manifest/invariants 编译断言+parseDocName 单测（含不一致拒因）+E27 census 现状登记+**manifest 校验表单测（违规 body 拒绝）** | 键集零私有副本；契约文件编译过；校验表可执行 |
| T5 | **库行为锚 4 枚**（Z80 正例 2+反例 2）：持有 direct⇒谓词恒 false⇒4 入口 no-op／谓词=唯一卸载决策者（esm:1576/:1589 双校验）／反例①释放确实能卸载／反例②saveMutex 锁定⇒谓词 false+check-hocuspocus-pin 版本变化输出必重跑锚清单（Z18） | collab.library-anchors.spec.ts 扩+check-hocuspocus-pin.mjs | 4 锚先红（新锚）后绿 | 行为锚入 CI collab-core job |
| T6 | **pricing 断言补全**：verify-indexes.sql 补 3 条（③pricing_credit_cost_non_negative ④intent_credit_cost_non_negative ⑦money_in_reference_required）+deployment-db-baseline.md 追加纪律段（9 raw 对象清单+migrate dev --create-only 人工合并纪律）+**双等价索引 census**（P5 探针——`duplicate-equivalent-index` 红） | prisma/verify-indexes.sql+baseline md+census 扩组 | 先红验证：手工 DROP 对象→门红；双等价探针注入 fixture→红 | verify 链含新断言且全绿 |
| T7 | **C0 出口**：verify 三连全绿+census 先红证据落档+基线三场景数字落档+spec §0.6 无新增偏离 | — | — | **用户确认点①**：呈报 C0 出口证据 |

**C0 回滚**：纯增量 revert（指标+census+shared+断言）——无运行时行为变化（计时点前移仅观测精度）。

---

## 2. 片 A1：写门面（T8-T14）

> spec §2 片 A1 全文为本片验收基准。回滚=revert commit 组（纯门面+调用点改道，零生命周期变化）。

| T | 任务 | 改动文件 | 测试/门禁 | 出口 |
|---|------|---------|----------|------|
| T8 | **DocWriteOp 词汇表+writeBatch 核心（v2 补 Z108 内容校验）**：六 op+同 doc 同事务+逐 op 守卫事务内求值+`WriteOpResult[]` 一一对应（op 索引+类型）+失败语义二分（Z40）+调用方契约（deliver written:false⇒批后独立 rollbackDeliveryFailed）+幂等契约（Z76）+**内容校验（Z108：T4 manifest 校验表进门消费——键集/值域/批字节 Σ≤256KB/op 数上限/拒 `__proto__/constructor/prototype`；违规=业务级拒绝 `UNKNOWN_KEY`/`PATCH_TOO_LARGE`/`OP_COUNT_EXCEEDED` 进 reject 计数）** | collab/collab-doc-writer.service.ts\*+execution.service 退款路径 | **先红用例**：①deliver 命中 node-deleted⇒rollbackDeliveryFailed 仍被调用 ②Z75 合法终态 ③「data 与 exec 同事务」④**`__proto__` 键拒/超批字节拒/超 op 数拒** | writeBatch 单测绿；退款契约先红后绿；内容校验三拒可测 |
| T9 | **进门门+类型门+undefined 语义**：ensureSchemaVersion（前瞻拒=DOC_SCHEMA_AHEAD 事务级 throw）+transactSync（`(doc)=>void` 类型层+运行层 `if(r instanceof Promise) throw`）+writeNodeData patch 含 undefined⇒throw UNDEFINED_PATCH_VALUE+deleteNodeDataKeys 显式删键 op（客户端契约对齐 canvasIntents.ts:130-149）+writeExecStatus 维持跳 undefined+shared CanvasIntent wire 语义标注 | DocWriter+shared/canvas-intents.ts 注释 | undefined 注入直测 throw；降版/前瞻双拒码用例；deleteNodeDataKeys 删键断言 | 三门单测绿 |
| T10 | **origin=Origin.Server（v2=Z119 锚改写）**：`doc.transact(fn, Origin.Server)`（真事务 origin）；~~先红用例：undo 栈不受污染~~**作废**（trackedOrigins=['local-user'] 而库默认 'local'——修复前恒绿=假门禁）；新锚=①服务端写事务 origin===Origin.Server 直测②gateway:990 docDelta 按 origin 分流（服务端写不计客户端配额口径） | DocWriter+gateway docDelta 分流 | origin 直测断言+docDelta 分流用例（服务端写不计数）——**先红**（现 docDelta 不区分 origin） | 双锚绿 |
| T11 | **writeExecStatus 守卫（Z69 减法）**：签名**不改**（Promise<void>）——内部节点不存在⇒不建条目+计数 `exec_orphan_blocked_total`；sweepOrphanExec 游标轮转（Z56：orderBy:id+cursor 每轮 100 游标进程内） | collab-document.service.ts:209-212 内部+intent-reconcile sweep | 不建条目断言+计数可见+13 调用点零改动自证（census） | 新孤儿结构性不可产生 |
| T12 | **执行链合并+直写收编（v2：只计写段——Z100/Z122）**：loading 一段、deliver+done 一段（**readCanvas 读段移出**——归 D 片端口化）；「单节点**写** withDoc 段 ≤2」结构断言（**按 attempts 分支枚举上界 Z122②**——happy/plan-missing/duplicate-attempt/deadline/node-deleted/delivery-failed/claim 过期/通用 catch 逐档）；直写收编 B4 清单（collab-shrink:114/:154+intent-reconcile:493 改道 writeBatch；exportFresh:145 标 read-only 保留） | execution.service+collab-shrink.service+intent-reconcile.service | 结构断言（写段计数）+shrink/reconcile 行为回归 | census「待收编」清零（T2 红转绿） |
| T13 | **gc 工厂+shrink thaw（v2=P2 简化：一处赋值替换）**：createCanvasDoc() 收编 7 处（census 绿确认）；**shrink thaw=thaw 判据（:206-207）改用 :185 影子预演 shrunk**（预演已在 Y0b-4 T8 建；truth 继续用于 calibrateTruth/observe/force）——mini-task：先跑 write-frozen-chain.int.spec:116,120 确认红因→改赋值→断言翻转 | collab-shrink.service+工厂调用面 | 既有断言翻转（thawed=false→true）+doc-status 广播 ok | shrink 即时 thaw 断言翻转绿 |
| T13b | **端口先行（v2 新增——Z100 顺序修正）**：`CollabWritePort` 接口（**7 方法**：withDoc/readCanvas/isLeaseServing/isDocResident/writeNodeData/writeExecStatus/probeArtifacts）+DirectCollabWritePort（api 直调）+api 侧 13 消费点改道注入；**CollabModule 停止 exports CollabDocumentService 推迟到 D 片**（与模块拆分同批——防「停止 exports 时按原令牌解析⇒编译红」） | collab-write.port.ts\*+13 消费点 | 端口注入单测（api 全量行为回归）；编译零红 | 端口先行的改道完成 |
| T14 | **A1 出口**：直写 census 清零+全部行为断言绿+verify 三连+Y0b-5 偏离 §0.4d 第 8 条（shrink thaw）回「已根修」 | — | — | **用户确认点②**：呈报 A1 出口证据 |

**A1 冻结契约**（spec 片 A1 末）：DocWriteOp 词汇表+WriteOpResult 形状+失败语义二分+调用方退款契约+Z76 幂等+origin+undefined 拒绝。

---

## 3. 片 A2：常驻化（T15-T22）

> spec §2 片 A2 全文（v5 修订版）为本片验收基准。回滚=revert commit 组=会话表/释放握手/reaper 整体移除，withDoc 恢复「每次 open/disconnect」形态——A1 门面不受影响。

| T | 任务 | 改动文件 | 测试/门禁 | 出口 |
|---|------|---------|----------|------|
| T15 | **会话表+钉住谓词+读写二分（Z59；v2 补 Z109/Z111/Z113；v3 补 Z128 withSession）**：`CollabResidencyService`\*——`projectId→{conn, refCount, idleTimer, state:'held'\|'releasing'\|'zombie', bytes}`+**`withSession(pid, fn, {mode:'read'\|'write'})`**（读路径改道——readServerSV/readCanvas 现经 withDoc=每次 disconnect(true)=**每次全量编码 store**+计数抖动；读走共享会话不 disconnect 不武装 debouncer）；acquire=refCount++（遇 releasing⇒有限等待超时即新开——Z109）；**degraded 阻断（Z111）**+`yjs_degraded_docs` gauge；try/finally+周期对账（Z113）；写路径走会话 acquire | collab-residency.service.ts\*+collab-document.service.ts 读改道 | Z83 释放窗口用例+Z109 zombie 用例+degraded 不入池用例+**「常驻 pid 恒 1 条 direct」采样断言（读改写抖动即红——Z128，同时是 Z81 关停断言护栏）** | 关页后重复写不再重复装载；读路径零抖动零重复 store |
| T16 | **reaper（v3=Z126 heap 闸三层+Z132 数字）**：三条件（pendingQueues 空∧**TTL 到期〔COLLAB_SESSION_IDLE_TTL_MS 默认 120_000——P9 双向定标：下界=AI 作业单段间隔分钟级（30s 会使 loading→deliver 段间释放重载）∧上界=SIGKILL 窗/常驻 doc 数权衡，A2 实测调〕**∧无在飞会话写）+释放经 releaseSessionFor+释放前运行时防御（Z112）；**heap 闸常驻旁路修法（Z126——:848/:975 判据 `!documents.has∧tripped` 对常驻集恒放行的 P0）**：①闸按常驻集区分——冷 doc 维持拒新物化，**常驻集内 tripped⇒字节 LRU 驱逐 reason='forced'（拒绝服务换释放资源）**②**tripped 升 reaper 第一优先级触发源（高于 TTL）**；双层约束（Z106；v4=Z142 默认值显式化——主约束禁默认关闭）：COLLAB_MAX_RESIDENT_BYTES 字节主约束（**使用点默认 384MiB 显式——依据=api old-space 同量级；T0 注册 optional 无 default，默认落使用点此处**——否则主约束默认关闭而条目反推值反而活着=假门禁形态）+COLLAB_MAX_LOADED_DOCS 条目次约束（**使用点默认 64=待实测校准的近似**：384MiB÷典型 doc p95≈300KB 的 1/20 余量，T22 以 T0.5 实测 p95 字节回填；8MB 触顶 doc 由字节主约束拦；team 并发项目 >64 时=LRU 抖动可接受——64 是病态护栏非容量目标）+gauge+over_limit 计数（永不拒载）；store 失败强制淘汰（Z110：直接调 unloadDocument+**spool 交接义务 Z129**+PG 熔断期不重试 disconnect）；驱逐观测+驻留时长直方图（Z93） | residency service+gateway heap 闸+store.metrics | 判据单测+**heap 闸先红用例（注入 tripped=true+常驻满⇒断言 evicted+1 ∧ 无 SERVER_OVERLOADED 拒——现判据下 evicted 零增即红）**+字节 LRU+强制淘汰用例 | 闸对常驻集生效（旁路消除）；双层约束可判 |
| T17 | **统一释放入口 tryRelease（v3=Z129；v4=Z141 前置两项+Z143 顺序）+Z104 拆分**：`tryRelease(pid, motive)` 单点（三出口+releaseAllSessions+Z110 强制淘汰**全经它**）：常规动机（drain/selfIsolate/vacuum/reaper）**前置两项**=`pendingQueues[pid] 非空 **∧ !inFlightProjects.has(pid)（Z141——「队列空」≠「批已落定」：取批 window 内队列瞬空+append 失败批还原回队=BOI 契约防的窗；inFlightProjects=per-doc 在飞集合 gateway:263 既有；saveMutex 属库内部生产不读——Z94② 锚钉分工）**⇒拒绝释放+重置计时+计数`（reaper 判据上移）；关停/强制淘汰允许带批但**必须 spool 交接，交接失败⇒拒绝释放该会话（继续 hold 交步骤 4 drainAllDocuments 兜底）+ERROR 点名——非放弃整批（Z143）；spool 交接先做且不计入 300ms 逐会话预算（300ms 只量 disconnect 本身）；交接失败/逐会话超预算两种拒绝分别计数（T18 出口体现）**；释放动作=置 releasing→await disconnect(true)（硬超时 5s+zombie——T15）；3 释放出口改造+isPersistedComplete 拆分（Z104：剔 documents.has+shrink :303 改显式 releaseSessionFor 后判三态） | gateway 三出口+residency+collab-document.service | **先红用例（批非空+vacuum 触发⇒releaseSessionFor 未被调用——非「调了没卸」）**+vacuum 活锁不变量+stacked 稳态 0+shrink :303 不再超时 | 统一准入绿；活锁不变量绿 |
| T18 | **关停步骤 0（Z81 硬前置；v2 补 Z114 drain 观测；v4=Z143 双计数）**：`releaseAllSessions()`（每会话 ≤300ms/总 ≤2s 超预算点名——**spool 交接不计入 300ms（Z143）；交接失败与逐会话超预算两种拒绝分别计数**）先于一切关停动作+Σdirect===0 断言（非零=ERROR+计数）+hangReason 补 `resident-session-open` 档+**drain 两数观测（Z114：collab_drain_duration_seconds/collab_drain_projects_total——常驻后 drain 从秒级变数十秒级需可读数）+18s hardDeadline 按实测重标**；grace 维持 2_000（Z87）+关停落档实证 | gateway onApplicationShutdown 序列 | 关停集成用例（destroy 不超时+hangReason 零 resident-session-open）+drain 两数落档 | 每次关停零 destroy_timeout；drain 有数 |
| T19 | **三窗口用例+不变量**：Z64 用例①②（A/B 窗口）确定性构造+Z65 不变量断言（**合计口径** Z88）+注册表驱动+`hocuspocus.unloadDocument` 唯一调用点=census 禁他处直调+selfIsolate/shutdown 调 closeConnections 时 Σdirect===0 断言 | residency+gateway+census 扩组 | 三窗口用例绿；不变量断言绿；census 绿 | 竞态面全覆盖 |
| T20 | **三涟漪+第五涟漪+语义定案（v2=Z104/Z105/Z122④）**：computePending 增 residentDocs/directConns 显式字段+三读者改读（computePending/zeroConnDocs:519-522/auto-vacuum）+check-collab-health 阈值重标+**四稳态判据扩表（destroy_timeout=0/quiesce-timeout=0/stacked=0/release_with_pending=0）**+heap 闸按常驻重标+**isDocResident=hasActiveWsConnection(pid)（Z105 唯一形态——仅 WS 连接，与常驻会话无关）**+reconcile 装载=mode:'read' 即用即释不进常驻池+yjsDocLoadedByReconcilerTotal 注释同批更新+**Z92 断言改「超限时必有 over_limit/evicted 计数」**（`≤上限`恒真=假门禁——env 无默认时我方 v5 失误） | gateway+check-collab-health+intent-reconcile | 三读者改读断言+deferred 语义用例（无人看=deferred 保留）+超限计数配对 | 涟漪读者全改道（含第五项） |
| T21 | **Server 旋钮 pin+RPO 登记**：gateway:487 unloadImmediately:true 显式 pin 进 options 断言（**Z82a 理由**：残存价值护无会话 doc 的关页立即 store——防升级翻转+记录常驻路径已失效；禁以「谓词已拦」为由关掉）+collab-gateway.options.spec 同步+RPO 登记（Z61：SIGKILL 窗口 ≤maxDebounce 3000ms=E43⑥ 契约值；**maxDebounce 禁调大**——runbook+ecosystem 注释钉死） | gateway options+options.spec+runbook | pin 断言；RPO 契约行落 runbook | 旋钮语义定案 |
| T22 | **A2 出口（v4=Z144 耐久双向+Z145 判据绝对化）**：C0 基线对照——**结构性三判据（Z107：A=TTL 窗内 N 连续作业 load==1〔**必带本轮 TTL 值**〕/B=命中率≥0.9/C=store 单调上界——**样本显式排除 degradedDocs**）**+**字节绝对判据 `yjs_resident_bytes ≤ COLLAB_MAX_RESIDENT_BYTES`（Z145 主判据——字节约束真在生效，与 T16 默认值同源闭环；原占比 0.6 降观测趋势项：分母含 Nest 基线天然稀释，禁当硬门禁）**+**端到端耐久用例双向（Z129+Z144——单向「释放后必在 PG」会被 tryRelease 拒绝路径假绿）：①pendingQueues 空⇒释放成功∧释放后读 PG≡写入内容（耐久路径）②非空⇒拒绝释放∧计数+1∧下一轮 store 后仍达 PG（收敛路径）；先红构造=去掉①的判据（直接 disconnect）⇒②分支消失用例红（判据须覆盖守卫两种结果——否则测的是守卫非守卫保护的性质）**+单节点写段≤2+组执行 store 落档（T0.5 采样第一轮：A2 后 D 前）+vacuum 活锁+关停落档（drain 两数+双拒绝计数）+四窗口用例+完整性巡检首轮（Z111）+A1 行为断言全回归+**条目 64 校准回填（依据=T0.5 实测 p95 doc 字节——Z142）** | — | — | **用户确认点③**：呈报 A2 出口证据（含内存实测第一轮+TTL/条目数实测回填） |

**A2 冻结契约**（spec 片 A2 末）：释放握手 API 形状+会话状态机（held→releasing→released+acquire 串行化）+reaper 三条件+3 释放 1 清账+unloadDocument 唯一调用点+不变量合计口径+maxDebounce 上限钉死。

---

## 4. 片 D：worker 拆分+端口抽象+模块拆分（T23-T33）

> spec §2 片 D 全文（v5 修订版）为本片验收基准。回滚=ecosystem 回退单进程+revert 改道（worker 写端点保留无害；数据面零变更）。**最恶劣场景降级出口=COLLAB_ROLE=all 单进程（runbook 写死）**。

| T | 任务 | 改动文件 | 测试/门禁 | 出口 |
|---|------|---------|----------|------|
| T23 | **COLLAB_ROLE 角色+DaemonModule（v2 补 Z98）**：zod 枚举 `api\|worker\|all` 默认 api+role 三件套（Z67）+**ExecutionDaemonModule**（IntentReconcileService 双 timer+temp-cleanup/subscription-task repeatable——资金操作在内）**仅 role=api 装配**+结构性断言 `role!=='api'⇒providers 空`（「reconcile 只在 api」从口头前提变结构约束——**先红现成锚 Z122⑧：COLLAB_ROLE 全仓零读者，collab-env-single-source.spec+ENV_ALLOWLIST fixture 即红**） | env.ts+main.ts+gate-collab.mjs+.env.example+execution-daemon.module.ts\* | 三 role 各一启动用例+**worker 进程零 reconcile timer 断言**（双进程双倍回收钱的 P0-3 防线） | 角色门行为绿；daemon 单例结构性保证 |
| T24 | **端口补全+emit 端口（v2=Z99/Z101）**：HttpCollabWritePort（worker：走端点，**结果三分契约 Z99——瞬态 503 显式传递**）+**emit.port.ts\***（api=真 gateway/worker=降级 no-op+计数——emitNodeStatus :70-82 无防护 worker 必抛；6 processor+2 间接依赖面）+Direct 形态已在 T13b 落地 | collab-write.port.ts 补 Http+emit.port.ts\* | **Z99 第一验收锚（先红）：注入 503⇒rollbackDeliveryFailed 零调用+job 不失败**；emit 降级单测 | 三分语义防误退款；emit 不抛 |
| T25 | **7 模块拆分（v3 补 Z131 模块图 census；v4=Z139 补第 7 处 Metrics；T24 评审 F1 补登记）**：ExecutionModule→Core（service+processor 注入 port，**不含 IntentReconcileService——归 DaemonModule T23**）+Http（controllers）；ai-image-edit/ai-download 同法；**MetricsModule→MetricsCoreModule（service，保持 @Global——worker 也装）/MetricsHttpModule（controller）〔Z139：`collectDefaultMetrics()` 全仓唯一调用点=MetricsService 构造器（metrics.service.ts:15）——worker 不装 Metrics 则 3002 无 process_*/nodejs_* 族，Z134 的 event_loop_lag{role='worker'} 读数=null 与 0 不可区分〕**；**census 新组⑰（Z131）：worker.module 传递 imports 闭包 ∩ {*HttpModule,*Controller} ≡ ∅（结构断言强于 ECONNREFUSED 结果断言——防误带 Http 子模块⇒连带 CollabModule⇒gateway 抢租约）；先红=临时加 ExecutionHttpModule 进 worker.module⇒红（元纪律⑥ 贴红证据）**——前置：注入面 13 文件清单+readCanvas 经 Http 端口读+**T24 评审 F1 补面：三族 emit 专法改道（emitTrimStatus/emitSeparateStatus/emitStitchStatus——gateway :84-117 与 emitNodeStatus 同构无防护，video-trim/video-separate/stitch 消费，EmitPort 扩三法或同形第二端口）+execution.service:155 isLeaseServing 门 worker 处置（Http 端口 NotImplemented 面——受理判据改端点 503 传递或读面前置）** | execution/ai-image-edit/ai-download/metrics 模块文件+check-collab-census 扩组 | 各模块装配单测+**模块图 census 绿** | 拆分后 api 单进程全绿；worker 模块图结构性纯净 |
| T26 | **worker.module.ts+createApplicationContext（v2 补 Z102 ready 门；v4=Z139 依赖图显式含 MetricsCore）**：workerProviders() 只装 processor+队列模块+**MetricsCoreModule（Z139——3002 的 process_*/nodejs_* 族载体；`collectDefaultMetrics` 进程内恰一次〔二次调用重复注册抛错〕）**+main-worker.ts 引导序列 `setDefaultLabels({role:'worker'})`（Z138 落点=引导层）+零监听（**措辞修正 Z101：controller 仍被实例化，零的只是监听**）+**启动 ready 门：订阅队列前轮询 /api/ready 上限 60s（env 可调）超限非零退出交 pm2 autorestart** | worker.module.ts\*+main-worker.ts\* | worker 3000+3001 **双 ECONNREFUSED（构造性）**+ready 门用例（api 未就绪⇒worker 等待不消费；超限⇒非零退出）+**3002 三族验收（process_resident_memory_bytes/nodejs_heap_size_used_bytes/eventloop_lag 存在且带 role="worker"——Z139）** | 零监听+顺序自防（不依赖 deploy 编排） |
| T27 | **内部写端点（v3=Z133 幂等原则改写）**：POST /api/collab/doc/write-batch（P8 单端点；WORKER_WRITE_TOKEN 独立键+timingSafeEqual+production 未设**拒启**+禁 fail-open+token 放服务器 .env；**幂等=「端口只收幂等 op」原则（Z133——writeNodeData/writeExecStatus 均键级 set 语义，CRDT 重放同值收敛=幂等，零读判据不在最热路径加装载；非幂等 op 的重复防护归调用方禁进端点）+端点显式声明不承诺跨请求去重**〔重试多落 delta 行=有界/compact 坍缩/retry_total 可观测——禁内存去重表〕；body 内容校验=T4 manifest 校验表（键集/字节/拒 __proto__ 族+**idempotent:false 的 op 直接 4xx 拒收——Z148①：把「端口只收幂等 op」从散文变可执行断言，新增 op 忘分类即红**）；nginx 纵深：deny all+client_max_body_size 2m+proxy_read_timeout 30s〔防继承 1860s〕；api 进程内直调 port） | collab/collab-write.controller.ts\*+collab-admin-auth 模板复用+nginx 配置 | 三探针+**G1 用例（Z133 修正：同 idemKey 并发双发⇒doc 终态**内容收敛**〔重放后状态语义等价——非逐字节一致〕+净增行 ≤2×N_chunks〔compact 前两行都在〕+attempts 单调；先红构造=删 set 语义防线⇒行数断言红）**+内容校验违规 4xx+公网 403+retry_total 观测 | 端点鉴权+幂等 op 原则（G1）+内容校验+纵深四绿 |
| T28 | **失败钩子拆两半（Z41+Z90）**：`@OnWorkerEvent('failed')` 2 处改道（execution:62/ai-image-edit:290——留 worker 只做 PG 半 intentService.fail；exec 投影半走 api 既有最终一致链 alignExecFromIntents+reconcile+装载自检）+banner-cleanup:17 豁免（Z74 已结案——钩子仅 console.error） | 两 processor+reconcile 链核对 | 拆分后 worker 失败→意图终态化绿+api 投影收敛用例 | 零新增 Redis 连接/零跨进程事件丢失面 |
| T29 | **worker 指标出口（v3=Z134 巡检即采集面；v4=Z138 判据改写+Z148②④ 扩面）**：WORKER_METRICS_PORT=3002 loopback-only（node:http 独立 server+**worker 侧 setDefaultLabels({role:'worker'})——落 main-worker.ts 引导层〔Z138，T26 已落则此处零改动〕**）+**不进 nginx**（nginx 无 /metrics 路由是故意的）+**check-collab-health 扩读 3002 关键指标（event_loop_lag{role='worker'}/process_tree_rss_bytes——巡检即采集面，与 api 同形态；本仓无 Prometheus 是现状非本批引入）+soak 双端点读取与 worker 自暴露 `process_tree_rss_bytes{role='worker'}`（进程树 RSS 合计含 ffmpeg 子进程——T0.5 移入项此处落地）**+**worker 存活侦测（Z130：health 加 queue.getWorkers().length≥1〔付费三队列〕+waiting depth 阈值 5+collab_worker_absent_total）+付费队列 enqueue fail-closed（Z148②：入队时 getWorkers() 表明无消费者⇒503 拒绝〔ServiceUnavailableException+Retry-After，F11 同源〕——getWorkers 是 Redis 异步调用**必须带 5-10s TTL 缓存**防付费路径加 RTT）**+health 扩两对象（Z148④：`yjs_degraded_docs` >0 WARN/持续 N 分钟 ERROR〔gauge 存在无人读=温度计〕+`yjs_updates_rows_total` 预警〔观测项非机制项——不强制 compact〕）+3002 fail-closed+**role 标签双断言（Z138——原「族名交集检查断言」判据反写作废：setDefaultLabels 生效后全族带 role，原判据恒绿假门禁）：A 结构（必须）=census 断言 setDefaultLabels 全仓恰 1 调用点且在 main/main-worker 引导序列〔先红构造=移到 store.metrics.ts 顶层⇒红〕；B 内容（辅助）=两端点文本交集内任一族两侧 role 值不同〔worker 侧漏调⇒该族两侧均无 role⇒红〕+正向断言：3002 可读 `yjs_store_total{role="worker"}` 且值恒 0（worker 不写 doc——幻影零值变显式承认事实）**+runbook 四行（无 Prometheus 有意取舍/升级时加 scrape job 打 loopback 禁进 nginx/health 必须服务器本地 crontab/**role 标签变更记录+查询侧适配清单+升级路径按 pull 设计〔push 形态 remote_write/OTLP 会把标签写进时序库——两者需求不同，Z148⑤〕**） | worker 引导+check-collab-health.mjs+census 扩组 | 3002 loopback 可读+role 双断言绿（A/B 各附红证据——元纪律⑥）+**手动 kill worker⇒下一轮 */5 巡检非零退出（先红验证）**+公网无该端点 | worker 信号面可见+静默死亡有侦测+检测→动作闭环（enqueue 拒） |
| T30 | **ecosystem 双进程+门禁三处同 commit（v3 补 Z126③ 算术式+Z136⑤ 并发上界）**：apps+1（api：384/560M+worker：320/480M+nice:10+kill_timeout 120000——**全部〔待实测校准〕；实测未完成⇒max_memory_restart 维持 1G 不下调〔Z103〕**）+check-ecosystem 多 app 按 role 遍历+双向 role 断言+:57 余量按 role+:73 **跨文件断言（Z118+Z126③ 合并算术式：`resident_cap+maxDocBytes+基线 ≤ TRIP[role] ≤ max_memory_restart[role]`——resident_cap 与 TRIP 双处取值；**fail-closed（Z142：取不到值即红——无值可算时红或静默跳过二选一，选红，与 heap/rss 既有 fail-closed 形态一致**）**+ENV_ALLOWLIST 扩 COLLAB_ROLE+heap-pressure TRIP/RELEASE 按 role+**CPU 队列并发上界顺手收（v4=Z146 事实更正：缺口=video-trim.processor:14 无 concurrency〔QUEUE_CONCURRENCY.VIDEO_TRIM 定义未用——意图 0.7×核数与实现「默认 1」不符〕+thumbnail 未登记显式界〔BullMQ 默认 1 是保守界非「无上界」——stitch :27 已显式 concurrency:2〕；动作=video-trim 补 concurrency 参数+thumbnail 显式登记参数 1）** | ecosystem.config.cjs+check-ecosystem.mjs+heap-pressure.ts+两 processor | 三处同 commit；单值常量对 560/480 先红→分离后绿；算术式可执行；并发上界生效 | verify 全绿；实测前 1G 维持 |
| T31 | **systemd unit+deploy 顺序化（v3=Z136① 探针二选一显式结论）**：deploy/flowweb-pm2.service\*（P3：pm2-runtime 前台模式 Type=simple+User+PM2_HOME+MemoryMax=1150M+MemorySwapMax=128M+Restart=on-failure+RestartSec=5）+deploy.sh cutover ⑤ +P10 探针**出口=二选一显式结论**（通过⇒--only 三步；不通过⇒退一条 startOrReload --update-env，顺序正确性归 T26 ready 门零成本退路）+:138 3001 断言+worker 双 ECONNREFUSED+spool 迁移按 app 名逐个+cwd 一致断言+pre-cutover quiesce 可选项（Z114③）+systemd unit 安装步骤 | deploy/flowweb-pm2.service\*+deploy.sh | 部署演练零 503+**探针结论显式落档（采用/退回二选一）** | cutover 链双进程绿；探针结论落档 |
| T32 | **连接池+内存实测第二轮（Z11/Z91）**：DATABASE_URL connection_limit=8（api）/4（worker）+runbook §4 算式更新 `(8+4)+协作头寸≤100`+**双进程实测**（P7 采样器：worker=进程树口径含 ffmpeg 子进程）+稳态判据 `p95(api)+p95(worker 树)+协居实测+300≤1967` 判定——不满足⇒降级出口登记 | ecosystem DATABASE_URL+runbook | 实测两数落档+判据判定记录（达标/降级二选一显式） | 判据有显式结论 |
| T33 | **D 出口**：双 ECONNREFUSED+ws 升级拒绝+queue.getWorkers() 断言+**/api/ready workers 维度（Z130②：workers.registered/lastSeenAgoMs——客户端与 runbook 共用读数）**+exec-smoke 双进程绿+api 单进程（all）回归全绿+假第二进程直连写被拒（语句级 fence 复验+INSERT 唯一写点 census）+stalled 重投用例+drain×write-batch 相遇用例（Z125-4）+env 两分 census 绿 | — | — | **用户确认点④**：呈报 D 出口证据（含内存实测第二轮+判据结论） |

**D 冻结契约**（spec 片 D 末）：COLLAB_ROLE 词汇表（默认 api）+CollabWritePort 接口形状+WORKER_WRITE_TOKEN 形态+worker 禁令符号级清单+3002 loopback 契约。

---

## 5. 片 E：部署档位（T34-T39）

> spec §2 片 E 全文为本片验收基准。与 D 同窗（D 后 E 前 or 交叉——NODE_ENV 四坑中 ④ gate-collab 与 D 的 role 三件套同批已落）。回滚=env 统一+XFF revert；数据面零变更。

| T | 任务 | 改动文件 | 测试/门禁 | 出口 |
|---|------|---------|----------|------|
| T34 | **NODE_ENV 单源（Z12+Z45 四坑）**：zod `z.enum(['development','test','production']).default('production')`+parseEnv 成功后写回 process.env.NODE_ENV+①.env.example:47 production→development②resolveCollabDebounce useValue→useFactory（collab.module:25）③env.spec 改 vi.stubEnv④gate-collab API_ENV NODE_ENV:'development'（D 片 role 同批已提）+8 生产直读点统一改读 env 单源（模块加载期 3 处单独处理：dto decorator/gateway:42）+census 裸读清零（Z79 两分判据——构造器白名单 4 处；**v4=Z147① 前置：落 census 前先全仓枚举 process.env 直读清单贴入口条件〔实测 28 生产文件，含模块级 const：auth.ts:21/media-process.service.ts:10-11 等〕——白名单按实测重划，模块级 const 违规名单=本任务处置面；防 census 首跑红一片或白名单大幅扩张二选一盲区**）+COLLAB_FAKE_AI∧production 拒启 | env.ts+8 读点文件+.env.example+gate-collab | 三档先红后绿；gate-collab 在 production shell 跑 verify 不被拒启守卫误伤（Z45④ 回归锚） | NODE_ENV 单源绿 |
| T35 | **COOKIE_SECURE 三态（Z13+Z45⑤）**：`z.enum(['true','false']).optional()`+resolver 单点函数（显式优先→未设按档位 production 恒 true→**production+explicit false⇒拒启动**）+与 update-profile.dto trustedOrigins（require_tld/protocols）同批对齐（同一 resolver 驱动 auth.ts:48 与 dto:18,19,25） | env.ts+auth.ts+update-profile.dto | 三档各一用例（development+true→仍 Secure=本地 HTTPS 出路/production 未设→true/production+false→拒启）先红后绿 | cookie 语义闭环 |
| T36 | **网络面三补（Z14+Z46）**：**前置第一步=现场核 nginx XFF 实配**（nginx -T 确认 location /api 的 proxy_set_header——非 replace 面）①API_BIND_ADDR 新增（main.ts:115 全网监听→127.0.0.1）②COLLAB_TRUSTED_PROXY production 未设⇒拒启③XFF 统一 req.ip（删 rate-limiter.service.ts:44-50 手写解析）+RATE_LIMIT_IP_WHITELIST 进 zod **且与删手写解析同 commit** | main.ts+rate-limiter.service+env.ts+nginx 核验记录 | **验收断言**：`curl -H 'X-Forwarded-For: 1.2.3.4'` 打真实入口⇒req.ip=1.2.3.4 非 127.0.0.1（不做此断言=E58③ 假绿）+伪造 XFF 仍被限流（两条通道：手写 getClientIp 消费方+全局 ThrottlerModule） | XFF 语义绿 |
| T37 | **Redis 三件（E58②）**：appendonly everysec+maxmemory 128MB 实测核对+noeviction 维持——载体=deploy/redis/server-redis.conf\*（模板入仓消灭「生产配置不在仓」）+deploy runbook 步骤=redis-cli INFO persistence 断言 | deploy/redis/server-redis.conf\*+runbook | 服务器 INFO persistence 断言通过 | Redis 配置入仓 |
| T38 | **备份降档四件（Z16）**：①pg_dump 每日 crontab（check-collab-health 旁）含水位守护（>85% 优先删最旧；atomic 命名+失败不删旧）②runbook 化（full-stack-backup.md 与 deploy.sh pg_dump 双轨合一+保留分层表）③PITR 配置模板+上线前执行清单挂 Y7④恢复语义四行（Redis 全丢恢复禁手工重投+恢复对象补 CanvasDoc/CanvasDocUpdate/CollabLease+恢复后 bump generation 两行）+MinIO 无备份=Y7 门槛项登记 | scripts/pg-dump-daily\*+crontab+runbook | 手动触发一次全链+水位守护演练 | crontab 首跑证据 |
| T39 | **E 出口+server-profile 更新**：全先红后绿证据+Redis INFO+crontab 首跑+server-profile 文档（双进程算式 Z44/Z85 口径+协居重实测值回填） | server-profile md | — | **用户确认点⑤**：呈报 E 出口证据 |

---

## 6. 片 B：gateway 领域 service 化（T40-T43，殿后）

> spec §2 片 B 全文为本片验收基准。纯结构重构——**行为零变化，任何断言修改=偏离登记**。回滚=各步独立 revert（步骤间 verify 门）。

| T | 任务 | 改动文件 | 测试/门禁 | 出口 |
|---|------|---------|----------|------|
| T39b | **B0 测试基座（v3 新增 Z135；v4=Z140 全面改写——清单由脚本产出非人估）**：**步骤 0（必先）**=枚举脚本产出「成员→所属目标 service（Persistence/SessionGuard/DocRegistry/不搬）→访问形态（读写/直调/splice）」三列清单贴入口条件+**量出 façade 收敛比 N/M**（M=成员触达处实测〔gateway 对象口径≈368 处/20 文件：gw 变量 269+kit.gateway 99——Z135 245/18 为单一拼写口径订正；`as any).` 成员访问 436 处；精确数以步骤 0 输出为准〕，N=façade 方法数；**N≈M 则 façade=零收益垫片，重裁策略**）。B0=①落「测试只能经 façade 访问内部状态」门禁脚本（check-collab-test-facade.mjs\*——**违规定义=「绕过类型系统访问 gateway/collab 内部状态」全形态：`as any` ∨ `as unknown as` ∨ `@ts-expect-error` ∧私有成员访问（Z140②——单一拼写正则=拼写敏感门禁，换个写法就绕过，Z43「符号级非语法级」同教训）；计数口径写死在脚本里+先在现状跑出基线数）**——**自身先红（基线数=步骤 0 实测）**②**façade API 按操作设计非按成员暴露**（`clearPendingQueue(pid)`/`pushPendingFrame(pid,u)`/`pendingQueueRef(pid)`——**保留数组身份与 splice 语义**：collab.gateway.spec.ts:693 `toBe(firstRef)`〔注释自陈「set 替换写法必红」〕与 :1226 `toBe(tailRef)` 是行为契约，替换改变数组身份即红=偏离登记）③机械替换→verify 全绿后 B1/B2/B3 才启动 | check-collab-test-facade.mjs\*+受影响 spec 文件（步骤 0 清单）+collab-gateway-test-facade.ts\* | 步骤 0 清单+收敛比落档；门禁先红（实测基线数+红证据贴档——元纪律⑥）→替换后绿；collab 套件行为断言零变化（:693/:1226 数组身份断言原样绿） | B0 步门（façade 门禁进 verify 链） |
| T40 | **B1 Persistence 切出**：CollabPersistenceService（store/spool/drain/pending 的 doc 持久化状态，≤500 行）——**不启 WS Server 可独立实例化**（store/compact/spool 单测直跑——E29 原动机）；行为锚 A5-A14 护航+**G2 用例（Z125-2：append 同一 update 3 次→compact→断言行数===0+声明式断言 compact 读行覆盖全部行禁 LIMIT——把重复行坍缩从实现巧合升格为契约）** | collab-persistence.service.ts\*+gateway 瘦身 | Persistence 独立实例化单测跑通 store→spool→回灌全链+G2 绿；verify 全绿（行为零变化） | B1 步门 |
| T41 | **B2 SessionGuard+DocRegistry 切出**：SessionGuard（连接鉴权/限流/awareness 判定——判定纯函数化 request/context→verdict）+DocRegistry（doc 生命周期账目+**常驻会话表并入**——P1 过渡完成+owner 抽象 E35）；生命周期状态机单一所有者+跃迁穷举单测 | 两 service\*+gateway 瘦身 | 跃迁穷举单测；Z65 不变量断言随迁绿；verify 全绿 | B2 步门 |
| T42 | **B3 本体收敛+行数门禁**：gateway 本体只剩钩子编排+协议适配（≤600 行防倒退锚）+check-collab-module-size\*（Z96 计法=对齐 wc -l：`content.replace(/\n$/,'').split('\n').length`）+census 组④ ENCODE_WHITELIST 按文件计数同批更新（Z24） | gateway+check-collab-module-size.mjs\* | 行数门禁先红（切分前 3222）→绿；verify 全绿 | B3 步门 |
| T43 | **B 出口**：①Persistence 独立实例化全链单测②gateway≤600/三 service≤500③跃迁穷举④collab 套件全绿（行为零变化）+Y0b-4 偏离 52（pricing drift）出口核销确认（C0 T6 已落） | — | — | **用户确认点⑥**：呈报 B 出口证据（全批终出口） |

---

## 7. 全批出口与回填义务

### 7.1 全批出口判据（spec §4.1）

1. 六片各自验收判据全绿（T7/T14/T22/T33/T39/T43 用户确认点①-⑥）
2. `pnpm verify` 全链绿（含 C0 起逐步入链的 census 扩组/行为锚/行数门禁/三断言按 role）
3. 双进程部署演练：deploy.sh 全链（preflight→cutover→smoke 双绿）+内存实测两轮落档+稳态判据显式结论
4. 总目录回填：Y0c/Y0.5 行状态更新+核销项（§0.3）同步

### 7.2 回填义务清单（执行期滚动）

| 时点 | 回填 |
|------|------|
| C0 出口 | Y0b-4 偏离 52（pricing drift）→「已由本批片 C0 根修」 |
| A1 出口 | Y0b-5 偏离 §0.4d 第 8 条（shrink thaw）→「已由本批片 A1 根修」 |
| 每片出口 | spec §0.6 偏离表滚动+总目录行内状态 |
| 全批完结 | 总目录 Y0c/Y0.5 行终态+spec §0.3 核销表同步回总目录（防下批重复勘察） |

### 7.3 执行门登记（B 类合并批——门一道不少）

| 门 | 时点 | 内容 |
|----|------|------|
| ① | T7 | C0 出口（度量契约先行） |
| ② | T14 | A1 出口（写门面行为契约） |
| ③ | T22 | A2 出口（常驻化资源生命周期+内存实测第一轮） |
| ④ | T33 | D 出口（双进程+内存实测第二轮+判据结论——**不达标此处走降级出口**） |
| ⑤ | T39 | E 出口（部署档位） |
| ⑥ | T43 | B 出口（结构重构殿后+全批终出口） |

