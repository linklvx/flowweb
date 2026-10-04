<!-- doc-status: historical | verified_at: n/a -->
# Canvas 组升级 Spec A — R2 UI 四分片 实施计划（v2.2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 spec v11 的 R2 UI 四分片——2a 多选选框 padding 30+多选工具条（排列/创建副本，打组▾已有）+duplicateNodes 副本体系统一（buildCopyPlan 纯函数三薄壳）；2b 批量下载全链路+mediaUrl 读写收敛（F37）+F7 缓存自愈两条补齐（临期<60s 续取+onError 失效重取——v1 误判"已落地"，现场复证零命中）；2c 组工具条+组色+组名入框（Token 前置补课）；2d 折叠宫格卡 220×160+分镜改版+折叠几何收口 v2（**信封恒等可见盒**——门 E 两候选经源码判定双双不可行，已裁决改道，见注记 7）+智能标题屏幕层。

**Architecture:** 写路径：新命令一律经 `runCommand` 轻量包装（canEdit 门 + `stopCapturing()` + `captureStoreProjection` → 结构写（`setWithParentOrder`）→ `applyGroupDerivations` → `dispatchProjectionDiff(before, Origin.LocalUser)`）——**仅新命令使用，既有 16 处 capture/diff 点不迁移**（spec:169"折叠/转组等既有命令不动（精准修改）"）；排列/选区/副本计划归一纯函数下沉 `packages/shared/src/canvas/`；组 data 只经 `patchGroupData`（**outer=既有正向 dispatch 命令 15 处零改动；inner=纯写层，runCommand.fn 内一律 inner——2a-0 契约**）；组框经 `applyGroupFrame/applyGroupFrameRect`。R2d 折叠收口 v2：**信封（cs/doc 的 width/height）恒等节点当前可见矩形**——折叠态恒=COLLAPSED_SIZE（toggleCollapse envelope intent 与渲染层根 div 双引同一常量）；savedSize 存在 ⟺ collapsed=true（密封快照：展开→折叠转移边写、展开即删键）；展开帧由 shared 纯函数 `resolveExpandedFrame` 单源裁决（toggleCollapse 与 normalizeLoadedCanvas 同源消费）。**分镜组不可折叠（v2.2 裁决，注记 19e）**：toggleCollapse 对 storyboard 组双向 no-op 守卫；collapsed/savedSize 仅属 normal 组（convertGroup 两方向已清 collapsed）；脏 collapsed 落 storyboard=加载边界剥键自愈（normalizeLoadedCanvas），不走让位（死局论证见注记 19）。

**Tech Stack:** **@xyflow/react 12.10.2** + @xyflow/system 0.0.76（`useViewport`/`useInternalNode`/`createPortal`/`nodeLookup`/`measured` 均为 v12 API 面——v1 误写 "React Flow 11"，`@reactflow/core` 是 v10 包名）、zustand、Yjs intent 漏斗（canvasIntents）、Tailwind+CSS 变量 token、Vitest、pnpm workspace（@flowweb/shared）。

**上游 spec:** `docs/superpowers/specs/2026-09-28-canvas-group-ui-upgrade-design.md`（v12 已回写；2026-10-02 v12 补订随本 plan v2.2 同批——分镜组不可折叠+让位子句废除，见注记 19）。

---

## 执行总览（顺序、裁定注记、通用纪律）

**执行顺序**：2a（公共件+选框+排列+副本统一）→ 2b（批量下载+mediaUrl 收敛+F7 自愈）→ 2c（Token+组工具条+组色+组名入框）→ 2d（折叠收口 v2+宫格卡+分镜改版+智能标题屏幕层）→ R2 批尾（浏览器验收+Playwright b0/registry+折叠几何浏览器级冒烟）。**门 E 独立分片取消**——裁决已由源码判定提前完成（注记 7），其不变量断言并入 2d-1、浏览器级验证并入 2d 批尾。

每分片独立 commit 序列、可独立回滚；分片尾跑 `pnpm --filter @flowweb/web test -- --run` + `pnpm verify`；**每分片批尾加双标签页手测**（A 操作 → B 一致 → A undo 一步 → B 一致——R2 引入 4 个多写点命令，这是捕获"多 transact 中途可见/半边回滚"的最低成本手段）。

### 计划阶段裁定注记 v2（现场核验 2026-10-01——4 路并行复证 + 主审直验 spec/RF 源码；spec v11 写于批 4b 之前，差异以现状为准）

1. **写路径已换轨（collab 批 4b）**：spec §4.3"协作投影自动取用，无需任何同步动作"——bindBridge/syncStoreToDoc 已删除。新命令统一照 `groupNodes`/`duplicateGroup` 同型差分换芯（v2 起经 `runCommand` 包装，见 2a-0）。spec 该句按此理解执行。
2. **F18 已修**：convertGroup 两方向已是 patchGroupData 增量 patch（canvasStore.ts:1508-1526，undefined=删键）——color 键天然存续。2c 只补"两方向 color 存续"测试锚。
3. **copyNode 仍在**（canvasStore.ts:341-380+接口 :134，随 2a-6 副本统一一并删除）。
4. **打组下拉维持现状**（打组 Ctrl+G+合并分镜组 Ctrl+Alt+G 两项，SelectionBoxOverlay.tsx:87-108）。
5. **排列菜单三项 = 网格 / 水平 / 垂直**（n=2 时 grid 1×2≡horizontal 属 spec 明示预期）。若用户审批另有所指，只改 2a-3 MODE 常量与文案。
6. **Token 前置（spec §4.2 标"R1"）未随 R1 落地**——index.css 仅 --canvas-controls-* 六键双值（:38-43/:82-87），组色板/--canvas-group-border/--canvas-storyboard-shell-bg 全缺（全仓 grep 零命中）。落 2c 首任务。
7. **【v2 核心改道】R2d 折叠收口 = 信封恒等可见盒（推翻 v1 的"真值恒在+渲染层小盒"与 spec §4.9 登记行）**。源码铁证（@xyflow/react@12.10.2 / @xyflow/system@0.0.76，node_modules 直读）：
   - `getNodeDimensions(node) = { width: node.measured?.width ?? node.width ?? node.initialWidth ?? 0, … }`（system dist/esm/index.mjs:771-776）——measured 优先于 width；
   - NodeWrapper 把 `node.width ?? node.style?.width` 摊进 wrapper div 内联尺寸（react esm:1918-1926/:2138-2139/:2239）——**cs 保留 600×400 则 DOM 盒恒 600×400**，ResizeObserver 观察 wrapper 本体（:2063-2067）→ measured=600×400；
   - `getNodePositionWithOrigin` 按 getNodeDimensions 算偏移（system :272-281）；`getNodesBounds` 经 nodeLookup 读全量（含 hidden，hidden 只跳过渲染不移出 lookup，react :2135-2137）；
   - jsdom 下 test-setup.ts:17-21 把 ResizeObserver stub 成空实现 → 回调永不触发 → **measured 在 vitest 组件测试中恒 undefined**——v1 门 E 想用 vitest 夹具裁决在结构上不可行。
   - **结论**：v1 候选 1（真值恒在+渲染层小盒）必产生"信封 600×400 / 渲染小盒 220×160"两真相并存——选中框/拖拽热区/连线锚点/getNodesBounds/extent:'parent' 全按大盒；候选 2（width/height 置 undefined + data.expandedSize）= savedSize 改名垫片，且 undefined 会反转 normalizeLoadedCanvas"缺几何才补"契约（:16 早退失效）、`nodeHasDimensions` 为假 → visibility:hidden 量到尺寸前不可见、砸掉读信封真值的几何消费者（groupDrop/canvasStore :1250/:1479/:1627/getNodesBounds——以 grep 为准）、给 doc 唯一几何字段加"undefined=折叠"第二语义。
   - **改道定义（用户 2026-10-01 拍板）**：(a) 不变量——envelope.width/height ≡ 节点当前可见矩形，折叠态恒=COLLAPSED_SIZE（唯一写点 toggleCollapse 的 envelope intent+渲染层根 div 显式尺寸，两者都引 COLLAPSED_SIZE 常量）；(b) savedSize 语义升格为密封快照——只在"展开→折叠"转移边写入（=折叠前信封）、只在展开读、**展开即删键（展开后 `'savedSize' in data === false`）**、折叠期间不可改写（v2.2 收窄：此约束限手动/守恒域——markManuallyResized 折叠态拒写、NodeResizer 折叠分支不渲染；**分镜组不可折叠〔toggleCollapse 双向 no-op 守卫——v2.2 推翻 v2.1 让位设计：守卫挡写入后让位会把脏 collapsed 组永久卡在 220×160 挤压渲染且展开无门（死局），改"坏值尽快自愈"——normalizeLoadedCanvas 加载边界剥 collapsed/savedSize+envelope=calcStoryboardSize；CanvasView:623 恒 false 即契约正确；updateStoryboardConfig/resizeStoryboardGrid 维持现状直写不动**）、彻底取消与 manuallyResized 的耦合（manuallyResized 仅作 shouldAutoRefit 门禁）；(c) 单源裁决——shared 纯函数 `resolveExpandedFrame({data, childrenAbs, config})`，**有效 savedSize 优先（v2.2 收窄：等价性论证仅涉 normal 组**——分镜组不可折叠后"手动 resize 过的分镜组折叠往返"场景不可达，spec:288"用户手动 resize 优先于配置尺寸"拍板语义保留在 normal 组展开域；storyboard 堵洞档仅服务脏数据兜底），无效 savedSize 堵洞序=storyboard→calcStoryboardSize→守恒重算→空组 COLLAPSED_SIZE（不造 0×0）；(d) 冻结口径——无迁移/兼容/版本标记（无存量数据）；(e) 不变量测试见 2d-1；(f) savedSize 保留在 GROUP_NODE_DATA_KEYS（**9 键不变——API/clone/锚定测试零连锁**）；COLLAPSED_SIZE 改值 220×160 留 2d-2 单独 commit；(g) spec §4.9 R2d 登记行/:18/:288 随本 plan 同批回写（v12 裁决块）。
8. **【v2 纠错】F7 客户端自愈两条零命中（v1 注记误判"已落地"）**：现场实证 mediaUrlCache.ts:34 只判 `expiresAt <= now`（**无临期<60s 续取**）、useMediaUrl.ts:29 catch 只 setError（**无 onError 失效重取**）——spec:214 三件套仅"ttl≤0 重取"在。R0c 落的是形状四条（expiresAt 绝对时刻/服务端算剩余/userId 维度/in-flight 去重），临期+onError 两条属 **2b**（spec:18"与缓存/in-flight 同批"），v1 覆盖表宣告 F7 闭环是错误的——v2 已改（见 2b-5 与 Self-Review）。
9. **副本体系统一 = buildCopyPlan 纯函数三薄壳（用户 2026-10-01 拍板）**：抽 `buildCopyPlan(records, ids, {offset|position})` 纯函数为唯一副本体（~~选区闭包展开~~/isStoryboard 子 position 归零/extent 清理/cells 重映射一次算清——**闭包展开后移至 participation 前置裁决（19a/19i 分工单点：buildCopyPlan 只接收已裁决 ids 做纯映射构造）**）；duplicateGroup、duplicateNodes、粘贴三入口退化为薄壳；**data 取数单一：组取 cs（同 projectCanvasNodes 分型）、普通节点只取 ns 全量、删掉 `?? n.data` 回落（取不到即红）**；clipboard 存 ns 全量快照复用同一纯体（不再 structuredClone 旧路径）；粘贴坐标补 `screenToFlowPosition`（现 GroupContextMenu 直传 clientX/clientY——以现场为准）；先落三条保真断言再删旧函数（buildGroupCopy:1802-1891 / rebuildFromClipboard:1894-1976 / copyNode:341-380）。
10. **参与集闭包语义（v1 结构缺陷修正）**：v1 的 normalizeSelection 把"父组已选中的子"丢弃后 participation 只拼三桶——`duplicateNodes(['g1'])` 会产出 cells 全 null 的空壳组、`collectDownloadables(['g1'])` 返回空（实现与 v1 自带测试互相证伪）。v2：participation 内做**组→成员闭包展开**（~~duplicate=可见子〔排除 hidden：storyboard/collapsed 子〕~~**——v2.1 推翻：duplicate 闭包全量保真，hidden 排除仅 detached 桶，见注记 18a/19a**；download=全部成员含 hidden——spec 契约 1"三桶全展开"正解）。
11. **hidden 语义落到写入侧不变量（用户认可方向）**：`hidden ⇒ selected 必须为 false`——toggleCollapse 折叠分支与 convertGroup 转分镜时清子节点 selected（一处清、三桶归一自然成立）；SelectionBoxOverlay:15-19 的 nodeLookup.forEach 加 `!n.hidden` 过滤兜底（防其他 hidden 源）。deriveHidden（groupDerive.ts:13-16）只写 hidden 从不清 selected——该事实即本注记依据。
12. **nameCustom/renameGroup/右键重命名（F24）归 2d**；renameGroup 现状 `name.trim() || '分组'` 硬兜底（canvasStore.ts:1554）**维持不改语义**，2d-6 只补 nameCustom:true。
13. **分镜 shell 呈现组色（v10 裁决 4）归 2d**。
14. **lint-gate 追加模式**（四步闭环，v1 注记 10 修正 fixture 路径）：新规则=在 `apps/web/scripts/eslint-rules/collab-static-asserts.js` 加规则对象（自动获得 gateActive:31-34 测试文件豁免）→ `apps/web/eslint.config.js` 注册（plugins 块 :44-56/rules 块 :57-66）→ `apps/web/scripts/lint-gate.mjs` STATIC_ASSERT_RULE_IDS（:29-35，现 5 条）加 ID → fixture 加正例。**fixture 真实路径=`apps/web/scripts/__tests__/lint-gate.fixture.test.mjs`**（内联字符串经 `new Linter().verify()`，:12-27/:177-193；`apps/web/src/scripts/` 目录不存在——v1 写错）。
15. **跨分片不变量维持（spec 契约 6）**：信封序列化门禁/几何写点门禁（group-frame-writer-guard.test.ts 源码扫描族）/shared dist 新鲜度门禁全程不得删除；**group-frame-writer-guard 的 ALLOW_FN（:23，现={applyGroupFrame:, addToGroup:, dropIntoGroup:}）随 2a-5/2c-4 扩 `arrangeSelection:`/`arrangeGroupChildren:`**——新命令是合法几何写者，登记而非绕开（declRe `/^  ([a-zA-Z]+):/` 含大写字母，camelCase 块边界正常识别——不加白名单=正确地红，非假绿）。
16. **路径/版本/命令类更正汇总（v1 误写，执行时以此为准）**：
    - CanvasView 真实路径=`apps/web/src/pages/canvas/components/CanvasView.tsx`（v1 写 `pages/canvas/CanvasView.tsx` 不存在）；
    - groupDerive 在 `apps/web/src/utils/`；canvasStore 只有 `applyGroupDerivations()` action（:154/:989），无 groupDerived map；
    - RF 版本 ^12.0.0→12.10.2（pnpm-lock:2615）；
    - e2e 无 `test:e2e` script：须 `pnpm --filter @flowweb/web exec playwright test e2e/b0-token-blocks.spec.ts`（b1-4=b1-token-migration.spec.ts 内 test；css-baseline-diff=scripts/ 脚本）；**CI 只跑 pnpm verify（ci.yml:49），nightly 只跑 gate-collab.mjs——b0/b1-4/css-baseline-diff 均不在 CI，须本地执行**；
    - media-batch.service.ts:24-25 TTL 是两个字面量 3600，**无常量**——"现签 TTL 常量单源引用"是错误前提，新建常量本身即 2d-4 工作内容；
    - CANVAS_BRIDGE_KEYS 在 nodeStore.ts:245（键集 ['fileId','referenceImage','status','mediaUrl','images']）；ImageNodeData（:109-137）无 mediaUrl 键（4 处写入全 as any——收敛后随删）；
    - batchGetMedia 生产消费方 **2 处**（useWorkflowAssets.ts:32、VideoEditNode.tsx:109；shadowJob 已批 5 删除）；
    - canvasStore 内 antd message 使用 16 处（warning/error/success/info——命令入口守卫范式先例 :387-390 canEdit 早退）。
