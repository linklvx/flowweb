# 媒材恢复接线（restore 端点+配额门+GC 抢占谓词）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 兑现 foundation plan :306「恢复端点未建，原语在位」——素材库文件恢复（单个+批量端点、Team 锁+NOWAIT 媒体锁+配额门事务、55P03 退避重试）+ GC claim 谓词根修（media-gc 只抢软删行）。

**Architecture:** 三层各一任务：谓词（共享原语行为域收紧，erasure 零变）→ 恢复事务（MaterialService 新方法消费 restoreMediaToActive 原语，StorageQuotaService 抽 lockTeamQuota 共享）→ 路由/DTO 门禁。锁序恒 Team→媒体行；媒体锁 FOR UPDATE NOWAIT，等待只发生在事务外退避睡眠。

**Tech Stack:** NestJS + Prisma 5.22（PostgreSQL FOR UPDATE NOWAIT/55P03/P2010 双形状）+ class-validator + vitest（int=真 PG）。

**Spec:** docs/superpowers/specs/2026-11-16-media-restore-design.md（v3 已确认——本 plan 一切机制语义以 spec 为准）

## Global Constraints

- TypeScript strict；superpowers TDD（红先行硬门——每任务先写红测、run 见红、再实现）；每任务独立 commit（①②③）。
- **用户 2026-11-17 四条防假绿测试指令**：㊞谓词腿**直调** `claimMediaForDeletion`（跑 sweep 只证「软删候选里没这行」证不了谓词挡活行）；㊚lost 腿在恢复提交后**用原 runId 直调** `executeDeletionSequence`（恢复后 deletedAt 已空，sweep 候选查询读不到这行）；㊝Team 锁采样=会话 A 先握紧媒体行、恢复 Promise 在 400ms 采样期间保持 pending、采样完放开 A（测试不空转到 16s 预算耗尽）；㊞配额超限看「**当即拒绝+deletedAt 仍在**」（拒绝本身说明没进退避重试，不包事务计数）。
- 反目标（spec §5 全列）：禁补偿式放回/guard；禁恢复旁路配额；禁请求体原文直传原语；禁持 Team 锁等媒体锁；禁先媒体后 Team 锁序；禁会话级 SET lock_timeout；禁事务回调吞 55P03；禁拿两腿次序冒充行锁。
- `restoreMediaToActive` 原语签名零改；审计三列（deletionRunId/Reason/RequestedAt）与 folderId 不动。
- **int 红绿命令（开工契约①）**：默认池 **exclude `**/*.int.spec.ts`——点名文件也不跑**（Vitest 2.1.9 实测 `No test files found` 退出码 1，**不算红也不算绿**）。命令统一：`cd apps/api && DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm vitest run -c vitest.int.config.ts <路径>`；红与绿的输出都必须出现**用例名+通过/失败件数**。批末除 `pnpm verify` 外另跑两份 int（或 `pnpm test:int`）确认 media-deleting ①-⑥+恢复八腿真跑（verify 的 api-test=同一默认池，全绿≠int 跑过）。新文件名 `*.int.spec.ts` 由 int 池 glob 收录，check-int-coverage 下限不动。既有 ①-⑤ 腿零回归。
- 事务选项写死 `{ timeout: 5_000, maxWait: 5_000 }`；预算=`MEDIA_DELETING_TX_TIMEOUT_MS + 1000` 表达式（不抄 15000）；退避基数 50ms 翻倍封顶 500ms、睡眠=该值一半到全值均匀抖动。
- 环境事实：plan/spec 新文件须先 `git add` 再跑 `pnpm verify`（否则 doc-gate 红）；CRLF 仓——node 脚本处理源文件用 `\r?\n`。

## Review Focus

