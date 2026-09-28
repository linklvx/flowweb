# Canvas 组升级 Spec A — R0 事故面热修 实施计划（v5）

> **当前版本：v5（2026-09-28 第四轮三份外部评审核实后修订；文内 v2/v3/v4 字样为历史修订注记）**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复克隆崩溃面（F2）、模板往返丢字段（F29/F32）、presign 缓存虚报寿命（F7）+ 客户端缓存完整方案（v10 裁决 6）、storyboard 参数走私越权（F31）+ 线上载荷剥离（sourceGroupId）——独立发布，零基建依赖。

**Architecture:** 四分片串行：R0a 克隆白名单分表 + resolveStoryboardConfig 全消费点 + `.storyboard\b` 门禁；R0b 模板三站点统一展开式+边界归一+schemaVersion+媒体政策条件化+读侧**解构剥键**收敛；R0c getMediaUrl 形状根修 + 客户端完整缓存（userId 键/LRU/in-flight/竞态/isFinite——用户拍板提前）；R0d DTO class + 方法级 pipe + **stitchApi 剥 sourceGroupId** + 显式 pick + 5 键块删除 + 方法块级棘轮门禁（**无全局 ValidationPipe——v10 用户拍板**）。

**Tech Stack:** NestJS + class-validator、Zod、Zustand、React Flow、Vitest、pnpm workspace（@flowweb/shared）。

**上游 spec:** `docs/superpowers/specs/2026-09-28-canvas-group-ui-upgrade-design.md`（v10）。

**v2 修订（三份外部评审核实后，2026-09-28 用户拍板 R0c 缓存边界）：** 修 Task 1 恒红锚定测试（Object.keys({} as ...) 恒 []——改编译期 Exclude 双向断言）；R0d 补 sourceGroupId 线上剥离（stitchApi:28 整体序列化使注释"不发给后端"为假，forbidNonWhitelisted 后拼接必 400）；DTO 改名 CreateStitchTaskDto 避撞 service:7-10 interface；controller spec 直调不经管道→改 pipe 直测+PIPES_METADATA 结构断言；读侧收敛 select→解构剥键（防漏字段类回归——评审反推 select 演示了脆弱性）；导入侧 `?? null`→`?? undefined`；status 断言 'idle'（resetStatusIdle 是写入语义）；seed 改 findFirst+update（无 name_userId 唯一键）；resolver 落 apps/web/src/utils/（pages/canvas/utils/ 不存在）；useMediaUrl mock 层 @/api/client；R0c 客户端完整缓存提前（用户拍板）；棘轮门禁改方法块级判定+扫描函数自证用例；R0a 补 `.storyboard\b` allowlist 门禁（spec §5 明列）；convertGroup :1219 cells 补 `?? []`。

**v3 修订（三份外部评审核实后）：** ① **事实纠错（v2 我的验证疏漏）**：Template 模型 :140-141 **有** `coverUrl String?`/`dataUrl String?`（v2 grep 窗口从 :142 起截掉了前两行），folder.service.ts:30/:43 工作区缩略图正在消费（自带 select 不受剥键影响）——解构剥键方案恰好自动保住它（方案正确性不受影响），事实表与字段断言已改由夹具 `Object.keys` 反推。② Task 2 新用例**置于既有外层 describe 内**（base/cloneOpts 是 describe 闭包常量，文件级引用 TS2304——同文件 :188-189 已有踩坑注释）+ 去除与既有 :154-156 重复的覆盖用例半边。③ Task 8 门禁文件改 `.test.ts` + 排除式含 spec（防扫到自己永久红）+ **删 canvasStore.ts 预授权**（改造后零命中才是门禁形状）。④ Task 21 棘轮三修：isInline 补数组后缀、**类级 pipe 检测**（前导块——admin-video-work:15 类级挂载先例，方法块级 split 会把约 29 个已保护端点误判违规）、自证用例扩三条+扫描面非空自证。⑤ isPublic 粘性落实：existing 查询前移 + `willBePublic` 单一变量 + PATCH 路径显式登记（存储不变式未做，防线=导入期过滤+读侧剥键）。⑥ Task 10 脚本改用真实 user id（FK P2003）。⑦ 导入侧残缺行守卫前置（Array.isArray→400 业务文案，非 TypeError）。⑧ AuthProvider 改**渲染期写入**（effect 子先父后时序——RequireAuth 放行的首个 commit 里 useMediaUrl effect 先于 AuthProvider effect 跑，':fileId' 孤儿键）+ currentUserId null 不入缓存 + useMediaUrl.test 顶层 beforeEach 重置（防跨用例残留打断既有 4 条）+ 两处 result 未定义修正 + mediaUploadUtils "tsc 红"改"夹具对齐"（vi.fn() 无泛型不红）。⑨ **Task 17↔18 换序**：先剥 sourceGroupId（纯 web 零风险）后加 pipe——每 commit 功能完好，契约测试成为 pipe 上线前体检；剥离改**显式 pick**（与 service pick 同口径——解构丢弃会让未来字段自动上线）。⑩ Task 17 补 `validatorOptions` 断言（instanceof 锁不住选项——摘掉 forbidNonWhitelisted 仍全绿）。⑪ Task 13 降级"两段拼接"（单测不跨 service 编排——仓内惯例）。⑫ Task 1 锚定换 `_expectNever<T extends never>()` 函数式（无 noUnusedLocals/lint 风险）。⑬ 导入侧 cells 非数组 fail-closed。⑭ STITCH_JOB_KEYS 落 shared 跨端锚定（VIDEO_WORK_NODE_TYPES 同款先例）。⑮ batch ttlSec 缺口登记改"R2 内待定（服务端 3 行，R2d 客户端预取消费前必须先给）"。⑯ Task 20 makeJob 改单参 merge 签名 + commit 因果链措辞修正（"web 端从未发送 nodeId"，非"sourceGroupId 被剥离"所致——两者是不同字段名）。

**v4 修订（三份外部评审核实后）：**
① P0：Task 21 正则字面量断行（heredoc 传输层反斜杠折叠写入真换行——语法错误整文件 parse 失败；已修复+Step 2 补"先确认是用例红非 parse 错"）；
② P0：Task 11 落点与标识符（readCanvasMock/projectServiceCreateMock/tplFixture 三标识符目标文件零命中——改为：canvas spec 新用例置于既有 describe('save') :168 内（其 beforeEach :176-183 才接线 readCanvas）、取参 (service as any).collabDoc.readCanvas 与 projectService.create.mock.calls[0][2]、夹具 validTemplate :305 扩字段；残缺行用例移入导入侧；新用例 beforeEach 补 vi.clearAllMocks）；
③ Task 18 删 Object.keys(new CreateStitchTaskDto())（押在 useDefineForClassFields 发射策略——评审二实测今天成立但 target 降级即空数组，且抓不到"漏装饰器"）→ 换逐键 invalid 值 400（装饰器盲修复）+ 任意第 7 键 400（键集行为面）；DTO 装饰器分行；
④ Task 17 删 void STITCH_JOB_KEYS（假引用噪音）→ Pick<StitchParams, (typeof STITCH_JOB_KEYS)[number]> 编译级锚定 + shared 侧 satisfies 内联 Shape；
⑤ F38 基线断言（ungroup/convertGroup→normal 两处"覆盖子节点尺寸"缺陷面钉死——R0 改这两分支但不断言=给 R2a 埋坑；翻转目标=保留用户尺寸）；
⑥ 读侧补 not.objectContaining({select}) 断言（防将来改回 select 漏字段）+ 夹具 const fullRow: Template Prisma 类型标注（编译期强制零手抄）；
⑦ Task 15 分层：抽 utils/mediaUrlCache.ts（AuthProvider 不 import 媒体 hook）+ hook deps 补 uid（身份切换契约钉）+ LRU 用例改 __cachePutForTests 纯函数 + "身份就绪不重取"契约用例 + clearMediaUrlCache 只清 cache 保留 pending（登记）；
⑧ P2002 并发首存窗口登记（templateData 第三写者，与 PATCH 同列已知例外）；
⑨ 棘轮基线扁平集合化（文件改名免疫）+ 两规则统一只查增长 + blocks[0] 前提注释（8/8 类级单行已核）；
⑩ validatorOptions/PIPES_METADATA 断言补降级话术（升 Nest 失败改源码文本断言勿删门禁）；
⑪ Task 1 锚定改纯类型别名（零运行时零 lint 面）；
⑫ Task 8 第二红相=真实回归形态（改回 data.storyboard!）；
⑬ Task 21 红相②删除（新增文件必然红，归因错误不可执行）；
⑭ web lint 补进终验（web test 只跑 vitest，theme lint 零容忍只有 lint 查）；
⑮ 缩格夹具改真溢出（v3 的 null 槽溢出测不到移出——img2.parentId undefined 才是 :1330 语义）；
⑯ Task 15 Files 头 "tsc 红"矛盾修正（v3 漏改处）。
不采纳：抽 R0-FACTS.md（维持 plan 自包含）。已核无需改：expect.unreachable 仓内有先例（nodeStore.test.ts:520 等）。

**v5 修订（第四轮三份外部评审核实后——每条均已对照仓库源码实证；4 项指控核实不成立驳回）：**
① P0【Task 15】mediaUrlCache 的 cacheKey/cacheGet 未导出但被 hook import（TS2305）→ 缓存层导出 getCachedUrl(fileId) 封装（hook 不碰缓存内部结构）；Step 5 git add 补 mediaUrlCache.ts（漏则 R0c commit 自相矛盾——hook 引用不在库模块）；
② P0【Task 11】fullRow status: 'PUBLISHED' 不在枚举（schema.prisma:187-190 实测仅 DRAFT/SAVED；category 'COMMUNITY' 合法 :131-134）→ 'SAVED'——v4 类型标注当场抓住手抄漂移，标注有效性的实证，勿撤标注只改值；
③ P0【Task 15】"身份就绪不重取"用例与 uid dep 自相矛盾（rerender → uid 变 → cacheGet('user-a:f6') miss（null 窗口未入缓存）→ 二次 fetch → toHaveBeenCalledTimes(1) 必红）→ 改断言 2 次+旧 url 新响应到达前不清空（实现只 setError(null) 不清 url，支撑成立）；
④ P0【Task 11/13】validTemplate 是 describe('import') :305 局部常量——三处跨 describe 引用 TS2304+ReferenceError；且 Step 1 第 5 条"残缺行"用例仍残留 canvas spec 代码块内（v4 声称移入导入侧未删原文）→ templateFixture hoist 文件级（teamId/projectId/folderId 显式 **null** 保持 OR 鉴权链行为与现状一致——勿填真值；templateData 补 version:1）+ 删 Step 1 第 5 条；
⑤ P0【Task 21】三处 .join('\n') 断行残留（v4 ① 只修正则处）→ ].join(String.fromCharCode(10)) 抗传输折叠（.claude/tmp-v4-task15.py 的存在证明此前写入经会折叠 '\n' 的传输层）；
⑥ P0【Task 6】"网格重排"断言恒真：夹具 cells ['img1',null] → img1 idx=0 → col 恒 0 → x 恒 0，Number.isFinite(0) 恒真且 gridCols 取任何合法值（resolver 归一后 1~10）结果相同——零判别力 → img1 放第二槽 [null,'img1']（idx=1 → resolver 默认 gridCols=1 → row=1 → y=1*(Math.round(320/(16/9))+CONVERT_GAP)=1*(180+40)=**220** 实算；ungroup 第二段加 gp={0,0} 不影响）断言 y===220；F38 两条同改槽位顺带补 y 断言；:633 直接 mutate store 节点改 setState 夹具；
⑦ P1【Task 11】save 用例断言盯 update 但既有 beforeEach :182 恒 findUnique→null ⇒ 非粘性用例全走 create 分支（红在 update.mock.calls[0][0] 的 TypeError 取参，掩盖真红相——正是 plan 反复要消灭的形态）+ 代码块 5 处 readCanvasMock 字面量残留（v4 只改了落点注释没改代码）→ 嵌套 describe 顶部收口 readCanvas()/savedTemplateData(idx) 双助手（兼容两分支+防悬空假绿）；
⑧ P1【Task 7】夹具/装置三不符（StitchButton.tsx 真实顺序 :66 cells 守卫→:81-84 fileIds 空 return→:86-92 storyboard 守卫在后——"无 storyboard"夹具必须 cells 槽指向带 fileId 节点否则提前返回"没有可拼接的图片"；测试文件是 vi.hoisted setMockNodes 装置无 propsWithNoStoryboardData 助手；无 vi.mock('antd') 断言 message.error 须先补）；
⑨ P1【Task 19/20】stitchQueueAddMock/collabWriteNodeDataMock 标识符杜撰（实为 storyboard.service.spec.ts:4 模块级 const stitchQueue 可直接 .add；collabDoc 是 stitch.consumer.spec.ts:46 beforeEach 局部——提升 describe 作用域）+ Task 20 永久锚退化（清理 mock 后 not.toHaveBeenCalled 恒真；"保留 4 参当编译锚"不可行——TS2554 挂整包 tsc）→ 补 StitchConsumer.length===3 arity 锚（现状 4 必红、实现后 3 长效可进 CI）+ writeNodeData 用例实现后删除（判别力由 arity 锚+grep 零残留接管）；
⑩ P1【Task 21】dtoNoPipe 序号编码（rel#i）盲区：同文件"修好一个+变坏一个"计数不变恒绿 → 改内容标识 rel|param: type 与 inline 桶同构（两桶皆 Set 去重——同文件同参名同类型的重复违规数量不可见，登记为已知盲区，inline 桶 v4 起同款）；blocks[0] 前提注释改准（类装饰器语法上必在 class 前，多行 \s* 跨行可匹配非盲区；真漏判仅字符串/注释含动词装饰器字面量导致切分错位）；v4 ⑨ "文件改名免疫"表述如实修正为"搬运=重审"（rel 段变化 tuple 必红，人工确认后更新基线——非自动免疫）；
⑪【Task 15】fetchMediaUrl key 捕获契约（在飞请求跨换号只写回自己的键——闭包捕获是正确性前提，无守则将来改成"调用时刻重算"即串号）→ key 行注释+跨换号用例；clearMediaUrlCache（登出：只清 cache）与 __resetMediaCacheForTests（测试隔离：清两者）语义注释区分；
⑫【Task 9】F35 现场 TODO（ydocBuilder.ts:33/canvasCollabRuntime.ts:242 行号实测准确——plan 会归档，R1b 实施者只看代码）；【Task 16/22】补 web lint（mediaUrlCache.ts/AuthProvider.tsx/stitchApi.test.ts 均落 src 受 theme lint 零容忍约束）；【Task 17】StitchWireShape 补"字段类型镜像 CreateStitchTaskDto"注释；【Task 18】fileIds 元素类型断言（['ok',123] 拒）+ 标题改"非标量/错误值"；【Task 1】_Anchor 勿删注释；版本头统一 v5。
驳回（核实不成立，勿改）：评审二"getTemplate 夹具缺 teamId 必 Forbidden"——plan 夹具 isPublic:true 短路整条 OR 鉴权链（template.service.ts:118 `if (!template.isPublic && ...)`），根本不读 teamId；评审一"Task 17/1 git add 漏 stitch.ts/group.test.ts"——:1890/:208 实测均含目标文件（只有 Task 15 漏 mediaUrlCache.ts 为真）；评审二".test.ts 可能不被 vitest 收"——vite.config.ts test 段无 include 覆盖，vitest 默认 include 双后缀都收且仓内既有大量 .test.ts 在跑（Task 8 Step 2 已含"先跑一次确认被执行"自检）；评审一"0 除任何数得 0"表述不准（0/NaN=NaN）——不影响 ⑥ 结论。

**执行前置：** 沙箱须 workspace-write 且 git 可 commit；本地 dev DB（postgres）可用（Task 10 地基实证需要）。

**关键既有事实（v2 全部现场重验；行号漂移时以符号+grep 为准）：**

| 事实 | 位置（已验） |
|---|---|
| API 生产源码禁值导入 `@flowweb/shared`；测试值导入先例 | `apps/api/src/admin.guard.ts:3-5`、`snapshot-filter.util.spec.ts:5`（注释含 vite-node 坑与降级预案） |
| `WHITELIST.group` 3 键；`FilterOptions` 无 whitelist；克隆不传表；**resetStatusIdle 是写入 `'idle'` 非剥除** | `snapshot-filter.util.ts:42/:19-24/:100-103`、`video-work-clone.service.ts:35-38` |
| web `GroupNodeData` 5 键；**`color`/`nameCustom` 是 R2c 前向键，现状 store 不产出**（grep 零命中） | `apps/web/src/types/group.ts:14-20` |
| store 5 处 `.storyboard` 裸解引用；**:1219 `gd.cells.indexOf` 无守卫**（其余 5 处 cells 均有 `?? []`） | `canvasStore.ts:855/:973/:1212/:1307/:1332`、`:1219` |
| 渲染 2 处 + 守卫 1 处；CanvasView 下游 cfg 消费 `:629-648` | `StoryboardGroupRenderer.tsx:12`、`CanvasView.tsx:570`、`StitchButton.tsx:86-92` |
| **storyboard.controller.spec.ts 已存在（97 行 5 用例，直调 controller 方法——不经过 Nest 管道）**；pipe 直测先例 `material-library/dto/dto-whitelist.spec.ts`、装饰器断言先例 `dto-decorators.spec.ts` | 同左 |
| **`stitchApi.ts:11` `sourceGroupId` 注释自称"不发给后端"但 `:28 JSON.stringify(params)` 整体上线**；`StitchButton.tsx:101` 塞入；`useStitchTask.ts:63` 本地消费（spawnResultNode 定位） | 同左 |
| **`storyboard.service.ts:7-10` 已有 `export interface StitchTaskDto`**（命名撞车） | 同左 |
| 导出侧剥三键 / 导入侧同款 + cells 无重映射 / 第三站点 fillDoc 已认三键 | `canvas.service.ts:77-79`、`template.service.ts:242-246`、`project.service.ts:62-76` |
| NodeSchema 4 键、`validateTemplateData` 返回 `.parse` 结果；seed 仅缺失时 create | `template.validation.ts:3-24`、`template.service.ts:291-316` |
| **Template 模型 :140-141 有 `coverUrl String?`/`dataUrl String?`（v3 纠错：v2 曾误记"无"——grep 窗口截漏）**，folder.service.ts:30/:43 工作区缩略图消费（自带 select 不受 list 剥键影响）；**无 `name_userId` 复合唯一键**（仅 projectId @unique + 4 @@index） | `apps/api/prisma/schema.prisma:136-164`、`apps/api/src/modules/folder/folder.service.ts:30/:43` |
| list 无 select 整行 / getTemplate 整行 / update 翻 isPublic；**list 结果进内存 cache** | `template.service.ts:94/:136/:162-164/:106` |
| getMediaUrl 缓存裸 string；controller 包装 `{ url }`；**`useMediaUrl.test.ts` 已存在 4 用例，mock 层 `vi.mock('@/api/client')`**；`mediaUploadUtils.test.ts:36` mock 无 ttlSec（**vi.fn() 无泛型——非 tsc 红，补齐理由=夹具契约对齐**） | `media.service.ts:24-31`、`media.controller.ts:15-19`、`useMediaUrl.test.ts:6-10` |
| `@Body() body: any` + 尾展开；consumer 5 键块 + collabDoc 三处；**stitch.consumer.spec.ts:13 `makeJob = () => ({...})` 无参签名（改造需改单参 merge）** | `storyboard.controller.ts:15`、`storyboard.service.ts:47`、`stitch.consumer.ts:5/:33/:112-121` |
| **类级 `@UsePipes(new ValidationPipe(...))` 是仓内主流挂载形态**（admin-video-work:15、video-project:7、material-library file/folder、admin-style 等）——方法块级 pipe 判定必须含类级前导块回退，否则约 29 个已保护端点误判违规 | `admin-video-work.controller.ts:15` 等 |
| 方法级 ValidationPipe 先例（media batch）+ pipe 直测先例（dto-whitelist.spec.ts 仅直测，**PIPES_METADATA 断言属仓内首例**——@nestjs/common/constants 已验证可导） | `media.controller.ts:30-34`、`material-library/dto/dto-whitelist.spec.ts` |
| **snapshot-filter.util.spec.ts 的 `base`/`cloneOpts` 是外层 describe 闭包常量（:13-14）**——文件级追加引用它们 TS2304（同文件 :188-189 踩坑注释）；`:5` 已 import VIDEO_WORK_NODE_TYPES；**`:154-156` 已有 WHITELIST keys ⊇ VIDEO_WORK_NODE_TYPES 覆盖用例** | 同左 |
| **API test 脚本 = `tsc -p tsconfig.spec.json --noEmit && vitest run`**（新模块的"FAIL"先出现在 tsc 阶段 TS2307；spec 文件被 tsconfig.spec.json 检查） | `apps/api/package.json:8` |
| **store 侧既有专用测试文件**：`canvasStore.storyboardConfig.test.ts`、`canvasStore.storyboard.test.ts`、`canvasStore.groups.test.ts` | 同左 |
| `apps/web/src/utils/` 是组/分镜纯函数惯例目录（groupLayout/groupDerive/nodeOrder/imageNodeGuards） | 同左 |
| AuthProvider：`refresh`(:31-38)/`logout`(:42-45) 为 user 状态仅有的两个变更入口 | `apps/web/src/components/AuthProvider.tsx` |

