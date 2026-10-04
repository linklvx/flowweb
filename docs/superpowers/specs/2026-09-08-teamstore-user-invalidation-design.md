<!-- doc-status: historical | verified_at: n/a -->
# teamStore 换账号失效 + 团队入口重入刷新 设计文档

日期：2026-09-08
状态：已定稿（v2：吸收外部审核 P1——换号检测下沉 load + fetchTeams 必填；v3：修正 E1/E2 事实错误 + E3/E5/E6 措辞精确化；v4：plan 编写阶段发现并修正"首拉≠换号"——仅 owner 已立的真换号才清空，首拉保留 LS 记忆的 currentTeamId；v5：实现后质量审查发现并删除"成功回包统一写 owner"死赋值——owner 确立全部在入口分支）
关联登记：上线必修项 #17、#18（project_launch_blockers memory，2026-09-08 team-settings-sidebar 任务审查发现）
取代：2026-09-07-team-settings-sidebar-design.md §1 YAGNI 第 3 条（"换账号窗口期由失效回退兜底"——理由经推演不成立）与 §4.1 相关取舍（TeamPage 挂载 ensure 的 success-skip——他人侧变更不可见的连带后果）

## 1. 背景与目标

两个同族 bug，根因均为 teamStore 的 `load(false)` success 短路无用户/时间维度失效：

- **#17 换账号 store 陈旧**：登出不清 store（全仓惯例）+ 顶栏 LoginModal 登录另一账号走纯 SPA `refresh()` 无 reload → teamStore 仍是 A 的数据（success 态）→ TeamSwitcher 重挂载 `ensureTeams` 命中 success 短路直接跳过 → B 看到 A 的团队列表/currentTeamId，切换后团队域 API 全 403。localStorage `currentTeamId` 也跨账号残留。
- **#18 团队入口重入不刷新**：TeamPage / useTeams（works、materials）挂载只调 `ensureTeams()`，success 态跳过拉取 → 他人侧变更（被批准入团/被移出/充值）对当前会话不可见；被移出后陈旧卡片可点 → TeamDetail 七块数据 403 unhandled。

目标：
1. store 以用户为失效维度——换账号即强制重拉，彻底消除跨账号残留
2. 团队入口页挂载即新鲜——TeamPage / works / materials 每次进入拿到最新团队列表

不在范围（YAGNI）：
- 不做 logout reset（全仓惯例不变，失效由 userId 对比承担）
- 不改 in-flight 复用逻辑（force 语义就是不复用，为同轮去重加"新鲜度判断"过度设计）
- 不为重入静默失败引入前端监控上报（前端未装 @sentry/react——后端已有 @sentry/nestjs 10.x，前端 SDK 本次不引入；静默旧数据由下次成功拉取自愈）
- TeamBillingPage 绕 store 直连 `getMyTeams()` 的第四条数据路径不改（本就每次进入拉取，无 #17/#18 问题）
- 登记的 Minor 项（doCreateTeam 失败文案、TeamSwitcher 错误提示丢 err.message 等）不在本次范围

## 2. 现状关键事实

| 事实 | 依据 |
|---|---|
| `load(false)` 在 `status==='success'` 时直接返回缓存，无任何失效维度 | teamStore.ts:57 |
| user 只存在于 React Context（`useAuth()`），store 自身拿不到 | AuthProvider.tsx:17-23；`user.id: string` 存在（:5） |
| 换号触发路径 = LoginModal `onLoginSuccess={() => refresh()}`（纯 SPA 无 reload）；独立登录页走 `window.location.href` 整页刷新不受影响 | LoginModal.tsx:65-68；login/page.tsx:39 |
| logout 只 `setUser(null)`，全仓生产代码零 `useTeamStore.setState` 清理 | AuthProvider.tsx:42-45；grep 佐证 |
| #18 挂载点：TeamPage.tsx:21、useTeams.ts:18 均 `ensureTeams()`；TeamSwitcher.tsx:17 同 | — |
| 消费点均在登录态保护下，调用时 user 非空有保证 | TeamSwitcher 在 TopActionBar user 非空分支（TopActionBar.tsx:113）；/team 与 works/materials 在 RequireAuth 下；RequireAuth loading 期不渲染 children |
| AppLayout 中 TopActionBar（:26）先于 Outlet（:28），ensure 恒先于页面 force 执行——但这是隐式 JSX 顺序，不可作为正确性依赖（组件测试独立 render、/canvas 类不套布局页面均打破） | AppLayout.tsx:26-28；TeamPage.tsx:20 注释自证独立 render；router.tsx:51 /canvas 不套布局先例 |
| seq 守卫：force `++seq` 后旧请求回包丢弃、finally 不误清新句柄 | teamStore.ts:55-78 既有机制 |
| 现有测试清场四件套已调 `_internal.reset()` | 各 .test beforeEach 惯例 |
| 后端 getMyTeams 无 N+1：1 次主查询（findMany 单 JOIN：balance/subscriptions/_count）+ 默认团队至多 1 次 userSubscription 查询（默认团队每用户唯一） | team.service.ts:68-107 |

