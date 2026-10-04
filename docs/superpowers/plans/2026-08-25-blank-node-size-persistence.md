<!-- doc-status: historical | verified_at: n/a -->
# 空白媒体节点尺寸持久化修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 空白媒体节点（未加载图的 image/video/imageExt/multiImage）保存重载后不再缩水为 280×120，恢复「动态尺寸、不持久化」语义。

**Architecture:** DB 的 CanvasNode.width/height 改可空（去掉 NOT NULL + default 280/120），后端 syncNodes 对缺失宽高落 null，前端加载对 null 透传 undefined——节点 width 保持 undefined，组件走 `internalNode?.width ?? ratioDimensions(ratio)` 动态分支。有图节点（onLoad 写回）、用户 resize（setAttributes 写回）、textInput（创建时显式 300×300）路径不变。

**Tech Stack:** NestJS + Prisma（PostgreSQL）、React + Zustand + React Flow v12、Vitest。

**Spec:** `docs/superpowers/specs/blank-node-size-persistence.md`（根因链、R1-R5/N1-N2 实证、验收标准均已确认）

**顺序说明（对用户 9 步建议的一处调整）**：schema 迁移提前到 service 改动之前。原因：列仍为 `Float NOT NULL` 时 Prisma Client 类型是 `number`，`n.width ?? null` 编译报错，而 api 的 `pnpm test` 先执行 `tsc --noEmit` 再跑 vitest——后端红测试会因编译失败而非断言失败，破坏 TDD 节奏。

---

### Task 1: Prisma schema 可空 + 迁移

**Files:**
- Modify: `apps/api/prisma/schema.prisma:180-181`
- Create: `apps/api/prisma/migrations/<timestamp>_blank-node-size-nullable/migration.sql`（命令生成）

- [ ] **Step 1: 修改 schema**

`apps/api/prisma/schema.prisma` CanvasNode 模型（180-181 行）：

```prisma
  width     Float?
  height    Float?
```

（原为 `width     Float         @default(280)` / `height     Float         @default(120)`，其余行不动）

- [ ] **Step 2: 生成并应用迁移**

```bash
cd apps/api && pnpm exec prisma migrate dev --name blank-node-size-nullable
```

Expected: 生成迁移目录，`migration.sql` 含（两条 DROP DEFAULT 可能合并或分行，字段顺序 width/height 各一组）：

```sql
ALTER TABLE "CanvasNode" ALTER COLUMN "width" DROP NOT NULL;
ALTER TABLE "CanvasNode" ALTER COLUMN "width" DROP DEFAULT;
ALTER TABLE "CanvasNode" ALTER COLUMN "height" DROP NOT NULL;
ALTER TABLE "CanvasNode" ALTER COLUMN "height" DROP DEFAULT;
```

同时 Prisma Client 自动 regenerate（`width: number | null`）。

**Note:** 现有记录的 width/height 保持原值（280×120），不做数据回填——开发测试阶段无用户数据，旧画布空白节点不自愈（见 spec R2）。若某环境 migrate 后未自动 regenerate，手动执行 `pnpm exec prisma generate`。

**若报 shadow database 权限错误**（`P3006`/无法建库）：需用户以 PG 超管一次性执行 `ALTER ROLE flowweb CREATEDB;` 后重试（见项目记忆 prisma_migrate_history_broken）。禁用 `db push` 绕过。

- [ ] **Step 3: 验证迁移状态**

```bash
cd apps/api && pnpm exec prisma migrate status
```

Expected: `Database schema is up to date!`，无 pending。

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "$(cat <<'EOF'
feat(api): CanvasNode width/height 可空——空白节点尺寸不持久化的 schema 基础

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 后端 syncNodes 落库 null（TDD）

**Files:**
- Modify: `apps/api/src/modules/project/project.service.ts:112-113`
- Test: `apps/api/src/modules/project/project.service.spec.ts`（syncNodes describe 内追加）

- [ ] **Step 1: 写失败测试**

`project.service.spec.ts` 的 `describe('syncNodes', ...)` 内（`persists parentId` 用例之后）追加：

