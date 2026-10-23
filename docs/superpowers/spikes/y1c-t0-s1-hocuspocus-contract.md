# Y1c T0-S1 spike 结论：Hocuspocus 4.6.0 apply 顺序契约（九验收+行为锁）

- **日期**：2026-10-24（plan v1.7 Task 0 spike S1）
- **交付物**：`apps/api/src/modules/collab/collab-hocuspocus-apply-order-contract.spec.ts`（13 用例，主池 vitest，全绿；见 §运行结果）
- **性质**：SPIKE——零生产代码改动；测试工件+本文档。本套件=T9 CollabProjectActor 的回归面底座；任何 4.7.x 升级若改变下列任一被锁时序=本套件先红。
- **引证路径约定**：以下 `esm:NNN` 指 `apps/api/node_modules/@hocuspocus/server/dist/hocuspocus-server.esm.js`（symlink→`node_modules/.pnpm/@hocuspocus+server@4.6.0_y-protocols@1.0.7_yjs@13.6.32__yjs@13.6.32/node_modules/@hocuspocus/server/dist/hocuspocus-server.esm.js`，`version="4.6.0"` @ esm:776）；`provider:NNN` 指 `@hocuspocus/provider/dist/hocuspocus-provider.esm.js`（4.6.0）；`common:NNN` 指 `@hocuspocus/common/dist/hocuspocus-common.esm.js`；`sync.js:NN` 指 `y-protocols/sync.js`（1.0.7）；`yjs.mjs:NNNN` 指 `yjs/dist/yjs.mjs`（13.6.32）。生产锚：`gateway:NNN`/`factory:NNN`/`SG:NNN`/`DR:NNN` 指 `apps/api/src/modules/collab/` 下 `collab.gateway.ts`/`collab-server.factory.ts`/`collab-session-guard.service.ts`/`collab-doc-registry.service.ts`。

## 0. 结论速览

| 验收 | 结论 | 处置 |
|---|---|---|
| ① | 按原文断言成立（幂等重放零事件+恰一 SyncStatus） | asserted-as-written |
| ② | 按原文断言成立（含发送者回声 no-op+字节乘法） | asserted-as-written |
| ③ | gate 侧按原文；**库基线两项发现（F-1/F-2）**——4411 映射+截断细节=T9 | adjusted-because-finding（仅措辞面；断言按现存管线） |
| ④ | 库侧按原文（幂等/零二次广播/每连接 ACK）；in-flight promise map=actor 语义 | asserted-as-written（库侧）+ deferred-to-T9（actor 侧） |
| ⑤ | 按原文（含「库检查在 beforeSync 后」实证）；gate 必须自判 readOnly | asserted-as-written |
| ⑥ | 按原文（真 provider 双端零串扰） | asserted-as-written |
| ⑦ | 按原文（load 档独立+装载期 store/onChange 结构性零调用） | asserted-as-written |
| ⑧ | 静态 census 门——本套件零运行时断言（⑦′ 提供运行时对照面） | deferred-to-T9（census 工作面） |
| ⑨ | **库基线与验收文字相反（F-3）：connection-origin 恒触发防抖 store**——T0 断真值+翻转点常量 | adjusted-because-finding（T9 翻转） |

**版本裁定**：`@hocuspocus/server|provider|common` **4.6.0 exact pin 维持确认**。九验收所依赖的全部库级时序在 4.6.0 实测成立（含 F-1/F-2/F-3 三项主发现+F-4/F-5 两项 nuance——均为 gate/生产侧设计约束，非库版本缺陷）。4.7.x（2026-09-09 起 4.7.0/4.7.1 已发布、changelog 无 errorHandler 修复——plan v1.7 背景注记）**不经本套件重跑不得升级**；本套件即 4.7.x 行为锁门。

## 1. 逐验收结论

### ① 合法帧：gate pre-apply→库内重放零额外 update 事件→恰一次 SyncStatus(true) — 成立

**断言**（spec 用例①，双形态）：
- 无 gate 基线：库自 apply 产恰一 update 事件（connection 档）+恰一 SyncStatus(true)。
- T9 形态（harness gate 在 beforeSync 内以 `origin={source:'connection',connection,gate:true}` 预 apply）：`update:gate` 恰一；**库内重放（同字节 readUpdate）零额外 update 事件**（`docUpdates.connection===0`）；恰一 SyncStatus(true)；WAL 台账恰一帧（bytes+SHA-256 对得上原帧）；顺序锁 `beforeSync:update < update:gate < onChange:gate`。

