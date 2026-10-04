<!-- doc-status: historical | verified_at: n/a -->
# 协作删除持久化缺陷修复（变更驱动落库）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 R1 判据 2 FAIL——远端删除从不落库（SV 判等吞纯删除 + `!lastSV` 静默跳过双根因），改为 update 事件驱动的变更收集落库（pending 队列）。

**Architecture:** `doc.on('update')` 收集增量到 `WeakMap<Y.Doc, Uint8Array[]>`（数组身份恒定，原地封顶）；storeDocument 取批 mergeUpdates 单行落库、失败回灌、compact 分治 WARN；disconnect 吞错 + unflushed 兜底 Map + wrote 才 compact；loadDocument 注册先于第一个 await、抑制窗口收窄到同步段、stash 窗口外回灌。

**Tech Stack:** NestJS + Hocuspocus 4.6.0 + yjs 13.6.32 + vitest（mock 型，无真库）+ prom-client。

**Spec:** `docs/superpowers/specs/collab-delete-persist-fix.md`（v4，已确认）

---

## 文件结构

| 文件 | 动作 | 职责 |
|------|------|------|
| `apps/api/src/modules/collab/collab.gateway.ts` | 重写核心 | loadDocument/storeDocument/disconnect 换变更驱动；删 persistedSVs/svSatisfied/`!lastSV` |
| `apps/api/src/modules/collab/store.metrics.ts` | 新建 | 4 个 prom-client 指标（yjs_ 前缀，对齐 sv-wait.metrics.ts 范式） |
| `apps/api/src/modules/collab/collab.gateway.spec.ts` | 修改 | 红 5 条 + 绿守护 17 条 + provider e2e + 适配现有 4 条用例 |
| `apps/api/src/modules/collab/canvas-doc-update.repository.ts` | 修改 | `compact(): Promise<Uint8Array \| null>` → `Promise<void>`（snapshotSV 死代码收口） |
| `apps/api/src/modules/collab/canvas-doc-update.repository.spec.ts` | 修改 | compact void 断言收口（防假绿）+ 恢复路径/幂等用例 |
| `docs/superpowers/specs/enhancements-design*.md`（执行时 grep 定位） | 修改 | spec 2.2 判据修订（update 事件驱动 + 水位不变量） |
| `docs/superpowers/plans/2026-09-28-canvas-group-r1-infra-geometry.md` | 修改 | 判据 2 相关表述附证伪说明 |

**不动**：sv.util.ts（读路径仍用）、collab-document.service.ts、collab-redis-sync.service.ts、collab.gateway.multi-instance.spec.ts。

## 测试基建约定（全 plan 适用）

- 运行命令一律 `cd D:/flowweb/apps/api && npx vitest run src/modules/collab/collab.gateway.spec.ts`（仓库级用例换成对应文件；vitest 环境陷阱见记忆：cwd 必须显式绝对路径）。
- hooks 级用例通过现有 `extractHooks()` 直调 hook（绕过 debounce）；**全部用例 load 与 store/disconnect 传同一 `Y.Doc` 实例**（生产中同文档名同实例；旧用例分离实例的构造在本 plan Task 4 适配）。
- mock repo 形状（现有 beforeEach 已有，仅 append 基础实现改台账——见 Task 1 Step 1）：`{ append, loadUpdates, count, compact }`；`prisma.canvasDoc.findUnique` 默认 `null`。
- **appendedRows 用显式台账（durableRows），禁止用 `mock.results` 过滤 reject**——已探针实证：`mockRejectedValueOnce` 的调用是同步 return 一个 rejected promise，`results[i].type` 恒 `'return'`（异步结局走 settledResults，不进 results），过滤条件恒真、滤不掉失败调用。
- 每个红/绿用例的判别力锚两段断言 + canonical 等价，统一走 Task 1 的 helper，**禁止各写各的 replayOf**。

---

### Task 1: 测试 helper + 红1（纯删除 diff append）

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.spec.ts`

- [ ] **Step 1a: 改造共享 beforeEach 的 append mock 为显式台账（现有 spec 文件顶层 describe 内唯一 beforeEach，:57-62 的 repo 块）——`let repo: any;`（:32）旁加声明，append 基础实现推入台账**

```ts
    let durableRows: Uint8Array[] = [];   // 持久化台账：只记真正 resolve 落库的 append 行（beforeEach 重置）
```

beforeEach 内 repo 块改为：

```ts
    durableRows = [];
    repo = {
      append: vi.fn(async (_pid: string, u: Uint8Array) => { durableRows.push(new Uint8Array(u)); }),   // 台账：once 队列（mockRejectedValueOnce/mockImplementationOnce）优先于基础实现，失败调用不进台账（探针实证 mock.results 过滤不可用——rejected promise 是同步 return，results.type 恒 'return'）
      loadUpdates: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      compact: vi.fn().mockResolvedValue(null),
    };
```

- [ ] **Step 1b: 在顶层 describe 内（`connect` 定义之后、各 `it` 之前）写入共享 helper（顶层作用域供 `增量持久化` 子 describe 与 Task 7 e2e 共用）；该文件内已有的旧 `extractHooks` 定义（`增量持久化` 子 describe 内）删除（由顶层版本取代，onStoreDocument 返回类型同步为 Promise<boolean>）**

```ts
    function extractHooks() {
      return (gateway as any).hooks as {
        onLoadDocument: (p: any) => Promise<any>;
        onStoreDocument: (p: any) => Promise<boolean>;   // 类型与实现一致（绿8b 消费 boolean 返回值）
        onDisconnect: (p: any) => Promise<void>;
      };
    }

    /** canonical 规范化：经新 doc 再编码，消除 GC 历史差异（不变量 1 主判据；raw 字节等价仅辅助锚——
     *  GC 历史差异可致伪红，比例随操作分布浮动，勿当定理；fuzz 实验记录见 spec 绿11：60 次试验 10 次伪红、canonical 0 次） */
    const canonical = (d: Y.Doc) => {
      const t = new Y.Doc();
      Y.applyUpdate(t, Y.encodeStateAsUpdate(d));
      return Buffer.from(Y.encodeStateAsUpdate(t));
    };
    const bufEq = (a: Uint8Array | Buffer, b: Uint8Array | Buffer) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
    const replayOf = (rows: Uint8Array[]) => {
      const d = new Y.Doc();
      for (const u of rows) Y.applyUpdate(d, u);
      return d;
    };
    /** 已落库的 append 行（台账快照）——失败注入用例里被 reject 的批不得算作持久化状态（Step 1a 台账保证） */
    const appendedRows = (): Uint8Array[] => durableRows.slice();
    /** 持久化等价断言（唯一入口）：前置——pending 必须已 drain（否则"等价"无意义）；重放成功行 ≡ 内存 doc（canonical + 语义双判据） */
    const expectDurableEquivalent = (doc: Y.Doc) => {
      expect((gateway as any).pendingUpdates.get(doc) ?? []).toHaveLength(0);
      const d = new Y.Doc();
      for (const u of appendedRows()) Y.applyUpdate(d, u);
      expect(bufEq(canonical(d), canonical(doc))).toBe(true);
      expect(d.getMap('nodes').toJSON()).toEqual(doc.getMap('nodes').toJSON());
      return d;
    };
```

- [ ] **Step 2: 写红1 测试（追加到同一 describe）**

```ts
    it('红1：纯删除 diff append——SV 不变不得当"无变化"跳过', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', new Y.Map());
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(1);   // 插入 append#1（新旧实现都成立）
      const svBefore = Y.encodeStateVector(doc);
      doc.getMap('nodes').delete('n1');
      // 不变量 4：删除不产生新 struct、SV 字节不变（本次事故根因的反直觉事实）
      expect(Buffer.from(Y.encodeStateVector(doc))).toEqual(Buffer.from(svBefore));
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(2);   // 红：现状 SV 判等挡住，恒 1
      // 判别力锚两段：插入行真实被捕 + 删除真实生效（防"重放空 doc"恒真）
      const rows = appendedRows();
      expect(replayOf([rows[0]]).getMap('nodes').has('n1')).toBe(true);
      expectDurableEquivalent(doc);
      expect(replayOf(rows).getMap('nodes').has('n1')).toBe(false);
    });
```

- [ ] **Step 3: 运行验证红**

Run: `cd D:/flowweb/apps/api && npx vitest run src/modules/collab/collab.gateway.spec.ts -t "红1"`
Expected: FAIL——`expected 2 times, got 1`（第 2 次 append 未发生，SV 判等挡住）。其余现有用例不受影响（本测试是新增）。

- [ ] **暂不 commit（与 Task 2 红批一起 commit）**

---

### Task 2: 红2a/2b/3/4（断连 flush、缓存复用、117 直测、加载窗口白盒）

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.spec.ts`

- [ ] **Step 1: 写红2a（判据 2 精复现——纯删除后断连 flush）**

