# Spec: 协作删除持久化缺陷修复（R1 判据 2 FAIL · 变更驱动落库）

日期：2026-09-29（v4，吸收第 10/11/12 轮评审：封顶真原地+身份恒定、抑制窗口收窄同步段、stash 提前 drain）
状态：待确认
来源：R1 验收判据 2 FAIL（远端删除刷新后复活，3 次复现 + DB 取证）；九轮独立评审事实裁定后收敛

## 问题：远端删除从不落库

B 端删除节点 → 双客户端实时收敛正确（yjs 广播 OK）→ 刷新/API 重启后**节点复活**。

DB 取证（画布3 `cmuibzgng000410db6gi6ztbm`，2026-09-29）：CanvasDocUpdate 0 行（全被 compact）；CanvasDoc.state 11370B 快照解码——插入已入快照、**删除 op 从未落库**。僵尸节点 `node_1790672934579_1` 为活体证据（保留至验收步骤处置）。

写路径排查（钉死，防止下轮怀疑前端）：canvas doc 只有 provider 与 withDoc（openDirectConnection）两条写路径；project.service fillDoc 只写新建 projectId；REST autosave 已退役（saveCanvas 只写元数据）。复活只能来自 doc 持久化层。

非 R1 代码引入（guard 出自 963166c5 增量持久化提交），但 R1 方案 C 删 localStorage 快照层后服务端成唯一持久化层，被掩盖的缺陷成必现。**本缺陷按 R1 收尾 blocker 处理——判据 2 通过 R1 才算完成。**

## 根因（已实证）：两根因在真实操作序列上串联

**`!lastSV` 静默跳过（gateway storeDocument `if (!lastSV) return`）是判据 2 的必现路径；SV 判等吞纯删除是所有路径的共同兜底失明点。**

"用户删完手一抖刷新"的真实序列：页面关闭 → onDisconnect（flush 被 SV 判等挡住 + compact + finally 删 persistedSV）→ 页面重开 provider 重连 → 命中 documents 缓存同一 doc 实例（机制：卸载被 hocuspocus 推迟——onClose 先 executeNow(store) 再 setTimeout(unload)，且每次 openDirectConnection（readCanvas 等）都复用缓存实例；刷新重连几乎必然命中）→ 不再走 onLoadDocument → 用户再删除 → storeDocument 命中 `!lastSV` 静默 return，零日志。

### 根因 1：SV 判等吞掉纯删除

Yjs 的删除是已有 item 的 tombstone（deleteSet），**不产生新 struct、不推进 clock**——纯删除变更的 SV 字节级不变。SV 双向判等把纯删除误判为"无变化"，提前 return。断连 flush / unload flush / 进程退出 flush 全部汇入同一个 storeDocument，同样被挡。

### 根因 2：`!lastSV` 静默跳过

最后连接断开 → gateway.disconnect() finally 里 `persistedSVs.delete()`（DB 往返窗口数十~数百 ms）→ 窗口内新连接命中同 doc 缓存（不再 onLoadDocument）→ 写入 → 静默 return 丢写且无日志。

### 实测取证（yjs 13.6.32，本机复跑）

| 探测 | 结果 |
|------|------|
| 纯删除后 SV | 字节级不变 |
| 纯删除 diff（`encodeStateAsUpdate(doc, lastSV)`） | ~10 字节（structs 空 + 全量 deleteSet），重放删除生效 |
| 有删除历史的 doc，无变化 diff | **非空**（deleteSet 全量携带，与 targetSV 无关——yjs `writeStateAsUpdate` 的 deleteSet 段不做 SV 过滤） |
| 从未删除过的 doc，无变化 diff | 2 字节（真·空 diff） |
| `doc.on('update')` payload | Yjs 增量编码，按序重放与源 doc 等价 |
| 语义相同的两个 doc，双向 diff | **恒非空**（~14 字节）——任何以"SV 相等 / diff 为空"推断"无变化"都是结构性错误 |
| 300 次拖拽事务 | 302 个 update 事件（11554B）；mergeUpdates 合并后 6108B 单行；逐行重放 ≡ 合并重放 ≡ 源 |
| GC 场景（删除后无关事务，gc 默认开） | update 增量仍携带 ds，重放删净 |

### 排除项（后人勿再查）

- **断连 flush 丢删除**：排除——flush 走同一个 storeDocument，同样被 SV 判等挡住；"隔数分钟才刷新成功"的对照实为"伴随 SV 变化的写操作，其 diff 的全量 deleteSet 顺带捎上删除"
- **进程退出路径**：`Server.runDestroy()` → closeConnections() → 最后 onDisconnect → flushPendingStores() → 等待 documents 归零，链路完整。边界：store 持续失败时 shouldUnloadDocument 守卫使 doc 永不卸载、destroy 永不 resolve——与本修复的错误契约（见设计 §disconnect）耦合，必须一起处理
- **读侧 SV 等待造成空等**：排除——SV 是 clock 比较，与存在性正交；删除不减少 clock，server SV 天然覆盖 peer SV，svSatisfied 不会因删除误判/空等

