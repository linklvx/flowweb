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
  it('契约 1：装载读唯一入口——collab 生产文件（repository 外）不得直查 CanvasDoc+CanvasDocUpdate 拼装载', () => {
    for (const f of prodFiles) expect(f.src, f.name).not.toMatch(/canvasDocUpdate\.findMany|canvasDoc\.findUnique/);
  });
  it('契约 2：append 唯一入口——生产代码不得绕过 repo.append 直插 CanvasDocUpdate', () => {
    for (const f of prodFiles) expect(f.src, f.name).not.toMatch(/canvasDocUpdate\.create/);
  });
  it('契约 5：compact 禁 fire-and-forget（否定断言——调用形态自由，void 形态零容忍）', () => {
    for (const f of prodFiles) expect(f.src, f.name).not.toMatch(/void\s+this\.(maybeCompact|repo\.compact)\(/);
  });
  it('契约 10：stateSeq 唯一写者=compact 事务——repository 外零引用', () => {
    for (const f of prodFiles) expect(f.src, f.name).not.toMatch(/stateSeq/);
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

  it('契约 mergeUpdates 出 WS 路径（Y0a-2 X10 结构锚）：update 回调体内零 merge 编码（回调体只 push+计数阈）', () => {
    const gw = readFileSync(join(SRC, 'collab.gateway.ts'), 'utf8');
    const cb = /document\.on\('update',[\s\S]*?\n        \}\);/.exec(gw)?.[0] ?? '';
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
