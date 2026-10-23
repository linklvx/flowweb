# Y1c T0-S2 spike 结论：vacuum 离线重连推演（三形态 × 旧 #g auth 拒→DraftEnvelope→清缓存→新 name 导入）

- 装置：`apps/api/src/modules/collab/collab-vacuum-stale-client-resurrection.spec.ts`（主池 5 用例，纯 Yjs 零服务/零 DB/零网络，单文件 ~1.5s；真 `CollabDocRegistryService` 直构复用生产 `rebuildVacuumDoc` 单源，非手抄复刻）。
- 依据：spec v5.4（2026-10-23-y1c-doc-model-carrier-contract-design.md）偏离 27/§1.9「vacuum 洞全链」/§4.5/§9；plan v1.7 Task 0 S2。
- 结论一句话：**现状 SV 代际门只漏「部分陈旧客户端」一形态，但该形态 SS2/Update 双路径均实测复活已删内容、且旧值覆盖胜负=fresh clientID 掷硬币——SV 谓词层防不住也防不全，D2 的 docName 世代 auth 拒绝（auth 层、先于装载/SS1/上行）是唯一结构性正确的 gate 层**；另发现两项对后续卡的硬输入（4410 载荷形状、v4 嵌套类型×vacuum 静默别名）。

## 0. 结论速览

| 项 | 结论 | 证据锚 |
|---|---|---|
| 形态① 旧缓存（clean 全同步）重连 | 现状：SS1 谓词拒（own/A/D clock==pre）→4410 `doc-generation-stale`→web safeReload('generation') 自动链。目标：auth 层拒（同结果、更早、不装载） | Phase D 真值表；registry :687-696；runtime :1549-1557 |
| 形态② 旧 SV 全 clock<pre（部分陈旧）重连 | 现状：**放行**→SS2 无校验 apply→**已删节点原样复活+旧 entry 整条覆盖真空值+churn 历史整段回流**（实验锁定）。目标：auth 层拒（旧 #g generation mismatch——不 SS1/不上行） | Phase A/B/C 实验；spec §1.9 判定实证成立 |
| 形态③ dirty draft 重连 | 现状：SS1 谓词拒（own clock>pre——离线编辑未上行）→脏编辑困本地，.yjs 导出自救。目标：auth 拒→DraftEnvelope 导出（B/C 场景用户裁定式）→清缓存→新 name 导入 | Phase D；runtime :596-605/:634-643 |
| Update 帧路径 | SV 谓词只活在 SS1 分支——同一批旧 structs 走 Update 帧复活结果逐项同因同果（实验锁定）⇒ gate 必须在帧携带 generation/身份层 | Phase C；registry :678-698 vs :705-779 |
| Y.Map 并发覆盖胜负规则 | **clientID 比较（YATA id 决胜），非 clock**——fresh vacuum clientID 随机 ⇒ 覆盖=掷硬币事件；语料钉作者端 uint32 上界使覆盖确定性复现 | Item.js :472 + :510-514（integrate）/:116-117（splitItem）+ AbstractType.js :889-893 + Phase B |
| preVacuumSv 播种现状 | 仍在役：装载播种（loadDocument 读 CanvasDoc.preVacuumSv→preVacuumSvCache）+ SS1 消费——目标链「退役」=T27 换代状态机落地时拆除 | registry :186-192/:398-400/:687-696 |
| 4410 载荷现状 | close reason 双值 `doc-vacuuming`/`doc-generation-stale`，**无 {generation, discardLocalCache:true} 载荷**——目标载荷=T5a 客户端半链落 | shared collab-close-code.ts :54-55；runtime :1549-1557 只按 reason 分型 |
| docName #g 现状 | 语法冻结未接线：web 构造恒 `project:${pid}`（无 #g）；api `isValidDocName` 现状**拒**带段名（#g=同型别名分叉防执法绕过）——Y1c-1 启用时改放行+isGenerationMismatch 对比 DB 列 | runtime :1601；doc-name.util.ts :36-45 |
| 缓存键换代行为 | 四维键 (uid,pid,generation,schemaVersion)——generation 变（vacuum++）即换键=新库；旧代库靠 purgeForeignCaches 清（safeReload('generation') 固定次序）——「清缓存」半链现状已就位（DraftEnvelope 导出与「换代前先存脏草稿」未落） | local-cache-key.ts :24-26/:71-78；runtime :634-643 |
| **发现 F-S2-1**（v4 前瞻） | **rebuildVacuumDoc×嵌套 Y.Text = 静默跨 doc 别名**（不拷贝不拒绝；源 doc destroy 后别名实例仍可写=对已亡 doc 结构空间继续写）——T15/T16/T18/T27 必须先扩 records 重放/deepCopyYMap 或先拒（unsupported 形态） | Phase E 实验（行为锁） |

## 1. 三形态语料表（全链 × 现状/目标）

