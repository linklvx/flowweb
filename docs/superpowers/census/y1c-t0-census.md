# Y1c T0-D census 固化（十一项+S1 遗留⑫）——机器可读版同目录 `y1c-t0-census.json`

> 基准 HEAD：`c5a3e3835a68`（2026-10-24）。全部行号按该快照实测（grep+逐文件核验）。
> 消费方：T2/T3（②）、T19（③⑤）、T22/T32（⑤⑥）、T9/T22/T32（⑥）、T5/T24（⑨）、T10（⑩）、T26/T5b（⑪）、S1 静态门（⑫）。
> 本文件零生产源码改动；census 静态门接线归 T5（check-collab-census.mjs 不动）。

## 与 plan 声称基准的对账结论（速览）

| # | plan 声称 | 实测 | 判定 |
|---|---|---|---|
| ⑦ | 39 裸 `project:${pid}` | 生产代码（非 spec/test）**恰 39 处**；测试另有 29 处 | ✅ 一致 |
| ②-1 | audioGen prompt 住 `content:string`（AudioConfigPanel textarea） | AudioConfigPanel.tsx:45/:155/:210 全写 content；AudioNodeData 无 prompt 键 | ✅ 证实 |
| ②-2 | `multiImageGen.prompt`=零写点死字段 | 声明 nodeStore.ts:175；web/api 全仓零写点；:512 `data?.prompt?.text` 对 string 恒 miss | ✅ 证实 |
| ②-3 | textInput `data.prompt:string` 每键击落 doc | TextConfigPanel.tsx:211 → applyNodeDataPatch:585 → applyIntentToDoc:157 `data.set`（同值 no-op diff 守卫，异值即写） | ✅ 证实 |
| ②-4 | 执行读点 :512 现状 `.text` miss string | execution.service.ts:512 `data?.prompt?.text ‖ data?.content`——string 形态恒 miss | ✅ 证实 |
| ②-5 | :157 覆盖写（bug② 前半） | TextConfigPanel.tsx:157 生成时 `{content: prompt}` 覆盖 | ✅ 证实 |
| ⑫ | withDoc:78 在役（readCanvas/shrink/export） | ✅ 且发现 residency:445 通道现役承载业务 doc 写（见 F-3） | ⚠️ 增补发现 |
| ⑧ | per-tab 缓存 | 现行键=四维 (uid,pid,g,s) **无 tabId**——跨标签 LWW+dirty 守卫 | ⚠️ 措辞修正 |

**发现清单（F 编号）**

- **F-1（bug① 锚）**：`nodeStore.ts` 裸 `'text'` 字面量恰 4 处：:225（isTextNode 判 `'text'`，真实类型 `textInput` 恒 miss）、:619（updateText 幽灵条目 `type:'text'`）、:719、:725（updatePromptImages 判 `'text'`）。与 plan Task 1 的锚（:20,:225,:719,:725）吻合。
- **F-2（⑨ 口径需 T5 裁定）**：`Y.applyUpdate` 生产显式调用 **14 点/8 文件**中仅 4 点属 inbound-doc-apply（load×2/import×1/boot load×1），其余 10 点全为离线 scratch/临时 doc（compact/decodeSnapshot/shrink×2/integrity-probe/diverged 导出 tmp）。T5 立门须明确「其余零」按 *inbound* 语义执法（scratch 域合法）还是裸调用清零（按裸调用解读=缺口 10 点，全部 scratch 域）。计数模式见⑨节（stated pattern——初版「147 测试」宽松过滤已废，改 145+2 e2e 装置）。
- **F-3（⑫ 实质发现）**：「serving 期业务 doc 写经 DirectConnection=0」现状**不成立**——`collab-residency.service.ts:445` 常驻会话通道承载全部 withSession(write) 业务写（writeExecStatus/deliverArtifact/writeBatch，上游 13 写点，见⑤⑥）。该门只能以登记红（until=T22/T32）形态先行。
- **F-4（⑧ 措辞）**：现行缓存非 per-tab——四维键每库单记录 `'snapshot'`（IDB store `'kv'`），跨标签 last-writer-wins+dirty 不可覆盖守卫（local-collab-cache.ts:150）。plan T5c「缓存键五元（+historyId）」与 T28 增量投影均为目标态。
- **F-5（① 全集）**：节点类型全集=**8**（CanvasView.tsx:57-65 nodeTypes 注册表为真值）；`NODE_TYPES`（nodeStore.ts:17）仅 6 键非全集——snapshot-filter.util.ts:2 头注自证。执行面 6 类型（videoEdit/group 不可执行，is-executable-node.ts:2）。

