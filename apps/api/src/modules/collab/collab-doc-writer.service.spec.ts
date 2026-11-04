// apps/api/src/modules/collab/collab-doc-writer.service.spec.ts
// Y0c T8（片 A1 行为契约）→Y1c T32：writeBatch DI 门面（write-batch 端点/孤儿清扫/worker 令牌
// 三消费面）随 doc.exec 读写链退役删除——本 spec 收窄为 doc 域应用核心 applyWriteOpsToDoc
// （shrink 影子预演/活写、export-fresh 种子副本=剩余维护消费面）+transactSync 类型门+四 op
// 词汇执法（Z108 拒绝码进结果/PROTO_KEY_BANNED/超批 Σ/超 op 数——批级违规整批拒绝零执行）。
// writeExecStatus/deleteExecOrphans 两 op 词汇与 exec 守卫计数族用例随删除清单退役
// （writeExecStatus feed 写面行为=collab-t22-delivery-switch.int.spec；exec 根死=无孤儿面）。
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyWriteOpsToDoc, transactSync } from './collab-doc-writer.service';
import { collabWriteRejectedTotal } from './store.metrics';
import {
  MAX_WRITE_OPS_PER_BATCH, MAX_WRITE_BATCH_BYTES,
  validateWriteBatch,
  type DocWriteOp,
} from '@flowweb/shared';

const rejectedOf = async (reason: string): Promise<number> => {
  const v = await collabWriteRejectedTotal.get();
  return v.values.find((x) => x.labels.reason === reason)?.value ?? 0;
};

/** 夹具节点种子：手建节点（T18 起 meta 零键——版本=PG 列装载门，进程内 doc 无戳档=常态）。
 *  Y1c T15 容器规则：data Y.Map 随节点种子落位（缺 data=结构错误——applyWriteNodeDataToDoc
 *  已撤懒建，no-data-map 拒写；写面夹具对齐创建 seam 形态）。 */
function seedNode(doc: Y.Doc, id = 'n1'): Y.Map<any> {
  const n = new Y.Map();
  n.set('type', 'text');
  n.set('data', new Y.Map());
  doc.getMap('nodes').set(id, n);
  return n;
}

