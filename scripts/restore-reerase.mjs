// scripts/restore-reerase.mjs —— C4-c2（plan Task C4-3 ★红⑱——生产就绪收尾批·project-erasure）：
// 恢复重擦除 restore gate（runbook §13：恢复后**开流量前置**——备份恢复→本脚本重放→全 DONE 才开流量）。
//
// 语义（spec §2 R16——manifest=data-dir 外部主载体，DB restore 不波及）：
//  - 扫 ERASURE_MANIFEST_DIR 逐 manifest 幂等重放：**不自行删除**——按并集 manifest 建 run 行
//    （state=PURGING_DB+manifestPath 恢复锚——禁回 PENDING 重走 DRAINING〔重采集=live 行集已随
//    批删/收缩，manifest 缩水丢对象重放面〕），**worker saga 全链承接**（PURGING_DB→OBJECTS→CACHE
//    →VERIFYING→DONE——对象删除面=manifest−DB 现存，同 PURGING_DB 后形态单源）；
//  - tombstone：恢复后 ACTIVE 项目置 DELETING（重放期间禁用户写——开流量前置语义）；
//  - replayedAt 审计：manifest 目录 sidecar `<erasureId>.replayed.json`（幂等标记）+AuditLog
//    erasure_restore_replay 行（DB 已恢复可达——开流量前库在线是既定前提）；
//  - **manifest 缺失/损坏→RESIDUAL_RISK exit 2 非成功**（双失诚实披露 R16：DB 有擦除证据〔run 行
//    manifestPath 索引〕而外部 manifest 文件丢失=无法证明/重放已删对象的反向清除——不声称零残留，
//    人工裁定〔runbook §13 残余披露段〕）；
//  - 退出码：0=全 planned run 达 DONE（或无待重放）；1=有 run FAILED/等待超时；2=RESIDUAL_RISK；
//  - 幂等：sidecar 在=已重放跳过；活跃 run 在=进行中跳过（等待面归 --wait 轮询）。
//
// 用法：node scripts/restore-reerase.mjs [--manifest-dir DIR] [--wait-ms 300000] [--no-wait]
const { createRequire } = await import('node:module');
const { fileURLToPath } = await import('node:url');
const path = await import('node:path');
const fs = await import('node:fs/promises');
const crypto = await import('node:crypto');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireApi = createRequire(path.join(ROOT, 'apps', 'api', 'package.json'));

/** 活跃态词表（ERASURE_ACTIVE_STATES 同源——raw 脚本面免 TS import）。 */
const ACTIVE_STATES = ['PENDING', 'RUNNING', 'DRAINING', 'WAITING_CHILDREN', 'PURGING_DB', 'PURGING_OBJECTS', 'PURGING_CACHE', 'VERIFYING'];

/** manifest 目录（erasureManifestDir() 同源缺省——.data/erasure-manifest）。 */
export function resolveManifestDir(explicit) {
  if (explicit) return explicit;
  return process.env.ERASURE_MANIFEST_DIR
    ?? path.join(process.cwd(), '.data', 'erasure-manifest');
}

/** 扫描 manifest 目录（*.ndjson；目录缺失=空集——双失判定由 DB 证据对拍承载非本函数职责）。 */
export async function collectManifestFiles(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  return entries.filter((e) => e.isFile() && e.name.endsWith('.ndjson'))
    .map((e) => path.join(dir, e.name)).sort();
}

/** 单 manifest header+footer sha 复算（readErasureManifest 同纪律的最小实现——脚本侧不引 TS 模块）。
 *  返回 null=文件形态违规/损坏（调用方计入 residualRisk——诚实披露非假绿）。 */
