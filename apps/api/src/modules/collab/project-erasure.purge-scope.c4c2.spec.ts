// apps/api/src/modules/collab/project-erasure.purge-scope.c4c2.spec.ts
// C4-c2（plan C4——project-erasure）：purgeScope 内部端点 service 面单测（无 DB——collectMediaRefs
// 同族形态）。断言面：
//  - 守卫两道：限批（>50→400）/非 serving（503）——容量事故防护；
//  - 段文件 unlink（own/子目录段+.quarantine sidecar 同收）+内存索引清（hasFrames false）；
//  - 快照缓存 evict（docs 端口 invalidateSnapshotCache 逐 pid 调用）；
//  - 幂等：重复调用零段零错。
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { CollabSpoolService } from './collab-spool.service';

const docsStub = (serving = true) => ({
  isLeaseServing: () => serving,
  invalidateSnapshotCache: vi.fn(),
});

describe('C4-c2 purgeErasureScope（service 面）', () => {
  it('非 serving（lease 未持有）→503 fail-closed（调用方本轮暂停）', async () => {
    const spool = new CollabSpoolService();
    await expect(spool.purgeErasureScope(['p1'], { docs: docsStub(false) }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('限批：projectIds 超 50→400（worker 单 scope 调用恒 1 项——容量防护）', async () => {
    const spool = new CollabSpoolService();
    const tooMany = Array.from({ length: 51 }, (_, i) => `p${i}`);
    await expect(spool.purgeErasureScope(tooMany, { docs: docsStub() }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('段文件 unlink（root+owner 子目录+.quarantine sidecar 同收）+内存索引清+快照缓存 evict；幂等重跑零错', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'c4c2ps-spool-'));
    try {
      const spool = new CollabSpoolService(dir);
      spool.setOwner('owner1');
      // root 段+owner 子目录段+隔离 sidecar
      const { mkdirSync } = await import('node:fs');
      mkdirSync(join(dir, 'owner1'), { recursive: true });
      writeFileSync(join(dir, 'p1.g1.0.spool'), 'seg');
      writeFileSync(join(dir, 'owner1', 'p1.g1.1.spool'), 'seg');
      writeFileSync(join(dir, 'p1.g1.0.spool.quarantine'), '{}');
      writeFileSync(join(dir, 'p2.g1.0.spool'), 'other');   // 他项目段（不受波及）
      const docs = docsStub();
      const res = await spool.purgeErasureScope(['p1'], { docs });
      expect(res.purgedSegments).toBe(2);   // root 段+owner 子目录段（sidecar 不计数）
      expect(existsSync(join(dir, 'p1.g1.0.spool'))).toBe(false);
      expect(existsSync(join(dir, 'owner1', 'p1.g1.1.spool'))).toBe(false);
      expect(existsSync(join(dir, 'p1.g1.0.spool.quarantine'))).toBe(false);   // sidecar 同收
      expect(existsSync(join(dir, 'p2.g1.0.spool'))).toBe(true);               // 他项目保留
      expect(docs.invalidateSnapshotCache).toHaveBeenCalledWith('p1');         // 快照缓存 evict
      expect(spool.hasFrames('p1')).toBe(false);                              // 内存索引清
      // 幂等重跑：零段零错
      const again = await spool.purgeErasureScope(['p1'], { docs: docsStub() });
      expect(again.purgedSegments).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
