# teamStore 换账号失效 + 团队入口重入刷新 设计文档

日期：2026-09-08
状态：待用户审阅
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
- 不做 logout reset（全仓惯例不变，失效由 ensureTeams 的 userId 对比承担）
- 不改 `load(force)` 的 in-flight 复用逻辑（force 语义就是不复用，为同轮去重加"新鲜度判断"过度设计）
- TeamBillingPage 绕 store 直连 `getMyTeams()` 的第四条数据路径不改（其行为本就是每次进入拉取，无 #17/#18 问题）
- 登记的 Minor 项（doCreateTeam 失败文案、TeamSwitcher 错误提示丢 err.message 等）不在本次范围

## 2. 现状关键事实

| 事实 | 依据 |
|---|---|
| `load(false)` 在 `status==='success'` 时直接返回缓存，无任何失效维度 | teamStore.ts:57 |
| user 只存在于 React Context（`useAuth()`），store 自身拿不到 | AuthProvider.tsx:17-23；`user.id: string` 存在（:5） |
| 换号触发路径 = LoginModal `onLoginSuccess={() => refresh()}`（纯 SPA 无 reload）；独立登录页走 `window.location.href` 整页刷新不受影响 | LoginModal.tsx:65-68；login/page.tsx:39 |
| logout 只 `setUser(null)`，全仓生产代码零 `useTeamStore.setState` 清理 | AuthProvider.tsx:42-45；grep 佐证 |
| #18 挂载点：TeamPage.tsx:21、useTeams.ts:18 均 `ensureTeams()`；TeamSwitcher.tsx:17 同 | — |
| 消费点均在登录态保护下，调用时 user 非空有保证 | TeamSwitcher 在 TopActionBar user 非空分支（TopActionBar.tsx:113）；/team 与 works/materials 在 RequireAuth 下 |
| seq 守卫：force `++seq` 后旧请求回包丢弃、finally 不误清新句柄 | teamStore.ts:55-78 既有机制 |
| 现有测试清场四件套已调 `_internal.reset()` | 各 .test beforeEach 惯例 |

## 3. #17 设计：`ensureTeams(userId)` 必填 + 模块级 `loadedUserId`

### 3.1 store 契约变更

```ts
// 模块级，与 inFlight/seq 同层
let loadedUserId: string | null = null;

ensureTeams: (userId: string) => Promise<void>;  // 签名：无参 → 必填 userId
// userId !== loadedUserId → 换号：进入分支即记 loadedUserId，
//   set({ teams: [], status: 'loading', currentTeamId: null }) 后 load(true)（吞错）
// userId === loadedUserId → 现状 load(false)（success 短路 / in-flight 复用 / error 重试）
```

- **userId 必填**（本项目无向后兼容前提）：TS 编译期逼出全部消费点，漏传即编译错。
- **失效判定内聚 store**：组件只传"当前是谁"标量；store 与 auth 互不依赖（否决 AuthProvider 集中失效——基础层反向依赖业务 store，分层倒置；否决组件层 fetch——失效逻辑散落、credits 先例的"无短路+全局常驻"两前提 teams 均不满足）。
- `_internal.reset()` 增清 `loadedUserId`（现有测试清场四件套即覆盖，无需改清场代码）。

### 3.2 换号分支语义（逐项定死）

| 关注点 | 决策 | 理由 |
|---|---|---|
| loadedUserId 记录时机 | **进入分支即记**（非成功后记） | 失败场景两写法都正确重试（见下），进入即记少一次冗余清空 set；语义="正在为此用户服务" |
| 换号时 store 清理 | `teams: []`、`currentTeamId: null`、`status: 'loading'` | 拉取期间顶栏显示骨架而非闪现 A 的团队列表（短暂信息错乱比空白更糟） |
| localStorage 旧值 | **不主动清**，靠成功后 `normalize → persistTeamId(teams[0].id)` 覆盖 | store 模块只在加载时读一次 LS，运行期旧值不会被读到（内存 currentTeamId 已 null）；失败期间旧值无害，重试成功即覆盖 |
| 拉取成功归一化 | currentTeamId 为 null → 回落 `teams[0]`（后端排序=默认团队优先） | 符合"新会话"直觉；A、B 同属某团队场景（跨账号 currentTeamId 碰巧有效）也不再沿用 A 的选择，回落默认团队 |
| 拉取失败 | status='error'（teams 已空）；loadedUserId 保持新值 | 下次挂载同 userId → `load(false)` → error 非 success 短路 → 正常重发。无需回滚 loadedUserId |
| 竞态 | 无需新增机制 | A 的 in-flight 被 seq 守卫天然丢弃（force ++seq 后旧回包不 set、finally 不清新句柄） |

### 3.3 不变量（沿袭 2026-09-07 spec §4）

- 不在 store 内自动拉取（user 未就绪），由登录态消费者 effect 调用——本设计不改变此分工，只是签名带上 userId
- `fetchTeams()`（force）签名不变：无参、失败 reject 由调用方处理
- store 不碰 antd message；错误提示归消费组件

## 4. #18 设计：挂载点 ensure → fetch

| 挂载点 | 现状 | 改为 |
|---|---|---|
| TeamPage.tsx:21 | `ensureTeams()` | `fetchTeams().catch(() => undefined)` |
| useTeams.ts:18 | `ensureTeams()` | `fetchTeams().catch(() => undefined)`（retry 包装不变，本就是 fetchTeams） |
| TeamSwitcher.tsx:17 | `ensureTeams()` | `ensureTeams(user.id)`（**保持 ensure 语义**） |

