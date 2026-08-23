# Plan: 打组与分镜组 Bug 修复（spec: 2026-08-23-group-bugs-fix.md）

日期：2026-08-23
状态：待确认
测试命令：`cd apps/web && pnpm test`（vitest run）；每 Task TDD 红→绿→重构→commit

## Task 1: ensureParentOrder 工具函数（Fix 1 基础）

**新建** `apps/web/src/utils/nodeOrder.ts` + `nodeOrder.test.ts`

RED — 测试用例：
1. 子在前父在后 → 重排为父前子后，其余节点相对顺序不变
2. 已满足父前子后 → 返回原数组引用（`toBe` 引用相等）
3. 无 parentId 节点 → 顺序不变
4. parentId 指向不存在节点 → 该节点照常输出（不炸）
5. 两组 + 独立节点交错 → 各组在其子节点前，独立节点保序
6. 嵌套防御：child→parent→grandparent 链，递归先输出祖先
7. 循环引用（A.parentId=B 且 B.parentId=A）→ 不抛栈溢出，按原顺序输出

GREEN — 实现：Map 索引 + 递归 visit（visited + **visiting 双 Set，visiting 命中即循环引用，直接跳过**），末尾逐 id 比较决定返回新数组或原引用。

验证：`pnpm test -- nodeOrder` → commit `feat(web): ensureParentOrder 拓扑重排工具（TD-G1）`

## Task 2: 组 action 应用父前子后（Fix 1 应用）

**修改** `apps/web/src/stores/canvasStore.ts`、`apps/web/src/stores/groupHistory.ts`

已清查全部 nodes 写入入口（grep setState/nodes: 实测），结论：
- 需 setWithParentOrder：groupNodes / mergeStoryboard / convertGroup / dropIntoGroup / addToGroup（建立父子关系）
- 需单独 ensureParentOrder：groupHistory.applySnapshot（快照恢复）
- 无需处理：ungroup / removeNodeFromGroup（清除关系不改顺序）、duplicateGroup / pasteGroupClipboard（组在前已确认）、clearStoryboard / removeStoryboardCell（删除）、toggleCollapse / refitGroupBounds / updateStoryboardConfig（只改尺寸/数据）、onNodesChange（applyNodeChanges 内部处理）、addNode / addChildNode / addImageToStoryboardCell（append 末尾组在前）
- 恢复注入入口仅两条（page.tsx:62 DB + useCanvasPersistence:43 localStorage），无 WebSocket 远端注入（Task 7 统一处理）

RED — `canvasStore.groups.test.ts` 增补（helper：断言 `nodes.findIndex(组) < nodes.findIndex(子)`）：
- groupNodes 后父前子后
- mergeStoryboard 后父前子后
- convertGroup(→storyboard) 后父前子后
- dropIntoGroup / addToGroup 后父前子后
- groupHistory undo（恢复打组前快照）后仍父前子后

GREEN：
- canvasStore 内新增 `setWithParentOrder(updater)`（包装 set，对 next.nodes 应用 ensureParentOrder）
- groupNodes / mergeStoryboard / convertGroup / dropIntoGroup / addToGroup 的组结构 set 改用它
- groupHistory.applySnapshot 的 setState 后对 nodes 应用 ensureParentOrder（独立调用，非 canvasStore 内）

验证：`pnpm test -- canvasStore.groups` + 全量回归 → commit `feat(web): 组操作后 nodes 数组父前子后（TD-G2，修复 B/C）`

## Task 3: 工具条多选隐藏（Fix 3，独立可并行验证）

**修改** 5 个节点组件：
- `ImageGenNode.tsx`：已有 isSingleSelected(77)；1074 行 `selected={selected ?? false}` → `selected={isSingleSelected}`；1276 行上传按钮 `{selected && ...}` → `{isSingleSelected && ...}`。**TransformToolbar(1046) 维持现状**——仅在 transformMode 渲染，而进入变换模式的入口（工具条"变换"按钮）被本 Fix 在多选时隐藏 → 多选状态不可达
- `MultiImageNode.tsx`：补 isSingleSelected 定义（照抄 ImageGenNode:77 写法）；201/414 行条件替换
- `TextInputNode.tsx`：已有(30)；89/200 行条件替换
- `AudioGenNode.tsx`：补定义；154/287 行条件替换
- `VideoGenNode.tsx`：已有(61 useMemo)；650/676 行条件替换

RED — 组件测试增补（ImageGenNode.test.tsx 为代表 + MultiImageNode.test.tsx 补齐组件）：
- 选中数 ≥2 时工具条不渲染（多选 mock getNodes 返回 2 个 selected）
- 单选时工具条渲染
- 选中边框（inline style）不受影响

验证：`pnpm test -- ImageGenNode MultiImageNode` → commit `fix(web): 多选时隐藏单节点工具条（TD-G3，修复 A）`

## Task 4: nodeStore→canvasStore 桥接（Fix 2a，⚠ HMR 验证节点）

**修改** `apps/web/src/stores/nodeStore.ts`：`updateConfig`、`setFileResult`、`updateMultiImageImages` 写完后同步写 canvasStore 对应节点 data（import useCanvasStore，函数体内使用）

**桥接白名单**（防高频字段引发全画布重渲染）：updateConfig 仅当 payload 含 `fileId | referenceImage | status | mediaUrl | images` 之一时桥接（均为低频图片身份字段）；setFileResult / updateMultiImageImages 直接桥接。实测 TextInputNode 打字走 updateText（不桥接），白名单为对未知 updateConfig 高频路径的防御。

