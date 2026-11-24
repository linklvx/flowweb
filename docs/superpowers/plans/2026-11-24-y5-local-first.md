# Y5 y-indexeddb + local-first 离线水合 Implementation Plan（v2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以 y-indexeddb 9.0.12 单一 update 日志替换自研 per-tab 快照缓存层，交付「离线刷新进 local 可编辑、重连经 SyncStep2 上行、删除只认三合法」的 local-first 水合。

**Architecture:** 策略模块（新文件 `collab/local-yjs-store.ts`+`collab/local-session-proof.ts`）持有 `IndexeddbPersistence` 与 `flowweb:yjs-meta` 三表，runtime 水合次序倒转为「先装载后 provider」；hydration 增第五态 `local`；证明=session 行 localDeadline 时钟差；diverged 四桶+统一删除闸；旧 `local-collab-cache.ts`/`local-cache-key.ts` 整层退役删除。

**Tech Stack:** y-indexeddb 9.0.12（钉死+pnpm patchedDependencies 库补丁）、yjs 13.6.32、vitest+fakeIndexedDb 装置、@flowweb/shared 常量。

**Spec:** `docs/superpowers/specs/2026-11-23-y5-local-first-design.md`（**v7**——唯一有效规则=正文 §0；本 plan 全部引用 §0 条号，实锚索引=spec §0.9；v7 增量=C1-C4 裁定行+plan 施工钉 P1-P6+验收 28-29）。

**v2 变更面（第四轮评审收口）**：T2 补丁改同一同步回调连续双请求（原单点插桩漏 del——C4）+trim 测试增「destroy 落在 add/del 之间」第二腿；T3 增 tombstone 字段+session 单活行；T4 `writeCustom` 值域 `string|ArrayBuffer`+`computeDiffBytes` 原始 byteLength（P1）；T6 增 `flowweb:auth-suppressed` 键（C2）+单活行写点；T7 logout 次序增 suppressed 同步写+**AuthProvider 离线放行腿改写**（C1——原「catch 仍 setUser(null) 现行为锚」作废）+挂载清除点；T9 范围收窄为路由决定断言（P6——原「先红腿提交」作废）；T12 增镜像腿两处+close 定时器显式锚（C3）；T13 增墓碑重试+清扫并集回退（P2）+useWorkspaceData 第六清库点（P5）+getCollabTabId 搬家落 T13b（P3）；导入头承载新增 T6b 单步（P4）；验收 28-29 映射入 T6/T7。

## Global Constraints

- 库名五维 `flowweb:yjs:<uid>:<pid>:g<generation>:s<schemaVersion>:h<historyToken>`（§0.1.3——historyToken 字符集 `[A-Za-z0-9_-]`，不合不开库）；wire docName 维持 `collabDocNameOf`，协作协议零改动（§0.1.3）。
- meta 库 `flowweb:yjs-meta` 三表 names/session/bindings（§0.1.4）；names 先写后开库、写失败不开库（§0.1.4）；names 值域含 `hold` 与 `tombstone` 且互斥（§0.1.4——v7 C4）；session 行单活行不变量：写行同步删其他 uid 行（§0.1.4——v7）；userSnapshot 十字段白名单不含 wechatOpenid/wechatUnionid/token（§0.1.4）。
- **离线放行归 AuthProvider（§0.7 路由接线——v7 C1）**：`fetchMeWithProof` 返回 transient 且 session 行 localDeadline 未过期 → `setUser(userSnapshot)`、loading 结束；200+null/401/证明缺失或过期 → `setUser(null)`；RequireAuth 只看 user 不动；画布页只分型项目请求（T9）。
- 水合次序=先装载后 createProvider（§0.2 步 5）；`whenSynced` 与 `_db` 10s 竞赛；超时 destroy+丢 Y.Doc+本会话禁再开同库名（§0.2 步 2）；10s 定时器只对 pending 生效、已 local 留 local（§0.2 步 2）。
- canEdit 认 `ready∨local`；canExecute 只认 `ready∧connected∧!writeFrozen` 且**内联谓词不调用 canEdit()**（§0.3.1-2）；threadsStore 闸同认 canEdit（§0.3.7）。
- 证明单源=session 行：`localDeadline = Date.now() + (sessionExpiresAt − serverNow)` 毫秒（§0.3.3）；双时间戳缺一不改证明、差值≤0 删行、禁 now+7d、禁第二套时钟；写点含 15min 探活（fire-and-forget 形态不变——plan 约束⑧）；登出代次=localStorage `flowweb:auth-epoch`（§0.3.3 R4）+**`flowweb:auth-suppressed` 键**（§0.3.3 v7 C2：登出任何 await 前同步写 1、putSessionRow 前复读、登录成功组件入口写 0、挂载清除点先清再写行）。
- 保存屏障只在 `hydration==='ready'` 发送（含 pagehide 腿）；armSession 进 ready 时 `lastLocalEditSeq>lastReceiptClientSeq` 补发一次（§0.3.9 R3）。
- diverged 四桶（§0.4）；`SESSION_EXPIRED`+`COLLAB_VERSION_TERMINAL_REASONS` 三档移出 `NO_READ_ACCESS_PURGE_REASONS`（§0.4）；4406+generation-stale 上跳入版本换代桶；discardLocalCache 非删除许可；historyId 全局单键（§0.4）；**镜像腿只拆会话不删库、删除单源发起标签**（§0.4 镜像腿表——v7 C3）。
- 删除三合法=acked（差分空∧无 diverged）/用户导出且文件已生成/用户点放弃（§0.6）；容量不足不自动删他库；禁应用层调 storeState（§0.5.2）；custom store 只走 get/set/del 禁二次 `indexedDB.open`（约束⑩）；**blocked 删除写墓碑、启动按墓碑直删不过闸**（§0.1.4/§0.6——v7 C4）。
- y-indexeddb 9.0.12 钉死+库补丁（§0.5.4 R2+C4：`_destroyed` 判断与快照 add/del **同一同步回调、两请求连续发中间不插 then**、同一事务；载体=pnpm patchedDependencies+patches/，锁文件随批提交）；首次进 local 后 `navigator.storage.persist()`（约束⑪）；离线媒体预签名失败不置 failed 不禁非媒体编辑（约束⑫）。
- **custom store 值域（§0.1.5——v7 P1）**：`writeCustom(persistence, key, value: string | ArrayBuffer)`；serverSV 精确切片后的 ArrayBuffer 直传、writeGrant/diverged 字符串；`computeDiffBytes` 返回原始 byteLength、空 doc 编码=模块级常量。
- `flowweb:collab:` 前缀库启动不读即删（§0.1.1）；旧 `local-collab-cache.ts` 快照记录/per-tab 键/loadAll 全删、不留旧读路径（§0.1.1）。
- TypeScript strict；vitest 运行器 `pnpm --filter web test`（单文件 `pnpm --filter web test -- <path>`）。

## Review Focus

