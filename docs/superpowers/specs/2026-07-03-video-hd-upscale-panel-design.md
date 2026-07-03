# 视频高清面板 Spec (v3)

## 变更记录

| 版本 | 修订内容 |
|------|---------|
| v1 | 初始方案 |
| v2 | 补全：定位父级约束、拖动态行为、面板互斥显性逻辑、默认值、下拉组件规则、事件冒泡阻断、提交按钮状态位、ESC 关闭 |
| v3 | 落地：dragging 拖动态逻辑、isSingleSelected 渲染条件、getPopupContainer 防止失焦、HD 按钮激活态、积分占位规则、z-index 勘误；追加参数状态预留、ESC 容错、autoAdjustOverflow |

---

## 一、功能概述

点击视频节点悬浮工具条「高清」按钮，在视频节点下方弹出高清面板。面板提供模型选择、分辨率选择、帧率选择，底部展示积分消耗和提交按钮。

---

## 二、交互流程

```
选中视频节点（单节点、有视频、非拖拽中） → VideoNodeToolbar [高清] 按钮
  │ 点击「高清」按钮
  ▼
视频节点下方弹出高清面板（toggle），HD 按钮高亮
面板关闭条件：
  ├── 再次点击「高清」按钮（toggle）
  ├── 节点取消选中（selected=false → 自动关闭）
  ├── 节点变为非单选（isSingleSelected=false → 自动关闭）
  ├── 节点开始拖动（dragging=true → 自动关闭）
  └── 按下 ESC 键（焦点不在输入框内时生效）→ 关闭
```

---

## 三、组件结构

```
VideoGenNode.tsx
  └── VideoNodeToolbar (isSingleSelected && fileId)
        └── 高清按钮 onHD → toggle hdPanelOpen, 激活态反馈
  └── VideoHDPanel (isSingleSelected && fileId && hdPanelOpen && !dragging)  — NEW
        ├── 标题: "视频高清"
        ├── 模型选择行 (120px label + antd Dropdown)
        ├── 分辨率行 (120px label + antd Dropdown)
        ├── 帧率行 (120px label + antd Dropdown)
        └── 底部: 积分(占位) + 提交按钮
```

---

## 四、面板布局

```
┌─────────────────────────────────────────┐
│ 视频高清                                 │  ← 标题 (text-sm font-medium)
├─────────────────────────────────────────┤
│ 模型选择    [模型图标 + 模型名 + 标签 ▼] │  ← antd Dropdown, placement="top"
│ 分辨率      [2K ▼]                      │  ← antd Dropdown, placement="top"
│ 帧率        [自适应 ▼]                   │  ← antd Dropdown, placement="top"
├─────────────────────────────────────────┤
│                          ⚡ 11  [↑]     │  ← 积分(占位值) + 提交按钮
└─────────────────────────────────────────┘
```

---

## 五、定位规则

- 定位父级：`VideoGenNode` 根 div 已声明 `className="relative canvas-node"`（line 610），HD 面板的 `absolute` 定位以此为基准
- 面板：`absolute -bottom-4 left-1/2 -translate-x-1/2 translate-y-full`（紧贴节点底部，水平居中）
- `z-20`（与 Toolbar 同为 z-20。Toolbar 位于节点顶部 `bottom: calc(100% + 32px)`，面板位于节点底部 `top-full`，空间无重叠，同层级无遮挡风险）
- `min-w-[420px] max-w-[430px] w-full`
- 面板背景：`var(--canvas-controls-bg)` = `rgb(38, 38, 38)`
- 边框：`0.5px solid var(--canvas-controls-border)` = `rgb(54, 54, 54)`
- 圆角：`rounded-xl`（12px）
- 阴影：`shadow-[0px_4px_10px_0px_rgba(0,0,0,0.12)]`
- padding：`pt-3 px-2 pb-2`，内容 gap：`gap-3`

---

## 六、各行的样式与交互

### 6.1 通用行样式
- 行容器：`flex h-8 items-center gap-4`
- Label：`flex w-[120px] shrink-0 items-center gap-1 px-2`，文字 `text-[13px]`，color `#e2e8f0`

### 6.2 下拉按钮（Trigger）样式
- Trigger 按钮：`flex h-8 flex-1 items-center justify-between overflow-hidden rounded-lg border px-2 py-1`
  - border: `0.5px solid var(--canvas-controls-border)`
  - hover: `hover:bg-white/10`
- 左侧内容：模型图标(16×16) + 文本 `text-[13px]` + 标签图片(可选)
- 右侧：向下箭头 SVG（antd Dropdown open 时自动旋转）

### 6.3 下拉菜单实现规则
- 使用 **antd `Dropdown`** + 自定义 button trigger + `dropdownRender`（与 `VideoNodeToolbar` 截帧/音频分离下拉模式一致）
- **`getPopupContainer={() => panelRootRef.current || document.querySelector('.react-flow') || document.body}`**：将弹出层渲染到面板根容器内，确保点击菜单项不触发节点失焦（对齐 `ImageNodeToolbar.tsx:480` 的实现）
- `placement="top"`：优先向上弹出
- `autoAdjustOverflow`：极端场景（节点靠近画布顶部）自动切换弹出方向
- 菜单样式：`borderRadius: 16`, `background: '#2F2F2F'`, `backdropFilter: 'blur(28px)'`, `padding: '8px 4px'`
- 菜单项：`rounded-lg px-2 py-1.5 text-[13px]`, `hover:bg-white/10`

