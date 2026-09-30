// 契约锁㉗/F9：spec 全部行号引证基于 4.6.0——版本漂移=契约锁整表重验前置。CI 必跑。
// 正则锚定 lockfile packages 段条目键形态（'@hocuspocus/provider@4.6.0':）；
// snapshots 段带 peer 后缀的键（@4.6.0(y-protocols@...)）不匹配——引号紧跟版本号收口，天然排除。
import { readFileSync } from 'node:fs';
const lock = readFileSync('pnpm-lock.yaml', 'utf8');
// 批0e 评审 #2：逐包存在性断言——四包任一从 lockfile 消失时，版本断言只扫"找到的"条目会静默绿，先锁存在再锁版本。
const EXPECTED = ['provider', 'server', 'common', 'extension-redis'];
const re = /'@hocuspocus\/(provider|server|common|extension-redis)@([\d.]+)'/g;
const found = new Set();
const names = new Set();
let m;
while ((m = re.exec(lock))) {
  found.add(`${m[1]}@${m[2]}`);
  names.add(m[1]);
}
if (found.size === 0) {
  console.error('未在 lockfile 找到 @hocuspocus 条目（正则失配？）');
  process.exit(1);
}
const missing = EXPECTED.filter((p) => !names.has(p));
if (missing.length) {
  console.error('契约锁：@hocuspocus 条目缺失（四包必须都在 lockfile）:', missing);
  process.exit(1);
}
const bad = [...found].filter((s) => !s.endsWith('@4.6.0'));
if (bad.length) {
  console.error('契约锁：@hocuspocus 版本漂移（必须 pin 4.6.0 且跑契约锁全量用例）:', bad);
  process.exit(1);
}
console.log('hocuspocus pinned @4.6.0 ✓', [...found]);
