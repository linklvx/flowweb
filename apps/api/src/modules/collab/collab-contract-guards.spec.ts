// apps/api/src/modules/collab/collab-contract-guards.spec.ts
// Y0a-1 契约守卫（spec §4.3-1/2/5/10）。范围=collab 目录全部非 spec 生产文件（repository 自身=唯一入口，
// 豁免"禁直查"三条）；契约 5 只留否定断言（正向断言锚死内部写法——Y0a-2 合法重构会误红）。
// Y0a-2 Task 7 扩面：①prodFiles 收集递归化（Y0a-1 登记②——collab/ 子目录如未来 spool/ 拆分不静默失明）；
// ②mergeUpdates 出 WS 路径结构锚（X10——update 回调体零 merge 编码）；③契约 5 负向后顾（Y0a-1 登记①
// ——maybeCompact/repo.compact 裸语句形态）；④project.gone 载荷键一致（Task 6 Minor 2——emit/on 双侧锚定，
// 扫描域扩到 apps/api/src 全量生产文件）。
// 注释提及被禁 token 同判（含 stateSeq 词汇本身）——命名即耦合面，有意强 tripwire，勿加注释豁免逻辑。
// __dirname 可用性：collab.gateway.sweep.spec.ts 同款先例（spec tsconfig commonjs 下 import.meta 被
// tsc 拒绝，__dirname 恒可用）。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = __dirname;
const API_SRC = join(SRC, '..', '..');   // apps/api/src——project.gone 全仓 emit/on 扫描域
const repoSrc = readFileSync(join(SRC, 'canvas-doc-update.repository.ts'), 'utf8');

/** Y0a-1 登记②收口（Task 7）：递归收集（Node 20 readdirSync recursive 选项）——collab/ 子目录
 *  生产文件不再静默失明（doc-shape-single-source.guard 同形先例）。 */
const prodFiles = readdirSync(SRC, { recursive: true })
  .map((p) => String(p).split('\\').join('/'))
  .filter((p) => p.endsWith('.ts') && !p.includes('.spec.'))
  .filter((p) => p !== 'canvas-doc-update.repository.ts')
  .map((p) => ({ name: p, src: readFileSync(join(SRC, p), 'utf8') }));

