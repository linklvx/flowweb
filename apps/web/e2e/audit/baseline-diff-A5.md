# A5 三层基线 diff 报告（before-A0 × after-A）

- before：`before-A0` @ 137c29af11523085273edb085bbb14f078673da7（采集 2026-09-18T16:41:29.639Z）
- after：`after-A` @ 5333c32aa785936ecaeb113935f7573affd1b910（采集 2026-09-18T20:32:06.790Z）
- 门禁：**PASS（意外=0）**（属性层 0 + 几何层 0；R:registered 已登记例外另计）

## 1. 配对统计（稳定键 tid:@n / dom: 路径）

| page | before | after | paired | removed | added |
|---|---|---|---|---|---|
| admin-models | 281 | 281 | 281 | 0 | 0 |
| canvas | 123 | 123 | 123 | 0 | 0 |
| login | 40 | 40 | 40 | 0 | 0 |
| material-modal | 215 | 215 | 215 | 0 | 0 |
| register | 12 | 12 | 12 | 0 | 0 |
| video-editor | 252 | 252 | 249 | 3 | 3 |
| videos | 123 | 123 | 123 | 0 | 0 |
| works | 144 | 144 | 144 | 0 | 0 |
- video-editor 3 个未配对键 = 运行时生成 testid（rf__node-node_<时间戳> / video-edit-node-<时间戳> / track-row-<uuid>）——同位同量元素（React Flow 节点包装+编辑节点+轨道行），键不稳定非结构变化；before/after 元素数相同（252/252）
- 其余 7 页配对率 100%（元素数逐页相等）

## 2. 属性层（聚合分桶）

| 桶 | 计数 | 预期类别 |
|---|---|---|
| borderStyle.none→solid | 4119 | P:preflight *{border-style:solid}（宽度恒 0 → 零几何，A4 删除验证） |
| borderColor.→rgb(51, 51, 51) | 4111 | P:preflight *{border-color:var(--fw-border)}——currentColor 解析值→#333 桥接（D2） |
| boxSizing.content-box→border-box | 715 | P:preflight 全局翻转 |
| borderStyle.outset→solid | 220 | P:表单控件 UA 斜面→扁平（A4-c 涌现裁定） |
| fontSize.13.3333px→14px | 131 | P:表单控件 font-size:100%→inherit + UA 按钮字号(13.3333px)后代继承传播 |
| borderColor.→rgb(229, 231, 235) | 124 | P:.light 恒浅岛覆盖（login 页 →#e5e7eb） |
| lineHeight.normal→22px | 121 | P:html{line-height:1.5}（normal→数值=1.5×font / inherit；text-* 类自带行高免疫） |
| borderWidth.0px→1px | 93 | P:涌现宽度真实渲染（A4-c 登记 33 非零站点在门禁页的子集，24 站点） |
| lineHeight.normal→24px | 68 | P:html{line-height:1.5}（normal→数值=1.5×font / inherit；text-* 类自带行高免疫） |
| color.rgb(0, 0, 0)→rgba(0, 0, 0, 0.88) | 29 | P:表单控件 color:inherit（buttontext/canvastext→继承色） |
| borderStyle.inset→solid | 16 | P:表单控件 UA 斜面→扁平（裸 select 1 处等） |
| lineHeight.normal→18px | 15 | P:html{line-height:1.5}（normal→数值=1.5×font / inherit；text-* 类自带行高免疫） |
| lineHeight.13.3333px→14px | 7 | P:html{line-height:1.5}（normal→数值=1.5×font / inherit；text-* 类自带行高免疫） |
| lineHeight.normal→21px | 5 | P:html{line-height:1.5}（normal→数值=1.5×font / inherit；text-* 类自带行高免疫） |
| lineHeight.normal→22.5px | 5 | P:html{line-height:1.5}（normal→数值=1.5×font / inherit；text-* 类自带行高免疫） |
| lineHeight.normal→20.4286px | 4 | P:html{line-height:1.5}（normal→数值=1.5×font / inherit；text-* 类自带行高免疫） |
| borderWidth.2px→0px | 4 | P:裸 button UA outset 边框归零（四属性归零族） |
| lineHeight.normal→16.5px | 4 | P:html{line-height:1.5}（normal→数值=1.5×font / inherit；text-* 类自带行高免疫） |
| lineHeight.normal→18.8571px | 2 | P:html{line-height:1.5}（normal→数值=1.5×font / inherit；text-* 类自带行高免疫） |
| lineHeight.normal→15px | 2 | P:html{line-height:1.5}（normal→数值=1.5×font / inherit；text-* 类自带行高免疫） |
| lineHeight.normal→17.2857px | 2 | P:html{line-height:1.5}（normal→数值=1.5×font / inherit；text-* 类自带行高免疫） |
| lineHeight.normal→31.4286px | 2 | P:html{line-height:1.5}（normal→数值=1.5×font / inherit；text-* 类自带行高免疫） |
| lineHeight.normal→16px | 1 | P:html{line-height:1.5}（normal→数值=1.5×font / inherit；text-* 类自带行高免疫） |
| fontSize.13.3333px→12px | 1 | P:表单控件 font-size:100%→inherit + UA 按钮字号(13.3333px)后代继承传播 |
| lineHeight.normal→20px | 1 | P:html{line-height:1.5}（normal→数值=1.5×font / inherit；text-* 类自带行高免疫） |
| color.rgb(16, 16, 16)→rgba(255, 255, 255, 0.35) | 1 | P:表单控件 color:inherit（buttontext/canvastext→继承色） |
| fontSize.13.3333px→16px | 1 | P:表单控件 font-size:100%→inherit + UA 按钮字号(13.3333px)后代继承传播 |
| color.rgb(255, 255, 255)→rgb(226, 232, 240) | 1 | P:表单控件 color:inherit（buttontext/canvastext→继承色） |
| fontSize.13.3333px→13px | 1 | P:表单控件 font-size:100%→inherit + UA 按钮字号(13.3333px)后代继承传播 |

