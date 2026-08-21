# Plan: TD-2 allImages 双轨统一 + TD-1 projectId 硬编码修复

日期：2026-08-21
对应 Spec：docs/superpowers/specs/td2-allimages-unify-td1-projectid-fix.md（rev3，已确认）
状态：待确认

## 涉及文件

| 文件 | 改动 |
|------|------|
| apps/web/src/pages/canvas/components/nodes/prompt-input/useImageUpload.ts | A-1：getLatestAllImages 读根级（1 行） |
| apps/web/src/pages/canvas/components/nodes/prompt-input/useImageUpload.test.ts | mock 基建修正（updateFn 写根级、make 工厂移根级）+ 新增 2 类测试 + 既有用例适配 |
| apps/web/src/pages/canvas/components/nodes/VideoConfigPanel.tsx | A-2：allImages 根级变量 + 7 处替换（210/213/249/252/256/260/270） |
| apps/web/src/pages/canvas/components/nodes/VideoConfigPanel.test.tsx | 160-168 用例改根级数据 + 新增 useImageUpload mock 与 nodeStore getState + 粘贴上限/生成路径测试 |
| apps/web/src/pages/canvas/components/nodes/TextConfigPanel.test.tsx | 新增生成路径 projectId 测试（C4：文件已确认存在） |
| apps/web/src/stores/nodeStore.ts | A-3：deleteNode deleteRefs 合并去重 |
| apps/web/src/stores/nodeStore.test.ts | 新增 deleteRefs 3 个用例 |
| apps/web/src/api/imageNodeApi.ts | buildImageGenParams 加 opts + fallback 链；submitGeneration 透传 opts（S1） |
| apps/web/src/api/imageNodeApi.test.ts | vi.mock canvasStore + projectId 3 用例（store 默认/opts 优先/null 兜底） |
| apps/web/src/api/imageExtNodeApi.ts | 同 imageNodeApi |
| apps/web/src/api/imageExtNodeApi.test.ts | 同 imageNodeApi.test（含 :134 既有断言更新） |
| apps/web/src/pages/canvas/components/nodes/AudioConfigPanel.tsx | 159/160/162 → canvasState.projectId |
| apps/web/src/pages/canvas/components/nodes/TextConfigPanel.tsx | 160/161/163 → canvasState.projectId + 测试 |
| apps/web/src/pages/canvas/components/nodes/ImageConfigPanel.tsx | 89/90 → canvasState.projectId；92 → submitGeneration(nodeId, { projectId }) |
| apps/web/src/pages/canvas/components/nodes/ImageExtConfigPanel.tsx | 136/137 → canvasState.projectId；139 → submitGeneration(nodeId, { projectId }) |
| apps/web/src/api/executionApi.ts | 不改（保持纯参数，无 store 依赖） |
| docs/superpowers/tech-debt.md | TD-1/TD-2 清账 + 新增 PromptValue.allImages 僵尸字段条目 |

## 实施备注（Spec 确认时钉死）

