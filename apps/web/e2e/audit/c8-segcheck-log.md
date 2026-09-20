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
