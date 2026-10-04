#!/usr/bin/env node
// docs 门禁本体（spec docs/superpowers/specs/2026-10-05-doc-governance-closure-design.md §5.2/5.3/5.4/5.6；plan Task 1-3）
// 接入形态：批 0 以 --warn-only 挂 verify 链首 → 批 4 Task 6-3 转阻塞（去 --warn-only）。
// CLI 随批次扩充：--write-status（批 4）、--audit-sample（批 5）。
// 退出码三分契约（apps/web/scripts/lint-gate.mjs:271 先例）：0=PASS；1=门禁违规；2=结构性/环境错误
// （fail() 与外部依赖不可用——受限沙箱跑出的是"环境跑不了"而非"文档违规"，二者不得共用 exit 1）。
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = new Set(process.argv.slice(2));
const WARN_ONLY = args.has('--warn-only');

// ── 1. findRepoRoot（syncStatus.spec.ts:13 同款：向上找 pnpm-workspace.yaml，6 层找不到即 throw——防 cwd 假设错→静默扫零→假绿）
function findRepoRoot(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('findRepoRoot: 6 层内未找到 pnpm-workspace.yaml');
}
const ROOT = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const toRel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

function fail(msg) {
  console.error(`doc-gate: 结构性错误（exit 2）——${msg}`);
  process.exit(2);
}

// ── 2. 语料（口径唯一权威；排除域=docs/vendor、.worktrees、.claude/worktrees、backups、brainstorm——见 docs/README.md 排除声明）
// docs 根文件逐名列举（禁通配，防新增文件自动豁免）；docs/README.md 为 Task 1-5 产物（存在即入语料）。
const EXTRA_CORPUS = [
  ['docs/团队功能说明.md', true],
  ['docs/README.md', false],
];
const SKIP_DOC_DIRS = new Set(['vendor']);

function walkMd(dirAbs, out) {
  let entries;
  try { entries = fs.readdirSync(dirAbs, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP_DOC_DIRS.has(e.name)) continue;
    const p = path.join(dirAbs, e.name);
    if (e.isDirectory()) walkMd(p, out);
    else if (e.isFile() && e.name.endsWith('.md')) out.push(p);
  }
}

