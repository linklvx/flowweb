// scripts/check-migration-additive.mjs —— expand/contract 纪律门禁：drain 只冻结 collab 写路径，
// HTTP 面继续打库——顺序安全性由迁移 additive 承担。
// 硬拦（对"旧代码在跑"必炸）：DROP COLUMN/TABLE/CONSTRAINT/TYPE、SET NOT NULL、DROP NOT NULL、TRUNCATE、
// RENAME、ALTER COLUMN TYPE；
// DROP INDEX 默认降 WARNING（删索引不破坏旧代码在跑，却是 prisma 重建索引最常见良性破坏语句，全量硬拦会训练绕过）。
// ★Y0b-5 T12：DROP INDEX 硬拦名单（CRITICAL_INDEXES）——触及资金正确性唯一索引直接 exit 1
// （pricing_rule_natural_key 的 NULLS NOT DISTINCT 语义 Prisma 不可表达：被 DROP 后 migrate-diff 对比源
// 亦不可见=双盲；名单与 migrate-diff-allowlist.txt 唯一永久豁免同源人工同步——traceId 迁移
// migrate dev --create-only 产物附带的无关 DROP INDEX 必须【人工裁剪后提交】，与硬拦口径统一）。
// 基线落文件内常量（禁 env 旋钮）；基线存在性断言（常量打错⇒fresh 恒空⇒永久豁免且输出仍 OK——静默失效唯一路径封死）。
// Y0b-2 squash（2026-10-10）：第三次基线重置。护栏：BASELINE 只允许在"无生产环境"期间抬高；
// 失效条件=spec §9.6——此后一切 schema 变更回到 expand/contract 两步走。
// squash 后 fresh 集合空为预期（本批 DDL 的 additive 审计发生在起草阶段〔20261009140000_y0b2_draft〕，
// 终态由 census 对象级+行级三验保证）。
// 双跑：preflight 本地 + cutover ③ 服务器 migrate 前 + 根 verify 链（verify-indexes 之后）。
// ★Y1a+Y1b T2（裁定1）：显式豁免清单 EXEMPTIONS——migration 目录名→{表名: {reason,owner,since}}。
// BREAKING 语句命中〈迁移,表〉二元组→放行并打印 EXEMPTED 行；未命中（含表名不可提取）仍硬拦——豁免力
// 精确到表，禁文件级一刀切（同迁移多表破坏时未登记表照红），对未来意外迁移的拦截力不变。豁免登记与迁移同 commit 审阅。
// ★S0.1（2026-10-20）豁免纪律：豁免=迁移历史的**永久登记**（同 immutability checksums 性质）——
// additive gate 全量检查基线后所有历史迁移，已应用的破坏性迁移一旦登记即不可撤销（删除豁免条目
// ⇒ 该迁移永红=gate 失效）。「S0 后删除本次豁免」不可执行，正确收敛路径=未来基线 squash（同 Y0b-2
// 前三次基线重置，仅限无生产环境窗）。纪律三条：禁通配/禁扩大豁免面；本测试文件 pin 锁死登记面；
// 新增豁免须用户裁定后与迁移同 commit。
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const BASELINE = '20261009140100_y0b2_init';   // 此后新增迁移才受检（Y0b-2 T1 squash 基线=唯一 init）
const MIG_DIR = join(ROOT, 'apps/api/prisma/migrations');
// 与 apps/api/prisma/migrate-diff-allowlist.txt 唯一永久豁免同源（人工同步——两处均只此一条）
export const CRITICAL_INDEXES = ['pricing_rule_natural_key'];
const BREAKING = /\bDROP\s+(COLUMN|TABLE|CONSTRAINT|TYPE)\b|\bSET\s+NOT\s+NULL\b|\bDROP\s+NOT\s+NULL\b|\bTRUNCATE\b|\bRENAME\s+(COLUMN|TO|TABLE)\b|\bALTER\s+COLUMN\b[^\n;]*\bTYPE\b/i;
const DROP_INDEX = /\bDROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|([A-Za-z_][\w$]*))/ig;

// 豁免登记（controller 裁定专属——reset runbook 全表部署语义，无存量数据不受 expand/contract 保护）。
// 元数据（S0.1 2026-10-20 补全）：reason=放行依据 / owner=豁免裁定责任人 / since=登记日期。
export const EXEMPTIONS = {
  '20261020200300_nodeartifact_projection_v3': {
    Media: {
      reason: 'Y1a+Y1b v11 硬切批——spec v14 reset runbook 全表部署，无存量数据',
      owner: 'Y1a+Y1b 批 controller',
      since: '2026-10-20',
    },
  },
  '20261020211610_media_v3_natural_sniff_size': {
    Media: {
      reason: 'Y1a+Y1b v11 硬切批——size Int→BigInt 破坏性变更，spec v14 reset runbook 全表部署',
      owner: 'Y1a+Y1b 批 controller',
      since: '2026-10-20',
    },
  },
};

/** BREAKING 语句所属表名提取（ALTER/DROP/TRUNCATE TABLE "X" 或 DROP TYPE "X" 首个引用）；
 *  提取不到=null=不可豁免（保守兜底——表名不明即维持硬拦）。
 *  已知边界（质评 Minor-4）：多目标 DROP TABLE（DROP TABLE "A", "B"）首目标命中即整语句豁免——
 *  Prisma 不产此形态，豁免登记与迁移同 commit 审阅兜底。 */
