# Y4b 批注域+富文本安全+A2 终裁 Implementation Plan v4

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** threads 批注域（第六顶层 Y.Map 根+全节点/文本精锚+孤儿语义）+ D10 两渲染点 DOMPurify 兜底 + A2 零放大测试锚 + m#4/m#5 双测试锚 + Y4a 豁免清偿，四笔提交。

**Architecture:** threads 完全复刻 Y4a timelines 新根先例（manifest/frame-deny L1+L2/undo-policy 装载缝物化/oracle SCAN_ROOTS/actor 观察者），外加守恒三面（exportThreadsView 整棵导出三消费）——schemaVersion 5→6 硬切。**作者身份按帧可见性分层**（同帧新建线程 L1 只断本连接〔ContentAny 收成普通对象再执法〕；追加评论父出帧归 L2 4411；**actorUserId 缺省=fail-closed 全拒**）；批注 origin=threads-user 不入任何撤销栈；孤儿=读侧判定+同步后事务内清理。

**Tech Stack:** Yjs 13.6.32 / y-prosemirror 1.3.7（getRelativeSelection）/ NestJS / zustand / DOMPurify（新依赖仅 apps/web）/ Prisma。

**Spec:** `docs/superpowers/specs/2026-11-22-y4b-annotation-security-design.md`（v5——执行规则只读 spec §0 十四条；本 plan 全部引用 §0 条号零悬空。**v4→本版增量（第五轮四处）**：①T1 夹具改 seedEmptyTimeline+断言改 ensureAutoEdges 调用次数（整 mock 模块）；②T6/T10 增「已有评论未知键 add 拒」档与「sessionUserId null 先闸」档；③T7/T8 版本门断言写法（拒载档消息正则+放行档 share.has 并排）；④字面量扫改范围收窄——doc-protocol:496 帧级故障计数与 toDocRecords 坐标 toBe(5) 一律不动、只删 327-328。）

## Global Constraints

- TypeScript strict: true；**禁垫片**（评审硬要求——根修）。
- **开工分档（spec v4 头注）**：组 0（T1-T4）现稿可即开工；组 1（T5）测试仍先红，期望值按 spec §0 条 8 的小写白名单写；组 2/3（T6-T12）正文改完（本版）再开工。四笔提交切分不变；**组 2 不得单独上生产**（与组 3 同列车）。
- **schemaVersion 5→6 同笔纪律**（spec §0 条 2）：CANVAS_DOC_SCHEMA_VERSION+CLIENT_PROTOCOL_VERSION+Prisma @default(6) 三处同笔同值；**协议数字 6 只写在这两个常量、Prisma 默认、版本门拒载夹具**——**版本门拒载档：行值 4→5+消息正则 schemaVersion=4→5+被拒文档仍断言节点 0（拒载先于重放、被拒文档无 threads 根）；share.has('threads') 在放行档与 share.has('timelines') 并排；通过档维持读常量**（collab-version-gate.spec.ts:192 现即读常量）；字面量族改读常量（docShape.schema.test:56/docShape.fillRead.test:113/collab-protocol.test:6/collab-auth-reason.test:98/project.service.spec:355+356/maintenance.hash.spec:23 夹具）；**doc-protocol.spec.ts:327-328 `toBe(5)` 双行直接删除**（:326 已读常量——常量抬 6 后这两行必红、最省事修法是把常量改回 5，必须预防；**:496 帧级故障计数与 toDocRecords 坐标 toBe(5) 非版本字面量一律不动**）；c3a:115 已读常量自然跟随+**追加 SQL 断言**（新迁移匹配 SET DEFAULT 6 且不匹配 UPDATE；历史 canvas_schema_v5_default 文件继续匹配 SET DEFAULT 5、CREATE TABLE … DEFAULT 4 原断言保持）；**迁移纪律**：只 SET DEFAULT 6、不 UPDATE 旧行。拒载不改行、不洗文档。`expect(常量).toBe(5)` 改成两常量互等或删行；`expect(结果).toBe(5)` 改 `toBe(常量)`。collab-session-guard.verdict.spec.ts:30 的 `csv: '6'` 改为 `String(CLIENT_PROTOCOL_VERSION + 1)`，并加 `String(CLIENT_PROTOCOL_VERSION - 1)` 为 SCHEMA_OUTDATED。
- **threads 编辑 origin='threads-user'**（spec §0 条 3）：UNDO_STACK_BASE 三根不动+THREADS_ORIGIN 新常量；threads 不进任何撤销栈；manifest threads 条目 undo='none'——DocUndoScope 扩 'none'。
- **作者身份按帧可见性分层+fail-closed**（spec §0 条 6）：同帧新建→L1（validateFrameDeny 二参 opts.actorUserId；**解码态不能 Y.Map.get**〔frame-deny.ts:174-175〕——按 framePathOf 把本帧 ContentAny **收成普通对象**再调谓词；**半截 entry〔缺 createdBy 等〕L1 拒、字段补下一帧=父出帧 4411 非合法创建路径**）；追加评论/改键→L2 4411；**actorUserId 缺省（undefined）=L1 与 L2 对任何 threads 变更全拒**（恢复导入空根放行带 parentSub 条目拒；服务端调用点恒传 item.actor.userId〔actor:1395〕；timelineUndo.ts:273 时间轴自检不观察 threads 不误伤）；readonly noop 在 L1 之前（:1152-1154）。
- **谓词吃普通值单源**（spec §2.3）：checkThreadEntry/checkThreadComment(id, v:unknown, actorUserId?)→string|undefined（三路同函数）；**线程键封闭=id/nodeId/kind/anchorStart/anchorEnd/resolved/createdAt/createdBy/comments、评论=id/authorId/body/createdAt；resolved=创建必写布尔（客户端写 false）；创建时 comments 至少一条（其后可删到零条线程在）；锚 base64 上限按解码后字节 ≤512；id 1~128 且等于 Map 键**。
- **L2 动作矩阵**（spec §0 条 14）：根键 add→读落成后整棵值跑两谓词（createdBy+每条 authorId=actorUserId、至少一条评论）；根键 delete 允许；**根键 update 拒**；resolved update（布尔）=唯一后续更新；entry 其他键 add/update/delete 拒；comments 键 delete/update 拒；评论 add→读落成值跑谓词；评论 update/内部键 update/delete 拒；删评论/删线程不按作者分权限。
- **守恒三面**（spec §0 条 12）：exportThreadsView=Object.fromEntries 整棵导出（禁手挑字段）；vacuumEquivalent 两侧先 getMap('threads')；canonicalDocView 加腿；recordsOfHydration:maintenance:395 加腿；**hash.spec=两份 hydration 互比形态**——threads 腿加「仅一条线程 resolved 不同→两 hash 必不同」档+夹具改读常量。actor threads 观察者只做 void ev.changes+noteEvents（touched.add 不复制）。
- **孤儿三组互斥+排序**（spec §0 条 5）：孤儿>已解决>进行中；**组内 createdAt 升序、相同按 id**；两端顺序判据=同 Y.XmlText 比 index（起点>终点=孤儿、相等=摘录空）/跨文本节点按 fragment 深度优先序比；**getSynced 判据=provider.isSynced===true**（禁复用 3s tick 的 isSynced&&!hasUnsyncedChanges）；为假时五动作零事务（前四返 false、清理返 -1）。
- **threads 永不进公开面**（spec §0 条 7）：负控钉 toReadModel JSON 不含线程 id 与评论正文（toPublicReadModel/toPublicSnapshot 入参=读模型、读模型干净后天然不长 threads）。
- **共享导出**（spec §0 条 14）：packages/shared/src/index.ts 增 threads-frame-predicate 导出（:187 timeline 先例并列——否则 web 拿不到谓词）。
- **module-size 闸**：会碰 registry:1228/oracle:380（超限抬锚+同批同步 check-collab-module-size.mjs 与 .test.mjs）；frame-deny 与 actor 不在锚表。
- **每个 commit 前跑 lint 门**；长跑 verify 必须 run_in_background；int 池必走 `-c vitest.int.config.ts`；shared dist 须重建。
- **施工单 RED 锚纪律**（dev-workflow 2026-11-22 裁定）：每任务 Step 1 写主用例按步骤序的**第一条失败断言**（含期望值），禁只写末步语义。
- **组 0 夹具警示**（spec v4 头注）：水合夹具若让对账计数仍 0，**先停下来报**——那是产品缺陷非夹具形态问题（loadProject :279 现已调 afterStructuralChange——预期纯锚即绿）。