---

## ① 节点类型全集（8 类型 × 生命周期路径）

全集：`textInput / imageGen / imageExtGen / videoGen / audioGen / multiImageGen / videoEdit / group`

| 类型 | 创建 | 保存（落 doc） | 加载 | 执行 | 导入/导出 |
|---|---|---|---|---|---|
| textInput | AddNodeMenu:92 'text'→nodeTypeMap:160 | updateNodeData（content/prompt/model 每键击） | readRecordsFromMaps | ✅ kind=text（:514） | 快照白名单 ['content','prompt']；本地备份/克隆 |
| imageGen | AddNodeMenu:93 'image'→:161 | PromptValue{prompt.text/html}等 | 同上 | ✅ kind=image（:583） | 快照 10 键（snapshot-filter:41） |
| imageExtGen | AddNodeMenu:94 'imageExt'→:162 | extConfig 整体+根级 | 同上 | ✅ kind=image | 快照 6 键（:57） |
| videoGen | AddNodeMenu:95 'video'→:163 | prompt:PromptValue+trim 域 | 同上 | ✅ kind=video（:536） | 快照 8 键（:58） |
| audioGen | AddNodeMenu:97 'audio'→:164 | **content:string**（无 prompt 键） | 同上 | ✅ kind=image | 快照 ['model','content']（:58） |
| multiImageGen | AddNodeMenu:98 'multiImage'→:165 | images/mainImageIndex/nodeStatus 等 | 同上 | ✅ kind=image | 快照 ['prompt','label']（:59） |
| **videoEdit** | AddNodeMenu:96 **直通**（nodeTypeMap 无→canvasStore:882 `\|\| type` 保名；:900 默认宽 320） | 结构仅 envelope（轨道数据住 VideoProject PG 非 doc） | VideoEditNode（CanvasView:64） | ❌ 不可执行 | 快照 data 全剥（WHITELIST.videoEdit=[] :46）；克隆 dropTypes 剥除（video-work-clone:39）；删除级联删 VideoProject（canvasStore:131/:968/:1661） |
| **group** | 仅两路径：canvasStore:2191（normal 打组）/ :2711（storyboard 分镜组）——无 UI 直建 | data={groupType,name,storyboard,collapsed,...}+order；cells 派生禁入 doc（docShape:199-203 剥） | GroupNode+键集表（docShape:205-228 组帧键模式） | ❌ 不可执行 | 快照 4 键/克隆 7 键（GROUP_NODE_DATA_KEYS） |

关键路径锚：AddNodeMenu:91-99（7 项）→ addNode:910 → addNodeInner:880-908 → dispatchCanvasIntent:918（doc 首写+投影回填）；意图 doc 写单源=canvasIntents.applyIntentToDoc:138；种子=docShape.fillDoc:71；genesis=project.service.ts:73/:77。

## ② 全类型字段路径（envelope+data 键树）

**envelope（8 类型同构）**：`NODE_ENVELOPE_KEYS = [id, type, parentId, width, height, position, data]`（nodeEnvelope.ts:19，双向编译锚 :24-26）。写侧 fillDoc（docShape:79-88——键集表跳过：无键不写）；读侧 readRecordsFromMaps（docShape:107-122——null≡缺键）。

**data 键树（类型接口真源 nodeStore.ts:107-186 + 快照白名单 snapshot-filter.util.ts:37-51 + 组键集 types/group.ts:27-30）**

