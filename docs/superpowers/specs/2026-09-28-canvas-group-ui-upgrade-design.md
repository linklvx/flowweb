# Canvas 组与分镜组 UI 升级（Spec A）— 设计 spec

- 日期：2026-09-28（第十轮评审修订版 v10）
- 状态：待用户审阅
- 范围：需求 1/2/3/4/8 + 组颜色 + 副本/下载/组色持久化链路根修 + 克隆崩溃/模板往返修复 + 几何/序列化单源根修（v7）+ 走私面修复（v8）+ 条件化媒体政策/部署链补全（v9）+ 走私面收敛收窄/模板读侧收敛/分镜标题布局带定死（v10）
- 姊妹篇：`2026-09-28-group-geometry-batch-connect-design.md`（Spec B 挂起，待本篇走完三阶段）
- **行号引用规则（v9 流程裁决）**：本篇行号是写作时点的证据锚，**以符号（函数/属性/测试标题）+ grep 模式为最终依据**——plan 阶段每处引用现场重验（历轮评审统计：v6→v8 枚举类错误 9 次、机制/因果类 0 次——因果分析可靠，手抄枚举是唯一反复失守点）；凡"N 处"清单在 plan 阶段用 grep 现场生成并贴命令与输出
- **推翻裁决必须清剿复述句（v10 流程规则，§4.2 残留句教训）**：任何裁决被推翻/改判时，必须 grep 全文该裁决的复述句（搜索面至少含：入框、剥离、停写、恒可解析这类裁决关键词）——v9 把智能标题改屏幕层后 §4.2 仍留着"双双入框"旧前提，即"推翻裁决时未全文搜索复述"的实例
- **交付结构（v8 裁决维持 + v9 修正三处）**：
  - **R0 事故面热修（独立发布，四分片，零基建依赖）**：
    - **R0a 克隆分表+解析器**：clone 表 group 9 键（**API 字面量 + spec 文件值导入 shared 源码 parity**——`GROUP_NODE_DATA_KEYS` 常量 **R0a 即落 packages/shared/src**（spec 值导入走 TS main 由 vitest 转译，无需构建——先例自证）；API 生产源码仍字面量，R1a 构建落地后切值导入）+ 政策断言 + `resolveStoryboardConfig`（**覆盖全部消费点**——渲染 2+store 3+NaN 2+守卫型 1，见 F2）
    - **R0b 模板三站点+schemaVersion**（同 commit）：展开式+边界归一（含 data ?? {}）+void 封死+cells 两遍重映射+ensureParentFirst+version:1 fail-closed（**含官方模板 seed 补 version + upsert 化**）；**媒体政策条件化（v9 改判）**：私有保存全量、isPublic=true 保存时过滤、跨用户导入时过滤（§4.6）
    - **R0c presign 形状（v9 收窄：仅此一项）**：`{url, expiresAt}`+服务端算剩余+客户端 `Number.isFinite` 兜底——**mediaUrl 读写全部随 R2b 与缓存同批**（v8"R0 停写防请求爆发"理由不成立：零存量下停写即触发请求、短路只保护不存在的旧节点，拿到的是混合态+请求照发；与缓存同批零混态最干净）。**登记（v10）**：dev DB 已存 data.mediaUrl 在 R2b 落地前仍是"过期 URL truthy 胜新取"破图窗口（F37 现状 bug 面，R2b 消灭——登记非修复）
    - **R0d stitch 走私修复三件套 + 5 键块删除**（同 commit，**v10 收窄：全局 ValidationPipe 删除——用户拍板**）：① storyboard DTO 升 class + 方法级 `whitelist+forbidNonWhitelisted`（走私 400 可观测，非静默剥除）+ ② **棘轮式 grep 门禁**（`@Body() any` 冻结现状基线零新增 + 新增 DTO class 端点必须显式挂 whitelist pipe——原"@Body() 必须 class"按字面实现开局全红：全仓 ~82 处中 ~40 处 inline type/any 是违规点）+ ③ service:47 改**显式 pick**（结构免疫未来加敏感字段）→ 5 键块按产品裁决删除（连带 ctor/import/mock 清理）。**全局 pipe 拆除理由（三份外部评审一致 P0，实测复核）**：presign/confirm 两个 DTO 是零 class-validator 装饰器的裸 class 且 storage.controller 无 pipe——`whitelist:true` 会把 body 剥成 `{}` 上传链**当场静默坏**；~42 处 DTO class 端点新增静默剥除面（"声明字段忘挂装饰器"→字段消失照常 200）；且 pipe 链 global→method 前输出是后输入，全局剥除使方法级 forbidNonWhitelisted 的 400 **永远不可见**——与自身"可观测"目标矛盾。"若将来开全局"的完整前置（42 端点审计+逐属性装饰器断言+forbidNonWhitelisted+四链路冒烟）**登记 R3 独立立项**。**登记：R0d 后排一次队列生产者审计**（video-separate.controller 同类——inline type body 透传+media 无 projectId 时零鉴权+nodeId 可控写目标）
  - **R1a 基建+单源**：shared 真构建（**CJS 覆写 + web 显式 Vite alias + 陈旧 dist 清障（先删后建+require 冒烟）+ 生产启动验证**）→ **deploy.sh 同 commit 补全（v9 Blocker）**：deploy_full 在 nest build 前插 shared `tsc -p tsconfig.build.json`；deploy_api 增传 packages/shared/src 并服务器构建（现 :18-24 上传 packages/ 但 --exclude dist、:33/:62 只跑 nest build、:55 只传 api/src——main 指 dist 后任何环境 TS2307 部署失败）；验收=干净目录三步构建全绿 → GROUP_NODE_DATA_KEYS 值导入切换（删 R0a 字面量）→ 节点信封单源（纯数据方案）
  - **R1b 几何与快照根修**（W7/W8 分两步，见契约 5）：快照投影（**数组形状 + 校验器/isEmptySnapshot 同 commit**）→ 删 W8 → TextInputNode 迁移 + ImageGenNode 4 处 fallback 改 → 删 W7 + 删 AppNode 几何三字段（**toAppNode 显式构造 + 写侧清单**）→ 组几何 9+2 写者收口（F33/F38 整类含 spacing 规则）→ patchGroupData（undefined=delete）→ clamp 收编 → 服务端 parentId 校验（收窄版）
  - **R2 UI 分片**：2a 选框 padding 30 + 多选工具条（**阈值 ≥2**）+ 排列（行优先）+ duplicateNodes（extent 清理）→ 2b 批量下载全链路 + **mediaUrl 读写收敛（写 5 处+桥接键+读 2 处+标识符扫描门禁，与缓存/in-flight 同批）+ 缓存键用户维度** → 2c 组工具条 + 组色（**普通组名入框；分镜智能标题走屏幕层 portal**；height 52/48）→ 2d 折叠卡 220×160 + 分镜改版（batch 预取 opt-in + in-flight + ttlSec 字段）
  - **R3 登记**（范围外具名）：其余媒体载体收敛（thumbnailUrl/images[].url/videoUrl/resultUrl）、tiptap 链路、拼接状态回写组（按 DTO 新增字段重接线）、大文件下载优化、FSA、zip
- 参考代码出处：用户需求原文提供的目标产品（Pippit）DOM 片段，视觉参数已提取进本 spec 各表

## 0. 修订总览（v6→v7→v8→v9→v10，历轮裁决沉淀；v10 为三份外部评审核实后裁决，2026-09-28 用户拍板）

**v10 六条裁决（v9 五条裁决逐条实测全部成立、维持；以下为本轮修正/新增，均经活代码复证）**：
1. **R0d 全局 ValidationPipe 删除（用户拍板）**：净收益为负——presign/confirm 裸 DTO（零装饰器）+ storage.controller 无 pipe ⇒ whitelist 剥成 `{}` 上传链静默坏；~42 处 DTO class 端点新增静默剥除面；pipe 链 global→method 顺序使方法级 forbidNonWhitelisted 400 不可见（自相矛盾）。四件套本身（DTO class+方法级 pipe+棘轮门禁+显式 pick）已完整封死走私且可观测。门禁同步改**棘轮式**（@Body() any 冻结基线零新增——按字面"必须 class"开局全红）；"开全局"完整前置登记 R3
2. **模板媒体政策补读侧收敛（第 ⑤ 点）**：v9 的保存期+导入期过滤拦不住读取——list（findMany 无 select）与 getTemplate 放行分支整行下发 templateData（含媒体 id/工作流内容/status），且 getTemplate 私有放行 OR 链（团队成员/项目协作者）比 import 的仅作者更宽。**实测前端全仓零消费 templateData**（grep 无命中；导入是服务端内部读库）⇒ **非 owner 的 list/detail 响应一律不带 templateData**——零功能损失的静态数据边界；纪律句"公开行的 templateData 等同公开载荷"（与 F21 快照端同款）；"私有链路 100% 可用"软化为"作者同团队内可解析"（残留面：A 私有模板含 C 团队媒体 → getMediaUrl 403 → 渲染期占位兜住，机制自洽）；update 翻 isPublic 无需重过滤（**读侧是唯一裁决点**，写明）；**公开→私有不可逆登记**（isPublic=true 过滤结果落库，改回私有不恢复媒体引用——可接受取舍非 bug）
3. **分镜标题屏幕层补布局规则（"同层"只给 z-order 不解决几何重叠）**：窄组（1×1=320px）上居中工具条（≥500px）与左上标题必然同带重叠。**拍板：常驻两条垂直带**——标题 `frame.top−12`、工具条 `frame.top−12−titleRowH`，无状态跳变；配 **1×1 窄组两 portal rect 不相交断言**。**必须单例共享层**（一个组件、一次 viewport 订阅、渲染 N 个绝对定位标题——N 个独立 portal 各自订阅会在 pan/zoom 每帧触发 N 次 React 更新；组工具条只渲染 1 个故无此问题）；登记 zoom 0.5/2 目视验收（屏幕层恒 13px 不随 zoom 缩放，与工具条同代价）
4. **分镜组呈现组色（用户拍板）**：convertGroup 两方向保 color 但 shell 边框不吃组色 ⇒ "设色→转分镜→看不见→转回又出现"。修法 1 行：设色时分镜 shell `border-color: var(--canvas-group-color-<key>, var(--canvas-group-border))`——双兜底现成，与保 color 设计自洽（对齐 v7"分镜工具条不加色点"的裁决不受影响——shell 视觉承载区分恰好由边框实现）
5. **§4.2 残留句清剿（v8 旧裁决复述）**："组 12（组名+智能标题双双入框后无重叠面）"前提已被 v9 推翻但句子残留——本轮改写为真实前提；并新增头部流程规则"推翻裁决必须 grep 全文复述句"
6. **三项登记**：① 缓存键 userId 用**模块级 currentUserId**（AuthProvider 写入 + 登出时与 clearMediaUrlCache() 同挂点清理）——不在 useMediaUrl 内 useAuth()（每个媒体消费点订阅 auth context 的重渲染面，零订阅方案）；② clone 路径 normalizeLoadedCanvas 断言措辞"**幂等不改变**"（clone 经 applyWhitelist spread :107 本带 width/height/position，只有模板导入真缺几何——断言写"兜底补齐"对 clone 是错误预期）；③ dev DB 已存 data.mediaUrl 在 R2b 落地前仍是"过期 URL truthy 胜新取"破图窗口（F37 现状 bug 面，R2b 消灭，登记非修复）


**v9 五条裁决（推翻/修正 v8 判断，均经活代码复证）**：
1. **分镜智能标题改屏幕层（撤销 v8"入框统一"）**：StoryboardGroupRenderer shell 是 `absolute inset:0` 网格铺满、frame=calcStoryboardSize **无标题带**——入框只剩"叠首格 caption"或"改 frame"（连带 calcStoryboardSize/拼图网格/resizeStoryboardGrid/组框不变式全动，爆炸半径远超预期）。**裁决：与组工具条同 portal 屏幕层渲染**——几何零改动、顺带消 zoom 耦合；普通组入框维持（GROUP_PADDING_TOP=50 白拿）
2. **模板媒体政策条件化（撤销 v8"保存期一律剥离"）**：私有链路媒体恒可解析（template.service:216 私有仅作者可导入 + media 创作者本人绕过团队校验 ⇒ 导入者==作者==创作者）——一律剥离让"保存→导入"主线丢图而它本 100% 可用；且 isPublic 可后改（保存期过滤不是正确边界——公开时旧行仍是全量）。**裁决：私有保存全量；isPublic=true 保存时过滤；跨用户导入时过滤（覆盖"私有→后公开"旧行）；队友媒体渲染期降级占位（useMediaUrl onError）**（**v10 修正：①②③ 拦不住读取——补第 ⑤ 点读侧收敛，"恒可解析/100%"软化为"作者同团队内可解析"，见 v10 裁决 2**）。过滤用 **9 键 clone 表**（非 snapshot 3 键表——一过 3 键表当场重造 F29）。F29 等价断言恢复**全量基准**（私有主线判别力最强）+ 跨用户过滤另立用例
3. **R0c 收窄（v8 分阶段理由被推翻）**：零存量数据下"停写 mediaUrl"即触发请求（StoryboardCell 短路只保护已存 URL 的旧节点——旧节点不存在）——v8 拿到的是"混合态+请求照发"。**裁决：R0c 只做 presign 形状，mediaUrl 读写全部随 R2b 与缓存同批（零混态）**
4. **快照形状写死数组 + AppNode 删字段补运行时 strip**：`CanvasNodeRecord[]`（id 在记录内，省键重复）；校验器/isEmptySnapshot（Object.keys 对数组=索引恒非空，空快照判不出）同 commit；恢复路径加 **toAppNode(record) 显式构造**（类型删字段≠运行时 strip——record 直喂会留多余字段进 nodeStore 与快照）；**写侧清单**（updateConfig:557 position 兜底/各 addNode 字面量/CanvasSnapshot 类型）与读侧 6 处一并列出，防 tsc 一轮红打散成多轮
5. **deploy.sh 补进 R1a（Blocker）+ R0d 升级三件套**：deploy.sh 上传 packages/ 但 --exclude dist、只跑 nest build、deploy_api 只传 api/src——main 指 dist 后任何环境部署失败（本地冒烟替代不了）；R0d = 全局 ValidationPipe（现仓零全局 pipe）+ DTO class（@Body() any 的 metatype 是 Object，全局 pipe 单加不够——class 是必需项）+ forbidNonWhitelisted（走私 400 可观测）+ @Body() 必须 class 的 grep 门禁 + service 显式 pick（**v10 修正：全局 pipe 删除、门禁改棘轮——见 v10 裁决 1；DTO class+方法级 pipe+显式 pick 维持**）

