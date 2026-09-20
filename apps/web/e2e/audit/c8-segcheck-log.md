# C8 段验收 segcheck 结论留痕（总纲 §3 立规：原始产物验后即删，结论在此常驻）

## D1a（Task 13）@ 本文件首次入库 commit（= D1a 定义层双值化原子提交，父 da03bea3）

- 深侧 before-D × segcheck-D1a: exit=0, unexpectedTotal=0（意外项闸属性 0 + 几何 0，三闸全过）, dExpectedGate absorbed=0（预期 0——深档零 diff 段；D 段注册配对 2 组吸收 0 条，B2 注册配对 43 组吸收 0 条）
- 浅侧 before-D-light × segcheck-D1a-light: exit=0, absorbedByPair={ backgroundColor: 8（rgb(20, 20, 20)→rgb(247, 248, 250) [global]，每页 body 1 条×8 门禁页）, color: 64（rgb(226, 232, 240)→rgb(31, 35, 41) [global]） }, unexpected=0
  - color ×64 = body 8 条 + 继承链合法放大 56 条（>8×2 判据通过，adjudications 按总纲记实际计数）
  - D 段注册配对恰为 2 组（page 限定 0 + 全局 2）——与 Task 12 预登记 body 两条全局 pairs 恰合，无多无少
  - 除 body 两族外浅侧零 diff——岛机制推演成立（域 token 浅值消费者全在 .dark 岛内），无待归因项、无预先豁免
- 配对率两侧同形：video-editor 253/256（3 个运行时生成 testid 键不稳定非结构变化，before/after 元素数 252/252 相同），其余 7 页 100%
- 采集中间物: 已清理（.json/.md 两侧四件 + segcheck-D1a / segcheck-D1a-light 采集目录）

## D1b（Task 16）@ 本文件 D1b 小节追加 commit（= WeChatFollowModal 拆岛原子对 + D1b 段验收提交 b262de10，父 fab147f3）

- 采集器冻结面指纹复验: sed COLLECTOR-FROZEN 区间 sha256 = 45eede4fe5e33f3258b81874b7ccf30db879e5175da527f18546abe0c917e7a3（与 a0-collector-fingerprint.txt 落档一致，Task 15 探针面改动未触冻结面）
- 全门禁: playwright 52 passed / 5 skipped（a0 采集 spec 常驻 skip 形态）；vitest 262 files / 2631 tests 全绿；lint-gate PASS（no-color-hex 268 baselined, 0 new）
- 深侧 before-D × segcheck-D1b: exit=0, unexpectedTotal=0（属性 0 + 几何 0，三闸全过）, dExpectedGate pairsRegistered=7 absorbed=17:
  color rgb(108, 92, 231)→rgb(155, 140, 247) [page video-editor] ×6（§9.2① P9 深档提亮，Task 14 落点）
  backgroundColor rgba(255, 255, 255, 0.04)→rgba(255, 255, 255, 0.05) [global] ×6（Task 15 TopActionBar BTN 深侧微变）
  backgroundColor rgb(54, 54, 54)→rgb(51, 51, 51) [page video-editor] ×5（**本段新登记 pair**——见下）
  另 B2 闸吸收 borderColor rgb(54, 54, 54)→rgb(51, 51, 51) ×48（§9.2② 收敛族 borderColor 形态）
- 浅侧 before-D-light × segcheck-D1b-light: exit=0, unexpected=0, absorbed=89:
  color rgb(226, 232, 240)→rgb(31, 35, 41) [global] ×64（body 前景继承族，D1a pair 继续吸收）
  backgroundColor rgb(20, 20, 20)→rgb(247, 248, 250) [global] ×8（body 底，D1a pair 继续吸收）
  color rgb(108, 92, 231)→rgb(155, 140, 247) [page video-editor] ×6（壳根 .dark 岛未拆→浅档岛内读深值域，P9 对吸收）
  backgroundColor rgba(255, 255, 255, 0.04)→rgba(0, 0, 0, 0.03) [global] ×6（Task 15 TopActionBar 浅侧 pair）
  backgroundColor rgb(54, 54, 54)→rgb(51, 51, 51) [page video-editor] ×5（岛内同源，与深侧共用新 pair）
  另 B2 闸吸收 borderColor 族 ×48（岛内深值域同源）
