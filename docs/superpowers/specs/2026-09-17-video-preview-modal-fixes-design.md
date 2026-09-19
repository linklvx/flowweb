# 视频作品预览弹层五问题修复 Spec（v3.1）

日期：2026-09-17
- v2/v3：两轮审查吸收（含 P0×2：controls 不可点 / md:px-8 压 pr；节点 visibility:hidden 红线）。
- v3.1：第三轮三份审查——删占位块（三份一致指出自吞缺陷）、暂停出口自洽方案（重构 effect：预览分支不再程序化 play）、兜底表终版（源码实算 309，第三份 308 为手算 Math.round(562.5)=563 之误）、视频盒恒 inset-0（消灭 reserve 切换与跳变）、imageExtGen=ImageGenNode 直通包装。核验记录见文末。

范围：`apps/web/src/pages/videos/` 全部 5 文件 + `apps/web/src/index.css`（CSS 变量 + R3 限定 reset）。

> 【已废止 2026-09-19】下表"preflight:false 下 UA border/padding 失真几何"前提已被 docs/superpowers/specs/2026-09-18-css-base-layer-theme-design.md 推翻并重开（A 段落地）；本文相关表述仅存历史档。

## 根因总表（浏览器实测 + 源码核验）

| # | 问题 | 根因 |
|---|---|---|
| P1 | 预览黑屏 | 未点击前不渲染 `<video>` |
| P2 | 轮播卡片小 | `w-[110px]`；preflight:false 下 UA border/padding 失真几何 |
| P3 | 按钮组 | 垂直居中、半透明毛玻璃、UA 边框（无 button reset） |
| P4 | 播放异常 | **双根因**：① unmuted autoPlay 被策略拒 → paused 黑屏；② 轮播条 absolute bottom-0 z-10 盖住 video controls 底栏（今天就存在：视频盒满高，controls 落在轮播 ~103px 带内） |
| P5 | 画布预览 | SimpleNode 固定 `w-[160px]` ≠ wrapper 尺寸；多数生成类节点快照无持久化尺寸（见 P5a 定性）；CarouselBar 无条件渲染；顶栏与关闭钮重叠双处 |

## 布局总图（v3.1）

```
壳（VideoPlayerModal.tsx:57 壳根 div）加 data-vw-shell [color-scheme:dark]
├─ <video>（PlayView 内）absolute inset-0 object-contain —— **恒铺满，无 bottom reserve 切换**
│    · 播放态轮播隐藏 + UI 列穿透 → controls 落视口底边可点（P0-1 由裁定 A 保障，无需视频盒让位）
│    · 预览态底部由 ③④+轮播覆盖（无 controls，无需点视频）
├─ UI 列容器 relative z-10 flex-1 min-h-0 flex flex-col pointer-events-none
│  ① 顶栏（交互 auto）pl-4 md:pl-8 pr-[var(--vw-close-reserve)]
│  ② flex-1 弹性空区（穿透）
│  ③④ 预览态区块（**整块交互 auto**——简介文本可选中，v3"不可选"口径反转）
│     外包 bg-gradient-to-t from-black/70 to-transparent
│     ④ 容器 pb-[var(--vw-carousel-reserve)]（仅预览态成立）
└─ CarouselBar 渲染条件：view === 'play' && !playing（裁定 A）
     scrollbar-width:none + ::-webkit-scrollbar{display:none}（T3）
```

**playing 上提外壳**：PlayView 增 `playing` / `onPlayingChange` props；VideoPlayerModal 持有 state，id 变化 effect 补 `setPlaying(false)`。

**状态机（v3.1 自洽闭环；预览有两个子状态——"恒循环预播"与"暂停即回预览"不可兼得，已裁定取后者）**：
- **预览-初始**：静音循环播放（`muted` 属性 + `autoPlay`；被拒则 `onCanPlay` 一次性兜底，`previewPlayTriedRef` 防后续 canplay 抢播）。M1 的"循环"仅指本子状态。
- 点击"立即观看" → `onPlayingChange(true)` → effect unmute + play()（手势内）。
- **暂停 = 回预览（回落子状态）**：`onPause` → `onPlayingChange(false)`（③④ 回归，视频**冻结在当前帧**，不被自动续播——effect 预览分支只 muted 不 play，消灭"按暂停又被 effect 掀起"与"程序化 play 无手势被拒"两条死路）。
- **播完 = 回预览（回落子状态）**：`onEnded` → `onPlayingChange(false)` + `el.currentTime = 0`（冻结在 poster/首帧）。
- 再点"立即观看"：从当前帧（暂停）或 0（播完）有声续播。
- 降级：unmute 后 play 被拒 → catch 里 `el.muted = true` + `message.warning('浏览器阻止了自动播放声音，请点击播放器音量图标')`（**唯一允许的 imperative muted 覆写点**——React 只在下次 muted 值变化时纠正，注释钉住）。
- 自愈（onError 换 URL）→ 回预览态；起播依赖换 src 时 autoplay flag 重新评估，M7 实测不起播则在 videoUrl 变化路径补显式 play()。

