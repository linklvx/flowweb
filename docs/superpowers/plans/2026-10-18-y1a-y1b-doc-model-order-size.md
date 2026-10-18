# Y1a+Y1b：doc 模型 v3·序与尺寸/只读 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

<!-- plan v2（2026-10-18）：依据 spec v7（`docs/superpowers/specs/2026-10-18-y1a-y1b-doc-model-order-size-design.md`·§1.8 一手复核版）+ C0a spike 数据（v7 勘误版）。v1 废止（三份外审坐实七类代码落点实错：DocNodeRecord 同名 172 处/循环 import/BullMQ 冒号 jobId/getObjectBytes 不存在/storage.module 无 registerQueue/AI 产物不入队/reset 拓扑——全文见 git 历史）。v2 变化：**新增 P0-pre 机械前置片**（类型改名/纯模块抽取/队列装配/probeState 契约——零行为变更出口）；**B1a 必做**；序键生成器换 **integer-part 移植**（G29 append-only 硬验收）；probe=状态机+**7 处 media.create 全路径入队**+复用 MediaProcessService；fileId/natural=expectFileId 全 op CAS+strip 四点+bindMedia 单事务；维护=in-place freeze+orderEpoch；guard=shadow 默认+post-apply 主路径；reset=九步脚本（maintenance mode/队列 pause/DEPLOY_EPOCH/备份）；D6 改形 data.autoOrigin 移 B2；G14 repair CLI 补承载（T24）。 -->
<!-- 执行纪律核心（v2 新增）：plan 中每个被调用的 API/类型/DI 令牌/进程形态，写码前 grep 实证——v1 七类实错全因引用「应该存在」而非「实证存在」的接口。行号=2026-10-18 快照。 -->

**Goal:** 落地 doc 模型 v3——placement 复合单键序域（integer-part 分数索引）+natural 服务端权威事实（probe 状态机全路径）+只读命令边界（B1a 必做）+reset 九步脚本，批出口=verify 全绿+G1-G35 门禁+旧 csv/schema 拒连+reset 两轮零回灌。

**Architecture:** P0-pre 机械迁移（StoredNodeRecord/ProjectedRecord 改名+collab-doc-ops 纯模块+队列装配+probeState 契约）→C0b 服务端事实写（bindMedia 单事务+CAS 全 op+strip 四点）→B1a 命令门→A1 placement 契约（allocator doc 写边界+37 调用点）→A2 序域（integer-part 生成器+orderRecords 三面+in-place 维护+guard shadow）→A3 harness→B1/B2/B3。doc 唯一真源；store 投影；服务端事实整值单键客户端零写。

**Tech Stack:** TypeScript strict / Yjs 13.6.32（**pin**）/ Hocuspocus 4.6.0 / NestJS + BullMQ 5.75.1（独立 worker 进程）/ sharp 0.34.5 / ffprobe 8.1.2 / vitest / node:test。

**执行纪律：**
- 每卡先红（真实变红输出留档）→绿→commit；前缀按域 `feat(collab)`/`feat(web)`/`feat(shared)`。
- **代码落点实证纪律（v2）**：调用任何 API/类型/DI 令牌前 grep 实证存在性与形态；发现漂移按 spec §0.4 偏离登记。
- 三个 tsc 面每片出口全跑；测试运行（注意 cwd=包根——Bash CWD 持久陷阱）：shared/api/web 各 `pnpm --filter <pkg> exec vitest run <file>`。
- C0a 复用：T20 生成器=新移植（v1 的 order-key-growth 中点实现**废止**——仅留 property 手法）；T22 guard=guard-prototype.mjs 五机制移植为 shadow 引擎；rebalance 手法=先算后写+partial 实验。
- 文档纪律：spec/plan 覆写先 diff；任务勾选同步。
- 每片出口用户确认（B1a 必做不再是可选）。

## 文件结构（触碰面全景·v2）

| 文件 | 动作 | 责任 | 片 |
|---|---|---|---|
| packages/shared/src/canvas/docShape.ts | 改 | **T1 改名**：`DocNodeRecord`→`ProjectedRecord`（+order?）+新 `StoredNodeRecord`/内部 `RawNodeRecord` | P0-pre |
| 全仓 34 文件 172 处引用 | 改 | **T1 机械改名**（sed 级+fixture 更新——零行为） | P0-pre |
| apps/api/src/modules/collab/collab-doc-ops.ts | **建** | applyWriteOpsToDoc/applyOpsCore/rejectionsOf/全部原语——纯函数零 Nest import（**破 writer→document 环**） | P0-pre |
| apps/api/src/modules/collab/collab-document.service.ts / collab-doc-writer.service.ts | 改 | import 改自 collab-doc-ops（两 service 零环） | P0-pre |
| apps/api/src/modules/storage/storage.module.ts | 改 | +BullModule.registerQueue('media-probe')（**producer API 侧**——现无注册实证） | P0-pre |
| apps/api/src/worker.module.ts | 改 | +probe processor 平铺 providers（Nest imports 单向——导入方 provider 不可见） | C0b |
| apps/api/prisma/schema.prisma + migration | 改 | Media 增 probeState/probeAttempts/probeError/naturalWidth/naturalHeight/naturalRotation | P0-pre |
| packages/shared/src/canvas/natural-fact.ts | **建** | NaturalFact/isValidNaturalFact/SERVER_ONLY_DATA_KEYS | C0b |
| packages/shared/src/canvas/canvas-doc-manifest.ts | 改 | SERVER_NODE_DATA_KEYS 扩 natural/ValueSpec 逐键+exemptValueKeys/expectFileId op 字段/表驱动+Object.hasOwn | C0b |
| apps/api/src/modules/collab/collab-media.controller.ts | **建** | attach 用户面（AuthGuard+perm.assertEditor——非 worker token） | C0b |
| apps/api/src/modules/collab/collab-media.service.ts | **建** | bindMedia 单事务+attachMedia（校验+补写两列+queued 承诺） | C0b |
| apps/api/src/modules/media-process/media-process.service.ts | 改 | +detectNatural（图片 EXIF 1-8/视频 rotation 负角归一——复用现有 ffprobe/sharp 基建） | C0b |
| apps/api/src/modules/media-probe/ | **建** | MediaProbeService.enqueue（7 处收口）+processor（sweeper/临时文件/MIME 嗅探） | C0b |
| apps/web/src/stores/canvasIntents.ts / canvasStore.ts / nodeStore.ts / copyPlan 消费 | 改 | strip 四点/命令门/判别联合/allocator/复制自动 attach | C0b/B1a/A1 |
| packages/shared/src/canvas/placement.ts | **建** | Placement/ORDER_KEY_RE/toProjected/toDocOrReject/DOC_NODE_KEYS | A1 |
| packages/shared/src/canvas/validate-node-record.ts | **建** | validateNodeRecord（整记录）+validateNodePatch（partial——两函数分职） | A1 |
| packages/shared/src/canvas/normalize-for-seed.ts | **建** | normalizeForSeed **五路径**（含 vacuum :629） | A1 |
| packages/shared/src/canvas/order-key.ts | **建** | **integer-part 移植**（generateKeyBetween/generateNKeysBetween+key-too-long typed+测试向量） | A2 |
| packages/shared/src/canvas/order-records.ts | **建** | orderRecordsStrict/Total/orderRecords+**参考模型对拍** | A2 |
| packages/shared/src/canvas/geometry.ts / arrangeSelection.ts / assertions.ts / docShape 键集表 / renderCanvas.ts | 改 | 空间序 tie-break/autoOrigin 改形/三面收编 | A1/A2/B2 |
| apps/api/src/modules/collab/collab-doc-registry.service.ts | 改 | loadDocument rebalance（保序+purpose gate 全调用点+预算门）+guard shadow 挂载+post-apply 检测 | A2 |
| apps/api/src/modules/collab/collab-content-guard.ts | **建** | shadow 引擎（C0a 五机制移植）+post-apply 检测 | A2 |
| apps/api/src/modules/collab/collab-maintenance.service.ts | **建** | in-place 维护窗（freeze/epoch/persistence 收敛） | A2 |
| apps/api/src/modules/collab/collab-repair.cli.ts（scripts/） | **建** | repair-doc-order CLI（G14——四形态扫描+维护窗重分配） | A2 |
| apps/web/src/utils/projectCanvasNodes.ts / video-work snapshot-filter.util.ts / video-work-clone.service.ts | 改 | ProjectedRecord 化（六消费者零语义变）+三面 orderRecords | A1/A2 |
| apps/web/src/stores/canvasCollabRuntime.ts | 改 | applyDocToStore 层序+catch 结构档+applyIntrinsicFit+epoch fence | A2/B1/B2 |
| apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx / VideoGenNode.tsx / MultiImageNode.tsx | 改 | **组件级迁移**（删 contentEventSize 调用点前先改——v1 缺口） | B2 |
| apps/web/vitest.config.node-canvas.ts | **建** | A3 harness node config | A3 |
| apps/api/src/modules/collab/collab-maintenance-mode.ts（或 gateway 域） | **建** | 持久 MAINTENANCE_MODE（Redis/env——写 503 门） | B3 |
| scripts/reset-canvas-v3.mjs | **建** | reset 九步脚本（--dry-run/--execute+备份+epoch） | B3 |

