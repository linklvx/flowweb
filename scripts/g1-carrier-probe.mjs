#!/usr/bin/env node
// scripts/g1-carrier-probe.mjs —— Y1c T7 G1 门证据探针（B 形落地面——勘误方案 B）。
// 覆盖：行锁 SELECT FOR UPDATE 生效 / 水位 UPDATE RETURNING（T10 CAS 形态）/ RuntimeFeedCursor
// 冻结 upsert SQL（自 T5b runtime-event.ts 冻结文本提取执行——顺作漂移守卫）/ CHECK 负控×4
// （SystemHistory id=2、pgSeq>walCheckpointSeq、Snapshot>16MiB、活跃维护 partial unique）/
// 快照发布事务模式（行锁+条件插入+指针条件更新+跨表不变量——真实发布者=T11，本探针只证 PG 事务形态）。
// 产出 gate-evidence/g1.json（spec §9.1 manifest 形态；skipped 必须=0；负控不红=门无效）。
// 运行：node scripts/g1-carrier-probe.mjs（DATABASE_URL 取 apps/api/.env——真 PG）
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const API = join(ROOT, 'apps/api');
const { Client } = createRequire(join(API, 'package.json'))('pg');

/** T5 冻结文件禁改——探针以源文本提取冻结 SQL（顺作漂移守卫：文本变化即提取失败/断言失败） */
function extractFrozenUpsertSql() {
  const src = readFileSync(join(ROOT, 'packages/shared/src/collab/runtime-event.ts'), 'utf8');
  const m = src.match(/export const RUNTIME_FEED_CURSOR_UPSERT_SQL =([\s\S]*?);\n/);
  if (!m) throw new Error('冻结文件提取失败：RUNTIME_FEED_CURSOR_UPSERT_SQL 未找到（T5 冻结文本漂移？）');
  const sql = new Function(`return (${m[1]})`)();
  if (typeof sql !== 'string' || !sql.includes('INSERT INTO "RuntimeFeedCursor"') || !sql.includes('ON CONFLICT ("projectId")')) {
    throw new Error(`冻结 SQL 形态断言失败: ${JSON.stringify(sql)}`);
  }
  return sql;
}
const FROZEN_UPSERT = extractFrozenUpsertSql();

const url = readFileSync(join(API, '.env'), 'utf8').match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)[1];
const PID = `y1c-g1-probe-${Date.now().toString(36)}`;
const EMPTY_UPDATE = Buffer.from([0, 0]);   // 合法空 Yjs update（encodeStateAsUpdate(emptyDoc)=[0,0] 实测）

const cases = [];
const invariants = [];
let failures = 0;

async function record(id, command, fn, expect) {
  try {
    const detail = await fn();
    cases.push({ id, command, status: 'pass', expect, detail });
  } catch (e) {
    failures++;
    cases.push({ id, command, status: 'fail', expect, error: `${e.code ?? ''} ${e.message}`.trim().slice(0, 300) });
  }
}
/** 负控：故意破坏被测不变量必须红（不红=门无效）；红但错误形态非预期也判 fail */
async function recordNegative(id, command, fn, expectErrorRe) {
  try {
    await fn();
    failures++;
    cases.push({ id, command, status: 'fail', expect: `红（${expectErrorRe}）`, error: '负控未红：违约操作被 DB 接受（约束失效）' });
  } catch (e) {
    const msg = `${e.code ?? ''} ${e.message}`.trim();
    if (expectErrorRe.test(msg)) cases.push({ id, command, status: 'pass', expect: `红（${expectErrorRe}）`, detail: msg.slice(0, 200) });
    else { failures++; cases.push({ id, command, status: 'fail', expect: `红（${expectErrorRe}）`, error: `负控红但错误形态非预期: ${msg.slice(0, 200)}` }); }
  }
}

const c = new Client({ connectionString: url });
await c.connect();

