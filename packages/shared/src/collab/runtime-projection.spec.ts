// packages/shared/src/collab/runtime-projection.spec.ts
// Y1c T5c（plan v1.7 Task 5 客户端/恢复段；spec v5.4 §6.4/§7——偏离 38⑭）：RuntimeProjection 契约+
// mergeRuntimeProjection 唯一 merge 纯函数+composeRenderModel 合成+四读径+Runtime Store 离线语义
// 的契约测试。先红→绿。
import { describe, expect, it } from 'vitest';
import type { CanvasReadModel } from '../canvas/doc-codec';
import {
  RuntimeProjection, RuntimeNodeProjectionEntry, mergeRuntimeProjection, composeRenderModel,
  formatPublicSnapshotCacheKey, BindMediaCommand, CloneBindingCommand, FOUR_READ_PATHS,
  COPY_PASTE_COMMAND_CONTRACT,
  RUNTIME_STORE_TTL_DAYS, RUNTIME_STORE_TTL_MS, RuntimeStoreFreshness,
  resolveRuntimeStoreFreshness, formatRuntimeStaleLabel, RUNTIME_STORE_UI_CONTRACT,
  UNKNOWN_NOT_IDLE, RUNTIME_PROJECTION_WIRE_STRING_FIELDS,
} from './runtime-projection';

const proj = (over: Partial<RuntimeProjection> = {}): RuntimeProjection => ({
  projectId: 'p1', generation: 3, feedSeq: '10', pgSeq: '100',
  nodes: {}, mediaFacts: {}, ...over,
});

const entry = (over: Partial<RuntimeNodeProjectionEntry> = {}): RuntimeNodeProjectionEntry => ({ ...over });

describe('Y1c T5c 契约冻结：RuntimeProjection 契约类型（§6.4 v5.4⑬——wire=string 纪律）', () => {
  it('形状冻结：{projectId,generation,feedSeq,pgSeq,nodes{exec?,media?,deletedAt?},mediaFacts{...factVersion,feedSeq}}', () => {
    const p = proj({
      nodes: {
        n1: entry({
          exec: { status: 'done', artifactRev: 2, execSeq: '7', nodeVersion: '10' },
          media: { naturalWidth: 1920, naturalHeight: 1080, factVersion: 3, nodeVersion: '9' },
        }),
        n2: entry({ deletedAt: { lifecycleSeq: '15', nodeVersion: '12' } }),
      },
      mediaFacts: { m1: { naturalWidth: 800, naturalHeight: 600, factVersion: 3, feedSeq: '9' } },
    });
    expect(Object.keys(p).sort()).toEqual(['feedSeq', 'generation', 'mediaFacts', 'nodes', 'pgSeq', 'projectId']);
    expect(Object.keys(p.nodes.n1!).sort()).toEqual(['exec', 'media']);
    expect(Object.keys(p.nodes.n2!).sort()).toEqual(['deletedAt']);
    expect(Object.keys(p.mediaFacts.m1!).sort()).toEqual(['factVersion', 'feedSeq', 'naturalHeight', 'naturalWidth']);
    // BigInt wire=string 纪律（§5.2——feedSeq/pgSeq/nodeVersion/execSeq/lifecycleSeq 全 string 面）
    expect(typeof p.feedSeq).toBe('string');
    expect(typeof p.pgSeq).toBe('string');
    expect(typeof p.nodes.n1!.exec!.nodeVersion).toBe('string');
    expect(typeof p.nodes.n1!.exec!.execSeq).toBe('string');
    expect(typeof p.nodes.n2!.deletedAt!.lifecycleSeq).toBe('string');
    expect(RUNTIME_PROJECTION_WIRE_STRING_FIELDS).toContain('feedSeq');
    expect(RUNTIME_PROJECTION_WIRE_STRING_FIELDS).toContain('pgSeq');
    expect(RUNTIME_PROJECTION_WIRE_STRING_FIELDS).toContain('nodeVersion');
    expect(RUNTIME_PROJECTION_WIRE_STRING_FIELDS).toContain('execSeq');
  });
});