## 3. #17 设计：`ensureTeams(userId)` / `fetchTeams(userId)` 均必填 + 模块级 `loadedUserId`

### 3.1 store 契约变更

```ts
// 模块级，与 inFlight/seq 同层
let loadedUserId: string | null = null;

// 换号检测内聚 load——ensure 与 fetch 两条路径统一经过：
const load = (force: boolean, userId: string): Promise<MyTeam[]> => {
  if (loadedUserId !== userId) {
    const isSwitch = loadedUserId !== null;   // 首拉（owner 未立）≠ 换号
    loadedUserId = userId;               // 进入即记（见 3.2）
    if (isSwitch) set({ teams: [], currentTeamId: null, status: 'loading' });  // 仅真换号清
    force = true;                        // 首拉/换号均必强制
  }
  if (!force) {
    if (get().status === 'success') return Promise.resolve(get().teams);
    if (inFlight) return inFlight;
  }
  const mySeq = ++seq;
  const request = getMyTeams().then((teams) => {
    if (mySeq === seq) set({ ...normalize(teams), status: 'success' });
    return teams;
  }, /* 错误分支不变 */);
  /* inFlight 句柄绑定当代 seq、finally 守卫——全部不变 */
};

ensureTeams: (userId: string) => load(false, userId).then(noop, noop),  // 永不 reject
fetchTeams: (userId: string) => load(true, userId).then(() => undefined), // 失败透传
```

- **两个 action 均 userId 必填**（本项目无向后兼容前提）：TS 编译期逼出全部调用点，漏传即编译错。失效判定内聚 store，组件只传"当前是谁"标量；store 与 auth 互不依赖。
- **换号检测下沉 load**（v2，吸收审核 P1）：fetch 首拉也走换号分支——独立 render（无 TopActionBar 的测试）或未来不套 AppLayout 的登录态页面（/canvas 先例）以 fetch 为首拉时同样确立归属，消除对"TopActionBar 先于 Outlet"隐式 JSX 顺序的依赖。否则 owner 滞后 → 后续 ensure 误判换号 → 清空已拉列表、闪骨架、重复请求（无数据错乱，seq 兜底，但难排查）。
- **owner 确立全部在入口分支（v5 修正）**：任何 `loadedUserId` 变更必伴随 `++seq`（入口分支置 force=true 必达发请求），旧回调因 seq 不符整体跳过——成功回包内无需（也不会有效）再写 owner。原 v2 吸收的"成功回包统一写 owner"经实现后质量审查证明为死赋值，已删除；force 路径（含独立 render 首拉）的归属确立同样发生在入口进入即记处。
- `_internal.reset()` 增清 `loadedUserId`（现有测试清场四件套即覆盖）。

### 3.2 换号分支语义（逐项定死）

| 关注点 | 决策 | 理由 |
|---|---|---|
| loadedUserId 记录时机 | **换号分支进入即记** + 成功回包幂等确认 | 进入即记扛住 StrictMode 双 effect：若成功才记，第二发仍判"换号"再次 force（双请求+双清空）；进入即记后第二发走同人路径，非 success 态复用 in-flight。成功回包再记一次对 ensure 幂等，对 force 路径是唯一确立时机 |
| 换号时 store 清理 | **仅真换号**（owner 已立：`loadedUserId !== null`）才 `teams: []`、`currentTeamId: null`、`status: 'loading'`；**首拉（owner=null，含整页刷新后 LS 记忆恢复）不清 currentTeamId** | 拉取期间不闪现 A 的团队列表（顶栏 TeamSwitcher 在 loading 态回落文字占位「团队」，侧栏走骨架——实现说明）。首拉不清的理由：整页刷新后 currentTeamId 来自 LS 恢复，清掉会丢失用户上次选中的团队；归一化沿用既有"有效保留"规则（teamStore.test 既有用例锁定此契约） |
| localStorage 旧值 | **不主动清**，靠成功后 `normalize → persistTeamId(teams[0].id)` 覆盖 | store 模块只在加载时读一次 LS，运行期旧值不会被读到（内存 currentTeamId 已 null）；失败期间旧值无害，重试成功即覆盖 |
| 拉取成功归一化 | currentTeamId 为 null → 回落 `teams[0]`（后端排序=默认团队优先） | 符合"新会话"直觉；A、B 同属某团队场景不再沿用 A 的选择，回落默认团队 |
| 拉取失败 | status='error'（teams 已空）；loadedUserId 保持新值 | 下次挂载同 userId → `load(false, userId)` → error 非 success 短路 → 正常重发。无需回滚 loadedUserId |
| 竞态 | 无需新增机制 | A 的 in-flight 被 seq 守卫天然丢弃（force ++seq 后旧回包不 set、finally 不清新句柄）；A 在途时 B 进来必走换号分支 force，不复用 A 的 in-flight。乱序/失败组合下由**最新代 seq 负责终态**：旧代成功被丢弃、旧代失败不置 error（错误分支 `mySeq === seq` 守卫），两发竞争无论谁先回包最终一致 |

