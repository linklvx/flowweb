# Y5 离线水合收口裁定（可施工）

- 日期：2026-11-23
- 对象：`docs/superpowers/specs/2026-11-23-y5-local-first-design.md` v1
- 输入：`.superpowers/sdd/2026-11-23-y5-local-first/lib-review.md`（y-indexeddb 9.0.12）、`baseline-census.md`，以及 `canvasCollabRuntime.ts` / `syncStatus.ts` / `local-cache-key.ts` / `auth.ts` 现码
- 判定：**v1 不能进入 plan。** 下面是按仓库现状收死的施工基线。开发测试无用户数据，旧本地库删除不读。

## 1. 判定

v1 的方向对：单一 update 日志、水合完成前不开放编辑、不上 Web Locks、换代先导出再删库、写失败走降级闩锁。

不能施工的原因是四条会丢数据或把已拒内容重新送上服务器的设计，加上总目录里还没写死的行为：

1. `confirmedPrefix` 序号水位不能表示「服务端已有」。trim 会重写 key，远端帧和本地帧交错，序号前缀不是一份状态。按它只回放尾部，离线编辑会缺前缀或在压缩后被快照吞掉。
2. 把库回放标成 `origin=provider`，Hocuspocus 会当成自己的回声丢掉，离线编辑不再上行。库自己的回放 origin 是 persistence 实例（lib-review §4.1）。
3. 授权窗口写成「`/api/auth/me` 成功后再加 15 分钟」。15 分钟是保活间隔（`useSessionKeepalive.ts`）。会话真值是 7 天：`auth.ts` `expiresIn` 与 cookie `maxAge` 都是 7 天。冷启动离线时 `/me` 打不出去，不把证明落盘就永远进不了可编辑态，Y5 目标落空。
4. 库名若等于 wire docName `project:<pid>#g<N>`，则没有 uid、没有 schemaVersion。同一浏览器换账号会打开别人的库。schema 升级而 generation 不变时，旧 update 并进新文档，这是总目录实验 D 的同一类静默投毒。现役键是 `flowweb:collab:<uid>:<pid>:g<g>:s<s>`。

总目录 Y5 行里的客户端 doc 重建（E33）不进本批。`keep` 不随 update 传输，刷新后新 doc 再 apply 就会丢掉 keep 内容；y-indexeddb 存的是 update，不是堆。重建的前提是已同步且无未上行，和离线窗口相反。放进本批会在离线时拆掉正在编辑的 doc。

## 2. 本地真源

文档字节只有 y-indexeddb 9.0.12 的 updates 日志。删除 `local-collab-cache.ts` 的快照记录、per-tab 键、`loadAll` 兼容读。不双写，不保留一个发布期的旧读路径。

启动时删除名为 `flowweb:collab:` 前缀的库，不读取内容。这是撤掉旧层，不是迁移。

策略模块只做策略，不再做第二份文档编码。它持有 `IndexeddbPersistence`，负责降级闩锁、授权证明、服务端状态向量、diverged 标志、字节闸和清库。

库名（IndexedDB database name，不是 wire docName）：

`flowweb:yjs:<uid>:<pid>:g<generation>:s<schemaVersion>`

wire docName 维持 `collabDocNameOf`：`project:<pid>#g<N>`。服务端协议不动。

元数据库 `flowweb:yjs-meta`（普通 IndexedDB，不是 Y.Doc）两张表：

- `auth`：`uid → { provenAt, expiresAt }`
- `names`：库名登记，给 `indexedDB.databases()` 不可用的浏览器做清扫

`custom` store 只放本库三件，值用 ArrayBuffer / 字符串（lib-review §3.7，不能放裸对象）：

- `serverSV`：上次 `healthySync` 时的 `Y.encodeStateVector(doc)`
- `writeGrant`：`'read-write'` 或 `'read'`
- `diverged`：`'1'` 或删除

## 3. 水合次序

`HocuspocusProvider` 继续 `autoConnect: false`。在 `whenSynced` 结束之前不构造 provider，避免装载帧被当成在线 Update 发出去。

