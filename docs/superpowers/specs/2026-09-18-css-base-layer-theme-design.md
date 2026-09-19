# CSS 基础层根因修复 + 浅色/深色主题切换 设计文档（spec）

- 日期：2026-09-18　|　版本：v1.9（吸收实施期实证订正，修订记录见 §10）
- 状态：待用户确认
- 立项结构：一次立项，A→B→C 三段提交（+D 可选），段间独立验收、独立回滚
- 关联红线：本 spec 推翻 `corePlugins.preflight: false` 红线（原登记于 video-editor.md:289、workspace-ui-polish-design.md 等，见 §6 修订清单）

## 0. 背景与缺陷定性

### 0.1 缺陷类（preflight 关闭的后果，按元素类型分裂）

[tailwind.config.ts](../../../apps/web/tailwind.config.ts) 于 phase1（2026-05-09）为 antd 兼容设置 `corePlugins.preflight: false`，后被多份 spec 固化为红线。实际后果：

1. **border 功能失效（主缺陷，按宿主三类分裂）**：Tailwind border 宽度类只产 `border-width`，是否渲染取决于 UA 是否给该元素类型 border-style：
   - **非表单元素（div/span/a/section…）**：`border-style` 停在 UA 初值 `none` → used width 归零，**边框完全不渲染**，带显式色同样死
   - **常见表单控件（button/select 等）**：UA 样式表以 border 简写设 outset/inset（border-style 非继承、写在元素自身）→ border 类**一直半活**（按 outset/inset 渲染）
   - **UA 不给可见边框的表单控件（如 `<input type="color">`）**：行为同非表单元素 → 需要补偿——"UA 给不给 border-style"是**逐控件类型的事实**，不能靠类别推理（手工补偿路线必然漏的又一条实证）
   - 项目内自证：① [WorkspaceTabBar.tsx:12/16](../../../apps/web/src/pages/workspace/components/WorkspaceTabBar.tsx) `<button>` 用 `border-b-2 border-white` 无任何 solid 补偿、作者验收过选中下划线（若死则从未显示）；② 19 处 `[border-*-style:solid]` 补偿中 **17 处在非表单元素、2 处在表单控件**（PropertiesPanel.tsx:138 `<textarea>`、:156 `<input type="color">`——后者即第三类的实证）；③ textarea 的 UA border-style 分型以 A 段 before 基线实测为准
   - 文档实锤：[video-works.md:3489](../../superpowers/plans/2026-09-16-video-works.md) 批次 7 勘误 + 3491"第二次踩坑"规约 + 2026-09-03 Sidebar computed borderRightWidth=0px 历史实测（均非表单元素）；Sidebar.tsx:65 现状为补偿模式例证（化石，非缺陷反例）
   - **手写 CSS 边界声明**：全仓 4 个手写 CSS（index.css / MaterialLibraryModal.css / PromptInput.css / NodeHandle.css）全部使用 border 简写或显式 border-style（`border: 1px solid …`）→ **不受本主缺陷（border）影响**；但它们**均无 box-sizing 声明**，preflight `*{box-sizing:border-box}` 会新生效——`width:100% + padding/border` 组合视觉变宽→变窄（实测实例：MaterialLibraryModal.css:21 `.new-folder-btn`，content-box 下总宽超包含块 26px 被 sidebar `overflow:hidden` 裁掉，border-box 后内容区收窄 26px）→ 这 4 个文件**进 §2.4 box-sizing 回归清单**，非免查
   - **A 段首测试（before/after 成对，TDD 先红后绿；v1.6 订正：未选臂 before 是 `none` 非 outset——[WorkspaceTabBar.tsx:12](../../../apps/web/src/pages/workspace/components/WorkspaceTabBar.tsx) 未选臂带 `border-none`，作者 (0,1,0) border-style:none 压 UA outset）**：改动前特征化基线——未选 tab button `border-style: none`（border-none 所致）、选中 tab `border-bottom: 2px outset`、带 `border` 类的 div used width 0。改动后验收（§2.6-1）——**选中臂** `border-style: solid` + `border-bottom-width: 2px` + `border-x/t-width: 0`（origin 铁律由选中臂 outset→solid 承担；宽度 0 兜底断言用选中臂的 `border-x-0 border-t-0`，A2 即绿）；**未选臂** `border-none` 删除（A4）后方可断 solid + 全边 width 0（preflight `*` 兜底）——此断言属 A4 验收而非 A2（border-none 未删前恒 none）；div 边框可见且色为 `var(--fw-border)` 求值
2. **裸 button 吃 UA 样式**：注意 `<button>` 边框一直在渲染（outset）——是"丑"不是"无"。缺陷为**四项**：border（outset 丑）/ padding（1px 6px）/ font（13.33px Arial）/ **背景**（UA `background-color: buttonface` 系统色；preflight 以作者声明 `background-color: transparent` 覆盖同属性 → 验收期望值 `rgba(0,0,0,0)`；`-webkit-appearance: button` 是 iOS 可样式化**有意修正**，勿当 bug 修掉）。computed-style 验证四项分测。

全站手工补偿（化石层，实测计数，最终以 AST 定版）：`[border-*-style:solid]` 19、`font-[inherit]` 5、`box-border` 46（非测试口径 41）、`list-none pl-0` ~10、`cursor-pointer` 210、`bg-transparent` 133、`border-none` 94，及 [index.css:58](../../../apps/web/src/index.css) 的 R3 局部 button reset。

### 0.2 主题现状（5 套并存机制 + 硬编码深色）

- 全站硬编码纯深色（body `#141414`；`--canvas-*`/`--ve-*`/`--vw-*` 三套固定深色 token）
- antd 主 Provider 跑默认**浅色**算法（[App.tsx](../../../apps/web/src/App.tsx)）
- 4 处局部 dark 分支：AdminLayout `ProConfigProvider dark`、VideoEditorShell `darkAlgorithm` + `[color-scheme:dark]`、ProcessSnapshot `colorMode="dark"`、VideoPlayerModal `[color-scheme:dark]`
- **第 5 类：局部 ConfigProvider 硬编码暗色组件 token**——TopActionBar.tsx:104 / CanvasTopBar.tsx:164（Dropdown `colorBgElevated #252525` 等）、WorkspacePage.tsx:75（Tabs `itemSelectedColor '#f5f5f5'` 近白，浅色主题下选中文字不可读）→ **B 段范围纳入**（token 化或钉深，逐处裁定）
- login 浅色（#f5f5f5）/ register 深色（#0f0f0f）现状分歧
- 颜色债：全仓硬编码 hex（口径 766~1041 因统计方法而异，**进 plan 前用脚本定版一次（O6），与 §2.3 涌现面共用同一把尺子**；静态 className 内约六成可机械替换，其余在 JS 值/内联 style/条件表达式）；**另含主题色工具类一族**——`text-white` 实测 213 处/65 文件、`text-black` 16 处（含 `white/NN` 半透明系）：不计入 hex 口径、不被"禁任意值 hex"拦截，但浅色主题下 `text-white` 落浅底即不可见 → **按宿主切分（恒深域保留 / 跟随域迁移）纳入 B 段范围**；调色板色类（bg-red-500/20、accent-blue-500 等）是否入迁移范围随 O2 token 表一并声明
- video-editor.md:289 视觉 spec 写**亮色**（#F7F8FA），实现为暗色——实现压过 spec，本 spec 显式追认并修订

### 0.3 级联事实（SSoT，防后续误判）

1. author normal 声明恒胜 UA normal，**与特异性无关**（特异性只在同 origin 内比较）。`:where()` 的 (0,0,0) 照样压 UA。推论：preflight 开启后 `*{border-width:0}` 本身就是作者声明——删除元素上的 `border-none` 后由 preflight 兜底，**不会**"回到 UA 边框"；表单控件上删 border-none 后 border-style 退回 UA outset——**仅在同时有 border 宽度类时可见**（§2.2 同串校验兜住）。
2. `border-color` 不影响布局占位：`transparent` + `solid` + `width:1px` 仍占 1px 布局但不可见（静默布局位移陷阱，桥接值禁用 transparent 的依据）。
3. `borderColor.DEFAULT` 可配置（v3 默认 gray.200=#e5e7eb，v4 默认 currentColor）——重开 preflight 的必配项。
4. antd cssinjs 为运行时注入的**未分层** author 样式，晚于静态产物 → 类选择器 (0,1,0) 恒胜 preflight 元素选择器 (0,0,1)（如 `input:where([type='button'])` 整条 (0,0,1)）。**注意 preflight 也含 (0,1,0) 档规则**（`:disabled`、`[hidden]`；`[type='search']` 亦属该档但只写外观属性 `-webkit-appearance`，与 border 平局无关）——与 antd 类的平局只可能发生在该档，由注入顺序决胜，需实测固化（§2.4）。
5. **Tailwind v3 产物顺序 base → components → utilities**：同特异性下 utility 恒胜 base 规则。推论：`.cursor-pointer` (0,1,0) 压过 preflight `:disabled{cursor:default}` (0,1,0)——带该类的禁用按钮保持手型，preflight 的 `:disabled` 规则对它们是死代码；需 not-allowed 处逐处 `disabled:cursor-not-allowed`（变体 (0,2,0) 必胜）。
6. **双类架构源序约束（v1.6 翻转）**：`:root, .dark {…}` 与 `.light {…}` 同特异性 (0,1,0)，靠源序决胜——**`.light` 块必须写在后**（html.light 同时匹配两块，浅值胜出；load-bearing，D8 源序断言兜底而非仅靠注释）。
7. **浅色岛内禁用 `dark:` 变体（机械检查强制）**：`darkMode:'class'` 的 v3.4.19 **编译实证产物为 `:is(.dark *)`**（本仓实测编译，如 `.dark\:bg-black:is(.dark *) { … }`）——`:is()` 取参数最高特异性，整条 = **(0,2,0)**，恒压同属性普通工具类 (0,1,0) **与语义 token 工具类 (0,1,0)**。岛内元素的 `dark:` 工具类会命中岛外祖先的 `.dark` 且 **token 层救不回来** → 岛内只用语义 token；"岛子树内无 `dark:` 变体"**优先落 D8 断言**（跑岛页面遍历岛子树，断 className 无 `dark:` 前缀——与既有门禁同构、比 AST 规则便宜），ESLint 仅作补充，不靠文字纪律。

## 1. 已拍板决策记录（2026-09-18 用户确认）