## Review Focus

1. **同帧冒名建线程 vs 追加冒名评论**（两条执法路径）：新建档只断本连接（零 apply）；追加档 4411 关全部。测试加在 Task 9 两档分流断言。
2. **actorUserId 缺省=fail-closed**：L1/L2 不传 actorUserId 时任何 threads 变更全拒（不是「跳过作者比较」）。测试加在 Task 7 缺省档+Task 6 L2 档。
3. **半截 entry 拒**：同帧只有 entry Map、createdBy 下一帧补→L1 拒（字段补下一帧落 4411 不能当合法创建路径）。测试加在 Task 7 半截档。
4. **resolved 进守恒面**：两份 hydration 仅 resolved 不同→hash 必不同。测试加在 Task 8 互比档。
5. **DOMPurify 白名单按 codec 真输出，再按 HTML 解析收成小写**：回退 HTML=richTextOfFragment 产物（codec 写出 `<heading>/<bulletList>/<command>`，无 `<strong>/<h1>`）。消毒后断言小写标签与 media-id、label。禁用手写 `<h1><ul>` 假正例，也不断言驼峰标签原样留下。测试加在 Task 5 正例档。

---

### Task 1: m#4 水合 AutoEdge 对账锚（组0）

**Files:**
- Test: `apps/web/src/pages/canvas/video-editor/store/editorStore.test.ts`（追加 describe 块）
- Modify: 无产品码——纯测试锚（Y4a 终审批外债 m#4）

**Interfaces:**
- Consumes: `loadProject(nodeId)`（editorStore.ts:279 水合对账）、root 键观察者（:186）、`ensureAutoEdges`（timeline/auto-edges.ts:34）、`getTimelineDocRef`/`setTimelineDocRef`（stores/canvasCollabRuntime.ts:2076）。
- Produces: **doc 实水合夹具** `hydratedDocFixture()`——后续 Task 2 复用（含 timelines 根+entry Map+nodes Map 的 Y.Doc）。

- [ ] **Step 1: 写失败测试（夹具与 spec §6 对齐——第五轮裁定 4）**

追加 describe('m#4 水合 AutoEdge 对账锚（Y4a 终审批外债）')：**夹具=真 Y.Doc：getMap('nodes') set 一个非剪辑节点、getMap('timelines') set('edit1', `seedEmptyTimeline('edit1')`)〔timeline-codec.ts:28——禁用空 Y.Map：readTimelineFromDoc 对空 Map 返 null〔:176-180 version!==1/缺 tracks/clips〕、loadProject :263 早退到不了 :279、对账计数停 0=夹具不合法非产品缺陷〕**、edges 根空；`setTimelineDocRef(doc)`。**断言 `ensureAutoEdges` 的调用次数**（本套 :4 已 `vi.mock('../timeline/auto-edges', () => ({ ensureAutoEdges: vi.fn() }))` 整 mock 模块——planAutoEdgeOps 不会被调，勿 spy 它）；**主用例 1 第一条失败断言**：`act(() => useEditorStore.getState().loadProject('edit1'))` 后 `expect(ensureAutoEdges).toHaveBeenCalledTimes(1)`（现状红：无夹具覆盖、对账计数 0≠1）。主用例 2：水合完成后 root 键替换（**`set('edit1', 另一棵 seedEmptyTimeline('edit1'))`**——禁用空 Map 替换：readTimelineFromDoc 返 null、:186 `next!==null` 守卫不再对账）→观察者触发→`toHaveBeenCalledTimes(2)`（累计+1——Map 替换路径 :186 对账恰一次）。

- [ ] **Step 2: 跑测试证红**

Run: `pnpm exec vitest run src/pages/canvas/video-editor/store/editorStore.test.ts`（cwd=apps/web）
Expected: FAIL——主用例 1 第一断言 `toHaveBeenCalledTimes(1)` 实收 0。

- [ ] **Step 3: 最小修复（若红因夹具形态而非产品缺陷）**

预期两条全绿不需改产品码（editorStore.ts:279/:186 已对账——缺的只是测试；loadProject 在 readTimelineFromDoc 返 null 时 :263 早退=现有守卫勿动）。若主用例仍红在对账没发生（真缺陷）：**先呈报再动**（超出测试锚范围——禁把夹具问题修成产品改动）。

- [ ] **Step 4: 跑测试证绿**——Expected: PASS（含既有套不回归）。

### Task 2: m#5 addClip 写前检查锚+commit 返形统一（组0）

