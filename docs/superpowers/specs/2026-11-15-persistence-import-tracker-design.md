<!-- doc-status: active | created: 2026-11-15 | confirmed: 2026-11-16（用户确认 plan v2 批次——机制零改动） | v5——v1-v4 各经一轮外部架构评审逐项实锚核验后修订，裁定见 §0.1-§0.4；依据=地基批 plan C1-1 评估②裁定〔独立立项不夹带〕+C3a-8 评估登记②+卡注记①移交+用户 2026-11-15 四轮裁定） -->
# persistence 结构性收口（ImportCoverageTracker 抽取）设计 spec v5

> 范围：两卡短批**卡①**（卡②收口袋另行轻量 spec）。结构性重构——**零行为变化，唯一例外=FK 终态守卫微修**（§0.4-1，红先行⑨+commit 显式披露；无其它 API/DB/配置/观测面变更）。
> **诚实定位=分解片 1/N**：本卡交付「importPending 生命周期单一所有者 + 落定谓词单源 + 全部 settle 调用点直接断言 + FK 终态 wart 根修」，净行数预期 **-8~-20**（以 T2 实测披露为准——净减 <5 不阻断但不宣称容量收益）——不是 1242 零余量警号的根治（警号解除=片 1+2+3 落地，§5）。
> 依据：docs/superpowers/plans/2026-11-12-foundation-batch.md :204/:207（C1-1 评估②：不实现、独立立项、独立 TDD 切片走既有 C1 恢复链红测、不夹带）/:235。四轮评审全部事实主张逐项实锚核验（双方勘误对等留痕 §0.4-4）。

## 0.1 第一轮留痕（v1→v2 摘要）

- **锚方向**：v1「persistence/SG 双锚抬升」作废——改 persistence 锚=T2 后实测（收紧）；SG 1414 不动；新文件实测×1.3；>1242 停卡排查。
- **int 门**：verify full 不含 `*.int.spec.ts`（vitest.config.ts:13/verify-manifest 无 test:int 步/plan :217 明文）——T2/T3 出口补 test:int。
- **enqueue 归属**：v1「settle 返回 bool、调用方 enqueue」拆散「清+enqueue 恰一次」——改保留单一落定方法。
- **触点+行为锁口径**：语义 6 点=物理 9 处；既有锁实盖 4/6；:269 弱断言。
- **谓词单源**：settle 双门收敛为 persistence 唯一谓词（复用 hasPendingWrites:779；禁三态谓词替代——含 inFlight 维）。
- **purgePersistenceState 不清标记=有意语义**——头注固定契约。

## 0.2 第二轮留痕（v2→v3 摘要）

:1090 补 wiring（handoffOnUnload 全仓零测试）；purge 负测；锚自测 8 处；int 基线+flake 口径；用例③④路径钉死；实测披露+卡②排序登记；文案精度批；断言风格+enqueue 扫描；**:1207 当轮裁定保留**（后被 §0.4-2 终局推翻）。

## 0.3 第三轮留痕（v3→v4 摘要）

撤销「4 调用点零触碰」（v3 T2 补全直接断言溶解原前提）——落定方法更名 `releaseImportCoverage`+调用点单行改名+characterization 先行序；API 改名 `release`/`forget`；谓词改名 `importBytesLanded`+inFlight 理由注；wiring ⑧（inFlight 不阻挡落定）；FK 路径 wart 当轮裁定「登记卡②不修」（后被 §0.4-1 推翻——事实基础纠正）；否决 ：1207 删除（当轮——后被推翻）、谓词组合重构（维持否决→片 2 邻位）、他文件注释（后被推翻）；评审自身两处错误留痕（其中 ":1005=reconcileSpool" 误称由其本人于第四轮撤回）。

## 0.4 第四轮留痕（v4→v5 裁定）

