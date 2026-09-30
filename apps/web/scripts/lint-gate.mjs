/**
 * ESLint 增量门禁（plan A3/B5 / spec O3）：
 *   - flowweb/no-color-hex：baseline 增量——存量键放行、新违例退出码 1；
 *   - flowweb/no-theme-utility（B5 收口第二条）：目录白名单外 text-white/text-black 直判——
 *     无 baseline（跟随域已迁 0），任何命中即退出码 1（重采 baseline 也不豁免）；
 *   - collab 静态断言三条（批0e-4）：connStatus 单写点 / getMap 三文件门 / setState 白名单——
 *     文件白名单外直判（测试文件豁免在规则内），任何命中即退出码 1（spec 2026-09-29-collab-conn-status-recovery）；
 *   - 存量规则（.eslintrc.base.json 迁移的 eslint:recommended + @typescript-eslint/strict type-aware）
 *     仅信息性汇总，永不影响退出码（spec D9/O3：存量规则永不卡门禁）；
 *   - baseline 键 = {ruleId}|{文件相对路径}|sha256(TrimEnd(行文本))——无行号（行移动不触发）；
 *     同文件同文本多行塌缩为一键（O3 已接受）。
 *
 * 用法：
 *   node scripts/lint-gate.mjs                 # 门禁（验收命令：pnpm --filter @flowweb/web lint）
 *   UPDATE_BASELINE=1 node scripts/lint-gate.mjs   # 或 --update-baseline：重采 hex baseline（B5 控制的动作，勿日常使用）
 *
 * 退出码契约：0 = PASS（hex 0 新增且 theme 0 违例）；1 = 新增违例/theme 违例或 baseline 文件缺失；2 = 运行异常。
 * （依赖 Set.prototype.intersection，需 Node >=22——已由 package.json engines 声明。）
 */
import { ESLint } from 'eslint';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const NEW_RULE_ID = 'flowweb/no-color-hex';
export const THEME_RULE_ID = 'flowweb/no-theme-utility';
/** collab 静态断言三条（批0e-4，spec 2026-09-29-collab-conn-status-recovery）：白名单外直判，无 baseline */
export const STATIC_ASSERT_RULE_IDS = new Set([
  'flowweb/no-conn-status-write', // A. connStatus 单写点（唯一写点 recomputeConnStatus 批0a）
  'flowweb/no-ydoc-getmap',       // B. getMap 三文件门（runtime/builder/undo；0.5 exec 读点落地时增补）
  'flowweb/no-store-setstate',    // C. useCanvasStore/useNodeStore.setState 白名单（协作写入路径+生命周期/UI 豁免点）
]);
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
  const themeViolations = [];
  const staticAssertViolations = [];
  const legacyCounts = new Map();
  for (const result of await eslint.lintFiles(LINT_TARGETS)) {
    for (const message of result.messages) {
      const ruleId = message.ruleId ?? '(parse error)';
      if (ruleId === NEW_RULE_ID) {
        const lineText = getLines(result.filePath)[message.line - 1] ?? '';
        newRuleViolations.push({ ruleId, filePath: result.filePath, line: message.line, lineText });
      } else if (ruleId === THEME_RULE_ID) {
        const lineText = getLines(result.filePath)[message.line - 1] ?? '';
        themeViolations.push({ ruleId, filePath: result.filePath, line: message.line, lineText });
      } else if (STATIC_ASSERT_RULE_IDS.has(ruleId)) {
        const lineText = getLines(result.filePath)[message.line - 1] ?? '';
        staticAssertViolations.push({ ruleId, filePath: result.filePath, line: message.line, lineText });
      } else {
        legacyCounts.set(ruleId, (legacyCounts.get(ruleId) ?? 0) + 1);
      }
    }
  }
  return { newRuleViolations, themeViolations, staticAssertViolations, legacyCounts };
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

  const { newRuleViolations, themeViolations, staticAssertViolations, legacyCounts } = await runLint();

  // collab 静态断言（批0e-4）无 baseline：白名单外任何命中即违例（测试文件已在规则内豁免）
  if (staticAssertViolations.length > 0) {
    for (const v of staticAssertViolations) {
      const rel = toRelPosix(v.filePath);
      console.error(`静态断言违例 ${rel}:${v.line}  [${v.ruleId}]  ${v.lineText.trim()}`);
    }
    console.error(`collab 静态断言（connStatus 单写点/getMap 门/setState 白名单）: ${staticAssertViolations.length} 违例（白名单外直判）→ FAIL`);
    process.exitCode = 1;
    return;
  }

  // no-theme-utility 无 baseline：任何命中即违例（重采 hex baseline 的动作也不豁免）
  if (themeViolations.length > 0) {
    for (const v of themeViolations) {
      const rel = toRelPosix(v.filePath);
      console.error(`theme-utility 违例 ${rel}:${v.line}  [${v.ruleId}]  ${v.lineText.trim()}`);
    }
    console.error(`${THEME_RULE_ID}: ${themeViolations.length} 违例（无 baseline，白名单外直判）→ FAIL`);
    process.exitCode = 1;
    return;
  }

  if (updateBaseline) {
    const keys = [...new Set(newRuleViolations.map((v) => violationKey(v.ruleId, v.filePath, v.lineText)))].sort();
    const payload = {
      meta: {
        ruleId: NEW_RULE_ID,
        capturedAt: new Date().toISOString(),
        keyFormat: '{ruleId}|{文件相对路径}|sha256(TrimEnd(行文本))——无行号，行移动不触发；同文件同文本多行塌缩为一键（O3 已接受）',
        count: keys.length,
        note: '重采 baseline 是 B5 控制的动作（B5 口径 = 新规则 0 违例）；日常开发禁止重建。行文本变更的机械清理（A4/B2 批次）允许伴随重键（计数不增前提），非 UPDATE_BASELINE 全量重采。',
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
    console.log(`${THEME_RULE_ID}: 0 违例（白名单外直判）→ PASS`);
    console.log(`collab 静态断言（connStatus 单写点/getMap 门/setState 白名单）: 0 违例（白名单外直判）→ PASS`);
    console.log(`flowweb/no-color-hex: ${matched} baselined, 0 new → PASS`);
    if (removed > 0) {
      console.log(`（迁移进度：baseline 已消除 ${removed} 键）`);
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
