// apps/api/src/modules/collab/collab-project-actor.t21-freeze.spec.ts
// Y1c T21（G4 门先红⑥）：frozenDocSeq 受理临界区——freeze=per-project mutex（非布尔 flag）。
// 红前置（本文件先于 withFrozenPrefix 实现空转跑=方法缺失红）：v5.4⑪ 次序=
// 拿 mutex→等当前 apply→flushThrough(appliedSeq)→断言 pgSeq==appliedSeq→只读→frozenDocSeq=pgSeq→释放。
// 装置=collab-project-actor.spec 同款（真 spool tmpdir+mock repo+fake host——单元形态）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { CollabProjectActorService } from './collab-project-actor.service';
import { CollabSpoolService } from './collab-spool.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import type { Logger } from '@nestjs/common';

function makeConn() { return { socketId: 'sock-' + Math.random().toString(36).slice(2, 8), readOnly: false, sendStateless: () => {} } as never; }

function frameSetting(key: string, val: unknown) {
  const src = new Y.Doc();
  (src.getMap('nodes') as Y.Map<unknown>).set(key, val);
  return Y.encodeStateAsUpdate(src);
}

let spoolDir: { dir: string; cleanup: () => Promise<void> };
beforeEach(async () => { spoolDir = await makeSpoolDir('t21-freeze-'); });
afterEach(async () => { await spoolDir.cleanup(); });

function makeSpool() {
  const spool = new CollabSpoolService(spoolDir.dir);
  spool.setOwner('t21-owner');
  spool.setWalHistory('t21-history-id');
  return spool;
}

/** PG 落库滞后 repo：appendBatch 挂起（deferred resolve 前 pgSeq 永不推进——applied>pg 窗实锤）。 */
function deferredRepo() {
  const repo = createMockRepo();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  repo.appendBatch.mockImplementation(async () => gate.then(() => ({ ok: true as const, rows: 1 })));
  return { repo, release };
}

function buildActor(spool: CollabSpoolService, repo: ReturnType<typeof createMockRepo>, doc: Y.Doc, pid = 'p1') {
  const documents = new Map<string, Y.Doc>([[`project:${pid}`, doc]]);
  const actor = new CollabProjectActorService(spool, repo as never);
  (actor as unknown as { bindHost(h: unknown): void }).bindHost({
    logger: { log: () => {}, warn: () => {}, error: () => {}, debug: () => {}, verbose: () => {}, fatal: () => {} } as unknown as Logger,
    documents: () => documents,
    hardClose: () => {},
    isQuotaFrozen: () => false,
    generationOf: () => 0,
    noteReadOnlyDrop: () => false,
    onFencedByWrite: async () => {},
  });
  return actor;
}

describe('Y1c T21 G4-⑥：frozenDocSeq 临界区（withFrozenPrefix——红前置先跑）', () => {
  it('红⑥-a（竞态实锤锚）：PG 落库滞后窗（applied>pgSeq）冻结读必须拒绝（flush-timeout）——禁把含未持久帧的 doc 冻进受理输入', async () => {
    const spool = makeSpool();
    const { repo, release } = deferredRepo();
    const doc = new Y.Doc();
    const actor = buildActor(spool, repo, doc);
    // 帧 1：fsync+apply 完成（submit resolve）但 PG 批挂起 → applied=1, pgSeq=0
    await actor.submit('p1', frameSetting('n1', 'applied-not-persisted'), makeConn(), 'update');
    expect(doc.getMap('nodes').get('n1')).toBe('applied-not-persisted');   // doc 已含未持久帧（竞态存在性实锤）
    // 冻结读：pgSeq(0)≠appliedSeq(1) ⇒ flush-timeout 拒绝（不返回 ok——否则冻结输入含未持久帧）
    const r = await actor.withFrozenPrefix('p1', async () => 'must-not-run', { gateBudgetMs: 200, flushBudgetMs: 150 });
    expect(r).toEqual({ ok: false, reason: 'flush-timeout' });
    release();   // PG 追平后重试 → ok（见 ⑥-c）
    await new Promise((res) => setTimeout(res, 30));
  });

  it('红⑥-b：freeze 在持=新 submit 帧不得在读后 apply（mutex 语义——release 后才处理）', async () => {
    const spool = makeSpool();
    const repo = createMockRepo();
    const doc = new Y.Doc();
    const actor = buildActor(spool, repo, doc);
    // 前置一帧已落定（pgSeq=1）
    await actor.submit('p1', frameSetting('n0', 'persisted'), makeConn(), 'update');
    await new Promise((res) => setTimeout(res, 30));
    const appliedBefore = actor.appliedSeqOf('p1');

    let frame2Settled = false;
    const r = await actor.withFrozenPrefix('p1', async ({ doc: frozenDoc, appliedSeq }) => {
      // 冻结窗内提交新帧——不得 apply（doc 无该内容/appliedSeq 不动）
      const p = actor.submit('p1', frameSetting('n2', 'during-freeze'), makeConn(), 'update').then((v) => { frame2Settled = true; return v; });
      for (let i = 0; i < 12; i++) await new Promise((res) => setTimeout(res, 5));   // 跨多拍让 drain 有机会违规
      expect((frozenDoc.getMap('nodes') as Y.Map<unknown>).get('n2')).toBeUndefined();   // 读后无新 apply（红：无 freeze 实现时此帧已入 doc）
      expect(actor.appliedSeqOf('p1')).toBe(appliedSeq);
      void p;
      return 'frozen-read-ok';
    }, { gateBudgetMs: 1_000, flushBudgetMs: 2_000 });
    expect(r).toMatchObject({ ok: true, value: 'frozen-read-ok', appliedSeq: appliedBefore });
    // release 后帧 2 落定
    for (let i = 0; i < 100 && !frame2Settled; i++) await new Promise((res) => setTimeout(res, 10));
    expect(frame2Settled).toBe(true);
    expect(doc.getMap('nodes').get('n2')).toBe('during-freeze');
  });

  it('⑥-c：PG 追平后冻结成功：pgSeq==appliedSeq 且 fn 读到前缀态 doc', async () => {
    const spool = makeSpool();
    const repo = createMockRepo();
    const doc = new Y.Doc();
    const actor = buildActor(spool, repo, doc);
    await actor.submit('p1', frameSetting('n1', 'persisted-1'), makeConn(), 'update');
    await new Promise((res) => setTimeout(res, 30));   // PG 批落定（mock 立即 ok）
    const r = await actor.withFrozenPrefix('p1', async ({ doc: d, pgSeq, appliedSeq }) => {
      expect((d.getMap('nodes') as Y.Map<unknown>).get('n1')).toBe('persisted-1');
      expect(pgSeq).toBe(appliedSeq);
      return pgSeq;
    });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.value).toBe(actor.appliedSeqOf('p1'));
  });
});
