# CI 双故障根修批 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

<!-- plan v3（2026-10-18）：吸收第三轮 plan 外审（16 项实证采纳）——①帧型三档改四档：Sync(0)+**SyncReply(4)**=前瞻 close 组（枚举实证——SS1 回复携全 doc diff 8MB，v2 漏归 stateless=上界失效）+控制组（Stateless/BroadcastStateless/SyncStatus/Ping/Pong/QueryAwareness）不前瞻且**预算豁免**（doc-status/conn-status/心跳永不因预算静默丢）②release 检查 has（closed 迟到 cb 禁复活 Map）+reconcile 回填 per-ws③**getBacklog 闭包**替代 census ⑤ 目标文件切换（读点文本留 SG——census 脚本/自测/backpressure spec 三处零改）④gateway :76 加 once? 签名+:49 再导出合并一行守 934⑤**35s pause 用例删除**（逻辑不可构造：pause 挡心跳本身+心跳与 8MB 回显同 FIFO 队列——大帧排空>30s 心跳永排后面）→换心跳链路通用例+spec 登记有效域边界（真根修=客户端字节流判活/2MB doc 归客户端批·Y1c-3）⑥heartbeat register 用 connectedPayload.socketId⑦T7 slow0+msgs 前置 send 前（假绿根修）⑧ci-notify 加 timed_out/cancelled（22 连败本形态=cancelled）⑨makeStubWs.close 触发 once 监听⑩SG 死代码删⑪对账挂 authMapsSweeper（60s 阀前）弃 sessionSweep（受 SWEEP_ENABLED）⑫global-budget 去双计+gauge 接线⑬锚表三新文件⑭façade 加 quotaFrozen 读面⑮die/watchdog fallback setTimeout 去 unref⑯gate8b 注释修正（第二帧 delta truth 120KB>soft 冻结——断言不涉但语义写对）。驳回维持：B14 移交（登记下一批首位）/2MB·N_max/collab-core job 30（setup 80s+24=25<30）/fake transport 替代形态（绕 ws 队列=非真实传输，链路通+诚实登记替代）。v2 头注：env 校验全删/OutboundBudget 类/心跳独立模块/notify 独立 workflow/watchdog 保 ref/Pick 类型+字面量/gate8b 128KB/DR·env 零改动/census 切换方案（v3 弃，改 getBacklog）/testutils 扩扫。 -->

**Goal:** 修复 CI #40 起 22 连败的双故障（write-frozen 演练 dist 布局卡死 6h + rate-gate 双用例 1011 误杀），按 spec v3（`docs/superpowers/specs/2026-10-18-ci-double-fault-repair-design.md`）落地 R1'-R6'，批出口=push 后 CI 四 job 全绿。

**Architecture:** drill 独立布局 `dist-drill`（消灭同目录双布局）+ 两 drill 错误出口确定性收口 + CI 卫生（timeout/concurrency/通知）+ `collab-limits.ts` 派生契约（前瞻判定/2MiB 下限/96MiB 同步记账全局预算）+ heavy 串行测试套件 + SG 保活心跳（恶化者同批缓解）。

**Tech Stack:** TypeScript strict / NestJS / hocuspocus 4.6.0 / vitest / prom-client / GitHub Actions / node:test。

**上游 spec 勘正（plan 期已回写 spec）：** test job 的 `pnpm verify`（tier=full）已含 `api-nest-build` + `check-no-testutils-in-dist --require-dist`（verify-manifest.mjs:29-30）——v3-R3'「api build 产物断言 step」冗余已删除；外审「CI 不跑生产 emit」断言不成立。

**执行纪律：**
- 每卡先红证据（元纪律⑥：真实变红输出落档）→ 绿 → commit。commit message 带批次前缀 `fix(ci)`。
- 所有行号为 2026-10-18 快照值，执行期按语义定位。
- SG 1238 锚为硬约束：T5/T6/T9 完成后跑 `node scripts/check-collab-module-size.mjs`，净减行核算表见 T10。
- 本地跑 drill 前置：PG/Redis 起着（apps/api/.env 的 DATABASE_URL 指向本地库）。

---

## 文件结构（本批触碰面全景）

| 文件 | 动作 | 责任 |
|---|---|---|
| apps/api/tsconfig.drill.json | 改 | outDir → dist-drill（R1'） |
| apps/api/scripts/collab-kill9-drill.ts | 改 | :53 DRILL_ENTRY + 错误出口收口（R1'/R2'） |
| apps/api/scripts/write-frozen-drill.mjs | 改 | :46/:188 路径 + 收口全套（R1'/R2'） |
| .gitignore | 改 | +apps/api/dist-drill/ |
| scripts/check-no-testutils-in-dist.mjs | 改 | 扩扫 dist-drill（T1 附） |
| .github/workflows/ci.yml | 改 | concurrency/timeout/step timeout（R3'） |
| .github/workflows/ci-notify.yml | **建** | workflow_run 触发的 master 失败通知（R3'——独立 workflow，ci.yml 内 notify 不可达） |
| apps/api/src/modules/collab/collab-limits.ts | **建** | 派生契约纯模块（R4b'） |
| apps/api/src/modules/collab/collab-limits.spec.ts | **建** | limits 测试矩阵（TDD 先红） |
| apps/api/src/modules/collab/collab-outbound-budget.ts | **建** | OutboundBudget 类：**wrap 判定核（自 SG 迁入）**+同步记账+close/throw 释放（R4b'） |
| apps/api/src/modules/collab/collab-heartbeat.ts | **建** | 心跳独立模块：Map<socketId,conn>+自带 timer（R6'——SG 只 2 行接线） |
| apps/api/src/modules/collab/collab-session-guard.service.ts | 改 | 委托 budget.wrap+limits 构造期 derive+心跳 2 行接线（净减 ~18 行） |
| apps/api/src/modules/collab/collab-doc-registry.service.ts | **零改动** | ~~activeLimits~~（v2 撤销——1082/1082 一行不可加；闸式保留 quota 直读=值恒等偏离登记） |
| apps/api/src/modules/collab/collab-server.factory.ts | 改 | maxPayload 单源+flush pin（顶层键非 websocketOptions——v2 勘正） |
| apps/api/src/modules/collab/collab.gateway.ts | 改 | :49 再导出一行保持（limits 常量改直源）+:76 once 类型（R4b'——934 锚守护） |
| apps/api/src/config/env.ts | **零改动** | ~~tx>doc superRefine~~（v2 撤销——drill 子进程经 app.module:46 必被 40KB/256KB 打死） |
| apps/api/src/modules/collab/store.metrics.ts | 改 | 新 gauge/counter 单源（R4b'——指标定义归此非 budget 模块） |
| apps/api/src/modules/collab/collab-backpressure.spec.ts | 改 | 接 limits+前瞻重构+budget 实例 reset（R4b'） |
| apps/api/src/modules/collab/collab-rate-gate.spec.ts | 改 | 长度锚+红门⑧ 勘正+refill 128KB 档（R4a'） |
| apps/api/src/modules/collab/collab-heartbeat.spec.ts | **建** | R6 unit 测试 |
| apps/api/src/modules/collab/collab-heartbeat.heavy.spec.ts | **建** | R6 心跳链路通用例（heavy 套件——35s pause 形态 v3 已删：逻辑不可构造） |
| apps/api/vitest.heavy.config.ts | **建** | heavy 串行套件（R4a'） |
| apps/api/vitest.config.ts | 改 | exclude heavy 文件（R4a'） |
| apps/api/package.json | 改 | test:heavy script |
| scripts/verify-manifest.mjs | 改 | 插 api-test-heavy 步（27→28） |
| scripts/verify-chain.test.mjs | 改 | 元测试③基线 27→28 同批 |
| scripts/check-collab-module-size.mjs | 改 | 锚表+两新文件行（实测紧值 60/100） |
| scripts/check-collab-module-size.test.mjs | 改 | 自测锚表断言同批 |
| scripts/check-ecosystem.mjs | 改 | 算式+OUTBOUND_BUDGET 项（自 collab-limits.ts 提取字面量） |

不动（B12 census 红线）：collab-smoke.mjs / collab-soak.mjs / exec-smoke.mjs 的 `dist/modules` 部署消费面；**DR 零改动**（1082 锚）；env.ts 零改动。

---

### Task 1: R1'——drill 独立输出根 `dist-drill`

**Files:**
- Modify: `apps/api/tsconfig.drill.json`
- Modify: `apps/api/scripts/collab-kill9-drill.ts`（DRILL_ENTRY 行，2026-10-18 快照 :53）
- Modify: `apps/api/scripts/write-frozen-drill.mjs:46`（DRILL_ENTRY）与 `:188`（repoCtor require 路径）
- Modify: `.gitignore`

- [ ] **Step 1: 先红复现**——删本地两布局产物，跑 frozen-chain 观察既有红：

```bash
rm -rf apps/api/dist apps/api/dist-drill
pnpm --filter @flowweb/api exec node scripts/write-frozen-drill.mjs --mode=frozen-chain
```

Expected: `Error: Cannot find module '../dist/modules/collab/canvas-doc-update.repository.js'`（run 59 同款 MODULE_NOT_FOUND——但**注意**：此时错误后进程可能挂起，Ctrl+C 终止；这就是 R2' 要修的，本步只取红证据文本）。

