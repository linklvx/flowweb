# C8 B6 真实浅色对照全景目检表（Task 27 Step 3，2026-09-20）

> 采集口径：JSON/截图基线 = `COLLECT_BASELINE=1 REAL_LIGHT=1 BASELINE_DIR=d4-reallight-tmp`（storage 真实路径：addInitScript localStorage theme=light → C1 内联脚本 → html.light；采集自证 8/8 页 html 类恰为 "light"，恒深探针 1/1 过（videos 封面垫底 #262626 未翻），翻转探针 4/4 过（canvas --fw-bg #f7f8fa / 画板板底 rgb(245,245,245) / ve 壳根语义+视觉 rgb(247,248,250)）。逐页 meta 见 `e2e/baseline/d4-reallight-tmp/meta.json`（本任务后删除，结论以此表为准）。
> 视觉目检 = 一次性 Playwright 截图脚本（e2e/tmp-b6-eyeball.mjs 主全景 + e2e/tmp-b6-ve.mjs ve 补充——ve store 注入需 dev 模块图，preview 不服务 /src），26 张 → e2e/tmp-b6-shots/（目检后随脚本删除）。视口 1280×900（ve 补充）/1280×800（主全景）。
> 判定记号：✅ 通过 / ⚠ 观察或覆盖缺口（附裁定建议）/ ❌ 缺陷（=停止收尾上报）。**本次 ❌ = 0**。

## 一、汇总

| 类别 | 数量 | 条目 |
|---|---|---|
| ✅ | 19 | 见第二节逐项 |
| ⚠ | 7 | ③CanvasToolbar hover/active 视觉接近；⑥CreditsDropdown 稿表外冻结 5 位点浅档 washed-out；⑦VideoHDPanel 三标签 #e2e8f0 浅底不可见（代码实证，fixture 不可达）；⑬Storyboard 组合并未成（无实照）；⑭素材库右键菜单未弹出（未目检）；⑮关键帧菱形被 0s 播放头遮挡（未独立目检）；⑯常规 clip 变体未呈现（注入假媒体触发 lost 红块变体） |
| ❌ | 0 | —— |

## 二、逐项目检表（按 plan Task 27 Step 3 清单序）