1. **恢复占住 Team 配额锁堵同队 presign**（真并发残留——v2 形态复活即触发）→ Task 2 采样腿（C 会话 400ms 零 55P03）。
2. **GC claim 抢走已恢复活行→硬删恢复丢失**（谓词写错 reason 或放错括号层）→ Task 1 直调腿三连（活行挡/软删行过/erasure 活行过）。
3. **配额误拒/绕过**（incoming 口径错——pending 计入=超限团队误拒；completed 漏计=绕过门）→ Task 2 超限整批回滚腿+incoming=0 已超限放行腿。
4. **跨团队 DELETING 行被请求体原文拉回 ACTIVE**（原语不看 teamId）→ Task 2 跨团队计 0 腿。
5. **批量脏输入**（重复 id 双计/不存在 id 报错/空批进事务）→ Task 2 计 0+重复 id 断言+空批不进事务腿；Task 3 controller 空批腿。

---

### Task 1: GC 抢占谓词根修（claimMediaForDeletion reason 域软删条件）

**Files:**
- Modify: `apps/api/src/modules/media-delivery/media-gc.service.ts:57-80`（claim SQL+doc 注释）
- Test: `apps/api/src/modules/media-delivery/media-deleting.int.spec.ts`（追加腿 ⑥）

**Interfaces:**
- Consumes: `claimMediaForDeletion(db, ids, audit: MediaDeletionAudit)` 现签名；`MediaDeletionAudit.reason: 'media-gc' | 'project-erasure'`。
- Produces: 行为变更（reason='media-gc' ⇒ 只抢 deletedAt 非空行）；签名零变——erasure 两个调用点（project-erasure.stages.ts:412/:467）零动。

- [ ] **Step 1: 写红测（腿⑥——直调，防假绿指令㊞）**

在既有 describe 尾部追加（复用 `seedMedia`/`GRACE_OLD` fixture）：

```ts
it('⑥谓词域（spec §2）：media-gc 只抢软删行——活行 0 命中且保持 ACTIVE；project-erasure 活行照抢', async () => {
  const live = await seedMedia();                                    // deletedAt=null 活行
  const soft = await seedMedia({ deletedAt: GRACE_OLD });            // 软删行（对照）
  // 活行挡：0 行 + 行原样（ACTIVE、无审计落值）
  expect(await claimMediaForDeletion(prisma as never, [live.id], { runId: 'v3-live', reason: 'media-gc' })).toEqual(new Set());
  const after = await prisma.media.findUniqueOrThrow({ where: { id: live.id } });
  expect(after.deletionState).toBe('ACTIVE'); expect(after.deletionRunId).toBeNull();
  // 对照①：media-gc 软删行照抢（既有行为不回归）
  expect([...await claimMediaForDeletion(prisma as never, [soft.id], { runId: 'v3-soft', reason: 'media-gc' })]).toEqual([soft.id]);
  // 对照②：project-erasure 活行照抢（擦除语义零变）
  expect([...await claimMediaForDeletion(prisma as never, [live.id], { runId: 'v3-erz', reason: 'project-erasure' })]).toEqual([live.id]);
  await prisma.media.updateMany({ where: { id: { in: [live.id, soft.id] } }, data: { deletionState: 'ACTIVE', deletionRunId: null, deletionReason: null, deletionRequestedAt: null, deletedAt: null } });
});
```

- [ ] **Step 2: run 见红**

Run: `cd apps/api && DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm vitest run src/modules/media-delivery/media-deleting.int.spec.ts`
Expected: FAIL——腿⑥「活行挡」断言处实际命中 1 行（谓词未加）。

- [ ] **Step 3: 实现（media-gc.service.ts claimMediaForDeletion）**

三腿 OR 括号**外**加一句（与句内既有 `${audit.reason}::text` 同款写法）：

```ts
WHERE "id" = ANY(${[...ids]}::text[])
  AND (${audit.reason}::text <> 'media-gc' OR "deletedAt" IS NOT NULL)
  AND ( …既有三腿 OR 原样… )
```