1. **FK 终态守卫+setPersistStatus 跳过——进本卡**（撤销第三轮「归卡②」裁定）。撤销依据=我方事实基础被证伪：v3/v4 所写「runner 对已删项目 COUNT 0 行 no-op」**错误**——实测 `runProject` 首步 `readLifecycleState`→行缺=null→`!== 'ACTIVE'`→`return 'bailed'`（runner:173，setState 之前），drain 对 bailed **置 5 分钟 notBefore**（:150-151/:40）——同 pid 复建（restore）后 5 分钟内 rebuild 被 ：139 退避跳过；且 ：932 `setPersistStatus(documentName, true)` 在 FK 帧通道分支（不调 onProjectGone）给已删项目清不健康电平+广播 **healthy**。有真实副作用的小 bug，非无害 wart——根修指令+该行恰在本卡改名范围内（守卫进 releaseImportCoverage 四调用点同时生效）。红先行⑨（**非 characterization——防把 wart 锁死**）。卡身份从「纯零行为」改为「零行为+一处披露微修」。
2. **:1207 删除（终局裁定）**。依据：①文件自文档「**discardForGoneProject=唯一必然执行点**」（:1203-1204/:170-174）——保留第二清除点与自声明设计不变量矛盾；②第二轮「保留=防未来早退漏清」与第四轮「过早 forget=假覆盖」方向相反且同为假设性——逐路追迹确认所有具现路径均被 backstop（store 入口 :308 deletedProjects 拦截/retry 梯 :1208 已 cancel+TD-33 C1b blocked 不排梯/普通删除 FK 拒/回灌 markDirty+PG bindingsDirty 持久权威）；③守卫采纳后终态语义收口到 discard+守卫。**终局条款：本行四轮翻转到此为止，无新可达路径失败证据不再重开。**
3. **tracker 头注因果重写**：v3/v4「安全前提=face 接线早于 boot 回灌」因果错误（沿自第二轮 R1' P2-3，未追消费面——留痕）——boot 回灌在 gateway :1005-1010 **直连** bindingBackfill.markDirty/enqueue（:471 注释明文「boot 三回调直连不动」），不经 :480 face；face 只服务运行期 reconciler 与 releaseImportCoverage。
4. **双方勘误对等留痕**：我方——①「runner no-op」错误事实（本条 1）；②v3/v4 头注因果错误（本条 3）。评审方——撤回其第三轮「:1005 实为 persistence reconcileSpool」误称（gateway :1004-1011 即 boot replayAll——双方现一致）。
5. **两处接线注释同 commit 更新**（撤销本方两次否决）：gateway:465「persistence importPending → sink opts」/recovery-import:301「enqueue 归 persistence 维护 flush 路径（importPending 申报未覆盖→…）」按名引用本卡删除的字段且位于机制接线点——本卡使其成为孤儿（修改产生的孤立内容由修改者清理）；各改一行，C1 测试标题不动。
6. **wiring ② 简化**：断言「标记清+enqueue 0」——双清本身不可观测（一次 forget 与两次同果），不断言 forget 调用次数。
7. **其余按 v4 执行**（评审明示）：谓词不合并（wiring ⑧ 为锁）、replay 形态、T1 七例、purge 负测、handoffOnUnload 两支、锚、无 gauge、不抽片 2/3。

## 1 现状证据（HEAD=ea77bd0b 实锚，四轮评审主张除留痕错误外全部核验命中）

- **触点精确枚举**（`importPending` 全部代码引用面=persistence 内；其它引用仅两处接线注释〔本卡同 commit 更新〕+C1 测试标题〔不动〕）：
  - **4 处调用点单行改名**：:421 / :930 / :1063 / :1090 `settleImportPending`→`releaseImportCoverage`
  - **4 处单行委托改写**：:226 标记 / :449 discard 清 / :593 申报读 / :1014-1016 replay 条件清（缩一行）
  - **1 行删除**（:1207）+ **1 行新增守卫**（retryPersist 成功尾 ：932 前）+ **1 处方法更名重写**（:579-585，含 FK 守卫）+ **1 处字段替换**（:573）+ **1 处新增谓词**（importBytesLanded）+ 文件头 :4 一行 + 两处接线注释各一行
  - **零触碰**：replay :1010 enqueue 行、:418-420 stash-confirm 次序注记

