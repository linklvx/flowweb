<!-- doc-status: historical | verified_at: n/a -->
# 视频高清面板 — TDD 实施计划 (v2)

## 关联 Spec

[docs/superpowers/specs/2026-07-03-video-hd-upscale-panel-design.md](../specs/2026-07-03-video-hd-upscale-panel-design.md)

## 变更记录

| 版本 | 修订内容 |
|------|---------|
| v1 | 初始方案 |
| v2 | 补全：isSingleSelected useMemo 稳定化、提交按钮 disabled 测试、ESC 测试、getPopupContainer 定位验证、激活态改用 data-active 属性、无 fileId 联动测试 |

---

## 任务分解

```
Task 1: VideoNodeToolbar — onHD prop + HD 按钮激活态
  └→ Task 2: VideoHDPanel — 新建高清面板组件
       └→ Task 3: VideoGenNode — 集成状态管理 + 条件渲染
```

---

## Task 1: VideoNodeToolbar — 新增 onHD / hdPanelOpen prop

**目标**：HD 按钮从无操作占位变为可触发回调、有激活态反馈的按钮。

### 文件

| 文件 | 操作 |
|------|------|
| `VideoNodeToolbar.tsx` | MODIFY — 接口 + HD 按钮 |
| `VideoNodeToolbar.test.tsx` | MODIFY — 新增测试 |

### TDD 测试用例

```
1.1 点击「高清」按钮时调用 onHD 回调
    - setup: render(<VideoNodeToolbar show onHD={fn} />)
    - action: fireEvent.click(screen.getByText('高清'))
    - assert: expect(fn).toHaveBeenCalledTimes(1)

1.2 onHD 未提供时不抛错
    - setup: render(<VideoNodeToolbar show />)
    - action: fireEvent.click(screen.getByText('高清'))
    - assert: no error thrown

1.3 hdPanelOpen=true 时 HD 按钮有 data-active="true" 属性
    - setup: render(<VideoNodeToolbar show hdPanelOpen />)
    - action: get HD button element
    - assert: expect(btn).toHaveAttribute('data-active', 'true')

1.4 hdPanelOpen=false/未传 时 HD 按钮无 data-active 属性
    - setup: render(<VideoNodeToolbar show />)
    - action: get HD button element
    - assert: expect(btn).not.toHaveAttribute('data-active')
```

### 实现改动

```diff
// 接口
  interface VideoNodeToolbarProps {
    ...
+   onHD?: () => void;
+   hdPanelOpen?: boolean;
  }

// HD 按钮 — 使用 data-active 属性标记激活态（test 友好，不依赖 style 计算）
  <button
    type="button"
    style={{
      ...BTN_STYLE,
+     ...(hdPanelOpen ? { background: 'var(--canvas-controls-hover)' } : {}),
    }}
+   data-active={hdPanelOpen ? 'true' : undefined}
+   onClick={onHD}
  >
    <HDIcon />
    <span>高清</span>
  </button>
```

### 验证

```bash
pnpm test -- --reporter=verbose apps/web/src/pages/canvas/components/nodes/VideoNodeToolbar.test.tsx
```

---

## Task 2: VideoHDPanel — 新建高清面板组件

**目标**：创建独立的 `VideoHDPanel` 组件，包含三行选项 + 底部提交区域。

### 文件

| 文件 | 操作 |
|------|------|
| `VideoHDPanel.tsx` | NEW |
| `VideoHDPanel.test.tsx` | NEW |

### TDD 测试用例

```
2.1 渲染标题「视频高清」
    - assert: screen.getByText('视频高清')

2.2 渲染三个选择行标签
    - assert: screen.getByText('模型选择')
    - assert: screen.getByText('分辨率')
    - assert: screen.getByText('帧率')

2.3 默认值显示正确
    - assert: 模型 dropdown trigger 显示首个选项名称 (HuoShan-画质增强)
    - assert: 分辨率 trigger 显示「2K」
    - assert: 帧率 trigger 显示「自适应」

2.4 点击分辨率下拉可打开菜单，菜单项渲染在面板内部
    - action: userEvent.click(resolutionTrigger)
    - await waitFor: menu items visible (2K, 4K)
    - assert: 菜单外层 wrapper 是 panelRef 的后代节点（验证 getPopupContainer 生效）

2.5 点击菜单项可切换选中值
    - action: userEvent.click(resolutionTrigger) → waitFor menu
    - action: fireEvent.click(screen.getByText('4K'))
    - assert: resolution trigger 文本变为「4K」

2.6 渲染提交按钮
    - assert: screen.getByTestId('hd-submit-btn') 存在

2.7 提交按钮点击时 stopPropagation
    - setup: 外层 div onClick spy
    - action: fireEvent.click(submitBtn)
    - assert: 外层 spy 未被调用

2.8 根元素有 nodrag nopan class
    - assert: container.firstChild.classList.contains('nodrag')
    - assert: container.firstChild.classList.contains('nopan')

2.9 渲染积分占位值
    - assert: screen.getByText('11')

2.10 fileId 为 undefined 时提交按钮 disabled
    - setup: render(<VideoHDPanel nodeId="n1" />)  // 不传 fileId
    - assert: expect(submitBtn).toBeDisabled()
```