**不动红线**：NODE_ENVELOPE_KEYS；`HttpCollabWritePort.writeOpsBatch/writeNodeData` 防退款语义（probe 走新 strict 面）；exec 域写面；ecosystem 双进程拓扑。

---

## 片 P0-pre：机械前置（T1-T4——零行为变更，出口=三面 tsc 绿+全量测试绿）

### Task 1: DocNodeRecord→ProjectedRecord 机械改名+StoredNodeRecord/RawNodeRecord 三型落位

**Files:**
- Modify: `packages/shared/src/canvas/docShape.ts:378`（改名+新两型）
- Modify: 全仓 34 文件 172 处 `DocNodeRecord` 引用（grep 清单先行）

- [ ] **Step 1: 引用面清单落盘**——`grep -rl "DocNodeRecord" --include="*.ts" packages apps` 输出存 `docs/superpowers/plans/` 执行附件（执行期勾选）。

- [ ] **Step 2: docShape.ts 类型改造（语义零变）**

```ts
// :378 现名改 ProjectedRecord（字段不变+order 派生位预留——本片不加语义）
export interface ProjectedRecord {
  id: string; type: string; parentId?: string | null;
  /** A2 派生位：placement.order 投影（本片恒 undefined——占位禁用） */
  order?: string;
  position?: { x: number; y: number }; width?: number; height?: number;
  data: Record<string, unknown>;
}
/** 兼容导出（本片内逐步消亡——P0-pre 出口时删）：type DocNodeRecord = ProjectedRecord */
export type DocNodeRecord = ProjectedRecord;
```

- [ ] **Step 3: 全仓机械改名**——`grep -rl "DocNodeRecord" | xargs sed -i 's/DocNodeRecord/ProjectedRecord/g'`（**除 docShape.ts 的兼容 type 行**）；fixture/测试同步（`docShape.test.ts:29` 键集锚等断言按新名跑绿）。

- [ ] **Step 4: 三面 tsc+全量测试绿（零行为门）**

Run: `pnpm -r typecheck` + 三包 `vitest run`（全量）。
Expected: 全绿——**任何行为断言红=本片失败**（只许名字变）。

- [ ] **Step 5: 删兼容别名+Commit**

```bash
git add -A packages apps
git commit -m "refactor(shared): P0-pre T1——DocNodeRecord 机械改名 ProjectedRecord（172 处/零行为）+order 派生位预留"
```

### Task 2: 抽 collab-doc-ops.ts 纯模块（破 writer→document 环）

**Files:**
- Create: `apps/api/src/modules/collab/collab-doc-ops.ts`
- Modify: `apps/api/src/modules/collab/collab-document.service.ts`（原语迁出+re-export 兼容）+`collab-doc-writer.service.ts:59-69`（import 改自新模块）

- [ ] **Step 1: 迁移**——把 `applyWriteNodeDataToDoc/applyWriteExecStatusToDoc/applyDeleteNodeDataKeysToDoc/applyDeleteNodesToDoc/applyFillDocToDoc/applyDeleteExecOrphansToDoc/undefinedPatchValueError`（collab-document.service.ts:277-330 区域）与 `applyWriteOpsToDoc/applyOpsCore/rejectionsOf/guardResult/applyOp`（collab-doc-writer.service.ts:80-189 区域）**原样迁入** collab-doc-ops.ts（**只动 import 路径零逻辑变更**——含指标 import；metrics 依赖经构造注入或模块级单例保持现状）。

- [ ] **Step 2: 两 service import 切换**——writer:59-69 的 `from './collab-document.service'` 原语 import 改 `from './collab-doc-ops'`（`CollabDocumentService` 的 @Inject 维持——运行时环不再有模块级函数依赖）；document.service 对外 re-export 原语（既有测试 import 路径兼容）。

- [ ] **Step 3: 环检测+全量绿**——`grep -n "from './collab-document.service'" apps/api/src/modules/collab/collab-doc-ops.ts` 零命中（纯模块铁律）；api 全量 vitest 绿。
Commit: `refactor(collab): P0-pre T2——抽 collab-doc-ops 纯模块破 writer→document import 环（零逻辑）`。

### Task 3: media-probe 队列装配（producer API 侧/processor 位占）

**Files:**
- Modify: `apps/api/src/modules/storage/storage.module.ts`（+BullModule.registerQueue）
- Modify: `apps/api/src/worker.module.ts`（provider 位注释占位——processor 本体 C0b T9）

- [ ] **Step 1: 先红**——`apps/api` 启动测试或 StorageModule 单测注入 `@InjectQueue('media-probe')` 的 stub provider 断言队列令牌可解析（现状 DI 失败红——storage.module 无注册实证）。

- [ ] **Step 2: registerQueue**（storage.module.ts）：

```ts
imports: [TeamModule, BullModule.registerQueue({ name: 'media-probe', defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 100, removeOnFail: 500 } })],
```

- [ ] **Step 3: 绿+Commit**（`feat(collab): P0-pre T3——media-probe producer 队列注册（API 侧）`）。

### Task 4: Prisma probeState 状态机列

**Files:**
- Modify: `apps/api/prisma/schema.prisma:270-318`（Media 模型）+新 migration（`pnpm --filter @flowweb/api exec prisma migrate dev --name media_probe_state`——本地时间戳目录名惯例）

- [ ] **Step 1: schema 增列**

```prisma
  // Y1b probe 状态机（Z7''-v7——Media.status=上传态，勿混用）
  probeState      String    @default("pending") // pending|running|done|failed|skipped
  probeAttempts   Int       @default(0)
  probeError      String?   @db.VarChar(512)
  probedAt        DateTime?
  naturalWidth    Int?
  naturalHeight   Int?
  naturalRotation Int?      // 0|90|180|270
```

- [ ] **Step 2: migration+现有测试绿**（默认值向后兼容——现有行全 pending；fresh replay 必验惯例）。
Commit: `feat(collab): P0-pre T4——Media probeState 状态机六列迁移`。

**片 P0-pre 出口**：`pnpm -r typecheck` 三面绿+三包全量 vitest 绿+`grep -c "export interface DocNodeRecord" packages/shared` =0+collab-doc-ops 零 Nest import——**零行为变更**铁证（与 main 的 diff 仅改名/搬文件/加列）。

---

## 片 B1a（必做）：只读命令门（T5）

### Task 5: nodeStore 五命令门+deleteNode 级联门+onNodesChange 善后段全门+onConnect 门+dimensions 分表+undo 门

**Files:**
- Create: `apps/web/src/utils/canvas-command-gate.ts`（assertCanEditCommand 单门）
- Modify: `apps/web/src/stores/nodeStore.ts:524-560/:617-651`（五命令门）
- Modify: `apps/web/src/stores/canvasStore.ts:827-856`（deleteNode 级联前置）/`:1527-1699`（onNodesChange 全段门）/`:1702-1717`（onConnect edges 门）
- Modify: `apps/web/src/stores/canvasUndo.ts:67-105`（undo/redo 门）
- Test: `apps/web/src/stores/canvasStore.readonly.spec.ts`（新建——G34 矩阵）

- [ ] **Step 1: 先红——VIEWER 全命令矩阵（G34）**

```ts
// canvasStore.readonly.spec.ts（setReadOnly 会话态注入）
describe('Z6''-v7 VIEWER 全命令矩阵（G34）', () => {
  it.each(['addNode', 'deleteNode', 'updateNodeData', 'updateConfig', 'updateText', 'undo', 'redo'])('%s→零 cs 写+零 local-origin update', (cmd) => { /* spy 断言 */ });
  it('deleteNode→cascadeDeleteVideoProject 零调用（命令路径 :846 前置）+cancelNodeProcess 零调用', () => { /* 双 spy */ });
  it('onNodesChange remove/position 善后段全跳（ns.deleteNode/patchGroupData/ungroup 零调用）', () => { /* 注入 remove change+三 spy */ });
  it('onConnect→edges 零 set（dispatch 后 :1702-1717 面）', () => { /* spy */ });
  it('dimensions 无 setAttributes→measured 本地应用；带 setAttributes→丢弃（**先判后 apply**）', () => { /* 两断言 */ });
  it('select→放行', () => { /* 断言 */ });
});
```

Run: `pnpm --filter @flowweb/web exec vitest run src/stores/canvasStore.readonly.spec.ts` → FAIL（基线 §1.3/§1.8 实证现状）。

- [ ] **Step 2: 单门+接线**

```ts
// canvas-command-gate.ts
export function assertCanEditCommand(): boolean {
  const s = useCanvasStore.getState();
  return !s.collabReadOnly && !s.writeFrozen && !s.canvasDiverged;   // dispatchCanvasIntent 同判据单源
}
```
接线（每处首行 `if (!assertCanEditCommand()) return;`）：nodeStore 五命令（addNode/deleteNode/updateNodeData/updateConfig/updateText——**投影写路径不受门**：投影调用面传 `opts:{projection:true}` 旁路或拆投影专用内部函数）；canvasStore.deleteNode 级联块整体移入门后；onNodesChange 重构：