**Files:**
- Modify: `apps/web/src/pages/canvas/video-editor/store/editorStore.ts:211-216`（commit）与 `:329-359`（addClip）
- Test: `apps/web/src/pages/canvas/video-editor/store/editorStore.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 的 `hydratedDocFixture()`。
- Produces: `commit(mutate, opts?) → boolean`（true=已应用〔含 doc ref 缺席本地推进〕/false=写被拒）——**签名变更**（原 void）；addClip 沿 commit 返回值决定 `return id | null`。

- [ ] **Step 1: 写失败测试（两条主用例——m#5 预期直接绿、返形=红锚）**

主用例 A（m#5——**在合法水合夹具下现有 :332-336 已实现、预期直接绿、照写**）：`hydratedDocFixture()`（Task 1 同款 seedEmptyTimeline 夹具）+ `doc.getMap('nodes')` **不含** 'src1'；`set({status:'ready', data, sourceNodeId:'edit1'})`；`addClip({type:'video', trackId, sourceNodeId:'src1', ...})` → **`expect(result).toBeNull()`** + `expect(updateListener).not.toHaveBeenCalled()`（doc 零 update 事件）+ `expect(get().data.clips)` 不含新 clip。主用例 B（**返形统一=红锚**）：水合态+`writeTimelineToDoc` 拒（mock executeTimelineCommit 返 false）→ addClip 返 **null**（现状 :358 红在拒时仍返 id——**commit 在 writeTimelineToDoc 失败时须返 false、成功返 true，addClip 据此返 null 或 id**）+本地 data 保持 prev。

- [ ] **Step 2: 跑测试证红**——Expected: **主用例 A 直接绿**（现有实现即过——此锚是回归锁非缺陷复现）、主用例 B FAIL（红在拒时返 id 非 null）。

- [ ] **Step 3: 实现**

`commit`（:211）尾改 `return true`、写拒分支（:216 `if (…!writeTimelineToDoc(…)) return`）改 `return false`、早退分支（!s.data||status!=='ready'）返 false。`addClip`（:358）改 `if (!commit(...)) return null; return id;`。零调用方破坏（原 void 返回值无人消费）。

- [ ] **Step 4: 跑测试证绿**——Expected: PASS 全套（含 Task 1）。

### Task 3: A2 零放大测试锚（组0）

**Files:**
- Test: `apps/web/src/pages/canvas/video-editor/__tests__/collab-video-editor-a2.int.spec.ts`（新建，int 池）

**Interfaces:**
- Consumes: 画布页 collab runtime（canvasCollabRuntime openSession）、VideoEditorShell `openEditor()/close()`（stores/videoEditorStore.ts:20-21）。
- Produces: 无（纯锚）。

- [ ] **Step 1: 写失败测试**

双 client 夹具（沿用 collab int 既有基建——参照 collab-timeline-collab.int.spec 双端形态）：**主用例第一条失败断言**=画布 runtime 就绪后记录 `sessionCount`（openSession 计数或 provider 实例计数）与 doc 引用 → `openEditor('edit1')` → `loadProject` 完成 → `expect(sessionCount).toBe(先前值)`+`expect(getTimelineDocRef()).toBe(画布 doc)` → close → 再 openEditor → 同两断言（Review Focus 4 循环档）。现状红=无此锚文件。

- [ ] **Step 2: int 跑证红**——Run: `pnpm exec vitest run -c vitest.int.config.ts src/pages/canvas/video-editor/__tests__/collab-video-editor-a2.int.spec.ts`（cwd=apps/web）。Expected: FAIL/文件不存在。

- [ ] **Step 3: 补齐断言至绿**——预期纯锚即绿（现状零放大 census 实证）；若红=真放大缺陷，呈报再修。

### Task 4: Y4a 前向引用豁免清偿（组0）

**Files:**
- Modify: `docs/_meta/exemptions.json`（按 reason 整族删）

**Interfaces:** 无。

- [ ] **Step 1: 过滤删除**

Node 脚本（Bash 内联）：读 exemptions.json → `items = items.filter(e => e.reason !== 'Y4a 施工单引用批内待建文件（T2-T12 落地前 dead-path；本批消费完成即移除豁免）')` → 原格式（2 空格缩进+尾换行）写回。**按 reason 删不按条数**（实测 38 条——写回后 diff 计数仅作核对）。

- [ ] **Step 2: doc-gate 证绿**——Run: `node scripts/doc-gate.mjs`。Expected: 通过（豁免消费后零悬空引用红）。

- [ ] **Step 5: 组0 commit**

```bash
git add apps/web/src/pages/canvas/video-editor/store/editorStore.test.ts apps/web/src/pages/canvas/video-editor/store/editorStore.ts apps/web/src/pages/canvas/video-editor/__tests__/collab-video-editor-a2.int.spec.ts docs/_meta/exemptions.json
git commit -m "test(y4b): 组0——m#4 水合对账锚+m#5 addClip 写前检查锚+commit 返形统一+A2 零放大锚+Y4a 豁免清偿"
```

Commit 前门：lint+module-size 锚核对（Global Constraints）。

### Task 5: DOMPurify 兜底（组1）

**Files:**
- Create: `apps/web/src/utils/sanitizeRichTextHtml.ts` + `apps/web/src/utils/sanitizeRichTextHtml.test.ts`
- Modify: `apps/web/src/pages/canvas/components/nodes/TextInputNode.tsx:199`、`apps/web/src/pages/canvas/components/nodes/prompt-input/PromptInput.tsx:499`
- Test: `apps/web/src/pages/canvas/components/nodes/TextInputNode.test.tsx`（兼容改）

**Interfaces:**
- Produces: `sanitizeRichTextHtml(html: string): string`（两渲染点共用唯一出口）。

- [ ] **Step 1: 写失败测试（白名单按 codec 真输出——Review Focus 5）**

单测（sanitizeRichTextHtml.test.ts）四类攻击串：①`<img src=x onerror=alert(1)>`→无 onerror；②`<script>alert(1)</script>`→剥；③`<a href="javascript:alert(1)">x</a>`→剥 href；④`<style>…</style>`+`<div style="color:red">`→剥标签与属性。**正例=真实 fragment 走 richTextOfFragment**（doc-codec.ts:229-242 nodeHtmlOf——paragraph 收成 `<p>`、其余元素名原样当标签）：heading+bulletList/listItem+`<img src="media-id">`+带 label 的 command——消毒后小写标签 heading/bulletlist/listitem/command/img 与 media-id、label 都在；不断言驼峰标签原样留下；TextInputNode 现有 `<p>一只猫在窗台上</p>` 仍过。**主用例第一条失败断言**=①的 `expect(out).not.toContain('onerror')`（模块不存在=红）。

- [ ] **Step 2: 跑测试证红**——Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`pnpm --dir apps/web add dompurify && pnpm --dir apps/web add -D @types/dompurify`。模块（spec §0 条 8 codec 真标签配置）：`DOMPurify.sanitize(html, { ALLOWED_TAGS:['p','img','span','heading','blockquote','bulletlist','orderedlist','listitem','codeblock','horizontalrule','hardbreak','command','imagemention'], ALLOWED_ATTR:['src','alt','title','class','level','language','start','type','id','label','mentionsuggestionchar'], ALLOW_DATA_ATTR:false, FORBID_TAGS:['style','form','iframe','object','embed','script'], FORBID_ATTR:['style'] })`。两渲染点改 `dangerouslySetInnerHTML={{ __html: sanitizeRichTextHtml(fallbackHtml) }}`。

- [ ] **Step 4: 跑测试证绿**——vitest 两 spec（utils+TextInputNode 现有 fallback 档 :255-262 兼容过）。

- [ ] **Step 5: 组1 commit**

```bash
git add apps/web/src/utils/sanitizeRichTextHtml.ts apps/web/src/utils/sanitizeRichTextHtml.test.ts apps/web/src/pages/canvas/components/nodes/TextInputNode.tsx apps/web/src/pages/canvas/components/nodes/prompt-input/PromptInput.tsx apps/web/src/pages/canvas/components/nodes/TextInputNode.test.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "feat(y4b): 组1——D10 富文本兜底 DOMPurify 单源出口两点接线"
```

### Task 6: threads 帧谓词模块（shared 单源——组2 第一件）

**Files:**
- Create: `packages/shared/src/canvas/threads-frame-predicate.ts` + `threads-frame-predicate.test.ts`

**Interfaces:**
- Produces（Task 7/8/9/10 消费）:
  - `checkThreadEntry(id: string, v: unknown, actorUserId?: string): string | undefined`——**吃普通值**（timelineScalarErr 同形先例 frame-deny.ts:396；三路同函数：L1 从 framePathOf 收成的普通对象/L2 从落成后 entry 读出/客户端从将写对象构造）：id 等于 Map 键 1~128；kind 只允许 'node'|'text'；kind='text'→anchorStart/anchorEnd 带 padding base64、**解码后字节 ≤512**、Y.decodeRelativePosition 不抛；kind='node'→两键必无；nodeId/createdBy 非空串；**resolved 必写布尔**；createdAt∈[0,MAX_SAFE_INTEGER] 有限数；未知键拒（已知键封闭=id/nodeId/kind/anchorStart/anchorEnd/resolved/createdAt/createdBy/comments）；actorUserId 给定时 createdBy 必须相等。
  - `checkThreadComment(id: string, v: unknown, actorUserId?: string): string | undefined`——v=评论整体：authorId 非空串（相等比较=参数 actorUserId）；body JS 长度 1~2000、去首尾空白仍非空、原文不修剪；createdAt 同上档；未知键拒（id/authorId/body/createdAt 封闭）。
  - `encodeAnchorBase64` / `decodeAnchorBase64`：标准字母表加 padding。谓词先看解码字节 ≤512，再 `Y.decodeRelativePosition`。
  - `buildThreadEntry` / `buildThreadComment`：唯一的 `new Y.Map` 创建点（web store 只调用）。actorUserId 缺省时 `threadEventErr` 对任何 threads 变更返回错误。
  - `threadEventErr(ev: Y.YMapEvent<unknown>, threadsRoot: Y.Map<unknown>, opts?: { actorUserId?: string }): string | undefined`——L2 动作矩阵（spec §0 条 14）：根键 add→读落成后整棵值跑两谓词（**createdBy+每条 authorId=actorUserId、comments 至少一条**）；根键 delete 允许；**根键 update 拒**；resolved update（布尔）唯一后续更新；entry 其他键 add/update/delete 拒；comments 键 delete/update 拒；评论 add 读落成值跑谓词；评论 update/内部键 update/delete 拒；**actorUserId 缺省=任何 threads 变更全拒（fail-closed）**。

- [ ] **Step 1: 写失败测试（Review Focus 2 含缺省档——第五轮矩阵 add 档）**

主用例第一条失败断言：`checkThreadEntry('t1', { id:'t1', kind:'weird', nodeId:'n1', resolved:false, createdAt:0 }, 'u1')` → `expect(err).toContain('kind')`（模块不存在红）。矩阵档逐条：kind='text' 缺 anchor 红/'node' 带 anchor 红/垃圾 base64 红/解码字节超 512 红/**resolved 缺失红**/全空白 body 2000 内红/authorId 空串红/createdAt -1 与超 MAX_SAFE_INTEGER 红/未知键红/**actorUserId='u1' 而 createdBy='u2' 红、='u1' 过**。L2 动作矩阵档（按 path——spec §0 条 14）：合法新建线程整次 add 合法（落成后形状+至少一条评论）；resolved true→false 改动合法（唯一可更新键）；**根键 update 红**；body/authorId/锚/createdAt/createdBy/kind/nodeId/id 的 update 或 delete 红；comments 容器键 delete/update 红；删整条 entry 合法；评论 add（authorId=actorUserId）合法；**已有评论上 set 未知键发的是该键的 add——同拒（「只拒 update/delete 漏 add」会放过未知键进 hash/oracle）**；**actorUserId 缺省（undefined）时任何档 add 也拒（fail-closed）**；追加评论 authorId='u2'≠'u1' 红；**Y.Map 直传谓词前先 toJSON()**（直传 Object.keys 为空、必填项判断错——负控断言）。

- [ ] **Step 2: 跑测试证红**——Run: `pnpm exec vitest run src/canvas/threads-frame-predicate.test.ts`（cwd=packages/shared）。Expected: FAIL 模块不存在。

- [ ] **Step 3: 实现**——镜像 timeline-frame-predicate.ts 组织；字段规则照 Interfaces 逐条；`Y.decodeRelativePosition` try/catch 失败=非法；base64 校验带 padding 标准（Buffer 等价实现——shared 层无 DOM 假设）；**index.ts 导出**：`packages/shared/src/index.ts` 增 `export * from './canvas/threads-frame-predicate'`（:187 timeline 先例并列——否则 web 从 @flowweb/shared 拿不到谓词）。

- [ ] **Step 4: 跑测试证绿**——Expected: PASS。

### Task 7: threads 根接线 shared 侧（组2）

**Files:**
- Modify: `packages/shared/src/canvas/canvas-doc-manifest.ts:16`（+threads 条目 undo='none'）+ **:22-23（DocUndoScope 类型扩 'none'）** + `canvas-doc-manifest.test.ts:161-187`
- Modify: `packages/shared/src/canvas/frame-deny.ts:46`（FRAME_DENY_ROOTS+threads）+ **:128 `validateFrameDeny(update, opts?: { actorUserId?: string })` 签名扩**——threads 深链档：**同帧新建按 framePathOf 把本帧 ContentAny 收成普通对象**调 checkThreadEntry/checkThreadComment（解码态不能 Y.Map.get〔:174-175 头注〕）；**半截 entry（只有 Map、缺 createdBy 等）L1 拒**——字段补下一帧=父出帧落 4411 非合法创建路径（Review Focus 3）；**actorUserId 缺省=带任何 threads 变更的帧拒**（恢复导入空根放行带 parentSub 条目拒——Review Focus 2 缺省档）+ L1 直档（:179-183 timelines 同形）+ **L2 root-identity 分支调 threadEventErr**（:527-531 同形——事件循环第一行、path.length===0 continue 之前）+ `L2Options`（:490）增 `actorUserId?: string`
- Modify: `packages/shared/src/collab/undo-policy.ts`（:44 同排增 `export const THREADS_ORIGIN = 'threads-user'`）
- Modify: `packages/shared/src/canvas/docShape.ts:60`（5→6）+ `:161-165`（fillDoc 尾 `doc.getMap('threads')`）
- Modify: `packages/shared/src/constants/collab-protocol.ts`（CLIENT_PROTOCOL_VERSION 5→6）
- **硬编码 5 字面量族**（Global Constraints 清单）：`docShape.schema.test.ts:56`、`docShape.fillRead.test.ts:113`、`collab-protocol.test.ts:6`、`collab-auth-reason.test.ts:98`——改读常量；**`doc-protocol.spec.ts:327-328` `toBe(5)` 双行直接删除**（:326 已读常量——常量抬 6 后这两行必红、最省事修法是把常量改回 5，必须预防）；**扫改范围收窄（第五轮）**：`doc-protocol.spec.ts:496` 的 `toBe(5)` 是帧级故障计数、`docShape.toDocRecords.test.ts` 坐标 `toBe(5)` 是位置值——**两者都不是版本字面量一律不动，只删 327-328 两行**
- Modify: `packages/shared/src/canvas/doc-codec.ts`——**零改动**（toReadModel :329 只拼 nodes/edges 天然不含 threads；本任务加负控见测试）

**Interfaces:**
- Consumes: Task 6 谓词。
- Produces: 六根 manifest（Task 8/9 消费）；`THREADS_ORIGIN`（Task 10 消费）；validateFrameDeny 二参形态（Task 8 连接帧传 actorUserId）。

- [ ] **Step 1: 写失败测试**

①manifest 六根：`canvas-doc-manifest.test.ts` sorted 断言改六根+threads 条目 undo='none' 先红（threads 未登记）。②frame-deny L1 同帧新建档：构造整棵线程同帧插入（entry+comments+首条评论）+opts.actorUserId——合法（createdBy/authorId=actorUserId、**resolved:false 在帧内**）过、冒名（'u2'≠'u1'）拒、**缺省 opts 带条目帧拒（fail-closed）、空 threads 根放行**、**半截 entry（只有 Map 缺 createdBy）拒**（Review Focus 2+3）。③L1 非法矩阵：entry 非 Map/kind 越界/垃圾 base64/空白 body→validateFrameDeny 拒。④frame-deny L2 动作矩阵：物化事件跑 validateAppliedL2——合法新建线程整次 add 合法（**落成后形状+comments 至少一条**）；resolved 置布尔合法；**根键 update 拒**；body 改动拒；追加评论 authorId≠opts.actorUserId 拒；**opts.actorUserId 缺省=threads 事件全拒**。⑤负控 A7：带 threads 的 doc 进 `toReadModel` → JSON `expect(out).not.toContain(threadId)`+`not.toContain('评论正文')`。⑥undo 负控 A6：doc 带 threads entry；LocalUser origin 画布事务后 `undoManager.undo()`——threads 内容不变。

- [ ] **Step 2: 跑测试证红**——Run: `pnpm exec vitest run`（cwd=packages/shared）。Expected: FAIL 六档。

- [ ] **Step 3: 实现**——照 Interfaces 逐处；L2 分支 root 身份=安装观察者处 `doc.getMap('threads')` 取一次存引用（谓词内禁 getMap）；validateAppliedL2 的 actorUserId 缺省（undefined）时，任何 threads 变更都拒绝（fail-closed；服务端调用点恒传——Task 8）；**actor observer 只做 void ev.changes+noteEvents 两件事（touched.add 不复制）在 Task 8**。

- [ ] **Step 4: 跑测试证绿**——Expected: PASS 全套（含字面量族已读常量档）。

### Task 8: schema 5→6 硬切+api 守恒三面（组2）

**Files:**
- Modify: `apps/api/prisma/schema.prisma:882`（@default(5)→(6)）+ 新迁移（**只 SET DEFAULT 6、不 UPDATE 旧行；历史 v5 迁移文件不动**）
- Modify: `apps/api/src/modules/collab/collab-doc-registry.service.ts:588-595`（装载缝 threads 物化——SERVER_TRANSACT_ORIGIN）+ `:825-839`（vacuumEquivalent **两侧先 getMap('threads') 再比** stableStringify(exportThreadsView)）
- Modify: `apps/api/src/modules/collab/collab-canary-semantic.ts`（`exportThreadsView(root)=Object.fromEntries(root.entries())` 整棵导出〔:55 exportTimelineView 同形〕+canonicalDocView :39-42 拼串加 threads 腿）
- Modify: `apps/api/src/modules/collab/collab-maintenance.service.ts:395`（**recordsOfHydration 返回形状加 threads 腿**——hash 面）
- Modify: `apps/api/src/modules/collab/oracle-worker.service.ts:56`（SCAN_ROOTS+threads）
- Modify: `apps/api/src/modules/collab/collab-project-actor.service.ts:1173-1177`（**validateFrameDeny 调用改传 `{ actorUserId: item.actor.userId }`**）+ `:343-353`（threads observeDeep——**只做 void ev.changes+noteEvents 两件事、touched.add 不复制**）+ `:1393-1395`（validateAppliedL2 调用传 `actorUserId: item.actor.userId`）
- Modify: `apps/api/src/modules/collab/collab-version-gate.spec.ts`（**拒载档写在现有 sv=4 拒载组：行值 4→5+消息正则 `schemaVersion=4`→`schemaVersion=5`+被拒文档仍断言节点数 0**〔拒载发生在重放之前——被拒文档上不该有 threads 根〕；**share.has('threads') 写在放行档、与现有 share.has('timelines') 并排两条都保留**；通过档维持读常量 :192 不动；历史 CREATE TABLE … DEFAULT 4 与 canvas_schema_v5_default 的 SET DEFAULT 5 原断言保持）
- Modify: `apps/api/src/modules/collab/collab-session-guard.verdict.spec.ts`（`csv: '6'` 改为 `String(CLIENT_PROTOCOL_VERSION + 1)`；加 current-1 为 SCHEMA_OUTDATED）
- Modify: `apps/api/src/modules/project/project.service.spec.ts:355+356`（:355 改 `toBe(CANVAS_DOC_SCHEMA_VERSION)`；:356 改为两常量互等或删行）
- Modify: `apps/api/src/modules/collab/collab-maintenance.hash.spec.ts`（**互比形态加 threads 腿档**：两边 nodes/edges/timelines 相同、仅一条线程 resolved 不同→两条 hash 必不同；夹具 :23 schemaVersion:5 改读常量）
- Modify: `apps/api/src/modules/collab/c3a-schema.int.spec.ts`（**追加 SQL 断言**：新迁移匹配 SET DEFAULT 6 且不匹配 UPDATE；历史 canvas_schema_v5_default 文件继续匹配 SET DEFAULT 5——v5 扫描保留）
- Modify: `scripts/check-collab-module-size.mjs`（registry/oracle 超限抬锚——**同批同步其 .test.mjs 断言**）

**Interfaces:**
- Consumes: Task 7 六根 manifest/版本常量/validateFrameDeny 二参形态；Task 6 谓词。
- Produces: 装载缝物化（Task 10 客户端依赖同名根已存在）；exportThreadsView（负控消费）；**维护 hash 仍是两份 hydration 互比**（加 resolved 翻转档，不加金丝雀 hex）。

- [ ] **Step 1: 写失败测试（int 池）**

新建/扩展 `collab-threads-conservation.int.spec.ts`+`c3a-schema.int.spec.ts` 档：①版本门**拒载档：行值 sv=5 拒+消息正则 schemaVersion=5+被拒文档断言节点数 0**（拒载先于重放——被拒文档无 threads 根）；**放行档：share.has('threads') 与现有 share.has('timelines') 并排**（通过档维持读常量）。②装载缝：loadDocument 后 `share.has('threads')`（现状红）。③守恒负控 A7′+Review Focus 4：双 doc 同 threads 内容→副本少一条评论→`vacuumEquivalent(a,b)` **false**+canonicalDocView 摘要不+；**副本仅一条线程 resolved 翻转（不删条目）→等价仍 false**（防手挑字段实现——resolved 必须进守恒面）。④oracle：SCAN_ROOTS 断言含 threads（现状红）。⑤actor：threads observeDeep 物化档——非法 threads 事件可达 L2（现状红=无观察者）。⑥**c3a SQL 断言**：新迁移文件匹配 `SET DEFAULT 6` 且不匹配 `UPDATE`；历史 canvas_schema_v5_default 文件继续匹配 `SET DEFAULT 5`（历史 CREATE TABLE … DEFAULT 4 原断言保持）。

- [ ] **Step 2: int 跑证红**——Run: `pnpm exec vitest run -c vitest.int.config.ts src/modules/collab/collab-threads-conservation.int.spec.ts src/modules/collab/c3a-schema.int.spec.ts`（cwd=apps/api）。Expected: FAIL 五档。

- [ ] **Step 3: 实现**

prisma 迁移：`pnpm exec prisma migrate dev --name threads_root_schema6`——**人工核对生成 SQL 只含 SET DEFAULT 6 无 UPDATE**（Y4a 先例直跑可用）→rebaseline-delta --update+人工审阅。canary `exportThreadsView`：整棵 Object.fromEntries（**禁手挑字段**）。registry 装载缝 :588 同形+vacuumEquivalent 两侧 getMap 对称+threads 深比腿。actor :1173 准入链传 actorUserId/:1393 L2 传 actorUserId。hash.spec 摘要按新腿更新钉死（**不为旧 hash 拿掉腿**）。module-size 超限抬锚（registry 现 1228/oracle 现 380——同批同步 .test.mjs）。

- [ ] **Step 4: int+单测证绿**——Expected: PASS（含 collab-shrink.spec 根集守恒六根档、c3a v6 断言、hash.spec 新摘要）。

### Task 9: threads 服务端准入+L1/L2 分层执法集成档（组2）

**Files:**
- Test: `apps/api/src/modules/collab/collab-threads-gate.int.spec.ts`（新建，int 池）

**Interfaces:**
- Consumes: Task 6/7/8 全部接线。
- Produces: 无（集成锚）。

- [ ] **Step 1: 写失败测试（两档冒名分流——Review Focus 1 主档）**

双连接夹具（沿用 gateway/actor int 基建）：**主用例第一条失败断言**=连接 A（user u1）submit **同帧新建线程**合法帧→连接 B 收到广播（现状红=threads 帧未被接线）；**档①同帧冒名**：A submit 同帧新建冒名帧（createdBy/首条 authorId='u2'≠u1）→ **A 连接被断、B 连接仍在、doc 不含该线程**（L1 执法只断责任连接——现状红）；**档②追加冒名**：先合法建线程→A submit 对**已有线程**追加评论帧（authorId='u2'，父级出帧）→ apply 后 L2 → **4411 关全部+从已落库水位重放**（现状红=无 threads L2 档）；档③L2 不可变键：body 改动帧→4411 同档；档④readOnly（Review Focus 旧 1）：readOnly 连接 submit threads 帧→**noop-readonly 短路**（连接在、文档不变、零 threads 专用分支——配额 4404 不动）；档⑤负控：合法 createThread/addComment/resolve/deleteThread 四帧全过闸广播。

- [ ] **Step 2: int 跑证红**——Expected: FAIL 主档第一断言。

- [ ] **Step 3: 最小接线修复**——预期 Task 6-8 已使全档绿；红在哪层修哪层（同帧新建漏拦→frame-deny threads 深链 actorUserId 档；追加漏拦→L2 root-identity 分支）。**禁调既有闸阈值、禁新增关闭协议**。

- [ ] **Step 4: int 证绿**——Expected: PASS 四档。

- [ ] **Step 5: 组2 commit**

```bash
git add packages/shared/src/index.ts packages/shared/src/canvas/threads-frame-predicate.ts packages/shared/src/canvas/threads-frame-predicate.test.ts packages/shared/src/canvas/canvas-doc-manifest.ts packages/shared/src/canvas/canvas-doc-manifest.test.ts packages/shared/src/canvas/frame-deny.ts packages/shared/src/canvas/frame-deny.spec.ts packages/shared/src/canvas/docShape.ts packages/shared/src/canvas/docShape.schema.test.ts packages/shared/src/canvas/docShape.fillRead.test.ts packages/shared/src/collab/undo-policy.ts packages/shared/src/collab/doc-protocol.spec.ts packages/shared/src/constants/collab-protocol.ts packages/shared/src/constants/collab-protocol.test.ts packages/shared/src/constants/collab-auth-reason.test.ts apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/modules/collab apps/api/src/modules/project/project.service.spec.ts scripts/check-collab-module-size.mjs scripts/check-collab-module-size.test.mjs
git commit -m "feat(y4b): 组2——threads 第六根接线九处+schema 6 硬切+守恒三面+L1/L2 分层执法（发布须与组3同列车）"
```

（git add 含 prisma 迁移目录整夹；shared dist 重建后 api/web 消费——Commit 前门全跑。）

### Task 10: threadsStore 写链（组3）

**Files:**
- Create: `apps/web/src/stores/threadsStore.ts` + `threadsStore.test.ts`
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts`（attach 处挂 threadsStore）