describe('Y1c T5c 契约冻结：mergeRuntimeProjection（shared 唯一 merge 函数——全规则）', () => {
  it('同字段 nodeVersion 大者胜（bigint 数值比较非字典序）；等值保持当前（幂等重放稳定）', () => {
    const current = proj({
      nodes: { n1: entry({ exec: { status: 'running', nodeVersion: '9' } }) },
    });
    const higher = proj({
      nodes: { n1: entry({ exec: { status: 'done', nodeVersion: '10' } }) },
    });
    const lower = proj({
      nodes: { n1: entry({ exec: { status: 'failed', nodeVersion: '8' } }) },
    });
    expect(mergeRuntimeProjection(current, higher).nodes.n1!.exec!.status).toBe('done');
    expect(mergeRuntimeProjection(current, lower).nodes.n1!.exec!.status).toBe('running');
    // 字典序陷阱："9">"10" 字典序为真——数值比较必须走 bigint（10 进制 string 纪律）
    const cur10 = proj({ nodes: { n1: entry({ exec: { status: 'v10', nodeVersion: '10' } }) } });
    const inc9 = proj({ nodes: { n1: entry({ exec: { status: 'v9', nodeVersion: '9' } }) } });
    expect(mergeRuntimeProjection(cur10, inc9).nodes.n1!.exec!.status).toBe('v10');
    // 等值：保持当前（同一事件幂等重放不抖动）
    const same = proj({ nodes: { n1: entry({ exec: { status: 'done', nodeVersion: '10' } }) } });
    const replay = proj({ nodes: { n1: entry({ exec: { status: 'done', nodeVersion: '10' } }) } });
    expect(mergeRuntimeProjection(same, replay).nodes.n1!.exec!.status).toBe('done');
  });
  it('deletedAt 墓碑：版本大于任何字段版本则清空该节点字段；字段版本更高则幸存（undo 重建形态）', () => {
    // 墓碑新于一切字段 → 字段清空（FEED_TOMBSTONE 语义——客户端清投影）
    const withFields = proj({
      nodes: { n1: entry({ exec: { status: 'done', nodeVersion: '5' }, media: { naturalWidth: 1, naturalHeight: 1, factVersion: 1, nodeVersion: '6' } }) },
    });
    const tombstone = proj({ nodes: { n1: entry({ deletedAt: { lifecycleSeq: '1', nodeVersion: '7' } }) } });
    const merged = mergeRuntimeProjection(withFields, tombstone);
    expect(merged.nodes.n1!.exec).toBeUndefined();
    expect(merged.nodes.n1!.media).toBeUndefined();
    expect(merged.nodes.n1!.deletedAt).toEqual({ lifecycleSeq: '1', nodeVersion: '7' });
    // 字段新于墓碑（restore 后新事件）→ 字段幸存
    const resurrect = proj({
      nodes: { n1: entry({ exec: { status: 'running', nodeVersion: '9' } }) },
    });
    const merged2 = mergeRuntimeProjection(merged, resurrect);
    expect(merged2.nodes.n1!.exec!.status).toBe('running');
    expect(merged2.nodes.n1!.deletedAt).toBeDefined();   // 墓碑保留（历史版本）——activeTombstone 判定在 compose
    // 边界：deletedAt 版本==字段版本（非严格大于）→ 字段不清
    const eqFields = proj({ nodes: { n1: entry({ exec: { status: 'done', nodeVersion: '7' } }) } });
    const merged3 = mergeRuntimeProjection(eqFields, tombstone);
    expect(merged3.nodes.n1!.exec).toBeDefined();
  });
  it('generation 不匹配整族清：新代整体替换（旧族不并入）；旧代事件整体忽略（隔离）', () => {
    const g3 = proj({ generation: 3, nodes: { n1: entry({ exec: { status: 'a', nodeVersion: '1' } }) } });
    const g4 = proj({ generation: 4, nodes: { n2: entry({ exec: { status: 'b', nodeVersion: '1' } }) } });
    const toNew = mergeRuntimeProjection(g3, g4);
    expect(toNew.generation).toBe(4);
    expect(toNew.nodes.n1).toBeUndefined();        // 旧族清
    expect(toNew.nodes.n2!.exec!.status).toBe('b');
    const staleIncoming = mergeRuntimeProjection(g4, g3);
    expect(staleIncoming.generation).toBe(4);
    expect(staleIncoming.nodes.n1).toBeUndefined(); // 旧代事件不进新代投影
  });
  it('feedSeq/pgSeq 水位取大（bigint 数值比较）；mediaFacts per-mediaId factVersion 大者胜', () => {
    const current = proj({
      feedSeq: '100', pgSeq: '500',
      mediaFacts: { m1: { naturalWidth: 1, naturalHeight: 1, factVersion: 3, feedSeq: '99' } },
    });
    const incoming = proj({
      feedSeq: '99', pgSeq: '600',
      mediaFacts: { m1: { naturalWidth: 2, naturalHeight: 2, factVersion: 5, feedSeq: '98' } },
    });
    const merged = mergeRuntimeProjection(current, incoming);
    expect(merged.feedSeq).toBe('100');   // 水位不倒退（100>99）
    expect(merged.pgSeq).toBe('600');
    expect(merged.mediaFacts.m1!.factVersion).toBe(5);
    expect(merged.mediaFacts.m1!.naturalWidth).toBe(2);
    const older = proj({
      mediaFacts: { m1: { naturalWidth: 9, naturalHeight: 9, factVersion: 2, feedSeq: '1' } },
    });
    expect(mergeRuntimeProjection(current, older).mediaFacts.m1!.factVersion).toBe(3);
  });
  it('未知节点并集合入（增量事件只带单节点——其余节点保留）', () => {
    const current = proj({ nodes: { n1: entry({ exec: { status: 'a', nodeVersion: '1' } }) } });
    const incoming = proj({ nodes: { n2: entry({ exec: { status: 'b', nodeVersion: '1' } }) } });
    const merged = mergeRuntimeProjection(current, incoming);
    expect(Object.keys(merged.nodes).sort()).toEqual(['n1', 'n2']);
  });
  it('seq() fail-fast：非十进制形态（1e3/空串/负号/0x10）→RUNTIME_PROJECTION_SEQ_INVALID（wire 纪律破坏即刻暴露）', () => {
    const cur = proj({ feedSeq: '10', pgSeq: '100' });
    const curWithNode = proj({ nodes: { n1: entry({ exec: { status: 'cur', nodeVersion: '1' } }) } });
    for (const bad of ['1e3', '', '-1', '0x10']) {
      // 水位面（maxSeq→seq）与节点槽面（mergeSlot→seq）双路径均 fail-fast
      expect(() => mergeRuntimeProjection(cur, proj({ feedSeq: bad })), `feedSeq='${bad}' 必须红`)
        .toThrow(/RUNTIME_PROJECTION_SEQ_INVALID/);
      expect(() => mergeRuntimeProjection(
        curWithNode,
        proj({ nodes: { n1: entry({ exec: { status: 'inc', nodeVersion: bad } }) } }),
      ), `nodeVersion='${bad}' 必须红`).toThrow(/RUNTIME_PROJECTION_SEQ_INVALID/);
    }
  });
});

