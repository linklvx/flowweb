// V26：CanvasDocUpdate 的 INSERT 只允许出现在 canvas-doc-update.repository.ts——任何绕锁写入都会把
// stateSeq 重新变成谎话（append 侧 advisory lock 使 seq 序≡提交序的前提被静默破坏，SV3 读侧全量
// 兜底也随之失去"正常路径等价"性质）。静态断言先例=body-param-ratchet/shadow-literal.scan.spec
// （cwd=包根——import.meta 在 spec tsconfig 的 commonjs module 下 tsc 拒绝）。
// 范围=apps/api/src 全部生产 .ts（非 spec/test）；int spec 的手工 INSERT 是 .spec.ts 天然豁免；
// scripts/ 不在 src 树下（脚本走 repo 方法，禁重抄 SQL 由注释契约+评审守）。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC_ROOT = resolve(process.cwd(), 'src');

function collectProductionTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collectProductionTs(p, out);
    else if (name.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(name)) out.push(p);
  }
  return out;
}

describe('CanvasDocUpdate INSERT 单源（P23/V26）', () => {
  it('INSERT INTO "CanvasDocUpdate" 仅出现在 canvas-doc-update.repository.ts（绕锁写入=stateSeq 变谎话）', () => {
    const offenders = collectProductionTs(SRC_ROOT)
      .filter((f) => !f.endsWith('canvas-doc-update.repository.ts'))
      .filter((f) => /INSERT\s+INTO\s+"CanvasDocUpdate"/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