| 语义 | 物理 | 现行实现 |
|---|---|---|
| 标记 | :226 | update 监听 origin=import → add（replaying 早退之前；gate/load/server-direct 不标记） |
| 申报 | :593 | runMaintenanceChannel `uncovered=has(pid)` → sink opts `{bindingUncovered:true}`／回退 inTx dirty+covered=false（同语义两形态） |
| settle 方法 | :579-585 | 双门（队列空∧spool 无帧）才清+`bindingRecoveryFace?.enqueue` 恰一次 |
| settle 调用 ×4 | :421 / :930 / :1063 / :1090 | store 成功（stash confirm 后）/ retryPersist 成功尾 / handoffPendingToSpool 成功 / handoffOnUnload 成功 |
| replay 内联 | :1009-1017 | **enqueue 无条件**（:1010 先行）+双门条件清（:1014-1016）——与 settle 副作用契约相反 |
| discard | :449 | discardForGoneProject 终态清（零恢复入队；store :308 另一直接入口）——**自文档唯一必然执行点** |
| onProjectGone | :1207 | 终态清——**与 :1213 必经的 discard 幂等双删，本卡删除**（§0.4-2 终局） |

- **谓词家族**：hasPendingWrites(:779，仅队列)/isPersistedComplete(:773，三态)/writesSettled(:791，三态)/settle 双门（队列+spool、无 inFlight——:581-582 与 :1014 两份内联副本；handoffPendingToSpool 成功路径不 leaveInFlight 即 settle，三态门会误挡并发在飞形态）。
- **行为锁覆盖面**：unit=spec.ts:164-296 C1 恢复链族（盖标记/申报/settle〔经 :421〕/replay 正分支；discard/onProjectGone/:930/:1063 无标记级直接断言；**:1090 全仓零测试**）；:269 只断言 `toHaveBeenCalled()`。int=import-maintenance-coverage.int.spec.ts ①-⑤（322 行；⑤=handoff 成功不结算负分支）。verify full 不含 int 池（vitest.config.ts:13/verify-manifest 无 test:int 步/plan :217 明文）。
- **FK 路径 wart（本卡根修，§0.4-1）**：retryPersist 帧通道 FK 分支（:918-924 confirm+`deletedProjects.add`+continue）循环结束后 :930 无守卫 settle → 已删项目 enqueue 一次 → runner `runProject` 行缺 bailed（:173）→ **notBefore 5 分钟污染 pid**（:150-151——restore 复建后 rebuild 被挡）；且 :932 setPersistStatus(true) 清电平+广播 healthy。store 主路径 FK 走 onProjectGone 后 return，无此面。
- **锚实测**：persistence **1242/1242**、SG **1414/1414**；SIZE_LIMITS:22 历史链 950→1242=**14 个标值、13 次上抬**；自测硬断言三处（test.mjs:55/:81/:97-101）；.mjs:17 头注「十三文件」陈旧（实际 17 项）；persistence 头注 :4「行数锚 ≤1037」陈旧（SIZE_LIMITS 为权威）。
- **face/回灌消费面**（tracker 契约注记用）：gateway :480 setBindingRecoveryFace=运行期专用（persistence.reconcileSpool+releaseImportCoverage 消费）；boot replayAll 回调 :1005-1010 **直连** bindingBackfill（不经 face）；:1017 rearmQueues（「listen 前调用=先备恢复路径后受理」=有意次序）；runner.enqueue=纯内存 Set+unref timer 非抛。

## 2 不变量（重构判据）

1. 九物理点语义逐字保持——**例外三处**：replay 谓词操作数序（改写等价性依据——两处同调 importBytesLanded 后代码中不再存在双序）；**:1207 删除**（onProjectGone :1205-1215 全同步无早退+Set 删除幂等+守卫兜底——§0.4-2 终局）；**FK 终态守卫微修**（唯一有意行为变化——红先行⑨+commit 显式披露）。
2. **既有 C1 恢复链 unit 红测（:164-296）+ int spec ①-⑤ 零删改、重构前后全绿**（测试面=行为锁，禁删断言迁就；新增用例不属删改）。
3. importPending 状态单点：collab-persistence.service.ts 内 `grep -in "importpending"` = **0 命中，无豁免**（`settleImportPending` 更名后**全仓零命中**）；C1 测试标题不动。tracker 为唯一权威。
4. 行为红线：除 FK 终态守卫微修（红先行⑨：已删项目 enqueue 0+电平保持）外**零行为变化**；无 API/DB/配置/观测面变更；回滚=revert 单笔 commit。
5. 锚纪律（§4-T3）：persistence 收紧至实测、SG 不动、新文件实测×1.3、自测 8 处同批。