**v8 三条改判（推翻 v7 判断，均经活代码复证，v9 复核维持）**：
1. **F31 非死代码，且存在参数走私越权面（R0d 修复）**：storyboard.controller.ts:15 `@Body() body: any` 无 DTO class 无 ValidationPipe，service:47 `add('stitch', { projectId, userId, ...dto })` **尾展开**——客户端可塞 nodeId（5 键写入可达，"死代码"不成立）、更可塞 projectId/userId 覆盖服务端推导值 → consumer 按被污染的 d.projectId 取团队/建 Media 行/**写任意项目的 doc**（fileIds 归属校验用的是参数 projectId，拦不住污染后的 job payload）。v7 的"死代码"判定漏验了 controller pipe——interface 在运行时不存在，类型层干净不等于载荷干净。**处置（同 commit）：DTO 升 class + whitelist pipe 封走私 → 5 键块按产品裁决删除（理由="产品不在组上显示拼接状态 + 首发客户端不发 nodeId"，非"不可达"）→ 连带清理 ctor 注入/import/writeNodeData mock**。R3 立项"拼接状态回写"时按 DTO 重新接线
2. **F34 前提修正：nodeStore 几何读者实为 6 处非 2 处**——补 ImageGenNode.tsx:1008-1009/:1186-1187 共 4 处 `internalNode?.internals?.positionAbsolute?.{x,y} ?? node.{position}.{x,y}` fallback（内部节点未就绪时退 nodeStore；字段删除后 = undefined×zoom = NaN）。快照投影方案仍成立，但**前置迁移清单扩为 6 处**（TextInputNode + ImageGenNode 4 处改 `?? 0`，仓内正确写法先例 CanvasReferenceSelectBanner.tsx:31-33），且 AppNode 几何字段删除必须在其后
3. **shared 构建落地形态重写（v7 三 bullet 与实测不符）**：① tsconfig.base 是 `module: ESNext/bundler`——shared 直接继承必产 ESM+无扩展名导入，而 API 是 commonjs/moduleResolution:node（忽略 exports）→ 必炸，**构建必须显式覆写 `module: commonjs`**；② vite.config.ts 无 shared alias（只有 '@'）——v7"web 侧维持走 src"是事实错误，**main 一改 dist 则 web+vitest 一起切到 dist**，必须显式加 Vite alias 指 src；③ **packages/shared/dist 已存在且陈旧 16 天、types 目录缺 video-work**——main 指过去 = VIDEO_WORK_NODE_TYPES undefined + 既有 parity 断言拿 undefined 比对假绿，同 commit 必须删旧 dist 重建 + require 冒烟；④ turbo 的 api#build dependsOn shared#build 已存在，无需改。**且 shared 构建从 R0 首项移入 R1a**（R0a 用字面量+spec 值导入 parity 过渡，仓内先例零基建）

**v7 三岔路裁决（维持，v8 修正边界）**：删几何镜像→快照投影（维持，补 W7/W8 分两步与 AppNode 删字段两条边界，见契约 5）；节点信封单源（维持，**shared 侧收窄为纯数据方案**——Y.Map 适配器留两端，不为 10% 收益引入 yjs 跨实例 `instanceof` 静默失败风险）；F31 删块（理由改判，见上）。

**v7→v8 其余修正**：F2（5 处抛点非 4——其中 3 处在 store 渲染兜底覆盖不了；另 2 处静默 NaN）、F17（组名入框使 clamp 缺口显形——addToGroup/dropIntoGroup 不 clamp，子节点可落 y<50 与组名重叠）、F34/F37（枚举修正）、F38（扩类到 ungroup:863——解组同款吞尺寸）、F39（收窄：环+嵌套 fail-closed 仅导入侧，clone 保持既有降级红线，校验置于 remapIds 之后）、F41（先例实为 5 处）、契约 5（canvasSnapshot 校验器/snapshotKey 版本派生/W7W8 顺序/AppNode 删字段）、§4.2（工具条三数字定死 48/52）、§4.5（media spec 红集 6 处成员修正；batch 需 teamId+响应带 ttlSec+rewrite opt-in）、§4.6（resolver 必须覆盖 store 侧+门禁 allowlist 扩展；模板媒体政策=与 clone 同表；seed upsert）、§4.7（patchGroupData undefined=delete——convertGroup :1229 有意删键语义不可丢；几何兜底改挂 applyGroupFrame 内+normalizeLoadedCanvas）、§4.8（applyGroupFrame 以绝对 rect 定义非 relShift；buildGroupCopy/rebuildFromClipboard 登记为复制型例外）。

**v6→v7 事实错误修正（维持登记）**：F7（虚报剩余寿命 ~780s）、F9（batch 已上线）、F17（offset=12 非 28）、F26（产物是 .json）、F29（第三站点 project.service.ts:62-76）、F32（边界归一非 .nullish()）、F33（整类缺陷）、§4.5 调用点计数（11/13 解构）。

## 1. 已证实的库内事实约束（九轮评审实证）

| # | 事实 | 位置 |
|---|---|---|
| F1 | 组 data 变更须双写 nodeStore（syncGroupDataToNodeStore） | canvasStore.ts:22-28 |
| F2 | **克隆崩溃面（v9 定稿：5 处抛点 + 2 处静默 NaN + 1 处守卫型读取 = 8 个消费点）**：buildFilteredSnapshot 的 `WHITELIST.group = ['groupType','cells','name']` 剥 storyboard/collapsed/savedSize → 克隆到真实画布后：① StoryboardGroupRenderer:12（渲染）、② CanvasView:570→:629-647（选中即渲染工具条）、③ canvasStore ungroup:855、④ dropImageIntoStoryboard:973、⑤ convertGroup:1212——**③④⑤ 在 store，"渲染层兜底"覆盖不了** → resolveStoryboardConfig 必须同时被 store 消费；⑥⑦ **静默 NaN**（最难发现）：updateStoryboardConfig:1307/resizeStoryboardGrid:1332 `{...gd.storyboard,…}` 展开无 storyboard 得 `{}` → `ASPECT_RATIO_MAP[undefined]` → calcStoryboardSize NaN → 组宽高 NaN 进 doc（必红断言写法：组宽高非 NaN **且** `data.storyboard.aspectRatio ∈ 枚举`——后者才是写进 doc 的腐化）；⑧ StitchButton:86 读 `data.storyboard`（:89 truthiness 守卫不崩，但 `\.storyboard\b` 门禁会命中——**列入消费点清单避免实现者被动改**）。**快照路径不崩**（ProcessSnapshot 零 store 渲染器）；**模板路径不经白名单**（z.record 透传） | snapshot-filter.util.ts:42 |
| F3 | canvasStore 节点 data 仅桥接 5 键实时；**mainImageIndex 不在桥接键**——凡读配置一律取 nodeStore 全量 | nodeStore.ts:235/:160 |
| F4 | addEdge 只按 id 幂等；同源判重在 onConnect | canvasStore.ts:471-478/:598-604 |
| F5 | no-color-hex 只拦 Tailwind 任意值类名，style 对象/TS 常量 hex 豁免 | eslint-rules/no-color-hex.js:18-19 |
| F6 | b0 只遍历 DOMAIN_TOKENS 数组内键（漏加=假绿）；**b1-4 fail-closed 且只在 Playwright 批次跑**——深浅键集相等断言必须落 vitest | b0-token-blocks.spec.ts:261-263、b1-token-migration.spec.ts:320-332 |
| F7 | **（v7 改判）缓存命中回放写入时刻 TTL，虚报剩余寿命**：现实现命中即 return 裸字符串（:25-26），无任何时刻信息；若按 v6 存固定 `{url, ttlSec:900}`，t=839 命中仍回 900 → 客户端算 now+900s 而 URL 只剩 61s，错误窗口最坏 ≈780s——比现状（客户端不知道）更糟（知道了错的）。**正解：缓存值存绝对时刻** `{url, expiresAt}`（epoch ms），命中时服务端算 `remaining`，≤0 重新 presign 覆写（详见 §4.5） | media.service.ts:24-31 |
| F8 | fullscreen viewer 直用内存 displayUrl（长开页面可能已过期），带本地 downloading 守卫 | ImageFullscreenViewer.tsx:62-82 |
| F9 | **（v7 改判）batch 端点已上线**：POST /api/media/batch 已挂载（TTL 3600s），消费方 3 处（useWorkflowAssets.ts:32、shadowJob.ts:31、VideoEditNode.tsx:109）；仅 batchGetMedia 缺 /flowai rewrite（mediaApi.ts:21-24）——折叠卡预取只剩 1 行 rewrite 距离 | media.controller.ts:30-34、media.module.ts:14 |
| F10 | repairStoryboardCells 把不在 cells 的 storyboard 子节点 stray 停放组下方——副本必须重映射 cells（buildGroupCopy :1468 先例） | groupDerive.ts:26-41 |
| F11 | 全部既有程序化几何写入点均绕过 nodeStore 镜像（groupNodes/ungroup/addToGroup/dropIntoGroup/removeNodeFromGroup/mergeStoryboard/convertGroup×2/resizeStoryboardGrid/clearStoryboard/addImageToStoryboardCell/removeStoryboardCell/refitGroupBounds/toggleCollapse——以 grep 为准）；**另两类（v7 补，v8 修措辞）**：ImageGenNode.tsx:301/:709 用 RF `setNodes(n => ({...n, width, height}))` 写尺寸（写的是 RF 侧——**是否回写 canvasStore 取决于受控同步路径，未实证**，勿当已证事实引用）；repairStoryboardCells 经 applyGroupDerivations 改 position。**快照投影方案（契约 5）下这些点全部不再是 bug 面**（几何真值=canvasStore，该路径在新设计下反而变正确） | canvasStore.ts、ImageGenNode.tsx |
| F12 | copyNode 死代码（接口声明 :111 + 实现 :277 + 4 处测试，零生产调用；删除时两处一起删） | grep 证实 |
| F13 | duplicateGroup 无 stopCapturing——"单 undo 步"现状靠 captureTimeout=500 共享常量巧合（**修法是入口显式 stopCapturing()，不动 captureTimeout**） | canvasUndo.ts:13-27 |
| F14 | B-2 顺序纪律：canvasStore 结构 set 先于 nodeStore 写入 | canvasStore.ts:229 注释 |
| F15 | multiImageGen 无节点级 fileId，主图 = `images[mainImageIndex]?.id`；主图可能非 success；mainImageIndex 可为 -1 | MultiImageNode.tsx:81/:105 |
| F16 | 分镜组右上角已有 `data.name` 标签；工具条 storyboard 分支无 转普通组/解组 按钮 | StoryboardGroupRenderer.tsx:57-59、GroupToolbar.tsx:69 |
| F17 | **（v7 改判，v8 补缺口）TOOLBAR = { height: 40, offset: 12 }**——v6 所引"offset 28"是 TextNodeToolbar.TOOLBAR_MARGIN，与组无关。**真正的结构性约束**：普通组组名浮层在流坐标（随 zoom 缩放，占组框上缘外 ~[-10,-30] 流 px @zoom1），工具条 offset 是屏幕常量。**v7 拍板：组名行移入组框内顶部**（几何 GROUP_PADDING_TOP=50 本就是组名预留区），工具条 offset 回常量 12。**v8 补：组名入框使 clamp 缺口显形**——clampPositionToPadding 只在 onNodesChange 跑，addToGroup/dropIntoGroup 直接算 rel 从不 clamp → 拖节点进组顶部会落 y<50 与框内组名重叠。**修法：clamp 收进唯一写者 applyGroupFrame**（§4.8，成本≈0）；GROUP_PADDING_TOP=50 **不得顺手调整**（已进存量几何）。**v9 改判：分镜智能标题不入框、走屏幕层**（shell `inset:0` 网格铺满、frame=calcStoryboardSize 无标题带——入框=叠首格或改 frame 连带网格/resize/组框不变式全动；与组工具条同 portal 渲染，几何零改动且顺带消 zoom 耦合，窄分镜组与 ~700px 工具条的水平碰撞同层解决） | selectionTokens.ts:38、NormalGroupRenderer.tsx:44/:89/:95、groupLayout.ts:8 |
| F18 | convertGroup 两分支整体重建 data（storyboard :1204 自动名 / normal :1218 硬编码'分组'——两方向都丢用户侧字段）；**同点位伴生缺陷 F38**（覆盖子节点尺寸） | canvasStore.ts:1204/:1218 |
| F19 | StitchButton 现文案 `拼接(${resolution})` 值 '2K'|'4K'，与服务端 VALID_RESOLUTIONS 大写键联动——**不可改小写** | StitchButton.tsx:189、storyboard.constants.ts:3 |
| F20 | **改判（v4 拍板，维持）：克隆剥媒体引用是安全政策非缺陷**——Media.teamId 非空外键 + getMediaUrl 非 creator 走 assertTeamMember 异团队 403；克隆跨用户必破图。**判据：是媒体引用则剥（fileId/mediaUrl/referenceImage/images 内 id），非媒体结构则留**（cells 是节点 id、storyboard 是配置，无鉴权面） | media.service.ts:15-21、prisma/schema.prisma:324 |
| F21 | clone/snapshot 共用一张 WHITELIST，但消费端契约不同：clone→真实画布需全字段；snapshot→ProcessSnapshot 只认 groupType/name——snapshot 端"collapsed/storyboard 剥离"是刻意载荷收敛，不应顺带推翻 | snapshot-filter.util.ts:33/:42 |
| F22 | 展开态普通组无 border（仅背景 div，测试断言 `border===''` 是设计意图）——组色边框着色载体需本次新增 | NormalGroupRenderer.tsx:59-65 |
| F23 | 宫格文案已实现且为 `宫格 {rows}×{cols}`（照抄既有） | GridSizeDropdown.tsx:56 |
| F24 | GroupContextMenu 仅 创建副本/复制/粘贴/删除，**无重命名**——折叠态重命名无入口 | GroupContextMenu.tsx:95-111 |
| F25 | parity 跨包不可直接实现：API 不能 import web 源码；正解先例 = 常量下沉 packages/shared | packages/shared/src/types/video-work.ts:74 |
| F26 | **（v7 补正）registry 生成器是 canvas-migration-registry.mjs，产物是 apps/web/e2e/audit/canvas-migration-registry.json**（mjs:99/:114）——正确动作是重跑生成器 + 在 differExpectedPairs/adjudications 裁定新 site 增量；四个手工键（mjs:88-113）是设计保留，重跑不丢 | apps/web/scripts/canvas-migration-registry.mjs |
| F27 | clone 的 remapIds 只重映射 group.cells（悬空→null）；video-work-clone.service.spec.ts:21 组夹具无 storyboard（修白名单后需补，否则崩溃面无覆盖） | video-work-clone.service.ts:52-78 |
| F28 | 分镜组三个子组件硬编码 #fff/#666/#aaa（style 对象豁免 lint 但嵌新容器会"新瓶旧字"） | AspectRatioDropdown/GridSizeDropdown/StitchButton |
| F29 | **（v7 改判：3 处列举式 + 信封 5 份漂移）模板往返剥离组结构**：导出侧 canvas.service.ts:77-79 与导入侧 template.service.ts:242-246 各一份 4 键手抄本（parentId/width/height 丢；cells 无重映射）之外，**漏了真正写 doc 的第三处 project.service.ts:62-76**（fillDoc 的第三份手抄本，且它认 parentId/width/height——但喂给它的 cleanNodes 已被 :245 剥）。同一个"节点信封"在仓里有 **5 份**（ydocBuilder.fillDoc:28-44、readCanvasFromDoc:54-68、collab-document.readDocCanvas:61-79、project.service:62-84、storeProjection:59-74 + useCanvasPersistence 快照）——F29 就是它们漂移的产物。**根修=节点信封下沉 shared 单一模块**（§4.7），三处站点展开式是止血、单源才是根。**position 亦是活雷（F32 推广）** | 同左 |
| F30 | **GroupNodeData 类型仅 5 键且 extends Record<string,unknown>**——索引签名使 keyof = string\|number，v4 idiom 恒真/恒红两向不可用；正解=拆无索引签名 Shape。使用点仅 2 处 Props 注解；**编译面以 `tsc --noEmit` 全绿为准**（worktrees 副本使计数失真）。v7 起 `& Record<string, unknown>` 交叉的存留理由**只剩 RF Node data 约束**（F31 删块后无"服务器 5 键流入"论据） | types/group.ts:14 |
| F31 | **（v8 改判：非死代码——可达，且同一入口存在参数走私越权面，v9 精确化攻击链与修复三件套，v10 收窄去全局 pipe）**：storyboard.controller.ts:15 `@Body() body: any`（无 DTO class、无 ValidationPipe，**main.ts 只有 filter+interceptor 零全局 pipe**）+ storyboard.service.ts:47 `add('stitch', { projectId, userId, ...dto })` **尾展开** → ① nodeId 有生产者（任意客户端 POST 即可）——"死代码"不成立，只是首发客户端不发；② **走私面（真 IDOR）**：攻击链=对 URL 项目有 editor 权 + fileIds 属该项目（:17/:39-46 校验用**路由来的可信 projectId**）→ body 塞 projectId=V/userId=X → **job payload 里装的是攻击者的值**（校验对象与被使用对象分离——这正是漏洞成立的原因）→ consumer 按被污染的 d.projectId 取团队/建 Media 行/**写 V 的 doc**。**处置（R0d 三件套，同 commit；v10 全局 pipe 删除）**：① storyboard DTO class + 方法级 `whitelist+forbidNonWhitelisted`（走私 **400 可观测**，非静默剥除——告警可挂钩）+ ② **棘轮式 grep 门禁**（`@Body() any` 冻结现状基线零新增 + 新增 DTO class 端点必须显式挂 whitelist pipe——v9"@Body() 必须 class"按字面实现开局全红：全仓 ~40 处 inline type/any 违规）+ ③ service:47 改**显式 pick**（结构免疫未来加敏感字段）→ 5 键块按**产品裁决**删除（勿写"死代码"误导后人）→ 连带清理：consumer 的 collabDoc 仅 :114 使用（import :5/ctor :33/使用 :114 三处一起删）、stitch.consumer.spec.ts:46 writeNodeData mock（writeNodeData 另有 4 个真实调用方，不孤立）。**全局 pipe 为什么不装（v10 实测）**：presign/confirm 裸 DTO + storage.controller 无 pipe ⇒ whitelist 剥成 `{}` 上传链静默坏；~42 处 DTO class 端点新增静默剥除面；pipe 链 global→method 使方法级 forbid 400 不可见——完整前置登记 R3。**同类审计登记（v9）**：video-separate.controller:16-24（inline type body 透传 + media 无 projectId 时零鉴权 + nodeId 可控写目标——userId 在尾不可覆盖非同款 IDOR，但同类面）→ R0d 后排一次**队列生产者审计**（**v10 补可 grep 判据三条**：@Body() 参数非 class / 端点无鉴权且 body 含写目标 / 队列 payload 由 body 尾展开构成——审计可复用不靠记忆）。R3"拼接状态回写组"立项时**按 DTO 新增字段重新接线**（非"恢复死代码"） | storyboard.controller.ts:15、storyboard.service.ts:47、stitch.consumer.ts:113-121、main.ts:89-90 |
| F32 | **（v7 改判：正解=导出边界归一，非 .nullish()）**：readCanvas 输出 parentId/width/height 恒存在、无值时为 **null**（`?? null`）；position/data 可为 **undefined**（`?.toJSON()`）。**position 同为活雷**：NodeSchema 必填，异常路径 undefined 透传 → save 抛 BadRequestException——F32 从"3 个字段"推广到整个节点信封。修法：**展开式导出 + 边界归一**（null→undefined——JSON.stringify 时键消失，模板 JSON 无 null；position undefined→{x:0,y:0}；**snapshot-filter.util.ts:104-107 仓内已有同款先例**"类型不撒谎"）+ NodeSchema 三字段 `.optional()`、position 保持必填（缺=fail-closed 400）。**同 commit 原子性**：展开式+归一化+schema 改动必须同一 commit（当前 payload 预缩减，三键不存在）；"save 不抛错"必红用例**必须针对展开后代码编写**（展开前写它恒绿、失去判别力） | collab-document.service.ts:67-71、canvas.service.ts:77-92 |
| F33 | **（v7 改判：整类缺陷，非 convertGroup 专属）"重算组原点不补偿子 rel"**：calcGroupBounds 输出 = bbox − padding{20,50}（groupLayout.ts:54-57）；refitGroupBounds(:1285-1301) 只改组原点不动子 rel → **不动点条件 = min(rel) == {20,50}**，groupNodes(:832) 构造时恰好满足所以平时看不出。同型缺陷三处（spec v6 只抓了其一）：convertGroup:1222→1227（整体平移 −20/−50）；**addToGroup:890→901**（child rel 用旧组原点算完、组原点改新 bounds → 既有成员整体平移 δ）；**dropIntoGroup:942→953**（同型，且 :938 折叠态先 toggleCollapse 内部再 refit → 链式漂移）。**守恒式 refit（改组框同时平移子 rel，子绝对坐标不变）让契约 2 的不变式第一次真正可满足**——配套属性测试见 §5 | canvasStore.ts:890/:901/:942/:953/:1222/:1227/:1285-1301 |
| F34 | **（v7 新增，v8 修正前提：几何读者 6 处非 2 处）几何镜像消费面（契约 5 重写的证据基础）**：nodeStore 几何生产消费点——useCanvasPersistence.ts:105（快照序列化）、TextInputNode.tsx:29-30（文本节点渲染）、**ImageGenNode.tsx:1008-1009/:1186-1187 共 4 处 `internalNode?.internals?.positionAbsolute?.{x,y} ?? node.position.{x,y}` fallback**（内部节点未就绪时退 nodeStore——字段删除后 = undefined×zoom = NaN，必须先改 `?? 0`；仓内正确写法先例 CanvasReferenceSelectBanner.tsx:31-33，其 :28 注释明写"nodeStore 节点无 measured/internals"）；协作同步 storeProjection（canvasCollabRuntime.ts:59-74）几何**全部取 canvasStore**、nodeStore 只供 data；undo 是 Y.UndoManager over doc maps。两处"旧镜像"实为 onNodesChange 内联 setState（:546-560 dimensions 门 setAttributes、:561-578 TD-Pos），全仓无独立镜像订阅。**反面确认（去风险）**：selected/hidden 不依赖这两处镜像。**W7/W8 不等价（v8 边界）**：W8（position）删掉由投影完全覆盖；W7（dimensions 门 setAttributes）按 RF 源码只有 NodeResizeControl 拖拽帧携带——尺寸真值本就落 canvasStore（applyNodeChanges 写 node.width），W7 仅在投影未落地/TextInputNode 仍读 nodeStore 时是断点 → **先落投影+迁移读者，再删 W7，配红转绿用例**（契约 5） | 同左 |
| F35 | **（v7 新增）fillDoc 丢 parentId——崩溃恢复把组拍平（真 bug）**：AppNode 无 parentId（nodeStore.ts:179-188），fillDoc 读 `n.parentId`（ydocBuilder.ts:33）恒空；initCollab:242 fillDoc 只喂 snap.nodes/snap.edges **不传 parentMap**（快照里明明有）→ 离线/崩溃恢复种出扁平 doc → synced 后 applyDocToStore() 用 doc 覆盖 store → **组结构丢失**。快照投影方案（契约 5）把 parentId 直接放进快照节点，此 bug 同时消失——这正是 v6"离线镜像生效"断言本该覆盖的面 | nodeStore.ts:179-188、ydocBuilder.ts:33、canvasCollabRuntime.ts:242 |
| F36 | **（v7 新增）API 生产源码禁值导入 shared**：admin.guard.ts:3-5 与 video-project.service.ts:20 双双写死禁令（"纯 TS 源码包，Node 运行时 require 一个 .ts → ERR_MODULE_NOT_FOUND"）；shared `main: ./src/index.ts`、`build: tsc --noEmit` 不产出（package.json:5/:8）；apps/api 现有 4 处 shared 导入全是 import type；唯一值导入先例在测试文件（snapshot-filter.util.spec.ts:5，注释明确豁免）。**v6 §4.6 让 API 源码展开 `[...GROUP_NODE_DATA_KEYS]` 会当场卡死——必须先做 shared 构建（岔路 3，v8 裁决移 R1a；R0a 用字面量+spec 值导入 parity 过渡）** | 同左 |
| F37 | **（v7 新增，v9 修正枚举/规则范围/时机）presign URL 被持久化且短路优先**：**写点 5 处（含 1 处 nodeStore 双写）**——canvasStore.ts:1000/:1122/:1380（+双写 :1383）+ CanvasView.tsx:177-183 素材库拖入（`nodeData = {…mediaUrl: file.url…}`——字面量名是 nodeData 无 `data: {` 模式，模式匹配门禁必然假绿）；另有**第 4 条写入通道：CANVAS_BRIDGE_KEYS 含 mediaUrl（nodeStore.ts:235）——任意 updateConfig(id,{mediaUrl}) 经桥写入 doc**。`.mediaUrl` 读者仅 2 处：StoryboardCell.tsx:19-20（过期持久化 URL 短路赢过新取的）与 GroupNode.tsx:52（ImageThumbnailBar/ImageMentionList/PromptInput 读的是 ImageItem.url，非 mediaUrl）。**规则收窄**：本篇规则="node data.mediaUrl 不再写入/读取"；其余载体具名登记 R3（thumbnailUrl/images[].url/videoUrl/resultUrl）。**时机（v9 改判）**：读写收敛**全部随 R2b 与缓存/in-flight 同批**——v8"R0 停写防请求爆发"理由不成立：零存量下停写即触发请求（短路只保护已存 URL 的旧节点，旧节点不存在），R0 拿到的是混合态+请求照发 | 同左 |
| F38 | **（v7 新增，v8 扩类）"组解散类命令覆盖子节点尺寸"整类**：convertGroup→normal :1223 与 **ungroup（storyboard 分支）:863** 同款——都把图片节点强制 `width: CELL_WIDTH, height: cellH`，用户调过的尺寸丢失。**按类修、按类测**（与 F33 同款处理）：两处都改"保留子节点自身尺寸、只重排位置"，各配修复前必红用例 | canvasStore.ts:1216-1225/:858-866、groupLayout.ts:4-8 |
| F39 | **（v7 新增，v8 收窄）服务端 parentId 校验政策须与既有契约对齐**：悬空/成环/嵌套组只在客户端拦（canvasStore.ts:814/:885/:937）。**但 clone 侧已有"降级不抛"红线**（video-work-clone.service.ts:50-51"悬空 id 是可达真实状态…一律不抛"、:63 parentId 降级 null）——悬空在本仓是**刻意合法**的状态（只来自服务端剥除 shadow/videoEdit 的路径；RF Delete 键级联删子 + 4 处顶层化同清 parentId，客户端数据不可能产出悬空）。**v8 裁决分两档**：**导入侧 fail-closed 400**（模板是信任边界，环→400、嵌套组→400、悬空→400）；**clone 侧只检环**（环会真的把 RF 挂死）+ 嵌套组走既有 degrade+日志，悬空不检。**校验阶段必须 = remapIds 之后**（remap 输出只可能是"新 id 或 null"，天然无悬空；挂 readCanvas 之后则历史悬空会让"能打开的画布"克隆失败） | 同左 |
| F40 | **（v7 新增）排列顺序未定义**：sortNodesByPosition 是 x 优先（列优先，groupLayout.ts:48-51），grid 排列会按列铺开——排列命令必须显式定义顺序口径，否则 UX 不可复现、无法验收。**v7 拍板：排列参与项排序 = 行优先 y→x（y 容差 8px 分行、行内 x 升序），新增 sortForArrange 纯函数**——不复用列优先（那是 mergeStoryboard 的宫格序，语义不同） | groupLayout.ts:48-51 |
| F41 | **（v7 新增，v9 修正计数）extent 清理先例实为 6 处**（grep `extent: undefined` 证实）：groupDerive.ts:38、canvasStore.ts:872/:920/:1022/:1085/:1338——全部在顶层化同时清；而 hydrateNodes 只加不清（nodeOrder.ts:43-45）——顶层化不清 extent 不会自愈（节点被旧父 extent 夹住）。**R2a duplicateNodes 的 detached 副本顶层化必须带 `extent: undefined`** | 同左 |

## 2. 需求清单（本篇）

| # | 需求 | 关键口径（历轮拍板/实证后） |
|---|---|---|
| 1 | 多选虚线框 padding 16→30px | 五值直接照抄 |
| 2 | 多选工具条：`[排列▾] │ [创建副本] │ [打组▾] [批量下载] │` | 排列=排除 detached+提示；副本全链路保真；**显示阈值=选中 ≥2（v8 改判，维持现状语义）**——≥1 会与组工具条（恰好单选组时显示，CanvasView:443-453）双工具条同锚点冲突，且单选普通节点出现"多选"虚线框违反语义；SelectionBoxOverlay.test.tsx:41-46 现状断言保持 |
| 3 | 组工具条：`[颜色点] [排列子节点▾] │ [折叠] [整组执行] [转分镜组] [解组] │ [批量下载]` | 组色语义 key；展开态新增 1px 边框；**组名入框（F17 拍板）**；**分镜智能标题走屏幕层 portal（v9 改判——shell 无标题带入框会改 frame）** |
| 4 | 折叠宫格预览卡 220×160 | 尺寸单源；**expiresAt 绝对时刻缓存根修（F7 v7 正解）**+ batchGetMedia 预取 |
| 8 | 分镜组视觉 + 工具条 | 白名单**分表**；**resolveStoryboardConfig 覆盖渲染+store 全消费点（F2 v8）**；智能标题**屏幕层（v9）**；**storyboard 工具条补批量下载**（v7 裁决：收集集=cells 的 fileId；不加色点——shell 视觉已承载区分） |

## 3. 跨篇契约与不变量（Spec B 共同遵守）

1. **坐标不变式**：任何选中集合动作先区分成员容器；子节点一律以 `abs = parent.position + rel` 参与运算。选区归一化两段式：`normalizeSelection(nodes, ids) → {groups, looseRoots, detachedChildren}`（纯函数显式传 nodes）+ `participation(bucket, action) → {ids, excluded: {detached, hidden}}`（逐动作策略表：排列排除 detached；下载/副本/+号源集[B] 全纳入；副本排除 hidden；B 行占位 B 审核时定）。**返回 excluded 计数供 toast 文案组装**（"N 个未参与"= detached ∪ hidden 合并计数）。策略表是唯一裁决点，防散落 if。**下载收集集显式定义（v7 补正文）= participation('download')：三桶全展开，detached 与 hidden 均纳入**（hidden 是折叠组/分镜组子节点，整组下载语义）。
2. **组框不变式（scope 限定）+ 守恒式 refit（v7 定稿，v8 改绝对 rect 接口）**：`组框 ≡ bbox(成员)+四向 padding` 仅适用于 `normal && !collapsed && !manuallyResized`；折叠态几何恒为 COLLAPSED_SIZE、手动组保留用户尺寸——两者是显式例外。门禁抽纯函数 `shouldAutoRefit(group)` 三处同源消费。**refitGroupGeometry 接口以绝对 rect 定义（v8）**：输入子节点绝对 rect 集合，输出 `{frame, 每子 rel = abs − frame.origin}`——**不引入 relShift 概念**（groupNodes/mergeStoryboard/dropIntoGroup 等无"既有 rel"可 shift，套 relShift 会各长特例分支，正是收口要消灭的）；守恒性退化为一条**可测断言**（"重算型调用下子节点绝对坐标不变"）而非接口形状。这是契约 2 不变式第一次真正可满足（现状 refitGroupBounds 在 min(rel)≠{20,50} 时整体平移子节点，见 F33 整类定性）。
3. **原子块定义**：组在排列/副本中 = stored rect（折叠=COLLAPSED_SIZE、分镜=calcStoryboardSize）；**detachedChildren 排列时排除不动 + toast 提示**（排列是几何命令不拥有改变成员关系的能力；脱离只发生在 removeNodeFromGroup/ungroup/dropIntoGroup 三个带守卫入口）；**副本中 detached 一律顶层化**（parentId=undefined + 绝对坐标 + offset + **extent=undefined**——F41，六先例同款）。
4. **手动尺寸策略**：A 的排列子节点=显式几何命令，清 `manuallyResized`（经 patchGroupData 唯一通道——data 变更非几何面）；B 的拖动口径在 B 审核时定。
5. **几何与快照单源（v7 裁决：快照写入期投影；v8 补四条边界）**：
   - **几何真值唯一在 canvasStore**（协作 storeProjection / undo / DB 路径本就如此——F34）；nodeStore 的几何字段**直接删除**（见"AppNode 删字段"），不是"保留但不再维护"——留着没人维护又没人知道的字段，下一个人读 `ns.nodes[id].position` 拿到快照前的旧值，正是本轮要根除的 bug 类
   - **快照写入**：useCanvasPersistence 定时器内改存 `projectCanvasNodes(csNodes, nsNodes)` 输出（**CanvasNodeRecord[]，v9 写死数组形状**——id 在记录内省一份键重复；校验器/isEmptySnapshot/hydrate 三处实现随形状定）；**parentMap 侧信道删除**；`projectCanvasNodes` 为纯函数显式传参，storeProjection/快照/fillDoc 种子三处共用
   - **快照四处一致性（v9 补 isEmptySnapshot，实现者必踩）**：① **canvasSnapshot 校验器同 commit 改**——isValidPayload 现显式拒数组形状（`Array.isArray(s.nodes)` 拒收），新形状若先落盘后改校验器 = loadSnapshot 静默删 key，崩溃恢复整体失效且零报错；② **snapshotKey 由版本派生**（`flowweb_canvas_v${SNAPSHOT_VERSION}_${projectId}`）——现状 key 字面 `v2_` 与版本常量分离，若 key 改 `v3_` 而 OLD_KEY_PATTERNS 仍是 `(?!v2_)`，新 key 会被自己的清扫器命中、每次挂载静默删除快照；③ **isEmptySnapshot 同 commit**（v9 补：`Object.keys(s.nodes)` 对数组形状返回索引恒非空——空快照判不出，恢复守卫失效）；④ **hydrateNodes 的 parentMap 形参删除**（不是"不再传"）——留着形参，F35 会以"有人又传了个 parentMap"的形式复发
   - **SNAPSHOT_VERSION 2→3**（无存量数据，旧快照自然失效不迁移）；恢复路径：record[] → canvasStore（parentId 直接来自 record）+ nodeStore（**经 toAppNode(record) 显式构造 `{id, type, data}`**——v9 补：类型删字段≠运行时 strip，record 直喂会留多余字段进 nodeStore 与下一次快照；恢复/双写路径统一走它）
   - **initCollab fillDoc 直接吃 record[]**（含 parentId）→ **修 F35**。**可达性收窄（v8，决定测试口径）**：仅当结构从未进过服务端 doc（未同步窗口/离线+崩溃）才真丢——服务端 doc 有 parentId 时 Yjs 按 key 合并会保留；**测试模拟"快照独有结构"而非"有快照即丢"**，并配反例：故意让快照缺失 parentId，断言恢复后组结构确实丢了（证明正向断言非恒真——悬空 cells 同款判别力手法）
   - **W7/W8 分两步删（v8 边界，两者不等价）**：第一步——落快照投影（取 `width ?? measured.width`）+ TextInputNode 改 `useInternalNode(id)` + ImageGenNode 4 处 fallback 改 `?? 0` → **删 W8（:561-578 TD-Pos）**（投影完全覆盖）；第二步——配**红转绿用例**（resize 文本节点→写快照→重建→尺寸保持；TextInputNode.test.tsx:45-48/:280-286 的 mock measured 400×350 改实测断言）后 **删 W7（:546-560 dimensions）**。W7 是文本节点 resize 尺寸进 v2 快照的现行载体——投影未落地前删它 = 手动 resize 后快照丢尺寸
   - **AppNode 删几何三字段（R1b，v8 裁决 + v9 补写侧清单）**：position/width/height 从 interface 删除——**读侧 6 处**迁移完成后 TS 指出残留读者；**写侧同 commit 清单**（v9 补，防 tsc 一轮红打散成多轮）：nodeStore updateConfig 内 `position: existing?.position ?? {x:0,y:0}` 兜底（删字段后此行必改——它也是 F34"W7 是 resize 尺寸唯一载体"的另一半：updateConfig 重建记录丢宽高）、各 addNode 调用点的 position 字面量、CanvasSnapshot 类型（nodes: Record→数组后 AppNode 引用同步换 CanvasNodeRecord）、canvasSnapshot isValidNode（position 作合法性判据）。删字段后残留读者是**编译错误**（比 v8"undefined×zoom=NaN"表述更准——NaN 风险只存在于"先停写、后删字段"中间态，v9 顺序保证不经过该中间态）
   - **删两处旧镜像的精确范围（防误删邻居块）**：clamp 块 :529-544、cascade 调用 :518-520、`return { nodes }` :579、remove 三件套 :582-591 均**不在**删除面（clamp 块将随 §4.8 收编进 applyGroupFrame 而非原地保留）
   - **测试迁移面（v8 补全）**：canvasStore.test.ts:425（TD-Pos）；page.test.tsx:18/:71/:72 mock 面复核；useCanvasPersistence.test.ts:127-154"快照无宽高"重写；**canvasSnapshot.test.ts:31-33（SNAPSHOT_VERSION===2 与字面 key 断言）**；**useCanvasPersistence.test.ts:78-79（快照键集恰为五键+parentMap 内容断言）**；**canvasSnapshot.test.ts:13-51（5 条 parentMap 用例）**；**__tests__/useCanvasPersistence.test.ts:9/:44/:50（V2_KEY 与清扫用例）**；useCanvasPersistence.ts:58"对齐 DB 加载路径 loadProjectIntoStore"注释修正（page.tsx:45-67 实际只取项目名/teamId 后走 initCollab，无 REST 节点加载路径）
   - **收益清单（v6 契约 5 全部字面约束随之消失）**：镜像 hook、拖拽整轮跳过、onNodeDragStop flush、"resizing 不节流"绑定契约、isHydrating 跳过、离线镜像断言、CANVAS_BRIDGE_KEYS 防死循环、双 store 相等收口线、B 交界节流、库假设测试——F11"程序化写入绕过镜像"整类 bug 从根上消失
   - **undo 组合用例**：`um.undo()` 后 store 重建走 onRemote → applyDocToStore（origin 非 LocalUser），与"hydrating 期间零写入"组合测一条

## 4. 详细设计

### 4.1 多选虚线框（需求 1）

`SELECTION_BOX.padding: 16 → 30`。测试几何断言直接照抄（left/top 减一次、width/height 加两次）：194→180、352→338、132→160、164→192、翻转 68→84。

### 4.2 Token 与门禁（前置，R1）

- `TOOLBAR` 拆 `SELECTION_TOOLBAR={48,14}` / `GROUP_TOOLBAR={52,12}`（**v8 数字自洽定死**：容器 padding 8×2 + 按钮 h-8(32px)=48 / h-9(36px)=52——v7 的 {40,44} 与 padding 8+按钮规格矛盾会溢出 8px；现状 GroupToolbar.tsx:54（padding '8px 16px'+height 40+按钮 ~30px）本就隐性溢出 6px 靠无边框掩盖，本次一并修正。offset：多选 14 维持、组 12（**普通组组名入框 + 分镜标题与工具条屏幕层分带后无重叠面——v10 改写：v9 已裁决智能标题不入框，v8"双双入框"旧前提随之作废**，F17/§4.4）。
- index.css **在既有唯一双块内**追加（不得另起块，b1-4 硬红；落点具名：深块尾 :58 前、浅块尾 :102 前，不得落入 :126 几何常量块）：`--canvas-storyboard-shell-bg`（#212121/#f7f8f8）、`--canvas-group-border`（深 #3a3a3a / 浅 #9ca3af，拍板维持 v6——Node 实测：浅 2.33:1 vs 板面 / 2.25:1 vs 组内底 / 深 1.85:1 vs 深板面 #000，系统既有档位零新增色；与 --fw-border 的 #e5e7eb **刻意不同色**（组框无阴影单载波，统一回去=1.12:1 不可见——注释写死）；台账如实登记 2.33/2.25 为分离度观测行（specExpect 留空+注明"B6 目检裁定"）；**回退指令预登记**：目检不可辨→浅 #8e9298（实测 2.87:1）+深 #595959（实测 3.00:1），回退两值同步双块+b0 表+pair 重跑）、组色板 7 支 `--canvas-group-color-{red,orange,yellow,green,cyan,blue,purple}`（**深浅两档都要给值**——v6 只给浅档深色变体违反"禁手填"自设规则：浅档深色变体（黄→#a16207 系）保 ≥3:1 vs 亮板 #F5F5F5；**深档取 400 系亮变体（red→#f87171 族）保 ≥3:1 vs 深板 #000——两档 14 值全部以 contrast-table 首跑实测登记台账，禁手填**）。可见性冗余通道：组名浮层恒显示（组名入框后更稳）+ 组节点 aria-label 补齐——分组信息由 边框+名字+选中手柄+组色 四通道承载。
- **文字不使用组色**；组色载体 = 组框边框 + 色点 + 徽标**描边**（防黄/青底白字不可读）。
- 门禁：b0 `DOMAIN_TOKENS` 数组加 9 键+DARK/LIGHT 值（补"新键在迭代列表内"断言）；**深浅域键集相等断言落 vitest**（b1-4 只在 Playwright 批次）；registry（F26）：`node scripts/canvas-migration-registry.mjs` 重跑 + 新 site 增量在 differExpectedPairs/adjudications 逐条裁定；`css-baseline-diff` 的 D 段配对是闸门真源。

### 4.3 多选工具条（需求 2，R2a/2b）

**视觉规格**（同 v6）：容器 padding 8 / gap 8 / 圆角 12 / 0.5px 边框 `--canvas-controls-border` / 背景 `--canvas-controls-bg` / 阴影 rgba(0,0,0,0.08) 0 4px 10px / blur 16；定位选框上缘中点 `translate(-50%,-100%) translateY(-14px)`；按钮 h-8 / px-2 / 圆角 8 / 13px / controls-text / hover controls-hover；下载 32×32 图标钮（aria-label=批量下载）；分隔线 1px controls-border；排列菜单浮层同容器视觉 min-width 120px 三项；徽标"N 项"留选框左上角。

**定位水平夹取（v7 新增——工具条加排列/下载后加宽，靠边/窄组会溢出视口）**：定位纯函数加水平 clamp——`clampToolbarX(centerX, toolbarW, viewportW, margin=8)`：超左缘右移至 margin、超右缘左移；纯函数单测。垂直 isAbove 维持现状。

**浮层交互定义（v7 新增，排列菜单/打组下拉/色板共用规格）**：click 触发 toggle；点外关闭（mousedown outside）；Esc 关闭；触发钮 `aria-expanded` + 浮层 `role="menu"`/`role="menuitem"`（色板为 `role="listbox"`/`option` + `aria-selected`）；浮层内交互元素带 `nodrag nopan`（NormalGroupRenderer.tsx:69 先例——组框内新元素必须带，防拖拽穿透）。组件测试覆盖开关与 aria。

**arrangeSelection(mode)**：
- 参与集 = `participation`：groups（原子块 stored rect）+ looseRoots；**detachedChildren 排除且不参与任何几何计算（含中心锚定——中心只用参与项包围盒）**
- 参与项 <2 → no-op + 提示"没有可排列的节点：所选节点均在未选中的组内"；有排除时 toast："N 个组内节点未参与排列（需调整请先选中其所在组）"——N = excluded 的 detached ∪ hidden 合并计数（契约 1）
- **参与项排序 = sortForArrange 行优先**（F40：y 容差 8px 分行、行内 x 升序——新增纯函数，不复用列优先 sortNodesByPosition）
- `arrangeRects(rects, mode)`：grid 列数 calcDefaultGrid(n)（n=2 时 1×2≡horizontal 属预期）；ARRANGE_GAP=60；cell=行 max 高×列 max 宽、节点按 cell 左上角落位（自身尺寸不变）；n≤1 no-op；包围盒中心不变
- 写回：looseRoots 绝对 position、groups 组 position——**几何真值在 canvasStore（契约 5），快照/协作投影自动取用，无需任何同步动作**；单次 setWithParentOrder；排后 applyGroupDerivations + 保持原选区
- **反向断言：排列前后全体节点 parentId 分布逐节点相等**（防脱离语义回潮）；极端混选留白属预期（组 642×362 + 节点 300×300 同排）

**duplicateSelection() → duplicateNodes(ids, offset)**（R2a）：
- 闭包 = 三桶全展开，**participation('duplicate') 排除 hidden**（分镜组子节点 rel 恒 {0,0}——不排除则顶层化副本叠成一摞；折叠组子节点 hidden 不可见——排除防为陈旧选中项意外产出副本）；detached **副本一律顶层化**（parentId=undefined + 绝对坐标 + offset + **extent=undefined**——F41 契约 3）；data 一律取 nodeStore 全量；**storyboard 组 cells 重映射**（新 cells=cells.map(id=>idMap.get(id)??null)，与 clone remapIds 对齐）；折叠组副本继承 collapsed/savedSize
- 选区闭包互连边重映射；组 selected=true 子 false；偏移 `DUPLICATE_OFFSET={40,0}`；**顺序（F14）**：canvasStore set 先于 ns.addNode
- **undo（F13）**：入口 stopCapturing()（**不动 captureTimeout 共享常量**）；断言 500ms 内连点两次=2 undo 项
- **undo 扩展到全部新命令（v7）**：arrangeSelection / arrangeGroupChildren / setGroupColor / renameGroup / duplicateNodes 入口统一 stopCapturing()，逐命令"连点=2 undo 项"断言；折叠/转组等既有命令不动（精准修改）
- **副本体系统一**：copyNode 删除（:111+:277+4 测试改写为 duplicateNodes 断言——保真回归不丢）；duplicateGroup=duplicateNodes([id],DUPLICATE_OFFSET) 特例；copyGroupToClipboard/paste 链路从 nodeStore 取全量 data

**批量下载（R2b）**：
- `downloadMediaFile({fileId?, url?, filename})`：url 优先、缺则 fileId 现取；fetch 失败且有 fileId → 重取一次 URL 再试（长开页面过期自愈；viewer props 增可选 fileId 透传）；`a.download=filename` → click → setTimeout(revoke,60_000)；失败 message.error 继续
- **收集集 = participation('download') 三桶全展开（detached/hidden 均纳入，契约 1 显式）**：图片 `fileId||referenceImage`（isImageCompletedNode 三型）；multiImageGen 主图=images[mainImageIndex]（success）→否则首个 success→否则跳过（F15）；视频完成 fileId
- 文件名链：`data.mediaName ?? \`${类型}-${短id}\``；扩展名 content-type 映射+按类型兜底
- 4 处切换（节点传 fileId、viewer 传 url+fileId）；串行+i*300ms；>10 项先提示；完成提示+首次批量前提示浏览器许可；无可下载 aria-disabled+handler 守卫
- 大文件优化（blob 全量驻留内存）登记 R3

**媒体 URL 不持久化规则（v8 缩名收窄 + v9 时机改判，F37）**：
- **规则（缩名后）="node data.mediaUrl 不再写入/读取"**——不泛化为"URL 一律不持久化"（thumbnailUrl/images[].url/videoUrl/resultUrl 是另外的载体，具名登记 R3 下批收敛，规则大门禁小会被当成已解决）
- **写入 5 处（含 1 处 nodeStore 双写）+ 桥接键（全部 R2b 与缓存同批）**：canvasStore.ts:1000/:1122/:1380（+双写 :1383）+ CanvasView.tsx:177-183 素材库拖入 + **CANVAS_BRIDGE_KEYS 剥 mediaUrl（nodeStore.ts:235）**（桥接键不剥则任意 updateConfig 仍是写入通道）
- **读取端 2 处（同批 R2b 删）**：StoryboardCell.tsx:20 删 `p.info?.url ??` 短路（改纯 useMediaUrl(fileId)）、GroupNode.tsx:52 删 mediaUrl 读取。**v9 时机改判**：读写收敛与 useMediaUrl 缓存/in-flight 同一批落地（R2b）——v8"R0 先停写"的理由不成立（零存量下停写即触发请求，短路只保护不存在的旧节点；同批=零混态）
- **lint 门禁（标识符扫描）**：`\bmediaUrl\s*:` 在写入上下文（addNode/updateConfig/setState 实参）出现即报——**不是** `data: { … mediaUrl:` 模式匹配（CanvasView 的字面量名是 nodeData，无 `data: {`，模式匹配必然假绿——F37 实证）；配读取白名单。`status:'done'` + `mediaUrl` 三元组是稳定的可检辅助特征
- tiptap 链路（PromptInput/ImageMentionList/ImageThumbnailBar 读 ImageItem.url）涉及编辑器数据结构，**单独立项 R3**

### 4.4 组工具条与组颜色（需求 3，R2c）

容器 `GROUP_TOOLBAR={52,12}` portal 屏坐标层、视觉同 4.3；按钮 h-9 圆角 10、色点钮 size-10 内 20px 圆、下载 size-9。**组工具条同样加水平夹取 clampToolbarX（§4.3）**——storyboard 工具条 9 控件 ≥500px，窄组必溢出。折叠/整组执行/转分镜组/解组行为与禁用条件不变。**storyboard 组工具条加批量下载**（需求 8 裁决，收集集=cells 的 fileId）。

**组名入框（普通组）+ 智能标题屏幕层（分镜组）——v9 分治裁决，F17 根修；v10 补布局规则与实现形态**：NormalGroupRenderer 组名行（badge+名）从组框上缘外浮层（~[-10,-30] 流 px）改为**组框内顶部**（GROUP_PADDING_TOP=50 本就是组名预留区，白拿）；**分镜组智能标题不入框**——shell 是 `absolute inset:0` 网格铺满、frame=calcStoryboardSize 无标题带，入框只剩"叠首格 caption"（叠字）或"加标题带改 frame"（连带 calcStoryboardSize/拼图网格/resizeStoryboardGrid/组框不变式全动）——**改为与组工具条同 portal 屏幕层渲染**（几何零改动、消 zoom 耦合）。**v10 布局规则定死（"同层"只给 z-order 不解决几何重叠——窄组 1×1=320px 上居中工具条 ≥500px 两侧溢出，与左上标题必然同带重叠，同层结果是"工具条盖住标题"=信息丢失非解决）**：**常驻两条垂直带**——标题带占 `frame.top−12`、工具条带占 `frame.top−12−titleRowH`（titleRowH≈20px，13px 字号+余量），两带互不重叠、无选中态位置跳变；配 **1×1 窄组用例断言标题 portal 与工具条 portal 的 rect 不相交**（clamp 只解决视口溢出不解决组内碰撞——本条与 §4.3 水平夹取是同一逻辑的两轴）。**实现形态（v10，性能硬约束）：单例共享层**——一个 `StoryboardTitlesLayer` 组件、**一次** viewport 订阅、内部渲染 N 个绝对定位标题 div（N=画布全部分镜组，常驻非仅选中）；**禁止**每个分镜组各起独立 portal 订阅 viewport（N 个订阅者在 pan/zoom 每帧触发 N 次 React 更新；组工具条只渲染 1 个故无此问题）。**zoom 策略登记**：屏幕层标题恒 13px 不随 zoom 缩放（与工具条同代价），zoom 0.5/2 目视验收（§5 浏览器验收）。工具条 offset 回常量 12。折叠卡组名在 summaryRow（不变）。**入框安全前提 = clamp 收编（§4.8/N5）**：现状 addToGroup/dropIntoGroup 不 clamp，子节点可落 y<50 与框内组名重叠——入框后必须先收 clamp。相关测试：NormalGroupRenderer.test 组名位置断言改写、StoryboardGroupRenderer.test 标题位置断言（屏幕层+分带）。

**展开态新增 1px 边框（维持 v6 拍板）**：`border: 1px solid var(--canvas-group-border)`；设组色时 `border-color: var(--canvas-group-color-<key>, var(--canvas-group-border))`；同步改 NormalGroupRenderer.test.tsx:32/:36 断言；选中态维持四角手柄。

**组颜色（语义 key，维持 v6 设计）**：
- `utils/groupColor.ts` 单源：`GROUP_PALETTE`（7 键）派生 `GroupColorKey` 与 `GROUP_COLOR_MAP`；收敛 `resolveGroupColor(value) → CSS 值 | undefined` 唯一函数
- `GroupNodeData.color?: GroupColorKey`（无 gray；undefined=默认）；浮层 7 彩点+"默认"清除项
- 双兜底：边框/徽标描边 `var(--canvas-group-color-<key>, var(--canvas-group-border))`；色点钮内圆 fallback 复用中性 token
- 未知 key 按未设色不抛错；写入端 `if(!(key in GROUP_COLOR_MAP)) return`；后端仅形状过滤（typeof string，不复制枚举）
- `setGroupColor` 经 patchGroupData 双写
- `convertGroup` 两方向**增量 patch**（经 patchGroupData，F18 根修）：normal→storyboard 置 nameCustom:false+自动名+保 color；storyboard→normal `nameCustom? 原 name : '分组'` + nameCustom:false + 保 color——**不再整体重建 data**

**排列子节点** `arrangeGroupChildren(groupId, mode)`：折叠态禁用（菜单项 disabled + 函数首行守卫）；**显式几何命令：先清 manuallyResized（经 patchGroupData）再走 applyGroupFrame**（手动组排列生效，配测试）；子节点绝对 rect→arrangeRects（**排序同 sortForArrange 行优先**）→经 `refitGroupGeometry/applyGroupFrame`（契约 2/5 唯一写者）；单次 setWithParentOrder；仅普通组。

### 4.5 折叠宫格预览卡（需求 4，R2d）

- `COLLAPSED_SIZE={220,160}` 单源（toggleCollapse+渲染层+canvasStore.groups.test.ts:200 断言 200→220）
- 结构：预览宫格（padding 6/gap 4/圆角 6）+ summaryRow"N 个节点"；列数 1-2→按数量/3-4→2 列/5+→3 列；≤6 tile；tile 独立组件 useMediaUrl(fileId)；其它类型图标占位
- **useMediaUrl 缓存根修（F7 v7 正解：绝对时刻 + 服务端算剩余）**：
  - 服务端 Redis 缓存值改 JSON **`{url, expiresAt}`**（expiresAt=服务端绝对 epoch ms = Date.now()+900_000）；**缓存键版本化 `media:url:v2:${teamId}:${fileId}`**（防新旧 pod 混布；旧值 840s 自然过期，无存量不迁移）
  - **命中**：`remaining = Math.max(0, Math.ceil((expiresAt − Date.now())/1000))`；**remaining ≤ 0 → 立即重新 presign 并覆写缓存**；否则返回 `{url, ttlSec: remaining}`
  - **JSON.parse 失败 / 解析成功但缺 expiresAt 或非法值 → 按坏值处理：重新 presign 覆写**（v6"缺 ttlSec 保守 60s"改判——无存量数据没有理由兼容坏值，坏值尽快自愈=覆写，不留 60s 灰档）
  - 未命中：presign 900s + `SET key JSON EX 840`
  - **响应仍返回相对秒数 ttlSec**（规避客户端时钟偏移——但剩余由**服务端**算，这是与 v6 的本质差别）
  - 客户端模块缓存 **`${userId}:${fileId}`→{url, expiresAt}**（**v9：键加用户维度从 R3 提入**——服务端鉴权 per-user，fileId-only 缓存挡不住"同浏览器切账号不登出"；**v10 实现路径：模块级 `currentUserId`，由 AuthProvider 写入 + 登出时与 clearMediaUrlCache() 同挂点清理——不在 useMediaUrl 内 useAuth()**（每个媒体消费点订阅 auth context 的重渲染面；零订阅方案与"清空双挂点"同源）），临期 <60s 重取、ttl≤0 立即重取、onError 失效重取一次、**in-flight promise map 去重（同 fileId 并发挂载共享单请求）**、清空双挂点维持（page.tsx 项目切换分支 + AuthProvider 登出回调）；getPresignedUrlByKey 不在范围
  - **折叠卡批量预取（F9 v7 改判，v8 补三口径）**：CollapsedPreviewCard 挂载时收集 tile fileIds（≤6）→ `batchGetMedia(ids, teamId)` 一次请求 → 回填 useMediaUrl 模块缓存。**v8 三口径**：① **必须显式传 teamId**（画布 teamId）——media-batch.service.ts:16 缺省回落 getOwnerTeamId(userId) 与画布团队可能不同 → 查不到行 → 预取静默降级且无报错（测试也测不出）；② **rewrite 做成新调用点 opt-in**——batchGetMedia 现有 3 个消费方（useWorkflowAssets.ts:32、shadowJob.ts:31、VideoEditNode.tsx:109）直连 MinIO 绝对 URL，VideoEditNode 迷你播放走 fetch blob 依赖 HTTP Range，同源改写的生产 nginx 行为不在仓内——**不动既有 3 处**，折叠卡预取走新的 rewrite 入口（配 Range/staging 验证后再考虑统一，登记 R3），补一条既有消费方回归；③ **batch 响应带 ttlSec 字段**（服务端现签 3600s 应随响应下发——客户端硬编码 3600_000 会随服务端 TTL 漂移；ttlSec 已升格为契约，双路径同字段）；batch 失败不阻塞（tile 逐个 fallback 单取）；LRU 64 维持
- **接口变更爆炸半径（v8 成员修正）**：getMediaUrl 现返回裸 string，改 `{url, ttlSec}` 必须：① **media.service.spec.ts 6 处断言改形状——成员精确**（v7 误把 :113 算入——它属 `describe('getPresignedUrlByKey')` 块（:108 起）不受影响）：**返回值 :63/:72/:79/:85 四条 + 缓存写入 :73 与 :86-91 的 redis.set 值形状两条**，值变 JSON 后一起红；② controller getUrl 去 `{ url }` 包装直接透传；③ getMediaUrl 加显式返回类型 `Promise<{url: string; ttlSec: number}>`（嵌套形编译期红）；④ **客户端 `Number.isFinite(ttlSec)` 兜底**（v8 补：混布/字段缺失 → `now + undefined*1000 = NaN` → 比较恒假 → 永不重取——NaN 是最隐蔽的失效形态）。前端 13 调用点 11 处解构、2 处非解构（canvasStore.ts:648、useMediaUrl.ts:24）——加字段不破坏解构，结论不变
- 组色着色折叠卡边框（双兜底）；选中态优先级：选中高亮 > 组色；根元素 `title={组名}` + `aria-label="{组名}，N 个节点"`；重命名入口 = 右键菜单"重命名"（修 F24）+ 展开态双击

### 4.6 分镜组改版（需求 8，R0 渲染兜底 + R2d 改版）

- 主体：背景 `var(--canvas-storyboard-shell-bg)`、边框 `1px var(--canvas-group-border)`、**设组色时 `border-color: var(--canvas-group-color-<key>, var(--canvas-group-border))`（v10 用户拍板：分镜组呈现组色——convertGroup 两方向保 color 而呈现不跟随会出现"设色→转分镜→看不见→转回又出现"的状态不一致；1 行双兜底现成，与普通组同款。v7"分镜工具条不加色点"裁决不受影响——shell 边框即呈现载体）**；行为不变
- **解析器防线（修 F2 全部消费点，R0a）**：新增 `resolveStoryboardConfig(data) → 合法 config`（字段级 merge + 枚举/边界校验：非法 aspectRatio/gridRows<1/cells 越界裁切——单函数，**渲染与 store 共用**）；**消费点必须覆盖渲染侧 2 处（StoryboardGroupRenderer:12、CanvasView:570 工具条）+ store 侧 3 处（ungroup:855、dropImageIntoStoryboard:973、convertGroup:1212）+ 静默 NaN 2 处（updateStoryboardConfig:1307、resizeStoryboardGrid:1332）**——store 侧不消费则克隆体上点"解组/转普通组/填充宫格"仍崩（渲染兜底覆盖不了 store）；NaN 两处是"不抛错的最难发现"腐化，列入修复前必红。缺 storyboard 退 DEFAULT_STORYBOARD_CONFIG（16:9/1×1/false/2K）
- **lint 门禁（v7 新增，v8 扩 allowlist）**：全仓 `\.storyboard\b` 裸解引用允许出现在：resolveStoryboardConfig 模块内部 + store 的 storyboard 命令实现（updateStoryboardConfig/resizeStoryboardGrid/convertGroup/ungroup/dropImageIntoStoryboard——它们是 config 的**变更者**，经 resolver 归一后操作）（vitest grep 测试）——防新消费点绕过
- 智能标题（纯标记）：`nameCustom`——renameGroup 置 true、自动生成置 false；标题=nameCustom?name:`分镜组 ${cells.filter(Boolean).length} 个节点`；**屏幕层 portal（v9，§4.4 分治裁决；v10 补：布局带 `frame.top−12` + 单例共享层 StoryboardTitlesLayer + 窄组 rect 不相交断言——细则见 §4.4）**、13px muted、限宽省略
- 工具条：`[比例▾] [宫格 r×c▾] │ [拼接(2K/4K)] [序号] [清空] [转普通组] │ [批量下载] [解组]`（v7：补批量下载，需求 8 裁决）
  - 宫格文案照抄既有 `宫格 {rows}×{cols}`（F23）；拼接维持 '2K'|'4K'（F19）
  - 转普通组/解组=新增按钮；三子组件（F28）硬编码色同批换 controls token
- **后端白名单分表（F21 定稿维持）**：
  - `FilterOptions` 增 `whitelist?: Record<string,string[]>`（不传=现 WHITELIST）
  - snapshot 端维持现表（:87 断言不改）
  - **clone 端新表 = snapshot 表 + `group: [...GROUP_NODE_DATA_KEYS]`（9 键）**——multiImageGen 维持 ['prompt','label']（F20：媒体引用一律剥离）；白名单处注释写死政策（同 v6）。**R0a 落地方式（v9 口径统一）**：`GROUP_NODE_DATA_KEYS` 常量 **R0a 即落 packages/shared/src**（API 生产源码仍用字面量；**spec 文件值导入 shared 源码做 parity**——shared 的 main 指 src/index.ts，vitest/vite-node 直接转译 TS，无需构建，snapshot-filter.util.spec.ts:5 先例自证）→ R1a 构建落地后 API src 切值导入并删字面量。§4.6 的"下沉依赖后置"仅指 **API 生产源码的值导入**，常量本身 R0a 就位
  - **政策断言**：clone spec 锁 `multiImageGen.data.images === undefined`、`imageGen.data.fileId === undefined`、`isImageCompletedNode(克隆体) === false` 为预期行为
  - video-work-clone.service.ts:35 传 clone 表；clone spec 夹具补 storyboard（F27）
  - **v7 撤除项（F31 v8 改判后维持撤除，理由更新）**：~~"产物·任务键 5 键"两组命名政策~~、~~"拼接过的分镜组克隆后 data.fileIds===undefined"断言~~、~~"服务器 5 键 ∉ GROUP_NODE_DATA_KEYS"反向测试~~——该路径按产品裁决关闭（R0d 删块+走私封堵），不值得政策与测试；**注意：5 键块删除的理由是产品裁决，不是"不可达"**（可达性已被 R0d 的 whitelist pipe 同时封死——先堵走私再删块，同 commit）
- **GROUP_NODE_DATA_KEYS 下沉 + 类型重构（F25/F30，依赖 §4.7 shared 构建）**：
  - types/group.ts 重构：`GroupNodeDataShape`（无索引签名显式 interface，9 键，savedSize 显式 `{width:number;height:number}`）+ `export type GroupNodeData = GroupNodeDataShape & Record<string, unknown>`（存留理由**只剩 RF Node data 约束**——F31 删块后无"服务器 5 键流入"论据）；2 处 Props 调用点加本地 cast；不清既有 as any；编译面以 `tsc --noEmit` 全绿为准
  - `packages/shared/src/types/group.ts`：导出 `GROUP_NODE_DATA_KEYS` 运行时 const 数组（**构建落地后 API 生产源码直接值导入——F36 解除**）
  - 双向编译锚定（对 Shape 有效——无索引签名 keyof 是字面量联合）：`satisfies readonly (keyof GroupNodeDataShape)[]` + `Exclude<keyof GroupNodeDataShape, typeof KEYS[number]> extends never`；落地时红相实证一次（临时加/删键确认双向红并记录）
  - 运行时兜底（scope 维持、理由改写）：断言 `Object.keys(node.data) ⊆ GROUP_NODE_DATA_KEYS` 仅挂客户端写入路径（patchGroupData 内部一处即可——唯一通道收口后天然单点）——理由不再是 F31，而是"远端 apply 流入数据不受本地写入约束（防未来服务端写字段误伤本地断言）"
  - API spec 值导入断言 `clone 表 group ⊇ GROUP_NODE_DATA_KEYS`
- 跨包断言拆两条（维持 v6）：① API spec 断言 clone 输出含 data.storyboard（形状）；② web 组件测试"有/无 storyboard 两分支都不崩"——不写跨包 e2e

**模板往返修复（F29 v7 三站点，R0b，同 commit 原子完成）**：
- **导出侧** canvas.service.ts:77-79：改**展开式 + 边界归一** `{ ...normalizeCanvasRecord(n) }`（归一函数来自 §4.7 节点信封单源：null→undefined、**data ?? {}（v8 补 N8：readCanvas 的 data 同为 `?.toJSON()` 可 undefined，NodeSchema.data 是必填 z.record——与 position 完全同型，漏了下一轮评审必抓）**、position 兜底 {x:0,y:0}——snapshot-filter.util.ts:104-107 + applyDocToStore :201-202（`position||{x:0,y:0}`/`data||{}`）双先例）+ `ensureParentFirst`
- **导入侧** template.service.ts:242-246：展开式 `{ ...n, id: newId, parentId: n.parentId ? (idMap.get(n.parentId) ?? null) : undefined }`；**cells 两遍重映射**（先建全 idMap 再单独 for 循环——边建边用会误判靠后节点为悬空；悬空→null 长度不变）
- **第三站点（v7 补漏）** project.service.ts:62-84：fillDoc 手抄本替换为 §4.7 `writeNodeToYMap`（导入链路真正写 doc 的地方；它本就认 parentId/width/height——输入归一后字段存续）
- **模板媒体/状态政策（P0-B，v9 条件化改判——必须在"往返等价断言"写之前定；v10 补第 ⑤ 点读侧收敛）**：**私有链路媒体可解析**（template.service:216 私有模板仅作者可导入 + media 创作者本人绕过团队校验 ⇒ 导入者==作者==创作者——**v10 措辞软化：限于"作者同团队内"**；残留面=A 私有模板含 C 团队媒体（如曾导入社区模板再存私有）→ getMediaUrl 403 → 由 ④ 渲染期占位兜住症状，不宣称 100%）——"保存期一律剥离"会让"保存为模板→新画布导入"主线丢图而它本可用；且 isPublic 可后改，保存期过滤不是正确边界（公开时旧行仍是全量）。**v9 裁决条件化**：① 私有保存**全量**；② isPublic=true 保存时过滤（走 **9 键 clone 表**——非 snapshot 3 键表，一过 3 键表当场重造 F29）；③ **跨用户导入时过滤**（覆盖"私有→后公开"旧行——导入侧判 `isPublic && template.userId !== userId`）；④ 协作画布含队友媒体的残余面用**渲染期降级占位**处理（useMediaUrl onError——一颗别人的图不应整份模板降级，零额外成本）；⑤ **读侧收敛（v10 新增，静态数据边界）**：v9 的 ②③ 拦不住读取——list（findMany 无 select）与 getTemplate 放行分支整行下发 templateData（含媒体 id/工作流内容/status），且 getTemplate 私有放行 OR 链（团队成员/项目协作者）比 import 的仅作者更宽；**实测前端全仓零消费 templateData**（grep 无命中；导入在服务端内部读库）⇒ **非 owner 的 list/detail 响应一律不下发 templateData（select 收敛，detail 仅 owner 下发）**——零功能损失；纪律句：**"公开行的 templateData 等同公开载荷"（与 F21 快照端同款——往里加字段先过这道心算）**；update 翻 isPublic **无需重过滤（读侧是唯一裁决点，写明——二者不要都含糊）**；**公开→私有不可逆登记**（② 过滤结果落库，改回私有不恢复媒体引用——可接受取舍非 bug，防误报）。**验收收益**：私有主线往返等价断言恢复**全量基准**（与原画布深等——判别力最强，v8 把它降成"过滤后基准"是自我削弱）；跨用户过滤另立一条用例
- **门禁封死**：`validateTemplateData` 返回类型改 **void**（函数体同步改裸调用）；NodeSchema 三字段 `.optional()`（F32：配合边界归一）+ position 必填（缺=fail-closed 400）；**schemaVersion**：templateData 加 `version: 1`，不匹配 fail-closed 拒绝——**P0-C（v8 补）**：仓内有生产者 initOfficialTemplates（template.service.ts:278，:300-301 手写 nodes 无 version，:314 仅缺失时 create）→ fail-closed 后官方模板"文生图工作流"直接不可导入且 dev DB 旧行不更新；**同 commit：seed 补 version:1 + 改 upsert 化（会更新旧行）或明写"重置 dev 模板表"**（仓内 16 个 migration 全是 DDL 无数据回填先例，upsert+重置更贴现状）；**红面登记（v8）**：template.service.spec.ts 的 import 用例 5 条中 :314/:330/:339/:346 四条红（:325 私有模板在 :216 先抛 Forbidden 仍绿）+ template.validation.spec.ts:11-13 的 not.toThrow——**共 5 处**，比 v7 登记的 canvas.service.spec.ts:187-197 多一处 spec 面
- **原子性（F32）**：展开式+归一化+schema 改动+schemaVersion+seed 同一 commit；**"save 不抛错"必红用例针对展开后代码编写**（展开前写恒绿失去判别力）
- **导入侧也过一次 ensureParentFirst**（历史/手工构造模板顺序无保证——idMap 循环保序不重排）
- **消费层几何兜底（v8 改挂点，v9 补调用面）**：组缺 width/height → 派生（normal→refit、storyboard→calcStoryboardSize）——**不挂 applyGroupDerivations**（它被 6+ 命令调用，挂 refit = 造出第 10 个隐式几何写者，与"applyGroupFrame 唯一出口"自相矛盾）；**挂两点**：① applyGroupFrame 内部（缺 width/height 即派生，天然单点）；② 独立 `normalizeLoadedCanvas(records)` 纯函数——**调用面写全（v9）**：web 加载/导入入口 + **服务端两条路径同跑**（project.service 模板导入写 doc、clone remapIds→create——纯函数服务端零成本；若只有 web 跑，新导入项目的 doc 在首次客户端变更前一直缺几何，"导入后立刻存模板"仍会丢几何）。**clone 路径断言措辞（v10）**：写"**幂等不改变**"——clone 输出经 applyWhitelist spread（snapshot-filter.util.ts:107）本就带 width/height/position，只有模板导入那条路真缺几何；对 clone 断言"兜底补齐"是错误预期（输入不缺则无可补，测不出兜底逻辑反而误导）
- **验收（修复前必红）**：带组画布→存模板（私有）→新项目导入→往返等价断言（**全量基准：与原画布深等**（除 id 映射外顶层键深等 + cells 全部可解析）——v9 恢复强断言）+ **跨用户导入过滤用例**（公开模板跨用户导入：媒体引用/status 被滤 + 模板结构保留）+ **读侧收敛断言（v10）：list/detail 非 owner 响应不含 templateData 键、owner detail 仍含**（公开与私有各一条——list 的 community/official 查询必含非 owner 断言）+ 导入后几何兜底零变更（**配悬空 cells 反例防恒真**）+ 普通/分镜各一条 + **save 含 width/height=null 与 data=undefined 节点不抛错（各一条）** + canvas.service.spec.ts:191-195 迁移（objectContaining）+ validateTemplateData void 后 6 个 .toThrow 核对 + schemaVersion 5 处红面迁移 + **克隆体上解组/转普通组/填充宫格不崩（F2 store 侧 3 处，v8 补）**

### 4.7 shared 真构建与节点信封单源（R1a 基建 + 单源；v8 落地形态 + v9 补部署链）

**shared 构建（R1a，解 F36——v8 四要点 + v9 deploy.sh Blocker）**：
- `packages/shared/tsconfig.build.json` **显式覆写 `module: commonjs` + `moduleResolution: node`**（base 是 ESNext/bundler——直接继承必产 ESM+无扩展名导入，API 是 commonjs/moduleResolution:node 且忽略 exports 字段，require 必炸）；package.json `main`/`types` 指 dist（`exports` 在 API 的 classic resolution 下不生效，不是充分手段）
- **web 侧显式加 Vite alias + tsconfig paths 指 `packages/shared/src`**（vite.config.ts 现只有 '@'——main 一改 dist 则 web dev 与 vitest 一起切到 dist，dist 过期=静默注入旧代码；若 dist 为 CJS，浏览器 ESM 里 CJS require 不成立直接白屏——alias 是必选项）
- **同 commit 清障**：现存 `packages/shared/dist/` 陈旧（缺 types/video-work、还含编译后的测试文件——构建 exclude 测试）——先删旧 dist 再重建，加 `node -e "require('…/dist/index.js')"` 冒烟（真实风险是 require 失败与 undefined 导出；既有 parity 断言对 undefined 会红而非假绿——v9 措辞修正，风险不在断言在部署）
- **deploy.sh 同 commit 补全（v9 Blocker，实测复核）**：deploy_full 在 nest build 前插 `cd packages/shared && npx tsc -p tsconfig.build.json`；deploy_api 增传 packages/shared/src 并在服务器同跑 tsc（现 deploy.sh 上传 packages/ 但 `--exclude='dist'`、构建段只跑 nest build、deploy_api 只传 apps/api/src、set -e——main 指 dist 后**任何环境**部署失败，本地冒烟替代不了）；服务器 pnpm install 装 devDeps 故 npx tsc 可用。**验收=干净目录三步构建全绿（shared tsc → nest build → vite build）**
- turbo pipeline：api#build dependsOn shared#build 已存在无需改；dev 链路（tsc watch 纳入 turbo dev）plan 定，验收=改 shared 源码 API dev 即时生效；合并前跑一次生产启动
- admin.guard.ts 等既有禁令注释同步更新

**节点信封单源（R1a，F29 根修——纯数据方案维持）**：
- **背景（v8 改判原因）**：若 shared 承载 Y.Map 读写需加 yjs 依赖——仓内多处 `instanceof Y.Map` 守卫跨 yjs 实例必为 false，失败模式是**静默丢数据**（writeNodeData 直接 return）；一旦单侧升级 yjs 即触发。**裁决：shared 只放纯数据，漂移的真正来源是键表和归一化，不是 m.set 那三行**
- `packages/shared/src/canvas/nodeEnvelope.ts`（**零运行时依赖**）：
  - `export interface CanvasNodeRecord { id; type; parentId?: string|null; width?: number|null; height?: number|null; position: {x,y}; data: Record<string,unknown> }`——节点信封唯一类型
  - `export const NODE_ENVELOPE_KEYS = [...] as const`（信封键集单源）
  - `export function normalizeCanvasRecord(n): CanvasNodeRecord`——**函数级契约注释写死（v9）**："信封全部可选键在此归一：parentId/width/height 的 null→undefined、position 与 data 的 undefined→{x:0,y:0}/{}——将来加第四个可选字段必须进本函数，漏归一一律在此界拦截"（导出/模板/快照边界共用）
  - **Y.Map 读写适配器留两端**（web ydocBuilder / API collab-document 各自薄层），各自用 `satisfies readonly (keyof CanvasNodeRecord)[]` 锚定键集防漂移
- **收敛清单（v8 补第 7 处，7 处调用点改用）**：ydocBuilder.fillDoc、readCanvasFromDoc、collab-document.readDocCanvas（shadow- 过滤留调用处）、project.service.ts:62-84、storeProjection→`projectCanvasNodes`（web 新纯函数）、useCanvasPersistence 快照、**applyDocToStore content 构造（canvasCollabRuntime.ts:198-205——v7 漏，留着就是第 7 份手抄本）**
- **grep 不变量（lint 门禁）**：信封键集序列化模式只允许出现在 nodeEnvelope 模块 + 两个适配器文件内——防第 8 份手抄本复活
- **服务端 parentId 校验（F39 v8 收窄版，R1）**：`validateParentGraph(nodes: CanvasNodeRecord[])` 纯函数，**分两档**——**导入侧 fail-closed 400**（模板是信任边界：环→400、嵌套组→400、悬空→400）；**clone 侧只检环**（环挂死 RF）+ 嵌套组 degrade+日志、悬空不检（**既有红线**：video-work-clone.service.ts:50-51"悬空是可达真实状态…一律不抛"、:63 parentId 降级 null——悬空只来自服务端剥除 shadow/videoEdit 路径，客户端数据不可能产出）；**校验阶段必须 = remapIds 之后**（remap 输出只可能是"新 id 或 null"天然无悬空；挂 readCanvas 之后则历史悬空会让能打开的画布克隆失败）

**组 data 唯一通道 patchGroupData（R1b，F18/F38 根修配套——v8 补 delete 语义）**：
- `patchGroupData(groupId, patch)` = canvasStore 增量合并 + syncGroupDataToNodeStore；**undefined 值 = 删除键**（`{...data, ...patch}` 后显式删 undefined 键）——**这是 v8 关键补丁**：canvasStore.ts:1229 注释明写 convertGroup 整体重建**有意**清掉 manuallyResized/savedSize（"防旧标记经快照复活"），改增量 patch 若无 delete 语义：normal→storyboard 带 stale manuallyResized（storyboard 几何是配置型，stale 标记冻住任何 shouldAutoRefit 路径）、storyboard→normal 留 stale storyboard/cells（进 clone/模板/快照——正是本轮要根除的漂移）
- 迁移全部 data 写点（groupNodes/mergeStoryboard/convertGroup×2/toggleCollapse×2/markManuallyResized/renameGroup/setGroupColor/arrangeGroupChildren）；convertGroup 显式声明删除集（两方向都删 manuallyResized/savedSize、→normal 再删 storyboard/cells）
- **测试加"反向不存在断言"**（不能只断言 {name,nameCustom,color} 存在——convertGroup 后 data.manuallyResized===undefined && data.savedSize===undefined &&（→normal）data.storyboard===undefined）
- **lint 门禁**：组节点上下文 `data: { groupType` 字面量重建模式零命中（收口后无豁免点）

### 4.8 组几何唯一写者全收口（R1b，P1-3——v8 更新：11 写者、绝对 rect 接口、复制型例外、clamp 收编）

**现状写点实为 9+2**（v6 只迁 4 处；v8 补 2 处复制型）：groupNodes:823、addToGroup:901、dropIntoGroup:953、mergeStoryboard:1144、convertGroup:1202、toggleCollapse:1261/:1274、refitGroupBounds:1298、updateStoryboardConfig:1309、resizeStoryboardGrid:1334 + **buildGroupCopy:1461-1466 / rebuildFromClipboard:1546-1551（复制语义：structuredClone 源组+新 position）**。

**收口设计**：`applyGroupFrame(groupId, children rects, mode)` 是组几何唯一写入 action，**以绝对 rect 定义**（契约 2 v8）——输入子节点绝对 rect 集合，输出组 frame + 每子 rel：
- **重算型**（组框=f(子集合)，守恒：子绝对坐标不变）：groupNodes / addToGroup / dropIntoGroup / convertGroup→normal / toggleCollapse 展开 / refitExpandedGroups / 恢复循环 / arrangeGroupChildren——`refitGroupGeometry(绝对 rects)` 纯函数 + applyGroupFrame 写入。**addToGroup/dropIntoGroup 既有成员平移 δ（F33 同型）与 convertGroup −20/−50 一并修复**（修复前必红：既有成员绝对坐标不变 + **新成员落点=用户放置点**——修完仍跳一下就是只修了一半）；**clamp 收编（v8/N5）**：clampPositionToPadding 从 onNodesChange :536-543 移入 applyGroupFrame（或其调用的 refitGroupGeometry）——组名入框后 dropIntoGroup/addToGroup 不 clamp 会让子节点落 y<50 与框内标题重叠（现状组名在框外不可能，入框后必踩）
- **配置型**（组框=f(配置)）：mergeStoryboard / convertGroup→storyboard / updateStoryboardConfig / resizeStoryboardGrid——`applyGroupFrame(gid, calcStoryboardSize(rows,cols,ratio))`
- **折叠型**：toggleCollapse 折叠→COLLAPSED_SIZE；展开恢复手动尺寸同走 applyGroupFrame
- **复制型例外（v8 登记，不改写）**：buildGroupCopy / rebuildFromClipboard 是"复制语义"（frame 继承源组±offset，非重算）——**登记为显式例外**并配断言（复制组 frame=源 frame±offset、cells 已重映射），不改走 applyGroupFrame（强改会消灭复制语义）
- **F38 整类修（v8 扩，v9 补 spacing 规则）**：convertGroup→normal **与 ungroup（storyboard 分支）** 都删"强制 width: CELL_WIDTH/height: cellH"覆盖，保留子节点自身尺寸只重排位置——**但保留尺寸+固定 pitch（CELL_WIDTH/cellH）会让比基准宽的节点压到下一列**：**pitch 取该列/行 `max(自身尺寸, 基准)`**（异构尺寸重排不重叠——配"异构尺寸重排不重叠"用例；只锁"尺寸保留"锁不住重叠），各配修复前必红用例
- **删除 refitGroupBounds 旧函数**（含 page.test.tsx:72 mock）；**lint 门禁不变量（v8 精确表述）**："**重算型**组几何唯一写者"——grep `n.id === groupId` 上下文直写 position/width/height 模式零命中（复制型两处经例外断言覆盖，抓不到也不误报）
- **属性测试（F33）**：随机 rel 分布 → refitGroupGeometry → 断言 ①`bbox(子)+padding == frame` ②子节点绝对坐标不变 ③`refit∘refit == refit`（幂等——正好锁住"重复调用重复漂移"）

## 5. 测试策略（TDD）

| 层 | 内容 |
|---|---|
| 纯函数 | arrangeRects（三模式/混排对齐/中心仅参与项/n≤1/参与项 0 与 1 分别提示）；**sortForArrange 行优先（y 容差 8px 分行/行内 x 升序）**；normalizeSelection 三桶 + participation 策略逐动作；折叠卡列数；**refitGroupGeometry 属性测试（随机 rel：守恒/幂等/子绝对坐标不变）**；shouldAutoRefit；clampToolbarX 水平夹取；**validateParentGraph 两档（导入：悬空/环/嵌套各 400 一条；clone：环拒、悬空/嵌套降级各一条）**；normalizeCanvasRecord（null→undefined/**data ?? {}**/position 兜底） |
| store | arrangeSelection（**parentId 逐节点不变反向断言**/排除项零位移/参与<2 提示/toast 计数含 hidden/保持选区/单 set/**stopCapturing**）；duplicateNodes（nodeStore data 全等/cells 重映射/detached 副本顶层化 **含 extent=undefined（F41）**/B-2 顺序/连点=2 undo/hidden 排除）；duplicateGroup 复用路径；setGroupColor（双写/未知 key 拒写）；convertGroup 两方向 {name,nameCustom,color} 增量保留 + **反向不存在断言（manuallyResized/savedSize/→normal 时 storyboard===undefined——patchGroupData delete 语义，v8）** + **storyboard→normal 子节点绝对坐标==网格目标（F33 必红）** + **子节点自身尺寸保留（F38 必红）**；**ungroup（storyboard 分支）子节点尺寸保留（F38 扩类，必红）+ 异构尺寸重排不重叠（v9 spacing：pitch=max(自身,基准)，比基准宽的节点不压邻列）**；**addToGroup/dropIntoGroup 既有成员绝对坐标不变 + 新成员落点==用户放置点（F33 同型，v8 补双断言）**；arrangeGroupChildren（守恒/折叠 no-op/清标记+patchGroupData）；折叠 220；**applyGroupFrame 收口（grep：refitGroupBounds 零残留 + 重算型直写模式零命中；复制型两处例外断言：frame=源±offset/cells 重映射）**；**clamp 收编后 dropIntoGroup 顶部不越 y<50（v8/N5）**；**patchGroupData 唯一通道（Object.keys ⊆ KEYS 单点 + 字面量重建零命中）**；**新命令逐个 stopCapturing 断言**；**normalizeLoadedCanvas 服务端两路径调用断言（模板导入/clone 产物 doc 含派生几何——v9）** |
| 快照投影（契约 5，W7/W8 分两步） | 投影后快照节点含 position/width/height/parentId（**数组形状**）；**崩溃恢复组结构不丢（F35 必红——模拟"快照独有结构"；配反例：快照缺 parentId 时组确实丢）**；**isEmptySnapshot 对空数组形状判真（v9）**；**toAppNode 显式构造后 nodeStore 无几何残留键（v9）**；**手动 resize→刷新尺寸保持（W7 删除的红转绿门槛）**；删镜像后 onNodesChange 邻居块行为不变；**undo 组合用例**；TextInputNode useInternalNode 尺寸渲染（**mock measured 改实测断言**）；**ImageGenNode 4 处 fallback 改 ?? 0 后 NaN 不再**；**AppNode 删三字段后 tsc --noEmit 指认零残留读者（读侧 6 处+写侧清单一起改，一轮红一次修完）** |
| util | mediaDownload（双入口/url 失效 fileId 重取/**合并仓内 5 处重复实现——4 处 click() 同步 revoke 截断慢对象（ImageFullscreenViewer/VideoFullscreenViewer/ImageGenNode/VideoGenNode），正解先例 ExportModal setTimeout(revoke,60s)**/**文件名优先服务端 originalName/mimeType——findUnique 已在手零额外查询**）；useMediaUrl（同 fileId 并发挂载 **in-flight 单请求**/二次挂载 0 请求/临期重取/onError 自愈/**Number.isFinite(ttlSec) 兜底——NaN 时按缺失重取**/**缓存键含 userId：切账号不登出后不串图（v9 提入 R2b）**/切项目清空后重取/**batch 预取回填命中+断言请求带 teamId**）；下载收集主图非 success 用例 |
| 组件 | SelectionBoxOverlay（按钮序/排列菜单/下载守卫/**水平夹取**/**浮层交互 aria/Esc/点外**/**阈值 ≥2 现状断言保持**）；GroupToolbar（新按钮序/色板浮层/storyboard 补两按钮/**水平夹取**/portal 位置断言）；NormalGroupRenderer（展开态 1px 边框替换 ''/**组名入框位置断言**/折叠态"N 个节点"/220×160）；CollapsedPreviewCard（列数/tile/title+aria/batch 预取失败降级/**降级路径不静默**）；StoryboardGroupRenderer（shell/**智能标题屏幕层两分支（v9）**/**分带位置断言 + 1×1 窄组标题 portal 与工具条 portal rect 不相交（v10）**/**StoryboardTitlesLayer 单例：N 组一次 viewport 订阅（渲染计数或订阅数断言）**/缺 storyboard 容错/**store 侧 3 命令经 resolver 不崩（F2）**/**设组色时 border-color 吃组色双兜底（v10 拍板）**） |
| API | 分表后：snapshot 表维持；**R0a clone 表 group 9 键=API 字面量，spec 值导入 shared 源码 parity（R1a 切值导入后删字面量）**；政策断言（clone 输出 multiImageGen.images===undefined、imageGen.fileId===undefined、isImageCompletedNode(克隆体)===false）；clone 夹具补 storyboard；**R0d 走私封堵三件套（v9，v10 收窄）：storyboard DTO whitelist+forbidNonWhitelisted——body 塞 nodeId/projectId/userId 变 400（非静默剥除，逐键断言）+ 棘轮门禁（@Body() any 基线冻结零新增——门禁文件锁现状清单；新增 DTO class 端点必须挂 pipe）+ service 显式 pick 断言 + 5 键块删除后 grep d.nodeId 零残留 + writeNodeData mock 清理；R0d 验收附 presign/confirm 手工冒烟（上传链不受影响——防后续误加全局 pipe 的回归锚点）**；**模板往返（F29 三站点）**：往返等价（**v9 全量基准：私有保存→导入与原画布深等**）+ **跨用户导入过滤用例（公开模板跨用户：媒体引用/status 被滤+结构保留）+ 公开保存过滤用例** + 几何兜底零变更 + 悬空反例 + 普通/分镜各一条 + save 含 width/height=null **与 data=undefined** 不抛错（各一）+ canvas.service.spec.ts:191-195 迁移 + validateTemplateData void 后 6 个 .toThrow 核对 + **schemaVersion 5 处红面迁移 + seed version:1 + upsert 化断言**；**media：getMediaUrl {url,ttlSec} 形状 6 处（:63/:72/:79/:85 + :73/:86-91——:113 属 by-key 块不动）+ 显式返回类型透传不嵌套 + 命中剩余寿命正确（≤0 重签覆写）+ 坏值重签覆写 + batch 响应带 ttlSec 字段**；**validateParentGraph 两档（见纯函数行）**；**NaN 双点断言写法：组宽高非 NaN 且 data.storyboard.aspectRatio ∈ 枚举（F2 v9）** |
| shared | GROUP_NODE_DATA_KEYS 双向锚定（satisfies+Exclude + 红相实证记录）；GroupNodeDataShape 9 键；**nodeEnvelope 纯数据（NODE_ENVELOPE_KEYS + normalizeCanvasRecord）+ 两端适配器 satisfies 锚定键集**；**构建产物 dist 可被 API commonjs require（冒烟）+ 陈旧 dist 清障后重建** |
| vitest 门禁 | 深浅域键集相等；GROUP_PALETTE ↔ CSS 变量集（readFileSync+正则）；**深浅两档 14 色 contrast 实测登记（禁手填）**；**\.storyboard\b 裸解引用 allowlist（resolver+store 5 个 storyboard 命令）**；**信封序列化 allowlist（nodeEnvelope+两适配器）**；**组 data 字面量重建零命中**；**\bmediaUrl\s*: 写入上下文标识符扫描（R2b 后；读取白名单外零命中）**；**每条门禁统一验收步骤=红相实证（故意造一个违规点，确认门禁变红，记录证据——N2 已证明"写正则以为守住了实际假绿"是本仓最贵的失误模式）** |
| Playwright | b0 新键；b1-4 双块；registry 重跑+新 site 裁定后 css-baseline-diff 绿 |

