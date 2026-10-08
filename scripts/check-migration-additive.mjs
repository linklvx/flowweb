// scripts/check-migration-additive.mjs —— expand/contract 纪律门禁：drain 只冻结 collab 写路径，
// HTTP 面继续打库——顺序安全性由迁移 additive 承担。
// 硬拦（对"旧代码在跑"必炸）：DROP COLUMN/TABLE/CONSTRAINT/TYPE、SET NOT NULL、DROP NOT NULL、TRUNCATE、
// RENAME、ALTER COLUMN TYPE；
// DROP INDEX 降 WARNING（删索引不破坏旧代码在跑，却是 prisma 重建索引最常见良性破坏语句，硬拦会训练绕过）。
// 基线落文件内常量（禁 env 旋钮）；基线存在性断言（常量打错⇒fresh 恒空⇒永久豁免且输出仍 OK——静默失效唯一路径封死）。
// Y0b-1 T1a 基线重置（24→1 squash）：基线上移至 20261009031416_init——其前历史迁移已并入基线不再受检，
// T1b 起新增迁移成为 additive 门禁首批真实受检对象。
// 双跑：preflight 本地 + cutover ③ 服务器 migrate 前 + 根 verify 链（verify-indexes 之后）。
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const BASELINE = '20261009031416_init';   // 此后新增迁移才受检（Y0b-1 T1a squash 基线=唯一 init）
const MIG_DIR = join(ROOT, 'apps/api/prisma/migrations');
if (!existsSync(MIG_DIR)) { console.error('additive FAIL: migrations 目录缺失'); process.exit(1); }   // fail-closed
const dirs = readdirSync(MIG_DIR).filter((d) => /^\d+_/.test(d)).sort();
if (!dirs.includes(BASELINE)) { console.error(`additive FAIL: BASELINE 常量 "${BASELINE}" 不在迁移目录集合中（拼写错=永久豁免——P0-3 根修）`); process.exit(1); }
const fresh = dirs.filter((d) => d > BASELINE);
const BREAKING = /\bDROP\s+(COLUMN|TABLE|CONSTRAINT|TYPE)\b|\bSET\s+NOT\s+NULL\b|\bDROP\s+NOT\s+NULL\b|\bTRUNCATE\b|\bRENAME\s+(COLUMN|TO|TABLE)\b|\bALTER\s+COLUMN\b[^\n;]*\bTYPE\b/i;
const WARN_ONLY = /\bDROP\s+INDEX\b/i;
let bad = 0, warned = 0;
for (const d of fresh) {
  const sql = readFileSync(join(MIG_DIR, d, 'migration.sql'), 'utf8');
  // 匹配前剥 `--` 注释行——手工两步走注释（如 "-- contract step: 将来 DROP COLUMN legacy_x"）不拦，
  // 防门禁训练作者删注释；prisma 生成段头驼峰无空格本就不命中，不受影响。
  const bare = sql.replace(/--[^\n]*/g, '');
  const hit = BREAKING.exec(bare);
  if (hit) { console.error(`additive FAIL: ${d} 含破坏性变更（${hit[0]}）——drain 期间 HTTP 面旧代码在跑，破坏性变更=两步走（先加可空/带默认新形态、旧代码下线后再删旧）`); bad++; }
  else if (WARN_ONLY.test(bare)) { console.error(`additive WARNING: ${d} 含 DROP INDEX（旧代码不按名引用索引——性能非正确性影响，登记即可）`); warned++; }
}
if (fresh.length === 0) console.log('check-migration-additive: 尚无基线之后的新迁移——本跑无受检对象（非静默：有新迁移才可能红）');
console.log(bad ? `check-migration-additive: ${bad} 处违规` : `check-migration-additive OK（受检 ${fresh.length} 个迁移，WARNING ${warned}，基线=${BASELINE}）`);
process.exit(bad ? 1 : 0);