```ts
    it('无 width/height 的节点落库 null（空白节点动态尺寸不持久化）', async () => {
      await service.syncNodes('p1', [
        { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, data: {} },
      ]);

      expect(prisma.canvasNode.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ id: 'n1', width: null, height: null })],
      });
    });

    it('有 width/height 的节点原样透传', async () => {
      await service.syncNodes('p1', [
        { id: 'n2', type: 'imageGen', position: { x: 0, y: 0 }, data: {}, width: 548, height: 309 },
      ]);

      expect(prisma.canvasNode.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ id: 'n2', width: 548, height: 309 })],
      });
    });
```

- [ ] **Step 2: 运行确认红**

```bash
cd apps/api && pnpm exec vitest run src/modules/project/project.service.spec.ts
```

Expected: 第一个新用例 **FAIL**（`expected null, received 280` / `120`）；第二个新用例 PASS；其余全绿。

- [ ] **Step 3: 最小实现**

`project.service.ts` syncNodes 的 createMany data（112-113 行）：

```ts
        width: n.width ?? null,
        height: n.height ?? null,
```

（原为 `width: n.width ?? 280,` / `height: n.height ?? 120,`）

- [ ] **Step 4: 运行确认绿**

```bash
cd apps/api && pnpm exec vitest run src/modules/project/project.service.spec.ts
```

Expected: 全部 PASS。

- [ ] **Step 5: api 全量测试（含 tsc 类型检查）**

```bash
pnpm --filter @flowweb/api test
```

Expected: `tsc -p tsconfig.spec.json --noEmit` 通过（Float? 类型无破坏，N1 已扫描零消费点）+ vitest 全绿。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/project/project.service.ts apps/api/src/modules/project/project.service.spec.ts
git commit -m "$(cat <<'EOF'
fix(api): syncNodes 缺失宽高落库 null——不再兜底 280/120 顶替空白节点尺寸

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 前端加载去兜底（TDD）

**Files:**
- Modify: `apps/web/src/pages/canvas/page.tsx:68-69、93-94`
- Test: `apps/web/src/pages/canvas/page.test.tsx`（新增 describe）

- [ ] **Step 1: 写失败测试**

`page.test.tsx` 中 `describe('DB 加载组关系恢复...')` 之后新增同级 describe：

```tsx
  describe('DB 加载空白节点尺寸（width/height null → undefined，动态尺寸）', () => {
    it('null 宽高节点写入两 store 均为 undefined，不再兜底 300', async () => {
      const dbNodes = [
        { id: 'b1', type: 'imageGen', position: { x: 0, y: 0 }, data: {}, width: null, height: null },
      ];
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ code: 0, data: { id: 'p1', name: 'X', nodes: dbNodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } } }),
      });
      (useCanvasStoreSetState as ReturnType<typeof vi.fn>).mockClear();
      (useNodeStoreSetState as ReturnType<typeof vi.fn>).mockClear();

      render(<MemoryRouter initialEntries={['/canvas?projectId=p1']}><CanvasPage /></MemoryRouter>);
      await waitFor(() => {
        expect(screen.getByLabelText('添加节点')).toBeInTheDocument();
      });

      // canvasStore：最后一次全量写入是 DB 加载
      const fullWrites = (useCanvasStoreSetState as ReturnType<typeof vi.fn>).mock.calls
        .filter(([s]: any[]) => 'nodes' in s && 'edges' in s && 'viewport' in s);
      const b1 = (fullWrites[fullWrites.length - 1][0].nodes as any[]).find((n: any) => n.id === 'b1');
      expect(b1.width).toBeUndefined();
      expect(b1.height).toBeUndefined();

      // nodeStore：content 写入（loadProjectIntoStore 第二处）
      const nsWrite = (useNodeStoreSetState as ReturnType<typeof vi.fn>).mock.calls
        .filter(([s]: any[]) => s?.nodes?.b1)
        .pop() as any[];
      expect(nsWrite[0].nodes.b1.width).toBeUndefined();
      expect(nsWrite[0].nodes.b1.height).toBeUndefined();
    });
  });
```

- [ ] **Step 2: 运行确认红**

```bash
cd apps/web && pnpm exec vitest run src/pages/canvas/page.test.tsx
```