- **本段新增 pair（1 条，深浅两侧共用）**: backgroundColor page:video-editor rgb(54, 54, 54)→rgb(51, 51, 51)——Task 15 D1b-value-collapse 收敛 --ve-border 的**背景形态**落点（VideoEditorShell PanelResizeHandle×3 w-1 分隔条 + TimelineRuler w-px h-2 刻度线把这枚边框 token 当背景消费；borderColor 形态全局 pair Task 15 已登记，背景形态 5 条 segcheck-D1b 首跑意外项抓出后补登记，复跑两侧 exit=0）
- **预期落空归因（登记则成死配对，故不登记）**:
  - accent-text 浅值 #5F4FD1 落点（video-editor 8 钮 color rgb(108, 92, 231)→rgb(95, 79, 209)）: 壳根 .dark 岛未拆（Task 21 才拆），浅档采集岛内读深值 #9B8CF7——浅值本段采集面不可见，实抓 diff 为 P9 深档对（×6 已吸收）。同机制 registry D1b-a0-probe-revision 在册（"Task 21 拆岛时才翻浅为双断言"）
  - WeChatFollowModal 翻浅（面 rgb(30,30,30)→rgb(255,255,255) 等）: modal 非开启态不渲染 DOM，a0 works 快照 0 个 ant-modal 键（before-D-light/works.json 实证）——采集面无此位点，零 diff 非吸收。守卫由反转后的 G8①（无岛类 + 面底/--fw-text 浅值 + antd 通道浅）与 D-3 探针（面/标题前景翻浅钉值）承担
  - 并域键浅值一致化（ve-panel→fw-surface-dim 等六键）: 浅档等值 → 零 diff，符合预期
- 配对率两侧同形: video-editor 253/256（运行时 testid 键不稳定 3 条，非结构变化），其余 7 页 100%
- 采集中间物: 已清理（.json/.md 两侧四件 + segcheck-D1b / segcheck-D1b-light 采集目录）

## D2（Task 18）@ 本文件 D2 小节追加 commit（= selection 钉值定案 + render 计数探针 + ProcessSnapshot 不变式 + D2 段验收提交，父 9a221fff）

- 采集器冻结面指纹复验: sed COLLECTOR-FROZEN 区间 sha256 = 45eede4fe5e33f3258b81874b7ccf30db879e5175da527f18546abe0c917e7a3（与 a0-collector-fingerprint.txt 落档一致，D2 未触冻结面）
- 全门禁: playwright 55 passed / 5 skipped（a0 采集 spec 常驻 skip 形态；新增 D-7 selection 钉值两档断言通过）；vitest 263 files / 2632 tests 全绿（新增 CanvasView.theme-perf render 计数：首渲 2、setMode 一次后节点增量 0）；lint-gate PASS（no-color-hex 267 baselined, 0 new）
- 深侧 before-D × segcheck-D2: exit=0, unexpectedTotal=0（属性 0 + 几何 0，三闸全过）, dExpectedGate pairsRegistered=7 absorbed=17——与 D1b 完全同形（P9 深档提亮 ×6 + TopActionBar BTN 深侧微变 ×6 + ve-border 背景形态 ×5），**D2 深档零新 diff**（与 Task 17 像素对账 maxDiffPixels:0 同口径互证：板面深档字节等值）；B2 闸另吸收 borderColor 收敛族 ×48
- 浅侧 before-D-light × segcheck-D2-light: 首跑 exit=1（意外 3 条）→ 补登记 1 组全局 pair 后复跑 exit=0, unexpected=0, absorbed=92:
  color rgb(226, 232, 240)→rgb(31, 35, 41) [global] ×64（D1a body 前景族继续吸收）
  backgroundColor rgb(20, 20, 20)→rgb(247, 248, 250) [global] ×8（body 底）
  color rgb(108, 92, 231)→rgb(155, 140, 247) [page video-editor] ×6（P9 对，岛内读深值域）
  backgroundColor rgba(255, 255, 255, 0.04)→rgba(0, 0, 0, 0.03) [global] ×6（Task 15 BTN 浅侧）
  backgroundColor rgb(54, 54, 54)→rgb(51, 51, 51) [page video-editor] ×5（D1b 背景形态对）
  backgroundColor rgb(0, 0, 0)→rgb(245, 245, 245) [global] ×3（**本段新登记 pair**——见下）
