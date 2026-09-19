# 画布域主题跟随设计（C8）spec v1.0

- 日期：2026-09-20
- 状态：待评审
- 关联：`2026-09-18-css-base-layer-theme-design.md`（v1.9，本 spec 是其画布域解封续篇）、c5-portal-census.json、c7-accepted-items.md、b6-acceptance.md、domain-token-adjudication-B0.json、b2-migration-registry.json
- 需求来源：用户提出「Canvas 画布页面的节点卡、悬浮工具条、底部面板、画布颜色等元素跟随主题（浅色下变浅）；主题只分浅色/深色两档，无跟随系统，默认深色」；两轮架构审核修订 + 用户 8 项产品裁定。

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
- WebGL/渲染产物文件：`video-editor/renderer/canvas-renderer.ts`、`engine/Angle3DEngine.ts`、`Lighting/**`——技术性不可迁移，白名单保留（含其 JS 通道 #000/#FFF 经 VideoEditNode.tsx:129 复用到画板 mini 播放器的链路，c3-js-channel-census.json 补登）。
- 跨设备主题同步（无产品需求，将来 user-preferences 字段，与本期解耦）。

## 2. 产品裁定登记（P 表）

| # | 裁定 | 内容 |
|---|---|---|
| P1 | 主题两态 | 仅 light/dark，默认 dark，无跟随系统。产品理由（用户裁定）+ 技术理由：跟随域从 3 处扩到 80+ 处后，OS 运行时翻转触发 React Flow/ve/antd 大面积重绘，且 antd cssinjs 与 CSS 变量双通道非原子（晚一帧），可视频闪面积显著变大 |
| P2 | 板底/点色 | 浅色板底 `#F5F5F5`、网格点 `#C8C8C8`（用户指定底值 + 对比度校准点值：#DCDCDC@#F5F5F5 仅 1.26:1，比深色档 2.82:1 淡一半以上）；深色维持 `#000000`/`#555555` |
| P3 | 播放壳跟随 | VideoPlayerModal/PlayView 翻浅（不采用"媒体查看器恒深"备选）。三项连带承诺：① 删 `[color-scheme:dark]`（含 VideoPlayerModal.test.tsx:168-173 断言）② scrim/黑渐隐/白字浮层全部双值化 ③ 画布内 ImageFullscreenViewer/VideoFullscreenViewer 一并跟随（杜绝同类两制）。媒体画面区本身不套色 |
| P4 | VideoEditNode | 跟随主题：深色档从白卡变深卡。有意视觉变更，登记 differExpectedPairs + B6 目检；浅色档与其他节点卡一致 |
| P5 | CreditsDropdown | 浅色重做（不为黑卡找浅色借口，出浅色稿重设计；实现期用 ui-ux-pro-max）。深色档保持现状（值等价）；有意变更登记 differExpectedPairs |
| P6 | 媒体承载裁定 | 通则：**内容承载面（user content）恒深（值域定值，非岛）；工作 chrome 跟随主题**。含：节点卡内媒体底、视频/图片画面垫底、clip 块面、用户自设色（标注调色板 #FF0000/#FFD700/#0066FF、selectionTokens、字幕字色、StoryboardCell 语义色）。措辞用"内容色不随主题"，不用"图片视频底保持深色" |
| P7 | 岛原子性通则 | 凡留深子树，面/前景/边框必须一起钉（.dark 类或全字面）；**禁止"面钉深、前景走 token"**——现状反例：CanvasTopBar 药丸 bg-[#1A1A1A]/90 配 CreditsDropdown 触发钮 text-text，html.light 下对比度 ≈1.1–1.2:1 不可读 |
| P8 | system 残留 | localStorage 残留 `'system'` 仅读取侧映射为 dark，**不回写**（保持 boot 不写盘契约）；登记已知接受项（开发期无用户数据，影响为零） |

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
| video-editor 原始亮色规格 | video-editor.md:289 | **复活**：背景 #F7F8FA/面板白/紫 #6C5CE7 与 --fw-bg/--fw-surface 浅值逐字相同，作为 ve 浅色档验收依据；:291 废止注同步改 |
| router.tsx:48-50 注释（画布壳跟随、画板恒黑已钉） | router.tsx | 订正（板跟随主题） |

## 4. 术语与四通道分类法

B2 三通道扩展为四通道（第四条为通道语义，非迁移目标）：

1. **token 通道**：硬编码色 → `--fw-*` 语义 token（多数）。
2. **品牌/内容字面通道**：两主题一致的恒定视觉——品牌色 `#6C5CE7`（--ve-accent 域主，**禁止并入 --fw-accent #4ade80**）、`#5DDCFF`；用户自设色（P6）；入字面白名单。
3. **双主题中性字面通道**：scrim/阴影/棋盘格/hydrate 遮罩（`bg-black/50` page.tsx:313、`bg-black/60` BaseFullscreenModal.tsx:70 等）——两主题下都正确，**明文禁止 token 化**（P3 承诺②的 scrim 双值化仅指播放壳叠画面上的黑渐隐/白字控件族，中性遮罩仍走本通道）。
4. **内容承载面通道**：媒体画面垫底/clip 块面——值域恒深深值（非岛、非 token），消费点直改局部定值。

## 5. 范围口径（脚本产出清单，验收按键核销）

手写数字一律不作验收依据。D3 开工前由 O6 式脚本产出 `e2e/audit/canvas-migration-registry.json`（镜像 b2-migration-registry.json 结构，含排除集），口径：

- **画布域**：`pages/canvas/**` 排除 `video-editor/**`、排除白名单（§1 非目标）——审核实测含色字面 76 文件，加域外画布可达 13（MaterialLibrary 11 + History 2 + BaseFullscreenModal 1）≈ 79+；
- **ve 域**：`pages/canvas/video-editor/**` 53 源文件中含色字面 9，减白名单 renderer = **8 在范围**（--ve-* token 化红利，全量 77 文件中仅 8 个带字面）；
- **videos 域**：`pages/videos/**` 7 源文件**全含色字面**（含 text-white 等 utility 命中，非仅 hex）；
- **域外单件**：WeChatFollowModal（components/layout/）、CreditsDropdown（pages/canvas/components/，52 处色字面/27 值）；
- **手写 CSS 块**：index.css `.tiptap-content` 10 处 + `.editor-scroll` 3 处 + `body{background:#141414}` 1 处（改 `var(--fw-bg)` 深色档字节等值）、`components/nodes/prompt-input/PromptInput.css` 28 处、`NodeHandle.css` 1 处；
- **配置**：tailwind.config.ts（如需 colors 映射）、eslint no-theme-utility 白名单（§10.3）。

## 6. D0-0 仪器先行（新增段，零产品改动）

「深色档零 diff」现有仪器不可判：a0 采集器冻结集**无 backgroundColor、color 仅表单控件**（a0-collect-baseline.spec.ts:105-137）；b1 探针仅 /works 4 + /canvas 2（都在 CanvasTopBar，画板子树 0 条）；videos/ve 域 0 条（b1 文件头 :15-17 明示）。

**动作**：
1. 扩展 a0 采集器：全元素冻结 `backgroundColor` + `color`（color 不再限于 FORM_CONTROL）。
2. 在改动前 HEAD 采 **before-D 基线**（8 页）——唯一时间窗，错过不可补；与 fixture（gate-canvas-1/gate-node-1/A0-0 样例视频）同 PR 锁定。
3. 新增 D 段探针族（b1 同构，先钉当前深值）：画板 wrapper 底/dot 色、节点卡底、CanvasTopBar 药丸内前景、videos 卡面/播放壳面、ve 壳底/面板/轨道面/预览垫底、WeChatFollowModal 面与前景。
4. 验收：D0-0 自身零产品改动、before-D 入档、探针全绿（钉深值）。

## 7. D0 themeStore 两态化

**六件套**（原四件套 + App.tsx + CanvasTopBar）：

1. `themeStore.ts`：`ThemeMode = 'light' | 'dark'`；state 收敛单值 `mode`（`resolved` 概念随 system 档消亡）；删 `MEDIA_QUERY`/`resolveSystem`/`onMediaChange`/matchMedia addEventListener；`readStoredMode` 合法值收敛两态，`'system'` 走非法回落 dark（P8：不回写）；`initThemeSync` 懒初始化保留。
2. `App.tsx:10`：`const { resolved }` → `const { mode }`，algorithm 由 mode 派生。**DOM 类 / antd algorithm / ReactFlow colorMode 三处必须同源由 mode 推导**。
3. `index.html:9-20` 防闪白脚本：删 matchMedia 分支，两态口径与 readStoredMode 同构。
4. `TopActionBar.tsx:16-20`：THEME_CYCLE 三态 Record → 两态；与 CanvasTopBar 新钮**抽共享 ThemeToggleButton**（共享 label/aria 常量，G7 按 aria-label 锚定，防两处漂移）。
5. `CanvasTopBar.tsx`：新增主题切换钮（共享组件）。
6. 测试：`themeStore.test.ts` system 用例改写（约 7 处）；`matchMediaMock.ts` 删除（**它是孤儿文件，无任何 import 方**——themeStore.test.ts 用内联 loadStore()，勿找不存在的 import）。

**c0 e2e 同步**（G 编号见 §11 全景）：G1 删 2 条 system 例；G2 静态判别式（:183 `/theme/&&/localStorage/&&/matchMedia/`）换为「含 theme/localStorage、**不含** matchMedia」（顺带成为"无 system 档"的机械断言）；G3 system live flip（:208-226）改写为「OS 偏好零影响 + matchMedia 调用计数 0」；G7 三态循环（:398-443）改两态往返。

**验收**：两态 DOM 类断言；`'system'` 存储 → mode=dark；matchMedia 零调用；D 段探针与 before-D 零 diff（此段无视觉变更）。

## 8. D1a 定义层双值化（零消费点改动，深色档天然零 diff）

铁律：**D1a 只搬定义不改消费点；重构与有意视觉变更不得同 commit**（differ 信号保全）。

### 8.1 域 token 原地双值化

`--canvas-controls-*`/`--canvas-handle-*`/`--edge-*`/`--vw-card-*`/`--ve-*` 从裸 `:root` 块搬进 `:root,.dark` + `.light` 两块（遵守 D8 源序，纳入 B1 断言族）；几何 px token（`--vw-close-reserve` 等）留 `:root` 不动。

| 键 | 深值（冻结） | 浅值（首定） | 备注 |
|---|---|---|---|
| `--canvas-board-bg`（新增） | `#000000` | `#F5F5F5` | P2；域名前缀（--fw-=语义层纪律，不占用）；消费形式 `bg-[var(--canvas-board-bg)]` 任意值 var（斜杠禁令不涉） |
| `--canvas-board-dot`（新增） | `#555555` | `#C8C8C8` | P2；`<Background color="var(--canvas-board-dot)">`（xyflow 写内联 `--xy-background-pattern-color-props`，CSS var 代换——D2 像素 diff 实证） |
| `--canvas-controls-bg` | `rgb(38,38,38)` | 浅档（D1b 并域定） | |
| `--canvas-controls-border` | `rgb(54,54,54)` | 浅档（D1b） | |
| `--canvas-controls-text` | `rgb(247,247,247)` | `--fw-text-strong` 浅值 | |
| `--canvas-controls-hover` | `rgba(255,255,255,.08)` | 浅档（D1b） | |
| `--canvas-controls-active` | — | — | **死 token（0 消费）直接删** |
| `--canvas-handle-hover-bg` | `#FFFFFF` | **反向深色系**（白卡上消失） | 点名登记 |
| `--edge-highlight-color` | `#999` | 浅档重校（浅底偏淡） | |
| `--canvas-shadow-menu/dropdown` | 现值 | 浅档重校（黑阴影浅底外观全变） | neverMerge 重裁定，登记 |
| `--ve-bg/--ve-panel/--ve-border/--ve-text` | 现值 | `--fw-bg/--fw-surface-dim/--fw-border/--fw-text` 浅值（video-editor.md:289 原始亮色规格背书） | |
| `--ve-text-dim` | `rgba(226,232,240,.6)` | 浅档（色相独立于 dim 阶梯，D1b 裁定） | |
| `--ve-accent` | `#6C5CE7` | `#6C5CE7` | 品牌**保留域 token 双主题同值**，禁并入 --fw-accent |
| `--ve-text-control` | — | — | **死 token（0 消费）直接删**（--ve-panel:99/:100/:103 三条 var 间接链随 D1b 删除） |
| `--vw-card-bg/--vw-card-border(-hover)` | 现值 | 浅档（D1b） | 卡面是 chrome（缩略图区才是内容承载，由缩略图自担） |

### 8.2 ve 域共享 token 拆分（媒体/chrome 二分的前提）

`--ve-panel`/`--ve-bg`/`--ve-border` 现同时承担 chrome 与时间轴/预览媒体语义（EditorTopBar:21、AssetPanel:55、PropertiesPanel:74,81 ↔ TrackRow:33,53、TimelineRuler:47,55、TimelinePanel:292,307、PreviewPlayer:64,79、AssetPanel:111,144,184）。术语收紧：**clip 块面恒深（内容）；轨道行底/标尺跟随（chrome）**。

- `--ve-track-video: #1f1f1f` = clip 块面（内容承载）→ **单值恒深保留**（不进双块）。
- D1a 产出拆分表：chrome 侧消费点留双值化 token；媒体侧（预览垫底/缩略占位框/标尺刻度若判内容）拆独立恒值 token 或局部字面；约 10 处消费点调整（TrackRow×2、TimelineRuler×2、TimelinePanel×2、PreviewPlayer×1、AssetPanel×3）。ClipBlock.tsx:28 波形 rgba(255,255,255,.7) 落 clip 内 → 恒深成立不动。

### 8.3 手写 CSS 块

`.tiptap-content` 10 处、`.editor-scroll` 3 处、`body{background:#141414}`（→`var(--fw-bg)`，深档字节等值）、PromptInput.css 28 处、NodeHandle.css 1 处——全部双值化（消费者是画布文本节点/prompt-input，浅色下文字不可读是本期要修的洞）。

**D1a 验收**：深色档 0 diff（仪器 = before-D + D 段探针）；浅色档新增值可读（AA 对比度表，@#FFFFFF 卡面与 @#F5F5F5 板面双底实测，延续 B0"每 token 附对比度记录"惯例；含 --ve-accent #6C5CE7 深底 3.84:1（现状已低于 AA，登记）/白底 4.79:1）。

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
| `--ve-track-video: #1f1f1f` | 无 | — | 2 | 独立恒深键（内容承载） |

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

**验收**：深色档像素 diff = 0；--xy-* 复测表逐属性登记；镜像断言绿。

## 11. D3 全量迁移（按域原子对：翻实现+翻断言同 commit）

### 11.1 执行规范

- **原子对**：每域/每岛拆除与断言反转同 commit；D4 只留岛消亡后的新回归 + 全门禁（段间独立验收，spec v1.9 :125 规矩）。
- **baseline 重键不重采**：no-color-hex 键 = `ruleId|路径|sha256(TrimEnd(行文本))`，迁移换键后**同文件 hex 键计数不增**（lint-gate.mjs:139 口径"允许伴随重键"）；白名单文件键保留。**禁 UPDATE_BASELINE=1 重采**（B5 控制动静）。
- **两条门禁机制分开写验收**：hex 门禁 = "键数不增（允许行文本重键）"；no-theme-utility 门禁 = "白名单净减 3 条目录 + 净增 K 条精确文件"（该规则零基线，任何命中即违例，重采不豁免——lint-gate.mjs:120）。
- **媒体容器自持底色 checklist**（机械检查项，非目检）：grep 卡内 `<img|<video>` 祖先链，每个媒体容器自持深底（透明 PNG/未加载图/poster 未到时不得露浅底）。
- **浅底重校清单**：OutpaintSelectionOverlay `bg-white/30` 网格线（落媒体上→第四通道保留字面）；透明 PNG 棋盘格/涂抹蒙版/裁剪遮罩逐个裁定"贴媒体 or 贴卡壳"；NodePalette（#0f0f0f/#e0e0e0/#f7f7f7）、ProjectTitle（#1A1A1A）——后两者在 PAGE_REGISTRY_FILES（css-baseline-diff.mjs:56-60），改动同步那张映射表。

### 11.2 专项裁定

| 专项 | 处理 |
|---|---|
| VideoEditNode | P4：跟随主题变深卡（bg-surface/text-text 等 token 化）；有意变更进 differExpectedPairs + 目检；:129 mini 播放器 JS 通道色（复用 canvas-renderer #000/#FFF）登记 c3 census 不可迁移 |
| CreditsDropdown | P5：浅色重做（ui-ux-pro-max 出浅色稿）；深色档现状冻结；黑卡渐变/glow 52 处字面随稿替换；药丸宿主（CanvasTopBar :147）同步 chrome 化结案 P7 反例 |
| 播放壳（P3） | VideoPlayerModal 壳根 `dark bg-black text-white [color-scheme:dark]` → 跟随（删 dark 类与 color-scheme:dark，垫底/浮层/轮播 chrome 全套 token 化，叠画面 scrim 双值化）；PlayView/ProcessView/ProcessSnapshot/VideoCard/CarouselBar 随域迁移；VideoPlayerModal.test.tsx:168-173 断言同步 |
| 画布全屏查看器 | ImageFullscreenViewer/VideoFullscreenViewer 跟随（P3 承诺③），与播放壳同 commit 原子对 |
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
| e2e | c0 G7 三态（:398-443）+ /videos 叙事（:379,:445） | 两态化；videos 叙事改跟随 |
| e2e | c0 G8①②③（:507-579） | ①②反转；③双岛论断消亡重写 |
| e2e | a0 探针 ×4（:200,:220,:221,:250） | 3 条反转（videos #262626、画板 wrapper、ve 壳 rgb(20,20,20)）；canvas html 根 #f7f8fa 保持 |
| e2e | a0 叙事注释（:15-18,:303,:305） | 重写 |
| 单测 | CanvasView.test.tsx:90-100 | 镜像断言 |
| 单测 | videos 域 8 处 class 断言（VideoPlayerModal.test:168-173、PlayView.test:193-225、ProcessView.test:50-61、ProcessSnapshot.test:96、CarouselBar.test:79-80） | 随实现改 |
| 单测 | ve TimelinePanel.render.test:115-131 | **不动**（clip 类型色属内容语义） |
| 登记档 | c7-accepted-items §1 #1/2/3/7、§3 归因、§2#8 | E 表所列 |
| 登记档 | c5-portal-census / c3-js-channel-census / domain-token-adjudication-B0 / b2-migration-registry / b6-acceptance:61,:71,:74 | E 表所列 + 补登 |
| spec | video-editor.md:289/:291 | 复活/改注 |
| 注释 | router.tsx:48-50、CanvasView.tsx:378、index.css:210-211、tailwind.config.ts:9-10 | 订正 |

### 12.3 D4 全门禁

C0（改造后新形态全绿）、vitest 全绿、lint 双规则、css-audit 斜杠/differ exit 0、D8 电池、浅色 B6 真实对照（画布+ve+videos+弹层全景）、性能观感实测一次（低端机切换闪烁，双通道非原子面积变大——spec v1.9 :202 已知项扩面登记）。

## 13. 已知接受项与风险登记

1. `'system'` 残留用户一次性回落深色（P8，开发期无用户数据影响为零）。
2. antd cssinjs 晚一帧的切换瞬时不一致面积变大（ve/videos/canvas 三域同帧重渲染）——D4 实测留档。
3. --ve-accent #6C5CE7 深底 3.84:1 现状已低于 AA（本就不及格，非本期引入）；浅色白底 4.79:1 达标。
4. VideoEditNode 深色档白→深、CreditsDropdown 浅色重做、#363636→#333 等 Δ3 级收敛——全部登记 differExpectedPairs，属有意变更非回归。

## 14. 后端零改动声明

apps/api/src 下 theme/prefers-color-scheme/darkAlgorithm/#141414 全部 0 命中；后端不产出 HTML（无 res.render/模板）；主题仅存 localStorage，无用户偏好表/接口——无迁移、无兼容窗口、无缓存失效面。fixture 改动（浅色对照补种）与 before-D 基线同 PR 锁定。

## 15. 执行顺序与段验收汇总

D0-0（仪器/before-D/探针钉深）→ D0（两态六件套+G 门禁改写，零视觉变更）→ D1a（定义层双值化+ve 拆分+手写 CSS，深档 0 diff）→ D1b（并域冲突表+AssetPanel/WeChatFollowModal 原子对+白名单手术）→ D2（colorMode 翻转+板面三机制对账+镜像断言）→ D3（registry 清单逐域原子对迁移，含四个专项）→ D4（断言矩阵新形态+全域反转清单核销+全门禁）。

**D1 必须先于 D2**：wrapper 的 .dark 类是 D1 期间画板子树的实际值域（先翻 colorMode 则画板在 D1 未完成时取浅值立刻坏）。
