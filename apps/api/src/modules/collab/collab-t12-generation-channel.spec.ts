// apps/api/src/modules/collab/collab-t12-generation-channel.spec.ts
// Y1c T12（plan v1.7 Task 12——偏离 27/D2）：vacuum=generation++/新 docName(#g) 换代通道。
//
// 【红组① v1.3 同 name 语义反例】vacuum 后 generation/docName/缓存键**必须变**（v1.3「同 name+
// epoch fence」设计存在结构性放行洞——偏离 27 推翻）。红相：canvasDocName/admitDocNameForGeneration
// 铺位函数缺席（import 即红）+ spool.switchGeneration「计数器重置自 1」（Q-I2 钉锚：现行生产语义=
// 跨代连续 seq——vacuumReplace 新代快照基线=旧代 maxSeq，C1① seedWalSeqFromPg 的 pgSeq+1 不分代）。
//
// 【红组② S2 部分陈旧客户端复活路径】全 clock<pre 客户端以旧 #g 名重连=auth generation mismatch
// 直接拒（不装载/不 SS1/不上行旧 structs）——世代身份在 docName 段（E23），非 SV clock 关系层
// （S2 Phase C/D 已证 Update 帧路径绕过 SV 门——clock 谓词防不住任意帧路径）。
//
// 【I2 三对齐】①新代快照基线=旧代 maxSeq（连续 seq——禁「换代自 1 重起」与「基线=maxSeq」并存）
// ②boot/装载播种面（pgSeq+1 不分代）与连续语义一致 ③旧代隔离段清理滞留面（谁删/何时删——
// 全提交段〔帧 seq≤pgSeq——内容已折叠进新代快照〕换代即删；含未提交帧段 sidecar 证据保全）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { formatLocalCacheKey } from '@flowweb/shared';
import { canvasDocName, admitDocNameForGeneration, projectDocName } from './doc-name.util';
import { CollabSpoolService } from './collab-spool.service';
import { CollabGateway } from './collab.gateway';
import { CollabDocumentService } from './collab-document.service';
import type { CollabResidencyService } from './collab-residency.service';
import { createMockRepo, type MockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createLeaseStub } from './test-utils/lease-stub';
import { gatewayFacade } from './test-utils/collab-gateway-test-facade';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

let spoolDir: string;
let spoolCleanup: () => Promise<void> = async () => {};
beforeEach(async () => {
  const d = await makeSpoolDir('y1c-t12-');
  spoolDir = d.dir;
  spoolCleanup = d.cleanup;
});
afterEach(async () => { await spoolCleanup(); vi.restoreAllMocks(); });

