#!/usr/bin/env node
// scripts/verify-chain.mjs —— T-prep runner（裁定 24⑶ 三正交轴）：
//   --tier=fast|full=前缀长度 ⊥ --skip-db=按 manifest db:true 过滤 ⊥ --static-only=fast∩skip-db（pre-commit 用）。
// manifest 单源=verify-manifest.mjs（禁在此写第二份步骤清单）；逐步 spawnSync，失败即停 exit 非零。
// 出口判据只认 `pnpm verify` 全量（verify:fast 非出口判据）；判据禁写墙钟（"<3min"是 D13 假门禁原型）。
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { VERIFY_STEPS, selectSteps } from './verify-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(argv) {
  const set = new Set(argv);
  for (const a of set) {
    if (!/^--(tier=(fast|full)|skip-db|static-only)$/.test(a)) throw new Error(`未知参数: ${a}`);
  }
  if (set.has('--tier=fast') && set.has('--tier=full')) throw new Error('--tier=fast/full 互斥');
  if (set.has('--tier=full') && set.has('--static-only')) throw new Error('--static-only 隐含 --tier=fast，不得与 --tier=full 同传');
  const tier = set.has('--tier=fast') || set.has('--static-only') ? 'fast' : 'full';
  const skipDb = set.has('--skip-db') || set.has('--static-only');
  return { tier, skipDb };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const steps = selectSteps(opts);
  const label = `tier=${opts.tier}${opts.skipDb ? ' skip-db' : ''}`;
  console.log(`verify-chain: ${steps.length}/${VERIFY_STEPS.length} 步（${label}）`);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    console.log(`\n[${i + 1}/${steps.length}] ${s.id}${s.db ? ' [db]' : ''}: ${s.cmd}`);
    const r = spawnSync(s.cmd, { shell: true, stdio: 'inherit', cwd: ROOT });
    if (r.status !== 0) {
      console.error(`\nverify-chain: FAIL at [${i + 1}/${steps.length}] ${s.id}（exit ${r.status}）——${label}`);
      process.exit(r.status ?? 1);
    }
  }
  console.log(`\nverify-chain: PASS（${steps.length} 步，${label}）`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
