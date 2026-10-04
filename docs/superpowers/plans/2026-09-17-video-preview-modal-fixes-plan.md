<!-- doc-status: historical | verified_at: n/a -->
# 视频作品预览弹层五问题修复 Plan（v1.1）

日期：2026-09-17 | Spec：`docs/superpowers/specs/2026-09-17-video-preview-modal-fixes-design.md`（v3.1 已确认）
模式：TDD 红→绿→重构，每批次独立可验证。
v1.2（2026-09-17 第四轮）：FALLBACK export（coverage import 需要）+ 两环链条注释；3b.3 前置断言 `toHaveBeenCalledTimes(0)`（冻结语义正面锚）；批次 4 补 play spy（用例 2/3 进播放态，v1.1 "不进播放态"系事实错误）+"回归信号"降级为注记；批次 6 保留 py-2；R3 加 `cursor: pointer`（UA default 修复，T5 配套）；M2 补触屏模拟检查；M4 补降级路径实测记录项与冻结态观感确认。第四轮审查的 R-1（占位块）与"P4 断裂"指控基于 v3 旧文驳回——spec v3.1 P1 已删占位并写明理由、状态机已裁定"暂停=回预览（冻结）"且非目标旧句已划线。
v1.1（2026-09-17）：吸收三份 plan 审查——R3 选择器去 `:not(.ant-btn)`（特异性 (0,1,1) 反压工具类，三份一致命中，jsdom 测不出仅 M3 可辨）；RF 节点选择器改 `rf__node-<id>` testid（draggable 是 class 非属性）；transform 断言无空格+positionAbsolute 绝对坐标；ring 断言 classList 防子串误判；currentTime 预设 12；3c-1 身份断言补 rerender；3c-3 改断 onPause→onPlayingChange 接线；ProcessView 同款 pl-4 防竞争；coverage 锚改 `VIDEO_WORK_NODE_TYPES`（shared 常量零依赖）；pause spy 删除（组件不调 pause）；M3/M4/M7 口径修正。审查中三处对兜底值的"偏离 spec"指控系基于 v3 旧文（309/400×300 为 v3.1 终值，plan 与 spec 一致）。

## 命令

- 单文件：`pnpm --filter @flowweb/web test -- <关键词>`（vitest 路径过滤）
- 全量：`pnpm --filter @flowweb/web test`
- 类型+构建：`pnpm --filter @flowweb/web build`（含 tsc -b）
- Lint：`pnpm --filter @flowweb/web lint`

## 涉及文件

| 文件 | 改动 |
|---|---|
| `apps/web/src/index.css` | CSS 变量 ×2 + R3 限定 reset |
| `apps/web/src/pages/videos/PlayView.tsx` | 重写（单 video 状态机 + 布局 + 按钮组） |
| `apps/web/src/pages/videos/VideoPlayerModal.tsx` | playing 上提 + CarouselBar 条件 + 壳根属性 |
| `apps/web/src/pages/videos/CarouselBar.tsx` | 卡片尺寸/归一/hover ring + 滚动条隐藏 |
| `apps/web/src/pages/videos/ProcessView.tsx` | 顶栏 pr |
| `apps/web/src/pages/videos/ProcessSnapshot.tsx` | 兜底表 + SimpleNode 满框版式 |
| `__tests__/` 5 个测试文件 | 新断言 + 既有用例适配 |

## 批次 0：基线确认

跑 `pnpm --filter @flowweb/web test -- videos` 确认起点全绿（当前 master 应绿；有红先修基线再开工）。

## 批次 1：ProcessSnapshot（P5a）

