/**
 * ESLint 增量门禁（plan A3 / spec O3）：
 *   - 只执行 flowweb/no-color-hex 一条新规则的 baseline 增量——存量键放行、新违例退出码 1；
 *   - 存量规则（.eslintrc.base.json 迁移的 eslint:recommended + @typescript-eslint/strict type-aware）
 *     仅信息性汇总，永不影响退出码（spec D9/O3：存量规则永不卡门禁）；
 *   - baseline 键 = {ruleId}|{文件相对路径}|sha256(TrimEnd(行文本))——无行号（行移动不触发）；
 *     同文件同文本多行塌缩为一键（O3 已接受）。
 *
 * 用法：
 *   node scripts/lint-gate.mjs                 # 门禁（验收命令：pnpm --filter @flowweb/web lint）
 *   UPDATE_BASELINE=1 node scripts/lint-gate.mjs   # 或 --update-baseline：重采 baseline（B5 控制的动作，勿日常使用）
 */
import { ESLint } from 'eslint';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const NEW_RULE_ID = 'flowweb/no-color-hex';
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(APP_ROOT, 'e2e', 'audit', 'eslint-hex-baseline.json');
const LINT_TARGETS = ['src'];

function toRelPosix(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(APP_ROOT, filePath);
  return path.relative(APP_ROOT, abs).split(path.sep).join('/');
}

/** baseline/违例共用键：ruleId | 文件相对路径(posix) | sha256(TrimEnd(行文本))。刻意不含行号。 */
export function violationKey(ruleId, filePath, lineText) {
  const trimmed = String(lineText).replace(/\s+$/u, ''); // TrimEnd：兼容 CRLF 尾部 \r 与行尾空白
  const hash = createHash('sha256').update(trimmed, 'utf8').digest('hex');
  return `${ruleId}|${toRelPosix(filePath)}|${hash}`;
}

/**
 * 增量 diff：返回不在 baseline 的违例（按键去重，含 key 字段）。baselineKeys 为空数组 = 无 baseline，
 * 全部判新增（首次采集前门禁必红，防止静默放行）。
 */
export function diffNewViolations(baselineKeys, violations) {
  const base = new Set(baselineKeys);
  const seen = new Set();
  const added = [];
  for (const v of violations) {
    const key = violationKey(v.ruleId, v.filePath, v.lineText);
    if (base.has(key) || seen.has(key)) continue;
    seen.add(key);
    added.push({ ...v, key });
  }
  return added;
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

function readLinesCache() {
  const cache = new Map();
  return (filePath) => {
    let lines = cache.get(filePath);
    if (!lines) {
      lines = readFileSync(filePath, 'utf8').split(/\r?\n/u);
      cache.set(filePath, lines);
    }
    return lines;
  };
}

async function runLint() {
  const eslint = new ESLint({ cwd: APP_ROOT });
  const getLines = readLinesCache();
  const newRuleViolations = [];
  const legacyCounts = new Map();
  for (const result of await eslint.lintFiles(LINT_TARGETS)) {
    for (const message of result.messages) {
      const ruleId = message.ruleId ?? '(parse error)';
      if (ruleId === NEW_RULE_ID) {
        const lineText = getLines(result.filePath)[message.line - 1] ?? '';
        newRuleViolations.push({ ruleId, filePath: result.filePath, line: message.line, lineText });
      } else {
        legacyCounts.set(ruleId, (legacyCounts.get(ruleId) ?? 0) + 1);
      }
    }
  }
  return { newRuleViolations, legacyCounts };
}

function printLegacySummary(legacyCounts, totalNew) {
  const totalLegacy = [...legacyCounts.values()].reduce((a, b) => a + b, 0);
  if (totalLegacy === 0) {
    console.log(`存量规则（不卡门禁）：0 条`);
    return;
  }
  const top = [...legacyCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([rule, n]) => `${rule}: ${n}`)
    .join('、');
  console.log(`存量规则（不卡门禁，仅信息）：${totalLegacy} 条（top5：${top}）`);
}

async function main() {
  const startedAt = Date.now();
  const updateBaseline =
    process.argv.includes('--update-baseline') || process.env.UPDATE_BASELINE === '1';

  const { newRuleViolations, legacyCounts } = await runLint();

  if (updateBaseline) {
    const keys = [...new Set(newRuleViolations.map((v) => violationKey(v.ruleId, v.filePath, v.lineText)))].sort();
    const payload = {
      meta: {
        ruleId: NEW_RULE_ID,
        capturedAt: new Date().toISOString(),
        keyFormat: '{ruleId}|{文件相对路径}|sha256(TrimEnd(行文本))——无行号，行移动不触发；同文件同文本多行塌缩为一键（O3 已接受）',
        count: keys.length,
        note: '重采 baseline 是 B5 控制的动作（B5 口径 = 新规则 0 违例）；日常开发禁止重建',
      },
      keys,
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`baseline 已重采：${keys.length} 键 → e2e/audit/eslint-hex-baseline.json`);
    return; // exit 0
  }

  const baseline = loadBaseline();
  if (!baseline) {
    console.error(`baseline 不存在（e2e/audit/eslint-hex-baseline.json）——先 UPDATE_BASELINE=1 node scripts/lint-gate.mjs 采集一次。`);
    process.exitCode = 1;
    return;
  }
  const baselineKeys = baseline.keys ?? [];
  const baselineSet = new Set(baselineKeys);

  const added = diffNewViolations(baselineKeys, newRuleViolations);
  const currentKeySet = new Set(newRuleViolations.map((v) => violationKey(v.ruleId, v.filePath, v.lineText)));
  const matched = [...currentKeySet].filter((k) => baselineSet.has(k)).length;
  const removed = baselineKeys.length - baselineSet.intersection(currentKeySet).size;

  if (added.length > 0) {
    for (const v of added) {
      const rel = toRelPosix(v.filePath);
      console.error(`新增违例 ${rel}:${v.line}  [${v.ruleId}]  ${v.lineText.trim()}`);
    }
    console.error(`flowweb/no-color-hex: ${matched} baselined, ${added.length} new → FAIL`);
    process.exitCode = 1;
  } else {
    console.log(`flowweb/no-color-hex: ${matched} baselined, 0 new → PASS`);
    if (removed > 0) {
      console.log(`（迁移进度：baseline 已消除 ${removed} 键——B2 推进中，B5 收口时归零）`);
    }
  }
  printLegacySummary(legacyCounts);
  console.log(`lint-gate 耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

const isMain =
  import.meta.url === pathToFileURL(process.argv[1] ?? '').href ||
  import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? 'x')).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 2;
  });
}