describe('Y1c T5c 契约冻结：composeRenderModel（read model ⊕ projection——服务端派生字段永不进 doc）', () => {
  const readModel: CanvasReadModel = {
    nodes: [
      { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, data: { prompt: 'p' } },
      { id: 'n2', type: 'textInput', position: { x: 1, y: 1 }, data: { content: 'c' } },
      { id: 'n3', type: 'videoGen', position: { x: 2, y: 2 }, data: {} },
    ],
    edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
  };
  it('exec/media overlay 到 read model 节点（by nodeId）；无投影节点零 runtime 键透传', () => {
    const projection = proj({
      nodes: {
        n1: entry({
          exec: { status: 'done', artifactRev: 1, nodeVersion: '5' },
          media: { naturalWidth: 640, naturalHeight: 480, factVersion: 1, nodeVersion: '4' },
        }),
      },
    });
    const rm = composeRenderModel(readModel, projection);
    expect(rm.nodes.length).toBe(3);
    expect(rm.nodes.find((n) => n.id === 'n1')!.runtime).toEqual({
      exec: { status: 'done', artifactRev: 1, nodeVersion: '5' },
      media: { naturalWidth: 640, naturalHeight: 480, factVersion: 1, nodeVersion: '4' },
    });
    expect(rm.nodes.find((n) => n.id === 'n2')!.runtime).toBeUndefined();
    expect(rm.nodes.find((n) => n.id === 'n2')!.data).toEqual({ content: 'c' });   // 读模型原样
    expect(rm.edges).toEqual([{ id: 'e1', source: 'n1', target: 'n2' }]);
  });
  it('active 墓碑节点从渲染面剔除（deletedAt 版本大于全部字段版本）；旧墓碑+新字段=复活形态保留', () => {
    const projection = proj({
      nodes: {
        n3: entry({ deletedAt: { lifecycleSeq: '2', nodeVersion: '9' } }),                     // active：剔除
        n1: entry({ deletedAt: { lifecycleSeq: '1', nodeVersion: '2' }, exec: { status: 'running', nodeVersion: '8' } }),  // 复活：保留
      },
    });
    const rm = composeRenderModel(readModel, projection);
    expect(rm.nodes.map((n) => n.id).sort()).toEqual(['n1', 'n2']);
    expect(rm.nodes.find((n) => n.id === 'n1')!.runtime!.exec!.status).toBe('running');
  });
});