- **useImageUpload.test.ts mock 与真实 store 脱节是 TD-2 逃过测试的根因**：其 updateFn（:21-31）写嵌套、真实 nodeStore.updatePromptImages 写根级。Task 1 修正 mock 形状 = 测试基建修正，既有用例断言可能需同步更新，属预期内改动
- **canvasStore mock 注入方式**：imageNodeApi.test.ts / imageExtNodeApi.test.ts 用真实 useNodeStore（只 mock executionApi），canvasStore 新依赖用 `vi.mock('@/stores/canvasStore')` + hoisted 可变 `mockProjectId`（各用例改值），断言后还原
- **apiFetch 走全局 fetch**：ConfigPanel 生成路径测试 mock `global.fetch`（apiFetch 底层同源），断言 URL 含真实 pid
- **5 面板测试策略**：结构相同（F2 已证全部结构 A），Video（直接 enqueue 形态）+ Text（直接 enqueue 形态）+ Image（API 函数形态，覆盖 S1 透传链）三面板写生成路径测试，Audio/ImageExt 靠同模式替换 + Grep 复扫 + tsc 保证——TDD 务实平衡，plan 明示
- **commit 粒度**：Task 1/2/3 各一 commit（TD-2 三读取方独立可回溯）；Task 4+5 单一 commit（TD-1 15 处原子性，spec 验证标准 3）；清账文档单独 commit
- **C1 结论（Map key 稳定）**：`ImageItem.id: string` 必填（nodeStore.ts:79-85，TS strict 编译保证），全构造点核验——useImageUpload tempItem（tempId）/realItem（fileId）、ImageGenNode.tsx:177（fileId）、canvasStore.ts:383（透传 ImageGenNode 构造结果）。id 恒存在，Map 去重安全
- **C2 结论（Task 1→2 隔离）**：VideoConfigPanel.test.tsx 现状**未 mock useImageUpload**，且 nodeStore mock（:56-70）无 `getState` 属性——真实 useImageUpload 内部调 `useNodeStore.getState()` 会崩。Task 2 须补：`vi.mock('./prompt-input/useImageUpload')`（uploadSingleImage 可 spy）+ nodeStore mock 附加 `getState: () => state`。补齐后 Task 1/2 完全隔离
- **C3 结论（fetch 计数污染）**：deleteNode（nodeStore.ts:458-481）内所有 fetch 均为 `/api/storage/files/` DELETE（deleteRefs + fileId 分支 + multiImage 分支），无其他 fetch；nodeStore.test 为纯 store 测试无持久化订阅。用例 C 节点**不设 fileId** 即零污染；断言统计统一按 URL 前缀 `/api/storage/files/` 过滤（双保险）
- **API 函数调用方全量确认**：buildImageGenParams/buildImageExtGenParams 产品代码调用方仅 imageNodeApi.ts:51、imageExtNodeApi.ts:62（submitGeneration 内部）→ ImageConfigPanel.tsx:92、ImageExtConfigPanel.tsx:139（submitGeneration）——全部在清单内，无批量重跑/历史重放等遗漏调用方，可选参数不破坏任何既有签名

## 任务分解（TDD：每任务先写失败测试 → 红 → 实现 → 绿 → commit）

### Task 1：A-1 useImageUpload 读根级

1. **测试基建修正**（先于红）：
   - updateFn（:21-31）：`prompt: { ..., allImages }` → `data: { ...data, allImages }`（对齐真实 store 根级写入）
   - makeImageNode/makeImageExtNode/makeVideoNode：allImages 参数从 `prompt.allImages` 移到 `data.allImages`（嵌套处保留 `allImages: []` 维持 PromptValue 形状）
   - 跑既有用例：因 mock 形状修正而失败的断言同步更新（预期：涉及嵌套读取的旧断言全部转为根级）
2. **红**（新增用例）：
   - 用例 A（连续上传不覆盖）：mockNodes 预置 videoGen 节点根级 `allImages: [imgA]` → uploadSingleImage 成功 → 断言 updateFn **最后一次**调用参数同时含 imgA 与新图 id（当前实现因读嵌套返回 []，最终写入只有新图 → imgA 丢失 → 红）
   - 用例 B（删除基于根级）：预置根级 `[imgA, imgB]` → deleteImage(imgA) → 断言 updateFn 收到 `[imgB]` 且 fetch DELETE `/api/storage/files/imgA`（当前读嵌套 → 写 `[]` → imgB 丢失 → 红）
3. **绿**：useImageUpload.ts:15 `data?.prompt?.allImages ?? []` → `data?.allImages ?? []`
4. 验证：`pnpm --filter @flowweb/web test -- useImageUpload ImageConfigPanel ImageExtConfigPanel`（S1：追加消费方文件）
5. commit：`fix(web): useImageUpload reads root-level allImages (TD-2 A-1)`

### Task 2：A-2 VideoConfigPanel 读根级

