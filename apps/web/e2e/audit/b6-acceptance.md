# B6 B 段验收记录（2026-09-18，B0-B6 收口）

> 一次性人工档：验收电池全量输出 + 预期变化对照表 + 浅色目标基线 meta 摘要 + 浅色目检登记。
> 机械部分 `baseline-diff-A5.md`（重跑覆盖）与本档互补；base commit `670e541e`（B5 收口态）。

## 1. 验收电池（8 项全过）

| # | 项 | 结果 | 输出 |
|---|---|---|---|
| 1 | 默认 `npx playwright test` | **PASS** | **20 passed** + 5 skipped（collector）= 16 既有（4 a0-0 env + 7 a1 + 5 b0）+ **4 b1 转常驻**（B1-1 源序结构 / B1-2 works 四探针 / B1-2 canvas 两探针 / B1-3 零回退九探针）；45.1s |
| 2 | `node scripts/css-baseline-diff.mjs` | **PASS（exit 0）** | 意外项 属性 0 + 几何 0；涌现登记闸 offender=0/漂移=0（authorized=60）；配对闸 offender=0；**B2 预期类别注册配对 43 组，本 diff 吸收 60 条**（§2 对照表）；A4 验证 style翻转变宽0=4229/涌现93边24站/表单抵消4/other=0 |
| 3 | 白名单门禁 `pnpm --filter @flowweb/web lint` | **PASS** | no-theme-utility **0 违例**；no-color-hex **261 baselined, 0 new**；存量信息 6863 条（不卡门禁） |
| 3b | 跟随域 grep 三门（B2-c 证据复核） | **PASS（0）** | text-white（精确）跟随域 **0**；ring-white/divide-white 跟随域 **0**；内联 `var(--canvas-controls-*)` 跟随域 **0**（全库 19 处 = B0 keep 精确集：board VideoHDPanel×8+VideoNodeToolbar×5+VideoTrimPanel×3+video-editor AssetPanel×3）；text-black 跟随域余 8 处 = 白名单精确集（TopActionBar:91/94/128、CanvasTopBar:151/154、CreateCanvasCard(home):32、TeamDetail:133/243——档位徽章/反白 CTA 随底保留） |
| 4 | 拦截用例（fixture interception） | **PASS** | `scripts/__tests__/lint-gate.fixture.test.mjs` 16 passed（规则拦截 + 增量门禁两组；含于下方 vitest 2614 内，另单跑复核 16/16） |
| 5 | `npx vitest run` | **PASS** | 259 files / **2614 tests** passed（一次过无 flake，83.7s） |
| 6 | 产物斜杠门禁（B5 关注#1：先构建后验） | **PASS** | `pnpm --filter @flowweb/web build`（12.8s）→ `node scripts/slash-product-gate.mjs`：15 var() 单值颜色键，src 斜杠形 0 处 → 无事可验 PASS；exit 0 |
| 7 | 源侧斜杠门禁 + `npx tsc -b` | **PASS** | `node scripts/css-audit.mjs --slash-gate`：var 键/斜杠违例 0；tsc -b 0 错误 |
| 8 | 浅色目检（B2 评审遗留 4 位点） | **PASS** | 见 §4（2 交互态探针实测 + 2 静态截图目检） |

## 2. 预期变化对照表（plan B6 清单 → 注册配对/A 段登记）

> 配对键口径 `prop before→after`（chromium 序列化）；「吸收」= 本 diff 命中条数（门禁页渲染子集）；
> 「等值换」= computed 不变天然无 diff 条目——由 b1 探针 computed 零回退 + B1-3 冻结值对照覆盖。

