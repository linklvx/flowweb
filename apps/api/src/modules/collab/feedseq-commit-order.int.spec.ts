// apps/api/src/modules/collab/feedseq-commit-order.int.spec.ts —— Y1c T0-C spike S5（plan v1.7 Task 0/S5；
// spec v5.4 ⑮/偏离 38⑮「锁序简化业务行→counter」的实验锚）：
//   (a) PG 裸 sequence 分配序≠提交序复现——事务 A nextval 取号未提交 / B 后取号先提交 ⇒ 游标停在
//       max(committed seq) 后 A（更低 seq）才提交 ⇒ 「seq > cursor」增量查询永久漏 A 行（feed 漏事件洞）。
//   (b) RuntimeFeedCursor 专用计数行方案验证——`UPDATE counter SET lastSeq=lastSeq+1 ... RETURNING`
//       在业务事务内、且 counter 行锁**最后拿**（业务行→counter）：
//       ①同项目：A 持 counter 行锁未提交 ⇒ B 的 UPDATE 阻塞至 A 提交 ⇒ 分配序≡提交序（无洞可漏）；
//       ②跨项目：不同 projectId 行互不阻塞（仅 per-project 串行）；
//       ③锁序契约：counter 先拿+业务行后拿（对向获取）⇒ 40P01 死锁复现；业务行→counter 统一序 ⇒ 无死锁；
//       ④abort ⇒ seq 空洞（无害——cursor 永不错过已提交行）vs 裸 sequence 的倒挂（致命）。
//   先例对照（结论文档 §5）：canvas-doc-update.repository.ts:59-72（advisory lock 先拿+nextval 同语句）
//   与 credit-ledger.service.ts:58-64（lockBalance FOR UPDATE 锁序第一环）——同为「seq/账序≡提交序」目标、
//   锁序形态差异的成因见 y1c-t0-s5-feedseq-commit-order.md。
// SPIKE 工件：零生产码改动；scratch schema y1c_s5_spike 自建自清，不触碰任何生产表。
// 运行：DATABASE_URL=... pnpm --filter @flowweb/api exec vitest run -c vitest.int.config.ts src/modules/collab/feedseq-commit-order.int.spec.ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const hasDb = !!process.env.DATABASE_URL;
const SCHEMA = 'y1c_s5_spike';
const conn = () => new Client({ connectionString: process.env.DATABASE_URL });

/** 各实验连接（beforeAll 建、afterAll 尽力 END） */
let A: Client, B: Client, R: Client, C: Client;

