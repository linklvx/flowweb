# Y1c T0-S4 spike 结论：WAL 多项目 fsync 放大+恢复扫描（CollabProjectActor 原型基线）

- **日期**：2026-10-24（plan v1.7 Task 0 spike S4；spec v5.4 ⑱/偏离 38④⑦）
- **交付物**：
  - `apps/api/scripts/collab-wal-fsync-bench.ts`——actor 原型管线基准（submit/drain ≤20ms/1MiB 批→一次 fsync→逐帧 apply→逐帧 resolve；三拓扑 per-project/shard4/global；tsx 直跑）
  - `apps/api/src/modules/collab/wal-segment-format.spike.spec.ts`——段格式+恢复扫描原型 spec（主池 vitest 11 用例全绿；writer+scanner，T8/T13 继承格式测试）
- **性质**：SPIKE——零生产码改动。两文件各持一份段格式实现（spike 级有意冗余，T8 收敛单源）。本 spike 测 **I/O 拓扑**（fsync 放大/批延迟/恢复正确性），stub apply 只消费字节——Yjs apply 成本不在测量面（T33 分轴）。

## 0. 结论速览

| 验收 | 结论 | 处置 |
|---|---|---|
| (a) 10 项目×10 连接基线（actor 原型管线） | per-project p95=**13.92-14.08ms**（10s/30s 持续，默认线程池）——**≤20ms 判据未触发** | asserted（升级序不启动，rung 0） |
| 升级序对比（组提交→4-way 分片→全局 WAL） | 三拓扑实测：per-project 880 fsync/s、shard4 539、global 63（放大率 14×）；**shard4=本机双优解（时延+吞吐），global=吞吐下限+max 最差** | measured（见 §3 裁定+F-S4-2） |
| (b) 恢复扫描五验证 | ①坏 CRC 尾截断 ②gap 隔离 ③重复去重 ④historyId quarantine ⑤时间戳栅栏——**全过**+精确性总断言（无漏好帧/无收坏帧） | asserted-as-written |
| 格式决策喂 T8 | 段头 164B/帧记录 52B 头/crc32+SHA-256 双层/lastWriteAt 成对更新 CRC | §5（T8 移植面） |
| 发现 | **F-S4-1 libuv 线程池=进程内 fsync 串行化点**；F-S4-2 global 档在 SSD 类设备=回归；F-S4-3 批窗=上界非 dwell；F-S4-5 **时间戳栅栏作用域缺口（契约级，T8/T13 必须先钉）**；F-S4-6 lastWriteAt pwrite 必须成对更新段头 CRC | §6 |

**裁定**：**per-project 定形终态维持**（spec v5.3 定形、v5.4 ⑱补档位——本基线证实 10×10 不触发升级序）；4-way hash 分片=已测得证据的第一升级档（本机即双优，若生产 Linux 触发 p95>20ms 直跳该档的理由充分）；全局 WAL=新 ADR 档位且**在本机是回归方向**（见 F-S4-2）。无发现推翻 plan v1.7 主体；F-S4-5 是唯一契约级缺口。

## 1. 装置（actor 原型管线）

```
submit(projectId, frame) ──► per-project FIFO 队列 ──► 通道（拓扑决定通道数）
通道 drain 循环：凑批（自批内最老帧 ≤20ms ∧ ≤1MiB ∧ 空闲 1ms 即收）
  → 一次 WAL append（整批帧记录单 write）
  → 段头 lastWriteAt/CRC 成对 pwrite
  → 一次 fsync（FileHandle.sync()）
  → 逐帧 stub apply（crc32 消费字节+per-project 连号验证）→ 逐帧 resolve
```