17. **行号基准**：本 plan 行号引用 2026-10-01 现场复证；执行时以符号+grep 重校准（spec 头部规则）。**plan 自身新增的每个可验证断言同样须现场复证**（v1 教训：Self-Review 声称"类型一致性逐一核对"但 addNode 签名/SELECTION_BOX 键名照抄即错——v2 Self-Review 第 4 条为此新增）。
18. **【v2.1 复审修订】三份外部复审（2026-10-01）的 P0/P1 论断经现场复证全部成立，已就地采纳**：(a) **hidden 语义收窄**——participation('duplicate') 闭包全量保真（v2 的闭包排除 hidden 与 2a-6 夹具互相证伪、对 buildGroupCopy 现状〔:1813 无 hidden 过滤复制全部成员〕是行为回归），hidden 排除仅限 detached/直接选中桶（见 2a-2）；(b) **单 transact 原子性**——toggleCollapse 折叠/展开合并为单次 intent 数组 dispatch（canvasIntents.ts:204"复合=序列单 transact"是设计意图，v2 维持两次 dispatch 的中间态帧作废）；(c) **折叠期配置写者让位（v2.2 已推翻——见注记 19(e)：守卫挡写入后让位致脏组死局，改"分镜组不可折叠+加载边界剥键自愈"，updateStoryboardConfig/resizeStoryboardGrid 维持现状不动）**；(d) **runCommand 异常/单 transact 契约**——try/catch/finally 恒收尾 diff（doc≡store 不变量在异常下仍成立）+patchGroupData 拆 inner/outer 两层（防 fn 内正向 dispatch 与外层差分双 transact）+Y.Doc observer 计数断言；(e) **getId 掺会话随机成分**（现 :32-35 纯 Date.now+counter 跨端可撞，R2 新增 duplicate/paste 两条高频路径）；(f) **2b-1 重取条件含网络异常+超时保护+批路径 silent**（超时形态 v2.2 改 AbortController——AbortSignal.timeout 覆盖 body 读取误杀大文件，见注记 19(d)）；(g) **2b-5/2d-4 在飞 promise 身份校验防脏回写**+Number.isFinite(ttlSec)；(h) **2d-4 预取两段渲染**（React effect 子先于父，v2 的卡片 effect 注册方案结构性竞态）；(i) **B 端兜底用例**（selected 不进投影键集——A 端清 selected 不同步 B 端，靠 overlay 过滤兜底，测试钉死第二半）；(j) **批尾三项**：nightly e2e-collab job 追加 b0/b1-4/css-baseline-diff（token 门禁进 CI）+collab-r2-commands 双端脚本化回归+dispatchProjectionDiff 调用点棘轮门禁（基线 v2.2 修正=16 既有+runCommand 白名单 1，见注记 19(c)）。**勘误**：getMediaUrl 直连 12 处/8 文件（mediaUrlCache 视作封装层）；eslint.config.js 注册=plugins :44-56/rules :57-66；node-toolbar-portal=CanvasView.tsx:681-685；SelectionBoxOverlay 下拉菜单 :93-107、pointerEvents 先例 :72（box none）/:81（toolbar auto）、nodrag nopan className 先例=NormalGroupRenderer.tsx:70；antd message 计数以 grep 为准（warning/error 16 处口径）。

19. **【v2.2 第三轮复审修订（2026-10-02）】三份外部复审 P0/P1 论断经现场复证全部成立（另驳回一项勘误）；分镜组折叠由用户拍板：不可折叠+脏数据修复自愈——推翻 v2.1 让位设计（按头部规则全文清剿复述句）**：
    (a) **2a-6 copyPlan 测试块残留 v2 旧语义**（"折叠组成员排除"断言与 2a-2 闭包全量保真互相证伪——v2.1 Self-Review"已对齐"声称与文本事实不符，正是 plan 自我定义的最贵失误模式重演）→ 测试块翻转为 hidden 保真断言+**participation→buildCopyPlan 分工单点**（participation('duplicate') 负责闭包与 hidden/detached 裁决返回 ids；buildCopyPlan 只接收已裁决 ids 做纯映射构造——删 `CopyPlan.excluded` 字段）；
    (b) **2c-3/2c-4/2d-6 三处 runCommand.fn 内 outer patchGroupData 违反 2a-0 契约**（outer 自带正向 dispatch :1542 叠外层差分=同值双 transact）→ 三处改 `patchGroupDataInner`+Architecture 头分层表述+2c-3"双写"措辞随 F42 作废；
    (c) **棘轮门禁基线 off-by-one**：dispatchProjectionDiff 现状恰 16 处（grep 实证 :316…:1973），runCommand finally 即第 17 处——"16 处零新增"字面落地当天被 2a-0 自禁 → 基线=16 既有冻结+runCommand 定义处 1 白名单（ALLOW_FN 同手法）+fixture 正例+dispatchSystemIntents（canvasIntents.ts:290）兼容登记；
    (d) **AbortSignal.timeout(30s) 覆盖 fetch 全生命周期含 body 读取**（signal abort 中断流）——大视频 30s 内读不完 body 即误杀+串行批量拖死，对现状回归 → AbortController+setTimeout，**拿到 response（headers）即 clearTimeout**（卡死保护限 headers 阶段、body 读取不限时）；
    (e) **分镜组不可折叠（用户拍板 2026-10-02）**：现状四处证据核验属实——CanvasView:623/:625 `collapsed={false}` 硬编码+`onCollapse={noOp}`、StoryboardGroupRenderer 零折叠分支、normalizeLoadedCanvas:18-19"collapsed 落 storyboard data 是不可达脏数据"定性、convertGroup 两方向清 collapsed（:1497/:1525，producer 侧全路径不可达）。落地=toggleCollapse 首行 storyboard 双向 no-op 守卫+**脏 collapsed 加载边界剥键自愈**（normalizeLoadedCanvas 对 storyboard+collapsed 剥 collapsed/savedSize+envelope=calcStoryboardSize——修复置于几何早退之前；"坏值尽快自愈不留灰档"哲学，spec §4.5 media 坏值同款）。**让位设计废弃（死局论证）**：守卫挡展开后让位把脏组永久卡在 220×160 挤压渲染、展开无门（只能转普通组自救）；修复式刷新即自愈无死局。updateStoryboardConfig/resizeStoryboardGrid 维持现状直写不动（配置写者永不遇折叠组；脏组遇配置命令=直写顺带拉正信封，与自愈同向）；CanvasView:623 恒 false 即契约正确（撤销 v2.1"改真实值"）；"分镜组可折叠"产品需求登记 R3（spec §6）；
    (f) 折叠期配置覆写手动尺寸争议随 (e) 不可达消失——spec:288 手动优先保留在 normal 组展开域；resolveExpandedFrame 等价性论证收窄（注记 7(c)）；
    (g) P2 系列：展开 intent 数组补 moveNode（applyGroupFrameRect :1647-1650 即 envelope+moveNode 双意图——resolveExpandedFrame 返回绝对 frame，守恒档原点可变）；2d-4 Files 补 media-batch.service.spec.ts；两段渲染 effect 幂等守卫（先查 cache/pending——StrictMode 双跑/共享 fileId）；nightly 追加 b0/b1-4 前确认 web 前置（gate-collab.mjs 只自拉 API，b0 走默认 config 需 webServer）；EXT_BY_MIME/FETCH_TIMEOUT_MS 落点（util 内常量）；resolveNodeData 与 projectCanvasNodes.ts:18 `?? nd.data ?? {}` 回落刻意不对称（fail-fast vs 恢复窗口）注释互注；B 端 stale selected 键盘动作面（Delete/Ctrl+G 对 hidden 生效）登记 R3；
    (h) **驳回**：报告称"projectCanvasNodes 是函数非文件（定义于 ydocBuilder.ts）"——错误：`apps/web/src/utils/projectCanvasNodes.ts` 独立文件存在（ydocBuilder.test.ts:4 `import { projectCanvasNodes } from '@/utils/projectCanvasNodes'` 为证），plan 路径引用不改。
19b. **【第四轮复审补丁（2026-10-02，三份评审收敛后文本级修订——不升版评审轮】**：
    (i) **"分工单点"传播缺口（同型失误第四次的封堵）**：19(a) 立的"participation 裁决/buildCopyPlan 构造"分工没有贯穿到调用面——copyPlan 测试三用例仍传裸组 id（`['g2']` 不含 `'x'` 则按契约不该有 x 的副本，"成员纳入"断言必然落空）、duplicateNodes/paste 薄壳 `ids` 直通。修订：测试统一经 `dupIds(records, ids)`（participation 组合取输入——兼作分工契约的组合测试）；薄壳显式"participation 裁决→records 组装（闭包∪选集）→buildCopyPlan(p.ids)"；clipboard schema=`{ records, ids: 拷贝时已裁决的闭包 ids, edges }`（粘贴不重推导——拷贝到粘贴之间成员/隐藏态可能变化，存裁决结果是保真选择）。**流程规则升格：每立一个新裁决，先枚举其全部复述点（测试输入+三薄壳+clipboard schema）再动笔，而非事后 grep 碰运气。**
    (j) **两处旧复述清剿漏网**：2d-8 验收第 2 条"分镜组折叠往返"（不可达，改"不可折叠验证"）；注记 10"duplicate=可见子〔排除 hidden〕"v2 旧裁决未加推翻指针（hidden 面清剿漏网——让位/棘轮均已清，已补）。
    (k) **P2 采纳**：groupHidesChildren 同引落 2a-2 Files+实现（groupDerive.ts:10 现有独立一份规则）；2b-1 补 headers 超时测试（AbortController 新机制零覆盖）；自愈分支走 resolveExpandedFrame 单源（不直算第二份 calcStoryboardSize）；:1178"折叠态先展开"对脏组失效+运行中会话脏 intent 不经加载边界——两处残留登记（2d-1，无需代码）；2d-1 补四段小步执行建议。
    (l) **驳回**：报告称"GroupToolbar:60 无条件渲染折叠钮（storyboard 传 noOp 即死按钮）"——不成立：折叠钮在 `p.groupType==='normal'` 条件块内（:58-60），storyboard 分支（:69）只渲染注入 children，**无死按钮**；CanvasView:623/:625 的 `collapsed={false}+onCollapse={noOp}` 是死 props（传入但无渲染消费）——2d-1 改为核验结论+死 props 随手删。

20. **【执行期勘误（2026-10-02，2a 分片落地现场复证——按头部"行号引用规则"登记）】**：
    (a) **2a-2 plan 实现代码与 plan 自带测试矛盾**：`if (n.parentId && idSet.has(n.parentId)) continue;` 会使父组已选中的子不落任何桶 → 测试 1（detachedChildren=[a,b]）与 arrange 用例（excluded.detached===2）必红——测试为权威（契约 1 两段式=结构分桶+策略表裁决），实现删该行（a1f7247f）；participation 另补 detached 循环 `outSet.has(n.id)` 守卫（闭包已纳员不得重复计 excluded——质量审发现的 plan 外缺陷，f6949c3f）。
    (b) **shared 测试文件名 .spec.ts→.test.ts**：tsconfig.build 只 exclude `*.test.ts`，.spec 会泄入 dist；仓内 4 个既有同包文件全 .test——2b/2d 的 shared 新 spec 同步用 .test.ts。
    (c) **calcDefaultGrid 返回 {rows,cols} 对象**非数字（geometry.ts:32）——arrangeRects 取 `.cols`（dac03222）。
    (d) **类型/记录形态适配**：plan 的 `CanvasNode` 类型不存在（用 @xyflow/react `Node`）；`CanvasNodeRecord` 无 extent 键——copyPlan detached 顶层化的 `extent=undefined` 语义以"副本记录不写 extent 键"表达（键缺省≡undefined，33dd0091）。
    (e) 2a-6 实仓函数名与 plan 近似名有差（clipboard 对真实名适配）；粘贴缝=GroupContextMenu 内 `screenToFlowPosition`；position 模式锚=首个顶层原件平移整选；边 id store 层 `getId('edge')` 重生成（保 F4 幂等语义）——均已注释落契约。

**单测运行命令**：
- web：`pnpm --filter @flowweb/web test -- --run <路径片段>`
- shared：`pnpm --filter @flowweb/shared test -- --run`
- e2e：`pnpm --filter @flowweb/web exec playwright test <spec 路径>`（本地）

**Commit 风格**：中文主题 + `(canvas)`/`(shared)` scope，照 R0/R1 先例。

---

## 分片 2a：命令公共件 + 多选选框 + 排列 + 副本体系统一

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts`（runCommand/resolveNodeData/arrangeSelection/duplicateNodes/折叠清 selected/删 copyNode+buildGroupCopy+rebuildFromClipboard）
- Modify: `apps/web/src/stores/canvasUndo.ts`（无改动——stopCapturing 已在 :35-37，canvasStore 补 import）
- Modify: `apps/web/src/utils/group-frame-writer-guard.test.ts`（ALLOW_FN 扩）
- Modify: `apps/web/src/pages/canvas/components/groups/selectionTokens.ts`（SELECTION_BOX.padding 30 + SELECTION_TOOLBAR 拆分；旧 TOOLBAR 保留至 2c-6 删）
- Create: `packages/shared/src/canvas/arrangeSelection.ts`（sortForArrange/arrangeRects/normalizeSelection/participation/clampToolbarX）
- Create: `packages/shared/src/canvas/copyPlan.ts`（buildCopyPlan）
- Modify: `packages/shared/src/index.ts`（星导出）
- Modify: `apps/web/src/utils/groupDerive.ts`（deriveHidden 改引 shared `groupHidesChildren`——hidden 规则单源，19(i)：否则 2a-2 的"同引"只是注释愿望，groupDerive.ts:10 现有独立一份规则照旧并存）
- Modify: `apps/web/src/pages/canvas/components/groups/SelectionBoxOverlay.tsx`（工具条扩展+hidden 过滤+SELECTION_TOOLBAR）
- Test: `packages/shared/src/canvas/arrangeSelection.spec.ts`（新）、`packages/shared/src/canvas/copyPlan.spec.ts`（新）、`apps/web/src/stores/canvasStore.groups.test.ts`（增补——真装置）、`apps/web/src/pages/canvas/components/groups/SelectionBoxOverlay.test.tsx`（改）

**Task 2a-0：命令公共件——runCommand + resolveNodeData + hidden 写入侧不变量**

- [ ] **Step 1: 写失败测试**——挂 **canvasStore.groups.test.ts 既有真装置**（真 Y.Doc + fillDoc + _setIntentDocForTest + attachUndoManager + applyDocToStore，文件头 :3-12 全套照抄；**禁止 vi.mock canvasIntents**——mock 空投影会让 dispatchProjectionDiff 算 0 intents 后 canvasIntents.ts:286 直接 return，doc 写路径零验证、断言恒绿）：

```ts
describe('runCommand 公共件（2a-0）', () => {
  it('只读会话早退：canEdit=false 时 fn 不执行 + message.warning（先例 :387-390）', () => { /* 经 canEdit mock 或只读态注入 */ });
  it('入口 stopCapturing + 单差分收尾：命令后 doc 与 store 投影等价（checkProjectionInvariant——canvasCollabRuntime.ts:250 既有安全网，每命令一条）', () => {});
  it('单命令单 transact（v2.1）：fn 执行期间 doc 恰发生 1 次 transact（Y.Doc observer 计数——fn 内用 patchGroupDataInner 纯写，防"patchGroupData 自带 dispatch + 外层差分"双 transact 回潮）', () => {});
  it('异常边界（v2.1）：fn 中途抛错（resolveNodeData 缺节点）→ catch 提示 + finally 仍收尾 diff → checkProjectionInvariant 仍成立（store/doc 不分裂）', () => {});
  it('500ms 内连点两次 = 2 undo 项（真 attachUndoManager + um.undo()——照 :393-418 既有装置）', () => {});
  it('getId 跨端防碰撞（v2.1）：掺会话级随机成分后同毫秒两客户端 id 不等', () => {});
});

describe('hidden 写入侧不变量（hidden ⇒ selected===false）', () => {
  it('折叠组：子节点 selected 全部清 false（toggleCollapse 折叠分支）', () => {
    // 夹具：g1 含 a/b，a 先 selected:true → toggleCollapse('g1') → a.selected===false && a.hidden===true（deriveHidden）
  });
  it('转分镜组：子节点 selected 清 false（convertGroup→storyboard）', () => {});
  it('B 端兜底（v2.1）：selected 不进投影键集（projectCanvasNodes.ts:11-19 无 selected、diffProjectionToIntents 只 diff envelope/position/data——已实证）→ A 端折叠清 selected 不同步 B 端；模拟远端 applyDocToStore 后断言 SelectionBoxOverlay 读点过滤（!n.hidden）兜住 selected=true+hidden=true（**动作消费者面登记 R3**：显示侧过滤兜不住键盘命令——B 端 stale selected hidden 子按 Delete/Ctrl+G 仍作用于不可见节点，随 12 处 getMediaUrl 直连同批登记 R3）', () => {});
});
```

- [ ] **Step 2: 跑红** → **Step 3: 实现**——canvasStore.ts：

```ts
import { Origin, stopCapturing } from './canvasUndo';   // v1 只 import Origin——补 stopCapturing

/** R2 新命令唯一入口（v2 裁定+v2.1 异常/单 transact 契约）：canEdit 门 + 单 undo 步 + 差分换芯编排。
 *  仅新命令使用；既有 16 处 capture/diff 点不迁移（spec:169 既有命令不动）。
 *  fn 契约（JSDoc 钉死）：① 只准 plain set（含删键）——组 data 写用 patchGroupDataInner（纯写层），
 *  禁用 patchGroupData（其自带正向 dispatch :1542，叠外层差分=同值写两遍两 transact）；
 *  ② 先取数校验（resolveNodeData 取不到即红）后结构写——抛错须发生在任何写之前；
 *  ③ finally 恒收尾 diff：fn 抛错时 catch 提示不 rethrow，diff 出已写部分——doc≡store 不变量恒成立。 */
const runCommand = (fn: () => void) => {
  if (!canEdit(get())) { message.warning('当前为只读会话，操作已忽略'); return; }
  stopCapturing();
  const before = captureStoreProjection();
  try {
    fn();
  } catch (err) {
    message.error(`操作失败：${(err as Error).message}`);
  } finally {
    get().applyGroupDerivations();
    dispatchProjectionDiff(before, Origin.LocalUser);
  }
};