### 为什么"删掉判等"不可行（已否决）

- `DirectConnection.disconnect()` 无条件调用 storeDocumentHooks（Hocuspocus src `DirectConnection.disconnect`），`withDoc` 每次 finally 都走它 → **每次 readCanvas/writeNodeData/insertNode 都触发 store**
- 有删除历史的 doc 无变化 diff 恒非空 → 删判等后每次触发都 append 一行 → COMPACT_THRESHOLD=32 快速耗尽 → 每次触发全量 compact（RepeatableRead + advisory lock + 快照重写）
- "无变化不落行"契约测试必红
- 另一已评估否决方案：保留 lastSV、以全量 `encodeStateAsUpdate(doc)` 字节比较做变更检测——忠实编码 deleteSet 但每次 store 触发（含每次 API 读）都 O(doc) 编码，画布大后崩溃。队列方案胜出

## 目标

1. **判据目标**：任何使 doc 语义变化的变更（含纯删除）都必须落库——变更检测基于**观测**（Yjs update 事件），不基于**推断**（SV / diff 空 / 指纹）
2. **不变量目标**：在 doc 实例存活期内，持久化只滞后、不越过、失败可重试（at-least-once）；滞后上界限定——connection/local origin ≤ maxDebounce 10s，redis-origin 落库时点 = 本实例下一次 store 触发（connection/local 变更、withDoc、断连、进程退出 flush），只要实例最终经历任一事件即不丢，仅 SIGKILL 落空（与 debounce 窗口崩溃同类接受项）——**非待修缺陷，勿据此做定时刷盘**
3. **取证目标**：交付"删除→落库→重建不复活"的可回归锚（canonical+语义双判据的库级断言 + provider 级 e2e + 浏览器判据 2 复跑）

## 非目标（登记，不修）

- provider 卡 "connecting" >2min（伴生发现，独立会话取证）
- debounce 5s / maxDebounce 10s 窗口内进程崩溃丢更新（既有接受项；修复后丢失面等价）
- syncFromPeers 与 extension-redis 自带对等初始同步（afterLoadDocument，NUMSUB 门控）功能重叠，自研版无门控致单实例冷加载固定 +1s——**机制类不变量**（对等初始同步必须存在）锚定，载体后续可收敛；删除/降级前必须保证扩展侧 awaitInitialSyncTimeout > 0
- 读侧 SV 等待（waitForSV / 客户端 SV 凭据）不动——对删除"正交失明"不造成误判（见排除项）
- 观测性本期只做最小集（见设计），全量打点不做

## 修复设计：变更驱动落库

### 机制

`doc.on('update')` 收集增量 pending 队列，storeDocument 取批合并落库。删除天然是 update 事件，不存在"用不含删除信息的量推断是否有变更"的自由度。

**必须用 `doc.on('update')` 而非框架 onChange**（承重，注释写死）：Hocuspocus 的 `document.onUpdate` 在 onLoadDocument 返回之后才注册，syncFromPeers 拉进来的更新永远不触发 onChange——改用 onChange 会使对等冗余落库静默失效。

### 数据结构

```ts
private readonly pendingUpdates = new WeakMap<Y.Doc, Uint8Array[]>();  // has() 即"已注册"（单状态源）
private readonly replaying = new WeakSet<Y.Doc>();    // 重放抑制（只包裹每个 applyReplayed 的同步段，不跨 await）
/** flush 失败兜底：projectId → 未落库合并行（跨 doc 卸载存活；进程重启丢失=既有接受项）。单行存续，追加即合并收敛 */
private readonly unflushed = new Map<string, Uint8Array>();
```

- 键为 doc **实例**而非 projectId：生命周期天然等于 doc 实例，杜绝 persistedSVs 式"Map 生命周期与 doc 脱节"（根因 2 的复发面）
- 生产中 Hocuspocus 同文档名同 doc 实例（documents/loadingDocuments 双去重）
- **队列数组引用在 doc 生命周期内恒定**（不变量 6）：封顶合并等一切变更只允许原地 push / splice / unshift，**禁止任何形式的重新 set**——v3 的 set 替换与 storeDocument 跨 await 持有的旧引用组合，会把失败回灌写进孤儿数组（失败批在最需要恢复的路径上静默丢失）
- **禁止改用 onChange**（见机制节）；**禁止任何形式的"SV 相等 / diff 为空 ⇒ 跳过 append"判等**（本次事故根因，trace 注释钉死在 storeDocument）

### loadDocument（注册先于第一个 await；抑制窗口收窄到同步段；stash 回灌在抑制窗口外）