| # | 决策 |
|---|---|
| D1 | 一次立项，A（基础层）→ B（语义 token）→ C（切换接线）三段提交；不拆两个开发项（理由：边框涌现修剪与 token 语义化同批 class 同址双改；B 依赖 A 的 base 层与 token 单点） |
| D2 | 桥接：`theme.extend.borderColor.DEFAULT = 'var(--fw-border)'`，A 段 `:root { --fw-border: #333 }`（#333 系=项目既有边框习惯色）；恒浅区作用域覆盖见 §2.1-3；B 段双套化只改值。无色裸 border 子集极小（外部实测 ~10 处元素级）进一步支撑 |
| D3 | 默认主题深色（现状基线）；三态切换：浅 / 深 / 跟随系统 |
| D4 | login+register 恒浅营销页 + 显式 `color-scheme: light`（register 重做为并行独立任务，不塞 A/B/C）；admin 恒深（显式声明）；video-editor 恒深（修订 spec）；**videos 域（列表/播放/过程快照）整体恒深**（媒体黑底为内容承载、性质同画板；ProcessSnapshot `colorMode` 已钉 `"dark"` 常量、不接 store）；**canvas 域的两个全屏查看器（ImageFullscreenViewer/VideoFullscreenViewer——死类家族主体所在）恒深**（媒体查看器，同 VideoPlayerModal 逻辑；其死类按恒深落显式深色值）；**画板 = 无岛类的恒深值域（v1.7 精确边界）**：画板子树（React Flow viewport + 节点）内**禁止 `--fw-*`/语义 token 工具类与迁移**（只可用域 token/字面量）——浅色全局下 token 化的画板元素必坏（实证：OutpaintSelectionOverlay.tsx:232-235 `bg-white/30` 网格线浅色档 black/12 落纯黑底不可见；TextNodeToolbar.tsx:214 `text-white/90`+硬编码 `bg-[#222]/80` 浅色文字值变近黑不可读）；宿主岛归属判定（O6③）**三列**：先按 D4 域映射（画板组件清单，A0 产出）→ 岛根祖先链 → 跟随域；pages/canvas 的 text-white 83 处按"画板/画布壳"二分（如 CreditsDropdown.tsx:183 在壳=迁移）；画布画板视觉恒纯黑（Background/MiniMap 自绘恒黑）；CanvasView `colorMode` 不预设——**实测驱动裁定**（§4.2 v1.7，默认 'light' 现状）；**AppLayout chrome（Sidebar/TopActionBar）跟随主题**（现状全硬编码深色——B 段一块可见的迁移工作量，点名防漏） |
| D5 | antd cssVar **不启用**（降级 D 段可选评估：作用域在 antd 子树非 :root、低频切换无性能收益、测试环境不可断言） |
| D6 | Tailwind 保持 3.4.19、antd 保持 5.22.5（v4 有 @layer 反转硬伤：未分层 antd cssinjs 恒胜 layered utilities；antd 6 连带 React 19 迁移） |
| D7 | 主题仅 localStorage 持久化，不落库（设备级呈现偏好；无用户数据） |
| D8 | 引入 **Playwright**：门禁 = **computed-style / CSS 变量值 / DOM 类 / 时序断言**（布尔判定，稳定可 CI）；**截图矩阵降级为人工验收工件**（非 pass/fail，canvas/WebGL/视频页禁截图比对） |
| D9 | ESLint 当前不可执行（包未安装、.eslintrc.base.json 不被 flat config 自动发现、lint 脚本从未可执行）——A 段恢复可执行 + **新增行禁任意值 hex（颜色前缀收窄口径）**，并升为 A 段验收项。~~新增行禁裸 border 窗口期临时规则~~ **v1.6 删除**：A2 后 preflight 兜底使裸 border 在一切宿主正确工作（正是目标写法），窗口期规则恒假阳性、成本为负收益 |
| D10 | 主题不落库、无向后兼容/存量防护（开发期无用户数据） |

## 2. A 段：基础层根因修复

### 2.1 配置变更

1. `tailwind.config.ts`：删除 `corePlugins.preflight` + **`darkMode: 'class'`** + `theme.extend.borderColor.DEFAULT: 'var(--fw-border)'`；配置上方留 3 行注释（为何必须有 base 层、--fw-border 指向、红线已废止指向本 spec——防"下一个人再把 preflight 关掉"的最短路径）。**明确选 `'class'` 而非 `'selector'`（勿顺手改）**——本仓编译实证两形态：`'class'` → `:is(.dark *)` (0,2,0) 恒压；`'selector'`（v3.4 新推荐）→ `:where(.dark, .dark *)` (0,1,0) 可被同权工具类覆盖。对本架构 **'class' 的恒压是安全属性**：岛内误用 `dark:` 无法被 token 类翻盘、**误用立即可见**；'selector' 会把"误用可见"变成"误用无声"，新推荐 ≠ 更合适
2. `index.css`：`:root { --fw-border: #333 }`；删除 R3 补丁（[index.css:54-62](../../../apps/web/src/index.css)，preflight 后三属性全冗余）；**保留** `data-vw-shell` 属性与 `[color-scheme:dark]`（作用域不变量，测试依赖）
3. **恒浅区作用域覆盖**：login/register 容器挂 `light` 类 + 一条规则 `.light { --fw-border: #e5e7eb; color-scheme: light }`（防 #333 深灰框落在浅底；`.light` 命名即 B 段双类架构的前置引入，避免临时钩子二次改名；顺带解决滚动条/焦点环）

### 2.2 补偿清理（与 §2.3 合并为**单次 className 清理 pass**，按元素×类矩阵，AST 清点，禁止正则全量删）

| 类 | 实测数 | 清理范围与机制 |
|---|---|---|
| `box-border` / `[border-*-style:solid]` / `font-[inherit]` / `list-none pl-0` | 46/19/5/~10 | 全删（preflight 全覆盖）；测试断言同步（Sidebar.test、FolderCard.test、CanvasCard.test、SupportComponents.test、WorkspaceToolbar.test 等） |
| `cursor-pointer` | 210 | 仅删 **button / `[role=button]`** 子集（preflight 仅覆盖这两个——**不含 input**）；div/Link/a 上的**保留**（删了丢手型） |
| `bg-transparent` | 133 | 仅删 **button / `input[type=button/reset/submit]`** 子集（preflight 对同一属性给出作者声明 `background-color: transparent`）；**含 `hover:` 变体或在条件表达式内的一律保留**（防御性：覆盖作者自设背景/组件基础类背景的场景） |
| `border-none` | 94 | 自绘元素上**任何元素皆冗余**（preflight `*{border-width:0}` 兜底）；antd 组件上的不动。**机械约束：删除前校验同 className 未同时携带 border 宽度类——校验必须按模板字面量/三元分支展开后判定**（纯字符串子串匹配会漏条件臂）。存量实测 7 处命中归因两类：5 处为检测器假阳性（`inset-0` 子串）、2 处为 WorkspaceTabBar 同模板**分支互斥**（border-none 与 border-b-2 不同臂不共现，删除安全）——两类皆零真阻断，属防御性条款 |
| `text-inherit` / 覆盖层 `p-0` | 10 | **5 个 textarea 覆盖层上的确定冗余可删**（preflight `textarea{color:inherit;padding:0}` 覆盖）；TopActionBar/CanvasTopBar 的 5 处（Link/菜单项）**保留待实测**（antd 菜单项可能另有 color 规则）；非表单元素上的 `p-0` 不在此列 |
| disabled 光标 | — | **v1.6 改一行全局 CSS 方案**：A4 删 button 上 `cursor-pointer` 后，preflight 两规则自然工作（`button,[role=button]{cursor:pointer}` preflight.css:343 + `:disabled{cursor:default}` :351）——enabled/disabled 自动正确；如需 not-allowed 语义，index.css 一行 `button:disabled, [role="button"][aria-disabled="true"] { cursor: not-allowed }`（(0,1,1) 压 preflight `:disabled` (0,1,0)）替代逐处类名（逐处 `disabled:cursor-not-allowed` 是无边界任务）；"禁用按钮 cursor 变化"进预期变化清单；antd 按钮自带 not-allowed (0,2,0) 免疫 |

### 2.3 边框涌现裁定（按元素分裂口径 + AST 互斥清点 + 截图留档）

- **涌现集合（v1.8 补裁定维度与 divide 新类）**：按宿主两类——① 非表单元素 border-style none→solid **从无到有**（主涌现面）；② 常见表单控件 outset/inset→solid **从斜面到扁平**（≈44+ 处逐处目检）。**裁定维度（v1.8 拆列，O6① 按此输出）**：**裸 border ~324 处**（作者忘给颜色 → 逐处裁定保留/修剪）与 **border-[color] ~238 处**（作者写全、被 preflight 关掉样式 → **几乎全保留**）裁定标准不同，并成一列会使 324 处失去依据；**第三类：divide 子元素线**（v1.8 新发现）——divide-x/y 的宽度生成在**子元素**（`.divide-y > :not([hidden]) ~ :not([hidden]){border-top-width:…}`），preflight 关闭时子元素 UA border-style:none → **全站 divide 线现状不可见**（实证 TeamBillingPage.tsx:140 divide-y divide-white/5 的订单列表现状无分隔线；其父/子元素均无 border-none——第九轮"border-none 压 divide"场景本仓不存在，divide 涌现与 border-none 删除无关）；preflight 开后子元素 *{border-style:solid} → divide 线涌现（全仓仅 1 处，登记预期变化）。**裸 border-dashed（无宽度）不构成一类**（实测 4 处 border-dashed 全带 border 宽度——样式属性仅在宽度非 0 时有视觉效果）；[border-*-style:*] 补偿口径 19 处 = **solid 18 + dashed 1**（VideoEditNode.tsx:214 `[border-top-style:dashed]` 与 border-dashed 同串纯冗余，A4 顺带删）
- 四类计数（hex 102 / 调色板 61 / 裸 134 / 方向 37）为 token 口径**不互斥**（`border border-[#333]` 同时计入两类）——**进 plan 前与 §0.2 颜色债共用同一把 AST 尺子，输出互斥的元素级集合并冻结**（外部实测参考：元素级 ~153、带显式色 ~143、无色仅 ~10）
- A 段逐处裁定：保留（预期设计）/ 修剪（模板残留）；**浅/深基线截图各一套留档**（B 段对照基线）
- 死视觉附带审计（范围收窄）：仅"无边框、无背景、只靠 border 承接视觉"的元素才整块死（有 `bg-*` 时 `rounded-*` 照常工作）；另审计 **5 个无显式文字色的 textarea**（TextInputNode/ImageGenNode/VideoGenNode/MultiImageNode/AudioGenNode，仅 `text-inherit`）的 computed color 与节点底色对比度——既有问题，发现即登记