1. **多标签 trim 期间 destroy**——验收 24：库补丁后他标签已落盘行仍在、重开可回放；**destroy 落在 add 与 del 之间是第二腿**（T2 补丁测试）。
2. **离线 local 期间浏览器清除/配额拒绝**——用户预期「降级横幅+编辑不静默丢」：QuotaExceeded 只认写入窗口+闩锁一次（§0.5.3）、persist() 拒绝走既有横幅（T11）。
3. **代次/证明被登出竞态写回**——验收 27/28：跨标签在途 /me 200 不得复活 session 行；**suppressed 键挡住登出 await 窗内新发出的 /me**（T6/T7）。
4. **服务端明确否决被当网络失败**——200+null/401/403/404 都不得用 binding 顶上（§0.2 步 1）；分型测试在 T9；**AuthProvider 放行判据同源 session 行**（C1）。
5. **超时后同库重开+迟到 apply**——验收 13/25：废弃 doc 吃迟到回放、本会话禁同库名（T4/T10）。

---

## 文件结构（决定全锁）

```
patches/y-indexeddb@9.0.12.patch              ← T2 库补丁（_destroyed 同步回调+双请求同事务）
apps/web/src/collab/local-yjs-store.ts        ← T3/T4 策略模块（persistence 句柄+meta 库+开库三合取+删除闸+墓碑）
apps/web/src/collab/local-session-proof.ts    ← T5/T6/T6b/T7 证明单源（session 行+/me 单函数+epoch+suppressed）+authClient+导入头
apps/web/src/stores/canvasCollabRuntime.ts    ← T8/T10/T11/T12/T13 水合倒转/local 态/四桶/删除闸接线（决策函数不长在此文件）
apps/web/src/stores/syncStatus.ts             ← T8 canEdit/canExecute 谓词改写
apps/web/src/stores/threadsStore.ts           ← T8 getSynced 判据改 canEdit
apps/web/src/hooks/useSessionKeepalive.ts     ← T7 探活读 body（fire-and-forget 形态不变）
apps/web/src/components/AuthProvider.tsx      ← T7 登出先 epoch+1+suppressed 同步段再清三表+文档库；离线放行腿（C1）+挂载清除点
apps/api/src/auth/auth.controller.ts          ← T5 /me 增 sessionExpiresAt/serverNow
packages/shared/src/constants/session-ttl.ts  ← T5 SESSION_TTL_MS 三处同源
apps/web/src/pages/canvas/page.tsx            ← T9 离线分型（401/5xx/无 projectId——只断言路由决定）
apps/web/src/pages/canvas/components/SyncBanner.tsx ← T12 local-pending+hold 横幅
apps/web/src/collab/canvas-local-backup.ts    ← T6b 导入头（导出面）
apps/web/src/collab/rejected-recovery.ts      ← T13b getCollabTabId 搬家落点（P3——信封导出旁）
apps/web/src/pages/workspace/hooks/useWorkspaceData.ts ← T13 第六清库点改道（P5）
apps/web/src/collab/local-collab-cache.ts     ← T14 整层删除
apps/web/src/collab/local-cache-key.ts        ← T14 整层删除（purge 语义迁 local-yjs-store）
```

---

### Task 1: y-indexeddb 依赖入列

**Files:**
- Modify: `apps/web/package.json`（dependencies 增 `"y-indexeddb": "9.0.12"` 精确 pin）

**Interfaces:**
- Produces: 后续任务 `import { IndexeddbPersistence } from 'y-indexeddb'` 可用。

- [ ] **Step 1: 加依赖并安装**

`apps/web/package.json` dependencies 增 `"y-indexeddb": "9.0.12"`（无 `^` 前缀——spec §0.9 钉死）。运行 `pnpm install`。

- [ ] **Step 2: 验证版本与 peer 范围**

Run: `pnpm ls y-indexeddb --filter web`
Expected: `9.0.12`；yjs 13.6.32 在 peer `^13.0.0` 内（lib-review §0 已核）。

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore(y5): pin y-indexeddb 9.0.12"
```

### Task 2: 库补丁——storeState 与 _destroyed 同一同步回调+双请求同事务

**Files:**
- Create: `patches/y-indexeddb@9.0.12.patch`
- Modify: `package.json`（根——`pnpm.patchedDependencies` 块）
- Test: `apps/web/src/collab/local-yjs-store.trim.spec.ts`

**Interfaces:**
- Produces: patched `storeState`——`_destroyed===true` 时快照 add 与 del 两请求都不发；未 destroy 时行为与 9.0.12 原版逐字节等价。**v7 C4：两条请求连续写在同一同步回调里、中间不插入 then**（原版实为 `addAutoKey(...).then(() => idb.del(...))` 两只 then——单点插桩在 add 前仍漏 del；补丁后两请求进入同一 IndexedDB 事务，destroy 无 interleaving 点）。

- [ ] **Step 1: 写失败测试（fakeIndexedDb 真事务——双腿）**

测试形态：`createFakeIndexedDb()` 挂全局 `indexedDB`；两实例 A/B 开同库（B 补 501 条 update 制造 trim 资格）。**腿一（验收 24 主形态）**：A 的 destroy 落在 storeState 的 fetchUpdates resolve 之后、快照 add 之前（fake timers 精确推进）；断言：B 已落盘行仍在 updates store、新实例 C 开同库能回放全部内容。**腿二（v7 C4 缝）**：A 的 destroy 落在 add 与 del 之间（原版双 then 的间隙——补丁前可精确触发）；断言同腿一：del 不再发出、行还在、C 可回放。对照腿：未 destroy 的 storeState 照常写快照+删旧条（原行为不变——补丁只加守卫不改正常路径）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter web test -- src/collab/local-yjs-store.trim.spec.ts`
Expected: FAIL——原版 del 照删他标签行（两腿同红）。

- [ ] **Step 3: 生成并挂补丁**

