# 实施计划：ImageGen 底部面板 v2.1 — Phase 1

> 参考 Specs：`docs/superpowers/specs/imagegen-bottom-panel-v2.1.md`
> 模式：TDD（RED → GREEN → REFACTOR）
> 代理：subagent-driven-development（独立 subagent 执行每个 Step）

---

## Step 1：依赖安装

- **操作**：`pnpm add @tiptap/extension-mention@2 @tiptap/extension-placeholder@2`
- **验证**：`npx tsc --noEmit` 无新错误
- ✅ **已完成**

---

## Step 2：nodeStore 重写（subagent: 独立 worktree）

### RED — 写测试（先于代码）

**文件**：`apps/web/src/stores/nodeStore.test.ts`（全量重写）

```
测试用例：
1.  初始状态 nodes 为空对象 {}
2.  addNode — 添加 text 节点，可读取 nodes[id].data.content
3.  addNode — 添加 image 节点，检查所有默认值（style/model/quality/ratio/status/prompt）
4.  addNode — node 包含 id/type/position 元数据
5.  updateNodeData — 部分更新保留未修改字段
6.  updateNodeData — 更新 image 节点 model/ratio/quality
7.  updateNodeData — 更新 text 节点 content
8.  updateText — 便捷方法等同 updateNodeData(id, { content })
9.  updateConfig — 便捷方法等同 updateNodeData(id, config)
10. setStatus — 更新 status 字段
11. setFileResult — 设置 fileId + status='done'
12. deleteNode — 删除后 nodes[id] 为 undefined
13. getNodeData — 存在返回数据，不存在返回 undefined
14. updateNodeData 操作不存在的节点 ID → 不抛错，静默返回
15. getNodeData 不存在的节点 → 返回 undefined
16. ⚡ deleteNode 异步完成 → 等待资源清理后再校验 nodes[id] === undefined
```

### GREEN — 实现

**文件**：`apps/web/src/stores/nodeStore.ts`（全量重写）

```typescript
// 核心结构
interface AppNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  selected?: boolean;
  dragging?: boolean;
  data: TextNodeData | ImageNodeData | VideoNodeData;
}

// 类型守卫（强化类型安全）
function isImageNode(node: AppNode): node is AppNode & { data: ImageNodeData } { ... }
function isTextNode(node: AppNode): node is AppNode & { data: TextNodeData } { ... }

// addNode: 接受完整 AppNode，设置默认 position
// updateNodeData: 合并 Partial<T> 到 nodes[id].data，不存在时静默返回
// updateText/updateConfig: 严格字段约束，禁止传入非法属性
// deleteNode: 异步，清理资源后删除
```

### REFACTOR

- 用 `isImageNode`/`isTextNode` 替代所有 `as any` 类型断言
- 提取重复的 `getNode` 逻辑为内部工具函数
- 便捷方法增加严格类型参数约束

---

## Step 3：useReactFlowSync hook（subagent: 独立 worktree）

### RED — 写测试

**文件**：`apps/web/src/pages/canvas/hooks/useReactFlowSync.test.ts`（新建）

```
测试用例：
1. Store 变化时 reactFlowNodes 同步更新
2. position change → store updateNodeData 调用
3. select change → store 更新 selected 字段
4. remove change → store deleteNode 调用
5. ⚡ 双向同步防循环：store 更新 → ReactFlow setNodes 仅当数据真正变化时触发
6. ⚡ 防循环：ReactFlow onNodesChange → store 更新仅处理 position/select/remove
```

### GREEN — 实现

**文件**：`apps/web/src/pages/canvas/hooks/useReactFlowSync.ts`（新建）

- Store → ReactFlow：`useEffect` + `useRef` 浅比较防重复更新
- ReactFlow → Store：`handleNodesChange` 仅处理 position/select/remove
- 异常捕获：同步失败时 `console.error` 但不崩溃

### REFACTOR

