#!/usr/bin/env node
// Y0b-1（§1.4bis/Z12/Z13）：台账唯一写入口+资金面纪律静态锚。
// ①TeamCreditTransaction 全写操作集（create/update/upsert/delete 及 Many）仅允许 credit-ledger.service.ts；
// ②teamBalance.(update|updateMany|upsert|create|delete|createMany|deleteMany) 仅允许 credit-ledger.service（三轮 Z23：
//   ensureBalance 收口后白名单收窄为仅 ledger 服务；Y0b-2 Z89 备选集补 createMany|deleteMany——Many 形态漏写）；
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
// ⑧（Y0b-2 Z89）ledger.tx( 禁用锚——tx() 已删（通行证唯一入口=ledgerTx 双 SET LOCAL）；
//   生产代码出现即违规（含 test-utils——死方法调用=运行时必炸）。
// ⑨（Y0b-2 Z89 漏报加固）函数块含 ledger.mutate(/ledger.ledgerTx( 且有 GI 写而无 lockBalance( 先行者=违规
//   （⑦只比"lock 存在时的相对序"，lock 整个缺失时漏报——⑨补"资金事务函数必须有锁先行"下限）。
// Z116 测试能力制（Y0b-2 T1）：①②④对测试文件（*.spec.ts / test-utils/）不再是绝对豁免——写操作 800 字符
// 窗口内须含通行证证据（runInTx( / ledgerTx( / SET LOCAL app.ledger_tx / set_config('app.ledger_tx' /
// LEDGER_SINGLE_WRITER〔负测标记——断言触发器拦截的故意无证写〕）；ledger_guard 触发器让无证写在运行时必炸，
// 窗口判定防的是 .catch 掩码假绿。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LEDGER = 'credit-ledger.service.ts';
const BALANCE_WRITERS = /credit-ledger\.service\.ts$/;

const isTestFile = (rel) => rel.includes('.spec.') || rel.includes('/test-utils/');
/** Z116 通行证证据窗口：写操作前后 800 字符内出现任一 token 即视为"带证写"（负测以断言串为证；
 *  set_config 第三参 true=事务局部——与 SET LOCAL 等价，monthly spec 跨月回填用此形态）。 */
