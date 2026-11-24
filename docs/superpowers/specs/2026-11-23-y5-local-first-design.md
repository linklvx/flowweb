# Y5 y-indexeddb + local-first 离线水合设计文档 v6

<!-- doc-status: active | created: 2026-11-23 | v6（第三轮评审收口版，2026-11-24 落）——唯一有效规则=正文 §0（本头注非指令）；裁定全文=2026-11-23-y5-local-first-ruling.md（四纠错）+本文 §0.9（v3 B1-B6+v4 A1-A5+v5 A6-A8+换层撤回记档+v6 R1-R4+清库入口对照表，逐锚按现码核实坐实）；v1/v2 的裁决史仅存档不复述 -->

- **日期**：2026-11-23（v3-v6 于 2026-11-24 落笔）。**基线**：master `a9be3fc3`（spec v2+总目录 v13 已推、CI run 144 success）。
- **v6 性质**：第三轮外部评审四根因逐锚核实**全部成立采纳**：**R1** 库名第五段 `:h<historyToken>`（4406 现码清 historyId 后导出失败仍 purge+四元库名旧纪元重放——v5 四桶漏收 4406 与 generation-stale 上跳支两入口；无 receipt 不开库、三合取、导入校验）；**R2** 库内 trim 补丁（destroy 落在途 trim 的 apply 前 del 照删他标签行；「等 trim 再 destroy」不可行——pnpm patchedDependencies 仓内首例）；**R3** 屏障只在 ready 发（现码 provider 存在即发+服务端首句捕获 appliedSeq=回执假真 Durable→执行打空服务端；ready 补发点新增）；**R4** 登出代次进 localStorage `flowweb:auth-epoch`（内存代次只挡本标签；storage 事件跨标签、不新开 BroadcastChannel）。plan 约束九条扩十二条（⑨改库补丁形态+⑩custom store 单通道+⑪persist()+⑫离线媒体不置 failed）。验收补 24-27。
- **v5 性质**：第二轮外部评审四根因逐锚核实：**条 1（换持久层）证伪否决**——「库自带 trim 多标签丢尾」机理不成立（storeState 全链同用一只 readwrite store 句柄，他标签未读键恒在删除范围外；lib-review §2.3 不变量成立；自研「永不压缩」的日志无界增长会拖死 10s 冷装载——选型维持 y-indexeddb 9.0.12，撤回记档 §0.9）；**条 2/3/4 成立采纳**（A6 版本终态三档+4410 移出 purge 表走删除闸/A7 threadsStore 写闸改 canEdit/A8 /me 代次守卫+双时间戳硬性+userSnapshot 白名单+names 写序）。附真保险丝缺口（destroy 后在途 trim 仍 apply-then-del——v6 升格为库补丁 §0.5.4）。
- **v4 性质**：外部评审五缺口（A1-A5）逐锚核实后收口。A1/A2/A4 是 v3 真实缺口（照 v3 写 plan 会在探活证明、换账号开库、自动下载删除上丢离线编辑），A5 触发收窄方向成立，A3 判定为施工钉（内容已在 v3 冻结内，归 plan 约束不进正文）。两处评审措辞勘正一并落入 §0.9。
- **v6 变更面**：§0.1.3 库名五段+historyToken 字符集+无 receipt 不开库+三合取+导入校验、§0.1.4 names/bindings 值域增 historyToken、§0.4 版本换代桶扩 4406+generation-stale 上跳、§0.6 矩阵扩三行（版本终态扩成员/server-restored 维持行/acceptServerRestored 导出闸/4411 sealed）+删除闸入列、§0.3.9 屏障 ready 谓词+armSession 补发点、§0.3.3 localStorage epoch+storage 事件+证明时钟边界钉、§0.5.4 库内 trim 补丁（pnpm patchedDependencies 记档）、§0.9 补 R1-R4 裁定行+清库入口对照表、plan 约束九条改写扩十二条、§2 验收补四条（24-27）。
- **v4 变更面**：§0.1.4 auth 表删除（A1 证明单源=session 行 localDeadline）、§0.3.3 证明写点全列（A1 探活读 body+serverNow 时钟差）、§0.2 步 1 开库前置 uid 校验+binding 键值扩容（A2）、§0.2 步 2 超时禁重开同库名（A5）、§0.5.2 容量自动删改用户触发（A4）、§0.6 删除闸手势化+登出清表补全（A4/A2）、§0.2 步 7 触发收窄（A5）、§0.9 补五缺口裁定行、§2 验收补五条（15-19）。
- **v5 变更面**：§0.2 步 2 超时禁重开理由回归 B4 本义（原截尾机理句作废）+10s 定时器不把已 local 打成 failed、§0.5.2 禁 storeState 理由重锚「调用时机不可控」、§0.4 版本换代桶新行（三档+4410）+purge 表收窄、§0.3.3 代次守卫+双时间戳硬性+差值≤0 删行、§0.3.7 第四处放行点（threadsStore 闸改 canEdit）、§0.1.4 userSnapshot 白名单+names 值域定形+写序 fail-closed、§0.6 版本终态行+删除闸入列、§0.9 补 A6-A8+换层撤回记档+plan 约束⑨、§2 验收补四条（20-23）。
- **v3 性质**：六补丁评审（B1-B6）逐锚核实**全部成立**后收口。六条全是「v2 落地后离线编辑进不了库、重登后送不上去、或被启动清扫删掉」的页面级真实断点——**改完才能写 plan**（v6 即改完态；plan 另行启动，不在本版内）。
- **v2→v3 变更面**：§0.2 步 1 重写（B1 离线元数据=bindings/session 两表）、§0.2 步 2 增废弃 doc（B4）、§0.3 证明改服务端时钟（B3）+canExecute 改挂 hydration（B6）、§0.4 diverged 置位三桶化（B2）、§0.5 禁 storeState+容量只删他库（B5）、§0.6 启动清扫改先导出后删+safeReload 导出失败不删（B5）、§0.8 服务端改动边界勘正（B3 sessionExpiresAt 属授权面）、§0.9 六补丁裁定记录、§2 验收补四条+测试形态约束。
- **三处执行细节校准**（六补丁原文按现码推导不精确处的勘正，已并入正文）：①B6 论证依据改「isSynced/isAuthenticated 布尔 4408 陈旧窗（:1219-1220 注释自认）」非「connected 先于 SS2」；②B3 sessionExpiresAt 载体勘正服务端边界（授权面非协作面）；③B1 bindings 与 fail-closed 写成同一条的两半（在线 fail-closed=链路语义、离线元数据=bindings 载体）。

---

## §0 唯一有效规则（v6——冻结）

### 0.1 本地真源（单一 update 日志）——v2 收口维持，一处扩充

