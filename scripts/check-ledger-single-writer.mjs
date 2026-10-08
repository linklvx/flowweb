#!/usr/bin/env node
// Y0b-1（§1.4bis/Z12/Z13）：台账唯一写入口+资金面纪律静态锚。
// ①TeamCreditTransaction 全写操作集（create/update/upsert/delete 及 Many）仅允许 credit-ledger.service.ts；
// ②teamBalance.(update|updateMany|upsert|create|delete) 仅允许 credit-ledger.service（三轮 Z23：ensureBalance
//   收口后白名单收窄为仅 ledger 服务——team.service/bootstrap/recharge/admin 均改调 ensureBalance；.spec 豁免）；
// ③raw SQL（$queryRaw/$executeRaw）触及 TeamCreditTransaction → 800 字符窗口必须含 teamId（F1 契约 4 raw 形态——
//   四轮 G4：anti-join 全在 $queryRaw，只认 findMany 形态=新代码全在盲区）；
// ④raw 写 TeamBalance 仅允许 credit-ledger.service（四轮 P1-4：裸 UPDATE 可同时躲过①方法形态与②白名单；
//   只拦写，T5 drift 巡检的 raw SELECT 不误伤）；
// ⑤资金服务文件禁 readCanvas（冻结契约 2）；
// ⑥台账 findMany 调用点（前 200/后 600 字符窗）须含自有键 teamId:（禁子串假绿——teamIdSnapshot 不满足
//   (^|[,{\s])teamId\s*: 判定；前窗覆盖 where 变量前置的真实形态 team.controller listTransactions）；
// ⑦静态锁序锚（Z13 同函数内序不变量——每个函数体内 generationIntent 写操作首现必须晚于 lockBalance 首现；
//   跨函数/helper 调用链不在锚覆盖面，真正保证=mutate/lockBalance 调用契约+Z13 测试锚，本锚是防回归下限
//   非充分条件）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LEDGER = 'credit-ledger.service.ts';
const BALANCE_WRITERS = /credit-ledger\.service\.ts$/;

export function scanFiles(files) {
  const problems = [];
  for (const { rel, src } of files) {
    if (/(teamCreditTransaction\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\()/.test(src) && !rel.endsWith(`/team/${LEDGER}`)) {
      problems.push(`唯一写入口违规：${rel} 含 TeamCreditTransaction 写操作（仅允许 team/${LEDGER}）`);
    }
    if (/(teamBalance\s*\.\s*(update|updateMany|upsert|create|delete)\s*\()/.test(src) && !BALANCE_WRITERS.test(rel) && !rel.includes('.spec.')) {
      problems.push(`TeamBalance 写操作越权：${rel}（仅允许 credit-ledger.service——ensureBalance/lockBalance 唯一口）`);
    }
    for (const m of src.matchAll(/\$(?:queryRaw|executeRaw)[\s\S]{0,800}/g)) {
      if (/TeamCreditTransaction/.test(m[0]) && !/teamId/.test(m[0])) {
        problems.push(`raw SQL 含 TeamCreditTransaction 但 800 字符内无 teamId（契约 4 raw 形态）：${rel}（偏移 ${m.index}）`);
      }
    }
    for (const m of src.matchAll(/\$(?:queryRaw|executeRaw)[\s\S]{0,800}?(UPDATE\s+"TeamBalance"|INSERT\s+INTO\s+"TeamBalance"|DELETE\s+FROM\s+"TeamBalance")/gi)) {
      if (!BALANCE_WRITERS.test(rel)) {
        problems.push(`raw SQL 写 TeamBalance（仅允许 credit-ledger.service——ensureBalance/lockBalance 唯一口，四轮 P1-4）：${rel}（偏移 ${m.index}）`);
      }
    }
    if (/readCanvas\s*\(/.test(src) && /(team-credit\.service|intent-reconcile\.service|credit-ledger\.service)\.ts$/.test(rel)) {
      problems.push(`资金分支禁 readCanvas（冻结契约 2）：${rel}`);
    }
    for (const m of src.matchAll(/teamCreditTransaction\s*\.\s*findMany\s*\(/g)) {
      const win = src.slice(Math.max(0, m.index - 200), m.index + 600);
      if (!/(^|[,{\s])teamId\s*:/.test(win)) {
        problems.push(`台账 findMany where 自有键缺 teamId（契约 4）：${rel}（偏移 ${m.index}）`);
      }
    }
    // ⑦ 分割锚：2 空格缩进的方法声明行（修饰符 private/public/protected/static/async 任意组合）；
    //    控制流关键字（if/for/while/switch/catch/return）排除——防止 if 体截断成假函数块。
    const fns = src.split(/\n(?= {2}(?:(?:private|public|protected|static|async)\s+)*(?!(?:if|for|while|switch|catch|return)\b)[\w$]+\s*\()/);
    for (const fn of fns) {
      const lock = fn.search(/lockBalance\s*\(/);
      const giWrite = fn.search(/generationIntent\s*\.\s*(update|updateMany|delete|deleteMany|create)\s*\(/);
      if (lock >= 0 && giWrite >= 0 && giWrite < lock) {
        problems.push(`锁序违规（契约 20：lockBalance 必须先于 GenerationIntent 写）：${rel}——GI 写出现在 lockBalance 之前`);
      }
    }
  }
  return problems;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const SRC = path.join(ROOT, 'apps/api/src');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'dist' ? [] : walk(p);
    return e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [p] : [];
  });
  const files = walk(SRC).map((f) => ({
    rel: path.relative(ROOT, f).split(path.sep).join('/'),
    src: fs.readFileSync(f, 'utf8'),
  }));
  const problems = scanFiles(files);
  if (problems.length) { console.error(`check-ledger-single-writer FAIL:\n  ${problems.join('\n  ')}`); process.exit(1); }
  console.log(`check-ledger-single-writer OK: ${files.length} 文件——写入口唯一（全操作集）+balance 写白名单+raw 形态带 teamId+零 readCanvas+台账查询带 teamId+锁序静态锚`);
}
