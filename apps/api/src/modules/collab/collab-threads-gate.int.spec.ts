// apps/api/src/modules/collab/collab-threads-gate.int.spec.ts
// Y4b T9（plan 2026-11-22-y4b-annotation-security Task 9——spec §0 条 6/14）：threads 服务端准入
// +L1/L2 分层执法集成锚（组2 第三个任务——纯 int 集成锚：Consumes=T6 谓词/T7 frame-deny 深链/
// T8 actor actorUserId 三处接线，Produces=无）。装置=dual-client-server 真 WS 双连接（E40 现成
// gateway/actor int 基建；permSvc resolveWithTeam 按 user 分流+session findUnique 按 token 分流
// =三身份承载面——auth-reason.spec VIEWER 覆写同款生产链）。
// **Review Focus 1 主档=两档冒名分流**（同帧新建 vs 追加评论——L1/L2 执法差异钉死）：
//  ①同帧新建：连接 A（user u1）submit 同帧新建线程合法帧 → 连接 B（user u2）收到广播（首断言
//    ——真 WS 广播面）；冒名档（createdBy/首条评论 authorId='u2'≠u1）→ L1 frame-deny 深链档
//    actorUserId 比较**只断 A 连接**（4411 码权威投递=webSocket.close 先行），B 连接仍在（不被
//    连坐）、服务端 doc 无该线程（零 WAL 零 apply——提交前拒）。同帧新建 L1 只断本连接=组2
//    分层执法锚点。**观测到 close 即 destroy 责任 provider**（provider 重连臂 1s 后自动重连——
//    本地 doc 仍持冒名帧，重连 SS2 回灌同帧再拒=连接风暴污染后续档；close 断言后即拔）。
//  ②追加冒名：先合法建线程 → A 对**已有线程**追加评论帧（authorId='u2'，父级出帧）→ apply 后
//    L2 → 毒帧协议 4411 **关项目全部连接**（A+B 双双 close——与①只断 A 的分流差异）+WAL 截断至
//    前帧 appliedSeq+doc 卸载重装载=**从已落库水位重放**（fresh 客户端读回=合法基线帧在线、冒名
//    评论不在线——重放面权威性；重放面=spool 幸存段经 DR.loadDocument peekSpoolFrames——双 provider
//    拔除后 pollUntil doc 离 documents Map=卸载窗闭合再 fresh 连接）。
//  ③L2 不可变键：对已有线程改 body（path 再深档——动作矩阵 add/update/delete 全拒）→ 4411 同档
//    （close 全部+重放不在线）。
//  ④readOnly（Review Focus 旧 1）：VIEWER（u9）连接 submit threads 帧 → **noop-readonly 短路**
//    （actor ⓪ 最先——零 threads 专用分支：连接在、服务端 doc 不变、B 端零广播、4404 不触发
//    〔连接不 close=overPush 升级不达〕；actorFrameOutcomeTotal{outcome=noop-readonly} 恰一增
//    ——库 readOnly 检查在 beforeSync 之后，VIEWER 帧必经 actor ⓪ 计数面）。
//  ⑤负控：合法 createThread/addComment/resolve/deleteThread 四帧全过闸广播（B 端逐帧读回终值
//    ——最后仅剩 deleteThread 后零线程；全程零 close）。
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { register } from 'prom-client';
import { THREADS_ORIGIN, buildThreadEntry, buildThreadComment } from '@flowweb/shared';
import { startDualClientServer, type DualClientKit } from '../../test-utils/dual-client-server';
import { pollUntil } from '../../test-utils/poll-until';
import { canvasDocName } from './doc-name.util';

/** 三 token=三身份（session findUnique 按 token 分流 + resolveWithTeam 按 user 分流——
 *  生产判据单源覆写面：auth-reason.spec VIEWER 覆写同款先例）。 */
