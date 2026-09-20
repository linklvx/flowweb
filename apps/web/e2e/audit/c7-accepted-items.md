# C7 已知接受项清单（终版）+ C 段验收收口记录（2026-09-19）

> C7 = C 段验收 + 全套 D8 门禁 + 立项收口（CSS 基座/主题项目最后一任务）。§1 为已知接受项终版登记
> （全项目唯一权威清单，后续以本清单为准）；§2-§5 为验收电池输出、真实浅色对照结论与收口声明。

## 1. 已知接受项终版登记（8 项）

| # | 项 | 裁定/机制 | 证据指针 |
|---|---|---|---|
| 1 | /videos 恒深域内主题切换钮可见（D4） | **【已结案——C8 D3 路由岛拆除】** 「恒深域内嵌钮」前提消亡：videos 壳根 dark 类删除、壳内 --fw-* 直承 html 类改跟随，切换钮随跟随域 chrome 正常渲染（不再是"深域里的浅钮"并存态） | plan §8 裁定 2；commit b5f1843c（C4 立项）；C8 拆岛=router.tsx（Task 20）；守卫 G7「切换钮存在于 /works、/videos、/canvas」+ G8② 壳跟随断言常驻 |
| 2 | AppLayout 浅色 chrome 嵌深色 videos 域（D4） | **【已结案——C8 D3 壳岛/路由岛拆除】** `div.dark` 双通道岛（darkAlgorithm + dark 类）删除：darkAlgorithm 改继承 App、壳根 dark 类删，浅 chrome 嵌深域叙事消亡——壳 chrome 与域面同取跟随值 | router.tsx 注释（Task 20 订正）；commit 429736c6（C2 立项）；C8 G8② 反转断言常驻（无岛 + --fw-bg/壳底浅值） |
| 3 | WeChatFollowModal 恒深（O5 实测订正） | **【已结案——C8 D1b 拆岛改跟随】** 恒深双通道（darkAlgorithm + rootClassName dark）撤销：改继承 App defaultAlgorithm、岛类拆，html.light 下面底/文字取浅值（G8① 判据同步反转 <180=defaultAlgorithm） | c5-portal-census.json wired[0] status=exited-C8-D1b；commit 2151ff38（C5 立项）；断言 G8① 反转常驻 |
| 4 | admin 弹层 var 通道缺口挂起至 admin token 化 | admin 全域 0 文件消费 --fw-* 工具类（grep 实证），body 弹层 `closest(.dark)=null` 无可见半半；antd 通道 Pro dark context 穿透恒深。触发条件：admin UI token 化时逐弹层补岛类，届时 G8④ 断言转 true 须同步 census | c5-portal-census.json deferred（admin 条目含 trigger）；守卫 G8④ 钉住现状防静默漂移 |
| 5 | Tabs 选中色 = antd 原生蓝（#1668dc=colorPrimary） | C2 移除 WorkspacePage Tabs 钉色后随 darkAlgorithm 原生供给；对比度 ≈3.55:1 为 antd 暗色主题全库缺省（非本仓回归），与 VideosPage Tabs 历史一致（迁移前即 #1677ff 蓝选中） | b2-migration-registry.json deferredToC2.c2Removal.evidence.tabsDarkAlgorithm；commit 429736c6（C2） |
| 6 | 档位徽章 max/pro 对比度差半档（3.99/4.29 < 4.5:1） | 12px bold 装饰性状态芯片，浅色实测严格优于暗色现状基线（#e2e8f0 于同底仅 3.20/2.98）——抬标准需连暗色一起裁 | b6-acceptance.md §4（合成注入实测 ultra 9.78/max 3.99/pro 4.29/free 8.27） |
| 7 | CanvasTopBar 玻璃药丸恒深 | **【已结案——C8 Task 23 药丸 chrome 化】** `bg-[#1A1A1A]/90 backdrop-blur` 白名单斜杠族字面，叠于恒深画板——浅色下保持深色玻璃质感（D4 语义内）；裸 border 桥色翻浅 #e5e7eb 非破损。C8 D3 起本接受项失效：四枚药丸（CanvasTopBar 三处+ProjectTitle:64 同款同批）已改 `bg-surface border-overlay-2` 跟随域，四条 pairs 入册（canvas-migration-registry.json differExpectedPairs），恒深玻璃质感不再保留 | b6-acceptance.md §4 附条 + commit b5f1843c「玻璃药丸恒深裁定入册」；结案=C8 Task 23（ProjectTitle 该文件仅剩其余字面归 Task 25） |
| 8 | register 卡片较 login 短 | 注册表单内容行数少（3 输入、无协议脚注——刻意不新增内容垫高），卡片自然短于 login；版式/色板/表宽已逐项对齐（720px 卡/w-[320px] 表列宽=login PhoneLoginForm） | commit a0e9b16f（register 浅色重做）；page.tsx:24 注释 |