**Interfaces:**
- Produces（Task 11 消费）:
  - `attachThreads(doc: Y.Doc, getSynced: () => boolean): void`——runtime 装载后调用；**getSynced 判据=provider.isSynced===true（首包同步完成标志——禁复用 3s tick 的 isSynced&&!hasUnsyncedChanges）**
  - `setSessionUserId(uid: string | null): void`——canvas 页面从 AuthContext（AuthProvider.tsx:21 `user: User|null`）挂载时写
  - `createThread(input: { nodeId: string; kind: 'node'|'text'; anchorStart?: string; anchorEnd?: string; body: string }): boolean`
  - `addComment(threadId: string, body: string): boolean`；`setResolved(threadId: string, resolved: boolean): boolean`；`deleteThread(threadId: string): boolean`
  - `cleanupOrphans(): number`——getSynced() false → 返 -1 零事务；true → **单 threads-user 事务内**重算孤儿键集（判据：nodeId∉nodes 根；或 kind='text' 解码/落位失败〔type===片段或 Y.isParentOf(fragment,type._item)〕或两端颠倒）逐键删、返删数
  - `threadsView$: selector`——三组互斥（优先级序：**孤儿>已解决（resolved&&!orphan）>进行中（其余）**；进行中再按 nodeId 分组）。订阅 threads.observeDeep、nodes 键增删、每条文本锚的 content 片段 observeDeep。任何 origin 都重算，不跳过自己的 origin。孤儿含锚定摘录：存活 text 锚解析窗口文本**最多 80 个 UTF-16 码元**不回写；**组内排序=createdAt 升序、相同按 id**
