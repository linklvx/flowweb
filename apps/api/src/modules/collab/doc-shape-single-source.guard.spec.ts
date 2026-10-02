// apps/api/src/modules/collab/doc-shape-single-source.guard.spec.ts
// O0a-2（Spec B）符号级断言："api 无第二 doc 节点读写实现"——readDocCanvas/writeNodeToYMap
// 收编 shared docShape 单源（readRecordsFromMaps/fillDoc）后符号在 api 生产源码零命中。
// 扫描域=apps/api/src 非 spec 文件（cwd=包根——api vitest 环境陷阱登记）；api/prisma 脚本面
// 注释提及不在收编语义域，不扫。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import * as path from 'path';

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) out.push(...listTsFiles(p));
    else if (/\.(ts|tsx)$/.test(e) && !/\.(test|spec)\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

describe('api 无第二 doc 节点读写实现（O0a-2 符号级断言）', () => {
  it('readDocCanvas/writeNodeToYMap 符号在 api 源码零命中（收编 shared docShape 单源）', () => {
    const offenders: string[] = [];
    for (const f of listTsFiles(path.join(process.cwd(), 'src'))) {
      if (/readDocCanvas|writeNodeToYMap/.test(readFileSync(f, 'utf8'))) {
        offenders.push(path.relative(process.cwd(), f));
      }
    }
    expect(offenders).toEqual([]);
  });
});
