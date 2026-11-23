# Y5 y-indexeddb + local-first 离线水合设计文档 v3

<!-- doc-status: active | created: 2026-11-23 | v3（六补丁收口版，2026-11-24 落）——唯一有效规则=正文 §0（本头注非指令）；裁定全文=2026-11-23-y5-local-first-ruling.md（四纠错）+本文 §0.9 六补丁（B1-B6，逐锚按现码核实坐实）；v1/v2 的裁决史仅存档不复述 -->

- **日期**：2026-11-23（v3 于 2026-11-24 落笔）。**基线**：master `a9be3fc3`（spec v2+总目录 v13 已推、CI run 144 success）。
- **v3 性质**：六补丁评审（B1-B6）逐锚核实**全部成立**后收口。六条全是「v2 落地后离线编辑进不了库、重登后送不上去、或被启动清扫删掉」的页面级真实断点——**改完才能写 plan**（本版即改完态；plan 另行启动，不在本版内）。
- **v2→v3 变更面**：§0.2 步 1 重写（B1 离线元数据=bindings/session 两表）、§0.2 步 2 增废弃 doc（B4）、§0.3 证明改服务端时钟（B3）+canExecute 改挂 hydration（B6）、§0.4 diverged 置位三桶化（B2）、§0.5 禁 storeState+容量只删他库（B5）、§0.6 启动清扫改先导出后删+safeReload 导出失败不删（B5）、§0.8 服务端改动边界勘正（B3 sessionExpiresAt 属授权面）、§0.9 六补丁裁定记录、§2 验收补四条+测试形态约束。
- **三处执行细节校准**（六补丁原文按现码推导不精确处的勘正，已并入正文）：①B6 论证依据改「isSynced/isAuthenticated 布尔 4408 陈旧窗（:1219-1220 注释自认）」非「connected 先于 SS2」；②B3 sessionExpiresAt 载体勘正服务端边界（授权面非协作面）；③B1 bindings 与 fail-closed 写成同一条的两半（在线 fail-closed=链路语义、离线元数据=bindings 载体）。

---

## §0 唯一有效规则（v3——冻结）

### 0.1 本地真源（单一 update 日志）——v2 收口维持，一处扩充

1. 文档字节只放 y-indexeddb 9.0.12 的 **updates 日志**。`local-collab-cache.ts` 的快照记录、per-tab 键、`loadAll` 兼容读**全部删除**；不双写、不留旧读路径。启动时删除 `flowweb:collab:` 前缀的库（**不读取内容**——撤旧层非迁移）。
2. 策略模块（新文件，命名归 plan）只做策略、不做第二份文档编码：持有 `IndexeddbPersistence` 实例，负责降级闩锁、授权证明、服务端状态向量、diverged 标志、字节闸、清库。零业务逻辑越权面与旧层同纪律。
3. **本地库名**：`flowweb:yjs:<uid>:<pid>:g<generation>:s<schemaVersion>`（四维）。**wire docName 维持 `collabDocNameOf`**（`project:<pid>#g<N>`），协作协议零改动。**个人项目与团队项目同一套 Yjs 文档、同一套库名、同一套权限**（本批不引入项目型分叉）。
4. **元数据库** `flowweb:yjs-meta`（普通 IndexedDB 非 Y.Doc）**四张表**（v2 两表+B1 增两张）：
   - `auth`：`uid → { provenAt, expiresAt }`——7d 证明（expiresAt 只写 /me 返回的 sessionExpiresAt——§0.3）；
   - `names`：库名登记——供 `indexedDB.databases()` 不可用的浏览器清扫；
   - `session`：**只在 /me 返回 200 且带 user 时写** `{ uid, expiresAt, userSnapshot }`——B1 离线放行路由的凭证；
   - `bindings`：**只在 fetchProjectMeta 成功时写** `pid → { uid, generation, schemaVersion }`——B1 离线调用 initCollab 的元数据载体。
5. 文档库 `custom` store 只放三件（值=ArrayBuffer/字符串）：`serverSV`、`writeGrant`（`'read-write'`|`'read'`）、`diverged`（`'1'` 或删除）。

### 0.2 水合次序（七步——v3 改两处）