链：**旧 #g auth 拒绝 → DraftEnvelope 导出（三场景表 A/B/C）→ 清缓存 → 新 name 重连导入（新 Schema/权限/图结构校验）**。每格=客户端持有面/现状服务端行为/目标链行为/代码锚。

| 阶段 | ① 旧缓存（clean 全同步） | ② 旧 SV 全 clock<pre | ③ dirty draft |
|---|---|---|---|
| 客户端持有面 | server 终态整份（SV==preVacuumSv）；本地 IDB 快照 clean（unsyncedDirty=false） | t0 截断旧视图（含已删节点活体+旧字段值）；SV 全部条目 clock<pre | server 已知前缀+离线新编辑（own clock>pre）；IDB unsyncedDirty=true（clean 禁覆盖 dirty 守卫） |
| 现状·SS1 门（registry :687-696） | **拒**：own/A/D 任一 clock≥pre → hardClose 4410 `doc-generation-stale`（谓词 Phase D 实测） | **放行**：谓词只查「客户端 SV 中出现的 client 且 clock≥pre」——pre 中存在而客户端 SV 缺席的 client（如删除者 D）不触发；全部条目 clock<pre 不触发 | **拒**：own clientID clock>pre（离线编辑未上行）恒成立 |
| 现状·后续 | close→web resolveCloseAction terminal→safeReload('generation')：导出标注旧代 .yjs→purgeForeignCaches→1.5s reload（runtime :596-605/:634-643/:1549-1557） | 服务端回新真空 doc SV→客户端 SS2=diff 形（writeSyncStep2=encodeStateAsUpdate(doc,serverSv)——y-protocols sync.js :59-62/:72）→**无校验 apply→复活+覆盖+垃圾回流**（Phase A/B：n2 复活/n1 'current'→'old'/编码字节膨胀>旧代一半） | 同①路径；脏编辑不经 SS2（hardClose 清消息队列——§1.9 esm:470-476），仅导出文件留存 |
| 现状·Update 帧旁路 | —（不重发） | **同因同果**：Update 帧不经 SS1 分支（guardSyncFrame :678-698 只判 SS1；Update 只过帧闸/速率/只读/配额 :705-779）→Phase C 实测复活同 A/B | — |
| 目标·auth 层（D2 偏离 27） | 旧 #g 连接在 auth/装载层 generation mismatch（isGenerationMismatch 对比 DB 列——doc-name.util.ts :43-45 铺位、Y1c-1 启用 isValidDocName 放行 ：36-39）→**三形态一致**：不装载/不 SS1/不上行旧 structs | 同左（结构性无「前缀漏网」形态——世代身份非 clock 关系） | 同左 |
| 目标·DraftEnvelope 导出 | A 场景（同代双标签）不适用；换代=C 场景：类型化导出清单（draftId/generation/schemaVersion/nodes/edges/meta/hashes——非 CRDT 裸字节） | C 场景（换代导入）：nodeId 稳定不重映射+边指向缺失丢弃报告+确认面三行（内容节点数/丢弃引用数/不恢复产物·历史·计费） | **换代前先保存可恢复脏草稿再清**（禁静默丢——spec §3.4）；B 场景（同代拒帧）=用户裁定式逐字段二选一 |
| 目标·清缓存 | 4410 `doc-vacuuming` 载荷 {generation, discardLocalCache:true} 显式清整族（generation 变更清整族——spec v5-11）；现状代位=四维键换代即新库+purgeForeignCaches（local-cache-key.ts :71-78） | 同左 | 同左（先导出后清） |
| 目标·新 name 重连导入 | 新 #g 空文档+服务端水合（无旧 structs 参与） | **导入=单飞+幂等键+≤8MiB+服务端候选 doc 全量校验（新 Schema/权限/图结构/XML 白名单——恢复流程非兼容层）**（spec §4.5 Envelope 段） | 同左；执行按钮需重新生成（状态 unknown） |

## 2. 实验（5 用例全绿；关键行为锁）

语料：作者端 A（clientID 钉 uint32 上界——见 §3 规则）建 10 filler+100 次 rev churn+n1('old')+n2 → 部分陈旧查看端 C 在 t0 截断同步 → A 改 n1='current' → 删除端 D 删 n2 → server 终态。vacuum=真 registry.rebuildVacuumDoc（fresh clientID 重放活 records）。