- **拓扑**：per-project=每项目独立目录/log/writer/fsync（沿 spool `<owner>/<projectId>` 布局，10 通道）；shard4=`hash(projectId)%4`（crc32 取模，4 通道独立 writer/fsync）；global=单 log 单 fsync 流（升级序末档）。
- **负载**：10 项目×10 连接=100 并发提交者，**闭路 ACK 节流**（submit→await resolve→再 submit；无 think-time=持续满载；真实客户端可流水线发送——本口径测的是 ACK 路径时延，放大结论对负载形态不敏感）；帧 1-16KiB 均匀随机（内容池 64×16KiB 随机字节 subarray）；确定性 PRNG 按 (project,conn) 播种——三拓扑负载逐帧同分布（可比性）。
- **测量窗**：10s（预热 1.5s 剥离——通道水位快照法）；另跑 30s 持续窗验证稳定性。数据目录 `os.tmpdir()`。
- **平台注意（诚实记录）**：本机 **Windows 11 NTFS，node v24.14.1**——Node fsync=**FlushFileBuffers**（刷页缓存+元数据；与 Linux fsync 语义/时延不同，OS/磁盘写缓存仍可能吸收部分刷盘；NTFS 无 data=ordered 语义）。**生产=Linux ext4/xfs fsync——本文全部数字为拓扑对比性（同机同负载三拓扑横向），非绝对时延**；绝对预算（p95≤20ms 判据的生产裁定）须 T33 固定 runner 在 Linux 重跑本基准后落定。

## 2. 基线数字（真 fsync 真临时文件实测）

**表 1：默认 UV_THREADPOOL_SIZE=4，测量窗 10s（预热 1.5s 剥离）**

| 拓扑 | 通道 | fsync/s | 帧/fsync | KiB/fsync | MiB/s | P50ms | **P95ms** | P99ms | max ms | 最大排队 ms | 顺序 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| per-project（定形终态） | 10 | **879.6** | 10.0 | 85.5 | 73.42 | 11.85 | **14.08** | 15.97 | 19.91 | 0.98 | OK |
| shard4（升级档 1） | 4 | 539.4 | 25.0 | 213.9 | **112.70** | 7.87 | **8.02** | 9.40 | 16.05 | 0.80 | OK |
| global（升级档 2/新 ADR） | 1 | 63.0 | 100.0 | 854.9 | 52.59 | 15.60 | **17.63** | 17.98 | 29.81 | 0.97 | OK |

**表 2：UV_THREADPOOL_SIZE=16（fsync 走 libuv 线程池——默认 4 对 10 通道是排队点，见 F-S4-1），测量窗 10s**

| 拓扑 | 通道 | fsync/s | 帧/fsync | KiB/fsync | MiB/s | P50ms | P95ms | P99ms | max ms | 最大排队 ms | 顺序 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| per-project | 10 | 1240.1 | 10.0 | 85.6 | 103.67 | 7.96 | **10.19** | 12.00 | 15.85 | 1.13 | OK |
| shard4 | 4 | 509.3 | 25.0 | 214.0 | 106.45 | 7.89 | 8.03 | 9.86 | 14.02 | 0.77 | OK |

**表 3：per-project 30s 持续窗（默认线程池——「p95>20ms 持续」判据的持续时间维）**：fsync/s=906.8，吞吐 75.67 MiB/s，P50=11.71 / **P95=13.92** / P99=15.77 / max=22.02（单发尾部），最大排队 1.24ms，per-project 帧 min/max=28930/29180，顺序 OK。与 10s 窗一致（无漂移/无热衰减）——**持续判据不触发**。

**解读**：
- **fsync 放大是真实且可测的**：同等负载下 per-project 要求磁盘吸收 ~880-1240 次/s FlushFileBuffers，global 只要 63 次/s——**14-20× 次数放大**，正是 S4 要量化的对象。本机 SSD 类设备吸收无压力（放大未转化为时延超标）。
- **闭路动力学**：per-project 每批=该项目 10 连接的并发帧（~10 帧/85KiB/次 fsync），通道间并行 → 各自 RTT ~12ms；global 每批=全部 100 帧（~855KiB/次 fsync），单点串行 → RTT ~15.6ms 且 max 29.8ms。
- **公平性**：FIFO 通道下最大排队等待全程 ~1ms（三拓扑一致）；per-project 各项目帧数均衡（10s 窗 10050/10250）——零饥饿。
- **顺序验证**：三拓扑×三配置全部「每项目 applied idx 严格连号」——批内逐帧 apply 保序成立。