describe('Y1c T5c 契约冻结：四读径契约（doc 无服务端字段后的完整读者面）', () => {
  it('①公开快照：发布时服务端 PG projection join+缓存键加 projectionSeq（(pid,g,snapshotRev) 会拼「旧文档+新图片」）', () => {
    const key = formatPublicSnapshotCacheKey({ projectId: 'p1', generation: 3, snapshotRev: 7, projectionSeq: '128' });
    expect(key).toBe('public-snapshot:p1:g3:r7:p128');
    expect(key).toContain('p128');   // projectionSeq 进键——旧投影缓存失配
    expect(FOUR_READ_PATHS.publicSnapshot).toContain('toPublicReadModel');
    expect(FOUR_READ_PATHS.publicSnapshot).toContain('projection join');
    expect(FOUR_READ_PATHS.publicSnapshot).toContain('projectionSeq');
  });
  it('②用户导出=render model（serializeCanvas 仅 doc 备份不作用户导出）', () => {
    expect(FOUR_READ_PATHS.userExport).toContain('render model');
    expect(FOUR_READ_PATHS.userExport).toContain('serializeCanvas');
    expect(FOUR_READ_PATHS.userExport).toContain('不作用户导出');
  });
  it('③复制/粘贴=typed BindMedia/CloneBinding 命令：源 nodeId/mediaId 作命令参数（非 doc 字段）', () => {
    const bind: BindMediaCommand = { type: 'BindMedia', sourceNodeId: 'n1', mediaId: 'm1', targetNodeId: 'n9' };
    const clone: CloneBindingCommand = { type: 'CloneBinding', sourceNodeId: 'n1', targetNodeId: 'n9' };
    expect(bind.type).toBe('BindMedia');
    expect(Object.keys(bind).sort()).toEqual(['mediaId', 'sourceNodeId', 'targetNodeId', 'type']);
    expect(Object.keys(clone).sort()).toEqual(['sourceNodeId', 'targetNodeId', 'type']);
    expect(COPY_PASTE_COMMAND_CONTRACT.paramsNotDocFields).toContain('命令参数');
    expect(COPY_PASTE_COMMAND_CONTRACT.clearedIds).toContain('mediaId');
    expect(COPY_PASTE_COMMAND_CONTRACT.clearedIds).toContain('fileId');
    expect(COPY_PASTE_COMMAND_CONTRACT.clearedIds).toContain('artifactId');
    expect(COPY_PASTE_COMMAND_CONTRACT.cells).toContain('格位保留');
    expect(COPY_PASTE_COMMAND_CONTRACT.cells).toContain('媒体引用清空');
    expect(COPY_PASTE_COMMAND_CONTRACT.crossTeam).toContain('media ACL');
  });
  it('④video-work clone=服务端用 render model 复制（不读 doc 猜 fileId）', () => {
    expect(FOUR_READ_PATHS.videoWorkClone).toContain('render model');
    expect(FOUR_READ_PATHS.videoWorkClone).toContain('不读 doc 猜 fileId');
  });
});