- **TeamSwitcher 不改用 fetch**：顶栏常驻组件，路由切换重挂载（若发生）与 StrictMode 双挂载靠 ensure 的 success 短路 + in-flight 复用去重，改为 force 会使顶栏成为反复打请求的源头。换号场景由 #17 的 userId 对比覆盖（顶栏 LoginModal 是唯一纯 SPA 换号入口，必然重挂/重跑 TeamSwitcher effect）。
- **失败语义**：重入时 force 失败且已有数据 → 保留 success（静默旧数据，现有 load 错误分支行为）；首次进入失败 → error 态 + 重试按钮（现状不变）。
- **接受的取舍**（明确记录，不修）：`fetchTeams` 不复用 in-flight——
  1. /team 路由同轮 TeamSwitcher(ensure) + TeamPage(force) 可能打两次 `GET /team/mine`
  2. StrictMode 开发态 effect 双跑，TeamPage/useTeams 各打两次
  生产成本极低（轻量 GET，seq 守卫保证最终一致）；为消除它给 load 加"in-flight 新鲜度判断"违反简洁优先。
- **效果**：works/materials 从"存量同族漏洞"变为同步修复（useTeams 收编时挂载语义回归旧版"每次进页全量重拉"）。

## 5. 生产代码改动清单（全部）

| 文件 | 改动 |
|---|---|
| `stores/teamStore.ts` | `ensureTeams(userId: string)` 必填；模块级 `loadedUserId`；换号分支（清 store + load(true)）；`_internal.reset()` 增清 loadedUserId |
| `components/TeamSwitcher.tsx` | `useAuth()` 取 user；effect 改 `ensureTeams(user.id)`，依赖数组含 user |
| `pages/team/TeamPage.tsx` | 挂载改 `fetchTeams().catch(吞)` |
| `pages/workspace/hooks/useTeams.ts` | 挂载改 `fetchTeams().catch(吞)` |

不动的消费者：TeamSidebar（纯订阅+重试 fetchTeams）、TeamDetail（写操作后 fetchTeams/upsert/remove 不变）、TeamBillingPage（直连 api）。

## 6. 测试清单（TDD 执行顺序，plan 阶段细化）

| # | 步骤 | 红绿说明 |
|---|---|---|
| 1 | teamStore.test 新增换号用例：①ensureTeams(A) 成功后 ensureTeams(B) → getMyTeams 二次调用、store 清 A 数据、成功后 currentTeamId=B 的 teams[0]、LS 被覆盖 ②同 userId 二连调 → 仍 success 短路只打一次 ③换号拉取失败 → error 态；再次同 userId ensure → 重发（error 非短路） ④换号清空时序：发起前 store 已是 loading/空 teams | 未实现 loadedUserId → 新用例全红；实现 → 绿 |
| 2 | teamStore.test 既有用例机械迁移：`ensureTeams()` 全部改传 userId；`_internal.reset()` 后 loadedUserId 归 null（首调即"换号"路径，行为等同 force，注意既有 success 短路用例需先成功一次再二次调用才验短路） | 迁移即绿（行为兼容验证） |
| 3 | TeamSwitcher.test：补 `useAuth` mock（先例 TeamPage.test.tsx:30-32）；挂载断言 ensureTeams 带当前 user.id | 改造前组件不取 useAuth → 红 |
| 4 | TeamPage.test / useTeams.test：挂载行为 ensure→fetch 断言更新（getMyTeams 调用时机/次数）；useTeams error+retry 用例保绿 | 改造前红 |
| 5 | WorkspacePage.test / WorkspacePage.folder-create.test / MaterialsPage.test：核对挂载即 fetch 带来的 mock 调用次数断言，机械保绿 | 实跑为准 |

## 7. 浏览器验收清单

1. **换号**（#17 核心）：A 登录态 → 顶栏 LoginModal 切换登录 B（无 reload）→ TeamSwitcher 显示 B 的团队列表（骨架过渡，不闪 A 数据）；进入 /team 侧栏为 B 的团队；操作团队域功能无 403
2. **LS 覆盖**：换号成功后 localStorage `currentTeamId` = B 的默认团队 id
3. **被批准入团**：B 账号在别处申请、A 管理员批准 → B 会话重进 /team 侧栏出现新团队；works 页下拉同步可见
4. **被移出**：B 被移出团队 → 重进 /team 陈旧卡片消失（不可再点入 403）
5. **积分刷新**：TeamBillingPage 充值/购买后返回 /team → 侧栏卡片积分为新值（与右侧概览一致）
6. **顶栏不重复拉取**：同账号下路由来回切换，Network 面板 `/team/mine` 无新增请求（ensure success 短路生效）
7. **works/materials 重入**：进出 works 页各一次，每次进入恰一次 `/team/mine`（生产单请求）

## 8. 实现注意事项

- TeamSwitcher 改造后新增 `useAuth` 依赖——其测试文件现无 AuthProvider mock，按 TeamPage.test 先例补 `vi.mock('@/components/AuthProvider')`
- 换号分支的 `set` 与 `load(true)` 之间无 await，同步执行——React 批处理下消费组件一次重渲染见 loading 态，无中间闪烁
- `fetchTeams().catch(() => undefined)` 的吞错与 ensureTeams 内部吞错写法对齐（错误一律经 status 三态渲染，不写 unhandled rejection）
- 不做向后兼容防护（开发测试阶段无用户数据）