### 组件接口

```typescript
interface VideoHDPanelProps {
  nodeId: string;
  fileId?: string;
}
```

### 组件结构

```tsx
<div ref={panelRef} className="nodrag nopan ...">
  <div className="...面板容器样式...">
    {/* 标题 */}
    <div className="px-2">
      <span>视频高清</span>
    </div>

    <div className="flex flex-col gap-2">
      {/* 模型选择 */}
      <Row label="模型选择">
        <Dropdown
          getPopupContainer={() => panelRef.current!}
          trigger={['click']}
          dropdownRender={() => <Menu> ... </Menu>}
        >
          <TriggerButton data-testid="hd-model-trigger">
            <ModelIcon />
            <span>{selectedModel}</span>
          </TriggerButton>
        </Dropdown>
      </Row>

      {/* 分辨率 */}
      <Row label="分辨率">
        <Dropdown getPopupContainer={() => panelRef.current!} trigger={['click']} ...>
          <TriggerButton data-testid="hd-resolution-trigger">
            {selectedResolution}
          </TriggerButton>
        </Dropdown>
      </Row>

      {/* 帧率 */}
      <Row label="帧率">
        <Dropdown getPopupContainer={() => panelRef.current!} trigger={['click']} ...>
          <TriggerButton data-testid="hd-fps-trigger">
            {selectedFps}
          </TriggerButton>
        </Dropdown>
      </Row>
    </div>

    {/* 底部 */}
    <div className="flex justify-end">
      <CreditsDisplay count={11} />
      <SubmitButton
        data-testid="hd-submit-btn"
        disabled={!fileId}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  </div>
</div>
```

### 验证

```bash
pnpm test -- --reporter=verbose apps/web/src/pages/canvas/components/nodes/VideoHDPanel.test.tsx
```

---

## Task 3: VideoGenNode — 集成状态管理 + 条件渲染

**目标**：将 HD 面板接入 VideoGenNode，管理 toggle 状态、关闭逻辑、面板互斥。

### 文件

| 文件 | 操作 |
|------|------|
| `VideoGenNode.tsx` | MODIFY |
| `VideoGenNode.test.tsx` | MODIFY — 新增测试 |

### TDD 测试用例

```
3.1 无 fileId 时 HD 按钮和 HD 面板均不渲染
    - setup: render VideoGenNode(selected, no fileId)
    - assert: Toolbar 不渲染 (show=false)，无 HD 面板
    - 目的：验证 Toolbar 与面板渲染条件严格对齐

3.2 有 fileId + selected 时 HD 按钮可见，面板默认不显示
    - setup: render VideoGenNode(selected, fileId)
    - assert: HD 按钮可见，无 HD 面板

3.3 点击 HD 按钮后 HD 面板出现
    - setup: render VideoGenNode(selected, fileId)
    - action: fireEvent.click(screen.getByText('高清'))
    - assert: HD 面板渲染

3.4 hdPanelOpen=true 时 VideoConfigPanel 不渲染
    - setup: no fileId, no referenceVideo, 触发 hdPanelOpen
    - assert: VideoConfigPanel 不在 DOM 中

3.5 selected 变为 false 时面板关闭
    - setup: 初始 selected=true, 触发面板打开
    - action: rerender with selected=false
    - assert: 面板关闭

3.6 dragging 变为 true 时面板关闭
    - setup: 初始 dragging=false, 触发面板打开
    - action: rerender with dragging=true
    - assert: 面板关闭

3.7 isSingleSelected 变为 false 时面板关闭
    - setup: getNodes 返回多个选中节点
    - assert: 面板不显示 / 自动关闭

3.8 面板打开时按下 Escape 键关闭面板
    - setup: 面板已打开
    - action: fireEvent.keyDown(window, { key: 'Escape' })
    - assert: 面板关闭

3.9 输入框聚焦时按下 Escape 不关闭面板
    - setup: 面板已打开，document.activeElement 为 INPUT
    - action: fireEvent.keyDown(window, { key: 'Escape' })
    - assert: 面板保持打开
```