| # | 清单项 | 截图 | 判定 | 记录 |
|---|---|---|---|---|
| 1 | /login LoginModal 恒浅岛不变 | 01-login-page | ✅ | 白卡+浅输入面+深字，与深档版式一致仅配色翻转；无深档残留 |
| 2 | /works 壳浅 | 02-works | ✅ | 页面白底、卡片白面、字色深；b6/d4 scratch 残卡系当轮自建（测毕已清） |
| 3 | WeChatFollowModal 开启态 | 03-wechat-modal | ✅ | 白 modal+二维码可辨；Task 14 登记 html.light 浅值生效 |
| 4 | /videos 壳浅/卡白/封面垫底恒深 | 04-videos-list | ✅ | 壳/骨架浅；封面垫底 #262626 字面恒深（探针 pass 互证）；深⇄浅分层清晰 |
| 5 | /videos 详情 scrim 深 | 05-videos-detail | ✅ | 弹层白、scrim 深蒙层正常 |
| 6 | /canvas 板浅+点可见 | 10-canvas-gate-full | ✅ | 板底 rgb(245,245,245)，网格点浅灰可见；顶栏药丸 chrome 浅化（D3-chrome） |
| 7 | videoGen 选中态（浮标+选中框+配置面板） | 11-canvas-videoGen-selected | ✅ | 选中框可见；VideoGenNode:623 浮标深底白字清晰；配置面板白面浅化 |
| 8 | 浅色档浮层-板分离度（面板/工具条/药丸 vs #F5F5F5） | 11/12/30/31 | ✅ | 白面板以 border-overlay-2 + 投影与板面分离，无糊板；contrast-pairs 观测行对应值成立 |
| 9 | A 组 5 枚 size-7 图标钮与宿主面可辨性 | 11/12 | ✅ | controls-bg 浅 #f0f1f2 chip 在白面板上以图标+边可辨（AudioConfigPanel/RunButton/TextConfigPanel/VideoConfigPanel/VideoHDPanel 同族前四枚实照；VideoHDPanel 见 #16） |
| 10 | 4 处节点浮标浅色档观感 | 30/31×7 | ✅ | Upload/生成浮标深底白字（VideoGenNode:623/AudioGenNode:128/ImageNodeToolbar:402/MultiImageNode:207 同构），白卡上分离清晰。观察（非主题）：gate 画布位 videoGen 浮标与顶栏药丸重叠系布局占位，深档同在，不属 C8 范围 |
| 11 | CanvasToolbar 图标/hover 三态可辨 | 13/14/15 | ⚠ | 常态/hover/激活三态均成立且与板面可辨；但浅档下 hover 与激活态视觉接近（深档差更明显）。裁定建议：保留现状——三态差异已由 Task 22 e2e 断言钉死（底色序 38<激活 64<hover 81 实测），视觉强化非门禁项，若后续要改走独立变更登记 |
| 12 | KeyboardShortcutsPanel 恒深面板混合态 | 17-shortcuts-panel | ✅ | **计划担心的前提不成立**：面板底系固定深字面（oklab(0.26861…/0.95) + border #363636，style object 恒深冻结）而非 overlay 族跟随值——浅档下面板保持深底、#5DDCFF 图标深底可读（1.60:1 疑点不存在）、amber 分区标题/白色 kbd 键帽清晰。"升恒深 or 图标双值化"无需动作：现状即恒深面。混合态（深面板×浅页面）观感正常 |
| 13 | MaterialLibrary 蓝族/白盲区/text-dim-1 | 18-material-modal | ✅ | 选择文件/批量操作蓝字蓝蒙层底可读（台账 ≈2.6:1 与目检一致，低层级可接受）；指示条/thumb #3b82f6 醒目；空态"暂无素材" #9ca3af 刻意低层级可辨——非缺陷确认。FileGridZoomControl:16/:29 与 Browser:96 白系盲区位点在空库态不可达（无素材卡），未获实照——登记覆盖缺口，位点已在 registry styleObjects 在册 |
| 14 | CreditsDropdown 命名色清单逐处回归（Task 19 裁定表核对） | 16-credits-dropdown | ✅+⚠ | **表内 12 行全过**：容器白渐变+浅边、总额卡微暗渐变+顶部高光、总数字深渐变（#1f2329→#b45309 金调保住）、订阅/通用 breakdown violet-700/amber-700、长期有效 amber-800/70、充值钮深反转（zinc-950+白字+深辉光）、邀请钮浅渐变+inset 白高光、图标底 zinc-100、rose/amber 光斑降 alpha。**⚠ 稿表外 5 位点**：左紫卡标签 violet-200/90 + 数字白渐变(#fff→rgba(237,233,254,.85)) + violet-100/70 到期行；右 amber 卡标签 amber-200/90 + 数字白渐变(#fff→rgba(253,230,138,.85))——浅档浅底上 washed-out（数字尚可辨、标签近不可见）。系 Task 23（commit ad666573）"稿表外位点两路同值冻结"的既登记后果，卡片底紫/amber 0.10-0.18 渐变亦两路同值。裁定建议：后续独立小任务补 5 处浅分支（标签→violet-700/amber-700 系、数字渐变→深色系、到期行→violet-800 系），勿在收尾 commit 混入 |
| 15 | 8 类节点卡逐类列名核销 | 30 + 31-image/video/audio/multiImage/imageExt/text/videoEdit | ✅+⚠ | 7 类 UI 实截全过：深卡→白卡巨变落地，卡壳白面+浅边+深字，标签行 dim 可读，VideoEditNode 三重变更卡（P4+P10+#E5E7EB 边）白卡正常、⤢ 全屏编辑 accent 紫链接醒目。**⚠ 第 8 类 Storyboard group**：Ctrl+Alt+G 合并未成（前置 Ctrl+多选在合成事件下未注册——React Flow 加选需真实事件序列，见 memory 手测技巧），无实照。groups 域 token 化有 Task 22 深浅双跑 segcheck + 断言覆盖，浅档视觉无独立实照登记为缺口 |
| 16 | VideoHDPanel:108/:143/:175 标签浅档可读性 | （不可达）+代码实证 | ⚠ | gate fixture 无媒体（hasMedia=false）面板不可达，无实照；代码实证：容器 background=var(--canvas-controls-bg)（跟随翻浅 #f0f1f2）+标题 var(--canvas-controls-text)（跟随翻深）而三处标签 `color:'#e2e8f0'` 深字面不变 → 浅档 ≈1.06:1 不可见（模型选择/分辨率/帧率）。**计划预登记疑点证实**（Task 22 审查补原判 ≈1.1:1）。裁定建议：迁 `var(--canvas-controls-text)`（深档 rgb(247,247,247) vs 现字面 #e2e8f0=rgb(226,232,240) 近似微变——VideoHDPanel 需 hasMedia 才挂载，不在 8 采集页 DOM，零采集 diff；lint hex 基线减 3 键为合法陈旧化；contrast-table 无新 pair）+ 走独立小任务与变更登记，勿混入收尾 commit。登记 spec §13 |
| 17 | video-editor 面板浅/播放器深（§13.4 有意） | 40-ve-editor-clip | ✅ | 顶栏/资产面板/属性面板/传输条/时间线标尺全浅；预览区恒深（内容承载面）；导出紫钮、+视频轨/+音频轨 accent 链接醒目 |
| 18 | clip 块 | 40/41 | ✅+⚠ | 注入假媒体 id → 素材已丢失红块变体（#EF4444 族）浅档下清晰可读、选中蓝边可见。⚠ 常规 clip 变体未呈现（真实媒体才出现）——lost 变体即 ClipBlock 全部深字面路径的浅档实证，常规变体色条同族 token，风险低，登记观察 |
| 19 | ExportModal 紫底白字钮恒定确认 | 42-ve-export-popover | ✅ | 导出设置弹层白面浅边、字段深字、危险提示红字可读、取消浅钮+确认正确禁用灰；ExportModal:245 `bg-[var(--ve-accent)]` 紫底白字恒定 ✓ |
| 20 | 关键帧菱形浅色档观感 | 41-ve-keyframe-diamond | ⚠ | stopwatch 点击生效但菱形恰与 0s 播放头线同位被遮挡，未获独立目检照。代码路径成立：ClipBlock:90 菱形 --fw-surface-dim 浅底 + --ve-accent 边（计划 Task 15 审查补担心的"反转对比"实为浅底上深边框菱形——与深档"深底浅边"对偶，属 chrome-follows 正确形态）。裁定建议：接受代码级判定；后续如需实照，注入 clip 后先将播放头移至非 0 位置再点 stopwatch |
| 21 | LoginModal/admin 岛不变 | 01 / 50-admin-models | ✅ | admin 深岛维持（域外保留）：侧栏/表格/字色全深，与浅色 html 无缝共存 |
| 22 | 注册页（公开页对照） | register | ✅ | JSON 基线内含（html=light 自证过）；与 login 同构浅岛 |

