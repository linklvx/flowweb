<!-- doc-status: historical | verified_at: n/a -->
# Plan: 创建画布链路统一 + 默认命名 + 项目切换混淆修复

日期：2026-08-20
对应 Spec：docs/superpowers/specs/canvas-create-unify-fix.md（v2，已确认）
状态：待确认

## 涉及文件

| 文件 | 改动 |
|------|------|
| apps/web/src/pages/canvas/page.tsx | Fix 5：lastPidRef 清空 store；Fix 6：ensureProject → createCanvas API |
| apps/web/src/pages/canvas/page.test.tsx | Fix 5/6 测试 + 既有用例响应形状更新 |
| apps/api/src/modules/canvas/dto/create-canvas.dto.ts | Fix 7：name 放宽 `@Length(0, 255)` |
| apps/api/src/modules/canvas/canvas.service.ts | Fix 7：空名编号分支（advisory lock + max N 查询）+ 响应加 name；Fix 8：getNextUntitledName |
| apps/api/src/modules/canvas/canvas.service.spec.ts | Fix 7/8 测试 + 既有 create 断言更新 |
| apps/api/src/modules/canvas/canvas.controller.ts | Fix 8：`GET /canvases/next-untitled-name` |
| apps/web/src/api/canvasApi.ts | CreateCanvasResult 加 name；新增 getNextUntitledName |
| apps/web/src/pages/workspace/components/CreateCanvasModal.tsx | Fix 8：打开时请求预填 |
| apps/web/src/pages/workspace/__tests__/Modals.test.tsx | Fix 8 测试 + 既有用例适配预填异步 |

## 实施备注（Spec 确认时钉死）

- **advisory lock 必须在事务内、编号查询前**：`tx.$executeRaw` 作为空名分支第一条语句，与 INSERT 同事务，事务结束自动释放；非空名不取锁
- **备注 1（P2 记录，本次接受）**：Fix 5 清空 + canvasStore 500ms 防抖，fetch > 500ms 时防抖可能把 `{nodes:[]}` 写入旧 key——content key 受 Fix 4 守卫保护、节点配置不丢，概率极低，接受；彻底方案（清空时抑制订阅）记 P2
- **备注 2（决定不做）**：modal 预填请求的 200ms 防抖不做——只读 GET、每次打开 1 次请求，开销可忽略（简洁优先）
- page.test 的 mock 走全局 `fetch`，apiFetch 底层同样是全局 fetch + `/api` 前缀，现有 mock 断言方式兼容

## 任务分解（TDD：每任务先写失败测试 → 红 → 实现 → 绿）

### Task 1：Fix 5 — 项目切换清空 store（Bug 3 根因，独立先做）

1. 红：page.test.tsx 新增：
   - 用例 A（跨项目切换）：render `?projectId=pa`（mockCanvasNodes 含 P_a 残留节点）→ 完成渲染后 rerender 换 router 到 `?projectId=pb`（MemoryRouter 换 initialEntries，CanvasPage 不 remount、pid 原地变化）→ 断言切换后首个 `useCanvasStoreSetState` 调用携带空 nodes（清空先于加载）
   - 用例 B（同项目 retry 不清空）：`?projectId=p1` 网络错误 → 点重试（同 pid）→ 无空 nodes 的 setState
   - 用例 C（无参新建路径清残留）：mockCanvasNodes 有残留 + localStorage 无 key → 创建路径也先清空
2. 绿：CanvasPage 加 `lastPidRef = useRef<string | null>(null)`；effect 内**同步段**（异步加载前）：
   ```ts
   const storedId = queryProjectId || localStorage.getItem(PROJECT_ID_KEY);
   const target = storedId ?? null;
   if (target === null || target !== lastPidRef.current) {
     useCanvasStore.setState({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
     useNodeStore.setState({ nodes: {} });
   }
   lastPidRef.current = target; // 同步更新，不依赖加载结果——失败后 retry 不二次清空
   // 再走异步加载/创建
   ```
   - `lastPidRef` 在清空后同步赋值（非 finish 时）：finish 是成功回调，网络错误不执行，否则 retry 时 `p1 !== null` 再次成立 → Test B 失败
   - `target === null` 分支必须保留：remount 后 ref 归零，无参新建（首页"开始创作"路径）时 `target === lastPidRef === null`，若只判 `!==` 则不清残留 → Bug 3 原始复现路径仍在；代价是新建失败 retry 会再次清空（store 已空，幂等无害）
   - store 形状（已核实）：canvasStore 只清 `nodes/edges/viewport`（[canvasStore.ts:64](apps/web/src/stores/canvasStore.ts:64) 还有 selectedId/pendingMediaFile/nodeProcessMap/projectId，不动）；nodeStore 只清 `nodes`（[nodeStore.ts:268](apps/web/src/stores/nodeStore.ts:268) 形状为 `{ nodes: Record<string, AppNode>, activeTransformNodeId, ... }`，不动 active*）
3. 验证：`pnpm --filter @flowweb/web test -- page`

### Task 2：Fix 7 — 后端默认名编号 + 响应 name（含 DTO 放宽）