const TOKEN_ED = 'tok-y4bt9-ed';   // A 连接 user u1（EDITOR）
const TOKEN_EB = 'tok-y4bt9-eb';   // B 连接 user u2（EDITOR——广播观察者）
const TOKEN_EV = 'tok-y4bt9-ev';   // C 连接 user u9（VIEWER——④ readOnly 档）
const PID = 'y4bt9-gate';
/** docName 单源（doc-name.util.canvasDocName——gen0 canonical=裸名；kit 无世代播种故 liveDocName 折
 *  裸名同值。注释：shared 无此导出，单源在 api 侧 doc-name.util，此处经 `project:` 裸模板字面量会
 *  触 census ㉚ 门——本 spec 属测试面不在生产扫描域，然仍走单源避免后人照抄进生产）。 */
const DOC_NAME = canvasDocName(PID, 0);

/** A 端一条 threads-user 事务建线程（T6 工厂单源——held-ref 形态：自建 comments 容器覆写工厂
 *  预建〔同引用持有〕+首条评论同事务；spec §2.1 createThread=envelope+comments 容器+首条评论）。 */
function aCreateThreadTx(a: Y.Doc, id: string, createdBy: string, firstAuthorId: string): void {
  a.transact(() => {
    const comments = new Y.Map<unknown>();
    const entry = buildThreadEntry({
      id, nodeId: 'n1', kind: 'node', resolved: false, createdAt: 1_000, createdBy,
    });
    entry.set('comments', comments);   // 覆写工厂预建容器=同引用持有（frame-deny.spec legalThreadMap 同款）
    comments.set('c1', buildThreadComment({ id: 'c1', authorId: firstAuthorId, body: '首条评论', createdAt: 1_001 }));
    a.getMap('threads').set(id, entry);
  }, THREADS_ORIGIN);
}

/** 一条 threads-user 事务追加评论（spec §2.1 addComment——已有线程 comments 容器 set 新键）。 */
function addCommentTx(doc: Y.Doc, threadId: string, cid: string, authorId: string): void {
  doc.transact(() => {
    const entry = doc.getMap('threads').get(threadId) as Y.Map<unknown>;
    const comments = entry.get('comments') as Y.Map<unknown>;
    comments.set(cid, buildThreadComment({ id: cid, authorId, body: `评论 ${cid}`, createdAt: 2_000 }));
  }, THREADS_ORIGIN);
}

/** 观测窗 settle：套件短 debounce（50/75ms 防抖+actor 批窗）下帧批全落定。 */
async function settle(ms = 600): Promise<void> { await new Promise((r) => setTimeout(r, ms)); }

/** metric 读数（prom-client get——collab-ops-gate c21 counterValue 同款）。 */
async function outcomeTotal(outcome: string): Promise<number> {
  const m = (await register.getMetricsAsJSON()).find((x) => x.name === 'collab_actor_frame_outcome_total') as
    { values: { labels: Record<string, string>; value: number }[] } | undefined;
  return m?.values.find((v) => v.labels.outcome === outcome)?.value ?? 0;
}

/** close 事件观测（provider EventEmitter 面——behavior-anchors/ws-polyfill 同款仪器：
 *  hardClose→webSocket.close(code)→客户端 close 事件 {event:{code}}）。 */
type Conn = ReturnType<DualClientKit['connect']>;
function watchClose(provider: Conn['provider']): { code(): number | null } {
  let code: number | null = null;
  (provider as { on(ev: string, cb: (e: unknown) => void): void }).on('close', (e: unknown) => {
    const c = (e as { event?: { code?: unknown } } | null)?.event?.code;
    if (code === null && typeof c === 'number') code = c;
  });
  return { code: () => code };
}

