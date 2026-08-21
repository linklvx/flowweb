# Plan: TD-4 持久化防抖慢请求覆盖窗口收口（子批 3d）

日期：2026-08-21
Spec：docs/superpowers/specs/td4-hydrate-window-seal.md（已确认：D1=方案 A，D2=纳入慢 fetch 验证，C1-C3/S1/S2 已落实）
总原则：TDD 先红后绿；遮罩 + 键盘守卫最小实现，不动 isHydrating 接口本身与 loadProjectIntoStore。

## 任务 1：遮罩实现 + 测试

- page.test.tsx mock 基建扩展（注入点已核实，C1）：3c 批次已为 mock 的 selector state 与 getState 补过 `isHydrating: false` 字面量与 `setHydrating: vi.fn()`；selector 调用已支持（mock 工厂 `if (typeof selector === 'function') return selector(state)`）。本批仅将两处字面量改为可变 `let mockIsHydrating`（仿 mockCanvasNodes 模式），beforeEach 重置
- CanvasPageInner（page.tsx）：
  - `const isHydrating = useCanvasStore((s) => s.isHydrating);`
  - 根 div 末尾条件渲染遮罩：`absolute inset-0 z-40` 半透明底 + Spin + 「画布加载中」，`role="status"` + `aria-live="polite"` + `data-testid="hydrate-overlay"`
- 测试（先红，page.test.tsx 新 describe）：
  - `mockIsHydrating=true` → overlay 存在（getByRole('status')）、className 含 `inset-0` 与 `z-40`、**`not.toHaveClass('pointer-events-none')`**（C2：类名断言而非 getComputedStyle——jsdom computed style 不完整；默认 auto 即阻断）、`aria-live="polite"`（jsdom 无布局，真实命中测试归任务 4 浏览器）
  - `mockIsHydrating=false` → queryByRole('status') 为 null
  - beforeEach 重置 mockIsHydrating

## 任务 2：键盘守卫 + 测试

- CanvasKeyboardHandler.handleKeyDown 首行：`if (useCanvasStore.getState().isHydrating) return;`
- 测试（先红；挂载点已核实，C3：handler 监听挂 `document`，fireEvent 目标用 `document`）：
  - `mockIsHydrating=true` → `fireEvent.keyDown(document, { key: 'Tab' })` → menuStore `isOpen` 保持 false
  - `mockIsHydrating=false` → 同上 Tab → `isOpen` true（用后重置 close）

## 任务 3：全量回归

- `pnpm --filter @flowweb/web test` 全绿
- `tsc -b` 无新错误

## 任务 4：浏览器慢 fetch 验证（2s 延迟注入）

1. 注入：wrap `window.fetch`，匹配 `/api/projects/` 的 GET 延迟 2s
2. A→B 切换（?projectId=B），窗口内断言：
   - 遮罩可见（data-testid 存在且覆盖视口中心点击——真实 elementFromPoint 命中遮罩）
   - 点击画布 / Tab 无效果（节点数不变、菜单不开）
   - localStorage v2 key 内容与切换前一致（3c 写抑制回归）
3. fetch 返回后断言：遮罩消失、B 数据完整渲染
4. 清理 monkey-patch

## 任务 5：台账清账 + 原子 commit

- tech-debt.md：TD-4 段移除，入已清账（双引用：3c 写侧抑制 8be333a + 本批遮罩收口）；批次建议 3d 标记完成（第三批全部收官）
- 单原子 commit（实现 + 测试 + 台账 + spec/plan）：

```
feat(web): block canvas interaction during hydration window (TD-4)

- slow fetch could clobber user edits made during project switch (canvas
  cleared but still interactive while projectId state lagged); overlay
  driven by isHydrating (built in 8be333a) seals the window by making
  edits impossible; keyboard guard covers Tab-menu path that pointer
  overlay cannot block
- read-side closure of TD-4; write-side suppression landed in 3c
```

- commit 后回填 hash 至台账已清账行（微 docs commit，3c 批次 aeaeb97 先例）

## 回滚路径

单 commit revert → 遮罩/守卫整体移除；isHydrating 接口保留（3c 写侧抑制仍在用，不受影响）。