/** 轮询直到谓词为真（结构断言用：确认对端真在等锁，而非靠时序碰运气） */
async function waitUntil(fn: () => Promise<boolean>, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

/** 当前库上有连接正阻塞在锁上（排除轮询自身）——「B 真在等行锁」的结构证据 */
const lockWaiters = async (): Promise<number> => {
  const r = await R.query(
    `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
  );
  return r.rows[0].n;
};

const allocSeq = (cl: Client, projectId: string) =>
  cl
    .query<{ lastSeq: string }>(`UPDATE ${SCHEMA}.feed_counter SET "lastSeq" = "lastSeq" + 1 WHERE "projectId" = $1 RETURNING "lastSeq"`, [projectId])
    .then((r) => BigInt(r.rows[0].lastSeq));   // 引号标识符保大小写；pg bigint 返回 string——BigInt 显式解析

(hasDb ? describe : describe.skip)('Y1c T0-S5：feedSeq 提交顺序（真 PG，scratch schema）', () => {
  beforeAll(async () => {
    A = conn(); B = conn(); R = conn(); C = conn();
    await Promise.all([A.connect(), B.connect(), C.connect()]);
    await R.connect();
    await R.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await R.query(`CREATE SCHEMA ${SCHEMA}`);
    // (a) 裸 sequence 形态
    await R.query(`CREATE SEQUENCE ${SCHEMA}.bare_seq`);
    await R.query(`CREATE TABLE ${SCHEMA}.bare_events (seq bigint PRIMARY KEY, payload text NOT NULL)`);
    // (b) counter 行形态：计数行+业务行+feed 事件行（T5b/T7 目标形状的最小化）
    await R.query(`CREATE TABLE ${SCHEMA}.feed_counter ("projectId" text PRIMARY KEY, "lastSeq" bigint NOT NULL DEFAULT 0)`);
    await R.query(`CREATE TABLE ${SCHEMA}.business_row (id text PRIMARY KEY, payload text NOT NULL)`);
    await R.query(`CREATE TABLE ${SCHEMA}.feed_event ("projectId" text NOT NULL, seq bigint NOT NULL, payload text NOT NULL, PRIMARY KEY ("projectId", seq))`);
    await R.query(`INSERT INTO ${SCHEMA}.feed_counter ("projectId") VALUES ('P1'), ('P2')`);
    await R.query(`INSERT INTO ${SCHEMA}.business_row (id, payload) VALUES ('r1', 'v0'), ('r2', 'v0')`);
  });

  afterAll(async () => {
    // 自清：schema 整体丢弃 + 连接尽力 END（已断/已回滚的 END 抛错吞掉）
    try { await R.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`); } catch { /* best-effort */ }
    for (const cl of [A, B, C, R]) { try { await cl.end(); } catch { /* best-effort */ } }
  });

  // 用例间复位：任一用例半途而废（断言红/异常）不得把悬挂事务漏给下一用例（首跑红即见级联教训）
  afterEach(async () => {
    for (const cl of [A, B, C]) { try { await cl.query('ROLLBACK'); } catch { /* 无事务在途即静默 */ } }
  });

  it('(a) 裸 sequence：A 取号未提交/B 先提交 → 游标漏 A（分配序≠提交序复现）', async () => {
    await A.query('BEGIN');
    const ia = await A.query<{ seq: string }>(
      `INSERT INTO ${SCHEMA}.bare_events (seq, payload) VALUES (nextval('${SCHEMA}.bare_seq'), 'A') RETURNING seq`,
    );
    const seqA = BigInt(ia.rows[0].seq);

    await B.query('BEGIN');
    const ib = await B.query<{ seq: string }>(
      `INSERT INTO ${SCHEMA}.bare_events (seq, payload) VALUES (nextval('${SCHEMA}.bare_seq'), 'B') RETURNING seq`,
    );
    const seqB = BigInt(ib.rows[0].seq);
    await B.query('COMMIT');
    const commitBTs = Date.now();

    // 分配序：A 先取号（seqA < seqB）；提交序：B 先提交——倒挂成立
    expect(seqB).toBe(seqA + 1n);

    // 游标推进到 max(committed seq)：此刻 B 可见、A 不可见
    const max1 = await R.query<{ m: string | null }>(`SELECT max(seq) AS m FROM ${SCHEMA}.bare_events`);
    const cursor = BigInt(max1.rows[0].m!);
    expect(cursor).toBe(seqB);

    await A.query('COMMIT');
    const commitATs = Date.now();
    expect(commitATs).toBeGreaterThanOrEqual(commitBTs);   // A 后提交（时序证据）

    // 漏洞：增量查询 seq > cursor 永远拿不到 A（A 的 seq < cursor）
    const after = await R.query(`SELECT seq FROM ${SCHEMA}.bare_events WHERE seq > $1 ORDER BY seq`, [cursor.toString()]);
    expect(after.rows).toHaveLength(0);
    // 而 A 行确已提交存在——「已提交却永不可达」= feed 漏事件洞
    const aRow = await R.query<{ seq: string }>(`SELECT seq FROM ${SCHEMA}.bare_events WHERE payload = 'A'`);
    expect(BigInt(aRow.rows[0].seq)).toBe(seqA);
    expect(seqA).toBeLessThan(cursor);
  }, 15_000);

  it('(b)① counter 行锁：A 未提交 ⇒ B 阻塞至 A 提交 ⇒ 分配序≡提交序（同项目无洞）', async () => {
    await A.query('BEGIN');
    await A.query(`UPDATE ${SCHEMA}.business_row SET payload = 'a1' WHERE id = 'r1'`);   // 业务行先行（锁序契约）
    const seqA = await allocSeq(A, 'P1');
    expect(seqA).toBe(1n);
    await A.query(`INSERT INTO ${SCHEMA}.feed_event ("projectId", seq, payload) VALUES ('P1', $1, 'evA')`, [seqA.toString()]);

    // B：同项目、不同业务行（无业务行冲突）——只应被 counter 行锁挡住
    let bDone = false;
    const bPromise = (async () => {
      await B.query('BEGIN');
      await B.query(`UPDATE ${SCHEMA}.business_row SET payload = 'b1' WHERE id = 'r2'`);
      const seq = await allocSeq(B, 'P1');
      await B.query(`INSERT INTO ${SCHEMA}.feed_event ("projectId", seq, payload) VALUES ('P1', $1, 'evB')`, [seq.toString()]);
      await B.query('COMMIT');
      bDone = true;
      return seq;
    })();

    // 结构证据：B 真在等锁（pg_stat_activity wait_event_type='Lock'），且此刻未完成
    expect(await waitUntil(() => lockWaiters().then((n) => n >= 1))).toBe(true);
    await new Promise((r) => setTimeout(r, 150));
    expect(bDone).toBe(false);   // A 未提交 ⇒ B 不可能分配到号

    // reader 视角：P1 已提交事件为空（A 未提交）——游标安全停在 0
    const mid = await R.query(`SELECT seq FROM ${SCHEMA}.feed_event WHERE "projectId" = 'P1' ORDER BY seq`);
    expect(mid.rows).toHaveLength(0);

    const aCommitTs = Date.now();
    await A.query('COMMIT');
    const seqB = await bPromise;
    const bDoneTs = Date.now();

    // 核心：seqB > seqA 且 B 完成于 A 提交之后 ⇒ 分配序≡提交序
    expect(seqB).toBe(seqA + 1n);
    expect(bDoneTs).toBeGreaterThanOrEqual(aCommitTs);

    // 前缀性质（游标安全性）：任一时刻可见集恒为前缀——count == max（无倒挂即无洞）
    const fin = await R.query<{ mx: string | null; n: string }>(
      `SELECT max(seq) AS mx, count(*)::text AS n FROM ${SCHEMA}.feed_event WHERE "projectId" = 'P1'`,
    );
    expect(BigInt(fin.rows[0].n)).toBe(BigInt(fin.rows[0].mx!));   // 2 行 seq=1,2
    const rows = await R.query(`SELECT seq FROM ${SCHEMA}.feed_event WHERE "projectId" = 'P1' ORDER BY seq`);
    expect(rows.rows.map((r) => r.seq)).toEqual(['1', '2']);
  }, 15_000);

  it('(b)② counter 行锁仅 per-project 串行：P1 持锁未提交时 P2 业务事务全程无阻塞', async () => {
    await A.query('BEGIN');
    const seqP1 = await allocSeq(A, 'P1');   // P1 计数行被 A 持有，不提交
    expect(seqP1).toBe(3n);   // 承 (b)①：P1 lastSeq=2 后继续

    // B（P2）完整业务事务：业务行→counter→事件行——A 持 P1 计数行未提交期间无阻塞完成提交
    let bDoneTs = 0;
    const t0 = Date.now();
    const bTx = (async () => {
      await B.query('BEGIN');
      await B.query(`UPDATE ${SCHEMA}.business_row SET payload = 'p2' WHERE id = 'r2'`);
      const seq = await allocSeq(B, 'P2');
      await B.query(`INSERT INTO ${SCHEMA}.feed_event ("projectId", seq, payload) VALUES ('P2', $1, 'evP2')`, [seq.toString()]);
      await B.query('COMMIT');
      bDoneTs = Date.now();
      return seq;
    })();
    const seqP2 = await bTx;
    const elapsed = Date.now() - t0;
    expect(seqP2).toBe(1n);
    // 结构保证=程序序（bDoneTs 在 A 的 COMMIT 发出前捕获，见下断言）；时间界只是防「意外跨项目锁」的粗栅栏
    // （宽松 5s——真被 P1 行锁挡住也会在 A 提交后放行，量级 ms，5s 只拦环境性挂起）
    expect(elapsed).toBeLessThan(5_000);

    await A.query('COMMIT');
    const aCommitTs = Date.now();
    // P2 事务完成先于（至多同毫秒于）P1 提交——bDoneTs 在 COMMIT 发出前捕获，JS 序即证据；毫秒戳为佐证
    expect(bDoneTs).toBeLessThanOrEqual(aCommitTs);
  }, 15_000);

  it('(b)③ 锁序反例：counter 先拿+业务行后拿（对向获取）⇒ 40P01 死锁复现', async () => {
    // deadlock_timeout 是 superuser GUC（本库用户非超级用户）——尝试收紧失败则按库默认 1s 等
    for (const cl of [A, B]) { try { await cl.query(`SET deadlock_timeout TO '100ms'`); } catch { /* 非 superuser：库默认 1000ms */ } }

    await A.query('BEGIN');
    await A.query(`UPDATE ${SCHEMA}.business_row SET payload = 't1' WHERE id = 'r1'`);   // T1 持业务行 r1
    await B.query('BEGIN');
    await B.query(`UPDATE ${SCHEMA}.feed_counter SET "lastSeq" = "lastSeq" + 1 WHERE "projectId" = 'P1' RETURNING "lastSeq"`);   // T2 持 counter

    // 对向获取：T1 再拿 counter（阻塞）、T2 再拿业务行 r1（阻塞）⇒ 环
    const asPgErr = (x: unknown): { code?: string } | null => (x instanceof Error ? (x as Error & { code?: string }) : null);
    const t1Cross = A.query(`UPDATE ${SCHEMA}.feed_counter SET "lastSeq" = "lastSeq" + 1 WHERE "projectId" = 'P1'`).catch((e: unknown) => e);
    expect(await waitUntil(() => lockWaiters().then((n) => n >= 1))).toBe(true);
    const t2Cross = B.query(`UPDATE ${SCHEMA}.business_row SET payload = 't2' WHERE id = 'r1'`).catch((e: unknown) => e);

    const [r1, r2] = await Promise.all([t1Cross, t2Cross]);
    const codes = [asPgErr(r1)?.code, asPgErr(r2)?.code];
    // 恰一方被 PG 死锁检测器选为牺牲者（40P01）；另一方随后解除阻塞
    expect(codes.filter((c) => c === '40P01')).toHaveLength(1);

    // 幸存方此刻已解除阻塞——显式回滚收尾（受害者已被 PG 中止）
    await A.query('ROLLBACK').catch(() => undefined);
    await B.query('ROLLBACK').catch(() => undefined);
  }, 20_000);

  it('(b)③ 锁序契约正例：业务行→counter（counter 最后拿）⇒ 无死锁且序≡提交序', async () => {
    // T2 先抢业务行 r1 但拿不到（T1 持有）——T2 在「持零锁」状态下等待 ⇒ 无环
    await A.query('BEGIN');
    await A.query(`UPDATE ${SCHEMA}.business_row SET payload = 'g1' WHERE id = 'r1'`);

    let t2BusinessDone = false;
    const t2 = (async () => {
      await B.query('BEGIN');
      await B.query(`UPDATE ${SCHEMA}.business_row SET payload = 'g2' WHERE id = 'r1'`);   // 阻塞至 T1 提交
      t2BusinessDone = true;
      const seq = await allocSeq(B, 'P1');   // T1 已提交 ⇒ counter 空闲——业务行→counter 统一序无环
      await B.query(`INSERT INTO ${SCHEMA}.feed_event ("projectId", seq, payload) VALUES ('P1', $1, 'evT2')`, [seq.toString()]);
      await B.query('COMMIT');
      return seq;
    })();
    expect(await waitUntil(() => lockWaiters().then((n) => n >= 1))).toBe(true);

    const seqA = await allocSeq(A, 'P1');   // T1 补 counter（最后拿）——不被 T2 挡（T2 持零锁）
    await A.query(`INSERT INTO ${SCHEMA}.feed_event ("projectId", seq, payload) VALUES ('P1', $1, 'evT1')`, [seqA.toString()]);
    await A.query('COMMIT');

    const seqB = await t2;
    expect(t2BusinessDone).toBe(true);
    expect(seqB).toBe(seqA + 1n);   // T2 拿到号必在 T1 提交之后 ⇒ 序≡提交序
    const rows = await R.query(`SELECT payload FROM ${SCHEMA}.feed_event WHERE "projectId" = 'P1' AND seq >= $1 ORDER BY seq`, [seqA.toString()]);
    expect(rows.rows.map((r) => r.payload)).toEqual(['evT1', 'evT2']);
  }, 15_000);

  it('(b)④ counter 事务 abort ⇒ 取号随事务回滚回收（无害——与裸 sequence 倒挂对照）', async () => {
    await A.query('BEGIN');
    const burned = await allocSeq(A, 'P2');   // 取号后放弃
    await A.query('ROLLBACK');                // lastSeq 增量随事务回滚——burned 不占用
    expect(burned).toBe(2n);                  // P2 承 (b)② 的 1 之后

    // 同项目随后正常分配：无洞无倒挂（counter 回收号；即便某形态产生空洞也无害——游标按「已提交可见集」推进）
    const seqC = await allocSeq(C, 'P2');
    await C.query(`INSERT INTO ${SCHEMA}.feed_event ("projectId", seq, payload) VALUES ('P2', $1, 'evC')`, [seqC.toString()]);
    expect(seqC).toBe(2n);                    // 回滚即回收——counter 方案连空洞都不留（对比：sequence 不回收）

    // 游标从 0 起步：已提交行全量可见（「count==max」前缀性质在该历史下成立）
    const fin = await R.query<{ mx: string | null; n: string }>(
      `SELECT max(seq) AS mx, count(*)::text AS n FROM ${SCHEMA}.feed_event WHERE "projectId" = 'P2'`,
    );
    expect(BigInt(fin.rows[0].n)).toBe(BigInt(fin.rows[0].mx!));
    expect(fin.rows[0].mx).toBe('2');
  }, 15_000);
});
