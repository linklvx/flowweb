<!-- doc-status: historical | verified_at: n/a -->
# 团队设置页左侧团队列表（无刷新切换）设计文档

日期：2026-09-07
状态：已定稿（经三轮分节审核 + 一轮文档核验修订）

## 1. 背景与目标

团队设置页（`/team`）当前通过两个原生 `<select>` 切换团队，切换后整页 reload，多团队用户体验差。

目标：页面左侧新增团队列表面板（视觉还原用户提供的参考稿），点击卡片**无刷新切换**当前团队，右侧保留原有团队设置内容。配套：后端补 `projectCount` 统计。

不在范围（YAGNI）：
- 工作区/素材库页的团队选择仍由 URL `?teamId=` 自管理，不跟随全局当前团队（已否决的方案 C）
- 不引入 lucide-react，图标用现有 @ant-design/icons 等价替代
- 不做登出 reset（全仓 store 无此惯例，换账号窗口期由"失效回退"兜底）

## 2. 现状关键事实

| 事实 | 依据 |
|---|---|
| `currentTeamId` 纯前端记忆，后端每请求显式传 teamId，无全局团队状态 | TeamGuard 从 `req.params.id` 取；teamApi 全为 path param |
| localStorage 消费者仅 TeamSwitcher、TeamPage 两文件 | TeamSwitcher.tsx:10,17-21,32-33；TeamPage.tsx:73-74,80-83,128-129 |
| 第三个列表拉取点：useTeams hook 被 WorkspacePage/MaterialsPage 复用 | useTeams.ts:16 独立 getMyTeams |
| 后端 getMyTeams 已排序：默认团队→OWNER→创建时间 | team.service.ts:124-131；前端 useTeams.ts:26 另做 ownerFirst 重排（双轨，本次统一） |
| createTeam 前端可用字段不足以构造列表项（前端类型只取 `{id, name}`；后端返回 Prisma 原始 Team 标量行，无 memberCount/balance/projectCount） | teamApi.ts:52-57；team.service.ts:64 |
| AppLayout 父链无确定高度：min-h-screen + items-start + main flex-1 | AppLayout.tsx:20-29；TopActionBar 外层已有 `h-[60px] sticky top:topOffset` 先例（:25，topOffset=公告 64/0，AppLayout:17） |
| Tailwind `preflight: false` | tailwind.config.ts:17-19 |

## 3. 组件树（定稿）

```
TeamPage（布局壳：订阅 store 的 currentTeam/teams/status；持有 createModal 单点）
└─ 按 status 三态渲染：
   loading → sidebar 两行骨架 + 右侧「加载中…」
   error   → sidebar「加载失败+重试」(fetchTeams) + 右侧同款错误态
   success ↓
   div.flex.items-start
   ├─ TeamSidebar（w-64 shrink-0 sticky self-start overflow-y-auto；
   │    top = calc(60px + topOffset)，max-height = calc(100vh - 60px - topOffset)，
   │    topOffset 即公告偏移（64/0），从 useAnnouncementStore 读、dismiss 后响应式更新，
   │    与 AppLayout:17 同口径；用 max-height 而非固定 height（列表短时不撑满）；
   │    改动封闭在 /team，不动全局布局）
   │    · 头部：「我的团队」+ PlusOutlined 创建按钮（打开外层 createModal）
   │    · 个人项目置顶项（A1，与 TeamSwitcher 菜单模型一致：个人固定第一）
   │    · 分组「创建的团队」：CrownFilled(amber) + 计数徽标
   │    · 分组「加入的团队」：TeamOutlined(gray) + 计数徽标；空组整组（含组头）不渲染
   │    · 团队卡片：10×10 首字头像（cyan→emerald 渐变底）+ 名称（owner 加 CrownFilled）
   │      + 三统计行：TeamOutlined 成员 / FolderOutlined 项目 / SketchOutlined 积分
   │    · 选中态：bg-gradient-to-r from-cyan-500/10 to-emerald-500/10 + border-cyan-500/30
   │    · 点击卡片 → store.switchTo(id)（个人项同样走 switchTo，不造特例）
   └─ section.flex-1.min-w-0（随文档流滚动）
      └─ <TeamDetail key={team.id} team={currentTeam} onCreateTeam={() => setCreateOpen(true)} />
         ├─ team.isDefault → 个人面板（现 :160-203 搬入，删 select）
         └─ 团队管理（现 :222-495 搬入，删两个 select；tab/分页/七块数据（成员/余额/流水/限额/用量/加入申请/审计）/业务模态全内聚为本地 state）
```