- [ ] **Step 2: 改 outDir**

`apps/api/tsconfig.drill.json`：

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "rootDir": ".",
    "outDir": "./dist-drill",
    "incremental": true,
    "sourceMap": false
  },
  "include": ["src", "scripts/collab-drill-server.ts"],
  "exclude": ["node_modules", "dist", "dist-drill", "**/*.spec.ts", "**/test-utils/**"]
}
```

（exclude 加 `dist-drill` 防 incremental 自吞。）

- [ ] **Step 3: 改三处消费路径**

`collab-kill9-drill.ts`（:53 快照）：

```ts
const DRILL_ENTRY = resolve(__dirname, '..', 'dist-drill', 'scripts', 'collab-drill-server.js');
```

`write-frozen-drill.mjs` :46：

```js
const DRILL_ENTRY = resolve(PKG_ROOT, 'dist-drill', 'scripts', 'collab-drill-server.js');
```

`write-frozen-drill.mjs` :188：

```js
repoCtor ??= req('../dist-drill/src/modules/collab/canvas-doc-update.repository.js').CanvasDocUpdateRepository;
```

- [ ] **Step 4: .gitignore** 末尾追加一行：`apps/api/dist-drill/`

- [ ] **Step 5: 验收绿**——双模式双绿且 `apps/api/dist` 不被创建：

```bash
rm -rf apps/api/dist apps/api/dist-drill
pnpm --filter @flowweb/api exec node scripts/write-frozen-drill.mjs --mode=frozen-chain
pnpm --filter @flowweb/api exec node scripts/write-frozen-drill.mjs --mode=mid-edit-kill9
pnpm --filter @flowweb/api exec tsx scripts/collab-kill9-drill.ts --mode=kill9-normal
test ! -d apps/api/dist && echo "dist 未被创建 ✓"
```

Expected: 两个 `DRILL PASS:` 输出 + kill9 `DRILL PASS` + `dist 未被创建 ✓`。

- [ ] **Step 6: B12 红线核验 + testutils 扩扫**：

```bash
grep -n "dist/modules" apps/api/scripts/*.mjs
```

Expected: 仅 collab-smoke.mjs / collab-soak.mjs / exec-smoke.mjs 三处部署消费面命中——**一字不改**。

`scripts/check-no-testutils-in-dist.mjs` 扩扫 `apps/api/dist-drill`（扫描面加第二目录；tsconfig.drill exclude 已含 `**/*.spec.ts`/`**/test-utils/**` → 扫描应 PASS——先跑一次确认，若红则按红项定位 drill include 泄漏）。

- [ ] **Step 7: Commit**

```bash
git add apps/api/tsconfig.drill.json apps/api/scripts/collab-kill9-drill.ts apps/api/scripts/write-frozen-drill.mjs .gitignore scripts/check-no-testutils-in-dist.mjs
git commit -m "fix(ci): R1' drill 独立输出根 dist-drill——消灭同目录双布局（tsconfig.drill outDir+两 drill 三处消费路径同批+testutils 扩扫；B12 部署消费面 smoke/soak/exec-smoke 零触碰）"
```

---

### Task 2: R2'——write-frozen-drill.mjs 错误出口确定性收口

**Files:**
- Modify: `apps/api/scripts/write-frozen-drill.mjs`

- [ ] **Step 1: 先红证据（watchdog 不存在=TEMP-RED 变异挂起）**

T1 完成后注入错误路径（把 :188 临时改回 `'../dist-drill/src/modules/collab/canvas-doc-update.repositoryXX.js'`），跑 frozen-chain 并计时 30s 内不退出（Ctrl+C）——观察进程挂起（run 59 已有 5h56m 生产留档，本步本地 30s 复现即红证据）。改回正确路径。

- [ ] **Step 2: client registry——`connectClient` 注册与幂等 destroy**

`connectClient` 返回对象前注册（模块级 `liveChildren` 旁新增）：

```js
const liveClients = new Set();   // R2'：B3 根因闭环——client 注册表（finally 统一 destroy）
```

`connectClient` 尾部 return 前加 `liveClients.add(entry)`，且返回的 `destroy` 改幂等+自摘：

```js
const entry = { tag: tag ?? 'c', provider, doc, statusLog, connStatusLog, wsCloses, synced,
  destroy: () => { if (!liveClients.delete(entry)) return;   // 幂等（二次 destroy 短路）
    try { provider.destroy(); } catch { /* 同步 void——smoke B4 */ } } };
liveClients.add(entry);
return entry;
```

（原返回字面量整体替换为 `entry` 构造+注册两步。）

- [ ] **Step 3: 两 mode 的 finally 统一加 destroy**

`frozenChainMode` finally（:337-341 快照）与 `midEditKill9Mode` finally（:403-407 快照）的**首行**各加：

```js
for (const c of liveClients) c.destroy();   // R2'：错误路径 provider 收口（成功路径已各自 destroy——幂等短路）
```

- [ ] **Step 4: die + watchdog 替换 catch 兜底（v2：watchdog 保 ref——unref+无句柄 hang=exit 0 假绿）**

文件尾部 `void main().catch(...)`（:425-429 快照）整体替换：

```js
function die(e) {   // R2'：stderr 同步写（CI 管道防截断）+1s 兜底 exit
  clearTimeout(watchdog);
  for (const c of liveChildren) c.kill('SIGKILL');
  const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
  process.stderr.write(`\nDRILL FAIL: ${msg}\n`, () => process.exit(1));
  setTimeout(() => process.exit(1), 1_000);   // v3：fallback 保 ref（unref+stderr 背压=exit 0 假绿——与主 timer 同教训）
}

// R2' watchdog（B19 分责）：兜 catch 不可达的 hang（fetch/Prisma/未知句柄）；execSync(tsc) 阻塞期
// 本定时器不触发——tsc 挂由 CI step timeout 兜底（write-frozen step 10min）。exit 2 与业务失败 1 区分。
// v2：**保 ref 不 unref**——main 卡在无句柄未决 Promise 时 unref 定时器不阻止退出=exit 0 假绿
// （比 hang 更危险）；成功/die 路径 clearTimeout。默认 6min < CI step 10min（先于 step 杀拿到诊断）。
const WATCHDOG_MS = Number(process.env.WF_DRILL_WATCHDOG_MS) || 6 * 60_000;
const watchdog = setTimeout(() => {
  for (const c of liveClients) c.destroy();
  for (const c of liveChildren) c.kill('SIGKILL');
  process.stderr.write('DRILL WATCHDOG: 超时强制退出（exit 2）\n', () => process.exit(2));
  setTimeout(() => process.exit(2), 1_000);   // v3：fallback 保 ref 同上
}, WATCHDOG_MS);

void main().then(() => { clearTimeout(watchdog); }).catch(die);
```

- [ ] **Step 5: fetch 有界**——`metrics()`（:171）、`postShrink()`（:206）、drain POST（`frozenChainMode` :265）三处 fetch options 各加：

```js
signal: AbortSignal.timeout(10_000),   // R2'：每个网络 await 有界
```

- [ ] **Step 6: 验收绿（两种失败形态+成功路径）**

```bash
# a) 业务错误→秒级 exit 1 栈完整（TEMP-RED 变异复跑：改错 :188 路径）
node scripts/write-frozen-drill.mjs --mode=frozen-chain; echo "exit=$?"
# 期望：<5s 退出，stderr 含 DRILL FAIL: Cannot find module + 完整 stack，exit=1
# 改回正确路径
# b) watchdog→exit 2（本地 PG 起着，注入极短 watchdog）
WF_DRILL_WATCHDOG_MS=100 node scripts/write-frozen-drill.mjs --mode=frozen-chain; echo "exit=$?"
# 期望：exit=2 且 DRILL WATCHDOG 输出（100ms 内 ready 都没完成即触发）
# c) 成功路径不触发 watchdog（保 ref 后成功必须 clearTimeout——防慢成功被 exit 2）
node scripts/write-frozen-drill.mjs --mode=frozen-chain
# 期望：DRILL PASS 且正常退出（exit 0——验证 then 分支 clear；Post 段无孤儿）
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/scripts/write-frozen-drill.mjs
git commit -m "fix(ci): R2' write-frozen 演练错误出口确定性收口——client registry+finally destroy（B3 根因闭环）+stderr 同步写防截断+watchdog 保 ref（unref=无句柄 hang 假绿根修）+成功路径 clear+fetch AbortSignal 有界"
```

---

### Task 3: R2'——collab-kill9-drill.ts 同款收口

**Files:**
- Modify: `apps/api/scripts/collab-kill9-drill.ts`（错误出口 :421-425 快照 + connectWrite :149-153 快照）

- [ ] **Step 1: connectWrite 注册**——模块级 `liveClients = new Set()`（:92 liveChildren 旁）；`connectWrite` 返回 `{ provider, keys }` 改为 `{ provider, keys, destroy: () => { if (!liveClients.delete(e)) return; try { provider.destroy(); } catch {} } }`（构造 entry 后 `liveClients.add(entry)`）。调用点既有显式 destroy/断连收口改调 `entry.destroy()`（幂等短路兼容原状）。

- [ ] **Step 2: main 体内 finally（cleanup 段 :415 附近）首行加**：

```ts
for (const c of liveClients) c.destroy();   // R2' 同款：错误路径 provider 收口
```

- [ ] **Step 3: catch 兜底同款替换**（:421-425——v2：watchdog 保 ref+成功 clear+6min 默认）：

```ts
function die(e: unknown): void {
  clearTimeout(watchdog);
  for (const c of liveChildren) c.kill('SIGKILL');
  const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
  process.stderr.write(`\nDRILL FAIL: ${msg}\n`, () => process.exit(1));
  setTimeout(() => process.exit(1), 1_000);   // v3：fallback 保 ref（同 write-frozen 教训）
}
const WATCHDOG_MS = Number(process.env.WF_DRILL_WATCHDOG_MS) || 6 * 60_000;   // v2：保 ref+<kill9 step 8min
const watchdog = setTimeout(() => {
  for (const c of liveClients) c.destroy();
  for (const c of liveChildren) c.kill('SIGKILL');
  process.stderr.write('DRILL WATCHDOG: 超时强制退出（exit 2）\n', () => process.exit(2));
  setTimeout(() => process.exit(2), 1_000);   // v3：fallback 保 ref
}, WATCHDOG_MS);
void main().then(() => { clearTimeout(watchdog); }).catch(die);
```

- [ ] **Step 4: 验收**——七模式抽查两档（kill9-normal + handover）PASS + `WF_DRILL_WATCHDOG_MS=100` exit 2 + tsc 类型过（`pnpm --filter @flowweb/api exec tsc -p tsconfig.scripts.json --noEmit`——kill9 归 scripts 类型面）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/scripts/collab-kill9-drill.ts
git commit -m "fix(ci): R2' kill9 演练同款收口——liveClients registry+die/watchdog+finally destroy（:421-425 同款 bug 根修）"
```