## 2. C7 验收电池（D8 全套，2026-09-19 实测）

| # | 项 | 结果 | 输出 |
|---|---|---|---|
| 1 | 默认 `npx playwright test` | **PASS** | **41 passed** + 5 skipped（collector）= 20 既有 + **21 c0 转常驻**（本任务撤 C0_RED 守卫）；1.0m |
| 2 | `npx vitest run` | **PASS** | 261 files / **2631 tests** passed（一次过无 flake，87.2s） |
| 3 | `pnpm --filter @flowweb/web lint` | **PASS（双规则）** | no-theme-utility **0 违例**；no-color-hex **268 baselined, 0 new**；存量信息 6867 条（不卡门禁） |
| 4 | `node scripts/css-baseline-diff.mjs` | **PASS（exit 0）** | 意外项 属性 0 + 几何 0；涌现登记闸 offender=0/漂移=0（authorized=60）；配对闸 offender=0；B2 注册配对 43 组吸收 60 条 |
| 5 | 新构建 + 双斜杠门禁 | **PASS** | `pnpm build`（12.66s）→ slash-product-gate：15 var() 单值颜色键、src 斜杠形 0 → PASS exit 0；css-audit --slash-gate：var 键/斜杠违例 **0** PASS exit 0 |
| 6 | `npx tsc -b` | **PASS** | 0 错误 |
| 7 | 矩阵覆盖注记 | **covered** | 三态持久化（G1）/首帧无闪白（G2 运行时+静态）/岛三组对照+closest（G4）/closest 矩阵（G8①-④）/html 恒一类持续断言（G4 持续）/岛内无 dark: 前缀（G5）——全部含于第 1 项的 41 内，无独立电池条目 |
| 8 | CanvasView 裁定档案核验 | **在档（历史档）；C8 D2 裁定已反转** | 原 C2-6 裁定（`colorMode="dark"` 钉死 + 两处非零差钉回 + 钉后像素 diff **0/1,024,000**）随 C8 E 表废止反转：`colorMode={mode}` 跟随翻转（CanvasView.tsx:383，深浅档各挂 .dark/.light 运行时类 + 镜像断言守卫）；`bgColor="transparent"` 钉值保留但理由改写（防 dark 皮肤默认 #141414 染灰板面，非恒深裁定残余）；selection rect 走 D-7 规则级两档断言（深浅均蓝色系钉值）。像素守卫改走 D2 快照对账（d2-ref 深档参照 sha256 固化 + `--xy-*` 复测表） | plan `2026-09-18-css-base-layer-theme-plan.md` §C2 第 6 条（历史档）；C8 spec E 表 + CanvasView.tsx:341/:382-386 + d-segment-probes D-7 + d2-board-pixeldiff.spec.ts |
| 9 | 已知接受项终版 | **本档 §1** | 8 项全登记（上表） |

## 3. 真实浅色 × light-B6 对照（C7 独有检查）

**问题**：light-B6 基线为 B 期「注入式」浅色（页加载后 `classList.add('light')`——只翻 var 通道，翻不了
antd JS 通道）；C1 落地后存在真实路径（localStorage theme=light → head 内联脚本）。C7 验证：真实路径产出
与注入路径一致的浅色主题态（`.light` 类由谁挂应无差），全部差异必须可归因于 B6 后已落地特性。

**方法**：collector 新增 `REAL_LIGHT=1` 模式（a0-collect-baseline.spec.ts——context/page addInitScript 预置
`theme=light`，先于一切页面脚本含 C1 内联脚本；逐页断言 html 类恰为 `"light"` 落 meta）。采集 8 页至临时目录
`tmp-real-light-C7`（对照后删除，可复采：`COLLECT_BASELINE=1 REAL_LIGHT=1 BASELINE_DIR=<tmp> npx playwright
test e2e/a0-collect-baseline.spec.ts`），与 `e2e/baseline/light-B6/` 逐页配对对照：token 派生值 = borderColor
四边 ×全元素 + color ×表单控件；已知结构插入先归一再对照（C2 videos 路由页根 `div.dark` 插层剥除 /
C4 TopActionBar 切换钮首位插入 → 位序右移归一）。

**采集面断言**：8/8 页 html 类恒恰 `"light"`（meta.realLight.htmlClassPerPage）；岛不变性探针 **4/4 pass
且与 light-B6 同 id 同实测值**（videos 封面 #262626 / canvas html 根 --fw-bg=#f7f8fa / canvas 画板
--fw-bg=#141414 / video-editor 壳 rgb(20,20,20)）——岛不受动两路径一致。