### 布局要点（为什么是 sticky 而非双独立滚动）

AppLayout 父链（min-h-screen + items-start + main flex-1）无确定高度可继承，`h-full` + `overflow-y-auto` 的双独立滚动方案不成立；改全局 `items-stretch/h-screen/overflow-hidden` 会波及所有页面的滚动模型（违反精准修改）。sticky 方案：右侧滚到底时左侧列表钉在视口内，交互效果与参考稿一致，改动封闭在 TeamPage。

sticky 几何（勿照抄全局 Sidebar.tsx:65 的 `top: topOffset`——它在内容行 flex 内与 main 并排、自建 60px 内部 header；TeamSidebar 在 main 内 Outlet 流中、位于 60px 顶栏容器之后，DOM 起点不同）：
- 顶栏容器：`sticky top:topOffset + h-60`，底边 = `topOffset + 60`
- TeamSidebar 吸附位 `top = topOffset + 60`（不重叠顶栏），`max-height = 100vh - topOffset - 60`（吸附区到视口底）
- 祖先链已确认无 overflow 裁剪（AppLayout:20-29、main 均无 overflow 设置），sticky 生效无阻碍

### key 重挂载替代手动重置（简洁优先）

切换团队 = `<TeamDetail key={team.id}>` 卸载重建，tab→members、三组分页→1、七块数据清空、模态关闭全部天然归零，零闪现，一行重置代码不写。前例：WorkspacePage:64 `key={validTeamId}`（既有行为）。rename/invite/quota 模态随 detail 内聚；createModal 留外层（sidebar 与右侧共用）。

## 4. teamStore 设计（定稿契约）

```ts
// stores/teamStore.ts
const CURRENT_TEAM_ID_KEY = 'currentTeamId';
let inFlight: Promise<MyTeam[]> | null = null;
let seq = 0;

interface TeamState {
  teams: MyTeam[];                      // 信任后端排序，前端只 filter 不重排
  status: 'loading' | 'error' | 'success';
  currentTeamId: string | null;
  ensureTeams(): Promise<void>;         // success 跳过；否则拉取并复用 in-flight
  fetchTeams(): Promise<void>;          // 强制重拉：不复用 in-flight，令其失效后新发起
  switchTo(id): void;                   // set currentTeamId + 写 LS；不导航不校验
  upsert(patch: { id: string } & Partial<MyTeam>): void;  // 仅重命名（store 已有完整对象）
  remove(id): void;                     // 移除；若为当前选中 → 回退 list[0] 并写 LS
}
// 纯 selector：selectPersonalTeam（取 isDefault 项）/ selectOwnedTeams（!isDefault && isOwner）
//            / selectJoinedTeams（!isDefault && !isOwner）——只 filter，不排序
```

内部一个 `load(force)` 承载五件事：
1. **in-flight 复用（仅 ensure 路径）**：TeamSwitcher、**TeamPage 自身**与 useTeams 同轮挂载（含 StrictMode 双调用）时 `/team/mine` 只打一次（去重目标）；TeamPage 挂载必须自己调 `ensureTeams()`——页面数据拉取不应依赖另一组件恰好挂载，且其测试独立 render 无 TopActionBar；`ensureTeams = load(false)`，`fetchTeams = load(true)`
2. **force 优先级规则**：`force` 不复用进行中的 in-flight——令当前 inFlight 失效并新发起请求；旧请求回包因 seq 较小被丢弃；inFlight 句柄绑定发起时的 seq，只允许当代请求在 finally 里清自己（防止旧请求 finally 误清新句柄）。否则创建团队链路 `createTeam → fetchTeams → switchTo(newId)` 可能拿回不含新团队的旧列表
3. **seq 守卫**：每次拉取自增序号，回包序号不符即丢弃（防慢响应 A 覆盖新请求 B）
4. **发起时 status 规则**：`teams.length === 0` 才置 `loading`；已有旧数据时 force 静默刷新、不动 status（保持 success 旧数据继续渲染）——否则「重拉失败保留上下文」会被骨架屏架空；error 态点重试时 teams 为空自然回 loading，三态自洽
5. **currentTeamId 归一化**：有效保留；无效落 `list[0]` 并写 LS（收编 TeamSwitcher:17-21 解散兜底）；空列表置 null（防御保留，后端保证默认团队存在，teamApi.ts:47 注释佐证）