**证据**：
- 库 apply 入口+origin：esm:288-291（Update 路径 `readUpdate(..., {source:'connection', connection})`）、esm:277-280（SS2 路径同 origin）。
- ACK 无条件：esm:292（Update）/esm:281（SS2）——apply（含 no-op）后必发 SyncStatus(true)。
- **幂等重放零事件的机制**：yjs.mjs:3126-3134 `writeUpdateMessageFromTransaction`——deleteSet 空且 afterState==beforeState ⇒ `hasContent=false`；yjs.mjs:3346-3354——update 事件仅在 hasContent 时 emit。探针+用例双重实证（含删除帧重放亦零事件）。
- beforeSync 位置：esm:251-254（先于 readOnly 检查/apply/ACK）。

**发现/修正**：无——plan 假设全部成立。
**T9 收紧**：harness gate 替换为真 CollabProjectActor（submit/drain+fsync+WAL 真文件）；SyncStatus 语义升级为三档 ACK（Applied/Spooled/Durable）时，本用例「恰一」改按档位断言。

### ② 广播到全部连接恰一次（含发送者回声）+echo 字节数=连接数×帧字节 — 成立

**断言**（spec 用例②）：3 连接同 doc；A 写一帧后每连接恰收到 1 条 Sync/Update 消息、三连接字节全等、总 echo 字节=3×单帧字节；发送者 A 收回声后 apply=no-op（A 的 doc 事件恰 1=本地用户写，回声零增量——零 UI 副作用）；服务端恰一 update 事件+恰一 onChange。

**证据**：
- **broadcastUpdate 不传 filter**：esm:689-691（vs `broadcast(encode, filter)` 的 filter 形参 esm:658-670）——发送者必收回声。spec v5.4 §1.9 源码实证（esm:658-670/689）复核一致。
- 同 messageAddress 单缓冲广播：esm:661-669（连续同地址连接复用同一 buffer）——三连接字节全等的机制。
- 广播时序：`handleUpdate`（esm:677-688）→ `flushDelay===false` 才即时广播；生产/本 harness 均 `flushDelay:0`（factory:72）⇒ pendingUpdates 缓冲+setImmediate 冲刷（esm:702-715）。
- 客户端 no-op：回声内容已在 A 的 doc ⇒ yjs hasContent=false（同①）⇒ 零事件。

**发现**：**F-4（nuance，非冲突）**：`flushDelay:0`（生产 pin 值）下，同一事件循环回合内处理的多帧会被 `mergeUpdates` 合并成**一条**广播消息（esm:729-733）——「广播恰一次」的精确语义是**每冲刷窗一次**；单帧=恰一次（本用例形态）。T9 的「一帧恰一次广播」验收由 actor 逐帧 resolve 语义承载，届时广播源从库冲刷窗切到 actor（库广播仍存在——T9 需明确 suppress 或接受双通道；本用例届时按 actor 口径收紧）。
**T9 收紧**：断言源切 actor 广播通道；echo 字节断言保留为库回声面。

### ③ 坏帧：gate 拒→close 4411 无 SyncStatus(true)+WAL 截断+doc 不变 — gate 侧成立；库基线两项发现

**断言**（spec 用例③/③′/③″ 三面）：
- ③ gate 拒（真解析验证失败→`webSocket.close(4411)` 先行+`throw {code:4411}` 兜底——生产 hardClose 形态）：客户端观测 **ws close code 4411/reason 'frame-malformed'**；无 SyncStatus(true)；doc 不变；WAL 零追加；零广播；顺序锁 `beforeSync:update < gate-reject`。
- ③′ **库基线（无 gate）**：坏帧 apply 错误被 y-protocols 内吞——连接不关、**SyncStatus(true) 照发**、doc 不变、零广播。
- ③″ **库裸 throw 路径（throw 不 hardClose）**：客户端收到 app 级 CLOSE 消息（仅 reason 串）而 **raw ws 不关**（1.5s 观测窗零 close 帧）；doc 级连接已拆（onDisconnect=1）。