1. 文档字节只放 y-indexeddb 9.0.12 的 **updates 日志**。`local-collab-cache.ts` 的快照记录、per-tab 键、`loadAll` 兼容读**全部删除**；不双写、不留旧读路径。启动时删除 `flowweb:collab:` 前缀的库（**不读取内容**——撤旧层非迁移）。
2. 策略模块（新文件，命名归 plan）只做策略、不做第二份文档编码：持有 `IndexeddbPersistence` 实例，负责降级闩锁、授权证明、服务端状态向量、diverged 标志、字节闸、清库。零业务逻辑越权面与旧层同纪律。
3. **本地库名**：`flowweb:yjs:<uid>:<pid>:g<generation>:s<schemaVersion>:h<historyToken>`（v6 五维——R1 增第五段）。**wire docName 维持 `collabDocNameOf`**（`project:<pid>#g<N>`），协作协议零改动。**个人项目与团队项目同一套 Yjs 文档、同一套库名、同一套权限**（本批不引入项目型分叉）。**historyToken（R1）**：全局 SystemHistory 那一个 id（现例 `h-2026-10-24-a` 形），**不按项目各存一份**；字符集只允许 `[A-Za-z0-9_-]`，不合则本会话不开库。**没有持久化 historyId 时本会话不打开文档库，只做服务端水合；auth-receipt 到达后再用新 token 开库**——此时内存 doc 已是服务端状态，打开的是空库，不是把旧日志灌进去（R1：现码 `handleClientOutdatedRecovery` :908-926 在 4406 清掉 `collab:history-id` 后**导出失败仍 purgePidCaches**——四元库名下旧纪元 update 会在新纪元重放〔注释自书「同代 PITR SS2 复活」〕；第五段让纪元变化=换库，旧库走 §0.6 hold 出口）。**离线开库三合取（R1）**：localStorage 里的 historyId 与 binding 相同、binding.uid 与 session 行相同、（§0.3.5 其余条件）。**导入校验（R1）**：导出文件带 schemaVersion 与 historyToken，不一致则拒绝导入——旧代字节不进新库。
4. **元数据库** `flowweb:yjs-meta`（普通 IndexedDB 非 Y.Doc）**三张表**（v3 四表，v4 删 auth 表——证明单源化 A1）：
   - `names`：库名登记——键=完整库名（含 `:h<token>` 第五段），值 `{ uid, pid, generation, schemaVersion, historyToken, hold }`（v6 值域增 historyToken）；供 `indexedDB.databases()` 不可用的浏览器清扫+hold 标记载体（§0.6）。**写序（v5）：names 先于文档库写入——names 写失败则本会话不开那只库**（无名库=清扫盲区+hold 无处登记，fail-closed）；
   - `session`：**只在 /me 返回 200 且带 user 时写** `{ uid, localDeadline, userSnapshot }`——离线放行路由的凭证+7d 证明唯一载体（expiresAt 不另立 auth 表——v4 勘正：双表各存一份到期时间是冗余双源，单源=session 行；localDeadline 见 §0.3.3）；**userSnapshot 字段白名单（v5）：只存 id、name、email、image、emailVerified、role、phoneNumber、phoneNumberVerified、createdAt、updatedAt——不存 wechatOpenid/wechatUnionid（现码 /me 返回整行 Prisma User 含 openid/unionid，落盘须按白名单裁），不存任何 token**；
   - `bindings`：**只在 fetchProjectMeta 成功且返回 uid 与当前 session 行相同时写**，**键=uid+pid**（v4——v3 裸 pid 键会让换账号浏览器打开上一用户的库：离线路径在 §0.3.5 的 uid 一致性检查发生在开库**之后**，用户 B 会先装载用户 A 的画布再被打回 failed=内容泄漏）；值 `{ uid, generation, schemaVersion, historyToken, name, teamId }`（v4 增 name/teamId——离线壳子顶栏与素材上下文唯一来源；v6 增 historyToken——离线开库三合取之一）——B1 离线调用 initCollab 的元数据载体。
5. 文档库 `custom` store 只放三件（值=ArrayBuffer/字符串）：`serverSV`、`writeGrant`（`'read-write'`|`'read'`）、`diverged`（`'1'` 或删除）。

### 0.2 水合次序（七步——v3 改两处）

1. **元数据来源两半一条**（B1）：**在线路径**维持现有 fail-closed（`initCollab :1998-2000` meta 缺项不开库）；**离线路径**（`/me` 网络失败∧session 行证明未过期）=用 `session.userSnapshot` 放行路由（RequireAuth 不得因网络失败跳登录）+用 `bindings[uid+pid]` 的 { uid, generation, schemaVersion, historyToken, name, teamId } 调用 initCollab 开本地库——**开库前置校验三合取（v6 R1）**：binding.uid 与 session.uid 相同、**localStorage 的 historyId 与 binding.historyToken 相同（§0.1.3）**、其余 §0.3.5 条件（uid 检查提前到开库前，非 v3 的装载后检查）。**禁扫「最新一代」来猜**。**离线窗口边界**：`/me` 返回 200 且 `user:null`、HTTP 401、403、404 **都不许**用 binding 顶上（这些是服务端明确否决，非网络失败）。**binding 开库条件**只认项目请求瞬态失败（无 status、408、429、5xx）；项目 HTTP 401 走现有 `httpExpired` 不开库（v4 勘正：现码 401 与网络失败同落 `ProjectLoadError`——page.tsx fetchProjectMeta 须先看 status 分型）；403/404 走无读权保留不开库。**无 projectId 又离线时停「暂不可用」**，禁止 `createUntitledProject` 造只有本地的空项目（v4 勘正：现码 404 无参路径自动新建，离线形态不得复用）。**无持久化 historyId 时本会话不开文档库只做服务端水合**（§0.1.3——v6 R1）。
2. 打开本库 persistence。`whenSynced` 与 `this._db` 拒绝一起做 **10s 竞态**（沿用 `HYDRATION_DEADLINE_BASE_MS` :591）。超时或打开失败：`destroy()` 持久层（不删数据）+**丢弃该 Y.Doc**（B4——迟到 apply 只能落在废弃实例上，**随后的服务端水合使用新 doc**）、`onDegrade` 一次、本会话改纯服务端水合。**10s 只包住打开和读库**——装载本身是同步事务（lib-review SRC:16-30——promise 链内同步 `Y.transact` 装载，调用方取消标志挡不住这次 apply，故唯一的防护就是废弃 doc 本身），不存在装到一半被定时器打断。**超时后本会话禁止对同一库名再构造 IndexeddbPersistence**（v5 口径回归 B4 本义：迟到 apply 只能留在已废弃的那只 doc 上；下一轮页面加载再开这只库——v4 曾以「storeState 按内存快照截掉未装载尾部」为理由，该机理已被裁定证伪撤回，见 §0.9）。**现有「10s 未 synced 置 failed」定时器不得把已进入 local 的会话打成 failed**（v5：到点仅对 pending 生效，已 local 留 local——与 §0.3.6「10s 到点已 local 留 local」同一钉子的水合侧半边）。
3. 成功=库内全部 update 已在 doc。撤销栈清空（装载非用户编辑）。
4. 读 `serverSV`：差分=`Y.encodeStateAsUpdate(doc, serverSV)`；无 `serverSV` 用全量。**差分字节数大于空 `Y.Doc` 编码长度才算有未上行内容**，此时 `markDocUnsyncedDirty` 一次+**该字节数记入未上行累计**（Σpending——1MB forceSync 门槛才看得见离线攒下的大差分）。
5. 然后才 `createProvider`（**`forceSyncInterval: 30_000`**——HP 4.8.0 `index.d.ts:346`）+`connectOnce`。上行只走现有 SyncStep2；`authenticated` 里既有 `forceSync()`（:1641）保留。**禁**手工 `mergeUpdates` 单帧、**禁** `importLocalBackup`。
6. `provider.isSynced && !hasUnsyncedChanges`：新 state vector 写入 `serverSV`、删 `diverged`、`armSession()` 置 `ready`。
7. **`local → ready` 时若差分非空且 SyncStep1 表明服务端有本端没有的更新，跑一次现有草稿合并异常检测**（两个标签的离线编辑到这一刻才在服务端汇合）。**只有本端差分、服务端无新更新=纯快进，不跑不提示**（v4 A5 收窄：v3 无条件跑会把文档里既存的旧结构异常归因给这次离线合并——误伤面；检测器本身只报真实结构异常不误报干净快进，收窄是语义归因正确化+省跑）。