### 2.4 preflight 副作用目检清单（意外变化必须为空）

- **`html { line-height: 1.5 }`**：全局行高 normal(≈1.2)→1.5，508 处 `text-*` 自带行高免疫，**裸文本全部变高**——固定高度容器有裁切/溢出风险，重点目检
- **裸表单控件失 UA 边框**（反向副作用）：实测裸 `<select>` 全仓**仅 1 处**（TemplateMarketPage.tsx:64，带 `border border-[#333]`——开后 inset→solid 深色下几乎无差，浅色下随 B 段 token 化修正）；裸 input/textarea 以 AST 清点为准逐处裁定
- `img/svg/video/canvas/audio/iframe { display:block; vertical-align:middle }`：canvas 布局（PreviewPlayer/AudioWaveform/ClipBlock/VideoEditNode）、裸 inline svg（VipSubscribeModal、FolderStackPreview）、图标行内对齐基线微移；**Tiptap 富文本内图片 inline→block**——修法**两项成对回退**（display 与 vertical-align 是同条规则两属性）：`.tiptap-content img { display: inline-block; vertical-align: baseline }`
- `img/video { max-width:100%; height:auto }`：无 h-full 的裸媒体（实测 19 处全屏图全带 h-full，风险低）
- `::placeholder { color: gray-400 }`；`textarea { resize: vertical }`（横向拖拽失效）；`a` 下划线移除（19 处 Link）；`hr/table/fieldset/iframe` 失 UA 边框
- `h1-h6/p` 重置：Tiptap 免疫（`.tiptap-content h1` 类选择器胜）；**`ul/ol` 同样免疫**（index.css:113-118 类选择器显式 `list-style-type`）
- **::file-selector-button：已核查无风险**——生产 `type="file"` 隐藏分两式：12 处 `className="hidden"`/内联 `display:none` + MaterialLibraryBrowser 1 处为 **CSS 透明覆盖层**（MaterialLibraryModal.css:32 `position:absolute; inset:0; opacity:0`——input 仍渲染，无风险的真实机制是 `opacity:0` 使含伪元素按钮在内的整个渲染不可见，非"隐藏"）
- 原生 checkbox/range `accent-*`：实测 8 处**全部带显式 accent**（checkbox 3：SaveAsTemplateDialog `accent-[#4ade80]`、FileGrid/FileCard `accent-blue-500`；range 滑杆 5：Angle3D/Lighting ControlPanel `accent-blue-500`）→ 无一依赖 UA 默认外观，**登记免复审**；B 段仅 `accent-[#4ade80]` 1 处落入"任意值 hex"口径
- **材料库 Modal**：MaterialLibraryModal.css:1 硬编码暗色 antd 覆写（`.ant-modal-content` `#1a1a1a` 等 6 行，(0,2,0) 压过 antd——岛反转与 algorithm 都改不动写死的值）→ 归入 **B 段迁移**（§3.2 手写 CSS 通道），浅色主题下整体色目检
- PropertiesPanel.tsx:138（textarea）/156（input[type=color]）两处表单控件补偿：A 段核实 preflight 后是否可删（第三类宿主可能仍需）
- **4 个手写 CSS 的 box-sizing 回归**（§0.1 边界声明）：`width:100%/固定宽 + padding/border` 组合逐处目检（实例 MaterialLibraryModal.css:21 `.new-folder-btn` 26px；`.ant-modal-content{height:85vh;border:1px}` 2px；PromptInput.css dashed+padding 组合）
- 恒浅区边框色（§2.1-3 作用域覆盖后必须正确）；"待核"类条目统一移入 O6 脚本清点，避免被误读为已核查
- 产物 CSS 顺序固化：antd `<style>` 注入晚于 Tailwind 产物（`document.styleSheets` 断言，含 §0.3-4 的 (0,1,0) 档平局验证）；@xyflow/react/dist/style.css 为路由导入，顺序一并实测

### 2.5 ESLint 恢复（A 段任务，A 段验收项）

安装 eslint + @typescript-eslint（flat config `eslint.config.js`，`.eslintrc.base.json` 迁移；装 apps/web devDependencies）；**限范围执行**（仅 A/B/C 触及文件——.eslintrc.base.json 为 eslint:recommended + **@typescript-eslint/strict（type-aware，需 parserOptions.project）**，从未跑过的仓首跑必数百条存量，故存量规则永不卡门禁）；规则仅一条：**新增行禁任意值 hex，收窄到颜色前缀**（`(bg|text|border|ring|divide|from|via|to|fill|stroke|placeholder|outline|shadow|accent|caret|decoration)-\[#`，含 `!` 变体——避免 `w-[#…]`、`bg-[url(#…)]` 误报）；**范围声明：不拦 style 对象字面量**（`style={{color:'#fff'}}` 属 B2-2 逐处判定通道）。~~窗口期裸 border 临时规则~~ **v1.6 删除**（A2 后裸 border 即目标写法，规则恒假阳性，见 D9）。增量机制在 O3 定。

### 2.6 A 段验收

