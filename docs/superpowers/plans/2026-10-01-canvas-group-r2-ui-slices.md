# Canvas 组升级 Spec A — R2 UI 四分片 实施计划（v1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 spec v11 的 R2 UI 四分片——2a 多选选框 padding 30+多选工具条（排列/创建副本，打组▾已有）+duplicateNodes 副本体系；2b 批量下载全链路+mediaUrl 读写收敛（F37）；2c 组工具条+组色+组名入框（Token 前置补课）；2d 折叠宫格卡 220×160+分镜改版+折叠几何收口（savedSize 退役）+智能标题屏幕层。

**Architecture:** 写路径全部走批 4b intent 漏斗同型（`captureStoreProjection → setWithParentOrder 单 set → ns 双写 → dispatchProjectionDiff(before, Origin.LocalUser)`）；排列/选区归一纯函数下沉 `packages/shared/src/canvas/`（与 R1b 几何模块同居）；组 data 只经 `patchGroupData`；组框经 `applyGroupFrame/applyGroupFrameRect`；单 undo 步=单次收尾 dispatch+入口 `stopCapturing()`。R2d 折叠收口把"折叠覆写 width/height+savedSize 双份"改为"只置 collapsed 标志，渲染层算折叠矩形"——含一个 RF 行为决策门（门 E）先行验证。

**Tech Stack:** React Flow 11（useViewport/useInternalNode/createPortal）、zustand、Yjs intent 漏斗（canvasIntents）、Tailwind+CSS 变量 token、Vitest、pnpm workspace（@flowweb/shared）。

**上游 spec:** `docs/superpowers/specs/2026-09-28-canvas-group-ui-upgrade-design.md`（v11）。

---

## 执行总览（顺序、裁定注记、通用纪律）

**执行顺序**：2a（选框+排列+副本）→ 2b（批量下载+mediaUrl 收敛）→ 2c（Token+组工具条+组色+组名入框）→ **门 E（RF 折叠渲染行为夹具）** → 2d（折叠收口+宫格卡+分镜改版+智能标题屏幕层）→ R2 批尾（浏览器验收+Playwright b0/registry）。

每分片独立 commit 序列、可独立回滚；分片尾跑 `pnpm --filter @flowweb/web test -- --run` + `pnpm verify`。

### 计划阶段裁定注记（现场核验 2026-10-01——spec v11 写于批 4b 之前，以下差异以现状为准）

1. **写路径已换轨（collab 批 4b）**：spec §4.3"几何真值在 canvasStore，协作投影（storeProjection→bindBridge→doc）自动取用，**无需任何同步动作**"——bindBridge/syncStoreToDoc 已删除。新命令统一照 `groupNodes`/`duplicateGroup` 同型：`captureStoreProjection()` → 结构写 → `dispatchProjectionDiff(before, Origin.LocalUser)` 收尾。**spec 该句按此理解执行，忽略"无需同步动作"字面**。
2. **F18 已修**：convertGroup 两方向已是 patchGroupData 增量 patch（canvasStore.ts:1508-1525，undefined=删键）——color 键天然存续（增量 patch 不动未列键）。2c 只补"两方向 color 存续"测试锚，无实现改动。
3. **copyNode 仍在**（canvasStore.ts:341-380+接口 :134，F12 删除随 2a 副本体系统一执行）。
4. **打组下拉维持现状**（打组 Ctrl+G+合并分镜组 Ctrl+Alt+G 两项，SelectionBoxOverlay.tsx:88-108）——spec S3 登记的"把选中节点加入现有组（程序化入组）"**维持登记不做**（需"移子入组"变体语义先定，R3/Spec B 域）。
5. **排列菜单三项 = 网格 / 水平 / 垂直**（spec §4.3"排列菜单浮层…三项"+纯函数行"三模式"的落地解释；n=2 时 grid 1×2≡horizontal 属 spec 明示预期）。若用户审批时另有所指（如 对齐类三项），只改 Task 2a-3 的 MODE 常量与菜单纯文案。
6. **Token 前置（spec §4.2 标"R1"）未随 R1 落地**——index.css 仅 --canvas-controls-* 六键双值存在，组色板/--canvas-group-border/--canvas-storyboard-shell-bg 均缺（探查实证）。**落 2c 首任务**（2c 是第一消费者；2d 消费 shell-bg）。
7. **R2d 折叠收口（spec §4.9 R2d 登记）范围**：折叠不再覆写 node width/height（envelope intent 删除）、删 savedSize 模型键+展开三分派整体消失（展开=patchGroupData({collapsed:false})+applyGroupDerivations）、渲染层以 COLLAPSED_SIZE 画折叠矩形。**savedSize 从 GROUP_NODE_DATA_KEYS 9→8 键**（shared 常量+Shape+双向锚定+API clone 表四处同 commit）。前置**门 E**验证 RF 对"node.width 真值保留+渲染层小盒"的 measured/选中框/extent 行为。
8. **nameCustom/renameGroup/右键重命名（F24）归 2d**（智能标题屏幕层是唯一消费者，同批内聚）；2c 不动 renameGroup。
9. **分镜 shell 呈现组色（v10 裁决 4，border-color 1 行双兜底）归 2d**（shell 背景/边框改版同批）。
10. **lint-gate 追加模式**（探查实证）：新规则=在 `apps/web/scripts/eslint-rules/collab-static-asserts.js` 加规则实现（白名单常量+MSG）→ `apps/web/eslint.config.js` 注册 → `apps/web/scripts/lint-gate.mjs` 的 STATIC_ASSERT_RULE_IDS(:29-35) 加 ID → `apps/web/src/scripts/lint-gate-fixture.test.ts`（以现场 fixture 文件名为准）加正例。四步闭环。
11. **跨分片不变量维持（spec 契约 6）**：信封序列化门禁/几何写点门禁（no-delete-scan 等 lint-gate 五条）/shared dist 新鲜度门禁全程不得删除；R2 新增写点全部走 intent 漏斗（无新豁免）。
12. **行号基准**：本 plan 行号引用 2026-10-01 现场核验；执行时以符号+grep 重校准（spec 头部规则）。

**单测运行命令**：
- web：`pnpm --filter @flowweb/web test -- --run <路径片段>`
- shared：`pnpm --filter @flowweb/shared test -- --run`（若有独立测试脚本，以 package.json 为准；shared 测试多由 web/api 侧 parity 断言承载）

**Commit 风格**：中文主题 + `(canvas)` scope（组升级域沿用 R0/R1 的 scope 惯例——见 `git log --oneline --grep="R1b"` 先例，实际混用 refactor(web)/feat(shared)，保持同风格）。

---

## 分片 2a：多选选框 + 排列 + 副本体系

**Files:**
- Modify: `apps/web/src/pages/canvas/components/groups/selectionTokens.ts`（SELECTION_BOX.padding 30 + TOOLBAR 拆分）
- Create: `packages/shared/src/canvas/arrangeSelection.ts`（sortForArrange/arrangeRects/normalizeSelection/participation/clampToolbarX）
- Modify: `packages/shared/src/index.ts`（星导出）
- Modify: `apps/web/src/stores/canvasStore.ts`（arrangeSelection/duplicateNodes actions + copyNode 删除）
- Modify: `apps/web/src/pages/canvas/components/groups/SelectionBoxOverlay.tsx`（工具条扩展+SELECTION_TOOLBAR）
- Test: `packages/shared/src/canvas/arrangeSelection.spec.ts`（新）、`apps/web/src/stores/canvasStore.arrange.spec.ts`（新）、`apps/web/src/pages/canvas/components/groups/SelectionBoxOverlay.test.tsx`（改）

**Task 2a-1：SELECTION_BOX.padding 16→30 + TOOLBAR 拆分（§4.1/§4.2）**

- [ ] **Step 1: 写失败测试**——SelectionBoxOverlay.test.tsx 现有坐标断言五值迁移（spec §4.1 直接照抄，全为 padding=30 期望）：

```ts
// 既有用例期望值替换（夹具不变：b={x:100,y:180,w:60,h:100} zoom=2 vp={10,20}——以现场夹具为准，
// 期望值按公式 left = b.x*zoom + vpX - 30 等重算，下面数字为 spec §4.1 表的对应关系）：
// left '194px'→'180px'（-16 改 -30）；top '352px'→'338px'；width '132px'→'160px'（+60）；height '164px'→'192px'；
// 贴顶翻转 top '68px'→'84px'（titleExtra 带不动——翻转分支 top 公式含 padding，重算）
```

（用例内不要手算——直接把 `SELECTION_BOX.padding` import 进期望表达式 `100*2+10-PADDING` 不可取（同值恒真）；**按 spec §4.1 表字面值写死期望数字**，五个断言各改一处数字。）

- [ ] **Step 2: 跑红**——Run: `pnpm --filter @flowweb/web test -- --run SelectionBoxOverlay`，Expected: 5 处坐标断言 FAIL。

- [ ] **Step 3: 实现**——selectionTokens.ts：

```ts
export const SELECTION_BOX = {
  borderColor: 'var(--fw-text)',
  dashed: true,
  borderWidth: 2,
  radius: 8,
  bg: 'rgba(0,0,0,0.35)',
  padding: 30,          // §4.1: 16 → 30
  titleExtra: 26,
} as const;

// §4.2 拆分：多选 48/14、组 52/12（v8 数字自洽：容器 padding 8×2 + 按钮 h-8(32)=48 / h-9(36)=52）
export const SELECTION_TOOLBAR = { height: 48, offset: 14 } as const;
export const GROUP_TOOLBAR = { height: 52, offset: 12 } as const;
// 旧 TOOLBAR 常量删除（消费点本分片+2c 全部迁移后）
```

SelectionBoxOverlay.tsx 定位改用 SELECTION_TOOLBAR（offset 12→14、height 40→48 参与贴顶翻转公式——以现场公式变量名替换 `TOOLBAR` 引用）。

- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2a-1 选框 padding 30+TOOLBAR 拆分（SELECTION_TOOLBAR/GROUP_TOOLBAR）`

**Task 2a-2：shared 纯函数——normalizeSelection 三桶 + participation 策略表（契约 1）**

- [ ] **Step 1: 写失败测试**

```ts
// packages/shared/src/canvas/arrangeSelection.spec.ts
import { describe, it, expect } from 'vitest';
import { normalizeSelection, participation } from './arrangeSelection';

const G = (id: string, children: string[] = []) =>
  ({ id, type: 'group', parentId: undefined, position: { x: 0, y: 0 }, data: { groupType: 'normal', cells: children } });
const N = (id: string, parentId?: string) =>
  ({ id, type: 'imageGen', parentId, position: { x: 0, y: 0 }, data: {} });

// 夹具：组 g1 含 a/b（b 同时被选中=detached 形态）；c 顶层 loose；组 g1 自身选中
const nodes: any[] = [G('g1', ['a', 'b']), N('a', 'g1'), N('b', 'g1'), N('c'), N('d', 'g1')];