更新监听过滤：`origin === provider` 或 `origin === persistence` 直接返回——不记未上行字节、不置 dirty、不置 diverged；本地用户编辑走现有置位（`mountUnsyncedDirtyTracker` :493-508 判据面扩 persistence）。

### 0.3 编辑权（hydration 第五态 `local`）——v3 改两处

1. `canEdit = !terminal && !collabReadOnly && (hydration === 'ready' || hydration === 'local')`。
2. **`canExecute` 只认 `hydration === 'ready'`**（B6 勘正论证：`recomputeConnStatus` :1219-1220 注释自认 `isAuthenticated/isSynced` 公开布尔在 4408 形态下陈旧——canExecute 挂可陈旧布尔推导链不如直挂状态门语义），再要求 `connected` 且未冻结。local 态**不可**发起执行（执行会打到还没有这批离线编辑的服务端）。`isActiveViewerSession` 仍只认 `ready`。
3. **7d 证明的服务端时钟**（B3 勘正+v4 A1 补全+v5 代次守卫）：**证明到期时间只写 `/me` 返回的 `sessionExpiresAt`**——禁客户端 `now+7d` 臆造（`session.service.ts:40-48` renewIfDue `age≤1d` 不续期——首日客户端时钟会长于服务器真值；WS authenticated 会 touch DB 但**不重发 cookie**，故 WS 只更新 `writeGrant` 不延长证明）。**客户端存 `localDeadline = Date.now() + (sessionExpiresAt − serverNow)`**（v4 A1：`/me` 响应增 `serverNow`；**禁存服务器绝对时间**——客户端时钟快则证明提前失效、慢则证明长于服务器真值；时钟差换算把证明长度钉死为服务器剩余寿命，客户端时钟偏移零影响）。**响应字段硬性（v5）：user 非空时 `sessionExpiresAt` 与 `serverNow` 必须都在且是毫秒时间戳——缺任一本次不改证明，禁止用 now+7d 补；差值 `sessionExpiresAt − serverNow ≤ 0` 视为会话已死，删 session 行**。**写点=每一次 200 且带 user 的 /me，含 15 分钟探活**（v4 A1 勘误：v3 只说「/me 200 写」但**现码探活不读响应体**——`useSessionKeepalive.ts:12` `void fetch(...).catch(() => {})`，body 从不解析；而 /me 是唯一续期通道（WS 不重发 cookie），探活不读 body 则连开数天后断网刷新，库里证明仍是首开页面的旧到期时间——**进不了 local，B1 断点在 v3 形态下复活**；探活须改读 body 并写 session 行）。**/me 应用收成单函数+内存代次守卫（v5）**：每次请求携带内存代次；**登出先加代再清**（该 uid 文档库+names/session/bindings 三表）——否则登出后在途的探活 200 会把 session 行写回，离线路径把已登出用户重新放进画布（v4 新写点规则与现有 fire-and-forget 探活重叠出的竞态）；**代次不符的响应直接丢弃**。**内存代次只挡本标签（v6 R4 升级：localStorage 键 `flowweb:auth-epoch` 整数）**——标签 B 登出清库时，标签 A 的探活用自己的（未变）内存代次把 /me 200 写回 session 行，且 A 持有 IDB 连接时 B 的 deleteDatabase 被 blocked（lib-review §3.5 onblocked 无挂）；**修法**：登出先把 localStorage epoch 加一、再清该 uid 的文档库和 names/session/bindings；/me 单函数发出时记下 epoch、响应不符即丢不写 session；**其他标签听 storage 事件走同一条登出路径（拆掉协作会话、不写 session）**——storage 事件由登出写动作天然触发，**不新开 BroadcastChannel（这是登录代次不是文档同步通道，§0.7 不做维持）**。`/me` 的会话死亡信号=200 且 `user:null`（`auth.controller.ts` getMe——非 401）+HTTP 401 两档：**删 session 行（含 localDeadline）**。网络错误（无 status、408、429、5xx）不改证明。`SESSION_TTL_MS`（7 天，毫秒）入 `@flowweb/shared`：`auth.ts` maxAge（毫秒现况维持）、`session.expiresIn`（换算秒——`auth.ts:123` 现值）、`session.service.ts` TTL 三处同源引用；**`updateAge`（1d）保持独立常量不并入**。**证明时钟边界（v6 钉）：按正文公式写 localDeadline，页面重新加载后没有可持久的单调钟——禁第二套时钟；该绝对值只在写入那一刻消掉客户端/服务器偏差，之后用户改系统时间仍会提前或推后本地截止；真正的授权边界仍是服务端（过期或 401 走授权中断桶——留库、不置 diverged）**。
4. `writeGrant` 只在 `authenticated` scope 上更新（`scope==='read-write'` 写 `'read-write'` 否则 `'read'`——:1613/:1626 现链挂点）。从未认证成功的项目无 grant，离线不可编辑。
5. `local` 进入条件全列：库已装载、证明未过期、**证明 uid 与库名 uid 相同（v4：开库前已在 §0.2 步 1 前置校验，此处复验——同判据双锚）**、`writeGrant==='read-write'`、无 `diverged`、无终态通知。满足→投影+`collabReadOnly=false`+`setHydration('local')`。**进不了 local 但库有内容**：投影+hydration 保持 `failed`、沿用只读副本横幅（无权/证明失效=可看不可编）。
6. 服务端 `authenticated`/`conn-status`/`doc-status` 后仍按现有公式覆盖 `collabReadOnly`。**一旦 ready 断线不退回 local**；10s 到点已 local 留 local，仍 pending 才 failed；`completeHydration`/`armSession` 增 local→ready。
7. 三处 `hydration!=='ready'` 拦截点放行 `local`（编辑+视口；执行走 canExecute）：`page.tsx:535`、`useGroupKeyboard.ts:64`、`viewportPersistence.ts:15`。**第四处（v5）：threadsStore 写闸**——现码 `attachThreads(doc, () => provider?.isSynced === true)`（`canvasCollabRuntime.ts:2079`）+`threadsStore.ts:294-298` 五写动作闸=attach∧getSynced()∧uid；local 态 provider 已构造但 `isSynced` 恒假→批注静默不写而画布可写=同一 Y.Doc 两套写策略。**getSynced 判据改 canEdit**（local∨ready 且非只读非终态）；执行、生成、上传仍只认 `canExecute`。
8. SyncBanner 新增档 `local-pending`：「离线编辑中，重连后由服务端确认」——优先级在终态鉴权与 diverged 之下、「连接已断开」之上。HTTP 401：`useSessionExpiry.httpExpired` →现有终态 `session-expired` 档，不另做横幅；**B2 勘正：此档属授权中断桶——收编辑权留库，不置 diverged 不删库**。
9. **保存屏障只在 `ready` 发送（v6 R3）**：现码 `sendSaveBarrier`（:224）谓词=provider 对象存在即发——而步 5 在进入 ready **之前**就构造 provider；服务端 `handleStateless`（actor :1904）**首语句纪律同步捕获 `target=appliedSeq`**（任何 await 之前），此时 SS2 还没把离线差分写进服务端文档，回执把 `lastReceiptClientSeq` 推进到不包含这批编辑的序号→`durableCovered()`（:317 判据 `lastReceiptClientSeq >= lastLocalEditSeq`）**假真**→canExecute 恢复后 `ensureDurableBeforeExecution` 误判已覆盖=执行打到还没有这批编辑的服务端。**修法**：`hydration !== 'ready'` 时 sendSaveBarrier 与 pagehide 腿（:341-344）直接返回；clientSeq 在 local 期间照常增加；**进入 ready（armSession）时若 `lastLocalEditSeq > lastReceiptClientSeq` 补发一次**（现码三发送点=800ms/5s 定时器+pagehide+ensureDurable——armSession 无补发点，新增挂点）；验收 22 的「local 不发屏障」按此谓词测，「未认证不发」只是本条前半。