**红（ProcessSnapshot.test.tsx 新增）**：
1. `videoEdit 无 height → getByTestId('rf__node-ve1')`（RF v12 自动输出 `data-testid={rf__node-${id}}`，dist:2240；**勿用 `[draggable=false]` 属性选择器**——draggable 是 RF 的 class 非 HTML 属性）wrapper inline style `height: 110px`、`width: 320px`（fixture 加 videoEdit 节点无尺寸）
2. `未知类型（type:'customX'）→ 280×120`
3. **红线断言**：全部 `.react-flow__node` 的 `style.visibility !== 'hidden'` 且 inline width/height 非空（jsdom RO no-op → measured 恒 undefined，钉兜底表穷尽性）
4. coverage：`FALLBACK` 表 key ⊇ `VIDEO_WORK_NODE_TYPES`（`@flowweb/shared` video-work.ts:87-89——注释明确"两侧测试的锚"，**零依赖勿 import CanvasView**，拖进整个画布图）
5. SimpleNode 版式：根含 `w-full h-full`；thumbnail 为 `absolute inset-0`；有 thumbnailUrl 节点存在底部信息条（`bg-black/60`）
6. transform 对齐（T6 判定）：模板为 `translate(${x}px,${y}px)` **逗号后无空格**（dist:2235），用正则 `/translate\(0px,0px\)/`、`/translate\(300px,0px\)/`；⚠️ 取的是 **positionAbsolute**——fixture 中 n3 有 parentId（挂 g1），如断 n3 按绝对坐标写期望
7. 既有 4 用例保持（handles×2 / XSS 字面 / thumbnail img / storyboard 标记）——不动

**绿（ProcessSnapshot.tsx）**：
- 新增 **`export const FALLBACK`**（coverage 测试要 import 键集合——不导出则红在 import；注释"仅测试锚点，勿在别处 import"）终版表（textInput 300×300 / imageGen 548×309 / imageExtGen 548×309 / videoGen 548×309 / audioGen 548×280 / multiImageGen 400×300 / videoEdit 320×110 / group 280×120 / unknown 280×120）——**每行注释出处**（spec P5a 表逐行照搬，含 videoEdit 推导注释）
- coverage 断言处注释**链条关系**：既有 nodeTypes.coverage.test 断 `CanvasView nodeTypes ⊆ VIDEO_WORK_NODE_TYPES`，本处断 `FALLBACK ⊇ VIDEO_WORK_NODE_TYPES`——两环合璧才全覆盖，删任一侧都不红，勿拆
- 节点组装：`width: n.width ?? FALLBACK[type].w, height: n.height ?? FALLBACK[type].h`
- SimpleNode：根 `w-full h-full box-border overflow-hidden relative rounded-lg border border-white/15 bg-[#1e1e1e]`；缩略图 `absolute inset-0 h-full w-full object-cover`；底部信息条 `absolute bottom-0 inset-x-0 bg-black/60 px-2.5 py-1.5`（label + content/prompt line-clamp-2）；无缩略图同构（信息条贴底）
- GroupFrame 不动

**验证**：`pnpm --filter @flowweb/web test -- ProcessSnapshot` 全绿。

## 批次 2：index.css（基础样式）

- `:root`：`--vw-close-reserve: 108px; --vw-carousel-reserve: 125px;` 注释：**值必须显式带 px**（裸数字经 var() 是无效声明、jsdom 测不出）；--vw-carousel-reserve 待 M2 实测回填
- R3（终版）：`:where([data-vw-shell]) button { border: 0; padding: 0; cursor: pointer; }`——**勿加 `:not(.ant-btn)`**：`:not()` 参数特异性 (0,1,0) 计入 → 整条 (0,1,1) 反压全部 Tailwind 工具类 (0,1,0)（px-5/px-3/py-1.5 全被清零，jsdom 类名断言测不出、仅 M3 目视可辨；构建产物无 @layer、工具类靠特异性取胜是唯一防线）。antd 按钮（.ant-btn / .ant-modal-close 均 (0,1,0) 类选择器）本来就赢 (0,0,1)，无需排除。`cursor: pointer`：preflight 关闭下 button UA cursor 为 default，与 T5 hover-only 配套的可点信号（computed 无单测抓手，M3 目视）
> 【已废止 2026-09-19】preflight 关闭前提已被 docs/superpowers/specs/2026-09-18-css-base-layer-theme-design.md 推翻并重开（A 段落地，base 层已兜底 button cursor:pointer）；本条仅存历史档。
- 无独立测试（后续组件类名断言覆盖）。

