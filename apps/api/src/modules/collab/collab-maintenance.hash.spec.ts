// apps/api/src/modules/collab/collab-maintenance.hash.spec.ts
// Y4a T2-fix（round 1 评审 Important #1——brief 第 12 行「canonical 重建删掉时间轴后校验仍过
// 的清盘形态由负控测试钉死」）：EXPORTING/VERIFYING 记录 hash 面 timelines 摘要回归锁。
//
// 负控语义（spec §0 条 7「哈希和真空等价比较包含 timelines」+§3.2 maintenance 行）：两份
// hydration 记录 nodes/edges 逐位相同、仅 timelines stableStringify 分歧 ⇒ hash 面必不同——
// 若 recordsOfHydration 的 timelines 字段（collab-maintenance.service.ts:404）被静默移除或
// canonical 重建（rebuildDocFaithful 委托链）丢整棵时间轴，两记录全等 ⇒ 本测试红。
// 红方向验证法（负控可逆破坏）：临时删 recordsOfHydration 返回值的 timelines 字段 → 本测试
// 红（hash 面对时间轴不敏感=清盘形态漏检）；恢复 → 绿。验证过程记入 task-2-report.md。
//
// 装置：直构 service（collab-quota-gate.spec buildVacuumSvc 先例——prisma/repo 置零 mock：
// 本面零 DB 依赖，仅消费 hydrate 行重放）；recordsOfHydration=TS private——经类型化窄面访问
// （collab-shrink.spec:836 getMockImplementation 同款 as-unknown 先例；零行为反射）。
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { CollabMaintenanceService } from './collab-maintenance.service';
import type { HydrationRow } from './canvas-doc-update.repository';

/** hydrate 行（state=单帧全量——updates 空数组；行值零 DB 触达）。 */
function rowOf(doc: Y.Doc): HydrationRow {
  return { state: Buffer.from(Y.encodeStateAsUpdate(doc)), updates: [], stateSeq: 0n, generation: 0, schemaVersion: 5 };
}

/** timelines 工程子树（spec §3.1 形态——entry{version,fps,clips}）。 */
function timelinesEntry(mediaId: string): Y.Map<unknown> {
  const entry = new Y.Map<unknown>();
  entry.set('version', 1);
  entry.set('fps', 30);
  const clips = new Y.Map<unknown>();
  clips.set('c1', new Y.Map<unknown>([['type', 'video'], ['mediaId', mediaId], ['span', { trackId: 'n1:video', start: 0, duration: 5 }]]));
  entry.set('clips', clips);
  return entry;
}

describe('Y4a T2-fix：maintenance 记录 hash 面 timelines 摘要负控（EXPORTING/VERIFYING——防时间轴静默出 hash）', () => {
  const svc = new CollabMaintenanceService({} as never, {} as never, null, null, null);
  // TS private 类型化窄面（零反射——直构 service 上的纯函数调用）
  const recordsOfHydration = (h: HydrationRow) =>
    (svc as unknown as { recordsOfHydration: (hydrate: HydrationRow) => { nodes: unknown[]; edges: unknown[]; timelines: string } }).recordsOfHydration(h);

  it('仅 timelines 分歧的两份 hydration ⇒ records 不全等+hash 不等（timelines 字段被删/重建丢时间轴 ⇒ 本测试红）', () => {
    // 两 doc：nodes/edges 逐位同、timelines 唯一 mediaId 分歧
    const a = new Y.Doc();
    a.getMap('nodes').set('n1', new Y.Map([['type', 'textInput'], ['data', new Y.Map([['model', 'm']])]]));
    a.getMap('timelines').set('n1', timelinesEntry('media-a'));
    const b = new Y.Doc();
    b.getMap('nodes').set('n1', new Y.Map([['type', 'textInput'], ['data', new Y.Map([['model', 'm']])]]));
    b.getMap('timelines').set('n1', timelinesEntry('media-b'));

    const ra = recordsOfHydration(rowOf(a));
    const rb = recordsOfHydration(rowOf(b));

    // ①公开读模型面恒等（toReadModel 结构性不含 timelines——公开零泄漏锁同源）
    expect(ra.nodes).toEqual(rb.nodes);
    expect(ra.edges).toEqual(rb.edges);
    // ②timelines 摘要面分歧（stableStringify 单源——键序稳定）
    expect(ra.timelines).not.toBe(rb.timelines);
    // ③EXPORTING/VERIFYING hash 判据面（:375/:473 同口径 createHash(JSON.stringify(records))）
    //   分歧必达 hash——recordsOfHydration timelines 字段被静默移除 ⇒ records 全等 ⇒ 断言红。
    const hashOf = (r: { nodes: unknown[]; edges: unknown[]; timelines: string }) =>
      createHash('sha256').update(JSON.stringify(r)).digest('hex');
    expect(JSON.stringify(ra)).not.toBe(JSON.stringify(rb));   // 序列化面先决
    expect(hashOf(ra)).not.toBe(hashOf(rb));   // 清盘形态负控：hash 面对时间轴敏感（丢 timelines=红）
    // ④timelines 摘要真值锚（字段存在且=stableStringify(根 entries)——防字段被空串化假绿）
    expect(ra.timelines).toContain('media-a');
    expect(rb.timelines).toContain('media-b');
  });

  it('两侧 timelines 同 ⇒ records 全等+hash 等（正控——摘要面无假阳性：无时间轴漂移的换代校验仍过）', () => {
    const a = new Y.Doc();
    a.getMap('nodes').set('n1', new Y.Map([['type', 'textInput']]));
    a.getMap('timelines').set('n1', timelinesEntry('media-same'));
    const b = new Y.Doc();
    b.getMap('nodes').set('n1', new Y.Map([['type', 'textInput']]));
    b.getMap('timelines').set('n1', timelinesEntry('media-same'));

    const ra = recordsOfHydration(rowOf(a));
    const rb = recordsOfHydration(rowOf(b));
    expect(JSON.stringify(ra)).toBe(JSON.stringify(rb));   // canonical 重建保 timelines ⇒ VERIFYING 恒过
    const hashOf = (r: { nodes: unknown[]; edges: unknown[]; timelines: string }) =>
      createHash('sha256').update(JSON.stringify(r)).digest('hex');
    expect(hashOf(ra)).toBe(hashOf(rb));
  });
});