| 类型 | data 键（nodeStore 接口） | 执行链读 | 快照面（WHITELIST） |
|---|---|---|---|
| textInput | content:string + prompt?:string + model + order/slot | :512（.text miss string）+topology:83 content | content,prompt（:38） |
| imageGen | 根级通用 13 键 + style/styleId/styleName/model/quality/ratio/resolution/prompt:PromptValue | :512 .text ✅（对象形态命中） | prompt,style,model,quality,ratio,resolution,aspectRatio,styleId,styleName,slot（:41） |
| imageExtGen | imageGen 全量 + extConfig{ratio,resolution,quality,generateCount,prompt?} + aiTool | 同上（ext 值多在 extConfig 内） | prompt,aspectRatio,aiTool,styleId,styleName,slot（:42） |
| videoGen | model/status/fileId/aspectRatio/referenceVideo/ratio/prompt:PromptValue/styleId/styleName/allImages/trimStart/trimEnd/trimTaskStatus/trimmedFileId | :512 .text ✅ + startImageUrl/endImageUrl/imageUrls→mediaId 映射（:545-550） | model,ratio,prompt,trimStart,trimEnd,label,styleId,styleName（:43） |
| audioGen | model/content:string/status/fileId/referenceAudio | **content 腿**（:512 data?.content 兜底命中） | model,content（:44） |
| multiImageGen | label/images/mainImageIndex/expanded/nodeStatus/generationBatchId/prompt?:string | :512 .text ❌ miss（死字段） | prompt,label（:45） |
| videoEdit | （无独立 data 接口——结构仅 envelope） | ❌ | []（data 全剥，:46） |
| group | groupType/name/storyboard/collapsed/nameCustom/color（+order） | ❌ | groupType,name,storyboard,collapsed（:51；克隆面 7 键=CLONE_WHITELIST:57-60） |

横切键集：EPHEMERAL_DATA_KEYS={editMode,transformMode}（docShape:48 禁入 doc）；CANVAS_BRIDGE_KEYS（:49）；SERVER_NODE_DATA_KEYS 6 键（manifest:84）；SERVER_WRITABLE_DATA_KEYS=[fileId,result]（manifest:106，目标态）+CLIENT_FORBIDDEN_ON_UPDATE 同集（:112）；EXEC_STATUS_KEYS 10 键（manifest:94）；DOC_NODE_KEYS placement（placement.ts:20）。

## ③ readRecordsFromMaps 全调用点

定义单源：`packages/shared/src/canvas/docShape.ts:103`。

| 端 | 位置 | 场景 |
|---|---|---|
| web | ydocBuilder.ts:49 | readCanvasFromDoc 薄委托（全 web 读入口） |
| web | canvasIntents.ts:380 / :446 / :580 | 组帧 oracle / 组记录 / 差分尾 order 读 |
| api | collab-document.service.ts:127 / :151 | readCanvas 活读 / decodeSnapshot 快照投影 |
| api | collab-doc-registry.service.ts:411 / :635 / :660 | 装载病理观测 / vacuum 重建 / vacuum 等价校验 |
| api | collab-shrink.service.ts:132 / :163 | shrink 源读 / 影子预演 |
| web（经 readCanvasFromDoc） | canvasCollabRuntime.ts:815/:841/:973/:1309、canvasStore.ts:627、canvas-local-backup.ts:30 | reconcile/装载投影/缓存快照/差分/备份导出 |
| 守卫 | doc-shape-single-source.guard.spec.ts:3 | api 生产源码 docShape 符号直用零命中（T4 re-export 删除的现役防线） |
| test | adversarial-readers.spec / collab-document.service.spec:67 / collab-shrink.spec:611 / collab-vacuum-stale-client-resurrection.spec:201 / docShape.fillRead.test:53 / docShape.toDocRecords.test:208 / ydocBuilder.test:139 | 测试面（7 文件族） |

## ④ textInput prompt 全消费面