## 批次 3：PlayView（P1/P3/P4 核心，最大批次）

**红 3a —— 既有用例适配（先修脚手架）**：
- `renderPlay` 补 `playing = false` / `onPlayingChange = vi.fn()` 两个 prop（漏则 TS 红）
- 文件级 harness：`beforeEach` 加 `vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)`（FilePreviewPopover.test.tsx:42 先例；**只需 play——组件从不调 pause()，pause spy 是死代码**）
- `:72` 用例改造：删 `fireEvent.click(立即观看)`（idle 态已有 video——恒渲染）；直接 `fireEvent.error(getByTestId('video'))`

**红 3b —— P1 预播断言**（新增 describe）：
1. 预览态：`video.muted === true`（property！React mustUseProperty，禁 toHaveAttribute('muted')）；`toHaveAttribute('loop')`、`toHaveAttribute('autoPlay')`、`toHaveAttribute('playsInline')`；`not.toHaveAttribute('controls')`
2. poster：fixture `coverUrl: '/flowai/c.jpg'` → `toHaveAttribute('poster', ...)`
3. canPlay 一次性：**前置 `expect(playSpy).toHaveBeenCalledTimes(0)`**（挂载后、canPlay 前——"冻结语义"正面锚：实现若回退成"预览分支也 play"前置即红）→ `fireEvent.canPlay(video)` → 1 次；再 canPlay → 仍 1 次

**红 3c —— P4 断言**：
1. 点击"立即观看" → `onPlayingChange` 调 true；**身份断言须 rerender 驱动**（playing 是 prop，点击只翻 props 不自重渲）：`const v = getByTestId('video'); fireEvent.click(...); rerender(<PlayView playing .../>); expect(getByTestId('video')).toBe(v)`；`video.muted === false`；`toHaveAttribute('controls')`；src 未变
2. 降级：play spy `mockRejectedValueOnce` → playing=true rerender 后 `muted === true` + `await screen.findByText(/音量/)`
3. 暂停回落（playing=true 态）：`fireEvent.pause(video)` → **断 `onPlayingChange` 以 false 被调**（钉 onPause 漏接——只靠 rerender 的话漏接不红）→ rerender playing=false 后 ③④ 回归、`muted === true`、play spy 调用数不变（**冻结语义**：预览分支只静音不播，防"暂停=立刻静音续播"复活——承重注释）
4. `video.currentTime = 12`（**jsdom currentTime 是普通属性初值 0，不预设则断言恒过**）→ `fireEvent.ended(video)` → `onPlayingChange(false)` 被调 + `currentTime === 0` + rerender 后 ③④ 回归

**红 3d —— P3/UI 断言**：
1. 按钮组：次要三钮 `bg-[#2f2f2f] text-white` + 全部 `border-none`；喜欢钮 `w-auto`
2. 布局：③④ 区块外层 `pointer-events-auto` + 渐变遮罩类 `bg-gradient-to-t from-black/70`；UI 列容器 `pointer-events-none`；④ 容器 `pb-[var(--vw-carousel-reserve)]`
3. 顶栏：`pl-4 md:pl-8 pr-[var(--vw-close-reserve)]`（断 `md:pl-8` 存在、`md:px-8` 不存在——防 P0-2 复活）
4. 播放态（rerender playing=true）：③④ `not.toBeInTheDocument()`（desc-panel + 按钮组）

