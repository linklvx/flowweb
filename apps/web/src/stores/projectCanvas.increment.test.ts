// apps/web/src/stores/projectCanvas.increment.test.ts
// Y2 第①步（A1 骨架）：D3 增量管线验收宿主——≥200 节点夹具+全量重建对照+写计数/身份复用。
//
// 夹具口径（spec D3 验收，本注释为单源）：
// - 节点数 ≥200 且含恰一个分镜组（storyboard）与若干 auto/manual 组——确定性生成（禁随机）。
// - 全量重建对照 = 同夹具上「全量投影 + 全新对象」的工作量口径（applyDocToStore 删除后以测试内
//   等价全量路径为对照）——带身份复用的投影必须短于该对照；阈值不得宽于全量对照量级，
//   实测毫秒数写在该测试断言旁。
// - 身份复用比较对象=上一帧最终渲染对象（含写进 cellNodes 的覆盖），不是内核当次新分配对象——
//   格子内容未变时组节点必须复用上一帧对象（含原 cellNodes 引用）。
// - 写计数口径（v2.11 钉死）：一次本地作者事务 useCanvasStore.setState 恰 1 次；
//   nodeStore.nodes 由同一 toReadModel(doc) 快照在同一同步函数更新，不计入。
import { describe, it } from 'vitest';
import type { RenderSourceNode, RenderSourceEdge } from '@flowweb/shared';

/** 确定性 ≥200 节点夹具：10 个组（auto×5+manual×3+storyboard×1+collapsed×1）+每组成员子+顶层散节点。
 *  行号敏感零随机：第 i 个子节点 position 由 i 线性推出。 */
export function buildIncrementFixture(): {
  records: RenderSourceNode[];
  edges: RenderSourceEdge[];
} {
  const records: RenderSourceNode[] = [];
  const edges: RenderSourceEdge[] = [];
  // auto 组 ×5：每组 20 子
  for (let g = 0; g < 5; g++) {
    const gid = `auto-g${g}`;
    records.push({ id: gid, type: 'group', data: { groupType: 'normal', name: `auto-${g}` } });
    for (let c = 0; c < 20; c++) {
      records.push({
        id: `${gid}-c${c}`, type: 'imageGen', parentId: gid,
        position: { x: 100 + c * 30 + g * 800, y: 50 + c * 20 },
        width: 100, height: 60, data: {},
      });
    }
  }
  // manual 组 ×3：帧三键密封，每组 15 子
  for (let g = 0; g < 3; g++) {
    const gid = `man-g${g}`;
    records.push({
      id: gid, type: 'group',
      position: { x: 5000 + g * 900, y: 100 }, width: 800, height: 600,
      data: { groupType: 'normal', name: `manual-${g}` },
    });
    for (let c = 0; c < 15; c++) {
      records.push({
        id: `${gid}-c${c}`, type: 'imageGen', parentId: gid,
        position: { x: 5010 + c * 40 + g * 900, y: 120 + c * 30 },
        width: 120, height: 80, data: {},
      });
    }
  }
  // 分镜组 ×1：4 格（gridRows 2×gridCols 2），分镜子带 slot 无 position
  records.push({
    id: 'sb-1', type: 'group', position: { x: 0, y: 9000 },
    data: {
      groupType: 'storyboard',
      storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: true, stitchResolution: '2K' },
    },
  });
  for (let s = 0; s < 4; s++) {
    records.push({
      id: `sb-1-s${s}`, type: 'imageGen', parentId: 'sb-1',
      width: 320, height: 180,
      data: { slot: s },
    });
  }
  // collapsed 组 ×1：6 子（hidden 剔除路径）
  records.push({
    id: 'col-1', type: 'group', data: { groupType: 'normal', name: 'col', collapsed: true },
  });
  for (let c = 0; c < 6; c++) {
    records.push({
      id: `col-1-c${c}`, type: 'textInput', parentId: 'col-1',
      position: { x: 9000 + c * 50, y: 200 + c * 40 }, data: {},
    });
  }
  // 顶层散节点补足 ≥200：现有 100+45+5+7=157，再补 60
  for (let t = 0; t < 60; t++) {
    records.push({
      id: `top-${t}`, type: 'imageGen',
      position: { x: 12000 + t * 25, y: (t % 40) * 35 }, width: 90, height: 90, data: {},
    });
    if (t > 0) edges.push({ id: `e-${t}`, source: `top-${t - 1}`, target: `top-${t}` });
  }
  // 组间少量边（跨组可见节点）
  edges.push({ id: 'e-x1', source: 'auto-g0-c0', target: 'auto-g1-c0' });
  edges.push({ id: 'e-x2', source: 'top-0', target: 'auto-g2-c0' });
  return { records, edges };
}

describe('Y2 D3 增量：写计数（一次本地作者事务 cs setState 恰 1 次）', () => {
  it.skip('单键编辑——useCanvasStore.setState 恰 1 次（nodeStore 同快照同函数更新不计入；现状 cs 写 2 次+ns 写 2 次必红——A2b 落位）', () => {});
  it.skip('本地事务取消已挂远端定时器后，store 仍包含已进 doc 的远端更新（读滞后取消会丢已进未投的远端批——A2b 落位）', () => {});
  it.skip('红测装置钉死被测路径=applyNodeDataPatch（updateConfig 路径自有桥退役后同绿——A2b 落位）', () => {});
});

describe('Y2 D3 增量：身份复用（比较对象=上一帧最终渲染对象）', () => {
  it.skip('applyDocToStore 全量换新破身份——现状必红，接线后未变节点身份不变（A2b 落位）', () => {});
  it.skip('≥200 节点夹具：格子内容未变时组节点复用上一帧对象（含原 cellNodes 引用）（A2b 落位）', () => {});
  it.skip('带复用投影短于同夹具全量重建对照（毫秒数写在断言旁；阈值不得宽于全量对照量级）（A2b 落位）', () => {});
});