const corpus = [];
{
  const subtrees = [
    ['docs/superpowers/specs', true],
    ['docs/superpowers/plans', true],
    ['docs/superpowers/adr', false], // v1.1 新设目录，初始可空
  ];
  for (const [d, required] of subtrees) {
    const abs = path.join(ROOT, d);
    const files = [];
    if (fs.existsSync(abs)) walkMd(abs, files);
    if (required && files.length === 0) fail(`扫描子树 ${d} 为空（扫零必红）`);
    files.forEach((f) => corpus.push(f));
  }
  const sroot = [];
  if (fs.existsSync(path.join(ROOT, 'docs/superpowers'))) {
    for (const e of fs.readdirSync(path.join(ROOT, 'docs/superpowers'), { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.md')) sroot.push(path.join(ROOT, 'docs/superpowers', e.name));
    }
  }
  if (sroot.length === 0) fail('扫描子树 docs/superpowers 根级 *.md 为空（扫零必红）');
  sroot.forEach((f) => corpus.push(f));
  for (const [f, required] of EXTRA_CORPUS) {
    const abs = path.join(ROOT, f);
    if (fs.existsSync(abs)) corpus.push(abs);
    else if (required) fail(`声明语料 ${f} 不存在`);
  }
}
if (corpus.length <= 100) fail(`语料仅 ${corpus.length} 份 ≤100（cwd 假设错误导致的静默扫零防护）`);

const docs = corpus
  .map((abs) => ({ rel: toRel(abs), text: fs.readFileSync(abs, 'utf8') }))
  .sort((a, b) => (a.rel < b.rel ? -1 : 1));
const corpusMap = new Map(docs.map((d) => [d.rel, d]));

// ── 3. 名字形态（C1 引用枚举：完整路径/裸文件名 + 已知空格别名）与负例自证名单
// 不做日期剥离短名匹配：裸短名（如 material-library/audio-waveform）与代码域模块目录名系统性撞名（2026-10-05 首跑实证 6 例假阳性）；
// 无日期文档（tech-debt.md 等）的裸文件名天然就是短名形态。
// 别名机制：代码注释里 "master plan"（空格形态）指向 2026-09-30-collab-recovery-master-plan.md——枚举外的已知别名显式登记。
const ALIASES = { 'master plan': 'docs/superpowers/plans/2026-09-30-collab-recovery-master-plan.md' };
const REQUIRED_C1 = [
  'docs/superpowers/plans/2026-10-02-canvas-group-spec-b-geometry-batch.md', // spec-version 守卫测试锚 PLAN（完整路径形态）
  'docs/superpowers/specs/2026-09-28-group-geometry-batch-connect-design.md', // spec-version 守卫测试锚 SPEC（完整路径形态）
  'docs/superpowers/plans/2026-09-30-collab-recovery-master-plan.md', // 别名形态 "master plan"（e2e/api spec 判据源注释）
  'docs/superpowers/plans/collab-e2e-gate-checklist.md', // .github/workflows/ci.yml（完整路径形态）
  'docs/superpowers/tech-debt.md', // 裸短名（app.module.ts / execution.gateway.ts 注释）
  'docs/superpowers/plans/2026-09-20-canvas-domain-theme.md', // 裸文件名（themeStore.ts:1 等）
  'docs/superpowers/specs/2026-09-18-css-base-layer-theme-design.md', // 裸文件名（index.css:5 / e2e audit）
];

function docNameForms(relPath) {
  const base = relPath.slice(relPath.lastIndexOf('/') + 1).replace(/\.md$/, '');
  const forms = new Set([base, relPath]);
  for (const [alias, target] of Object.entries(ALIASES)) if (target === relPath) forms.add(alias);
  return forms;
}

// ── 4. 代码扫描域（apps/**、packages/**、scripts/**、.github/**；C1 引用扫描用；含 e2e audit md——它们是 CI 工件）
// 排除自身 doc-gate.mjs：REQUIRED_C1 名单若被自身源码命中会构成自引用假绿。
const C1_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.css', '.scss', '.html', '.vue', '.md', '.sql', '.sh']);
const SKIP_CODE_DIRS = new Set(['node_modules', 'dist', 'coverage', '.turbo', 'test-results', 'playwright-report']);
function walkCode(dirAbs, out) {
  let entries;
  try { entries = fs.readdirSync(dirAbs, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP_CODE_DIRS.has(e.name)) continue;
    const p = path.join(dirAbs, e.name);
    if (e.isDirectory()) walkCode(p, out);
    else if (e.isFile() && C1_EXT.has(path.extname(e.name)) && !(e.name === 'doc-gate.mjs' && toRel(p).startsWith('scripts/'))) out.push(p);
  }
}
const codeFilePaths = [];
for (const d of ['apps', 'packages', 'scripts', '.github']) walkCode(path.join(ROOT, d), codeFilePaths);
codeFilePaths.sort();
if (codeFilePaths.length <= 500) fail(`代码扫描域仅 ${codeFilePaths.length} 文件 ≤500（扫零必红）`);
const codeTexts = codeFilePaths.map((f) => ({ rel: toRel(f), text: fs.readFileSync(f, 'utf8') }));

// ── 5. 匹配工具（自定义边界：相邻字符不得为 [\w-]——防 canvas-domain-theme 误命中 …-design 等前缀遮蔽/子串）
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function boundaryRegex(names) {
  const sorted = [...new Set(names)].sort((a, b) => b.length - a.length);
  return new RegExp('(?<![\\w-])(?:' + sorted.map(esc).join('|') + ')(?![\\w-])', 'g');
}
function lineAt(text, idx) {
  const line = text.slice(0, idx).split('\n').length;
  const start = text.lastIndexOf('\n', idx - 1) + 1;
  let end = text.indexOf('\n', idx);
  if (end === -1) end = text.length;
  return { line, lineText: text.slice(start, end).trim().slice(0, 120) };
}

// forms → docs 映射（同一 form 可命中多文档：specs/plans 同名已知形态）
const formsToDocs = new Map();
for (const d of docs) {
  for (const f of docNameForms(d.rel)) {
    if (!formsToDocs.has(f)) formsToDocs.set(f, new Set());
    formsToDocs.get(f).add(d.rel);
  }
}

// ── 6. C1 派生：代码域引用扫描（注释/字符串/配置均算引用——不剥注释）
const c1Evidence = new Map();
{
  const rx = boundaryRegex(formsToDocs.keys());
  for (const cf of codeTexts) {
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(cf.text)) !== null) {
      for (const docRel of formsToDocs.get(m[0])) {
        if (!c1Evidence.has(docRel)) c1Evidence.set(docRel, []);
        const ev = c1Evidence.get(docRel);
        if (ev.length < 5) {
          const { line, lineText } = lineAt(cf.text, m.index);
          ev.push({ src: cf.rel, line, text: lineText });
        }
      }
    }
  }
}
const c1Docs = [...c1Evidence.keys()].sort();
for (const req of REQUIRED_C1) {
  if (!c1Docs.includes(req)) fail(`负例自证失败：已知 C1 命中 ${req} 未出现在候选集（引用形态漂移——清单在静默缩水）`);
}