| # | 位置 | 类别 | 说明 |
|---|---|---|---|
| 1 | TextConfigPanel.tsx:31 | web 读（初始化） | `nodeData?.prompt ‖ ''` |
| 2 | TextConfigPanel.tsx:211 | web 写（每键击） | `{prompt: e.target.value}` → doc |
| 3 | TextConfigPanel.tsx:157 | web 写（生成时覆盖） | `{content: prompt}`——bug② :157（T2 删） |
| 4 | nodeStore.ts:109/:572/:585 + canvasIntents.ts:146/:157 | 写通道 | applyNodeDataPatch→intent→doc `data.set` |
| 5 | execution.service.ts:512 | **api 执行读点** | `.text` miss string（T2 改 resolvePromptText） |
| 6 | topology.service.ts:83-84 | api 上游注入 | 读 textInput `data.content`（非 prompt）——:157 删除后正文语义归正 |
| 7 | snapshot-filter.util.ts:122-126 | api 快照/克隆 | prompt 键透传（对象取 .text/string 原样） |
| 8 | ProcessSnapshot.tsx:43 | web 展示 | string prompt 展示（视频工作台） |

**结论**：textInput 执行链 prompt 供给现状=独占依赖 :157 覆盖写（:512 miss+topology 读 content）——T2 先红②的实证基础成立。

## ⑤ doc.exec 全触碰面（T22/T32 删除输入）

**写原语（api，collab-document.service.ts）**：applyWriteExecStatusToDoc :307-326（唯一写核心：exec map :311+代次守卫+逐键 set :324）；applyDeleteExecOrphansToDoc :378-387（孤儿删）；writeExecStatus :217-232；deliverArtifact :248-264（data+exec done 复合）；writeBatch op=collab-doc-writer.service.ts:151。

**上游写点（writeExecStatus 13 处+deliverArtifact 1+HTTP 端点+孤儿清扫）**：execution.service.ts:143/:298/:313/:331/:341/:384/:468/:481/:490（×9）；intent-reconcile.service.ts:481；ai-image-edit.processor.ts:239/:260；lighting.consumer.ts:225；projection-outbox.poller.ts:292（deliverArtifact——exec done 专写）；HTTP 端点 collab-write.controller.ts:64（worker 通道 exec-only）；孤儿清扫 intent-reconcile.service.ts:697。

**读点**：canvasCollabRuntime.ts:728（projectExecToStore）+:1995/:1996（首投影+observeDeep 订阅）；collab-doc-registry.service.ts:661（vacuum exec keys 等价比对）+rebuildVacuumDoc exec 根深拷贝搬运（deepCopyYMap，:81 注/:628 域）；web 消费=execStatusView.ts（selectExecStatus/execOverrideStatus）。

**契约面**：EXEC_STATUS_KEYS（manifest:94）；DOC_KEY_MANIFEST.exec（manifest:179-184）；NESTED_TYPE_CREATORS exec 条目（manifest:60-64）；DOC_WRITE_OPS.writeExecStatus（manifest:236-244）；WORKER_CHANNEL_OPS（manifest:273）。

## ⑥ 服务端写 doc 全路径（不变量验收输入）

| 通道 | 位置 | 分类 | 备注 |
|---|---|---|---|
| A·withDoc（DirectConnection :78） | collab-shrink.service.ts:101 | 维护写 | shrinkSync（deleteNodes 经 applyWriteOpsToDoc） |
| A·withDoc | collab-shrink.service.ts:132 | 读 | records 读 |
| A·withDoc | collab-shrink.service.ts:141 | 维护写 | exportFresh（applyFillDocToDoc） |
| B·withSession（DirectConnection residency:445） | collab-document.service.ts:220 | **业务写（serving 期）** | writeExecStatus（T32 退役面） |
| B·withSession | collab-document.service.ts:258 | **业务写（serving 期）** | deliverArtifact（T22 退役面） |
| B·withSession | collab-doc-writer.service.ts:222 | **业务写（serving 期）** | writeBatch 六 op 门面 |
| 装载 inbound | collab-doc-registry.service.ts:408 | load | spool 帧重放 |
| 装载 inbound | collab-persistence.service.ts:217 | replay | withReplaySuppressed 抑制窗 |
| 持久化链 | collab-persistence.service.ts:502/:539 | doc→PG（非 doc 变更） | debounce store（T9/T10 拆 telemetry-only 对象） |
| 维护 | collab-doc-registry.service.ts:628+ | vacuum 重建 | rebuildVacuumDoc（fillDoc+deepCopyYMap） |
| 种子 | project.service.ts:73/:77 | genesis | fillDoc+encode→CanvasDoc.state |
| 种子（非生产） | gate-canvas-state.ts:27 | gate 面 | census⑯ Z57 豁免 |
| 离线 scratch | repository:270-271 / document.service:149-150 / shrink:176/:323-324 / integrity-probe:14-15 | 读路径重放 | temp/scratch doc（createCanvasDoc+destroy） |
| CLI | scripts/collab-renumber-layer.mjs:73/:127 | 维护工具 | T19 修复载体 |