`pnpm patch y-indexeddb@9.0.12` → 编辑 `storeState`：`fetchUpdates(...).then(updatesStore => { if (forceStore || ...) { if (idbPersistence._destroyed) return; idb.addAutoKey(updatesStore, ...); idb.del(updatesStore, ...) } })`——`_destroyed` 判断移进 then 回调开头，**add 与 del 在同一同步回调里连续调用、中间不插入 then**（spec §0.5.4 v7 C4——两请求同一事务）。**不扩 `beforeApplyUpdatesCallback`**（首次打开空快照=噪声行非丢失路径——spec §0.5.4 钉）。`pnpm patch-commit` 生成 `patches/y-indexeddb@9.0.12.patch`；根 package.json 增 `pnpm.patchedDependencies: { "y-indexeddb@9.0.12": "patches/y-indexeddb@9.0.12.patch" }`（仓内首例——spec §0.5.4 记档）；`pnpm install` 刷锁文件。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter web test -- src/collab/local-yjs-store.trim.spec.ts`
Expected: PASS（验收 24 双腿+对照腿全绿）。

- [ ] **Step 5: Commit**

```bash
git add patches/ package.json pnpm-lock.yaml apps/web/src/collab/local-yjs-store.trim.spec.ts
git commit -m "feat(y5): y-indexeddb storeState/_destroyed 同步回调+双请求同事务补丁（验收 24 双腿）"
```

### Task 3: 策略模块骨架——meta 三表+五维库名+开库三合取

**Files:**
- Create: `apps/web/src/collab/local-yjs-store.ts`
- Test: `apps/web/src/collab/local-yjs-store.spec.ts`

**Interfaces:**
- Produces:

```ts
export function buildYjsDbName(uid: string, pid: string, generation: number, schemaVersion: number, historyToken: string): string  // flowweb:yjs:<uid>:<pid>:g<g>:s<s>:h<token>；token 不合 [A-Za-z0-9_-] 抛
export interface SessionRow { uid: string; localDeadline: number; userSnapshot: UserSnapshot }
export interface BindingRow { uid: string; generation: number; schemaVersion: number; historyToken: string; name: string; teamId: string | null }
export interface NameRow { uid: string; pid: string; generation: number; schemaVersion: number; historyToken: string; hold: boolean; tombstone?: boolean }   // v7 C4：hold 与 tombstone 互斥（§0.1.4）
export function openMetaDb(): Promise<IDBDatabase>            // flowweb:yjs-meta 三表 names/session/bindings
export async function putSessionRow(row: SessionRow): Promise<void>       // 仅 /me 200 带 user 写点调用；**v7：写行同步删其他 uid 的 session 行（单活行不变量 §0.1.4）**
export async function deleteSessionRow(uid: string): Promise<void>
export async function getSessionRows(): Promise<SessionRow[]>             // v7：返回全表行——离线冷启动读到多行歧义一律 fail-closed（调用方判）
export async function putBindingRow(uid: string, pid: string, row: BindingRow): Promise<void>  // 仅 fetchProjectMeta 成功+uid 相同写
export async function getBindingRow(uid: string, pid: string): Promise<BindingRow | null>
export async function putNameRow(dbName: string, row: NameRow): Promise<void>   // 开库前写（先 names 后文档库——§0.1.4 写序）；v7：墓碑改写=putNameRow(tombstone:true, hold:false)
export async function listNameRows(): Promise<Array<NameRow & { dbName: string }>>
export function snapshotFromUser(user: Record<string, unknown>): UserSnapshot   // 十字段白名单裁剪（§0.1.4）
```

- [ ] **Step 1: 写失败测试**

测试组：①五维库名构造+非法 token 抛错；②session 行 put/get/delete 轮回；③**单活行（v7 验收 29）：putSessionRow(uid B) 后 uid A 行不在**；④binding 键 uid+pid 复合；⑤names 写后 list 可见+**墓碑改写后 hold=false/tombstone=true、两标志互斥**；⑥snapshotFromUser 输入整行 Prisma User（含 wechatOpenid/wechatUnionid/token）断言输出恰十字段、openid/unionid 不在场。

- [ ] **Step 2: 跑测试确认失败** — Run: `pnpm --filter web test -- src/collab/local-yjs-store.spec.ts`；Expected: FAIL 模块不存在。

- [ ] **Step 3: 实现 local-yjs-store.ts meta 三表半边**

`openMetaDb` 用 `indexedDB.open('flowweb:yjs-meta', 1)` upgrade 建三 store（names 键=dbName、session 键=uid、bindings 键=`${uid}\u0000${pid}`）；全部 promise 化、写失败 reject（调用方 fail-closed）。`putSessionRow` 同事务先清 session 表其他 uid 行再 put（单活行——§0.1.4 v7）。`snapshotFromUser` 白名单：id、name、email、image、emailVerified、role、phoneNumber、phoneNumberVerified、createdAt、updatedAt。

- [ ] **Step 4: 跑测试确认通过** — Run 同 Step 2；Expected: PASS。

- [ ] **Step 5: Commit** — `git add apps/web/src/collab/local-yjs-store.ts apps/web/src/collab/local-yjs-store.spec.ts && git commit -m "feat(y5): meta 三表+五维库名+单活行+墓碑字段+userSnapshot 白名单"`

### Task 4: 策略模块文档库半边——persistence 句柄+10s 竞赛+serverSV/custom

**Files:**
- Modify: `apps/web/src/collab/local-yjs-store.ts`
- Test: `apps/web/src/collab/local-yjs-store.doc.spec.ts`

**Interfaces:**
- Consumes: Task 2 patched `IndexeddbPersistence`；Task 3 meta 表函数。
- Produces:

```ts
export const HYDRATION_OPEN_TIMEOUT_MS = 10_000   // = HYDRATION_DEADLINE_BASE_MS :591
export interface OpenDocResult { ok: true; doc: Y.Doc; persistence: IndexeddbPersistence } | { ok: false; reason: 'timeout' | 'open-reject' }
export async function openYjsDoc(dbName: string): Promise<OpenDocResult>   // names 先写后开库在调用方；内部 10s 竞赛；超时 destroy+丢 doc+记 bannedDbNames
export function isDbNameBannedThisSession(dbName: string): boolean        // §0.2 步 2 禁同库名重开
export async function readCustom(persistence: IndexeddbPersistence, key: string): Promise<string | ArrayBuffer | null>
export async function writeCustom(persistence: IndexeddbPersistence, key: string, value: string | ArrayBuffer): Promise<void>   // v7 P1：serverSV=精确切片后 ArrayBuffer 直传（§0.1.5 值域）；writeGrant/diverged=字符串；单通道（约束⑩）
export async function computeDiffBytes(doc: Y.Doc, serverSV: Uint8Array | null): Promise<number>  // §0.2 步 4：encodeStateAsUpdate(doc, serverSV ?? undefined).byteLength **原始值**——「有未上行」判据=差分字节数>EMPTY_DOC_ENCODE_BYTES 模块级常量（空更新长度非 0——P1）
export const EMPTY_DOC_ENCODE_BYTES: number   // 空 Y.Doc 编码长度，模块级一次常量
```

- [ ] **Step 1: 写失败测试**

测试组：①开库成功=库内 update 已 apply 进 doc+whenSynced resolve；②超时（fake timers 推 10s）→ok:false+`persistence` 已 destroy（`_destroyed`）+doc 被 `destroy()`+同库名第二次 `openYjsDoc` 直接 ok:false（验收 13/25 半边）；③迟到 apply 落在已废弃 doc 上不进新 doc（竞赛后 fakeIndexedDb 放行 pending open——断言返回的 doc 内容不含迟到行）；④readCustom/writeCustom 轮回；⑤computeDiffBytes：无 SV=全量、有 SV=差分、空库=0。

- [ ] **Step 2: 跑测试确认失败** — Run: `pnpm --filter web test -- src/collab/local-yjs-store.doc.spec.ts`；Expected: FAIL。

- [ ] **Step 3: 实现**

`openYjsDoc`：new Y.Doc → new IndexeddbPersistence(dbName, doc) → `Promise.race([whenSynced, timeout(10s), _db.catch(reject)])`；超时/拒绝分支 `await persistence.destroy()`+`doc.destroy()`+bannedDbNames.add(dbName)；成功分支读 custom 三键回填 `{ serverSV, writeGrant, diverged }`（约束⑩——只用 persistence.get）。bannedDbNames=模块级 Set，仅会话内。

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS。

- [ ] **Step 5: Commit** — `git commit -am "feat(y5): 文档库开库 10s 竞赛+废弃 doc+同库名禁重开"`

### Task 5: /me 服务端字段+SESSION_TTL_MS 三处同源

**Files:**
- Create: `packages/shared/src/constants/session-ttl.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`（getMe 响应增两字段）、`apps/api/src/auth/auth.ts:69/:123`、`apps/api/src/auth/session.service.ts:6`
- Test: `apps/api/src/auth/auth.controller.session-ttl.spec.ts`（新增，仿既有 controller spec 形态）

**Interfaces:**
- Produces: `export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000`（shared——`@flowweb/shared` index 导出）；getMe 200 且有 session 时响应体增 `sessionExpiresAt: session.expiresAt.getTime()`、`serverNow: Date.now()`（毫秒）。
- 约束（plan 约束⑦）：`auth.ts:69` maxAge 改引 `SESSION_TTL_MS`（毫秒现况维持）；`auth.ts:123` expiresIn 改 `SESSION_TTL_MS / 1000`（显式换算秒）；`session.service.ts:6` 改引同常量；updateAge 保持 `24 * 3600 * 1000` 独立不并入。

- [ ] **Step 1: 写失败测试**

getMe 用例：有效 session → 响应含两字段且为毫秒整数、sessionExpiresAt>serverNow；200+user:null → 两字段都不在场。

- [ ] **Step 2: 确认失败** — Run: `pnpm --filter api test -- src/auth/auth.controller.session-ttl.spec.ts`；Expected: FAIL（字段缺失）。

- [ ] **Step 3: 实现** — shared 常量入列+三处引用换源（getMe 在 `return res.json({ user: session.user })` 增两字段——`session.expiresAt` 现成，零新查询）。

- [ ] **Step 4: 确认通过** — Expected: PASS；`pnpm --filter api test -- src/auth/session.service` 既有用例零回归。

- [ ] **Step 5: Commit** — `git add packages/shared apps/api && git commit -m "feat(y5): /me 增 sessionExpiresAt/serverNow+SESSION_TTL_MS 三处同源"`

### Task 6: 证明客户端——/me 单函数+localStorage epoch+suppressed 键

**Files:**
- Create: `apps/web/src/collab/local-session-proof.ts`
- Modify: `apps/web/src/components/AuthProvider.tsx`
- Test: `apps/web/src/collab/local-session-proof.spec.ts`

**Interfaces:**
- Consumes: Task 3 `putSessionRow/deleteSessionRow/getSessionRows/snapshotFromUser`；Task 5 响应字段。
- Produces:

```ts
export function readAuthEpoch(): number                       // localStorage flowweb:auth-epoch，缺省 0
export function bumpAuthEpoch(): number                       // 登出调用：+1 并写回（storage 事件由写动作触发）
export function readAuthSuppressed(): boolean                // v7 C2：localStorage flowweb:auth-suppressed==='1'
export function setAuthSuppressed(v: boolean): void          // v7 C2：登出同步段写 true；登录成功组件入口写 false；挂载清除点写 false
export async function fetchMeWithProof(): Promise<{ ok: true; user: object } | { ok: false; reason: 'null-user' | 'http-401' | 'transient' }>
// /me 单函数：发出记 readAuthEpoch()；响应时 epoch 不符丢弃不写 session；200+user → **先验 readAuthSuppressed()（C2——为 true 时不写行直接返回 ok）**，再 snapshotFromUser+localDeadline=Date.now()+(sessionExpiresAt−serverNow) putSessionRow；双时间戳缺任一→不写证明（§0.3.3 硬性）；差值≤0→deleteSessionRow；200+null→deleteSessionRow；HTTP 401→deleteSessionRow；无 status/408/429/5xx→不动（返回 transient——AuthProvider 放行判据用，C1）
export function bindLogoutEpochTeardown(onEpochChange: () => void): () => void   // window 'storage' 事件监听（key=flowweb:auth-epoch）→拆协作会话不写 session；返回解绑
```

- [ ] **Step 1: 写失败测试**

测试组（fakeIndexedDb+mock fetch）：①200 带 user+双时间戳 → session 行 localDeadline=now+(a−b)（验收 15 时钟差 2h 腿）+**单活行：预置 uid A 行后写 uid B 行，A 行不在（验收 29）**；②缺 serverNow → session 行不变；③差值≤0 → 行删；④200+null/401 → 行删；⑤5xx/无 status → 行不动+返回 reason='transient'（C1 放行判据腿）；⑥在途竞态：发出 epoch=1，响应前 `bumpAuthEpoch()` 置 2 → 响应丢弃（A8 腿）；⑦storage 事件腿：两窗口 fake storage 事件触发 onEpochChange（验收 27）；⑧**suppressed 键（v7 验收 28）：suppressed=1 时 200+user 不写行（返回 ok:user）**；⑨**单活行歧义（验收 29 后半）：session 表预置两行 → 离线冷启动判行 fail-closed 不放行**（AuthProvider 腿在 T7 断言）。

- [ ] **Step 2: 确认失败** — Expected: FAIL 模块不存在。

- [ ] **Step 3: 实现** — 注意 fetchMeWithProof 内部禁再读 AuthProvider state（自持 epoch 快照比对）；suppressed 检查在 epoch 检查之后、putSessionRow 之前（两键串联——epoch 挡旧代次、suppressed 挡代次后新发）；`bindLogoutEpochTeardown` 只挂 storage 不开 BroadcastChannel（§0.3.3 R4）。

- [ ] **Step 4: 确认通过** — Expected: PASS。

- [ ] **Step 5: Commit** — `git commit -am "feat(y5): /me 证明单函数+跨标签 epoch+suppressed 键+单活行"`

### Task 6b: 导入头——导出带 schemaVersion+historyToken、导入校验拒绝不一致

**Files:**
- Modify: `apps/web/src/collab/canvas-local-backup.ts`（导出面+校验面）、`apps/web/src/stores/canvasCollabRuntime.ts`（exportRecoveryEnvelope 导出面+importLocalBackup 消费面）
- Test: `apps/web/src/collab/canvas-local-backup.header.spec.ts`

**Interfaces:**
- Produces: 导出文件（`buildLocalBackupPayload`/`exportRawYjsBackup`/`exportRecoveryEnvelope` 产物）加头部：`{ magic: 'flowweb-yjs', schemaVersion, historyToken }`；`applyLocalBackup(bin, deps, expected: { schemaVersion, historyToken })` 头部缺失或任一字段与当前库不一致 → 拒绝（返回拒绝结果、不 applyUpdate——spec §0.1.3 导入校验）。**旧导出文件无头不兼容**（无用户数据禁垫片——P4）。

- [ ] **Step 1: 写失败测试**

①导出产物带头三字段；②导入头与当前库一致 → applyUpdate 正常；③schemaVersion 不一致 → 拒绝、doc 内容不变；④historyToken 不一致 → 拒绝；⑤无头（旧格式字节）→ 拒绝。

- [ ] **Step 2: 确认失败** — Expected: FAIL（现导出无头）。

- [ ] **Step 3: 实现** — 头部以定长 JSON 前缀+magic 校验；`importLocalBackup`（runtime :1197）调用点带上当前会话 expected。

- [ ] **Step 4: 确认通过** — Expected: PASS。

- [ ] **Step 5: Commit** — `git commit -am "feat(y5): 备份导出带版本+纪元头、导入校验拒绝不一致（P4）"`

### Task 7: AuthProvider/探活接线——登出同步段+离线放行腿+挂载清除点

**Files:**
- Modify: `apps/web/src/components/AuthProvider.tsx:34-41`（refresh）、`:47-55`（logout）、`apps/web/src/hooks/useSessionKeepalive.ts`
- Modify: `apps/web/src/components/auth/LoginModal.tsx`、`apps/web/src/components/AuthModal.tsx`、`apps/web/src/components/auth/PhoneLoginForm.tsx`（登录成功入口先 `setAuthSuppressed(false)` 再 refresh——C2）
- Modify: `apps/web/src/pages/canvas/page.tsx`（挂 bindLogoutEpochTeardown 拆协作会话——随 T9 一并接线亦可）
- Test: `apps/web/src/components/AuthProvider.y5.spec.tsx`

**Interfaces:**
- Consumes: Task 6 `fetchMeWithProof/bumpAuthEpoch/readAuthSuppressed/setAuthSuppressed/bindLogoutEpochTeardown`；Task 3 meta 行删除+`getSessionRows`。
- Produces:
  - **refresh 改写（C1 离线放行腿——取代「catch 仍 setUser(null) 现行为锚」的 v1 写法）**：`fetchMeWithProof()` 返回 `{ok:true,user}` → `setUser(user)`（在线半边）；返回 `transient` → **读 session 行：恰好一行且 localDeadline>now 且无多行歧义 → `setUser(userSnapshot)`+loading 结束（离线放行——spec §0.7 路由接线）**；session 行缺失/过期/多行歧义 → `setUser(null)`；返回 `null-user`/`http-401` → `setUser(null)`。`loading` 各分支都收口（禁悬挂）。**挂载清除点（C2）**：挂载首次 refresh 收 200+user 先 `setAuthSuppressed(false)` 再让 fetchMeWithProof 写行（覆盖 /register 直跳与微信回调两条重定向式登录——挂载是全新页面加载的首个 /me，suppressed=1 只可能来自登出残留）。
  - **logout 次序钉死（任何 await 之前完成前两步）**：①`bumpAuthEpoch()`+`setAuthSuppressed(true)`（同一同步段——C2）→ ②REST sign-out（await 窗）→ ③`setUser(null)` → ④清该 uid 文档库+names/session/bindings 三表（purgeUidCaches 语义迁至 local-yjs-store——spec §0.6 登出行）；**某库 deleteDatabase blocked → putNameRow(tombstone)（C4）**。keepalive 改调 fetchMeWithProof（fire-and-forget 形态不变——约束⑧：失败仍静默）。

- [ ] **Step 1: 写失败测试**

①logout 后 names/session/bindings 三表该 uid 行全空+文档库删除（fakeIndexedDb）；**blocked 库（另一连接持有）→ names 行 tombstone=true**（C4）；②探活调用 fetchMeWithProof（spy）且 promise 悬挂不炸（约束⑧）；③**离线放行（C1/验收 11 前半）：mock fetch 网络失败+session 行未过期+恰好一行 → user 非 null、loading false**；④200+null/401/证明过期/多行歧义 → setUser(null)（验收 29 歧义腿）；⑤**登出 await 窗内 keepalive 打出的 /me 收 200+user → session 行不在（验收 28——suppressed 键）**；⑥**登录成功入口（LoginModal/AuthModal/PhoneLoginForm spy）先 setAuthSuppressed(false) 再 refresh**；⑦挂载清除点：suppressed=1 残留+挂载 /me 200+user → suppressed=0 且行写入；⑧bindLogoutEpochTeardown 在 canvas 页挂载且 epoch 变化调 destroyCollab。

- [ ] **Step 2: 确认失败** — Expected: FAIL。

- [ ] **Step 3: 实现** — refresh 体内 `fetchMeWithProof()`+session 行放行判据；logout 次序按 Interfaces（①②之间零 await）；keepalive 函数体改一行 `void fetchMeWithProof().catch(() => {})`；三个登录入口各加一行。

- [ ] **Step 4: 确认通过** — Expected: PASS；`pnpm --filter web test -- src/components` 既有 AuthProvider/RequireAuth 用例零回归（200+null/401 路径语义不变）。

- [ ] **Step 5: Commit** — `git commit -am "feat(y5): 离线放行腿+登出同步段+挂载清除点（C1/C2/验收 28-29 前半）"`

### Task 8: hydration 第五态 local+谓词三处放行+threads 闸

**Files:**
- Modify: `apps/web/src/stores/syncStatus.ts:8-9/:16-17`、`apps/web/src/stores/canvasStore.ts`（hydration 字段注释）、`apps/web/src/stores/canvasCollabRuntime.ts:2079`（attachThreads getSynced）、`apps/web/src/pages/canvas/page.tsx:535`、`apps/web/src/hooks/useGroupKeyboard.ts:64`、`apps/web/src/utils/viewportPersistence.ts:15`
- Test: `apps/web/src/stores/hydration-local.spec.ts`

**Interfaces:**
- Produces: `canEdit = !terminal && !collabReadOnly && (hydration==='ready' || hydration==='local')`；`canExecute = hydration==='ready' && !terminal && !collabReadOnly && connected && !writeFrozen`（**内联谓词、函数体内不调用 canEdit()**——§0.3.2）；threads getSynced 判据改 canEdit；三处 `hydration!=='ready'` 拦截点改 `hydration!=='ready' && hydration!=='local'`。

- [ ] **Step 1: 写失败测试**

①hydration='local' ∧ !readOnly ∧ !terminal → canEdit 真；②canExecute 在 local 恒假（connected 真也假——§0.3.2）；③ready 断线（connStatus='offline'）→ canEdit 真可 canExecute 假（A3/验收 18）；④threads 闸：hydration='local' 时 getSynced() 真（改后判据）——断言 attachThreads 注入的闭包在 local 态下返回 true。

- [ ] **Step 2: 确认失败** — Run: `pnpm --filter web test -- src/stores/hydration-local.spec.ts`；Expected: FAIL。

- [ ] **Step 3: 实现** — 谓词改写+四放行点（page.tsx 键盘/useGroupKeyboard/viewportPersistence/threadsStore）。

- [ ] **Step 4: 确认通过** — Expected: PASS；`pnpm --filter web test -- src/stores/can-execute.spec.ts src/stores/canvasCollabRuntime.viewer.spec.ts` 零回归。

- [ ] **Step 5: Commit** — `git commit -am "feat(y5): hydration 第五态 local+谓词四放行点"`

### Task 9: 离线路由——fetchProjectMeta 分型+binding 开库路由决定（P6 收窄）

**Files:**
- Modify: `apps/web/src/pages/canvas/page.tsx:76-106`（fetchProjectMeta catch 分型+成功写 binding）、`apps/web/src/pages/canvas/page.tsx:134-205`（离线分支）
- Test: `apps/web/src/pages/canvas/page.offline.spec.tsx`

**Interfaces:**
- Consumes: Task 3 `getBindingRow`；Task 6 证明；Task 4 `openYjsDoc`。
- Produces: fetchProjectMeta catch 新分型——status 401 走既有 httpExpired 不开库；403/404 走无读权保留；无 status/408/429/5xx → 离线三合取（session 行未过期+binding.uid=session.uid+localStorage historyId===binding.historyToken）→ 用 binding { uid, generation, schemaVersion, name, teamId } 调 openSession+setTeamId（验收 17：teamId/name 来自 binding）；三合取任一不成立 → 停「暂不可用」（验收 11：不跳登录不新建）；**无 projectId 离线停「暂不可用」禁 createUntitledProject**（§0.2 步 1）；成功路径 fetchProjectMeta 顺带 putBindingRow+putNameRow。
- **P6 任务切分钉（v7）**：本任务**只断言路由决定**——分型档位、是否调用 `initCollabLocal`（spy 断言调用/不调用）、无 projectId 停「暂不可用」。**hydration='local' 的页面整链断言不放本任务**（整链在 Task 10 桩落地后由其联测腿承载、Task 15 端到端收口）；**中间不提交一套仍失败的测试**——本任务提交前全绿（`initCollabLocal` 在 Task 10 才产出，本任务先行落桩时测试断言只到「调用与否」不触其内部）。

- [ ] **Step 1: 写失败测试（路由决定断言——验收 11/17/16 路由腿）**

①5xx+证明未过期+binding uid 一致 → `initCollabLocal` 被调用、teamId/name 来自 binding、无 createCanvas 调用；②HTTP 401 → 不进 local（httpExpired）；③用户 B（session.uid≠binding.uid）→ 不开 A 的库（验收 16）；④200+null /me 前置 → 不进 local；⑤无 projectId 离线 → 「暂不可用」不建项目；⑥**媒体预签名失败回归（约束⑫）：离线 local 态 getMediaUrl 拒绝 → hydration 留 local、非媒体编辑仍可用（现码 CanvasView 忽略该次失败——仅加回归锚，不新建媒体链路）**。

- [ ] **Step 2: 确认失败** — Expected: FAIL。

- [ ] **Step 3: 实现** — 分型次序：先 status 三档（401/403/404）再瞬态档；三合取判据函数内联；离线 openSession 走 runtime 新入口 `initCollabLocal(meta)`（Task 10 产出——本任务先落桩：桩体仅记录调用并返回 rejected promise 的路由层 mock，测试断言不依赖其内部行为）。

- [ ] **Step 4: 确认通过** — Run 同 Step 1；Expected: PASS（本任务提交时全绿——P6：不提交仍失败测试）。

- [ ] **Step 5: Commit** — `git commit -am "feat(y5): 离线分型路由+binding 三合取开库（路由决定层）"`

### Task 10: runtime 水合倒转+local 进入+serverSV 写回

**Files:**
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts:1998-2300`（initCollab 主链）、`:2280-2320`（10s 死线段）
- Test: `apps/web/src/stores/canvasCollabRuntime.local.spec.ts`

