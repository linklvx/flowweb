<!-- doc-status: historical | verified_at: n/a -->
# ImageGenNode 测试无限渲染导致 OOM 修复 Spec

## 问题现象

全量运行 `apps/web` 测试（127 个文件 / 1505 个测试）时，`ImageGenNode.test.tsx` 所在的 vitest worker 子进程因 JavaScript heap out of memory 崩溃，导致该文件（约 40 个测试）未跑完。

## 根因分析

### 根因：测试 mock 破坏 `useReactFlow` 引用稳定性 → outpaint effect 无限循环

`ImageGenNode.test.tsx` 的 `vi.mock('@xyflow/react')` 中，`useReactFlow` 每次调用返回全新对象：

```ts
useReactFlow: vi.fn(() => ({
  fitView: vi.fn(),        // 每次渲染都是新引用
  getNodes: vi.fn(() => [...]),
  setNodes: vi.fn(),
})),
```

`ImageGenNode.tsx` 的 outpaint 初始化 effect（885–911 行）把 `fitView` 放进依赖数组，且在 `editMode !== 'outpaint'` 时**无条件**执行 `setOutpaintRect(新对象)`：

```ts
useEffect(() => {
  // ...
  if (editMode !== 'outpaint') {
    didInitOutpaint.current = false;
    didFitView.current = false;
    setOutpaintRect({ x: 0, y: 0, width: 0, height: 0 }); // 每次都是新对象
  }
}, [editMode, displayUrl, baseWidth, baseHeight, id, fitView]); // 依赖 fitView
```

**循环链**：`setOutpaintRect(新对象)` → 触发重渲染 → mock 返回新 `fitView` → effect 依赖变化 → effect 重跑 → 再 `setOutpaintRect` → 无限循环。

**每次循环分配约 0.3–0.4 MB**（heap 从 78 MB 增长，每渲染一次上涨），累积到 V8 堆上限（Node 24 默认约 4 GB）即触发 "JavaScript heap out of memory"，worker 退出。

**真实环境无此问题**：React Flow 的 `useReactFlow()` 用 `useMemo(..., [viewportInitialized])` 缓存返回对象，`fitView`/`getNodes`/`setNodes` 均为稳定引用。是测试 mock 破坏了引用稳定性。

### 证据

- 单个最简测试（idle 模式、无 fileId）`should render editable node title` 渲染 **60+ 次**（heap 111→130 MB 仍在涨）。
- 全量跑时模块级计数器 `__igcRenderCount` 跨测试累积到 335 才触发上一轮排查者加的 throw 保护。
- 将 mock 的 `fitView` 提为稳定引用后，同一单测渲染从 60+ 次降到 **2 次**。

### 根因 #2：引擎测试未 dispose → animate 循环泄漏

`LightingEngine.test.ts`（36 个测试）与 `Angle3DEngine.test.ts`（45 个测试）每个 `it` 都 `new Engine(...)`，但**从不调用 `dispose()`**。两个引擎的构造函数都自动 `startLoop()`（`requestAnimationFrame` 递归循环），`dispose()` 本应通过 `cancelAnimationFrame` + `disposed` 标志停止循环，但测试从未调用。

约 81 个 animate 循环跨测试文件持续泄漏（raf polyfill 用 `setTimeout(0)` 实现，每个引擎循环每秒迭代上千次），worker 堆累积到 4 GB 上限触发 "JavaScript heap out of memory"（OOM 时堆 4078→4084 MB）。

**为何之前未暴露**：修复 render loop 前，`__igcRenderCount` 的 throw 让 `ImageGenNode.test.tsx` 快速失败，测试在 33.5s 结束，引擎循环泄漏来不及涨到 4 GB；render loop 修复后测试跑满 45s，泄漏累积到 OOM 临界点。这是「修复一个根因、暴露下一个」的典型连锁。

### 次要问题（被 render loop 掩盖）

1. **mock 缺失具名导出**：`ImageConfigPanelResolver` 导入 `isImageExtNode`/`isImageGenNode`，但 `vi.mock('@/stores/nodeStore')` 只 mock 了 `useNodeStore`，导致渲染该组件时崩溃 → 12 个测试失败。
2. **诊断代码污染**：`ImageGenNode.tsx` 的 `__igcRenderCount` 计数器与 throw、`test-setup.ts` 的 `rafWarned` 打印为上一轮排查遗留。

## 修复方案

### 修复 1（核心）：`useReactFlow` mock 返回稳定引用

将 `fitView`/`getNodes`/`setNodes` 提为 `vi.hoisted` 中的稳定 `vi.fn()`，`useReactFlow` mock 直接引用。三者同源（真实环境均为稳定引用），一并修复以避免另两个 effect（customSize restore、persist customSize）因 `getNodes`/`setNodes` 引用抖动而反复重跑。

**使用方式确认**：`ImageGenNode.tsx:83` 仅一处 `const { fitView, getNodes, setNodes, setCenter } = useReactFlow()`，为解构使用，无整体引用放入依赖数组。因此仅稳定化具体方法即可，无需稳定化 `useReactFlow()` 返回对象本身。

**mock 写法约定**：`vi.fn()` 必须在 `vi.hoisted` 回调内部创建（vitest 对 hoisted 有变量引用限制），严禁在回调外创建再引用。

**补充**：当前 mock 未定义 `setCenter`（组件已解构但测试未触发其调用）。为消除 `undefined` 隐患，一并补上稳定 `setCenter`。

### 修复 2：补齐 nodeStore mock 具名导出