## 3 机制设计

- 新文件 `apps/api/src/modules/collab/collab-import-tracker.ts`——零依赖叶子（不 import Nest/Y/prisma/persistence），纯状态机、全同步、零定时器：

```ts
/** C3a-8 修复批 C1（卡①抽取）：进程内 import 覆盖标记的唯一所有者（原 persistence.importPending）。
 *  只覆盖「本进程 import apply → 字节进 PG」窗口。重启后为空是对的——持久权威是 CanvasDoc.
 *  bindingsDirty；boot 回灌在 collab.gateway.ts:1005-1010 直接 markDirty/enqueue，不读本 Set，
 *  也不经 :480 的 face（face 只服务运行期 reconciler 与 releaseImportCoverage）。
 *  release 零副作用（只清标记）——enqueue 只发生在 releaseImportCoverage（清了才入队；已删项目
 *  只 forget 不入队）；reconciler onReplayed 无条件入队且只调 release——两变体 enqueue 时机契约
 *  不同，按最小行为面保留双变体；如未来合并须引入回退分支并补恰一次/顺序断言。
 *  purgePersistenceState 不清标记=有意语义（thaw 后保守申报直至下次落定），勿补。
 *  landed 只由 persistence.importBytesLanded 计算（全文件实参仅两处生产点）。 */
export class ImportCoverageTracker {
  private readonly pending = new Set<string>();
  mark(pid: string): void { this.pending.add(pid); }                    // 幂等；仅 origin=import（调用方守）
  isUncovered(pid: string): boolean { return this.pending.has(pid); }
  /** 仅当仍标记且 landed 时清除；返回 true=本次发生清除。landed 只允许 importBytesLanded 的返回值传入。 */
  release(pid: string, landed: boolean): boolean { return landed && this.pending.delete(pid); }
  forget(pid: string): void { this.pending.delete(pid); }               // discard 终态+落定入口已删分支（幂等）
}
```

- persistence 接线（**replay :1010 enqueue 行零触碰**）：

```ts
private readonly importTracker = new ImportCoverageTracker();          // 零构造依赖（无 this 引用）

/** 导入字节已不在队列、也不在 spool。不含 inFlight：inFlight 表示 store 段仍在执行，不是字节
 *  还没进 PG（handoff 成功路径不 leaveInFlight 即落定——三态门会误挡）。禁以 isPersistedComplete/
 *  writesSettled 替代（含 inFlight 维=时序耦合）。 */
private importBytesLanded(projectId: string): boolean {
  return !this.hasPendingWrites(projectId) && !this.spool.hasFrames(projectId);
}

/** 清标记与 enqueue 同生同灭（恒在本函数体）。已删除项目只 forget 不入队（FK 终态守卫——runner
 *  对行缺项目 bailed+5min notBefore，入队会污染 restore 复建 pid）。保持今日短路序：未标记不评估
 *  谓词。face=null=直构/测试豁免；生产由 gateway 构造接线保证恒在。 */
private releaseImportCoverage(projectId: string): void {
  if (this.deletedProjects.has(projectId)) { this.importTracker.forget(projectId); return; }
  if (!this.importTracker.isUncovered(projectId)) return;
  if (!this.importTracker.release(projectId, this.importBytesLanded(projectId))) return;
  this.bindingRecoveryFace?.enqueue(projectId);
}
```

```ts
// retryPersist 成功尾（:930-932 →）：
this.releaseImportCoverage(projectId);
this.cancelPersistRetry(documentName);
if (this.deletedProjects.has(projectId)) return;   // FK 终态守卫后半：已删项目不广播 healthy/不清电平
this.setPersistStatus(documentName, true);
```