**证据**：
- **F-1（库不可拒坏帧）**：`readUpdate = readSyncStep2`（sync.js:105）；readSyncStep2 内建 `try { Y.applyUpdate } catch { console.error('Caught error while handling a Yjs update', ...) }`（sync.js:76-85）——错误吞掉不上抛；esm:288-292 的 SyncStatus(true) 在 readUpdate 返回后**无条件**发送。实测：截尾真 update 字节（`Y.applyUpdate` 抛 'Unexpected end of array'/RangeError）经库路径→连接存活+ACK true+doc 不变。
- **F-2（close code 投递路径）**：beforeSync throw → `Connection.processMessages` catch（esm:468-476）→ `Connection.close({code: e.code??4205, reason})`（esm:418-426）——该方法只发**app 级 CLOSE 数据消息**（`writeCloseMessage(event?.reason)`——**reason 串，无 code 字段**）并 `messageQueue.length=0`（同连接后续帧清空）；**raw ws 不 close**。客户端（provider:454-463）收到 CLOSE 后合成 `{code:1000, reason}` 事件。⇒ `throw.code`（4411/4205 均然）**到不了客户端 ws close 帧**——码权威投递必须 `webSocket.close(code, reason)` 先行（生产 SG:707-714 hardClose 已按此实现；本 spike 运行复证其先例 T0 探针②「throw 路径客户端 30s 僵尸零 close」的库侧根因）。
- 库默认 close 码：`ResetConnection={code:4205}`（common:56-58）；无 `code` 数字属性的 throw→4205。
- beforeSync 先于库 apply/ACK：esm:251 vs esm:288-292——「无 SyncStatus(true)」成立的原因。

**plan 假设修正**：③ 原文「坏帧→gate 抛错→close 4411」隐含两层已被实证钉死：(a) close 4411 **不是**库默认路径（默认=app 级 CLOSE+ws 悬挂；4411 需 gate 主动 hardClose——生产模式已如此，T9 沿用）；(b) 「WAL 截断至 appliedSeq」=T9 actor 崩溃恢复语义（fsync/段文件），T0 结构等价=「坏帧从不入账」（台账只含 gate 受理帧——③ 断言 wal 恒 0 增量）。「4413/4411 分档映射」随 T9 gate 落地，本套件断言的管线（webSocket.close 先行+throw 兜底+清队列）即其载体。
**T9 收紧**：4413 档位映射用例；WAL 真文件截断恢复演练（T13 故障矩阵）；close 码→resolveCloseAction 分档消费面。

### ④ 重复帧：SHA-256 命中 → in-flight await → 一个 walSeq+两 ACK 均在 fsync 后 — 库侧成立；actor 语义=deferred

**断言**（spec 用例④/④′）：
- ④ applied 后同字节重放：零新 update 事件+**零二次广播**（观察者仍恰 1 条）+WAL 零追加（SHA-256 命中计数）+恰一 SyncStatus(true)（库对重复帧无条件 ACK——esm:292）。
- ④′ 并发同字节双连接（A/B 同 tick 连发同字节帧）：**恰一 update 事件**（先到者真 apply、后到者幂等 no-op——次序无关同果）+WAL 恰一条（=T9「一个 walSeq」的库侧前提）+**双 ACK**（A/B 各恰一 SyncStatus(true)）+**单次广播**（每连接恰 1 条——第二帧无 update 事件⇒pendingUpdates 无追加）。

**证据**：幂等机制同①（yjs hasContent）；ACK 无条件 esm:292；广播仅由 update 事件驱动 esm:677-688（no-op 事件不存在⇒无第二广播）。
**发现/修正**：无库侧冲突。**「in-flight 时 await 原帧 fsync+apply 完成后放行」「两 ACK 均在 fsync 后」「原帧失败重复帧同错」=T9 actor（in-flight promise map）语义——库侧零对应物**（库无去重、无在飞协调、无失败传播；gate 拒帧=close 连接，不存在「失败后重复帧继承同错」的通道——那是 actor 内部队列语义）。本套件锁定的库侧前提（单 apply/单广播/双 ACK/幂等）即 actor 叠加的底座。
**T9 收紧**：actor 落地后在同套件追加真 actor 用例：同字节双连接→恰一 walSeq+两 ACK 均在 fsync 完成后 resolve（时序断言 fsync 完成时间戳）；原帧 fsync 失败→重复帧同错（错误传播）。