## P1 预览黑屏 → 无声预播

- `<video>` 无条件渲染：`poster={detail.coverUrl ?? undefined}`、`muted={!playing} loop={!playing} autoPlay playsInline controls={playing}`、`onError` 一次性自愈（自愈换 URL 后 `onPlayingChange(false)` 回预播态）。
- `onCanPlay={(e) => { if (!playing && !previewPlayTriedRef.current) { previewPlayTriedRef.current = true; e.currentTarget.play()?.catch(() => {}); } }}`（一次性 ref：挂载 autoplay 被拒兜底一次；此后 canplay（暂停回落/seek/缓冲）不再抢播）。
- **删除 v3 加载占位块**（三份审查一致指出：触发条件无法同步得知、absolute inset-0 会盖住正在播放的画面、letterbox 透出灰块——删比修对，P1 核心 = poster + muted autoplay，简洁优先）。coverUrl:null 且 autoplay 被拒的极端角 = 黑屏，不比现状差。

**验收（jsdom）**：`video.muted === true`（property）、`toHaveAttribute('loop'/'autoPlay'/'playsInline')`、`not.toHaveAttribute('controls')`、poster 断言（fixture coverUrl 非空）；`fireEvent.canPlay` → play spy 调用、再触发一次不再调用（一次性）。
**手工 M1**：打开 1s 内画面出现、循环、无声。

## P2 轮播卡片

- 容器：`w-[180px] aspect-video rounded-lg overflow-hidden border-0 p-0 transition-all` + `hover:ring-1 hover:ring-white/60`（T5 裁定：默认无边框，hover 才现）。
- 封面 img：`absolute inset-0 h-full w-full object-cover`；无封面兜底 div 同款。
- 轮播条 `scrollbar-width:none` + `::-webkit-scrollbar{display:none}`。

**验收（jsdom）**：类名断言。
**手工 M2**：`getComputedStyle(card).padding==='0px' && borderWidth==='0px'`；rect ≈180×101.25；**深色视频帧下 hover 反馈可见性**（T5 代价项）；实测轮播条 offsetHeight（隐藏滚动条前后各一次）回填 `--vw-carousel-reserve`。

## P3 按钮组

- 位置：③④ 区块列流（渐变遮罩内），④ 容器 `pb-[var(--vw-carousel-reserve)]`。
- 配色：次要三钮 `bg-[#2f2f2f] text-white hover:bg-[#3a3a3a]`；主钮白底黑字不变。
- 边框：4 钮 `border-none` + R3 限定 reset。
- 喜欢钮 `w-auto px-3`。
- 播放态：③④ 不渲染。

**验收（jsdom）**：预览态类名断言 + pointer-events 断言（容器 none、③④ 区块 auto）；播放态 ③④ 卸载（`rerender(<PlayView playing ...>)` 驱动）。
**手工 M3**：贴底、深灰实底白字、无边框；亮素材遮罩可读；**打开登录框确认 antd 按钮 padding/边框未被 R3 reset 打坏**（R3 唯一回归面）。

## P4 播放交互

- effect 完整形态（v3.1）：

```tsx
useEffect(() => {
  const el = videoRef.current; if (!el) return;
  if (!playing) { el.muted = true; return; }   // 只静音不 play：暂停/播完回落不被掀翻
  el.muted = false;
  el.play()?.catch(() => { el.muted = true; message.warning('浏览器阻止了自动播放声音，请点击播放器音量图标'); });
}, [playing, detail.videoUrl]);
```