既有测试迁移（v9 全量清单）：§4.1 五值；NormalGroupRenderer.test 三处（border/**组名入框位置**/折叠尺寸）；canvasStore.groups.test.ts:200；StoryboardGroupRenderer.test.tsx:66/:93/:105-110（**含智能标题屏幕层位置**）；**GroupToolbar.test.tsx:63-64/:72 无需改（v8 勘误维持：offset 12 与现状同值、height 不进 top 公式——复核 isAbove 分支即可）**；canvasStore.test.ts:425（TD-Pos）删除/改写；page.test.tsx:18/:71/:72 mock 面复核；useCanvasPersistence.test.ts:127-154 重写；**canvasSnapshot.test.ts:31-33（版本与字面 key）+ :13-51（5 条 parentMap 用例）**；**useCanvasPersistence.test.ts:78-79（键集断言）与 __tests__/useCanvasPersistence.test.ts:9/:44/:50（V2_KEY/清扫）**；**TextInputNode.test.tsx:45-48/:280-286（mock measured 改实测）**；StitchButton.test.tsx:44（2K 不变）；copyNode 4 用例改写为 duplicateNodes 断言；**media.service.spec.ts 6 处形状化（:63/:72/:79/:85/:73/:86-91——:113 属 by-key 块不动）**；**canvas.service.spec.ts:191-195 迁移**；**schemaVersion 5 处红面迁移 + seed version:1 + upsert 化断言**；**batch rewrite 3 个既有消费方回归（useWorkflowAssets/shadowJob/VideoEditNode——直连绝对 URL 行为不变）**；nodeTypes.coverage.test.tsx 不受影响（显式登记）。**行号引用按头部规则在 plan 阶段 grep 现场重验**。