// ── 7. C2/C3 人工增补面（canonical-manual.json：criteria C2|C3 + reason 强制）
const manualItems = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/_meta/canonical-manual.json'), 'utf8')).items;
for (const it of manualItems) {
  if (!['C2', 'C3', 'C4'].includes(it.criteria) || !it.reason) fail(`canonical-manual 条目缺合法 criteria/reason：${it.path}`);
  if (!corpusMap.has(it.path)) fail(`canonical 清单项指向语料外文件：${it.path}`);
}

// ── 8. C4：被 C1 命中文档引用（入引用 ≥2；仅统计 C1 命中文档的入引用——打破"清单派生依赖清单"的自引用递归）
// 索引/登记表不得成为权威性来源（第七轮复核 P0：README 经 verify-indexes.sql 注释入 C1 源集后，
// 4 条 C4 晋升的首证全是 README 目录式提及——"被 README 列出"≠"被内容引用"）。冻结文档（决策记录）同理不赋权威。
const CANONICAL_META = new Set(['docs/README.md', 'docs/superpowers/DELETED.md']);
function head12(text) { return text.split('\n').slice(0, 12).join('\n'); }
const frozenSet = new Set(docs.filter((d) => /doc-status:\s*frozen/.test(head12(d.text))).map((d) => d.rel));
const authoritySources = (candidates) => candidates.filter((p) => !CANONICAL_META.has(p) && !frozenSet.has(p));

const c4Refs = new Map();
{
  const rx = boundaryRegex(formsToDocs.keys());
  for (const srcRel of authoritySources(c1Docs)) {
    const srcDoc = corpusMap.get(srcRel);
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(srcDoc.text)) !== null) {
      for (const t of formsToDocs.get(m[0])) {
        if (t === srcRel) continue;
        if (!c4Refs.has(t)) c4Refs.set(t, new Set());
        c4Refs.get(t).add(srcRel);
      }
    }
  }
}
const c4Docs = [...c4Refs.entries()].filter(([, refs]) => refs.size >= 2).map(([d]) => d)
  .filter((d) => !c1Docs.includes(d) && !manualItems.some((it) => it.path === d));

