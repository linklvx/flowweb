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

---

## A6 验收记录（2026-09-18，A 段收口）

### (0,1,0) 档顺序核验（§2.6-3 余项 → 升格为 A1 组5 常驻测试）

方法：门禁页无交互态禁用 antd Button 可作常驻断言（disabled 态需倒计时/提交中触发，属交互路径），
按首选路径升格为规则级测试（`e2e/a1-preflight.spec.ts` A1-5）：直读 `document.styleSheets` 全局顶层
规则序（统一计数，跨域 sheet 抛错跳过），定位 antd 禁用态类规则 vs 产品 sheet 内 preflight
`:disabled`/`[hidden]`（(0,1,0) 档）+ index.css `button:disabled`（(0,1,1)），断言文档序方向。
未改任何 src/config——纯测试守卫。

实测（/login，PhoneLoginForm 挂载 antd Input/Button；preview 产物 = 门禁同一构建
`dist/assets/index-1YM-LGm0.css`，共 6 sheet，产品 sheet=5）：

| 规则 | sheet | 全局规则序 | 判定 |
|---|---|---|---|
| `:where(.css-4l8fmu).ant-input-outlined.ant-input-disabled, :where(.css-4l8fmu).ant-input-outlined[disabled]` | 1（antd cssinjs） | 24 | antd 禁用态类规则 |
| `:disabled` → cursor:default | 5（产品） | 584 | preflight (0,1,0) 档 |
| `[hidden]:where(:not([hidden=until-found]))` → display:none | 5（产品） | 587 | preflight (0,1,0) 档 |
| `button:disabled, button[aria-disabled=true], [role=button][aria-disabled=true]` → cursor:not-allowed | 5（产品） | 1480 | index.css (0,1,1) |

结论：24 < 584 < 587 < 1480——产品层（含 preflight (0,1,0) 档规则）整体落位 antd 之后，平 (0,1,0) 档
文档序后者胜恒归产品层；`button:disabled` (0,1,1) 另以特异性压 preflight `:disabled`
（not-allowed 落地，目检表上行「disabled cursor」条目即此规则）。G5 已入默认门禁，方向回归即红。
@xyflow/react/dist/style.css 复核为**并入同一产物 sheet**（非独立路由 chunk，.react-flow__* 在
index-1YM-LGm0.css 内 101,729 字节）——其层序由同一 G4/G5 守卫覆盖，无独立顺序风险。

### §2.6 六条验收

| # | 条目 | 结果 | 证据 |
|---|---|---|---|
| 1 | Playwright computed-style 实证（裸 button 四项归零 / §0.1 分体模型双臂 / 恒浅岛根双保险） | **PASS** | A1 组1–组3 常驻绿（默认套件 11 passed 中的 5 条）：裸按钮四边 solid+0px、padding 0、font-size=父级、background rgba(0,0,0,0)；选中臂 solid+bottom 2px/余 0；裸 border div 1px rgb(51,51,51)；未选中臂 solid+全 0（A4 后绿）；岛根 borderColor rgb(229,231,235) + --fw-border=#e5e7eb 双断言 |
| 2 | 意外清单为空——机械 diff 判定（两层口径） | **PASS** | `node scripts/css-baseline-diff.mjs` exit 0：意外项属性 0 + 几何 0 = 0；涌现登记闸 offender=0/漂移=0（authorized=60）；配对闸 offender=0；A4 验证 style翻转变宽0=4229/涌现93边24站/表单抵消4/other=0。机械报告 `e2e/audit/baseline-diff-A5.md`（重跑覆盖）+ 本文件上方 §2.4 目检表（人工档） |
| 3 | 产物 CSS 顺序断言（含 (0,1,0) 档） | **PASS** | A1 组4（元素级：antd cssinjs STYLE 先于产物 LINK，注入顺序回归即红）+ 组5（规则级，上节实测）；@xyflow 样式并入产物 sheet 同守卫覆盖 |
| 4 | 涌现裁定清单 + 浅/深基线截图留档（B 段对照用） | **PASS** | `e2e/audit/emergence-adjudication-A4.json`（bareBorder 118 逐处裁定/borderColorExplicit 144 批量保留/divide/auxiliaryAudits/visualVerification）+ `e2e/baseline/before-A0/`、`e2e/baseline/after-A/` 双基线齐备（8 门禁页 json+png 成对同构） |
| 5 | ESLint 可执行 + 新增行禁令拦截 fixture | **PASS** | `pnpm --filter @flowweb/web lint`：flowweb/no-color-hex 523 baselined, 0 new → PASS；拦截 fixture `scripts/__tests__/lint-gate.fixture.test.mjs`（规则拦截 + 增量门禁两组）入 vitest 计数 |
| 6 | vitest 全绿（必要不充分，兜 TS/逻辑回归） | **PASS** | `npx vitest run`：258 files / 2605 tests passed（一次通过无 flake）；`npx tsc -b` 0 错误 |

**A 段收口基线**：默认门禁 = `npx playwright test` 11 passed（4 env + 7 a1）+ 5 collector skip /
differ exit 0 三闸 PASS / lint PASS 523+0 / vitest 2605 全绿 / tsc 0。
遗留小项（非验收项，登记不阻塞）：differ 预期登记文本中「A1_RED 组1 四项归零门禁覆盖」字样已过时
（A1_RED 守卫 A6 移除，组1 现为常驻门禁）——属 `css-baseline-diff.mjs` 预期字符串与 A5 归档历史措辞，
纯标签性陈旧，随下次 differ 触碰顺手更正即可。