describe('Y1c T12 红组①：v1.3 同 name 语义反例——换代后 generation/docName/缓存键必须变（偏离 27）', () => {
  it('canonical docName 跨代互异：gen0=裸名 / gen1=#g1 / gen2=#g2（vacuum 前后 name 必变——同 name=红）', () => {
    expect(canvasDocName('p1', 0)).toBe('project:p1');            // 世代 0=无世代段（#g0 别名拒——单名纪律）
    expect(canvasDocName('p1', 1)).toBe('project:p1#g1');
    expect(canvasDocName('p1', 2)).toBe('project:p1#g2');
    expect(canvasDocName('p1', 1)).not.toBe(canvasDocName('p1', 0));   // v1.3 反例：同 name 语义必须死
    expect(canvasDocName('p1', 2)).not.toBe(canvasDocName('p1', 1));
    // 内部寻址（metrics docName 标签）仍裸名单源——#g 只进 wire 名
    expect(projectDocName('p1')).toBe('project:p1');
  });

  it('docName 世代准入谓词（auth/load 双校验共用单源）：陈旧 claim 拒+携带目标世代；#g0=gen0 别名拒；裸名=gen0 唯一 canonical', () => {
    // gen0：裸名收（现状存量零破坏）；#g0 拒（别名双实例防线——isValidDocName 同款「单名」纪律）
    expect(admitDocNameForGeneration('project:p1', 0)).toEqual({ ok: true });
    expect(admitDocNameForGeneration('project:p1#g0', 0)).toEqual({ ok: false, generation: 0 });
    // gen1：canonical #g1 收；裸名拒（g_client 缺省≡0<g_server——S2 复活面关闭）；旧 #g0 拒
    expect(admitDocNameForGeneration('project:p1#g1', 1)).toEqual({ ok: true });
    expect(admitDocNameForGeneration('project:p1', 1)).toEqual({ ok: false, generation: 1 });
    expect(admitDocNameForGeneration('project:p1#g0', 1)).toEqual({ ok: false, generation: 1 });
    // gen2：陈旧 #g1 拒（携带目标代 2——客户端 reconnect-new-generation 载荷源）
    expect(admitDocNameForGeneration('project:p1#g1', 2)).toEqual({ ok: false, generation: 2 });
    expect(admitDocNameForGeneration('project:p1#g2', 2)).toEqual({ ok: true });
    // 语法面照旧全拒（别名/前导零/大写）
    expect(admitDocNameForGeneration('p1', 1)).toEqual({ ok: false, generation: 1 });
    expect(admitDocNameForGeneration('project:p1#g007', 1)).toEqual({ ok: false, generation: 1 });
    expect(admitDocNameForGeneration('project:p1#G1', 1)).toEqual({ ok: false, generation: 1 });
  });

  it('客户端缓存键五元随 generation 变（4410 discardLocalCache 之外的第二防线——键变=旧缓存不可达）', () => {
    const base = { uid: 'u1', pid: 'p1', schemaVersion: 3, historyId: 'h1' };
    expect(formatLocalCacheKey({ ...base, generation: 0 }))
      .not.toBe(formatLocalCacheKey({ ...base, generation: 1 }));
    expect(formatLocalCacheKey({ ...base, generation: 1 }))
      .not.toBe(formatLocalCacheKey({ ...base, generation: 2 }));
  });

  it('vacuum 换代 close 载荷：4410 doc-vacuuming 携 {generation, discardLocalCache:true}（stateless 先行+close 权威投递）', async () => {
    const { gateway } = buildGateway();
    const doc = new Y.Doc();
    attachDoc(gateway, doc, 'p1', [makeConn('c1')]);
    // 装载播种 gen=0（真值链——红组② 同缝）；vacuum 目标代=1
    (gatewayFacade(gateway).repoRef() as unknown as MockRepo).hydrateWithRecovery.mockResolvedValueOnce({
      state: null, updates: [] as Buffer[], stateSeq: 0n, generation: 0, schemaVersion: 3, pgSeq: 0n,
    });
    const boot = new Y.Doc();
    await gateway.docRegistry.loadDocument({ document: boot, documentName: 'project:p1', socketId: 's0' } as any);
    boot.destroy();
    await gateway.docRegistry.beginVacuumEra('p1');
    const conn = firstConn(gateway, 'p1');
    const sent = (conn.sendStateless as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => JSON.parse(String(c[0])))
      .find((p) => p.code === 4410);
    expect(sent).toBeDefined();
    expect(sent).toEqual({ code: 4410, reason: 'doc-vacuuming', generation: 1, discardLocalCache: true });
    expect(conn.webSocket.close).toHaveBeenCalledWith(4410, 'doc-vacuuming');
  });
});

describe('Y1c T12 红组②+S2 目标链：装载面世代执法（auth 同谓词——双校验）', () => {
  it('换代后旧 #g 名装载拒（generationRefusal——先于 state/updates apply，不装载不 SS1 不上行）', async () => {
    const { gateway } = buildGateway();
    const repo = gatewayFacade(gateway).repoRef() as unknown as MockRepo;
    // 服务端已换代 gen=2；客户端持旧 #g1 缓存重连
    repo.hydrateWithRecovery.mockResolvedValue({ state: Buffer.from([0, 0]), updates: [] as Buffer[], stateSeq: 0n, generation: 2, schemaVersion: 3, pgSeq: 5n });
    const stale = new Y.Doc();
    await expect(gateway.docRegistry.loadDocument({ document: stale, documentName: 'project:p1#g1', socketId: 's1' } as any))
      .rejects.toMatchObject({ reason: 'generation-stale' });
    expect(stale.store.pendingStructs).toBe(null);      // 未装载（apply 先于拒绝=红）
    expect(stale.getMap('nodes').size).toBe(0);
    stale.destroy();
    // 裸名在 gen>0 同拒（g_client 缺省≡0<g_server——S2 形态②〔全 clock<pre 无世代声明〕唯一可达面关闭）
    const bare = new Y.Doc();
    await expect(gateway.docRegistry.loadDocument({ document: bare, documentName: 'project:p1', socketId: 's2' } as any))
      .rejects.toMatchObject({ reason: 'generation-stale' });
    bare.destroy();
    // canonical 新名收
    const fresh = new Y.Doc();
    await expect(gateway.docRegistry.loadDocument({ document: fresh, documentName: 'project:p1#g2', socketId: 's3' } as any)).resolves.toBeUndefined();
    fresh.destroy();
  });

  it('generation=0 真值播种（DR:403 缝）：装载后 docGeneration/generationOf 恒当代真值（0 也播种——非 truthy 门）', async () => {
    const { gateway, spool } = buildGateway();
    const repo = gatewayFacade(gateway).repoRef() as unknown as MockRepo;
    repo.hydrateWithRecovery.mockResolvedValue({ state: null, updates: [] as Buffer[], stateSeq: 0n, generation: 0, schemaVersion: 3, pgSeq: 7n });
    const doc = new Y.Doc();
    await gateway.docRegistry.loadDocument({ document: doc, documentName: 'project:p1', socketId: 's0' } as any);
    expect(gateway.docRegistry.generationOf('p1')).toBe(0);   // 改前：undefined（`if (generation)` truthy 门——0 永不播种）
    // 真值链副作用：spool 世代权威同步为 0（帧/WAL 段/PG 批行 generation 单源——非缺省 1）
    expect(spool.currentGeneration('p1')).toBe(0);
    doc.destroy();
  });
});