export async function readManifestHeader(p) {
  const raw = await fs.readFile(p, 'utf8').catch(() => null);
  if (raw == null) return null;
  const lines = raw.split('\n').filter((l) => l.length > 0);
  if (lines.length < 3) return null;
  let header;
  let footer;
  try {
    header = JSON.parse(lines[0]);
    footer = JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
  if (header.type !== 'erasure-manifest' || footer.type !== 'erasure-manifest-footer') return null;
  const hash = crypto.createHash('sha256');
  for (const l of lines.slice(0, -1)) hash.update(`${l}\n`);
  if (hash.digest('hex') !== footer.sha256) return null;
  return { header, footer, manifestPath: p };
}

/**
 * 规划+执行重放（幂等核心——测试面/int spec 直调）。返回 { planned, skipped, residualRisk }：
 *  - planned：已建 run 行（state=PURGING_DB+恢复锚）的 { erasureId, scopeId } 集合；
 *  - skipped：sidecar 已重放/活跃 run 在/非 project scope 的 manifest 集；
 *  - residualRisk：DB 擦除证据（run 行 manifestPath）对应文件缺失/损坏+目录内损坏 manifest——
 *    **非空=RESIDUAL_RISK（exit 2 语义）**。
 */
export async function planRestoreReerase(opts = {}) {
  const { PrismaClient } = requireApi('@prisma/client');
  const prisma = opts.prisma ?? new PrismaClient();
  const dir = resolveManifestDir(opts.manifestDir);
  const ownsClient = !opts.prisma;
  try {
    // ① DB 擦除证据集（非 dryRun run 行 manifestPath 索引——R16「DB 行只作索引」消费面）
    const evidenceRows = await prisma.projectErasureRun.findMany({
      where: { dryRun: false, manifestPath: { not: null } },
      select: { erasureId: true, scopeId: true, manifestPath: true, state: true },
    });
    // ② 双失对拍：证据文件缺失/损坏→residualRisk（诚实披露——不假绿不静默跳过）
    const residualRisk = [];
    for (const row of evidenceRows) {
      const header = await readManifestHeader(row.manifestPath);
      if (header == null) {
        residualRisk.push({ kind: 'manifest-missing', erasureId: row.erasureId, scopeId: row.scopeId, state: row.state, manifestPath: row.manifestPath });
      }
    }
    // ③ 逐 manifest 重放（幂等：sidecar/活跃 run 双跳过）
    const planned = [];
    const skipped = [];
    for (const f of await collectManifestFiles(dir)) {
      const parsed = await readManifestHeader(f);
      if (parsed == null) { residualRisk.push({ kind: 'corrupt-manifest', manifestPath: f }); continue; }
      const { header, footer, manifestPath } = parsed;
      if (header.scopeType !== 'project') { skipped.push({ manifestPath, reason: 'non-project-scope' }); continue; }
      const pid = header.scopeId;
      const sidecar = path.join(dir, `${header.erasureId}.replayed.json`);
      if (await fs.access(sidecar).then(() => true, () => false)) { skipped.push({ manifestPath, reason: 'already-replayed' }); continue; }
      const active = await prisma.projectErasureRun.findFirst({
        where: { scopeType: 'project', scopeId: pid, dryRun: false, state: { in: ACTIVE_STATES } },
        select: { erasureId: true },
      });
      if (active) { skipped.push({ manifestPath, reason: `active-run:${active.erasureId}` }); continue; }
      // 建行（恢复锚=state PURGING_DB+既有 manifestPath——worker saga 承接；同 erasureId upsert
      // 复用旧 id 防重复行；attempts 清零〔P2-2 重数语义同 re-drive〕）
      await prisma.$transaction(async (tx) => {
        // tombstone：恢复后 ACTIVE→DELETING（重放期间禁用户写；已 DELETING/已删行零动作）
        await tx.$executeRawUnsafe(`UPDATE "CanvasProject" SET "lifecycleState" = 'DELETING' WHERE "id" = $1 AND "lifecycleState" = 'ACTIVE'`, pid);
        await tx.projectErasureRun.upsert({
          where: { erasureId: header.erasureId },
          create: { erasureId: header.erasureId, scopeType: 'project', scopeId: pid, requestedBy: 'restore-reerase', state: 'PURGING_DB', stage: 'restore-replay', manifestPath, manifestSha256: footer.sha256, attempts: 0 },
          update: { state: 'PURGING_DB', stage: 'restore-replay', error: null, claimOwner: null, leaseUntil: null, completedAt: null, manifestPath, manifestSha256: footer.sha256, attempts: 0, requestedBy: 'restore-reerase' },
        });
        await tx.auditLog.create({
          data: {
            operatorId: 'restore-reerase', operatorName: 'restore-reerase',
            targetType: 'PROJECT', targetId: pid, action: 'erasure_restore_replay',
            beforeValue: { manifestPath }, afterValue: { state: 'PURGING_DB', manifestSha256: footer.sha256 },
            remark: `restore gate 重放（run=${header.erasureId}——外部 manifest 恢复锚，worker saga 承接）`,
          },
        });
      });
      await fs.writeFile(sidecar, `${JSON.stringify({ schemaVersion: 1, replayedAt: new Date().toISOString(), erasureId: header.erasureId, scopeId: pid })}\n`, 'utf8');
      planned.push({ erasureId: header.erasureId, scopeId: pid });
    }
    return { planned, skipped, residualRisk };
  } finally {
    if (ownsClient) await prisma.$disconnect().catch(() => undefined);
  }
}

/** 等待面：planned run 全达终态（DONE/FAILED）。返回 { done, failed, timeout? }。 */
export async function waitRestoreReerase(planned, opts = {}) {
  const { PrismaClient } = requireApi('@prisma/client');
  const prisma = opts.prisma ?? new PrismaClient();
  const deadline = Date.now() + (opts.waitMs ?? 300_000);
  const ownsClient = !opts.prisma;
  try {
    for (;;) {
      const rows = await prisma.projectErasureRun.findMany({
        where: { erasureId: { in: planned.map((p) => p.erasureId) } },
        select: { erasureId: true, state: true, error: true },
      });
      const done = rows.filter((r) => r.state === 'DONE').map((r) => r.erasureId);
      const failed = rows.filter((r) => r.state === 'FAILED').map((r) => ({ erasureId: r.erasureId, error: r.error }));
      if (done.length + failed.length === planned.length) return { done, failed };
      if (Date.now() > deadline) return { done, failed, timeout: true };
      await new Promise((r) => setTimeout(r, 2_000));
    }
  } finally {
    if (ownsClient) await prisma.$disconnect().catch(() => undefined);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const val = (name, dflt) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : dflt;
  };
  const dir = resolveManifestDir(val('--manifest-dir', undefined));
  console.log(`[restore-reerase] manifest dir=${dir}`);
  const plan = await planRestoreReerase({ manifestDir: dir });
  for (const p of plan.planned) console.log(`[restore-reerase] planned run=${p.erasureId} project=${p.scopeId}（state=PURGING_DB——worker saga 承接）`);
  for (const s of plan.skipped) console.log(`[restore-reerase] skipped ${s.manifestPath}（${s.reason}）`);
  if (plan.residualRisk.length > 0) {
    console.error(`[restore-reerase] RESIDUAL_RISK：DB 擦除证据的 manifest 缺失/损坏 ${plan.residualRisk.length} 项（双失诚实披露 R16——不声称零残留，人工裁定见 runbook §13 残余披露段）：`);
    for (const r of plan.residualRisk) console.error(`  - ${r.kind} ${r.manifestPath ?? ''} ${r.erasureId ?? ''}`);
    process.exit(2);
  }
  if (plan.planned.length === 0) {
    console.log('[restore-reerase] 无待重放 manifest（全部已重放/进行中/目录空）——gate 直接放行档');
    process.exit(0);
  }
  if (flag('--no-wait')) {
    console.log('[restore-reerase] --no-wait：已建 run 行即返回——**gate 未验证**（planned run 仍在飞：开流量前置=本脚本全 DONE 退出 ∧ erasure_pending_age 归零 ∧ 无 FAILED，runbook §13.1 步骤 5）');
    process.exit(0);
  }
  const wait = await waitRestoreReerase(plan.planned, { waitMs: Number(val('--wait-ms', '300000')) });
  for (const d of wait.done) console.log(`[restore-reerase] DONE ${d}`);
  for (const f of wait.failed) console.error(`[restore-reerase] FAILED ${f.erasureId}: ${f.error ?? ''}`);
  if (wait.timeout) {
    console.error('[restore-reerase] 等待超时——run 未全达终态（查 worker 进程/erasure_pending_age 告警面）');
    process.exit(1);
  }
  if (wait.failed.length > 0) process.exit(1);
  console.log('[restore-reerase] 全 planned run DONE——restore gate 前件满足（开流量序见 runbook §13）');
  process.exit(0);
}

// main 守卫（import 面〔int spec〕不执行 CLI——路径归一比较跨 Windows 盘符）
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main();
}