```ts
    it('红2a：判据2 精复现——纯删除后无编辑，断连 flush 落库', async () => {
      const { onLoadDocument, onStoreDocument, onDisconnect } = extractHooks();
      const doc: any = new Y.Doc();
      doc.getConnectionsCount = () => 0;
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', new Y.Map());
      await onStoreDocument({ document: doc, documentName: 'project:p1' });   // append#1 插入
      doc.getMap('nodes').delete('n1');
      await onDisconnect({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(2);   // 红：现状 flush 被 SV 判等挡住
      expect((repo.append as any).mock.invocationCallOrder[0]).toBeLessThan((repo.compact as any).mock.invocationCallOrder[0]);  // flush 先于 compact
      const rows = appendedRows();
      expect(replayOf([rows[0]]).getMap('nodes').has('n1')).toBe(true);
      expect(replayOf(rows).getMap('nodes').has('n1')).toBe(false);
    });
```

- [ ] **Step 2: 写红2b（必现路径——断连后同 doc 再变更）**

```ts
    it('红2b：删完断连后同 doc 再变更——重放等价（次数从序列推导，旧实现=1、新实现=3）', async () => {
      const { onLoadDocument, onStoreDocument, onDisconnect } = extractHooks();
      const doc: any = new Y.Doc();
      doc.getConnectionsCount = () => 0;
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', new Y.Map());
      await onStoreDocument({ document: doc, documentName: 'project:p1' });   // #1 插入
      doc.getMap('nodes').delete('n1');
      await onDisconnect({ document: doc, documentName: 'project:p1' });       // #2 flush 删除（现状被挡）
      doc.getMap('nodes').set('n2', new Y.Map());                              // 缓存复用后再写入
      await onStoreDocument({ document: doc, documentName: 'project:p1' });   // #3（现状 !lastSV 静默）
      expectDurableEquivalent(doc);                    // 主判据
      expect(repo.append).toHaveBeenCalledTimes(3);     // 辅助断言：新实现序列 =3
      expect(replayOf(appendedRows()).getMap('nodes').has('n1')).toBe(false);
      expect(replayOf(appendedRows()).getMap('nodes').has('n2')).toBe(true);
    });
```

- [ ] **Step 3: 写红3（117 直测——`!lastSV` 静默跳过）**

```ts
    it('红3：117 直测——flush 删 SV 后同 doc 写入不得静默丢', async () => {
      const { onLoadDocument, onDisconnect, onStoreDocument } = extractHooks();
      const doc: any = new Y.Doc();
      doc.getConnectionsCount = () => 0;
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('u1', new Y.Map());
      await onDisconnect({ document: doc, documentName: 'project:p1' });   // #1 flush（现状 append 成功 + finally 删 SV）
      doc.getMap('nodes').set('u2', new Y.Map());
      await onStoreDocument({ document: doc, documentName: 'project:p1' }); // 红：现状 !lastSV 静默 return，恒 1
      expect(repo.append).toHaveBeenCalledTimes(2);
      expectDurableEquivalent(doc);
    });
```

- [ ] **Step 4: 写红4（加载窗口写入白盒——抑制窗口收窄的判据）**

```ts
    it('红4：加载窗口（loadUpdates await 挂起期）的真实写入必须进 pending 并落库【白盒防御性构造——生产不可达（loadingDocuments 门控 + redis 在 afterLoadDocument 才订阅），价值是防未来重构退化，勿去浏览器复现】', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      let release!: () => void;
      repo.loadUpdates.mockImplementationOnce(() => new Promise<Buffer[]>((resolve) => { release = () => resolve([]); }));
      const doc = new Y.Doc();
      const loading = onLoadDocument({ document: doc, documentName: 'project:p1' });
      await new Promise((r) => setImmediate(r));          // 让 loadDocument 跑到 await loadUpdates
      doc.getMap('nodes').set('win1', new Y.Map());       // 加载窗口内写入（模板导入/AI 影子节点场景）
      release();
      await loading;
      const pending = (gateway as any).pendingUpdates.get(doc) as Uint8Array[];
      expect(pending).toHaveLength(1);                    // 红：现状无监听器概念，pending undefined
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(1);
      expect(replayOf(appendedRows()).getMap('nodes').has('win1')).toBe(true);
    });
```

- [ ] **Step 5: 运行验证红批全红**

Run: `cd D:/flowweb/apps/api && npx vitest run src/modules/collab/collab.gateway.spec.ts -t "红"`
Expected: 红1/2a/2b/3/4 全 FAIL（各红点见用例注释）；现有用例照常绿（未动）。

- [ ] **Step 6: Commit 红批**

```bash
cd D:/flowweb && git add apps/api/src/modules/collab/collab.gateway.spec.ts && git commit -m "test(collab): 删除持久化缺陷红批——纯删除 diff/断连 flush/117 静默/加载窗口 五路全红（R1 判据2 复现锚）"
```

---

### Task 3: 实现重构——gateway v4（变更驱动落库）+ 指标文件

**Files:**
- Create: `apps/api/src/modules/collab/store.metrics.ts`
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`

- [ ] **Step 1: 新建 store.metrics.ts（对齐 sv-wait.metrics.ts 范式）**

```ts
import { Counter, Gauge, register } from 'prom-client';

export const yjsStoreDrainTotal = new Counter({
  name: 'yjs_store_drain_total',
  help: 'storeDocument drain 结果：noop=空转（readCanvas 无条件触发的空转率观测）/ appended=落库一行',
  labelNames: ['result'],
  registers: [register],
});

export const yjsStoreAppendFailureTotal = new Counter({
  name: 'yjs_store_append_failure_total',
  help: 'store append 失败次数（队列保留待重试，at-least-once）',
  registers: [register],
});

export const yjsStoreCompactFailureTotal = new Counter({
  name: 'yjs_store_compact_failure_total',
  help: 'compaction 失败次数（行已落库，仅一致性问题）',
  registers: [register],
});

export const yjsUnflushedProjects = new Gauge({
  name: 'yjs_unflushed_projects',
  help: 'unflushed 兜底 Map 当前条目数',
  registers: [register],
});
```

- [ ] **Step 2: 重写 collab.gateway.ts——数据结构、import、hooks 类型**

删除：`import { svSatisfied } from './sv.util';`、`persistedSVs` Map。
新增 import：`import { yjsStoreAppendFailureTotal, yjsStoreCompactFailureTotal, yjsStoreDrainTotal, yjsUnflushedProjects } from './store.metrics';`

类成员与常量（替换原 `persistedSVs` 声明）：

```ts
// COMPACT_THRESHOLD = 32 已存在于本文件 :14（export const）——勿重复声明（Cannot redeclare），原样保留
/** pending 队列计数封顶：折叠后恰剩 1 条、需再积 64 条才复发（字节阈值会"折完仍超限→每条 update
 *  全量重编码"——实测 3000 条积压 4.8s vs 计数 103ms 同步阻塞 WS 消息路径）。模块级 const，无测试缝、
 *  无外部消费者（绿9/9b 靠推 70 条触发，不引用常量）——不 export。 */
const PENDING_MAX_ENTRIES = 64;

/** 每文档待落库增量队列。键为 doc 实例（生产中同文档名同实例）；数组身份在 doc 生命周期内恒定——
 *  一切变更只允许原地 push/splice/unshift，禁止任何 set 替换/重绑定（不变量 6：断引用 = 失败回灌写孤儿数组） */
private readonly pendingUpdates = new WeakMap<Y.Doc, Uint8Array[]>();
/** 重放抑制：只包裹每个 applyReplayed 的同步段（yjs update 事件在事务清理期同步发放——实测重放行与
 *  pendingDs 延迟整合均在 apply 同步栈内发放、被精确抑制；await 窗口内写入不被抑制、进 pending） */
private readonly replaying = new WeakSet<Y.Doc>();
/** flush 失败兜底：projectId → 未落库合并行（跨 doc 卸载存活；进程重启丢失=既有接受项）。
 *  单行存续，追加即 mergeUpdates 收敛（有界）。禁止 drop：Yjs 缺失 struct 会悬挂 pendingStructs。
 *  变更只经 takeStash/putStash（内部维护 gauge） */
private readonly unflushed = new Map<string, Uint8Array>();
```

hooks 类型声明同步（onStoreDocument 返回 boolean）：

```ts
readonly hooks: {
  onAuthenticate: (p: onAuthenticatePayload) => Promise<any>;
  onLoadDocument: (p: onLoadDocumentPayload) => Promise<any>;
  onStoreDocument: (p: onStoreDocumentPayload) => Promise<boolean>;
  onDisconnect: (p: onDisconnectPayload) => Promise<void>;
};
```

- [ ] **Step 3: 重写 loadDocument（注册先于第一个 await；抑制窗口收窄同步段；stash 窗口外回灌）**

替换整个 `loadDocument` 方法：

```ts
/** spec 2.3：快照 + 增量按 (projectId, seq ASC) 重放。
 *  承重细节（spec v4 不变量 5/6，勿"简化"）：
 *  - 监听注册必须在第一个 await 之前——否则 DB 往返窗口内的写入静默漏收；
 *  - 禁止改用框架 onChange：document.onUpdate 在本 hook 返回后才注册，syncFromPeers 的更新永不触发 onChange；
 *  - replaying 抑制只包裹每个 applyUpdate 的同步段（yjs update 事件在事务清理期同步发放，不漏不误放），不跨 await；
 *  - stash 回灌必须在抑制窗口外：stash 是未落库变更，apply → update 事件 → pending → 下次 store 落库，
 *    禁止只 apply 不入队（等于二次蒸发）；
 *  - 不 return document：Hocuspocus 对 undefined no-op（doc 已就地填充）。 */