---

### Task 4: R3'——CI 卫生（concurrency/timeout/step timeout + 独立 ci-notify.yml）

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/ci-notify.yml`

- [ ] **Step 1: ci.yml 变更**——`on:` 块之后、`jobs:` 之前插入：

```yaml
# R3'（v3）：新 push 取代旧 run——6h hang 形态下省 runner（#62-66 人工取消的机制化）。
# 取舍登记（spec §6.3）：master 连续 push 时中间 commit 的 run 被取代（单人线性流信号取舍）。
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

四个 job 的 `runs-on:` 行之后各加一行（合法 job mapping——key 换行写）：

```yaml
    timeout-minutes: 60    # test：verify tier=full 实测 ~11min
```

（collab-core 30 / doc-gate 5 / gitleaks 10 同款——每 job 一行。）

step 级（collab-core 内，**和 6+8+10=24+setup ~1min < job 30**）：int 步 `timeout-minutes: 6` / kill9 步 8 / write-frozen 步 10（写在各 step 的 `run:` 旁，与 `name:` 平级）；test job 的 verify 步 `timeout-minutes: 55`。

- [ ] **Step 2: 独立 ci-notify.yml（v2——workflow_run 是 workflow 级触发器，ci.yml 内 notify job 永不可达）**

`.github/workflows/ci-notify.yml`：

```yaml
# R3'（v2）：master 失败通知——独立 workflow（workflow_run 触发器只能在 on: 层，非 job 级条件）。
# 幂等=单 tracking issue（title 识别，不用 label——label 不存在会 422）；通知是配套非 gate。
name: ci-notify
on:
  workflow_run:
    workflows: [ci]
    types: [completed]
permissions:
  issues: write
jobs:
  notify:
    # v3：22 连败形态=6h 超时被 cancel（conclusion=cancelled/timed_out 非 failure）——只匹配 failure=治理缺口原样保留
    if: >-
      (github.event.workflow_run.conclusion == 'failure' ||
       github.event.workflow_run.conclusion == 'timed_out' ||
       github.event.workflow_run.conclusion == 'cancelled') &&
      github.event.workflow_run.head_branch == 'master'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/github-script@v7
        with:
          script: |
            const run = github.event.workflow_run;
            const title = 'CI master 失败追踪（tracking issue——勿新建）';
            const found = await github.rest.issues.listForRepo({
              owner: context.repo.owner, repo: context.repo.repo, state: 'open', per_page: 100,
            });
            const issue = found.data.find((i) => i.title === title);
            const body = `CI run #${run.run_number} 失败（${run.head_sha.slice(0, 8)}）：${run.html_url}`;
            if (issue) {
              await github.rest.issues.createComment({ ...context.repo, issue_number: issue.number, body });
            } else {
              await github.rest.issues.create({ ...context.repo, title, body });
            }
```

- [ ] **Step 3: 校验**——yaml 缩进目测（两文件）+ push 后行为验证归 T10 批出口（观察 notify 在成功 run 无动作、失败 run 开/追加 issue）。

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/ci-notify.yml
git commit -m "fix(ci): R3' CI 卫生——concurrency cancel-in-progress+四 job timeout+step 级超时（和≤job）+独立 ci-notify.yml（workflow_run 触发+title 幂等识别）"
```

---

### Task 5: R4b'——collab-limits.ts 派生契约（TDD 先红）

**Files:**
- Create: `apps/api/src/modules/collab/collab-limits.ts`
- Create: `apps/api/src/modules/collab/collab-limits.spec.ts`

- [ ] **Step 1: 先写测试（模块不存在=import 失败真红）**

`collab-limits.spec.ts`：

```ts
// apps/api/src/modules/collab/collab-limits.spec.ts
// R4b'（v3）：limits 派生契约——fail-fast 三校验+2MiB 下限+ALLOWANCE 余量+满帧算术。
// 红相：模块不存在 import 失败（元纪律⑥——「pass 0 fail 1」落档）。
// v2：入参收窄 Pick（QUOTA_DEFAULTS 无 msgRate/bytesRate——QuotaConfig 四键形态 TS2345 根除）。
import { describe, it, expect } from 'vitest';
import { QUOTA_DEFAULTS, FRAME_ALLOWANCE_BYTES } from '@flowweb/shared';
import {
  WS_MAX_PAYLOAD_BYTES, BACKPRESSURE_DROP_BYTES, OUTBOUND_BUDGET_BYTES,
  deriveCollabLimits, DEFAULT_COLLAB_LIMITS,
} from './collab-limits';

const q = (o: Partial<Pick<typeof QUOTA_DEFAULTS, 'maxDocBytes' | 'maxTxBytes'>>) => ({ ...QUOTA_DEFAULTS, ...o });

describe('R4b\' collab-limits 派生契约', () => {
  it('常量族单源值：maxPayload 16MiB（自 factory:68 迁入）/drop 1MiB（自 SG:62 迁入）/budget 100,663,296B=96MiB（v3: 64→96——10 人×8MB 扇出 80.6<96；字面量=check-ecosystem 提取式兼容）', () => {
    expect(WS_MAX_PAYLOAD_BYTES).toBe(16_777_216);
    expect(BACKPRESSURE_DROP_BYTES).toBe(1_048_576);
    expect(OUTBOUND_BUDGET_BYTES).toBe(100_663_296);
  });

  it('默认档：close = 2×ss2Gate + ALLOWANCE = 16,973,824（满帧×2+ack 不误杀——v3 余量）+预算联动通过', () => {
    const l = DEFAULT_COLLAB_LIMITS;
    expect(l.ss2FrameGate).toBe(QUOTA_DEFAULTS.maxDocBytes + FRAME_ALLOWANCE_BYTES);
    expect(l.backpressureCloseBytes).toBe(2 * l.ss2FrameGate + FRAME_ALLOWANCE_BYTES);
    expect(l.backpressureCloseBytes).toBe(16_973_824);
    expect(l.backpressureCloseBytes).toBeLessThanOrEqual(l.outboundBudgetBytes / 2);
    expect(l.bytesBucketCapacity).toBe(l.ss2FrameGate);   // B8 先例形态平移（T8 裁定 24⑵ 不变量）
  });

  it('小配额档：close=2MiB 下限 > drop=1MiB（close<drop 反转根修——B17 夹具族形态）', () => {
    for (const maxDoc of [2_048, 8_192, 40_000]) {
      const l = deriveCollabLimits(q({ maxDocBytes: maxDoc }));
      expect(l.backpressureCloseBytes).toBe(2 * BACKPRESSURE_DROP_BYTES);
      expect(l.backpressureCloseBytes).toBeGreaterThan(l.backpressureDropBytes);
    }
  });

  it('fail-fast ①：ss2Gate > maxPayload 抛错（16MiB doc 档——走本分支；B6 footgun 根修）', () => {
    expect(() => deriveCollabLimits(q({ maxDocBytes: 16 * 1024 * 1024 }))).toThrow();
  });

  it('fail-fast ②：2×maxTxBytes > maxPayload 抛错（maxTx=10MiB 档）', () => {
    expect(() => deriveCollabLimits(q({ maxTxBytes: 10 * 1024 * 1024 }))).toThrow();
  });

  it('fail-fast ③：close > budget/2 抛错（注入小 budget——默认档 close 16,973,824 > 2.5MiB）', () => {
    expect(() => deriveCollabLimits(q({}), 5 * 1024 * 1024)).toThrow();
  });

  it('满帧边界算术：两满帧+一 ack 投影 ≤ close（前瞻判定语义自洽）', () => {
    const l = DEFAULT_COLLAB_LIMITS;
    const full = l.ss2FrameGate;
    expect(2 * full + 64).toBeLessThanOrEqual(l.backpressureCloseBytes);
  });
});
```