- **本段新增 pair（1 条，仅浅侧）**: backgroundColor rgb(0,0,0)→rgb(245,245,245) [global]——D2 板面翻转落点（Task 17：.react-flow wrapper 旧钉黑底改 bg-[var(--canvas-board-bg)]，浅档取 #f5f5f5）；wrapper 站点实跨 canvas/material-modal/video-editor 三个采集页（各自内嵌 ReactFlow，segcheck 实测 3 条同值同位），page 收窄会漏页——按 TopActionBar/body 全局族先例全局登记
- **预期落空归因（实测零 diff，不登记）**: 网格点 #555555→#c8c8c8 与手柄 SVG stroke 两值 rgb(156,163,175)→rgb(107,114,128)/rgb(107,114,128)→rgb(75,85,99) 翻转——SVG circle/pattern 呈现属性对采集器不可见（differ 冻结属性集只含 HTML 元素 CSS 属性），机械面零 diff 属采集口径预期非"无变化"；守卫由 D-1 网格点探针 + D-6 手柄双断言承担
- 配对率两侧同形: video-editor 253/256（运行时 testid 键不稳定 3 条，非结构变化），其余 7 页 100%
- 浅色目检 checkpoint（第五轮 A4，非验收只记录）: e2e/audit/c8-d2-light-checkpoint.png（gate 画布 lightContext 截图）——板已浅（#f5f5f5 浅点网格）、节点卡/左侧添加工具条/左下缩放工具条/顶栏药丸/credits 药丸仍深的混排期现状存照（registry meta.notes 同记，D3 画板批次开工前基线观察）
- 采集中间物: 已清理（.json/.md 两侧四件 + segcheck-D2 / segcheck-D2-light 采集目录 + checkpoint 临时 spec）

## D3-videos（Task 20）@ 本文件 D3-videos 小节追加 commit（= 播放壳域原子对提交，父 5fabd0bf）