**Interfaces:**
- Consumes: Task 3/4 全接口（含 v7 `getSessionRows` 单活行判行）；Task 8 谓词；Task 9 的 `initCollabLocal` 桩。
- Produces: `export async function initCollabLocal(pid: string, meta: CollabSessionMeta & { name: string; teamId: string | null }): Promise<void>`——离线路径入口（Task 9 消费）；initCollab 在线主链改水合次序：①names 先写（putNameRow 失败→本会话不开库改纯服务端水合）→②openYjsDoc（10s 竞赛；超时改纯服务端水合新 doc）→③computeDiffBytes>空 doc 编码 → markDocUnsyncedDirty+Σpending 累计（§0.2 步 4）→④`writeGrant/diverged/serverSV` 装载复验（§0.3.5 双锚）→⑤五条 local 合取全过 → 投影+collabReadOnly=false+setHydration('local')+`navigator.storage.persist()`（约束⑪）→⑥createProvider+connectOnce（§0.2 步 5——provider 在装载后）；⑦`provider.isSynced && !hasUnsyncedChanges` → writeCustom('serverSV', 新 SV)+删 diverged+armSession ready。**10s 死线只对 pending 生效**（§0.2 步 2——已 local 留 local）。**update 监听过滤**：origin===provider 或 origin===persistence 直接返回（§0.2 步 6）。**local→ready 双端差分才跑 detectDraftMergeAnomalies**（§0.2 步 7——SS1 表明服务端有新更新∧本端差分非空）。

