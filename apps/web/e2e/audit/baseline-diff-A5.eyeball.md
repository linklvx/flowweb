# A5 §2.4 目检清单结果（人工/预览实测 2026-09-18）

> 本文件为一次性人工维护文件：`css-baseline-diff.mjs` 只产出机械部分 `baseline-diff-A5.md`（重跑即覆盖），
> **永不写入/覆写本文件**；机械报告尾部 §9 仅留指向本文件的指针。

| §2.4 条目 | 结果 | 证据 |
|---|---|---|
| line-height 1.5 固定高度容器裁切/溢出 | **PASS** | 机械层 0 意外（级联量级 ≤±33px 有界）；实测 online-users 药丸 h34 contentFits、PreviewPlayer 288×162 overflow:clip 完好、模板页签/公告条无裁切 |
| 裸 select 1 处（TemplateMarketPage:64） | **PASS** | 实测 `1px solid rgb(51,51,51)`（border-[#333] 显式色）——inset→solid 深色下几乎无差，spec 预判成立 |
| canvas 布局（PreviewPlayer/AudioWaveform/ClipBlock/VideoEditNode） | **PASS** | PreviewPlayer 16:9 clip 保持；track-row 40px；VideoEditNode `1px dashed rgb(229,231,235)` 作者样式保留（border-dashed 未被压平）；AudioWaveform 按设计属动态排除区 |
| 裸 inline svg（VipSubscribeModal / FolderStackPreview） | **PASS / 登记** | VipSubscribeModal 实测：svg display:block + vertical-align:middle，全部处 flex 容器（flex item 本就块化）→ 零基线位移，图标 10/14/12px 尺寸完好；FolderStackPreview（MultiImageNode 图层栈，gate 夹具未含）同族登记——P:media-block 82 条 0 意外兜底 |
| Tiptap 富文本 img inline→block | **N/A（登记）** | 实测 8 门禁页均不渲染 Tiptap（.tiptap-content/.ProseMirror 0 命中——AnnotationNode 未入 gate 夹具）；成对回退修法（.tiptap-content img 两属性）spec 备案不动，B 段前触达实测 |
| img/video max-width:100%（19 处裸媒体） | **PASS** | videos 封面 img 实测 max-width:100% + display:block + fitsParent ✓（抽查）；19 处全带 h-full 低风险（spec）+ P:media-block 0 意外 |
| ::placeholder gray-400 | **PASS** | 实测作者色全保留：AuthModal #666（rgb(102,102,102)）、模板搜索 #555；preflight 默认仅落未写色输入框（B 段 dim 档规划在案） |
| textarea resize:vertical | **PASS** | live 探针实测 resize:vertical |
| a 下划线移除（19 Link） | **PASS** | 实测导航 link text-decoration:none |
| hr/table/fieldset/iframe 失 UA 边框 | **登记** | 8 门禁页无裸实例（antd table 自带作者边框免疫）；未采集属性（§8） |
| h1-h6/p/ul/ol margin 重置（裸元素） | **PASS** | register h1 实测 margin-top:0（作者设计即 0 间距）；裸元素族 y 位移全入 C:cascade 桶 |
| ul/ol 列表免疫 | **登记** | index.css:113-118 类选择器显式 list-style-type（spec 已证） |
| ::file-selector-button | **登记** | spec 已核查：13 处全隐藏式（opacity:0 覆盖层机制），无风险 |
| 原生 checkbox/range accent | **登记** | spec：8 处全带显式 accent，免复审 |
| 材料库 Modal 暗色覆写 | **登记** | 归 B 段（§3.2 手写 CSS 通道） |
| PropertiesPanel.tsx:138/156 表单补偿（A4-a 删后核实） | **PASS** | 源码级联核实：`[border-style:solid]` 删除后由 preflight `*{border-style:solid}`（author (0,0,1)）接管——input[type=color]（第三类宿主，UA 不给边框样式）同为 `*` 匹配，`border border-[var(--ve-border)]` 等价渲染 1px solid；无竞争规则（裸 input 无 antd 类）→ 删除安全，无需恢复 |
| 4 手写 CSS box-sizing 回归 | **PASS（实测订正）** | **spec 26px/2px 两实例均未复现**：`.new-folder-btn` 是 `<button>`——UA 默认表单控件本就 border-box（before 快照实测 border-box→border-box，w 216→215 仅 −1 父链）；`.ant-modal-content` 被 antd cssinjs 先行 border-box（Δ=0）。真实翻转后果为侧栏 −1 链 / register form −64 / works 卡片 −24 族（全入 P:box-sizing-flip 桶）；PromptInput.css 源码级核查：64×64 缩略框/命令弹层 −2px 同缩族（flex 行内同缩对齐保持）；NodeHandle.css Handle 归零（A2 已证）；index.css 无 width+padding 组合 |
| 恒浅区（login 岛）边框色/滚动条/焦点环 | **PASS** | 实测：岛根 .light、--fw-border 岛内 #e5e7eb（:root #333）、computed border-color rgb(229,231,235)、color-scheme:light（focus ring rgb(0,0,0) 浅色系）；数据层 124 边 →#e5e7eb |
| canvas wrapper colorMode dark + selection/bg 钉回 | **PASS** | 实测 wrapper class `react-flow bg-[#000000] dark`、画板内 --fw-border 解析 #333（.light 撞名已修）；Background transparent/selection 蓝值钉回以 A2 commit 像素 diff 0/1,024,000 留证 |
| disabled cursor not-allowed | **登记** | 交互态不入快照（informational；index.css 全局行 A4-a 已落） |
| divide 线涌现（TeamBillingPage:140） | **登记** | 团队账单页不在 8 门禁页；emergence-adjudication-A4.json 已登记 |