/** patchGroupData 拆两层（v2.1）：inner=纯写（合并+物理删键，零 dispatch）；
 *  outer=现签名（inner + 首行正向 intent dispatch）——既有 15 处调用点（:307/:747/...零改动）用 outer，
 *  runCommand.fn 内一律用 inner。旧 :1466 注释"自带 dispatch 部分幂等"的容忍依据由拆层终结。 */

/** getId 跨端防碰撞（v2.1）：现实现 prefix_Date.now()_counter（:32-35 实证）跨客户端同毫秒同计数可撞
 *  （Y.Map 键冲突）——掺会话级随机成分（模块初始化一次 randomUUID/random 种子；crypto.randomUUID 有
 *  secure context 限制故用会话种子），R2 的 duplicate/paste 新增两条高频 id 路径，顺手根修。 */

/** 节点配置取数单源（同 projectCanvasNodes 分型）：组=cs data；普通节点=ns 全量，取不到即红（无回落）。
 *  与 projectCanvasNodes.ts:18 的 `?? nd.data ?? {}` 回落刻意不对称（注释互注防"一致性重构"）：
 *  投影回落服务恢复窗口（ns 暂缺不丢投影），副本取数 fail-fast（复制陈旧 cs 值=保真缺陷，宁可红）。 */
const resolveNodeData = (node: CanvasNode, nsNodes: Record<string, AppNode>): Record<string, unknown> => {
  if (node.type === 'group') return node.data ?? {};
  const ns = nsNodes[node.id];
  if (!ns) throw new Error(`resolveNodeData: nodeStore 缺节点 ${node.id}`);
  return ns.data;
};
```

  - toggleCollapse 折叠分支与 convertGroup→storyboard 各补一行子节点 `selected: false`（set 内统一处理）；SelectionBoxOverlay.tsx:15-19 的 forEach 加 `if (n.hidden) return;` 过滤。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2a-0 命令公共件 runCommand/resolveNodeData+hidden 写入侧不变量`

**Task 2a-1：SELECTION_BOX.padding 16→30 + TOOLBAR 拆分（§4.1/§4.2）**

- [ ] **Step 1: 写失败测试**——SelectionBoxOverlay.test.tsx 既有坐标断言五值迁移。**真夹具（:11-20）：50×40 @ {x:100,y:200}，zoom=2，vp={10,20}**（v1 写 b={x:100,y:180,w:60,h:100} 有误，期望值本身正确）。期望值按 spec §4.1 表字面写死：left '194px'→'180px'、top '352px'→'338px'、width '132px'→'160px'、height '164px'→'192px'、贴顶翻转 top '68px'→'84px'。

- [ ] **Step 2: 跑红**——Run: `pnpm --filter @flowweb/web test -- --run SelectionBoxOverlay`，Expected: 5 处坐标断言 FAIL。

- [ ] **Step 3: 实现**——selectionTokens.ts（**现有键名为 borderColor/borderStyle/borderWidth/borderRadius/background/padding/titleExtra——v1 示例的 dashed/radius/bg 是错误键名，勿照抄**）：

```ts
export const SELECTION_BOX = {
  borderColor: 'var(--fw-text)',
  borderStyle: 'dashed',
  borderWidth: 2,
  borderRadius: 8,
  background: 'rgba(0,0,0,0.35)',
  padding: 30,          // §4.1: 16 → 30
  titleExtra: 26,
} as const;

// §4.2 拆分：多选 48/14、组 52/12（容器 padding 8×2 + 按钮 h-8(32)=48 / h-9(36)=52）
export const SELECTION_TOOLBAR = { height: 48, offset: 14 } as const;
export const GROUP_TOOLBAR = { height: 52, offset: 12 } as const;
// 旧 TOOLBAR={40,12}（selectionTokens.ts:38）保留——消费点 GroupToolbar 在 2c-6 迁移后删除（v1 在本片删会打红 GroupToolbar）
```

SelectionBoxOverlay.tsx 定位改用 SELECTION_TOOLBAR（offset 12→14、height 40→48 参与贴顶翻转公式）。

- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2a-1 选框 padding 30+TOOLBAR 拆分（SELECTION_TOOLBAR/GROUP_TOOLBAR）`

**Task 2a-2：shared 纯函数——normalizeSelection 三桶 + participation 闭包策略表（契约 1）**

- [ ] **Step 1: 写失败测试**

```ts
// packages/shared/src/canvas/arrangeSelection.spec.ts
import { describe, it, expect } from 'vitest';
import { normalizeSelection, participation } from './arrangeSelection';

const G = (id: string, children: string[], extra: Record<string, unknown> = {}) =>
  ({ id, type: 'group', parentId: undefined, position: { x: 0, y: 0 }, data: { groupType: 'normal', cells: children, ...extra } });
const N = (id: string, parentId?: string) =>
  ({ id, type: 'imageGen', parentId, position: { x: 0, y: 0 }, data: {} });

// 基础夹具：组 g1 含 a/b（b 同时选中=detached）；c 顶层 loose
const nodes: any[] = [G('g1', ['a', 'b']), N('a', 'g1'), N('b', 'g1'), N('c')];
// 折叠夹具：g2 折叠含 x/y；s1 分镜组含 p/q
const collapsed = (extra: Record<string, unknown> = {}) =>
  [G('g2', ['x', 'y'], { collapsed: true, ...extra }), N('x', 'g2'), N('y', 'g2')];