```ts
const canEditNow = assertCanEditCommand();
if (!canEditNow) {
  const allowed = changes.filter((c) => c.type === 'select' || (c.type === 'dimensions' && !c.setAttributes));
  if (allowed.length) set((s) => ({ nodes: applyNodeChanges(allowed as never, s.nodes) }));
  return;   // remove/position/setAttributes 善后段整块不执行（v1 只跳 per-change 的缺口根修）
}
// ……editor 路径维持现有 gesture 路由（不重构 160 行——精准修改）
for (const ch of changes) {
  if (ch.type === 'dimensions') { applyNodeChanges([ch]); if (ch.setAttributes) commitAuthorSize(ch.id, ch.dimensions); continue; }
  applyNodeChanges([ch]);  // 善后段照旧（editor）
}
```
onConnect 首行门；canvasUndo undoCanvas/redoCanvas 首行门。

- [ ] **Step 3: 绿+全量 web 回归+Commit**（`feat(web): B1a 必做——assertCanEditCommand 单门+五命令/级联/善后段/onConnect/undo 全门（G34）`）。

---

## 片 C0b：服务端事实写（T6-T12）

### Task 6: natural 单对象契约+manifest 逐键 ValueSpec+Object.hasOwn

**Files:**
- Create: `packages/shared/src/canvas/natural-fact.ts`
- Modify: `packages/shared/src/canvas/canvas-doc-manifest.ts:83/:156-190/:332-417`
- Test: `packages/shared/src/canvas/canvas-doc-manifest.test.ts`

- [ ] **Step 1: 先红**（v1 T1 用例维持+exemptValueKeys 结构断言新红）——G10/G15 红相：natural 合法零违规/natural 非法=op 级 NATURAL_INVALID（**同批 fileId op 独立**）/未知键 UNKNOWN_KEY/`toString` 绕过/expectFileId 字段合法/`keys−exemptValueKeys===valueTypes keys` 结构断言。
- [ ] **Step 2: 实现**——natural-fact.ts（NaturalFact `{mediaId,width,height,rotation?}`+isValidNaturalFact〔mediaId string≤64/wh 正整数 1..100000/rotation 0|90|180|270〕+SERVER_ONLY_DATA_KEYS）；manifest：SERVER_NODE_DATA_KEYS +natural 单键；writeNodeData op 变体 `+expectFileId?: string|null`；ValueSpec 逐键 `Record<string, ValueSpec>` +`exemptValueKeys:['natural']`；validateWriteBatch 表驱动+Object.hasOwn。
- [ ] **Step 3: 绿+G10 红相自证（删 validator 编译红）+Commit**（`feat(shared): natural 单对象+manifest 表驱动/ValueSpec/exempt/Object.hasOwn`）。

### Task 7: 单写面收编+expectFileId 全 op CAS（经 collab-doc-ops）

**Files:**
- Modify: `apps/api/src/modules/collab/collab-doc-ops.ts`（applyWriteNodeDataToDoc：expectFileId 全 op+deep-equal no-op）
- Modify: `apps/api/src/modules/collab/collab-document.service.ts:215-217`（writeNodeData 薄包装经 ops 模块）
- Test: `apps/api/src/modules/collab/collab-document.service.spec.ts`

- [ ] **Step 1: 先红**

```ts
describe('Z10''-v7 单写面收编+全 op CAS（G15/G18/G27）', () => {
  it('未知键→written:false UNKNOWN_KEY（v1 现状红相 written:true）', async () => { /* 断言 */ });
  it('natural 非法→typed false 不 throw', async () => { /* 断言 */ });
  it('expectFileId 全 op：patch 无 natural 时 fileId 不匹配→stale-media（旧 probe 不回退 fileId）', async () => {
    await service.writeNodeData('p1', 'n1', { fileId: 'mNEW' });
    const out = await service.writeNodeData('p1', 'n1', { fileId: 'mOLD' }, { expectFileId: 'mOLD' });
    expect(out).toMatchObject({ written: false, reason: 'stale-media' });
  });
  it('同值 no-op deep-equal：natural 对象重投递零 doc delta', async () => { /* 编码前后 byteLength 不变断言 */ });
});
```

Run → FAIL。

- [ ] **Step 2: 实现**——writeNodeData 方法体：`withSession(..., applyWriteOpsToDoc(doc,[{op:'writeNodeData',nodeId,patch,expectFileId}]))`（**import 自 collab-doc-ops——环已破**）；applyWriteNodeDataToDoc（ops 模块内）：node 存在性检查后**全 op CAS**（`expectFileId!==undefined && dataMap.get('fileId')!==expectFileId→stale-media`——含 patch 无 natural 的 fileId op）+natural typed false+deep-equal 同值跳过（`fast-deep-equal`——仓内已有依赖则复用，无则字段比较函数）。
- [ ] **Step 3: 绿+collab-write.port.http.spec 的 {a:1} 防退款用例修正**（:61/:75/:92 瞬态/永久档断言**维持 written:true**〔防误退款契约——外审 P1-4 采纳：这些是端口瞬态行为测试非校验测试〕+**新增**「HTTP 200+written:false UNKNOWN_KEY 原样透传」用例）+Commit（`feat(collab): 单写面收编+expectFileId 全 op CAS+deep-equal no-op（经 collab-doc-ops）`）。

### Task 8: presign 落两列+confirm probeState 幂等入队

**Files:**
- Modify: `apps/api/src/modules/storage/storage.service.ts:20-99`
- Modify: `apps/api/src/modules/storage/dto/presign.dto.ts`（+nodeId?+class-validator）
- Test: `apps/api/src/modules/storage/storage.service.spec.ts`

