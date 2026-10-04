<!-- doc-status: historical | verified_at: n/a -->
# ImageGenNode 测试无限渲染 OOM 修复 — 实施 Plan

## 总体策略

本次为**测试基础设施修复**（根因在测试 mock，产品代码仅清理诊断代码、逻辑零改动）。TDD 语义为「以现有失败测试为红，修复 mock 后转绿」：

- **红**：`ImageGenNode.test.tsx` 当前 41 failed（render loop）→ 修复 1 后暴露 12 failed（mock 缺失）→ 修复 2 后转绿。
- **绿**：全文件 40 测试通过，全量测试无 OOM。
- **量化验证**：复用现有诊断代码 `[IGNC-RENDER]` 打印作为临时渲染计数工具，验证单测渲染 ≤3 次后，在 Task 3 一并清理。

### 执行纪律（失败回退）

任一 Task 跑完若出现**超出本 Task 既定范围**的失败（如 Task 2 出现第 4 个 mock 缺失、或其他组件 mock 缺陷），**暂停，不静默扩大修复面**：记录失败用例与错误信息 → 判断是否属本次 OOM 修复范围 → 若属新发现的 mock 缺陷，先补充到 Plan 经确认后再修；否则留待独立任务处理。

按依赖关系分 4 个任务顺序执行。

---

## Task 1：`useReactFlow` mock 稳定化（核心，消除无限循环）

**目标**：`fitView`/`getNodes`/`setNodes`/`setCenter` 提为 `vi.hoisted` 内稳定 `vi.fn()`，消除 outpaint effect 依赖抖动导致的无限循环。

### 关键约束

- `vi.fn()` 必须在 `vi.hoisted` 回调**内部**创建，严禁在回调外创建变量再引用（vitest 对 hoisted 有变量引用限制）。
- 稳定化范围：`fitView`（循环主因）+ `getNodes`/`setNodes`（另两个 effect 依赖，一并稳定）+ `setCenter`（组件已解构但 mock 缺失，补上消除 undefined 隐患）。
- `getNodes` 需保持返回含 `mockNodeData` 的节点数组（通过闭包读取 `let mockNodeData`，调用时取值，无 TDZ 问题）。

### mock 写法（目标形态）

```ts
const { mockFitView, mockGetNodes, mockSetNodes, mockSetCenter } = vi.hoisted(() => {
  const fitView = vi.fn();
  const getNodes = vi.fn(() => [{ id: 'img1', type: 'imageGen', position: { x: 0, y: 0 }, width: 500, height: 500, selected: true, data: mockNodeData }]);
  const setNodes = vi.fn();
  const setCenter = vi.fn();
  return { mockFitView: fitView, mockGetNodes: getNodes, mockSetNodes: setNodes, mockSetCenter: setCenter };
});

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useInternalNode: vi.fn(() => ({ position: { x: 0, y: 0 }, measured: { width: 500, height: 500 } })),
    useReactFlow: vi.fn(() => ({
      fitView: mockFitView,
      screenToFlowPosition: vi.fn((p: any) => p),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      getNodes: mockGetNodes,
      setNodes: mockSetNodes,
      setCenter: mockSetCenter,
    })),
  };
});
```

### 验证命令

```bash
cd apps/web && npx vitest run src/pages/canvas/components/nodes/ImageGenNode.test.tsx -t "should render editable node title with default value" 2>&1 | grep -E "IGNC-RENDER|Tests "
# 预期：单测渲染 ≤ 3 次（[IGNC-RENDER] 打印 ≤ 3 行）
```

---

## Task 2：补齐 nodeStore mock 具名导出

**目标**：补 `isImageExtNode`/`isImageGenNode`/`isImageNode`，使 `ImageConfigPanelResolver` 及其子组件正常渲染。

### 关键约束

- 仅补 Spec 清单中确认的 3 个运行时导出（`useNodeStore` 已 mock），不越界补 `isTextNode`/`isMultiImageNode`/`IMAGE_EXT_DEFAULTS`/`ANNOTATION_DEFAULTS`。
- **扫描已确认**（执行前已跑）：`grep -rn "from '@/stores/nodeStore'" apps/web/src/pages/canvas/components/nodes/ --include="*.tsx" --include="*.ts"`。运行时值导出全集为 7 个（`useNodeStore`/`isImageExtNode`/`isImageGenNode`/`isImageNode`/`isTextNode`/`IMAGE_EXT_DEFAULTS`/`ANNOTATION_DEFAULTS`），其中 ImageGenNode 测试渲染树确定触发的即前 4 个，`isTextNode`（TextInputNode）/`IMAGE_EXT_DEFAULTS`（imageExt 分支）/`ANNOTATION_DEFAULTS`（annotate 分支）均不触发，无第 4 个遗漏。
- mock 实现与真实语义一致（基于 `node.type` 判断）：

