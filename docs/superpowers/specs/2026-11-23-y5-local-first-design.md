# Y5 y-indexeddb + local-first 离线水合设计文档 v2

<!-- doc-status: active | created: 2026-11-23 | v2（ruling 收口版）——唯一有效规则=正文 §0（本头注非指令）；v1 四处丢数据/复活缺陷经终裁勘正，裁定全文见 2026-11-23-y5-local-first-ruling.md -->

- **日期**：2026-11-23。**基线**：master `2ff8f88c`（基线门两笔已推、CI run 143 success、verify full 36/36）。
- **v2 性质**：用户终裁（ruling 2026-11-23——`2026-11-23-y5-local-first-ruling.md`）对 v1 判「不能进 plan」后按其收口。**本 spec 与 ruling 冲突时以 ruling 为准**。
- **v1→v2 四处纠错**（详情见 ruling §1，全部按现码坐实）：①`confirmedPrefix` 序号水位不能表示「服务端已有」（trim 重写 key+远端本地帧交错——改 **serverSV 状态向量**）；②库回放不得标 `origin=provider`（Hocuspocus 当回声丢弃致离线编辑不上行——回放 origin=persistence 实例+`whenSynced` 前不构造 provider）；③授权窗口非 15min 探活（会话真值=7 天：`auth.ts:69` maxAge/`:123` expiresIn——7d 证明落盘）；④库名≠wire docName（`project:<pid>#g<N>` 无 uid 无 schemaVersion——本地库名四维）。
- **E33 客户端 doc 重建划出本批**（ruling §1 末）：keep 不随 update 传输，重建前置 `synced∧unsynced===0` 与离线窗口相反——总目录 Y5 行同步勘正。

---

## §0 唯一有效规则（ruling 收口——冻结）

### 0.1 本地真源（单一 update 日志）

1. 文档字节只放 y-indexeddb 9.0.12 的 **updates 日志**。`local-collab-cache.ts` 的快照记录、per-tab 键、`loadAll` 兼容读**全部删除**；不双写、不留旧读路径。启动时删除 `flowweb:collab:` 前缀的库（**不读取内容**——开发测试无用户数据，撤旧层非迁移）。
2. 策略模块（新文件，命名归 plan）只做策略、不做第二份文档编码：持有 `IndexeddbPersistence` 实例，负责降级闩锁、授权证明、服务端状态向量、diverged 标志、字节闸、清库。零业务逻辑越权面与旧 `local-collab-cache.ts` 同纪律（不自建 provider、不越 `setHydration` 单写者）。
3. **本地库名**（IndexedDB database name）：`flowweb:yjs:<uid>:<pid>:g<generation>:s<schemaVersion>`——四维与现役缓存键 `flowweb:collab:<uid>:<pid>:g<g>:s<s>`（`local-cache-key.ts:14`）同维度。**wire docName 维持 `collabDocNameOf`**（`project:<pid>#g<N>`），服务端协议零改动。
4. **元数据库** `flowweb:yjs-meta`（普通 IndexedDB 非 Y.Doc）两表：`auth`（`uid → { provenAt, expiresAt }`——7d 证明）；`names`（库名登记——供 `indexedDB.databases()` 不可用的浏览器清扫）。
5. 文档库 `custom` store 只放三件（值形=ArrayBuffer/字符串——lib-review §3.7 不能放裸对象）：`serverSV`（上次 healthySync 时的 `Y.encodeStateVector(doc)`）、`writeGrant`（`'read-write'`|`'read'`）、`diverged`（`'1'` 或删除）。

### 0.2 水合次序（六步——回放期 provider 不存在）

