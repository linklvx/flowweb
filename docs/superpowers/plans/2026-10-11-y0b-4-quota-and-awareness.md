<!-- doc-status: draft-v4 | created_at: 2026-10-11 | spec=2026-10-08-y0b-funds-and-access-design.md v2.7 §4.1-4.5 全节+§5.2/§5.3 快照模型+§7.1/§7.2 | 基线=master 59734a13 | v3=三份 v2 复审收敛（四个新 P0 全证实+逐项裁定）：①**oracle 无冷却无预算=DoS 放大器**（soft 触发+测量即归零 delta=measured 贴 soft 时每帧全量编码；8MB 编码实测 23.3ms——2 核机 ×2-4；2MB/s 恶意≈100 次/s≈2.3 CPU 秒/秒）→修=判据分层（快路径 soft/账面超硬限才测量+**冷却窗 2s 内不重测**+quotaFrozenDocs over 短路零编码拒绝+truth_measured/fastpath 计数器+两条编码成本硬用例：冷却窗 50 帧 1 次编码/冻结态 50 帧 0 次编码）；②**TokenBucket.consume 固定扣 1**（token-bucket.ts:30/:42 实证——v2 bytesBuckets.consume(sid) 无金额=纸面字节限流）→修=consume(key,cost=1) 按量扣减+bytes 桶容量 1MB+**每连接一次性握手信用 maxDocBytes**（离线回灌免疫+滥用封顶）；③**compact 驱动自动解冻结构上不可达**（冻结后帧全被 readOnly 吞⇒无 update⇒无 store⇒无 compact⇒永不重测=自锁闭环；maybeCompact 仅 :835/:1308 两调用点）→修=**quotaFrozenDocs: Set<pid> 文档级注册表+独立 frozenRecheckTimer（30-60s 对冻结 doc 重测，<0.6×MAX thaw——禁挂 sweep 逃生阀）**；compact 校准保留但仅 pending 空时生效（活 doc 含未 store delta，newSnapshot=持久化真值口径差——非空跳过）；④**readOnly 每连接量走每文档广播**（broadcastStateless 同 payload 发全部连接，VIEWER/EDITOR 必有一侧错→解冻广播 readOnly:false 会让 VIEWER 解除只读=新静默分叉）→修=**方案 A：快照去 readOnly 字段**，客户端组合 `authScope!=='read-write' || quotaOver || writeFrozen`（连接级/文档级正交）。同批采纳：帧闸先于 readOnly 早退+writesDropped 计数落点（v2 死指标）；**4404 分层升级**（首触=冻结+放行本帧〔setImmediate 延后置——禁静默丢合法帧〕；冻结期持续推送计数≥3 才 4404 终态——spec"持续强推"原文对齐）；**帧闸 1008→1009**（帧过大=内容确定性，1008 backoff=重连重发循环；复用 MESSAGE_TOO_BIG terminal 链路）；快照 quota 加 maxTxBytes（客户端/服务端双源发散消除）+删 deletedIds（对端 undo 栈只含本地编辑，远端删除本不在 trackedOrigins——清全体撤销栈=纯 UX 损失，**只清发起端**）；rev 生命周期（doc 卸载 Map 删+客户端跨断线保留→新 rev 更小被弃——**authenticated 复位 lastDocStatusRev=0**）；writeFreeze 值加 pid（onDisconnect O(1) 清理防强引用泄漏）；装载 cheap 上界播种（|state|+Σ|updates|+Σspool <soft 时直接当 truth 跳过编码——上界≥真值保守正确；**含 spool 帧 apply 之后**）；装载侧不拒任何行（产生侧已对齐=病态行结构性不可产生；pendingStructs==null 断言+degraded 观测——真跑实证跳行=静默因果链丢失）；客户端 seam 前置 **runCommand precheck 参数**（nodeStore.addNode 纯本地 set+doc 写在 finally——dispatch 层拒时 store 已污染，实证）；客户端判据④=快照 bytes+全 origin delta 插值+**delta>1MB 触发 requestIdleCallback 后台实测自校准**（零 UI 卡顿+漂移有界）；**bump CLIENT_PROTOCOL_VERSION**（drain 期旧 bundle 编辑被静默吞+1012 重载=真丢——fail-closed 一行成本）；maxPayload=16MB→**maxDocBytes+1MB=9MB**（帧闸钉死 Sync 上界后结构性兜底；1009 探针参数同步）；yjs_loaded_doc_bytes=Σ(truth+delta)。驳回登记（v3 裁定）：vacuum 维持 Y1c-3（真值口径+recheckTimer 自动解冻后墓碑病态大幅缩小——gc:true 删除即回收，residue 主病理已被 v2 真值口径消解）；驻留总量 enforcement 维持 Y1c-3（heap 闸+LRU 同批重估既定）；指标三口径收口维持 Y0b-5（双指标拆分有完整设计，本批抢做=同批双改读者）；软阈"告警不停写"维持 spec（80% 停写=缓冲带设计）；结构上限（节点数/data 字节/文本长度）=Y1c-2a 域。 | v2 记录：2026-10-11 三外审收敛版（六 P0 修复+4a/4b 切分），已被 v3 增量修订；v1 记录见 git 历史 | v4=三份 v3 复审收敛（改判一项+P0 全采纳）：①**vacuum 改判纳入本批（T9）**——v3 驳回理由被真跑否定：gc 回收内容但 GC 壳+删除集 19.7B/事务线性累积（60k 事务净零内容→编码 1.18MB 实测）、compact 重编码同一批 struct 不可清除（104,276→104,276 前轮实测）、残留主导时 shrink 影子预演必 422→唯一出路弃画布=spec 要消灭的终局；控制律=冻结持续 2 轮 recheck→算 liveBytes（readRecords+fillDoc 真空编码）→residue>50% 自动 vacuum（替换快照+删增量行+docStatusRev 跳变携带 generation→全端 undoManager.clear()+reload——冻结期 reload 可接受）；内容真大=shrink/导出沟通；②**P0-1 authScope 污染**（冻结期加入/刷新连接 auth 置 readOnly→库发 scope='readonly' 固化→thaw 后组合式判据仍只读=v1 P0-6 换皮回归；且 sweep 降级 :1631-1635 改 readOnly 从不通知客户端=既有静默分叉洞）→修=**每连接 conn-status 推送**（{type:'conn-status',readOnly}——writeFreeze 六写点变更唯一出口 sendStateless；客户端 collabReadOnly=connReadOnly||quotaOver||writeFrozen，authScope 退化为诊断）；③**P0-2 overPush**：per-conn 键+时间字节双窗（≥20 帧或 ≥2×maxTxBytes 且持续≥5s——3 帧阈值对"晚一 RTT 停写"过紧）+复位只在 thaw（freeze 重入不清零）+计数落 readOnly 分支+延后窗放行不计数；④**P0-4 maxPayload 撤回 9MB 维持 16MB**（Y0b-3 断言零改动；越界不变量 docSize≤MAX+maxFrameOvershoot 落测；Step2 越界放行限首次握手帧）；⑤报告2 A【delta 双计】（hook 快路径回写+update 监听同帧双加——hook 只读不写，update 监听唯一写者）+C【账面冻结缺确认调度】（freezeQuota 挂 cooldown 到期即测定时器——30s recheck 误冻结窗缩至毫秒级）+D【进程级测量预算】（≤1 次/200ms+duty≤5%+truth_measure_duration 直方图——10 doc 贴阈=事件循环每 23ms 卡一次的运维风险）+F【rev 初值 0 被守卫丢】（doc 装载播种 rev=1——首快照=limit/maxTxBytes 唯一来源恒丢）+G【快照加 softLimitBytes】（客户端 gate 对齐服务端冻结线——v3 客户端按 limit 放行=主动放行注定触发冻结的写入）；⑥报告3 P0-A【T1 测试仍 v2 形态】（readOnly/deletedIds 字段残留——执行者直接复制即错；重写+Object.keys 字段集合断言）+P1-6【distinct user 取数源】（本帧 states 只含发帧者→10 人画布单帧误判 solo 剥光标——改 document.awareness.getStates() 全量∪本帧+反例用例）+P1-5【idleCallback 后台不触发】（{timeout:2000}+delta>4×maxTxBytes 硬兜底 pending-measure 新 reason）；⑦H-3 三桶落点三分（msg=beforeHandleMessage 无需分型/aware=beforeHandleAwareness 天然/bytes+信用=beforeSync type 现成——入站免 readFrameType 消双计）+pendingDs 双查（yjs.cjs:2834 独立字段）+握手信用绑 (userId,doc) 防重连刷新+剔字段禁碰 meta.clock 注释+H 组打磨；⑧驳回登记：4KB 前移 beforeHandleMessage（需手解析帧与 census③ 相悖；maxPayload+msg 桶双限已兜）。T0 纪律升级=四问模板（数据格式运行打印/库 API 反射验证/既有不变式找反例/新调度原语验证目标环境触发——v1 死于①②、v2 死于③、v3 死于④） | v5=三份 v4 复审收敛（vacuum 专项+落地审计；P0 五项全采纳+一项改判）：①**vacuum 重写为"文档代际替换"并降级显式触发**（报告1 实测：只换 DB 快照不换内存 doc→旧历史增量叠加新快照→重载 n99 消失+pendingStructs 非空；报告2 U-1/U-2 实证：fillDoc 不盖戳〔docShape.ts:86 注释自证〕⇒真空快照=无戳∧满节点⇒ensureSchemaVersion :71-73 拒载=**画布永久打不开**；readRecordsFromMaps/fillDoc 均只覆盖 nodes+edges⇒**exec 根 map 整块丢失**〔writeExecStatus :180 Y0b-2 代次守卫+intent-reconcile:494 双消费〕；U-3：withDoc/readServerSV/readCanvas/video-project 全能物化旧 doc 污染存储；U-4：provider 1s 重连+休眠标签页带旧 doc 回灌竞态；U-5：冻结期编辑靠 thaw 回灌保命——vacuum 直接 reload=真丢）→修=**七步协议**（thaw 回灌→freeze+terminal close〔**4410 'doc-vacuuming'**——提前消费 generation-superseded 预留，语义吻合〕→serving 门〔vacuuming(pid) auth/withDoc 503〕→quiesce 等卸载+**清进程态**〔truth/delta/rev/writeFreeze/quotaFrozenDocs/overPush/truthMeasuredAt/recheckRounds〕→离线全根真空〔**doc.share 枚举复制**+stampDocSchema 显式盖戳+不支持根类型拒绝 vacuum 降级导出〕→**等价断言**〔readRecords 新旧深比不等⇒中止 equivalence-failed 不碰 DB——把信任 fillDoc 变成验证 fillDoc〕→**单事务**快照 upsert+增量 deleteMany+generation++）+**generation 落 DB 列+URL ?gen= 携带+auth 比对不匹配⇒terminal+reload**（版本门 csv 形态复用——覆盖休眠标签/断线重连/竞态三类）；**触发=REST 显式+二次确认**（报告2 建议：本批唯一不可逆操作，自动触发登记 Y1c 拿真实 residue 分布后再定）；liveBytes 改全根编码（修 U-6 residue 系统性高估）；T9 拆 T9（export-fresh）+**T9a（vacuum 独立 Task 七测试**——代际一致/stamp 保留/exec 保留/等价中止/quiesce 吞编辑红门/并发/generation 门）；②**bytes 桶 capacity=maxDocBytes+handshakeCredit 整删**（报告1 P0-2 数学实证：consume :29 Math.min(capacity) 封顶⇒cost>capacity 恒 false——1MB 桶下 >1MB 合法合并帧**结构性永拒**=离线编辑第二次重连起永久同步不上 1008 循环；报告2 E-1：一次性信用 3MB+5MB>8MB 第二次回灌被罚；报告3 P1-4：信用键 userId:pid vs delete(sid) 键不匹配=不清理+断连循环刷额度）→修=**capacity=this.quota.maxDocBytes**（与 Step2 帧闸上界对齐；**不变量测试：桶容量≥最大合法帧+cost>capacity 恒 false 防复发**）+**信用整删**（capacity 吸收突发——三问题结构消解）；**红门⑧=8MB 回灌第二次也通过**；③**T4 补 applyWriteFreeze 实现骨架**（报告3 P0-2：conn-status 修复无发送者——Q-A"六写点唯一出口"在 T4 仅注释；报告2 E-3：auth 期 viewer/spool 两点在 connectionConfig 置位时 Connection 未创建〔esm:1054 库在 onAuthenticate 返回后 new〕⇒**"六点=四点内联+两点 connected 补推"**）；④**softLimitBytes 三处对齐**（报告3 P0-3：T1 五键 toEqual vs T5 产生四键=互斥卡死；P1-2：恒 undefined⇒比较恒 false=客户端 gate 完全失效非过早拒绝）→Q-A payload 补 softLimitBytes+generation?+T5 buildDocStatus 产生+T10 缺省回退 maxDocBytes×softEnterRatio（禁 NaN 静默放行）+Q-I 注明客户端可用上限=软阈 6.7MB（文案与拦截点对齐）；⑤**awareness 入站帧闸改判采纳**（报告1 P1-1：三桶三分后 awareness 只受 30/s 帧数限——maxPayload 16MB⇒理论 480MB/s 解码路径含 scratch doc apply；**v3 驳回理由不成立**——库 IncomingMessage.readVarString+readVarUint 判型正是 census③ 形态非字节猜型，T7 出站已同款）→beforeHandleMessage 判型+Awareness>64KB⇒1009（解码前拦）；⑥P1 五项：overPush elapsed 5s→**10s**（count≥20/bytes≥2×maxTxBytes 维持；**4404 目标维持——驳回报告3 的 1008 化**：spec §4.1③"持续强推才 4404"原文+over 快照→collabReadOnly→UI 禁用链 1s 内生效+1008 循环对恶意更费连接资源；10s=横幅慢到达+用户反应余量）/connReadOnly 初值明确化（**authenticated 时刻 scope 作初值+connected 补推**——authScope=初值非删除）/thaw 后 30s 复冻冷却窗（实测>MAX 除外）/pending-measure 改**同步实测一次**（8MB 编码 23ms 一次性可接受——非静默丢用户动作）/Update 帧闸 **2× 余量**（>2×maxTxBytes 才 1009；〔maxTxBytes,2×〕区间放行进配额判据——客户端 JSON 估算 vs Yjs 每 item client+clock 头开销，误差退化为软冻结非终态断连）/writes_dropped 四值（quota|viewer|draining|spool）/recheckRounds: Map<pid,number> 脚手架；⑦一致性残留清理（报告3 十条+报告2 F 组，**T0 Step 0 加机械 grep**：`隔离|≥3|fillDocShapes|9MB|readOnly 字段` 命中逐条确认）：Goal/执行序 9MB 残留/fillDocShapes→**fillDoc(doc,records,edges)**（全仓实证真实签名——fillDocShapes 不存在）/T9 呈报 ≥3/T15 commit 29→35 条/T14 八→十组/T8 测试名"写后>预算"→"预演超限不写活 doc"/§0.3 装载隔离/Q-B ≥3 残留/测试文档名统一 project:<id>/Architecture"五层"改枚举表述；⑧新增 **§0.0 落地矩阵**（报告3 4.1：裁定表每条机制点名承载 Task/服务端产生点/客户端消费点/测试——**任一格空=该 Task 不得开工**——拦"表强码弱"漂移，本轮 P0-1/2/3 全属此类）；E-7 残余登记（16MB/连接攻击者缓冲——良民被帧闸钉在 8MB，诚实登记 §0.4c 不改码） | v6=三份 v5 复审收敛（vacuum 共享状态+代际门闭环+表强码弱三新形态；P0 三项+P1 六项采纳）：①**G-1 deferredConfirm×over 短路=无判据放行窗**（报告2：freezeQuota 草图中 quotaFrozenDocs.add 立即执行而 deferredConfirm 路径 readOnly 延至 2s 确认后置⇒判据②〔quotaFrozenDocs.has∧!readOnly⇒return〕在 2s 窗内放行一切不判配额；且确认测量被 truthBudget 挡掉时 readOnly 永不置=**永久关掉判据**）→修=**两态分离**：`freezePending: Set<pid>`（账面触阈置位——只广播 over+帧继续走③④判据+触发帧照常放行）与 `quotaFrozenDocs`（**与 readOnly 同一 setImmediate 内落地**——判据②的存在理由只剩 one-event-loop-turn）分离+确认实测**豁免进程预算**（fail-closed：测不了即当超限置 frozen——deferredConfirm 每 doc 至多一个在飞定时器频率受 cooldown 限）；②**代际门重设计=preVacuumSv 落库+SyncStep1 SV 重叠检测**（报告2 G-2+报告3 P0-1 合流：runtime:977 createProvider 会话重建重拼 URL 不读 location.search——**?gen= 结构性丢失**⇒reload 循环实证；报告1 P1-1 三补丁〔缺失放行/reason 下发/auth 缓存〕均治标）→**主拦截面=真空前 doc SV 与 generation 同事务落 DB 列 preVacuumSv，beforeSync type=SyncStep1 处解码客户端 SV（=Step1 payload）比对：客户端 SV 含 preVacuumSv 覆盖的 (client,clock) 区间⇒持有真空前历史⇒terminal 4410 'doc-generation-stale'**（零客户端配合〔休眠/旧 bundle/自制客户端全封〕+无 reload 回环〔判定基于内容非声明〕+空 SV 放行〔新页面结构性无污染〕+落点现成〔与配额判据同钩子〕）；**UX 收敛通道=广播**（T5 pendingGenerationReload 既有——在线客户端立即 reload）；**?gen= URL 门整删**；generation DB 列降级观测/审计；**T0 探针④补 SV payload 语义确认**；③**表强码弱三新形态**（报告3 P0-2）：T1 删 `{...ok,readOnly:true}===true` 前向兼容断言（诱导保留 readOnly——Q-A 要消灭的形态）+T1"四必选字段"→"顶层三必选+quota 五键+generation/residueBytes 可选"+**§0.2 collab_hydration_deferred_total 加 field=structs|ds 标签（B8 功能性违规：prom-client 未声明 label throw→装载降级路径抛错被 catch 折成 DB_UNAVAILABLE→画布打不开——与 Q-O 目标相反）**；④P1 六项：**真空事务取 lockProject 同键咨询锁**（repo:31"锁键单源 append/compact 共用"注释自证——结构性消失并发窗）+**stateSeq=被删行最大 seq**（compact :219 同纪律——禁 0/GREATEST：取号基准错=insert-ratchet 红线）；**清态清单扩普查表**（+store 记账 lastCompactAt/持久化队列+SnapshotDocCache 该 pid 条目〔TTL 30s 否则真空后继续供旧代投影〕+degradedDocs——附"真空后按 pid Map 无残留键"断言测试）；**T1 扩四码三常量**（GENERATION_SUPERSEDED:4410 启用+DOC_VACUUMING/DOC_GENERATION_STALE_TERMINAL_REASON+resolveCloseAction(4410)→terminal）；**doc-status 加 quota.residueBytes?**（T11"重建画布历史"入口数据源——Q-A/T1/T5/T11 四处同步）；**connected 钩子写出新增体**（报告3 P1-1：gateway:229 现形态只拿 socketId 无 Connection；auth 期 viewer/spool 置位不进 writeFreeze⇒spool 恢复时无对象可解=永久只读——修=connected 反查 Connection+applyWriteFreeze 登记补推；**驳回报告3"auth 期不再直写 config.readOnly"半条**：库时序 connected 在首批消息之后〔P5〕，不置位开首帧未拦窗口——config.readOnly 保留〔库级拦截〕+writeFreeze 登记补齐〔单源完整性〕）；⑤P2 采纳：T9a **try/finally**（中止路径 vacuuming.delete 必须+未提交恢复可写——否则 equivalence-failed 后 503 永久+全员只读比不 vacuum 更糟）+**quiesce 硬前置**（超时中止禁降级继续——"PG 完整性=已卸载推论"注释：未卸载即读 PG=丢最近 debounce 窗编辑且等价断言恰好通过）+等价断言扩全根（根类型集合+exec 键集+meta 戳三条 O(键数)）+overPush **idle-reset**（now-lastAt>5s⇒重置——休眠标签恢复后 count≥20∧elapsed≥10s 恒真误杀+慢速持续者 30s/帧×20=10 分钟同样命中）+真空窗口 exec 结果写由 **intent-reconcile 兜底重放**+窗口 30s 进 runbook+**零连接自动 vacuum 窄版**（冻结∧连续≥4 轮 recheck≥soft∧零连接∧residue>60%⇒后台 vacuum——无在线用户=无强制刷新伤害+避免画布无限期冻结〔报告1 P2-3〕；在线态仍人工触发）+容量口径（§0.3/部署清单注明"用户可见容量=maxDocBytes×softEnterRatio≈6.7MB"）；⑥H/P2 残留全清：偏离 27 删（与 32 矛盾）/29 标注"已被 36 修订"/T0 标题九项+模板补⑨/T15 Step4 commit 41/迁移回放双向比对（generation+preVacuumSv 列）/vacuum_total 加 quiesce-timeout/§0.2 residue 口径改全根编码/awareness 桶"实例共享"注/H-4 常量统一（AWARENESS_FRAME_LIMIT_BYTES 入站闸+AWARENESS_STATES_LIMIT_BYTES 解码后——两个实体两个名）；⑦**§0.0 增"字段一致矩阵"纪律**（报告3 5.4：同一机制四侧〔类型定义/断言/服务端产生/客户端消费〕字段名与键集逐字相同——本轮三处新形态全属此类，把"每轮修三处又出三处"的循环打断）；T0 Step0 ⑤ grep 词表扩 `握手信用|readOnly: true|四必选|4410|residue|fillDocShapes|9MB 推导|隔离|计数≥3`；⑧驳回登记（v6）：报告3"auth 期停写 config.readOnly"（首帧窗口——见④）；报告1 P2-6"Step2 包含性兜底独立实现"（SV 门拦 SyncStep1=规范路径全覆盖——Step2 直发属自制客户端绕过，帧闸限大小+开发期自托管威胁模型内，登记 §0.4c 不实现） | 驳回登记（v5）：报告3"overPush 升级目标 1008 化"（spec 原文+UI 禁用链+恶意经济性——见⑥）；报告3"count≥50"（20 帧+10s 已含人类余量——50 帧在拖拽 16ms/帧形态下仅 0.8s，帧数不是误杀主维度时间才是）；报告2 F-1"row_rejected 死指标仍在表内"（v4 已清——grep 实证仅 frame_rejected 在表）；报告1"信用可复充桶"（被 capacity=maxDocBytes+信用删除的结构简化吸收）  -->
# Y0b-4 配额与 awareness Implementation Plan（v5）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 Y0b 配额与 awareness 批（spec v2.7 §4.1-4.5 全节）——**实测真值三层配额**（客户端快照+delta 前置预算 / 服务端 beforeSync 分层判据+冷却限频实测 oracle / maxPayload=16MB pin 维持〔Q-T v4 撤回 9MB〕）+**双阈滞回软阈冻结**（0.8 setImmediate 冻结+quotaFrozenDocs 文档级注册+recheckTimer 自动解冻+SyncStep1 无损回灌）+**4404 分层升级**（首触冻结可解释/持续强推才终态——webSocket.close 先行 P7）+**装载不拒行**（pendingStructs+pendingDs 双查断言降级可观测+产生侧上界对齐）+**REST shrink/export-fresh 自救**（影子预演+同事务+发起端 undo 清理）+**vacuum 代际替换**（REST 显式触发+二次确认+零连接窄版自动——七步协议〔回灌→terminal close→serving 门→quiesce 清态→全根真空→等价断言→lockProject 单事务〕+**preVacuumSv SV 重叠检测代际门**〔Q-U v6——?gen= URL 门删除〕）+**幂等快照 rev**（doc-status 并轨 write-frozen+maxTxBytes/softLimitBytes 下行+conn-status 每连接推送）+**TokenBucket 按量扣减速率闸**（bytes 桶 capacity=maxDocBytes〔Q-E v5——桶容量≥最大合法帧不变量〕）+**剔字段式 awareness 治理**（readOnly/solo/over-8 三档同一原语——回显永不断+入站 64KB 帧闸）+**出站背压**（每 send 判 backlog）+**E38/E39/成员表**（复用既有 ProjectMembersPanel）。