1. **红**：
   - 改造 160-168 用例 `renders correctly with images in prompt` → `renders thumbnails from root-level allImages`：`mockNodeData.prompt.allImages = [...]` → `mockNodeData.allImages = [...]`（其余 53/97 行的嵌套 `allImages: []` 保持不动，形状兼容），断言 2 个 thumb 不变（当前实现读嵌套 → 0 个 → 红）
   - **mock 补齐（C2）**：`vi.mock('./prompt-input/useImageUpload', ...)` 暴露可 spy 的 mockUploadSingleImage；nodeStore mock（:56-70）附加 `getState: () => state`（真实 useImageUpload 依赖 getState，现 mock 缺失，触发即崩）
   - 新增用例：粘贴上限基于根级（M1 正反两断言）——
     - 拦截：根级 allImages 9 张 → 触发 PromptInput mock 的 onPasteImage → 断言 mockUploadSingleImage 未被调用（当前读嵌套 length 0 → 不拦截 → 被调用 → 红）
     - 放行：根级 8 张 → onPasteImage → 断言 mockUploadSingleImage **恰好被调用 1 次**（区分"上限逻辑正确"与"handlePasteImage 没接上"）
2. **绿**：VideoConfigPanel.tsx:51 后新增 `const allImages = nodeData?.allImages ?? [];`，210/213/249/252/256/260/270 的 `prompt.allImages` → `allImages`；51 行 prompt 变量保留
3. 验证：`pnpm --filter @flowweb/web test -- VideoConfigPanel useImageUpload`（S1：追加依赖方文件）
4. commit：`fix(web): VideoConfigPanel reads root-level allImages (TD-2 A-2)`

### Task 3：A-3 deleteNode deleteRefs 合并去重

1. **红**（nodeStore.test.ts 新增，`vi.spyOn(global, 'fetch')` mock）：
   - 用例 A（根级清理）：imageGen 节点根级 allImages 含 fileId `f1` → deleteNode → 断言 fetch 以 `/api/storage/files/f1` + DELETE 被调用（当前读嵌套 → 不调用 → 红）
   - 用例 B（嵌套兼容）：节点仅 `prompt.allImages` 含 `f2`（历史形状，无根级字段）→ 仍 DELETE f2（合并去重保证 → 红）
   - 用例 C（去重）：根级与嵌套同 id `f3` → DELETE f3 **恰好一次**（Map 去重 → 红）。C3：三个用例的节点 mock 均**不设 fileId**（避开 fileId 分支多发的 DELETE），且 fetch 调用统计统一按 URL 前缀 `/api/storage/files/` 过滤（deleteNode 内无其他 fetch，已核实，双保险）
2. **绿**：nodeStore.ts:462：
   ```ts
   const rootImgs = imgData.allImages ?? [];
   const nestedImgs = imgData.prompt?.allImages ?? [];
   const allRefs = [...new Map([...rootImgs, ...nestedImgs].map((i) => [i.id, i])).values()];
   ```
   原 deleteRefs 改用 allRefs
3. 验证：`pnpm --filter @flowweb/web test -- nodeStore canvasStore`（S1：追加同层 store 文件）
4. commit：`fix(web): deleteNode cleans up root+nested allImages refs with dedup (TD-2 A-3)`

### Task 4+5：TD-1 —— API 函数 opts + ConfigPanel 15 处（单 commit 原子）

**Task 4：API 构建函数（2 处）**

1. **红**（imageNodeApi.test.ts / imageExtNodeApi.test.ts 各 3 用例，vi.mock canvasStore + hoisted mockProjectId）：
   - store 默认：mockProjectId='proj-123' → `buildImageGenParams('img1')` → `params.projectId === 'proj-123'`（当前硬编码 'default' → 红）
   - opts 优先：`buildImageGenParams('img1', { projectId: 'explicit-1' })` → `'explicit-1'`
   - null 兜底：mockProjectId=null → `'default'`
   - imageExtNodeApi.test.ts:120-134 既有断言 `toBe('default')` 更新为 store 默认用例
2. **绿**：
   - imageNodeApi.ts：`buildImageGenParams(nodeId: string, opts?: { projectId?: string })`，内部 `projectId: opts?.projectId ?? useCanvasStore.getState().projectId ?? 'default'`；`submitGeneration(nodeId: string, opts?: { projectId?: string })` 透传
   - imageExtNodeApi.ts 同理
