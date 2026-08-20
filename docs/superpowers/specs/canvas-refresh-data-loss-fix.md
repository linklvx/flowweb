# Spec: 画布刷新数据丢失与崩溃修复

日期：2026-08-20（v4，含三轮评审修订）
状态：已确认（v3 评审条件通过：补充 localStorage 解析守卫即进入实施）

## 背景与根因（已通过浏览器复现 + 诊断日志实锤）

### Bug 1：首页"开始创作"的画布，添加节点后刷新内容丢失

**根因**：[page.tsx:83-88](apps/web/src/pages/canvas/page.tsx) —— `/canvas` 无 `projectId` 查询参数时，`ensureProject()` **无条件创建新项目**。`flowweb_projectId` 只写从不读。刷新 → 新 projectId → localStorage key（`flowweb_canvas_{projectId}`）绑定新 id 无数据 → 内容丢失。首页"开始创作"还主动 `removeItem('flowweb_projectId')`（home/index.tsx:31）。

### Bug 2：工作空间创建的画布，添加节点后刷新页面崩溃

报错：`TypeError: Cannot read properties of undefined (reading 'prompt') at ImageFullscreenViewer.tsx`

**根因链**（四层缺陷叠加，诊断日志实锤）：

1. **数据层缺陷**：节点实时数据只存 localStorage，从未写入数据库。ConfigPanel 同步用的是硬编码 `syncNodes('default', ...)`（AudioConfigPanel.tsx:159 等 5 处），projectId 错误导致写库从未成功 → DB 中该项目节点数恒为 0。
2. **时序层缺陷**：main.tsx 使用 `React.StrictMode`，dev 下 page.tsx 的 useEffect 双执行 → `loadProjectIntoStore` fetch 两次 → 快的 fetch 先返回并触发挂载/恢复，**慢的 fetch 迟到返回后用 DB 空数据无条件覆盖已恢复的 store**。
3. **污染层缺陷**：useCanvasPersistence 的 nodeStore 订阅无条件把（被清空的）nodeStore 写回 `flowweb_canvas_content_{projectId}` → localStorage 被污染为 `{}` → ErrorBoundary recreate 循环中恢复 effect 读到污染数据 → 永久崩溃循环。
4. **防御层缺陷**：ImageGenNode 把可能为 undefined 的 nodeData 直接传给 ImageFullscreenViewer；viewer 组件体内 `nodeData.prompt?.text`（L110，组件 return 前执行，与 open 状态无关）对 nodeData 本身无可选链保护 → TypeError。

## 修复范围

### Fix 1：恢复最近项目 + 失效分级降级（Bug 1）

`/canvas` 无 query 参数时：
- 读取 `localStorage.flowweb_projectId`，若存在则用该 id 走 `loadProjectIntoStore` 恢复（与 query 参数路径相同）
- 仅当 key 不存在时才 `ensureProject()` 新建
- 首页"开始创作"保持现有 `removeItem` 行为（明确开始新创作时清空）

**失效分级降级**（前提：`loadProjectIntoStore` 必须先修复 fetch 对 HTTP 错误不 reject 的问题——现状 `json.code !== 0 → return '未命名项目'` 是静默成功路径，catch 永远不会触发，需改为检查 `res.status` 后抛类型化错误）：

| 失败类型 | 行为 |
|------|------|
| 404（项目已删除）/ 403（无权限） | 清除 `flowweb_projectId` → fallback `ensureProject()` 新建 → `message.warning('上次的画布已不存在，已为你新建')` |
| 网络错误 / 5xx / 超时 | **保留 key**，显示错误态（"加载失败" + 重试按钮 + "新建画布"次级按钮），不自动清数据——localStorage 数据绑定旧 projectId，清掉即变孤儿 |

query 参数路径（工作空间进入）失败时同样适用该分级，但不涉及清 key（URL 参数不受 localStorage 影响），仅错误态展示。

### Fix 2：防御 nodeData undefined（Bug 2 崩溃止血，双层）

- **上游**：ImageGenNode 组件内 `if (!nodeData) return null;`（置于全部 hooks 调用之后，遵守 hooks 规则）
- **下游**：ImageFullscreenViewer 组件体内 nodeData 改为可选访问（`nodeData?.prompt?.text` 等 4 处）

### Fix 3：消除迟到空响应覆盖（Bug 2 时序根因，双重防护）

**防护 1（请求守卫）**：page.tsx 的 useEffect 使用 cleanup cancelled 标志，丢弃过期 fetch 响应。语义：**最后一次 effect 发起的 fetch 生效，已取消的前次响应不写入 store**。

**防护 2（DB 空数据守卫，方案 A）**：`loadProjectIntoStore` 写入 store 前判定：