### 0.4 diverged（文档级——四桶化：B2 三桶+v5 版本换代桶）

**置位只有第四桶**。终态拒绝四桶：

| 桶 | 成员 | 动作 |
|---|---|---|
| 授权中断 | session-expired、unauthenticated、HTTP 401、`/me` 200+user:null | **清证明、收编辑权、留库、不置 diverged**。下次登录成功后按现有 SyncStep2 上行 |
| 版本换代 | **schema-outdated、client-version-missing、client-version-invalid（COLLAB_VERSION_TERMINAL_REASONS 三档）+4410 doc-vacuuming（含 `discardLocalCache: true`）+4406 client-outdated+doc-generation-stale 上跳支（handleGenerationStale :878 上跳档→consumeGenerationJump :1072——v6 补列 R1：v5 漏收 4406 与上跳支两入口）**（v5——现码三档在 `NO_READ_ACCESS_PURGE_REASONS`（:672 展开）里，版本对不上直接 purge uid:pid 全部代库=删掉未上行旧代编辑；4410 照 safeReload 现码走也会导出失败仍 purge；**4406 现码 `handleClientOutdatedRecovery` :908-926 导出失败仍 purgePidCaches+清 collab:history-id——库名第五段后旧纪元库换名滞留，走本桶不改自动删**） | **有差分或 diverged → hold+横幅（导出/放弃），走 §0.6 删除闸**；无差分无 diverged → 可删。**`discardLocalCache: true` 不得当删除许可**（那是服务端换代通告，删除权在 §0.6 三合法手里）。旧代编辑不自动并进新文档——schemaVersion/historyToken 本就是库名维度，reload 后新客户端开新库，旧库走 hold 出口。historyId 维持全局单键（localStorage `collab:history-id`——服务端 SystemHistory 栅栏，**不按项目拆**） |
| 无读权 | forbidden、not-found、团队解散、项目擦除 | 有差分先导出，导出成功再按 uid+pid 删 |
| 内容被拒 | 服务端宣布只读（`collabReadOnly`）后又出现本地 origin update；或服务端拒绝写入且当时有差分、**原因不属授权中断与版本换代** | 置 `diverged`。冷启动只装载供导出、不 connect（避免已拒内容自动重送） |

**`SESSION_EXPIRED` 与 `COLLAB_VERSION_TERMINAL_REASONS` 三档继续从 `NO_READ_ACCESS_PURGE_REASONS`（:668-678）移除**（v5：前者授权中断桶、后者版本换代桶——purge 表只剩无读权真成员 forbidden/not-found/team-disbanded/project-erased）。「只读解除∧healthySync 清 diverged」只服务第四桶。**离线 local 态编辑不置 diverged**。三出边不变：导出/放弃（删本库重进）/本会话只读解除且 healthySync。

### 0.5 字节闸与容量——v3 改两处（B5）+v6 库内 trim 补丁（R2）

1. 字节闸：5s tick 上 `encodeStateAsUpdate(doc).byteLength` 对比 `QUOTA_DEFAULTS.maxDocBytes`（8_388_608 单源）。**文档没有新 update 时不重复编码**（5s 是最小间隔非必跑）。超限→`localCacheReady=false`+横幅「内容尚未保存，请导出」。**禁**逐条 `update.byteLength` 累加当文档大小（trim 后重复计数）。
2. `estimate()` 滞回维持 0.8 进/0.6 出。**本批禁应用层调用 `storeState`**（v5 理由重锚：B5 原句「本标签内存快照的删除范围会截掉另一标签已落盘的尾部」经裁定**证伪撤回**——storeState 的 fetchUpdates/getLastKey/add/del 同用一只 readwrite store 句柄，他标签未读到的键恒 ≥ _dbref 落在删除范围外、lib-review §2.3 内容不变量成立；**真实的禁令依据=调用时机不可控**——水合中途或装载未完成时应用不该主动压，且库自带 trim 有已核实的内容不变量兜底，回放成本钉在 ≈500 行+一条快照，应用层无增益）。**配额不足不自动删任何其他库**（v4 A4 勘正：v3「容量不够时只删 serverSV 能覆盖的其他库」——另一标签在 SV 记录之后、尚未同步的尾部 update 会随库被删——**该截尾风险成立但与库 trim 无关**，是应用侧删除范围算不出他库真差分的问题）→ 闩锁降级 + 未同步横幅写明「浏览器可能清掉本地库」（无可靠淘汰事件，不做假检测）。**只有用户点击「清理已同步的其他项目」时**才当场打开候选库、装载后确认相对 serverSV 差分为空且无 diverged（acked 三判据见 §0.6 删除闸）才删。`persist()` 失败或未授权同款横幅。
3. 写失败降级（B4 补丁收窄）：**只认 `QuotaExceededError` 且本会话 persistence 已打开、正处于写入窗口**——闩锁一次 `onDegrade`。打开失败只处理 `_db` 的拒绝（不把全局监听当唯一信号）。**不靠压缩后的包名去匹配栈**。其它 rejection 原样抛出。
4. **库内 trim 补丁（v6 R2——取代 v5 约束⑨的应用层观测形态）**：9.0.12 的 `_destroyed` 只包住 fetchUpdates 的 apply 段；`storeState` 返回的 promise **没有留在实例上、调用方等不到**（lib-review §1.2 全链无引用）。destroy() 落在 apply 之前时，随后的 `del(upperBound)` 仍会执行——删掉本事务已读到、本 doc 还没有 apply 的另一标签的行。**「等在途 trim 跑完再 destroy」不可行**（那次 encode 本身可能就是超时原因；等到 apply 被跳过后再删、丢的还是同一批行）。**钉死 9.0.12，补丁只做一件事：写快照与 del 跟 `_destroyed` 判断放进同一个同步回调，标志已置上就两条请求都不发**；实例随后丢弃，`_dbref` 写脏无碍——下次打开从 0 重读，行都还在。初次打开的 fetchUpdates 本来就不删行，10s 超时路径不依赖本补丁；**补丁防的是离开页面时撞上已开始的 500 条压缩**（验收 24 行为锚）。**补丁载体记档：pnpm `patchedDependencies`+`patches/` 目录（本仓首例——现 package.json 只有 overrides），补丁只动 `storeState` 单函数，锁文件随批提交**。应用层继续禁调 storeState（本节 2 维持）。

