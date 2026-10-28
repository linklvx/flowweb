#!/usr/bin/env node
// scripts/collab-rebuild-gen.mjs
// Y1c T27（spec §6.6）：世代重建 CLI——离线/维护窗单换代入口消费面（MaintenanceOperation 消费）。
//
// ⚠ 前提声明（离线 CLI——collab-renumber-layer.mjs 先例）：**无租约直写被拒**（红②）——
//   运行时校验 CollabLease 行：scope=primary 持有者非空且未过期=api/worker 在写 ⇒ 拒绝退出
//   （exit 1，零 DB 写）；租约行空/过期=停写前提成立，CLI 以自身 owner 写入 MaintenanceOperation
//   .leaseOwner 承载执行者身份（spec「维护执行者=租约持有者」——离线形态=租约空窗持有者）。
//
// 语义（与 api 侧 CollabMaintenanceService 同协议——离线重构面，阶段持久化单源=PG stage）：
//   REQUESTED（行级关闸单事务）→FREEZING/DRAINING/DRAINED（离线=无连接面，in-flight drain 等待）
//   →EXPORTING（DocCodec canonical 导出+hash 审计）→REBUILDING（toReadModel→fillDoc fresh clientID）
//   →SWITCHING（单 PG 事务：advisory lock 同键〔hashtext(pid)——与 vacuumReplace 互斥保险〕+
//   generation++/新代快照 (g+1,rev0) stateSeq=旧代 maxSeq 承接/旧代行同事务整删+stage 写同事务）
//   →VERIFYING（PG 重载 hash 对比 EXPORTING 审计基准）→COMPLETED（maintenanceId 清+audit）。
//   **每 stage 落 PG 后打印 `STAGE <name>`**——kill -9 演练锚（T27 process spec 消费）；
//   `--hold-after <stage>` 在该 stage 持久化后挂起（SIGKILL 演练窗）。重跑=从 PG stage 继续
//   （幂等：SWITCHING 在档且 generation≥target ⇒ roll-forward 只走 VERIFYING→COMPLETED）。
//   FAILED（drain 超时/verify hash 不匹配）=只读维持不自动恢复（红③同律——人工裁定后新行）。
//
// 用法：
//   node scripts/collab-rebuild-gen.mjs --project <projectId> [--drain-budget-ms 30000] [--hold-after REQUESTED|...]
//   node scripts/collab-rebuild-gen.mjs --status --project <projectId>
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireApi = createRequire(path.join(ROOT, 'apps/api/package.json'));
const { Client } = requireApi('pg');
const Y = requireApi('yjs');
const { toReadModel, fillDoc, CANVAS_DOC_SCHEMA_VERSION } = requireApi('@flowweb/shared');

// ── env（apps/api/.env——只取 DATABASE_URL，不打印密码；renumber 先例）──
function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL.replace(/^"|"$/g, '');
  try {
    const env = readFileSync(path.join(ROOT, 'apps/api/.env'), 'utf-8');
    const m = env.match(/^DATABASE_URL=(.*)$/m);
    if (m) return m[1].trim().replace(/^"|"$/g, '');
  } catch { /* .env 缺席=显式失败 */ }
  throw new Error('DATABASE_URL 未配置（apps/api/.env 或环境变量）');
}

// ── 租约判定（纯函数——node:test 消费面；红②：持有者在且未过期=拒）──
export function decideLeaseVerdict(leaseRow, nowMs) {
  if (leaseRow == null) return { ok: true, reason: 'no-lease-row' };   // 行缺失=停写前提成立
  if (leaseRow.owner == null || leaseRow.owner === '') return { ok: true, reason: 'no-holder' };
  if (leaseRow.expiresAtMs != null && leaseRow.expiresAtMs <= nowMs) {
    return { ok: true, reason: 'expired', holder: leaseRow.owner };   // 过期持有=旧实例已死（TTL 语义）
  }
  return { ok: false, reason: 'held', holder: leaseRow.owner };
}

const TERMINAL = ['COMPLETED', 'FAILED', 'ABORTED'];

async function q1(client, sql, params) {
  const r = await client.query(sql, params);
  return r.rows;
}

async function readLeaseRow(client) {
  const r = await q1(client, `SELECT owner, "expiresAt" FROM "CollabLease" WHERE scope = 'primary'`);
  const row = r[0] ?? null;
  if (row == null) return null;
  return { owner: row.owner, expiresAtMs: row.expiresAt == null ? null : new Date(row.expiresAt).getTime() };
}