describe('Y1c T12 / I2 三对齐：switchGeneration 接线形态=跨代连续 seq（Q-I2 钉锚）', () => {
  it('①连续 seq：计数器不重置（新代帧 seq 承接旧代 maxSeq——与 C1① seedWalSeqFromPg〔pgSeq+1 不分代〕单源一致）+水位保留', async () => {
    const spool = buildSpool();
    spool.setWalHistory('h1');
    await spool.append('p1', new Uint8Array([1, 1]));
    await spool.append('p1', new Uint8Array([2, 2]));
    expect(spool.peekNextWalSeq('p1')).toBe(3n);
    await spool.switchGeneration('p1', 1);
    // 改前红相：walSeqCounters.set(pid, 1n)——「换代自 1 重起」与「新代快照基线=旧代 maxSeq」并存=
    // 新代帧落已发布基线之下（readConsistent 尾谓词跳过）= C1 重置链复刻（repository 头注 T12 硬输入①）
    expect(spool.peekNextWalSeq('p1')).toBe(3n);
    expect(spool.currentGeneration('p1')).toBe(1);
    // 水位保留（pgSeq 连续不归零——换代重置归 T27 SWITCHING 事务单入口）
    expect(spool.watermark('p1')?.spoolHeadSeq).toBe(2n);
  });

  it('③旧代段清理滞留面：全提交段（帧 seq≤pgSeq——内容已折叠进新代快照）换代即删（文件+sidecar）；含未提交帧段 sidecar 证据保全', async () => {
    // 场景 A（全提交段）：两帧已入 PG（pgSeq=2）但段未 confirm 回收（崩溃窗残留——boot recoverScan 重建态）
    const spoolA = buildSpool();
    spoolA.setWalHistory('h1');
    await spoolA.append('p1', new Uint8Array([1, 1]));
    await spoolA.append('p1', new Uint8Array([2, 2]));
    await spoolA.recoverScan({ systemHistory: { historyId: 'h1', epochStartedAtMs: 0 }, pgSeq: () => 2n });
    expect(spoolA.watermark('p1')?.pgSeq).toBe(2n);
    await spoolA.switchGeneration('p1', 1);
    const filesA = await segmentFiles(spoolDir);
    expect(filesA).toEqual([]);   // 全提交旧段=清理义务即时履行（谁删=switchGeneration；何时=换代提交后）
    // 场景 B（含未提交帧段）：pgSeq=1<maxSeq 2——帧 2 从未承诺 Durable，段隔离 sidecar 持久（证据面）
    const spoolB = buildSpool();
    spoolB.setWalHistory('h1');
    await spoolB.append('p1', new Uint8Array([1, 1]));
    await spoolB.append('p1', new Uint8Array([2, 2]));
    await spoolB.recoverScan({ systemHistory: { historyId: 'h1', epochStartedAtMs: 0 }, pgSeq: () => 1n });
    await spoolB.switchGeneration('p1', 1);
    const filesB = await segmentFiles(spoolDir);
    expect(filesB.length).toBeGreaterThan(0);
    expect(filesB.some((f) => f.endsWith('.quarantine'))).toBe(true);
    for (const seg of filesB.filter((f) => f.endsWith('.spool'))) {
      const sc = await readFile(join(spoolDir, 't12-owner', seg + '.quarantine'), 'utf8').catch(() => null);
      expect(sc).toContain('generation-switch');
    }
  });
});