**Architecture:** 判据物理量=**实测编码尺寸**（白名单五点：装载〔cheap<soft 跳过〕/compact〔pending 空时〕/shrink 预演+校准/over 检查〔冷却窗外〕/客户端漂移实测），运行期 delta 累加**仅触发器**（快路径 soft O(1)→账面超硬限才测量，**冷却窗 2s+over 短路=冻结面零编码**）。拒绝分层：客户端 seam=runCommand precheck（快照 bytes+全 origin delta 插值+1MB 漂移 requestIdleCallback 实测+超大 delta 同步实测——多用户天然正确+store 零污染）；服务端 beforeSync 分层判据（⓪帧闸 1009→①readOnly 计数早退〔per-conn overPush 升级〕→②over 短路→③快路径 O(1)→④冷却窗/实测——Q-B 序钉死）；冻结=writeFreeze 连接级（applyWriteFreeze 唯一出口〔四点内联+两点 connected 补推〕）+quotaFrozenDocs 文档级双注册（readOnly=原因集非空）；解冻=移除原因+SyncStep1 回灌（无损收敛）+recheckTimer 30s 滞回 0.6+thaw 后 30s 复冻冷却。awareness 治理=「剔 cursor/selection 字段保 user/presence」单原语三档（readOnly/solo〔distinct user≤1——取数源=文档全量∪本帧〕/over-8〔distinct user>8〕），回显永不断（§0.4b-11 保活链纪律推广）。

**Tech Stack:** Nest 10 + @hocuspocus/server 4.6.0（`IncomingMessage`/`MessageType`/`beforeSync` 库导出——check-hocuspocus-pin）/ yjs 13.6.32 / prom-client / vitest（直构+真连 kit）/ React 18 + zustand。

**执行门：** 每 Task Step 0 只读探针——**库行为断言必须来自运行打印（裸 ws 打印帧首字节/close 事件码），禁止源码阅读推断**（v1 六 P0 中三个正是推断替代实证）；输出粘 commit message。**每 Task 收尾 `git commit`，红→绿→commit**；**T9=4a 阶段出口【用户确认点】**（服务端核心四真红门）；**T15=子批出口【用户确认点】**；服务器部署=【告知用户点】。

**执行序（两阶段出口）：**

```
── 4a 服务端正确性核心（T0-T9）──────────────────────────────
T0（运行探针八项——真实帧 update[0] 打印/close 双路径投递码实测/beforeSync 形态/
     粘贴 transact 次数【分块设计输入】/awareness 剔字段回显/卸载取消可达性/
     ⑦8MB 编码耗时【冷却窗定标】/⑧丢帧留本地+SyncStep1 回灌全链【Q-C 唯一前提运行实证】）
  → T1（shared 契约——DOC_OVER_QUOTA:4404 终态+RATE_LIMITED_CLOSE:1008+SLOW_CONSUMER:1011
        +DOC_OVER_QUOTA_TERMINAL_REASON 常量〔1009 同款〕+QUOTA_DEFAULTS〔0.8/0.6 滞回〕
        +doc-status 快照类型【rev/无 readOnly/含 maxTxBytes】+utf8Bytes 单源+bump csv=2）
  → T2（env 四键——MAX_DOC_BYTES/MAX_TX_BYTES〔服务端帧闸消费!〕/MSG_RATE_PER_CONN/BYTES_RATE_PER_CONN
        +构造注入【禁 export let 测试钩子】+spec §10 fenced 同步）
  → T3（docTruth 真值单变量——装载后编码实测/compact 复用 newSnapshot/卸载守卫删条目【I-1 同款】
        +delta 触发器【update 监听降级】+cheap 上界播种【<soft 跳过编码+含 spool】
        +装载不拒行+pendingStructs 断言【degraded 可观测】+卸载守卫+聚合 gauge）
  → T4（beforeSync 分层判据——帧闸 1009〔先于 readOnly 早退〕/快路径 soft/账面超硬限才测量
        +【冷却窗 2s+over 短路零编码】+误冻结归零+setImmediate 冻结〔触发帧放行〕+freezePending 两态分离〔v6 G-1〕
        +4404 分层升级〔首触冻结/持续强推 per-conn 10s 窗才终态——webSocket.close 先行〕+冻结层单源
        +quotaFrozenDocs 文档级注册表+frozenRecheckTimer）
  → T5（幂等快照 rev——connected 即时补推/翻转广播/writeFrozen 并轨只置位
        +客户端 reducer〔rev 单调+authenticated 复位+组合式 readOnly+发起端 undo 清理〕）
  → T6（速率闸——consume 按量扣减〔cost〕+bytes 桶 capacity=maxDocBytes〔Q-E v5——信用删〕
        +awareness 共享桶+readOnly 剔字段〔保回显〕）
  → T7（出站背压——每 send 判 bufferedAmount〔决策不进采样〕+库常量判型〔readFrameType
        返回 number|null 边界安全——入站 awareness 帧闸复用同 helper〕+两级动作+maxPayload 16MB 维持〔Q-T〕）
  → T8（REST shrink——影子预演/TOCTOU 收同事务/全局信号量/recalibrate 出口
        +quotaThaw〔SyncStep1 回灌〕+gc pin+排队 10s 超时 503）
  → T9（export-fresh——真实签名 teamId/latch/落地编码校验）
  → T9a（**vacuum 文档代际替换〔Q-U v6——REST 显式+零连接窄版自动〕**：七步协议 try/finally/preVacuumSv
        SV 重叠检测〔SyncStep1 处〕/lockProject+stateSeq 纪律/全根复制+stampDocSchema/等价断言扩全根/
        共享状态普查表/quiesce 硬前置）★4a 出口：八条呈报（四真红门+编码成本两硬用例+vacuum 代际一致性+离线合并可上传）
── 4b 自救 UX 与 awareness（T10-T15）──────────────────────
  → T10（客户端预算——utf8Bytes 量纲/seam 前置 runCommand precheck〔store 零污染〕
        /判据④=快照+delta 插值+1MB 漂移后台实测/分块粘贴【T0 探针③定形】）
  → T11（quota UX——软阈通告/硬阈双主按钮/4404 分层终态+重连动作/瘦身对话框
        /发起端 undo 清理/编辑面禁用）
  → T12（E38 selection 去抖+高亮+4KB 限额〔具名常量〕）
  → T13（E39 单人短路 distinct user+30s 停报+over-8 剥离+成员表复用 ProjectMembersPanel）
  → T14（观测面核对+census 十组）
  → T15（出口汇聚——verify 三连+偏离登记 35 条+部署清单）★子批出口
```

**TDD 纪律：** 红→绿→commit，红相留档。**八条呈报**（4a 出口=spec §6.1「配额 apply 前拒绝」+外审新增五）：①超限帧现状已 apply 落库→冻结+快照告知（客户端可解释）；**持续强推才真观测 close 4404**（裸 ws close 事件码——非源码推断）；②**累积漂移不误冻**：真实 200KB+累计 update 10MB 的 doc→不冻结不 4404+truth≈200KB；③**冻结期编辑解冻后无损回灌**：冻结期客户端本地写→thaw SyncStep1→SyncStep2 回灌→服务端 doc 含该编辑（静默分叉=红相）；④**装载病态行不锁死自救**：埋超限行→装载照读+pendingStructs/pendingDs 断言可见+REST shrink 可达。**编码成本两硬用例（v3——P0-1 直接红门）**：⑤**冷却窗内连续 50 帧只编码 1 次**（truth_measured 增量=1+fastpath=49）；⑥**冻结态 50 帧编码 0 次**（over 短路——truth_measured 增量=0）。**v5 新增两条**：⑦**vacuum 代际一致性**：vacuum 后写入再重载⇒keys 完整+pendingStructs/pendingDs==null+meta 戳=2+exec 保留（报告1 实测反例=丢编辑+悬挂——T9a 红门）；⑧**离线合并可上传**：8MB SyncStep2 回灌**第二次**也通过（bytes 桶 capacity=maxDocBytes——v4 信用+1MB 桶组合下第二次结构性永拒=红相，报告1 P0-2）。**回归锚**：VIEWER 单连 90s 无 4408（readOnly 剔字段保回显——并入 collab-idle-anchor.spec 同一次等待）；单人剥离后 user/presence 仍在。**census 十组**（v3 扩）：①`close\(1008\|close\(1011\|close\(4404` 裸字面量清零 ②`Connection\.close\(` 应用侧清零（P7）③`frame\[0\]\|update\[0\]` 字节猜型清零 ④`encodeStateAsUpdate` 生产白名单六点外清零（装载〔≥soft 时〕/compact〔pending 空〕/shrink 预演+校准/over 检查〔冷却窗外〕/client 漂移实测〔requestIdleCallback〕/export-fresh fill 后实测〔Q-H census④ 白名单点〕）⑤`\.bufferedAmount` 仅背压单文件 ⑥`new TokenBucket` gateway 内恰三处定义点（升级/msg/bytes——awareness 共享桶+前缀）⑦web `setSelection\(|setAwarenessField\('selection'` 仅去抖单点 ⑧`type: 'write-frozen'` 服务端清零 ⑨`\.consume\(` 桶调用必须带 cost 参数（bytes 桶）或注释 cost=1（msg/aware——防 B-2 复发）⑩`pendingStructs` 装载断言存在性（Q-O）。**int 纪律/spec 同步/fenced 缩进**同 Y0b-3 惯例。**已知陷阱**：esbuild 无 decorator metadata（位置参数直构）；真连 describe 必须 `vi.useRealTimers()`；provider.destroy 后 `kit.forget`；metricDelta 前后差值；fake timers 卡死 ws IO。

---

## 0. 基线勘察锚点表（2026-10-11 HEAD=59734a13 一手核验+三外审交叉实证）

> **v2 勘误**（v1 之误，已实证）：`copyGroupToClipboard`（非 copyGroupClipboard）:2719-2734；collabDiagnostics 在 `apps/web/src/utils/`；dual-client-server 在 `apps/api/src/test-utils/`；**ProjectMembersPanel.tsx+projectMemberApi（GET/POST/PATCH/DELETE `/project/:id/members`）+project-member.controller @Delete 已存在**——T13 复用勿新建；Histogram 非全仓首例（exec.metrics 已有——"collab 模块内首例"）。

| 锚点 | 现状 | 本批动作 |
|---|---|---|
| `modules/collab/collab.gateway.ts:228-238` | hooks 九项；**beforeSync 未注册**（d.ts:313/920 存在——readSyncMessage 内 `beforeSync(connection,{type,payload})`，仅 Sync 帧，type=messageYjsSyncStep1/2/Update 已解析，payload=纯 update 字节） | T4 注册 beforeSync=配额判据唯一落点；beforeHandleMessage 仅帧计数（不分型） |
| 库 `processMessages`（server esm:444-479） | 帧布局=`[varString(docName)][varUint MessageType][payload]`——**帧首字节=名字长度**（`project:<uuid>`→44）；throw→`Connection.close({code,reason})`+**清空消息队列**（后续帧全丢——同批帧语义） | T4 拒绝链规避：webSocket.close 先行；分型禁 frame[0]（census ③） |
| 库 `Connection.close`（esm:418-426） | **只写 reason 进 CLOSE 报文，code 丢弃，不关 socket**；provider CLOSE case `code:1e3` 硬编码+onClose 后 1s 定时器重连（provider esm:454-462/404-414） | 拒绝必须 `connection.webSocket.close(code,reason)`（本仓 :1512 P7 纪律+五处先例 :1025/:1540/:1785/:1802/:1972）；T0 探针②运行实证投递路径 |
| 库 `readSyncMessage`（esm:248-297） | readOnly 只拦 SyncStep2/Update：Step2 分支带 `snapshotContainsUpdate` 幂等判定（重放放行/新内容拒），Update 分支直接拒——**均回 SyncStatus(false) 帧不 apply**；provider `applySyncStatusMessage(false)` **零动作**（provider esm:474-476）=静默分叉（本仓 :1008 注释自证）；awareness 分支（apply:201-224）**无 readOnly 门** | T4 先告后冻（客户端硬停写=主防线，readOnly=兜底）；T6 readOnly 剔字段；T8 thaw 补发 SyncStep1（`writeFirstSyncStepFor` 先例在 esm:258-262） |
| `writeFreeze` 现状 | readOnly 六写点：authenticateInner:586（spool）/:609（VIEWER）；beginDraining:1037+恢复 :1020-1022（drain 自动解除还原 prev）；recheckConnection:1632/:1641（sweep 降级/升回带停写守卫） | T4 单一冻结层 `writeFreeze: Map<conn, Set<'viewer'\|'draining'\|'quota'\|'spool'>>` 全写点改道——readOnly=集合非空；frozenConnections prev 快照退役（drain 恢复=移除 'draining' 原因） |
| compact 真值点 | `canvas-doc-update.repository.ts:205-215`：`new Y.Doc()` apply 全部行→`const newSnapshot = Y.encodeStateAsUpdate(temp)`→upsert——**编码已在做，byteLength 零新增** | T3 compact 后 `docTruth.set(pid, newSnapshot.length)`（真值重置+软阈滞回评估——用户删内容后自动解冻） |
| 装载路径 | readConsistent:100-130（快照行+分页增量 500 行）；单行>4MB WARN 观测（:115-121）；hydrateWithRecovery:150-163 只认 P2028/P1008/timeout 重试——**其他 throw 直接透传**→loadDocument catch 折成 DB_UNAVAILABLE（gateway:711-715）→客户端无限重试；**withDoc 同路装载**（esm:1602 openDirectConnection→createDocument→onLoadDocument）→REST shrink/export 同挂 | T3 超限行**隔离降级**（丢该增量行继续装载+终态 reason 独立映射——禁复用 db-unavailable）+产生侧上界对齐（spool merge 加 flushMaxBytes 上限 :849） |
| 卸载清理 | unloadDocument finally :1351-1371（**I-1 守卫先例 :1370**：`!documents.get(documentName)` 才删——库钩子后复检可取消卸载，取消时 doc 存活不重跑 loadDocument）；handleProjectsGone:906-919 真终态 | T3 docTruth/delta/writeFreeze 条目删除**带同款守卫**（finally 内套 `if (!documents.get(name))`；projectsGone 无守卫直删） |
| `withDoc`（collab-document.service.ts:47-66） | transact 同步段才在事务内（异步 fn 捕获 Promise 事务外 await）——**TOCTOU：同步读→异步算→回写跨事务** | T8 shrink 读+算+删收进**同一同步段**（预演编码也同步段内） |
| TokenBucket（token-bucket.ts） | {capacity, refillPerMin} 惰性 refill+MAX_KEYS FIFO 逐出+积分保留；**无 delete(key)** | T6 复用双桶+补 `delete(key)` 公共方法（token-bucket.spec 扩一行） |
| guardAwareness（gateway:1707-1764） | states 三分支（他人伪造丢帧/首见登记/owned 注入）+ghost 剔除；`AWARENESS_CLIENT_ID_LIMIT=4`；serverIdentityOf 注入 {id,name,role,color} | T6 顶部 readOnly 剔字段；T12 4KB 限额（具名常量 AWARENESS_FRAME_OVERHEAD——解码后 states 字节判）；T13 solo/over-8 剔字段（distinct user.id 判定） |
| 成员面（已存在） | `ProjectMembersPanel.tsx`（角色 Tag+逐行角色下拉）+`projectMemberApi.ts`（GET/POST/PATCH/DELETE）+`project-member.controller.ts:31 @Delete(':userId')`；权限变更已有 wirePermChangedEvents:1594-1605→即时 sweep 踢连 | T13 复用：CanvasTopBar 头像条 presence 增强+挂既有面板入口；**零新端点** |
| `pasteGroupClipboard`（canvasStore.ts:2739-2754） | 单 runCommand→buildCopyPlan→appendCopyPlan（:517-543 逐节点 setWithParentOrder+ns.addNode 双写）→finally dispatchProjectionDiff——**每节点是否各自 dispatch/transact 未实证**（v1 假设单 transact） | T0 探针③运行实证粘贴 100 节点的 transact 次数+undoStack 项数——分块设计输入（若已逐节点 dispatch=天然分块，T10 仅补预算检查） |
| web runtime（canvasCollabRuntime.ts 1230 行） | provider :974-996（csv 版本参数+presence 播种）；authenticated :892-899（collabReadOnly 授权写点+writeFrozen 清位）；stateless :901-913（仅 write-frozen 分支）；onAuthenticationFailed :917-930；message-too-big terminal 先例 :950-959+`MESSAGE_TOO_BIG_TERMINAL_REASON`（SyncBanner :58 消费） | T5 stateless 改 doc-status reducer（rev 单调+readOnly 单源）；T11 4404 terminal 档循 1009 同款路径（close 分支+terminal reason 常量——**不进 auth reason 词表**） |
| 客户端 undo | UndoManager trackedOrigins=LocalUser+captureTimeout 500；**undo/redo 直接回放 update 绕过 dispatchCanvasIntent**（canvasUndo.ts:51/61） | T10 判据④ delta 全 origin 天然覆盖 undo/redo；undo 清理只清发起端（shrink 响应——对端 trackedOrigins 不含远端删除，Q-A③） |