## 3. 升级序裁定

判据（plan v1.7 S4 原文）：**p95>20ms 持续 = 升级序启动（组提交调优→4-way hash 分片→全局 WAL=新 ADR）**。

1. **不触发**。per-project（定形终态）在本机 10×10 下 P95=13.92-14.08ms（10s/30s 双窗一致），即使 libuv 默认线程池 4 的不利配置也留 6ms 余量。rung 0（组提交）已由 actor 批内建——批凑窗语义见 F-S4-3。
2. **shard4 = 有实测证据的第一升级档**：本机同时拿下最低时延（P95 8.02ms）与最高吞吐（112.7 MiB/s）——4 通道恰在默认线程池内并行无排队。若生产 Linux 实测触发 p95>20ms，跳到该档的把握比「调组提交窗」大（本机数据显示批窗不是瓶颈维度——10 帧/批 vs 25 帧/批的差别被通道并行度掩盖）。
3. **global 档=方向性警示（F-S4-2）**：在本机它同时是吞吐下限（52.6 MiB/s）与 max 时延最差（29.8ms）——fsync 次数下降但单次字节升到 855KiB，把设备 flush 时间串行化。「减少 fsync 次数」只在设备 flush 操作次数是瓶颈（低 IOPS 云盘/HDD）时换来收益；SSD 类设备上全局 WAL 是回归。新 ADR 若真要走全局 WAL，须先在生产硬件证实「fsync 次数>单次字节」是主导约束。

## 4. 恢复扫描结果（spec：wal-segment-format.spike.spec.ts，10/10 绿）

| # | 验证 | 构造 | 实测结果 |
|---|---|---|---|
| ① | 坏 CRC 尾→截断 | 帧 3 载荷单字节翻转 | 前缀=[1,2]，defect=bad-crc，truncate(lastGoodOffset) 后重扫**零缺陷** |
| ①′ | 撕裂尾→截断 | 追加帧记录前 30B 半写 | 前缀=[1,2,3]，defect=truncated，截断后零缺陷 |
| ② | 缺号（gap）→隔离 | 帧 seq [1,2,3,5,6] | 前缀=[1,2,3]，defect=gap@5——**gap 后帧不进前缀** |
| ③ | 重复帧→去重 | (A) 旧 seq 同 hash 重放+(B) 新 seq 旧 hash | (A) 前缀=[1,2,3,4]（dup-seq 跳过不挡后续）；(B) 前缀=[1,2,3,5]（dup-hash 跳过并**消费 seq**——后续不失连续性） |
| ④ | historyId 不匹配→整段 quarantine | 段头 historyId=h-old ≠ SystemHistory | quarantined=history-mismatch，**零帧重放**；多段链 stoppedAt=隔离段（其后的段不重放——链断不可证明连续性） |
| ⑤ | 时间戳栅栏（忘 bump）→整段 quarantine | lastWriteAt=epochStart+5s（historyId 匹配——忘 bump 形态）；对照 lastWriteAt=epochStart-1s | 新于 epoch=quarantined=timestamp-fence 零帧；旧于 epoch=正常收养。**作用域缺口见 F-S4-5** |
| — | 坏段头 | magic 翻转/100B 短文件/头 CRC 翻转 | 全部 bad-header 整段 quarantine |
| — | 帧级撕裂 | frameHash 翻转+CRC 重算（骗过 CRC 网）/帧 generation≠段头 | hash-mismatch / generation-mismatch 各自隔离（前缀止于其前） |
| — | **精确性总断言** | 混合：[1,2,dup(1),3,5,6] | 前缀=**恰好** [1,2,3]：gap 前好帧零遗漏、坏帧/隔离帧/dup 零混入；lastGoodOffset=首个致命缺陷记录起点 |
| — | 双段完好 roundtrip | 段 0（gen 3, seq 1-3）+段 1（gen 4, seq 4-6） | 跨段重建全 6 帧，payload 逐字节等+frameHash 对，expectedNextSeq 链式传递 |

