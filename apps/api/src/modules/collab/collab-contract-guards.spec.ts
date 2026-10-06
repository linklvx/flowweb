// apps/api/src/modules/collab/collab-contract-guards.spec.ts
// Y0a-1 契约守卫（spec §4.3-1/2/5/10）。范围=collab 目录全部非 spec 生产文件（repository 自身=唯一入口，
// 豁免"禁直查"三条）；契约 5 只留否定断言（正向断言锚死内部写法——Y0a-2 合法重构会误红）。
// __dirname 可用性：collab.gateway.sweep.spec.ts 同款先例（spec tsconfig commonjs 下 import.meta 被
// tsc 拒绝，__dirname 恒可用）。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = __dirname;
const repoSrc = readFileSync(join(SRC, 'canvas-doc-update.repository.ts'), 'utf8');
const prodFiles = readdirSync(SRC)
  .filter((f) => f.endsWith('.ts') && !f.includes('.spec.'))
  .filter((f) => f !== 'canvas-doc-update.repository.ts')
  .map((f) => ({ name: f, src: readFileSync(join(SRC, f), 'utf8') }));

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
});