- [ ] **Step 1: 先红**——带 projectId+nodeId 的 presign 落两列/无 projectId 素材库两列 null 不拒/confirm 幂等（probeState=done→`{fileId,probeQueued:false}` 零 enqueue）/pending→completed+enqueue `probe_${mediaId}`（无冒号）/node-bound EDITOR 校验（`perm.assertEditor`——注入 ProjectPermissionService）。
- [ ] **Step 2: 实现**——presign data 增两列+node-bound 校验；confirmUpload：`already=media.probeState==='done'`（**非 status**——上传态≠probe 态）；enqueue 经 MediaProbeService.enqueue（T9 建——本卡先注入接口 stub，T9 落真身）；ext 白名单（`/^[A-Za-z0-9]{1,8}$/`）+fileType allowlist（image/*|video/*）。
- [ ] **Step 3: 绿+Commit**（`feat(collab): presign 落两列+confirm probeState 幂等入队（jobId probe_ 无冒号）`）。

### Task 9: MediaProbeService.enqueue 收口 7 处+detectNatural+processor+sweeper

**Files:**
- Create: `apps/api/src/modules/media-probe/media-probe.service.ts`（enqueue 收口）
- Create: `apps/api/src/modules/media-probe/media-probe.processor.ts`
- Modify: `apps/api/src/modules/media-process/media-process.service.ts`（+detectNatural）
- Modify: `apps/api/src/worker.module.ts`（processor 平铺 providers）
- Modify: 7 处 media.create 调用方（ai-download.processor.ts:100 一带/ai-image-edit.processor.ts:200/lighting.consumer.ts/media-process.uploadAndCreateMedia:194/stitch·trim·separate 产物落地处/generated-media.service.ts:29 register 完成面/confirmUpload——T8）
- Test: `apps/api/src/modules/media-probe/media-probe.processor.spec.ts`

- [ ] **Step 1: 先红——G32（覆盖面）**

```ts
describe('Z7''-v7 probe 全路径（G32）', () => {
  it.each(['confirmUpload','ai-download','ai-image-edit','lighting','media-process','stitch','generated-media'])('%s 路径 media.create 后 enqueue 恰一次', (path) => { /* spy MediaProbeService.enqueue */ });
  it('图片 EXIF orientation 6→交换+镜像档 5/7 处理（C0a §6：sharp metadata 返回原始像素——交换自做）', () => { /* fakeMeta 断言 natural=180×320 */ });
  it('视频 rotation=-90→270 归一+交换', () => { /* ffprobe JSON fake 断言 */ });
  it('jobId probe_${mediaId} 无冒号（BullMQ 抛错实证）', () => { /* jobId 断言 */ });
  it('sweeper：running 卡死>10min 重置 pending+failed attempts<3 重入队', () => { /* 时钟 mock 断言 */ });
  it('MIME 嗅探：presign 声称 image 但 magic bytes 非 image→probeState=skipped', () => { /* 断言 */ });
});
```

Run → FAIL（模块不存在+7 路径无 enqueue）。

- [ ] **Step 2: 实现**

```ts
// media-probe.service.ts
@Injectable()
export class MediaProbeService {
  constructor(@InjectQueue('media-probe') private readonly q: Queue) {}
  async enqueue(mediaId: string): Promise<void> {
    await this.q.add('probe', { mediaId, epoch: currentDeployEpoch() }, { jobId: `probe_${mediaId}` });
  }
}
// processor（WorkerModule 平铺）：
// ①probeState=running ②MinioService.getObject 流→临时文件（finally 删）③MIME 嗅探（magic bytes——非 image/video→skipped）
// ④图片 sharp(Buffer)（limitInputPixels:100_000_000+failOn:'none'）+orientation 1-8（5-8 交换）⑤视频 detectNatural（ffprobe 15s 超时+SIGKILL+side_data_list rotation 负角归一）
// ⑥done→metadata.probe={width,height,rotation,probedAt}+naturalWidth/Height/Rotation 列 ⑦失败→failed+probeError（attempts 由 BullMQ 递增）
// ⑧done 且 media.nodeId→collab-write.port strict 写 bindMedia（T10）⑨节点不存在→node-deleted 计数（attach 兜底）
// sweeper：@Cron 5min——pending/failed 重入队+running>10min 重置（probeAttempts≥3→DLQ 计数）
```
detectNatural 落 MediaProcessService（复用 ffprobePath/spawn 基建——**不新建平行实现**）；`sharp.concurrency(1)`（libvips 线程池单线程）。

- [ ] **Step 3: 绿+真链路冒烟**（本地 PG/MinIO：真传 1 张 EXIF orientation=6 fixture 图+1 段旋转视频——probe 全链 done+natural 落 doc）+Commit（`feat(collab): probe 全路径入队收口+detectNatural+processor+sweeper（G32）`）。

### Task 10: strict 写档（WriteOpResult 状态扩展）+bindMedia 单事务

**Files:**
- Modify: `apps/api/src/modules/collab/collab-write.port.ts:87-92 域`（WriteOpResult +status 四态——shared 定义）+HttpCollabWritePort
- Create: `apps/api/src/modules/collab/collab-media.service.ts`（bindMedia/attachMedia）
- Test: `apps/api/src/modules/collab/collab-write.port.http.spec.ts`+collab-media.service.spec.ts

- [ ] **Step 1: 先红**

```ts
describe('Z7''-v7 strict 写档+bindMedia（G27/G32）', () => {
  it('strict 档：瞬态→throw 重试语义；ok→透传（stale-media typed false 原样——job 不重试）', async () => { /* 两断言 */ });
  it('bindMedia：新节点 expectFileId:null→{fileId,natural} 单事务落地', async () => { /* doc 读回断言 */ });
  it('bindMedia：旧 probe（expectFileId=mOLD 而当前 mNEW）→stale-media 零写（fileId 不回退）', async () => { /* 断言 */ });
  it('bindMedia：同值幂等（deep-equal no-op）', async () => { /* 断言 */ });
});
```

- [ ] **Step 2: 实现**——WriteOpResult 扩 `status:'applied'|'rejected'|'retryable'|'permanent'`（written=status==='applied' 派生兼容——**不新增平行方法**〔v1 writeOpsBatchStrict 方案废止——外审「四态改契约」采纳〕）；HttpCollabWritePort.writeBatch 透传 status（瞬态合成档仅 execution 防退款消费面维持 written 派生）；collab-media.service.bindMedia(projectId,nodeId,mediaId,opts)：`withSession` 单事务读-检-写（expectFileId=opts.expectFileId ?? 当前值——显式替换与 probe 补写两语义）；attachMedia（perm.assertEditor+media.teamId 可访问+type allowlist+补写 Media.projectId/nodeId+只信 metadata.probe+queued 承诺=绑定持久化后）。
- [ ] **Step 3: 绿+Commit**（`feat(collab): WriteOpResult 四态+bindMedia 单事务+attach 契约`）。

### Task 11: attach 用户 controller+复制命令自动 attach（O(k)）

**Files:**
- Create: `apps/api/src/modules/collab/collab-media.controller.ts`（POST /api/collab/projects/:projectId/nodes/:nodeId/media——AuthGuard 用户面）
- Modify: `apps/web/src/stores/canvasStore.ts`（duplicateNodes/pasteGroupClipboard/mergeStoryboard 完成+attach 批调用）
- Test: controller spec+web 命令 spec

- [ ] **Step 1: 先红**——EDITOR 403/viewer/probe 未完成返 queued（绑定已持久化断言——Media.nodeId 落列）/素材库 projectId=null 允许（teamId 校验面）/批量端点 `POST /api/collab/projects/:id/nodes/media:batch`（粘贴 100 节点=1 次 HTTP——单 doc 事务）。
- [ ] **Step 2: 实现**——controller（AuthGuard+perm.assertEditor——**非 WorkerWriteAuthGuard**）；web 复制命令完成后收集 `{nodeId,mediaId}` 批量 attach（源 fileId 引用保留——**natural 不随复制**〔T12 strip〕）。
- [ ] **Step 3: 绿+Commit**（`feat(collab+web): attach 用户面 controller+批量端点+复制命令自动 attach`）。

### Task 12: web 禁写门 strip 四点

**Files:**
- Modify: `apps/web/src/stores/nodeStore.ts`（updateNodeData/updateConfig patch 过滤）
- Modify: `apps/web/src/stores/canvasIntents.ts:135-140/:462-481`（applyIntentToDoc addNode data 剥键+diff addNode data 排除）
- Modify: `packages/shared/src/canvas/copyPlan.ts:63`（副本 data structuredClone 后剥键——stripNodeDataForClient 导出共享）+`apps/web/src/stores/canvasStore.ts:662-687`（assembleRecords）
- Test: nodeStore/canvasIntents/copyPlan spec

- [ ] **Step 1: 先红**——四点各一断言（updateNodeData 剔 natural 保留 existing/addNode intent data 无 natural/diff 对 cs 投影携带 natural 零 natural intent/copyPlan 副本 data 无 natural 但 fileId 保留）+`deleteNodeDataKeys` 服务端域键 typed 拒（ops 原语层断言）。
- [ ] **Step 2: 实现**——shared 导出 `stripServerOnlyDataKeys(data)`（SERVER_ONLY_DATA_KEYS 剔键）四处接线；api 侧 applyDeleteNodeDataKeysToDoc 对服务端域键 typed 拒。
- [ ] **Step 3: 绿+E8 全链绿+Commit**（`feat(web+shared): strip 四点——客户端 natural 零写路径闭合（复制/粘贴/上传全链）`）。

**片 C0b 出口**：E8 逐类绿（G32——7 路径全入队+真链路冒烟）+两路径同表（G10/G18）+typed false 不 throw（G15）+双向 CAS（G27）+strip 四点+先红留档——呈报用户确认。

---

## 片 A1：doc 契约+placement 语义（T13-T18）

### Task 13: 版本双 bump 3+IDB 失效

**Files:**
- Modify: `packages/shared/src/canvas/docShape.ts:41`（CANVAS_DOC_SCHEMA_VERSION=3）+`packages/shared/src/constants/collab-protocol.ts:8`（CLIENT_PROTOCOL_VERSION=3）

- [ ] **Step 1: 先红**——断言两常量=3（现状 2）；grep `'=== 2'|SCHEMA.*2'` 逐处清（含 `assertDocSchema` 文案 v1→v2→v2→v3）。
- [ ] **Step 2: 改两常量**（注释钉 v7 §6 语义：Y1c-2 若入上线批折叠本版不再 bump）。
- [ ] **Step 3: 绿+旧用例修正+Commit**（`feat(shared): 版本双 bump 3（schema/csv）——旧 v2 doc/客户端拒载`）。

### Task 14: placement.ts 三型落位（Stored/Projected 接 placement 语义）

**Files:**
- Create: `packages/shared/src/canvas/placement.ts`
- Modify: `packages/shared/src/canvas/docShape.ts`（ProjectedRecord 增 placement?: Placement 派生位——T1 预留位接线）
- Test: `packages/shared/src/canvas/placement.test.ts`

- [ ] **Step 1: 先红**

```ts
// placement.test.ts
describe('Z2''-v7 placement 三型（G13 基座）', () => {
  it('isValidOrderKey：合法/尾 0/超长/表外字符', () => { /* 四断言——ORDER_KEY_RE /^[0-9A-V]{1,128}$/+非 0 结尾 */ });
  it('toProjected：placement 派生 parentId/order；缺 placement 零派生（total 合法态）', () => { /* 两断言 */ });
  it('toStoredOrReject：缺 placement typed 拒（G1）', () => { /* 断言 */ });
  it('DOC_NODE_KEYS 编译锚（satisfies Exclude<keyof StoredNodeRecord,...>=never）', () => { /* tsc 自证 */ });
});
```