```ts
if (!this.pendingUpdates.has(document)) {      // 防重复注册（行数翻倍防护）；has ⟺ 已注册（单状态源，勿再加平行 WeakSet）
  this.pendingUpdates.set(document, []);       // eager 建条目：条目缺失 ⟺ 监听未注册（异常态，双向 tripwire）
  document.on('update', (u) => {
    if (this.replaying.has(document)) return;
    const q = this.pendingUpdates.get(document);
    if (!q) { this.logger.error(`update for untracked doc ${documentName}: dropped`); return; }   // tripwire：不可静默（硬规矩同样适用于监听器）
    q.push(u);
    if (q.length > PENDING_MAX_ENTRIES) q.splice(0, q.length, Y.mergeUpdates(q));  // 增长点封顶：计数阈值 64——折叠后恰剩 1 条、需再积 64 条才复发；字节阈值会"折完仍超限→每条 update 全量重编码"（实测 3000 条积压 4.8s vs 计数 103ms 同步阻塞 WS 消息路径，第 11 轮评审实证）。必须原地 splice——禁止 set 新数组
  });
}
const applyReplayed = (u: Uint8Array) => {     // 抑制窗口收窄到单个 applyUpdate 的同步段（yjs update 事件只在事务清理期同步发放，不漏不误放）
  this.replaying.add(document);
  try { Y.applyUpdate(document, u); } finally { this.replaying.delete(document); }
};
const docRow = await this.prisma.canvasDoc.findUnique({ where: { projectId } });
if (docRow) applyReplayed(new Uint8Array(docRow.state));
for (const u of await this.repo.loadUpdates(projectId)) applyReplayed(new Uint8Array(u));
const stash = this.unflushed.get(projectId);
if (stash) this.unflushed.delete(projectId);
if (stash) Y.applyUpdate(document, stash);     // 回灌在抑制窗口外：stash 是未落库变更，apply 产生的 update 事件被监听器收进 pending → 下次 store 落库。禁止只 apply 不入队（等于二次蒸发）
await this.redisSync.syncFromPeers(documentName, document, 1000);  // 对等更新进 pending（冗余策略）
// 不 return document：Hocuspocus 对 undefined no-op（doc 已就地填充），消除"自应用 0 事件"性质依赖
```

- **注册在第一个 await 之前 + 抑制不跨 await**：DB 往返的 await 窗口内若有写入者到达（loadingDocuments 门控今天挡住了，防御性），其更新不被抑制、进 pending；每条 DB 行的重放独立同步抑制，不污染队列——不变量 5 从表述变成事实
- **stash 回灌语义（v3 关键修正）**：stash 是未落库的变更而非重放，必须走"apply → update 事件 → pending → store"正道；在抑制窗口内 apply 会被抑制进不了 pending 且 Map 引用已删——兜底链二次蒸发，比不兜底更危险
- **stash 回灌依赖下一次 onLoadDocument**：WS 连接（provider）不触发 DB 重放，onLoadDocument 由 createDocument 触发——进程重启（runDestroy → closeConnections → 重载）与任何首次打开都覆盖；写进代码注释防"以为只在冷启动生效"
- **不过滤 origin**：本实例把见到的所有变更（客户端 sync、服务端直连写、redis 对端广播）都负责落库——spec 2.2"对等实例也冗余落库，产生方崩溃也不丢"由此保留
- **事件数事实（绿1b 判据基础）**：对已知状态应用 tombstone-only 更新 = 0 事件（不 append）；带新 struct 的对端 diff = 1 事件——那是本实例此前不知道的真实新信息，落库是对的，不是噪声
- syncFromPeers 职责口径（修订）：**加载期对端增量补齐**；跨实例删除可见性由"每个 update 都落库 + 下次 load 从 DB 重放"保证（本修复建立的机制），非 syncFromPeers 本身

### storeDocument

```ts
const queue = this.pendingUpdates.get(document);
if (!queue) { this.logger.error(`store for unobserved doc ${documentName}: listener never registered`); return false; }  // tripwire：117 同构物不得静默
const stash = this.unflushed.get(projectId);      // stash 提前 drain（v4）：WS 断连场景 doc 驻留缓存不重载，stash 只有这里能落库；并入队首随本批 append。与 load 路径不会双投（load 取走时已 delete）
if (stash) { this.unflushed.delete(projectId); queue.unshift(stash); }
if (queue.length === 0) return false;              // 真·无变化不落行（契约：readCanvas/断连的无条件触发零写放大）
const batch = queue.splice(0);                     // 同步原子取走（与队列解耦）
const payload = batch.length === 1 ? batch[0] : Y.mergeUpdates(batch);
try {
  await this.repo.append(projectId, payload);      // 单行原子：全有或全无，无"部分成功"状态
} catch (err) {
  const live = this.pendingUpdates.get(document);  // 跨 await 后必须重新 get（防御双保险：原地封顶下引用恒定，此处 live === queue；若不等说明有人违反不变量 6）
  if (live !== queue) this.logger.error(`pending queue identity changed for ${documentName}`);
  (live ?? queue).unshift(payload);                // 回灌合并行（单项，等价于展开 batch）；队列原样保留 → 下次 store 重试
  this.logger.error(`store append failed for ${projectId}, ${batch.length} updates retained: ${(err).message}`);
  yjsStoreAppendFailureTotal.inc();
  throw err;                                       // hook 链路径由 Hocuspocus catch（"Document stays in memory"），doc 留内存重试
}
yjsStoreDrainTotal.inc({ result: 'appended' });
try {
  if (await this.repo.count(projectId) >= COMPACT_THRESHOLD) await this.repo.compact(projectId);
} catch (err) {
  yjsStoreCompactFailureTotal.inc();
  this.logger.warn(`compact failed for ${projectId} (rows already durable): ${(err).message}`);  // compact 是优化不是不变量载体：行已落库，失败只 WARN 绝不抛——否则被 Hocuspocus 当 store 失败 → doc 永不卸载 → destroy 挂死
}
return true;
```

