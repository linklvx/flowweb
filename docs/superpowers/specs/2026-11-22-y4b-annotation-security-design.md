# Y4b 批注域 + 富文本安全 + A2 终裁设计文档 v5

- **日期**：2026-11-22。**基线**：master `d2fe59c2`（Y4a 五笔 `39ea9972..85cd2728` + m#7 `d2fe59c2` 均已推 origin；CI #139/#140〔attempt2〕终态绿；工作树净）。
- **v5（2026-11-22 第五轮施工单修订版——唯一有效规则=§0）**：用户以 yjs 13.6.32 线程事件形状实测交付四处正文修订，新锚全部亲自核实坐实：①**L2 矩阵补全**（实测：在已有评论上 set 未知键发的是该键 **add** 非 update——v4「评论内部键 update/delete 拒」漏 add 会放过未知键写进已有评论、进真空拷贝/维护 hash/oracle；矩阵改按 path 执法四档）；②**谓词只吃普通对象**（L2 调谓词前先 toJSON()——Y.Map 直传 Object.keys 为空必填项判断错；**扫改范围收窄**：doc-protocol.spec:496 帧级故障计数 toBe(5)、docShape.toDocRecords 坐标 toBe(5) 均非版本字面量一律不动、只删 327-328；**sessionUserId==null 时五写动作直接返不开事务**——不传 undefined 进谓词）；③**版本门断言写在放行档**（拒载档行值 4→5+消息正则 schemaVersion=5+被拒文档仍断言节点 0——拒载先于重放、被拒文档无 threads 根；share.has('threads') 在放行档与 share.has('timelines') 并排；历史 DEFAULT 4/v5 文件原断言保持）；④**组 0 夹具对齐 spec §6**（实测：readTimelineFromDoc 对空 Y.Map 返 null〔version!==1/缺 tracks/clips——timeline-codec.ts:176-180〕、loadProject :263 早退到不了 :279——**空 Map 夹具会把夹具问题误修成产品改动**；夹具用 seedEmptyTimeline('edit1')〔:28〕、断言 ensureAutoEdges 调用次数〔test:4 已整 mock auto-edges 模块〕、替换路径=另一棵 seedEmptyTimeline〔空 Map 替换 next===null、:186 不对账〕；m#5 在合法夹具下现有 :332-336 预期直接绿——红锚只余返形）。**实测维持不动**：同帧建线程只发根上一条 add/后补评论 path=[threadId,comments] add/改 resolved path=[threadId] update（根键 add 读落成后整棵值+修改走矩阵与时间轴先例一致）；timelineUndo:273 自检只观察 timelines 不误伤 fail-closed；恢复信封不收 threads（范围裁剪非垫片）+**导入确认补 notRestored.threads:true**（:455 三键旁）。v4 与 v5 冲突处以 v5 为准。
- **v4 存档（2026-11-22 第三轮开工审查修订）**：六阻断项记录——doc-protocol:327-328 双行实存（v3「无字面量」错话勘正）；D10 白名单源=richTextOfFragment 真输出（nodeHtmlOf 其余元素名原样当标签、mark 在 attrs 无 strong/em）；resolved 必写+L2 动作矩阵；作者缺省 fail-closed；同帧 ContentAny 收成普通对象+半截 entry L1 拒；清理分辨力测试。细节已被 v5 条 2/5/6/10/14 吸收，冲突处以 v5 为准。
- **流程位**：superpowers 三阶段之 **spec → plan → TDD（subagent-driven-development）**。**开工顺序（第五轮裁定）**：正文四处改齐（本版）后**组 0、组 1 可单独进主干**；组 2 再抬协议 6；**组 2+3 同一列车上生产**（组 2 单独部署会把仍报协议 5 的画布客户端全部挡在版本门外）。
- **依据**：2026-11-22 双路并行 census + 五轮用户评审修订（第五轮含 yjs 13.6.32 线程事件形状实测）。file:line 均为 Y4a 落地后**现状实测**。
- **用户已裁**：批注产品形态=**全节点+文本精锚**；COLLAB_XML_URL_HOSTS 生产值=**留部署窗**；§10 六项+第二轮四处+第三轮六条+第四轮六处亲改+第五轮四处全部裁毕。

## §0 核心裁定（唯一有效规则——§1 起为展开与依据，冲突处以本节为准）