// ── 9. canonical 终判（比较模式——ratchet 同型基线范式；第七轮 P0：查询/verify 不写盘，漂移显式红）
// 冻结文档不进权威链（spec §5.4 排除条款：status≠ACTIVE/CANONICAL 者）。
let canonicalDrift = false;
const canonicalByPath = new Map();
for (const d of c1Docs) if (!frozenSet.has(d)) canonicalByPath.set(d, { path: d, criteria: 'C1', evidence: c1Evidence.get(d).slice(0, 3) });
for (const d of c4Docs) if (!frozenSet.has(d)) canonicalByPath.set(d, { path: d, criteria: 'C4', evidence: [...c4Refs.get(d)].map((s) => `入引用自 ${s}`) });
for (const it of manualItems) canonicalByPath.set(it.path, { path: it.path, criteria: it.criteria, evidence: [{ src: 'docs/_meta/canonical-manual.json', text: it.reason }] });
const canonical = [...canonicalByPath.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
const CANONICAL_JSON = path.join(ROOT, 'docs/_meta/canonical.json');
const derivedJson = JSON.stringify({ comment: '由 scripts/doc-gate.mjs 派生（C1/C4）+ canonical-manual.json（C2/C3）合并。勿手改——更新走 --write-canonical（漂移红后显式落盘并 review）。', items: canonical }, null, 2) + '\n';
if (args.has('--write-canonical')) {
  fs.writeFileSync(CANONICAL_JSON, derivedJson);
  console.log(`--write-canonical: 已落盘 ${canonical.length} 条`);
} else {
  const onDisk = fs.existsSync(CANONICAL_JSON) ? fs.readFileSync(CANONICAL_JSON, 'utf8') : '';
  canonicalDrift = onDisk !== derivedJson;
}
const canonicalSet = new Set(canonical.map((c) => c.path));

// ── 10. 状态五分（§5.6：canonical 身份优先——"含 dead 符号"是校验输出非分类输入）
// frozen=冻结决策记录/登记表（Spec B 两份 FROZEN、DELETED.md 索引）——不进权威链、不查 vocabulary/引用/路径（内容本体不动）。
// active 机器形态=首部 doc-status: active 行（唯一判据——遗留"状态：待确认"字样是 18 份旧文档的陈旧文本，不作数）。
// vocabulary：canonical 违规即红；active/ordinary 命中降为警告（在建文档以主题符号为叙述对象；ordinary=完成态单发文档）。
function head(text) { return text.split('\n').slice(0, 12).join('\n'); }
function isActive(doc) {
  return /doc-status:\s*active/.test(head(doc.text));
}

const canonicalInRefs = new Map();
{
  const rx = boundaryRegex(formsToDocs.keys());
  for (const c of authoritySources(canonical.map((x) => x.path))) {
    const srcDoc = corpusMap.get(c);
    if (!srcDoc) fail(`canonical 清单项指向不存在文件：${c}`);
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(srcDoc.text)) !== null) {
      for (const t of formsToDocs.get(m[0])) {
        if (t === c) continue;
        if (!canonicalInRefs.has(t)) canonicalInRefs.set(t, new Set());
        canonicalInRefs.get(t).add(c);
      }
    }
  }
}

const cls = new Map();
for (const d of docs) {
  if (frozenSet.has(d.rel)) cls.set(d.rel, 'frozen');
  else if (canonicalSet.has(d.rel)) cls.set(d.rel, 'canonical');
  else if (isActive(d)) cls.set(d.rel, 'active');
  else if (d.rel.startsWith('docs/superpowers/plans/') || !((canonicalInRefs.get(d.rel) || new Set()).size > 0)) cls.set(d.rel, 'historical');
  else cls.set(d.rel, 'ordinary');
}
const counts = { canonical: 0, active: 0, frozen: 0, historical: 0, ordinary: 0 };
for (const c of cls.values()) counts[c]++;
if (counts.canonical + counts.active + counts.frozen + counts.historical + counts.ordinary !== docs.length)
  fail(`分类完备性失败：五态之和 ${counts.canonical + counts.active + counts.frozen + counts.historical + counts.ordinary} ≠ 扫描总数 ${docs.length}`);

