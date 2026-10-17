// apps/api/src/modules/collab/collab-observability-wiring.ts
// Y0c T42（B3 手段②）：metrics reader 注册块机械提取（设计 §7.2 手段②——B1「reader 接线留
// gateway 本体」先例在 B3 复议兑现；注册时序=构造器末原位调用，this.→gw. 机械替换零逻辑改写）。
// 读面全部经 gateway/service 公有成员（persistence.pendingBytesTotal/docRegistry.docTruth 族/
// sessionGuard.authInflight/server.hocuspocus——B1-B2 公有化后零 cast 面）。
// unregister×9 关停面留 gateway.onApplicationShutdown 原位原序（三同步块链/selfIsolate/drain/
// 关停编排序零触碰——B2 评审钉死面，本文件只管注册侧）。
// encodeAwarenessUpdate 消费随 awareness reader 迁本文件（census 组④ 执法面=encodeStateAsUpdate，
// 本迁不涉——现场核；㉒ env 表/⑮ worker 闭包登记均不涉本文件：零 env 读零 hocuspocus import）。
import { encodeAwarenessUpdate } from 'y-protocols/awareness';
import type { CollabGateway } from './collab.gateway';   // type-only 零运行时边（server.factory 同款先例）
import type { PrismaService } from '../../prisma/prisma.service';
import { registerPendingCollector, registerAuthInflightReader, registerHeapObserverReader, registerLoadedDocBytesReader, registerFrozenDocsReader, registerDocResidueReader, registerAwarenessReader, registerOldestUnflushedReader, registerDegradedDocsReader, registerUpdatesRowsReader } from './store.metrics';

/** reader 注册单源（构造器末调用——注册序逐字保持：pendingCollector→authInflight→heapObserver→
 *  loadedDocBytes→frozenDocs→docResidue→awareness→oldestUnflushed→degradedDocs→updatesRows）。
 *  prisma 显式入参=gateway 私有字段（updatesRows reader count 消费——构造器参数名直通，公有面不扩）。 */
export function wireCollabMetricsReaders(gw: CollabGateway, prisma: PrismaService): void {
  // Y0a-2（P1+V4 单源派生）：pending 观测注册——/api/metrics collect 回调现算（零手动维护点）；
  // G-1/G-2 演练轮询面+y0a-3 /api/ready.pending 消费同一 computePending()。
  registerPendingCollector(() => gw.computePending());
  // Y0b-3 T3：collab_auth_inflight gauge collect 源（pendingCollector 同惯例——同进程单 gateway）
  registerAuthInflightReader(() => gw.sessionGuard.authInflight);   // W3b：authInflight 随域迁 SG（公有读面——B1 stuckDocsSeen 同款；reader 接线 B3 随块迁本文件）
  // Y0b-3 T4：观测 gauge collect 源（pendingBytes/zeroConnDocs）+卡住观测器独立 timer
  //（禁挂 startSessionSweep——SWEEP_ENABLED=false 逃生阀不得静默关掉观测）
  registerHeapObserverReader(() => ({
    pendingBytes: gw.persistence.pendingBytesTotal(),   // B1：Σ 队列字节读面随域迁 service（现算零台账语义不变）
    // Y0c T20（Z73 读者②）：零连接口径改读 WS/direct 分解——仅 WS 零且无 direct 持有（常驻会话
    // 在=即用态非 stuck）才计入。旧口径 connections.size===0 会把常驻会话持有的无人 doc 全量计入
    // （常驻后「零连接 doc」从异常变常态=纯噪声）；改读后 gauge 回缩为真 stuck 候选池（Z47 同族——
    // computePending residentDocs/directConns 显式字段的 per-doc 镜像）。
    zeroConnDocs: [...gw.server.hocuspocus.documents.values()].filter((d) => d.connections.size === 0 && (d.directConnectionsCount ?? 0) === 0).length,
  }));
  // Y0b-4 T3：容量聚合 gauge collect 源（Σ(truth+delta)——最近实测+插值上界口径；W3a：台账读面
  // 随域迁 DR 公有字段——reader 接线 B3 随块迁本文件）
  registerLoadedDocBytesReader(() => {
    let sum = 0;
    for (const [pid, t] of gw.docRegistry.docTruth) sum += t + (gw.docRegistry.docDelta.get(pid) ?? 0);
    return sum;
  });
  // Y0b-4 T4：冻结面 gauge collect 源（quotaFrozenDocs.size——文档级注册表，与连接在线无关）
  registerFrozenDocsReader(() => gw.docRegistry.quotaFrozenDocs.size);
  // Y0b-4 T9a：真空残留 gauge collect 源（Σ docResidue——无 projectId 标签，E54 基调）
  registerDocResidueReader(() => {
    let sum = 0;
    for (const v of gw.docRegistry.docResidue.values()) sum += v;
    return sum;
  });
  // Y0b-5 T10：awareness 两 gauge collect 源（spec §5.2/E40——collect 现算 Σ：不解码不取字段仅
  // Σ 编码字节；onAwarenessUpdate 未注册〔E73 观测钩子禁改写〕禁依赖——reader 只读 states Map）
  registerAwarenessReader(() => {
    let states = 0, bytes = 0;
    for (const d of gw.server.hocuspocus.documents.values()) {
      const aw = (d as unknown as { awareness?: { states: Map<number, unknown> } }).awareness;
      if (!aw?.states || aw.states.size === 0) continue;
      states += aw.states.size;
      bytes += encodeAwarenessUpdate(aw as never, [...aw.states.keys()]).byteLength;
    }
    return { states, bytes };
  });
  // Y0b-5 T14（E54⑤）：最老未 flush 年龄 gauge collect 源（pendingSince 台账——自愈漏清在方法内；B1 随域迁 service）
  registerOldestUnflushedReader(() => gw.persistence.oldestUnflushedAgeSeconds());
  // Y0c T15（Z111）：装载降级 gauge collect 源（degradedDocs.size——Q-O 可见化+常驻阻断判据载体）
  registerDegradedDocsReader(() => gw.docRegistry.degradedDocs.size);
  // Y0c T29-II（Z125-5）：canvasDocUpdate 总行数 gauge collect 源（prisma count 每 scrape 一次——
  // */5 巡检面可接受；观测项非机制项，行数门归 Y1c-3 再裁）。注册落点=degradedDocs 惯例同款
  //（api 侧持有 prisma 且与 gateway 同生命周期——worker 进程无 gateway⇒无 reader⇒折 0 同款语义）。
  registerUpdatesRowsReader(() => prisma.canvasDocUpdate.count());
}
