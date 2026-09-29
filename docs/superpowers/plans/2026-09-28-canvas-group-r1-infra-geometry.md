# Canvas 组升级 Spec A — R1 基建+单源 / 几何与快照根修 实施计划（v6）

> **全局纪律三（v6 新增——几何派生公式同源）：** 子节点 rect 派生公式全 plan **一字不差同源**：`width ?? DEFAULT_CHILD_SIZE.width / height ?? DEFAULT_CHILD_SIZE.height`——**不含 measured**（measured 是渲染期 ResizeObserver 量：帧变渲染时序函数 → 跨客户端漂移；现状 refitGroupBounds:1293 刻意不用正是回避此）。measured **唯一保留域=拖拽期 clamp**（Task 14——width 暂缺时不能钉死子节点）。v5 的四处不同源（normalizeLoadedCanvas 无 measured/applyGroupFrame 有/assertInvariant 无/addToGroup 有）会使 store 级不变量断言对正确实现恒红（夹具恒红第四形态，公式层）。

> **全局纪律一（v4——几何期望值同型错误 v1/v2/v3 连犯三次后的根治）：** 测试断言中的几何期望值**只许来自纯函数调用或常量组合，禁止手算数字**——写 `expect(g.width).toBe(calcGroupBounds(childrenAbs).width)` 而非 `toBe(145)`；唯一例外是 COLLAPSED_SIZE 等常量本身。手算数字是本 plan 最贵的失误模式（v2 单侧/双侧 padding 搞反、v3 把子 rel 偏移多算进宽高——两次都是"夹具恒红诱导实现者改实现凑数"）。
>
> **全局纪律二（v5 新增——夹具恒红的第四种形态）：** 每个用例只声明它检验的**那一条**不变量（守恒 / clamp 生效 / 不 refit），不得在同一用例内同时断言"不变"与"被修正"——v4 的"不 refit 组"夹具把落点放 padding 区外触发 clamp、又断言落点=放置点，两条互斥必红。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** R1a 解 F36（shared 真构建 + dist 新鲜度保障 + deploy.sh 补全 + GROUP_NODE_DATA_KEYS 值导入切换 + 节点信封单源 nodeEnvelope——含 edges 形状收敛）；R1b 几何与数据真值根修（**localStorage 投影快照层删除、兜底职责归服务端 doc 持久化（方案 C 拍板：R1 不加客户端 IDB，IDB 立项独立分片 R1c）** + W7/W8 删 + AppNode 删几何字段 + 组几何唯一写者收口 + F42 触发面根修（pickStructNodes 组 data 纳入 + 删 syncGroupDataToNodeStore 镜像 + patchGroupData 唯一通道）+ validateParentGraph）。

**Architecture:** 两分片串行。R1a 基建先行，**alias 钉 src 先于 main 切 dist**（消除 node_modules symlink 切 dist 的断裂窗口——v3 顺序反转）；构建产物可被 API commonjs require，信封键表/归一化收敛 shared 纯数据模块。R1b 以 **doc 为唯一持久化路径**——服务端已有完整 doc 持久化（collab.gateway.ts:98-140：Postgres 快照+增量重放+32 条 compaction+断连强制 flush+Redis 对等同步，debounce 5s/10s），**F35 的根因是 fillDoc seed（clientID 决胜），删 seed 即结构性消失，不需要客户端 IDB**；正常刷新零丢失（onDisconnect flush 兜底），5s debounce 窗口内崩溃丢最近编辑（多数协作工具同款行为，接受并登记）；F42 根修按"触发面唯一（桥判脏含组 data）+ 所有权单一（组 data 只写 cs、镜像删除）+ 通道唯一（patchGroupData）"推进，几何收口按"投影先行→读者迁移→删镜像→删字段→唯一写者（守恒+epsilon）"推进；normalizeLoadedCanvas 与 refitGroupGeometry **同一部法律**（守恒式、原点归位——组框是派生量，不存在"服务端越权"）。

> **2026-09-29 证伪与修复**：上表"onDisconnect flush 兜底"在删除场景失效——flush 汇入的 storeDocument 被
> SV 判等挡住（删除不推进 clock），断连后 `!lastSV` 静默跳过是刷新复活的必现路径。判据 2 判 FAIL，
> 已按 `docs/superpowers/specs/collab-delete-persist-fix.md`（变更驱动落库）修复。兜底成立的前提是
> "每次语义变更都进 pending 队列 + 断连 flush 无条件执行且吞错有 unflushed 兜底"。

**Tech Stack:** TypeScript tsc 项目构建（CJS）、NestJS、Vite alias、Yjs、Zustand、React Flow（useInternalNode）、Vitest、pnpm workspace + turbo。

**上游 spec:** `docs/superpowers/specs/2026-09-28-canvas-group-ui-upgrade-design.md`（v10——**Task 9 先修 spec 至 v11**：契约 5 快照段改道 + §4.8 clamp 推翻 + F39 校验时机前移 + F42 登记 + R1c 立项，均用户拍板）。

**v3 修订说明（三份外部评审核实 + 方案 C 拍板后重写）：** ① **Task 10 IDB 摘除**（三评审一致 + 拍板 C）：服务端 doc 持久化全景实证（collab.gateway.ts:98-140），F35=删 seed 即消失；IDB 拆独立 R1c（含硬化清单立项）；② **alias/main 顺序反转**（v2 ":179 web tsc 仍走 src" 推导错误——main 切 dist 后 node_modules symlink 立即走 dist，Task 1/2 间有断裂窗口）；③ **null 语义分家**（v2 "normalizeNodeRecord 与 normalizeCanvasRecord 逐字同义"证伪——API 版是 spread+??undefined 键保留，shared 版是显式构造真删键；且 RawNode.width?:number 与 CanvasNodeRecord.width?:number|null 在 strict 下不兼容）：**读侧出口（readCanvasFromDoc/readDocCanvas）保持 `?? null` 对外形状不变（F32/R0b 契约），normalizeCanvasRecord 真删键只用于写侧（fillDoc 入口/applyRecordToYMap/投影）**；API snapshot-filter 的 normalizeNodeRecord 保留不收敛（JSON 序列化边界语义，现有 spec 锁形状）；④ **Task 14（v2）自相矛盾修正**：calcGroupBounds 实测为 bbox+双侧 padding（上 50/余 20）——v2 测试断言（单侧 padding 125/85）与实现（140/130）必红；且丢 collapsed/manuallyResized+savedSize 守卫是功能回归（useCanvasPersistence.ts:60-77 现状有）——normalizeLoadedCanvas 重写为**复用 refitGroupGeometry 守恒式**（原点归位+rel 随动+子绝对坐标不变+幂等）+ 三条 scope 守卫；⑤ **F42 根修升级**：pickStructNodes 不含 data（canvasHistory.ts:9-18 实证）→ 纯 data 变更（如 showIndex 不影响尺寸）即使投影分型后桥也不触发——必须收**触发面**（pickStructNodes 纳入组 data）而非补调用点；deleteNode 键盘路径（onNodesChange removes）连 cells 清理都跳过（第 7 写者）一并修；⑥ **syncGroupDataToNodeStore 镜像删除**（grep 实证 web 侧 18 处 `useNodeStore(s=>s.nodes[...])` 全为业务节点组件，无组渲染读者）——组 data 所有权=cs 单一所有者；⑦ **信封收敛扩面**：writeNodeData/insertNode（collab-document.service:82-100）、backfill-team.ts、gate-seed.ts 一并接共享入口；**edges 形状一次收成 source/target 单形状**（readDocCanvas 现出 sourceId/targetId，canvas.service.ts:91-95 用 `e.sourceId || e.source || ''` 打补丁——无存量数据，成本最低时机）；writeNodeToYMap 落 node-doc.util.ts（util 层，非 Nest service）；⑧ **几何加固**：跨组守卫（addToGroup/dropIntoGroup 对 node.parentId != null 现状把相对坐标当绝对坐标用——双重偏移垃圾）、applyGroupFrame epsilon no-op 守卫（RF 拖拽坐标是小数，1ULP 抖动→桥深比较判脏→乒乓）、placement 期对不 refit 组（manuallyResized/collapsed）保留 clampPositionToPadding（clamp 推翻只在 shouldAutoRefit 域成立——N5 搬家问题）、clamp 守卫扩为 xMax≥padding；⑨ **A2 服务端常量双份收口**：stitch.size.ts 与 groupLayout.ts:10-15 逐字相同、storyboard.constants 与 web 重复——随几何下沉一并并入 shared；⑩ **verify 重写**（turbo run typecheck 硬报错 Missing tasks——turbo.json 无该 task、web 无 typecheck 脚本、api 无 eslint 依赖无配置）：显式序列，不含 api lint（登记"api lint 现况不可用，不在 R1 范围"）；⑪ check-shared-dist.mjs **fileURLToPath 修复**（`new URL().pathname` 在 win32 得 `/D:/flowweb/`——statSync 必 ENOENT 恒红，v1/v2 同犯）+ walk 排除 *.test.ts + 只挂 prebuild/predev（pretest 与 vitest alias 冗余且对测试文件 touch 假红）；⑫ Task 13（v2）半径修正：**15 处生产 ns.addNode 实参 + ~45 处测试夹具**（v2 写"5 处"低估 3 倍）；⑬ 测试缝显式化：canvasCollabRuntime 的 doc 是模块私有（:32）——导出 `getDoc()` 只读访问器；TextInputNode mock 改 vi.hoisted+vi.fn（先例 ImageNodeToolbar.test.tsx:4-27）；⑭ viewport 链路修正：onMoveEnd 全仓不存在，实际链路 onViewportChange={updateViewport}（CanvasView.tsx:495）→ cs.viewport 每帧写；另存 key 用 `flowweb_vp_` 前缀（避开 OLD_KEY_PATTERNS `/^flowweb_canvas_(?!v2_)/`——虽然 sweep 随快照层同 commit 删除，防御性独立前缀）；⑮ Task 8（spec 清剿）范围扩：F34/F35/§4.7 收敛清单(:260)/**§4.7"校验=remapIds 之后"句（Task 21 前移是对 spec 的推翻，v2 漏登记）**/§3 收益(:122)/§5 表格行/验收行；⑯ ydocBuilder.test.ts 已存在（66 行 4 用例）——Task 7 是 Modify 追加非 Create；⑰ page.test.tsx 两符号：:18 mock refitExpandedGroups、:72 refitGroupBounds stub（v2 事实表混为一谈）；refitGroupBounds 生产调用点 **4 处**（convertGroup:1228/toggleCollapse:1279/refitExpandedGroups:313/useCanvasPersistence:75）；⑱ e2e/audit/canvas-migration-registry.json 需重跑生成器（列着将被删的 spec）。

**执行前置：** 沙箱须 workspace-write 且 git 可 commit；本地 Git Bash 执行（命令均为 bash 语法——Windows 下 pwsh 不兼容 `rm -rf`/`PORT=3100 node`）；dev server 可用（Task 22 浏览器验收）。

**关键既有事实（2026-09-28 三轮评审核实修正；行号漂移以符号+grep 为准）：**

| 事实 | 位置（已验） |
|---|---|
| **服务端 doc 持久化全景（v3 新证，Task 12 改道依据）**：onLoadDocument=快照+seq 增量重放+Redis 对等同步；onStoreDocument=SV diff append+count≥32 compaction；onDisconnect=最后连接断开强制 flush-then-compact；debounce 5000/maxDebounce 10000 | `collab.gateway.ts:48-51/:98-140`、`canvas-doc-update.repository.ts`、schema.prisma CanvasDoc/CanvasDocUpdate |
| shared `main`/`types` 均 `./src/index.ts`；`build: tsc --noEmit` 不产出；tsconfig include:["src"] 无 exclude——dist 实测含 `types/role.types.test.js` 等测试产物 | `packages/shared/package.json:5-8`、`packages/shared/tsconfig.json` |
| tsconfig.base 是 `module: ESNext / moduleResolution: bundler`；api 是 `commonjs/node`；web `build: "tsc -b && vite build"` + tsconfig 有 rootDir——paths 指 shared src 触发 TS6059（实测 14 条）；web dist 混杂 tsc 产物（App.test.js 等） | `tsconfig.base.json:4-5`、`apps/web/package.json:11`、`apps/web/tsconfig.json:5-6` |
| **node_modules/@flowweb/shared 是 symlink → package.json main/types 即解析目标（v3 修正）**：main 切 dist 后 web tsc/vitest/vite 立即走 dist——alias 钉 src 必须先行 | pnpm workspace 语义 |
| turbo `dev` 无 dependsOn；**turbo.json 无 typecheck task（`turbo run typecheck` 硬报错）**；web 无 typecheck 脚本；api lint=`eslint "{src,test}/**/*.ts"` 但**无 eslint 依赖无配置文件**（ls 确认不存在） | `turbo.json`、`apps/api/package.json:10`、`apps/web/package.json:9-14` |
| vite alias 仅 `'@'`；api/web 均声明 `@flowweb/shared: workspace:*`；apps/api/vitest.config.ts 无 alias | `apps/web/vite.config.ts:11-13` |
| API 生产源码禁值导入双禁令注释；4 处 `import type`；**spec 值导入 3 处**（snapshot-filter.util.spec.ts:5 静态/:265 动态、storyboard.pipe.spec.ts:5 STITCH_JOB_KEYS） | `admin.guard.ts:3-5`、`video-project.service.ts:20` |
| deploy_full：tar 上传（packages/ 含、`--exclude='dist'`）→ pnpm install → prisma generate → nest build（无 shared 构建）→ vite build → pm2 restart；deploy_api 只传 apps/api/src；shared tsconfig extends 链需仓根 tsconfig.base.json | `deploy.sh:16-66` |
| **normalizeNodeRecord（snapshot-filter.util.ts:57-66）实为 `{...n, parentId ?? undefined}` 键保留语义**——与真删键的 Object.keys 形态不同；RawNode.width?:number 与 CanvasNodeRecord 宽 `number|null` strict 不兼容；生产消费点 canvas.service.ts:89 直进 templateData | 同左 |
| **pickStructNodes 不含 data（canvasHistory.ts:9-18）**：cs 侧组 data 变更不触发协作桥——唯一通道是 syncGroupDataToNodeStore 写 ns 的订阅副作用；**showIndex 等不影响尺寸的纯 data 变更即使投影分型后桥也不触发（F42 必须收触发面的实证）** | `canvasHistory.ts:9-18`、`canvasCollabRuntime.ts:216-228` |
| **组 data 无 nodeStore 读者（grep 实证 18 处 useNodeStore(s=>s.nodes[...]) 全为业务节点组件）**——syncGroupDataToNodeStore 镜像可删；其注释"localStorage 快照数据源是 nodeStore"随快照层删除过时 | 全仓 grep |
| **stitch.size.ts 与 groupLayout.ts:10-15 逐字相同（STITCH_WIDTH_MAP/RATIO_MAP 双份）**；storyboard.constants.ts VALID_ASPECT_RATIOS 与 web types/group.ts:3 重复 | `apps/api/src/modules/storyboard/stitch.size.ts`、`stitch.consumer.ts:37-39` |
| 信封写者全景（**≥13 处**）：web ydocBuilder.fillDoc/readCanvasFromDoc、API collab-document readDocCanvas/writeNodeData(:82-93)/insertNode(:96-100)、API project.service fillDoc、storeProjection(:59-74)、syncStoreToDoc 增量段(:96-110 含 position 子 Map)、useCanvasPersistence 快照、**backfill-team.ts:6-37、gate-seed.ts:20-40**；**edges 双键名**：API 出 sourceId/targetId、web 出 source/target，canvas.service.ts:91-95 `e.sourceId \|\| e.source \|\| ''` 打补丁 | 同左 |
| **组 data 落盘缺口（F42 现状 bug，P0）**：6 写者只写 cs（updateStoryboardConfig:1304/resizeStoryboardGrid:1315/clearStoryboard:1352/addImageToStoryboardCell:1368/removeStoryboardCell:1388/dropImageIntoStoryboard:962）；**且任何 applyDocToStore（远端变更/撤销/10s 超时首刷）会用 doc 旧 data 整表覆写 cs——不等刷新就当场回滚、撤销不回**；**第 7 写者=onNodesChange removes 键盘删除路径连 cells 清理都跳过**（deleteNode:239-246 有清理，两路径不对齐；repairStoryboardCells 只处理"子不在 cells"反方向不清死 id） | `canvasStore.ts`、`groupDerive.ts:26-41` |
| canvasSnapshot：SNAPSHOT_VERSION=2、key 字面 `flowweb_canvas_v2_`、nodes: Record + parentMap?、isValidPayload :36 拒数组；**测试 4 套**（hooks/ 与 hooks/__tests__/ 各一对）；useCanvasPersistence 恢复守卫：collapsed 跳过/manuallyResized 优先 savedSize 兜底宽高/其余 refit（:60-77） | `canvasSnapshot.ts`、`useCanvasPersistence.ts:60-77` |
| AppNode 无 parentId、有 position/width/height（R1b 删）；**ns.addNode 生产调用 15 处**（:211/:294/:346/:403/:460/:839/:1044/:1047/:1165/:1169/:1384/:1508/:1515/:1593/:1600）+ 测试夹具约 45 处 + nodeStore.test.ts:1327/:1366 真类型红 | `canvasStore.ts`、`nodeStore.test.ts` |
| initCollab：`doc = new Y.Doc()` → **fillDoc(本地快照) → provider 建连**（seed 与服务端 merge 同键按 clientID 决胜——F35 根因，删除）；applyDocToStore 触发点仅 synced/10s 超时/observeDeep 50ms 防抖 | `canvasCollabRuntime.ts:234-244/:260-285` |
| onNodesChange：cascade :520、拖拽 clamp 块 :529-547（`parent.width ?? measured ?? 0`——组宽 null 时 xMax 负夹飞）、W7 dimensions→nodeStore（:549-562）、W8 TD-Pos→nodeStore（:563-578） | `canvasStore.ts:517-591` |
| 组几何写点（增删路径全覆盖——v3 补 G1）：groupNodes:811、ungroup:843、addToGroup:882（**无"已在组"守卫；node.parentId 指向他组时把相对坐标当绝对坐标用——跨组双重偏移**）、removeNodeFromGroup:916、dropIntoGroup:928、mergeStoryboard:1101、convertGroup:1178、renameGroup:1237、markManuallyResized:1245、toggleCollapse:1253（**折叠 200×64 内联**——NormalGroupRenderer.tsx:44 另一份，COLLAPSED_SIZE 常量不存在）、refitGroupBounds:1286（**生产调用 4 处**：convertGroup:1228/toggleCollapse:1279/refitExpandedGroups:313/useCanvasPersistence:75）、updateStoryboardConfig:1304、resizeStoryboardGrid:1315（溢出移出用旧 gw）、buildGroupCopy:1439、rebuildFromClipboard:1531；**deleteNode/onNodesChange removes 删子后不重算组框** | `canvasStore.ts` |
| F33 现场：addToGroup/dropIntoGroup 子 rel 用旧 gp 算、组框改新 bounds → 既有成员平移 δ——仅新成员落点在既有 bbox 左上方向时显形（右下方向 frame 原点不动，夹具恒绿——v3 夹具左上）；**守恒后浮点**：RF 拖拽坐标是小数，rel+frame.origin 还原不保证位位相等 | `canvasStore.ts:893-908/:939-954` |
| F38 现场：ungroup storyboard 分支与 convertGroup→normal 强制 `width: CELL_WIDTH` 覆盖 | `canvasStore.ts:856-863/:1214-1226` |
| calcGroupBounds 实测语义：minX=min(x)−20、minY=min(y)−50、width=max(x+w)+20−minX——**bbox+双侧非对称 padding**（v2 的 normalizeLoadedCanvas"单侧 padding"公式与之矛盾，v3 重写守恒式） | `groupLayout.ts:53-58` |
| 几何读点：TextInputNode :26-30（nodeStore ?? 300）；ImageGenNode 4 处 fallback；先例 CanvasReferenceSelectBanner :28-33 | 同左 |
| clone remapIds 红线（悬空可达不抛、`?? null`、禁 `\|\| c` 兜底）；web 侧 buildGroupCopy:1470/rebuildFromClipboard:1555 的 cells 重映射用 `idMap.get(id) \|\| id`——与红线正面冲突，一并修 | `video-work-clone.service.ts:50-78`、`canvasStore.ts:1470/:1555` |
| 测试锚点：canvasStore.test.ts :415-425（TD-Pos）；**page.test.tsx :18 mock 的是 refitExpandedGroups、:72 才是 refitGroupBounds stub（两符号两处）**；__tests__ 快照 4 套（useCanvasPersistence 两套共享模块级 flag 与 Storage spy+顺序契约；canvasSnapshot 两套无共享）；TextInputNode.test.tsx :44-48（mock 是普通箭头函数**非 vi.fn**——null 分支注入须改 vi.hoisted，先例 ImageNodeToolbar.test.tsx:4-27/:279）；page.tsx 的 loadSnapshot/isEmptySnapshot/hydrateNodes/refitExpandedGroups 死导入；**apps/web/e2e/audit/canvas-migration-registry.json :216-217 列着将被删的 spec（需重跑生成器）**；**canvasCollabRuntime 的 doc 模块私有（:32）——读 doc 断言需先建 getDoc() 测试缝** | 同左 |
| **viewport 链路（v3 修正）**：onMoveEnd 全仓不存在；实际 onViewportChange={updateViewport}（CanvasView.tsx:495）→ cs.viewport 每帧写；恢复点 defaultViewport={viewport}（:494，挂载时读一次） | `CanvasView.tsx:494-495`、`canvasStore.ts:516` |

**commit 纪律：** 每 task 小 commit；R1a/R1b 各自成可独立验收改动。TS strict 全程生效。**每条红相用例必须先在现状代码上跑一遍并记录实际结果，否则不许写 "Expected: FAIL"（B1 教训：夹具恒绿会让实现者怀疑自己）。**

**测试命令速查（全部 Git Bash）：**
- shared 构建/测试：`pnpm --filter @flowweb/shared exec tsc -p tsconfig.build.json` / `pnpm --filter @flowweb/shared test -- --run`
- require 冒烟：`node -e "..."`（仓库根）
- web 单测：`pnpm --filter @flowweb/web test -- --run <路径>`
- API 单测：`pnpm --filter @flowweb/api test -- --run <路径>`
- 双端类型：`pnpm --filter @flowweb/web exec tsc --noEmit` 等
- 干净三步构建：shared tsc → nest build → vite build
- 一键验收（Task 3 落地后）：`pnpm verify`（根）

---

## 文件结构总览（v3）

**R1a 新建：**
- `packages/shared/tsconfig.build.json` — CJS 覆写 + exclude 测试
- `packages/shared/src/canvas/nodeEnvelope.ts` + `.test.ts`
- `scripts/check-shared-dist.mjs` — dist 新鲜度门禁（fileURLToPath 版）
- `apps/web/src/utils/envelope-serialization-guard.test.ts`

**R1a 修改：**
- `apps/web/vite.config.ts` / `apps/web/tsconfig.json` / `apps/web/package.json` — alias + paths + rootDir 清理 + build 改（**Task 1 先行，main 仍指 src 时幂等安全**）
- `apps/api/vitest.config.ts` — alias 钉 shared src（Task 1 同批）
- `packages/shared/package.json` — main/types 指 dist + type:commonjs（Task 2 切换）
- `apps/api/package.json` — dev/build/test 脚本首段内联门禁（v6：不加 pre* 钩子——内联是承重件，.npmrc 只是兼容垫）
- 根 `package.json` — verify 显式序列
- `deploy.sh`、`turbo.json`（dev 加 ^build）
- `snapshot-filter.util.ts`（值导入+RawEdge 形状）、`admin.guard.ts`/`video-project.service.ts`（注释）
- `ydocBuilder.ts`（+applyRecordToYMap+出口形状钉死）、`collab-document.service.ts`（writeNodeData/insertNode 接共享入口+readDocCanvas edges 改 source/target）、`project.service.ts`、`node-doc.util.ts`（**writeNodeToYMap 落此**）、`canvasStore.ts`（syncStoreToDoc 信封段）、`backfill-team.ts`、`gate-seed.ts`

**R1b 新建：**
- `packages/shared/src/canvas/geometry.ts` + `.test.ts`（groupLayout 整模块下沉 + DEFAULT_CHILD_SIZE + COLLAPSED_SIZE + refitGroupGeometry + shouldAutoRefit）
- `packages/shared/src/canvas/normalizeLoadedCanvas.ts` + `.test.ts`
- `packages/shared/src/canvas/validateParentGraph.ts` + `.test.ts`
- `apps/web/src/utils/projectCanvasNodes.ts` + `.test.ts`
- `apps/web/src/utils/groupGeometry.ts` + `.test.ts`（placeGrid——F38）
- `apps/web/src/utils/viewportPersistence.ts` + `.test.ts`

**R1b 修改：**
- spec v10→v11（Task 9：契约 5 改道 + clamp 清剿 + F39 时机 + F42 + R1c 立项）
- `canvasCollabRuntime.ts`（+getDoc 缝、删 seed、storeProjection→projectCanvasNodes、applyDocToStore→toAppNode+normalizeLoadedCanvas）
- **删除**：canvasSnapshot.ts+2 测试、useCanvasPersistence.ts+2 测试（快照层整体退役）
- `canvasHistory.ts`（pickStructNodes 纳入组 data——F42 触发面）
- `nodeStore.ts`（toAppNode+AppNode 删字段+写侧 15 处）、`nodeOrder.ts`（删形参）、`groupLayout.ts`（纯 re-export）、`types/group.ts`（StoryboardConfig re-export+F30）、`storyboardConfig.ts`（re-export）
- `canvasStore.ts`（删 W7/W8、删 syncGroupDataToNodeStore、applyGroupFrame/applyGroupFrameRect、patchGroupData、F33/F38、跨组守卫、epsilon、六写者+cells 修复）
- `TextInputNode.tsx`、`ImageGenNode.tsx`、`NormalGroupRenderer.tsx`（COLLAPSED_SIZE 接线）
- API：`stitch.size.ts`（删，并入 shared）、`stitch.consumer.ts`、`storyboard.constants.ts`（派生）、`video-work-clone.service.ts`（环检测+normalizeLoadedCanvas）、`template.service.ts`（validateParentGraph）
- 测试迁移：canvasStore.test/page.test/TextInputNode.test/canvasStore.groups.test 等 + registry.json 重跑

---

# R1a 基建 + 单源

## Task 1: 双端 alias 钉 src 先行（main 仍指 src——幂等安全，消除切换窗口）

**Files:**
- Modify: `apps/web/vite.config.ts:11-13`
- Modify: `apps/web/tsconfig.json`
- Modify: `apps/web/package.json:11`
- Modify: `apps/api/vitest.config.ts`

- [ ] **Step 1: 四处一起改（v3 顺序反转：alias 先行，此时 main 指 src、alias 与之同指 src——单 commit checkout 任何时点均无害）**

vite.config.ts alias：

```ts
    alias: {
      '@': path.resolve(__dirname, './src'),
      // F36：main 指 dist 后 dev/vitest/build 会切到 dist（过期=静默注入旧代码）——显式钉 src
      '@flowweb/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
```

