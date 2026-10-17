<!-- doc-status: draft-v3 | created: 2026-10-18 | v1→v2: 三份外审实证吸收（R4b 重构 limits 模块/dist-drill/R2 watchdog/R3 CI 卫生/R4a heavy/R5 回显带宽成本；驳回 OutboundFlow 重写·生产布局反案·路线前移）。v2→v3: 三份 v2 外审实证吸收——①maxTx>maxDoc derive 校验删除（六夹具冲突实证：drill 40KB+默认 tx/int :40/shrink :170/:282/quota-config :51/rate-gate :137；移 env superRefine 生产策略单源）②B9 勘误回（DR:722 ⓪′桶消费先于 :728 readOnly 早退——红门⑧=有效桶断言，上轮报告2「没进桶」错误、v2 照抄未验；改法=改名+补 readOnly 断言+小配额 refill 另测）③全局预算 1s sweep→send 路径同步记账（硬上界）+budget 64→96MB（10人×8MB 扇出 80.6<96）④close=2×ss2+ALLOWANCE 余量⑤B15 心跳进本批（恶化者同批缓解）⑥client registry 闭环 B3⑦heavy 必须改主套件 exclude⑧awareness 前瞻永不 close⑨CI api build 产物断言。驳回：maxDocBytes 8→2MB（登记 Y1c-3 首项设计输入）/B14 本批做（强化登记 per-plan 前）/maxLoadedDocs cap（无实测倍率）。两处照抄未验错（maxTx 校验+B9）教训：进 spec 断言一律先实证。待用户确认后进入 plan -->
# CI 双故障根修批（write-frozen 演练卡死 + rate-gate 双用例）设计 spec

日期：2026-10-18（立项日；同日三轮外审实证吸收 → v3）

定位：修复批（非功能批）。CI master 自 #40（2026-10-13，sha 94e9c645）起 22 连败至 #61（每次 collab-core 吃满默认 360min 被 cancel ≈ 白烧 130+ runner 小时），最后绿 = #39（2026-10-11，sha 59734a13）。双故障均由 #39→#40 窗口内 Y0b-5 T8/T9 提交引入（T9=172f0e17 演练进 collab-core；T8=SS2 闸抬到 maxDocBytes+ALLOWANCE）。#62-#66 已人工取消（2026-10-17，含 4 个回滚孤儿 SHA run）。

由来：用户呈报外部分析 → 四路核验成立 → v1 → 三外审驳回 v1-R4b（三硬伤坐实）→ v2 → 三外审 v2 评审（夹具冲突+红门⑧ 反转+B15 同批论证）→ 用户确认裁决 → v3。

---

## 0. 基线快照（2026-10-18 实勘，行号为当日值——执行期漂移按语义定位）