经 `grep "from '@/stores/nodeStore'"` 扫描 `nodes` 目录，ImageGenNode 渲染树确定触发的**运行时值导出**（`import type` 在编译期擦除，无需 mock）：

| 导出 | 使用文件 | mock 实现（与真实语义一致） |
|------|---------|------------------------------|
| `useNodeStore` | 多处 | 已 mock ✓ |
| `isImageExtNode` | ImageConfigPanelResolver、ImageExtConfigPanel、useImageExtConfig | `(node) => node?.type === 'imageExtGen'` |
| `isImageGenNode` | ImageConfigPanelResolver | `(node) => node?.type === 'imageGen'` |
| `isImageNode` | ImageConfigPanel、EraseBottomToolbar、useImageUpload | `(node) => node?.type === 'imageGen' \|\| node?.type === 'imageExtGen'` |

其中 `isImageExtNode`/`isImageGenNode` 由 `ImageConfigPanelResolver` 无条件调用（第 13/17 行），`isImageNode` 由 `ImageConfigPanel`、`EraseBottomToolbar` 调用，三者均为测试渲染树必触发的运行时导出，必须补齐。

**不纳入**：`isTextNode`/`isMultiImageNode`（分别仅 TextInputNode/MultiImageNode 使用，ImageGenNode 测试不渲染）、`IMAGE_EXT_DEFAULTS`/`ANNOTATION_DEFAULTS`（仅 imageExtGen/annotate 分支触发，当前测试不覆盖）——留待对应测试文件补齐，不在此处越界。

### 修复 3：清理诊断代码

- 移除 `ImageGenNode.tsx` 顶部的 `let __igcRenderCount` 及函数体开头的计数器/throw/打印，恢复干净状态。
- 移除 `test-setup.ts` 的 `rafWarned` 及 `[RAF-FIRST-STACK]` 打印（raf polyfill 本身为既有代码，保留）。

### 修复 4：引擎测试 dispose 清理

在两个引擎测试文件里，让每个测试创建的引擎在 `afterEach` 中被 `dispose()`，停止 animate 循环泄漏：

- 文件顶层维护 `engines` 数组 + 全局 `afterEach` 遍历 `dispose()` 并清空。
- 抽 `createEngine(container)` 辅助函数：`new Engine(...)` 后 push 进数组再返回。
- 将每个 `const engine = new Engine(container, 'https://example.com/test.jpg')` 替换为 `const engine = createEngine(container)`。

`dispose()` 幂等（`if (this.disposed) return`），double dispose 安全。

### 不在本次范围（已知限制）

- **并行堆扩张 OOM**：修复根因 #1/#2 后，并行跑（2–20 workers）仍偶发 OOM——某组 antd 重型组件测试（MaterialLibrary、CreditsDropdown、BannerManagementTab、login 等，`heapUsed` 230–276 MB）渲染时产生巨量临时对象，V8 高分配率下 `heapTotal` 持续扩张到堆上限（4 GB/8 GB 均试过）。串行跑 `heapUsed` 波动 46–277 MB 且 GC 正常回收，证明非确定性代码泄漏；属「重型测试临时分配 + 并行 GC 压力」资源问题，**按用户决定接受为已知限制**，后续在 CI 用更大内存机器或分批跑测试缓解，不在本次处理。

### 技术债（本次不处理）

`ImageGenNode.tsx:885-911` 的 outpaint 初始化 effect 在真实环境下也脆弱：即使 `fitView` 稳定，`displayUrl`/`baseWidth`/`baseHeight` 任一变化仍会触发 `setOutpaintRect` 重置为零值对象，若这些值在父组件中每次新建，真实环境也可能产生不必要的重渲染。建议后续：用 `useRef` 跟踪 `editMode` 是否从 `'outpaint'` 切出，仅在切换瞬间重置一次；或将 `fitView` 移出依赖数组、改用 `useRef` 持有最新引用。本次仅修测试 mock，不动产品代码逻辑。

## 影响范围

| 文件 | 改动 |
|------|------|
| `apps/web/src/pages/canvas/components/nodes/ImageGenNode.test.tsx` | mock 稳定化（修复 1）+ 补齐 nodeStore 导出（修复 2） |
| `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx` | 移除 `__igcRenderCount` 诊断代码（修复 3） |
| `apps/web/src/test-setup.ts` | 移除 `rafWarned` 诊断代码（修复 3） |
| `apps/web/src/pages/canvas/engine/LightingEngine.test.ts` | `createEngine` + `afterEach` dispose（修复 4） |
| `apps/web/src/pages/canvas/engine/Angle3DEngine.test.ts` | `createEngine` + `afterEach` dispose（修复 4） |

## 验收标准

| 序号 | 验收场景 | 预期结果 |
|------|---------|---------|
| 1 | 全量运行 `apps/web` 测试 | 无 "JavaScript heap out of memory"，无 worker 异常退出 |
| 2 | `ImageGenNode.test.tsx` | 40 个测试全部通过 |
| 3 | 单测渲染次数 | 单个测试渲染 ≤ 3 次（无无限循环）——通过 `vi.spyOn` 监控 `setOutpaintRect` 调用次数（或临时 renderCount 断言）量化验证，验证通过后移除监控代码 |
| 4 | 代码干净 | `ImageGenNode.tsx` / `test-setup.ts` 无诊断代码残留（`git diff` 仅含修复 1/2 的测试改动） |
| 5 | 产品代码行为不变 | `ImageGenNode.tsx` 除清理诊断代码外逻辑零改动 |