1. 红：canvas.service.spec.ts ——
   - 既有 2 个 create 用例断言更新：result 加 `name: '新画布'`；tx mock 增加 `$executeRaw`/`template.findMany`
   - 新用例：空名 `''` → 事务内先 `$executeRaw`（advisory lock）→ findMany 无匹配 → 名 `未命名项目1`，project/template 均用该名
   - 新用例：findMany 返回 `['未命名项目1','未命名项目3','我的画布']` → 名 `未命名项目4`
   - 新用例：空白名 `'  '` 走编号分支
   - 新用例：非空名 → `$executeRaw` 未被调用、findMany 未被调用、name 原样返回
2. 绿：
   - DTO：`@Length(1, 255)` → `@Length(0, 255)`
   - service.create：事务内 `if (!name?.trim())` → `await tx.$executeRaw\`SELECT pg_advisory_xact_lock(hashtext(${'canvas_untitled:' + userId}))\`` → 私有 `nextUntitledName(tx, userId)`（findMany where userId select name，正则 `^未命名项目(\d+)$` 取 max）→ finalName 用于 project+template；返回值加 `name: finalName`
3. 验证：`pnpm --filter @flowweb/api test -- canvas.service`

### Task 3：Fix 6 — 首页创建统一走 canvases API（依赖 Task 2 的 name）

1. 红：page.test.tsx ——
   - '无参且 key 不存在时新建' 断言 POST 目标为 `/api/canvases`（不再 `/api/projects`）
   - createOkResponse 形状改为 `{ templateId, projectId: 'new-pid', name: '未命名项目4' }`；断言 `localStorage.flowweb_projectId === 'new-pid'`
   - beforeEach 默认 mockResponse 补 `templateId/projectId`（旧形状只有 `id`，apiFetch 返回后 projectId 为 undefined 会卡 loading）
   - 404 fallback 用例适配新响应形状
2. 绿：page.tsx 删除 `ensureProject`，改 `createCanvas('', null)`（'@/api/canvasApi'）→ `.then(({ projectId, name }) => { localStorage.setItem(PROJECT_ID_KEY, projectId); finish(projectId, name); })`；两处调用（无 key 创建 + 404 fallback）同步替换
3. 验证：`pnpm --filter @flowweb/web test -- page`

### Task 4：Fix 8 — next-untitled-name 接口 + modal 预填（依赖 Task 2 helper）

1. 红：
   - service.spec：`getNextUntitledName(userId)` 复用编号查询（无锁）——空 → 1；1,3 → 4
   - Modals.test.tsx：`vi.mock('@/api/canvasApi')` ——
     - 用例 A：open → `waitFor` 输入框预填 `未命名项目4` → 不输入直接确定 → `onOk('未命名项目4', folderId)`
     - 用例 B：请求 reject → 输入框空 → 确定按钮禁用（现状必填校验）
     - 既有用例适配：先 `waitFor` 预填完成再输入自定义名（消除异步竞态）
2. 绿：
   - controller：`@Get('next-untitled-name')` → `canvasService.getNextUntitledName(userId)` → `{ name }`（当前控制器无任何 GET 路由无冲突；声明时放在动态路由之前，防将来加 `@Get(':id')` 时被吞）
   - service：`getNextUntitledName` 公有方法（用 this.prisma，不取锁）
   - canvasApi：`getNextUntitledName()` → `apiFetch<{ name: string }>('/canvases/next-untitled-name')`
   - Modal：open effect 内 `getNextUntitledName().then((d) => setName((prev) => prev || d.name)).catch(() => {})`——函数式更新，仅输入框仍为空时预填，避免 fetch 完成前覆盖用户已输入的内容；失败静默不预填
3. 验证：`pnpm --filter @flowweb/api test -- canvas` + `pnpm --filter @flowweb/web test -- Modals`

### Task 5：全量回归 + 浏览器验收

1. `pnpm test`（web + api 全量）
2. 浏览器验收（Spec 验收标准 1/2/3/3b/4）：
   - 首页"开始创作" → 名为"未命名项目N" → 工作空间根目录可见
   - 工作空间 modal 预填"未命名项目N+1"，可修改
   - 首页创建 P_a 加节点 → 工作空间新建 P_b → P_b 空、P_a 重开节点还在
   - 3b：修复前污染画布清 localStorage key 后重开 → 空画布
   - 已有 1、3 → 下一个 4；全删后从 1 开始
3. 清理复现污染数据（受影响画布或其 localStorage key）

## 风险与回退

- 无 schema/迁移变更（advisory lock 是运行时 SQL），回退 = revert 提交
- DTO 放宽仅影响 create 入口；name 字段为响应新增，useWorkspaceData 忽略多余字段，无破坏
- Modal 预填失败降级为现状（空输入 + 必填），新接口挂掉不影响 modal 可用
- 既有用例 3 处断言更新均对应有意的行为变更（响应形状/URL/预填异步），非放松断言

## 提交策略

每 Task 一个提交，沿用仓库 feat/test 分离风格（git log：`feat(web):` / `test(web):` / `feat(api):`）：
- `fix(web): clear canvas stores on project switch`（Task 1）
- `feat(api): backend untitled numbering with advisory lock`（Task 2）
- `feat(web): homepage creation via canvases api`（Task 3）
- `feat(web,api): prefill next untitled name in create modal`（Task 4）