「serving 期零业务 doc 写」现状缺口=通道 B 三点（F-3）；通道 A 两写点属维护域（allowlist maintenance 档）。

## ⑦ 39 裸 `project:${pid}` ——实测精确一致

生产 39 处分类（总计 39 = 22+2+8+5+2）：

| 分类 | 数量 | 位置 |
|---|---|---|
| Yjs docName 寻址 | 22 | document.service:69/:78；doc-registry:572/:794/:817/:831/:860/:970；persistence:502/:539/:808/:925/:1005/:1006/:1008/:1016；session-guard:1205；residency:203/:445/:620；gateway:160；**web runtime:1601** |
| throw 消息 | 2 | document.service:70；residency:204 |
| 日志/遥测字符串 | 8 | residency:370/:460/:609/:626/:727/:742；canvas-doc-update.repository:177；collab-spool:219 |
| Socket.IO room（同字面非 docName） | 5 | execution.gateway:78/:89/:102/:113/:127 |
| 注释 | 2 | document.service:64；doc-name.util:32 |

测试另有 29 处（spec/test 文件）。docName 单源工具=doc-name.util.ts；换代 #g 后缀化（T12）与收口（T24/T32）为后续改造面。

## ⑧ per-tab 缓存现状与 IDB 键面（→F-4）

- **键**：`flowweb:collab:${uid}:${pid}:g${generation}:s${schemaVersion}`（local-cache-key.ts:14/:24-26）——**四维，无 tabId**。
- **IDB 结构**：每键一库；DB version=1（布局版本）；store=`'kv'`；单记录键=`'snapshot'`；记录体={snapshot:Uint8Array, unsyncedDirty, diverged, at}（local-collab-cache.ts:23-25/:34-42）。
- **写入预算**：≥1s trailing 去抖（:27/:187）+结构性 150ms 提前（:28/:196）+pagehide/hidden 强制（:203）。
- **跨标签语义**：单键 put 原子+dirty 守卫（:150——clean 禁覆盖 dirty；两 dirty LWW，按 clientID 分行=登记升级路径）；versionchange 主动关连接（:103-105）。
- **purge 三形态**（local-cache-key.ts:71/:81/:89）：世代变化（异代库）/无读权·项目删除（该 pid 全代）/登出（该 uid 全部）。
- **总量闸**：estimate 占比滞回 0.8→删最旧（仅 clean 库）→0.6 停，60s 节流（local-collab-cache.ts:30-32/:235-277）。
- **尺寸闸**：LOCAL_CACHE_MAX_DOC_BYTES=QUOTA_DEFAULTS.maxDocBytes 同源（:20）。
- **runtime 接线**：canvasCollabRuntime.ts:1675（键合成——REST meta 透传 g/s 维）/:1745（实例）/:1770（boot 回放 applyUpdate origin=provider）/:1309（快照编码）。

## ⑨ 全仓 `Y.applyUpdate` 消费面（T5/T24 lint 门输入）

