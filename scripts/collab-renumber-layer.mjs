#!/usr/bin/env node
// scripts/collab-renumber-layer.mjs
// T18（plan v11.2 S5 片·spec Z4''-v14/:77）：离线/维护窗层键重排 CLI——幂等，不承诺永久无重复。
//
// ⚠ 前提声明（离线/维护窗）：运行前须停 api/worker 进程（进程停写前提——并发写与重排写回竞态
// 不在本工具承诺面；在线 repair 已整建制删除〔G53 grep 零命中门禁〕，读序 (order,id)/(slot,id)
// 双 tie-break 容忍重复键——本 CLI=质量优化非正确性需求）。
//
// 语义（规划单源=shared planRenumberLayers——本 CLI 只做 IO 编排，禁本地重实现判定）：
//   - 按层 (order,id) 现序全量重排为带间隙整键（5000/5100/…）；slot 域不动（分镜格位整值已紧凑）；
//   - 跨层旧键（入组/出组携带）一并重排；重复键容忍分键；缺键/非法键成员同样获得合法新键；
//   - 幂等：再跑零变更（同键零写——diff 编码空则零行插入）。
//
// 写回路径裁定（「最窄正确」——与 repo append/vacuum 两形态对选）：
//   ✓ **diff 追加单事务**：对重排后 doc 以旧 doc SV 做 Y.encodeStateAsUpdate(newDoc, svOld) 差分
//     编码，单事务内 pg_advisory_xact_lock(hashtext(projectId))〔与 append/compact 同锁键——seq
//     序≡提交序〕+ INSERT CanvasDocUpdate 一行（nextval 同一序列）。追加流不动 state 列/不删行/
//     不碰 generation（代际跳变会把离线复活风险常态化——spec Z4''-v13 裁决①）；重放装载路径
//     天然消费（append-only 语义保持，canvas-doc-insert-ratchet 静态断言面不破坏——该断言锁
//     api 进程 repo 文件，本 CLI 是离线运维工具）。
//   ✗ vacuum 式 state 整替+删行：需 bump generation 或空窗代际（前者钉死全部在线客户端 4410、
//     后者破坏 stateSeq 水位语义）——非必要不自伤。
//
// 用法：
//   node scripts/collab-renumber-layer.mjs <projectId> [--dry-run]
//   node scripts/collab-renumber-layer.mjs --all [--dry-run]      # 全项目逐个（含健康 doc——幂等零写）
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireApi = createRequire(path.join(ROOT, 'apps/api/package.json'));
const { Client } = requireApi('pg');
const Y = requireApi('yjs');
// shared dist（verify 链 shared-build 步在前恒新；standalone 跑依赖 dist 已构建——check-collab-census 同前提）
const { planRenumberLayers, scanOrderPathology, CANVAS_DOC_SCHEMA_VERSION } = requireApi('@flowweb/shared');

// ── env（apps/api/.env——只取 DATABASE_URL，不打印密码） ──
function loadDatabaseUrl() {
  let raw = '';
  try { raw = readFileSync(path.join(ROOT, 'apps/api/.env'), 'utf8'); } catch { /* 下方统一报错 */ }
  const m = raw.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?\s*$/m);
  if (!m) { console.error('[renumber-layer] apps/api/.env 缺 DATABASE_URL'); process.exit(1); }
  return m[1];
}