const hasPassNear = (src, idx) => /runInTx\(|ledgerTx\(|SET LOCAL app\.ledger_tx|set_config\('app\.ledger_tx'|LEDGER_SINGLE_WRITER/.test(src.slice(Math.max(0, idx - 800), idx + 800));

export function scanFiles(files) {
  const problems = [];
  for (const { rel, src } of files) {
    const testFile = isTestFile(rel);
    // ⑧ ledger.tx( 禁用锚（tx() 已删——测试文件同样禁：死方法=运行时 TypeError）
    if (/ledger\.tx\(/.test(src)) {
      problems.push(`ledger.tx( 已删（Y0b-2 Z89）：${rel}——通行证唯一入口=ledger.ledgerTx(raw) 双 SET LOCAL`);
    }
    const txnWrite = /(teamCreditTransaction\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\()/g;
    for (const m of src.matchAll(txnWrite)) {
      if (rel.endsWith(`/team/${LEDGER}`)) continue;
      if (testFile && hasPassNear(src, m.index)) continue;
      problems.push(`唯一写入口违规：${rel} 含 TeamCreditTransaction 写操作（仅允许 team/${LEDGER}${testFile ? '；测试文件须带通行证（Z116：窗口内 runInTx/ledgerTx/SET LOCAL/负测标记）' : ''}）`);
    }
    const balWrite = /(teamBalance\s*\.\s*(update|updateMany|upsert|create|delete|createMany|deleteMany)\s*\()/g;
    for (const m of src.matchAll(balWrite)) {
      if (BALANCE_WRITERS.test(rel)) continue;
      if (testFile && hasPassNear(src, m.index)) continue;
      problems.push(`TeamBalance 写操作越权：${rel}（仅允许 credit-ledger.service——ensureBalance/lockBalance 唯一口${testFile ? '；测试文件须带通行证（Z116）' : ''}）`);
    }
    // 注意：正则无词边界——$queryRawUnsafe/$executeRawUnsafe 被顺带覆盖（有意，勿"修正"词边界放跑 Unsafe 形态）
    for (const m of src.matchAll(/\$(?:queryRaw|executeRaw)[\s\S]{0,800}/g)) {
      if (/TeamCreditTransaction/.test(m[0]) && !/teamId/.test(m[0])) {
        problems.push(`raw SQL 含 TeamCreditTransaction 但 800 字符内无 teamId（契约 4 raw 形态）：${rel}（偏移 ${m.index}）`);
      }
    }
    for (const m of src.matchAll(/\$(?:queryRaw|executeRaw)[\s\S]{0,800}?(UPDATE\s+"TeamBalance"|INSERT\s+INTO\s+"TeamBalance"|DELETE\s+FROM\s+"TeamBalance")/gi)) {
      if (BALANCE_WRITERS.test(rel)) continue;
      if (testFile && hasPassNear(src, m.index)) continue;
      problems.push(`raw SQL 写 TeamBalance（仅允许 credit-ledger.service——ensureBalance/lockBalance 唯一口，四轮 P1-4）：${rel}（偏移 ${m.index}）`);
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
    // ⑦/⑨ 分割锚：2 空格缩进的方法声明行（修饰符 private/public/protected/static/async 任意组合）；
    //    控制流关键字（if/for/while/switch/catch/return）排除——防止 if 体截断成假函数块。
    //    函数级锚只对生产文件跑（测试文件的 describe/夹具块结构不适配方法分割启发式——
    //    Z116 能力制已由①②④的通行证窗口覆盖测试文件的写面）。
    if (testFile) continue;
    const fns = src.split(/\n(?= {2}(?:(?:private|public|protected|static|async)\s+)*(?!(?:if|for|while|switch|catch|return)\b)[\w$]+\s*\()/);
    for (const fn of fns) {
      const lock = fn.search(/lockBalance\s*\(/);
      const giWrite = fn.search(/generationIntent\s*\.\s*(update|updateMany|delete|deleteMany|create|createMany)\s*\(/);
      if (lock >= 0 && giWrite >= 0 && giWrite < lock) {
        problems.push(`锁序违规（契约 20：lockBalance 必须先于 GenerationIntent 写）：${rel}——GI 写出现在 lockBalance 之前`);
      }
      // ⑨ 漏报加固：资金事务函数（含 mutate/ledgerTx 调用）有 GI 写而 lockBalance 整个缺失/不先行=违规
      const fundsFn = /ledger\s*\.\s*(mutate|ledgerTx)\s*\(/.test(fn) || /this\.ledger\.(mutate|ledgerTx)\s*\(/.test(fn);
      if (fundsFn && giWrite >= 0 && !(lock >= 0 && lock < giWrite)) {
        problems.push(`资金事务函数缺锁先行（Y0b-2 Z89 漏报加固）：${rel}——含 mutate/ledgerTx 且 GI 写前无 lockBalance`);
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
    return e.name.endsWith('.ts') ? [p] : [];   // Z116：.spec.ts 纳入扫描（能力制——带证写放行，裸写违规）
  });
  const files = walk(SRC).map((f) => ({
    rel: path.relative(ROOT, f).split(path.sep).join('/'),
    src: fs.readFileSync(f, 'utf8'),
  }));
  const problems = scanFiles(files);
  if (problems.length) { console.error(`check-ledger-single-writer FAIL:\n  ${problems.join('\n  ')}`); process.exit(1); }
  console.log(`check-ledger-single-writer OK: ${files.length} 文件——写入口唯一（全操作集+Many）+balance 写白名单+raw 形态带 teamId+零 readCanvas+台账查询带 teamId+锁序锚+tx() 禁用+资金函数锁先行+测试能力制（Z116）`);
}