### isSingleSelected 定义

```typescript
// 使用 useMemo 稳定引用，避免 effect 不必要的重复触发
// 数据来源：React Flow getNodes()（现有模式，VideoGenNode.tsx:60）
const isSingleSelected = useMemo(
  () => selected && getNodes().filter((n) => n.selected).length === 1,
  [selected, getNodes],
);
```

### 实现改动

```diff
function VideoGenNodeComponent({ id, selected }: NodeProps) {
+function VideoGenNodeComponent({ id, selected, dragging }: NodeProps) {

-const isSingleSelected = selected && getNodes().filter((n) => n.selected).length === 1;
+const isSingleSelected = useMemo(
+  () => selected && getNodes().filter((n) => n.selected).length === 1,
+  [selected, getNodes],
+);

+const [hdPanelOpen, setHdPanelOpen] = useState(false);

+// 关闭条件：非选中 / 非单选 / 拖拽中
+useEffect(() => {
+  if (!selected || !isSingleSelected || dragging) {
+    setHdPanelOpen(false);
+  }
+}, [selected, isSingleSelected, dragging]);

+// ESC 关闭（输入框聚焦时容错）
+useEffect(() => {
+  if (!hdPanelOpen) return;
+  const onKey = (e: KeyboardEvent) => {
+    if (e.key === 'Escape') {
+      const activeEl = document.activeElement;
+      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;
+      setHdPanelOpen(false);
+    }
+  };
+  window.addEventListener('keydown', onKey);
+  return () => window.removeEventListener('keydown', onKey);
+}, [hdPanelOpen]);

// Toolbar 传新增 prop
<VideoNodeToolbar
  ...
+ onHD={() => setHdPanelOpen(prev => !prev)}
+ hdPanelOpen={hdPanelOpen}
/>

// VideoConfigPanel 显式互斥
-{!trimMode && selected && !fileId && !referenceVideo && (
+{!trimMode && selected && !fileId && !referenceVideo && !hdPanelOpen && (

// HD 面板渲染
+{isSingleSelected && fileId && hdPanelOpen && !dragging && (
+  <div className="nodrag nopan absolute -bottom-4 left-1/2 -translate-x-1/2 translate-y-full z-20 w-full min-w-[420px] max-w-[430px]">
+    <VideoHDPanel nodeId={id} fileId={fileId} />
+  </div>
+)}
```

### 验证

```bash
pnpm test -- --reporter=verbose apps/web/src/pages/canvas/components/nodes/VideoGenNode.test.tsx
```

---

## 全量验证

```bash
pnpm test -- --reporter=verbose apps/web/src/pages/canvas/components/nodes/VideoNodeToolbar.test.tsx apps/web/src/pages/canvas/components/nodes/VideoHDPanel.test.tsx apps/web/src/pages/canvas/components/nodes/VideoGenNode.test.tsx
```

---

## 任务执行顺序

```
Step 1: Task 1 TDD → RED (写测试, 确认失败) → GREEN (实现) → REFACTOR
  verify: pnpm test VideoNodeToolbar

Step 2: Task 2 TDD → RED (写测试, 确认失败) → GREEN (实现) → REFACTOR
  verify: pnpm test VideoHDPanel

Step 3: Task 3 TDD → RED (写测试, 确认失败) → GREEN (实现) → REFACTOR
  verify: pnpm test VideoGenNode

Step 4: 全量回归
  verify: pnpm test (所有测试通过)
```

---

## 附录：后续优化建议（非阻塞，重构阶段落地）

| 建议 | 说明 |
|------|------|
| **关键元素 data-testid** | HD 按钮、提交按钮、积分显示、下拉触发器添加 testid，降低文案变更导致测试失效的风险 |
| **下拉触发器抽离** | 三行 Dropdown trigger 结构一致，可抽离为 `HDPanelSelect` 通用组件 |
| **状态收敛为单一对象** | `useState({ model, resolution, fps })` 替代三个独立 useState，对接参数提交更易扩展 |
| **预留 onSubmit 回调** | `onSubmit?: (config: HDConfig) => void`，降低后续 API 对接的接口改动成本 |
| **边界测试补充** | 多节点框选关闭、拖动中不渲染、切换节点自动关闭 |