```ts
// 脏数据防御：解析失败 = 无本地数据（守卫不触发，退化为正常写入空），并清除脏 key
// 注意：key 格式为 flowweb_canvas_content_{projectId}，projectId 在末尾，不能用 endsWith('_content') 判定，
// 由调用处显式传入 isContentKey
function safeParseLocalNodes(key: string, isContentKey: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return isContentKey
      ? Object.keys(parsed).length > 0
      : parsed?.nodes?.length > 0;
  } catch {
    localStorage.removeItem(key);
    return false;
  }
}

const dbNodesEmpty = !(project.nodes?.length);
const canvasHasNodes = useCanvasStore.getState().nodes.length > 0;
const localHasNodes = safeParseLocalNodes(`flowweb_canvas_${projectId}`)
  || safeParseLocalNodes(`flowweb_canvas_content_${projectId}`);

if (dbNodesEmpty && (canvasHasNodes || localHasNodes)) {
  // 跳过画布数据写入（nodes/edges/viewport/nodeStore）。
  // loadProjectIntoStore 不写任何 project 元数据 store，元数据由调用方消费返回值处理。
  return project.name || '未命名项目';
}
```

判定条件说明：
- **localStorage 检查是主路径**：生产环境（无 StrictMode）fetch 执行时 CanvasPageInner 未挂载，canvasStore 恒为空，只能靠 localStorage 判定
- **canvasStore 检查覆盖 StrictMode 迟到场景**（与防护 1 冗余，纵深防御）
- **两个 key 都检查**：canvas key（节点位置/连线）与 content key（节点配置）任一非空即代表本地有数据
- **返回值语义**：`loadProjectIntoStore` 返回 `Promise<string>`（项目名），调用方（page.tsx then）只用于 setProjectId/setProjectName，不消费 nodes——跳过写入无下游影响

### Fix 4：阻止 localStorage 污染（Bug 2 数据止血）

useCanvasPersistence 的 nodeStore 订阅写入前判断：若 store 为空 `{}` 且 localStorage 现值非空，则跳过写入。

**边界分析（幽灵节点不成立的理由）**：用户删光节点时，canvasStore 订阅（无守卫）会正常把 `{nodes:[]}` 写入 canvas key → 刷新时 `data.nodes.length === 0` 跳过 nodes 恢复 → React Flow 渲染由 canvasStore 驱动 → 节点不会回来。content key 残留的只是 nodeStore 侧数据，无 UI 影响。不引入 lastAction 标志。

### 不在本次范围（仅指出，另开任务）

- ConfigPanel 硬编码 `'default'` projectId 的写库错误（涉及 5 个面板 + 保存流程）
- localStorage 持久化架构（双 store 两份独立数据）
- nodeStore 订阅写入防抖（P2 技术债：加防抖需配套 beforeunload flush，避免引入 500ms 内刷新丢输入的新风险）
- localStorage key 版本化 + schema 校验（P2 技术债）
- nodeData undefined 时的节点占位 UI（P2 UX 债：当前 `return null` 为空白，可换 Spin/文案占位）

## 验收标准

1. 首页"开始创作" → 添加节点 → 刷新 → 节点还在
2. 工作空间新建画布 → 添加节点 → 刷新 → 节点还在、无崩溃
3. localStorage 中 projectId 对应项目已删除（404）→ 刷新 → 自动新建画布 + 警告提示，不卡"加载画布..."
4. 后端 5xx / 网络错误 → 刷新 → 显示错误态与重试按钮，**不清除 `flowweb_projectId`**，重试成功后数据恢复
5. 刷新后 nodeData 不为 undefined（无 TypeError）
6. 既有测试全部通过（`pnpm test`）
7. 每个修复点有对应失败测试先行（TDD）

## 测试策略

- **Fix 1**：page.test.tsx —— ① 无 query 参数且 localStorage 有 projectId 时不调创建 API、走加载路径；② 404 时清 key、fallback 创建、显示警告；③ 网络错误/5xx 时进入错误态、保留 key、不自动新建、可重试
- **Fix 2**：① ImageGenNode 测试 —— nodeStore 无对应节点时渲染 null 不抛错；② ImageFullscreenViewer.test.tsx —— nodeData=undefined 时不抛错
- **Fix 3**：page.test.tsx —— ① effect 重复执行时，已取消的前次响应不覆盖当前状态（模拟 fetch A 慢、fetch B 快，A 后返回被忽略）；② DB 返回空节点且 localStorage 任一 key 有数据时，不覆盖 store；③ DB 返回空节点且本地也无数据时，正常写入空（新建画布首载场景）
- **Fix 4**：useCanvasPersistence 单测 —— nodeStore 空对象不覆盖非空 localStorage；非空 store 正常写入