### 3.3 不变量（沿袭 2026-09-07 spec §4，变更项加粗）

- 不在 store 内自动拉取（user 未就绪），由登录态消费者 effect 调用
- **`fetchTeams(userId)` 必填、失败 reject 由调用方处理**（原：无参）
- store 不碰 antd message；错误提示归消费组件
- **同账号登出再登入**：SPA 内存不丢，owner 仍为该用户 → TeamSwitcher 重挂 `ensureTeams(userId)` 走 success 短路不重拉；数据保鲜由 #18 入口页 force 承担（显式取舍：同号重登场景顶栏不主动刷新，进入 /team、works、materials 时拉新）
- **重入 force 失败静默保留旧数据**：不引入前端监控上报（前端未装 @sentry/react，YAGNI），由下次成功拉取自愈；error 三态兜底仅覆盖 teams 为空的失败

## 4. #18 设计：入口页挂载 ensure → fetch

| 挂载点 | 现状 | 改为 |
|---|---|---|
| TeamPage.tsx:21 | `ensureTeams()` | `fetchTeams(user.id).catch(() => undefined)` |
| useTeams.ts:18 | `ensureTeams()` | `fetchTeams(user.id).catch(吞)`（retry 包装同步改带参） |
| TeamSwitcher.tsx:17 | `ensureTeams()` | `ensureTeams(user.id)`（**保持 ensure 语义**，effect 以 `if (user)` 门控——渲染位置虽保证非空，组件独立测试不保证） |

- **TeamSwitcher 不改用 fetch**：顶栏常驻组件，路由切换重挂载与 StrictMode 双挂载靠 ensure 的 success 短路 + in-flight 复用去重；换号场景由 userId 对比覆盖（顶栏 LoginModal 是唯一纯 SPA 换号入口，TeamSwitcher 在 TopActionBar `user ?` 分支内登出即卸载、登录必重挂）。
- **失败语义**：重入时 force 失败且已有数据 → 保留 success（静默旧数据）；首次进入失败 → error 态 + 重试按钮（现状不变）。
- **接受的取舍**（明确记录，不修）：force 不复用 in-flight——
  1. /team 同轮 TeamSwitcher(ensure) + TeamPage(force) 打两次 `GET /team/mine`
  2. StrictMode 开发态 effect 双跑，TeamPage/useTeams 各打两次
  生产成本极低（轻量 GET，seq 守卫保证最终一致，后端已核验无 N+1）；为消除它给 load 加"in-flight 新鲜度判断"违反简洁优先。

### fetchTeams 全部既有调用点（必填迁移，均登录态组件内机械改）

| 调用点 | 取 userId 方式 |
|---|---|
| TeamSidebar.tsx:83（error 重试） | 新增 `useAuth()` |
| TeamPage.tsx:36（创建后刷新）/ :62（error 重试按钮） | **新增 `useAuth()`**（TeamPage 当前无 useAuth，仅 TeamDetail:50 有） |
| TeamDetail.tsx:287 / :300 / :367（写操作后同步） | 已有 `useAuth()`（:50） |
| useTeams.ts retry | 新增 useAuth 或经参数注入（plan 定，倾向组件内自取，与挂载同源） |

## 5. 生产代码改动清单（全部）

| 文件 | 改动 |
|---|---|
| `stores/teamStore.ts` | `load(force, userId)` 承载换号检测；`ensureTeams(userId)` / `fetchTeams(userId)` 必填；成功回包写 owner；模块级 `loadedUserId`；`_internal.reset()` 增清 |
| `components/TeamSwitcher.tsx` | `useAuth()` 取 user；effect 改 `if (user) void ensureTeams(user.id)`，依赖数组含 user |
| `pages/team/TeamPage.tsx` | **新增 `useAuth()` 取 user**；挂载改 `fetchTeams(user.id).catch(吞)`；:36（创建后）/:62（重试）两处调用点带参 |
| `pages/team/TeamSidebar.tsx` | :83 重试带参（新增 useAuth） |
| `pages/team/TeamDetail.tsx` | :287/:300/:367 三处 fetchTeams 带参 |
| `pages/workspace/hooks/useTeams.ts` | 挂载与 retry 改 `fetchTeams(user.id)`；**删除不再使用的 ensureTeams 选择器引用** |

