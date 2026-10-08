// scripts/lib/env-file.mjs —— 零依赖 .env 单键提取（B15：root scripts/ 解析不到 dotenv——部署门必须在
// node_modules 半损坏时仍可运行）。单源消费=deploy-guard/deploy-preflight-int。
// 语义与 dotenv 17 LINE 正则对齐（B27 实测）：export 前缀✓/重复键后者胜✓/CRLF✓；
// 行内注释三形态——未引号值首个 # 截断（无空格也截）/引号外注释丢弃/引号内 # 保留；
// 引号值取首个闭引号内内容（dq/sq/backtick 同 dotenv 分支）。多行 PEM 天然跳过（只认单行 KEY=VALUE）。
// 已设 process.env 优先由调用方展开（{...readEnvFile(...), ...process.env}——B12 不覆盖语义）。
import { readFileSync } from 'node:fs';

export function readEnvFile(path, keys) {
  const out = {};
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return out; }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || !keys.includes(m[1])) continue;
    const t = m[2].trim();
    let v;
    if (t.startsWith('"') || t.startsWith("'") || t.startsWith('`')) {
      const q = t[0];
      const end = t.indexOf(q, 1);
      v = end > 0 ? t.slice(1, end) : t.slice(1);   // 引号分支：取首个闭引号内内容（引号外注释丢弃/引号内 # 保留）
    } else {
      const h = t.indexOf('#');
      v = (h >= 0 ? t.slice(0, h) : t).trim();      // 未引号分支：dotenv 的 [^#\r\n]+ 语义——首个 # 起注释（无空格也截）
    }
    out[m[1]] = v;
  }
  return out;
}