扫描器纪律：**首个致命缺陷即停**（坏记录之后的定界不可信——长度域可能同坏）；dup 类去重是仅有的「跳过后继续」路径（③）。

## 5. 格式决策（喂 T8——两份原型实现已按此收敛）

**段头（固定 164B，LE）**：

| offset | 尺寸 | 域 |
|---|---|---|
| 0 | 8 | magic `FWWALS1\n` |
| 8 | 2 | version u16=1 |
| 10 | 2 | headerSize u16=164 |
| 12 | 4 | generation u32 |
| 16 | 64 | projectId（utf8 zero-pad 定长——单读定界，超长拒绝） |
| 80 | 64 | historyId（utf8 zero-pad 定长——SystemHistory String 值直存） |
| 144 | 8 | createdAtMs u64 |
| 152 | 8 | **lastWriteAtMs u64（可变域——成对更新纪律见 F-S4-6）** |
| 160 | 4 | headerCrc32（覆盖 [0,160)） |

**帧记录（52B 头+载荷）**：`payloadLen u32 | crc32 u32 | walSeq u64 | generation u32 | frameHash 32B(SHA-256) | payload`。

- **CRC 选择**：帧/段边界用 **zlib crc32**（沿现 spool `[4B len][4B crc32]` 格式先例——撕裂/损坏定界）；身份/去重用 **SHA-256 frameHash**（帧记录内存 hash——喂 T8「帧记录存 frameHash+启动重建有界去重索引 24h/100k」）。双层不混：CRC 管损坏、hash 管身份。
- **帧 CRC 覆盖域含帧头字段**（walSeq‖generation‖frameHash‖payload）——帧头撕裂同样落 CRC 网（只盖载荷会漏 walSeq 撕裂→误报 gap）。
- **lastWriteAt 成对更新**（F-S4-6，首跑实测红）：每批先 pwrite lastWriteAt（152）再 pwrite 重算的 headerCrc（160），一次 fsync 覆盖——只写时间戳不写 CRC=**自毁段头**（头 CRC 覆盖 0..159 含 152 域）。
- **dup 语义三分**：旧 seq 同 hash=良性重放跳过；旧 seq 异 hash=seq 被改写重用→隔离（不可去重）；新 seq 旧 hash=重复内容→跳过并消费 seq。gap/异 hash 重写/generation 不符=隔离（前缀止步）。
- **多段链（停链判据定形）**：按段序扫描+expectedNextSeq 链式传递+**跨段去重状态共享**（seq→hash/seenHashes——段 N+1 重放段 N 的帧须判良性 dup 而非「seq 改写」）；**仅 quarantine 或致命缺陷（truncated/bad-crc/hash-mismatch/generation-mismatch/gap/异 hash 的 seq 重写）停链，良性 dup（同 hash 旧 seq 重放/新 seq 旧 hash）不停链**——崩溃重试天然产生跨段重复，按「任一缺陷即停」的保守读法会误隔离健康链；链级测试锁定（段 1 首帧重放段 0 帧 2 ⇒ 前缀跨三段 [1..6] 全收养、stoppedAt=null）。
- **新建段纪律（T8 原文「新建段 fsync 文件+目录」）**：段头写入后、接受首帧前 `fsync(文件)+fsync(父目录 fd)`——目录项不落盘=崩溃后整段文件可能消失（帧 fsync 白搭）。Windows 不可对目录句柄 fsync（原型/bench 未做——一次性成本不在稳态测量面，注释如实标注）；**T8 生产（Linux）必须补 fsync(dirfd)**。
- **坏段分类码**（T8 四档对齐+扩展）：`truncated/bad-crc/hash-mismatch/gap/dup-seq/dup-hash/generation-mismatch` + 段级 `bad-header/history-mismatch/timestamp-fence`。

## 6. 发现登记

