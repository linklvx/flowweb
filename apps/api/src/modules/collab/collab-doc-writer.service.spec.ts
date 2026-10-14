// apps/api/src/modules/collab/collab-doc-writer.service.spec.ts
// Y0c T8（片 A1 行为契约——spec :502 目标形态①）：writeBatch 先红用例②③④（红证据贴 commit body）：
// ②Z75 合法终态（deliver 失败但 done 同批写入⇒exec=done∧节点已删=被接受，禁跨 op 补丁）
// ③「data 与 exec 同事务」（同批两写落同一 withDoc 事务——事务单次性）
// ④Z108 内容校验三拒（__proto__ 键/超批字节 Σ/超 op 数＝业务级拒绝进结果+reject 计数，不 throw 不回滚同批合法 op）
// 附：Z40 基础设施失败二分（withDoc 503 ⇒ 全批 thrown）+Z76 幂等重放收敛（writeBatch 层可测形态）。
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { ServiceUnavailableException } from '@nestjs/common';
import { CollabDocWriterService } from './collab-doc-writer.service';
import { collabWriteRejectedTotal } from './store.metrics';
import { MAX_WRITE_OPS_PER_BATCH, MAX_WRITE_BATCH_BYTES, type DocWriteOp } from '@flowweb/shared';

const rejectedOf = async (reason: string): Promise<number> => {
  const v = await collabWriteRejectedTotal.get();
  return v.values.find((x) => x.labels.reason === reason)?.value ?? 0;
};

/** 真事务装置：withDoc stub 直跑 fn(doc)（collab-document.service.spec 同手法）——事务单次性可断言。 */
function makeWriter(doc: Y.Doc) {
  const withDoc = vi.fn(async (_pid: string, fn: (d: Y.Doc) => unknown) => fn(doc));
  const writer = new CollabDocWriterService({ withDoc } as any);
  return { writer, withDoc, doc };
}

