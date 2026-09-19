# 画布域主题跟随设计（C8）spec v1.1

- 日期：2026-09-20（v1.1 同日修订：三轮架构审核 20+ 项收口——matchMediaMock 事实更正、no-theme-utility 扩规则、differ 属性族扩展、P6 判据重写、P3 scrim 收窄、域 token 浅值先定后动等）
- 状态：待评审
- 关联：`2026-09-18-css-base-layer-theme-design.md`（v1.9，本 spec 是其画布域解封续篇）、c5-portal-census.json、c7-accepted-items.md、b6-acceptance.md、domain-token-adjudication-B0.json、b2-migration-registry.json
- 需求来源：用户提出「Canvas 画布页面的节点卡、悬浮工具条、底部面板、画布颜色等元素跟随主题（浅色下变浅）；主题只分浅色/深色两档，无跟随系统，默认深色」；三轮架构审核修订 + 用户 9 项产品裁定（P1-P9）。

## 1. 背景与目标

v1.9 的 A/B/C 段完成了站点 chrome 的双主题化，但画布域（pages/canvas）被 B2/C2 裁定为「恒深禁迁移域」：`colorMode="dark"` 钉死（C2-6）、板面 `bg-[#000000]` 硬编码、79 文件色字面量、`--canvas-controls-*`/`--ve-*`/`--vw-*` 单值深色。本期解封该域并同步简化主题模型。

**目标**：
1. 主题模型两态化：`light | dark`，默认 dark，删除 system 档（含 matchMedia 全链路）。
2. 画布域全量跟随主题：画板底/点、节点卡（8 类）、悬浮工具条（6 个）、底部面板、CanvasTopBar、MiniMap、config-panel、画布可达长尾。
3. 范围扩大裁定（用户）：video-editor 壳内部、videos 播放壳（含 PlayView/VideoPlayerModal 与画布内 Image/VideoFullscreenViewer）、WeChatFollowModal、CreditsDropdown 一并跟随；CreditsDropdown 浅色重做。
4. CanvasTopBar 增设主题切换钮（/canvas 不套 AppLayout，现状无切换入口）。

**非目标**：
- LoginModal 恒浅（登录域，不在画布链路）。
- admin 域（Pro dark 恒深，不在画布链路）。
- WebGL/渲染产物层（**逐文件白名单，非整目录**）：`video-editor/renderer/canvas-renderer.ts`(+export worker)、`engine/Angle3DEngine.ts`、`engine/LightingEngine.ts`、`Lighting/ThreePreview.tsx`、`Angle3D/Angle3DPreview.tsx`——技术性不可迁移，白名单保留（含 JS 通道 #000/#FFF 经 VideoEditNode.tsx:129 复用到画板 mini 播放器的链路，c3-js-channel-census.json 补登）。⚠ 同目录的 LightingModal/ControlPanel/ViewToggle/LightPresetButtons、Angle3DModal/ControlPanel/AnglePresetButtons 等是普通 chrome（canvas/page.tsx:304-305 直挂画布页），**属本期迁移范围**（§11.2），勿借目录白名单逃逸。
- 跨设备主题同步（无产品需求，将来 user-preferences 字段，与本期解耦）。

## 2. 产品裁定登记（P 表）