RED — `nodeStore.test.ts` 增补：
- updateConfig(id, {referenceImage:'f1'}) 后 canvasStore.nodes[id].data.referenceImage === 'f1'
- updateConfig(id, {content:'x'})（非白名单字段）后 canvasStore 不触发 setState（spy 验证）
- setFileResult 后 canvasStore data 含 fileId + status:'done'
- updateMultiImageImages 后 canvasStore data.images 更新
- canvasStore 中不存在的节点 id 不报错（guard）

GREEN — 实现白名单桥接（setState map 单节点）。

**HMR 立即验证**（本 task commit 前必做）：dev 环境（已运行）修改任意文件触发热更新 → 浏览器无循环依赖错误/白屏、console 无异常；上传图片后 canvasStore.data 实时有值（eval 验证）。异常 → 切后备：canvasStore 侧普通 subscribe nodeStore（自存 prev diff）。

验证：`pnpm test -- nodeStore` + HMR 实测 → commit `feat(web): nodeStore 图片身份字段桥接 canvasStore（TD-G4a，修复 D/E 响应式）`

## Task 5: 读取端 || 归一化（Fix 2b）

**修改** `imageNodeGuards.ts`、`GroupNode.tsx:20`、`StitchButton.tsx:76`

RED — 测试：
- `imageNodeGuards.test.ts`：`{status:'done', fileId:'f1'}` → true；`{referenceImage:'ref-1'}` → true；`{fileId:'', referenceImage:'ref-1'}` → true；`{}` → false；`{fileId:''}` → false
- `StitchButton.test.tsx`：cells 节点 data 无 fileId 有 referenceImage → fileIds 收集到 referenceImage 值、无 undefined/null
- `GroupNode`（StoryboardGroupRendererCellNodes）：cellNodes fileId 取 `fileId || referenceImage`

GREEN — 三处改 `||`。

**核对项**：StoryboardCell 对 cellNodes.status 的分支逻辑——上传图节点 status='idle'，若 status 用于 loading/生成中态展示则格子渲染需一并处理（实现时打开 StoryboardCell.tsx 确认）。

验证：`pnpm test -- imageNodeGuards StitchButton` → commit `fix(web): 图片身份读取统一 fileId||referenceImage（TD-G4b，修复 D/E 及格子/拼接）`

## Task 6: 同步 payload 补 parentId（Fix 4.1）

**修改** 6 处 mergedNodes 构造（同构，各补一行 `parentId: n.parentId ?? null`）：
- ImageConfigPanel.tsx:80 / AudioConfigPanel / ImageExtConfigPanel / TextConfigPanel / VideoConfigPanel
- canvasStore.ts:493（删除同步）

RED — ImageConfigPanel 代表性测试：mock syncNodes，断言 payload 每项含 parentId 字段（有组时为组 id，无组为 null）。

GREEN — 6 处补字段。

**核对项**：删除同步时序——onNodesChange 删除路径（481-505）不含空组自动解组（自动解组仅在 deleteNode action），payload 与 store 一致；实现时复核此结论。

验证：`pnpm test -- ImageConfigPanel` → commit `fix(web): 同步 payload 携带 parentId 防抹组（TD-G5a）`

## Task 7: 快照 parentMap + 恢复补全（Fix 4.2/4.3）

**修改** `canvasSnapshot.ts`、`useCanvasPersistence.ts`、`page.tsx`

RED — 测试：
- `canvasSnapshot.test.ts`：parentMap 校验（合法/非法类型）；旧快照（无 parentMap）仍可加载
- 恢复往返：带组的 store 保存 → 清空 → localStorage 恢复 → 节点 parentId/extent 恢复 + 父前子后
- `page.test.tsx`：DB 加载节点带 parentId → canvasStore 节点含 parentId + extent:'parent'（`node.extent ?? 'parent'`）+ 顺序父前子后

GREEN：
- **新增共用辅助 `hydrateNodes(nodes, parentMap?)`**（utils/nodeOrder.ts 导出）：回填 parentMap → 有 parentId 节点补 `extent: node.extent ?? 'parent'` → ensureParentOrder。两条恢复路径统一调用（已 grep 确认无第三条注入入口、无 WebSocket 远端 setNodes）
- CanvasSnapshot 增可选 `parentMap?: Record<string,string>` + isValidPayload 宽松校验
- useCanvasPersistence：保存时从 canvasStore.nodes 提取 parentMap；恢复时调 hydrateNodes
- page.tsx loadProjectIntoStore：nodes map 后调 hydrateNodes（DB 节点自带 parentId，无 parentMap 参数）

验证：`pnpm test -- canvasSnapshot page.test` → commit `feat(web): 组关系持久化恢复——parentMap+extent+排序（TD-G5b，修复 F）`

## Task 8: 浏览器端到端验证

按 spec 验证标准 1-7 逐条（框选上传图节点→合并→格子有图→拼接；拖组跟随；点击不跳位；转分镜组可点；单选工具条正常+多选边框保留；undo/redo；打组→生成→刷新组完整）。
console 全程无 "Parent node not found"。发现问题回到对应 Task 修复。

最终：全量 `pnpm test` + `pnpm build`（tsc 严格模式）通过。

## 风险与回退

- Task 4 循环依赖/HMR 异常 → 后备 subscribe 方案（spec 已定）
- Task 7 快照结构变更向后兼容（可选字段，不升版本）；异常回退仅影响 localStorage 兜底路径