| 分类 | 位置 | 档 |
|---|---|---|
| **inbound-doc-apply（目标白名单）** | doc-registry:408（load spool 重放）；persistence:217（replay 抑制窗）；canvas-local-backup:75（**import**）；runtime:1770（**boot load** 缓存回放） | load / import |
| 离线 scratch（api） | repository:270-271（compact temp）；document.service:149-150（decodeSnapshot）；shrink:176（影子预演）/:323-324（校准重放）；integrity-probe:14-15（巡检） | 非 inbound |
| 离线 tmp（web） | runtime:689（diverged 导出临时 doc） | 非 inbound |
| CLI/spike 脚本（根 scripts/） | collab-renumber-layer.mjs:73-74；c0a/guard-prototype.mjs:203/:209；c0a/placement-atomicity.mjs:30/:45-46/:76/:85-86 | 工具 |
| 运维脚本（apps/api/scripts/） | collab-kill9-drill.ts:193-194；collab-smoke.mjs:87-88；write-frozen-drill.mjs:201-202；collab-spool-quarantine.ts:65（评审修：初版漏本目录） | 工具（离线 PG 重放/演练） |
| 测试 | spec/test 文件 **145 行**任意 applyUpdate 出现（`Y.applyUpdate(` 调用形态 119 行）+ collab-harness e2e 装置 2 行（.e2e-spec 不匹配路径正则，归测试面合计 147） | 测试面 |

**计数可复现模式（stated pattern）**：`grep -rn "applyUpdate" apps/api/src apps/web/src packages/shared/src scripts apps/api/scripts --include=*.ts --include=*.tsx --include=*.mjs | grep -v node_modules | grep -E "\.(spec|test)\."` → 145（词表换 `Y\.applyUpdate(` → 119）。初版「147」为宽松过滤（`grep -e spec` 误匹配行内容含 'spec' 字样）已废——以本模式为准。生产调用点=**14 点/8 文件**（inbound 4+scratch 10；canvas-local-backup.ts:64 为注释提及非调用不计）。运维/CLI 脚本=17 行（check-collab-census.test.mjs:165 为脚本自测字符串字面量非调用不计）。

**F-2**：目标「inbound 只许 gate/load/import 三处」——现状无 gate（T9 建；库内部 apply 不计本仓调用），inbound 4 点全在 load/import 档 ✅；其余生产显式调用 10 点全为离线 scratch/临时 doc 域。T5 立门须裁定「其余零」的执法口径（inbound 语义 vs 裸调用清零——按裸调用解读则 14 生产点对 4 白名单=缺口 10，全部为 scratch 域）。

## ⑩ `doc_advisory_xact_lock` + `canvas_doc_update_seq` 全消费面（T10 删除前置）

**doc advisory lock**（键=`hashtext(projectId)`）——定义单源 lockProject（canvas-doc-update.repository.ts:40-45），api 消费恰**三点**（同文件）：append 事务 :63、**vacuumReplace 事务 :202**（:194-224——锁内实读行集+行数漂移守卫+真空 upsert）、compact 事务 **:260**（SV8 租约断言后；:61 是 append 体内注释行非调用点——初版误标已修）。**同键外部消费点**：scripts/collab-renumber-layer.mjs:61（renumberProject 事务首句，与 lockProject 完全同键——跨进程保险）。**api 侧无他处依赖 → T10 可删**；⚠️ 若只摘 append/compact 而 vacuumReplace 未随批处置，lockProject+vacuumReplace:202 仍是活锁调用点（T12 状态机化时同批收口）。

**canvas_doc_update_seq**——生产 nextval 唯一消费=repository:66（append 单语句 INSERT）；迁移 CREATE（migrations/20261009140100/migration.sql:1245）；运维断言（verify-indexes.sql:54——删时须同批撤）；CLI（collab-renumber-layer.mjs:127——删时与 :61 锁同批同步处置）。

**异键 advisory lock（不受 T10 影响，另裁域）**：canvas.service.ts:34（`canvas_untitled:`+teamId——未命名画布唯一性）；intent-reconcile.service.ts:313/:453（intentRowId——R3 资金收敛护栏）；admin-subscription.service.ts:89（`admin:`+idempotencyKey——admin 订阅幂等业务锁）。

## ⑪ 义务种类候选对照真实子系统（T5b closed enum 定员输入）