### 0.6 清库矩阵——v3 改两处+v4 删除闸手势化（B5+A4 收口：统一删除规则）

| 场景 | 动作 |
|---|---|
| 换代/schema 变化、启动清扫 | 有差分或带 diverged 的库写入 `names` 表 **hold 标记**：留库，横幅给出「导出」和「放弃」（复用现有 diverged 逃生横幅形态——v4 A4：启动与换代都无用户手势，浏览器会拦自动多文件下载，v3「导出成功才删」缺执行机制=永远删不掉且无横幅，离线编辑静默堆积） |
| **版本终态（v5 新行+v6 扩成员）**：schema-outdated/client-version-missing/client-version-invalid、4410 doc-vacuuming（含 `discardLocalCache: true`）、**4406 client-outdated、doc-generation-stale 上跳支（handleGenerationStale :878 上跳档→consumeGenerationJump :1072——v6 R1 补列：v5 漏收两入口）** | **与换代同一删除闸**：有差分或 diverged → hold+横幅（导出/放弃）；`discardLocalCache: true` 不当删除许可。**现码勘误：三档现展开在 `NO_READ_ACCESS_PURGE_REASONS`（:672）、4410 走 safeReload 导出失败仍 purgeForeignCaches、4406 走 handleClientOutdatedRecovery :908-926 导出失败仍 purgePidCaches、generation-stale 上跳走 safeReload('generation') 导出失败仍 purgeForeignCaches——四腿都会删掉未上行旧代编辑，本批移出 purge 表改走本闸**（§0.4 版本换代桶同款；4406 的「新会话在新 receipt 前不开文档库」见 §0.1.3） |
| **server-restored（4410 下跳/generation 下跳）** | **维持现码：不清库、不 reload、只读恢复**（enterServerRestoredRecovery :856-869——§8.1 冻结条款）——**不进版本换代桶** |
| **acceptServerRestoredRecovery（管理员接受，v6）** | 现码 :989-1003 接受后**无条件 purgePidCaches**——本批改：**导出文件已生成才删**（下载失败留库走 hold）；reload 后按 DB 真值 g 重建维持 |
| **4411/4412 resyncFull（拒帧恢复，v6）** | 现码 :809-830 `deleteOwnRecord` 后用新 doc 打开同一缓存——本批改：**被拒字节标 sealed（names 记录）不挂回正在连接的 doc**；sealed 走本闸 hold 同款出口（导出/放弃二选一，用户可见横幅）。**导出文件带 schemaVersion 与 historyToken，对不上拒绝导入**（§0.1.3 导入校验——旧代字节不进新库） |
| 项目删除、forbidden、not-found、团队解散、项目擦除 | 有差分先导出，导出成功再按 uid+pid 删 |
| 登出 | 删该 uid 的 yjs 库+**names/session/bindings 三表该 uid 行**（v4 A2 勘正：v3 漏 session/bindings——残留 binding 指向已清掉的库，同名空库可被离线路径复活；`purgeUidCaches` 语义扩容） |
| session-expired/HTTP 401/unauthenticated/`/me` 200+null | **收编辑权留库**（授权中断桶——B2）；`/me` 200+null **只删 session 行、binding 保留**（同 uid 重登可对上——v4 A2 设计裁定） |
| 启动 | **与换代同一条删除规则**（B5 核心勘正+v4 A4 手势化）：`flowweb:yjs:` 异代库有差分或 diverged → **hold 标记+横幅，不自动下载不自动删**（v2 原文「直接删异代库」作废——离线编辑正落在旧代库里）；`flowweb:collab:` 前缀仍**不读即删**（那是撤旧层） |

**删除何时合法**（v4 A4 统一删除闸——启动、换代、**版本终态四入口与 4410（v5 入列+v6 扩 4406/上跳支）**、safeReload、403、404、团队解散、项目擦除、**acceptServerRestored、4411 sealed（v6 入列）**全部走它）：**acked**（打开该库装载后相对 serverSV 的差分为空且无 diverged）可删；**用户点击导出且文件已生成**可删（下载失败不删）；**用户点击放弃**可删；其余一律不删（导出失败、收集失败、reload 之前、hold 上）。safeReload 在 hold 上只亮横幅不 purge。

**safeReload 现码勘正**：`canvasCollabRuntime.ts:1121` 注释自书「导出失败不阻断 purge+reload」——本批改为**导出失败不删**（「禁静默丢」从尽力义务升格为删除闸）。清库沿用 `deleteDatabaseQuietly`（onblocked 已处理，:50）——先 `destroy` 自己的 persistence 再删；blocked 留下次启动按 `databases()` 与 `names` 并集扫掉。**不用**库自带 `clearDocument`。**换代导出直接读 yjs 库相对 serverSV 的差分**——`collectFamilyDirtyRecords` 旧快照路径随层删除，不留双读。**diverged 第三出边（只读解除∧healthySync）只在本会话、连接还在时存在**；冷启动遇到 diverged：只装载供导出，不 connect，出口=导出或放弃。

### 0.7 多标签与 RPO——维持

多标签零新增通道：在线靠 Hocuspocus 收敛；离线两标签各自追加同一库（内存互不可见），重连后服务端取并集；拖拽预览仍 awareness；撤销栈仍各标签 UndoManager。RPO=1 条未完成 IDB 事务（预算 1s）；降级路径从第一条写失败到用户导出无持久化承诺（横幅照此写）；打开窗口丢失为 0。

**离线窗口的边界**（B1 补丁收口）：**本批不加 PWA 工人缓存**。能工作的离线=页面已打开后断网，或文档/脚本仍在 HTTP 缓存里时刷新。验收 1 必须从画布页走进 local 态，不能只调用带 meta 的 initCollab。

### 0.8 本批不做——v3 一处勘正

- Web Locks、Leader、文档用 BroadcastChannel（直写定论不变）
- 只读回放当离线编辑模式（D11）
- 读旧 per-tab 快照或把旧快照写进新日志
- **客户端 doc 重建（E33——划出另批）**
- 改协作服务端协议（`forceSyncInterval` 只是客户端构造参数）
- 配置 y-indexeddb 的 500 条 trim（构造函数无此参数）
- **PWA 工人缓存/离线壳**（§0.7 边界）
- **勘正（B3）**：v2 原文「服务端任何改动零触碰」收窄为「**协作服务端协议零改动**」——auth `/me` 响应增 `sessionExpiresAt` 字段属授权面非协作面，允许；`SESSION_TTL_MS` 入 shared 属常量归位，允许。