describe('Y0c T8/T12 doc 域应用核心 applyWriteOpsToDoc（四 op 词汇——Y1c T32 收窄载体）', () => {
  it('红② Z75 合法终态（演进·偏离 19）：deliver 失败（node-deleted）⇒ written:false 进结果——禁 throw 禁回滚（同批合法 op 照常）', async () => {
    const doc = new Y.Doc(); // gone 不存在=节点已删域
    const before = await rejectedOf('node-deleted');

    const results = applyWriteOpsToDoc(doc, [
      { op: 'writeNodeData', nodeId: 'gone', patch: { resultUrl: 'http://x/gone.png' } },
      { op: 'writeNodeData', nodeId: 'gone', patch: { resultUrl: 'http://x/gone2.png' } },
    ]);

    expect(results[0]).toMatchObject({ index: 0, op: 'writeNodeData', written: false, reason: 'node-deleted' });
    expect(results[1]).toMatchObject({ index: 1, op: 'writeNodeData', written: false, reason: 'node-deleted' });
    expect(doc.getMap('nodes').get('gone')).toBeUndefined();        // 节点已删
    expect(await rejectedOf('node-deleted')).toBe(before + 2);      // 逐 op 守卫 reason 进 reject 计数
  });

  it('红④ Z108 三拒＝业务级拒绝进结果+reject 计数：__proto__ 键拒（同批合法 op 照常执行）/超批字节 Σ 整批拒/超 op 数整批拒——不 throw 不回滚', async () => {
    const doc = new Y.Doc();
    const n1 = seedNode(doc);

    // (a) __proto__ 键：违规 op 拒，同批合法 op 照常执行（拒绝非截断非 sanitize；批不回滚）
    const beforeProto = await rejectedOf('PROTO_KEY_BANNED');
    const protoPatch = JSON.parse('{"__proto__":"polluted"}') as Record<string, unknown>;
    const r1 = applyWriteOpsToDoc(doc, [
      { op: 'writeNodeData', nodeId: 'n1', patch: { resultUrl: 'http://ok/1.png' } },
      { op: 'writeNodeData', nodeId: 'n1', patch: protoPatch },
    ]);
    expect(r1[0]).toMatchObject({ index: 0, op: 'writeNodeData', written: true });
    expect(r1[1]).toMatchObject({ index: 1, op: 'writeNodeData', written: false, reason: 'PROTO_KEY_BANNED' });
    expect((n1.get('data') as Y.Map<any>).get('resultUrl')).toBe('http://ok/1.png'); // 合法 op 已生效（不回滚）
    expect(await rejectedOf('PROTO_KEY_BANNED')).toBe(beforeProto + 1);

    // (b) 超批字节 Σ：批级违规（index=-1）——整批拒绝零执行。计数=逐违规全量
    //（超限大值同时命中每键上限与批 Σ 两违规——同码两计，均 PATCH_TOO_LARGE）
    const beforeBig = await rejectedOf('PATCH_TOO_LARGE');
    const big = 'x'.repeat(MAX_WRITE_BATCH_BYTES);
    const r2 = applyWriteOpsToDoc(doc, [
      { op: 'writeNodeData', nodeId: 'n1', patch: { resultUrl: 'http://ok/2.png' } },
      { op: 'writeNodeData', nodeId: 'n1', patch: { result: big } },
    ]);
    expect(r2).toHaveLength(2);
    expect(r2.every((r) => !r.written && r.reason === 'PATCH_TOO_LARGE')).toBe(true);
    expect((n1.get('data') as Y.Map<any>).get('resultUrl')).toBe('http://ok/1.png'); // 整批拒——同批 op 未落 doc
    expect(await rejectedOf('PATCH_TOO_LARGE')).toBe(beforeBig + 2);

    // (c) 超 op 数：OP_COUNT_EXCEEDED——整批拒（结果仍一一对应）
    const beforeCount = await rejectedOf('OP_COUNT_EXCEEDED');
    const many: DocWriteOp[] = Array.from({ length: MAX_WRITE_OPS_PER_BATCH + 1 }, () => ({ op: 'deleteNodes', nodeIds: [] }));
    const r3 = applyWriteOpsToDoc(doc, many);
    expect(r3).toHaveLength(MAX_WRITE_OPS_PER_BATCH + 1);
    expect(r3.every((r, i) => !r.written && r.reason === 'OP_COUNT_EXCEEDED' && r.index === i)).toBe(true);
    expect(await rejectedOf('OP_COUNT_EXCEEDED')).toBe(beforeCount + 1);
  });

  it('Z76 幂等重放收敛：同批重放两次 ⇒ data 键级 set 同值收敛（键集不变无垃圾态）', () => {
    const doc = new Y.Doc();
    const n1 = seedNode(doc);
    const ops: DocWriteOp[] = [
      { op: 'writeNodeData', nodeId: 'n1', patch: { result: '同一产物' } },
    ];
    const first = applyWriteOpsToDoc(doc, ops);
    const second = applyWriteOpsToDoc(doc, ops);
    expect(first.every((r) => r.written)).toBe(true);
    expect(second.every((r) => r.written)).toBe(true);   // 幂等 op 键级 set 同值收敛
    const data = n1.get('data') as Y.Map<any>;
    expect(data.get('result')).toBe('同一产物');
    expect(Array.from(data.keys())).toEqual(['result']);  // 无重复键无垃圾态
  });

  it('Y1c T32：writeExecStatus/deleteExecOrphans op 词汇=UNKNOWN_OP 业务级拒（六 op 收四——fail-closed 防词汇回流）', async () => {
    const doc = new Y.Doc();
    seedNode(doc);
    const before = await rejectedOf('UNKNOWN_OP');
    const r = applyWriteOpsToDoc(doc, [
      { op: 'writeNodeData', nodeId: 'n1', patch: { resultUrl: 'x' } },
      { op: 'deleteExecOrphans' } as unknown as DocWriteOp,
    ]);
    expect(r[0]).toMatchObject({ index: 0, written: true });
    expect(r[1]).toMatchObject({ index: 1, written: false, reason: 'UNKNOWN_OP' });
    expect(await rejectedOf('UNKNOWN_OP')).toBe(before + 1);
  });
});