「节点删除今天留下什么陈旧态」逐子系统实测：

| 子系统 | 节点删除后陈旧态 | 现行清理 | 义务候选 |
|---|---|---|---|
| doc.exec | exec 条目孤儿 | 写侧存在性守卫（Z4 止新，document.service:309）+5min sweep（intent-reconcile:697） | 无需（T22/T32 整链删除——过渡期留 sweep） |
| ArtifactProjection（投影 outbox） | 在飞投影行投递失败 | 投递时点 written:false node-deleted→orphaned+退款（poller:301/:447；sweepOrphanedRefund intent-reconcile:195） | **NODE_DELETED**（帧级义务免失败投递一轮） |
| NodeArtifact | 产物行永久残留（nodeId 键无级联） | 无（TD-15 产品语义：产物=资产不随节点删） | 无需（FEED_TOMBSTONE 使投影端知删即可） |
| MediaBinding | 绑定行 stale | 惰性周期重扫（binding-reconcile:181 collectMediaRefs→applyRefs stale 清 :257-260） | **NODE_DELETED**（FrameEffects 增量维护——免全扫） |
| MediaFactOutbox | （键域=mediaId/projectId——无 nodeId）不适用 | emitter at-least-once+7d retention | 非候选 |
| GenerationIntent | 在飞意图/预留资金 | deadline-reaper+verifyActive（:21/:134）+orphaned-refund（:195-210） | **EXEC_FINALIZE**（观察者同事务收口悬置窗） |
| ExecutionOutbox（T5b/T21 新建） | （未建） | — | FEED_TOMBSTONE+EXEC_STATUS 载体（T26 per-walSeq buffer） |
| 搜索（material-library） | 无 nodeId 引用（grep 零命中） | 不适用 | 非候选 |
| 公开快照（video-work） | 请求时 doc 现读派生——无持久态 | 不适用 | 非候选（doc.vacuumed 事件=换代通知） |
| 配额（doc bytes） | 字节回落靠 yjs GC+compact/vacuum | compact 周期+vacuum 换代 | 非候选（异步收敛） |
| VideoProject（videoEdit） | PG 工程行 | **web fire-and-forget 级联**（canvasStore:131-136——失败仅 console.error=缺口） | **NODE_DELETED**（服务端观察者化收编） |

**T5b 定员建议**：必含 FEED_TOMBSTONE；强候选 NODE_DELETED（三消费面）/EXEC_FINALIZE（资金收口）；MediaFactOutbox/搜索/公开快照/配额对照后=无 node 级义务。

## ⑫ DirectConnection 全调用点标注（S1 遗留——静态门 allowlist）

生产 `openDirectConnection` 恰 **2 点**：

| 位置 | 标注 | 说明 |
|---|---|---|
| collab-document.service.ts:78（withDoc） | **读 + 维护写（allowlist 合规）** | 消费方=shrink 族 ×3（:101 维护写 deleteNodes / :132 读 / :141 维护写 fillDoc exportFresh）；DirectCollabWritePort.withDoc 委托（collab-write.port.ts:87，零生产调用——Z100 实测）；HttpCollabWritePort.withDoc=NotImplemented（:248，worker 不消费） |
| collab-residency.service.ts:445（withSession acquire） | **生命周期 + 业务写载体（现状违例，until=T22/T32）** | 常驻会话通道承载全部 withSession(write)：writeExecStatus（document.service:220）/deliverArtifact（:258）/writeBatch（doc-writer:222）——上游 13 写点（见⑤） |

其他触碰（非 doc 写）：gateway graceDirectConnections :889/:917（关停宽限+Σdirect 计数 :302）；residency:56/:58 类型推导；test-utils/collab-gateway-test-facade.ts:204（测试装置）。

**判定（F-3）**：withDoc:78 通道合规（读/maintenance）；「serving 期业务 doc 写经 DirectConnection=0」在 residency:445 通道现状不成立——S1 验收⑧的静态门只能按登记红（until=T22/T32）先行，业务写调用面=⑤⑥清单。