### 0.9 裁定记录（v3 六补丁 B1-B6+v4 五缺口 A1-A5——逐锚核实索引）

| # | 断点 | 现码实锤锚 | 收口 |
|---|---|---|---|
| B1 | 冷启动进不了库 | `AuthProvider.tsx:39` catch→setUser(null)；`RequireAuth.tsx:11` Navigate 登录；`fetchProjectMeta` 兜底 `ProjectLoadError`→page.tsx:185/:198 idle | meta 库增 session/bindings 两表；网络失败+证明未过期才顶上；200+null/401/403/404 不顶 |
| B2 | 过期被当分叉 | v2 §0.4 置位第二条把 session-expired 打进 diverged+§0.4 已置不 connect=重登后永久送不上去 | 三桶化（§0.4）——授权中断只清证明留库 |
| B3 | 证明时钟臆造 | `session.service.ts:40-48` age≤1d 不续；`:24-26` WS 只 touch DB 不重发 cookie；`auth.controller.ts` getMe 死亡信号=200+null | 只写 /me 的 sessionExpiresAt（§0.3）；SESSION_TTL_MS 三处同源；updateAge 独立 |
| B4 | 迟到回放进活文档 | lib-review SRC:16-30 同步装载链；HP esm:775-776 只滤 origin===provider→persistence 帧被当普通 Update 发出超 512KB 闸（doc-protocol.ts:506） | 超时即 destroy+**丢弃该 Y.Doc**、服务端水合用新 doc（§0.2 步 2） |
| B5 | 启动清扫删离线编辑 | v2 §0.6 启动行 vs 换代行自相矛盾；safeReload :1121 导出失败仍 purge；storeState SRC:36-44 无锁截尾 | 统一「先导出成功才删」（§0.6）+禁 storeState（§0.5.2） |
| B6 | 重连瞬间可执行 | `syncStatus.ts:16-17` canExecute 借 canEdit；`recomputeConnStatus` 布尔陈旧窗注释自认 | canExecute 只认 `hydration==='ready'`（§0.3.2） |
| A1 | 证明双源+探活不读 body+绝对时钟 | `useSessionKeepalive.ts:12` 探活 `void fetch(...).catch()` body 从不解析（/me 是唯一续期通道——WS 不重发 cookie）；v3 §0.1.4 auth/session 两表各存 expiresAt；跨机比时钟须 serverNow（§0.3.3） | auth 表删除单源=session 行；`localDeadline=Date.now()+(sessionExpiresAt−serverNow)`；写点含 15min 探活（§0.3.3/§0.1.4） |
| A2 | binding 裸 pid 键+壳字段缺+401 不分型+登出漏表 | 离线开库 uid 检查在装载后（§0.3.5）=换账号先开别人库；fetchProjectMeta catch 只分型 404/403、401 落兜底 ProjectLoadError（page.tsx）；顶栏 name/teamId 唯一来源=fetchProjectMeta 成功路径；v3 登出行漏 session/bindings | 键=uid+pid、值含 generation/schemaVersion/name/teamId、开库前置校验 uid 一致（§0.1.4/§0.2 步 1）；401 不开库走 httpExpired、无 projectId 离线停「暂不可用」（§0.2 步 1）；登出清三表（§0.6） |
| A3 | ready 断线被写成只读 | v3 §0.3.6 已冻结「一旦 ready 断线不退回 local」+现码 authenticated 粘滞注释自认（断连不清 read-write 防 NACK 回退）——**非 spec 缺口，plan 施工钉** | plan 约束⑥：断线后 hydration 保持 ready、collabReadOnly 粘滞；canEdit 真可 canExecute 假；保存屏障按 §0.3.9 ready 谓词（v6 R3 升级——「provider 未认证不发」只是前半） |
| A4 | 启动自动下载+容量自动删他库 | 启动无用户手势浏览器拦自动多文件下载（v3 §0.6 只有规则无机制）；v3 §0.5.2「serverSV 能覆盖即可删」——他标签 SV 记录后的未同步尾部随库被删=storeState 同款截尾 | hold 标记+横幅、删除三合法（acked/导出文件已生成/放弃）全走 §0.6 删除闸；容量只留「用户点击清理」单出边（§0.5.2） |
| A5 | 无条件跑异常检测+超时后重开同库 | v3 §0.2 步 7 无条件跑（旧结构异常归因给干净快进）；超时后切走再切回同项目会再构造 IndexeddbPersistence——storeState 按内存快照截掉未装载 update | 触发收窄「服务端有本端没有的更新∧本端有差分」（§0.2 步 7）；超时后本会话禁再开同库名、迟到 apply 留废弃 doc（§0.2 步 2——v5：理由回归 B4 本义，原截尾机理经裁定证伪撤回） |
| A6 | 版本终态清库绕过删除闸 | `COLLAB_VERSION_TERMINAL_REASONS` 三档（schema-outdated/client-version-missing/client-version-invalid）展开在 `NO_READ_ACCESS_PURGE_REASONS`（:672）；4410 载荷 `discardLocalCache: true`（collab-maintenance.service.ts:193）+safeReload 现码导出失败仍 purge | 三档+4410 移出 purge 表、归 §0.4 版本换代桶+§0.6 删除闸（hold/导出/放弃）；discardLocalCache 不当删除许可；historyId 维持全局单键不按项目拆（§0.4/§0.6） |
| A7 | threadsStore 写闸与 canEdit 分裂 | `canvasCollabRuntime.ts:2079` `attachThreads(doc, () => provider?.isSynced === true)`；`threadsStore.ts:294-298` 五写动作闸=getSynced()——local 态 isSynced 恒假→批注静默不写而画布可写 | threads 写闸改 canEdit（§0.3.7 第四处放行点）；执行/生成/上传仍只认 canExecute |
| A8 | /me 登出-探活竞态 | v4 写点规则「每次 200 带 user 写 session 行」×现有探活 fire-and-forget（useSessionKeepalive.ts:12）+登出清表（AuthProvider.tsx:47-55）重叠——登出后在途 200 把 session 行写回=已登出用户被离线路径重新放进画布 | /me 收成单函数+内存代次；登出先加代再清三表+文档库；代次不符响应丢弃（§0.3.3）；响应双时间戳硬性+差值≤0 删行（§0.3.3）；userSnapshot 白名单不含 wechatOpenid/unionid（§0.1.4）；names 先写后开库、写失败不开（§0.1.4） |
| R1 | 4406 纪元漏收+库名无 history 维 | `handleClientOutdatedRecovery` :908-926 导出失败仍 purgePidCaches+清 collab:history-id（注释自书「同代 PITR SS2 复活」——旧纪元 update 在同一只库里等重放）；generation-stale 上跳支 :878+consumeGenerationJump :1072 导出失败仍 purgeForeignCaches；四元库名无 historyToken | 库名第五段 `:h<historyToken>`（§0.1.3——SystemHistory 全局 id 不按项目拆、字符集 [A-Za-z0-9_-]）；无持久化 historyId 本会话不开文档库、auth-receipt 到达后开空库；4406+上跳支入版本换代桶（§0.4/§0.6）；离线开库三合取（localStorage historyId=binding∧binding.uid=session）；导出文件带 schemaVersion+historyToken、不一致拒绝导入 |
| R2 | destroy 撞在途 trim | 9.0.12 `_destroyed` 只包 apply 段；storeState promise 未挂实例（lib-review §1.2 调用方等不到）；destroy 落在 apply 前→del 照删本事务已读、本 doc 未 apply 的他标签行 | 钉死 9.0.12+库内补丁：快照写/del 与 `_destroyed` 判断同一同步回调、标志置上两请求都不发；`_dbref` 写脏无碍（下次打开从 0 重读）；禁「等在途 trim 再 destroy」；载体=pnpm patchedDependencies（仓内首例记档）——§0.5.4 |
| R3 | 屏障早发假真 Durable | sendSaveBarrier :224 谓词=provider 存在即发（步 5 ready 前已构造 provider）；服务端 actor handleStateless :1904 首语句捕获 appliedSeq（SS2 未落离线差分）；回执推 lastReceiptClientSeq→durableCovered() :317 假真→ensureDurable 误判→执行打到无这批编辑的服务端 | 屏障与 pagehide 腿（:341-344）在 hydration!=='ready' 直接返回；clientSeq 在 local 照常增加；armSession 进 ready 时 `lastLocalEditSeq>lastReceiptClientSeq` 补发一次（现码无此点——新增挂点）——§0.3.9 |
| R4 | 登出代次只在内存 | 标签 B 登出清库时标签 A 探活用自己的（未变）内存代次把 /me 200 写回 session 行；A 持有 IDB 连接时 B 的 deleteDatabase blocked（lib-review §3.5 onblocked 无挂）——用户以为已登出、刷新后进得离线画布 | localStorage 键 `flowweb:auth-epoch`（整数）：登出先 epoch+1 再清该 uid 文档库+三表；/me 发出记 epoch、响应不符即丢；其他标签 storage 事件走同一条登出路径（拆协作会话、不写 session）——不新开 BroadcastChannel（登录代次非文档通道）——§0.3.3 |