### ⑤ readOnly 短路+SS1 零 WAL+SS2/Update 双路径 — 成立（含关键顺序实证）

**断言**（spec 用例⑤/⑤′）：
- VIEWER 连接（onAuthenticate 置 `connectionConfig.readOnly=true`——SG:587 同款）发合法 Update：**beforeSync 已被调用**（counter+1——「库检查在 beforeSync 后」的运行实证）→库短路=零 apply+**SyncStatus(false)**+doc 不变+零广播+零 WAL；harness gate 侧 readOnly 短路先行（DR guardSyncFrame ①分层镜像）⇒gate 预 apply 零发生。
- VIEWER 带新内容 SS2 连接：SyncStatus(false)+服务端 doc 不变。
- SS1 路径零 WAL：空客户端全握手后台账恒空（SS1 零判；空 SS2=noop 档不入账）。
- SS2/Update 双路径：带内容客户端经 SS2 入账（`beforeSync:ss2`+`update:gate`+WAL+广播达他端）；已同步连接经 Update 入账（`beforeSync:update`+WAL）。

**证据**：
- readOnly 检查位置：esm:284-286（Update→SyncStatus(false) 不 apply）、esm:265-275（SS2→`Y.snapshotContainsUpdate` 比对→true/false，不 apply——**readOnly SS2 语义与 Update 不同**：内容已含=true ACK、新内容=false）；均**在 beforeSync（esm:251）之后**。
- readOnly 落点：`ClientConnection.handleQueueingMessage` 认证后读 `connectionConfig.readOnly`（esm:934）+`createConnection` 传入（esm:1054）。
- SS1 帧处理：esm:256-262（readSyncStep1 仅回 SV——零 apply 零事件）。

**发现/修正**：**F-5（T9 设计约束）**：因库 readOnly 检查在 beforeSync 之后，**T9 gate 预 apply 必须自判 readOnly**（否则 VIEWER/writeFreeze/超配额帧会被 gate 先 apply——恰是要防的写）。生产 guardSyncFrame ①层已按此序（DR:727-745）；本 harness 镜像之。writeFreeze/超配额与 VIEWER 同走 readOnly 面（SG applyWriteFreeze 直写 conn.readOnly——冻终权威同源），T0 不单列运行时用例（ readOnly 机制单一实证即覆盖三者短路面）。
**T9 收紧**：writeFreeze/quota 冻结态端到端用例（现生产已有 collab-quota-gate.spec 族——T9 换轨 actor 后复用）。

### ⑥ awareness 路径不受影响 — 成立

**断言**（spec 用例⑥，真 HocuspocusProvider 双端）：A `setAwarenessField`→B awareness 收到（真 provider 双端）；`onAwarenessUpdate` 触发；**beforeSync/doc update/WAL/onStoreDocument 全零增量**（防抖窗后 store 仍 0）。

**证据**：awareness 消息走 `MessageReceiver.apply` 的 Awareness 分支（esm:196-214：scratch doc+`beforeHandleAwareness` 钩子+`applyAwarenessUpdate`）；**beforeSync 在 readSyncMessage 内（esm:251）——awareness 分支根本不经过**；onAwarenessUpdate 接线 esm:1518-1529；awareness 广播 esm:635-641/671-673（同 broadcast 无 filter——发送者也收自身 awareness 回声，与②同构，客户端 awareness 幂等）。
**发现/修正**：无。
**T9 收紧**：无必要（本用例即终态形态——actor 不触碰 awareness 面）。

### ⑦ onLoadDocument 产 update 但零 WAL 帧 — 成立（结构性保证）

**断言**（spec 用例⑦/⑦′）：
- ⑦：装载源 doc 经库回调 applyUpdate→`docUpdates.load` 恰一（origin=null→load 档）→客户端收到内容（SS2 内容面）；**onChange 全档 0+onStoreDocument 0**（防抖窗后仍 0）；WAL 零；顺序锁 `update:load < 首个 beforeSync:*`。
- ⑦′ server-direct：`openDirectConnection().transact`→origin `{source:'local'}`（local 档）→`onChange:local`+**防抖 store 触发**（skipStoreHooks 缺省 false）+gate/WAL 零。