| # | 裁定 | 内容 |
|---|---|---|
| P1 | 主题两态 | 仅 light/dark，默认 dark，无跟随系统。产品理由（用户裁定）+ 技术理由：跟随域从 3 处扩到 80+ 处后，OS 运行时翻转触发 React Flow/ve/antd 大面积重绘，且 antd cssinjs 与 CSS 变量双通道非原子（晚一帧），可视频闪面积显著变大 |
| P2 | 板底/点色 | 浅色板底 `#F5F5F5`、网格点 `#C8C8C8`；深色维持 `#000000`/`#555555`。对比度实测（统一工具口径记录，续 B0 惯例）：深档点 #555555@#000000 ≈**2.96:1**；#DCDCDC@#F5F5F5 ≈1.26:1（过淡弃用）；#C8C8C8@#F5F5F5 ≈**1.55:1**——浅档网格点天然低于深档（约 52%），目检认可登记 §13，勿后续当缺陷 |
| P3 | 播放壳跟随 | VideoPlayerModal/PlayView 翻浅（不采用"媒体查看器恒深"备选）。承诺收窄定死：① 删 `[color-scheme:dark]`（含 VideoPlayerModal.test.tsx:168-173 断言）② **画面外**壳 chrome（Modal 外框/关闭钮/轮播条/页面级按钮）双值化；**压在画面上的浮层保持深 scrim+白字恒定**（PlayView:69/:83 from-black、text-white/90、bg-black/70 时长条——行业惯例 YouTube/B 站浅色模式同构，浅 scrim 遇亮画面不可读），归第四通道"内容叠加层" ③ 画布内 ImageFullscreenViewer/VideoFullscreenViewer 一并跟随（杜绝同类两制）。**DOM 拆分前置**：画面垫底元素必须从壳根拆出独立（媒体容器自持固定深底，P6 判据）——现状 letterbox 与 chrome 共用同一壳根（VideoPlayerModal.tsx:58）物理上无法两全，不拆则 P3/P6 落到同一 class 只能二选一 |
| P4 | VideoEditNode | 跟随主题：深色档从白卡变深卡。有意视觉变更，登记 differExpectedPairs + B6 目检；浅色档与其他节点卡一致 |
| P5 | CreditsDropdown | 浅色重做（出浅色稿，实现期用 ui-ux-pro-max；**浅色稿 D3 开工前产出**——它在 CanvasTopBar 关键路径上）。现状精确描述：基底=inline 深色渐变（:127 linear-gradient 160deg #111111/#171717/#101828）+ :271 bg-zinc-900 图标底，浅色稿重做这两处；:267 邀请卡 bg-white + hover:bg-zinc-100 与 bg-black/[.06] 族灰系中性色**保留不 token 化**（通道 3，永不过期）。深色档现状冻结（mode 分支而非全局替换，配深档字节等值像素守卫）；有意变更登记 differExpectedPairs |
| P6 | 内容承载裁定 | 通则：**用户内容自身的不透明像素不随主题；承载容器按判据二分**。判据（机械可判）：该容器的底色是否会被用户内容**完全覆盖**？——会（媒体视口/卡内媒体容器：底色仅在加载前/透明 PNG/letterbox 露出）→ 卡壳/壳 chrome 跟随 + **垫底恒深**；不会（TextInputNode 文本节点、EraseCanvas 涂抹画布、便签类**内容容器**——底色永远可见）→ **整体跟随主题**（浅色下变浅，否则直接违背"节点卡本身跟随主题"需求）。恒深垫底仅限独立画面视口（全屏查看器/ve 预览区/过程快照/clip 块面）。**交互态色不是内容色**：selectionTokens、StoryboardGroupRenderer #333 组边框/#fffff0 分镜格、--xy-selection-* 属主题派生交互可视性 → 双主题值 + 两态可见性实测断言（防浅色下选中框消失）。真正的用户内容色：标注调色板 #FF0000/#FFD700/#0066FF、字幕字色、**userColor()**（RemoteCursors.tsx:30/:34、CanvasTopBar.tsx:135 协作光标/头像色，本期补登）→ 字面恒定 |
| P7 | 岛原子性通则 | 凡留深子树，面/前景/边框必须一起钉（.dark 类或全字面）；**禁止"面钉深、前景走 token"及反向混搭**。现状两条反例：① 宿主药丸 CanvasTopBar.tsx:147 bg-[#1A1A1A]/90（面钉深）配 CreditsDropdown 触发钮 text-text（前景跟随）→ html.light 下 ≈1.1–1.2:1 不可读；② AnnotationToolbar 组件内五件混搭（BAR_BG 深底 + :332 恒白保存钮 + :230/:254 白系选中环/分隔线 + :135/:170 白系 hover）→ 浅色下"白上加白"（§11.2 专项）。机械判据：同一组件内不得存在"随主题底 + 不随主题前景"（或反向）的色字面与 token 共现 |
| P8 | system 残留 | localStorage 残留 `'system'` 仅读取侧映射为 dark，**不回写**（保持 boot 不写盘契约）；登记已知接受项（开发期无用户数据，影响为零）。配套：storage 与 html 类冲突时**storage 优先并回挂 html 类**（ensureInit 现状 :71-77 信任 html 类，单值化后反转——守防闪白脚本与 store 同口径，themeStore.test.ts:83-90 用例随改写非删） |
| P9 | --ve-accent 提亮 | #6C5CE7 深底 3.84:1 现状已低于 AA（非本期引入，本期顺手修）：**全档提亮至 `#8B7CF6`**（深底 ≈6:1 达 AA、白底 ≈3.1:1 达非文本 3:1，品牌紫同系）。消费点均在图形强调位（PreviewPlayer 播放钮/ClipBlock 选中条/ExportModal Progress），无正文用例；登记有意变更 differExpectedPairs + B6 目检 |

## 3. 废止与反转登记（E 表）

| 原裁定/登记 | 位置 | 动作 |
|---|---|---|
| C2-6 colorMode 钉死 | CanvasView.tsx:379 + spec v1.9 :166 | **废止**，改 colorMode={mode}（D2） |
| 画板恒深值域 + 子树禁 token 工具类 | spec v1.9 :268 | **整条废止**（"禁 token 工具类"是恒深裁定的推论，裁定废止则推论同步废止；本期往画板子树大规模注入 token） |
| 画板域禁迁移（B2）+ spec :269 保留裁定（VideoHDPanel 8/VideoNodeToolbar 5/VideoTrimPanel 3=画板保留、AssetPanel 3=ve 保留） | spec v1.9 :269 | **废止反转**：全部转入迁移范围 |
| C5 三项恒深岛 | VideoEditorShell 壳根 .dark、VideoPlayerModal 壳根 .dark、WeChatFollowModal 恒深双通道 | **废止**：ve 壳/videos 壳/WeChatFollowModal 改跟随（各自与断言反转同 commit 原子执行） |
| 两个全屏查看器恒深 | spec v1.9 :149/:297 | **废止**，改跟随（P3 承诺③） |
| PromptInput.css/NodeHandle.css 画布域豁免 | spec v1.9 :151 | **反转**：纳入迁移（28+1 处） |
| B0 keepAsIs/indirectChain/neverMerge | domain-token-adjudication-B0.json | **整表重裁定**（前提"画板恒深域与岛内恒深域"消失）；neverMerge 中 --canvas-handle-*/--edge-*/--canvas-shadow-*/--z-panel 按 D1a 逐键重裁。⚠ 表内 AddNodeMenu 15 处/HistorySidebar 2 处为过期快照（现已只消费 --fw-*，AddNodeMenu.tsx:305 仅剩 --canvas-shadow-menu），先修表再引用 |
| c7 已知接受项 #1/#2/#3/#7 | c7-accepted-items.md §1 | **失效改写**（videos 钮可见/浅 chrome 嵌深域/WeChatFollowModal 恒深/药丸恒深——药丸随 D3 chrome 化结案） |
| c7 §3 归因表"岛桥回深" | c7-accepted-items.md §3 | ve 344 + videos 140 = 484 条 borderColor 边**方向反转**；admin 984 条不变 |
| c5 portal census WeChatFollowModal wired | c5-portal-census.json | 条目退出（改跟随） |
| G8③ 双岛并存论断 | c0-theme.spec.ts:556-579 | 语义消亡，重写为「壳浅 × LoginModal 浅」同色双层或改宿主（TopActionBar 路径 G7 :461 仍有效） |
| video-editor 原始亮色规格 | video-editor.md:289 | **复活**：背景 #F7F8FA 与 --fw-bg 浅值逐字相同，作为 ve 浅色档验收依据；"面板白"与 --ve-panel 浅值 #f0f1f2（surface-dim）的差异目检认可（§8.1 B-3 定死：保深色档零 diff 主闸优先）；:291 废止注同步改 |
| O6② 死类处置（前提=两查看器恒深→死类落显式深色值） | spec v1.9 O6② + b3-alldead-list.json | **前提废止改判**：Image/VideoFullscreenViewer 改跟随 → 死类（text-popover-foreground 10 处、text-muted-foreground 8 处、focus-visible:ring-ring 4 处等 v4/shadcn 词汇）**删除**而非落深值（防与新命名撞名集体复活并施加颜色）；b3-alldead-list.json 与 B3 收口口径重开 |
| PAGE_REGISTRY_FILES 涌现登记 | css-baseline-diff.mjs:56-63 | 扩面同步义务：D3 新涌现边框位点（border-width 0→N）**两处同步**（emergence-adjudication-A4.json 授权集或 EXTRA_AUTHORIZED_FILES 附理由 + PAGE_REGISTRY_FILES 对应页数组），缺一闸门 exit 1；NodePalette/CanvasToolbar 等预期新位点预登记 |
| router.tsx:48-50 注释（画布壳跟随、画板恒黑已钉） | router.tsx | 订正（板跟随主题） |

## 4. 术语与四通道分类法

B2 三通道扩展为四通道（第四条为通道语义，非迁移目标）：

1. **token 通道**：硬编码色 → `--fw-*` 语义 token（多数）。
2. **品牌/内容字面通道**：两主题一致的恒定视觉。**准入条件=逐点验底**：仅当消费点恒落深底（内容承载面/恒深区）才允许双主题同值；落跟随域浅底必须 token 双值（先例 --fw-accent→--fw-accent-text 前景档加深）。实测：#6C5CE7 白底 4.79:1 ✅（且 P9 提亮）；**#5DDCFF 白底 1.60:1 ❌、#4ade80 白底 1.74:1 ❌**（深底强调色）——#5DDCFF 消费点 KeyboardShortcutsPanel/AiToolActionPopup/ImageExtConfigPanel 本期跟随主题，浅档逐点裁定（双值变体 token 或迁恒深面）进 registry。用户自设色（P6 清单）同通道。
3. **双主题中性字面通道**：scrim/阴影/棋盘格/hydrate 遮罩（`bg-black/50` page.tsx:313、`bg-black/60` BaseFullscreenModal.tsx:70）、灰系中性微调色（`hover:bg-zinc-100`、`bg-black/[.06]`、CreditsDropdown 邀请卡族）——两主题下都正确，**明文禁止 token 化**（含 P5 浅色重做时保留）。
4. **内容承载面通道**：媒体画面垫底/clip 块面/独立画面视口垫底——值域恒深深值（非岛、非 token），消费点直改局部定值；**内容叠加层**（压在画面上的深 scrim+白字浮层，P3②）亦归本通道恒定。

## 5. 范围口径（脚本产出清单，验收按键核销）

手写数字一律不作验收依据（历史计数 76/79/8/7 等全部作废）。D3 开工前由 O6 式脚本产出 `e2e/audit/canvas-migration-registry.json`（镜像 b2-migration-registry.json 结构，含排除集与逐键裁定列），口径：

- **画布域**：`pages/canvas/**` 排除 `video-editor/**`、排除渲染产物白名单（§1 非目标逐文件）；域外画布可达面（MaterialLibrary/History/BaseFullscreenModal）一并入册；
- **ve 域**：`pages/canvas/video-editor/**`（97 文件=53 源+44 测试）——源文件仅 8 个带色字面（--ve-* token 化红利）；
- **videos 域**：`pages/videos/**` 7 源文件全含色字面（含 text-white 等 utility 命中，非仅 hex）；
- **域外单件**：WeChatFollowModal（components/layout/）、CreditsDropdown（pages/canvas/components/ 内，设计稿级特例单列 §11.2 专项）；
- **手写 CSS 块**：index.css `.tiptap-content` 10 处 + `.editor-scroll` 3 处 + `body{background:#141414; color:#e2e8f0}` **两条声明**（→var(--fw-bg)/var(--fw-text)，深档字节等值）、`components/nodes/prompt-input/PromptInput.css` 28 处、`NodeHandle.css` 1 处；
- **测试分区**：清单脚本增 `*.test.tsx` 独立分区（精确值断言/className 断言两列）——canvas+videos 实测已 ≥24 条颜色断言（CanvasToolbar.test ×7 rgb(38,38,38) 族、CanvasView.test:183 MiniMap rgb(50,50,50)、VideoTrimTimeline.test:76/103、VideoHDPanel.test:73、TextInputNode.test:197/206、TextNodeToolbar.test:171/180、TextConfigPanel.test:119、StoryboardGroupRenderer.test:92/101、ProcessSnapshot.test:96 等），§12.2 反转清单以脚本产出为准；
- **配置**：tailwind.config.ts **不需要** colors 映射（§8.1 走任意值 var 形式；勿加键——徒增 baseline 键与断言面）；eslint no-theme-utility 白名单（§11.3）。

## 6. D0-0 仪器先行（新增段，零产品改动）

「深色档零 diff」现有仪器不可判：a0 采集器冻结集**无 backgroundColor、color 仅表单控件**（a0-collect-baseline.spec.ts:105-137）；b1 探针仅 /works 4 + /canvas 2（都在 CanvasTopBar，画板子树 0 条）；videos/ve 域 0 条（b1 文件头 :15-17 明示）。

**动作**（交付物三件——只采集不判定=仪器仍不判）：
1. **采集器扩展**：a0 全元素冻结 `backgroundColor` + `color`（color 不再限于 FORM_CONTROL）。
2. **differ 侧同步扩展**：css-baseline-diff.mjs 属性层显式纳入 backgroundColor+color 并进意外项闸；属性集版本号 `attrSetVersion` 随基线一起冻结，**两侧属性集不一致判失败而非忽略**；颜色序列化统一 rgb() 归一化（对齐既有 BRIDGE_DARK 口径，防 hex/rgb 混比）；before-D **自比自跑一次定 0 噪声基线**（全元素继承色噪声先测预算，否则 D1a"深档 0 diff"被噪声淹没）。
3. **D 段探针族**（b1 同构，先钉当前深值）：画板 wrapper 底/dot 色、节点卡底、CanvasTopBar 药丸内前景、videos 卡面/播放壳面、ve 壳底/面板/轨道面/预览垫底、WeChatFollowModal 面与前景。
4. before-D 在改动前 HEAD 采（8 页）——唯一时间窗，错过不可补；与 fixture（gate-canvas-1/gate-node-1/A0-0 样例视频）同 PR 锁定。
5. 论据登记：clsHash/clsLen 不参与闸门（differ 只比几何与属性）→ D3 类名 token 替换不误伤配对闸，此即"baseline 不重采"的机制论据。

**验收**：D0-0 自身零产品改动、before-D 入档、探针全绿（钉深值）、自比自跑 0 意外。

## 7. D0 themeStore 两态化

**六件套**（原四件套 + App.tsx + CanvasTopBar）：

1. `themeStore.ts`：`ThemeMode = 'light' | 'dark'`；state 收敛单值 `mode`（`resolved` 概念随 system 档消亡）；删 `MEDIA_QUERY`/`resolveSystem`/`onMediaChange`/matchMedia addEventListener；`readStoredMode` 合法值收敛两态，`'system'` 走非法回落 dark（P8：不回写）；`initThemeSync` 懒初始化保留。
2. `App.tsx:10`：`const { resolved }` → `const { mode }`，algorithm 由 mode 派生。**DOM 类 / antd algorithm / ReactFlow colorMode 三处必须同源由 mode 推导**。
3. `index.html:9-20` 防闪白脚本：删 matchMedia 分支，两态口径与 readStoredMode 同构。
4. `TopActionBar.tsx:16-20`：THEME_CYCLE 三态 Record → 两态；与 CanvasTopBar 新钮**抽共享 ThemeToggleButton**（共享 label/aria 常量，G7 按 aria-label 锚定，防两处漂移）。
5. `CanvasTopBar.tsx`：新增主题切换钮（共享组件）。
6. 测试：`themeStore.test.ts` system 相关断言散布几乎全部用例（:67/:75/:83/:94-105/:122-132/:147-152/:155-160），预计文件大面积重写（非"约 7 处"）；**matchMediaMock.ts 保留改写，不删**——⚠ v1.0 曾误判"孤儿文件"，实况：themeStore.test.ts:8 `import { installMatchMediaMock }`、:21/:27 安装、`media.*` 11 处；两态化后剩余用例（无存储默认深/显式 light/显式 dark）仍需 `media.set(反向值)` 钉「结果与 OS 偏好无关」——这是 vitest 层唯一手段（e2e G3 之外）。

**c0 e2e 同步**（G 编号见 §11 全景）：G1 删 2 条 system 例；G2 静态判别式（:183 `/theme/&&/localStorage/&&/matchMedia/`）换为「含 theme/localStorage、**不含** matchMedia」（顺带成为"无 system 档"的机械断言）；G3 system live flip（:208-226）改写为「OS 偏好零影响 + matchMedia 调用计数 0」；G7 三态循环（:398-443）改两态往返。

**验收**：两态 DOM 类断言；`'system'` 存储 → mode=dark；`(prefers-color-scheme: light)` query 的 matchMedia **调用数 0 且无 change 订阅**（addInitScript wrap+计数按 query 过滤——matchMedia 亦被 antd responsiveObserver 等用于响应式，不过滤会被无关调用误红）；D 段探针与 before-D 零 diff（此段无视觉变更）。

## 8. D1a 定义层双值化（零消费点改动，深色档天然零 diff）

铁律：**D1a 只搬定义不改消费点；重构与有意视觉变更不得同 commit**（differ 信号保全）。

### 8.1 域 token 原地双值化

`--canvas-controls-*`/`--canvas-handle-*`/`--edge-*`/`--vw-card-*`/`--ve-*` 从裸 `:root` 块搬进 `:root,.dark` + `.light` 两块（遵守 D8 源序，纳入 B1 断言族）；几何 px token（`--vw-close-reserve` 等）留 `:root` 不动。

| 键 | 深值（冻结） | 浅值（先定后动——即 D1b 并域目标键浅值，D1a 验收对象） | 备注 |
|---|---|---|---|
| `--canvas-board-bg`（新增） | `#000000` | `#F5F5F5` | P2；域名前缀（--fw-=语义层纪律，不占用）；消费形式 `bg-[var(--canvas-board-bg)]` 任意值 var（斜杠禁令不涉）；**不需要 tailwind colors 映射** |
| `--canvas-board-dot`（新增） | `#555555` | `#C8C8C8`（≈1.55:1@板底，P2 目检认可） | P2；`<Background color="var(--canvas-board-dot)">`（xyflow 写内联 `--xy-background-pattern-color-props`，CSS var 代换——D2 像素 diff 实证） |
| `--canvas-controls-bg` | `rgb(38,38,38)` | `#f0f1f2`（=--fw-surface-dim 浅值，D1b 直接并） | |
| `--canvas-controls-border` | `rgb(54,54,54)` | `#e5e7eb`（=--fw-border 浅值） | |
| `--canvas-controls-text` | `rgb(247,247,247)` | `#111827`（=--fw-text-strong 浅值，直接并） | |
| `--canvas-controls-hover` | `rgba(255,255,255,.08)` | `rgba(0,0,0,0.06)`（=--fw-overlay-2 浅值） | |
| `--canvas-controls-active` | — | — | **死 token（0 消费）直接删** |
| `--canvas-handle-bg` | `#9CA3AF` | **浅档重校**（白卡 2.54:1 < 非文本 3:1，加深或加描边） | 四键协同：NodeHandle.tsx:22/:28 消费 bg/icon |
| `--canvas-handle-icon` | `#6B7280` | **浅档重校**（同上） | |
| `--canvas-handle-hover-bg` | `#FFFFFF` | **反向深色系**（白卡上消失） | NodeHandle.css 消费 hover 两键 |
| `--canvas-handle-hover-icon` | `#FFFFFF` | **反向深色系** | |
| `--edge-flow-color` | `#3B82F6` | `#3B82F6` | 双主题同值（ConnectionLine.tsx:97 在用） |
| `--edge-highlight-color` | `#999` | 浅档重校（浅底偏淡） | |
| `--canvas-shadow-menu/dropdown` | 现值 | 浅档重校（黑阴影浅底外观全变） | neverMerge 重裁定，登记 |
| `--z-panel` | `400` | — | **维持永不并入**（z-index 非颜色，与主题无关） |
| `--ve-bg/--ve-panel/--ve-border/--ve-text` | 现值 | `--fw-bg/--fw-surface-dim/--fw-border/--fw-text` 浅值 | **B-3 定死**：--ve-panel 浅值=#f0f1f2（surface-dim，**非** video-editor.md:289 原始稿"面板白"）——保深色档零 diff 主闸优先，与原始稿差异目检认可登记 |
| `--ve-text-dim` | `rgba(226,232,240,.6)` | `#4b5563`（=--fw-text-dim-3 浅值） | 深值色相独立保留（22 处消费，D1b 裁定收敛或独立键） |
| `--ve-accent` | `#6C5CE7`→`#8B7CF6`（P9 有意变更，唯一破"深值冻结"的键） | `#8B7CF6` | **P9 全档提亮**（深底 ≈6:1/白底 ≈3.1:1），品牌紫域主保留，禁并入 --fw-accent，登记 differExpectedPairs |
| `--ve-text-control` | — | — | **死 token（0 消费）直接删**（--ve-panel:99/:100/:103 三条 var 间接链随 D1b 删除） |
| `--vw-card-bg/--vw-card-border(-hover)` | 现值 | `#ffffff` / `rgba(0,0,0,0.06)` / `rgba(0,0,0,0.12)`（=--fw-surface/overlay-2/overlay-3 浅值，前两键直接并） | 卡面是 chrome（缩略图区才是内容承载，由缩略图自担） |

**块结构纪律**：index.css 只允许存在**一对**主题块（全部 `:root,.dark` 深值集中一块；全部 `.light` 浅值集中**单块**、置于全文件最后一个深块之后）——所有域 token 双值写入同一对块，禁多块交错（任一 .light 块源序在前即该域浅色恒输，且仅浅色档可察、深色档全绿静默）。
**断言归口**（B1 只锁源序不锁值，勿混淆）：源序结构断言归 **b1** 扩展（遍历 document.styleSheets 所有含 `--canvas-|--ve-|--vw-` 的规则，断言 .light 规则 index > 同键深值规则）；**值断言归 b0**（b0-token-blocks.spec.ts DARK/LIGHT 映射表 :26-63 仅含 16 个 --fw-*，域 token 双值必须加入该表或新增同构组，否则浅色档域 token 值无机械守卫）。B1-1 定位谓词只取第一个带 --fw-bg 的块对——新增第二对块不被守卫覆盖，故"只允许一对块"是硬约束。

### 8.2 ve 域共享 token 拆分（媒体/chrome 二分的前提）

`--ve-panel`/`--ve-bg`/`--ve-border` 现同时承担 chrome 与时间轴/预览媒体语义（EditorTopBar:21、AssetPanel:55、PropertiesPanel:74,81 ↔ TrackRow:33,53、TimelineRuler:47,55、TimelinePanel:292,307、PreviewPlayer:64,79、AssetPanel:111,144,184）。术语收紧：**clip 块面恒深（内容）；轨道行底/标尺跟随（chrome）**。

- `--ve-track-video: #1f1f1f` = clip 块面（内容承载）→ **单值恒深保留**（不进双块；浅色下深色轨道块=有意视觉，登记 §13）。
- 拆分裁定**定死无悬念**：标尺刻度=chrome 跟随；缩略图占位框=内容承载恒深；预览垫底=内容承载恒深——三条进 registry 裁定列。
- D1a 产出拆分表：chrome 侧消费点留双值化 token；媒体侧拆独立恒值 token 或局部字面；约 10 处消费点调整（TrackRow×2、TimelineRuler×2、TimelinePanel×2、PreviewPlayer×1、AssetPanel×3）。ClipBlock.tsx:28 波形 rgba(255,255,255,.7) 落 clip 内 → 恒深成立不动。

### 8.3 手写 CSS 块

`.tiptap-content` 10 处、`.editor-scroll` 3 处、`body{background:#141414; color:#e2e8f0}` 两条声明（→`var(--fw-bg)`/`var(--fw-text)`，深档字节等值）、PromptInput.css 28 处、NodeHandle.css 1 处——全部双值化（消费者是画布文本节点/prompt-input，浅色下文字不可读是本期要修的洞）。

**D1a 验收**：深色档 0 diff（仪器 = before-D + D 段探针）；浅色档新增值可读（AA 对比度表，@#FFFFFF 卡面与 @#F5F5F5 板面双底实测，延续 B0"每 token 附对比度记录"惯例；含 --ve-accent P9 提亮后 #8B7CF6 深底 ≈6:1 / 白底 ≈3.1:1（非文本 3:1 达标），原 #6C5CE7 深底 3.84:1 的欠账由 P9 顺手修复）。

## 9. D1b 并域层（机械步，有意变更单独登记）

### 9.1 值冲突表逐键裁定

| 域 token（现深值） | 最近 --fw-* | 等值 | 引用量 | 处置 |
|---|---|---|---|---|
| `--vw-card-bg: #1e1e1e` | `--fw-surface: #1e1e1e` | ✅ | 1 | 直接并 |
| `--vw-card-border: white .10` | `--fw-overlay-2` | ✅ | 1 | 直接并 |
| `--canvas-controls-bg: rgb(38,38,38)=#262626` | `--fw-surface-dim` | ✅ | 14+ | 直接并 |
| `--canvas-controls-text: rgb(247,247,247)` | `--fw-text-strong` | ✅ | 7+ | 直接并 |
| `--ve-border`/`--canvas-controls-border: #363636` | `--fw-border: #333` | ❌Δ3 | 25+5 | 收敛并登记 differExpectedPairs，或保留独立键 |
| `--canvas-controls-hover: .08` | `--fw-overlay-2: .10` | ❌ | 4 | 同上 |
| `--ve-text-dim: rgba(226,232,240,.6)` | `--fw-text-dim-3: rgba(255,255,255,.6)` | ❌色相 | 22 | 独立键或登记收敛 |
| `--vw-card-border-hover: .25` | `--fw-overlay-3: .20` | ❌ | 1 | 同上 |
| `--ve-track-video: #1f1f1f` | 无 | — | 2 | 独立恒深键（内容承载；浅色下深色轨道块=有意视觉，登记 §13） |

不等值键逐键裁定进 `b2-migration-registry.json` 的 differExpectedPairs；**同一提交不得既重构又改视觉**。

### 9.2 AssetPanel 与 WeChatFollowModal

- AssetPanel.tsx:110/143/183 `hover:bg-[var(--canvas-controls-hover)]` → 随 D1b 并域改指 `--fw-overlay-2`（ve 域已改跟随，浅色档取浅 hover 是正确行为）。
- 删 index.css:99/:100/:103 三条 var 间接链——理由是**每键单主 + 并域后主键变更**（`--canvas-controls-bg` 直接并入 `--fw-surface-dim` 后链目标消失），D1a 双块直写、D1b 消费点直改。（原"岛污染"前提随 ve 改跟随消失，不再成立。）
- WeChatFollowModal 改跟随：删自身 ConfigProvider darkAlgorithm + rootClassName="dark"（:15,21），继承 App 算法与 html 类；**与其断言反转（G8①）同 commit 原子执行**。

**D1b 验收**：differ exit 0；lint 双规则绿；`video-editor/**` 内 `var(--canvas-` grep 0 命中（每键单主域纪律：--canvas-controls-* 是画布工具条唯一主，ve 域用 --fw-*/--ve-*）；WeChatFollowModal html.light 下取浅值。

## 10. D2 colorMode 翻转

1. CanvasView.tsx:379 `colorMode="dark"` → `colorMode={mode}`；板面三机制协同——:377 `bg-[#000000]` → `bg-[var(--canvas-board-bg)]`（**必须留在 Tailwind utility 层**：产物 CSS 实证 .react-flow 字节 0 < .bg-[#...] 字节 50943，同特异性源序 utility 胜；移 inline/删则 dark 皮肤 `--xy-background-color-default:#141414` 复现）、:382 `bgColor="transparent"` 保留。
2. **对账工装**：同 seed 同 build 像素 diff（c7 §2#8 先例 0/1,024,000），两主题态各跑；重点复测 `--xy-minimap-*`/`--xy-controls-button-*`。index.css:212-216 A2 selection 钉值：**先临时撤钉对比**——差异为零则删除钉值（钉值失效+门禁恢复有效），非零则画板根（CanvasView.tsx:341 wrapper 父层）局部钉 `--xy-*`；禁全局 !important。
3. **wrapper 镜像断言**（新增不变式）：`.react-flow` 运行时类必须恰等于 html 主题类（xyflow colorMode 挂 light/dark 字面类，与我们 token 块选择器同名——靠"恰好一致"侥幸无害，写成常量即静默生成 --fw-* 岛）。
4. CanvasView.test.tsx:90-100 改写：`not.toContain('light')` 在 colorMode={mode} 下成恒真废测 → 改镜像断言；:90 注释（A2 溯源）同步改写为新裁定。
5. MiniMap 内联 JS 色（:384-394 rgb(50,50,50)/rgb(70,70,70)/nodeColor rgb(160,160,160)）进 D3 清单双值化；maskColor rgba(0,0,0,.35) 中性遮罩留。
6. **初始化顺序不变式**：main.tsx:9 `initThemeSync()` 先于 `createRoot().render()`（:23）——store 初始化先于 React 渲染是 colorMode={mode} 首帧正确的前提，加注释保护（调换顺序则 /canvas 首帧主题闪一次，恰是 P1 要消除的）。
7. ProcessSnapshot.tsx:89 `colorMode="dark"` 属内容域（过程快照=画面视口），随域迁移改镜像断言口径（同 CanvasView）。

**验收**：深色档像素 diff = 0；--xy-* 复测表逐属性登记；镜像断言绿。

## 11. D3 全量迁移（按域原子对：翻实现+翻断言同 commit）

### 11.1 执行规范

- **原子对**：每域/每岛拆除与断言反转同 commit；D4 只留岛消亡后的新回归 + 全门禁（段间独立验收，spec v1.9 :125 规矩）。
- **baseline 重键不重采**：no-color-hex 键 = `ruleId|路径|sha256(TrimEnd(行文本))`，迁移换键后**同文件 hex 键计数不增**（lint-gate.mjs:139 口径"允许伴随重键"）；白名单文件键保留。**禁 UPDATE_BASELINE=1 重采**（B5 控制动静）。
- **两条门禁机制分开写验收**：hex 门禁 = "键数不增（允许行文本重键）"；no-theme-utility 门禁 = "白名单净减 3 条目录 + 净增 K 条精确文件"（该规则零基线，任何命中即违例，重采不豁免——lint-gate.mjs:120）。
- **no-theme-utility 扩规则（D3 开工前置，门禁漏洞修补）**：现状正则只拦 `text-(white|black)`——bg/border/ring/divide 白系实测 86 处**无任何规则覆盖**（bg-white/10、border-white/20 改不改都绿=漏放行；VideoEditNode.tsx:151 裸 bg-white 是 P4 主承重点，现有两条规则都看不见）。扩为 `(text|bg|border|ring|divide|fill|stroke|from|via|to)-(white|black)`，白名单机制不变；扩后 D3 开工前先红 86 处=working list 与完成判据；registry whitelistKeeps 镜像同步。
- **节点组件禁 useTheme**：节点/卡/面板组件一律消费 CSS 变量（主题切换=零 React 工作；useTheme 会让全部画布节点重渲染，React Flow 下最贵）；唯一例外 CanvasView 的 colorMode={mode}。验收 grep：`pages/canvas/components/{nodes,groups}/**` 内 useTheme 命中 0；D4 性能实测补大画布（≥50 节点）切换耗时/掉帧读数。
- **涌现登记两处同步**：D3 引入新可见边框（border-width 0→N）时，emergence-adjudication-A4.json 授权集（或 EXTRA_AUTHORIZED_FILES 附理由）+ PAGE_REGISTRY_FILES 对应页数组，缺一闸门 exit 1（§3 E 表）。
- **媒体容器自持底色 checklist**（机械检查项，非目检，P6 判据落地）：grep 卡内 `<img|<video>` 祖先链，每个媒体容器自持深底（透明 PNG/未加载图/poster 未到时不得露浅底）；文本/标注类内容容器则整体跟随（P6 判据"不会被完全覆盖"分支）。
- **浅底重校清单**：OutpaintSelectionOverlay `bg-white/30` 网格线（落媒体上→第四通道保留字面）；透明 PNG 棋盘格/涂抹蒙版/裁剪遮罩逐个裁定"贴媒体 or 贴卡壳"；NodePalette（#0f0f0f/#e0e0e0/#f7f7f7）、ProjectTitle（#1A1A1A）——后两者在 PAGE_REGISTRY_FILES（css-baseline-diff.mjs:56-60），改动同步那张映射表。

### 11.2 专项裁定

| 专项 | 处理 |
|---|---|
| VideoEditNode | P4：跟随主题变深卡（bg-surface/text-text 等 token 化）；有意变更进 differExpectedPairs + 目检；:129 mini 播放器 JS 通道色（复用 canvas-renderer #000/#FFF）登记 c3 census 不可迁移 |
| CreditsDropdown | P5：浅色重做（ui-ux-pro-max 出浅色稿，D3 开工前交稿）；深色档现状冻结；深色渐变基底/glow（:127/:271）与 52 处字面随稿替换；邀请卡族中性色保留（通道 3）；药丸宿主（CanvasTopBar :147）同步 chrome 化结案 P7 反例① |
| 播放壳（P3） | **前置 DOM 拆分**：画面垫底元素从壳根独立（媒体容器自持固定深底，P6 判据）——现状 letterbox 与 chrome 共用 VideoPlayerModal.tsx:58 同一壳根，不拆则两条裁定落同一 class；拆出后壳根/画面外 chrome（外框/关闭钮/轮播条）token 化跟随，**压画面浮层保持深 scrim+白字恒定**（第四通道）；删 dark 类与 [color-scheme:dark]；PlayView/ProcessView/ProcessSnapshot/VideoCard/CarouselBar 随域迁移；VideoPlayerModal.test.tsx:168-173 断言同步 |
| 画布全屏查看器 | ImageFullscreenViewer/VideoFullscreenViewer 跟随（P3 承诺③），与播放壳同 commit 原子对；**O6② 死类删除**（§3 E 表，非落深值） |
| AnnotationToolbar | **P7 第二反例专项**：五件一起翻（BAR_BG 深底/:332 恒白保存钮/:230/:254 白系选中环与分隔线/:135/:170 白系 hover）——浅色下"白上加白"糊一片，按 P7 原子检查 |
| Lighting/Angle3D 面板 | **非目标收窄为渲染产物层逐文件**（§1 更新）：engine/LightingEngine.ts、engine/Angle3DEngine.ts、Lighting/ThreePreview.tsx、Angle3D/Angle3DPreview.tsx、video-editor/renderer/canvas-renderer.ts(+export worker)；同目录 LightingModal/ControlPanel/ViewToggle/LightPresetButtons/Lighting 的 PromptInput、Angle3DModal/ControlPanel/AnglePresetButtons 是普通 chrome（canvas/page.tsx:304-305 直挂画布页）→ **本期迁移**，不留"全量跟随"例外 |
| WeChatFollowModal | D1b 已列；html 类直承 |
| 顶栏药丸 | CanvasTopBar 三药丸 chrome 化（bg-[#1A1A1A]/90 → surface 系）；P7 原子性检查（前景/边框同步） |

### 11.3 白名单手术

- no-theme-utility.js:34-41/:50 删 3 条目录白名单：`src/pages/videos/**`、`src/pages/canvas/video-editor/**`、`canvas/components/{nodes,edges,groups}/**`。
- 媒体面/内容面保留的 `text-white`（叠画面控件、clip 内波形等）落**精确文件白名单**（照抄 b6 text-black 8 文件精确集先例）；同步 b2-migration-registry.json whitelistKeeps 镜像（no-theme-utility.js:8-10 要求）。

**验收**：registry 分区逐域核销（html.light 取浅值 + 内容面取深值 + lint/differ 绿）；hex 键数不增；白名单净减 3 目录/净增 K 精确文件；媒体容器 checklist 全过；浅色 B6 真实对照 + light-eyeball 目检（复用 b6-acceptance 流程）。

## 12. D4 收口与全域反转清单

### 12.1 断言矩阵（新）

1. **跟随矩阵**：html.light 下 ve 壳/videos 壳/WeChatFollowModal/画布全屏查看器/画板/节点卡 chrome 取浅值；
2. **残余真岛对照**：LoginModal 浅岛（登录域）、admin 深岛——岛机制断言保留不退化；
3. **内容承载面恒深**：html.light 下媒体垫底/clip 面/预览垫底取深值。

G8① antd 通道探针（:522 关闭钮色 >180 = darkAlgorithm）反向后**改判据**（<180 = defaultAlgorithm），非只改数字。

### 12.2 全域反转清单（不列全就会红）

| 类别 | 位置 | 动作 |
|---|---|---|
| e2e | c0 G1 system 2 例（:105-106） | 删 |
| e2e | c0 G2 判别式（:183,:185） | 换（去 matchMedia） |
| e2e | c0 G3（:208-226） | 改 OS 零影响 + matchMedia 计数 0 |
| e2e | c0 G4 ve 壳（:278-315） | 反转载浅值 |
| e2e | c0 G7 三态（:398-443）+ /videos 叙事（:379,:445） | 两态化；videos 叙事改跟随；**钮存在性断言扩三页** /works、/videos、/canvas（新钮落地验证） |
| e2e | c0 G8①②③（:507-579） | ①②反转；③双岛论断消亡重写 |
| e2e | a0 探针 ×4（:200,:220,:221,:250） | 3 条反转（videos #262626、画板 wrapper、ve 壳 rgb(20,20,20)）；canvas html 根 #f7f8fa 保持 |
| e2e | a0 叙事注释（:15-18,:303,:305） | 重写 |
| 单测 | CanvasView.test.tsx:90-100 | 镜像断言 |
| 单测 | canvas+videos 域颜色断言 ≥24 条（以 registry 测试分区脚本产出为准；实测：CanvasToolbar.test ×7 rgb(38,38,38) 族、CanvasView.test:183 MiniMap、VideoTrimTimeline.test:76/103、VideoHDPanel.test:73、TextInputNode.test:197/206、TextNodeToolbar.test:171/180、TextConfigPanel.test:119、StoryboardGroupRenderer.test:92/101（改双主题可见性断言）、ProcessSnapshot.test:96、VideoPlayerModal.test:168-173、PlayView.test:193-225、ProcessView.test:50-61、CarouselBar.test:79-80） | 随实现逐条改（D3 各域原子对内同步） |
| 单测 | ve TimelinePanel.render.test:115-131 | **不动**（clip 类型色属内容语义） |
| 登记档 | c7-accepted-items §1 #1/2/3/7、§3 归因、§2#8 | E 表所列 |
| 登记档 | c5-portal-census / c3-js-channel-census / domain-token-adjudication-B0 / b2-migration-registry / b6-acceptance:61,:71,:74 | E 表所列 + 补登 |
| spec | video-editor.md:289/:291 | 复活/改注 |
| 注释 | router.tsx:48-50、CanvasView.tsx:378、index.css:210-211、tailwind.config.ts:9-10 | 订正 |

### 12.3 D4 全门禁

C0（改造后新形态全绿）、vitest 全绿、lint 双规则、css-audit 斜杠/differ exit 0、D8 电池、浅色 B6 真实对照（画布+ve+videos+弹层全景）、性能观感实测一次（低端机切换闪烁，双通道非原子面积变大——spec v1.9 :202 已知项扩面登记）。

## 13. 已知接受项与风险登记

1. `'system'` 残留用户一次性回落深色（P8，开发期无用户数据影响为零）。
2. antd cssinjs 晚一帧的切换瞬时不一致面积变大（ve/videos/canvas 三域同帧重渲染）——D4 实测留档（含大画布 ≥50 节点切换耗时/掉帧读数）。
3. **过渡中间态**（纪律登记）：D2 之后～D3 板面批次完成前，浅色档画布不可用（板已浅、字面仍深的混排）；D1a 之后～D3 之前，板内 3 个 `--canvas-controls-*` 消费点（VideoHDPanel:93/VideoNodeToolbar:99/VideoTrimPanel:126）浅色档取浅值落黑板——深色档零 diff 恒成立，纪律要求 **D2 与 D3 板面批次连续收口**（或把 colorMode 翻转并入 D3 板面批次首个 commit），禁止在中间态用浅色档验收画布。
4. --ve-track-video：浅色编辑器中 clip 轨道块保持深色=有意设计（与浅面板形成媒体区对比；clip 块通常有缩略铺满，未就绪/纯音频轨露深底）——B6 目检勿判缺陷。
5. 浅色档网格点对比度 ≈1.55:1 天然低于深档 ≈2.96:1（P2，目检认可）。
6. VideoEditNode 深色档白→深、CreditsDropdown 浅色重做、--ve-accent 全档提亮 #8B7CF6（P9）、#363636→#333 等 Δ3 级收敛——全部登记 differExpectedPairs，属有意变更非回归。

## 14. 后端零改动声明

apps/api/src 下主题相关**代码标识符**（token/algorithm/theme 字段、表列、接口参数）零命中（grep darkAlgorithm/#141414 等的**文案与注释命中不计**——如 WeChatFollowModal 文案"关注公众号"类）；后端不产出 HTML（无 res.render/模板）；主题仅存 localStorage，无用户偏好表/接口——无迁移、无兼容窗口、无缓存失效面。fixture 改动（浅色对照补种）与 before-D 基线同 PR 锁定。

## 15. 执行顺序与段验收汇总

D0-0（仪器/before-D/探针钉深）→ D0（两态六件套+G 门禁改写，零视觉变更）→ D1a（定义层双值化+ve 拆分+手写 CSS，深档 0 diff）→ D1b（并域冲突表+AssetPanel/WeChatFollowModal 原子对+白名单手术）→ D2（colorMode 翻转+板面三机制对账+镜像断言）→ D3（registry 清单逐域原子对迁移，含四个专项）→ D4（断言矩阵新形态+全域反转清单核销+全门禁）。

**D1 必须先于 D2**：wrapper 的 .dark 类是 D1 期间画板子树的实际值域（先翻 colorMode 则画板在 D1 未完成时取浅值立刻坏）。