**v6 清库入口对照表（R1 附表——plan 必须改道、不得留旧调用）**：

| 入口 | 现码 | 改定后 |
|---|---|---|
| 4406 client-outdated | 清 historyId 后 purgePidCaches，导出失败也删（:908-926） | 旧库 hold；新会话在新 receipt 之前不开文档库（§0.1.3） |
| doc-generation-stale 上跳 / consumeGenerationJump | safeReload('generation') 导出失败仍 purgeForeignCaches（:878/:1072/:1112-1138） | 与 doc-vacuuming 同一删除闸；有差分则 hold |
| server-restored | 不清库、不 reload、只读恢复（:856-869） | **维持**——不进版本换代桶 |
| acceptServerRestoredRecovery | 管理员接受后无条件 purgePidCaches（:989-1003） | 导出文件已生成才删；下载失败留库 |
| 4411 resyncFull | deleteOwnRecord 后用新 doc 再打开同一缓存（:809-830） | 被拒日志标 sealed 不挂回连接中的 doc；放弃或导出成功才删（hold 同款出口） |

**v5 换层评审裁定记档（撤回+选型维持）**：第二轮评审指控「y-indexeddb 自带 storeState 压缩在多标签丢另一标签已落盘尾部」并主张换仓内自研持久层——**逐锚证伪撤回**：storeState 的 fetchUpdates/getLastKey/add/del 同用 fetchUpdates 开头那只 readwrite store 句柄（lib0 `addAutoKey/del` 不另开 transact）；他标签未读到的键恒 ≥ _dbref 落在 `createIDBKeyRangeUpperBound(_dbref, true)` 删除范围外；「删掉的行都已 apply 进本标签 doc 且 encode 进随后快照」内容不变量成立（lib-review §2.3——其 §2.2「add 与 del 各开事务」一句顺带勘误，不变量本身无误）。打开时 `beforeApplyUpdatesCallback` 写的那条快照在 Y5 流程里是空 doc 快照=噪声行非丢失路径。**换层否决**：自研「永不压缩」方案的日志无界增长会把冷装载拖过 10s 死线——恰好杀死离线进 local 的本批目标；y-indexeddb 9.0.12 选型维持。§0.5.2 禁应用层 storeState 的禁令保留但理由重锚为「调用时机不可控」（原截尾机理句作废）。**但评审附带翻出一个真保险丝缺口（plan 约束⑨）**：destroy 置 `_destroyed` 后，在途 storeState 链仍会 apply-then-del（该标志只包住 fetchUpdates 的 apply 段——getLastKey/add/del 全在守卫外）。

**v4 两处评审措辞勘正**（不改变采纳结论）：①「auth 与 session 各写一份会漂」降为「冗余双源」（两表同源同写点不会自发漂，合并是简洁优先）；②「只有自己离线写过也标成冲突」过强（检测器只报真实结构异常，实际误伤面=旧异常归因错误），收窄仍采纳；③评审表格「local 态 provider 尚未创建」不准确——按 §0.2 步 5 provider 在装载后构造，离线 local 下 provider 是已创建未连上，本质判据=服务端未确认，canEdit/canExecute 列不受影响。

**plan 约束十二条**（施工钉死）：①serverSV 在现有 3s healthySync 清 dirty 的同一同步段里编码（每次健康同步都重写非仅首次 armSession），异步写入；**编码抛错就把该文档标成 dirty，不把坏状态向量写进去**。②「有无未上行」=差分>空 doc 编码（同时记入 Σpending——§0.2 步 4）。③字节闸不重复编码（§0.5.1）。④降级只认 QuotaExceeded+写入窗口（§0.5.3）。⑤local→ready 双端有差分才跑草稿合并异常检测（§0.2 步 7）；换代导出直读 yjs 库差分、旧快照路径删（§0.6）。⑥**A3 施工钉**：断线后 hydration 保持 ready、collabReadOnly 粘滞不回收（authenticated 现码注释自认语义）；canEdit 真可 canExecute 假；**保存屏障按 §0.3.9 ready 谓词**（local/断线都不发；批注写走 §0.3.7 同闸）。⑦**A1 单位钉**：`SESSION_TTL_MS` 同源时 `auth.ts:69` maxAge 现值是毫秒、`auth.ts:123` expiresIn 现值是秒——常量取毫秒，expiresIn 处显式 `/1000` 换算。⑧**探活改读 body 不得改变 fire-and-forget 形态**（15min 静默失败仍不炸不提示——只加「200 且带 user 才写 session 行」半边）。⑨**destroy-trim 保险丝改库补丁形态（v6 R2 升级——v5 应用层观测形态作废）**：§0.5.4 库内补丁（快照写/del 与 `_destroyed` 同一同步回调）是唯一防线；**禁「等在途 trim 跑完再 destroy」**；补丁载体=pnpm patchedDependencies+patches/（仓内首例，锁文件随批提交）。⑩**custom store 单通道（v6）**：serverSV/writeGrant/diverged 只用 IndexeddbPersistence 的 get/set/del——**禁止对同一库名再 `indexedDB.open`**（与库自己的 schema 升级撞车）。⑪**首次进 local 后调 `navigator.storage.persist()`**；返回 false 沿用「浏览器可能清掉本地库」横幅。⑫**离线媒体预签名失败不得把 hydration 打成 failed、不得禁掉非媒体字段的编辑**（本批不加 PWA 维持）。