| # | 事实 | 位置 |
|---|------|------|
| B1 | drill 脚本 require 常规构建布局 `../dist/modules/collab/canvas-doc-update.repository.js`；drill 编译产物实际在 `dist/src/modules/...`（tsconfig.drill.json `rootDir:"."`）；常规布局仅 `tsc -p tsconfig.json`（rootDir ./src）产生。〔plan 期勘正（v3 照抄外审错误）：test job 的 `pnpm verify` tier=full **已含 api-nest-build 步+check-no-testutils-in-dist --require-dist**（verify-manifest.mjs:29-30）——生产 emit 在 CI 有覆盖，v3-R3'「api build 产物断言 step」冗余删除；外审「CI 不跑生产 emit」断言不成立〕。根因定性：同目录两种布局并存（nest build 与 drill 共写 dist——collab-core job 的 dist 只由 drill 编译产生，两布局随历史残留互踩） | write-frozen-drill.mjs:188 / tsconfig.drill.json:5-6,10 / verify-manifest.mjs:29-30 |
| B2 | kill9 `DRILL_ENTRY` 同指 `dist/scripts/collab-drill-server.js`（drill 布局）——R1' 改独立 outDir 时**必须同批改**否则 kill9 先坏 | collab-kill9-drill.ts:53 |
| B3 | 两 drill 错误出口同款 bug：均「kill children + console.error + 只设 `process.exitCode=1`」——错误路径 provider 未 destroy，自动重连定时器养事件循环 → 进程永生（run 59：报错后 5h56m 零输出，Post cleanup 仍 Terminate orphan pid 6161/6179） | write-frozen-drill.mjs:425-429,252-253,337-341 / collab-kill9-drill.ts:421-425 |
| B4 | collab-core 与 test 两 job 均无 `timeout-minutes`；无 concurrency 取消、无失败通知——22 连败 5 天无人发现（治理缺口） | .github/workflows/ci.yml:12,140,115 |
| B5 | 出站背压二级闸**先判后发**：单连接真实 backlog 上界 = CLOSE + maxFrame（现状 4MB+8.06MB≈12.06MiB） | collab-session-guard.service.ts:728-748 |
| B6 | 最大合法入站帧 = maxDocBytes+FRAME_ALLOWANCE_BYTES = 8MB+64KB；maxDocBytes 默认 8MB（env COLLAB_MAX_DOC_BYTES 可覆盖，**仅 positive int 无上限**）。配 20MB 则 SS2 闸 20.06MB > ws maxPayload 16.78MB，应用层 4404 永不可达 | collab-quota.ts:8,17 / collab-doc-registry.service.ts:241 / env.ts:195 |
| B7 | hocuspocus 4.6.0 回显发送者且同步 flush：`broadcast` 无 filter 不 exclude origin；`flushDelay=0`/`flushMaxBytes=1MiB` 默认——`pendingUpdateBytes(8MB)≥1MiB` 时同步 flush 于 apply 当拍；SS2 处理后紧跟小帧 SyncStatus ack。**项目未 pin flush 参数** | @hocuspocus/server/src/Document.ts:82-83,339-348 / MessageReceiver.ts:190,216-256 / collab-server.factory.ts:68 |
| B8 | 桶容量派生先例：`bytesBuckets capacity = activeQuota.maxDocBytes + FRAME_ALLOWANCE_BYTES`；quota 四值读面 = DR.activeQuota 单源（W3b RC2） | collab-session-guard.service.ts:340-343 |
| B9 | rate-gate 两用例 CI 恒红形态（run 59 实证）：成对用例 `expected {code:1011,'slow-consumer'} to be null`（:94，916ms——B7 同步回显冲破 4MB，下一发 ack 即杀）；红门⑧ `pollUntil timeout after 15000ms`（:119/:121）。**红门⑧ 断言有效性勘正（v3 定稿）**：DR.guardSyncFrame 顺序=⓪帧闸(:706)→SS2闸(:711)→⓪′`consumeBytesBucket`(:722)→①readOnly 早退(:728)（:718-719 注释自证「帧闸后 readOnly 早退前」）+库 beforeSync(:190) 先于 readOnly 分支(:217)——**第二次 8MB 确实进 bytes 桶**（扣减+计数），仅 readOnly 拒 apply。tokens/counter/closeInfo 三断言均有效；歧义仅标题「通过」=桶通过≠doc 应用。〔v2 曾按上轮外审写「根本没进桶」——照抄未验，错误已勘正〕两用例 pollUntil 每 50ms `'x'.repeat(8MB)` ≈16MB churn/轮 | collab-rate-gate.spec.ts:80-105,107-133 / DR:722,728 |
| B10 | 红门⑧ 15s 超时结构性解释：**heavy 用例同池并行**——idle-anchor 90s 真实等待与 8MB 分配用例在 2 核 runner 多 worker 并行（collect 126s/tests 261s/wall 148s） | collab-idle-anchor.spec.ts / run 59 日志 |
| B11 | SG 行数锚 1238/1238 恰在上界，文案明写「禁改锚绕行」——方案=抽 `collab-limits.ts`，SG 净减行**不改锚**；新文件须入锚表防无人看守（防倒退语义平移） | scripts/check-collab-module-size.mjs:50 |
| B12 | `dist/modules` 消费面 census 分类：**部署产物消费方**=collab-smoke.mjs:21（注释自证 P21）/collab-soak.mjs:34-35/exec-smoke.mjs:50——post-deploy 冒烟链不得随 R1' 改；**drill 布局消费方**=write-frozen:46,188+kill9:53 | apps/api/scripts/ |
| B13 | check-ecosystem 内存算式无出站项：现仅 `resident_cap(384MiB)+maxDocBytes+基线 ≤ TRIP[api](750MiB)` | scripts/check-ecosystem.mjs:143 |
| B14 | 写门面无 maxDocBytes 执法（登记移交**强化排序**=per-plan quota 之前）：writeBatch 仅受理门+schema 门，配额预算零检查 | collab-doc-writer.service.ts:207+ |
| B15 | 一级闸丢 awareness×保活 4408 风暴链：backlog>1MB 持续→awareness 回显被丢→客户端 30s 无入站帧（messageReconnectTimeout）→4408 强断→重连风暴（独立于 1011 的第二风暴机制）。**本批 R4b' close 抬升会延长丢 awareness 窗口——恶化者须同批缓解（R6 心跳）** | SG:741 / canvasCollabRuntime.ts:1585 |
| B16 | ws maxPayload=16MiB pin 现址 factory:68——单源化归 R4b'（迁 collab-limits.ts） | collab-server.factory.ts:68 |
| B17 | **小配额+大 maxTx 夹具族（v3 新增，maxTx>maxDoc 校验冲突实证）**：write-frozen drill :245（doc 40_000+tx 默认 262_144）/write-frozen-chain.int:40（40_000+262_144）/shrink:170（2048+默认）/shrink:282（8_192+默认）/quota-config:51（1_024+默认**且断言未注入键维持默认 tx**——clamp 形态也红）/rate-gate:137（8_192+16_384）。语义：tx=单事务上限、doc=内容配额，**tx>doc 是合法测试形态**（write-frozen 正是 40KB doc+256KB tx+50KB 大节点测冻结链） | 各 spec/drill |
| B18 | 内存算式单位口径（v3 勘正）：402,653,184+8,388,608+预算+138,800,000 bytes；750MiB=786,432,000B。64MB 预算形态=616,950,656B=588.4MiB（**余 161.6MiB**）；96MB 预算形态=620,641,000B≈620.4MB（余 165.6MiB）——禁 MB/MiB 混标 | 验算定稿 |
| B19 | execSync(tsc) 阻塞事件循环——unref watchdog 在同步阻塞期**不触发**，watchdog 兜不住 tsc 挂（分责：tsc 挂归 CI step timeout；fetch/Prisma/未知句柄归 watchdog） | write-frozen-drill.mjs:77 |
| B20 | lib 保活现状：hocuspocus 服务端不发 Ping（check 只判超时）；客户端 onMessage 任意帧重置 lastMessageReceived（provider 内建）——R6 心跳的机制基础 | @hocuspocus/provider dist |