- [ ] **Step 2: 实现**——`Placement={parentId:string|null,order:string}`+ORDER_KEY_RE/isValidOrderKey+`StoredNodeRecord`（placement 必填——P0-pre T1 已建 ProjectedRecord，本片增 Stored）+toProjected/toStoredOrReject+`DOC_NODE_KEYS=['id','type','placement','position','width','height','data']` 双向编译锚（nodeEnvelope 同款 satisfies 手法——**NODE_ENVELOPE_KEYS 不动**）。
- [ ] **Step 3: 绿+Commit**（`feat(shared): placement 复合单键三型+DOC_NODE_KEYS 独立（G13 基座）`）。

### Task 15: validateNodeRecord/validateNodePatch 两函数五处接线

**Files:**
- Create: `packages/shared/src/canvas/validate-node-record.ts`
- Modify: `apps/web/src/stores/canvasIntents.ts:139`（applyIntentToDoc addNode 写入前）+docShape fillDoc/applyRecordToYMap+`collab-doc-ops.ts`（writeNodeData data 键校验=T7 已接自然汇流）+`canvas-doc-manifest.ts`（fillDoc 分支 required placement）
- Test: `packages/shared/src/canvas/validate-node-record.test.ts`

- [ ] **Step 1: 先红**

```ts
describe('Z2''-v7 validate 双函数（G1——整记录/patch 分职）', () => {
  it('validateNodeRecord：缺 placement→missing-placement/order 非法→invalid-order/natural 值域→invalid-natural/wh 非 finite→invalid-field/合法→ok', () => { /* 五断言 */ });
  it('validateNodePatch（partial）：单键校验——natural 单键/fileId string——整记录校验不硬塞 patch 面', () => { /* 两断言 */ });
});
```

- [ ] **Step 2: 实现+五处接线**——validateNodeRecord（整记录）+validateNodePatch（partial——Z12'' 调用面分职）；五处：①applyIntentToDoc addNode（typed 拒 IntentRejected）②fillDoc 种子（normalizeForSeed 先行 T17 保证全带）③applyRecordToYMap 增量 ④collab-doc-ops natural 分支（T7 汇流断言）⑤manifest fillDoc 分支（FILLDOC_MISSING_PLACEMENT op 级码）。
- [ ] **Step 3: 绿+Commit**（`feat(shared): validateNodeRecord/validateNodePatch 分职+五处接线（G1）`）。

### Task 16: NodeEnvelopePatch 判别联合+allocatePlacement doc 边界+37 调用点迁移

**Files:**
- Modify: `apps/web/src/stores/canvasIntents.ts:38-53`（判别联合+intent afterId 锚）
- Create: `apps/web/src/stores/canvas-allocator.ts`（allocatePlacement/allocatePlacements——shared 可放则放）
- Modify: 37 处 updateNodeEnvelope 引用点（canvasStore :1434 出组/:2196 入组/:1446 dropIntoGroup/组 resize/canvasIntents diff :481 等——grep 清单执行附件）
- Modify: `apps/web/src/stores/canvasIntents.ts:462-481`（diff addNode 带 afterId 不带 order）
- Test: canvasIntents.spec.ts+canvasStore 命令 spec

- [ ] **Step 1: 先红**

```ts
describe('Z12''-v7 allocator doc 写边界（G1 附款+判别联合）', () => {
  it('NodeEnvelopePatch：parentId:string|null 成对 order——@ts-expect-error 只给 parentId 不给 order=编译红', () => { /* 编译期自证 */ });
  it('出组=parentId:null 可表达（现 :1434 parentId:undefined 语义迁移）', () => { /* dispatch 后 doc placement.parentId===null 断言 */ });
  it('addNode intent：node 无 placement+afterId 锚→applyIntentToDoc 内 allocatePlacement 补（store 工厂零 doc 依赖）', () => { /* doc 读回 placement 断言 */ });
  it('批量 allocator：同批 paste 10 节点（同批新父）→全 placement 唯一+相对序', () => { /* 断言 */ });
  it('本地命令后 reorderCsLayer：cs 数组序立即=doc 层序', () => { /* 命令后断言 */ });
});
```

- [ ] **Step 2: 实现**——判别联合三变体（几何/仅序/父变更成对）；intent `addNode{node:ProjectedRecord 无 placement, afterId?}`；applyIntentToDoc addNode/updateNodeEnvelope 父变更分支调 allocatePlacement（读同层 (order,id)——orderRecords 纯函数依赖 T21 先行则引用，否则本卡内置层读简版+T21 收编）；allocatePlacements（虚拟层状态——已分配键参与下一次 between；mergeStoryboard/paste/duplicate/bulk addNode 消费）；**37 处调用点**：出组→`{parentId:null,order}`+入组→`{parentId:groupId,order}`（undefined 删键语义全数显式迁移）；命令级 reorderCsLayer（受影响层重排——命令后非拖拽帧）。
- [ ] **Step 3: 绿+Commit**（`feat(web): 判别联合+allocatePlacement/Placements doc 边界+37 调用点迁移+reorderCsLayer`）。

### Task 17: normalizeForSeed 五路径（含 vacuum）+applyKeySetTable placement

**Files:**
- Create: `packages/shared/src/canvas/normalize-for-seed.ts`
- Modify: `packages/shared/src/canvas/docShape.ts:264-296`（applyKeySetTable placement 透传）
- Modify: `apps/api/src/modules/project/project.service.ts:63-65`/`collab-shrink.service.ts`（exportFresh）/snapshot-filter clone/`collab-doc-registry.service.ts:629`（**rebuildVacuumDoc——五路径**）
- Test: `packages/shared/src/canvas/normalize-for-seed.test.ts`

- [ ] **Step 1: 先红——G20（五路径含 vacuum）**

```ts
describe('Z14''-v7 normalizeForSeed 五路径（G20）', () => {
  it('缺 placement 的 Projected[]→保输入序重分配合法短键→StoredNodeRecord[]', () => { /* 断言 */ });
  it('合成键零回写服务中 doc（类型层：返回仅作 fillDoc 输入）', () => { /* 类型断言 */ });
  it('vacuum：缺 placement 节点经 normalize 后 fillDoc 通过（v6 前现状=恢复路径断——:629 实证）', () => { /* rebuildVacuumDoc 集成断言 */ });
  it('vacuum 其余根 deep-copy 保 exec/meta（normalize 只动 nodes/edges）', () => { /* 断言 */ });
});
```

- [ ] **Step 2: 实现**——normalizeForSeed（按 parent 分组+输入序分配〔T20 生成器可用前=定宽 base31 占位，行内标注替换点〕→validateNodeRecord→StoredNodeRecord[]）；applyKeySetTable 增 placement 行（透传）；四消费路径+vacuum 接线（rebuildVacuumDoc：records 先 normalize 再 fillDoc——其余根 deep-copy 维持）。
- [ ] **Step 3: 绿+Commit**（`feat(shared+api): normalizeForSeed 五路径（vacuum 恢复路径并入）+键集表 placement（G20）`）。

### Task 18: 空间序 tie-break+doc-shape-invalid reason 档+readCanvas ProjectedRecord 消费者锚

**Files:**
- Modify: `packages/shared/src/canvas/geometry.ts:68-71`/`arrangeSelection.ts:79-88`（id tie-break——G25）
- Modify: `packages/shared/src/constants/collab-auth-reason.ts`（+doc-shape-invalid 进 TERMINAL_AUTH_REASONS〔防无限重连〕+manual-recovery close action）
- Modify: `apps/api/src/modules/collab/collab-document.service.ts:132`（readCanvas 返回 ProjectedRecord[] 派生——readRecordsFromMaps 出口接 toProjected）
- Test: geometry/arrangeSelection/collab-auth-reason spec+readCanvas 契约测试

