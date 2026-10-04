// apps/web/src/stores/geometryTrap.test.ts
// C0-2 dev-only cs 几何写陷阱守卫测试（Spec B）：三锚（造案抛/夹具不抛/静态棘轮单调下降）
// + 三键辖域/写者上下文/身份 diff/模式骨架行为。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Node } from '@xyflow/react';
import { useCanvasStore } from './canvasStore';
import {
  enableGeometryTrap,
  disableGeometryTrap,
  setGeometryWriter,
  withGeometryWriter,
  getGeometryViolationCount,
  isGeometryTrapEnabled,
} from './geometryTrap';
import { seedCanvas, makeGroup, makeChild } from '@/test/fixtures/canvas';

const n1 = (): Node => ({
  id: 'n1', type: 'imageGen', position: { x: 100, y: 100 }, width: 200, height: 100, data: {},
} as Node);

beforeEach(() => {
  disableGeometryTrap(); // 幂等——未装时 no-op
  useCanvasStore.setState({ nodes: [n1()], edges: [], selectedId: null });
});

afterEach(() => {
  disableGeometryTrap();
});

const moveN1 = () =>
  useCanvasStore.setState((s) => ({
    nodes: s.nodes.map((n) => (n.id === 'n1' ? { ...n, position: { x: 9, y: 9 } } : n)),
  }));

describe('geometryTrap 锚①：enableGeometryTrap() 下生产侧手写几何 setState ⇒ 抛（造案）', () => {
  it('无写者上下文改 position → 抛"首个越权写者"且计数 +1', () => {
    enableGeometryTrap();
    const before = getGeometryViolationCount();
    expect(moveN1).toThrow(/越权写者/);
    expect(getGeometryViolationCount()).toBe(before + 1);
  });

  it('width/height 同辖域（无上下文改宽度 → 抛）', () => {
    enableGeometryTrap();
    expect(() =>
      useCanvasStore.setState((s) => ({
        nodes: s.nodes.map((n) => (n.id === 'n1' ? { ...n, width: 300 } : n)),
      })),
    ).toThrow(/越权写者/);
  });

  it('新增节点携 position 也是几何写（append 即写——无上下文 → 抛）', () => {
    enableGeometryTrap();
    expect(() =>
      useCanvasStore.setState((s) => ({
        nodes: [...s.nodes, makeChild({ id: 'fresh', position: { x: 1, y: 1 } })],
      })),
    ).toThrow(/越权写者/);
  });
});

describe('geometryTrap 三键辖域与放行面（只对 position/width/height 抛）', () => {
  it('selected/dragging 标记变更放行（对象换新但几何键未变 → 不抛）', () => {
    enableGeometryTrap();
    expect(() =>
      useCanvasStore.setState((s) => ({
        nodes: s.nodes.map((n) => (n.id === 'n1' ? { ...n, selected: true, dragging: true } : n)),
      })),
    ).not.toThrow();
  });

  it('节点对象身份相同（数组重建但同引用）→ 身份 diff 零深比不抛', () => {
    enableGeometryTrap();
    expect(() => useCanvasStore.setState((s) => ({ nodes: [...s.nodes] }))).not.toThrow();
    expect(() => useCanvasStore.setState((s) => ({ nodes: [...s.nodes].reverse() }))).not.toThrow();
  });

  it('节点删除（结构收缩）非字段写 → 不抛', () => {
    enableGeometryTrap();
    expect(() => useCanvasStore.setState({ nodes: [] })).not.toThrow();
  });
});

describe('geometryTrap 写者上下文（registry 类别封闭）', () => {
  it('合法写者上下文放行（withGeometryWriter 包住变更）', () => {
    enableGeometryTrap();
    expect(() => withGeometryWriter('reconcile', moveN1)).not.toThrow();
  });

  it('dimensions-attribute 独立写者类别放行 width 写（RF setAttributes 路径首测固化）', () => {
    enableGeometryTrap();
    expect(() =>
      withGeometryWriter('dimensions-attribute', () =>
        useCanvasStore.setState((s) => ({
          nodes: s.nodes.map((n) => (n.id === 'n1' ? { ...n, width: 320, height: 180 } : n)),
        })),
      ),
    ).not.toThrow();
  });

  it('未登记写者名当场拒（类别枚举封闭——setGeometryWriter 校验）', () => {
    expect(() => setGeometryWriter('not-a-writer' as never)).toThrow(/写者类别/);
  });

  it('withGeometryWriter 异常路径恢复上下文（嵌套安全）', () => {
    enableGeometryTrap();
    expect(() =>
      withGeometryWriter('reconcile', () => {
        throw new Error('boom');
      }),
    ).toThrow(/boom/);
    // 上下文已恢复 null——越权写回到"抛"语义
    expect(moveN1).toThrow(/越权写者/);
    // 再进合法上下文恢复正常放行
    expect(() => withGeometryWriter('fixture', moveN1)).not.toThrow();
  });
});