async function countInFlight(client, projectId) {
  const r = await q1(client, `
    SELECT (
      (SELECT COUNT(*) FROM "GenerationIntent" gi WHERE gi."projectId" = $1 AND gi.status IN ('RUNNING','UNKNOWN'))
      + (SELECT COUNT(*) FROM "ExecutionNodePlan" p JOIN "ExecutionRequest" rr ON rr.id = p."requestId"
          WHERE rr."projectId" = $1 AND rr.state IN ('ADMITTED','EXECUTING') AND p.status IN ('PENDING','EXECUTING'))
      + (SELECT COUNT(*) FROM "ExecutionOutbox" o WHERE o."projectId" = $1 AND o.state = 'PENDING')
      + (SELECT COUNT(*) FROM "MaterializeRun" m WHERE m."projectId" = $1 AND m.state = 'RUNNING')
      + (SELECT COUNT(*) FROM "RefundObligation" ro WHERE ro.state = 'PENDING' AND ro."intentRowId" IN
          (SELECT id FROM "GenerationIntent" WHERE "projectId" = $1))
    )::int AS n`, [projectId]);
  return r[0].n;
}

/** 装载行→records（快照+增量尾重放 toReadModel——api recordsOfHydration 同源）。 */
function recordsOfHydration(hydrate) {
  const doc = new Y.Doc();
  try {
    if (hydrate.state) Y.applyUpdate(doc, new Uint8Array(hydrate.state));
    for (const u of hydrate.updates) Y.applyUpdate(doc, new Uint8Array(u));
    return toReadModel(doc);
  } finally { doc.destroy(); }
}

async function loadHydration(client, projectId) {
  const head = await q1(client, 'SELECT generation, "currentSnapshotRev" FROM "CanvasDoc" WHERE "projectId" = $1', [projectId]);
  if (head.length === 0) throw new Error(`CanvasDoc 头行缺失（projectId=${projectId}——懒建档项目无 doc 态可维护）`);
  const g = head[0].generation;
  const rev = head[0].currentSnapshotRev;
  const snap = await q1(client, 'SELECT "stateSeq", state FROM "CanvasDocSnapshot" WHERE "projectId" = $1 AND generation = $2 AND "snapshotRev" = $3', [projectId, g, rev]);
  const stateSeq = snap[0] ? BigInt(snap[0].stateSeq) : 0n;
  const updates = [];
  let cursor = stateSeq;
  for (;;) {
    const page = await q1(client, 'SELECT seq, update FROM "CanvasDocUpdate" WHERE "projectId" = $1 AND seq > $2 ORDER BY seq ASC LIMIT 500', [projectId, cursor]);
    if (page.length === 0) break;
    for (const r of page) updates.push(r.update);
    cursor = page[page.length - 1].seq;
    if (page.length < 500) break;
  }
  return { state: snap[0] ? snap[0].state : null, updates, stateSeq, generation: Number(g) };
}