Expected: 新用例 **FAIL**（`expected undefined, received 300`）；其余全绿。

- [ ] **Step 3: 最小实现**

`page.tsx` loadProjectIntoStore 两处（68-69 行 nodes map、93-94 行 content map）：

```ts
        width: n.width ?? undefined,
        height: n.height ?? undefined,
```

（两处原均为 `n.width ?? 300` / `n.height ?? 300`）

- [ ] **Step 4: 运行确认绿**

```bash
cd apps/web && pnpm exec vitest run src/pages/canvas/page.test.tsx
```

Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/page.tsx apps/web/src/pages/canvas/page.test.tsx
git commit -m "$(cat <<'EOF'
fix(web): DB 加载 null 宽高透传 undefined——空白节点重载走动态尺寸不再缩水

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 全量回归 + 类型校验

**Files:** 无新改动（纯验证）

- [ ] **Step 1: web 全量测试**

```bash
pnpm --filter @flowweb/web exec vitest run
```

Expected: 全绿（重点观察 page.test.tsx、canvasStore 系列、useCanvasPersistence 相关）。

- [ ] **Step 2: web 类型检查**

```bash
pnpm --filter @flowweb/web exec tsc -b
```

Expected: 无错误退出。

- [ ] **Step 3: api 全量测试**

```bash
pnpm --filter @flowweb/api test
```

Expected: tsc + vitest 全绿（Task 2 Step 5 后无新后端改动，此步为最终确认）。

---

### Task 5: 浏览器端到端验收（须用新建画布——旧画布空白节点保持 280×120 不自愈，见 spec R2）

**Files:** 无代码改动（验收 + 证据留存；发现问题回到对应 Task 修复后重验）

- [ ] **Step 1: 启动环境**

按项目启动流程确认 PostgreSQL/Redis/MinIO/api 运行，用 preview_start 启动 web dev server。

- [ ] **Step 2: 新建画布 + 四类空白节点**

新建画布 → 添加图片、视频、扩展图片、堆叠图片节点各一个（不加载媒体）。用 preview_inspect 记录四类节点当前渲染宽高（图片/视频/扩展 ≈548×309，堆叠 ≈400×300，以实测为准）。

- [ ] **Step 3: 保存并重开**

点「保存项目」→ 回工作空间 → 重新打开该画布。

**Q1 探针（无侵入）**：保存时用 preview_network 检查 `PUT /api/projects/:id/nodes` 请求体——空白节点应**不含** width/height 字段（实证 RF 测量值未回写 `node.width`，见评审记录 Q1）。

preview_inspect 重新测量四类节点：

Expected: 与 Step 2 记录值一致（验收标准 1）。preview_screenshot 留证。

- [ ] **Step 4: 一致性对照**

在同一重开画布上再新添一个空白图片节点，preview_inspect 对比新旧两个图片节点尺寸一致（验收标准 1 的"与新添加一致"）。

- [ ] **Step 5: 回归项抽验**

- 空白图片节点切比例（16:9 → 1:1）→ 占位尺寸跟随变化（验收标准 2；若保存误持久化测量值，重载后切比例不跟随会在此暴露——Q1 的端到端行为确认）
- 有图节点 resize 后保存重开 → 保持用户尺寸（验收标准 3——**空白节点无 resize 手柄**：image/video/imageExt 手柄条件含 `hasMedia`（ImageGenNode.tsx:92），空白态不出现；multiImage 无 resize 功能（已知限制，超出本 bug 范围）。resize 持久化场景由有图节点承载）
- 有图节点保存重开 → 尺寸不变（验收标准 3）
- 文本节点 300×300 不变（验收标准 4）

- [ ] **Step 6: 收尾**

全部通过后向用户汇报证据（截图 + inspect 数值）。若 Step 3-5 发现问题：回到 Phase 1 重新调查（systematic-debugging），不叠加盲修。

---

## Self-Review 记录

