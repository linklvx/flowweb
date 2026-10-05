<!-- doc-status: canonical | anchors: - | superseded_by: - | verified_at: 2026-10-06 | verified_at_commit: 4af57719 -->
# CSS 基础层根因修复 + 浅色/深色主题切换 实施计划（plan）

- 日期：2026-09-18　|　版本：v1.3（吸收第十轮三份复核；关键实证：**hex+斜杠正常**（`rgb(74 222 128 / 0.5)`，"丢 alpha"复核实为误测）/ **divide 线现状全站不可见**（宽度在子元素+UA style:none，preflight 开后涌现）/ 涌现裁定维度拆列（裸 border ~324 逐处裁定 vs 带色 ~238 几乎全保留）/ ring 5 处 ≥4 跟随域 / login 岛根无 border 声明（岛根 computed 断言取代探针注入）/ --ve-border 间接链 index.css:31）
- 状态：待用户确认
- 关联 spec：[2026-09-18-css-base-layer-theme-design.md](../specs/2026-09-18-css-base-layer-theme-design.md) **v1.8**（本 plan 不重复论证，细节以 spec 章节为准，任务中标注引用）
- 流程：全程 TDD（先红后绿）；vitest 兜逻辑回归、Playwright 为视觉/机制门禁（spec D8）；每段独立验收、独立提交

## 0. 开放项定稿（O1-O6，v1.2 修订）

### O1 `--fw-border` 浅色值
**独立变量，浅色 = `#e5e7eb`**（与 A 段 `.light` 作用域覆盖同值，无断层；深色维持 #333）。不取 currentColor 语义。值不等登记：#333 ≠ --canvas-controls-border rgb(54,54,54)（差 3），合并处进 B 段预期变化清单。

### O2 语义 token 命名表（v1.2：accent 拆前景/填充、删同值 success、text-dim 4 档、斜杠白名单）

| token | 语义 | 深色值（现状来源） | 浅色值（草案，B0 校准） |
|---|---|---|---|
| `--fw-bg` | 页面底 | #141414（index.css body） | #f7f8fa |
| `--fw-surface` | 面板/卡片 | #1e1e1e（--vw-card-bg 现值） | #ffffff |
| `--fw-surface-dim` | 次级面板 | #262626 | #f0f1f2 |
| `--fw-border` | 边框 | #333（项目习惯色；≠--canvas-controls-border rgb(54,54,54)，登记预期变化） | #e5e7eb |
| `--fw-text` | 正文 | #e2e8f0（body / --ve-text） | #1f2329 |
| `--fw-text-strong` | 强调文本 | rgb(247,247,247)（--canvas-controls-text / --ve-text-control） | #111827 |
| `--fw-text-dim-1/2/3` | **文字淡化梯度 3 档（v1.3 收档：删 dim-4——其浅色草案 #111827 与 --fw-text-strong 撞值，且 /80~/90 共 27 处（80:8/85:4/90:15）语义近正文、归 --fw-text 即可；30 档实证为"占位/装饰"须独立最低档——EmptyState/Breadcrumb/VideoCard"暂无封面"）** | rgba(255,255,255,.30/.45/.60) | #9ca3af/#6b7280/#4b5563 系（B0 校准） |
| `--fw-accent` | 强调·**填充**用（浅深同值） | #4ade80（**来源=字面量全局分布 62+ 处 17 文件**：AuthModal/TopActionBar/CanvasTopBar/SettingsLayout/AIAssistantFAB/ProfilePage/register/templates 等 + AdminLayout.tsx:47 colorPrimary（admin 岛内）——非"AdminLayout 定义全局主色"） | 同值 |
| `--fw-accent-text` | 强调·**前景**用（v1.2 新增；v1.3 浅色档订正：#16a34a 仅 3.10:1 不过正文 AA → **#15803d 系 4.72:1**（手算，B0 工具校准；同一 token 服务文字(4.5)与描边(3.0)取严）——text-[#4ade80] 现状 17 文件前景，浅底 ~1.6:1 不可读） | #4ade80（现状同值） | #15803d 系（B0 校准） |
| `--fw-on-accent` | 强调上文字 | #141414（绿底黑字 AAA 先例 admin-console-refactor.md:259） | #141414 |
| `--fw-accent-danger` | 语义色（v1.2 删 -success：与 accent 同值即两名一值，成功语义由 accent 承担） | #ef4444（TeamDetail.tsx:330） | 按对比度校准 |
| `--fw-overlay-1/2/3` | 叠层**面/线通用** | rgba(255,255,255,.05/.10/.20) | rgba(0,0,0,.03/.06/.12) |