describe('Y0c T8 writeBatch（片 A1 行为契约）', () => {
  it('红③「data 与 exec 同事务」：writeNodeData+writeExecStatus 同批 ⇒ withDoc 恰一次且两写都在其内（结果一一对应）', async () => {
    const doc = new Y.Doc();
    const n1 = new Y.Map();
    n1.set('type', 'imageGen');
    doc.getMap('nodes').set('n1', n1);
    const { writer, withDoc } = makeWriter(doc);

    const results = await writer.writeBatch('p1', [
      { op: 'writeNodeData', nodeId: 'n1', patch: { resultUrl: 'http://x/1.png' } },
      { op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'done', attempts: 1 } },
    ]);

    expect(withDoc).toHaveBeenCalledTimes(1); // 同 doc 同事务——一次 writeBatch=单次 withDoc（原两写=两次直连）
    expect(results).toEqual([
      { index: 0, op: 'writeNodeData', written: true },
      { index: 1, op: 'writeExecStatus', written: true },
    ]);
    expect((n1.get('data') as Y.Map<any>).get('resultUrl')).toBe('http://x/1.png');           // data 写在事务内
    expect((doc.getMap('exec').get('n1') as Y.Map<any>).get('status')).toBe('done');          // exec 写在同一事务内
  });

  it('红② Z75 合法终态：deliver 失败（节点已删）但 done 同批写入 ⇒ exec=done∧节点已删=被接受（禁跨 op 补丁）+守卫 reason 进 reject 计数', async () => {
    const doc = new Y.Doc(); // gone 不存在=节点已删域（writeNodeData 现状守卫语义）
    const { writer } = makeWriter(doc);
    const before = await rejectedOf('node-deleted');

    const results = await writer.writeBatch('p1', [
      { op: 'writeNodeData', nodeId: 'gone', patch: { resultUrl: 'http://x/gone.png' } },
      { op: 'writeExecStatus', nodeId: 'gone', patch: { status: 'done', attempts: 2 } },
    ]);

    expect(results[0]).toMatchObject({ index: 0, op: 'writeNodeData', written: false, reason: 'node-deleted' });
    expect(results[1]).toMatchObject({ index: 1, op: 'writeExecStatus', written: true }); // done 照常落地（无跨 op 存在性检查）
    expect(doc.getMap('nodes').get('gone')).toBeUndefined();                              // 节点已删
    expect((doc.getMap('exec').get('gone') as Y.Map<any>).get('status')).toBe('done');         // exec=done 合法终态（E22 读侧兜底）
    expect(await rejectedOf('node-deleted')).toBe(before + 1);                            // 守卫 reason 进 reject 计数
  });

  it('红④ Z108 三拒＝业务级拒绝进结果+reject 计数：__proto__ 键拒（同批合法 op 照常执行）/超批字节 Σ 整批拒/超 op 数整批拒——不 throw 不回滚', async () => {
    const doc = new Y.Doc();
    const n1 = new Y.Map();
    n1.set('type', 'imageGen');
    doc.getMap('nodes').set('n1', n1);
    const { writer, withDoc } = makeWriter(doc);

    // (a) __proto__ 键：违规 op 拒，同批合法 op 照常执行（拒绝非截断非 sanitize；批不回滚）
    const beforeProto = await rejectedOf('PROTO_KEY_BANNED');
    const protoPatch = JSON.parse('{"__proto__":"polluted"}') as Record<string, unknown>;
    const r1 = await writer.writeBatch('p1', [
      { op: 'writeNodeData', nodeId: 'n1', patch: { resultUrl: 'http://ok/1.png' } },
      { op: 'writeNodeData', nodeId: 'n1', patch: protoPatch },
    ]);
    expect(r1[0]).toMatchObject({ index: 0, op: 'writeNodeData', written: true });
    expect(r1[1]).toMatchObject({ index: 1, op: 'writeNodeData', written: false, reason: 'PROTO_KEY_BANNED' });
    expect((n1.get('data') as Y.Map<any>).get('resultUrl')).toBe('http://ok/1.png'); // 合法 op 已生效（不回滚）
    expect(await rejectedOf('PROTO_KEY_BANNED')).toBe(beforeProto + 1);

    // (b) 超批字节 Σ：批级违规（index=-1）——整批拒绝零执行（不进事务）。计数=逐违规全量
    //（超限大值同时命中每键上限与批 Σ 两违规——同码两计，均 PATCH_TOO_LARGE）
    const beforeBig = await rejectedOf('PATCH_TOO_LARGE');
    const big = 'x'.repeat(MAX_WRITE_BATCH_BYTES);
    const r2 = await writer.writeBatch('p1', [
      { op: 'writeNodeData', nodeId: 'n1', patch: { resultUrl: 'http://ok/2.png' } },
      { op: 'writeNodeData', nodeId: 'n1', patch: { result: big } },
    ]);
    expect(r2).toHaveLength(2);
    expect(r2.every((r) => !r.written && r.reason === 'PATCH_TOO_LARGE')).toBe(true);
    expect((n1.get('data') as Y.Map<any>).get('resultUrl')).toBe('http://ok/1.png'); // 整批拒——同批 op 未落 doc
    expect(await rejectedOf('PATCH_TOO_LARGE')).toBe(beforeBig + 2);

    // (c) 超 op 数：OP_COUNT_EXCEEDED——整批拒（结果仍一一对应）
    const beforeCount = await rejectedOf('OP_COUNT_EXCEEDED');
    const many: DocWriteOp[] = Array.from({ length: MAX_WRITE_OPS_PER_BATCH + 1 }, () => ({ op: 'deleteExecOrphans' }));
    const r3 = await writer.writeBatch('p1', many);
    expect(r3).toHaveLength(MAX_WRITE_OPS_PER_BATCH + 1);
    expect(r3.every((r, i) => !r.written && r.reason === 'OP_COUNT_EXCEEDED' && r.index === i)).toBe(true);
    expect(await rejectedOf('OP_COUNT_EXCEEDED')).toBe(beforeCount + 1);

    expect(withDoc).toHaveBeenCalledTimes(1); // 仅 (a) 进事务——批级拒两例零 withDoc
  });

  it('Z40 基础设施失败二分：withDoc 503（租约失守）⇒ 全批 thrown（非 written:false——调用方按零交付退款）', async () => {
    const writer = new CollabDocWriterService({
      withDoc: vi.fn(async () => { throw new ServiceUnavailableException('collab not serving (lease not held)'); }),
    } as any);
    await expect(writer.writeBatch('p1', [
      { op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'done', attempts: 1 } },
    ])).rejects.toThrow(ServiceUnavailableException);
  });

  it('Z76 幂等重放收敛（writeBatch 层可测形态）：同批重发两次 ⇒ data 键级 set 同值收敛；已生效的 done 投影被代次守卫识别为已写入（terminal-superseded）非重复 append', async () => {
    const doc = new Y.Doc();
    const n1 = new Y.Map();
    n1.set('type', 'text');
    doc.getMap('nodes').set('n1', n1);
    const { writer } = makeWriter(doc);
    const ops: DocWriteOp[] = [
      { op: 'writeNodeData', nodeId: 'n1', patch: { content: '同一产物' } },
      { op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'done', attempts: 1, intentId: 'i-1' } },
    ];

    const first = await writer.writeBatch('p1', ops);
    const second = await writer.writeBatch('p1', ops); // 调用方盲目重放——写入已生效须可识别（非重发 append）

    expect(first.every((r) => r.written)).toBe(true);
    expect(second[0]).toMatchObject({ index: 0, op: 'writeNodeData', written: true });   // 幂等 op 键级 set 同值收敛
    expect(second[1]).toMatchObject({ index: 1, op: 'writeExecStatus', written: false, reason: 'terminal-superseded' }); // 已生效=守卫吸收
    const data = n1.get('data') as Y.Map<any>;
    expect(data.get('content')).toBe('同一产物');                                        // 状态语义等价（重放不破坏）
    expect((doc.getMap('exec').get('n1') as Y.Map<any>).get('status')).toBe('done');
    expect(Array.from(data.keys())).toEqual(['content']);                               // 无重复键无垃圾态
  });
});