**逐页对照**（token 值 = matched/compared；差异家族全数归因）：

| page | 键配对（归一后） | token 值 | 差异家族（归因） |
|---|---|---|---|
| works | 144 配对 + 4 插入（C4 钮子树） | **592/592 = 100%** | 无值差异 |
| canvas | 123 配对 | **506/506 = 100%** | 无 |
| material-modal | 215 配对 | **881/881 = 100%** | 无 |
| login | 40 配对 | **165/165 = 100%** | 无（岛 div.light 双路径本征浅） |
| register | 4 共享键 + 8 删/14 增 | 16/16 = 100%（共享键） | 结构差异 = a0e9b16f 浅色重做（非主题机制） |
| videos | 123 配对 + 5 插入（C4 钮子树 + C2 页根壳） | 350/498 | 岛桥回深 ×140（C2 页根 .dark）+ antd colorText 族 ×8（C2 videos 路由 darkAlgorithm——B6 时点 App 无 algorithm 接线恒 antd 默认浅算法，真实路径域内 JS 通道随岛转深=双通道接线生效实证）。**【C8 D3 反转】路由岛拆除后本行方向反转**：该族 140 条 borderColor 边浅色路径保持浅值（rgb(229,231,235) 不再桥回 rgb(51,51,51)），darkAlgorithm 接线随壳改继承 App 同撤（JS 通道 8 边随之消亡）——E 表归因反转登记 |
| video-editor | 249 配对 + 3 运行时 ID（白名单同 differ） | 687/1031 | 岛桥回深 ×344（C2 壳根 .dark，自壳根 tid:video-editor-shell 起）。**【C8 D3-ve 反转】壳岛拆除后本行方向反转**：自壳根起该族 344 条边浅色路径保持浅值不桥回深（G4 ve + a0 双断言钉住无岛+浅值）——E 表归因反转登记 |
| admin-models | 281 配对（零增删） | 147/1131 | 岛桥回深 ×984（C2 AdminLayout 岛根 .dark）——C8 不动（admin 域不在 C8 范围，岛保留） |

**总口径**：原始 3344/4820 = 69.38%；剔除已归因家族 1476 边（C2 岛桥回深 **1468** = admin 984 +
video-editor 344 + videos 140，值族单一 `rgb(229,231,235)→rgb(51,51,51)`；C2 videos 域 JS 通道 **8**）
后**可比口径 3344/3344 = 100.00%，未归因差异 0 条**。

**结论**：真实浅色路径与注入式浅色的主题态**完全一致**——跟随域（works/canvas/material-modal/login 及
videos 壳 chrome）token 派生值 100% 同值；岛内桥/JS 值的回深全部是 C2 岛接线的设计行为，正是
b6-acceptance §5 移交预告「差异预期集中在 C2 岛接线，非债」的逐边实证。键位移实证一例：works 顶栏
B6 `button[0]`（w=94，BTN 字面边）与真实 `button[1]` 全值相同，真实 `button[0]`（w=32）= C4 新增切换钮
（overlay-2 浅值 rgba(0,0,0,0.06) 正确解析）——位序位移非值差异。

## 4. 收口声明

**CSS 基座/主题项目（A/B/C 三段 + register 重做）全部完成，C7 起立项收口。** 常驻工程基线定格：

- 默认门禁 `npx playwright test` **41 passed + 5 collector skip**（20 既有 + 21 c0 常驻：三态/首帧/岛/closest
  矩阵/html 恒一类/无 dark: 前缀/切换 UI/portal 弹层全矩阵）；
- 全量 vitest **2631** 绿；lint 双新规则 PASS（no-theme-utility 0 / no-color-hex 268 baselined+0 new）；
  differ 三闸 exit 0；源+产物斜杠门禁双 0；tsc -b 0；
- 三套基线快照备查：before-A0（缺陷特征化）/ after-A（A 段收口）/ light-B6（注入式浅色参照）+ 本档 §3
  真实浅色对照结论（临时采集已删，方法论与归因表在档可复跑）。

**剩余已知缺口（登记非阻断，指针）**：
1. admin 岛化挂起——admin UI token 化（未来项目）时逐弹层补岛类，触发条件与实证登记于
   c5-portal-census.json deferred（G8④ 届时转 true 须同步）；
2. 档位徽章 max/pro 对比度抬档需连暗色同裁（§1 #6，b6-acceptance §4）；
3. CanvasView colorMode 裁定已留档（§2 #8），后续升级 @xyflow/react 时按同口径复测两类通道
   （--xy-minimap-*/--xy-controls-button-*）。