**§0.0 落地矩阵（v5 新增——报告3 4.1 采纳：裁定表每条承重机制必须点名四落点，任一格空=该 Task 不得开工；拦"表强码弱"漂移——v4 的 vacuum/conn-status/softLimitBytes 三条 P0 全属此类）**

| 机制 | 裁定 | 承载 Task | 服务端产生点 | 客户端消费点 | 测试 |
|---|---|---|---|---|---|
| doc-status 快照（rev/softLimitBytes/maxTxBytes） | Q-A | T1 类型+T5 产生 | buildDocStatus（五键 quota+generation?） | T5 stateless reducer | T1 Object.keys 五键+T5 rev 幂等族 |
| conn-status 每连接推送 | Q-A | T4 | **applyWriteFreeze**（四点内联）+connected 补推（两点） | T5 connReadOnly 组合式 | T4 writeFreeze 单源族 |
| 真值+delta+冷却+进程预算 | Q-B | T3+T4 | docTruth/docDelta/truthMeasuredAt/truthBudget | —（服务端内部） | T3 播种族+T4 成本⑤⑥ |
| 冻结层+recheckTimer | Q-C | T4 | writeFreeze Map+quotaFrozenDocs+**recheckRounds** | T5 writeFrozen 只置位 | T4 真红门①③ |
| 4404 分层+overPush per-conn | Q-D | T4 | overPush: Map<sid,{count,bytes,firstAt}>（10s 窗） | T11 terminal 档+重新连接 | T4 真红门①b |
| TokenBucket cost+bytes 桶容量 | Q-E | T6 | bytesBuckets（**capacity=maxDocBytes**，信用删） | — | T6 红门⑧+容量不变量 |
| awareness 剔字段三档+帧闸 | Q-L | T6/T12/T13 | guardAwareness 顶部+beforeHandleMessage 判型 64KB | T13 成员表 presence | T6 回显族+T13 反例 |
| 出站背压 | Q-F | T7 | wrapBackpressure（send 包装） | — | T7 决策不进采样族 |
| shrink/recalibrate/thaw | Q-G | T8 | collab-shrink.service+quotaThaw | T11 三档提示+undo 清理 | T8 TOCTOU 族 |
| vacuum 代际替换+SV 代际门 | Q-U | **T9a** | vacuum 七步 try/finally+preVacuumSv DB 列+beforeSync SyncStep1 重叠检测 | T5 pendingGenerationReload→T11 clear+reload（广播通道）；4410→terminal 档 | T9a 十测试（含 reload 不循环/中止恢复/SV 检测三向） |
| 客户端判据④+seam 前置 | Q-I | T10 | —（快照由 T5 下行） | canApplyIntent+runCommand precheck | T10 拒=双不变族 |
| bump csv=2 | Q-S | T1 | CLIENT_PROTOCOL_VERSION 常量 | provider URL csv | collab-protocol.test 断言 1→2 |

**字段一致矩阵（v6 新增纪律——报告3 5.4：同一机制四侧必须逐字一致，任一侧漂移=执行卡死或契约回潮；本轮 P0-2 三处全属此类）**：
- CollabDocStatusPayload.quota 键集 → Q-A 定义〔五键+residueBytes?〕↔ T1 Object.keys 断言 ↔ T5 buildDocStatus 产生 ↔ T10 消费——四处字段名逐字相同；
- conn-status readOnly → Q-A"无 readOnly 于 doc-status"↔ T1 断言（**禁前向兼容 true 断言**）↔ T5 组合式 ↔ census readOnly 直写点清单；
- collab_hydration_deferred_total → §0.2 labelNames ↔ T3 .inc({field}) 调用点（B8：prom-client 未声明 label throw——功能性非文档性）；
- 4410 族 → Q-U reason 常量 ↔ T1 三常量 ↔ resolveCloseAction ↔ T5 close 映射 ↔ T11 终态档——五处同名同码；
- AWARENESS 常量 → Q-K/Q-E 引用 ↔ T6/T12 实现——两个实体两个名（AWARENESS_FRAME_LIMIT_BYTES=64KB 入站帧闸/AWARENESS_STATES_LIMIT_BYTES=4KB 解码后 states 判）。

**§0.1 设计裁定表（v2 重编——Q 系列续编；v1 仍成立者并入）**

| # | 裁定 | 依据 |
|---|------|------|
| **Q-A（v5 修）联合快照+rev——文档级事实单源** | `{type:'doc-status', rev:number, writeFrozen:boolean, generation?:number, quota:{state:'over'\|'ok', bytes, limit, maxTxBytes, softLimitBytes}}`——**v5：quota 五键定稿**（softLimitBytes 进 payload〔报告2 G+报告3 P0-3：T1 五键 toEqual 断言与 T5 四键产生互斥——Q-A/T1/T5 三处逐字对齐〕+generation 可选字段进顶层〔Q-U vacuum 代际门——E-6：T5 消费但契约无字面=单向〕）；①**去 readOnly 字段维持**→**连接级真值走每连接 conn-status 推送**（`{type:'conn-status', readOnly}`——**v5：六点=四点内联+两点 connected 补推**〔报告2 E-3：auth 期 viewer/spool 两点在 connectionConfig 置位时 Connection 未创建——esm:1054 库在 onAuthenticate 返回后才 new Connection，sendStateless 结构性不可达；这两点改 connected 钩子补推初值（与 doc-status 补推同点），drain begin/end+sweep 升降+quota freeze/thaw 四点走 applyWriteFreeze 内联〕；修 P0-1 authScope 污染+补 sweep 降级 :1631-1635 静默分叉洞；单连接内 stateless 有序无乱序）；客户端 `collabReadOnly = connReadOnly \|\| quotaOver \|\| writeFrozen`（**v5：authScope=初值非删除——authenticated 时刻 scope 仍作 connReadOnly 初值**〔报告1 P1-4：首推前 undefined\|\|…=falsy⇒VIEWER 写权 fail-open 窗——初值+connected 补推关闭该窗〕，conn-status 到达后覆盖为唯一真值）；②**quota 加 maxTxBytes+softLimitBytes**（双源发散=重连循环且不可自诊——单一权威源；**Q-I 注明客户端可用上限=软阈 6.7MB——用户被拦在 soft 线，over 态只由绕过客户端的连接产生，T11 文案与拦截点对齐**）；③**删 deletedIds**（只清发起端〔shrink REST 响应处理〕）；rev=per-doc 单调计数器（**装载播种 1**）+**authenticated 复位 lastDocStatusRev=0**（生命周期绑定）；writeFrozen 只置位（复位=重连链路）；触发面=(a)connected 钩子即时补推〔doc-status+conn-status 双补〕(b)状态翻转（freeze/unfreeze/shrink/recalibrate/drain 进入） | 外审 B-1+P1-2+P1-13+D-4/C-1+报告3 P0-3+报告2 E-3/E-6+报告1 P1-4 合流 |
| **Q-B（v3 重写）真值+触发器+冷却分层** | `docTruth: Map<pid,number>`（实测真值）+`docDelta: Map<pid,number>`（自上次实测累加——触发器）+`truthMeasuredAt: Map<pid,number>`（**冷却窗 2s**——T0 探针⑦实测 8MB 编码耗时定标，原则=冷却窗内最坏编码 CPU 占用 <5% 单核）；**测量点白名单**：装载后（**cheap 上界播种**：`\|state\|+Σ\|updates\|+Σspool 帧` 在全部 apply 之后算——上界 <soft 直接当 truth **跳过编码**〔上界≥真值=保守正确，99% 装载零新增成本〕；≥soft 才付费实测）/ compact 后（**仅 pending 队列空时生效**——newSnapshot=持久化真值口径，活 doc 含未 store delta；非空跳过下次）/ shrink 写后 / over 检查（冷却窗外）；delta 累加=**doc.on('update') 唯一写者**（装载后挂；hook 内只读不写——v3 草图快路径回写+update 事件同帧双加=delta 2× 速涨〔报告2 A〕）；**进程级测量预算**（≤1 次/200ms+duty≤5%——超预算退上界决策交确认定时器纠错〔报告2 D：10 doc 贴阈=事件循环每 23ms 卡一次〕）；**判据五层（beforeSync，序钉死）**：⓪帧闸（见 Q-E）→①readOnly 早退（**计数** collab_quota_writes_dropped_total——交库 SyncStatus(false)）→②**over 短路**（quotaFrozenDocs.has(pid)→吞帧 return（升级判定全在①readOnly 分支 per-conn overPush〔Q-D v5——文档级计数≥3 形态退役〕）——冻结面逐帧**零编码**拒绝）→③快路径 `truth+delta+payload ≤ soft` → `delta+=payload` 放行（O(1)）→④账面触阈：**冷却窗内→不测量**，按上界决策（上界>MAX→**freezePending(pid) 两态分离**〔v6 G-1：v5 的 quotaFrozenDocs.add 立即+readOnly 延后=判据②在确认窗（2s；确认测量被 truthBudget 挡掉时**永久**）放行一切不判配额〕——freezePending 只广播 over+挂 cooldown 到期即测确认定时器（单 doc 去重，实测<soft 立即 thaw 毫秒级纠错〔报告2 C：v3 只挂 30s recheck=误冻结最长 30s 全员停写〕）；**deferredConfirm 期间帧继续走③④判据**（本轮触发帧照常放行"不丢触发帧"性质保持）；**确认实测豁免进程预算**（被挡时 fail-closed 直接置 quotaFrozenDocs——每 doc 至多一个在飞定时器频率受 cooldown 限）；quotaFrozenDocs 与 readOnly 同一 setImmediate 落地〔Q-C〕）；≤MAX→放行）；**冷却窗外→实测（先过进程预算闸）** `encodeStateAsUpdate(doc).byteLength`：`>MAX`→冻结+放行本帧（Q-S 分层——禁静默丢合法帧）；`≥soft`→冻结；`<soft`→truth 校准+delta=0+放行（误冻结归零）；**编码频率不变量**：良民=达 soft 即冻结后零帧零编码；绕过者=over 短路零编码；竞态窗=帧闸外零编码——最坏=每 doc 每冷却窗 1 次（0.5 次/s×50ms≈2.5% 单核）；两条硬用例钉死（冷却窗 50 帧 1 次编码/冻结态 50 帧 0 次编码——truth_measured/fastpath 计数器断言）；测量体 try/catch+`pendingStructs!==null` 沿用旧 truth（fail-open 保守向） | 外审 P0-1（三报告共同）+P1-3/C-4/P2 系列合流 |
| **Q-C（v3 修）冻结层三件套+recheckTimer 解冻** | 连接级 `writeFreeze: Map<conn, {pid, reasons:Set<'viewer'\|'draining'\|'quota'\|'spool'}>}`（**值含 pid**——onDisconnect O(1) 清理防强引用泄漏）+**文档级 `quotaFrozenDocs: Set<pid>`**（auth 判定/gauge/over 短路 O(1) 查询——冻结态跨重载自洽）；**freeze 序（v3 修；v6 两态分离）**：**freezePending: Set<pid>**（账面触阈/deferredConfirm 态——只广播 over，帧照常走③④，**不进 quotaFrozenDocs**）与 **quotaFrozenDocs**（确认/实测冻结态——**与 readOnly 同一 setImmediate 内落地**：`setImmediate(() => { 逐连接 applyWriteFreeze('quota',true); quotaFrozenDocs.add(pid); })`——判据②的存在理由只剩 one-event-loop-turn〔v6 G-1：放行窗边界=一个事件循环轮次，不能是确认定时器〕；beforeSync 内同帧置 readOnly=触发帧被库静默吞=丢合法编辑；越限量有界 ≤2×maxTxBytes 帧闸）；**thaw 序**：移除 'quota'+quotaFrozenDocs.delete → 对全部连接 send(`createSyncMessage().writeFirstSyncStepFor(document)`)（冻结期编辑经 SyncStep2 回灌——T0 探针⑧运行实证）→ 重测仍 ≥soft 再冻结 → broadcast(ok)；**thaw 后 30s 复冻冷却**（报告1 P1-8：deferredConfirm 冻结→确认→立即 thaw 的贴阈抖动=UI 闪断——冷却窗内不因软阈复冻〔实测>MAX 硬限除外〕）；**解冻载体=frozenRecheckTimer（独立 timer 30-60s，仅遍历 quotaFrozenDocs——冻结 doc 极少成本可控；禁挂 sweep〔SWEEP_ENABLED=false 逃生阀不得静默关掉它〕；**`recheckRounds: Map<pid,number>` 连续计数器**——实测 ≥soft 累计、<soft 清零〔vacuum 触发判据字段，报告3：v4 仅注释无脚手架〕）**——**非 compact 驱动**（冻结后帧全被吞⇒无 update⇒无 store⇒无 compact=自锁闭环，maybeCompact 仅 :835/:1308 两点实证不可达）；新连接冻结期加入=auth 查 quotaFrozenDocs 加 'quota'（无 prev 快照缺口）；**connected 钩子登记补推（v6 报告3 P1-1）**：gateway:229 现形态只拿 socketId——新增体反查 `documents` 内 matching Connection 后 `applyWriteFreeze(c,'viewer'|'spool',true)` 登记（**auth 期 config.readOnly 置位保留**——库时序 connected 在首批消息之后〔P5〕，不置位开首帧未拦窗口；connected 把意图登记进 writeFreeze 单源+conn-status 补推——spool 恢复时有对象可解，否则永久只读）；frozenConnections（drain prev 快照）退役；drain 冻结改走同层（'draining' 原因）；**recheck 连续 2 轮 ≥soft ⇒ 计算 residue 并更新 `collab_doc_residue_bytes`+冻结横幅亮出「重建画布历史」入口（T11——v5：检测自动化、动作人工化，自动触发登记 Y1c）** | 外审 B-3（自锁）+P0-6/E-3+P1-6（conn 清理）+C-3（setImmediate）合流 |
| **Q-D（v3 修）4404 分层升级（spec"持续强推"对齐）** | **首触硬限=拒绝该帧的增量+冻结+放行本帧+快照告知**（合法边界越限〔可能只超 1 字节〕退化为可解释拒绝——客户端横幅+瘦身/导出自助，**不是断连**；Yjs 无回滚，拒帧=丢用户数据）；**冻结期持续推送才 4404**（**v4：per-connection 键 overPush: Map<sid,{count,bytes,firstAt}>**——升级条件=窗口内 `count≥20 或 bytes≥2×maxTxBytes` **且** `now-firstAt≥10s`，**且 idle-reset：`now-lastAt>5s ⇒ 重置 count/bytes/firstAt`**（v6 报告1 P2-2：休眠标签恢复后 count≥20∧elapsed≥10s 恒真误杀+慢速持续者 30s/帧×20=10 分钟同样命中——"持续"必须真持续；st 结构补 lastAt 字段）（**v5：5s→10s**——over 快照→collabReadOnly→UI 禁用链 1s 内生效，10s=横幅慢到达+用户反应余量；**驳回报告3 的 count≥50**〔帧数非误杀主维度时间才是——拖拽 16ms/帧形态下 50 帧仅 0.8s〕**+1008 化**〔spec §4.1③ 原文对齐+1008 循环对恶意更费连接资源+T11 重新连接动作已备〕）；**复位只在 thaw**（freeze 重入不清零——防攻击者周期触发重测永不升级〔报告3 P0-D〕）；计数落点=①readOnly 分支（冻结落地后帧进此）；②延后窗内（setImmediate 前）放行不计数；只对触发连接升级→升级链：sendStateless(over)→`webSocket.close(4404,'doc-over-quota')`+collabWsCloseTotal→throw 中止帧〔socket 已 CLOSING 库 send 自吞无递归〕——**code 权威投递路径=webSocket.close，throw.code 仅兜底**（注释钉死防 P8 误读回潮；T0 探针②打印两路径客户端观测码）；客户端 (4404,\*) 与 (1000,'doc-over-quota') **都**映射 terminal（网络层剥离 code 是必需路径非防御）；terminal 常量 DOC_OVER_QUOTA_TERMINAL_REASON（1009 同款——不进 auth reason 词表）；T11 横幅「重新连接」动作（终态后唯一复位——瘦身后手动重连→补推 ok 自愈） | 外审 C-6（分层）+P1-3（双写者+剥离）合流；spec §4.1③「持续强推才 4404」原文对齐 |
| **Q-E（v5 重写）TokenBucket 按量扣减+bytes 桶容量对齐+帧闸 1009** | **TokenBucket.consume(key, cost=1) 按量扣减**（v2 consume 每次扣 1=字节桶纸面设计——token-bucket.ts:30/:42 实证；cost 参数默认 1=既有两处调用零改动；失败保留积分语义对 cost 同构）；msg 桶：capacity 400/refill 200×60（帧数 cost=1）；**bytes 桶：capacity=maxDocBytes/refill 2MB/s×60——consume(sid, frameBytes)**（**v5 重写**：v4 的 1MB 容量+握手信用组合被报告1 P0-2 数学证伪——consume :29 `Math.min(capacity,…)` 封顶⇒**cost>capacity 恒 false**，信用耗尽后 >1MB 合法离线合并帧结构性永拒=第二次重连起 1008 退避循环永久同步不上；且信用键 userId:pid vs delete(sid) 不匹配=不清理〔报告3 P1-4〕+一次性额度第二次回灌被罚〔报告2 E-1〕——**三问题经"桶容量≥最大合法帧"不变量+信用整删结构消解**：capacity=maxDocBytes 与 Step2 帧闸上界对齐，首帧突发由桶容量吸收，稳态 2MB/s 节流；sid 键断连重置桶=msg 桶同款 DoS 兜底语义〔升级限流桶挡断连循环〕）；**不变量测试两条**：capacity≥maxFrameBytes（Step2 闸值）+cost>capacity 结构性恒 false 防复发（census⑨ 防不到的形态——显式断言）；awareness 帧数桶 30/s（独立 TokenBucket 实例+键 `aware:${sid}`——**与 msg 桶参数不同不可共实例，census ⑥=恰四处定义点**）；**三桶落点三分（H-3——消双计入站免解析）**：msg 计数=beforeHandleMessage（无需分型）/awareness 限速=beforeHandleAwareness（天然）/bytes 桶+握手信用=beforeSync（type 现成）；（**v5：handshakeCredit 整删**——见上）；onDisconnect 全桶 delete；超限断连=webSocket.close(1008,'msg-rate-exceeded'\|'bytes-rate-exceeded')+throw；**帧上限两级（beforeSync ⓪层，先于 readOnly 早退——VIEWER 发巨帧也过闸）：Update>**2×maxTxBytes** 或 Step2>maxDocBytes → 拒 1009 'frame-too-large'（**v5：Update 闸 2× 余量**〔报告2 E-2〕——客户端按 utf8Bytes(JSON) 估算 vs Yjs 每 item client+clock 头开销，多小键形态实际编码可超 JSON；零余量下估算误差=1009 终态断连，2× 使误差退化为软冻结〔超 maxTxBytes 的帧放行进配额判据——快路径/冻结兜底〕）**（**v3 改码：1008 backoff=重连原样重发=无限循环；帧过大=内容确定性→复用 MESSAGE_TOO_BIG terminal 链路即得正确 UX**；1008 只留真速率超限）；SyncStep1 零成长永不判 | 外审 P0-2/B-2（cost）+P3-1（容量解耦+信用）+P1-2（1009）+P0-4（闸先于早退）合流 |
| **Q-F（v2 重写）出站背压=每 send 判** | webSocket.send 包装（T0 探针①确认出站必经点）：**每次 send** O(1) 读 bufferedAmount——awareness 帧（库 `IncomingMessage`/`MessageType` 解析判型——禁 data[0]）且 >1MB ⇒ drop+计数；>4MB ⇒ 直接 `close(1011,'slow-consumer')`（**三连击只用于观测去抖不用于保护**——决策不进采样）；`yjs_outbound_backlog_bytes` 直方图 1/10 采样（采样只归观测）；sync/stateless 永不 drop | 外审 P1-3：停滞 socket 两次 send 间可再堆 10 帧——决策进采样=内存上界放大一个数量级 |
| **Q-G（v3 修）shrink 判据与通道** | body `{deleteNodeIds?\|keepNodeIds?}` 二选一或**空体=纯 recalibrate**（不删内容也校准解除假冻结）；流程=assertEditorWithTeam→全局信号量（并发 1+**排队 10s 超时→503 Retry-After**——禁无限等）→withDoc **同一同步段**：readRecords→victims→影子预演→`shrunk>MAX ⇒ 422 {bytes,limit}` 不写活 doc→达标→同步段内删活 doc→活文档再编码校准 docTruth（白名单点）→quotaThaw（truth<0.6×MAX：移除冻结+SyncStep1 回灌+广播 ok）→**响应 `{result, watermark, deletedIds}`——发起端 undoManager.clear()+水位重置+提示（对端不清——见 Q-A③）**；审计 `collab_doc_shrink_total{result=ok\|still-over\|noop\|recalibrated}`+时长直方图；gc pin 维持 | 外审 P1-4/P1-8/P1-12/P1-14+D-4/C-1 连带合流 |
| **Q-H（v2 修）export-fresh 归属与幂等** | `CanvasService.create(name, folderId, userId, teamId?)` **真实签名**——显式传源项目 teamId/folderId/派生名（`〈原名〉(瘦身副本)`）——**不传 teamId 会落默认团队=协作者全员失去访问**（外审 P1-6）；in-flight latch `Map<userId:projectId,Promise>` 维持；**导出为次通道**（主=shrink+自动解冻；export-fresh=真空出口——报告1 §4.4 降级采纳一半：导出文件能力已有 escapeWithLocalExport，REST export-fresh 服务团队导出场景保留）；新项目落地后校验编码尺寸（fillDoc 后 encodeStateAsUpdate——超限则响应带 warning 字段，不阻断） | 外审 P1-6/E-4.4 |
| **Q-I（v3 重写）客户端判据④=快照+delta 插值+漂移实测** | canApplyIntent 四判据：①单键 utf8 先判（更具体文案；②子集注释）②Σ utf8Bytes ③节点数 ④**`localDocBytes + utf8Bytes(tx) > quota.limit` 拒**——localDocBytes=**单一变量双来源**：权威=快照 quota.bytes 到达直接覆盖（O(1)）；插值=两次校准间 doc.on('update') **全 origin** delta 累加（远端编辑进本地 doc=多用户天然正确；undo/redo 覆盖）；**漂移防护双路径**：常规=delta 累计>1MB 触发 `requestIdleCallback({timeout:2000})` 后台实测 `encodeStateAsUpdate` 自校准（读路径只读缓存值——零 UI 卡顿；delta 单调涨=误拒方向保守安全，漂移有界 ≤1MB）；**超大兜底=localDelta>4×maxTxBytes 时同步实测一次再判**（**v5 修订**〔报告1 P1-7：v4 的返回 {ok:false,reason:'pending-measure'}=静默丢用户粘贴动作需重做〕——8MB doc 编码 23ms 本机/50-90ms 2 核机，一次性用户主动路径可接受；实测后真值判定（放行或拒都基于 measured），消灭"pending-measure"拒绝形态——枚举值保留给 idle 在途窗（下次 dispatch 即通过））；tx 上限取**快照 quota.maxTxBytes**（首快照前用 QUOTA_DEFAULTS 同值兜底——connected 即时补推使窗口 <1s）；**softLimit 取快照 quota.softLimitBytes，缺省回退 `QUOTA_DEFAULTS.maxDocBytes×softEnterRatio`（=6.7MB——禁回退硬限 maxDocBytes**〔报告3 P1-2：恒 undefined⇒NaN 比较恒 false=gate 完全失效非过早拒绝；回退硬限=放行注定触发服务端冻结的写入〕）；**判据④客户端可用上限=软阈**——用户被拦在 soft 线（6.7MB/8MB），服务端 over 态只由绕过客户端的连接产生，T11 文案按软阈表述；**seam 落点（v3 关键修正）：runCommand 增可选 precheck 参数**（与 canEdit 前置门并列先例——canvasStore.ts:1773 形态）——粘贴=buildCopyPlan 纯函数先算→定块→**每块 precheck 通过才写**（nodeStore.addNode 纯本地 set+doc 写在 finally dispatch——dispatchCanvasIntent 层拒时 **store 投影已污染**，实证；dispatch 内检查降级为断言兜底+diag）；**undo/redo 同门口**（只对 redo precheck——undo 只减尺寸）；验收锚补"拒=store 与 doc 双不变" | 外审 C-1（seam 前置）+P1-10/P2-1（单模型）+C-5（调度化实测）合流 |
| **Q-J（v2 条件化）分块粘贴——T0 探针③定形** | 探针③实证粘贴 100 节点 transact 次数：**若 appendCopyPlan 逐节点已各自 dispatch（N transact+captureTimeout 合并）→天然分块，T10 仅补逐块 canApplyIntent 前置**；若确为单 transact → v1 贪心切块方案启用（chunkCopyPlan 按 records 拓扑序 200KB/500 节点）；undo 一步锚（undoStack.length===1）两形态通用 | 外审对 v1 假设的质疑（"runCommand 内分块仍单 transact"）——探针先行不预判 |
| **Q-K 4KB 限额（v2 微调）** | 客户端：setSelection 前序列化 utf8 字节>QUOTA_DEFAULTS.awarenessLimitBytes 拒+diag；服务端两个实体两个常量（v6 H-4 统一）：**AWARENESS_FRAME_LIMIT_BYTES=64KB**（入站帧闸——T6 beforeHandleMessage 判型后帧字节判，解码前拦）+**AWARENESS_STATES_LIMIT_BYTES=4KB**（解码后 states 字节判——`JSON.stringify([...states.values()]).length`）拒帧计数 reason=frame-too-large | 外审 P1-17 |
| **Q-L（v2 推广）剔字段原语三档** | 「`states.set(clientId, {...state, cursor:undefined, selection:undefined})` 浅拷贝剔键（user/presence 保留）」单原语三档：readOnly（T6）/solo（distinct user.id≤1——T13）/over-8（distinct user.id>8——T13）；**永不删条目永不整帧丢弃**（回显=保活链前提 §0.4b-11/17 推广到 readOnly 档——外审 P0-5）；distinct user 判定=**document.awareness.getStates() 文档全量 ∪ 本帧 states 的 user.id 去重**（P1-6：本帧 states 只含发帧者——10 人画布单帧会误判 solo 剥光标；全量取数源 esm:609 getStates() 库提供）；**连接数≠人数登记偏离**+T13 反例用例（多人画布单帧不触发 solo）；回归锚：VIEWER 单连 90s 无 4408 | 外审 P0-5/P1-8/B-5/E-6 裁定合流（distinct user 优于 connections.size——产品语义） |
| **Q-M（v2 缩减）成员表复用** | T13=CanvasTopBar 头像条增强（在线点 presence+色）+点击挂**既有 ProjectMembersPanel**（角色显示/撤销入口/DELETE 全部复用——**零新端点零新面板**）；权限变更即时踢已有 wirePermChangedEvents:1594-1605（复验 sweep 事件驱动——撤权后 ≤1s 踢连已验） | 外审 P1-14/报告3 D 表实证（v1 勘察 grep `.role` 漏 camelCase——教训登记） |
| **Q-N 农场零动作（v1 维持）** | §9.32/33 本批零代码（观测已有+Z95 语义冲突风险），登记 §0.4 防漏做 | v1 原裁定 |
| **Q-O（v3 修；v5 同步代码 sketch）装载不拒行+pendingStructs/pendingDs 双显式断言+产生侧上界** | **装载侧不拒绝任何行**（真跑实证：跳行=后续因果依赖 struct 静默进 pendingStructs defer——"丢一行"实为"丢因果链"且画布"装载成功"无信号，比 v1 throw 更隐蔽）；读到 >4MB WARN 行照读+P0 级结构化日志（病态行已入库=读它是唯一看到内容的途径；产生侧已对齐=结构性不可产生，此为防御）；**装载完成后断言 `doc.store.pendingStructs==null && doc.store.pendingDs==null`**（两独立字段——只含删除的跳行触发后者不触发前者；**v5：T3 代码 sketch 同步双查**〔报告3 P1-5：v4 表格双查/代码单查——执行者照抄 sketch 即漏〕）——非空 ⇒ `collab_hydration_deferred_total`（**label=structs/ds 分列两值**）+ERROR+该 doc 标记 degraded（快照/健康面可见——降级成为可观测状态非沉默）；产生侧对齐维持（spool merge 切批 ≤1MB+帧闸——超限行结构性不可产生）；v1/v2 的"隔离降级拒绝"形态退役 | 外审 P0-3+D-8+报告3 P1-5 合流 |
| **Q-T（v4 撤回；v5 信用删后表述修）maxPayload 维持 16MB** | v3 的 9MB 推导被否（P0-4：Step2 越界放行上界=maxDocBytes→doc 可达 ~2×MAX，maxPayload=MAX+1MB 会在半途先杀合法合并帧——自相矛盾）；**维持 Y0b-3 的 16MB pin 零改动零重探**；越界不变量落测：`docSize ≤ maxDocBytes + maxFrameOvershoot`（Overshoot=**2×maxTxBytes**〔v5 随 Update 闸 2× 余量同步——Q-E〕或 Step2≤maxDocBytes）；**Step2 ≤maxDocBytes 放行进配额判据**（**v5：handshakeCredit 删除后无免检通道形态**〔Q-E〕——每帧都过 bytes 桶〔capacity=maxDocBytes〕+配额判据，合并不成为绕过面）；**残余登记（E-7）**：16MB/连接攻击者缓冲（良民路径被帧闸钉在 maxDocBytes——超出的部分只有非合规客户端会用到；诚实登记 §0.4c 不改码） | 外审 P0-4+报告2 E-7 合流 |
| **Q-U（v6 重写）vacuum 文档代际替换——SV 重叠检测代际门+完整事务边界** | 残留实测与七步骨架维持 v5；**v5 的 ?gen= URL 门被三报告证伪**：runtime:977 createProvider 会话重建重拼 URL 不读 location.search——reload 后 gen 丢弃⇒undefined!==n⇒terminal⇒reload=**无限循环**（报告3 P0-1 实证）；报告1 的三补丁（缺失放行/close reason 带新值/auth 缓存）均治标。**v6 主拦截面=preVacuumSv SV 重叠检测**（报告2 G-2）：真空前 doc 的 stateVector 与 generation **同事务落 DB 列 `preVacuumSv Bytes`**（重启不失效）→`beforeSync type=SyncStep1`（payload=客户端 SV——T0 探针④实证语义）解码比对：**客户端 SV 含 preVacuumSv 覆盖的 (clientID,clock) 区间⇒持有真空前历史⇒terminal 4410 'doc-generation-stale'**；空 SV（新页面）放行——结构性无污染可能；reload 后新 doc 新 clientID 放行——**无回环**；零客户端配合（休眠标签/旧 bundle/自制客户端全封）。**UX 通道=广播**（T5 pendingGenerationReload 既有——在线客户端立即 reload）；?gen= 整删；generation 列降级观测/审计；**装载路径回填 preVacuumSv 进进程缓存**（auth 零新增 DB 查——G-3 纪律）。**事务边界（v6 报告1 P1-2+报告2 G-3）**：⑥ 单事务首行**复用 lockProject(tx,pid)**（repo:31 锁键单源注释自证"append/compact 共用——漂移=stateSeq 谎话"；serving 门是概率保证〔scheduler/运维脚本/未 drain spool 残路径〕，advisory lock 是结构保证）+**`stateSeq=被删行最大 seq`**（compact :219 同纪律——禁 0/GREATEST：取号基准错=canvas-doc-insert-ratchet 红线）+upsert 快照{state:全根真空编码, preVacuumSv: 真空前 SV, generation: n+1}+deleteMany 全增量行。**③ 清进程态=共享状态普查表**（v6 扩容：docTruth/docDelta/docStatusRev/docGeneration/quotaFrozenDocs/freezePending/writeFreeze 全连接条目/overPush/truthMeasuredAt/recheckRounds/thawCooldown+**store 记账**〔lastCompactAt 族〕+**SnapshotDocCache.delete(pid)**〔TTL 30s 否则真空后继续供旧代投影〕+**degradedDocs**——附断言测试"真空完成后所有按 pid 的 Map/Set 均无该键"）。**协议收口（v6 报告3 P1-2/P1-3）**：七步包 **try/finally**——中止路径（equivalence-failed/unsupported-root/quiesce-timeout）`vacuuming.delete(pid)` 必须+未提交恢复可写（applyWriteFreeze('quota',false)——否则 503 永久+全员只读比不 vacuum 更糟）+两条中止恢复测试；**quiesce 硬前置**（等卸载+pending 空+spool 未确认帧=**零才能继续**——超时 30s 即中止禁降级；前提注释："**PG 内容完整性=文档已卸载的推论**"——未卸载即读 PG=丢最近 debounce 窗编辑且等价断言恰好通过〔新旧同源〕）；⑤ 等价断言扩全根（readRecords 深比+**根类型集合相等+exec 键集合相等+meta.schemaVersion===2** 三条 O(键数)——U-1/U-2 直接检测）。**触发（v6 双路）**：REST 显式+二次确认（在线态）；**零连接窄版自动**（报告1 P2-3：冻结∧连续≥4 轮 recheck≥soft∧**零连接**∧residue>60%⇒后台 vacuum——无在线用户=无强制刷新伤害+避免画布无限期冻结〔没人来点按钮〕；serving 门挡中途进入=503 可解释重试）。**执行面（G-7）**：真空窗口内 writeExecStatus 被 serving 门 503 挡⇒完成写丢弃由 **intent-reconcile 兜底重放**（判据源=doc exec 投影+intents 既有机制）+窗口 30s 上限进 runbook；真空窗口受理=409 SYNC_PENDING 预期（SV 全变⇒svDominates fail-closed 钱安全〔U-7〕）。liveBytes=doc.share 全根编码（与 truth 同口径）。指标 vacuum_total{result} 六值（+quiesce-timeout）；T11 入口数据源=doc-status quota.residueBytes? | 报告1 P1-1/P1-2/P2-2/3+报告2 G-2/G-3/G-7/G-8+报告3 P0-1/P1-2/P1-3/5.1/5.2 合流 |
| **Q-P（v2 新）配额配置构造注入** | gateway 既有位置参数尾部追加 `quota?: QuotaConfig`（{maxDocBytes,maxTxBytes,msgRate,bytesRate}——默认 env 直读在构造器内一次）；**禁 `export let`+setForTest 模块级测试钩子**（外审 P1-15）；`Number(env)\|\|default` 改 `parsePositiveInt(env, default)`（0/NaN 不静默吞） | 外审 P1-15 |
| **Q-R（v2 新）水位契约废除** | serverWatermark/localBytesSinceWatermark/单调收敛锚/预估偏差登记 §9.17 全部废除——客户端判据④改本地 doc 实测（Q-I）；spec §4.1① 信息源契约段随批勘误（v2.8 标注） | Q-I 的连带清理 |

