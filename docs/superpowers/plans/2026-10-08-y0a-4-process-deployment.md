# Y0a-4 进程与部署 Implementation Plan（v4）

> **v4.2（同日，第五轮三份报告逐条核验后修订——缺陷分布 17→7→7→6→5，性质已从"机制不工作"转为"计划片段与自身验证步骤不同步"）**：三报告自跑探针门四行全过（提取器对真 deploy.sh 4/4 提取✓/drain 续期真续窗 gateway:640-663 源码级证实✓/vitest 入口 resolve 证实✓）并认账 v4 两处更正（vitest.mjs 存在=符号链接 glob 盲区/历史破坏性迁移本方重扫=**9 文件命中**〔8 历史+基线自身含 SET NOT NULL——上轮"6 文件"系本方正则漏 DROP INDEX/RENAME/TYPE，认账〕）。本方复测证实并采纳：①**readEnvFile 未对齐 dotenv 行内注释语义**（实测 dotenv parse：`F_HASH=before # c`→`before`〔注释剥〕、`G=a#b`→`a`〔无空格也截〕、`"a #b"`→引号内 # 保留——v4 读取器三档全错=对拍首跑必红，按 dotenv 规则重写：引号分支→未引号首 `#` 截断）；②**bash errexit 对 AND-OR 非末位失败不退出**（本方 Git Bash 实测 `set -e; false && echo x; echo after`→打印 after/exit 0）+**provision_tarball/server_install_generate 全文未定义**（P0-5×P0-2 组合=首次 full 在半铺底状态继续跑）——deploy_full 改三行顺次调用+provision_tarball=原 deploy.sh:29-37 逐行搬运（install/generate 单点=deploy_api，删 server_install_generate 双源）；③**T1 Step 0 顺序倒置**（env.ts:3 实测未导出——先改 import 必全红被误诊）拆 0a（export 先行）/0b（换 import）；④**MINIO_USE_SSL 严格 enum=本批唯一能硬失败启动的变更且服务器现值未采集**——改 normalize 不 reject（`toLowerCase()==='true'`——消灭反相且不新增启动失败面）+M0[2] 补采+T12 前置断言；⑤**SWITCH_BEGUN 失败复位使半态 trap 成死代码**（trap 打印与内联消息相反指引）——删复位；⑥**红相③不可能红**（pre 未带 GIT_SHA⇒st.sha=null⇒断言跳过）——演练带 SHA+三态断言；⑦**基线只取首采样且不升级**（drain 200 后首次 getReady 抖动⇒'unavailable' 落盘⇒pre pass+post 必 fail）——pass/force 放行点收口；⑧**+3 溯源在 rollback 后说谎**（export 当前 HEAD 给上一代 dist）——`dist/build-info.json`（git+builtAt）进产物，cutover/rollback 从产物派生；⑨**spool 迁移时点使迁移失效**（run#1 preflight 15-20min 无 drain 窗口旧实例续写旧目录=迁移副本陈旧而 +5 仍报未丢）——迁移移进 cutover ③.5（guard 后切换前，秒级窗口）+目录迁出部署树（`/home/ubuntu/flowweb-data/collab-spool`）；⑩**shared dist 在 drain 前被替换**（与 lockfile 惰性 require 理由同类）——移进 cutover ④；⑪**main.ts:52-54 catch 后启动继续**（实测——上轮"启动失败即进程退出故无害"登记为事实错误，认账）1 行 disconnect 收口；⑫additive 基线存在性断言（常量打错=fresh 恒空=永久豁免且仍输出 OK）+DROP INDEX 降 WARNING（prisma 重建索引最常见良性破坏语句，硬拦训练绕过）；⑬令牌指纹回显（明文不进终端/会话记录）+api 模式补传 apps/web/package.json（frozen 跨 workspace 校验）+USED 正则 fail-closed+sha256 先验后换（校验 dist.next 在 mv 前）+drain 续期查 r.ok+提取器注释剥离改"整行+空白前行尾"（`${#var}`/引号内 # 防误伤）+PEM 用例去空转+dist 新鲜度锚+export 白名单锚+.env.example 补必填 5 键（实测 9 行仅 SMS+限流——只补 COLLAB 族=误导性契约）。**驳回 4 条**（§0.5 第五轮块）：git 断言被 skip 跳过（**误报**——v4.1 评四 P1-2 已移出收据分支，skip 路径仍执行）/裸 AND-OR 锚（形态修复已消灭+误伤 `[ -x ] && exit 1` 惯用法）/build-info 含 mainJsSha（冗余——sha256sum -c 已断言）/MinIO 自动冒烟进部署链（冒烟域=spec §4.4 collab；改 T12 人工一行+Y0.5 产品面冒烟登记）。**元建议采纳**：TDD 纪律补"片段即产物"——plan 代码块须从工作树粘贴或脚本抽取，禁止手写转述（四轮缺陷同形状的根因）。

> **v4.1（同日，第四轮第三份报告〔此前误作重复未消化——实为独立报告〕逐条核验后增补）**：B5/T2 测试无鉴别力属实（guard:12 `'' ?? PROM`→`''` 非 nullish→`!token` 先抛——设空串在改动前后都绿=假门禁，**改 delete 造"未设"+回填用 delete/else 防 `'undefined'` 字符串污染**）；J1/runbook §4"零消费"陈述与实测不符属实（**1012 已被消费**：canvasCollabRuntime:107/:837-841+conn.spec:213-264 计划内重启静默+短退避；write-frozen 零消费；503 走通用红点——**Y0b 工作项改"消费 write-frozen+503 语义化"，勿重做 1012**）；B7/ready 全程不可达仍按"有账"放行属实（observed 标志补——无账=unobservable 不可 force，"ready 不可达"与"未排空"分开报）；B6/T12 Step 2 先于 ecosystem 上传必红属实（**run#1 与 pm2 迁移同体**——cutover ⑤ 本就 startOrReload，Step 2 改后置自证）；A3/prisma CLI 是 devDep 却被部署链 load-bearing（`--frozen-lockfile --prod=false` 显式契约）；J7/verify 链的 check-no-testutils 校验的是将被 rmSync 丢弃的产物（**移到 deploy_api build 后=检查即将上传的 dist**）；A2/连接池"三实例×10"量纲错（instances:1——改"每进程 PrismaClient 客户端数×connection_limit"）；A6/A7/绑定面收窄与 drain deny 零检测式（ss 断言+计数断言补）；J6/spawn 失败 exit 2 三分法；J9 文案与代码不一致（force 实际覆盖 fail/wait）；J10/fetch 失败降级 WARNING。**驳回五项**（§0.5 第三份报告块）：nonce 方案（pre 覆写+SHA 已覆盖）、decidePost pm2 自证（bash 判据面扩大）、A1 单例化 useValue 案（**三驳**——采纳其三事实登记 E46 执行注记：三客户端+main.ts catch 泄漏+池算术→Y0.5）、J8 删 MAX_LOADED_DOCS（**三驳**——spec 点名）、dist 计数锚（构造性保证+耦合构建产物形态）。**元建议采纳**：TDD 纪律加**探针门**——§0.6 每行探针须在实现前实际执行、输出粘 commit message、夹具先证"坏夹具必非零"（三轮缺陷分布 17→7→7 同模式的根因="填表"而非"跑表"）。

> **v4（2026-10-08，第四轮外审两份报告〔报告二/三为同文重复〕逐条核验后修订）**：v3 设计层获确认（"判断层已站得住——勿改清单 9 条照单保持"），**但 §0.6 推演表是"计划"非"结果"——评审跑了两行探针两行证伪，本方复测再证实并追加**：①`check-ecosystem` 函数体提取正则 `\n\}` 对单行夹具恒无匹配（夹具红/真文件绿——正样本测试首跑即红）；②`spawnSync('pnpm')` Windows 开发机 ENOENT（本方实测复现——preflight-int 恒红，"Node 化"引入 bash 版没有的 Windows 陷阱）；③T12 令牌写入 ssh 惯用法远端语法错+`$1` 恒空+重复键追加（四缺陷）。**修复动作自身引入 3 处新缺陷**：epoch 状态文件只在轮询后写→run#1 `--allow-legacy` 必在重启后 post 段红+trap 指导回滚刚上线的正确构建；NaN 经 JSON 往返成 null→`Number(null)=0` 恒过 isFinite=接管断言退化恒真；条件 install 先 scp 覆盖远端 lockfile 再比哈希=恒等恒跳过。**判据空转 2 处**：spool 默认目录 CWD 派生（spool:113 实证）vs ecosystem 绝对路径→首切换换空账本（+5 空转）；dist 切换 `;` 断链+`mv dist.next dist` 落进现存目录=静默空部署（+3 可伪造）。**另**：env.spec.ts 实已存在 118 行含内嵌 schema 副本（v3 写 Create=静默删 6 用例）；MINIO_USE_SSL 驳回理由"零消费者"事实错误（minio.module:17→service:41 `tls:` 有消费者且 `z.coerce.boolean()` 把 'false' 强制成 true）；drain 60s TTL 内 90s 预算必跨 TTL→decidePre 恒 wait 逼 force 日常化（spec §1.5 复发）。**v4 修订**：状态文件全路径写入+degraded 标记+epochPre `'unavailable'` 哨兵（禁 null——JSON 往返成 0）+post 段不删改 SHA 断言；drain 循环续期（每 20s 重 POST，幂等）+删 preBudgetMs 固定 90s；`restart_api`→`cutover_api` 改名+函数体提取器（`^}` 锚+提取失败即 fail）+调用图断言+ssh 作用域零构建锚；`.installed-lock-sha` 标记文件；T12 令牌服务端生成+sed 幂等+计数断言；spool 账本条件迁移+计数等式；dist 切换全链 `&&`+`test -f main.js`+本地/远端 sha256 等值；deploy_web 子 shell+dist.next+version.json；**env 键随读者规则**（BIND_ADDR 移 T4）；env.spec 改 Modify+删内嵌副本改 import；MINIO_USE_SSL enum 化（驳回记录更正）；additive 基线落常量（`20261007170319`——实测历史 DROP 迁移 6 文件非评审所报 4 个）+断言扩列+服务器 migrate 前双跑；readEnvFile 抽 `scripts/lib/env-file.mjs`+dotenv 对拍测试。第四轮驳回 3 条见 §0.5。

> **v3（2026-10-08，第三轮三份外审合并复核后定点修订）**：v2 骨架与裁决经三报告确认为正确（startOrReload/W23/dist 原子切换/pre-post 两段/双向 env 锚/env 白名单/驳回表形态——"v2 的设计判断已经站得住"），**问题集中在 v2 新增机制的工程正确性**——7 条首跑即红/静默失效全部核实并修正：①`scripts/deploy-guard.mjs` 的 `import 'dotenv'` 在 pnpm 隔离布局下 **ERR_MODULE_NOT_FOUND**（根 node_modules 实测仅 eslint 族+turbo+typescript；verify-indexes.mjs:22-23 早有此坑注释与 createRequire 先例）→ 判据载体改**零依赖自读 .env**（去引号——本仓 `DATABASE_URL` 实测带引号）；②ESM import 副作用（两个脚本顶层自执行主流程）→ `node --test scripts/` 会被 exit(1) 杀死、本地 dev 在跑时还会**真 POST /api/drain 冻结开发实例** → 拆 `scripts/lib/` 纯函数+isMain 守卫薄 CLI；③env.spec good 基线 `MINIO_ACCESS_KEY:'k'` 违 `min(3)`/`SECRET_KEY:'s'` 违 `min(8)`（env.ts:9-10 实证）恒红；④preflight `test:int` 在 DATABASE_URL 缺失时**全 describe.skip 退出码 0 假绿**（正是 check-int-coverage 立项要防的形态）→ 改 `test:int:ci`+coverage 四判据单源；⑤T12 `pm2 delete` 绕过本批全部拒重启机制且与 startOrReload 幂等自相矛盾 → 删；⑥本地构建不清 dist（nest-cli 无 deleteOutDir 实证）=幽灵代码从 src 层搬 dist 层 → 构建前 rmSync；⑦plan 文本泄漏 `BETTER_AUTH_SECRET` 真实片段（:36）→ 脱敏。判据修正：epoch 断言三失效点（`|| EPOCH_PRE=0` 吞错+NaN 恒真+node -e 解析 dotenv 同①）→ 状态文件交接+基线不可用即 fail；pre 段 15s 预算 < 退避梯 60s 封顶（gateway:39-42 实证）=保守判据必误拒→**自适应预算**（spoolFiles>0→90s）；`--force` 跨不过 drain 不可达=API 挂死时部署死锁→可达性降级放行+**unobservable 三分类**（无账可算不可 force）；出口 +3 commit 改 pm2_env 口径（ready 无 commit 字段+V17 契约不动）；+5 spool 改 total 口径（own 重启后结构性归零）。新增：失败分支推演表（§0.6——纪律 11 对称适用）；执行序重排 **T7→T5→T6→T8**（判据载体先行自证才挂 verify——B7 矛盾修）。第三轮新驳回 2 条见 §0.5（冒烟移 root scripts/=与 B1 依赖解析自相矛盾；PrismaClient 单例化维持 E46——评三"爆炸面可控"论未面对 PrismaService extends 形态的全仓注入语义）。

> **v2（同日，第二轮）**：v1 裁决骨架保留（P1 冒烟形态/P6 M-2/P8 spec 矛盾/P11 单源出口/P13 依赖序），执行面按外审修正——10 条硬阻断全修（guard 轮询缺 token→pending 两档裁剪恒超时/check-ecosystem .mjs 用 require/ecosystem 不在 tar 清单/pm2 restart 不读文件→startOrReload/COMPACT_INTERVAL_MS 真键名/空串值拒启动/indexOf+1 解析 bug/destroy 返回 void/required 注入点不在 collab-core 运行集/服务器 env 路径/本地 .env 零 token）；采纳架构项 12（W23 独立令牌/容量观测 N16/GIT_COMMIT_HASH 溯源/本地构建+dist 原子切换/部署顺序/pre-migrate 备份/preflight 强化/自测夹具/库选项 pin/COLLAB_BIND_ADDR/nginx deny+替换语义/产品面 runbook）；驳回 11 条（§0.5——own 四零维持 SV11/PrismaClient 维持 E46/default 进 schema 移 Y0c/NODE_ENV 注入移 Y0.5）。TD-27：10-05 终裁时私有，10-06 已转公有——required 须重探测（T11 分支化）。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 Y0a 末子批——**ecosystem.config.cjs 入库**（唯一源+startOrReload 幂等生效+M0 实测定档）/ **env zod 收口**（COLLAB_* 全族+真键名+空串语义+双向结构锚）/ **W23 独立停机令牌换装** / **旁路 PrismaClient 纳管** / **容量观测三件套**（loaded docs/connections gauge+ready 字段——N16 交接）/ **部署链契约化**（本地构建+dist 原子切换+drain→migrate→restart 顺序+pg_dump 备份+git/preflight 强化+RTO/epoch 断言+双客户端冒烟）/ **collab-core required 生效**（TD-27 重探测分支）/ **M-2/M-3 登记**——达成出口判据 v2，Y0a 整批收尾。

**Architecture:** 判据载体三层结构（v3/P29）：`scripts/lib/gate-decision.mjs` 纯判据函数（零 IO 零 import 副作用——isMain 守卫，node:test 唯一自测入口，**--self-test 双源已删**）+薄 CLI（**零依赖自读 apps/api/.env**——B15：pnpm 隔离布局下 root scripts/ 解析不到 dotenv，部署门必须在 node_modules 半损坏时仍可运行）+deploy.sh 只做编排（bash 不可测面压到零判据，探针全 Node 化——F10）。部署形态=**本地构建（构建前 rmSync 清 dist——B18）+dist 原子切换**（服务器 1.9GB 协居机不再跑 tsc/vite build；src 不再上传）。进程定义唯一源=ecosystem+`pm2 startOrReload --update-env`（幂等迁移+每次部署常规门）。拒重启三步=deploy-guard（**全程带 token**+**unobservable 三分类**〔无账可算 --force 不覆盖〕+**自适应预算**〔spool 有帧→90s≥退避梯封顶——固定 15s 必误拒〕+--force 跨 drain 不可达〔API 挂死时禁部署死锁〕+**epoch 状态文件交接**〔禁 `||回退0` 吞错与 NaN 恒真〕+pre/post 两段）。冒烟=双客户端 marker 互见+readSnapshotOnly 轮询重放合一（等待=断言）+dist 导入（验部署产物）。

**Tech Stack:** pm2（startOrReload/ecosystem.cjs/守护三件套）/node:test（判据载体自测——零依赖）/Node 22 原生 WebSocket（provider 于 int 套件 node 环境实证）/zod（env 契约+preprocess 空串语义）/dotenv（脚本自加载——与 main.ts 同序显式 path）/gh api 或 curl+PAT（分支保护 GET-merge-PUT——禁整对象覆盖写）/bash（deploy.sh 编排，语法校验进 CI）。

**执行门：** Task 0 只读实测不阻塞 T1-T10；**Task 11（分支保护变更）与 Task 12（服务器迁移+部署）为用户确认点**；Task 13 后 Y0a 整批出口请示。**Task 9（spec/文档编辑）必须晚于 T5-T8 新文件入库**（doc-gate dead-path 判定用 git ls-files——未跟踪=不存在）。

**执行序（v3 重排——B7 矛盾修：判据载体先行自证，才允许挂 verify 链）：**

```
T0（服务器实测，并行） → T1/T2/T3/T4（互不依赖，可任意序/并行）
  → T7（deploy-guard：lib 纯函数+夹具绿——不接 verify）
  → T5（ecosystem+check-ecosystem+夹具绿——不接 verify）
  → T6（smoke：provider 提升 deps+脚本+本地实测）
  → T8（deploy.sh 全部改造定稿 → 末步统一接 verify：check-ecosystem+node --test scripts/ 挂链，此刻才要求 pnpm verify 全绿）
  → T9（文档） → T10（登记） → T11【确认点】 → T12【确认点】 → T13（收尾）
```

（T5-T8 声明为原子序列：期间 verify 对 deploy.sh 形状的断言允许红，T8 末步统一收敛——不在中间任务要求"verify 全绿"。）

**TDD 纪律：** 红→绿→commit。判据载体（check-ecosystem/deploy-guard）的红相探针=各自的 node:test 夹具（唯一自测入口；对坏夹具各档必非零）。**探针前置**：新守卫附最小证伪构造；**失败分支推演**（纪律 11）：新增机制逐条填 §0.6 表（首执行失败形态/探针/失败动作）。**探针门（v4.1 升级——§0.6 从"表"变"门"）**：§0.6 每行的探针在实现**之前**实际执行一次，真实输出（含失败态）粘进对应 Step 的 commit message；node:test 夹具须先给出"坏夹具必非零"运行记录再写实现——**"分析填表"与"跑探针填表"的差=v1→v3 每轮修好上轮又在新增机制埋同类缺陷的根因**（三轮 17→7→7 的缺陷分布实证）。**片段即产物（v4.2 第五轮元建议采纳）**：plan 中的每个代码块必须是从工作树直接粘贴、或由脚本从工作树抽取的产物——禁止"手写转述"（第五轮实证：v4 的 6 处缺陷全部是"转述片段与它自己的验证步骤不同步"形态——C1 顺序倒置/C2 片段跑不过自己的夹具/C3 未定义函数，红相落在了执行者手里而非作者手里）。**跨平台纪律**：全部探针/核验命令 Node 化（禁 /tmp、printf 重定向、psql CLI 依赖）——但 spawn 一律 `spawnSync(process.execPath, [js 入口…])`（裸 'pnpm' 在 Windows ENOENT，B23/P41）。**T5-T8 原子序列**：期间 verify 对 deploy.sh 形状断言允许红，T8 末步统一接 verify 后才要求全绿。

---

## 0. 基线快照（2026-10-08 二次核验，master=850b35cd；v2 修正 v1 三处错漏）

### 0.1 代码基线表

| 位置 | 现状 | 裁决引用 |
|------|------|----------|
| `collab-ready.controller.ts:26-36` | **两档视图实证**：无有效 `x-prometheus-token` 仅返回 `{ready,reason,redis,epoch}` 四键——**`pending` 被剥离**（V17/SV16）；token=`COLLAB_ADMIN_TOKEN ?? PROMETHEUS_TOKEN`（:29）；类级 `@SkipThrottle()`（:12）**覆盖 POST /api/drain**（公网爆破面→nginx deny，T9） | P0-1/W23 |
| `collab-admin-auth.guard.ts:10-24` | `admin ?? PROMETHEUS_TOKEN` 回退（:12）；无 token 且 dev→放行（:14 fail-open）；**:19 WARN 原文"Y0a-4 应换独立令牌"=Y0a-3 明文交接项** | W23/T2 |
| `deploy.sh:21-27`（preflight） | verify+gate-collab；**无 git 状态断言、无本地 migrate、无 int 套件**（verify 排除 *.int.spec.ts——int 契约在部署路径缺席） | T8 |
| `deploy.sh:31-37`（full tar） | 清单无 `ecosystem.config.cjs` 无 `deploy/` | P0-3 |
| `deploy.sh:76-82`（api tar） | 仅 `apps/api/src`+shared src+tsconfig.base.json——**缺 prisma/scripts/ecosystem**；服务器构建 `rm -rf dist && nest build`（:92，**就地重建=guard 拒后新构建仍在盘上**，P0-9） | T5/T8 |
| `deploy.sh:57-60/:94-97` | `pm2 restart flowweb-api --kill-timeout 45000` 内联×2——restart 块整段重复两份（D5 单源化） | 契约 9/T5 |
| `.github/workflows/ci.yml:136-190` | collab-core 已在（int 池+coverage 四判据+七跑演练+防双源注记）——**剩余=required 生效（TD-27 分支重探测）** | T11 |
| `ecosystem.config.*` | 全仓零命中 | T5 |
| `apps/api/src/config/env.ts:3-44` | zod 零 COLLAB_*、NODE_ENV 不在；纯启动校验器（消费点直读=仓内既有惯例，MINIO_* 同形态） | T1 |
| COLLAB_*/COMPACT 散读全集 | **`COMPACT_INTERVAL_MS`（无前缀！）**：gateway:25 模块级 export；`COLLAB_PORT`：module:18+gateway:193；`COLLAB_DEBOUNCE`：module:19+gateway:31-34（**dev1000/else2000 双档**——NODE_ENV 影响面）；`COLLAB_TIMEOUT`：module:20+gateway:198；`COLLAB_SWEEP_ENABLED`：gateway:1100；`COLLAB_SPOOL_DIR`：spool:113；`COLLAB_SPOOL_CAPACITY_BYTES`：spool:117；`COLLAB_LEASE_TTL_MS/HEARTBEAT_MS`：lease:68-69+构造断言；`COLLAB_ADMIN_TOKEN`：guard:11+controller:29 | T1（P0-5） |
| `apps/api/.env`（本地，键集实证） | **27 键：零 COLLAB_*、零 PROMETHEUS_TOKEN**；`NODE_ENV=development`；MINIO 三键在（zod 必填）——v1 的 env.spec `good` 基线缺 MINIO 三键=合法与非法用例同红（假红） | T1/P0-7 |
| 服务器 .env | `apps/api/.env`（main.ts:3 `resolve(__dirname,'../.env')`+prisma schemaEnvPath 同源）；deploy.sh 不覆盖；仓根无 .env——**`source ./.env` 必错**；且 `.env.production` 的 `BETTER_AUTH_SECRET` 值**含 `$`/`&` 特殊字符**（bash source 会截断赋值+后台分句——禁 source 整文件，v3：具体值不写入任何入库文档）；本地 `.env` 的 `DATABASE_URL` **值带双引号**（提取供 pg_dump/psql 时必须去引号+去 Prisma 参数） | P0-7a/T7/T8 |
| `apps/api/src/main.ts:68` | `release: process.env.GIT_COMMIT_HASH \|\| 'unknown'`——**全仓唯一读点、零设置者**（Sentry release 恒 unknown） | P1-3/T8 |
| `store.metrics.ts` | 20 指标**无 loaded-docs/connections gauge**（grep 零命中）——N16 容量观测缺口实证 | A1/T4 |
| `collab.gateway.ts:192-210` | Server 配置显式 debounce/maxDebounce/timeout/stopOnSignals——**`unloadImmediately`/`quiet` 依赖库默认**（纪律 9 违例态）；listen 无 `address`（库默认 0.0.0.0——3001 公网暴露） | T4/P1-6a |
| `@hocuspocus/provider` dist:295 | **`destroy(): void`**（非 Promise）——`.destroy().catch()` 必 TypeError；kit 先例是 `await p.destroy()`（await void 合法） | F4/T6 |
| `collab.gateway.ts:216-227/:64-65/:573` | 鉴权=session 直查 DB（token=WS query 或 cookie）；docName=`project:${projectId}` | T6 |
| schema 哨兵必填集 | User{id,name,email,emailVerified}/Team{name,ownerId（**owner onDelete Restrict**）}/TeamMember{teamId,userId,role}/CanvasProject{name,teamId（**Cascade CanvasDoc/Update**）}/Session{id,userId,token,expiresAt}；perm resolve 回落 teamMember MEMBER→PROJECT_EDITOR（project-permission.service:10-27——ProjectMember 行不需） | T6/P13 |
| `canvas-doc-update.repository.ts:87` | `readSnapshotOnly(projectId): {state,updates,stateSeq}` 公开——冒烟重放单源（契约 1 两出口之一） | T6/P11 |
| `vitest.int.config.ts:10`+`vitest.config.ts:10` | int 池 include=`src/**/*.int.spec.ts`；默认池 exclude int——**注入 `*.int.spec.ts` 才进 collab-core**（`zz.spec.ts` 只红 test job=假证明）；`check-int-coverage.mjs:12` MIN_TOTAL=26（注入→27、删→复原，集合断言自愈） | P0-5/T11 |
| `docs/superpowers/`（doc-gate 语料） | 语料={specs,plans,adr}+**根级 *.md**+EXTRA_CORPUS（doc-gate.mjs:56-75）；`deployment-db-baseline.md`=DB 域 canonical（collab 运维 runbook 与之域不同、链接不合并）——**新文档必须落 docs/superpowers/ 根级**（docs/deploy/ 逃逸门禁=驳回） | D10/T9 |
| `docs/superpowers/tech-debt.md:86-90` | **TD-27**：10-05 私有仓付费墙 403（API 原文）+用户终裁"纪律代强制"；**10-06 仓库已转公有**（github_repo 记录）——免费版公有仓分支保护可用，**状态须重探测**（不可沿用 10-05 结论也不可假想已解锁） | T11 |
| `collab.gateway.ts:1198-1199` | destroy_timeout 仅 hangReason 两分型、无 destroy-failed≠timeout——M-3 未修（归 Y0c） | T10/P7 |
| `kill9-drill.ts:138` | 对 dual-client kit 零 import（仅注释借 URL 形态）——M-2 条件不成立 | T10/P6 |
| Node 环境 | 开发机 Windows：bash 可用（**runbook 写明 Git Bash 绝对路径——PATH 上的 bash 是 WSL stub，实测 E_ACCESSDENIED**）但无 /tmp 语义/psql/gh（**gh 待装或走 curl+PAT**）；CI ubuntu 可跑 bash -n；**`spawnSync('pnpm')` Windows ENOENT（本方实测——pnpm 是 .ps1/.cmd，Node 不解析；子进程一律 `spawnSync(process.execPath, [js入口…])`）** | F10/T11/P41 |
| `apps/api/src/config/env.spec.ts` | **实已存在 118 行/6 用例，:4-18 内嵌 schema 副本**（本仓第二契约源；v3 误写 Create=覆盖即静默删测）；既有用例 good 基线不含 WECHAT 键（全部 default）——import 真 envSchema 后零破坏 | T1/P42 |
| `deploy.sh:100-108/:63-69` | 分派 `api) preflight; deploy_api ;;`（**--rollback 会先吃全量 preflight**）；deploy_web:65 `cd "$(dirname "$0")/apps/web"` **改变后续全部相对路径基准**（deploy_full 组合序污染源）；:69 远端 `rm -rf * && tar xzf -` 就地替换=**秒级 404 资产窗口** | T8/P43 |
| `collab-spool.service.ts:113` | 默认目录 `join(process.cwd(), '.data', 'collab-spool')` **CWD 派生**——旧实例未设 COLLAB_SPOOL_DIR 时目录随 pm_cwd 走；ecosystem 切绝对路径后若旧 pm_cwd≠/home/ubuntu/flowweb ⇒ **首切换面对空账本**（触发与否=M0[4] readlink 实测定） | T0/T12/P44 |
| `collab-lease.service.ts:149-154/:293` | CAS **无条件 `epoch = epoch + 1`**（含同 owner 重获）；release 只清 owner/expiresAt **不清 epoch** ⇒ 重启后 epoch_post=epoch_pre+1 恒成立——epoch 接管断言语义成立（第四轮复核确认） | T7 |
| minio.module.ts:17+minio.service.ts:41 | **MINIO_USE_SSL 有消费者**（`useSsl: env.MINIO_USE_SSL`→`tls: config.useSsl` 传 S3Client）；`z.coerce.boolean()`（env.ts:12）把 `.env` 的 `'false'` 强制成 `true`（Boolean('false')=true）——v2 驳回理由"零消费者"**事实错误**；AWS SDK v3 S3ClientConfig 无 `tls` 字段（键终被丢弃=行为侥幸无差） | T1/P45 |

### 0.2 事实锚（v2 修正+新增）