describe('geometryTrap 锚②：夹具入口注入 ⇒ 不抛', () => {
  it('seedCanvas（fixture 写者上下文内）整画布注入 → 不抛', () => {
    enableGeometryTrap();
    expect(() =>
      seedCanvas([
        makeChild({ id: 'c1', position: { x: 10, y: 20 }, width: 100, height: 50 }),
        makeGroup({ id: 'g1', position: { x: 0, y: 0 }, width: 300, height: 200 }),
      ]),
    ).not.toThrow();
    expect(useCanvasStore.getState().nodes).toHaveLength(2);
  });

  it('makeGroup/makeChild 纯构造零 store 写（不触陷阱不碰 store）', () => {
    enableGeometryTrap();
    const before = useCanvasStore.getState().nodes.length;
    makeGroup({ id: 'g9' });
    makeChild({ id: 'c9' });
    expect(useCanvasStore.getState().nodes).toHaveLength(before);
  });
});

describe('geometryTrap 生命周期（订阅不可重复装）', () => {
  it('重复 enable 幂等：一次越权写只计一次违例', () => {
    enableGeometryTrap();
    enableGeometryTrap();
    const before = getGeometryViolationCount();
    expect(moveN1).toThrow(/越权写者/);
    expect(getGeometryViolationCount()).toBe(before + 1);
  });

  it('disableGeometryTrap 后写放行（订阅拆除+上下文清空）', () => {
    enableGeometryTrap();
    expect(isGeometryTrapEnabled()).toBe(true);
    disableGeometryTrap();
    expect(isGeometryTrapEnabled()).toBe(false);
    expect(moveN1).not.toThrow();
  });
});

// —— 锚③：静态棘轮（test/spec 面 store 侧 setState 调用报数单调下降）——
describe('geometryTrap 锚③：静态棘轮报数 ≤ 有效基线（216 处/39 文件，只降不升）', () => {
  // vitest cwd=包根 apps/web（canvasStore.groups.test.ts 源码扫描同口径）。
  // 基线口径（apps/web/scripts/lint-gate-constants.mjs 同源，改数须两处同步）：
  // 存量起点 201/38（2026-10-02 grep）+ 本片造案夹具 geometryTrap.test.ts +9 处/1 文件
  // （陷阱守卫测试手写 setState 是造案的存在目的——allow-list 第 39 条 sanctioned 例外）
  // + O0a-1 canvasIntents.spec 剥键锚用例 +2 处（diff 剥键锚需 cs 直写构造 before/after 差——同例外）
  // + O0a-1 评审收口集成造案 +2 处（批尾 DEV throw 挂点守卫——镜像 store 构造 before/after，同例外）
  // + O0a-1 质评 I-1 零位移角点造案 +2 处（补发 moveNode 剥键守卫——构造入分镜组零位移差，同例外）
  // + O0b-0 格式批造案 +5 处/1 文件（canvasCollabRuntime.geometry.test.ts——翻转主锚/S1 停写锚/
  //   读侧版本门的装置清理与 rw 窗口构造，同例外）。
  const SRC_ROOT = join(process.cwd(), 'src');
  const BASELINE_COUNT = 221;
  const BASELINE_FILES = 40;

  function* walkTestFiles(dir: string): Generator<string> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        yield* walkTestFiles(full);
      } else if (entry.isFile() && /\.(test|spec)\.[jt]sx?$/.test(entry.name)) {
        yield full;
      }
    }
  }

  it('test/spec 面 store 侧 setState 处数 ≤221 且文件数 ≤40（起点 201/38+造案夹具+O0a-1 剥键锚/集成造案/I-1 角点造案+O0b-0 翻转锚造案 5/1，只降不升）', () => {
    let count = 0;
    let files = 0;
    for (const f of walkTestFiles(SRC_ROOT)) {
      const hits = readFileSync(f, 'utf8').match(/\buseCanvasStore\.setState\(/g);
      if (hits) {
        files += 1;
        count += hits.length;
      }
    }
    expect(files).toBeLessThanOrEqual(BASELINE_FILES);
    expect(count).toBeLessThanOrEqual(BASELINE_COUNT);
  });
});