1. **元数据来源两半一条**（B1）：**在线路径**维持现有 fail-closed（`initCollab :1998-2000` meta 缺项不开库）；**离线路径**（`/me` 网络失败∧session 表证明未过期）=用 `session.userSnapshot` 放行路由（RequireAuth 不得因网络失败跳登录）+用 `bindings[pid]` 的 { uid, generation, schemaVersion } 调用 initCollab 开本地库。**禁扫「最新一代」来猜**。**离线窗口边界**：`/me` 返回 200 且 `user:null`、HTTP 401、403、404 **都不许**用 binding 顶上（这些是服务端明确否决，非网络失败）。
2. 打开本库 persistence。`whenSynced` 与 `this._db` 拒绝一起做 **10s 竞态**（沿用 `HYDRATION_DEADLINE_BASE_MS` :591）。超时或打开失败：`destroy()` 持久层（不删数据）+**丢弃该 Y.Doc**（B4——迟到 apply 只能落在废弃实例上，**随后的服务端水合使用新 doc**）、`onDegrade` 一次、本会话改纯服务端水合。**10s 只包住打开和读库**——装载本身是同步事务（lib-review SRC:16-30——promise 链内同步 `Y.transact` 装载，调用方取消标志挡不住这次 apply，故唯一的防护就是废弃 doc 本身），不存在装到一半被定时器打断。
3. 成功=库内全部 update 已在 doc。撤销栈清空（装载非用户编辑）。
4. 读 `serverSV`：差分=`Y.encodeStateAsUpdate(doc, serverSV)`；无 `serverSV` 用全量。**差分字节数大于空 `Y.Doc` 编码长度才算有未上行内容**，此时 `markDocUnsyncedDirty` 一次+**该字节数记入未上行累计**（Σpending——1MB forceSync 门槛才看得见离线攒下的大差分）。
5. 然后才 `createProvider`（**`forceSyncInterval: 30_000`**——HP 4.8.0 `index.d.ts:346`）+`connectOnce`。上行只走现有 SyncStep2；`authenticated` 里既有 `forceSync()`（:1641）保留。**禁**手工 `mergeUpdates` 单帧、**禁** `importLocalBackup`。
6. `provider.isSynced && !hasUnsyncedChanges`：新 state vector 写入 `serverSV`、删 `diverged`、`armSession()` 置 `ready`。
7. **`local → ready` 时若差分非空，跑一次现有草稿合并异常检测**（两个标签的离线编辑到这一刻才在服务端汇合）。

更新监听过滤：`origin === provider` 或 `origin === persistence` 直接返回——不记未上行字节、不置 dirty、不置 diverged；本地用户编辑走现有置位（`mountUnsyncedDirtyTracker` :493-508 判据面扩 persistence）。

### 0.3 编辑权（hydration 第五态 `local`）——v3 改两处

1. `canEdit = !terminal && !collabReadOnly && (hydration === 'ready' || hydration === 'local')`。
2. **`canExecute` 只认 `hydration === 'ready'`**（B6 勘正论证：`recomputeConnStatus` :1219-1220 注释自认 `isAuthenticated/isSynced` 公开布尔在 4408 形态下陈旧——canExecute 挂可陈旧布尔推导链不如直挂状态门语义），再要求 `connected` 且未冻结。local 态**不可**发起执行（执行会打到还没有这批离线编辑的服务端）。`isActiveViewerSession` 仍只认 `ready`。
3. **7d 证明的服务端时钟**（B3 勘正）：**证明到期时间只写 `/me` 返回的 `sessionExpiresAt`**——禁客户端 `now+7d` 臆造（`session.service.ts:40-48` renewIfDue `age≤1d` 不续期——首日客户端时钟会长于服务器真值；WS authenticated 会 touch DB 但**不重发 cookie**，故 WS 只更新 `writeGrant` 不延长证明）。`SESSION_TTL_MS`（7 天，毫秒）入 `@flowweb/shared`：`auth.ts` maxAge、`session.expiresIn`（换算秒）、`session.service.ts` TTL 三处同源引用；**`updateAge`（1d）保持独立常量不并入**。`/me` 的会话死亡信号=200 且 `user:null`（`auth.controller.ts:72`——非 401）+HTTP 401 两档：**删证明**。网络错误不改证明。
4. `writeGrant` 只在 `authenticated` scope 上更新（`scope==='read-write'` 写 `'read-write'` 否则 `'read'`——:1613/:1626 现链挂点）。从未认证成功的项目无 grant，离线不可编辑。
5. `local` 进入条件全列：库已装载、证明未过期、证明 uid 与库名 uid 相同、`writeGrant==='read-write'`、无 `diverged`、无终态通知。满足→投影+`collabReadOnly=false`+`setHydration('local')`。**进不了 local 但库有内容**：投影+hydration 保持 `failed`、沿用只读副本横幅（无权/证明失效=可看不可编）。
6. 服务端 `authenticated`/`conn-status`/`doc-status` 后仍按现有公式覆盖 `collabReadOnly`。**一旦 ready 断线不退回 local**；10s 到点已 local 留 local，仍 pending 才 failed；`completeHydration`/`armSession` 增 local→ready。
7. 三处 `hydration!=='ready'` 拦截点放行 `local`（编辑+视口；执行走 canExecute）：`page.tsx:535`、`useGroupKeyboard.ts:64`、`viewportPersistence.ts:15`。
8. SyncBanner 新增档 `local-pending`：「离线编辑中，重连后由服务端确认」——优先级在终态鉴权与 diverged 之下、「连接已断开」之上。HTTP 401：`useSessionExpiry.httpExpired` →现有终态 `session-expired` 档，不另做横幅；**B2 勘正：此档属授权中断桶——收编辑权留库，不置 diverged 不删库**。