- 深色值原则：**= 现状实测值**（暗色零回退）；"现状来源"列 = B 段机械替换的输入
- **::placeholder 档位界定（v1.3，B0 落定）**：现状字面值 #666（AuthModal 5 处）/#999（PhoneLoginForm 2 处）/#555/#646464/neutral-500 多在恒深/营销岛内——全局 ::placeholder 覆盖只影响"没写 placeholder 色"的输入框，界定为 dim 梯度哪一档（倾向 dim-2/3）B0 定并登记
- 营销蓝 #1F6DFF（PhoneLoginForm.tsx:147）营销岛固有色豁免，不入表
- **斜杠禁令（v1.3 口径钉死）**：token 值一律单值、alpha 烤进字面值——var() 键+斜杠=**静默零输出**（本仓内存编译实证：`bg-surface/50`/`border-surface/30`/`ring-surface/40` 产物 CSS 无规则、无警告；spec §3.1 v1.7）；**hex 任意值+斜杠实测正常**（`text-[#4ade80]/50` → `rgb(74 222 128 / 0.5)`——第十轮"丢 alpha"复核实为误测，28 处 hex+斜杠现存用法无恙，无需 ESLint 禁组合、斜杠检测不扩第二路）；需斜杠能力的 token 键用 `rgb(var(--fw-x-rgb) / <alpha-value>)`（编译实证可生成）——**`--x-rgb` 须存裸通道值（`108 222 128` 型）非 hex，双档同约定；开斜杠键显式白名单、默认全部关闭**
- Tailwind `colors` 映射同名键；恒深域 token 不并入（见 B0-4 域 token 收窄 + 第⑤路驱动）