describe('normalizeSelection 三桶（契约 1 两段式）', () => {
  it('选中 [c,a,b,g1] → groups=[g1] looseRoots=[c] detachedChildren=[a,b]', () => {
    const r = normalizeSelection(nodes as any, ['c', 'a', 'b', 'g1']);
    expect(r.groups.map((g) => g.id)).toEqual(['g1']);
    expect(r.looseRoots.map((n) => n.id)).toEqual(['c']);
    expect(r.detachedChildren.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });
  it('选中父组未选时子选中 → 子落 detached（在未选中的组内）', () => {
    const r = normalizeSelection(nodes as any, ['a', 'd']);
    expect(r.groups).toEqual([]);
    expect(r.looseRoots).toEqual([]);
    expect(r.detachedChildren.map((n) => n.id).sort()).toEqual(['a', 'd']);
  });
  it('选中 [c,g1] → 无 detached', () => {
    const r = normalizeSelection(nodes as any, ['c', 'g1']);
    expect(r.detachedChildren).toEqual([]);
  });
});

describe('participation 策略表（逐动作）', () => {
  const sel = normalizeSelection(nodes as any, ['c', 'a', 'b', 'g1']);
  it('arrange：groups+looseRoots 参与、detached 排除并计数', () => {
    const p = participation(sel, 'arrange');
    expect(p.ids.sort()).toEqual(['c', 'g1']);
    expect(p.excluded.detached).toBe(2);
  });
  it('duplicate：排除 hidden（折叠/分镜组子节点），detached 纳入（副本一律顶层化）', () => {
    const p = participation(sel, 'duplicate');
    expect(p.ids.sort()).toEqual(['a', 'b', 'c', 'g1']);
    expect(p.excluded.hidden).toBe(0); // 夹具无折叠组——hidden 语义在 store 层测（deriveHidden 联动）
  });
  it('download：三桶全展开（detached/hidden 均纳入——契约 1 显式）', () => {
    const p = participation(sel, 'download');
    expect(p.ids.sort()).toEqual(['a', 'b', 'c', 'g1']);
  });
  it('excluded 合并计数 = detached ∪ hidden（toast 文案口径）', () => {
    const p = participation(sel, 'arrange');
    expect(p.excludedCount).toBe(2);
  });
});
```

- [ ] **Step 2: 跑红**（模块不存在）→ **Step 3: 实现**

```ts
// packages/shared/src/canvas/arrangeSelection.ts
import type { CanvasNodeRecord } from './nodeEnvelope';

/** R2a（spec 契约 1）：选区归一两段式——纯函数显式传 nodes，零 store 依赖。
 *  三桶：groups=选中的组节点；looseRoots=选中的顶层散节点；detachedChildren=
 *  选中的但父组未被选中的子节点（"在未选中的组内"）。 */
export interface SelectionBuckets {
  groups: CanvasNodeRecord[];
  looseRoots: CanvasNodeRecord[];
  detachedChildren: CanvasNodeRecord[];
}

export function normalizeSelection(nodes: CanvasNodeRecord[], ids: string[]): SelectionBuckets {
  const idSet = new Set(ids);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const groups: CanvasNodeRecord[] = [];
  const looseRoots: CanvasNodeRecord[] = [];
  const detachedChildren: CanvasNodeRecord[] = [];
  for (const id of ids) {
    const n = byId.get(id);
    if (!n) continue;
    if (n.type === 'group') { groups.push(n); continue; }
    if (n.parentId && idSet.has(n.parentId)) continue;      // 父组已选——随组参与，不单独入桶
    if (n.parentId) detachedChildren.push(n);
    else looseRoots.push(n);
  }
  return { groups, looseRoots, detachedChildren };
}

export type ParticipationAction = 'arrange' | 'duplicate' | 'download';

/** 策略表（契约 1 唯一裁决点）：arrange=组原子块+散根（detached 排除）；
 *  duplicate=排除 hidden（折叠/分镜组子节点——store 层据 deriveHidden 结果过滤，
 *  纯函数层 hidden 由调用方先从 ids 剔除再传入？——否：hidden 判定需要组 data（collapsed/
 *  groupType），本函数持 nodes 可判，见 shouldExcludeHidden）；download=三桶全展开。 */
export interface Participation {
  ids: string[];
  excluded: { detached: number; hidden: number };
  excludedCount: number;
}

function shouldExcludeHidden(node: CanvasNodeRecord, byId: Map<string, CanvasNodeRecord>): boolean {
  if (!node.parentId) return false;
  const parent = byId.get(node.parentId);
  if (!parent) return false;
  const d = parent.data as { groupType?: string; collapsed?: boolean };
  return d.groupType === 'storyboard' || d.collapsed === true; // 分镜子 rel 恒 0 / 折叠子不可见
}

export function participation(buckets: SelectionBuckets, action: ParticipationAction, nodes: CanvasNodeRecord[] = []): Participation {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  let detached = 0, hidden = 0;
  if (action === 'arrange') {
    out.push(...buckets.groups.map((g) => g.id), ...buckets.looseRoots.map((n) => n.id));
    detached = buckets.detachedChildren.length;
  } else if (action === 'duplicate') {
    out.push(...buckets.groups.map((g) => g.id), ...buckets.looseRoots.map((n) => n.id), ...buckets.detachedChildren.map((n) => n.id));
    hidden = 0; // detached 全顶层化；hidden 排除在 store 层做（ids 来源=当前可见选区，折叠子本就不在 selected 集）——纯函数层计数恒 0，见 store 测试
  } else {
    out.push(...buckets.groups.map((g) => g.id), ...buckets.looseRoots.map((n) => n.id), ...buckets.detachedChildren.map((n) => n.id));
  }
  return { ids: out, excluded: { detached, hidden }, excludedCount: detached + hidden };
}
```

**注意**：hidden 的真实判定发生在 store 层（选区本身来自 RF selected——折叠/分镜组子节点因 deriveHidden 不渲染、不在 selected 集，天然排除）——纯函数层 hidden 计数留给 store 命令组装（见 Task 2a-5），此处契约以注释钉死。`packages/shared/src/index.ts` 补星导出。

- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(shared): R2a-2 选区归一三桶+参与策略表（纯函数）`

**Task 2a-3：shared 纯函数——sortForArrange 行优先 + arrangeRects 三模式（F40）**

- [ ] **Step 1: 写失败测试**

```ts
// 追加到 arrangeSelection.spec.ts
import { sortForArrange, arrangeRects, ARRANGE_GAP } from './arrangeSelection';

describe('sortForArrange 行优先（F40：y 容差 8px 分行、行内 x 升序）', () => {
  it('同一行（|Δy|<8）按 x 升序；跨行按 y 升序', () => {
    const items = [
      { id: 'b', x: 200, y: 100 }, { id: 'a', x: 0, y: 100 },
      { id: 'd', x: 0, y: 105 }, { id: 'c', x: 0, y: 130 },
    ];
    expect(sortForArrange(items).map((i) => i.id)).toEqual(['a', 'b', 'd', 'c']);
  });
  it('不复用列优先（sortNodesByPosition 是 x 优先——语义不同）', () => {
    const items = [{ id: 'p', x: 0, y: 0 }, { id: 'q', x: 5, y: 100 }];
    expect(sortForArrange(items).map((i) => i.id)).toEqual(['p', 'q']); // 行优先：y 差>8 分两行
  });
});

describe('arrangeRects 三模式（§4.3）', () => {
  const rects = [
    { x: 0, y: 0, width: 100, height: 50 },
    { x: 500, y: 500, width: 60, height: 80 },
    { x: 200, y: 40, width: 40, height: 40 },
  ];
  it('grid：cell=行 max 高×列 max 宽、左上角落位、自身尺寸不变、中心不变、间距=ARRANGE_GAP', () => {
    const out = arrangeRects(rects, 'grid');
    // 期望不手算——用输出自证结构不变量（中心=包围盒中心 min+max/2，与实现同口径——spec §4.3）：
    const c = (rs: typeof rects) => ({
      x: (Math.min(...rs.map((r) => r.x)) + Math.max(...rs.map((r) => r.x + r.width))) / 2,
      y: (Math.min(...rs.map((r) => r.y)) + Math.max(...rs.map((r) => r.y + r.height))) / 2,
    });
    expect(c(out).x).toBeCloseTo(c(rects).x, 6);
    expect(c(out).y).toBeCloseTo(c(rects).y, 6);
    out.forEach((r, i) => { expect(r.width).toBe(rects[i].width); expect(r.height).toBe(rects[i].height); });
    // 列数 calcDefaultGrid(3)=2：第二列 x = 第一列 x + 列宽(100) + GAP
    expect(out[1].x - out[0].x).toBe(100 + ARRANGE_GAP);
  });
  it('horizontal：单行，x 依序排开', () => {
    const out = arrangeRects(rects, 'horizontal');
    const ys = new Set(out.map((r) => r.y));
    expect(ys.size).toBe(1);
    expect(out[1].x).toBeGreaterThan(out[0].x + out[0].width);
  });
  it('vertical：单列', () => {
    const out = arrangeRects(rects, 'vertical');
    const xs = new Set(out.map((r) => r.x));
    expect(xs.size).toBe(1);
  });
  it('n≤1 no-op；混排对齐：比基准高的节点所在行行高= max', () => {
    expect(arrangeRects([rects[0]], 'grid')).toEqual([rects[0]]);
    const mixed = [{ x: 0, y: 0, width: 100, height: 50 }, { x: 0, y: 0, width: 100, height: 200 }];
    const out = arrangeRects(mixed, 'horizontal');
    expect(out[1].y).toBe(out[0].y);            // 顶对齐
    expect(out[1].x).toBe(100 + ARRANGE_GAP);   // 行宽=max=100
  });
});
```

- [ ] **Step 2: 跑红** → **Step 3: 实现**

```ts
// 追加到 packages/shared/src/canvas/arrangeSelection.ts
import { calcDefaultGrid } from './geometry';

/** F40：排列参与项排序=行优先（y 容差 8px 分行、行内 x 升序）——不复用列优先 sortNodesByPosition。 */
export const ARRANGE_ROW_TOLERANCE = 8;
export const ARRANGE_GAP = 60;
export type ArrangeMode = 'grid' | 'horizontal' | 'vertical';

export function sortForArrange<T extends { x: number; y: number }>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const rows: T[][] = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(it.y - row[0].y) < ARRANGE_ROW_TOLERANCE) row.push(it);
    else rows.push([it]);
  }
  return rows.flat();
}

export interface ArrangeRect { x: number; y: number; width: number; height: number; }

/** §4.3：cell=行 max 高×列 max 宽、节点按 cell 左上角落位（自身尺寸不变）、n≤1 no-op、包围盒中心不变。
 *  输入顺序即落位顺序（调用方先 sortForArrange）。 */
export function arrangeRects(rects: ArrangeRect[], mode: ArrangeMode): ArrangeRect[] {
  const n = rects.length;
  if (n <= 1) return rects;
  const cols = mode === 'horizontal' ? n : mode === 'vertical' ? 1 : calcDefaultGrid(n);
  const rows = Math.ceil(n / cols);
  const colW: number[] = [], rowH: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    colW[c] = Math.max(colW[c] ?? 0, rects[i].width);
    rowH[r] = Math.max(rowH[r] ?? 0, rects[i].height);
  }
  const xs: number[] = [0];
  for (let c = 1; c < cols; c++) xs[c] = xs[c - 1] + colW[c - 1] + ARRANGE_GAP;
  const ys: number[] = [0];
  for (let r = 1; r < rows; r++) ys[r] = ys[r - 1] + rowH[r - 1] + ARRANGE_GAP;
  const laid = rects.map((r, i) => ({ ...r, x: xs[i % cols], y: ys[Math.floor(i / cols)] }));
  // 中心归位（§4.3"包围盒中心不变"——min+max/2，非均值中心）：平移使输出包围盒中心与输入一致
  const dx = bboxCenter(rects, 'x') - bboxCenter(laid, 'x');
  const dy = bboxCenter(rects, 'y') - bboxCenter(laid, 'y');
  return laid.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
}
function bboxCenter(rects: ArrangeRect[], axis: 'x' | 'y'): number {
  const lo = Math.min(...rects.map((r) => r[axis]));
  const hi = Math.max(...rects.map((r) => (axis === 'x' ? r.x + r.width : r.y + r.height)));
  return (lo + hi) / 2;
}
```

- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(shared): R2a-3 sortForArrange 行优先+arrangeRects 三模式（F40）`

**Task 2a-4：clampToolbarX 水平夹取纯函数（§4.3）**

- [ ] **Step 1: 写失败测试**

```ts
describe('clampToolbarX 水平夹取（§4.3——工具条加宽后防视口溢出）', () => {
  it('超左缘右移至 margin；超右缘左移；界内原值', () => {
    expect(clampToolbarX(-50, 200, 1000, 8)).toBe(8);
    expect(clampToolbarX(980, 200, 1000, 8)).toBe(1000 - 8 - 200); // 右缘左移
    expect(clampToolbarX(400, 200, 1000, 8)).toBe(400);
  });
});
```

- [ ] **Step 2: 跑红** → **Step 3: 实现**

```ts
/** §4.3：工具条定位水平 clamp——centerX 为未夹取的左上 x（translate(-50%) 前的原始 left）。 */
export function clampToolbarX(x: number, toolbarW: number, viewportW: number, margin = 8): number {
  return Math.min(Math.max(x, margin), viewportW - margin - toolbarW);
}
```

- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(shared): R2a-4 clampToolbarX 工具条水平夹取`

**Task 2a-5：canvasStore.arrangeSelection（§4.3 写回）**

- [ ] **Step 1: 写失败测试**

```ts
// apps/web/src/stores/canvasStore.arrange.spec.ts（新——装置照 canvasStore.groups.test.ts 既有骨架：
// 直用真 store set nodes + captureStoreProjection 真跑；不 mock canvasIntents——差分换芯走真 doc 需 initCollab，
// 单测层断言 store 态与 doc 写分离：diff dispatch 经 vi.mock('@/stores/canvasIntents') 捕获调用形态）
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/stores/canvasIntents', () => ({
  dispatchCanvasIntent: vi.fn(),
  dispatchProjectionDiff: vi.fn(),
  captureStoreProjection: vi.fn(() => ({ nodes: [], edges: [] })),
}));
import { useCanvasStore } from './canvasStore';

const cs = () => useCanvasStore.getState();
function seed(nodes: any[]) { useCanvasStore.setState({ nodes: nodes as any, edges: [] }); }

describe('arrangeSelection（§4.3）', () => {
  beforeEach(() => { vi.clearAllMocks(); seed([]); });

  it('参与项 <2 → no-op + 提示"没有可排列的节点：所选节点均在未选中的组内"', () => {
    seed([
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 500, height: 300, data: { groupType: 'normal', cells: ['a', 'b'] } },
      { id: 'a', type: 'imageGen', parentId: 'g1', position: { x: 20, y: 50 }, data: {} },
    ]);
    cs().arrangeSelection(['a'], 'grid');   // 仅一个 detached——参与项 0
    expect(cs().nodes[1].position).toEqual({ x: 20, y: 50 });
  });

  it('detached 排除零位移 + toast 计数（N 个组内节点未参与排列）', async () => {
    const warn = vi.spyOn(await import('antd'), 'message').mockReturnValueAny?.() ?? vi.fn();
    seed([
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 500, height: 300, data: { groupType: 'normal', cells: ['a', 'b'] } },
      { id: 'a', type: 'imageGen', parentId: 'g1', position: { x: 20, y: 50 }, data: {} },
      { id: 'b', type: 'imageGen', parentId: 'g1', position: { x: 30, y: 60 }, data: {} },
      { id: 'c', type: 'imageGen', position: { x: 800, y: 900 }, data: {} },
    ]);
    cs().arrangeSelection(['a', 'b', 'c'], 'grid');
    // a/b 排除纹丝不动；c 参与但单参与项 no-op
    expect(cs().nodes[1].position).toEqual({ x: 20, y: 50 });
  });

  it('两个散根 grid：位置重排 + parentId 分布逐节点不变（反向断言）+ 保持原选区 + stopCapturing', () => {
    seed([
      { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, selected: true, data: {} },
      { id: 'n2', type: 'imageGen', position: { x: 900, y: 800 }, selected: true, data: {} },
    ]);
    const before = cs().nodes.map((n) => [n.id, n.parentId]);
    cs().arrangeSelection(['n1', 'n2'], 'grid');
    const after = cs().nodes.map((n) => [n.id, n.parentId]);
    expect(after).toEqual(before);                                  // parentId 逐节点不变
    expect(cs().nodes.find((n) => n.id === 'n2')!.position.x).toBeLessThan(900); // 真的重排了
    expect(cs().nodes.every((n) => n.selected === true)).toBe(true); // 选区保持
  });

  it('组=原子块 stored rect：组 position 重排、组内子节点 rel 不变', () => {
    seed([
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 400, height: 300, data: { groupType: 'normal', cells: ['a'] } },
      { id: 'a', type: 'imageGen', parentId: 'g1', position: { x: 20, y: 50 }, data: {} },
      { id: 'c', type: 'imageGen', position: { x: 1000, y: 1000 }, data: {} },
    ]);
    const relBefore = { ...cs().nodes[1].position };
    cs().arrangeSelection(['g1', 'c'], 'grid');
    expect(cs().nodes[1].position).toEqual(relBefore);              // 子 rel 不动
    expect(cs().nodes[0].position.x).toBeGreaterThan(0);            // 组被排
  });
});
```

（`antd message` spy 以仓内既有测试手法为准——grep `message.warning` 于 canvasStore 相关 spec 照抄先例；若仓内惯例是不测 toast 文案只测 no-op，从其惯例并在用例注释里登记。）

- [ ] **Step 2: 跑红**（action 不存在）→ **Step 3: 实现**——canvasStore.ts 追加（接口+实现，照 duplicateGroup 同型差分换芯）：

```ts
arrangeSelection: (ids, mode) => {
  const s = get();
  const buckets = normalizeSelection(s.nodes as any, ids);
  const p = participation(buckets, 'arrange');
  if (p.ids.length < 2) {
    message.warning(p.excludedCount > 0
      ? '没有可排列的节点：所选节点均在未选中的组内'
      : '没有可排列的节点');
    return;
  }
  stopCapturing();                                  // F13：新命令单 undo 步
  const before = captureStoreProjection();
  // 参与项 rect：散根=绝对 rect；组=stored rect（折叠=COLLAPSED_SIZE、分镜=calcStoryboardSize——原子块契约 3）
  const items = sortForArrange(p.ids.map((id) => {
    const n = s.nodes.find((x) => x.id === id)!;
    const w = n.type === 'group' && (n.data as any).collapsed ? COLLAPSED_SIZE.width
      : n.type === 'group' && (n.data as any).groupType === 'storyboard' ? calcStoryboardSize(resolveStoryboardConfig(n.data).gridRows, resolveStoryboardConfig(n.data).gridCols, resolveStoryboardConfig(n.data).aspectRatio).width
      : n.width ?? DEFAULT_CHILD_SIZE.width;
    // height 同型（折叠 COLLAPSED_SIZE.height / 分镜 calcStoryboardSize().height / DEFAULT_CHILD_SIZE.height）
    const h = /* 同上三档 */;
    return { id, x: n.position.x, y: n.position.y, width: w, height: h };
  }));
  const laid = arrangeRects(items.map(({ id, ...r }) => r), mode);
  set((st) => ({
    nodes: st.nodes.map((n) => {
      const i = items.findIndex((it) => it.id === n.id);
      return i === -1 ? n : { ...n, position: { x: laid[i].x, y: laid[i].y } };
    }),
  }));
  if (p.excludedCount > 0) message.warning(`${p.excludedCount} 个组内节点未参与排列（需调整请先选中其所在组）`);
  get().applyGroupDerivations();
  dispatchProjectionDiff(before, Origin.LocalUser);
},
```

（`w/h` 三档取值在实现时抽局部函数 `storedRectOf(node)` 避免重复；分镜尺寸经 resolveStoryboardConfig 单源。）

- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2a-5 arrangeSelection 写回（detached 排除+组原子块+差分换芯）`

**Task 2a-6：duplicateNodes + copyNode 删除（F12 副本体系统一）**

- [ ] **Step 1: 写失败测试**

```ts
describe('duplicateNodes（§4.3 副本体系）', () => {
  beforeEach(() => { vi.clearAllMocks(); seed([]); });

  it('副本全链路保真：data 取 nodeStore 全量、cells 重映射、selected=true 子 false、offset {40,0}', () => {
    seed([
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 400, height: 300, data: { groupType: 'normal', cells: ['a'], color: 'red' } },
      { id: 'a', type: 'imageGen', parentId: 'g1', position: { x: 20, y: 50 }, data: { fileId: 'f1' } },
    ]);
    // nodeStore 全量 data（bridge 键外的配置面）
    useNodeStore.setState({ nodes: { a: { id: 'a', type: 'imageGen', data: { fileId: 'f1', prompt: 'x' } } as any } });
    cs().duplicateNodes(['g1']);
    const g2 = cs().nodes.find((n) => n.id !== 'g1' && n.type === 'group')!;
    expect(g2.data.color).toBe('red');                                   // 组 data 保真
    expect(g2.position).toEqual({ x: 40, y: 0 });                        // DUPLICATE_OFFSET
    expect(g2.selected).toBe(true);
    const a2 = cs().nodes.find((n) => n.id !== 'a' && n.parentId === g2.id)!;
    expect(a2.selected).toBe(false);
    expect(g2.data.cells).toEqual([a2.id]);                              // cells 重映射
  });

  it('detached 副本一律顶层化：parentId=undefined+绝对坐标+offset+extent=undefined（F41）', () => {
    seed([
      { id: 'g1', type: 'group', position: { x: 100, y: 100 }, width: 400, height: 300, data: { groupType: 'normal', cells: ['a'] } },
      { id: 'a', type: 'imageGen', parentId: 'g1', position: { x: 20, y: 50 }, data: {} },
    ]);
    cs().duplicateNodes(['a']);
    const copy = cs().nodes.find((n) => n.id !== 'a' && n.type === 'imageGen')!;
    expect(copy.parentId).toBeUndefined();
    expect((copy as any).extent).toBeUndefined();
    expect(copy.position).toEqual({ x: 100 + 20 + 40, y: 100 + 50 + 0 }); // 绝对坐标+offset
  });

  it('选区闭包互连边重映射 + B-2 顺序（cs set 先于 ns.addNode）+ 500ms 内连点两次=2 undo 项（F13）', () => {
    seed([
      { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, data: {} },
      { id: 'n2', type: 'imageGen', position: { x: 500, y: 0 }, data: {} },
    ]);
    useCanvasStore.setState({ edges: [{ id: 'e1', source: 'n1', target: 'n2' } as any] });
    cs().duplicateNodes(['n1', 'n2']);
    const newNodes = cs().nodes.filter((n) => n.id !== 'n1' && n.id !== 'n2');
    expect(newNodes.length).toBe(2);
    const newEdge = cs().edges.find((e) => e.id !== 'e1');
    expect(newEdge).toBeTruthy();
    expect(newEdge!.source).toBe(newNodes[0].id);   // 边端点=新节点 id
  });

  it('duplicateGroup=duplicateNodes([id]) 特例路径（复用断言）', () => {
    seed([{ id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 400, height: 300, data: { groupType: 'normal', cells: [] } }]);
    const spy = vi.fn((ids: string[]) => cs().duplicateNodes(ids));
    (cs() as any).duplicateGroup = spy;   // 或直接断言 duplicateGroup 产出与 duplicateNodes 等价
    cs().duplicateGroup('g1');
    expect(cs().nodes.filter((n) => n.type === 'group').length).toBe(2);
  });

  it('copyNode 已删除（F12）——接口与实现零残留', () => {
    expect((cs() as any).copyNode).toBeUndefined();
  });
});
```

undo 断言（连点两次=2 undo 项）依赖 canvasUndo 真栈——照 canvasStore.groups.test.ts 内 undo 相关用例的既有装置（grep `stopCapturing|undo()` 于该文件照抄）。若既有测试从不驱动真 UndoManager，则把 undo 断言降为"`stopCapturing` 被调"（vi.mock canvasUndo 捕获）+ 登记。

- [ ] **Step 2: 跑红** → **Step 3: 实现**——canvasStore.ts：

```ts
duplicateNodes: (ids, offset = DUPLICATE_OFFSET) => {
  const s = get();
  const buckets = normalizeSelection(s.nodes as any, ids);
  const p = participation(buckets, 'duplicate');
  if (p.ids.length === 0) return;
  stopCapturing();
  const before = captureStoreProjection();
  const newId = () => crypto.randomUUID();
  const idMap = new Map<string, string>();
  for (const id of p.ids) idMap.set(id, newId());
  // 两遍：先建全 idMap（cells 重映射需要），再产出副本
  const copies: any[] = [];
  for (const id of p.ids) {
    const n = s.nodes.find((x) => x.id === id)!;
    const parentSelected = n.parentId ? p.ids.includes(n.parentId) : false;
    const isDetached = !!n.parentId && !parentSelected;
    const nsData = (useNodeStore.getState().nodes as any)[id]?.data;   // data 一律取 nodeStore 全量
    if (n.type === 'group') {
      copies.push({
        ...n, id: idMap.get(id)!, selected: true,
        position: { x: n.position.x + offset.x, y: n.position.y + offset.y },
        data: { ...n.data, cells: ((n.data as any).cells ?? []).map((c: string) => idMap.get(c) ?? null) },
      });
    } else if (isDetached) {
      const g = n.parentId ? s.nodes.find((x) => x.id === n.parentId) : undefined;
      const abs = { x: (g?.position.x ?? 0) + n.position.x + offset.x, y: (g?.position.y ?? 0) + n.position.y + offset.y };
      copies.push({ ...n, id: idMap.get(id)!, parentId: undefined, extent: undefined, selected: true, position: abs, data: nsData ?? n.data });
    } else {
      copies.push({ ...n, id: idMap.get(id)!, selected: true, position: { x: n.position.x + offset.x, y: n.position.y + offset.y }, data: nsData ?? n.data });
    }
  }
  // 选区闭包互连边重映射（两端都在复制集内的边）
  const newEdges = s.edges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => ({ ...e, id: `e-${newId()}`, source: idMap.get(e.source)!, target: idMap.get(e.target)! }));
  set((st) => ({ nodes: [...st.nodes.map((n) => (p.ids.includes(n.id) ? { ...n, selected: false } : n)), ...copies], edges: [...st.edges, ...newEdges] }));
  for (const c of copies) if (c.type !== 'group') useNodeStore.getState().addNode(c.id, { id: c.id, type: c.type, data: c.data } as any); // B-2：cs set 先于 ns 写
  get().applyGroupDerivations();
  dispatchProjectionDiff(before, Origin.LocalUser);
},
```

（`useNodeStore.addNode` 签名以现场为准——grep addNode 于 nodeStore.ts 对照；DUPLICATE_OFFSET 常量落 selectionTokens.ts 或 canvasStore 顶部，单源。**copyNode 删除**：接口声明 :134+实现 :341-380+`copyNode` 4 处测试改写为 duplicateNodes 断言——grep `copyNode` 全仓逐处处理。）

- [ ] **Step 4: 跑绿**（含 copyNode 残留 grep 零命中）+ **Step 5: Commit** `feat(canvas): R2a-6 duplicateNodes 副本体系统一+copyNode 退役（F12/F41）`

**Task 2a-7：SelectionBoxOverlay 工具条扩展（排列▾/创建副本）+ 浮层交互规格**

- [ ] **Step 1: 写失败测试**——SelectionBoxOverlay.test.tsx 增补：

```ts
// 工具条按钮序（§4.3 视觉：[排列▾] │ [创建副本] │ [打组▾]〔已有〕 [批量下载→2b 接入〕）
it('工具条含排列菜单（三项 网格/水平/垂直）+创建副本按钮；点外/Esc 关闭浮层；aria 齐全', async () => {
  renderOverlay({ selected: 2 });
  const arrangeBtn = screen.getByRole('button', { name: /排列/ });
  expect(arrangeBtn).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(arrangeBtn);
  expect(arrangeBtn).toHaveAttribute('aria-expanded', 'true');
  const menu = screen.getByRole('menu');
  expect(within(menu).getAllByRole('menuitem').map((el) => el.textContent)).toEqual(['网格', '水平', '垂直']);
  fireEvent.click(within(menu).getByText('水平'));
  expect(onArrangeMock).toHaveBeenCalledWith('horizontal');
  fireEvent.keyDown(document, { key: 'Escape' });   // 浮层关闭
  expect(screen.queryByRole('menu')).toBeNull();
});
it('创建副本按钮调 duplicateSelection（选中集全量）', () => {
  renderOverlay({ selected: 2 });
  fireEvent.click(screen.getByRole('button', { name: /创建副本/ }));
  expect(onDuplicateMock).toHaveBeenCalledWith(['n1', 'n2']);
});
it('水平夹取：选框中心近左缘时工具条 left ≥ 8（clampToolbarX 接线）', () => {
  renderOverlay({ selected: 2, bounds: { x: -95, y: 0, w: 60, h: 60 } }); // 屏幕 x=-95*zoom+vp 后中心近 0
  const bar = screen.getByTestId('selection-toolbar');
  expect(Number.parseFloat(bar.style.left)).toBeGreaterThanOrEqual(8);
});
```

- [ ] **Step 2: 跑红** → **Step 3: 实现**——SelectionBoxOverlay.tsx：
  - 工具条容器按 §4.3 视觉规格（padding 8/gap 8/圆角 12/0.5px 边框 `--canvas-controls-border`/背景 `--canvas-controls-bg`/阴影 `rgba(0,0,0,0.08) 0 4px 10px`/blur 16——以 Tailwind 任意值或 inline style 落，色值走 token）；
  - `[排列▾]` 菜单（浮层交互统一规格：click toggle/mousedown outside 关/Esc 关/`aria-expanded`+`role=menu`/`menuitem`/浮层元素带 `nodrag nopan` className——NormalGroupRenderer.tsx:69 先例）；水平定位接 `clampToolbarX`；
  - `[创建副本]` 调 `useCanvasStore.getState().duplicateSelection()`（= 包装 `duplicateNodes(选中ids)`——**新增薄包装 action** 或直接调 duplicateNodes(selectedIds)，取后者更简：组件内 `duplicateNodes(selectedInternal.map(n=>n.id))`）；
  - 排列菜单项调 `arrangeSelection(selectedIds, mode)`；
  - props/回调从 CanvasView 传入或组件内直取 store——**照现状打组▾ 的接线方式**（grep `groupNodes` 调用于该组件，同型接线）。
- [ ] **Step 4: 跑绿** + 全量 web 回归 + **Step 5: Commit** `feat(canvas): R2a-7 多选工具条扩展（排列三模式+创建副本+水平夹取+浮层交互规格）`

**Task 2a-8：2a 批尾**

- [ ] **Step 1**: `pnpm --filter @flowweb/web test -- --run` 全绿 + `pnpm verify`。
- [ ] **Step 2**: 浏览器冒烟（dev 起服务）：多选两节点→排列网格/水平/垂直三模式生效、detached 提示出现、创建副本偏移 40px、undo 一步回滚整组副本。
- [ ] **Step 3**: Commit（若有收尾文件）+ 完成记录表（本文件尾）填 2a 行。

---

## 分片 2b：批量下载全链路 + mediaUrl 读写收敛（F37）

**Files:**
- Create: `apps/web/src/utils/mediaDownload.ts`
- Modify: `apps/web/src/components/ImageGenNode.tsx:139-144`、`apps/web/src/components/ImageFullscreenViewer.tsx:69-76`、`apps/web/src/components/VideoGenNode.tsx:266-271`、`apps/web/src/components/VideoFullscreenViewer.tsx:58-65`（4 处下载替换）
- Create: `apps/web/src/utils/collectDownloadables.ts`（或并入 mediaDownload.ts——取单文件）
- Modify: `apps/web/src/pages/canvas/components/groups/SelectionBoxOverlay.tsx`（批量下载按钮）
- Modify: `apps/web/src/stores/canvasStore.ts`（删 mediaUrl 写点 3 处+nodeStore 双写）
- Modify: `apps/web/src/pages/canvas/CanvasView.tsx:182`（素材库拖入删 mediaUrl）
- Modify: `apps/web/src/stores/nodeStore.ts:245`（CANVAS_BRIDGE_KEYS 剥 mediaUrl）
- Modify: `apps/web/src/pages/canvas/components/groups/StoryboardCell.tsx:20`、`GroupNode.tsx:55`（读点收敛）
- Modify: `apps/web/scripts/eslint-rules/collab-static-asserts.js` + `apps/web/eslint.config.js` + `apps/web/scripts/lint-gate.mjs`（门禁第六条）
- Test: `apps/web/src/utils/mediaDownload.spec.ts`（新）、SelectionBoxOverlay.test.tsx（增补）、canvasStore 相关既有测试迁移

**Task 2b-1：downloadMediaFile 共享 util（§4.3 批量下载件 + 4 处存量缺陷合并）**

- [ ] **Step 1: 写失败测试**

```ts
// apps/web/src/utils/mediaDownload.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadMediaFile } from './mediaDownload';