- 全部写动作：threads-user origin+**写前谓词=Task 6 checkThreadEntry/checkThreadComment 同函数**（含作者比较 sessionUserId）+**观察者只做投影（任何 origin 含 threads-user 都从 doc 重算视图——纯读投影无写回、无回声跳过面）**；**getSynced() 为假时五动作全部零事务先闸（前四返 false、清理返 -1）**。

- [ ] **Step 1: 写失败测试（分辨力形态——spec §0 条 5）**

主用例第一条失败断言：attachThreads+setSessionUserId('u1')+doc 物化 threads 根+getSynced=()=>true → `createThread({nodeId:'n1',kind:'node',body:'hello'})` → `expect(doc.getMap('threads').size).toBe(1)`+entry envelope 字段齐（**含 resolved:false**）+首条评论 authorId='u1'（模块不存在红）。**档②未同步闸（五动作全零事务）**：getSynced=()=>false → createThread/addComment/setResolved/deleteThread/cleanupOrphans 五动作全部 `expect(updateListener).not.toHaveBeenCalled()`+**前四返 false**、cleanupOrphans 返 -1。**档②′sessionUserId null 闸**：setSessionUserId(null) → 五动作同样零事务全返 false/-1——**null 直接先闸，不把 undefined 传进谓词指望它跳过作者比较**。**档③清理分辨力（A14″）**：测试包住 `doc.transact`，在清理回调之前先把其中一条孤儿的 node 补回、再插一条 nodeId 存在的合法新线程。清理后**补回者与新线程都在、另一条孤儿消失**。不给 cleanupOrphans 加钩子参数（「事务外先摘清单」实现必红）。档④写前谓词单源自检：构造非法 body（全空白）→createThread 拒、零事务。档⑤孤儿摘录：kind='text' 锚解出落位异节点片段→orphan 组+文档不改。档⑥**观察者只做投影**：任何 origin（含 threads-user）都从 doc 重算视图（纯读投影无写回——断言 threads-user 写后观察者视图同步更新）。