1. Playwright computed-style 实证：裸 button **四项**归零（border/padding/font/**background-color**；font 项断言口径="等于父级 computed font-size"——preflight `font-size:100%` 是相对值，探针父级值 A0 登记）；**§0.1 分裂模型实证（v1.6 订正断言分组）**——选中臂三断言（solid / bottom 2px / x·t 0，A2 即绿）+ 未选臂断言（solid + 全边 0，**A4 删 border-none 后**才绿，归 A4 验收）；涌现抽样清单可见性；**恒浅区断言（v1.8 改岛根 computed 断言，撤回 v1.7 受控探针）**：login 岛根（[login/page.tsx:19](../../../apps/web/src/pages/login/page.tsx) `min-h-screen bg-[#f5f5f5]…`）**无任何 border 声明**（实证）→ 其 computed `border-color` 正是 preflight `*{border-color:var(--fw-border)}` 在该岛走完整级联的求值结果（border-color 的 computed 值与 border-style/width 无关、未被任何工具类覆盖）→ 断言 = 岛根 `getComputedStyle(el).borderColor` 解析为 #e5e7eb **一条断言同时实证**：D2 桥接真实落地（唯一不可恢复失败模式）、`.light` 作用域覆盖、消费真实发生——**不往产品代码注入 data-testid 探针**（v1.7 方案会把测试脚手架带进出货代码且引入"探针自身被覆盖"变量）；可另配岛根 `getPropertyValue('--fw-border')` 直读作双保险。这是"作用域覆盖"岛机制的**唯一直检点**，A 段验掉 = 用最小成本提前证伪 B/C 段最大风险
2. **意外清单为空——机械 diff 判定（两层口径防报告淹没）**：代表性页面（login/register/workspace/videos/React Flow 页/admin/材料库 Modal 打开态，避开 Three/WebGL 页）before/after 快照 diff，分两层——**属性层（聚合）**：box-sizing/line-height 这类全局翻转只记一条聚合预期 + 计数，不逐元素列（全元素命中无信息量）；**几何层（逐元素）**：`getBoundingClientRect()` w/h/x/y + padding/border-\*-width/font-size 逐条标"预期/意外"——box-sizing 是原因、rect 变化才是后果（26px/2px 实例、边框涌现占位只在几何层可见）。`color` 为继承属性噪声最大且 A 段对其几乎无预期变化（color:inherit 仅表单控件新增）→ 降级为"仅表单控件"。配套要求：before 快照取自改动前 commit 并存档（与截图基线同源）；元素配对用稳定 key（data-testid/路径索引）；排除动态区（动画/canvas/video/波形/时间戳）。"未知的 UA 行为"（file-selector/input[type=color]/border-none 删除后果等五轮反复项）由该 diff 一次性闭环
3. 产物 CSS 顺序断言（含 (0,1,0) 档）
4. **涌现裁定清单 + 浅/深基线截图留档**（B 段对照用）
5. **ESLint 可执行 + 新增行禁令拦截用例通过**（fixture：一条故意违反的代码被规则拦截——"跑了且有结论"）
6. vitest 全绿（必要不充分，仅兜 TS/逻辑回归）

## 3. B 段：语义 token 层

### 3.1 token 架构：双类作用域（支持主题岛 + 双通道）

```css
:root, .dark { /* 深色值 */ }  /* 根默认=深（D3；无 JS 兜底亦深）+ html.dark + 深色岛挂 .dark */
.light        { /* 浅色值 */ }  /* html.light（显式浅色态）+ 浅色岛挂 .light；块必须在上一块之后（源序决胜，§0.3-6，D8 断言兜底） */
```

**v1.6 方向翻转（原 `:root,.light{浅} / .dark{深}` 废弃）**：原方向下 B 段落地后 html 无任何类 → 全站按 `:root` 浅色值渲染，与 D3（默认深色=现状基线）冲突、破坏"段间独立验收"（B 段单独交付即整站翻浅）、暗色零回退门禁只能靠临时测试钩子成立。翻转后：B 段默认渲染=深色=现状零回退（:root 即深）；C1 脚本保证 html 恒有且仅有 `.light`/`.dark` 之一，`:root` 退化为无 JS 兜底。特异性：`:root`/`.light`/`.dark` 均 (0,1,0)，html.light 时两块同权、`.light` 源序在后胜出；岛机制不受影响（岛根只匹配自身挂的类块，变量经最近祖先继承取值）。**配套硬约束（v1.7 现象订正 + 本仓内存编译实证）**：Tailwind colors 映射值不得依赖斜杠透明度修饰符——v3.4.19 `parseColor` 对裸 `var(--x)` 返回 null（仅认 hex/rgb()/hsl()，var 仅可作 rgb() 内部通道参数）→ **带斜杠时整条规则静默零输出**（`bg-surface/50`/`border-surface/30`/`ring-surface/40` 在产物 CSS 中无任何规则，class 留在 DOM、样式表缺失该条、无警告；不带斜杠的 `bg-surface` 正常输出 `background-color: var(--fw-surface)`）——非"颜色错"而是"零输出"。故 token 值一律**单值、alpha 烤进字面值**（如 `--fw-overlay-1: rgba(255,255,255,.05)`）；确需斜杠能力的键用 `rgb(var(--fw-x-rgb) / <alpha-value>)` 形态（编译实证可正常生成 `rgb(var(--fw-accent-rgb) / 0.7)`）——**该形态要求 `--fw-x-rgb` 存裸通道值（如 `108 222 128`）非 hex，浅/深两档同约定；开斜杠能力的键显式白名单、默认全部关闭**。门禁（随零输出现象机械化）：遍历 DOM class 名 → 产物 CSS 中查该转义选择器**存在性**，零输出即失败——纯机械零歧义，可顺手覆盖全仓任意 var() 键的斜杠形态；检测时点 **A0 首跑即建存量基线**（当前应为 0：全仓 var(--…)/NN 现存 0 命中），B2 迁移中任何误用立刻红。

- CSS 自定义属性按**最近祖先声明**生效 → 岛根挂类即得反转值，天然嵌套正确
- **岛双通道通则（缺一即半亮半暗，先例 admin-console-refactor.md:206）**：恒深岛 = antd `darkAlgorithm`（JS 通道）+ 岛根 `dark` 类（CSS 通道）；恒浅岛 = `defaultAlgorithm` + `light` 类。据此前补三处缺口：
  - **admin 补挂 `dark` 类**（现仅 ProConfigProvider dark，岛内自绘 UI 的语义 token 会跟随全局）
  - **恒浅 antd 通道挂组件自身而非页面容器**——实测 login/register 页面**零 antd 组件**（岛 provider 挂页面容器无效）；营销域 antd 组件的真实宿主是 LoginModal（`Modal`）与 PhoneLoginForm（`Input/Button`）自身 → `defaultAlgorithm` Provider 挂这两个组件根部。LoginModal 有**双宿主**（TopActionBar.tsx:133 全局 chrome / VideoPlayerModal.tsx:75 恒深 videos 域内、注释"读最近 Provider token"）→ 逐宿主裁定入 O5，先例 video-works.md:27"LoginModal 全仓均为浅色渲染"
  - video-editor 已双通道（darkAlgorithm + §4.2 挂 dark 类）
- `color-scheme` 写进 `.dark`/`.light` 块内（随岛生效，岛根显式声明中断继承链）
- **岛内禁用 `dark:` 变体**（§0.3-7），只用语义 token
- `--fw-*` 单一语义层服务**跟随主题区域**；现有三套域 token（`--canvas-*`/`--ve-*`/`--vw-*`）**v1.6 收窄并入范围**（原"收敛并入、不留别名"条款废止）：按 D4 域归属裁定——恒深域（画板/video-editor/videos）的域 token **原地保留 + 白名单登记豁免**（并入语义层=为恒深值引入双套维护与回退面，收益为零；引用点替换仅发生在"跟随域实际引用了域 token"时，以 A0 审计清点为准）；`--canvas-handle-*`/`--edge-flow-*`/`--canvas-shadow-*`（画板恒深常量）与 `--z-panel`（z-index，非颜色）**永不并入**。token 命名表（bg/surface/border/text/text-strong/text-dim 梯度/accent/on-accent/danger/success/overlay…）在 plan 开工前定稿并登记，**每 token 附"现状来源"列**（机械替换的输入，防把 --ve-accent 与 --fw-accent 判成两个值制造断层）
- `--fw-border` 双套化：深色 #333 系维持，浅色值见 O1；**`::placeholder` 覆盖**：preflight 的 `color: gray-400` 是 base 层唯一与主题无关的硬编码色，B 段在双套块内覆盖为语义 token（如 `--fw-text-dim`），否则 token 层留永久的洞
- **岛验收对照组三组**：host 深+岛浅（login）、host 深+岛深（video-editor/admin 与全局深色取值一致性——避免两处维护两套深色值）、host 浅+岛深（全局浅色时 video-editor 滚滚动条/原生 video controls 跟随岛）

### 3.2 颜色迁移（分类，禁止全量正则替换）

白名单**按通道**登记（非按文件名）：

| 通道 | 例 | 处理 |
|---|---|---|
| 静态 className 内 hex | ~六成 | 机械替换为语义工具类 |
| JS 值/内联 style/条件表达式 | ~四成 | 逐处判定后替换 |
| **局部 ConfigProvider 组件 token** | TopActionBar/CanvasTopBar Dropdown token、WorkspacePage Tabs token（§0.2 第 5 类） | **纳入 B 段**：token 化或钉深逐处裁定 |
| **canvas ctx 渲染输出色** | canvas-renderer.ts fillStyle | **豁免**（主题化会改坏成片） |
| **Three scene.background** | LightingEngine/Angle3DEngine `#0a0e1a` | **豁免**（3D 预览=媒体内容，同画板） |
| **画板/videos 域恒黑类** | CanvasView `bg-[#000000]`、`<Background color>`、MiniMap 全套；VideoPlayerModal/ProcessView/PlayView/VideoCard 等域字面色 | **豁免**（画板与媒体域恒深，D4） |
| **手写 CSS——共享组件** | MaterialLibraryModal.css ~55 处（含 6 行暗色 antd 覆写 (0,2,0)） | **纳入 B 段迁移**（浅/深双套；岛反转与 algorithm 都改不动写死的值，必须 token 化） |
| **手写 CSS——画布域** | PromptInput.css ~29、NodeHandle.css 1 | 豁免（画板恒纯黑域，D4） |
| **手写 CSS——全局** | index.css ~38 | B 段核心（token 定义与迁移目标所在） |
| **inline style 语义色常量** | ClipBlock 选中条、NormalGroupRenderer、SelectionBoxOverlay、StoryboardGroupRenderer | **豁免**（canvas 交互语义色，固定） |
| **半透明 white/NN 族（v1.8 通道扩至五类，含变体前缀；实测：bg 197 处 12 档 / border 54 处 10 档 / text 93 处 11 档全在 30-90% / ring 5 处（WorkspaceToolbar:43/53/58、CreditsDropdown:156 跟随域，CarouselBar:29 恒深保留） / divide 1 处（TeamBillingPage:140））** | `bg-white/5·10·20`（面）、`border-white/10·20`（线）、`ring-white/10·20`（线，含 `focus-within:`/`hover:` 变体——分列正则必须吃变体前缀）、`divide-white/5`（线）、`text-white/30-90`（文字淡化） | 深色底惯用手法，浅色下**语义完全不同**。通道：**面/线**（bg/border/ring/divide）→ `--fw-overlay-1/2/3`（浅色下 ring-white/10 近白底=消失、divide-white/5 分隔线消失——跟随域必须迁移）；**文字淡化** → `--fw-text-dim` 梯度（text-white/NN 与 5/10/20 零交集）；碎档坍缩按 UI 语义归并进 B2；恒深域保留。审计按**属性 × 透明度**分列（O6） |
| **text-black（语义 token，非主题色）** | 16 处，语义="实心强调按钮上的文字"（bg-[#4ade80] text-black 型） | 归 `--fw-on-accent` 语义 token（O2 命名表），勿按"恒深域保留"处理 |
| 营销页固有浅色 | login/register/AuthModal/PhoneLoginForm | 豁免（岛内固有色） |
| 测试夹具数据色 / 后端数据默认值 | AnnouncementBar.test 等 | 豁免 |

**JS 通道重绘逐组件任务表**（替代"接变量+重绘"一句话）：

| 组件 | 机制 |
|---|---|
| WaveSurfer 波形色 | setOptions / 实例重建（主题变更时一次） |
| useCanvasRenderer（波形/裁切标尺）/ EraseCanvas 遮罩 | 工具层 UI → 接线：主题变更时读一次变量 → 缓存 → 重绘（**禁止 rAF 循环内每帧 getComputedStyle**） |
| ClipBlock 波形色 | 随片段色表（内容非 UI），不接线 |
| React Flow `colorMode` | CanvasView 与 ProcessSnapshot 均**钉 `"dark"` 常量**（画板/videos 域恒深，D4）；其他非恒深实例接 store |
| ClipBlock/Three/CanvasView 豁免项 | 不接线 |

### 3.3 测试改造口径（A/B 分工，避免同址双改）

A 段删除补偿类时同步改的断言（box-border/font-[inherit]/border-0 等）**一次性换成语义口径**（data-testid/行为断言/删除冗余断言）；B 段只改剩余"颜色字面量断言"（~33 个，如 login/page.test.tsx:29 `bg-[#f5f5f5]` → 语义 token）。

### 3.4 B 段验收

1. 暗色视觉零回退（对照 A 段基线截图，人工比对 + 预期变化清单）
2. 白名单外 0 任意值 hex（ESLint 全量启用禁令）；**跟随域 0 处 `text-white`/`text-black`（恒深/恒浅域白名单登记）**——主题色工具类迁移的门禁兜底；ESLint B 段后加**目录白名单**禁新增 text-white（绕过 lint 无法识别宿主域的难题）
3. ESLint 规则拦截新增 hex 防回归用例；**baseline 口径 = 新规则 0 违例**（非"全量规则 baseline 清零"——.eslintrc.base.json 为 strict type-aware 预设，存量全量首跑必数百条，baseline 只覆盖本立项新规则，存量规则永不卡门禁）
4. vitest 全绿

## 4. C 段：切换接线

### 4.1 主题真源与 store

- **真源 = documentElement 的 `.dark`/`.light` 类**：index.html `<head>` 内联脚本先读 localStorage 挂类（防首帧闪白）；React 侧 `useSyncExternalStore`/zustand 读同一 DOM 真源。**脚本契约（v1.6 补，随双块翻转配套）**：html 上恒有且仅有 `.light`/`.dark` 之一——`light` 挂 `.light`、`dark` 挂 `.dark`、`system` 按 matchMedia 解析**显式挂对应类**（prefers-color-scheme: light 时必须挂 `.light`：`:root` 无 JS 兜底是深色，不挂类即回退深色）；matchMedia 变更时重解析重挂
- themeStore 三态：`light`/`dark`/`system`；区分"显式选择"与"系统解析"（手选浅色后系统切深不覆盖）；`matchMedia change` 监听；localStorage 持久化
- 测试环境 matchMedia 桩恒假（test-setup.ts:3-15）→ 补可覆写桩 + system 档用例

### 4.2 antd / 组件库接线

- App.tsx ConfigProvider：algorithm 由 store 派生；`zIndexPopupBase` 保留
- AdminLayout：保持 `ProConfigProvider dark` + **岛根挂 `dark` 类**；注释**追加而非替换**——保留"内层不得显式传 darkAlgorithm 否则覆盖 Pro 注入"禁令原文，补"本子树恒深，不跟随全局（本 spec D4）"
- VideoEditorShell：保持 `darkAlgorithm` 恒深 + 壳根挂 `dark` 类（双通道）
- login/register：嵌套 `ConfigProvider`（`defaultAlgorithm`）+ `light` 类（双通道，§3.1）
- **videos 域接线（D4 恒深落地）**：router.tsx:48 `/videos/:id?` 在 AppLayout（跟随主题）公开组内 → 在 VideosPage 页根（或该路由元素）包 `ConfigProvider(darkAlgorithm)` + 挂 `dark` 类（双通道）；**相邻的 router.tsx:57 `/canvas` 不得一起包**（D4：画布壳 UI 跟随主题、仅画板恒黑）。浅色全局下 AppLayout chrome 嵌深色 videos 域为 D4 已知接受项，验收时勿当缺陷
- React Flow：ProcessSnapshot 已钉 `colorMode="dark"`（[ProcessSnapshot.tsx:89](../../../apps/web/src/pages/videos/ProcessSnapshot.tsx)）；**CanvasView 无该属性 → ReactFlow 默认 `colorMode = 'light'`（@xyflow/react 12.10.2 实证：dist/esm/index.mjs:3598 签名默认值；v1.7 订正第九轮"无默认值/wrapper 无类"的误读）→ wrapper 现状挂 `react-flow light` 类，库 light 皮肤变量一直在生效、dark 从未生效**。补 `"dark"` = light→dark 皮肤切换（`.react-flow.dark` 覆盖 26 个 `--xy-*` 变量）= **行为变更而非补遗漏声明**——C 段**实测驱动裁定**：对比范围收窄至**真正可能穿透自绘的两类组件——MiniMap（--xy-minimap-*，本仓已全内联，预期零差异）与 Controls（--xy-controls-button-*）**（Edges/--xy-node-* 已被显式覆盖/自绘，不全量扫），before/after 截图（12.10.2 上验）；零视觉差异 → 不补，**留档措辞 = "库默认 light 皮肤 + 自绘完整 + --xy-* 实际消费点清点为零/已覆盖"（勿写"测不出差异"）**；有差异 → 逐处裁定是否预期后再定。**确认不跟随 OS**：`useColorModeClass('light')` 走 `useState('light')` 恒值分支、effect 仅 `colorMode==='system'` 才监听 matchMedia → wrapper 恒挂 light 类（第十轮两份意见在此点相反，以 :3598 默认值实证为准）。两处均不接 store（D4）。**衍生注意**：`react-flow dark` 类与 Tailwind `dark` 类同名——浅色全局下 wrapper 若挂 dark，`:is(.dark *)` 可匹配画板子树（全仓 dark: 0 使用，现状零风险）；岛/画板子树"无 dark: 变体"断言必须写成 **className 无 `dark:` 前缀**、不可写成"无 dark 类"
- **portal 弹层与岛**：见 §7-O5（未定项；先例配方 video-works plan A4：静态 message 落 body、嵌套 ConfigProvider 抬不起 useApp() toast、AntdApp `component={false}`；getPopupContainer 收进壳节点先例 VideoEditorShell.tsx:136、VideoPlayerModal.tsx:62）

### 4.3 C 段验收

1. 浅/深/跟随系统三态即时切换，刷新首帧无闪白（Playwright 首帧断言，判据见 §8）
2. 原生滚动条/表单控件/video controls 随 color-scheme（computed-style 三态实证 + **岛三组对照组**）
3. 登录/登出主题跳变（默认深 + 营销页恒浅）、**切换两通道非原子**（`.dark` 类 → CSS 变量同步重算即时；antd algorithm → React render + cssinjs 注入晚一帧——切换瞬间允许一帧壳/组件不同色，Playwright 不做帧级断言）均为已知接受项
4. vitest 全绿

## 5. D 段（可选，C 后独立评估）

antd cssVar 单项评估：6 处嵌套 ConfigProvider + ProConfigProvider 下 key/串色实测、变量快照验收、components.Button.primaryColor 等覆盖生效方式确认。默认不启用。

## 6. 红线与文档修订清单（C 段收尾）

| 对象 | 修订 |
|---|---|
| specs/video-editor.md:289 | "亮色视觉 #F7F8FA"→追认实现现状暗色；删除"preflight:false 红线"整句 |
| specs/2026-09-01-workspace-ui-polish-design.md | "不动 preflight:false" 裁定条目废止标注 |
| plans/2026-09-16-video-works.md:3491 | "border 类必须配 border-solid" 项目级规约废止标注 |
| 其余提及 preflight 红线的 spec/plan（19 份命中） | 逐份标注废止，指向本 spec |
| §0.3-5/6/7 三条级联事实 | 在本 spec §0.3 已登记；C 段收尾时于 tailwind.config.ts 注释各留一行指向 |
| tailwind.config.ts | 就地注释（§2.1-1） |

## 7. 开放项（进 plan 前定稿）

- **O1** `--fw-border` 浅色值：独立变量（与正文色解耦）还是 currentColor 语义——倾向独立变量（浅色下边框随文字色会过深）
- **O2** 全局语义 token 命名表定稿（`--fw-*` 完整清单 + Tailwind colors 映射）
- **O3** ESLint 增量禁令落地机制（增量 lint / warn 基线 / CI 卡口——注：仓库无 CI，当前为本地手动执行）
- **O4** Playwright 工程位置与 webServer 接线；**门禁运行环境 = `vite build && vite preview`（产物）**——首帧无闪白断言仅在产物上有效（dev 下 Vite 经 JS 模块注入 CSS、首帧天然无样式，断言必红或无意义）；而 main.tsx `?sessionToken=` 钩子被 `import.meta.env.DEV` 包住、构建时静态替换为 false → **产物门禁的会话改走真实登录流程或后端种子数据**（钩子改造方案 (b) 会给产物留注入入口，不取）；数据夹具要求（canvas 页需节点、video-editor 需时长素材，否则断言空壳）。**v1.6 补三阻断事实（均本仓源码实证，缺一则产物门禁跑不起来）**：① [vite.config.ts](../../../apps/web/vite.config.ts) 仅 server.proxy，**preview 不读 server.proxy**——须补 `preview.proxy` **逐条复刻 4 条含 `ws: true`/`changeOrigin` 原样**（/api→3000、/socket.io(ws)→3000、/collab(ws)→3001、/flowai→9000）；② 产物代码协作走**同源** `/collab`（canvasCollabRuntime.ts:24-29 DEV 分支才直连 3001）→ preview 必须代理 WS；③ better-auth `trustedOrigins`/`baseURL` 默认 `http://localhost:5173`（auth.ts:12-14/87，可用 CORS_ORIGIN/BETTER_AUTH_URL 覆盖）→ **preview 以 `--port 5173 --strictPort` 跑**（与 dev 互斥使用）且**门禁基 URL 固定 `http://localhost:5173`**（trustedOrigins 匹配 localhost；127.0.0.1 发起登录必被拒，不用于登录流）是最少改动解。webServer 编排含四进程：prisma migrate/seed → API(3000) → hocuspocus(3001) → build+preview(5173)；**种子复用** prisma seed 既有 ADMIN 账号（admin@flowweb.local/admin12345，经 auth.api.signUpEmail 正确哈希，seed.ts:218-228），globalSetup 另建 USER + 画布节点/视频素材夹具；外部依赖**三件套（v1.7 勘误）**：Postgres + Redis 必需（auth.ts:16 顶层 new Redis，API 启动即需）、MinIO 按门禁页需要；**Keycloak 不存在**（apps/api/src 零引用，仅 .env 遗留变量与历史文档 Out-of-scope 记录——勿为其耗时误触降级）；就位限时 **30 分钟，超时降级**：产物门禁只跑 login/register 公开路由 + 需登录页面机制断言改 dev 环境（?sessionToken= 可用）+ 登记"产物暂未覆盖登录后页面"已知缺口——不让 A0 卡死在环境搭建。**Playwright 安装失败的降级只允许出现在安装手段上**（chromium-only / 复用本地缓存 / 镜像源）；仍不可用则 **A 段不得收口**（验收方式不换——A 段六条验收第 1/2/3/5 条全靠 Playwright，vitest 是"必要不充分"）
- **O5** portal 弹层两问逐项裁定。**根因（两通道穿透性不对称）**：antd algorithm/token 经 **React context 穿透 portal** ✓（React portal 保留 context 祖先链——页根 Provider 天然管到 body 挂载的 antd 弹层）；`.dark` 类 / `--fw-*` 经 **DOM 继承不穿透 portal** ✗（挂 body 的弹层祖先链里没有岛）→ 未收 container 的弹层拿到"岛的 antd token + 全局（可能浅色）的 CSS 变量"= 半半。故：**(a) 主题归属**（跟随壳/跟随全局）逐弹层裁定；**(b) 如何进岛——仅对 CSS 变量通道必要**（弹层根挂岛类 或 getPopupContainer 收进岛根，先例 VideoEditorShell.tsx:136、VideoPlayerModal.tsx:62；antd token 通道无需任何动作，勿一刀切全收 container）。**挂岛类的机制澄清（v1.6，回应"rootClassName 够不到"质疑）**：本架构依赖**岛类自身声明变量 + 后代经继承取值**（`.light { --fw-*: … }`），不依赖任何 `.light *` 后代选择器——`rootClassName="light"` 挂上 `.ant-modal-root` 后，弹层全部内容是它的后代、变量继承链完整 ✓；`:is(.dark *)` 形态的 dark: 变体同样能匹配（但岛内本就禁 dark:）。挂类仍优先于收 container（不动堆叠上下文与 z-index 比较域；本仓 VIDEO_MODAL_Z_BASE=100000、zIndexPopupBase=11000、data-zprovider 锚点断言在册）；**但每弹层必须在 O5 表登记具体机制（rootClassName / `classNames={{wrapper}}` / getPopupContainer）并以实测落点为准**——antd Modal 类落点（.ant-modal-root vs wrap）随 C5 实测，不支持才回退收 container。**可执行验收判据（v1.6 补）**：弹层内代表元素 `el.closest('.light, .dark')` 命中预期岛根（非 null、非全局 html 类）+ 岛内 token computed 与全局主题相反时保持岛值——"无半半"从目检升级为断言。**既有隐患登记**：VideoPlayerModal.tsx:62 `getPopupContainer={() => shellRef.current ?? document.body}` 存在首帧 shellRef 未挂载回退 body 的真实分支——若弹层恰在首帧打开会丢 .dark，C5 顺带登记。**LoginModal 双宿主（v1.7 裁定方案 A，实证依据）**：VideoPlayerModal.tsx:62 的局部 Provider **只设 zIndexPopupBase、无 algorithm** → 该宿主内 LoginModal 现状本就是默认（浅）渲染——黑壳白弹窗是**现状**而非新增断层；组件根固定 `defaultAlgorithm` Provider + `rootClassName="light"` 写死组件内 = **零行为变更**（方案 B"该宿主恒深"才是行为变更），且与 video-works.md:27"全仓均为浅色渲染"先例一致、免逐宿主特裁。**admin 岛弹层补入落表（v1.7）**：App.tsx 根 Provider 无 getPopupContainer → admin 全部 antd 弹层（Select/Dropdown/Tooltip/modal.confirm——AdminLayout.tsx:63-72 等）挂 body——CSS 变量取全局值、antd token 走 Pro dark → **浅色全局下必然半半**（默认深色下全局深==岛深不可见）。落表对象按**规则推导**："所有恒深岛 × 所有 portal 到 body 的弹层"（非枚举）；C5 断言矩阵加"浅色全局 × admin 弹层"格；TextNodeToolbar.tsx:195 portal 到自定义节点 `#node-toolbar-portal`（非 body）——无论挂哪都无岛类，归画板域裁定（D4）并在 C5 登记
- **O6** 定版脚本清点（方法采"源码类 − 编译产物类"差集的编译比对法，比 AST 更省；**差集结果需过"来源文件在 content glob 内"过滤**防假阳性）：① 颜色债 + 涌现面 + **主题色工具类宿主岛归属——v1.7 三列**（判定入口：**先按 D4 域映射**（画板组件清单，A0 产出）**→ 岛根祖先链 → 跟随域**；三列 = 画板恒深无岛类→**保留+禁 token 化** / 岛内→随岛 / 跟随→迁移；同一 text-white 在 PlayView（videos 恒深→保留）、SettingsLayout（跟随→迁移）、OutpaintSelectionOverlay（画板→保留禁迁移）三态结论相反，判定入必须是宿主域而非文件名；text-white 计数口径一次冻结）+ textarea 表单清点补全（全仓 7 处逐个落表）+ **[border-*-style:solid] 四格定版**（括号式/内联式 × 代码/测试——实测：类名 18 处代码 + 1 处测试断言字符串（Sidebar.test.tsx:66，随源码同步删）+ 内联 1 处（PreviewPlayer.tsx:100 borderLeftStyle，A4 顺带删）；计数反复出错的唯一来源，固定成脚本输出）；② **死类家族冻结**——现存实证 25-27 处：`text-popover-foreground` 10 + `text-muted-foreground` 8 + `text-primary-foreground`/`focus-visible:ring-ring` 4（ImageFullscreenViewer/VideoFullscreenViewer，已裁定恒深→死类落显式深色值）+ `text-fg-default` 3（EditToolbar）+ `outline-hidden` 等 v4 词汇——shadcn/v4 词汇混入 v3 的整族死类；**B 段 token 命名表定稿前必须处置**（若新命名撞上 muted/popover/primary/ring，死类集体复活并施加颜色）；清点口径含非颜色 v4 词汇。③（v1.7 新增第⑥路）**域 token 引用点 × 宿主域**：输入 `--canvas-*`/`--ve-*`/`--vw-*` 全引用点，输出"保留/语义化"两列 + 引用形态（className/内联 style）——实测跨域铁证：`--canvas-controls-*` 被 AddNodeMenu.tsx（15 处内联，画布壳=跟随→**必须语义化**）与 VideoHDPanel(8)/VideoNodeToolbar(5)/VideoTrimPanel(3)（画板节点=恒黑→保留）、AssetPanel(3)（video-editor=恒深→保留）**同时引用**——整体豁免必致浅色下画布壳菜单半半且无门禁报警（内联 var() 引用不被 hex 禁令/text-white 目录白名单/hex diff 任何一网覆盖）。**v1.8 补两条**：①**变量引用图**（CSS 内间接链）——`--ve-border: var(--canvas-controls-border)`（index.css:31）是跨域变量间接引用：若 --canvas-controls-border 被语义化，恒深域 video-editor 的 --ve-border 静默联动——组件引用点扫描覆盖不到 CSS 内的链，须单独扫 `--ve-*/--vw-*` 值中含 `var(--canvas-controls-*)` 的边；②**D4 域映射不可用路径前缀**——HistorySidebar.tsx（消费 --canvas-controls-*，画布壳）位于 `components/` 而非 `pages/canvas/`，路径口径必误判——域映射以"渲染引用边 + token 消费点"判定、路径只作初筛，HistorySidebar 作反例注释在清单。**斜杠零输出检测（第⑤路，v1.7 现象订正；v1.8 补 hex 口径钉死）**：A0 首跑即建全仓 slash-on-var 存量基线（当前 0），此后产物 CSS 存在性检查违例即红；**hex 任意值+斜杠实测正常**（`text-[#4ade80]/50` → `rgb(74 222 128 / 0.5)`，本仓内存编译——第十轮"丢 alpha"复核实为误测，28 处 hex+斜杠现存用法无恙，无需扩第二路检测/无需 ESLint 禁组合）。行号口径：以元素起始行为准，最终由本脚本定版；**稳定键 = 文件+宿主元素特征（非行号）**

## 8. 验收门禁：Playwright 设计（D8）

- **门禁（布尔断言，可 CI）**：裸 button computed-style 四项归零；`--fw-border`/语义变量实际生效值；**源序断言（v1.6 翻转口径）**——html.light 下 `getComputedStyle(document.documentElement).getPropertyValue('--fw-*')` 取**浅值**（`.light` 源序胜 `:root,.dark`），html.dark 与无类时取深值（D3 兜底）——源序是约定非机制，防"整理 CSS 顺序"静默翻车；`document.styleSheets` 顺序；三态 DOM 类；岛三组对照组 token 反转正确性；**岛子树内无 `dark:` 变体遍历断言**（§0.3-7 优先载体；岛断言**只落 Playwright 不落 vitest**——test-setup.ts:47-82 清空含 `:has(` 的 antd 样式 + jsdom 不解析 CSS 变量，vitest 拿不到可判颜色）；首帧无闪白；**加载稳定判据 = 目标元素出现 + 固定等待上限**（禁 networkidle——socket.io/ws 长连接 + antd 动画使其永不到来）
- **首帧无闪白可执行判据**：静态——内联脚本位于 `<head>`、先于 `<script type="module">`、无 defer/async；运行时——`page.addInitScript` 挂 MutationObserver 记录 `<html>` class 首次变化，断言 `.dark` 出现在首个渲染内容之前
- **门禁页面优先不依赖 WebGL**（login/register/workspace/admin/React Flow 页 DOM+SVG 安全；Three/LightingEngine 页 headless 初始化异常风险，不入门禁集）
- **人工验收工件（非 pass/fail）**：浅/深 × 页面矩阵截图，附预期变化清单；基线归属与更新流程（A 段建立、B 段比对、C 段重建）；canvas/WebGL/视频页禁截图比对（antd 动画、Three 逐帧渲染、波形解码非确定性），改用 computed-style + 元素存在性断言
- 执行方式：本地手动（仓库无 .github/CI，建 CI 不在本立项范围）

## 9. 明确不做

不升 Tailwind v4 / antd 6（D6）；不启用 antd cssVar（D5）；主题不落库（D7）；不做向后兼容/存量防护（D10）；register 浅色重做为并行独立任务不占段位；**不建 CI**（Playwright 为本地门禁）。

## 10. 修订记录

### v1.9（2026-09-19，实施期实证订正——模型服从实测）

1. **§0.3-4 订正（G4 方向）**：antd cssinjs 为 head **prepend** 注入（实测 head 序：antd STYLE×32 → 产品 link 后置）→ 同特异性平局**产品层后序胜**（非"antd 晚于产物恒胜"）；A1-5 规则级守卫断言实测方向。
2. **A5 三处订正**：spec 预测的 26px（.new-folder-btn）/2px（.ant-modal-content）box-sizing 回归未复现（前者为 button UA border-box、后者 antd 已先行 border-box）；PropertiesPanel:138/156 括号补偿删除安全（preflight `*` 接管，含 input[type=color] 第三类宿主）；Tiptap 8 门禁页 0 渲染（成对回退修法保持备案）。
3. **O5 两处订正（C5 实测）**：WeChatFollowModal 营销恒浅初判→**恒深**（宿主 Sidebar 跟随域+深色自绘，无岛时 html.light 真半半；恒深=零暗色回退+修复浅色）；WeChatQRModal 恒浅初判→**无需岛**（跟随域宿主+全字面色双主题自洽）。
4. **O4 勘误（A0-0 实测）**："四进程"实为 2 长驻（hocuspocus 3001 经 collab.gateway onModuleInit 与 API 同进程）；webServer 两入口+migrate/seed 链入 API 命令。
5. **§3.2 表订正（C3 清点）**：TimelineRuler 非 canvas 渲染器（div+Tailwind --ve-* 变量，JS 通道不存在）；WaveSurfer 经 @wavesurfer/react hook 唯一实例 AudioWaveform；JS 通道跟随域消费者空集。
6. **O6 订正（B3 实测）**：allDeadSkipped 101 全为单 token 非类字面量假阳性（MIME/样式值/夹具）——route③ 已收紧 ≥2 token；死类家族实证 30（含新发现 z-5 ×3）。
7. **D4 补充（A2 修复期实证）**：@xyflow wrapper 运行时默认挂 light 类与 .light 令牌岛撞名（AnnotationToolbar 实害）→ CanvasView 钉 colorMode="dark"+bgColor transparent+selection 钉值（C2-6 裁定提前至 A2 修复完成，两条非预判通道：background 底色/selection rect）；Board wrapper 的 dark 类在 B0 后天然构成画板值域岛（B6 岛不变性探针 4/4）。
8. **B5 口径**：hex 基线保留（恒深域字面量豁免载体，终值 261）；no-theme-utility 目录白名单零容忍直行。

### v1.8（2026-09-18，第十轮审核：plan v1.2 复核三份 + 本仓编译/计数实证）

1. **hex+斜杠"丢 alpha"证伪**（本仓内存编译：`text-[#4ade80]/50` → `rgb(74 222 128 / 0.5)` 正常）——第十轮意见一所称"两种错误模式"只剩 var() 键+斜杠=零输出一种（已覆盖）；O6 斜杠检测不扩第二路、ESLint 不加禁组合（28 处 hex+斜杠现存用法无恙）
2. **§2.3 涌现面补裁定维度与 divide 新类**：裸 border ~324（忘给色，逐处裁定）与 border-[color] ~238（写全被关，几乎全保留）**拆列**（裁定标准不同）；**divide 子元素线**（宽度生成在子元素、UA style:none 使全站 divide 线现状不可见——TeamBillingPage:140 实证；"border-none 压 divide"场景本仓不存在，divide 涌现与 border-none 删除无关）；裸 border-dashed 不构成一类（4 处全带宽度）；[border-*-style:*] 口径 19=solid 18+dashed 1（VideoEditNode:214 顺带删）
3. **§3.2 通道扩五类**：ring（5 处、≥4 跟随域浅色下 ring 消失）/divide（1 处）补入 overlay 线通道；分列正则吃变体前缀（focus-within:/hover: 实证 2 处）
4. **§2.6-1 恒浅断言改岛根 computed border-color**（login 岛根 :19 无 border 声明实证）——一条断言走完整级联同时验桥接+覆盖+消费，**撤回 v1.7 受控探针**（不往产品代码注入测试脚手架）
5. **§4.2 C2-6 对比范围收窄**（MiniMap+Controls 两类，Edges/node 已自绘不全量扫）+ 留档措辞固化（"库默认 light+自绘完整+消费点清点"，勿写"测不出差异"）+ **"不跟随 OS"确认**（useState('light') 恒值分支、effect 仅 system 监听 matchMedia——第十轮两份意见相反，以 :3598 默认值实证为准）
6. **O6 域 token 路补两条**：变量引用图（--ve-border: var(--canvas-controls-border) index.css:31 间接链，CSS 内的边组件扫描覆盖不到）+ 域映射禁用路径前缀（HistorySidebar 反例，以引用边/消费点判定）
7. **O2 衍生（plan 同步）**：text-dim 收 **3 档** .30/.45/.60（删 dim-4：浅色档与 --fw-text-strong #111827 撞值；/80~/90 共 27 处归 --fw-text——80:8/85:4/90:15 实测，"~10 处"为低估）；--fw-accent-text 浅色档 #16a34a（3.10:1）不过正文 AA → **#15803d 系（4.72:1，手算待 B0 工具校准）**；::placeholder 档位界定（现状字面值 #666/#999/#555/#646464/neutral-500 多在恒深/营销岛，全局覆盖只影响未写色输入框——B0 定 dim 档）
8. **A4 衍生（plan 同步）**：border-none 处置改**静态规则为主**（同串有宽度类→保留；无→纯冗余可删且宽度不变；antd 宿主跳过）+ A5 属性层 border-width 校验兜底（diff 反推有噪声：border-box 下加边框不改 rect，几何层必漏——属性层才是判据）；aria-disabled 净 1 处（VideoTrimPanel.tsx:168，另 3 行为测试）；C0-4 持续断言标注仅 C 段用例文件（A/B 段 html 无类合法）；浅色基线维持 B6 收尾采一次（B3 死类视觉变更登记预期清单，不 double 采）

### v1.7（2026-09-18，第九轮审核：plan v1.1 复核三份 + 本仓源码/内存编译/计数实证）

1. **§3.1 斜杠现象订正为"静默零输出"**（本仓内存编译实证：bg-surface/50、border-surface/30、ring-surface/40 产物 CSS 无规则，非"颜色错"）→ 检测机械化（产物 CSS 存在性检查）+ 时点提前 A0 首跑建基线 + `--x-rgb` 裸通道值约定 + 开斜杠键白名单默认全关
2. **D4 补画板精确边界**（P0）：画板=无岛类恒深值域，子树禁 token 工具类（实证 OutpaintSelectionOverlay bg-white/30 网格线、TextNodeToolbar text-white/90+硬编码底浅色必坏）；O6③ 宿主岛归属改三列（D4 域映射→岛根→跟随）；pages/canvas text-white 83 处按画板/壳二分
3. **O6 增第⑥路"域 token 引用点×宿主域"**（P0）：--canvas-controls-* 跨域引用实证（AddNodeMenu 15 处内联=壳须语义化；VideoHDPanel 8/VideoNodeToolbar 5/VideoTrimPanel 3=画板保留；AssetPanel 3=video-editor 保留）；内联 var() 引用不被任何既有门禁覆盖
4. **§4.2 CanvasView colorMode 订正与实测驱动裁定**：ReactFlow 默认 colorMode='light'（12.10.2 dist :3598 实证，订正第九轮"无默认值/wrapper 无类"误读）→ wrapper 现状挂 light 类；补 dark=light→dark 皮肤切换=行为变更，C 段挂/不挂对比后定（零差异不补）；react-flow dark 类与 Tailwind dark 同名 → "无 dark:" 断言措辞固化
5. **O5 补 admin 岛弹层**（规则推导落表：恒深岛×portal body 弹层）+ LoginModal 裁定方案 A 的实证依据（VideoPlayerModal.tsx:62 Provider 无 algorithm → 该宿主现状本就浅色渲染，A=零行为变更）+ TextNodeToolbar portal 自定义节点登记
6. **O4 勘误三件套**（Keycloak 不存在：apps/api/src 零引用）+ proxy 逐条复刻含 ws/changeOrigin + 基 URL 固定 localhost（trustedOrigins 匹配）+ Playwright 安装失败降级收紧（只许安装手段，仍不可用则 A 段不收口）
7. **O2 衍生（plan 同步）**：新增 `--fw-accent-text`（前景用，text-[#4ade80] 17 文件实证，浅色档加深）+ 删 `--fw-accent-success`（两名一值）+ accent 来源措辞改"字面量全局分布+AdminLayout colorPrimary（岛内）"+ text-dim 梯度 3→4 档（.30 占位/装饰档实证：EmptyState/WorkspaceBreadcrumb/VideoCard"暂无封面"）
8. **§2.6-1 恒浅断言双断言**：岛根变量直读 + 受控探针（零尺寸裸 border div 验 preflight 桥接真实落地——变量直读验不到的唯一失败模式）
9. **O6 ①补 [border-*-style:solid] 四格定版**（括号/内联×代码/测试；实测 18 代码+1 测试断言字符串 Sidebar.test:66+1 内联 PreviewPlayer.tsx:100）+ 稳定键固化
10. **A4 衍生（plan 同步）**：border-none 校验串扩 divide-{x,y}/带值宽度类（TeamBillingPage:140 divide-y 实证）+ opacity-0 group-hover 宿主人工裁定；disabled 规则登记"默认值改变"非 bug 修复 + 补 button[aria-disabled] 变体（4 处存量）

### v1.6（2026-09-18，第八轮审核：plan 复核三份 + 本仓源码/计数实证）

1. **§3.1 双块方向翻转**（P0）：原 `:root,.light{浅}/.dark{深}` 使 B 段（无挂类）默认渲染浅色，与 D3 冲突、破坏段间独立验收 → 改 `:root,.dark{深}/.light{浅在后}`；B 段默认=深=现状零回退；§0.3-6 源序约束、§8 源序断言同步翻转；§4.1 补脚本契约（html 恒有且仅一类；system-light 必须显式挂 .light）
2. **§3.1 补斜杠静默失效硬约束**（源码实证 color.js:78-81 裸 var() → null；withAlphaVariable.js:53-58 fallback 丢 alpha 无警告）：token 值单值、alpha 烤进字面值；需斜杠的键用 `rgb(var(--x-rgb)/<alpha-value>)`；B0 后审计加"config 裸 var × 斜杠使用"检测
3. **§0.1/§2.6-1 before 表述订正 + 断言分组**：WorkspaceTabBar 未选臂带 border-none（作者声明压 UA outset）→ before=none 非 outset；after 断言选中臂（solid/2px/x·t 0，A2 绿）与未选臂（solid+0，A4 删 border-none 后绿）分归 A2/A4 验收；恒浅区断言改**岛根变量直读**（login 岛 border 全带显式色，无天然探针）；font 断言口径=父级 computed 值
4. **§3.2 叠层族拆三通道**（实测 bg 197/12 档、border 54/10 档、text 93/11 档全在 30-90%）：面线→overlay-1/2/3；文字淡化→独立 --fw-text-dim 梯度 ≥3 档（压 overlay=暗色大面积不可见回退）；碎档按 UI 语义归并；审计按属性×透明度分列
5. **§3.1 域 token 并入范围收窄**：恒深域 token 原地保留+豁免登记；--canvas-handle-*/--edge-flow-*/--canvas-shadow-*/--z-panel（z-index 非颜色）永不并入；O2 表补"现状来源"列
6. **D9/§2.5/§3.4 删窗口期裸 border 规则**（A2 后裸 border 即目标写法，规则恒假阳性）；hex 禁令收窄颜色前缀（防 w-[]/url(#) 误报）+ 范围声明（不拦 style 对象）；baseline 只覆盖新规则、口径=新规则 0 违例（.eslintrc.base.json 为 strict type-aware，存量全量首跑必数百条）
7. **O4 补产物门禁三阻断**（vite preview 不读 server.proxy / 产物 collab 走同源 / trustedOrigins 默认 5173）+ 四进程编排（seed 复用 admin 账号 + API + hocuspocus + preview --port 5173 --strictPort）+ 四件套 30 分钟降级判据 + 稳定判据（目标元素+固定上限，禁 networkidle）
8. **O5 补机制列与断言判据**：每弹层登记具体机制（rootClassName/classNames.wrapper/getPopupContainer，实测落点为准）；`el.closest('.light,.dark')` 岛后代断言；VideoPlayerModal getPopupContainer 首帧回退 body 隐患登记；LoginModal 双宿主推荐方案 A（组件内写死恒浅，待用户确认）
9. **§2.2 disabled 光标改一行全局 CSS**（preflight button cursor:pointer + :disabled default 实证 preflight.css:343/351；逐处类名是无边界任务）
10. **§4.2 CanvasView 补钉 colorMode="dark"**（实测全仓 colorMode 仅 ProcessSnapshot.tsx:89 一处，CanvasView 缺属性）；§8 补岛内禁 dark: 遍历断言优先落 Playwright（test-setup 清 :has() 样式 + jsdom 不解变量，岛断言不落 vitest）

### v1.5（2026-09-18，第七轮审核 + 本仓编译/实测）

1. §2.1-1 补**两形态对照与选型理由**（本仓编译实证：'class'→`:is(.dark *)` (0,2,0) / 'selector'→`:where(.dark, .dark *)` (0,1,0)）——'class' 的恒压使岛内误用 dark: 可见，'selector' 使误用无声；勿顺手改新推荐
2. §0.3-7 机械检查明确**D8 断言优先**（岛子树遍历断无 dark: 前缀，ESLint 仅补充）
3. §2.6-1 恒浅区 `--fw-border` 升级为 **computed-style 断言**（岛机制唯一直检点，A 段提前证伪 B/C 段最大风险）
4. §2.6-2 机械 diff 改**两层口径**（属性层聚合 / 几何层逐元素 rect——box-sizing 是原因、rect 变化才是后果；color 降级仅表单控件）+ before 基线取改动前 commit 存档 + 稳定 key + 动态区排除
5. **D4 补两处归属**：canvas 域两个全屏查看器（死类家族主体）**恒深**；AppLayout chrome（Sidebar/TopActionBar）**跟随主题**并点名工作量
6. §3.2 补**半透明叠层族单列通道**（white/NN 93+ 处→`--fw-overlay-*` 叠层 token，浅色下语义不同非换色可解）+ **text-black 归 `--fw-on-accent`**（强调按钮前景色，非主题色）
7. §3.4 补**跟随域 0 处 text-white/text-black 验收** + ESLint 目录白名单禁新增（主题色工具类的门禁兜底）
8. **O4 门禁环境裁定**：`vite build && vite preview`（首帧无闪白断言仅产物有效；dev 下 Vite CSS 经 JS 注入首帧无样式；sessionToken 钩子 DEV-only 构建即失——产物门禁会话走真实登录/种子数据，不取留入口的钩子改造方案）
9. O5 补**挂岛类优先**动作排序（收 container 动 z-index 比较域，本仓 z-index 约定在册；antd Modal rootClassName 可行性实测项）
10. O6 补**宿主岛归属输出**（保留/迁移两列，判定入=宿主域非文件名）+ content glob 假阳性过滤 + textarea 7 处补全 + text-white 计数冻结
11. `::placeholder{color:gray-400}` 登记：base 层唯一硬编码色，B 段覆盖为语义 token（否则 token 层留永久的洞）
12. `[hidden]` 特异性表述统一为 (0,1,0) 结案，不再追溯提出方

### v1.4（2026-09-18，第六轮审核 + 本仓编译/实测）

1. **§0.3-7 编译订正（本仓 Tailwind 3.4.19 实测编译）**：v1.3 写的产物形态 `:where(.dark, .dark *)` 及"特异性归零、可被普通工具类覆盖"**错误**——实测产物 `.dark\:bg-black:is(.dark *)`，`:is()` 取参数最高特异性 → **(0,2,0) 恒压**普通工具类与语义 token 类（同 0,1,0）；"岛内禁 dark:"升级为 D8 断言/ESLint 机械检查。v1.3 记录第 3 条中 `[hidden]` 特异性分歧已收敛（提出方本轮确认 spec 原判 (0,1,0) 正确，非幻影分歧——分歧真实存在且已结案）
2. §0.1/§2.4 手写 CSS 边界修正：主缺陷（border）不影响 ✓，但"免查"过强——4 文件均无 box-sizing 声明，preflight 翻转后 `width:100%+padding/border` 组合变窄（`.new-folder-btn` 26px 实测实例）→ 进 box-sizing 回归清单
3. §2.3 第二类量级订正：≈44+ 处（button 31/input 10/select 1/textarea ≥2 正则下界，AST 冻结）；**删"带显式补偿或显式色"豁免表述**（显式色不免除 outset→solid 的 style 变化）
4. §0.2 颜色债口径扩**主题色工具类**（text-white 213/65 文件、text-black 16 实测）按宿主切分纳入 B；调色板类范围随 O2 声明
5. O6 方法升级：AST 改**编译差集法**（源码类−产物类）；死类家族冻结 ≈25 处（含 text-popover-foreground/text-muted-foreground/ring-ring/outline-hidden 等 shadcn/v4 词汇——B 段命名撞名即集体复活）
6. O5 补**两通道穿透性不对称根因**（antd token 经 React context 穿透 portal ✓ / CSS 变量经 DOM 继承不穿透 ✗）+ videos 域弹层落表 + "仅 CSS 通道需进岛动作"（勿一刀切 getPopupContainer）
7. §2.6-2 升级为**机械 diff**：代表性页面全元素 × 受影响属性集 before/after 快照 diff + 预期/意外白名单——五轮反复的"UA 行为待实证"条目（file-selector/input[type=color]/border-none 删除后果）一次闭环
8. §4.3 补**切换两通道非原子**已知接受项（CSS 变量即时 / antd 晚一帧，不做帧级断言）
9. §0.3-4 `[type='search']` 标注"外观类、与 border 平局无关"（保留于 (0,1,0) 档事实清单）
10. D2 机制本仓编译顺带复验：`borderColor.DEFAULT` 确落 preflight `*` 规则（`border-color: var(--fw-border)`）✓

### v1.3（2026-09-18，第五轮审核 + 实测）

1. §0.1 二类改**三类分裂**（补"UA 不给可见边框的表单控件"——input[type=color] 实证）；自证②订正为 17/19 非表单 + 2 处表单控件（PropertiesPanel.tsx:138/156）；补**手写 CSS 边界声明**（4 文件均 border 简写不受主缺陷影响）；A 段首测试改 **before/after 成对**（TDD 先红后绿——before 记录 outset 基线、after 验收 solid 并兼验 origin 铁律；原"outset+2px"写在验收侧是时刻混淆）
2. §0.1-2 补 buttonface 机制与验收期望值 `rgba(0,0,0,0)`；`-webkit-appearance: button` 标注为有意修正
3. §0.3-7 补 v3.4 产物形态 `:where(.dark, .dark *)` 及特异性归零推论（未采纳"[hidden] 属 (0,0,1)"订正——`:where` 只归零自身参数，`[hidden]` 主体仍是属性选择器 (0,1,0)）
4. §2.3 涌现扩**两类**：从无到有（非表单）+ **从斜面到扁平**（表单 outset/inset→solid 可辨，非"几乎无差"；面小：裸 select 1 + 裸 textarea AST 清点）
5. §2.2 border-none 7 处归因拆两类（5 假阳性 + 2 分支互斥）；校验口径写死为模板分支展开；补 `text-inherit`/覆盖层 `p-0` 行（textarea 5 处确定冗余、Link 5 处保留待实测）
6. §2.4 订正与增补：file input 无风险机制改"透明覆盖层 opacity:0"（MaterialLibraryModal.css:32，非 hidden）；checkbox/range accent 8 处全带显式 accent → 降级免复审；补材料库 Modal（暗色 antd 覆写 → B 段）；补 PropertiesPanel 两处表单补偿裁定行；"待核"条目移 O6
7. §3.2 白名单补**手写 CSS 通道**三行（MaterialLibraryModal 迁移 / PromptInput+NodeHandle 画布豁免 / index.css 为 B 段核心）——第五类颜色载体入册
8. §4.2 补 **videos 域接线**（VideosPage 页根双通道包 Provider+dark 类；/canvas 相邻勿包；AppLayout 内嵌深色域为已知接受项）
9. §3.1 恒浅 antd 通道修正为**挂组件自身**（login/register 页零 antd 实测）+ LoginModal **双宿主**（TopActionBar 全局 / VideoPlayerModal 恒深域内）入 O5 特裁
10. O6 扩**双清点**（+未定义颜色工具类，text-fg-default 三处实证）；行号口径声明

### v1.2（2026-09-18，第四轮审核 + 实测）

1. §0.1 缺陷定性改为**按元素类型分裂**：表单控件 border 类一直半活（UA outset/inset）、仅非表单元素全死——项目内自证 WorkspaceTabBar（button border-b-2 无补偿、验收过）+ 19 处补偿全在非表单元素；A 段首测试固化三条 computed-style
2. §0.1-2 "三项"订正为**四项**（补 background-color），§2.6-1 断言同步补第四项
3. §0.2 增列**第 5 类暗色机制**（3 处局部 ConfigProvider 硬编码组件 token，实测确认；B 段纳入）
4. §0.3-4 补"preflight 也含 (0,1,0) 档规则，平局只发生在该档"
5. D4 补 **videos 域整体恒深**；§3.2 ProcessSnapshot colorMode 改钉常量（原"接 store"与 D4 对撞）
6. §2.2 补 bg-transparent hover/条件组合保留；border-none 注释补"表单控件删后退 outset、宽度类存活即涌现"（同串校验含条件分支）
7. §2.3 重写：按元素分裂口径 + 四类计数不互斥（AST 互斥定版，外部实测元素级 ~153/无色 ~10）+ 死视觉审计收窄（有 bg 时 rounded 活）+ 5 个无显式文字色 textarea 对比度审计
8. §2.4 补：裸 select 仅 1 处明细、::file-selector-button 已核查无风险（13 处全隐藏式）、checkbox accent 目检、Tiptap img 修法**两项成对回退**（补 vertical-align:baseline）
9. §2.5/D9 "禁裸 border"订正：非表单宿主、**A→B 窗口期临时规则 B 段末撤销**（原理由"浅色下错色"不成立——B 段后裸 border+双套正是目标写法，永久禁令自我阻断）
10. §3.1 补**岛双通道通则**（缺一即半亮半暗）+ 三处缺口修复（admin 补 dark 类、login/register 补嵌套 defaultAlgorithm）+ 岛三组对照组
11. §4.2 AdminLayout 注释改**追加不替换**（保留内层禁令）；O5 拆**两问**（归属 + portal 如何进岛 getPopupContainer）
12. §8 补 `.dark` 源序断言、首帧判据 recipe、WebGL 页回避

### v1.1（2026-09-18，三轮审核 + 实测）

引证替换（Sidebar→video-works 勘误）、级联事实补 5/6/7 三条、darkMode:'class' 补入、恒浅 .light 覆盖、box-border 46、cursor-pointer 删 input、border-none 机制订正、line-height/裸表单失边框/Tiptap img 清单补、ESLint 升验收、双类作用域架构、白名单按通道、JS 通道逐组件表、D8 截图降级、B/C 补 vitest。