- noop 路径（队列空）打 `yjsStoreDrainTotal.inc({ result: 'noop' })`——空转率是判断"readCanvas 无条件 store 是否需要收紧"的唯一依据
- **mergeUpdates 单行落库**（否决 v1 逐行）：拖拽 300 事务 = 302 行 → count≥32 → 每次 store 全量 compact + 602 次串行 DB 往返；合并后 1 行 6108B，落库粒度与现网 diff 语义一致。安全性实测：合并批重放 ≡ 逐行重放 ≡ 源；删除混批重放删净；重复投递幂等；乱序应用收敛（seq 只是排序键，非因果序刚需）。mergeUpdates 即 Hocuspocus 自身的批次广播实现（Document.update），非自创机制
- **append 与 compact 分治（v3 修正）**：compact 失败不得走 append 的 throw——否则 hook 链把它当 store 失败（doc 留内存永不卸载）、disconnect 把它当 flush 失败（误导日志 + 空 stash）
- **并发交错安全性**（splice 先取方案的论证，承重）：JS 单线程下 splice(0) 同步原子；交错只可能发生在 append 的 await 窗口——窗口内监听器 push 进同一数组（原地封顶不换数组），失败 unshift 回队首得 [payload, 新到]，CRDT 幂等顺序非刚需；并发第二轮 store 取走的是窗口内新到批，两轮 append 都成功时 seq 相对顺序可能颠倒——重放收敛，无丢写。onDisconnect 裸调 storeDocument 绕过 saveMutex 不破坏此性质
- **Skip 路径下 destroy 与 flush 并发是既定事实**：extension-redis 抢不到 redlock 抛 SkipFurtherHooksError → storeDocumentHooks 排 setTimeout(unload check, 0)，与我们的 flush（await DB 往返）并发执行——**flush 不得依赖 doc 存活**（splice 先于任何 await + 失败回灌以活队列为准 + stash 不依赖 doc），此为 v4 三处防御的统一理由
- **硬规矩：storeDocument 内不允许存在无日志、无指标、无抛错的提前 return**（本次事故的系统性教训；监听器同样适用）
- extension-redis 的 onStoreDocument 以 priority=1000 排链首、抢不到 redlock 时抛 SkipFurtherHooksError → 我们的 onStoreDocument 不被调用 → pending 完整保留（方案下无害）。**登记**：后人排查"某次 store 触发零 append"的第一嫌疑
- hooks 类型声明同步：onStoreDocument 返回 Promise<boolean>，gateway hooks 字段声明同步修改（strict 下禁止 as any 糊过）

### disconnect（吞错契约显式化 + flush 失败兜底 + compact 独立分治）

```ts
if (document.getConnectionsCount() > 0) return;
const projectId = parseProjectId(documentName);
try {
  const wrote = await this.storeDocument({ document, documentName });
  if (wrote) {
    try { await this.repo.compact(projectId); }    // 会话结束收敛增量行；没写就不 compact（消除每次 readCanvas 一次全量 compact + 双重 compact）
    catch (err) { this.logger.warn(`final compact failed for ${projectId}: ${(err).message}`); }   // compact 失败独立 WARN：行已落库，不是 flush 失败
  }
} catch (err) {                                    // 只兜 flush（append）失败
  const q = this.pendingUpdates.get(document);
  if (q?.length) {
    const batch = q.splice(0);
    const payload = batch.length === 1 ? batch[0] : Y.mergeUpdates(batch);
    const prev = this.unflushed.get(projectId);
    this.unflushed.set(projectId, prev ? Y.mergeUpdates([prev, payload]) : payload);   // 单行存续，追加即合并收敛（有界）
  }
  this.logger.error(`collab flush failed for ${projectId}, stashed for next load: ${(err).message}`);
}
```