- [ ] **Step 2: 跑测试证红**——Expected: FAIL 模块不存在。

- [ ] **Step 3: 实现**——照 Interfaces。entry/comment 的 Y.Map 用 Task 6 的 shared 工厂，本文件不写 `new Y.Map`。**getSynced 判据=provider.isSynced===true**（首包同步完成标志——禁复用 3s tick 的 isSynced&&!hasUnsyncedChanges，后者在正常未确认编辑期间会把批注写死）；为假时五动作全部先闸（前四返 false、清理返 -1）；写前谓词=Task 6 同函数（checkThreadEntry/checkThreadComment+sessionUserId 比较）；**createThread 事务单独 threads-user**（选区先读 `getRelativeSelection` 的 anchor/head，右到左先对调，base64 用谓词模块，再开事务——禁混入 ySyncPluginKey 编辑事务）；**createThread envelope 必写 resolved:false**；投影订阅 threads、nodes 键增删、文本锚 content 片段，任何 origin 都重算；孤儿顺序判据=两端绝对位置同一 Y.XmlText 比 index（起点>终点=孤儿、相等=摘录空；任一端不是 Y.XmlText=孤儿）/跨文本节点按 fragment 深度优先序比；id 用 genId〔video-project.ts:51 crypto.randomUUID〕。

