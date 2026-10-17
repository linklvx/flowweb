#!/usr/bin/env node
// scripts/check-collab-module-size.mjs —— Y0c T42（B3）：collab 模块本体行数防倒退门禁。
// plan T42 行：「gateway 本体只剩钩子编排+协议适配（≤600 行防倒退锚）+check-collab-module-size.mjs*
// （Z96 计法=对齐 wc -l：content.replace(/\n$/,'').split('\n').length）」。
// 锚语义=**防倒退禁再膨胀**（非可达目标值——spec §0.6 偏离 65：≤600 字面为 plan 原锚，按 B3 完成
// 实测重标，gateway 终标=934〔T42 实测：1031→934，手段①server 工厂/②observability wiring/
// ④钩子壳内联，手段③委托位零退役=控制方裁决「协议适配面载体+RC5 行为零变化结构保证」〕；
// T43 确认点⑥ 呈报义务注记见 spec §0.6 偏离 76）。SG/DR/persistence=偏离 65/74 既有锚原值。
// residency 不入锚——片 A 文件非片 B 产物（设计 t41-b2-design §7.2 口径）。
// 退出码：0=PASS；1=FAIL（超限——收敛削减不回写锚，膨胀即红）；2=结构性错误（锚文件缺失）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 执法锚四文件（T42 B3 出口终标——变更锚值=有意识动作：自测 SIZE_LIMITS 断言同批改）。 */
export const SIZE_LIMITS = {
  'apps/api/src/modules/collab/collab.gateway.ts': 934,   // T42 B3 实测终标（偏离 65 兑现：plan ≤600 字面=防倒退锚非可达值——1031→934，手段①②④；手段③委托位零退役）
  'apps/api/src/modules/collab/collab-session-guard.service.ts': 1238,   // T41 W3b B2 实测（偏离 65/74）
  'apps/api/src/modules/collab/collab-doc-registry.service.ts': 1082,   // T41 W3a B2 实测（偏离 65/74）
  'apps/api/src/modules/collab/collab-persistence.service.ts': 950,   // T40 B1 实测（偏离 65；B3 承接账②删参后 949≤950——锚不回写=上界语义）
};

/** Z96 计法（plan 钉死）：对齐 wc -l（尾换行文件两口径一致；无尾换行差 1——自测钉）。 */
export function countLines(content) {
  return content.replace(/\n$/, '').split('\n').length;
}

/** 判定核（readFn 注入可测）：返回 { structural, results[{file,lines,limit,pass}] }。 */
export function checkSizes(limits, readFn = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')) {
  const results = [];
  for (const [file, limit] of Object.entries(limits)) {
    let content;
    try { content = readFn(file); } catch { return { structural: file, results: [] }; }
    const lines = countLines(content);
    results.push({ file, lines, limit, pass: lines <= limit });
  }
  return { structural: null, results };
}

function isMain() { return process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href; }

if (isMain()) {
  const { structural, results } = checkSizes(SIZE_LIMITS);
  if (structural) { console.error(`check-collab-module-size: 结构性错误（exit 2）——锚文件缺失 ${structural}`); process.exit(2); }
  const pass = results.every((r) => r.pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  check-collab-module-size（T42 B3 行数防倒退锚——Z96 计法对齐 wc -l；${results.map((r) => `${path.basename(r.file).replace(/\.ts$/, '')} ${r.lines}/${r.limit}`).join(' ')}）`);
  for (const r of results.filter((x) => !x.pass)) console.log(`      - 超限 ${r.file}：实测 ${r.lines} > 锚 ${r.limit}（锚语义=防倒退禁再膨胀——偏离 65；超限即红，禁改锚绕行）`);
  if (!pass) { console.error('check-collab-module-size FAIL'); process.exit(1); }
}