### 0.4 diverged（文档级——三桶化，B2 收口）

**置位只有第三桶**。终态拒绝三桶：

| 桶 | 成员 | 动作 |
|---|---|---|
| 授权中断 | session-expired、unauthenticated、HTTP 401、`/me` 200+user:null | **清证明、收编辑权、留库、不置 diverged**。下次登录成功后按现有 SyncStep2 上行 |
| 无读权 | forbidden、not-found、团队解散、项目擦除 | 有差分先导出，导出成功再按 uid+pid 删 |
| 内容被拒 | 服务端宣布只读（`collabReadOnly`）后又出现本地 origin update；或服务端拒绝写入且当时有差分、**原因不属授权中断** | 置 `diverged`。冷启动只装载供导出、不 connect（避免已拒内容自动重送） |

`SESSION_EXPIRED` 继续从 `NO_READ_ACCESS_PURGE_REASONS`（:668-678）移除。「只读解除∧healthySync 清 diverged」只服务第三桶。**离线 local 态编辑不置 diverged**。三出边不变：导出/放弃（删本库重进）/本会话只读解除且 healthySync。

### 0.5 字节闸与容量——v3 改两处（B5）

1. 字节闸：5s tick 上 `encodeStateAsUpdate(doc).byteLength` 对比 `QUOTA_DEFAULTS.maxDocBytes`（8_388_608 单源）。**文档没有新 update 时不重复编码**（5s 是最小间隔非必跑）。超限→`localCacheReady=false`+横幅「内容尚未保存，请导出」。**禁**逐条 `update.byteLength` 累加当文档大小（trim 后重复计数）。
2. `estimate()` 滞回维持 0.8 进/0.6 出。**本批禁 `storeState` 调用**（B5：无锁多标签下本标签内存快照的删除范围会截掉另一标签已落盘的尾部——当前库的重复行留给 y-indexeddb 自己的 trim）。容量不够时**只删**「不是当前打开库、`serverSV` 能覆盖全文、没有 diverged」的**其他库**；有未上行差分的库不删。`persist()` 失败或未授权→未同步横幅写明「浏览器可能清掉本地库」（无可靠淘汰事件，不做假检测）。
3. 写失败降级（B4 补丁收窄）：**只认 `QuotaExceededError` 且本会话 persistence 已打开、正处于写入窗口**——闩锁一次 `onDegrade`。打开失败只处理 `_db` 的拒绝（不把全局监听当唯一信号）。**不靠压缩后的包名去匹配栈**。其它 rejection 原样抛出。

### 0.6 清库矩阵——v3 改两处（B5 收口：统一删除规则）

| 场景 | 动作 |
|---|---|
| 换代/schema 变化 | 旧代库**相对它自己的 serverSV 有差分或带 diverged → 先导出、导出成功才删**；导出失败留下次启动再试 |
| 项目删除、forbidden、not-found、团队解散、项目擦除 | 有差分先导出，导出成功再按 uid+pid 删 |
| 登出 | `purgeUidCaches` 删该 uid 的 yjs 库+names 登记+auth 证明 |
| session-expired/HTTP 401/unauthenticated/`/me` 200+null | **收编辑权留库**（授权中断桶——B2） |
| 启动 | **与换代同一条删除规则**（B5 核心勘正）：`flowweb:yjs:` 异代库有差分或 diverged → 导出成功才删（v2 原文「直接删异代库」作废——离线编辑正落在旧代库里，重连拿到新 generation 时会被启动清扫删掉）；`flowweb:collab:` 前缀仍**不读即删**（那是撤旧层） |

**safeReload 现码勘正**：`canvasCollabRuntime.ts:1121` 注释自书「导出失败不阻断 purge+reload」——本批改为**导出失败不删**（「禁静默丢」从尽力义务升格为删除闸）。清库沿用 `deleteDatabaseQuietly`（onblocked 已处理，:50）——先 `destroy` 自己的 persistence 再删；blocked 留下次启动按 `databases()` 与 `names` 并集扫掉。**不用**库自带 `clearDocument`。**换代导出直接读 yjs 库相对 serverSV 的差分**——`collectFamilyDirtyRecords` 旧快照路径随层删除，不留双读。

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