不变量：
- store 创建即 `loading` 初始态；**不在 store 内自动拉取**（AuthProvider user 未就绪），由登录态消费者 effect 调 `ensureTeams`
- 初始化读 LS 一次，此后只写不读（消除 TeamSwitcher:10 每渲染读 LS）；所有 LS 读写包 try/catch 静默兜底（存储禁用/隐私模式，先例 Sidebar.tsx:21-35）
- store 不碰 antd message；错误提示归消费组件订阅 error 状态（TeamSwitcher 现有 message 保留在组件层）
- **重拉失败策略**：首次加载失败 → error 终态（三态渲染兜底）；已有 teams 时强制重拉失败 → 保留旧数据、维持 success，由调用侧组件 `message.error` 提示（避免解散/转让后把整页打成 error 丢掉操作上下文）
- 无 reset action（YAGNI）：logout 不清任何 store（全仓惯例，creditsStore 亦然）；测试清场用 `useTeamStore.setState(initialState)`

### 写操作同步不变量（去 reload 后）

| 操作 | 链路 |
|---|---|
| 创建团队 | `createTeam(name) → fetchTeams() → switchTo(newId)`（前端可用字段不足以构造列表项，不手凑默认值）。**失败分支**：fetchTeams 失败（后端团队已建成功）则 `message` 提示"已创建，稍后刷新"且**不 switchTo**——新 id 不在旧列表，切过去 currentTeam 悬空 |
| 解散团队 | `disbandTeam(id) → store.remove(id)`（回退不变量在 store 内） |
| 重命名 | `renameTeam(...) → store.upsert({id, name})` |
| 转让所有权 / 审批入团（计数/角色集合变化） | `fetchTeams()` 强制重拉 |

### useTeams 收编（第三个消费者）

`useTeams()` 改为读 store 的适配层，返回形状 `{state, realTeams, retry}` 不变：
- `state` 映射 store 三态；`realTeams` 改用 `selectOwnedTeams + selectJoinedTeams` 拼接（删前端 ownerFirst 重排，统一信任后端排序）
- `retry` = `fetchTeams`
- WorkspacePage/MaterialsPage 及其测试零改动

## 5. TeamSwitcher 改造

- 删自有 useState/load/localStorage 读写/reload，订阅 store；挂载时 `ensureTeams()`（TopActionBar:113 登录分支常驻 = store 天然拉取点）
- error 时组件层 `message.error`（现状行为）
- 切换走 `switchTo`；解散回退已收进 store
- 仅默认团队时整体隐藏的逻辑保留（TeamSwitcher:27-28）

## 6. 数据契约变更

1. 后端 `getMyTeams`（team.service.ts）：`_count: { select: { members: true, projects: true } }`（现 :82），行映射加 `projectCount: m.team._count.projects`（:108-122 区域）。controller 透传不改；无 Prisma migration（关系已存在，_count 仅查询）
2. 前端 `MyTeam` 接口加 `projectCount: number`（teamApi.ts:3-14）
3. 积分 helper：`teamCreditsTotal(balance: Pick<MyTeam,'balance'>) = credits + subscriptionCredits`，放 teamApi.ts 与 MyTeam 同文件；sidebar 卡片与右侧概览统一口径（与后端 getBalanceView 的 total 同式，team-credit.service.ts:36）

## 7. TeamPage 其余改动

- 删除两个原生 `<select>`（:188-197、:260-269，含 data-testid="team-switcher"）
- 删除"还没有团队"空态分支（:148-158）：A1 下个人项目置顶恒在，空态不可达；创建入口在 sidebar 头部 + 个人面板保留"新建团队"按钮（:187）
- 右侧 header"新建团队"按钮（:259）保留（精准修改）
- 解散确认"不能解散唯一团队"判断保持**全量 teams 口径**：`store.teams.length <= 1`（含默认团队；不得写成 realTeams 口径，1 真实团队 + 1 默认团队时会误禁）
- `!teamId || !team` 加载早退（:144-146）由外层三态渲染取代

## 8. 测试清单（TDD 执行顺序）