浏览器验收：排列三模式含混选（验证排除项纹丝不动）+ 极端混选留白；副本内容等价；批量下载 ≥5 文件（含许可提示）；组色全链路（设置→刷新→转组→克隆后组色仍在；**模板路径：私有保存→导入图全在（全量基准）+ 公开→跨用户导入媒体降级占位**）；折叠卡 6 图+深浅 7 色 computed 读数；**组名入框后 vs 工具条 12px 余量（多 zoom 档 0.5/1/2 目视）+ 分镜标题与工具条分带不撞（含 1×1 窄组实测；zoom 0.5/2 屏幕层标题恒 13px 目视——v10）+ 拖节点进组顶部不与框内组名重叠（clamp 收编验证）**；展开态 1px 边框可见性；**崩溃恢复：断网/杀进程刷新后"快照独有结构"组保持 + 手动 resize 尺寸保持**；**折叠卡网络面板 ≤1 次 batch 请求且请求带 teamId**；**R0d 后手工验证走私封堵（curl 塞 nodeId/projectId 的 body → 400，forbidNonWhitelisted 可观测）**；**R1a 后干净目录三步构建（shared tsc → nest build → vite build）+ 部署脚本演练**。

## 6. 范围外（R3 具名登记）

- 拖出/+号/批量连线（Spec B）
- **全局 ValidationPipe 立项（v10 登记，独立于 R0d）**：若将来要开全局 `ValidationPipe({whitelist:true, forbidNonWhitelisted:true})`，前置完整清单——① grep 生成全部 ~42 个 `@Body()` DTO class 端点清单；② 逐类断言每个声明属性都有 class-validator 装饰器（按属性断言，非按文件 import 判定——后者假绿）；③ 补 presign/confirm 两个裸 DTO 装饰器；④ forbidNonWhitelisted 必带（漏挂装饰器变 400 可观测而非静默丢字段）+ 客户端多传字段将 400 的显式兼容决策；⑤ 全量 API 测试 + 上传/确认/登录/模板保存四链路冒烟（lighting.controller 等无 pipe 的既有装饰器 DTO 端点会新增校验面，逐一过）
- **队列生产者安全审计（v9 新登记，R0d 后）**：video-separate.controller 已核同类（inline type body 透传+media 无 projectId 时零鉴权+nodeId 可控写目标）——排一次全量队列生产者审计（body 直透/可选鉴权跳过/客户端可控写目标三类面）
- **拼接状态回写组（F31 产品项）**：R0d 已封走私并删 5 键块——R3 立项时**按 DTO 新增字段重新接线**（非"恢复死代码"）；复访条件：产品要"分镜组显示已拼接状态"时
- **其余持久化媒体载体收敛（F37 下批清单）**：thumbnailUrl（ProcessSnapshot 消费）、images[].url（multiImageGen 桥接键）、服务端写入的 videoUrl/resultUrl（execution.service/ai-download.processor）、tiptap 链路（ImageItem.url）
- **batch rewrite 统一化**：R2d 仅折叠卡预取走新 rewrite 入口；既有 3 消费方统一改写需 staging 验证（HTTP Range/大文件/proxy_buffering——生产 nginx 配置不在仓内）
- 克隆完整副本/媒体转存（同 v6）；同用户/同团队自克隆保留产物（未来定向优化）
- 克隆入口 UI 文案（"将复制工作流结构，生成结果需重新生成"——上线必修项登记）
- 大文件下载优化（blob 全量驻留/Content-Disposition/直接 anchor 同源可行性）；zip 打包、进度条；FSA
- useMediaUrl LRU 上限调整（大画布抖动，实测再议）
- 自定义取色器（resolveGroupColor 单函数收敛，纯增量）
- detachedChildren 排列升级路径（实测高频再议）
- 排列后防重叠碰撞规避（接受一次可解释重叠）