- [ ] **Step 2: 跑测试确认红**

```bash
cd apps/api && pnpm exec vitest run src/modules/collab/collab-limits.spec.ts
```

Expected: FAIL——`Cannot find module './collab-limits'`（红输出截屏/文本落档）。

- [ ] **Step 3: 实现 collab-limits.ts**

```ts
// apps/api/src/modules/collab/collab-limits.ts
// R4b'（v3）：出站背压/帧闸派生契约单源——自 SG 常量族与 factory maxPayload 收敛（B16 单源化）。
// 三 fail-fast 校验=env footgun 根修（B6：COLLAB_MAX_DOC_BYTES 配 20MB 时应用层 4404 永不可达）。
// v2 勘正：maxTxBytes>maxDocBytes 不校验（tx=单事务上限/doc=内容配额，tx>doc 合法形态——B17 六夹具
// +drill 子进程经 app.module:46 validateEnv 会被 40KB/256KB 打死——env superRefine 方案同因撤销）。
// close 语义：前瞻判定 backlog+frame>close → 帧型分支执法（sync 前瞻 close/stateless 仅 backlog 判定
// /awareness 永 drop——v2 帧型三档）；+ALLOWANCE 余量=两满帧+ack 不误杀。
// OUTBOUND_BUDGET_BYTES 用字面量（check-ecosystem 提取式 [\d_]+ 不匹配乘式）。
import { QUOTA_DEFAULTS, FRAME_ALLOWANCE_BYTES } from '@flowweb/shared';
import type { QuotaConfig } from './collab-doc-registry.service';

export const WS_MAX_PAYLOAD_BYTES = 16_777_216;         // 自 collab-server.factory.ts:68 迁入单源（B16）
export const BACKPRESSURE_DROP_BYTES = 1_048_576;      // 自 collab-session-guard.service.ts:62 迁入
export const OUTBOUND_BUDGET_BYTES = 100_663_296;      // v3: 64→96MiB（10 人×8MB 扇出 80.6<96；折衷值非推导值——spec §6.4 登记）

export interface CollabLimits {
  ss2FrameGate: number;
  updateFrameGate: number;
  bytesBucketCapacity: number;
  backpressureDropBytes: number;
  backpressureCloseBytes: number;
  outboundBudgetBytes: number;
}

/** v2：入参收窄——limits 派生只消费 doc/tx 两量（QUOTA_DEFAULTS 无 msgRate/bytesRate 勿绑速率桶字段）。 */
export function deriveCollabLimits(q: Pick<QuotaConfig, 'maxDocBytes' | 'maxTxBytes'>, budget = OUTBOUND_BUDGET_BYTES): CollabLimits {
  const ss2FrameGate = q.maxDocBytes + FRAME_ALLOWANCE_BYTES;
  const updateFrameGate = 2 * q.maxTxBytes;
  if (ss2FrameGate > WS_MAX_PAYLOAD_BYTES) {
    throw new Error(`collab-limits: maxDocBytes(${q.maxDocBytes})+ALLOWANCE > ws maxPayload(${WS_MAX_PAYLOAD_BYTES})——应用层 4404 不可达（env COLLAB_MAX_DOC_BYTES 超界）`);
  }
  if (updateFrameGate > WS_MAX_PAYLOAD_BYTES) {
    throw new Error(`collab-limits: 2×maxTxBytes(${q.maxTxBytes}) > ws maxPayload(${WS_MAX_PAYLOAD_BYTES})——Update 闸形同虚设（env COLLAB_MAX_TX_BYTES 超界）`);
  }
  const backpressureCloseBytes = Math.max(2 * ss2FrameGate + FRAME_ALLOWANCE_BYTES, 2 * BACKPRESSURE_DROP_BYTES);
  if (backpressureCloseBytes > budget / 2) {
    throw new Error(`collab-limits: backpressureClose(${backpressureCloseBytes}) > outbound budget/2(${budget / 2})——预算与单连接上界失配`);
  }
  return { ss2FrameGate, updateFrameGate, bytesBucketCapacity: ss2FrameGate, backpressureDropBytes: BACKPRESSURE_DROP_BYTES, backpressureCloseBytes, outboundBudgetBytes: budget };
}

export const DEFAULT_COLLAB_LIMITS = deriveCollabLimits(QUOTA_DEFAULTS);
```

- [ ] **Step 4: 跑测试确认绿**

```bash
cd apps/api && pnpm exec vitest run src/modules/collab/collab-limits.spec.ts
```

Expected: PASS（全用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/collab/collab-limits.ts apps/api/src/modules/collab/collab-limits.spec.ts
git commit -m "feat(ci): R4b' collab-limits 派生契约单源——三 fail-fast+2MiB 下限+ALLOWANCE 余量+96MiB 预算常量（TDD 先红：模块不存在 import 失败）"
```

---

### Task 6: R4b'——OutboundBudget 类（wrap 判定核迁移）+SG 委托+factory pin

**Files:**
- Create: `apps/api/src/modules/collab/collab-outbound-budget.ts`（**wrap 判定核自 SG 迁入**）
- Modify: `apps/api/src/modules/collab/collab-session-guard.service.ts`（:62-63 常量删/:342-344 桶容量/:728-748 wrap 方法→委托）
- Modify: `apps/api/src/modules/collab/collab-server.factory.ts:68`
- Modify: `apps/api/src/modules/collab/collab.gateway.ts:49`（再导出）+`:76`（send 类型签名）
- Modify: `apps/api/src/modules/collab/store.metrics.ts`（新 gauge/counter 单源）
- Modify: `apps/api/src/modules/collab/collab-backpressure.spec.ts`
- **零改动**：`collab-doc-registry.service.ts`（1082/1082 一行不可加——activeLimits 撤销；闸式保留 quota 直读=值恒等，spec 偏离登记）/`env.ts`（tx>doc 校验全撤——drill 子进程经 app.module:46 必被打死）

- [ ] **Step 1: 新建 collab-outbound-budget.ts（v3：四档帧型+getBacklog 闭包+记账三修）**

```ts
// apps/api/src/modules/collab/collab-outbound-budget.ts
// R4b'（v3）：出站背压判定核+全局预算同步记账——自 SG wrapBackpressure 整体迁入。
// 帧型四档（v3——MessageType 枚举实证 SyncReply=4 是 SS1 回复携全 doc diff 的载体，v2 漏归=上界失效）：
//   ①大帧组 Sync(0)+SyncReply(4)：前瞻 close（backlog+frame>close）——封顶单连接真实上界；
//   ②控制组 Stateless(5)/BroadcastStateless(6)/SyncStatus(8)/Ping(9)/Pong(10)/QueryAwareness(3)：
//     仅 backlog>close 才关（+20B 不触发前瞻）且**预算豁免**（doc-status/conn-status/心跳永不因
//     预算静默丢——控制帧承载状态通道，丢=状态丢失比 close 更糟）；
//   ③Awareness(1)：永 drop 不 close；
//   ④预算失败：大帧组 close(reason='global-budget')，控制/awareness 组不计不投。
// getBacklog 闭包（v3）：bufferedAmount 读点文本留 SG 闭包——本文件零 `.bufferedAmount` 出现
// → census ⑤ 脚本/自测/backpressure spec 三处零改（读点仍唯一=SG，弃 v2「目标文件切换」方案）。
import { readFrameType, MessageType } from './collab-frame-type';
import { CollabCloseCode } from '@flowweb/shared';
import type { CollabLimits } from './collab-limits';
import { collabAwarenessDroppedTotal, collabSlowConsumerDisconnectTotal, collabOutboundBudgetCloseTotal, yjsOutboundBacklogBytes, yjsOutboundQueuedBytes } from './store.metrics';

type Ws = { send: (data: unknown, cb?: (err?: Error) => void) => void; close: (code: number, reason: string) => void; once?: (event: string, cb: () => void) => void };

const CONTROL_TYPES = new Set<number>([MessageType.QueryAwareness, MessageType.Stateless, MessageType.BroadcastStateless, MessageType.SyncStatus, MessageType.Ping, MessageType.Pong]);

export class OutboundBudget {
  private readonly reservedByWs = new Map<Ws, { getBacklog: () => number; reserved: number }>();
  private total = 0;

  constructor(private readonly limits: CollabLimits) {}