- **Phase 0（前置）**：server 终态 n1='current'/n2 无；C 持旧视图（n1='old'/n2 活）且 SV 全 clock<pre（谓词放行前提逐 client 验证）。
- **Phase A+B（形态② SS2 注入）**：`applyUpdate(vacuumed, encodeStateAsUpdate(C, serverSvAfterVacuum))` → ①n2 复活（`dead-man-walking` 原样回归——真空 doc 零墓碑，无任何东西抵消旧 structs）；②n1 观测值 'current'→'old'（旧 entry 整条胜出，fresh 子树成孤儿）；③编码字节膨胀，复活后>旧代编码一半（100 次 churn 历史整段回流+双份 n1 子树）。
- **Phase C（Update 帧路径）**：同一批 structs 直达 apply → 复活+覆盖同 A/B——SV 谓词与帧路径正交。
- **Phase D（SS1 谓词真值表）**：①拒/②放行/③拒（复刻 registry :687-696 逐字语义）。
- **Phase E（v4 前瞻探针）**：`data.content=new Y.Text()` 形状过 rebuildVacuumDoc——不抛不拷：新 doc 的 content 与源 doc **同一 Y.Text 实例**（readRecordsFromMaps `Object.fromEntries` 原样带出+fillDoc `data.set` 原样置入，跨 doc 零校验）；源 doc destroy 后经新 doc 视图 `insert` 仍成功且可读——静默腐坏类（发现 F-S2-1）。**「不抛」=API 层语义**：运行输出含一条 yjs 内部 console.error TypeError 的 stderr 噪音（YText.js:887-893 `_integrate` catch——别名实例在 rebuild 的 fillDoc `data.set` 二次集成瞬间 `_pending=null`→`null.forEach`，yjs 内部吞掉不外抛）——套件输出该噪音属预期，非用例失败。

## 3. 发现登记

- **F-S2-1（对 T15/T16/T18/T27——硬输入）**：rebuildVacuumDoc 的非 Map 根守卫（registry :629-632）只看**根**类型；nodes/edges 的 records 重放（readRecordsFromMaps→fillDoc）与其余根深拷贝（deepCopyYMap :83-91——Y.Map 递归、其余直拷）均未覆盖嵌套 Y.Text/XmlFragment。v4 形状下 vacuum **静默产跨 doc 别名**（Phase E 行为锁）。裁定输入：T15/T16 落形状与 T27 vacuum 委托换代状态机之间必须排入「vacuum 对嵌套类型先扩（typed 重放）或先拒（unsupported-root 同款降级导出通道）」——否则 v4 一落地 vacuum 即产腐坏 doc。
- **F-S2-2（对 T5a/T25——载荷形状）**：4410 现状只有 close reason 双值（shared collab-close-code.ts :54-55），无 {generation, discardLocalCache:true} 载荷；web 消费侧（runtime :1549-1557）也只按 reason 分型走 safeReload('generation')。「换代前先保存可恢复脏草稿再清」（spec v5-11/§3.4）当前无承载点——T5a 客户端半链/T25 DraftEnvelope 落载荷与「先存后清」次序。
- **F-S2-3（对 plan v1.7 主体——无推翻，一处精化）**：spec §1.9 称复活含「旧值覆盖」，实验精化其机制=**Y.Map 并发 slot 冲突由 clientID 决胜（Item.js :472「The id decides which item comes first」+ :510-514 _map head 落位〔integrate；splitItem 同款 :116-117〕+ AbstractType.js :889-893 typeMapGet 读 head），clock 只判因果不判胜负**。fresh vacuum clientID 每次随机 ⇒ 每对 (旧 client, fresh) 覆盖与否=掷硬币——比「覆盖必然发生」更糟：不可预测、逐键独立。此规则同时是 T24 候选验证/T5b RuntimeProjection merge（nodeVersion 大者胜的 LWW 语义）设计时须区分的底层语义（CRDT map 冲突≠应用层 LWW）。
- **F-S2-4（对 Y1c-1）**：`#g` 冻结未接线现状核实成立——web 恒 `project:${pid}`（runtime :1601）；api isValidDocName 现状拒带段名（执法分叉防御），启用时改放行+双校验点（onAuthenticate∧onLoadDocument）+withDoc 三入口统一（doc-name.util.ts :30-39 注释钉死）。本 spike 无需改其现状。
- **无发现推翻 plan v1.7 主体设计**：preVacuumSv 门仍在役（目标=退役非现状拆除）、4410 双 reason 现状与 T5a 载荷扩展相容、缓存键四维换代行为与「清整族」目标相容（缺的只有载荷显式触发与 DraftEnvelope 面）。

## 4. 「为何 auth 世代层而非 SV 谓词层」论证收口（Phase C+D 合成）

1. 谓词的信息面只有 clock 关系：缺席 client 放行（②无 D 条目）、前缀 clock 放行（②A 条目 clock<pre）——「部分陈旧」是结构性放行集合，非边角。
2. 谓词的作用面只有 SS1 分支：Update 帧（以及任何非 SS1 递交路径）结构性绕过（Phase C 实测同果）。
3. 谓词的时序在装载后：被拒连接也已装载 doc（现状 4410 在 guardSyncFrame 内）；目标 auth 层先于装载/SS1/上行——服务端旧代 doc 根本不进内存（与 T27 维护状态机 SWITCHING 事务后 close 4410 语义同族）。
4. 三形态在 auth 层无需分型（世代身份不匹配即拒）；分型只发生在恢复 UX（A/B/C 场景表）——与 spec §4.5/偏离 27 一致。