## 1. 双故障根因（v3 定稿）

### 故障 1：collab-core step「write-frozen 全链演练」卡死 6h（三层叠加）

1. **直接原因**（B1）：`:188` require 常规布局路径，CI 只有 drill 布局 → MODULE_NOT_FOUND（run 59：18:57:19 启动→18:57:25 报错 6.3s）。本地绿=dist 残留。根因=同目录双布局并存。
2. **卡死机制**（B3）：错误路径 provider 未 destroy+只设 exitCode → 事件循环永生。kill9 同款。**v3 闭环**：client registry+finally destroy（自然退出为主）+exit 兜底。
3. **放大器**（B4）：无 timeout+无 concurrency+无通知（治理缺口三层）。

### 故障 2：test job rate-gate 两用例 CI 恒红（独立故障，2444 过 2 挂）

**成对用例 1011 误杀=确定性链路**（B5/B6/B7）：

```
client 发 8MB+30B SS2（合法）→ 服务端 apply（pollUntil 过）
→ pendingUpdateBytes 8MB ≥ flushMaxBytes(1MiB) → flush 同步执行
→ broadcast 无 filter 回显 ~8MB 给发送者
→ 下一拍 SyncStatus ack 小帧过 wrap → backlog≈8MB > 4MB
→ close(1011,'slow-consumer')
```

**结构性张力确证为产品级缺陷**：T8 抬最大合法帧至 8MB+64KB 后单次合法回显≈2×二级闸阈值。生产推演：>4MB 合法 doc+慢下行 → 重连同步回显破阈 → 1011 → backoff 重连 → 再同步 → 再杀=重连风暴死循环。

