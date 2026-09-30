# 技术债务台账

> 用途：集中登记 P2 及以下技术债，供下次集中修复时挑选任务。
> 约定：每项含【来源】【现状核查日期】【修复方向】；完成一项移入文末「已清账」并注明 commit。
> 新债发现时随手追加，修复前先核查现状（文件/行为可能已变化）。

最近核查：2026-10-01

## 前端（apps/web）

### TD-8 软删 Media 行的 MinIO 对象回收

- **来源**：canvas-create-unify-fix spec 明示「不会自愈」；TD-11 修复前已删节点泄漏的 MinIO 文件；localStorage 脏数据部分已随 3c 基线重构清账（v2 版本化快照 + 旧 key 一次性清扫）
- **现状**：无生产用户；TD-15 方案 B 落地后画布侧不再产生孤儿，唯一孤儿来源 = 库内软删（deletedAt）行的 MinIO 对象
- **处置**：上线前评估（D2 裁定维持）；届时按下述 checklist 逐项回答后再定方案
- **评估 checklist**（上线前逐项回答）：
  1. **引用安全（阻塞项）**：`getMediaUrl` / 画布渲染 / 历史记录查询是否过滤 `deletedAt`？软删行的 fileId 是否仍可能被画布节点引用？若不过滤，物理清扫会直接弄坏画布上的图
  2. **N 值**：软删后多少天物理回收？需产品输入（建议 30 天起步）
  3. **DB 行处理**：物理删 MinIO 对象后，Media 行是硬删还是保留为悬空标记？
  4. **存量对账**：DB media 全量 vs MinIO listing 对账脚本（服务端脚本域，有真实数据后写）
  5. **实现形态**：temp-cleanup.processor（apps/api/src/modules/temp-cleanup/）扩展软删清扫条件（`deletedAt < now() - N`）

## 后端（apps/api）

## 数据 / 部署

## R1c 立项要件（2026-09-30 collab 恢复工程登记——master plan 裁决本轮不实施）

> 来源：`docs/superpowers/plans/2026-09-30-collab-recovery-master-plan.md`「R1c 登记」节（全工程闭环时留档，登记日=现状核查日）。R1c 立项时整块取用；动手前逐项重核现状（文件/行为可能已变化）。

### TD-17 编辑器数据双轨 ADR（F10）

- **来源**：collab spec v5.10 F10——视频编辑器数据在 editorStore（本地 autosave）而画布走 doc 协作，双轨并存
- **修复方向**：R1c 立项时裁决「入 doc vs 本地持久化」；入 doc 前置 = canvas_doc payload 体积量化
- **弃用触发条件（第九轮评估）**：R1c 立项被否决时，批 0d 五件套（autosave 单向 latch/beforeunload/handleClose 三选等）升级为长期件并重新设计——防「过渡」变「永久」

### TD-18 同步执行统一入队（execute 内联 → 全走队列，F13）

- **来源**：collab master plan 批 0.5 F13 登记；第十轮评估提级
- **定性**：同步路径恢复语义残缺的**根因**——队列路径有 stalled 可重入 claim 恢复、同步路径永远只能等 15min 三查判死；两套恢复语义长期并存的根源在此，非单纯一致性美化
- **修复方向**：execute 内联改全走队列；含前端 await 契约变更（超出批 0.5 范围故未做）。现状无资损（三查判死已闭环恢复语义）

### TD-19 y-indexeddb 立项要件 +2

- **来源**：collab master plan R1c 登记
- **要件**：在既有要件之上追加 tombstone 清理 / 多标签协调两项

### TD-20 意图表+客户端意图记录 = R1c 一半地基（B8）

- **性质**：非债务——批 0.5 已落地（GenerationIntent 表 + `apps/web/src/utils/intentRecord.ts`）；登记目的是 **R1c 立项时防重做**

### TD-21 socket.io 分两步退役

- **来源**：批 1 末评估（前移）+ 批 5 冻结确认；结论文档 `docs/superpowers/plans/socketio-retirement-assessment.md`
- **结论**：已死 1（execution:complete 零消费）+ 活 23（node:status 17 主路径 dual-write 已落；trim/separate/stitch 6 唯一通道、web 轮询兜底在）。保留 + 冻结分两步退役：trim/separate/stitch 补 6 个 writeExecStatus 写点后切 doc；包级移除被 /payment gateway 阻塞（另立评估）

### TD-22 多实例退避协调（F12）

- **来源**：collab spec F12；批 7 已落恢复风暴观测（10+ 并发重连 + collabDiagnostics 突刺计数）——先观测后谈 shed
- **修复方向**：多实例部署时客户端恢复退避的跨实例协调

### TD-23 配对式看门狗 R3

- **来源**：collab spec R3 登记
- **修复方向**：批 1 已落单实例 watchdog（connectionMachine 3s tick + 恢复门）；配对式（进程对互监）属 R3 域

### TD-24 Throttler trust proxy / tracker

