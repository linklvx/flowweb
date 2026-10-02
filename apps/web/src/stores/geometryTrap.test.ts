// apps/web/src/stores/geometryTrap.test.ts
// C0-2 dev-only cs 几何写陷阱守卫测试（Spec B）：三锚（造案抛/夹具不抛/静态棘轮单调下降）
// + 三键辖域/写者上下文/身份 diff/模式骨架行为。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
describe('geometryTrap 锚③：静态棘轮报数 ≤ 有效基线（212 处/39 文件，只降不升）', () => {
  // vitest cwd=包根 apps/web（canvasStore.groups.test.ts 源码扫描同口径）。
  // 基线口径（apps/web/scripts/lint-gate-constants.mjs 同源，改数须两处同步）：
  // 存量起点 201/38（2026-10-02 grep）+ 本片造案夹具 geometryTrap.test.ts +9 处/1 文件
  // （陷阱守卫测试手写 setState 是造案的存在目的——allow-list 第 39 条 sanctioned 例外）
  // + O0a-1 canvasIntents.spec 剥键锚用例 +2 处（diff 剥键锚需 cs 直写构造 before/after 差——同例外）。
  const SRC_ROOT = join(process.cwd(), 'src');
  const BASELINE_COUNT = 212;
  const BASELINE_FILES = 39;

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

  it('test/spec 面 store 侧 setState 处数 ≤212 且文件数 ≤39（起点 201/38+造案夹具+O0a-1 剥键锚，只降不升）', () => {
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

// —— O0b 挂点（it.todo 先建后清：接线归各分片，B7-1 归零——it.todo 计数锚）——
describe('O0b 陷阱接线挂点（C0-2 只落骨架，本片不接线生产链路）', () => {
  it.todo('O0b-6 接线：onNodesChange reconcile 窗标写者上下文——applyNodeChanges 前 setGeometryWriter("reconcile")，dimensions setAttributes 变更细分 "dimensions-attribute"（首测固化路径）');
  it.todo('O0b-7 接线：canvasIntents/canvasCollabRuntime 投影写体标 "projection-default"（projectIntentToStore/applyDocToStore/dispatchProjectionDiff 窗）');
  it.todo('O0b-8 接线：应用 bootstrap（canvas/page 会话入口）enableGeometryTrap()——DEV 抛模式进入点（写者上下文接线完成后开放）');
  it.todo('O0b-9 接线：canvasStore 结构命令体（structure-command/config-command/node-create 写点）逐函数标写者上下文——以 geometryWriterRegistry 账本为底册');
});