**v1-R4b（阈值抬 2× 派生）三硬伤**（外审实证）：小配额 close<drop 反转（132KB<1MB）/先判后发上界差一帧/无全局预算+env 无上限。**v2-R4b' 五处实施缺陷**（本轮外审实证）：maxTx>maxDox 校验打爆六夹具（B17）/1s sweep 软预算（同 turn 10×8MB=80MB 先入队）/64MB 与 10 人×8MB 扇出不相容（80.6>64 → 降序 close 健康慢连接=聚合层误杀）/2× 满帧边界无余量（两满帧恰=close，ack 即杀）/census ⑤ 扩白名单=门禁放松。v3 全数修正（§2 R4b'）。

**红门⑧ 15s 超时**（B9/B10）：churn 根除+heavy 串行隔离；断言保留桶语义（B9 勘正）。

---

## 2. 修复设计（R1'-R6'，v3）

### R1'：drill 独立输出根 `dist-drill`（v2 定稿形态不变）

- `tsconfig.drill.json` outDir `./dist`→`./dist-drill`；同批三处：kill9 `DRILL_ENTRY`（B2）+ write-frozen `DRILL_ENTRY`(:46) + `:188`→`../dist-drill/src/modules/...`。
- `.gitignore` 加 `apps/api/dist-drill/`；B12 部署消费面不动；不做双布局探测；不加 nest build 于 collab-core。
- **验收强化**：`rm -rf apps/api/dist apps/api/dist-drill` 后两 drill 双绿且 `apps/api/dist` 不被创建。

### R2'：drill 错误出口确定性收口（v3：client registry 闭环 + 三层）

两脚本同批：

1. **client registry（B3 根因闭环）**：`connectClient` 内注册（模块级 Set）；两 mode 的 finally 统一形态：destroy 全部 client（幂等）→ fixture 清理 → prisma 断开 → h.stop()。成功/失败路径同构——句柄确定性销毁，**自然退出为主**；watchdog 路径 exit(2) 前尽力同款清理（本地残留 WARN+残留 id 打印）。
2. **stderr 同步写**：`die(e)` = kill children → `process.stderr.write(stack, () => process.exit(1))` + 1s 兜底 exit（防 CI 管道截断）。
3. **watchdog**：`WF_DRILL_WATCHDOG_MS`（默认 10min）unref 定时器 exit(2)；**分责声明（B19）**：execSync(tsc) 阻塞期 watchdog 不触发——tsc 挂归 CI step timeout 兜底；fetch/Prisma/未知句柄挂归 watchdog。
4. **每个网络 await 有界**：metrics/postShrink/drain fetch 加 `AbortSignal.timeout(10_000)`。
- TEMP-RED 双脚本：错误注入→秒级 exit 1 栈完整+零孤儿；`WF_DRILL_WATCHDOG_MS=100`+黑洞端口→exit 2。

### R3'：CI 卫生（v3 收紧）

- workflow：`concurrency: { group: ci-${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true }`（取舍登记：master 连续 push 时中间 commit 的 run 被取代=省 runner 换单人线性流信号，对 6h hang 形态利大于弊——#62-66 人工取消同意愿）。
- job timeout：test 60 / collab-core 30 / doc-gate 5 / gitleaks **10**（全历史扫描+下载，5 过紧）。
- step timeout（**和 ≤ job 30**）：int 6 / kill9 8 / write-frozen 10 / test 的 verify 55。
- ~~api build 产物断言 step~~（plan 期删除：verify tier=full 已含 api-nest-build+require-dist 产物断言——B1 勘正）。
- **master 失败通知**：workflow_run notify job，**幂等形态**（单 tracking issue+comment 追加或每日摘要，禁 22 连败开 22 issue）+显式 `permissions: issues: write`。
- 通知是配套非 gate（required checks 既有四 job 已覆盖；merge queue 归后续治理项）。

### R4'：rate-gate 根修（R4a' 测试侧 + R4b' limits 契约）

**R4a' 测试侧**（v3 修正）：