  /** wrap 判定核。getBacklog 由 SG 闭包提供（读点文本留 SG=census ⑤ 零改）。幂等（Map 判重）。 */
  wrap(ws: Ws, hardCloseWs: (ws: Ws, code: number, reason: string) => void, getBacklog: () => number): void {
    if (this.reservedByWs.has(ws)) return;
    this.reservedByWs.set(ws, { getBacklog, reserved: 0 });
    ws.once?.('close', () => this.onClose(ws));   // close 兜底释放（未 flush 残账——泄漏根修）
    const orig = ws.send.bind(ws);
    let sends = 0;
    ws.send = (data: unknown, cb?: (err?: Error) => void) => {
      const frameBytes = (data as Uint8Array)?.byteLength ?? 0;
      const backlog = getBacklog();   // census ⑤：读点经 SG 闭包（本文件零 .bufferedAmount 文本）
      const frameType = readFrameType(data as Uint8Array);
      const isControl = frameType !== null && CONTROL_TYPES.has(frameType);
      if (frameType === MessageType.Awareness) {
        // ③：awareness 永 drop 不 close
        if (backlog + frameBytes > this.limits.backpressureCloseBytes || backlog > this.limits.backpressureDropBytes) {
          collabAwarenessDroppedTotal.inc();
          return;
        }
      } else if (!isControl) {
        // ①大帧组（Sync/SyncReply/未知 sync 族）：前瞻 close
        if (backlog + frameBytes > this.limits.backpressureCloseBytes) {
          collabSlowConsumerDisconnectTotal.inc();
          hardCloseWs(ws, CollabCloseCode.SLOW_CONSUMER, 'slow-consumer');
          return;
        }
      } else if (backlog > this.limits.backpressureCloseBytes) {
        // ②控制组：仅 backlog 已超 close 才关（+20B 不前瞻——心跳反杀根修）
        collabSlowConsumerDisconnectTotal.inc();
        hardCloseWs(ws, CollabCloseCode.SLOW_CONSUMER, 'slow-consumer');
        return;
      }
      if (isControl) {   // ②控制组预算豁免（v3——doc-status/conn-status/心跳永不因预算丢）
        if (++sends % 10 === 0) yjsOutboundBacklogBytes.observe(backlog);
        orig(data, cb);
        return;
      }
      if (!this.reserve(ws, frameBytes)) {   // ④大帧组预算失败
        collabOutboundBudgetCloseTotal.inc();
        collabSlowConsumerDisconnectTotal.inc();
        hardCloseWs(ws, CollabCloseCode.SLOW_CONSUMER, 'global-budget');
        return;
      }
      if (++sends % 10 === 0) yjsOutboundBacklogBytes.observe(backlog);
      try {
        orig(data, (err) => { this.release(ws, frameBytes); cb?.(err); });
      } catch {
        this.release(ws, frameBytes);   // send 同步抛（已断）——预扣不漏
        throw;
      }
    };
  }

  private reserve(ws: Ws, bytes: number): boolean {
    if (this.total + bytes > this.limits.outboundBudgetBytes) return false;
    this.total += bytes;
    this.reservedByWs.get(ws)!.reserved += bytes;
    yjsOutboundQueuedBytes.set(this.total);
    return true;
  }

  release(ws: Ws, bytes: number): void {
    if (!this.reservedByWs.has(ws)) return;   // v3：closed 后迟到 cb 禁复活 Map（onClose 已释放）
    this.total = Math.max(0, this.total - bytes);
    this.reservedByWs.get(ws)!.reserved = Math.max(0, this.reservedByWs.get(ws)!.reserved - bytes);
    yjsOutboundQueuedBytes.set(this.total);
  }

  /** close 兜底：整连接残账一次释放+台账摘除（cb 不保证触发的泄漏根修）。 */
  onClose(ws: Ws): void {
    const e = this.reservedByWs.get(ws);
    if (!e) return;
    this.total = Math.max(0, this.total - e.reserved);
    this.reservedByWs.delete(ws);
    yjsOutboundQueuedBytes.set(this.total);
  }

  /** 对账（v3：per-ws 回填——reconcile 后 onClose 按当前值减，total 与 per-ws 永不漂移）。
   *  挂 SG authMapsSweeper（60s、SWEEP_ENABLED 阀**之前**=始终运行——弃 sessionSweep 挂点：受逃生阀）。 */
  reconcile(): void {
    let sum = 0;
    for (const [ws, e] of this.reservedByWs) {
      e.reserved = e.getBacklog();
      sum += e.reserved;
    }
    this.total = sum;
    yjsOutboundQueuedBytes.set(this.total);
  }

  get queuedBytes(): number { return this.total; }
}
```

（`yjsOutboundQueuedBytes` gauge+`collabOutboundBudgetCloseTotal` counter 定义进 `store.metrics.ts` 单源（SG:39 import 族先例），本模块 import；global-budget 计数唯一在 `collabOutboundBudgetCloseTotal`——`hardCloseWs` 内部 `collabWsCloseTotal` 记 close 事件（去 v2 双计）。）

- [ ] **Step 2: SG 委托（v3：getBacklog 闭包+死代码删+934 守护）**——`collab-session-guard.service.ts`：
  1. `:62-63` 两常量**删**（迁 collab-limits）；`:296` `backpressureWrapped` WeakSet **删**（wrap 判定迁出后死代码）+ 相关死 import 同批清（`collabSlowConsumerDisconnectTotal`/`yjsOutboundBacklogBytes` 等若 SG 无其余消费点——grep 核验后删）。
  2. 构造器：`this.limits = deriveCollabLimits(this.docRegistry.activeQuota);` + `this.outbound = new OutboundBudget(this.limits);`；`:343` 桶容量改 `this.limits.bytesBucketCapacity`。
  3. `wrapBackpressure` 方法体（:728-748 约 21 行）**整体替换**为 3 行委托：

```ts
  wrapBackpressure(conn: CollabConnection): void {   // R4b'：判定核迁 OutboundBudget（getBacklog 闭包——census ⑤ 读点文本留本文件，脚本/自测/spec 三处零改）
    const ws = conn.webSocket;
    if (!ws) return;
    this.outbound.wrap(ws, (w, code, reason) => this.hardCloseWs(w, code, reason), () => ws.bufferedAmount ?? 0);
  }
```

  4. `sweepStaleAuthMaps` 回调（:455-456 authMapsSweepTimer 族——**阀前=始终运行**，弃 sessionSweep 挂点）尾追加：`this.outbound.reconcile();`（1 行）。
  5. SG 净变化核算：−2（常量）−21（wrap 体）−2（WeakSet+注释）+5（委托 3+构造 2+字段 2）+1（reconcile）≈ **净 −17**（T9 再 +6 → 净 −11 ≤1238 ✓）。

- [ ] **Step 3: gateway 934 守护+once 类型**——`collab.gateway.ts`：
  1. `:76` webSocket 结构类型扩（**send 双参+once 可选**）：

```ts
  webSocket?: { send: (data: unknown, cb?: (err?: Error) => void) => void; close: (code: number, reason: string) => void; bufferedAmount?: number; once?: (event: string, cb: () => void) => void };
```

  2. `:49` 再导出**保持一行**（拆两行=935>934 红——v3 实证）——原行删 BACKPRESSURE 两名（limits 常量族**不经 gateway 再导出**，消费方 import 改直源 `./collab-limits`——零行数净变化）：

```ts
export { AWARENESS_FRAME_LIMIT_BYTES, AWARENESS_STATES_LIMIT_BYTES, AWARENESS_DISTINCT_USER_STRIP_OVER } from './collab-session-guard.service';
```

（gateway :49 原行含 AWARENESS×3+BACKPRESSURE×2 五名——删两名保持一行；`rate-gate.spec :15` 的 `AWARENESS_FRAME_LIMIT_BYTES` import 零动，`backpressure.spec :14` 的 BACKPRESSURE import 改直源。）

  3. census ⑤ **零改核验**：`node scripts/check-collab-census.mjs` PASS（读点仍 SG）+ backpressure spec census 用例零改（`expect(hits).toEqual(['collab-session-guard.service.ts'])` 不动）。
  4. BACKPRESSURE_CLOSE_BYTES 退役：全仓 grep 消费方改 `DEFAULT_COLLAB_LIMITS.backpressureCloseBytes`。

- [ ] **Step 4: factory pin（顶层键）**——`collab-server.factory.ts:68`：

```ts
    websocketOptions: { maxPayload: WS_MAX_PAYLOAD_BYTES },
    // R4b'：flush 族显式 pin（B7——顶层键；库默认值 0/1MiB 原值，pin 语义非改值）
    flushDelay: 0,
    flushMaxBytes: 1_048_576,