async function main() {
  const args = process.argv.slice(2);
  const get = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
  const projectId = get('project');
  const holdAfter = get('hold-after');
  const drainBudgetMs = Number(get('drain-budget-ms') ?? 30_000);
  if (!projectId) { console.error('用法：node scripts/collab-rebuild-gen.mjs --project <projectId> [--hold-after <stage>] [--drain-budget-ms n] | --status --project <pid>'); process.exit(2); }

  const client = new Client({ connectionString: loadDatabaseUrl() });
  await client.connect();
  try {
    // ── 红② 租约前置：无租约直写被拒（持有者在=api 在写——零 DB 写退出）──
    const verdict = decideLeaseVerdict(await readLeaseRow(client), Date.now());
    if (!verdict.ok) {
      console.error(`REFUSED lease-held: CollabLease 持有者 ${verdict.holder} 在写（api/worker 活动中）——离线直写被拒；先停写进程或经 REST 维护面（POST /api/collab/maintenance/${projectId}/start）执行`);
      process.exit(1);
    }
    console.log(`lease verdict: ${verdict.reason}${verdict.holder ? `（前持有者 ${verdict.holder}——已过期）` : ''}`);

    if (args.includes('--status')) {
      const ops = await q1(client, 'SELECT "maintenanceId", stage, status, attempt, "sourceGeneration", "targetGeneration", error, "createdAt" FROM "MaintenanceOperation" WHERE "projectId" = $1 ORDER BY "createdAt" DESC LIMIT 5', [projectId]);
      console.log(JSON.stringify(ops, (k, v) => (typeof v === 'bigint' ? String(v) : v), 2));
      return;
    }

    const leaseOwner = `cli-rebuild-${randomUUID().slice(0, 8)}`;
    let maintenanceId = null;
    // ── 幂等续跑：ACTIVE 行在档=接续（重启从 PG stage 继续）；否则 REQUESTED（行级关闸单事务）──
    const active = await q1(client, `SELECT "maintenanceId", stage FROM "MaintenanceOperation" WHERE "projectId" = $1 AND stage NOT IN ('COMPLETED','FAILED','ABORTED') LIMIT 1`, [projectId]);
    if (active.length > 0) {
      maintenanceId = active[0].maintenanceId;
      console.log(`resume: ${maintenanceId}（stage=${active[0].stage}——从 PG stage 继续）`);
    } else {
      const id = `mt-${randomUUID()}`;
      await client.query('BEGIN');
      try {
        const gated = await q1(client, 'UPDATE "CanvasDoc" SET "maintenanceId" = $2, "updatedAt" = now() WHERE "projectId" = $1 AND "maintenanceId" IS NULL RETURNING "maintenanceId", generation, "pgSeq", "schemaVersion"', [projectId, id]);
        if (gated.length === 0) {
          const head = await q1(client, 'SELECT "maintenanceId" FROM "CanvasDoc" WHERE "projectId" = $1', [projectId]);
          if (head.length === 0) throw new Error('CANVAS_DOC_MISSING（懒建档项目——无 doc 态可维护）');
          throw new Error(`MAINTENANCE_ACTIVE（maintenanceId=${head[0].maintenanceId}——头行关闸在）`);
        }
        const generation = Number(gated[0].generation);
        await client.query(
          `INSERT INTO "MaintenanceOperation" ("maintenanceId", "projectId", stage, status, attempt, "sourceGeneration", "targetGeneration", "schemaVersion", "cutoffPgSeq", "idempotencyKey", "leaseOwner", "createdAt", "updatedAt")
           VALUES ($1, $2, 'REQUESTED', 'ACTIVE', 0, $3, $4, $5, $6, $7, $8, now(), now())`,
          [id, projectId, generation, generation + 1, gated[0].schemaVersion ?? CANVAS_DOC_SCHEMA_VERSION, gated[0].pgSeq, `cli-${randomUUID()}`, leaseOwner],
        );
        await client.query(
          `INSERT INTO "DocAuditEvent" (id, "projectId", kind, "userId", "requestId", payload, "createdAt")
           VALUES ($1, $2, 'maintenance', 'cli-rebuild-gen', $3, $4::jsonb, now())`,
          [randomUUID(), projectId, id, JSON.stringify({ stage: 'REQUESTED', source: 'cli', sourceGeneration: generation, targetGeneration: generation + 1 })],
        );
        await client.query('COMMIT');
        maintenanceId = id;
      } catch (e) { await client.query('ROLLBACK'); throw e; }
      console.log('STAGE REQUESTED');
      if (holdAfter === 'REQUESTED') { console.log('HOLDING REQUESTED'); await new Promise(() => {}); }
    }

    const opRow = (await q1(client, 'SELECT stage, "sourceGeneration", "targetGeneration" FROM "MaintenanceOperation" WHERE "maintenanceId" = $1', [maintenanceId]))[0];
    const sourceGeneration = Number(opRow.sourceGeneration);
    const targetGeneration = Number(opRow.targetGeneration);
    const hold = async (stage) => { console.log(`STAGE ${stage}`); if (holdAfter === stage) { console.log(`HOLDING ${stage}`); await new Promise(() => {}); } };
    const setStage = async (to, from) => {
      await client.query('UPDATE "MaintenanceOperation" SET stage = $2, status = \'ACTIVE\', attempt = attempt + 1, "updatedAt" = now() WHERE "maintenanceId" = $1 AND stage = $3', [maintenanceId, to, from]);
      await hold(to);
    };

    let stage = opRow.stage;
    // FREEZING/DRAINING/DRAINED：离线=无连接面（freeze close/常驻释放归 api 进程形态）；drain=in-flight 等待
    if (stage === 'REQUESTED') { await setStage('FREEZING', 'REQUESTED'); stage = 'FREEZING'; }
    if (stage === 'FREEZING') { await setStage('DRAINING', 'FREEZING'); stage = 'DRAINING'; }
    if (stage === 'DRAINING') {
      const deadline = Date.now() + drainBudgetMs;
      for (;;) {
        const n = await countInFlight(client, projectId);
        if (n === 0) break;
        if (Date.now() >= deadline) {
          await client.query('UPDATE "MaintenanceOperation" SET stage = \'FAILED\', status = \'FAILED\', error = $2, attempt = attempt + 1 WHERE "maintenanceId" = $1', [maintenanceId, `DRAINING: drain-timeout（in-flight=${n} 未收敛——预算耗尽，保持只读人工处置）`]);
          console.error(`FAILED drain-timeout（in-flight=${n}）——只读维持；处置=等在飞终态后重跑（新 operation 行）`);
          process.exit(1);
        }
        await new Promise((r) => setTimeout(r, Math.min(1_000, Math.max(20, deadline - Date.now()))));
      }
      await setStage('DRAINED', 'DRAINING'); stage = 'DRAINED';
    }
    if (stage === 'DRAINED') { await setStage('EXPORTING', 'DRAINED'); stage = 'EXPORTING'; }

    let hydrate = null;
    let updateRowCount = 0;
    if (stage === 'EXPORTING') {
      hydrate = await loadHydration(client, projectId);
      const records = recordsOfHydration(hydrate);
      const exportHash = createHash('sha256').update(JSON.stringify({ nodes: records.nodes, edges: records.edges })).digest('hex');
      updateRowCount = hydrate.updates.length;
      await client.query(
        `INSERT INTO "DocAuditEvent" (id, "projectId", kind, "userId", "requestId", payload, "createdAt")
         VALUES ($1, $2, 'maintenance', 'cli-rebuild-gen', $3, $4::jsonb, now())`,
        [randomUUID(), projectId, maintenanceId, JSON.stringify({ stage: 'EXPORTING', exportHash, nodeCount: records.nodes.length, edgeCount: records.edges.length })],
      );
      await setStage('REBUILDING', 'EXPORTING'); stage = 'REBUILDING';
    }
    if (stage === 'REBUILDING' || stage === 'SWITCHING') {
      // 已提交检出（SWITCHING 在档且 generation≥target ⇒ roll-forward——跳重切只走 VERIFYING）
      const head = await q1(client, 'SELECT generation FROM "CanvasDoc" WHERE "projectId" = $1', [projectId]);
      const committed = head.length > 0 && Number(head[0].generation) >= targetGeneration;
      if (!committed && stage === 'REBUILDING') {
        // rebuild payload（canonical）：fresh clientID 重放 records 真值（toReadModel→fillDoc）
        hydrate = await loadHydration(client, projectId);
        updateRowCount = hydrate.updates.length;
        const records = recordsOfHydration(hydrate);
        const fresh = new Y.Doc();
        try {
          // DocLike 适配（api doc-like.util 同款——fillDoc 容器物化工厂族全给）
          const docLike = {
            getMap: (k) => fresh.getMap(k),
            createMap: () => new Y.Map(),
            createText: () => new Y.Text(),
            createXmlFragment: () => new Y.XmlFragment(),
            createXmlElement: (name) => new Y.XmlElement(name),
            createXmlText: () => new Y.XmlText(),
            createArray: () => new Y.Array(),
          };
          fillDoc(docLike, records.nodes, records.edges);
          const state = Buffer.from(Y.encodeStateAsUpdate(fresh));
          // ── SWITCHING 单 PG 事务（advisory lock 同键+行集漂移守卫+新代快照 stateSeq=旧代 maxSeq 承接+stage 写同事务）──
          await client.query('BEGIN');
          try {
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [projectId]);
            const liveRows = await q1(client, 'SELECT seq FROM "CanvasDocUpdate" WHERE "projectId" = $1 ORDER BY seq ASC', [projectId]);
            if (liveRows.length !== updateRowCount) throw Object.assign(new Error('增量行集在锁内漂移（读后有并发写——中止重试）'), { vacuumRowsDrifted: true });
            const locked = await q1(client, 'SELECT generation, "schemaVersion", "vacuumEpoch" FROM "CanvasDoc" WHERE "projectId" = $1', [projectId]);
            if (Number(locked[0].generation) !== sourceGeneration) throw Object.assign(new Error(`generation drift（锁内 ${locked[0].generation}≠${sourceGeneration}——并发换代窗）`), { vacuumRowsDrifted: true });
            const maxSeq = liveRows.length > 0 ? BigInt(liveRows[liveRows.length - 1].seq) : hydrate.stateSeq;
            const vacuumEpoch = Number(locked[0].vacuumEpoch) + 1;
            const schemaVersion = locked[0].schemaVersion ?? CANVAS_DOC_SCHEMA_VERSION;
            await client.query(
              `INSERT INTO "CanvasDocSnapshot" ("projectId", generation, "snapshotRev", "stateSeq", state, "stateHash", "vacuumEpoch", "schemaVersion", "createdAt")
               VALUES ($1, $2, 0, $3, $4, $5, $6, $7, now()) ON CONFLICT DO NOTHING`,
              [projectId, targetGeneration, maxSeq.toString(), state, createHash('sha256').update(state).digest('hex'), vacuumEpoch, schemaVersion],
            );
            await client.query(
              `INSERT INTO "CanvasDoc" ("projectId", generation, "schemaVersion", "vacuumEpoch", "updatedAt")
               VALUES ($1, $2, $3, $4, now()) ON CONFLICT ("projectId") DO UPDATE SET generation = $2, "vacuumEpoch" = $4, "currentSnapshotRev" = 0, "purgeBelowSeq" = NULL, "updatedAt" = now()`,
              [projectId, targetGeneration, schemaVersion, vacuumEpoch],
            );
            await client.query('DELETE FROM "CanvasDocUpdate" WHERE "projectId" = $1', [projectId]);
            await client.query(`UPDATE "MaintenanceOperation" SET stage = 'SWITCHING', attempt = attempt + 1, "updatedAt" = now() WHERE "maintenanceId" = $1 AND stage = 'REBUILDING'`, [maintenanceId]);
            await client.query('COMMIT');
          } catch (e) { await client.query('ROLLBACK'); throw e; }
          await hold('SWITCHING');
        } finally { fresh.destroy(); }
      } else if (committed) {
        console.log('roll-forward: SWITCHING 已提交（generation≥target）');
      }
      stage = 'SWITCHING';
    }
    if (stage === 'SWITCHING' || stage === 'VERIFYING') {
      // VERIFYING：stage 落档（SWITCHING→VERIFYING——已 VERIFYING 续跑=no-op）→PG 重载→hash 对比
      if (stage === 'SWITCHING') {
        await client.query(`UPDATE "MaintenanceOperation" SET stage = 'VERIFYING', attempt = attempt + 1, "updatedAt" = now() WHERE "maintenanceId" = $1 AND stage = 'SWITCHING'`, [maintenanceId]);
        await hold('VERIFYING');
      }
      const audit = await q1(client, `SELECT payload FROM "DocAuditEvent" WHERE "requestId" = $1 AND kind = 'maintenance' ORDER BY "createdAt" DESC LIMIT 5`, [maintenanceId]);
      const exportRow = audit.map((r) => r.payload).find((p) => p?.stage === 'EXPORTING');
      const reloaded = await loadHydration(client, projectId);
      const actual = createHash('sha256').update(JSON.stringify(recordsOfHydration(reloaded))).digest('hex');
      if (exportRow?.exportHash != null && exportRow.exportHash !== actual) {
        await client.query('UPDATE "MaintenanceOperation" SET stage = \'FAILED\', status = \'FAILED\', error = $2, attempt = attempt + 1 WHERE "maintenanceId" = $1', [maintenanceId, `VERIFYING: export hash mismatch（expected ${exportRow.exportHash} got ${actual}）`]);
        console.error('FAILED verify-hash-mismatch——只读维持（人工裁定：清障后重跑新 operation 行）');
        process.exit(1);
      }
      await client.query('BEGIN');
      try {
        await client.query(`UPDATE "MaintenanceOperation" SET stage = 'COMPLETED', status = 'COMPLETED', "updatedAt" = now() WHERE "maintenanceId" = $1 AND stage = 'VERIFYING'`, [maintenanceId]);
        await client.query('UPDATE "CanvasDoc" SET "maintenanceId" = NULL WHERE "projectId" = $1 AND "maintenanceId" = $2', [projectId, maintenanceId]);
        await client.query(
          `INSERT INTO "DocAuditEvent" (id, "projectId", kind, "userId", "requestId", payload, "createdAt")
           VALUES ($1, $2, 'maintenance', 'cli-rebuild-gen', $3, $4::jsonb, now())`,
          [randomUUID(), projectId, maintenanceId, JSON.stringify({ stage: 'COMPLETED', generation: targetGeneration })],
        );
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; }
      console.log('STAGE COMPLETED');
      console.log(`OK generation ${sourceGeneration}->${targetGeneration}（maintenanceId=${maintenanceId}）`);
      return;
    }
    if (TERMINAL.includes(stage)) { console.log(`terminal: ${stage}（无续跑面——FAILED=人工裁定后新行；COMPLETED/ABORTED=终态）`); return; }
    throw new Error(`unreachable stage ${stage}`);
  } finally {
    await client.end().catch(() => {});
  }
}

// node:test 消费面（decideLeaseVerdict 纯函数——scripts-node-test 池）；CLI 主入口仅直接执行时跑
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`ERROR ${e.message}`); process.exit(1); });
}