**§0.2 新增指标全表（store.metrics.ts 单源；spec §10 fenced 同 commit；全部小写）**

| 指标 | 类型/标签 | Task | 语义 |
|---|---|---|---|
| `collab_quota_soft_threshold_total` | Counter, action=enter\|exit | T4 | 冻结/解除（解除=shrink/recalibrate/recheckTimer 滞回） |
| `collab_quota_frame_rejected_total` | Counter, reason=doc-over-quota\|frame-too-large | T4 | beforeSync 4404 升级/1009 帧闸（与认证桶不并轨） |
| `collab_quota_writes_dropped_total` | Counter, reason=quota\|viewer\|draining\|spool | T4 | readOnly 早退吞帧（**v3：早退分支有 .inc 落点+reason 分列**——静默分叉唯一服务端证据） |
| `collab_quota_truth_measured_total` | Counter | T4 | 全量编码触发次数（**P0-1 直接证据**——比值验证） |
| `collab_quota_truth_measure_duration_seconds` | Histogram | T4 | 单次全量编码耗时（**进程预算 duty 验证**——报告2 D） |
| `collab_doc_residue_bytes` | Gauge | **T9a** | truth−liveBytes（**liveBytes=doc.share 全根编码口径**〔v6 U-6 修正后〕；recheck 2 轮时更新——Q-U） |
| `collab_doc_vacuum_total` | Counter, result=ok\|skip-low-residue\|equivalence-failed\|unsupported-root\|error | **T9a** | vacuum 审计（v5：等价断言失败/根类型不支持两档——破坏性操作的可观测中止面） |
| `collab_quota_fastpath_total` | Counter | T4 | 快路径放行次数（measured/(measured+fastpath) 应 >0.99） |
| `collab_hydration_deferred_total` | Counter, **field=structs\|ds**（v6 B8 功能修：T3 .inc({field}) 带标签——表无 labelNames 则 prom-client throw→装载降级路径抛错被 catch 折成 DB_UNAVAILABLE=画布打不开，与 Q-O 目标相反） | T3 | 装载后 pendingStructs **或 pendingDs** 双查分列（因果链丢失可观测——Q-O） |
| `collab_quota_frozen_docs` | Gauge（collect=**quotaFrozenDocs.size**——文档级注册表，与在线无关〔writeFreeze 连接级全员断线会归零〕） | T4 | 冻结面现状 |
| `collab_msg_rate_exceeded_total` | Counter | T6 | msg 桶断连 |
| `collab_bytes_rate_exceeded_total` | Counter | T6 | bytes 桶断连 |
| `collab_awareness_rate_exceeded_total` | Counter | T6 | awareness 独立限速断连（**awareBuckets 与 msg 桶=实例共享+键前缀 aware:${sid} 区分**——census ⑥ 恰四处定义点指 new TokenBucket 实例数） |
| `collab_awareness_stripped_total` | Counter, reason=read-only\|solo\|over-8 | T6/T13 | 剔字段三档分列（readOnly 亦剥离——治理刷屏的带宽面） |
| `collab_awareness_reject_total{reason}` | 既有扩值 frame-too-large | T12 | 4KB 服务端档（label 值域非 schema） |
| `collab_awareness_dropped_total` | Counter | T7 | 背压一级 drop |
| `collab_slow_consumer_disconnect_total` | Counter | T7 | 背压二级 1011 |
| `collab_doc_shrink_total` | Counter, result=ok\|still-over\|noop\|recalibrated | T8 | shrink 审计四档 |
| `collab_doc_shrink_duration_seconds` | Histogram | T8 | 编码时长（**不推 Y0b-5**——8MB 标定的输入） |
| `collab_doc_export_fresh_total` | Counter, result=ok\|in-flight | T9 | 导出审计 |
| `yjs_inbound_frame_bytes` | Histogram | T4 | 入站帧分布（collab 模块内 Histogram 首例——exec.metrics 已有先例） |
| `yjs_outbound_backlog_bytes` | Histogram | T7 | 出站 backlog 1/10 采样 |
| `yjs_loaded_doc_bytes` | Gauge（collect=**Σ(truth+delta)**——口径=最近实测+插值上界，帮助文本注明；GC 回收在测量点回落） | T3 | 容量聚合观测 |
| `awareness_states` / `awareness_bytes` | Gauge（collect） | T13 | E40 三指标之二（第三=dropped） |

**§0.3 env 表（v2：四键全进 env.ts——TX_BYTES 服务端帧闸有真实读点）**

| env | 默认（消费点构造期一次读入） | 消费点 |
|---|---|---|
| `COLLAB_MAX_DOC_BYTES` | 8_388_608 | T4 判据与帧闸/T8 shrink/T6 bytes 桶容量（=capacity 单源）/T9a liveBytes |
| `COLLAB_MAX_TX_BYTES` | 262_144 | T4 Update 帧闸+T10 客户端镜像（shared QUOTA_DEFAULTS 同值单源注释） |
| `COLLAB_MSG_RATE_PER_CONN` | 200/s | T6 msg 桶 refill |
| `COLLAB_BYTES_RATE_PER_CONN` | 2_097_152 | T6 bytes 桶 refill |

（COLLAB_MAX_NODES_PER_TX=shared 常量——纯客户端判据无服务端读点，死键即红纪律维持。）

**容量口径（v6 报告1 P2-4）**：用户可见容量=**maxDocBytes×softEnterRatio≈6.7MB**（客户端判据④拦在软阈——用户永远到不了 8MB 硬限，服务端 over 态只由绕过客户端的连接产生）；§0.3/部署清单/runbook 全部按此口径表述，env 的 8MB 是服务端执法线非产品容量。

---

## Task 0：运行探针九项（只读；**结论必须来自运行打印，禁止源码阅读推断**——粘 commit message）

**Files:** 临时脚本 `apps/api/scripts/tmp-y0b4-probe.mjs`（用毕删除不进 commit）

- [ ] **Step 0: 探针纪律四问模板（固化——对后续 Y1c 各批适用）**