```

（options.spec「websocketOptions 键集 ⊆ {maxPayload}」**保持不动**；另加两条顶层断言。）

- [ ] **Step 5: backpressure spec 重构**——`collab-backpressure.spec.ts`：
  - import 改：`BACKPRESSURE_DROP_BYTES, WS_MAX_PAYLOAD_BYTES` 自 `./collab-limits`（直源——gateway 再导出面退役）+`DEFAULT_COLLAB_LIMITS`。
  - `makeStubWs`：send 加 `cb?: (err?: Error) => void`（不自动调用——预算用例保留预扣）；**close 触发 once('close') 监听**（stub 维护 `closeCbs` 数组，close() 遍历调用——close 释放用例才有效）；`once(event, cb)` stub 注册。
  - `:97` 算术改 `DEFAULT_COLLAB_LIMITS.backpressureCloseBytes + 1MB`；`:107` 边界改前瞻语义。
  - 新增四用例：①close 释放（发帧不调 cb → ws.close() → `queuedBytes` 回 0+**close 后迟到 cb 不复活 Map**）；②预算 close（小 budget 实例+多 stub 连发+`collabOutboundBudgetCloseTotal` 计数）；③控制帧不前瞻+预算豁免（backlog=close-1 发 20B stateless → 照投不计账）；④**SyncReply 大帧前瞻**（backlog=close-1 发 8MB Sync 帧族 → close 不投递——v3 漏网根修证据）。

- [ ] **Step 6: 验收**——limits+backpressure 两 spec 绿 + `node scripts/check-collab-census.mjs` PASS（零改核验）+ `node scripts/check-collab-module-size.mjs` PASS（SG 净 −17+gateway 934 不动）+ `pnpm --filter @flowweb/api exec tsc --noEmit`。

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/collab/collab-outbound-budget.ts apps/api/src/modules/collab/collab-session-guard.service.ts apps/api/src/modules/collab/collab-server.factory.ts apps/api/src/modules/collab/collab.gateway.ts apps/api/src/modules/collab/store.metrics.ts apps/api/src/modules/collab/collab-backpressure.spec.ts
git commit -m "feat(ci): R4b' OutboundBudget 判定核迁移——四档帧型（SyncReply 实证归大帧组+控制组预算豁免）+getBacklog 闭包（census ⑤ 三处零改）+记账三修（closed 禁复活/per-ws 回填/authMapsSweeper 对账）+gateway 934 守护（limits 直源再导出退役）+死代码清"
```

---

### Task 7: R4a'——rate-gate spec 改造（长度锚+红门⑧ 勘正+refill 小档+事件化）

**Files:**
- Modify: `apps/api/src/modules/collab/collab-rate-gate.spec.ts`

- [ ] **Step 1: 成对用例长度锚**（:93 快照）：

```ts
      const BLOB_LEN = 8_388_638;   // R4a'：长度锚（O(1) 零分配——每轮 8MB churn 根除）
      await pollUntil(() => (doc()?.getMap('m').get('blob') as string | undefined)?.length === BLOB_LEN, 30_000);
      expect(doc()?.getMap('m').get('blob')).toBe('x'.repeat(BLOB_LEN));   // 一次性全等（单次分配）
```

- [ ] **Step 2: 负向断言事件化（v3：slow0+msgs 监听都前置到 send 之前——后置取基线=假绿〔1011 在 ack send 同 tick +1，后取的 slow0 已含该次〕）**（:94-95 快照）：

```ts
      const slow0 = await counterOf('collab_slow_consumer_disconnect_total');   // v3：基线必须在 send 前
      let msgs = 0;
      client.on('message', () => { msgs += 1; });   // v3：监听也前置（echo 后置挂会漏第一条）
      // …（client.send(bigUpdate) 在此后——原 :91 发送行）
      await pollUntil(() => msgs >= 2, 5_000);   // echo（回显）+SyncStatus ack 两帧序已落
      await sleep(200);   // close 事件冒泡窗
      expect(await counterOf('collab_slow_consumer_disconnect_total')).toBe(slow0);   // 零 1011（计数器基线正确）
      expect(closeInfo()).toBeNull();   // 帧面复核
```

- [ ] **Step 3: 红门⑧ 勘正（B9 v3 定稿——保留桶断言+改名+补 readOnly；v2：sleep(3500)→pollUntil 冻结读面+tokens 两次断言）**（:107-133 快照整用例重写）：

```ts
  it('红门⑧（v3 勘正）：8MB 回灌——第一次入桶并 apply 后软阈冻结；等冻结落地后第二次仍入桶（refill 后通过=桶容量断言）但 readOnly 拒 apply（writes_dropped 计数）+零 1008/1011', async () => {
    const kit = await startDualClientServer({}, 300, undefined, undefined, QUOTA_BIG);
    try {
      const gw = kit.gateway;
      const g = gatewayFacade(gw);
      const big = new Y.Doc();
      big.getMap('m').set('blob', 'x'.repeat(8_388_000));
      const bigUpdate = Y.encodeStateAsUpdate(big);
      expect(bigUpdate.byteLength).toBeLessThanOrEqual(QUOTA_BIG.maxDocBytes);
      const { client, closeInfo } = await openAuthedWs(kit, 'project:gate8');
      const b0 = await counterOf('collab_bytes_rate_exceeded_total');
      client.send(frame('project:gate8', 0 /* Sync */, 1 /* SyncStep2 */, bigUpdate));
      const doc = () => gw.server.hocuspocus.documents.get('project:gate8');
      const BLOB_LEN = 8_388_000;   // R4a' 长度锚
      await pollUntil(() => (doc()?.getMap('m').get('blob') as string | undefined)?.length === BLOB_LEN, 30_000);   // 第一次：入桶+apply
      const sid = [...doc()!.connections.keys()][0].socketId as string;
      const tokensAfterFirst = g.bytesBucketTokens(sid);
      expect(tokensAfterFirst).toBeLessThan(QUOTA_BIG.maxDocBytes / 2);   // 桶容量断言（有效——B9 v3 勘正保留）
      // v3：等冻结落地=确定性读面（freezeQuota→quotaFrozenDocs——façade 新读面，弃 (gw as any) 撞 façade 门禁）
      const dropped0 = await counterOf('collab_quota_writes_dropped_total', { reason: 'quota' });
      await pollUntil(() => g.quotaFrozen('project:gate8'), 10_000);   // gatewayFacade 增 quotaFrozen(pid) 读面（gateway-facade 同批 1 方法）
      client.send(frame('project:gate8', 0 /* Sync */, 1 /* SyncStep2 */, bigUpdate));   // 第二次：仍入桶（DR:722 先于 :728 readOnly——B9）→ readOnly 拒 apply
      await pollUntil(async () => (await counterOf('collab_quota_writes_dropped_total', { reason: 'quota' })) > dropped0, 8_000);   // readOnly 拒写计数
      await pollUntil(() => g.bytesBucketTokens(sid) < tokensAfterFirst + 1_000, 5_000);   // v2：第二次桶消费直接断言（refill 后再扣 ~8MB——tokens 回落）
      expect(closeInfo()).toBeNull();                                          // 零 1008（桶容量吸收）/零 1011（R4b' 前瞻+回显不误杀）
      expect(await counterOf('collab_bytes_rate_exceeded_total')).toBe(b0);    // 全程零速率拒
      client.terminate();
    } finally { await kit.dispose(); }
  }, 60_000);
```

（`gatewayFacade` 同批增 `quotaFrozen(pid: string): boolean` 读面（读 `docRegistry.quotaFrozenDocs.has`——check-collab-test-facade 门禁合规；`collab-gateway-test-facade.ts` 1 方法）。）

- [ ] **Step 4: gate8b 真 refill 用例（v2 重写——128KB 档/同键覆盖/60KB<soft 104,857）**：

```ts
  it('红门⑧-b（v3 新增/v2 重写）：128KB 档真 refill——60KB 帧（<softEnter 104,857 不冻结）两次入桶：第一次 apply、第二次 refill 后过桶再 apply（同键覆盖——doc 尺寸不增长）', async () => {
    const Q = { maxDocBytes: 131_072, maxTxBytes: 16_384, msgRate: 200, bytesRate: 10_000_000 };
    const kit = await startDualClientServer({}, 300, undefined, undefined, Q);
    try {
      const gw = kit.gateway;
      const g = gatewayFacade(gw);
      const mk = () => { const d = new Y.Doc(); d.getMap('m').set('blob', 'x'.repeat(60_000)); return Y.encodeStateAsUpdate(d); };
      const { client, closeInfo } = await openAuthedWs(kit, 'project:gate8b');
      client.send(frame('project:gate8b', 0, 1, mk()));
      const doc = () => gw.server.hocuspocus.documents.get('project:gate8b');
      await pollUntil(() => (doc()?.getMap('m').get('blob') as string | undefined)?.length === 60_000, 10_000);   // 第一次 apply
      const sid = [...doc()!.connections.keys()][0].socketId as string;
      const tokens1 = g.bytesBucketTokens(sid);   // 首扣后 ≈ 192KB-60KB=132KB
      expect(tokens1).toBeLessThan(131_072 + 65_536 - 60_000 + 1);   // 桶已扣（容量=131,072+65,536）
      await sleep(300);   // refill 10MB/s → ≥3MB（capped 桶容量 196,608）——「积满」
      client.send(frame('project:gate8b', 0, 1, mk()));   // 第二帧：同键覆盖（LWW）——refill 后过桶
      await pollUntil(() => g.bytesBucketTokens(sid) < tokens1 + 1_000, 10_000);   // v2：第二次桶消费直接断言（再扣 ~60KB）
      expect(doc()?.getMap('m').get('blob')).toHaveLength(60_000);   // 同键覆盖——doc 尺寸不增长（配额语义自洽）
      expect(closeInfo()).toBeNull();
      client.terminate();
    } finally { await kit.dispose(); }
  }, 30_000);
```

（v3 注释修正：两帧同键覆盖后 doc 编码内容 60KB<soft 104,857——但**增量 truth（onUpdateDelta 累加口径）60+60=120KB>soft → 第二帧后 freezeQuota 发生**；用例断言只涉桶/覆盖/零 close 不涉后续帧 apply，语义如实注记。v2 勘正记录：v1 版 64KB 档三重错误——60KB>soft 第一次即冻结/同键覆盖 length 恒 60,000/120KB>64KB 配额矛盾——全数根除：128KB 档+覆盖语义+tokens 断言。）