// —— O0b 挂点（B7-1 归零——it.todo 先建后清兑现：O0b-6/7/8/9 全转实，it.todo 计数=0 终裁 58③）——
describe('O0b 陷阱接线挂点（C0-2 骨架→O0b-6/7/8/9 逐片接线→B7-1 全转实）', () => {
  it("O0b-6 接线（B4'-2 落地）：onNodesChange applyNodeChanges 窗写者上下文——position 批标 'reconcile'、dimensions setAttributes 批细分 'dimensions-attribute'", () => {
    seedCanvas([makeChild({ id: 'n1', position: { x: 1, y: 2 }, width: 100, height: 50 })]);
    enableGeometryTrap();
    // 门判据②的 DEV 告警（无 session position 批）与本锚无关——静音 spy
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      useCanvasStore.getState().onNodesChange([
        { type: 'position', id: 'n1', position: { x: 9, y: 9 }, dragging: true } as any,
      ]),
    ).not.toThrow();   // applyNodeChanges 窗标 'reconcile' 在位
    expect(() =>
      useCanvasStore.getState().onNodesChange([
        { type: 'dimensions', id: 'n1', setAttributes: true, resizing: true, dimensions: { width: 320, height: 180 } } as any,
      ]),
    ).not.toThrow();   // 批含 dimensions setAttributes ⇒ 细分 'dimensions-attribute'（首测固化路径同窗）
    errSpy.mockRestore();
  });
  it('O0b-7 接线（B7-1 转实）：投影写体标 projection-default——projectIntentToStore append 窗+applyDocToStore 水合窗，陷阱开启下全链零抛', async () => {
    const { openRwWindow, openRoWindow, resetCanvasStores } = await import('@/test/fixtures/canvas');
    const { applyDocToStore } = await import('./canvasCollabRuntime');
    const { _setIntentDocForTest } = await import('./canvasIntents');
    const { fillDoc, toDocLike } = await import('@/collab/ydocBuilder');
    const { stampDocSchema } = await import('@flowweb/shared');
    openRwWindow();
    const d = new (await import('yjs')).Doc();
    fillDoc(d, [
      { id: 'a1', type: 'textInput', position: { x: 0, y: 0 }, data: {} },
      { id: 'a2', type: 'textInput', position: { x: 360, y: 0 }, data: {} },
    ], []);
    stampDocSchema(toDocLike(d));
    applyDocToStore(d);           // 水合投影（projection-default）+ 尾挂 reconcile（reconcile）——陷阱开启下不抛
    _setIntentDocForTest(d);
    enableGeometryTrap();
    expect(() => useCanvasStore.getState().addNode('textInput', { x: 50, y: 60 })).not.toThrow();
    // 投影 append 回退分支（ro 窗 dispatch 被拦 → node-create 标注的原 append）同窗不抛
    openRoWindow();
    expect(() => useCanvasStore.getState().addNode('textInput', { x: 70, y: 80 })).not.toThrow();
    // 反证：陷阱确实在装（无写者上下文的越权写仍抛——非空转绿；目标=a1，applyDocToStore 后在场）
    const unlabeledMove = () => useCanvasStore.setState((s) => ({
      nodes: s.nodes.map((n: any) => (n.id === 'a1' ? { ...n, position: { x: 9, y: 9 } } : n)),
    }));
    expect(unlabeledMove).toThrow(/越权写者/);
    _setIntentDocForTest(null);
    resetCanvasStores();
  });
  it('O0b-8 接线（B7-1 转实）：应用 bootstrap（canvas/page 会话入口）bootstrapGeometryTrap()——vitest 自守卫不装+page 接线行在场（DEV 抛模式进入点）', async () => {
    const { bootstrapGeometryTrap } = await import('./geometryTrap');
    // vitest 模式自守卫：bootstrap 不装（守卫测试显式 enableGeometryTrap 造案——测试面存量 setState 不入辖域）
    bootstrapGeometryTrap();
    expect(isGeometryTrapEnabled()).toBe(false);
    // census：会话入口接线行在场（page.tsx 会话 useEffect 首段）
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const pageSrc = readFileSync(join(process.cwd(), 'src/pages/canvas/page.tsx'), 'utf8');
    expect(pageSrc).toContain('bootstrapGeometryTrap();');
  });
  it('O0b-9 接线（B7-1 转实）：canvasStore 结构/配置/建点命令体逐函数标写者上下文（registry 账本为底册）——陷阱开启下结构命令全链零抛', async () => {
    const { openRwWindow, resetCanvasStores } = await import('@/test/fixtures/canvas');
    const { applyDocToStore } = await import('./canvasCollabRuntime');
    const { _setIntentDocForTest } = await import('./canvasIntents');
    const { fillDoc, toDocLike } = await import('@/collab/ydocBuilder');
    const { stampDocSchema } = await import('@flowweb/shared');
    openRwWindow();
    const d = new (await import('yjs')).Doc();
    fillDoc(d, [
      { id: 'a1', type: 'textInput', position: { x: 0, y: 0 }, data: {} },
      { id: 'a2', type: 'textInput', position: { x: 360, y: 0 }, data: {} },
      { id: 'a3', type: 'textInput', position: { x: 720, y: 0 }, data: {} },
      { id: 'img1', type: 'imageGen', position: { x: 0, y: 300 }, width: 200, height: 120, data: { status: 'done' } },
      { id: 'img2', type: 'imageGen', position: { x: 300, y: 300 }, width: 200, height: 120, data: { status: 'done' } },
    ], []);
    stampDocSchema(toDocLike(d));
    applyDocToStore(d);
    _setIntentDocForTest(d);
    enableGeometryTrap();
    const st = useCanvasStore.getState;
    const groupIdOf = (which: number) =>
      (useCanvasStore.getState().nodes.filter((n: any) => n.type === 'group')[which] as any).id as string;
    // structure-command 族（经 setWithParentOrder 包装/直接 set 均已标）
    expect(() => st().groupNodes(['a1', 'a2'])).not.toThrow();
    const gid = useCanvasStore.getState().nodes.find((n: any) => n.type === 'group')!.id as string;
    expect(() => st().addToGroup(gid, 'a3')).not.toThrow();
    expect(() => st().arrangeSelection(['a1', 'a2'], 'horizontal')).not.toThrow();
    expect(() => st().arrangeGroupChildren(gid, 'vertical')).not.toThrow();
    expect(() => st().toggleCollapse(gid)).not.toThrow();
    expect(() => st().removeNodeFromGroup(gid, 'a3')).not.toThrow();
    // 分镜转换组=图片节点组（convertGroup 分镜分支守卫"仅图片"）
    expect(() => st().groupNodes(['img1', 'img2'])).not.toThrow();
    const imgGid = groupIdOf(1);
    expect(() => st().convertGroup(imgGid, 'storyboard')).not.toThrow();
    // config-command 族
    expect(() => st().resizeStoryboardGrid(imgGid, 3, 3)).not.toThrow();
    expect(() => st().convertGroup(imgGid, 'normal')).not.toThrow();
    // node-create 族（appendCopyPlan 副本信封经 setWithParentOrder('node-create')）
    expect(() => st().duplicateNodes(['a1'])).not.toThrow();
    // 手势内核（begin/endGesture 回滚写='gesture'）
    expect(() => st().beginDragGesture([{ id: 'a1' }, { id: 'a2' }], 1)).not.toThrow();
    expect(() => st().endGesture('aborted')).not.toThrow();
    // 反证：陷阱在装（越权写仍抛——非空转绿；目标=a3，结构命令链后在场）
    const unlabeledMove = () => useCanvasStore.setState((s) => ({
      nodes: s.nodes.map((n: any) => (n.id === 'a3' ? { ...n, position: { x: 9, y: 9 } } : n)),
    }));
    expect(unlabeledMove).toThrow(/越权写者/);
    _setIntentDocForTest(null);
    resetCanvasStores();
  });
});

// —— B7-1 census（终裁 58③）：it.todo 计数=0（分片 unskip 全部转实）——
describe('B7-1 census：全仓 it.todo 计数=0（先建后清兑现——C0-2 建 8/分片 unskip/B7-1 归零）', () => {
  it('apps/*/src+packages/*/src 全量（含 test/spec）代码行 it.todo 调用零命中', () => {
    // 自证豁免构造（本行不拼出可命中的字面量——拼接而非直写）
    const NEEDLE = ['it', '.todo('].join('');
    // 扫描域=apps/*/src+packages/*/src（vitest cwd=apps/web——api 经相对路径纳入）
    const dirs = [join(process.cwd(), 'src'), join(process.cwd(), '../api/src'), join(process.cwd(), '../../packages')];
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx|js|mjs)$/.test(entry.name)) continue;
        for (const raw of readFileSync(full, 'utf8').split('\n')) {
          const t = raw.trim();
          if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
          if (raw.includes(NEEDLE)) hits.push(`${full}: ${t}`);
        }
      }
    };
    for (const dir of dirs) walk(dir);
    expect(hits, JSON.stringify(hits, null, 2)).toEqual([]);
  });
});
