// Y0a-1：dist 内禁 test-utils（廉价保险——故障注入已不入 src 生产面；防未来误放）
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'api', 'dist');
if (!existsSync(dist)) { console.log('SKIP: dist not built'); process.exit(0); }
const bad = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(d, e.name));
    // 路径段匹配（d 含 test-utils 目录）覆盖 mock-repo/db-fixtures/poll-until 等无魔法串文件名单独泄漏；
    // 文件名匹配兜底文件名本身含魔法串的形态
    else if (d.includes('test-utils') || e.name.includes('test-utils') || e.name.includes('failing-repo') || e.name.includes('dual-client')) bad.push(path.join(d, e.name));
  }
})(dist);
if (bad.length) { console.error('FAIL: test-utils leaked into dist:\n' + bad.join('\n')); process.exit(1); }
console.log('OK: no test-utils in dist');