doc 注释（:57-60）追加一句：`reason='media-gc' ⇒ 仅软删行（候选读出→抢占间恢复丢失竞态封口——spec 2026-11-16-media-restore §2）；'project-erasure' 活行照抢。`

- [ ] **Step 4: run 见绿（含存量零回归）**

Run: 同 Step 2。
Expected: PASS——腿⑥绿+存量 ①-⑤（含 ②a/②b/③a-c）全绿。

- [ ] **Step 5: Commit ①**

```bash
git add apps/api/src/modules/media-delivery/media-gc.service.ts apps/api/src/modules/media-delivery/media-deleting.int.spec.ts
git commit -m "feat(collab): 素材恢复批①——GC claim 谓词域收紧（media-gc 只抢软删行，spec §2）"
```

---

### Task 2: 恢复事务（service 层：retry 环+配额门+两腿）

**Files:**
- Modify: `apps/api/src/modules/team/storage-quota.service.ts`（抽 `lockTeamQuota` 公共方法，assertCanUploadInTx 首句改调它——行为零变）
- Modify: `apps/api/src/modules/material-library/services/material.service.ts`（新方法+判别器导出）
- Modify: `apps/api/src/modules/material-library/material-library.module.ts`（imports 加 TeamModule）
- Modify: `apps/api/src/modules/material-library/services/material.service.spec.ts`（构造加 quota stub+判别器单测）
- Create: `apps/api/src/modules/material-library/material-restore.int.spec.ts`（真 PG）

**Interfaces:**
- Consumes: `restoreMediaToActive(db, ids)`（media-gc.service.ts:97 零改直引——依赖链不到 MaterialService 无环）；`MEDIA_DELETING_TX_TIMEOUT_MS`；`assertCanUploadInTx(tx, teamId, incomingBytes)`。
- Produces:
  - `StorageQuotaService.lockTeamQuota(tx: Prisma.TransactionClient, teamId: string): Promise<void>`
  - `MaterialService.restoreFile(userId: string, fileId: string, teamId?: string): Promise<void>`（零行→`BadRequestException('文件不存在')`）
  - `MaterialService.restoreFiles(userId: string, ids: string[], teamId?: string): Promise<number>`（ids 空→鉴权后直接 0）
  - `export function isRestoreLockUnavailable(e: unknown): boolean`（material.service.ts 导出）

- [ ] **Step 1: 判别器红测（无库，material.service.spec.ts）**

构造 stub 增加第 4 依赖：`{ provide: StorageQuotaService, useValue: { lockTeamQuota: vi.fn(), assertCanUploadInTx: vi.fn() } }`（既有用例不受影响）。新 describe：

```ts
describe('isRestoreLockUnavailable（55P03 双形状判别——spec §1.2）', () => {
  it('认裸 55P03 与 P2010 包装 meta.code；不认 P2028/P2024', () => {
    expect(isRestoreLockUnavailable({ code: '55P03' })).toBe(true);
    expect(isRestoreLockUnavailable({ code: 'P2010', meta: { code: '55P03' } })).toBe(true);
    expect(isRestoreLockUnavailable({ code: 'P2028' })).toBe(false);
    expect(isRestoreLockUnavailable({ code: 'P2024' })).toBe(false);
    expect(isRestoreLockUnavailable(new Error('x'))).toBe(false);
  });
});

describe('恢复预算耗尽→409（开工契约④——采样腿盖不到：A 600ms 放开，删掉预算分支采样腿仍绿）', () => {
  it('$transaction 恒抛 55P03，时间拨过预算→ConflictException', async () => {
    (prisma as any).$transaction = vi.fn().mockRejectedValue({ code: '55P03' });
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    try {
      const p = service.restoreFiles('u1', ['m-x'], 't1');
      await vi.advanceTimersByTimeAsync(MEDIA_DELETING_TX_TIMEOUT_MS + 2000);
      await expect(p).rejects.toThrow(ConflictException);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: run 见红**

Run: `cd apps/api && pnpm vitest run src/modules/material-library/services/material.service.spec.ts`
Expected: FAIL——`isRestoreLockUnavailable` 未导出（编译错即红）。

- [ ] **Step 3: 实现判别器+lockTeamQuota 抽取+模块装配**

material.service.ts 追加导出（artifact-commit.service.ts:47-51 同款双形状）：

```ts
/** 恢复重试判别：仅 55P03（FOR UPDATE NOWAIT 锁不可用——裸 SQLSTATE 或 P2010 包装 meta.code）。
 *  P2028/P2024 不认（事务超时/池超时=原样抛，spec §1.2）。 */