- `onPause={() => onPlayingChange(false)}`（暂停=回预览，从当前帧静音续看；与 onEnded 双出口，setState 幂等）。
- `onEnded={() => { onPlayingChange(false); if (videoRef.current) videoRef.current.currentTime = 0; }}`（播完回预览+回首帧）。
- `loop={!playing}`（预览态循环；播放态播完触发 onEnded）。
- 全屏：controls 落可点区（裁定 A），`[color-scheme:dark]` 保证原生控制条深色（B1）。

**验收（jsdom）**：点击"立即观看"→ 同一 DOM 节点身份、`muted===false`、`toHaveAttribute('controls')`、src 未变；play `mockRejectedValue` → muted 回 true + **`await screen.findByText(/音量/)`**（antd App 注不进 mock 实例，改断 toast 文本——renderPlay 已包真 `<AntdApp>`）；`fireEvent.pause(video)` → ③④ 回归、`muted===true`；`fireEvent.ended(video)` → 同上。harness：play/pause spy 为文件级前置（effect 在 playing 变化时直调）。
**手工 M4**：有声续播 currentTime 不归零；**点击 controls 全屏按钮**画面正常；控制条深色、进度可拖；暂停 → 回预览可再点立即观看；播完 → 回预览显示首帧。

## P5 画布预览

### P5a 节点尺寸（数据层兜底表 + 满框版式）

**定性修正（第三轮审查核验为真）**：协作持久化只存 `width ?? null / height ?? null`（canvasCollabRuntime.ts:68-69），RF dimensions 变更只写 `measured` 不回写 width/height，canvasStore.addNode 仅 textInput/videoEdit 设尺寸 → **未被手动 resize 的生成类节点在快照中无尺寸——兜底表是主路径而非边缘兜底**，取值须贴渲染层真值。

**红线**：RF `nodeHasDimensions` 为 && 判定，缺失时 wrapper `visibility:hidden`（jsdom 中 RO 被 no-op 桩、measured 恒 undefined → 永久隐藏）。兜底表必须全类型穷尽 + width/height 同步兜。

**兜底表（v3.1 终版，出处逐行核验）**：

| type | 兜底 w×h | 出处 |
|---|---|---|
| textInput | 300×300 | canvasStore.ts:196-199 建节点默认 |
| imageGen | 548×309 | ImageGenNode.tsx:60-68 16:9 实算：`Math.round(1000×9/16)=563` → `Math.round(563×548/1000)=309`；test:387 断言钉住。`:62 的 306 是非法 ratio 兜底常量非默认值` |
| imageExtGen | 548×309 | ImageExtNode.tsx:6 为 ImageGenNode 直通包装，同组件同值 |
| videoGen | 548×309 | VideoGenNode.tsx:51-58 同款实算（快照持久化值 308 为历史 measured，差 1px 无感） |
| audioGen | 548×280 | AudioGenNode.tsx:14-15 组件常量（NODE_WIDTH/NODE_HEIGHT） |
| multiImageGen | 400×300 | MultiImageNode.tsx:13-14 STACKED_W/H 堆叠态默认 |
| videoEdit | 320×110 | 结构估算：标题 ~37+工具栏 ~30+轨道区 ~40（1 轨 ≈88/3 轨 ≈110）；测试钉 110 注释注明推导，M5 接受 88–140 |
| group | 280×120 | 最少可用容器（min-h 非 height 真值；group 多已持久化 calcGroupBounds 尺寸，此行近死代码） |
| **unknown** | **280×120** | canvasStore.ts:817/894/946/1292 `?? 280 / ?? 120` 先例；snapshot-filter 对未知类型保留节点 |

- coverage 测试：兜底表 key ⊇ `VIDEO_WORK_NODE_TYPES`（`@flowweb/shared` video-work.ts:87-89，**零依赖勿 import CanvasView**——会拖进整幅画布图；与既有 nodeTypes.coverage.test 断的 `CanvasView ⊆ VIDEO_WORK_NODE_TYPES` 构成两环全链条）；未知类型拿 280×120。
- SimpleNode：根 `w-full h-full box-border overflow-hidden`；版式（R2）：缩略图 `absolute inset-0 object-cover` 铺满 + 底部信息条（`bg-black/60` + line-clamp），无缩略图同构。GroupFrame 不动。
- 断言：**全部** `.react-flow__node` 的 `style.visibility !== 'hidden'`（钉后果，jsdom 永久态更硬）**且** inline width/height 均非空（钉原因）；videoEdit `height:110px`；handles×2 保持。