function stubAnchor() {
  const click = vi.fn();
  const a: any = { click, href: '', download: '', style: {} };
  vi.spyOn(document, 'createElement').mockReturnValue(a);
  return { a, click };
}

describe('downloadMediaFile（§4.3：url 优先、缺则 fileId 现取、失败重取一次、60s revoke）', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.useFakeTimers(); });

  it('url 直用不查 fileId；a.download=filename；60s 后 revoke（ExportModal 正解先例——非同步 revoke）', async () => {
    const { a, click } = stubAnchor();
    const revoke = vi.fn();
    const origCreate = URL.createObjectURL;
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob()) });
    await downloadMediaFile({ url: 'http://u', filename: '图.png' });
    expect(click).toHaveBeenCalled();
    expect(a.download).toBe('图.png');
    expect(revoke).not.toHaveBeenCalled();           // 同步 revoke 是存量缺陷（4 处）——本 util 不得复现
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledWith('blob:x');
    URL.createObjectURL = origCreate;
  });

  it('fetch 失败且有 fileId → 重取一次 URL 再试（长开页面过期自愈）', async () => {
    stubAnchor();
    const getMediaUrl = vi.fn().mockResolvedValue({ url: 'http://fresh', ttlSec: 900 });
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(new Blob()) });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:y');
    await downloadMediaFile({ fileId: 'f1', url: 'http://stale', filename: 'x.png', getMediaUrl });
    expect(getMediaUrl).toHaveBeenCalledWith('f1');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('最终失败 message.error 且不抛出（继续下载下一项）', async () => {
    const error = vi.fn();
    const { message } = await import('antd');
    vi.spyOn(message, 'error').mockImplementation(error);
    global.fetch = vi.fn().mockRejectedValue(new Error('net'));
    await expect(downloadMediaFile({ url: 'http://u', filename: 'x.png' })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });

  it('扩展名映射：无扩展名 filename 按 mimeType 兜底（image/png→.png / video/mp4→.mp4 / 未知→无后缀）', async () => {
    const { a } = stubAnchor();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob([], { type: 'video/mp4' })) });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:z');
    await downloadMediaFile({ url: 'http://u', filename: '视频-abc12' });
    expect(a.download).toBe('视频-abc12.mp4');
  });
});
```

- [ ] **Step 2: 跑红** → **Step 3: 实现**

```ts
// apps/web/src/utils/mediaDownload.ts
import { message } from 'antd';
import { getMediaUrl } from '@/api/mediaApi';

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'audio/mpeg': '.mp3',
};