| # | 事实 | 证据 | 消费点 |
|---|------|------|--------|
| B1′ | **pm2 `restart <name>` 只用进程登记快照（pm2_env），不重读 ecosystem 文件**——改文件后 restart 静默不生效；`startOrReload ecosystem.config.cjs --update-env` 重读文件且幂等（fork=stop〔SIGTERM+登记 kill_timeout〕→start） | pm2 语义（外审三份共识+spec §4.1 runbook 自证） | T5/T12 |
| B2 | Node 22 原生 WebSocket——provider 于 vitest node 环境 int 套件实证（kit:70） | dual-client-server.ts | T6 |
| B3′ | **tsx 与 PrismaClient 运行时不加载 .env**（仅 prisma CLI 加载）——脚本必须 dotenv 自加载（`config({path: resolve(__dirname,'../.env')})`，main.ts:3 同序同 path） | collab-compact.ts:2 用法注释自证 | T6/T7 |
| B4 | provider `destroy(): void`——同步调用，禁 `.catch()` 链 | provider dist:295 | T6 |
| B5 | Nest dispose 先于 onApplicationShutdown——SIGTERM 后 ready 不可达，停写只能发生在 restart 前（SV12） | Y0a-3 库锚 | T7 |
| B6 | Team.owner onDelete Restrict→哨兵清理序 session→teamMember→canvasProject（Cascade）→team→user | schema | T6 |
| B7 | 服务器 `pnpm install` 无 --prod（含 devDeps）；但**判据载体不得依赖 devDeps 假设**——smoke 改 node 直跑 .mjs（tsx 摆脱）+dist 导入（验部署产物） | deploy.sh:40+外审 A10 | T6 |
| B8 | NODE_ENV 八读点影响面（**v2 全量**）：auth.ts:43 cookie Secure/api-caller:85 FAKE_AI/prometheus-auth:7 fail-closed/**spool:570 production 相对路径 throw**/**admin-guard:14 dev fail-open**/**debounce 双档（dev1000/else2000——RPO 窗口随档翻倍）**/update-profile.dto:18-27（require_tld+https+头像白名单）/main.ts:67 Sentry env——**正式注入+审计归 Y0.5/E58 一体**（本批只 M0 实测现值+登记） | 评审 D3 逐点核验 | T0/T13 |
| B9 | GitHub 分支保护 `PUT` =**整对象覆盖写**（未提交字段回落默认）——必须 GET 全量→仅改 contexts→PUT 整份；且 required checks 可用性=仓库档位函数（公有免费可用的状态需 T11 实测探测） | GitHub API+TD-27 | T11 |
| B10′ | ~~test/doc-gate 已 required~~ **证伪**：ci.yml:54-55 只是一句注释非事实——required 状态以 `GET /branches/master/protection` 实测为准（T11 Step 1） | 评审二 F5 核验 | T11 |
| B11 | `@SkipThrottle` 类级覆盖 drain 端点（controller:12）；deploy-guard 走 127.0.0.1:3000 直连不经 nginx→**nginx `location = /api/drain { deny all; }` 零副作用**（只断公网） | controller+nginx 语义 | T9 |
| B12 | dotenv `config()` 不覆盖已设 env（脚本 env 显式传入优先）——本地/服务器同路径自加载安全 | dotenv 语义 | T6/T7 |
| B13 | `z.coerce.number()` 对 `''` 得 0（`.positive()` 拒）；`z.enum` 对 `''` 拒——**空串=未设必须 preprocess**（本仓 .env 已有空值实证：NODE_ENV= 空值是 E41 记录的既有事实形态） | zod 语义+P0-6 | T1 |
| B14 | hocuspocus listen 默认 `address: '0.0.0.0'`（dist 实证）——`COLLAB_BIND_ADDR` env 支持（默认值维持）+ecosystem 注入 127.0.0.1 | 库 dist+评审 P1-6a | T4/T5 |
| B15 | **pnpm 隔离布局**：根 `node_modules` 仅 eslint 族+turbo+typescript（实测清单），`dotenv`/`@hocuspocus/provider` 等包级依赖只在 `apps/api/node_modules`——**`<root>/scripts/*.mjs` 的裸 import 包依赖必 ERR_MODULE_NOT_FOUND**；仓内既有先例=verify-indexes.mjs:22-23 注释+`createRequire(join(ROOT,'apps/api/package.json'))('pg')` | 根 node_modules 实测+评二/评三 B1 | T7/T8 |
| B16 | **ESM import 副作用**：模块被 import 时执行全部顶层代码——判据脚本顶层自执行主流程（v2 形态）会令 `node --test` 导入即 `prePhase()`→exit(1) 杀测试进程；本地 dev 在跑时还会**真 POST /api/drain 冻结开发实例**（判据载体污染被测系统） | Node ESM 语义+评二 B2/评三 B2 | T5/T7 |
| B17 | **provider 是 devDependencies**（apps/api/package.json:59）——服务器可跑依赖"pnpm install 无 --prod"未验证假设；`yjs` 在 dependencies ✓ | package.json 实测 | T6 |
| B18 | **nest-cli.json 无 `deleteOutDir`、api build 无 rm -rf dist**（实测）——本地构建不清 dist=删除/重命名源的旧 .js 残留随 tar 上传（幽灵代码从 src 层搬 dist 层） | nest-cli.json+package.json 实测 | T8 |
| B19 | **退避梯 `[1,2,5,15,30]s` 封顶 60s**（gateway:39-42 实证）——PG 恢复后 spool 帧最长等 60s 才重试；pre 段固定 15s 预算 < 梯上限 ⇒ 保守判据在"PG 已恢复但梯未触发"窗口必误拒（spec §1.5 已消灭的"force 日常化"复发形态） | gateway 实测+评三 J1 | T7 |
| B20 | **`unloadImmediately` 是两个旋钮**：Connection 级（d.ts:431/A6 锚所指——`DirectConnection.disconnect` options，调用点 collab-document.service.ts:39 现裸调）与 Server 级（d.ts:739/Document 卸载语义）——v2 P24 只钉了后者 | 库 d.ts 实测+评三 A6 | T4 |
| B21 | **`collectDefaultMetrics()` 已在**（metrics.service.ts:15）——`process_resident_memory_bytes`/`nodejs_eventloop_lag_p99_seconds` 等默认指标已有载体，runbook 阈值直接引用真名即可 | 实测+评三 A1 | T9 |
| B22 | **`pm2 jlist` 输出混排**：与 `pm2 startOrReload`/`pm2 save` 同一 ssh 会话时 stdout 含 `[PM2] …` 前缀行——`indexOf('[')` 解析必炸；jlist 断言须独立 ssh 调用 | 评三 B6 | T12 |
| B23 | **JSON NaN 往返**：`JSON.stringify({x:NaN})`→`{"x":null}`；`Number(null)`=0 且 `Number.isFinite(0)`=true——状态文件用 null 中转 NaN=接管断言退化恒真（v3 形态）；哨兵必须用字符串 `'unavailable'`+typeof 判 | JS 语义+评四 P0-2 | T7 |
| B24 | **ssh 远端串既非 `bash -s` 也不设位置参**：`ssh host 'script' _ arg` 整串交 `sh -c`——`"$1"` 恒空；`{ …; } _ arg` 尾随参数=语法错。密钥类值**禁经 argv/内插**，一律服务端生成 | ssh/POSIX 语义+评四 P0-3 | T12 |
| B25 | **`--update-env` 把当前 shell 全量 env 记入 pm2_env**（pm2 语义）——部署会话 export 的任何变量都会随 `pm2 save` 常驻；GIT_COMMIT_HASH 走 ecosystem env 白名单=死条目（它来自 shell 不来自 env{}） | pm2 语义+评四 P1-2 | T5/T9 |
| B26 | **`@hocuspocus/server` 构建产物级默认值**：Connection 级 disconnect `unloadImmediately ?? true`（默认即 true）；Server 级 `quiet:false`/`unloadImmediately:true` 同为 defaultConfiguration——P24 两处 pin=**文档锚非行为修复**（验证预算勿花在"行为变化"上）；REST 直连 disconnect 在 `connectionsCount>0` 时不卸载 doc（零连接才 unload）——`yjs_loaded_documents` 口径=WS 活跃 doc+在飞直连 | 库 cjs/d.ts 产物+评四 §4 | T4/T9 |
| B27 | **dotenv 17 LINE 正则的行内注释语义**（本方 parse 实测）：未加引号值在**首个 `#` 截断（无空格也截）**——`F_HASH=before # c`→`before`、`G=a#b`→`a`；加引号值取**首个闭引号内内容**（引号外注释丢弃）——`B2="q" # c`→`q`；**引号内 `#` 保留**——`"a #b"`→`a #b`、`'x # y'`→`x # y`；重复键后者胜✓/export 前缀✓——readEnvFile 必须逐形态对齐（v4 实现 `(.*)$` 全收+两端引号配对判断=三档全错） | dotenv/lib/main.js LINE 正则+parse 实测（第五轮评一/评三指控证实） | T7 |
| B28 | **bash errexit 对 AND-OR 列表非末位失败不触发退出**（本方 Git Bash 实测：`set -e; false && echo x; echo after`→打印 `after`、exit 0）——`fn1 && fn2;` 形态中 fn1 失败被吞、脚本继续；子 shell 包裹 `( fn1 && fn2 )` 或拆成独立语句行可恢复 errexit 语义；`[ -x … ] && exit 1` 类惯用法**不受影响**（是合法的末位条件退出） | bash 手册 errexit 语义+实测 | T8 |
| B29 | **dist 双布局实测**：`apps/api/dist` 同时存在 nest build 根级产物（main.js/app.module.js/gate-canvas-state.js）与 `src/`+`scripts/`+`prisma/` 子目录+`tsconfig.drill.tsbuildinfo`（其他 tsconfig 共用 outDir 的历史产物）——B18 rmSync 必要性硬证据；src 内 grep `dist/scripts|dist/prisma|require('./scripts` 运行时引用=**零命中**（drill 产物仅 CI 驱动消费） | ls+grep 实测（第五轮评一 P1-6 证实） | T8 |
| B30 | **main.ts:52-54 preloadDbConfig 的 catch 后启动继续**（实测）：catch 只 console.error 即返回，bootstrap 继续 validateEnv→NestFactory→listen——**进程不退出**，:41 临时 PrismaClient 的池存活整个进程（DB 抖动后的启动场景）——v4.1 T13 注记"启动失败即进程退出故无害"为**事实错误**（第五轮评三 M3 指控证实，认账）；1 行 `await prisma?.$disconnect().catch(()=>{})` 收口，与 A1 三驳不冲突（非单例化——只补关停） | main.ts:40-55 实测 | T8 |

### 0.3 plan 级设计裁定（v2 增补 P15-P28；P1-P14 详见 §0.5 对照）