// ── 11. 双向自校验（按 kind 分流）：dead=scope 内零存在（剥注释——墓碑注释不算存在）；never-built/frozen 不做代码存在性校验
// 代码存在性扫描域=apps/*/src + packages/*/src + apps/api/prisma/verify-indexes.sql（现行断言载体）的**生产代码**；
// 不含 migrations/（历史事实载体）；不含 *.spec.ts/*.test.ts——守卫测试以符号名为断言素材（如 template.market-removal.guard 断言
// saveCanvas 零残留，其正则字面量含符号名属合法存在），死符号残留于测试块的清理由删除批次"连带 describe/it 块同删"纪律承载（批 1）。
function stripComments(text, isSql) {
  let s = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  if (isSql) return s.replace(/--[^\n]*/g, ' ');
  return s.replace(/(^|[^:'"\\\w])\/\/[^\n]*/g, '$1'); // 跳过 "://"（URL 字符串）
}
const deadInfo = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/_meta/dead-symbols.json'), 'utf8'));
const SELF_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.sql']);
const selfFiles = codeTexts
  .filter((f) => SELF_EXT.has(path.extname(f.rel)) && (/^apps\/[^/]+\/src\//.test(f.rel) || /^packages\/[^/]+\/src\//.test(f.rel) || f.rel === 'apps/api/prisma/verify-indexes.sql'))
  .filter((f) => !/[.](spec|test)[.][tj]sx?$/.test(f.rel))
  .map((f) => ({ rel: f.rel, text: stripComments(f.text, f.rel.endsWith('.sql')) }));
const scopeCache = new Map();
function scopeFiles(scope) {
  if (scopeCache.has(scope)) return scopeCache.get(scope);
  const list = scope === 'repo' ? selfFiles : selfFiles.filter((f) => f.rel === scope || f.rel.startsWith(scope + '/'));
  scopeCache.set(scope, list);
  return list;
}
const codeHits = [];
for (const s of deadInfo.symbols.filter((x) => x.kind === 'dead')) {
  const rx = boundaryRegex([s.symbol]);
  for (const f of scopeFiles(s.scope)) {
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(f.text)) !== null) codeHits.push({ symbol: s.symbol, src: f.rel, ...lineAt(f.text, m.index) });
  }
}

// ── 12. vocabulary：canonical（∪ 机器形态 active）禁 dead/never-built 符号；frozen 是活通道不查
// 仅查 **repo-scope** dead 符号：文件级 scope=登记时已确认撞名（如 projectApi 的 ProjectData vs video-editor/types 活同名），
// 文档提及裸名无法归属死/活——词法检查按符号名归属即可判（video-editor.md 实证 5 条假阳性）。
const exemptions = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/_meta/exemptions.json'), 'utf8')).items;
const today = new Date();
const todayStr = today.toISOString().slice(0, 10);
const capStr = new Date(today.getTime() + 90 * 864e5).toISOString().slice(0, 10);
let expiredCount = 0;
const badExemptions = [];
for (const e of exemptions) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.expires_at)) { badExemptions.push(e); continue; }
  if (e.expires_at < todayStr) expiredCount++;
  if (e.expires_at > capStr) badExemptions.push(e); // 距今 >90 天=非法（无期豁免防护）
}
const exemptKeys = new Set(exemptions.map((e) => `${e.file}:${e.line}:${e.symbol}`));
const vocabSymbols = deadInfo.symbols.filter((s) => (s.kind === 'dead' || s.kind === 'never-built') && s.scope === 'repo');
const vRegex = boundaryRegex(vocabSymbols.map((s) => s.symbol));
const vocabHits = []; // canonical 违规（红）
const activeVocabWarn = []; // active/ordinary 文档命中（警告不阻断——第七轮：ordinary 原为唯一零检查类）
for (const d of docs.filter((x) => canonicalSet.has(x.rel) || cls.get(x.rel) === 'active' || cls.get(x.rel) === 'ordinary')) {
  vRegex.lastIndex = 0;
  let m;
  while ((m = vRegex.exec(d.text)) !== null) {
    const { line } = lineAt(d.text, m.index);
    const hit = { file: d.rel, line, symbol: m[0] };
    if (exemptKeys.has(`${d.rel}:${line}:${m[0]}`)) continue;
    if (canonicalSet.has(d.rel)) vocabHits.push(hit);
    else activeVocabWarn.push(hit);
  }
}