### 0.9 v3 六补丁裁定记录（逐锚核实索引）

| # | 断点 | 现码实锤锚 | 收口 |
|---|---|---|---|
| B1 | 冷启动进不了库 | `AuthProvider.tsx:39` catch→setUser(null)；`RequireAuth.tsx:11` Navigate 登录；`fetchProjectMeta` 兜底 `ProjectLoadError`→page.tsx:185/:198 idle | meta 库增 session/bindings 两表；网络失败+证明未过期才顶上；200+null/401/403/404 不顶 |
| B2 | 过期被当分叉 | v2 §0.4 置位第二条把 session-expired 打进 diverged+§0.4 已置不 connect=重登后永久送不上去 | 三桶化（§0.4）——授权中断只清证明留库 |
| B3 | 证明时钟臆造 | `session.service.ts:40-48` age≤1d 不续；`:24-26` WS 只 touch DB 不重发 cookie；`auth.controller.ts:72` 死亡信号=200+null | 只写 /me 的 sessionExpiresAt（§0.3）；SESSION_TTL_MS 三处同源；updateAge 独立 |
| B4 | 迟到回放进活文档 | lib-review SRC:16-30 同步装载链；HP esm:775-776 只滤 origin===provider→persistence 帧被当普通 Update 发出超 512KB 闸（doc-protocol.ts:506） | 超时即 destroy+**丢弃该 Y.Doc**、服务端水合用新 doc（§0.2 步 2） |
| B5 | 启动清扫删离线编辑 | v2 §0.6 启动行 vs 换代行自相矛盾；safeReload :1121 导出失败仍 purge；storeState SRC:36-44 无锁截尾 | 统一「先导出成功才删」（§0.6）+禁 storeState（§0.5.2） |
| B6 | 重连瞬间可执行 | `syncStatus.ts:16-17` canExecute 借 canEdit；`recomputeConnStatus` :1219-1220 布尔陈旧窗注释自认 | canExecute 只认 `hydration==='ready'`（§0.3.2）——论证勘正为陈旧布尔窗非 connected 时序 |

**plan 约束五条**（施工钉死）：①serverSV 在现有 3s healthySync 清 dirty 的同一同步段里编码（每次健康同步都重写非仅首次 armSession），异步写入；**编码抛错就把该文档标成 dirty，不把坏状态向量写进去**。②「有无未上行」=差分>空 doc 编码（同时记入 Σpending——§0.2 步 4）。③字节闸不重复编码（§0.5.1）。④降级只认 QuotaExceeded+写入窗口（§0.5.3）。⑤local→ready 差分非空跑草稿合并异常检测（§0.2 步 7）；换代导出直读 yjs 库差分、旧快照路径删（§0.6）。

---

## §1 基线快照（现状锚）

（全锚见 `.superpowers/sdd/2026-11-23-y5-local-first/` 两报告；v3 增量锚已内联 §0.9。）

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
6. 4401 第二次与 HTTP 401 关编辑权并给出导出、**不删库、不置 diverged**；登出删该 uid 的库。
7. 换代删除的是 `flowweb:yjs:...:g<old>:s<schema>`；扫不到旧键形时不得漏删。
8. IDB 打开超时后 persistence 已 destroy，**随后的成功回调不得再改 doc**。
9. QuotaExceeded 后 `localCacheReady` 假且降级只发生一次。
10. 键盘与编组快捷键在 `local` 可用；执行入口不可用。

**六补丁验收补四条**（v3 增）：

11. **壳子能加载、`/me` 网络失败、binding 与未过期证明都在 → 进入 local、不跳登录、不新建空项目**。
12. **session-expired 之后重新登录：差分经 SyncStep2 上行、库还在、diverged 仍为假**。
13. **打开超时之后，迟到的 apply 进不了已用于服务端水合的那个 doc**。
14. **旧代库有差分且导出失败 → 旧库还在**（safeReload 与启动清扫同规则）。

**测试形态约束**：验收 1/11 必须从画布页组件路径走进 local（AuthProvider/RequireAuth/fetchProjectMeta 全链），**不得**只单测一个已带 meta 的 initCollab。

**保留项**：多标签四例（双标签编辑/拖拽预览/undo/离线重连）、TD-19 四场景（载体改 yjs 库名族）、毒帧仍走服务端帧闸、IndexedDB 淘汰承诺、`verify full` 全绿+既有红锚零回归。RPO 数字（1 条未完成事务/1s+降级路径无承诺横幅）随批进 charter 注记。
