# 规格说明：修复 ImageGenNode 5 个预存失败测试 + outpaint 补退出按钮

**日期**：2026-08-18
**状态**：待确认

## 背景

`ImageGenNode.test.tsx` 有 5 个测试在 HEAD 上即失败（git stash 验证），全量测试 1496/1501。根因调查（含 git 考古）结论：

| # | 失败测试 | 根因 | 定性 |
|---|---|---|---|
| 1 | floating upload container nodrag/nopan | 上传按钮从 portal 渲染改为 inline 渲染（`ImageNodeToolbar.tsx:393`，有意变更：避免 portal 裁剪） | 测试过期 |
| 2 | transform 模式显式 img 尺寸 | `54e28e7` 重构：旧方案「显式像素尺寸 + maxWidth/maxHeight:none」（`2e95627`）被替换为「width/height:100% + objectFit:cover + 容器宽高互换」 | 测试断言旧实现细节 |
| 3 | outpaint「生成」「退出」文案 | 工具栏重设计为 Win11 风格：生成按钮图标化（`data-testid="outpaint-generate"`）；无退出按钮（仅 ESC） | 测试过期 + UX 缺口 |
| 4 | outpaint fetch 未调用 | 同 #3：找不到文字「生成」按钮，点击链路未触发 | 测试过期 |
| 5 | resize-control testid 缺失 | React Flow `NodeResizeControl` 不转发 `data-testid` 到 DOM（库源码确认：仅渲染 className/style/children） | 测试从未绿过；3 个「不渲染」姊妹测试是**假绿** |

## 用户决策（已确认）

outpaint 模式补「退出」按钮（与 crop/erase/redraw 模式一致），推翻 `EditToolbar.test.tsx:80-81` 记录的旧设计（"Should NOT render text-based 退出"），该断言同步更新。

## 改动明细

### 改动 1（仅测试）：上传容器 nodrag/nopan 断言

`ImageGenNode.test.tsx` L284-292：从「在 `#node-toolbar-portal` 中查 `.nodrag`」改为「在 document 中定位『上传』按钮并断言其最近 `.nodrag` 祖先含 `nopan`」：

```tsx
const uploadBtn = screen.getByText('上传');
const container = uploadBtn.closest('.nodrag');
expect(container).toBeTruthy();
expect(container?.classList.contains('nopan')).toBe(true);
```

### 改动 2（仅测试）：transform 模式 img 尺寸断言

`ImageGenNode.test.tsx` L340-348：断言从旧方案细节（maxWidth:'none' 等）更新为新方案行为：

```tsx
expect(img.style.width).toBe('100%');
expect(img.style.height).toBe('100%');
expect(img.style.objectFit).toBe('cover');
```

（旧断言 `maxWidth === 'none'` 对 `width:100%` 无意义——max-w-full 不约束 100% 宽。transform 属性正确性已由 L332-338 姊妹测试覆盖，不重复。）

### 改动 3（实现 + 测试）：outpaint 工具栏补「退出」按钮

**实现** `EditToolbar.tsx` outpaint 分支：左侧组（重置按钮之前）加退出按钮——`SmallArrowLeftIcon` + 文字「退出」，`onClick={onCancel}`，`disabled={isSaving}`，样式与 `PaintToolbar` 退出按钮一致（L152-162）。

**测试**：
- `ImageGenNode.test.tsx` L430-436：断言改为 `portalRoot.textContent` 含「退出」+ `portalRoot.querySelector('[data-testid="outpaint-generate"]')` 存在。
- `EditToolbar.test.tsx` L77-89：更新断言——退出按钮存在（`getByText('退出')`），其余 reset/PRO/ratio 断言保留。

### 改动 4（仅测试）：outpaint 生成请求测试

`ImageGenNode.test.tsx` L438-455：`genBtn` 查找方式从「文字含『生成』」改为 `[data-testid="outpaint-generate"]`，断言不变（`/api/image-edit/outpaint` + body 含 `"rect"`）。

### 改动 5（实现 + 测试）：resize 标识改用 className

**实现** `ImageGenNode.tsx` L1138-1152：`NodeResizeControl` 的 `data-testid={`resize-control-${corner}`}` 改为 `className={`resize-control-${corner}`}`（库转发 className，吞掉 data-testid）。

**测试** `ImageGenNode.test.tsx` L578-597 及 3 个「不渲染」测试（L569-576, L587-591, L593-597）：`getByTestId/queryByTestId` 改为 `container.querySelector('.resize-control-top-left')` 等 class 查询——同时修复 3 个假绿测试。

## 明确不改动

- transform 渲染架构（100%+cover+宽高互换方案保持）
- outpaint Win11 风格工具栏其余设计（PRO/2K/1张 占位、比例切换、credits 显示）
- `NodeHandle` 的 testId（自定义组件，转发正常）

## 验证标准

1. `pnpm test src/pages/canvas/components/nodes/ImageGenNode` → 40/40 通过
2. `pnpm test src/pages/canvas/components/nodes/EditToolbar` → 全部通过
3. `cd apps/web && pnpm test` 全量 → 1501/1501
4. 浏览器验证（如登录态可用）：画布中选中带图节点 → 工具栏正常；扩图模式 → 退出按钮可见可点、ESC 仍可退出；裁剪/擦除/重绘不受影响。若登录不可用，以单元测试为准并说明。