- [ ] **Step 1: 写失败测试（fakeHocuspocusProvider+fakeIndexedDb 装置承 t8 形态）**

①冷启动：证明 7d 内+grant=read-write+库有内容 → hydration='local'+canEdit 真+canExecute 假（验收 1）；②证明过期或 grant='read' → 内容可见 canEdit 假、库还在（验收 2）；③回放不置 diverged、相对 serverSV 差分才置 dirty（验收 3）；④回放期间 provider 未创建（断言 createProvider spy 时 persistence.whenSynced 已 resolve——验收 4 半腿）；⑤serverSV 写回后 reload 不再标 dirty（验收 5）；⑥超时 → persistence destroy+服务端水合用新 doc（验收 13/8）；⑦local 期间 update → 10s 定时器不置 failed（§0.2 步 2 钉）；⑧纯快进（只有本端差分）不跑异常检测、双端差分跑（验收 19）；⑨names 写失败 → 不开库改服务端水合。

- [ ] **Step 2: 确认失败** — Expected: FAIL。

- [ ] **Step 3: 实现** — initCollab 主链按 Interfaces 次序重排；armedEpoch latch 复用；origin 过滤扩 persistence 引用（mountUnsyncedDirtyTracker :493-508 判据面）。

- [ ] **Step 4: 确认通过** — Run: `pnpm --filter web test -- src/stores/canvasCollabRuntime.local.spec.ts src/pages/canvas/page.offline.spec.tsx`；Expected: PASS（含 Task 9 桩转绿——`initCollabLocal` 真身落地，页面整链断言在本任务联测腿补全：hydration='local' 从页面路径成立）。