- **绝不抛出**（契约，文档写死，覆盖含 Skip 在内的全部路径）：onDisconnect 是 Hocuspocus `createConnection`（Connection.close）里 onClose 的 async 回调，注册方 `callbacks.onClose.forEach(cb => cb(...))` **不 await**——抛错 = unhandled rejection（main.ts 无 unhandledRejection 处理器）= Node 15+ 默认进程退出；DirectConnection 路径（DirectConnection.disconnect）是 await 的，抛错冒泡出 withDoc finally → 业务 API 500 → 前端重试 → 重复插入（数据污染）。Skip 路径同样被覆盖：storeDocumentHooks 的 saveMutex 在回调抛错时先释放、后让外层 promise settle，DirectConnection.disconnect 的 `!saveMutex.isLocked()` 检查通过 → onDisconnect 一定被调用——"绝不抛出"的面比 v3 写的更宽而非更窄
- 抛错还会跳过 hocuspocus 内部负责 executeNow/unloadDocument 的 onClose 回调 → doc 永久滞留 documents map → runDestroy 永不 resolve → 优雅停机挂死
- **flush 失败 vs 蒸发的死结**：吞错 → Hocuspocus 继续 unload（isDebounced 为 false 时直接 unloadDocument）→ doc destroy → WeakMap 回收 → pending 无日志蒸发（判据 2 同症状复发面）。`unflushed` Map 把 pending 转移到 doc 生命周期之外——**doc 卸载不再等于数据蒸发**。进程重启仍丢（与 debounce 窗口崩溃同类，登记残余风险）
- **unflushed 的保护范围是全部断连路径**（v4 修正口径）：disconnect 的 catch 在任何路径都把队列清空转 stash——WS 断连同样"数据只活在 stash 里"；stash 回灌有两条出口：① loadDocument（doc 卸载后重载）② storeDocument 取批前提前 drain（doc 驻留缓存不重载时，≤ 下次 store 触发）。**stash 落库时点由下一次读/写/断连决定，非显式 flush**——线上若"DB 恢复后迟迟没落库"，第一嫌疑是"没人碰这个画布"，不是 stash 失效（写进代码注释）
- compact 收紧安全性：wrote=false 时无 DB 变更，compact 产物与现有快照等价；阈值 compact 仍兜住行数收敛
- 日志分流：flush 失败（ERROR，可恢复）与 compact 失败（WARN，一致性问题不丢数据）必须区分，防误导排查

### 观测性（最小集，沿用 sv-wait.metrics.ts 的 prom-client 范式与 yjs_ 前缀）

- `yjs_store_drain_total{result="noop|appended"}`（空转率是判断"readCanvas 无条件 store 是否需要收紧"的唯一依据）、`yjs_store_append_failure_total`、`yjs_store_compact_failure_total`、`yjs_unflushed_projects`（gauge——条目数无上限的登记项从"登记"变"可观测"）
- 失败日志带 pending 行数

### 删除面（净代码量下降）

- `persistedSVs` Map 及全部引用、`svSatisfied` 的 gateway 导入（sv.util 保留——collab-document.service 读路径仍用）、`!lastSV` 静默分支、loadDocument 设置 persistedSV 的注释舞蹈、SV 判等
- `repo.compact` 返回值收口：`Promise<void>`（snapshotSV 不再消费），删 `encodeStateVector(temp)` 与 lastPersistedSV 注释，同步改 repo 测试断言

## 不变量（守护测试钉住）

1. **持久化等价（操作性定义）**：每次 store 后，重放(快照 + seq ASC 行) + 顺序重放(pending) ≡ 内存 doc；断言用 **canonical 规范化等价 + 语义等价双判据**（raw 字节等价仅作辅助锚，不得单独承重）——raw `encodeStateAsUpdate` 是 struct store 序列化，GC 历史差异可使语义相同的 doc 字节不同（fuzz 实测 ~1% 伪红）；canonical = 经新 doc 再编码一次，消除 GC 历史差异
2. **无变化不落行**：pending 空 → storeDocument 直接 return false（含重复触发；对已知状态应用 tombstone-only 更新 = 0 事件不落行——带新 struct 的对端 diff是真实信息，必须落库）
3. **失败不推进（doc 存活期内）**：append 失败 → 队列原样保留 + 抛错 + ERROR 日志 → doc 留内存下次重试；卸载后由 unflushed 兜底；实例与进程均销毁则终止（残余风险）。**unflushed 中的批次要么进 pending 要么为空——禁止只 apply 不入队**；compact 失败不属于失败不推进的范畴（行已落库，仅降级 WARN）
4. **观测而非推断**：纯删除后 SV 字节不变、语义相同 doc 双向 diff 恒非空——两个反直觉事实作为测试显式断言钉住，**禁止任何"SV 相等 / diff 为空 ⇒ 无变化 ⇒ 跳过 append"的判等**（本次事故根因，注释+tripwire 双保险）
5. **监听先于一切写入**：注册发生在 loadDocument 第一个 await 之前；每次重放 applyUpdate 同步抑制（replaying 不跨 await）；抑制窗口外的真实写入必须进 pending。未注册态双向出声：storeDocument 遇未注册 doc、监听器遇未注册 update 都必须 tripwire ERROR（117 同构物不得静默）
6. **队列身份恒定（构造不变式）**：pendingUpdates 的数组引用在 doc 生命周期内恒定，一切变更只允许原地 push / splice / unshift——**禁止任何形式的重新 set / 局部变量重绑定**（set 替换 + storeDocument 跨 await 持旧引用 = 失败回灌写进孤儿数组，失败批在最需要恢复的路径上静默丢失）——绿9/绿9b 钉死

