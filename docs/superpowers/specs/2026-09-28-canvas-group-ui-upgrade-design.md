# Canvas 组与分镜组 UI 升级（Spec A）— 设计 spec

- 日期：2026-09-28（第四轮评审修订版 v4）
- 状态：待用户审阅
- 范围：需求 1/2/3/4/8 + 组颜色 + 副本/下载/组色持久化链路根修 + 克隆崩溃/模板往返组结构剥离修复
- 姊妹篇：`2026-09-28-group-geometry-batch-connect-design.md`（Spec B 挂起，待本篇走完三阶段）
- **交付结构**（plan 层执行）：
  - **前置单元 PR①（无用户可见视觉变化，可独立验收回滚）**：`refitGroupGeometry` 纯函数+写入 action、几何镜像结构性订阅（含删两处旧镜像）、`GROUP_NODE_DATA_KEYS` 下沉 shared + **GroupNodeData 类型补全 9 键**、克隆白名单分表（group 9 键，修 F2 崩溃）+ 政策断言、**模板往返组结构修复（F29）**、`normalizeSelection/participation/arrangeRects/shouldAutoRefit/COLLAPSED_SIZE/GROUP_PALETTE` 等全部纯函数与常量
  - **功能单元 PR②**：本篇全部 UI/交互与消费
- 参考代码出处：用户需求原文提供的目标产品（Pippit）DOM 片段，视觉参数已提取进本 spec 各表

## 1. 已证实的库内事实约束（三轮评审实证）