1. 会话元数据不完整：维持现有 fail-closed（`initCollab :1998-2000`），不打开本地库，只走服务端。
2. 打开本库 persistence。`whenSynced` 与 `this._db` 拒绝一起做 **10s 竞态**（沿用 `HYDRATION_DEADLINE_BASE_MS` :591）。超时或打开失败：`destroy()` 持久层（关连接**不删数据**）、`onDegrade` 一次、本会话改纯服务端水合；**迟到的成功回调不得再改 doc**。
3. 成功=库内全部 update 已在 doc。撤销栈清空（装载非用户编辑——`armSession` 既有 `getUndoManager()?.clear()` 先例 :2443）。
4. 读 `serverSV`：差分=`Y.encodeStateAsUpdate(doc, serverSV)`；无 `serverSV` 用全量 `encodeStateAsUpdate(doc)`。**差分字节数大于空 `Y.Doc` 编码长度才算有未上行内容**，此时 `markDocUnsyncedDirty` 一次。
5. 然后才 `createProvider`（**加 `forceSyncInterval: 30_000`**——HP 4.8.0 `index.d.ts:346` 实证）+`connectOnce`。上行只走现有 SyncStep2；`authenticated` 里既有 `forceSync()`（:1641）保留。**禁**手工 `mergeUpdates` 成单帧发送、**禁**走 `importLocalBackup`。
6. `provider.isSynced && !hasUnsyncedChanges`：新 state vector 写入 `serverSV`、删 `diverged`、`armSession()` 置 `ready`。

更新监听过滤：`origin === provider` 或 `origin === persistence` 直接返回——不记未上行字节、不置 dirty、不置 diverged；本地用户编辑走现有置位（`mountUnsyncedDirtyTracker` :493-508 判据面扩 persistence）。

### 0.3 编辑权（hydration 第五态 `local`）

1. `canEdit = !terminal && !collabReadOnly && (hydration === 'ready' || hydration === 'local')`（terminal=`wsAuthNotice?.terminal===true`）；`canExecute` 不变（`canEdit ∧ connStatus==='connected' ∧ !writeFrozen`——离线可编辑**不能**发起执行）；`isActiveViewerSession` 仍只认 `ready`。
2. `local` 进入条件全列：库已装载、证明未过期、证明 uid 与库名 uid 相同、`writeGrant==='read-write'`、无 `diverged`、无终态通知。满足→投影到画布+`collabReadOnly=false`+`setHydration('local')`。**进不了 local 但库有内容**：投影+`localCacheReady`+hydration 保持 `failed`，沿用现有只读副本横幅，`canEdit` 假（无权/证明失效=可看不可编）。
3. **7d 证明**：`/api/auth/me` 返回 200 且带 user、或 WS `authenticated` 成功 → 写 `expiresAt = now + 7d`。7 天与 `getSessionCookieOptions().maxAge`（`auth.ts:69`）、`session.expiresIn`（`auth.ts:123`）**同一常量放 `@flowweb/shared`**，api/web 双引用（常量归位，协作协议不动）。网络错误不缩短证明；**仅 HTTP 401 视为会话死亡**。成功登录后 reset。
4. `writeGrant` 只在 `authenticated` scope 上更新（`scope==='read-write'` 写 `'read-write'` 否则写 `'read'`）——从未认证成功的项目无 grant，离线不可编辑。
5. 服务端 `authenticated`/`conn-status`/`doc-status` 后仍按现有公式覆盖 `collabReadOnly`（:1629/:1684/:1725）。**一旦 ready 断线不退回 local**；10s 到点时已 local 留 local（连接条显示重连），仍 pending 才 failed；`completeHydration`/`armSession` 增加 local→ready。
6. 三处 `hydration!=='ready'` 拦截点放行 `local`（编辑+视口；执行仍走 canExecute）：`page.tsx:535` 键盘、`useGroupKeyboard.ts:64`、`viewportPersistence.ts:15`。
7. SyncBanner 新增档 `local-pending`：「离线编辑中，重连后由服务端确认」——优先级在终态鉴权与 diverged 之下、「连接已断开」之上。HTTP 401：`useSessionExpiry.httpExpired` 置位→写成现有终态 `session-expired`（「登录已过期」）——**不另做横幅**。

### 0.4 diverged（文档级）