describe('normalizeSelection 三桶（契约 1 两段式）', () => {
  it('选中 [c,a,b,g1] → groups=[g1] looseRoots=[c] detachedChildren=[a,b]', () => {
    const r = normalizeSelection(nodes as any, ['c', 'a', 'b', 'g1']);
    expect(r.groups.map((g) => g.id)).toEqual(['g1']);
    expect(r.looseRoots.map((n) => n.id)).toEqual(['c']);
    expect(r.detachedChildren.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });
  it('选中父组未选时子选中 → 子落 detached', () => {
    const r = normalizeSelection(nodes as any, ['a', 'b']);
    expect(r.groups).toEqual([]);
    expect(r.detachedChildren.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });
});

describe('participation 闭包策略表（v2.1：组→成员闭包展开+hidden 语义收窄）', () => {
  it('arrange：groups+looseRoots 参与（组=原子块不展开）、detached 排除并计数', () => {
    const p = participation(normalizeSelection(nodes as any, ['c', 'a', 'b', 'g1']), 'arrange', nodes as any);
    expect(p.ids.sort()).toEqual(['c', 'g1']);
    expect(p.excluded.detached).toBe(2);
  });
  it('duplicate：选中组闭包全量保真——hidden 成员随组纳入（折叠子保留原 rel、分镜子由 copyPlan 层归零）', () => {
    const all: any[] = [...nodes, ...collapsed()];
    const p = participation(normalizeSelection(all, ['g1', 'g2']), 'duplicate', all);
    // g1 展开成员 a/b + g2 折叠成员 x/y 全部纳入（复制折叠组得完整副本继承 collapsed——非空壳）
    expect(p.ids.sort()).toEqual(['a', 'b', 'g1', 'g2', 'x', 'y']);
    expect(p.excluded.hidden).toBe(0);
  });
  it('duplicate 的 hidden 排除仅限 detached/直接选中桶（防陈旧选中产出孤儿副本——2a-0 不变量落地后的防御性兜底）', () => {
    const all: any[] = [...nodes, ...collapsed()];
    // 直接选中折叠组成员 x（不经组闭包——模拟陈旧选中残留）→ 排除并计数
    const p = participation(normalizeSelection(all, ['x']), 'duplicate', all);
    expect(p.ids).toEqual([]);
    expect(p.excluded.hidden).toBe(1);
  });
  it('download：三桶全展开且含 hidden 成员（整组下载语义——spec 契约 1 显式）', () => {
    const all: any[] = [...nodes, ...collapsed()];
    const p = participation(normalizeSelection(all, ['g2']), 'download', all);
    expect(p.ids.sort()).toEqual(['g2', 'x', 'y']);
  });
});
```

- [ ] **Step 2: 跑红**（模块不存在）→ **Step 3: 实现**

```ts
// packages/shared/src/canvas/arrangeSelection.ts
import type { CanvasNodeRecord } from './nodeEnvelope';

export interface SelectionBuckets {
  groups: CanvasNodeRecord[];
  looseRoots: CanvasNodeRecord[];
  detachedChildren: CanvasNodeRecord[];
}

export function normalizeSelection(nodes: CanvasNodeRecord[], ids: string[]): SelectionBuckets {
  const idSet = new Set(ids);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const groups: CanvasNodeRecord[] = [];
  const looseRoots: CanvasNodeRecord[] = [];
  const detachedChildren: CanvasNodeRecord[] = [];
  for (const id of ids) {
    const n = byId.get(id);
    if (!n) continue;
    if (n.type === 'group') { groups.push(n); continue; }
    if (n.parentId && idSet.has(n.parentId)) continue;      // 父组已选——随组闭包处理
    if (n.parentId) detachedChildren.push(n);
    else looseRoots.push(n);
  }
  return { groups, looseRoots, detachedChildren };
}

export type ParticipationAction = 'arrange' | 'duplicate' | 'download';
export interface Participation {
  ids: string[];
  excluded: { detached: number; hidden: number };
  excludedCount: number;
}

/** hidden 判定单源谓词（v2.1）：shared 导出，groupDerive.ts 的 deriveHidden 与本模块同引——防两份规则漂移。 */
export function groupHidesChildren(data: Record<string, unknown>): boolean {
  return data.groupType === 'storyboard' || data.collapsed === true;
}

/** 策略表（契约 1 唯一裁决点，v2.1 语义收窄版）：
 *  arrange=组原子块+散根（detached 排除）；duplicate=组闭包全量保真（hidden 成员随组纳入——复制折叠组得完整副本；
 *  分镜子 rel 归零由 copyPlan 承担）；download=组闭包全部成员。
 *  hidden 排除仅作用于 detached/直接选中桶（防陈旧选中残留产出孤儿副本——2a-0 不变量落地后的防御性兜底）。
 *  性能：预建 Map<parentId, children[]> 一次，勿在组循环内 O(G×N) 全量扫。 */
export function participation(buckets: SelectionBuckets, action: ParticipationAction, nodes: CanvasNodeRecord[]): Participation {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, CanvasNodeRecord[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const list = childrenOf.get(n.parentId) ?? [];
    list.push(n);
    childrenOf.set(n.parentId, list);
  }
  const out: string[] = [];
  const outSet = new Set<string>();
  const push = (id: string) => { if (!outSet.has(id)) { outSet.add(id); out.push(id); } };
  let detached = 0, hidden = 0;
  for (const g of buckets.groups) {
    push(g.id);
    if (action === 'arrange') continue;                       // 组=原子块
    for (const child of childrenOf.get(g.id) ?? []) {        // 闭包全量保真（duplicate/download 均含 hidden 成员）
      if (child.type !== 'group') push(child.id);
    }
  }
  for (const n of buckets.looseRoots) push(n.id);
  for (const n of buckets.detachedChildren) {
    if (action === 'arrange') { detached++; continue; }
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    const isHidden = !!parent && groupHidesChildren(parent.data as Record<string, unknown>);
    if (action === 'duplicate' && isHidden) { hidden++; continue; }   // 陈旧选中残留兜底：孤儿副本不产出
    push(n.id);                                                // 其余 detached 纳入（副本顶层化）
  }
  return { ids: out, excluded: { detached, hidden }, excludedCount: detached + hidden };
}
```

**hidden 语义裁定（v2.1，推翻 v2 的"闭包排除 hidden"）**：三份复审一致指出 v2 版与 2a-6 夹具互相证伪（v2 排除 → `duplicateNodes(['s1'])` 产 cells 全 null 空壳，而 2a-6 断言分镜子纳入副本且 rel 归零）且对现状是行为回归——buildGroupCopy（:1813 `filter(n => n.parentId === groupId)` 无 hidden 过滤）复制全部成员。spec 契约 1"副本排除 hidden"的理由链已被本计划 2a-0 瓦解（hidden⇒selected=false 落地后 hidden 子不在 selected 集，"防陈旧选中"仅剩 detached 桶防御性兜底场景；"分镜子叠一摞"只属 detached 顶层化路径，组闭包内子随组走保留 rel 无叠摞）。**终态：闭包全量保真+detached 桶排除**，spec 契约 1 随回写（v12 裁决 4）。`packages/shared/src/index.ts` 补星导出。**groupHidesChildren 同引落地（19(i)）**：本 task 同 commit 改 `groupDerive.ts` deriveHidden（:10 现有 `storyboard||collapsed` 独立一份）改引 shared 谓词——"单源"必须落到文件，不能只落在注释。

- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(shared): R2a-2 选区归一三桶+参与闭包策略表（纯函数）`

**Task 2a-3：shared 纯函数——sortForArrange 行优先 + arrangeRects 三模式（F40）**

- [ ] **Step 1: 写失败测试**

```ts
// 追加到 arrangeSelection.spec.ts
import { sortForArrange, arrangeRects, ARRANGE_GAP } from './arrangeSelection';

describe('sortForArrange 行优先（F40：y 容差 8px 分行、行内 x 升序——先分行再行内排序）', () => {
  it('同行（|Δy|<8 对行首）按 x 升序；跨行按 y 升序', () => {
    const items = [
      { id: 'b', x: 200, y: 100 }, { id: 'a', x: 0, y: 100 },
      { id: 'd', x: 0, y: 105 }, { id: 'c', x: 0, y: 130 },
    ];
    // 第一行 {a(0,100), b(200,100), d(0,105)}（d 与行首差 5<8），行内 x 升序 → [a,d,b]；第二行 [c]
    expect(sortForArrange(items).map((i) => i.id)).toEqual(['a', 'd', 'b', 'c']);
  });
});
```

（v1 期望 `['a','b','d','c']` 是"整体 (y,x) 排序后切行"的产物——行内 x 非升序，违反 spec F40"行内 x 升序"字面，已改。）

```ts
describe('arrangeRects 三模式（§4.3）', () => {
  const rects = [
    { x: 0, y: 0, width: 100, height: 50 },
    { x: 500, y: 500, width: 60, height: 80 },
    { x: 200, y: 40, width: 40, height: 40 },
  ];
  it('grid：列数 calcDefaultGrid(3)=2；相邻列间距=列宽+GAP；尺寸不变；n≤1 no-op', () => {
    const out = arrangeRects(rects, 'grid');
    expect(out[1].x - out[0].x).toBe(100 + ARRANGE_GAP);      // 相对断言（平移不变）——v1 的绝对值断言经中心归位平移后必红
    out.forEach((r, i) => { expect(r.width).toBe(rects[i].width); expect(r.height).toBe(rects[i].height); });
    expect(arrangeRects([rects[0]], 'grid')).toEqual([rects[0]]);
  });
  it('grid 中心回归锚：输出包围盒中心==输入包围盒中心（实现按此不变量平移——回归锚，非独立判别）', () => {
    const c = (rs: typeof rects, axis: 'x' | 'y') => {
      const lo = Math.min(...rs.map((r) => r[axis]));
      const hi = Math.max(...rs.map((r) => axis === 'x' ? r.x + r.width : r.y + r.height));
      return (lo + hi) / 2;
    };
    const out = arrangeRects(rects, 'grid');
    expect(c(out, 'x')).toBeCloseTo(c(rects, 'x'), 6);
    expect(c(out, 'y')).toBeCloseTo(c(rects, 'y'), 6);
  });
  it('horizontal：单行；相邻间距=前行宽+GAP（相对断言）', () => {
    const out = arrangeRects(rects, 'horizontal');
    expect(new Set(out.map((r) => r.y)).size).toBe(1);
    expect(out[1].x - out[0].x).toBe(100 + ARRANGE_GAP);
    expect(out[2].x - out[1].x).toBe(60 + ARRANGE_GAP);
  });
  it('vertical：单列', () => {
    const out = arrangeRects(rects, 'vertical');
    expect(new Set(out.map((r) => r.x)).size).toBe(1);
  });
  it('混排顶对齐：行高=max', () => {
    const mixed = [{ x: 0, y: 0, width: 100, height: 50 }, { x: 0, y: 0, width: 100, height: 200 }];
    const out = arrangeRects(mixed, 'horizontal');
    expect(out[1].y).toBe(out[0].y);
    expect(out[1].x - out[0].x).toBe(100 + ARRANGE_GAP);
  });
});
```

- [ ] **Step 2: 跑红** → **Step 3: 实现**

```ts
// 追加到 packages/shared/src/canvas/arrangeSelection.ts
import { calcDefaultGrid } from './geometry';

export const ARRANGE_ROW_TOLERANCE = 8;
export const ARRANGE_GAP = 60;
export type ArrangeMode = 'grid' | 'horizontal' | 'vertical';

/** F40：先按 y 升序遍历分行（对行首 y 判容差），再每行内按 x 升序——spec"行内 x 升序"字面。 */
export function sortForArrange<T extends { x: number; y: number }>(items: T[]): T[] {
  const byY = [...items].sort((a, b) => a.y - b.y);
  const rows: T[][] = [];
  for (const it of byY) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(it.y - row[0].y) < ARRANGE_ROW_TOLERANCE) row.push(it);
    else rows.push([it]);
  }
  return rows.flatMap((row) => [...row].sort((a, b) => a.x - b.x));
}

export interface ArrangeRect { x: number; y: number; width: number; height: number; }

/** §4.3：cell=行 max 高×列 max 宽、节点按 cell 左上角落位（自身尺寸不变）、n≤1 no-op、包围盒中心不变。 */
export function arrangeRects(rects: ArrangeRect[], mode: ArrangeMode): ArrangeRect[] {
  const n = rects.length;
  if (n <= 1) return rects;
  const cols = mode === 'horizontal' ? n : mode === 'vertical' ? 1 : calcDefaultGrid(n);
  const rows = Math.ceil(n / cols);
  const colW: number[] = [], rowH: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    colW[c] = Math.max(colW[c] ?? 0, rects[i].width);
    rowH[r] = Math.max(rowH[r] ?? 0, rects[i].height);
  }
  const xs: number[] = [0];
  for (let c = 1; c < cols; c++) xs[c] = xs[c - 1] + colW[c - 1] + ARRANGE_GAP;
  const ys: number[] = [0];
  for (let r = 1; r < rows; r++) ys[r] = ys[r - 1] + rowH[r - 1] + ARRANGE_GAP;
  const laid = rects.map((r, i) => ({ ...r, x: xs[i % cols], y: ys[Math.floor(i / cols)] }));
  const dx = bboxCenter(rects, 'x') - bboxCenter(laid, 'x');
  const dy = bboxCenter(rects, 'y') - bboxCenter(laid, 'y');
  return laid.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
}
function bboxCenter(rects: ArrangeRect[], axis: 'x' | 'y'): number {
  const lo = Math.min(...rects.map((r) => r[axis]));
  const hi = Math.max(...rects.map((r) => (axis === 'x' ? r.x + r.width : r.y + r.height)));
  return (lo + hi) / 2;
}
```

- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(shared): R2a-3 sortForArrange 先分行再行内排序+arrangeRects 三模式（F40）`

**Task 2a-4：clampToolbarX 水平夹取纯函数（§4.3）**

- [ ] **Step 1: 写失败测试**

```ts
describe('clampToolbarX 水平夹取（§4.3）', () => {
  it('超左缘右移至 margin；恰右界与超右缘左移至 vw-margin-w', () => {
    expect(clampToolbarX(-50, 200, 1000, 8)).toBe(8);
    expect(clampToolbarX(980, 200, 1000, 8)).toBe(792);
    expect(clampToolbarX(808, 200, 1000, 8)).toBe(792);   // 恰在边界（v1 第三例 400 界内原值判别力弱，改边界例）
  });
  it('窄视口（vw-margin-w < margin）双边兜底不小于 margin', () => {
    expect(clampToolbarX(50, 200, 100, 8)).toBe(8);       // v1 实现会返回负值
  });
});
```

- [ ] **Step 2: 跑红** → **Step 3: 实现**

```ts
/** §4.3：工具条定位水平 clamp——x 为 translate(-50%) 前的原始 left。窄视口双边兜底（Math.max 外包）。 */
export function clampToolbarX(x: number, toolbarW: number, viewportW: number, margin = 8): number {
  return Math.max(margin, Math.min(x, viewportW - margin - toolbarW));
}
```

（toolbarW/viewportW 的测量源在 2a-7 接线时定：portal 容器 clientWidth——jsdom 下 stub。）

- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(shared): R2a-4 clampToolbarX 水平夹取（窄视口双边兜底）`

**Task 2a-5：canvasStore.arrangeSelection（§4.3 写回）**

- [ ] **Step 1: 写失败测试**——**真装置**（照 canvasStore.groups.test.ts 骨架：真 Y.Doc + fillDoc + _setIntentDocForTest + applyDocToStore；涉及 undo 的用例 attachUndoManager 照 :393-418）。测试文件可扩 groups.test.ts 或新建 canvasStore.arrange.spec.ts（装置照抄，**禁止 vi.mock canvasIntents/antd**——toast 断言以仓内惯例为准：grep `message.warning` 于 canvasStore 相关 spec，若惯例不测 toast 只测 no-op 则从惯例）：

```ts
describe('arrangeSelection（§4.3）', () => {
  it('参与项 <2 → no-op（组内单节点 detached 不动）+ 参与项 0/1 分别提示', () => {});
  it('detached 排除零位移 + excludedCount 计数提示（N 个组内节点未参与排列）', () => {});
  it('两个散根 grid：真重排 + parentId 逐节点不变（反向断言）+ 保持原选区 + checkProjectionInvariant', () => {});
  it('组=原子块 stored rect：组 position 重排、组内子节点 rel 不变；排列后不 refit 组框（applyGroupDerivations 仅派生 hidden——refit 属 2c-4 显式几何命令语义，两 task 口径不同非矛盾）', () => {});
  it('500ms 内连点两次 = 2 undo 项（真 UndoManager）+ 入口 stopCapturing（F13）', () => {});
});
```

- [ ] **Step 2: 跑红**（action 不存在）→ **Step 3: 实现**——canvasStore.ts：

```ts
arrangeSelection: (ids, mode) => {
  const s = get();
  const buckets = normalizeSelection(s.nodes as any, ids);
  const p = participation(buckets, 'arrange', s.nodes as any);
  if (p.ids.length < 2) {
    message.warning(p.excludedCount > 0 ? '没有可排列的节点：所选节点均在未选中的组内' : '没有可排列的节点');
    return;
  }
  runCommand(() => {
    // storedRectOf（v2.1 简化）：信封恒等可见盒在现状即成立（折叠组信封=COLLAPSED_SIZE、分镜组信封=配置尺寸——
    // 2d-1 只是把不变量固化），直接读 n.width/height + DEFAULT_CHILD_SIZE 兜底即可——
    // 不再用 calcStoryboardSize 重算（防第二真相与信封竞争；v2 版的分镜重算分支作废）。
    const storedRectOf = (n: CanvasNode): { width: number; height: number } => ({
      width: n.width ?? DEFAULT_CHILD_SIZE.width,
      height: n.height ?? DEFAULT_CHILD_SIZE.height,
    });
    const items = sortForArrange(p.ids.map((id) => {
      const n = s.nodes.find((x) => x.id === id)!;
      const wh = storedRectOf(n);
      return { id, x: n.position.x, y: n.position.y, ...wh };
    }));
    const laid = arrangeRects(items.map(({ id, ...r }) => r), mode);
    set((st) => ({
      nodes: st.nodes.map((n) => {
        const i = items.findIndex((it) => it.id === n.id);
        return i === -1 ? n : { ...n, position: { x: laid[i].x, y: laid[i].y } };
      }),
    }));
    if (p.excludedCount > 0) message.warning(`${p.excludedCount} 个组内节点未参与排列（需调整请先选中其所在组）`);
  });
},
```

  - **几何写者登记**：arrangeSelection 直写参与项 position（排列语义正确——refit 会把组框拉回子 bbox）→ **group-frame-writer-guard.test.ts 的 ALLOW_FN 扩 `arrangeSelection:`**（含测试更新：新增"arrangeSelection 内允许直写 position"正例）。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2a-5 arrangeSelection 写回（runCommand+组原子块+白名单登记）`

**Task 2a-6：副本体系统一——buildCopyPlan 纯函数 + 三薄壳 + 删三旧函数（F12/注记 9）**

- [ ] **Step 1: 写失败测试**

```ts
// packages/shared/src/canvas/copyPlan.spec.ts（新）
import { describe, it, expect } from 'vitest';
import { buildCopyPlan } from './copyPlan';
import { normalizeSelection, participation } from './arrangeSelection';

const G = (id: string, cells: string[], extra: any = {}) =>
  ({ id, type: 'group', parentId: undefined, position: { x: 0, y: 0 }, width: 400, height: 300, data: { groupType: 'normal', cells, ...extra } });
const N = (id: string, parentId?: string, extra: any = {}) =>
  ({ id, type: 'imageGen', parentId, position: parentId ? { x: 20, y: 50 } : { x: 100, y: 100 }, data: { fileId: 'f1', prompt: 'p-ns', ...extra } });

// 19(i) 分工契约组合测试缝：buildCopyPlan 只接收已裁决 ids——测试输入统一经 participation 组合取得
// （传裸组 id 违反契约：['g2'] 不含 'x' 则不该有 x 的副本，"折叠组成员纳入"断言必然落空）
const dupIds = (records: any[], ids: string[]) =>
  participation(normalizeSelection(records, ids), 'duplicate', records).ids;

describe('buildCopyPlan（副本构造体——分工单点：participation 裁决前置）', () => {
  it('组闭包：选中组→成员全纳入，cells 重映射（无旧 id 残留），子副本数==源子节点数', () => {
    const records: any[] = [G('g1', ['a', 'b']), N('a', 'g1'), N('b', 'g1')];
    const plan = buildCopyPlan(records, dupIds(records, ['g1']), { offset: { x: 40, y: 0 } }, () => 'new-id');
    const newG = plan.copies.find((c) => c.type === 'group')!;
    expect(plan.copies.filter((c) => c.parentId === newG.id).length).toBe(2);
    expect(newG.data.cells.every((c: string) => plan.idMap.has?.(c) || c === null || !records.some((r) => r.id === c))).toBe(true); // cells 无旧 id
  });
  it('data 保真：普通节点副本 data=records 输入（调用方已按 resolveNodeData 组装 ns 全量）——prompt 等非桥接键逐字保真', () => {
    const records: any[] = [N('n1', undefined, { prompt: '用户改过的长提示词' })];
    const plan = buildCopyPlan(records, dupIds(records, ['n1']), { offset: { x: 40, y: 0 } }, () => 'c1');
    expect((plan.copies[0].data as any).prompt).toBe('用户改过的长提示词');
  });
  it('hidden 保真（v2.2 翻转——与 2a-2 闭包全量保真对齐）：折叠组成员随组入副本集（parentId=组副本 id、rel 保留）+ 副本组继承 collapsed/savedSize；分镜子副本 position 归零 {0,0}', () => {
    const records: any[] = [
      G('g2', ['x'], { collapsed: true, savedSize: { width: 600, height: 400 } }), N('x', 'g2'),
      G('s1', ['p'], { groupType: 'storyboard' }), N('p', 's1'),
    ];
    const dup = buildCopyPlan(records, dupIds(records, ['g2']), { offset: { x: 40, y: 0 } }, () => 'd');
    const newG = dup.copies.find((c) => c.type === 'group')!;
    expect(dup.copies.filter((c) => c.parentId === newG.id).length).toBe(1);   // 折叠组成员纳入（非空壳）
    expect((newG.data as any).collapsed).toBe(true);                            // 副本继承 collapsed
    const st = buildCopyPlan(records, dupIds(records, ['s1']), { offset: { x: 40, y: 0 } }, () => 's');
    const child = st.copies.find((c) => c.parentId !== undefined)!;
    expect(child.position).toEqual({ x: 0, y: 0 });                              // 分镜子 rel 恒 0
  });
  it('detached 副本顶层化：parentId=undefined + 绝对坐标（父位置+rel）+offset + extent=undefined（F41）', () => {
    const records: any[] = [G('g1', ['a'], { position: { x: 100, y: 100 } }), N('a', 'g1')];
    const plan = buildCopyPlan(records, dupIds(records, ['a']), { offset: { x: 40, y: 0 } }, () => 'c');
    expect(plan.copies[0].parentId).toBeUndefined();
    expect(plan.copies[0].position).toEqual({ x: 160, y: 150 });
  });
  it('选区闭包互连边重映射（两端都在复制集内）；selected：组副本 true / 子副本 false', () => {});
});
```

```ts
// store 侧（挂真装置）：三条保真断言先行——现状必红（buildGroupCopy structuredClone cs data，prompt 是创建时旧值）
describe('duplicateNodes/duplicateGroup/paste 三薄壳（2a-6）', () => {
  it('保真①：子节点数相等（选组复制不产空壳——v1 缺陷回归锚）', () => {});
  it('保真②：非桥接键 prompt 取 ns 全量（ns 改后复制得新值；buildGroupCopy 旧路径得 cs 陈旧值——先红）', () => {});
  it('保真③：cells 无旧 id；组 data（color/name）保真；折叠组副本继承 collapsed', () => {});
  it('duplicateGroup ≡ duplicateNodes([id])（等价断言——v1 的猴补 spy 空转作废）', () => {
    seedGroup('g1');
    cs().duplicateGroup('g1');
    const viaNodes = /* 记录产物 */;
    // 等价断言：两条路径产物逐键深等（除 id）
  });
  it('粘贴坐标经 screenToFlowPosition（GroupContextMenu 现直传 clientX/clientY——以现场为准）+ clipboard 存 ns 全量快照（**schema 明确含 edges**——buildCopyPlan 有 edges 参，粘贴互连边重映射依赖它）', () => {});
  it('paste 补 undo 断言（v2.1）：500ms 内连点两次粘贴 = 2 undo 项——v2 唯独 paste 漏了（其余命令均有）', () => {});
  it('B-2 顺序（cs set 先于 ns.addNode——addNode 单参 (node: AppNode)，v1 两参调用作废）+ 500ms 连点=2 undo', () => {});
  it('copyNode/buildGroupCopy/rebuildFromClipboard 已删——接口与实现零残留（grep 三符号全仓零命中）', () => {
    expect((cs() as any).copyNode).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑红** → **Step 3: 实现**：
  - `packages/shared/src/canvas/copyPlan.ts`：

```ts
/** 副本构造体（注记 9/19a 分工单点）：闭包展开与 hidden/detached 裁决由 participation('duplicate') 前置完成
 *  （hidden 排除仅 detached/直接选中桶——2a-2），本函数只接收已裁决 ids 做纯映射构造，不再自行闭包过滤。
 *  records=调用方经 resolveNodeData 组装的记录集（组=cs data、普通=ns 全量）。 */
export interface CopyPlan {
  copies: CanvasNodeRecord[];
  newEdges: { id: string; source: string; target: string }[];
  idMap: Map<string, string>;
}
export function buildCopyPlan(
  records: CanvasNodeRecord[],
  ids: string[],           // 已含闭包成员（participation 输出）
  placement: { offset?: { x: number; y: number }; position?: { x: number; y: number } },
  newId: () => string,
  edges: { id: string; source: string; target: string }[] = [],
): CopyPlan { /* idMap 两遍→副本构造（组 selected 继承+子 false、detached 顶层化+extent 标记、分镜子 {0,0}、折叠子保留原 rel）→互连边重映射 */ }
```

  - canvasStore.ts 三薄壳（19(i)：裁决环节显式——`ids` 形参是原始选集，**禁止直通** buildCopyPlan）：
    - `duplicateNodes(ids)`：`runCommand` 内 **participation 裁决**（`normalizeSelection(s.nodes, ids)` + `participation(…, 'duplicate', s.nodes)` → 闭包 ids+excluded 计数）→ `resolveNodeData` 组装 records（范围=闭包∪选集）→ `buildCopyPlan(records, p.ids, { offset: DUPLICATE_OFFSET }, () => getId('node'), s.edges)` → `setWithParentOrder` 追加（**父子结构写一律走 setWithParentOrder**——RF v12 要求父先于子，:187-193）→ 原选中置 false → 普通副本 `ns.addNode({ id, type, data } as AppNode)`（**单参**）→ derive 由 runCommand 收尾；
    - `duplicateGroup(groupId)` = `duplicateNodes([groupId])` 薄壳（返回值语义维持 string | null 或随统一改 void——以接口现状最小改动为准）；
    - `copyGroupToClipboard/pasteGroupClipboard`：clipboard schema=**`{ records, ids: 拷贝时已裁决的闭包 ids, edges }`**（粘贴时不重推导——拷贝到粘贴之间成员/隐藏态可能变化，存裁决结果是保真选择；records 为 ns 全量快照）；粘贴 `buildCopyPlan(records, clipboard.ids, { position: screenToFlowPosition(clientX, clientY) })`；
  - **删除**：copyNode（接口 :134+实现 :341-380）、buildGroupCopy（:1802-1891）、rebuildFromClipboard（:1894-1976）+ 各自测试改写为 buildCopyPlan/三薄壳断言（grep `copyNode|buildGroupCopy|rebuildFromClipboard` 全仓逐处处理）；
  - DUPLICATE_OFFSET 常量单源（canvasStore 顶部或 selectionTokens）。
- [ ] **Step 4: 跑绿**（含三符号 grep 零残留 + api 侧无涉）+ **Step 5: Commit** `feat(canvas): R2a-6 副本体系统一 buildCopyPlan（三薄壳+三旧函数退役——F12/F41/注记9）`

**Task 2a-7：SelectionBoxOverlay 工具条扩展（排列▾/创建副本）+ 浮层交互规格**

- [ ] **Step 1: 写失败测试**——SelectionBoxOverlay.test.tsx 增补。**装置**：组件直取 store 的新命令（arrangeSelection/duplicateNodes）须在测试文件 mock（`vi.mock('@/stores/canvasStore')` 或注入——防点击即抛；既有 :23-25 mock 面同步补）：

```ts
it('工具条含排列菜单（网格/水平/垂直）+创建副本按钮；点外/Esc 关闭；aria 齐全（§4.3 浮层规格）', async () => {
  renderOverlay({ selected: 2 });
  const arrangeBtn = screen.getByRole('button', { name: /排列/ });
  expect(arrangeBtn).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(arrangeBtn);
  expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((el) => el.textContent)).toEqual(['网格', '水平', '垂直']);
  fireEvent.click(within(screen.getByRole('menu')).getByText('水平'));
  expect(onArrangeMock).toHaveBeenCalledWith(['n1', 'n2'], 'horizontal');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
});
it('创建副本按钮调 duplicateNodes(选中 ids 全量)', () => {});
it('水平夹取：选框近左缘时工具条 left ≥ 8（clampToolbarX 接线——toolbarW/viewportW 测量源=node-toolbar-portal 容器 clientWidth，jsdom 下 stub getBoundingClientRect/clientWidth）', () => {});
```

- [ ] **Step 2: 跑红** → **Step 3: 实现**——SelectionBoxOverlay.tsx：
  - 工具条容器按 §4.3 视觉规格（padding 8/gap 8/圆角 12/0.5px 边框 `--canvas-controls-border`/背景 `--canvas-controls-bg`/阴影/blur 16）；
  - `[排列▾]` 菜单（浮层交互统一规格：click toggle/mousedown outside 关/Esc 关/`aria-expanded`+`role=menu`/`menuitem`/浮层元素带 `nodrag nopan` className——NormalGroupRenderer.tsx:70 先例）；水平定位接 `clampToolbarX`；
  - `[创建副本]` 组件内 `duplicateNodes(selectedIds)`；排列菜单项调 `arrangeSelection(selectedIds, mode)`——接线方式照打组▾ 现状（grep `groupNodes` 于该组件同型）；
  - ids 来源：nodeLookup 遍历处已有 `!n.hidden` 过滤（2a-0）。
- [ ] **Step 4: 跑绿** + 全量 web 回归 + **Step 5: Commit** `feat(canvas): R2a-7 多选工具条扩展（排列三模式+创建副本+水平夹取+浮层规格）`

**Task 2a-8：2a 批尾**

- [ ] **Step 1**: `pnpm --filter @flowweb/web test -- --run` 全绿 + `pnpm verify` + `pnpm --filter @flowweb/shared test -- --run`。
- [ ] **Step 2**: 浏览器冒烟（dev 起服务）：多选两节点→排列三模式生效、detached 提示出现、创建副本偏移 40px、undo 一步回滚整组副本；**双标签页：A 排列/复制 → B 一致 → A undo → B 一致**。
- [ ] **Step 3**: Commit（若有收尾文件）+ 完成记录表填 2a 行（含红相证据链接）。

---

## 分片 2b：批量下载全链路 + F7 缓存自愈 + mediaUrl 读写收敛（F37）

**Files:**
- Create: `apps/web/src/utils/mediaDownload.ts`、`apps/web/src/utils/batchDownload.ts`、`apps/web/src/utils/collectDownloadables.ts`
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx:139-153`、`ImageFullscreenViewer.tsx:69-78`、`VideoGenNode.tsx:266-275`、`VideoFullscreenViewer.tsx:58-67`（4 处下载替换——实际路径在 `pages/canvas/components/nodes/`，行号以 grep `createObjectURL` 现场重校准）
- Modify: `apps/web/src/utils/mediaUrlCache.ts`（临期判据+invalidateMediaUrl）、`apps/web/src/hooks/useMediaUrl.ts`（onError 自愈）
- Modify: `apps/web/src/pages/canvas/components/groups/SelectionBoxOverlay.tsx`（批量下载按钮）
- Modify: `apps/web/src/stores/canvasStore.ts`（删 mediaUrl 写点 4 处+nodeStore 双写）
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx:182`（素材库拖入删 mediaUrl——注意路径在 components/ 下）
- Modify: `apps/web/src/stores/nodeStore.ts:245`（CANVAS_BRIDGE_KEYS 剥 mediaUrl）
- Modify: `apps/web/src/pages/canvas/components/groups/StoryboardCell.tsx`、`GroupNode.tsx:55`（读点收敛）
- Modify: `apps/web/scripts/eslint-rules/collab-static-asserts.js` + `apps/web/eslint.config.js` + `apps/web/scripts/lint-gate.mjs` + `apps/web/scripts/__tests__/lint-gate.fixture.test.mjs`（门禁第六条四步闭环）
- Test: mediaDownload.spec.ts / collectDownloadables.spec.ts（新）、mediaUrlCache+useMediaUrl 增补、SelectionBoxOverlay.test.tsx 增补、CanvasView.test.tsx:247 / GroupNode.test.tsx:55（mediaUrl 断言迁移面）、ImageFullscreenViewer.test.tsx:415-418（假定时器迁移）

**Task 2b-1：downloadMediaFile 共享 util（§4.3 批量下载件 + 4 处存量缺陷合并）**

- [ ] **Step 1: 写失败测试**

```ts
// apps/web/src/utils/mediaDownload.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadMediaFile } from './mediaDownload';

function stubAnchor() {
  const click = vi.fn();
  const a: any = { click, href: '', download: '', style: {}, remove: vi.fn() };
  // v2：限定 tag==='a' 才返回桩——v1 的全量 mockReturnValue 会把 document.body.appendChild 等其他 createElement 一并卷进桩
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => tag === 'a' ? a : document.createElementNS('http://www.w3.org/1999/xhtml', tag)) as any);
  return { a, click };
}

describe('downloadMediaFile（§4.3：url 优先、缺则 fileId 现取、失败重取一次、60s revoke、结果对象）', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('url 直用不查 fileId；a.download=filename（mediaName 链由调用方组装）；60s 后 revoke（非同步）', async () => {
    const { a, click } = stubAnchor();
    const revoke = vi.fn();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob()) });
    vi.useFakeTimers();
    const r = await downloadMediaFile({ url: 'http://u', filename: '图.png' });
    expect(r).toEqual({ ok: true });
    expect(click).toHaveBeenCalled();
    expect(a.download).toBe('图.png');
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledWith('blob:x');
  });

  it('fetch 失败且有 fileId → 重取一次 URL 再试（长开页面过期自愈——两段显式：取 url → fetch 失败 → 重取 url → 再 fetch）', async () => {
    stubAnchor();
    const getMediaUrl = vi.fn().mockResolvedValue({ url: 'http://fresh', ttlSec: 900 });
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(new Blob()) });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:y');
    await downloadMediaFile({ fileId: 'f1', url: 'http://stale', filename: 'x.png', getMediaUrl });
    expect(getMediaUrl).toHaveBeenCalledWith('f1');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('fetch 网络异常（throw）且有 fileId → 同样重取一次（v2.1——v2 只覆盖 !res.ok，瞬断恰是过期自愈最常见诱因）', async () => {
    stubAnchor();
    const getMediaUrl = vi.fn().mockResolvedValue({ url: 'http://fresh', ttlSec: 900 });
    global.fetch = vi.fn()
      .mockRejectedValueOnce(new Error('net'))
      .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(new Blob()) });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:n');
    const r = await downloadMediaFile({ fileId: 'f1', url: 'http://stale', filename: 'x.png', getMediaUrl });
    expect(r.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('headers 超时（19(i) 补——AbortController 是 v2.2 新机制零覆盖）：挂起 fetch（返回不 resolve 的 promise）+ 假定时器 advanceTimersByTime(30_000) → ctrl.abort() 触发 → 有 fileId 时走重取路径二次尝试成功；timer 双路清理（成功/失败都不泄漏）', async () => {
    stubAnchor();
    const getMediaUrl = vi.fn().mockResolvedValue({ url: 'http://fresh', ttlSec: 900 });
    global.fetch = vi.fn()
      .mockImplementationOnce(() => new Promise(() => {}))          // 挂死——永不 resolve
      .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(new Blob()) });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:t');
    vi.useFakeTimers();
    const p = downloadMediaFile({ fileId: 'f1', url: 'http://stale', filename: 'x.png', getMediaUrl });
    await vi.advanceTimersByTimeAsync(30_000);                      // 触发 abort → 首次 attempt 返回 null → 重取
    const r = await p;
    expect(r.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('最终失败返回 {ok:false, reason}；silent=true 不弹单文件 toast（批路径只聚合——v2.1）', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('net'));
    const error = vi.fn();
    const { message } = await import('antd');
    vi.spyOn(message, 'error').mockImplementation(error);
    const r = await downloadMediaFile({ url: 'http://u', filename: 'x.png' }, { silent: true });
    expect(r.ok).toBe(false);
    expect(error).not.toHaveBeenCalled();
  });

  it('扩展名映射：无扩展名 filename 按 mimeType 兜底', async () => {
    const { a } = stubAnchor();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob([], { type: 'video/mp4' })) });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:z');
    await downloadMediaFile({ url: 'http://u', filename: '视频-abc12' });
    expect(a.download).toBe('视频-abc12.mp4');
  });
});
```

- [ ] **Step 2: 跑红** → **Step 3: 实现**（失败重取改写为显式两段——v1 的 for 循环内 `if (res.ok) break` 出现两次控制流冗余）：

```ts
export type DownloadResult = { ok: true } | { ok: false; reason: string };
// FETCH_TIMEOUT_MS 与 EXT_BY_MIME（mime→扩展名映射）均定义于本 util 内（2b-1）
const FETCH_TIMEOUT_MS = 30_000;

export async function downloadMediaFile(args: DownloadArgs, opts?: { silent?: boolean }): Promise<DownloadResult> {
  const fetcher = args.getMediaUrl ?? getMediaUrl;
  const fail = (reason: string) => {
    if (!opts?.silent) message.error(`下载失败：${args.filename}`);   // 批路径 silent=true——只聚合提示，防 10 失败刷 11 条 toast
    return { ok: false as const, reason };
  };
  const attempt = async (u: string) => {
    // v2.2：AbortController+headers 后 clearTimeout——AbortSignal.timeout 覆盖 fetch 全生命周期含 body 读取
    // （signal abort 中断流），大视频 30s 内读不完 body 即误杀+串行批量拖死（对现状回归）；
    // 卡死保护限 headers 阶段（无响应的挂死 fetch），body 读取不限时
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(u, { signal: ctrl.signal });
      clearTimeout(timer);
      return res;
    } catch {
      clearTimeout(timer);
      return null;                                                  // 网络异常/headers 超时（throw）触发重取——"长开页面过期自愈"最常见诱因恰是瞬断
    }
  };
  try {
    let url = args.url;
    if (!url && args.fileId) url = (await fetcher(args.fileId)).url;
    let res = url ? await attempt(url) : null;
    if ((!res || !res.ok) && args.fileId) {                  // 首次尝试失败（!ok 或 throw）且有 fileId → 重取一次再试
      url = (await fetcher(args.fileId)).url;
      res = await attempt(url);
    }
    if (!res || !res.ok) return fail('fetch-failed');
    const blob = await res.blob();
    const ext = EXT_BY_MIME[blob.type] ?? '';
    const name = /\.[a-z0-9]{2,5}$/i.test(args.filename) || !ext ? args.filename : args.filename + ext;
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return { ok: true };
  } catch {
    return fail('fetch-failed');
  }
}
```

（getMediaUrl 注入参数保留——测试缝，仓内既有手法。）
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2b-1 downloadMediaFile 共享件（url 优先/fileId 自愈/60s revoke/结果对象）`

**Task 2b-2：4 处存量下载替换（三处行为 delta 明写）**

- [ ] **Step 1: 实现**（各处 file:line 以 grep `createObjectURL` 现场重校准；路径在 `pages/canvas/components/nodes/`）：
  - 四处 fetch→blob→createObjectURL→**同步 revoke** 段替换为 `await downloadMediaFile({ fileId, url, filename })`；
  - **行为 delta ×3（明写非"纯替换"——v1 表述作废）**：① 文件名 `a.download=''` → `data.mediaName ?? \`${类型}-${id.slice(-6)}\``（现状四处全无文件名，spec:175 链）；② 失败回退 `window.open(displayUrl)`（ImageGenNode:147-149 等）→ `message.error`（spec:173"失败 message.error 继续"已裁定）；③ 同步 revoke → 60s 延迟；
  - viewer 类型：ImageFullscreenViewer 的 nodeData 已是 ImageNodeData（**含 fileId，无需新 prop**）；VideoFullscreenViewer 内联类型（:9-15）**无 fileId——需补类型/取数**；
  - `vi.mock('@/utils/mediaDownload')` 捕获调用参数替换各处既有断言；无既有测试的补最小一条。
- [ ] **Step 2: 测试迁移**——ImageFullscreenViewer.test.tsx:415-418 的 revoke 断言在 `vi.waitFor` 内且全文件无假定时器——**改 60s 延迟后必挂**：引入 `vi.useFakeTimers()` + `advanceTimersByTime(60_000)` 迁移该断言。
- [ ] **Step 3: 跑绿** + **Step 4: Commit** `refactor(canvas): R2b-2 四处存量下载切换 downloadMediaFile（同步 revoke 根除+delta×3 登记）`

**Task 2b-3：collectDownloadables 收集集（契约 1 download 闭包策略）**

- [ ] **Step 1: 写失败测试**

```ts
describe('collectDownloadables（participation download=闭包全展开含 hidden）', () => {
  it('图片三型：imageGen 完成=fileId||referenceImage；multiImageGen 主图=images[mainImageIndex]（success）否则首个 success 否则跳过（F15）', () => {
    const nodes: any[] = [
      { id: 'i1', type: 'imageGen', data: { status: 'done', fileId: 'f1' } },
      { id: 'i2', type: 'imageGen', data: { status: 'done', referenceImage: 'r1' } },
      { id: 'm1', type: 'multiImageGen', data: { images: [{ id: 'x1', status: 'failed' }, { id: 'x2', status: 'success' }], mainImageIndex: 0 } },
      { id: 'v1', type: 'videoGen', data: { status: 'done', fileId: 'vf1' } },
    ];
    const r = collectDownloadables(nodes, nodes.map((n) => n.id), () => nodes.reduce((m, n) => ({ ...m, [n.id]: n }), {}));
    expect(r.map((x) => x.fileId)).toEqual(['f1', 'r1', 'x2', 'vf1']);
    expect(r.map((x) => x.filename)).toContain('图片-i1');
  });
  it('选组 → 闭包展开为成员（含折叠组 hidden 成员——v1 空壳缺陷回归锚）', () => {});
  it('mainImageIndex 探针（M8）：cs 陈旧 + ns 新值 → 取 ns 新值（resolveNodeData ns 优先）', () => {
    // cs.data.mainImageIndex=0（旧）、ns.data.mainImageIndex=1 → 收集 images[1]
  });
});
```

（isImageCompletedNode 复用 imageNodeGuards.ts:9；文件名链 `data.mediaName ?? \`${类型}-${id.slice(-6)}\``；签名含 ns 取数源参数——resolveNodeData 注入。）
- [ ] **Step 2: 跑红** → **Step 3: 实现**（内部 normalizeSelection+participation('download')+逐节点提取）。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2b-3 下载收集集（闭包全展开+图片三型+主图选择 F15）`

**Task 2b-4：SelectionBoxOverlay 批量下载按钮 + batchDownload.ts 抽取**

- [ ] **Step 1: 写失败测试**——无可下载项 aria-disabled+handler 守卫；串行+i*300ms；>10 项 Modal.confirm；完成提示聚合"N 成功 / M 失败"（DownloadResult 聚合；**单文件 downloadMediaFile 传 `{silent:true}`**——只聚合不刷 N 条 toast）；首次批量前许可提示（localStorage key **统一 `flowweb_` 下划线前缀**（既有 `flowweb_vp_` 同款——v2 的 `flowweb:batch-dl-hint` 冒号形态与仓内约定不一致，改 `flowweb_batch_dl_hint`）。
- [ ] **Step 2: 跑红** → **Step 3: 实现**——**`apps/web/src/utils/batchDownload.ts` 在本 task 一次抽出**（v1 推迟到 2c-6 作废——串行节流/聚合/许可逻辑单源，2c-6 组工具条直接复用）；工具条补 `[批量下载]` 32×32 图标钮（aria-label；aria-disabled 由 collectDownloadables 空集驱动）。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2b-4 多选工具条批量下载（batchDownload.ts 单源+串行节流+聚合提示）`

**Task 2b-5：F7 缓存自愈两条（临期<60s 续取 + onError 失效重取——v1 遗漏补齐，注记 8）**

> 一个自愈机制的两个入口：临期只覆盖"挂载时刻"（剩余寿命不足），常驻节点失效由 onError 兜——两条是分工不是重复，否认知其一即可删另一。**本 task 先行于 2b-6/2b-7**（读点收敛后 useMediaUrl 成为唯一取源，必须先有自愈再拆兜底）。

- [ ] **Step 1: 写失败测试**

```ts
// mediaUrlCache.spec.ts / useMediaUrl.spec.ts 增补
describe('临期窗口（NEAR_EXPIRY_MS=60_000——判据单点在 mediaUrlCache，hook 内不得出现第二份阈值）', () => {
  it('临期 30s：命中回旧 url + 后台预刷新（二次挂载 0 请求——pending 合并）', () => {});
  it('剩余 120s：零请求（双边界）', () => {});
  it('已过期（<=now）：未命中删条目 + 重取（现状语义维持，勿混淆）', () => {});
});
describe('onError 失效自愈（useMediaUrl 暴露 onError 给 <img>）', () => {
  it('img 加载失败 → invalidateMediaUrl（cache+pending 同清——只清 cache 会被 in-flight 去重短路拿回同一条坏 URL，必红）→ 重取恰一次；第二次 onError 不再重试', () => {});
  it('重取成功：error 清空（error 仅表"取 URL 失败"，自愈成功必须清——避免与 if (error || !url) 分支打架）', () => {});
  it('重取期间 url=null 走占位（禁空串 src）', () => {});
});
describe('长会话恢复', () => {
  it('假定时器推 900s（presign 15min 寿命耗尽）→ 挂载重取（临期档）；已挂载节点经 onError 恢复出图', () => {});
});
```

- [ ] **Step 2: 跑红** → **Step 3: 实现**：
  - `mediaUrlCache.ts`：导出 `NEAR_EXPIRY_MS = 60_000`；命中判据单点改三档——`expiresAt<=now` 未命中删条目（现状）/ `now<expiresAt<=now+NEAR_EXPIRY_MS` stale 命中（返回 `{url, stale:true}` 供 hook 决定回旧值+后台刷新）/ fresh 正常；新增 `invalidateMediaUrl(fileId)`（**cache.delete + pending.delete 同清**）；
  - **在飞 promise 身份校验（v2.1）**：invalidate 清 pending 不取消在飞请求——旧 promise resolve 后 fetchMediaUrl 的 cache.set 会把脏条目按旧 expiresAt 写回（坏 URL 寿命被人为延长、onError 重试必然再失败）。根堵：回填前校验 `pending.get(fileId) === 该 promise`，不等则丢弃结果（2d-4 的 registerInFlight 同款竞态同款处理）；
  - **Number.isFinite 防御（v2.1，spec §4.5 爆炸半径④）**：cacheSet/prefetch 回填的 expiresAt 与 ttlSec 计算处校验有限性（NaN→expiresAt=NaN→比较恒假→永不重取，最隐蔽失效形态）；
  - `useMediaUrl.ts`：stale 命中→立即 setUrl(旧值)+后台 `fetchMediaUrl`（经 pending 合并；**随机提前量 0-5s 防同屏 tile 集体重签**）；暴露 `onError` handler（<img> 挂）——内部=invalidateMediaUrl+每 fileId 一次重试闸（retryRef keyed by fileId；**不可照抄 PlayView.tsx:63 元素级 retriedRef 形态——不清缓存会拿回同一条脏 URL**）；fetch 阶段失败仍走 error 不重试（那只是网络问题）；重试成功清 error；
  - 消费点接线：`<img onError={onError}>`——grep useMediaUrl 消费点（ImageGenNode/VideoGenNode/AudioGenNode/StoryboardCell 等，以 grep 为准）逐处接上；**12 处直连 getMediaUrl 的非展示调用点（8 文件：mediaUploadUtils/CanvasView/canvasStore/ImageGenNode×5/MultiImageNode/MultiImageConfigPanel/VideoGenNode/useImageUpload——v2 写 13 处已勘误）本批不动只登记**；
  - 缓存形状维持 `{url, expiresAt}` 绝对时刻（API 相对 ttlSec 是刻意分工——服务端算剩余规避跨机时钟偏移，勿改）。
  - **迁移面（v2.1 补入 Files）**：cacheGet 返回形状改 `{url, stale}` 波及 useMediaUrl.ts:20 调用点与 mediaUrlCache 自身既有测试——同步迁移。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2b-5 F7 缓存自愈补齐（临期窗口+onError 失效重取+身份校验防脏回写）`

**Task 2b-6：mediaUrl 写入收敛（F37——写点 4 处+双写+桥接键）**

- [ ] **Step 1: 写失败测试**——红相=现状写入存在（改完转绿）：分镜溢出展开节点/addImageToStoryboardCell 建槽位产出节点 data 无 mediaUrl 键（JSON.stringify 不含 'mediaUrl'）；`CANVAS_BRIDGE_KEYS` 不含 mediaUrl。
- [ ] **Step 2: 跑红** → **Step 3: 实现**——canvasStore.ts 写点 **4 处**（:1276/:1395/:1740/:1744——现场 grep 重校准）删 `mediaUrl: …` 键 + nodeStore.ts:245 CANVAS_BRIDGE_KEYS 剥 `'mediaUrl'` + CanvasView.tsx:182 素材库拖入删键（fileId 保留）+ **4 处 as any 写入随删**（ImageNodeData 无该键——收敛即根修证据）。
- [ ] **Step 4: 跑绿**（含迁移面：CanvasView.test.tsx:247（`callArgs[2].mediaUrl` 断言）与 GroupNode.test.tsx:55（夹具）同步迁移）+ **Step 5: Commit** `fix(canvas): R2b-6 mediaUrl 写入面清零（写点 4+双写+桥接键——F37）`

**Task 2b-7：读点收敛（StoryboardCell/GroupNode——依赖 2b-5 先行）**

- [ ] **Step 1: 写失败测试**——StoryboardCell 传入 data.mediaUrl 仍走 useMediaUrl(fileId)（info.url 短路删除断言）；GroupNode.tsx:55 删 mediaUrl 读取分支。
- [ ] **Step 2: 跑红** → **Step 3: 实现**——StoryboardCell.tsx:19-20 改纯 `useMediaUrl(fileId)`（删 `p.info?.url ??` 短路）；GroupNode.tsx:55 删 mediaUrl 分支。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `fix(canvas): R2b-7 mediaUrl 读点清零（过期 URL 短路优先根除——F37 破图窗口消灭）`

**Task 2b-8：lint 门禁第六条 no-mediaurl-write（纯标识符扫描+红相实证）**

- [ ] **Step 1: 实现**——collab-static-asserts.js 新增规则（自动获得 gateActive 测试文件豁免——2b-6 自身的 store 断言不受门禁自打）：
  - **AST 双形态纯标识符扫描（v2 修正——v1 的"addNode/updateConfig/setState 实参内出现"调用上下文限定会假绿：F37 实证 CanvasView 的字面量名是 nodeData，不在那些实参里）**：`Property[key.name='mediaUrl']`（含 shorthand）+ `MemberExpression[property.name='mediaUrl']` 零命中即绿（2b-6/7 收敛后合法残留=注释与测试，测试经 gateActive 豁免；AST 精确键名不命中 mediaUrls/mediaUrlOf 家族——若实现选正则形态须排除家族名与 import/注释，以实测红相为准）；
  - 四步闭环：规则实现 → eslint.config.js 注册（:46-53/:59-66）→ lint-gate.mjs STATIC_ASSERT_RULE_IDS（:29-35）加 ID → `apps/web/scripts/__tests__/lint-gate.fixture.test.mjs` 加正例。
- [ ] **Step 2: 红相实证**——临时在某 store 文件加 `mediaUrl: 'x'` → `pnpm --filter @flowweb/web lint` 红 → 撤销；证据贴完成记录表。
- [ ] **Step 3: 跑绿** + **Step 4: Commit** `build(canvas): R2b-8 lint 门禁第六条 no-mediaurl-write（AST 双形态+红相实证）`

**Task 2b-9：2b 批尾**

- [ ] **Step 1**: web 全量 + `pnpm verify`。
- [ ] **Step 2**: 浏览器冒烟：多选 3 完成图节点批量下载（许可提示/串行/N 成功提示）；分镜宫格与素材库拖图渲染正常（mediaUrl 收敛后）；**长开页面 16min+ 后图片仍可下载（onError/临期自愈生效）**；双标签页（mediaUrl 收敛后双端渲染一致）。
- [ ] **Step 3**: 完成记录表填 2b 行。**登记 2d 前置阻塞提醒**：media-batch.service.ts:24-25 现返裸 url、3600 硬编码、无 ttlSec——2d-4 预取回填依赖（客户端硬编码 3600_000 会随服务端 TTL 漂移）。

---

## 分片 2c：Token 前置补课 + 组工具条 + 组颜色 + 组名入框

**Files:**
- Modify: `apps/web/src/index.css`（§4.2 Token 追加——既有唯一双块内）
- Modify: `apps/web/e2e/b0-token-blocks.spec.ts`（DOMAIN_TOKENS:66-73 现 20 键+双值表）+ 新建 vitest 深浅键集相等断言
- Create: `apps/web/src/utils/groupColor.ts`
- Modify: `apps/web/src/stores/canvasStore.ts`（setGroupColor action——经 runCommand）
- Modify: `apps/web/src/pages/canvas/components/groups/GroupToolbar.tsx`（色点+排列子节点+批量下载+GROUP_TOOLBAR+删旧 TOOLBAR）
- Modify: `apps/web/src/utils/group-frame-writer-guard.test.ts`（ALLOW_FN 扩 arrangeGroupChildren:——若 2a 未含）
- Modify: `apps/web/src/pages/canvas/components/groups/NormalGroupRenderer.tsx`（组名入框+1px 边框+组色）
- Test: groupColor.spec.ts（新）、GroupToolbar.test.tsx、NormalGroupRenderer.test.tsx、canvasStore.groups.test.ts 增补

**Task 2c-1：Token 落地（§4.2 前置补课）+ contrast 台账 + b0 扩表 + 键集断言 + registry**

- [ ] **Step 1: 实现**——index.css **在既有唯一双块内追加**（深块 :15-58 尾/浅块 :60-102 尾；**"不得另起块"= b1-4 只扫 `--(?:canvas-|ve-|vw-)` 前缀声明位（b1-token-migration.spec.ts:300-330）——新增 9 键恰在该前缀内安全**；第三块 :126-133 是 :root 几何恒值键，禁入）：

```css
/* 深块（:root,..dark 内） */
--canvas-storyboard-shell-bg: #212121;
--canvas-group-border: #3a3a3a;   /* 拍板维持（spec §4.2）：深 1.85:1 vs #000——分离度观测行，非 ≥3:1 达标项；回退预登记 #595959（3.00:1） */
--canvas-group-color-red: #f87171;    /* 400 系亮变体——深板 #000 上 ≥3:1，contrast-table 实测登记 */
--canvas-group-color-orange: #fb923c;
--canvas-group-color-yellow: #facc15;
--canvas-group-color-green: #4ade80;
--canvas-group-color-cyan: #22d3ee;
--canvas-group-color-blue: #60a5fa;
--canvas-group-color-purple: #c084fc;
/* 浅块 */
--canvas-storyboard-shell-bg: #f7f8f8;
--canvas-group-border: #9ca3af;    /* 浅 2.33:1 vs 板面 / 2.25:1 vs 组内底——观测行（B6 目检裁定）；回退预登记 #8e9298（2.87:1） */
--canvas-group-color-red: #dc2626;     /* 600 系——亮板 #F5F5F5 上 ≥3:1 */
--canvas-group-color-orange: #ea580c;
--canvas-group-color-yellow: #a16207;
--canvas-group-color-green: #16a34a;
--canvas-group-color-cyan: #0e7490;
--canvas-group-color-blue: #2563eb;
--canvas-group-color-purple: #9333ea;
```

**contrast 纪律（对齐 spec §4.2 原文——v1"≥3:1 不达标调档"与 spec"拍板维持"自相矛盾，作废）**：组色 7 色×2 档=14 值须 ≥3:1（不达标调档）；**group-border 两档=分离度观测行**（深 1.85/浅 2.33/2.25），**拍板维持不调档**，specExpect 留空+注明"B6 目检裁定"；回退指令预登记：目检不可辨→浅 #8e9298+深 #595959（回退两值同步双块+b0 表+pair 重跑）。

- [ ] **Step 2: contrast 实测**——**用既有工具**（v1"若无则临时脚本"作废——工具在）：`node apps/web/scripts/contrast-table.mjs`（输入 `apps/web/e2e/audit/contrast-pairs.json`，specExpect 漂移即 exit 1，未挂 package.json scripts——直接 node 跑）；组色 14 值+border 2 档观测行入 contrast-pairs.json 台账；实测值与终值写完成记录表 2c 行。
- [ ] **Step 3: b0 扩表**——b0-token-blocks.spec.ts DOMAIN_TOKENS（:66-73，现 20 键）加 9 键 + DOMAIN_DARK/DOMAIN_LIGHT（:75-96/:98-119）双值；**补"新键在迭代列表内"断言**（现无——表里多写的键永不被读=假绿面）。
- [ ] **Step 4: 新建 vitest 深浅域键集相等断言**（v1 误判"已在 vitest 侧"——实际全仓不存在，仅 RunButton.test.tsx:34-37 断 4 个具体值；spec F6"b1-4 fail-closed 且只在 Playwright 批"⇒ vitest 侧必须自建：`Object.keys(DOMAIN_DARK) === Object.keys(DOMAIN_LIGHT)` 键集相等 + 与 index.css 双块对账）。
- [ ] **Step 5: registry 重跑**——`node apps/web/scripts/canvas-migration-registry.mjs` 重跑+新 site 增量在 differExpectedPairs/adjudications 逐条裁定（F26：四个手工键重跑不丢）。
- [ ] **Step 6: 跑绿**（b0+新键集断言+web lint）+ **Step 7: Commit** `feat(canvas): R2c-1 组域 Token 9 键落地（contrast 台账+b0 扩表+键集相等断言+registry）`

**Task 2c-2：groupColor 单源 util**

- [ ] **Step 1: 写失败测试**——GROUP_PALETTE 7 键无 gray；resolveGroupColor('red')='var(--canvas-group-color-red)'、bogus/undefined→undefined；**palette↔index.css 对账用 readFileSync+向上找 pnpm-workspace.yaml 定根（照 group-frame-writer-guard.test.ts:1-13 既有先例——v1 的 `require.resolve('../index.css')` 在 jsdom+Vite 转换下对 .css 不稳，作废）**。
- [ ] **Step 2: 跑红** → **Step 3: 实现**（v1 实现段可用——GROUP_PALETTE/GROUP_COLOR_MAP/resolveGroupColor 三导出形态维持）。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2c-2 groupColor 单源（palette/类型/resolve 唯一函数）`

**Task 2c-3：setGroupColor action（经 runCommand——补 v1 漏掉的 stopCapturing）**

- [ ] **Step 1: 写失败测试**——合法 key 经 runCommand 落 doc+cs（inner 纯写+外层差分单 transact——"双写"措辞随 F42 单所有权作废）；默认清除（undefined=删键）；未知 key 拒写；convertGroup 两方向保 color（F18 回归锚）；**500ms 内连点两次=2 undo 项（spec:169 五命令之一——v1 完全漏掉）**。
- [ ] **Step 2: 跑红** → **Step 3: 实现**——`setGroupColor: (groupId, key) => { if (key !== undefined && !(key in GROUP_COLOR_MAP)) return; runCommand(() => get().patchGroupDataInner(groupId, { color: key })); }`（**fn 内一律 inner**——2a-0 契约：outer 自带正向 dispatch 叠外层差分=同值双 transact；stopCapturing 不挂在 patchGroupData 上——它被 markManuallyResized 等复用非命令边界，命令粒度由 runCommand 收）。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2c-3 setGroupColor（runCommand 包装+未知 key 拒写+连点 undo 断言）`

**Task 2c-4：arrangeGroupChildren action（§4.4 排列子节点）**

- [ ] **Step 1: 写失败测试**——显式几何命令：先清 manuallyResized（经 patchGroupDataInner——runCommand.fn 契约）再走 applyGroupFrame；折叠态/分镜组禁用（首行守卫 no-op）；子节点绝对 rect→sortForArrange→arrangeRects→守恒写回；**500ms 连点=2 undo**；**ALLOW_FN 扩 `arrangeGroupChildren:`（子 rel 直写是合法几何写——group-frame-writer-guard :23 白名单+正例）**。
- [ ] **Step 2: 跑红** → **Step 3: 实现**——核心序：守卫早退→runCommand 内：patchGroupDataInner({manuallyResized: undefined})→子绝对 rect（`n.position + g.position`，尺寸 `n.width ?? DEFAULT_CHILD_SIZE`）→sortForArrange→arrangeRects→子新绝对位置−新组原点=rel 写回+组走 applyGroupFrame（refitGroupGeometry 守恒）。**与 2a-5 的口径说明**：2a-5 排组间（组=原子块、不 refit），本 task 排组内（显式几何命令、故意 refit）——两语义不同非矛盾，spec 契约 4 已分别定义。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2c-4 arrangeGroupChildren（清手动标记+守恒写回+白名单登记）`

**Task 2c-5：NormalGroupRenderer——展开态 1px 边框 + 组色 + 组名入框（F17/F22）**

- [ ] **Step 1: 写失败测试**——border='1px solid var(--canvas-group-border)'（既有 :32/:36 `border===''` 断言翻转）；设组色 borderColor 吃组色；**双兜底单点**：组件内 `borderColor: resolveGroupColor(data.color) ?? 'var(--canvas-group-border)'` 一处（**v1 同时写 CSS var() 模板与 resolveGroupColor 两份兜底形态——作废，取单点，勿造第二份映射**）；组名入框（top:0 流坐标、无负向 translateY——既有 :39-46 transform 断言迁移）；childCount badge 保持。
- [ ] **Step 2: 跑红** → **Step 3: 实现**——NormalGroupRenderer.tsx:87-97 组名行从外浮层（`translateY(calc(-100% - 10px))`）改组框内顶部（GROUP_PADDING_TOP=50 预留区）；组盒 border+组色。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2c-5 展开态边框+组色边框+组名入框（F17/F22）`

**Task 2c-6：GroupToolbar 扩展 + 旧 TOOLBAR 退役**

- [ ] **Step 1: 写失败测试**——按钮序 `[色点][排列子节点▾] │ [折叠][整组执行][转分镜组][解组] │ [批量下载]`；色板浮层 role=listbox/option/aria-selected/「默认」清除项/点外 Esc 关；排列子节点三项→arrangeGroupChildren；折叠组排列子节点 disabled 双层；批量下载复用 batchDownload.ts；GROUP_TOOLBAR={52,12} 贴顶翻转公式迁移（GroupToolbar.test.tsx:66-73 现断言随改）；水平夹取 clampToolbarX 接线。
- [ ] **Step 2: 跑红** → **Step 3: 实现**——GroupToolbar.tsx：TOOLBAR→GROUP_TOOLBAR 引用替换+**selectionTokens.ts 旧 TOOLBAR 常量在本 task 删除**（消费点已全部迁移——v1 放 2a-1 删会打红 GroupToolbar；删除后 grep `\bTOOLBAR\b` 零命中〔SELECTION_TOOLBAR/GROUP_TOOLBAR 除外〕）。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2c-6 组工具条扩展（色点/排列子节点/批量下载+52/12+旧 TOOLBAR 退役）`

**Task 2c-7：2c 批尾**

- [ ] **Step 1**: web 全量 + `pnpm verify` + 本地 Playwright：`pnpm --filter @flowweb/web exec playwright test e2e/b0-token-blocks.spec.ts e2e/b1-token-migration.spec.ts`（**无 test:e2e script；CI 不跑这两个——须本地执行**）。
- [ ] **Step 2**: 浏览器验收：组色全链路（设色→刷新仍在→转分镜→转回→仍在）；组名入框多 zoom 档目视；展开态边框深浅双板；折叠组排列子节点 disabled；**双标签页：A 设色/排列子节点 → B 一致 → A undo → B 一致**。
- [ ] **Step 3**: 完成记录表填 2c 行（contrast 台账终值）。

---

## 分片 2d：折叠几何收口 v2 + 折叠宫格卡 + 分镜改版 + 智能标题屏幕层

**Files:**
- Create: `packages/shared/src/canvas/expandedFrame.ts`（resolveExpandedFrame）+ 同名 spec
- Modify: `apps/web/src/stores/canvasStore.ts`（toggleCollapse 收口+markManuallyResized 折叠守卫+renameGroup 置 nameCustom）
- Modify: `packages/shared/src/canvas/normalizeLoadedCanvas.ts`（守卫矩阵收敛）+ 同名 test
- Modify: `packages/shared/src/canvas/geometry.ts`（COLLAPSED_SIZE {220,160}——2d-2 单独 commit）
- Modify: `apps/web/src/utils/group-frame-writer-guard.test.ts`（:38 字面量正则随 2d-2 迁移）
- Create: `apps/web/src/pages/canvas/components/groups/CollapsedPreviewCard.tsx`、`StoryboardTitlesLayer.tsx`
- Modify: `apps/web/src/pages/canvas/components/groups/NormalGroupRenderer.tsx`（折叠分支接 CollapsedPreviewCard+根 div 显式尺寸）
- Modify: `apps/web/src/pages/canvas/components/groups/StoryboardGroupRenderer.tsx`（shell 改版+删右上角标题）
- Modify: `apps/web/src/pages/canvas/components/groups/GroupContextMenu.tsx`（重命名 F24+粘贴坐标换算）
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx`（挂 StoryboardTitlesLayer+storyboard 工具条补钮——路径 components/ 下）
- Modify: `apps/web/src/api/mediaApi.ts`（batchGetMediaRewritten+ttlSec 类型）+ `apps/api/src/modules/media/media-batch.service.ts`（TTL 常量+ttlSec 下发）+ `apps/api/src/modules/media/media-batch.service.spec.ts`（api 侧 ttlSec 契约断言——v2.2 补列）
- Modify: `apps/web/src/utils/mediaUrlCache.ts`（prefetchMediaUrls 回填+in-flight 注册口）
- Modify: `docs/superpowers/specs/2026-09-28-canvas-group-ui-upgrade-design.md`（§4.9/:18/:288 回写——随 2d-1 同 commit 或相邻 docs commit）
- Test: 上述各 spec + canvasStore.groups.test.ts 增补（真装置）+ canvasIntents.spec.ts:458-461 迁移（2d-2）+ geometry.test.ts:103-104 迁移（2d-2）

**Task 2d-1：折叠几何收口 v2（信封恒等可见盒+savedSize 密封快照+展开帧单源——注记 7）**

- [ ] **Step 1: 写失败测试**（真装置）：

```ts
describe('折叠收口 v2（§4.9 改道——信封恒等可见盒）', () => {
  it('不变量①：折叠瞬间 savedSize == 折叠前 envelope 且 envelope == COLLAPSED_SIZE', () => {
    seedGroup('g1', { width: 600, height: 400 });
    cs().toggleCollapse('g1');
    const g = cs().nodes[0];
    expect(g.data.savedSize).toEqual({ width: 600, height: 400 });
    expect(g.width).toBe(COLLAPSED_SIZE.width); expect(g.height).toBe(COLLAPSED_SIZE.height);
    expect(g.data.collapsed).toBe(true);
  });
  it('不变量②：展开后 savedSize 键不存在（存在 ⟺ collapsed）+ envelope == 折叠前尺寸', () => {
    seedGroup('g1', { width: 600, height: 400 });
    cs().toggleCollapse('g1'); cs().toggleCollapse('g1');
    const g = cs().nodes[0];
    expect('savedSize' in (g.data as object)).toBe(false);
    expect(g.width).toBe(600); expect(g.height).toBe(400);
  });
  it('原子性（v2.1）：折叠/展开各恰 1 次 doc transact（Y.Doc observer 计数——v2 维持 patchGroupData+envelope intent 两次 dispatch，B 端存在"collapsed=true 但信封还是大盒"中间帧、undo 依赖 500ms 捕获窗合并而非构造性原子；dispatchCanvasIntent 本就支持意图数组单 transact，canvasIntents.ts:204 注释明写）', () => {});
  it('折叠往返双夹具（v2.2）：手动组 500×350 往返不变（savedSize 恢复）；守恒组子 rel 恒定——分镜组夹具删除（不可折叠，见守卫用例）', () => {});
  it('分镜组折叠守卫（v2.2）：toggleCollapse(s1) 双向 no-op——折叠/展开两方向 envelope/data 均不变（store 半开闭环；现状四处证据：CanvasView:623/:625、StoryboardGroupRenderer 无折叠分支、normalizeLoadedCanvas:18-19 定性、convertGroup :1497/:1525 清 collapsed）', () => {});
  it('密封性：折叠期间 markManuallyResized 拒写（守卫 no-op）', () => {});
  it('脏数据加载自愈（v2.2 替代让位）：storyboard 组带杂散 collapsed/savedSize（脏）→ normalizeLoadedCanvas 剥 collapsed/savedSize 键 + envelope 经 resolveExpandedFrame(剥键后 data) 取（**storyboard 堵洞档单源——复用缺 grid 键 calcDefaultGrid 派生，不直算第二份 calcStoryboardSize**）——修复分支必须置于几何早退（:16 width/height 齐全即 continue）之前，否则有几何的脏组（信封已被折成 220×160）永不修复；storyboard 判定恒优先于 collapsed（现状 :18-19 注释语义保持）', () => {});
  it('展开走 resolveExpandedFrame 单源（store 内三分派代码删除——源码扫描断言）', () => {});
  it('normalizeLoadedCanvas 守卫收敛：加载折叠 normal 组 envelope=COLLAPSED_SIZE（collapsed 判定优先——现序 :33 手动+savedSize 分支在 :40 折叠分支之前，会把脏 savedSize 反写进折叠组信封；**storyboard 档恒最优先**——含脏 collapsed 剥键修复，见上条）；加载展开组缺几何经 resolveExpandedFrame 补齐；**展开组带杂散 savedSize（异常路径）→ 加载边界删键（savedSize⟺collapsed 在加载态收敛——v2.1）**', () => {});
  it('checkProjectionInvariant：折叠/展开后 doc≡store', () => {});
});

// packages/shared/src/canvas/expandedFrame.spec.ts
describe('resolveExpandedFrame（展开帧单源——签名统一 {data, childrenAbs, config})', () => {
  it('有效 savedSize 优先（等价性仅 normal 组——v2.2 收窄：分镜组不可折叠后"手动分镜组折叠往返"不可达）', () => {});
  it('无效 savedSize 堵洞序：storyboard→calcStoryboardSize；否则守恒重算（childrenAbs bbox+padding）；空组→COLLAPSED_SIZE 不造 0×0', () => {});
  it('不可达形态：savedSize 缺键/非有限/≤0 全部落堵洞（单测钉死）', () => {});
});
```

- [ ] **Step 2: 跑红** → **Step 3: 实现**（**执行建议：本 task 是全 plan 改动面最大的单点——按"守卫→单 transact→三分派删除→normalize 收敛"四段小步验证/commit，红绿粒度越细越易定位**）：
  - 新建 `packages/shared/src/canvas/expandedFrame.ts`：`resolveExpandedFrame({data, childrenAbs, config})`——有效 savedSize（有限/正）→savedSize；无效→storyboard→calcStoryboardSize(resolved)/否则守恒 bbox+padding/空组→COLLAPSED_SIZE（**优先序说明（v2.2 收窄）："有效 savedSize 优先"的等价性论证仅涉 normal 组**——分镜组不可折叠后"手动 resize 过的分镜组折叠往返"场景不可达，spec:288 手动优先语义保留在 normal 组展开域；storyboard 堵洞档仅服务脏数据兜底，注释写死）；
  - `toggleCollapse`（canvasStore.ts:1565-1605）：
    - **单 transact（v2.1）**：折叠=`dispatchCanvasIntent([{type:'updateNodeData',…collapsed:true+savedSize}, {type:'updateNodeEnvelope',…COLLAPSED_SIZE}], Origin.LocalUser)` **一次调用**（v2 维持 patchGroupData+envelope intent 两次 dispatch 的形态作废——canvasIntents.ts:204 注释"复合=序列单 transact（对端一帧收齐+撤销栈单捕获窗）"是设计意图）+ store 侧同步 set + 子节点 selected 清 false（2a-0 不变量）；展开同理单次 intent 数组（updateNodeData 删 savedSize/置 collapsed:false + updateNodeEnvelope(width/height) + **moveNode(position)**——resolveExpandedFrame 返回绝对 frame，守恒档原点可与组当前原点不同；applyGroupFrameRect :1647-1650 即 envelope+moveNode 双意图先例，此处三意图一次数组）；
    - **store 内三分派（:1584-1601）整体删除**；
  - **分镜组不可折叠契约落地（v2.2——让位设计废弃，死局论证见注记 19(e)）**：`toggleCollapse`（:1565）首行 storyboard 守卫（g.data.groupType==='storyboard' 直接 return——**双向 no-op**，折叠/展开均拒，store 半开闭环）；`updateStoryboardConfig`/`resizeStoryboardGrid` **维持现状直写 envelope 不动**（分镜组无折叠态，配置写者永不遇折叠组；脏 collapsed 组遇配置命令=直写顺带把信封拉回配置尺寸，无害且与加载边界自愈收敛同向）；**CanvasView:623 恒 false 即契约正确（撤销 v2.1"改真实值"）**——**死按钮核验结论（19(i)）：无死按钮可移**（折叠钮在 GroupToolbar `p.groupType==='normal'` 条件块内 :58-60，storyboard 分支 :69 只渲染注入 children）；CanvasView:623/:625 的 `collapsed={false}+onCollapse={noOp}` 是死 props（传入但无渲染消费）——随手删（改动面内）；
  - `normalizeLoadedCanvas.ts` 守卫矩阵收敛：**storyboard 档恒最优先并扩展为脏键修复**——storyboard 组带 collapsed（脏）→ 剥 collapsed/savedSize + envelope 经 resolveExpandedFrame(剥键后 data) 取（storyboard 堵洞档单源——复用缺 grid 键 calcDefaultGrid 派生；修复置于 :16 几何早退**之前**——有几何的脏组同样修复；"坏值尽快自愈不留灰档"，spec §4.5 media 坏值同款哲学）；非 storyboard 组内 :33-38（manuallyResized&&savedSize）与 :40-43（collapsed 覆写）合并为同调 expandedFrame 族——collapsed 判定优先；展开组缺几何→resolveExpandedFrame 补齐；**展开组带杂散 savedSize→删键**；savedSize 访问的 as any 随类型收窄清理；
  - **残留登记（19(i)，无需代码）**：① addToGroup/dropIntoGroup :1178"折叠态先展开"前置对脏 storyboard 组失效（守卫 no-op → 组保持脏折叠继续加成员）——不可达脏数据残留场景，与配置写者同向收敛（下次加载自愈）；② 剥键自愈在**加载边界**生效——运行中会话收到远端脏折叠 intent（新旧版本混跑窗口）不经加载边界，脏组以 shell 挤压形态存活到刷新（开发期单人+部署窗口极短，接受；配置命令直写是第二收敛路径，不加投影层防御）；
  - `markManuallyResized` 折叠态守卫拒写；渲染层核对折叠分支不渲染 NodeResizer（grep 现状，缺则补）；
  - NormalGroupRenderer 折叠分支根 div 显式尺寸引 COLLAPSED_SIZE 常量（现状核对维持——与 toggleCollapse envelope intent 同引常量，单源门禁：group-frame-writer-guard :39 已有"折叠尺寸直写含 COLLAPSED_SIZE"断言维持；**StoryboardGroupRenderer 不引**——无折叠分支正是不可折叠契约的证据之一，19(i)）；
  - **savedSize 保留 GROUP_NODE_DATA_KEYS 9 键——group.ts/snapshot-filter/clone 表零改动**（红面：groups.test.ts savedSize 断言集（:195-:646，语义更新非删除）+normalizeLoadedCanvas.test.ts（:52-:79 守卫迁移）+ canvasIntents.spec.ts:458-461（随 2d-2 值迁移））；
  - spec §4.9/:18/:288 回写（v12 裁决块——见本 plan 注记 7 文本，**含 v12 裁决 1 修订（分镜组不可折叠+脏修复自愈——v2.2 推翻让位子句）与裁决 4（hidden 收窄）**）。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2d-1 折叠几何收口 v2.2（信封恒等可见盒+单transact+分镜不可折叠守卫+展开帧单源——§4.9 改道）`（spec 回写同 commit 或相邻 `docs(spec)` commit）

**Task 2d-2：COLLAPSED_SIZE {200,64}→{220,160}（§4.5——单独 commit）**

- [ ] **Step 1: 写失败测试**——geometry.test.ts:103-104 断言 {220,160}；**迁移面四处**：geometry.test（:103-104）、canvasStore.groups.test.ts:203（width 200 字面量）、**canvasIntents.spec.ts:458-459（width 200/height 64——v1 漏）**、**group-frame-writer-guard.test.ts:38（禁 `width:\s*200,\s*height:\s*64` 字面量正则→改 220/160——v1 漏，改值后旧正则空转）**。
- [ ] **Step 2: 跑红** → **Step 3: 实现**——geometry.ts:30 改值（单源，消费面自动跟随）。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(shared): R2d-2 COLLAPSED_SIZE 220×160（单源改值+四处迁移面）`

**Task 2d-3：CollapsedPreviewCard 宫格预览卡（§4.5）**

- [ ] **Step 1: 写失败测试**——结构（预览宫格 padding 6/gap 4/圆角 6+summaryRow"N 个节点"；≤6 tile；其它类型图标占位）；列数 calcCollapsedGrid（1-2→按数量/3-4→2 列/5+→3 列）；tile 用 useMediaUrl(fileId)（无 fileId 图标占位）；组色着色折叠卡边框（双兜底）+选中态优先级（选中高亮>组色）；根元素 title+aria-label="{组名}，N 个节点"。
- [ ] **Step 2: 跑红** → **Step 3: 实现**——CollapsedPreviewCard.tsx（props `{ name, color?, selected?, cells: { nodeId, fileId? }[] }`；calcCollapsedGrid 组件内导出纯函数）+ NormalGroupRenderer 折叠分支替换（根 div 显式尺寸引 COLLAPSED_SIZE——2d-1 不变量载体）。**tile 的预取单飞在 2d-4 接线**（tile 数据需求 fileIds≤6 由本组件汇总）。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2d-3 折叠宫格预览卡（列数单源/tile useMediaUrl/aria）`

**Task 2d-4：batchGetMedia 预取单飞（三口径 §4.5 v8+M7 竞态修正）**

- [ ] **Step 1: 写失败测试**

```ts
describe('折叠卡批量预取（三口径+两段渲染单飞）', () => {
  it('6 tile 同挂载 → 恰 1 次网络请求（spec §5 验收行"≤1 次 batch 请求"）——两段渲染（v2.1）：React effect 子先于父，tile 直挂必先发 6 个单请求（v2 的 registerInFlight 挂卡片 effect 晚于 tile effect，结构性竞态、验收必红）——首渲染图标占位，卡片 effect 内 registerInFlight 完成后 setState 再挂 tile，tile 的 useMediaUrl 挂载时 pending 已就绪命中共享单 promise', () => {});
  it('batchGetMediaRewritten：rewrite opt-in（/flowai 同源改写与 getMediaUrl:7 同款）；既有 2 消费方（useWorkflowAssets.ts:32/VideoEditNode.tsx:109——v1 写 3 处，shadowJob 已批5删）行为不变回归', () => {});
  it('batch 响应带 ttlSec（服务端 MEDIA_URL_TTL_SEC 常量单源——现 :24-25 两处字面量 3600 无常量，新建常量本身是本 task 工作内容；api 侧补契约断言——spec §4.5 已把 ttlSec 升格为契约，双端各自锁）', () => {});
  it('必须显式传 teamId（画布 teamId——canvasStore project 加载链，grep 现状取 store 字段）；batch 失败不阻塞（tile fallback 单取）', () => {});
  it('registerInFlight 回填身份校验（同 2b-5 invalidate 竞态——在飞 promise resolve 时校验 pending 身份，不等则丢弃，防脏回写）+ Number.isFinite(ttlSec) 防御', () => {});
});
```

- [ ] **Step 2: 跑红** → **Step 3: 实现**：
  - `api/mediaApi.ts`：batchGetMedia 不动；新增 `batchGetMediaRewritten(ids, teamId)`；BatchMediaItem 增 ttlSec；
  - `media-batch.service.ts`：**新建 `MEDIA_URL_TTL_SEC = 3600` 常量**收编 :24-25 两字面量+响应条目下发 ttlSec；
  - `mediaUrlCache.ts`：增 `prefetchMediaUrls(items: {fileId, url, ttlSec}[], userId)`（回填 `{url, expiresAt: Date.now()+ttlSec*1000}`——绝对时刻形状与 2b-5 一致，临期判定读侧自动生效）+ **`registerInFlight(fileId, promise)` 注册口**（pending map 对外暴露，回填前身份校验同 2b-5）；
  - **CollapsedPreviewCard 两段渲染（v2.1）**：首渲染 tile 位置渲染图标占位（不挂 useMediaUrl tile）→ 卡片挂载 effect 收集 fileIds→**先查 cache/pending 已含的 fileId 跳过（幂等守卫——React 18 StrictMode dev 双跑 effect/两卡共享 fileId 时防二次 batch，"≤1 次 batch"在 dev 模式同样成立）**→registerInFlight（batch promise）→setState→二段渲染挂 tile——tile 的 useMediaUrl 挂载时 pending 已就绪，命中共享单 promise（React effect 子先于父，v2 的"卡片 effect 注册+tile 直挂"同 commit 方案是结构性竞态：tile effect 先跑、6 个单请求已发出）。
- [ ] **Step 4: 跑绿**（含 2 消费方回归）+ **Step 5: Commit** `feat(canvas): R2d-4 折叠卡批量预取单飞（registerInFlight+ttlSec 契约+TTL 常量单源）`

**Task 2d-5：StoryboardTitlesLayer 单例共享层 + 智能标题（§4.4 v9/v10）**

- [ ] **Step 1: 写失败测试**——标题=nameCustom?name:`分镜组 ${cells.filter(Boolean).length} 个节点`；单例共享层（一个组件一次 useViewport 订阅，N 组 N 标题 div——Layer 实例数=1 断言）；常驻两条垂直带（标题带 frame.top−12、工具条带 frame.top−12−titleRowH，titleRowH=20——**分镜工具条 offset 随带上移 12→32**，工具条分带实现落 GroupToolbar storyboard 分支）；标题恒 13px 不随 zoom+限宽省略；N=画布全部分镜组（常驻）。
  **窄组"两 rect 不相交"断言落浏览器/Playwright**（jsdom getBoundingClientRect 恒 0=恒真假绿——v1 的 vitest 断言作废；vitest 只锁两条带数值公式与 13px/ellipsis 样式）。
  **pointer-events 约定**：Layer 容器 `pointer-events: none`、标题文本元素 none（标题不可点；工具条 portal 元素 'auto'——SelectionBoxOverlay.tsx:72（box none）/:81（toolbar auto）先例；portal 容器 CanvasView.tsx:681-685 已 pointer-events-none）。**屏幕层是行为变更非新增**：现有组名/标题在流坐标节点内，三个测试锁着当前 transform（NormalGroupRenderer.test:39-46/StoryboardGroupRenderer.test:105-111）——随本 task 迁移。
- [ ] **Step 2: 跑红** → **Step 3: 实现**——StoryboardTitlesLayer.tsx（flow→screen 换算照 SelectionBoxOverlay :31-34 公式）；CanvasView 挂载（与 node-toolbar-portal 同级）；StoryboardGroupRenderer.tsx:58-60 删右上角标签（删后 grep `data.name` 于该文件零渲染残留）。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2d-5 分镜智能标题屏幕层（单例共享层+分带+工具条带上移+pointer-events 约定）`

**Task 2d-6：renameGroup 置 nameCustom + 右键重命名（F24）**

- [ ] **Step 1: 写失败测试**——renameGroup 置 nameCustom:true（普通/分镜同款）；GroupContextMenu 增「重命名」项（与 NormalGroupRenderer 双击共享编辑态——回调接线以现场组件状态形态最小改动）；**renameGroup 现状 `name.trim() || '分组'` 硬兜底（:1554）维持不改语义**（v1 倾向 early return 的表述作废——精准修改；空名兜底也置 nameCustom:true：重命名动作本身即用户命名意图）；**500ms 连点=2 undo（spec:169）**。
- [ ] **Step 2: 跑红** → **Step 3: 实现**——renameGroup 增 `nameCustom: true`（经 runCommand，**fn 内 patchGroupDataInner 写 name+nameCustom**——2a-0 契约）；GroupContextMenu 菜单增项。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2d-6 renameGroup 置 nameCustom+右键重命名入口（F24）`

**Task 2d-7：分镜 shell 改版 + 工具条补钮 + 三子组件 token 化（§4.6/F28）**

- [ ] **Step 1: 写失败测试**——shell 背景 `var(--canvas-storyboard-shell-bg)`+边框 1px `var(--canvas-group-border)`（现 controls token 迁移）；设组色 border-color 吃组色（v10 裁决 4 双兜底）；右上角标签已删（标题走屏幕层）；storyboard 工具条按钮序 `[比例▾][宫格 r×c▾] │ [拼接(2K/4K)][№ 序号][🗑 清空][转普通组] │ [批量下载][解组]`；批量下载收集集=cells fileId（需求 8）；三子组件（AspectRatioDropdown/GridSizeDropdown/StitchButton）硬编码 #fff/#666/#aaa→controls token（F28；style 对象 lint 豁免——断言源码零 hex）。
- [ ] **Step 2: 跑红** → **Step 3: 实现**——StoryboardGroupRenderer.tsx:36-47 shell 两 token+组色边框+删 :58-60 标题；CanvasView.tsx storyboard children 注入段（:630-655 附近——行号以 grep 为准）补「转普通组」「批量下载」两钮+GroupToolbar storyboard 分支补解组；三子组件换 token（grep `#fff|#666|#aaa` 三文件）。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2d-7 分镜 shell 改版+工具条补钮+三子组件 token 化（F28/v10-4）`

**Task 2d-8：R2 批尾（全分片收口）**

- [ ] **Step 1**: web 全量 + `pnpm verify` + api 全量（`pnpm --filter @flowweb/api test -- --run`——GROUP_NODE_DATA_KEYS 9 键未动，clone spec 应零红；若红即 2d-1 越界，回查）。
- [ ] **Step 2**: **浏览器验收清单**（spec §5 逐条）：
  1. 折叠卡 6 图宫格+深浅 7 色 computed 读数；网络面板 ≤1 次 batch 请求且带 teamId；
  2. 折叠/展开往返：手动组/守恒组尺寸稳定（无闪变）+ **分镜组不可折叠验证（无折叠钮、toggleCollapse 双向 no-op）**；**折叠组 DOM 盒==220×160（getBoundingClientRect 实测——原门 E 浏览器级验证落此；选中框/拖拽热区与小盒一致）**；
  3. 组名入框 vs 工具条 12px 余量（zoom 0.5/1/2）；分镜标题与工具条分带不撞（含 1×1 窄组实测——Playwright 或浏览器手测，两 portal rect 不相交）；屏幕层标题恒 13px；
  4. 拖节点进组顶部不与框内组名重叠（clamp 回归确认）；
  5. 设色→转分镜→组色可见→转回→仍在；克隆后组色仍在；
  6. 重命名（双击+右键）后分镜标题切换为用户名；**未重命名（自动名）的分镜组显示智能标题**（v2.1 措辞修正——"恢复智能标题"无实现载体：renameGroup 恒置 nameCustom:true 是 spec §4.4 纯标记设计，自动名路径=convertGroup 转组时置 false，无需 renameGroup 恢复语义）；
  7. storyboard 工具条全按钮（**无折叠钮/inert 死按钮已移除——分镜组不可折叠契约，2d-1**）；**双标签页：A 折叠/展开 → B 一致（重点观察 A 折叠瞬间 B 端无中间态闪变——2d-1 单 transact 的行为验证，互为印证）→ A undo 一步整体回滚 → B 一致**。
- [ ] **Step 3**: 本地 Playwright b0/b1-4+css-baseline-diff 绿（registry 已在 2c-1 裁定后）。
- [ ] **Step 4（v2.1 新增三项批尾收口）**：
  - **CI 门禁化**：ci.yml nightly e2e-collab job（:56-89，已装 Playwright 跑双客户端——基建就绪）追加 b0-token-blocks/b1-token-4 段/css-baseline-diff 三 step（**本地先绿再挂+确认 web 前置**——gate-collab.mjs 只自拉 API，b0/b1-4 走 playwright 默认 config 需 webServer，缺了以连接拒绝假红收场；token 门禁 fail-closed 却不在任何强制路径上=只对自觉跑本地的人生效，R2 是 token 大年不可接受）；
  - **双端脚本化回归**：新建 `apps/web/e2e/collab-r2-commands.spec.ts`（走 playwright.collab.config.ts 双账号设施）：A 排列/复制/设色/折叠 → B 收敛一致 → A undo 一步 → B 收敛；外加一条"A 建组→B 端 duplicateNodes 成功"（覆盖跨端复制+getId 防碰撞）——每分片批尾的人肉双标签页手测升级为持久回归资产；
  - **写路径棘轮门禁**：group-frame-writer-guard 同款源码扫描——canvasStore.ts 内 `dispatchProjectionDiff(` 调用点基线=**16 处既有冻结（:316…:1973，grep 实证）+ runCommand 定义处 1 处白名单（ALLOW_FN 同手法——v2.1"16 处零新增"字面落地当天即被 2a-0 击穿：runCommand finally 就是第 17 处）**，其余零新增；新命令一律经 runCommand（双轨制的防漂移机制，否则 16 旧点+runCommand 双范式必腐化成三轨）。fixture 正例=新命令直调 dispatchProjectionDiff → 红。**兼容登记**：dispatchSystemIntents（canvasIntents.ts:290 注释块，Geometry origin 第三写通道）不含 dispatchProjectionDiff 形态——扫描确认无需白名单（防误报）。红相实证一次。
- [ ] **Step 5**: 完成记录表填 2d 行；**R2 完成后主动提醒：回到 Spec B 审核**（组几何+批量连线——spec_ab_staging 约定）。

---

## 完成记录表（每分片尾滚动填写；红相证据=门禁/必红用例的红相命令输出贴备注）

| 分片 | 状态 | commit | 红相证据 |
|---|---|---|---|
| 2a（含 2a-0 公共件） | 完成（2026-10-02） | 523c30cb/97e2d171/a1f7247f+f6949c3f/dac03222+645e128f/a9ef30f7/668ef04d/33dd0091+d5f150e6/1ef918fb | 各 task TDD 红相见 commit 正文（每 task 先红后绿）；批尾 `pnpm verify` exit 0（shared 56+web 3158 全绿+tsc+lint）；浏览器冒烟（collab-gate-canvas 真会话）：水平排列 y 对齐/x 拉开、detached toast 计数 1、创建副本 6→8 偏移+40 新副本 selected、undo 逐步回滚（排列/副本/建组×2）终态回 seed 形态；双标签页协作冒烟裁量延至 2d-8 collab-r2-commands 脚本化回归（单 transact 断言已单测覆盖） |
| 2b（含 2b-5 F7 自愈） | 完成（2026-10-02） | 6a6c531d+923530b0/378ba28e/fbeb9aef/6bf9787d/a9826e99+92ee934b/4511c8b2/f9fb27e6/665fa2a9 | 各 task TDD 红相见 commit 正文；`pnpm verify` exit 0（2b-8 时点，web 3202 全绿）；浏览器冒烟（真会话）：批量下载全链路（aria-disabled 判据/首次许可 Modal+key 落地/真实 API 404×2=失败重取自愈精确发生/聚合 message.error console 实证）；长会话 16min 浏览器级验证裁量跳过（2b-5 的 900s 假定时器单测覆盖两入口）；双标签页裁量同 2a |
| 2c | 完成（2026-10-02） | 0ece5742/d46085d0/f322850b/c22357d6/34297b9d/c1d8b9f5 | contrast 台账 14 值实测全 ≥3:1 零调档（绿浅 3.02 最紧，specExpect 实测锁定）；keyset 断言红相（reviewer 独立 checkout 复现 2 failed）；b0 8 passed（B0-7 假绿封死）；b1-4 5 passed（本地）；`pnpm verify` exit 0；浏览器验收（真会话）：组工具条按钮序逐项/色板 listbox 8 options+aria-selected/设色组框 border=var(--canvas-group-color-red)/组名入框 top:0「分组 2 项」/刷新色仍在（doc 持久化）/折叠态排列子节点 disabled（UI 层）/图片组转分镜→转回色存续（F18 浏览器级）；contrast 台账终值见 contrast-pairs.json |
| 2d（含收口 v2） | 完成（2026-10-02） | df125959+25debc2f/b2bf8f48/70ec6f27+4372860c/3d2c422a/9da728eb+588a0898/ba22e686/d13a08d9/d5e8f52f/51a4c647/87d0645b | 各 task TDD 红相见 commit 正文；批尾：`pnpm verify`+api 全量 exit 0（web 3288/api 全绿）；棘轮门禁红相实证（临时 16 写点 → "冻结基线 14+runCommand 白名单 1=15"红——**实测基线 14+1=15，plan 的 16+1 为过时计数〔批4b-2 换芯合并所致〕，门禁按实测钉死**）；collab-r2-commands E2E gate 双 spec 11 passed（A 建组→排列/复制/设色/折叠 B 逐命令收敛→A undo B 回滚+跨端 duplicateGroup——**600ms 静置编码 undo 捕获窗语义**）；本地 b0 8p/b1-4 1p/css-diff exit 0；CI nightly 三 step 挂载（web 前置确认：三 step 自管 webServer 自包含）；浏览器验收：折叠卡 DOM 盒实测 220×160（原门 E 落地）+往返稳定 340×370+savedSize 删键、分镜守卫双向 no-op+工具条无折叠钮、智能标题 13px+重命名切换、1×1 窄组两带 rect 不相交（[201,253]/[253,273]）+clamp 左缘生效；裁量项：带真实 fileId 的 6 图宫格+batch≤1 网络面板（单飞语义单测+E2E 锁，真图抽查待有真实素材时）、拖入 clamp 目检（onNodesChange 单测锁）、zoom 三档目检（流坐标恒定语义） |

---

## Self-Review（writing-plans 检查单——v2.2 已执行）

1. **Spec 覆盖**：§4.1→2a-1；§4.2 Token/门禁→2c-1；§4.3 多选工具条→2a-7、clampToolbarX→2a-4、浮层规格→2a-7、arrangeSelection→2a-2/3/5、duplicateNodes→2a-6、批量下载→2b-1~4、mediaUrl 收敛→2b-6~8；**§4.5 缓存三件套→2b-5 补齐两条（R0c 只落形状四条——v1 误判闭环已纠正）**；§4.4 组工具条/组色/组名入框/排列子节点→2c-2~6；§4.5 折叠卡/batch 预取→2d-2~4；§4.6 分镜改版/智能标题→2d-5/7；**§4.9 R2d 折叠收口→2d-1 改道版（信封恒等可见盒+分镜组不可折叠——spec 三处随回写）**；F12→2a-6；F15→2b-3；F17/F22→2c-5；F24→2d-6；F28→2d-7；F37→2b-6~8；F40→2a-3；F41→2a-6。需求 1/2/3/4/8 全映射。
2. **占位符扫描**：2a-6 buildCopyPlan/copyPlan.ts 函数体为签名级伪码（显式标注"实现时补"——闭包语义与三条保真断言已钉死）；其余步骤均含完整代码或精确指令。
3. **类型一致性**：arrangeSelection.ts/copyPlan.ts/expandedFrame.ts（**签名统一 {data, childrenAbs, config}**）/mediaDownload/batchDownload/collectDownloadables/groupColor 跨任务签名逐一核对；**addNode 单参 (node: AppNode)（nodeStore.ts:357 实证——v1 两参调用作废）**；SELECTION_BOX 键名 borderStyle/borderRadius/background（selectionTokens.ts:6-15 实证——v1 示例键名错误已改）；**2a-2 与 2a-6 的 hidden 语义已对齐（v2.1 曾声称对齐但 2a-6 文本未改——第三轮复审 P0 揭露"声明已修、文本未改"，v2.2 翻转测试块+分工单点〔participation 裁决/buildCopyPlan 构造〕，见注记 19a）**。
4. **plan 断言现场复证（v2 起纪律，v2.1/v2.2 两轮复审）**：本 plan 每个新增可验证断言已经三轮复证（v2：4 路并行+主审直验；v2.1：三份外部复审 P0/P1 就地采纳——运行时行为类缺口〔React effect 顺序、跨端折叠期配置路径、协作中间态〕补齐；v2.2：第三轮三份复审核验修订——**修订传播完整性即本轮主课题：新裁决必须 grep 全文清剿旧复述（让位/hidden 排除/棘轮基线三处"改了注记没改正文"全部因此暴露**，见注记 19）；执行者遇行号漂移以符号+grep 重校准，遇断言与现场冲突**先复证再改 plan 登记**，禁止以别名/重载/垫片迁就。