**证据**：
- 装载回调：esm:1477-1480（`applyUpdate(document, ...)`——**缺省 origin**；yjs transact 缺省 origin=null：yjs.mjs:3397）。
- **装载期 store/onChange 零调用的结构性根因**：`document.onUpdate(handleDocumentUpdate)` 在 `isLoading=false` **之后**才接线（esm:1486-1490）——装载产生的 update 事件只到 `Document.handleUpdate`（构造器接线 esm:510）的 broadcast 面（首连接尚未注册——esm:830-874 createDocument 先于 createConnection，广播空转），**到不了 onChange/store 链**（`shouldSkipStoreHooks` 对 null-origin 返回 false 本会触发 store——但 handleDocumentUpdate 未接线=结构性短路）。
- origin 枚举（T9 枚举 gate|connection|load|import|maintenance|server-direct 的 T0 子集）：本 harness `docUpdates` 分桶 gate/connection/load/local（local≙server-direct；import/maintenance=T9-only 档——本档位预留即计数器结构，「仅 server-direct serving 写告警」=T9 在此枚举上落告警）。
- DirectConnection：esm:1125-1176（transact origin `{source:'local', context}` @esm:1138-1143；disconnect→storeDocumentHooks 立即+可能 unload @esm:1145-1174）。
- 卸载钩子名复核：`beforeUnloadDocument`（esm:1581）——无 `onUnloadDocument`（spec v5.4 §1.9 第三实证复核一致）。

**发现**：无冲突；⑦′ 实证补充——**local 档写会触发防抖 store**（区别于装载档）⇒ 任何 serving 期 DirectConnection 业务写在 store 链上**可观测**（见⑧）。
**T9 收紧**：load 档断言不变；actor 化后「产 update 但零 WAL 帧」语义升级为「装载=PG 前缀重建不进 WAL」（装载面从 hook 迁 actor 读路径时复用本用例骨架）。

### ⑧ serving 期业务 doc 写经 DirectConnection=0（静态门） — 本套件零运行时断言（按控制器裁定归 census 工作面）

**与运行时套件的关系**：⑧ 是静态 census 门（allowlist=load/replay/maintenance/readCanvas/withDoc 读路径——withDoc:78 在役 readCanvas/shrink/export）。本套件不承载其断言；但 ⑦′ 提供**运行时对照面**：DirectConnection 写的特征签名=`docUpdates.local`+1+`onChange:local`+1+防抖 store 触发+beforeSync/WAL 零——T9 时若 census 门需要在运行时交叉验证（serving 期出现 local 档业务写=violation），本 harness 的 local 档计数器即为现成探针（origin 枚举已按 T9 枚举预留分桶）。
**T9 收紧**：census.json 索引+全调用点标注（读/生命周期/业务写）归 census 任务卡（plan v1.7 T19 前置面）。

### ⑨ onStoreDocument 对 connection-origin 零调用 — **T0 与验收文字相反（F-3）；断真值+翻转点常量**

**断言**（spec 用例⑨）：
- 落定判据=**origin 无关**（`docUpdates.gate>=3`——三帧 gate 预 apply 落定；翻转态 `onStoreDocument` 恒 0 不可作判据——防 5s 假超时红）+WAL 3 帧+`docUpdates.gate` 恰 3（翻转无关不变量）。
- TODAY 分支（T0 真值，未翻转）：突发三帧（同一防抖窗）→**onStoreDocument 恰一**（防抖合并，判据 `pollUntil(onStoreDocument>=1)` 与顺序锁〔全部 `onChange:gate` 先于 `onStoreDocument`——`indexOf` 在翻转态恒 -1=伪断言〕均**仅置本分支内**）+afterStoreDocument 恰一。
- 翻转分支（T9 翻 `T9_OWNERSHIP_SWITCHED=true`）：有界观测窗（`sleep(300)`——防抖窗 50/75ms×裕量）后断 `onStoreDocument===0`。
- 机制面（两分支共用）：`{source:'local', skipStoreHooks:true}` 的写→`onChange:local`+1 但 **store 零触发**（逃生舱实证）。
- 翻转点：文件内常量 `T9_OWNERSHIP_SWITCHED=false`（分支切换的机械部分=只改常量；**计数面前置**见下「T9 收紧」）。