| # | 裁定 | 理由 |
|---|------|------|
| P15 | **guard 判据两段制**：pre 段（restart 前）=spec §4.4 own 四零+`reason==='draining'`+spool-unwritable 拒（**维持 spec SV11 判据不变**——own spool 帧存在=append 正在失败，重启后回灌同样失败，拒部署自洽）；post 段（restart 后，新增）=ready 200 ∧ spoolFiles===0 ∧ strandedFiles===0（90s 预算=收养静默 60s+reconciler 30s）∧ epoch_new>epoch_pre（接管证明）——"部署完成"与"数据回灌完成"分开判 | 外审 A2 采纳一半：post 段采纳；pre 四零维持 spec（评审"过严"论在 spec 层重议，plan 不越权改判据） |
| P16 | **W23 独立令牌**：CollabAdminAuthGuard **删除 PROMETHEUS_TOKEN 回退**（COLLAB_ADMIN_TOKEN 未设→production 403 fail-closed/dev 放行维持）——drain=停机权只认独立令牌；ready 授权档视图（controller:29）**维持双 token**（读视图非停机权，监控令牌读 pending 合理）；deploy-guard 用 COLLAB_ADMIN_TOKEN（不再回退） | guard:19 明文交接+权限分离 |
| P17 | **check-ecosystem 断言集**（v2）：createRequire 加载+findRepoRoot（doc-gate 先例）；apps.length===1+name 定位；fork/instances:1/kill_timeout≥45000/kill_signal=SIGTERM；**RSS 口径**：`max_memory_restart ≥ old-space + 384MB`（堆 vs RSS 两个口径——Yjs Uint8Array 在外部内存不计 old-space，评审 P1-1 量纲修正）且 `max_memory_restart ≤ 1900MB`（物理粗线）；env 白名单（仅 NODE_ENV?/COLLAB_SPOOL_DIR/COLLAB_BIND_ADDR/GIT_COMMIT_HASH 允许——**禁密钥进 ecosystem**）；COLLAB_SPOOL_DIR 绝对路径；deploy.sh 无 `--kill-timeout`（正则锚 `pm2 [^#]*--kill-timeout`）；restart_api〔**v4 改名 cutover_api——P43**〕序列唯一；NODE_ENV **不断言**（Y0.5 同批） | P0-2/D7/口径修正 |
| P18 | **deploy.sh 部署形态**：deploy_api=本地构建（shared+api）→上传（api package.json+pnpm-lock.yaml+shared package.json/dist+api **dist.next**+prisma/+scripts/）→服务器 pnpm install+prisma generate→**guard（drain）→pg_dump→migrate deploy→dist 原子切换（mv）→startOrReload**→post 段+冒烟；**src 不再上传**（服务器不构建 api——幽灵代码面消失+1.9GB 内存解耦）；deploy_full 维持铺底语义（首次专用，runbook 标注日常禁用）+tar 清单补 ecosystem.config.cjs | A4/D1/P0-9 |
| P19 | **pg_dump 备份**：guard 通过后、migrate 前 `pg_dump -Fc` 到服务器 `~/backups/`（保留最近 5 份，>5 删最旧）；Task 12 附恢复验证（pg_restore 到 scratch 库+CanvasDoc 计数+drop——"备份未验证=没有备份"） | D6/P1-3 |
| P20 | **preflight 强化**：git 干净断言（`git diff --quiet && git diff --cached --quiet`）+HEAD∈origin/master（`git fetch && merge-base --is-ancestor`）+本地 migrate deploy+`pnpm --filter @flowweb/api test:int`（TD-27 纪律代强制的本地链——int 契约首次进部署路径） | P1-4 评一 |
| P21 | **smoke v2 形态**：`apps/api/scripts/collab-smoke.mjs`（node 直跑——零 tsx 依赖）；**dist 导入**（`createRequire` 加载 `dist/modules/collab/canvas-doc-update.repository.js`——验部署产物）；**双客户端**（A/B 各写 marker、断言互见+DB 重放双在——协作广播链首次上真机）；dotenv 自加载（B3′）；第 0 步断言 `/api/ready ready===true`（防只读降级误导为"未落库"）；清理失败 WARN+打印残留 id（禁静默 `.catch`）；`--skip-smoke` 由 deploy.sh 旗标透传（`./deploy.sh api --skip-smoke`） | F4/A10/D8/P0-10 |
| P22 | **guard v2**：arg 解析显式 idx 判空（修 indexOf -1）；全程 token header；`pending===undefined` 单列"token 视图缺失"档（禁与"未排空"混报）；`--allow-legacy` 显式跳过 404（默认 FAIL——"反代配错/路径错/半启动"全部 404 静默绕过=无鉴别逃生口）；--force 置顶可达（WARNING 后仍执行全流程只是不阻断退出）；pre/post 两段（`--post-restart` 模式）；结构化 JSON 结果行（drainAt/zeroAt/pendingBefore/After/epochPre/Post/elapsedMs=spec §5.1 RTO 台账）〔**v3 修订**：--self-test 内嵌夹具删除（P29——node:test 唯一入口防双源）；视图缺失档升格 unobservable（P30——force 不覆盖）；--force 对 drain 不可达放行（P30 部署死锁修）；pre 预算自适应（P30/B19）〕 | P0-1/F3/F5/P1-4/D8/A11 |
| P23 | **判据载体自测**：check-ecosystem/deploy-guard 导出纯函数+`scripts/*.test.mjs`（node:test）进 verify 链（`node --test scripts/`）——F1/F3 类缺陷 30 秒内可抓 | A11 |
| P24 | **库选项 pin**（纪律 9）：gateway Server 配置显式 `unloadImmediately: true, quiet: false`（注释标注 A6 锚联动） | P1-9 |
| P25 | **COLLAB_BIND_ADDR**：gateway listen address 支持（`process.env.COLLAB_BIND_ADDR ?? '0.0.0.0'`——默认不变零影响）+ecosystem 注入 `127.0.0.1`（nginx 同机反代唯一合法路径；gate/drill 连 127.0.0.1 不受影响）；zod 加键（有消费点） | P1-6a |
| P26 | **nginx**：snippet 改**替换语义**（`collab-location.replace.conf`+头注"替换现有 /collab block，先备份 nginx -t 失败即回滚"——同 server 双 location=duplicate 必炸）；加 `location = /api/drain { deny all; }`（B11）+`/collab` `access_log off`（E13 query token 进日志的止血——Y0b cookie-only 根治）；检测式="存在且仅一个 location /collab" | F9/D9/A12 |
| P27 | **runbook 七章**（docs/superpowers/collab-ops-runbook.md——语料内）：①pm2 迁移（startOrReload 幂等+jlist 自证+"服务器 src 目录退役可删"）②连接池（**量纲 v4.1/A2 改正**：instances:1 钉死〔E35〕"三实例×10"算术错误——正确口径=**每进程 PrismaClient 客户端数（现 3：PrismaService/authPrisma/preload 临时；单例化三驳维持 E46，Y0.5 治理后收敛 1×N）× connection_limit ≤ max_connections−协居余量**，M0 实测据实定值；与事务 timeout 同名不同量纲注记）③部署链语义（drain 60s 自动解除/force/allow-legacy/skip-smoke/失败复原）④**部署窗口与用户可见影响**（J1/R6/R7：drain 冻结全部画布写**含单人项目**/付费执行与克隆 503/≤15s+重启窗口；§9.7 Y0a-Y0b 同批部署约束）⑤**回滚**（spec §4.2 展开：revert+重新部署；dist.prev 保留一代）⑥**最小可用告警**（pm2-logrotate max_size 10M retain 7+磁盘 85% 检查+2GB swap 建议+解冻三触发线〔并发>50/doc>100/store P95>1s〕——Y0.5/Y7 迁移条件）⑦容量三数初始值（并发 WS 上限 50/常驻 doc 字节上限暂承 D7 未定标注 Y1c-3/event-loop lag 阈值 200ms——**enforcement 归 Y1c-3，数值+观测本批**，N16 交接闭环） | 交接 #5/#7/#10/A1/A7/D7 |
| P28 | **.env.example 补 COLLAB_* 全族清单**（tracked——env 契约对新人可见） | D10 |
| P29 | **判据载体三层结构（B15/B16 根修）**：`scripts/lib/gate-decision.mjs`=纯判据函数（零 IO 零副作用，node:test 唯一消费）；`scripts/deploy-guard.mjs`=薄 CLI（isMain 守卫+零依赖 readEnvFile 自读 apps/api/.env——单行 KEY=VALUE 正则+去引号+只取所需键，已设 process.env 优先；**禁 import dotenv**——部署门必须在 node_modules 半损坏时仍可运行）；`scripts/check-ecosystem.mjs`=同构（checkEcosystem 已是导出纯函数+main 加 isMain 守卫）。**--self-test 内嵌夹具删除**（node:test 是唯一自测入口——防双源，评二 C） | B15/B16 |
| P30 | **guard 判据三分类+自适应预算（B19/J1/J2）**：verdict 增 `unobservable` 档（pending===undefined=token 视图缺失/drain 401/403=凭据无效——**--force 不可覆盖**：无账可算的放行=N batches at risk 语义谎言）；drain fetch 抛错（目标不可达）=**--force 可达**（进程不可达⇒无在途写入可查，按"无停写保护"降级放行+WARNING——评二 E，修部署死锁：API 挂死时恰是最需要重新部署的场景）；pre 段预算自适应：`spoolFiles>0 → 90s`（≥退避梯 60s 封顶+余量），否则 15s——保守判据可达，force 回归"真实逃生阀"〔**v4/P40 修订：自适应已删**——固定 90s+drain 20s 循环续期取代（60s TTL 内预算必跨档=decidePre 恒 wait 逼 force 日常化+首采样盲区双根修）〕 | B19/J1/J2 |
| P31 | **epoch 状态文件交接（D 根修）**：pre 段把 `{epochPre,drainAt,commitPre}` 写 `<repo>/.deploy-guard-state.json`（gitignored）；post 段读之——**删 deploy.sh 内联 `node -e` 取 epoch（B15 同坑）与 `\|\| EPOCH_PRE=0` 吞错**；`decidePost` 对非有限 epochPre 一律 fail（禁 NaN 恒真静默通过）；post 段补 TOKEN 存在性检查 | 评二 D 三失效点 |
| P32 | **preflight int 链单源（F/J5 根修）**：新增 `scripts/deploy-preflight-int.mjs`——零依赖读 apps/api/.env 取 DATABASE_URL（同 P29 读取器）→以之注入子进程跑 `pnpm --filter @flowweb/api test:int:ci`（产出 int.json）→`node scripts/check-int-coverage.mjs`（集合≡执行集/零失败/**零跳过**/≥26 四判据——全 skip 假绿的唯一防线）→任一失败 exit 1。**禁 bash source/set -a**（B 节特殊字符）。runbook 注明：跑 preflight 前停本地 dev API（int 套件操作 CollabLease 单行全局资源——会把 dev 实例 fenced） | F/J5 |
| P33 | **构建清理+上传面断言（B3/B 补强）**：deploy_api 本地构建前 `node -e rmSync('apps/api/dist')`+shared 同法（B18）；deploy_api 上传面**补 `apps/api/scripts/` 目录**（冒烟脚本所在——评二 B 建议移 root scripts/ **驳回**：B15 已证 root scripts 解析不到 provider/prisma 依赖，物理不可行）；check-ecosystem 增断言：deploy.sh 上传清单必须覆盖 {ecosystem.config.cjs, scripts/, apps/api/scripts/}——"写了但传不上"已犯两次（v1 ecosystem/v2 冒烟），锚化防第三次 | B3/B15 |
| P34 | **溯源判据改 pm2_env 口径（J3 采纳评三）**：出口 +3 改"运行实例 `pm2 jlist` 的 `pm2_env.GIT_COMMIT_HASH`（或 /proc/\<pid\>/environ）≡ 本地 `git rev-parse --short HEAD`"——零代码改动、不动 V17/SV16 冻结契约与 shared 类型；ready 加 commit 字段登记 Y0b 可选（E55 遥测 clientBuild 同族） | J3 两案取舍 |
| P35 | **出口 +5 改 total 口径（J4）**：部署前记 `totalPre=spoolFiles+strandedFiles`（授权档）落档；post 段判据=own spoolFiles===0（boot 回灌完成）+strandedFiles 降 WARNING（收养窗 60s+reconciler 30s 异步消化，评二 O-1）+预算 90s→120s；"前后一致"旧表述作废（own 口径重启后结构性归零=语义反写） | J4/O-1 |
| P36 | **部署链四补（G/M/评一）**：①migrate 注释改对——drain 只冻结 collab 写路径（三入口门），HTTP 面（支付/执行/上传）**继续打库**→顺序安全性由 **expand/contract 纪律**承担（runbook §3 写死：迁移对上一版代码向后兼容——只加表/加可空或带默认列；删列=两步走）+`scripts/check-migration-additive.mjs` 轻量锚（prisma/migrations 文本断言**禁 DROP COLUMN/DROP TABLE**——对"旧代码在跑"必炸形态；其余 ALTER 类不拦防误伤）；②三旗标循环解析 `for arg in "${@:2}" case`+未知旗标 exit 1（M——静默忽略未知旗标是部署脚本最不该有的行为）；③SHA 收据：preflight 过后写 `.preflight-<sha>.ok`（gitignored）同 SHA 复用+`--skip-preflight` 强制打印"本次部署不构成判据"（评一 14——15-20 分钟税必被绕过，收据使常态部署秒过）；④lockfile 哈希比对未变跳过 `pnpm install`（评一 16——install 在旧进程存活期重写 node_modules 的惰性 require 风险） | G/M/评一 |
| P37 | **--rollback 快路径（评一 11）**：`./deploy.sh api --rollback`=`mv dist.prev dist && startOrReload && post 段`（30 秒，无需本地机）；trap 消息按阶段分流（切换前失败→旧构建仍在跑；切换后失败→提示 --rollback） | 评一 11 |
| P38 | **文档治理定形（N/B4/评一 18）**：runbook/server-profile 头标 `<!-- doc-status: active -->`（**不写 canonical**——canonical 身份由 C1/C4/manual.json 派生，手写头不生效且会与派生态漂移；active 受语料基础门禁、零登记成本）；canonical 升格归 doc-governance 惯例后续判断。T9/T13 若触发 canonical 漂移红：`--write-canonical` 落盘+`git diff --cached` review（canonical.json 头注要求） | N/B4 |
| P39 | **状态文件生命周期 v2（评四 P0-1/P0-4+B23 根修）**：pre 段**所有退出路径**（pass/legacy 404/force 不可达/fail）经单一 `writeState()` 写 `{v:1, sha, startedAt, drainAt, degraded, epochPre, pendingBefore}`——`degraded` ∈ `null\|'legacy'\|'unreachable'`，`epochPre` ∈ `number\|'unavailable'`（**禁 null——JSON 往返 NaN→null→0**）；`decidePost(body, epochPre, degraded)` 三参：degraded 非空→epoch 断言 **N/A 显式打印**（"接管证明由下一次非降级部署产出"）不 fail；**post 段不删 state**——改开头断言 `state.sha===process.env.GIT_SHA`（不符=fail"陈旧状态文件"），pre 每次覆写+SHA 断言=比"读完即删"更强的防串档（且 `--rollback` 同 SHA 天然可用）；pre 开头若 STATE 存在打印"覆盖上一轮（sha/age）" | 评四 P0-1/P0-2 |
| P40 | **drain 续期+固定预算（评四 P0-7 根修）**：SV12 drain 60s 自动解除——90s 预算必跨 TTL⇒reason≠draining⇒decidePre 恒 wait 逼 force 日常化（spec §1.5 复发形态）。修法=轮询循环内**每 20s 重 POST /api/drain**（幂等续期，TTL 与预算解耦）+**删 preBudgetMs**（固定 `PRE_BUDGET_MS=90_000`——循环在 pass/fail 即 break，固定与自适应在成功路径等价，异常路径少等 75s 可接受；少一个机制=少一个失配窗口——首采样 0 帧/5s 后出帧的自适应盲区一并消灭） | 评四 P0-7 |
| P41 | **子进程直跑 JS 入口（Windows ENOENT 根修）**：判据链内 `spawnSync('pnpm',…)` 禁用（pnpm=.ps1/.cmd，Node 不解析——本方实测 ENOENT）；`deploy-preflight-int.mjs` 改 `spawnSync(process.execPath, [vitest 入口, …])`——vitest 入口经 `createRequire(apps/api/package.json).resolve('vitest/vitest.mjs')` 定位（实测存在；resolve 比 hardcode 稳），cwd 钉 `apps/api`，env 注入 DATABASE_URL | 评四 P0-2+本方实测 |
| P42 | **env 键随读者规则+env.spec Modify（评四 P0-5/P0-6）**：①每个 env zod 新键与其读者**同一提交落地**——`COLLAB_BIND_ADDR` 移 T4（键随 gateway listen 同批）；②`env.spec.ts` **Modify 非 Create**（既有 118 行/6 用例）——**删 :4-18 内嵌 schema 副本改 `import { envSchema } from './env'`**（第二契约源消灭；既有 6 用例自动开始测真 schema，good 基线不含 WECHAT 键=全部 default 零破坏）；③EXEMPT 维持两条但理由升级：MAX_LOADED_DOCS 引 **spec §3 4.6 原文点名预留**（区别于被驳回的 COLLAB_ROLE=plan 自创零 spec 载明）；④方向一自测去恒真——抽 `missingReads(reads, schemaKeys, exempt)` 纯函数，自测用合成夹具（构造"读点不在 schema 且不在豁免"→必非空） | 评四 P0-5/P0-6/P1-8 |
| P43 | **cutover_api 改名+提取器+调用图（评四 P0-5 双修）**：`restart_api`→**`cutover_api`**（现函数含 guard/备份/migrate/切换/重启/post/冒烟=cutover，3am 排障名实相符）；check-ecosystem 函数体提取改**导出纯函数 `extractBashFunction(src, fn)`**（`^fn\(\)\s*\{` 定位+大括号配平，剥离 `^\s*#` 注释行；**提取失败本身=fail**——"提取不到就算过"是空转源）+断言改**调用图**：`cutover_api()` 定义恰 1、deploy_api 体调 cutover_api、deploy_full 体调 deploy_web+deploy_api、`api)` 分派对 ROLLBACK 跳 preflight（`/api\)[^\n]*ROLLBACK/`）；夹具**多行函数体**（对齐真实脚本形态）+提取器自测（多行/嵌套/单行=提取失败三档）；**零构建锚 ssh 作用域化**：`/\bssh\b[^\n]*\b(nest build\|vite build\|tsc -p)\b/` 才红（deploy_web 本地 vite build 合法——"脚本零构建"表述作废，不变量=**服务器侧零构建**） | 评四 P0-5/P0-6/P1-5/P1-12 |
| P44 | **账本与资产原子性（评四 P0-7/P1-1/§3-1）**：①spool 账本迁移——M0[4] 补 `sudo readlink /proc/$(pm2 pid flowweb-api)/cwd`+旧目录文件/字节计数；T12 Step 1.5 若旧目录≠新绝对路径则 `rsync -a` 迁移+**两侧计数等式断言**（不等即中止）；runbook §3 写死"改 cwd/COLLAB_SPOOL_DIR 必迁移账本"；②dist 切换全链 `&&`（禁 `;`）+`test -f dist/main.js`+**本地/远端 `sha256sum dist/main.js` 等值断言**（封死半切换/静默空部署/+3 伪造）；③deploy_web 子 shell 包裹（cd 污染根修）+**dist.next 原子切换+dist.prev**（nginx root 不变）+`version.json`（本地构建后写 `{git: SHA}` 进 dist——`curl /version.json` 即证 web/API 版本偏斜） | 评四 P0-7/P1-1/P1-5/§3-1 |
| P45 | **三处契约更正（评四 P1-8/基线实证；v4.2 两处再修）**：①`MINIO_USE_SSL` **normalize 不 reject**（v4.2/评五 C4：v4 严格 enum=本批唯一能硬失败启动的变更且服务器现值未采集——改 `z.preprocess(blankToUnset, z.string().optional()).transform((v)=>(v??'').toLowerCase()==='true')`：消灭 `z.coerce.boolean()` 反相且不新增启动失败面〔validateEnv=process.exit(1)+ecosystem min_uptime/max_restarts 崩溃循环——环境值大小写会被误诊为代码问题〕；M0[2] 补采现值+T12 前置断言并行；**v2 驳回理由更正**：有消费者〔minio.module:17→service:41 `tls:`〕且 AWS SDK v3 runtimeConfig 确有 `tls?: boolean`〔评五 P1-10 证〕——但现网 'false'→true 反相长期无害=键行为惰性；Y0.5 登记"删键 vs scheme 派生"终裁）；②additive 检查**基线落文件内常量** `BASELINE='20261007170319_lease_collab_audit'`+**基线存在性断言**（v4.2/评五 P0-3：常量打错⇒`d>BASELINE` 字符串比较恒空⇒门禁永久豁免且输出仍 OK——`dirs.includes(BASELINE)||fail` 一行封死；`fresh.length===0` 打印"尚无受检对象"非静默）+断言分层（**硬拦**：DROP COLUMN/TABLE/CONSTRAINT+SET NOT NULL+RENAME+ALTER COLUMN TYPE；**DROP INDEX 降 WARNING**——评五：删索引不破坏"旧代码在跑"〔旧代码不按名引用索引〕，却是 prisma 重建索引最常见良性破坏语句，硬拦会把门禁训练成"遇到就绕"）+目录缺失 fail-closed+**服务器 cutover ③ migrate 前双跑**；豁免注释更正为"基线前历史不检，会命中正则者 **8 文件**"（v4.2 本方重扫实测：20260827223714/20260828050603/20260829201000/20260830010735/**20260830183448**/20261002231506/20261003001500/**20261006120655**——v4.1 登记 6 文件系本方上轮正则漏 DROP INDEX/RENAME/TYPE，**基线目录自身亦命中**〔被 `>` 排除✓〕）；③`readEnvFile` 抽 **`scripts/lib/env-file.mjs` 单源**（撤"三处内联 Y0.5 抽"注记——本批防双源纪律优先）+正则支持 `export ` 前缀+**dotenv 对拍测试**（`createRequire(api/pkg).require('dotenv').parse` vs readEnvFile 逐键**值**比对：dq/sq/CRLF/重复键/export/**行内 # 三形态**〔无空格截/引号外截/引号内保留——B27〕/多行 PEM 夹具） | 评四 P1-1/P1-4/P1-7/P1-8+评五 P0-3/P1-10/C4+实测 |
| P46 | **溯源来自产物（评五两报告共识——+3 在 rollback 后说谎的根修）**：`deploy_api` 本地构建后写 `apps/api/dist/build-info.json`（`{"git":SHA,"builtAt":ISO}` 两字段——**驳回 mainJsSha 第三字段**：sha256sum -c 已断言 main.js 完整性，冗余）随 tar 上传；cutover ⑤ 与 rollback ⑤ 的 `GIT_COMMIT_HASH` 一律从**被执行的那份产物**的 build-info 派生（`$(node -e "…require('dist/build-info.json').git")`）——回滚后自动说实话（dist.prev 的 build-info=旧构建 SHA；v4 形态 export 当前 HEAD 给上一代 dist=判据成立但结论为假），也消除 B25 shell export 脆弱（值不再来自部署会话变量）；web `version.json` 同形补 `builtAt`（两 artifact 溯源一套口径）；runbook §5 注明 rollback 后 `pm2_env.GIT_COMMIT_HASH`≡被提升的 dist.prev 的 git（≠HEAD 是正确状态；+3 断言只在 run#2 正常部署要求 ≡HEAD） | 评五 P1-1/跨批 1 |
| P47 | **spool 账本迁出部署树+迁移移进 cutover（评五 P1-2/P1-3 双修）**：ecosystem `COLLAB_SPOOL_DIR=/home/ubuntu/flowweb-data/collab-spool`（**树外**——v4 值仍在部署树内，唯一持久副本住在被 tar/整目录删除覆盖的目录里只靠 `--exclude='.data'` 一条纪律保命；迁移机制本批已建，目标改树外边际成本≈0 一次性取消整类风险）；迁移执行点=**cutover ③.5**（guard 之后④切换之前——v4 的 T12 Step 1.5 在 run#1 前手工 rsync，而 run#1 `--allow-legacy` 档无 drain+preflight 15-20min 窗口旧实例续写旧目录=迁移副本陈旧而 +5 仍报"未丢"=**假证据**；③.5 窗口秒级且 run#2 档 drain 已停写）；幂等（rsync 合并只增不减+旧目录计数=0 跳过）；`command -v rsync` 前置（M0[6] 采集）+`cp -a` 回退；计数等式断言保留 | 评五 P1-2/P1-3 |
| P48 | **deploy_full 三行顺次+provision_tarball 补体（评五 P0-2/P0-5/C3 三报告共识）**：`deploy_full() { provision_tarball; deploy_web; deploy_api; }`——每行独立语句=errexit 逐条生效（**B28 AND-OR 陷阱消灭**：v4 骨架 `provision_tarball && server_install_generate;` 非末位失败被静默吞+两函数全文未定义=首次 full 在半铺底状态继续跑）；`provision_tarball()`=现 deploy.sh:29-37 tar 铺底段**逐行搬运**（清单追加 `ecosystem.config.cjs`；exclude 追加 `.deploy-guard-state.json`/`.preflight-*.ok`/`.installed-lock-sha`——后两者被上传=服务器"看起来像已预检"语义污染）；**删 server_install_generate**（install/generate 唯一所有者=deploy_api 内联段+`.installed-lock-sha` 标记——两处各存一份=本批禁止的双源）；原 :48-55 服务器三次构建**不搬运**（零构建形态）；T5/T8 措辞拆清：T5 只动 restart 块→cutover_api 骨架+分派层，deploy_full 函数级重构归 T8 | 评五 P0-2/P0-5/C3+B28 实测 |
| P49 | **cutover 切换链四修（评五 C6/M1/P1-2/P1-4）**：①**删 SWITCH_BEGUN 失败复位**（v4 失败分支 `SWITCH_BEGUN=0` 把唯一能进 trap elif 半态分支的路径自己清掉=死代码，trap 打印"旧构建仍在跑——修复后重跑"与内联"勿重启 pm2"相反指引——失败保持 1⇒elif 可达）；②**sha256 校验移 mv 之前**（对 `dist.next/main.js` 先验后换——消除"校验失败时坏产物已就位 dist/"的惰性 require 窗口；校验失败⇒链断⇒dist 未动⇒trap 走 else=语义正确）；③**shared dist 替换移进 ④**（v4 上传段先 rm -rf 远端 shared/dist 再解包——此时旧实例仍在 serving，惰性 require 指向被删目录，与本批为 lockfile 立的"旧进程存活期不重写 node_modules"理由同类却对 shared 网开一面；改上传段解到 `packages/shared/dist.next`、④ 切换窗口一并 mv——Y0b 起真改 shared 时机制必须已对）；④**drain 续期查 `r.ok`**（v4 `!r.unreachable` 即记已续期——401/403/500〔令牌轮换/实例半死〕也记=60s 后自动解除⇒预算耗尽误报"drain 未生效"=把权限问题误诊成排空问题；改 `!r.unreachable && r.ok`+拒时 WARNING） | 评五 C6/M1/P1-2/P1-4 |

### 0.4 修改类任务冲击面清点（纪律 11）

- **env.ts 加键（T1）**：消费点零改动（校验层）；测试面零破坏（测试不经 validateEnv）；**启动面风险=服务器 .env 空值**——T12 前置 `grep -E '^COLLAB_[A-Z_]*=$' apps/api/.env` 必须为空（runbook ③+T12 步骤）。
- **guard 删回退（T2）**：消费点=guard 自身+`collab-ready.controller.spec`（:62/75/110 delete ADMIN_TOKEN 用例——回退路径用例改写）；drill/gate 若用 PROMETHEUS_TOKEN 调 drain→grep 核对（kill9-drill 走 beginDraining 内存直调不走 HTTP——执行时 grep `PROMETHEUS_TOKEN` 于 scripts/ 确认零命中则零冲击）。
- **gateway address/unloadImmediately/quiet（T4）**：构造参数追加默认值——kit/直构 spec 零破坏；gauge 新增=metrics 注册表追加（labelNames 无新标签）。
- **ready 授权档加 loadedDocs/connections（T4）**：controller 授权分支透传两字段——公开档四键不变（V17 契约零动）；spec 补注记（T13）。
- **deploy.sh（T5/T8）**：人工+CI bash -n；check-ecosystem 锚回归。
- **vitest int 池（T11）**：注入+删除自愈（MIN_TOTAL 26→27→26）；集合断言 git ls-files 驱动。

### 0.5 v2 驳回登记表（外审建议→裁定；防"评审了但没消化"）

| 外审建议 | 裁定 | 理由与去向 |
|----------|------|-----------|
| own 四零判据改判（"spool 帧=安全稳态不该拒"） | **驳回，维持 spec SV11** | own spool 帧存在=append 正在失败（PG 拒写/fenced），重启后回灌同样失败——拒部署是自洽保守判据；改判属 spec 级修订（P15 采纳其 post 段+token 修复） |
| PrismaClient 单例收敛（A8/D4） | **驳回，维持 spec E46 纳管** | auth.ts 在 DI 容器外模块顶层执行 betterAuth()——重构初始化序的爆炸面>三池连接预算收益；spec 已裁定纳管+连接池显式；**登记 Y0.5 连接池治理重评**；采纳其"契约锚升行为断言" |
| default 进 schema+消费点去默认（A9） | **部分采纳** | 评审二 P1-8 自认约 10 处 spec 动态 set/delete env 会失效（模块级常量 import 期求值）——本批=校验+**双向结构锚**（读点⇔schema 键+豁免表，防 P0-5 类漂移的机制化）；**Y0c 真根修登记**（config 对象注入） |
| NODE_ENV 经 ecosystem 提前注入+三验（A5/D3） | **驳回，移 Y0.5/E58** | E58 原文=NODE_ENV zod 枚举+deploy.sh 显式注入同批；B8 八读点影响面已全量登记（含 spool throw/debounce 双档/admin fail-open）——"提前注入+补验证"拆开做=同一件事付两次验证成本；M0 实测现值落档 |
| ecosystem 预注入 COLLAB_ROLE（P1-5） | **驳回** | 零消费者=又一"预留键"（评审一 D2 自己反对的形态）；Y0.5 角色门（E59）同批；解冻三触发线采纳进 runbook（P27⑥） |
| gateway 补 payload.token 通道（A10） | **驳回，登记 Y0b** | E13 cookie-only 方向；本批 nginx access_log off 止血（P26）；冒烟 query token 走 127.0.0.1 直连不进日志 |
| POST /api/undrain（P0-11 评二） | **驳回** | SV12"唯一停止写入入口"语义+60s 自动解除已覆盖安全中止；新增端点=新攻击面+状态机复杂度 |
| 8 客户端/20 doc/10min 压测定内存档（P1-1） | **部分采纳** | 开发测试环境无真实负载——压测产出的"负载曲线"对 dev 流量无代表性；M0 扩采（五组只读命令）+T12 部署后观测+runbook 登记数值随 Y0.5 容量批复核 |
| release 目录+current 软链（D1/P0-9 方案 B） | **驳回本批，登记 Y0.5** | 本批 dist.next+mv 原子切换（最小 A 方案）已消除"未验证构建自动上线"；release/软链=部署形态批整体设计 |
| MINIO_USE_SSL 死键顺手修（A9） | **驳回** | 零消费者零行为差异（评审自证"静默"）；精准修改原则——Y0.5 env 治理同批 |
| tar 清单 prune/rsync（D1） | **驳回本批** | T18 src 不再上传+dist 原子替换后幽灵代码面消失大半；rsync/release 完整方案 Y0.5 |
| 服务器构建保留但加资源闸（A4 方案 2） | **驳回，选方案 1** | 本地构建上传更彻底（内存解耦+验产物一致）；deploy_full 铺底路径保留现状（首次专用） |
| **第三轮新增驳回** | | |
| 冒烟移 `<root>/scripts/`（评二 B） | **驳回，采纳其另一半** | 与 B15 自相矛盾：评二自己实证 root scripts 解析不到包级依赖（dotenv），provider/prisma/yjs 同病——移过去冒烟启动即 MODULE_NOT_FOUND。采纳"补上传面+check-ecosystem 断言"部分（P33） |
| PrismaClient 单例化（评三 A2 再攻） | **维持驳回 E46** | 评三"6 行可控"论未面对 `PrismaService extends PrismaClient` 的全仓注入形态——改 delegate 需代理 PrismaClient 全方法面（新维护层）或全仓注入点改型（真爆炸）；M0 补 `pg_stat_activity/max_connections` 实测、connection_limit 据实定值（采纳其半）；单例化维持 Y0.5 连接池治理登记 |
| ready 加 commit 字段（评一 P0-6/评二 J-2） | **驳回，采纳 pm2_env 口径** | 加字段=动 V17/SV16 冻结契约+shared 类型，成本与收益不成比例；评三 J3 的 pm2_env/environ 自证零代码等价（P34） |
| pg_dump+恢复演练整体移 Y0.5（评三 A4） | **部分驳回** | 备份动因=migrate 链上唯一不可逆操作，与本批顺序改造同体；保留 migrate 前置 dump（一行秒级，开发库 116KB）+T12 一次性恢复验证（命令按 URL 派生修正）；**常规化演练/PITR/离机归 Y0.5/E47**，runbook 写死"同机 dump≠备份"（采纳其风险提醒） |
| `--allow-spool-residual` 第二逃生阀（评一 15） | **驳回** | P30 预算 90s（v4/P40：改固定值+drain 续期实现）已使"PG 恢复待梯"窗口可达；`--force` 已覆盖"有账可算"的越过需求——两个逃生阀叠加=逃生阀泛滥，且输出已含帧数明细 |
| 冒烟 countUpdates 轮询（v2 自身） | **自我修正删除（评二 K 减法采纳）** | readSnapshotOnly 轮询重放使等待条件与断言条件合一——少一个 API、少一条读路径、少一个启发式；countUpdates 撤销 |
| **第四轮新增驳回** | | |
| 删 COLLAB_MAX_LOADED_DOCS 键（评四 P0-5"与 COLLAB_ROLE 同形态"） | **驳回删除，维持 EXEMPT 但理由升级** | spec §3 4.6:502 **原文点名**"MAX_LOADED_DOCS 预留"一并进 zod——与被驳回的 COLLAB_ROLE（plan 自创、零 spec 载明、E59 已有归属）是**不同形态**：一个是 spec 裁定留位、一个是自创预留；EXEMPT 理由改引 spec 行号（Y1c-3 连消费点同批移出豁免不变）。采纳其另一半：BIND_ADDR 移 T4 键随读者（P42） |
| preflight 加 frozen-lockfile 快检（评四 P1-12 后半） | **驳回** | 传递保证已成立：git 干净断言（lockfile 受控）+HEAD∈origin/master（CI `pnpm install --frozen-lockfile` 绿是合入前提）⇒ 不一致的 lockfile 到不了部署步；再加一道=同判据双载体 |
| degraded 放行=unobservable verdict（评四报告一 P0-1 修法原案） | **驳回，取 pass+N/A 打印** | unobservable 已有专义（token 视图缺失/凭据无效——force 不覆盖）；pre 显式降级（legacy/unreachable）是**已知无账**而非不可观测，混用两语义=下轮排查时的误诊源；decidePost 第三参 degraded→epoch 断言 N/A 显式打印（P39） |
| ~~vitest.mjs 不存在需另寻入口~~（评四报告二 P0-2 附注） | **断言更正（非驳回）** | 本方实测 `apps/api/node_modules/vitest/vitest.mjs` **存在**（评审 glob 零命中误报）；修法不变（P41 createRequire 解析——比 hardcode 稳，布局变化不炸） |
| **第三份报告（补齐后）新增裁定** | | |
| B1 修法 nonce 方案（per-run GUARD_NONCE） | **驳回，维持 SHA 断言** | pre 每次覆写+post SHA 断言已覆盖：跨 SHA 串档=SHA 红拦；同 SHA 重试=pre 先覆写新档；rollback 同 SHA=有意复用基线（epoch 已两次递增断言恒过）。nonce 增一机制零增覆盖面 |
| B1 修法 decidePost pm2 restart_time+uptime 自证 | **驳回，维持 degraded→N/A** | 自证需 deploy.sh 采集 pm2 口径传参（bash 判据面扩大——本批 F10 方向相反）；N/A+部署记录+"run#2 产出判据"已诚实；legacy/unreachable 档仅 run#1/事故场景使用一次 |
| A1 PrismaClient 单例化（第三次再攻——useValue 10 行案） | **维持驳回 E46 纳管（三驳）** | useValue 形态确比前案轻，但：spec E46 原文"清或纳管"=纳管已满足；T3 行为断言已按纳管形态落地（改单例=返工已测设计）；useValue 生命周期钩子语义+AuthModule/PrismaModule 双 $disconnect 同实例=新验证面。**采纳其三事实登记**（T13 E46 执行注记）：main.ts:50 $disconnect 仅成功路径（catch 漏）+preload 第三个客户端+三客户端池算术——全部 Y0.5 连接池治理登记（M0 实测据实定值半采维持） |
| J8 删 COLLAB_MAX_LOADED_DOCS（第三次） | **维持驳回** | spec §3 4.6:502 原文点名"MAX_LOADED_DOCS 预留"——spec 是单源，plan 不越权删 spec 点名键（三次报告同argument三次同裁定）；gauge 已完成观测半✓与 EXEMPT 理由（enforcement Y1c-3 同批移出）不冲突。若用户裁删键=spec 级修订另行启动 |
| J7 后半"dist .js 数≡源数"锚 | **驳回** | rmSync+全新构建+远端 rm -rf dist.next 双侧构造性保证无孤儿——计数锚耦合 nest build 产物内部形态（脆弱）；check-no-testutils-in-dist 前置（J7 前半已采纳）才是有信息量的门 |
| **第五轮新增驳回** | | |
| 评一 P1-8："--skip-preflight 把 git 断言也跳过——移 dispatch 层" | **驳回（误报）** | v4.1 评四 P1-2 已修：git 两条断言在 preflight 函数体顶部、收据 if/elif **之外**——skip 与收据命中路径均先执行 git 断言（T8 Step 1 文本可证）；"未提交热修直上生产"不存在无记录通道 |
| 评一 P0-2 附带："check-ecosystem 加裸 AND-OR 结尾锚（`/\w+ && \w+;$/m`）" | **驳回（形态修复已消灭）** | P48 三行顺次调用天然无 AND-OR 陷阱；且该锚误伤合法惯用法（`[ -x … ] && exit 1` 恰是 && 结尾的守卫形态——deploy.sh 内多处）——锚比病贵 |
| 评一 P1-1：build-info.json 含 mainJsSha 三字段 | **部分采纳（驳回第三字段）** | sha256sum -c - 已断言 main.js 完整性（本地/远端等值）——build-info 再存一份=同判据双载体（frozen-lockfile 快检驳回同因）；git+builtAt 两字段采纳（P46） |
| 评一 P1-10 后半："MinIO 上传/取回自动验证纳入 T12 证据链" | **驳回自动链，采纳人工一行** | 本批冒烟域=spec §4.4 collab（WS+PG）——MinIO 自动验证扩域进部署链=域漂移；T12 Step 6 人工清单加"curl 公开资产 200"一行；产品面冒烟（含 MinIO）登记 Y0.5 |
| 评一 P0-2 修法（子 shell 包裹 `( fn1 && fn2 )`） | **采纳结论，改用更简形态** | P48 三行顺次（每行独立语句）同样恢复 errexit 且无需子 shell 嵌套——少一层括号少一处误读 |

### 0.6 新增机制失败分支推演表（纪律 11 对称适用——v2 新增 8 机制中 5 个首执行会失败且无一写失败分支；本表为 v3 新增机制的"探针前置"载体，每行探针=几分钟可跑）

| 新机制 | 首执行失败的形态 | 探针（红相验证） | 失败时的动作 |
|--------|------------------|------------------|--------------|
| 零依赖 readEnvFile（P29/P45/B27） | 引号/**行内 `#` 注释三形态**（无空格截/引号外截/引号内保留——v4 实现 `(.*)$` 全收+两端引号配对=三档全错，**对拍首跑必红=探针门第一跑就暴露的实测缺陷**）/多行 PEM/export 前缀解析错→token 取空或带注释尾（J3：guard 401 自锁且误诊指向令牌本身） | **值比对非键集比对**（键集两种解析恒一致=探针必盲——v4.1 教训）：dotenv 对拍测试逐键比值（scripts/env-file.test.mjs 九形态夹具：plain/dq/sq/重复键/export/**F_HASH 引号外注释/G_NOHASHSPACE 无空格#/H_DQ_HASH 引号内#**/PEM），真实 .env 存在时加跑全键档；**实现前置探针已粘**（B27 实测输出：`before`/`a`/`a #b`/`x # y`/`second`/`yes`） | 引号分支（取首个闭引号内）→未引号首 `#` 截断（无空格也截——B27）→引号内 `#` 保留；解析值为空且文件存在该键=显式 fail（防误诊"令牌未设置"）；回退=createRequire(api/package.json)('dotenv')（B15 先例） |
| isMain 守卫+node:test（P29） | import 期副作用残留（某分支漏守卫） | `node --test scripts/` 在**无 API 无 .env** 的干净环境跑（CI 即此形态） | 补守卫；CI 红因=副作用而非夹具断言时，先看 stderr 是否 fetch/exit 痕迹 |
| epoch 状态文件（P31） | .deploy-guard-state.json 残留上次部署的 epochPre（跨部署串档） | 连续两次部署观察 post 段 epochPre 是否各自正确 | post 段读后即删文件；文件缺失/损坏=fail（禁回落 0——P31） |
| dist 原子切换（P18） | mv 半途失败/磁盘满 → dist 缺失 | 本地演练：切换步人为制造磁盘满（或 mv 目标只读） | dist.prev 在→`--rollback` 恢复；dist 与 dist.prev 皆失→runbook §5 重新部署上一提交 |
| preflight int 链（P32） | DATABASE_URL 提取后连不通（本地 PG 未起） | 故意停本地 PG 跑 preflight——预期 check-int-coverage 红（非静默过） | 红=门禁工作正常；按报错起 PG 后重跑 |
| SHA 收据（P36③） | 工作树 HEAD 与收据 SHA 同但文件被改（dirty 后又 revert 回同 SHA？不可能——git 断言先拒 dirty） | git 断言与收据的先后序测试：dirty 状态跑 deploy | 收据只跳过重跑**幂等**步骤（verify/int 结果对同 SHA 确定）；gate-collab 不跳（有状态） |
| check-migration-additive（P36①/P45） | 既有历史迁移含 DROP（**实测 6 文件**：20260827223714/20260828050603/20260829201000/20260830010735/20261002231506/20261003001500） | 对现有 prisma/migrations 跑一次（baseline 常量后应绿） | 基线落文件内常量 `20261007170319`+6 文件豁免注释登记；**禁 env 旋钮**（门禁范围随环境变=违配置即契约）；服务器 cutover ③ migrate 前双跑（本地+服务器同一脚本） |
| 状态文件生命周期 v2（P39）+基线收口（v4.2/评五 C5） | 早退路径漏写/NaN 经 null 往返成 0/rollback 读不到 state/**首采样抖动**（drain 200 后那一次 getReady 失败⇒'unavailable' 落盘⇒轮询正常 pre pass⇒post 必 fail⇒trap 误导回滚刚上线的正确构建——P39 要消灭的形态换分支复发） | **写 `{"epochPre":null}` 到 STATE→`--post-restart` 必 fail**（v3 形态此探针 pass=错；修后红=对）；`--allow-legacy` 档 post 不再 fail（N/A 打印）；**首采样失败探针（v4.2 新增）**：mock 一次 ready 拒绝（--api-url 指向先拒后通的本地端口序列不可行——用 node:test 直测 prePhase 收口分支或临时防火墙单端口）→pre pass 后 post 必须 pass | 单一 writeState() 收口全部退出路径；'unavailable' 字符串哨兵+epochPreFromRaw typeof 判；post 不删+SHA 断言（三态：state 无 sha fail/未传 GIT_SHA fail/不符 fail）；**pass 与 force 放行点以最后一次有效采样收口基线**（`Number.isFinite(Number(last?.body?.epoch))`⇒writeState 更新） |
| drain 续期（P40） | 60s TTL 解除后 reason≠draining→decidePre 恒 wait→90s 到点误报"drain 未生效" | 演练注入 spool 帧观察 90s 窗口内 reason 恒 draining（每 20s 重 POST 续期） | 续期 POST 失败（进程已死）按不可达档处置；预算固定 90s（删 preBudgetMs=删首采样盲区） |
| extractBashFunction（P43） | 单行函数体/注释行含 `{}`/提取空串静默过 | 提取器自测三档：多行✓/嵌套大括号✓/单行=提取失败即 fail | 夹具与真文件同用多行形态；`^\s*#` 行剥离后再配平 |
| spawn 直跑 vitest（P41） | Windows ENOENT（pnpm=.ps1）；vitest 入口路径随布局漂移 | 本机跑 `node scripts/deploy-preflight-int.mjs`（本地 PG 在跑时绿；`spawnSync('pnpm')` 旧形态实测 ENOENT=红相已存档） | createRequire 解析 vitest.mjs；解析失败 fail-closed 报"先 pnpm install" |
| main.js sha256 等值（P44②） | mv 半切换（dist.next 落进现存 dist）/上传截断 | 本地构建后改 dist/main.js 一字节→cutover ④ 后等值断言必红 | dist.prev 在→--rollback；等值断言在 startOrReload 之前（错误构建不上线） |
| spool 账本条件迁移（P44①/P47） | 旧 pm_cwd 与新绝对路径不一致→空账本；**提前迁移的副本陈旧**（run#1 `--allow-legacy` 档无 drain+preflight 15-20min 窗口旧实例续写旧目录——v4 Step 1.5 时点=+5 报"未丢"实为丢=假证据） | M0[4] readlink /proc/$(pm2 pid)/cwd+旧目录计数；**迁移在 cutover ③.5 内执行**（guard 后切换前——秒级窗口；run#2 档 drain 已停写）后两侧计数不等即中止 | 迁移幂等可重跑（rsync 合并只增不减+旧目录计数=0 跳过）；`command -v rsync` 前置+`cp -a` 回退；runbook §3 写死改目录必迁移且在 cutover 窗口内 |
| build-info 产物溯源（P46） | rollback 后 pm2_env.GIT_COMMIT_HASH=当前 HEAD 而线上跑 dist.prev=判据成立结论为假（+3 被伪造） | 部署后 `pm2 jlist` 的 GIT_COMMIT_HASH ≡ **被提升目录 dist/build-info.json 的 git 字段**（非 shell HEAD）；红相=手工改 dist/build-info.json 一字节→jlist 断言必 mismatch | 构建后写 `{"git":SHA,"builtAt":ISO}` 进 dist（git+builtAt 两字段——mainJsSha 驳回）；cutover ⑤/rollback ⑤ 从产物派生；runbook §5 注明 rollback 后 ≠HEAD 是正确状态 |
| deploy_full 三行顺次（P48） | v4 骨架 `fn1 && fn2;` 非末位失败被 errexit 吞（B28 实测：`set -e; false && echo x; echo after`→after/exit 0）+两函数未定义=首次 full 在半铺底状态继续跑 | **本方 Git Bash 实测已粘**（B28）；bash -n 抓不到（语法合法）；check-ecosystem 断言 provision_tarball 提取成功+deploy_full 体内无 `&& …;` 结尾形态之外的调用图（三行单调用） | 三行独立语句=errexit 逐条生效；provision_tarball=原 :29-37 逐行搬运（非转述——片段即产物）；删 server_install_generate（install/generate 单点=deploy_api） |
| dist 新鲜度（B29/P48） | rmSync 后 rebuild 若仍产 src/ 子目录（另一 tsconfig 布局）=幽灵面未消 | 构建后断言 `dist/main.js` 存在（已有 test -f）+`dist/tsconfig.drill.tsbuildinfo` 与 `dist/scripts/` 不存在（drill 产物必非 nest build 输出）；`dist/src` 形态执行时实测校准（rmSync+rebuild 后 ls——在则登记布局事实不强断言） | B29 实测双布局为 rmSync 必要性硬证据；运行时引用 grep 零命中已证（dist/scripts|dist/prisma 无 require） |

---



---

## Task 0: 服务器前置实测（M0 扩采+M1 pm2 基线）——只读，不阻塞 T1-T10

**Files:**
- Create: `docs/superpowers/deploy-server-profile-2026-10.md`（落档=出口判据 4；**docs/superpowers/ 根级=doc-gate 语料内**）

- [ ] **Step 1: M0 五组只读命令（一组 SSH 会话跑完）**

```bash
ssh -i ~/.ssh/flowweb_server ubuntu@101.42.94.107 '
echo "=== [1] 内存画像 ==="; free -m; ps -o rss,comm -C node,postgres,redis-server,minio --no-headers | sort -rn | head -20
echo "=== [2] 进程 env 现值（NODE_ENV/COLLAB_*/MINIO_*/token 存在性——脱值；v4.2：MINIO_USE_SSL 现值=enum→normalize 决策的部署前置） ==="
pid=$(pm2 pid flowweb-api); sudo cat /proc/$pid/environ | tr "\0" "\n" | grep -E "^(NODE_ENV|COLLAB_|MINIO_|PROMETHEUS_TOKEN|GIT_COMMIT_HASH)=" | sed -E "s/^(.*(TOKEN|SECRET|KEY).*)=.+/\1=<redacted>/"
echo "=== [2b] v4.2/评五 C4+P1-7：.env 的 MINIO_USE_SSL/MINIO_ENDPOINT 现值（scheme+值形态——normalize 后行为预期与 T12 前置断言依据） ==="
grep -E "^MINIO_(USE_SSL|ENDPOINT)=" /home/ubuntu/flowweb/apps/api/.env | sed -E "s|(MINIO_ENDPOINT=https?://)[^/]+|\1<host>|"
echo "=== [3] pm2 全量+守护+日志+磁盘+swap ==="; pm2 list; pm2 conf pm2-logrotate 2>/dev/null | head -5 || echo "pm2-logrotate 未安装"; df -h /; swapon --show || echo "无 swap"; free -m | head -2
echo "=== [4] env 文件位置+spool 台账（v4/P44：旧实例有效 CWD+旧目录计数——账本迁移判据）+nginx /collab 现状 ==="
ls -l /home/ubuntu/flowweb/.env /home/ubuntu/flowweb/apps/api/.env 2>&1
pid=$(pm2 pid flowweb-api); echo "process cwd: $(sudo readlink /proc/$pid/cwd)"
for d in /home/ubuntu/flowweb/.data/collab-spool /home/ubuntu/flowweb/apps/api/.data/collab-spool; do [ -d "$d" ] && echo "$d: files=$(find "$d" -type f | wc -l) bytes=$(du -sb "$d" | cut -f1)"; done
grep -nE '^\s*export\s+COLLAB_|COLLAB_[A-Z_]*=.*\s+#' /home/ubuntu/flowweb/apps/api/.env || echo "服务器 .env 无 export 前缀/行内注释（P45 readEnvFile 对拍前提）"
sudo nginx -T 2>/dev/null | grep -n "location /collab" || echo "nginx -T 不可读或无 /collab"
echo "=== [5] HTTPS/外部端口/开机自启/版本 ==="; curl -sk -o /dev/null -w "%{http_code}" https://www.flow123.com/ ; echo; ss -tlnp 2>/dev/null | grep -E ":(3000|3001)" || sudo ss -tlnp | grep -E ":(3000|3001)"
echo "=== [6] v3 补采：守护自启/工具版本/PG 容量/Redis 配置（评一 §5+评三 A2/A5） ==="
systemctl is-enabled pm2-ubuntu 2>/dev/null || echo "pm2 startup 未启用——服务器重启后进程不复活（runbook §6）"
command -v pg_dump && pg_dump --version; node -v; pnpm -v
command -v rsync || echo "rsync 缺失——T12 Step 1.5 回退 cp -a（P47）"; node -e "process.exit(typeof fetch==='function'?0:1)" && echo "global fetch ✓（Node≥18——deploy-guard 前置门）" || echo "global fetch 缺失——Node<18 deploy-guard 必炸（runbook §0 前置条件）"
DSN=$(grep -m1 "^DATABASE_URL=" ~/flowweb/apps/api/.env | cut -d= -f2- | tr -d "\""); psql "${DSN%%\?*}" -c "SHOW shared_buffers; SHOW max_connections;" -c "SELECT count(*) FROM pg_stat_activity;" 2>&1 | head -8
redis-cli CONFIG GET maxmemory 2>/dev/null; redis-cli CONFIG GET maxmemory-policy 2>/dev/null; redis-cli CONFIG GET appendonly 2>/dev/null
ls -l ~/flowweb/apps/api/.env
'
```

原始输出**原样**贴进落档文件（附采集时间；[6] 中 DSN/密码已脱）。判读行：服务器 NODE_ENV 现值（B8 八读点风险定级+Y0.5 对照基线+runbook「部署姿态」节输入）/COLLAB_ADMIN_TOKEN 是否已设（W23 前置）/**旧实例有效 CWD 与旧 spool 目录计数（v4/P44+P47——cutover ③.5 账本迁移触发判据：CWD 派生目录≠`/home/ubuntu/flowweb-data/collab-spool`〔树外新目标〕且旧目录有帧⇒必须迁移）**/**MINIO_USE_SSL 值形态（v4.2/C4——非 true/false 形态⇒T12 前置断言先改 .env 再部署；MINIO_ENDPOINT scheme 与 useSSL 组合落档）**/**rsync 存在性+global fetch 可用性（P47/P1-9——fetch 缺失=deploy-guard 在服务器必炸，runbook §0 前置条件）**/服务器 .env 无 export/行内注释（P45 readEnvFile 对拍前提——有则先修读取器再上机）/pm2 startup/logrotate/swap 有无/3001 是否公网监听（P25 必要性证据）/nginx /collab 现有 block 数（T9 替换语义对象）/pg_dump 存在性与版本（T8 备份前置）/PG 连接与内存实占（runbook §2 connection_limit 据实定值——A2 半采）/Redis maxmemory 无界与否（与 spool 同盘同内存风险登记）。

- [ ] **Step 2: M1 pm2 基线（kill_timeout 归属+守护现状）**

```bash
ssh -i ~/.ssh/flowweb_server ubuntu@101.42.94.107 'pm2 jlist' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const x=JSON.parse(d).find(p=>p.name==='flowweb-api');console.log(JSON.stringify({exec_mode:x.pm2_env.exec_mode,instances:x.pm2_env.instances,kill_timeout:x.pm2_env.kill_timeout,node_args:x.pm2_env.node_args,pm_cwd:x.pm2_env.pm_cwd,restart_time:x.pm2_env.restart_time,unstable_restarts:x.pm2_env.unstable_restarts,status:x.pm2_env.status},null,2))})"
```

落档（含 `restart_time`/`unstable_restarts`——A7 健康信号基线）。

- [ ] **Step 3: 数值推导（RSS 口径——P17）**

落档文件写死算式与结论：`max_memory_restart ≥ old-space + 384MB`（Yjs ArrayBuffer 外部内存+代码段+栈余量）；`old-space + 384MB + 协居实测 RSS 总和 + 系统保留 300MB ≤ 1900MB`。1.9GB 机器参考解（M0 实测修正）：old-space=512 / max_memory_restart=1G（若协居 RSS 实测总和 >600MB 则 old-space 降 384）。**允许实测推翻 spec 原型 768/1G——以两条算式为准**（外审 P1-1：spec 原型在 1.9GB 协居机上过不了算术）。

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/deploy-server-profile-2026-10.md
git commit -m "docs(collab): Y0a-4 M0/M1 服务器画像扩采落档（内存 RSS 口径+NODE_ENV 现值+pm2 守护+spool/nginx/端口——ecosystem 数值定稿依据）"
```

---

## Task 1: env zod 收口（真键名+空串语义+双向结构锚）

**Files:**
- Modify: `apps/api/src/config/env.ts`、`apps/api/src/config/env.spec.ts`（**v4/P42：既有 118 行/6 用例——Modify 追加，禁 Create 覆盖=静默删测**）
- Create: `apps/api/src/config/collab-env-single-source.spec.ts`

- [ ] **Step 0a: 先给出口（v4.2/评五 C1——顺序根修：v4 原序先改 import 后补 export ⇒ `envSchema` 解析为 undefined ⇒ 6 用例全红且红因非断言，执行者最可能的反应是误判"副本与真 schema 不一致"而回退或去"修"真 schema）**：`env.ts:3` `const envSchema = z.object({` → `export const envSchema = z.object({`（仅加 export——零行为变更，env.spec 仍测内嵌副本）；跑 `pnpm --filter @flowweb/api exec vitest run src/config/env.spec.ts` 确认 6 用例仍绿（此时测的仍是副本，未变）。

- [ ] **Step 0b: 再换契约源（消灭第二契约源——P42）**：删 `env.spec.ts:2-18` 的内嵌 schema 副本（`import { z } from 'zod'` 行保留仅当仍有他用，否则同删），改 `import { envSchema } from './env';`——既有 6 用例自动开始测真 schema；跑同命令确认 6 用例仍绿（真 schema 的 WECHAT_* 全 `optional().default('')`〔env.ts:15-28〕+SENTRY/PROM `optional()`——good 基线不含这些键=零破坏，既有 `MINIO_USE_SSL` 断言在 normalize 化后输出仍为 `false` ✓）。

- [ ] **Step 1: 追加失败测试（契约+空串档+真键名——v4：追加 describe，不动既有 6 用例）**

