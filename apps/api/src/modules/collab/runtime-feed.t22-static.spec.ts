// apps/api/src/modules/collab/runtime-feed.t22-static.spec.ts
// Y1c T22 G5 锁序负控·静态 lint（spec §7 修正批 #10）：RuntimeFeedService 读 CanvasDoc 的 SQL
// 恒 plain SELECT——FOR SHARE 字样零命中（锁序「业务行→counter」单形态；FOR SHARE 会与维护/快照
// 互斥复活锁序面）。正常序压力（N 次无 40P01）+「去 counter」负控在 int spec（runtime-feed.t22-g5）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Y1c T22 G5：锁序静态 lint（修正批 #10——plain SELECT 禁 FOR SHARE）', () => {
  it('runtime-feed.service.ts CanvasDoc 读面零 FOR SHARE（plain SELECT 单形态）+counter upsert 恒最后段（业务行→counter）', () => {
    const file = join(process.cwd(), 'src/modules/collab/runtime-feed.service.ts');   // vitest cwd=apps/api（scripts tsconfig 无 import.meta）
    const src = readFileSync(file, 'utf8');
    expect(src).toContain('SELECT "generation", "pgSeq" FROM "CanvasDoc"');
    // 锁读字样扫描域=SQL 模板字面量（${...}` 段）——注释中的「禁 FOR SHARE」契约注记不进扫描面
    const sqlBlocks = [...src.matchAll(/`([^`]*)`/gs)].map((m) => m[1] ?? '');
    const lockReadHits = sqlBlocks.filter((b) => /FOR SHARE|FOR UPDATE/.test(b));
    expect(lockReadHits, `SQL 段禁锁读字样（发现于：${lockReadHits[0]?.slice(0, 80)}））`).toEqual([]);
    // 锁序结构断言：appendEventInTx 方法体内 CanvasDoc SELECT 行号 < counter upsert 行号（counter 恒最后拿）
    const fnBody = src.slice(src.indexOf('async appendEventInTx'), src.indexOf('async appendEvent('));
    const docReadIdx = fnBody.indexOf('FROM "CanvasDoc"');
    const counterIdx = fnBody.indexOf('ON CONFLICT ("projectId") DO UPDATE SET "lastSeq"');
    expect(docReadIdx).toBeGreaterThan(-1);
    expect(counterIdx).toBeGreaterThan(docReadIdx);   // 业务行读在前——counter 最后
  });
});
