#!/usr/bin/env node
// Y0b-0（spec §9.22，v2 微修 Z15）：spec↔code 单向一致性门禁。code 为源——spec 内
// <!-- y0b0:domain --> 标记的单一 fenced 规范块必须与 code 提取集逐项相等。
// v2 终裁：①指标域 glob 化（v1 硬编码 3 文件漏 video-separate.metrics.ts——实测 4 个）；
// ②denylist 收窄为代码型 token（自然语言短语项删——spec:572 forceSyncInterval…COLLAB_TIMEOUT
// 实测命中=误报例证，门禁会被误报训练绕过）；③env 域保留。
// 域（P6 收窄）：env-keys / metric-names。退出码：0=PASS；1=门禁违规；2=结构性错误（doc-gate.mjs 先例）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');   // 本脚本在 <root>/scripts/ 下——上跳一级即仓库根（v2 原文 '../..' 实测解析到盘根 D:\，plan 笔误）
const SPEC_PATH = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'docs/superpowers/specs/2026-10-08-y0b-funds-and-access-design.md');

export function collectMetricFiles() {
  const base = path.join(ROOT, 'apps/api/src');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.metrics.ts') ? [p] : [];
  });
  return walk(base).sort();
}

// 仅代码型 token——退役机制的标识符（可 grep 到 code/迁移历史），非自然语言短语
export const DENYLIST = ['release_once', 'COLLAB_RSS_SOFT_LIMIT_BYTES', 'replay_kill'];

export function stripForDenylist(text) {
  // 剥内容保换位（doc-gate.mjs:361 先例形态）——行号与原文件一致，报错可跳转
  let t = text.replace(/<!--[\s\S]*?-->/g, (s) => s.replace(/[^\n]/g, ''));
  t = t.replace(/```[\s\S]*?```/g, (s) => s.replace(/[^\n]/g, ''));
  let prev;
  do { prev = t; t = t.replace(/（[^（）]*）/g, (s) => s.replace(/[^\n]/g, '')); } while (t !== prev);
  return t;
}

export function extractEnvKeys(envSrc) {
  const m = envSrc.match(/envSchema\s*=\s*z\.object\(\{([\s\S]*?)\n\}\)/);
  if (!m) return null;
  return [...m[1].matchAll(/^\s{2}([A-Z][A-Z0-9_]*):/gm)].map((x) => x[1]).sort();
}

export function extractMetricNames(src) {
  return [...src.matchAll(/name:\s*'([a-z0-9_]+)'/g)].map((x) => x[1]).sort();
}

export function parseFencedBlock(md, marker) {
  const i = md.indexOf(`<!-- ${marker} -->`);
  if (i < 0) return null;
  const m = md.slice(i).match(/```[a-z]*\n([\s\S]*?)```/);
  if (!m) return null;
  return m[1].split('\n').map((l) => l.replace(/^- /, '').trim()).filter(Boolean);
}

// import 零副作用（check-ecosystem.mjs 先例形态）——门禁逻辑仅在直接执行时运行，测试进程 import 本模块不被杀
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const problems = [];
  const structural = (m) => { console.error(`check-spec-consistency: 结构性错误（exit 2）——${m}`); process.exit(2); };
  const readOrStructural = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { structural(`文件不可读 ${p}: ${e.message}`); } };

  const spec = readOrStructural(SPEC_PATH);
  const stripped = stripForDenylist(spec);
  for (const d of DENYLIST) {
    if (stripped.includes(d)) {
      const line = stripped.split('\n').findIndex((l) => l.includes(d));
      problems.push(`退役标识符 "${d}" 命中正文第 ${line + 1} 行——该机制已退役，勿在规范正文复述（合法提及请置于（）历史注记或围栏内）`);
    }
  }
  const envSrc = readOrStructural(path.join(ROOT, 'apps/api/src/config/env.ts'));
  const envKeys = extractEnvKeys(envSrc) ?? structural('env.ts 无法提取 envSchema 键集');
  const specEnv = parseFencedBlock(spec, 'y0b0:env-keys') ?? structural('spec 缺 <!-- y0b0:env-keys --> fenced 块');
  const envMissing = envKeys.filter((k) => !specEnv.includes(k));
  const envStale = specEnv.filter((k) => !envKeys.includes(k));
  if (envMissing.length) problems.push(`env 键未进 spec §10 块: ${envMissing.join(', ')}`);
  if (envStale.length) problems.push(`spec §10 块含已删 env 键: ${envStale.join(', ')}`);
  const metricFiles = collectMetricFiles();
  const metricNames = extractMetricNames(metricFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n'));
  const specMetrics = parseFencedBlock(spec, 'y0b0:metric-names') ?? structural('spec 缺 <!-- y0b0:metric-names --> fenced 块');
  const mMissing = metricNames.filter((k) => !specMetrics.includes(k));
  const mStale = specMetrics.filter((k) => !metricNames.includes(k));
  if (mMissing.length) problems.push(`指标未进 spec §10 块: ${mMissing.join(', ')}`);
  if (mStale.length) problems.push(`spec §10 块含已删指标: ${mStale.join(', ')}`);

  if (problems.length) { console.error(`check-spec-consistency FAIL:\n  ${problems.join('\n  ')}`); process.exit(1); }
  console.log(`check-spec-consistency OK: denylist ${DENYLIST.length} 项零命中；env-keys ${envKeys.length} 键 ≡ spec；metric-names ${metricNames.length} 项（${metricFiles.length} 文件）≡ spec`);
}
