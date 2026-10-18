<!-- doc-status: active -->
# Y1a+Y1b C0a spike 数据落盘（2026-10-18）

- **上游**：[2026-10-18-y1a-y1b-doc-model-order-size-design.md](2026-10-18-y1a-y1b-doc-model-order-size-design.md)（spec v6）§4 C0a 行——出口判据「数据+原型落盘；guard 可行/不可行有结论；placement 类型方案定稿」。
- **载体**：`scripts/c0a/`（7 个自包含脚本——order-key-growth / placement-atomicity / rebalance-bench / projection-bench / guard-prototype / probe-feasibility / type-chain-spike；yjs 经 createRequire 挂 apps/api 解析）。
- **环境**：node v24.14.1；yjs 13.6.32；sharp 0.34.5；ffprobe/ffmpeg 8.1.2（本机 PATH）。

## 1. 分数索引增长曲线（order-key-growth.mjs）

实现：base32（0-9A-V 严格递增）中点方案+「不得以 `0` 结尾」不变量+头尾虚拟边界+等值键 typed 拒绝。**property 验证 PASS**（3001 键随机插入——序/唯一/尾 0/表内字符全不变量成立）。

| 场景（1000 次插入） | maxLen | avgLen | per-op |
|--------------------|--------|--------|--------|
| 头插（pos 恒 0，中点策略） | **200** | 100.5 | 5.1µs |
| 同锚插入（pos 恒 1——「同样两个邻居之间」） | **201** | 101.1 | 5.1µs |
| 尾插 | 63 | 31.8 | 0.4µs |
| 随机插入 | 11 | 4.4 | 0.4µs |
| 同锚 2000 次 | 401 | 201.1 | 7.9µs |
| 头插·降档变体（取 b0-1 而非中点） | 63 | 31.8 | 1.7µs |
| 头插·降档变体 5000 次 | 313 | 156.8 | 7.4µs |

