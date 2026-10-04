# Spec: 创建画布链路统一 + 默认命名 + 项目切换混淆修复

日期：2026-08-20
状态：待确认
前置：上一轮 canvas-refresh 修复已随 localStorage 链路退役（决策与清账见 tech-debt.md TD-5/6 行；文档已删，见 DELETED.md）

## 问题清单

### Bug 3：项目切换混淆（已复现实锤 + 数据污染实锤）

**现象**：首页"开始创作"创建画布 P_a 并添加节点 → SPA 返回工作空间 → 新建画布 P_b → **P_b 显示 P_a 的节点**，且 P_a 的节点被持久化到 P_b 的 localStorage（跨项目数据污染，复现时 P_b 的 key 里写入了 P_a 的 `node_1787231497213_1`，坐标 x:-17）。

**根因**：canvasStore/nodeStore 是模块级 zustand 单例，**无 reset 方法**。SPA 客户端导航（画布 → 工作空间 → 新画布）时上一项目节点残留：
1. `loadProjectIntoStore(P_b)`：DB 空 → Fix 3 DB 空守卫检查 `canvasStore.nodes.length > 0` → **残留节点骗过守卫** → 跳过清空写入
2. 恢复 effect：guard `nodes.length > 0` → 跳过恢复
3. 残留节点渲染 + 500ms 防抖把 P_a 节点写入 P_b 的 localStorage key

### 需求 1：创建链路统一

**现状不一致**：
- 首页"开始创作" → `POST /api/projects`（裸 CanvasProject，**无 Template**）→ 不出现在工作空间列表
- 工作空间"新建画布" → `POST /api/canvases`（CanvasProject + DRAFT Template + folderId）→ 出现在列表

**目标**：首页创建统一走 `POST /api/canvases`（folderId=null，根目录），画布在工作空间根目录可见。

### 需求 2：默认命名"未命名项目N"

**规则**（用户已确认）：
- 编号 = 该用户名下所有画布中匹配 `^未命名项目(\d+)$` 的最大 N + 1，无匹配则为 1；**删除后不复用**
- 编号由**后端生成**（name 为空/空白时），保证并发与多端一致
- 工作空间"新建画布" modal：打开时**预填**下一个默认名（从后端接口获取，见 Fix 8），用户可修改
- 首页"开始创作"：不弹窗，直接以空名创建（后端编号），进入画布

## 修复设计

### Fix 5：项目切换清空 store（Bug 3 根因）

CanvasPage 的加载 effect 中：用 useRef 记录上次处理的 projectId，本次目标 projectId 与上次不同时，**先清空** canvasStore（nodes/edges/viewport）与 nodeStore（nodes），再走加载/恢复流程。

**时序约束**：清空必须在 `loadProjectIntoStore` 之前（否则 DB 空守卫仍会被残留欺骗）。

**场景核对**：
- 同项目网络错误重试（retryKey 重跑，pid 不变）→ **不清空**（保留已恢复数据）
- SPA 从画布 → 工作空间 → 再进同一画布（重新 mount，ref 归零）→ 清空 → DB/localStorage 重新加载 ✓ 数据无损
- 带参 P_b 新项目 → 清空 → DB 空 + P_b 本地无数据 → 正常写空 → 空画布 ✓
- 带参 P_a（已有 localStorage 数据）→ 清空 → DB 空 + localHasNodes=true → 守卫跳过 → 恢复 effect 恢复 ✓

### Fix 6：首页创建统一走 canvases API（需求 1）

- page.tsx 的 `ensureProject()` 替换为 `createCanvasApi('', null)`（POST /api/canvases，空名触发后端编号）
- 响应需含 `{ templateId, projectId, name }` → `localStorage.setItem(PROJECT_ID_KEY, projectId)` → finish(projectId, name)
- Fix 1 的 404 fallback 新建路径同步替换
- home/index.tsx 的 `onStartCreate`（removeItem + navigate）保持不变

### Fix 7：后端默认名编号（需求 2）

- `CreateCanvasDto.name` 校验放宽为 `@Length(0, 255)`（当前 `@Length(1, 255)` 会把空名挡成 400，Fix 6 依赖空名走编号）
- `canvas.service.create`：name 为空/空白时走编号分支——事务内先取 PG advisory lock（`pg_advisory_xact_lock(hashtext('canvas_untitled:'+userId))`，事务结束自动释放）串行化同用户的编号计算，再查询该 userId 下全部 Template 名字，正则 `^未命名项目(\d+)$` 取最大 N，生成 `未命名项目{N+1}`（无匹配为 1）
- 响应体增加 `name` 字段（空名/非空名均返回最终名）
- 并发策略：advisory lock 使同用户并发空名创建串行，消除 read-modify-write 竞态；非空名不取锁、允许重名（保持现状，与 save/rename 一致）
- 弃用 `@@unique([userId, name])` + P2002 重试方案：Template.name 还被 save() 与 renameCanvas（updateTemplate）写入，全局唯一索引会使这些路径重名时抛未处理 P2002 → 500；禁止自定义重名是额外 UX 变更；migrate 历史断裂下 db push 有部署与存量重名数据风险
- 已知边界：两次打开 modal 拿到同一预填名并同时提交，或预填名与并发空名创建撞车，会产生同名画布（与自定义重名现状一致，接受）