3. 验证：`pnpm --filter @flowweb/web test -- imageNodeApi imageExtNodeApi`

**Task 5：ConfigPanel 13 处替换**

1. **红**（三面板生成路径测试，mock global.fetch + 真实 pid）：
   - VideoConfigPanel.test.tsx 新增：canvasStore mock projectId='real-pid' + nodeStore 预置 videoGen 节点（prompt.text 非空）→ 点生成 → 断言 fetch 调用含 `PUT /api/projects/real-pid/nodes`（当前 'default' → 红）
   - TextConfigPanel.test.tsx 同形态新增（断言 PUT nodes + enqueue 参数）
   - ImageConfigPanel.test.tsx 同形态新增（断言 PUT nodes + submitGeneration 透传——即 buildImageGenParams 收到 opts.projectId='real-pid'，可借 fetch body 断言）
2. **绿**（5 文件机械替换，模式一致）：
   - AudioConfigPanel.tsx:159/160/162、TextConfigPanel.tsx:160/161/163、VideoConfigPanel.tsx:197/198/200：`'default'` → `canvasState.projectId ?? 'default'`（变量已有，F1 确认）
   - ImageConfigPanel.tsx:89/90、ImageExtConfigPanel.tsx:136/137 同上
   - ImageConfigPanel.tsx:92 → `await imageNodeApi.submitGeneration(nodeId, { projectId: canvasState.projectId ?? 'default' })`（S1）；ImageExtConfigPanel.tsx:139 同理
3. **复扫**（原子性验证，S2 加强）：
   ```
   Grep pattern: syncNodes\('default'|syncEdges\('default'|projectId: 'default'
   path: apps/web/src —— 排除 *.test.* 后零命中（`?? 'default'` 兜底字符串不计）
   ```
   追加宽扫兜底（M2 排除规则写死）：Grep `'default'` 全量扫描，过目前先按规则过滤——
   - 排除 `*.test.*`、`*.spec.*`
   - 排除 `?? 'default'` 兜底字符串（spec 已确认保留）
   - 排除非画布模块命中（路由默认值、配置默认值等）
   - 剩余命中逐行人工确认，确保零运行时硬编码后方可 commit
4. 验证：`pnpm --filter @flowweb/web test` 全量 + `pnpm --filter @flowweb/web exec tsc -b`（或项目等价 typecheck 命令）
5. commit：`fix(web): replace 15 hardcoded projectId 'default' with canvas projectId (TD-1)`

### Task 6：浏览器手验（复现脚本重放）

1. 视频节点上传 1 张 → 缩略图栏显示 1 张（preview_eval + canvas 生图 + snapshot 验证）
2. 连续上传 2 张 → 2 张都在（localStorage content key rootAllImages === 2）
3. 删除节点 → preview_network 出现 `DELETE /api/storage/files/{fileId}`
4. 视频节点生成 → `PUT /api/projects/{真实pid}/nodes` 200 + enqueue body projectId === pid；生成流程不再中断（500 回归验证）
5. 全程 preview_console_logs 无新错误

### Task 7：清账

1. tech-debt.md：TD-1、TD-2 移入「已清账」（TD-1 注明实际 15 处修正 + 生成 500 阻断一并修复）
2. tech-debt.md 新增：`PromptValue.allImages` 僵尸类型字段条目（运行时读取方已清零，待测试 mock 批量迁移后从类型移除，优先级低）
3. commit：`docs: settle TD-1/TD-2 in tech-debt ledger, add PromptValue.allImages zombie field`

## 风险与回滚

- useImageUpload.test.ts 既有用例可能因 mock 形状修正大面积红——逐个更新断言到根级形状，属测试与真实行为对齐，不改产品代码
- Task 5 若某面板 canvasState 作用域不通（F1 已核实行号均在 handleGenerate 内），以实际代码为准，不引入新变量
- 回滚粒度：三个 fix 独立 commit，可单独 revert；TD-1 单 commit 整体 revert