// ── 13. 引用存在性：canonical 文档内目录限定 md 路径必须存在（不查行号/锚点——锚点安全靠"指针化保留原标题行"保障）
//    + 死路径检查（第七轮）：canonical 文档提及的**代码文件**（.ts/.tsx/… 含裸文件名）在仓内无同名文件 ⇒ 分级红/警——
//      不依赖死符号清单、无归属歧义（master plan 引已删 canvasHistory.ts——读者照做即扑空）；豁免走同一 file:line:symbol 通道。
const badRefs = [];
const deadPaths = [];
const codeRefWarn = [];
const ordinaryRefWarn = [];
{
  const mdRef = /(?:\.{1,2}\/)*[A-Za-z0-9_][A-Za-z0-9_\-./]*\/[A-Za-z0-9_\-.]+\.md/g;
  const codeRef = /[A-Za-z0-9_\-./]*[A-Za-z0-9_\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|sql|vue|css|scss)\b/g;
  const resolveExists = (token, docDir) => {
    const norm = token.replace(/\/+/g, '/');
    const cands = [norm, `${docDir}/${norm}`, `docs/superpowers/${norm}`, `docs/${norm}`, `apps/web/${norm}`, `apps/api/${norm}`];
    return cands.some((c) => fs.existsSync(path.join(ROOT, c)));
  };
  // 运行时依赖：需 PATH 可执行 git（CI checkout 环境成立；受限沙箱 fail→exit 2 环境错误，不误报文档红）。
  // ls-files 只列 tracked 文件——本地未跟踪新文件按"不存在"判（裸文件名判活以 git 基线为准）。
  let trackedList;
  try {
    trackedList = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' });
  } catch (e) {
    fail(`git ls-files 不可执行——本门禁需可执行 git 的环境（受限沙箱/无 git）：${e.message}`);
  }
  const trackedBasenames = new Set(trackedList.split(/\r?\n/).map((l) => l.split('/').pop()).filter(Boolean));
  const resolveCodeExists = (token, docDir) =>
    resolveExists(token, docDir) || trackedBasenames.has(token.split('/').pop()); // 裸文件名按全仓 basename 索引判活
  const deadStems = new Set(deadInfo.symbols.filter((s) => s.kind === 'dead' || s.kind === 'never-built').map((s) => s.symbol));
  for (const d of docs.filter((x) => canonicalSet.has(x.rel) || cls.get(x.rel) === 'ordinary')) {
    const prose = d.text.replace(/```[\s\S]*?```/g, (s) => s.replace(/[^\n]/g, '')); // 保留行结构——行号与原文件一致
    const isCanon = canonicalSet.has(d.rel);
    const docDir = path.posix.dirname(d.rel);
    mdRef.lastIndex = 0;
    let m;
    while ((m = mdRef.exec(prose)) !== null) {
      if (m[0].includes('://')) continue;
      if (!resolveExists(m[0], docDir)) (isCanon ? badRefs : ordinaryRefWarn).push({ file: d.rel, token: m[0] });
    }
    codeRef.lastIndex = 0;
    while ((m = codeRef.exec(prose)) !== null) {
      const token = m[0].replace(/^[./]+/, '');
      if (!token || token.includes('://')) continue;
      const { line } = lineAt(prose, m.index);
      if (exemptKeys.has(`${d.rel}:${line}:${token}`)) continue;
      if (resolveCodeExists(token, docDir)) continue;
      // 分级：带路径前缀缺失⇒红；裸文件名缺失且词干∈死符号清单⇒红（canvasHistory.ts 类）；
      // 裸名未知或 vendor 构建产物段（dist//es//lib/）⇒警——node_modules 引源不可判（collab spec F11 引库内部文件实证）
      const stem = token.replace(/\.[a-z]+$/, '');
      const vendorArtifact = /(^|\/)(dist|es|lib|cjs|node_modules)\//.test(token) || /^(lib0|yjs|@hocuspocus|@xyflow)\//.test(token);
      const nameList = token.split('/').length > 1 && token.split('/').every((seg) => /^[A-Za-z0-9_.-]+\.[a-z]+$/.test(seg)); // "Server.ts/Hocuspocus.ts" 双名连写
      if (!isCanon || vendorArtifact || nameList) { ordinaryRefWarn.push({ file: d.rel, token }); continue; }
      if (token.includes('/') || deadStems.has(stem)) deadPaths.push({ file: d.rel, line, token });
      else codeRefWarn.push({ file: d.rel, line, token });
    }
  }
}