- [ ] **Step 4: 跑测试证绿**——Expected: PASS。

### Task 11: 批注 UI 三面（组3）

**Files:**
- Create: `apps/web/src/pages/canvas/components/NodeContextMenu.tsx`（入口 A——CanvasView.tsx:291-296 现仅 GROUP 档，非组节点扩展 setNodeContextMenu）
- Create: `apps/web/src/pages/canvas/components/threads/ThreadComposer.tsx`（评论输入框——node/text 两形态）
- Create: `apps/web/src/pages/canvas/components/threads/ThreadsPanel.tsx`（侧滑面板三组+清理）
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx`（onNodeContextMenu 非组分支+菜单状态）、`CanvasTopBar.tsx`（「批注」按钮）、`apps/web/src/pages/canvas/components/nodes/TextInputNode.tsx`（选区浮标入口 B）、`apps/web/src/pages/canvas/page.tsx`（挂 threadsStore.setSessionUserId/面板挂载）
- Test: `NodeContextMenu.test.tsx`+`ThreadsPanel.test.tsx`（新建）

**Interfaces:**
- Consumes: Task 10 threadsStore 全动作；`getRelativeSelection(binding, state)`（y-prosemirror 1.3.7 sync-plugin.js:286 已导出）+ `ySyncPluginKey.getState(state).binding`；`resolveNodeXmlFragment(doc, nodeId, 'content')`（collab/yXmlFragmentBinding.ts:20-28）；AuthContext user。

- [ ] **Step 1: 写失败测试**

主用例第一条失败断言：render NodeContextMenu（nodeId/x/y）→菜单项「批注」存在+点击回调 onAnnotate(nodeId)（组件不存在红）。ThreadsPanel 档：三组渲染（active 按 nodeId 分组+摘录、resolved 折叠+计数、orphan 徽标+「清理全部」→cleanupOrphans 调用）；空态档。

- [ ] **Step 2: 跑测试证红**——Expected: FAIL。

- [ ] **Step 3: 实现**

入口 A：CanvasView onNodeContextMenu 非组分支 setNodeContextMenu（GroupContextMenu.tsx:28-124 同款定位模式）；菜单单项「批注」→ThreadComposer（node 形态：nodeId+textarea；text 形态：预填锚点——TextInputNode 选区非空时浮标按钮 → getRelativeSelection 读 start/end → Y.encodeRelativePosition→base64 → composer 提交 createThread）。**视觉按现有界面规范出一版**（spec §10 裁定 6——antd 既有组件族，不另立视觉体系）。page.tsx 挂载：useEffect 里 `setSessionUserId(user?.id ?? null)`。

- [ ] **Step 4: 跑测试证绿**——Expected: PASS。

### Task 12: threads 双端协作 int（组3）

**Files:**
- Test: `apps/web/src/pages/canvas/__tests__/collab-threads-collab.int.spec.ts`（新建，int 池）

**Interfaces:** Consumes: Task 8 装载缝+Task 10/11 全链。

- [ ] **Step 1: 写失败测试（A15+A15′）**

双 client 夹具（collab int 基建）：**主用例第一条失败断言**=A `createThread`→B 观察者视图含该 thread（现状红=无此 spec 文件）。档②：B 删节点（画布事务）→A 侧 threadsView orphan 含该 thread（**删节点不删线程**）；档③A15′：A `undoManager.undo()`（撤销删节点）→thread **自动离开 orphan 组**+`expect(threadsUpdateListener).not.toHaveBeenCalled()`（**零新 threads-user 事务**）；档④：A cleanupOrphans→双端 threads 根一致（该 thread 双端消失）；档⑤服务端中转全链：A 帧经服务端闸广播 B（隐含主档）。

- [ ] **Step 2: int 跑证红**——Expected: FAIL 文件不存在。

- [ ] **Step 3: 全链补齐至绿**——预期 Task 6-11 已使五档绿；红处定位到层修复。

- [ ] **Step 4: 组3 commit**

```bash
git add apps/web/src/stores/threadsStore.ts apps/web/src/stores/threadsStore.test.ts apps/web/src/stores/canvasCollabRuntime.ts apps/web/src/pages/canvas/components/NodeContextMenu.tsx apps/web/src/pages/canvas/components/threads apps/web/src/pages/canvas/components/CanvasView.tsx apps/web/src/pages/canvas/components/CanvasTopBar.tsx apps/web/src/pages/canvas/components/nodes/TextInputNode.tsx apps/web/src/pages/canvas/page.tsx apps/web/src/pages/canvas/__tests__/collab-threads-collab.int.spec.ts
git commit -m "feat(y4b): 组3——threadsStore 写链+批注 UI 三面+双端协作锚（与组2同列车发布）"
```

### Task 13: 批末 verify full+推送

- [ ] **Step 1: verify full（run_in_background 必用）**——全池 36 门（api/web/shared+int+module-size+doc-gate+bench smoke）。在册 flake 处置照旧（gateway coalesce/bench-load-smoke=rerun-failed-jobs 禁调阈值）。
- [ ] **Step 2: 呈报四笔 diff 摘要+CI**——push（7890 代理瞬断重试先例）→CI 监收至终态。

---

## Self-Review 记录

- **Spec 覆盖**：spec v4 §0 条 1-14→Task 1-13 全对应（条 1=T1-T5/条 2=T7 字面量族+doc-protocol:327-328 删除+T8 拒载夹具+SQL 断言/条 3=T7 undo 负控+T10/条 4=T10+T11/条 5=T10 五动作闸+分辨力档③+T12/条 6=T6-T9 两档分流+fail-closed+半截 entry/条 7=T6 键封闭+resolved 必写+T8 负控/条 8=T5 codec 白名单/条 9=T3/条 10=T1-T2/条 11=T4/条 12=T8 守恒整棵+hash 互比档/条 14=T6 动作矩阵+index.ts 导出）。§8 锚 A1-A16→Task 7-12 逐条落位（A3 拒载夹具+双行删除=T7/T8/A4 半截 entry=T7 档②/A5+A5′ 两档分流=T7 谓词档+T9 集成档/A7′+A14″ 互比+分辨力=T8/T10/A14′ 五动作闸=T10 档②）。
- **类型一致**：commit boolean（T2 定义、T10 threadsStore 不消费——独立）；checkThreadEntry/checkThreadComment（普通值三路同函数+resolved 必写）/threadEventErr（动作矩阵+fail-closed）/THREADS_ORIGIN/六根/DocUndoScope 'none'——T6-T11 交叉一致；validateFrameDeny 二参（T7 定义、T8 :1173 传 actorUserId）/validateAppliedL2 opts.actorUserId（T7 定义、T8 :1393 传）同形；threadsView$ 排序=createdAt 升序相同按 id（T10 定义、T11 面板消费同序）。
- **发布纪律**：组0/1 两 commit 不含 schema 6 文件（已核 Files 清单——版本常量只在 Task 7/8）；组2 commit 注明同列车。
- **比例**：plan ≈ spec 的 1.4 倍（决策密度档——无函数体誊写）。