- **Spec 覆盖**：改动清单 3 项 → Task 1（schema+迁移）/ Task 2（service）/ Task 3（page.tsx 两处）；验收标准 1-4 → Task 5 Steps 2-5；标准 5-6 → Task 2/3 红绿测试；标准 7 → Task 4。无缺口。
- **占位符扫描**：所有代码步骤含完整代码；命令含期望输出。无 TBD/TODO。
- **类型一致性**：`Float?` ↔ `n.width ?? null`（Task 1 先行使 Client 类型变 `number | null`，Task 2 才编译通过——顺序即为此设计）；`?? undefined` 对 `any` 形参无类型影响；测试断言值 280/120/300 与现状代码一致。

## Plan 评审确认记录（P1-P7，均已代码实证）

- **P1 入参类型可选**：`NodeInput` 手写 interface 已是 `width?: number; height?: number`（project.service.ts:10-11）；控制器 `@Body() body: { nodes: any[] }` 无 ValidationPipe（spec R5）。测试直调 service，编译与运行时均无阻。
- **P2 前端响应类型**：不存在类型化响应——page.tsx:66 `map((n: any)`、projectApi.ts `nodes: any[]`、`res.json()` 返回 any，无 openapi codegen。`width: null` mock 与 `?? undefined` 均无类型冲突，无需同步改类型。
- **P3 存量行为声明**：已加至 Task 1 Step 2 Note。
- **P4 multiImage fallback**：MultiImageNode 容器尺寸纯内容驱动（`imgSize ?? STACKED 400×300`，MultiImageNode.tsx:124-127、277-280），**不读 internalNode.width**——修复后 undefined 走与新建完全相同的分支，一致性天然成立；堆叠容器本无 ratio 语义，固定占位即其"动态"含义。顺带登记：其 `handleMainImageLoad` 不写回 store（有图也落 null→280），修复后统一为内容驱动，行为更一致（不加额外改动）。Task 5 Step 2 实测核对。
- **P5 写回值必为数字**：onLoad 路径 `calcConstrainedSize(naturalWidth, naturalHeight)` 恒为数字；setAttributes 路径——PATCH 端点取 `c.dimensions!.width`（RF dimensions change 必带尺寸，DTO `@IsNumber()` 兜底拒非数字），全量 PUT 的 `nd.width` 由 RF `applyNodeChanges` 在 setAttributes 时写入数字（canvasStore.test.ts:246 现有测试佐证）。resize 后节点不会误落 null。
- **P6 `?? undefined` 简化为条件展开**：不采纳——条件展开增加体积无功能收益，`...n` 后覆盖写法更直接（CLAUDE.md 简洁优先）；RF `width?: number` 接受 undefined。
- **P7 generate 提示**：已加至 Task 1 Step 2 Note。

## Plan 第三轮评审确认（Q1/Q2，均已代码实证）

- **Q1「RF 测量是否回写 node.width」——不回写，保存 payload 中空白节点 width 为 undefined**。三重证据：
  1. RF v12 `applyNodeChanges` 对 dimensions 变更只更新 `node.measured`，仅 `setAttributes`（用户 resize）才写 `node.width/height`；canvasStore.ts:543 等处的 `n.width ?? n.measured?.width ?? ...` 链正是该区分的代码体现，canvasStore.groups.test.ts:354-360 显式以 `setAttributes: true` 构造变更亦佐证
  2. 归谬证明：若测量回写 548，全量保存 PUT 会携带 548 → DB 存 548 → 重载渲染 548×309 不缩水——与用户报告的缩水现象（DB 280×120）矛盾。Bug 现象本身即反证 payload 为 undefined
  3. 端到端确认已内置：Task 5 Step 3 用 preview_network 检查 PUT 请求体（无侵入，优于临时 log），Step 5 切比例行为验证兜底
  - 无需"剥离 width 再发送"的增量改动预案，无需在 store 层区分 userSetWidth/measuredWidth
- **Q2「multiImage resize 行为」——不可 resize**：MultiImageNode 无 NodeResizer/手柄（全文件零匹配）；ImageGenNode/VideoGenNode 手柄条件 `isSingleSelected && hasMedia && !isEditMode`（ImageGenNode.tsx:92）——空白节点一律无手柄。spec 验收标准 3 原表述"用户 resize 过的空白节点"在 UI 上不可达，已同步修正：resize 持久化由有图节点验证，multiImage resize 不可用登记为已知限制