- [ ] **Step 1: 先红**——同坐标双端确定性/14→15 值 reason 档+非 COLLAB_VERSION 集/manual-recovery action/**G30 消费者锚**（`readCanvas(p1)` 返回型可赋给 video-work-clone/snapshot-filter/execution/video-project 入参类型——tsc 类型测试文件）。
- [ ] **Step 2: 实现+绿+Commit**（`feat(shared): 空间序 tie-break（G25）+doc-shape-invalid 终态档+readCanvas ProjectedRecord 契约（G30）`）。

**片 A1 出口**：adversarial 仍绿+tsc 挡构造+addNode/reparent/detach/copy/paste/merge 全过 strict（G1/G30）+旧 csv/schema/IDB（G11）+空间序（G25）+五路径 normalize（G20）——呈报用户确认。

---

## 片 A2：序域主线（T19-T24）

### Task 19: integer-part 分数索引移植（order-key.ts）

**Files:**
- Create: `packages/shared/src/canvas/order-key.ts`
- Test: `packages/shared/src/canvas/order-key.test.ts`

- [ ] **Step 1: 先红——G29（append-only 硬验收+反面基准）**

```ts
// order-key.test.ts
import { generateKeyBetween, generateNKeysBetween } from './order-key';
describe('Z2''-v7 integer-part 分数索引（G29——append-only 基准）', () => {
  it('移植测试向量：同库 README/test vectors 全绿（介于/头尾/等值/前缀/整部进退）', () => { /* 向量表断言 */ });
  it('G29：10k 尾插 maxLen≤16', () => { /* 循环尾插断言 */ });
  it('G29：10k 头插 maxLen≤32', () => { /* 断言 */ });
  it('G29：10k 随机 maxLen≤16', () => { /* 断言 */ });
  it('key-too-long typed：超 hard 上限（参数=T20 实测定——先 128）返 {ok:false,reason:\'key-too-long\'}', () => { /* 断言 */ });
  it('generateNKeysBetween(a,b,n)：n 键均匀+有序+留 gap（rebalance 消费）', () => { /* 断言 */ });
  it('反面基准（红相留存）：中点方案尾插 1000 次 maxLen≈63——移植版同场景 ≤16（对照断言）', () => { /* 对照 */ });
  it('并发同锚重复键允许：between(a,a)→a（equal-key 改返同键——读侧 (order,id) 定序）', () => { /* 断言 */ });
  it('property 10k：随机插入全不变量（序/唯一/表内/尾 0）', () => { /* c0a propertyTest 手法 */ });
});
```

Run → FAIL（模块不存在）。

- [ ] **Step 2: 实现**——移植 rocicorp fractional-indexing 算法（integer part+fraction part；字母表裁剪 base32 0-9A-V 严格递增；「不得以 0 结尾」不变量由库算法天然满足或显式归一）；`equal-key` 语义改为**返同键**（允许重复——分配层不重试）+`key-too-long` typed+`generateNKeysBetween`。**实现注记**：算法+测试向量从 fractional-indexing 库源码/README 抄录移植（注释注明出处与移植差异——无新依赖）。
- [ ] **Step 3: 绿+G29 数据落盘（C0a 报告附记：新算法三曲线）+Commit**（`feat(shared): integer-part 分数索引移植（G29 append-only 硬验收）——中点方案废止`）。

### Task 20: orderRecords 三函数+参考模型对拍

**Files:**
- Create: `packages/shared/src/canvas/order-records.ts`
- Test: `packages/shared/src/canvas/order-records.test.ts`

- [ ] **Step 1: 先红**（G2/G3+参考模型——v1 T16 用例+对拍）

```ts
describe('Z2''-v7 orderRecords 三函数+参考模型（G2/G3）', () => {
  it('strict：缺/非法 placement throw typed（写输入档）', () => { /* 断言 */ });
  it('total：坏键同层合法项后层尾+invalid 计数+孤儿根处理——**期望序由参考模型独立计算**（非按实现写）', () => {
    for (const fx of RANDOM_FIXTURES) {   // property：随机生成 doc 形态
      const expected = referenceModelOrder(fx);   // 独立参考模型：合法层序+坏项层尾+孤儿根尾
      expect(orderRecordsTotal(fx).nodes.map((n) => n.id)).toEqual(expected);
    }
  });
  it('重复键：dup 计数+invalid{stage:\'order-dup\'}+读序确定', () => { /* 断言 */ });
  it('层序 DFS：插入序≠order 时读出口=层序（G3 真红）', () => { /* 断言 */ });
  it('递归深度：迭代栈实现——256 深环不死栈', () => { /* 深链 fixture 断言 */ });
  it('orderRecords（三面主出口）：pre-order+每层 (order,id)', () => { /* 断言 */ });
});
```

- [ ] **Step 2: 实现**——orderRecordsStrict/Total（层尾落位+id tie-break+去重计数+**迭代栈 DFS 深度上限 256**）+orderRecords 主出口+**参考模型**（测试内独立实现——防「按实现写期望」）。
- [ ] **Step 3: 绿+Commit**（`feat(shared): orderRecords 三函数+参考模型对拍+迭代栈（G2/G3）`）。

### Task 21: placement 写链收编+三面 orderRecords+legacy 禁写+census

**Files:**
- Modify: `packages/shared/src/canvas/docShape.ts:138-166`（readRecordsFromMaps 读 placement 派生）+fillDoc/applyRecordToYMap 写 placement
- Modify: `apps/web/src/stores/canvasIntents.ts:173`（moveNode 父读经派生）+projectIntentToStore order 投影
- Modify: `apps/web/src/utils/projectCanvasNodes.ts`（返 ProjectedRecord 删 cast——G13）
- Modify: `packages/shared/src/canvas/renderCanvas.ts:118`（cellNodes 按 data.cells 槽序——Z17''）+`apps/api/src/modules/video-work/snapshot-filter.util.ts`（RawNode 增 order?/ensureParentFirst 按序）+`apps/api/src/modules/video-work/video-work-clone.service.ts:75`（remapIds 适配）
- Create: `scripts/check-parentid-census.mjs`（+node:test 自测）
- Test: docShape/canvasIntents/renderCanvas spec

- [ ] **Step 1: 先红**——doc 带旧 legacy parentId 键→readRecordsFromMaps placement=undefined（legacy 数据拒载由版本门承担——派生语义钉死）/updateNodeEnvelope 父变更→doc 得 placement 整值+旧 parentId 键不存在/diff/projectIntentToStore order 投影（Z15''）/projectCanvasNodes 返 ProjectedRecord（tsc）/renderCanvas cellNodes 按 cells 槽序（乱序 cells fixture 断言）/snapshot-filter 层序输出。
- [ ] **Step 2: 实现**——readRecordsFromMaps 读 placement（旧 parentId 顶层键**不读不写**）；applyRecordToYMap 写 placement 整值+**deep-equal no-op**（同 placement 重写零 item）；moveNode :173 父读改派生；三面（renderCanvas/snapshot-filter/applyDocToStore T22）接 orderRecords；census 脚本（grep `get('parentId')|set('parentId')|delete('parentId')` 白名单外零命中——白名单=readRecordsFromMaps 派生注释锚）。
- [ ] **Step 3: 绿+census PASS+Commit**（`feat(shared+web+api): placement 写链+三面 orderRecords+legacy 禁写+parentId census（G3/G13）`）。

### Task 22: 装载期 rebalance（保序+purpose gate 全调用点+预算门）+in-place 维护窗+orderEpoch

**Files:**
- Create: `apps/api/src/modules/collab/collab-rebalance.ts`
- Modify: `apps/api/src/modules/collab/collab-doc-registry.service.ts:313-454`（loadDocument rebalance 段）+`collab-document.service.ts`（withSession/withDoc purpose 传全 openDirectConnection 调用点——含 collab-residency）
- Create: `apps/api/src/modules/collab/collab-maintenance.service.ts`（in-place 维护窗+freeze reason+epoch）
- Test: `apps/api/src/modules/collab/collab-rebalance.spec.ts`+collab-maintenance.service.spec.ts

- [ ] **Step 1: 先红**

```ts
describe('Z4''-v7 rebalance 保序+维护窗（G5/G26/G31）', () => {
  it('保序：插入序≠order+混合长短键层→重排前后 orderRecords id 序完全一致（v1 只断言长键清零的缺口根修）', async () => { /* 断言 */ });
  it('整层重排：层内任一长键→全层新键（generateNKeysBetween 留 gap——重排后 1k 次追加不触发 soft）', async () => { /* 断言 */ });
  it('read 物化零重排（purpose gate 全调用点——residency 传 context）', async () => { /* 断言 */ });
  it('预算门：>20k 节点或计算段>100ms→跳过+计数（交维护窗）', async () => { /* mock 断言 */ });
  it('计算段中止零写入+失败仍重测 truth（G26）', async () => { /* 断言 */ });
  it('维护窗 in-place：freeze→收敛→重排→epoch→解冻——双连接不断连+update 直接收+相对序一致（G31）', async () => { /* 双 client 集成断言 */ });
  it('离线 fence：epoch 不符→清 IDB+UndoManager.clear+旧长键不复活', async () => { /* 断言 */ });
  it('维护窗 undo 不复活旧键（freeze 开始时 clear）', async () => { /* 断言 */ });
});
```

- [ ] **Step 2: 实现**——collab-rebalance.ts：computeRebalancePlan（**按层 (oldOrder,id) 排序+整层+generateNKeysBetween 定宽/gap 分配**+预算门+触发=「maxLen>soft 或 同层重复键>3」）+apply 段只 set+truth 重测+backoff；loadDocument 挂载（purpose!=='read' 才进——T3 queue context 传递全 openDirectConnection 调用点）；collab-maintenance.service.ts：维护端点（freeze 新 FreezeReason→writesSettled→rebalanceIfDue(force)→orderEpoch 自增 meta→解冻→广播 done）；MAINTENANCE_TRANSACT_ORIGIN 第 5 常量+onUpdateDelta 排除表扩列；web 端 epoch fence（synced 后比对——canvasCollabRuntime）。
- [ ] **Step 3: 绿+10k 基准回归（保序版）+双端真连维护演练（editor+viewer 不重连）+Commit**（`feat(collab): rebalance 保序+purpose gate 全调用点+in-place 维护窗+orderEpoch（G5/G26/G31）`）。

### Task 23: guard shadow 引擎+post-apply 检测

**Files:**
- Create: `apps/api/src/modules/collab/collab-content-guard.ts`
- Modify: `apps/api/src/modules/collab/collab-doc-registry.service.ts:677`（guardSyncFrame 挂 shadow+增量索引接线+doc.on('update') post-apply 检测挂载）
- Test: `apps/api/src/modules/collab/collab-content-guard.spec.ts`

- [ ] **Step 1: 先红**（G16——C0a 9/9 矩阵 vitest 版+shadow 断言+post-apply 断言）

```ts
describe('§3.6-v7 guard shadow+post-apply（G16）', () => {
  it('正例矩阵零误报：新建节点/跨帧信封写/data 写/position/整节点删除/覆写豁免——全放行（C0a 六正例）', () => { /* 断言 */ });
  it('坏帧检出：placement 非法/客户端写 natural/删 placement 键/删 natural 键（v1 缺口）——shadow 计数不拒帧', () => { /* guard_shadow_reject_total 断言+doc 照常 apply */ });
  it('post-apply 检测：坏 placement/natural 写入后→transaction.changed 命中变更节点+计数+诊断 close code（非终态）', () => { /* 断言 */ });
  it('shadow 与 post-apply 对账：同注入两计数相等（G16 绿判据）', () => { /* 断言 */ });
  it('超阈帧（>256KB）fail-open 计数', () => { /* 断言 */ });
  it('COLLAB_CONTENT_GUARD=off 时零解析（开销门）', () => { /* 断言 */ });
});
```

- [ ] **Step 2: 实现**——collab-content-guard.ts：C0a guard-prototype.mjs 五机制移植（origin 链解析/双索引/**增量索引维护**〔applied update 注册新建类型+类型删除清理〕/覆写豁免/DeleteSet 反查+**natural 键删除检测补**）；模式=env `COLLAB_CONTENT_GUARD`（off|shadow|enforce——默认 shadow 零拒帧零 close）；post-apply 检测挂 doc.on('update')（transaction.changed→nodes 变更键→逐节点校验 placement/natural→计数+诊断 close code）；guardSyncFrame 挂 shadow 检查（type 仅 SyncStep2/Update）。
- [ ] **Step 3: 绿+guard-contract.spec**（断言 `_map`/`store.clients`/item.parent 形态——yjs 升级即红）+真连冒烟（正常编辑 shadow 零计数）+Commit（`feat(collab): guard shadow 引擎+post-apply 检测主路径（G16——C0a 五机制移植+增量索引+删除检测）`）。

### Task 24: repair-doc-order CLI（G14——v1 缺失承载）

**Files:**
- Create: `scripts/collab-repair-doc-order.mjs`（CLI——node:test 自测同款惯例）
- Test: `scripts/collab-repair-doc-order.test.mjs`

- [ ] **Step 1: 先红**

```js
// collab-repair-doc-order.test.mjs
describe('G14 repair CLI', () => {
  it('扫描四形态：混合长短键/重复键/缺 placement/natural mismatch→JSON 报告（节点/旧新 order/操作者）', () => { /* 断言 */ });
  it('维护窗重分配：输入 PG/spool 重放 doc→按层重分配（MAINTENANCE origin）→相对序保持+幂等（二跑零变更）', () => { /* 断言 */ });
  it('修复期间 doc 保持可用（total 读零异常）', () => { /* 断言 */ });
});
```

- [ ] **Step 2: 实现**——CLI（--project/--dry-run/--execute；输入=PG CanvasDoc+spool 重放〔复用 loadDocument replay 逻辑〕；输出=审计 JSON；执行=维护窗内 force rebalance+natural mismatch 补写修复扫描路径）。
- [ ] **Step 3: 绿+Commit**（`feat(collab): repair-doc-order CLI（G14——四形态扫描+维护窗重分配+幂等审计）`）。

**片 A2 出口**：层序三面同序（G3）+并发原子（G17——A3 前单端验证）+**G29 append-only 硬验收**+read 物化零重排（G5）+保序+truth（G26）+维护演练不重连+epoch fence（G31）+shadow/post-apply 对账（G16）+repair CLI（G14）——呈报用户确认。

---

## 片 A3：收敛 harness（T25）

### Task 25: node config+期望序五件套+并发用例+双端真连前置

**Files:**
- Create: `apps/web/vitest.config.node-canvas.ts`
- Create: `apps/web/src/stores/canvas-harness/order-convergence.spec.ts`（node config 挂载）+`apps/web/src/stores/canvas-harness/fixtures.ts`
- Create: `apps/web/src/stores/canvas-harness/provider-convergence.e2e-spec.ts`（双端真连——heavy/e2e 套件）

- [ ] **Step 1: 先红**

```ts
// order-convergence.spec.ts（node 环境——Z13''：纯函数零 antd/RF/zustand import）
describe('Z13''-v7 收敛 harness（G12+G17）', () => {
  it('期望序五件套：层序/插入序≠order/等值 tie（含重复键合法档）/孤儿环/坏键落尾——参考模型断言', () => { /* 五 fixture */ });
  it('双端收敛：随机 transcript（add/move/reparent）+随机 merge 顺序→三端同序', () => { /* 断言 */ });
  it('G17 红相反例：两键形态混键复现+复合键对照组全配对（c0a §2 手法）', () => { /* 断言 */ });
  it('失败输出：seed/clientIDs/transcript 三件 dump', () => { /* 注入断言 */ });
});
// provider-convergence.e2e-spec.ts：双真实 provider 双端 add/move/reparent/offline merge→同序（v1 全留 B3 的缺口——A3 前置）
```

- [ ] **Step 2: 实现**——node config（environment:node+include 该目录——Z13'' window 依赖排除）；fixture/参考模型复用 T20；真连用例走 scripts/lib/provider-late-reconnect-guard destroy 惯例（harness 两约定）。
- [ ] **Step 3: 绿+Commit**（`feat(web): A3 harness——node config+五件套+并发+双端真连前置（G12/G17）`）。

---

## 片 B1：只读收口续（T26-T27）

### Task 26: enterDocInvalid catch 层（结构档）+doc-shape-invalid 恢复

**Files:**
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts:1870/:1906`（applyDocToStore 三调用点 catch——**唯一 DocShapeInvalidError 定义并只 catch 它**）
- Modify: `apps/web/src/`（doc-shape-invalid 横幅+manual-recovery 导出/重置入口）
- Test: `apps/web/src/stores/canvasCollabRuntime.docinvalid.spec.ts`