①我读/写的数据格式（wire 字节/库内部结构）→运行打印验证；②我调用的库 API 存在性与参数形状→反射/运行验证；③我依赖的既有代码不变式（"卸载必然发生""compact 必然跑"）→找出反例路径；④新引入的第三方调度原语（requestIdleCallback/定时器）→验证目标环境（后台标签/2 核容器）真的触发。**v1 死于①②、v2 死于③、v3 死于④。**

**⑤机械残留 grep（v5 新增——报告2 F 组/报告3 十条教训：表与码漂移靠人工复读抓不完）**：每 Task 开工前对本 plan 全文跑 `grep -nE '隔离|fillDocShapes|9MB 推导|readOnly 字段|计数≥3|握手信用|readOnly: true|四必选|4410|residue'`（头注释历史沿革行除外）——命中处逐条确认是"v6 修订后表述"还是残留；执行者照抄 sketch 前核对同一机制两侧字段（Q-A payload ↔ T1 断言 ↔ T5 产生 ↔ T10 消费四处逐字一致——v4 的 softLimitBytes 互斥即此类）。

- [ ] **Step 1: 探针①——真实帧字节布局（v1 P0-1 复验）**

裸 ws 连 kit 起的 server（collab-ws-close-probe.spec 形态），auth 通过后由 provider 发一条 awareness（setAwarenessField('cursor')）与一条 sync 写（doc.transact），在**服务端 beforeHandleMessage 临时注册钩子**里打印 `update[0]`、`update[1..8]`（hex）与 `new IncomingMessage(update).readVarString() → readVarUint()` 解析结果。**预期产出**：`update[0]===44`（docName 长度）而非 MessageType；库解析路径得到 type=0(Sync)/1(Awareness)。同时确认 `IncomingMessage`/`MessageType` 从 `@hocuspocus/server` 顶层可 import（index.d.ts:1064 导出列表——运行 import 验证）。

- [ ] **Step 2: 探针②——close code 真实投递路径（v1 P0-2 复验）**

同一裸 ws：服务端钩子内分别执行 (a) `throw {code:4404,reason:'probe'}` (b) `conn.webSocket.close(4404,'probe')`——客户端各观测 `close` 事件的 code/reason。(a) 预期 **code=1006 或 1000**（Connection.close 不关 socket→客户端 eventually 超时/或 CLOSE 报文 code=1000）；(b) 预期 **code=4404 reason='probe'**。另测 (c)：webSocket.close 之后再 throw——确认无递归、close 事件仍 4404。产出=Q-D 拒绝链四步的运行依据。

- [ ] **Step 3: 探针③——粘贴 transact 次数（Q-J 定形）**

web 侧 vitest 或浏览器 console（dev 环境）：复制 100 节点组→粘贴→观测 (a) `undoManager.undoStack.length` (b) doc 'update' 事件次数（含 afterTransaction origin）——判定 appendCopyPlan 是否逐节点 dispatch。产出=T10 形态（天然分块 vs chunkCopyPlan）。

- [ ] **Step 4: 探针④——beforeSync 形态与 SyncStep1 回灌先例**

真连下临时注册 `beforeSync` 钩子打印 `{type, payload.byteLength}`（SyncStep1/Step2/Update 三形态各触发一次——Step1 重连即发、Step2 初次握手全量、Update 增量）+**v6：Step1 payload 语义确认=客户端 stateVector**（`Y.decodeStateVector(payload)` 解出与本端 doc clientID/clock 一致——Q-U SV 重叠检测的唯一前提）；同时验证服务端主动 `connection.send(new OutgoingMessage(addr).createSyncMessage().writeFirstSyncStepFor(document).toUint8Array())` 后客户端回 SyncStep2（Q-C thaw 回灌的机制实证）。

- [ ] **Step 5: 探针⑤——distinct user 判定与 awareness 剔字段回显**

双 token 双用户真连同一 doc：B 发 cursor 帧（服务端 beforeHandleAwareness 改 states 浅拷贝剔 cursor 后放行）——观测 (a) A 收到的帧含 user/presence 无 cursor (b) **B 自身收到回显**（回显在——lastMessageReceived 刷新）(c) 剔字段后对端不闪断。产出=Q-L 原语实证。

- [ ] **Step 6: 探针⑥——卸载取消可达性（A-3 守卫依据）**

读 esm:1160/1383/1572 三处复检谓词+一次真连复现（连接中断在 beforeUnloadDocument 执行期间——构造：钩子内 sleep 期间新连接进入）确认"卸载被取消、doc 存活、loadDocument 不重跑"可达。产出=T3 守卫必要性实证。

- [ ] **Step 7: 探针⑦——8MB doc 编码/应用实测耗时（冷却窗定标——p50/p95 分位而非均值，窗口按 p95 定标）**

node 临时脚本构造 ≈7.9MB doc（T3 不可达性断言同款填充）：`encodeStateAsUpdate` 10 次均值+`applyUpdate` 10 次均值+**冷却窗推算**（编码耗时×最坏频率 <5% 单核 → 窗口下限；外审本机实测 23.3ms/34.4ms——生产 2C 机 ×2-4）。产出=TRUTH_COOLDOWN_MS 取值依据（plan 默认 2s，按实测可下调至 1s/上调）。

- [ ] **Step 8: 探针⑧——丢帧留本地+SyncStep1 回灌全链（Q-C 唯一前提的运行级实证）**

真连 a/b：a 发一帧写（服务端 beforeSync 临时钩子置 connection.readOnly+return 吞帧）→断言 ①客户端 doc 仍含该编辑（本地保留）②服务端主动 `send(createSyncMessage().writeFirstSyncStepFor(document))` → 客户端回 SyncStep2 → ③服务端 doc 最终含该编辑（回灌成功）。**三断言任一失败=Q-C thaw 设计不成立，必须回炉**（外审：这不是源码推断能替代的）。

- [ ] **Step 9: 探针⑨——awareness 全量取数源与冻结连接 thaw 自解**

真连双用户：①`beforeHandleAwareness` 载荷的 `document.awareness.getStates()` 可达性与内容完整性（P1-6 前提——确认拿到文档全量而非本帧）；②冻结期加入的连接（auth 置 readOnly）在 thaw 后客户端只读态是否自解——**v3 组合式 authScope 形态下不自解=红相**（P0-1 运行级证据；v4 conn-status 推送后=绿）。

（v1 探针④【成员面板】已由外审实证删除：ProjectMembersPanel+DELETE 端点存在。）
临时脚本删除；九探针结论粘 T1 首 commit message（`PROBE: ①frame[0]=44/IncomingMessage 可导入 ②close 双路径投递=… ③粘贴=N transact/undo=1 ④beforeSync={type,payload} ⑤剔字段回显在 ⑥卸载取消可达 ⑦编码=Xms/apply=Yms/冷却窗=Zs ⑧丢帧留本地+回灌=成功`）。

---

## Task 1：shared 契约地基

**Files:**
- Modify: `packages/shared/src/constants/collab-close-code.ts` + `collab-close-code.test.ts`
- Create: `packages/shared/src/constants/collab-quota.ts` + `collab-quota.test.ts`
- Create: `packages/shared/src/utils/utf8-bytes.ts`（TextEncoder 单源+test）

- [ ] **Step 1: 写失败测试（close-code 三码+terminal 原因常量）**

```ts
// collab-close-code.test.ts 追加：
it('四码三常量：DOC_OVER_QUOTA=4404/GENERATION_SUPERSEDED=4410（v6 启用——spec §3.5 预留提前消费）均 terminal；RATE_LIMITED_CLOSE=1008/SLOW_CONSUMER=1011 且 backoff；DOC_VACUUMING_TERMINAL_REASON/DOC_GENERATION_STALE_TERMINAL_REASON 常量单源（T5 close 映射/T11 终态档/T9a 检测点共用——字段一致矩阵）', () => {
  expect(resolveCloseAction(4410, DOC_VACUUMING_TERMINAL_REASON).kind).toBe('terminal');
  expect(resolveCloseAction(4410, DOC_GENERATION_STALE_TERMINAL_REASON).kind).toBe('terminal');
  expect(CollabCloseCode.DOC_OVER_QUOTA).toBe(4404);
  expect(resolveCloseAction(4404, DOC_OVER_QUOTA_TERMINAL_REASON).kind).toBe('terminal');
  expect(CollabCloseCode.RATE_LIMITED_CLOSE).toBe(1008);
  expect(resolveCloseAction(1008, 'msg-rate-exceeded').kind).toBe('backoff');
  expect(CollabCloseCode.SLOW_CONSUMER).toBe(1011);
  expect(resolveCloseAction(1011, 'slow-consumer').kind).toBe('backoff');
});
it('库抹码形态分型：(1000, doc-over-quota) 不得落 normal——reason 双键兜底', () => {
  // 外审 P0-2 尾巴：旧路径/竞态下客户端可能观测 (1000,'doc-over-quota')——reason 匹配
  // DOC_OVER_QUOTA_TERMINAL_REASON 时必须落 terminal（禁字面量 reason 散落——常量单源）
  expect(resolveCloseAction(1000, DOC_OVER_QUOTA_TERMINAL_REASON).kind).toBe('terminal');
});
```

- [ ] **Step 2: 跑红→实现→绿→commit**

collab-close-code.ts：`DOC_OVER_QUOTA: 4404 / RATE_LIMITED_CLOSE: 1008 / SLOW_CONSUMER: 1011` 三键+`DOC_OVER_QUOTA_TERMINAL_REASON = 'doc-over-quota'`（MESSAGE_TOO_BIG_TERMINAL_REASON :42 同款）；resolveCloseAction：4404→terminal、1000+quota reason→terminal（reason 双键兜底分支）、1008/1011 显式 case 落 backoff（注释"**码只能经 webSocket.close 抵达**——P7；throw 的 code 被 Connection.close 丢弃"防 P8 误读回潮）。
Commit: `feat(y0b-4): T1 close code 四码（+4410）+三 terminal 常量+库抹码兜底（PROBE 九项结论见上）`

- [ ] **Step 3: 写失败测试（QUOTA_DEFAULTS+doc-status rev 快照+utf8Bytes）→实现→绿→commit**

```ts
// collab-quota.test.ts：
it('QUOTA_DEFAULTS 默认锁定（8MB/256KB/2000/0.8 进 0.6 出/4KB）', () => {
  expect(QUOTA_DEFAULTS).toMatchObject({ maxDocBytes: 8_388_608, maxTxBytes: 262_144,
    maxKeyBytes: 262_144, maxNodesPerTx: 2000, softEnterRatio: 0.8, softExitRatio: 0.6,
    awarenessLimitBytes: 4096 });
});
it('CollabDocStatusPayload 恰好 {type,rev,writeFrozen,quota{state,bytes,limit,maxTxBytes,softLimitBytes}}——无 readOnly/无 deletedIds（v4 字段集合断言防复活）', () => {
  const ok = { type: 'doc-status', rev: 3, writeFrozen: false,
    quota: { state: 'over', bytes: 9, limit: 10, maxTxBytes: 262144, softLimitBytes: 8388608 } };
  expect(isCollabDocStatusPayload(ok)).toBe(true);
  expect(Object.keys(ok.quota)).toEqual(['state','bytes','limit','maxTxBytes','softLimitBytes']);
  // v6 报告3 P0-2A：删 readOnly 前向兼容 true 断言——"额外字段不破坏"是通用校验哲学，
  // 写进这条契约测试会诱导后来者保留 readOnly（Q-A 要消灭的 per-conn 量走 per-doc 广播形态）
  expect(isCollabDocStatusPayload({ type: 'doc-status', rev: 3, writeFrozen: false,
    quota: { state: 'ok', bytes: 1, limit: 10 } })).toBe(false);                  // 缺 maxTxBytes=拒
});
it('rev 从 1 起（装载播种 1——初值 0 会被客户端 rev<=last 守卫丢掉首快照=limit 来源恒丢，报告2 F）', () => {});
it('CollabConnStatusPayload {type:conn-status,readOnly}（每连接推送——Q-A v4）', () => {});
it('doc-status 顶层可选 generation?:number+quota 可选 residueBytes?:number（vacuum 代际+T11 入口数据源——Q-U v6；缺省=valid；T5 产生/T9a 递增/T11 消费四处对齐——字段一致矩阵）', () => {});
// utf8-bytes.test.ts：
it('中文 3× 量纲修正：utf8Bytes("中")===3 而 "中".length===1', () => {
  expect(utf8Bytes('中')).toBe(3); expect('中'.length).toBe(1);
});
```

实现 `collab-quota.ts`（QUOTA_DEFAULTS 七值+CollabDocStatusPayload：**顶层三必选 type/rev/writeFrozen+可选 generation/residueBytes?+quota 五键**——v6 报告3 P0-2B：v5 实现说明『四必选』与同 Step 五键断言互斥+isCollabDocStatusPayload 逐字段校验〔quota 五键含 residueBytes 可选〕）与 `utf8-bytes.ts`（`new TextEncoder().encode(s).length`）。**注意 SOFT_EXIT_RATIO=0.6 新增**（滞回下阈）。
Run: `pnpm --filter @flowweb/shared test` → 绿
Commit: `feat(y0b-4): T1 quota 常量（0.8/0.6 滞回）+doc-status rev 快照类型+utf8Bytes 单源`

---

## Task 2：env 四键+构造注入

**Files:**
- Modify: `apps/api/src/config/env.ts`（四键，两空格缩进）
- Modify: `apps/api/src/config/collab-env-single-source.spec.ts`
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（构造器尾部 `quota?: Partial<QuotaConfig>` 参数+parsePositiveInt）
- Modify: spec §10 fenced+§7.1

- [ ] **Step 1: 写失败测试（schema 四键+构造注入形态）**

```ts
// collab-env-single-source.spec.ts 追加：
it('Y0b-4 四键进 schema：MAX_DOC_BYTES/MAX_TX_BYTES/MSG_RATE_PER_CONN/BYTES_RATE_PER_CONN', () => {
  for (const k of ['COLLAB_MAX_DOC_BYTES', 'COLLAB_MAX_TX_BYTES', 'COLLAB_MSG_RATE_PER_CONN', 'COLLAB_BYTES_RATE_PER_CONN'])
    expect(envSchema.shape).toHaveProperty(k);
});
// gateway 侧（新 collab-quota-config.spec.ts 或并入 options.spec）：
it('quota 构造注入覆盖 env 默认；0/NaN 不静默吞（parsePositiveInt）', () => {
  const g = buildGateway({ quota: { maxDocBytes: 1024 } });
  expect(g['quota'].maxDocBytes).toBe(1024);
  expect(parsePositiveInt('0', 99)).toBe(99);   // 0 拒
  expect(parsePositiveInt('abc', 99)).toBe(99); // NaN 拒
});
```

- [ ] **Step 2: 跑红→实现→绿→commit**

env.ts 四键（zod 形态同邻键无 default）；gateway 构造器：`private readonly quota: QuotaConfig`（=Object.assign(env 读入默认, quota 覆盖)——**Q-P：禁模块级 let**）；parsePositiveInt 小工具（gateway 内或 shared）。读点=T3/T4/T6/T8 消费（构造期一次）。spec §10 fenced 四行+§7.1 段尾 v2.8 修订标注（TX_BYTES 服务端帧闸有读点进 env）。
Run: `pnpm --filter @flowweb/api test -- --run collab-env-single-source` → 绿
Commit: `feat(y0b-4): T2 env 四键+quota 构造注入（parsePositiveInt——禁模块级 let）`

---

## Task 3：docTruth 真值单变量+装载双断言可观测

**Files:**
- Modify: `apps/api/src/modules/collab/canvas-doc-update.repository.ts`（compact 上报真值——装载侧零改动【不拒行 Q-O】）
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（docTruth/docDelta Map+装载后实测+update 监听 delta+卸载守卫清理+spool merge 上限）
- Modify: `apps/api/src/modules/collab/store.metrics.ts`（collab_hydration_deferred_total/yjs_loaded_doc_bytes）
- Test: `apps/api/src/modules/collab/collab-quota-truth.spec.ts`（新——直构）

- [ ] **Step 1: 写失败测试（真红门②④+pendingStructs+守卫清理）**

```ts
// 头注：Y0b-4 T3——Q-B cheap 播种+Q-O 不拒行+pendingStructs 断言；真红门②=累积漂移不误冻、④=病态行不锁死。
describe('docTruth（Q-B v3）', () => {
  it('cheap 上界播种：|state|+Σ|updates|+Σspool <soft 时直接当 truth（跳过编码——spy encode 调用数=0）', async () => {});
  it('cheap ≥soft 时付费实测（apply 即 GC——truth < 求和值）', async () => { /* 写→删对：truth=编码值非求和 */ });
  it('update 监听累加 docDelta（全路径触发器）', () => {});
  it('compact 校准仅 pending 空时生效（newSnapshot=持久化真值口径——非空跳过下次）', async () => {});
  it('真红门②：真实 200KB+累计 update 10MB——truth≈200KB 不冻结', async () => {});
  it('真红门④改向（报告3："照读不拒"改前即绿非红门——红点=断言缺失）：人工构造缺依赖行→装载后 pendingStructs 非空⇒现状无断言无计数（deferred 恒 0 静默=红相）→绿=deferred{structs}+1+degraded 标记+REST shrink 可达', async () => {});
  it('pendingStructs 断言：跳行场景（人工构造依赖缺失）→ deferred 计数+degraded 标记（降级可观测非沉默）', async () => {});
  it('卸载守卫：库取消卸载时条目保留（I-1 同款）', async () => {});
  it('yjs_loaded_doc_bytes=Σ(truth+delta)', () => {});
});
```

- [ ] **Step 2: 跑红（红相：现状单行>4MB 仅 WARN 且无 truth/无断言）→ 实现 → 绿 → commit**

repository：单行>4MB WARN 保留+**读不拒**；compact 成功路径上报 `onCompactTruth(pid, newSnapshot.length)`（仅 gateway 判 pending 空才采纳）。gateway：

```ts
private readonly docTruth = new Map<string, number>();
private readonly docDelta = new Map<string, number>();
private readonly truthMeasuredAt = new Map<string, number>();
// loadDocument：state+updates+spool 帧【全部 apply 之后】（:692 spool 在装载窗内——测量点必须其后）：
const cheap = (state?.length ?? 0) + updates.reduce((n, u) => n + u.length, 0) + spoolBytes;
const soft = Math.floor(this.quota.maxDocBytes * QUOTA_DEFAULTS.softEnterRatio);
this.docTruth.set(projectId, cheap < soft ? cheap : Y.encodeStateAsUpdate(document).byteLength);  // 白名单点①（cheap 跳过编码）
this.docDelta.set(projectId, 0); this.truthMeasuredAt.set(projectId, Date.now());
// pendingStructs 断言（Q-O）：
if (document.store.pendingStructs !== null || document.store.pendingDs !== null) {   // 双查（Q-O v5——只含删除的跳行仅触发 pendingDs）
  collabHydrationDeferredTotal.inc({ field: document.store.pendingStructs !== null ? 'structs' : 'ds' });
  this.logger.error(`hydration deferred (${document.store.pendingStructs !== null ? 'structs' : 'ds'}): ${projectId}——内容缺失可观测`);
  this.degradedDocs.add(projectId);                                                              // 快照/健康面可见
}
document.on('update', (u: Uint8Array) => { /* delta 触发器累加（未装载/已清理 return） */ });
// unloadDocument finally（I-1 守卫）+handleProjectsGone+onDisconnect（writeFreeze conn 条目）清理
// spool merge 批上限（:849）：切批 ≤1MB——超限行结构性不可产生
```

store.metrics：collabHydrationDeferredTotal+yjsLoadedDocBytes（collect=Σ(truth+delta)）。spec §10 fenced 同 commit。
Commit: `feat(y0b-4): T3 cheap 播种+pendingStructs 断言+不拒行+卸载守卫（真红门②④红→绿）`

---

## Task 4：beforeSync 判据+冻结层单源+4404 可达拒绝链

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（beforeSync 注册+**applyWriteFreeze 出口**+writeFreeze 六写点改道+拒绝链+buildDocStatus+recheckRounds/thawCooldown）
- Modify: `apps/api/src/modules/collab/store.metrics.ts`（soft_threshold/frame_rejected/writes_dropped/frozen_docs+yjs_inbound_frame_bytes）
- Test: `apps/api/src/modules/collab/collab-quota-gate.spec.ts`（新——真连 kit，4a 真红门①③载体）

- [ ] **Step 1: 写失败测试（真红门①③+编码成本⑤⑥+冷却+over 短路）**

