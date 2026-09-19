# 画布域主题跟随设计（C8）spec v1.5（定稿冻结）

- 日期：2026-09-20（v1.1-v1.4 六轮收口；v1.5 第七轮收尾定稿——§9.2 等值键并域+单次登记规则、§10.3 守卫过滤表达式可执行化、§10 像素 diff 参照系、SVG 呈现属性通则、GridIcon 字面恒定、P10 叶子模块、自检向量、D0-0 四步排序。**本版起冻结：后续改动走变更登记，不再逐轮全审；实施期分歧以 registry 产出与 contrast-table.mjs 实测为准**）
- 状态：定稿（待用户最终确认后进 plan）
- 关联：`2026-09-18-css-base-layer-theme-design.md`（v1.9，本 spec 是其画布域解封续篇）、c5-portal-census.json、c7-accepted-items.md、b6-acceptance.md、domain-token-adjudication-B0.json、b2-migration-registry.json
- 需求来源：用户提出「Canvas 画布页面的节点卡、悬浮工具条、底部面板、画布颜色等元素跟随主题（浅色下变浅）；主题只分浅色/深色两档，无跟随系统，默认深色」；六轮架构审核修订 + 用户 10 项产品裁定（P1-P10）。

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
| P2 | 板底/点色 | 浅色板底 `#F5F5F5`、网格点 `#C8C8C8`；深色维持 `#000000`/`#555555`。对比度定版（WCAG 2.x relative luminance，(L1+.05)/(L2+.05)，全文同公式同口径，前版 2.96/1.55 系口径混用作废）：深档点 #555555@#000000 = **2.82:1**；#DCDCDC@#F5F5F5 = 1.26:1（过淡弃用）；#C8C8C8@#F5F5F5 = **1.53:1**——浅档网格点天然低于深档（约 54%），目检认可登记 §13，勿后续当缺陷 |
| P3 | 播放壳跟随 | VideoPlayerModal/PlayView 翻浅（不采用"媒体查看器恒深"备选）。承诺收窄定死：① 删 `[color-scheme:dark]`（含 VideoPlayerModal.test.tsx:168-173 断言）② **画面外**壳 chrome（Modal 外框/关闭钮/轮播条/页面级按钮）双值化；**压在画面上的浮层保持深 scrim+白字恒定**（PlayView:69/:83 from-black、text-white/90、bg-black/70 时长条——行业惯例 YouTube/B 站浅色模式同构，浅 scrim 遇亮画面不可读），归第四通道"内容叠加层" ③ 画布内 ImageFullscreenViewer/VideoFullscreenViewer 一并跟随（杜绝同类两制）。**DOM 拆分前置**：画面垫底元素必须从壳根拆出独立（媒体容器自持固定深底，P6 判据）——现状 letterbox 与 chrome 共用同一壳根（VideoPlayerModal.tsx:58）物理上无法两全，不拆则 P3/P6 落到同一 class 只能二选一 |
| P4 | VideoEditNode | 跟随主题：深色档从白卡变深卡。有意视觉变更，登记 differExpectedPairs + B6 目检；浅色档与其他节点卡一致 |
| P5 | CreditsDropdown | 浅色重做（出浅色稿，实现期用 ui-ux-pro-max；**浅色稿 D3 开工前产出**——它在 CanvasTopBar 关键路径上）。现状精确描述：基底=inline 深色渐变（:127 linear-gradient 160deg #111111/#171717/#101828）+ :271 bg-zinc-900 图标底，浅色稿重做这两处；:267 邀请卡 bg-white + hover:bg-zinc-100 与 bg-black/[.06] 族灰系中性色**保留不 token 化**（通道 3，永不过期）。深色档现状冻结（mode 分支而非全局替换，配深档字节等值像素守卫）；有意变更登记 differExpectedPairs |
| P6 | 内容承载裁定 | 通则：**用户内容自身的不透明像素不随主题；承载容器按判据二分**。判据（v1.2 措辞修正，消除"透明 PNG 恰不会完全覆盖"的字面反例）：**该容器的底色是否属于内容显示区——露出来也是内容的一部分**？是（媒体视口/卡内媒体容器：加载前/透明 PNG/letterbox 露出的垫底都是画面语义）→ 垫底恒深、卡壳/壳 chrome 跟随；否（底色是 UI 面/文字底板——TextInputNode 文本节点、便签类**内容容器**）→ **整体跟随主题**（浅色下变浅，否则直接违背"节点卡本身跟随主题"需求）。**EraseCanvas 涂抹蒙版裁定**（消除 P6/§11.1 双归类冲突）：蒙版可视化色叠在媒体上=内容叠加层 → **恒深**（第四通道）。恒深垫底仅限独立画面视口（全屏查看器/ve 预览区/clip 块面）与媒体容器垫底。**交互态色不是内容色**：selectionTokens、StoryboardGroupRenderer #333 组边框/#fffff0 分镜格、--xy-selection-* 属主题派生交互可视性 → 双主题值 + 两态可见性实测断言（防浅色下选中框消失）。真正的用户内容色：标注调色板 #FF0000/#FFD700/#0066FF（**含 #000000 黑笔：预设不随主题换组——用户在浅色主题下选黑笔=用户选择，显式登记**）、字幕字色、**userColor()**（RemoteCursors.tsx:30/:34、CanvasTopBar.tsx:135 协作光标/头像色，本期补登）→ 字面恒定 |
| P7 | 岛原子性通则 | 凡留深子树，面/前景/边框必须一起钉（.dark 类或全字面）；**禁止"面钉深、前景走 token"及反向混搭**。机械判据（v1.3 收窄，防误伤通道 4）：**同一视觉表面**（同一元素、或同一 stacking context 内的底色与其上的文字）不得混搭；**通道 4 内容叠加层与 P6 内容承载垫底显式豁免**（PlayView 叠画面深 scrim+白字、VideoCard bg-black/70 时长胶囊、ProcessSnapshot 等合法结构不受此判据约束）。现状两条真反例（仍被覆盖）：① 宿主药丸 CanvasTopBar.tsx:147 bg-[#1A1A1A]/90（面钉深）配 CreditsDropdown 触发钮 text-text（前景跟随）→ html.light 下 ≈1.1–1.2:1 不可读；② AnnotationToolbar 组件内五件混搭（BAR_BG 深底 + :332 恒白保存钮 + :230/:254 白系选中环/分隔线 + :135/:170 白系 hover）→ 浅色下"白上加白"（§11.2 专项） |
| P8 | system 残留 | localStorage 残留 `'system'` 仅读取侧映射为 dark，**不回写**（保持 boot 不写盘契约）；登记已知接受项（开发期无用户数据，影响为零）。配套：storage 与 html 类冲突时**storage 优先并回挂 html 类**（ensureInit 现状 :71-77 信任 html 类，单值化后反转——守防闪白脚本与 store 同口径，themeStore.test.ts:83-90 用例随改写非删） |
| P9 | --ve-accent 拆双档 | 消费点**15 处枚举定版**：8 处 12px 文字前景（AssetPanel:59"上传"、PreviewPlayer:101"添加字幕"/:106"生成音频"/:111"片段重拍"、PropertiesPanel:23 tab、TrackRow:38"➕"、TimelinePanel:297/:299"+ 视频/音频轨"）+ 1 填充钮（ExportModal:245 bg+text-white）+ 3 分隔柄 hover（VideoEditorShell:153/:155/:160）+ 3 播放头/吸附线（PlayheadLine:9、TimelineRuler:60、TimelinePanel:322）。现状欠账实测：#6C5CE7@#262626 = **3.11:1**。**裁定（照 --fw-accent→--fw-accent-text 先例拆档）**：`--ve-accent`（图形/填充档）**维持 #6C5CE7 双档同值不动**（零 diff；填充钮白字 4.86 ✅、浅档图形位 4.30@#f0f1f2 ≥3 ✅）；**新增 `--ve-accent-text`（文字前景档）**：深 **`#9B8CF7`**（@#262626 **5.40** ✅ 余量充足、@#141414 6.57 ✅）、浅 `#5F4FD1`（@#f0f1f2 5.27 ✅、@#f7f8fa 5.61 ✅）；8 处文字钮 D1b 改指 accent-text 并与 differExpectedPairs 逐点配对（消费点表 §11.4）。**整键随 D1b 落地**（§9.2，v1.4 从 §8.1 表移出——D1a 表内不出现该行，防实施者在 D1a 自造零消费死键）。全部对比度数字以 **contrast-table.mjs 台账脚本**出表为准（D0-0 交付，§6）——历轮人工复算同格分歧（3.11/3.72 等）以此终结 |
| P10 | TRACK_COLORS 统一 | **用户裁定（2026-09-20）：A=统一到 ve BLOCK_BAR 色表**。mini 卡三行深色档变色（image #6C5CE7→#5B7CFA、audio #95DE64→#8F5DBA、subtitle #FFD666→#5DBAA0）。v1.4 措辞修正：这是 **P4 级有意视觉变更**（深档改值），非"双主题恒定"的主题跟随——登记 differExpectedPairs + B6 目检；归属段=D3 画板批次 VideoEditNode 域原子对；两表**抽共享常量**同源防漂移（§11.4）。⚠ VideoEditNode 是本周期唯一同时命中 P4+P10+#E5E7EB 三项变更的元素，B6 目检单独看这张卡 |

## 3. 废止与反转登记（E 表）

| 原裁定/登记 | 位置 | 动作 |
|---|---|---|
| C2-6 colorMode 钉死 | CanvasView.tsx:379 + spec v1.9 :166 | **废止**，改 colorMode={mode}（D2） |
| 画板恒深值域 + 子树禁 token 工具类 | spec v1.9 :268 | **整条废止**（"禁 token 工具类"是恒深裁定的推论，裁定废止则推论同步废止；本期往画板子树大规模注入 token） |
| 画板域禁迁移（B2）+ spec :269 保留裁定（VideoHDPanel 8/VideoNodeToolbar 5/VideoTrimPanel 3=画板保留、AssetPanel 3=ve 保留） | spec v1.9 :269 | **废止反转**：全部转入迁移范围 |
| C5 三项恒深岛 | VideoEditorShell 壳根 .dark、VideoPlayerModal 壳根 .dark、WeChatFollowModal 恒深双通道 | **废止**：ve 壳/videos 壳/WeChatFollowModal 改跟随（各自与断言反转同 commit 原子执行） |
| 两个全屏查看器恒深 | spec v1.9 :149/:297 | **废止**，改跟随（P3 承诺③） |
| PromptInput.css/NodeHandle.css 画布域豁免 | spec v1.9 :151 | **反转**：纳入迁移（28+1 处） |
| B0 keepAsIs/indirectChain/neverMerge | domain-token-adjudication-B0.json | **整表重裁定**（前提"画板恒深域与岛内恒深域"消失）；neverMerge 中 --canvas-handle-*/--edge-*/--canvas-shadow-* 三族按 D1a 逐键重裁，**--z-panel 维持永不并入**（z-index 非颜色）。⚠ 表内 AddNodeMenu 15 处/HistorySidebar 2 处为过期快照（现已只消费 --fw-*，AddNodeMenu.tsx:305 仅剩 --canvas-shadow-menu），先修表再引用 |
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
2. **品牌/内容字面通道**：两主题一致的恒定视觉。**准入条件=逐点验底**：仅当消费点恒落深底（内容承载面/恒深区）才允许双主题同值；落跟随域浅底必须 token 双值（先例 --fw-accent→--fw-accent-text 前景档加深）。实测（WCAG 同口径）：#6C5CE7 白底 4.86:1 ✅（图形档维持同值，P9）；**#5DDCFF 白底 1.60:1 ❌、#4ade80 白底 1.74:1 ❌**（深底强调色）——#5DDCFF 消费点 KeyboardShortcutsPanel/AiToolActionPopup/ImageExtConfigPanel 本期跟随主题，浅档逐点裁定（双值变体 token 或迁恒深面）进 registry。用户自设色（P6 清单）同通道。
3. **双主题中性字面通道**：scrim/阴影/棋盘格/hydrate 遮罩（`bg-black/50` page.tsx:313、`bg-black/60` BaseFullscreenModal.tsx:70）、灰系中性微调色（`hover:bg-zinc-100`、CreditsDropdown :267 邀请卡 `bg-white` 族；v1.2 注：bg-black/[.06] 全仓 0 命中，勿作实例找）——两主题下都正确，**明文禁止 token 化**（含 P5 浅色重做时保留）。
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

**动作**（交付物三件——只采集不判定=仪器仍不判；**执行顺序四步固定（v1.5）**：⑴ 确认四进程环境与 fixture（gate-canvas-1/gate-node-1/样例视频/preview:5173）就位——扩了采集器却采不到基线等于白做，before-D 时间窗不可补 → ⑵ 扩 a0 采集器+扩 differ 属性集（**同一 commit**，含 attrSetVersion）→ ⑶ **自比自跑**（同一 HEAD 采两次比对定 0 噪声基线——全元素 color 继承噪声先测预算；若非 0，就地扩展分类器"预期项"白名单并把预算写进本 spec，**勿带噪声进 D1a**）→ ⑷ 采 before-D（8 页）入档，此后才开始 D0 代码改动）：
1. **采集器扩展**：a0 全元素冻结 `backgroundColor` + `color`（color 不再限于 FORM_CONTROL）。
2. **differ 侧同步扩展（独立基线对，不动 A5 既有冻结）**：css-baseline-diff.mjs:96 曾有意识排除 backgroundColor（"不可复采"）——本期**新增独立 D 段基线对 before-D/after-D**（新属性集含 backgroundColor+全元素 color + 新分类器分支）；**before-A0/after-A/light-B6 三套旧基线保持旧属性集冻结不动**（A5 differ 归宿=保留，继续管 A/B 段回归；§12.3"differ exit 0"指 **D 对**）。属性集版本号 `attrSetVersion` 随基线冻结；**"两侧属性集不一致判失败"限定同代基线对之间（before-D ↔ after-D）**，跨代比对走"属性缺失=不判"分支（否则旧基线全废）；颜色序列化统一 rgb() 归一化（对齐 BRIDGE_DARK 口径，防 hex/rgb 混比）；before-D **自比自跑一次定 0 噪声基线**（全元素继承色噪声先测预算，否则 D1a"深档 0 diff"被噪声淹没）。
3. **D 段探针族**（b1 同构，先钉当前深值）：画板 wrapper 底/dot 色、节点卡底、CanvasTopBar 药丸内前景、videos 卡面/播放壳面、ve 壳底/面板/轨道面/预览垫底、WeChatFollowModal 面与前景。**helper 语义适配（v1.4）**：probeInvariance 语义是"html.light 下保持深值"（islandInvarianceProbes 落盘键）——D 段翻转类探针（画板/跟随面）新增 `probeFlip`（或 kind:'invariant'|'flip' 参数）+ meta 键名分流，防后人读 meta 误判画板为恒深岛。**对比度台账脚本 contrast-table.mjs 一并交付**：输入配对表（P2/P9/§4/§8.1/§13 全部在册数字），输出 spec 可直接粘贴的表格——历轮人工复算同格分歧（2.82/2.96、3.11/3.72、5.40/5.30）以此终结，全文数字以脚本出表为准。**内建自检向量（v1.5，不通过 exit 1）**：#FFFFFF/#000000=21.00、#767676/#FFFFFF=4.54（经典 AA 贴线灰）、#555555/#000000=2.82（本 spec 深档网格点，历轮争议点）——三组过则全文表格有共同标尺。
4. before-D 在改动前 HEAD 采（8 页）——唯一时间窗，错过不可补；与 fixture（gate-canvas-1/gate-node-1/A0-0 样例视频）同 PR 锁定。**registry 清单两用**：D0-0 产出的迁移文件全集**同时**反向写入 PAGE_REGISTRY_FILES 三页数组**与**涌现授权集（emergence-adjudication-A4.json bare 非零位点 / route① colored-144 / EXTRA_AUTHORIZED_FILES 附理由三者之一）——只写前者开工首跑即 registryDrift 红（授权集是涌现闸第二半，§3 E 表口径，v1.3 补 §6 动作）。
5. **after-D 门禁语义定义（v1.3 补，防 D1a 后验收失控）**：after-D **不是一次性采集产物**——每次段验收时按当前 checkout 重新采集 working 侧快照与 before-D 比对。D1a 期望 0 diff；D1b/D2/D3 的期望 diff 由各自段 differExpectedPairs 逐条配对吸收，**未登记配对=失败**（沿用 B2 机制）。不写清则实施者 D3 后首跑见巨量 diff，面临 UPDATE_BASELINE=1（B5 禁）或误判失败两错。
6. 论据登记：clsHash/clsLen 不参与闸门（differ 只比几何与属性）→ D3 类名 token 替换不误伤配对闸，此即"baseline 不重采"的机制论据。

**验收**：D0-0 自身零产品改动、before-D 入档、探针全绿（钉深值）、自比自跑 0 意外。

## 7. D0 themeStore 两态化

**六件套**（原四件套 + App.tsx + CanvasTopBar）：

1. `themeStore.ts`：`ThemeMode = 'light' | 'dark'`；state 收敛单值 `mode`（`resolved` 概念随 system 档消亡）；删 `MEDIA_QUERY`/`resolveSystem`/`onMediaChange`/matchMedia addEventListener；`initThemeSync` 懒初始化保留。**readStoredMode 三级回落**（P8 实现约束，防"存储缺失"与"存储=dark"不可区分导致隐私模式类分叉）：返回 `ThemeMode | null`——null（缺省/非法/读抛）时回落 html 类提示（内联脚本产物），再回落 dark；补"读抛 + html.light"用例（现有 mock 只覆盖 media，需加 storage 抛错桩）。
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
| `--canvas-handle-bg` | `#9CA3AF` | **浅档定值 `#6B7280`** | 四键协同（NodeHandle.tsx:22/:28 消费 bg/icon；NodeHandle.css 消费 hover 两键）。#6B7280@白卡 = 4.83:1、@#F5F5F5 板 = 4.43:1，均 ≥3:1 直接达标（v1.3 删 v1.2 的 1.4.11 适用范围争论，按数字记录）；#9CA3AF@白卡 2.54:1 是换值动因。**可见性实测双底口径**：卡内手柄底=卡壳色、板面手柄底=板色，两底各测（单一底算会二义） |
| `--canvas-handle-icon` | `#6B7280` | **浅档定值 `#FFFFFF`**（配 #6B7280 底，辨识同深档白 icon 于灰底结构） | |
| `--canvas-handle-hover-bg` | `#FFFFFF` | **浅档定值 `#111827`**（反向深色系，白卡上消失） | |
| `--canvas-handle-hover-icon` | `#FFFFFF` | **浅档定值 `#FFFFFF`**（深 hover 底上） | |
| `--edge-flow-color` | `#3B82F6` | `#3B82F6` | **EdgeFlowParticles.tsx:24 消费**（v1.1 误挂 ConnectionLine 名下，v1.2 修正归属）；族级裁定：画布边线属交互可视性→双主题值+浅板可见性实测断言（含 hover/选中态）；#3B82F6@#F5F5F5 = 3.37:1 ✅ 非文本达标故同值 |
| `--edge-highlight-color` | `#999` | **浅档定值 `#6B7280`** | **ConnectionLine.tsx:97 消费**（归属修正）；#999@#F5F5F5 = 2.61:1 ❌ 偏淡故浅档加深（同族裁定见上，两键数字依据不同处置不同，自洽） |
| `--canvas-shadow-menu/dropdown` | 现值 | **浅档定值=同结构降 alpha**（rgba(0,0,0,.08/.12) 级，实施时目检微调登记） | neverMerge 重裁定，登记 |
| `--z-panel` | `400` | — | **维持永不并入**（z-index 非颜色，与主题无关） |
| `--ve-bg/--ve-panel/--ve-border/--ve-text` | 现值 | `--fw-bg/--fw-surface-dim/--fw-border/--fw-text` 浅值 | **B-3 定死**：--ve-panel 浅值=#f0f1f2（surface-dim，**非** video-editor.md:289 原始稿"面板白"）——保深色档零 diff 主闸优先，与原始稿差异目检认可登记 |
| `--ve-text-dim` | `rgba(226,232,240,.6)` | `#4b5563`（=--fw-text-dim-3 浅值） | 深值色相独立保留（22 处消费，D1b 裁定收敛或独立键） |
| `--ve-accent` | `#6C5CE7`（**不动**） | `#6C5CE7` | **P9 拆档**：图形/填充档维持同值零 diff（填充钮白字 4.86 ✅/浅档图形位 4.30@#f0f1f2 ≥3 ✅）；品牌紫域主保留，禁并入 --fw-accent；**--ve-accent-text 前景档不在本表**——整键随 D1b 落地（§9.2，v1.4 移出，防 D1a 自造死键） |
| `--ve-text-control` | — | — | **死 token（0 消费）直接删**（--ve-panel:99/:100/:103 三条 var 间接链随 D1b 删除） |
| `--vw-card-bg/--vw-card-border(-hover)` | 现值 | `#ffffff` / `rgba(0,0,0,0.06)` / `rgba(0,0,0,0.12)`（=--fw-surface/overlay-2/overlay-3 浅值，前两键直接并） | 卡面是 chrome（缩略图区才是内容承载，由缩略图自担） |

**块结构纪律**：index.css 只允许存在**一对**主题块（全部 `:root,.dark` 深值集中一块；全部 `.light` 浅值集中**单块**、置于全文件最后一个深块之后）——所有域 token 双值写入同一对块，禁多块交错（任一 .light 块源序在前即该域浅色恒输，且仅浅色档可察、深色档全绿静默）。v1.3 修正：v1.2 的"选择器文本必须 :root,.dark 字面无空格"**伪约束删除**——b1:206 谓词先做 `norm()`（去空白+小写）再比较，源文本空格无关；真约束三条：① 主题块须落产品 sheet（`i === productSheetIdx` 才扫描）；② 深块须声明 `--fw-bg`（定位附带条件）；③ 只允许一对块（第二对 .light 排深块前=静默恒输，此为唯一静默风险）。未定位到块时 b1:233-241 **响亮失败**非静默。
**断言归口**（B1 只锁源序不锁值，勿混淆）：源序结构断言归 **b1** 扩展（遍历 document.styleSheets 所有含 `--canvas-|--ve-|--vw-` 的规则，断言 .light 规则 index > 同键深值规则）；**值断言归 b0**（b0-token-blocks.spec.ts DARK/LIGHT 映射表 :26-63 仅含 16 个 --fw-*，域 token 双值必须加入该表或新增同构组——**--canvas-board-bg/-dot 点名入表**（深档 #000000/#555555 与 --fw-bg 不同值不同用途，只有 e2e 一重守卫不够），否则浅色档域 token 值无机械守卫）。
**死 token 删除落位 D1a**：--canvas-controls-active 与 --ve-text-control 两键在 D1a commit 内删除（定义层动作），并同步 b2-migration-registry.json 删除登记列——否则 D1b"三条 var 间接链删除"会被误读为不含死键。

### 8.2 ve 域共享 token 拆分（媒体/chrome 二分的前提）

`--ve-panel`/`--ve-bg`/`--ve-border` 现同时承担 chrome 与时间轴/预览媒体语义（EditorTopBar:21、AssetPanel:55、PropertiesPanel:74,81 ↔ TrackRow:33,53、TimelineRuler:47,55、TimelinePanel:292,307、PreviewPlayer:64,79、AssetPanel:111,144,184）。术语收紧：**clip 块面恒深（内容）；轨道行底/标尺跟随（chrome）**。

- `--ve-track-video: #1f1f1f` = clip 块面（内容承载）→ **单值恒深保留**（不进双块；浅色下深色轨道块=有意视觉，登记 §13）。
- 拆分裁定**定死无悬念**：标尺刻度=chrome 跟随；缩略图占位框=内容承载恒深；预览垫底=内容承载恒深——三条进 registry 裁定列。
- D1a 产出拆分表：chrome 侧消费点留双值化 token；媒体侧拆独立恒值 token 或局部字面；约 10 处消费点调整（TrackRow×2、TimelineRuler×2、TimelinePanel×2、PreviewPlayer×1、AssetPanel×3）。ClipBlock.tsx:28 波形 rgba(255,255,255,.7) 落 clip 内 → 恒深成立不动。

### 8.3 手写 CSS 块

`.tiptap-content` 10 处、`.editor-scroll` 3 处、`body{background:#141414; color:#e2e8f0}` 两条声明（→`var(--fw-bg)`/`var(--fw-text)`，深档字节等值）、PromptInput.css 28 处、NodeHandle.css 1 处——全部双值化（消费者是画布文本节点/prompt-input，浅色下文字不可读是本期要修的洞）。

**D1a 验收**：深色档 0 diff（仪器 = before-D + D 段探针；P9 前景档与消费点改指已移 D1b，D1a 全键深值零变更）；浅色档新增值可读（AA 对比度表，@#FFFFFF 卡面与 @#F5F5F5 板面双底实测，延续 B0"每 token 附对比度记录"惯例，公式=WCAG 2.x relative luminance 全文同口径）。

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

### 9.2 新增键与消费点改指（--ve-accent-text 整键落 D1b）

- **新增 `--ve-accent-text`**：深 `#9B8CF7` / 浅 `#5F4FD1`（P9；v1.4 从 §8.1 表移出——整键定义+消费点接线同落 D1b，D1a 表内零死键零新键）。
- **D1b 有意变更总清单（v1.4 新增、v1.5 补全——该段全部深色档变更在此逐条配对 differExpectedPairs，未配对=失败）**：① P9 8 处文字钮改指 accent-text（深档 #6C5CE7→#9B8CF7，逐点表 §11.4；**其余 7 处——填充钮 1+分隔柄 3+播放头/吸附线 3——维持 --ve-accent 不改指**，15 处一起改指会让播放头/分隔柄用上文字档亮紫=视觉噪声）；② §9.1 不等值键收敛（--ve-border/--canvas-controls-border #363636→#333 约 30 处、--canvas-controls-hover .08→.10、--vw-card-border-hover .25→.20、--ve-text-dim 收敛案）；③ AssetPanel 3 处 hover 改指 --fw-overlay-2；④ WeChatFollowModal 岛拆除（D3 断言反转前置项）；⑤ **等值键并域消费点改指（v1.5 补裁定①）**：--ve-panel→--fw-surface-dim（14 处）、--ve-text→--fw-text（34 处）、--ve-bg→--fw-bg（2 处）≈50 处——三键深值全等故**深档零 diff 无需配对**，浅档首次一致；§8.1 浅值列"=--fw-* 浅值"即并域目标，不留双轨（每键单主）。**单次登记规则**：--canvas-controls-hover 的 diff 在 ②③ 中只登记一次（按先改定义后改消费的顺序落 ②）——同一变化两条登记会让配对闸重复计数。**"深色档 0 diff"适用范围收窄为 D0-0/D0/D1a 三段（v1.4）**——D1b 起 after-D 期望 diff 全部由本清单配对吸收，§15 验收锚同步改写。

### 9.3 AssetPanel 与 WeChatFollowModal

- AssetPanel.tsx:110/143/183 `hover:bg-[var(--canvas-controls-hover)]` → 随 D1b 并域改指 `--fw-overlay-2`（ve 域已改跟随，浅色档取浅 hover 是正确行为）。
- 删 index.css:99/:100/:103 三条 var 间接链——理由是**每键单主 + 并域后主键变更**（`--canvas-controls-bg` 直接并入 `--fw-surface-dim` 后链目标消失），D1a 双块直写、D1b 消费点直改。（原"岛污染"前提随 ve 改跟随消失，不再成立。）
- WeChatFollowModal 改跟随：删自身 ConfigProvider darkAlgorithm + rootClassName="dark"（:15,21），继承 App 算法与 html 类；**与其断言反转（G8①）同 commit 原子执行**。

**D1b 验收**：differ 全部 diff 与 §9.2 总清单**逐条配对命中**（未配对=失败，非"exit 0"——v1.4 修正口径）；lint 双规则绿；`video-editor/**` 内 `var(--canvas-` grep 0 命中（每键单主域纪律：--canvas-controls-* 是画布工具条唯一主，ve 域用 --fw-*/--ve-*）；WeChatFollowModal html.light 下取浅值。

## 10. D2 colorMode 翻转

1. CanvasView.tsx:379 `colorMode="dark"` → `colorMode={mode}`；板面三机制协同——:377 `bg-[#000000]` → `bg-[var(--canvas-board-bg)]`（**必须留在 Tailwind utility 层**：产物 CSS 实证 .react-flow 字节 0 < .bg-[#...] 字节 50943，同特异性源序 utility 胜；移 inline/删则 dark 皮肤 `--xy-background-color-default:#141414` 复现）、:382 `bgColor="transparent"` 保留。
2. **对账工装**：同 seed 同 build 像素 diff（c7 §2#8 先例 0/1,024,000），两主题态各跑；重点复测 `--xy-minimap-*`/`--xy-controls-button-*`。index.css:212-216 A2 selection 钉值：**先临时撤钉对比**——差异为零则删除钉值（钉值失效+门禁恢复有效），非零则画板根（CanvasView.tsx:341 wrapper 父层）局部钉 `--xy-*`；禁全局 !important。
3. **wrapper 镜像断言 + 反补岛守卫**（v1.5 写法可执行化——`.react-flow` 原始 classList 含库基础类 `react-flow`、utility 类 `bg-[var(--canvas-board-bg)]` 等，**裸 `toEqual(['dark'])` 必红**，红后的两条错误修法：退化 `toContain`=反补岛失效（补了 .dark 依然绿）、硬编码类数组=库升级即红）。正确写法（两档各测）：

```ts
const wrapperThemeClasses = Array.from(wrapper.classList).filter(c => c === 'light' || c === 'dark');
const htmlThemeClasses = Array.from(document.documentElement.classList).filter(c => c === 'light' || c === 'dark');
expect(wrapperThemeClasses, 'wrapper 主题类恰一个且等于 html 类').toEqual(htmlThemeClasses);
```

恰一个 → 防常量化（与 html 不同类即红）；恰一个且相等 → 防补岛（html.light 下补 .dark 得 ['light','dark'] 长度 2 即红）；不受 xyflow 附加类影响；与 c0:57-66 readHtmlTheme 同口径。对象是 xyflow wrapper `.react-flow` 本身（CanvasView.test.tsx:97 现有选择器可直接复用），非 CanvasView:341 外层 div。a0:221 探针**改视觉真值**：wrapper backgroundColor computed（深 rgb(0,0,0) → 浅 rgb(245,245,245)，对应 --canvas-board-bg，走 probeFlip helper §6），"D4 语义双证"注释同步改写；**a0:250 ve 壳定稿双断言**（v1.4）：① `getPropertyValue('--ve-bg')` html.light 下取浅值（语义层归属跟随）+ ② 壳根 backgroundColor 等于该浅值（视觉层实渲染）——不保留任何"恒深"方向断言（随 ve 迁移必红）。
4. CanvasView.test.tsx:90-100 改写：`not.toContain('light')` 在 colorMode={mode} 下成恒真废测 → 改镜像断言；:90 注释（A2 溯源）同步改写为新裁定。
5. MiniMap 内联 JS 色（:384-394 rgb(50,50,50)/rgb(70,70,70)/nodeColor rgb(160,160,160)）进 D3 清单双值化；maskColor rgba(0,0,0,.35) 中性遮罩留。⚠ **nodeColor 是函数 prop 落 SVG 属性，var() 代换不保证生效**（本段唯一投 var() 存疑点）——直接用 JS 分支取色（CanvasView 已有 mode）；style 属性里的 backgroundColor/border 可安全走 var()。
6. **初始化顺序契约**：main.tsx:9 `initThemeSync()` 先于 `createRoot().render()`（:23）保留并加注释——v1.2 理由修正：懒初始化 + 内联脚本使首帧实际与调用顺序**无关**（useSyncExternalStore 首渲染 getSnapshot 即 ensureInit），该调用是**显式声明初始化契约**（不依赖懒加载副作用），非"不加就闪"（防后人据错误因果去"修"不存在的问题）。
7. **ProcessSnapshot 整块=内容承载面恒深**（v1.2 裁定修正，原"改镜像"作废）：过程快照是画面视口（P6 判据），:89 `colorMode="dark"` **保留**、:91 网格点 `#3a3a3a` **保留不动**（深档零 diff 天然成立，无需统一到 --canvas-board-dot——那会引入 #555555≠#3a3a3a 的深档 diff）；登记为内容域不变式。ProcessSnapshot.test:96 bg-black/60 中性遮罩亦留。

**验收**：**以 D1b 后 checkout 为参照，D2 前后深色档像素 diff = 0**（v1.5 补参照系——D2 在 D1b 之后执行，P9 提亮/Δ3 收敛等深档有意变更已落地，参照 before-D 必假红然后被当"已知差异"糊掉=工装失守；只验 D2 自身零变化）；--xy-* 复测表逐属性登记；镜像断言绿。

## 11. D3 全量迁移（按域原子对：翻实现+翻断言同 commit）

### 11.1 执行规范

- **原子对**：每域/每岛拆除与断言反转同 commit；D4 只留岛消亡后的新回归 + 全门禁（段间独立验收，spec v1.9 :125 规矩）。
- **baseline 重键不重采**：no-color-hex 键 = `ruleId|路径|sha256(TrimEnd(行文本))`，迁移换键后**同文件 hex 键计数不增**（lint-gate.mjs:139 口径"允许伴随重键"）；白名单文件键保留。**禁 UPDATE_BASELINE=1 重采**（B5 控制动静）。
- **两条门禁机制分开写验收**：hex 门禁 = "键数不增（允许行文本重键）"；no-theme-utility 门禁 = "白名单净减 4 条目录（§11.3）+ 净增 K 条精确文件"（该规则零基线，任何命中即违例，重采不豁免——lint-gate.mjs:120）。
- **no-theme-utility 扩规则（D3 开工前置，门禁漏洞修补；v1.2 数字与机制修正）**：现状正则只拦 `text-(white|black)`——bg/border/ring/divide 等白系无覆盖（VideoEditNode.tsx:151 裸 bg-white 是 P4 主承重点，现有两条规则都看不见）。扩为 `(text|bg|border|ring|divide|fill|stroke|from|via|to)-(white|black)`。**真实分母以扩规则后脚本产出为准**（第四轮实测：目录白名单外新增红 ≈25 处=bg 18+text 7；border/ring/from 全在目录白名单内；divide/fill/stroke/to/via 当前全仓 0 处=纯未来守卫，注明防误判漏统计）；working list=脚本清单非手写数字。**白名单粒度升级为"文件+属性族"**（`{file, allow:['bg']}` 结构）——整文件放行会放走同文件未来 text-white 回归。**合法浅色面预登记豁免**：CreditsDropdown:267 邀请卡 bg-white/hover:bg-zinc-100（P5 明文保留）、ConfirmModal/SaveAsTemplateDialog 白卡 bg-white（通道 3）——这些**不是 working list**，误改=与通道 3 对撞返工。registry whitelistKeeps 镜像同步。
- **节点组件禁 useTheme**：节点/卡/面板组件一律消费 CSS 变量（主题切换=零 React 工作；useTheme 会让全部画布节点重渲染，React Flow 下最贵）；唯一例外 CanvasView 的 colorMode={mode}。验收 grep：`pages/canvas/components/{nodes,groups}/**` 内 useTheme 命中 0；D4 性能实测双探针——**切换一次主题统计节点组件 render 次数（预期 0，只有 CanvasView 重渲染，直接验证禁令收益）** + 大画布（≥50 节点）切换耗时/掉帧读数（fps 噪声大难判因，render 计数为主据）。
- **涌现登记两处同步**：D3 引入新可见边框（border-width 0→N）时，emergence-adjudication-A4.json 授权集（或 EXTRA_AUTHORIZED_FILES 附理由）+ PAGE_REGISTRY_FILES 对应页数组，缺一闸门 exit 1（§3 E 表）。
- **媒体容器自持底色 checklist**（机械检查项，非目检，P6 判据落地）：grep 卡内 `<img|<video>` 祖先链，每个媒体容器自持深底（透明 PNG/未加载图/poster 未到时不得露浅底）；文本/标注类内容容器则整体跟随（P6 判据"不会被完全覆盖"分支）。
- **完成判据机理句（v1.4 补，防误读）**：两条 lint 门禁与 differ 都是"无意外变化"闸——**漏改=零 diff 不报红**（lint 只拦不新增、differ 只抓深档意外变化）。故 D3 完成判据只能来自三处：**registry 清单逐条核销 + 浅色档探针（每面取期望浅值）+ B6 目检**；differ exit 0 ≠ 迁移完成。
- **inline-style + SVG 呈现属性分区（v1.4 建、v1.5 更名扩面）**：style 对象内直接色字面（backgroundColor|color|fill|stroke|borderColor|boxShadow 等）与 **SVG 呈现属性**（stroke=/fill=/stop-color=，如 GridIcon rect、ConnectionLine:97、EdgeFlowParticles:24、RemoteCursors:30）**两条 lint 规则都拦不到**（一条只拦 class 串 hex、一条只拦 white/black 类名）——估算 ≥63 处/25 文件（TextNodeToolbar 7、GridSizeDropdown 6、AudioWaveform 6、VideoHDPanel 6、VideoTrimTimeline 5、selectionTokens.ts 4；常量色表另计；**估算值仅说明分区必要性，以脚本产出为准**）→ registry 增本分区，核销唯一靠清单+目检。**SVG 呈现属性通则（v1.5 合并三处同根因为一条）**：SVG 呈现属性不可用 CSS 变量代换（`stroke="var(--x)"` 不生效）——一律走 JS 分支取色；适用点=§10.5 MiniMap nodeColor、§11.4 ExportModal Progress strokeColor、GridIcon 等；节点组件内的 JS 分支禁自读 store（§11.1 禁 useTheme），由 CanvasView 经 props 传入或维持字面（见 GridIcon 裁定）。
- **浅底重校清单**：OutpaintSelectionOverlay `bg-white/30` 网格线（落媒体上→第四通道保留字面）；透明 PNG 棋盘格/涂抹蒙版/裁剪遮罩逐个裁定"贴媒体 or 贴卡壳"；NodePalette（#0f0f0f/#e0e0e0/#f7f7f7）、ProjectTitle（#1A1A1A）——后两者在 PAGE_REGISTRY_FILES（css-baseline-diff.mjs:56-60），改动同步那张映射表；**#3a3a3a 族（v1.4 语义分组改写）**：9 源文件 11 点分两组——**A 组 size-7 图标钮 ×5**（RunButton:14/AudioConfigPanel:270/TextConfigPanel:270/VideoHDPanel:220/VideoConfigPanel:467，逐字同款）与 **B 组 tooltip 底 ×2**（GenerateCountSelector:30/VideoConfigPanel:432，逐字同款）**各自强制同键一次改齐**（tooltip 底翻浅后其上 text-white 需同步改 text-text=P7 应用）；**C–F 四处按语义各自裁定勿塌成一个键**（C=MultiImageNode:292 节点徽章、D=TextNodeToolbar:228 文本节点默认底【内容容器，P6 判据分支】、E=TextNodeToolbar:239 划线色板、F=AudioWaveform:272 波形基线图形线——并入按钮面键会造成语义污染）；3 条测试断言同 commit（AudioConfigPanel.test:99 class*= 正则形态易漏、VideoHDPanel.test:73）；**动画类元素浅档可见性专项**（edge particles 靠 opacity 动画/播放头/吸附线——静态对比达标 ≠ 动画可见，逐个目检留档）。

### 11.2 专项裁定

| 专项 | 处理 |
|---|---|
| VideoEditNode | P4：跟随主题变深卡（bg-surface/text-text 等 token 化）；有意变更进 differExpectedPairs + 目检；**#E5E7EB 巧合等值登记**（:154 inline border 与 --fw-border 浅值同值——"浅档等值/深档变更"双向预期标注，最易误判回归的组合）；:129 mini 播放器 JS 通道色（复用 canvas-renderer #000/#FFF）登记 c3 census 不可迁移；**TRACK_COLORS 统一=P10 用户裁定 A**（v1.4 定案）：三行统一到 ve BLOCK_BAR 共享常量（禁指向 --ve-track-video——BLOCK_BG 面色当类型色=深板近黑回归）；**共享常量放叶子模块**（v1.5：`video-editor/timeline/block-colors.ts` 级别，先例 VideoEditNode:17 已从 timeline/canvas-size 叶子导入——勿从 ClipBlock.tsx 导出，否则把 useAudioPeaks/editorStore 整条依赖链拉进画布节点 chunk）；深档三行变色=有意变更登记 differExpectedPairs（§9.2 清单模式同款），B6 目检单独看此卡（三重变更叠加：P4+P10+#E5E7EB） |
| AnnotationToolbar | **P7 第二反例专项**：五件一起翻（BAR_BG 深底/:332 恒白保存钮/:230/:254 白系选中环与分隔线/:135/:170 白系 hover）——浅色下"白上加白"糊一片，按 P7 原子检查。**v1.3 补**：本组件改动多为 **inline style**（:111/:135/:161/:170/:187/:199/:211/:230/:305/:317/:332），no-theme-utility 拦不到 style 对象——**零 lint 守卫**，必须进 registry 显式清单 + B6 目检，否则全仓最易漏改（漏改后果恰是 P7 反例本身）；COLOR_PRESETS:60 含 #000000 黑笔：预设不换，P6 已登记 |
| CreditsDropdown | P5：浅色重做（ui-ux-pro-max 出浅色稿，D3 开工前交稿）；深色档现状冻结；深色渐变基底/glow（:127/:271）与 52 处字面随稿替换；邀请卡族中性色保留（通道 3）；药丸宿主（CanvasTopBar :147）同步 chrome 化结案 P7 反例① |
| 播放壳（P3） | **前置 DOM 拆分**：画面垫底元素从壳根独立（媒体容器自持固定深底，P6 判据）——现状 letterbox 与 chrome 共用 VideoPlayerModal.tsx:58 同一壳根，不拆则两条裁定落同一 class；拆出后壳根/画面外 chrome（外框/关闭钮/轮播条）token 化跟随，**压画面浮层保持深 scrim+白字恒定**（第四通道）；删壳根 dark 类与 [color-scheme:dark]。**[color-scheme] 局部保留通则（v1.2 补）**：恒深内容承载面若含原生控件（<video controls>、滚动条、range 滑杆），html.light 下会渲染浅色控件压在深媒体面上——此类面**自带局部 [color-scheme:dark] 声明**（第四通道一部分），PlayView 播放态 controls 在其中；ve 壳 VideoEditorShell.tsx:134 同审。PlayView/ProcessView/VideoCard/CarouselBar 随域迁移（**ProcessSnapshot 除外=整块内容承载恒深**，§10.7）；VideoPlayerModal.test.tsx:168-173 断言同步 |
| 画布全屏查看器 | ImageFullscreenViewer/VideoFullscreenViewer 跟随（P3 承诺③），与播放壳同 commit 原子对；**O6② 死类删除**（§3 E 表，非落深值） |
| Lighting/Angle3D 面板 | **非目标收窄为渲染产物层逐文件**（§1 更新）：engine/LightingEngine.ts、engine/Angle3DEngine.ts、Lighting/ThreePreview.tsx、Angle3D/Angle3DPreview.tsx、video-editor/renderer/canvas-renderer.ts(+export worker)；同目录 LightingModal/ControlPanel/ViewToggle/LightPresetButtons/Lighting 的 PromptInput、Angle3DModal/ControlPanel/AnglePresetButtons 是普通 chrome（canvas/page.tsx:304-305 直挂画布页）→ **本期迁移**，不留"全量跟随"例外 |
| WeChatFollowModal | D1b 已列；html 类直承 |
| 顶栏药丸 | CanvasTopBar 三药丸 chrome 化（bg-[#1A1A1A]/90 → surface 系）；P7 原子性检查（前景/边框同步） |

### 11.3 白名单手术

- 删 4 条目录白名单（v1.2 增第 4 条、v1.3 改写举证理由）：`src/pages/videos/**`、`src/pages/canvas/video-editor/**`、`canvas/components/{nodes,edges,groups}/**`、**`src/components/MaterialLibrary/**`**——第 4 条举证修正（v1.2"必现 P7 半半"措辞不准，P7 要求同一表面面深+前景浅共现）：实测 MaterialLibraryModal.tsx:35-37 **无 rootClassName/无岛类/无 ConfigProvider**——白名单纯 lint 豁免、**从未有运行时岛**，即**它本来就在跟随域**；且 Modal.css 已全量 token 化（B2-b 家族裁决迁移，var(--fw-*) 30+ 处）→ 浅色档现存混排（CSS 随主题翻浅 + 10 个 TSX 文件 ≈77 处字面恒深），属**现存缺陷非本期引入**（与药丸、CreditsDropdown 并列第三例）。裁定=摘除白名单 + TSX 残余迁移（**不必与 WeChatFollowModal 同批**——后者有真实机制改动，本条纯摘除+字面迁移）；text-dim-1 消费点（Browser 侧）纳入浅底重校；登记"原 family #3 恒深裁定废止"。规模注记：勿按 spec v1.9 :150 旧口径"~55 处 CSS"估工时——CSS 已迁完，剩 TSX。
- **摘除随域原子执行，禁一次摘完**：videos 域 commit 摘 videos 白名单、ve 域 commit 摘 video-editor、画板批量 commit 摘 nodes·edges·groups、MaterialLibrary 随其迁移 commit——一次性摘三条会跨三域同红，违背"每域原子对独立验收"。
- 媒体面/内容面保留的 `text-white`/`bg-white` 族落**精确文件+属性族白名单**（§11.1 粒度；照抄 b6 text-black 8 文件精确集先例，含 CreditsDropdown:267 邀请卡/ConfirmModal/SaveAsTemplateDialog 合法浅色面）；同步 b2-migration-registry.json whitelistKeeps 镜像（no-theme-utility.js:8-10 要求）。

### 11.4 收敛点登记表（v1.3 新增——同类分叉点一次列全，防各自漂移；D0-0 落 registry 裁定列）

**#6C5CE7 紫族落点表（v1.4 表头改写：三类值，非"恰好同值"——P9 拆档后各落点取值不同正是本表意义）**：

| 落点 | 形式 | 处置（应取哪一档） |
|---|---|---|
| --ve-accent 定义 | token | 图形档 #6C5CE7 双档同值（P9） |
| VideoEditorShell:153/:155/:160 分隔柄 hover | var() 消费 | 图形档 ✅ |
| ExportModal:245 填充钮 | var() + text-white | 图形档（白字 4.86 ✅） |
| ExportModal:236 Progress strokeColor | **字面 #6C5CE7** | D1b 改 var(--ve-accent)——⚠ **antd Progress 若落 SVG 属性 var() 不解析**（同 §10.5 nodeColor 风险），先实测，不生效则 JS 分支取色（ve 域可读 store） |
| ClipBlock:10 BLOCK_BAR video 行 | **字面** | 内容类型色恒定；与 TRACK_COLORS 抽共享常量（P10） |
| ClipBlock:88 菱形手柄 border | **字面** | D3 改 var(--ve-accent)（图形档） |
| VideoEditNode:20 TRACK_COLORS | **字面** | P10：统一到 BLOCK_BAR 共享常量（用户裁定 A） |
| VideoEditNode:25-28 GridIcon ×4 rect stroke | **字面 svg 属性**（v1.4 补录） | **保持字面恒定（v1.5 裁定）**：双档均达标（白卡 4.86 ✅/深卡 #1e1e1e 上 3.43 ≥3 ✅），登记"品牌图形档字面"防漂移——不改 var()（svg 属性不生效）也不走 JS 分支（节点组件禁 useTheme，为四枚装饰 rect 传 mode 不值） |
| PlayheadLine:9 / TimelineRuler:60 / TimelinePanel:322（播放头/吸附线） | var()/字面 | **图形档维持 --ve-accent 不变**（v1.5 补录——P9 15 处中"不改指 7 处"的 3 处，与 §9.2①括注对账；浅档可见性走 §11.1 动画专项目检） |

**P9 文字钮逐点表**（8 处，differExpectedPairs 一一配对）：AssetPanel:59 / PreviewPlayer:101 / PreviewPlayer:106 / PreviewPlayer:111 / PropertiesPanel:23 / TrackRow:38 / TimelinePanel:297 / TimelinePanel:299。

**#3a3a3a 族**：见 §11.1 浅底重校清单（9 源文件 11 点，A/B 同款串强制同键 + C–F 按语义裁定 + 3 测试断言）。

**验收**：registry 分区逐域核销（html.light 取浅值 + 内容面取深值 + lint/differ 绿）；hex 键数不增；白名单净减 **4** 目录/净增 K 精确文件（v1.3 对齐 §11.3 的 4 条）；媒体容器 checklist 全过；浅色 B6 真实对照 + light-eyeball 目检（复用 b6-acceptance 流程）。

## 12. D4 收口与全域反转清单

### 12.1 断言矩阵（新）

1. **跟随矩阵**：html.light 下 ve 壳/videos 壳/WeChatFollowModal/画布全屏查看器/画板/节点卡 chrome 取浅值；
2. **残余真岛对照**：LoginModal 浅岛（登录域）、admin 深岛——岛机制断言保留不退化（ProcessSnapshot **不列此组**，v1.4 归类修正：它是内容承载面非主题岛，列此会暗示"岛机制仍需保留"与 E 表三项废止叙事打架）；
3. **内容承载面恒深**：html.light 下媒体垫底/clip 面/预览垫底取深值——**ProcessSnapshot 在本组**（整块恒深，同时是全仓唯一保留的 colorMode 常量+事实 --fw-* 深岛，按 P7 原子性核验：子树若含 --fw-* 消费点取深值与内容面一致即通过）。

G8① antd 通道探针（:522 关闭钮色 >180 = darkAlgorithm）反向后**改判据**（<180 = defaultAlgorithm），非只改数字。

### 12.2 全域反转清单（不列全就会红）

| 类别 | 位置 | 动作 |
|---|---|---|
| e2e | c0 G1 system 2 例（:105-106） | 删 |
| e2e | c0 G2 判别式（:183,:185） | 换（去 matchMedia） |
| e2e | c0 G3（:208-226） | 改 OS 零影响 + matchMedia 计数 0 |
| e2e | c0 G4 ve 壳（:278-315） | 反转载浅值 |
| e2e | c0 G7 三态（:398-443）+ /videos 叙事（:379,:445） | 两态化；videos 叙事改跟随；**钮存在性断言扩三页** /works、/videos、/canvas（新钮落地验证） |
| e2e | c0 G8①②③（:507-579） | ①②反转；③双岛论断消亡重写（G8③ 判据改 <180 与镜像断言口径见 §10.3/§12.1） |
| e2e | a0 探针 ×4（:200,:220,:221,:250） | **v1.3 分级**：①:221 画板 wrapper 探针**改造**（原探 --fw-bg 钉深依赖 wrapper .dark 块重声明，D2 后必红且诱导补岛回退——改探 backgroundColor 视觉真值 rgb(0,0,0)→rgb(245,245,245)，§10.3；配 §10.3 镜像断言=反补岛守卫同条）；②:250 ve 壳**双断言定稿**（§10.3 v1.4：语义层 --ve-bg html.light 取浅值 + 视觉层壳根 backgroundColor=该浅值；不保留任何恒深方向断言）；③:200/:204 videos 封面 **保持**（VideoCard:16=封面占位底=P6 内容垫底恒深，registry 登记）；④:220 canvas html 根 **保持** #f7f8fa（浅色档正向对照） |
| e2e | a0 叙事注释（:15-18,:303,:305） | 重写 |
| 单测 | CanvasView.test.tsx:90-100 | 镜像断言 |
| 单测 | canvas+videos 域颜色断言 ≥24 条（以 registry 测试分区脚本产出为准；实测：CanvasToolbar.test ×7 rgb(38,38,38) 族、CanvasView.test:183 MiniMap、VideoTrimTimeline.test:76/103、VideoHDPanel.test:73、TextInputNode.test:197/206、TextNodeToolbar.test:171/180、TextConfigPanel.test:119、StoryboardGroupRenderer.test:92/101（改双主题可见性断言）、ProcessSnapshot.test:96、VideoPlayerModal.test:168-173、PlayView.test:193-225、ProcessView.test:50-61、CarouselBar.test:79-80） | 随实现逐条改（D3 各域原子对内同步） |
| 单测 | ve TimelinePanel.render.test:115-131 | **不动**（clip 类型色属内容语义） |
| 登记档 | c7-accepted-items §1 #1/2/3/7、§3 归因、§2#8 | E 表所列 |
| 登记档 | c5-portal-census / c3-js-channel-census / domain-token-adjudication-B0 / b2-migration-registry / b6-acceptance:61,:71,:74 | E 表所列 + 补登 |
| spec | video-editor.md:289/:291 | 复活/改注 |
| 注释 | router.tsx:48-50、CanvasView.tsx:378、index.css:210-211、tailwind.config.ts:9-10 | 订正 |

### 12.3 D4 全门禁

C0（改造后新形态全绿）、vitest 全绿、lint 双规则、css-audit 斜杠/differ exit 0（**指 D 段基线对 before-D/after-D**，§6；A5 旧对保持冻结管 A/B 段回归）、D8 电池、浅色 B6 真实对照（画布+ve+videos+弹层全景）、性能观感实测一次（render 计数+大画布读数，§11.1；双通道非原子面积变大——spec v1.9 :202 已知项扩面登记）。

## 13. 已知接受项与风险登记

1. `'system'` 残留用户一次性回落深色（P8，开发期无用户数据影响为零）。
2. antd cssinjs 晚一帧的切换瞬时不一致面积变大（ve/videos/canvas 三域同帧重渲染）——D4 实测留档（含大画布 ≥50 节点切换耗时/掉帧读数）。
3. **过渡中间态**（纪律登记；v1.3 补 D1b↔D2 锁成三把）：D2 之后～D3 板面批次完成前，浅色档画布不可用（板已浅、字面仍深的混排）；D1b 之后～D2 之前同样混排（var 间接链已删、消费点已并域）；D1a 之后～D3 之前，板内 3 个 `--canvas-controls-*` 消费点（VideoHDPanel:93/VideoNodeToolbar:99/VideoTrimPanel:126）浅色档取浅值落黑板——深色档**无未登记 diff**（v1.5 措辞对齐 §15.3），纪律要求 **D1b↔D2↔D3 板面批次连续收口**，禁止在中间态用浅色档验收画布。
4. --ve-track-video：浅色编辑器中 clip 轨道块保持深色=有意设计（与浅面板形成媒体区对比；clip 块通常有缩略铺满，未就绪/纯音频轨露深底）——B6 目检勿判缺陷。
5. 浅色档网格点对比度 1.53:1 天然低于深档 2.82:1（P2，目检认可）。
6. VideoEditNode 深色档白→深、CreditsDropdown 浅色重做、--ve-accent-text 深档文字提亮 #6C5CE7→#9B8CF7（P9，8 处文字钮，修复现状 @#262626 3.11 欠账至 5.40）、**TRACK_COLORS 三行统一到 BLOCK_BAR（P10 用户裁定 A：image/audio/subtitle 深档变色）**、#363636→#333 等 Δ3 级收敛——全部登记 differExpectedPairs（D1b 清单 §9.2 / D3 域原子对清单），属有意变更非回归。
7. **范围外待裁登记（v1.4，第六轮发现）**：AuthModal.tsx 深色字面（:85 bg-[#222222] border-[#3a3a3a]、text-[#ccc] 族）宿主是两个恒浅岛（pages/login/page.tsx:15、components/auth/LoginModal.tsx:24）——浅岛内嵌深色表单，且 spec v1.9 §3.2 将其错误登记为"营销页固有浅色豁免"。不在画布链路（CanvasTopBar"登录"是 Link 路由跳转非弹层），本期不动；C8 收口时登记待裁项（c7 增补或独立 spec）并订正 v1.9 §3.2 错误标签。

## 14. 后端零改动声明

实测：apps/api/src 下 theme/prefers-color-scheme/darkAlgorithm/#141414 **代码与注释皆 0 命中**；后端不产出 HTML（无 res.render/模板）；主题仅存 localStorage，无用户偏好表/接口——无迁移、无兼容窗口、无缓存失效面。fixture 改动（浅色对照补种）与 before-D 基线同 PR 锁定。

## 15. 执行顺序与段验收汇总

D0-0（仪器/before-D/探针钉深）→ D0（两态六件套+G 门禁改写，零视觉变更）→ D1a（定义层双值化+ve 拆分+手写 CSS，深档 0 diff）→ D1b（并域冲突表+AssetPanel/WeChatFollowModal 原子对+白名单手术）→ D2（colorMode 翻转+板面三机制对账+镜像断言）→ D3（registry 清单逐域原子对迁移，含四个专项）→ D4（断言矩阵新形态+全域反转清单核销+全门禁）。

**顺序三段约束**（v1.2 补全为双向锁）：
1. **D1 必须先于 D2**：wrapper 的 .dark 类是 D1 期间画板子树的实际值域（先翻 colorMode 则画板在 D1 未完成时取浅值立刻坏）。
2. **D2 与 D3 板面批次连续收口**（或把 colorMode 翻转并入 D3 板面批次首个 commit）：D2 之后～D3 板面完成前浅色档画布不可用（§13.3），这是唯一可能被验收流程误踩的窗口。
3. **浅色档验收不得落在 D2–D3 空隙内**；**"深色档零 diff"验收锚适用范围=D0-0/D0/D1a 三段**（v1.4 收窄）——D1b 起深档 diff 由 §9.2 总清单配对吸收（未配对=失败），D3 各域由域原子对清单吸收；"全程零 diff"旧表述作废（过渡期深档口径=**无未登记 diff**，v1.5 措辞对齐 §13.3）。

## 16. 变更登记（v1.5 冻结后实施期订正）

### v1.5.1（2026-09-20，计划审核轮三份报告实测订正）

1. **对比度数字勘误**：§8.1 `--canvas-board-dot` 行"≈1.55:1@板底"系笔误，正确值 **1.53**（与 §13.5 一致；contrast-table.mjs 台账 specExpect 以 1.53 入册）。历轮争议 #555555@#000000=2.82 经逐步验算成立（L=0.09079→2.8159；#767676@white=4.54 与 #6C5CE7@#262626=3.11 双锚交叉验证）；审核期一组 2.76/1.54/3.39 复算系实现自身常数偏差（其中 2.76 恰等于 channel 公式 `(v+0.055)` 误写 `(v+0.05)` 的输出 2.7606）——自检向量设计目标（抓实现错）就此获得一次真实实证。
2. **E 表 O6② 订正**：v4/shadcn 死类（text-popover-foreground 10/text-muted-foreground 8/focus-visible:ring-ring **2 非 4**）已在 B3 轮按 b2-migration-registry.json `b3DeadClassDisposal`（:1131-1181）处置为 replaced-literal（text-neutral-200/400、ring-white/40），src 现状 0 处。O6②"死类删除"改判为 **B3 落值双主题化**（chrome 处 token/双值、压画面处恒深）+ **同 commit 撤销 b2:1136 domainRule**（"全屏查看器禁 --fw-*"条款随本期废止）；登记档以 b2-migration-registry.json 为准（b3-alldead-list.json 系过期快照）。
3. **实施期事实注记**：--fw-accent-text 浅值 #15803d 系 B0 既有（index.css:48）——D 段探针"CanvasTopBar 已连接前景"D0-0 即取 rgb(21,128,61)、无翻转点，保留作浅档正向对照。--ve-text .tsx 消费实测 30 处（34 系含 index.css 定义口径）；ve 媒体侧拆分实测 4 处（AssetPanel:111/:144/:184 缩略占位框 + PreviewPlayer:64 预览垫底，拆 --ve-thumb-base #363636 / --ve-preview-base #141414 两恒值键）。
4. **videos 播放壳浅色档已知接受**（P3② 自然推论登记）：画面容器恒黑 + PlayView UI 压画面恒深 → 浅色档可见变化≈0（仅壳外框/关闭钮/轮播卡跟随）；CarouselBar 与页面级 chrome 算跟随域。B6 目检勿判缺陷。

### v1.5.2（2026-09-20，计划第五轮审核实测订正）

1. **涌现闸 D 对改站点级登记**（§6-④ 订正）：原"迁移文件全集两处同步（PAGE_REGISTRY_FILES 页数组 + 涌现授权集并集）"在 D 域全量文件授权后退化为恒真（文件级判据"页内任一文件在授权集"被整批吸收），且粘贴视图与 registry 构成双真源漂移。D 对（attrSetVersion D1）改 **`d3EmergentSites` 站点级登记**（canvas-migration-registry.json 新键 `{page, key, why}`；differ 对四采集页 border-width 0→N 站点按 `page|key` 精确匹配，未登记即 offender）；A5 旧对（A0×A0）保留原文件级路径不动。
2. **before-D 采集窗口移 D0 收口后**（§6-④/§7 验收订正）：D0 的 CanvasTopBar 新切换钮是有意 DOM 新增（新增 dom: 键+右侧兄弟平移），"D0 零 diff"在配对闸/几何闸上数学不成立。基线语义 = f(前置 commit, 采集器版本)（自比自跑已证采集器确定性）；D0 收口后、D1a 前采 **before-D（深）+ before-D-light（浅，REAL_LIGHT 真实路径）双基线**，此后段验收**深浅双跑**，两侧有意变更均入 differExpectedPairs、未配对=失败（浅侧目标方向获得机械守卫；light-B6 旧浅档基线属性集 A0 不可复用，同代校验拦截属预期）。
3. **手柄 icon 浅档值订正**（§8.1 表两行）：原浅值 `--canvas-handle-icon: #FFFFFF` / `--canvas-handle-hover-icon: #FFFFFF` 的前提"icon 落 #6B7280 手柄底上"失效——NodeHandle.tsx:24 circle `fill="transparent"`，icon（加号 path）实落**卡面**：浅档白卡上白加号 1.0:1 完全不可见（hover 态同理）。订正：icon 浅档 **#4B5563**（@白卡 7.56）/ hover-icon 浅档 **#111827**（@白卡 18.53）；深档两值不动零 diff。对比度配对入 contrast-pairs.json。
4. **selection 钉值直接定案**（§10.2"先临时撤钉对比"实验取消）：实测 @xyflow/react@12.10.2 dist/style.css:38-39 light 皮肤默认值与 index.css 钉值**逐字节相同**（rgba(0,89,220,0.08)/1px dotted rgba(0,89,220,0.8)）；dark 皮肤（:85-86）为另一组 rgba(200,200,220,*)。裁定=钉值浅档冗余（与皮肤默认重合）、**深档承重**（防 dark 皮肤改写回浅灰蓝）——保留不动+两档断言+注释订正，撤钉往返实验 unnecessary。
5. **videos 路由根岛纳入 D3-videos 范围**（E 表补充）：router.tsx:51-59 的 route 级 `<ConfigProvider darkAlgorithm>` + `<div className="dark">` 整页钉深——不拆则 VideoCard 等 --fw-* 并域在浅档空转（祖先 .dark 把 token 解析回深值）、§3 c7 归因表 videos ×140 边框"方向反转"无从落地。随 D3-videos 域原子对拆除（注释订正同 commit，不留"只改注释不改代码"假档）。
6. **渲染产物白名单路径订正**（§1 非目标）：engine 两文件在 `pages/canvas/engine/`（非 video-editor/engine/）、ThreePreview/Angle3DPreview 在 `pages/canvas/components/Lighting|Angle3D/` 子目录、导出 worker 在 `video-editor/export/worker.ts`（非 renderer/export-worker.ts）——registry 脚本按实测路径取齐。