### Fix 8：工作空间 modal 预填默认名（需求 2）

前端列表算不出正确编号：useWorkspaceData 画布列表分页（PAGE_SIZE=20，load-more）且按当前文件夹过滤，而编号规则取用户**全量**画布的 max N；modal 当前也未接收画布列表。故预填名由后端提供：

- 新增 `GET /api/canvases/next-untitled-name` → `{ name }`，复用 Fix 7 的编号查询（只读，不取锁）
- CreateCanvasModal 打开时请求该接口并预填输入框；用户可修改；请求失败不预填（维持现状：空输入 + 必填校验）

### Fix 9：StrictMode 双创建去重（验收中发现，2026-08-20 补充）

**现象**：dev 模式首页"开始创作"一次点击 → 后端收到 2 次 POST → 创建 2 个画布，前端只渲染第二个，第一个成为工作空间孤儿"未命名项目N"。

**根因**：`React.StrictMode`（main.tsx）dev 下将 effect 双执行（挂载→模拟卸载→重挂载）。创建 POST 在 effect 内发起，`cancelled` 标志只能挡 UI 更新、撤不回已发出的 HTTP 请求。工作空间 modal 是按钮 onClick 不受影响；旧 `ensureProject` 路径同样双创建，但孤儿无 Template 不可见，Fix 6 统一后才暴露。生产构建无此问题（StrictMode 双执行仅 dev），但必须修。

**修复**：StrictMode 双执行发生在同一组件实例（refs 保留）。`createPromiseRef` 共享创建 Promise——run#1 发起并存入 ref，run#2 `??=` 复用同一 promise → 仅 1 次 POST，run#2 finish 生效。失败时 catch 内清空 ref，重试（retryKey）可重新创建。无参创建与 404 fallback 两处调用统一走共享 helper；真路由切换（remount）ref 自然重置。

**测试**：page.test —— React.StrictMode 包裹的无参创建路径断言 POST /api/canvases 恰好 1 次且画布正常渲染；创建失败后重试能重新 POST 并成功。

## 不在本次范围

- 已产生的脏数据清理——**不会自愈**：Fix 5 只清内存 store，已被污染的画布（如 P_b 的 localStorage key 存有 P_a 节点）加载时，DB 空守卫会因污染 key 跳过写空、恢复 effect 又把污染数据读回。当前无生产用户，开发阶段手动处理（清除对应 localStorage key 或删除受影响画布，验收见 3b）；上线前如需自动清理再评估数据迁移
- DB 中无 Template 的孤儿 CanvasProject 由现有 `cleanDrafts`（24h 无 template 清理）回收
- ConfigPanel 硬编码 'default' 写库错误（延续上一轮的 defer）

## 验收标准

1. 首页"开始创作" → 新画布名为"未命名项目N"（N 按规则）→ 返回工作空间，根目录可见该画布
2. 工作空间"新建画布" modal 预填"未命名项目N+1"，可修改
3. 首页创建 P_a 加节点 → 工作空间新建 P_b → **P_b 是空画布**（无 P_a 节点），P_a 数据不丢失（重新打开 P_a 节点还在）
3b. 手动验证（脏数据）：修复前已被污染的画布，清除其 localStorage key 后重开 → 显示空画布（确认污染仅在 localStorage、DB 干净）
4. 编号规则：已有"未命名项目1、3"→ 下一个为 4；全部删除后重新从 1 开始
5. 既有测试全部通过 + 新增用例 TDD 先行

## 测试策略

- **Fix 5**：page.test —— 先渲染 P_a（带节点残留）→ 路由切换到 P_b → 断言 canvasStore 被清空/不渲染 P_a 节点；retry 场景（同 pid）不清空
- **Fix 6**：page.test —— 无参创建断言 POST /api/canvases（不再 POST /api/projects）+ localStorage 存 projectId
- **Fix 7**：canvas.service.spec —— 空名/空白名走编号且事务内取 advisory lock；空名→"未命名项目1"；已有 1,3→"未命名项目4"；非未命名名不影响编号、不取锁；响应含最终 name。并发正确性（锁互斥）属集成级，以代码评审 + 手动验收为准
- **Fix 8**：CreateCanvasModal 测试 —— 打开时请求 next-untitled-name 并预填；请求失败不预填、必填校验仍生效