describe('Y1c T5c 契约冻结：Runtime Store 离线语义（IDB TTL 7 天+stale 角标+unknown 不显示 idle）', () => {
  it('TTL=7 天（派生 ms=604_800_000）；过期=unknown（弃用投影）', () => {
    expect(RUNTIME_STORE_TTL_DAYS).toBe(7);
    expect(RUNTIME_STORE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
  it('freshness 三态：无投影=unknown（从不显示 idle）；过期=unknown；离线有投影=stale；在线未过期=fresh', () => {
    const now = 1_000_000_000_000;
    const freshInput = { projection: { fetchedAtMs: now - 1000 }, feedReachable: true, nowMs: now };
    expect(resolveRuntimeStoreFreshness(freshInput)).toBe<RuntimeStoreFreshness>('fresh');
    expect(resolveRuntimeStoreFreshness({ ...freshInput, feedReachable: false })).toBe('stale');
    expect(resolveRuntimeStoreFreshness({ projection: null, feedReachable: true, nowMs: now })).toBe('unknown');
    const expired = { projection: { fetchedAtMs: now - RUNTIME_STORE_TTL_MS - 1 }, feedReachable: false, nowMs: now };
    expect(resolveRuntimeStoreFreshness(expired)).toBe('unknown');   // TTL 过期优先于 stale——弃用
    const atBoundary = { projection: { fetchedAtMs: now - RUNTIME_STORE_TTL_MS }, feedReachable: false, nowMs: now };
    expect(resolveRuntimeStoreFreshness(atBoundary)).toBe('stale');  // 边界：恰 TTL=未过期
  });
  it('stale 角标文案：上次已知（截至 HH:mm）——零填充', () => {
    const label = formatRuntimeStaleLabel(new Date(2026, 9, 24, 9, 5, 0).getTime());
    expect(label).toBe('上次已知（截至 09:05）');
  });
  it('UI 契约注记：unknown≠idle/执行按钮禁用 fail-closed/服务端派生字段永不进 doc/换代清整族', () => {
    expect(UNKNOWN_NOT_IDLE).toContain('unknown');
    expect(UNKNOWN_NOT_IDLE).toContain('idle');
    expect(RUNTIME_STORE_UI_CONTRACT.execButton).toContain('禁用');
    expect(RUNTIME_STORE_UI_CONTRACT.execButton).toContain('fail-closed');
    expect(RUNTIME_STORE_UI_CONTRACT.serverFieldsNeverInDoc).toContain('永不进 doc');
    expect(RUNTIME_STORE_UI_CONTRACT.generationClearsFamily).toContain('清整族');
    expect(RUNTIME_STORE_UI_CONTRACT.idbPayload).toContain('projectId');
    expect(RUNTIME_STORE_UI_CONTRACT.idbPayload).toContain('fetchedAt');
  });
});