- [ ] **Step 5: Commit** — `git commit -am "feat(y5): 水合倒转+local 进入+serverSV 写回（验收 1-5/8/13/19）"`

### Task 11: 保存屏障 ready 谓词+armSession 补发+容量/降级闩锁

**Files:**
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts:224-259`（sendSaveBarrier）、`:341-344`（onPageHideSendBarrier）、armSession（补发点）、`:2215` 附近（3s tick serverSV 同步段）
- Test: `apps/web/src/stores/canvasCollabRuntime.t21-barrier.spec.ts`（扩）、`apps/web/src/stores/canvasCollabRuntime.quota.spec.ts`（扩）

**Interfaces:**
- Produces: sendSaveBarrier 首行 `if (useCanvasStore.getState().hydration !== 'ready') return;`；pagehide 腿同谓词；armSession 末段 `if (lastLocalEditSeq > lastReceiptClientSeq) sendSaveBarrier();`（§0.3.9 补发——验收 26）；3s healthySync 同段异步 writeCustom serverSV（约束①：编码抛错标 dirty 不写坏向量——computeDiffBytes 调用点 try/catch）；QuotaExceeded 降级只认写入窗口+闩锁一次（§0.5.3——onDegrade 单次）；字节闸 5s tick 不重复编码（约束③——lastDocUpdateAt 判据）；首次 local 后 persist()（若 Task 10 未挂此点则本任务补）。

- [ ] **Step 1: 写失败测试**

①hydration='local' → sendSaveBarrier 零发送（pendingBarriers 空——验收 22 谓词）；②provider 已构造未 ready → 零发送（验收 26 前半）；③进 ready 且 lastLocalEditSeq>lastReceiptClientSeq → 恰补发一次且 clientSeq>=local 期间末值（验收 26 后半）；④QuotaExceeded 写窗口 → localCacheReady=false 一次（验收 9）；⑤serverSV 编码抛错 → 标 dirty 不写坏 SV（约束①）。

- [ ] **Step 2: 确认失败** — Expected: FAIL。

- [ ] **Step 3: 实现** — 谓词+补发点+同步段；字节闸 lastDocUpdateAt 模块级变量。

- [ ] **Step 4: 确认通过** — Expected: PASS；`pnpm --filter web test -- src/stores/canvasCollabRuntime.t21-barrier.spec.ts src/stores/canvasCollabRuntime.t6.spec.ts` 零回归（ready 态屏障行为不变）。

- [ ] **Step 5: Commit** — `git commit -am "feat(y5): 屏障 ready 谓词+armSession 补发+serverSV 同步段（验收 9/22/26）"`

### Task 12: diverged 四桶+purge 表收窄+镜像腿改道+SyncBanner hold 档

**Files:**
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts:668-678`（NO_READ_ACCESS_PURGE_REASONS 删 SESSION_EXPIRED+VERSION 三档）、`:1746-1830`（authenticationFailed/close 终态分支接四桶）、**:1928-1934（history-bump 镜像腿）、:1939-1947（recovery-accepted 镜像腿）、:1806-1818（close 4410 定时器）——C3 显式锚**、`handleClientOutdatedRecovery :908-926`、`handleGenerationStale :878` 上跳支、`acceptServerRestoredRecovery :989-1003`、`resyncFull :809-830`（sealed）
- Modify: `apps/web/src/pages/canvas/components/SyncBanner.tsx`（local-pending 档+hold 逃生横幅复用 diverged 形态）
- Test: `apps/web/src/stores/canvasCollabRuntime.buckets.spec.ts`

