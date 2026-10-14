// apps/api/src/modules/collab/collab-doc-writer.service.spec.ts
// Y0c T8（片 A1 行为契约——spec :502 目标形态①）：writeBatch 先红用例②③④（红证据贴 commit body）：
// ②Z75 合法终态（Y0c T11 演进·spec §0.6 偏离 19：deliver 失败∧done 同批被 Z4 守卫拦⇒无孤儿条目
//   ——E22 读侧两形态等价〔exec 无 node 与无 exec 条目同 render 不存在〕；Z75 实质禁则全保留：
//   deliver 失败不回滚整批/禁跨 op 耦合/批接受）
// ③「data 与 exec 同事务」（同批两写落同一 withDoc 事务——事务单次性）
// ④Z108 内容校验三拒（__proto__ 键/超批字节 Σ/超 op 数＝业务级拒绝进结果+reject 计数，不 throw 不回滚同批合法 op）
// 附：Z40 基础设施失败二分（withDoc 503 ⇒ 全批 thrown）+Z76 幂等重放收敛（writeBatch 层可测形态）。
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { ServiceUnavailableException } from '@nestjs/common';
import { CollabDocWriterService, transactSync } from './collab-doc-writer.service';
import { CollabDocumentService } from './collab-document.service';
import { toDocLike } from './doc-like.util';
import { collabWriteRejectedTotal } from './store.metrics';
import { execOrphanBlockedTotal } from '../execution/exec.metrics';
import { MAX_WRITE_OPS_PER_BATCH, MAX_WRITE_BATCH_BYTES, stampDocSchema, type DocWriteOp } from '@flowweb/shared';

const rejectedOf = async (reason: string): Promise<number> => {
  const v = await collabWriteRejectedTotal.get();
  return v.values.find((x) => x.labels.reason === reason)?.value ?? 0;
};

const orphanBlockedOf = async (): Promise<number> => {
  const v = await execOrphanBlockedTotal.get();
  return v.values.reduce((s, x) => s + x.value, 0);
};

const rejectedTotalSum = async (): Promise<number> => {
  const v = await collabWriteRejectedTotal.get();
  return v.values.reduce((s, x) => s + x.value, 0);
};

/** 夹具节点种子：手建节点后盖 v2 戳（生产 doc 恒有戳——WS loadDocument 无戳自愈/api 种子显式盖章；
 *  T9 起 writeBatch 进门 ensureSchemaVersion，无戳∧有节点=拒载档，夹具对齐生产形态）。 */
function seedNode(doc: Y.Doc, id = 'n1'): Y.Map<any> {
  const n = new Y.Map();
  n.set('type', 'text');
  doc.getMap('nodes').set(id, n);
  stampDocSchema(toDocLike(doc));
  return n;
}

/** 真事务装置：withDoc stub 直跑 fn(doc)（collab-document.service.spec 同手法）——事务单次性可断言。
 *  T9 起 writeBatch 进门消费 doc.assertWriteAdmitted（X9 批面受理门单点）——stub 同形补齐。 */
function makeWriter(doc: Y.Doc) {
  const withDoc = vi.fn(async (_pid: string, fn: (d: Y.Doc) => unknown) => fn(doc));
  const writer = new CollabDocWriterService({ withDoc, assertWriteAdmitted: vi.fn() } as any);
  return { writer, withDoc, doc };
}

/** 真实 CollabDocumentService+stub gateway 装置：受理门跑真判据（stub 只有 mock 无真门）。 */
function makeWriterWithRealDoc(gateway: { isLeaseServing: () => boolean; isWritableOrDegraded: () => 'ok' | 'spool-unwritable' }) {
  const docService = new CollabDocumentService(gateway as any, { readSnapshotOnly: vi.fn() } as any);
  return new CollabDocWriterService(docService);
}