| 物理 | 改法 |
|---|---|
| :226 | `this.importTracker.mark(importPid)` |
| :449 | `this.importTracker.forget(projectId)` |
| :573 | 删 importPending 声明（:568-572 文档注释迁 tracker 头注；:575-578 settle 文档注释迁落定方法/头注） |
| :421 / :930 / :1063 / :1090 | `this.releaseImportCoverage(projectId)`（单行改名——T2 全锁定下机械改写） |
| :579-585 | settleImportPending → releaseImportCoverage（更名+方法体如上，含 FK 守卫） |
| :593 | `const uncovered = this.importTracker.isUncovered(projectId);` |
| :1009-1017 | `bindingFace.enqueue(pid);` 行原样 + 注释保留 + :1014-1016 缩为 `this.importTracker.release(pid, this.importBytesLanded(pid));`（**不调 releaseImportCoverage**——回灌 enqueue 无条件，并入=满落定时多排一拍 drain+破坏无条件不变量） |
| :1207 | **删除**（证明注释一行入 onProjectGone 头注：终态清单点=discardForGoneProject〔自文档唯一必然执行点〕） |
| 文件头 :4 | 「行数锚 ≤1037（…）」→「行数锚以 SIZE_LIMITS（check-collab-module-size.mjs）为准」 |
| gateway:465 | 「persistence importPending → sink opts」→「persistence import 覆盖标记（ImportCoverageTracker）→ sink opts」 |
| recovery-import:301 | 「importPending 申报未覆盖→队列清空后 bindingRecoveryFace.enqueue」→「tracker 申报未覆盖→字节全落 PG 后 releaseImportCoverage 入队」 |

## 4 TDD 切片