- [ ] **Step 1: 先红**——G2/G19：注毒缺 placement→total 落位渲染不白屏/注毒 doc 级结构（**唯一可抛形态=ensureSchemaVersion/DocShapeInvalidError——readRecordsFromMaps 对非 map 节点跳过不抛〔:140/:161 实证——「nodes 非 Y.Map」注毒形态按实际可抛面设计**〕）→enterDocInvalid 停 observer+terminal+导出入口/普通 TypeError→DEV rethrow 非 terminal（禁 catch-all 终态化）。
- [ ] **Step 2: 实现+绿+Commit**（`feat(web): enterDocInvalid 结构档收窄+manual-recovery 入口（G2/G19）`）。

### Task 27: resync 分流+write-rejected 节流

**Files:**
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts:1428-1464`+conn-status 消费面
- Test: resync spec

- [ ] **Step 1: 先红**——冻结解除完整重连待 synced∧unsyncedChanges===0（**reset 后 unsynced=1 非接受证明**）/viewer 降权不自动 discard/schema·doc-shape 结构档终态禁重放/write-rejected 连发 10 拒→1 横幅（payload 白名单）。
- [ ] **Step 2: 实现+绿+Commit**（`feat(web): resync 三路+write-rejected 节流收口（Z6''-v7）`）。

---

## 片 B2：删除面+写者补齐（T28-T30）

### Task 28: 删除面（测量链/measured 注记/aspectRatio）+**组件级迁移前置**

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx:43/:258/:269`+`VideoGenNode.tsx:28/:268/:278`+`MultiImageNode.tsx:122`（**先改调用点**——natural/sizeMode/applyIntrinsicFit 消费——v1 缺口）
- Modify: `apps/web/src/stores/canvasStore.ts:1575/:1579/:1640`（删 dispatchFixtureSizeIntents 链）+docShape.ts:324（measured 注记删）+geometry.ts:301-322（contentEventSize 删）+WHITELIST/ImageNodeData（data.aspectRatio 键删——**grep 区分顶层 aspectRatio 与嵌套 storyboard.aspectRatio 只删顶层**）
- Test: grep 全零断言+组件 spec

- [ ] **Step 1: 先红**——grep 三断言（dispatchFixtureSizeIntents/contentEventSize/顶层 aspectRatio 非零）+组件迁移后行为断言（ImageGenNode natural 到达 fit）。
- [ ] **Step 2: 实现**——组件先迁移（T29 的 applyIntrinsicFit 可用时接入——**本卡与 T29 同窗执行**：T29 纯函数先行落地→组件接入→删除面 grep 归零）；split 兜底改 fallbackSize。
- [ ] **Step 3: 绿+grep 全零+Commit**（`feat(web+shared): 删除面+组件级迁移（contentEventSize/aspectRatio 归零——C5）`）。