private async loadDocument({ document, documentName }: onLoadDocumentPayload) {
  const projectId = parseProjectId(documentName);
  if (!this.pendingUpdates.has(document)) {   // 防重复注册（行数翻倍）；has ⟺ 已注册（单状态源）
    this.pendingUpdates.set(document, []);    // eager 建条目：条目缺失 ⟺ 监听未注册（storeDocument/监听器双向 tripwire）
    document.on('update', (u: Uint8Array) => {
      if (this.replaying.has(document)) return;
      const q = this.pendingUpdates.get(document);
      if (!q) { this.logger.error(`update for untracked doc ${documentName}: dropped`); return; }
      q.push(u);
      // 原地封顶（禁 set 新数组——数组身份恒定）。计数阈值：折叠后恰剩 1 条需再积 64 条才复发；
      // 字节阈值会"折完仍超限→每条 update 全量重编码"（3000 条积压实测 4.8s vs 103ms 同步阻塞）
      if (q.length > PENDING_MAX_ENTRIES) q.splice(0, q.length, Y.mergeUpdates(q));
    });
  }
  const applyReplayed = (u: Uint8Array) => {
    this.replaying.add(document);
    try { Y.applyUpdate(document, u); } finally { this.replaying.delete(document); }
  };
  const docRow = await this.prisma.canvasDoc.findUnique({ where: { projectId } });
  if (docRow) applyReplayed(new Uint8Array(docRow.state));
  for (const u of await this.repo.loadUpdates(projectId)) applyReplayed(new Uint8Array(u));
  const stash = this.takeStash(projectId);
  if (stash) Y.applyUpdate(document, stash);  // 窗口外回灌：事件进 pending。stash 落库时点=下一次读/写/断连（非显式 flush），出口有二：本处 load 回灌 / storeDocument 取批前 drain
  await this.redisSync.syncFromPeers(documentName, document, 1000);  // 对等更新进 pending（冗余落库策略）
}

/** unflushed 唯一出入口（内部维护 gauge，防指标与 Map 漂移） */
private takeStash(projectId: string): Uint8Array | undefined {
  const s = this.unflushed.get(projectId);
  if (s !== undefined) this.unflushed.delete(projectId);
  yjsUnflushedProjects.set(this.unflushed.size);
  return s;
}

private putStash(projectId: string, payload: Uint8Array): void {
  const prev = this.unflushed.get(projectId);
  this.unflushed.set(projectId, prev ? Y.mergeUpdates([prev, payload]) : payload);   // 单行存续，追加即合并收敛（有界）
  yjsUnflushedProjects.set(this.unflushed.size);
}
```

- [ ] **Step 4: 重写 storeDocument（取批合并落库 + stash 提前 drain + compact 分治）**

```ts
/** 变更驱动落库（spec v4）：从 pending 队列取批 mergeUpdates 单行 append。
 *  硬规矩：本方法内不允许存在无日志、无指标、无抛错的提前 return（本次事故的系统性教训）。
 *  禁止任何"SV 相等 / diff 为空 ⇒ 无变化 ⇒ 跳过 append"判等——删除不产生新 struct、SV 零变化、
 *  语义相同 doc 双向 diff 恒非空（本次事故根因，实测钉死）。 */
private async storeDocument({ document, documentName }: Pick<onStoreDocumentPayload, 'document' | 'documentName'>): Promise<boolean> {
  const projectId = parseProjectId(documentName);
  const queue = this.pendingUpdates.get(document);
  if (!queue) {
    this.logger.error(`store for unobserved doc ${documentName}: listener never registered`);  // tripwire：!lastSV 同构物不得静默
    return false;
  }
  const stash = this.takeStash(projectId);
  if (stash) queue.unshift(stash);  // 提前 drain：WS 断连后 doc 驻留缓存不重载时的唯一出口；与 load 路径不双投（takeStash 已 delete）
  if (queue.length === 0) { yjsStoreDrainTotal.inc({ result: 'noop' }); return false; }  // 真·无变化不落行（readCanvas/断连的无条件触发零写放大）
  const batch = queue.splice(0);   // 同步原子取走（splice 先于任何 await——Skip 路径下 destroy 与 flush 并发，flush 不得依赖 doc 存活）
  const payload = batch.length === 1 ? batch[0] : Y.mergeUpdates(batch);
  try {
    await this.repo.append(projectId, payload);   // 单行原子：全有或全无
  } catch (err) {
    const live = this.pendingUpdates.get(document);   // 跨 await 后重新 get（防御：原地封顶下 live===queue，不等=有人违反不变量 6）
    if (live !== queue) this.logger.error(`pending queue identity changed for ${documentName}`);
    (live ?? queue).unshift(payload);                 // 回灌合并行（单项）；队列保留 → 下次 store 重试
    this.logger.error(`store append failed for ${projectId}, ${batch.length} updates retained: ${(err as Error).message}`);
    yjsStoreAppendFailureTotal.inc();
    throw err;   // hook 链由 Hocuspocus catch（"Document stays in memory"），doc 留内存重试
  }
  yjsStoreDrainTotal.inc({ result: 'appended' });
  try {
    if (await this.repo.count(projectId) >= COMPACT_THRESHOLD) await this.repo.compact(projectId);
  } catch (err) {
    // compact 是优化不是不变量载体：行已落库，失败只 WARN 绝不抛——否则被 Hocuspocus 当 store 失败 → doc 永不卸载 → destroy 挂死
    yjsStoreCompactFailureTotal.inc();
    this.logger.warn(`compact failed for ${projectId} (rows already durable): ${(err as Error).message}`);
  }
  return true;
}
```

- [ ] **Step 5: 重写 disconnect（吞错契约 + stash 兜底 + wrote 才 compact + compact 分治）**

```ts
/** 最后连接断开：flush →（写了才）compact。
 *  绝不抛出（覆盖含 redlock Skip 在内的全部路径，spec v4）：onDisconnect 是 onClose 的 async 回调、
 *  注册方 forEach 不 await——抛错 = unhandled rejection = 进程退出；DirectConnection 路径是 await 的，
 *  抛错冒泡出 withDoc finally → API 500 → 前端重试 → 重复插入。Skip 路径下 saveMutex 在回调抛错时
 *  先释放 → onDisconnect 一定被调用 → 本契约面更宽。 */
private async disconnect({ document, documentName }: onDisconnectPayload) {
  if (document.getConnectionsCount() > 0) return;
  const projectId = parseProjectId(documentName);
  try {
    const wrote = await this.storeDocument({ document, documentName });
    if (wrote) {
      try {
        await this.repo.compact(projectId);   // 会话结束收敛增量行；没写就不 compact（消除每次 readCanvas 全量 compact）
      } catch (err) {
        yjsStoreCompactFailureTotal.inc();
        this.logger.warn(`final compact failed for ${projectId}: ${(err as Error).message}`);  // 行已落库，非 flush 失败
      }
    }
  } catch (err) {
    this.stashPending(document, projectId, err as Error);   // 只兜 flush（append）失败
  }
}

/** flush 失败兜底：pending 转移到 projectId 键控 Map（跨 doc 卸载存活）——doc 卸载不再等于数据蒸发 */
private stashPending(document: Y.Doc, projectId: string, error: Error) {
  const q = this.pendingUpdates.get(document);
  let retained = 0;
  if (q?.length) {
    const batch = q.splice(0);
    retained = batch.length;
    const payload = batch.length === 1 ? batch[0] : Y.mergeUpdates(batch);
    this.putStash(projectId, payload);
  }
  this.logger.error(`collab flush failed for ${projectId}, ${retained} updates stashed for next load: ${error.message}`);
}
```

- [ ] **Step 6: 编译 + 跑红批验证全绿（现有用例部分红属预期，Task 4 适配）**

Run: `cd D:/flowweb/apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: 无错误（hooks 类型已同步）。

Run: `cd D:/flowweb/apps/api && npx vitest run src/modules/collab/collab.gateway.spec.ts -t "红"`
Expected: 红1/2a/2b/3/4 全 PASS。