async function connect() {
  const url = loadDatabaseUrl();
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

/** 单项目重排（dryRun=true 只报告零写）。返回 {projectId, changed, layers, report, rows} */
async function renumberProject(client, projectId, dryRun) {
  // 单事务：advisory lock（与 append/compact 同键）→ 读行 → 计算 → （非 dry-run）插入 diff 行。
  // 事务一致性：读与写在同事务——锁内无并发 append（api 已停前提下的跨进程保险）。
  return client.query('BEGIN').then(async () => {
    try {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [projectId]);
      const docRow = (await client.query('SELECT state, "schemaVersion", generation FROM "CanvasDoc" WHERE "projectId" = $1', [projectId])).rows[0] ?? null;
      const gen = Number(docRow?.generation ?? 1) || 1;   // Y1c T10：行 generation 口径（缺省 1 与装载面同源）
      const updates = (await client.query('SELECT seq, update FROM "CanvasDocUpdate" WHERE "projectId" = $1 ORDER BY seq ASC', [projectId])).rows;
      if (!docRow && updates.length === 0) {
        await client.query('COMMIT');
        return { projectId, changed: 0, layers: 0, skipped: 'no-row（CanvasDoc 与 CanvasDocUpdate 皆空——真空档无 doc 可重排）', rows: 0 };
      }
      if (docRow && docRow.schemaVersion !== CANVAS_DOC_SCHEMA_VERSION) {
        await client.query('COMMIT');
        return { projectId, changed: 0, layers: 0, skipped: `schemaVersion=${docRow.schemaVersion}≠${CANVAS_DOC_SCHEMA_VERSION}（装载列门同判据——旧档拒重排）`, rows: 0 };
      }
      const oldDoc = new Y.Doc();
      if (docRow?.state) Y.applyUpdate(oldDoc, new Uint8Array(docRow.state));
      for (const u of updates) Y.applyUpdate(oldDoc, new Uint8Array(u.update));   // T19 登记收口（T18-①）：updates-only doc（CanvasDoc 无行+增量账本有行）照常重排——此前 docRow null 即 skip 整体漏

      // 记录面（读序单源消费——data/parentId 直读 nodes map）
      const nodesMap = oldDoc.getMap('nodes');
      const records = [];
      for (const [id, m] of nodesMap.entries()) {
        if (m == null || typeof m !== 'object') continue;
        const data = m.get('data');
        records.push({
          id,
          parentId: typeof m.get('parentId') === 'string' ? m.get('parentId') : null,
          data: data && typeof data === 'object' && typeof data.entries === 'function' ? Object.fromEntries(data.entries()) : {},
        });
      }
      const before = scanOrderPathology(records);
      const plan = planRenumberLayers(records);
      if (plan.byId.size === 0) {
        await client.query('COMMIT');
        return { projectId, changed: 0, layers: 0, pathology: before, rows: 0, note: '幂等零变更（键已是目标形态——重复再生成容忍，读序 tie-break 稳定）' };
      }
      if (dryRun) {
        await client.query('ROLLBACK');
        return { projectId, changed: plan.byId.size, layers: plan.layers.size, pathology: before, rows: 0, dryRun: true };
      }
      // 应用计划（transact=单 update 语义——新 clientID 的顺序写入集）。
      // svOld 先于 transact 捕获（diff 编码基准=重排前内容——捕获晚于变更=空 diff 丢写）。
      // T18 评审 P1#3：缺 data map 成员**建图写键**（planner 域含缺 data 档〔missing-key〕——
      // 静默跳写=每轮 plan 恒有变更+INSERT 空 diff 行=无限不幂等+账本污染；语义=同层成员需要
      // order 键，缺 data 非豁免面）。
      const svOld = Y.encodeStateVector(oldDoc);
      const newDoc = oldDoc;
      newDoc.transact(() => {
        for (const [id, key] of plan.byId) {
          const m = nodesMap.get(id);
          if (m == null || typeof m.get !== 'function') continue;   // 非法节点值档（adversarial 形态）——结构性不可写，跳过
          let data = m.get('data');
          if (!(data && typeof data === 'object' && typeof data.set === 'function')) {
            data = new Y.Map();
            m.set('data', data);   // 建 data map（缺档成员获得 data.order——幂等闭环）
          }
          data.set('order', key);
        }
      });
      // diff 编码（新内容相对旧 SV——仅重排键增量）+ 单行追加。
      // T18 评审 P1#3：空 diff 零 INSERT（防御档——plan 非空但写集空〔全员非法节点值〕时禁产
      // 空行污染增量账本；正常路径建图写键后 diff 恒非空）。
      const diff = Y.encodeStateAsUpdate(newDoc, svOld);
      if (diff.byteLength === 0) {
        await client.query('COMMIT');
        return { projectId, changed: 0, layers: 0, pathology: before, rows: 0, note: '写集空（非法节点值档全员跳写）——零行追加' };
      }
      // Y1c T10（census⑩）：新表形态行（T9 表改形：id 列删/PK=(projectId,generation,seq)/updateHash
      // unique/firstWalSeq·frameCount·generation NOT NULL）+nextval 退役（canvas_doc_update_seq DROP
      // ——离线工具 api 停写前提下 MAX(seq)+1 单调；updateHash=diff 字节 SHA-256 hex；generation=
      // CanvasDoc 行值缺省 1）。锁（pg_advisory_xact_lock hashtext(pid)）保留——与 vacuumReplace 同键
      // （T12 收口锚），append/compact 已去锁不与本 CLI 竞。
      const hashHex = createHash('sha256').update(Buffer.from(diff)).digest('hex');
      const r = await client.query(
        `INSERT INTO "CanvasDocUpdate" ("projectId", generation, seq, "firstWalSeq", "frameCount", "updateHash", update, "createdAt")
         SELECT $1, $3::int, (SELECT COALESCE(MAX(seq), 0) + 1 FROM "CanvasDocUpdate" WHERE "projectId" = $1)::bigint,
                (SELECT COALESCE(MAX(seq), 0) + 1 FROM "CanvasDocUpdate" WHERE "projectId" = $1)::bigint,
                1, $4::char(64), $2, now()
         RETURNING seq`,
        [projectId, Buffer.from(diff), gen, hashHex],
      );
      await client.query('COMMIT');
      return { projectId, changed: plan.byId.size, layers: plan.layers.size, pathology: before, rows: r.rowCount, seq: r.rows[0].seq };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    }
  });
}