**Interfaces:**
- Produces: 四桶分派函数 `classifyTerminalToBucket(reason: string): 'auth' | 'version' | 'no-read' | 'content'`；版本桶动作=有差分/diverged → putNameRow(hold)+横幅、无差分 → 走删除闸；`discardLocalCache:true` 载荷忽略不进删除许可；4406 改：不清旧纪元库（hold）+清 historyId 维持+handleVersionTerminal 强刷维持；resyncFull sealed：被拒字节不挂回连接 doc、names 标 sealed（hold 同款出口——放弃/导出成功才删）；acceptServerRestoredRecovery：导出文件已生成才 purge（下载失败留库）；**镜像腿改道（C3——§0.4 镜像腿表）**：history-bump 镜像腿=清内存 historyId+localStorage+**拆会话不删库**（salvage download:false 腿维持）、recovery-accepted 镜像腿=**拆会话+刷新不删库**——两腿删除单源发起标签；**close 4410 定时器（:1806-1818）与 dispatchY1cClose 的 export-draft-then-clear 合成同一条删除闸路径**（hold 时库留下只亮横幅）；SyncBanner 新档 local-pending 插入位次=终态鉴权之下 diverged 之上（§0.3.8）。

- [ ] **Step 1: 写失败测试**

①session-expired → 收编辑权留库不置 diverged 不删库（验收 12 前半）；②版本三档任一+库有差分 → hold（库在+names.hold 真）不 purge（验收 21）；③4410 discardLocalCache:true+差分 → 库在；④4406 → 旧纪元库在（验收 25——新会话不开这只库腿由 openYjsDoc banned/historyId 门合证）；⑤acceptServerRestored 导出失败 → 库在；⑥resyncFull → sealed 记录在 names、连接 doc 无被拒字节；⑦forbidden → 有差分先导出后删（无读权桶不变锚）；⑧**history-bump 镜像腿（C3）：BroadcastChannel 收到 history-bump → 本 tab historyId 清+会话拆、purge 类函数零调用**；⑨**recovery-accepted 镜像腿（C3）：收到 recovery-accepted → 会话拆+刷新、purge 零调用**；⑩**close 4410 定时器（C3）：hold 时库留下、横幅亮、无 deleteDatabase 调用**。

- [ ] **Step 2: 确认失败** — Expected: FAIL。

- [ ] **Step 3: 实现** — purge 表删两成员；四桶分派+各入口改道（spec §0.9 v6 对照表五入口+v7 镜像腿补列表五入口逐条）；SyncBanner 两新档。

- [ ] **Step 4: 确认通过** — Expected: PASS；`pnpm --filter web test -- src/pages/canvas/components/SyncBanner.test.tsx src/stores/canvasCollabRuntime.version-channel.spec.ts src/stores/canvasCollabRuntime.t25.spec.ts` 零回归（镜像腿既有 salvage 语义维持）。

- [ ] **Step 5: Commit** — `git commit -am "feat(y5): diverged 四桶+镜像腿改道+close 定时器入闸+hold 横幅（验收 12/21/25+C3）"`

### Task 13: 统一删除闸+墓碑重试+启动清扫并集+容量清理单出边

**Files:**
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts:1107-1145`（safeReload）、启动清扫新函数（initCollab 前段）、`collab/local-yjs-store.ts`（删除闸+墓碑重试实现）
- Modify: `apps/web/src/pages/workspace/hooks/useWorkspaceData.ts:138-142`（第六清库点改道——P5）
- Test: `apps/web/src/stores/canvasCollabRuntime.deletegate.spec.ts`

**Interfaces:**
- Produces（全部落 local-yjs-store.ts——P6 策略纪律，runtime 只改调用点）:
  - `async function applyDeleteGate(dbName: string, trigger: 'startup' | 'generation' | 'safeReload' | 'accept' | 'resync' | 'purge-family' | 'project-delete'): Promise<'deleted' | 'held' | 'acked'>`——三合法判据：①acked=openYjsDoc 装载后 computeDiffBytes(相对 serverSV)===0 ∧ 无 diverged → 删；②调用方已确认导出文件生成 → 删；③用户点放弃 → 删；否则 putNameRow(hold)+横幅不删。
  - `async function purgeUidDbs(uid: string): Promise<void>`——登出清库（AuthProvider T7 消费）：逐库 deleteDatabaseQuietly，**blocked 库写墓碑 putNameRow(tombstone:true)（C4——§0.6 登出行）**，再清 names/session/bindings 三表该 uid 行（未 blocked 的 names 行随删随去、blocked 的留墓碑）。
  - `async function sweepStartup(): Promise<void>`——启动清扫：范围=**`indexedDB.databases()` 与 `listNameRows()` 的并集（P2——`databases()` 缺席仍走 names 全表、不得整段跳过）**；**墓碑库直删不过闸不读内容**（§0.1.4）、删成功再去 names 行；`flowweb:yjs:` 异代库逐一过闸（验收 14/25）；`flowweb:collab:` 前缀不读即删。
  - 容量「清理已同步的其他项目」按钮 → 逐候选库 openYjsDoc 验 acked 才删（§0.5.2 单出边）。
  - safeReload 在 hold 只亮横幅不 purge（§0.6 勘正——:1121 注释随改）；**useWorkspaceData 项目删除改道 applyDeleteGate(trigger:'project-delete')——有差分先导出再删（P5）**。

- [ ] **Step 1: 写失败测试**

①旧代库有差分+导出失败（mock 下载抛）→ 库在（验收 14）；②acked 库 → 删；③用户点放弃 → 删；④启动清扫 hold 横幅不自动下载（验收 21 姊妹腿）；⑤`flowweb:collab:` 前缀库删除且内容零读取；⑥容量按钮只删 acked 候选；⑦**墓碑重试（C4）：blocked 库 names 行 tombstone=true、下次 sweepStartup 直删不打开文档（spy 断言 openYjsDoc 零调用）**；⑧**清扫并集（P2）：fakeIndexedDb databases() 返回 names 表外多一库 → 该库也被扫到；databases() 缺席（undefined）→ names 全表仍扫、不整段跳过**；⑨**第六清库点（P5）：useWorkspaceData 删除成功后走 applyDeleteGate、有差分不删**。

- [ ] **Step 2: 确认失败** — Expected: FAIL。

- [ ] **Step 3: 实现** — 删除闸+墓碑+清扫三函数全落 local-yjs-store.ts；六个调用面改道（safeReload/close 定时器/accept/resync/启动/useWorkspaceData）；safeReload 旧 collectFamilyDirtyRecords 路径删除（§0.6——换代导出直读 yjs 库差分）。

- [ ] **Step 4: 确认通过** — Expected: PASS；`pnpm --filter web test -- src/stores/canvasCollabRuntime.t18.spec.ts src/pages/workspace` 零回归（boot 并集行为面随 T14 退役整删；useWorkspaceData 既有用例只验删除成功路径不验 purge 内部）。

- [ ] **Step 5: Commit** — `git commit -am "feat(y5): 统一删除闸+墓碑重试+清扫并集+第六清库点（验收 14/21+C4/P2/P5）"`

### Task 13b: getCollabTabId 搬家——rejected-recovery.ts 落点

**Files:**
- Modify: `apps/web/src/collab/rejected-recovery.ts`（函数体挪入——信封导出旁，P3）
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts:22`（import 改道）、`:795`（消费点不变）
- Test: 既有 rejected-recovery.spec.ts 零回归即本任务验证（函数行为零改动纯搬家）