### 6.4 默认值与选项

| 字段 | 默认值 | 选项 |
|------|--------|------|
| 模型 | 首个 | 硬编码 1 个模型（暂定 `HuoShan-画质增强`） |
| 分辨率 | `1080P` | `1080P`、`2K`、`4K` |
| 帧率 | `自适应(原帧数)` | `自适应(原帧数)`、`30fps`、`60fps`、`90fps`、`120fps` |

### 6.5 面板内 useState 管理
面板内部用 `useState` 管理三个选项的选中值（`selectedModel` / `selectedResolution` / `selectedFps`），非直接写死 UI，为后续参数透传预留结构。

### 6.6 HD 按钮激活态

视频节点工具栏「高清」按钮新增激活态：
- `hdPanelOpen=true` 时：按钮背景 `var(--canvas-controls-hover)`，或 `background: rgba(255,255,255,0.1)`
- `hdPanelOpen=false` 时：恢复默认透明背景
- 实现方式：通过 prop 传入 `hdPanelOpen` 状态

---

## 七、事件冒泡阻断

面板根元素声明 `className="nodrag nopan"`（项目惯用方案，与 `VideoTrimPanel.tsx:777`、`VideoNodeToolbar.tsx:144` 一致）：
- `nodrag`：阻止面板内交互触发节点拖拽
- `nopan`：阻止面板内交互触发画布平移
- 下拉菜单通过 `getPopupContainer` 渲染到面板内部，继承 `nodrag nopan` 特性

---

## 八、提交按钮状态位

```typescript
interface SubmitState {
  disabled: boolean;   // 无 fileId 时自动禁用
  loading: boolean;    // 一期预留，默认 false
}
```

- 按钮样式：`bg-[#4ade80]` 圆角方形，含向上箭头 SVG
- disabled：`opacity-50 cursor-not-allowed`
- loading：显示 spinner 替代箭头
- 点击时追加 `e.stopPropagation()` 防止冒泡

---

## 九、面板互斥显性逻辑

`VideoConfigPanel` 渲染条件追加 `&& !hdPanelOpen`：

```tsx
// 现有条件 (VideoGenNode.tsx:795)
{!trimMode && selected && !fileId && !referenceVideo && (
// 改为 ↓
{!trimMode && selected && !fileId && !referenceVideo && !hdPanelOpen && (
  <VideoConfigPanel nodeId={id} />
)}
```

---

## 十、渲染条件与状态管理

### 10.1 VideoGenNode 改动点

```tsx
// 解构 NodeProps 新增 dragging
function VideoGenNodeComponent({ id, selected, dragging }: NodeProps) {

// 状态声明
const [hdPanelOpen, setHdPanelOpen] = useState(false);

// isSingleSelected — 已有 (line 60)，无需新增
const isSingleSelected = selected && getNodes().filter((n) => n.selected).length === 1;

// 关闭条件 effect：selected / isSingleSelected / dragging
useEffect(() => {
  if (!selected || !isSingleSelected || dragging) {
    setHdPanelOpen(false);
  }
}, [selected, isSingleSelected, dragging]);

// ESC 关闭（仅在无输入框焦点时生效）
useEffect(() => {
  if (!hdPanelOpen) return;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;
      setHdPanelOpen(false);
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [hdPanelOpen]);

// 渲染条件：isSingleSelected && fileId && hdPanelOpen && !dragging
{isSingleSelected && fileId && hdPanelOpen && !dragging && (
  <div className="nodrag nopan absolute -bottom-4 left-1/2 -translate-x-1/2 translate-y-full z-20 w-full min-w-[420px] max-w-[430px]">
    <VideoHDPanel nodeId={id} fileId={fileId} />
  </div>
)}
```

### 10.2 Toolbar HD 按钮改动

```typescript
// 新增 prop
onHD?: () => void;
hdPanelOpen?: boolean;   // 控制激活态样式

// HD 按钮
<button
  type="button"
  style={{
    ...BTN_STYLE,
    ...(hdPanelOpen ? { background: 'var(--canvas-controls-hover)' } : {}),
  }}
  onClick={onHD}
>
  <HDIcon />
  <span>高清</span>
</button>
```

---

## 十一、积分展示规则

一期底部积分采用**固定占位值 `11`**，不随模型/分辨率/帧率选项变化。仅做 UI 占位，后续对接后端计费系统时再接入动态计算。

---

## 十二、一期不做

- 点击面板外部区域自动关闭
- 实际的后端 API 调用
- 提交触发实际的视频超分任务
- 积分动态计算
- 面板随画布缩放保持固定物理像素（Portal 方案）
- i18n 文案抽离（项目目前无 i18n 基础设施）

---

## 十三、文件清单

| 文件 | 操作 |
|------|------|
| `apps/web/src/pages/canvas/components/nodes/VideoHDPanel.tsx` | **NEW** — 高清面板组件 |
| `apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx` | **MODIFY** — 解构 dragging + hdPanelOpen 状态 + 渲染 + effect |
| `apps/web/src/pages/canvas/components/nodes/VideoNodeToolbar.tsx` | **MODIFY** — 新增 onHD/hdPanelOpen prop + HD 按钮激活态 |