**commit 纪律：** 每 task 小 commit；R0a/R0b/R0c/R0d 各自成可发布独立改动。TS strict 全程生效。

**测试命令速查：**
- web 单测：`pnpm --filter @flowweb/web test -- --run <路径>`
- API 单测：`pnpm --filter @flowweb/api test -- --run <路径>`（先 tsc 后 vitest——新文件的红=TS2307）
- API 仅 vitest：`pnpm --filter @flowweb/api exec vitest run <路径>`
- shared：`pnpm --filter @flowweb/shared test -- --run`
- web 类型检查：`pnpm --filter @flowweb/web exec tsc --noEmit`（含 test 文件）
- API 类型检查：`pnpm --filter @flowweb/api exec tsc --noEmit`（生产码，排除 spec）

---

## 文件结构总览（v5）

**R0a 新建：**
- `packages/shared/src/types/group.ts` + `group.test.ts` — GroupNodeDataShape（9 键）+ GROUP_NODE_DATA_KEYS + **编译期 Exclude 双向锚定（_expectNever 函数式）**
- `apps/web/src/utils/storyboardConfig.ts` + `.test.ts` — resolveStoryboardConfig + hasStoryboardConfig + DEFAULT（**落 utils/ 惯例目录，非 pages**）
- `apps/web/src/utils/storyboard-dereref-guard.test.ts` — `.storyboard\b` 裸解引用 allowlist 门禁（**.test.ts——web 惯例，且门禁排除式含 spec/test 双后缀防扫到自己**）

**R0a 修改：**
- `packages/shared/src/index.ts`
- `apps/web/src/types/group.ts` — 导出 `ASPECT_RATIOS as const`（枚举单源，纯增量）
- `apps/api/src/modules/video-work/snapshot-filter.util.ts` + `.spec.ts` — whitelist 参数 + CLONE_WHITELIST + **normalizeNodeRecord 导出**（双归一化器统一）
- `apps/api/src/modules/video-work/video-work-clone.service.ts` + `.spec.ts`
- `apps/web/src/stores/canvasStore.ts` — 5 处解引用 + **:1219 cells `?? []`**
- `apps/web/src/pages/canvas/components/groups/StoryboardGroupRenderer.tsx`、`CanvasView.tsx`、`StitchButton.tsx`
- `apps/web/src/collab/ydocBuilder.ts` + `apps/web/src/stores/canvasCollabRuntime.ts` — F35 现场 TODO 登记两行（Task 9 Step 3，纯注释）
- 测试：`canvasStore.storyboardConfig.test.ts`（NaN 双点）、`canvasStore.storyboard.test.ts`/`canvasStore.groups.test.ts`（命令行为）、`StoryboardGroupRenderer.test.tsx`

**R0b 新建：** 无（归一化函数并入 snapshot-filter.util.ts——消双归一化器）

**R0b 修改：**
- `apps/api/src/modules/video-work/snapshot-filter.util.ts` — normalizeNodeRecord
- `apps/api/src/modules/canvas/canvas.service.ts` + `.spec.ts`
- `apps/api/src/modules/template/template.validation.ts` + `.spec.ts`
- `apps/api/src/modules/template/template.service.ts` + `.spec.ts`
- `apps/api/src/modules/project/project.service.ts` — 近零改动（行为由用例锁）

**R0c 修改：**
- `apps/api/src/modules/media/media.service.ts` + `.spec.ts`（断言+**夹具**迁移）
- `apps/api/src/modules/media/media.controller.ts`
- `apps/web/src/api/mediaApi.ts`
- `apps/web/src/hooks/useMediaUrl.ts` + `.test.ts`（mock 层维持 `@/api/client`；**既有顶层 beforeEach 补 cache 重置——Modify 非纯追加**）
- `apps/web/src/components/AuthProvider.tsx` — currentUserId **渲染期写入** + 登出清空挂点
- `apps/web/src/utils/mediaUploadUtils.test.ts` — :36 mock 补 ttlSec（**夹具与真实契约对齐**——vi.fn() 无泛型，非 tsc 红）

**R0d 新建：**
- `apps/web/src/api/stitchApi.test.ts` — 线上载荷契约（body 键集恰 6 键——**先行，pipe 上线前体检**）
- `packages/shared/src/types/stitch.ts` — STITCH_JOB_KEYS 跨端锚定
- `apps/api/src/modules/storyboard/storyboard.dto.ts` — **CreateStitchTaskDto**（避撞名）
- `apps/api/src/modules/storyboard/storyboard.pipe.spec.ts` — pipe 直测 + PIPES_METADATA 结构断言 + validatorOptions 选项断言
- `apps/api/src/common/body-param-ratchet.spec.ts` — 方法块级+**类级回退**棘轮门禁

**R0d 修改：**
- `apps/api/src/modules/storyboard/storyboard.controller.ts` + 既有 `storyboard.controller.spec.ts`
- `apps/api/src/modules/storyboard/storyboard.service.ts`（删 interface 改 import class + 显式 pick）+ `.spec.ts`
- `apps/api/src/modules/storyboard/stitch.consumer.ts` + `.spec.ts`
- `apps/web/src/api/stitchApi.ts` — 剥 sourceGroupId + 类型拆分

---

# R0a 克隆分表 + resolveStoryboardConfig + 门禁

## Task 1: shared 落 GROUP_NODE_DATA_KEYS（编译期双向锚定）

**Files:**
- Create: `packages/shared/src/types/group.ts`
- Create: `packages/shared/src/types/group.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: 写失败测试（v2：恒红 bug 已修——运行时只锁长度，双向一致由编译期断言承载）**

`group.test.ts`：

```ts
import { GROUP_NODE_DATA_KEYS } from './group';

