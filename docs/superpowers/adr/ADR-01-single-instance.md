<!-- doc-status: active | verified_at: 2026-10-24 -->
# ADR-01：单实例 ADR（instances:1）与 WAL 帧协议升级

- 日期：2026-10-24（Y1c Task 8）
- Status: Accepted
- 消费面：`apps/api/src/modules/collab/collab-spool.service.ts`（帧协议升级落点）；冻结契约
  `packages/shared/src/collab/doc-protocol.ts` §5（WAL 段头/帧记录/坏段四档/fsync 分档——本 ADR 消费禁重抄）；
  spike `apps/api/src/modules/collab/wal-segment-format.spike.spec.ts`（格式验证语义的实证来源）
  与 `docs/superpowers/spikes/y1c-t0-s4-wal-actor-baseline.md`（格式决策+基线数字）。

## Decision

### 1. instances:1 复杂度边界（非 HA）

collab 写路径（WAL spool→PG）按**单实例**设计：同一时刻至多一个写者进程持有租约
（CollabLease，`collab-lease.service.ts`——owner 子目录隔离+fencing 先例已在役）。明确不承担：

- 多活写入与跨实例 WAL 一致性；
- WAL 的跨节点复制/仲裁（无 quorum、无共享耐久日志）；
- 实例级故障的自动接管（前任残留段走 P18 boot 收养/隔离路径，非热切换）。

这不是永久承诺而是**复杂度预算**：当前规模下单实例+快速重启恢复的可用性账目优于分布式 WAL
的工程成本。越界即触发第 4 节前置条件。

### 2. 单写者

唯一写者=当前 CollabLease 持有者（`spool.setOwner` 后写路径才开——Z13 fail-closed）。
WAL 段按 owner 子目录分 namespace，fenced 前任物理上写不进新 owner 的段（撞名不可能）。
帧的 walSeq（per project）由**内存计数器**分配——正确性依赖单写者不变量；崩溃后由恢复扫描
（第 3 节）从段内容重建，不依赖跨实例协商。

### 3. 重启恢复顺序（WAL→PG 前缀校验→重建 appliedSeq→开放写）

次序冻结，前一步未裁定不进下一步：

1. **WAL 恢复扫描**（`recoverScan`）：逐段段头栅栏（historyId 每次恢复必查；时间戳栅栏仅
   恢复怀疑态求值——见第 5 节）→帧级完整有效前缀重建（坏段四档分类：crc/truncated/
   missing-seq/dup-hash，见 `WalBadSegmentTier`）→无效尾部截断/隔离。
2. **PG 前缀校验**：**WAL 损坏只允许丢 walSeq>pgSeq 的帧**。致命缺陷停点处的链尾序号
   lastGoodSeq<pgSeq ⟺ 存在 PG 已提交（≤pgSeq）而 WAL 无法证明的帧=账本失真——该段
   整段隔离保证据+violation 上报，禁静默截断续跑；丢的全部是 walSeq>pgSeq 的帧
   （从未对外承诺 Durable）才允许截断续跑。
3. **重建 appliedSeq**：以恢复扫描的有效前缀+pgSeq 输入重建水位三元
   （`WatermarkTriple`：0≤pgSeq≤appliedSeq≤spoolHeadSeq，`assertWatermarkInvariants`）。
4. **开放写**：水位重建完成+去重索引（有界：24h TTL/100k 条——`WAL_DEDUP_INDEX_*`）
   重建后才受理新帧。

### 4. 扩容=独立批前置条件（不做渐进多写）

升到多实例/全局 WAL 之前必须先落地（缺一即不允许扩容，升批=独立评审）：

- **共享耐久日志**：WAL 脱离单机盘（跨节点可访问的耐久介质或逐节点日志+仲裁合并）；
- **所有权租约**：per-project 写所有权可迁移且有时限（现 CollabLease 是进程级，非 per-project）；
- **fencing**：帧携带单调 fencing token，存储侧（PG+日志）拒绝旧 token 写入
  （现 fencing=owner 子目录隔离，只防撞名不防旧写者复活提交）。

升级序（拓扑演进，spec v5.4/S4 基线裁定）：per-project 定形终态（现状）→4-way hash 分片
（有实测证据的第一升级档）→全局 WAL（新 ADR 前置条件，本 ADR 不授权）。

### 5. 时间戳栅栏求值作用域（F-S4-5 定形）