```ts
// apps/api/src/config/env.spec.ts
import { describe, it, expect } from 'vitest';
import { envSchema } from './env';

// 本地 .env 27 键实证：MINIO_ENDPOINT/ACCESS_KEY/SECRET_KEY 必填（env.ts:8-10）——good 基线必含；
// v3 修正：ACCESS_KEY min(3)/SECRET_KEY min(8)（实测约束）——'k'/'s' 会令合法用例恒红=红相零鉴别力
const good = {
  DATABASE_URL: 'postgresql://x', REDIS_URL: 'redis://x',
  MINIO_ENDPOINT: 'http://localhost:9000', MINIO_ACCESS_KEY: 'minio-key', MINIO_SECRET_KEY: 'minio-secret-key',
};

describe('Y0a-4 env zod 收口：COLLAB_* 全族（P3 校验层不写默认+B13 空串=未设）', () => {
  it.each(['COLLAB_PORT','COLLAB_DEBOUNCE','COLLAB_TIMEOUT','COMPACT_INTERVAL_MS','COLLAB_LEASE_TTL_MS','COLLAB_LEASE_HEARTBEAT_MS','COLLAB_SPOOL_CAPACITY_BYTES'])('数值键 %s：正整数过/非数拒/负拒/空串=未设过', (k) => {
    expect(envSchema.safeParse({ ...good, [k]: '3001' }).success).toBe(true);
    expect(envSchema.safeParse({ ...good, [k]: 'abc' }).success).toBe(false);
    expect(envSchema.safeParse({ ...good, [k]: '-1' }).success).toBe(false);
    expect(envSchema.safeParse({ ...good, [k]: '' }).success).toBe(true);   // B13：空串档
  });

  it('COLLAB_MAX_LOADED_DOCS：≥0（0=预留默认档，非 positive）', () => {
    expect(envSchema.safeParse({ ...good, COLLAB_MAX_LOADED_DOCS: '0' }).success).toBe(true);
    expect(envSchema.safeParse({ ...good, COLLAB_MAX_LOADED_DOCS: '-1' }).success).toBe(false);
  });

  it('COLLAB_SPOOL_DIR/COLLAB_ADMIN_TOKEN：非空串过、空串=未设（v4：BIND_ADDR 移 T4 不在此测）', () => {
    for (const k of ['COLLAB_SPOOL_DIR', 'COLLAB_ADMIN_TOKEN']) {
      expect(envSchema.safeParse({ ...good, [k]: '/var/x' }).success).toBe(true);
      expect(envSchema.safeParse({ ...good, [k]: '' }).success).toBe(true);
    }
  });

  it('MINIO_USE_SSL normalize 化（P45① v4.2/C4）：消灭反相且不新增启动失败面——任意串不过验、语义按 lowercase===true', () => {
    // v4 严格 enum 对 'True'/'1' 直接拒启动=本批唯一能硬失败启动的变更（服务器现值未采集——M0[2b] 补采）；
    // normalize：消灭 Boolean('false')=true 反相（v1 现状红相）且任何值形态不阻断启动（该键行为惰性——B 基线表 minio 行）
    for (const v of ['false', 'False', 'TRUE', '1', 'yes', 'garbage']) {
      const r = envSchema.safeParse({ ...good, MINIO_USE_SSL: v });
      expect(r.success, v).toBe(true);   // normalize 不 reject——全部过验
      if (r.success) expect(r.data.MINIO_USE_SSL, v).toBe(v.trim().toLowerCase() === 'true');
    }
    expect(envSchema.safeParse({ ...good, MINIO_USE_SSL: 'true' }).data?.MINIO_USE_SSL).toBe(true);
  });

  it('COLLAB_SWEEP_ENABLED：仅 true|false；空串=未设', () => {
    expect(envSchema.safeParse({ ...good, COLLAB_SWEEP_ENABLED: 'true' }).success).toBe(true);
    expect(envSchema.safeParse({ ...good, COLLAB_SWEEP_ENABLED: 'flase' }).success).toBe(false);
    expect(envSchema.safeParse({ ...good, COLLAB_SWEEP_ENABLED: '' }).success).toBe(true);
  });
});
```

- [ ] **Step 2: 跑红**

```bash
pnpm --filter @flowweb/api exec vitest run src/config/env.spec.ts
```

预期 FAIL：`envSchema` 未 export（红因 1）；COLLAB 值断言红（红因 2——无键=zod strip，'abc' 用例不拒）。

- [ ] **Step 3: 最小实现（env.ts）**

```ts
export const envSchema = z.object({ /* 既有键不动 */ });
```

（export 补上。）PROMETHEUS_TOKEN 行后追加：

```ts
  // Y0a-4（spec §3 4.6）：COLLAB_* 全族收口——zod=类型契约单源（错值启动拒）；默认值唯一定义在
  // 消费点（不写 default 防双源，P3）。空串=未设（B13：dotenv/shell 清开关常见形态，防拒启动）。
  // COMPACT_INTERVAL_MS=真实键名（gateway:25 无 COLLAB_ 前缀——前缀统一登记 Y0c env 根修）。
  // MAX_LOADED_DOCS=spec §3 4.6:502 原文点名预留（仅解析零消费，enforcement 归 Y1c-3）。
  // BIND_ADDR 不在此（v4/P42 键随读者——T4 与 gateway listen 同批落地，防方向二死键红）。
  // COLLAB_FAKE_AI 不在此（Y0b 资金批域，结构锚豁免表登记）。
  COLLAB_PORT: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),
  COLLAB_DEBOUNCE: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),
  COLLAB_TIMEOUT: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),
  COMPACT_INTERVAL_MS: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),
  COLLAB_SWEEP_ENABLED: z.preprocess(blankToUnset, z.enum(['true', 'false']).optional()),
  COLLAB_SPOOL_DIR: z.preprocess(blankToUnset, z.string().min(1).optional()),
  COLLAB_SPOOL_CAPACITY_BYTES: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),
  COLLAB_LEASE_TTL_MS: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),
  COLLAB_LEASE_HEARTBEAT_MS: z.preprocess(blankToUnset, z.coerce.number().int().positive().optional()),
  COLLAB_ADMIN_TOKEN: z.preprocess(blankToUnset, z.string().min(1).optional()),
  COLLAB_MAX_LOADED_DOCS: z.preprocess(blankToUnset, z.coerce.number().int().min(0).optional()),
```

同文件既有行更正（P45① v4.2/C4——normalize 不 reject：消灭 `z.coerce.boolean()` 对 `'false'` 的反相，且不新增"值形态不规范即 API 起不来"的启动失败面；该键有消费者〔minio.module:17→service:41 `tls:`〕但行为惰性——现网反相长期无害自证；Y0.5 终裁"删键 vs scheme 派生"）：

```ts
  MINIO_USE_SSL: z.preprocess(blankToUnset, z.string().optional())
    .transform((v) => (v ?? '').toLowerCase() === 'true'),
```

schema 定义前加：

```ts
const blankToUnset = (v: unknown) => (v === '' ? undefined : v);
```

- [ ] **Step 4: 双向结构锚 spec（读点⇔schema 键——P0-5 类漂移的机制化，防"手抄表"）**

```ts
// apps/api/src/config/collab-env-single-source.spec.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { envSchema } from './env';

/** Y0a-4（外审 D2/A9 折中）：env 契约=派生而非手抄——apps/api 内（含 src 与 scripts，v4/P42 注：
 * 扫描根 `join(__dirname,'../../')`=apps/api——scripts 的 collab-spool-import/quarantine 读
 * COLLAB_* 同受锚覆盖，是特性非噪音）每个 process.env.COLLAB_*/COMPACT_* 读点必须在 envSchema
 * 有键（方向一）；每个 schema 键必须被读或在豁免表（方向二）。
 * 新增 env 读点漏收口=本 spec 红（CI 拦截，防 P0-5 幻影键复发）。 */
const EXEMPT = new Map<string, string>([
  ['COLLAB_FAKE_AI', 'Y0b 资金批域（api-caller.service.ts:83）——E58/Y0b 同批收口'],
  ['COLLAB_MAX_LOADED_DOCS', 'spec-reserved：spec §3 4.6:502 原文点名"MAX_LOADED_DOCS 预留"（区别于被驳回的 plan 自创预留）——enforcement 归 Y1c-3（届时连消费点同批移出豁免）'],
]);

/** 纯函数抽取（v4/P42 评四 P1-8——方向一/自测共用同一判定逻辑，防恒真重言式） */
function missingReads(reads: Set<string>, schemaKeys: Set<string>, exempt: Map<string, string>): string[] {
  return [...reads].filter((k) => !schemaKeys.has(k) && !exempt.has(k));
}
function deadKeys(reads: Set<string>, schemaKeys: Set<string>, exempt: Map<string, string>): string[] {
  return [...schemaKeys].filter((k) => !reads.has(k) && !exempt.has(k));
}

function collectSrcFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'node_modules' || f === 'dist' ? [] : collectSrcFiles(p);
    return f.endsWith('.ts') && !f.endsWith('.spec.ts') ? [p] : [];
  });
}

describe('Y0a-4 env 单源结构锚（双向）', () => {
  const src = join(__dirname, '../../');
  const reads = new Set<string>();
  for (const file of collectSrcFiles(src)) {
    for (const m of readFileSync(file, 'utf8').matchAll(/process\.env\.(COLLAB_[A-Z_]+|COMPACT_INTERVAL_MS)/g)) reads.add(m[1]);
  }
  const schemaKeys = new Set(Object.keys(envSchema.shape).filter((k) => k.startsWith('COLLAB_') || k === 'COMPACT_INTERVAL_MS'));

  it('方向一：apps/api 内每个 COLLAB_/COMPACT 读点都在 envSchema 或豁免表（EXEMPT 双查——COLLAB_FAKE_AI 读点首日即红的教训）', () => {
    const missing = missingReads(reads, schemaKeys, EXEMPT);
    expect(missing, `以下读点未进 env zod 也未豁免（新 env 必须同批进 config/env.ts 或登记 EXEMPT）: ${missing.join(',')}`).toEqual([]);
  });

  it('方向二：每个 schema 键被读或在豁免表（死键即红）', () => {
    const dead = deadKeys(reads, schemaKeys, EXEMPT);
    expect(dead, `以下键零读点且未豁免（死契约）: ${dead.join(',')}`).toEqual([]);
  });

  it('判定函数自测（v4/P42——合成夹具证伪，替代恒真重言式）', () => {
    // 构造：读点 R1 不在 schema 也不在豁免 → 必被方向一抓出；豁免移除后豁免读点必被抓出
    const synReads = new Set(['COLLAB_A', 'COLLAB_B']);
    const synSchema = new Set(['COLLAB_B']);
    const synExempt = new Map([['COLLAB_A', 'x']]);
    expect(missingReads(synReads, synSchema, synExempt)).toEqual([]);
    expect(missingReads(synReads, synSchema, new Map())).toEqual(['COLLAB_A']);   // 移除豁免→红=豁免表在承担真实工作
    expect(deadKeys(new Set(['COLLAB_B']), new Set(['COLLAB_B', 'COLLAB_C']), new Map())).toEqual(['COLLAB_C']);   // 死键被抓
  });
});
```

- [ ] **Step 5: 跑绿+全量回归+启动实测（含真红相）**

```bash
pnpm --filter @flowweb/api exec vitest run src/config/env.spec.ts src/config/collab-env-single-source.spec.ts && pnpm --filter @flowweb/api test
# v4/评四 P1-6：tsx 不加载 .env（B3′ 本批自己的锚）——探针必须 -r dotenv/config（CWD=apps/api 时 dotenv 默认读 apps/api/.env）
cd apps/api && npx tsx -r dotenv/config -e "import {validateEnv} from './src/config/env'; validateEnv(); console.log('env OK')"
COLLAB_PORT=abc npx tsx -r dotenv/config -e "import {validateEnv} from './src/config/env'; validateEnv()" ; echo "exit=$?"   # 预期非 0（坏值拒启真红相）
COLLAB_PORT= npx tsx -r dotenv/config -e "import {validateEnv} from './src/config/env'; validateEnv(); console.log('blank OK')"   # 预期 blank OK（空串档）
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/config/env.ts apps/api/src/config/env.spec.ts apps/api/src/config/collab-env-single-source.spec.ts
git commit -m "feat(collab): Y0a-4 env zod 收口——COLLAB 全族+真键名 COMPACT_INTERVAL_MS+空串=未设+双向结构锚（missingReads 纯函数+合成夹具自测）+env.spec 内嵌副本删除改 import（第二契约源消灭；Step 0a export 先行/0b 换源——C1 顺序根修）+MINIO_USE_SSL normalize 化（coerce 反相修复且不新增启动失败面——C4）"
```

---

## Task 2: W23 独立停机令牌换装（guard 删 PROMETHEUS 回退）

**Files:**
- Modify: `apps/api/src/modules/collab/collab-admin-auth.guard.ts`
- Test: 既有 guard 相关 spec（grep 定位）+ 新增用例

- [ ] **Step 1: 写失败测试**

在 guard 既有 spec（执行时 `Glob apps/api/src/modules/collab/*admin*spec*` 定位；若无则新建 collab-admin-auth.guard.spec.ts）追加：

```ts
// v4.1/B5 修正：设 '' 无鉴别力——guard:12 `admin ?? PROM` 中 '' 非.nullish（→token=''→!token 先抛），
// 改动前后该用例都绿=假门禁。必须 delete 造"未设"（undefined 才触发 ?? 回退）。
// 回填纪律：prev===undefined 时禁止 env.X=prev（会把键设成字符串 'undefined'=truthy 污染后续用例）。
it('Y0a-4/W23：COLLAB_ADMIN_TOKEN 未设时不回退 PROMETHEUS_TOKEN（production 403）', () => {
  const prevAdmin = process.env.COLLAB_ADMIN_TOKEN, prevProm = process.env.PROMETHEUS_TOKEN, prevNode = process.env.NODE_ENV;
  delete process.env.COLLAB_ADMIN_TOKEN;   // ← 关键：'' 走 !token 分支测不到回退；undefined 才走 ?? PROM
  process.env.PROMETHEUS_TOKEN = 'prom-tok'; process.env.NODE_ENV = 'production';
  try {
    const guard = new CollabAdminAuthGuard();
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-prometheus-token': 'prom-tok' } }) }) } as any;
    expect(() => guard.canActivate(ctx)).toThrow();   // 真红相：现状回退 prom-tok 匹配→放行不抛→toThrow 红；删回退后=绿
  } finally {
    if (prevAdmin === undefined) delete process.env.COLLAB_ADMIN_TOKEN; else process.env.COLLAB_ADMIN_TOKEN = prevAdmin;
    if (prevProm === undefined) delete process.env.PROMETHEUS_TOKEN; else process.env.PROMETHEUS_TOKEN = prevProm;
    if (prevNode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevNode;
  }
});

```

- [ ] **Step 2: 跑红+探针门产物**——现状（回退存在）下上测**必红**（红因=`?? PROM` 回退 prom-tok 匹配→放行不抛→toThrow 失败）；实现后跑绿。**两态输出（红/绿各一条）粘进 commit message**——证明用例鉴别力（v4.1/B5：v3/v4 原用例设 `''` 在改动前后都绿=假门禁，已修）。

- [ ] **Step 3: 最小实现（guard 头注+逻辑同步改写）**

```ts
// Y0a-3（Z15）→Y0a-4（W23 换装完成）：drain 凭据独立——监控只读令牌（PROMETHEUS_TOKEN）≠停机权。
// COLLAB_ADMIN_TOKEN 未设：production fail-closed 403（不回退——v2 裁定 P16）；dev fail-open 维持（/metrics 同源）。
// ready 授权档视图（读 pending）仍认双 token——读视图非停机权。
```

`canActivate` 内：删 `?? process.env.PROMETHEUS_TOKEN` 与回退 WARN 块（:12/:17-20）；`token = admin`；无 admin→dev 放行/production 403（文案改"COLLAB_ADMIN_TOKEN 未设置——drain fail-closed（W23：独立停机令牌，runbook 先建令牌再部署）"）。

- [ ] **Step 4: 消费点核对+跑绿**

```bash
grep -rn "PROMETHEUS_TOKEN" apps/api/src/modules/collab/ apps/api/scripts/ scripts/ | grep -v spec
pnpm --filter @flowweb/api test
```

预期：controller:29（ready 视图）保留双 token；其余零回退；collab-ready.controller.spec 的 ADMIN_TOKEN delete 用例（:62/75/110）若断言"回退后视图授权"形态——**保持**（视图回退未删）；drill/gate 若有 drain HTTP 调用改持 ADMIN_TOKEN（grep 结果为零则无此步）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/collab/
git commit -m "feat(collab): Y0a-4 W23 独立停机令牌换装——drain 不再回退 PROMETHEUS_TOKEN（监控≠停机权；production fail-closed；ready 视图双 token 维持）"
```

---

## Task 3: 旁路 PrismaClient 纳管（行为断言版）

**Files:**
- Modify: `apps/api/src/auth/auth.ts:10`、`apps/api/src/auth/auth.module.ts`、`apps/api/src/main.ts:40-55`（v4.2/B30+评五 M3：preloadDbConfig 的 catch 后**启动继续**——实测 :52-54 只 console.error 即返回，bootstrap 继续 ⇒ 临时 PrismaClient 池存活整进程；v4.1 T13 注记"启动失败即进程退出故无害"为事实错误〔认账〕，1 行 disconnect 收口与本任务同族）
- Test: `apps/api/src/common/redis/managed-redis.spec.ts` 追加

- [ ] **Step 1: 写失败测试（行为断言——外审 D4：字符串锚可被注释满足=假门禁）**

```ts
it('Y0a-4/E46：authPrisma 纳管——AuthModule.onApplicationShutdown 断开（行为断言非源码匹配）', async () => {
  const { authPrisma } = await import('../../auth/auth');
  const { AuthModule } = await import('../../auth/auth.module');
  const disconnect = vi.spyOn(authPrisma, '$disconnect').mockResolvedValue();
  await new AuthModule().onApplicationShutdown();
  expect(disconnect).toHaveBeenCalledTimes(1);   // v1 现状：无此调用=红
});
```

- [ ] **Step 2: 跑红** → **Step 3: 实现**

auth.ts:10：

```ts
/** Y0a-4/E46：模块级 PrismaClient 纳管（authRedis 同款受管形态）——AuthModule.onApplicationShutdown 断开 */
export const authPrisma = new PrismaClient();
```

（:48/:55 引用同步改名。）auth.module.ts：

```ts
  export class AuthModule implements OnApplicationShutdown {
    async onApplicationShutdown() {
      authRedis.disconnect();
      await authPrisma.$disconnect();   // Y0a-4/E46：$disconnect 为 async——显式 await（关停序确定）
    }
  }
```

main.ts:40-55 同提交（v4.2/B30——preload 失败路径的客户端关停，非单例化、与 E46 三驳不冲突）：

```ts
  const prisma = new PrismaClient();   // 声明提到 try 外（try 内 const 块级作用域在 catch 不可见）
  try {
    const rows = await prisma.systemSetting.findMany();
    let overridden = 0;
    for (const row of rows) {
      if (ALLOWED_DB_OVERRIDE_KEYS.has(row.key) && row.value) {
        process.env[row.key] = row.value;
        overridden++;
      }
    }
    await prisma.$disconnect();
    console.log(`[ConfigPreload] 从 DB 加载了 ${overridden} 项配置（共 ${rows.length} 条记录）`);
  } catch (err) {
    console.error('[ConfigPreload] 读取 DB 配置失败，使用 .env 兜底:', (err as Error).message);
    await prisma.$disconnect().catch(() => {});   // Y0a-4/E46+B30：catch 后启动继续——不 disconnect 则该池存活整进程
  }
```

- [ ] **Step 4: 跑绿+回归**（`pnpm --filter @flowweb/api test`）→ **Step 5: Commit**

```bash
git add apps/api/src/auth/ apps/api/src/common/redis/managed-redis.spec.ts
git commit -m "feat(collab): Y0a-4 authPrisma 纳管——AuthModule 关停 $disconnect（行为断言锚；spec E46 裁定纳管形态，单例化登记 Y0.5 重评）"
```

---

## Task 4: 容量观测+库选项 pin（双旋钮）+COLLAB_BIND_ADDR（N16 交接）

**Files:**
- Modify: `apps/api/src/modules/collab/store.metrics.ts`、`collab.gateway.ts`（构造段+gauge 供数+listen 日志）、`collab-ready.service.ts`/`collab-ready.controller.ts`（授权档字段）、`collab-document.service.ts:39`（disconnect 旋钮）、`collab-spool.service.ts:570`（守卫去 NODE_ENV 前置）、`apps/api/src/config/env.ts`（**v4/P42：COLLAB_BIND_ADDR 键在此落地——键随读者同一提交，方向二不死键**）
- Modify: `packages/shared/src/**`（`CollabReadyResponse` 加可选字段——**v3 增**：该类型在 shared（collab-ready.service.ts:7 import type），body 加键不做类型=excess property error=tsc 红；`loadedDocs?/connections?` 两可选字段，公开档四键契约不动）
- Test: 既有 metrics/ready spec 追加

- [ ] **Step 1: 写失败测试**

```ts
// 追加至 store.metrics 相关 spec（执行时按既有 spec 结构落位）
it('Y0a-4/N16：yjs_loaded_documents/yjs_connection_count gauge 注册并可采数', async () => {
  const { register } = await import('prom-client');
  const loaded = await register.getSingleMetric('yjs_loaded_documents');
  const conns = await register.getSingleMetric('yjs_connection_count');
  expect(loaded).toBeTruthy(); expect(conns).toBeTruthy();
});
```

ready spec 追加（授权档）：

```ts
it('Y0a-4/N16：ready 授权档含 loadedDocs/connections（公开档四键不变）', async () => {
  const authBody = await getReadyWithToken(token);
  expect(authBody.loadedDocs).toBeDefined(); expect(authBody.connections).toBeDefined();
  const pubBody = await getReady();
  expect(Object.keys(pubBody).sort()).toEqual(['epoch', 'ready', 'reason', 'redis']);   // V17 契约零动
});
```

- [ ] **Step 2: 跑红** → **Step 3: 实现**

store.metrics.ts 追加（collect 现算形态——同 pendingCollector 惯例）：

```ts
export const yjsLoadedDocuments = new Gauge({ name: 'yjs_loaded_documents', help: 'Y0a-4/N16: 在飞 Y.Doc 数（Hocuspocus documents.size）——容量三数观测，enforcement 归 Y1c-3' });
export const yjsConnectionCount = new Gauge({ name: 'yjs_connection_count', help: 'Y0a-4/N16: collab WS 连接数（A3 口径=connections+directConnections）' });
```

gateway 构造段（:192-210）追加（P24/P25/B20 双旋钮）：

```ts
      address: process.env.COLLAB_BIND_ADDR ?? '0.0.0.0',   // Y0a-4/P25：默认不变；ecosystem 注入 127.0.0.1（nginx 同机唯一合法路径）
      unloadImmediately: true,   // Y0a-4/P24 显式 pin（B26：库默认即 true——本行是文档锚防升级翻转，非行为修复；验证预算勿投"行为变化"）
      quiet: false,              // 同上——defaultConfiguration 已 false，pin 为锚
```

`env.ts` 同提交追加（P42 键随读者——方向二锚因此不红）：

```ts
  COLLAB_BIND_ADDR: z.preprocess(blankToUnset, z.string().min(1).optional()),
```

listen 成功处补一行启动日志（O-4——绑定面漂移在日志可见）：`this.logger.log(`collab listen ${addr}:${port}（COLLAB_BIND_ADDR=${process.env.COLLAB_BIND_ADDR ?? 'unset→0.0.0.0'}）`)`。

**A6 真旋钮（B20——v2 钉错位修正）**：`collab-document.service.ts:39` 裸 `connection.disconnect()` 改：

```ts
await connection.disconnect({ unloadImmediately: true });   // Y0a-4/P24：A6 锚=Connection 级旋钮（d.ts:431）——B26：库默认即 true，显式 pin=防升级翻转的文档锚（非行为修复，不写行为红相探针）；await 与库锚 A6 断言同源
```

**spool 路径守卫无条件化（L）**：`collab-spool.service.ts:570` 的 `process.env.NODE_ENV === 'production' && !isAbsolute(...)` 改 `process.env.COLLAB_SPOOL_DIR && !isAbsolute(this.rawDir)`（危险=显式配置相对路径，与"是否生产"无关——NODE_ENV 不注入〔Y0.5〕时原守卫在服务器恒失效；本地默认值不受影响）。

gauge 供数（P1-10 定形——**复用单一 collector 惯例**，禁第二套机制）：`store.metrics.ts` 既有 `pendingCollector`（:105-142）扩展快照两字段→两个新 Gauge 同款 `collect(){ try{...}catch{ this.set(0) } }` 形态（X11/X17——collect 抛错=整个 /api/metrics 500）；连接计数口径注释写死：**server 级 `getConnectionsCount()` 已聚合 WS 连接，`documents` 的 `directConnectionsCount` 单独累加、勿重复计**。ready.service 授权档 body 增 `loadedDocs/connections` 两键（**pending 的兄弟字段——禁进 `pending`**：其四键形状被 guard 四零判据/G-1/G-2 演练/toMatchObject 冻结消费）；shared `CollabReadyResponse` 加 `loadedDocs?: number; connections?: number`。**commit 字段不加**（P34——V17/SV16 契约不动，溯源走 pm2_env 口径；Y0b 可选登记）。

- [ ] **Step 4: 跑绿+回归+锚联动**

```bash
pnpm --filter @flowweb/api test && node scripts/check-hocuspocus-pin.mjs
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/collab/ apps/api/src/config/env.ts packages/shared/src/
git commit -m "feat(collab): Y0a-4 容量观测三件套前二——loaded docs/connections gauge+ready 授权档字段（N16 交接；enforcement 归 Y1c-3）+库选项 pin unloadImmediately/quiet（B26 文档锚）+COLLAB_BIND_ADDR 键与 reader 同批（P42）"
```

---

## Task 5: ecosystem 入库+check-ecosystem 锚+deploy.sh 进程定义改造（契约 9）

**Files:**
- Create: `ecosystem.config.cjs`、`scripts/check-ecosystem.mjs`、`scripts/check-ecosystem.test.mjs`
- Modify: `deploy.sh`（restart 块抽 `cutover_api()`（v4 改名）+startOrReload+ecosystem 上传+去内联）、`package.json`（verify 追加）

- [ ] **Step 1: ecosystem.config.cjs（数值=Task 0 Step 3 结论；守护三件套 A7）**

```js
// ecosystem.config.cjs —— FlowWeb api 进程定义唯一源（Y0a-4/spec §4.1+冻结契约 9）
// 数值依据：docs/superpowers/deploy-server-profile-2026-10.md（RSS 口径算式）；结构锚=scripts/check-ecosystem.mjs
// 生效方式：deploy.sh 统一 `pm2 startOrReload ecosystem.config.cjs --update-env`（B1′：restart 不读文件——改本文件必须 startOrReload）
// 迁移 runbook：docs/superpowers/collab-ops-runbook.md §1（startOrReload 幂等——首启/更新均同一条命令）
// NODE_ENV 不在此注入（B8 八读点审计归 Y0.5/E58 一体——现值见 server-profile）
module.exports = {
  apps: [{
    name: 'flowweb-api',
    script: 'apps/api/dist/main.js',
    cwd: '/home/ubuntu/flowweb',
    instances: 1,                     // 单实例钉死（E35）——多实例=移除租约+所有权注册表（Y7）
    exec_mode: 'fork',
    kill_timeout: 45000,              // E43⑤/SV6：HTTP dispose+关停链 ≤22s+垫 ≥23s
    kill_signal: 'SIGTERM',
    max_memory_restart: '1G',         // ← M0 实测定稿（RSS 口径；check-ecosystem 断言 ≥ old-space+384MB）
    node_args: '--max-old-space-size=512',   // ← M0 实测定稿（1.9GB 协居机算式解；spec 原型 768 过不了算术）
    min_uptime: '30s',                // A7 守护三件套：防快崩溃重启风暴
    max_restarts: 10,
    restart_delay: 4000,
    autorestart: true,
    watch: false,
    env: {
      // env 白名单（check-ecosystem 断言）：禁密钥进本文件——其余 env 一律服务器 apps/api/.env 手工管理
      // v4.2/P47：树外目录——部署树内的 .data 只靠 provision_tarball 的 --exclude 一条纪律保命（tar/整目录删除覆盖）；
      // 迁移机制本批已建（cutover ③.5），目标改树外一次性取消整类风险
      COLLAB_SPOOL_DIR: '/home/ubuntu/flowweb-data/collab-spool',   // E37+P47：绝对路径且树外（CWD 漂移+部署覆盖双防护）
      COLLAB_BIND_ADDR: '127.0.0.1',   // P25：3001 不公网监听（nginx 同机反代唯一路径）
    },
    merge_logs: true,
    time: true,
  }],
};
```

- [ ] **Step 2: check-ecosystem.mjs（v3——纯函数+isMain 薄 CLI+fail-closed 解析+上传面断言）**

```js
// scripts/check-ecosystem.mjs —— Y0a-4：ecosystem 结构锚（冻结契约 9）+deploy.sh 调用图/上传面/零服务器构建探测
// 用法：node scripts/check-ecosystem.mjs [ecosystem-path]（默认 <ROOT>/ecosystem.config.cjs）
// 自测载体=scripts/check-ecosystem.test.mjs（node:test，唯一入口——防双源）；本文件 import 零副作用（isMain 守卫）
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(import.meta.url);
const ROOT = resolve(here, '../..');

const toBytes = (v) => {
  if (typeof v === 'number') return v;
  const m = /^(\d+)([KMGT]?)$/.exec(String(v));
  return m ? Number(m[1]) * ({ '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 })[m[2]] : NaN;
};

/** v4/P43：bash 函数体提取——大括号配平+注释剥离；提取失败返回 ''（调用方即 fail——"提取不到就算过"是空转源；
 * v3 正则 `\n\}` 对单行体恒无匹配=正样本夹具首跑红的根修。
 * v4.2/评五 P1-7：注释剥离改"整行注释+空白前行尾注释"（v4 全局 `/#.*$/` 会把 `${#var}` 截成 `${`=配平失衡；
 * 且引号内 ` #` 会被误截——误截的后果=提取失败 fail-closed〔非静默过〕，本仓 deploy.sh 无引号内 # 形态〔头注契约〕） */