- **F-S4-1（T9/T29 实现约束）**：fsync 走 libuv 线程池（**默认 4**）——per-project 的 10 通道并发 fsync 在进程内先排队于线程池：UV_THREADPOOL_SIZE=16 使 per-project P95 14.08→10.19ms、吞吐 73→104 MiB/s（shard4 不敏感——4≤4）。**放大拓扑的真实约束先出现在线程池而非磁盘**。T9 落地须显式定 UV_THREADPOOL_SIZE≥通道数（或专用 fsync lane）；T29 生产前置核对。
- **F-S4-2（升级序方向性）**：全局 WAL 在 SSD 类设备=吞吐下限+max 时延最差（fsync 次数↓但单次 855KiB 串行化设备 flush）。升级序末档只在「flush 次数>单次字节」为主导约束的设备（低 IOPS 云盘/HDD）有意义——新 ADR 前置条件。
- **F-S4-3（批窗语义）**：「≤20ms 批窗」必须是**上界**（凑批时 1ms 空闲即收批），不能是 dwell（空闲也等满 20ms）——否则每帧时延恒 ≥20ms，p50 违反预算 by construction。原型语义：`批窗（自最老帧 20ms）∨ 1MiB ∨ 空闲 1ms` 三条件收批；T9 移植时保留三条件形态（组提交调优=调这三档）。
- **F-S4-4（公平性）**：FIFO 通道零饥饿（最大排队 ~1ms，per-project 帧数均衡）——多项目共享通道（shard4/global）无项目被饿。
- **F-S4-5（契约级缺口，T8/T13 必须先钉）**：**时间戳栅栏 `lastWriteAt>epochStartedAt` 的求值作用域在 spec v5.4/plan v1.7 中未定义，且按字面无法区分正常重启与忘 bump 恢复**：长命 epoch 下全部在役段恒满足 lastWriteAt>epochStartedAt（epoch 起点早于一切在役写入）——若每次恢复都求值，正常崩溃恢复将隔离整个在役 WAL（「崩溃恢复从 pgSeq 重放」结构性失效）；若只在恢复怀疑态求值，触发条件（restore.lock marker？SystemHistory 行新旧？PG 水位 vs WAL 水位倒挂？）未写。本 spike 验证的是**谓词本身+fail-closed 方向**（整段隔离/零帧重放/链止）——与 plan T13「段比 epoch 新→quarantine」场景形态一致；**T8 落地前必须补钉求值作用域**（候选：仅 restore.lock marker 在位或 PG pgSeq 水位倒挂于 WAL 段时进入栅栏求值；或 epochStartedAt 语义改为「本进程代起点」并接受跨重启全隔离+`--adopt-wal` 人工通道——后者操作上不可接受，前者推荐）。
- **F-S4-6（格式纪律）**：段头携带可变域（lastWriteAt）⇒ 每批 pwrite 必须（时间戳，CRC）成对——首跑红实证（只 pwrite 时间戳=头 CRC 自毁，恢复扫描全部 bad-header）。已写入 §5 格式决策。

## 7. 运行结果

```bash
# 基准（全拓扑 10s+预热 1.5s）
pnpm --filter @flowweb/api exec tsx scripts/collab-wal-fsync-bench.ts --seconds 10 --warmup 1.5
# 线程池敏感性
UV_THREADPOOL_SIZE=16 pnpm --filter @flowweb/api exec tsx scripts/collab-wal-fsync-bench.ts --seconds 10 --topologies=per-project,shard4
# 持续窗
pnpm --filter @flowweb/api exec tsx scripts/collab-wal-fsync-bench.ts --seconds 30 --topologies=per-project
# 恢复扫描 spec（主池）
pnpm --filter @flowweb/api exec vitest run src/modules/collab/wal-segment-format.spike.spec.ts
```

- bench：三配置全部正常退出，顺序验证 OK（输出表即 §2）。
- spec：**11/11 绿**（115ms；纯 fs+os.tmpdir 真文件+真 fsync——含链级停链判据用例）。
- `tsc -p tsconfig.scripts.json --noEmit`：零错误（bench+两 spec 均在 scripts 工程类型面内）。