| plan B6 清单项 | 注册配对（b2-migration-registry.json differExpectedPairs 43 组之一）/登记 | 吸收 |
|---|---|---|
| --fw-border 微变（AddNodeMenu 域 token 语义化 Δ3） | `borderColor rgb(54,54,54)→rgb(51,51,51)`（B2c --canvas-controls-border→--fw-border ×1；门禁页菜单未开） | 0（无害预登记） |
| dim 3 档归并（/40 /50 /55 /70 + 灰阶梯 269） | `color 0.4→0.45`×5、`0.5→0.45`×9、`0.55→0.6`×2、`0.7→0.6`×4；`#888→0.45`×95、`#666→0.3`×26、`#555→0.3`×10、`#a8a8a8/#a0a0a0/#aaa→0.6`×11、`#999/#bbb/#919191→0.6`×3、`#707070→0.45`×2、`#646464→0.3`×2、`#444→0.3`×1；`borderColor #555→0.3`×8 | 1+1+0+2+0+0+0+0+0+0+0+1（表单控件渲染子集） |
| /80~/90 共 27 处归 --fw-text（含 text-white/ccc/d0d0d0 同归） | `color rgb(255,255,255)→rgb(226,232,240)`×98、`0.8→text`×7、`0.9→text`×8、`#ccc→text`×41、`#d0d0d0→text`×2、B2c `.75→text`×2 | 15+1+1+3+2+1 |
| text-black→on-accent（强调填充 5 位点）+ B2-b 近黑归并 | `color rgb(0,0,0)→rgb(20,20,20)`×5、`#111→on-accent`×2、`#0f0f0f→on-accent`×3、`borderColor #111→on-accent`×1（协作头像描边） | 0+0+0+12 |
| accent-text 归并（text-[#4ade80]→text-accent-text 21 处） | 等值换（深色档 #4ade80 精确）——无 diff 条目；b1 canvas 探针 classNeed=text-accent-text + computed rgb(74,222,128) 钉死；浅色档 #15803d 属 C 段目标（light-B6 基线） | —（等值换） |
| 卡面族归并 surface/surface-dim（border 侧） | `borderColor #2a2a2a→#262626`×9、`#222→#262626`×2、`#252525→#262626`×1、`#242424→#262626`×1 | 0（非门禁页渲染） |
| B2-b un-tiered white 残余 12 位点 | `borderColor #ffffff18→0.1`×1（Sidebar 右边）、`border-white→#f7f7f7`×2（TabBar 选中臂）、`border-white/15→0.1`×2、`#363636→0.1`×1（KSP） | 2+4+0+0 |
| B2c MaterialLibraryModal token 化 47 | `borderColor .06→.05`×6、`.08→.05`×5、`.5→.45`×4（树缩进线）、`color .75→text`×2、`borderColor .4→.45`×1（ant-modal-close currentColor） | 3+8+0+1+4 |
| B3 死类显式深色值（全屏查看器三族） | `color rgb(226,232,240)→rgb(229,229,229)`×10（neutral-200）、`→rgb(163,163,163)`×8（neutral-400）、`→rgb(255,255,255)`×2（white） | 0（查看器宿主无媒体不渲染——预登记无害） |
| divide 线涌现 1 处（TeamBillingPage:140） | **A 段登记**：emergence-adjudication-A4.json + differ 涌现登记闸 authorized=60 内（团队账单页不在 8 门禁页） | —（A 段） |
| 暗色零回退（B2 全批等值换 370+245+278） | differ 意外 0 + b1 常驻 4 用例（10 探针冻结深色值逐一对账）+ 灰阶/卡面值变化全部命中注册配对（未登记 color 配对即闸的机制保底） | —（机制覆盖） |

## 3. 浅色目标基线 light-B6（C 段浅色对照目标）

- 采集：`COLLECT_BASELINE=1 LIGHT_BASELINE=1 BASELINE_DIR=light-B6 npx playwright test e2e/a0-collect-baseline.spec.ts`（5 passed，45s）；
  机制 = collectPage 内 `document.documentElement.classList.add('light')`（每页加载后、沉降/快照/截图前注入；goto 重建文档故逐页重注入）——B 期无主题切换 UI，测试侧注入即机制。
- 产物：`e2e/baseline/light-B6/` 8 页 json+png+meta（login 40 / register 12 / works 144 / videos 123 / canvas 123 / material-modal 215 / video-editor 252 / admin-models 281 元素——与 after-A 逐页同数，键结构同构）。
- **岛不变性探针 4/4 PASS**（meta.lightInjection.islandInvarianceProbes）：
  1. videos 封面底 `#262626` 字面 → rgb(38,38,38) 保持（videos 整域 D4 恒深）；
  2. canvas html 根 `--fw-bg` → **#f7f8fa**（注入生效正向对照：跟随域翻浅）；
  3. canvas 画板 wrapper `--fw-bg` → **#141414**（wrapper colorMode=dark 携 .dark 类，`:root,.dark` 块在 wrapper 重新声明覆盖继承浅值——D4 画板恒深机制实证）；
  4. video-editor 壳底 `var(--ve-bg)` → rgb(20,20,20) 保持（--ve-* 定义于 :root 非主题块，自持恒深）。
- 数据层复核（after-A × light-B6 逐元素 borderColor 对照）：
  works 555 边 / videos 451 边 / admin 1000 边桥值 `#333→#e5e7eb` 翻浅（preflight `*{border-color:var(--fw-border)}` 桥本身是 --fw-* 消费者——admin 岛 C2 接线前无 .dark 类，桥跟随翻浅=预期；其自绘面/文本全字面不受动）；canvas 140 边翻浅（CanvasTopBar 壳）vs 304 边保持 #333（画板子树）——恰为 D4 壳/板二分的元素级切面；非桥差异全为 token 家族翻档（overlay-2 0.1→0.06 ×1、text-strong 247→17,24,39 ×4、overlay-3 0.2→0.12 ×4、MLM overlay-1 ×11、dim-2 ×4）。
- admin 观察（任务书登记项）：ProConfigProvider dark（JS token）+ 自绘字面值，--fw-* 消费者≈0——html.light 对其唯一可见作用即上述桥边色翻浅（浅色下仅作者未写边色的元素受桥影响）；C2 给 admin 岛挂 .dark 后桥在岛内回深，观察成立非缺陷。

## 4. 浅色目检（B2 评审遗留 4 位点，html.light 注入态）

| 位点 | 判定 | 证据 |
|---|---|---|
| WorkspaceToolbar hover bg-overlay-3 | **PASS** | 交互态实测（不入静态快照）：新建文件夹按钮 base rgba(0,0,0,0.06) → hover **rgba(0,0,0,0.12)**（浅色 overlay 阶梯黑色 alpha，反馈清晰可见）；截图 `light-eyeball-B6/workspace-toolbar-hover-light.png`（悬停填充明显、文字清晰、页签/搜索框/视图切换全可读） |
| 档位徽章 bg-[#a855f7]/bg-[#3b82f6] + text-text 浅色可读性 | **PASS** | gate 用户无 tier 页面不渲染→合成注入实测（真实产物 CSS）：对比度 ultra **9.78** / max **3.99** / pro **4.29** / free **8.27**；max/pro 低于 4.5:1 但**严格优于暗色现状基线**（#e2e8f0 于同底仅 3.20/2.98——浅色反而改善），12px bold 装饰性状态芯片可读；截图 `light-eyeball-B6/tier-badges-light.png` |
| MaterialLibraryModal 浅色（47 处 token 化翻转） | **PASS** | `light-B6/material-modal.png` 目检：弹层内部全浅色连贯——白面板/浅灰树侧栏（角色/场景/道具/风格/音效深字可读）/蓝操作按钮（选择文件/批量操作）/空态文案正常；无破相色块、无浅上浅文字 |
| TopActionBar/works 壳浅色 sanity | **PASS** | `light-B6/works.png` 目检：站点底 #f7f8fa、侧栏/顶栏白、工具栏/面包屑/卡片网格浅色干净全可读；仅存深色元素均属刻意——公告条品牌深蓝（白名单）、画布封面渐变缩略图（内容）、微信绿/头像绿强调 |
| （附）canvas 顶栏浮层药丸观察 | **登记（C 段打磨项，非阻断）** | CanvasTopBar 三药丸 = `bg-[#1A1A1A]/90 backdrop-blur`（白名单斜杠族字面）叠于恒深画板——浅色下保持深色玻璃质感、与画板底连贯（D4 语义内）；裸 border 桥色翻浅 #e5e7eb（深玻璃上一圈细浅边，非破损）；C4/C5 若需浅色化可改 overlay token，留 C 段裁量 |

## 5. B 段收口结论

**B0-B6 全部完成。** 收口基线：默认门禁 `npx playwright test` **20 passed** + 5 collector skip /
differ 三闸 exit 0（43 注册配对吸收 60）/ lint PASS（hex 261 baselined+0 new、theme-utility 0）/ 跟随域
text-white·ring/divide-white·内联 canvas-controls 三 grep = 0 / vitest 2614 全绿 / tsc -b 0 /
源+产物斜杠门禁双 0 / light-B6 浅色目标基线 8 页齐备（岛不变性 4/4）。

**移交 C 段的残留（登记非阻断）**：
1. CanvasTopBar/TopActionBar 同款 Dropdown ConfigProvider 钉深三位点（deferredToC2 登记）——C2 algorithm 接线后重裁；
2. admin 岛无 .dark 类（C2 落）——light-B6 admin 桥边翻浅观察即此项的基线证据；
3. 档位徽章 max/pro 4.5:1 差半档（暗色更差、已优于现状）——C 段若抬标准需连暗色一起裁；
4. CanvasTopBar 浅色玻璃药丸（§4 附条）——C4/C5 视觉裁量；
5. light-B6 为注入式浅色目标参照——C1 落地 themeStore 后的真实浅色态以 C 段门禁为准（差异预期集中在 C2 岛接线，非债）。