export function extractBashFunction(src, fn) {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^${fn}\\(\\)\\s*\\{`).test(l));
  if (start < 0) return '';
  let depth = 0;
  const body = [];
  for (let i = start; i < lines.length; i++) {
    body.push(lines[i]);
    const code = lines[i].replace(/(^\s*#.*$)|(\s#.*$)/, '');   // 整行注释或"# 前有空白"的行尾注释——`${#var}`/`"a#b"`（# 前非空白）不截
    for (const ch of code) { if (ch === '{') depth++; else if (ch === '}') depth--; }
    if (depth === 0) return body.join('\n');
  }
  return '';   // 未闭合
}

export function checkEcosystem(app, deploySrc) {
  const errs = [];
  const fail = (m) => errs.push(m);
  app.name === 'flowweb-api' || fail(`name=${app.name}`);
  app.exec_mode === 'fork' || fail(`exec_mode=${app.exec_mode}（E35 禁 cluster）`);
  app.instances === 1 || fail(`instances=${app.instances}`);
  Number.isInteger(app.kill_timeout) && app.kill_timeout >= 45000 || fail(`kill_timeout=${app.kill_timeout}（E43⑤ ≥45000）`);
  app.kill_signal === 'SIGTERM' || fail(`kill_signal=${app.kill_signal}`);
  const heap = Number(/--max-old-space-size=(\d+)/.exec(app.node_args ?? '')?.[1]);
  const rss = toBytes(app.max_memory_restart);
  // v3 fail-closed：不可解析即红，禁静默跳过断言（'1g'/'1GB'/'1.5G' 等 pm2 接受但令门禁失效的形态）
  Number.isFinite(heap) || fail(`node_args 缺 --max-old-space-size 或值不可解析: ${app.node_args}`);
  Number.isFinite(rss) || fail(`max_memory_restart 不可解析: ${app.max_memory_restart}（支持 1024/1K/1M/1G 整数形态）`);
  if (Number.isFinite(heap) && Number.isFinite(rss)) {
    rss >= heap * 1024 * 1024 + 384 * 1024 * 1024 || fail(`RSS 口径：max_memory_restart(${app.max_memory_restart}) 必须 ≥ old-space(${heap}M)+384M（Yjs 外部内存余量）`);
    rss <= 1900 * 1024 * 1024 || fail('max_memory_restart 超 1.9GB 物理粗线');
  }
  isAbsolute(app.env?.COLLAB_SPOOL_DIR ?? '') || fail('COLLAB_SPOOL_DIR 必须绝对路径');
  app.env?.COLLAB_BIND_ADDR === '127.0.0.1' || fail('COLLAB_BIND_ADDR 必须 127.0.0.1（P25）');
  // NODE_ENV 禁令（Y0.5/E58 落地才解禁）+v4/B25：GIT_COMMIT_HASH 移出白名单（它来自 shell 注入非 env{}
  // ——白名单死条目删除；溯源改 cutover_api 体内行为锚，"记得注入"升"脚本断言"）
  const ENV_ALLOWLIST = new Set(['COLLAB_SPOOL_DIR', 'COLLAB_BIND_ADDR']);
  for (const k of Object.keys(app.env ?? {})) ENV_ALLOWLIST.has(k) || fail(`env 键 ${k} 不在白名单（禁密钥进 ecosystem——env 走服务器 .env）`);
  typeof app.script === 'string' && isAbsolute(app.cwd) || fail('script/cwd 形态');
  /pm2 [^#]*--kill-timeout/.test(deploySrc) && fail('deploy.sh 残留 pm2 --kill-timeout 内联（契约 9：ecosystem 唯一源；注：注释中记录被禁写法同样命中——本就不该记录）');
  // v4/P43 调用图断言（提取失败本身即 fail）
  const cutover = extractBashFunction(deploySrc, 'cutover_api');
  const dApi = extractBashFunction(deploySrc, 'deploy_api');
  const dFull = extractBashFunction(deploySrc, 'deploy_full');
  const prov = extractBashFunction(deploySrc, 'provision_tarball');
  const rollbackFn = extractBashFunction(deploySrc, 'rollback_api');
  cutover || fail('cutover_api() 提取失败（定义缺失或未闭合——禁静默过）');
  dApi || fail('deploy_api() 提取失败（定义缺失或未闭合）');
  dFull || fail('deploy_full() 提取失败（定义缺失或未闭合）');
  prov || fail('provision_tarball() 提取失败（v4.2/P48：未定义函数被 AND-OR 吞=首次 full 半铺底继续跑——定义缺失即红）');
  rollbackFn || fail('rollback_api() 提取失败');
  (deploySrc.match(/^cutover_api\(\)/gm) ?? []).length === 1 || fail('cutover_api 定义必须恰 1 处');
  if (cutover) /GIT_COMMIT_HASH=/.test(cutover) || fail('cutover_api 必须注入 GIT_COMMIT_HASH=（+3 溯源行为锚）');
  if (dApi) /cutover_api\b/.test(dApi) || fail('deploy_api 函数体必须调用 cutover_api');
  if (dFull) (/deploy_web\b/.test(dFull) && /deploy_api\b/.test(dFull)) || fail('deploy_full 函数体必须调用 deploy_web+deploy_api（间接经 deploy_api 达 cutover——调用图断言）');
  if (dFull) /provision_tarball\b/.test(dFull) || fail('deploy_full 函数体必须调用 provision_tarball（铺底入口——v4.2/P48）');
  // v4.2/评五 P1-12②：export 白名单锚——B25（--update-env 记录当前 shell 全量 env 进 pm2_env）目前只有注释/runbook 纪律，升为机器锚
  for (const [fnName, fnBody] of [['cutover_api', cutover], ['rollback_api', rollbackFn]]) {
    const badExport = fnBody?.match(/\bexport\s+(?!GIT_COMMIT_HASH=)[A-Za-z_][A-Za-z0-9_]*/);
    if (badExport) fail(`${fnName} 含非 GIT_COMMIT_HASH 的 export（B25：--update-env 会把它常驻进 pm2_env）: ${badExport[0]}`);
  }
  /api\)[^\n]*ROLLBACK/.test(deploySrc) || fail('`api)` 分派必须对 --rollback 跳过 preflight（v4：回滚 30s 快路径不被 15-20 分钟预检钉死——分派层判定非函数内）');
  // v4/P43 零构建锚 ssh 作用域化：不变量=**服务器侧零构建**（deploy_web 本地 vite build 合法——"脚本内零构建"表述作废）
  /\bssh\b[^\n]*\b(nest build|vite build|tsc -p)\b/.test(deploySrc) && fail('存在经 ssh 在服务器构建的调用（部署形态=本地构建上传——deploy_full 的服务器端 shared/api/web 构建必须移除）');
  // 上传面断言（P33——文本锚，"写了但传不上"已犯两次；行为锚=服务器侧 test 三件在 cutover ⑥）
  /ecosystem\.config\.cjs[^|]*\|\|\s*ssh|scp[^&]*ecosystem\.config\.cjs/.test(deploySrc) || fail('deploy.sh 必须上传 ecosystem.config.cjs');
  /-C scripts \./.test(deploySrc) || fail('deploy.sh 必须上传根 scripts/');
  /-C apps\/api\/scripts \./.test(deploySrc) || fail('deploy.sh 必须上传 apps/api/scripts/（冒烟脚本所在）');
  return errs;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const req = createRequire(here);
  const ecoPath = process.argv[2] ? resolve(process.argv[2]) : resolve(ROOT, 'ecosystem.config.cjs');
  const app = req(ecoPath).apps[0];
  const deploySrc = readFileSync(resolve(ROOT, 'deploy.sh'), 'utf8');
  const errs = checkEcosystem(app, deploySrc);
  if (errs.length) { console.error(`check-ecosystem FAIL:\n  ${errs.join('\n  ')}`); process.exit(1); }
  console.log('check-ecosystem OK: fork/1实例/45000/SIGTERM/RSS口径fail-closed/env白名单/SPOOL_DIR绝对/BIND_ADDR/契约9无内联/cutover_api单源（含GIT_COMMIT_HASH行为锚）/上传面三件');
}
```

- [ ] **Step 3: check-ecosystem.test.mjs（node:test 唯一自测入口——P23/P29）**

```js
// scripts/check-ecosystem.test.mjs —— 判据载体自测（A11；node --test scripts/ 消费——import 零副作用）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEcosystem, extractBashFunction } from './check-ecosystem.mjs';

const okApp = { name: 'flowweb-api', exec_mode: 'fork', instances: 1, kill_timeout: 45000, kill_signal: 'SIGTERM',
  node_args: '--max-old-space-size=512', max_memory_restart: '1G', cwd: '/home/ubuntu/flowweb', script: 'apps/api/dist/main.js',
  env: { COLLAB_SPOOL_DIR: '/abs', COLLAB_BIND_ADDR: '127.0.0.1' } };
// v4/P43：夹具多行形态（对齐真实 deploy.sh；v3 单行体被提取正则拒匹配=正样本首跑红的教训）
// v4.2/P48：deploy_full 三行顺次（B28 AND-OR 形态）+provision_tarball/rollback_api 定义补齐（提取锚的正样本）
const okDeploy = [
  'cutover_api() {',
  '  ssh srv "export GIT_COMMIT_HASH=$(node -e \\"console.log(require(\'./apps/api/dist/build-info.json\').git)\\") && pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save"',   // P46：产物派生（export 白名单锚允许 GIT_COMMIT_HASH=）
  '}',
  'rollback_api() {',
  '  ssh srv "cd apps/api && mv dist dist.next && mv dist.prev dist"',
  '  ssh srv "export GIT_COMMIT_HASH=$(node -e \\"console.log(require(\'./apps/api/dist/build-info.json\').git)\\") && pm2 startOrReload ecosystem.config.cjs --update-env"',
  '}',
  'deploy_web() {',
  '  ( cd apps/web && rm -rf dist && npx vite build )',   // 本地构建=合法（零构建锚只扫 ssh 行）
  '}',
  'provision_tarball() {',                                 // v4.2/P48：铺底入口（无服务器构建——零构建锚对函数体同判）
  '  tar czf - --exclude=node_modules apps/ scripts/ ecosystem.config.cjs package.json | ssh srv "tar xzf -"',
  '}',
  'deploy_api() {',
  '  scp ecosystem.config.cjs srv:',
  '  tar czf - -C scripts . | ssh srv "tar xzf -"',
  '  tar czf - -C apps/api/scripts . | ssh srv "tar xzf -"',
  '  cutover_api',
  '}',
  'deploy_full() {',                                       // v4.2/P48：三行顺次=errexit 逐条生效（B28）
  '  provision_tarball',
  '  deploy_web',
  '  deploy_api',
  '}',
  'case "$MODE" in',
  '  api) if [[ $ROLLBACK == 1 ]]; then deploy_api; else preflight; deploy_api; fi ;;',
  'esac',
].join('\n');

test('正样本零错误（v4 修复目标——v3 此测首跑即红）', () => assert.deepEqual(checkEcosystem(okApp, okDeploy), []));
test('提取器自测：多行✓/嵌套大括号✓/单行体✓（配平算法天然支持——v3 是正则要求 \\n} 才炸）/未闭合与缺失=提取失败', () => {
  assert.match(extractBashFunction(okDeploy, 'deploy_api'), /cutover_api/);
  const nested = ['f() {', '  if [ -d x ]; then', '    { a; }', '  fi', '}'].join('\n');
  assert.match(extractBashFunction(nested, 'f'), /if \[ -d x \]/);   // 嵌套 { a; } 不提前截断
  assert.match(extractBashFunction('f() { single; }', 'f'), /single/);
  assert.equal(extractBashFunction(['f() {', '  x'].join('\n'), 'f'), '');   // 未闭合=''
  assert.equal(extractBashFunction('function missing { }', 'f'), '');        // 定义缺失=''
  // v4.2/评五 P1-7：${#var} 与无空格 # 不截（v4 全局 /#.*$/ 会把 ${#arr[@]} 截成 ${ = 配平失衡）
  const hashVar = ['g() {', '  n=${#arr[@]}', '}'].join('\n');
  assert.match(extractBashFunction(hashVar, 'g'), /\$\{#arr\[@\]\}/);        // # 前非空白=不截
  const inlineCmt = ['h() {   # 行尾注释含 { 括号', '  x', '}'].join('\n');   // 行尾注释（# 前空白）剥离后配平不受注释内 { 影响
  assert.match(extractBashFunction(inlineCmt, 'h'), /^h\(\) \{\s*$/m);
});
test('RSS 口径（512M 堆+384M>700M 线）', () => {
  assert.ok(checkEcosystem({ ...okApp, max_memory_restart: '700M' }, okDeploy).some((e) => e.includes('RSS 口径')));
});
test('fail-closed：max_memory_restart 不可解析（1g/1GB/1.5G）即红，禁静默跳过', () => {
  for (const bad of ['1g', '1GB', '1.5G', 'garbage']) {
    assert.ok(checkEcosystem({ ...okApp, max_memory_restart: bad }, okDeploy).some((e) => e.includes('不可解析')), bad);
  }
});
test('调用图：deploy_full 缺 deploy_api 调用必红；cutover 缺 GIT_COMMIT_HASH= 必红（+3 行为锚）', () => {
  const bad1 = okDeploy.replace(/  deploy_api\n\}/, '}');   // deploy_full 只剩 deploy_web
  assert.ok(checkEcosystem(okApp, bad1).some((e) => e.includes('deploy_full')));
  const bad2 = okDeploy.replace('export GIT_COMMIT_HASH=$GIT_SHA && ', '');
  assert.ok(checkEcosystem(okApp, bad2).some((e) => e.includes('GIT_COMMIT_HASH')));
});
test('env 白名单：密钥/NODE_ENV/GIT_COMMIT_HASH（v4 死条目已删）三者皆红', () => {
  assert.ok(checkEcosystem({ ...okApp, env: { ...okApp.env, MINIO_SECRET_KEY: 'x' } }, okDeploy).some((e) => e.includes('白名单')));
  assert.ok(checkEcosystem({ ...okApp, env: { ...okApp.env, NODE_ENV: 'production' } }, okDeploy).some((e) => e.includes('白名单')));
  assert.ok(checkEcosystem({ ...okApp, env: { ...okApp.env, GIT_COMMIT_HASH: 'abc' } }, okDeploy).some((e) => e.includes('白名单')));
});
test('内联 kill-timeout 残留即红（契约 9）', () => {
  assert.ok(checkEcosystem(okApp, okDeploy + '\nssh srv "pm2 restart flowweb-api --kill-timeout 45000"').some((e) => e.includes('kill-timeout')));
});
test('v4 零构建锚 ssh 作用域：ssh 内构建红/本地构建绿', () => {
  assert.ok(checkEcosystem(okApp, okDeploy + '\nssh srv "cd apps/api && npx nest build"').some((e) => e.includes('服务器构建')));
  assert.ok(checkEcosystem(okApp, okDeploy + '\nssh srv "npx tsc -p packages/shared/tsconfig.build.json"').some((e) => e.includes('服务器构建')));
});
test('v4 rollback 分派锚：`api)` 行缺 ROLLBACK 条件必红', () => {
  const bad = okDeploy.replace('api) if [[ $ROLLBACK == 1 ]]; then deploy_api; else preflight; deploy_api; fi ;;', 'api) preflight; deploy_api ;;');
  assert.ok(checkEcosystem(okApp, bad).some((e) => e.includes('rollback')));
});
test('上传面三件缺一即红（P33）', () => {
  for (const drop of [/ecosystem\.config\.cjs[^|]*\|\|\s*ssh|scp[^&]*ecosystem\.config\.cjs/, /-C scripts \./, /-C apps\/api\/scripts \./]) {
    const src = okDeploy.replace(drop, 'MISSING');
    assert.ok(checkEcosystem(okApp, src).some((e) => e.includes('上传') || e.includes('ecosystem.config.cjs') || e.includes('scripts')), String(drop));
  }
});
test('v4.2/P48：provision_tarball 定义缺失必红（未定义函数被 AND-OR 吞=首次 full 半铺底继续跑的锚）', () => {
  const bad = okDeploy.replace(/^provision_tarball\(\) \{[\s\S]*?\n\}\n/m, '');
  assert.ok(checkEcosystem(okApp, bad).some((e) => e.includes('provision_tarball')), '定义缺失应红');
});
test('v4.2/评五 P1-12②：cutover/rollback 内非 GIT_COMMIT_HASH 的 export 必红（B25 纪律升锚）', () => {
  const bad = okDeploy.replace('export GIT_COMMIT_HASH=$(node -e \\"console.log(require(\'./apps/api/dist/build-info.json\').git)\\") && pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save"',
    'export FOO_BAR=1 && export GIT_COMMIT_HASH=x && pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save');
  assert.ok(checkEcosystem(okApp, bad).some((e) => e.includes('非 GIT_COMMIT_HASH 的 export')), '杂 export 应红');
});
test('v4.2/评五 P1-7：provision_tarball 内含 ssh 服务器构建必红', () => {
  const bad = okDeploy.replace('tar czf - --exclude=node_modules apps/ scripts/ ecosystem.config.cjs package.json | ssh srv "tar xzf -"',
    'ssh srv "cd apps/api && npx nest build"');
  assert.ok(checkEcosystem(okApp, bad).some((e) => e.includes('服务器构建')), '铺底内构建应红');
});
```

- [ ] **Step 4: deploy.sh 进程定义改造（restart 块单源化——D5；两模式共用）**

deploy.sh 头部参数区后新增函数（FORCE_RESTART 解析同 v1）：

```bash
# cutover_api（v4/P43 改名——函数含 guard/重启，T8 扩为 guard→备份→migrate→切换→重启→post 全链=切换，
# restart_api 名不副实会误导 3am 排障）。进程定义唯一源=ecosystem.config.cjs（冻结契约 9）。
# startOrReload 重读文件且幂等（B1′：restart 只用登记快照不读文件）。GIT_COMMIT_HASH 注入（P1-3；
# B25：--update-env 会记录当前 shell 全量 env——部署会话禁 export 其他变量，runbook §3 写明）。
cutover_api() {
  echo "=== 部署拒重启三步（Y0a-4：drain→own 四零→放行；guard 自读服务器 apps/api/.env） ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && node scripts/deploy-guard.mjs $([[ $FORCE_RESTART == 1 ]] && echo --force) $([[ $ALLOW_LEGACY == 1 ]] && echo --allow-legacy)"

  echo "=== 重启后端（startOrReload——kill_timeout 45000 由 ecosystem 承载） ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && export GIT_COMMIT_HASH=$GIT_SHA && pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save"
}
```

（`GIT_SHA=$(git rev-parse --short HEAD)` 脚本头部取〔v4：紧跟脚本顶部 `cd "$(dirname "$0")"` 之后——相对路径/git 子命令不随调用目录漂移〕；`ALLOW_LEGACY` 参数解析同 FORCE_RESTART——`./deploy.sh api --allow-legacy`。）
**v4.2/P48 措辞拆清（评五 C3——v4 原文对 deploy_full 的双重指令自相矛盾）**：T5 **只动三处**——①deploy_full 与 deploy_api 的原 restart 块（:57-60/:94-97）整段替换为 `cutover_api` 调用；②deploy_full tar 清单（:35）追加 `ecosystem.config.cjs`+exclude 追加 `.deploy-guard-state.json`/`.preflight-*.ok`/`.installed-lock-sha`；③分派层三行。**deploy_full 的函数级重构（provision_tarball 三行顺次形态）归 T8**——T5 后 deploy_full 仍是"tar 铺底+install+generate+migrate+三次服务器构建+cutover_api"旧本体（服务器构建段零构建锚红=原子序列声明内红态，T8 消灭）。**v4 骨架同步**：脚本第二行 `cd "$(dirname "$0")"`+分派层三行——`full) [[ $ROLLBACK == 1 ]] && { echo "--rollback 仅支持 api 模式（web 无回滚点/full=铺底）"; exit 1; }; preflight; deploy_full ;;` / `web) deploy_web ;;` / `api) if [[ $ROLLBACK == 1 ]]; then echo "=== 快回滚：跳过 preflight/verify/int（事故路径——runbook §5） ==="; deploy_api; else preflight; deploy_api; fi ;;`（v4.1/B3：dispatch 层短路+full 模式显式拒——deploy_api 函数体内早退形态下 preflight 已先跑完=30s 承诺落空，deploy.sh:100-108 实证；check-ecosystem 的 rollback 分派锚此刻即绿）。

- [ ] **Step 5: 夹具绿+真文件红态确认（Node 探针——跨平台；verify 接入移 T8 末步，本任务不挂链）**

```bash
node scripts/check-ecosystem.test.mjs   # node:test 直跑（v4 十二测全绿——含提取器自测〔${#var}/行尾注释含{}两新档〕/调用图/零构建 ssh 作用域/rollback 分派）
node scripts/check-ecosystem.mjs        # 对真文件：T8 完成前预期红（v4.2 红清单修正——评五小项+v4 原清单三处失准：①上传面 -C scripts ./ 与 -C apps/api/scripts ./ 两缺〔原脚本无 scripts tar——T8 deploy_api 重写才补〕②零构建锚〔deploy_full 旧本体 :48-55 服务器三次构建——T8 重构才消灭〕③调用图 deploy_full 档〔旧本体顺序执行不调 deploy_web/deploy_api 函数——T8 三行顺次才满足〕；restart 块已被 T5 替换⇒kill-timeout 锚不红；分派层 T5 已改⇒rollback 锚绿）——执行序声明的原子序列红态，非缺陷
```

- [ ] **Step 7: Commit**

```bash
git add ecosystem.config.cjs scripts/check-ecosystem.mjs scripts/check-ecosystem.test.mjs deploy.sh
git commit -m "feat(collab): Y0a-4 ecosystem 入库=进程定义唯一源——check-ecosystem v4（extractBashFunction 配平提取器+调用图断言+ssh 作用域零构建锚+rollback 分派锚+env 白名单去 GIT_COMMIT_HASH 死条目改 cutover 行为锚）+node:test 十一夹具+deploy.sh cutover_api 改名单源化"
```

---

## Task 6: collab-smoke.mjs 双客户端冒烟（P21 全量+P33/K 减法）

**Files:**
- Create: `apps/api/scripts/collab-smoke.mjs`（**node 直跑零 tsx**；**留 apps/api/scripts/ 不移 root scripts/**——P33 裁定：root scripts/ 解析不到 provider/prisma/yjs 包依赖〔B15 实证〕，移过去启动即 MODULE_NOT_FOUND；上传面 T8 补 `apps/api/scripts/` 目录并锚化。本目录下 dotenv/provider 均可解析〔apps/api/node_modules〕）
- Modify: `apps/api/package.json`（**`@hocuspocus/provider` devDependencies→dependencies**——B17：冒烟=部署验证链一等工件，禁建立在"服务器 install 不裁 devDeps"未验证假设）
- ~~canvas-doc-update.repository.ts +countUpdates~~（**v3 删除**——K 减法：readSnapshotOnly 轮询重放使等待条件与断言条件合一，契约 1"两出口"不添第三出口）

- [ ] **Step 1: provider 提升 dependencies（B17 根修）**

```bash
cd apps/api && pnpm add @hocuspocus/provider@4.6.0
```

（核对 package.json：dependencies 区出现该键、devDependencies 区无残留——`grep -n 'provider' package.json`。零运行时影响：src 不 import provider，仅 install 集变化。）

- [ ] **Step 2: collab-smoke.mjs（v2 全量——dotenv 自加载/dist 导入/双客户端/ready 前置/清理告警）**

```js
// apps/api/scripts/collab-smoke.mjs —— Y0a-4 post-deploy 冒烟（spec §4.4 三步+P21 强化）
// 运行（服务器）：cd ~/flowweb && pnpm --filter @flowweb/api exec node scripts/collab-smoke.mjs
// 运行（本地）  ：同命令（先 pnpm verify 保证 dist 新鲜——本脚本验的是部署产物 dist，不是 src）
// 形态：node 直跑（零 tsx 依赖）+dotenv 自加载（B3′：tsx/PrismaClient 运行时不读 .env）+dist 导入（验产物）
//      +双客户端（A/B 互写 marker 断言互见=协作广播链首次上真机）+ready 前置断言（只读降级不误诊为落库失败）
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });   // apps/api/.env——main.ts:3 同序同 path；不覆盖已设 env（B12；v4 语法修正：去多余 resolve/尾逗号）
const here = fileURLToPath(import.meta.url);
const req = createRequire(here);
const { PrismaClient } = req('@prisma/client');
const { HocuspocusProvider } = await import('@hocuspocus/provider');
const Y = await import('yjs');
const { CanvasDocUpdateRepository } = req('../dist/modules/collab/canvas-doc-update.repository.js');   // dist=部署产物（P21）

const WS_URL = process.env.COLLAB_WS_URL ?? 'ws://127.0.0.1:3001';
const API = process.env.COLLAB_API_URL ?? 'http://127.0.0.1:3000';
const MARKERS = ['smoke-marker-a', 'smoke-marker-b'];
const ts = Date.now();
const S = { user: `smoke-u-${ts}`, team: `smoke-t-${ts}`, member: `smoke-m-${ts}`, project: `smoke-p-${ts}`, token: `smoke-tok-${randomUUID()}` };

async function step0_readyAssert() {
  const r = await fetch(`${API}/api/ready`).then((x) => x.json()).catch(() => null);
  if (!r?.ready) throw new Error(`前置断言失败：/api/ready ready=${r?.ready} reason=${r?.reason}——spool 只读降级/未服务态下 provider 写入会被拒，先查 ready 再冒烟（禁误诊为"未落库"）`);
}

async function main() {
  await step0_readyAssert();
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma);
  const warnings = [];
  let inserted = false;
  try {
    await prisma.user.create({ data: { id: S.user, name: `smoke-${ts}`, email: `smoke-${ts}@example.invalid`, emailVerified: false } });
    await prisma.team.create({ data: { id: S.team, name: `smoke-${ts}`, ownerId: S.user } });
    await prisma.teamMember.create({ data: { id: S.member, teamId: S.team, userId: S.user, role: 'MEMBER' } });
    await prisma.canvasProject.create({ data: { id: S.project, name: `smoke-${ts}`, teamId: S.team } });
    await prisma.session.create({ data: { id: `smoke-s-${ts}`, userId: S.user, token: S.token, expiresAt: new Date(Date.now() + 10 * 60_000) } });
    inserted = true;

    const mk = (name) => new HocuspocusProvider({ url: `${WS_URL}?token=${S.token}`, name: `project:${S.project}`, document: new Y.Doc() });
    const A = mk('a'), B = mk('b');
    const synced = (p) => new Promise((res, rej) => { p.on('synced', () => res()); setTimeout(() => rej(new Error('provider synced 超时 10s——3001 未监听/鉴权拒/装载失败')), 10_000); });
    try {
      await Promise.all([synced(A), synced(B)]);
      A.document.transact(() => A.document.getMap('nodes').set(MARKERS[0], new Y.Map([['kind', 'smoke']])));
      B.document.transact(() => B.document.getMap('nodes').set(MARKERS[1], new Y.Map([['kind', 'smoke']])));
      // 双客户端断言①：广播链——A 侧收敛出 B 的 marker（10s）
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('广播链断：A 10s 未见 marker-b（doc 装载/广播异常——单客户端冒烟测不出的面）')), 10_000);
        const check = () => { if (A.document.getMap('nodes').has(MARKERS[1])) { clearTimeout(t); res(); } };
        A.document.on('update', check); check();
      });
      // 等 store 落 PG（v3/K 减法：readSnapshotOnly 轮询重放——等待条件与断言条件合一，禁 countUpdates 第二口径）
      let replayOk = false, lastInfo = { updates: -1 };
      for (let i = 0; i < 8 && !replayOk; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const { state, updates } = await repo.readSnapshotOnly(S.project);
        lastInfo = { updates: updates.length };
        const probe = new Y.Doc();
        if (state) Y.applyUpdate(probe, new Uint8Array(state));
        for (const u of updates) Y.applyUpdate(probe, new Uint8Array(u));
        if (MARKERS.every((m) => probe.getMap('nodes').has(m))) replayOk = true;
      }
      if (!replayOk) throw new Error(`marker 批未落 PG（readSnapshotOnly 重放 8 轮未收敛，last=${JSON.stringify(lastInfo)}）——store 链路异常`);
    } finally {
      for (const p of [A, B]) { try { p.destroy(); } catch (e) { warnings.push(`provider destroy 异常: ${e.message}`); } }   // B4：同步 void 调用
    }

    console.log(JSON.stringify({ smoke: 'OK', project: S.project, ...lastInfo, chain: 'WS→auth→load→双端写→广播互见→store→PG→重放' }));
  } finally {
    // 清哨兵（B6 依赖序；失败=WARN+残留 id——禁静默，P21）
    if (inserted) {
      const order = [
        () => prisma.session.deleteMany({ where: { userId: S.user } }),
        () => prisma.teamMember.deleteMany({ where: { id: S.member } }),
        () => prisma.canvasProject.deleteMany({ where: { id: S.project } }),   // Cascade 清 CanvasDoc/Update
        () => prisma.team.deleteMany({ where: { id: S.team } }),
        () => prisma.user.deleteMany({ where: { id: S.user } }),
      ];
      for (const del of order) await del().catch((e) => warnings.push(`哨兵清理失败（残留待人工删）: ${e.message}`));
      const left = await prisma.canvasProject.count({ where: { id: S.project } }).catch(() => -1);
      if (left === 1) warnings.push(`哨兵项目残留：${S.project}（人工删除：psql → DELETE FROM "CanvasProject" WHERE id='${S.project}'）`);
    }
    for (const w of warnings) console.error(`SMOKE-WARN: ${w}`);
    await prisma.$disconnect();
  }
}

void main().catch((e) => { console.error(`smoke FAIL: ${e instanceof Error ? e.message : e}`); process.exitCode = 1; });
```

（执行时校准：Session/TeamMember 字段名以 schema 实态为准〔基线表已列必填集〕；`new URL('../.env', import.meta.url)` 从 scripts/ 指向 apps/api/.env——路径即 main.ts 同序。）

- [ ] **Step 3: 本地实测（全链路+红相）**

```bash
pnpm verify   # 保证 dist 新鲜（脚本验 dist）
# 终端 A：pnpm --filter @flowweb/api dev
pnpm --filter @flowweb/api exec node scripts/collab-smoke.mjs          # 绿：smoke OK JSON
COLLAB_WS_URL=ws://127.0.0.1:3999 pnpm --filter @flowweb/api exec node scripts/collab-smoke.mjs ; echo exit=$?   # 红相①：未监听档非零
```

- [ ] **Step 4: 哨兵清理核验（Node 化——F10）**

```bash
node -e "const {PrismaClient}=require('./apps/api/node_modules/@prisma/client');const p=new PrismaClient();(async()=>{const a=await p.canvasProject.count({where:{id:{contains:'smoke-'}}});const b=await p.canvasDocUpdate.count({where:{projectId:{contains:'smoke-'}}});console.log({projects:a,updates:b});await p.\$disconnect()})()" --experimental-require-module 2>/dev/null || cd apps/api && npx tsx -e "import {PrismaClient} from '@prisma/client'; const p=new PrismaClient(); const a=await p.canvasProject.count({where:{id:{contains:'smoke-'}}}); const b=await p.canvasDocUpdate.count({where:{projectId:{contains:'smoke-'}}}); console.log({projects:a,updates:b}); await p.\$disconnect();"
```

预期 `{projects:0,updates:0}`（Cascade 实证）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/scripts/collab-smoke.mjs apps/api/package.json pnpm-lock.yaml
git commit -m "feat(collab): Y0a-4 冒烟 v3——node 直跑 dist 导入+dotenv 自加载+双客户端互见断言+ready 前置+readSnapshotOnly 轮询重放合一（删 countUpdates——K 减法）+provider 升 dependencies（B17）；红相=未监听档"
```

---

## Task 7: deploy-guard 判据载体（lib 纯函数+薄 CLI+零依赖 env 读取）

**Files:**
- Create: `scripts/lib/gate-decision.mjs`（纯判据函数——零 IO 零副作用，node:test 唯一消费）
- Create: `scripts/lib/env-file.mjs`（**v4/P45：readEnvFile 单源**——撤"三处内联 Y0.5 抽"注记，本批防双源纪律优先；deploy-guard/deploy-preflight-int 共用）
- Create: `scripts/env-file.test.mjs`（node:test——**dotenv 对拍测试**：`createRequire(apps/api/package.json)('dotenv').parse` vs readEnvFile 逐键比对）
- Create: `scripts/deploy-guard.mjs`（薄 CLI：isMain 守卫+env-file lib+HTTP/状态文件 IO）
- Create: `scripts/deploy-guard.test.mjs`（node:test——**唯一自测入口，--self-test 内嵌夹具已删除**防双源）

- [ ] **Step 0: scripts/lib/env-file.mjs（零依赖单键提取——P29/P45 单源）**

```js
// scripts/lib/env-file.mjs —— 零依赖 .env 单键提取（B15：root scripts/ 解析不到 dotenv——部署门必须在
// node_modules 半损坏时仍可运行）。单源消费=deploy-guard/deploy-preflight-int（P45：禁内联复制）。
// 语义与 dotenv 17 LINE 正则对齐（B27 实测）：export 前缀✓/重复键后者胜✓/CRLF✓；
// 行内注释三形态——未引号值首个 # 截断（无空格也截）/引号外注释丢弃/引号内 # 保留；
// 引号值取首个闭引号内内容（dq/sq/backtick 同 dotenv 分支）。多行 PEM 天然跳过（只认单行 KEY=VALUE）。
// 已设 process.env 优先由调用方展开（{...readEnvFile(...), ...process.env}——B12 不覆盖语义）。
// v4.2/评五 P0-1：v4 实现 `(.*)$` 全收+两端引号配对判断=对拍首跑必红（探针门第一跑暴露）——本版按 B27 实测语义重写。
import { readFileSync } from 'node:fs';

export function readEnvFile(path, keys) {
  const out = {};
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return out; }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || !keys.includes(m[1])) continue;
    const t = m[2].trim();
    let v;
    if (t.startsWith('"') || t.startsWith("'") || t.startsWith('`')) {
      const q = t[0];
      const end = t.indexOf(q, 1);
      v = end > 0 ? t.slice(1, end) : t.slice(1);   // 引号分支：取首个闭引号内内容（引号外注释丢弃/引号内 # 保留）
    } else {
      const h = t.indexOf('#');
      v = (h >= 0 ? t.slice(0, h) : t).trim();      // 未引号分支：dotenv 的 [^#\r\n]+ 语义——首个 # 起注释（无空格也截）
    }
    out[m[1]] = v;
  }
  return out;
}
```

对拍测试（`scripts/env-file.test.mjs`——评四 P1-1：解析差异比失效更贵，误诊"TOKEN 未设置"的根因防线）：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readEnvFile } from './lib/env-file.mjs';

const here = fileURLToPath(import.meta.url);
const dotenv = createRequire(join(here, '../apps/api/package.json'))('dotenv');

const KEYS = ['A_PLAIN', 'B_DQ', 'B2_DQ_CMT', 'C_SQ', 'D_DUP', 'E_EXPORT', 'F_HASH', 'G_NOHASHSPACE', 'H_DQ_HASH', 'I_SQ_HASH', 'PRIVATE_KEY'];

function parseBoth(text) {
  const dir = mkdtempSync(join(tmpdir(), 'envfile-'));
  const f = join(dir, '.env');
  writeFileSync(f, text);
  try { return { ours: readEnvFile(f, KEYS), dotenv: dotenv.parse(text) }; } finally { rmSync(dir, { recursive: true, force: true }); }
}

// v4.2/评五 P0-1：九形态（B27 实测语义）——v4 六形态夹具的 F_HASH 档在 v4 实现下首跑必红=探针门第一跑暴露；
// 对拍基准值来自本方 dotenv parse 实测输出（粘 §0.6 readEnvFile 行）：F_HASH→'before'、G→'a'、H→'a #b'、I→'x # y'、D_DUP→'second'
test('dotenv 对拍九形态：plain/dq/引号+注释/sq/重复键后者胜/export/行内注释三形态（v4.2/P45/B27）', () => {
  const text = [
    'A_PLAIN=novalue',
    'B_DQ="quoted value"',          // 本仓 DATABASE_URL 实测形态
    'B2_DQ_CMT="q" # trailing',     // 引号外注释丢弃
    "C_SQ='sq value'",
    'D_DUP=first',
    'D_DUP=second',
    'export E_EXPORT=yes',
    'F_HASH=before # not-a-comment-for-dotenv',   // 引号外注释（有空格）截断
    'G_NOHASHSPACE=a#b',                          // 无空格 # 也截（dotenv [^#\r\n]+ 语义）
    'H_DQ_HASH="a #b"',                           // 引号内 # 保留
    "I_SQ_HASH='x # y'",                          // 单引号内 # 保留
  ].join('\n');
  const { ours, dotenv: dp } = parseBoth(text);
  for (const k of KEYS) {
    if (k === 'PRIVATE_KEY') continue;
    assert.equal(ours[k], dp[k], `${k}: ours=${JSON.stringify(ours[k])} dotenv=${JSON.stringify(dp[k])}`);
  }
  // 锚死三组关键值（对拍对象本身坏掉时仍有独立红相）
  assert.equal(ours.F_HASH, 'before');
  assert.equal(ours.G_NOHASHSPACE, 'a');
  assert.equal(ours.H_DQ_HASH, 'a #b');
});
test('多行 PEM（v4.2/评五 P1-9 去空转：keys 含 PRIVATE_KEY——对拍 dotenv 同款怪值+不误吞下一行）', () => {
  const { ours, dotenv: dp } = parseBoth('PRIVATE_KEY="-----BEGIN-----\nMIIB\n-----END-----"');
  assert.equal(ours.PRIVATE_KEY, dp.PRIVATE_KEY);   // dotenv 对未闭合引号回落 [^#\r\n]+ 分支=取 `"-----BEGIN-----` 原样——逐值对齐而非恒真 undefined
  assert.equal(ours.MIIB, undefined);               // 不误吞下一行（中间行非 KEY=VALUE）
  assert.deepEqual(Object.keys(ours).filter((k) => ours[k] !== undefined && k !== 'PRIVATE_KEY'), []);   // 无其他键被误产
});
test('真实 apps/api/.env 对拍（存在即逐键相等——本地开发机必有，CI 无则跳过）', () => {
  const p = join(here, '../apps/api/.env');
  if (!existsSync(p)) return;
  const parsed = dotenv.parse(readFileSync(p, 'utf8'));
  const keys = Object.keys(parsed);
  const ours = readEnvFile(p, keys);
  for (const k of keys) assert.equal(ours[k], parsed[k], k);
});
```

- [ ] **Step 1: scripts/lib/gate-decision.mjs（纯函数层——P29/P30/P39/P40）**

```js
// scripts/lib/gate-decision.mjs —— deploy-guard 纯判据函数（零 IO 零 import 副作用；node:test 唯一消费）
// verdict 四值：pass | wait | fail（有账可算——--force 可覆盖并打印 at-risk）| unobservable（无账可算——force 不可覆盖）
// v4/P39/P40：decidePost 增 degraded 参（pre 显式降级→epoch 断言 N/A 显式打印不 fail）；
// epochPreFromRaw 堵 JSON NaN→null→0 往返（B23）；删 preBudgetMs——固定预算+drain 循环续期取代自适应（少一个首采样盲区机制）。
export const PRE_BUDGET_MS = 90_000;   // P40 固定：循环 pass/fail 即 break——固定与自适应在成功路径等价