describe('Y4b T9：threads L1/L2 分层执法（装置=dual-client-server 真 WS 双连接）', () => {
  let kit: DualClientKit;

  /** 连接+注册 close 观测；拔除器=destroy+forget（close 观测后拔——防 provider 重连臂
   *  自动重连把本地 doc 残留帧再次回灌（连接风暴）+防 dispose 双 destroy 已知 flaky 源）。 */
  function connect(token: string): Conn & { close(): number | null; pull(): Promise<void> } {
    const c = kit.connect(DOC_NAME, token);
    const obs = watchClose(c.provider);
    return { ...c, close: () => obs.code(), pull: async () => { await c.provider.destroy(); kit.forget(c.provider); } };
  }

  const liveDoc = (): Y.Doc | undefined =>
    (kit.gateway.server.hocuspocus.documents.get(DOC_NAME) as unknown as Y.Doc | undefined);

  beforeAll(async () => {
    // repo 覆写：appendBatch 过闸帙行同步落 loadForHydration 台账（durableRows 装置——
    // collab.gateway.spec appendBatch over 先例）——②③ 毒帧重放半段读回面=该帙。
    const appliedRows: Uint8Array[] = [];
    kit = await startDualClientServer({
      appendBatch: vi.fn(async (_pid: string, rows: Array<{ update: Uint8Array }>) => {
        for (const r of rows) appliedRows.push(new Uint8Array(r.update));
        return { ok: true as const, rows: rows.length };
      }),
      loadForHydration: vi.fn(async () => ({ state: null, updates: appliedRows.map((u) => Buffer.from(u)), stateSeq: 0n })),
    });
    // 三身份 resolveWithTeam 按 user 分流：u1/u2=EDITOR、u9=VIEWER（④ readOnly 档身份）。
    kit.permSvc.resolveWithTeam.mockImplementation(
      async (_projectId: string, userId: string) => {
        if (userId === 'u9') return { role: 'PROJECT_VIEWER', teamId: 't1' };
        return { role: 'PROJECT_EDITOR', teamId: 't1' };
      },
    );
    // Session 真链（cookie 值即 token——kit 通道承载）：三 token→三 user。
    kit.prisma.session.findUnique.mockImplementation(
      async (args: { where: { token: string } }) => {
        const byToken: Record<string, { user: { id: string; name: string }; expiresAt: Date }> = {
          [TOKEN_ED]: { user: { id: 'u1', name: '甲' }, expiresAt: new Date(Date.now() + 3_600_000) },
          [TOKEN_EB]: { user: { id: 'u2', name: '乙' }, expiresAt: new Date(Date.now() + 3_600_000) },
          [TOKEN_EV]: { user: { id: 'u9', name: '访' }, expiresAt: new Date(Date.now() + 3_600_000) },
        };
        return byToken[args.where.token] ?? null;
      },
    );
  }, 30_000);

  afterEach(async () => {
    // 观测窗收尾：帧批全落定（残余计时器零干扰——下档 fresh 连接代）。
    await settle(450);
  });

  afterAll(async () => { await kit.dispose(); }, 30_000);

  it('①+② 两档冒名分流：同帧新建合法帧→B 广播；同帧冒名→4411 只断 A/B 在/doc 无该线程；追加冒名→4411 关全部+重放不在线', async () => {
    const a = connect(TOKEN_ED);
    const b = connect(TOKEN_EB);
    await Promise.all([a.synced, b.synced]);

    // 主用例第一条断言：A（u1）同帧新建线程合法帧 → B（u2）收到广播（真 WS 广播面）。
    aCreateThreadTx(a.ydoc, 't1', 'u1', 'u1');
    await pollUntil(() => b.ydoc.getMap('threads').has('t1'), 5_000);
    const bEntry = b.ydoc.getMap('threads').get('t1') as Y.Map<unknown>;
    expect((bEntry.get('comments') as Y.Map<unknown>).size).toBe(1);   // 广播内容含首条评论

    // ── 档① 同帧冒名（L1 深链 actorUserId——只断责任连接）──
    aCreateThreadTx(a.ydoc, 't2-imp', 'u2', 'u2');   // createdBy/首条 authorId='u2'≠u1（同帧新建冒名帧）
    await pollUntil(() => a.close() === 4411, 8_000);
    expect(a.close(), '同帧冒名=L1 只断责任连接（4411 码投递）').toBe(4411);
    expect(b.close(), 'B 不被连坐（L1 执法面=本帧认领者单连接）').toBeNull();
    // 服务端 doc 无该线程（零 WAL 零 apply——提交前拒；B 端零残留同步证）
    expect(b.ydoc.getMap('threads').has('t2-imp')).toBe(false);
    expect(liveDoc()?.getMap('threads').has('t2-imp')).toBe(false);
    await a.pull();   // 责任 provider 拔除（防重连臂把 t2-imp 回灌=连接风暴污染②）

    // ── 档② 追加冒名（父级出帧 L2——4411 关全部+从已落库水位重放）──
    // A 重连（L1 档只断连接不断用户——可重试档重连即新代；服务端 doc 保有合法基线 t1）。
    const a2 = connect(TOKEN_ED);
    await a2.synced;
    // 追加冒名帧：对已有线程 t1 追加评论（authorId='u2'≠u1——父级出帧 L1 不可判定，apply 后 L2 拒）
    addCommentTx(a2.ydoc, 't1', 'c2-imp', 'u2');
    await pollUntil(() => a2.close() === 4411 && b.close() === 4411, 8_000);
    // 4411 关全部：A（新代）与 B 双双 close（与①「只断 A」的分流差异——Review Focus 1 主断言）
    expect(a2.close()).toBe(4411);
    expect(b.close(), '追加冒名=毒帧协议关项目全部连接（4411）').toBe(4411);
    // 双 provider 拔除+卸载窗闭合（unloadImmediately 末连接走即卸载——live doc 内存态仍含毒帧，
    // 不可作为重放判据；卸载后 fresh 连接触发 DR.loadDocument peekSpoolFrames=截断后幸存段）。
    await Promise.all([a2.pull(), b.pull()]);
    await pollUntil(() => liveDoc() === undefined, 8_000);
    // 重放面：fresh 客户端读回=合法基线帧在线（t1/首条评论在——冒名追加帧被截断不重放）。
    const fresh = connect(TOKEN_EB);
    try {
      await fresh.synced;
      const threads = fresh.ydoc.getMap('threads');
      expect(threads.has('t1')).toBe(true);
      const entry = threads.get('t1') as Y.Map<unknown>;
      expect((entry.get('comments') as Y.Map<unknown>).has('c2-imp'), '冒名追加不在线（WAL 截断至前帧 appliedSeq）').toBe(false);
      expect((entry.get('comments') as Y.Map<unknown>).size, '基线首条评论在线（从已落库水位重放）').toBe(1);
    } finally {
      await fresh.pull();
    }
  }, 40_000);

  it('③ L2 不可变键：对已有线程评论改 body → 4411 同档（close 全部+重放不在线——动作矩阵 path 再深档全拒）', async () => {
    const a = connect(TOKEN_ED);
    const b = connect(TOKEN_EB);
    await Promise.all([a.synced, b.synced]);
    aCreateThreadTx(a.ydoc, 't3', 'u1', 'u1');
    await pollUntil(() => b.ydoc.getMap('threads').has('t3'), 5_000);
    // body 改动帧：已有评论 c1 上 set body（path=[t3,comments,c1,body] 再深档——L2 add/update/delete 全拒）
    a.ydoc.transact(() => {
      const entry = a.ydoc.getMap('threads').get('t3') as Y.Map<unknown>;
      const c1 = (entry.get('comments') as Y.Map<unknown>).get('c1') as Y.Map<unknown>;
      c1.set('body', '篡改正文');
    }, THREADS_ORIGIN);
    await pollUntil(() => a.close() === 4411 && b.close() === 4411, 8_000);
    expect(a.close(), 'body 改动=L2 不可变键档 4411（culprit）').toBe(4411);
    expect(b.close(), '毒帧协议关项目全部连接').toBe(4411);
    await Promise.all([a.pull(), b.pull()]);
    await pollUntil(() => liveDoc() === undefined, 8_000);
    // 重放不在线：fresh 客户端读回 body=原值（「篡改正文」被截断不重放）。
    const fresh = connect(TOKEN_EB);
    try {
      await fresh.synced;
      const entry = fresh.ydoc.getMap('threads').get('t3') as Y.Map<unknown>;
      const body = ((entry.get('comments') as Y.Map<unknown>).get('c1') as Y.Map<unknown>).get('body');
      expect(body, 'L2 毒帧截断后重放不含篡改帧').toBe('首条评论');
    } finally {
      await fresh.pull();
    }
  }, 40_000);

  it('④ readOnly 短路：VIEWER 连接 submit threads 帧 → noop-readonly（连接在、文档不变、零 threads 专用分支；配额 4404 不动）', async () => {
    const before = await outcomeTotal('noop-readonly');
    // 布景基线：EDITOR 读面（C 端写帧不广播、服务端 doc 不变——B 读面双证）。
    const b = connect(TOKEN_EB);
    await b.synced;
    const c = connect(TOKEN_EV);   // VIEWER（u9→resolveWithTeam→PROJECT_VIEWER→freezeIntent=viewer）
    await c.synced;
    const baseline = b.ydoc.getMap('threads').size;
    // VIEWER submit threads 帧（合法形态——短路面不分域不判内容；库 readOnly 检查在 beforeSync
    // 之后 ⇒ 帧经 guardSyncFrame 提交 actor ⓪ readOnly 短路——noop-readonly 计数面）。
    c.ydoc.transact(() => {
      const comments = new Y.Map<unknown>();
      const entry = buildThreadEntry({
        id: 't-viewer', nodeId: 'n1', kind: 'node', resolved: false, createdAt: 1_000, createdBy: 'u9',
      });
      entry.set('comments', comments);
      comments.set('c1', buildThreadComment({ id: 'c1', authorId: 'u9', body: 'VIEWER 帧不应落库', createdAt: 1_001 }));
      c.ydoc.getMap('threads').set('t-viewer', entry);
    }, THREADS_ORIGIN);
    await settle(800);
    // noop-readonly 短路（actor ⓪ 最先——零 threads 专用分支）：outcome 恰一增。
    const noopNow = await outcomeTotal('noop-readonly');
    expect(noopNow - before, 'VIEWER threads 帧=actor ⓪ noop-readonly 短路（不分域）').toBe(1);
    // 连接在（不 close——短路非执法）+文档不变（B 端零广播+服务端 doc 零新键）
    expect(c.close(), 'readOnly 短路不断连').toBeNull();
    expect(b.close()).toBeNull();
    expect(b.ydoc.getMap('threads').size, 'B 端零广播').toBe(baseline);
    expect(liveDoc()?.getMap('threads').has('t-viewer'), '服务端 doc 不变').toBe(false);
    // 配额 4404 不动（noop 短路非配额档——overPush 升级须 close 4404，连接在即不触发）
    expect(b.ydoc.getMap('threads').has('t-viewer')).toBe(false);
    await Promise.all([b.pull(), c.pull()]);
  }, 40_000);

  it('⑤ 负控：合法 createThread/addComment/resolve/deleteThread 四帧全过闸广播（B 端逐帧读回终值）', async () => {
    const a = connect(TOKEN_ED);
    const b = connect(TOKEN_EB);
    await Promise.all([a.synced, b.synced]);
    try {
      // createThread
      aCreateThreadTx(a.ydoc, 't5', 'u1', 'u1');
      await pollUntil(() => b.ydoc.getMap('threads').has('t5'), 5_000);
      // addComment：u1 对已有线程 t5 追加评论（authorId=u1 合法——L2 放行档）
      addCommentTx(a.ydoc, 't5', 'c5b', 'u1');
      await pollUntil(() => {
        const entry = b.ydoc.getMap('threads').get('t5') as Y.Map<unknown> | undefined;
        return entry != null && (entry.get('comments') as Y.Map<unknown>).has('c5b');
      }, 5_000);
      // setResolved：唯一可变键 update（布尔）——L2 path=[t5] update 档放行
      a.ydoc.transact(() => {
        (a.ydoc.getMap('threads').get('t5') as Y.Map<unknown>).set('resolved', true);
      }, THREADS_ORIGIN);
      await pollUntil(() => {
        const entry = b.ydoc.getMap('threads').get('t5') as Y.Map<unknown> | undefined;
        return entry != null && entry.get('resolved') === true;
      }, 5_000);
      // deleteThread：根键 delete（L1/L2 删除三级放行）
      a.ydoc.transact(() => {
        a.ydoc.getMap('threads').delete('t5');
      }, THREADS_ORIGIN);
      await pollUntil(() => !b.ydoc.getMap('threads').has('t5'), 5_000);
      // 四帧全过闸：零 close（连接代全存活——与①②③执法档的分界）
      expect(a.close(), '合法四帧零 close（负控）').toBeNull();
      expect(b.close()).toBeNull();
    } finally {
      await Promise.all([a.pull(), b.pull()]);
    }
  }, 40_000);
});

// 依赖锚：THREADS_ORIGIN=threads-user（T7 undo-policy 单源——threads 三事务 origin 同值钉死）。