1. **长度锚**：pollUntil `blob?.length === N`（O(1)）+通过后一次性全等断言。
2. **红门⑧ 勘正后改法（B9 v3 定稿）**：**保留** 8MB 桶用例全部三断言（tokens/counter/closeInfo——有效桶断言），改名「8MB 回灌：第一次入桶并冻结；第二次仍入桶（refill 后通过）但 readOnly 不 apply」+头注写明「通过=桶通过≠doc 应用」；**补** readOnly 断言（第二次后 conn-status readOnly 或 overPush 路径证据）；**另加小配额 refill 用例**（64KB 档配额+帧，两次都 apply——真 refill 语义，轻且确定，8MB/6MB 档留最大帧验收）。〔v2「换掉桶断言」方案废弃——会失去 8MB 回灌第二次不误杀的覆盖〕
3. **负向断言事件化**：sleep(300)→等确定事件（SyncStatus/stateless 到达）后断言 null。
4. **heavy 串行隔离（v3 补 exclude 机制）**：新建 `vitest.heavy.config.ts`（rate-gate+idle-anchor 两文件；`fileParallelism:false`+`maxWorkers:1`+`testTimeout:180_000`）；**主套件 vitest.config.ts exclude 必须同步加两文件**（否则双跑=假隔离——v2 缺此条）；alias（@flowweb/shared）同批复制；verify manifest 27→28 步+BASELINE_IDS+scripts-node-test 列举同步；census/façade 门禁扫描面不变（不依赖运行）。

**R4b' limits 契约**（v3 修正五处）：

新建 `collab-limits.ts` 纯模块：

```ts
export const WS_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;      // 自 factory:68 迁入单源（B16）
export const BACKPRESSURE_DROP_BYTES = 1_048_576;          // 自 SG:62 迁入
export const OUTBOUND_BUDGET_BYTES = 96 * 1024 * 1024;     // v3: 64→96MB（10 人×8MB 扇出 80.6<96）

export function deriveCollabLimits(q: QuotaConfig, budget = OUTBOUND_BUDGET_BYTES): CollabLimits {
  const ss2FrameGate = q.maxDocBytes + FRAME_ALLOWANCE_BYTES;
  const updateFrameGate = 2 * q.maxTxBytes;
  if (ss2FrameGate > WS_MAX_PAYLOAD_BYTES) throw ...;       // fail-fast（B6 footgun）
  if (updateFrameGate > WS_MAX_PAYLOAD_BYTES) throw ...;
  // v3 删除：maxTxBytes > maxDocBytes 校验（B17 六夹具冲突+语义不成立——tx=单事务上限 doc=内容配额，
  // tx>doc 合法形态；〔plan v2 勘正：env superRefine 方案撤销——drill 子进程经 app.module:46 模块级
  // validateEnv，40KB doc+默认 256KB tx 必被拒启=collab-core 必红；产品策略无校验（三传输校验即全量）〕）
  const backpressureCloseBytes = Math.max(2 * ss2FrameGate + FRAME_ALLOWANCE_BYTES, 2 * BACKPRESSURE_DROP_BYTES);  // v3: +ALLOWANCE 余量（满帧×2+ack 不误杀）
  if (backpressureCloseBytes > budget / 2) throw ...;
  return { ss2FrameGate, updateFrameGate, bytesBucketCapacity: ss2FrameGate,
           backpressureDropBytes, backpressureCloseBytes, outboundBudgetBytes: budget };
}
```

- ~~env 生产策略校验~~（plan v2 撤销：drill 子进程经 app.module:46 validateEnv 必被 40KB/256KB 打死——tx>doc 非安全属性，不做任何层校验）。
- **wrapBackpressure 前瞻判定（v3 细化）**：`backlog + frame.byteLength > close` 分帧型——**awareness 永远 drop 不 close**（前瞻分支只对 sync/stateless 走 close——防大 backlog 期大 awareness 帧直接断连比丢帧更糟）；封顶单连接真实上界=close。
- **全局预算=send 路径同步记账（v3 重设计，替 1s sweep）**：wrap 内 `budget.tryReserve(frameBytes)` 超 budget 立即 close 当前连接（cb/close 摘除时 release）——**硬上界**（+一帧误差）；周期 sweep 仅对账（drift 观测）；budget 模块**不读 bufferedAmount**（census ⑤ 不扩白名单——v2 方案废弃）；sweep timer unref+onApplicationShutdown clear+ws close 摘除。
- 超预算 close 策略：同步记账形态下=当帧所在连接 close（reason='global-budget'，code 1011 本批维持——1013 归登记）；**分母缺口（N_max/budget 推导）登记下批**（96MB=5×满 close 连接+10 人单次扇出的折衷值，非推导值——诚实标注）。
- check-ecosystem 算式（B13/B18 口径，plan v2 数字勘正）：`resident_cap+maxDocBytes+OUTBOUND_BUDGET(100,663,296B)+基线 ≤ TRIP[api]`——650,505,088B ≤ 786,432,000B，余 ~129.4MiB（常量字面量=提取式兼容）。
- flushDelay=0/flushMaxBytes=1MiB 显式 pin 进 factory 配置（B7）。
- **测试矩阵（v3 修正/plan v2 勘正）**：小配额档 close>drop 不变量/默认档 close=16,973,824（=2×8,454,144+65,536）且 8MB 回显+ack+第二满帧+ack 不误杀（满帧边界）/16MiB doc 抛错（走 ss2>maxPayload 分支）/注入小 budget 触发 budget/2 分支/同步记账 burst（多 stub 同 turn 连发→budget close，峰值 ≤budget+一帧）/真 socket rate-gate 8MB 无 1011。