export function epochPreFromRaw(raw) {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : NaN;   // 'unavailable'/null/undefined/损坏 → NaN → decidePost fail（B23：Number(null)=0 恒过 isFinite 的陷阱）
}

export function spoolTotal(pending) {
  return (pending?.spoolFiles ?? 0) + (pending?.strandedFiles ?? 0);   // P35 total 口径（+5 判据=pre/post JSON 两行）
}

export function decidePre(body) {
  if (body.pending === undefined) return { verdict: 'unobservable', why: `ready 未返回 pending（token 无效/未配置）——响应键=${Object.keys(body).join(',')}。这是可观测性缺失不是"未排空"（P0-1 分型）；--force 不覆盖此档` };
  if (body.reason === 'spool-unwritable') return { verdict: 'fail', why: 'spool-unwritable——批 无法入账 drain 必然超时，人工介入（建议先跑 collab-spool-quarantine/import）' };
  if (body.reason !== 'draining') return { verdict: 'wait', why: `reason=${body.reason}（drain 未生效——若刚过 60s 见续期重 POST〔P40〕；旧版本无端点见 --allow-legacy）` };
  const p = body.pending;
  const zero = p.projects === 0 && p.batches === 0 && p.spoolFiles === 0 && p.spoolBytes === 0;   // spec §4.4 own 四零（维持 SV11）
  if (zero) return { verdict: 'pass', why: `own 四零（内存队列+spool 台账均清——SIGKILL 无可丢项）${(p.strandedFiles ?? 0) > 0 ? `；WARNING stranded=${p.strandedFiles}files 外来段（boot 收养消化）` : ''}` };
  return { verdict: 'wait', why: `未排空 projects=${p.projects} batches=${p.batches} spoolFiles=${p.spoolFiles}（帧明细运维判断）spoolBytes=${p.spoolBytes}` };
}

export function decidePost(body, epochPre, degraded = null) {
  if (!degraded && !Number.isFinite(epochPre)) return { verdict: 'fail', why: `epoch 基线不可用（${epochPre}）——接管断言无意义，禁静默通过（P31/P39：NaN/'unavailable'/null 往返→0 全 fail；显式降级档经 degraded 参数放行并打印 N/A）` };
  if (!body.ready) return { verdict: 'wait', why: `未就绪 reason=${body.reason}` };
  if (body.pending === undefined) return { verdict: 'unobservable', why: 'post 段同样需要授权档视图（token）' };
  const { spoolFiles = 0, strandedFiles = 0 } = body.pending;
  if (spoolFiles > 0) return { verdict: 'wait', why: `own spool 回灌中（spoolFiles=${spoolFiles}——boot 回灌完成前不算部署完成）` };
  if (!degraded && Number(body.epoch) <= epochPre) return { verdict: 'fail', why: `epoch 未递增（pre=${epochPre} post=${body.epoch}）——新实例未接管租约，疑双实例/僵尸实例` };
  const base = degraded
    ? `ready+own spool 归零；epoch 断言 N/A（pre 段降级放行：${degraded}——接管证明由下一次非降级部署产出，本次记入部署记录）`
    : `ready+own spool 归零+epoch 递增（新实例已接管）`;
  return { verdict: 'pass', why: `${base}${strandedFiles > 0 ? `；WARNING stranded=${strandedFiles}files 收养窗异步消化（60s+30s，不阻部署判据）` : ''}` };
}
```

- [ ] **Step 2: scripts/deploy-guard.mjs（薄 CLI——isMain 守卫+env-file lib+状态文件生命周期 v2）**

```js
// scripts/deploy-guard.mjs —— Y0a-4 部署拒重启三步（spec §4.4）+post-restart 段（P15）
// 服务器运行：node scripts/deploy-guard.mjs [--post-restart] [--force] [--allow-legacy] [--api-url URL]
// v4 结构：纯判据在 scripts/lib/gate-decision.mjs（import 零副作用——isMain 守卫，B16）；
//         env 零依赖自读在 scripts/lib/env-file.mjs（B15+P45 单源）；
//         状态文件生命周期 v2（P39）：pre 所有退出路径写 state（含 degraded 标记）——run#1 --allow-legacy
//         与 --force 跨不可达档的 post 段不再误红；post 不删 state 改 SHA 断言（--rollback 同 SHA 复用基线）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decidePre, decidePost, epochPreFromRaw, spoolTotal, PRE_BUDGET_MS } from './lib/gate-decision.mjs';
import { readEnvFile } from './lib/env-file.mjs';

const here = fileURLToPath(import.meta.url);
const ROOT = resolve(here, '../..');
const STATE = resolve(ROOT, '.deploy-guard-state.json');   // gitignored

const argv = process.argv.slice(2);
const KNOWN = ['--post-restart', '--force', '--allow-legacy', '--api-url'];
const unknownArg = argv.find((a) => a.startsWith('--') && !KNOWN.includes(a));
if (unknownArg) { console.error(`deploy-guard FAIL: 未知参数 ${unknownArg}（部署门禁禁静默忽略——评四 T7 行）`); process.exit(1); }
const has = (k) => argv.includes(k);
const val = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const POST = has('--post-restart'), FORCE = has('--force'), ALLOW_LEGACY = has('--allow-legacy');
const API = val('--api-url', 'http://127.0.0.1:3000');
const TOKEN = process.env.COLLAB_ADMIN_TOKEN ?? readEnvFile(resolve(ROOT, 'apps/api/.env'), ['COLLAB_ADMIN_TOKEN']).COLLAB_ADMIN_TOKEN;
const H = { 'x-prometheus-token': TOKEN };
const t0 = Date.now();

async function getReady() { const r = await fetch(`${API}/api/ready`, { headers: H }); return { status: r.status, body: await r.json().catch(() => null) }; }
async function postDrain() { try { return await fetch(`${API}/api/drain`, { method: 'POST', headers: H }); } catch (e) { e.unreachable = true; return e; } }
function requireToken(phase) {
  if (!TOKEN) { console.error(`deploy-guard FAIL(${phase}): COLLAB_ADMIN_TOKEN 未设置（读 apps/api/.env——W23 独立停机令牌；runbook §1 先建令牌）`); process.exit(1); }
}

/** P39 单一写口：所有 pre 退出路径经此——degraded ∈ null|'legacy'|'unreachable'；epochPre ∈ number|'unavailable'（禁 null——B23 JSON NaN 往返成 0） */
function writeState({ degraded = null, epochRaw = 'unavailable', drainAt = null, pendingBefore = null }) {
  writeFileSync(STATE, JSON.stringify({ v: 1, sha: process.env.GIT_SHA ?? null, startedAt: Date.now(), drainAt, degraded, epochPre: epochRaw, pendingBefore }));
}