```ts
isImageExtNode: (node: any) => node?.type === 'imageExtGen',
isImageGenNode: (node: any) => node?.type === 'imageGen',
isImageNode: (node: any) => node?.type === 'imageGen' || node?.type === 'imageExtGen',
```

### 测试用例

| # | 测试 | 验证点 |
|---|------|--------|
| 2.1 | `should show floating upload button when selected` | 渲染 `ImageConfigPanelResolver` 不报 "No isImageExtNode/isImageGenNode export" |
| 2.2 | `should render 4 corner resize handles...` | `ImageConfigPanel`（经 isImageNode）正常渲染 |
| 2.3 | redraw 相关测试 | `EraseBottomToolbar`（经 isImageNode）正常渲染 |

### 验证命令

```bash
cd apps/web && npx vitest run src/pages/canvas/components/nodes/ImageGenNode.test.tsx
# 预期：40 tests passed
```

---

## Task 3：清理诊断代码

**目标**：移除上一轮排查遗留，恢复产品代码干净状态。

### 改动

| 文件 | 移除内容 |
|------|---------|
| `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx` | 第 1 行 `let __igcRenderCount = 0`；函数体开头 `__igcRenderCount++` / `throw` / `process.stderr.write` 块 |
| `apps/web/src/test-setup.ts` | `rafWarned` 变量及 `[RAF-FIRST-STACK]` 打印（raf polyfill 本身为既有代码，保留） |

### 验证命令

```bash
cd /d/flowweb && git diff -- apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx apps/web/src/test-setup.ts
# 预期：ImageGenNode.tsx 无诊断代码 diff；test-setup.ts 仅移除 rafWarned
```

---

## Task 5：修复引擎测试 dispose（消除第二个 OOM 源）

**目标**：`LightingEngine.test.ts` / `Angle3DEngine.test.ts` 的每个引擎实例在 `afterEach` 中 `dispose()`，停止 animate 循环泄漏。

### 关键约束

- `dispose()` 幂等（`if (this.disposed) return`），double dispose 安全。
- 用 `createEngine` 辅助函数统一注册，避免逐条手动 push 遗漏。
- `afterEach` 用**全局**（文件顶层）而非各 describe 块，覆盖所有 `it`。

### 实现步骤

1. 两个测试文件顶层（`import { XxxEngine }` 后、`describe` 前）加：
   - `const engines: XxxEngine[] = []`
   - `afterEach(() => { engines.forEach(e => e.dispose()); engines.length = 0; })`
   - `function createEngine(container: HTMLDivElement, url = 'https://example.com/test.jpg')`（`new` 后 `engines.push` 再返回）
2. `replace_all` 把 `const engine = new XxxEngine(container, 'https://example.com/test.jpg');` → `const engine = createEngine(container);`

### 验证命令

```bash
cd apps/web && npx vitest run src/pages/canvas/engine/LightingEngine.test.ts src/pages/canvas/engine/Angle3DEngine.test.ts
# 预期：两文件全绿，且无 "requestAnimationFrame is not defined" 残留
```

---

## Task 4：全量验证无 OOM

**目标**：确认修复后全量测试无 worker OOM、无回归。

### 验证命令

```bash
cd apps/web && pnpm test
# 预期：Test Files 全绿（127），无 "JavaScript heap out of memory"，无 "Worker exited unexpectedly"
```

### 验收对照

| 验收标准 | 验证手段 |
|---------|---------|
| 全量无 OOM / 无 worker 异常退出 | Task 4 全量跑，观察无 heap out of memory |
| `ImageGenNode.test.tsx` 全绿 | Task 2 验证命令 40 passed |
| 单测渲染 ≤ 3 次 | Task 1 验证命令（[IGNC-RENDER] ≤ 3 行） |
| 代码无诊断残留 | Task 3 `git diff` 检查 |
| 产品代码逻辑零改动 | Task 3 后 `git diff ImageGenNode.tsx` 仅含清理诊断代码 |

---

## 文件变更汇总

| 文件 | Task | 动作 |
|------|------|------|
| `apps/web/src/pages/canvas/components/nodes/ImageGenNode.test.tsx` | 1, 2 | mock 稳定化 + 补 nodeStore 导出 |
| `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx` | 3 | 移除 `__igcRenderCount` 诊断代码 |
| `apps/web/src/test-setup.ts` | 3 | 移除 `rafWarned` 诊断代码 |
| `apps/web/src/pages/canvas/engine/LightingEngine.test.ts` | 5 | `createEngine` + `afterEach` dispose |
| `apps/web/src/pages/canvas/engine/Angle3DEngine.test.ts` | 5 | `createEngine` + `afterEach` dispose |

## 执行顺序

```
Task 1 → Task 2 → Task 3 → Task 5 → Task 4
```