export function breakingTable(stmt) {
  return stmt.match(/\b(?:ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE(?:\s+TABLE)?)\s+"([^"]+)"/i)?.[1]
    ?? stmt.match(/\bDROP\s+TYPE\s+"([^"]+)"/i)?.[1]
    ?? null;
}

/** 豁免裁决（纯函数）：bare SQL 逐语句分型——BREAKING 语句命中清单→exempted[{table,reason}]；
 *  未命中/表名不可提取→violations（维持硬拦——判定与豁免层分离，未登记即红）。 */
export function resolveExemptions(dir, bare) {
  const exempted = [], violations = [];
  for (const stmt of bare.split(';')) {
    if (!analyzeSql(stmt).breaking) continue;
    const table = breakingTable(stmt);
    const reason = table && EXEMPTIONS[dir]?.[table]?.reason;
    if (reason) exempted.push({ table, reason });
    else violations.push(stmt.replace(/\s+/g, ' ').trim().slice(0, 160));
  }
  return { exempted, violations };
}

/** 分类纯函数（T12 测试消费）：输入=剥注释后的 bare SQL。breaking=破坏性语句命中片段；criticalIndex=硬拦名单命中。 */
export function analyzeSql(bare) {
  const hit = BREAKING.exec(bare);
  let criticalIndex = null, dropIndex = false;
  for (const m of bare.matchAll(DROP_INDEX)) {
    dropIndex = true;
    const name = (m[1] ?? m[2] ?? '').toLowerCase();
    if (CRITICAL_INDEXES.includes(name)) criticalIndex = name;
  }
  return { breaking: hit ? hit[0] : null, criticalIndex, dropIndex };
}

/** 单迁移裁决（质评收口 Minor-1 抽纯函数）：critical DROP INDEX 与 dropIndex 警告=独立检查，
 *  先于 breaking/豁免分支——豁免放行不影响两者（曾：豁免迁移夹带 critical DROP INDEX 走 breaking
 *  分支=双盲绕过）。bad>0 ⇔ main 对该迁移判红（process.exit(1) 驱动量）。 */
export function judgeMigration(dir, bare) {
  const { breaking, criticalIndex, dropIndex } = analyzeSql(bare);
  let bad = 0, warned = 0;
  const exempted = [], violations = [];
  if (criticalIndex) bad++;
  else if (dropIndex) warned++;
  if (breaking) {
    const r = resolveExemptions(dir, bare);
    exempted.push(...r.exempted);
    violations.push(...r.violations);
    if (violations.length) bad++;
  }
  return { bad, warned, exempted, violations, criticalIndex };
}

function main() {
  if (!existsSync(MIG_DIR)) { console.error('additive FAIL: migrations 目录缺失'); process.exit(1); }   // fail-closed
  const dirs = readdirSync(MIG_DIR).filter((d) => /^\d+_/.test(d)).sort();
  if (!dirs.includes(BASELINE)) { console.error(`additive FAIL: BASELINE 常量 "${BASELINE}" 不在迁移目录集合中（拼写错=永久豁免——P0-3 根修）`); process.exit(1); }
  const fresh = dirs.filter((d) => d > BASELINE);
  let bad = 0, warned = 0, exemptedN = 0;
  for (const d of fresh) {
    const sql = readFileSync(join(MIG_DIR, d, 'migration.sql'), 'utf8');
    // 匹配前剥 `--` 注释行——手工两步走注释（如 "-- contract step: 将来 DROP COLUMN legacy_x"）不拦，
    // 防门禁训练作者删注释；prisma 生成段头驼峰无空格本就不命中，不受影响。
    const bare = sql.replace(/--[^\n]*/g, '');
    const { bad: jBad, warned: jWarned, exempted, violations, criticalIndex } = judgeMigration(d, bare);
    // 质评收口 Minor-1：critical 拦截与 dropIndex 警告独立于豁免分支（judgeMigration 内先裁）
    if (criticalIndex) console.error(`additive FAIL: ${d} 含 DROP INDEX "${criticalIndex}"（硬拦名单——资金正确性唯一索引，且 Prisma diff 不可见=双盲；独立于豁免裁决——豁免迁移夹带亦红；恢复须重建索引而非豁免）`);
    else if (jWarned) console.error(`additive WARNING: ${d} 含 DROP INDEX（旧代码不按名引用索引——性能非正确性影响，登记即可）`);
    for (const e of exempted) console.log(`EXEMPTED: ${d} ${e.table} — ${e.reason}`);
    if (violations.length) console.error(`additive FAIL: ${d} 含未豁免破坏性变更 ${violations.length} 条（drain 期间 HTTP 面旧代码在跑，破坏性变更=两步走（先加可空/带默认新形态、旧代码下线后再删旧）；豁免=登记 EXEMPTIONS 与迁移同 commit 审阅）:\n  - ${violations.join('\n  - ')}`);
    bad += jBad; warned += jWarned;
    if (exempted.length && !violations.length) exemptedN++;
  }
  if (fresh.length === 0) console.log('check-migration-additive: 尚无基线之后的新迁移——本跑无受检对象（非静默：有新迁移才可能红）');
  console.log(bad ? `check-migration-additive: ${bad} 处违规` : `check-migration-additive OK（受检 ${fresh.length} 个迁移，WARNING ${warned}，豁免 ${exemptedN}，基线=${BASELINE}）`);
  process.exit(bad ? 1 : 0);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main();