**手工 M5**：持久化尺寸节点框还原（548×308 例）；Handle 贴框边；videoEdit 不塌（88–140）；110px 框信息条无关键内容被裁；**真浏览器首帧无隐藏闪烁**；判定（T6）：wrapper transform 与快照 position 一一对齐（jsdom 可断）+ 并排目视。

### P5b process + 播放态隐藏轮播（裁定 A）

`CarouselBar` 条件 `view === 'play' && !playing`。
**验收（jsdom）**：process 视图无 carousel；播放态无 carousel；恢复；播放态 `navigate('/videos/w2')` → 轮播恢复（钉外壳复位）。Modal fixture 需 canViewProcess:true。

### P5c 顶栏预留

- `apps/web/src/index.css`：`--vw-close-reserve: 108px;`（**必须显式带 px**——`padding-right: var(--x)` 传裸数字是无效声明，jsdom 测不出、浏览器静默失效）；`--vw-carousel-reserve: 125px;`（M2 实测回填）。注释写明与关闭钮宽度/轮播条高度耦合。
- 两顶栏 `pr-[var(--vw-close-reserve)]`（字面量类，JIT 可生成——dist css 已有 `var(--vw-card-border)` 同款先例）；PlayView 顶栏改 `pl-4 md:pl-8`（**Tailwind media 变体块整体输出在 base 之后，同特异性 md:px-8 靠后胜**——归因注记：第一轮插件顺序论只管 base 内部；M6 顺手 DevTools 看胜出规则名）。
- R3（已裁定限定版）：`:where([data-vw-shell]) button { border: 0; padding: 0; cursor: pointer; }`——`:where` 保持 (0,0,1) 压 UA 不压任何显式类与 antd 类选择器 (0,1,0)；`cursor:pointer` 修复 UA default（T5 hover-only 配套）。

**验收（jsdom）**：两顶栏 pr 类存在；PlayView 顶栏断 `md:pl-8` 存在且无 `md:px-8`/`md:pr-8` 残留。
**手工 M6**：窄/宽窗不重叠；DevTools 确认 `padding-right` 胜出规则为 pr-[var(...)]。

## 裁定项（全部已闭合）

- **R1**：✅ v3.1 总图（裁定 A + 视频恒 inset-0 铺底——v3 的 bottom reserve 切换被第三轮审查推翻：轮播隐藏+穿透后铺底不破坏 P0-1，且消灭"点立即观看画面跳大"与 reserve 动态切换）。
- **R2**：✅ 缩略图铺满 + 底部信息条（无缩略图同构）。
- **R3**：✅ 限定版：`:where([data-vw-shell]) button { border: 0; padding: 0; }`（**不加 `:not(.ant-btn)`**——`:not()` 参数特异性 (0,1,0) 计入使整条 (0,1,1)，反压 Tailwind 工具类 (0,1,0) 清零壳内按钮 padding 且 jsdom 测不出；antd 类选择器 (0,1,0) 本就赢 (0,0,1)，无需排除。v3.1 plan 审查三份一致命中此错误，已修）。
- **R4**：✅ videoEdit 110（88–140 区间）。
- **T5**：✅ hover 才现（代价登记风险节）。
- **M-3**：✅ 播完回预览 + 首帧（v3.1 细化：不自动循环续播——effect 预览分支不 play，消灭程序化 play 死路）。
- **新增（v3.1 采纳）**：暂停=回预览（onPause 出口）；`[color-scheme:dark]`；③④ 整块交互（简介可选中）。

## 非目标

- 不改后端 API；不改 /videos 列表页 VideoCard；不做进度记忆/倍速/音量 UI；不改 BaseFullscreenModal。
- ~~播放态原生 pause 不强制回落~~（v3.1 已改判：暂停=回预览，见状态机）。
- recordView 轮播重复上报、按钮 UA font 不继承系统栈——登记后续项。

## 测试要求（TDD 汇总）