1. 会话元数据不完整：维持现有 fail-closed，不打开本地库，只走服务端。
2. 打开本库 persistence。`whenSynced` 与 `this._db` 的拒绝一起做 10 秒竞态（沿用 `HYDRATION_DEADLINE_BASE_MS`）。超时或打开失败：`destroy()` 持久层（关连接，不删数据），`onDegrade` 一次，本会话改为纯服务端水合。禁止让迟到的 `whenSynced` 再往已经连上的 doc 里补帧。
3. 成功则库内全部 update 已在 doc 里。撤销栈清空（装载不是用户编辑）。
4. 读 `serverSV`。差分 = `Y.encodeStateAsUpdate(doc, serverSV)`；没有 `serverSV` 时用全量 `encodeStateAsUpdate(doc)`。差分字节数大于空 `Y.Doc` 的编码长度，才算有未上行内容，并 `markDocUnsyncedDirty` 一次。
5. 然后才 `createProvider`（加上 `forceSyncInterval: 30_000`）并 `connectOnce`。上行只走现有 SyncStep2。`authenticated` 里已有的 `forceSync()` 保留。禁止再手工 `mergeUpdates` 后当单帧发送，禁止走 `importLocalBackup`。
6. `provider.isSynced && !hasUnsyncedChanges`：把新的 state vector 写入 `serverSV`，删掉 `diverged`，`armSession()` 把 hydration 置为 `ready`。

更新监听在回放 origin 上直接返回：`origin === provider` 或 `origin === persistence`。这两类不记未上行字节、不置 dirty、不置 diverged。本地用户编辑仍走现有置位。

## 4. 编辑权

hydration 增加 `'local'`。`failed` 仍是「没有可编辑的本地会话」。

`local` 的全部条件：库已装载、证明未过期、证明的 uid 与库名 uid 相同、`writeGrant === 'read-write'`、无 `diverged`、无终态通知。满足则投影到画布，`collabReadOnly = false`，`setHydration('local')`。

证明的写法：`/api/auth/me` 返回 200 且带 user，或 WS `authenticated` 成功时，写入 `expiresAt = now + 7d`。7 天与 `getSessionCookieOptions().maxAge`、`session.expiresIn` 同一常量，放到 `@flowweb/shared`，api 与 web 都引用。这是常量归位，不改协作协议。网络错误不缩短证明。HTTP 状态 401 才视为会话死亡。

`writeGrant` 只在 `authenticated` 的 scope 上更新：`scope === 'read-write'` 写 `'read-write'`，否则写 `'read'`。从没成功认证过的项目没有 grant，离线不可编辑。

```ts
canEdit = !terminal && !collabReadOnly && (hydration === 'ready' || hydration === 'local')
```

`canExecute` 保持 `canEdit && connStatus === 'connected' && !writeFrozen`。离线可编辑不能发起执行。`isActiveViewerSession` 仍只认 `ready`。

下列三处现在用 `hydration !== 'ready'` 挡交互，`local` 要放行编辑与视口，执行仍走 `canExecute`：

- `page.tsx` 键盘处理
- `useGroupKeyboard.ts`
- `viewportPersistence.ts`

服务端 `authenticated` / `conn-status` / `doc-status` 之后仍按现有公式覆盖 `collabReadOnly`。一旦 `ready`，断线不退回 `local`。

进不了 `local` 但库里有内容：投影、`localCacheReady`、hydration 保持 `failed`，沿用现有只读副本横幅，`canEdit` 为假。这是无权或证明失效时的查看，不提供编辑。

10 秒到点时：已经是 `local` 就留在 `local`，连接条显示正在重连；仍是 `pending` 才 `failed`。`completeHydration` / `armSession` 增加 `local → ready`。

横幅新增一档 `local-pending`，文案：「离线编辑中，重连后由服务端确认」。优先级在终态鉴权和 diverged 之下，在「连接已断开」之上。

HTTP 401：`useSessionExpiry.httpExpired` 置位时，写成现有终态通知 `session-expired`（登录已过期）。编辑权随之关掉。不新做一套横幅。成功登录后 `reset`。

## 5. diverged、字节、清库

diverged 是文档级标志，写入 `custom.diverged`。

置位只有两条：服务端已经宣布只读（`collabReadOnly`）之后又出现本地 origin 的 update；重连被终态拒绝且当时存在未上行差分。离线 `local` 态的编辑不置 diverged。

三出边与现在的 boot-diverged 一致：

- 导出：`encodeStateAsUpdate(doc)` 走现有 `.yjs` 导出
- 放弃：删本库，重新进入，只信服务端
- 本会话内只读解除且 `healthySync`：清标志并写 `serverSV`

标志已置的冷启动：装载进 doc 只供导出，不 `connect`。避免把已拒内容自动再送一遍。