spike 发现（c5a3e383）：长命 epoch 下全部在役段恒满足 lastWriteAt>epochStartedAt——按字面
每次恢复求值=正常崩溃恢复全被隔离成空 WAL（「从 pgSeq 重放」结构性失效）。定形三节：

- **求值作用域**：时间戳栅栏**仅在恢复怀疑态求值**（`shouldQuarantineSegment` 的
  `evaluateTimestampFence` 门控）：恢复怀疑态=restore.lock marker 在位**或** PG pgSeq 水位
  倒挂于 WAL 段（PG 声称的 pgSeq 超过 WAL 可证明的链尾）。正常崩溃恢复（两信号皆无）
  不求值时间戳栅栏——段比 epoch 新是长命 epoch 的常态。historyId 栅栏不受作用域门控，
  每次恢复先查。
- **求值基准快照与 bump 竞态**：epochStartedAt/historyId 在恢复扫描**入口一次性快照**
  （调用方自 `requireSystemHistory` 读 SystemHistory 单行传入——canvas-doc-head.ts
  fail-closed 读面），扫描期间不重读。恢复扫描发生在 boot 前置（listen 之前）且单写者
  不变量成立 ⇒ 扫描期间无并发写者；扫描期间发生 bump（运维工具并发触发）= 不支持形态
  ——快照与盘上段头可能错拍，处置归 `--adopt-wal` 窄窗（historyId 已匹配+operator 显式
  确认+审计三条件缺一不可），不自动修复。
- **时钟源**：写侧服务器钟（`Date.now()`——lastWriteAt 写入与栅栏比较同一时钟域）。
  同机时钟偏移可接受（fail-closed 方向正确：偏移只会多置 recoverySuspect 不会漏）；
  跨机比较（未来共享日志形态）须换单调逻辑钟，届时升第 4 节前置批一并定。

触发后的处置=修正 #6 两维分派（`WalSegmentQuarantineResult`）：时间戳栅栏→
**recoverySuspect 恢复怀疑态**（自动扫描零帧重放；重放与否归恢复流裁定——RESTORED_READONLY
路径，非静默丢段、非 quarantine）；historyId 不匹配→整段 **quarantine fail-closed**（零帧重放）。

### 6. fsync 分档/坏段四档/换代切段（引用面）

- **fsync 分档**（`WAL_FSYNC_TIER_SEMANTICS`）：写前失败/ENOSPC=可恢复档——截断回
  last-good offset+**复用已分配未落盘 walSeq**（不留洞）+fail-closed 停收；截断本身失败=
  quarantine 段+拒服务。EIO=fail-stop——walHealthy=false/停收/close 1011
  （`CollabCloseCode.WAL_FSYNC_EIO`）/要求进程重启+磁盘检查；**不进截断复用路径**；
  `wal_fsync_error_total{device}` 告警不自动重试。
- **坏段四档**：帧级 granular 缺陷码（`WalDefectKind`）经 `walDefectTier` 穷尽映射到
  crc/truncated/missing-seq/dup-hash 四档（分类码单源在契约——实现禁散写字符串）；
  良性 dup（旧 seq 同 hash/新 seq 旧 hash）跳过不停链，致命缺陷即停链（坏记录后的
  定界不可信）。
- **换代切段**：换代（含 vacuum）=WAL 段 namespace 切代（段文件名携带 g<generation>
  +段头/帧内 generation）+旧段 quarantine（sidecar 整段隔离记录，重启扫描按 sidecar
  识别=禁重放）+水位与去重索引重置。
- **新建段 fsync 纪律**：段头写入后接受首帧前 fsync(文件)+fsync(父目录)
  （F-S4-6：lastWriteAt pwrite 必须与段头 CRC 成对更新）。

## Consequences

- 恢复扫描是写路径开放的前置步骤——扫描预算有界（多段链式+每段完整前缀），超预算=不开放写。
- 崩溃语义升级：确认集丢失不再是唯一降级面——恢复扫描按 walSeq/pgSeq 前缀关系裁定帧的
  去留，重复回灌由去重索引+CRDT 幂等双防线吸收。
- T9（actor 管线）/T13（恢复流接线）消费本 ADR 的恢复顺序与两维分派；本卡（T8）交付
  协议与扫描器本体，旧 store 链（gateway onStoreDocument→debounce→PG）行为不变直至 T9。