apps/web/tsconfig.json——**删 `rootDir`/`outDir`（tsc -b 时代残留，vite 负责产出；留着则 paths 引入的 shared src 触发 TS6059）**，paths 补：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "noEmit": true,
    "paths": {
      "@/*": ["./src/*"],
      "@flowweb/shared": ["../../packages/shared/src/index.ts"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

apps/web/package.json build 改（原 `tsc -b && vite build` 会把整棵 src 含测试编进 dist——实证 dist 躺着 275+ 个 .test.js；改后 dist 只属于 vite）：

```json
    "build": "tsc --noEmit && vite build",
```

apps/api/vitest.config.ts 的 resolve.alias 补（**v5：该文件现只有 defineConfig 一个 import——须同时补 `import path from 'path'`**）：

```ts
import path from 'path';
  // ...
  resolve: {
    alias: {
      '@flowweb/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
```

- [ ] **Step 2: 验证（tsc 零诊断 + 真实 build 过——v4 修正：Task 1 时 main 仍指 src、alias 无从判别，判别性冒烟移到 Task 2 Step 4 的"rm dist 后测试仍绿"）**

```bash
rm -rf apps/web/dist apps/web/tsconfig.tsbuildinfo \
  && pnpm --filter @flowweb/web exec tsc --noEmit \
  && pnpm --filter @flowweb/web build \
  && ls apps/web/dist/index.html && ! ls apps/web/dist/App.test.js 2>/dev/null \
  && pnpm --filter @flowweb/web test -- --run src/api/stitchApi.test.ts
```

Expected: 全过 + dist 只有 vite 产物（无 .test.js）+ 测试绿。（alias 真正的判别证据在 Task 2 Step 4：main 切 dist 后 `rm -rf packages/shared/dist && web 测试仍绿` = alias 钉住 src 的实证——Task 1 阶段 alias 与 node_modules 同指 src，测不出。）

- [ ] **Step 3: Commit**

```bash
git add apps/web/vite.config.ts apps/web/tsconfig.json apps/web/package.json apps/api/vitest.config.ts
git commit -m "build(web,api): shared 双端 alias 钉 src 先行+web tsconfig 清理（R1a/P0——main 切 dist 前置防断裂窗口；删 rootDir/outDir 残留；build 改 tsc --noEmit && vite build；dist 不再混杂 tsc 测试产物）"
```

## Task 2: shared 真构建（CJS 产出 + main 切 dist + require 冒烟）

**Files:**
- Create: `packages/shared/tsconfig.build.json`
- Modify: `packages/shared/package.json`
- Modify: `turbo.json`

- [ ] **Step 1: 写构建配置**

`packages/shared/tsconfig.build.json`：

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node"
  },
  "exclude": ["src/**/*.test.ts"]
}
```

（F36：base 是 ESNext/bundler，直接继承必产 ESM+无扩展名导入，API 是 commonjs/node 且忽略 exports——必须显式覆写。exclude 防 3 个 .test.ts 进 dist——dist 现状实测已含 `types/role.types.test.js`。base 已开 declaration/sourceMap，不重复。）

`packages/shared/package.json`：

```json
{
  "name": "@flowweb/shared",
  "version": "0.0.1",
  "private": true,
  "type": "commonjs",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "dev": "tsc -p tsconfig.build.json --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

（`type: "commonjs"` 显式写死——防后人加 `"type":"module"` 时 require 静默变 ESM 报错；`typecheck` 维持含测试文件的 noEmit 检查。）

- [ ] **Step 2: 删旧 dist 重建 + require 冒烟（含产物断言；旧 dist 现为 ESM 且缺 group/stitch/video-work 产物——删除重建的证据记入 commit）**

```bash
rm -rf packages/shared/dist packages/shared/tsconfig.tsbuildinfo && pnpm --filter @flowweb/shared exec tsc -p tsconfig.build.json && node -e "
const fs = require('fs');
const bad = fs.readdirSync('./packages/shared/dist', { recursive: true }).filter((f) => /\.test\.(js|d\.ts)/.test(f));
if (bad.length) throw new Error('dist 含测试产物: ' + bad.join(','));
const s = require('./packages/shared/dist/index.js');
const need = ['GROUP_NODE_DATA_KEYS', 'STITCH_JOB_KEYS', 'VIDEO_WORK_NODE_TYPES', 'SubscriptionError'];
const missing = need.filter((k) => s[k] === undefined);
if (missing.length) throw new Error('undefined exports: ' + missing.join(','));
if (s.GROUP_NODE_DATA_KEYS.length !== 9) throw new Error('GROUP_NODE_DATA_KEYS != 9');
console.log('require smoke ok');
"
```

Expected: `require smoke ok`（产物断言+导出断言双过）。

- [ ] **Step 3: turbo dev 依赖修正（dev 无 dependsOn——冷启动 nest 先于 shared tsc 完成会 TS2307）**

turbo.json 的 dev task 加：

```json
    "dev": {
      "dependsOn": ["^build"],
      "cache": false,
      "persistent": true
    },
```

（persistent 依赖非 persistent 允许——shared 先完成一次 build 再进 watch；API dev 运行时读 dist 的即时生效边界：改 shared 源码需 shared dev watch 增量重建或手动 build，web 侧不受影响（Task 1 alias 钉 src）。）

- [ ] **Step 4: 三端回归 + alias 判别性冒烟（v4 补：rm dist 后 web/API-vitest 测试仍绿 = alias 钉 src 的实证——现存 dist 无 types/video-work 产物，走 dist 必红）**

```bash
pnpm --filter @flowweb/api exec tsc --noEmit && pnpm --filter @flowweb/web exec tsc --noEmit && pnpm --filter @flowweb/shared test -- --run \
  && rm -rf packages/shared/dist \
  && pnpm --filter @flowweb/web test -- --run src/api/stitchApi.test.ts \
  && pnpm --filter @flowweb/api exec vitest run src/modules/video-work/snapshot-filter.util.spec.ts \
  && pnpm --filter @flowweb/shared build
```

Expected: 全绿——**dist 被抽掉后 web/vitest 仍绿证明运行时走 alias→src 而非 dist**（stitchApi 值导入 STITCH_JOB_KEYS、snapshot spec `await import('@flowweb/shared')`；API 侧用 `exec vitest` 直跑绕开 tsc 首段——tsc 走 types→dist 此刻必红属预期，验完重建 dist）。

- [ ] **Step 5: Commit**

```bash
git add packages/shared/tsconfig.build.json packages/shared/package.json turbo.json
git commit -m "build(shared): 真构建落地——CJS 覆写+type:commonjs+main 切 dist+产物断言+require 冒烟+turbo dev ^build（R1a/F36；删陈旧 ESM dist 重建——旧产物缺 group/stitch/video-work 且混测试文件）"
```

## Task 3: dist 新鲜度保障 + verify 显式链（防"改 src 忘建 dist"静默假绿）

**Files:**
- Create: `scripts/check-shared-dist.mjs`
- Modify: `apps/api/package.json`（dev/build/test 内联门禁——v6 不加 pre* 钩子）
- Modify: `package.json`（根 verify 脚本）

- [ ] **Step 1: 新鲜度门禁脚本（v4：hash manifest 替代 mtime——mtime 对"src 文件删除/改名"假绿且缓存/checkout 恢复可造出"新 mtime 旧内容"；构建时写 dist/.src-manifest.json（src+构建配置哈希），门禁比哈希；fileURLToPath 修 win32；排除 *.test.ts）**

`scripts/check-shared-dist.mjs`：

```js
// dist 新鲜度门禁：src+tsconfig.build 的内容哈希 != dist/.src-manifest.json 即失败（陈旧=静默假绿的根源）
import { createHash } from 'crypto';
import { statSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const srcDir = join(root, 'packages/shared/src');
const distDir = join(root, 'packages/shared/dist');
const manifestPath = join(distDir, '.src-manifest.json');
const buildCfg = join(root, 'packages/shared/tsconfig.build.json');

function computeManifest() {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
  const files = walk(srcDir).filter((f) => !/\.test\.(ts|tsx)$/.test(f)).sort();
  const h = createHash('sha256');
  // v5：构建配置三件全覆盖（tsconfig.build/tsconfig/tsconfig.base——改 target/outDir 类陈旧也检出）
  h.update(readFileSync(buildCfg, 'utf8'));
  h.update(readFileSync(join(root, 'packages/shared/tsconfig.json'), 'utf8'));
  h.update(readFileSync(join(root, 'tsconfig.base.json'), 'utf8'));
  for (const f of files) h.update(f + '\0' + readFileSync(f, 'utf8'));
  return JSON.stringify({ hash: h.digest('hex'), files: files.length });
}

if (process.argv[2] === '--write') {   // 构建后由 build 脚本调用
  writeFileSync(manifestPath, computeManifest());
  process.exit(0);
}
try { statSync(join(distDir, 'index.js')); } catch {
  console.error('[check-shared-dist] dist/index.js 不存在——先 pnpm --filter @flowweb/shared build');
  process.exit(1);
}
try {
  const saved = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const now = computeManifest();
  if (saved.hash !== now.hash) {
    console.error('[check-shared-dist] src/构建配置 与 dist 不一致（改了源码未重建）——先 pnpm --filter @flowweb/shared build');
    process.exit(1);
  }
} catch {
  console.error('[check-shared-dist] dist/.src-manifest.json 缺失（旧 dist 或手写产物）——重建 shared');
  process.exit(1);
}
console.log('[check-shared-dist] ok');
```

packages/shared/package.json 的 build 改为构建后写 manifest（**v5：dev 不改——watch 常驻时 && 后的 --write 永不执行**）：

```json
    "build": "tsc -p tsconfig.build.json && node ../../scripts/check-shared-dist.mjs --write",
```

（**manifest 覆盖面（v5 扩）**：hash 输入补 `packages/shared/tsconfig.json` 与仓根 `tsconfig.base.json`——改 target/outDir 之类的陈旧 dist 也检得出。）

- [ ] **Step 2: 门禁挂接——**内联调用为承重件，pre/post 钩子不依赖**（v5 关键修正：pnpm 的 enable-pre-post-scripts 默认值随版本漂移——本机 pnpm 11 默认 true，但仓钉 pnpm@9.0.0 且**实测仓根无 .npmrc 覆盖**；若钩子不跑，门禁静默失效=它要防的假绿本身，且红相实证"看不到钩子输出"会误导实现者。承重件写进 script 首段，版本无关）**

apps/api/package.json scripts 改（内联串联为承重件——**不加 pre* 钩子**，避免两套机制并存）：

```json
    "dev": "node ../../scripts/check-shared-dist.mjs && nest start --watch",
    "build": "node ../../scripts/check-shared-dist.mjs && nest build",
    "test": "node ../../scripts/check-shared-dist.mjs && tsc -p tsconfig.spec.json --noEmit && vitest run",
```

仓根新建 `.npmrc`（**登记（v6）：本仓原本无 .npmrc——加 enable-pre-post-scripts=true 后所有 pre/post 钩子（含将来他人加的）都会跑；这是兼容垫不是承重件，承重件是上面的内联段——删内联只留钩子=防线回到版本漂移风险**）：

```
enable-pre-post-scripts=true
```

（**ensure 语义（v5）+ 实现契约（v6 写死——否则实现者会写成"脚本内 import tsc"跑不通的形态）**：check 脚本默认 ensure 模式——检测到 stale/缺失时**自动重建再校验**，失败才报错；`--check` 严格模式（stale 即红不自动建，归 CI/红相实证）。实现边界三条：① 重建用 `spawnSync(process.execPath, [require.resolve('typescript/bin/tsc', { paths: [join(root, 'packages/shared')] }), '-p', 'tsconfig.build.json'], { cwd: join(root, 'packages/shared'), stdio: 'inherit' })`——**不得递归调 pnpm**（dev/build/test 段互相重入）；② 自动重建时**显式打印一行 `[check-shared-dist] 已自动重建 shared`**（静默副作用是另一种假绿）；③ 检测到 shared dev --watch 正在跑（dist mtime 秒级内变化或锁文件）时**直接返回红提示"watch 在跑勿抢写"**——两个 tsc 并发写 dist 是损坏源。verify 链首步已 shared build，内联 ensure 不会误判——登记。）

根 package.json 补（**显式诚实序列，不用 turbo run typecheck/lint**）：

```json
    "verify": "pnpm --filter @flowweb/shared build && pnpm --filter @flowweb/shared run typecheck && pnpm --filter @flowweb/shared test -- --run && pnpm --filter @flowweb/web exec tsc --noEmit && pnpm --filter @flowweb/api exec tsc --noEmit && pnpm --filter @flowweb/web test -- --run && pnpm --filter @flowweb/api test -- --run && pnpm --filter @flowweb/web lint"
```

（api lint 现况不可用（无 eslint 依赖/配置），不在 R1 范围——登记；**api test 含已知 flaky 的 collab.gateway——verify 失败时先单独重跑该套件确认**；api 的 test/build 已内联门禁，verify 链内天然生效。）

- [ ] **Step 3: 红绿双相实证（v5：内联后红相必然出现，不依赖"钩子跑没跑"未知量；hash 门禁抓不到 touch——红相必须用真内容改动）**

```bash
echo "// gate-probe" >> packages/shared/src/index.ts \
  && node scripts/check-shared-dist.mjs --check; echo "check-exit=$?" \
  && pnpm --filter @flowweb/api build 2>&1 | tail -3; echo "build-exit=$?"
```

Expected: `check-exit=1`（严格模式红：src 哈希变）+ `pnpm --filter @flowweb/api build` 首段内联门禁输出红并中止（**观察 `[check-shared-dist]` 输出出现**——内联实证）→ `pnpm --filter @flowweb/shared build` → `pnpm --filter @flowweb/api build` 绿 → `git checkout -- packages/shared/src/index.ts && pnpm --filter @flowweb/shared build`（还原+重建，双相实证记入 commit）。另验证 ensure 模式：`node scripts/check-shared-dist.mjs`（无 --check）在 stale 时自动重建后 ok。

- [ ] **Step 4: Commit**

```bash
git add scripts/check-shared-dist.mjs apps/api/package.json package.json
git commit -m "build: dist 新鲜度保障——hash manifest 门禁内联进 dev/build/test 首段+ensure 自愈语义+.npmrc 兼容垫+根 verify 显式序列（R1a v6；fileURLToPath 修 win32+排除测试文件+覆盖三 tsconfig；红绿双相实证：改 src 后内联门禁红→build→绿；api lint 不可用登记）"
```

## Task 4: deploy.sh 补全（base 传输 + 产物卫生 + 脚本随行）

**Files:**
- Modify: `deploy.sh`

- [ ] **Step 1: deploy_full 构建后端段前插 shared 构建（v5：与 deploy_api 完全同一条命令——含 rm -rf dist 与 manifest --write；两段不一致会使 full 部署后服务器 manifest 缺失/陈旧，之后远端任何 `pnpm run build/dev/test` 被门禁误红）**

```bash
  echo "=== 构建 shared ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/packages/shared && rm -rf dist && npx tsc -p tsconfig.build.json && node ../../scripts/check-shared-dist.mjs --write"

  echo "=== 构建后端 ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/api && rm -rf dist && npx nest build"
```

- [ ] **Step 2: deploy_api 增传 shared+仓根 tsconfig（v5：scripts/ 已进 deploy_full 的 tar——删冗余 scp（scp 不建父目录，全新环境直接中断）；tar 清单补 scripts/ 一次到位）**

deploy_full 的上传 tar 清单补 `scripts/`（与 package.json/pnpm-workspace.yaml 同批）。

deploy_api 段：

```bash
deploy_api() {
  echo "=== 上传后端源码 ==="
  tar czf - -C apps/api/src . \
    | ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/api/src && tar xzf -"

  echo "=== 上传 shared 与仓根构建配置 ==="
  tar czf - -C packages/shared src tsconfig.json tsconfig.build.json package.json \
    | ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/packages/shared && tar xzf -"
  scp -i "$KEY" tsconfig.base.json "$SERVER:$REMOTE_DIR/tsconfig.base.json"

  echo "=== 构建 shared 与后端（与 deploy_full 同一条命令） ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/packages/shared && rm -rf dist && npx tsc -p tsconfig.build.json && node ../../scripts/check-shared-dist.mjs --write"
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/api && rm -rf dist && npx nest build"
  ...
}
```

（`rm -rf dist` 防 dist 历史临时文件上线——实证有 probe-dto-check.tmp.js 等残留；**npx 直跑二进制不触发 npm 生命周期钩子**——内联门禁不在 npx 路径上，故显式接 `check-shared-dist.mjs --write` 写 manifest 供远端后续 `pnpm run` 使用；**前置依赖登记**：deploy_api 假设远端已跑过一次 deploy_full（workspace 结构/pnpm install/prisma/scripts 在位）；deploy_web 段同步补 `rm -rf dist`（防 Task 1 前 275 个 tsc 测试产物上传）。）

- [ ] **Step 3: 本地等价验收——干净目录三步构建 + 语法/包内容静态断言（v3 补：bash -n + tar tzf 不依赖远端）**

```bash
bash -n deploy.sh \
  && tar tzf <(tar czf - -C packages/shared src tsconfig.json tsconfig.build.json package.json) | head -5 \
  && rm -rf packages/shared/dist apps/api/dist apps/web/dist \
  && pnpm --filter @flowweb/shared build \
  && pnpm --filter @flowweb/api exec nest build \
  && pnpm --filter @flowweb/web build \
  && ls apps/api/dist/main.js && ls apps/web/dist/index.html
```

Expected: bash -n 过 + tar 内容含 tsconfig.build.json + 三步零错误 + 双产物在位。

- [ ] **Step 4: Commit**

```bash
git add deploy.sh
git commit -m "fix(deploy): shared 构建补进部署链+deploy_api 增传 shared/仓根 tsconfig/门禁脚本+产物清理（R1a——main 指 dist 后旧脚本任何环境必炸；nest build 前清 dist 防临时文件上线；deploy_api 前置依赖 deploy_full 登记）"
```

## Task 5: GROUP_NODE_DATA_KEYS 值导入切换 + require 图冒烟

**Files:**
- Modify: `apps/api/src/modules/video-work/snapshot-filter.util.ts`
- Modify: `apps/api/src/auth/admin.guard.ts:3-5`（注释）
- Modify: `apps/api/src/modules/video-project/video-project.service.ts:20`（注释）

- [ ] **Step 1: 实现**

snapshot-filter.util.ts：
- import 区补 `import { GROUP_NODE_DATA_KEYS } from '@flowweb/shared';`（与既有 `import type` 共存合法——TS 同模块两种导入可拆两行）
- CLONE_WHITELIST 改：

```ts
export const CLONE_WHITELIST: Record<string, string[]> = {
  ...WHITELIST,
  group: [...GROUP_NODE_DATA_KEYS],
};
```

（删 9 键字面量；展开拷贝防共享数组被原地 mutate。既有 parity 用例保留——切回字面量时它重新获得判别力。）

- 禁令注释两处改：

```ts
// @flowweb/shared 已真构建（R1a：main→dist CJS）——生产源码值导入自 R1a 起合法；
// dist 陈旧时 dev/build/test 首段内联的 check-shared-dist 会拦（勿删内联段）。
```

- [ ] **Step 2: require 图冒烟（v3 加强：键集全等断言——length+includes 抓不到 9 键内容漂移）**

```bash
pnpm --filter @flowweb/api exec nest build && node -e "
const m = require('./apps/api/dist/modules/video-work/snapshot-filter.util.js');
const s = require('./packages/shared/dist/index.js');
const a = [...m.CLONE_WHITELIST.group].sort().join(',');
const b = [...s.GROUP_NODE_DATA_KEYS].sort().join(',');
if (a !== b) throw new Error('键集漂移: ' + a + ' vs ' + b);
console.log('value import in CJS bundle ok');
" && pnpm --filter @flowweb/api test -- --run src/modules/video-work/
```

Expected: 冒烟 ok + 测试绿（vitest alias 走 src，nest build 走 dist——双路径都验）。

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/video-work/snapshot-filter.util.ts apps/api/src/auth/admin.guard.ts apps/api/src/modules/video-project/video-project.service.ts
git commit -m "refactor(api): CLONE_WHITELIST.group 切值导入——删 R0a 过渡字面量（R1a/F36 解除；CJS 产物 require 键集全等冒烟过）"
```

## Task 6: nodeEnvelope 纯数据模块（写侧真删键——与读侧 ?? null 显式分家）

**Files:**
- Create: `packages/shared/src/canvas/nodeEnvelope.ts` + `.test.ts`
- Modify: `packages/shared/src/index.ts`

**null 语义契约（v3 定死，防三方矛盾）：**
- **写侧**（fillDoc 入口/applyRecordToYMap/投影序列化）：`normalizeCanvasRecord` 显式构造——可选键 null → **键不进对象**（Object.entries 型写入方不得把 undefined 键当一次 set）
- **读侧出口**（readCanvasFromDoc/readDocCanvas）：**保持 `?? null` 形状**（parentId/width/height 恒存在、无值为 null）——F32/R0b 对外契约（canvasCollabRuntime applyDocToStore 消费），**出口不过 normalizeCanvasRecord**
- API snapshot-filter 的 `normalizeNodeRecord`（spread+??undefined，JSON 序列化边界语义）**保留不收敛**——两函数 JSON 往返等价但 Object.keys 形态不同，RawNode（width?:number）与 CanvasNodeRecord（width?:number|null）strict 不兼容，强行 re-export 必红且污染 API 契约；注释互指+现有 spec 锁形状

- [ ] **Step 1: 写失败测试（契约先定）**

```ts
import { describe, it, expect } from 'vitest';
import { NODE_ENVELOPE_KEYS, normalizeCanvasRecord } from './nodeEnvelope';

describe('NODE_ENVELOPE_KEYS', () => {
  it('恰 7 键', () => {
    expect(NODE_ENVELOPE_KEYS).toHaveLength(7);
    expect([...NODE_ENVELOPE_KEYS].sort()).toEqual(['data', 'height', 'id', 'parentId', 'position', 'type', 'width'].sort());
  });
});

describe('normalizeCanvasRecord（写侧真删键——Object.entries 型写入方依赖键存在性确定）', () => {
  it('null → 键消失（Object.keys 不含；JSON 往返同）', () => {
    const out = normalizeCanvasRecord({ id: 'n1', type: 'group', position: { x: 1, y: 2 }, data: {}, parentId: null, width: null, height: null } as any);
    expect(Object.keys(out).includes('parentId')).toBe(false);
    expect(Object.keys(out).includes('width')).toBe(false);
    expect(JSON.parse(JSON.stringify(out)).parentId).toBeUndefined();
  });

  it('有值全保留；position undefined → {x:0,y:0}；data undefined → {}', () => {
    const out = normalizeCanvasRecord({ id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal' }, parentId: 'p', width: 320, height: 180 });
    expect(out.parentId).toBe('p');
    expect(out.width).toBe(320);
    const out2 = normalizeCanvasRecord({ id: 'n1', type: 'textInput', position: undefined, data: undefined } as any);
    expect(out2.position).toEqual({ x: 0, y: 0 });
    expect(out2.data).toEqual({});
  });

  it('不碰 data 内部（cells 的 null 是空宫格占位）', () => {
    const out = normalizeCanvasRecord({ id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { cells: ['c1', null] } });
    expect(out.data.cells).toEqual(['c1', null]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @flowweb/shared test -- --run src/canvas/nodeEnvelope.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现（显式构造——null/undefined 键不进对象）**

```ts
/** 节点信封唯一类型（spec §4.7 纯数据方案，不含 yjs——防跨实例 instanceof 静默失败）。
 *  null 语义分家（v3）：写侧（本函数）真删键；读侧出口（readCanvasFromDoc/readDocCanvas）
 *  保持 ?? null 形状——两契约勿混。API normalizeNodeRecord 是 JSON 序列化边界语义，不收敛。 */
export interface CanvasNodeRecord {
  id: string;
  type: string;
  parentId?: string | null;
  width?: number | null;
  height?: number | null;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export const NODE_ENVELOPE_KEYS = [
  'id', 'type', 'parentId', 'width', 'height', 'position', 'data',
] as const satisfies readonly (keyof CanvasNodeRecord)[];

// 双向编译锚定（R0 group.ts 同款手法——satisfies 只抓多余键，Exclude 补抓缺键）
type _MissingFromKeys = Exclude<keyof CanvasNodeRecord, (typeof NODE_ENVELOPE_KEYS)[number]>;
type _AssertNoMissing<T extends never> = T;
type _Anchor = _AssertNoMissing<_MissingFromKeys>;  // 勿删——删即静默失去缺键防护

/** 写侧归一单入口：可选键 null→真删键（显式构造，键不进对象）；position/data undefined→兜底。
 *  将来加第四个可选字段必须进本函数。只碰信封键，不碰 data 内部。 */
export function normalizeCanvasRecord(n: CanvasNodeRecord): CanvasNodeRecord {
  const out: CanvasNodeRecord = {
    id: n.id,
    type: n.type,
    position: n.position ?? { x: 0, y: 0 },
    data: n.data ?? {},
  };
  if (n.parentId != null) out.parentId = n.parentId;
  if (n.width != null) out.width = n.width;
  if (n.height != null) out.height = n.height;
  return out;
}
```

index.ts 追加 `export * from './canvas/nodeEnvelope';`

snapshot-filter.util.ts 的 normalizeNodeRecord 注释补一行互指：

```ts
/** ……既有注释保留……
 *  R1a 分家登记：shared normalizeCanvasRecord 是写侧真删键语义（Object.keys 形态不同）——
 *  本函数保留 API JSON 序列化边界（??undefined 在 stringify 后键消失，与真删键等价）。 */
```

- [ ] **Step 4: 跑测试通过 + 重建 dist**

```bash
pnpm --filter @flowweb/shared test -- --run src/canvas/nodeEnvelope.test.ts && pnpm --filter @flowweb/shared build
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/canvas/nodeEnvelope.ts packages/shared/src/canvas/nodeEnvelope.test.ts packages/shared/src/index.ts apps/api/src/modules/video-work/snapshot-filter.util.ts
git commit -m "feat(shared): nodeEnvelope 纯数据模块——写侧真删键+双向锚定+null 语义分家契约（R1a/F29；API normalizeNodeRecord 保留并注释互指）"
```

## Task 7: 信封收敛——写者全量接共享入口 + edges 形状一次收成（≥13 处写者）

**Files（v4 扩面——edges 涟漪全清单 grep 实证 7 处生产点+~10 处夹具）：**
- Create: `apps/api/src/modules/collab/node-doc.util.ts` 内新增 `writeNodeToYMap`（**util 层非 service——v3 修正归属**）
- Modify: `apps/web/src/collab/ydocBuilder.ts`
- Modify: `apps/api/src/modules/collab/collab-document.service.ts`（insertNode/readDocCanvas edges）
- Modify: `apps/api/src/modules/project/project.service.ts`（fillDoc 手抄本 + :20/:80-81 edges 双形）
- Modify: `apps/api/src/modules/project/canvas.service.ts`（:93 edges 补丁删）
- Modify: `apps/api/src/modules/template/template.service.ts`（**:244 构造 sourceId/targetId 必改**、:292-293 双兼容读删）
- Modify: `apps/api/src/modules/execution/topology.service.ts`（:10-12 双兼容读——`e: any` tsc 抓不到，静默漏改点）
- Modify: `apps/api/src/modules/video-work/snapshot-filter.util.ts`（RawEdge :16 + :143-144）
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts`（syncStoreToDoc 信封段）
- Modify: `apps/api/scripts/backfill-team.ts`、`apps/api/prisma/gate-seed.ts`（改调共享入口——**v4 修正：两脚本当前不导入 shared，是新增依赖**；tsconfig include 不盖 scripts/prisma——无类型检查，登记"脚本不设防"）
- Modify: `apps/web/src/collab/ydocBuilder.test.ts`（**已存在 66 行 4 用例——Modify 追加，勿覆盖**）
- Test 夹具（RawEdge 形状随改）：canvas.service.spec.ts:172/:365/:375、video-work-clone.service.spec.ts:29-31、snapshot-filter.util.spec.ts:106-108/:119、video-work.service.spec.ts:422、execution.service.nodeIds.spec.ts:90

- [ ] **Step 1: 写失败测试（追加到既有 ydocBuilder.test.ts；v4 补 data 写入断言+同值 no-op 判别断言）**

```ts
import { applyRecordToYMap } from './ydocBuilder';   // 追加到既有 import

describe('ydocBuilder 信封收敛（R1a）', () => {
  it('fillDoc→readCanvasFromDoc：读侧出口保持 ?? null 形状（F32/R0b 契约）、缺 position/data 兜底不炸', () => {
    const doc = new Y.Doc();
    fillDoc(doc, [
      { id: 'n1', type: 'textInput', parentId: null, width: null, height: null, position: { x: 1, y: 2 }, data: { content: 'a' } },
      { id: 'n2', type: 'group', position: undefined as any, data: undefined as any },
    ] as any, []);
    const { nodes } = readCanvasFromDoc(doc);
    expect(nodes.find((n) => n.id === 'n1')?.parentId).toBeNull();      // null 不是 undefined——读侧契约
    expect(nodes.find((n) => n.id === 'n1')?.width).toBeNull();
    expect(nodes.find((n) => n.id === 'n2')?.position).toEqual({ x: 0, y: 0 });
    expect(nodes.find((n) => n.id === 'n2')?.data).toEqual({});
  });

  it('fillDoc 入口真删键：null 键不写 Y.Map（get 为 undefined）', () => {
    const doc = new Y.Doc();
    fillDoc(doc, [{ id: 'n1', type: 'textInput', parentId: null, width: null, height: null, position: { x: 1, y: 2 }, data: {} } as any], []);
    const m = doc.getMap('nodes').get('n1') as Y.Map<any>;
    expect(m.has('parentId')).toBe(false);
  });

  it('applyRecordToYMap 增量：缺键即 delete、值变即 set、同值 no-op（判别断言——update 增量近零）', () => {
    const doc = new Y.Doc();
    const nodesMap = doc.getMap('nodes');
    fillDoc(doc, [{ id: 'n1', type: 'group', parentId: 'p1', position: { x: 0, y: 0 }, data: { a: 1 } }] as any, []);
    const m = nodesMap.get('n1') as Y.Map<any>;
    applyRecordToYMap(m, { id: 'n1', type: 'group', position: { x: 5, y: 5 }, data: { a: 1 } });  // parentId 消失 → delete
    expect(m.get('parentId')).toBeUndefined();
    expect(m.get('position').get('x')).toBe(5);
    // 同值再调：不产生新 Y item（doc 膨胀防线——syncStoreToDoc 在 ns 每次变更都跑）
    const sv = Y.encodeStateVector(doc);
    applyRecordToYMap(m, { id: 'n1', type: 'group', position: { x: 5, y: 5 }, data: { a: 1 } });
    expect(Y.encodeStateVector(doc)).toEqual(sv);   // 状态向量不变=no-op 未产生新 item（语义断言不依赖 Yjs 编码长度——v5）
  });

  // v6：writeNodeToYMap 的断言不落 web 套件（函数在 API 侧）——真断言见下
});
```

**writeNodeToYMap 的 data 断言落 `apps/api/src/modules/collab/node-doc.util.spec.ts`（v6 从空 it 改真断言——空 it 恒绿是假覆盖）**：

```ts
it('writeNodeToYMap data 全量写入（空 data Map 会使模板导入丢全部节点数据）', () => {
  const nodesMap = new Y.Doc().getMap('nodes');
  const m = writeNodeToYMap(nodesMap, { id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { prompt: 'x' } } as any);
  expect((m.get('data') as Y.Map<any>).get('prompt')).toBe('x');
  // shadow 场景：buildShadowNodeYMap 改调后 __ephemeral 写在 data 内
  const sm = writeNodeToYMap(nodesMap, { id: 'shadow-n1', type: 'imageGen', position: { x: 0, y: 0 }, data: { fileId: 'f1', __ephemeral: true } } as any);
  expect((sm.get('data') as Y.Map<any>).get('__ephemeral')).toBe(true);
});
```

- [ ] **Step 2: 实现（web 适配器两函数 + API 侧收敛 + edges 单形状）**

2a. ydocBuilder.ts：
- import `normalizeCanvasRecord, type CanvasNodeRecord` from '@flowweb/shared'
- fillDoc 入参 `CanvasNodeRecord[]`、记录先过 normalizeCanvasRecord（本地 interface 删）
- readCanvasFromDoc 返回 `CanvasNodeRecord[]`，**出口保持 `?? null` 形状**（仅 position/data 兜底，不过 normalizeCanvasRecord——null 语义分家；兜底不是可选——`m.get('position')?.toJSON()` 可 undefined）
- 新增导出 applyRecordToYMap（syncStoreToDoc 增量段收敛；**v4：全键 diff 守卫——Y.Map.set 值同也新建 item，无守卫则 ns 每次变更产生 N 节点×3 垃圾 item，服务端 COMPACT_THRESHOLD=32 高频触发**）：

```ts
/** 增量写（syncStoreToDoc 逐键 diff 收敛）：record 缺键 → Y.Map delete；值变才 set（同值 no-op——
 *  本函数在 ns 每次变更都跑，无守卫=doc 膨胀）。data 逐键 diff 留 syncStoreToDoc 原有逻辑——业务域不属信封。 */
export function applyRecordToYMap(m: Y.Map<any>, r: CanvasNodeRecord): void {
  const n = normalizeCanvasRecord(r);
  for (const key of ['parentId', 'width', 'height'] as const) {
    const cur = m.get(key);
    const want = (n as any)[key];
    if (want === undefined) { if (cur !== undefined) m.delete(key); }
    else if (cur !== want) m.set(key, want);
  }
  if (m.get('type') !== n.type) m.set('type', n.type);
  let pos = m.get('position');
  if (!(pos instanceof Y.Map)) { pos = new Y.Map(); m.set('position', pos); }
  if (pos.get('x') !== n.position.x) pos.set('x', n.position.x);
  if (pos.get('y') !== n.position.y) pos.set('y', n.position.y);
}
```

2b. **node-doc.util.ts 新增 writeNodeToYMap（util 层——与 buildShadowNodeYMap 同层；v4：data 全量写入——漏写则模板导入丢全部节点数据）**：

```ts
/** 整信封写入共享入口（R1a 收敛）。返回节点 Y.Map；data 子 Map 经 m.get('data') 取
 *  （shadow 的 __ephemeral 写在 data 内）。消费方：project.service fillDoc /
 *  collab-document insertNode / buildShadowNodeYMap（纯替换——与标准信封的差集是
 *  缺 parentId 而非多键，v3"补 shadow 特有键"措辞不准）/ backfill-team / gate-seed。 */
export function writeNodeToYMap(nodesMap: Y.Map<any>, n: CanvasNodeRecord): Y.Map<any> {
  const rec = normalizeCanvasRecord(n);
  const m = new Y.Map();
  m.set('type', rec.type);
  for (const key of ['parentId', 'width', 'height'] as const) {
    if ((rec as any)[key] !== undefined) m.set(key, (rec as any)[key]);
  }
  const pos = new Y.Map();
  pos.set('x', rec.position.x);
  pos.set('y', rec.position.y);
  m.set('position', pos);
  const data = new Y.Map();
  for (const [k, v] of Object.entries(rec.data ?? {})) data.set(k, v);   // 全量写入——空 Map 会静默丢数据
  m.set('data', data);
  nodesMap.set(rec.id, m);
  return m;
}
```

（同步修正 node-doc.util.ts:14-27 的假注释"与前端 fillDoc 逐键同构"——该函数不写 parentId。）

2c. collab-document.service.ts：
- insertNode（:96-100，整节点写入）改调 writeNodeToYMap；writeNodeData（:82-93，只写 data 子 Map 的 fileId 等键）**不涉信封键、保持不动**——收敛面按"是否构造 position 子 Map"划界
- **readDocCanvas 的 edges 出 source/target**（删 sourceId/targetId——无存量数据一次收成）；nodes 出口保持 `?? null` 且 **position/data 补兜底 `?? {x:0,y:0}` / `?? {}`（v5：:70-71 的 ?.toJSON() 可 undefined——坏 doc 会让 Task 17 normalizeLoadedCanvas 的 c.position.x 抛 TypeError；读侧兜底两端同形是 Task 6 分家契约的一部分）**

2d. **edges 单形状全量收敛（v4 扩——7 处生产点一次改完）**：snapshot-filter.util.ts `RawEdge` 改 `{ id: string; source: string; target: string }` + buildFilteredSnapshot :143-144；canvas.service.ts :93 补丁删；**template.service.ts :244 构造改 `{ id: e.id, source: e.source, target: e.target }`、:290-294 双兼容读删——悬空边在此丢弃（`idMap.get(e.source) == null` 即 continue——与 Task 21"边端点悬空→丢弃"同一决策的落点，`|| e.source` 保留原 id 的反模式同源清除）**；**topology.service.ts :10-12 双兼容读删（`e: any` tsc 抓不到——靠 Task 8 门禁）**；project.service.ts :20-21/:80-81；消费 spec 夹具 ~10 处同步（tsc 首段会抓）。

2e. project.service.ts fillDoc 手抄本替换为 writeNodeToYMap 循环。

2f. canvasCollabRuntime.ts syncStoreToDoc 的信封增量段（:96-110 的 type/parentId/width/height/position 逐键 if）改调 applyRecordToYMap（data 逐键段保留）。

2g. **收敛裁决（v6 P1-3）**：backfill-team.ts 改调 writeNodeToYMap（数据迁移脚本值得收敛）；**gate-seed.ts 保留手写 map**——它是 2 节点 e2e fixture（收敛收益低），且 apps/web/e2e/global-setup.ts:38 经 `pnpm exec tsx prisma/gate-seed.ts` 直跑，改 shared 依赖会给 Playwright 路径引入 dist 新鲜度耦合（e2e 无内联门禁）。登记："gate-seed 手写信封是接受的例外（fixture 非产品写者）"。

- [ ] **Step 3: 跑测试 + 分两个 commit（v4：信封与 edges 形状分开——出问题可二分）**

```bash
pnpm --filter @flowweb/web test -- --run src/collab/ \
  && pnpm --filter @flowweb/api test -- --run src/modules/collab/ src/modules/project/ src/modules/template/ src/modules/video-work/ \
  && pnpm --filter @flowweb/web exec tsc --noEmit && pnpm --filter @flowweb/api exec tsc --noEmit
```

（collab.gateway flaky 已知——单独重跑确认。）

```bash
# commit 1：信封收敛（nodeEnvelope 消费）
git add apps/web/src/collab/ydocBuilder.ts apps/web/src/collab/ydocBuilder.test.ts apps/api/src/modules/collab/ apps/api/src/modules/project/project.service.ts apps/web/src/stores/canvasCollabRuntime.ts apps/api/scripts/backfill-team.ts apps/api/prisma/gate-seed.ts
git commit -m "refactor: 信封写者全量收敛——writeNodeToYMap 落 node-doc.util（data 全量写入）+applyRecordToYMap 全键 diff 守卫（R1a/F29；读侧 ?? null 契约钉死；doc 膨胀防线）"

# commit 2：edges 单形状收成（RawEdge source/target——7 处生产点+夹具）
git add apps/api/src/modules/video-work/snapshot-filter.util.ts apps/api/src/modules/project/canvas.service.ts apps/api/src/modules/template/template.service.ts apps/api/src/modules/execution/topology.service.ts apps/api/src/modules/project/project.service.ts apps/api/src/modules/video-work/*.spec.ts apps/api/src/modules/project/*.spec.ts
git commit -m "refactor(api): edges 形状一次收成 source/target——删 sourceId/targetId 双键名与三处双兼容读补丁（R1a/F29 后半；template:244 构造/topology:10 静默漏改点清偿）"
```

## Task 8: 信封序列化门禁 v3（扫描面全仓 + 空集自证 + 仓根自定位）

**Files:**
- Create: `apps/web/src/utils/envelope-serialization-guard.test.ts`

- [ ] **Step 1: 写门禁（v3：扫描面扩 apps/api/prisma+scripts——两脚本改调后无需豁免；判据兼容双引号；空集自证；仓根自定位）**

```ts
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import * as path from 'path';

/** 仓根定位：从 cwd 向上找 pnpm-workspace.yaml（防 cwd 错位——process.cwd() 在 vitest 下是包根） */
function findRepoRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(cur, 'pnpm-workspace.yaml'))) return cur;
    cur = path.dirname(cur);
  }
  throw new Error('repo root not found from ' + start);
}
const ROOT = findRepoRoot(process.cwd());

const SCAN_DIRS = [
  path.join(ROOT, 'apps/web/src'),
  path.join(ROOT, 'apps/api/src'),
  path.join(ROOT, 'apps/api/prisma'),
  path.join(ROOT, 'apps/api/scripts'),
  path.join(ROOT, 'packages/shared/src'),
];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) out.push(...listTsFiles(p));
    else if (/\.(ts|tsx)$/.test(e) && !/\.(test|spec)\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

/** 整信封写者不变量：`.set('position'` / `.set("position"`（构造 position 子 Map）只允许出现在
 *  信封单源与 Y.Map 适配器内（Task 7 后两脚本已接 writeNodeToYMap，不再豁免）。
 *  position 子 Map 构造是整信封写入的最强单判据。 */
const ALLOW_FILES = new Set([
  'packages/shared/src/canvas/nodeEnvelope.ts',
  'apps/web/src/collab/ydocBuilder.ts',
  'apps/api/src/modules/collab/node-doc.util.ts',
]);

describe('信封序列化门禁（R1a——防手抄本复活）', () => {
  it('扫描面非空自证（五目录都有文件；关键模块在位）', () => {
    const files = SCAN_DIRS.flatMap(listTsFiles);
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.includes('ydocBuilder'))).toBe(true);
    expect(files.some((f) => f.includes('node-doc.util'))).toBe(true);
    expect(files.some((f) => f.includes('backfill-team'))).toBe(true);   // 扫描面覆盖脚本的自证
    expect(files.some((f) => f.includes('canvasStore'))).toBe(true);
  });

  it('allowlist 外零 set(position 命中', () => {
    const offenders: string[] = [];
    for (const file of SCAN_DIRS.flatMap(listTsFiles)) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (ALLOW_FILES.has(rel)) continue;
      if (/\.set\(['"]position['"]/.test(readFileSync(file, 'utf8'))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('edges 单形状 tripwire（v6 收窄+收紧：扫描面去掉 apps/api/scripts——backfill-team.ts:8 的 `edges: { id, sourceId, targetId }[]` 是 Prisma CanvasEdge 列名（DB legacy 桥接，:32-33 的 set('source', e.sourceId) 是正确映射，不该改）；判据退回"任一出现即违规"——v5 的同行共现抓不到 project.service:20-21 分两行的类型声明。评审 grep 实证：六模块目录内全部非测试命中都是边形状，审计域 targetId 全在 modules/team+common 不在扫描面）', () => {
    const EDGE_DIRS = [
      path.join(ROOT, 'apps/api/src/modules/collab'),
      path.join(ROOT, 'apps/api/src/modules/canvas'),
      path.join(ROOT, 'apps/api/src/modules/project'),
      path.join(ROOT, 'apps/api/src/modules/template'),
      path.join(ROOT, 'apps/api/src/modules/video-work'),
      path.join(ROOT, 'apps/api/src/modules/execution'),
    ];
    const offenders: string[] = [];
    for (const file of EDGE_DIRS.flatMap(listTsFiles)) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (/\.(test|spec)\.(ts|tsx)$/.test(file)) continue;   // 夹具在 Task 7 已收敛，tsc 首段把关
      if (/(sourceId|targetId)/.test(readFileSync(file, 'utf8'))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
```

**edges 形状真断言（v6 从空 it 改真断言——落 apps/api/src/modules/collab/collab-document.service.spec.ts 追加）**：

```ts
it('readDocCanvas 输出边形状键集锁定（toEqual 键集敏感——语义锁不靠文本 grep）', async () => {
  const doc = new Y.Doc();
  fillDocEquivalent(doc, [{ id: 'a' }], [{ id: 'e1', source: 'a', target: 'b' }]);   // 按该 spec 既有装置
  const { edges } = readDocCanvas(doc);
  expect(edges[0]).toEqual({ id: 'e1', source: 'a', target: 'b' });   // 无 sourceId/targetId 键
});
```

- [ ] **Step 2: 跑门禁 + 红相实证（真实形态注入）**

Run: `pnpm --filter @flowweb/web exec vitest run src/utils/envelope-serialization-guard.test.ts`
Expected: PASS（Task 7 后所有写者走共享入口——若红说明收敛有残留，先修再过门禁）。

红相实证：在 `apps/api/scripts/backfill-team.ts` 临时加一行真实形态 `m.set('position', new Y.Map());` → FAIL（且证明扫描面覆盖 scripts）→ 删 → PASS（记入 commit）。

- [ ] **Step 3: R1a 收尾（pnpm verify 全链 + 干净重建 require）**

```bash
pnpm verify \
  && rm -rf packages/shared/dist && pnpm --filter @flowweb/shared build \
  && node -e "require('./packages/shared/dist/index.js').GROUP_NODE_DATA_KEYS" && echo DIST_OK
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/utils/envelope-serialization-guard.test.ts
git commit -m "test(web): 信封序列化门禁 v3——扫描面全仓（含 api/prisma+scripts）+双引号+空集自证+仓根自定位（R1a；红相实证 backfill-team 注入红——扫描面覆盖脚本自证）"
```

---

# R1b 几何与数据真值根修

**核心改道（方案 C 拍板，v3）：** localStorage 投影快照层**整体删除**——兜底职责归**服务端 doc 持久化**（已存在：Postgres 快照+增量重放+compaction+断连 flush+Redis 对等，collab.gateway.ts:98-140）。理由：F35 根因是 fillDoc seed（clientID 决胜、与新旧无关），**删 seed 即结构性消失，与客户端持久化无关**；服务端 onDisconnect 强制 flush 使正常刷新零丢失；5s debounce 窗口内崩溃丢最近编辑（多数协作工具同款行为，接受并登记）。**客户端 IDB（离线编辑/崩溃窗口兜底）立项独立分片 R1c**——立项要件登记进 spec v11：键加 userId 维度、Y.encodeStateAsUpdate 覆盖写（非读-合并-写）、destroy 前 flush+pagehide、多标签页协调（navigator.locks 或登记限制）、配额/清理、restoreInto 后立即 applyDocToStore、"恢复内容必然回传服务端"的产品政策（Yjs 语义下本地副本要么权威要么不持久化——"纯缓存"不成立）。

> **2026-09-29 证伪与修复**：上表"onDisconnect flush 兜底"在删除场景失效——flush 汇入的 storeDocument 被
> SV 判等挡住（删除不推进 clock），断连后 `!lastSV` 静默跳过是刷新复活的必现路径。判据 2 判 FAIL，
> 已按 `docs/superpowers/specs/collab-delete-persist-fix.md`（变更驱动落库）修复。兜底成立的前提是
> "每次语义变更都进 pending 队列 + 断连 flush 无条件执行且吞错有 unflushed 兜底"。

**F42 根修三件套（v3 升级——触发面/所有权/通道）：** ① 触发面唯一：pickStructNodes 纳入组节点 data（cs 侧组 data 变更直接触发协作桥——showIndex 等纯 data 变更现状不落盘的根修）；② 所有权单一：删 syncGroupDataToNodeStore 镜像（grep 实证无组件读者），组 data 只写 cs；③ 通道唯一：patchGroupData（undefined=delete）迁移全部组 data 写者 + onNodesChange removes 路径补 cells 清理（第 7 写者）。

**登记（本分片不做）：** arrangeGroupChildren/setGroupColor/duplicateNodes 是 R2；折叠卡改版是 R2d；canvasStore.ts:1000/:1122/:1380 mediaUrl 写点是 R2b；nameCustom 写入归 R2c；R1c（客户端 IDB）独立 spec。

## Task 9: spec v10 → v11 修订（docs 先行——推翻裁决必须 grep 全文清剿复述句）

**Files:**
- Modify: `docs/superpowers/specs/2026-09-28-canvas-group-ui-upgrade-design.md`

- [ ] **Step 1: 契约 5 快照段改道（方案 C 拍板）**

契约 5 及 §5 测试策略中所有"快照投影（数组形状）/SNAPSHOT_VERSION 2→3/snapshotKey 版本派生/isEmptySnapshot/四处一致性/旧 key 清扫/W7 红转绿门槛（resize→写快照→重建）"表述替换为：

> **崩溃兜底 = 服务端 doc 持久化（R1b 方案 C 拍板改道）**：服务端已有完整 doc 持久化（CanvasDoc 快照+CanvasDocUpdate 增量重放+32 条 compaction+断连强制 flush+Redis 对等同步，debounce 5s/10s）。F35 根因是 initCollab 的 fillDoc seed（clientID 决胜）——**删 seed 即结构性消失**。正常刷新零丢失（onDisconnect flush）；5s 窗口内崩溃丢最近编辑（接受并登记）。**客户端 IDB 立项 R1c 独立分片**（含六项硬化要件：userId 维度/覆盖写/destroy flush/多标签协调/配额清理/回传政策）。**验收反向判据：远端已删除的节点刷新后不得复活（无本地 seed——服务端 tombstone 权威）。** viewport 是本地偏好非协作数据——单独 localStorage key（`flowweb_vp_` 前缀）。几何进 doc 的链路 = storeProjection（cs.width ?? measured.width）→ bindBridge → doc——W7/W8（nodeStore 镜像）无消费者，删除；红转绿门槛改"resize → 读 doc 断言 width（getDoc 缝）"。
> **2026-09-29 证伪与修复**：上表"onDisconnect flush 兜底"在删除场景失效——flush 汇入的 storeDocument 被
> SV 判等挡住（删除不推进 clock），断连后 `!lastSV` 静默跳过是刷新复活的必现路径。判据 2 判 FAIL，
> 已按 `docs/superpowers/specs/collab-delete-persist-fix.md`（变更驱动落库）修复。兜底成立的前提是
> "每次语义变更都进 pending 队列 + 断连 flush 无条件执行且吞错有 unflushed 兜底"。

- [ ] **Step 2: §4.8 clamp 收编句清剿（拍板 2——spec 头部规则：推翻裁决必须 grep 全文复述句）**

`grep -n "clamp 收编\|clampPositionToPadding 从 onNodesChange\|移入 applyGroupFrame\|clamp 收进" spec 文件` 逐处改写（**v3 扩清剿面：:70 F17 行、:288 §5 store 行、:16 R1b 顺序 bullet 一并抓**）：

> **clamp 裁决（R1b 推翻原"收编"设计）**：守恒语义下 frame = bbox(children)+padding 使 `rel ∈ [padding, frame−padding−size]` 恒成立（数学构造保证）——applyGroupFrame/refitGroupGeometry **不含 clamp**（原设计是空操作）。N5（组名入框安全）由构造满足——**仅在 shouldAutoRefit=true 域成立**；manuallyResized/collapsed 组不 refit，placement 路径（addToGroup/dropIntoGroup）对这类组保留一次 clampPositionToPadding（N5 搬家问题的显式封堵）。拖拽期 clamp **保留在 onNodesChange**（帧固定时子不越界——真 clamp 的唯一作用域）；守卫扩为"父宽/高任一不可用或 xMax < padding 时跳过"（防 xMax 负值夹飞——groupLayout.ts:66 实测父宽 0 时 xMax=-(20+childW)）。

- [ ] **Step 3: F42 + F39 时机 + R1c 登记**

§4.6 或 F 系新增（**v3 扩面**）：

> **F42（R1b 修复）组 data 落盘缺口**：pickStructNodes 不含 data → cs 侧组 data 变更不触发协作桥——6 写者只写 cs 且 **任何 applyDocToStore（远端变更/撤销/10s 超时首刷）会用 doc 旧 data 整表覆写 cs，不等刷新就当场回滚、撤销不回**；第 7 写者=键盘 Delete 路径（onNodesChange removes）连 cells 清理都跳过。修法三件套：pickStructNodes 纳入组 data（触发面）+ 删 syncGroupDataToNodeStore 镜像（所有权=cs 单一）+ patchGroupData 唯一通道。
>
> **F39 校验时机（R1b 推翻 v8 的"remapIds 之后"）**：template.service.ts:273 的 `?? undefined` 会把悬空折平——挂 remap 后 dangling 恒 0 假绿；导入档校验前移 remap **之前**（remap 不改拓扑，环/嵌套/cells 同样可查）。§4.7 收敛清单中"校验阶段必须 = remapIds 之后"句同步改写。
>
> **R1c 立项（客户端 IDB 离线缓存）**：独立 spec，六项硬化要件见契约 5 改道段。
>
> **行为规则补登（v5→v6 修订——用户可见语义定死，防 R2 二次分叉）：** ① **空组解组规则**：normal 组失去最后一个子节点时一律自动解组——四条路径统一（deleteNode/removes 键盘删除/跨组移走/removeNodeFromGroup 移出），现状 removeNodeFromGroup 不解组是缺口；② **删组语义（v6 改裁决——级联统一，非解组）**：删除组节点 = 级联删除全部子节点——两路径统一（deleteNode 与 onNodesChange removes 都补级联；菜单路径 GroupContextMenu.tsx:61-67 现状就是先删子再删组——本裁决对齐它，Delete 键与菜单一条语义；v5 的"删组即解组"方案撤销：与菜单现状冲突、且与所有画布工具的容器删除直觉相反）。悬空 parentId 的 producer 洞（子节点 parentId 指向已删组、rel 被当绝对渲染飞原点）因级联而结构性消失（子都删了无悬空）；③ **分支 B 产品语义**：向 manuallyResized/collapsed 组拖入节点 → 组框不再长大、节点被 clamp 拉回框内（现状会撑大框）——placement clamp 的用户可见代价；④ **clamp 会移动刚拖入的节点**（rel 被夹到 padding 界内）——N5 组名保护的代价，用例分开声明；⑤ **F39 修订（v6 登记——v5"修不拒"是对 spec"导入侧 fail-closed 400"的部分推翻，按头部纪律必须回改）**：fatal 判据定死为 **"producer 侧不可能合法产出的结构=400；可达的真实状态=修"**——cycle=400（挂死 RF 无降级）；nested-group=400（groupNodes:815 有禁嵌套守卫——用户模板里的嵌套组必是数据损坏，且 RF extent:parent 对嵌套组行为未定义）；non-group-parent=400（producer 侧 parentId 只指向组）；三类悬空（dangling/dangling-cell/dangling-edge）=修不拒（producer 侧可达：删组窗口/过滤剥节点——降级表示已存在：undefined/null/丢弃）；⑥ **离线精确语义（v6 C1）**："服务端不可用时刷新"分两段——前 10s loading 门内不可编辑；**10s 超时后现状照常置 connected+applyDocToStore(空 doc)+门抬起 → 空画布可编辑态，用户新建节点会在同一次 Yjs 合并里与真实内容叠在原点附近**。R1 接受此语义并登记；R1c 决策前廉价兜底（超时分支不置 connected、保持 loading+「未同步，重试」提示——一行判断）作为可选项登记。
>
> **外部 spec 复述句清剿（v5）**：`docs/superpowers/specs/2026-09-16-video-works-design.md:213`（"readCanvas 返回 {id, sourceId, targetId}"）与 :245（"edges 断言无 sourceId"）——edges 收敛是对它的推翻，按"推翻必须清剿复述句"规则一并改写。
>
> **enableShutdownHooks 登记（v5——C8）**：main.ts 无 `app.enableShutdownHooks()` → pm2 restart 的 SIGINT 不触发 Nest 生命周期 → collab.gateway.ts:152-154 的 `server.destroy()`（唯一 flush 内存 doc 的入口）不跑 → **每次部署丢所有打开画布的 ≤5s 未 flush 编辑**。R1b 把服务端提升为唯一持久化层后这一行从锦上添花变成承重墙——**Task 12 内落地**（一行）。
>
> **验收口径修正（v4）**：①"改 shared 源码 → API dev 即时生效"不可达（nest watch 只监听 apps/api/src、不监听依赖 dist、require 缓存不失效）——口径改"web 即时生效（alias→src）+ API 需重启/重建"；②**接受项补登**："服务端不可用时刷新=空白画布（loading 门内不可编辑）"——方案 C 后本地零兜底，此为接受的离线行为（与 5s 窗口丢编辑并列）；③**R2d 登记**："折叠几何覆写 width/height + savedSize 双份是守卫矩阵的根因——R2d 改折叠卡时一并收口（折叠不覆写 width/height 只置标志，渲染层算折叠矩形，删 savedSize 与恢复分支）"，防 R2d 只改视觉不改模型；④**S3 登记**："程序化入组（R2 的'把选中节点加入组'）在守恒式下表现为组瞬移到子 bbox——拖拽路径无感（落点必在组框内），程序化调用需要'移子入组'变体，R2 spec 先定"；⑤**跨分片不变量登记**：信封序列化门禁/几何写点门禁/dist 新鲜度门禁/getDoc 缝是 R2+ 必须维护的不变量——R2 分片不得顺手删除。

- [ ] **Step 4: 复述句全文清剿（v3 扩——按 spec 头部规则 grep 验证零残留）**

```bash
grep -n "快照投影\|SNAPSHOT_VERSION\|snapshotKey\|isEmptySnapshot\|四处一致性\|remapIds 之后\|clamp 收编\|clamp 收进" docs/superpowers/specs/2026-09-28-canvas-group-ui-upgrade-design.md
```

逐处改写或删除（F34(:87)/F35(:88)/§3 收益清单(:122)/§4.7 收敛清单(:260)/§5 表格行/验收行/:16/:70/:288）。

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-09-28-canvas-group-ui-upgrade-design.md
git commit -m "docs: spec v11——契约 5 改道服务端 doc 持久化+clamp 收编推翻（含 placement 例外域）+F42 三件套+F39 时机前移+R1c 立项（R1b 前置；复述句全文清剿）"
```

## Task 10: projectCanvasNodes 投影分型 + getDoc 测试缝 + G3 读 doc 断言

**Files:**
- Create: `apps/web/src/utils/projectCanvasNodes.ts` + `.test.ts`
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts`（storeProjection 改调 + **导出 getDoc()**）
- Test: `apps/web/src/stores/canvasCollabRuntime.auto-edge.test.ts` 或新建 `canvasCollabRuntime.projection.test.ts`（追加 G3）

- [ ] **Step 1: 测试缝三件套（v6——getDoc 只解决"读"、syncStoreToDoc 解决"写驱动"，applyDocToStore 还要"读回驱动"（undo 用例/Task 18 乒乓断言依赖 um.undo() 后 store 回流——onRemote 只在 initCollab 注册、测试跑不动 initCollab）。三件对称形参化）**

canvasCollabRuntime.ts：

```ts
/** 差异转 ydoc 事务——doc 显式形参化（syncAutoEdgesToDoc 同款先例）：bindBridge 内传模块 doc，
 *  测试直接 new Y.Doc() 驱动（G3/W7 红转绿门槛的装置基础）。 */
export function syncStoreToDoc(d: Y.Doc, origin: string) { /* 原实现，doc 参数化 */ }

/** server doc → store——同款形参化（undo/乒乓断言的读回驱动）。 */
export function applyDocToStore(d: Y.Doc) { /* 原实现，doc 参数化 */ }

/** 测试缝（只读）：读 doc 断言用。勿用于业务逻辑——业务走订阅。 */
export function getDoc(): Y.Doc | null {
  return doc;
}
```

（bindBridge/onRemote 内调用改传模块 doc；模块内其余调用点同步。）

- [ ] **Step 2: 写失败测试（含 data 分型——组取 cs/节点取 ns）**

```ts
import { describe, it, expect } from 'vitest';
import { projectCanvasNodes } from './projectCanvasNodes';

describe('projectCanvasNodes（几何取 cs、data 按所有权分型）', () => {
  it('组节点 data 取 cs（F42——组真值在 cs，ns 侧陈旧不污染）；普通节点 data 取 ns、ns 缺席回落 cs', () => {
    const cs = [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, parentId: null, width: 300, height: 250,
        data: { groupType: 'storyboard', storyboard: { aspectRatio: '1:1' } } },
      { id: 'n1', type: 'imageGen', position: { x: 5, y: 5 }, parentId: 'g1', width: 100, height: 60,
        data: { fileId: 'old' } },
    ];
    const ns = {
      g1: { id: 'g1', type: 'group', data: { groupType: 'storyboard' } },
      n1: { id: 'n1', type: 'imageGen', data: { fileId: 'new' } },
    };
    const out = projectCanvasNodes(cs as any, ns as any);
    expect(out.find((n) => n.id === 'g1').data.storyboard).toEqual({ aspectRatio: '1:1' });
    expect(out.find((n) => n.id === 'n1').data.fileId).toBe('new');
    const out2 = projectCanvasNodes([{ id: 'n2', type: 'textInput', position: { x: 0, y: 0 }, data: { content: 'x' } }] as any, {} as any);
    expect(out2[0].data).toEqual({ content: 'x' });
  });

  it('几何：width ?? null（不含 measured——v6 纪律三：渲染期量→doc 漂移源）；输出经 normalizeCanvasRecord（写侧真删键——无 null 键）', () => {
    const cs = [{ id: 'a', type: 'group', position: { x: 10, y: 20 }, parentId: null, width: undefined, height: 100, measured: { width: 280, height: 120 }, data: {} }];
    const out = projectCanvasNodes(cs as any, {} as any);
    expect(out[0].width).toBeUndefined();   // width 缺→真删键→undefined 而非 null/measured
    expect(Object.keys(out[0]).includes('parentId')).toBe(false);
  });
});
```

Run: `pnpm --filter @flowweb/web test -- --run src/utils/projectCanvasNodes.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现（syncStoreToDoc 的增量写者同源消费——数据源两条路径同一，防镜像往返老路）**

```ts
import { normalizeCanvasRecord, type CanvasNodeRecord } from '@flowweb/shared';

/** store→doc 投影单源（syncStoreToDoc 增量写者与后续路径共用）：几何真值在 canvasStore（width 缺取 RF measured）；
 *  data 所有权分型（F42）：组节点取 cs（所有权单一——Task 11 删镜像后 ns 无组 data），
 *  普通节点取 ns（updateConfig 域）、ns 缺席回落 cs（恢复窗口）。输出经写侧归一（真删键）。 */
export function projectCanvasNodes(
  csNodes: { id: string; type?: string; position: { x: number; y: number }; parentId?: string | null; width?: number | null; height?: number | null; measured?: { width?: number; height?: number }; data?: Record<string, unknown> }[],
  nsNodes: Record<string, { data?: Record<string, unknown> }>,
): CanvasNodeRecord[] {
  return csNodes.map((nd) => normalizeCanvasRecord({
    id: nd.id,
    type: nd.type || 'videoGen',
    parentId: nd.parentId ?? null,
    position: nd.position,
    width: nd.width ?? null,      // v6 纪律三：投影不含 measured（渲染期量→doc 漂移源）；resize 经 applyNodeChanges 写 cs.width（groups.test:319 实证）
    height: nd.height ?? null,
    data: nd.type === 'group' ? (nd.data ?? {}) : (nsNodes[nd.id]?.data ?? nd.data ?? {}),
  }));
}
```

canvasCollabRuntime.ts storeProjection 改调 projectCanvasNodes（**增量写者自动同源**——syncStoreToDoc :80 本就吃 `storeProjection()` 输出，改投影内部实现即两条写者数据源统一：组 data 取 cs 新值；v2 的"增量写者 data 源仍是 nodeStore 优先"缺口由内联投影消失而闭合）。

- [ ] **Step 4: G3 读 doc 断言（"改了不落盘"自动化可见——现状必红=F42 实证；**v5 装置落地：形参化后 3 行驱动，不需要 provider**）**

canvasCollabRuntime 既有 spec 模式追加（新建 `canvasCollabRuntime.projection.test.ts`）：

```ts
it('G3 读 doc 断言：updateStoryboardConfig 改比例 → doc 里的 storyboard.aspectRatio 更新（F42 投影分型——现状红相=组 data 取 ns 陈旧值）', () => {
  // 装置（v6 补 ns 陈旧夹具——若只摆 cs，现状投影的 ?? nd.data 回落会拿到 cs 新值 → 现状也绿、红相论证倒塌；
  // 真实世界的红相正来自 groupNodes:839/mergeStoryboard:1165 的 ns.addNode 写入陈旧组 data——夹具必须复现）：
  const d = new Y.Doc();
  fillDoc(d, [], []);
  useCanvasStore.setState({ nodes: [storyboardGroupFixture('16:9')], edges: [] });   // cs：aspectRatio 16:9（非 1:1——尺寸联动）
  useNodeStore.setState({ nodes: { g1: { id: 'g1', type: 'group', data: { groupType: 'storyboard', storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: false, stitchResolution: '2K' } } } } });
  useCanvasStore.getState().updateStoryboardConfig('g1', { aspectRatio: '1:1' });
  syncStoreToDoc(d, Origin.LocalUser);
  const m = d.getMap('nodes').get('g1') as any;
  expect(m.get('data').get('storyboard').get('aspectRatio')).toBe('1:1');
  // 现状红相：投影 data 取 ns 陈旧 16:9 → doc 里 aspectRatio 仍 16:9
});
```

（装置现场按套件既有 doc 装置模式补全。**现状先跑记录红相**——v3 纪律。**夹具字段选择（v4 钉死）**：G3 必须改 `aspectRatio`（尺寸联动字段——updateStoryboardConfig 同步改 width/height → 桥经 pickStruct 的几何字段触发 → Task 10 投影分型即红转绿）；**禁用 showIndex**（纯 data 字段——桥不触发，用例会红到 Task 11 触发面落地，判别力属于 Task 11 的 pickStructNodes 用例）。）

- [ ] **Step 5: 跑测试 + commit**

```bash
pnpm --filter @flowweb/web test -- --run src/utils/ src/stores/ && pnpm --filter @flowweb/web exec tsc --noEmit
```

```bash
git add apps/web/src/utils/projectCanvasNodes.ts apps/web/src/utils/projectCanvasNodes.test.ts apps/web/src/stores/canvasCollabRuntime.ts
git commit -m "fix(web): 投影 data 所有权分型——组取 cs/节点取 ns+增量写者同源消费+getDoc 测试缝（F42 前半；G3 读 doc 断言现状红相实证）"
```

## Task 11: F42 后半——触发面收口 + patchGroupData 唯一通道 + 删镜像 + cells 修复（**前移紧邻 Task 10——F42 一次修完**）

**Files:**
- Modify: `apps/web/src/stores/canvasHistory.ts`（pickStructNodes 纳入组 data）
- Modify: `apps/web/src/stores/canvasStore.ts`（patchGroupData + 删 syncGroupDataToNodeStore + 六写者迁移 + cells 修复）
- Test: `apps/web/src/stores/canvasStore.groups.test.ts`、`canvasHistory.test.ts`（**v4：既有用例名"只保留结构字段（id/type/position/parentId/width/height）"同步改+补组 data 判别用例**——toEqual 忽略 undefined 属性，data: undefined 不破坏既有断言；但用例名与 pick 面无组 data 锚）、`canvasStore.marqueeSelecting.test.ts:19-24`（**v4：键集断言面——pick 输出加 data 键后核对**）

- [ ] **Step 1: 失败测试（触发面——纯 data 变更要进 doc；patchGroupData 语义）**

```ts
describe('F42 触发面——pickStructNodes 纳入组 data', () => {
  it('组节点 data 变更使 pickStruct 输出不等（showIndex 等纯 data 变更桥必须触发——现状红：不含 data 恒等）', () => {
    const before = pickStructNodes([{ id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard', storyboard: { showIndex: false } } } as any]);
    const after = pickStructNodes([{ id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard', storyboard: { showIndex: true } } } as any]);
    expect(isEqual(before, after)).toBe(false);   // 现状：两输出相等（data 不在 pick 面）——必红
  });

  it('普通节点 data 不入 pick 面（nodeStore 订阅已覆盖——不加比较税）', () => {
    const mk = (d: unknown) => [{ id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, data: d } as any];
    expect(isEqual(pickStructNodes(mk({ a: 1 })), pickStructNodes(mk({ a: 2 })))).toBe(true);
  });
});

describe('patchGroupData（undefined=delete，只写 cs——所有权单一）', () => {
  it('undefined 值删除键（in 断言——spread+undefined 不删键是 P0-2 同源坑）', () => {
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal', name: 'A', color: 'red' } },
    ] as any, edges: [] });
    useCanvasStore.getState().patchGroupData('g1', { color: undefined });
    const g = (useCanvasStore.getState().nodes[0] as any).data;
    expect('color' in g).toBe(false);
    expect(g.name).toBe('A');
  });

  it('F18——convertGroup 增量 patch：normal→storyboard 保 name/color + savedSize/manuallyResized 删除（in 断言）+ storyboard 注入', () => {
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 300, height: 250,
        data: { groupType: 'normal', name: '我的组', color: 'red', manuallyResized: true, savedSize: { width: 300, height: 250 } } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 20, y: 50 }, data: { status: 'done', fileId: 'f1' } },
    ] as any, edges: [] });
    useCanvasStore.getState().convertGroup('g1', 'storyboard');
    const d = (useCanvasStore.getState().nodes.find((n) => n.id === 'g1') as any).data;
    expect(d.name).toBe('我的组');
    expect(d.color).toBe('red');
    expect('savedSize' in d).toBe(false);
    expect('manuallyResized' in d).toBe(false);
    expect('storyboard' in d).toBe(true);
  });

  it('undo 语义（定死）：patch 经桥以 LocalUser origin 入 undo 栈，500ms 合并；undo 恢复旧 data', async () => {
    // 装置：undoManager attached（套件既有）→ patchGroupData({name:'B'}) → undo() → name 回旧值
    // 连点两次（<500ms）= 1 项 undo（captureTimeout 默认 500）
  });
});

describe('cells 修复（第 7 写者——键盘 Delete 路径）', () => {
  it('onNodesChange remove 分镜组子节点 → cells 同步清死 id（现状红：removes 段无组清理）', () => {
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard', cells: ['c1', 'c2'] } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 0, y: 0 }, data: {} },
      { id: 'c2', type: 'imageGen', parentId: 'g1', position: { x: 0, y: 0 }, data: {} },
    ] as any, edges: [] });
    useCanvasStore.getState().onNodesChange([{ id: 'c1', type: 'remove' } as any]);
    const cells = ((useCanvasStore.getState().nodes.find((n) => n.id === 'g1') as any).data).cells;
    expect(cells.includes('c1')).toBe(false);   // 现状：cells 仍含 'c1'——必红
  });

  it('删组=级联删子（v6 改裁决——现状红：deleteNode 只处理被删节点的父组，不处理被删节点是组 → 子节点 parentId 悬空+rel 被当绝对渲染飞原点。修=级联，对齐菜单 GroupContextMenu:61-67 先删子再删组的既有语义）', () => {
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', position: { x: 100, y: 100 }, width: 300, height: 250, data: { groupType: 'normal' } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 20, y: 50 }, data: {} },
      { id: 'top', type: 'imageGen', position: { x: 500, y: 500 }, data: {} },
    ] as any, edges: [] });
    useCanvasStore.getState().deleteNode('g1');
    const st = useCanvasStore.getState().nodes;
    expect(st.some((n: any) => n.id === 'g1')).toBe(false);   // 组删
    expect(st.some((n: any) => n.id === 'c1')).toBe(false);   // 子级联删（无悬空）
    expect(st.some((n: any) => n.id === 'top')).toBe(true);   // 无关节点不动
  });

  it('removeNodeFromGroup 移出最后子 → normal 空组解组（v5 C2——现状红：留空框；v6 组原点改非零 (100,100)——原点为 0 时 rel==abs 无判别力）', () => {
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', position: { x: 100, y: 100 }, width: 300, height: 250, data: { groupType: 'normal' } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 20, y: 50 }, data: {} },
    ] as any, edges: [] });
    useCanvasStore.getState().removeNodeFromGroup('g1', 'c1');
    expect(useCanvasStore.getState().nodes.some((n: any) => n.id === 'g1')).toBe(false);
    expect((useCanvasStore.getState().nodes.find((n) => n.id === 'c1') as any).position).toEqual({ x: 120, y: 150 });   // 绝对还原（rel+组原点）
  });
});
```

**先在现状代码跑一遍记录真红相**（v3 纪律——六组用例逐条记录：触发面两条/patchGroupData/F18/undo/cells 修复/删组级联/移空解组）。

- [ ] **Step 2: 实现**

2a. canvasHistory.ts pickStructNodes（**比较税登记（v5）：组数量小、cells/storyboard 键浅——每次 cs 变更加一轮组 data 深比较可接受；这是"触发面正确"的代价，勿当多余删掉**）：

```ts
/** equality/白名单共用提取：只保留触发历史的结构字段。
 *  F42（R1b）：组节点 data 纳入——cs 侧组 data 变更（storyboard 配置/cells/名字）必须触发协作桥，
 *  否则纯 data 变更（showIndex）不落盘且会被下一次 applyDocToStore 用 doc 旧值整表覆写。
 *  普通节点 data 不入（nodeStore 订阅已覆盖）。
 *  比较税：组 data 深比较每次 cs 变更都跑——组数量小可接受，换来触发面正确（勿删）。 */
export function pickStructNodes(nodes: Node[]) {
  return nodes.map((nd) => ({
    id: nd.id,
    type: nd.type,
    position: nd.position,
    parentId: nd.parentId,
    width: nd.width,
    height: nd.height,
    data: nd.type === 'group' ? (nd.data as any) : undefined,
  }));
}
```

2b. canvasStore.ts：

```ts
  /** 组 data 唯一通道（§4.7）：增量合并；undefined=delete。只写 cs——所有权单一
   *  （F42：镜像 syncGroupDataToNodeStore 已删，ns 无组 data，投影组取 cs）。 */
  patchGroupData: (groupId, patch) => {
    set((st) => ({
      nodes: st.nodes.map((n) => {
        if (n.id !== groupId) return n;
        const merged = { ...n.data, ...patch };
        for (const k of Object.keys(patch)) if ((patch as any)[k] === undefined) delete (merged as any)[k];
        return { ...n, data: merged };
      }),
    }));
  },
```

（**运行时 9 键兜底不做**——`__fromMulti` 在子节点 data 不在组上，剔除是运行时风险；约束改测试断言：patchGroupData 用例旁加"组 data 键 ⊆ GROUP_NODE_DATA_KEYS ∪ 运行白名单"门禁式用例。）

- **删 syncGroupDataToNodeStore 函数 + 4 调用点**（convertGroup:1231/renameGroup:1243/markManuallyResized:1250/toggleCollapse:1282）；其顶部注释"localStorage 快照数据源是 nodeStore"随快照层（Task 12）过时——一并删
- convertGroup 两分支 data 段改 patchGroupData（F18 语义：name 非空保留）：

```ts
    // →storyboard：
    get().patchGroupData(groupId, {
      groupType: 'storyboard', cells: sorted,
      storyboard: { aspectRatio: '16:9', gridRows: rows, gridCols: cols, showIndex: false, stitchResolution: '2K' },
      nameCustom: false,
      name: (gd.name && gd.name.trim()) || `分镜组 ${sorted.length} 个节点`,
      savedSize: undefined, manuallyResized: undefined,
    });
    // →normal：
    get().patchGroupData(groupId, {
      groupType: 'normal',
      name: (gd.name && gd.name.trim()) || '分组',
      nameCustom: undefined, storyboard: undefined, cells: undefined,
      savedSize: undefined, manuallyResized: undefined,
    });
```

- toggleCollapse 折叠/展开的 data 段（collapsed/savedSize）改经 patchGroupData；**六写者**（updateStoryboardConfig/resizeStoryboardGrid/clearStoryboard/addImageToStoryboardCell/removeStoryboardCell/dropImageIntoStoryboard 的组 data 段）全部改 patchGroupData
- **onNodesChange removes 段补组清理**（对齐 deleteNode :239-252——分镜组 cells 过滤；普通组删空自动解组）。捕获在 set 之前（照 deleteNode :224 先捕获模式）——onNodesChange 开头 :520-521 已有 removedIds 收集处，同位置补：

```diff
     const removedIds = changes.filter((c) => c.type === 'remove').map((c) => (c as any).id);
     if (removedIds.length > 0) cascadeDeleteVideoProject(get().nodes, removedIds);
+    // v6：被删节点是组 → 级联（先于 applyNodeChanges 捕获，filter 后丢父子）；对齐 deleteNode/菜单语义
+    const removedGroupsChildren = removedIds.flatMap((gid) => {
+      const n = get().nodes.find((x) => x.id === gid);
+      return n?.type === 'group' ? get().nodes.filter((c) => c.parentId === gid).map((c) => c.id) : [];
+    });
+    const parentOfRemoved = new Map(   // set 之前捕获——filter 后丢失父子关系（deleteNode :224 同款）
+      removedIds.map((id) => [id, get().nodes.find((n) => n.id === id)?.parentId]),
+    );
```

（**diff 形式（v6）——canvasStore.ts:520-521 已有 removedIds 两行不重复声明**；removes 批次的 changes 需补 `allRemoved.filter(id => !removedIds.includes(id)).map(id => ({ id, type: 'remove' }))` 合入 applyNodeChanges 输入，或 set 后对级联子走 deleteNode 三件套清理——现场取后者更简（复用单节点清理路径）。）

TD-11 段（:585-592，set 之后的 removes 处理）追加：

```ts
    for (const change of removes) {
      const prevParentId = parentOfRemoved.get(change.id);
      const parent = prevParentId ? get().nodes.find((n) => n.id === prevParentId) : undefined;
      if (parent?.type === 'group') {
        if ((parent.data as any)?.cells) {
          get().patchGroupData(parent.id, { cells: ((parent.data as any).cells as string[]).filter((c) => c !== change.id) });
        } else if ((parent.data as any).groupType === 'normal' && !get().nodes.some((c) => c.parentId === parent.id)) {
          get().ungroup(parent.id);
        }
      }
    }
    // v6：级联子清理（组被删时其子走 deleteNode 三件套——cancelNodeProcess/ns.deleteNode/unregisterSaveHandler）
    for (const cid of removedGroupsChildren) {
      if (get().nodes.some((n) => n.id === cid)) get().deleteNode(cid);
    }
```

**deleteNode 级联（v6——同款）**：deleteNode(id) 开头判 `type === 'group'` → 先对每个子 `get().deleteNode(childId)` 递归（子也可能是组——多嵌套不存在于合法数据但级联天然处理）→ 再删自身。菜单路径（GroupContextMenu:61-67 先删子再删组）与本路径统一后行为不变 ✓。**v5 的 dissolveGroup/ungroupForce 方案撤销**（与菜单级联现状冲突）。

- [ ] **Step 3: undo 语义断言补全（v6 修正——um.undo() 后 store 回流依赖 onRemote（只在 initCollab 注册、测试跑不动）：经测试缝三件套的 applyDocToStore(d) 显式回流）**

```ts
it('undo 语义：patchGroupData 入栈+500ms 合并+undo 恢复旧 data', async () => {
  const d = new Y.Doc();
  const um = new Y.UndoManager(d.getMap('nodes'), { trackedOrigins: new Set([Origin.LocalUser]) });
  useCanvasStore.setState({ nodes: [groupFixture('g1', { name: 'A' })] as any, edges: [] });
  syncStoreToDoc(d, Origin.LocalUser);          // 初态入 doc
  useCanvasStore.getState().patchGroupData('g1', { name: 'B' });
  useCanvasStore.getState().patchGroupData('g1', { name: 'C' });
  syncStoreToDoc(d, Origin.LocalUser);          // 两次 patch 同批（<500ms）→ captureTimeout 合并为 1 项
  expect(um.undoStack.length).toBe(1);
  um.undo();
  applyDocToStore(d);                           // v6：显式读回（替代跑不动的 onRemote）
  const g = (useCanvasStore.getState().nodes.find((n: any) => n.id === 'g1') as any).data;
  expect(g.name).toBe('A');                     // undo 恢复旧值
});
```

（装置细节按 canvasUndo.test.ts 的 attach/detach 既有模式对齐；vi.useFakeTimers 控制 500ms 窗口。）

**derivations 配对注释（v5 P1）**：patchGroupData 函数头注释钉死——"改 collapsed/cells 的调用方**必须**随后调 applyGroupDerivations（deriveHidden/repairStoryboardCells 派生）；本函数不内嵌调用（repairStoryboardCells 会在中间态把子节点移出组）"。补一条用例：patch collapsed:true → applyGroupDerivations → 子节点 hidden===true。

- [ ] **Step 4: 组 data 字面量重建门禁 + 跑测试**

canvasStore.ts 组 data 字面量重建模式（`data: { groupType` 对**既有组**的整块替换）零命中——groupNodes 新建与 mergeStoryboard 建组段豁免（登记：节点尚不存在）；门禁断言写"建组外上下文零命中"（grep 分行上下文窗口现场定）。

```bash
pnpm --filter @flowweb/web test -- --run src/stores/ && pnpm --filter @flowweb/web exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/canvasHistory.ts apps/web/src/stores/canvasStore.ts apps/web/src/stores/canvasStore.groups.test.ts
git commit -m "fix(web): F42 三件套——pickStructNodes 纳入组 data（触发面）+删 syncGroupDataToNodeStore 镜像（所有权=cs）+patchGroupData 唯一通道+键盘删除 cells 修复（第 7 写者）+F18 增量 patch+undo 语义定死（现状红相四组实证）"
```

## Task 12: 删快照层（方案 A）+ viewport 另存 + registry 重跑

**Files:**
- Delete: `apps/web/src/pages/canvas/hooks/canvasSnapshot.ts` + `canvasSnapshot.test.ts` + `__tests__/canvasSnapshot.test.ts`
- Delete: `apps/web/src/pages/canvas/hooks/useCanvasPersistence.ts` + `useCanvasPersistence.test.ts` + `__tests__/useCanvasPersistence.test.ts`
- Create: `apps/web/src/utils/viewportPersistence.ts` + `.test.ts`
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts`（删 seed + 删 import）
- Modify: `apps/web/src/pages/canvas/page.tsx`（hook 调用与死导入清理 + viewport 恢复接线）

- [ ] **Step 1: viewport 另存（v3 修正链路：订阅 cs.viewport debounce 写——非 onMoveEnd；key 用 flowweb_vp_ 前缀避开旧 sweep 正则）**

```ts
import { useCanvasStore } from '@/stores/canvasStore';

const VP_PREFIX = 'flowweb_vp_';

export const viewportKey = (projectId: string) => VP_PREFIX + projectId;

/** viewport 本地偏好持久化（非协作数据——契约 5 v11）：订阅 cs.viewport debounce 500ms 写
 *  （viewport 每帧写 store——直写 localStorage 会阻塞主线程）。恢复：initCollab 完成后读 key set 进 store。 */
export function bindViewportPersistence(projectId: string): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsub = useCanvasStore.subscribe((state, prev) => {
    if (state.viewport === prev.viewport) return;
    if (state.isHydrating) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try { localStorage.setItem(viewportKey(projectId), JSON.stringify(useCanvasStore.getState().viewport)); } catch { /* 隐私模式配额——忽略 */ }
    }, 500);
  });
  return () => { unsub(); if (timer) clearTimeout(timer); };
}

export function readViewport(projectId: string): { x: number; y: number; zoom: number } | null {
  try {
    const raw = localStorage.getItem(viewportKey(projectId));
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.zoom === 'number' ? v : null;
  } catch { return null; }
}
```

（测试：写 debounce 合并/恢复解析/坏 JSON null——纯 localStorage mock。）

- [ ] **Step 2: initCollab 删 seed（F35 根因拔除）+ viewport 恢复接线**

```ts
export async function initCollab(projectId: string): Promise<void> {
  await destroyCollab();
  currentPid = projectId;
  doc = new Y.Doc();
  attachUndoManager(doc);
  // v11 改道：崩溃兜底=服务端 doc 持久化（onDisconnect flush）——无本地 seed 无 reconcile
  provider = new HocuspocusProvider({ ... });
  ...
}
```

（原 `loadSnapshot`/`isEmptySnapshot` import + seed 三行 + :242 TODO(R1b/F35) 注释删除；**viewport 恢复+绑定（v4 钉死接线点）**：恢复 setState 放 initCollab await 之后——page.tsx:196 的 loading 门保证 CanvasPageInner/CanvasView 在 projectId 就绪后才挂载，`defaultViewport={viewport}`（CanvasView:494）挂载时读一次的时序因此安全；**bindViewportPersistence(projectId) 的调用点=CanvasPageInner（page.tsx:209-210 附近）的 useEffect，替换原 useCanvasPersistence(projectId) 调用**——`useEffect(() => { if (!projectId) return; return bindViewportPersistence(projectId); }, [projectId])`（v6 补 projectId null 守卫——首跑为 null 会写错 key；返回的 unbind 即 cleanup）。**首同步门确认（v4）+10s 边界（v6 C1）**：page.tsx loading 门 + setHydrating(true) 包住 initCollab→applyDocToStore 全程——前 10s 不可编辑 ✓；但 initCollab:260-269 超时后照常置 connected+applyDocToStore(空 doc)+门抬起 → **空画布可编辑态**（spec Task 9 规则⑥已登记接受+廉价兜底可选项：超时分支不置 connected 保持 loading+「未同步，重试」——现场与用户确认是否 R1 内做）。）

- [ ] **Step 3: 删 6 文件 + 调用点清理 + registry 重跑**

```bash
git rm apps/web/src/pages/canvas/hooks/canvasSnapshot.ts apps/web/src/pages/canvas/hooks/canvasSnapshot.test.ts apps/web/src/pages/canvas/hooks/__tests__/canvasSnapshot.test.ts apps/web/src/pages/canvas/hooks/useCanvasPersistence.ts apps/web/src/pages/canvas/hooks/useCanvasPersistence.test.ts apps/web/src/pages/canvas/hooks/__tests__/useCanvasPersistence.test.ts
grep -rn "useCanvasPersistence\|canvasSnapshot\|snapshotKey\|loadSnapshot" apps/web/src --include="*.ts*"   # 零残留
```

- page.tsx：useCanvasPersistence 调用删 + loadSnapshot/isEmptySnapshot/hydrateNodes/refitExpandedGroups 死导入删
- `nodeOrder.ts` hydrateNodes 删 parentMap 第二形参（唯一双参消费者=useCanvasPersistence :44-53 已删；applyDocToStore :191 本就单参调用——tsc 指认零残留）
- **registry 重跑（v5 钉死——生成器已确认存在）**：`node apps/web/scripts/canvas-migration-registry.mjs` 重生成（产物写在 :99）——R1a/R1b 新增的 10+ 测试档会使 diff 远大于两行，**勿手工改 JSON**（会被下次重跑覆盖）；同步更新 differExpectedPairs/adjudications。注意 css-baseline-diff.mjs:118-123 缺档会 exit 1——重生成后跑一遍确认。
- **nodeOrder.test.ts 双参调用入清单（v5）**：:58/:82 的 hydrateNodes 双参用例（parentMap 回填/悬空）随形参删除一并清
- **enableShutdownHooks 落地（v5 C8——spec Task 9 已登记）**：main.ts 补 `app.enableShutdownHooks();`（NestFactory.create 之后）——pm2 restart 的 SIGINT 触发 collab.gateway onApplicationShutdown → server.destroy()（runDestroy→closeConnections+flushPendingStores+等 documentsCount===0——Hocuspocus 4.6.0 源码实证一条 flush-then-unload 链）flush 内存 doc。R1b 后服务端是唯一持久化层，这一行是部署路径的承重墙。**边界登记（v6 C3）：destroy() 逐 doc unload+store+compact 可能多次 DB 往返——pm2 默认 kill_timeout 1600ms 超时即 SIGKILL（承重墙被自己人拆）——ecosystem 配置 kill_timeout 提到 10000 并本地验证一次 restart 期间的 doc flush 日志（降级而非消灭部署丢编辑）**
- **旧 localStorage key 不清扫**（无存量防护原则——`flowweb_canvas_v2_*` 残留无害；OLD_KEY_PATTERNS sweep 代码随快照层删除）

- [ ] **Step 4: 跑测试 + commit**

```bash
pnpm --filter @flowweb/web test -- --run && pnpm --filter @flowweb/web exec tsc --noEmit
```

```bash
git add -A apps/web/src
git commit -m "feat(web): 快照层退役——兜底职责归服务端 doc 持久化（R1b 方案 C 拍板；删 fillDoc seed=F35 结构性消失；6 文件删除+viewport flowweb_vp_ 另存+registry 重跑）"
```

## Task 13: 几何读侧迁移（TextInputNode + ImageGenNode）

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/TextInputNode.tsx:26-30`
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx:1008-1009/:1186-1187`
- Test: `apps/web/src/pages/canvas/components/nodes/TextInputNode.test.tsx`

- [ ] **Step 1: mock 面改造 + 失败测试（v3 修正：:44-48 的 mock 是普通箭头函数非 vi.fn——null 分支注入必须先改 vi.hoisted，先例 ImageNodeToolbar.test.tsx:4-27/:279；**v4 再修正：既有 vi.mock 工厂（:35-61）同时替换 useStore/useReactFlow/useViewport/useInternalNode/NodeResizeControl 五个符号——只把 useInternalNode 那一行换成 mocks.useInternalNode，其余四行 override 原样保留**；默认 mockImplementation 保留既有形状 `{ position: { x: 100, y: 200 }, measured: { width: 400, height: 350 } }`（position 是工具条定位相关，丢了会打挂同文件其它用例））**

mock 改造（文件顶部——vi.hoisted + 只替换目标行）：

```tsx
const mocks = vi.hoisted(() => ({ useInternalNode: vi.fn() }));
vi.mock('@xyflow/react', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  // ...其余四个 override 保持既有实现不动...
  useInternalNode: mocks.useInternalNode,   // 仅此行替换
}));
// 默认：保留既有形状（position + measured 400×350）
mocks.useInternalNode.mockImplementation(() => ({ position: { x: 100, y: 200 }, measured: { width: 400, height: 350 } }));
```

追加用例：

```tsx
it('节点尺寸来自 RF internal node（measured）——nodeStore 几何不再是来源', () => {
  const { container } = renderNode();
  const style = (container.querySelector('[class*="bg-surface"]') as HTMLElement)?.getAttribute('style') || '';
  expect(style).toContain('width: 400px');
  expect(style).toContain('height: 350px');
});

it('useInternalNode 返回 null 时兜底 300×300（v3 改写原 :280-286——迁移后 mock 恒给 measured，旧"默认 300"断言必红，翻转为本分支）', () => {
  mocks.useInternalNode.mockImplementationOnce(() => null);
  const { container } = renderNode();
  const style = (container.querySelector('[class*="bg-surface"]') as HTMLElement)?.getAttribute('style') || '';
  expect(style).toContain('width: 300px');
});
```

- [ ] **Step 2: 实现**

TextInputNode（:26-30）——几何行改 internalNode（appNode 的 data 消费保留）：

```tsx
  const internalNode = useInternalNode(id);
  const nodeWidth = internalNode?.measured?.width ?? 300;
  const nodeHeight = internalNode?.measured?.height ?? 300;
```

ImageGenNode 4 处 `?? node.position.x` / `?? node.position.y` 改 `?? 0`（node 变量孤立则清理；先例 CanvasReferenceSelectBanner:28-33）。

- [ ] **Step 3: 跑测试 + commit**

```bash
pnpm --filter @flowweb/web test -- --run src/pages/canvas/components/nodes/ && pnpm --filter @flowweb/web exec tsc --noEmit
```

```bash
git add apps/web/src/pages/canvas/components/nodes/
git commit -m "refactor(web): 几何读侧迁移——TextInputNode 改 useInternalNode+ImageGenNode 4 处 ?? 0（R1b；mock 改 vi.hoisted+vi.fn，300×300 用例翻转为 null 分支）"
```

## Task 14: 删 W7/W8 双镜像（红转绿锚改 doc 断言）+ clamp 守卫加固

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts:529-578`（clamp 守卫 + W7/W8 两块）
- Test: `apps/web/src/stores/canvasStore.test.ts`、canvasCollabRuntime.projection.test.ts（doc 断言）

- [ ] **Step 1: 红转绿用例先行（W7 删除门槛——getDoc 缝读 doc，不依赖 nodeStore 镜像）**

canvasCollabRuntime.projection.test.ts 追加：

```ts
it('W7 红转绿门槛：resize 后几何经投影进 doc——读 doc 断言 width（v5 装置：形参化直驱）', () => {
  const d = new Y.Doc();
  fillDoc(d, [], []);
  // cs 侧节点带 width 500/height 400（模拟 RF NodeResizer setAttributes→applyNodeChanges 写 cs.width——
  // canvasStore.groups.test.ts:319 既有绿用例已证 applyNodeChanges 写 width/height）
  useCanvasStore.setState({ nodes: [{ id: 't1', type: 'textInput', position: { x: 0, y: 0 }, width: 500, height: 400, data: {} } as any], edges: [] });
  syncStoreToDoc(d, Origin.LocalUser);
  expect((d.getMap('nodes').get('t1') as any).get('width')).toBe(500);
});
```

（快照层已删——resize→刷新尺寸保持的完整链路 = cs.width → 投影 → doc → 服务端持久化；本用例锁前半，刷新恢复由 Task 22 浏览器验收覆盖。）

- [ ] **Step 2: 删 W8（TD-Pos :563-578）+ 防回潮锚（值比较形态——Task 15 删字段时改写为键不存在断言，处置登记）**

canvasStore.test.ts :415-425 的 TD-Pos 用例改写：

```ts
it('onNodesChange position 不再写 nodeStore（W8 已删——几何进 doc 靠投影）', () => {
  const id = useCanvasStore.getState().addNode('video', { x: 10, y: 20 });
  useNodeStore.getState().addNode({ id, type: 'video', data: {} as any, position: { x: 10, y: 20 } } as any);
  useCanvasStore.getState().onNodesChange([
    { id, type: 'position', position: { x: 300, y: 400 }, dragging: false } as any,
  ]);
  expect(useNodeStore.getState().nodes[id].position).toEqual({ x: 10, y: 20 });  // Task 15 删字段后本行改 expect(!('position' in ...))
});
```

W8 整块删除（:563-578）。

- [ ] **Step 3: 删 W7（dimensions :549-562）+ clamp 守卫加固（v3：扩为"父宽/高任一不可用或 xMax < padding 跳过"——父宽 0 时 xMax=-(20+childW) 负夹飞实测）**

W7 整块删除。clamp 块 :529-547 改：

```ts
          const parent = byId.get(n.parentId);
          if (!parent || parent.type !== 'group' || (parent.data as any)?.groupType === 'storyboard') return n;
          const pw = parent.width ?? parent.measured?.width;
          const ph = parent.height ?? parent.measured?.height;
          const cw = n.width ?? n.measured?.width ?? 280;
          const ch = n.height ?? n.measured?.height ?? 120;
          // 组宽未知（未渲染/恢复窗口）或组比 padding+子尺寸还小（xMax<padding 退化）——跳过夹取防负坐标钉死
          if (pw == null || ph == null || pw - GROUP_PADDING - cw < GROUP_PADDING || ph - GROUP_PADDING - ch < GROUP_PADDING_TOP) return n;
```

（clampPositionToPadding 调用参数相应传 pw/ph/cw/ch。）

- [ ] **Step 4: 跑全量 store + collab 测试 + commit**

```bash
pnpm --filter @flowweb/web test -- --run src/stores/ && pnpm --filter @flowweb/web exec tsc --noEmit
```

```bash
git add apps/web/src/stores/canvasStore.ts apps/web/src/stores/canvasStore.test.ts apps/web/src/stores/canvasCollabRuntime.projection.test.ts
git commit -m "refactor(web): 删 W8(TD-Pos)+W7(dimensions) 双镜像——几何进 doc 靠投影（红转绿锚改 getDoc 读 doc）+clamp 守卫扩为不可用/退化即跳（R1b）"
```

## Task 15: AppNode 删几何三字段（**半径修正：15 处生产实参 + ~45 处测试夹具**）

**Files:**
- Modify: `apps/web/src/stores/nodeStore.ts`
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts`（applyDocToStore content → toAppNode）
- Modify: `apps/web/src/stores/canvasStore.ts`（15 处 ns.addNode 实参）
- Test: 全量 tsc 指认（含 nodeStore.test.ts:1327/:1366 真类型红——v2 未登记）

- [ ] **Step 1: 删字段 + 写侧清单一次改完（照 v3 事实表 15 处逐一）**

1a. AppNode 删 `position/width/height` 三行（保留 id/type/selected?/dragging?/data）。

1b. toAppNode 终态（nodeStore.ts）：

```ts
/** 投影记录 → AppNode 显式构造（类型删字段≠运行时 strip——直喂会带 measured/selected 等杂键，必须白名单构造）。 */
export function toAppNode(r: { id: string; type: string; data: Record<string, unknown> }): AppNode {
  return { id: r.id, type: r.type, data: r.data as NodeData };
}
```

1c. **15 处 ns.addNode 实参删 position/width/height**（:211/:294/:346/:403/:460/:839/:1044/:1047/:1165/:1169/:1384/:1508/:1515/:1593/:1600——对象字面量 excess property check 报错逐处收）；canvasStore.addNode 的 position 形参**保留**（Node position 仍需——它写 cs 侧 Node，非 AppNode）。

1d. applyDocToStore content 构造（canvasCollabRuntime :198-205）：

```ts
  useNodeStore.setState({ nodes: Object.fromEntries(nodes.map((n) => [n.id, toAppNode(n)])) });
```

（normalizeLoadedCanvas 挂载在 **Task 17** 函数就位后补——登记。）

- [ ] **Step 2: tsc 指认残留（编译错误清单逐个迁移——测试夹具 ~45 处是纯手工活：删几何字段）**

```bash
pnpm --filter @flowweb/web exec tsc --noEmit 2>&1 | head -60
```

预期：Task 13 已迁读侧；快照层已删；**nodeStore.test.ts:1327/:1366 两处真类型红**（v2 漏登记）+ canvasStore*.test 夹具摆 AppNode 带几何的删字段；canvasStore.test.ts 的 W8 防回潮锚按 Task 14 Step 2 登记改写为 `expect(!('position' in (useNodeStore.getState().nodes as any)[id])).toBe(true)`。每处现场核对真读者 vs 夹具噪音。

- [ ] **Step 3: 全量回归 + commit**

```bash
pnpm --filter @flowweb/web test -- --run && pnpm --filter @flowweb/web exec tsc --noEmit && pnpm --filter @flowweb/web lint
```

```bash
git add -A apps/web/src
git commit -m "refactor(web): AppNode 删几何三字段——nodeStore 退役几何载体（R1b；toAppNode 白名单构造+15 处写侧实参+~45 处夹具；nodeStore.test 两处类型红清偿）"
```

## Task 16: 纯几何整模块下沉 + refitGroupGeometry + shouldAutoRefit + 服务端常量并入（A2）

**Files:**
- Create: `packages/shared/src/canvas/geometry.ts` + `.test.ts`（groupLayout 整模块 + DEFAULT_CHILD_SIZE + COLLAPSED_SIZE + refitGroupGeometry + shouldAutoRefit）
- Modify: `packages/shared/src/types/group.ts`（StoryboardConfig 落此）
- Modify: `apps/web/src/utils/groupLayout.ts`（纯 re-export）、`apps/web/src/types/group.ts`（StoryboardConfig 改 re-export——**删本地声明防双份**）
- Modify: `apps/api/src/modules/storyboard/stitch.size.ts`（**删除**——STITCH_WIDTH_MAP/RATIO_MAP 并入 shared）、`stitch.consumer.ts`（改值导入）、`storyboard.constants.ts`（VALID_ASPECT_RATIOS 从 shared ASPECT_RATIO_MAP 派生）
- Modify: `apps/web/src/stores/canvasStore.ts` + `NormalGroupRenderer.tsx:44`（COLLAPSED_SIZE 接线——**现状常量不存在，两处内联 200×64**）
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: 失败测试（refitGroupGeometry 守恒/幂等——无 clamp，v11 裁决）**

```ts
import { describe, it, expect } from 'vitest';
import { refitGroupGeometry, shouldAutoRefit, COLLAPSED_SIZE, DEFAULT_CHILD_SIZE, GROUP_PADDING, GROUP_PADDING_TOP } from './geometry';

const rect = (x: number, y: number, width = 100, height = 60) => ({ x, y, width, height });

describe('refitGroupGeometry（契约 2 v11 绝对 rect——守恒，无 clamp）', () => {
  it('bbox(子)+padding == frame（双侧非对称 padding：上 50/余 20）；rel = abs − frame.origin；子绝对坐标守恒', () => {
    const children = [rect(120, 150), rect(300, 260, 80, 90), rect(150, 170, 40, 30)];
    const { frame, rels } = refitGroupGeometry(children);
    expect(frame).toEqual({ x: 120 - GROUP_PADDING, y: 150 - GROUP_PADDING_TOP,
      width: 300 + 80 + GROUP_PADDING - (120 - GROUP_PADDING), height: 260 + 90 + GROUP_PADDING - (150 - GROUP_PADDING_TOP) });
    children.forEach((c, i) => {
      expect(rels[i].x + frame.x).toBe(c.x);
      expect(rels[i].y + frame.y).toBe(c.y);
    });
  });

  it('min(rel) ≠ padding 的分布（F33 缺陷形态）守恒仍成立', () => {
    const children = [rect(0, 0), rect(200, 200)];
    const { frame, rels } = refitGroupGeometry(children);
    children.forEach((c, i) => {
      expect(rels[i].x + frame.x).toBe(c.x);
      expect(rels[i].y + frame.y).toBe(c.y);
    });
  });

  it('幂等 + N5 构造保证：rel.y ≥ GROUP_PADDING_TOP、rel.x ≥ GROUP_PADDING 恒成立（clamp 推翻后的行为锚）', () => {
    const children = [rect(50, 80), rect(260, 190, 120, 70)];
    const once = refitGroupGeometry(children);
    const twice = refitGroupGeometry(children);
    expect(twice.frame).toEqual(once.frame);
    expect(twice.rels).toEqual(once.rels);
    expect(once.rels.every((r) => r.y >= GROUP_PADDING_TOP && r.x >= GROUP_PADDING)).toBe(true);
  });

  it('小数坐标守恒（v3 补——RF 拖拽产小数，浮点还原是乒乓风险面）', () => {
    const children = [rect(100.3, 200.7), rect(250.1, 310.9, 99.6, 59.4)];
    const { frame, rels } = refitGroupGeometry(children);
    children.forEach((c, i) => {
      expect(Math.abs(rels[i].x + frame.x - c.x)).toBeLessThan(1e-9);
      expect(Math.abs(rels[i].y + frame.y - c.y)).toBeLessThan(1e-9);
    });
  });
});

describe('shouldAutoRefit（契约 2 scope 门禁）', () => {
  it('normal 展开 → true；storyboard/collapsed/manuallyResized/非组 → false', () => {
    expect(shouldAutoRefit({ type: 'group', data: { groupType: 'normal' } })).toBe(true);
    expect(shouldAutoRefit({ type: 'group', data: { groupType: 'storyboard' } })).toBe(false);
    expect(shouldAutoRefit({ type: 'group', data: { groupType: 'normal', collapsed: true } })).toBe(false);
    expect(shouldAutoRefit({ type: 'group', data: { groupType: 'normal', manuallyResized: true } })).toBe(false);
    expect(shouldAutoRefit({ type: 'imageGen', data: {} })).toBe(false);
  });
});
```

Run: `pnpm --filter @flowweb/shared test -- --run src/canvas/geometry.test.ts` → Expected: FAIL（模块不存在）

- [ ] **Step 2: 实现（整模块下沉——类型保持严格不降级；COLLAPSED_SIZE/DEFAULT_CHILD_SIZE 新建单源）**

2a. geometry.ts = groupLayout.ts 全文迁入（ASPECT_RATIO_MAP/calcStoryboardSize/calcDefaultGrid/sortNodesByPosition/calcStitchSize/clampPositionToPadding/calcGroupMinSize/calcGroupBounds/全部常量；`import type { AspectRatio } from '../types/group'`）+ 新增：

```ts
/** 子节点缺测量时的 rect 基准（`?? 280 / ?? 120` 内联单源化——sweep 必含 Task 14 clamp 守卫
 *  的 canvasStore.ts onNodesChange 内 cw/ch 两行（唯一 measured 夹在 ?? 与字面量之间的位置——漏扫留最隐蔽不同源），
 *  另含 normalizeLoadedCanvas/applyGroupFrame/addToGroup 分支 A/assertInvariant 四处派生公式点） */
export const DEFAULT_CHILD_SIZE = { width: 280, height: 120 } as const;

/** 折叠组尺寸（现状 canvasStore.ts:1262 与 NormalGroupRenderer.tsx:44 两处内联 200×64——R1b 单源化） */
export const COLLAPSED_SIZE = { width: 200, height: 64 } as const;

/** 组几何唯一重算纯函数（契约 2/§4.8 v11）：输入子节点绝对 rect，输出 frame + 每子 rel（= abs − frame.origin）。
 *  守恒：重算型调用下子绝对坐标不变（rel 随 frame 补偿）——F33 整类根修。
 *  无 clamp（v11 推翻）：frame = bbox+padding 使 rel ∈ [padding, frame−padding−size] 恒成立（数学构造保证）；
 *  拖拽期真 clamp 在 onNodesChange（帧固定时）；placement 对不 refit 组的 clamp 见 addToGroup（Task 18）。 */
export function refitGroupGeometry(
  children: { x: number; y: number; width: number; height: number }[],
): { frame: { x: number; y: number; width: number; height: number }; rels: { x: number; y: number }[] } {
  const frame = calcGroupBounds(children);
  const rels = children.map((c) => ({ x: c.x - frame.x, y: c.y - frame.y }));
  return { frame, rels };
}

/** 契约 2 scope 门禁：组框 ≡ bbox+padding 仅适用于 normal && !collapsed && !manuallyResized */
export function shouldAutoRefit(group: { type: string; data?: Record<string, unknown> }): boolean {
  const d = (group.data ?? {}) as Record<string, unknown>;
  return group.type === 'group' && d.groupType !== 'storyboard' && !d.collapsed && !d.manuallyResized;
}
```

2b. **类型迁移面（v4 修正——v3"其依赖 ASPECT_RATIOS/StoryboardConfig 均已在 shared"是假的：实测 GroupType/ASPECT_RATIOS/AspectRatio/StitchResolution/StoryboardConfig 全在 apps/web/src/types/group.ts:2-13，shared 只有 GroupNodeDataShape+GROUP_NODE_DATA_KEYS——五个符号必须一次迁入否则 tsc 红）**。shared types/group.ts 补：

```ts
export type GroupType = 'normal' | 'storyboard';
export const ASPECT_RATIOS = ['21:9', '16:9', '9:16', '3:4', '4:3', '1:1'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];
export type StitchResolution = '2K' | '4K';

/** 解析后的分镜配置（运行时/配置面）。GroupNodeDataShape.storyboard 的 aspectRatio: string 是
 *  刻意宽松（模板/克隆边界的原始数据）——两种类型勿"统一"，边界语义依赖宽松面。 */
export interface StoryboardConfig {
  aspectRatio: AspectRatio; gridRows: number; gridCols: number;
  showIndex: boolean; stitchResolution: StitchResolution;
}
```

（apps/web/src/types/group.ts 整文件变 re-export：`export * from '@flowweb/shared';` + `export type GroupNodeData = GroupNodeDataShape & Record<string, unknown>;`（F30）——消费点零改动。）

**stitch 消费点索引兼容（v4）**：shared geometry.ts 同时导出 `export const RATIO_MAP: Record<string, number> = ASPECT_RATIO_MAP;`——stitch.consumer.ts:38 的 `RATIO_MAP[d.aspectRatio]` 中 `d.aspectRatio: string`，直接用 Record<AspectRatio,...> 会 TS7053（原 stitch.size.ts 用 Record<string,...> 正是为此）。stitch.size.ts 删除，consumer 改 `import { STITCH_WIDTH_MAP, RATIO_MAP } from '@flowweb/shared'`。

2c. web utils/storyboardConfig.ts **整文件迁入 shared/src/canvas/storyboardConfig.ts**（resolveStoryboardConfig 是 Task 17 normalizeLoadedCanvas 的直接依赖，必须随迁；其依赖 ASPECT_RATIOS/StoryboardConfig 经 2b 已在 shared）。web 侧 re-export **具名列全三符号（v5——v4 只列 resolveStoryboardConfig，漏 hasStoryboardConfig（StitchButton.tsx:6/:87 守卫）与 DEFAULT_STORYBOARD_CONFIG（storyboardConfig.test.ts:3）——照抄必红）**：

```ts
export { resolveStoryboardConfig, hasStoryboardConfig, DEFAULT_STORYBOARD_CONFIG } from '@flowweb/shared';
```

web utils/groupLayout.ts 改具名 re-export（v5 C4——`export *` 兜底面过宽，未来同名冲突/门禁扫描/可读性都会踩）：

```ts
export {
  CELL_WIDTH, CELL_GAP, CONVERT_GAP, GROUP_PADDING, GROUP_PADDING_TOP,
  ASPECT_RATIO_MAP, RATIO_MAP, STITCH_WIDTH_MAP,
  calcDefaultGrid, calcStoryboardSize, calcStitchSize, sortNodesByPosition,
  calcGroupBounds, clampPositionToPadding, calcGroupMinSize,
  DEFAULT_CHILD_SIZE, COLLAPSED_SIZE, refitGroupGeometry, shouldAutoRefit, clampChildIntoGroup,
} from '@flowweb/shared';
```

web types/group.ts 同理具名（**值导出必须含 ASPECT_RATIOS——storyboardConfig.test.ts:4 与 canvasStore.storyboardConfig.test.ts:6 值导入它，只 export type 会红**）：

```ts
export {
  type GroupType, ASPECT_RATIOS, type AspectRatio, type StitchResolution, type StoryboardConfig,
} from '@flowweb/shared';
import type { GroupNodeDataShape } from '@flowweb/shared';
export type GroupNodeData = GroupNodeDataShape & Record<string, unknown>;
```

storyboard-dereref-guard 的 `.storyboard\b` 门禁扫描面扩 packages/shared/src/canvas + allowlist 加 canvas/storyboardConfig.ts（Task 17 Step 3 落地）。

2d. **stitch.size.ts 删除**（STITCH_WIDTH_MAP 并入 shared geometry——值同源）；stitch.consumer.ts:37-39 改 `import { STITCH_WIDTH_MAP, RATIO_MAP } from '@flowweb/shared'`（**v6 修正与 2b 统一：consumer:38 的 `RATIO_MAP[d.aspectRatio]` 中 aspectRatio: string——用 ASPECT_RATIO_MAP 会 TS7053，2b 已为此导出 RATIO_MAP: Record<string,number> 索引兼容别名（注释注明"API 索引兼容面，web 勿用"）**）；storyboard.constants.ts 的 VALID_ASPECT_RATIOS 改 `Object.keys(ASPECT_RATIO_MAP) as AspectRatio[]` 派生（值导入）。

2f. **clampChildIntoGroup 归属定案（v6）：落 shared geometry.ts**（Task 14 拖拽路径与 Task 18 placement 两处共用）——本 task Files/Step 2a 补创建+四条边界单测：

```ts
/** 子入组 clamp 共享守卫：组宽/高任一不可用（null/undefined）或退化（xMax < GROUP_PADDING /
 *  yMax < GROUP_PADDING_TOP——组比 padding+子尺寸还小）→ 返回原 rel 不夹（防负坐标钉死）；
 *  否则 clampPositionToPadding。Task 14 拖拽期与 Task 18 placement 期同源。 */
export function clampChildIntoGroup(
  rel: { x: number; y: number }, childSize: { width: number; height: number },
  groupSize: { width: number | null; height: number | null },
): { x: number; y: number } {
  if (groupSize.width == null || groupSize.height == null) return rel;
  const xMax = groupSize.width - GROUP_PADDING - childSize.width;
  const yMax = groupSize.height - GROUP_PADDING - childSize.height;
  if (xMax < GROUP_PADDING || yMax < GROUP_PADDING_TOP) return rel;
  return clampPositionToPadding(rel, childSize, groupSize as { width: number; height: number });
}
```

（边界单测四条：组宽 null→原样；组比子小（xMax<padding）→原样；恰好等于界→夹到界；正常→夹取生效。）

2e. canvasStore toggleCollapse（:1262）与 NormalGroupRenderer.tsx:44 的 `200, 64` 内联改 COLLAPSED_SIZE。

- [ ] **Step 3: 跑测试 + 重建 dist + commit**

```bash
pnpm --filter @flowweb/shared test -- --run && pnpm --filter @flowweb/shared build \
  && pnpm --filter @flowweb/web test -- --run src/utils/ src/stores/ && pnpm --filter @flowweb/web exec tsc --noEmit \
  && pnpm --filter @flowweb/api test -- --run src/modules/storyboard/ && pnpm --filter @flowweb/api exec tsc --noEmit
```

```bash
git add packages/shared/src apps/web/src/utils/groupLayout.ts apps/web/src/types/group.ts apps/web/src/stores/canvasStore.ts apps/web/src/pages/canvas/components/nodes/NormalGroupRenderer.tsx apps/api/src/modules/storyboard/
git commit -m "feat(shared): 纯几何整模块下沉+refitGroupGeometry 守恒纯函数+shouldAutoRefit+DEFAULT_CHILD_SIZE/COLLAPSED_SIZE 单源+stitch 常量双份收口（R1b/A2；类型不降级+小数守恒夹具+StoryboardConfig 单源防双份）"
```

## Task 17: normalizeLoadedCanvas——与 refitGroupGeometry 同一部法律（守恒归位+三守卫）

**Files:**
- Create: `packages/shared/src/canvas/normalizeLoadedCanvas.ts` + `.test.ts`
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts`（applyDocToStore 挂载——Task 15 登记点）
- Modify: `apps/web/src/types/group.ts`（F30：GroupNodeDataShape 交叉）
- Modify: `apps/web/src/utils/storyboard-dereref-guard.test.ts`（扫描面根表达式改仓根——现状 `path.resolve(process.cwd(), 'src')` 看不见 packages/shared）
- Modify: `packages/shared/src/index.ts`

**语义裁决（v3 重写——撤回 v2 "只补尺寸不动原点"）：** v2 公式（单侧 padding）与 calcGroupBounds（双侧非对称 padding）数学上不同=同一数据两份公式必漂移；且"组框是派生量，不存在作者意图可被破坏"——守恒归位（frame 原点到 bbox−padding、rel 随动、子绝对坐标不变、幂等）是让数据满足契约 2 的唯一解；不归位则 doc 里长期躺违反不变量的 frame，下一次 applyGroupFrame 组框整体跳。**collapsed/manuallyResized+savedSize 守卫补回**（useCanvasPersistence.ts:60-77 现状有——v2 丢失是功能回归）。

- [ ] **Step 1: 失败测试（v4 重写断言形态：**四条法律断言——几何期望值只许来自纯函数调用或常量，禁手算**（v3 的 145/135 手算错误连犯三次后的根治）；夹具组原点非零（(100,100)）保证判别力）**

```ts
import { describe, it, expect } from 'vitest';
import { normalizeLoadedCanvas } from './normalizeLoadedCanvas';
import { COLLAPSED_SIZE, GROUP_PADDING, GROUP_PADDING_TOP, calcGroupBounds, calcStoryboardSize, calcDefaultGrid, DEFAULT_CHILD_SIZE } from './geometry';

describe('normalizeLoadedCanvas（加载几何兜底——守恒归位，与 refitGroupGeometry 同法律）', () => {
  const childAbs = (out: any[], childId: string, groupId: string) => {
    const c = out.find((n) => n.id === childId);
    const g = out.find((n) => n.id === groupId);
    return { x: c.position.x + g.position.x, y: c.position.y + g.position.y };
  };

  it('normal 组缺宽高 → 守恒归位四法律（组原点非零夹具）', () => {
    const records: any[] = [
      { id: 'g1', type: 'group', position: { x: 100, y: 100 }, data: { groupType: 'normal' } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 5, y: 5 }, width: 100, height: 60, data: {} },
    ];
    const childrenAbs = [{ x: 105, y: 105, width: 100, height: 60 }];
    const out = normalizeLoadedCanvas(records);
    const g = out.find((n) => n.id === 'g1');
    // 法律① frame ≡ calcGroupBounds(childrenAbs)——期望值来自纯函数，非手算
    const expectFrame = calcGroupBounds(childrenAbs);
    expect({ x: g.position.x, y: g.position.y, width: g.width, height: g.height }).toEqual(expectFrame);
    // 法律② 守恒：子绝对坐标不变
    expect(childAbs(out, 'c1', 'g1')).toEqual({ x: 105, y: 105 });
    // 法律③ 幂等：f(f(x)) ≡ f(x)（v5 说明：第二跑因 g1 已有几何走早退返回原引用——本断言锁"输出已满足
    // 不变量（再跑不改）"，强证明在法律① 的 calcGroupBounds 期望上，此条是回归锚）
    const twice = normalizeLoadedCanvas(out);
    expect(twice.find((n: any) => n.id === 'g1')).toEqual(g);
    expect(twice.find((n: any) => n.id === 'c1')).toEqual(out.find((n) => n.id === 'c1'));
    // 法律④ 界：rel.x ≥ GROUP_PADDING && rel.y ≥ GROUP_PADDING_TOP（clamp 推翻后的行为锚）
    const c = out.find((n) => n.id === 'c1');
    expect(c.position.x).toBeGreaterThanOrEqual(GROUP_PADDING);
    expect(c.position.y).toBeGreaterThanOrEqual(GROUP_PADDING_TOP);
  });

  it('storyboard 组缺几何 → calcStoryboardSize(resolved cfg)；缺 storyboard 键按 calcDefaultGrid(cells.length) 派生（v5：与建组方 mergeStoryboard/convertGroup 同语义——1×1 回落与 calcDefaultGrid(4)=2×2 会给同一数据两种尺寸）', () => {
    const out = normalizeLoadedCanvas([
      { id: 's1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard', storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: false, stitchResolution: '2K' }, cells: [] } } as any,
    ]);
    const s = out.find((n: any) => n.id === 's1');
    expect(s.width).toBe(calcStoryboardSize(2, 2, '16:9').width);   // 纯函数期望
    // 无 storyboard 键：4 cells → calcDefaultGrid(4) = 2×2
    const out2 = normalizeLoadedCanvas([
      { id: 's2', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard', cells: ['a', 'b', 'c', 'd'] } } as any,
    ]);
    const s2 = out2.find((n: any) => n.id === 's2');
    expect(s2.width).toBe(calcStoryboardSize(calcDefaultGrid(4).rows, calcDefaultGrid(4).cols, '16:9').width);
  });

  it('守卫（v3 补回——现状 useCanvasPersistence:60-77 有，丢失是回归）：manuallyResized+savedSize 用 savedSize；collapsed 用 COLLAPSED_SIZE', () => {
    const out = normalizeLoadedCanvas([
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal', manuallyResized: true, savedSize: { width: 480, height: 320 } } },
      { id: 'g2', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal', collapsed: true } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 0, y: 0 }, data: {} },
    ] as any);
    expect(out.find((n: any) => n.id === 'g1').width).toBe(480);   // savedSize 赢，不 refit
    expect(out.find((n: any) => n.id === 'g2').width).toBe(COLLAPSED_SIZE.width);
  });

  it('非组/有几何组/真无子组零改变；子缺几何用 DEFAULT_CHILD_SIZE 基准（v5：期望改纯函数；补真·无子组夹具——v4 该用例名写"无子组零改变"却无此夹具，children.length===0 分支零覆盖）', () => {
    const records: any[] = [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 10, height: 10, data: { groupType: 'normal' } },
      { id: 'g2', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal' } },
      { id: 'c1', type: 'imageGen', parentId: 'g2', position: { x: 0, y: 0 }, data: {} },
      { id: 'n1', type: 'textInput', position: { x: 99, y: 99 }, data: {} },
      { id: 'gEmpty', type: 'group', position: { x: 50, y: 50 }, data: { groupType: 'normal' } },   // 真·无子组
    ];
    const out = normalizeLoadedCanvas(records);
    expect(out[0]).toEqual(records[0]);
    const expectFrame = calcGroupBounds([{ x: 0, y: 0, width: DEFAULT_CHILD_SIZE.width, height: DEFAULT_CHILD_SIZE.height }]);
    expect(out.find((n: any) => n.id === 'g2').width).toBe(expectFrame.width);
    expect(out.find((n: any) => n.id === 'g2').height).toBe(expectFrame.height);
    expect(out[3]).toEqual(records[3]);
    expect(out.find((n: any) => n.id === 'gEmpty')).toEqual(records[4]);   // 无子组不动
  });

  it('manuallyResized 但无 savedSize（v5 C3——不可达形态但堵洞）：忽略标志按派生处理', () => {
    const out = normalizeLoadedCanvas([
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal', manuallyResized: true } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 5, y: 5 }, width: 100, height: 60, data: {} },
    ] as any);
    const expectFrame = calcGroupBounds([{ x: 5, y: 5, width: 100, height: 60 }]);
    const g = out.find((n: any) => n.id === 'g1');
    expect(g.width).toBe(expectFrame.width);   // 不留"无几何组"形态
  });
});
```

Run: `pnpm --filter @flowweb/shared test -- --run src/canvas/normalizeLoadedCanvas.test.ts` → Expected: FAIL

- [ ] **Step 2: 实现（v4 修正核心：子坐标是 rel——必须加组原点转绝对 rect 喂 refitGroupGeometry（v3 漏加会把组框写到 rel 空间 (-15,-45)）；frame 写回的是绝对空间值；预计算 patch 单遍应用）**

```ts
import type { CanvasNodeRecord } from './nodeEnvelope';
import { resolveStoryboardConfig } from './storyboardConfig';   // Task 16 迁入 shared（v5：命名统一——真实函数名是 resolveStoryboardConfig，v4 的 Cfg 是笔误）
import { calcStoryboardSize, refitGroupGeometry, shouldAutoRefit, DEFAULT_CHILD_SIZE, COLLAPSED_SIZE } from './geometry';

/** 加载几何兜底：组缺 width/height 才派生（幂等——有几何早退，归位是一次性的）。
 *  与 refitGroupGeometry 同一部法律（v11 裁决）：normal 组守恒归位（子绝对 rect 喂入 → frame 绝对空间
 *  写回、rel 随动、子绝对不变）——组框是派生量，归位是满足契约 2 的唯一解。
 *  守卫：storyboard→配置型；manuallyResized+savedSize→用户尺寸；collapsed→折叠尺寸。
 *  调用方：服务端导入/clone（幂等保险）+ web applyDocToStore（加载补缺——refitExpandedGroups 的
 *  重算职责不变，本函数只处理缺几何组，两者经 shouldAutoRefit+幂等不冲突）。 */
export function normalizeLoadedCanvas(records: CanvasNodeRecord[]): CanvasNodeRecord[] {
  const patch = new Map<string, Partial<CanvasNodeRecord>>();
  for (const n of records) {
    if (n.type !== 'group' || (n.width != null && n.height != null)) continue;
    const d = n.data as Record<string, unknown>;
    if (d.groupType === 'storyboard') {
      // v5：缺 storyboard 键按 calcDefaultGrid(cells.length) 派生——与建组方同语义（1×1 回落会给同一数据两种尺寸）
      const cfg = d.storyboard
        ? resolveStoryboardConfig({ storyboard: d.storyboard })
        : { ...resolveStoryboardConfig({ storyboard: undefined }), ...calcDefaultGrid(((d.cells as string[]) ?? []).filter(Boolean).length) };
      const size = calcStoryboardSize(cfg.gridRows, cfg.gridCols, cfg.aspectRatio);
      patch.set(n.id, { width: size.width, height: size.height });
      continue;
    }
    // v5 C3：manuallyResized 需同时有 savedSize 才用用户尺寸——无 savedSize 的标志（不可达但堵洞）落到下方派生
    if (d.manuallyResized && d.savedSize && typeof d.savedSize === 'object') {
      const s = d.savedSize as { width: number; height: number };
      patch.set(n.id, { width: s.width, height: s.height });
      continue;
    }
    if (d.collapsed) {
      patch.set(n.id, { width: COLLAPSED_SIZE.width, height: COLLAPSED_SIZE.height });
      continue;
    }
    // 守卫序列已隐含 shouldAutoRefit 语义（storyboard/有效savedSize/collapsed 均已 continue）——
    // 不再调 shouldAutoRefit：它对 manuallyResized 一票否决，会把"无 savedSize 的手动组"也跳过（C3 洞）
    const children = records.filter((r) => r.parentId === n.id);
    if (children.length === 0) continue;
    const { frame, rels } = refitGroupGeometry(children.map((c) => ({
      // 关键（v4）：doc 里子的 position 是相对组的 rel——喂绝对 rect 须加组原点（applyGroupFrame 同款）
      x: c.position.x + (n.position?.x ?? 0),
      y: c.position.y + (n.position?.y ?? 0),
      width: c.width ?? DEFAULT_CHILD_SIZE.width,
      height: c.height ?? DEFAULT_CHILD_SIZE.height,
    })));
    patch.set(n.id, { position: { x: frame.x, y: frame.y }, width: frame.width, height: frame.height });
    children.forEach((c, i) => patch.set(c.id, { position: rels[i] }));   // rel 随动——子绝对不变
  }
  if (patch.size === 0) return records;
  return records.map((r) => (patch.has(r.id) ? { ...r, ...patch.get(r.id) } : r));
}
```

（守恒验证：frame.x = min(abs)−padding；子新 rel = abs−frame.x = 原rel + 组旧原点 − frame.x；子新绝对 = 新rel + frame.x = abs ✓ 位位同。）

- [ ] **Step 3: applyDocToStore 挂载 + S1 hydrate 收尾回写 + F30 + 门禁扫描面**

canvasCollabRuntime.ts applyDocToStore 的 readCanvasFromDoc 之后：

```ts
  const seeded = normalizeLoadedCanvas(nodes);
```

（hydrateNodes 与 content 构造改吃 seeded。**S1（v5 修正两处）——hydrate 收尾显式回写一次**：
① **origin 必须是新 Origin.Geometry（`'geometry-repair'`）而非 LocalUser**——canvasUndo.ts:16 trackedOrigins=Set([LocalUser])，用 LocalUser 会把几何归位写进撤销栈（Ctrl+Z 撤销的是修复不是用户编辑、captureTimeout 500 还会与相邻编辑合并、啃 STACK_LIMIT=100）。canvasUndo.ts 补 `Origin.Geometry = 'geometry-repair'`（不入 trackedOrigins——与 Origin.AutoEdge 同款模式）；onRemote 的 fromLocal 判定扩为 `[Origin.LocalUser, Origin.Geometry].includes(origin)`（Geometry 事务不触发全量重建的短路，与 AutoEdge 同位）。
② **收益论证挂对对象**：normalizeLoadedCanvas 有"缺几何才动"早退（每次 apply 只补一次）；加载期真正每轮都跑的几何维护者是 refitExpandedGroups()（canvasCollabRuntime :197 无条件重算全部 normal 展开组）——"doc 里长期躺违反不变量的 frame"靠 refit+S1 回写修复，不是 normalizeLoadedCanvas。
判据：initCollab/onRemote 的 applyDocToStore 调用后比较 pickStruct 投影前后——**引用同一性**（refit 无变化时 store 返回同引用/投影深等）即跳过；有 diff 则 `syncStoreToDoc(doc, Origin.Geometry)`。**回写须在 `useNodeStore.setState`（ns 刷新）之后**——投影对普通节点 data 是 ns 优先，先回写会把陈旧 ns data 盖回 doc（C1 数据丢失向量；Task 17 审查修复）。（测试要求：C1 回归/Geometry 不入撤销栈/S1 回写可见三用例））

web types/group.ts F30：已随 Task 16 2c 落地（GroupNodeData 交叉定义在那边）——本 task 零改动，登记引用。

storyboard-dereref-guard.test.ts：根表达式从 `path.resolve(process.cwd(), 'src')` 改仓根自定位（findRepoRoot 同款——Task 8 先例），扫描面加 packages/shared/src/canvas，allowlist 加 canvas/storyboardConfig.ts。

- [ ] **Step 4: 服务端挂载（template.service 导入写 doc 前 + video-work-clone remapIds 后——Task 20 同批落地更顺，此处登记到 Task 20 Step 3）**

- [ ] **Step 5: 跑测试 + 重建 dist + commit**

```bash
pnpm --filter @flowweb/shared test -- --run && pnpm --filter @flowweb/shared run typecheck && pnpm --filter @flowweb/shared build \
  && pnpm --filter @flowweb/web test -- --run src/utils/ src/stores/ && pnpm --filter @flowweb/web exec tsc --noEmit
```

```bash
git add packages/shared/src apps/web/src/stores/canvasCollabRuntime.ts apps/web/src/types/group.ts apps/web/src/utils/storyboard-dereref-guard.test.ts
git commit -m "feat(shared): normalizeLoadedCanvas 守恒归位——与 refitGroupGeometry 同法律+三守卫补回（storyboard/savedSize/collapsed）+applyDocToStore 挂载+F30（R1b；v2 单侧公式与 calcGroupBounds 矛盾修正）"
```

## Task 18: applyGroupFrame 唯一写者 + F33 根修（跨组守卫+epsilon+小数乒乓+placement clamp）

**DEFAULT_CHILD_SIZE sweep 补登记（Task 16 审查 I-1）：** 全仓 `?? 280/?? 120` 残留共 9 处——canvasStore 五处（:536-537 clamp 守卫 cw/ch、:799/:876/:936/:1293）由本 task 重算路径覆盖收口；**groupDrop.ts:6 是纯派生族（无 measured）——本 task 顺手改 `?? DEFAULT_CHILD_SIZE.width/height`**；GroupNode.tsx:19-20 是 `?? measured ?? 280` clamp 族（measured 夹层=纪律三例外域，与 Task 14 clamp 守卫同类）——**显式接受不收**（与 onNodesChange cw/ch 同批在 Task 18 接 clampChildIntoGroup 时统一裁决）。

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts`（applyGroupFrame + addToGroup/dropIntoGroup 迁移 + 跨组守卫）
- Modify: `apps/web/src/pages/canvas/page.test.tsx`（refitGroupBounds stub :72 删 + refitExpandedGroups mock :18 处置）
- Test: `canvasStore.groups.test.ts`、canvasCollabRuntime.projection.test.ts

- [ ] **Step 1: 失败测试（F33 夹具左上落点 + 跨组守卫红相 + 小数乒乓——先现状跑记录真红相）**

```ts
import { GROUP_PADDING, GROUP_PADDING_TOP } from '@flowweb/shared';

describe('F33——重算型守恒（左上落点才拉动 frame——右下恒绿是 v1 盲区）', () => {
  const seed = () => useCanvasStore.setState({
    nodes: [
      { id: 'g1', type: 'group', position: { x: 100, y: 100 }, width: 300, height: 250, data: { groupType: 'normal' } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', extent: 'parent', position: { x: 20, y: 50 }, width: 100, height: 60, data: {} },
    ] as any, edges: [],
  });
  const absOf = (id: string) => {
    const n = useCanvasStore.getState().nodes.find((x) => x.id === id) as any;
    const p = n.parentId ? (useCanvasStore.getState().nodes.find((x) => x.id === n.parentId) as any).position : { x: 0, y: 0 };
    return { x: n.position.x + p.x, y: n.position.y + p.y };
  };

  it('addToGroup（新成员落左上 {10,10}）：既有成员绝对坐标不变 + 新成员落点=放置点', () => {
    seed();
    useCanvasStore.setState({ nodes: [...useCanvasStore.getState().nodes,
      { id: 'c2', type: 'imageGen', position: { x: 10, y: 10 }, width: 100, height: 60, data: {} }] as any });
    const before = absOf('c1');
    useCanvasStore.getState().addToGroup('g1', 'c2');
    const g = useCanvasStore.getState().nodes.find((n) => n.id === 'g1') as any;
    expect(g.position).toEqual({ x: 10 - GROUP_PADDING, y: 10 - GROUP_PADDING_TOP });
    expect(absOf('c1')).toEqual(before);
    expect(absOf('c2')).toEqual({ x: 10, y: 10 });
  });

  it('dropIntoGroup 同款（c3 落左上 {5,15}）', () => {
    seed();
    useCanvasStore.setState({ nodes: [...useCanvasStore.getState().nodes,
      { id: 'c3', type: 'imageGen', position: { x: 5, y: 15 }, width: 100, height: 60, data: {} }] as any });
    const before = absOf('c1');
    useCanvasStore.getState().dropIntoGroup('c3', 'g1');
    expect(absOf('c1')).toEqual(before);
    expect(absOf('c3')).toEqual({ x: 5, y: 15 });
  });

  it('守卫：已在组 no-op；跨组移动先摘除（旧组 refit）再入新组（现状红：rel 被当绝对坐标双重偏移）', () => {
    seed();
    const before = JSON.stringify(useCanvasStore.getState().nodes.map((n: any) => [n.id, n.parentId, n.position]));
    useCanvasStore.getState().addToGroup('g1', 'c1');   // 已在 g1
    expect(JSON.stringify(useCanvasStore.getState().nodes.map((n: any) => [n.id, n.parentId, n.position]))).toBe(before);

    // 跨组：c1 从 g1 移到 gA
    useCanvasStore.setState({ nodes: [
      ...(useCanvasStore.getState().nodes as any[]),
      { id: 'gA', type: 'group', position: { x: 500, y: 500 }, width: 300, height: 250, data: { groupType: 'normal' } },
    ] as any });
    const absBefore = absOf('c1');
    useCanvasStore.getState().addToGroup('gA', 'c1');
    expect(absOf('c1')).toEqual(absBefore);   // 绝对坐标不变（现状：rel 当绝对用——必红）
    // 源组 g1 失去唯一子 → 空组解组（对齐删除路径语义——v4）
    expect(useCanvasStore.getState().nodes.some((n: any) => n.id === 'g1')).toBe(false);
  });

  it('不 refit 组的反向断言（v5 夹具修正——v4 落点 (210,210) 的 rel=(10,10) 在 clamp 下界 (20,50) 内被夹、与"落点=放置点"断言互斥必红。按纪律二拆两条：本条只声明"框不变"，落点选框内 padding 区外使 clamp 不触发）', () => {
    useCanvasStore.setState({ nodes: [
      { id: 'gm', type: 'group', position: { x: 200, y: 200 }, width: 600, height: 400, data: { groupType: 'normal', manuallyResized: true } },
      { id: 'k1', type: 'imageGen', position: { x: 250, y: 300 }, width: 100, height: 60, data: {} },   // rel=(50,100)——界外不触发 clamp
    ] as any, edges: [] });
    const frameBefore = JSON.stringify(['gm', useCanvasStore.getState().nodes.find((n) => n.id === 'gm')?.position, (useCanvasStore.getState().nodes.find((n) => n.id === 'gm') as any).width, (useCanvasStore.getState().nodes.find((n) => n.id === 'gm') as any).height]);
    useCanvasStore.getState().addToGroup('gm', 'k1');
    const gm = useCanvasStore.getState().nodes.find((n) => n.id === 'gm') as any;
    expect(JSON.stringify(['gm', gm.position, gm.width, gm.height])).toBe(frameBefore);   // 框一字不改
    const k1 = useCanvasStore.getState().nodes.find((n) => n.id === 'k1') as any;
    expect(k1.parentId).toBe('gm');
    expect(k1.position).toEqual({ x: 50, y: 100 });   // 落点=放置点（rel=abs−组原点）
  });

  it('clamp 生效分支（v5 独立用例——只声明"被修正"：落点 rel 在 padding 界内 → 拉回 (GROUP_PADDING, GROUP_PADDING_TOP)，用户可见行为变更已登记 spec）', () => {
    useCanvasStore.setState({ nodes: [
      { id: 'gm', type: 'group', position: { x: 200, y: 200 }, width: 600, height: 400, data: { groupType: 'normal', manuallyResized: true } },
      { id: 'k2', type: 'imageGen', position: { x: 205, y: 205 }, width: 100, height: 60, data: {} },   // rel=(5,5)——界内
    ] as any, edges: [] });
    useCanvasStore.getState().addToGroup('gm', 'k2');
    const k2 = useCanvasStore.getState().nodes.find((n) => n.id === 'k2') as any;
    expect(k2.position).toEqual({ x: GROUP_PADDING, y: GROUP_PADDING_TOP });   // 夹回界
  });
});

describe('epsilon 守卫——浮点乒乓', () => {
  it('applyGroupFrame 对 1ULP 级差异 no-op（桥 isEqual 深比较不产生新 diff）', () => {
    // 夹具（v5 补全+修正）：组 g1(0,0) normal；子 c1 rel(100.3,200.7) 100×60（小数——整数恒绿是盲区）
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 300, height: 250, data: { groupType: 'normal' } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', extent: 'parent', position: { x: 100.3, y: 200.7 }, width: 100, height: 60, data: {} },
    ] as any, edges: [] });
    const pick = () => JSON.stringify(useCanvasStore.getState().nodes
      .filter((n: any) => ['g1', 'c1'].includes(n.id))
      .map((n: any) => [n.id, n.position, n.width, n.height]));
    useCanvasStore.getState().applyGroupFrame('g1');   // 第一次：归位到不变量态（守恒——c1 绝对坐标不变）
    const afterFirst = pick();
    const st1 = useCanvasStore.getState().nodes;
    const c1AbsAfterFirst = { x: (st1.find((n: any) => n.id === 'c1') as any).position.x + (st1.find((n: any) => n.id === 'g1') as any).position.x,
                              y: (st1.find((n: any) => n.id === 'c1') as any).position.y + (st1.find((n: any) => n.id === 'g1') as any).position.y };
    useCanvasStore.getState().applyGroupFrame('g1');   // 第二次：几何已满足不变量 → epsilon 内 no-op
    expect(pick()).toBe(afterFirst);   // 位位同（1ULP 抖动不产生新写——桥 isEqual 不见 diff，乒乓消失）
    const st2 = useCanvasStore.getState().nodes;
    expect({ x: (st2.find((n: any) => n.id === 'c1') as any).position.x + (st2.find((n: any) => n.id === 'g1') as any).position.x,
             y: (st2.find((n: any) => n.id === 'c1') as any).position.y + (st2.find((n: any) => n.id === 'g1') as any).position.y })
      .toEqual(c1AbsAfterFirst);   // 守恒锚（v6 补断言——首次 refit 前后子绝对坐标也应相等：100.3/200.7）
  });
});
```

**先在现状代码跑一遍记录真红相**（预期：F33 前两条红（c1 平移 δ）、已在组 no-op 现状可能红（无守卫）、跨组必红（双重偏移））。

- [ ] **Step 2: 实现（applyGroupFrame + epsilon + 事务内直调纯函数 + 跨组摘除）**

2a. canvasStore 新增：

```ts
  /** 组几何唯一写者（§4.8 v11）——重算型入口。守卫：分镜组走配置型出口；shouldAutoRefit=false
   *  （折叠/手动）no-op。epsilon：|Δ|<1e-6 不写（RF 小数坐标 1ULP 抖动防桥乒乓）。 */
  applyGroupFrame: (groupId: string) => {
    const s = get();
    const group = s.nodes.find((n) => n.id === groupId);
    if (!group || !shouldAutoRefit(group)) return;
    const children = s.nodes.filter((n) => n.parentId === groupId);
    if (children.length === 0) return;
    const { frame, rels } = refitGroupGeometry(
      children.map((n) => ({
        x: n.position.x + group.position.x, y: n.position.y + group.position.y,
        width: n.width ?? DEFAULT_CHILD_SIZE.width,      // v6 纪律三：无 measured——与 normalizeLoadedCanvas/assertInvariant 一字不差同源
        height: n.height ?? DEFAULT_CHILD_SIZE.height,
      })),
    );
    const EPS = 1e-6;
    const moved = Math.abs(group.position.x - frame.x) > EPS || Math.abs(group.position.y - frame.y) > EPS
      || Math.abs((group.width ?? 0) - frame.width) > EPS || Math.abs((group.height ?? 0) - frame.height) > EPS;
    if (!moved && children.every((c, i) => Math.abs(c.position.x - rels[i].x) <= EPS && Math.abs(c.position.y - rels[i].y) <= EPS)) return;
    set((st) => ({
      nodes: st.nodes.map((n) => {
        if (n.id === groupId) return { ...n, position: { x: frame.x, y: frame.y }, width: frame.width, height: frame.height };
        const i = children.findIndex((c) => c.id === n.id);
        return i === -1 ? n : { ...n, position: rels[i] };
      }),
    }));
  },
```

2b. addToGroup/dropIntoGroup 迁移（**v4 修正：placement 显式两分支**——shouldAutoRefit 组走守恒 refit（组框写新 frame）；**不 refit 组（manuallyResized/collapsed）组框一字不改**，新子 rel 直接 `abs − 组原点` 再过 clampPositionToPadding（**clamp 用组实际尺寸 group.width/height，非重算 frame**——v3 版本在此违反自己立的不变量：无条件写 frame 会覆盖用户手动/折叠尺寸）。跨组守卫：node.parentId != null 且 ≠ 目标组 → 先还原绝对坐标；源组失去最后子 → ungroup（对齐删除路径语义）：

```ts
  addToGroup: (groupId, nodeId) => {
    const s = get();
    const group = s.nodes.find((n) => n.id === groupId);
    const node = s.nodes.find((n) => n.id === nodeId);
    if (!group || !node || node.type === 'group' || node.parentId === groupId) return;  // 已在组 no-op
    const gp = group.position;
    // 跨组：node.position 是相对旧父的 rel——先还原绝对坐标（现状当绝对用是双重偏移根源）
    let absX = node.position.x, absY = node.position.y;
    const oldParent = node.parentId ? s.nodes.find((n) => n.id === node.parentId) : undefined;
    if (oldParent && node.parentId !== groupId) {
      absX += oldParent.position.x; absY += oldParent.position.y;
    }
    const childSize = { width: node.width ?? DEFAULT_CHILD_SIZE.width,      // v6 纪律三：无 measured
                        height: node.height ?? DEFAULT_CHILD_SIZE.height };
    const auto = shouldAutoRefit(group);
    setWithParentOrder((st) => {
      if (!auto) {
        // 分支 B（v5）：不 refit 组——组框一个字节不写；新子 rel=abs−组原点，过 clampChildIntoGroup
        //（共享守卫：组宽高不可用/退化时跳过夹取——clampPositionToPadding 直传 group.width??0 会负夹飞，
        //  与 Task 14 拖拽路径的守卫同源，见下方 clampChildIntoGroup）
        const clamped = clampChildIntoGroup(
          { x: absX - gp.x, y: absY - gp.y }, childSize,
          { width: group.width, height: group.height },
        );
        return {
          nodes: st.nodes.map((n) =>
            n.id === nodeId ? { ...n, parentId: groupId, extent: 'parent' as const, position: clamped } : n),
        };
      }
      // 分支 A：守恒 refit（既有成员绝对不变——F33 根修）
      const siblings = st.nodes.filter((n) => n.parentId === groupId || n.id === nodeId);
      const { frame, rels } = refitGroupGeometry(
        siblings.map((n) => ({
          x: n.id === nodeId ? absX : n.position.x + gp.x,
          y: n.id === nodeId ? absY : n.position.y + gp.y,
          width: n.width ?? DEFAULT_CHILD_SIZE.width,       // v6 纪律三：无 measured
          height: n.height ?? DEFAULT_CHILD_SIZE.height,
        })),
      );
      return {
        nodes: st.nodes.map((n) => {
          if (n.id === nodeId) return { ...n, parentId: groupId, extent: 'parent' as const, position: rels[siblings.findIndex((sm) => sm.id === nodeId)] };
          if (n.id === groupId) return { ...n, position: { x: frame.x, y: frame.y }, width: frame.width, height: frame.height };
          const i = siblings.findIndex((sm) => sm.id === n.id);
          return i === -1 ? n : { ...n, position: rels[i] };   // 既有成员 rel 补偿——绝对坐标不变（F33）
        }),
      };
    });
    if (oldParent && node.parentId !== groupId && oldParent.type === 'group') {
      // 源组善后（v5）：失去最后子 → 强制解组（ungroupForce——ungroup 的 hasActiveProcessInGroup 早退
      //  会留空组，与删除路径语义不一致；跨组移走的意图不可被吞）；仍有子 → applyGroupFrame 收缩
      if (!get().nodes.some((c) => c.parentId === oldParent.id)) get().ungroupForce(oldParent.id);
      else get().applyGroupFrame(oldParent.id);
    }
    get().applyGroupDerivations();
  },
```

（dropIntoGroup 同款两分支——折叠态先展开的原逻辑保留；守卫同加。**clampChildIntoGroup（v5 抽公共——两处共用守卫）**：落 shared geometry.ts 或 web utils——内部先判 `groupSize.width/height 任一 null/undefined 或 xMax < GROUP_PADDING 或 yMax < GROUP_PADDING_TOP → 返回原 rel`（退化跳过），否则 clampPositionToPadding；**Task 14 拖拽路径的 clamp 块同改调它**（替换 :529-547 的内联守卫）。ungroupForce = ungroup 去掉 hasActiveProcessInGroup 早退的变体（内部提取公共函数，两 action 共享）。）

- [ ] **Step 2c（v5 新增）: 几何不变量 store 级单测（C5——从 Task 22 浏览器验收下沉，可回归的才是 proof）**

canvasStore.groups.test.ts 追加（对全部重算型命令各跑一遍——比字符串门禁有意义的不变量断言）：

```ts
describe('几何不变量（§4.8——每个重算型命令后 frame ≡ calcGroupBounds(childrenAbs) ∧ rel ≥ padding）', () => {
  const assertInvariant = () => {
    const nodes = useCanvasStore.getState().nodes as any[];
    for (const g of nodes.filter((n) => n.type === 'group' && shouldAutoRefit(n))) {
      const children = nodes.filter((n) => n.parentId === g.id);
      const abs = children.map((c) => ({ x: c.position.x + g.position.x, y: c.position.y + g.position.y,
        width: c.width ?? DEFAULT_CHILD_SIZE.width, height: c.height ?? DEFAULT_CHILD_SIZE.height }));
      expect({ x: g.position.x, y: g.position.y, width: g.width, height: g.height })
        .toEqual(calcGroupBounds(abs));   // 期望来自纯函数
      children.forEach((c) => {
        expect(c.position.x).toBeGreaterThanOrEqual(GROUP_PADDING);
        expect(c.position.y).toBeGreaterThanOrEqual(GROUP_PADDING_TOP);
      });
    }
  };
  // v6：六条显式 it（装置同构——下面给完整模板，其余按命令替换执行行）
  const seedTwoNodes = () => useCanvasStore.setState({ nodes: [
    { id: 'a', type: 'imageGen', position: { x: 100, y: 150 }, width: 100, height: 60, data: {} },
    { id: 'b', type: 'imageGen', position: { x: 300, y: 260 }, width: 80, height: 90, data: {} },
  ] as any, edges: [] });

  it('groupNodes 后不变量成立', () => {
    seedTwoNodes();
    useCanvasStore.getState().groupNodes(['a', 'b']);
    assertInvariant();
  });
  it('addToGroup 后不变量成立', () => {
    seedTwoNodes();
    useCanvasStore.getState().groupNodes(['a', 'b']);
    useCanvasStore.setState({ nodes: [...useCanvasStore.getState().nodes,
      { id: 'c', type: 'imageGen', position: { x: 40, y: 60 }, width: 60, height: 40, data: {} }] as any });
    useCanvasStore.getState().addToGroup(useCanvasStore.getState().nodes.find((n: any) => n.type === 'group')!.id, 'c');
    assertInvariant();
  });
  it('dropIntoGroup 后不变量成立', () => { /* 同 addToGroup，执行行换 dropIntoGroup('c', gid) */ });
  it('removeNodeFromGroup 后不变量成立', () => { /* groupNodes 后 removeNodeFromGroup(gid,'a') → assertInvariant() */ });
  it('ungroup(normal) 后子绝对坐标还原（无组——不变量空集）', () => {
    seedTwoNodes();
    const gid = useCanvasStore.getState().groupNodes(['a', 'b']);
    const absBefore = { a: { x: 100, y: 150 }, b: { x: 300, y: 260 } };
    useCanvasStore.getState().ungroup(gid);
    const st = useCanvasStore.getState().nodes as any[];
    expect({ x: st.find((n) => n.id === 'a')!.position.x, y: st.find((n) => n.id === 'a')!.position.y }).toEqual(absBefore.a);
    expect({ x: st.find((n) => n.id === 'b')!.position.x, y: st.find((n) => n.id === 'b')!.position.y }).toEqual(absBefore.b);
  });
  it('convertGroup 两方向后不变量成立', () => { /* groupNodes→convertGroup(gid,'storyboard')→assertInvariant（storyboard 组不在 shouldAutoRefit 域，断言空集）→convertGroup(gid,'normal')→assertInvariant() */ });
});
```

2c. 调用点迁移：convertGroup→normal :1228、**toggleCollapse 展开分支 :1279（v5 B2 发现冻结链→v6 修正三分派——分镜组框的真理是配置（savedSize 是"折叠前尺寸"，折叠期间配置被远端改动会展开成旧尺寸——savedSize 仅服务 manuallyResized 的 normal 组）：① manuallyResized&&savedSize → applyGroupFrameRect(savedSize)；② storyboard → applyGroupFrameRect(calcStoryboardSize(resolveStoryboardConfig(gd)))——不用 savedSize；③ 其余（含 manuallyResized 无 savedSize 的堵洞档——落 applyGroupFrame 会被 shouldAutoRefit 一票否决又冻 200×64）→ applyGroupFrameRect(calcGroupBounds(childrenAbs))（展开前子 rel 未动，守恒自动成立，彻底不依赖 shouldAutoRefit 时点）。**补 collapse→expand 往返用例（normal 与 storyboard 各一——断言展开后 frame 恢复）**）**、removeNodeFromGroup（移出后补 refit——v3 新增 G1）、**deleteNode/onNodesChange removes 删子后补 refit**（G1——普通组删子组框收缩）、refitExpandedGroups（canvasCollabRuntime :308-315 改调 applyGroupFrame——分镜组经守卫自动跳过）。

2d. **删 refitGroupBounds（:1286-1302）**——接口+实现+**4 调用点**（convertGroup:1228/toggleCollapse:1279/refitExpandedGroups:313/useCanvasPersistence:75——最后一个已随 Task 12 删除）逐一迁移；page.test.tsx :72 stub 删、:18 refitExpandedGroups mock 保留（函数仍在）；grep 零残留。

- [ ] **Step 3: 协作乒乓断言（小数坐标夹具——整数恒绿是盲区）**

canvasCollabRuntime.projection.test.ts 追加：

```ts
it('远程 apply → refit 守恒 → bridge diff 为零（小数坐标——不再互相推漂）', async () => {
  // 装置：小数坐标组夹具（子 abs (100.3, 200.7)）→ applyDocToStore → refitExpandedGroups →
  // 断言：storeProjection 输出与 apply 前逐节点深等（守恒+epsilon 使 refit 不产生新 diff）
});
```

- [ ] **Step 4: 跑测试 + commit**

```bash
pnpm --filter @flowweb/web test -- --run src/stores/ src/pages/canvas/ && pnpm --filter @flowweb/web exec tsc --noEmit
```

```bash
git add apps/web/src/stores/canvasStore.ts apps/web/src/stores/canvasCollabRuntime.ts apps/web/src/stores/canvasStore.groups.test.ts apps/web/src/stores/canvasCollabRuntime.projection.test.ts apps/web/src/pages/canvas/page.test.tsx
git commit -m "fix(web): applyGroupFrame 唯一写者+F33 根修（左上夹具）+跨组守卫（先摘除+源组 refit）+epsilon 防浮点乒乓+placement clamp 封堵 N5 搬家+删 refitGroupBounds（R1b/§4.8 v11）"
```

## Task 19: F38 整类——解散保留子尺寸 + pitch=max 异构不重叠

**Files:**
- Modify: `apps/web/src/utils/groupGeometry.ts`（新建文件——placeGrid 纯函数 + `.test.ts`）
- Modify: `apps/web/src/stores/canvasStore.ts:856-863/:1214-1226`
- Test: `canvasStore.storyboardConfig.test.ts`（F38 基线断言翻转）

- [ ] **Step 1: 翻转 F38 基线用例（现状跑记录红相——现状强制 320 覆盖必红）**

```ts
it('【F38 已修】ungroup 保留子节点自身尺寸（原 500×400 不被覆盖 320）', () => {
  useCanvasStore.setState({ nodes: [
    { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard', cells: [null, 'img1'] } },
    { id: 'img1', type: 'imageGen', position: { x: 0, y: 0 }, parentId: 'g1', width: 500, height: 400, data: {} },
  ] as any, edges: [] });
  useCanvasStore.getState().ungroup('g1');
  const img = useCanvasStore.getState().nodes.find((n) => n.id === 'img1') as any;
  expect(img.width).toBe(500);
  expect(img.height).toBe(400);
  expect(img.parentId).toBeUndefined();
});

it('【F38 已修】convertGroup→normal 保留子尺寸+异构不重叠（pitch=max(自身,基准)）', () => {
  useCanvasStore.setState({ nodes: [
    { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 800, height: 600, data: { groupType: 'storyboard', cells: ['wide', 'img2'], storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 1, showIndex: false, stitchResolution: '2K' } } },
    { id: 'wide', type: 'imageGen', position: { x: 0, y: 0 }, parentId: 'g1', width: 500, height: 300, data: {} },
    { id: 'img2', type: 'imageGen', position: { x: 0, y: 0 }, parentId: 'g1', width: 320, height: 180, data: {} },
  ] as any, edges: [] });
  useCanvasStore.getState().convertGroup('g1', 'normal');
  const st = useCanvasStore.getState().nodes as any[];
  const wide = st.find((n) => n.id === 'wide');
  const img2 = st.find((n) => n.id === 'img2');
  expect(wide.width).toBe(500);
  expect(img2.position.y).toBeGreaterThanOrEqual(wide.position.y + wide.height + CONVERT_GAP - 1);
});
```

- [ ] **Step 2: 实现（placeGrid 纯函数——rowIds 与实际子节点求交 + sizeOf 回落基准）**

apps/web/src/utils/groupGeometry.ts：

```ts
import { CONVERT_GAP } from '@flowweb/shared';

/** 解散类网格重排（F38 v9 spacing）：行/列 pitch = max(成员自身尺寸, 基准)——异构不重叠。
 *  v5 槽位语义（与现状 ungroup/convertGroup 的 cells.indexOf(n.id) 槽位布局一致）：
 *  **保留槽位**——null 空宫格与悬空 id 都按基准尺寸占格（空槽不塌陷），后续节点不被提前；
 *  sizeOf 未知 id 回落基准（占格后 pos 里无该 id 输出——不产生坐标但占位）。 */
export function placeGrid(
  ids: (string | null)[], gridCols: number, cellW: number, cellH: number,
  sizeOf: (id: string) => { width: number; height: number },
): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const slotOf = (v: string | null) => v == null
    ? { width: cellW, height: cellH }                    // null 占位：基准尺寸占格
    : sizeOf(v);                                          // 悬空 id：sizeOf 回落基准（同占格）
  let y = 0;
  for (let r = 0; r * gridCols < ids.length; r++) {
    const row = ids.slice(r * gridCols, (r + 1) * gridCols);
    const rowH = Math.max(cellH, ...row.map(slotOf).map((s) => s.height));
    let x = 0;
    for (const v of row) {
      if (v != null) pos.set(v, { x, y });
      x += Math.max(cellW, slotOf(v).width) + CONVERT_GAP;   // 每槽都推进——空槽不塌陷
    }
    y += rowH + CONVERT_GAP;
  }
  return pos;
}
```

ungroup storyboard 分支与 convertGroup→normal 的子节点 map 改：删 `width: CELL_WIDTH, height: Math.round(cellH)` 覆盖，position 从 placeGrid 取。**sizeOf 契约（v6 V2 写死——槽位语义下 placeGrid 必然对无节点 id 调 sizeOf，防御实现防 TypeError）**：

```ts
const byId = new Map(nodes.map((n) => [n.id, n]));
const sizeOf = (id: string): { width: number; height: number } => {
  const n = byId.get(id) as any;
  return n ? { width: n.width ?? CELL_WIDTH, height: n.height ?? cellH } : { width: CELL_WIDTH, height: cellH };
};
```

**placeGrid 直接单测（v6 补——新纯函数此前零单测）**：① null 槽不塌陷（[a, null, b] 3 列 → b 的 x = 2*(CELL_WIDTH+CONVERT_GAP) 而非 1 槽位）；② 悬空 id 占格但 pos 无该 id 输出；③ 异构尺寸 pitch=max（500 宽节点同行 320 节点 → 行高=max(300,180)）。

- [ ] **Step 3: 跑测试 + commit**

```bash
pnpm --filter @flowweb/web test -- --run src/stores/ src/utils/groupGeometry.test.ts
```

```bash
git add apps/web/src/stores/canvasStore.ts apps/web/src/stores/canvasStore.storyboardConfig.test.ts apps/web/src/utils/groupGeometry.ts apps/web/src/utils/groupGeometry.test.ts
git commit -m "fix(web): F38 整类——解散保留子尺寸+placeGrid pitch=max 异构不重叠+空槽保留槽位（v5——null/悬空按基准占格不塌陷，与 cells.indexOf 槽位语义一致；R1b；基线断言翻转）"
```

## Task 20: 配置型收口 + 复制型例外 + cells 悬空 + normalizeLoadedCanvas 服务端挂载 + 写点门禁

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts`（mergeStoryboard/convertGroup→storyboard/updateStoryboardConfig/resizeStoryboardGrid 走 applyGroupFrameRect；buildGroupCopy:1470/rebuildFromClipboard:1555 的 `|| id` 改 `?? null`；resizeStoryboardGrid 溢出旧 gw 修正）
- Modify: `apps/api/src/modules/project/project.service.ts` + `video-work-clone.service.ts`（normalizeLoadedCanvas 挂载——Task 17 Step 4 登记点）
- Create: `apps/web/src/utils/group-frame-writer-guard.test.ts`
- Test: `canvasStore.groups.test.ts`（复制型例外断言完整版）

- [ ] **Step 1: applyGroupFrameRect（配置型唯一出口——分镜展开的正确出口）**

```ts
  /** 配置型唯一出口（§4.8 v11）：frame 由 calcStoryboardSize 等配置公式算得，直写组框（无守恒语义）。 */
  applyGroupFrameRect: (groupId, frame) => {
    set((st) => ({
      nodes: st.nodes.map((n) =>
        n.id === groupId ? { ...n, position: { x: frame.x, y: frame.y }, width: frame.width, height: frame.height } : n),
    }));
  },
```

四处配置型调用点：组节点 map 内的 width/height/position 写入拆出 → `applyGroupFrameRect(gid, frame)`（中心锚定逻辑保留在各调用点算 cx/cy）。**resizeStoryboardGrid 溢出坐标修正**（旧 gw 在同事务组已改宽）：溢出 x 改用 `gp.x + size.width + 20`（新宽）。**事务原子性取舍登记（S2 裁决定案——v5 B2）**：若拆出导致 setWithParentOrder 拆两次 setState（子 rel 归零与组框分写闪烁），允许配置型四处保持原事务结构、块内 frame 计算引 calcStoryboardSize 单源。**applyGroupFrameRect 保留——消费者定案：toggleCollapse 展开分支的 savedSize 恢复与分镜组展开（Task 18 2c 三分派）**，不再是"无消费者则删"的悬空裁决。门禁目标是重算型直写零命中，配置型无守恒问题。

- [ ] **Step 2: 复制型例外断言（完整版）+ cells 悬空修复**

```ts
describe('复制型几何例外（§4.8 登记——frame 继承源组±offset，不走重算）', () => {
  it('duplicateGroup 副本 frame=源 frame+offset；cells 重映射后无悬空旧 id（|| id 兜底改 ?? null）', () => {
    // v6 夹具修正：groupType 必须是 'storyboard'——buildGroupCopy:1459/1469 的 cells 重映射只在
    // isStoryboard 分支（normal 组 structuredClone 原样带过 cells → 断言必红且现状也红=判别力零；
    // 且 normal 组带 cells 本身是语义非法输入）
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', position: { x: 100, y: 100 }, width: 300, height: 250,
        data: { groupType: 'storyboard', cells: ['c1', 'ghost'],
                storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: false, stitchResolution: '2K' } } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 0, y: 0 }, data: { status: 'done', fileId: 'f1' } },
    ] as any, edges: [] });
    useCanvasStore.getState().duplicateGroup('g1');
    const st = useCanvasStore.getState().nodes;
    const copy = st.find((n: any) => n.id !== 'g1' && n.type === 'group') as any;
    expect(copy.position).toEqual({ x: 140, y: 100 });
    expect(copy.width).toBe(300);
    expect(copy.data.cells.some((c: string | null) => c === 'c1')).toBe(false);
    expect(copy.data.cells.some((c: string | null) => c === 'ghost')).toBe(false);
    expect((copy.data.cells as (string | null)[]).filter((c) => c == null).length).toBeGreaterThan(0);
  });
});
```

实现：buildGroupCopy:1470/rebuildFromClipboard:1555 的 `idMap.get(id) || id` 改 `idMap.get(id) ?? null`（与 clone remapIds 红线同款）。

- [ ] **Step 3: normalizeLoadedCanvas 服务端挂载（幂等保险登记——非补齐依赖；浏览器 applyDocToStore 已挂同一函数）**

project.service（模板导入写 doc 前）与 video-work-clone（remapIds 后）各插：

```ts
const seeded = normalizeLoadedCanvas(nodes as any);
```

（API 补一条单测：带几何输入过 normalizeLoadedCanvas 输出深等——幂等保险非补齐依赖。）

- [ ] **Step 4: 几何写者门禁（tripwire 化重写——v3：删恒真断言，补空集自证+仓根定位，基线数字"先跑现状再写死"）**

```ts
import { readFileSync } from 'fs';
import * as path from 'path';
import { existsSync } from 'fs';

function findRepoRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(cur, 'pnpm-workspace.yaml'))) return cur;
    cur = path.dirname(cur);
  }
  throw new Error('repo root not found');
}
const FILE = path.join(findRepoRoot(process.cwd()), 'apps/web/src/stores/canvasStore.ts');

describe('组几何写点门禁（R1b/§4.8 v11——tripwire ≠ proof：行为证明靠 Task 18 守恒/幂等/rel 界断言）', () => {
  it('refitGroupBounds 零残留', () => {
    expect(readFileSync(FILE, 'utf8')).not.toMatch(/refitGroupBounds/);
  });

  it('refitGroupGeometry 调用仅出现在函数级允许清单内（v4：按函数声明行分块判定，替代脆弱的全文件硬计数——第 4 个合法调用点不再误红）', () => {
    const src = readFileSync(FILE, 'utf8');
    const lines = src.split('\n');
    const ALLOW_FN = new Set(['applyGroupFrame:', 'addToGroup:', 'dropIntoGroup:']);
    // 函数声明行形态 "  name: (…) => {"（store 工厂两空格缩进）——块从声明行到下一个声明行
    const declRe = /^  ([a-zA-Z]+):/;
    const offenders: string[] = [];
    let currentFn = '<preamble>';
    for (const line of lines) {
      const m = declRe.exec(line);
      if (m) currentFn = m[1] + ':';
      if (line.includes('refitGroupGeometry(') && !ALLOW_FN.has(currentFn)) offenders.push(currentFn);
    }
    expect(offenders).toEqual([]);
  });

  it('折叠尺寸直写仅 COLLAPSED_SIZE 一处（200×64 字面量零命中——两处内联已单源化）', () => {
    const src = readFileSync(FILE, 'utf8');
    expect(src).not.toMatch(/width:\s*200,\s*height:\s*64/);
    expect(src.includes('COLLAPSED_SIZE')).toBe(true);
  });
});
```

红相实证：groupNodes 实现里临时加直写 `width: 999` + `refitGroupGeometry(` 多一处 → 第 2 条红 → 删 → 绿（记入 commit）。

- [ ] **Step 5: 跑测试 + commit**

```bash
pnpm --filter @flowweb/web test -- --run src/utils/group-frame-writer-guard.test.ts src/stores/ \
  && pnpm --filter @flowweb/api test -- --run src/modules/video-work/ src/modules/project/
```

```bash
git add apps/web/src/stores/canvasStore.ts apps/web/src/utils/group-frame-writer-guard.test.ts apps/web/src/stores/canvasStore.groups.test.ts apps/api/src/modules/project/project.service.ts apps/api/src/modules/video-work/video-work-clone.service.ts
git commit -m "refactor: 配置型 applyGroupFrameRect 收口+复制型完整断言+cells ?? null+溢出新宽+normalizeLoadedCanvas 服务端挂载+写点门禁 tripwire 化（R1b/§4.8 v11；红相实证）"
```

## Task 21: validateParentGraph 两档（导入档前移 remap 前 + 覆盖面扩 + 环去重）

**Files:**
- Create: `packages/shared/src/canvas/validateParentGraph.ts` + `.test.ts`
- Modify: `packages/shared/src/index.ts`、`apps/api/src/modules/template/template.service.ts`、`apps/api/src/modules/video-work/video-work-clone.service.ts`
- Test: template.service.spec.ts、video-work-clone.service.spec.ts

**校验时机（v3 钉死——v4 措辞修正+剪枝同批）：** 导入档校验必须在**跨用户过滤（buildFilteredSnapshot 剥 __ephemeral 节点/剪边）之前、remap 之前**——过滤剥掉 __ephemeral 节点后，引用它们的 cells 变悬空（挂过滤后合法公开模板被 400 假拒）；remap 会把悬空折 undefined（挂 remap 后 dangling 恒 0 假绿）。**剪枝同批修（v4）**：校验通过≠落盘干净——buildFilteredSnapshot 的 cells 是值透传不剪（snapshot-filter.util.ts:117/:136-144），过滤本身仍会造出悬空 cells 写进 doc（刚在入口守住的不变量在下一行被破坏）。修法对齐 clone 路径先例（video-work-clone.service.ts:73-78 的 remapIds 已做 cells 清理）：buildFilteredSnapshot 对 dropped 集合同步清 cells（`cells.map(c => dropped.has(c) ? null : c)`）。

- [ ] **Step 1: 失败测试（扩面：non-group-parent/dangling-edge/cells 引用/环去重）**

```ts
import { describe, it, expect } from 'vitest';
import { validateParentGraph } from './validateParentGraph';

const n = (id: string, parentId?: string | null, type = 't') =>
  ({ id, type, parentId: parentId ?? undefined, position: { x: 0, y: 0 }, data: {} });

describe('validateParentGraph（F39 两档）', () => {
  it('导入档：dangling/cycle/nested-group/non-group-parent 各 violation', () => {
    expect(validateParentGraph([n('a', 'ghost')], 'import').violations.some((v) => v.kind === 'dangling')).toBe(true);
    expect(validateParentGraph([n('a', 'b'), n('b', 'a')], 'import').violations.some((v) => v.kind === 'cycle')).toBe(true);
    expect(validateParentGraph([n('g2', 'g1', 'group'), n('g1', undefined, 'group')], 'import').violations.some((v) => v.kind === 'nested-group')).toBe(true);
    expect(validateParentGraph([n('c1', 'n0'), n('n0')], 'import').violations.some((v) => v.kind === 'non-group-parent')).toBe(true);
  });

  it('导入档：cells 引用完整性（悬空 cell→violation；null 占位合法）', () => {
    const nodes = [
      { ...n('g1', undefined, 'group'), data: { cells: ['ok', 'ghost', null] } },
      n('ok', 'g1'),
    ] as any;
    const v = validateParentGraph(nodes, 'import').violations;
    expect(v.some((x) => x.kind === 'dangling-cell')).toBe(true);
    expect(validateParentGraph([{ ...n('g2', undefined, 'group'), data: { cells: [null] } } as any], 'import').violations).toEqual([]);
  });

  it('导入档：边端点悬空→violation', () => {
    const r = validateParentGraph([n('a')], 'import', [{ id: 'e1', source: 'a', target: 'ghost' } as any]);
    expect(r.violations.some((v) => v.kind === 'dangling-edge')).toBe(true);
  });

  it('环去重：N 节点一个环 = 1 条 violation（v3——原设计整链各报一条）', () => {
    const v = validateParentGraph([n('a', 'b'), n('b', 'c'), n('c', 'a')], 'import').violations;
    expect(v.filter((x) => x.kind === 'cycle')).toHaveLength(1);
  });

  it('clone 档：只报 cycle——悬空/嵌套不报（红线行为锁）；合法图零 violations', () => {
    expect(validateParentGraph([n('a', 'ghost')], 'clone').violations).toEqual([]);
    expect(validateParentGraph([n('g1', undefined, 'group'), n('c1', 'g1')], 'import').violations).toEqual([]);
  });
});
```

- [ ] **Step 2: 实现（环检测代表节点去重——STATE 三色标记，环首节点入 violations）**

```ts
export interface ParentGraphViolation { kind: 'dangling' | 'cycle' | 'nested-group' | 'non-group-parent' | 'dangling-cell' | 'dangling-edge'; id: string }

/** parentId/edges/cells 结构校验（F39 v8 收窄 + v11 时机前移）。
 *  导入档校验时机 = 跨用户过滤之前、remap 之前（remap 把悬空折 undefined——挂后 dangling 恒 0 假绿；
 *  过滤剪边不碰 cells——挂后合法模板 cells 变悬空假拒）。
 *  clone 档 = remap 之后，只检环（环挂死 RF；悬空是服务端剥除的可达真实状态——降级红线）。 */
export function validateParentGraph(
  nodes: { id: string; type: string; parentId?: string | null; data?: Record<string, unknown> }[],
  mode: 'import' | 'clone',
  edges: { id: string; source: string; target: string }[] = [],
): { violations: ParentGraphViolation[] } {
  const byId = new Map(nodes.map((nd) => [nd.id, nd]));
  const violations: ParentGraphViolation[] = [];
  if (mode === 'import') {
    for (const nd of nodes) {
      if (nd.parentId != null && !byId.has(nd.parentId)) violations.push({ kind: 'dangling', id: nd.id });
      else if (nd.parentId != null && byId.get(nd.parentId)?.type !== 'group') violations.push({ kind: 'non-group-parent', id: nd.id });
      if (nd.type === 'group' && nd.parentId != null && byId.get(nd.parentId)?.type === 'group') violations.push({ kind: 'nested-group', id: nd.id });
      const cells = nd.data?.cells;
      if (nd.type === 'group' && Array.isArray(cells)) {
        for (const c of cells) if (c != null && !byId.has(c as string)) violations.push({ kind: 'dangling-cell', id: nd.id });
      }
    }
    for (const e of edges) {
      if (!byId.has(e.source) || !byId.has(e.target)) violations.push({ kind: 'dangling-edge', id: e.id });
    }
  }
  // 环检测两档共跑；三色标记（1=in-progress、2=done）——回到 in-progress 节点即环，
  // 报该节点为代表（每环恰一条 violation——去重 v3）；悬空 parentId 跳过（byId.has 守卫）
  const STATE = new Map<string, 1 | 2>();
  const walk = (id: string): void => {
    if (STATE.get(id) === 2) return;
    STATE.set(id, 1);
    const p = byId.get(id)?.parentId;
    if (p != null && byId.has(p)) {
      if (STATE.get(p) === 1) violations.push({ kind: 'cycle', id: p });
      else if (STATE.get(p) !== 2) walk(p);
    }
    STATE.set(id, 2);
  };
  for (const nd of nodes) walk(nd.id);
  return { violations };
}
```

- [ ] **Step 3: 挂载（导入档=跨用户过滤前/remap 前；clone 档=remap 后）+ API 用例**

3a. template.service 导入侧——**在 buildFilteredSnapshot（跨用户过滤）之前、两遍重映射前**；**v6 判据定死（fatal = "producer 侧不可能合法产出的结构"——spec Task 9 规则⑤已登记 F39 修订；v5 修不拒的理由链：snapshot-filter.util.spec.ts:87-92/video-work.service.spec.ts:462"悬空已接受"+template:273 现状降级+clone 红线+cells null 占位模型）**。**400 三种：cycle（挂死 RF 无降级）/nested-group（groupNodes:815 有禁嵌套守卫——模板嵌套组必是数据损坏，RF extent:parent 对嵌套组行为未定义）/non-group-parent（producer 侧 parentId 只指向组）**；三类悬空=修不拒（producer 侧可达：删组窗口/过滤剥节点）：

```ts
const { violations } = validateParentGraph(projectData.nodes, 'import', projectData.edges);
const fatal = violations.filter((v) => ['cycle', 'nested-group', 'non-group-parent'].includes(v.kind));
if (fatal.length > 0) throw new BadRequestException(`模板组结构非法（${fatal[0].kind}: ${fatal[0].id}），无法导入`);
// 悬空三类"修不拒"：parentId 悬空 → 折 undefined（:273 现状语义）；cell 悬空 → null（clone remapIds 同款）；
// 边端点悬空 → 丢弃——在重映射循环内处理，violations 计数进日志（console.warn）
```

（用例：环/嵌套/非组父 → rejects '组结构非法'；**cells 造 'ghost' → 正常导入且输出 cells 该位为 null（修不拒——与既有 spec :87-92"原样返回"断言的衔接：既有断言锁的是 buildFilteredSnapshot 不改 cells，本处是导入前置修——两测试共存，改写既有断言注明分层**）；边端点悬空 → 导入成功边被丢弃。）

3b. video-work-clone——remapIds 后、normalizeLoadedCanvas 前：

```ts
const { violations } = validateParentGraph(remapped, 'clone');
if (violations.some((v) => v.kind === 'cycle')) throw new BadRequestException('画布存在组引用环，无法克隆');
```

（用例：环夹具 rejects；悬空夹具正常完成——红线行为锁。**官方 seed 回归锚（v4）**：官方模板 seed 是扁平两节点+一条边（template.service.ts:339-345）——补一条断言"官方 seed 过 import 档零 violation"（现状会过，防未来 seed 加组时静默变 400——schemaVersion P0-C 同款先例）。）

- [ ] **Step 4: 跑测试 + 重建 dist + commit**

```bash
pnpm --filter @flowweb/shared test -- --run && pnpm --filter @flowweb/shared build \
  && pnpm --filter @flowweb/api test -- --run src/modules/template/ src/modules/video-work/
```

```bash
git add packages/shared/src/canvas/validateParentGraph.ts packages/shared/src/canvas/validateParentGraph.test.ts packages/shared/src/index.ts apps/api/src/modules/template/ apps/api/src/modules/video-work/
git commit -m "feat(shared): validateParentGraph 两档扩面——导入档钉在跨用户过滤/remap 前+non-group-parent/dangling-edge/cells 引用+环去重（R1b/F39；假绿与假拒双修）"
```

## Task 22: R1 收尾验证 + 浏览器验收

- [ ] **Step 1: 全量自动化（build 先行防 dist 陈旧；干净三步构建 + CJS require）**

```bash
pnpm --filter @flowweb/shared build \
  && pnpm --filter @flowweb/shared test -- --run \
  && pnpm --filter @flowweb/api test -- --run \
  && pnpm --filter @flowweb/web test -- --run \
  && pnpm --filter @flowweb/web lint \
  && pnpm --filter @flowweb/web exec tsc --noEmit \
  && pnpm --filter @flowweb/api exec tsc --noEmit \
  && rm -rf packages/shared/dist apps/api/dist apps/web/dist \
  && pnpm --filter @flowweb/shared build && pnpm --filter @flowweb/api exec nest build && pnpm --filter @flowweb/web build \
  && node -e "require('./apps/api/dist/modules/video-work/snapshot-filter.util.js').CLONE_WHITELIST" && echo ALL_OK
```

Expected: 全绿 + 干净三步构建 + CJS 产物 require 成功。

**开发门体验断言（v4 修正——`exec` 直跑二进制不触发 pre-hook，必须走 `pnpm run` 生命周期）**：`rm -rf packages/shared/dist && pnpm --filter @flowweb/api run dev`（或 `run build`）应给出可读失败（"dist/index.js 不存在——先 build shared"——predev/prebuild 门禁输出），而不是一串 Cannot find module；`pnpm --filter @flowweb/api exec tsc --noEmit` 无钩子、给原始 TS2307 属预期（登记——exec 路径本就不设防）。

**生产启动冒烟（v5 修正——main.js 不是冒烟是起服务：main.ts:100 顶层 bootstrap() 会 preloadDbConfig（连 DB）→ initOfficialTemplates（**写库**）→ app.listen（进程常驻不退出，&& 链悬停 ALL_OK 永不打印）。改验模块图完整性）**：

```bash
timeout 20 node -e "require('./apps/api/dist/app.module.js'); console.log('module graph ok'); process.exit(0)"
```

（v6 加 process.exit(0)+timeout 双保险——auth.ts 顶层 ioredis 连接会让进程挂住（gate-seed.ts:96 既有先例注释"必须显式退出"），exit(0) 是硬边界不依赖"无副作用"假设；timeout 20 兜底。Nest 元数据/DTO 装饰器全部求值、不触发 DI/listen/DB——CJS 产物完整性证明。真 boot 冒烟需 PG/Redis+超时 kill+/health，作为手工项登记不在 verify 链。）

- [ ] **Step 2: 浏览器验收（dev server；preview 工具——自动化最小集，视觉项人工）**

自动化判据（preview_eval/网络面板可复核；**v3 判据重写——无 IDB 断言，F42 判据升级**）：
1. **刷新恢复（F35 行为面）**：画布建组+子节点 → 正常刷新 → 组结构与尺寸在（服务端 sync 路径；`getDoc()` 读 parentId 分布与 cs 一致——结构性断言非"看起来有组"）
2. **远端删除不复活**（反向判据）：双标签 A/B——B 删除节点 → A 刷新（或等 remote apply）→ 节点不复活（服务端 tombstone 权威，无本地 seed）

> **2026-09-29 证伪与修复**：上表"onDisconnect flush 兜底"在删除场景失效——flush 汇入的 storeDocument 被
> SV 判等挡住（删除不推进 clock），断连后 `!lastSV` 静默跳过是刷新复活的必现路径。判据 2 判 FAIL，
> 已按 `docs/superpowers/specs/collab-delete-persist-fix.md`（变更驱动落库）修复。兜底成立的前提是
> "每次语义变更都进 pending 队列 + 断连 flush 无条件执行且吞错有 unflushed 兜底"。
3. **F42 判据升级**：改 storyboard showIndex（纯 data，不变尺寸）→ **不刷新** → 触发一次远端 apply（另一标签拖动任意节点）→ showIndex 仍在（现状：applyDocToStore 用 doc 旧 data 整表覆写——当场回滚）
4. **storyboard 配置落盘**：改比例 16:9→1:1 → 刷新 → 比例仍 1:1
5. **resize 持久**：文本节点 resize → 刷新 → 尺寸保持（cs.width→投影→doc→服务端全链）
6. **几何守恒**：拖节点进组（落点选组左上方向）——既有子节点视觉纹丝不动；**跨组拖移**——子绝对坐标不变；解散分镜组——宽图 500px 保留
7. **F18**：组命名后 convertGroup 两方向——名字不丢
8. **viewport 保持**：平移缩放 → 刷新 → viewport 恢复（flowweb_vp_ key）

人工目检项：拖拽 clamp 正常（组内拖不越界、组宽未知不夹飞）、协作同步无乒乓漂移（小数坐标拖拽 30s）。

**自动化补三条（v4——比字符串门禁有意义的不变量断言）**：
9. **几何不变量循环断言**：任何重算型命令（拖入/移出/跨组/解散/转换）执行后，对每个 shouldAutoRefit 组断言 `frame ≡ calcGroupBounds(childrenAbs)` 且 `rel.x ≥ GROUP_PADDING && rel.y ≥ GROUP_PADDING_TOP`——preview_eval 一条循环覆盖 Task 18/19/20 全部几何路径
10. **不 refit 组反向断言**：向 manuallyResized/collapsed 组拖入——组 frame 位位不变、新子 rel 落 padding 内
11. **首同步行为**：devtools 限速/延迟 3s → 刷新 → 3s 内画布处于 loading 门（不可编辑——isHydrating 挡住渲染），同步完成后结构与尺寸与 doc 一致（getDoc 读比对）

```bash
git status   # 验收不改码；有意外改动停下检查
```

- [ ] **Step 3: R1 完成登记（无独立 commit）**

---

## 验收对照表（v3）

| spec 验收项（v11 口径） | task |
|---|---|
| 双端 alias 钉 src 先行（断裂窗口消除——P0-2 修正） | Task 1 |
| shared 真构建（CJS+产物断言+require 冒烟+turbo dev ^build+type:commonjs） | Task 2 |
| dist 新鲜度（fileURLToPath+排除 test+prebuild/predev+verify 显式序列） | Task 3 |
| deploy.sh（shared 构建 cd 直跑+base/scripts 传输+产物清理+tar 静态断言） | Task 4 |
| GROUP_NODE_DATA_KEYS 值导入（CJS require 键集全等冒烟） | Task 5 |
| nodeEnvelope（写侧真删键+双向锚定+null 语义分家契约——API normalizeNodeRecord 保留） | Task 6 |
| 信封写者全量收敛（writeNodeToYMap 落 node-doc.util+applyRecordToYMap+edges 单形状+两脚本） | Task 7 |
| 信封门禁 v3（扫描面全仓+双引号+空集自证+仓根定位） | Task 8 |
| spec v11（快照改道+clamp 清剿扩面+F39 时机+F42+R1c 立项——复述句全文 grep 验证） | Task 9 |
| 投影 data 所有权分型+增量写者同源+getDoc 缝+G3 读 doc 断言 | Task 10 |
| F42 三件套（pickStructNodes 组 data+删镜像+patchGroupData+cells 第 7 写者+undo 语义）——**前移紧邻投影** | Task 11 |
| 删快照层（方案 C：6 文件+删 seed+viewport flowweb_vp_+registry 重跑） | Task 12 |
| 几何读侧迁移（useInternalNode+vi.hoisted mock+null 分支翻转） | Task 13 |
| 删 W7/W8（红转绿锚改 getDoc 读 doc+clamp 守卫扩不可用/退化跳） | Task 14 |
| AppNode 删三字段（toAppNode 白名单+15 处实参+~45 夹具+nodeStore.test 类型红清偿） | Task 15 |
| 纯几何下沉+refitGroupGeometry+shouldAutoRefit+COLLAPSED_SIZE/DEFAULT_CHILD_SIZE 单源+stitch 常量收口（A2） | Task 16 |
| normalizeLoadedCanvas（守恒归位同法律+三守卫补回+applyDocToStore 挂载+F30） | Task 17 |
| applyGroupFrame+F33 左上夹具+跨组守卫+epsilon 乒乓+placement clamp+删 refitGroupBounds | Task 18 |
| F38 整类（尺寸保留+pitch=max+rowIds 求交） | Task 19 |
| 配置型收口+复制型完整断言+cells ?? null+溢出新宽+normalizeLoadedCanvas 服务端挂载+门禁 tripwire | Task 20 |
| validateParentGraph（导入档钉过滤/remap 前+三种新 violation+cells/edges+环去重） | Task 21 |
| 收尾（干净三步+开发门体验+浏览器验收 v3 判据：F42 不刷新 apply 后仍在/parentId 结构断言/跨组/viewport） | Task 22 |

**登记偏差与裁决（v3）：**
1. **方案 C 拍板**：R1 删快照层不加客户端 IDB（服务端 doc 持久化实证——F35=删 seed 即消失）；IDB 立项 R1c 独立分片（六项硬化要件登记进 spec v11）。
2. normalizeLoadedCanvas=守恒归位（与 refitGroupGeometry 同一部法律；v2"只补尺寸不动原点/服务端越权"裁决撤回——单侧公式与 calcGroupBounds 双侧数学矛盾+collapsed/savedSize 守卫丢失是回归）。
3. null 语义分家：读侧出口 `?? null`（F32/R0b 契约）/写侧真删键；API normalizeNodeRecord 保留不收敛（JSON 边界语义+RawNode 类型域）。
4. F42=触发面（pickStructNodes）+所有权（删镜像）+通道（patchGroupData）三件套，非补调用点；Task 11 前移紧邻 Task 10。
5. edges 形状一次收成 source/target（无存量数据时机）；writeNodeToYMap 落 node-doc.util（util 层）。
6. addToGroup/dropIntoGroup 事务内直调 refitGroupGeometry（事务原子性优先；单一重算源不变，门禁按调用点计数锁）；跨组先摘除+源组 refit；placement 对不 refit 组保留 clamp（N5 搬家封堵）。
7. applyGroupFrame epsilon no-op（1e-6）——RF 小数坐标 1ULP 抖动防桥乒乓；乒乓断言用小数夹具。
8. clone 环 400 硬拒维持；导入档校验钉在跨用户过滤/remap 之前（假绿+假拒双修）。
9. 运行时 9 键兜底不做（改测试断言）；旧 localStorage key 不清扫；api lint 不可用登记（verify 显式序列不含）。
10. mtime 门禁只挂 prebuild/predev（pretest 与 vitest alias 冗余+测试文件 touch 假红）；walk 排除 *.test.ts。
11. undo 语义定死：patchGroupData 经桥 LocalUser origin 入栈、500ms captureTimeout 合并、undo 恢复旧 data（断言在 Task 11）。
12. 服务端 normalizeLoadedCanvas 挂载=幂等保险登记（非补齐依赖——浏览器 applyDocToStore 已挂同一函数承担补齐）。
13. **v4 修订（第四轮评审核实）**：几何期望值禁手算纪律（全局头部）；writeNodeToYMap data 全量写入+applyRecordToYMap 全键 diff 守卫（doc 膨胀防线）；pretest 恢复+hash manifest（mtime 对删除/改名假绿）+红相命令走 pnpm run 生命周期（exec 不触发钩子——Task 22 开发门断言同步修正）；Task 16 类型迁移面=五符号（GroupType/ASPECT_RATIOS/AspectRatio/StitchResolution/StoryboardConfig）+RATIO_MAP: Record<string,number> 索引兼容导出；Task 17 实现补组原点（rel→绝对 rect）+断言改四法律（calcGroupBounds 纯函数期望）；Task 18 placement 两分支（不 refit 组框一字不改+clamp 用组实际尺寸）+源组失末子 ungroup；edges 涟漪全清单（template:244/:292-293、topology:10-12、project:20/:80-81+~10 夹具）+分两 commit；deploy_full tar 补 scripts/；Task 13 mock 只换 useInternalNode 行（保既有五 override+position 默认）；G3 夹具钉 aspectRatio（尺寸联动——Task 10 即绿，showIndex 判别力归 Task 11）；Task 21 cells 剪枝同批修（buildFilteredSnapshot 对 dropped 清 cells——对齐 clone remapIds）+官方 seed 回归锚；S1 hydrate 收尾显式回写（isHydrating 抑制期的派生几何推回 doc）；S2 applyGroupFrameRect 消费者清单（唯一真实消费者=toggleCollapse savedSize 恢复，否则删）；spec v11 补登五项（API dev 口径/空白画布接受项/R2d 折叠状态空间根因/S3 程序化入组语义/跨分片门禁不变量）。
14. **v5 修订（第五轮评审核实——三份全实证）**：① **门禁内联化**（pnpm enable-pre-post-scripts 默认值随版本漂移+仓无 .npmrc——pre* 钩子可能整体不跑使防线归零）：api dev/build/test 脚本首段内联 check+新增仓根 .npmrc+ensure 语义（stale 自动重建，--check 严格模式归 CI/verify）+manifest 覆盖三 tsconfig；② **分镜组展开冻结链修复**（GroupNode 不渲染 Resizer→markManuallyResized 无写点→展开 savedSize 分支不可达→else 落 applyGroupFrame 被 shouldAutoRefit no-op→框永久 200×64）：toggleCollapse 展开三分派接 applyGroupFrameRect+collapse→expand 往返用例（normal/storyboard 各一）——同时定案 S2 消费者；③ **S1 origin 修正**：新 Origin.Geometry（'geometry-repair'，不入 trackedOrigins+onRemote fromLocal 集合扩）——LocalUser 会把几何归位写进撤销栈；收益论证改挂 refitExpandedGroups（normalizeLoadedCanvas 只补缺几何非每轮维护者）；④ **Task 21 修不拒**：导入档 400 只留 cycle/nested-group/non-group-parent——三类悬空改折 undefined/null/丢弃（与仓内既成契约对齐：snapshot-filter.spec:87-92"悬空原样返回已接受"+template:273 现状降级+clone 红线+cells null 占位模型）；⑤ **删组即解组**（P0-3：现状 deleteNode/removes 只处理被删节点的父组——组被删时子节点 parentId 悬空+rel 当绝对渲染飞原点，Delete 键可作用于组真实可达）：dissolveGroup force 变体两路径覆盖+removeNodeFromGroup 移空解组（C2 四路径统一：normal 空组一律解组）；⑥ **syncStoreToDoc(doc, origin) 形参化**（syncAutoEdgesToDoc 先例——getDoc 只解决读不解决驱动，initCollab 需真连接 jsdom 跑不动）：G3/W7 装置 3 行直驱；⑦ **edges 门禁 v5 重写**：v4 全仓 grep+路径豁免会误报 subscription-banner 审计字段 targetId、放过文件名含 team 的 backfill-team 边写者——改白名单扫描面+同语句共现判据+真断言（readDocCanvas 输出 toEqual 键集锁）；⑧ clampChildIntoGroup 公共守卫（Task 18 分支 B 的 `group.width ?? 0` 直传会负夹飞——与 Task 14 拖拽守卫同源抽公共）+夹具按纪律二拆两条（v4 落点在 clamp 界内与"落点=放置点"互斥必红）；⑨ main.js require 冒烟改 app.module.js（原形态会连 DB/写 seed/进程常驻挂链）；⑩ placeGrid 槽位语义（null/悬空按基准占格不塌陷——与 cells.indexOf 槽位布局一致）；⑪ storyboardConfig re-export 具名列三符号（漏 hasStoryboardConfig/DEFAULT_STORYBOARD_CONFIG 必红）+types/group 值导出 ASPECT_RATIOS（两测试值导入）+groupLayout 具名 re-export（C4 export* 过宽）；⑫ registry 生成器钉死（apps/web/scripts/canvas-migration-registry.mjs——勿手工改 JSON）+nodeOrder.test 双参用例入清单+enableShutdownHooks 落地 Task 12（pm2 restart 不触发 server.destroy 会丢 ≤5s 编辑——服务端成唯一持久化层后的承重墙）；⑬ undo 用例装置补全（占位收回）+derivations 配对注释钉死+removedIds 复用不重声明+topology 真实路径 modules/execution+resolveStoryboardConfig 命名统一（v4 的 Cfg 是笔误）+幂等断言说明（早退同引用——锁回归非强证明）+epsilon 用例改二次 refit no-op 形态+几何不变量断言下沉 store 级单测（C5——浏览器验收不可回归）；⑭ spec 补登四条行为规则（空组解组四路径统一/删组即解组/分支 B 组框不再长大/clamp 移动刚拖入节点）+外部 spec 复述句清剿（video-works-design:213/:245）+比较税登记+NS 组条目残留 R2 清理登记。
15. **v6 修订（第六轮评审核实）**：① **全局纪律三：几何派生公式同源**（`width ?? DEFAULT_CHILD_SIZE` 一字不差四处——normalizeLoadedCanvas/applyGroupFrame/addToGroup 分支 A/assertInvariant；**去 measured**——渲染期量使帧变渲染时序函数→跨客户端漂移，v5 四处不同源会使不变量断言对正确实现恒红；measured 唯一保留域=拖拽期 clamp；投影 projectCanvasNodes 同步去）；② **edges 门禁二次修正**（v5 共现判据在 backfill-team.ts:8 的 Prisma CanvasEdge 列名（DB legacy 桥接）上假红+抓不到分两行的类型声明）：扫描面去 apps/api/scripts（gate-seed 保留手写信封同批裁决——e2e global-setup 直跑 tsx 无内联门禁，收敛收益低于 dist 耦合成本；backfill-team 仍收敛）+判据退回"任一出现"（六模块目录内非测试命中全是边形状——评审 grep 实证）；③ **删组裁决改级联**（v5 解组方案与菜单 GroupContextMenu:61-67 先删子再删组的既有语义冲突且违背画布工具容器删除直觉——撤销 dissolveGroup/ungroupForce，deleteNode/removes 两路径补级联删子，悬空 producer 洞结构性消失）；④ **测试缝三件套**（applyDocToStore(d) 补形参化——undo 用例的 store 回流与 Task 18 乒乓断言的读回驱动都依赖它，onRemote 只在 initCollab 注册测试跑不动）；⑤ **G3 夹具补 ns 陈旧组 data**（只摆 cs 时现状投影 `?? nd.data` 回落新值→现状也绿、红相论证倒塌——真实红相来自 groupNodes:839/mergeStoryboard:1165 的 ns.addNode 陈旧写入，夹具必须复现）；⑥ **复制夹具改 storyboard**（buildGroupCopy:1459/1469 cells 重映射只在 isStoryboard 分支——normal 夹具断言必红且现状也红=判别力零）；⑦ **F39 fatal 判据定死并登记 spec**（"producer 侧不可能合法产出=400；可达真实状态=修"——cycle/nested-group/non-group-parent 400+三悬空修；v5 漏登记推翻已补 Task 9 规则⑤；悬空边丢弃落点=Task 7 2d 的 template:290-294）；⑧ **三分派修正**（storyboard 展开只用 calcStoryboardSize 不用 savedSize——配置是分镜框真理；末档 applyGroupFrameRect(calcGroupBounds) 彻底不依赖 shouldAutoRefit 时点）；⑨ ensure 实现契约写死（spawnSync tsc 不递归 pnpm+显式打印"已自动重建"+watch 在跑返回红）+.npmrc 登记为兼容垫+pre 钩子复述句三处清理；⑩ **app.module.js 冒烟加 process.exit(0)+timeout**（auth.ts 顶层 ioredis 挂进程——gate-seed:96 先例）；⑪ placeGrid sizeOf 契约+防御实现（槽位语义必然对无节点 id 调 sizeOf——undefined.width TypeError）+placeGrid 三条直接单测；⑫ Task 16 consumer 改 RATIO_MAP（与 2b 统一——v5 的 2d 写 ASPECT_RATIO_MAP 自相矛盾）+clampChildIntoGroup 归属 shared+四条边界单测+re-export 清单补；⑬ 杂项：epsilon 守恒锚补断言（c1AbsAfterFirst 声明未用）+不变量六条显式 it（空 it.each 是占位）+removeNodeFromGroup 用例组原点非零+viewport projectId null 守卫+pm2 kill_timeout 10000 登记（destroy 多次 DB 往返超默认 1600ms 会被 SIGKILL——降级非消灭）+10s 超时后空画布可编辑态精确登记+廉价兜底选项+"六组"文案+spec 一句"加载兜底≠后续自动维护"+storyboard-dereref allowlist rel 口径统一。

**R1 完成后下一步：** Plan R2（UI 四分片——2a 选框/多选工具条/排列/副本、2b 批量下载+mediaUrl 读写收敛、2c 组工具条+组色+nameCustom、2d 折叠卡+分镜改版）；**R1c（客户端 IDB 离线缓存）独立 spec**（六项硬化要件：userId 维度/encodeStateAsUpdate 覆盖写/destroy flush+pagehide/多标签协调/配额清理/回传产品政策）。

---