### R5'：登记升级（不改代码）

1. hocuspocus 4.6.0 回显=带宽成本（服务端每 update 入站 1×+出站 N×，回显 1× 为浪费——v3 口径修正）：不 patch 库私有面；库升级若消除回显阈值保持；上游 issue 候选。
2. flush 参数未 pin→R4b' 已 pin（转入已修）。
3. B14 写门面配额执法→**登记排序强化=per-plan quota 之前**（Y1c-3 域首项）。
4. 1011→1013 语义+客户端映射→登记移交。
5. maxDocBytes 8→2MB 评估（外审建议：p95 300KB/三预算对齐/solo 16s<30s 保活窗）→**登记 Y1c-3 首项设计输入**（产品级内容预算变更，本批不混入）。
6. maxLoadedDocs/放大倍率→登记（无实测倍率禁拍脑袋 cap；下批 soak 实测后定——「实测供数禁人估」纪律）。

### R6'：保活心跳（v3 新增进批——恶化者同批缓解原则；plan v3 勘正：**缓解非根修+有效域边界**）

**动机**（B15）：R4b' close 抬升延长 backlog>1MB 丢 awareness 窗口 → 客户端 30s 无入站帧 4408 强断 → 第二风暴链。本批改动使其恶化，缓解必须同批。

- 形态：全局 10s sweep（unref timer，onApplicationShutdown clear）对全部 active connections `sendStateless('{"type":"heartbeat"}')`——控制组帧型（v3 四档：不前瞻 close+预算豁免）；backlog<close 时照发（B20：客户端任意入站帧重置 30s 计时——provider 内建）。
- 客户端零改动（stateless handler 未知 type 静默忽略已有测试 canvasCollabRuntime.quota.spec.ts:185-189）。
- 心跳节流：backlog 已超 close 的连接本就会被前瞻 close，心跳自然停止（无需特判）。
- **有效域边界（plan v3 登记——FIFO 约束结构性）**：心跳与出站大帧同 WebSocket 顺序队列——**大帧排空 >30s 的链路（如 8MB@1Mbps=64s）心跳排在 8MB 之后，30s 死线先于心跳到达=4408 不可免**。心跳有效域=大帧排空 <30s 的链路+awareness 丢弃窗。**大帧慢链路场景的真根修**=客户端字节流级判活（message 级死线→流级）或 maxDocBytes 2MB（2MB@1Mbps=16s<30s）——登记客户端批/Y1c-3（与 2MB 评估同域）。
- **测试（plan v3 勘正）**：unit（注册/摘除/throw 自摘）+heavy 链路通用例（10s 心跳帧到达客户端——链路通证明）；~~35s 无 4408 真连用例~~（plan v3 删除：pause 停读挡住心跳本身=用例反向证明 B15；fake transport 形态不采=绕 ws 队列测非真实传输）。
- 实现位：collab-heartbeat.ts 独立模块（plan v3——SG 仅 6 行接线守 1238 锚）；register 键=connectedPayload.socketId。

## 3. 门禁与锚影响（v3）