---

## §1 基线快照（现状锚）

（全锚见 `.superpowers/sdd/2026-11-23-y5-local-first/` 两报告；v3/v4/v5/v6 增量锚已内联 §0.9。）

- canEdit 现判据 `syncStatus.ts:8-9`；canExecute 现链 `:16-17`（canEdit∧connected∧!writeFrozen——本批拆开）。
- `recomputeConnStatus` `:1223-1234`——healthy 四合取含 `p.isSynced`；头注 `:1219-1220` 自认布尔 4408 陈旧窗。
- AuthProvider `:34-41`（catch→null）、RequireAuth `:9-13`、fetchProjectMeta 分型（page.tsx:76-101——404/403/兜底三档）。
- `session.service.ts:6-7`（TTL/updateAge 双常量+对齐注释）、`:40-48`（renewIfDue age 判据）；`auth.controller.ts:69-84`（getMe 200+null 形态+cookie 重发）；`auth.ts:69/:123`（maxAge/expiresIn 7d）。
- safeReload `:1107-1145`（导出失败不阻断 purge 现注释——本批勘正）；`collectFamilyDirtyRecords`（local-collab-cache.ts:436——随层删）。
- `NORMAL_FRAME_GATE_BYTES=2×maxTxBytes=512KB`（doc-protocol.ts:506）；HP `documentUpdateHandler` origin 判据（esm:775-776）；y-indexeddb 同步装载（SRC:16-30）。
- y-indexeddb 9.0.12 硬事实（lib-review）：构造仅 `(name,doc)`；每 docName 一库；trim=500 条+1000ms debounce+不丢尾；全链零 catch+`whenSynced` 失败永悬挂+L1 open 窗口丢帧；无跨标签机制；provider 帧入库帧级不幂等内容级幂等。

---

## §2 验收标准（可验证锚——红测先行）

**新增先失败测试**（ruling §7 十项维持）：

1. 冷启动、证明 7d 内、grant=read-write、库有内容 → `hydration==='local'` 且 `canEdit` 真、`canExecute` 假。
2. 证明过期或 grant='read' → 内容可见、`canEdit` 假、库还在。
3. 库回放不置 diverged、不把未上行字节按全历史累加；相对 serverSV 的差分才置 dirty。
4. 回放期间 provider 不存在；连上后上行=SyncStep2 差分；大于 `maxTxBytes` 的历史不作为单条 Update 发出。
5. 服务端 synced 后写回的 serverSV 在 reload 后不再把已确认文档标成 dirty。
6. 4401 第二次与 HTTP 401 关编辑权并给出导出、**不删库、不置 diverged**；登出删该 uid 的库（v6 注：跨标签形态按验收 27 的 localStorage epoch 腿测）。
7. 换代删除的是 `flowweb:yjs:...:g<old>:s<schema>:h<old>`；扫不到旧键形时不得漏删。
8. IDB 打开超时后 persistence 已 destroy，**随后的成功回调不得再改 doc**。
9. QuotaExceeded 后 `localCacheReady` 假且降级只发生一次。
10. 键盘与编组快捷键在 `local` 可用；执行入口不可用。

**六补丁验收补四条**（v3 增）：

11. **壳子能加载、`/me` 网络失败、binding 与未过期证明都在 → 进入 local、不跳登录、不新建空项目**。
12. **session-expired 之后重新登录：差分经 SyncStep2 上行、库还在、diverged 仍为假**。
13. **打开超时之后，迟到的 apply 进不了已用于服务端水合的那个 doc**。
14. **旧代库有差分且导出失败 → 旧库还在**（safeReload 与启动清扫同规则）。

**五缺口验收补五条**（v4 增）：

15. **探活 /me 返回新的 sessionExpiresAt 后 localDeadline 随之后移；客户端时钟与 serverNow 相差两小时时证明长度仍等于服务器剩余寿命**。
16. **同一浏览器先用户 A 后用户 B，B 离线打开同一 pid 不开 A 的库**（binding 键 uid+pid+开库前置校验）。
17. **项目请求 5xx、证明未过期、binding uid 一致 → 进入 local、teamId 与项目名来自 binding、不新建项目；HTTP 401 不进入**。
18. **本会话已 ready 再断网：canEdit 真、canExecute 假、新编辑写入当前库**（A3 施工钉的行为锚）。
19. **只有本端差分、服务端无新更新：不出现草稿合并异常提示；双方都有新更新：出现现有非阻断提示**。

**第二轮评审验收补四条**（v5 增）：

20. **（回归锚——库自带 trim 的内容不变量）一个标签写过 500 条并完成一次库自带 trim 之后，另一标签已经落盘的尾部 update 仍在库里，重开后都能回放**（§0.9 撤回记档的行为锚——锁死「trim 丢尾」旧指控不再回归）。
21. **版本终态（schema-outdated/client-version-missing/client-version-invalid 任一）或 4410 discardLocalCache: true 时，库内有差分则库还在，只有用户导出成功或点放弃才删**（A6）。
22. **local 态可以写入一条批注并出现在该 Y.Doc 里；生成和执行入口仍不可用，保存屏障不发送**（A7）。
23. **登出与一次在途的 /me 200 重叠后，session 行不在（代次守卫）；客户端时钟与 serverNow 差两小时时证明长度仍等于服务器剩余寿命**（A8——后半与验收 15 同判据，代次腿为新增）。

**第三轮评审验收补四条**（v6 增）：

24. **destroy 落在在途 trim 的 apply 之前：另一标签已落盘的行还在，重开能回放**（R2 库补丁的行为锚——§0.5.4）。
25. **4406 之后旧库还在，新会话不开这只库（新 receipt 到达前只做服务端水合）**（R1）。
26. **provider 已构造但尚未 ready：屏障零发送；进入 ready 后补发一次且序号盖住 local 期间的编辑**（R3——§0.3.9 谓词）。
27. **标签 B 登出与标签 A 的在途 /me 200 重叠：session 行不在（localStorage epoch 跨标签守卫）**（R4）。

**测试形态约束**：验收 1/11 必须从画布页组件路径走进 local（AuthProvider/RequireAuth/fetchProjectMeta 全链），**不得**只单测一个已带 meta 的 initCollab。

**保留项**：多标签四例（双标签编辑/拖拽预览/undo/离线重连）、TD-19 四场景（载体改 yjs 库名族）、毒帧仍走服务端帧闸、IndexedDB 淘汰承诺、`verify full` 全绿+既有红锚零回归。RPO 数字（1 条未完成事务/1s+降级路径无承诺横幅）随批进 charter 注记。