### Task 29: applyIntrinsicFit（sizeMode 单判据+load 扫描+clamp+viewer 派生）+工厂类型感知+fallbackSize

**Files:**
- Create: `apps/web/src/stores/canvas-intrinsic-fit.ts`
- Modify: `apps/web/src/stores/canvasStore.ts:764-790`（工厂 Z8'' 表）+nodeStore（markAuthorSize/适应内容置 auto+清 lastAppliedNatural）
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts`（natural 变更触发〔增量——load 一次扫描+投影后 natural 变更检测，**不在投影读路径内写**〕+readOnly 派生）
- Test: `apps/web/src/stores/canvas-intrinsic-fit.spec.ts`

- [ ] **Step 1: 先红**——G7 全组：首拟合（16:9 默认+auto→1:1 natural 即 fit 一次）/author 零 wh 写/natural.mediaId 匹配才 fit/缺省规则（无 sizeMode∧有 wh=author；无 wh=auto）/load 扫描补触发/viewer 纯函数同值派生（readOnly invariant 豁免 wh 比较）/**maxW/maxH clamp**（4K natural→clamp 800 而非 4000px 节点——v1 缺口）/**无 Media 粘贴图保留本地测量 author 档**（非一律 fallback——外审采纳）。
- [ ] **Step 2: 实现**——`applyIntrinsicFit({wh,sizeMode,natural,maxW,maxH})→{changed,width,height}` 纯函数（contain-fit+clamp）；工厂表（text 300×300/image 240×160/video 320×180+sizeMode:'auto'——audio/videoEdit 片内定；组 0 帧键）；触发链=投影后 natural 变更检测（lastAppliedNatural 去重）+load 一次扫描（批量单事务+post-transaction 批次写——**不在投影读路径内写 doc**〔重入防线〕）；fallbackSize 单函数收编+去重。
- [ ] **Step 3: 绿+G7 首拟合 E2E 真连冒烟+Commit**（`feat(web): applyIntrinsicFit 纯函数+load 扫描+clamp+viewer 派生+工厂表（G7）`）。

### Task 30: D6 改形 data.autoOrigin（B2 承载——§0.2 附 v7）

**Files:**
- Modify: `packages/shared/src/canvas/geometry.ts`（deriveGroupFrame 空 auto 组读 data.autoOrigin——fallbackOrigin 退役）+docShape 键集表（autoOrigin 非帧键透传）
- Modify: `packages/shared/src/canvas/assertions.ts:59-68`（assertNoAutoGroupFrameKeys 维持〔autoOrigin 非帧键不触〕+新增 assertAutoOrigin 不变量：空 auto 组 origin≡子 bbox 派生 or 持久值）
- Test: geometry/assertions spec

- [ ] **Step 1: 先红——G24 v7**：空自动组无持久 origin（fallbackOrigin bbox 递归抖动复现——两次 derive 结果漂移断言）。
- [ ] **Step 2: 实现**——`data.autoOrigin={x,y}` 显式非帧键（空 auto 组持久化——**唯一写者=reconcile 派生缓存**：load/成员变更时重算+deep-equal no-op）；auto 组仍零帧键（position/wh 维持剥除）；fallbackOrigin 删除；groups 断言改写。
- [ ] **Step 3: 绿+Commit**（`feat(shared): D6 改形 data.autoOrigin——fallbackOrigin 退役+auto 组零帧键维持（G24）`）。

---

## 片 B3：终出口（T31）

### Task 31: maintenance mode/epoch 实现+reset 九步脚本+verify/CI+UX 签字

**Files:**
- Create: `apps/api/src/modules/collab/collab-maintenance-mode.ts`（持久 MAINTENANCE_MODE——Redis/env+写 503 门：assertWriteAdmitted/write-batch/presign/confirm/project.create 统一检查）
- Create: `scripts/reset-canvas-v3.mjs`（--dry-run/--execute 九步）
- Modify: `scripts/verify-manifest.mjs`（+census/conformance/guard-contract 新步）+`scripts/verify-chain.test.mjs` 基线同批
- Modify: `apps/api/package.json`（DEPLOY_EPOCH env 注入）

- [ ] **Step 1: 先红——G21/G33**

```js
// reset-canvas-v3.mjs 自测（node:test）
describe('G21/G33 reset 脚本', () => {
  it('九步序：队列 pause→maintenance→停双进程（pm2 flowweb-api/flowweb-worker——拓扑实证）→清 spool→备份+truncate+Media.nodeId null+probeState reset→SCAN→部署→IDB/epoch→解除+冒烟→二轮验证', () => { /* dry-run 步骤序断言 */ });
  it('红相复现：队列未 pause 时 BullMQ 重试回灌+maintenance 60s 自动解除（drain 陷阱）——脚本门拦截', () => { /* 断言 */ });
  it('G33：旧 epoch job 丢弃+旧 epoch doc 拒载（DEPLOY_EPOCH）', () => { /* 断言 */ });
  it('两轮执行零回灌（truncate 后 CanvasDoc 行数 0 且不再出现）', () => { /* 断言 */ });
});
```

- [ ] **Step 2: 实现**——maintenance mode（**不自动解除**——显式清除）；队列 pause 全队列+active=0 轮询；pg_dump 备份+回滚预案（restore+redeploy v2+清 IDB）；Redis SCAN 白名单（bull:*/collab lease/quota——非 FLUSHDB）；DEPLOY_EPOCH（doc meta+job data 携带——probe/写 job 丢旧 epoch）。
- [ ] **Step 3: verify/CI**——`pnpm verify` 全绿（新步：parentId census/guard-contract/append-only 基准〔G29 进 CI〕）；旧标签页 csv=3 拒连强刷实证。
- [ ] **Step 4: UX 可接受清单签字**（用户确认点——§0.2-⑥ 七项）。
- [ ] **Step 5: G35 浏览器 soak**——10k（append 键）+5 客户端 10min：投影 p95≤30ms+React commit+doc 字节不随同值写增长。
- [ ] **Step 6: Commit+部署窗呈报**（`chore(collab): B3 终出口——maintenance mode/epoch/reset 脚本/verify 扩步/soak（G21/G33/G35）`）。

---

## 自检（plan v2——writing-plans Self-Review）

**Spec v7 覆盖对照**：Z1''-v7（T6/T7/T9/T10）✅；Z2''-v7（T1/T14/T15/T19/T20/T26）✅；Z3''（T17/T20/T21 三面）✅；Z4''-v7（T22）✅；Z5''-v7（T29）✅；Z6''-v7（T5/T27）✅；Z7''-v7（T8-T12）✅；Z8''（T29）✅；Z9''-v7（T31）✅；Z10''-v7（T2/T6/T7）✅；Z11''-v7（T12 四点）✅；Z12''-v7（T16）✅；Z13''-v7（T25）✅；Z14''-v7（T17 五路径）✅；Z15''-v7（T21）✅；Z16''（T29 multiImage）✅；Z17''-v6（T21 cells）✅。**门禁**：G1-G35 全有承载卡（G14=T24——v1 虚报已补；G29=T19；G30=T18；G31=T22；G32=T9；G33=T31；G34=T5；G35=T31）。**片序**：P0-pre→B1a 必做→C0b→A1→A2→A3→B1→B2→B3（§0.2-③ v7）。

**类型一致性**：ProjectedRecord/StoredNodeRecord/RawNodeRecord（T1/T14/T15/T17/T20 全一致）；NaturalFact/isValidNaturalFact/SERVER_ONLY_DATA_KEYS/expectFileId/stripServerOnlyDataKeys（T6-T12 一致）；generateKeyBetween/generateNKeysBetween/allocatePlacement/allocatePlacements/orderRecords 三函数/validateNodeRecord+validateNodePatch/normalizeForSeed/MediaProbeService.enqueue/bindMedia/attachMedia/writeOpsBatch strict 四态（各卡一致）。

**执行期语义定位点（grep 锚——非占位符）**：metrics 注入方式（collab-doc-ops 迁移时确认 store.metrics 单例形态）；`perm.assertEditor` 所在 service 注入名（generated-media.service.ts:29 先例）；stitch/trim/separate 产物落地处（execution 域 grep emitStitchStatus 消费链）；MinIO stream→临时文件工具（media-process 现有 spawn 模式旁）；fast-deep-equal 依赖（grep package.json——无则字段比较实现）。

**与 v1 的实质差异清单**（执行者勿混用 v1）：①T1 新增机械迁移片（v1 直接新建同名类型=编译墙）②T2 破环前置（v1 T2 必成环）③T8/T9 jobId/装配/detectNatural/7 路径（v1 冒号+单路径）④T10 四态契约（v1 平行方法）⑤T16 allocator doc 边界+37 调用点（v1 store 工厂自相矛盾）⑥T19 integer-part（v1 中点移植废止）⑦T22 保序+in-place+epoch（v1 close-all）⑧T23 shadow（v1 enforce）⑨T24 新增 repair CLI ⑩T28 组件前置 ⑪T31 maintenance/epoch/备份/脚本化。