describe('Y0c T8 writeBatch（片 A1 行为契约）', () => {
  it('红③「data 与 exec 同事务」：writeNodeData+writeExecStatus 同批 ⇒ withDoc 恰一次且两写都在其内（结果一一对应）', async () => {
    const doc = new Y.Doc();
    const n1 = seedNode(doc);
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

  it('红② Z75 合法终态（Y0c T11 演进·偏离 19）：deliver 失败（node-deleted）∧done 同批被 Z4 守卫拦 ⇒ 无孤儿条目+E22 读侧等价（禁跨 op 耦合：批不 throw 不回滚）', async () => {
    const doc = new Y.Doc(); // gone 不存在=节点已删域（Z4 守卫双面生效：writeNodeData 与 writeExecStatus 同拦）
    const { writer } = makeWriter(doc);
    const before = await rejectedOf('node-deleted');
    const orphanBefore = await orphanBlockedOf();

    const results = await writer.writeBatch('p1', [
      { op: 'writeNodeData', nodeId: 'gone', patch: { resultUrl: 'http://x/gone.png' } },
      { op: 'writeExecStatus', nodeId: 'gone', patch: { status: 'done', attempts: 2 } },
    ]);

    expect(results[0]).toMatchObject({ index: 0, op: 'writeNodeData', written: false, reason: 'node-deleted' });
    expect(results[1]).toMatchObject({ index: 1, op: 'writeExecStatus', written: false, reason: 'node-deleted' }); // 演进点：done 被守卫拦（原 written:true 落孤儿条目）
    expect(doc.getMap('nodes').get('gone')).toBeUndefined();        // 节点已删
    expect(doc.getMap('exec').get('gone')).toBeUndefined();         // 无孤儿条目——E22 读侧两形态等价：exec 无 node 与无 exec 条目同 render 不存在（偏离 19）
    expect(await rejectedOf('node-deleted')).toBe(before + 2);      // 两 op 各一（守卫 reason 进 reject 计数）
    expect(await orphanBlockedOf()).toBe(orphanBefore + 1);         // 批面 Z4 计数：仅 exec op（writeNodeData 守卫属 Z44 交付判据域）
  });

  it('红④ Z108 三拒＝业务级拒绝进结果+reject 计数：__proto__ 键拒（同批合法 op 照常执行）/超批字节 Σ 整批拒/超 op 数整批拒——不 throw 不回滚', async () => {
    const doc = new Y.Doc();
    const n1 = seedNode(doc);
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
      assertWriteAdmitted: vi.fn(),
    } as any);
    await expect(writer.writeBatch('p1', [
      { op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'done', attempts: 1 } },
    ])).rejects.toThrow(ServiceUnavailableException);
  });

  it('Z76 幂等重放收敛（writeBatch 层可测形态）：同批重发两次 ⇒ data 键级 set 同值收敛；已生效的 done 投影被代次守卫识别为已写入（terminal-superseded）非重复 append', async () => {
    const doc = new Y.Doc();
    const n1 = seedNode(doc);
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

// ── Y0c T9：进门四段顺序（空批早退→①X9 受理门→②undefined fail-fast→③Z108 内容校验→④withDoc
// 事务〔首段 schema 门〕）+deleteNodeDataKeys+transactSync 类型门。 ──
describe('Y0c T9 进门门+undefined 语义+schema 门+transactSync+deleteNodeDataKeys', () => {
  it('红·受理门（X9 批面单点）：degraded gateway ⇒ writeBatch 抛 ServiceUnavailableException（全批 thrown——Z40 基础设施档零交付退款）', async () => {
    const writer = makeWriterWithRealDoc({ isLeaseServing: () => false, isWritableOrDegraded: () => 'ok' });
    await expect(writer.writeBatch('p1', [
      { op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'done', attempts: 1 } },
    ])).rejects.toThrow(ServiceUnavailableException);

    const writer2 = makeWriterWithRealDoc({ isLeaseServing: () => true, isWritableOrDegraded: () => 'spool-unwritable' });
    await expect(writer2.writeBatch('p1', [
      { op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'done', attempts: 1 } },
    ])).rejects.toThrow(ServiceUnavailableException);
  });

  it('红·受理门先于 Z108（进门排序）：degraded + 含违规 op 批 ⇒ 抛受理门错误∧collabWriteRejectedTotal 零增（降级期不白跑校验不污染计数）', async () => {
    const writer = makeWriterWithRealDoc({ isLeaseServing: () => false, isWritableOrDegraded: () => 'spool-unwritable' });
    const before = await rejectedTotalSum();
    await expect(writer.writeBatch('p1', [
      { op: 'writeNodeData', nodeId: 'n1', patch: JSON.parse('{"__proto__":"x"}') }, // Z108 违规 op 同批
      { op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'done', attempts: 1 } },
    ])).rejects.toThrow(ServiceUnavailableException);   // 受理门错误非业务结果
    expect(await rejectedTotalSum()).toBe(before);      // 校验未跑——计数零污染
  });

  it('红·undefined fail-fast（Z5·批面）：writeNodeData patch 含 undefined ⇒ throw /UNDEFINED_PATCH_VALUE/（非 VALUE_TYPE_MISMATCH written:false）', async () => {
    const doc = new Y.Doc();
    const n1 = seedNode(doc);
    const { writer } = makeWriter(doc);
    await expect(writer.writeBatch('p1', [
      { op: 'writeNodeData', nodeId: 'n1', patch: { resultUrl: undefined } },
    ])).rejects.toThrow(/UNDEFINED_PATCH_VALUE/);
    expect(n1.get('data')).toBeUndefined();             // fail-fast 在应用前——零写入
  });

  it('红·undefined skip（Z5·exec 档）：writeBatch writeExecStatus patch 含 undefined 值 ⇒ written:true ∧ 该键不在 exec map（救活 :261 跳过语义）', async () => {
    const doc = new Y.Doc();
    seedNode(doc);
    const { writer } = makeWriter(doc);
    const results = await writer.writeBatch('p1', [
      { op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'done', attempts: 1, reason: undefined } },
    ]);
    expect(results[0]).toMatchObject({ index: 0, op: 'writeExecStatus', written: true });
    const exec = doc.getMap('exec').get('n1') as Y.Map<any>;
    expect(exec.get('status')).toBe('done');
    expect(exec.has('reason')).toBe(false);             // undefined 键跳过非写入
  });

  it('红·schema 门双拒码：sv=1 doc ⇒ throw /\\[O0b-0\\]/（ensureSchemaVersion 档——判别性令牌：DOC_SCHEMA_AHEAD 消息不含此串，门判据若回归 sv!==CUR 本用例必红）；sv=3 doc ⇒ throw /DOC_SCHEMA_AHEAD/ + reject 计数（事务回调首段——零 op 已应用）', async () => {
    const v1 = new Y.Doc();
    v1.getMap('meta').set('schemaVersion', 1);
    const w1 = makeWriter(v1);
    const aheadBefore = await rejectedOf('DOC_SCHEMA_AHEAD'); // 双保险：降版档不得误路由前瞻分支
    await expect(w1.writer.writeBatch('p1', [
      { op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'done', attempts: 1 } },
    ])).rejects.toThrow(/\[O0b-0\]/);
    expect(await rejectedOf('DOC_SCHEMA_AHEAD')).toBe(aheadBefore); // 降版不污染 schema-ahead 计数（告警不被降版噪声触发）
    expect(v1.getMap('exec').size).toBe(0);             // 零 op 已应用

    const v3 = new Y.Doc();
    v3.getMap('meta').set('schemaVersion', 3);
    const w3 = makeWriter(v3);
    const before = await rejectedOf('DOC_SCHEMA_AHEAD');
    await expect(w3.writer.writeBatch('p3', [
      { op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'done', attempts: 1 } },
    ])).rejects.toThrow(/DOC_SCHEMA_AHEAD/);
    expect(await rejectedOf('DOC_SCHEMA_AHEAD')).toBe(before + 1);   // throw 前计数（spec §6 拒写+reason 计数）
    expect(v3.getMap('exec').size).toBe(0);
  });

  it('红·transactSync 类型门：返回 Promise 的回调 ⇒ throw（withDoc 会把异步回调捕获到事务外续跑——破坏同事务不变量）', () => {
    const asyncFn = ((doc: Y.Doc) => { doc.getMap('meta'); return Promise.resolve(); }) as unknown as (d: Y.Doc) => void;
    expect(() => transactSync(asyncFn)(new Y.Doc())).toThrow(/Promise/);
    // 同步回调照常放行
    expect(() => transactSync((doc) => { doc.getMap('meta').set('k', 'v'); })(new Y.Doc())).not.toThrow();
  });

  it('红·deleteNodeDataKeys：同批写后逐键删+不存在键 no-op+节点缺失 written:false node-deleted+空数组合法 no-op', async () => {
    const doc = new Y.Doc();
    const n1 = seedNode(doc);
    const { writer } = makeWriter(doc);

    // (a) 同批写后删——同事务内显式删键（客户端 undefined⇒delete 语义的服务端对应物）。
    // 删键名单与写域同集（Z108 既有语义——白名单外陌生键 UNKNOWN_KEY 拒），
    // 「不存在键 no-op」用白名单内但 doc 无此键的 fileId。
    const r1 = await writer.writeBatch('p1', [
      { op: 'writeNodeData', nodeId: 'n1', patch: { resultUrl: 'http://x/1.png', errorCode: 'E1' } },
      { op: 'deleteNodeDataKeys', nodeId: 'n1', keys: ['resultUrl', 'fileId'] },
    ]);
    expect(r1[0]).toMatchObject({ index: 0, op: 'writeNodeData', written: true });
    expect(r1[1]).toMatchObject({ index: 1, op: 'deleteNodeDataKeys', written: true });
    const data = n1.get('data') as Y.Map<any>;
    expect(data.has('resultUrl')).toBe(false);          // 已删
    expect(data.get('errorCode')).toBe('E1');           // 同批他键保留
    expect(data.has('fileId')).toBe(false);             // 不存在键 delete no-op 不抛

    // (b) 节点缺失 ⇒ written:false + reason:'node-deleted'（Z44 对齐）
    const before = await rejectedOf('node-deleted');
    const r2 = await writer.writeBatch('p1', [
      { op: 'deleteNodeDataKeys', nodeId: 'gone', keys: ['resultUrl'] },
    ]);
    expect(r2[0]).toMatchObject({ index: 0, op: 'deleteNodeDataKeys', written: false, reason: 'node-deleted' });
    expect(await rejectedOf('node-deleted')).toBe(before + 1);

    // (c) 空数组 ⇒ written:true 合法 no-op（spec §6 ②）
    const r3 = await writer.writeBatch('p1', [
      { op: 'deleteNodeDataKeys', nodeId: 'n1', keys: [] },
    ]);
    expect(r3[0]).toMatchObject({ index: 0, op: 'deleteNodeDataKeys', written: true });
    expect(Array.from((n1.get('data') as Y.Map<any>).keys())).toEqual(['errorCode']);
  });
});