- **来源**：批 0c-8 注记（app.module.ts 代码注释同步登记）
- **修复方向**：生产部署前 `app.set('trust proxy', 1)` 或 throttler 自定义 tracker——反代后 `req.ip` 全是代理 IP，300/min 会退化成全站共享单桶

## 集中修复建议批次

1. ~~**第二批（测试卫生）**：TD-9~~ ✅ 已完成（2026-08-21，3bcd50c）
2. **第三批（结构/上线）**：~~3a: TD-11~~ ✅ 已完成（2026-08-21，5584864）→ ~~3b: TD-10~~ ✅ 已完成（2026-08-21，d2cae05）→ ~~3c: TD-5/6/8~~ ✅ 已完成（2026-08-21，8be333a）→ ~~3d: TD-4~~ ✅ 已完成（2026-08-21，8397472，第三批全部收官）
3. ~~**随手清**：TD-3、TD-7、TD-12、TD-13、TD-14、TD-15、TD-16~~ ✅ 全部完成（2026-08-21/22，第四批 a20bab1/c939c20/c43ccc0/de9b744/257d86b；TD-15 于 08-22 方案 B 收口）

## 已清账

| 项目 | 完成日期 | Commit |
|---|---|---|
| 117 个 TypeScript 类型错误（阻断 `tsc -b` 构建） | 2026-08-20 | e42863f |
| StrictMode 双创建（首页一次点击建 2 个画布） | 2026-08-20 | 3151d51 |
| TD-2 allImages 双轨统一（根级）：useImageUpload/VideoConfigPanel/deleteRefs 三读取方迁移 + 测试基建修正 | 2026-08-21 | 7a62eb2 / bdf8fdd / 4af7834 |
| TD-1 projectId 硬编码（实际 15 处非台账原记 5 处，含 syncNodes/syncEdges 位置参数形式漏报；修复带节点画布生成 500 阻断） | 2026-08-21 | e82cf36 |
| TD-9 既有测试失败 9 例（5 文件，全部为实现演进后断言/mock 过时，零实现回归；结构性根因另立 TD-14） | 2026-08-21 | 3bcd50c |
| TD-11 删除链路三层断裂：remove 接线（三件套+DB 同步）+ videoGen/audioGen 清理分支（生成 fileId 不删，D1）；存量泄漏处置见 TD-8 / 3c；衍生 TD-15/TD-16 | 2026-08-21 | 5584864 |
| TD-10 Prisma migrate 历史断裂（基线重置为单一 init，沙箱重放自证；部署流程固化于 deployment-db-baseline.md；遗留：本地 `migrate dev` 需用户一次性执行 `ALTER ROLE flowweb CREATEDB`） | 2026-08-21 | d2cae05 |
| TD-5/6 localStorage 持久化合一：单一版本化快照 `flowweb_canvas_v2_${pid}`（nodeStore 数据权威 + 视图派生恢复 + isHydrating 抑制单写者 + 旧 key 一次性清扫）；TD-8 localStorage 部分随清，余 MinIO 对账 | 2026-08-21 | 8be333a |
| TD-4 慢请求覆盖窗口收口：写侧抑制（3c isHydrating 单写者，8be333a）+ 读侧遮罩封交互（isHydrating 全屏遮罩挡指针 + CanvasKeyboardHandler 首行守卫封键盘，浏览器 2s 慢 fetch 实证窗口内零交互零写入） | 2026-08-21 | 8be333a / 8397472 |
| TD-3 isSaving 死写入+类型删除；TD-7 nodeData 竞态空白换 Spin 占位（role=status）；TD-16 useReactFlowSync 死代码删除 | 2026-08-21 | a20bab1 |
| TD-12 PromptValue.allImages 僵尸字段移除：54 处锚点 mock 迁移（8 文件）+ PromptInput 类型化字面量/断言同步 + 产品侧双 ConfigPanel 嵌套写入点清理 + mergeImageRefs 参数与 PromptValue 解耦（legacy 兼容读取保留） | 2026-08-21 | c939c20 |
| TD-14 spec 编译安全网：tsconfig.spec.json（vitest/globals types）接入 test script 前置 tsc；清零 13 处潜伏类型错误（S2 单独清零 commit c43ccc0） | 2026-08-21 | c43ccc0 / de9b744 |
| TD-13 三分支覆盖补齐：interceptor @NoTransform 直通不包装 / sms SendStatusSet 非 Ok 拒绝（含状态码透传与 SMS_SEND_REJECTED 兜底）/ file controller type 非空过滤透传 | 2026-08-21 | 257d86b |
| TD-15 双实证（断路+埋雷，b3eafad）→ 方案 B 收口：移除 6 处死调用（deleteNode 四分支 + useImageUpload）固化「画布删除不触文件清理」语义——Media 行是素材库/历史资产（软删为产品语义）、生成结果不随节点删除（TD-11 D1 扩展至 imageGen/trim）；mergeImageRefs 随调用方退役 | 2026-08-22 | b3eafad / a25f286 |