**绿（PlayView.tsx 重写要点）**：
- Props 增 `playing: boolean; onPlayingChange: (v: boolean) => void`
- JSX 结构（spec 布局总图）：`<video>` absolute inset-0（`muted={!playing} loop={!playing} autoPlay playsInline controls={playing} poster src onError onCanPlay(一次性 ref) onPause onEnded(currentTime=0)`）+ UI 列（`relative z-10 flex-1 min-h-0 flex flex-col pointer-events-none`：顶栏 auto / flex-1 / ③④ 区块 auto+遮罩+pb）
- effect（spec v3.1 完整形态）：`!playing` → **只 `el.muted = true` 不 play**（冻结语义：暂停/播完回落后停在帧上，防"暂停=立刻静音续播"）；`playing` → unmute + `play()?.catch(...)`（catch 内 `el.muted = true` + `message.warning`，注释"唯一 imperative 覆写点"）
- **禁读 `el.paused` / `el.ended` 做分支**（jsdom 恒 true/false 与真机分叉，单测会与浏览器行为脱节）；一次性 ref `previewPlayTriedRef` 承重注释：保证用户暂停回预览后 stall/seek 触发的 canplay 不偷偷续播——非降噪冗余，勿删
- 保留：onLike/onShare 逻辑、desc-panel data-testid、含 AI 生成内容、retriedRef 自愈（自愈后 `onPlayingChange(false)`）
- 删除：playing 内部 state、条件渲染双分支

**验证**：`pnpm --filter @flowweb/web test -- PlayView` 全绿。

## 批次 4：VideoPlayerModal（P5b + 裁定 A 外壳）

**红（VideoPlayerModal.test.tsx 新增 describe；fixture 需 canViewProcess:true 版）**：
1. process 视图（点"查看制作过程"）→ `queryByTestId('carousel')` 为 null；返回 play → 恢复
2. 播放态（点"立即观看"）→ carousel 为 null；`fireEvent.pause(video)` → 轮播恢复
3. 播放态下 `router.navigate('/videos/w2')` → 轮播恢复（钉外壳 id-effect `setPlaying(false)` 复位——漏则停在无轮播伪播放态）
4. 壳根 `data-vw-shell` 属性 + `[color-scheme:dark]` 类断言
- 注意：**本文件 beforeEach 也加 play spy（与 3a 同款）**——用例 2/3 会点"立即观看"进播放态，effect playing 分支直调 play() → jsdom notImplemented 打 console 噪音（不红，`?.` 挡住；spy 使输出干净）。注记：真正的防回退断言是 3c-3 的"play 调用数不变"，噪音不是失败信号（vite.config test 块无 virtualConsole 配置、vitest 只打印）

**绿（VideoPlayerModal.tsx）**：
- `const [playing, setPlaying] = useState(false)`；id effect（:31 处）补 `setPlaying(false)`
- PlayView 传 `playing={playing} onPlayingChange={setPlaying}`
- CarouselBar 条件：`view === 'play' && !playing && <CarouselBar .../>`
- 壳根 div（:57）加 `data-vw-shell` + `[color-scheme:dark]` 类

**验证**：`pnpm --filter @flowweb/web test -- VideoPlayerModal route.integration` 全绿（route.integration 渲染链受 PlayView props 影响——3a 已适配则应绿）。

## 批次 5：CarouselBar（P2）

**红（CarouselBar.test.tsx）**：
- 卡片按钮类：`w-[180px] aspect-video rounded-lg border-0 p-0` + hover ring（**断法防子串误判**：`classList.contains('ring-1') === false` 且 `contains('hover:ring-1') === true`——`not.toContain('ring-1')` 会误伤含 `hover:ring-1` 的正确实现）
- img：`absolute inset-0 h-full w-full object-cover`
- 轮播条容器：`[scrollbar-width:none]` + `[&::-webkit-scrollbar]:hidden`（Tailwind 任意变体写伪元素——jsdom 可断类存在，免 index.css 加规则；真实生效走 M2 实测）

**绿（CarouselBar.tsx）**：按断言实现；img 与兜底 div 同构。

**验证**：`pnpm --filter @flowweb/web test -- CarouselBar` 全绿。

## 批次 6：ProcessView（P5c）