Run: `cd D:/flowweb/apps/api && npx vitest run src/modules/collab/collab.gateway.spec.ts`
Expected: 现有用例中 `onStoreDocument：diff append + lastPersistedSV 前进`、`onDisconnect：最后连接断开触发 flush-then-compact` FAIL——红因是 **tripwire**（load/store 分离实例构造下 store 侧 doc 未注册 → `listener never registered` ERROR + return false → 不 append），不是 SV 语义，Task 4 同实例化适配。`onDisconnect：非最后连接早退` 仍绿但属 **vacuous**（早退在 storeDocument 之前，分离实例下 append 本就不会被调）——Task 4 Step 3 重写正是消除它；此时不要去找"不存在的 bug"。其余（鉴权/重放/readCanvas/closeTeamDocuments）绿。

- [ ] **暂不 commit（与 Task 4 适配一起）**

---

### Task 4: 适配现有 4 条用例（同实例化 + vacuous 修复）

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.spec.ts`

- [ ] **Step 1: 重写 :250-261"diff append + lastPersistedSV 前进"为同实例契约用例**

```ts
    it('onStoreDocument：写入 append + 无变化不 append', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', 'a');
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(1);
      // 再触发一次无变化：不 append（契约：readCanvas 无条件触发零写放大）
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(1);
    });
```

- [ ] **Step 2: 重写 :275-288"flush-then-compact"为同实例**

```ts
    it('onDisconnect：最后连接断开触发 flush-then-compact', async () => {
      const { onLoadDocument, onDisconnect } = extractHooks();
      const doc: any = new Y.Doc();
      doc.getConnectionsCount = () => 0;
      await onLoadDocument({ document: doc, documentName: 'project:p1' });   // 同实例建立队列
      doc.getMap('nodes').set('x', 1);
      await onDisconnect({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(1);
      expect(repo.compact).toHaveBeenCalledTimes(1);
      expect((repo.append as any).mock.invocationCallOrder[0]).toBeLessThan((repo.compact as any).mock.invocationCallOrder[0]);
    });
```

- [ ] **Step 3: 重写 :290-299"非最后连接早退"（同实例保持判别力）**

```ts
    it('onDisconnect：非最后连接早退——不 flush 不 compact', async () => {
      const { onLoadDocument, onDisconnect } = extractHooks();
      const doc: any = new Y.Doc();
      doc.getConnectionsCount = () => 1;
      await onLoadDocument({ document: doc, documentName: 'project:p1' });   // 同实例：queue 有内容，若早退守卫被删则 append 会被调 → 红
      doc.getMap('nodes').set('x', 1);
      await onDisconnect({ document: doc, documentName: 'project:p1' });
      expect(repo.append).not.toHaveBeenCalled();
      expect(repo.compact).not.toHaveBeenCalled();
    });
```

- [ ] **Step 4: 运行全套验证**

Run: `cd D:/flowweb/apps/api && npx vitest run src/modules/collab/collab.gateway.spec.ts`
Expected: 全绿（红批 5 条已转绿 + 适配 3 条绿 + "快照 + 增量按序重放"未动仍绿 + 集成用例绿）。若 `readCanvas SV 等待` 集成用例因 loadDocument 不再 return document 受影响，检查 Hocuspocus 对 undefined 的处理（实测 no-op），该用例应保持绿。

- [ ] **Step 5: Commit**

```bash
cd D:/flowweb && git add apps/api/src/modules/collab/ && git commit -m "feat(collab): 变更驱动落库——update 事件收集 pending 队列替代 SV 判等 diff（删除天然覆盖）；红批 5 条全绿；净删 persistedSVs/svSatisfied/!lastSV 静默分支（R1 判据2 根修）"
```

---

### Task 5: 绿守护批 A——行为契约（绿1/1b/1c/2/3/4/5/5b）

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.spec.ts`

- [ ] **Step 1: 写绿1/1b/1c（无变化契约三态）**

```ts
    it('绿1：无变更连续 store 3 次——全部不 append（noop）', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).not.toHaveBeenCalled();
    });

    it('绿1b：tombstone 三段——真实删除落库 / 重复 tombstone 0 事件不落行 / 对端新 struct 必须落库', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', new Y.Map());
      doc.getMap('nodes').set('n2', new Y.Map());
      await onStoreDocument({ document: doc, documentName: 'project:p1' });   // append#1（两个插入）
      // 自源构造 doc 自己的删除增量（外源 tombstone 引用他人 clock：0 事件、删不掉、还悬挂 pendingDs 污染 canonical——实测）
      const own: Uint8Array[] = [];
      const capture = (u: Uint8Array) => own.push(u);
      doc.on('update', capture);
      doc.getMap('nodes').delete('n2');
      doc.off('update', capture);
      const tombstone = own[0];
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(2);   // ① 真实删除（1 事件 → 进 pending）落库
      let events = 0;
      const count = () => { events += 1; };
      doc.on('update', count);
      Y.applyUpdate(doc, tombstone);   // ② 重复应用已知 tombstone：0 事件
      doc.off('update', count);
      expect(events).toBe(0);
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(2);   // ② 不落行（这才是判据——上一行断言的是"重复=0事件"，本行断言"0事件不落行"）
      const peer = new Y.Doc();   // ③ 对照：带新 struct 的对端 diff → 1 事件 → 真实新信息必须落库
      peer.getMap('nodes').set('peer1', new Y.Map());
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(3);
      expectDurableEquivalent(doc);
    });

    it('绿1c：重放不进队列——load 完成后 pending 为空', async () => {
      const { onLoadDocument } = extractHooks();
      const snapDoc = new Y.Doc(); snapDoc.getMap('nodes').set('a', 1);
      prisma.canvasDoc.findUnique.mockResolvedValue({ state: Buffer.from(Y.encodeStateAsUpdate(snapDoc)) });
      repo.loadUpdates.mockResolvedValue([Buffer.from(Y.encodeStateAsUpdate((() => { const d = new Y.Doc(); d.getMap('nodes').set('b', 2); return d; })()))]);
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      expect(doc.getMap('nodes').get('a')).toBe(1);
      expect(doc.getMap('nodes').get('b')).toBe(2);
      expect((gateway as any).pendingUpdates.get(doc)).toHaveLength(0);   // 重放被抑制，不污染队列
    });
```

- [ ] **Step 2: 写绿2（失败回灌 at-least-once）+ 绿3（GC 场景）**

```ts
    it('绿2：append 失败抛错回灌——再 store 重试成功，无部分批', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', new Y.Map());
      doc.getMap('nodes').set('n2', new Y.Map());
      repo.append.mockRejectedValueOnce(new Error('db down'));
      await expect(onStoreDocument({ document: doc, documentName: 'project:p1' })).rejects.toThrow('db down');
      expect((gateway as any).pendingUpdates.get(doc)).toHaveLength(1);   // 队列保留——回灌的是合并单行 payload（batch.length===2 但 unshift(payload) 单元素）
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(2);   // 重试成功（第一次失败 + 第二次成功）
      expect((gateway as any).pendingUpdates.get(doc)).toHaveLength(0);
      expectDurableEquivalent(doc);
    });

    it('绿3：GC 场景（删除后无关事务触发 gc）——重放删净 + canonical 等价', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();   // gc 默认 true（与 Hocuspocus 生产一致）
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', new Y.Map());
      doc.getMap('nodes').set('n2', new Y.Map());
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').delete('n2');
      doc.getMap('other').set('z', 1);   // 无关事务推进 GC
      doc.getMap('other').set('w', 2);
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      const replayed = expectDurableEquivalent(doc);
      expect(replayed.getMap('nodes').has('n2')).toBe(false);
      expect(replayed.getMap('nodes').has('n1')).toBe(true);
    });
```

- [ ] **Step 3: 写绿4（写放大守护）+ 绿5（阈值分支）+ 绿5b（wrote→compact 契约）；spec 文件 :4 的现有 import 扩为 `import { COMPACT_THRESHOLD, CollabGateway } from './collab.gateway';`（绿5 消费）**

```ts
    it('绿4：写放大守护——300 次事务一次 store 恰 append 1 次', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      const nodes = doc.getMap('nodes');
      for (let i = 0; i < 300; i++) doc.transact(() => { nodes.set(`d${i}`, i); });
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(1);   // mergeUpdates 单行（否决逐行：302 行会击穿 COMPACT_THRESHOLD）
      expect(appendedRows()[0].length).toBeLessThan(20000);   // 合并后远小于逐行总和（~6KB 量级）
      expect(repo.compact).not.toHaveBeenCalled();   // count(0) < 32
    });

    it('绿5：COMPACT_THRESHOLD 分支——count 达阈值时 compact 在 append 后被调', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', 1);
      repo.count.mockResolvedValue(COMPACT_THRESHOLD);   // 用导入常量——硬编码 32 会在改阈值时静默失去判别力
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.compact).toHaveBeenCalledTimes(1);
      expect((repo.append as any).mock.invocationCallOrder[0]).toBeLessThan((repo.compact as any).mock.invocationCallOrder[0]);
    });

    it('绿5b：disconnect 的 wrote 契约——没写就不 compact，写了才 compact', async () => {
      const { onLoadDocument, onDisconnect } = extractHooks();
      const docA: any = new Y.Doc(); docA.getConnectionsCount = () => 0;
      await onLoadDocument({ document: docA, documentName: 'project:p1' });
      await onDisconnect({ document: docA, documentName: 'project:p1' });   // 队列空 → wrote=false
      expect(repo.compact).not.toHaveBeenCalled();
      const docB: any = new Y.Doc(); docB.getConnectionsCount = () => 0;
      await onLoadDocument({ document: docB, documentName: 'project:p2' });
      docB.getMap('nodes').set('x', 1);
      await onDisconnect({ document: docB, documentName: 'project:p2' });
      expect(repo.compact).toHaveBeenCalledTimes(1);   // wrote=true → compact
    });
```

- [ ] **Step 4: 运行验证绿批 A 全绿**

Run: `cd D:/flowweb/apps/api && npx vitest run src/modules/collab/collab.gateway.spec.ts -t "绿"`
Expected: 本批全 PASS（绿批 B 尚未写）。

- [ ] **暂不 commit（与绿批 B 一起）**

---

### Task 6: 绿守护批 B——失败/兜底/身份契约（绿6/7/8/8b/8c/9/9b/10/11）

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.spec.ts`

- [ ] **Step 1: 写绿6（disconnect 不抛）+ 绿7（tripwire 双向）**

```ts
    it('绿6：disconnect 不抛——compact reject 时 onDisconnect 必须 resolve（进程守门）', async () => {
      const { onLoadDocument, onDisconnect } = extractHooks();
      const doc: any = new Y.Doc(); doc.getConnectionsCount = () => 0;
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('x', 1);
      repo.compact.mockRejectedValueOnce(new Error('lock timeout'));
      await expect(onDisconnect({ document: doc, documentName: 'project:p1' })).resolves.toBeUndefined();
      expect(repo.append).toHaveBeenCalledTimes(1);   // 行已落库
    });

    it('绿7：tripwire 双向——未注册 doc 的 store / update 事件都 ERROR 且不静默', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const errSpy = vi.spyOn((gateway as any).logger, 'error').mockImplementation(() => {});
      try {
        const stranger = new Y.Doc();   // ① store 侧：未 load 的 doc 直接 store
        stranger.getMap('nodes').set('x', 1);
        await onStoreDocument({ document: stranger, documentName: 'project:p9' });
        expect(repo.append).not.toHaveBeenCalled();
        expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('unobserved'));
        const doc = new Y.Doc();   // ② 监听器侧：注册后条目异常丢失 → update 事件 ERROR
        await onLoadDocument({ document: doc, documentName: 'project:p1' });
        (gateway as any).pendingUpdates.delete(doc);
        doc.getMap('nodes').set('y', 1);
        expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('untracked'));
      } finally {
        errSpy.mockRestore();
      }
    });