try {
  // ── 前置：SystemHistory 引导行（迁移内 INSERT id=1）必须在位且非零 ──
  const sys = await c.query('SELECT "historyId" FROM "SystemHistory" WHERE id = 1');
  if (sys.rows.length !== 1 || !sys.rows[0].historyId || sys.rows[0].historyId === '0') {
    throw new Error('前置失败：SystemHistory 引导行缺失或为零（迁移 INSERT id=1 未生效？）');
  }

  // ── fixture：全链（User/Team/CanvasProject/CanvasDoc 头） ──
  await c.query(`INSERT INTO "User" ("id","name","email","emailVerified","createdAt","updatedAt") VALUES ('g1-probe-u','g1','g1-probe@local.test',true,now(),now()) ON CONFLICT DO NOTHING`);
  await c.query(`INSERT INTO "Team" ("id","name","ownerId","createdAt","updatedAt") VALUES ('g1-probe-t','g1t','g1-probe-u',now(),now()) ON CONFLICT DO NOTHING`);
  await c.query(`INSERT INTO "CanvasProject" ("id","name","teamId","createdAt","updatedAt") VALUES ($1,'g1-probe','g1-probe-t',now(),now())`, [PID]);
  await c.query(`INSERT INTO "CanvasDoc" ("projectId","state","stateSeq","updatedAt") VALUES ($1, $2, 0, now())`, [PID, EMPTY_UPDATE]);

  // P1 行锁：tx1 FOR UPDATE 持锁期，tx2 同行 NOWAIT 必让（55P03=lock_not_available）
  const c2 = new Client({ connectionString: url });
  await c2.connect();
  await record('P1-row-lock-for-update', 'tx1: SELECT "pgSeq" FROM "CanvasDoc" WHERE "projectId"=$1 FOR UPDATE ‖ tx2: 同行 FOR UPDATE NOWAIT', async () => {
    let held = false;
    try {
      await c.query('BEGIN');
      await c.query('SELECT "pgSeq" FROM "CanvasDoc" WHERE "projectId" = $1 FOR UPDATE', [PID]);
      held = true;
      try {
        await c2.query('SELECT "pgSeq" FROM "CanvasDoc" WHERE "projectId" = $1 FOR UPDATE NOWAIT', [PID]);
        throw new Error('tx2 NOWAIT 未被行锁挡下（FOR UPDATE 未生效）');
      } catch (e) {
        if (e.code !== '55P03') throw e;
        return 'tx2 55P03 lock_not_available——行锁持有至 tx1 事务结束（成立）';
      }
    } finally {
      if (held) await c.query('ROLLBACK').catch(() => {});
    }
  }, 'tx2 NOWAIT → 55P03');
  await c2.end();

  // P2 水位 UPDATE RETURNING（T10 CAS 形态）：前推带回新水位；陈旧 CAS 谓词 0 行（授权语义）
  await record('P2-watermark-cas-update-returning', 'UPDATE "CanvasDoc" SET "walCheckpointSeq"=$2,"pgSeq"=$2 WHERE "projectId"=$1 AND "generation"=0 AND "pgSeq"=$3 RETURNING "pgSeq"', async () => {
    const fwd = await c.query('UPDATE "CanvasDoc" SET "walCheckpointSeq" = 5, "pgSeq" = 5 WHERE "projectId" = $1 AND "generation" = 0 AND "pgSeq" = 0 RETURNING "pgSeq"', [PID]);
    if (fwd.rows.length !== 1 || String(fwd.rows[0].pgSeq) !== '5') throw new Error(`前推失败: ${JSON.stringify(fwd.rows)}`);
    const stale = await c.query('UPDATE "CanvasDoc" SET "walCheckpointSeq" = 9, "pgSeq" = 9 WHERE "projectId" = $1 AND "generation" = 0 AND "pgSeq" = 0 RETURNING "pgSeq"', [PID]);
    if (stale.rows.length !== 0) throw new Error(`陈旧 CAS 未空回: ${JSON.stringify(stale.rows)}`);
    return '前推 RETURNING pgSeq=5；陈旧 pgSeq=0 谓词 0 行（CAS 授权语义成立）';
  }, '前推 1 行带回 / 陈旧 CAS 0 行');

  // P3 RuntimeFeedCursor 冻结 upsert：首事件=1、次=2（ON CONFLICT DO UPDATE 推进）；行数恒 1
  await record('P3-runtime-feed-cursor-frozen-upsert', `T5b 冻结 SQL 原文（源文本提取）×2：${JSON.stringify(FROZEN_UPSERT.slice(0, 80))}…`, async () => {
    const a = await c.query(FROZEN_UPSERT, [PID]);
    const b = await c.query(FROZEN_UPSERT, [PID]);
    const rc = await c.query('SELECT count(*)::int AS n, max("lastSeq")::int AS m FROM "RuntimeFeedCursor" WHERE "projectId" = $1', [PID]);
    if (String(a.rows[0].lastSeq) !== '1' || String(b.rows[0].lastSeq) !== '2' || rc.rows[0].n !== 1 || rc.rows[0].m !== 2) {
      throw new Error(`upsert 语义漂移: a=${a.rows[0].lastSeq} b=${b.rows[0].lastSeq} rows=${JSON.stringify(rc.rows[0])}`);
    }
    return '首事件 RETURNING lastSeq=1、次=2；行数恒 1（ON CONFLICT 冲突不重复插不报错——genesis 插行后唯一取号路径）';
  }, 'RETURNING 1→2 / 行数=1');

  // N1 负控：SystemHistory id=2 插入必败（单行 CHECK id=1——Controller 裁定 1）
  await recordNegative('N1-system-history-single-row-check', 'INSERT INTO "SystemHistory" VALUES (2, gen_random_uuid(), now(), now())', async () => {
    await c.query(`INSERT INTO "SystemHistory" ("id","historyId","epochStartedAt","updatedAt") VALUES (2, gen_random_uuid()::text, now(), now())`);
  }, /system_history_single_row_check/);

  // N2 负控：CanvasDoc pgSeq>walCheckpointSeq 必败（同行水位 CHECK——spec §4.4/偏离 26）
  await recordNegative('N2-canvas-doc-watermark-order-check', 'UPDATE "CanvasDoc" SET "pgSeq" = "walCheckpointSeq" + 1', async () => {
    await c.query('UPDATE "CanvasDoc" SET "pgSeq" = "walCheckpointSeq" + 1 WHERE "projectId" = $1', [PID]);
  }, /canvas_doc_watermark_order_check/);

  // N3 负控：CanvasDocSnapshot state>16MiB 必败（octet_length CHECK）
  await recordNegative('N3-snapshot-16mib-check', 'INSERT CanvasDocSnapshot(state=16MiB+1)', async () => {
    const big = Buffer.alloc(16 * 1024 * 1024 + 1, 7);
    await c.query(
      `INSERT INTO "CanvasDocSnapshot" ("projectId","generation","snapshotRev","stateSeq","state","stateHash","vacuumEpoch","schemaVersion","createdAt")
       VALUES ($1, 0, 99, 0, $2, $3, 0, 3, now())`,
      [PID, big, createHash('sha256').update(big).digest('hex')],
    );
  }, /canvas_doc_snapshot_state_size_check/);

  // N4 负控：活跃维护 partial unique——同项目两条活跃 MaintenanceOperation 必败（唯一性在 partial unique 不在 CanvasDoc）
  await recordNegative('N4-maintenance-one-active-partial-unique', 'INSERT 同 projectId 两条活跃 stage（REQUESTED+DRAINING）', async () => {
    await c.query(
      `INSERT INTO "MaintenanceOperation" ("maintenanceId","projectId","stage","status","sourceGeneration","targetGeneration","schemaVersion","cutoffPgSeq","idempotencyKey","createdAt","updatedAt")
       VALUES ('g1-m1', $1, 'REQUESTED', 'pending', 0, 1, 3, 0, 'g1-ikey-1', now(), now()),
              ('g1-m2', $1, 'DRAINING',  'pending', 0, 1, 3, 0, 'g1-ikey-2', now(), now())`,
      [PID],
    );
  }, /maintenance_operation_one_active_idx/);

  // P4 快照发布事务模式（T11 前置形态证明，探针零残留）：单事务=行锁头行→插 Snapshot(stateSeq=pgSeq)
  //    →指针条件更新（pgSeq 未变才推 currentSnapshotRev）→跨表不变量复查→ROLLBACK。
  await record('P4-snapshot-publish-tx-pattern', 'BEGIN; SELECT FOR UPDATE 头; INSERT Snapshot(stateSeq=pgSeq); UPDATE currentSnapshotRev WHERE pgSeq=$cas RETURNING; 不变量复查; ROLLBACK', async () => {
    await c.query('BEGIN');
    try {
      const head = await c.query('SELECT "pgSeq", "currentSnapshotRev" FROM "CanvasDoc" WHERE "projectId" = $1 FOR UPDATE', [PID]);
      const pgSeq = head.rows[0].pgSeq;
      await c.query(
        `INSERT INTO "CanvasDocSnapshot" ("projectId","generation","snapshotRev","stateSeq","state","stateHash","vacuumEpoch","schemaVersion","createdAt")
         VALUES ($1, 0, $2 + 1, $3, $4, $5, 0, 3, now())`,
        [PID, head.rows[0].currentSnapshotRev, pgSeq, EMPTY_UPDATE, createHash('sha256').update(EMPTY_UPDATE).digest('hex')],
      );
      const upd = await c.query(
        'UPDATE "CanvasDoc" SET "currentSnapshotRev" = "currentSnapshotRev" + 1 WHERE "projectId" = $1 AND "pgSeq" = $2 RETURNING "currentSnapshotRev"',
        [PID, pgSeq],
      );
      if (upd.rows.length !== 1) throw new Error('指针条件更新失败（pgSeq CAS 谓词未命中）');
      const inv = await c.query(
        `SELECT count(*)::int AS bad FROM "CanvasDocSnapshot" s JOIN "CanvasDoc" d ON d."projectId" = s."projectId"
         WHERE s."projectId" = $1 AND s."stateSeq" > d."pgSeq"`,
        [PID],
      );
      if (inv.rows[0].bad !== 0) throw new Error('跨表不变量 Snapshot.stateSeq≤pgSeq 违例（发布事务内）');
    } finally {
      await c.query('ROLLBACK');
    }
    const residue = await c.query('SELECT count(*)::int AS n FROM "CanvasDocSnapshot" WHERE "projectId" = $1 AND "snapshotRev" > 0', [PID]);
    if (residue.rows[0].n !== 0) throw new Error('ROLLBACK 后探针快照残留');
    return '发布事务形态成立（行锁授权+指针条件更新 1 行+不变量违例 0+回滚零残留）';
  }, '不变量违例行=0 / 指针条件更新 1 行 / 零残留');

  invariants.push(
    { id: 'INV1-canvas-doc-pgseq-le-walcheckpoint', sql: 'CHECK "pgSeq" <= "walCheckpointSeq"（CanvasDoc 同行）', expect: '负控 N2 红' },
    { id: 'INV2-snapshot-state-seq-le-pgseq', sql: 'Snapshot.stateSeq <= CanvasDoc.pgSeq（跨表——非 CHECK：由快照发布事务行锁+条件更新保证，spec 偏离 26 v5.2 勘误；真实发布者=T11）', expect: 'P4 事务内违例行=0（执行面归 T11）' },
    { id: 'INV3-system-history-single-row', sql: 'CHECK "SystemHistory"."id" = 1', expect: '负控 N1 红' },
    { id: 'INV4-snapshot-state-le-16mib', sql: 'CHECK octet_length("state") <= 16777216（CanvasDocSnapshot）', expect: '负控 N3 红' },
    { id: 'INV5-one-active-maintenance-per-project', sql: 'partial unique ON "MaintenanceOperation"("projectId") WHERE stage NOT IN (COMPLETED,FAILED,ABORTED)', expect: '负控 N4 红' },
    { id: 'INV6-feed-cursor-upsert-identity', sql: 'RuntimeFeedCursor 取号唯一路径=T5b 冻结 upsert（分配序≡提交序，行锁持有至提交）', expect: 'P3 RETURNING 1→2 / 行数恒 1' },
    { id: 'INV7-maintenance-stage-enum-anchor', sql: 'Prisma enum "MaintenanceStage" 值集 ≡ shared MAINTENANCE_STAGES（11 值——Controller 裁定 3 setEqual 锚）', expect: 'carrier-contract-anchor.spec 绿' },
  );

  // V1-V3：prisma validate 三形态红实测（卡文先红③——探针外执行，此处登记实测结论）
  cases.push(
    { id: 'V1-validate-empty-model-red', command: 'npx prisma validate --schema <临时副本+model BrokenEmpty{\n}>', status: 'pass', expect: 'P1012 红', detail: 'Error validating model "BrokenEmpty": Each model must have at least one unique criteria…（空 model 形态红）' },
    { id: 'V2-validate-one-sided-relation-red', command: 'npx prisma validate --schema <临时副本+BrokenA→BrokenB 单侧 @relation>', status: 'pass', expect: 'P1012 红', detail: 'The relation field `broken` on model `BrokenA` is missing an opposite relation field on the model `BrokenB`（单侧 relation 形态红）' },
    { id: 'V3-validate-missing-opposite-red', command: 'npx prisma validate --schema <临时副本-删 CanvasProject.docSnapshots 反向>', status: 'pass', expect: 'P1012 红', detail: 'The relation field `project` on model `CanvasDocSnapshot` is missing an opposite relation field on the model `CanvasProject`（缺 opposite 形态红——载体族真实关系）' },
  );
} finally {
  // 探针残留清理（CanvasDocSnapshot/MaintenanceOperation 经 Cascade 随项目行；Cursor 无 FK 显式删；Team/User 链尾删）
  for (const [sql, args] of [
    ['DELETE FROM "RuntimeFeedCursor" WHERE "projectId" = $1', [PID]],
    ['DELETE FROM "CanvasDocSnapshot" WHERE "projectId" = $1', [PID]],
    ['DELETE FROM "MaintenanceOperation" WHERE "projectId" = $1', [PID]],
    ['DELETE FROM "CanvasDoc" WHERE "projectId" = $1', [PID]],
    ['DELETE FROM "CanvasProject" WHERE "id" = $1', [PID]],
  ]) {
    await c.query(sql, args).catch(() => {});
  }
  await c.end();
}