### O3 ESLint 增量机制
- **唯一规则**：颜色前缀 hex 禁令 `(bg|text|border|ring|divide|from|via|to|fill|stroke|placeholder|outline|shadow|accent|caret|decoration)-\[#`（含 `!` 变体）；不拦 style 对象字面量（归 B2-2）。**口径注记：0 hex ≠ 0 颜色字面量**（rgba(/hsl( 不在拦截面——已知接受，B5 验收表述保持"白名单外 0 hex"）
- **baseline 只覆盖新规则**；**键 = (ruleId, 文件相对路径, 违例行文本 hash)，不含行号**；B5 口径 = 新规则 0 违例；本地脚本执行

### O4 Playwright 工程（v1.2：三件套勘误 + localhost 固定 + 降级收紧）
- 位置：`apps/web/e2e/`；`@playwright/test` + `eslint`/`@typescript-eslint`/`@eslint/js` **均 A0-0 安装**（apps/web devDependencies）
- **产物门禁三阻断**（spec O4）：① preview 不读 server.proxy → `preview.proxy` **逐条复刻 4 条含 `ws:true`/`changeOrigin` 原样**；② 产物 collab 走同源 `/collab` → preview 必须代理 WS；③ trustedOrigins 默认 `http://localhost:5173` → preview `--port 5173 --strictPort` + **门禁基 URL 固定 `http://localhost:5173`**（127.0.0.1 发起登录必被拒，不用于登录流）
- webServer 四进程：`prisma migrate deploy && prisma db seed`（复用 ADMIN 账号 admin@flowweb.local/admin12345）→ API(3000) → hocuspocus(3001) → `vite build && vite preview`
- 会话：真实登录 UI 取 cookie；**加载稳定判据 = 目标元素出现 + 固定等待上限，禁 networkidle**
- **外部依赖三件套（v1.2 勘误）**：Postgres + Redis 必需（auth.ts:16 顶层 Redis 启动即需）/ MinIO 按门禁页需要 / **Keycloak 不存在**（apps/api/src 零引用，仅 .env 遗留——勿为其耗时）；就位限时 **30 分钟**，超时降级：产物只跑 login/register 公开路由 + 需登录页机制断言改 dev（?sessionToken= 可用）+ 登记缺口
- **Playwright 安装失败降级收紧（v1.2）**：只允许出现在安装手段（chromium-only/本地缓存/镜像源）；仍不可用则 **A 段不得收口**（不换验收方式——A 段验收 1/2/3/5 条全靠 Playwright）

### O5 portal 归属初判表（v1.2：admin 补行 + 规则推导 + LoginModal A 定稿）

| 弹层 | 初判 | 机制（实测落点为准） |
|---|---|---|
| 营销域 Modal 家族（LoginModal / WeChatQRModal / WeChatFollowModal） | 恒浅 | LoginModal **组件内写死** Provider(defaultAlgorithm) + `rootClassName="light"`（**方案 A 已裁**：VideoPlayerModal.tsx:62 Provider 无 algorithm → 该宿主现状本就浅色渲染（黑壳白弹窗=现状），A=零行为变更、B 才是变更；先例 video-works.md:27） |
| videos 域其余未收 container 弹层 | 恒深 | 弹层根挂 `dark` 类（rootClassName 实测落点；不支持才回退 getPopupContainer） |
| **admin 岛全部 portal 弹层（v1.2 补）** | 恒深 | App.tsx 根无 getPopupContainer → Select/Dropdown/Tooltip/modal.confirm 全挂 body → 浅色全局半半；落表按**规则推导**"所有恒深岛 × portal body 弹层"，机制同上 |
| video-editor / 视频壳全屏弹层 | 恒深 | 已收 container，不动 |

- 挂类机制：靠岛类自身声明变量+后代继承（非 `.light *`）→ rootClassName 挂 .ant-modal-root 继承链完整
- **验收断言**：弹层内代表元素 `el.closest('.light, .dark')` 命中预期岛根 + 岛 token 在全局相反时保持岛值；**C5 断言矩阵加"浅色全局 × admin 弹层"格**
- 隐患登记：VideoPlayerModal.tsx:62 getPopupContainer 首帧回退 body；TextNodeToolbar.tsx:195 portal 到自定义节点 `#node-toolbar-portal`（归画板域 D4，C5 登记）

### O6 审计脚本（v1.3：涌现拆裁定列 + 五通道 + 变量引用图）
`apps/web/scripts/css-audit.mjs`，五路输出（编译差集 + 宿主域分析，spec O6 v1.7/§2.3 v1.8）：
① 颜色债 + 涌现面 + 主题色工具类宿主岛归属三列（**D4 域映射以"渲染引用边+token 消费点"判定、路径只作初筛**——HistorySidebar（components/ 下、消费 --canvas-controls-*=画布壳）为路径口径反例注释）+ **涌现裁定拆列（v1.3）**：裸 border ~324（忘给色→逐处裁定）/ border-[color] ~238（写全被关→**几乎全保留**）/**divide 子元素线**（宽度在子元素+UA style:none=全站现状不可见、preflight 开后涌现——TeamBillingPage:140 唯一处，登记预期变化；"border-none 压 divide"场景本仓不存在）+ textarea 7 处 + **[border-*-style:*] 四格定版**（括号/内联 × 代码/测试；实测 solid 18 代码+1 测试字符串 Sidebar.test.tsx:66+1 内联 PreviewPlayer.tsx:100+**dashed 1 VideoEditNode.tsx:214**——口径 19=solid 18+dashed 1）
② 半透明族按属性×透明度分列——**五通道（v1.3）**：bg 197/12 档、border 54/10 档、text 93/11 档、**ring 5 处**（≥4 跟随域：WorkspaceToolbar:43/53/58、CreditsDropdown:156；CarouselBar:29 恒深保留）、**divide 1 处**——**分列正则吃变体前缀**（focus-within:ring-white/20、hover:ring-white/60 实证）
③ 死类家族冻结清单（25-27 处）
④ **斜杠零输出检测**：A0 首跑建存量基线（当前 0）→ 产物 CSS 存在性检查违例即红；**hex+斜杠正常（v1.3 实证钉死），不设第二路**
⑤ **域 token 引用点 × 宿主域 + 变量引用图**（v1.3 补）：--canvas-*/--ve-*/--vw-* 全组件引用点（实测：AddNodeMenu 15 处内联+HistorySidebar 2=画布壳**须语义化**；VideoHDPanel 8/VideoNodeToolbar 5/VideoTrimPanel 3=画板保留；AssetPanel 3=video-editor 保留）**+ CSS 内间接链扫描**（--ve-border: var(--canvas-controls-border)（index.css:31）——组件扫描覆盖不到的边，防 --canvas-controls-border 语义化时恒深域 --ve-border 静默联动）
产出 JSON+Markdown 存 `e2e/audit/`；**稳定键 = 文件+宿主元素特征（非行号）**

## 1. 总体顺序与提交边界

```
A0-0 工具链+门禁环境就位 → A0 审计(六路)+before基线 → A1 红用例(3红1绿) → A2 配置 → A3 ESLint → A4 单次清理pass → A5 目检+三层diff → A6 验收
                        → B0 token表+双块(深根) → B1 红用例 → B2 三通道迁移 → B3 死类 → B4 测试三分类 → B5 ESLint收口 → B6 验收(浅色基线)
                        → C0 红用例 → C1 store+防闪白 → C2 接线 → C3 JS通道清点 → C4 切换UI → C5 portal → C6 文档 → C7 验收
并行：register 浅色重做（独立任务；.light 类随此任务挂）
```

- A4 是"单次 className 清理 pass"；提交粒度：每段 2-4 个 commit；段间可暂停、可回滚

## 2. A 段任务

### A0-0 工具链 + 门禁环境就位（一切之前）
1. `pnpm add -D @playwright/test eslint @typescript-eslint @eslint/js`（apps/web）+ `npx playwright install chromium`（**v1.2：eslint 三件套在此装**，A3 只做配置）；安装失败降级只许换手段（O4），仍不可用则 A 段不收口
2. vite.config.ts 补 `preview` 段：port 5173 strictPort + **proxy 4 条逐条复刻含 `ws:true`/`changeOrigin` 原样**（server 段不动）
3. playwright.config.ts：webServer 四进程编排 + globalSetup（seed admin 复用 + USER/画布/视频夹具 + 真实登录取 cookie）；**基 URL 固定 http://localhost:5173**
4. 三件套（Postgres/Redis/MinIO 按页；**无 Keycloak**）限时 30 分钟，超时走降级判据（O4）并登记缺口
- **verify**：preview 下 login 页可载（/api 代理通）；种子会话经 **localhost** 可进 workspace（trustedOrigins 通）；React Flow 页 collab WS 可连；稳定判据生效

### A0 审计脚本 + before 基线
1. 实现 `scripts/css-audit.mjs`（O6 六路输出），跑一次冻结 → `e2e/audit/audit-A0.json`（⑤路建存量基线；⑥路产域映射清单+画板组件清单）
2. Playwright before 采集：代表性页面（login/register/workspace/videos/React Flow 页/admin/材料库 Modal + **video-editor（v1.2 补——16/18 处 solid 补偿集中于此，DOM 部分纳入、canvas/波形/时间轴动态区按 spec §2.6-2 排除）**）全元素几何快照（rect+padding+border-width+font-size+line-height）+ computed 属性快照 + **现状基线截图一套**（浅色目标基线推迟 **B2 完成后**——B0 后 B2 前是半迁移态无对照价值，v1.2 时点再订正）→ 存 `e2e/baseline/before-A0/`（含 commit hash；A5 新基线另存）**className 只存 hash+长度**（防 49 原子复合类串快照爆炸，v1.2）
3. 采集/断言脚本分离；元素配对稳定 key；排除动态区
4. 探针登记：裸 button + 父元素 font-size；WorkspaceTabBar 双臂；**aria-disabled 存量清点**（实测 4 处——A4-3 选择器变体依据）
- **verify**：六路齐全、计数对上；baseline 落盘；line-height 量级冻结；⑤路基线=0

### A1 红用例（3 红 + 1 绿守卫）
1. 裸 button **四项**归零（font 项=父级 computed 值，探针父级 A0 登记）——【红】
2. 分裂模型：**选中臂**（WorkspaceTabBar active）solid + bottom 2px + x·t 0；带 `border` 类 div used width=1px 且色=var(--fw-border)——【红】。**未选臂**（border-none）solid+全 0 单独分组【红至 A4】
3. 恒浅区**岛根 computed 断言（v1.3 改，撤回探针注入）**：login 岛根（page.tsx:19 `min-h-screen bg-[#f5f5f5]…`，实证无任何 border 声明）`getComputedStyle(el).borderColor` 解析为 #e5e7eb——**一条断言走完整级联**，同时实证 preflight `*{border-color:var(--fw-border)}` 桥接真实落地（变量直读验不到的唯一失败模式）+ .light 作用域覆盖 + 消费真实发生；**不往产品代码注入 data-testid 探针**（免测试脚手架入出货代码）；另配岛根 `getPropertyValue('--fw-border')` 直读双保险——【红】
4. 产物 CSS 顺序守卫——【绿】
- **verify**：现状跑 = 3 红 1 绿，红因正确

### A2 配置变更
1. `tailwind.config.ts`：删 preflight:false + `darkMode:'class'` + `borderColor.DEFAULT:'var(--fw-border)'` + 头部注释（含"选 'class' 非 'selector'"理由 + **"开启时全仓 dark: 使用为 0，无存量激活风险"（实测 grep 0 命中）** + `.light` 全仓无类名占用）
2. `index.css`：`:root{--fw-border:#333}` + `.light{--fw-border:#e5e7eb;color-scheme:light}` + 删 R3 补丁（保留 data-vw-shell 与 [color-scheme:dark]）
3. **仅 login 挂 `light`；register 延至 §5**（现状深色页挂 light=color-scheme 自造回退）
- **verify**：A1 组 1/2（选中臂）/3 双断言转绿、未选臂按预期红至 A4；vitest 全绿（R3 同步，允许临时跳过标记）

### A3 ESLint 恢复（spec §2.5）
1. flat config `eslint.config.js`（迁移 .eslintrc.base.json；**装包已在 A0-0**）；唯一新规则=颜色前缀 hex 禁令（O3）
2. baseline-diff 脚本（键无行号、只覆盖新规则、A3 采集一次）；限范围执行
3. fixture 拦截用例；**验收命令写死 `pnpm --filter @flowweb/web lint`**；声明 apps/api lint 脚本不在立项范围（root turbo lint 全仓红属已知，不阻塞）
- **verify**：fixture 红→绿；baseline 键结构正确；验收命令可执行

### A4 单次 className 清理 pass
以 A0 审计清单（语境列+四格）为工作清单：
1. 全删类：`box-border` 46 / `[border-*-style:*]` **solid 类名 18 处代码 + dashed 1 处（VideoEditNode.tsx:214，与 border-dashed 同串纯冗余）**（+测试断言字符串 Sidebar.test.tsx:66 随源码同步删；+内联 1 处 PreviewPlayer.tsx:100 borderLeftStyle 顺带删）/ `font-[inherit]` 5 / `list-none pl-0` 5 处代码 + 测试断言 4 处同步 / textarea 覆盖层 `text-inherit`+`p-0`（**裸 border-dashed 不构成清理类：4 处全带宽度，preflight 前后行为一致**）
2. 子集删（精确口径）：`cursor-pointer` 210 中 button/[role=button] 子集；`bg-transparent` 133 中 button 与 input[type=button/reset/submit]（hover:/条件表达式保留）；`border-none` 94——**静态规则为主（v1.3，取代 diff 反推主流程）**：border-none 只设 border-style、无"遮挡宽度"能力 → **同串有宽度类（含带值 border-b-2）→ 保留**（实测全仓真冲突不存在）；**无宽度类 → 纯冗余可删且删后宽度不变**（本就无宽度）；**antd 宿主（祖先/自身含 ant- 前缀类）一律跳过**（静态兜底，防未采样路由漏网）；`opacity-0 group-hover:opacity-100` 宿主人工裁定——**A5 属性层 border-width 校验作兜底**（非主流程：border-box 下加边框不改 rect、几何层必漏，**属性层 border-*-width 才是判据**——实现时勿从属性集省掉）；A5 回补清单回写审计 JSON
3. disabled 光标：index.css 一行 `button:disabled, button[aria-disabled="true"], [role="button"][aria-disabled="true"] { cursor: not-allowed }`（aria-disabled **产品净 1 处** VideoTrimPanel.tsx:168，另 3 行为测试——v1.3 口径订正）；预期变化清单登记为**"项目级默认值改变"（preflight default → not-allowed）而非 bug 修复**；既有 6 处 `disabled:cursor-not-allowed` (0,2,0) 继续覆盖无害
4. 涌现裁定（O6① 拆列驱动：裸 border ~324 逐处"保留/修剪"、border-[color] ~238 预登记"几乎全保留"批量过、**divide 线 1 处（TeamBillingPage:140）登记预期变化"现状无分隔线→涌现"**）；5. 死视觉附带审计（textarea 5）；6. 测试断言同步换口径；7. **未选臂断言转绿验收**；**画板内裸 border 裁定前提（A2 修复登记）：canvas ReactFlow wrapper 已钉 colorMode="dark"——裁定画板内裸 border 取值时子树 `--fw-border` 解析 #333（非 #e5e7eb），无 .light 撞名残留**
- **verify**：审计 diff 逐条勾销；未选臂组绿；vitest 全绿

### A5 目检 + 机械 diff 收口
1. after 快照（另存 `baseline/after-A/`）→ **三层 diff**：属性层聚合（**border-*-width 必在属性集内**——border-box 下加边框不改 rect、几何层必漏，属性层是 border-none 删除的唯一判据；**border-*-color 亦必入属性集（A2 修复补登）**：颜色分叉（如 #e5e7eb vs #333 撞名类症状）宽度层测不出，只有 color 维可捕捉）/ 几何层逐元素 rect / line-height 二分统计（对照 A0 冻结值）；A4 border-width 校验结果回写审计 JSON
2. §2.4 目检清单逐条（含补三项：a 下划线 19 处 Link、hr/table/fieldset/iframe、img/video max-width 裸媒体）
- **verify**：机械 diff 意外项=0；目检勾完；两代基线并存

### A6 A 段验收（spec §2.6 六条逐条过）
- **verify**：A1 全绿（含未选臂）+ diff 意外为空 + 顺序守卫绿 + 涌现留档 + ESLint fixture + vitest 全绿 → commit

## 3. B 段任务

### B0 token 表定稿 + 双套落地（v1.2）
1. O2 表校准（含 --fw-accent-text 浅色档对比度、text-dim 4 档、~38 处 dim 归并变化登记预期清单）
2. `index.css`：**`:root,.dark {…深} / .light {…浅}`（.light 在后）** + ::placeholder 覆盖 + A 段单值块并入
3. Tailwind colors 同名映射（单值；**开斜杠键白名单默认全关**，开时 `--x-rgb` 裸通道值双档同约定）
4. 域 token 按**第⑤路产物**裁定（v1.3 补间接链）：--canvas-handle-*/--edge-flow-*/--canvas-shadow-*/--z-panel 永不并入；**--canvas-controls-* 按引用点宿主域**——AddNodeMenu 15 处+HistorySidebar 2 处（壳）**语义化**，画板/video-editor 引用保留；--ve-*/--vw-* 域内保留；**--ve-border: var(--canvas-controls-border)（index.css:31）间接链**——--canvas-controls-border 若语义化，恒深域 --ve-border 静默联动，B0 依第⑤路变量引用图裁定（border 直接引用点全在恒深域 → 保留，链无害，登记）
5. **斜杠检测自此常驻**（⑤路；**B0 实现偏差登记**：门禁实现为源码字面量扫描 `--slash-gate`（免构建快速通道），非 spec §3.1 的"DOM class→产物 CSS 存在性"形——静态类串等价且更省；动态拼接类名是盲区，**B5/B6 验收电池补产物存在性检查**兜住）
- **verify**：**html 无类=深色（单列断言——三态中唯一被 C1 改语义的状态）/ html.dark=深色 / html.light=浅值**（源序翻转口径三分开，v1.2）；斜杠检测 0 违例；**浅色目标基线不在 B0 采（移 B6）**

### B1 红用例
1. 源序断言（html.light 浅值）；2. token 工具类生效（bg-surface→var 求值）；3. 暗色零回退对照（after-A 基线 vs 现状）
- **verify**：未迁移前 1/2 红

### B2 颜色迁移（v1.2 三通道 + 画板二分 + 字面值白名单）
1. 机械替换 hex（~六成，**画板域组件禁 token 化——O6③ 画板列**）；2. 逐处判定 JS/内联/条件（~四成）
3. 白名单豁免**双条件"字面值+宿主域"（v1.2）**：#6C5CE7 **按字面值全域豁免**（VideoEditNode.tsx 在 canvas 域共 8 处、目录口径会漏）；#4ade80 前景用法→--fw-accent-text（17 文件）、填充→--fw-accent；营销蓝/Three/canvas 输出色/inline 语义色/测试夹具豁免
4. MaterialLibraryModal.css 双套化；5. 第 5 类组件 token（TopActionBar/CanvasTopBar/WorkspacePage）
6. **五通道**（O6② 属性×透明度驱动，v1.3）：text-white/NN 93 处→dim 3 档（/80~/90 共 27 处归 --fw-text，进预期清单）；bg-white/NN→overlay；border-white/NN→overlay；**ring-white/NN→overlay（≥4 处跟随域，浅色下 ring 消失）/divide-white→overlay（1 处，现状本不可见）**；text-black→on-accent；**pages/canvas 83 处按"画板（保留）/壳（迁移）"二分**（画板浅色必坏实证：OutpaintSelectionOverlay bg-white/30、TextNodeToolbar text-white/90——注意前提是"若 token 化"：画板底色恒黑字面量保留，白线在黑底两主题下均可见）
7. JS 通道按 C3 清点表
- **verify**：每通道 vitest+暗色对照；hex diff 清零（白名单外）；**第⑤路"跟随域 0 处 var(--canvas-controls-*) 内联引用"**

### B3 死类处置（O6 冻结清单 25-27 处）
同 v1.1（全屏查看器显式深色值 / EditToolbar text-fg-default / v4 词汇）
- **verify**：编译差集死类=0（白名单外）；目检

### B4 测试改造（三分类 + 负向断言独立扫）
1. className 耦合断言→token/data-testid；2. inline-style 行为断言不动登记；3. 设计常量白名单+注释（TimelinePanel.render.test 轨道色表）
4. **负向断言专项独立扫**（`not.toContain('…#hex')` 型迁移后变永真空绿——与 border-none diff 无关，一次 grep 成本≈0 不缩范围，v1.2 裁定；ProjectTitle.test:124 实证）
- **verify**：vitest 全绿；grep 字面色断言=白名单+登记项外 0

### B5 ESLint 收口
全量启用 hex 禁令 + 目录白名单禁新增 text-white；baseline 保留
- **verify**：拦截用例红→绿；新规则 0 新增

### B6 B 段验收（v1.2：浅色基线在此采）
- **verify**：暗色零回退（预期变化清单逐条对上：--fw-border 微变、dim 3 档归并、/80~/90 27 处归 --fw-text、accent-text 归并、**divide 线涌现 1 处、B3 死类显式深色值**）/ 白名单外 0 hex + 跟随域 0 text-white/black + **0 ring-white/divide-white** + **0 内联 var(--canvas-controls-*)** / 拦截用例 + 新规则 0 违例 / **浅色目标基线截图采集（B6 收尾态一次，不 double 采；B3 视觉变更登记预期清单）** / vitest 全绿 → commit

## 4. C 段任务

### C0 红用例（v1.2 增持续断言）
1. 三态切换；2. 首帧无闪白（产物环境）；3. 持久化 + 显式/系统解析区分；4. 岛三组对照组 + **持续断言「html 恒有且仅有 .light/.dark 之一」——仅放 C 段用例文件（v1.3 标注：A/B 段 html 无类是合法状态，此断言在 A/B 必误红）**；5. 岛子树无 `dark:` 前缀遍历断言（**措辞固化：断 `dark:` 前缀，不断"dark 类"——react-flow wrapper 自带 light/dark 类同名实证**）；6. 岛断言只落 Playwright
- **verify**：实现前 1-4 全红（5/6 守卫）

### C1 主题真源 + store + 防闪白
1. 内联脚本（契约：html 恒有且仅一类；system 按 matchMedia 显式挂对应类）；2. themeStore 三态+解析区分+监听+localStorage；3. useSyncExternalStore；4. 可覆写 matchMedia 桩
- **verify**：C0-1/3/4 绿；vitest 新用例绿

### C2 接线
1. App.tsx algorithm 派生；2. AdminLayout 落点实测（ProLayout className→根 DOM，否则包裹 div 防满高）+ dark 类 + 注释追加；3. VideoEditorShell 壳根 dark；4. login/register 组件根 Provider+light（LoginModal 方案 A 定稿）；5. videos 域页根双通道（/canvas 勿包）；6. **CanvasView colorMode 实测驱动裁定（v1.3 收窄+留档措辞固化：ReactFlow 默认 'light'（dist:3598）→ wrapper 现状恒挂 light 类且不跟随 OS（useState('light') 恒值分支、effect 仅 system 监听 matchMedia）；补 dark=light→dark 皮肤切换=行为变更——对比范围仅 **MiniMap（--xy-minimap-*，已全内联预期零差异）+ Controls（--xy-controls-button-*)** 两类，Edges/--xy-node-* 已自绘不全量扫；零差异→不补，留档写"**库默认 light 皮肤+自绘完整+--xy-* 消费点清点为零/已覆盖**"（勿写"测不出差异"）；有差异→逐处裁定；ProcessSnapshot 已钉不动）**；7. [color-scheme:dark] 保留+来由注释
- **verify**：岛三组绿；CanvasView 裁定留档
- **C2-6 裁定已提前至 A2 修复完成（2026-09-18，结果事实）**：CanvasView 已钉 `colorMode="dark"`——A2 复核".light 类名无占用"漏了 @xyflow/react wrapper 运行时默认挂 light 类（dist esm:3598/3606），与 `.light` 令牌岛撞名致整个画板子树 `--fw-border` 取 #e5e7eb（实测 wrapper 上解析值）。提前实测消费者清单：wrapper 自身 bg 零差（`bg-[#000000]` 与 `.react-flow` 同特异性 (0,1,0)、utilities 后序获胜）/ MiniMap 全内联证实零差 / Controls 未渲染 / Handle 已被 NodeHandle.css 归零；**两处非零差均不在 v1.3 预判的 MiniMap/Controls 通道**——`.react-flow__background` 底色（dark 默认 #141414，补 `bgColor="transparent"` 钉回）与内置 selection rect（蓝→浅灰蓝，index.css 钉回 light 皮肤蓝值）；钉后与 light 态同 seed 同 build 像素 diff=0/1,024,000（视觉零差成立）；证据＝本条计算样式实测值 + 截图（未入库，本地 apps/web/e2e/test-results/probe-{colormode,light-control}.png，临时 Playwright 探针采集）。

### C3 JS 通道接线（清点驱动）
React Flow 实例清点（ProcessSnapshot 钉/CanvasView 裁定/其他接 store 或空集记录）；WaveSurfer/canvas 重绘按宿主域（恒深不接线）
- **verify**：清点表留档；恒深实例无变化

### C4 切换 UI
入口 **TopActionBar（已裁）**+ 三态循环；/videos 内 chrome 切换钮可见=D4 已知接受项；**入口控件自身是 chrome 一部分，在恒深域内不做岛**
- **verify**：点击切换全链路绿

### C5 portal 落地（O5 表+规则推导）
每弹层按机制列落地（rootClassName/classNames.wrapper/getPopupContainer 实测落点）；closest 岛后代断言；**断言矩阵含"浅色全局 × admin 弹层"格（v1.2）**；首帧回退分支+TextNodeToolbar portal 登记
- **verify**：两主题下 computed 断言无半半 + closest 绿

### C6 红线文档修订
video-editor.md:289 / workspace-ui-polish-design / video-works.md:3491 / 其余 19 份 / tailwind.config.ts §0.3-5/6/7 三行注释
- **verify**：grep 无未废止 preflight:false 红线表述

### C7 C 段验收 + 全套 D8 门禁
- **verify**：C0 全绿（产物）+ 已知接受项登记 + vitest 全绿 → commit → 立项收口

## 5. 并行任务：register 浅色重做

register/page.tsx 深色（#0f0f0f/#1a1a1a/#333）→ 浅色营销风对齐 login + `.light` 类在此任务挂 + 测试同步。**verify**：与 login 视觉一致 + vitest。

## 6. 风险与回滚

| 风险 | 缓解 |
|---|---|
| before 基线与 §0.1 预测不符 | 按 before 实测订正 spec（模型服从实测） |
| A4 清理面大（500+ 处） | A0 六路清单（稳定键）驱动 + 分批 commit；border-none diff 反推免预分类 |
| B2 迁移视觉回退 | 逐通道暗色对照；白名单外 0 hex；dim 4 档/accent-text 预期清单；**画板禁 token 化（③画板列）** |
| 斜杠零输出静默失效 | ⑤路 A0 建基线常驻 + 存在性检查违例即红 |
| 画板/壳二分误判 | O6③ 域映射清单 A0 冻结 + 画板列禁迁移 + B6 内联 var 门禁 |
| Playwright 环境搭建失败 | 30 分钟降级（O4）；安装失败只换手段不换验收 |
| z-index/portal 回归 | O5 挂类优先；z 断言在册；closest 断言 + admin 矩阵格 |
| baseline/审计行号漂移 | 键无行号（O3 hash / O6 稳定键） |

## 7. 验收汇总

| 段 | 门禁（全过才 commit 收口） |
|---|---|
| A | 四项归零+分裂模型（选中臂 A2/未选臂 A4）+恒浅双断言（变量+探针）/ 三层 diff 意外=0 / 顺序守卫 / 涌现留档 / ESLint fixture / vitest |
| B | 暗色零回退（预期变化清单：dim 归并/27 处归 text/accent-text/border 微变/divide 涌现/B3 死类深值）/ 白名单外 0 hex+跟随域 0 text-white/black+**0 ring-white/divide-white**+0 内联 var(--canvas-controls-*) / 拦截+新规则 0 违例 / 斜杠 0 / 浅色基线落盘 / vitest |
| C | 三态+首帧（产物）/ 岛三组+closest+admin 格 / html 恒一类持续断言 / 岛内无 dark: 前缀 / color-scheme 三态 / CanvasView 裁定留档 / vitest |

## 8. 三项待确认 → 已裁定记录（v1.2，实证依据）

1. **LoginModal@VideoPlayerModal：方案 A 恒浅全仓一致**——实证 VideoPlayerModal.tsx:62 Provider 只设 zIndexPopupBase 无 algorithm → 该宿主现状本就浅色渲染（黑壳白弹窗=现状非新增断层），A=零行为变更、B 才引入变更；先例 video-works.md:27 一致
2. **C4 入口：TopActionBar**——chrome 跟随主题全局可见；/videos 恒深域内入口控件是 chrome 一部分不做岛（已知接受项）
3. **--fw-accent=#4ade80（填充）+ 新增 --fw-accent-text（前景，浅色档 #16a34a 系）+ 删 --fw-accent-success（同值）**；#6C5CE7 按字面值全域豁免（含 VideoEditNode canvas 域 8 处）；营销蓝豁免；将来恒深域强调色另立 token 不复用 accent

## 9. 实施后记（2026-09-19）

A/B/C 三段按计划全部任务完成、逐段审查通过；实施期实证订正（§0.3-4 cssinjs prepend 注入方向、A5 box-sizing 回归未复现、O5 岛归属两处翻转、O4 进程勘误等八项）汇总见 spec v1.9 修订记录。工程基线定格：web 默认门禁 20+ 测试套件、全量 vitest 2627 用例绿，ESLint 双新规则（行禁任意值 hex + no-theme-utility）与 scripts/css-audit.mjs differ/斜杠双门禁常驻；三套基线快照落盘备查——before-A0（缺陷特征化）、after-A（边框涌现修剪）、light-B6（浅色基线）。