// ══ 收口 C1（T12 双评审 Critical）：withSession fresh-open 世代名=DB 真值 ══
//  红相：canonicalDocName 只折进程内 docRegistry.docGeneration（唯一写点=loadDocument）——gen≥1 项目
//  在「进程重启后/vacuum 后/idle 释放后」doc 未装载（docGeneration 无键）⇒ 裸名 openDirectConnection
//  ⇒ 装载闸 admitDocNameForGeneration(裸名,g>0) 拒 generation-stale（REST 500）⇒ 装载因名字错永不
//  成功=鸡生蛋死锁（无自愈）。修=同 withDoc 形态（读 DB 真值→canvasDocName）；真 gateway 直构+真
//  hocuspocus openDirectConnection（评审探针形态固化）。
describe('Y1c T12 收口 C1：withSession fresh-open canonical 名=DB 真值（readGeneration→canvasDocName）', () => {
  it('gen=1 布景 doc 未装载：withSession 携 #g1 canonical 名装载成功+readCanvas 全链端到端；withDoc 对照同布景恒 ok（红=裸名折 generation-stale 永久锁死）', async () => {
    const { gateway } = buildGateway();
    const repo = gatewayFacade(gateway).repoRef() as unknown as MockRepo;
    const seedSrc = new Y.Doc();
    seedSrc.getMap('nodes').set('n1', new Y.Map([['type', 'textInput']]));
    const seed = Buffer.from(Y.encodeStateAsUpdate(seedSrc));
    seedSrc.destroy();
    // CanvasDoc 行 generation=1（DB 真值）；doc 未装载（进程重启后形态——docRegistry.docGeneration 无键）
    repo.readGeneration.mockResolvedValue(1);
    repo.readWatermark.mockResolvedValue({ pgSeq: 5n, walCheckpointSeq: 5n, generation: 1 });
    repo.hydrateWithRecovery.mockResolvedValue({ state: seed, updates: [], stateSeq: 5n, generation: 1, schemaVersion: 3, pgSeq: 5n });
    const svc = new CollabDocumentService(gateway, repo as any);
    const residency = (svc as any).residency as CollabResidencyService;   // svc 惰性自建单例（residency spec 同款装置）

    // ①主断言：withSession fresh-open ok（红：裸名 openDirectConnection→装载闸拒 {reason:'generation-stale'}——REST 500 无自愈）
    const out = await residency.withSession('p-c1', (doc) => doc.getMap('nodes').size, { mode: 'read' });
    expect(out).toBe(1);
    expect(gateway.docRegistry.generationOf('p-c1')).toBe(1);   // 装载播种真值（鸡生蛋死锁解除自证）
    expect(gateway.server.hocuspocus.documents.has('project:p-c1#g1')).toBe(true);   // canonical 名实例（非裸名别名双实例）

    // ②全链端到端：readCanvas（REST 读主链——writeExecStatus/readServerSV/writeBatch/deliverArtifact 同 withSession 通道）
    const canvas = await svc.readCanvas('p-c1');
    expect(canvas.nodes).toHaveLength(1);

    // ③withDoc 对照（同布景——T12 本体已修对的面，恒 ok）
    const svLen = await svc.withDoc('p-c1', (doc) => Y.encodeStateVector(doc).byteLength);
    expect(svLen).toBeGreaterThan(0);

    await residency.tryRelease('p-c1', 'shutdown');   // 会话收尾（disconnect+真卸载——装置不留驻）
  });
});

// ═══════════════ 装置（shrink.spec 先例同族——gateway 直构+mock repo+真 spool 临时目录）═══════════════

function buildSpool(): CollabSpoolService {
  const spool = new CollabSpoolService(spoolDir);
  spool.setOwner('t12-owner');
  return spool;
}

async function segmentFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...(await readdir(join(dir, e.name))));
    else out.push(e.name);
  }
  return out.filter((f) => f.endsWith('.spool') || f.endsWith('.quarantine'));
}

function buildGateway(): { gateway: CollabGateway; spool: CollabSpoolService } {
  const repo = createMockRepo();
  const spool = new CollabSpoolService(spoolDir);
  spool.setOwner('t12-gw-owner');
  const gateway = new CollabGateway(
    {} as any, new EventEmitter2() as any, repo as any, createLeaseStub() as any,
    { resolve: vi.fn() } as any,
    47700 + Math.floor(Math.random() * 2200),
    undefined, undefined, undefined, spool,
  );
  gatewayFacade(gateway).forceCollabState('serving');
  return { gateway, spool };
}

function attachDoc(gateway: CollabGateway, doc: Y.Doc, pid: string, conns: Array<Record<string, any>> = []): void {
  Object.assign(doc, {
    saveMutex: { runExclusive: <T,>(fn: () => Promise<T>) => fn() },
    connections: new Map(conns.map((c) => [c, null])),
    getConnections: () => conns.map((c) => ({ socketId: c.socketId })),
  });
  gateway.server.hocuspocus.documents.set(`project:${pid}`, doc as any);
}

function makeConn(id: string): Record<string, any> {
  return {
    id,
    readOnly: false,
    socketId: 'sock-' + id,
    sendStateless: vi.fn(),
    send: vi.fn(),
    messageAddress: 'project:p1',
    webSocket: { close: vi.fn() },
    context: {},
  };
}

function firstConn(gateway: CollabGateway, pid: string): Record<string, any> {
  const doc = gateway.server.hocuspocus.documents.get(`project:${pid}`);
  const key = doc?.connections.keys().next().value as unknown as Record<string, any>;
  return key;
}
