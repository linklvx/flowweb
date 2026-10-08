#!/usr/bin/env node
// Y0b-1（E48/Z5/Z20+三轮 Z29+四轮 Z37）：定价覆盖度门禁——**纯表驱动**（无键常量：
// 门禁 SQL 取 nt.key（'video'/'image'）vs JS 常量 'videoGen' 是两个命名空间——恒不匹配会落 else 误报基础行缺失）。
// ①kind 级：四键（outpaint/erase/redraw/lighting）各有 active 的 modelId IS NULL 规则；
// ②主链：每个 active AIModel 按其**声明行**断言——有 ModelResolution 行 ⇒ 每行一条 (model,res,null)；有 ModelDuration 行
//   ⇒ 每行一条 (model,null,dur)；皆无 ⇒ (model,null,null) 基础行。此断言与 resolver 精确匹配同键 ⇒ 兼任"选择器可达性"
//   死亡线（Z36②：门禁绿 ∧ 运行期选不中 不可能同时成立）。
// 载体=verify（deploy preflight 同链）；定价数据进迁移——CI 空库也有数据，主链断言全程生效（非空转）。
// 禁兜底补行（Z16——价格臆造=?? 0 同类）。admin 红标+/api/ready degraded 载体归 Y0b-5。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { Client } = createRequire(path.join(ROOT, 'apps/api/package.json'))('pg');
let url = process.env.DATABASE_URL;
if (!url) {
  const envPath = path.join(ROOT, 'apps/api/.env');
  const m = fs.readFileSync(envPath, 'utf8').match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m) { console.error('check-pricing-coverage: DATABASE_URL 未设置'); process.exit(2); }
  url = m[1];
}

const client = new Client({ connectionString: url });
await client.connect();
const q = (s, p = []) => client.query(s, p).then((r) => r.rows);
const problems = [];

// ① kind 级
const kindRows = await q(`SELECT nt."key", COUNT(pr.id) FILTER (WHERE pr.active AND pr."modelId" IS NULL) AS kind_rules
  FROM "NodeType" nt LEFT JOIN "PricingRule" pr ON pr."nodeTypeId" = nt.id
  WHERE nt."key" IN ('outpaint','erase','redraw','lighting') GROUP BY nt."key"`);
for (const k of ['outpaint', 'erase', 'redraw', 'lighting']) {
  const row = kindRows.find((r) => r.key === k);
  if (!row || Number(row.kind_rules) < 1) problems.push(`kind 级 "${k}" 缺 active 的 modelId IS NULL 规则（迁移 INSERT 缺失或被删）`);
}

// ② 主链（纯表驱动：维度参与=模型声明——与 normalizeDimensions 声明参与制同源）
const models = await q('SELECT m.id, m.name, nt."key" FROM "AIModel" m JOIN "NodeType" nt ON m."nodeTypeId" = nt.id WHERE m.active');
for (const m of models) {
  const rules = await q('SELECT "resolutionId", "durationId", active FROM "PricingRule" WHERE "modelId" = $1', [m.id]);
  const act = (pred) => rules.some((r) => r.active && pred(r));
  const ress = await q('SELECT id FROM "ModelResolution" WHERE "modelId" = $1', [m.id]);
  const durs = await q('SELECT id FROM "ModelDuration" WHERE "modelId" = $1', [m.id]);
  // T2 质量审 I-1：resolver 全四键精确匹配下，双维度声明模型的 (res,dur) 交叉组合无规则=运行期
  // PRICING_RULE_MISSING 而下方两类单维度断言全绿（假绿）。把"一模型至多一类维度"假设显式化为断言；
  // 未来真需双维度模型时，本断言与覆盖断言一起扩到交叉积。
  if (ress.length > 0 && durs.length > 0)
    problems.push(`模型 ${m.name} 同时声明分辨率与时长两类维度——交叉组合 (model,res,dur) 覆盖未定义（当前架构假定一模型至多一类维度），须先扩门禁与规则集`);
  for (const rr of ress) {
    if (!act((r) => r.resolutionId === rr.id && r.durationId === null))
      problems.push(`模型 ${m.name} 缺 (model,${rr.id},null) active 规则——该分辨率档全灭（选择器不可达）`);
  }
  for (const d of durs) {
    if (!act((r) => r.durationId === d.id && r.resolutionId === null))
      problems.push(`模型 ${m.name} 缺 (model,null,${d.id}) active 规则——该时长档全灭（选择器不可达）`);
  }
  if (ress.length === 0 && durs.length === 0 && !act((r) => r.resolutionId === null && r.durationId === null))
    problems.push(`模型 ${m.name}(${m.key}) 缺 (model,null,null) active 基础规则——模型全灭`);
}
await client.end();
if (problems.length) { console.error(`check-pricing-coverage FAIL:\n  ${problems.join('\n  ')}`); process.exit(1); }
console.log(`check-pricing-coverage OK: kind 级 4 键齐 + active 模型 ${models.length} 个声明维度全覆盖（纯表驱动）`);