```ts
// 头注：Y0b-4 T4 真红门——①持续强推才 4404（首触=冻结+快照可解释）；③回灌无损；⑤⑥编码成本（P0-1 红门）。
describe('guardSyncFrame 分层判据（Q-B v3/Q-C/Q-D/Q-S）', () => {
  it('真红门①a 首触硬限：冻结+放行本帧（客户端编辑不丢）+快照 over 先到——【非断连】', async () => {
    // quota 注入小值；provider 写穿 soft→实测>MAX：断言 broadcast over stateless 到达 + 该帧内容最终在 doc（setImmediate 冻结挡后续）
    // + 连接仍存活（分层——持续强推才 4404）
  });
  it('真红门①b 持续强推：冻结后 readOnly 分支内窗口 20 帧或 512KB 且跨 10s → close 4404（裸 ws 观测 code+reason）+writes_dropped{quota}+20；反例：同 tick 3 帧/未跨 10s 不升级（分块粘贴+人类反应不误杀——Q-D v5）', async () => {});
  it('帧闸 1009：Update>2×maxTxBytes → close 1009（2× 余量——Q-E v5：〔maxTxBytes,2×〕区间放行进配额判据，估算误差退化为软冻结非终态）；Step2>maxDocBytes 同闸', async () => {});
  it('闸先于 readOnly 早退：VIEWER 连接发巨帧同样过闸（早退仅跳过配额判定不跳帧闸）', async () => {});
  it('编码成本⑤：冷却窗内连续 50 帧（delta 触阈反复）——truth_measured 增量===1+fastpath===49', async () => {});
  it('编码成本⑥：冻结态 50 帧——truth_measured 增量===0（over 短路零编码拒绝）', async () => {});
  it('误冻结归零：账面触阈（freezePending 排程）→确认实测<soft → truth 校准+broadcast(ok)+放行（**freezePending 态帧始终走③④判据——G-1 红门：确认窗内超限帧照常被拒非放行**）', async () => {});
  it('overPush idle-reset：冻结态帧间隔>5s 的 20 帧（休眠恢复/慢速持续形态）→不升级 4404；间隔<5s 的 20 帧且跨 10s →升级（v6 报告1 P2-2）', async () => {});
  it('真红门③：软阈冻结→setImmediate 冻结（触发帧放行不丢）→冻结期本地写（库吞+计数）→thaw SyncStep1→回灌 SyncStep2→对端可见（静默分叉=红相）', async () => {});
  it('writeFreeze 单源：VIEWER 冻结期加入→thaw 后仍只读（viewer 原因保留）+解冻广播无 readOnly 字段（VIEWER 不误解除——B-1 红相）', async () => {});
  it('authenticated 复位 rev：doc 卸载重连后 rev 从 1 重来→客户端正常消费（不因旧 rev=5 弃新快照）', async () => {});
});
```

- [ ] **Step 2: 跑红（红相=现状帧已 apply+无判据）→ 实现 → 绿 → commit**

```ts
// hooks 追加：
beforeSync: (p) => this.guardSyncFrame(p),
private async guardSyncFrame({ type, payload, document, connection }: BeforeSyncPayload): Promise<void> {
  const pid = document.name.replace(/^project:/, '');
  if (type === messageYjsSyncStep1) return;                       // 零成长（库常量 import）
  const bytes = payload.byteLength;
  // ⓪ 帧闸（先于 readOnly——VIEWER 巨帧也过闸）：1009 terminal（Q-E v3）
  if (type === messageYjsUpdate && bytes > 2 * this.quota.maxTxBytes      // 2× 余量（Q-E v5）——客户端 JSON 估算 vs Yjs item 头开销
    || type === messageYjsSyncStep2 && bytes > this.quota.maxDocBytes) {
    collabQuotaFrameRejectedTotal.inc({ reason: 'frame-too-large' });
    this.hardClose(connection, CollabCloseCode.LIB_MESSAGE_TOO_BIG, 'frame-too-large');
    throw Object.assign(new Error('frame too large'), { code: CollabCloseCode.LIB_MESSAGE_TOO_BIG, reason: 'frame-too-large' });
  }
  yjsInboundFrameBytes.observe(bytes);
  // ① readOnly 早退（计数+**per-conn 持续强推升级判定**——冻结落地后帧进此〔报告2 B：计数在①不在②〕）
  if (connection?.readOnly) {
    const reasons = this.freezeReasons(connection);
    collabQuotaWritesDroppedTotal.inc({ reason: reasons.has('quota') ? 'quota' : reasons.has('draining') ? 'draining' : reasons.has('spool') ? 'spool' : 'viewer' });
    if (reasons.has('quota')) {                                     // P0-2：per-conn 时间字节双窗
      const sid = connection.socketId; const st = (this.overPush.get(sid) ?? { count: 0, bytes: 0, firstAt: Date.now(), lastAt: Date.now() });
      if (Date.now() - st.lastAt > 5_000) { st.count = 0; st.bytes = 0; st.firstAt = Date.now(); }   // v6 idle-reset（报告1 P2-2：休眠恢复/慢速持续者不计入持续）
      st.count++; st.bytes += bytes; st.lastAt = Date.now();
      if ((st.count >= 20 || st.bytes >= 2 * this.quota.maxTxBytes) && Date.now() - st.firstAt >= 10_000) {  // v5：5s→10s（横幅慢到达+用户反应余量——Q-D）
        collabQuotaFrameRejectedTotal.inc({ reason: 'doc-over-quota' });
        try { connection.sendStateless?.(this.buildDocStatus(pid)); } catch { /* 先通告尽力 */ }
        this.hardClose(connection, CollabCloseCode.DOC_OVER_QUOTA, DOC_OVER_QUOTA_TERMINAL_REASON);
        throw Object.assign(new Error('doc over quota'), { code: CollabCloseCode.DOC_OVER_QUOTA, reason: DOC_OVER_QUOTA_TERMINAL_REASON });
      }   // 复位只在 thawQuota（freeze 重入不清零——报告3 P0-D）；交库拒（SyncStatus(false)）——内容靠 thaw 回灌
    }
    return;
  }
  // ② over 短路（冻结面零编码——延后窗内放行不计数〔readOnly 未置、库照常 apply——报告2 B〕；冻结落地后帧进①分支）
  if (this.quotaFrozenDocs.has(pid) && !connection?.readOnly) return;   // FREEZING 窗=one-event-loop-turn（setImmediate 前——v6 G-1：quotaFrozenDocs 与 readOnly 同一 setImmediate 落地，此窗边界=事件循环轮次非确认定时器；freezePending 态不进本判据)
  // ③ 快路径 O(1)——hook 只读 delta 不回写（update 监听唯一写者——报告2 A 消双计）
  const truth = this.docTruth.get(pid) ?? 0; const delta = this.docDelta.get(pid) ?? 0;
  const soft = Math.floor(this.quota.maxDocBytes * QUOTA_DEFAULTS.softEnterRatio);
  if (truth + delta + bytes <= soft) { collabQuotaFastpathTotal.inc(); return; }
  // ④ 账面触阈：冷却窗内不测量（上界决策）；窗外实测（白名单点②——try/catch+pendingStructs fail-open）
  const cooled = Date.now() - (this.truthMeasuredAt.get(pid) ?? 0) < TRUTH_COOLDOWN_MS;   // T0 探针⑦按 p95 定标
  if (cooled) {
    if (truth + delta + bytes > this.quota.maxDocBytes) this.freezePending(pid, document);   // v6 G-1 两态分离：freezePending 只广播 over+挂确认定时器——帧继续走③④判据（禁 v5 的 quotaFrozenDocs.add 立即+readOnly 延后=判据②确认窗放行一切；确认实测豁免进程预算，被挡即 fail-closed 置 frozen）
    else collabQuotaFastpathTotal.inc();
    return;                                                        // delta 不写——update 监听会计入放行帧
  }
  if (!this.truthBudget.tryTake()) {                                // 进程级测量预算（≤1 次/200ms+duty≤5%——报告2 D）；超预算退上界决策（同 cooled 分支——freezePending 非 freezeQuota）
    if (truth + delta + bytes > this.quota.maxDocBytes) this.freezePending(pid, document);
    return;
  }
  collabQuotaTruthMeasuredTotal.inc(); const t0 = Date.now();
  const measured = this.measureTruth(pid, document);               // encodeStateAsUpdate（pendingStructs/pendingDs 非空→沿用旧 truth）
  collabQuotaTruthMeasureDuration.observe((Date.now() - t0) / 1000);
  this.docTruth.set(pid, measured); this.docDelta.set(pid, 0); this.truthMeasuredAt.set(pid, Date.now());
  if (measured + bytes > this.quota.maxDocBytes) { this.freezeQuota(pid, document); return; }   // 硬限首触=冻结+放行本帧（Q-S——禁静默丢合法帧）
  if (measured + bytes >= soft) this.freezeQuota(pid, document);
}
private hardClose(conn: any, code: number, reason: string): void {
  // code 权威投递路径=webSocket.close（throw.code 仅兜底——P7/P1-3 注释钉死）
  try { conn.webSocket?.close(code, reason); collabWsCloseTotal.inc({ code: String(code), reason }); } catch { /* 已断 */ }
}
// freezePending(pid,doc)〔v6 G-1 新增独立函数——deferredConfirm 专用〕：broadcastDocStatus(over,rev++) →
//   挂 cooldown 到期即测定时器（单 doc 去重；**确认实测豁免 truthBudget**——被挡即 fail-closed 置 frozen；
//   实测<soft ⇒ 立即 broadcast(ok) 纠错毫秒级〔报告2 C〕；≥soft/超限 ⇒ 转 freezeQuota 正式冻结）——**禁碰 quotaFrozenDocs/readOnly**
// freezeQuota（Q-C v3；v6 两态）：broadcastDocStatus(over,rev++) → setImmediate(() => { applyWriteFreeze(conn,'quota',true)
//   （延后一帧——触发帧放行）+ quotaFrozenDocs.add(pid) }) → soft_threshold{enter}——**与 readOnly 同一 setImmediate**
// thawQuota：移除 'quota'+quotaFrozenDocs.delete → send(writeFirstSyncStepFor) → 重测 ≥soft 且非冷却窗再冻结 → broadcast(ok,rev++)
//   → thaw 后 30s 复冻冷却（Q-C v5——贴阈抖动防 UI 闪断；实测>MAX 硬限不受冷却豁免）
// frozenRecheckTimer（Q-C v3；v5 补脚手架）：30s 独立 timer 仅遍历 quotaFrozenDocs → measureTruth →
//   <0.6×MAX → thawQuota+recheckRounds.delete；≥soft → recheckRounds.set(pid,(get??0)+1)——连续 2 轮 ⇒
//   全根 liveBytes 评估（residue 指标更新+T11 亮出「重建画布历史」入口——检测自动化动作人工化，Q-U v5）
/** writeFreeze 六写点唯一出口（Q-A v5——报告3 P0-2 补齐骨架；"六点=四点内联+两点 connected 补推"）：
 *  四点内联=drain begin/end、sweep 升/降、quota freeze/thaw；两点 connected 补推=viewer/spool
 *  （auth 期在 connectionConfig 置位时 Connection 未创建——esm:1054 库在 onAuthenticate 返回后 new——
 *  sendStateless 结构性不可达，这两点的 conn-status 初值由 connected 钩子补推，T5 落点）。
 *  禁绕过本函数直写 conn.readOnly（census 追加：readOnly 直写点清零——生产仅 applyWriteFreeze/connected 补推两处）。 */
private applyWriteFreeze(conn: CollabConnection, reason: FreezeReason, on: boolean): void {
  const pid = parseProjectId(conn.document.name);
  const e = this.writeFreeze.get(conn) ?? { pid, reasons: new Set<FreezeReason>() };
  if (on) e.reasons.add(reason); else e.reasons.delete(reason);
  if (e.reasons.size === 0) this.writeFreeze.delete(conn); else this.writeFreeze.set(conn, e);
  conn.readOnly = e.reasons.size > 0;                    // 库读该属性拦 SyncStep2/Update（readOnly=原因集非空——单一真值）
  try { conn.sendStateless?.(JSON.stringify({ type: 'conn-status', readOnly: conn.readOnly })); }
  catch { /* 已断——fail-open */ }
}
// connected 钩子新增体（v6 报告3 P1-1——:229 现形态只拿 socketId 无 Connection，须反查登记）：
connected: ({ socketId }) => {
  this.connEstablishedAt.set(socketId, Date.now());
  for (const doc of this.hocuspocus.documents.values())          // 反查 matching Connection（每连接一次 O(docs)——可接受）
    for (const c of doc.connections.keys())
      if (c.socketId === socketId) {
        // auth 期 config.readOnly 已置（库级首帧拦截保留——库时序 connected 在首批消息后〔P5〕，不置位开首帧窗口）；
        // connected 把 viewer/spool 意图登记进 writeFreeze 单源+补推 conn-status/doc-status 双补——spool 恢复时有对象可解
        if (c.readOnly && !this.writeFreeze.has(c)) this.applyWriteFreeze(c, this.authFreezeIntentOf(c) /* 'viewer'|'spool'——auth 期存 connection.context */, true);
        try { c.sendStateless?.(JSON.stringify(this.buildDocStatus(parseProjectId(doc.name)))); } catch { /* fail-open */ }
        return Promise.resolve();
      }
  return Promise.resolve();
},
// 六写点改道：authenticateInner viewer(:609)/spool(:586) 保持 connectionConfig 置位（auth 期）+context 存意图+connected 登记；
//   beginDraining(:1037)+恢复(:1020-1022)/recheckConnection 升(:1641)降(:1632)/freezeQuota/thawQuota → applyWriteFreeze
// onDisconnect：writeFreeze.delete(conn)（值含 pid——O(1) 无反查）
```

（store.metrics：soft_threshold/frame_rejected/writes_dropped{reason}/truth_measured/fastpath/frozen_docs+直方图。真红门①③⑤⑥红绿两相粘 commit。）
Run: `pnpm --filter @flowweb/api test -- --run collab-quota-gate` → 绿
Commit: `feat(y0b-4): T4 分层判据（冷却+over 短路+4404 升级+setImmediate 冻结）——真红门①③⑤⑥红→绿`

---