## 三、⚠ 裁定汇总与后续动作建议

| ⚠ | 性质 | 建议动作 | 是否阻断收尾 |
|---|---|---|---|
| CanvasToolbar hover/active 视觉接近 | 断言已守（Task 22 e2e 钉序） | 无动作；如需视觉强化走独立变更登记 | 否 |
| CreditsDropdown 稿表外 5 位点 washed-out | Task 23 既登记冻结后果（ad666573"稿表外位点两路同值冻结"），非本轮回归 | 后续小任务补 5 处浅分支（标签/数字渐变/到期行） | 否 |
| VideoHDPanel 三标签 #e2e8f0 浅底不可见 | 计划预登记疑点证实（B2-b 遗留灰阶）；fixture 不可达、零采集 diff | 后续小任务：三处迁 var(--canvas-controls-text) + lint/contrast 复跑；入 spec §13 终版登记 | 否 |
| Storyboard group 无浅档实照 | 合成事件限制（非产品缺陷）；域有 segcheck+断言覆盖 | 接受缺口；真实手动验收时补看 | 否 |
| 素材库右键菜单未弹出 | 截图脚本 locator 未命中触发面（非产品缺陷） | 接受缺口；FolderContextMenu 位点在 registry 在册 | 否 |
| 关键帧菱形被播放头遮挡 | 截图构图限制（非产品缺陷）；代码路径浅档成立 | 接受代码级判定 | 否 |
| 常规 clip 变体未呈现 | 注入假媒体仅触发 lost 变体 | 接受；lost 变体已覆盖 ClipBlock 深字面路径浅档实证 | 否 |

## 四、产物清理登记

- `e2e/baseline/d4-reallight-tmp/`（8 页 JSON+PNG+meta）：目检证据已转入本表，按 plan 指示删除（勿入 commit——禁 UPDATE_BASELINE 类基线污染）。
- `e2e/tmp-b6-eyeball.mjs`、`e2e/tmp-b6-ve.mjs`、`e2e/tmp-b6-shots/`（26 张）、`e2e/tmp-d4-perf.mjs`、`e2e/tmp-d4-perf-out.json`：一次性脚本与产物，跑完即删。
- 无 ❌：不触发停止条款，Task 27 收尾继续。