async function listProjectIds(client) {
  // T19 登记收口（T18-①）：updates-only doc 覆盖洞——只查 CanvasDoc 会把「CanvasDoc 无行但
  // CanvasDocUpdate 有行」的 updates-only doc 整体漏掉（懒建档真空窗形态）。并集=
  // CanvasDoc ∪ CanvasDocUpdate 两源（updates-only 形态照常进重排面——renumberProject
  // 的 no-row skip 只对两源皆空＝真空档成立）。
  const a = await client.query('SELECT "projectId" FROM "CanvasDoc"');
  const b = await client.query('SELECT DISTINCT "projectId" FROM "CanvasDocUpdate"');
  return [...new Set([...a.rows.map((x) => x.projectId), ...b.rows.map((x) => x.projectId)])].sort();
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const all = args.includes('--all');
  const projectId = args.find((a) => !a.startsWith('--'));
  if (!projectId && !all) {
    console.error('用法: node scripts/collab-renumber-layer.mjs <projectId> [--dry-run] | --all [--dry-run]');
    process.exit(2);
  }
  console.log('[renumber-layer] 离线/维护窗工具——运行前须停 api/worker（进程停写前提；在线 repair 不存在——G53）');
  const client = await connect();
  try {
    const ids = all ? await listProjectIds(client) : [projectId];
    if (all) console.log(`[renumber-layer] --all：${ids.length} 个项目（含健康 doc——幂等零写）`);
    let totalChanged = 0;
    for (const id of ids) {
      const r = await renumberProject(client, id, dryRun);
      totalChanged += r.changed ?? 0;
      const head = `[renumber-layer] ${id}: ${r.dryRun ? '[dry-run] ' : ''}`;
      if (r.skipped) { console.log(`${head}跳过——${r.skipped}`); continue; }
      if (r.changed === 0) { console.log(`${head}零变更（${r.note ?? '无 order 域成员'}）`); }
      else {
        console.log(`${head}重排 ${r.changed} 节点 / ${r.layers} 层${r.rows ? `（append seq=${r.seq}）` : ''}`);
        const p = r.pathology;
        if (p && p.kinds.length > 0) {
          console.log(`  重排前病理：${p.kinds.join('/')}（dup=${p.duplicateKeyNodes} soft=${p.softKeyNodes} hard=${p.hardKeyNodes} missing=${p.missingKeyNodes} 层=${p.layers.length}）——重排顺带修复（读序恢复键数值序）`);
        }
      }
    }
    console.log(`[renumber-layer] 完成：${totalChanged} 节点重排${dryRun ? '（dry-run 零写）' : ''}——幂等：再跑应零变更`);
  } finally {
    await client.end();
  }
}

// 直跑守卫（测试 import 纯函数面不触发 main——check-collab-census 先例形态）
const isMain = process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1]).replace(/\\/g, '/')}`).href;
if (isMain) {
  main().catch((e) => { console.error(`[renumber-layer] FAIL: ${e.message}`); process.exit(1); });
}

export { renumberProject, listProjectIds };