describe('GROUP_NODE_DATA_KEYS', () => {
  it('恰为 9 键（R0a clone 表契约）', () => {
    expect(GROUP_NODE_DATA_KEYS).toHaveLength(9);
    expect([...GROUP_NODE_DATA_KEYS].sort()).toEqual(
      ['cells', 'collapsed', 'color', 'groupType', 'manuallyResized', 'name', 'nameCustom', 'savedSize', 'storyboard'].sort(),
    );
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @flowweb/shared test -- --run src/types/group.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现（类型 + 常量 + 编译期双向断言）**

`packages/shared/src/types/group.ts`（storyboard 内联独立定义，不 import web）：

```ts
/** 组节点 data 形状（spec §4.6/F30）。R0a 仅作 GROUP_NODE_DATA_KEYS 的锚定面；
 *  web 侧 types/group.ts 的 GroupNodeData 重构切换属 R1（F30），本分片不动它。
 *  注意 color/nameCustom 是 R2c 前向键——现状 store 不产出，为克隆/公开过滤契约预置。 */
export interface GroupNodeDataShape {
  groupType: 'normal' | 'storyboard';
  name?: string;
  collapsed?: boolean;
  cells?: (string | null)[];
  storyboard?: {
    aspectRatio: string;
    gridRows: number;
    gridCols: number;
    showIndex: boolean;
    stitchResolution: '2K' | '4K';
  };
  savedSize?: { width: number; height: number };
  nameCustom?: boolean;
  color?: string;
  manuallyResized?: boolean;
}

/** 组节点 data 克隆/公开过滤白名单单源（注意：是"过滤契约键"，非组 data 全集——
 *  store 实际还写 aspectRatio/customSize 等运行键，不在此表、克隆会剥，属预期）。
 *  API 生产源码暂用字面量（F36），R1a 构建后切值导入。 */
export const GROUP_NODE_DATA_KEYS = [
  'groupType', 'cells', 'name', 'storyboard', 'collapsed',
  'savedSize', 'nameCustom', 'color', 'manuallyResized',
] as const satisfies readonly (keyof GroupNodeDataShape)[];

// 双向编译锚定（spec §4.6：satisfies 防多余键 + Exclude 防缺键——两向任一漂移 tsc 红）。
// v4：纯类型别名断言——零运行时代码零 lint 面（无 no-empty-function/noUnusedLocals 风险，产物无痕）
type _MissingFromKeys = Exclude<keyof GroupNodeDataShape, (typeof GROUP_NODE_DATA_KEYS)[number]>;
type _AssertNoMissing<T extends never> = T;
// v5：编译器断言锚——勿删/勿被"清理死代码"误清（无任何引用是刻意的：删除即静默失去缺键防护，没有任何测试会红）
type _Anchor = _AssertNoMissing<_MissingFromKeys>;
```

`packages/shared/src/index.ts` 末尾追加 `export * from './types/group';`

- [ ] **Step 4: 跑测试通过 + 红相实证（两向，结果记入 commit message）**

Run: `pnpm --filter @flowweb/shared test -- --run src/types/group.test.ts`
Expected: PASS

红相实证：① 临时往 Shape 加 `foo?: string;` → `pnpm --filter @flowweb/shared exec tsc --noEmit` 应红（Exclude 方）→ 删回；② 临时从 KEYS 删 `'color'` → tsc 应红（satisfies 方不红、但 `_MissingFromKeys` 变 `'color'` 红）→ 恢复。**注意：satisfies 单向检不出删键（删 'color' 时 satisfies 仍过）——红来自 Exclude 断言，如实登记。**

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/group.ts packages/shared/src/types/group.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): GROUP_NODE_DATA_KEYS 9 键+编译期双向锚定（R0a；红相实证：Shape 加键 Exclude 红/KEYS 删键 Exclude 红——satisfies 单向如实登记）"
```

## Task 2: FilterOptions.whitelist + CLONE_WHITELIST + normalizeNodeRecord

**Files:**
- Modify: `apps/api/src/modules/video-work/snapshot-filter.util.ts`
- Test: `apps/api/src/modules/video-work/snapshot-filter.util.spec.ts`

- [ ] **Step 1: 写失败测试（clone 表 9 键 + parity + 归一化单入口）**

**追加位置（v3 关键）：新用例全部置于既有外层 `describe('snapshot-filter 白名单…')` 内部末尾**——`base`/`cloneOpts` 是该 describe 的闭包常量（:13-14），文件级引用会 TS2304（同文件 :188-189 已有踩坑注释先例）。import 区补 `CLONE_WHITELIST, normalizeNodeRecord`（**`VIDEO_WORK_NODE_TYPES` :5 已 import 勿重复**；值导入先例与降级预案见该行注释——若跑出 ERR_UNKNOWN_FILE_EXTENSION / Unexpected token 'export'，按注释降级本地常量数组）：

```ts
// ↓↓↓ 以下追加进既有外层 describe 内部 ↓↓↓

it('clone 表 group 保留全部 9 键（R0a）', () => {
  const input: RawCanvasData = {
    nodes: [rawNode('g1', 'group', {
      groupType: 'storyboard', cells: ['n1', null], name: '分镜',
      storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: true, stitchResolution: '2K' },
      collapsed: false, savedSize: { width: 100, height: 60 },
      nameCustom: true, color: 'red', manuallyResized: true,
    })],
    edges: [],
  };
  const out = buildFilteredSnapshot(input, {
    dropTypes: ['videoEdit'], dropIdPrefixes: ['shadow-'], resetStatusIdle: true, injectThumbnails: false,
    whitelist: CLONE_WHITELIST,
  });
  expect(Object.keys(out.nodes[0].data).sort()).toEqual(
    ['cells', 'collapsed', 'color', 'groupType', 'manuallyResized', 'name', 'nameCustom', 'savedSize', 'storyboard'].sort(),
  );
});

it('不传 whitelist 维持 snapshot 表（group 3 键——F21 载荷收敛不推翻）', () => {
  const input: RawCanvasData = {
    nodes: [rawNode('g1', 'group', {
      groupType: 'storyboard', cells: ['n1'], name: '分镜',
      storyboard: { aspectRatio: '16:9' }, collapsed: true, savedSize: { width: 1, height: 1 },
    })],
    edges: [],
  };
  const out = buildFilteredSnapshot(input, base);
  expect(Object.keys(out.nodes[0].data).sort()).toEqual(['cells', 'groupType', 'name']);
});

it('CLONE_WHITELIST.group 与 shared GROUP_NODE_DATA_KEYS parity（防 R1a 切值导入漏项）', async () => {
  const { GROUP_NODE_DATA_KEYS } = await import('@flowweb/shared');
  expect([...CLONE_WHITELIST.group].sort()).toEqual([...GROUP_NODE_DATA_KEYS].sort());
});

it('CLONE_WHITELIST 覆盖全部节点类型（WHITELIST 侧既有 :154-156 已锚定——本条只补 clone 侧对称半边）', () => {
  for (const t of VIDEO_WORK_NODE_TYPES) expect(Object.keys(CLONE_WHITELIST)).toContain(t);
});

it('normalizeNodeRecord：parentId/width/height null → undefined（JSON.stringify 键消失）', () => {
  // v5.1 errata（执行期发现）：RawNode 的 width/height 是 ??: number 不含 null——裸 null 字面量 TS2322
  // 挂包级 test 脚本 tsc 先行门（同文件 :178 as any 先例）；parentId 是 string | null 无需 cast
  const out = normalizeNodeRecord({ id: 'n1', type: 'group', position: { x: 1, y: 2 }, data: {}, parentId: null, width: null, height: null } as any);
  expect(JSON.parse(JSON.stringify(out)).parentId).toBeUndefined();
  expect(JSON.parse(JSON.stringify(out)).width).toBeUndefined();
});

it('normalizeNodeRecord：有值全保留；position undefined → {x:0,y:0}；data undefined → {}', () => {
  const out = normalizeNodeRecord({ id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal' }, width: 320, height: 180 });
  expect(out.width).toBe(320);
  expect(out.parentId).toBeUndefined();
  const out2 = normalizeNodeRecord({ id: 'n1', type: 'textInput', data: undefined, position: undefined } as any);
  expect(out2.position).toEqual({ x: 0, y: 0 });
  expect(out2.data).toEqual({});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/video-work/snapshot-filter.util.spec.ts`
Expected: FAIL（CLONE_WHITELIST/normalizeNodeRecord 未导出、whitelist 参数不存在）

- [ ] **Step 3: 实现**

`snapshot-filter.util.ts`：

3a. `FilterOptions` 追加 `whitelist?: Record<string, string[]>;`（注释：不传=WHITELIST 快照端；clone 端传 CLONE_WHITELIST）。

3b. `WHITELIST` 之后新增（**API 生产源码字面量，禁值导入 shared——F36**；`{...WHITELIST}` 是浅拷贝、其余类型数组与快照表共享引用——**两表均只读，勿原地 mutate**，注释写死）：

```ts
/** clone 端白名单（spec F21/R0a）：与 snapshot 表唯一差异是 group 9 键。
 *  R0b 公开模板过滤复用本表（媒体引用剥离政策：克隆与公开模板同款——spec v10 裁决 2）；
 *  R1a 构建落地后切值导入并删字面量。浅拷贝共享其余数组——只读，勿原地改。 */
export const CLONE_WHITELIST: Record<string, string[]> = {
  ...WHITELIST,
  group: ['groupType', 'cells', 'name', 'storyboard', 'collapsed', 'savedSize', 'nameCustom', 'color', 'manuallyResized'],
};

/** 信封边界归一单入口（R0b 模板导出/applyWhitelist 尾部共用，R1a 收编 shared nodeEnvelope）：
 *  parentId/width/height null→undefined（JSON.stringify 键消失）；position/data undefined→兜底。
 *  注意 cells 的 null 是"空宫格占位"必须保留——本函数只碰信封键，不碰 data 内部。 */
export function normalizeNodeRecord(n: RawNode): RawNode {
  return {
    ...n,
    parentId: n.parentId ?? undefined,
    width: n.width ?? undefined,
    height: n.height ?? undefined,
    position: n.position ?? { x: 0, y: 0 },
    data: n.data ?? {},
  };
}
```

3c. `applyWhitelist` 内取表处改 `const table = opts.whitelist ?? WHITELIST;`（原 `WHITELIST[node.type]` 引用全部改 `table[node.type]`）。

3d. `applyWhitelist` 尾部 return（:107 现状 `{ ...node, width: node.width ?? undefined, ... }`）改为 `return normalizeNodeRecord({ ...node, data });`——**消灭双归一化器**（一处改两处漏的坑）。**行为差异登记（v5.1）：** 旧 return 不碰 parentId——readCanvas 对无父节点返回 `parentId: null`（collab-document.service.ts:67），旧快照/克隆输出带 `"parentId": null`，新输出该键消失；消费面已核安全（克隆链 project.service.ts:65 与 web ydocBuilder.ts:33 均是 `!= null` 守卫，null/undefined 同 treatment）——属"消双归一化器"的直接后果与 width/height 同款的有益对齐，非事故。

- [ ] **Step 4: 跑测试确认通过（含既有快照/克隆口径用例零回归）**

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/video-work/snapshot-filter.util.spec.ts`
Expected: PASS（含既有用例）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/video-work/snapshot-filter.util.ts apps/api/src/modules/video-work/snapshot-filter.util.spec.ts
git commit -m "feat(api): whitelist 分表+CLONE_WHITELIST 9 键+normalizeNodeRecord 归一单入口（R0a；类型全覆盖对称锚定）"
```

## Task 3: 克隆链路接 clone 表 + 政策断言 + G1 行为断言

**Files:**
- Modify: `apps/api/src/modules/video-work/video-work-clone.service.ts:35-38`
- Test: `apps/api/src/modules/video-work/video-work-clone.service.spec.ts`

- [ ] **Step 1: 写失败测试**

在组夹具（:21 附近，grep `type: 'group'` 定位）data 补 `storyboard/collapsed/savedSize/manuallyResized`；追加用例（**取参模式：先 `expect(createMock).toHaveBeenCalled()` 打头防取到 undefined 假绿**）：

```ts
it('克隆保留组 storyboard/collapsed/savedSize + 用户手动尺寸不重排（G1 行为断言）', async () => {
  const result = await service.clone('work-1', 'user-1');
  expect(projectService.create).toHaveBeenCalled(); // 防悬空取参
  const createdNodes = projectService.create.mock.calls[0][2] as any[];
  const group = createdNodes.find((n: any) => n.type === 'group');
  expect(group.data.storyboard).toEqual({ aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: true, stitchResolution: '2K' });
  expect(group.data.collapsed).toBe(false);
  expect(group.data.savedSize).toEqual({ width: 100, height: 60 });
  expect(group.data.manuallyResized).toBe(true);
  expect(group.data.cells).toBeDefined();
});

it('政策断言：媒体引用仍剥离（F20 维持）+ 状态归一 idle（resetStatusIdle 写入语义）', async () => {
  await service.clone('work-1', 'user-1');
  expect(projectService.create).toHaveBeenCalled();
  const createdNodes = projectService.create.mock.calls[0][2] as any[];
  const multi = createdNodes.find((n: any) => n.type === 'multiImageGen');
  expect(multi.data.images).toBeUndefined();
  const imageGen = createdNodes.find((n: any) => n.type === 'imageGen');
  expect(imageGen.data.fileId).toBeUndefined();
  expect(imageGen.data.status).toBe('idle'); // v2 修正：resetStatusIdle 写 'idle' 非剥除
});
```

（video-work-clone.service.spec.ts 侧取参：`projectService.create.mock.calls[0][2]`——按该文件 TestBed 的 ProjectService useValue mock；断言逻辑与字段如上。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/video-work/video-work-clone.service.spec.ts`
Expected: FAIL（storyboard/collapsed/savedSize undefined——现行 3 键表剥除）

- [ ] **Step 3: 实现——clone 调用传 clone 表**

`video-work-clone.service.ts:35-38` 的 buildFilteredSnapshot 实参加 `whitelist: CLONE_WHITELIST`（import 区补）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/video-work/video-work-clone.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/video-work/video-work-clone.service.ts apps/api/src/modules/video-work/video-work-clone.service.spec.ts
git commit -m "fix(api): 克隆走 CLONE_WHITELIST——storyboard/collapsed/savedSize/manuallyResized 不再剥（F2 根因半边+G1 手动尺寸保持；夹具补 storyboard F27）"
```

## Task 4: storyboardConfig 解析器（utils/ 惯例目录）

**Files:**
- Create: `apps/web/src/utils/storyboardConfig.ts`
- Create: `apps/web/src/utils/storyboardConfig.test.ts`
- Modify: `apps/web/src/types/group.ts`（导出 ASPECT_RATIOS，纯增量）

- [ ] **Step 1: 写失败测试**

`storyboardConfig.test.ts`：

```ts
import { resolveStoryboardConfig, hasStoryboardConfig, DEFAULT_STORYBOARD_CONFIG } from './storyboardConfig';
import { ASPECT_RATIOS } from '@/types/group';

describe('resolveStoryboardConfig（F2——缺省/非法字段全兜底，渲染与 store 共用）', () => {
  it('data 无 storyboard → DEFAULT（16:9/1×1/false/2K）', () => {
    expect(resolveStoryboardConfig({})).toEqual(DEFAULT_STORYBOARD_CONFIG);
    expect(resolveStoryboardConfig(undefined)).toEqual(DEFAULT_STORYBOARD_CONFIG);
    expect(resolveStoryboardConfig({ storyboard: null })).toEqual(DEFAULT_STORYBOARD_CONFIG);
  });

  it('合法配置透传', () => {
    const cfg = { aspectRatio: '9:16', gridRows: 2, gridCols: 3, showIndex: true, stitchResolution: '4K' };
    expect(resolveStoryboardConfig({ storyboard: cfg })).toEqual(cfg);
  });

  it('非法 aspectRatio → 16:9；非法 resolution → 2K', () => {
    const out = resolveStoryboardConfig({ storyboard: { aspectRatio: 'bogus', stitchResolution: '8K' } });
    expect(out.aspectRatio).toBe('16:9');
    expect(out.stitchResolution).toBe('2K');
  });

  it('gridRows/gridCols 越界/非数值钳制 1~10（与服务端校验同口径）', () => {
    expect(resolveStoryboardConfig({ storyboard: { gridRows: 0 } }).gridRows).toBe(1);
    expect(resolveStoryboardConfig({ storyboard: { gridRows: 99 } }).gridRows).toBe(10);
    expect(resolveStoryboardConfig({ storyboard: { gridRows: 'x' as any } }).gridRows).toBe(1);
  });

  it('部分字段缺省逐字段兜底（merge 语义非全有全无）', () => {
    const out = resolveStoryboardConfig({ storyboard: { gridRows: 3, showIndex: 'yes' as any } });
    expect(out.gridRows).toBe(3);
    expect(out.gridCols).toBe(1);
    expect(out.showIndex).toBe(false);
  });
});

describe('hasStoryboardConfig（守卫型消费点⑧用——显式提示而非静默默认）', () => {
  it('有真实配置 true；缺失/null/非对象 false', () => {
    expect(hasStoryboardConfig({ storyboard: { gridRows: 1 } })).toBe(true);
    expect(hasStoryboardConfig({})).toBe(false);
    expect(hasStoryboardConfig({ storyboard: null })).toBe(false);
    expect(hasStoryboardConfig(undefined)).toBe(false);
  });
});

describe('ASPECT_RATIOS 单源（types/group.ts）', () => {
  it('与 resolver 枚举一致（6 比例）', () => {
    expect(ASPECT_RATIOS).toHaveLength(6);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @flowweb/web test -- --run src/utils/storyboardConfig.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

3a. `apps/web/src/types/group.ts` 类型区前加（消第三份字面量）：

```ts
export const ASPECT_RATIOS = ['21:9', '16:9', '9:16', '3:4', '4:3', '1:1'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];
```

（删除原 `export type AspectRatio = '21:9' | ...` 行，联合类型由常量派生——引用处零改动。）

3b. `apps/web/src/utils/storyboardConfig.ts`：

```ts
import { ASPECT_RATIOS, type StoryboardConfig } from '@/types/group';

const RESOLUTIONS = ['2K', '4K'] as const;

export const DEFAULT_STORYBOARD_CONFIG: StoryboardConfig = {
  aspectRatio: '16:9', gridRows: 1, gridCols: 1, showIndex: false, stitchResolution: '2K',
};

const clampInt = (v: unknown, min: number, max: number): number => {
  const n = typeof v === 'number' ? Math.round(v) : Number.NaN;
  if (!Number.isFinite(n)) return DEFAULT_STORYBOARD_CONFIG.gridRows;
  return Math.min(max, Math.max(min, n));
};

/** 克隆体/异常 data 的分镜配置解析器（spec §4.6 F2）：渲染与 store 全部消费点必须经本函数。
 *  默认值统一引用 DEFAULT_STORYBOARD_CONFIG（改默认一处生效——防硬编码漂移）。 */
export function resolveStoryboardConfig(data: { storyboard?: unknown } | undefined | null): StoryboardConfig {
  const raw = (data as Record<string, unknown> | null | undefined)?.storyboard;
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_STORYBOARD_CONFIG };
  const s = raw as Record<string, unknown>;
  return {
    aspectRatio: (ASPECT_RATIOS as readonly string[]).includes(s.aspectRatio as string)
      ? (s.aspectRatio as StoryboardConfig['aspectRatio']) : DEFAULT_STORYBOARD_CONFIG.aspectRatio,
    gridRows: clampInt(s.gridRows, 1, 10),
    gridCols: clampInt(s.gridCols, 1, 10),
    showIndex: typeof s.showIndex === 'boolean' ? s.showIndex : DEFAULT_STORYBOARD_CONFIG.showIndex,
    stitchResolution: (RESOLUTIONS as readonly string[]).includes(s.stitchResolution as string)
      ? (s.stitchResolution as StoryboardConfig['stitchResolution']) : DEFAULT_STORYBOARD_CONFIG.stitchResolution,
  };
}

/** 守卫型消费点（StitchButton）用：显式判"有无真实配置"——缺配置时提示用户而非按默认静默拼接。
 *  裸解引用只允许出现在本模块（.storyboard\b 门禁 allowlist 见 storyboard-dereref-guard.spec.ts）。 */
export function hasStoryboardConfig(data: { storyboard?: unknown } | undefined | null): boolean {
  const raw = (data as Record<string, unknown> | null | undefined)?.storyboard;
  return raw != null && typeof raw === 'object';
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @flowweb/web test -- --run src/utils/storyboardConfig.test.ts && pnpm --filter @flowweb/web exec tsc --noEmit`
Expected: PASS + 零类型错误

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/storyboardConfig.ts apps/web/src/utils/storyboardConfig.test.ts apps/web/src/types/group.ts
git commit -m "feat(web): storyboardConfig 解析器+hasStoryboardConfig+ASPECT_RATIOS 单源（F2；落 utils 惯例目录）"
```

## Task 5: 渲染侧 2 消费点接 resolver

**Files:**
- Modify: `apps/web/src/pages/canvas/components/groups/StoryboardGroupRenderer.tsx:12`
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx:570`
- Test: `apps/web/src/pages/canvas/components/groups/StoryboardGroupRenderer.test.tsx`

- [ ] **Step 1: 写失败测试（无 storyboard 克隆体渲染不崩）**

在 `StoryboardGroupRenderer.test.tsx` 追加（props 按既有夹具）：

```tsx
it('无 storyboard 的克隆体渲染不崩且按 1×1 默认网格（F2 消费点①）', () => {
  const noStoryboardData = { groupType: 'storyboard', cells: [null] } as any;
  expect(() => render(<StoryboardGroupRenderer id="g1" data={noStoryboardData} cellNodes={[]} />)).not.toThrow();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @flowweb/web test -- --run src/pages/canvas/components/groups/StoryboardGroupRenderer.test.tsx`
Expected: FAIL（`data.storyboard!` undefined → `cfg.gridRows` TypeError）

- [ ] **Step 3: 实现**

3a. `StoryboardGroupRenderer.tsx:12`：`const cfg = data.storyboard!;` → `const cfg = resolveStoryboardConfig(data);`
3b. `CanvasView.tsx:570`：`const cfg = gd.storyboard;` → `const cfg = resolveStoryboardConfig(gd);`——下游 `:629-648`（AspectRatioDropdown/GridSizeDropdown/StitchButton 的 cfg.* 取值）零改动。

- [ ] **Step 4: 跑测试确认通过（含既有用例）**

Run: `pnpm --filter @flowweb/web test -- --run src/pages/canvas/components/groups/StoryboardGroupRenderer.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/components/groups/StoryboardGroupRenderer.tsx apps/web/src/pages/canvas/components/CanvasView.tsx apps/web/src/pages/canvas/components/groups/StoryboardGroupRenderer.test.tsx
git commit -m "fix(web): 渲染侧分镜配置经 resolver——克隆体渲染/工具条不崩（F2 消费点①②）"
```

## Task 6: store 侧 5 消费点 + cells 守卫 + NaN 全维断言

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts:855/:973/:1212/:1219/:1307/:1332`
- Test: `apps/web/src/stores/canvasStore.storyboardConfig.test.ts`（NaN 双点+配置命令）、`canvasStore.storyboard.test.ts`/`canvasStore.groups.test.ts`（命令行为——**归属已指名，非"现场定"**）

- [ ] **Step 1: 写失败测试（NaN 断言含"写进 doc 的腐化"维度——spec §4.6 明言后者才是腐化本体）**

在 `canvasStore.storyboardConfig.test.ts` 追加（夹具模式按该文件既有用例）：

```ts
import { ASPECT_RATIOS } from '@/types/group';

// v5：cells 可传——第二槽夹具 [null, 'img1'] 是判别力关键（idx=0 时 col/x 恒 0，位置断言无判别力）
const cloneGroupNode = (id: string, cells: (string | null)[] = ['img1', null]) => ({
  id, type: 'group', position: { x: 0, y: 0 }, parentId: undefined,
  data: { groupType: 'storyboard', cells }, // 无 storyboard（旧克隆产物）
});

describe('克隆体上 storyboard store 命令不崩（F2 消费点③④⑤）+ NaN 双点全维断言（⑥⑦）', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      nodes: [
        cloneGroupNode('g1'),
        { id: 'img1', type: 'imageGen', position: { x: 0, y: 0 }, parentId: 'g1', data: {} },
      ] as any, edges: [],
    });
  });

  it('ungroup：无 storyboard 不抛', () => {
    expect(() => useCanvasStore.getState().ungroup('g1')).not.toThrow();
  });

  it('convertGroup(g1, normal)：无 storyboard 且无 cells 不抛（:1212 resolver + :1219 守卫双覆盖）', () => {
    useCanvasStore.setState({ nodes: [{ ...cloneGroupNode('g1'), data: { groupType: 'storyboard' } }] as any, edges: [] });
    expect(() => useCanvasStore.getState().convertGroup('g1', 'normal')).not.toThrow();
  });

  it('convertGroup(g1, normal)：有 cells 时子节点按 resolver 提供的网格重排（守 resolver 输出口径，v5 判别力修正）', () => {
    // v5：img1 放第二槽——idx=0 时 col 恒 0、x 恒 0，原 isFinite(x) 断言恒真零判别力；
    // idx=1 + resolver 默认 gridCols=1 → row=1 → y = 1*(Math.round(320/(16/9)) + CONVERT_GAP) = 1*(180+40) = 220。
    // 两向判别力：gridCols 误算为 2 → row=0 → y=0 红；cfg 未接 resolver（undefined）→ TypeError 红。
    useCanvasStore.setState({ nodes: [cloneGroupNode('g1', [null, 'img1']), { id: 'img1', type: 'imageGen', position: { x: 0, y: 0 }, parentId: 'g1', data: {} }] as any, edges: [] });
    useCanvasStore.getState().convertGroup('g1', 'normal');
    const img = useCanvasStore.getState().nodes.find((n) => n.id === 'img1') as any;
    expect(img).toBeDefined();
    expect(img.position.y).toBe(220);   // 钉住 gridCols/行列计算参与（v5——原 isFinite(x) 恒真）
  });

  it('updateStoryboardConfig：组宽高有限 + 写进 doc 的 aspectRatio ∈ 枚举 + gridRows 整数（NaN 面⑥全维）', () => {
    useCanvasStore.getState().updateStoryboardConfig('g1', { aspectRatio: '9:16' });
    const g = useCanvasStore.getState().nodes.find((n) => n.id === 'g1')!;
    expect(Number.isFinite(g.width)).toBe(true);
    expect(Number.isFinite(g.height)).toBe(true);
    expect((ASPECT_RATIOS as readonly string[])).toContain((g.data as any).storyboard.aspectRatio);
    expect(Number.isInteger((g.data as any).storyboard.gridRows)).toBe(true);
  });

  it('resizeStoryboardGrid：同上全维（NaN 面⑦；v3 简化——rows/cols 为受控数值，单层归一即可）', () => {
    useCanvasStore.getState().resizeStoryboardGrid('g1', 2, 2);
    const g = useCanvasStore.getState().nodes.find((n) => n.id === 'g1')!;
    expect(Number.isFinite(g.width)).toBe(true);
    expect((ASPECT_RATIOS as readonly string[])).toContain((g.data as any).storyboard.aspectRatio);
    expect(Number.isInteger((g.data as any).storyboard.gridCols)).toBe(true);
  });

  it('resizeStoryboardGrid 缩格不变量：真溢出夹具——img2 被移出组（parentId undefined）而非删除（:1330 注释语义的行为面，v4 修正夹具）', () => {
    // v4：cells 两槽均为真实节点（v3 的 [img1, null] 溢出的是 null 槽——img1 本在 keep 内测不到移出）
    // v5：cells 直接进 setState 夹具（不再 mutate store 节点对象——绕过 setState 改状态是坏习惯示范）
    useCanvasStore.setState({ nodes: [
      cloneGroupNode('g1', ['img1', 'img2']),
      { id: 'img1', type: 'imageGen', position: { x: 0, y: 0 }, parentId: 'g1', width: 100, height: 60, data: {} },
      { id: 'img2', type: 'imageGen', position: { x: 0, y: 0 }, parentId: 'g1', width: 100, height: 60, data: {} },
    ] as any, edges: [] });
    useCanvasStore.getState().resizeStoryboardGrid('g1', 1, 1); // 容量 1，img2 溢出
    const g = useCanvasStore.getState().nodes.find((n) => n.id === 'g1')!;
    expect(((g.data as any).cells as unknown[]).length).toBeLessThanOrEqual(1);
    const img2 = useCanvasStore.getState().nodes.find((n) => n.id === 'img2') as any;
    expect(img2).toBeDefined();               // 未被删除
    expect(img2.parentId).toBeUndefined();    // 被移出组（顶层化）
  });

  it('【F38 基线·修复属 R2a】ungroup 覆盖子节点尺寸为 CELL_WIDTH（现状缺陷面钉死——R0 改此分支但勿顺手修，R2a 修复后本断言翻转为保留值）', () => {
    // 夹具：img1 带 width: 500, height: 400（用户手动尺寸）；v5：img1 放第二槽（idx=1 进覆盖分支同款，顺带钉行列计算）
    useCanvasStore.setState({ nodes: [cloneGroupNode('g1', [null, 'img1']), { id: 'img1', type: 'imageGen', position: { x: 0, y: 0 }, parentId: 'g1', width: 500, height: 400, data: {} }] as any, edges: [] });
    useCanvasStore.getState().ungroup('g1');
    const img = useCanvasStore.getState().nodes.find((n) => n.id === 'img1') as any;
    expect(img.width).toBe(320); // = CELL_WIDTH：登记现状覆盖行为
    expect(img.position.y).toBe(220); // v5：idx=1 → row=1（gridCols=1）→ 180+40；ungroup 第二段加 gp={0,0} 不影响
  });

  it('【F38 基线·修复属 R2a】convertGroup→normal 同款覆盖子节点尺寸（spec F38 整类第二处）', () => {
    useCanvasStore.setState({ nodes: [cloneGroupNode('g1', [null, 'img1']), { id: 'img1', type: 'imageGen', position: { x: 0, y: 0 }, parentId: 'g1', width: 500, height: 400, data: {} }] as any, edges: [] });
    useCanvasStore.getState().convertGroup('g1', 'normal');
    const img = useCanvasStore.getState().nodes.find((n) => n.id === 'img1') as any;
    expect(img.width).toBe(320);
    expect(img.position.y).toBe(220); // v5：第二槽行列计算同款（组内相对坐标——convertGroup 后组仍在不加 gp）
  });

  it('dropImageIntoStoryboard：无 storyboard 不抛（消费点④）', () => {
    expect(() => useCanvasStore.getState().dropImageIntoStoryboard('g1', 'img1')).not.toThrow();
  });
});
```

同时**逐条核对** `canvasStore.storyboard.test.ts` 与 `canvasStore.groups.test.ts` 既有用例：`{...storyboard, ...patch}` 改为 `{...resolve(...), ...patch}` 会**补全缺省字段**（合法配置路径下 merge 结果不变——既有断言应维持绿；若某用例断言"data.storyboard 恰 N 键"这类形状，按新行为迁移并在 commit 登记）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @flowweb/web test -- --run src/stores/canvasStore.storyboardConfig.test.ts`
Expected: FAIL（`cfg.aspectRatio` undefined → NaN / 解引用 TypeError）

- [ ] **Step 3: 实现——5 处替换 + 1 处守卫（顶部 import resolver）**

| 行（已验） | 现状 | 改为 |
|---|---|---|
| :855（ungroup） | `const cfg = gd.storyboard;` | `const cfg = resolveStoryboardConfig(gd);` |
| :973（dropImageIntoStoryboard） | `const cfg = gd.storyboard as StoryboardConfig;` | `const cfg = resolveStoryboardConfig(gd);` |
| :1212（convertGroup） | `const cfg = gd.storyboard;` | `const cfg = resolveStoryboardConfig(gd);` |
| **:1219（convertGroup storyboard 分支）** | `const idx = gd.cells.indexOf(n.id);` | `const idx = (gd.cells ?? []).indexOf(n.id);`（评审发现：全仓唯一无守卫的 cells 解引用） |
| :1307（updateStoryboardConfig） | `const cfg = { ...(n.data as any).storyboard, ...patch };` | `const cfg = resolveStoryboardConfig({ storyboard: { ...resolveStoryboardConfig(n.data), ...patch } });`（**双层：patch 来自 UI 未归一化——套外层防 patch 带 NaN/越界透传**） |
| :1332（resizeStoryboardGrid） | `const cfg = { ...gd.storyboard, gridRows: rows, gridCols: cols };` | `const cfg = { ...resolveStoryboardConfig(gd), gridRows: rows, gridCols: cols };`（**单层——rows/cols 由 GridSizeDropdown 保证 1~10（v4 登记此前提）；非受控调用时读侧 resolver clampInt 兜底**） |

`StoryboardConfig` 类型 import 若孤立按规则清理。

- [ ] **Step 4: 跑全量 store 测试防回归**

Run: `pnpm --filter @flowweb/web test -- --run src/stores/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/canvasStore.ts apps/web/src/stores/canvasStore.storyboardConfig.test.ts
git commit -m "fix(web): store 5 处 storyboard 解引用经 resolver+patch 双层归一+:1219 cells 守卫（F2 ③-⑦；NaN 断言含 doc 腐化维度）"
```

## Task 7: StitchButton 守卫型读取对齐（hasStoryboardConfig）

**Files:**
- Modify: `apps/web/src/pages/canvas/components/groups/StitchButton.tsx:86-92`
- Test: `apps/web/src/pages/canvas/components/groups/StitchButton.test.tsx`

- [ ] **Step 1: 锁语义用例（守卫分支等价重述——若已存在则作为防回归锚；v5 夹具/装置对齐现场）**

**v5 三不符修正（评审实锤）**：① StitchButton.tsx 真实顺序是 cells 守卫（:66）→ fileIds 收集（:72-79）→ **fileIds 空 return（:81-84）** → storyboard 守卫（:86-92）——"无 storyboard"夹具必须 cells 槽指向带 fileId 的节点，否则在 :81-84 提前返回"没有可拼接的图片"，断言必红在错误原因；② 本文件装置是 `vi.hoisted` 的 `setMockNodes`（:5-13），**无 `propsWithNoStoryboardData` 助手**；③ 文件无 `vi.mock('antd')`——断言 `message.error` 须先补（jsdom 下真实 antd message 无法断言调用；mock 后既有"首用提示"用例只断言 localStorage 不受影响）。

在 `StitchButton.test.tsx` 追加：

```tsx
// v5：断言 message.error 前置——mock antd（既有用例只断言 localStorage/getMockStart，不受影响）
vi.mock('antd', () => ({ message: { error: vi.fn(), info: vi.fn(), warning: vi.fn(), success: vi.fn() } }));
import { message } from 'antd';

it('无 storyboard 的组：点击拼接提示"分镜配置缺失"不发请求（F2 消费点⑧；v5 夹具对齐守卫顺序）', async () => {
  setMockNodes([
    { id: 'g1', type: 'group', position: { x: 0, y: 0 },
      data: { groupType: 'storyboard', cells: ['c1'] } },              // 无 storyboard
    { id: 'c1', type: 'imageGen', position: { x: 0, y: 0 }, data: { fileId: 'f1' } },  // 过 :81-84 fileIds 空守卫
  ]);
  render(<StitchButton groupId="g1" resolution="2K" onResolutionChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /拼接/ }));
  await vi.waitFor(() => {
    expect(message.error).toHaveBeenCalledWith('分镜配置缺失');
  });
  expect(getMockStart()).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 确认现状此用例 PASS（本 task 是等价重构，跳过红步允许）**

Run: `pnpm --filter @flowweb/web test -- --run src/pages/canvas/components/groups/StitchButton.test.tsx`
Expected: PASS（现状 :89 truthiness 守卫同语义）

- [ ] **Step 3: 实现（v2：不再手工解引用 .storyboard——用模块导出的 hasStoryboardConfig，门禁 allowlist 自洽）**

`StitchButton.tsx:86-92` 改为：

```tsx
if (!hasStoryboardConfig(groupNode.data)) {
  message.error('分镜配置缺失');
  return;
}
const cfg = resolveStoryboardConfig(groupNode.data);
const params = {
  // :94 起既有组装，字段改自 cfg：gridRows→cfg.gridRows、gridCols→cfg.gridCols、
  // aspectRatio→cfg.aspectRatio、showIndex→cfg.showIndex、resolution 维持（外部 prop）
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @flowweb/web test -- --run src/pages/canvas/components/groups/StitchButton.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/components/groups/StitchButton.tsx apps/web/src/pages/canvas/components/groups/StitchButton.test.tsx
git commit -m "refactor(web): StitchButton 守卫改 hasStoryboardConfig——零 .storyboard 裸解引用（F2 消费点⑧，门禁 allowlist 前置对齐）"
```

## Task 8: `.storyboard\b` 裸解引用 allowlist 门禁（spec §5 明列，v2 补；v3 修自扫 bug）

**Files:**
- Create: `apps/web/src/utils/storyboard-dereref-guard.test.ts`（**v3：.test.ts——web 全仓零 .spec.ts 惯例；门禁文件名含 `.storyboard` 正则字面量，排除式必须含 test+spec 双后缀防扫到自己永久红**）

- [ ] **Step 1: 写门禁测试**

```ts
import { readFileSync, readdirSync, statSync } from 'fs';
import * as path from 'path';

const SRC = path.resolve(process.cwd(), 'src');

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) out.push(...listTsFiles(p));
    // v3：排除式含 test+spec 双后缀——门禁自身文件名/正则字面量含 .storyboard，不排除会扫到自己永久红
    else if (/\.(ts|tsx)$/.test(e) && !/\.(test|spec)\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

/** spec §4.6：全仓 \.storyboard\b 裸解引用只允许出现在 storyboardConfig 模块（解析器本体）。
 *  v3：canvasStore.ts 不预授权——Task 6 改完后它本就零命中，预授权=给 R2 开后门（门禁形同虚设）；
 *  R2 新命令真需要豁免时扩本表并同步 spec。 */
const ALLOW_FILES = ['utils/storyboardConfig.ts'];

describe('.storyboard 裸解引用门禁（F2 冻结面——防新消费点绕过 resolver）', () => {
  it('扫描面非空自证（防 cwd 错位→空集→门禁恒绿——spec §5 最贵失误模式）', () => {
    const files = listTsFiles(SRC);
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.includes('canvasStore'))).toBe(true);
  });

  it('allowlist 外零命中', () => {
    const offenders: string[] = [];
    for (const file of listTsFiles(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      if (ALLOW_FILES.includes(rel)) continue;
      const src = readFileSync(file, 'utf8');
      if (/\.storyboard\b/.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
```

（改后 canvasStore 5 处解引用 + CanvasView/StitchButton 均已消除，命中应只剩 storyboardConfig.ts。）

- [ ] **Step 2: 跑测试——若红=存在本 plan 未枚举的消费点，停下把它接入 resolver 再继续（这正是门禁的价值）**

Run: `pnpm --filter @flowweb/web exec vitest run src/utils/storyboard-dereref-guard.test.ts`
Expected: PASS（Task 5-7 完成后应绿；**若 offenders 含门禁自身文件=排除式写错，修排除式而非接 resolver**）

- [ ] **Step 3: 红相实证（记录进 commit message）**

双红相（v4）：① 假代码注入——`apps/web/src/utils/groupLayout.ts` 加 `const x = ({} as any).storyboard;` → FAIL → 删 → PASS；② **真实回归形态**——临时把 `StoryboardGroupRenderer.tsx:12` 改回 `data.storyboard!` → FAIL（review 时被人"顺手"改回的形态）→ 恢复 resolver → PASS。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/utils/storyboard-dereref-guard.test.ts
git commit -m "test(web): .storyboard 裸解引用 allowlist 门禁（F2 冻结面；扫描面自证+红相实证；allowlist 仅 resolver 模块——store 零预授权）"
```

## Task 9: R0a 收尾验证

- [ ] **Step 1: 类型检查三端**

Run: `pnpm --filter @flowweb/web exec tsc --noEmit && pnpm --filter @flowweb/api exec tsc --noEmit && pnpm --filter @flowweb/shared exec tsc --noEmit`
Expected: 零错误

- [ ] **Step 2: 全量测试**

Run: `pnpm --filter @flowweb/shared test -- --run && pnpm --filter @flowweb/api test -- --run && pnpm --filter @flowweb/web test -- --run && pnpm --filter @flowweb/web lint`
Expected: 全绿+lint 零错（v4 补 lint——web 的 test 只跑 vitest，新文件的 theme lint 规则零容忍只有 lint 才查）

- [ ] **Step 3: F35 现场 TODO 登记（v5——plan 会归档，R1b 实施者只看代码；两处行号已实测）**

`apps/web/src/collab/ydocBuilder.ts:33`（`if (n.parentId != null) m.set('parentId', n.parentId);` 上方）与 `apps/web/src/stores/canvasCollabRuntime.ts:242`（`fillDoc(doc, ...)` 上方）各加一行：

```ts
// TODO(R1b/F35): 崩溃恢复快照的 AppNode 无 parentId——此路径恒不写组结构（组拍平），见 spec F35/R1b 契约 5
```

```bash
git add apps/web/src/collab/ydocBuilder.ts apps/web/src/stores/canvasCollabRuntime.ts
git commit -m "docs(web): F35 崩溃恢复组拍平——代码现场 TODO 登记（R1b 契约 5 归属；plan 归档后注释仍在）"
```

---

# R0b 模板三站点 + schemaVersion + 媒体政策 + 读侧收敛

**分片原子性纪律（v2 收紧）：** Task 11（必红用例全集）一个 task 内写完并**当场跑红记录**，紧接 Task 12 统一实现——**绝不允许"导出已展开、schema 未加 optional"的中间态单独落库**（`width: null` 被 `.optional()` 拒收 → save 当场 400），也不留跨 task 的长期红工作区（防"改测试而非改实现"诱导）。归一化函数已并入 snapshot-filter.util.ts（Task 2 normalizeNodeRecord——**不再有独立 Task 9 死代码 commit**）。

**登记（spec 分片归属，本分片不做）：** 导入侧 parentId fail-closed 校验（环/嵌套/悬空 400）属 R1（spec F39/§4.7）；崩溃恢复组拍平（F35）属 R1b 契约 5；batch 响应无 ttlSec 属 R2d 已知缺口（spec §4.5）。

## Task 10: Prisma Json 往返地基实证（R0b 全部设计的地基）

**Files:**
- 无生产文件——一次性验证脚本，结果记入 Task 12 的 commit message

- [ ] **Step 1: 用 dev DB 最小实证（本地 postgres 可用——见项目启动记忆）**

写临时脚本 `apps/api/scripts/verify-json-roundtrip.ts`（跑完即删，不入 commit）：

```ts
// 验证目标：normalizeNodeRecord 的 null→undefined 在 Prisma Json 列的完整往返后键确实消失
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  // v3：Template.userId 是 User 外键——虚构 id 会 P2003，先取真实 user（dev 库按启动流程已有）
  const user = await prisma.user.findFirst({ select: { id: true } });
  if (!user) throw new Error('dev DB 无用户——先按 dev 登录流程造一个再跑');
  const marker = `verify-${Date.now()}`;
  const node = { id: 'n1', type: 'group', parentId: undefined, width: undefined, height: undefined, position: { x: 0, y: 0 }, data: {} };
  const created = await prisma.template.create({
    data: { name: marker, userId: user.id, status: 'DRAFT',
      templateData: { version: 1, nodes: [node], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } } as any,
  });
  const read = await prisma.template.findUnique({ where: { id: created.id } });
  const round = JSON.parse(JSON.stringify(read!.templateData));
  console.log('parentId in round:', 'parentId' in round.nodes[0]);   // 期望 false
  console.log('width in round:', 'width' in round.nodes[0]);         // 期望 false
  await prisma.template.delete({ where: { id: created.id } });
}
main().finally(() => prisma.$disconnect());
```

Run: `cd apps/api && npx tsx scripts/verify-json-roundtrip.ts`（或按仓内脚本运行惯例）
Expected: 两行均 `false`。**若任一 true——Prisma Json 列保留了 undefined 键（序列化差异），Task 12 的 NodeSchema 必须改 `.nullish()` 而非 `.optional()`，停下改设计再继续。**

- [ ] **Step 2: 清理脚本**

```bash
rm apps/api/scripts/verify-json-roundtrip.ts
```

## Task 11: R0b 必红用例全集（四组一次写完当场跑红）

**Files:**
- Test: `apps/api/src/modules/canvas/canvas.service.spec.ts`
- Test: `apps/api/src/modules/template/template.service.spec.ts`
- Test: `apps/api/src/modules/template/template.validation.spec.ts`

- [ ] **Step 1: 导出侧三组（判别力修正版——有值节点锁"保留"而非 null 锁"消失"）

**v5 落点与标识符（v4 声称修正但只改了落点注释没改代码——代码块 5 处 readCanvasMock 字面量残留；validTemplate 跨 describe 引用 TS2304）**：canvas.service.spec.ts 的新用例**必须置于既有 `describe('save')`（:168）内部末尾**（嵌套子 describe 继承其 beforeEach :176-183 的 readCanvas/findUnique 接线）。**嵌套 describe 顶部收口双助手**（既有 beforeEach :182 恒 `findUnique→null` ⇒ 非粘性用例全走 create 分支——v4 断言盯 `update.mock.calls[0][0]` 会红在 TypeError 取参，掩盖真红相；助手兼容两分支+防悬空假绿）。template.service.spec.ts 侧取参 = `projectService.create.mock.calls[0][2]`（:81 的 useValue 对象）；夹具 = 文件级 `templateFixture`（v5 hoist，见 Step 2——validTemplate 是 describe('import') :305 局部常量，跨 describe 引用 TS2304+ReferenceError）：

```ts
describe('save 导出展开式+归一+公开过滤（R0b/F29/F32，实现前必红）', () => {
  // v5 收口双助手：readCanvas 取既有接线 mock；savedTemplateData 兼容 create/update 两分支（calls 按序拼接）
  const readCanvas = () => (service as any).collabDoc.readCanvas;
  const savedTemplateData = (callIdx = 0) => {
    const calls = [...prisma.template.create.mock.calls, ...prisma.template.update.mock.calls];
    expect(calls.length).toBeGreaterThan(callIdx);   // 防悬空假绿（save 未触达写库时此断言先红）
    return (calls[callIdx] as any)[0].data.templateData;   // v5.1 errata：mock.calls 元素是参数数组，须 [0] 再取 .data（照抄原文会红在助手 TypeError）
  };
  beforeEach(() => vi.clearAllMocks());   // 清调用记录防跨用例 calls 污染（mockClear 语义不动外层已设实现）

  it('有值三键存续：含 parentId/width/height 的节点 save 后落库保留（现状剥键——必红主用例）', async () => {
    readCanvas().mockResolvedValue({
      nodes: [
        { id: 'g1', type: 'group', position: { x: 10, y: 10 }, data: { groupType: 'normal' }, parentId: null, width: 300, height: 200 },
        { id: 'c1', type: 'imageGen', position: { x: 15, y: 15 }, data: { prompt: 'cat' }, parentId: 'g1', width: 140, height: 90 },
      ],
      edges: [],
    });
    await service.save('p1', { name: 'T' }, 'u1');
    const saved = savedTemplateData();   // beforeEach 恒 findUnique→null → 走 create 分支（v5：原断言盯 update 必红在取参）
    const c1 = saved.nodes.find((n: any) => n.id === 'c1');
    expect(c1.parentId).toBe('g1');       // 现状 undefined——必红
    expect(c1.width).toBe(140);           // 现状 undefined——必红
    const g1 = saved.nodes.find((n: any) => n.id === 'g1');
    expect(saved.nodes.indexOf(g1)).toBeLessThan(saved.nodes.indexOf(c1)); // 父先子后（ensureParentFirst）
  });

  it('null/undefined 边界节点不抛错：width/height=null 键消失、data=undefined 落 {}（各一条）', async () => {
    readCanvas().mockResolvedValue({
      nodes: [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { content: 'a' }, parentId: null, width: null, height: null }],
      edges: [],
    });
    await expect(service.save('p1', { name: 'T' }, 'u1')).resolves.toBeDefined();
    readCanvas().mockResolvedValue({
      nodes: [{ id: 'n2', type: 'textInput', position: { x: 0, y: 0 }, data: undefined }],
      edges: [],
    });
    await expect(service.save('p1', { name: 'T' }, 'u1')).resolves.toBeDefined();
  });

  it('isPublic=true 保存=媒体内容变换（产品语义，非纯 id 剔除）：fileId 剥、status 归一 idle、组 9 键保留；缺省/私有全量', async () => {
    readCanvas().mockResolvedValue({
      nodes: [
        { id: 'g1', type: 'group', position: { x: 0, y: 0 }, parentId: null, width: null, height: null,
          data: { groupType: 'storyboard', cells: ['n1'], storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 1, showIndex: false, stitchResolution: '2K' }, nameCustom: true } },
        { id: 'n1', type: 'imageGen', position: { x: 5, y: 5 }, parentId: null, width: null, height: null,
          data: { prompt: 'a cat', fileId: 'f1', status: 'done' } },
      ],
      edges: [],
    });
    await service.save('p1', { name: 'T', isPublic: true }, 'u1');
    const saved = savedTemplateData();
    expect(saved.nodes.find((n: any) => n.id === 'g1').data.storyboard).toBeDefined();
    const img = saved.nodes.find((n: any) => n.id === 'n1').data;
    expect(img.fileId).toBeUndefined();
    expect(img.status).toBe('idle'); // resetStatusIdle 写入语义（v2 修正）
    // 私有对照：fileId 保留（本用例内第二次 save——savedTemplateData(1) 取 calls[1]）
    await service.save('p1', { name: 'T' }, 'u1');
    const savedPrivate = savedTemplateData(1);
    expect(savedPrivate.nodes.find((n: any) => n.id === 'n1').data.fileId).toBe('f1');
  });

  it('isPublic 粘性（产品语义登记）：existing.isPublic=true 时后续无 isPublic 入参的 save 仍走投影', async () => {
    // v3 夹具要求：existing.templateData 必须带 version:1（否则 validate 先 400，红相归因会被误导）
    prisma.template.findUnique.mockResolvedValue({
      id: 'tpl1', projectId: 'p1', isPublic: true, userId: 'u1',
      templateData: { version: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    });
    readCanvas().mockResolvedValue({
      nodes: [{ id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, parentId: null, width: null, height: null, data: { prompt: 'x', fileId: 'f1' } }],
      edges: [],
    });
    await service.save('p1', { name: 'T2' }, 'u1');   // 无 isPublic 入参
    const saved = savedTemplateData();                // findUnique 已 mock 既有行 → update 分支（助手兼容）
    expect(saved.nodes[0].data.fileId).toBeUndefined(); // 仍走投影（willBePublic 粘性——Task 12 Step 1 实现）
  });
});
```

（**v5：第 5 条"残缺行"用例已删**——v4 声称移入导入侧（Step 4 第 2 条）但此处残留原文，且 canvas spec 无 validTemplate 标识符、import 不在 canvas.service。**产品文案登记：isPublic 公开是单向有损开关——公开分支会把 textInput.content 的 HTML 永久转纯文本写库，改回私有不恢复（spec v10 裁决 2 已登记）。**）

- [ ] **Step 2: 读侧收敛两组（v2：解构剥键方案——断言"剥且仅剥 templateData"；v5 夹具先 hoist）**

`template.service.spec.ts` **先做夹具 hoist**（v5：validTemplate 是 describe('import') :305 局部常量，本 Step/Step 4/Task 13 的新 describe 均在其外——跨作用域引用 TS2304+ReferenceError）：

```ts
// 文件级（import 区之后、首个 describe 之前）
// v5 字段口径：teamId/projectId/folderId 显式 null——falsy 使 getTemplate/update 的 OR 鉴权链行为
// 与现状 spread 完全一致（勿填 'team1' 等真值，会改变 :326 既有 Forbidden 用例的 mock 调用链）；
// templateData 补 version:1（骨架用例照抄 :314 模式时不再踩 Zod 红相归因）。
const templateFixture = {
  id: 't1', name: 'Test Template', isPublic: true, userId: 'creator',
  teamId: null, projectId: null, folderId: null,
  description: null, coverUrl: null, dataUrl: null,
  status: 'SAVED', category: null, importCount: 0,
  createdAt: new Date(), updatedAt: new Date(),
  templateData: {
    version: 1,
    nodes: [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { text: 'hi' } }],
    edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
};
// 既有 describe('import') 内部改为：const validTemplate = templateFixture;（既有 5 用例零改动）
```

再追加读侧收敛用例：

```ts
describe('读侧收敛（v10 裁决 2 第 ⑤ 点——公开行 templateData 等同公开载荷）', () => {
  it('findMany（community）响应剥 templateData 且其余模型字段全在（Prisma 类型夹具——编译期强制零手抄）', async () => {
    // v4：const fullRow: Template 类型标注——漏字段/多字段 tsc 红（Prisma 生成类型精确非 Partial），
    // "夹具反推"从手抄的偶然正确升级为编译期强制；防剥多了也防将来改回 select 漏给
    const fullRow: Template = { id: 't1', name: 'T', description: null, coverUrl: null, dataUrl: null, templateData: { version: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }, folderId: null, projectId: null, status: 'SAVED', userId: 'other', teamId: null, isPublic: true, importCount: 0, category: 'COMMUNITY', createdAt: new Date(), updatedAt: new Date() };
    // v5：原 'PUBLISHED' 不在枚举（schema.prisma:187-190 实测仅 DRAFT/SAVED；category 'COMMUNITY' 合法 :131-134）
    // ——const fullRow: Template 类型标注当场抓住手抄漂移（TS2322 挂整包 tsc），标注有效性的实证，勿撤标注只改值
    prisma.template.findMany.mockResolvedValue([fullRow]);
    const out = await service.findMany({ type: 'community', page: 1, limit: 10 } as any, 'other-user');
    expect('templateData' in out.templates[0]).toBe(false);
    for (const k of Object.keys(fullRow).filter((x) => x !== 'templateData')) {
      expect(k in out.templates[0]).toBe(true);
    }
    // v4：防将来改回 select 漏字段（select 是上轮真实事故形态；mock 无视 select 实参，需显式锁）
    expect(prisma.template.findMany).toHaveBeenCalledWith(
      expect.not.objectContaining({ select: expect.anything() }),
    );
  });

  it('getTemplate 非 owner 剥 templateData；owner 仍含', async () => {
    prisma.template.findUnique.mockResolvedValue({ ...templateFixture, isPublic: true, userId: 'owner-1', templateData: { version: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } });
    const other = await service.getTemplate('t1', 'other-user');
    expect('templateData' in other).toBe(false);
    const owner = await service.getTemplate('t1', 'owner-1');
    expect(owner.templateData).toBeDefined();
  });
});
```

（注：service 层返回值进 controller 的 `{ success: true, data: template }` 包装与 interceptor 二层包装**均不受影响**——本改动只在 data 内摘键，双层封装契约原样。）

- [ ] **Step 3: 校验器两组（三态一次写全）**

`template.validation.spec.ts` 追加：

```ts
it('可选三键三态：缺失过 / 有值过 / 显式 null 拒（归一保证模板 JSON 无 null）', () => {
  const base = { version: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
  expect(() => validateTemplateData(base)).not.toThrow(); // 缺失过
  expect(() => validateTemplateData({ ...base, nodes: [{ id: 'n', type: 't', position: { x: 0, y: 0 }, data: {}, parentId: 'p', width: 1, height: 1 }] })).not.toThrow(); // 有值过
  expect(() => validateTemplateData({ ...base, nodes: [{ id: 'n', type: 't', position: { x: 0, y: 0 }, data: {}, width: null }] })).toThrow(); // null 拒
});

it('version 缺失或非 1 → fail-closed 拒收（schemaVersion）', () => {
  const base = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
  expect(() => validateTemplateData(base)).toThrow();
  expect(() => validateTemplateData({ ...base, version: 2 })).toThrow();
});
```

（现状预期：三态第一条的"缺失过"现状也过（NodeSchema 无这些键）、"有值过"现状被 strip 后也过——但"null 拒"与 version 两法**现状必红**；version 是迁移信号主锚。）

- [ ] **Step 4: 导入侧四组**

`template.service.spec.ts` 追加：

```ts
describe('导入侧展开式+cells 两遍重映射+跨用户过滤（R0b）', () => {
  it('三键存续且 parentId/cells 重映射到新 id（第三站点 F29）', async () => {
    prisma.template.findUnique.mockResolvedValue({
      ...templateFixture, isPublic: true, userId: 'other',  // v5：文件级 hoist 夹具（原 :305 局部 validTemplate 跨 describe 引用 TS2304）
      templateData: {
        version: 1,
        nodes: [
          { id: 'g1', type: 'group', position: { x: 10, y: 10 }, width: 300, height: 200, data: { groupType: 'normal', cells: ['c1'] } },
          { id: 'c1', type: 'imageGen', position: { x: 20, y: 20 }, parentId: 'g1', width: 100, height: 60, data: { prompt: 'x' } },
        ],
        edges: [], viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
    await service.import('t1', 'user-2');
    expect(projectService.create).toHaveBeenCalled();
    const nodes = projectService.create.mock.calls[0][2] as any[];
    const group = nodes.find((n: any) => n.type === 'group');
    const child = nodes.find((n: any) => n.type === 'imageGen');
    expect(group.width).toBe(300);                      // 现状 undefined——必红
    expect(child.parentId).toBe(group.id);              // 重映射到新组 id——现状丢 parentId 必红
    expect(group.data.cells[0]).toBe(child.id);         // cells 两遍重映射——现状悬空旧 id 必红
  });

  it('残缺模板行（缺 nodes/edges）导入 → 400 业务文案而非 TypeError 冒泡（v4：从 canvas spec 移入——import 在此文件）', async () => {
    prisma.template.findUnique.mockResolvedValue({ ...templateFixture, isPublic: true, userId: 'other', templateData: { version: 1 } });
    await expect(service.import('t1', 'user-2')).rejects.toThrow('模板数据为空');
  });

  it('cells 引用靠后节点不被误判悬空（两遍——边建边用会 null）', async () => {
    // 夹具：group 在 nodes[0]，cells: ['c1','c2']，c1/c2 在其后
    // 断言：导入后 cells 两槽均为新 id、无 null（现状：c2 悬空→null 必红）
  });

  it('跨用户导入公开模板：媒体引用剥+status 归一 idle+结构保留（v9 裁决③）', async () => {
    // 夹具 imageGen.data={prompt:'x',fileId:'f1',status:'done'}；isPublic=true、userId='other'
    // 断言：img.data.fileId undefined、img.data.status==='idle'、img.data.prompt==='x'
  });

  it('作者导入自己的公开模板：全量不过滤（isPublic && userId!==owner 才滤）', async () => {
    // 夹具 userId='user-2'（=导入者）→ fileId 保留
  });
});
```

（第 2/3/4 条断言体按第一条模式补全——字段与期望值已写死；夹具统一 `{ ...templateFixture, ... }` 起手（templateData 显式覆盖时带 version:1）。）

- [ ] **Step 5: 全部跑红并记录**

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/canvas/canvas.service.spec.ts src/modules/template/`
Expected: 新增用例大部分 FAIL（导出剥键/无过滤/无 version 拒收/导入剥键）——**把红相输出贴进 Task 12 的 commit message**。个别"缺失过"类三态用例现状绿属预期（见各条注），如全部绿则停下检查用例。

## Task 12: R0b 统一实现（导出/校验器/导入/seed/读侧一次落）

**Files:**
- Modify: `apps/api/src/modules/canvas/canvas.service.ts:72-108`
- Modify: `apps/api/src/modules/template/template.validation.ts`
- Modify: `apps/api/src/modules/template/template.service.ts`（import :209-260 / seed :278-317 / list :93-99 / getTemplate :136）
- Modify: `apps/api/src/modules/project/project.service.ts`（预期零代码改动，行为由用例锁）
- Test: Task 11 全部 spec + 红面迁移

- [ ] **Step 1: 导出侧（canvas.service.ts save :76-85）**

import 区补 `normalizeNodeRecord, buildFilteredSnapshot, CLONE_WHITELIST, ensureParentFirst`（from `'../video-work/snapshot-filter.util'`——跨模块 import 是 R0 暂态，R1a 收编 shared nodeEnvelope 时统一消解）：

```ts
// v3：existing 查询前移到 readCanvas 之前（粘性语义需要——现状 :94 在 templateData 定稿之后，够不着过滤分支）
const existing = await this.prisma.template.findUnique({ where: { projectId } });
const willBePublic = input.isPublic ?? existing?.isPublic ?? false;   // 单一裁决变量：入参 > 既有行 > false
const canvas = await this.collabDoc.readCanvas(projectId, sv);
// isPublic 保存=媒体内容变换（产品语义：fileId 剥/status 归一 idle/HTML→纯文本——有损且公开后不可逆，v10 裁决 2）
const filtered = willBePublic
  ? buildFilteredSnapshot(canvas, {
      dropTypes: [], dropIdPrefixes: [], resetStatusIdle: true, injectThumbnails: false,
      whitelist: CLONE_WHITELIST,
    })
  : null;
const nodes = ensureParentFirst(
  (filtered ? filtered.nodes : (canvas.nodes as any[])).map((n: any) => normalizeNodeRecord(n)),
);
const edges = (filtered ? filtered.edges : canvas.edges).map((e: any) => ({
  id: e.id,
  source: e.sourceId || e.source || '',
  target: e.targetId || e.target || '',
}));
const templateData = { version: 1, nodes, edges, viewport: input.viewport || { x: 0, y: 0, zoom: 1 } };
```

（后续 `:94-108` 的 existing 复用上方查询结果（删重复 findUnique）；update 分支 `isPublic: willBePublic` 替代 `input.isPublic ?? existing.isPublic`、create 分支 `isPublic: willBePublic`——两处口径统一。**v4 登记（P2002 并发首存窗口）**：:125-143 回退分支是 templateData 的第三写者——并发首存撞 P2002 时回退 update 的 `isPublic: input.isPublic ?? raced.isPublic` 以入参为口径，粘性可能被并发绕过（dev 无并发不可达）——与 PATCH 同列已知例外，不修只登记，防线仍=导入期过滤+读侧剥键。**PATCH 路径显式登记（v3）：template.service.update 翻 isPublic 仍不净化——"isPublic ⇒ 存储已净化"不变式未做，防线=导入期过滤+读侧剥键（spec v10 拍板），勿对外宣称存储层干净。**）

（ensureParentFirst 说明：spec §4.6 明令导入侧必须过；导出侧同过是幂等纯函数顺手对齐 clone 先例——前端 hydrate 与 Y.Map 本无序依赖，此处保证的是**模板 JSON 自身**的父先子后可读性。）

- [ ] **Step 2: 校验器（template.validation.ts）**

```ts
import { z } from 'zod';

const NodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  parentId: z.string().optional(),   // null 由导出归一消除；显式 null 拒（fail-closed）
  width: z.number().optional(),
  height: z.number().optional(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.any()),
});

const EdgeSchema = z.object({ id: z.string(), source: z.string(), target: z.string() });

export const TemplateDataSchema = z.object({
  version: z.literal(1),   // schemaVersion fail-closed（dev 无存量不迁移；seed upsert 自愈官方行）
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }),
});

/** 返回 void（门禁封死）：调用方不得消费返回值——归一化后的数据才是落库数据。 */
export function validateTemplateData(data: unknown): void {
  TemplateDataSchema.parse(data);
}
```

（唯一调用点 canvas.service.ts:88 本就忽略返回值——零风险封死。）

- [ ] **Step 3: 导入侧（template.service.ts import :224-256）**

```ts
let projectData = JSON.parse(JSON.stringify(template.templateData));
// v3：守卫前置——残缺行（缺 nodes/edges）在过滤前 fail-closed 成 400 业务文案
//（buildFilteredSnapshot 内部对 raw.nodes/raw.edges 直接 .filter，缺键会 TypeError 冒泡成噪音 400）
if (!Array.isArray(projectData?.nodes) || !Array.isArray(projectData?.edges)) {
  throw new BadRequestException('模板数据为空，无法导入');
}
// 跨用户导入过滤（v9 裁决③：覆盖"私有→后公开"旧行）
if (template.isPublic && template.userId !== userId) {
  const filtered = buildFilteredSnapshot(
    {
      nodes: projectData.nodes,
      edges: projectData.edges.map((e: any) => ({ id: e.id, sourceId: e.source, target: e.target })),
    },
    { dropTypes: [], dropIdPrefixes: [], resetStatusIdle: true, injectThumbnails: false, whitelist: CLONE_WHITELIST },
  );
  projectData = { ...projectData, nodes: filtered.nodes, edges: filtered.edges };
}
validateTemplateData(projectData);
```

cleanNodes/cleanEdges 段改两遍重映射（**`?? undefined` 非 null——v2 修正，与导出同口径**；cells 的 null 是空宫格占位**必须保留**，仅信封三键的 null 是缺失要抹掉）：

```ts
const ts = Date.now().toString(36);
const idMap = new Map<string, string>();
const rawNodes = ensureParentFirst(projectData.nodes || []);
for (const n of rawNodes) idMap.set(n.id, `n${ts}_${idMap.size}`);
// 第一遍建全 idMap（边建边用会误判靠后节点为悬空）
const cleanNodes = rawNodes.map((n: any) => ({
  id: idMap.get(n.id)!,
  type: n.type,
  parentId: n.parentId ? (idMap.get(n.parentId) ?? undefined) : undefined,  // 悬空→undefined（非 null——NodeSchema optional）
  width: n.width ?? undefined,
  height: n.height ?? undefined,
  position: n.position ?? { x: 0, y: 0 },
  data: n.data ?? {},
}));
// 第二遍组 cells 单独重映射（悬空→null 长度不变；null=空宫格占位保留）
for (const n of cleanNodes) {
  if (n.type !== 'group') continue;
  if (n.data.cells == null) continue;                       // 缺失=合法（无宫格配置的组）
  if (!Array.isArray(n.data.cells)) {                       // v3：非数组的"宫格结构损坏"fail-closed，不静默跳过
    throw new BadRequestException('分镜组宫格结构损坏（cells 非数组），无法导入');
  }
  n.data.cells = (n.data.cells as (string | null)[]).map(c =>
    c === null || c === undefined ? null : (idMap.get(c) ?? null),
  );
}
const cleanEdges = (projectData.edges || []).map((e: any, i: number) => ({
  id: `e${ts}_${i}`,
  source: idMap.get(e.source || e.sourceId || '') || (e.source || e.sourceId || ''),
  target: idMap.get(e.target || e.targetId || '') || (e.target || e.targetId || ''),
}));
```

第三站点（project.service.ts）：fillDoc 的 `:65-67` 守卫（`if (n.parentId != null)` 等）本就认三键，入参补全后天然生效——**预期零代码改动**，由 Task 11 导入用例锁定行为；若 grep 发现剥字段映射则按守卫现状保留。

- [ ] **Step 4: seed findFirst+update/create（v2：无 name_userId 唯一键）+ version**

templateData 补 `version: 1`；:309-316 改**幂等覆盖式**：

```ts
for (const tpl of officialTemplates) {
  const existing = await this.prisma.template.findFirst({
    where: { name: tpl.name, userId: OFFICIAL_USER_ID },
  });
  if (existing) {
    await this.prisma.template.update({
      where: { id: existing.id },
      data: { templateData: tpl.templateData, description: tpl.description }, // 幂等覆盖：dev 旧行自愈补 version
    });
  } else {
    await this.prisma.template.create({ data: tpl });
  }
}
```

- [ ] **Step 5: 读侧收敛（解构剥键——v2 方案，select 反推有漏字段风险）**

list（:93-99）：

```ts
const [templates, total] = await Promise.all([
  this.prisma.template.findMany({ where, orderBy, skip, take: limit }),
  this.prisma.template.count({ where }),
]);
// 读侧收敛（v10 裁决 2 第 ⑤ 点）：剥 templateData 单键、其余模型字段全量下发（解构剥键——
// 模型将来加字段自动跟随，杜绝 select 反推漏字段类回归）；公开行的 templateData 等同公开载荷
const result = {
  templates: templates.map(({ templateData, ...t }) => ({ ...t, isOwner: t.userId === userId })),
  total, page, limit, totalPages: Math.ceil(total / limit),
};
```

getTemplate（:136）：

```ts
// 读侧收敛：非 owner 不下发 templateData（owner 编辑/预览需要；导入走服务端内部 findById 不受影响）。
// service 返回值进 controller { success, data } 包装——双层封装契约不动，仅 data 内摘键。
const { templateData, ...rest } = template;
return template.userId === userId
  ? { ...template, isOwner: true }
  : { ...rest, isOwner: false };
```

update :162-164 不加过滤（**读侧是唯一裁决点**——spec v10 明写，防双重裁决含糊）。

- [ ] **Step 6: 红面迁移**

- `template.service.spec.ts` import 用例（:314/:330/:339/:346 四条）夹具补 `version: 1`（:325 私有先抛仍绿）
- `template.validation.spec.ts` :4-13 夹具补 `version: 1`
- `canvas.service.spec.ts` :187-197 按新形状迁移（templateData.version + 节点可选键）

- [ ] **Step 7: 跑全量 R0b 测试**

Run: `pnpm --filter @flowweb/api test -- --run`
Expected: PASS（Task 11 新用例全绿 + 迁移后既有用例绿）

- [ ] **Step 8: Commit（原子——含 Task 10 地基实证结论）**

```bash
git add apps/api/src/modules/canvas/canvas.service.ts apps/api/src/modules/template/template.validation.ts apps/api/src/modules/template/template.service.ts apps/api/src/modules/canvas/canvas.service.spec.ts apps/api/src/modules/template/template.validation.spec.ts apps/api/src/modules/template/template.service.spec.ts
git commit -m "fix(api): 模板三站点信封统一+schemaVersion+媒体条件化+读侧剥键收敛（R0b 集成；F29/F32/v10 裁决 2；必红证据与 Prisma Json 往返实证结论见 task 记录）"
```

## Task 13: 往返等价验收（全量基准——两段拼接式）

**Files:**
- Test: `apps/api/src/modules/template/template.service.spec.ts`

**v3 降级说明：** 原设计的"save→import 同 spec 串联"需要为 template.service.spec 额外搭建 CanvasService 的 7 依赖 TestBed（仓内单测不跨 service 编排）——降级为**两段拼接**：save 输出形状已由 Task 11 在 canvas.service.spec 锁定；本 task 把该形状**硬编码为 import 输入**完成等价断言（两段各自可跑、组合语义等价）。

- [ ] **Step 1: 写往返等价用例（v3：import 侧断言——输入为 Task 11 已验证的 save 输出形状）**

```ts
it('往返等价（全量基准，两段拼接的 import 段）：save 输出形状（Task 11 已在 canvas.service.spec 锁定）→ 导入逐字段归一等值', async () => {
  // 输入=save 的落库形状（version:1 + 归一化信封——由 Task 11 的 save 断言保证，此处硬编码同构夹具）
  const savedShape = {
    version: 1,
    nodes: [
      { id: 'g1', type: 'group', position: { x: 10, y: 10 }, width: 300, height: 200,
        data: { groupType: 'storyboard', cells: ['c1', null], storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: false, stitchResolution: '2K' } } },
      { id: 'c1', type: 'imageGen', position: { x: 15, y: 15 }, parentId: 'g1', width: 140, height: 90, data: { prompt: 'cat', fileId: 'f1' } },
    ],
    edges: [{ id: 'e1', source: 'c1', target: 'c1' }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  prisma.template.findUnique.mockResolvedValue({ ...templateFixture, isPublic: false, userId: 'u1', templateData: savedShape });   // v5：templateFixture（文件级 hoist）
  await service.import('t1', 'u1');
  expect(projectService.create).toHaveBeenCalled();
  const nodes = projectService.create.mock.calls[0][2] as any[];
  const g = nodes.find((n: any) => n.type === 'group');
  const c = nodes.find((n: any) => n.type === 'imageGen');
  // 信封逐字段：type/position 深等、三键等值、parentId 经映射后指向新组
  expect(g.type).toBe('group'); expect(g.position).toEqual({ x: 10, y: 10 });
  expect(g.width).toBe(300); expect(g.height).toBe(200); expect(g.parentId).toBeUndefined();
  expect(c.position).toEqual({ x: 15, y: 15 }); expect(c.width).toBe(140); expect(c.height).toBe(90);
  expect(c.parentId).toBe(g.id);
  // data：除 cells 外深等（私有全量——fileId 保留）；cells 槽位映射后可解析
  expect(c.data).toEqual(savedShape.nodes[1].data);
  const { cells, ...gDataRest } = g.data; const { cells: _oc, ...origGDataRest } = savedShape.nodes[0].data;
  expect(gDataRest).toEqual(origGDataRest);
  expect(cells).toHaveLength(2);
  expect(cells[0]).toBe(c.id);          // 可解析
  expect(cells[1]).toBeNull();          // 空宫格占位保留
  // edges 端点经映射后等值
  const edges = projectService.create.mock.calls[0][3] as any[];
  expect(edges).toHaveLength(1);
  expect(edges[0].source).toBe(c.id); expect(edges[0].target).toBe(c.id);
});
```

- [ ] **Step 2: 跑测试（Task 12 实现后应绿；红=实现有缺口回 Task 12 修）**

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/template/template.service.spec.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/template/template.service.spec.ts
git commit -m "test(api): 模板往返全量基准验收（R0b——逐字段归一等值+cells 可解析+占位保留）"
```

---

# R0c presign 形状根修 + 客户端完整缓存（用户拍板边界）

**范围（v2，用户拍板）：** 服务端 `{url, expiresAt}` JSON 缓存 + remaining + 响应 `{url, ttlSec}` + controller 透传；**客户端完整缓存一次做齐**——模块级 currentUserId（AuthProvider 写入+登出清空）+ 键 `${userId}:${fileId}` + LRU 64 上限 + in-flight 去重 + cancelled 竞态保护 + isFinite 兜底（spec v10 裁决 6 实现路径，原 R2b 客户端部分提前——R2b 只剩 node data.mediaUrl 读写收敛与标识符门禁）。**已知缺口登记：batch 端点无 ttlSec 属 R2d（spec §4.5 归属）。**

## Task 14: media.service getMediaUrl 形状化（服务端）

**Files:**
- Modify: `apps/api/src/modules/media/media.service.ts:15-32`
- Test: `apps/api/src/modules/media/media.service.spec.ts`（**断言+夹具一起迁移**——:52/:61/:77 的 redis.get mock 返回裸 string，新实现按坏值处理会 fallthrough 重签，既有 `not.toHaveBeenCalled` 断言必红，夹具必须 JSON 化）

- [ ] **Step 1: 迁移既有断言/夹具 + 新增用例（一次写完跑红）**

既有 getMediaUrl 块改造模式（:63/:72/:79/:85 返回值四条 + :73/:86-91 redis.set 值两条；**:113 属 by-key 块不动**）：

```ts
// 夹具：redis.get mock 从裸 string 改 JSON
redisGetMock.mockResolvedValue(JSON.stringify({ url: 'http://cached', expiresAt: Date.now() + 60_000 }));

// 返回值断言：
const out = await service.getMediaUrl('f1', 'u1');
expect(out.url).toBe(/* presigned 原值 */);
expect(out.ttlSec).toBe(900);

// redis.set 断言：
expect(redis.set).toHaveBeenCalledWith(
  'media:url:v2:team-1:f1',
  JSON.stringify({ url: expect.any(String), expiresAt: expect.any(Number) }),
  'EX', 840,
);
```

新增用例：

```ts
it('命中且未过期：返回剩余寿命（expiresAt − now，恒 ≥1），不重签', async () => {
  redisGetMock.mockResolvedValue(JSON.stringify({ url: 'http://cached', expiresAt: Date.now() + 60_000 }));
  const out = await service.getMediaUrl('f1', 'u1');
  expect(out.url).toBe('http://cached');
  expect(out.ttlSec).toBeGreaterThanOrEqual(1);
  expect(out.ttlSec).toBeLessThanOrEqual(60);
  expect(minio.generatePresignedGetUrl).not.toHaveBeenCalled();
});

it('命中但已过期（remaining ≤ 0）：重签覆写', async () => {
  redisGetMock.mockResolvedValue(JSON.stringify({ url: 'http://stale', expiresAt: Date.now() - 1_000 }));
  const out = await service.getMediaUrl('f1', 'u1');
  expect(out.url).not.toBe('http://stale');
  expect(redis.set).toHaveBeenCalled();
});

it('坏值（非 JSON/缺 expiresAt/NaN）：重签覆写自愈不抛', async () => {
  redisGetMock.mockResolvedValueOnce('not-json');
  await expect(service.getMediaUrl('f1', 'u1')).resolves.toMatchObject({ ttlSec: 900 });
  redisGetMock.mockResolvedValueOnce(JSON.stringify({ url: 'http://x' }));
  await expect(service.getMediaUrl('f1', 'u1')).resolves.toMatchObject({ ttlSec: 900 });
  redisGetMock.mockResolvedValueOnce(JSON.stringify({ url: 'http://x', expiresAt: 'abc' }));
  await expect(service.getMediaUrl('f1', 'u1')).resolves.toMatchObject({ ttlSec: 900 });
});

it('缓存键版本化 v2', async () => {
  await service.getMediaUrl('f1', 'u1');
  expect(redis.get).toHaveBeenCalledWith('media:url:v2:team-1:f1');
});

it('响应形状恰两键（运行时锁——API tsc exclude spec，编译期门禁不适用）', async () => {
  const out = await service.getMediaUrl('f1', 'u1');
  expect(Object.keys(out).sort()).toEqual(['ttlSec', 'url']);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/media/media.service.spec.ts`
Expected: FAIL（裸 string 返回；`out.url` undefined）

- [ ] **Step 3: 实现**

`media.service.ts:15-32` 整体替换：

```ts
async getMediaUrl(fileId: string, userId: string): Promise<{ url: string; ttlSec: number }> {
  // 1. 先鉴权：查 media + 团队成员校验（缓存命中不得跳过，防缓存越权——spec 用例锁定的顺序，勿动）
  const media = await this.prisma.media.findUnique({ where: { id: fileId } });
  if (!media) throw new NotFoundException('媒体资源不存在');
  if (media.userId !== userId) {
    await assertTeamMember(this.prisma, media.teamId, userId);
  }

  // 2. 键 v2 = 值形状 JSON {url, expiresAt} 的版本化（防新旧 pod 混布读裸 string）；
  //    expiresAt 绝对时刻——命中由服务端算剩余，客户端时钟偏移不影响正确性（F7 根修）
  const cacheKey = `media:url:v2:${media.teamId}:${fileId}`;
  const raw = await this.redis.get(cacheKey);
  if (raw) {
    try {
      const cached = JSON.parse(raw) as { url?: unknown; expiresAt?: unknown };
      const remaining = Math.ceil(((cached.expiresAt as number) - Date.now()) / 1000);
      if (typeof cached.url === 'string' && Number.isFinite(cached.expiresAt as number) && remaining > 0) {
        return { url: cached.url, ttlSec: remaining };
      }
    } catch {
      // 坏值 fallthrough：重签覆写自愈
    }
  }

  // 3. （重新）presign（15 min）+ 写缓存（14 min TTL）
  const url = await this.minio.generatePresignedGetUrl(media.key, 900);
  await this.redis.set(cacheKey, JSON.stringify({ url, expiresAt: Date.now() + 900_000 }), 'EX', 840);
  return { url, ttlSec: 900 };
}
```

（注：剩余 >0 但 <1s 时 `Math.ceil` 得 1 非 0——正数 ceil 下界为 1，无"刚拿到就过期"抖动。）

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @flowweb/api test -- --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/media/media.service.ts apps/api/src/modules/media/media.service.spec.ts
git commit -m "fix(api): getMediaUrl 形状根修——JSON 绝对时刻+服务端算剩余+{url,ttlSec}（F7/R0c；断言+夹具同步迁移）"
```

## Task 15: controller 透传 + 前端完整缓存 + AuthProvider 挂点

**Files:**
- Modify: `apps/api/src/modules/media/media.controller.ts:15-19`
- Modify: `apps/web/src/api/mediaApi.ts:3-8`
- Create: `apps/web/src/utils/mediaUrlCache.ts`（**v4 分层**——缓存/pending/currentUserId/测试钩子独立模块：AuthProvider 不再 import 媒体 hook，缓存可独立单测）
- Modify: `apps/web/src/hooks/useMediaUrl.ts`（全文重写——薄 hook 消费 mediaUrlCache）
- Modify: `apps/web/src/components/AuthProvider.tsx`（currentUserId **渲染期写入** + 登出清空挂点）
- Modify: `apps/web/src/utils/mediaUploadUtils.test.ts:36`（mock 补 ttlSec——**夹具与真实契约对齐，非 tsc 红**：vi.fn() 无泛型）
- Test: `apps/web/src/hooks/useMediaUrl.test.ts`（**mock 层维持 `vi.mock('@/api/client')`**——既有 4 用例兼容：响应无 ttlSec → 兜底 0 → 立即过期不缓存 → 行为同现状）

- [ ] **Step 1: 写失败测试（hook 层：缓存命中 0 请求/isFinite 兜底/竞态/in-flight/userId 隔离）**

`useMediaUrl.test.ts` 修改（沿用既有 `apiFetch` mock，**不新增 mediaApi 层 mock**）：

**v3 关键一：既有顶层 `beforeEach`（:13-15）补 cache 重置**——模块级 cache/pending 跨用例存活，不重置会让既有"file-2 reject"用例（若同 fileId 已被前序用例缓存）走缓存分支永不发请求、`mockRejectedValueOnce` 永不触发：

```ts
// 既有顶层 beforeEach（:13-15）改为（v5.1 errata：必须落在文件顶层——新增 describe 是兄弟作用域，
// describe 内的 beforeEach 继承不到，首跑会 6 用例红在跨用例计数/缓存残留）：
beforeEach(() => {
  vi.clearAllMocks();
  __resetMediaCacheForTests();        // v3：模块级缓存跨用例残留是既有 4 条用例的隐形破坏者
  __setUserIdForTests('user-a');
});
```

新增用例（import 区补测试钩子）：

```ts
import { __setUserIdForTests, __resetMediaCacheForTests, __getCacheSizeForTests, __cachePutForTests } from '@/utils/mediaUrlCache';  // v4：钩子随缓存模块迁移

describe('useMediaUrl 完整缓存（R0c v2——用户拍板提前）', () => {
  it('同 fileId 二次挂载 0 请求（缓存命中，未过期）', async () => {
    (apiFetch as any).mockResolvedValue({ url: '/flowai/u1', ttlSec: 900 });
    const first = renderHook(() => useMediaUrl('f1'));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    first.unmount();
    const second = renderHook(() => useMediaUrl('f1'));
    await waitFor(() => expect(second.result.current.url).toBe('/flowai/u1'));
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('ttlSec 缺失/NaN：兜底按 0——立即过期，下次挂载重取（isFinite 兜底）', async () => {
    (apiFetch as any).mockResolvedValueOnce({ url: '/flowai/u1' });
    const { unmount } = renderHook(() => useMediaUrl('f2'));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    unmount();
    const again = renderHook(() => useMediaUrl('f2'));
    await waitFor(() => expect(again.result.current.url).toBe('/flowai/u1'));
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('切 userId 不串图（键含用户维度——A 缓存的 URL 对 B 是 miss）', async () => {
    (apiFetch as any).mockResolvedValue({ url: '/flowai/a-url', ttlSec: 900 });
    const a = renderHook(() => useMediaUrl('f3'));
    await waitFor(() => expect(a.result.current.url).toBe('/flowai/a-url'));
    a.unmount();
    __setUserIdForTests('user-b');
    (apiFetch as any).mockResolvedValue({ url: '/flowai/b-url', ttlSec: 900 });
    const b = renderHook(() => useMediaUrl('f3'));
    await waitFor(() => expect(b.result.current.url).toBe('/flowai/b-url'));
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('同 fileId 并发挂载共享单请求（in-flight 去重）', async () => {
    let resolveFetch!: (v: any) => void;
    (apiFetch as any).mockImplementationOnce(() => new Promise((r) => { resolveFetch = r; }));
    const a = renderHook(() => useMediaUrl('f4'));
    const b = renderHook(() => useMediaUrl('f4'));
    resolveFetch({ url: '/flowai/shared', ttlSec: 900 });
    await waitFor(() => expect(a.result.current.url).toBe('/flowai/shared'));
    await waitFor(() => expect(b.result.current.url).toBe('/flowai/shared'));
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('fileId 快速切换：旧响应晚到不覆盖新 url（cancelled 竞态保护）', async () => {
    let resolveOld!: (v: any) => void;
    (apiFetch as any).mockImplementationOnce(() => new Promise((r) => { resolveOld = r; }));
    (apiFetch as any).mockResolvedValueOnce({ url: '/flowai/new', ttlSec: 900 });
    const { result, rerender } = renderHook(({ id }) => useMediaUrl(id), { initialProps: { id: 'f-old' } });
    rerender({ id: 'f-new' });
    await waitFor(() => expect(result.current.url).toBe('/flowai/new'));
    resolveOld({ url: '/flowai/stale', ttlSec: 900 });
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.url).toBe('/flowai/new'); // 旧响应被 cancelled 丢弃
  });

  it('currentUserId 未就绪（null）：直取不入缓存（防 ":fileId" 孤儿键——AuthProvider 渲染期写入前的窗口兜底）', async () => {
    __setUserIdForTests(null);
    (apiFetch as any).mockResolvedValue({ url: '/flowai/orphan', ttlSec: 900 });
    const first = renderHook(() => useMediaUrl('f5'));
    await waitFor(() => expect(first.result.current.url).toBe('/flowai/orphan'));
    expect(__getCacheSizeForTests()).toBe(0);   // 未入缓存
    first.unmount();
    __setUserIdForTests('user-a');
    const second = renderHook(() => useMediaUrl('f5'));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2)); // 有身份后正常取+缓存
  });

  it('LRU 上限 64：超出淘汰最旧（v4 纯函数测点——65 次 renderHook 降为 0）', () => {
    // 前提（v5 写死）：beforeEach 已设 userId='user-a'——__cachePutForTests 内部经 cacheKey(fileId) 含当前 userId；
    // 本用例依赖 65 个 fileId 互异 ⇒ 65 个互异键。挪去无 userId 的 describe 前先重估键空间。
    for (let i = 0; i < 65; i++) __cachePutForTests(`lru-${i}`, `/flowai/f-${i}`, 900);
    expect(__getCacheSizeForTests()).toBe(64);   // 第 1 条被淘汰
  });

  it('身份就绪后以新键重取一次：null 窗口取的 url 在新响应到达前保持展示（契约钉，v5——原"不重取"断言与 uid dep 自相矛盾必红）', async () => {
    // v5 推演：rerender → uid null→'user-a' → effect 重跑 → cacheGet('user-a:f6') miss（null 窗口未入缓存）
    // → 二次 fetch——这正是 uid dep 的语义（身份切换重评估）；断言"1 次"必红（用例与实现互相否定）。
    __setUserIdForTests(null);
    (apiFetch as any).mockResolvedValueOnce({ url: '/flowai/pre-auth', ttlSec: 900 });
    const h = renderHook(() => useMediaUrl('f6'));
    await waitFor(() => expect(h.result.current.url).toBe('/flowai/pre-auth'));
    __setUserIdForTests('user-a');
    (apiFetch as any).mockResolvedValueOnce({ url: '/flowai/post-auth', ttlSec: 900 });
    h.rerender();                                  // uid 变 → effect 重评估
    expect(h.result.current.url).toBe('/flowai/pre-auth');   // 新响应前旧 url 不清空（实现只 setError 不清 url）
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));   // 新键 miss → 重取一次
    await waitFor(() => expect(h.result.current.url).toBe('/flowai/post-auth'));
  });

  it('在飞请求跨换号完成：只写回自己的键（不污染新用户缓存——key 发起时捕获契约，v5）', async () => {
    __setUserIdForTests('user-a');
    let resolveA!: (v: any) => void;
    (apiFetch as any).mockImplementationOnce(() => new Promise((r) => { resolveA = r; }));
    const a = renderHook(() => useMediaUrl('f7'));
    __setUserIdForTests('user-b');                 // 换号（不 reset cache——模拟登出只清 cache 保留 pending）
    a.unmount();                                   // cancelled 只挡 hook setState，不挡缓存层写回
    resolveA({ url: '/flowai/a-only', ttlSec: 900 });   // A 的在飞响应晚到：闭包捕获 key='user-a:f7'
    await new Promise((r) => setTimeout(r, 10));
    (apiFetch as any).mockResolvedValue({ url: '/flowai/b-only', ttlSec: 900 });   // v5.1 errata：mock 必须先于 renderHook(b)——act 内 effect 同步发起 fetch，晚设的 mock 救不了在飞 promise
    const b = renderHook(() => useMediaUrl('f7')); // B 取自己的
    await waitFor(() => expect(b.result.current.url).toBe('/flowai/b-only'));
    expect(apiFetch).toHaveBeenCalledTimes(2);
    __setUserIdForTests('user-a');
    const a2 = renderHook(() => useMediaUrl('f7'));     // A 回来：自己的缓存未被 B 污染（各写各键）
    await waitFor(() => expect(a2.result.current.url).toBe('/flowai/a-only'));   // 命中 A 键缓存——0 新请求
    expect(apiFetch).toHaveBeenCalledTimes(2);      // 若实现误按"调用时刻重算 key"，A 的响应会写进 B 的键 → 此处必红
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @flowweb/web test -- --run src/hooks/useMediaUrl.test.ts`
Expected: 新增用例 FAIL（现状无缓存/无去重/无竞态保护）

- [ ] **Step 3: 实现**

3a. `media.controller.ts:15-19`：

```ts
@Get(':fileId/url')
async getUrl(@Req() req: any, @Param('fileId') fileId: string): Promise<{ url: string; ttlSec: number }> {
  return this.mediaService.getMediaUrl(fileId, req.user.id); // 透传（旧 { url } 包装删除）
}
```

3b. `mediaApi.ts`：

```ts
export interface MediaUrlResult { url: string; ttlSec: number }
export async function getMediaUrl(fileId: string): Promise<MediaUrlResult> {
  const res = await apiFetch<MediaUrlResult>(`/media/${fileId}/url`);
  res.url = (res.url as string).replace(/^https?:\/\/[^/]+\/flowai/, '/flowai');
  return res;
}
```

3c-1. `apps/web/src/utils/mediaUrlCache.ts` 新建（**v4 分层**——v3 全在 hook 模块内，AuthProvider import 媒体 hook 是分层倒置；缓存可独立单测）：

```ts
import { getMediaUrl } from '@/api/mediaApi';

// ── 媒体 URL 模块级缓存（spec §4.5 v10 裁决 6；R0c 提前落地，R2b 只剩 mediaUrl 读写收敛+门禁）──
// 键 `${userId}:${fileId}`：服务端鉴权 per-user，fileId-only 会跨账号串图。
// userId 由 AuthProvider 渲染期写入（本模块零 React 订阅——每个媒体消费点不背 auth context 重渲染面）。
let currentUserId: string | null = null;
const CACHE_LIMIT = 64;
const cache = new Map<string, { url: string; expiresAt: number }>();  // Map 迭代序=插入序，首键即最旧 → LRU
const pending = new Map<string, Promise<string>>();

export function setMediaCacheUserId(userId: string | null) { currentUserId = userId; }
export function clearMediaUrlCache() {
  // v4/v5：语义=登出用——只清 cache、pending 保留（在飞请求完成后 .finally 按 key 精确删除；键有 userId 前缀，
  // 登出瞬间在飞的完成最多写一条旧用户键——且只写回自己发起时的键（闭包捕获，见 fetchMediaUrl），
  // 危害是内存不是串号，会被 LRU/过期自然淘汰。
  // 注意与 __resetMediaCacheForTests（测试隔离：cache+pending 都清）语义不同，勿混用。
  cache.clear();
}

// 测试钩子（仅测试文件 import；命名前缀 __ 表意）
export const __setUserIdForTests = setMediaCacheUserId;
export const __resetMediaCacheForTests = () => { cache.clear(); pending.clear(); };
export const __getCacheSizeForTests = () => cache.size;
export const __cachePutForTests = (fileId: string, url: string, ttlSec: number) =>
  cacheSet(cacheKey(fileId), url, ttlSec);  // v4：LRU 淘汰纯函数测点——65 次 renderHook 降为 0（快且不脆）

const cacheKey = (fileId: string) => `${currentUserId ?? ''}:${fileId}`;

export function currentMediaUserId() { return currentUserId; }  // v4：hook deps 身份跟随用

function cacheGet(key: string): { url: string } | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) { cache.delete(key); return null; }
  // LRU touch：删后重插，把该条挪到"最新"端
  cache.delete(key); cache.set(key, hit);
  return hit;
}

/** hook 渲染层命中查询（v5：cacheKey/cacheGet 保持私有——v4 版 hook 直接 import 两者是 TS2305 未导出；
 *  收进缓存层封装，hook 不碰缓存内部结构） */
export function getCachedUrl(fileId: string): { url: string } | null {
  return cacheGet(cacheKey(fileId));
}

function cacheSet(key: string, url: string, ttlSec: number) {
  cache.set(key, { url, expiresAt: Date.now() + ttlSec * 1000 });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value as string;
    cache.delete(oldest);
  }
}

export function fetchMediaUrl(fileId: string): Promise<string> {
  // v4：鉴权身份未就绪时直取不入缓存——防 ":fileId" 孤儿键（AuthProvider 渲染期写入通常已就绪，
  // 此条是防未来在 AuthProvider 之外消费的兜底；该窗口内的请求不做 in-flight 共享，语义一致）
  if (currentUserId === null) {
    return getMediaUrl(fileId).then((r) => r.url);
  }
  const key = cacheKey(fileId);   // 必须在发起时捕获（v5 契约）：登出/换号后在飞响应只能写回自己的键——
                                   // 若改成"调用时刻重算"，A 的响应会写进 B 的键（useMediaUrl.test 跨换号用例锁死）
  const existing = pending.get(key);              // in-flight 去重：并发挂载共享单请求
  if (existing) return existing;
  const p = getMediaUrl(fileId)
    .then((res) => {
      const ttl = Number.isFinite(res.ttlSec) ? res.ttlSec : 0;  // isFinite 兜底：缺失按 0=立即过期（防 NaN 恒假永不重取）
      cacheSet(key, res.url, ttl);
      return res.url;
    })
    .finally(() => { pending.delete(key); });
  pending.set(key, p);
  return p;
}
```

3c-2. `useMediaUrl.ts` 全文重写（薄 hook——只消费 mediaUrlCache）：

```ts
import { useState, useEffect } from 'react';
import { getCachedUrl, fetchMediaUrl, currentMediaUserId } from '@/utils/mediaUrlCache';

export function useMediaUrl(fileId: string | null | undefined): {
  url: string | null;
  loading: boolean;
  error: Error | null;
} {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const uid = currentMediaUserId();   // v4：渲染期读身份进 deps——身份切换时 effect 重评估
                                    //（现状 RequireAuth 登出即卸载子树，此 dep 是防未来 context 直连场景的契约钉）

  useEffect(() => {
    if (!fileId) {
      setUrl(null); setLoading(false); setError(null);
      return;
    }
    const hit = getCachedUrl(fileId);
    if (hit) {
      setUrl(hit.url); setLoading(false); setError(null);
      return;
    }
    let cancelled = false;                        // 竞态保护：fileId 快速切换时旧响应不覆盖新状态
    setLoading(true); setError(null);
    fetchMediaUrl(fileId)
      .then((u) => { if (!cancelled) setUrl(u); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err : new Error(String(err))); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fileId, uid]);

  return { url, loading, error };
}
```

3d. `AuthProvider.tsx`——**渲染期写入**（v3：effect 版有"子先父后"时序坑——RequireAuth 放行画布的那个 commit 里，useMediaUrl 的 effect 先于 AuthProvider 的 [user] effect 执行，首屏请求会以 null 身份入缓存。渲染期写模块变量幂等且先于子树任何 effect）：

```tsx
import { setMediaCacheUserId, clearMediaUrlCache } from '@/utils/mediaUrlCache';  // v4：分层——认证组件不 import 媒体 hook
// AuthProvider 组件体内（useState 之后、return 之前）：
setMediaCacheUserId(user?.id ?? null);   // 渲染期镜像写入（幂等，不触发 React 更新——父 render 先于子树 render/effect）

const logout = async () => {
  await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
  setUser(null);
  clearMediaUrlCache();                  // 登出显式清空（spec：清空双挂点之一；R2b 补 page.tsx 项目切换分支）
};
```

（`refresh`/`updateUser` 经 setUser 触发重渲染 → 渲染期写入自动跟随；不加 effect。）

3e. `mediaUploadUtils.test.ts:36`：`mocks.getMediaUrl.mockResolvedValue({ url: '...' , ttlSec: 900 })`——**理由=夹具与真实契约对齐**（v3 纠错：vi.fn() 无泛型，mockResolvedValue 实参 any，**不是 tsc 红**；不能当 Step 4 的 tsc 证据）。

- [ ] **Step 4: 跑测试+类型检查+消费面核对**

Run: `pnpm --filter @flowweb/web test -- --run src/hooks/ && pnpm --filter @flowweb/web exec tsc --noEmit`
Expected: PASS + 零类型错误（13 调用点 11 解构 `res.url` 兼容；2 处非解构 `(await getMediaUrl(id)).url`（canvasStore.ts 约 :648、mediaUploadUtils.ts:39）只读 `.url` 兼容——tsc 绿即证）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/media/media.controller.ts apps/web/src/api/mediaApi.ts apps/web/src/utils/mediaUrlCache.ts apps/web/src/hooks/useMediaUrl.ts apps/web/src/hooks/useMediaUrl.test.ts apps/web/src/components/AuthProvider.tsx apps/web/src/utils/mediaUploadUtils.test.ts
git commit -m "feat(media): controller 透传+客户端完整缓存（userId 键/LRU64/in-flight/竞态/isFinite——v10 裁决 6 提前，用户拍板）"
```

## Task 16: R0c 收尾冒烟

- [ ] **Step 1: 类型与全量测试**

Run: `pnpm --filter @flowweb/api test -- --run && pnpm --filter @flowweb/web test -- --run && pnpm --filter @flowweb/web lint`
Expected: 全绿+lint 零错（v5 补 lint——R0c 新增 mediaUrlCache.ts、改 AuthProvider.tsx 均落 src 受 theme lint 零容忍约束，test 只跑 vitest 查不到）

- [ ] **Step 2: 浏览器冒烟（dev server 起 web+api）**

清单：含图画布图片正常（Network：`/media/:id/url` 响应含 url+ttlSec）→ 刷新同 fileId 0 新请求 → 分镜宫格缩略图正常 → 登出换账号进同团队画布不串图（如本地有双测试账号）。

```bash
git status   # 冒烟不改码；有意外改动停下检查
```

---

# R0d stitch 走私封堵 + 线上载荷剥离 + 棘轮门禁

**v10 边界（用户拍板）：** 不装全局 ValidationPipe（v10 裁决 1 三条理由，经三份评审复核全部成立）。**v2 新增：stitchApi 剥 sourceGroupId**——现状 `JSON.stringify(params)` 把定位字段送上线（注释"不发给后端"为假），forbidNonWhitelisted 落地后**每次真实拼接必 400**；本分片文件清单含 web 侧 stitchApi（"零涉及 web"的旧假设作废）。测试方式：**pipe 直测 + PIPES_METADATA 结构断言**（storyboard.controller.spec.ts 既有直调不经管道，supertest 无依赖无先例）。

## Task 17: stitchApi 剥 sourceGroupId + STITCH_JOB_KEYS 跨端锚定 + 载荷契约测试（**v3 换序先行**——纯 web/shared 零风险，pipe 上线前体检）

**Files:**
- Create: `packages/shared/src/types/stitch.ts`（+ index.ts 导出）
- Modify: `apps/web/src/api/stitchApi.ts`
- Create: `apps/web/src/api/stitchApi.test.ts`

- [ ] **Step 1: 写失败测试（本次事故的永久防回归锚）**

`stitchApi.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./client', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from './client';
import { STITCH_JOB_KEYS } from '@flowweb/shared';
import { createStitchTask, type StitchParams } from './stitchApi';

describe('stitch 线上载荷契约（R0d——sourceGroupId 剥离 + STITCH_JOB_KEYS 跨端锚定）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST body 键集恰=STITCH_JOB_KEYS——sourceGroupId 不上线（注释"不发给后端"曾为假，forbid pipe 后每次拼接 400）', async () => {
    (apiFetch as any).mockResolvedValue({ taskId: 't1', status: 'PENDING' });
    const params: StitchParams = {
      fileIds: ['f1'], gridRows: 1, gridCols: 1, aspectRatio: '16:9', showIndex: false, resolution: '2K',
      sourceGroupId: 'g1',
    };
    await createStitchTask('p1', params);
    expect(apiFetch).toHaveBeenCalled();
    const body = JSON.parse((apiFetch as any).mock.calls[0][1].body);
    expect(Object.keys(body).sort()).toEqual([...STITCH_JOB_KEYS].sort());
    expect(body).not.toHaveProperty('sourceGroupId');
  });

  it('无 sourceGroupId 的调用不受影响（六键直传）', async () => {
    (apiFetch as any).mockResolvedValue({ taskId: 't1', status: 'PENDING' });
    await createStitchTask('p1', { fileIds: ['f1'], gridRows: 1, gridCols: 1, aspectRatio: '16:9', showIndex: false, resolution: '2K' });
    expect(Object.keys(JSON.parse((apiFetch as any).mock.calls[0][1].body))).toHaveLength(6);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @flowweb/web test -- --run src/api/stitchApi.test.ts`
Expected: FAIL（STITCH_JOB_KEYS 不存在；现状整体序列化——body 七键含 sourceGroupId）

- [ ] **Step 3: 实现（显式 pick——v3：与 Task 19 service pick 同口径，解构丢弃会让未来字段自动上线）**

3a. `packages/shared/src/types/stitch.ts`（VIDEO_WORK_NODE_TYPES 同款跨端锚定先例）：

```ts
/** stitch 线上载荷键集单源（R0d）：API 的 CreateStitchTaskDto 与 web 的 stitchApi 契约测试共同锚定——
 *  加第 7 键时两侧测试必红其一，杜绝两份手工定义静默漂移（运行时 400）。
 *  字段类型镜像 CreateStitchTaskDto（storyboard.dto.ts）——改类型须双侧同步（v5 补注）。 */
interface StitchWireShape {
  fileIds: string[]; gridRows: number; gridCols: number;
  aspectRatio: string; showIndex: boolean; resolution: string;
}

export const STITCH_JOB_KEYS = [
  'fileIds', 'gridRows', 'gridCols', 'aspectRatio', 'showIndex', 'resolution',
] as const satisfies readonly (keyof StitchWireShape)[];
```

（`packages/shared/src/index.ts` 补 `export * from './types/stitch';`）

3b. `stitchApi.ts`：

```ts
import { apiFetch } from './client';
import { STITCH_JOB_KEYS } from '@flowweb/shared';
import type { AspectRatio, StitchResolution } from '@/types/group';

/** 客户端入参 = 线上六键 + 本地定位字段（useStitchTask:63 spawnResultNode 消费） */
export interface StitchParams {
  fileIds: string[];
  gridRows: number;
  gridCols: number;
  aspectRatio: AspectRatio;
  showIndex: boolean;
  resolution: StitchResolution;
  sourceGroupId?: string; // 产物节点定位用（组右侧）——不入线（whitelist pipe 前提，stitchApi 剥离）
}

export interface StitchResult {
  taskId: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  fileId?: string;
  url?: string;
  width?: number;
  height?: number;
  failedCount?: number;
  error?: string;
}

export const createStitchTask = (projectId: string, params: StitchParams) => {
  // 显式 pick（非解构丢弃）：未来加字段默认不上线，须显式加入 STITCH_JOB_KEYS——与 service 端 pick 同口径。
  // v4：Pick 型别锚定（编译级）——STITCH_JOB_KEYS 加第 7 键时 body 立刻编译不过（比 void 假引用强，
  // 且 pick 与 KEYS 的一致性由 stitchApi.test.ts 第一条行为锚定）。
  const body: Pick<StitchParams, (typeof STITCH_JOB_KEYS)[number]> = {
    fileIds: params.fileIds, gridRows: params.gridRows, gridCols: params.gridCols,
    aspectRatio: params.aspectRatio, showIndex: params.showIndex, resolution: params.resolution,
  };
  return apiFetch<StitchResult>(`/projects/${projectId}/storyboard/stitch`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
};

export const getStitchTask = (projectId: string, taskId: string) =>
  apiFetch<StitchResult>(`/projects/${projectId}/storyboard/stitch/${taskId}`);
```

（`useStitchTask.ts:63` 读 `params.sourceGroupId` 不受影响——类型仍在 StitchParams 上。）

- [ ] **Step 4: 跑测试+消费面回归**

Run: `pnpm --filter @flowweb/web test -- --run src/api/ && pnpm --filter @flowweb/web exec tsc --noEmit`
Expected: PASS + 零类型错误

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/stitch.ts packages/shared/src/index.ts apps/web/src/api/stitchApi.ts apps/web/src/api/stitchApi.test.ts
git commit -m "fix(web): stitchApi 显式 pick 剥 sourceGroupId 出线+STITCH_JOB_KEYS 跨端锚定（R0d 先行——pipe 上线前体检；原注释'不发给后端'为假）"
```

## Task 18: CreateStitchTaskDto + 方法级 pipe + validatorOptions 选项锁（v3 换序在后——线上载荷已合法）

**Files:**
- Create: `apps/api/src/modules/storyboard/storyboard.dto.ts`
- Create: `apps/api/src/modules/storyboard/storyboard.pipe.spec.ts`
- Modify: `apps/api/src/modules/storyboard/storyboard.controller.ts`
- Modify: `apps/api/src/modules/storyboard/storyboard.service.ts:7-10`（删 interface 改 import class——同名撞车消除）

- [ ] **Step 1: 写失败测试（pipe 直测 + 选项锁 + 挂载结构断言，三件事分开锁）**

`storyboard.pipe.spec.ts`（pipe 直测先例：material-library/dto/dto-whitelist.spec.ts；**PIPES_METADATA 断言属仓内首例**——@nestjs/common/constants 已验证可 deep import）：

```ts
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { PIPES_METADATA } from '@nestjs/common/constants';
import { STITCH_JOB_KEYS } from '@flowweb/shared';
import { CreateStitchTaskDto } from './storyboard.dto';
import { StoryboardController } from './storyboard.controller';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true });
const meta = { type: 'body', metatype: CreateStitchTaskDto } as any;

const validBody = { fileIds: ['f1'], gridRows: 2, gridCols: 2, aspectRatio: '16:9', showIndex: true, resolution: '4K' };

describe('stitch pipe 配置（R0d①——走私 400 可观测）', () => {
  it('塞 nodeId → BadRequest 且结构化报文含 nodeId（不依赖英文报文原文）', async () => {
    await expect(pipe.transform({ ...validBody, nodeId: 'victim' }, meta)).rejects.toThrow(BadRequestException);
    try {
      await pipe.transform({ ...validBody, nodeId: 'victim' }, meta);
      expect.unreachable('应抛 BadRequestException');
    } catch (e: any) {
      const msgs = (e.getResponse?.() as { message?: string[] })?.message ?? [];
      expect(msgs.join()).toContain('nodeId');
    }
  });

  it('塞 projectId/userId（IDOR 键）→ 拒', async () => {
    await expect(pipe.transform({ ...validBody, projectId: 'V', userId: 'X' }, meta)).rejects.toThrow(BadRequestException);
  });

  it('塞 sourceGroupId（Task 17 剥离前的历史第 7 键）→ 拒（服务端不再容忍）', async () => {
    await expect(pipe.transform({ ...validBody, sourceGroupId: 'g1' }, meta)).rejects.toThrow(BadRequestException);
  });

  it('合法六键透传（whitelist 不误伤）', async () => {
    await expect(pipe.transform(validBody, meta)).resolves.toEqual(validBody);
  });

  it('每个线上键的非标量/错误值被拒（漏装饰器 = whitelist 剥除后 forbid 400——发射策略无关的键集锚定）', async () => {
    // v4：替代 Object.keys(new Dto())——后者押在 useDefineForClassFields 发射策略上（target 降级即空数组），
    // 且抓不到"键在、装饰器漏"（漏装饰器 → whitelist 剥除 → 客户端照发 → 每次拼接 400）。本条行为式断言两向都抓：
    const invalid: Record<string, unknown> = {
      fileIds: 'not-array', gridRows: 'x', gridCols: 'x',
      aspectRatio: 'bogus', showIndex: 'x', resolution: '8K',
    };
    for (const k of STITCH_JOB_KEYS) {
      await expect(pipe.transform({ ...validBody, [k]: invalid[k] }, meta)).rejects.toThrow(BadRequestException);
    }
    // v5：数组元素类型维度（@IsString({each:true}) 的射程——v4 只覆盖"标量被改坏"）
    await expect(pipe.transform({ ...validBody, fileIds: ['ok', 123] }, meta)).rejects.toThrow(BadRequestException);
  });

  it('任意第 7 键被拒（键集契约的行为面——防 STITCH_JOB_KEYS 与 DTO 漂移）', async () => {
    await expect(pipe.transform({ ...validBody, anySeventhKey: 1 }, meta)).rejects.toThrow(BadRequestException);
  });
});

describe('controller 挂载结构断言（pipe 行为对 ≠ 挂上了 ≠ 选项对——三层分开锁）', () => {
  it('stitch 方法挂了 ValidationPipe 且选项含 whitelist+forbidNonWhitelisted（v3：instanceof 锁不住选项——摘掉 forbid 仍 instanceof）', () => {
    const pipes = Reflect.getMetadata(PIPES_METADATA, StoryboardController.prototype.stitch);
    expect(Array.isArray(pipes)).toBe(true);
    expect(pipes.length).toBeGreaterThan(0);
    expect(pipes[0]).toBeInstanceOf(ValidationPipe);
    // ValidationPipe 把选项存 this.validatorOptions（@nestjs/common 10.4.x 实现细节，已验证）。
    // v4 降级话术：若因 Nest 升级此断言失败（私有字段改名），改为断言 controller 源码文本
    // 'forbidNonWhitelisted: true' 同现——勿删断言（摘掉 forbid 会让走私变静默剥除，正是 F31 要消灭的形态）。
    expect((pipes[0] as any).validatorOptions).toMatchObject({ whitelist: true, forbidNonWhitelisted: true });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/storyboard/storyboard.pipe.spec.ts`
Expected: FAIL（CreateStitchTaskDto 模块不存在）

- [ ] **Step 3: 实现**

`storyboard.dto.ts`（**命名 CreateStitchTaskDto——storyboard.service.ts:7-10 已有 interface StitchTaskDto，同名撞车**）：

```ts
import { IsArray, IsInt, IsIn, IsBoolean, IsString, Min, Max } from 'class-validator';
import { VALID_ASPECT_RATIOS, VALID_RESOLUTIONS } from './storyboard.constants';

/** stitch 线上载荷契约（R0d①）：@Body() 必须是 class——inline type/any 的 metatype 是 Object，
 *  pipe 直接跳过（F31）。键集=shared STITCH_JOB_KEYS（storyboard.pipe.spec.ts 锚定）；
 *  sourceGroupId 是客户端本地定位字段，已由 stitchApi 剥离（Task 17）。 */
export class CreateStitchTaskDto {
  @IsArray()
  @IsString({ each: true })
  fileIds!: string[];

  @IsInt()
  @Min(1)
  @Max(10)
  gridRows!: number;

  @IsInt()
  @Min(1)
  @Max(10)
  gridCols!: number;

  @IsIn(VALID_ASPECT_RATIOS)
  aspectRatio!: string;

  @IsBoolean()
  showIndex!: boolean;

  @IsIn(VALID_RESOLUTIONS)
  resolution!: string;
}
```

`storyboard.controller.ts`（import 区补 UsePipes/ValidationPipe/CreateStitchTaskDto）：

```ts
@Post('stitch')
@HttpCode(202)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })) // 走私 400 可观测——非静默剥除
async stitch(
  @Param('projectId') projectId: string,
  @Body() body: CreateStitchTaskDto,
  @Req() req: Request,
) {
  const userId = (req as any).user?.id;
  await this.perm.assertEditor(projectId, userId);
  return this.service.createStitchTask(projectId, body, userId);
}
```

`storyboard.service.ts:7-10`：**删除** `export interface StitchTaskDto {...}`，import 区改 `import { CreateStitchTaskDto } from './storyboard.dto'`，`createStitchTask(projectId, dto: CreateStitchTaskDto, ...)` 签名同步。

- [ ] **Step 4: 既有 controller spec 核对 + 跑测试**

`storyboard.controller.spec.ts` 既有 5 用例：直调 `controller.stitch('p1', body, req)` 传 plain object（TS 结构兼容 class 类型注解）→ `toHaveBeenCalledWith('p1', body, ...)` 同引用 → **不红**（预期维持绿，无需迁移）。

Run: `pnpm --filter @flowweb/api test -- --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/storyboard/storyboard.dto.ts apps/api/src/modules/storyboard/storyboard.pipe.spec.ts apps/api/src/modules/storyboard/storyboard.controller.ts apps/api/src/modules/storyboard/storyboard.service.ts
git commit -m "fix(api): CreateStitchTaskDto+方法级 forbid pipe+删 service 同名 interface（R0d①；pipe 直测+validatorOptions 选项锁+PIPES_METADATA 结构断言三层——直调不经管道的坑已登记）"
```

## Task 19: service 显式 pick（结构免疫）

**Files:**
- Modify: `apps/api/src/modules/storyboard/storyboard.service.ts:47`
- Test: `apps/api/src/modules/storyboard/storyboard.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('job payload 恰含 8 键且全部来自白名单字段——显式 pick（R0d③，免疫未来 DTO 加敏感字段）', async () => {
  await service.createStitchTask('p1', {
    fileIds: ['f1'], gridRows: 1, gridCols: 1, aspectRatio: '16:9', showIndex: false, resolution: '2K',
    ...( { secretField: 'leak' } as any),
  }, 'u1');
  expect(stitchQueue.add).toHaveBeenCalled();   // v5：本文件 :4 模块级 const stitchQueue（v4 的 stitchQueueAddMock 零命中）
  const payload = stitchQueue.add.mock.calls[0][1];
  expect(Object.keys(payload).sort()).toEqual(
    ['aspectRatio', 'fileIds', 'gridCols', 'gridRows', 'projectId', 'resolution', 'showIndex', 'userId'].sort(),
  );
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/storyboard/storyboard.service.spec.ts`
Expected: FAIL（现状 `...dto` 尾展开——secretField 进 payload，9 键）

- [ ] **Step 3: 实现（:47 改列名展开）**

```ts
const job = await this.stitchQueue.add('stitch', {
  projectId,
  userId,
  fileIds: dto.fileIds,
  gridRows: dto.gridRows,
  gridCols: dto.gridCols,
  aspectRatio: dto.aspectRatio,
  showIndex: dto.showIndex,
  resolution: dto.resolution,
});
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/storyboard/storyboard.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/storyboard/storyboard.service.ts apps/api/src/modules/storyboard/storyboard.service.spec.ts
git commit -m "fix(api): stitch job payload 显式 pick 8 键（R0d③——尾展开改列名，免疫未来字段走私）"
```

## Task 20: 5 键块删除 + collabDoc 注入清理

**Files:**
- Modify: `apps/api/src/modules/storyboard/stitch.consumer.ts`（:5 import / :33 ctor / :112-121 块 / :15 `nodeId?`）
- Modify: `apps/api/src/modules/storyboard/stitch.consumer.spec.ts`（:46 writeNodeData mock）

- [ ] **Step 1: 写失败测试（锁删除目标——v3 因果链修正：5 键块在第一方客户端从未执行过的原因是 web 端从未发送过 nodeId（grep 零命中——它只在攻击者走私 body 中出现，与 sourceGroupId 是两个不同字段名，勿混淆）；删除理由=产品裁决"组上不显示拼接状态"，可达性走私面已被 Task 18 pipe 封死）**

`stitch.consumer.spec.ts` 调整——**makeJob 先改单参 merge 签名**（现状 :13 `const makeJob = () => ({...}) as any as Job` 无参，直接传参会 TypeError）：

```ts
// :13 改为：
const makeJob = (over: Partial<{ nodeId?: string }> = {}) =>
  ({
    id: 'job-1',
    data: {
      projectId: 'p1', userId: 'u1', fileIds: ['f1'],
      gridRows: 1, gridCols: 1, aspectRatio: '16:9', showIndex: false, resolution: '2K',
      ...over,
    },
  }) as any as Job;

// v5：collabDoc/writeNodeData 是 beforeEach :46 局部 const——提升到 describe 作用域供断言引用：
let collabDoc: { writeNodeData: ReturnType<typeof vi.fn> };
// （beforeEach 内改 collabDoc 赋值：collabDoc = { writeNodeData: vi.fn() };，ctor 第 4 实参不变）

// 追加用例（现状双必红——writeNodeData 可达性 + ctor 形参数）：
it('拼接产物不再写组节点 data（5 键块已删——产品裁决；现状红相：nodeId 可达时 writeNodeData 被调）', async () => {
  await consumer.process(makeJob({ nodeId: 'g1' }));
  expect(collabDoc.writeNodeData).not.toHaveBeenCalled();
});

it('ctor 形参数=3（v5 arity 锚：现状 4 必红，实现后 3 长效——加参即红，可进 CI 的结构断言）', () => {
  expect(StitchConsumer.length).toBe(3);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/storyboard/stitch.consumer.spec.ts`
Expected: FAIL（夹具带 nodeId 时现状调用 writeNodeData）

- [ ] **Step 3: 实现（四处一起删）**

3a. :112-121 整块删（`// 组节点 data 逐键写入...` 到 `if (d.nodeId) {...}` 止）。
3b. `StitchJobData`（:12-22）删 `nodeId?: string;`（makeJob 夹具同步删）。
3c. import :5 删 CollabDocumentService；ctor :33 删 collabDoc 参数。
3d. spec 的 collabDoc provider/writeNodeData mock 一并清理；**"拼接产物不再写组节点 data"用例随之删除**（v5：清理 mock 后 not.toHaveBeenCalled 恒真无判别力——保留即自欺；其长效判别力由 arity 锚 `StitchConsumer.length===3` + Step 4 grep 零残留接管）。makeJob 夹具的 over 类型同步删 nodeId。

- [ ] **Step 4: 跑测试 + grep 零残留**

Run: `pnpm --filter @flowweb/api exec vitest run src/modules/storyboard/ && grep -rn "d\.nodeId\|writeNodeData" apps/api/src/modules/storyboard/`
Expected: PASS + grep 零命中（writeNodeData 的 4 个真实调用方在其他模块不受影响）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/storyboard/stitch.consumer.ts apps/api/src/modules/storyboard/stitch.consumer.spec.ts
git commit -m "refactor(api): 删 stitch 5 键块+collabDoc 注入（R0d——产品裁决；web 端从未发送 nodeId（grep 零命中），可达性仅来自走私 body 且已被 Task 18 pipe 封死）"
```

## Task 21: @Body() 棘轮门禁（方法块级+类级回退判定 + 扫描函数自证，v3 三修）

**Files:**
- Create: `apps/api/src/common/body-param-ratchet.spec.ts`

**v3 设计修正（三处）：** ① 判定粒度方法块级 + **类级 pipe 回退**（类级 `@UsePipes` 位于第一个 HTTP 动词装饰器之前的前导块——admin-video-work:15 等仓内主流形态；不含类级回退会把约 29 个已保护端点误判违规，门禁会被基线淹没成摆设）；② isInline 补**数组后缀**（`SettingEntry[]`——v2 漏检会落入 DTO 桶）；③ 自证用例扩四条 + **扫描面非空自证**（防 cwd 错位→空集→门禁恒绿——spec §5 最贵失误模式）。**登记：** storage×2/lighting/admin-banner 等 DTO-class-无-pipe 存量端点进基线（修正后现场扫描为准，应为个位数）；"补装饰器+方法 pipe 后基线清零转正向规则"是 R3 立项（spec v10 已登记），本分片不动 storage 运行时行为（v10 拍板）。

- [ ] **Step 1: 写门禁测试（扫描纯函数 + 自证四用例 + 基线断言）**

```ts
import { readFileSync, readdirSync, statSync } from 'fs';
import * as path from 'path';

// ── 扫描纯函数（可单测——假绿/假红洞的自证入口）──
// v5：两桶统一内容标识 string[]（'rel|param: type'）——原 dtoNoPipe 是 Record<rel, count>+#i 序号编码，
// "同文件修好一个+变坏一个"时计数不变恒绿；改内容标识后新增端点必产新 tuple 红。
// 已知盲区登记：Set 去重使"同文件同参名同类型的重复违规"数量不可见（inline 桶 v4 起同款——出现概率极低，登记不修）。
export interface BodyScanResult { inline: string[]; dtoNoPipe: string[] }

export function scanBodyParams(sources: Record<string, string>): BodyScanResult {
  const inline: string[] = [];
  const dtoNoPipe: string[] = [];
  for (const [rel, src] of Object.entries(sources)) {
    // 方法块切分：HTTP 动词装饰器起，到下一个动词装饰器或文件尾
    const blocks = src.split(/(?=@(?:Post|Get|Put|Patch|Delete)\()/);
    // v3/v5：类级 pipe 检测——第一个动词装饰器之前的前导块 = 类声明区（类级 @UsePipes 在这里）。
    // 前提修正（v5）：类装饰器在 TS 语法上必位于 class 声明前（不可能在类体后），blocks[0] 覆盖是结构保证；
    // 多行类级装饰器 \s* 跨行可匹配，非盲区。真漏判形态仅：字符串/注释含动词装饰器字面量（如文档示例）
    // 导致切分错位——此时方法块滑进前导块，dtoNoPipe 内容变化 → 门禁红 → 现场先查此处。
    const hasClassPipe = /UsePipes\(\s*new\s*ValidationPipe/.test(blocks[0] ?? '');
    for (const block of blocks) {
      const m = block.match(/@Body\(\)\s+(\w+):\s*([^,)=\n]+)/);
      if (!m) continue;
      const type = m[2].trim().replace(/\s+/g, ' ');
      // v3：数组后缀（SettingEntry[]）与联合类型归 inline；Partial</{/[/any 同
      const isInline = type === 'any' || /^(\{|\[|Partial<)/.test(type) || /\[\]$/.test(type) || type.includes('|');
      if (isInline) {
        inline.push(`${rel}|${m[1]}: ${type}`);
      } else if (/^[A-Z]/.test(type)
          && !hasClassPipe                                  // v3：类级 pipe 覆盖全文件方法
          && !/UsePipes\(\s*new\s*ValidationPipe/.test(block)) { // 方法块内 pipe
        dtoNoPipe.push(`${rel}|${m[1]}: ${type}`);
      }
    }
  }
  return { inline, dtoNoPipe };
}

const SRC = path.resolve(process.cwd(), 'src');  // pnpm --filter 的 cwd 恒为包根（__dirname 在 API spec 无先例不赌）

function collectSources(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.endsWith('.controller.ts')) {
        out[path.relative(SRC, p).split(path.sep).join('/')] = readFileSync(p, 'utf8');
      }
    }
  };
  walk(SRC);
  return out;
}

/** 棘轮基线（Step 2 现场扫描生成后固化）：新端点要求 @Body() 用 DTO class 且有 pipe 保护（方法级或类级）。
 *  v4/v5：扁平字符串集合（'rel|param: type'）+ 两桶统一内容标识；只查增长（合法清理不逼改基线）。
 *  v5 表述修正：v4 声称"文件改名自动免疫"不准——rel 段变化时该文件 tuple 全量更新 → 门禁红 →
 *  属"搬运=重审"语义（人工确认后更新基线），非自动免疫；比 Record 按路径索引的"整份清单假红"仍显著收敛。 */
const INLINE_BASELINE = new Set<string>([
  /* 按 Step 2 扫描输出固化：'src/modules/.../x.controller.ts|body: any' 形态 */
]);
const DTO_NO_PIPE_BASELINE = new Set<string>([
  /* v5：内容标识回填（'src/modules/.../x.controller.ts|dto: XDto' 形态——应为个位数，storage×2/lighting/admin-banner 预期）；
     v2 预告的"4 个"是在漏检数组+类级回退的扫描器下得出的，以现场为准 */
]);

describe('@Body() 棘轮门禁（R0d②，v3 三修）', () => {
  it('自证①：文件有方法级 pipe 但另一方法块无 → 判违规（文件级判定的假绿洞）', () => {
    const fake = {
      'fake.controller.ts': [
        "@Controller('x')",
        '@Post("a") @UsePipes(new ValidationPipe({ whitelist: true })) m1(@Body() d: ADto) {}',
        '@Post("b") m2(@Body() d: ADto) {}',
      ].join(String.fromCharCode(10)),   // v5：'\n' 字面量经传输层会被折叠成真换行（parse 错）——fromCodePoint 抗折叠
    };
    const out = scanBodyParams(fake);
    expect(out.dtoNoPipe).toEqual(['fake.controller.ts|d: ADto']);
  });

  it('自证②：类级 pipe + 方法无方法级 pipe → 合规（v3——admin-video-work 形态，29 端点误报洞）', () => {
    const fake = {
      'fake-class.controller.ts': [
        "@Controller('y') @UsePipes(new ValidationPipe({ whitelist: true }))",
        'export class Y {',
        '  @Post() m(@Body() d: ADto) {}',
        '}',
      ].join(String.fromCharCode(10)),
    };
    const out = scanBodyParams(fake);
    expect(out.dtoNoPipe).toHaveLength(0);
  });

  it('自证③：inline/any/Partial/数组/联合类型全归 inline 桶（数组漏检洞）', () => {
    const fake = {
      'fake2.controller.ts': [
        '@Post() a(@Body() body: any) {}',
        '@Post() b(@Body() body: { name: string }) {}',
        '@Post() c(@Body() entries: SettingEntry[]) {}',
        '@Post() d(@Body() body: Partial<{ x: number }>) {}',
        '@Post() e(@Body() body: string | number) {}',
      ].join(String.fromCharCode(10)),
    };
    const out = scanBodyParams(fake);
    expect(out.inline).toHaveLength(5);
    expect(out.dtoNoPipe).toHaveLength(0);
  });

  it('自证④：扫描面非空（防 cwd 错位→空集→门禁恒绿）', () => {
    const sources = collectSources();
    expect(Object.keys(sources).length).toBeGreaterThan(20);
    expect(Object.keys(sources).some((f) => f.includes('storyboard'))).toBe(true);
  });

  it('生产源码：inline/any 不新增（内容标识基线只查增长，v5）', () => {
    const { inline } = scanBodyParams(collectSources());
    const grown = inline.filter((e) => !INLINE_BASELINE.has(e));
    expect(grown).toEqual([]);
  });

  it('生产源码：DTO-class-无-pipe 端点不新增（内容标识基线只查增长，v5）', () => {
    const { dtoNoPipe } = scanBodyParams(collectSources());
    const grown = dtoNoPipe.filter((e) => !DTO_NO_PIPE_BASELINE.has(e));
    expect(grown).toEqual([]);
  });
});
```

- [ ] **Step 2: 生成基线（现场扫描回填，输出原文贴进 commit message——后人可重放）**

临时在文件尾加 `console.log(JSON.stringify(scanBodyParams(collectSources()), null, 2))` → `pnpm --filter @flowweb/api exec vitest run src/common/body-param-ratchet.spec.ts` → 取输出回填两个基线常量 → 删 console.log。**首先确认看到的是"用例红"而非"文件 parse 错误"**（v4 曾因正则字面量跨行导致整文件语法错误——`[^,)=` 后断行；v5 又实锤三处 `.join('\n')` 同型断行残留已改 `String.fromCharCode(10)`。若见 parse error 先查正则单行性与 join 写法）。**红相实证**（v4 收敛为一向——②复制 controller 去类级 pipe 会新增文件必然红，红的归因是"新文件"而非"类级回退失效"，不可执行）：① 临时在某 controller 加 `@Post() t(@Body() body: any) {}` 假端点 → inline 冻结用例 FAIL → 删除 → PASS（记录进 commit message；类级回退的判别力由自证②在用例内锁定）。

- [ ] **Step 3: 跑测试确认通过**

Run: `pnpm --filter @flowweb/api exec vitest run src/common/body-param-ratchet.spec.ts`
Expected: PASS（6 条：4 自证 + 2 冻结）

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/common/body-param-ratchet.spec.ts
git commit -m "test(api): @Body() 棘轮门禁 v3——方法块级+类级回退+数组/联合归 inline+扫描面自证（R0d②；红相实证双向，基线原文见上）"
```

## Task 22: R0d 收尾 + 手工冒烟

- [ ] **Step 1: 类型检查与全量测试**

Run: `pnpm --filter @flowweb/api test -- --run && pnpm --filter @flowweb/web test -- --run`
Expected: 全绿

- [ ] **Step 2: 手工冒烟（dev server；Windows 下用 curl.exe）**

```powershell
# 走私封堵（token 按 dev 登录流程获取）——v3：--data-raw + 变量（单引号内 \" 是字面反斜杠，服务端 JSON 解析会失败得 400 parse error，误判走私结论）：
$body = '{"fileIds":["x"],"gridRows":1,"gridCols":1,"aspectRatio":"16:9","showIndex":false,"resolution":"2K","nodeId":"smuggle"}'
curl.exe -s -X POST "http://localhost:3000/api/projects/<pid>/storyboard/stitch" `
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" --data-raw $body
# 期望：400 且报文含 property nodeId（非 JSON parse error——若见 parse error 是转义问题重试）
```

浏览器冒烟（**P0 终极验证——契约测试之外的双保险**）：真实点击"拼接(2K)"按钮 → **202 且任务正常完成**（Task 18 剥离后线上六键合法）；上传链回归锚点：素材库上传一张图 → presign+confirm 成功 → 画布显示（R0d 零涉及 storage，防"误加全局 pipe"类回归）。

- [ ] **Step 3: R0 全分片终验**

Run: `pnpm --filter @flowweb/shared test -- --run && pnpm --filter @flowweb/api test -- --run && pnpm --filter @flowweb/web test -- --run && pnpm --filter @flowweb/web lint && pnpm --filter @flowweb/web exec tsc --noEmit && pnpm --filter @flowweb/api exec tsc --noEmit`
Expected: 全绿 + lint 零错（v5 补——R0d 新增 stitchApi.test.ts 落 src 受 theme lint 约束） + 零类型错误

---

## 验收对照表（spec §5 R0 相关条目 → task 映射，v5）

| spec 验收项 | task |
|---|---|
| F2 八消费点经 resolver 不崩（渲染 2+store 3+NaN 2+守卫 1） | Task 5/6/7 |
| `.storyboard\b` 裸解引用 allowlist 门禁（vitest grep） | Task 8 |
| 克隆体上解组/转普通组/填充宫格不崩（含 :1219 cells 守卫） | Task 6 |
| NaN 双点全维断言（宽高有限 + aspectRatio ∈ 枚举 + 整数维度） | Task 6 |
| F38 基线断言（ungroup/convertGroup 覆盖子尺寸缺陷面钉死，翻转目标=R2a；v5 第二槽判别力） | Task 6 |
| F35 现场 TODO 登记（ydocBuilder/canvasCollabRuntime——plan 归档后注释仍在，v5） | Task 9 |
| 缩格真溢出不变量（img2 移出组非删除） | Task 6 |
| clone 表 9 键 parity + 类型全覆盖对称锚定 + 政策断言 + 夹具补 storyboard + G1 手动尺寸保持 | Task 2/3 |
| status 归一断言 = 'idle'（resetStatusIdle 写入语义，v2 修正） | Task 3/11 |
| 往返等价全量基准（逐字段归一比较，v2 完整断言体） | Task 13 |
| save 有值三键存续（必红主用例，v2 判别力修正）+ null/undefined 边界不抛错 | Task 11 |
| isPublic 过滤=内容变换语义 + 粘性断言 + 公开不可逆登记 | Task 11 |
| 跨用户导入过滤 + 作者导入全量 | Task 11 |
| 读侧收敛（解构剥键 + Prisma 类型夹具编译期强制 + select 盲断言） | Task 11/12 |
| schemaVersion 红面迁移 + seed 幂等覆盖（findFirst+update，v2 修正） | Task 11/12 |
| Prisma Json 往返地基实证（undefined 键消失；真实 user id 防 FK） | Task 10 |
| 残缺模板行（缺 nodes/edges）导入 400 业务文案（非 TypeError） | Task 11/12 |
| isPublic 粘性（willBePublic）+ 公开单向有损文案登记 | Task 11/12 |
| R0c 浏览器缓存冒烟（同 fileId 0 新请求/不串图） | Task 16 |
| media 六断言形状化 + **夹具 JSON 化** + 命中剩余寿命 + 坏值覆写 | Task 14 |
| 完整客户端缓存（userId 键/LRU64/in-flight/竞态/isFinite/身份就绪不重取契约）+ mediaUrlCache 独立模块（分层）+ AuthProvider 渲染期挂点 | Task 15 |
| mediaUploadUtils.test mock 补 ttlSec | Task 15 |
| 走私 400 逐键断言（pipe 直测+结构化报文）+ 选项锁（validatorOptions+降级话术）+ 挂载结构断言（PIPES_METADATA 首例）+ 逐键 invalid 400（装饰器盲修复）+ 第 7 键 400 + STITCH_JOB_KEYS 编译级锚定（Pick） | Task 17/18 |
| **stitch 线上载荷契约（body 恰六键，sourceGroupId 显式 pick 剥离——先行于 pipe）+ shared satisfies Shape** | Task 17 |
| 显式 pick 8 键 + d.nodeId 零残留 + mock 清理 | Task 19/20 |
| @Body() 棘轮门禁（方法块级+类级回退+数组/联合归 inline + 自证四条 + 扫描面非空 + 双基线冻结） | Task 21 |
| 浏览器真实点击拼接 202（P0 终极验证）+ presign/confirm 冒烟 + PowerShell --data-raw 转义正确 | Task 22 |
| 红相实证（编译锚定两向/门禁注入违规/扫描函数自证） | Task 1/8/21 |

**近似覆盖登记：** spec 的 `isImageCompletedNode(克隆体)===false` 断言为 web util（API 侧测不了）——以 `imageGen.data.fileId === undefined` 等价覆盖（Task 3），web 侧整链路断言随 R2a 副本体系测试落地。

**R0 完成后下一步：** Plan R1（shared 真构建 + deploy.sh + nodeEnvelope 单源收编 normalizeNodeRecord/CLONE_WHITELIST + W7/W8 + 组几何收口）→ Plan R2（UI 四分片；R2b 仅剩 mediaUrl 读写收敛+门禁——客户端缓存已随 R0c 落地）。
