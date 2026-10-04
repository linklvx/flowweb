<!-- doc-status: historical | verified_at: n/a -->
# 实施计划：修复 ImageGenNode 5 个预存失败测试 + outpaint 补退出按钮

**日期**：2026-08-18（已按审核意见修订）
**Spec**：`docs/superpowers/specs/2026-08-18-fix-imagegen-stale-tests.md`
**验证命令**：`cd apps/web && pnpm test <文件过滤>`

## 现状确认（审核意见核实结论，已逐一验证源码）

1. **onCancel / isSaving 均为 `EditToolbarProps` 现有必传 prop**（`EditToolbar.tsx:8-11`：`isSaving: boolean`、`onCancel: () => void`）。`ImageGenNode.tsx:1011,1014` 已传 `isSaving={isProcessing}`、`onCancel={handleEditCancel}`。`handleEditCancel`（L548-556）即"退出 editMode + 清 activeEditNodeId"逻辑，outpaintRect 由 L898-902 effect 自动重置。crop/PaintToolbar 退出按钮与 ESC 键均复用同一 `onCancel`。**无需新增 prop，无 ImageGenNode 侧改动**。
2. **`NodeResizeControl`（ImageGenNode.tsx L1139-1152）无现有 className 属性**，仅 `style={HANDLE_STYLE}` 与 `data-testid`。改为 `className` 是新增属性，由库 `cc()` 合并追加（`react-flow__resize-control nodrag <position> <className>`），不覆盖任何样式。
3. **`EditToolbar.test.tsx` L91-97**（outpaint 不渲染 undo/clear/save）断言的是「撤销/清除/保存」，无「退出」——加退出按钮后不受影响，不动。L169-173（退出 disabled 测试）基于 `baseProps.editMode='crop'`，与 outpaint 无关，不动。
4. **全量基线**：2026-08-18 21:12 实测 123 文件 / 1501 测试（1496 通过 + 5 失败）。本轮所有 Task 仅修改断言、不增删用例，完成后应恰为 **1501/1501**。

## Task 1 — outpaint 退出按钮（红-绿）

**红 1**：`EditToolbar.test.tsx` L80-81（`renders reset button, PRO placeholder...`）：
- L81 `expect(screen.queryByText('退出')).not.toBeInTheDocument()` → `expect(screen.getByText('退出')).toBeInTheDocument()`
- L82 `保存为新变体` 断言保留；L84-88 reset/PRO/1.2x 断言保留。

运行 `pnpm test src/pages/canvas/components/nodes/EditToolbar` → 失败（无「退出」）。

**红 2**：`ImageGenNode.test.tsx` L430-436：

```tsx
expect(portalRoot.textContent).toContain('退出');
expect(portalRoot.querySelector('[data-testid="outpaint-generate"]')).toBeTruthy();
```

运行 → 失败。

**绿**：`EditToolbar.tsx` outpaint 分支左侧组最前（「重置扩图」按钮之前、L366 `<div className="flex items-center gap-1">` 内首位）插入退出按钮——**完整复制 `PaintToolbar` 退出按钮（L153-162）的 className 与 style**，仅此一处新增：

```tsx
<button
  type="button"
  className="inline-flex select-none items-center justify-center rounded-lg transition-colors h-7 gap-1 px-3 py-1.5 hover:bg-[rgba(255,255,255,0.08)] active:bg-[rgba(255,255,255,0.1)] cursor-pointer border-0"
  style={{ backgroundColor: 'transparent', color: TEXT_COLOR }}
  onClick={onCancel}
  disabled={isSaving}
>
  <SmallArrowLeftIcon />
  <span className="text-[13px] leading-[1.4]">退出</span>
</button>
```

与左侧组后续「重置扩图」按钮之间无分隔线（PaintToolbar 内退出与工具组间有分隔线 `L164`；此处与重置按钮同为文本/图标操作按钮，样式自然衔接，不加 divider）。