## Task 5：幂等快照 rev——connected 即时补推+客户端 reducer 单源

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（buildDocStatus rev 计数+connected 钩子补推+beginDraining 并轨）
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts`（stateless reducer+rev 守卫+readOnly 单源+undo 代际清理）
- Modify: `apps/web/src/stores/canvasStore.ts`（quotaOver/quotaLimitBytes/lastDocStatusRev 字段——**水位双字段废除**）
- Test: `collab-quota-gate.spec.ts` 追加（服务端）+`apps/web/src/stores/canvasCollabRuntime.quota.spec.ts`（新）

- [ ] **Step 1: 写失败测试（rev 幂等/补推时序/并轨/客户端单源）**

```ts
// 服务端：
it('connected 即时补推：连接建立 <500ms 收到 doc-status（探针②竞态废除）', async () => {});
it('beginDraining 改发 doc-status（writeFrozen:true+rev++）——type:write-frozen 退役（census ⑧）', async () => {});
it('快照无 readOnly 字段+quota 五键含 maxTxBytes+softLimitBytes（Q-A v5——报告3 P0-3：与 T1 Object.keys 断言逐字一致）+顶层可选 generation', async () => {});
// web：
it('reducer：rev>lastDocStatusRev 才消费——乱序/重复/迟到旧快照全免疫（电平非事件）', () => {});
it('authenticated 复位 lastDocStatusRev=0（doc 卸载重连 rev 从 1 重来——防旧值弃新快照，Q-A v3）', () => {});
it('collabReadOnly=connReadOnly || quotaOver || writeFrozen（v5——conn-status 单源；反例断言：authScope 不参与判定〔报告3 一致性 6：v3 测试名与 v4 实现矛盾〕；解冻快照不会误解除 VIEWER 只读，B-1 红相=v2 单源形态）', () => {});
it('connReadOnly 初值=authenticated scope（首推前 VIEWER 不 fail-open——报告1 P1-4）+connected 双补推（doc-status+conn-status <500ms 各一）', () => {});
it('writeFrozen 只置位不复位（复位=重连 authenticated 链路）', () => {});
it('quota.bytes 到达 → localDocBytes 覆盖+delta 清零（Q-I 校准点）', () => {});
```

- [ ] **Step 2: 跑红→实现→绿→commit**

gateway：`docStatusRev: Map<pid,number>`（**装载播种 1**——初值 0 会被客户端 rev<=last 守卫丢掉首快照〔报告2 F〕；仅状态翻转时 rev++——补推用当前 rev 不自增）+`buildDocStatus(pid)`：`{type:'doc-status', rev, writeFrozen: this.quotaFrozenDocs.has(pid)||drain 中, generation: this.docGeneration.get(pid)?, quota: { state, bytes: truth+delta, limit: maxDocBytes, maxTxBytes, softLimitBytes, residueBytes: this.docResidue.get(pid)? }}`——**quota 五键+可选 residueBytes（v6 G-5：T11 重建入口数据源）与 T1 断言逐字一致（报告3 P0-3）**+connected 即时补推（doc-status+**conn-status 初值双补**——viewer/spool auth 期两点在此闭环，Q-A v5）+beginDraining 改发。web runtime（:892-913 族）：

```ts
p.on('authenticated', ({ scope }: any) => {
  connScope = scope;                                                  // 诊断信息（仅日志/diag）
  connReadOnly = scope !== 'read-write';                              // v5 初值（Q-A：首推前不 fail-open——conn-status 到达后覆盖）
  useCanvasStore.setState((s) => ({
    collabReadOnly: connReadOnly || s.quotaOver || false,             // 组合式（初值=scope；单源=conn-status）
    writeFrozen: false, lastDocStatusRev: 0,                          // rev 复位（生命周期绑定）
  }));
  silentRenewUsed = false; recomputeConnStatus();
});
p.on('stateless', ({ payload }: any) => {
  try {
    const msg = JSON.parse(payload);
    if (!isCollabDocStatusPayload(msg)) return;
    const st = useCanvasStore.getState();
    if (msg.rev <= st.lastDocStatusRev) return;                       // rev 单调守卫
    const quotaOver = msg.quota.state === 'over';
    useCanvasStore.setState({
      lastDocStatusRev: msg.rev,
      quotaOver, quotaSoftLimitBytes: msg.quota.softLimitBytes,       // G：客户端 gate 对齐服务端冻结线
      quotaResidueBytes: msg.quota.residueBytes ?? undefined,          // v6 G-5：T11「重建画布历史」入口亮出判据（residue>50% 且冻结态）
      quotaLimitBytes: msg.quota.limit, quotaTxBytes: msg.quota.maxTxBytes,
      localDocBytes: msg.quota.bytes, localDelta: 0,                  // 权威覆盖（Q-I）
      collabReadOnly: connReadOnly || quotaOver || msg.writeFrozen,   // v5：conn-status 连接级单源（P0-1）；authScope 仅 authenticated 初值
      ...(msg.writeFrozen ? { writeFrozen: true } : {}),              // 只置位
      ...(msg.generation !== undefined && msg.generation !== lastGeneration
        ? { pendingGenerationReload: msg.generation } : {}),          // vacuum 代际跳变→T11 消费（undoManager.clear()+reload）
    });
    if (quotaOver) recordCollabDiag('write_reject', { reason: 'quota-soft' });
// 另挂 stateless 分支：{type:'conn-status'} → useCanvasStore.setState({ connReadOnly: msg.readOnly })——单连接内有序无乱序
  } catch { /* 坏 JSON */ }
});
// initCollab 复位集：lastDocStatusRev:0/quotaOver:false/quotaLimitBytes:0/quotaTxBytes:0/quotaSoftLimitBytes:0/localDocBytes:0/localDelta:0/connReadOnly:false/pendingGenerationReload:0
```

Run（api+web）→ 绿。
Commit: `feat(y0b-4): T5 rev 生命周期绑定+conn-status 单源 readOnly（scope=初值）+quota 五键下行+connected 双补推`

---

## Task 6：TokenBucket 双桶速率闸+awareness 剔字段+独立限速

**Files:**
- Modify: `apps/api/src/modules/collab/token-bucket.ts`（delete(key)+spec 扩）
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（beforeHandleMessage 帧计数桶+guardAwareness 剔字段+onDisconnect 清理）
- Modify: `store.metrics.ts`（四计数）
- Test: `apps/api/src/modules/collab/collab-rate-gate.spec.ts`（新——真连+裸帧装置）

- [ ] **Step 1: 写失败测试（按量扣减+桶容量对齐不变量+红门⑧离线合并+剔字段保回显+awareness 帧闸）**

```ts
describe('速率闸（Q-E v3）+awareness 治理（Q-L）', () => {
  it('TokenBucket.consume(key,cost) 按量扣减：容量 600 桶 consume 350×2 → 第二次 false；失败保留积分（cost 同构）', () => {});
  it('桶容量≥最大合法帧不变量：bytesBuckets.capacity===maxDocBytes（≥Step2 帧闸上界）+cost>capacity 结构性恒 false 防复发断言（consume 抛错或计数——census⑨ 防不到的形态，报告1 P0-2）', () => {});
  it('**红门⑧ 离线合并可上传：8MB SyncStep2 回灌第一次通过（桶容量吸收）→桶排空→第二次 8MB 在 refill 积满后也通过**（v4 信用+1MB 桶形态第二次结构性永拒=红相留档）', async () => {});
  it('bytes 桶：持续 2MB/s 滴灌 → close 1008 bytes-rate-exceeded（P0-2 红相=v2 consume 无 cost=字节桶空转 800 万帧）', async () => {});
  it('msg 桶超限：>400 帧/2s → close 1008', async () => {});
  it('readOnly 剔字段：VIEWER 发 cursor 帧——对端收 user/presence 无 cursor+**发送者收回显**（保活）+stripped{read-only}+1', async () => {});
  it('回归锚：VIEWER 单连 90s 无 4408（并入 collab-idle-anchor.spec 同一次等待）', async () => {}, 120_000);
  it('awareness 独立限速 >30 帧/s → 1008（共享桶+键前缀 aware:${sid}）；onDisconnect 全桶清理（Map 泄漏防——信用已删无第三 Map）', async () => {});
  it('**awareness 入站帧闸（报告1 P1-1 改判采纳）**：伪造 1MB awareness 帧 → 1009（beforeHandleMessage 判型——库 IncomingMessage 解析非字节猜型；30/s×16MB=480MB/s 解码路径封死）；<64KB 正常帧通过', async () => {});
});
```

- [ ] **Step 2: 跑红（红相=①consume 无 cost 字节桶空转 ②红门⑧ 第二次 8MB 永拒）→ 实现 → 绿 → commit**

```ts
// token-bucket.ts：consume(key, cost=1) 按量扣减（默认 1=既有两调用零改动；tokens<cost 分支保留积分同构）+delete(key)——spec 两用例
// gateway：
private readonly msgBuckets = new TokenBucket({ capacity: 400, refillPerMin: this.quota.msgRate * 60 });
private readonly bytesBuckets = new TokenBucket({ capacity: this.quota.maxDocBytes, refillPerMin: this.quota.bytesRate * 60 });
// v5：capacity=maxDocBytes（Q-E——"桶容量≥最大合法帧"不变量：consume :29 Math.min(capacity) 封顶 ⇒ cost>capacity 恒 false，
//     1MB 容量下 >1MB 合法合并帧结构性永拒；首帧突发由容量吸收+稳态 2MB/s 节流；handshakeCredit 整删（其功能被容量吸收）
private readonly awareBuckets = new TokenBucket({ capacity: 60, refillPerMin: 1800 });   // 共享实例+键前缀（census ⑥ 定义点恰三处）
// 落点三分（H-3 v5）：msg 计数+awareness 帧闸=beforeHandleMessage（判型一次）；awareness 限速=beforeHandleAwareness；bytes=beforeSync（type 现成）：
// beforeHandleMessage：
const t = readFrameType(data);   // 库 IncomingMessage.readVarString()+readVarUint()——与 T7 出站判型共用单源 helper（禁字节猜型）
if (t === MessageType.Awareness && data.length > AWARENESS_FRAME_LIMIT_BYTES /*=64KB 具名常量*/) {
  …hardClose(conn, CollabCloseCode.LIB_MESSAGE_TOO_BIG, 'frame-too-large'); throw …;   // 报告1 P1-1：480MB/s 解码路径封死（解码前拦）
}
if (!this.msgBuckets.consume(sid, 1)) { …hardClose(1008,'msg-rate-exceeded')+throw }
// beforeSync（T4 帧闸后）——SyncStep2 与 Update 同桶同键（sid；重连重置=msg 桶同款 DoS 兜底语义，升级限流桶挡断连循环）：
if (!this.bytesBuckets.consume(sid, bytes)) { …hardClose(1008,'bytes-rate-exceeded')+throw }
// guardAwareness 顶部（剔字段原语——Q-L 三档之首）+awareBuckets.consume(`aware:${sid}`) 独立限速：
if ((connection as { readOnly?: boolean }).readOnly) {
  for (const [cid, state] of states) {
    if (state && (state.cursor !== undefined || state.selection !== undefined))
      states.set(cid, { ...state, cursor: undefined, selection: undefined });   // 浅拷贝剔键——条目永不删
  }
  collabAwarenessStrippedTotal.inc({ reason: 'read-only' });
}
// onDisconnect：msgBuckets/bytesBuckets.delete(sid)+awareBuckets.delete(`aware:${sid}`)（信用已删——清理面收缩）
```

Run → 绿。Commit: `feat(y0b-4): T6 consume 按量扣减+bytes 桶容量对齐（红门⑧）+awareness 帧闸+共享桶（信用删除）`

---

## Task 7：出站背压——每 send 判+库常量判型

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（authenticate 后 wrapBackpressure）
- Modify: `store.metrics.ts`（dropped/slow_consumer/backlog 直方图）
- Test: `apps/api/src/modules/collab/collab-backpressure.spec.ts`（新——stub ws bufferedAmount 注入）

- [ ] **Step 1: 写失败测试（决策不进采样+判型库常量）**

```ts
it('一级：bufferedAmount>1MB 且出站为 awareness（IncomingMessage/MessageType 解析判型）→drop+计数；sync 帧同 backlog 照发', async () => {});
it('二级：>4MB 每次 send 判（**非 1/10 采样**——停滞 socket 两 send 间堆 10 帧场景）→立即 close(1011)', async () => {});
it('直方图 1/10 采样只归观测（决策与采样分离）', () => {});
it('census ⑤：bufferedAmount 仅本文件命中', () => {});
it('maxPayload 维持 16MB（Q-T v4 撤回 9MB——Step2 越界放行上界与 9MB 自相矛盾）；越界不变量：docSize≤maxDocBytes+maxFrameOvershoot 落测（T4 用例）；1009 探针 17MiB 维持', () => {});
```

- [ ] **Step 2: 跑红→实现→绿→commit**

```ts
private wrapBackpressure(conn: any): void {
  const ws = conn.webSocket; if (!ws || wrapped.has(ws)) return; wrapped.add(ws);
  const orig = ws.send.bind(ws); let sends = 0;
  ws.send = (data: unknown) => {
    const backlog = (ws as { bufferedAmount?: number }).bufferedAmount ?? 0;
    if (backlog > 4_194_304) { collabSlowConsumerDisconnectTotal.inc(); ws.close(CollabCloseCode.SLOW_CONSUMER, 'slow-consumer'); return; }   // 二级每 send 判
    if (backlog > 1_048_576 && readFrameType(data as Uint8Array) === MessageType.Awareness) {  // 判型=new IncomingMessage(data).readVarString()+readVarUint()（H-5 库方法——禁自写 varint）；异常一律 null=放行；包装体整体 try/catch fail-open；helper 与 T6 入站闸共用单源 readFrameType（返回 number|null 边界安全）
      collabAwarenessDroppedTotal.inc(); return;
    }
    if (++sends % 10 === 0) yjsOutboundBacklogBytes.observe(backlog);   // 采样只归观测
    orig(data);
  };
}
```

Run → 绿。Commit: `feat(y0b-4): T7 出站背压每 send 判（决策/采样分离）+库常量判型`

---

## Task 8：REST shrink——影子预演+TOCTOU 收同事务+全局信号量+quotaThaw

**Files:**
- Create: `apps/api/src/modules/collab/collab-doc.controller.ts` + `collab-shrink.service.ts`
- Modify: `collab.module.ts`（controller 注册）+`collab.gateway.ts`（thawQuota 完整实现+gc pin+calibrateTruth 公共方法）
- Modify: `store.metrics.ts`（shrink 四档+时长直方图）
- Test: `apps/api/src/modules/collab/collab-shrink.spec.ts`（新）

- [ ] **Step 1: 写失败测试（TOCTOU/纯校准/信号量/gc pin）**

```ts
describe('POST /api/collab/doc/:projectId/shrink（Q-G）', () => {
  it('EDITOR 403/未登录 401/**预演超限→422 {bytes,limit} 活 doc 零变更**（影子先算不达标不写——报告3 一致性 7：测试名对齐实现语义，『写后>预算』名称误导回滚点）', async () => {});
  it('TOCTOU：读+算+删同一同步事务段（并发新增边不留悬挂——事务外 victims 重算=红相）', async () => {
    // withDoc fn 内 stub 并发写介入（同步段内不可达——断言 fn 全同步）
  });
  it('纯 recalibrate：body {recalibrate:true} 或空 delete 集——不删内容也校准+滞回评估（假冻结出口）', async () => {});
  it('成功：truth=活文档再编码（白名单点③）+thaw（truth<0.6×MAX 时 SyncStep1 回灌——真红门③后半）+广播 rev++/ok/deletedIds', async () => {});
  it('全局信号量并发 1：第二并发 shrink 请求等待（非 429——排队）+时长直方图可见', async () => {});
  it('gc pin：options.spec 读回 yDocOptions:{gc:true}（gc:false=删除不收壳=瘦身静默失效）', () => {});
  it('@Throttle 5/min 独立桶', async () => {});
});
```

- [ ] **Step 2: 跑红→实现→绿→commit**

service（核心结构）：

```ts
async shrink(pid: string, userId: string, body: ShrinkBody): Promise<ShrinkResult> {
  await this.perm.assertEditorWithTeam(pid, userId);
  return this.gate.runExclusive(() => this.docs.withDoc(pid, (doc) => {   // 全局信号量并发 1（Promise 队列）——同步段全程
    const start = Date.now();
    try {
      const records = readRecordsFromMaps(doc);
      const victims = body.recalibrate ? [] : resolveVictims(records, body);   // 空=纯校准
      if (victims.length === 0 && !body.recalibrate) { collabDocShrinkTotal.inc({ result: 'noop' }); return { result: 'noop' }; }
      let shrunk = 0;
      if (victims.length > 0) {                                              // 影子预演（白名单点②）
        const scratch = new Y.Doc(); Y.applyUpdate(scratch, Y.encodeStateAsUpdate(doc));
        deleteNodesInDoc(scratch, victims); shrunk = Y.encodeStateAsUpdate(scratch).byteLength; scratch.destroy();
        if (shrunk > this.quota.maxDocBytes) { collabDocShrinkTotal.inc({ result: 'still-over' });
          throw new HttpException({ code: 'SHRINK_STILL_OVER', bytes: shrunk, limit: this.quota.maxDocBytes }, 422); }
        deleteNodesInDoc(doc, victims);                                      // 达标才写活 doc
      }
      const truth = Y.encodeStateAsUpdate(doc).byteLength;                   // 白名单点③：活文档再编码（非预演值）
      this.gateway.calibrateTruth(pid, truth);                               // truth+delta=0
      const thawed = this.gateway.thawQuota(pid);                            // <0.6×MAX→移除 quota+SyncStep1 回灌+广播 ok（rev++/deletedIds）
      collabDocShrinkTotal.inc({ result: victims.length ? 'ok' : 'recalibrated' });
      return { result: victims.length ? 'ok' : 'recalibrated', watermark: truth, deletedIds: victims, thawed };
    } finally { collabDocShrinkDuration.observe((Date.now() - start) / 1000); }
  }));
}
```

controller：`@Controller('api/collab/doc')`+`@Throttle({default:{limit:5,ttl:60_000}})`+`@Post(':projectId/shrink')`。gateway：`thawQuota`（Q-C 序）+`calibrateTruth`+Server 构造 `yDocOptions:{gc:true}`。
Run → 绿；spec §10 fenced 补 shrink 两指标。
Commit: `feat(y0b-4): T8 shrink 影子预演/TOCTOU 同步段/信号量/recalibrate/thaw 回灌+gc pin`

---

## Task 9：export-fresh——真实签名/团队归属/latch

**Files:**
- Modify: `collab-doc.controller.ts` + `collab-shrink.service.ts`（exportFresh）+`collab.module.ts`（imports CanvasModule）
- Test: `collab-shrink.spec.ts` 追加

- [ ] **Step 1: 写失败测试→实现→绿**

```ts
it('真实签名 create(name, folderId, userId, teamId)：显式传源 teamId/folderId/派生名——不传=落默认团队（协作者失访=红相）', async () => {});
it('fillDoc(doc, records, edges) 干净编码（墓碑场景：新 doc 编码显著小于源+records 等价——**真实签名 fillDoc 三参数**，fillDoc(doc, records, edges) 全仓不存在）+落地后编码校验（超限 warning 不阻断）', async () => {});
it('in-flight latch：并发两请求新 project 数=1', async () => {});
```

实现（Q-H）：exportInFlight Map+`this.canvas.create(`${srcName}(瘦身副本)`, src.folderId, userId, src.teamId)`+withDoc(newId, `(doc) => fillDoc(doc, records, edges)`)+落地编码校验 warning。

Commit: `feat(y0b-4): T9 export-fresh 真实签名/团队归属/latch`

---

## Task 9a：vacuum 文档代际替换（Q-U v6——REST 显式+零连接窄版自动+SV 代际门）★4a 阶段出口

**Files:**
- Modify: `collab-shrink.service.ts`（vacuumResidue 七步协议）+`collab.gateway.ts`（vacuuming serving 门+generation 比对+docGeneration Map）
- Modify: `prisma/schema.prisma` + 迁移（CanvasDoc 表加 `generation Int @default(0)`——开发期无存量数据零成本）+`collab.module.ts`
- Modify: `store.metrics.ts`（residue Gauge 已表内+vacuum_total 五值）
- Test: `collab-shrink.spec.ts` 追加 vacuum 族（int）+`collab-quota-gate.spec.ts` 追加 generation 门

- [ ] **Step 1: 写失败测试（十条——v5 七条+SV 代际门三条）**

```ts
describe('POST /api/collab/doc/:projectId/vacuum（Q-U v6——七步协议 try/finally+SV 代际门）', () => {
  it('**红门⑦ 代际一致性**：vacuum 完成→重连写入新编辑→再重载⇒全部 keys 完整+pendingStructs/pendingDs==null+meta.schemaVersion===2（stamp 保留——U-1）+exec 条目保留（U-2——写入后 writeExecStatus 可读回）', async () => {});
  it('全根复制断言：vacuum 后 doc.share 根类型集合与源完全一致（nodes/edges/meta/exec——未来新增根 map 不可能被静默丢弃〔U-2〕）；构造 Y.Text 型根 ⇒ result=unsupported-root 拒绝且 DB 零变更', async () => {});
  it('**等价断言扩全根**：readRecords 深比+根类型集合相等+exec 键集合相等+meta.schemaVersion===2（三条 O(键数)——U-1/U-2 直接检测）；stub readRecordsFromMaps 不相等 ⇒ result=equivalence-failed+DB 零变更', async () => {});
  it('**quiesce 红门+硬前置**：thaw 回灌（冻结期客户端编辑 SyncStep2 收齐）+pending 队列空+spool 未确认帧=零才能继续；stub 未 store 编辑在队列 ⇒ 等待（不吞）；**stub 卸载超时 30s ⇒ result=quiesce-timeout 中止**（禁降级继续——"PG 完整性=已卸载推论"，未卸载读 PG=丢最近 debounce 窗编辑且等价断言恰好通过〔新旧同源〕）', async () => {});
  it('**中止恢复（v6 报告3 P1-2）**：equivalence-failed/unsupported-root/quiesce-timeout 三路中止 ⇒ vacuuming 门已解除（新连接 auth 成功非 503）+freeze 已恢复可写（applyWriteFreeze quota off）——比不 vacuum 更糟的状态不允许存在', async () => {});
  it('serving 门：vacuum 进行中——新 WS auth 503+withDoc 503（readServerSV/readCanvas/writeExecStatus 同挂〔U-3/G-7〕）；完成后解除+重连正常', async () => {});
  it('**SV 代际门三向（v6 报告2 G-2 替代 ?gen=）**：①vacuum 前在线客户端（doc 持真空前 clientID）断连后带旧 doc 重连 ⇒ SyncStep1 处 SV 与 preVacuumSv 重叠 ⇒ terminal 4410 doc-generation-stale（裸 ws 观测）；②新页面（空 SV）⇒放行且全量同步；③vacuum 后 reload 新建编辑（新 clientID 不在 preVacuumSv）⇒放行——**reload 不循环**（v5 ?gen= 形态此用例必红——URL 会话重建丢失 gen）', async () => {});
  it('terminal close：vacuum 启动时存量连接收 close 4410 doc-vacuuming（裸 ws 观测）——provider 1s 重连定时器被 terminal 档停（U-4）', async () => {});
  it('**事务纪律（v6 报告1 P1-2/报告2 G-3）**：⑥ 单事务首行取 pg_advisory_xact_lock(hashtext(pid))（与 append/compact 同键——canvas-doc-insert-ratchet 红线维持）+stateSeq===被删行最大 seq（断言非 0 非 GREATEST 包装）+preVacuumSv/generation 同事务落列', async () => {});
  it('**共享状态普查（v6）**：vacuum 完成后所有按 pid 键控的 Map/Set〔docTruth/docDelta/docStatusRev/docGeneration/quotaFrozenDocs/freezePending/overPush/truthMeasuredAt/recheckRounds/thawCooldown/lastCompactAt 族/degradedDocs〕+SnapshotDocCache 均无该键（断言测试——防旧代记账污染新代）', async () => {});
});
```

- [ ] **Step 2: 跑红（红相=①v4 形态代际污染〔若先实现 v4 形态〕②无 serving 门时 withDoc 可物化旧 doc ③v5 ?gen= 形态 reload 循环）→ 实现 → 绿 → commit**

```ts
async vacuum(pid: string, userId: string): Promise<VacuumResult> {
  await this.perm.assertEditorWithTeam(pid, userId);                       // 显式触发（T11 二次确认）；零连接窄版自动路径=内部直调（冻结≥4 轮+零连接+residue>60% 门）
  return this.vacuumGate.runExclusive(async () => {                        // 全局信号量（与 shrink gate 分立）
    this.vacuuming.add(pid); let committed = false;
    try {
      // ⓪ thaw 回灌（U-5）→ ① freeze 全连接+terminal close：applyWriteFreeze('quota',true)+全连接 hardClose(4410, DOC_VACUUMING_TERMINAL_REASON)
      // ② serving 门已开（vacuuming.add）——auth/loadDocument/withDoc 入口 503 'doc-vacuuming'
      // ③ quiesce 硬前置：等 documents.get(`project:${pid}`)===undefined+pending 空+spool 未确认帧===0
      //    ——超时 30s ⇒ return { result: 'quiesce-timeout' }（**禁降级继续**；前提：PG 完整性=已卸载推论）
      //    ——清进程态=共享状态普查表逐项删（docTruth/docDelta/docStatusRev/docGeneration/quotaFrozenDocs/freezePending/
      //      writeFreeze 条目/overPush/truthMeasuredAt/recheckRounds/thawCooldown/store 记账/SnapshotDocCache.delete/degradedDocs）
      // ④ 离线全根真空：prisma 读 state+updates→旧 Y.Doc apply→**按 doc.share 枚举**：
      //    nodes/edges → readRecordsFromMaps+fillDoc(新 doc, records, edges)；exec → 逐条目深拷贝；
      //    meta → 复制除 schemaVersion 外全部键+stampDocSchema(新 doc)；其他根类型 ⇒ unsupported-root（DB 零变更）
      // ⑤ 等价断言扩全根：readRecords 深比+根类型集合+exec 键集+meta 戳——不等 ⇒ equivalence-failed 中止
      // ⑥ 单事务：await lockProject(tx, pid)【与 append/compact 同键——P23/V26 锁键单源】
      //    → 读被删行 maxSeq → upsert CanvasDoc{ state: 真空编码, stateSeq: maxSeq【禁 0/GREATEST——insert-ratchet 红线】,
      //      preVacuumSv: 真空前 SV, generation: n+1 } → deleteMany 全增量行（按实读行 id——compact 同式）→ committed = true
      // ⑦ 解除：客户端靠广播（doc-status generation 跳变→T5 pendingGenerationReload→T11 clear+reload——UX 通道）
      //    +SV 代际门拦旧历史重连（beforeSync type=SyncStep1：decodeStateVector(payload) 与缓存的 preVacuumSv
      //    逐 client 比对 clock 区间重叠 ⇒ terminal 4410 DOC_GENERATION_STALE_TERMINAL_REASON——T0 探针④实证 payload=SV）
    } finally {
      this.vacuuming.delete(pid);                                          // 无论成败必须（否则 503 永久）
      if (!committed) for (const c of this.writeFreezeKeysOf(pid)) this.applyWriteFreeze(c, 'quota', false);  // 中止恢复可写
    }
  });
}
```


- [ ] **Step 3: 4a 出口汇聚（【用户确认点】）**

```bash
pnpm --filter @flowweb/api test -- --run 'collab-quota|collab-rate-gate|collab-backpressure|collab-shrink'   # 全绿（含 vacuum 族）
node scripts/check-spec-consistency.mjs
# 4a 出口补 web 侧最小声明（D-14）：canApplyIntent 判据①-③+runCommand precheck 骨架单测绿
#（判据④依赖快照消费=T5 web 侧已含；4b T10 才做全量粘贴分块）
```

**八条呈报**：①首触冻结可解释+持续强推真观测 close 4404（per-conn 10s 窗+idle-reset）/②累积漂移不误冻（200KB+10MB）/③thaw 回灌无损（静默分叉红相）/④病态行不锁死（照读+pendingStructs/pendingDs 可见+REST 可达）/⑤冷却窗 50 帧 1 次编码/⑥冻结态 50 帧 0 次编码/**⑦vacuum 代际一致性+reload 不循环（SV 门——v6）**/**⑧离线合并可上传（bytes 桶容量对齐——v5）**。
Commit: `feat(y0b-4): T9a vacuum 文档代际替换（七步 try/finally+SV 代际门+lockProject/stateSeq 纪律+普查表）——4a 服务端核心出口`

---

## Task 10：客户端预算——seam 前置 runCommand precheck+快照/delta 判据④+分块粘贴

**Files:**
- Modify: `apps/web/src/stores/canvasIntents.ts`（canApplyIntent+utf8Bytes+dispatch 兜底断言）
- Modify: `apps/web/src/stores/canvasStore.ts`（runCommand precheck 参数——:1773 canEdit 门并列）
- Modify: `apps/web/src/stores/canvasStore.ts`（pasteGroupClipboard——按 T0 探针③形态）
- Test: `apps/web/src/stores/canvasIntents.quota.spec.ts` + `canvasStore.paste-chunk.spec.ts`（新）

- [ ] **Step 1: 写失败测试（判据④多用户正确+undo/redo 覆盖+拒=零写入）**

```ts
describe('canApplyIntent（Q-I）', () => {
  it('key-too-large 先判（utf8 字节——中文 3× 量纲修正）→tx-too-large（包含关系注释）→too-many-nodes→doc-over-budget', () => {});
  it('判据④插值：模拟远端写入（B 不知情）后 localDelta 覆盖（doc.on(update) 全 origin）→B 侧也拒', async () => {
    // v1 serverWatermark 双口径=多用户失效红相
  });
  it('undo/redo 覆盖：redo 回放前 precheck 拒（undo 不拦——只减尺寸）；回放后 localDelta 增', () => {});
  it('漂移实测双路径（v5）：常规=localDelta>1MB 触发 requestIdleCallback({timeout:2000})（后台标签兜底——P1-5）；超大=localDelta>4×maxTxBytes **同步实测一次再判**（报告1 P1-7：v4 的 pending-measure 拒绝=静默丢用户粘贴动作——8MB 编码 23ms 一次性路径可接受；实测后按真值放行/拒绝，不丢动作；'pending-measure' 枚举仅保留给 idle 在途窗）', async () => { /* fake timers+fire idle+同步实测三条路径 */ });
  it('拒=store 与 doc 双不变（**runCommand precheck 先于 captureStoreProjection——v2 dispatch 层拒=store 已污染红相**）+diag 恰一次+toast', () => {});
});
describe('分块粘贴（Q-J——T0 探针③形态）', () => {
  it('E39①：1MB 文本+100 节点粘贴成功（分块逐块过 seam）+undo 一步（undoStack.length===1）', () => {});
  it('中途预算耗尽：已贴块保留+剩余丢弃+diag（块=原子不半块回滚）', () => {});
});
```

- [ ] **Step 2: 跑红→实现→绿→commit**

```ts
// canvasIntents.ts：
export function canApplyIntent(intents: CanvasIntent[]): ApplyIntentVerdict {
  const st = useCanvasStore.getState();
  for (const i of intents) for (const v of iterStringValues(i))
    if (utf8Bytes(v) > QUOTA_DEFAULTS.maxKeyBytes) return { ok: false, reason: 'key-too-large' };   // ①先判（更具体文案；②的子集——注释钉死包含关系）
  const txBytes = intents.reduce((n, i) => n + utf8Bytes(JSON.stringify(i)), 0);
  if (txBytes > QUOTA_DEFAULTS.maxTxBytes) return { ok: false, reason: 'tx-too-large' };
  if (intents.filter((i) => i.type === 'addNode').length > QUOTA_DEFAULTS.maxNodesPerTx) return { ok: false, reason: 'too-many-nodes' };
  const softLimit = st.quotaSoftLimitBytes > 0 ? st.quotaSoftLimitBytes
    : Math.floor(QUOTA_DEFAULTS.maxDocBytes * QUOTA_DEFAULTS.softEnterRatio);   // v5 缺省回退=6.7MB 软阈（报告3 P1-2：恒 undefined⇒NaN 比较恒 false=gate 失效；禁回退硬限 maxDocBytes）
  if (localDelta > 4 * (st.quotaTxBytes || QUOTA_DEFAULTS.maxTxBytes)) {
    const measured = measureLocalDocNow();                                     // v5：同步实测一次（非拒绝——报告1 P1-7：拒绝=静默丢用户动作）
    if (measured + txBytes > softLimit) return { ok: false, reason: 'doc-over-budget' };
    return { ok: true };                                                        // 实测通过——真值判定
  }
  if (localDocBytes + localDelta + txBytes > softLimit) return { ok: false, reason: 'doc-over-budget' };   // ④快照+delta 插值+软限对齐（客户端可用上限=软阈——文案与拦截点一致 Q-A v5）
  return { ok: true };
}
// localDocBytes（runtime 导出）：快照 quota.bytes 权威覆盖（T5 已接线——五键含 softLimitBytes）+两次校准间 doc.on('update')
//   全 origin localDelta 插值（远端/undo/回放全覆盖）+delta>1MB 触发 requestIdleCallback 后台实测
//   encodeStateAsUpdate 自校准（census ④ 白名单点——读路径只读缓存值）。
// 【seam 前置（Q-I v3 关键）】runCommand 增 precheck 参数（:1773 canEdit 门并列）：
runCommand: (fn, precheck?: () => ApplyIntentVerdict) => {
  if (!canEdit(get())) { message.warning('当前为只读会话，操作已忽略'); return; }
  const v = precheck?.();
  if (v && !v.ok) { recordCollabDiag('write_reject', { reason: v.reason }); toastQuotaReject(v.reason); return; }   // store 零污染（captureStoreProjection 之前）
  stopCapturing(); const before = captureStoreProjection(); try { fn(); } ...   // 既有体不变
}
// 粘贴：buildCopyPlan 纯函数先算→定块→每块 precheck（Σ utf8+当前尺寸）→通过才 appendCopyChunk。
// undo/redo（canvasUndo.ts:51/61）：redo 前同 precheck（undo 不拦）。
// dispatchCanvasIntent :256-269：canApplyIntent 降级为断言兜底（触发=设计漏洞落 diag 告警——非常规路径）。
```

Run: `pnpm --filter web test -- --run canvasIntents.quota canvasStore.paste-chunk` → 绿
Commit: `feat(y0b-4): T10 seam 前置 runCommand precheck（store 零污染）+快照/delta 判据④+分块`

---

## Task 11：quota UX——三级横幅+瘦身对话框+4404 终态重连动作

**Files:**
- Create: `apps/web/src/pages/canvas/components/QuotaBanner.tsx` + `ShrinkDialog.tsx`
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts`（4404 close 终态档）+`collabApi.ts`（新）
- Test: `QuotaBanner.test.tsx`（新）