export function isRestoreLockUnavailable(e: unknown): boolean {
  const err = e as { code?: string; meta?: { code?: string } };
  return err?.code === '55P03' || err?.meta?.code === '55P03';
}
```

storage-quota.service.ts：assertCanUploadInTx 首句 `await tx.$queryRaw…FOR UPDATE` 抽为 `async lockTeamQuota(tx, teamId)`（doc：`/** Team 行锁（配额串行化锚——presign/恢复共用；同事务重入同一行无害）。 */`），原方法改调它。material-library.module.ts imports 加 `TeamModule`；MaterialService ctor 加 `@Inject(StorageQuotaService) private readonly quota: StorageQuotaService`。

- [ ] **Step 4: run 见绿**

Run: 同 Step 2。
Expected: PASS（判别器绿+既有用例零回归）。

- [ ] **Step 5: 写 int 红测（material-restore.int.spec.ts——八腿）**

Bootstrap 镜像 media-deleting.int.spec.ts（`maybe/describe.skip`+`PrismaClient`+beforeAll 种 user/team〔**`isDefault: true`**——getOwnerTeamId 口径〕+teamMember OWNER+afterAll `deleteTeamsWithPass`）。服务直构：

```ts
const FREE_LIMIT = TEAM_FREE_STORAGE_LIMIT_BYTES;   // team.constants——非订阅团队 getLimits 回退档
const quota = new StorageQuotaService(prismaService, {} as never, { getLimits: async () => ({ seatLimit: 1, storageLimitBytes: FREE_LIMIT }) } as never);
const service = new MaterialService(prismaService, {} as never, { add: vi.fn() } as never, quota);
const seed = (over: Record<string, unknown> = {}) => prisma.media.create({ data: { userId: UID, teamId: TID, key: `restore/${randomUUID().slice(0, 8)}`, originalName: 'a.mp4', mimeType: 'video/mp4', size: 100, type: 'generated', status: 'completed', ...over } });
```

腿 2 直调删除序需 `new MediaGcService(prismaService, minioStub, barrierStub)`——stub 本地极简版（barrier=`{prepare:async()=>({outcome:'verified',…}),release:async()=>true}`；minio=`{delete:vi.fn()}`），镜像 media-deleting.okBarrier 形态不导入。**私有调用用结构化 cast（开工契约③）**：`(gc as unknown as { executeDeletionSequence: (c: { id: string; teamId: string }, runId: string) => Promise<string> }).executeDeletionSequence({ id, teamId: TID }, runId)`——t23-resource-recovery.int.spec.ts:139 同款；**不用方括号**（`pnpm test` 先跑 `tsc -p tsconfig.spec.json`，方括号私访问在类型门红而 vitest 自身不查类型），也不改 public。
**夹具纪律（开工契约③）**：全文件**唯一** `isDefault: true` 团队（getOwnerTeamId=ownerId∧isDefault 的 findFirst **无次序**——多默认团队=非确定），专供「不传 teamId」路径；超限两腿（3/4）与采样腿（8）用 `isDefault: false` 团队且调用一律显式传 teamId（超限态不外溢他腿）。会话 A 只对**那一行媒体** FOR UPDATE（不锁 Team 行）；lock_timeout 仅事务内 `SET LOCAL`。

腿清单（关键断言；四条防假绿指令㊚㊝㊞落点标 ★）：
1. **plain happy**：软删行→`restoreFiles`→count 1；行 `deletedAt:null`+`deletionState:'ACTIVE'`+预置审计列不动+folderId 不动；批量含**重复 id** `[id,id]`→count 1（ANY 幂等+两腿互斥）。
2. **DELETING 后腿+GC lost ★㊚**：软删行→`claimMediaForDeletion(media-gc)`→`restoreFiles`→行回 ACTIVE+deletedAt null→用**原 runId 直调** `new MediaGcService(prismaService, minioStub, okBarrier())['executeDeletionSequence']({ id, teamId }, runId)`→`'lost'`+行仍在（minioStub.delete 零调用）。
3. **配额超限整批回滚 ★㊞**：live completed 行 `size: FREE_LIMIT+1`（顶满 usage）+软删 completed 行→`restoreFiles`→**当即 rejectsWith BadRequestException**+软删行 `deletedAt` 仍在+**整段耗时 <1s**（当即拒绝=没进退避重试）。
4. **incoming=0 已超限放行**：同上超限团队+软删 **pending** 行→count 1（pending 不入 usage 不计 incoming）。
5. **跨团队 DELETING 行不被拉回（开工契约②）**：他队行必须是 **DELETING 且 deletedAt 有值**（`claimMediaForDeletion` 预抢）——若只是普通软删（ACTIVE），原语 WHERE 不匹配，**原文直传也会被判通过=假绿**；断言他队行 `deletionState` 仍 DELETING、`deletedAt` 不变。批次 `[本队软删, 他队 DELETING 行, 本队未软删]`→count 1（本队未软删 id 同批钉 count）。
6. **单条不存在**：`restoreFile(未软删id)` 与 `restoreFile(不存在id)` 均 rejects `'文件不存在'`（先于配额判）。
7. **空批两档**：成员+`[]`→count 0（不进事务）；非成员 user+`[]`+显式 teamId→rejects（assertTeamMember 403 形态——鉴权先于短路）。
8. **Team 锁不被占住 ★㊝**：会话 A=独立 `PrismaClient` 事务握目标软删媒体行 FOR UPDATE 600ms；启动 `restoreFiles` Promise（采样期间保持 pending——NOWAIT 失败后退避睡眠不持锁）；会话 C 循环 400ms：`$transaction(SET LOCAL lock_timeout='50ms' → SELECT "id" FROM "Team" … FOR UPDATE)` 逐次提交，**零 55P03**；采样完 A 结束→await 恢复→count 1。

- [ ] **Step 6: run 见红**

Run: `cd apps/api && DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm vitest run src/modules/material-library/material-restore.int.spec.ts`
Expected: FAIL——`restoreFile`/`restoreFiles` 方法不存在（腿 1-8 全红于编译或调用错）。

- [ ] **Step 7: 实现恢复方法（material.service.ts）**

```ts
/** 恢复重试环（spec §1.2——等待只发生在事务外）：NOWAIT 55P03→整笔回滚（Team 锁随放）→
 *  退避睡眠（不持任何行锁）；预算=MEDIA_DELETING_TX_TIMEOUT_MS+1000（单行删除事务上界+1s，
 *  不乘 MEDIA_GC_PAGE）；耗尽=409。 */