运行两个测试文件 → 通过。

## Task 2 — outpaint 生成请求测试定位（纯测试修正）

`ImageGenNode.test.tsx` L445-447：

```tsx
const genBtn = portalRoot.querySelector('[data-testid="outpaint-generate"]');
if (genBtn) fireEvent.click(genBtn);
```

运行 `pnpm test src/pages/canvas/components/nodes/ImageGenNode -t "outpaintRect"` → 通过。

## Task 3 — resize 标识 className 化（红-绿）

**红**：`ImageGenNode.test.tsx` resize 相关 4 个测试改 class 查询（`renderNode` 需解构 `const { container } =`）：
- L578-585（render 4 corners）：`screen.getByTestId('resize-control-top-left')` → `container.querySelector('.resize-control-top-left')` × 4 角，断言 `toBeTruthy()`。
- L569-576 / L587-591 / L593-597（NOT render 系列）：`screen.queryByTestId(...)` → `container.querySelector('.resize-control-top-left')` 断言 `toBeNull()`。

运行 `pnpm test src/pages/canvas/components/nodes/ImageGenNode -t "resize"` → "should render 4 corner" 失败（DOM 无该 class）；3 个 NOT render 通过（断言自此有效，假绿修复）。

**绿**：`ImageGenNode.tsx` L1151：`data-testid={`resize-control-${corner}`}` → `className={`resize-control-${corner}`}`（现状确认 #2：无覆盖风险）。

运行 → 4 个测试全通过。

## Task 4 — 上传容器 nodrag/nopan 断言（纯测试修正）

`ImageGenNode.test.tsx` L284-292：

```tsx
renderNode(true);
const uploadBtn = screen.getByText('上传');
const container = uploadBtn.closest('.nodrag');
expect(container).toBeTruthy();
expect(container?.classList.contains('nopan')).toBe(true);
```

运行 → 通过（inline 容器 `ImageNodeToolbar.tsx:396` 现有 `nodrag nopan` class）。

## Task 5 — transform 模式 img 尺寸断言（纯测试修正）

`ImageGenNode.test.tsx` L340-348：

```tsx
expect(img.style.width).toBe('100%');
expect(img.style.height).toBe('100%');
expect(img.style.objectFit).toBe('cover');
```

运行 → 通过（`ImageGenNode.tsx:1184-1188` 现有实现）。

## Task 6 — 全量验证

1. `pnpm test src/pages/canvas/components/nodes/ImageGenNode` → 40/40。
2. `pnpm test src/pages/canvas/components/nodes/EditToolbar` → 全部通过。
3. `cd apps/web && pnpm test` 全量 → **1501/1501**（基线见现状确认 #4）。
4. 浏览器验证（登录态可用时）：画布选中带图节点 → 四角 resize 手柄正常；扩图模式 → 退出按钮可见可点、点击后回到普通工具栏、ESC 仍可退出；裁剪/擦除/重绘工具栏不受影响。登录不可用则以单测为准并在总结中说明。

## 文件变更汇总

| 文件 | Task | 动作 |
|---|---|---|
| `apps/web/src/pages/canvas/components/nodes/EditToolbar.test.tsx` | 1 | L81 退出断言反转（queryByText null → getByText 存在） |
| `apps/web/src/pages/canvas/components/nodes/ImageGenNode.test.tsx` | 1,2,3,4,5 | L430-436 断言更新；L445-447 定位改 data-testid；resize 4 测试改 class 查询；L284-292 改 document 范围；L340-348 改新方案断言 |
| `apps/web/src/pages/canvas/components/nodes/EditToolbar.tsx` | 1 | outpaint 左侧组首位插入退出按钮（复用 onCancel/isSaving 现有 prop） |
| `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx` | 3 | L1151 `data-testid` → `className` |

## 提交

`fix: repair 5 stale ImageGenNode tests and add outpaint exit button`