async function prePhase() {
  requireToken('pre');
  if (existsSync(STATE)) {
    try { const prev = JSON.parse(readFileSync(STATE, 'utf8')); console.log(`deploy-guard: 覆盖上一轮状态（sha=${prev.sha} age=${Math.round((Date.now() - prev.startedAt) / 1000)}s）——pre 每次覆写，post 按 SHA 断言防串档（P39）`); } catch { /* 损坏→直接覆写 */ }
  }
  const drainResp = await postDrain();
  if (drainResp.unreachable) {
    writeState({ degraded: 'unreachable' });   // P39：降级档也写 state——post 段 N/A 而非误红
    if (!FORCE) { console.error(`deploy-guard FAIL: drain 不可达（${drainResp.message}）——API 未起？确认实例状态；确认无在途写入后 --force-restart 可越过（本次无停写保护）`); process.exit(1); }
    console.log(`deploy-guard WARNING(--force): drain 不可达（${drainResp.message}）——目标无在途可查，按"无写入"处置继续（本次部署无停写保护+post 段 epoch 断言 N/A；runbook §3 要求留部署记录）`);
    process.exit(0);
  }
  if (drainResp.status === 404) {
    writeState({ degraded: 'legacy' });   // P39：run#1 装能力档——post 段 N/A
    if (!ALLOW_LEGACY) { console.error('deploy-guard FAIL: /api/drain 404——目标实例版本过旧（pre-Y0a-3）？确认后 --allow-legacy 显式跳过（默认拒：404 也可能是反代/路径配错，禁无鉴别绕过）'); process.exit(1); }
    console.log('deploy-guard: --allow-legacy——旧版本跳过停写直接放行（非判据证据；post 段 epoch 断言 N/A——接管证明由 run#2 产出）'); process.exit(0);
  }
  if (drainResp.status === 401 || drainResp.status === 403) {
    // J2：凭据无效=unobservable——--force 不覆盖（无账可算的放行=at-risk 语义谎言）；中止档不写 state（pre 下次覆写+SHA 断言双防线）
    console.error(`deploy-guard FAIL: drain ${drainResp.status}——令牌失配（unobservable 档，--force 不覆盖）。核对服务器 apps/api/.env 的 COLLAB_ADMIN_TOKEN 与本脚本读取路径一致`); process.exit(1);
  }
  if (!drainResp.ok) { console.error(`deploy-guard FAIL: drain 响应 ${drainResp.status}`); process.exit(1); }
  const drainAt = Date.now();
  const first = await getReady().catch(() => null);
  let epochRaw = first?.body?.epoch != null && Number.isFinite(Number(first.body.epoch)) ? Number(first.body.epoch) : 'unavailable';
  writeState({ epochRaw, drainAt, pendingBefore: first?.body?.pending ?? null });   // P39：轮询前先落基线
  const deadline = drainAt + PRE_BUDGET_MS;   // P40 固定 90s（≥退避梯 60s 封顶+余量）
  let last = null, verdict = { verdict: 'wait', why: '未采样' }, lastRenew = Date.now(), observed = false;
  while (Date.now() < deadline) {
    if (Date.now() - lastRenew > 20_000) {   // P40：drain 60s TTL 循环续期（SV9 幂等）——预算与 TTL 解耦，防"跨 TTL 后 reason≠draining 恒 wait 逼 force 日常化"
      const r = await postDrain();
      // v4.2/P49④：续期查 r.ok——401/403/500〔令牌轮换/实例半死〕不计已续期（否则 60s 后自动解除⇒预算耗尽误报"drain 未生效"=把权限问题误诊成排空问题）
      if (!r.unreachable && r.ok) lastRenew = Date.now();
      else if (!r.unreachable) console.error(`deploy-guard WARNING: drain 续期被拒 ${r.status}（60s 后自动解除——核对令牌/实例状态）`);
      // unreachable（进程已死）→ 保持轮询，decidePre 按 reason 分型处置
    }
    last = await getReady().catch(() => last);
    if (last?.body) { observed = true; verdict = decidePre(last.body); if (verdict.verdict !== 'wait') break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  // v4.2/评五 C5 基线收口：首采样抖动（drain 200 后那一次 getReady 失败）会把 'unavailable' 落盘，轮询正常 pre pass
  // 而 post 段对 'unavailable'+degraded=null 必 fail ⇒ trap 误导回滚刚上线的正确构建——P39 要消灭的形态换分支复发；
  // 放行路径（pass/force）以最后一次有效采样收口基线（wait/fail 中止路径无需——下次部署 pre 会覆写）
  const settleEpoch = () => {
    if (Number.isFinite(Number(last?.body?.epoch))) {
      epochRaw = Number(last.body.epoch);
      writeState({ epochRaw, drainAt, pendingBefore: first?.body?.pending ?? null });
    }
  };
  // v4.1/B7：全程未取得 body=无账可算——unobservable（--force 不覆盖：与"排空未完成"分开报，P30 语义谎言禁复）
  if (!observed) verdict = { verdict: 'unobservable', why: '/api/ready 全程不可达（drain 已 200——反代/路径配错/实例 drain 中崩溃？）——无账可查，核对 127.0.0.1:3000 直连与实例存活；逃生阀=修 ready 可观测性（--force 不覆盖此档）' };
  console.log(JSON.stringify({ phase: 'pre', verdict: verdict.verdict, why: verdict.why, drainAt, budgetMs: PRE_BUDGET_MS, elapsedMs: Date.now() - t0, epochPre: epochRaw, totalPre: spoolTotal(first?.body?.pending), pendingBefore: first?.body?.pending ?? null, pendingAfter: last?.body?.pending ?? null }));
  if (verdict.verdict === 'pass') { settleEpoch(); process.exit(0); }   // v4.2/C5：放行点收口基线
  if (verdict.verdict !== 'unobservable' && FORCE) { console.log(`deploy-guard WARNING(--force): ${verdict.why}——强制放行，N batches at risk（真实逃生阀非日常；runbook §3 要求留部署记录）`); settleEpoch(); process.exit(0); }
  console.error(`deploy-guard FAIL: ${verdict.why}——中止部署（逃生阀 --force-restart 覆盖 fail/wait 两档〔wait=预算耗尽未排空=典型 at-risk〕；unobservable 不可 force；中止后 drain 将于 60s 自动解除〔SV12〕可安全重试）`);
  process.exit(1);
}

async function postPhase() {
  requireToken('post');
  let st = null;
  try { st = JSON.parse(readFileSync(STATE, 'utf8')); } catch { st = null; }
  if (!st || st.v !== 1) { console.error('deploy-guard FAIL(post): 状态文件缺失/损坏/版本不符（pre 段未跑？重跑完整部署链；--rollback 需上次部署的 state 仍在——P39 不再删除）'); process.exit(1); }
  // v4.2/评五报告二 P0-3 三态显式断言（v4 的 `st.sha && … && …` 双假短路=SHA 红相探针不可能红——探针门"坏夹具必非零"拿不到）
  if (!st.sha) { console.error('deploy-guard FAIL(post): state 无 sha（本地演练请带 GIT_SHA=… 跑 pre；生产路径缺失=SHA 断言失效）'); process.exit(1); }
  if (!process.env.GIT_SHA) { console.error('deploy-guard FAIL(post): 未传 GIT_SHA——无法执行串档断言（cutover ①/rollback ⑤ 均注入）'); process.exit(1); }
  if (st.sha !== process.env.GIT_SHA) {
    console.error(`deploy-guard FAIL(post): 陈旧状态文件（state.sha=${st.sha} ≠ GIT_SHA=${process.env.GIT_SHA}）——pre 每次覆写+本断言=防跨部署串档（P39）；重跑完整部署链`); process.exit(1);
  }
  const epochPre = epochPreFromRaw(st.epochPre);   // 'unavailable'/null/损坏 → NaN → decidePost fail（B23：Number(null)=0 陷阱禁复）
  const degraded = st.degraded ?? null;
  const deadline = Date.now() + 120_000;   // O-1：收养 60s+reconciler 30s+回灌余量
  let last = null, verdict = { verdict: 'wait', why: '未采样' };
  while (Date.now() < deadline) {
    last = await getReady().catch(() => last);
    if (last?.body) { verdict = decidePost(last.body, epochPre, degraded); if (verdict.verdict !== 'wait') break; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  // P39：不删状态文件——pre 覆写+SHA 断言防串档；--rollback（同 SHA 重启）复用本基线做 epoch 断言
  console.log(JSON.stringify({ phase: 'post', verdict: verdict.verdict, why: verdict.why, degraded, epochPre: st.epochPre, epochPost: last?.body?.epoch ?? null, totalPost: spoolTotal(last?.body?.pending), elapsedMs: Date.now() - t0 }));
  if (verdict.verdict === 'pass') process.exit(0);
  console.error(`deploy-guard FAIL(post): ${verdict.why}——重启后未收敛，按 runbook §3 处置`);
  process.exit(1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await (POST ? postPhase() : prePhase());
```

（.gitignore 追加 `.deploy-guard-state.json` 与 `.preflight-*.ok`——T8 收口。）

- [ ] **Step 3: deploy-guard.test.mjs（node:test 唯一自测入口——import lib 零副作用）**

```js
// scripts/deploy-guard.test.mjs —— 判据载体自测（A11；node --test scripts/ 消费）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePre, decidePost, epochPreFromRaw, spoolTotal } from './lib/gate-decision.mjs';

test('P0-1 回归：无 pending=unobservable 且 --force 不覆盖（v1 判 wait 恒超时/v2 判 fail 可 force——两类都错）', () => {
  const r = decidePre({ ready: false, reason: 'draining', epoch: '5' });
  assert.equal(r.verdict, 'unobservable'); assert.match(r.why, /pending/);
});
test('own 四零=pass（SV11 维持）；stranded 透出 WARNING 不拒', () => {
  const r = decidePre({ ready: false, reason: 'draining', pending: { projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0, strandedFiles: 3 } });
  assert.equal(r.verdict, 'pass'); assert.match(r.why, /stranded/);
});
test('spool-unwritable=fail（可 force）；drain 未生效=wait', () => {
  assert.equal(decidePre({ reason: 'spool-unwritable', pending: {} }).verdict, 'fail');
  assert.equal(decidePre({ reason: 'pg-down', pending: { projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0 } }).verdict, 'wait');
});
test('P31/P39/B23 回归：epoch 基线 NaN/缺失=null 往返=fail（禁恒真静默通过）——评四 P0-2 探针', () => {
  assert.equal(decidePost({ ready: true, epoch: '7', pending: { spoolFiles: 0 } }, NaN).verdict, 'fail');
  // 真实路径探针：state 写 {"epochPre":null}（JSON NaN 往返形态）→ epochPreFromRaw 必产 NaN → fail
  const roundTripped = JSON.parse(JSON.stringify({ epochPre: NaN }));
  assert.equal(epochPreFromRaw(roundTripped.epochPre), NaN);
  assert.equal(epochPreFromRaw('unavailable'), NaN);
  assert.equal(epochPreFromRaw(5), 5);   // 合法数值透传
});
test('epoch 未递增=fail；递增+归零=pass', () => {
  assert.equal(decidePost({ ready: true, epoch: '5', pending: {} }, 5).verdict, 'fail');
  const ok = decidePost({ ready: true, epoch: '7', pending: { spoolFiles: 0, strandedFiles: 2 } }, 5);
  assert.equal(ok.verdict, 'pass'); assert.match(ok.why, /stranded.*WARNING/);
});
test('P39 degraded 档：legacy/unreachable 放行→epoch 断言 N/A 显式打印（不 fail——run#1 post 段修复）', () => {
  const r = decidePost({ ready: true, epoch: '7', pending: { spoolFiles: 0 } }, NaN, 'legacy');
  assert.equal(r.verdict, 'pass'); assert.match(r.why, /N\/A.*legacy/s); assert.match(r.why, /下一次非降级部署/);
  assert.equal(decidePost({ ready: true, epoch: '7', pending: { spoolFiles: 0 } }, NaN, 'unreachable').verdict, 'pass');
});
test('post：own spool 未归零=wait（部署未完成）；无 pending=unobservable', () => {
  assert.equal(decidePost({ ready: true, epoch: '7', pending: { spoolFiles: 2 } }, 5).verdict, 'wait');
  assert.equal(decidePost({ ready: true, epoch: '7' }, 5).verdict, 'unobservable');
});
test('spoolTotal（P35：+5 判据 total 口径）', () => {
  assert.equal(spoolTotal({ spoolFiles: 3, strandedFiles: 2 }), 5);
  assert.equal(spoolTotal(undefined), 0);
});
```

- [ ] **Step 4: 本地实测（先补本地 token——本地 .env 27 键实证无 COLLAB_ADMIN_TOKEN）**

```bash
node --test scripts/deploy-guard.test.mjs scripts/env-file.test.mjs   # 两夹具套全绿（零基础设施——CI 同形态可跑；env-file 对拍九形态含真实 .env 档）
# 本地 .env 补临时令牌（本地开发值，不入库；【告知用户】）：
echo "COLLAB_ADMIN_TOKEN=local-drill-token" >> apps/api/.env
# 终端 A：pnpm --filter @flowweb/api dev（重启生效）
# 终端 B（v4.2/评五报告二 P0-3：pre 必带 GIT_SHA——三态断言下 state 无 sha=fail，v4 原演练"本地无 GIT_SHA 则跳过"的 SHA 红相不可能红）：
GIT_SHA=aaaaaaa node scripts/deploy-guard.mjs                       # 绿：pre pass JSON（epochPre 数值+totalPre+状态文件已写——轮询前落基线+sha=aaaaaaa）
GIT_SHA=aaaaaaa node scripts/deploy-guard.mjs --post-restart        # 绿：post pass（读状态文件：SHA 三态断言+epoch 递增+totalPost）
GIT_SHA=aaaaaaa node scripts/deploy-guard.mjs --api-url http://127.0.0.1:3999 ; echo exit=$?      # 红相①：不可达档非零（state 已写 degraded=unreachable）
GIT_SHA=aaaaaaa node scripts/deploy-guard.mjs --api-url http://127.0.0.1:3999 --force ; echo exit=$?   # 红相②：不可达+force=放行 exit 0（E 部署死锁修复）
GIT_SHA=aaaaaaa node scripts/deploy-guard.mjs --post-restart        # P39 探针：上一步 degraded=unreachable 的 state→post 对真实例 N/A pass（run#1 误红修复的本地形态）
GIT_SHA=deadbeef node scripts/deploy-guard.mjs --post-restart ; echo exit=$?                      # 红相③：SHA 不符=陈旧状态文件 fail（pre 带 aaaaaaa ⇒ st.sha 非空 ⇒ 此红真红）
node scripts/deploy-guard.mjs --force               # F3 回归：--force 不被 arg 解析吃掉
node scripts/deploy-guard.mjs --bogus-flag ; echo exit=$?                                        # 红相④：未知参数非零（禁静默忽略）
node scripts/deploy-guard.mjs --post-restart ; echo exit=$?            # 红相⑤（v4.2 新增）：无 GIT_SHA 环境=三态第二档 fail（"未传 GIT_SHA"）
```

（本地 drain 后 60s 自动解除〔SV12〕——实测轮次间隔 >60s 或重启 dev。）

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/gate-decision.mjs scripts/lib/env-file.mjs scripts/env-file.test.mjs scripts/deploy-guard.mjs scripts/deploy-guard.test.mjs
git commit -m "feat(collab): Y0a-4 deploy-guard v4.2——状态文件生命周期 v2（全退出路径写入+degraded 标记+epochPre 'unavailable' 哨兵堵 null 往返+post SHA 三态断言不删档）+pass/force 放行点基线收口（C5 首采样抖动根修）+drain 20s 循环续期（查 r.ok——P49④）+固定 90s 预算（删 preBudgetMs）+env-file lib 单源（B27 dotenv 行内注释三形态语义——九形态对拍含 G_NOHASHSPACE/H_DQ_HASH/PEM 去空转）（P39/P40/P45/P49/C5）"
```

---

## Task 8: deploy.sh 部署链契约化（本地构建+顺序+备份+trap+preflight 强化）

**Files:**
- Modify: `deploy.sh`（参数区三旗标循环/preflight/deploy_api/cutover_api/rollback_api/trap/deploy_full=provision 组合）
- Create: `scripts/deploy-preflight-int.mjs`（int 单源链——P32）、`scripts/check-migration-additive.mjs`（expand/contract 锚——P36①）
- Modify: `.github/workflows/ci.yml`（test job 加 `bash -n deploy.sh`）、`package.json`（verify 末步接入——**本任务收敛点**）、`.gitignore`（`.deploy-guard-state.json`+`.preflight-*.ok`）

- [ ] **Step 1: preflight 强化（P20+P32+P36③——SHA 收据+int 单源链+skip-preflight）**

```bash
preflight() {
  cd "$(dirname "$0")"
  local SHA; SHA=$(git rev-parse HEAD)
  # v4/评四 P1-2：git 两条断言移出收据分支（毫秒级幂等；产物来自工作树——同 SHA 脏树禁部署，收据只覆盖重跑昂贵的幂等步骤）
  echo "=== 发布前置：git 状态断言（P1-4：门禁在 PR 上、部署从工作树出=自相矛盾） ==="
  git diff --quiet && git diff --cached --quiet || { echo "工作树不干净——先 commit"; exit 1; }
  # v4.1/J10：fetch 失败降级 WARNING（离线开发机仍可部署）——ancestor 判定用本地 origin/master（可能陈旧；
  # 收据语义=同 SHA 幂等声明≠"该 SHA 仍最新"，runbook §3 注明）
  git fetch -q origin master || echo "WARNING: git fetch 失败——ancestor 判定用本地 origin/master（可能陈旧）"
  git merge-base --is-ancestor HEAD origin/master \
    || { echo "HEAD 未在 origin/master 上（未经 CI 的提交禁部署）"; exit 1; }

  if [[ -f ".preflight-${SHA}.ok" && "$SKIP_PREFLIGHT" != "1" ]]; then
    echo "=== 复用预检收据 .preflight-${SHA}.ok（同 SHA 幂等步骤〔verify/int/migrate/additive〕不重跑） ==="
  elif [[ "$SKIP_PREFLIGHT" == "1" ]]; then
    echo "=== --skip-preflight：本次部署不构成判据（强制声明，留部署记录） ==="
  else
    echo "=== 发布前置：pnpm verify（T8 末步起含 check-ecosystem+node --test scripts/） ==="
    pnpm verify

    echo "=== 发布前置：int 真库套件单源链（P32：test:int:ci+coverage 四判据——裸 test:int 在 DATABASE_URL 缺失时全 skip 退出码 0=假绿） ==="
    node scripts/deploy-preflight-int.mjs   # 零依赖读 .env 注入 DATABASE_URL → test:int:ci → check-int-coverage（禁 bash source——.env 特殊字符）
    echo "=== 提示：跑 int 前确认本地 dev API 已停（int 操作 CollabLease 单行——会把 dev 实例 fenced） ==="

    echo "=== 发布前置：本地 prisma migrate deploy（防御）+迁移 additive 检查（P36①/P45②：expand/contract 纪律门禁化+服务器侧双跑） ==="
    (cd apps/api && npx prisma migrate deploy)
    node scripts/check-migration-additive.mjs
    touch ".preflight-${SHA}.ok"   # 收据（gitignored）
  fi
  # gate-collab 不进收据（有状态——每次都跑；v4/评四 P1-3：单点执行，收据命中路径同跑——else 内不再重复）
  [[ "$SKIP_PREFLIGHT" == "1" ]] || node scripts/gate-collab.mjs
}
```

`scripts/deploy-preflight-int.mjs`（P32 新建——结构同 deploy-guard 的零依赖读取器）：

```js
// scripts/deploy-preflight-int.mjs —— preflight int 单源链（P32）：读 apps/api/.env 的 DATABASE_URL（去引号）
// → 注入子进程 env 跑 int 套件（产 int.json）→ check-int-coverage 四判据（集合≡执行集/零失败/零跳过/≥26）
// v4/P41：子进程禁 spawnSync('pnpm')（Windows ENOENT 实测——pnpm=.ps1/.cmd Node 不解析）——
// 直跑 vitest JS 入口：createRequire(apps/api/package.json).resolve('vitest/vitest.mjs')（实测存在；resolve 比 hardcode 稳），
// 参数等价 test:int:ci（package.json:11 的 -c vitest.int.config.ts+双 reporter+outputFile）。
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readEnvFile } from './lib/env-file.mjs';

const here = fileURLToPath(import.meta.url);
const ROOT = resolve(here, '../..');
const API_DIR = resolve(ROOT, 'apps/api');

const { DATABASE_URL } = { ...readEnvFile(resolve(API_DIR, '.env'), ['DATABASE_URL']), ...process.env };
if (!DATABASE_URL) { console.error('preflight-int FAIL: apps/api/.env 无 DATABASE_URL'); process.exit(1); }

const req = createRequire(resolve(API_DIR, 'package.json'));
let vitestEntry;
try { vitestEntry = req.resolve('vitest/vitest.mjs'); }
catch { console.error('preflight-int FAIL: 解析 vitest 入口失败（apps/api 未 install？先 pnpm install）'); process.exit(1); }

const r = spawnSync(process.execPath, [vitestEntry, 'run', '-c', 'vitest.int.config.ts',
  '--reporter=default', '--reporter=json', '--outputFile=int.json'],
  { stdio: 'inherit', env: { ...process.env, DATABASE_URL }, cwd: API_DIR });
// v4.1/J6：spawn 失败（ENOENT/EPERM）不抛异常而返回 {status:null,error}——三分法退出码：2=环境错误（防裸 exit 1 诱使 --skip-preflight 绕过唯一强制链，TD-26 形态）
if (r.error) { console.error(`preflight-int 环境错误（exit 2）：无法启动 vitest——${r.error.message}（先 pnpm install？）`); process.exit(2); }
if (r.status !== 0) { console.error(`preflight-int FAIL: int 套件退出 ${r.status}`); process.exit(r.status ?? 1); }

const c = spawnSync(process.execPath, [resolve(ROOT, 'scripts/check-int-coverage.mjs')], { stdio: 'inherit', cwd: ROOT });
process.exit(c.status ?? 1);
```

`scripts/check-migration-additive.mjs`（P36①——对 prisma/migrations 新增迁移文本断言**禁 DROP COLUMN/DROP TABLE**；对既有历史先跑一次定界/白名单，失败分支推演表 §0.6 末行）：

```js
// scripts/check-migration-additive.mjs —— expand/contract 纪律门禁（G/P36①/P45②）：drain 只冻结 collab 写路径，
// HTTP 面继续打库——"drain 后旧进程不再写新 schema"不成立，顺序安全性由迁移 additive 承担。
// 硬拦对"旧代码在跑"必炸的形态：DROP COLUMN/TABLE/CONSTRAINT、SET NOT NULL、RENAME、ALTER COLUMN TYPE
// （v4 扩列——评四 P1-7；v4.2/评五 P1-10②：**DROP INDEX 降 WARNING**——删索引不破坏旧代码在跑〔旧代码不按名引用索引〕，
// 却是 prisma 重建索引最常见良性破坏语句，硬拦会把门禁训练成"遇到就绕"）。
// v4/P45②：基线落文件内常量（禁 env 旋钮——门禁范围随环境变化=违"配置即契约"）；
// v4.2/评五 P0-3：**基线存在性断言**——`d > BASELINE` 是字符串比较，常量打错（拼写/版本偏大）⇒fresh 恒空⇒门禁永久豁免且输出仍 OK（静默失效唯一路径）。
// 豁免登记：基线前历史迁移不检（会命中正则者 **8 文件**——v4.2 本方全量重扫实测：20260827223714_team_contract_drop_node_tables/
// 20260828050603_project_member_user_cascade/20260829201000_personal_project_refactor/20260830010735_drop_user_level_ledger/
// 20260830183448_home_layout_content/20261002231506_spec_b_m0_drop_template_market/20261003001500_spec_b_m0_drop_template_columns/
// 20261006120655_y0a_integrity——v4.1 登记"6 文件"系本方上轮正则漏 DROP INDEX/RENAME/TYPE，认账更正；基线目录自身亦命中〔被 > 排除✓〕）。
// 双跑：preflight 本地 + cutover ③ 服务器 migrate 前（不可逆动作发生处才是门禁该在的地方）。
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const BASELINE = '20261007170319_lease_collab_audit';   // 此后新增迁移才受检（实测=当前最大迁移目录）
const MIG_DIR = join(ROOT, 'apps/api/prisma/migrations');
if (!existsSync(MIG_DIR)) { console.error('additive FAIL: migrations 目录缺失'); process.exit(1); }   // fail-closed
const dirs = readdirSync(MIG_DIR).filter((d) => /^\d+_/.test(d)).sort();
if (!dirs.includes(BASELINE)) { console.error(`additive FAIL: BASELINE 常量 "${BASELINE}" 不在迁移目录集合中（拼写错=永久豁免——评五 P0-3 根修）`); process.exit(1); }
const fresh = dirs.filter((d) => d > BASELINE);
const BREAKING = /\bDROP\s+(COLUMN|TABLE|CONSTRAINT)\b|\bSET\s+NOT\s+NULL\b|\bRENAME\s+(COLUMN|TO|TABLE)\b|\bALTER\s+COLUMN\b[^\n;]*\bTYPE\b/i;
const WARN_ONLY = /\bDROP\s+INDEX\b/i;
let bad = 0, warned = 0;
for (const d of fresh) {
  const sql = readFileSync(join(MIG_DIR, d, 'migration.sql'), 'utf8');
  const hit = BREAKING.exec(sql);
  if (hit) { console.error(`additive FAIL: ${d} 含破坏性变更（${hit[0]}）——drain 期间 HTTP 面旧代码在跑，破坏性变更=两步走（先加可空/带默认新形态、旧代码下线后再删旧）`); bad++; }
  else if (WARN_ONLY.test(sql)) { console.error(`additive WARNING: ${d} 含 DROP INDEX（旧代码不按名引用索引——性能非正确性影响，登记即可）`); warned++; }
}
if (fresh.length === 0) console.log('check-migration-additive: 尚无基线之后的新迁移——本跑无受检对象（非静默：有新迁移才可能红）');
console.log(bad ? `check-migration-additive: ${bad} 处违规` : `check-migration-additive OK（受检 ${fresh.length} 个迁移，WARNING ${warned}，基线=${BASELINE}）`);
process.exit(bad ? 1 : 0);
```

- [ ] **Step 2: deploy_api 重写+cutover_api 定稿（v4；v3：rmSync 清理/上传面补齐/lockfile 哈希/pg_dump 修正/epoch 状态文件/expand-contract 注释/rollback）**

参数区（三旗标循环解析——P36②/M：位置参数必漏）：

```bash
MODE="${1:-full}"
FORCE_RESTART=0; ALLOW_LEGACY=0; SKIP_SMOKE=0; SKIP_PREFLIGHT=0; ROLLBACK=0
for arg in "${@:2}"; do
  case "$arg" in
    --force-restart) FORCE_RESTART=1 ;;
    --allow-legacy) ALLOW_LEGACY=1 ;;
    --skip-smoke) SKIP_SMOKE=1 ;;
    --skip-preflight) SKIP_PREFLIGHT=1 ;;
    --rollback) ROLLBACK=1 ;;
    *) echo "未知旗标: $arg（部署脚本禁静默忽略）"; exit 1 ;;
  esac
done
GIT_SHA=$(git rev-parse --short HEAD)
```

deploy_api 主体：

```bash
deploy_api() {
  if [[ $ROLLBACK == 1 ]]; then rollback_api; return; fi
  echo "=== 磁盘水位前置（v4/评四 P1-11：pg_dump 与 dist tar 需空间——>85% 拒；v4.2/评五 P1-11：USED 空串 fail-closed——ssh 失败下 [[ "" -le 85 ]] 按算术 0=放行，门禁里的 fail-open 分支自灭） ==="
  USED=$(ssh -i "$KEY" "$SERVER" "df --output=pcent / | tail -1 | tr -dc '0-9'")
  [[ "$USED" =~ ^[0-9]+$ ]] || { echo "磁盘水位探测失败（USED='${USED}'）——fail-closed 拒部署"; exit 1; }
  [[ "$USED" -le 85 ]] || { echo "服务器磁盘 ${USED}%>85%——先清理再部署（pg_dump/dist tar 可能半途失败）"; exit 1; }

  echo "=== 本地构建（A4+B3：构建前清 dist——nest-cli 无 deleteOutDir，不清=删除/重命名源的旧 .js 残留随 tar 上传=幽灵代码搬层；B29 双布局实测=本清理性硬证据——src/scripts/prisma 子目录+tsbuildinfo 均非 nest build 产物） ==="
  node -e "require('node:fs').rmSync('apps/api/dist',{recursive:true,force:true});require('node:fs').rmSync('packages/shared/dist',{recursive:true,force:true})"
  pnpm --filter @flowweb/shared build && pnpm --filter @flowweb/api build
  node scripts/check-no-testutils-in-dist.mjs   # v4.1/J7：检查对象=即将上传的 dist（verify 链里那次校验的产物已被 rmSync 丢弃；SHA 收据路径更是一次不跑——移到上传前才是真门禁）
  test ! -e apps/api/dist/tsconfig.drill.tsbuildinfo && test ! -d apps/api/dist/scripts || { echo "dist 新鲜度锚红：drill 产物残留（rmSync 未生效或构建混入）"; exit 1; }   # v4.2/B29：幽灵布局消失成为可断言不变量（dist/src 形态执行时实测校准后定去留）
  printf '{"git":"%s","builtAt":"%s"}\n' "$GIT_SHA" "$(date -u +%FT%TZ)" > apps/api/dist/build-info.json   # v4.2/P46：溯源随产物——cutover/rollback 从这份文件派生（git+builtAt 两字段；mainJsSha 驳回=sha256sum -c 已断言）
  MAIN_SHA=$(sha256sum apps/api/dist/main.js | cut -d' ' -f1)   # v4/P44②：+3 防伪造锚——cutover ④ 远端等值断言用（校验对象=dist.next，mv 之前——P49②先验后换）

  echo "=== 上传（dist.next+prisma/scripts×2/ecosystem/manifest——src 不再上传；P33：apps/api/scripts 必传=冒烟所在；v4.2/P49③：shared dist 解到 dist.next 不再先 rm 远端 dist——旧实例存活期（drain 前）惰性 require 不得指向被删目录，替换统一移进 cutover ④；v4.2/评五 P1-5：补传 apps/web/package.json——frozen-lockfile 校验全部 workspace manifests 一致性，web 缺传=web 依赖变更后 api 模式 ERR_PNPM_OUTDATED_LOCKFILE 且报错指向 lockfile 误导） ==="
  scp -i "$KEY" ecosystem.config.cjs "$SERVER:$REMOTE_DIR/"
  tar czf - -C apps/api/dist . | ssh -i "$KEY" "$SERVER" "rm -rf $REMOTE_DIR/apps/api/dist.next && mkdir -p $REMOTE_DIR/apps/api/dist.next && cd $REMOTE_DIR/apps/api/dist.next && tar xzf -"
  scp -i "$KEY" apps/api/package.json "$SERVER:$REMOTE_DIR/apps/api/package.json"
  scp -i "$KEY" apps/web/package.json "$SERVER:$REMOTE_DIR/apps/web/package.json"
  scp -i "$KEY" packages/shared/package.json "$SERVER:$REMOTE_DIR/packages/shared/package.json"
  scp -i "$KEY" pnpm-lock.yaml package.json "$SERVER:$REMOTE_DIR/"
  tar czf - -C packages/shared/dist . | ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/packages/shared && rm -rf dist.next && mkdir dist.next && cd dist.next && tar xzf -"   # P49③：解到 dist.next（tsconfig.json 随 package.json scp 已覆盖——tar 只装 dist 内容）
  tar czf - -C apps/api/prisma . | ssh -i "$KEY" "$SERVER" "mkdir -p $REMOTE_DIR/apps/api/prisma && cd $REMOTE_DIR/apps/api/prisma && tar xzf -"
  tar czf - -C scripts . | ssh -i "$KEY" "$SERVER" "mkdir -p $REMOTE_DIR/scripts && cd $REMOTE_DIR/scripts && tar xzf -"
  tar czf - -C apps/api/scripts . | ssh -i "$KEY" "$SERVER" "mkdir -p $REMOTE_DIR/apps/api/scripts && cd $REMOTE_DIR/apps/api/scripts && tar xzf -"

  echo "=== 服务器：generate+标记文件条件 install（v4/评四 P0-4 根修：比较对象=上次成功 install 的 .installed-lock-sha 标记。v4.2/评五 P1-8：删 --prod=false〔pnpm 非文档化否定旗标——未验证拼写可能 Unknown option 或静默忽略〕；默认 install 即装 prod+dev，与"prisma CLI 是 devDependency 却被部署链 load-bearing"的行为契约改由**行为断言**承载〔本仓"行为锚>文本锚"惯例〕） ==="
  LOCK_LOCAL=$(sha256sum pnpm-lock.yaml | cut -d' ' -f1)
  LOCK_DONE=$(ssh -i "$KEY" "$SERVER" "cat $REMOTE_DIR/.installed-lock-sha 2>/dev/null || true")
  if [[ -n "$LOCK_DONE" && "$LOCK_LOCAL" == "$LOCK_DONE" ]]; then
    echo "lockfile 未变（.installed-lock-sha 命中）——跳过 pnpm install"
    ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/api && npx prisma generate"
  else
    ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && pnpm install --frozen-lockfile && cd apps/api && npx prisma generate && test -x node_modules/.bin/prisma || { echo 'devDependency prisma 缺失——install 裁掉了部署链 load-bearing 的 CLI（A3 行为断言）'; exit 1; }" \
      && ssh -i "$KEY" "$SERVER" "sha256sum $REMOTE_DIR/pnpm-lock.yaml | cut -d' ' -f1 > $REMOTE_DIR/.installed-lock-sha"
  fi

  cutover_api
}
```

cutover_api 定稿（v4——restart_api 改名〔P43〕；④ 全链 `&&`+`test -f`+sha256 等值〔P44② 封死 `;` 吞错+mv 落进现存目录=静默空部署伪造 +3〕；③ 前服务器侧 additive 双跑〔P45②〕；⑥ ready 轮询读 body 非 -f 状态码+RTO 台账取 guard elapsedMs〔评四 P1-9——契约"部署判据读响应体"〕+上传面服务器侧存在性三件〔评四 P1-3 行为锚〕）：

```bash
cutover_api() {
  echo "=== ⓪前置（v4.2/评五 P1-9：Node≥18 fetch 门——deploy-guard 用全局 fetch，Node16 下 cutover ① 直接 TypeError 且症状酷似令牌/网络问题） ==="
  ssh -i "$KEY" "$SERVER" 'node -e "process.exit(typeof fetch===\"function\"?0:1)" || { echo "服务器 Node<18——deploy-guard 不可用（runbook §0 前置条件）"; exit 1; }'

  echo "=== ①部署拒重启三步（guard 写 .deploy-guard-state.json——epoch 经状态文件交接+全退出路径含 degraded+放行点基线收口，P39/C5） ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && GIT_SHA=$GIT_SHA node scripts/deploy-guard.mjs $([[ $FORCE_RESTART == 1 ]] && echo --force) $([[ $ALLOW_LEGACY == 1 ]] && echo --allow-legacy)"

  echo "=== ②迁移前备份（D6：migrate=链上唯一不可逆操作。pg_dump 走 libpq——DSN 去引号+剥 Prisma 参数；保留 5 份） ==="
  ssh -i "$KEY" "$SERVER" 'DSN=$(grep -m1 "^DATABASE_URL=" '"$REMOTE_DIR"'/apps/api/.env | cut -d= -f2- | tr -d "\"" | sed "s/?.*$//"); mkdir -p ~/backups && pg_dump -Fc "$DSN" -f ~/backups/pre-migrate-$(date +%Y%m%d%H%M%S).dump && ls -t ~/backups/pre-migrate-*.dump | tail -n +6 | xargs -r rm'

  echo "=== ③additive 双检+迁移（顺序语义：drain 只冻结 collab 写路径〔三入口门〕，HTTP 面继续打库——安全性由 additive 锚承担〔expand/contract〕非由顺序承担；v4：服务器侧 migrate 前同跑——不可逆动作发生处） ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && node scripts/check-migration-additive.mjs && cd apps/api && npx prisma migrate deploy"

  echo "=== ③.5 spool 账本条件迁移（v4.2/P47——执行点从 T12 Step 1.5 手工提前 rsync 移进 cutover：--allow-legacy 档无 drain+preflight 15-20min 窗口旧实例续写旧目录=提前迁移的副本陈旧而 +5 仍报未丢=假证据；此刻〔guard 后/切换前〕窗口秒级且 run#2 档已停写。目标=树外 flowweb-data） ==="
  ssh -i "$KEY" "$SERVER" 'OLD_DIR=$(sudo readlink /proc/$(pm2 pid flowweb-api)/cwd)/.data/collab-spool; NEW_DIR=/home/ubuntu/flowweb-data/collab-spool; if [ "$OLD_DIR" = "$NEW_DIR" ]; then echo "旧目录=新目录（$NEW_DIR）——无需迁移"; exit 0; fi; OLD_N=$(find "$OLD_DIR" -type f 2>/dev/null | wc -l); if [ "$OLD_N" = 0 ]; then echo "旧目录 $OLD_DIR 空——无需迁移（仅建新目录）"; mkdir -p "$NEW_DIR"; exit 0; fi; echo "迁移 $OLD_DIR → $NEW_DIR（$OLD_N 个文件）"; (command -v rsync >/dev/null && rsync -a "$OLD_DIR"/ "$NEW_DIR"/) || cp -a "$OLD_DIR"/. "$NEW_DIR"/; NEW_N=$(find "$NEW_DIR" -type f | wc -l); echo "迁移后：old=$OLD_N new=$NEW_N"; [ "$OLD_N" -le "$NEW_N" ] || { echo "计数不等——中止部署（人工核对）"; exit 1; }'

  echo "=== ④dist 原子切换（guard 拒→dist 未动=旧构建继续跑；v4：全链 && 禁 ; 吞错+test -f+sha256 等值=半切换/幽灵/陈旧产物三杀；v4.2/P49②：**校验移 mv 之前**〔对 dist.next/main.js——先验后换，校验失败时坏产物不进 dist/，惰性 require 窗口消除〕+P49③：shared dist.next 同窗口切换+**删 SWITCH_BEGUN 失败复位**〔v4 复位使 trap 半态分支不可达=trap 打印与内联消息相反指引〕） ==="
  SWITCH_BEGUN=1
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/api && test -f dist.next/main.js && echo '$MAIN_SHA  dist.next/main.js' | sha256sum -c - && rm -rf dist.prev && { [ ! -d dist ] || mv dist dist.prev; } && mv dist.next dist && test -f dist/main.js" \
    && ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/packages/shared && rm -rf dist.prev && { [ ! -d dist ] || mv dist dist.prev; } && mv dist.next dist" \
    && SWITCHED=1 || { echo "切换失败——dist 可能已 mv 走/半切换：**勿重启 pm2**，跑 ./deploy.sh api --rollback 或人工补 mv dist.next dist"; exit 1; }   # v4.2：失败保持 SWITCH_BEGUN=1 ⇒ trap elif 半态分支可达

  echo "=== ⑤重启（startOrReload+GIT_COMMIT_HASH 从产物派生——v4.2/P46：build-info.json 随 dist 上传，值来自被执行的那份产物而非部署会话〔rollback 后自动说实话〕；出口判据 +3 的 pm2_env 口径即证此值） ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && export GIT_COMMIT_HASH=\$(node -e \"console.log(require('./apps/api/dist/build-info.json').git)\") && pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save"

  echo "=== ⑥post-deploy：ready 轮询（粗屏障——读 body 非 -f 状态码，draining 档 503 属预期；RTO 台账取 guard post 段 elapsedMs）+上传面服务器侧三件+3001 监听+post 段+冒烟+NODE_ENV 姿态告警 ==="
  ssh -i "$KEY" "$SERVER" 'i=0; body=""; while [ $i -lt 60 ]; do i=$((i+1)); body=$(curl -s http://127.0.0.1:3000/api/ready 2>/dev/null); echo "$body" | grep -q "\"ready\":true" && break; sleep 1; done; if [ -z "$body" ]; then echo "ready 60s 未达"; exit 1; fi; echo "ready barrier after ${i}s（RTO 见 guard post JSON elapsedMs）"'
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && test -f ecosystem.config.cjs && test -d scripts && test -d apps/api/scripts || { echo '上传面三件缺失（ecosystem/scripts/apps-api-scripts）'; exit 1; }"
  ssh -i "$KEY" "$SERVER" 'node -e "require(\"net\").connect(3001,\"127.0.0.1\").on(\"connect\",()=>{console.log(\"3001 listening\");process.exit(0)}).on(\"error\",()=>{console.error(\"3001 未监听\");process.exit(1)})"'
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && GIT_SHA=$GIT_SHA node scripts/deploy-guard.mjs --post-restart"
  if [[ $SKIP_SMOKE == 1 ]]; then
    echo "=== 冒烟已跳过（--skip-smoke）——本次部署不构成完整判据 ==="
  else
    ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && pnpm --filter @flowweb/api exec node scripts/collab-smoke.mjs"
  fi
  ssh -i "$KEY" "$SERVER" 'grep -q "^NODE_ENV=.\+" '"$REMOTE_DIR"'/apps/api/.env || echo "WARNING: 服务器 NODE_ENV 未设/空——cookie Secure/DTO 白名单/debounce 按 dev 分支而 prometheus/admin guard 按 production 分支（语义不一致，Y0.5/E58 审计）"'
}

rollback_api() {
  echo "=== 快回滚（P37：dist.prev 翻回+重启——30 秒；v4：分派层跳过 preflight（api) ROLLBACK 条件）+post 段带 GIT_SHA（SHA 断言同 SHA 复用基线——P39）；v4.2/P46：GIT_COMMIT_HASH 从 dist.prev 的 build-info 派生——回滚后 pm2_env=被提升构建的真实 SHA（≠HEAD 是正确状态，runbook §5 注明；v4 形态 export 当前 HEAD 给上一代 dist=判据成立结论为假） ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/api && [ -d dist.prev ] || { echo '无 dist.prev（上次部署前已回滚或首部署）——回滚走 git revert+重新部署'; exit 1; } && test -f dist.prev/build-info.json || { echo 'dist.prev 无 build-info（上一代构建早于 P46）——溯源按旧口径 export GIT_SHA'; } && rm -rf dist.next && mv dist dist.next && mv dist.prev dist && test -f dist/main.js"
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && export GIT_COMMIT_HASH=\$(node -e \"console.log(require('./apps/api/dist/build-info.json').git)\") && pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save"
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && GIT_SHA=$GIT_SHA node scripts/deploy-guard.mjs --post-restart"   # epoch 断言仍有效（startOrReload 同样重启；state=上次部署所写、SHA 同）
  echo "=== 回滚完成（上一代 dist 已上线，pm2_env.GIT_COMMIT_HASH=上一代构建 SHA）——回滚不构成判据、不重跑 preflight/本地 migrate（runbook §5）；修复后正式部署仍需完整链 ==="
}
```

deploy_web 重写+deploy_full 组合（v4/P44③/评四 P1-5+§3-1：deploy_web 的 `cd` 污染全链相对路径〔子 shell 根修〕+web 资产秒级 404 窗口〔dist.next 原子切换——nginx root 不变〕+web 版本不可观测〔version.json 随构建入 dist——`curl /version.json` 即证 web/API 偏斜〕）：

```bash
deploy_web() {
  echo "=== 本地构建前端（子 shell 包裹——v4：cd 不再污染 deploy_full 后续 deploy_api 的相对路径；v4.2/P46：version.json 补 builtAt 与 api build-info.json 同构——两 artifact 溯源一套口径） ==="
  ( cd "$(dirname "$0")/apps/web" && rm -rf dist && npx vite build && printf '{"git":"%s","builtAt":"%s"}\n' "$GIT_SHA" "$(date -u +%FT%TZ)" > dist/version.json )

  echo "=== 上传+原子切换（dist.next→mv——对齐 api 侧形态；dist.prev 保留一代） ==="
  tar czf - -C apps/web/dist . | ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/web && rm -rf dist.next && mkdir -p dist.next && cd dist.next && tar xzf - && cd .. && rm -rf dist.prev && { [ ! -d dist ] || mv dist dist.prev; } && mv dist.next dist"

  echo "=== 完成（后端无需重启；version.json 可验：curl -s https://www.flow123.com/version.json） ==="
}

# v4.2/P48：provision_tarball=原 deploy.sh:29-37 tar 铺底段**逐行搬运**（片段即产物——非转述；清单追加 ecosystem.config.cjs；
# exclude 追加 .deploy-guard-state.json/.preflight-*.ok/.installed-lock-sha——后两者被上传=服务器"看起来像已预检"语义污染）。
# install/generate/migrate 不在此（唯一所有者=deploy_api/cutover——.installed-lock-sha 标记单点，防双源）；原 :48-55 服务器三次构建不搬运（零构建形态）。
provision_tarball() {
  echo "=== 铺底：上传源码（原 :29-37 搬运——服务器只作部署树，不构建） ==="
  tar czf - \
    --exclude='node_modules' --exclude='dist' --exclude='.turbo' \
    --exclude='backups' --exclude='.data' --exclude='.worktrees' \
    --exclude='.claude' --exclude='.git' --exclude='.env' \
    --exclude='.deploy-guard-state.json' --exclude='.preflight-*.ok' --exclude='.installed-lock-sha' \
    apps/ packages/ scripts/ ecosystem.config.cjs package.json pnpm-workspace.yaml pnpm-lock.yaml \
    turbo.json tsconfig.base.json .eslintrc.base.json .gitignore \
    | ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && tar xzf -"
}

# v4.2/P48：三行顺次调用——每行独立语句=errexit 逐条生效（B28 实测：`fn1 && fn2;` 非末位失败被静默吞+首次 full 在半铺底状态继续跑；
# v4 原骨架调用的 provision_tarball/server_install_generate 两函数全文未定义=command not found 被 AND-OR 吞掉——本版删 server_install_generate+三行化双根修）
deploy_full() {   # 首次铺底专用：tar 铺底 → web → api（install/generate/migrate 由 deploy_api→cutover 单点负责）——服务器零构建（零构建锚=ssh 行内无 nest/vite/tsc，P43）
  provision_tarball
  deploy_web
  deploy_api
}
```

- [ ] **Step 3: 失败 trap 分阶段（P1-2+P37：中止≠无复原，复原指引随阶段）**

deploy.sh `set -e` 行后追加：

```bash
SWITCHED=0; SWITCH_BEGUN=0   # ④：SWITCH_BEGUN=进入切换（dist 可能已 mv 走）；SWITCHED=切换完整落地（v4/评四 P1-10③ 补"切换中"半态）
trap 'rc=$?; if [ $rc -ne 0 ]; then echo ""; echo "=== 部署中止（exit $rc）==="; \
  if [ $SWITCHED == 1 ]; then echo "新构建已上线但 post/冒烟未过——快回滚：./deploy.sh api --rollback（30s；跳过 preflight）；或修复后重新部署"; \
  elif [ $SWITCH_BEGUN == 1 ]; then echo "切换半途失败（dist 可能已 mv 走、dist.next 未就位）——**勿重启 pm2**：跑 ./deploy.sh api --rollback 或人工补 mv dist.next dist"; \
  else echo "旧构建仍在跑（dist 未切换）——修复后重跑即可；若已 drain：60s 自动解除（SV12）"; fi; fi' EXIT
```

（两个旗标在 cutover_api ④ 内置位——bash 变量跨函数直改；SWITCH_BEGUN 在 ssh 切换命令前置 1、**失败分支不复位（v4.2/C6：v4 的 `SWITCH_BEGUN=0` 复位把唯一能进 trap elif 半态分支的路径自己清掉=死代码——trap 落入 else 打印"旧构建仍在跑——修复后重跑即可"，与内联"勿重启 pm2"相反指引，而 ssh 切换失败最常见原因恰是 mv 半途）**，成功分支 SWITCHED=1。④ 校验失败（sha256 不符）时 dist 未动⇒SWITCH_BEGUN=1 但 dist 原位——trap 走 elif 的指引（--rollback/人工补 mv）对"校验失败但 dist 未动"形态仍安全：--rollback 的 mv dist dist.next && mv dist.prev dist 会把好构建翻回来，人工核对 dist/main.js 后重跑亦然。）

- [ ] **Step 4: verify 末步统一接入（T5/T7 载体此刻才挂链——执行序承诺的收敛点）+校验**

package.json verify 链尾追加 `&& node scripts/check-ecosystem.mjs && node --test scripts/`（node --test 自动发现 scripts/*.test.mjs=deploy-guard/env-file/check-ecosystem 三套；.gitignore 补 `.deploy-guard-state.json`、`.preflight-*.ok`、`.installed-lock-sha`）。

```bash
pnpm verify        # T8 收敛点：全绿（check-ecosystem 对真文件绿+node --test scripts/ 三夹具套绿+既有链零回归）
node scripts/deploy-preflight-int.mjs ; echo exit=$?     # 本地实测（本地 PG 在跑时绿；停 PG 跑=红相探针：coverage 四判据拒全 skip；v4 直跑 vitest 入口——Windows ENOENT 已根修）
node scripts/check-migration-additive.mjs                # v4.2：基线常量已预填 20261007170319（8 历史命中注释登记+基线存在性断言+DROP INDEX 降 WARNING）——本跑应绿；红相探针=临时改 BASELINE 为不存在串（必红=永久豁免路径封死证明）+临时造一个 DROP COLUMN 迁移目录（必红）验证后删
# bash -n 本机不可靠（PATH 上的 bash=WSL stub，实测 E_ACCESSDENIED）→ CI 承载（runbook 写明本地调试用 Git Bash 绝对路径）：
```

ci.yml test job 步骤追加：

```yaml
      - name: deploy.sh 语法校验（Y0a-4——bash -n 跨平台承载）
        run: bash -n deploy.sh
```

- [ ] **Step 5: Commit**

```bash
git add deploy.sh scripts/deploy-preflight-int.mjs scripts/check-migration-additive.mjs .github/workflows/ci.yml package.json .gitignore
git commit -m "feat(collab): Y0a-4 部署链 v4.2——cutover_api 定稿（⓪fetch 前置门；③.5 spool 账本迁移〔P47 树外目标+秒级窗口〕；④sha256 先验后换 dist.next+删 SWITCH_BEGUN 复位〔C6 半态 trap 复活〕+shared dist.next 同窗切换〔P49③〕；⑤GIT_COMMIT_HASH 从 build-info.json 产物派生〔P46——rollback 后溯源为真〕）+deploy_full 三行顺次+provision_tarball 逐行搬运（P48——B28 AND-OL 陷阱+未定义函数双根修，删 server_install_generate 双源）+install 行为断言代 --prod=false（P1-8）+USED 正则 fail-closed（P1-11）+上传面补 web/shared package.json（P1-5 frozen 跨 workspace）+dist 新鲜度锚（B29）+additive 基线存在性断言+DROP INDEX 降 WARNING+8 文件注释更正（P0-3）+verify 末步统一接入"
```

---

## Task 9: nginx 替换语义+runbook 七章+.env.example（文档落 docs/superpowers/ 语料内）

**Files:**
- Create: `deploy/nginx/collab-location.replace.conf`、`docs/superpowers/collab-ops-runbook.md`
- Modify: `apps/api/.env.example`（补 COLLAB_* 全族注释清单）

- [ ] **Step 1: nginx（P26——替换语义+deny drain+access_log off）**

```nginx
# deploy/nginx/collab-location.replace.conf —— Y0a-4：**替换**（非追加）服务器站点配置中既有
# location /collab block（同 server 双 location = nginx -t duplicate 必炸）。
# 运维步骤（runbook §7）：①备份站点文件 ②删除旧 /collab block 整段 ③贴入本文件内容
# ④sudo nginx -t 失败即 cp 备份回滚 ⑤systemctl reload nginx。
location /collab {
    access_log off;                 # E13 止血：WS query token 不落 access log（Y0b cookie-only 根治）
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 300s;        # 依据：心跳间隔+COLLAB_TIMEOUT=30s 量级——默认 60s 剪空闲 WS
    proxy_send_timeout 300s;
    proxy_buffering off;            # WS 帧不缓冲
}
# drain 端点公网封禁（deploy-guard 走 127.0.0.1:3000 直连不经 nginx——零副作用；@SkipThrottle
# 覆盖 drain 的爆破面经此关闭）：
location = /api/drain { deny all; }
```

- [ ] **Step 2: runbook 七章（P27 全文按 §0.3-P27 章节表落文——此处定稿章节骨架与关键内容；**v4 增补五条**：§3 追加"改 cwd/COLLAB_SPOOL_DIR 的部署必须迁移 spool 账本（迁移后计数等式）+部署会话禁 export 其他变量（B25：--update-env 记录 shell 全量 env 进 pm2_env）"；§5 追加"--rollback 前置=上次部署的状态文件在且 SHA 一致（P39：post 段不删档）+回滚不重跑 preflight/本地 migrate"；§0/§8 写明"Windows 本地调试 deploy.sh 用 Git Bash 绝对路径——PATH 上的 bash 是 WSL stub（实测 E_ACCESSDENIED）"；§7 追加"`yjs_loaded_documents` 口径=WS 活跃 doc+在飞直连（REST 直连 disconnect 在 connectionsCount>0 时不卸载——零连接才 unload，B26）——'常驻 doc 字节上限'只在有 WS 连接时有意义"；§8 部署姿态节维持；**v4.2 增补五条**：§0 前置加"服务器 Node≥18（deploy-guard 用全局 fetch——cutover ⓪ 有断言）+rsync 可选（缺失回退 cp -a）"；§2 补"每进程 PrismaClient 客户端数=3〔PrismaService/authPrisma/preload 临时——preload 的 catch 已收口 disconnect，B30〕"；§3 改"spool 账本目录在**部署树外** `/home/ubuntu/flowweb-data/collab-spool`（ecosystem 注入）+**迁移在 cutover ③.5 内自动执行**（guard 后切换前秒级窗口——勿提前手工迁移；改目录必迁移+计数等式）"；§5 补"回滚后 +3 语义：pm2_env.GIT_COMMIT_HASH 来自被提升 dist.prev 的 build-info.json（≠HEAD 是正确状态）；dist.prev 无 build-info（早于 P46 构建）按旧口径"；§8 补"首次 cutover 后 effective NODE_ENV 若变化（--update-env 会话 env 替换+dotenv 终层）=本批行为变更——按 B8 八读点逐条评估记录"〔评五 M4〕）**

`docs/superpowers/collab-ops-runbook.md`（**头标 `<!-- doc-status: active -->`——P38：不写 canonical**，canonical 身份由 C1/C4/manual.json 派生、手写头不生效且与派生态漂移；active 受语料基础门禁、零登记成本；升格归 doc-governance 后续）八章：①pm2 迁移（`pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save` 幂等——首启/更新同命令，**禁 pm2 delete**〔绕过拒重启机制+制造无守护窗口〕；jlist 自证字段〔fork/1/≥45000/status/restart_time〕；服务器 `apps/api/src` 目录退役可删）②连接池（**每实例** connection_limit——三实例×10=30 上限算术+M0 实测 `pg_stat_activity/max_connections` 据实定值〔A2 半采〕；Prisma 事务 timeout≠URL pool_timeout）③部署链语义（三步/60s 自动解除/force 两类合法用法〔drain 后未排空、目标不可达——每次使用留部署记录〕/allow-legacy/skip-smoke/skip-preflight=不构成判据/失败复原/**跑 preflight 前停本地 dev API**〔int 操作 CollabLease 单行〕/§9.7 Y0a-Y0b 同批部署约束）④**部署窗口与用户可见影响**（措辞 v4.1/J1 改正——v3"零消费"陈述与实测不符：**1012 已被消费**〔canvasCollabRuntime.ts:107/:837-841+conn.spec:213-264——30s 计划内重启静默窗口+1~3s 短退避重连，窗口内不升 banner〕、**write-frozen 通告零消费**〔gateway:657 自注释"Y0b 消费"〕、**503 走通用失败态**〔main.ts Retry-After:2+autosave 三次退避+红点手动重试——用户看不到"服务正在重启"语义〕。正确表述："客户端已有计划内重启静默+短退避；未消费的是 write-frozen 冻结通告；drain 期画布写走通用红点失败态"——**Y0b 工作项=消费 write-frozen+503 语义化提示，非从零实现重启感知（勿重做 1012 静默窗口）**；发布应在无人编辑时进行；单人项目同栈代价〔J1/R6/R7〕；付费执行与克隆窗口内 503；pre-real-user 阻断项=Y0b 客户端消费）⑤回滚（**快路径 `./deploy.sh api --rollback`**〔30s，dist.prev 翻回〕；完整路径 `git revert <sha> && ./deploy.sh api`；migrate 回滚=恢复 ~/backups dump〔开发期 migrate reset 先例〕；**同机 dump≠备份**——离机/PITR 归 Y0.5/E47）⑥最小可用告警（`pm2 install pm2-logrotate && pm2 set pm2-logrotate:max_size 10M && pm2 set pm2-logrotate:retain 7`；磁盘 >85% 检查；2GB swap 建议〔OOM killer 首选协居 postgres〕；`pm2 startup`+`systemctl is-enabled pm2-ubuntu` 核验〔M0 [6]〕；**max_memory_restart 触发的重启=崩溃路径**——按 RPO 3s 窗口评估+查 `shutdown_undrained`/storeInFlight 日志；解冻三触发线：并发 >50 或常驻 doc>100 / store P95>1s 或 lag>200ms / pm2 重启>1 次/周）⑦容量三数初始值（并发 WS 上限 50/常驻 doc 字节上限=D7 未定标注 Y1c-3/lag 阈 200ms——**引用既有真指标名**〔B21：`process_resident_memory_bytes`/`nodejs_eventloop_lag_p99_seconds` 已有默认 collector〕+本批新增 `yjs_loaded_documents`/`yjs_connection_count`；enforcement 归 Y1c-3）⑧**部署姿态**（A3：M0 [2] 实测的 effective NODE_ENV 落档——**v4.1/J5 两列制：迁移前 /proc 记录 vs 首次 startOrReload 后 /proc 记录并列**〔--update-env 用会话 env 替换进程 env——迁移会抹除历史手工设置的进程级变量；dotenv 运行期加载 .env 为最终生效层〕，由此导出 cookie Secure/debounce 档位/FAKE_AI 防线当前语义；升 production 动作与八读点审计归 Y0.5/E58）。

- [ ] **Step 3: .env.example 补键（P28；v4.2/M6 全键集——实测现状仅 9 行〔SMS 五键+限流白名单〕，只补 COLLAB 族会产出"契约=SMS+COLLAB"的误导性文件）**

头注 `# 完整键集单源=apps/api/src/config/env.ts（zod schema）；服务器真值在 apps/api/.env（chmod 600）` 后按序补：**zod 必填 5 键**（DATABASE_URL/REDIS_URL〔有默认但显式列〕/MINIO_ENDPOINT/MINIO_ACCESS_KEY/MINIO_SECRET_KEY）+**MINIO_USE_SSL**（注明 normalize 语义：'true' 不区分大小写为 true 其余 false）+**NODE_ENV**（注明八读点影响面 Y0.5/E58）+**既有 SMS/限流段维持**+**COLLAB_* 全族+COMPACT_INTERVAL_MS 注释清单**（含默认值指向消费点、W23 独立令牌说明、COMPACT_INTERVAL_MS 无前缀注记、COLLAB_SPOOL_DIR 树外目录示例）。

- [ ] **Step 4: doc-gate 核对+Commit**

```bash
node scripts/doc-gate.mjs && git add deploy/nginx/ docs/superpowers/collab-ops-runbook.md apps/api/.env.example
git commit -m "docs(collab): Y0a-4 runbook 七章（含产品面窗口/回滚/告警/解冻线——J1/R6/R7 落档）+nginx 替换语义（deny drain+access_log off）+.env.example 契约清单（语料内 docs/superpowers/）"
```

---

## Task 10: M-2/M-3 登记收口（P6/P7 不变+M-2 证据补强）

（同 v1 Task 6：M-2 判定不触发〔drill 零 kit import——kill9-drill.ts:138 实证〕；M-3 未修归 Y0c〔gateway:1198 仅 hangReason 分型〕。追加登记：P24 库选项 pin 已落 Task 4〔纪律 9 缺口关闭〕。spec §3 4.7 节两段执行状态注记+commit。）

---

## Task 11: collab-core required 生效——TD-27 重探测分支【用户确认点】

**Files:** 无仓内代码（GitHub 侧+可能的 spec 登记）；前置：`gh` 已装或 PAT 就绪

- [ ] **Step 1: 探测（只读——TD-27 结论已过期：10-05 终裁时仓库私有，10-06 已转公有）**

```bash
gh api repos/linklvx/flowweb/branches/master/protection --jq '{contexts: .required_status_checks.contexts, enforce_admins: .enforce_admins.enabled, allow_force_pushes, lock_branch}' 2>&1 | head -8
```

（403=付费墙仍在〔TD-27 维持〕；200=可用+现值基线〔B10′：ci.yml:54-55 注释非事实，以实测为准〕；gh 缺失→`curl -H "Authorization: Bearer $GITHUB_PAT" ...`——PAT 作用域 `administration:write`，分支保护 URL 写进 runbook §6。）

- [ ] **Step 2a: 【分支可用→机器强制】GET 全量→仅追加 context→PUT 整份（F8：PUT=整对象覆盖写，禁自拼 body）**

```bash
gh api repos/linklvx/flowweb/branches/master/protection > /tmp/protection.json   # 服务器侧操作机或 CI 内执行；Windows 本机用 node 脚本读写 tmpdir
# v4/评四 T11 行：PUT 前剔除 GET 响应的只读字段（url/contexts_url/protection_url 等——PUT 带回会 422）
node -e "const p=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));for(const k of ['url','contexts_url','protection_url'])delete p[k];p.required_status_checks=p.required_status_checks||{strict:false,contexts:[]};if(!p.required_status_checks.contexts.includes('collab-core'))p.required_status_checks.contexts.push('collab-core');require('fs').writeFileSync(process.argv[1],JSON.stringify(p))" /tmp/protection.json
gh api -X PUT repos/linklvx/flowweb/branches/master/protection --input /tmp/protection.json
```

（只追加 `collab-core`，其余字段原样回写——**先绿 PR 验 context 名映射**：push 空提交开 PR 观察 collab-core check 名精确匹配后合并。）

- [ ] **Step 2b: 【分支不可用→纪律代强制（TD-27 维持）+降级登记】**

preflight 已含 test:int（Task 8）=本地强制链；spec §4.1 出口判据 3 改写为"纪律代强制形态：CI collab-core 常跑（push/PR 双触发）+部署 preflight int 全绿+TD-27 登记延续"；machine-enforcement 升级路径一行 API 已备（Step 2a 命令入 runbook §6）。

- [ ] **Step 3: 【请用户确认】故意红验证（注入点=*.int.spec.ts——P0-5）**

```bash
git checkout -b y0a4-required-verify
printf 'import { it, expect } from "vitest";\nit("Y0a-4 required 故意红——验证后即删", () => { expect(1).toBe(2); });\n' > apps/api/src/modules/collab/zz-required-verify.int.spec.ts
git add apps/api/src/modules/collab/zz-required-verify.int.spec.ts && git commit -m "test: Y0a-4 临时——collab-core required 验证（int 注入点；勿合并）" && git push -u origin y0a4-required-verify
gh pr create --title "Y0a-4 required 验证（故意红，勿合并）" --body "collab-core 必红（int 池命中）+check-int-coverage 集合断言同步红；test job 保持绿=单归因证据。验证后关闭删除。"
```

预期：**collab-core 红+check-int-coverage 红+test job 绿**（单归因：红只能来自 collab-core 运行集——`.spec.ts` 注入是假证明）；merge 被阻（2a 分支）或记录"纪律代强制"（2b 分支）。`gh pr close --delete-branch` 清理（MIN_TOTAL 26 复原自愈）。

---

## Task 12: 服务器执行——令牌先行+pm2 迁移+双次部署 dry-run【用户确认点】

- [ ] **Step 1: 【请用户确认】W23 令牌先行（独立停机令牌——runbook §1 前置；v4/B24 根修：v3 的 `ssh 'script' _ "$TOKEN"` 惯用法四缺陷〔远端 sh -c 不设 $1/尾随参语法错/空值检查自我实现/追加重复键〕——改服务端生成+sed 幂等+计数断言，密钥永不进 argv）**

```bash
ssh -i ~/.ssh/flowweb_server ubuntu@101.42.94.107 'cd ~/flowweb && f=apps/api/.env && chmod 600 "$f" \
  && sed -i "/^COLLAB_ADMIN_TOKEN=/d" "$f" \
  && tok=$(node -e "console.log(require(\"crypto\").randomBytes(32).toString(\"hex\"))") \
  && printf "COLLAB_ADMIN_TOKEN=%s\n" "$tok" >> "$f" \
  && echo "已写入（指纹=$(printf %s "$tok" | sha256sum | cut -c1-12)——本地无需持有明文：guard 在服务器自读 .env；运维需明文时 ssh cat，v4.2/评五 P1-4 明文不进终端/会话记录）" \
  && test "$(grep -c "^COLLAB_ADMIN_TOKEN=.\+" "$f")" = 1 && echo "键计数=1 ✓" \
  && { grep -nE "^\s*export\s+COLLAB_|COLLAB_[A-Z_]*=.*\s+#" "$f" || echo "服务器 .env 无 export 前缀/行内注释（P45 对拍前提）"; } \
  && { grep -E "^COLLAB_[A-Z_]+=\$" "$f" && echo "存在空 COLLAB_* 键——先清（B13）" || echo "空值检查通过"; }'
```

（`sed -i` 先删旧行=幂等可重跑〔轮换同命令〕；服务端 `node -e crypto` 生成〔服务器有 node，M0[6] 已验版本〕；计数断言=真正的门。**新令牌与仓内任何值不同源=E41 唯一残留核对项的关闭证据**——落档 server-profile。）

- [ ] **Step 1.5: spool 账本迁移探测（v4.2/P47——**执行已移进 cutover ③.5 自动完成**：v4 原形态在 run#1 前手工 rsync，而 run#1 `--allow-legacy` 档无 drain+preflight 15-20min 窗口旧实例续写旧目录=迁移副本陈旧而 +5 仍报"未丢"=假证据。本步仅做**只读探测落档**〔目标=树外 `/home/ubuntu/flowweb-data/collab-spool`〕，给 run#1 的 cutover ③.5 输出做对照基线）**

```bash
ssh -i ~/.ssh/flowweb_server ubuntu@101.42.94.107 '
OLD_DIR=$(sudo readlink /proc/$(pm2 pid flowweb-api)/cwd)/.data/collab-spool
echo "旧目录=$OLD_DIR  files=$(find "$OLD_DIR" -type f 2>/dev/null | wc -l)  bytes=$(du -sb "$OLD_DIR" 2>/dev/null | cut -f1)"
ls -d /home/ubuntu/flowweb-data/collab-spool 2>/dev/null || echo "树外新目录未建（cutover ③.5 将建）"'
```

（迁移本体=cutover ③.5（rsync/cp -a 回退+计数等式断言——T8 定稿代码）；runbook §3 写死"改 cwd/COLLAB_SPOOL_DIR 必迁移且在 cutover 窗口内"。）

- [ ] **Step 2: 【请用户确认】run#1 装能力+pm2 迁移同体（v4.1/B6 顺序修正：v3 的 Step 2 先于 run#1 执行 `pm2 startOrReload ecosystem.config.cjs`——该文件 T5 新建、只有 deploy_full tar 或 deploy_api scp 能上服务器，**此刻服务器上不存在**→pm2 报 not found。而 run#1 的 cutover ⑤ 本就执行 startOrReload=迁移动作同体完成——Step 2 旧形态与 run#1 重复且必红。修正后顺序：先跑 run#1，再 jlist 自证）**

```bash
# v4.2/C4 前置断言：MINIO_USE_SSL 值形态异常先改 .env 再部署（normalize 虽不拒启动，但值形态异常=配置漂移信号，此处拦比运行期猜好）
ssh -i ~/.ssh/flowweb_server ubuntu@101.42.94.107 'v=$(grep -m1 "^MINIO_USE_SSL=" ~/flowweb/apps/api/.env | cut -d= -f2); [ -z "$v" ] || echo "$v" | grep -qiE "^(true|false)$" || { echo "MINIO_USE_SSL 值形态异常：$v——先定值 true/false 再部署"; exit 1; }; echo "MINIO_USE_SSL 形态 OK"'
./deploy.sh api --allow-legacy    # =Step 3 run#1：上传 ecosystem（deploy_api scp）+cutover ⑤ startOrReload=pm2 由内联登记迁至 ecosystem 唯一源（旧进程原地更新——无 delete 窗口，幂等可重跑；v3 删 pm2 delete 的裁定维持）
# 迁移自证（jlist 独立 ssh——混排 [PM2] 前缀击穿解析；断言含 GIT_COMMIT_HASH=出口判据 +3 的 pm2_env 口径 P34/P46——**值来自 build-info.json 产物**〔cutover ⑤ 从 dist 派生〕≡ 本地 git rev-parse）
ssh -i ~/.ssh/flowweb_server ubuntu@101.42.94.107 "pm2 jlist" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const x=JSON.parse(d).find(p=>p.name==='flowweb-api');const ok=x&&x.pm2_env.exec_mode==='fork'&&x.pm2_env.instances===1&&x.pm2_env.kill_timeout>=45000&&x.pm2_env.status==='online';console.log(JSON.stringify({exec_mode:x?.pm2_env?.exec_mode,instances:x?.pm2_env?.instances,kill_timeout:x?.pm2_env?.kill_timeout,status:x?.pm2_env?.status,restart_time:x?.pm2_env?.restart_time,GIT_COMMIT_HASH:x?.pm2_env?.GIT_COMMIT_HASH}));process.exit(ok?0:1)})"
DIST_GIT=$(ssh -i ~/.ssh/flowweb_server ubuntu@101.42.94.107 'node -e "console.log(require(\"/home/ubuntu/flowweb/apps/api/dist/build-info.json\").git)"')   # v4.2/P46：溯源自证——被执行产物 build-info 的 git
PM2_GIT=$(ssh -i ~/.ssh/flowweb_server ubuntu@101.42.94.107 "pm2 jlist" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d).find(p=>p.name==='flowweb-api')?.pm2_env?.GIT_COMMIT_HASH??'')})")
[ "$DIST_GIT" = "$PM2_GIT" ] && echo "溯源 ✓ pm2_env ≡ dist/build-info（$DIST_GIT）" || { echo "溯源红：pm2_env=$PM2_GIT ≠ build-info=$DIST_GIT"; exit 1; }   # rollback 后此断言对被提升的 dist.prev 成立（≠HEAD 是正确状态）
```

（run#1 预期同 Step 3 注：post 段 pass 且 epoch 断言 N/A（degraded=legacy，P39）；**若 run#1 前坚持先手工迁移**：`scp -i ~/.ssh/flowweb_server ecosystem.config.cjs ubuntu@101.42.94.107:~/flowweb/` 一行补上传后方可——推荐直接走 run#1 同体路径。）

- [ ] **Step 3: run#1 预期注记（命令已并入 Step 2 同体执行——v4.1/B6）**

（服务器现构建 pre-Y0a-3：drain 404→--allow-legacy 显式跳过〔**state 写 degraded:'legacy'——P39**〕→migrate→切换→startOrReload→**新构建上线=drain 端点就位**。预期 post 段 **pass 且 epoch 断言 N/A（显式打印"降级放行：legacy——接管证明由 run#2 产出"——v4：v3 此处必红且 trap 误导回滚刚上线的正确构建，已根修）**+冒烟全绿〔新构建已含 Y0a-4 全部产物〕。首次 full 铺底（provision）同类降级档：drain 不可达→--force→post N/A——**两条首跑路径的期望输出在出口判据 1 分别写死，执行者勿把首跑红当缺陷改判据**〔A4〕。）

- [ ] **Step 4: run#2（判据载体——出口判据 1）**

```bash
./deploy.sh api
```

预期全链：git 断言→verify→int→gate→本地 migrate→构建→上传→guard（**drain 已置位→own 四零→放行**——404 档不再出现）→备份→migrate→切换→startOrReload→`ready barrier`→3001 listening→post pass（epoch 递增）→`smoke OK`（双客户端 JSON）。**v4.1/A6 绑定面收窄断言**（P25 的全部收益此前零验证——127.0.0.1 探测对两种绑定都通过）：

```bash
ssh -i ~/.ssh/flowweb_server ubuntu@101.42.94.107 "ss -tlnp | grep '127.0.0.1:3001' >/dev/null && ! ss -tlnp | grep -q '0.0.0.0:3001' && echo '绑定面 ✓ 仅本地' || { echo '绑定面未收窄：'; ss -tlnp | grep 3001; exit 1; }"
```

**完整 stdout 落档 deploy-server-profile**（附录）。run#2 后复跑 Step 2 的溯源自证两条（`pm2_env.GIT_COMMIT_HASH ≡ dist/build-info.git ≡ 本地 git rev-parse --short HEAD`——+3 三方一致，出口判据证据）。

- [ ] **Step 5: 备份恢复验证（一次性，URL 派生——v3/H 修正：认证走 DSN 非 CLI 身份/修拼写/DROP DATABASE 清理）+观测落档（出口判据 4）**

```bash
ssh -i ~/.ssh/flowweb_server ubuntu@101.42.94.107 '
URL=$(grep -m1 "^DATABASE_URL=" ~/flowweb/apps/api/.env | cut -d= -f2- | tr -d "\"" | sed "s/?.*$//")
BASE=${URL%/*}; SCRATCH="${BASE}/flowweb_restore_drill"
DUMP=$(ls -t ~/backups/pre-migrate-*.dump | head -1)
# v4/评四 P1-10①：CREATEDB 判档（无权限 42501 先暴露，非 CREATE 语句炸）
CAN_CREATE=$(psql "$BASE/postgres" -tAc "SELECT rolcreatedb FROM pg_roles WHERE rolname=current_user" | tr -d " ")
if [ "$CAN_CREATE" != "t" ]; then echo "flowweb 角色无 CREATEDB——scratch 走人工建库（sudo -u postgres createdb flowweb_restore_drill）"; exit 1; fi
psql "$BASE/postgres" -c "DROP DATABASE IF EXISTS flowweb_restore_drill;" && psql "$BASE/postgres" -c "CREATE DATABASE flowweb_restore_drill;"
pg_restore --dbname="$SCRATCH" --no-owner --no-privileges "$DUMP" 2>&1 | tail -3
echo "canvas_docs=$(psql "$SCRATCH" -tAc "SELECT count(*) FROM \"CanvasDoc\";")  doc_updates=$(psql "$SCRATCH" -tAc "SELECT count(*) FROM \"CanvasDocUpdate\";")"
psql "$BASE/postgres" -c "DROP DATABASE flowweb_restore_drill;" && echo "scratch 已清"
pm2 describe flowweb-api | grep -E "memory|restarts|uptime"'
```

预期：`canvas_docs>0`（**备份可用性证明——"备份未验证=没有备份"**；常规化演练/PITR/离机归 Y0.5/E47）+memory 在档位线内。（**v4 删手工 TOTAL_PRE**——+5 判据证据改取 **run#2 完整 stdout 中 guard pre/post 两行 JSON 的 `totalPre`/`totalPost` 字段**〔P45/P35：时机与形态都正确的载体——部署时点自动产出、可重复〕；cutover ③.5 迁移计数等式为跨目录补强——P47：run#1 stdout 中"迁移 old=N new≥N"行与 Step 1.5 探测基线对照。）落档 server-profile 附录（出口判据 1/2/4 证据）。

- [ ] **Step 6: nginx 替换+人工项收口**

按 runbook §7 执行替换（备份→删旧 block→贴入→nginx -t→reload）；检测式：

```bash
ssh -i ~/.ssh/flowweb_server ubuntu@101.42.94.107 "sudo nginx -T 2>/dev/null | grep -c 'location /collab' | xargs -I{} test {} -eq 1 && echo '唯一 /collab block ✓' || echo '存在 0 或多个 /collab block——人工核对'"
# v4.1/A7：drain 封禁检测式（/collab 唯一性测不到 deny 块落错 server/重复——功能性零后果=无人会发现，必须显式断言）
ssh -i ~/.ssh/flowweb_server ubuntu@101.42.94.107 "c=\$(sudo nginx -T 2>/dev/null | grep -c 'location = /api/drain'); [ \"\$c\" = 1 ] && echo 'drain deny 唯一 ✓' || { echo 'location = /api/drain 计数 '\$c'——核对所在 server 块（须与 /api 代理同块）'; exit 1; }"
```

（连接池 .env 手工项/swap/logrotate 按 runbook ②⑥执行——人工操作清单打印给用户确认。**v4/评四 P1-11：pm2 守护自启条件动作**——`systemctl is-enabled pm2-ubuntu` 非 enabled 时现场执行 `pm2 startup systemd -u ubuntu --hp /home/ubuntu`（输出的一条 sudo 命令需用户确认执行）+复核 is-enabled=enabled；未启用=服务器重启后进程不复活，M0[6] 采集判档。**v4.2/评五 P1-10：MinIO 部署后人工验证一行**——`curl -s -o /dev/null -w "%{http_code}" https://www.flow123.com/` 之外取一个公开页素材 URL 核 200（上传面证据；自动化冒烟登记 Y0.5 产品面批）。）

---

## Task 13: 收尾回填（Y0a 整批出口）

- [ ] **Step 1: spec 回填**——§1.4 E46 行〔Y0a-4 执行注记：ecosystem/check-ecosystem/startOrReload 幂等/authPrisma 纳管/连接池 runbook；**三客户端事实登记（v4.1/A1 半采+v4.2/B30 更正）**：单进程 PrismaClient×3（PrismaService/authPrisma/preload 临时）+main.ts preload catch 分支曾无 disconnect——**v4.1 注记"启动失败即进程退出故无害"为事实错误（实测 catch 后启动继续、该池存活整进程，已认账并在 T3 以 1 行 disconnect 收口——B30/评五 M3）**——单例化三驳维持、全部 Y0.5 连接池治理；**驳回项登记**：PrismaClient 单例化与 default 进 schema 分别登记 Y0.5/Y0c 重评〕；E69 行⑥〔ready 轮询+双客户端冒烟 P1/P21 裁定注记+E69⑥ v2 残留同步（P8）〕；§3 4.4 冒烟②〔provider 客户端形态注记+DirectConnection 跨进程不可达〕+拒重启三步〔--allow-legacy 显式档+**pre 预算自适应 90s（B19）**+post 段增补+pre 四零维持 SV11 注记〕+migrate 顺序注释〔drain 只冻结 collab 写路径——安全性由 additive 锚承担〕；§4.1 出口表〔required TD-27 分支结果+备份恢复验证+RTO 台账字段+**+3 pm2_env 口径/+5 total 口径**〕；§4.7〔M-2/M-3 执行状态〕；§4.6〔COMPACT_INTERVAL_MS 真键名+空串语义+结构锚+豁免表〕；§7.1〔max_memory_restart RSS 口径注记〕；**§2.2 移交项升级标注**：客户端消费 **write-frozen 通告+503 语义化提示**=Y0b **pre-real-user 一级阻断项**（**v4.1/J1 措辞更正**：1012 已消费〔canvasCollabRuntime:107/:837-841——计划内重启静默窗口+短退避，勿重做〕；write-frozen 零消费〔gateway:657 自注"Y0b 消费"〕；503 走通用红点失败态——发布窗口画布写被拒且用户看不到"服务正在重启"语义）。
- [ ] **Step 2: v8 目录 Y0a 行**——状态列 `Y0a-1~4 完成（2026-10-08）`+plan v3 链接+范围变更登记（N16 容量观测拆分：数值+观测本批/enforcement Y1c-3；驳回重评两项去向）。
- [ ] **Step 3: 终验**——`pnpm verify` 全绿（含 check-ecosystem+node --test scripts/）+`node scripts/doc-gate.mjs` 退出 0。
- [ ] **Step 4: Commit**——`docs(collab): Y0a-4 收尾回填——spec 执行状态/驳回登记/v8 目录 Y0a 批完成（Y0a 整批出口）`。
- [ ] **Step 5: 【请用户确认】Y0a 整批出口**——呈报四子批+总出口（§0 四条）证据；确认后 Y0a 闭合，后续=Y0b（A 类单独启动）。

---

## 出口判据对照 v3（spec §4.1 四条+强化五条——逐条可产出性已核）

| # | 判据 | 承载 | 证据形态（v3 口径修正处标注） |
|---|------|------|----------|
| 1 | 部署链 dry-run 全绿 | T7/T8/T12 | **run#2** 完整 stdout 落档（`drain 已置位/own 四零/90s 预算内收敛/ready barrier/3001 listening/post pass epoch 递增/smoke OK` 关键字链）；run#1 的 --allow-legacy 档单独标注"非判据证据（post 段 epoch 断言 N/A——P39）" |
| 2 | ecosystem+pm2 迁移+jlist 自证 | T5/T12 | startOrReload 幂等可重跑（**无 pm2 delete**）+jlist 断言（fork/1/≥45000/status online/GIT_COMMIT_HASH——独立 ssh 调用）**升级为每次部署常规门** |
| 3 | collab-core required 生效 | T11 | TD-27 重探测分支：可用=GET-merge-PUT+**int 注入点**单归因红 PR+先绿 PR 验 context；不可用=纪律代强制降级登记（**preflight int 单源链=T8 P32——裸 test:int 假绿已修，降级分支才成立**） |
| 4 | 内存档位实测落档 | T0/T12 | server-profile（六组扩采〔v3+守护自启/工具版本/PG/Redis〕+RSS 口径算式+数值推导）+部署后观测+备份恢复验证记录（URL 派生一次性） |
| +1 | 判据载体自测 | T5/T7 | **node:test 唯一入口**进 verify（T8 末步）——v4 修复后可产出：提取器配平算法（v3 单行夹具正则恒无匹配已根修）+spawn 直跑 JS 入口（Windows ENOENT 已根修）+env-file dotenv 对拍；`node --test scripts/` 在无 API 无 .env 的 CI 形态可跑 |
| +2 | 令牌分离 | T2/T12 | W23 换装：drain 不认 PROMETHEUS_TOKEN（行为断言）+服务器独立令牌就位（600 权限+E41 同源核对关闭证据） |
| +3 | 溯源 | T8/T12 | pm2_env 口径（P34/P46）：run#2 后**三方一致**——`pm2 jlist` 的 `pm2_env.GIT_COMMIT_HASH` ≡ 被执行产物 `dist/build-info.json` 的 git ≡ 本地 `git rev-parse --short HEAD`（T12 Step 2 两条自证命令；ready 无 commit 字段/V17 契约不动）；**v4 防伪造加固**：cutover ④ sha256 校验移 mv 之前（先验后换——`;` 吞错+空部署伪造+坏产物就位惰性 require 窗口三杀）；**v4.2/P46 根修**：GIT_COMMIT_HASH 由 build-info.json **产物派生**（v4 形态 rollback 时 export 当前 HEAD 给上一代 dist=判据成立结论为假——回滚后自动说实话）；cutover/rollback 体 GIT_COMMIT_HASH= 行为锚+export 白名单锚（check-ecosystem） |
| +4 | 容量观测 | T4 | yjs_loaded_documents/yjs_connection_count 进 /api/metrics+ready 授权档（**shared 类型同批改**——J-1 修复后可编译）；三数初始值入 runbook §7（引用 B21 真指标名） |
| +5 | spool 台账未丢 | T12 | total 口径（P35/J4）：guard pre/post 两行 JSON 的 `totalPre`/`totalPost` 字段（部署时点自动产出）；post 段判据=own spoolFiles===0（回灌完成）+stranded WARNING（收养异步）；**v4.2/P47 时点+目标双修**：迁移在 **cutover ③.5 内自动执行**（v4 的 run#1 前手工 rsync=--allow-legacy 无 drain+preflight 15-20min 窗口旧实例续写旧目录⇒副本陈旧而 +5 报"未丢"=假证据）+目标**树外** `/home/ubuntu/flowweb-data/collab-spool`（部署树覆盖类风险一次性取消）；Step 1.5 改只读探测落档作对照基线 |

**范围外登记（v2+v3+v4）**：PrismaClient 单例化（Y0.5 连接池治理重评——M0 实测 pg_stat_activity 据实定 connection_limit 为其半采）/env default 进 schema+前缀统一（Y0c config 对象根修）/NODE_ENV 注入+八读点审计（Y0.5=E58——runbook §8 部署姿态节先行落档现值）/COLLAB_ROLE+worker 拆分（Y0.5=E59）/payload.token+Origin 校验+cookie-only（Y0b=E13）/release 目录+软链+rsync（Y0.5 部署形态）/容量 enforcement（Y1c-3=E45/D7）/8 客户端压测曲线（Y0.5 容量批）/**客户端消费 DRAINING/503/1012（Y0b——pre-real-user 一级阻断项，spec §2.2 移交项升级标注）**/常化恢复演练+离机备份（Y0.5=E47）/**`S3Client({tls})` 无效选项——MINIO_USE_SSL 的 TLS 由 endpoint scheme 决定（v4/P45：Y0.5 env 治理终裁"删键 vs scheme 派生"；本批已 enum 化消灭反相解析）**/**`.env.production`（本地未跟踪、33 键真实凭证、零加载者——main.ts:3 只读 .env）——T12 用户确认点：删除+凭证入密码管理器+视情轮换（含 E41 残留核对联动）**。

---

## Self-Review 记录（v4.2）

1. **Spec 覆盖**：§3 Y0a-4 七工作项↔T1（4.6——MAX_LOADED_DOCS 维持=spec :502 点名预留，驳回评四/评五删除建议）/T2（W23=4.3 域旁路收口前置）/T3（4.3——含 main.ts preload catch 收口 B30）/T5（4.1）/T6+T7+T8（4.4）/T11（4.5）/T10（4.7）；N16 容量观测（Y0a-3 交接）↔T4+T9；出口四判据+强化五条↔对照表（逐条可产出性已核——+3 在 P46 build-info 后 rollback 场景为真、+5 在 P47 迁移时点修正后为真）。**驳回项全部显式登记去向**（§0.5+范围外——五轮累计）。
2. **外审消化（第五轮，三份独立报告）**：三报告共识三 P0 全部采纳（deploy_full 未定义函数×AND-OL 吞错=P48 双根修；SWITCH_BEGUN 复位死代码=C6 删复位；SHA 红相不可能红=演练带 SHA+三态断言）；readEnvFile dotenv 行内注释（P0-1/C2——本方 parse 实测四形态证实，按 B27 语义重写+九形态夹具）；C1 顺序倒置（本方 env.ts:3 实测未导出证实——Step 0 拆 0a/0b）；C4 MINIO normalize（本方裁评三方案取 normalize 不 reject）；C5 基线收口（settleEpoch）；P1 级采纳 14 条（+3 build-info/树外+③.5 迁移/shared ④/续期 r.ok/rsync 前置/指纹回显/web package.json/USED/提取器 ${#var}/PEM 去空转/新鲜度锚/export 锚/fresh=0 提示/Node≥18 门/.env.example 全键集）；**驳回 4+1 条**（§0.5 第五轮块：git 断言误报/裸 AND-OR 锚/mainJsSha 冗余/MinIO 自动冒烟改人工+子 shell 包裹改三行）；**本方两处认账**：历史破坏性迁移实为 8 文件（上轮 6=正则漏 DROP INDEX/RENAME/TYPE）、main.ts catch"无害"登记为事实错误（B30）。**元建议采纳**："片段即产物"进 TDD 纪律（本方修订过程中两次自纠——additive 伪代码一行与 jlist 三层引号嵌套——正是该纪律要防的手写转述错误实例）。
3. **探针状态**：§0.6 现 17 行——本轮新增/更新 5 行的探针中，dotenv 对拍（B27 实测输出已粘）、AND-OL（Git Bash 实测输出已粘）、build-info（设计探针=改一字节必 mismatch）、deploy_full（B28 已粘+提取锚）、dist 新鲜度（B29 实测布局已粘）均已有实测或写死红相；状态文件首采样探针与 spool ③.5 计数等式为执行期首跑探针（T7 Step 4/T12 run#1 写死）。
4. **类型/命名一致**：extractBashFunction（T5 导出=T5 test 五档自测=checkEcosystem 调用图消费）；cutover_api/rollback_api/provision_tarball（T5 骨架=T8 定稿=deploy_full 三行调用=check-ecosystem 提取锚一致）；decidePre/decidePost(body,epochPre,degraded)/epochPreFromRaw/spoolTotal/PRE_BUDGET_MS/settleEpoch（T7 内部=T12 消费一致）；readEnvFile（lib/env-file.mjs 单源=deploy-guard=preflight-int 消费+九形态对拍）；writeState {v,sha,startedAt,drainAt,degraded,epochPre,pendingBefore}（T7 写=T7 post 读一致）；build-info.json {git,builtAt}（T8 写=T8 cutover⑤/rollback⑤ 读=T12 自证=web version.json 同构）；COLLAB_SPOOL_DIR（T5 ecosystem 树外值=T8 cutover ③.5 NEW_DIR=T0 判读=T12 Step 1.5 一致）；totalPre/totalPost（T7 CLI JSON=出口 +5 口径）。
5. **占位符**：无 TBD；"执行时校准"仅存 T6 Session/TeamMember 字段名、T1 good 基线 MINIO_SECRET_KEY 长度、B29 的 dist/src 形态（rmSync+rebuild 后实测再定锚去留）。