- **PlayView.test.tsx**：`renderPlay` 补 `playing`/`onPlayingChange` props（C2——漏则文件红）；P1 属性/property + canPlay 一次性；P4 身份/muted/controls/src/降级 findByText(/音量/)/pause/ended 回落（`rerender` 驱动）；P3 类名 + pointer-events；顶栏 `md:pl-8`/pr 类断言；删 `:72` 处点击"立即观看"（props 化后语义失效，只留 fireEvent.error 路径）；fixture：coverUrl 非空版 + canViewProcess true/false。
- **CarouselBar.test.tsx**：尺寸/圆角/填充/归一/hover-ring 类名。
- **VideoPlayerModal.test.tsx**：P5b 四用例（含切作品复位）。
- **ProcessSnapshot.test.tsx**：全节点 `visibility !== 'hidden'` + inline 尺寸非空；videoEdit 110；未知类型 280×120；coverage（`FALLBACK` 需 export 供测试 import）⊇ `VIDEO_WORK_NODE_TYPES`（勿 import CanvasView）；`w-full h-full`；handles×2；wrapper transform 含快照 position。
- **ProcessView.test.tsx**：pr-[var(--vw-close-reserve)]。
- **手工 M1–M7**：M1 预播；M2 卡片几何+归一+reserve 实测回填+深色帧 hover 反馈；M3 按钮组+亮素材遮罩+**登录框 antd 按钮回归检查**；M4 有声续播+controls 全屏按钮+控制条深色/进度拖动+暂停/播完出口；M5 节点框/Handle/坐标对齐/信息条无裁切/首帧无闪烁；M6 顶栏不重叠+DevTools 胜出规则；M7 404 自愈一次+回预播态。

## 风险与边界

- 预播拉整段视频、轮播切换 remount 重下载——dev 期接受。
- T5 hover-only 代价：触屏设备轮播零 hover 反馈；深色帧下卡片轮廓暂不可见（M2 验收项）。若用户在别的渠道曾答复"ring-white/10 常显"与本裁定冲突——以本对话裁定为准，如需改回 ring-white/10 常显一句话即可。
- 兜底表为多数生成类节点唯一尺寸来源（主路径），与真实渲染偏差即视觉偏差——已逐行用渲染层真值，videoEdit/multiImageGen 为估算。
- CSS 变量必须带 px 单位（裸数字静默失效）；reserve 常量 M2 实测回填。
- `el.muted = true`（catch 内）是唯一 imperative 覆写点，React 下次 muted 值变化才纠正——代码注释钉住。
- P0-2 归因注记：base/media 输出块序决定 md:px-8 胜出（非插件顺序论）；防复活断言兜底。
- 第三轮"兜底是主路径"使 P5a 分量高于原估——T1 coverage 测试为 P5a 第一道防线。

## 审查核验记录（v3.1 附录摘要）

第三轮三份逐条核验：
- **采纳（阻塞）**：删占位块（A1 三重缺陷：条件不可知/盖画面/letterbox 透出）；暂停出口（A2，重构为"预览分支不 play"自洽方案——比审查原始 onPause 建议更进一步，同时消灭第一份 §2 replay 死路）；imageGen 548×309（A3+亲算：Math.round(562.5)=563→309，test:387 佐证；**驳回第三份 308——其手算 562.5→562 有误**）。
- **采纳（重要）**：兜底表=主路径定性（canvasCollabRuntime 只持久化 width/height、dimensions 只写 measured、addNode 仅两类型设尺寸）；视频盒恒 inset-0（第三份 §4.2——裁定 A 后铺底无害且消跳变）；multiImageGen 400×300（STACKED_W/H 组件常量，驳回其 450=MAX 与 320×200=测试夹具）；audioGen 出处改组件常量；message.warning 断言改 findByText；C1 visibility 断言（jsdom RO no-op 桩=永久态）；C2 既有测试改动清单；~~R3 加 :not(.ant-btn)~~（**第四轮撤销**：`:not()` 参数特异性 (0,1,0) 计入使整条 (0,1,1) 反压 Tailwind 工具类清零壳内按钮 padding——构建产物无 @layer、工具类靠特异性取胜是唯一防线；终版去 :not 并补 `cursor: pointer`）；B1 color-scheme:dark；B3 ③④ 整块交互。
- **采纳（注记）**：CSS 变量 px 单位注释；P0-2 归因修正（media 块序，M6 DevTools 复核）；M2/M3/M4/M5 手工项扩充。
- **有争议已处理**：T5"与本对话裁定矛盾"——审查声称用户曾答复"ring-white/10 常显"，本对话无此记录，以本对话"hover 才现"为准并登记代价+可一句话改回。
- **第一份 §2 el.paused 门闩**：被更优方案取代（预览分支不 play，门闩不再需要）。