- [ ] **Step 5: 验收**——`pnpm --filter @flowweb/api test -- --run src/modules/collab/collab-rate-gate.spec.ts` 全绿（成对用例+红门⑧+gate8b+其余 6 用例）。先红：run 59 两用例红已留档；改造中若 T6 未先落地，成对用例旧 4MB 阈值触发 1011 即本地红证据。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/collab/collab-rate-gate.spec.ts
git commit -m "test(ci): R4a' rate-gate 改造——长度锚（churn 根除）+红门⑧ v3 勘正（桶断言保留+quotaFrozenDocs 确定性等待+第二次 tokens 断言+readOnly 拒写计数）+gate8b 128KB 档真 refill（覆盖语义）+负向断言 echo+ack 双帧计数器"
```

---

### Task 8: R4a'——heavy 串行套件（含主套件 exclude）

**Files:**
- Create: `apps/api/vitest.heavy.config.ts`
- Modify: `apps/api/vitest.config.ts`
- Modify: `apps/api/package.json`（scripts）
- Modify: `scripts/verify-manifest.mjs`（27→28）
- Modify: `scripts/verify-chain.test.mjs`（元测试③基线）

- [ ] **Step 1: 新建 vitest.heavy.config.ts**：

```ts
import path from 'path';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/modules/collab/collab-rate-gate.spec.ts', 'src/modules/collab/collab-idle-anchor.spec.ts', 'src/modules/collab/collab-heartbeat.heavy.spec.ts'],
    fileParallelism: false,   // R4a'：8MB 分配与 90s 实时等待禁并行（B10 根因——同池抢 2 核）
    maxWorkers: 1,
    testTimeout: 180_000,
    exclude: [...configDefaults.exclude, '**/*.int.spec.ts', 'scripts/**'],
  },
  resolve: {
    alias: { '@flowweb/shared': path.resolve(__dirname, '../../packages/shared/src') },
  },
});
```

- [ ] **Step 2: 主套件 exclude（v3 关键——否则双跑假隔离）**——`vitest.config.ts:13`：

```ts
    exclude: [...configDefaults.exclude, '**/*.int.spec.ts', 'scripts/**',
      'src/modules/collab/collab-rate-gate.spec.ts', 'src/modules/collab/collab-idle-anchor.spec.ts',
      'src/modules/collab/collab-heartbeat.heavy.spec.ts'],   // R4a'：heavy 文件移出主套件（vitest.heavy.config 串行跑——v2 增 heartbeat.heavy）
```

- [ ] **Step 3: package.json scripts**（apps/api）：

```json
    "test:heavy": "vitest run -c vitest.heavy.config.ts",
```

- [ ] **Step 4: manifest 插步**——`verify-manifest.mjs` api-test 步后插：

```js
  { id: 'api-test-heavy', cmd: 'pnpm --filter @flowweb/api run test:heavy', db: false },   // R4a'（v3）：heavy 串行套件插步——27→28（有意识动作，元测试③同批）
```

`verify-chain.test.mjs` 元测试③基线常量 27→28 同批（`+api-test-heavy`）。

- [ ] **Step 5: 验收**——`node --test scripts/verify-chain.test.mjs` 绿 + `pnpm verify:fast` 快速链绿（heavy 在 fast 外=FAST_PREFIX_LEN 15 不变）+ `pnpm --filter @flowweb/api test -- --run` 用例数下降（两文件移出）、`pnpm --filter @flowweb/api run test:heavy` 覆盖同两文件。

- [ ] **Step 6: Commit**

```bash
git add apps/api/vitest.heavy.config.ts apps/api/vitest.config.ts apps/api/package.json scripts/verify-manifest.mjs scripts/verify-chain.test.mjs
git commit -m "test(ci): R4a' heavy 串行套件——vitest.heavy.config（fileParallelism:false）+主套件 exclude（防双跑假隔离）+manifest 27→28 插步（元测试③同批）"
```

---

### Task 9: R6'——collab-heartbeat.ts 独立模块（恶化者同批缓解）

**Files:**
- Create: `apps/api/src/modules/collab/collab-heartbeat.ts`
- Create: `apps/api/src/modules/collab/collab-heartbeat.spec.ts`（unit）
- Create: `apps/api/src/modules/collab/collab-heartbeat.heavy.spec.ts`（35s 端到端）
- Modify: `apps/api/src/modules/collab/collab-session-guard.service.ts`（**仅 2 行接线**——v2：心跳不进 1238 的 SG）

- [ ] **Step 1: 先写 unit 测试（模块不存在=红）**——`collab-heartbeat.spec.ts`：

```ts
// R6'（v2）：保活心跳独立模块——B15 恶化者同批缓解（本批 close 抬升延长丢 awareness 窗口）。
// unit：sweep 对登记 conn sendStateless；35s 端到端见 collab-heartbeat.heavy.spec.ts。
import { describe, it, expect, vi } from 'vitest';
import { CollabHeartbeat } from './collab-heartbeat';

describe('R6\' collab-heartbeat（B15——awareness 丢弃与保活解耦）', () => {
  it('sweep：对 Map<socketId,conn> 登记连接 sendStateless({"type":"heartbeat"})——摘除后不再发', () => {
    const hb = new CollabHeartbeat();
    const conn = { sendStateless: vi.fn() } as any;
    hb.register('sid-1', conn);
    hb.sweepOnce();
    expect(conn.sendStateless).toHaveBeenCalledWith(JSON.stringify({ type: 'heartbeat' }));
    hb.unregister('sid-1');   // v2：onDisconnectPayload 无 connection——按 socketId 摘除（SG:260 佐证）
    hb.sweepOnce();
    expect(conn.sendStateless).toHaveBeenCalledTimes(1);
  });

  it('已断连接 sendStateless 抛错：吞+自动摘除（强引用 Set 泄漏根修）', () => {
    const hb = new CollabHeartbeat();
    const conn = { sendStateless: vi.fn(() => { throw new Error('closed'); }) } as any;
    hb.register('sid-2', conn);
    expect(() => hb.sweepOnce()).not.toThrow();
    hb.sweepOnce();
    expect(conn.sendStateless).toHaveBeenCalledTimes(1);   // 第二轮不再发（已摘）
  });
});
```

跑：`pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab-heartbeat.spec.ts` → FAIL（模块不存在）。

- [ ] **Step 2: 实现 collab-heartbeat.ts**

```ts
// apps/api/src/modules/collab/collab-heartbeat.ts
// R6'（v2）：保活心跳独立模块——backlog>1MB 丢 awareness 期，客户端 messageReconnectTimeout=30s
// 死线靠任意入站帧刷新（provider 内建）——10s stateless 心跳解耦（stateless 不走 awareness drop
// 分支+小帧免前瞻 close〔T6 帧型三档〕+预算失败静默丢——三重不反杀保证）。
// v2：Map<socketId, conn>（onDisconnectPayload 无 connection——SG:260 注释佐证）；throw=已断自动摘除。
import type { CollabConnection } from './collab.gateway';

const HEARTBEAT_INTERVAL_MS = 10_000;

export class CollabHeartbeat {
  private readonly conns = new Map<string, CollabConnection>();
  private timer: ReturnType<typeof setInterval> | null = null;

  register(socketId: string, conn: CollabConnection): void { this.conns.set(socketId, conn); }
  unregister(socketId: string): void { this.conns.delete(socketId); }

  start(): void {
    this.timer ??= setInterval(() => this.sweepOnce(), HEARTBEAT_INTERVAL_MS);
    this.timer.unref?.();   // 不养事件循环
  }

  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  sweepOnce(): void {
    for (const [sid, conn] of this.conns) {
      try { conn.sendStateless?.(JSON.stringify({ type: 'heartbeat' })); } catch { this.conns.delete(sid); }   // 已断：吞+摘除（强引用防漏）
    }
  }
}
```

- [ ] **Step 3: SG 接线（v3：register 用 connectedPayload.socketId——conn.socketId 可选不可靠）**——`collab-session-guard.service.ts`：
  1. 字段：`private readonly heartbeat = new CollabHeartbeat();`（import 1 行）
  2. 构造器（authMapsSweepTimer 启动邻位）：`this.heartbeat.start();`
  3. `onApplicationShutdown`（:1231-1236 随停族）：`this.heartbeat.stop();`
  4. `connected` 钩子既有登记段（:604-608 区域，**payload.socketId 非空——connectedPayload 有 socketId 键族**）：`this.heartbeat.register(socketId, connection);`
  5. `onDisconnect` 既有清理段（按 socketId 反查族——onDisconnectPayload 有 socketId）：`this.heartbeat.unregister(socketId);`（两处键严格同源）

- [ ] **Step 4: 心跳链路通用例（v3 替代 35s pause 用例——后者逻辑不可构造已删）**

**v3 裁决记录**：v2 的 35s pause 端到端用例**删除**——pause 停读挡住心跳本身（30s 零 message=4408 必然，与心跳有无无关）+FIFO 约束（心跳与 8MB 回显同队列，大帧排空 >30s 时心跳永远排在后面——8MB/慢链路场景心跳救不了，这是传输层结构性约束非实现缺陷）。R6 心跳的**有效域**=大帧排空 <30s 的链路+awareness 丢弃窗——边界诚实登记进 spec（真根修=客户端字节流级判活/2MB doc，归客户端批·Y1c-3 登记）。fake transport 形态不采（绕过 ws 队列=测应用层逻辑非真实传输）。

`collab-heartbeat.heavy.spec.ts` 改为**链路通证明**（非 35s 死线证明）：

```ts
// R6'（v3）：心跳链路端到端——服务端 10s sweep 的 heartbeat stateless 帧到达客户端（provider 收到
// message=lastMessageReceived 刷新的链路证明）。35s 死线形态不可构造（FIFO——见 plan v3 裁决记录），
// 有效域边界归 spec 登记。heavy：10-15s 实时等待。
import { describe, it, expect } from 'vitest';
import { startDualClientServer } from '../../test-utils/dual-client-server';