```

- [ ] **Step 2: 写绿8/8b/8c（unflushed 兜底三态）**

```ts
    it('绿8：unflushed 兜底全链——flush 失败 → stash → 新实例 load（不编辑）→ store 落库 → 再 store 不 append', async () => {
      const { onLoadDocument, onStoreDocument, onDisconnect } = extractHooks();
      const docA: any = new Y.Doc(); docA.getConnectionsCount = () => 0;
      await onLoadDocument({ document: docA, documentName: 'project:p1' });
      docA.getMap('nodes').set('n1', new Y.Map());
      docA.getMap('nodes').set('n2', new Y.Map());
      await onStoreDocument({ document: docA, documentName: 'project:p1' });   // append#1 插入落库
      const insertRow = appendedRows()[0];   // 显式捕获插入行（避免对 append 调用序的隐式依赖）
      docA.getMap('nodes').delete('n2');
      repo.append.mockRejectedValueOnce(new Error('db down'));
      await onDisconnect({ document: docA, documentName: 'project:p1' });      // flush 失败 → stash（吞错）
      expect((gateway as any).unflushed.get('p1')).toBeTruthy();
      repo.loadUpdates.mockResolvedValue([insertRow]);   // 新实例从"DB"重放插入行
      const docB = new Y.Doc();
      await onLoadDocument({ document: docB, documentName: 'project:p1' });
      expect((gateway as any).pendingUpdates.get(docB)).toHaveLength(1);   // stash 窗口外回灌进 pending（不编辑）
      expect((gateway as any).unflushed.has('p1')).toBe(false);
      await onStoreDocument({ document: docB, documentName: 'project:p1' });   // stash 落库
      expect(repo.append).toHaveBeenCalledTimes(3);   // #1 成功 + #2 失败 + #3 stash 落库
      const all = appendedRows();
      expect(replayOf([all[0]]).getMap('nodes').has('n2')).toBe(true);    // 插入行真实含 n2
      expect(replayOf(all).getMap('nodes').has('n2')).toBe(false);        // stash（删除）生效
      await onStoreDocument({ document: docB, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(3);   // 再 store 不 append（无重复入队）
    });

    it('绿8b：stash 提前 drain——disconnect 失败产生 stash 后，同 doc（不重载）下次 store 即落 stash', async () => {
      const { onLoadDocument, onStoreDocument, onDisconnect } = extractHooks();
      const doc: any = new Y.Doc(); doc.getConnectionsCount = () => 0;
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', new Y.Map());
      await onStoreDocument({ document: doc, documentName: 'project:p1' });   // #1 插入成功
      doc.getMap('nodes').delete('n1');
      repo.append.mockRejectedValueOnce(new Error('db down'));
      await onDisconnect({ document: doc, documentName: 'project:p1' });      // flush 失败 → stash
      expect((gateway as any).unflushed.get('p1')).toBeTruthy();
      const wrote = await onStoreDocument({ document: doc, documentName: 'project:p1' });   // 提前 drain 随本批落库
      expect(wrote).toBe(true);
      expect((gateway as any).unflushed.has('p1')).toBe(false);
      const all = appendedRows();
      expect(replayOf([all[0]]).getMap('nodes').has('n1')).toBe(true);
      expect(replayOf(all).getMap('nodes').has('n1')).toBe(false);   // 删除随 stash 落库
    });

    it('绿8c：stash-已在-DB 引理——stash 与 DB 同源（同 clientID）→ load 回灌 0 事件 → store 不 append', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const snapDoc = new Y.Doc(); snapDoc.getMap('nodes').set('a', 1);
      prisma.canvasDoc.findUnique.mockResolvedValue({ state: Buffer.from(Y.encodeStateAsUpdate(snapDoc)) });
      (gateway as any).unflushed.set('p1', Y.encodeStateAsUpdate(snapDoc));   // 与快照同源：apply 0 事件
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      expect((gateway as any).unflushed.has('p1')).toBe(false);
      expect((gateway as any).pendingUpdates.get(doc)).toHaveLength(0);
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).not.toHaveBeenCalled();
    });
```

- [ ] **Step 3: 写绿9/9b（队列身份恒定——测试调小字节阈值）**

```ts
    it('绿9：队列身份恒定——计数封顶原地合并（禁 set 替换数组）', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      const firstRef = (gateway as any).pendingUpdates.get(doc);
      for (let i = 0; i < 70; i++) doc.getMap('nodes').set(`k${i}`, { v: i });   // >64 触发原地折叠（第 65 条时折为 1，继续 push）
      expect((gateway as any).pendingUpdates.get(doc)).toBe(firstRef);   // toBe 同一对象（set 替换写法必红）
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(1);   // 折叠 + drain 合并 = 单行
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(1);   // 无积压重复（断引用形态 = 每次 store 重复 append）
      expectDurableEquivalent(doc);
    });

    it('绿9b：失败+交错回归——await 窗口注入更新触发封顶后 reject，失败批仍在活队列', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const doc = new Y.Doc();
      await onLoadDocument({ document: doc, documentName: 'project:p1' });
      doc.getMap('nodes').set('n1', new Y.Map());
      let rejectAppend!: (e: Error) => void;
      repo.append.mockImplementationOnce(() => new Promise((_res, rej) => { rejectAppend = rej; }));
      const storePromise = onStoreDocument({ document: doc, documentName: 'project:p1' });
      await new Promise((r) => setImmediate(r));   // 跑到 await append
      for (let i = 0; i < 70; i++) doc.getMap('nodes').set(`k${i}`, { v: i });   // 窗口内注入 >64 条 → 原地折叠
      rejectAppend(new Error('db down'));
      await expect(storePromise).rejects.toThrow('db down');
      const queue = (gateway as any).pendingUpdates.get(doc);
      expect(queue.length).toBeGreaterThan(0);   // 失败批经 WeakMap 读出仍在（孤儿数组形态 = 队列空/丢失）
      await onStoreDocument({ document: doc, documentName: 'project:p1' });
      expect(repo.append).toHaveBeenCalledTimes(2);   // 失败 1 + 重试成功 1
      expect((gateway as any).pendingUpdates.get(doc)).toHaveLength(0);
      expectDurableEquivalent(doc);
    });