1. **T1 tracker 独立单测（红先行）**：新 `collab-import-tracker.spec.ts`——纯布尔矩阵 7 例：初始未标记（isUncovered=false/release(true)=false 零清除）/mark 幂等/landed=false 保持/landed=true 清除/**恰一次**（二次调用 false）+forget 后再武装/forget 终态（未标记 no-op）/跨项目隔离。措辞用「landed 条件」；价值定位=状态机自证（真正行为锁=T2 wiring+既有 C1/int）；:241 stash-confirm 时序锁归 T2 既有用例。
2. **T2 接线（重构判据）**：
   - **前置基线**：HEAD 单跑 `import-maintenance-coverage.int.spec.ts`（DATABASE_URL 本地）确认基线绿——无基线的「重构后红」不可归因。
   - **红绿序**：**①-⑧ 先在现码上写齐并全绿**（characterization——锁现状行为）→ **⑨ 红先行**（FK 守卫——现码必红：防把 wart 锁死）→ 改写（4 改名+4 委托+:1207 删除+守卫×2+字段+谓词）→ **①-⑨ 全绿**。
   - 既有 C1 族 :164-296 **零删改全绿**+全量 persistence spec 绿。
   - **9 组 wiring 用例**（行为断言优先：enqueue spy 次数/sink opts/后续维护写不再申报；白盒 isUncovered 仅终态路径①②⑦⑨）：
     - ①import 写+deletedProjects 终态短路→标记清∧enqueue 零调用（:449）
     - ②onProjectGone→标记清∧enqueue 0（经 :1213 discard 路径——**双清不可观测，不断言 forget 次数**）
     - ③import 写+PG 首挂（帧入 spool、队列已 splice、无新增写、**doc 不活**）→retryPersist **detached 帧通道**→标记清∧enqueue **恰一次**（:930）
     - ④handoffPendingToSpool（**queue 非空**——空队列早退 true 不 settle）：成功（spool 清）→恰一次；spool 未清形态→不结算（:1063）
     - ⑤replay 链 enqueue **恰一次**+残留形态（spool 或队列任一残留→标记留；新用例补 :269 弱断言面）
     - ⑥handoffOnUnload（**:1090 全仓零测试——本组为唯一覆盖**）：成功（sink 落定、spool 清）→enqueue 恰一次；失败支（sink 抛）→标记保留
     - ⑦purgePersistenceState 负测：import 写→purge→isUncovered 仍 true
     - ⑧inFlight 不阻挡落定：import 写+队列空+spool 空+白盒置 `inFlightProjects.add(pid)`→直调落定方法→清除∧enqueue 恰一次（「禁三态谓词」可执行契约）
     - ⑨**FK 终态守卫（红先行）**：import 已标记→detached 帧通道→sink 逐帧 FK（全帧 discard+confirm）→队列空∧spool 空→期望 **enqueue 0 调用+标记已清+（预置不健康电平则）电平仍在**——现码 enqueue 一次+电平被清=红；守卫+跳过=绿
   - **残留扫描三口径**：`grep -in "importpending" collab-persistence.service.ts`=0（无豁免）；全仓 `settleImportPending`=0；enqueue 调用点（`bindingRecoveryFace?.enqueue`/`bindingFace.enqueue`）全文件=2（releaseImportCoverage+onReplayed）。
   - **实测净减披露**：实测行数差回填本 spec §5 与 commit。
3. **T3 出口**：
   - 新文件入锚（实测×1.3 向上取整）+**persistence 锚收紧至实测值**+SG 不动+**自测 8 处同批**：check-collab-module-size.mjs:17 头注「执法锚十三文件」→「十八」（顺手纠正 4 文件陈旧）+新文件补列；test.mjs:51/:53「十七」→「十八」、:55 keys.length 17→18、追加 `keys.some(k => k.endsWith('collab-import-tracker.ts'))` 断言、:82-95 追加新文件精确值断言、:81 persistence 值→实测（注释链追加**反向收紧**条目）、:97 标题→「十八」。
   - census 门（verify fast 已含——实跑绿即证据）；`pnpm --filter @flowweb/api test -- --run` 绿。
   - **int 全套**：`DATABASE_URL=<本地> pnpm --filter @flowweb/api test:int` 全套绿（verify 不替代；本卡语义必须绿=import-maintenance-coverage ①-⑤；flake 单文件复跑定性并记录；证据记命令/环境/结果/重跑记录——禁跳过/静默过滤）。
   - `pnpm verify` full 36/36；commit 消息含**实测行数差+int 结果+锚反向收紧依据+「已删项目不再从落定入口入队/不广播 healthy」行为变化披露**；单笔 commit（卡②各项不混入）。

## 5 残余与登记

- 卡②收口袋另行轻量 spec，本卡新增登记三项：①`yjs_import_pending_projects` gauge（标记滞留无观测面——届时需 tracker.size()）；②卡②排序：若任一项需往 persistence 加行，走「净增面非膨胀+有意识抬锚+自测同批」既有程序——禁临场静默抬锚；③（原有）runbook :809/M6 flush 撞拒观测面/shadow 非预算 skip 完备性/TD-32 33 Minor×11。
- **谓词组合候选（片 2 邻位，本卡不做）**：`isPersistedComplete = importBytesLanded ∧ ¬hasInFlightStore`、`writesSettled` 委托——触碰 flushDocument/缓存门/vacuum 消费面，须独立卡带各自红测。
- **分解路线图（登记不排期**，各自独立 spec/plan/TDD；成本注意=接口面高于行数估算**）**：片 2=retry 梯+persist-status 健康面族（~150 行）；片 3=drain/关停族（~130 行）。片 1+2+3 落地后 persistence 警号方谈解除。
- 锚治理留档：本卡=13 次上抬（14 个标值）后**首次反向**（收紧）——SIZE_LIMITS:22 注释链追加反向条目。
- **实测净减披露位**（T2 后回填）：persistence 实测 1241 行，净 -1 行。

## 6 明确不做（范围纪律）

- 不改双门语义（不加 inFlight——wiring ⑧ 为其可执行契约）。
- 不动 replay :1010 enqueue 行、不把回灌并入落定入口（runner 定时器语义不变）。
- 不加 gauge/metric/size() 读面（观测面归卡②）。
- 不动 isPersistedComplete/writesSettled（谓词组合=片 2 邻位候选）；不抽退避梯/维护通道/drain 族（片 2/3 另立）。
- 不动 SG/其余 16 锚文件；C1 测试标题不动；除 FK 终态守卫（⑨）外无任何有意行为变化。