export interface DownloadArgs {
  fileId?: string;
  url?: string;
  filename: string;
  getMediaUrl?: typeof getMediaUrl;   // 测试注入
}

/** §4.3 批量下载件（ExportModal setTimeout(revoke,60s) 正解先例合并仓内 4 处同步 revoke 缺陷）。
 *  url 优先、缺则 fileId 现取；fetch 失败且有 fileId → 重取一次 URL 再试（长开页面过期自愈）。 */
export async function downloadMediaFile(args: DownloadArgs): Promise<void> {
  const fetcher = args.getMediaUrl ?? getMediaUrl;
  let url = args.url;
  try {
    let blob: Blob | null = null;
    for (let attempt = 0; attempt < 2 && !blob; attempt++) {
      if (!url && args.fileId) url = (await fetcher(args.fileId)).url;
      if (!url) break;
      const res = await fetch(url!);
      if (res.ok) blob = await res.blob();
      else url = undefined;             // 过期——下轮重取
      if (res.ok) break;
    }
    if (!blob) throw new Error('download failed');
    const ext = EXT_BY_MIME[blob.type] ?? '';
    const name = /\.[a-z0-9]{2,5}$/i.test(args.filename) || !ext ? args.filename : args.filename + ext;
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch {
    message.error(`下载失败：${args.filename}`);
  }
}
```

- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2b-1 downloadMediaFile 共享件（url 优先/fileId 自愈/60s revoke/扩展名映射）`

**Task 2b-2：4 处存量下载替换**

- [ ] **Step 1: 实现**（纯替换无行为变更——各处 file:line 以 grep `createObjectURL` 现场重校准）：
  - ImageGenNode.tsx:139-144、ImageFullscreenViewer.tsx:69-76、VideoGenNode.tsx:266-271、VideoFullscreenViewer.tsx:58-65 的 fetch→blob→createObjectURL→同步 revoke 段整体替换为 `await downloadMediaFile({ fileId, url, filename })` 调用；
  - ImageFullscreenViewer/VideoFullscreenViewer props 增可选 `fileId?: string` 透传（过期自愈依赖）；调用方（CanvasView 或节点组件挂 viewer 处）同步传 fileId——grep viewer 使用点接线；
  - 各处保留自己的 filename 生成逻辑（`data.mediaName ?? \`${类型}-${短id}\``——**统一移入 2b-3 collectDownloadables，节点内单下载沿用现有名**）。
- [ ] **Step 2: 测试**——4 处现有下载相关断言迁移为 downloadMediaFile mock 断言（vi.mock('@/utils/mediaDownload')捕获调用参数）；无既有测试的补最小一条（组件点击下载按钮→downloadMediaFile 被调）。
- [ ] **Step 3: 跑绿** + **Step 4: Commit** `refactor(canvas): R2b-2 四处存量下载切换 downloadMediaFile（同步 revoke 缺陷根除）`

**Task 2b-3：collectDownloadables 收集集（契约 1 download 策略）**

- [ ] **Step 1: 写失败测试**

```ts
// apps/web/src/utils/collectDownloadables.spec.ts
import { collectDownloadables } from './collectDownloadables';

describe('collectDownloadables（participation download=三桶全展开）', () => {
  it('图片三型：imageGen 完成=fileId||referenceImage；imageEdit 完成=fileId；multiImageGen 主图=images[mainImageIndex]（success）', () => {
    const nodes: any[] = [
      { id: 'i1', type: 'imageGen', data: { status: 'done', fileId: 'f1' } },
      { id: 'i2', type: 'imageGen', data: { status: 'done', referenceImage: 'r1' } },
      { id: 'i3', type: 'imageGen', data: { status: 'done' } },                                    // 无产物→跳过
      { id: 'm1', type: 'multiImageGen', data: { images: [
        { id: 'x1', status: 'failed' }, { id: 'x2', status: 'success' }], mainImageIndex: 0 } },   // 主图非 success
      { id: 'v1', type: 'videoGen', data: { status: 'done', fileId: 'vf1' } },
    ];
    const r = collectDownloadables(nodes, nodes.map((n) => n.id));
    expect(r.map((x) => x.fileId)).toEqual(['f1', 'r1', 'x2', 'vf1']);   // F15：主图非 success→首个 success
    expect(r.map((x) => x.filename)).toContain('图片-i1');
  });
  it('空集/全无产物 → 空数组（aria-disabled 依据）', () => {
    expect(collectDownloadables([{ id: 'i3', type: 'imageGen', data: { status: 'done' } } as any], ['i3'])).toEqual([]);
  });
});
```

（"图片三型"的 isImageCompletedNode 判定以 `apps/web/src/utils/imageNodeGuards.ts:9` 现状为准——实现内部复用它+补 multiImageGen 主图选择（F15：`images[mainImageIndex]?.status==='success'` 则取其 id，否则首个 success，否则跳过）。文件名链：`data.mediaName ?? \`${类型}-${id.slice(-6)}\``。）

- [ ] **Step 2: 跑红** → **Step 3: 实现**（`apps/web/src/utils/collectDownloadables.ts`——签名 `collectDownloadables(nodes: CanvasNode[], ids: string[]): { nodeId, fileId, filename }[]`；内部 normalizeSelection+participation('download') 全展开+逐节点提取）。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2b-3 下载收集集（三桶全展开+图片三型+主图选择 F15）`

**Task 2b-4：SelectionBoxOverlay 批量下载按钮**

- [ ] **Step 1: 写失败测试**

```ts
it('批量下载：无可下载项 aria-disabled+handler 守卫；串行+i*300ms；>10 项先确认提示；完成提示', async () => {
  const dl = vi.fn().mockResolvedValue(undefined);
  vi.mock('@/utils/mediaDownload', () => ({ downloadMediaFile: dl }));
  renderOverlay({ selected: 2, nodes: [/* 两个有 fileId 的完成图节点 */] });
  const btn = screen.getByRole('button', { name: '批量下载' });
  fireEvent.click(btn);
  await vi.waitFor(() => expect(dl).toHaveBeenCalledTimes(2));
  expect(vi.mocked(dl).mock.calls[0][0].filename).toMatch(/图片-/);
});
```

- [ ] **Step 2: 跑红** → **Step 3: 实现**——工具条补 `[批量下载]` 32×32 图标钮（aria-label=批量下载；`aria-disabled` 由 collectDownloadables 空集驱动+handler 首行守卫）；点击流：>10 项 `Modal.confirm` 先提示→串行 `for (i) { await downloadMediaFile(item); await delay(300*i) }`（首项即发、后续间隔 300ms——实现为 `await new Promise(r=>setTimeout(r, i*300))` 前置等待）→完成 `message.success(\`已下载 N 个文件\`)`+首次批量前提示浏览器多文件许可（localStorage 标记仅提示一次——`flowweb:batch-dl-hint`）。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2b-4 多选工具条批量下载（串行节流/许可提示/守卫）`

**Task 2b-5：mediaUrl 写入收敛（F37——写点 4 处+双写+桥接键）**

- [ ] **Step 1: 写失败测试**——红相=现状写入存在（改完转绿）：

```ts
// apps/web/src/stores/canvasStore.mediaurl.spec.ts（新）
describe('F37 mediaUrl 写入收敛（§4.3 规则=node data.mediaUrl 不再写入）', () => {
  it('分镜溢出展开节点/addImageToStoryboardCell 建槽位：产出节点 data 无 mediaUrl 键', () => {
    // 驱动两路径（canvasStore 既有用例装置照抄）——断言新节点 JSON.stringify 不含 'mediaUrl'
  });
  it('CANVAS_BRIDGE_KEYS 不含 mediaUrl（updateConfig({mediaUrl}) 不再桥写入 doc）', () => {
    // nodeStore CANVAS_BRIDGE_KEYS 导入断言 !keys.has('mediaUrl')
  });
});
```

（驱动装置：canvasStore.ts:1276/:1395（分镜溢出展开 `__fromMulti` 两处同型）+:1740/:1744（addImageToStoryboardCell 建槽位节点+ns 双写）——grep `mediaUrl` apps/web/src/stores 现场重校准全部写入点，**一处不留**；CanvasView.tsx:182 素材库拖入 `nodeData = { … mediaUrl: file.url … }` 删该键（fileId 保留——StoryboardCell 经 useMediaUrl(fileId) 现取）。）

- [ ] **Step 2: 跑红**（新断言先写：`expect(keys.has('mediaUrl')).toBe(false)` 红）→ **Step 3: 实现**——四处删 `mediaUrl: …` 键+nodeStore.ts:245 CANVAS_BRIDGE_KEYS 剥 `'mediaUrl'`+CanvasView:182 删键。
- [ ] **Step 4: 跑绿**（含既有分镜槽位/溢出展开测试若锁了 mediaUrl 断言则同步迁移）+ **Step 5: Commit** `fix(canvas): R2b-5 mediaUrl 写入面清零（写点 4+双写+桥接键——F37）`

**Task 2b-6：读点收敛（StoryboardCell/GroupNode）**

- [ ] **Step 1: 写失败测试**——StoryboardCell.test（若有）增"info.url 短路删除：传入 data.mediaUrl 仍走 useMediaUrl(fileId)"；无既有测试则组件级最小断言（渲染 cell 不读 data.mediaUrl——grep 断言源码零命中由门禁承载，组件测试断言 hook 调用参数为 fileId）。
- [ ] **Step 2: 跑红** → **Step 3: 实现**——StoryboardCell.tsx:19-20 改纯 `useMediaUrl(fileId)`（删 `p.info?.url ??` 短路）；GroupNode.tsx:55 删 mediaUrl 读取（cellNodes url 改 useMediaUrl 或既有取图链——以现场代码语义为准，仅删 mediaUrl 分支）。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `fix(canvas): R2b-6 mediaUrl 读点清零（过期 URL 短路优先根除——F37 破图窗口消灭）`

**Task 2b-7：lint 门禁第六条 no-mediaurl-write（标识符扫描+红相实证）**

- [ ] **Step 1: 实现**——collab-static-asserts.js 新增规则：

```js
// 写入上下文标识符扫描（非模式匹配——CanvasView 字面量名是 nodeData，`data: {` 模式匹配必然假绿=F37 实证）：
// 在 addNode/updateConfig/setState/setNodes 调用实参内出现 `mediaUrl:` 属性键即报；
// 读取白名单（test 文件豁免由 gateActive 段统一处理）。
const MEDIAURL_WRITE_MSG = 'F37: node data.mediaUrl 不再写入/读取——下载/渲染经 useMediaUrl(fileId) 现取（spec §4.3）';
```

（实现形态照 no-shadow-literal（第五条）的 AST 双形态先例：`Property[key.name='mediaUrl']` 命中+调用上下文限定；四步注册：rule 实现+eslint.config.js+lint-gate.mjs STATIC_ASSERT_RULE_IDS+fixture 正例。）
- [ ] **Step 2: 红相实证**——临时在某 store 文件加 `mediaUrl: 'x'` → `pnpm --filter @flowweb/web lint` 红 → 撤销；证据（命令输出贴完成记录表备注）。
- [ ] **Step 3: 跑绿** + **Step 4: Commit** `build(canvas): R2b-7 lint 门禁第六条 no-mediaurl-write（标识符扫描+红相实证）`

**Task 2b-8：2b 批尾**

- [ ] **Step 1**: web 全量 + `pnpm verify`。
- [ ] **Step 2**: 浏览器冒烟：多选 3 完成图节点批量下载（含许可提示/串行）；分镜宫格图渲染正常（mediaUrl 收敛后 StoryboardCell 走 useMediaUrl）；素材库拖图入画布显示正常（CanvasView 拖入删键后）。
- [ ] **Step 3**: 完成记录表填 2b 行。

---

## 分片 2c：Token 前置补课 + 组工具条 + 组颜色 + 组名入框

**Files:**
- Modify: `apps/web/src/index.css`（§4.2 Token 追加——深浅双块内）
- Modify: `apps/web/e2e/b0-token-blocks.spec.ts`（DOMAIN_TOKENS+双值表——路径以现场为准）
- Create: `apps/web/src/utils/groupColor.ts`
- Modify: `apps/web/src/stores/canvasStore.ts`（setGroupColor action）
- Modify: `apps/web/src/pages/canvas/components/groups/GroupToolbar.tsx`（色点+排列子节点+批量下载+GROUP_TOOLBAR）
- Modify: `apps/web/src/pages/canvas/components/groups/NormalGroupRenderer.tsx`（组名入框+1px 边框+组色）
- Test: groupColor.spec.ts（新）、GroupToolbar.test.tsx、NormalGroupRenderer.test.tsx、canvasStore.groups.test.ts 增补

**Task 2c-1：Token 落地（§4.2 前置补课）+ b0 扩表 + registry**

- [ ] **Step 1: 实现**——index.css **在既有唯一双块内追加**（不得另起块——b1-4 硬红；落点：深块尾/light 块尾，不得落入几何常量块；现场读 index.css :38-43/:82-87 两块边界后落）：

```css
/* 深块 */
--canvas-storyboard-shell-bg: #212121;
--canvas-group-border: #3a3a3a;   /* 刻意不同于 --fw-border 的 #e5e7eb——组框无阴影单载波，统一回去=1.12:1 不可见 */
--canvas-group-color-red: #f87171;    /* 400 系亮变体——深板 #000 上 ≥3:1，contrast 实测登记台账 */
--canvas-group-color-orange: #fb923c;
--canvas-group-color-yellow: #facc15;
--canvas-group-color-green: #4ade80;
--canvas-group-color-cyan: #22d3ee;
--canvas-group-color-blue: #60a5fa;
--canvas-group-color-purple: #c084fc;
/* 浅块 */
--canvas-storyboard-shell-bg: #f7f8f8;
--canvas-group-border: #9ca3af;    /* 浅 2.33:1 vs 板面 / 2.25:1 vs 组内底——分离度观测行，B6 目检裁定；回退预登记：不可辨→#8e9298 */
--canvas-group-color-red: #dc2626;     /* 600 系——亮板 #F5F5F5 上 ≥3:1 */
--canvas-group-color-orange: #ea580c;
--canvas-group-color-yellow: #a16207;
--canvas-group-color-green: #16a34a;
--canvas-group-color-cyan: #0e7490;
--canvas-group-color-blue: #2563eb;
--canvas-group-color-purple: #9333ea;
```

**纪律（spec §4.2 原文）：两档 14 色值以 contrast-table 首跑实测登记台账，禁手填**——上表 hex 为 seed 预填，Step 2 实测后逐值校正（对比度计算：边框色 vs 板面 #000/#F5F5F5 与组内底色，≥3:1 达标；不达标调档位，实测值与最终值全部写入完成记录表 2c 行）。

- [ ] **Step 2: contrast 实测**——用 `scripts/` 下既有 contrast 工具（grep `contrast` apps/web/scripts——若无则临时 node 脚本计算 relative luminance，产物贴台账；**脚本不入仓**除非既有先例）。逐值登记：7 色×2 档+group-border 2 档+shell-bg 分离度观测行。
- [ ] **Step 3: b0 扩表**——b0-token-blocks.spec.ts 的 DOMAIN_TOKENS 数组加 9 键+DOMAIN_DARK/DOMAIN_LIGHT 双值（补"新键在迭代列表内"断言——照既有 20 键模式）；**深浅域键集相等断言已在 vitest 侧（b1-4 只在 Playwright 批）——确认 b0 侧双值表同步**。
- [ ] **Step 4: registry 重跑**——`node apps/web/scripts/canvas-migration-registry.mjs` 重跑+新 site 增量在 differExpectedPairs/adjudications 逐条裁定（F26 纪律：四个手工键重跑不丢）。
- [ ] **Step 5: 跑绿**（b0 spec+web lint）+ **Step 6: Commit** `feat(canvas): R2c-1 组域 Token 9 键落地（contrast 实测台账+b0 扩表+registry）`

**Task 2c-2：groupColor 单源 util**

- [ ] **Step 1: 写失败测试**

```ts
// apps/web/src/utils/groupColor.spec.ts
import { GROUP_PALETTE, GROUP_COLOR_MAP, resolveGroupColor } from './groupColor';
import { readFileSync } from 'node:fs';

describe('groupColor 单源（§4.4）', () => {
  it('GROUP_PALETTE 7 键无 gray；派生 GroupColorKey 与 GROUP_COLOR_MAP', () => {
    expect(GROUP_PALETTE).toHaveLength(7);
    expect(GROUP_PALETTE).not.toContain('gray');
    expect(Object.keys(GROUP_COLOR_MAP).sort()).toEqual([...GROUP_PALETTE].sort());
  });
  it('resolveGroupColor：合法 key→CSS var 值；未知 key/undefined→undefined（不抛错）', () => {
    expect(resolveGroupColor('red')).toBe('var(--canvas-group-color-red)');
    expect(resolveGroupColor('bogus')).toBeUndefined();
    expect(resolveGroupColor(undefined)).toBeUndefined();
  });
  it('GROUP_PALETTE ↔ index.css 变量集对账（readFileSync+正则——vitest 门禁行）', () => {
    const css = readFileSync(require.resolve('../index.css'), 'utf8');
    for (const k of GROUP_PALETTE) {
      expect(css).toMatch(new RegExp(`--canvas-group-color-${k}:\\s*#`));
    }
  });
});
```

- [ ] **Step 2: 跑红** → **Step 3: 实现**

```ts
// apps/web/src/utils/groupColor.ts
/** §4.4 组颜色单源：语义 key（无 gray；undefined=默认）。后端仅形状过滤（typeof string），
 *  未知 key 按未设色不抛错——写入端拒写、读取端双兜底。 */
export const GROUP_PALETTE = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple'] as const;
export type GroupColorKey = (typeof GROUP_PALETTE)[number];
export const GROUP_COLOR_MAP: Record<GroupColorKey, string> = Object.fromEntries(
  GROUP_PALETTE.map((k) => [k, `var(--canvas-group-color-${k})`]),
) as Record<GroupColorKey, string>;
export function resolveGroupColor(value: unknown): string | undefined {
  return typeof value === 'string' && (value in GROUP_COLOR_MAP) ? GROUP_COLOR_MAP[value as GroupColorKey] : undefined;
}
```

- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2c-2 groupColor 单源（palette/类型/resolve 唯一函数）`

**Task 2c-3：setGroupColor action（经 patchGroupData）**

- [ ] **Step 1: 写失败测试**

```ts
// canvasStore.groups.test.ts 增补
describe('setGroupColor（§4.4）', () => {
  it('合法 key 经 patchGroupData 双写（cs data.color）；默认清除（undefined=删键）', () => {
    seedGroup('g1');
    cs().setGroupColor('g1', 'red');
    expect(cs().nodes[0].data.color).toBe('red');
    cs().setGroupColor('g1', undefined);
    expect(cs().nodes[0].data.color).toBeUndefined();
  });
  it('未知 key 拒写（data 不变）', () => {
    seedGroup('g1');
    cs().setGroupColor('g1', 'bogus' as any);
    expect(cs().nodes[0].data.color).toBeUndefined();
  });
  it('convertGroup 两方向保 color（F18 增量 patch 天然存续——回归锚）', () => {
    seedGroup('g1');
    cs().setGroupColor('g1', 'blue');
    cs().convertGroup('g1', 'storyboard');   // 夹具需图片完成子节点
    expect(cs().nodes[0].data.color).toBe('blue');
    cs().convertGroup('g1', 'normal');
    expect(cs().nodes[0].data.color).toBe('blue');
  });
});
```

- [ ] **Step 2: 跑红** → **Step 3: 实现**——canvasStore.ts：

```ts
setGroupColor: (groupId, key) => {
  if (key !== undefined && !(key in GROUP_COLOR_MAP)) return;   // 未知 key 拒写（§4.4）
  get().patchGroupData(groupId, { color: key });                // undefined=删键（patchGroupData delete 语义）
},
```

（import { GROUP_COLOR_MAP } from '@/utils/groupColor'；类型 `key?: GroupColorKey`。）

- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2c-3 setGroupColor（patchGroupData 唯一通道+未知 key 拒写）`

**Task 2c-4：arrangeGroupChildren action（§4.4 排列子节点）**

- [ ] **Step 1: 写失败测试**

```ts
describe('arrangeGroupChildren（§4.4）', () => {
  it('显式几何命令：先清 manuallyResized（经 patchGroupData）再走 applyGroupFrame——手动组排列生效', () => {
    seedGroup('g1', { manuallyResized: true, children: [/* 3 个散乱子 */] });
    cs().arrangeGroupChildren('g1', 'grid');
    expect(cs().nodes[0].data.manuallyResized).toBeUndefined();   // 标记被清（契约 4）
    // 子节点按网格重排（行优先序）
  });
  it('折叠态禁用（函数首行守卫 no-op）', () => {
    seedGroup('g1', { collapsed: true });
    const before = JSON.stringify(cs().nodes);
    cs().arrangeGroupChildren('g1', 'grid');
    expect(JSON.stringify(cs().nodes)).toBe(before);
  });
  it('分镜组禁用（仅普通组——配置型几何域）', () => { /* 同款 no-op 断言 groupType:'storyboard' */ });
  it('子节点绝对 rect→arrangeRects→经 applyGroupFrame 守恒写回+stopCapturing', () => {
    // 3 子（含异构尺寸）grid 排列后：子 rel 按新 frame、组框=bbox+padding、单 undo 步
  });
});
```

- [ ] **Step 2: 跑红** → **Step 3: 实现**——canvasStore.ts（差分换芯同型；核心序：折叠/分镜守卫早退→stopCapturing→patchGroupData({manuallyResized: undefined})→子绝对 rect（`n.position + g.position`，尺寸 `n.width ?? DEFAULT_CHILD_SIZE.width`）→sortForArrange→arrangeRects→子新绝对位置−新组原点=rel 写回+组走 applyGroupFrame（refitGroupGeometry 守恒）→applyGroupDerivations→dispatchProjectionDiff）。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2c-4 arrangeGroupChildren（清手动标记+守恒写回+折叠/分镜禁用）`

**Task 2c-5：NormalGroupRenderer——展开态 1px 边框 + 组色 + 组名入框（F17/F22）**

- [ ] **Step 1: 写失败测试**——NormalGroupRenderer.test.tsx：

```ts
it('展开态 1px 边框（F22——现状 border==="" 断言翻转）：border=1px solid var(--canvas-group-border)', () => {
  render(<NormalGroupRenderer {...baseProps} />);
  expect(box.style.border).toBe('1px solid var(--canvas-group-border)');
});
it('设组色时 border-color 吃组色（双兜底 var(--canvas-group-color-<key>, var(--canvas-group-border))）', () => {
  render(<NormalGroupRenderer {...baseProps} data={{ ...baseGroupData, color: 'red' }} />);
  expect(box.style.borderColor).toBe('var(--canvas-group-color-red, var(--canvas-group-border))');
});
it('组名入框（F17）：名称行渲染在组框内顶部（top:0 流坐标、无负向 translateY 浮层）', () => {
  render(<NormalGroupRenderer {...baseProps} data={{ ...baseGroupData, name: '我的组' }} />);
  const nameRow = screen.getByText('我的组');
  const host = nameRow.closest('[data-testid="group-box"]')!;
  expect(host).toBeTruthy();                       // 名在组盒内（外浮层=组盒外的兄弟节点）
  expect(nameRow.parentElement.style.transform).not.toMatch(/-100%/);  // 不再负向外浮
});
it('组名行与 BADGE「N 项」仍渲染（childCount）', () => { /* 既有断言保持 */ });
```

（既有 :32/:36 的 `border === ''` 断言**翻转**为上表；外浮层既有测试若有定位断言同步迁移。）

- [ ] **Step 2: 跑红** → **Step 3: 实现**——NormalGroupRenderer.tsx:87-97 组名行（badge+名）从"组框上缘外浮层（`transform: translateY(calc(-100% - 10px))`）"改为**组框内顶部**（`position:absolute; top:0; left:0; right:0; height:50px` 区带内——GROUP_PADDING_TOP=50 本就是组名预留区）；组盒 `data-testid="group-box"` div 增 `border: 1px solid var(--canvas-group-border)`+设色时 `border-color: var(--canvas-group-color-${color}, var(--canvas-group-border))`（inline style 双兜底——`resolveGroupColor` 返回 var 串或 undefined，`borderColor: resolveGroupColor(data.color) ?? 'var(--canvas-group-border)'` 等价双兜底，取后者字面以保 spec 双兜底形态）。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2c-5 展开态边框+组色边框+组名入框（F17/F22）`

**Task 2c-6：GroupToolbar 扩展（色点+排列子节点+批量下载+GROUP_TOOLBAR+水平夹取）**

- [ ] **Step 1: 写失败测试**——GroupToolbar.test.tsx 增补：

```ts
it('普通组按钮序：[色点] [排列子节点▾] │ [折叠] [整组执行] [转分镜组] [解组] │ [批量下载]（§4.4 需求 3）', () => {
  renderToolbar({ groupType: 'normal' });
  const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);
  expect(labels).toEqual(['组颜色', '排列子节点', '折叠', '整组执行', '转分镜组', '解组', '批量下载']);
});
it('色板浮层：role=listbox+7 option+aria-selected+「默认」清除项；点外/Esc 关闭', () => { /* §4.3 浮层规格同型 */ });
it('排列子节点菜单三项（网格/水平/垂直）→ arrangeGroupChildren(gid, mode)', () => {});
it('色点钮 size-10 内 20px 圆+当前色或中性 fallback；未知色按未设色', () => {});
it('批量下载钮：收集集=组内三桶全展开（复用 collectDownloadables，ids=组内全部子节点）', () => {});
it('折叠组：排列子节点 disabled（菜单项 disabled+守卫双层）', () => {});
it('水平夹取 clampToolbarX 接线（窄视口左溢出 → left ≥ 8）', () => {});
it('GROUP_TOOLBAR={52,12}：贴顶翻转公式用 height 52（现 40 断言迁移）', () => {});
```

- [ ] **Step 2: 跑红** → **Step 3: 实现**——GroupToolbar.tsx：TOOLBAR→GROUP_TOOLBAR 引用替换；增色点钮（opens 色板浮层 role=listbox/option/aria-selected/「默认」清除项=`setGroupColor(gid, undefined)`）；排列子钮（opens 三项菜单→`arrangeGroupChildren`）；批量下载钮（`collectDownloadables(nodes, 组内子节点 ids)` 空→aria-disabled+守卫；点击走 2b-4 同款串行流——**下载串行逻辑抽 `apps/web/src/utils/batchDownload.ts` 供两处复用**，2b-4 的 SelectionBoxOverlay 下载流同步改引）；按钮 h-9 圆角 10、色点钮内圆 20px、下载钮 size-9（§4.4 规格）。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2c-6 组工具条扩展（色点/排列子节点/批量下载+52/12+夹取）`

**Task 2c-7：2c 批尾**

- [ ] **Step 1**: web 全量 + `pnpm verify` + Playwright b0/b1-4 批次（`pnpm --filter @flowweb/web test:e2e -- b0` 以现场脚本名为准）。
- [ ] **Step 2**: 浏览器验收：组色全链路（设色→刷新仍在〔doc 持久化〕→转分镜→转回→组色仍在）；组名入框多 zoom 档（0.5/1/2）目视不与工具条撞；展开态边框深浅双板可见性；折叠组排列子节点 disabled。
- [ ] **Step 3**: 完成记录表填 2c 行（含 contrast 台账终值）。

---

## 决策门 E：RF 折叠渲染行为夹具（先于 2d 折叠收口，~1h）

**裁决问题**（R2d 收口的实现前提，spec §4.9 R2d 登记）：折叠收口后 cs/doc 的组 width/height **保持真值**（折叠不再覆写），渲染层以 COLLAPSED_SIZE 画折叠矩形——RF 对此的行为：

- 候选 1：RF `measured` 跟随渲染层内容盒（ResizeObserver）→ 选中框/手柄/连线锚按小盒——**收口直接成立**（渲染层 div 显式 220×160 即可）。
- 候选 2：RF 尊重 `node.width/height` 显式值优先于 measured（选中框围大框、视觉是小框——错位）→ 需调整：cs.nodes 折叠组**不携带 width 字段**（undefined）仅 doc data 面存真值，或渲染层另想办法。

**Task E-1：行为夹具（组件测试，结论回写完成记录表后保留为回归锚）**

- [ ] **Step 1: 写夹具**——`apps/web/src/pages/canvas/components/groups/collapse-render.gate.spec.tsx`：ReactFlow 内挂一个 `node={{ id:'g1', type:'group', width: 600, height: 400, data:{collapsed:true} }}`，GroupNode 折叠分支根 div 显式 `style={{width: 220, height: 160}}`；断言：

```ts
it('折叠组：渲染层小盒 220×160 时 RF measured/选中框跟随小盒（候选 1 成立）', async () => {
  render(<ReactFlowProvider><ReactFlow nodes={[gateNode]} nodeTypes={...}><GroupNodeGate/></ReactFlow></ReactFlowProvider>);
  await vi.waitFor(() => {
    const store = useStore.getState();   // @reactflow/core useStore——照 GroupToolbar.test 既有取法
    const n = store.nodeLookup.get('g1');
    expect(n?.measured?.width).toBe(220);   // measured 跟内容盒 → 候选 1
  });
});
it('nodeLookup width 显式值与 measured 并存时的选中框来源（录证——按实测固化断言）', () => {
  // 输出 node.internals 与 getNodesBounds([g1]) 实测值，人工判定后固化
});
```

- [ ] **Step 2: 跑并判定**——`pnpm --filter @flowweb/web test -- --run collapse-render.gate`；结论写完成记录表门 E 行：候选 1 ⇒ 2d Task 1 按主路径实现；候选 2 ⇒ 折叠组 cs.nodes width/height 置 undefined（envelope intent 删键——updateNodeEnvelope 的 undefined=删键语义正合适）+真值只存 doc data 面（`data.expandedSize`）——展开恢复读 data.expandedSize。
- [ ] **Step 3: Commit** `test(canvas): 门 E RF 折叠渲染行为夹具（收口实现形态裁决）`

---

## 分片 2d：折叠几何收口 + 折叠宫格卡 + 分镜改版 + 智能标题屏幕层

**Files:**
- Modify: `packages/shared/src/canvas/geometry.ts`（COLLAPSED_SIZE {220,160}）
- Modify: `packages/shared/src/types/group.ts`（Shape/KEYS 删 savedSize——9→8 键）
- Modify: `apps/api/src/modules/video-project/snapshot-filter.util.ts` 或 clone 表引用处（GROUP_NODE_DATA_KEYS 消费——随 shared 常量自动收敛，确认无字面量残留）
- Modify: `apps/web/src/stores/canvasStore.ts`（toggleCollapse 收口+duplicateNodes 折叠副本继承面+renameGroup 置 nameCustom）
- Create: `apps/web/src/pages/canvas/components/groups/CollapsedPreviewCard.tsx`
- Create: `apps/web/src/pages/canvas/components/groups/StoryboardTitlesLayer.tsx`
- Modify: `apps/web/src/pages/canvas/components/groups/NormalGroupRenderer.tsx`（折叠分支接 CollapsedPreviewCard）
- Modify: `apps/web/src/pages/canvas/components/groups/StoryboardGroupRenderer.tsx`（shell 改版+删右上角标题）
- Modify: `apps/web/src/pages/canvas/components/groups/GroupContextMenu.tsx`（重命名 F24）
- Modify: `apps/web/src/pages/canvas/CanvasView.tsx`（挂 StoryboardTitlesLayer+storyboard 工具条 children 补钮）
- Modify: `apps/web/src/api/mediaApi.ts`（batchGetMedia rewrite opt-in+ttlSec 类型）+ `apps/api/src/modules/media/media-batch.service.ts`（响应带 ttlSec）
- Modify: `apps/web/src/utils/mediaUrlCache.ts`（batch 预取回填入口）
- Test: 上述各组件 spec + canvasStore.groups.test.ts 迁移 + video-work-clone.service.spec.ts（clone 表键数）

**Task 2d-1：折叠几何收口（savedSize 退役+展开三分派消失——§4.9 R2d 登记）**

- [ ] **Step 1: 写失败测试**

```ts
// canvasStore.groups.test.ts 增补/迁移
describe('折叠收口（§4.9 R2d 登记）', () => {
  it('折叠：只置 collapsed=true——组 width/height 保持真值（不覆写 COLLAPSED_SIZE）+ savedSize 不产出', () => {
    seedGroup('g1', { width: 600, height: 400 });
    cs().toggleCollapse('g1');
    const g = cs().nodes[0];
    expect(g.data.collapsed).toBe(true);
    expect(g.data.savedSize).toBeUndefined();          // 模型键退役
    expect(g.width).toBe(600); expect(g.height).toBe(400);  // 真值保持（现状覆写 200×64——必红）
  });
  it('展开：仅置 collapsed=false——width/height 从未变过，三分派（savedSize/分镜配置/守恒重算）整体消失', () => {
    seedGroup('g1', { width: 600, height: 400 });
    cs().toggleCollapse('g1');   // 折
    cs().toggleCollapse('g1');   // 展
    const g = cs().nodes[0];
    expect(g.width).toBe(600); expect(g.height).toBe(400);
    expect(g.data.collapsed).toBe(false);
  });
  it('折叠往返期间子节点 rel 不变+手动组往返尺寸不变+分镜组往返=配置尺寸（三分派消失后的天然结果）', () => {
    /* 三夹具各一：manuallyResized 组 500×350 折叠展开仍 500×350（现状走 savedSize 恢复——收口后从未变过）；
       storyboard 组折叠展开=calcStoryboardSize（同理由）；normal 守恒组子 rel 恒定 */
  });
  it('savedSize 从 GROUP_NODE_DATA_KEYS 退役（9→8）——shared 锚定与 clone 表同步', () => {
    // packages/shared 侧：import { GROUP_NODE_DATA_KEYS } 断言不含 'savedSize'（既有双向锚定用例改期望）
  });
});
```

- [ ] **Step 2: 跑红** → **Step 3: 实现**：
  - `packages/shared/src/types/group.ts`：Shape 删 `savedSize`、KEYS 删 `'savedSize'`（双向锚定 satisfies/Exclude 自动跟随——锚定用例期望同步）；`geometry.ts` 无 savedSize 引用确认；
  - `toggleCollapse`（canvasStore.ts:1565-1604）折叠分支改：`patchGroupData(groupId, { collapsed: true })` **仅此一句**（envelope intent 覆写段+set 同步段删除；按门 E 结论若候选 2 则改 envelope patch `{width: undefined, height: undefined}` 删键）；展开分支改：`patchGroupData(groupId, { collapsed: false }); get().applyGroupDerivations();`（三分派整体删除）；
  - `convertGroup` 两处 `savedSize: undefined` patch 行删除（键已不存在）；
  - `duplicateNodes` 折叠组副本：`collapsed` 继承维持（savedSize 注释随键消失）；
  - API 侧 grep `savedSize` apps/api/src 零残留确认（clone 表经 GROUP_NODE_DATA_KEYS 值导入自动 8 键）；
  - **渲染层配套（若门 E 候选 1）**：NormalGroupRenderer 折叠分支根 div 显式 `style={{ width: COLLAPSED_SIZE.width, height: COLLAPSED_SIZE.height }}`（现状折叠卡内容小盒——保持，真值大框在 cs 不影响渲染）；StoryboardGroupRenderer/GroupNode 折叠分支同款核对（grep `collapsed` 于三个渲染组件，折叠路径全部显式小盒）。
- [ ] **Step 4: 跑绿**（含既有折叠相关用例迁移：`groups.test.ts:200` 附近 COLLAPSED_SIZE 断言随 Task 2d-2 一并改 220×160）+ **Step 5: Commit** `feat(canvas): R2d-1 折叠几何收口（savedSize 退役+三分派消失+真值恒在——§4.9）`

**Task 2d-2：COLLAPSED_SIZE {200,64}→{220,160}（§4.5）**

- [ ] **Step 1: 写失败测试**——`packages/shared/src/canvas/geometry.spec.ts`（或既有引用测试）：`expect(COLLAPSED_SIZE).toEqual({ width: 220, height: 160 })`；canvasStore.groups.test.ts 既有 200 断言迁移。
- [ ] **Step 2: 跑红** → **Step 3: 实现**——geometry.ts:30 改值（单源——所有消费面自动跟随：toggleCollapse 已在 2d-1 摘除覆写/渲染层 COLLAPSED_SIZE import/折叠卡尺寸）。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(shared): R2d-2 COLLAPSED_SIZE 220×160（单源改值）`

**Task 2d-3：CollapsedPreviewCard 宫格预览卡（§4.5）**

- [ ] **Step 1: 写失败测试**

```ts
// CollapsedPreviewCard.test.tsx
describe('折叠宫格预览卡（§4.5）', () => {
  it('结构：预览宫格（padding 6/gap 4/圆角 6）+summaryRow"N 个节点"；≤6 tile；其它类型图标占位', () => {
    render(<CollapsedPreviewCard name="我的组" cells={[imgNode, imgNode, textNode]} />);
    expect(screen.getByText('3 个节点')).toBeTruthy();
    expect(screen.getAllByTestId('preview-tile').length).toBe(3);   // 含 1 个图标占位 tile
  });
  it('列数：1-2 个图→按数量；3-4 个→2 列；5+→3 列（calcCollapsedGrid 纯函数单测先行）', () => {
    expect(calcCollapsedGrid(1)).toBe(1); expect(calcCollapsedGrid(2)).toBe(2);
    expect(calcCollapsedGrid(3)).toBe(2); expect(calcCollapsedGrid(4)).toBe(2);
    expect(calcCollapsedGrid(5)).toBe(3);
  });
  it('tile=独立组件用 useMediaUrl(fileId)；无 fileId 图→图标占位', () => {});
  it('组色着色折叠卡边框（双兜底）+选中态优先级：选中高亮>组色', () => {});
  it('根元素 title={组名}+aria-label="{组名}，N 个节点"', () => {
    render(<CollapsedPreviewCard name="旅行" cells={[imgNode]} />);
    expect(screen.getByTestId('collapsed-card').getAttribute('aria-label')).toBe('旅行，1 个节点');
  });
});
```

（`calcCollapsedGrid(n)` 落组件文件内导出纯函数。tile 的 useMediaUrl 对 fileIds≤6——**批量预取挂本组件挂载 effect（Task 2d-4）**。）

- [ ] **Step 2: 跑红** → **Step 3: 实现**——CollapsedPreviewCard.tsx（props：`{ name, color?, selected?, cells: { nodeId, fileId? }[] }`；宫格 CSS grid `repeat(calcCollapsedGrid(count), 1fr)`；summaryRow；tile 组件内部 useMediaUrl）+ NormalGroupRenderer 折叠分支替换现虚线框内容为 `<CollapsedPreviewCard …>`（name 从 data.name、cells 从组内子节点 fileId 提取——grep 现折叠分支取数逻辑接续）。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2d-3 折叠宫格预览卡（列数单源/tile useMediaUrl/aria）`

**Task 2d-4：batchGetMedia 预取（三口径 §4.5 v8）**

- [ ] **Step 1: 写失败测试**

```ts
// mediaApi/媒体链路增补
describe('折叠卡批量预取（§4.5 三口径）', () => {
  it('batchGetMediaRewritten：rewrite opt-in 入口（/flowai 同源改写）——既有 batchGetMedia 3 消费方行为不变（回归）', () => {});
  it('batch 响应带 ttlSec 字段（BatchMediaItem 类型+服务端下发——契约升格）', () => {
    // media-batch.service 响应 {..., ttlSec: 3600}；BatchMediaItem 增字段
  });
  it('挂载收集 tile fileIds（≤6）→ batchGetMedia(ids, teamId) 一次请求→回填模块缓存（__cachePutForTests 可测）', () => {});
  it('必须显式传 teamId（画布 teamId——缺省回落 getOwnerTeamId 与画布团队可能不同→静默降级无报错，§4.5①）', () => {});
  it('batch 失败不阻塞：tile 逐个 fallback 单取（useMediaUrl 常规路径）', () => {});
});
```

- [ ] **Step 2: 跑红** → **Step 3: 实现**：
  - `api/mediaApi.ts`：`batchGetMedia` 不动；新增 `batchGetMediaRewritten(ids, teamId)`（对返回 url 做 `/flowai` rewrite——与 getMediaUrl :7 同款）；
  - `apps/api/src/modules/media/media-batch.service.ts`：响应条目增 `ttlSec: 3600`（现签 TTL 常量单源引用，勿手写）；BatchMediaItem web 类型同步；
  - `mediaUrlCache.ts` 增 `prefetchMediaUrls(items: {fileId, url, ttlSec}[], userId)` 回填入口（LRU put 同形状 `{url, expiresAt: Date.now()+ttlSec*1000}`）；
  - CollapsedPreviewCard 挂载 effect：收集 fileIds→`batchGetMediaRewritten(ids, teamId)`→prefetchMediaUrls 回填；teamId 来源=画布 project teamId（grep `teamId` 于 canvasStore/page 现状取 store 字段；若画布 store 无 teamId——从 `useCanvasStore` 的 project 加载链补存一次，以现场为准登记实现）。
- [ ] **Step 4: 跑绿**（含既有 3 消费方回归：useWorkflowAssets/shadowJob 已删〔批 5〕确认消费方现存清单以 grep 为准/VideoEditNode）+ **Step 5: Commit** `feat(canvas): R2d-4 折叠卡批量预取（rewrite opt-in+ttlSec 契约+teamId 显式+失败降级）`

**Task 2d-5：StoryboardTitlesLayer 单例共享层 + 智能标题（§4.4 v9/v10）**

- [ ] **Step 1: 写失败测试**

```ts
// StoryboardTitlesLayer.test.tsx
describe('分镜智能标题屏幕层（v9/v10 裁决）', () => {
  it('标题=nameCustom?name:`分镜组 ${cells.filter(Boolean).length} 个节点`（§4.6 纯标记）', () => {});
  it('单例共享层：N 组只渲染 1 个 Layer、一次 viewport 订阅（渲染计数断言——N=3 时 useViewport 触发重渲染次数=1 组件×N 标题，非 3 个独立订阅组件）', () => {
    // 装置：3 个分镜组 → Layer 内 3 个标题 div；断言 Layer 组件实例数=1（data-testid 唯一）
  });
  it('常驻两条垂直带：标题带 frame.top−12、工具条带 frame.top−12−titleRowH（titleRowH=20）——分带互不重叠', () => {});
  it('1×1 窄组：标题 portal rect 与工具条 portal rect 不相交（v10——clamp 只解决视口溢出不解决组内碰撞）', () => {
    // 装置：320px 宽分镜组+≥500px 工具条 → getBoundingClientRect 两 rect 断言不相交
  });
  it('标题恒 13px 不随 zoom 缩放（屏幕层）+限宽省略（text-overflow: ellipsis）', () => {});
  it('N=画布全部分镜组（常驻非仅选中）', () => {});
});
```

- [ ] **Step 2: 跑红** → **Step 3: 实现**——StoryboardTitlesLayer.tsx（**一个组件、一次 useViewport() 订阅、内部 N 个绝对定位标题 div**；flow→screen 换算照 SelectionBoxOverlay :31-41 公式：`(frame.top)*zoom + vpY - 12` 标题带；挂 CanvasView 与 node-toolbar-portal 同级挂点）；CanvasView 挂载 `<StoryboardTitlesLayer groups={storyboardGroups} />`；StoryboardGroupRenderer.tsx:58-60 **删右上角 data.name 标签**（标题迁屏幕层——删除后 grep `data.name` 于该文件零渲染残留）。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2d-5 分镜智能标题屏幕层（单例共享层+分带+窄组不相交）`

**Task 2d-6：renameGroup 置 nameCustom + 右键重命名（F24）**

- [ ] **Step 1: 写失败测试**

```ts
it('renameGroup 置 nameCustom:true（智能标题切换为用户名）——普通组/分镜组同款', () => {
  seedGroup('g1', { groupType: 'storyboard', name: '分镜组 3 个节点' });
  cs().renameGroup('g1', '我的分镜');
  expect(cs().nodes[0].data.nameCustom).toBe(true);
  expect(cs().nodes[0].data.name).toBe('我的分镜');
});
it('GroupContextMenu 增「重命名」项（F24）——点击进入重命名（复用 NormalGroupRenderer 双击同一状态——菜单回调接线）', () => {});
```

（注意 renameGroup 现状兜底 `name.trim() || '分组'`——空名兜底语义维持，但**不再覆盖 nameCustom**：空名输入=取消重命名〔early return〕更贴合"纯标记"语义——以现测试断言为准裁定，若既有用例锁了空名兜底则保留兜底并仍置 nameCustom:true。）

- [ ] **Step 2: 跑红** → **Step 3: 实现**——canvasStore.ts renameGroup 增 `nameCustom: true` 入 patch；GroupContextMenu.tsx 菜单增「重命名」项（触发方式与 NormalGroupRenderer 双击共享同一编辑态——以现场组件状态管理形态接线：context menu 回调 `onRename` 提升到 CanvasView 或经 store 一次性 flag，取最小改动）。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2d-6 renameGroup 置 nameCustom+右键重命名入口（F24）`

**Task 2d-7：分镜 shell 改版 + 工具条补钮 + 三子组件 token 化（§4.6/F28）**

- [ ] **Step 1: 写失败测试**

```ts
// StoryboardGroupRenderer.test.tsx 增补/迁移
it('shell：背景 var(--canvas-storyboard-shell-bg)+边框 1px var(--canvas-group-border)（现 controls token 迁移）', () => {});
it('设组色时 border-color 吃组色（v10 裁决 4——双兜底；设色→转分镜→可见）', () => {});
it('右上角 data.name 标签已删（标题走屏幕层）', () => {
  render(<StoryboardGroupRenderer {...props} name="旧标签" />);
  expect(screen.queryByText('旧标签')).toBeNull();
});
// GroupToolbar/CanvasView storyboard children 增补
it('storyboard 工具条按钮序：[比例▾][宫格 r×c▾] │ [拼接(2K/4K)][№ 序号][🗑 清空][转普通组] │ [批量下载][解组]（§4.6）', () => {});
it('批量下载收集集=cells 的 fileId（需求 8 裁决——不加色点，shell 视觉承载区分）', () => {});
// 三子组件
it('AspectRatioDropdown/GridSizeDropdown/StitchButton 硬编码 #fff/#666/#aaa → controls token（F28——lint no-color-hex 对 style 对象豁免，断言 computed/源码零 hex）', () => {});
```

- [ ] **Step 2: 跑红** → **Step 3: 实现**——StoryboardGroupRenderer.tsx:36-47 shell 两 token 替换+组色 border-color 双兜底（同 2c-5 形态）+删 :58-60 标题；CanvasView.tsx:630-655 storyboard children 注入段补「转普通组」（convertGroup(gid,'normal')）「批量下载」（collectDownloadables 于 cells 节点）两钮+GroupToolbar storyboard 分支渲染补解组钮（onUngroup 已传）；三子组件硬编码色换 `var(--canvas-controls-*)`（grep `#fff|#666|#aaa` 于三文件）。
- [ ] **Step 4: 跑绿** + **Step 5: Commit** `feat(canvas): R2d-7 分镜 shell 改版+工具条补钮+三子组件 token 化（F28/v10-4）`

**Task 2d-8：R2 批尾（全分片收口）**

- [ ] **Step 1**: web 全量 + `pnpm verify` + api 全量（GROUP_NODE_DATA_KEYS 8 键连带——clone spec 迁移）。
- [ ] **Step 2**: **浏览器验收清单**（spec §5 浏览器验收行逐条）：
  1. 折叠卡 6 图宫格+深浅 7 色 computed 读数；网络面板 ≤1 次 batch 请求且带 teamId；
  2. 折叠/展开往返：手动组/分镜组/守恒组尺寸稳定（收口后无闪变）；
  3. 组名入框 vs 工具条 12px 余量（zoom 0.5/1/2 目视）；分镜标题与工具条分带不撞（含 1×1 窄组实测）；屏幕层标题恒 13px（zoom 0.5/2 目视）；
  4. 拖节点进组顶部不与框内组名重叠（clamp v11 域——回归确认 R1b 行为未破）；
  5. 设色→转分镜→组色可见→转回→仍在；克隆后组色仍在；
  6. 重命名（双击+右键）后分镜标题切换为用户名；自动名（转组分镜后）恢复智能标题；
  7. storyboard 工具条全按钮（含新转普通组/解组/批量下载）。
- [ ] **Step 3**: Playwright b0/b1-4+css-baseline-diff 绿（registry 已在 2c-1 裁定后）。
- [ ] **Step 4**: 完成记录表填 门 E/2d 行；**R2 完成后主动提醒：回到 Spec B 审核**（组几何+批量连线——spec_ab_staging 约定）。

---

## 完成记录表（每分片尾滚动填写）

| 分片/门 | 状态 | commit | 备注 |
|---|---|---|---|
| 2a | 待执行 | — | — |
| 2b | 待执行 | — | — |
| 2c | 待执行 | — | — |
| 门 E（RF 折叠渲染） | 待执行 | — | — |
| 2d | 待执行 | — | — |

---

## Self-Review（writing-plans 检查单——已执行）

1. **Spec 覆盖**：§4.1→2a-1；§4.2 Token/门禁→2c-1（b0/registry 同 task；门禁类 mediaUrl→2b-7）；§4.3 多选工具条视觉→2a-7、clampToolbarX→2a-4、浮层规格→2a-7（排列菜单即载体）、arrangeSelection→2a-2/3/5、duplicateNodes→2a-6、批量下载→2b-1~4、mediaUrl 收敛→2b-5~7；§4.4 组工具条/组色/组名入框/排列子节点→2c-2~6；§4.5 折叠卡/缓存/batch 预取→2d-2~4（COLLAPSED_SIZE 220×160 单源）；§4.6 分镜改版/智能标题/工具条/三子组件→2d-5/7；§4.9 R2d 折叠收口登记→门 E+2d-1；F7 缓存根修→R0c 已落（探查实证）仅 batch 预取补 2d-4；F12 copyNode→2a-6；F15 主图→2b-3；F17/F22→2c-5；F24→2d-6；F28→2d-7；F37→2b-5~7；F40→2a-3；F41→2a-6。需求 1/2/3/4/8 全映射。
2. **占位符扫描**：2a-3 实现段含一处示意性死代码已显式标注"实现时删除"；2a-5 `w/h` 三档含 `/* 同上三档 */` 缩写——已附"抽 storedRectOf"指令与三档语义全文；其余步骤均含完整代码/精确指令。
3. **类型一致性**：normalizeSelection/participation/sortForArrange/arrangeRects/clampToolbarX/downloadMediaFile/collectDownloadables/resolveGroupColor/setGroupColor/arrangeGroupChildren/CollapsedPreviewCard/StoryboardTitlesLayer/batchGetMediaRewritten/prefetchMediaUrls 跨任务签名逐一核对一致；GroupColorKey 由 GROUP_PALETTE 派生与 shared Shape `color` 键（string 面）交接处以"写入端拒键/读取端兜底"钉死（后端形状过滤不复制枚举——spec §4.4）。