async restoreFiles(userId: string, ids: string[], teamId?: string): Promise<number> {
  const resolved = await this.resolveTeamId(teamId, userId);   // 鉴权在重试循环外一次
  if (ids.length === 0) return 0;
  const deadline = Date.now() + MEDIA_DELETING_TX_TIMEOUT_MS + 1000;
  let backoff = 50;
  for (;;) {
    try {
      const count = await this.prisma.$transaction((tx) => this.restoreInTx(tx, resolved, ids), { timeout: 5_000, maxWait: 5_000 });
      return count;
    } catch (e) {
      if (!isRestoreLockUnavailable(e)) throw e;               // 配额 BadRequest/文件不存在/P2028 原样抛
      if (Date.now() >= deadline) throw new ConflictException('文件正在删除，请稍后重试');
      await new Promise((r) => setTimeout(r, backoff * (0.5 + Math.random() * 0.5)));
      backoff = Math.min(backoff * 2, 500);
    }
  }
}

async restoreFile(userId: string, fileId: string, teamId?: string): Promise<void> {
  const count = await this.restoreFiles(userId, [fileId], teamId);   // 瘦委托——不做自己的 resolveTeamId（开工契约④：鉴权只在 restoreFiles 里、重试环外做一次）
  if (count === 0) throw new BadRequestException('文件不存在');
}
```

`restoreInTx`（私有，事务内严格序：Team 锁→候选 NOWAIT→配额门→plain 腿→原语腿；55P03 回调不吞——直接抛由 Prisma 回滚）：

```ts
private async restoreInTx(tx: Prisma.TransactionClient, teamId: string, ids: readonly string[]): Promise<number> {
  await this.quota.lockTeamQuota(tx, teamId);
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Media" WHERE "id" = ANY(${[...ids]}::text[]) AND "teamId" = ${teamId}::text AND "deletedAt" IS NOT NULL FOR UPDATE NOWAIT`;
  const lockedIds = locked.map((r) => r.id);
  if (lockedIds.length === 0) return 0;
  const agg = await tx.media.aggregate({ _sum: { size: true }, where: { id: { in: lockedIds }, status: 'completed', deletedAt: { not: null } } });
  const incoming = Number(agg._sum.size ?? 0);                 // getUsage 同算术域（BigInt→number）
  if (incoming > 0) await this.quota.assertCanUploadInTx(tx, teamId, incoming);
  const plain = await tx.$executeRaw`
    UPDATE "Media" SET "deletedAt" = NULL
    WHERE "id" = ANY(${lockedIds}::text[]) AND "teamId" = ${teamId}::text AND "deletionState" = 'ACTIVE' AND "deletedAt" IS NOT NULL`;
  const back = await restoreMediaToActive(tx, lockedIds);      // 锁内候选全集（非请求体原文）
  return plain + back;                                         // 两腿 WHERE 互斥不双计
}
```

注意：`restoreFile` 瘦委托零自有鉴权（死变量 resolved 删——api-eslint 拒）。导入：`ConflictException`、`restoreMediaToActive`/`MEDIA_DELETING_TX_TIMEOUT_MS`（`../../media-delivery/media-gc.service`）、`StorageQuotaService`（`../../team/storage-quota.service`）、`Prisma` 类型。

- [ ] **Step 8: run 见绿**

Run: 同 Step 6。
Expected: PASS——八腿全绿（腿 2 'lost'+腿 8 零 55P03 为核心观察点）。

- [ ] **Step 9: Commit ②**

```bash
git add apps/api/src/modules/team/storage-quota.service.ts apps/api/src/modules/material-library/services/material.service.ts apps/api/src/modules/material-library/services/material.service.spec.ts apps/api/src/modules/material-library/material-library.module.ts apps/api/src/modules/material-library/material-restore.int.spec.ts
git commit -m "feat(collab): 素材恢复批②——恢复事务（Team锁+NOWAIT+配额门+两腿+55P03退避，spec §1.2-§3）"
```

---

### Task 3: 路由+DTO+门禁

**Files:**
- Create: `apps/api/src/modules/material-library/dto/batch-restore-files.dto.ts`
- Modify: `apps/api/src/modules/material-library/controllers/file.controller.ts`（两路由——`batch-restore` 一段字面量在前、`:id/restore` 两段在后，无抢配）
- Test: `apps/api/src/modules/material-library/controllers/file.controller.spec.ts`、`dto/dto-whitelist.spec.ts`、`dto/dto-decorators.spec.ts`

**Interfaces:**
- Consumes: Task 2 的 `restoreFile(userId, fileId, teamId?)`/`restoreFiles(userId, ids, teamId?)`。
- Produces: `POST api/material/files/:id/restore`→`{success:true}`（teamId=Query）；`POST api/material/files/batch-restore`→`{success:true, count}`（teamId=Body）。

- [ ] **Step 1: 写红测**

file.controller.spec.ts（service stub 增 `restoreFile: vi.fn()`/`restoreFiles: vi.fn()`）：

```ts
it('POST /:id/restore should restore and return success', async () => {
  service.restoreFile.mockResolvedValue(undefined);
  const res = await controller.restoreFile('m-1', mockReq(), 't-team');
  expect(service.restoreFile).toHaveBeenCalledWith('user-1', 'm-1', 't-team');
  expect(res).toEqual({ success: true });
});
it('POST /batch-restore should batch restore and return count', async () => {
  service.restoreFiles = vi.fn().mockResolvedValue(2);
  const res = await controller.batchRestore({ ids: ['m-1', 'm-2'], teamId: 't-team' }, mockReq());
  expect(service.restoreFiles).toHaveBeenCalledWith('user-1', ['m-1', 'm-2'], 't-team');
  expect(res).toEqual({ success: true, count: 2 });
});
it('POST /batch-restore 空数组=0（真传 []——开工契约④）', async () => {
  service.restoreFiles = vi.fn().mockResolvedValue(0);
  const res = await controller.batchRestore({ ids: [] }, mockReq());
  expect(service.restoreFiles).toHaveBeenCalledWith('user-1', [], undefined);
  expect(res).toEqual({ success: true, count: 0 });
});
```

dto-whitelist.spec.ts 追加：`BatchRestoreFilesDto` ids 非数组被拒+`malicious` 剥离（镜像 BatchDeleteFilesDto 腿）；dto-decorators.spec.ts 追加：`BatchRestoreFilesDto：ids 数组 + teamId 可选`。

- [ ] **Step 2: run 见红**

Run: `cd apps/api && pnpm vitest run src/modules/material-library/controllers/file.controller.spec.ts src/modules/material-library/dto`
Expected: FAIL——`controller.restoreFile`/`batchRestore` 不存在+DTO 类未建。

- [ ] **Step 3: 实现**

batch-restore-files.dto.ts=BatchDeleteFilesDto 同形克隆（`ids!: string[]` `@IsArray @IsString({each:true})`+`teamId?: string` `@IsOptional @IsString`）；controller 两路由（形态对称 delete 族——单个 `@Post(':id/restore')` `@Param('id') @Req @Query('teamId')`；批量 `@Post('batch-restore')` `@Body() @Req`）。

- [ ] **Step 4: run 见绿**

Run: 同 Step 2。
Expected: PASS。

- [ ] **Step 5: Commit ③**

```bash
git add apps/api/src/modules/material-library/dto/batch-restore-files.dto.ts apps/api/src/modules/material-library/dto/dto-whitelist.spec.ts apps/api/src/modules/material-library/dto/dto-decorators.spec.ts apps/api/src/modules/material-library/controllers/file.controller.ts apps/api/src/modules/material-library/controllers/file.controller.spec.ts
git commit -m "feat(collab): 素材恢复批③——restore 路由+BatchRestoreFilesDto+门禁断言（spec §1.1）"
```

---

### 批末出口（全批收口门）

- [ ] **verify full**：`git add docs/superpowers/specs/2026-11-16-media-restore-design.md docs/superpowers/plans/2026-11-17-media-restore.md`（先 add 否则 doc-gate 红）→ 仓根 `pnpm verify`——36 步全绿；若 doc-gate 报 canonical drift：`node scripts/doc-gate.mjs --write-canonical` 后复跑。
- [ ] **int 复核**：确认两个 int spec 真跑件数（非 skipped）——media-deleting（存量+腿⑥）与 material-restore（八腿）。
- [ ] **push 停等用户确认**（批末门——呈报三 commit+verify 证据后等确认）。