| 门禁 | 影响 | 处置 |
|------|------|------|
| check-collab-module-size | SG 净减行（常量+公式迁出）≥ R6' 心跳增行——**净减核算为硬约束**（1238 锚不动）；**新文件入锚表**：collab-limits.ts ≤120 / collab-outbound-budget.ts ≤150（防倒退语义平移，v2 缺此条） | 无偏离 |
| census ⑤ bufferedAmount 单读点 | budget 同步记账不读 bufferedAmount（tryReserve 用 frame byteLength）；sweep 对账经 SG——**census ⑤ 不扩**（v2 白名单方案废弃） | 无偏离 |
| check-ecosystem | 算式加 OUTBOUND_BUDGET(96MiB) 项+单位口径 B18 | fail-closed |
| verify manifest | heavy 插步 27→28+exclude 机制 | BASELINE_IDS/scripts-node-test 同批 |
| collab-backpressure.spec | 常量退役改 limits+前瞻+同步记账+帧型分支 | 同批重构先红 |
| gateway :49 再导出 | 常量族换名同步；**常量消费 census 独立条目**（不复用 B12 编号——v2 交叉引用错位勘正） | 全仓枚举 |
| vitest.config | exclude 两 heavy 文件（主套件） | 同批 |

## 4. 验收判据（v3）

1. **R1'+R2'**：`rm -rf dist dist-drill` 后两 drill 双绿且 `dist` 不被创建；TEMP-RED=错误注入秒级 exit 1 栈完整+零孤儿+client 全 destroy（注册表审计）；watchdog 注入 exit 2+清理 WARN。
2. **R3'**：yaml 审阅——四 job timeout/concurrency/step 和≤job/ci-notify.yml 独立 workflow（title 幂等+permissions）在位。
3. **R4a'**：长度锚零每轮分配+红门⑧ 桶断言保留+readOnly 补断言+小配额 refill 用例+heavy 真隔离（主套件 exclude 后 api-test 用例数下降、heavy 步覆盖同两文件）。
4. **R4b'+R6'**：limits 矩阵全绿（含满帧边界+小 budget 注入档+同步记账 burst）/心跳 35s 无 4408（heavy pause 用例）/check-ecosystem 新算式 PASS/SG+DR 四文件锚核验/新文件锚在位。
5. **批出口**：本地 verify 28 步×2 轮绿→push→**CI 四 job 全绿（#40 以来首次）**；CI 日志 rate-gate 1011 消失。CI 绿=必要非充分（B14/B15 之外的生产形态归后续批——B15 心跳已入本批）。

## 5. 范围外（显式不做，v3 更新）

- OutboundFlow 队列/mergeUpdates/时间维度滞回（登记候选同前）。
- B14 写门面执法（排序强化登记：per-plan quota 之前=Y1c-3 域首项）。
- 1013 close code/客户端映射（登记移交）。
- **maxDocBytes 8→2MB**（外审三预算对齐建议——产品级内容预算变更：QUOTA_DEFAULTS 锁定+shrink/export UX+客户端 precheck 全按 8MB；登记 Y1c-3 首项设计输入，本批混入搅浑回归面）。
- maxLoadedDocs cap（无实测放大倍率；soak 实测归下批）。
- per-plan quota 接 TeamPlan（本批仅 deriveCollabLimits(quota) 参数化）。
- merge queue/master 硬阻断规则（required checks 既有覆盖，治理深化归后续）。
- Y.Text/z 序/快照/多实例路线项（总目录 v8.3 域）。

## 6. 偏离登记（执行期滚动）

| # | 偏离 | 状态 |
|---|------|------|
| 1 | verify manifest 27→28 步（heavy 插步）+主套件 exclude | 预登记 |
| 2 | check-collab-module-size 锚表新增两行（limits≤120/budget≤150）——锚表结构变更=有意识动作 | 预登记 |
| 3 | concurrency cancel-in-progress：master 中间 commit run 被取代（省 runner 换单人线性流信号取舍） | 预登记 |
| 4 | OUTBOUND_BUDGET=96MB 为折衷值非推导值（N_max 分母缺口登记下批） | 预登记 |
| 5 | ~~census ⑤ 扩白名单~~（v2 预登记，v3 撤回——同步记账不读 bufferedAmount） | 已撤回 |
| 6 | ~~SG 行数锚重标~~（v1 登记，v2 撤回——净减行不改锚；v3 强化=净减≥R6' 增行硬核算） | 已撤回（强化） |
| （执行期新增随批滚动） | | |