**证据**：
- **F-3（库基线与验收文字相反）**：`shouldSkipStoreHooks`（esm:60-67）：`case "connection": return false`——connection-origin **恒不跳过** store 钩子；`handleDocumentUpdate`（esm:1396-1424）：onChange 恒发（:1413）→skip 判定（:1414）→`storeDocumentHooks`（:1423）→防抖（esm:1532-1554，debounce/maxDebounce+saveMutex 串行）。实测：gate 预 apply（origin={source:'connection',...,gate:true}——isTransactionOrigin :57-59 判过）触发防抖 store 恰一。⇒ plan v5.4 头号修正的运行时复核：**gate pre-apply 落地当日，生产 gateway:340 `onStoreDocument→storeDocumentUnlocked('debounce')` 链即每帧新旧双写**——⑨ 验收「零调用」是**所有权切换（拆链 telemetry-only）的验收**，不是库行为。
- 逃生舱：esm:65-66（`local` 档+`skipStoreHooks`）；**connection 档无逃生舱可用**（esm:63 恒 false）⇒ T9 gate 预 apply origin 按 plan 用 `{source:'connection',connection,gate:true}`（连接归因需要）时，抑制 store 的**唯一路径=拆生产链**，不可借逃生舱。
- 生产现链：gateway:340（onStoreDocument 直通 storeDocumentUnlocked('debounce')）+factory:57（接线）——spec v5.4 §1.9 第一实证复核一致。

**T9 收紧**：翻 `T9_OWNERSHIP_SWITCHED=true`（断零调用）+生产侧验收=「一帧恰一次 WAL append+一次 PG row+一次广播+旧 spool 计数 0」（plan v1.7 T9 原文）。本用例其余断言（机制面/逃生舱）不变。**翻转完整前置（F-3 推论）**：库对任何 `{source:'connection'}` origin 都会调防抖 store 钩子——本 harness 的 `onStoreDocument` 计数器只要还注册就恒 ≥1，「零调用」在 T9 成立须同步 harness 改造：(i) 摘除 store 钩子注册（断言退化为结构性沉默——弱形态）或 (ii) 计数器改接**旧链探针**（`onStoreDocument→storeDocumentUnlocked('debounce')` 生产链 spy——零调用=旧链确已拆，强形态，推荐）。即「只改常量」仅覆盖断言分支切换，计数面改造随 T9 所有权切换切片同卡落地（spec 翻转点注释已钉同文）。

## 2. 装置与层级选择（复用/惯例依据）

- **最小插桩真 Server**：不经生产 CollabGateway（其 lease/spool/perm 机器会遮蔽库行为），`new Server({...})` 直接构造；选项与生产工厂 pin 对齐（factory:34-80）：`flushDelay:0`/`flushMaxBytes:1MiB`（库默认原值 pin）、`stopOnSignals:false`、`address:'127.0.0.1'`、`freePort()` 真空闲端口（net listen(0)——collab.behavior-anchors.gate.spec:33-38 先例；主池文件级并行下随机段抽取有碰撞面）；`debounce:50/maxDebounce:75`（测试窗专用——⑨ 可等防抖落地）。钩子=telemetry-only 计数器（T9 目标接线形态：无 store 调用）。
- **客户端两形态**：RawSyncClient（裸 ws+真 y-protocols wire 帧——frame-encoder 单源，collab-rate-gate.spec `openAuthedWs` 先例；Auth→SS1→SS2 全握手，字节级收包分类计数，注入精确重复/坏帧）+HocuspocusProvider 4.6.0（⑥ awareness 真客户端，kit makeHeaderWs 注入式形态）。握手关键事实（探针修正）：provider onOpen 即发 Auth+SS1（provider:851-872，服务端 pre-auth 队列缓冲 esm:964-986/872-876）——裸客户端必须同样主动发 SS1，不能等服务端 SV。
- **层级=主池**（vitest.config.ts 默认集）：真 Server+真 ws 无 DB 先例=collab.gateway.spec.ts（主池）；本套件 13 用例共 ~5-7s（单用例 0.36-1.8s）远低于 heavy 池（≥10s 实时等待——collab-heartbeat.heavy 形态）与 int 池（DB e2e）门槛。文件不匹配 `*.int.spec.ts`/`*.e2e-spec.ts`/heavy include 集——主池自动收编，无需改任何 vitest 配置。
- **稳定性**：连跑 4 次 13/13 全绿（含 1.5s 实时窗的 ③″）；每用例独立 harness（fresh Server+fresh 计数器），无跨用例状态。