describe('Y0a-1 冻结契约扫描', () => {
  // ── Y1c T7 登记（勘误方案 B）：载体族新面豁免——豁免≠放开，配正向形态锚（下方各 it）：
  //  ① canvas-doc-head.ts=缺头三态读面（只读 v1.7 头行水位列族——非装载读，契约 1 豁免）；
  //  ② canvas-doc-genesis.ts=genesis 建头（旧 project.service 种子写移入共双路复用——契约 1/10 豁免，
  //     stateSeq token 仅允许建行字面形态）。拆除时点：state 列族随 T9/T10/T11 拆除切片同步收口豁免。 ──
  const Y1C_CARRIER_HEAD_READER = 'canvas-doc-head.ts';
  const Y1C_GENESIS = 'canvas-doc-genesis.ts';

  it('契约 1：装载读唯一入口——collab 生产文件（repository 外）不得直查 CanvasDoc+CanvasDocUpdate 拼装载', () => {
    for (const f of prodFiles) {
      if (f.name === Y1C_CARRIER_HEAD_READER || f.name === Y1C_GENESIS) continue;   // Y1c T7 登记（豁免面=载体族水位/建头——形态锚见下两 it）
      expect(f.src, f.name).not.toMatch(/canvasDocUpdate\.findMany|canvasDoc\.findUnique/);
    }
  });
  it('契约 1 Y1c T7 正向锚：canvas-doc-head.ts 只读 v1.7 头行水位列族——零 state/增量尾装载面（非第二装载实现）', () => {
    const head = prodFiles.find((f) => f.name === Y1C_CARRIER_HEAD_READER)!;
    expect(head.src).toMatch(/canvasDoc\.findUnique/);                            // 三态读面在位
    expect(head.src).not.toMatch(/state:\s*true|preVacuumSv|canvasDocUpdate/);    // 禁装载列/增量尾（装载单源=repository 不动摇）
  });
  it('契约 1 Y1c T7 正向锚：canvas-doc-genesis.ts 不拼装载（无 findMany/findUnique——只 upsert 建行）', () => {
    const gen = prodFiles.find((f) => f.name === Y1C_GENESIS)!;
    expect(gen.src).not.toMatch(/canvasDocUpdate\.findMany|canvasDoc\.findUnique|canvasDocSnapshot\.findMany/);
  });
  it('契约 2：append 唯一入口——生产代码不得绕过 repo.append 直插 CanvasDocUpdate', () => {
    for (const f of prodFiles) expect(f.src, f.name).not.toMatch(/canvasDocUpdate\.create/);
  });
  it('契约 5：compact 禁 fire-and-forget（否定断言——调用形态自由，void 形态零容忍）', () => {
    for (const f of prodFiles) expect(f.src, f.name).not.toMatch(/void\s+this\.(maybeCompact|repo\.compact)\(/);
  });
  it('契约 10：stateSeq 唯一写者=compact 事务——repository 外零引用', () => {
    for (const f of prodFiles) {
      if (f.name === Y1C_GENESIS) continue;   // Y1c T7 登记：genesis 建头（形态锚见下 it——仅建行字面）
      expect(f.src, f.name).not.toMatch(/stateSeq/);
    }
  });
  it('契约 10 Y1c T7 形态锚：canvas-doc-genesis.ts 的 stateSeq token 全部=建行字面 `stateSeq: 0n,`（无读/无 CAS 更新/无注释提及）', () => {
    const gen = prodFiles.find((f) => f.name === Y1C_GENESIS)!;
    const tokens = gen.src.match(/stateSeq/g) ?? [];
    const literals = gen.src.match(/stateSeq: 0n\s*[,}]/g) ?? [];
    expect(tokens, 'stateSeq token 数必须=字面数（token 出现即建行字面——注释/读/更新零容忍）').toHaveLength(literals.length);
    expect(literals.length, '恰两处：CanvasDoc 头行旧种子字面+CanvasDocSnapshot(g,0,0) 新平面列').toBe(2);
  });
  it('loadUpdates 已删（唯一入口靠删除保证）', () => {
    expect(repoSrc).not.toMatch(/async loadUpdates/);
  });

  it('扫描递归化（Y0a-1 登记②收口）：prodFiles 递归收集 ≥ 平铺数量（子目录文件不静默失明）', () => {
    const flatCount = readdirSync(SRC)
      .filter((f) => f.endsWith('.ts') && !f.includes('.spec.') && f !== 'canvas-doc-update.repository.ts').length;
    expect(prodFiles.length).toBeGreaterThanOrEqual(flatCount);
    expect(prodFiles.length).toBeGreaterThan(0);
  });

  it('契约 mergeUpdates 出 WS 路径（Y0a-2 X10 结构锚；T40 B1 锚随迁：回调体随 loadDocument 监听注册块迁 collab-persistence.service observeDocument——缩进档位随新宿主嵌套深度 8→6，断言本体逐字保留，§0.6 偏离 66②）：update 回调体内零 merge 编码（回调体只 push+计数阈）', () => {
    const svc = readFileSync(join(SRC, 'collab-persistence.service.ts'), 'utf8');
    const cb = /document\.on\('update',[\s\S]*?\n {6}\}\);/.exec(svc)?.[0] ?? '';
    expect(cb, 'update 回调体定位失败').not.toBe('');
    expect(cb).not.toMatch(/mergeUpdates/);
  });

  it('契约 5 扩负向后顾（Y0a-1 登记①）：maybeCompact/repo.compact 调用行无 await 前缀即红（裸语句形态盲区）', () => {
    for (const f of prodFiles) {
      f.src.split('\n').forEach((line, i) => {
        if (/this\.(maybeCompact|repo\.compact)\(/.test(line) && !/\bawait\b/.test(line) && !/^\s*(\*|\/\/|\/\*)/.test(line)) {
          throw new Error(`${f.name}:${i + 1} compact 调用缺 await：${line.trim()}`);
        }
      });
    }
  });

  it('契约 project.gone 载荷键一致（Task 6 Minor 2 结构锚）：恰 1 订阅+≥1 emit+emit 侧 { projectIds 字面与订阅侧 payload.projectIds 读取共存', () => {
    const all: { name: string; src: string }[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts') && !e.name.includes('.spec.') && !e.name.endsWith('.d.ts')) all.push({ name: p, src: readFileSync(p, 'utf8') });
      }
    };
    walk(API_SRC);
    const subscribers = all.filter((f) => /\.on\(\s*'project\.gone'/.test(f.src));
    const emitters = all.filter((f) => /emitAsync?\(\s*'project\.gone'/.test(f.src));
    expect(subscribers).toHaveLength(1);                                   // 恰 1 订阅（单点收敛——V11）
    expect(subscribers[0].name).toBe(join(SRC, 'collab.gateway.ts'));
    expect(emitters.length).toBeGreaterThanOrEqual(1);
    for (const f of emitters) {
      expect(f.src, `${f.name}: emit 载荷必须是 { projectIds: ... } 字面`).toMatch(/'project\.gone',\s*\{\s*projectIds/);
    }
    expect(subscribers[0].src, '订阅侧必须读取 payload.projectIds').toMatch(/payload\.projectIds/);
  });
});