| # | 步骤 | 红绿说明 |
|---|---|---|
| 1 | 后端 team.service.spec `getMyTeams` 两个 describe（:141 起精确 `toEqual`、:190 起排序用例）都核对匹配器类型：`toEqual` 用例的 mock `_count` 与期望对象**两侧**同补 `projects`/`projectCount`（红绿承载点）；排序用例按其匹配器补 mock 仅为干净 | 未改 service 时 toEqual 两侧补后 undefined ≠ 期望数字 → 红；改 service → 绿 |
| 2 | 前端 MyTeam 加 `projectCount` + `teamCreditsTotal` helper + teamApi.test 补 helper 断言（100+50=150，口径锁测试） | |
| 3 | **7 个**mock getMyTeams 的测试文件机械补 `projectCount`（TeamPage / TeamSwitcher / useTeams / MaterialsPage / WorkspacePage / **WorkspacePage.folder-create** / TeamBillingPage 的 .test），保绿基线 | 注：部分文件 mock 写法类型宽松（现缺必填字段未红），是否类型红以 typecheck 实跑为准；全量补齐一次迁移 |
| 4 | teamStore.test：初始化=LS 预置值且 switchTo 后改 LS 不影响 store（此后只写不读）；ensureTeams in-flight 去重（双挂载只打一次 /team/mine）；fetchTeams 强制重拉**且不复用进行中的 in-flight**（force 失效旧请求、seq 丢弃旧回包）；seq 丢弃慢响应；switchTo 写 LS 不导航；remove 当前项失效回退 list[0]；空列表→null；已有 teams 时重拉失败保留旧数据（维持 success，不进 error） | **测试隔离**：模块级 inFlight/seq 清不掉——store 导出测试专用 `_internal.reset()`（清 inFlight、seq 归零），afterEach 调用；seq 只比相对大小，跨用例递增无害，inFlight 必须清 |
| 5 | TeamSidebar.test：loading 骨架 / error 重试 / success 三态；分组渲染（个人置顶 + 创建组 + 加入组 + 计数徽标=组长度）；「加入的团队」为 0 时整组不渲染；卡片三统计；点击卡片调 switchTo；个人项点击同样 switchTo；`+` 打开创建弹窗 | |
| 6 | TeamPage 拆 TeamDetail（key 重挂载）、删两个 select 与空态分支、解散改 store.remove；TeamPage.test 迁移：select 切换用例（原 fireEvent.change select，见 TeamPage.test.tsx:118-175 区域）改点击列表项；空态用例（:127-134）改断言个人面板 + sidebar 创建入口；**集成断言：点击 B 卡片后 listMembers 以 B.id 被调用（无刷新核心承诺）** | |
| 7 | TeamSwitcher 改订阅 store 并迁移测试（localStorage mock 断言 → store 驱动）；useTeams 适配层改造，useTeams.test 保绿 | |

## 9. 浏览器验收清单

1. 左列表渲染：个人置顶 / 创建组 / 加入组 / 计数徽标 / 选中渐变态
2. 点击切换**无刷新**：右侧标题、成员、积分等数据跟随新团队；URL 不变（/team 无 teamId 参数）
3. 顶栏 TeamSwitcher 显示同步更新，无 reload
4. 创建团队 → 弹窗 → 成功后自动切到新团队且列表即时出现
5. 解散团队 → 列表移除 → 自动回退第一项；唯一团队时解散按钮禁用
6. 重命名 → 左侧列表名称即时更新
7. 公告出现/关闭时 sidebar sticky 偏移正确（64/0）
8. preflight:false 目检：卡片边框确实显示、button 无 UA 默认灰底/边框
9. 同一团队下 sidebar 卡片积分与右侧概览 total 数值一致（同口径双数据源肉眼比对）

## 10. 实现注意事项

- Tailwind preflight:false 三坑：卡片定宽+padding 显式 `box-border`；边框必须显式 border-style（index.css 无全局兜底；等价写法二选一：`border-solid` 类或 Sidebar.tsx:64 先例 `[border-right-style:solid]` 任意值类，全文件统一其一）；`<button>` 做卡片自带 `bg-transparent border-none text-left w-full cursor-pointer`（项目先例：AnnouncementBar/Sidebar 均手写此组重置）
  > 【已废止 2026-09-19】"preflight:false 三坑"已被 docs/superpowers/specs/2026-09-18-css-base-layer-theme-design.md 推翻并重开（A 段落地，三坑由 base 层接管）；本条仅存历史档。
- TeamDetail 内聚后，TeamPage.tsx 预计缩为布局壳 + createModal；新文件：`stores/teamStore.ts`、`pages/team/TeamSidebar.tsx`、`pages/team/TeamDetail.tsx`
- 不做向后兼容防护（开发测试阶段无用户数据）