// ── 14. 汇总输出与退出码
const violations = [];
// binary 守卫（TD-26 第四例）：语料含 NUL ⇒ git 判二进制→diff 永久失明、.gitattributes text 声明失真，门禁必须自暴露
for (const d of docs.filter((x) => x.text.includes('\u0000'))) {
  violations.push(`[binary-corpus] 语料文档含 NUL 字节（文件已二进制化，git diff 失明而门禁报绿=静默失败）：${d.rel}——定位 0x00 还原本意文本后重 commit`);
}
if (canonicalDrift) violations.push('[canonical-drift] 派生清单与 docs/_meta/canonical.json 落盘不一致（判据面已变动）——跑 `node scripts/doc-gate.mjs --write-canonical` 更新并 review diff');
for (const h of codeHits) violations.push(`[self-check] dead 符号 \`${h.symbol}\` 仍存在于代码：${h.src}:${h.line} ${h.lineText}`);
for (const h of vocabHits) violations.push(`[vocabulary] canonical 文档含死符号 \`${h.symbol}\`：${h.file}:${h.line}（叙述性合法提及→docs/_meta/exemptions.json 登记，TTL≤90 天）`);
for (const b of badRefs) violations.push(`[ref-existence] canonical 文档引用不存在的 md：${b.file} → ${b.token}`);
for (const p of deadPaths) violations.push(`[dead-path] canonical 文档引用不存在的代码文件：${p.file}:${p.line} → ${p.token}（历史记录性提及→exemptions 登记同名 symbol）`);
for (const e of badExemptions) violations.push(`[exemption] 非法条目（expires_at 须绝对日期且距今 ≤90 天）：${JSON.stringify(e)}`);
if (expiredCount > 0) violations.push(`[exemption] 已到期豁免 ${expiredCount} 条（复核后删除或续期重登记）`);

const injectedCount = canonical.filter((c) => (corpusMap.get(c.path)?.text || '').startsWith('<!-- doc-status: canonical')).length;
const warnTotal = activeVocabWarn.length + ordinaryRefWarn.length + codeRefWarn.length;
const summary = `doc-gate: 语料 ${docs.length} 份 | canonical ${counts.canonical}（状态行注入 ${injectedCount}）/ active ${counts.active} / frozen ${counts.frozen} / historical ${counts.historical} / ordinary ${counts.ordinary} | 代码域 ${codeTexts.length} 文件 | 新增豁免待登记 ${vocabHits.length + deadPaths.length} / 已到期 ${expiredCount} | 违规 ${violations.length}${warnTotal ? `（另有警告 v${activeVocabWarn.length}/p${codeRefWarn.length + ordinaryRefWarn.length}）` : ''}`;