字节闸：5 秒 tick 上已有的 `encodeStateAsUpdate(doc).byteLength` 对比 `LOCAL_CACHE_MAX_DOC_BYTES`（8_388_608，单源）。超限则 `localCacheReady=false`，横幅用现成的「内容尚未保存，请导出」。禁止把每条 update 的 `byteLength` 累加当文档大小（trim 后会重复计数）。

`navigator.storage.estimate()` 滞回维持 0.8 进入、0.6 退出。先对已确认的当前库调用导出的 `storeState(persistence, true)` 压掉多标签重复行；仍超则只删「`serverSV` 能覆盖全文、且不是当前打开库」的库。有未上行差分或 diverged 的库不删。`persist()` 失败或未授权时，未同步横幅写明浏览器可能清掉本地库。没有可靠的淘汰事件，不做假检测。

写失败：监听 `unhandledrejection`，只处理 IndexedDB / QuotaExceeded / AbortError 以及栈里指向 y-indexeddb 的拒绝，闩锁一次 `onDegrade`，其它拒绝原样抛出。打开失败靠 `_db` 的 catch，不把全局监听当唯一信号。

清库继续用现有 `deleteDatabaseQuietly`（已处理 `onblocked`），不用库自带的 `clearDocument`。先 `destroy` 自己的 persistence，再删。blocked 则留下，下次启动按 `databases()` 与 `names` 登记的并集扫掉。

| 场景 | 动作 |
|---|---|
| 换代 / schema 变化 | 先导出旧库中有差分或 diverged 的文档，再删旧库名。导出失败则不删 |
| 项目删除、forbidden、not-found、团队解散、项目擦除 | 有差分则先导出，再按 uid+pid 删 |
| 登出 | `purgeUidCaches` 删该 uid 的 yjs 库、登记和 auth 证明 |
| session-expired / HTTP 401 / unauthenticated | 收编辑权，保留库。从 `NO_READ_ACCESS_PURGE_REASONS` 去掉 `SESSION_EXPIRED` |
| 启动 | 删非当前 generation+schema 的同项目库；删 `flowweb:collab:` 前缀 |

多标签不新增通道。在线收敛只走 Hocuspocus。离线时两标签各自追加同一库，内存互不可见，重连后由服务端并集。拖拽预览仍是 awareness。撤销栈仍是各标签自己的 UndoManager。这与直写定论一致。

## 6. RPO

健康路径：y-indexeddb 每条 update 一次事务，没有编辑去抖（lib-review §1.1）。丢失上界是 **1 条尚未完成的 IndexedDB 事务**，预算 **1 秒**。trim 失败只多存不丢尾（lib-review §2.3），不计入 RPO。

降级路径：从第一条写失败到用户导出，内存里的后续编辑没有持久化承诺。横幅必须这样写。不把降级路径算进 1 秒。

打开窗口的丢失为 0：窗口内不可编辑，provider 尚未连接。

## 7. 验收

在 v1 已列的多标签四例、TD-19 四场景、毒帧、淘汰和 verify full 之外，先写这些失败测试：

1. 冷启动、证明在 7 天内、grant 为 read-write、库有内容 → `hydration==='local'` 且 `canEdit` 真；`canExecute` 假。
2. 证明过期或 grant 为 read → 内容可见、`canEdit` 假，库还在。
3. 库回放不置 diverged、不把未上行字节按全历史累加；相对 `serverSV` 的差分才置 dirty。
4. 回放期间 provider 不存在；连上后上行是 SyncStep2 差分。大于 `maxTxBytes` 的历史不会作为单条 Update 发出。
5. 服务端 `synced` 后写回的 `serverSV` 在 reload 后不再把已确认文档标成 dirty。
6. 4401 第二次与 HTTP 401 关编辑权并给出导出，且不删库。登出删该 uid 的库。
7. 换代删除的是 `flowweb:yjs:...:g<old>:s<schema>`，扫不到旧键形时不得漏删。
8. IDB 打开超时后 persistence 已 destroy，随后的成功回调不得再改 doc。
9. QuotaExceeded 后 `localCacheReady` 变假且只发生一次降级。
10. 键盘与编组快捷键在 `local` 可用；执行入口不可用。

## 8. 本批不做

- Web Locks、Leader、文档用 BroadcastChannel
- 只读回放当作离线编辑模式
- 读旧 per-tab 快照，或把旧快照写进新日志
- 客户端 doc 重建（E33）
- 改 Hocuspocus / 协作服务端协议；`forceSyncInterval` 只是客户端构造参数
- 配置 y-indexeddb 的 500 条 trim（构造函数没有这个参数）