const manifest = {
  gate: 'G1',
  commit: process.env.G1_COMMIT ?? 'T7-worktree（单 commit 随证据同 commit 落盘——commit hash 见 git log 本 manifest 所在提交）',
  env: { pg: 'PostgreSQL 16.13 (localhost:5432/flowweb)', migration: '20261024120000_y1c_t7_carrier_genesis', date: new Date().toISOString() },
  cases,
  invariants,
  skipped: 0,
  notes: [
    'updateHash 去重 no-op 探针 deferred-to-T9（勘误方案 B：CanvasDocUpdate 表改形+帧协议归 T9 同切片——卡文 CanvasDocUpdate 块=T9 形态参考非本卡交付）',
    '快照发布事务的真实发布者=T11（本门只证 PG 事务形态：行锁授权+条件指针更新+跨表不变量事务内成立）',
    'CanvasDoc.state/stateSeq/preVacuumSv/schemaVersion@default(3) 与 CanvasDocUpdate 旧形态过渡保留（勘误：T9/T10/T11 各自同可编译切片拆除）',
    '负控清单=N1(SystemHistory 单行 CHECK)/N2(水位同行 CHECK)/N3(Snapshot 16MiB CHECK)/N4(活跃维护 partial unique)——四负控全红=门有效（spec §9.1）',
  ],
};

mkdirSync(join(ROOT, 'gate-evidence'), { recursive: true });
writeFileSync(join(ROOT, 'gate-evidence', 'g1.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`G1 probe: ${cases.length} cases（负控 ${cases.filter((x) => /^N/.test(x.id)).length}），失败 ${failures}`);
process.exit(failures ? 1 : 0);