- 全门禁: playwright 55 passed / 5 skipped（D-5 探针随域原子对同 commit 翻转真值 rgb(255,255,255)→rgb(31,35,41) 后全绿）；vitest 全绿（videos 域 60/60 含 VideoPlayerModal.test 壳根断言反转）；lint-gate PASS（no-theme-utility 0 违例；no-color-hex 260 baselined, 0 new）
- 域纪律 grep（九族 -i 口径，当次实测）: 产品码 28 处/6 文件——PlayView 14（含 3 注释行）/ProcessSnapshot 7/VideoPlayerModal 3（含 1 注释行）/CarouselBar 2/ProcessView 1/VideoCard 1，全部落在 5 精确条目 {glob,allow} + ProcessSnapshot 预置条目（摘 videos/** 目录后激活）文件内；测试 6 处/4 文件全在 string 条目文件内；精确豁免外产品码残余 0（lint-gate 0 违例同证）
- 深侧 before-D × segcheck-D3-videos: exit=0, unexpectedTotal=0（属性 0 + 几何 0，三闸全过）, B2 闸吸收 57（borderColor 收敛族 ×48 + color #fff→#e2e8f0 ×5 + color white/70→white/60 ×4——后两族=b2 registry 既有配对吸收，对应 D3-videocard-migration :27/:31 深侧微变）, D 段闸吸收 17（P9 ×6 + BTN 深侧 ×6 + ve-border 背景形态 ×5）；路由根岛删除在 html.dark 下级联不变（App ConfigProvider 本就 darkAlgorithm + :root,.dark 块仍命中）→ 深档零新 diff
- 浅侧 before-D-light × segcheck-D3-videos-light: 首跑 exit=1（意外 59 条/10 组，全部 page:'videos'）→ 补登记 10 组 page 限定 pair 后复跑 exit=0, unexpected=0, D 段闸吸收 151（新增 10 对承 59 条 + 既有 8 对承 92 条）, B2 闸另吸收 48:
  - antd 通道翻转 4 对（route 级 ConfigProvider darkAlgorithm 删除→defaultAlgorithm）: color colorText rgba(255,255,255,0.85)→rgba(0,0,0,0.88) ×8 + 同源 borderColor 形态 ×8（.ant-tabs-tab border:0→computed=currentColor 继承 colorText）+ color colorPrimary rgb(22,104,220)→rgb(22,119,255) ×1 + backgroundColor（ink-bar 形态）×1——Tabs 分类标签系；仅 /videos 曾挂 route 级 darkAlgorithm 故 page 收窄
  - VideoCard 卡壳 2 对: backgroundColor rgb(30,30,30)→rgb(255,255,255) ×5（--fw-surface 浅值首次生效——岛拆前浅档被祖先 .dark 解析回 #1e1e1e）+ borderColor rgba(255,255,255,0.1)→rgba(0,0,0,0.06) ×20（border-overlay-2 浅值，5 卡×4 侧）
  - VideoCard 文字/标签底 4 对: color rgb(255,255,255)→rgb(31,35,41) ×5（标题 text-white→text-text，before=迁移前字面）+ color rgba(255,255,255,0.7)→rgb(75,85,99) ×4（标签字→text-text-dim-3 浅值）+ color rgba(255,255,255,0.3)→rgb(156,163,175) ×3（无封面占位→text-text-dim-1 浅值）+ backgroundColor rgba(255,255,255,0.1)→rgba(0,0,0,0.06) ×4（标签底→bg-overlay-2 浅值）
- 预期落空归因（登记则成死配对/采集面外，不登记）: ①ProcessView 翻浅与 M2 空态迁移——ProcessView 仅详情路由渲染（采集面无 DOM）、M2 三态分支 gate fixture 恒有数据不渲染（D3-m2-empty-states M2 前提）；②PlayView/CarouselBar/媒体容器恒深字面零 diff（第四通道保留项）；③壳根 DOM 拆分新增媒体容器层——VideosPage:49 !id||!detail 早退零 DOM→零 dom: 键漂移（G8② count=0 断言机械守卫，registry D3-videos-shell-dom-split 三条承重约束在册）
- 配对率两侧同形: video-editor 253/256（运行时 testid 键不稳定 3 条，非结构变化），其余 7 页 100%
- 采集中间物: 已清理（.json/.md 两侧四件 + segcheck-D3-videos / segcheck-D3-videos-light 采集目录）

## D3-ve（Task 21）@ 本文件 D3-ve 小节追加 commit（= ve 壳岛拆除原子对提交，父 6b6482f2）

- 采集器冻结面指纹复验: sed COLLECTOR-FROZEN 区间 sha256 = 45eede4fe5e33f3258b81874b7ccf30db879e5175da527f18546abe0c917e7a3（与落档一致；Task 21 a0 探针面改动——REAL_LIGHT video-editor 恒深断言退役改 probeFlip 双断言（语义层 --fw-bg + 视觉层壳根底，D1b-a0-probe-revision 预告兑现）——位于冻结区间外，指纹不变）
- 全门禁: playwright 55 passed / 5 skipped（D-4 探针同 commit 反转真值：壳底 rgb(247,248,250) + EditorTopBar 面板底 rgb(240,241,242)，全绿）；vitest 263 files / 2640 tests 全绿；lint-gate PASS（no-theme-utility 0 违例；no-color-hex 259 baselined, 0 new——ve 域字面核销致 9 基线键转陈旧剔除 260→259）
- 域纪律 grep: grep -rn "var(--canvas-" src/pages/canvas/video-editor/ | wc -l = 0（§9.2③ 收口维持）；九族残余产品码 3 处/3 文件（ExportModal :245 text-white + PreviewPlayer :71 bg-black + ClipBlock :75 text-white/85）= 精确条目 3 条对账闭合（D3-ve-keeps-constant-faces），摘 video-editor/** 目录（net -2 累计）同 commit
- 深侧 before-D × segcheck-D3-ve: exit=0, unexpectedTotal=0（属性 0 + 几何 0，三闸全过）, D 闸吸收 17——与 D1b/D2 完全同形（P9 ×6 + BTN 深侧 ×6 + ve-border 背景形态 ×5）**深档零新 diff**（壳岛拆除 html.dark 下级联不变：:root,.dark 块仍命中 + ConfigProvider 删除后继承根 AntdApp 本就 darkAlgorithm）；B2 闸吸收 57（borderColor 收敛族 ×48 + color #fff→#e2e8f0 ×5 + white/70→white/60 ×4——后两族=VideoCard 深侧微变既有配对，D3-videos 同形）；PreviewPlayer hover 提亮迁移 4 处（hover:text-white→hover:text-text）hover 态不进快照零 diff（第八轮裁定）
- 浅侧 before-D-light × segcheck-D3-ve-light: 首跑 exit=1（意外 53 条/9 组，全部 page:'video-editor'）→ 补登记 9 组 page 限定 pair（borderColor 按形态合一）后复跑 exit=0, unexpected=0, D 闸吸收 217（**新增 9 对恰承 53 条** + 既有对承 164 条）, B2 闸 0（--ve-border 浅值族 #363636→#e5e7eb 落 A 段既有 R:registered →#e5e7eb 桶 ×1532，非 B2/D 通道）:
  - 预告条款 a 兑现: backgroundColor rgb(54,54,54)→rgb(229,231,235) ×5——Task 16 后向条款（D1b-value-collapse 背景形态 5 位点 PanelResizeHandle×3 + TimelineRuler 刻度×2 拆岛后随 --ve-border 浅值翻读；D1b 新登记对的 ⚠ 预告句兑现，深侧对仅承深侧、本对仅承浅侧）
  - 预告条款 b 兑现（量级订正 8→6）: color rgb(108,92,231)→rgb(95,79,209) ×6——accent-text 浅值 #5F4FD1 首次生效（D1b 预期落空归因条兑现）；源码 8 消费点差额 2 = PropertiesPanel ⏱ active=false 落 --ve-text-dim 桶 + TrackRow ➕ 无轨数据不渲染（门禁 fixture），registry why 已记不扩对
  - 壳 chrome/面板（条款 c）: --fw-surface-dim rgb(38,38,38)→rgb(240,241,242) ×9（editor-top-bar/asset-panel/preview-control-bar/properties-panel/timeline-panel/timeline-ruler/工具行/空轨槽/轨头）+ --ve-text-dim rgba(226,232,240,0.6)→rgb(75,85,99) ×13（分组标题/时间码/properties-empty/轨头标签/刻度字/静音·隐藏·⏱ 钮）
  - antd 通道 5 对（壳级 darkAlgorithm 删除→defaultAlgorithm；仅 ve 壳曾挂故 page 收窄）: color colorText rgba(255,255,255,0.85)→rgba(0,0,0,0.88) ×11（PreviewPlayer 双 Slider 内绘 div ×10 + AssetPanel 搜索 Input ×1）+ Input 边框 borderColor rgb(66,66,66)→rgb(217,217,217) ×4（四边同值按形态合一登记，意外项逐条显示 border-t/r/b/l-color 但吸收查键恒为 borderColor）+ Input 底 rgb(20,20,20)→rgb(255,255,255) ×1 + Slider rail rgba(255,255,255,0.08)→rgba(0,0,0,0.04) ×2 + Slider track 填充段 rgb(21,50,91)→rgb(145,202,255) ×2
- 配对率两侧同形: video-editor 253/256（运行时 testid 键不稳定 3 条非结构变化，before/after 元素数 252/252）——**⚠ D3-ve-literal-migration 运行时键盲区裁定 transcription：节点根/video-edit-node-*/track-row-* 自身迁移永无 differ 信号，核销靠 B6/探针，勿把 diff 没红读成改对**；其余 7 页 100%
- 采集中间物: 已清理（.json/.md 两侧四件 + segcheck-D3-ve / segcheck-D3-ve-light 采集目录）
