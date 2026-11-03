// scripts/check-production-charter.mjs —— T29 生产前置批 charter 发布门（deploy.sh preflight 消费）
// 判据单源=scripts/lib/gate-decision.mjs decideCharter；数据单源=scripts/production-charter.json；
// 人读面/操作序=docs/superpowers/collab-ops-runbook.md §15。
// trafficTier 是 charter 单源字段：开放生产流量=显式改档（dev-test/beta→production）+全项裁决，改动经 git 留痕——
// spec 偏离 35「前置条件纳入发布自动化，非仅 runbook 登记」。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideCharter } from './lib/gate-decision.mjs';

const here = fileURLToPath(import.meta.url);
let charter;
try {
  charter = JSON.parse(readFileSync(resolve(here, '../production-charter.json'), 'utf8'));
} catch (e) {
  console.error(`check-production-charter FAIL: charter 数据文件不可读（scripts/production-charter.json: ${e.message}）`);
  process.exit(1);
}
const v = decideCharter(charter);
console.log(`check-production-charter: ${v.verdict.toUpperCase()}（tier=${charter.trafficTier}）——${v.why}`);
process.exit(v.verdict === 'pass' ? 0 : 1);