**红（ProcessView.test.tsx）**：顶栏容器含 `pl-4` + `pr-[var(--vw-close-reserve)]`，且**不含 `px-4`**（同 PlayView 的 P0-2 防复活口径——px-4 与 pr-* 同特异性竞争输出序，勿赌，直接消除竞争）。
**绿**：ProcessView.tsx:44 顶栏 `px-4 py-2` → `pl-4 pr-[var(--vw-close-reserve)] py-2`（**保留 py-2**——只动横轴）。
**验证**：`pnpm --filter @flowweb/web test -- ProcessView` 全绿。

## 批次 7：全量回归

1. `pnpm --filter @flowweb/web test` —— 全绿
2. `pnpm --filter @flowweb/web build` —— tsc -b + vite build 通过
3. `pnpm --filter @flowweb/web lint` —— 无新增告警
- 任一红 → 修复后重跑（禁止跳过）。

## 批次 8：浏览器手工验收 M1-M7（preview 工具，http://localhost:5173）

按 spec 执行（服务已运行；未运行则 `preview_start web/api`）：

| # | 步骤 | 通过标准 |
|---|---|---|
| M1 | 直链 `/videos/cmu3m2smo000013gukdo4zrzq` | 1s 内画面出现、循环、无声、无 controls |
| M2 | 轮播条 inspect | 卡片 rect ≈180×101.25；computed padding/border=0；**实测轮播条 offsetHeight 回填 `--vw-carousel-reserve`**；深色帧 hover ring 可见；**触屏模拟（DevTools 设备模式无 hover）卡片仍有可辨轮廓**（T5 hover-only 代价项） |
| M3 | 按钮组 inspect/screenshot | 贴底轮播上方、`#2f2f2f` 实底白字、无边框且 **padding 未被 R3 清零**（:not 版特异性事故的唯一直观暴露点）；亮素材遮罩可读；**打开登录框（未登录点赞）antd 按钮与 antd Modal 关闭钮 padding/边框正常** |
| M4 | 点"立即观看" | 有声续播 currentTime 不归零；**点击 controls 全屏按钮**正常退出；控制条深色、进度可拖；**暂停 → 回预览停在当前帧（v3.1 裁定行为，非 bug；观感确认冻结帧可识别，非"卡住"误判）**；播完 → 回预览首帧；**降级路径实测记录**：若 unmute 被拒且 Chrome 主动 pause 派发 → 回预览+提示（与 spec"保持 muted 播放"措辞可能不一致，实测后回写 spec） |
| M5 | 查看制作过程 | 持久化节点 548×308 框还原；Handle 贴边；videoEdit 不塌（88-140）；无首帧闪烁；与原画布并排比对相对位置 |
| M6 | 两视图顶栏 | 窄/宽窗"复制项目/发布于"与关闭钮不重叠；DevTools 看 padding-right 胜出规则 = pr-[var(--vw-close-reserve)] |
| M7 | videoUrl 404（可临时改 mock 或用已删对象） | onError 自愈只触发一次、回预览态不黑屏循环报错；自愈起播依赖换 src 时 autoplay flag 重新评估——**实测不起播则在 videoUrl 变化路径补一次显式 play()**（M7 实测定夺） |

M2 回填后：改 `index.css` 变量值 → 复跑批次 7 全量（常量变更回归）。

## 完成标准

- 批次 0-7 全绿 + 批次 8 M1-M7 全过
- spec 五问题验收全部满足；M2 回填闭环
- 最终 `git status` 只含 plan 内文件变更

## 风险登记

- PlayView props 变更波及 VideoPlayerModal.test/route.integration 渲染链 → 批次 3a 先行适配、批次 4/7 复验
- jsdom 不派发 canplay/pause/ended —— 全部 fireEvent 显式触发（harness 位置见 3a）
- RF v12 jsdom 下 measured 恒 undefined —— 兜底表断言因此反而更硬（visibility 永久态）
- 长文档写入分多次（Write+Edit 追加）
- live-store 安全红线不适用（本任务无 store 写路径）；浏览器验收操作仅 UI 交互 + 只读 inspect