// ── 15. --write-status（批 4 Task 6-2/6-3）：historical 首行状态行写回 + canonical 状态行注入
// 硬要求：①按文件探测 EOL 写回（CRLF 文件 LF 注入会产出 w/mixed）②幂等——首行已有 doc-status：
// canonical 行=机器所有可刷新（verified_at_commit 随跑更新）；historical/active 行=手写含注记，跳过防覆盖。
if (args.has('--write-status')) {
  const supersedeMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/_meta/supersede-map.json'), 'utf8')).map;
  let headCommit = '';
  try {
    headCommit = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch { /* 仓库无 commit 时留空 */ }
  const now = new Date();
  const todayStr2 = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  let wrote = 0, skipped = 0, refreshed = 0;
  for (const d of docs) {
    const state = cls.get(d.rel);
    if (state !== 'historical' && state !== 'canonical') continue;
    const eol = d.text.includes('\r\n') ? '\r\n' : '\n';
    const lines = d.text.split(/\r?\n/);
    const first = lines[0] || '';
    if (first.startsWith('<!-- doc-status:')) {
      if (first.includes('doc-status: canonical') && state === 'canonical') {
        const fresh = `<!-- doc-status: canonical | anchors: - | superseded_by: - | verified_at: ${todayStr2} | verified_at_commit: ${headCommit || 'n/a'} -->`;
        if (first !== fresh) { lines[0] = fresh; fs.writeFileSync(path.join(ROOT, d.rel), lines.join(eol)); refreshed++; }
        else skipped++;
      } else skipped++;
      continue;
    }
    let line;
    if (state === 'canonical') {
      line = `<!-- doc-status: canonical | anchors: - | superseded_by: - | verified_at: ${todayStr2} | verified_at_commit: ${headCommit || 'n/a'} -->`;
    } else {
      const sup = supersedeMap[d.rel];
      line = `<!-- doc-status: historical | ${sup ? `superseded-by: ${sup} | ` : ''}verified_at: n/a -->`;
    }
    lines.unshift(line);
    fs.writeFileSync(path.join(ROOT, d.rel), lines.join(eol));
    wrote++;
  }
  console.log(`--write-status: 新注入 ${wrote}（historical+canonical）/ 刷新 ${refreshed} / 幂等跳过 ${skipped}（active 与手写 historical）`);
}

// ── 16. CLI 分支
if (args.has('--list-canonical')) {
  for (const c of canonical) console.log(`${c.criteria}\t${c.path}`);
}
if (args.has('--list-historical')) {
  for (const [r, c] of cls) if (c === 'historical') console.log(r);
}
if (args.has('--stats')) {
  console.log(summary);
  console.log('\n-- canonical --');
  for (const c of canonical) console.log(`  [${c.criteria}] ${c.path}`);
  console.log('\n-- active --');
  for (const [r, c] of cls) if (c === 'active') console.log(`  ${r}`);
  console.log('\n-- frozen --');
  for (const [r, c] of cls) if (c === 'frozen') console.log(`  ${r}`);
  console.log('\n-- ordinary --');
  for (const [r, c] of cls) if (c === 'ordinary') console.log(`  ${r}`);
  console.log(`\n-- historical ${counts.historical} 份（略；--list-historical 全量）--`);
}
if (args.has('--sample')) {
  // 确定性抽样（第七轮：G4 可复算纪律）：sha1(path+seed) 升序取前 N——无放回、可复现、--seed= 可变
  const { createHash } = await import('node:crypto');
  const nArg = [...args].find((a) => a.startsWith('--sample='));
  const n = Math.min(Number(nArg?.split('=')[1]) || 10, 200);
  const seedArg = [...args].find((a) => a.startsWith('--seed='));
  const seed = seedArg?.split('=')[1] ?? '';
  const pool = [...cls.entries()].filter(([r, c]) => c !== 'canonical' && !frozenSet.has(r)).map(([r]) => r);
  pool.sort((a, b) => (createHash('sha1').update(a + seed).digest('hex') < createHash('sha1').update(b + seed).digest('hex') ? -1 : 1));
  for (let i = 0; i < Math.min(n, pool.length); i++) console.log(pool[i]);
}
if (args.has('--gen-exemptions')) {
  console.log(JSON.stringify([...vocabHits, ...deadPaths].map((h) => ({ file: h.file, line: h.line, symbol: h.symbol, reason: '', expires_at: capStr })), null, 2));
}
if (args.has('--fill-removed-in')) {
  let changed = false;
  for (const s of deadInfo.symbols) {
    if (s.kind !== 'dead' || (s.removedIn && !/^pre-/.test(s.removedIn))) continue;
    if (!/^[A-Za-z0-9_]+$/.test(s.symbol)) continue;
    const out = execSync(`git log --oneline -S ${s.symbol} -1 -- apps packages`, { cwd: ROOT, encoding: 'utf8' }).trim();
    const hash = out.split(' ')[0];
    if (hash) { s.removedIn = hash; changed = true; }
  }
  if (changed) fs.writeFileSync(path.join(ROOT, 'docs/_meta/dead-symbols.json'), JSON.stringify(deadInfo, null, 2) + '\n');
  console.log(`--fill-removed-in: ${changed ? '已回填' : '无可回填条目'}`);
}

console.log(summary);
if (activeVocabWarn.length > 0) {
  const byFile = new Map();
  for (const w of activeVocabWarn) byFile.set(w.file, (byFile.get(w.file) || 0) + 1);
  console.warn(`doc-gate [active-warn] 在建文档叙述性命中（不阻断，离开 active 态硬化）：\n${[...byFile].map(([f, n]) => `  ${f} ×${n}`).join('\n')}`);
}
if (violations.length > 0) {
  const lines = violations.slice(0, 60).map((v) => `  ${v}`);
  if (violations.length > 60) lines.push(`  …（共 ${violations.length} 条，全量见 --stats 或修 docs/_meta 后复跑）`);
  if (WARN_ONLY) {
    console.warn(`doc-gate [warn-only]：${violations.length} 条违规暂不阻断（批 4 转阻塞）——\n${lines.join('\n')}`);
  } else {
    console.error(`doc-gate：${violations.length} 条违规——\n${lines.join('\n')}`);
    process.exit(1);
  }
} else {
  console.log('doc-gate: PASS');
}