```

- [ ] **Step 4: 写绿10（compact 失败降级）+ 绿11（canonical 种子循环 40）**

```ts
    it('绿10：compact 失败降级——append 成功 + compact reject → 不抛、行已落库、WARN、不 stash', async () => {
      const { onLoadDocument, onStoreDocument } = extractHooks();
      const warnSpy = vi.spyOn((gateway as any).logger, 'warn').mockImplementation(() => {});
      try {
        const doc = new Y.Doc();
        await onLoadDocument({ document: doc, documentName: 'project:p1' });
        doc.getMap('nodes').set('n1', 1);
        repo.count.mockResolvedValue(32);
        repo.compact.mockRejectedValueOnce(new Error('lock timeout'));
        const wrote = await onStoreDocument({ document: doc, documentName: 'project:p1' });
        expect(wrote).toBe(true);
        expect(repo.append).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('compact failed'));
        expect((gateway as any).unflushed.has('p1')).toBe(false);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('绿11：canonical 自证——同批 update 不同切分应用，40 seeds canonical 全等（raw 字节等价可因 GC 历史差异伪红、比例随操作分布浮动，不可作主判据）', () => {
      for (let seed = 1; seed <= 40; seed++) {
        let s = seed * 2654435761 % 2147483647;
        const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
        const src = new Y.Doc();
        const ups: Uint8Array[] = [];
        src.on('update', (u) => ups.push(u));
        const n = 10 + Math.floor(rnd() * 20);
        for (let i = 0; i < n; i++) {
          const nodes = src.getMap('nodes');
          const r = rnd();
          if (r < 0.6 || nodes.size === 0) nodes.set(`k${i}`, { v: i });
          else {
            const keys = [...nodes.keys()];
            nodes.delete(keys[Math.floor(rnd() * keys.length)]);
          }
        }
        const oneShot = new Y.Doc();
        Y.applyUpdate(oneShot, Y.encodeStateAsUpdate(src));   // 单次全量
        const piecewise = new Y.Doc();
        const cut = 1 + Math.floor(rnd() * (ups.length - 1));   // 随机切分点（保证两段非空）
        for (const u of ups.slice(0, cut)) Y.applyUpdate(piecewise, u);
        Y.applyUpdate(piecewise, Y.mergeUpdates(ups.slice(cut)));   // 剩余合并一次
        expect(bufEq(canonical(oneShot), canonical(piecewise))).toBe(true);
        expect(oneShot.getMap('nodes').toJSON()).toEqual(piecewise.getMap('nodes').toJSON());
      }
    });
```

- [ ] **Step 5: 运行绿批 B 全绿**

Run: `cd D:/flowweb/apps/api && npx vitest run src/modules/collab/collab.gateway.spec.ts`
Expected: 全套 PASS（红批 5 + 适配 3 + 绿批 A 8 + 绿批 B 9 + 现有集成/鉴权用例）。任何一条红按其注释的"红点含义"定位实现偏差。

- [ ] **Step 6: Commit 绿守护批**

```bash
cd D:/flowweb && git add apps/api/src/modules/collab/collab.gateway.spec.ts && git commit -m "test(collab): 绿守护 17 条——noop 契约/失败回灌/GC/unflushed 三态/队列身份恒定（失败+交错）/compact 分治/canonical 40 seeds"
```

---

### Task 7: provider 级 e2e（真 WS + 真 Hocuspocus——"刷新不复活"自动化版）

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.spec.ts`

- [ ] **Step 1: 在文件顶层 describe 内（集成用例区，`⑥ closeTeamDocuments` 之前）加 e2e 用例**

覆盖面说明（诚实声明）：本用例覆盖**根因 1**（删除经 WS flush 落库）+ **真实卸载后的持久层重放**；根因 2（断连-重连缓存复用）由红2b/红3 在 hooks 级覆盖，不在本用例重复投入。

```ts
  it('⑦ e2e：远端删除 → destroy 断连 flush → 真实卸载后重连从持久层重放不复活', async () => {
    const errSpy = vi.spyOn((gateway as any).logger, 'error').mockImplementation(() => {});
    try {
      const a = connect('project:pe1');
      await a.synced;
      const n = new Y.Map();
      n.set('type', 'textInput');
      a.ydoc.getMap('nodes').set('n1', n);
      await vi.waitFor(() => expect(repo.append).toHaveBeenCalledTimes(1), { timeout: 4000 });   // debounce 落库（短 debounce 配置）
      a.ydoc.getMap('nodes').delete('n1');
      await a.provider.destroy();   // 真实断连 → onClose → onDisconnect flush
      providers.splice(providers.indexOf(a.provider), 1);   // 用例内已销毁——从 afterEach 清理数组移除，防双 destroy（collab.gateway flaky 面收敛）
      await vi.waitFor(() => expect(repo.append).toHaveBeenCalledTimes(2), { timeout: 4000 });
      // 关键：等 doc 真正卸载（disconnectDelay ~400ms + unload 守卫）——否则重连命中内存缓存、测不到持久层
      await vi.waitFor(() => expect(gateway.server.hocuspocus.documents.has('project:pe1')).toBe(false), { timeout: 4000 });
      const loadCallsBefore = (repo.loadUpdates as any).mock.calls.length;
      repo.loadUpdates.mockResolvedValue(appendedRows());   // 持久层 = 已落库行（插入行 + 删除行）
      const b = connect('project:pe1');
      await b.synced;
      expect((repo.loadUpdates as any).mock.calls.length).toBeGreaterThan(loadCallsBefore);   // 确实走了持久层重放（非缓存命中）
      expect(replayOf([appendedRows()[0]]).getMap('nodes').has('n1')).toBe(true);   // 判别力锚：插入行真实含 n1（防"空 doc 恒绿"）
      expect(b.ydoc.getMap('nodes').has('n1')).toBe(false);   // 不复活
      expect(errSpy).not.toHaveBeenCalled();   // happy path：tripwire/stash 一次不命中（自动化日志契约，与验收判据同源）
    } finally {
      errSpy.mockRestore();
    }
  }, 15000);
```

注意：`appendedRows`/`replayOf`/`canonical`/`bufEq` 等 helper 与 `durableRows` 台账均已在**顶层 describe** 作用域（Task 1 Step 1a/1b 的写入位置即顶层 describe 内），本用例与 `增量持久化` 子 describe 共享闭包访问。

- [ ] **Step 2: 运行验证**

Run: `cd D:/flowweb/apps/api && npx vitest run src/modules/collab/collab.gateway.spec.ts -t "⑦"`
Expected: PASS。若 flaky（WS 时序），参考记忆 collab.gateway flaky 处置：重跑一次确认非确定性失败——**不得降级断言**（降级会抹掉"真实重载"这一判别力）。

- [ ] **Step 3: Commit**

```bash
cd D:/flowweb && git add apps/api/src/modules/collab/collab.gateway.spec.ts && git commit -m "test(collab): provider e2e——远端删除/断连 flush/重连重放不复活（判据2 自动化锚）"
```

---

### Task 8: 仓库级收口（compact → Promise<void> + 断言防假绿 + 恢复路径用例）

**Files:**
- Modify: `apps/api/src/modules/collab/canvas-doc-update.repository.ts`
- Modify: `apps/api/src/modules/collab/canvas-doc-update.repository.spec.ts`

- [ ] **Step 1: 写失败测试（恢复路径 + 幂等 + 假绿修复）**

在 repository.spec.ts 中：

```ts
  it('compact：插入行 + 删除行 → 快照重放不含被删节点（恢复路径取证）', async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.$queryRaw.mockResolvedValue([{ max: 2n }]);
    prisma.canvasDoc.findUnique.mockResolvedValue(null);
    const src = new Y.Doc();
    const ups: Buffer[] = [];
    src.on('update', (u) => ups.push(Buffer.from(u)));
    src.getMap('nodes').set('n1', new Y.Map());   // 插入行
    src.getMap('nodes').delete('n1');             // 删除行
    prisma.canvasDocUpdate.findMany.mockResolvedValue([
      { seq: 1n, update: ups[0] },
      { seq: 2n, update: ups[1] },
    ]);
    await repo.compact('p1');
    const { create } = prisma.canvasDoc.upsert.mock.calls[0][0];
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, new Uint8Array(create.state));
    expect(fresh.getMap('nodes').has('n1')).toBe(false);   // tombstone 进快照，重建不复活
  });

  it('compact：跨两轮幂等——第一轮快照作第二轮 docRow 重放再 compact，状态等价 + maxSeq 边界', async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    // 两次 mockResolvedValueOnce 对应两轮的 max 查询（mockResolvedValue 每次返回同一数组、两轮 maxSeq 会同值）
    prisma.$queryRaw.mockResolvedValueOnce([{ max: 2n }]).mockResolvedValueOnce([{ max: 3n }]);
    const src = new Y.Doc();
    src.getMap('nodes').set('a', 1);
    src.getMap('nodes').set('b', 2);
    const inc = Buffer.from(Y.encodeStateAsUpdate(src));
    prisma.canvasDoc.findUnique.mockResolvedValueOnce(null);
    prisma.canvasDocUpdate.findMany.mockResolvedValueOnce([{ seq: 1n, update: inc }]);
    await repo.compact('p1');
    const firstState = prisma.canvasDoc.upsert.mock.calls[0][0].update.state;
    // 第二轮：旧快照 + 一条新删除增量
    const del = new Y.Doc();
    Y.applyUpdate(del, new Uint8Array(firstState));
    const ups: Buffer[] = [];
    del.on('update', (u) => ups.push(Buffer.from(u)));
    del.getMap('nodes').delete('b');
    prisma.canvasDoc.findUnique.mockResolvedValueOnce({ state: firstState });
    prisma.canvasDocUpdate.findMany.mockResolvedValueOnce([{ seq: 2n, update: ups[0] }]);
    await repo.compact('p1');
    const secondState = prisma.canvasDoc.upsert.mock.calls[1][0].update.state;
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, new Uint8Array(secondState));
    expect(fresh.getMap('nodes').has('a')).toBe(true);
    expect(fresh.getMap('nodes').has('b')).toBe(false);   // 跨轮快照/增量边界不丢删除
    // maxSeq 边界守卫（本方法唯一的"危险正确性点"：DELETE seq<=maxSeq 防误删并发实例新 append 的行）
    expect(prisma.canvasDocUpdate.deleteMany).toHaveBeenNthCalledWith(1, { where: { projectId: 'p1', seq: { lte: 2n } } });
    expect(prisma.canvasDocUpdate.deleteMany).toHaveBeenNthCalledWith(2, { where: { projectId: 'p1', seq: { lte: 3n } } });
  });
```

同时修改既有用例（假绿修复）：

```ts
  // 原 :50-51 "const sv = await repo.compact('p1'); expect(sv).toBeInstanceOf(Uint8Array);" 删除——
  // compact 改 void 后 toBeUndefined() 对任何 void 函数恒真，判别力归零；行为断言（upsert/deleteMany）已在下方覆盖

  // 原 :86-90 "compact：无增量行返回 null" 改为行为断言：
  it('compact：无增量行不产生快照写', async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.$queryRaw.mockResolvedValue([{ max: null }]);
    await repo.compact('p1');
    expect(prisma.canvasDoc.upsert).not.toHaveBeenCalled();
    expect(prisma.canvasDocUpdate.deleteMany).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: 运行验证——新用例应绿（compact 现实现已返回快照），假绿修复的两条在收口前编译受影响**

Run: `cd D:/flowweb/apps/api && npx vitest run src/modules/collab/canvas-doc-update.repository.spec.ts`
Expected: 新增 2 条 PASS（现实现兼容）；改写的 2 条中 `toBeInstanceOf` 断言已删除、`:86` 用例在新旧实现下都 PASS（null 返回值不消费）。

- [ ] **Step 3: 收口 repository.ts——compact 返回 void**

`canvas-doc-update.repository.ts` 的 `compact` 方法：
- 签名 `async compact(projectId: string): Promise<Uint8Array | null>` → `Promise<void>`
- 删除 `const snapshotSV = Y.encodeStateVector(temp);`
- 删除 `if (maxSeq == null) return null;` 的返回值语义改为 `if (maxSeq == null) return;`
- 删除 `return snapshotSV;`
- 事务回调返回类型同步（`async (tx) => {...}` 不再 return）
- docstring 中"返回 snapshotSV 供调用方重置 lastPersistedSV"句删除，替换为："调用方（gateway）不消费返回值——水位由 pending 队列自身表达"

- [ ] **Step 4: 全套验证**

Run: `cd D:/flowweb/apps/api && npx tsc --noEmit -p tsconfig.json && npx vitest run src/modules/collab/canvas-doc-update.repository.spec.ts src/modules/collab/collab.gateway.spec.ts`
Expected: 编译零错误 + 两文件全绿（gateway 已在 Task 3 忽略 compact 返回值）。

- [ ] **Step 5: Commit**

```bash
cd D:/flowweb && git add apps/api/src/modules/collab/canvas-doc-update.repository.ts apps/api/src/modules/collab/canvas-doc-update.repository.spec.ts && git commit -m "refactor(collab): compact 返回值收口 void（snapshotSV 死代码）+ 快照恢复/跨轮幂等仓库级取证 + 假绿断言修复"
```

---

### Task 9: 全量回归

- [ ] **Step 1: apps/api 全量测试**

Run: `cd D:/flowweb/apps/api && npx vitest run`
Expected: 全绿。已知 flaky（记忆：collab.gateway/collab.gateway 多实例偶发）——单条失败先重跑确认。

- [ ] **Step 2: TypeScript 全量编译**

Run: `cd D:/flowweb/apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: 零错误。

- [ ] **Step 3: web 侧无波及确认**

（Task 1 开始时先记录起始 sha 到**仓库根**（勿用 /tmp——跨任务/跨 subagent 交接与清理都不可靠）：`cd D:/flowweb && git rev-parse HEAD > .plan-start.sha`；该文件在 Task 12 收尾删除）

Run: `cd D:/flowweb && git diff --stat $(cat .plan-start.sha)..HEAD -- apps/web`
Expected: 无输出（本次全在 apps/api + docs；不依赖提交条数）。各 Task commit 均显式列文件，.plan-start.sha 不会被误提交。

---

### Task 10: 文档修订（防文档骗下一个会话）

**Files:**
- Modify: `docs/superpowers/specs/` 下增强设计 spec（执行时 `grep -rn "空 diff 跳过" docs/superpowers/specs/` 定位，评审指认 enhancements-design §2.2）
- Modify: `docs/superpowers/plans/2026-09-28-canvas-group-r1-infra-geometry.md`（:919-921、:2650 附近）

- [ ] **Step 1: 增强 spec 2.2 判据修订**

定位：`docs/superpowers/specs/2026-08-28-team-collab-enhancements-design.md` §2.2 = :136-153。**只改写下列 5 句——:143-150 的 compaction 算法描述（快照从 Postgres 权威构建 / advisory lock / maxSeq / 临时 doc / UPSERT+条件 DELETE）今日依然成立，逐字保留，禁止整段 :136-153 替换（会把 compaction 契约从文档里抹掉）**。需修订的原句：:138（lastPersistedSV 初始化）、:140（"空 diff 跳过（无变更不落行）"）、:142（成功后推进 SV）、:151（用 snapshotSV 重置水位）、:152（"框架随后自动触发的 onStoreDocument flush 因 diff 为空而跳过"——正是本次事故的原句）；:153"多实例冗余 append 接受"仍成立，保留。另 :144 有一处**指代联动**（非算法变更）："先按上文流程 append 本实例 diff"改为"先 flush 本实例 pending 批（变更驱动）"——上文不再是 diff 流程，原指代会失效。5 句的替换文本：

```markdown
### 2.2（2026-09-29 修订：变更驱动落库）

变更检测基于**观测**（Yjs `doc.on('update')` 事件收集 pending 队列），禁止任何"SV 相等 / diff 为空 ⇒ 无变化 ⇒ 跳过 append"判等——
删除不产生新 struct、SV 零变化、语义相同 doc 双向 diff 恒非空（R1 判据 2 事故根因，实测钉死）。

水位不变量：
- 只滞后、不越过；失败不推进（队列原样保留 + 抛错）、doc 存活期内可重试（at-least-once）
- 滞后上界：connection/local origin ≤ maxDebounce 10s；redis-origin 落库时点 = 下次 store 触发（仅 SIGKILL 落空，非待修缺陷）
- 队列数组身份在 doc 生命周期内恒定（原地 push/splice/unshift，禁止 set 替换）

对等初始同步为**机制类不变量**（必须存在），载体两注明：extension-redis afterLoadDocument（NUMSUB 门控）+ 自研 syncFromPeers（无门控，单实例冷加载 +1s）；
删除/降级任一载体前必须保证另一载体 awaitInitialSyncTimeout > 0。
对等删除可见性由"每个 update 都落库 + 下次 load 从 DB 重放"保证（非 syncFromPeers 本身）。
```

- [ ] **Step 2: R1 plan 判据 2 表述附证伪说明（共 4 处）**

`docs/superpowers/plans/2026-09-28-canvas-group-r1-infra-geometry.md` 的 4 处相关表述均挂同一段证伪说明：:13（"正常刷新零丢失（onDisconnect flush 兜底）"）、:906（"服务端 onDisconnect 强制 flush 使正常刷新零丢失"）、:921（崩溃兜底块 + 反向判据"服务端 tombstone 权威"）、:2650（验收项 2"远端删除不复活"）。追加：

```markdown
> **2026-09-29 证伪与修复**：上表"onDisconnect flush 兜底"在删除场景失效——flush 汇入的 storeDocument 被
> SV 判等挡住（删除不推进 clock），断连后 `!lastSV` 静默跳过是刷新复活的必现路径。判据 2 判 FAIL，
> 已按 `docs/superpowers/specs/collab-delete-persist-fix.md`（变更驱动落库）修复。兜底成立的前提是
> "每次语义变更都进 pending 队列 + 断连 flush 无条件执行且吞错有 unflushed 兜底"。
```

- [ ] **Step 3: Commit**

```bash
cd D:/flowweb && git add docs/superpowers/ && git commit -m "docs(collab): spec 2.2 变更驱动判据修订 + R1 plan 判据2 证伪说明（防文档误导后续会话）"
```

---

### Task 11: 浏览器验收（判据 2 复跑，人工留证）

前置：API/Web 已运行（preview_start "api"/"web"，见项目启动流程记忆）。改过 collab 代码需 taskkill 3001 旧进程再重启 API（记忆：nest watch 不释放 collab 端口）。

- [ ] **Step 1: 基线取证（临时 .cjs 脚本——node -e 的多行引号/转义在 PowerShell 下会坏）**

创建 `D:/flowweb/apps/api/.tmp-verify-persist.cjs`：

```js
const { PrismaClient } = require('@prisma/client');
const Y = require('yjs');
const p = new PrismaClient();
const PROJECT_ID = 'cmuibzgng000410db6gi6ztbm';
const ZOMBIE = 'node_1790672934579_1';
(async () => {
  const doc = await p.canvasDoc.findUnique({ where: { projectId: PROJECT_ID } });
  console.log('state bytes:', doc?.state.length);
  const rows = await p.canvasDocUpdate.count({ where: { projectId: PROJECT_ID } });
  console.log('update rows:', rows);
  const d = new Y.Doc();
  Y.applyUpdate(d, new Uint8Array(doc.state));
  for (const r of await p.canvasDocUpdate.findMany({ where: { projectId: PROJECT_ID }, orderBy: { seq: 'asc' } }))
    Y.applyUpdate(d, new Uint8Array(r.update));
  console.log('zombie persisted (baseline):', d.getMap('nodes').has(ZOMBIE));   // 阶段一必须 true（防"重放不含"恒真）
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => p.$disconnect());
```

Run: `cd D:/flowweb/apps/api && node .tmp-verify-persist.cjs`
Expected: `zombie persisted (baseline): true`（若 false，先解码排查——验收"重放不含"会恒真）。**此脚本在 Step 2/3 复用（删除后重跑应为 false）**，全部验收完成后删除。

- [ ] **Step 2: 浏览器删除僵尸节点 + 查库取证落库**

双标签打开画布3（http://localhost:5173/canvas，登录后进入该画布）→ 标签 B 删除 `node_1790672934579_1`（输入节点，textContent "test"）→ 等 10s（debounce+maxDebounce）→ 复用 Step 1 脚本查库：

Run: `cd D:/flowweb/apps/api && node .tmp-verify-persist.cjs`
Expected: `zombie persisted (baseline): false`（删除已落库——增量行 ds 或 compact 快照任一形态；快照+全增量重放后不含该节点）。

- [ ] **Step 3: 刷新/立即刷新/重启三变体 + 双标签（每变体换一个不同节点，避免状态纠缠）**

1. **删完立刻刷新**（判据 2 必现路径，核心项）：取一个既有节点 → 记录基线行数 → 删除 → 立即刷新 → 节点不复活
2. 另取节点删除 → 等 >10s 刷新 → 不复活
3. API 重启（preview_stop "api" → taskkill 3001 残留进程 → preview_start "api"，见 Hocuspocus 陷阱记忆）→ 页面重载 → 不复活
4. 双标签：B 删新节点 → A 实时收敛消失 → A 刷新不复活

- [ ] **Step 4: 日志判据**

Run: `preview_logs "api"`（search "error"）
Expected: 全程本项目 Nest Logger 的 ERROR 行零出现（框架 console.error 与 SkipFurtherHooksError 不算）；若出现 WARN compact failed 须与 drain 指标同步。

- [ ] **Step 5: 验收结论登记**

判据 2 PASS 后：R1 方可收尾；更新缺陷登记记忆（见 Task 12）。

---

### Task 12: 收尾——记忆与状态更新

- [ ] **Step 1: 更新记忆 `project_r1_delete_persist_bug.md`**

缺陷状态改为"已修复（2026-09-29，变更驱动落库，判据 2 复跑 PASS）"；保留伴生发现（provider 卡 connecting）为待办；僵尸节点证据已由验收步骤处置，删除"勿清"警示。

- [ ] **Step 2: 确认 R1 状态**

向用户汇报判据 2 复跑结果，确认 R1 收尾（此前 R1 完成报告中"22 task 全部完成 + 判据 2 FAIL"的挂起项闭环）。

- [ ] **Step 3: 删除中间产物并确认工作区洁净**

`.tmp-verify-persist.cjs` 已在 Task 11 验收完成后删除；此处删除 Task 9 的起始 sha 文件并确认无残留：

```bash
cd D:/flowweb && rm .plan-start.sha && git status --porcelain
```

Expected: porcelain 输出为空（或仅剩用户已知在制品；.plan-start.sha / .tmp-* 不得出现）。

---

## Self-Review 记录（第 11 轮评审后修订；第 12/13 轮评审增补）

- **Spec 覆盖**：spec v4 设计节（数据结构/loadDocument/storeDocument/disconnect/观测性/删除面）→ Task 3；不变量 1-6 → Task 1 helper + 红1（不变量 4）/绿1c（5）/绿9·9b（6）/绿2·8·8b·8c（3）/绿4·11（1）/绿1·1b（2）；红 1-4 → Task 1/2；绿 1-11 → Task 5/6；provider e2e → Task 7；仓库级（void 收口/恢复/幂等/假绿）→ Task 8；文档修订 → Task 10；验收 → Task 11。
- **已知项（执行者遇红先对照，勿先改测试）**：
  1. 封顶策略为**计数 64**（第 11 轮评审实证字节阈值病态：折后仍超限 → 每条 update 全量重编码 4.8s vs 计数 103ms；spec v4 该段已同步修订）——绿9/9b 靠推 70 条触发，无静态量改写。
  2. applyReplayed 抑制窗口（同步段包裹）已经脚本实证：重放行/待处理 pendingDs 整合均被精确抑制（pending=0）、await 窗口写入正确进队——绿1c/红4 判据成立；第 11 轮评审13 的相反主张已被实证推翻，勿按其"收尾补漏"方案改回。
  3. e2e（⑦）覆盖面：根因 1 + 真实卸载后持久层重放；根因 2（缓存复用）由红2b/红3 覆盖。
- **占位符扫描**：全部步骤含完整代码/命令/预期；无 TBD/TODO。
- **类型一致性**：`storeDocument: Promise<boolean>`（Task 1 extractHooks / Task 3 Step 2 hooks 声明 / Step 4 实现三处一致）；`compact: Promise<void>`（Task 8 与 gateway 调用处一致）；`PENDING_MAX_ENTRIES` 模块 const 不 export（Task 3 Step 2 与监听器一致；绿9/9b 推 70 条触发不引用）；`takeStash/putStash`（loadDocument/storeDocument/stashPending 三处消费一致）；helper 名（canonical/replayOf/appendedRows/expectDurableEquivalent/bufEq）全 plan 统一，`appendedRows` 走 durableRows 显式台账（beforeEach 的 append 基础实现 push，once 队列优先故 reject 调用不进台账——探针实证 `mock.results` 过滤恒真不可用，勿改回）。
- **第 12/13 轮评审落地项**：① P1-A appendedRows 台账化（上条）；② Task 9 起始 sha 改仓库根 `.plan-start.sha` + Task 12 Step 3 清理；③ Task 3 Step 2 注明 COMPACT_THRESHOLD 已在 :14 勿重复声明、PENDING_MAX_ENTRIES 不 export；④ 绿5 改用导入的 COMPACT_THRESHOLD；⑤ 文件结构表 17 条；⑥ expectDurableEquivalent 删无人消费的 snapshot 参数；⑦ Task 7 e2e 用例内 destroy 后从 providers 移除（防 afterEach 双 destroy）；⑧ Task 10 修订范围钉死（仅 5 句 + :144 指代联动，:143-150 compaction 算法逐字保留）；⑨ spec 残余风险补计数封顶口径与外源 ds-only 0 事件条目；⑩ ~16.7% 伪红数字软化为定性 + 来源标注（fuzz 记录在 spec 绿11：60 次 10 次，比例随操作分布浮动）。两评审确认的既有结论（applyReplayed 同步段抑制不漏不误放、绿1b 自源三段、封顶计数 64）未动。
- **已知风险**：Task 4 Step 4 若 `readCanvas SV 等待` 集成用例受 loadDocument 不返回 document 影响——spec v4 已核对 Hocuspocus 对 undefined no-op，预期仍绿；helper 已提升顶层 describe（Task 7 需要）。