## 测试计划（TDD 阶梯）

### 共享 helper（plan 阶段落成可复用件，防判据在用例增多后失守）

```ts
/** canonical 规范化：经新 doc 再编码，消除 GC 历史差异（不变量 1 主判据） */
const canonical = (d: Y.Doc) => { const t = new Y.Doc(); Y.applyUpdate(t, Y.encodeStateAsUpdate(d)); return Y.encodeStateAsUpdate(t); };
/** 唯一入口断言（判据机械化）：持久化等价的三态全量检查——每个红/绿用例只调它，不允许各写各的 replayOf */
const expectDurableEquivalent = (doc: Y.Doc, { snapshot, rows, pending, unflushed }: {
  snapshot?: Uint8Array | null; rows: Uint8Array[]; pending?: Uint8Array[]; unflushed?: Uint8Array | null;
}) => { /* 重放 snapshot + rows + pending + unflushed → canonical 等价 + 语义等价（nodes.toJSON）+ 断言集 */ };
```

**判别力锚（防恒真，helper 契约而非文字提醒）**：重放断言必须两段——`replayOf(仅插入行).has(nodeId) === true`（插入行真实被捕）+ `replayOf(全部行).has(nodeId) === false`（删除真实生效）。只断言后者，插入行丢失时恒绿。

### 红测试（单元 / hooks 级，现有缺陷全红；全部走 onLoadDocument 建立队列 + 同 doc 实例）

| # | 用例 | 断言 |
|---|------|------|
| 红1 | load → 插入 → store（append#1）→ **纯删除** → store | append 第 2 次调用；纯删除后 SV 字节不变（不变量 4）；判别力锚两段断言；canonical 等价 |
| 红2a | 判据 2 精复现：load → 插入 → store → 纯删除 → 无后续编辑 → onDisconnect（connections=0） | flush 路径 append 含删除（append 先于 compact）；判别力锚 |
| 红2b | 必现路径：load → 插入 → store → 删除 → onDisconnect（旧实现 finally 删 SV）→ **同 doc 再变更** → store | 主判据：expectDurableEquivalent + 插入/删除各自成行（判别力锚）；次数只作辅助断言且**从序列推导**（新实现下 =3，旧实现 =1——硬编码 off-by-one 会让红→绿翻转点失真） |
| 红3 | 117 直测：load → 写入 → onDisconnect → 同 doc 实例再写入 → store | 同红2b（两用例一测 flush 语义、一测缓存复用语义） |
| 红4 | 加载窗口写入（**白盒**，模板导入/AI 影子节点场景）：mock loadUpdates 返回受控 promise，挂起期间向同一 doc 写入 → release → load 完成 → store | 窗口期写入进 pending 且落库（不变量 5 判据化——抑制窗口收窄到同步段后此用例可构造；若注册挪到 await 之后必红） |

### 绿守护（方案行为契约）

| # | 用例 | 断言 |
|---|------|------|
| 绿1 | 无任何变更 → store 连续 3 次（覆盖 readCanvas 重复无条件触发） | 全部不 append；`yjs_store_drain_total{result="noop"}` 递增 |
| 绿1b | 对已知状态应用 tombstone-only 更新（带全量 deleteSet 无新 struct）→ store | 不 append（0 update 事件）；对照：带新 struct 的对端 diff → 1 事件 → 必须落库 |
| 绿1c | 重放不进队列：load 完成后直接断言 pending.length === 0 | 钉死"重放抑制"（不变量 5 的另一半） |
| 绿2 | append reject → store 抛错 + ERROR 日志 → 再 store（resolve） | 队列原样保留后重试成功；canonical 等价；**无部分批** |
| 绿3 | GC 场景：删除后跑无关事务 → store → 重放 | 删净 + canonical 等价 |
| 绿4 | 写放大守护：300 次事务 → 一次 store | **append 恰 1 次**（mergeUpdates）；repo.count < 32 时 compact 不被调 |
| 绿5 | COMPACT_THRESHOLD 分支：count 返回 ≥32 → store | compact 在 append 之后被调（该分支现零覆盖） |
| 绿5b | wrote 契约（性能守护）：空队列 store → compact 不被调；有写入 store → compact 被调 | 钉住"没写就不 compact"（否则后人加回无条件 compact 无测试变红） |
| 绿6 | disconnect 不抛：repo.compact reject → onDisconnect 必须 resolve（进程守门） | 无异常抛出 |
| 绿7 | tripwire 双向：①未 load 就 store ②未注册 doc 的 update 事件 | 两方向都 logger.error；不 append |
| 绿8 | unflushed 兜底全链：flush reject → stash → 新实例 loadDocument → **不做任何新编辑** → store/disconnect | stash 内容已落库 + canonical 等价；**再 store 不 append**（防重复入队；中间夹新编辑会让 P0-A 类 bug 假绿） |
| 绿8b | stash 提前 drain：flush reject → stash → 同 doc（不重载）直接 store | stash 随本批落库（doc 驻留缓存场景的出口）；canonical 等价 |
| 绿8c | stash-已在-DB 引理：stash 内容已由对端落库（DB 重放含它）→ load → store | 不 append、无重复行、unflushed 清空（stash 回灌 0 事件 = 内容已知） |
| 绿9 | 队列身份回归：触发字节封顶（push 至阈值）后 `pendingUpdates.get(doc)` 与首次引用 toBe 同一对象；再 store | append 恰 1 次；再 store 不 append（身份 tripwire 未触发） |
| 绿9b | 失败+交错回归（P0-A 判据）：append 返回受控 promise → await 窗口内注入超阈值更新（触发封顶）→ reject → 断言失败批仍在队列（**经 WeakMap 读出**）→ 重试成功 | canonical 等价；不重复 append；身份 tripwire 未触发 |
| 绿10 | compact 失败降级：append 成功 + compact reject → storeDocument | 不抛错；行已落库；WARN 日志；不 stash |
| 绿11 | canonical helper 自证（**种子循环 40 seeds**）：同一批 update 以不同批次切分应用的两份 doc | canonical 全等（实测参照：raw 字节等价 60 次随机试验失败 10 次、canonical 0 次——单例判别力不足，必须循环） |