- [ ] **Step 1: 写失败测试→实现→绿→commit**

```ts
it('软阈通告横幅（非阻断）；硬阈常驻双主按钮「一键瘦身」「导出到新项目」（删"请删除内容"）', () => {});
it('4404 终态档：close 分支（1009 同款——DOC_OVER_QUOTA_TERMINAL_REASON）+横幅常驻+**「重新连接」动作**（瘦身后自愈入口——终态后唯一复位路径）', () => {});
it('冻结期编辑面禁用：quotaOver 时 editor.setEditable(false)+工具栏禁用（dispatch 静默 return 兜底之上加 UI 禁用——spec §3.1ter）', () => {});
it('shrink 成功三档提示：ok（"已瘦身，撤销历史已重置"）/still-over（"仍超 X KB——请导出"）/recalibrated', () => {});
it('发起端 undo 清理：shrink 响应处理 undoManager.clear()+localDocBytes 重置+提示（对端不清——无广播字段）', () => {});
it('**pendingGenerationReload 消费（报告3 P0-1 配套——T5 写入本 Task 消费）**：doc-status.generation 跳变⇒undoManager.clear()+提示「正在重建画布历史」+location.reload（携带 ?gen= 新值）', () => {});
it('**vacuum 入口（Q-U v6 双路）**：ShrinkDialog 增「重建画布历史（清理残留）」按钮——仅 quota.residueBytes>50%×limit 时亮出（**doc-status 携带 residueBytes——v6 G-5 数据源**）+二次确认（明确告知将刷新所有人）→ POST vacuum → 终态横幅自动 reload；文案按软阈口径「已用 X%（上限约 6.7MB）」', () => {});
it('**4410 终态档双 reason（Q-U v6——resolveCloseAction(4410)→terminal）**：close 4410 'doc-vacuuming' ⇒ 终态横幅「正在重建画布历史，即将自动刷新」+自动 reload；4410 'doc-generation-stale'（SV 检测拦旧历史客户端）⇒ 同横幅+自动 reload——**reload 后空 SV 放行=不循环**（v6 报告3 P0-1：v5 ?gen= 形态此用例必红）', () => {});
```

实现要点：QuotaBanner（quotaOver/hard=quota.bytes≥limit 或 4404 终态判定）+ShrinkDialog（节点按 utf8 字节降序+勾选 deleteNodeIds/纯校准按钮）+collabApi（shrink/export-fresh）+runtime close 映射 4404→wsAuthNotice 终态族（resolveCloseAction terminal 消费——reason 双键兜底含 (1000,doc-over-quota)）。
Run → 绿。Commit: `feat(y0b-4): T11 quota 三级 UX+4404 终态重连动作+编辑面禁用+跨端通知`

---

## Task 12：E38——selection 去抖+高亮+4KB 限额

**Files:** 同 v1（awareness.ts/CanvasView/RemoteCursors/guardAwareness）+具名常量
- [ ] **Step 1: 写失败测试→实现→绿→commit**

v1 T12 维持+两处修订：服务端 4KB 判**解码后 states 字节**（`JSON.stringify([...states.values()]).length`——Q-K，`+512` 魔法数废除）；客户端 `utf8Bytes` 替代 `.length`。去抖 200ms+clearSelection（setAwarenessField('selection', null)）+RemoteCursors 高亮层。
Commit: `feat(y0b-4): T12 E38 selection 去抖+高亮+4KB（states 字节判+具名常量）`

---

## Task 13：E39 单人短路 distinct user+30s 停报+over-8+成员表复用

**Files:**
- Modify: `awareness.ts`（solo 短路+30s 停报）/`CanvasView.tsx`（cursor 上报路径）
- Modify: `collab.gateway.ts`（guardAwareness solo/over-8 剔字段——distinct user.id）
- Modify: `CanvasTopBar.tsx`（presence 增强+挂 ProjectMembersPanel）
- Test: `collab-awareness-guard.spec.ts` 追加+`collab-idle-anchor.spec.ts` 并入（90s 单等待两断言）+`CanvasTopBar.test.tsx`

- [ ] **Step 1: 写失败测试→实现→绿→commit**

```ts
// api：
it('solo：distinct user.id≤1（两 tab 同人=solo——连接数判据=口径偏离红相）剔 cursor/selection 后回显照常+stripped{solo}', () => {});
it('over-8：distinct user.id>8 剔字段+成员表数据源（user/presence）不受影响+stripped{over-8}', () => {});
// web：
it('E39②：单人（remoteStates 空）cursor/selection 字段零写入（presence 锚点照常——§0.4b-17）', () => {});
it('30s 空闲停报：最后 pointermove 30s 后 cursor 不更新（停更新不清字段）', () => {});
it('成员表：CanvasTopBar presence 点+点击挂既有 ProjectMembersPanel（角色/撤销全复用——零新端点）', () => {});
```

实现：distinctUsers=并集去重 `(document as any).awareness.getStates()` ∪ 本帧 states 的 user.id（P1-6——本帧只含发帧者，10 人画布单帧会误判 solo；**反例用例：多人画布单帧不触发 solo 剥离**）；strip 浅拷贝剔键**保持原 meta.clock**（禁递增——与 rewriteAwarenessRole 方向相反，发送者本地光标不被回显覆盖）；CanvasTopBar onlineUsers.dot+Popover 挂 ProjectMembersPanel（import 既有组件）。
Run → 绿。Commit: `feat(y0b-4): T13 E39 双向短路（distinct user）+30s 停报+over-8+成员表复用（零新端点）`

---

## Task 14：观测面核对+census 十组

- [ ] **Step 1:** §0.2 表指标逐项 register.metrics() 核对（B8 一一对应+help 语义）+yjsCanvasDocBytes 帮助文本改写+**collabWsCloseTotal 调用点注释更新为八点并逐一列名**（store.metrics.ts:110-116——v2 报告 C-2 悬欠两轮）。
- [ ] **Step 2:** census 十组（TDD 纪律节清单）——⑥改**恰四处 TokenBucket 定义点**（升级/msg/bytes/aware——参数不同不可共实例）；⑨改显式 `consume(sid, 1)`（生产调用点全显式禁注释型门禁）+consumeFrame/consumeBytes 具名 helper 可选；⑩pendingStructs **&& pendingDs** 双查。脚本化 `scripts/check-collab-census.mjs` 并入 verify。
Commit: `chore(y0b-4): T14 观测核对+census 脚本化十组+readOnly 直写点清零（applyWriteFreeze 单源——T4 v5 追加）`

---

## Task 15：出口汇聚——verify 三连+偏离登记+部署清单【用户确认点】

- [ ] **Step 1:** `pnpm verify && pnpm test:int:ci && pnpm --filter web test` 全绿（flaky 隔离复跑禁降级）；check-int-coverage 回填。
- [ ] **Step 2:** E39 表逐格（①T10 ②T13 ③Y0b-3 已落引用 ④Y0a-3 引用 ⑤Y1c-2a 登记）。
- [ ] **Step 3:** spec §0.4c 偏离登记（v6 预登记 **46 条**）：1-14 同 v1 沿革（doc-status 联合快照 rev/单人短路重释/env 归属/30 常量/webSocket.send 包装/export 超限直拷/utf8 近似/分块贪心或天然/422 语义/装载同值/农场零动作/gauge 聚合/成员表复用）+15 真值口径切换（累计→实测——产品语义变更呈报）/16 判据落点 beforeSync（spec §4.1② beforeHandleMessage 字面偏离）/17 滞回 0.8/0.6+**recheckTimer 驱动解除**（spec"仅 shrink 解除"扩展——compact 驱动自锁不可达实证）/18 连接数→distinct user/19 装载不拒行+pendingStructs 断言（spec §4.1⑤"decode 前拒绝"重释——跳行=因果链静默丢失真跑实证）/20 spool merge 上限对齐/21 冻结层单源化/22 SyncStep1 回灌解冻/23 **4404 分层升级**（首触冻结+持续强推 per-conn 10s 窗才终态——spec"持续强推才 4404"原文对齐）/24 **帧闸 1009**（1008 backoff=重连重发循环）/25 快照 maxTxBytes 下行（双源发散消除）/26 **bump csv=2**（drain 期旧 bundle 静默吞编辑真丢——fail-closed）/~~27~~（**v6 删——与 32 条矛盾**：9MB 推导已被撤回，沿革并入 32）28 oracle 冷却窗+编码成本两硬用例（P0-1）/29 TokenBucket consume cost（P0-2；**v6 注：信用形态已被 36 条整删取代**——沿革以 36 为准）30 conn-status 每连接推送（authScope 污染修复）/31 vacuum+residue 分离控制律（改判——compact 不可回收残留实测）/32 maxPayload 维持 16MB（v3 的 9MB 推导撤回）/33 冻结→thaw 窗口内客户端编辑靠回灌收敛（非丢失——显式声明）/34 pending-measure 客户端延迟语义/35 awareness solo/over-8 取数源=文档全量∪本帧/**36 bytes 桶 capacity=maxDocBytes+握手信用整删（报告1 P0-2——"桶容量≥最大合法帧"不变量）/**37 vacuum 文档代际替换+REST 显式触发（v5：七步协议+generation DB 列+?gen= 门+等价断言——spec §9.21『in-place vacuum 不做』重写）/**38 awareness 入站 64KB 帧闸（v3 驳回改判——库判型非字节猜型）/**39 Update 帧闸 2× 余量（估算误差退化为软冻结非终态）/**40 4410 doc-vacuuming+overPush 10s 窗（4410 预留提前消费+4404 升级窗 5s→10s）/**41 残余登记：maxPayload 16MB/连接攻击者缓冲（E-7——良民被帧闸钉住，诚实登记）**/**42 vacuum 代际门=preVacuumSv SV 重叠检测（SyncStep1 处）——?gen= URL 门证伪删除（会话重建丢参数=reload 循环）**/**43 vacuum 事务=lockProject 同键咨询锁+stateSeq 被删行最大 seq（append/compact 纪律延伸）**/**44 freezePending/quotaFrozenDocs 两态分离（deferredConfirm 期间判据不关闭）+overPush idle-reset**/**45 Step2 直发绕过 SV 门=自制客户端残余（帧闸限大小+自托管威胁模型内，登记不实现）**/**46 零连接窄版自动 vacuum（冻结≥4 轮+零连接+residue>60%——无在线用户无刷新伤害）**。
- [ ] **Step 4:** v8 目录回填+部署清单（.env 四键默认可跑；**部署顺序=api+web 同批+bump csv=2**〔Q-S——旧 bundle fail-closed 拒+请刷新 UX，零静默丢失〕；T1 落地时同步 collab-protocol.test 断言值 1→2）+**T9a 迁移进部署校验**（generation+preVacuumSv 两列：迁移回放+dump-schema-objects 双向比对——v6 报告3 P2-12）+runbook：容量口径（用户可见≈6.7MB 软阈）/真空窗口 30s 上限（exec 结果写丢弃⇒intent-reconcile 兜底——G-7）/maxDocBytes×驻留×放大 ≤ heap release 线（观测非 enforcement，LRU=Y1c-3）。
Commit: `docs(y0b-4): T15 出口汇聚——偏离 46 条+verify 三连绿+部署清单（bump csv+generation 迁移）`

**【用户确认点】**——spec §4.5 出口判据逐项呈报+四真红门+回归锚（VIEWER 90s）全绿证据。

---

## 附：执行风险预警

1. **beforeSync throw 的清队列语义**——拒绝瞬间同批后续帧全丢（库 esm:476 `messageQueue.length=0`）：客户端分块粘贴逐块预算+先通告 doc-status 让 UI 可解释；残余=同 tick 批内帧丢失，登记（外审 B-4 采纳后残余）。
2. **writeFreeze 六写点改道的回归面**——Y0b-3 落的 drain/sweep/VIEWER readOnly 断言族全数红改（同批更新断言为冻结层语义，禁删断言）；recheckConnection 升回守卫扩容测试。
3. **over 检查编码成本**——8MB doc 全量编码 ~50-100ms/次，仅 over 态+触发式（快路径 O(1) 不编码）；速率闸已限帧频；T8 信号量隔离 shrink 并发。
4. **T5 快照并轨的 Y0b-3 回归面**——write-frozen 消息形态改动红既有断言（同批改测 doc-status.writeFrozen 等价语义）。
5. **idle-anchor 90s 并入**——单次等待双断言（无 4408+剥离实证）控 verify 时长。
6. **已知环境陷阱**——esbuild/CWD 漂移/fake timers×ws/kit.forget/metricDelta（Y0b-3 惯例全量适用）。
7. **writeFrozen 并轨后旧 bundle drain 期横幅缺失**——部署清单钉死 api+web 同批。

