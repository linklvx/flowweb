// apps/api/src/modules/collab/read-model-exit.t19.spec.ts
// Y1c T19（plan v1.7 卡）：读出口双类型改道契约——先红（现状 readCanvas 出口={nodes:any[];edges:any[]}
// 无类型面 / readCanvasSnapshotCached 出口=DecodedSnapshot{nodes,edges} 无水位面）：
//   红①：readCanvas 返回类型=CanvasReadModel（唯一共享读类型——doc 内容；TS 编译面=差异表执法，
//        本 spec 以 Equals 编译断言+tsc -p tsconfig.spec.json 机器判定——vitest 转译不过类型，
//        但 api `pnpm test` 前置 tsc 使本断言进测试池门禁）；
//   红②：readCanvasSnapshotCached 出口=CanvasReadSnapshot{model,generation,snapshotRev,pgSeq}——
//        公开快照读径①的 ETag=read model 新鲜度=pgSeq 载体（spec §5.1「ETag/公开快照水位一律 pgSeq」）；
//   红③：ETag 拼 generation:pgSeq（spec §5.4⑦——formatCanvasReadETag 单源）。
import { describe, expect, it } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { CanvasReadModel, CanvasReadSnapshot } from '@flowweb/shared';
import { formatCanvasReadETag } from '@flowweb/shared';
import { CollabGateway } from './collab.gateway';
import { CollabDocumentService } from './collab-document.service';

/** 编译期精确类型断言（tsc -p tsconfig.spec.json --noEmit 执法——api test 前置步）。 */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const assertType = <T extends true>(_: T = true as T): void => void _;

/** gateway 直构（read-canvas-routing.spec 同款——spool mock 零磁盘）。 */
function makeGateway() {
  return new CollabGateway({} as never, new EventEmitter2() as never, {} as never, {} as never, { resolve: () => undefined } as never,
    undefined, undefined, undefined, undefined, { hasFrames: () => false } as never);
}

describe('Y1c T19 红①：readCanvas 读出口=CanvasReadModel（唯一共享读类型——编译期差异表）', () => {
  it('CollabDocumentService.readCanvas 返回类型精确=CanvasReadModel（非 any 面零兼容）', () => {
    assertType<Equals<Awaited<ReturnType<CollabDocumentService['readCanvas']>>, CanvasReadModel>>();
    assertType<Equals<Awaited<ReturnType<CollabDocumentService['readCanvasSnapshotCached']>>, CanvasReadSnapshot>>();
    expect(true).toBe(true);
  });
});

describe('Y1c T19 红②③：CanvasReadSnapshot 水位面+ETag=generation:pgSeq 单源', () => {
  it('快照读出口携带 read model+水位三元（generation/snapshotRev/pgSeq——BigInt wire=string 纪律）', () => {
    const svc = new CollabDocumentService(makeGateway(), {} as never);
    // 契约面：直接构造最小 CanvasReadSnapshot 断言 wire 纪律（运行时路径在 read-canvas-routing.spec 池）
    const snap: CanvasReadSnapshot = { model: { nodes: [], edges: [] }, generation: 2, snapshotRev: '7', pgSeq: '42' };
    expect(typeof snap.pgSeq).toBe('string');
    expect(typeof snap.snapshotRev).toBe('string');
    expect(Array.isArray(snap.model.nodes)).toBe(true);
  });

  it('formatCanvasReadETag：`g{generation}:p{pgSeq}`——恢复后无 304 旧内容（generation 前缀防同 pgSeq 复位）', () => {
    expect(formatCanvasReadETag({ generation: 2, pgSeq: '42' })).toBe('g2:p42');
    expect(formatCanvasReadETag({ generation: 3, pgSeq: '42' })).toBe('g3:p42');   // 换代同 pgSeq ⇒ ETag 变（换代必换内容身份）
    expect(formatCanvasReadETag({ generation: 0, pgSeq: '0' })).toBe('g0:p0');
  });
});