不动的消费者：TeamBillingPage（直连 api）。

## 6. 测试清单（TDD 执行顺序，plan 阶段细化）

| # | 步骤 | 红绿说明 |
|---|---|---|
| 1 | teamStore.test 新增换号用例：①ensureTeams(A) 成功后 ensureTeams(B) → getMyTeams 二次调用、store 清 A 数据、成功后 currentTeamId=B 的 teams[0]、LS 被覆盖 ②同 userId 二连调 → success 短路只打一次 ③换号拉取失败 → error 态；再次同 userId ensure → 重发（error 非短路） ④**fetchTeams(X) 首拉（owner 为 null）成功后 owner=X：随后 ensureTeams(X) 走短路不重拉**（P1 核心回归） ⑤A 在途时 B 的 ensure 进来 → A 回包被 seq 丢弃、B 数据生效 ⑥换号清空时序：发起前 store 已是 loading/空 teams | 未实现 loadedUserId → 新用例全红；实现 → 绿 |
| 2 | teamStore.test 既有用例机械迁移：`ensureTeams()`/`fetchTeams()` 全部改传 userId；`_internal.reset()` 后 loadedUserId 归 null（首调即走换号分支=force 行为；success 短路用例需先成功一次再二连调才验短路） | 迁移即绿（行为兼容验证） |
| 3 | TeamSwitcher.test：补 `useAuth` mock（先例 TeamPage.test.tsx:30-32）；挂载断言 ensureTeams 带当前 user.id；user 为 null 时不调用 | 改造前组件不取 useAuth → 红 |
| 4 | TeamPage.test / useTeams.test：挂载行为 ensure→fetch 断言更新（success 态重进页面 getMyTeams 再次被调=force 生效）；useTeams error+retry 用例保绿 | 改造前红 |
| 5 | TeamSidebar.test（重试带参）/ TeamDetail 相关既有用例核对；WorkspacePage.test / WorkspacePage.folder-create.test / MaterialsPage.test 核对挂载即 fetch 的 mock 次数断言，机械保绿 | 实跑为准 |

## 7. 浏览器验收清单

1. **换号**（#17 核心）：A 登录态 → 顶栏 LoginModal 切换登录 B（无 reload）→ TeamSwitcher 显示 B 的团队列表（骨架过渡，不闪 A 数据）；进入 /team 侧栏为 B 的团队；操作团队域功能无 403
2. **LS 覆盖**：换号成功后 localStorage `currentTeamId` = B 的默认团队 id
3. **被批准入团**：B 账号在别处申请、A 管理员批准 → B 会话重进 /team 侧栏出现新团队；works 页下拉同步可见
4. **被移出**：B 被移出团队 → 重进 /team 陈旧卡片消失（不可再点入 403）
5. **积分刷新**：TeamBillingPage 充值/购买后返回 /team → 侧栏卡片积分为新值（与右侧概览一致）
6. **顶栏不重复拉取**：同账号下路由来回切换，Network 面板 `/team/mine` 无新增请求（ensure success 短路生效）
7. **works/materials 重入**：进出 works 页各一次，每次进入恰一次 `/team/mine`（生产单请求）
8. **硬刷新 /team 首屏恰两发**（已接受取舍的显式断言）：F5 后 Network 中 `/team/mine` 恰 2 次（TeamSwitcher ensure 换号首发 + TeamPage force），均为 200、最终渲染正确
9. **同号重登**：登出后同账号再登录（LoginModal 路径）→ Network 无 `/team/mine` 新增（owner 未变短路）；随后进 /team 有一次（入口 force）

## 8. 实现注意事项

- TeamSwitcher / TeamSidebar 改造后新增 `useAuth` 依赖——TeamSwitcher.test 按 TeamPage.test 先例补 `vi.mock('@/components/AuthProvider')`；TeamSidebar.test 若 setState 种状态路径不触发请求则无需 mock（实跑为准）
- 换号分支的 `set` 与 `load` 主干之间无 await，同步执行——React 批处理下消费组件一次重渲染见 loading 态，无中间闪烁
- `fetchTeams(user.id).catch(() => undefined)` 的吞错写法与 ensureTeams 内部吞错对齐（错误一律经 status 三态渲染，不写 unhandled rejection）；TeamDetail 写操作后同步的 fetchTeams 沿用各处现有 catch 处理
- 后端零改动：getMyTeams 已核验无 N+1（主查询单 findMany JOIN + 默认团队至多 1 次订阅查询），频次上升量级（每页进入 +1 GET）可忽略，不加缓存。附带微任务（plan 中独立小步）："至多 1 次"依赖**每用户唯一默认团队**不变量，在 team.service.ts:91 isDefault 分支处加一行注释固化前提，防未来放开多 default 时静默退化为逐行查询
- 不做向后兼容防护（开发测试阶段无用户数据）