## 3. 运行结果

- `npx vitest run src/modules/collab/collab-hocuspocus-apply-order-contract.spec.ts`（apps/api 主池配置）：**13/13 通过**，~5-7s（③″ 含 1.5s ws 关闭观测窗）。
- `npx tsc -p tsconfig.spec.json --noEmit`：零错误（strict）。
- `pnpm verify:fast`：见提交说明（15/15 绿）。

## 4. 发现登记（对 plan v1.7 / spec v5.4 的反馈）

| # | 发现 | 影响 | 处置建议 |
|---|---|---|---|
| F-1 | 库不可拒坏帧：y-protocols readUpdate（=readSyncStep2）内吞 apply 错误+esm:292 无条件 ACK true | ③ 验收的「拒帧」完全由 gate 承载；无 gate 时坏帧=静默 ACK | T9 gate 帧合法性判据必须自解析（frameHash+decode）——plan T9 已含，本实证钉死其必要性 |
| F-2 | `throw.code` 到不了客户端：库 Connection.close 只发 app 级 CLOSE（reason 串）+raw ws 悬挂+清空同连接队列 | close 码（4411/4413/4404…）权威投递=`webSocket.close` 先行（生产 hardClose 形态）——throw 仅中止帧 | T9 沿用生产 hardClose 模式；4.7.x 若改此路径=③″先红 |
| F-3 | connection-origin 恒触发防抖 store（esm:63 恒 false，无逃生舱） | ⑨ 验收文字（零调用）与库基线相反——是 T9 拆链验收而非库行为；gate 预 apply origin 不可借 skipStoreHooks 抑制 | plan T9「所有权切换=拆 gateway:340 链 telemetry-only」为唯一路径——已按此设计，无需改 plan；本套件留翻转点常量 |
| F-4 | flushDelay:0 下同回合多帧 mergeUpdates 合并单广播（esm:729-733） | 「每帧恰一次广播」的库语义=每冲刷窗一次 | T9「一帧恰一次广播」由 actor 逐帧 resolve 承载；届时明确库广播通道 suppress 或双通道语义（T9 实现时裁定） |
| F-5 | 库 readOnly 检查在 beforeSync 后（esm:251 vs 284） | T9 gate 预 apply 必须自判 readOnly（否则 VIEWER/freeze 帧被 gate 先 apply） | 生产 guardSyncFrame ①层已按此序——T9 gate 换轨时保留该层序（harness 已镜像） |

无发现推翻 plan v1.7 的主体设计；三项 F-1/F-2/F-3 均为「gate/生产侧承载」的实证确认，plan 的 T9 设计（gate 自解析+hardClose 先行+拆链）与全部发现相容。

## 5. T9 复用指引

1. 本套件原样保留为 T9 回归面：T9 actor 落地后先跑本套件（库行为锁不因 actor 改变而失效），再在其旁追加 actor 语义用例（fsync 后 ACK/失败传播/WAL 真文件）。
2. ⑨ 翻转：`T9_OWNERSHIP_SWITCHED` 常量置 true——断言分支/判据/顺序锁已按翻转态预构（落定判据 origin 无关+翻转分支有界观测窗+TODAY-only 判据与顺序锁置未翻转分支内）；**但「零调用」并非只改常量可得**（F-3 推论：库对任何 connection-origin 都调防抖 store 钩子，harness 计数器只要还注册就恒 ≥1）——须同步 harness 计数面改造：摘除 store 钩子注册（弱形态）或计数器改接旧链探针 `onStoreDocument→storeDocumentUnlocked('debounce')` 生产链 spy（强形态，推荐——零调用=旧链确已拆）。计数面改造随 T9 所有权切换切片同卡落地。
3. harness 的 `docUpdates` origin 分桶已按 T9 枚举预留（gate/connection/load/local≅server-direct）——census ⑧ 的运行时交叉探针可直接复用。
4. 4.7.x 升级评估流程：先跑本套件——全绿=库时序未变（仍需跑全量 verify）；任一红=定位具体用例对应的本档位时序变更，按 §1 逐条裁决 fork/patch 或适配。