- `useMemo` 缓存 map 结果，减少不必要渲染
- 提取 `nodesToReactFlow` / `changeToStore` 纯函数便于测试

---

## Step 4：批量适配 13 个消费者（subagent: 独立 worktree）

**核心改动**：`nodes[id]` → `nodes[id]?.data`，`nodes[id].field` → `nodes[id]?.data.field`

### 文件清单

| # | 文件 | 改动点 |
|---|------|--------|
| 1 | `nodes/ImageGenNode.tsx` | 用 `isImageNode` 守卫替代 `as any` |
| 2 | `nodes/ImageGenNode.test.tsx` | mock 适配 `AppNode` 嵌套结构 |
| 3 | `nodes/VideoGenNode.tsx` | 同上 |
| 4 | `nodes/VideoGenNode.test.tsx` | 同上 |
| 5 | `nodes/VideoConfigPanel.tsx` | 同上 |
| 6 | `nodes/VideoConfigPanel.test.tsx` | 同上 |
| 7 | `nodes/TextInputNode.tsx` | 用 `isTextNode` 守卫替代类型断言 |
| 8 | `nodes/TextInputNode.test.tsx` | 同上 |
| 9 | `nodes/TextConfigPanel.tsx` | 同上 |
| 10 | `nodes/TextConfigPanel.test.tsx` | 同上 |
| 11 | `canvas/page.tsx` | `loadProjectIntoStore` 构建 `AppNode` |
| 12 | `canvas/page.test.tsx` | mock 适配 |
| 13 | `canvas/hooks/useCanvasPersistence.ts` | 适配嵌套结构 |

### 验证

- 每个文件适配后跑对应测试
- 全部适配后 `npx tsc --noEmit` 零错误

### REFACTOR

- 统一 `useNodeStore` 选择器模式：封装 `useNodeData<T>(id)` 通用 hook 减少重复

---

## Step 5：types.ts + CommandMentionList（subagent: 独立 worktree）

### 5a — types.ts

**文件**：`apps/web/src/pages/canvas/components/nodes/prompt-input/types.ts`（新建）

- ImageItem, PromptValue, CommandItem 接口
- COMMANDS 常量（8 条指令）
- CATEGORY_DEFAULTS 常量

### 5b — CommandMentionList（RED → GREEN → REFACTOR）

**RED — 测试文件**：`.../CommandMentionList.test.tsx`

```
测试用例：
1. renders items grouped by category with headers
2. highlights item at selectedIndex
3. calls onSelect on click
4. renders nothing when items array empty
5. does not crash with single item
6. ⚡ keyboard: ArrowDown advances selectedIndex, wraps to first
7. ⚡ keyboard: ArrowUp retreats selectedIndex, wraps to last
8. ⚡ keyboard: Enter calls onSelect with highlighted item
9. ⚡ keyboard: Escape calls onClose
```

**GREEN — 实现文件**：`.../CommandMentionList.tsx`

- Props: items, selectedIndex, onSelect, onClose
- 按 category 分组渲染（model/ratio/quality 三组）
- 高亮 selectedIndex，点击触发 onSelect
- 内置键盘监听（↑↓EnterEsc）

**REFACTOR**：`useMemo` 缓存分组结果

---

## Step 6：PromptInput（subagent: 独立 worktree）

### RED — 测试文件

**文件**：`.../PromptInput.test.tsx`

```
测试用例：
1. renders Tiptap editor with placeholder
2. typing triggers debounced store update（fake timers）
3. /command popup appears when typing "/"
4. selecting command inserts chip + updates store
5. deleting command chip restores store default
6. Ctrl+Enter triggers onGenerate callback
7. ⚡ keyboard: / popup → ArrowDown/ArrowUp/Enter/Esc 行为正确
8. ⚡ no crash when editor ref is null（安全守卫）
```

### GREEN — 实现文件

**文件**：`.../PromptInput.tsx`

