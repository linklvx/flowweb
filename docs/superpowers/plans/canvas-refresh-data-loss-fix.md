# Plan: 画布刷新数据丢失与崩溃修复

日期：2026-08-20
对应 Spec：docs/superpowers/specs/canvas-refresh-data-loss-fix.md（v4）
状态：待确认

## 涉及文件

| 文件 | 改动 |
|------|------|
| apps/web/src/pages/canvas/components/nodes/ImageFullscreenViewer.tsx | Fix 2 下游：nodeData 4 处可选链 |
| apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx | Fix 2 上游：`!nodeData` early return（hooks 之后） |
| apps/web/src/pages/canvas/hooks/useCanvasPersistence.ts | Fix 4：nodeStore 订阅空对象守卫 |
| apps/web/src/pages/canvas/page.tsx | Fix 1 + Fix 3：恢复最近项目、分级降级、cancelled 守卫、DB 空守卫、错误态 UI |
| apps/web/src/pages/canvas/page.test.tsx | Fix 1/3 测试 |
| apps/web/src/pages/canvas/hooks/__tests__/useCanvasPersistence.test.ts（新建） | Fix 4 测试 |
| apps/web/src/pages/canvas/components/nodes/ImageFullscreenViewer.test.tsx | Fix 2 测试补充 |

## 任务分解（TDD：每任务先写失败测试 → 红 → 实现 → 绿）

### Task 1：Fix 2 — nodeData undefined 防御（独立止血，最简单先做）

1. 红：ImageFullscreenViewer.test.tsx 新增 —— `nodeData={undefined}` 渲染不抛错（open=true 场景验证组件体执行）
2. 红：ImageGenNode 相关测试 —— nodeStore 无该节点 id 时渲染 null（若 ImageGenNode 无独立测试文件，通过 page 级测试或新建最小测试验证；ImageGenNode 依赖重（socket/antd/io），新建独立测试成本高，改为在 ImageFullscreenViewer 层测 + ImageGenNode 改动保持一行由 page.test 回归覆盖）
3. 绿：ImageGenNode `if (!nodeData) return null;`（全部 hooks 之后）；viewer 4 处 `nodeData?.`
4. 验证：`pnpm --filter @flowweb/web test -- ImageFullscreenViewer`

### Task 2：Fix 4 — localStorage 防污染守卫

1. 红：新建 useCanvasPersistence.test.ts：
   - 用例 A：nodeStore setState 为 `{}` 时，非空 content key 不被覆盖
   - 用例 B：nodeStore 非空时正常写入
2. 绿：订阅回调加守卫（store 空 && 现值非空 → 跳过）
3. 验证：`pnpm --filter @flowweb/web test -- useCanvasPersistence`

### Task 3：Fix 3 — loadProjectIntoStore 双防护

1. 红：page.test.tsx 新增：
   - 用例 A：effect 重复执行（fetch A 慢、fetch B 快），A 后返回不写 store
   - 用例 B：DB 空 nodes + localStorage 任一 key 有数据 → store 不被覆盖
   - 用例 C：DB 空 nodes + 本地也空 → 正常写入空 nodes（新建首载）
   - 用例 D：content key 为截断 JSON → 不抛错、脏 key 被清除、正常写空
2. 绿：
   - page.tsx useEffect 加 cleanup cancelled 标志
   - loadProjectIntoStore 加 safeParseLocalNodes + DB 空守卫（spec v4 伪代码）
3. 验证：`pnpm --filter @flowweb/web test -- page`

### Task 4：Fix 1 — 恢复最近项目 + 分级降级 + 错误态

**重试机制选型（方案 A）**：`retryKey: number` state，重试按钮 `setRetryKey(k => k+1)`，useEffect 依赖 `[searchParams, retryKey]` → effect 重跑复用全部加载逻辑，cancelled 守卫天然支持。

**两条路径共用错误态**：
- `loadError` state + 错误态 UI 放 CanvasPage 顶层，有参/无参路径共享
- 有参路径（现状 page.tsx:79 无 catch）**必须补 catch → setLoadError**，否则改造后 unhandled rejection
- 有参路径 404/403：错误态展示，**次级按钮为"返回工作空间"**（navigate('/works')），不做清 key/自动新建
- 无参路径 404/403：清 key + fallback 新建 + message.warning；网络/5xx：错误态 + 重试 + "新建画布"次级

**三态切换清单**：
- 加载开始：`setLoading(true)` + `setLoadError(null)`
- 成功：`setLoading(false)`
- 失败：`setLoading(false)` + `setLoadError(err)`
- 重试：`setRetryKey(k => k+1)`（effect 重跑回到 loading）

1. 红：page.test.tsx 新增：
   - 用例 A：无 query 参数 + localStorage 有 projectId → 不调创建 API、走加载路径
   - 用例 B：无 query + key 不存在 → ensureProject 新建（现有行为回归）
   - 用例 C：无参 404 → 清 key、fallback 新建、message.warning
   - 用例 D：无参网络错误/5xx → 错误态（重试按钮）、key 保留、不自动新建
   - 用例 E：错误态点重试成功 → 正常进入画布
   - 用例 F：**有参路径 404 → 错误态 + "返回工作空间"按钮，不清 key 不新建**
   - 用例 G：**加载失败后 loading 态消失（"加载画布..."不再渲染）**
2. 绿：
   - loadProjectIntoStore 检查 `res.status`：404/403 → throw ProjectInaccessibleError；!res.ok 其他 → throw NetworkError（命名内部用）；fetch reject → NetworkError
   - CanvasPage：`loading` / `loadError` / `retryKey` state + 三态渲染（loading 态 / 错误态 / 画布）
   - 无参分支：读 key → 有则 loadProjectIntoStore（catch 分级处理）→ 无则 ensureProject
   - fallback 新建与原加载放在同一 async 流程内，loading 保持 true 直到新建完成（避免 catch 里置 false 又置 true 的闪烁），仅在最终成功或网络错误时 setLoading(false)
3. 验证：`pnpm --filter @flowweb/web test -- page`

### Task 5：全量回归 + 浏览器验收

1. `pnpm test`（全仓库）
2. 浏览器验证验收标准 1/2/4：
   - 首页"开始创作"→ 添加节点 → 刷新 → 节点还在
   - 工作空间新建画布 → 添加节点 → 刷新 → 节点还在无崩溃
   - （如可行）删除项目后刷新 → 自动新建 + 提示
3. 清理调试遗留 localStorage 脏 key

## 风险与回退

- 改动集中在前端 4 文件，无 schema/API 变更，回退 = revert 提交
- ImageGenNode early return 位置必须遵守 hooks 规则（放全部 hooks 后），lint 会校验
- cancelled 守卫不改变生产环境单 fetch 行为（守卫只在重复执行时生效）

## 提交策略

每 Task 一个提交：`test(web): ...` + `fix(web): ...` 或合一提交（遵循仓库现有 feat/test 分离风格，见 git log）