**结论**：
1. **纯中点方案对连续同位插入是线性增长（≈1 字符/5 次插入）**——1000 次→200 字符，与外审数学预测吻合。这是中点策略的信息论本性（每插一次对剩余空间取半），非实现 bug——property 全绿证明算法正确。**同锚 3000 次不失败**（无耗尽——键长持续增长直到 128 硬上限≈640 次同锚插入）。
2. ~~随机使用非常健康（avg 4.4/max 11）——soft 32 正常使用不可达~~ **〔v7 勘误 2026-10-18：本结论采样口径错误〕**——「随机插入」不是画布主路径；**尾插（maxLen 63/avg 31.8@1000 次，≈1 字符/16 次追加）才是**（新建节点/粘贴/加格全走层尾追加）：**soft 32 ≈500 次追加即触发、hard 128 ≈2000 次追加**——append-only 是本方案最可能的常规触发路径，外审（plan v1 评审）据此推翻本结论成立。**处置（spec v7 §2.2）**：生成器换 integer-part 方案（移植 fractional-indexing 算法+测试向量——尾/头插走整数部增减，追加对数增长），并以 append-only 基准（G29：10k 尾插 maxLen≤16/10k 头插≤32/重排后 1k 次追加不触发 soft）为硬验收；本表中点数据保留为「反面基准+property 验证算法」的历史依据。
3. **soft 32 触发口径（中点算法下）**：≈160 次连续同锚/头插（单间隙）或 **≈500 次层尾追加**；hard 128 ≈640 次同锚/**2000 次追加**。参数 soft/hard 随 integer-part 生成器重定（§0.2-⑤ v7）。
4. per-op 生成成本 0.4-8µs——非热点。

## 2. placement 原子性实验（placement-atomicity.mjs）

两键形态（parentId/order 独立 Y.Map 键）vs 复合单键（placement 整值），双客户端并发「移动（A：parentId+order 同事务）+置顶（B：只写 order）」：

| 形态 | clientID 组合 | 结果 |
|------|--------------|------|
| 两键 | 100/200、7/999 | **混键复现**：parentId=g2（A 写）+ order=BG1TOP（B 写，g1 层键）——跨 sibling 集 order，双端收敛但收敛值即混键 |
| 两键 | 200/100、999/7 | 未混（order 冲突 LWW 恰好同写者胜）——**混键是否出现取决于 clientID 相对序，4 组合中 2 组命中** |
| 复合 | 全部 4 组合 | **placement 整值必同源配对**（parentId+order 来自同一写者对象）——原子性实证 |

**结论**：G17 先红判据**实验可构造**（两键形态混键可稳定复现——直接作 A3 harness 反例用例）；复合单键原子性成立。Yjs 同键并发 LWW 胜者=更高 clientID 写者（实验观测——写入 A2 用例断言）。

## 3. rebalance 基准（rebalance-bench.mjs）

全 root 层 N 节点、初始键长 41（>32 触发条件）、先算后写（bijective base-31 短键）：

| N | buildMs | computeMs | applyMs | bytesBefore | bytesAfter | shrink% | docTruthMs |
|---|---------|-----------|---------|-------------|------------|---------|------------|
| 2000 | 17 | 2.5 | 8.4 | 373,553 | 320,495 | 14.2 | 8.3 |
| 5000 | 34 | 3.5 | 10.6 | 948,900 | 822,380 | 13.3 | 19.1 |
| 10000 | 40 | 5.8 | 20.2 | 1,917,516 | 1,670,996 | 12.9 | 29.6 |

**中途 throw partial 实验**：transact 内第 500 个 set 时 throw → **半重排态实存**（新短键 500/旧长键 500）+ **throw 事务的 update 事件仍触发**（cleanup 照常广播/持久化）——G26 红相实验可构造，yjs.cjs:3438-3463 try/finally 无回滚结论实证。

**结论**：
1. 10k 节点重排全程 ≈56ms（compute 5.8+apply 20.2+truth 29.6）——**load 期预算充足**（hook 窗口同步执行无帧可达，不占首帧路径外的任何面）。
2. 字节收缩 12.9-14.2%——重排=减容佐证（quota 门废止依据）。
3. **先算后写必要**：apply 段中途异常留半层混合键+docTruth 失真——Z4''-v6 设计实证。
4. 实现注记：新键须按旧键排序序分配（本基准按迭代序——计时等价、保序语义由 A2 实现）；紧凑顺序键的字典序=序数序需按 spec 的均匀中点分配或长度感知编码（bijective base-31 纯字典序不保序——A2 实现注意项）。

## 4. 投影基准（projection-bench.mjs）

10k 节点（20 组×500 子，placement 复合键）：

| 阶段 | p50 | p95 |
|------|-----|-----|
| ① readRecordsFromMaps 等价读 | 12.6ms | 21.4ms |
| ② orderRecordsTotal 层序排序 | 1.7ms | 3.7ms |
| ③ store 全量重建（新对象） | 0.3ms | 0.7ms |
| ①+②+③ 全链（applyDocToStore 等价） | **15.0ms** | **18.7ms** |

**结论**：10k 投影全链 p95≈18.7ms——**在 50ms 投影窗内余量充足**（G22 阈值建议：全链 p95 ≤30ms 达标线；读侧占 84%——若未来超预算，优化点是 readRecords 而非排序）；zustand set/React 渲染未计入（浏览器面另行验收）。

## 5. beforeSync guard 路径解析原型（guard-prototype.mjs）——结论：解析可行（v7 勘误：部署档位 shadow）

**编码规律（一手探明——Yjs update V1 格式）**：
1. 同事务**首 item 携带 parent**（root=字符串 YKey（如 `nodes`）；嵌套类型=持有 item 的 ID——实验证实「嵌套类型 ID==持有它的 item 的 id」）+parentSub；
2. **跨事务同 key 写省略 parent**——仅带 origin（同 key 左邻 item ID），须经 origin 链递归推导（帧内 struct 索引→live store 二分反查）；
3. **Y.Map 覆写=删旧 item+加新 item**——DeleteSet 中旧 item 键若同帧重写=覆写非删除（须覆写豁免，否则误报）；
4. DeleteSet 按 client/clock 区间编码——键级删除语义须经 live store 反查 item 的 parent/parentSub。

**原型算法**：预建索引（类型 ID→路径 + 类型对象→路径，1000 节点 1-3ms 一次性/生产增量维护）→ decodeUpdate → 逐 struct 解析（parent 直接/origin 链递归）→ 策略判定 → DeleteSet 反查（覆写豁免+整节点删除放行）。

**矩阵 9/9 全绿**：四形态（新建节点/信封写跨帧/data 写/删除）+正例矩阵零误报+坏帧全检出（placement 格式非法/客户端写 natural/删 placement 键）。

**CPU**：单 op 帧（52B）p50=0.007ms/p95=0.042ms；全量帧（1000 节点 SyncStep2 形态 171KB）p50=13ms/p95=27ms。

**达标结论与风险登记**：
1. ~~**§3.6 定档：达标档**~~ **〔v7 勘误 2026-10-18：档位降级〕**——**解析可行性达标、部署为安全边界不达标**：9/9 矩阵+增量帧 0.007ms 证明「原型算法可行」；但三份 plan 外审收敛指出部署级反对称性——①264KB 超阈 fail-open=最大的帧不查（拆帧绕过面）②SyncStep2 整帧拒绝=丢全部离线编辑+重连风暴（误报代价=用户数据，漏报代价=短暂脏值——不对称）③私有结构依赖（`_map`/`store.clients`/decodeUpdate 未集成 struct）=yjs 升级即事故 ④增量索引清理未设计。**定案（spec v7 §3.6）：shadow 默认**（`COLLAB_CONTENT_GUARD=off|shadow|enforce`——shadow 只解析+计数+日志零拒帧）；主路径=post-apply 检测（transaction.changed 只验变更节点+诊断 close code 非 terminal）；enforce 需 shadow 期一个发布周期对账数据+yjs 版本 pin+conformance spec。本原型保留为 shadow 引擎+诊断工具。全量帧 27ms p95@1000 节点/10k 外推≈270ms 维持为 shadow 模式成本口径。
2. **私有结构依赖**：`_map`/`store.clients`/decodeUpdate 返回的未集成 struct 形态/item.parent 语义——yjs 升级需重新核验（观察项登记）。
3. **GC 时序约束**：origin 链解析依赖 live item 的 parent 信息——**解析必须在 apply 前做**（guard 的 pre-apply 时序天然满足；实验中事后批量解析因 item 删除丢 parent 而误报——已按忠实时序修正）。已删除未 GC item 保留 parent ✓。
4. 生产实现须**增量维护索引**（每 applied update 注册新建类型）——本原型每帧重建仅作正确性验证。

## 6. probe 可行性（probe-feasibility.mjs）

1. **sharp EXIF**：`withMetadata({orientation:6})` 写入后 `metadata()` 读出 orientation=6 但 **width/height 仍为原始像素**（320×180）——**5-8 档交换须 worker 自做**（Z7''-v6 EXIF 交换锚成立，非 sharp 自动）；`limitInputPixels` 默认拦下 30000×30000 合成图（「Input image exceeds pixel limit」）——**decompression bomb 防护开箱即用**。
2. **ffprobe/ffmpeg 8.1.2 可用**（PATH：FFMPEG_PATH/FFPROBE_PATH env 可覆写——media-process.service.ts:11-16）；`-show_entries stream_side_data=rotation` 命令形态被接受（rotation 读取法成立；带旋转视频 fixture 归 C0b E8 断言）。

## 7. 8 类产物绑定矩阵（代码勘证 2026-10-18）

服务端写点（writeNodeData 现役调用方）：ai-download（:85/:118 `{fileId,resultUrl}`）、lighting（:214 `{fileId}`）、ai-image-edit（:232 `{fileId}`）；stitch 事件链：execution.gateway :116-126 socket 携 `{fileId,url,width,height}` → useStitchTask.ts:71-74 客户端 spawnResultNode（**形态②客户端回环实证**）；videoEdit 导出：video-editor/export/upload.ts registerGeneratedMedia（形态③）；素材/标注/split：mediaUploadUtils（projectId 可选）。

| # | producer | 绑定形态 | 现状 wh 载体 | v6 探测法 | v6 写入 | 失败回落 |
|---|----------|---------|--------------|-----------|---------|---------|
| 1 | AI 生图/下载（ai-download） | ①已有节点 | 无 | probe worker | fileId op+natural op | fallbackSize |
| 2 | 光照（lighting） | ① | 无 | 同上 | 同上 | 同上 |
| 3 | 改图（ai-image-edit） | ① | 无 | 同上 | 同上 | 同上 |
| 4 | text 执行结果（execution {result}） | ①无 natural 类 | — | 不探测 | result op（type allowlist 拒 natural） | — |
| 5 | stitch | ②客户端新建+服务端事件 | socket 携 wh 回客户端 | 服务端生成侧已知 wh→直写 | natural op | 轮询兜底维持+attach |
| 6 | separate/trim（gateway 无 wh——基线 §1.4） | ② | **无** | C0b 补齐（生成侧/probe） | natural op | 同上 |
| 7 | 素材库/标注/split 上传 | ③客户端新建+上传 | confirm 仅 {fileId} | confirm 入队 probe worker | natural op（attach 绑定） | fallbackSize |
| 8 | 视频导出 videoEdit（registerGeneratedMedia） | ③ | 待 C0b 核（register 返回面） | probe worker ffprobe+rotation | natural op | 同上 |
| 9 | duplicate/paste/merge 副本 | ④复制派生 | 客户端 natural 写（v6 废止） | 无需 probe——**复制命令后自动 attach**（读源 Media.metadata） | natural op（attach） | 源无 fact→fallback |
| 10 | text/group/audio | 无 natural 类 | — | — | type allowlist 拒 | — |

**media 三场景现状缺口（对 Z7''-v6 三绑定洞）**：
- 新节点：presign 无 nodeId（§1.7 实证）→ 现无绑定——v6 presign nodeId 前置/attach 双路已设计；
- 副本：现无机制——**C0a 发现的 spec 补充项**：Z7''-v6 的「probe 完成后 fileId 扫描」只覆盖 probe 之后已存在的节点；**probe 已完成后创建的副本**须走 attach（复制命令自动调 `POST /projects/:id/nodes/:nodeId/media`）——spec 回填：复制命令（duplicate/paste/mergeStoryboard）在 addNode 后自动 attach；
- 替换：writeNodeData 无条件 set（无 CAS）→ 旧 probe 迟到覆盖实证路径成立——v6 read-check-write（stale-media）已设计。

## 8. placement 类型链编译 spike（type-chain-spike.ts）

四型（RawNodeRecord/DocNodeRecord/ProjectedRecord/CanvasStoreNode）+派生（toProjected 条件展开/toStoreNode position 兜底 {0,0}/toDocOrReject typed 拒绝）+ projectCanvasNodesV6 等价——**`tsc --strict --noEmit` PASS，全文件零 `as`**。

**结论**：G13 删 cast 路径可编译——「v5 前 projectCanvasNodes `as CanvasNodeRecord` 强转因 position 必填与 auto 组剥键冲突」的消除方案成立（ProjectedRecord position 可缺+cs 面 {0,0} 显式兜底为 RF 契约非 cast）。

## 9. 结论汇总与 spec 回填清单

| C0a 出口判据 | 结果 |
|--------------|------|
| 8 类矩阵+实测数据落盘 | ✅ 本文+scripts/c0a/ |
| guard 可行/不可行有结论 | ✅ 解析可行性达标（§3.6 v7——**部署档位降 shadow 默认**+post-apply 主路径；风险四条登记） |
| placement 类型方案定稿 | ✅ 四型链 strict 零 as 编译 PASS |
| rebalance 耗时/字节 | ✅ 10k≈56ms 预算内+先算后写必要实证 |
| 10k 投影 p95 | ✅ 18.7ms（G22 建议达标线 ≤30ms） |
| 增长曲线 | ✅ 线性本性实证+soft32/hard128 维持+降档变体可选项 |
| 并发父移动实验 | ✅ G17 红相可构造（混键 2/4 组合复现） |
| media 三场景 | ✅ 三洞现状确认+副本 attach 补充项 |
| probe 可行性 | ✅ sharp EXIF（交换自做）/limitInputPixels 默认拦/ffprobe rotation 可读 |

**spec 回填项（v6 微修——待用户确认后落）**：
1. §3.6 落 C0a 结论：**解析可行+shadow 默认**（v7 勘误——四条风险：私有结构/GC 时序/超阈帧早退/增量索引维护）；
2. Z7''-v6 副本补写补一句：**复制命令（duplicate/paste/mergeStoryboard）在 addNode 后自动 attach**（覆盖 probe 已完成后创建的副本）；
3. §2.2 增长曲线数据引用（本表）+「A2 可选降档变体（genHead 取 b0-1）」；
4. §2.4/§4 C0a 行出口达成标记；
5. A2 实现注意项两条：紧凑键字典序保序（均匀中点或长度感知编码）+ LWW 胜者=高 clientID（用例断言口径）。