1. **范围五件**：①threads 批注域（全节点+文本精锚）②D10 两渲染点兜底③A2 零放大终裁登记④m#4/m#5 双测试锚（+addClip 返形统一）⑤Y4a 施工单前向引用豁免清偿（按 reason 整族删，非按条数）。
2. **threads=第六顶层 Y.Map 根**，复刻 Y4a「新根」先例全套——**守恒面按九处写不止七处**（§2.2：七处单源+守恒三面+投影剥除）。**schemaVersion 5→6 硬切纪律**：`@default(6)` + `CANVAS_DOC_SCHEMA_VERSION=6` + `CLIENT_PROTOCOL_VERSION` 同笔同值（doc-protocol.ts:458 消费；docShape.ts:60 常量）+ 版本门 spec 同笔（**拒载档写在现有 sv=4 拒载组：行值 4 改 5、消息正则 schemaVersion=4 改 schemaVersion=5、被拒文档仍断言节点数 0（拒载发生在重放之前——被拒文档上不该有 threads 根）；share.has('threads') 写在放行档与现有 share.has('timelines') 并排两条都保留；通过档维持读常量〔collab-version-gate.spec.ts:192 现即读 CANVAS_DOC_SCHEMA_VERSION——不写字面量 6〕；历史 CREATE TABLE … DEFAULT 4 与 canvas_schema_v5_default 的 SET DEFAULT 5 保持原断言**）；**协议数字 6 只写在这两个常量、Prisma 默认值、版本门拒载夹具**——**硬编码 5 字面量族全量扫改读常量或删除**（docShape.schema.test.ts:56/docShape.fillRead.test.ts:113/collab-protocol.test.ts:6/collab-auth-reason.test.ts:98/project.service.spec.ts:355+356/collab-maintenance.hash.spec.ts:23 夹具改读常量；**doc-protocol.spec.ts:327-328 `toBe(5)` 双行直接删除**〔:326 已读常量〕——常量抬 6 后该两行必红、最省事修法是把常量改回 5，必须预防）；**c3a-schema.int.spec.ts:115 已读常量自然跟随**+追加新迁移 SQL 断言（匹配 SET DEFAULT 6 且不匹配 UPDATE；历史 canvas_schema_v5_default 文件继续匹配 SET DEFAULT 5）；**迁移纪律**：历史 v5 迁移 SET DEFAULT 5 保持不动、新迁移只 SET DEFAULT 6 不 UPDATE 旧行；无存量不写数据迁移。拒载就是现有列门（行值 ≠ 常量即 SCHEMA_OUTDATED）；客户端走既有 handleVersionTerminal（一次 reload，仍拒则逃生）。不改行、不洗文档、不加重置旁路。**字面量改法**：`expect(常量).toBe(5)` 这种自比（docShape.schema.test.ts:56、fillRead:113、collab-protocol.test.ts:6、project.service.spec.ts:356）改成两常量互等 `expect(CLIENT_PROTOCOL_VERSION).toBe(CANVAS_DOC_SCHEMA_VERSION)`，或删掉该行；禁止改成常量自己比自己。`expect(结果).toBe(5)`（project.service.spec.ts:355、collab-auth-reason.test.ts:98）改 `toBe(对应常量)`。**漏扫**：collab-session-guard.verdict.spec.ts:30 把 `csv: '6'` 断言成 SERVER_OUTDATED；常量抬到 6 后这行必红，最省事的错修是把协议改回 5。改为 `String(CLIENT_PROTOCOL_VERSION + 1)`，并加 `String(CLIENT_PROTOCOL_VERSION - 1)` 为 SCHEMA_OUTDATED。数字 5 与 6 仍只出现在两个常量、Prisma 默认、版本门拒载夹具、历史 v5 迁移与新迁移的 SET DEFAULT。**扫改范围收窄为 schema/protocol 版本字面量**：doc-protocol.spec.ts:496 的 `toBe(5)` 是**帧级故障计数**（五帧级形态齐备）、docShape.toDocRecords.test.ts 里坐标 `toBe(5)` 是**位置值**——两者都不是版本字面量、一律不动；**只删 327-328 两行**。**manifest undo 档**：threads 条目 undo='none'——**DocUndoScope 类型扩 'none'**（现两值 'client-undo'|'server-only'〔canvas-doc-manifest.ts:22-23〕）。
3. **threads 编辑 origin=`'threads-user'`**：**不入任何撤销栈**（UNDO_STACK_BASE 三根维持不动〔undo-policy.ts:26〕、不建 threads 专栈）。批注删除/清理**不可 Ctrl+Z**=终裁语义。节点删除**不级联删** threads（孤儿语义）。undo-policy 新增 `THREADS_ORIGIN` 常量（与 :44 同排）。**「不能 Ctrl+Z」只对守规矩客户端成立**——origin 是客户端自标、服务器不当安全边界；清理=删除非墓碑、之后新 id 再建合法、不另做禁复活结构。
4. **锚两档**：`kind='node'`（nodeId 粗锚）| `kind='text'`（nodeId + content 片段上 Y.RelativePosition start/end，**base64 串**存条目——非活引用）。**文本锚用 y-prosemirror 1.3.7 已导出面**：`import { getRelativeSelection, ySyncPluginKey } from 'y-prosemirror'`（包入口已再导出；实现返回 `{type, anchor, head}`，anchor 与 head 才是 RelativePosition）。`binding = ySyncPluginKey.getState(state).binding`。anchor 或 head 为 null 则不创建。编码前在当前 content 片段上比较绝对位置，从右向左的选区先对调，再写入 anchorStart/anchorEnd（服务端不改写顺序；颠倒仍是读侧孤儿，只覆盖事后漂移和恶意帧）。base64 只用谓词模块里的一对函数：标准字母表加 padding，禁止 url-safe。锚只打 isTextNode 的 content 片段（`resolveNodeXmlFragment(doc, nodeId, 'content')`〔yXmlFragmentBinding.ts:20-28〕，缺片段不创建）。**创建批注事务单独以 threads-user 提交**——选区先读再开事务；写进 ySyncPluginKey 编辑事务=评论跟画布撤销栈走（禁形）。读回判定父级用 yjs `isParentOf`（index.js:79 已导出）：type===片段 或 `Y.isParentOf(fragment, type._item)`。锚点解出落不到该节点正文=**读侧孤儿非毒帧**。摘录面板截 80 字不回写；选区删光两端同点=线程在、摘录空；两端顺序颠倒=孤儿；删节点再撤销=线程自动离开孤儿分组（零新事务）。
5. **孤儿=保留+展示+计数+显式清理**：`nodeId ∉ nodes 根` 或 kind='text' 锚解码/解析失效/落位不在该节点 content 片段（type===片段 或 Y.isParentOf(fragment, type._item)）/**两端顺序颠倒**→孤儿态（判定纯读侧每次计算；**顺序判据**：两端绝对位置在同一 Y.XmlText 时比 index——起点下标大于终点=孤儿、相等=摘录空线程留原组；落在不同文本节点时按该 content fragment 的深度优先顺序比——起点晚于终点=孤儿）。**分组互斥（优先级序）**：孤儿>已解决（resolved&&!orphan）>进行中（其余）——已解决同时又是孤儿的线程只出现在孤儿组；**组内排序=createdAt 升序、相同则按 id**。进行中再按 nodeId 分组（组内排序不变；节点组按组内最早 createdAt，相同按 nodeId）。已解决与孤儿不再按节点分组。任一端绝对位置的 type 不是 Y.XmlText，或父级判定失败，算孤儿。深度优先只给该 content 片段里的 Y.XmlText 编号（先序）。**投影订阅三处**：threads.observeDeep、nodes 的键增删、每条文本锚对应的 content 片段 observeDeep（文本锚集合变化时重绑）。任何 origin 都重算视图，不跳过自己的 origin。删节点再撤销后线程离开孤儿组，靠 nodes 订阅，不靠新的 threads 事务。文本锚落别的节点=孤儿且文档不改、服务端不当毒帧。**清理只在同步完成之后**（**getSynced 判据=provider.isSynced===true——首包同步完成标志；禁复用 3s tick 的 isSynced&&!hasUnsyncedChanges〔正常未确认编辑期间会把批注写死〕**）；**getSynced() 为假时 createThread/addComment/setResolved/deleteThread/cleanupOrphans 全部零事务**（前四者返 false、清理返 -1）；**孤儿键集在同一笔 threads-user 事务里根据当时文档算出再删**——**清理测试分辨力形态**（第三轮裁定 6）：测试包住 `doc.transact`：进入回调后先把其中一条孤儿的 node 补回、再插一条合法新线程，然后才跑清理回调。清理后补回者与新线程都在、另一条孤儿消失。不给 cleanupOrphans 增加测试钩子参数（「事务外先摘清单」必红）。清理不可撤销（§0 条 3）；删光评论后线程还在；摘录最多 80 个 UTF-16 码元不回写。
6. **L1=准入时只断本连接；L2=apply 后关全部连接重放——作者身份按帧可见性分层**：**同帧新建线程**（整棵 entry+comments+首条评论同帧插入——帧内父链走得到 threads 根）→ **L1 执法**：`validateFrameDeny(update, { actorUserId?: string })` 签名扩 options——连接帧传 `item.actor.userId`（QueueItem.actor 已有）；**L1 解码态不能 Y.Map.get**（frame-deny.ts:174-175 头注实证——_map 仅 integrate 时填充）——同帧新建按 framePathOf 把本帧 ContentAny **收成普通对象**再调 checkThreadEntry/checkThreadComment 单源谓词；**半截 entry（只有 Map、没有 createdBy 等）L1 拒绝**（连接断、文档零 apply——字段补在下一帧会落到父已出帧的 L2=4411，不能当成合法创建路径）；**新线程 createdBy 与首条评论 authorId 必须等于 actorUserId**；违规只断本连接、零 apply、文档无该评论。**actorUserId 缺省档=fail-closed**：带任何线程变更的帧直接拒绝（恢复导入 origin='import' 不传——信封无 threads：空 threads 根放行、带 parentSub 条目拒——导入旁路不冒名）。**追加评论/改 body/改不可变键**（父级 comments/entry 已在文档、framePathOf 父出帧 `return undefined` 归 L2〔frame-deny.ts:153-155〕——L1 看不见 authorId）→ **L2 执法**：**L2 看不到 actorUserId 时任何 threads 变更同样全拒**（fail-closed——服务端调用点恒传 item.actor.userId〔actor:1395〕；timelineUndo.ts:273 时间轴自检不观察 threads 不误伤）；违规→4411 关全部+重放（与今天任意毒帧同一信任边界——**不新增关闭协议、服务端不改写字段只拒绝**；守规矩客户端事务前用同一谓词自检发不出去）。readonly 短路在 L1 之前（actor:1152-1154 noop-readonly——viewer 帧零 apply 零 threads 专用分支；配额仍走现有 4404 阈值不动）。
7. **comment 体=纯字符串 + resolved 必写 + 写入后不可变键**：React 文本渲染（零 dangerouslySetInnerHTML）；**body 长度 1~2000（JS string length）、去首尾空白后非空、服务端不修剪原文**；**resolved=创建时必写布尔**（客户端写 false；此后唯一允许的 update=resolved 置布尔）；**已知键封闭**：线程 id/nodeId/kind/anchorStart/anchorEnd/resolved/createdAt/createdBy/comments + 评论 id/authorId/body/createdAt——未知键拒；**创建时 comments 至少一条评论**（其后可删到零条、线程还在）；id（线程与评论）=非空串 1~128 且等于所在 Map 键；createdAt∈[0, MAX_SAFE_INTEGER] 有限数（不和服务器时钟比）。删除评论/删整条线程=任何能写画布成员可做（不按作者分权限）。**threads 永不进公开面**（**共享层函数名以代码为准**：toReadModel〔doc-codec.ts:329〕/toPublicReadModel〔:490〕只拼 nodes/edges——负控钉 toReadModel 的 JSON 不含线程 id 与评论正文；toPublicSnapshot 在 apps/api video-work〔snapshot-filter.util.ts:194 入参 CanvasReadModel〕——读模型干净后两者天然不长 threads）；**DocAuditEvent 五值不动**（写者=连接 actor.userId 已覆盖）。
8. **D10=DOMPurify 兜底两点+一份配置——白名单按 codec 真输出**：TextInputNode.tsx:199 / PromptInput.tsx:499 渲染前过 sanitize（两处只在 XmlFragment 缺失时出现——活编辑器走 ProseMirror 不走这条 HTML；新依赖 dompurify+@types/dompurify 仅 apps/web；不用 isomorphic-dompurify）。**回退 HTML=richTextOfFragment 产物**（doc-codec.ts:229-242 nodeHtmlOf：paragraph 收成 `<p>`、image 收成 `<img>`、**其余元素名原样当标签**——`<heading>/<bulletList>/<listItem>/<blockquote>/<codeBlock>/<horizontalRule>/<hardBreak>/<orderedList>/<command>/<imageMention>`；mark=bold/italic/strike/code 投影在文本 attrs、HTML 无 `<strong>/<em>`；command 可见名字在 label 属性——标签被剥名字就没了）。**配置**：`ALLOWED_TAGS=['p','img','span','heading','blockquote','bulletlist','orderedlist','listitem','codeblock','horizontalrule','hardbreak','command','imagemention']` + `ALLOWED_ATTR=['src','alt','title','class','level','language','start','type','id','label','mentionsuggestionchar']` + `ALLOW_DATA_ATTR:false` + FORBID_TAGS/FORBID_ATTR（style 族）。**正例=真实 fragment 走 richTextOfFragment，再在 jsdom 里过 DOMPurify**。codec 仍输出驼峰标签；HTML 解析会把标签名和属性名收成小写，白名单与断言都用小写（heading/bulletlist/listitem/command/img 仍在，media-id 与 label 仍在）。不断言驼峰标签原样留下。mention 的 data-id 因 ALLOW_DATA_ATTR:false 被剥掉，可见文字留下。不放行 href（codec 不产生 a 或 href）。TextInputNode 现有 `<p>一只猫在窗台上</p>` 仍过；攻击串四类（onerror/script/javascript:/style）剥除。评论正文走 React 文本节点不进此函数。**第三处 innerHTML=TextNodeToolbar.tsx:131 剪贴板暂存不纳入本批**。**CSP/URL 白名单生产值零改动**（缓后部署窗）。
9. **A2 终裁=零放大登记**：编辑器 Modal 同 WS 同 doc（census 实证 page.tsx:396）——测试锚钉死「开编辑器不增会话不换 doc」。**per-user WS 连接闸不新增**（readOnly/每连接 clientId 上限/入站字节背压已盖住连接面——登记部署后按需）。
10. **m#4=水合对账锚（夹具与 spec §6 对齐——第五轮裁定 4）**：**夹具用 `seedEmptyTimeline('edit1')`（timeline-codec.ts:28）放进 timelines 根**——readTimelineFromDoc 对 version!==1 或缺 tracks/clips 的 entry 返 null（timeline-codec.ts:176-180）、loadProject 在 :263 早退到不了 :279，**空 Y.Map 夹具会让对账计数停在 0——那是夹具不合法不是 loadProject 漏调用**。**断言 ensureAutoEdges 的调用次数**（editorStore.test.ts:4 已把整个 auto-edges 模块 mock 掉——planAutoEdgeOps 不会被调）。**替换路径夹具=另一棵 seedEmptyTimeline**（空 Map 替换时 readTimelineFromDoc 返 null、:186 `next!==null` 守卫不再对账）。loadProject（editorStore.ts:279）恰一次+root 键 Map 替换路径（:186）恰一次。**m#5=addClip 写前检查锚**：水合态（合法 seedEmptyTimeline 夹具）+nodes 缺 sourceNodeId→**返 null+零事务（现有 :332-336 已实现——这条锚预期直接绿）**（canvas-invariants.ts:62-68 partial 钦定维持）。**addClip 返形统一 null=红锚**：commit 在 writeTimelineToDoc 失败时返 false、成功返 true，addClip 据此返 null 或 id（:358 现拒时仍返 id=红）。
11. **豁免清偿**：exemptions.json 按 reason「Y4a 施工单引用批内待建文件（T2-T12 落地前 dead-path；本批消费完成即移除豁免）」**整族删**（实测 38 条非~42）+doc-gate 全跑证绿。其余豁免族不动。
12. **守恒面九处**（§2.2 逐条）：七处单源之外——**⑧守恒三面**：`exportThreadsView(root)=Object.fromEntries(root.entries())` **整棵导出**（与 exportTimelineView 同形〔canary:55 实证〕——**禁手挑字段**：{authorId,body,createdAt} 会把 resolved 排除在真空等价/canary 摘要/维护 hash 之外，解决态丢失仍判等价；stableStringify 递归 toJSON() 嵌套 Map 不用再投影）**三处全消费**（vacuumEquivalent registry:838 两侧先 getMap 再比 / canonicalDocView canary:39-42 / recordsOfHydration maintenance:395 加 threads 腿）；**维护导出 hash 允许变**（hash.spec 保持两份 hydration 互比，不加金丝雀 hex；threads 腿加「仅 resolved 不同则两条 hash 必不同」；夹具 schemaVersion 改读常量。不为旧 hash 拿掉这腿）；**⑨投影剥除**：带批注文档进 toReadModel/toPublicSnapshot 结果**无线程 id 与评论正文**（负控锚钉死）。**oracle SCAN_ROOTS+threads**（oracle-worker.service.ts:23/:56）——**评论正文整段恰为团队媒体 id 时推迟该媒体回收=与节点数据 UUID 同口径**，批注不是媒体引用不开「不扫描」例外。**actor threads 观察者只做两件事**：回调 void ev.changes+noteEvents——**timelines 观察者的 touched.add 不复制**（否则每条评论把节点标媒体绑定脏）。
13. **发布列车**：组 0/1 停在 schema 5 可单独进主干；**组 2 抬协议 6**（旧客户端被版本门断开）；**组 2+3 同一列车发布**（先有协议+谓词、再有会写 threads-user 的客户端）；提交可仍四笔、**部署不得把组 2 单独送上生产**。
14. **L2 事件动作矩阵（按 path 执法——实测 yjs 13.6.32 事件形状：同帧建线程只发根上一条 add；后补评论=path=[threadId,comments] 的 add；改 resolved=path=[threadId] 的 update；改 body=评论 Map 上的 update；**在已有评论上 set 未知键发的是该键的 add——「评论内部键 update/delete 拒」漏 add 会放过未知键写进已有评论、进真空拷贝/维护 hash/oracle**）**：
    - `path=[]`（根键）：add→读落成后 entry 跑 checkThreadEntry+每条 checkThreadComment（createdBy 与每条 authorId=actorUserId、comments 至少一条）；delete→允许（删整条线程）；update→拒（整棵 entry Map 被换掉）。
    - `path=[threadId]`：**只有 resolved 的 update 且新值是布尔允许**；resolved 的 add/delete、非布尔、**以及其他任何键的 add/update/delete 全拒**；**comments 键本身不允许任何后续动作**。
    - `path=[threadId, comments]`：add→读落成后评论 Map 跑 checkThreadComment（authorId=actorUserId）；delete→允许；update→拒。
    - **path 再深（评论内部任何键）**：**add/update/delete 全拒**（未知键 add 含在拒内）。
    - **两个客户端同评论 id 后到帧=update**：按上表拒+4411（诚实客户端 crypto.randomUUID 不会走到）。
    - **actorUserId===undefined 时上述任何 threads 事件全拒**（fail-closed——只作用于目标=threads 根的事件；timelineUndo.ts:273 自检只观察 timelines 不误伤）。
    - **L2 调谓词前先 toJSON()**：checkThreadEntry/checkThreadComment 只吃普通对象——Y.Map 直传 Object.keys 为空、必填项判断会错。
    - **导出**：`packages/shared/src/index.ts` 增 `export * from './canvas/threads-frame-predicate'`（:187 timeline 先例并列——否则 web 从 @flowweb/shared 拿不到谓词）。**维护 hash 负控形态**：collab-maintenance.hash.spec=两份 hydration 互比（非金丝雀 hex 摘要）——threads 腿加一条「两边 nodes/edges/timelines 相同、仅一条线程 resolved 不同→两条 hash 必不同」。**锚 base64 上限按解码后字节计 ≤512**（简单文本锚实测约 8 字节——512 够用）。

## §1 范围与非目标

**非目标（本批不做、登记在案）**：
- comment 富文本体（纯字符串——@mention/格式化/通知/未读计数全不做）
- CSP 头（缓后部署窗）；per-user WS 连接闸（A2 终裁=不新增）
- 批注导出/公开页展示（threads 不进任何公开面——§0 条 7/12）
- threads REST 读模型（客户端 WS 直读 live doc——零 REST 新面）
- DocAuditEvent 扩类（五值不动）；gateway coalesce flake 根治（在册后续批）
- collectJsonMediaIds 删除 / media-refs-read.port:31（在册非本批债）
- 批注不锚时间轴片段/clips 子面（编辑器 Modal 不承载 threads UI——锚画布节点）
- **threads 不进恢复信封**（恢复信封今天只有节点+边+视频节点补种时间轴；导入路径只跑 L1〔collab-recovery-import.service.ts:428-435 origin='import' 直写〕——本批不加 threads 进信封、导入路径维持只跑 L1）
- **TextNodeToolbar.tsx:131 innerHTML 不纳入**（剪贴板暂存、HTML 来自当前编辑器）
- 批注条数配额/切块（文档总量沿用现有 maxDocBytes 8MiB——§2.1 量级论证）

## §2 threads 数据域

### 2.1 键矩阵（封闭——帧谓词与客户端写前检查同源）

```
threads: Y.Map（根）
  键 = threadId（记录自身 id——Map 键=记录 id 纪律）
  值 = Y.Map：
    id:         非空串（=键）
    nodeId:     非空串
    kind:       'node' | 'text'（封闭枚举）
    anchorStart / anchorEnd: base64 串
                kind='text' → 必有且可解码（标准 base64 带 padding、解码后 ≤512 字节、Y.decodeRelativePosition try/catch 失败=非法帧）
                kind='node' → 必无
    resolved:   boolean
    createdAt:  有限数
    createdBy:  非空串（userId）
    comments:   Y.Map 容器——键=commentId；值=Y.Map：
      id: 非空串（=键）；authorId: 非空串；body: string ≤2000 字符；createdAt: 有限数
```

- 标量槽 Y.Map/Y.Array/Y.Text 全拒；Map 键=记录自身 id。
- **字段规则（L1 深链标量档+L2 事件档同源执法）**：id 非空串且**=Map 键、长度 1~128**；kind 封闭枚举；**kind='text' → anchorStart/anchorEnd 必有且标准 base64、解码后 ≤512 字节、Y.decodeRelativePosition 成功；kind='node' → 两键必须不存在**；nodeId/createdBy/authorId 非空串；body **JS 字符串长度 1~2000、去首尾空白后非空、服务端不修剪原文**；createdAt∈[0, Number.MAX_SAFE_INTEGER] 有限数（**不和服务器时钟比较**）。**键矩阵内「≤512」一律按解码后字节计**（§0 条 14 同一口径）。
- **写入后不可变键**：线程 id/nodeId/kind/anchorStart/anchorEnd/createdAt/createdBy + 评论 id/authorId/body/createdAt——**唯一允许的更新=resolved 置布尔**；未知键拒。
- **作者身份**：新增评论 authorId/新线程 createdBy 必须等于本帧连接用户（L2 actorUserId 执法+客户端写前同比较；服务端不改写只拒绝）。
- 删除规则：删除评论条目/删整棵 threads.\<threadId\>=任何能写画布成员可做（不按作者分权限）；**删 comments 容器键非法**（删除三级——timelines 同形）。
- 服务端谓词**不检查节点存在性**（与 canvas-invariants partial 钦定一致——锚点解不出落位=读侧孤儿非毒帧）。
- 帧量级：单条评论 ≤2000 字符→单帧远小于 maxTxBytes(262144)；文档总量沿用现有 **maxDocBytes 8MiB**——**无条数配额/无切块/无预算面**。

### 2.2 新根接线逐处（Y4a 先例复刻——**九处**，全部现状锚）

**七处单源**：
1. **manifest**：DOC_TOP_LEVEL_MAPS 五根→六根+threads 条目（canvas-doc-manifest.ts:16；writers=threads-user、ownership=doc、**undo='none'——DocUndoScope 类型扩 'none'**〔:22-23 现两值〕）；契约测试六根（canvas-doc-manifest.test.ts:161-162 改）+先红后绿登记档（:180-187 模式）。
2. **frame-deny**：FRAME_DENY_ROOTS+threads（frame-deny.ts:46）；**`validateFrameDeny(update, opts?)` 签名扩 options**（现单参〔frame-deny.ts:128〕）：`{ actorUserId?: string }`——连接帧传 item.actor.userId、缺省档带线程条目帧拒；L1 直档（threads.\<id\> 必须 Y.Map——:179-183 timelines 同形）+L1 深链档（:203-211 同形——ContentAny 抽值调 checkThreadEntry/checkThreadComment）+**L2 root-identity 分支**（:527-531 同形——事件动作执法；root 身份安装观察者时取、谓词内不 getMap）。
3. **undo-policy**：UNDO_STACK_BASE 三根不动（undo-policy.ts:26）+THREADS_ORIGIN 新常量（:44 同排）。
4. **docShape**：fillDoc 尾物化 `doc.getMap('threads')`（docShape.ts:161-165 timelines 同形）；CANVAS_DOC_SCHEMA_VERSION 5→6（:60）+CLIENT_PROTOCOL_VERSION 同笔同值（doc-protocol.ts:458 消费）；版本门字面量同笔（collab-version-gate.spec.ts:170 sv=5 拒/sv=6 过+lazy 行 @default(6)；REST 快照门 collab-document.service.ts:165-166 同笔）；**project.service.spec.ts:355 `toBe(5)` 改读常量**。
5. **registry**：装载缝 share.has 物化（collab-doc-registry.service.ts:588-595 timelines 同形——SERVER_TRANSACT_ORIGIN，replay 后/观察者安装前）；vacuum/rebuildDocFaithful 根集守恒（deepCopyYMap 未知 Y.Map 根自动深拷〔:772 U-2〕——threads 字节默认带得走，**但等价判断不看这些字节→⑧必补**）。
6. **oracle**：SCAN_ROOTS+threads（oracle-worker.service.ts:23/:56）；**评论正文整段恰为团队媒体 id=推迟该媒体回收（与节点数据 UUID 同口径，不扫描例外不开）**。
7. **actor**：threads.observeDeep(noteEvents)+循环第一行 **void ev.changes 物化**（collab-project-actor.service.ts:343-353 timelines 同形）；threads 无 media 绑定→无 touched 标记面。

**⑧ 守恒三面（canary-semantic 单源扩腿）**：`exportThreadsView(root)=Object.fromEntries(root.entries())` **整棵导出**（与 exportTimelineView :55 同形——**禁手挑字段**：resolved 必须进等价/摘要/hash 面；stableStringify 递归 toJSON() 嵌套 Map 不用再投影）；**三处全消费**——vacuumEquivalent（collab-doc-registry.service.ts:825-839——**两侧先 `getMap('threads')` 再比** stableStringify）/ canonicalDocView（canary:39-42 拼串加 threads 腿）/ **recordsOfHydration 加 threads 腿**（collab-maintenance.service.ts:395 返回形状+hash 面）。维护导出 hash 允许变：hash.spec 保持两份 hydration 互比（现状已是互比，不是金丝雀 hex），加上 resolved 翻转档，不为旧 hash 拿掉这腿。**负控**：副本少一条评论→vacuumEquivalent 假+语义摘要不等+hash 不同。

**⑨ 投影剥除**：带批注文档进 toReadModel（doc-codec.ts:329）/toPublicSnapshot 结果**无线程 id 与评论正文**（负控锚钉死——toReadModel 今天只拼 nodes/edges、天然不含 threads，锚防未来枚举根回归）。

### 2.3 帧谓词与写前检查单源（**谓词吃普通值**——客户端 transact 前无 struct）

- 谓词模块：`packages/shared/src/canvas/threads-frame-predicate.ts`（镜像 timeline-frame-predicate.ts 组织）。**L1 组装**沿 framePathOf 把本帧 threads 路径上的 ContentAny 收成普通对象（comments 是普通记录）。根类型创建且 parentSub 为空算空根，放行。entry Map 在帧内但必填键不齐，算半截，拒绝。不要先把 update 应用到临时文档再 get。**base64** 由本模块导出标准字母表加 padding 的编解码；先看解码字节是否 ≤512，再调用 Y.decodeRelativePosition。**Y.Map 工厂**也放在本模块：threadsStore 只调用，自己不写 `new Y.Map`（census 组㉓只扫 apps 生产文件，写在 web store 里会红；timeline 的 Map 创建在 shared 的 timeline-codec，同一先例）。**单源函数收普通值、返 `string | undefined`**（与 timelineScalarErr(kind,id,slot,v:unknown)→string|undefined 同形〔frame-deny.ts:396 先例〕）：
  - `checkThreadEntry(id: string, v: unknown, actorUserId?: string): string | undefined`——v=线程 entry 整体（普通值形态；L1 从同帧 ContentAny 抽出、L2 从落成后 entry 读出、客户端从将写对象构造——三路同函数）：id 等于 Map 键、长度 1~128；kind 只允许 'node'|'text'；kind='text'→anchorStart/anchorEnd 标准带 padding base64、解码字节 ≤512、Y.decodeRelativePosition 不抛；kind='node'→两键必无；nodeId/createdBy 非空串；createdAt∈[0,MAX_SAFE_INTEGER] 有限数；未知键拒；**actorUserId 给定时 createdBy 必须相等**。
  - `checkThreadComment(id: string, v: unknown, actorUserId?: string): string | undefined`——v=评论整体（三路同上）：authorId 非空串（**相等比较是参数 actorUserId**）；body JS 长度 1~2000、去首尾空白仍非空、原文不修剪；createdAt 同上档；未知键拒。
- 服务端消费：**L1**（validateFrameDeny 签名扩 options——**同帧新建按 framePathOf 把本帧 ContentAny 收成普通对象**再调上述函数〔解码态不能 Y.Map.get——frame-deny.ts:174-175 头注〕；半截 entry 拒；比对 createdBy/首条评论 authorId=actorUserId）+**L2**（validateAppliedL2 root-identity 分支按 §0 条 14 动作矩阵执法、**调用点传 `actorUserId: item.actor.userId`**〔actor:1395〕、**缺省 undefined=任何 threads 变更全拒**）。
- 客户端消费：threadsStore **doc.transact 之前**调用同一函数（含作者比较 sessionUserId）；id 用 genId〔video-project.ts:51 crypto.randomUUID〕；选区先读、encodeRelativePosition 再开 threads-user 事务。
- 恢复导入：**threads 不进恢复信封**（§1 非目标——范围裁剪非垫片）；导入只跑 L1（**空 threads 根放行、带 parentSub 条目拒**——actorUserId 缺省档）；**导入确认报告补 `notRestored.threads: true`**（recovery-import:455 现有 notRestored 三键旁加——避免恢复报告把批注说成已恢复）。
- **共享导出**：`packages/shared/src/index.ts` 增 threads-frame-predicate 导出（:187 timeline 先例并列——否则 web 拿不到谓词）。

### 2.4 撤销与 origin

- threads-user 不入任何栈（§0 条 3）；删除/清理不可撤销=终裁语义。**origin 是客户端自标、服务器不当安全边界**——「不能 Ctrl+Z」只对守规矩客户端成立；清理=删除非墓碑、新 id 再建合法、不另做禁复活结构。
- Ctrl+Z 键位域不变（画布/时间轴栈现状零改动——threads 无键位面）。
- **观察者只做投影**：任何 origin（含 threads-user）都从 doc 重算视图——纯读投影无写回、不存在需要跳过的回声。
- 画布删除分割函数（canvasDeleteSplit）**零改动**——节点删除不级联 threads（孤儿语义非删除语义）。

### 2.5 孤儿语义

- 判定（读侧计算，不入 doc）：`nodeId ∉ doc.getMap('nodes')` **或** kind='text' 且（decode 失败 **或** createAbsolutePositionFromRelativePosition 解析失败 **或** 解出位置不在该节点 content 片段内〔type===片段 或 Y.isParentOf(fragment, type._item)——与 y-prosemirror 父级判定同法〕**或** start/end 两端顺序颠倒）。
- 展示：面板**三组互斥（优先级序）**——孤儿>已解决（resolved&&!orphan）>进行中（其余）；**组内排序=createdAt 升序、相同则按 id**；孤儿**不自动删**（保留=用户仍可读历史评论）。text 锚存活=解析后取锚定窗口文本为摘录（摘录最多 80 个 UTF-16 码元不回写；两端重合=线程在摘录空；**删光评论后线程还在**）。
- **清理（cleanupOrphans）只在同步完成之后**：**getSynced()=provider.isSynced===true**（§0 条 5 判据——未同步时 nodes 可能空、按「节点不在」删=清掉全部批注）；**getSynced() 为假时 createThread/addComment/setResolved/deleteThread/cleanupOrphans 全部零事务**（前四返 false、清理返 -1）。**孤儿键集在同一笔 threads-user 事务里根据当时文档算出再删**——**分辨力测试形态**（第三轮裁定 6）：事务入口先把其中一条孤儿的 node 补回（它不再是孤儿）+再插一条 nodeId 存在的合法新线程，然后才计算并删除→清理后补回者与新线程都在、另一条孤儿消失（「事务外先摘清单」实现必红）。
- 删节点→线程成孤儿；**撤销删节点→线程自动离开孤儿分组**（零新批注事务——负控锚钉死）。
- 帧量级：单条评论 ≤2000 字符→清理单事务远小于 maxTxBytes(262144)——**无切块/预算/捕获窗面**。

## §3 客户端写链与 UI 面

### 3.1 写链（threadsStore——新模块 apps/web/src/stores/threadsStore.ts）

- `createThread({nodeId, kind, anchorStart?, anchorEnd?, body})` 单事务〔envelope+comments 容器+首条评论〕/ `addComment` / `resolveThread` / `deleteThread` / `cleanupOrphans`——全部 threads-user origin。
- **写前谓词含作者比较**（当前会话用户=authorId/createdBy——同服务端 L2 单源规则）；写前通过才开事务。
- **text 锚创建序**：按 §0 条 4。`getRelativeSelection` 的返回值取 `anchor`/`head`；从右向左的选区先对调；base64 用谓词模块。然后再开 threads-user 事务。写进 ySyncPluginKey 编辑事务=评论跟画布撤销栈走（禁形）。片段=`resolveNodeXmlFragment(doc, nodeId, 'content')`，缺片段不创建。entry 与 comment 的 Y.Map 用 shared 工厂创建。
- 会话闸：**getSynced 判据=provider.isSynced===true**（首包同步完成标志——§0 条 5；禁复用 3s tick 的 isSynced&&!hasUnsyncedChanges）；为假时五写动作全零事务（create/addComment/setResolved/deleteThread 返 false、cleanupOrphans 返 -1）。threads 根由装载缝保证存在。
- **观察者只做投影**：任何 origin（含 threads-user）都从 doc 重算视图——纯读投影无写回、不存在需要跳过的回声。
- 权限：threads-user=写域 origin——与画布写权限同面（viewer 只读连接不产该 origin 帧）。

### 3.2 UI 功能面（视觉细节=实现组时按现有界面规范出一版——不在此定样式；本节只锁功能）

- **入口 A（全节点）**：节点右键菜单「批注」（CanvasView.tsx:291 onNodeContextMenu 链）→ composer（评论输入框）→ kind='node'。
- **入口 B（文本精锚）**：文本节点（isTextNode）tiptap 选区浮标「批注」→ composer → kind='text'（锚机制 §3.1）。
- **面板**：画布顶栏「批注」按钮→侧滑面板：进行中（按节点分组+锚文本摘录）/已解决（折叠）/失效（计数徽标+「清理全部」）；线程展开=评论列表+回复框+解决开关。
- **线更新**：按 §0 条 5 订阅 threads、nodes 键增删、文本锚的 content 片段。任何 origin 都从 doc 重算，不跳过自己的 origin。
- 编辑器 Modal（video-editor）不承载 threads UI。

## §4 D10 兜底细节

- 兜底范围**只有两处展示出口**（census B 实测零漂移）：TextInputNode.tsx:199（fallbackHtml=appNode.data.content?.html——doc-codec.ts:251 richTextOfFragment 投影）/ PromptInput.tsx:499（prop 注入——VideoConfigPanel.tsx:303 / config-panel/PromptEditor.tsx:61）。**TextNodeToolbar.tsx:131 innerHTML=剪贴板暂存（HTML 来自当前编辑器）不纳入**。
- **单源出口函数（两处共用一份配置——§0 条 8 codec 真标签）**：`DOMPurify.sanitize(fallbackHtml, { ALLOWED_TAGS:['p','img','span','heading','blockquote','bulletlist','orderedlist','listitem','codeblock','horizontalrule','hardbreak','command','imagemention'], ALLOWED_ATTR:['src','alt','title','class','level','language','start','type','id','label','mentionsuggestionchar'], ALLOW_DATA_ATTR:false, FORBID_TAGS:['style','form','iframe','object','embed','script'], FORBID_ATTR:['style'] })`。
- 依赖：dompurify+@types/dompurify 仅加在 apps/web（不用 isomorphic-dompurify）；api/shared 零新依赖。
- 红锚四类（默认档已剥前三——锚防回归）：img onerror / script 标签 / javascript: href / **style 标签与属性**；现有正常富文本回退测试保持通过（TextInputNode.test.tsx:255-262 兼容改）。
- CSP/URL 白名单生产值：零改动+登记（§0 条 8）。

## §5 A2 登记锚

- int 锚：画布 runtime 就绪→开编辑器（VideoEditorShell open→loadProject 全链）→会话/provider 计数不变 + getTimelineDocRef()===画布 doc。
- per-user 闸不新增（§0 条 9）。

## §6 m#4/m#5 施工锚（组0）

- m#4 两例（新 doc 实水合夹具——替换 doc-less ready() 直塞短路态）：loadProject（editorStore.ts:279）恰一次 + root 键 Map 替换路径（:186）恰一次——断言 ensureAutoEdges 调用计数=1。
- m#5 一例：水合态+nodes 缺 sourceNodeId→addClip 返 null + doc 零 update 事件 + store 零新 clip（editorStore.ts:332-336）。
- 返形统一：commit 闸拒路径（:358 现返 id）→返 null（类型已 string|null；**commit 须把成功与否传出来**——今日拒时本地状态没写上、函数仍返 id）。
- **施工单纪律**：RED 锚写主用例第一条失败断言（dev-workflow 2026-11-22 m#7 批裁定）。

## §7 豁免清偿（组0）

- 移除 exemptions.json 按 reason「Y4a 施工单引用批内待建文件（T2-T12 落地前 dead-path；本批消费完成即移除豁免）」**整族删**（实测 38 条）+doc-gate 全跑绿=销案证。**不按「~42」这个数删、按 reason 删**（reason 是唯一判据——条数实测已变）。
- 其余豁免族不动（2027-01-02 族 ~41 天后 TTL 到墙自然处置）。

## §8 测试锚总表（红先行——施工单按此展开）

| # | 锚 | 红形态 |
|---|---|---|
| A1 | manifest 六根契约+threads 条目 | threads 未登记时红 |
| A2 | fillDoc/装载缝物化 threads 根 | 未物化红 |
| A3 | 版本门**拒载夹具 sv=4→5+装载后 share.has('threads')**；通过档维持读常量；字面量族改读常量（docShape.schema/fillRead/collab-protocol/collab-auth-reason/project.service :355/:356/maintenance.hash 夹具）+**doc-protocol.spec:327-328 双行删除**；c3a 追加 SQL 断言（新迁移匹配 SET DEFAULT 6 不匹配 UPDATE；v5 文件仍匹配 SET DEFAULT 5） | 字面量未改红 |
| A4 | L1 同帧新建线程档（**ContentAny 收成普通对象**后 id/kind/anchor 可解码/body/**resolved 必写**/createdBy=首条 authorId=actorUserId；**半截 entry 拒**）——违规只断本连接、零 apply | 未执法红 |
| A5 | L2 动作矩阵档（根键 add 读落成后整棵值/comments 至少一条/唯一可更新=resolved 置布尔/根键 update 拒/不可变键 update 或 delete 拒/comments 容器键 delete/update 拒/**actorUserId 缺省=任何 threads 变更全拒**） | 未执法红 |
| A5′ | **两档冒名分流**：同帧新建冒名→只断 A 连接（B 在、文档无该评论）；对已有线程追加冒名评论→4411 关全部 | 现无分层红 |
| A6 | threads-user 不入撤销栈（画布 undo/redo 后 threads 不动） | 入栈红 |
| A7 | toReadModel/toPublicSnapshot 带批注文档→结果无线程 id 与评论正文 | 携带红 |
| A7′ | 副本少一条评论→vacuumEquivalent 假+canonicalDocView 摘要不等；**维护 hash 档=两份 hydration 互比**：仅一条线程 resolved 不同→两 hash 必不同（hash.spec 互比形态） | 守恒面缺腿红 |
| A8 | oracle SCAN_ROOTS 含 threads | 未扩红 |
| A9 | m#4 两例恰一次（水合夹具） | 现短路永不触达红 |
| A10 | m#5 返 null+零事务 | 现 doc-less 短路红 |
| A11 | addClip 闸拒返 null（返形统一） | 现返 id 红 |
| A12 | A2 零放大（开编辑器不增会话不换 doc） | 现无锚红 |
| A13 | D10 两点：攻击串四类剥除（onerror/script/javascript:/style）+**正例=真实 fragment 走 richTextOfFragment 再过 DOMPurify**（断言小写标签 heading/bulletlist/listitem/command/img 与 media-id、label 仍在；不断言驼峰标签原样留下；TextInputNode 现有 `<p>` 用例仍过） | 现裸渲染红 |
| A14 | 孤儿判定（node 缺失/锚解出不在片段内/两端按同文本 index 或跨文本 fragment 深度优先序比颠倒）+cleanupOrphans 同步后事务内计算+计数 | 未实现红 |
| A14′ | **未同步时全部写动作（create/addComment/setResolved/delete/cleanup）零事务**、前四返 false 清理返 -1（闸=getSynced 判 provider.isSynced===true） | 现无闸红 |
| A14″ | **清理分辨力档**：事务入口补回一条孤儿 node+插一条合法新线程→清理后两者在、另一条孤儿消失（事务外先摘清单实现必红） | 现无闸红 |
| A15 | 双客户端同步（A 建 B 见；B 删节点→A 侧孤儿→清理双端一致） | 未实现红 |
| A15′ | 删节点不删线程；**撤销删节点后线程自动离开孤儿分组且零新 threads-user 事务** | 未实现红 |
| A16 | text 锚解码成功但绝对位置不在该节点 content 内→孤儿展示、文档不改（非毒帧） | 未实现红 |

## §9 提交切分与发布列车（四笔——顺序 plan 期可调；**发布纪律见 §0 条 13**）

- **组0 riders**（**停在 schema 5**、可单独进主干）：m#4+m#5+返形统一+A2 锚+豁免清偿（web+docs）。
- **组1 D10**（**停在 schema 5**、可单独进主干）：DOMPurify 两点一份配置（web）。
- **组2 threads 域**（**抬协议 6**——旧客户端被版本门断开）：shared 契约+schema v6+api 九处接线+帧谓词+守恒三面+负控（shared+api）。
- **组3 threads 客户端**：threadsStore+UI 入口/面板/孤儿清理+A15 双端 int（web）。
- **列车**：组 2+3 同一列车发布（先有协议+谓词、再有会写 threads-user 的客户端）；提交仍四笔、**部署不得把组 2 单独送上生产**。

## §10 裁定史（v2 收口——已全部裁毕，无开放项）

1. threads 不可撤销（不进任何栈；删除/清理无 Ctrl+Z；origin 客户端自标非安全边界——§0 条 3）。
2. 不扩 DocAuditEvent（写者以连接 actor.userId 执法——文档作者字段必须与本帧用户相同，§0 条 6/7）。
3. body 上限 2000 JS 字符串长度+去首尾空白非空+服务端不修剪原文（§0 条 7）。
4. per-user WebSocket 闸不新增（§0 条 9）。
5. addClip 提交闸拒绝返 null（类型已 string|null；commit 把成功与否传出来——§0 条 10）。
6. 面板功能按 §3.2；视觉实现组时按现有界面规范出一版，不在本架构规格里定样式。