置位只有两条：服务端宣布只读（`collabReadOnly`）后出现本地 origin update（现 :506 同位）；重连被终态拒绝且当时存在未上行差分。**离线 local 态编辑不置 diverged**。三出边不变：导出（`encodeStateAsUpdate(doc)` 走现有 `.yjs` 导出）/放弃（删本库重进只信服务端）/本会话只读解除且 healthySync（清标志+写 `serverSV`）。**标志已置的冷启动**：装载进 doc 只供导出、**不 connect**（避免已拒内容自动重送）。

### 0.5 字节闸与容量

1. 字节闸：5s tick 上 `encodeStateAsUpdate(doc).byteLength` 对比 `QUOTA_DEFAULTS.maxDocBytes`（8_388_608 单源——`LOCAL_CACHE_MAX_DOC_BYTES` 别名随旧层退役）。超限→`localCacheReady=false`+横幅用现成「内容尚未保存，请导出」。**禁**把每条 update `byteLength` 累加当文档大小（trim 后重复计数）。
2. `navigator.storage.estimate()` 滞回维持 0.8 进/0.6 出。先对已确认当前库调用导出的 `storeState(persistence, true)` 压多标签重复行；仍超则只删「`serverSV` 能覆盖全文、且非当前打开库」的库；**有未上行差分或 diverged 的库不删**。`persist()` 失败或未授权→未同步横幅写明「浏览器可能清掉本地库」（无可靠淘汰事件，不做假检测）。
3. 写失败：全局 `unhandledrejection` 监听只处理 IndexedDB/QuotaExceeded/AbortError 且栈指向 y-indexeddb 的拒绝，闩锁一次 `onDegrade`；其它拒绝原样抛出。打开失败靠 `_db` catch（全局监听非唯一信号）。

### 0.6 清库矩阵

| 场景 | 动作 |
|---|---|
| 换代/schema 变化 | 先导出旧库中有差分或 diverged 的文档再删旧库名；导出失败则不删 |
| 项目删除、forbidden、not-found、团队解散、项目擦除 | 有差分先导出，再按 uid+pid 删 |
| 登出 | `purgeUidCaches` 删该 uid 的 yjs 库+names 登记+auth 证明 |
| session-expired/HTTP 401/unauthenticated | **收编辑权保留库**——`NO_READ_ACCESS_PURGE_REASONS`（:668-678）去掉 `SESSION_EXPIRED` |
| 启动 | 删非当前 generation+schema 的同项目库；删 `flowweb:collab:` 前缀库 |

清库沿用 `deleteDatabaseQuietly`（已处理 onblocked，`local-cache-key.ts:50`）——先 `destroy` 自己的 persistence 再删；blocked 则留下，下次启动按 `databases()` 与 `names` 登记并集扫掉。**不用**库自带 `clearDocument`（无 onblocked）。

### 0.7 多标签与 RPO

多标签**零新增通道**：在线靠 Hocuspocus 收敛；离线两标签各自追加同一库（内存互不可见），重连后服务端取并集；拖拽预览仍 awareness；撤销栈仍各标签 UndoManager——与直写定论一致。

RPO：健康路径丢失上界=**1 条尚未完成的 IndexedDB 事务**（每 update 一事务无去抖——lib-review §1.1），预算 **1s**；trim 失败只多存不丢尾不计入。降级路径：从第一条写失败到用户导出，后续编辑**无持久化承诺**——横幅必须照此写；不把降级路径算进 1s。打开窗口丢失为 0（窗口内不可编辑、provider 未连）。

### 0.8 本批不做

- Web Locks、Leader、文档用 BroadcastChannel（直写定论不变）
- 只读回放当离线编辑模式（D11）
- 读旧 per-tab 快照或把旧快照写进新日志
- **客户端 doc 重建（E33——划出另批）**
- 改 Hocuspocus/协作服务端协议（`forceSyncInterval` 只是客户端构造参数）
- 配置 y-indexeddb 的 500 条 trim（构造函数无此参数——lib-review §2.1）