describe('R6\' 心跳链路（服务端 sweep → 客户端收到 heartbeat stateless）', () => {
  it('空闲连接 15s 内收到 ≥1 条 heartbeat 帧（provider stateless 流可观测——链路通）', async () => {
    const kit = await startDualClientServer({}, 300);
    try {
      const A = kit.connect('project:hb');
      await A.synced;
      const received: string[] = [];
      A.provider.on('stateless', ({ payload }: { payload: string }) => { received.push(payload); });
      await new Promise((r) => setTimeout(r, 15_000));   // >1 心跳周期（10s）+裕量
      const heartbeats = received.filter((p) => { try { return JSON.parse(p).type === 'heartbeat'; } catch { return false; } });
      expect(heartbeats.length).toBeGreaterThanOrEqual(1);   // 链路通：服务端发出→客户端收到
      A.destroy();
    } finally { await kit.dispose(); }
  }, 30_000);
});
```

- [ ] **Step 5: 验收**——unit spec 绿（注册/摘除/throw 自摘）+ heavy 链路用例绿（`pnpm --filter @flowweb/api run test:heavy`）+ `node scripts/check-collab-module-size.mjs`（SG 净变化：T6 −17 + T9 +6 ≈ 净 −11 ≤1238 ✓）。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/collab/collab-heartbeat.ts apps/api/src/modules/collab/collab-heartbeat.spec.ts apps/api/src/modules/collab/collab-heartbeat.heavy.spec.ts apps/api/src/modules/collab/collab-session-guard.service.ts
git commit -m "feat(ci): R6' collab-heartbeat 独立模块——10s stateless 心跳（B15 缓解——有效域=大帧排空<30s 链路，FIFO 边界登记 spec）+Map<socketId> payload 键+throw 自摘+SG 仅 6 行接线+链路通端到端用例"
```

---

### Task 10: 门禁三件+批出口

**Files:**
- Modify: `scripts/check-collab-module-size.mjs`（SIZE_LIMITS+两新文件）
- Modify: `scripts/check-collab-module-size.test.mjs`（锚表断言同批）
- Modify: `scripts/check-ecosystem.mjs`（算式+OUTBOUND_BUDGET 项——**自 collab-limits.ts 提取字面量**）
- Modify: spec 总目录回填+spec 勘正确认

- [ ] **Step 1: module-size 锚表（v3：三新文件全入锚——heartbeat 漏锚=半套）**——SIZE_LIMITS 追加三行（**按 T5/T6/T9 完成实测填**——预估 limits ~45→60 / budget ~130→160 / heartbeat ~50→60，终值=实测+1.3 余量）：

```js
  'apps/api/src/modules/collab/collab-limits.ts': 60,   // R4b' 新文件入锚（实测紧值）
  'apps/api/src/modules/collab/collab-outbound-budget.ts': 160,   // R4b' 同上（四档帧型+记账台账）
  'apps/api/src/modules/collab/collab-heartbeat.ts': 60,   // R6' 同上（v3 补——三新文件统一入锚）
```

`check-collab-module-size.test.mjs` 自测「锚表恰 N 文件」断言同批改（四→七文件+终值断言按实测填）。

- [ ] **Step 2: 四+三文件锚全核验**——`wc -l` 实测：gateway ≤934（T6 保持一行再导出）/ **SG ≤1238**（T6 −17+T9 +6=净 −11）/ **DR ≤1082（零改动=不触）** / persistence ≤950（不触）/ 三新文件 ≤新锚。**超限处置：回改实现（迁行到新模块），禁压注释禁改锚**。核算表落 commit message 与 spec 偏离表。

- [ ] **Step 3: check-ecosystem 算式（v2：提取源=collab-limits.ts 字面量+isFinite fail-closed+算式 650,505,088B）**：

```js
  const outboundBudget = Number(/OUTBOUND_BUDGET_BYTES\s*=\s*([\d_]+)/.exec(
    readFileSync(resolve(ROOT, 'apps/api/src/modules/collab/collab-limits.ts'), 'utf8'))?.[1]?.replace(/_/g, ''));
  Number.isFinite(outboundBudget) || fail('outbound_budget 提取失败（collab-limits.ts OUTBOUND_BUDGET_BYTES——Z142③ fail-closed，禁"提取不到就算过"；字面量形态=T5 已钉死 100_663_296）');
```

`:149` 算式改：

```js
          residentCap + maxDocBytes + outboundBudget + RSS_BASELINE_BYTES <= trip.api || fail(`Z126③ 算术[api]：resident_cap(${residentCap})+maxDocBytes(${maxDocBytes})+outbound_budget(${outboundBudget})+基线(${RSS_BASELINE_BYTES}) ≤ TRIP[api](${trip.api}) 不成立（B18 口径：650,505,088B ≤ 786,432,000B，余 ~129.4MiB）`);
```

（自测 `check-ecosystem.test.mjs` 算式 fixture 同批。）

- [ ] **Step 4: 全链本地出口**：

```bash
pnpm verify
pnpm verify
```

Expected: `verify-chain: PASS（28 步，tier=full）` ×2 轮（含 module-size 六文件锚+ecosystem 新算式+heavy 步+SG/DR 锚）。

- [ ] **Step 5: push 批终验**：

```bash
git push origin master
```

Expected: CI run 四 job（test/doc-gate/gitleaks/collab-core）全绿——**#40 以来首次**；collab-core 墙钟 <15min；CI 日志 rate-gate 1011 消失。CI 绿后观察 ci-notify（成功 run 无动作——workflow_run 触发链验证）。

- [ ] **Step 6: 文档回填**——spec 偏离表执行期条目终态回填（manifest 28 步/锚表七文件/concurrency 取舍/96MB 折衷值/DR 闸式值恒等/census ⑤ getBacklog 零改/R6 有效域边界）+总目录批次表加行。

- [ ] **Step 7: Commit（文档）**

```bash
git add scripts/check-collab-module-size.mjs scripts/check-collab-module-size.test.mjs scripts/check-ecosystem.mjs docs/superpowers/specs/2026-10-18-ci-double-fault-repair-design.md
git commit -m "chore(ci): T10 门禁三件——module-size 锚表六文件（实测紧值）+ecosystem 算式 outbound_budget 项（collab-limits 提取+fail-closed；B18 口径 650,505,088B）+四文件锚全核验+文档回填"
```

---

## 自查记录（writing-plans Self-Review，v3）

1. **Spec 覆盖**：R1'→T1；R2'→T2/T3；R3'→T4（ci-notify 独立+三态 conclusion）；R4a'→T7/T8；R4b'→T5/T6（OutboundBudget 四档+getBacklog）；R5'→commit 注记+spec 偏离表；R6'→T9（独立模块+链路通用例+有效域登记 spec）；门禁三件→T10（七文件锚）；B12 红线→T1 Step 6。无缺口。
2. **占位符扫描**：v1 broken 用例已删；v2 的「合并行探索性文字」已收敛为明确方案（limits 常量不经 gateway 再导出）。无 TBD。
3. **类型一致性**：`deriveCollabLimits(q: Pick<…>, budget?)`；`OutboundBudget.wrap(ws, hardCloseWs, getBacklog)`（三参——T6 Step 1/Step 2 一致）；`CollabHeartbeat.register(socketId, conn)` payload 键；`Ws.send` 双参+`once?` 可选（budget/gateway :76/stub 三处一致）。
4. **三轮外审吸收核验**：R1 轮（env 校验删/OutboundBudget 类/心跳独立/notify 独立/watchdog ref/Pick/字面量）→ R2 轮（SyncReply 四档+控制组预算豁免/release 禁复活+reconcile 回填/getBacklog 闭包三处零改/934 一行/35s 删+链路用例/payload socketId/slow0 前置/timed_out·cancelled/stub close 触发/死代码删/authMapsSweeper 挂点/去双计/三文件锚/façade quotaFrozen/fallback 去 unref/gate8b 注释）——16 项全落地。驳回维持：B14（登记下一批首位）/2MB·N_max/collab-core job 30/fake transport 形态。
5. **风险项**：T6 wrap 迁移+四档帧型——census ⑤ 零改核验/934/SG 净 −11 三门禁内嵌；T9 链路用例的 provider stateless 流观测（canvasCollabRuntime.quota.spec :185-189 先例=stateless handler 存在性已证）。

