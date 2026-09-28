# Canvas 组与分镜组 UI 升级（Spec A）— 设计 spec

- 日期：2026-09-28（第二轮评审修订版）
- 状态：待用户审阅
- 范围：需求 1/2/3/4/8 + 组颜色 —— UI/交互改版 + 副本/下载/组色的全链路持久化修复
- 姊妹篇：`2026-09-28-group-geometry-batch-connect-design.md`（Spec B：拖出 + +号批量连线）
- **依赖顺序**：本篇与 Spec B 的纯函数层（refitGroupGeometry / decideGroupMembership，见 §5 跨篇契约）无相互依赖，可并行；Spec B 的拖动交互层依赖本篇的 normalizeSelection 与几何 primitive。**几何 primitive 由本篇先行落地**（arrangeGroupChildren 消费），B 复用
- 参考代码出处：用户需求原文提供的目标产品（Pippit）DOM 片段，视觉参数已提取进本 spec 各表

## 1. 已证实的库内事实约束（两轮评审实证）

| # | 事实 | 位置 |
|---|---|---|
| F1 | 组 data 变更必须双写 nodeStore（`syncGroupDataToNodeStore`） | canvasStore.ts:22-28 |
| F2 | 后端快照 data 白名单 `group:['groupType','cells','name']` 会剥离一切新增字段；`data.storyboard!` 非空断言 + storyboard 被剥 = 模板/克隆路径既有 TypeError 崩溃面 | snapshot-filter.util.ts:42、StoryboardGroupRenderer.tsx:12 |
| F3 | canvasStore 节点 data 仅桥接 5 键实时（fileId/referenceImage/status/mediaUrl/images），复制必须从 nodeStore 取全量 | nodeStore.ts:235 |
| F4 | `addEdge` 只按 id 幂等；同源判重在 `onConnect` | canvasStore.ts:471-478/:598-604 |
| F5 | **no-color-hex 只拦 Tailwind 任意值类名形态（bg-[#…]），style 对象/TS 常量 hex 天然豁免**——"落 CSS 过 lint"不成立；真约束是主题双值与持久化解耦 | eslint-rules/no-color-hex.js:18-19 |
| F6 | b0 B0-6 只遍历 `DOMAIN_TOKENS` 数组内键（新键不加入=断言不执行=**假绿**）；**b1-4 才是 fail-closed**：正则自动发现全部 `--canvas-\|--ve-\|--vw-` 定义块，断言深块唯一+选择器字面量 `:root, .dark`+浅块唯一+源序在后——**色板不得另起 :root/.light 块** | b0-token-blocks.spec.ts:261-263、b1-token-migration.spec.ts:320-332 |
| F7 | presign 900s / 服务端 Redis 840s——客户端缓存的 TTL 必须感知真实到期 | media.service.ts:29-30 |
| F8 | fullscreen viewer 直用内存 displayUrl（不调 getMediaUrl），带本地 downloading 守卫 | ImageFullscreenViewer.tsx:62-82 |
| F9 | `batchGetMedia` 无 /flowai 重写（getMediaUrl/getPresignedUrlByKey 才有）——本篇不启用批量端点 | mediaApi.ts:6/:21-24/:36 |
| F10 | repairStoryboardCells 把不在 cells 的 storyboard 子节点 stray 停放到组下方——副本不重映射 cells 会被掏空；buildGroupCopy 已有重映射（新实现必须继承） | groupDerive.ts:26-41、canvasStore.ts:1468-1470 |
| F11 | TD-Pos：position→nodeStore 镜像只在 onNodesChange（:561-578）；快照存 nodeStore（useCanvasPersistence.ts:105）且 initCollab 先把快照 fillDoc 进 ydoc（:240-243）——**程序化写 position 不镜像 = 陈旧坐标参与 CRDT 合并** | 同左 |
| F12 | `copyNode` 是死代码（仅定义 + 4 处测试，零生产调用） | grep 证实 |
| F13 | duplicateGroup/buildGroupCopy 无 stopCapturing——"单 undo 步"现状靠 captureTimeout=500 窗口巧合 | canvasUndo.ts:13-27 |
| F14 | B-2 顺序纪律：canvasStore 结构 set 必须先于 nodeStore 写入（防订阅提前 sync 走陈旧 fallback 覆写 doc） | canvasStore.ts:229 注释、buildGroupCopy :1495-1522 先例 |
| F15 | multiImageGen 无节点级 fileId，主图 = `images[mainImageIndex]?.id` | MultiImageNode.tsx:105 |
| F16 | 分镜组右上角已有 `data.name` 标签（name 计数写死会过期）；工具条 storyboard 分支无 转普通组/解组 按钮 | StoryboardGroupRenderer.tsx:57-59、GroupToolbar.tsx:69 |
| F17 | `TOOLBAR` 常量两工具条共用；折叠 200×64 双硬编码；`aria-disabled` 仅 cursor 不拦点击；组名行（含徽标）占 -10~-30px，工具条 offset 28 会重叠 2px | selectionTokens.ts:38、canvasStore.ts:1261、NormalGroupRenderer.tsx:44/:95、index.css:116-120 |
| F18 | convertGroup 两分支整体重建 data（storyboard :1204 / normal :1218）——name/color/nameCustom 都会丢 | canvasStore.ts:1204/:1218 |
| F19 | `useMediaUrl` 无缓存无重试；StitchButton 现文案 `拼接(${resolution})` 值为 '2K'\|'4K' | useMediaUrl.ts、StitchButton.tsx:189 |

## 2. 需求清单（本篇）

| # | 需求 | 关键口径（拍板/实证修正后） |
|---|---|---|
| 1 | 多选虚线框 padding 16→30px | 屏幕像素不随 zoom；titleExtra 26 不动 |
| 2 | 多选工具条：`[排列▾] │ [创建副本] │ [打组▾] [批量下载] │` | 排列三桶口径；副本全链路保真（cells/data/边） |
| 3 | 组工具条：`[颜色点] [排列子节点▾] │ [折叠] [整组执行] [转分镜组] [解组] │ [批量下载]` | 组颜色语义 key 持久化 |
| 4 | 折叠宫格预览卡 220×160 | 尺寸单源；URL 缓存根修 expiresAt |
| 8 | 分镜组视觉 + 工具条 | 转普通组/解组新增按钮；智能标题纯标记口径 |

## 3. 跨篇契约与不变量（Spec B 共同遵守，单列防漂移）

1. **坐标不变式**：任何"选中集合"动作（排列/副本/下载/+号源集）先回答每个成员是根节点还是某组子节点；子节点一律以 `abs = parent.position + rel` 参与运算，写回按目标容器反向换算。normalizeSelection 产出三桶 `{ groups, looseRoots, detachedChildren }`（组原子块 / 顶层散节点 / **被选中但其组未被选中的子节点**）。
2. **组框不变式**：组框 ≡ bbox(成员) + (GROUP_PADDING, GROUP_PADDING_TOP, GROUP_PADDING, GROUP_PADDING)，即 min(rel)=(20,50)。`refitGroupGeometry`（守恒式，本篇先行落地）与 B 的拖动跟随都产出该形态；refit 因此幂等（可断言连续两次调用几何不变）。
3. **原子块定义**：组在排列/副本中 = 组框矩形（折叠态 = COLLAPSED_SIZE 220×160，分镜组 = calcStoryboardSize 矩形，**用 stored rect 不算内容尺寸**）；detachedChildren 参与排列时**自动脱离组**转顶层（拍板口径，与拖出语义一致）。
4. **手动尺寸策略**：用户显式几何命令（拖动子节点[B] / 排列子节点[A]）即重置 `manuallyResized=false`——A/B 同一口径。

## 4. 详细设计

### 4.1 多选虚线框（需求 1）

`SELECTION_BOX.padding: 16 → 30`。既有几何断言**直接按下列数值改**（padding 在 left/top 减一次、width/height 加两次，非 +14 平移）：SelectionBoxOverlay.test.tsx 中 194→**180**、352→**338**、132→**160**、164→**192**，翻转用例 68→**84**。

### 4.2 Token 与门禁（前置）

- `TOOLBAR` 拆 `SELECTION_TOOLBAR={height:40, offset:14}` 与 `GROUP_TOOLBAR={height:44, offset:32}`（28 与组名行 -10~-30px 实际重叠 2px，取 32 留余量；目视验收项）。
- index.css **在既有唯一 `:root,.dark` / `.light` 双块内**追加（不得另起块——b1-4 硬红）：
  - `--canvas-storyboard-shell-bg`：深 `#212121` / 浅 `#f7f8f8`
  - `--canvas-group-border`：深 `#3a3a3a` / 浅 `#e5e7eb`
  - 组色板 **7 支**（拍板：灰色并入"默认"清除项，`undefined` 承载默认态，色板不留 gray 键）：`--canvas-group-color-red/orange/yellow/green/cyan/blue/purple`，浅档用深色变体保 WCAG 1.4.11 ≥3:1 vs `--canvas-board-bg` 亮档 #F5F5F5（黄 #fadb14 → 浅档 #a16207 系）
- **文字不使用组色**（黄/青浅档文字对比度不可兼得，拍板简化）：组色只上 组框边框 + 色点 + 小徽标；组名文字保持现中性 token——8→7 支变量，不增 -text 支
- 门禁执行（按 F6 修正）：
  - b0：`DOMAIN_TOKENS` 数组加 9 键 + `DOMAIN_DARK/DOMAIN_LIGHT` 加值——**漏加迭代列表 = 假绿**，补一条断言"新键在 DOMAIN_TOKENS 内"；`TOKENS` 全局表不动
  - b1-4：落既有双块即自动满足（SINGLE 排除正则不命中新键）
  - 新增本地断言：**深块域键集 == 浅块域键集**（b1-4 只数块不数键，漏一个浅值无人发现）
  - e2e/audit/canvas-migration-registry.json :434/:459 两条工具条 style 串同步

### 4.3 多选工具条（需求 2）

**视觉规格（完整参数，实现以此为准）**：

- 容器：padding 8 / gap 8 / 圆角 12 / 边框 0.5px `var(--canvas-controls-border)` / 背景 `var(--canvas-controls-bg)` / 阴影 `rgba(0,0,0,0.08) 0 4px 10px` / `backdrop-filter: blur(16px)`（替换现硬编码 rgba(0,0,0,0.85)）；定位选框上缘中点 `translate(-50%,-100%) translateY(-14px)`
- 按钮：h-8 / px-2 / 圆角 8 / 13px / `var(--canvas-controls-text)` / hover `var(--canvas-controls-hover)`；下载为 32×32 图标钮 aria-label=批量下载；分隔线 1px `var(--canvas-controls-border)`
- 排列菜单浮层：同容器视觉、min-width 120px、三项 宫格/水平/垂直排列（SVG 用参考代码图标）
- 数量徽标"N 项"保留在选框左上角（BADGE 现样式）

**打组▾ 下拉**：保留现有两项（打组 Ctrl+G / 合并分镜组 Ctrl+Alt+G）及禁用条件（含组禁打组、非全图片完成禁合并），样式并入。

**normalizeSelection**（utils/selection.ts 新纯函数）：三桶 `{groups, looseRoots, detachedChildren}`（§3 契约 1）；消费点：排列/副本/下载/+号源集（B）。

**arrangeSelection(mode)**：
- 输入 = groups（原子块，stored rect）+ looseRoots + detachedChildren（先转绝对）；**detachedChildren 参与即脱离组**（清 parentId、坐标转绝对，同 set）
- `arrangeRects(rects, mode)`（groupLayout.ts，绝对坐标）：grid 列数 `calcDefaultGrid(n)`（n=2 时 1×2 与 horizontal 等价，预期行为）；`ARRANGE_GAP=60`；**cell 尺寸 = 行 max 高 × 列 max 宽，节点按 cell 左上角落位（自身 w/h 不变）**；n≤1 no-op；输出整体平移使包围盒中心不变
- 写回 looseRoots/detachedChildren 绝对 position、groups 写组 position；**统一经 `writePositions` helper：canvasStore set + nodeStore position 镜像 + ensureParentOrder**（F11——程序化写 position 必须镜像，否则快照/CRDT 分叉）
- 单次 setWithParentOrder；排后 `applyGroupDerivations()`（hidden 重算）+ 保持原选区（验收断言）

**duplicateSelection() → duplicateNodes(ids, offset)（公共 helper）**：
- 闭包 = groups 展开（组+子）+ looseRoots + detachedChildren（副本一律顶层语义：detached 副本 parentId=undefined + 绝对坐标 + offset）
- **data 一律取 `useNodeStore.getState().nodes[id].data` 全量**（修 F3 丢配置）
- **storyboard 组 cells 重映射**（修 F10 掏空）：新 cells = cells.map(id => idMap.get(id) || id)；折叠组副本继承 collapsed/savedSize（structuredClone 原组自带）
- 选区闭包内互连边（两端∈idMap）重映射复制；副本选中：组 selected=true 子 false（受"父选中子无独立 dragItem"约束）
- 偏移 `{40,0}` 常量 `DUPLICATE_OFFSET`
- **顺序纪律（F14）**：canvasStore 结构 set（含边）**先**于 ns.addNode 逐个（data 用 set 前快照）
- **undo（修 F13）**：入口先 `stopCapturing()` 闭合上一步；断言"500ms 内连点两次 = 两个 undo 项"
- **副本体系统一（拍板）**：`copyNode` 死代码**删除**（连同 canvasStore.test.ts 4 处用例）；`duplicateGroup` 改为 `duplicateNodes([groupId], DUPLICATE_OFFSET)` 特例；`copyGroupToClipboard` 复制时从 nodeStore 取全量 data（paste 链路 rebuildFromClipboard 同步）——同一功能单一路径单一保真度，GroupContextMenu 两入口行为一致

**批量下载**：
- `utils/mediaDownload.ts` → `downloadMediaFile({ fileId?, url?, filename })`：url 优先（viewer 手里有已解析 URL），缺则 fileId 现取（getMediaUrl）；getMediaUrl→fetch→blob→`a.download=filename`→click→**`setTimeout(revoke, 60_000)`**（ExportModal.tsx:163 先例）；失败 `message.error` 并继续（**批量不走 window.open fallback**——await 后 popup 必被拦截）
- 文件名链（F15/A1-2 实证）：`data.mediaName ?? \`${节点类型}-${短id}\``；multiImageGen 主图用 `images[mainImageIndex].name`；扩展名由响应 content-type 映射，缺失按节点类型兜底（.png/.mp4/.mp3/.txt）
- **4 处切换**：ImageGenNode/VideoGenNode 传 fileId；ImageFullscreenViewer/VideoFullscreenViewer 传 url=displayUrl（downloading/loading 守卫留本地组件，util 无状态）
- `downloadSelectionMedia()`：收集口径 = 图片 `fileId || referenceImage`（isImageCompletedNode 三型判定）+ 视频完成 fileId；**multiImageGen 仅主图**（拍板）；串行 + 项间递增延迟 i*300ms（治请求风暴，不承诺绕过浏览器许可）；无可下载项 `aria-disabled` + handler 内 `if (!targets.length) return` 守卫（F17）；完成提示 `已触发 N 个下载` + 首次批量前 `message.info('如浏览器询问，请允许下载多个文件')`——**不断言全部成功**（Chrome 多下载许可是用户级，页面不可探测）

### 4.4 组工具条与组颜色（需求 3）

容器：`GROUP_TOOLBAR.offset=32px` 上方居中、portal #node-toolbar-portal 屏坐标层（维持 GroupToolbar 现机制），视觉同 4.3 容器规范；按钮 h-9 圆角 10、色点钮 size-10 内 20px 圆、下载 size-9 图标钮。折叠/整组执行/转分镜组/解组行为与禁用条件不变。

**组颜色（拍板：语义 key）**：
- `utils/groupColor.ts` **单一真值源**：`GROUP_PALETTE = [{key:'red',label:'红',cssVar:'--canvas-group-color-red'}, … × 7] as const`；`GroupColorKey` 由其派生；色板浮层/校验/渲染映射三处全引它
- `GroupNodeData.color?: GroupColorKey`（7 键，**无 gray**；undefined = 默认态 = 清除项）
- 浮层：7 彩点 + "默认"清除项（9 格变 8 格，消除"选灰≈清空"歧义）
- 渲染双兜底、**两处兜底值不同**：边框/徽标 `var(--canvas-group-color-<key>, var(--canvas-group-border))`；色点钮内圆 fallback = 复用现有中性 token（如 `--fw-text-dim-3` 系），**不新增单值键**（b1-4 双值纪律：新域键必须深浅双值）
- **未知 key 按未设色处理不抛错**（CRDT 可能出现新枚举值/旧数据）；写入端校验 `if (!(key in GROUP_COLOR_MAP)) return`（前端写入边界；后端白名单仅形状过滤加 'color' 键，**不复制枚举到 API 栈**）
- `setGroupColor`：canvasStore data → `syncGroupDataToNodeStore` 双写
- `convertGroup` 两分支**保 name/nameCustom/color 三字段**：normal→storyboard 置 `nameCustom:false` + 自动名 + 保留 color；storyboard→normal 保留用户自定义名（nameCustom:true 时）与 color（修 F18；两方向逐字段断言）

**排列子节点** `arrangeGroupChildren(groupId, mode)`：
- 子节点绝对 rect → arrangeRects → 同一 set 写子新 rel（目标绝对 − 新组原点）+ 组新几何（bbox+padding，即组框不变式）——**经 `refitGroupGeometry` 守恒 primitive（唯一几何写者，Spec B 复用）**
- **显式几何命令：先清 `manuallyResized=false`**（§3 契约 4）
- 经 writePositions（组+子 position 全镜像）；单次 setWithParentOrder；仅普通组

### 4.5 折叠宫格预览卡（需求 4）

- `COLLAPSED_SIZE={220,160}` 入 groupLayout.ts，toggleCollapse（canvasStore.ts:1261）与 NormalGroupRenderer 折叠渲染同源（修 F17 双硬编码；**store 侧断言 200→220 同步改**——canvasStore.groups.test.ts:200）
- 结构：上部预览宫格（padding 6/gap 4/圆角 6 tile）+ 底部 summaryRow（计数图标 + "N 个节点" 13px muted）；列数 1-2→按数量 / 3-4→2 列 / 5+→3 列；≤6 tile（sortNodesByPosition 序）
- tile：`CollapsedPreviewTile` 独立组件用 `useMediaUrl(fileId)`（hooks 规则）；其它类型居中类型图标（`--fw-text-dim-3`）
- **useMediaUrl 缓存根修（F7）**：后端 `GET /media/:fileId/url` 响应增加 `expiresAt`（= presign 时刻 + 900s，1 字段透传）；客户端模块级缓存 `fileId → {url, expiresAt}`，过期/临期（<60s）重取；**onError 失效该键并重取一次**（自愈）；LRU 上限（如 64 条）防无界增长。getMediaUrl 返回类型加字段（向后无影响，开发期无兼容负担）
- 组色着色折叠卡边框（双兜底同 4.4）；**a11y/辨识（修评审 P1#8）**：折叠卡根元素 `title={组名}` + `aria-label="{组名}，N 个节点"`（视觉仍不显示组名，拍板不变；重命名入口 = 右键菜单 + 展开态双击）

### 4.6 分镜组改版（需求 8）

- 主体：背景 `var(--canvas-storyboard-shell-bg)`、边框 `1px var(--canvas-group-border)`；宫格/序号/空位/删除行为不变
- **智能标题（纯标记口径，删除"格式嗅探"表述）**：替换现有右上角标签（不共存）；`data.nameCustom?: boolean`——renameGroup 置 true，自动生成（mergeStoryboard/convertGroup）置 false；标题 = nameCustom ? data.name : `分镜组 ${cells.filter(Boolean).length} 个节点`（实时派生）；左上角组框外 8px、13px muted、超长省略
- 工具条（组选中时）：`[比例▾] [宫格 n×m▾] │ [拼接(2K/4K)] [序号] [清空] [转普通组] │ [解组]`
  - 比例/宫格/拼接/序号/清空 = 现有功能重渲染新视觉（h-8）；**拼接文案维持 '2K'|'4K' 现值大小写（修 F19，不改小写）**
  - **转普通组、解组 = 新增按钮**：语义区分写明——转普通组 = 组保留、子节点按 cells 网格排进组内（convertGroup(id,'normal')）；解组 = 组消失、子节点散落画布（ungroup，含执行守卫）；Props 已有回调，storyboard 分支补渲染
  - 宫格文案动态 `宫格 {cols}×{rows}`；无折叠/整组执行（维持 noP）
- **后端白名单根修（F2，从根解决含既有崩溃面）**：`group: ['groupType','cells','name','storyboard','collapsed','savedSize','manuallyResized','color','nameCustom']`；同步改 snapshot-filter.util.spec.ts:87 断言（锁旧行为的测试本次一起改）；**新增 parity 测试**：枚举 `GroupNodeData` 键 ↔ 断言白名单全覆盖（防下次加字段重演掏空）
- thumbnailUrl 类注入字段若存在仍剥离（denylist 语义维持）

## 5. 测试策略（TDD）

| 层 | 内容 |
|---|---|
| 纯函数 | arrangeRects（三模式/**混排对齐**（320×180 与 200×300 同行）/中心锚定/n≤1）；normalizeSelection 三桶（组+子同选/选中他人组子节点/纯散/纯组）；折叠卡列数；refitGroupGeometry 守恒+幂等（跨篇契约 2） |
| store | arrangeSelection（原子块/脱离口径/镜像 nodeStore/保持选区/单 set）；duplicateNodes（**nodeStore data 全等**/**cells 重映射断言 every(id=>idMap.has)**/边重映射/B-2 顺序/连点两次=2 undo 项/detached 副本顶层化）；duplicateGroup 复用路径同断言；setGroupColor（双写/未知 key 拒写）；convertGroup 两方向 {name,nameCustom,color} 逐字段；arrangeGroupChildren（守恒/清 manuallyResized/镜像）；折叠 220 store 断言 |
| util | mediaDownload（url/fileId 双入口/文件名/revoke 延迟 fakeTimers/失败 message）；useMediaUrl（同 fileId 二次挂载不发请求——mock 计数；**expiresAt 临期重取**；onError 自愈一次） |
| 组件 | SelectionBoxOverlay（按钮序/排列菜单/下载 handler 守卫）；GroupToolbar（新按钮序/色板浮层/storyboard 补两按钮——**portal 位置断言 firstElementChild 索引随色板节点更新**）；CollapsedPreviewCard（列数/tile/计数行/title+aria-label）；StoryboardGroupRenderer（shell 变量/智能标题两分支/**右上旧标签删除**） |
| API | snapshot-filter：白名单 9 键 + **GroupNodeData parity** |
| e2e/门禁 | b0（DOMAIN_TOKENS 加 9 键防假绿断言）；b1-4（双块）；深浅键集相等新断言；registry :434/:459 同步；色板重排/删色后 data.color='yellow' 组渲染不变；data.color='mystery' 不崩退默认 |

既有测试迁移数值清单（直接照抄防算错）：§4.1 五值；canvasStore.groups.test.ts:200 折叠宽；StoryboardGroupRenderer.test.tsx:66（children[0] 首格子——标题浮层插在格子**之后**）/:93（边框 verbatim 改 canvas-group-border）/:105-110（右上标签用例重写为左上智能标题）；StitchButton.test.tsx:44（2K 不变则无需改，若 verbatim 匹配注意大小写）；GroupToolbar.test.tsx:58/:67（offset 14/32 重算）。

浏览器验收（jsdom 覆盖不到）：排列三模式含混选；副本内容等价（副本 prompt/model 与源一致——丢配置回归锚点）；批量下载 ≥5 文件（含浏览器许可提示路径）；组色全链路 **四条路径**（设置→刷新[localStorage]→转组→**存为模板→新项目导入**——白名单洞只有模板路径暴露）；折叠卡 6 图 + 深浅主题 7 色 computed 读数（复用 b0 探针模式）；组名浮层 vs 工具条 32px 余量目视。

## 6. 范围外

- 拖出机制/+号/批量连线（Spec B）
- FSA showDirectoryPicker 批量落盘（评审建议，YAGNI——串行+提示已覆盖，登记）
- 折叠卡显示组名（title/aria-label 已解决辨识与 a11y）
- zip 打包、下载进度条
- 自定义取色器（GroupColorKey 联合扩展 '#custom' 形态预留，零迁移）
- batchGetMedia 补 /flowai 重写（本篇未启用批量端点）