---

## §1 基线快照（现状锚）

（两报告全锚见 `.superpowers/sdd/2026-11-23-y5-local-first/`：`lib-review.md`=y-indexeddb 9.0.12 源码复核、`baseline-census.md`=web 协作面 census。）

- **canEdit 现判据**：`syncStatus.ts:8-9`（hydration==='ready' 合取）——本批扩 `local` 腿（§0.3）。
- **hydration 状态机**：四态+10s 死线（:591/:2281）+failed 自愈单驱动（:1650）+ready 唯一写点 `armSession`（:2339）——本批增 `local` 态与 local→ready 通行。
- **三拦截点**：`page.tsx:535`、`useGroupKeyboard.ts:64`、`viewportPersistence.ts:15`。
- **7d 事实**：`auth.ts:69`（maxAge=7*24h ms）+`:123`（expiresIn=60*60*24*7）；`useSessionKeepalive.ts:3`=15min 探活间隔（非寿命）。
- **现役键形**：`local-cache-key.ts:14` `flowweb:collab:`——本批退役整层。
- **unsyncedDirty 单源**：WeakSet :172+3s tick 判据 :2215+Σpending>1MB forceSync :433-439——差分才算 dirty（§0.2 步 4）接此链。
- **purge 面**：五触发点+`NO_READ_ACCESS_PURGE_REASONS`（:668-678，含 SESSION_EXPIRED 待移除）+族保全导出先行（:1127-1136）+`deleteDatabaseQuietly` onblocked（:50）。
- **boot 回放现形态**：`Y.applyUpdate(doc, bootSnapshot, provider)` :2133——本批改 persistence 装载（origin=persistence），该形态随旧层退役。
- **y-indexeddb 9.0.12 硬事实**（lib-review）：构造仅 `(name,doc)`；每 docName 一库；trim=500 条+1000ms debounce+不丢尾；全链零 catch+`whenSynced` 失败永悬挂+L1 open 窗口丢帧；无跨标签机制；provider 帧入库（origin 引用判据——帧级不幂等内容级幂等）。

---

## §2 验收标准（可验证锚——红测先行）

**新增先失败测试**（ruling §7 十项）：

1. 冷启动、证明 7d 内、grant=read-write、库有内容 → `hydration==='local'` 且 `canEdit` 真、`canExecute` 假。
2. 证明过期或 grant='read' → 内容可见、`canEdit` 假、库还在。
3. 库回放不置 diverged、不把未上行字节按全历史累加；**相对 serverSV 的差分才置 dirty**。
4. 回放期间 provider 不存在；连上后上行=SyncStep2 差分；大于 `maxTxBytes` 的历史不作为单条 Update 发出。
5. 服务端 synced 后写回的 serverSV 在 reload 后不再把已确认文档标成 dirty。
6. 4401 第二次与 HTTP 401 关编辑权并给出导出、**不删库**；登出删该 uid 的库。
7. 换代删除的是 `flowweb:yjs:...:g<old>:s<schema>`；扫不到旧键形时不得漏删。
8. IDB 打开超时后 persistence 已 destroy，**随后成功回调不得再改 doc**。
9. QuotaExceeded 后 `localCacheReady` 假且降级只发生一次。
10. 键盘与编组快捷键在 `local` 可用；执行入口不可用。

**保留项**：多标签四例（双标签编辑/拖拽预览/undo/离线重连）、TD-19 四场景（换代不符整库删/项目删除/登出全删/启动孤儿清扫——**载体改 yjs 库名族**）、毒帧仍走服务端帧闸（本地库回放 origin=persistence 不上行——上行面只有 SS2 差分）、IndexedDB 淘汰承诺（persist 申请+estimate 滞回+被清明示）、`verify full` 全绿+既有红锚零回归（hydration 状态机族/purge 族/diverged 三出边）。

RPO 数字（1 条未完成事务/1s 预算+降级路径无承诺横幅）随批进 charter 注记。