describe('Y0c T9 undefined 语义+schema 门+transactSync+deleteNodeDataKeys', () => {
  it('undefined fail-fast（Z5·原语面）：writeNodeData patch 含 undefined ⇒ throw /UNDEFINED_PATCH_VALUE/', () => {
    const doc = new Y.Doc();
    const n1 = seedNode(doc);
    expect(() => applyWriteOpsToDoc(doc, [
      { op: 'writeNodeData', nodeId: 'n1', patch: { resultUrl: undefined } },
    ])).toThrow(/UNDEFINED_PATCH_VALUE/);
    // fail-fast 在应用前——零写入（Y1c T15 起种子自带 data Y.Map〔容器规则〕——断言=零键写入）
    expect([...(n1.get('data') as Y.Map<unknown>).keys()]).toEqual([]);
  });

  it('T18·meta schema 门退役：meta.schemaVersion（任意残留值——旧档历史载荷）不再拦写——版本判据唯一承载=CanvasDoc.schemaVersion PG 列', async () => {
    const stale = new Y.Doc();
    seedNode(stale);
    stale.getMap('meta').set('schemaVersion', 1);   // 旧档残留载荷——写侧不解释
    const before = await rejectedOf('DOC_SCHEMA_AHEAD');
    expect(applyWriteOpsToDoc(stale, [
      { op: 'writeNodeData', nodeId: 'n1', patch: { resultUrl: 'x' } },
    ])).toMatchObject([{ index: 0, op: 'writeNodeData', written: true }]);   // 门已删——写按 op 语义执行非拒
    expect(await rejectedOf('DOC_SCHEMA_AHEAD')).toBe(before);   // 计数零增量（分支不存在）
  });

  it('transactSync 类型门：返回 Promise 的回调 ⇒ throw（会话写事务会把异步回调捕获到事务外续跑——破坏同事务不变量）', () => {
    const asyncFn = ((doc: Y.Doc) => { doc.getMap('meta'); return Promise.resolve(); }) as unknown as (d: Y.Doc) => void;
    expect(() => transactSync(asyncFn)(new Y.Doc())).toThrow(/Promise/);
    // 同步回调照常放行
    expect(() => transactSync((doc) => { doc.getMap('meta').set('k', 'v'); })(new Y.Doc())).not.toThrow();
  });

  it('deleteNodeDataKeys：写后逐键删+不存在键 no-op+节点缺失 written:false node-deleted+空数组合法 no-op', async () => {
    const doc = new Y.Doc();
    const n1 = seedNode(doc);

    // (a) 同批写后删（「不存在键 no-op」用白名单内但 doc 无此键的 fileId）。
    const r1 = applyWriteOpsToDoc(doc, [
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
    const r2 = applyWriteOpsToDoc(doc, [
      { op: 'deleteNodeDataKeys', nodeId: 'gone', keys: ['resultUrl'] },
    ]);
    expect(r2[0]).toMatchObject({ index: 0, op: 'deleteNodeDataKeys', written: false, reason: 'node-deleted' });
    expect(await rejectedOf('node-deleted')).toBe(before + 1);

    // (c) 空数组 ⇒ written:true 合法 no-op（spec §6 ②）
    const r3 = applyWriteOpsToDoc(doc, [
      { op: 'deleteNodeDataKeys', nodeId: 'n1', keys: [] },
    ]);
    expect(r3[0]).toMatchObject({ index: 0, op: 'deleteNodeDataKeys', written: true });
    expect(Array.from((n1.get('data') as Y.Map<any>).keys())).toEqual(['errorCode']);
  });
});

// ── Y0c T12 直写收编（裁决 1/2）→Y1c T32 收窄：deleteNodes/fillDoc 两 op+doc 域应用核心
// applyWriteOpsToDoc（shrink 预演与活写同源）+validateWriteBatch 幂等执法面 flag（裁决 2：默认
// 进程内档不产 NON_IDEMPOTENT_OP，requireIdempotentOps:true=端点执法档——T32 后端点已退役，
// flag 保留供未来执法面复用）。 ──
describe('Y0c T12 直写收编（两 op+doc 域 API+幂等执法面 flag）', () => {
  it('deleteNodes op：级联删边（引用被删节点的边一并删——悬挂边防护）+nodes 删+非 victims 保留', () => {
    const doc = new Y.Doc();
    seedNode(doc, 'n1');
    seedNode(doc, 'n2');
    const e1 = new Y.Map();
    e1.set('source', 'n1');
    e1.set('target', 'n2');
    doc.getMap('edges').set('e1', e1);

    const results = applyWriteOpsToDoc(doc, [{ op: 'deleteNodes', nodeIds: ['n1'] }]);

    expect(results[0]).toMatchObject({ index: 0, op: 'deleteNodes', written: true });
    expect(doc.getMap('nodes').get('n1')).toBeUndefined();   // victim 已删
    expect(doc.getMap('nodes').get('n2')).toBeInstanceOf(Y.Map); // 非 victim 保留
    expect(doc.getMap('edges').get('e1')).toBeUndefined();   // 级联删边（E68）
  });

  it('fillDoc op 可执行且 validateWriteBatch 零违规（T32 双评审收口：requireIdempotentOps 执法档随 write-batch 端点退役删——进程内档从不产出该码）', () => {
    const doc = new Y.Doc();

    const results = applyWriteOpsToDoc(doc, [
      { op: 'fillDoc', nodes: [{ id: 'nA', type: 'image', data: {} }], edges: [{ id: 'e1', source: 'nA', target: 'nB' }] },
    ]);
    expect(results[0]).toMatchObject({ index: 0, op: 'fillDoc', written: true });
    expect(doc.getMap('nodes').get('nA')).toBeInstanceOf(Y.Map);   // 节点种子落 doc
    expect(doc.getMap('edges').get('e1')).toBeInstanceOf(Y.Map);   // 边种子落 doc

    const ops: readonly unknown[] = [{ op: 'fillDoc', nodes: [], edges: [] }];
    expect(validateWriteBatch(ops)).toEqual([]);
  });

  it('applyWriteOpsToDoc doc 域应用核心（裁决 1）shrink 场景形态成立：预演（scratch）与活写同函数同语义——同 ops 两 doc 结果一致', () => {
    // 同源形态：同一 ops 分别应用 scratch（预演测量）与活 doc——结果与 doc 终态一致
    const mkDoc = (): Y.Doc => {
      const d = new Y.Doc();
      const n1 = new Y.Map();
      n1.set('type', 'text');
      d.getMap('nodes').set('n1', n1);
      const e1 = new Y.Map();
      e1.set('source', 'n1');
      e1.set('target', 'n2');
      d.getMap('edges').set('e1', e1);
      return d;
    };
    const scratch = mkDoc();
    const live = mkDoc();
    const ops: DocWriteOp[] = [{ op: 'deleteNodes', nodeIds: ['n1'] }];

    const preview = applyWriteOpsToDoc(scratch, ops);
    const committed = applyWriteOpsToDoc(live, ops);
    const expected = [{ index: 0, op: 'deleteNodes', written: true }];
    expect(preview).toEqual(expected);   // 预演测量=即将写的内容（同源最强形态）
    expect(committed).toEqual(expected);
    expect(live.getMap('nodes').get('n1')).toBeUndefined();
    expect(live.getMap('edges').get('e1')).toBeUndefined();         // 预演与活写同语义（E68 级联同在）
  });
});