核心逻辑：
- useEditor：StarterKit(仅基础) + Placeholder + Mention('/')
- Mention suggestion：原生 DOM popup（createRoot + position:fixed），不用 tippy.js
- 指令选中：insertContent(chip) + onCommandSelect → updateConfig
- Chip 删除：editor.on('transaction') 检测删除的 command node → 恢复 CATEGORY_DEFAULTS
- Ctrl+Enter：preventDefault + onGenerate
- 异常处理：指令插入失败时 `console.error` + 不崩溃

### REFACTOR

- 提取 `createNativeSuggestionRenderer` 为独立工具函数
- 提取 `syncChipDeletion` 为独立 hook

---

## Step 7：ImageConfigPanel 集成（subagent: 独立 worktree）

### RED — 测试文件

**文件**：`.../ImageConfigPanel.test.tsx`（重写）

```
测试用例：
1. renders PromptInput
2. displays read-only model/ratio/quality from store
3. generate button disabled when status='loading'
4. generate button disabled when prompt text is empty
5. generate button enabled when prompt has text
```

### GREEN — 实现文件

**文件**：`.../ImageConfigPanel.tsx`

布局：PromptInput + 设置栏（model/ratio/quality 只读）+ 生成按钮

### REFACTOR

- 提取 `SettingsBar` / `GenerateButton` 为小组件
- `useCallback` 包装事件处理器

---

## Step 8：CSS + 全量回归

### CSS（组件级隔离）

不使用全局 `index.css` 追加，改为创建独立样式文件：

**文件**：`apps/web/src/pages/canvas/components/nodes/prompt-input/PromptInput.css`（新建）

```css
/* 仅作用于 .prompt-input 命名空间下 */
.prompt-input .command-popup { ... }
.prompt-input .command-category { ... }
.prompt-input .command-item { ... }
.prompt-input .command-item.selected { ... }
.prompt-input .prompt-editor { ... }
```

组件内通过 `import './PromptInput.css'` 引入。

### 回归

```bash
pnpm test          # 前端全部通过
cd apps/api && npx vitest run  # 后端全部通过
npx tsc --noEmit   # 类型检查零错误
```

---

## Subagent 分配策略

```
Step 2 (nodeStore)      ──→ subagent-1 (worktree)
Step 3 (useReactFlowSync) ──→ subagent-2 (worktree) [与 Step 2 并行]
Step 4 (13 consumers)    ──→ subagent-3 (worktree) [依赖 Step 2]
Step 5 (types + CommandMentionList) ──→ subagent-4 (worktree) [依赖 Step 2]
Step 6 (PromptInput)     ──→ subagent-5 (worktree) [依赖 Step 5]
Step 7 (ImageConfigPanel) ──→ subagent-6 (worktree) [依赖 Step 6]
Step 8 (CSS + regression) ──→ main agent [依赖全部]
```

## 优化清单（已补充至各 Step）

| # | 优化项 | 应用到 |
|---|--------|--------|
| 1 | REFACTOR 环节 | Step 2-7 均补充 |
| 2 | 类型守卫 `isImageNode`/`isTextNode` | Step 2, Step 4 |
| 3 | 样式文件隔离（PromptInput.css） | Step 8 |
| 4 | 键盘交互测试 + 防循环测试 + 异步删除测试 | Step 2/3/5/6 |
| 5 | 容错处理（不存在节点静默返回、异常 console.error） | Step 2, Step 6 |

## 时间估算

| Step | 预计时间 |
|------|---------|
| Step 2 (nodeStore) | 20 min |
| Step 3 (useReactFlowSync) | 15 min |
| Step 4 (13 consumers) | 25 min |
| Step 5 (types + CommandMentionList) | 15 min |
| Step 6 (PromptInput) | 25 min |
| Step 7 (ImageConfigPanel) | 15 min |
| Step 8 (CSS + regression) | 10 min |
| **Total** | ~125 min |