**Interfaces:**
- Produces: `rejected-recovery.ts` 导出 `getCollabTabId(): string`——函数体逐字节照搬 local-collab-cache.ts:61-77（sessionStorage+fallback memo，形态不变——P3）；T14 删旧文件后全仓唯一来源。

- [ ] **Step 1: 落函数+改 import** — rejected-recovery.ts 增导出；runtime :22 改 import 来源；旧 local-collab-cache.ts 的导出暂留（T14 随层删——避免本任务两文件同名导出冲突，runtime import 已切走）。

- [ ] **Step 2: 确认通过** — Run: `pnpm --filter web exec tsc --noEmit` + `pnpm --filter web test -- src/collab/rejected-recovery.spec.ts src/stores/canvasCollabRuntime.t25.spec.ts`；Expected: 零错误零回归（信封 tabId 字段值不变）。

- [ ] **Step 3: Commit** — `git commit -am "refactor(y5): getCollabTabId 搬家 rejected-recovery（P3——随旧层退役前序）"`

### Task 14: 旧层退役——local-collab-cache/local-cache-key 整层删除

**Files:**
- Delete: `apps/web/src/collab/local-collab-cache.ts`、`apps/web/src/collab/local-collab-cache.test.ts`、`apps/web/src/collab/local-cache-key.ts`、`apps/web/src/collab/local-cache-key.test.ts`
- Modify: `apps/web/src/collab/canvas-local-backup.ts:8`（LOCAL_CACHE_MAX_DOC_BYTES 改引 QUOTA_DEFAULTS.maxDocBytes——§0.5.1 单源）、`apps/web/src/pages/workspace/hooks/useWorkspaceData.ts:7`（import 改道 local-yjs-store——T13 已改语义）、`apps/web/src/components/AuthProvider.tsx`（T7 已迁）、`apps/web/src/stores/canvasCollabRuntime.ts`（localCache 系列写点删除——:2093/:467/:482/:827/:1169/:2085/:2168/:2466；:22 getCollabTabId import 已随 T13b 切走）
- Test: 既有 spec 全量回归即本任务测试（t18/t25/t8/cache.spec 退役或随层删）

**Interfaces:**
- Consumes: T7-T13 全部新写点已在位——本任务是纯删除（spec §0.1.1：快照记录/per-tab 键/loadAll 全删不留旧读路径）。
- Produces: 仓内 grep `LocalCollabCache|local-collab-cache|buildLocalCacheKey|purgeForeignCaches|collectFamilyDirtyRecords` 零命中（runtime localCache 变量族一并清）。

- [ ] **Step 1: 删除文件+改写引用**

按 Files 清单删除并改写四消费点；runtime 内 localCache 装配/flush/observe 全链删（t18 boot 并集段随新水合次序已在 T10 重写——此处只清残余引用）。

- [ ] **Step 2: 类型与全量回归**

Run: `pnpm --filter web exec tsc --noEmit` Expected: 零错误。Run: `pnpm --filter web test` Expected: 全绿（退役 spec 已随文件删；module-size 锚若触行数门须同批勘正注释压行——Y3 在册教训）。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(y5): 旧 per-tab 快照层整层退役（spec §0.1.1 撤旧层非迁移）"
```

### Task 15: 端到端验收批+verify full

**Files:**
- Test: `apps/web/src/pages/canvas/page.e2e-local.spec.tsx`（整链验收——AuthProvider/RequireAuth/fetchProjectMeta 全链形态约束）

**Interfaces:**
- Consumes: 全部前任务（含 T6b 导入头/T13 墓碑/T13b 搬家）。
- Produces: spec §2 验收 29 项中测试可承载项全绿清单；`verify full` 36/36。

- [ ] **Step 1: 写整链验收用例**

验收 1/11 从画布页组件路径（禁单测带 meta 的 initCollab——spec §2 形态约束）：mock fetch 网络失败序列+fakeIndexedDb 预置库+证明 → 断言整链进 local（**含 AuthProvider 放行腿——C1 全链：transient→setUser(userSnapshot)→RequireAuth 放行→fetchProjectMeta 分型→initCollabLocal→hydration='local'**）；验收 15/17/18/19/22/23/24/26/27/28/29 各按前任务单测已锚，本任务补端到端汇合腿（Auth 整链+canEdit 投影+屏障谓词+代次/suppressed 竞态+单活行歧义五例）。

- [ ] **Step 2: 确认通过**

Run: `pnpm --filter web test`；Expected: 全绿。

- [ ] **Step 3: verify full+红锚零回归**

Run: `node scripts/verify-chain.mjs --tier full`（或仓在册 verify full 命令——台账既有形态）
Expected: 36/36 全绿、既有红锚零回归（spec §2 保留项）。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(y5): 验收 27 项端到端汇合+verify full"
```

---

## 依赖序

T1→T2→（T3→T4）→T5→T6→**T6b**→T7→T8→T9→T10→T11→T12→T13→**T13b**→T14→T15；T3/T4 可与 T5 并行（接口独立）；T6b 依赖 T6（导入头 expected 取当前会话上下文）；T9 只断言路由决定、整链腿由 T10 联测承载（P6——T9 提交时全绿，不存在中间红窗）；T13b 在 T14 前保证 getCollabTabId 唯一来源已就位。

## 评审映射

验收 1-10（ruling §7）→T10/T11；11-14（v3）→T9/T10/T13；15-19（v4）→T6/T9/T8/T10；20（回归锚）→T2；21-23（v5）→T12/T6；24-27（v6）→T2/T10/T11/T6；**28-29（v7）→T6/T7（suppressed 复活窗+单活行）**。plan 约束①-⑤→T11/T10；⑥→T8/T11；⑦→T5；⑧→T7；⑨→T2；⑩→T4；⑪→T10/T11；⑫→T9（媒体字段离线编辑不炸腿并入 page.offline.spec——媒体预签名失败仅加一条回归：hydration 留 local 非媒体编辑仍可用，不新建媒体链路）；**C1→T7；C2→T6/T7；C3→T12；C4→T2/T13；P1→T3/T4；P2/P5→T13；P3→T13b；P4→T6b；P6→T9/T10**。