## 3. 几何层归因汇总（w/h/x/y/padding/border-width/font-size 逐条）

| 归因 | 条数 | 说明 |
|---|---|---|
| P:form-reset | 533 | 表单控件 UA padding/border/font 抵消（裸 button 四属性归零族；ul/ol/fieldset reset 同列；含按钮后代 span/svg 传播——13.3333px UA 字号标记） |
| C:cascade | 480 | 自身驱动静态的传导位移/尺寸（全局行高、表单重置、margin 归零在上游发生；块级子元素跟随父容器宽；量级直方图） |
| P:emergent-border | 118 | 涌现边框占位（border 宽度类 0→N 真实渲染；auto 尺寸总 w/h += 边框和；A4-c 登记 33 非零站点） |
| P:media-block | 82 | img/svg display:block + vertical-align:middle（行内空隙移除/占位变化） |
| P:box-sizing-flip | 33 | box-sizing content-box→border-box：width+padding/border 组合总宽收窄（register form −64 / 手写 CSS 26px·2px 实例族） |
| P:line-height | 20 | 自身 line-height normal→数值（1.5×font-size）高度增长 |

级联位移量级直方图（|Δ|≤40px 自动归级联）：`{"y+2":73,"w+4":3,"x+1":12,"y+1":46,"x+3":3,"w-2":27,"y-1":71,"h-2":19,"h-6":12,"x-1":34,"x-2":31,"w-7":3,"h+2":6,"x+7":6,"x+8":3,"x+9":3,"x+10":3,"x+11":3,"w-1":10,"h+3":7,"x+6":4,"y+3":7,"w+1":6,"w-4":1,"x+4":3,"x+32":1,"y+14":1,"w-66":2,"x+33":2,"y-3":5,"y-2":11,"y+4":1,"y+6":1,"w+2":1,"h-1":6,"x-4":2,"x-3":4,"y-6":6,"h-17":2,"h+5":2,"w-24":1,"w-23":1,"x+23":4,"h+7":2,"y+5":4,"y-8":10,"h+6":8,"y-5":5,"y-9":2}`

## 4. line-height 二分统计（对照 A0 冻结值）

- changed 239 / unchanged 948
- 值对分布（全量）：
  - `normal→22px` ×121
  - `normal→24px` ×68
  - `normal→18px` ×15
  - `13.3333px→14px` ×7
  - `normal→21px` ×5
  - `normal→22.5px` ×5
  - `normal→20.4286px` ×4
  - `normal→16.5px` ×4
  - `normal→18.8571px` ×2
  - `normal→15px` ×2
  - `normal→17.2857px` ×2
  - `normal→31.4286px` ×2
  - `normal→16px` ×1
  - `normal→20px` ×1

## 5. A4 border-width 验证（回补；audit-A5-borderwidth.json 同步落盘）

- style 翻转 + 宽度 0→0（A4 删除 no-op 实证）：4229 边
- 涌现宽度 0→N：93 边 / 24 站点
- 表单 UA 边框抵消 N→0：4 边
- 非预期宽度变化：0 条

## 6. 意外项（gate 对象——必须为空或全部转登记）

（空）

## 7. 已登记例外（R:registered）

（无）

## 8. 未采集属性（冻结属性集外，覆盖方式登记）

- a 链接 text-decoration 移除（19 Link 站点）——冻结属性集未采集；§2.4 目检覆盖
- 裸 button background-color buttonface→transparent——属性集仅含 color(表单)；A1_RED 组1 四项归零门禁覆盖
- ::placeholder gray-400 / textarea resize:vertical——伪元素/交互属性不入快照；§2.4 目检覆盖
- disabled cursor not-allowed——交互态不入快照（informational）
- divide 线涌现（TeamBillingPage:140，唯一站点）——团队账单页不在 8 门禁页；emergence-adjudication-A4.json 已登记
- img/video max-width:100%（19 处裸媒体全带 h-full，低风险）——§2.4 目检抽查覆盖
- img/svg display:block + vertical-align:middle——display 不在冻结属性集；几何层 rect 归因 + §2.4 目检覆盖

## 9. §2.4 目检清单结果（人工/预览实测 2026-09-18；§1-§8 为机械部分，本节人工追加——重跑 differ 会覆盖机械节）

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