### provider 级 e2e（真 WS + 真 Hocuspocus，沿用现有 harness）

连 provider → 写节点 → 等 append → provider 删除该节点（真事务）→ provider.destroy()（真实最后连接 onDisconnect）→ 断言重放全部 append 行节点不在（+canonical 等价）→ 再连第二个 provider → 其 doc 节点不在（**"刷新不复活"的自动化版**，同时罩住两个根因与 debounce/unload/DirectConnection 交互）。

### 仓库级（canvas-doc-update.repository 既有 prisma 假实现范式）

- 插入行 + 删除行 → compact() → 快照重建 → 节点不在（恢复路径完整取证）
- compaction 后再 append + 再 compact 的幂等用例（跨两轮 compact 的快照/增量边界）
- compact 返回 void 的断言收口——**注意假绿陷阱**："无增量行返回 null 即不写快照"用例改为断 `prisma.canvasDoc.upsert` 与 `deleteMany` **未被调用**（行为断言），`resolves.toBeUndefined()` 对任何 void 函数恒真、判别力归零；:50-51 的 `toBeInstanceOf(Uint8Array)` 直接删（无替代语义）

### 现有测试适配

- load 与 store 传**不同** `new Y.Doc()` 实例的构造（:253-254、:280-281 等）改同实例传递——对齐生产现实
- :290-299"非最后连接早退"：改后需保持判别力——同实例构造 + 断言 **storeDocument 未被调用**（而非 append 未被调用，防"doc 无监听器恒空队列"的 vacuous 通过）

### 验收（浏览器判据 2 复跑，人工留证）

**验收断言一律以浏览器 + 查库为准，禁止用 readCanvas 返回值判删除**（SV 等待对删除正交失明，跨实例下可能假阴性）。

画布3 活体证据节点 `node_1790672934579_1` 的处置即验收步骤：

1. 基线取证：记录 CanvasDoc.state 大小 + CanvasDocUpdate 行数；**先解码快照确认僵尸节点确实在快照内**（否则后续"重放不含该节点"断言恒真）
2. 浏览器删除该节点 → 查库验证删除已落库（增量行 ds 含 tombstone，或 compact 后快照重放不含该节点）
3. **删完立刻刷新**变体（判据 2 必现路径，核心项）不复活 → 等 >10s 刷新不复活 → API 重启后加载不复活
4. 双标签：B 删 → A 收敛且 A 刷新不复活
5. **本项目 Nest Logger 的 ERROR 行零出现**（flush 失败 / stash / tripwire 均不得命中）——口径限定：框架自身 console.error（含 extension-redis SkipFurtherHooksError——那是控制流信号不是错误）与 storeDocumentHooks 的 catch 日志不算，否则多实例步骤假警报；WARN（compact failed）允许出现但须与 `yjs_store_drain_total` 同步，否则说明分治未生效
6. 判据 2 PASS 后 R1 方可收尾

## 文档修订（随修同 commit 收口，防文档骗下一个会话）

1. **增强设计 spec 2.2**：判据改为 update 事件驱动显式表述；水位不变量（只滞后不越过、失败不推进、doc 存活期内可重试、滞后上界 maxDebounce 10s）；"syncFromPeers 不得删除/降级"改为机制类不变量表述（对等初始同步必须存在，载体两注明）；对等删除可见性归因改为"每 update 落库 + load 从 DB 重放"
2. **R1 plan 判据 2 相关表述**（"正常刷新零丢失（onDisconnect flush 兜底）""服务端 tombstone 权威"）：附证伪说明——原文"兜底"在本次事故恰是失效环节，兜底前提是"每次语义变更都进 pending + 断连 flush 无条件执行且吞错有兜底队列"
3. **代码 trace 注释**：storeDocument 原位置钉死——"删除不产生新 struct、SV 零变化、语义相同 doc 双向 diff 恒非空，禁止任何 SV/diff-空否判等跳过 append"；loadDocument 钉死——"监听必须先于第一个 await；禁止改用 onChange（syncFromPeers 更新不触发 onChange）"
4. **引证规范**：源码引证用 src 路径 + 函数名（Hocuspocus 4.6.0），不用 dist 行号（升级即漂移）