| # | 事实 | 位置 |
|---|---|---|
| F1 | 组 data 变更须双写 nodeStore（syncGroupDataToNodeStore） | canvasStore.ts:22-28 |
| F2 | **克隆路径崩溃面**：buildFilteredSnapshot 仅被快照（video-work.service:327）与克隆（video-work-clone.service:35）调用；克隆→真实画布 `data.storyboard!` 非空断言 TypeError。**快照路径不崩**（ProcessSnapshot 零 store 渲染器，group 只认 __groupType/__name）；**模板路径不经白名单**（template.validation.ts:7 `z.record(z.any())` 透传） | StoryboardGroupRenderer.tsx:12、ProcessSnapshot.tsx:47-55 |
| F3 | canvasStore 节点 data 仅桥接 5 键实时（fileId/referenceImage/status/mediaUrl/images）；**mainImageIndex 不在桥接键**（nodeStore 必填，空 images 时为 -1）——凡读配置一律取 nodeStore 全量 | nodeStore.ts:235/:160/:649 |
| F4 | addEdge 只按 id 幂等；同源判重在 onConnect | canvasStore.ts:471-478/:598-604 |
| F5 | no-color-hex 只拦 Tailwind 任意值类名（bg-[#…]），style 对象/TS 常量 hex 豁免——真约束是主题双值与持久化解耦 | eslint-rules/no-color-hex.js:18-19 |
| F6 | b0 B0-6 只遍历 DOMAIN_TOKENS 数组内键（漏加=假绿）；**b1-4 是 fail-closed**（正则自动发现域 token 定义块+唯一性+源序）且**只在 Playwright 批次跑**（e2e/** 被 vitest 排除）——深浅键集相等断言必须落 vitest | b0-token-blocks.spec.ts:261-263、b1-token-migration.spec.ts:320-332 |
| F7 | **presign 900s/Redis 840s，命中缓存时服务端不知 presign 时刻**（直接返回缓存字符串）——expiresAt 必须把缓存值改为 JSON `{url, expiresAt}` 才真 | media.service.ts:24-31 |
| F8 | fullscreen viewer 直用内存 displayUrl（长开页面可能已过期），带本地 downloading 守卫 | ImageFullscreenViewer.tsx:62-82 |
| F9 | getMediaUrl 返回**相对路径** /flowai/...（同源代理无 CORS、content-type 可读——扩展名映射成立的原因，也是 expiresAt 必须服务端给的原因）；batchGetMedia 无重写（当前不可用） | mediaApi.ts:6/:21-24 |
| F10 | repairStoryboardCells 把不在 cells 的 storyboard 子节点 stray 停放组下方——副本必须重映射 cells（buildGroupCopy :1468 先例） | groupDerive.ts:26-41 |
| F11 | TD-Pos：position→nodeStore 镜像只在 onNodesChange（:546-560 dimensions/setAttributes + :561-578 TD-Pos 两处旧镜像）；**全部既有程序化几何写入点均绕过镜像**（groupNodes/ungroup/addToGroup/dropIntoGroup/removeNodeFromGroup/mergeStoryboard/convertGroup×2/resizeStoryboardGrid/clearStoryboard/addImageToStoryboardCell/removeStoryboardCell/repairStoryboardCells/refitGroupBounds/toggleCollapse/buildGroupCopy/rebuildFromClipboard——不计数，以 grep 为准）——快照存 nodeStore 且 initCollab 先 fillDoc 进 ydoc | canvasStore.ts:546-578、useCanvasPersistence.ts:105、canvasCollabRuntime.ts:240-243 |
| F12 | copyNode 死代码（接口声明 :111 + 实现 :277 + 4 处测试，零生产调用；删除时两处一起删） | grep 证实 |
| F13 | duplicateGroup 无 stopCapturing——"单 undo 步"现状靠 captureTimeout=500 巧合 | canvasUndo.ts:13-27 |
| F14 | B-2 顺序纪律：canvasStore 结构 set 先于 nodeStore 写入 | canvasStore.ts:229 注释、buildGroupCopy :1495-1522 先例 |
| F15 | multiImageGen 无节点级 fileId，主图 = `images[mainImageIndex]?.id`；**主图可能非 success**（isImageCompletedNode 只保证存在任一 success）；mainImageIndex 可为 -1 | MultiImageNode.tsx:81/:105 |
| F16 | 分镜组右上角已有 `data.name` 标签；工具条 storyboard 分支无 转普通组/解组 按钮 | StoryboardGroupRenderer.tsx:57-59、GroupToolbar.tsx:69 |
| F17 | TOOLBAR 常量两工具条共用；折叠 200×64 双硬编码；aria-disabled 仅 cursor；组名行占 -10~-28px，工具条 offset 28 **相切**（取 32 留余量） | selectionTokens.ts:38、canvasStore.ts:1261、NormalGroupRenderer.tsx:44/:89/:95 |
| F18 | convertGroup 两分支整体重建 data（storyboard :1204 自动名 / normal :1218 硬编码'分组'——两方向都丢用户侧字段） | canvasStore.ts:1204/:1218 |
| F19 | StitchButton 现文案 `拼接(${resolution})` 值 '2K'|'4K'，与 STITCH_WIDTH_MAP/服务端 VALID_RESOLUTIONS 大写键联动——**不可改小写** | StitchButton.tsx:189、groupLayout.ts:15 |
| F20 | **改判（v4 拍板）：克隆剥媒体引用是安全政策非缺陷**——Media.teamId 非空外键（schema:324）+ getMediaUrl 非 creator 走 assertTeamMember 异团队 403（media.service.ts:19-21）；video-work 克隆跨用户，images[].id（mediaId）对异团队必 403 破图；resetStatusIdle:true + imageGen 同样"留配方剥产物"（fileId 不在白名单）= 自洽的骨架语义（D9 裁定）。**判据：是媒体引用则剥（fileId/mediaUrl/referenceImage/images 内 id），非媒体结构则留**（cells 是节点 id、storyboard 是配置，无鉴权面） | media.service.ts:15-21、prisma/schema.prisma:324、snapshot-filter.util.ts:22/:36-39/:100-103 |
| F21 | clone/snapshot **共用一张 WHITELIST**（:33 注释 D9 裁定），但消费端契约不同：clone→真实画布需全字段；snapshot→ProcessSnapshot 只认 groupType/name——:87"collapsed/storyboard 剥离"是 snapshot 端**刻意载荷收敛**，不应顺带推翻 | snapshot-filter.util.ts:33/:42、snapshot-filter.util.spec.ts:87-92 |
| F22 | **展开态普通组无 border**（仅背景 div，测试断言 `border===''` 是设计意图——选中反馈交四角手柄）——组色边框着色载体需本次新增 | NormalGroupRenderer.tsx:59-65、NormalGroupRenderer.test.tsx:32/:36 |
| F23 | 宫格文案**已实现**且为 `宫格 {rows}×{cols}`（spec 初稿写 {cols}×{rows} 属静默改文案——照抄既有） | GridSizeDropdown.tsx:56 |
| F24 | GroupContextMenu 仅 创建副本/复制/粘贴/删除，**无重命名**——折叠态重命名无入口 | GroupContextMenu.tsx:95-111 |
| F25 | parity 跨包不可直接实现：API 不能 import web 源码；正解先例 = VIDEO_WORK_NODE_TYPES 下沉 packages/shared + spec 文件值导入 | packages/shared/src/types/video-work.ts:74、snapshot-filter.util.spec.ts:5 |
| F26 | **registry 是生成产物**（canvas-migration-registry.mjs 按 COLOR_RE 扫描产出 partitions，四手工键保留）——正确动作是重跑生成器+裁定新 site 增量，非手编 :434/:459 | apps/web/scripts/canvas-migration-registry.mjs |
| F27 | clone 的 remapIds 只重映射 group.cells（悬空→null），不碰 images——images 进白名单后其 mediaId 不受影响 ✓；video-work-clone.service.spec.ts:21 组夹具无 storyboard（修白名单后需补，否则崩溃面无覆盖） | video-work-clone.service.ts:52-78 |
| F28 | 分镜组三个子组件硬编码 #fff/#666/#aaa（style 对象豁免 lint 但嵌新容器会"新瓶旧字"） | AspectRatioDropdown/GridSizeDropdown/StitchButton |
| F29 | **模板往返剥离组结构（比 F2 更严重的既有缺陷）**：导出侧 canvas.service.ts:77-79 显式四键重建（parentId/width/height 丢失）；导入侧 template.service.ts:242-246 同款且 **cells 无重映射**（idMap 只管 id/edges）；NodeSchema 未声明三字段且 zod 默认 strip + 两处 validateTemplateData 返回值被丢弃（:88/:225）——**仅补导出字段而不改 schema+用返回值，导入时仍被剥**。接收端 project.service 支持 parentId/width/height。后果：模板导入后组散架+组框 0×0+cells 悬空（repairStoryboardCells 被动停放兜底） | 同左 |
| F30 | **GroupNodeData 类型仅 5 键**（groupType/name/collapsed/cells/storyboard）——manuallyResized/savedSize 是 de-facto 契约（toggleCollapse:1260/markManuallyResized:1247 写入、恢复路径消费）却未进类型；v4 再增 color/nameCustom——**类型不补全到 9 键，parity 锚定是假的**（类型说得少断言就查得少） | types/group.ts、canvasStore.ts:1247/:1260 |

## 2. 需求清单（本篇）

| # | 需求 | 关键口径（三轮拍板/实证后） |
|---|---|---|
| 1 | 多选虚线框 padding 16→30px | 五值直接照抄 |
| 2 | 多选工具条：`[排列▾] │ [创建副本] │ [打组▾] [批量下载] │` | 排列=排除 detached+提示；副本全链路保真 |
| 3 | 组工具条：`[颜色点] [排列子节点▾] │ [折叠] [整组执行] [转分镜组] [解组] │ [批量下载]` | 组色语义 key；展开态新增 1px 边框 |
| 4 | 折叠宫格预览卡 220×160 | 尺寸单源；expiresAt JSON 缓存根修 |
| 8 | 分镜组视觉 + 工具条 | 白名单**分表**；渲染层双防线；智能标题 |

## 3. 跨篇契约与不变量（Spec B 共同遵守）

1. **坐标不变式**：任何选中集合动作先区分成员容器；子节点一律以 `abs = parent.position + rel` 参与运算。选区归一化两段式：`normalizeSelection(nodes, ids) → {groups, looseRoots, detachedChildren}`（**纯函数显式传 nodes**，不隐式读 store）+ `participation(bucket, action) → ids`（**逐动作策略表**：排列排除 detached；下载/副本/+号源集[B] 全纳入；B 行含折叠组 hidden/组节点裁决占位，B 审核时定）。策略表是唯一裁决点，防散落 if。
2. **组框不变式（scope 限定）**：`组框 ≡ bbox(成员)+四向 padding` 仅适用于 `normal && !collapsed && !manuallyResized`；**折叠态几何恒为 COLLAPSED_SIZE、手动组保留用户尺寸——两者是显式例外**。门禁抽纯函数 `shouldAutoRefit(group)` 三处同源消费：refitGroupGeometry 内置、refitExpandedGroups（现有）、useCanvasPersistence 恢复循环（现有）。
3. **原子块定义**：组在排列/副本中 = stored rect（折叠=COLLAPSED_SIZE、分镜=calcStoryboardSize）；**detachedChildren 排列时排除不动 + toast 提示**（拍板：排列是几何命令不拥有改变成员关系的能力；脱离只发生在 removeNodeFromGroup/ungroup/dropIntoGroup 三个带守卫入口）；**副本中 detached 一律顶层化**（parentId=undefined+绝对坐标+offset）。
4. **手动尺寸策略**：A 的排列子节点=显式几何命令，清 `manuallyResized`（同时 `syncGroupDataToNodeStore`——data 变更非几何镜像面）；B 的拖动口径在 B 审核时定（倾向收紧为"越出当前框才清"）。
5. **几何唯一写者 + 结构性镜像（边界钉死）**：`refitGroupGeometry`（纯函数）+ `applyGroupFrame`（写入 action）是组几何唯一出口。**几何镜像结构性订阅**替代 per-action 手动镜像（writePositions 废弃），四条字面约束：
   - **挂载点**：独立 `useGeometryMirror(projectId)` hook 或挂 useCanvasPersistence（**不得挂 bindBridge**——它只在 initCollab 调用，未连协作/单测环境镜像不生效）；断言"离线时程序化几何同样镜像"
   - **字段语义**：**仅镜像显式 width/height**（undefined=未测量约定，不折算 measured——否则所有节点恢复后带显式尺寸，行为面无声扩大）
   - **update-only**：绝不 create、绝不写 data（防新节点 ns.addNode 前被订阅用 canvasStore 陈旧 data 覆写——与 F14/B-2 顺序正面对撞）
   - **删除两处旧镜像**：onNodesChange :546-560（dimensions/setAttributes）与 :561-578（TD-Pos）——否则同字段三写者并存且旧块写 clamp 中间值
   - 机制防护：镜像写 nodeStore 前置模块 flag 使 unsubNs 早退（防双倍同步开销——doc 几何已由 canvasStore 订阅写入）；断言"远端 apply 后 undoStack 长度不变"（防回声进本地撤销栈）；**"几何三字段不在 CANVAS_BRIDGE_KEYS"写成测试**（防未来加键死循环——nodeStore→canvasStore 反向桥已存在）；断言"选中态翻转不产生 nodeStore 写入"（性能护栏）
   - **B 交界节流口径（现在定死）**：订阅内仅对 `!dragging` 的节点镜像——Spec B 拖动中逐帧 refit 不进 nodeStore/CRDT/快照，拖动结束（dragging=false）一次镜像
   - 收口验收线：程序化几何写入后 canvasStore 与 nodeStore 的 position/width/height 逐节点相等；refit 连续两次几何不变（幂等）

## 4. 详细设计

### 4.1 多选虚线框（需求 1）

`SELECTION_BOX.padding: 16 → 30`。测试几何断言**直接照抄**（left/top 减一次、width/height 加两次）：194→**180**、352→**338**、132→**160**、164→**192**、翻转 68→**84**。

### 4.2 Token 与门禁（前置）

- `TOOLBAR` 拆 `SELECTION_TOOLBAR={40,14}` / `GROUP_TOOLBAR={44,32}`（28 相切取 32 留余量）。
- index.css **在既有唯一双块内**追加（不得另起块，b1-4 硬红）：`--canvas-storyboard-shell-bg`（#212121/#f7f8f8）、`--canvas-group-border`（#3a3a3a/**浅档加深至 ~3:1 档**——#e5e7eb vs 板面 #F5F5F5 仅 1.12:1 不可见，取 #c7ccd3 系并进对比度表）、组色板 7 支 `--canvas-group-color-{red,orange,yellow,green,cyan,blue,purple}`（浅档深色变体保 ≥3:1 vs 亮档 #F5F5F5，黄→#a16207 系）。
- **文字不使用组色**；组色载体 = 组框边框 + 色点 + 徽标**描边**（BADGE 现为 #3f3f3f 底白字——组色上描边不上底色，防黄/青底白字不可读）。
- 门禁：b0 `DOMAIN_TOKENS` 数组加 9 键+DARK/LIGHT 值（漏加=假绿，补"新键在迭代列表内"断言）；**深浅域键集相等断言落 vitest**（b1-4 只在 Playwright 批次）；registry（F26）：`node scripts/canvas-migration-registry.mjs` 重跑刷新 + 新 site（token 消费/折叠卡 hex/工具条 rgba→var 改写，预估 20-40 条）在 differExpectedPairs/adjudications **逐条裁定**——这是门禁主要成本；`css-baseline-diff` 的 D 段配对是闸门真源（未配对=失败）。

### 4.3 多选工具条（需求 2）

**视觉规格**（完整参数）：容器 padding 8 / gap 8 / 圆角 12 / 0.5px 边框 `--canvas-controls-border` / 背景 `--canvas-controls-bg` / 阴影 rgba(0,0,0,0.08) 0 4px 10px / blur 16；定位选框上缘中点 `translate(-50%,-100%) translateY(-14px)`；按钮 h-8 / px-2 / 圆角 8 / 13px / controls-text / hover controls-hover；下载 32×32 图标钮（aria-label=批量下载）；分隔线 1px controls-border；排列菜单浮层同容器视觉 min-width 120px 三项宫格/水平/垂直；徽标"N 项"留选框左上角。打组▾ 下拉保留两项及禁用条件。

**arrangeSelection(mode)**：
- 参与集 = `participation`：groups（原子块 stored rect）+ looseRoots；**detachedChildren 排除且不参与任何几何计算（含中心锚定——中心只用参与项包围盒，保证"只动参与项"）**
- 参与项 <2 → no-op + 提示"没有可排列的节点：所选节点均在未选中的组内"；有排除时 toast："N 个组内节点未参与排列（需调整请先选中其所在组）"
- `arrangeRects(rects, mode)`：grid 列数 calcDefaultGrid(n)（n=2 时 1×2≡horizontal 属预期）；ARRANGE_GAP=60；**cell=行 max 高×列 max 宽、节点按 cell 左上角落位（自身尺寸不变）**；n≤1 no-op；包围盒中心不变
- 写回：looseRoots 绝对 position、groups 组 position——经**几何镜像订阅**自动同步 nodeStore（契约 5，无需手动）；单次 setWithParentOrder；排后 applyGroupDerivations + 保持原选区
- **反向断言：排列前后全体节点 parentId 分布逐节点相等**（防脱离语义回潮）；**极端混选留白属预期**（验收样例：组 642×362 + 节点 300×300 同排）

**duplicateSelection() → duplicateNodes(ids, offset)**：
- 闭包 = 三桶全展开（detached **副本一律顶层化**：parentId=undefined+绝对坐标+offset——原节点留组内）；data 一律取 nodeStore 全量；**storyboard 组 cells 重映射**（新 cells=cells.map(id=>idMap.get(id)??null)，stray 语义与 clone remapIds 对齐）；折叠组副本继承 collapsed/savedSize
- 选区闭包互连边重映射；组 selected=true 子 false；偏移 `DUPLICATE_OFFSET={40,0}`；**顺序（F14）**：canvasStore set 先于 ns.addNode
- **undo（F13）**：入口 stopCapturing()；断言 500ms 内连点两次=2 undo 项
- **副本体系统一**：copyNode 删除（:111+:277+4 测试）；duplicateGroup=duplicateNodes([id],DUPLICATE_OFFSET) 特例；copyGroupToClipboard/paste 链路复制时从 nodeStore 取全量 data

**批量下载**：
- `downloadMediaFile({fileId?, url?, filename})`：url 优先、缺则 fileId 现取；**fetch 失败且有 fileId → 重取一次 URL 再试**（长开页面 viewer url 过期自愈；viewer props 增可选 fileId 透传，调用方手里有 targetFileId）；`a.download=filename` → click → `setTimeout(revoke,60_000)`；失败 message.error 继续（批量不走 window.open fallback）
- **收集一律读 nodeStore data（F3——mainImageIndex 不在桥接键）**：图片 `fileId||referenceImage`（isImageCompletedNode 三型）；multiImageGen **主图=images[mainImageIndex]（success）→否则首个 success→否则跳过**（-1/越界=跳过，F15）；视频完成 fileId
- 文件名链：`data.mediaName ?? \`${类型}-${短id}\``；multiImageGen 主图用 images[i].name；扩展名 content-type 映射+按类型兜底
- 4 处切换（节点传 fileId、viewer 传 url+fileId，downloading 态留本地）；串行+i*300ms；>10 项先提示"将依次下载 N 个文件"；完成提示"已触发 N 个下载"+首次批量前提示浏览器许可；无可下载 aria-disabled+handler 守卫

### 4.4 组工具条与组颜色（需求 3）

容器 `GROUP_TOOLBAR.offset=32` portal 屏坐标层、视觉同 4.3；按钮 h-9 圆角 10、色点钮 size-10 内 20px 圆、下载 size-9。折叠/整组执行/转分镜组/解组行为与禁用条件不变。

**展开态新增 1px 边框（拍板）**：`border: 1px solid var(--canvas-group-border)`；设组色时 `border-color: var(--canvas-group-color-<key>, var(--canvas-group-border))`；同步改 NormalGroupRenderer.test.tsx:32/:36 断言（''→1px ...）；选中态维持四角手柄反馈不变。

**组颜色（语义 key）**：
- `utils/groupColor.ts` 单源：`GROUP_PALETTE`（7 键）派生 `GroupColorKey` 与 `GROUP_COLOR_MAP`；**收敛 `resolveGroupColor(value) → CSS 值 | undefined` 唯一函数**（不预留 '#custom' 联合——将来支持自定义只改此函数）
- `GroupNodeData.color?: GroupColorKey`（无 gray；undefined=默认）；浮层 7 彩点+"默认"清除项
- 双兜底：边框/徽标描边 `var(--canvas-group-color-<key>, var(--canvas-group-border))`；色点钮内圆 fallback 复用中性 token（不新增单值键）
- 未知 key 按未设色（resolveGroupColor 返回 undefined）不抛错；写入端 `if(!(key in GROUP_COLOR_MAP)) return`；后端仅形状过滤（typeof string 校验防注入畸形 CSS 值，不复制枚举）
- `setGroupColor` 双写 syncGroupDataToNodeStore
- `convertGroup` 两方向保 {name, nameCustom, color}：normal→storyboard 置 nameCustom:false+自动名+保 color；storyboard→normal `nameCustom? 原 name : '分组'` + nameCustom:false + 保 color（修 F18，两方向逐字段断言）

**排列子节点** `arrangeGroupChildren(groupId, mode)`：**折叠态禁用**（工具条菜单项 disabled + 函数首行 `if(data.collapsed) return`——折叠是唯一挡排列的例外）；**排列是显式几何命令：先清 manuallyResized（+syncGroupDataToNodeStore data 双写）再走 applyGroupFrame**（手动组排列生效，配"手动组排列生效"测试——不是被 shouldAutoRefit 门禁挡掉）；子节点绝对 rect→arrangeRects→经 `refitGroupGeometry/applyGroupFrame`（契约 5 唯一写者，镜像订阅自动同步 nodeStore）；单次 setWithParentOrder；仅普通组。

### 4.5 折叠宫格预览卡（需求 4）

- `COLLAPSED_SIZE={220,160}` 单源（toggleCollapse+渲染层+canvasStore.groups.test.ts:200 断言 200→220）
- 结构：预览宫格（padding 6/gap 4/圆角 6）+ summaryRow" N 个节点"；列数 1-2→按数量/3-4→2 列/5+→3 列；≤6 tile；tile 独立组件 useMediaUrl(fileId)；其它类型图标占位
- **useMediaUrl 缓存根修（F7 正解，v4 加固）**：服务端 Redis 缓存值改 JSON `{url, ttlSec}`（**缓存键硬要求版本化 `media:url:v2:${teamId}:${fileId}`**——防新旧 pod 混布窗口旧代码把 JSON 串当 URL 返回全站裂图；旧缓存 840s 自然过期；**assertTeamMember 先于缓存读的顺序不动**）；未命中 ttlSec=900；响应返回**相对秒数 ttlSec 而非绝对 expiresAt**（规避客户端时钟偏移误判临期，客户端 now+ttl*1000）；客户端模块级缓存 `fileId→{url,expiresAt}`（**键=fileId 跨项目安全：值为相对路径与项目无关**），临期 <60s 重取、onError 失效重取一次、LRU 上限 64、**清空触发点：page.tsx 项目切换分支调用 `clearMediaUrlCache()`（指名挂点，防"写了注释没人调"）+ 切项目后同 fileId 重取测试**；getPresignedUrlByKey 不在范围（banner 专用）
- 组色着色折叠卡边框（双兜底）；**选中态优先级：选中高亮 > 组色**（折叠卡与展开态组框同规则）；根元素 `title={组名}` + `aria-label="{组名}，N 个节点"`（原生 title 主题不可控，已知接受项）；重命名入口 = **右键菜单新增"重命名"项**（修 F24，与 nameCustom 配套，CanvasView 门不分普通/分镜一次覆盖）+ 展开态双击

### 4.6 分镜组改版（需求 8）

- 主体：背景 `var(--canvas-storyboard-shell-bg)`、边框 `1px var(--canvas-group-border)`；行为不变
- **渲染层双防线（修 F2 消费侧）**：`const cfg = data.storyboard ?? DEFAULT_STORYBOARD_CONFIG`（默认 16:9/1×1/showIndex:false/2K）——数据层补白名单+消费层容错两道；组件测试"缺 storyboard 不崩退默认"
- 智能标题（纯标记）：`nameCustom`——renameGroup 置 true、自动生成置 false；标题=nameCustom?name:`分镜组 ${cells.filter(Boolean).length} 个节点`；替换右上标签（不共存）；左上角外 8px、13px muted、超长省略
- 工具条：`[比例▾] [宫格 r×c▾] │ [拼接(2K/4K)] [序号] [清空] [转普通组] │ [解组]`
  - 宫格文案**照抄既有 `宫格 {rows}×{cols}`**（F23——已实现，仅视觉重排）；拼接维持 '2K'|'4K'（F19 不可小写）
  - 转普通组/解组=新增按钮（语义区分：转普通组=组保留子节点入组内网格；解组=组消失子节点散落）；三子组件（F28）硬编码色同批换 controls token
  - 无折叠/整组执行
- **后端白名单分表（F21 定稿，v4 依 F20 改判收敛）**：
  - `FilterOptions` 增 `whitelist?: Record<string,string[]>`（不传=现 WHITELIST）
  - **snapshot 端维持现表**（:87 断言不改——公开载荷收敛是刻意裁定，ProcessSnapshot 只映射 __groupType/__name）
  - **clone 端新表 = snapshot 表 + `group: [...GROUP_NODE_DATA_KEYS]`（9 键）**——multiImageGen **维持 ['prompt','label']**（F20 改判：媒体引用一律剥离，骨架语义）；白名单处注释写死政策："媒体引用一律剥离（fileId/mediaUrl/referenceImage/images 内 id）——克隆跨用户，getMediaUrl 对异团队 403（media.service.ts:19-21 + schema teamId 非空）。剥离是安全结果非字段遗漏；克隆=工作流骨架，产物需重新生成。若将来要连产物复制，必须先做服务端媒体转存/重新归属（含配额），不是白名单改动"
  - **政策断言（防再误读）**：clone spec 锁 `multiImageGen.data.images === undefined`、`imageGen.data.fileId === undefined`；`isImageCompletedNode(克隆体) === false`（不能转分镜组/批量下载）为**预期行为断言**
  - video-work-clone.service.ts:35 传 clone 表
- **GROUP_NODE_DATA_KEYS 下沉 packages/shared + 类型补全（F25/F30）**：**先把 types/group.ts 的 GroupNodeData 从 5 键补到 9 键**（manuallyResized/savedSize 是 de-facto 契约必须显式化，+color/nameCustom）——类型不补全 parity 是假的；`packages/shared/src/types/group.ts` 导出 `GROUP_NODE_DATA_KEYS` 运行时 const 数组，**双向锚定 idiom**（单向 satisfies 只保证 ⊆，漏字段不报错）：`as const satisfies readonly (keyof GroupNodeData)[]` + `Exclude<keyof GroupNodeData, typeof KEYS[number]> extends never` 编译期检查；API spec 值导入断言 `clone 表 group ⊇ GROUP_NODE_DATA_KEYS`
- clone spec 夹具补 storyboard（F27）；跨包断言**拆两条可实现**：① API spec 断言 clone 输出含 data.storyboard（形状）；② web 组件测试断言"有/无 storyboard 两分支都不崩"——**不写跨包 e2e**
- **模板往返修复（F29，并入 PR① 与克隆修复同批）**：① 导出侧 canvas.service.ts:77-79 补 parentId/width/height；② 导入侧 template.service.ts:242-246 补同三字段；③ **NodeSchema 声明三字段 + 两处改用 validateTemplateData 返回值**（zod 默认 strip，只补导出不动 schema 导入仍被剥）；④ 导入侧 idMap 循环补 cells 重映射（语义照 clone remapIds：悬空→null 长度不变）；⑤ 验收：带组画布→存为模板→新项目导入→断言 parentId/组框尺寸/cells 三者保留（此测试修复前必红）
- **克隆+模板缺陷修复作为独立 commit 先行落地**（已上线路径用户可见缺陷，可独立验收回滚）

## 5. 测试策略（TDD）

| 层 | 内容 |
|---|---|
| 纯函数 | arrangeRects（三模式/混排对齐/中心仅参与项/n≤1/**参与项 0 与 1 分别提示**）；normalizeSelection(nodes,ids) 三桶 + **participation 策略表逐动作**；折叠卡列数；refitGroupGeometry 守恒+幂等+**折叠豁免**；shouldAutoRefit |
| store | arrangeSelection（**parentId 逐节点不变反向断言**/排除项零位移含中心/参与<2 提示/保持选区/单 set）；duplicateNodes（nodeStore data 全等/cells 重映射/detached 副本顶层化/B-2 顺序/连点=2 undo）；duplicateGroup 复用路径；setGroupColor（双写/未知 key 拒写）；convertGroup 两方向 {name,nameCustom,color}；arrangeGroupChildren（守恒/**折叠 no-op**/清标记+data 双写）；折叠 220；**几何镜像订阅**（程序化写 position/width/height 后 nodeStore 同步/循环防护） |
| util | mediaDownload（双入口/**url 失效 fileId 重取**/revoke 延迟/失败 message）；useMediaUrl（同 fileId 二次挂载 0 请求/**ttlSec 临期重取**/onError 自愈/**切项目 clearMediaUrlCache 后重取**）；**下载收集主图非 success 用例**（主图 error→首个 success；-1/越界→跳过——显式测试非注释） |
| 组件 | SelectionBoxOverlay（按钮序/排列菜单/下载守卫）；GroupToolbar（新按钮序/色板浮层/storyboard 补两按钮/portal 位置断言更新）；**NormalGroupRenderer（展开态 1px 边框断言替换 ''/折叠态 name+badge→"N 个节点"/220×160）**；CollapsedPreviewCard（列数/tile/title+aria）；StoryboardGroupRenderer（shell/智能标题两分支/**缺 storyboard 容错**/右上标签删除） |
| API | 分表后：snapshot 表维持（:87 不变）；clone 表 group ⊇ GROUP_NODE_DATA_KEYS（spec 值导入）；**政策断言：clone 输出 multiImageGen.images===undefined、imageGen.fileId===undefined**；clone 夹具补 storyboard → 输出含 data.storyboard（形状）；**模板往返**：导出/导入/schema/返回值/cells 五点各有断言（F29 ⑤ 端到端红→绿） |
| shared | GROUP_NODE_DATA_KEYS 双向锚定（Exclude idiom）；**GroupNodeData 9 键类型补全后 keyof 一致** |
| vitest 门禁 | 深浅域键集相等；**TS GROUP_PALETTE 键集 ↔ CSS --canvas-group-color-* 变量集——用 readFileSync(index.css)+正则实现（RunButton.test.tsx:26 先例；jsdom computed 不解析外部 CSS 变量名，写成 computed 断言永远空串）** |
| 镜像订阅 | 程序化几何写入后双 store 逐节点相等（收口验收线）；远端 apply 后 undoStack 不变；选中态翻转零 nodeStore 写入；几何字段不在 CANVAS_BRIDGE_KEYS；离线镜像生效；**!dragging 节流**（dragging 中零 nodeStore 写入） |
| Playwright | b0 新键；b1-4 双块；registry 重跑+新 site 裁定后 css-baseline-diff 绿 |

既有测试迁移：§4.1 五值；NormalGroupRenderer.test.tsx 三处（border/折叠/尺寸）；canvasStore.groups.test.ts:200；StoryboardGroupRenderer.test.tsx:66（标题浮层插格子后）/:93（边框 verbatim）/:105-110（右上→左上智能标题）；GroupToolbar.test.tsx:58/:67（offset 重算）；StitchButton.test.tsx:44（2K 不变无需改）；**copyNode 4 用例改写为 duplicateNodes 断言**（保真回归覆盖不丢——imageExtGen 类型保留/宽高传递/extConfig 完整三点本质是复制保真，非死代码）。

浏览器验收：排列三模式含混选（**验证排除项纹丝不动**）+极端混选留白（可接受阈值：留白 ≤ 参与项最大边长，验收时目视）；副本内容等价；批量下载 ≥5 文件（含许可提示）；组色全链路（设置→刷新→转组→**克隆后组色仍在**——快照端为刻意载荷收敛不在断言面；**模板路径按 F29 修复后单独验收组结构/尺寸/cells/组色**）；折叠卡 6 图+深浅 7 色 computed 读数；组名浮层 vs 工具条 32px 余量；展开态 1px 边框（浅档加深后可见性）与选中手柄不打架、与背景块+20/50 padding 视觉关系目视。

## 6. 范围外

- 拖出/+号/批量连线（Spec B）
- **克隆完整副本/媒体转存**（独立立项：服务端复制 media 行或公开派生 URL+配额口径+权益裁定——复访条件：产品要"同款即用"时启动，届时放开 fileId/images/status 并去 resetStatusIdle）
- **同用户/同团队自克隆保留产物**（media.userId===userId 或同团队不 403，技术安全——未来定向优化，不封死）
- **克隆入口 UI 文案**（"将复制工作流结构，生成结果需重新生成"——videos 页面侧，登记上线必修项，防"克隆出一片空节点以为坏了"）
- FSA showDirectoryPicker（YAGNI 登记）
- 折叠卡显示组名（title/aria 已解决）
- zip 打包、进度条
- 自定义取色器（resolveGroupColor 单函数收敛，将来纯增量）
- batchGetMedia 补重写+启用批量端点（1 行重写+ttlSec 透传，登记为启用前置）
- getPresignedUrlByKey ttlSec（banner 专用）
- detachedChildren 排列升级路径（自动纳入父组为原子块——纯 UX 零数据模型改动，实测高频再议）
- 排列后防重叠碰撞规避（接受一次可解释重叠）