## 残余风险（登记）

- **进程重启丢 unflushed**：flush 失败 + 进程退出（DB 不可达时数据本不可恢复）——与 debounce 窗口崩溃同类，既有接受项。unflushed 单行合并有界；条目数无上限但已由 `yjs_unflushed_projects` gauge 可观测
- **stash 回写窗口（已收窄为引理）**：stash 有两条出口（load 回灌 / store 提前 drain），落库时点 = 下一次读/写/断连触发 store（非显式 flush）；进程崩溃前无任何触发才丢——与 debounce 窗口同类。**stash 内容必在 doc 或 DB 之一**（回灌 0 事件 ⟺ 已知 ⟺ 在 DB；有事件 ⟺ 进 pending），无第三态——绿8c 钉住
- **throw 的跨实例代价**：storeDocument 抛错 → afterStoreDocument 整段跳过 → extension-redis 的 redlock 不释放（留存至下次成功 store 或 TTL）→ 其他实例 store 被 SkipFurtherHooksError 阻塞——一次本地 DB 抖动放大为跨实例写入阻塞窗口（既有行为，v3 把抛错升级为设计契约故必须登记）。附带：afterStoreDocument 的 source='local' 对外发布也被跳过（connection/redis 来源广播走 onChange 不受影响）
- **extension-redis redlock Skip 路径**：抢不到锁时本次 store 零 append 合法（pending 保留），排查写放大/丢行的第一嫌疑，勿误判。Skip 路径下 storeDocumentHooks 排 setTimeout(unload check, 0) 与我们的 flush（await DB 往返）**并发执行、document.destroy() 可先完成——并发的 destroy 是既定事实，flush 不得依赖 doc 存活**（splice 先于任何 await + 失败回灌以活队列为准 + stash 不依赖 doc，源码注释留证）
- **多实例 redis-origin 不触发本实例 store**：对端更新只进 pending，落库时点 = 下次 store 触发（见目标 2），仅 SIGKILL 落空；pending 有计数封顶合并防线（PENDING_MAX_ENTRIES=64——**条数上界非字节上界**，单文档最坏积压字节 ≈ 64 × 单次变更大小，一次大模板导入单条即可能上百 KB；这是为躲开字节阈值病态区的既定取舍，监听器内原地 splice）。**禁止 drop 队列**：Yjs 缺失 struct 会悬挂 pendingStructs，"少一条"会变"永久不完整"
- **compact 持续失败**：分治后 WARN 吞错，但 count≥32 会在每次 store 重试——持续性失败（advisory lock 争用/快照超时）形成"每次 store 一次失败事务 + WARN 刷屏 + 行不收敛"——数据不丢（单事务回滚行仍在），由 `yjs_store_compact_failure_total` 观测，不做聚合降噪
- **append 持续失败 → destroy 挂死**：shouldUnloadDocument 守卫使 doc 永不卸载、onApplicationShutdown 挂死、优雅停机窗口耗尽 → SIGKILL——DB 恢复后重试成功则自愈；彻底解法（卸载超时）超出本期。compact 失败已分治（WARN 不抛）不触发此路径
- **debounce 窗口内崩溃丢更新**：丢失面与现网等价，不做 onChange 立即 append 类热路径加重
- **读侧正交失明（登记表保留）**：已加载实例的 readCanvas 在 redis 广播落地前可能返回删除前视图，SV 等待结构性无法"等待删除"——正交失明非 bug，但不得用作验收判据（见验收节）
- **tombstone-only 跨实例写放大**：跨实例大量广播的 tombstone-only 更新（对已知状态）会入队产生 6~10B 冗余行消耗 COMPACT 预算——判别式 `Y.encodeStateVectorFromUpdate`（入站更新自身是否引入新 struct，非 doc SV 推断，不违反不变量 4）可用但登记不做，仅限 redis-origin 过滤时考虑
- **外源 ds-only 更新 0 事件不落行（不变量 2/4 边界，禁止误判）**：目标 struct 不在本实例的 tombstone-only 更新（外源 clientID 引用、悬挂 deleteSet），应用后 0 update 事件 ⇒ 不进 pending 不落行——这是**正确**行为：该删除由产生方实例持有并落库，DB 是同一 Postgres，持久化判据不受影响。禁止后人把"0 事件"当成漏收改成"ds-only 一律落行"——那是已否决的写放大路径（每条已知 tombstone 一行）；外源 tombstone 还会悬挂 pendingDs 污染 canonical（实测），故测试构造必须自源 capture（绿1b 范式）

