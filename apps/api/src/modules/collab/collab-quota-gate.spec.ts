// apps/api/src/modules/collab/collab-quota-gate.spec.ts
// Y0b-4 T4 真红门——①持续强推才 4404（首触=冻结+快照可解释）；③回灌无损；⑤⑥编码成本（P0-1 红门）。
// 真连装置（dual-client-server kit+quota 注入）；10s 升级窗不真实等待——白盒改 overPush.firstAt
// 模拟时间流逝（零生产侵入——plan T4 推荐手法）；裸 ws close 观测=collab-ws-close-probe 先例。
// 红相：现状 beforeSync 未注册——无判据/无冻结/无 doc-status/白盒方法缺失（TypeError）。
// Y0b-4 T9a：SV 代际门三向/terminal close/serving 门（真连载体——vacuum 七步族在 collab-shrink.spec）。
import { describe, it, expect, vi } from 'vitest';
import { register } from 'prom-client';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { startDualClientServer, makeHeaderWs, type DualClientKit } from '../../test-utils/dual-client-server';
import { pollUntil } from '../../test-utils/poll-until';
import { makeFrame as frame } from '../../test-utils/frame-encoder';   // T6 外审 M1：varint 手编单源
import type { CollabGateway } from './collab.gateway';   // W3a（承接账④）：freezeDoc 参数改型——I-3④ 参数别名逃逸面闭合
import { CollabShrinkService } from './collab-shrink.service';
import { CollabMaintenanceService } from './collab-maintenance.service';   // Y1c T27：vacuum 委托单换代入口
import { gatewayFacade } from './test-utils/collab-gateway-test-facade';   // Y0c T39b 波 2：内部状态访问经 façade（check-collab-test-facade 门禁）
import { CANVAS_DOC_SCHEMA_VERSION, CLIENT_PROTOCOL_VERSION, isCollabDocStatusPayload, isCollabConnStatusPayload } from '@flowweb/shared';

/** Y1c T24 矩阵对齐夹具：节点=合法 Y.Map 信封（type+data{model:val}——标量节点值在 DENY/L2 矩阵下
 * =node-not-map 毒帧；配额测试主语=帧字节/计数非节点形状，val 差异保持帧字节量级）。 */
const setNode = (ydoc: Y.Doc, key: string, val: unknown) => {
  const node = new Y.Map(); const data = new Y.Map();
  data.set('model', val);
  node.set('type', 'textInput'); node.set('data', data);
  ydoc.getMap('nodes').set(key, node);
};

/** 小值配额（maxDocBytes 8KB/soft 6553；Update 帧闸 2×maxTxBytes=8192） */
const QUOTA_SMALL = { maxDocBytes: 8192, maxTxBytes: 4096, msgRate: 200, bytesRate: 2_097_152 };
const SOFT = Math.floor(QUOTA_SMALL.maxDocBytes * 0.8);

/** prom-client 计数增量断言（register 全局单例——恒用增量；collab-quota-truth.spec 同款） */
async function metricDelta(name: string, labels: Record<string, string>, fn: () => Promise<unknown> | unknown): Promise<number> {
  const before = await counterOf(name, labels);
  await fn();
  return (await counterOf(name, labels)) - before;
}
/** prom-client 计数现值（pollUntil 判据用——写帧到达服务端是异步的，断言前必须等计数落定） */
async function counterOf(name: string, labels: Record<string, string> = {}): Promise<number> {
  const metric: any = register.getSingleMetric(name);
  if (!metric) throw new Error(`metric ${name} 未定义（T4 未实现——红相）`);
  return (await metric.get()).values.find((s: any) => Object.entries(labels).every(([k, v]) => s.labels[k] === v))?.value ?? 0;
}
/** synced 后安置窗：provider 的初始 SyncStep2（空 diff ~2B）在 synced 事件后一拍才达服务端——
 *  基线前消化掉（否则混入冻结期计数/快路径计数——帧型实证 1:2） */
const settle = () => sleep(200);

/** 连接并捕获裸 ws close（code+reason）——4404/1009 断连观测（onSocket 对每代 socket 挂监听） */
function connectWithCloseSpy(kit: DualClientKit, name: string) {
  let closeInfo: { code: number; reason: string } | null = null;
  const onClose = (ws: import('ws')) => ws.once('close', (code: number, reason: Buffer) => {
    if (!closeInfo) closeInfo = { code, reason: reason.toString() };
  });
  const entry = kit.connect(name, 'tok', { onSocket: onClose });
  return { ...entry, closeInfo: () => closeInfo };
}

/** 白盒冻结（freezeQuota+setImmediate 落地等待——quotaFrozenDocs 与 readOnly 同一 setImmediate）。
 *  W3a（承接账④兑现）：freezeQuota 随域迁 DR 公有化——参数改型 CollabGateway，I-3④ 参数别名
 *  逃逸面闭合（cast 消失）。 */
async function freezeDoc(gw: CollabGateway, pid: string): Promise<void> {
  gw.docRegistry.freezeQuota(pid);
  await new Promise<void>((r) => setImmediate(() => r()));
}

const serverDoc = (gw: any, pid: string) => gw.server.hocuspocus.documents.get(`project:${pid}`);
/** Y1c T12：canonical wire 名取服务端 doc（gen>0 段名——documents Map 键） */
const serverDocNamed = (gw: any, name: string) => gw.server.hocuspocus.documents.get(name);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 裸 ws 帧构造=frame-encoder 单源（T6 外审 M1——varuint/frame 两拷贝收口，本 spec 仅 Sync/Auth 帧形）
// Y1c T9：写面一律 nodes 根（P1 shape fixture root 白名单 nodes/edges/exec/meta——旧 m 测试根换轨）

describe('Y0b-4 T4 guardSyncFrame 分层判据（Q-B v3/Q-C/Q-D/Q-S）', () => {
  it('真红门①a 首触硬限：冻结+放行本帧（客户端编辑不丢）+快照 over 先到——【非断连】', async () => {
    const kit = await startDualClientServer({}, 300, undefined, undefined, QUOTA_SMALL);
    try {
      const g = gatewayFacade(kit.gateway);
      const A = kit.connect('project:q1a');
      const B = kit.connect('project:q1a');
      await A.synced; await B.synced;
      const stateless: any[] = [];
      B.provider.on('stateless', ({ payload }: { payload: string }) => stateless.push(JSON.parse(payload)));
      // 穿 soft 前置批（fastpath 放行——truth 播种小值）→ 冷却窗外实测：measured(6KB)+bytes(3KB)>MAX → 硬限首触
      setNode(A.ydoc, 'b1', 'x'.repeat(6000));
      await pollUntil(() => B.ydoc.getMap('nodes').has('b1'), 3_000);
      g.seedTruthMeasuredAt('q1a', Date.now() - 3_000);   // 冷却窗外（白盒——进入判据④实测）
      setNode(A.ydoc, 'b2', 'y'.repeat(3000));
      await pollUntil(() => B.ydoc.getMap('nodes').has('b2'), 3_000);   // 触发帧放行不丢（硬限首触禁静默丢合法帧）
      await pollUntil(() => stateless.some((m) => m?.type === 'doc-status' && m?.quota?.state === 'over'), 3_000);   // 快照 over 先到
      await pollUntil(() => g.quotaFrozenHas('q1a'), 2_000);       // setImmediate 冻结落地
      const over = stateless.find((m) => m?.type === 'doc-status' && m?.quota?.state === 'over');
      expect(isCollabDocStatusPayload(over)).toBe(true);
      expect(over.quota.limit).toBe(QUOTA_SMALL.maxDocBytes);
      expect(over.quota.maxTxBytes).toBe(QUOTA_SMALL.maxTxBytes);
      expect(over.quota.softLimitBytes).toBe(SOFT);
      expect(over.rev).toBeGreaterThanOrEqual(2);                        // 装载播种 1+翻转自增
      expect(over.writeFrozen).toBe(true);
      expect(serverDoc(kit.gateway, 'q1a').connections.size).toBe(2);              // 分层——持续强推才 4404（非断连）
      expect(serverDoc(kit.gateway, 'q1a').getMap('nodes').has('b2')).toBe(true);  // 服务端真值含触发帧
    } finally { await kit.dispose(); }
  }, 30_000);

  it('真红门①b 持续强推：冻结后 20 帧且跨 10s → close 4404+writes_dropped{quota}；反例：3 帧突发不升级（分块粘贴不误杀——Q-D v5）', async () => {
    const kit = await startDualClientServer({}, 300, undefined, undefined, QUOTA_SMALL);
    try {
      const g = gatewayFacade(kit.gateway);
      const A = connectWithCloseSpy(kit, 'project:q1b');
      await A.synced;
      await freezeDoc(kit.gateway, 'q1b');
      const dropped = await metricDelta('collab_quota_writes_dropped_total', { reason: 'quota' }, async () => {
        for (let i = 0; i < 3; i++) setNode(A.ydoc, `k${i}`, i);        // 反例臂：3 帧突发
        await pollUntil(() => g.overPushStates().some((s) => s.count >= 3), 3_000);
        await sleep(400);                                                       // 未跨 10s 窗——不升级
        expect(A.closeInfo()).toBeNull();
        for (let i = 3; i < 20; i++) setNode(A.ydoc, `k${i}`, i);       // 补足 20 帧（真实计数）
        await pollUntil(() => g.overPushStates().some((s) => s.count >= 20), 3_000);
      });
      expect(dropped).toBeGreaterThanOrEqual(20);
      // 10s 窗模拟（白盒改 firstAt——零生产侵入；overPushStates 返回活 entry 引用，改写直落台账）；第 21 帧触发升级判定
      const st = g.overPushStates()[0];
      st.firstAt -= 10_000;
      const rejected = await metricDelta('collab_quota_frame_rejected_total', { reason: 'doc-over-quota' }, async () => {
        setNode(A.ydoc, 'final', 1);
        await pollUntil(() => A.closeInfo() !== null, 5_000);
      });
      expect(rejected).toBe(1);
      expect(A.closeInfo()).toEqual({ code: 4404, reason: 'doc-over-quota' });   // 裸 ws 观测（webSocket.close 权威路径）
    } finally { await kit.dispose(); }
  }, 30_000);

  it('帧闸 1009：Update>2×maxTxBytes → close 1009（〔maxTxBytes,2×〕区间放行进配额判据——Q-E v5）', async () => {
    const kit = await startDualClientServer({}, 300, undefined, undefined, { ...QUOTA_SMALL, maxTxBytes: 1024 });
    try {
      const A = connectWithCloseSpy(kit, 'project:q1009');
      await A.synced;
      const rejected = await metricDelta('collab_quota_frame_rejected_total', { reason: 'frame-too-large' }, async () => {
        setNode(A.ydoc, 'huge', 'z'.repeat(6000));   // 6000 > 2×1024=2048
        await pollUntil(() => A.closeInfo() !== null, 5_000);
      });
      expect(rejected).toBe(1);
      expect(A.closeInfo()).toEqual({ code: 1009, reason: 'frame-too-large' });
    } finally { await kit.dispose(); }
  }, 30_000);

  it('帧闸 4404（Y0b-5 T8 裁定 24⑧ 改写）：SyncStep2>maxDocBytes+ALLOWANCE → close 4404 doc-over-quota（SS2 大帧="本地持有 ≥8MB 服务端没有的内容经合并必然超配额"——terminal 带 QuotaBanner/shrink/export 自救非 1009 裸逃生；doc-status 通告先行）', async () => {
    const kit = await startDualClientServer({}, 300, undefined, undefined, { ...QUOTA_SMALL, maxDocBytes: 2048 });
    try {
      const client = new (makeHeaderWs({ origin: 'http://localhost:5173', cookie: 'flowweb.session_token=tok' }))(
        `${kit.url}?csv=${CLIENT_PROTOCOL_VERSION}&sv=${CANVAS_DOC_SCHEMA_VERSION}`,
      );
      await new Promise<void>((resolve, reject) => { client.once('open', resolve); client.once('error', reject); });
      client.on('error', () => { /* 关闭握手期 error 无人消费会抛——吞 */ });
      const closed = new Promise<{ code: number; reason: string }>((resolve) => {
        client.once('close', (code: number, reason: Buffer) => resolve({ code, reason: reason.toString() }));
      });
      // 先 Auth（Token=0）→ 等 authenticated 回执 → 发巨 Step2（70000 > maxDocBytes 2048+ALLOWANCE 65536=67584）
      client.send(frame('project:q4s2', 2 /* Auth */, 0 /* Token */, 'tok'));
      await new Promise<void>((resolve) => client.once('message', () => resolve()));
      const rejected = await metricDelta('collab_quota_frame_rejected_total', { reason: 'doc-over-quota' }, async () => {
        client.send(frame('project:q4s2', 0 /* Sync */, 1 /* SyncStep2 */, new Uint8Array(70_000)));
        const info = await Promise.race([closed, sleep(8_000).then(() => null)]);
        expect(info).toEqual({ code: 4404, reason: 'doc-over-quota' });
      });
      expect(rejected).toBe(1);
      // 边界臂：〔maxDocBytes, maxDocBytes+ALLOWANCE〕区间帧不再 1009（旧闸形态已废）——70KB>67584 才拒
      expect(70_000).toBeGreaterThan(2048 + 64 * 1024);
    } finally {
      await kit.dispose();
    }
  }, 30_000);

  it('闸先于 readOnly 早退：VIEWER 连接发巨帧同样过闸（早退仅跳过配额判定不跳帧闸）', async () => {
    const kit = await startDualClientServer({}, 300, undefined, undefined, { ...QUOTA_SMALL, maxTxBytes: 1024 });
    try {
      kit.permSvc.resolveWithTeam.mockResolvedValue({ role: 'PROJECT_VIEWER', teamId: 't1' });
      const V = connectWithCloseSpy(kit, 'project:q1v');
      await V.synced;
      kit.permSvc.resolveWithTeam.mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' });
      setNode(V.ydoc, 'huge', 'z'.repeat(6000));   // VIEWER 巨帧——闸先于 readOnly（否则被静默吞=无 close）
      await pollUntil(() => V.closeInfo() !== null, 5_000);
      expect(V.closeInfo()).toEqual({ code: 1009, reason: 'frame-too-large' });
    } finally { await kit.dispose(); }
  }, 30_000);

  it('编码成本⑤：冷却窗内连续 50 帧（账面触阈反复）——truth_measured===1+fastpath===49', async () => {
    const kit = await startDualClientServer({}, 300, undefined, undefined, QUOTA_SMALL);
    try {
      const g = gatewayFacade(kit.gateway);
      const A = kit.connect('project:q5');
      await A.synced; await settle();
      const m0 = await counterOf('collab_quota_truth_measured_total');
      const f0 = await counterOf('collab_quota_fastpath_total');
      // 白盒：账面 truth 抬高（stale-high——触发判据④实测后回落真值）+冷却窗基线老化
      g.seedDocTruth('q5', 7000);
      g.seedTruthMeasuredAt('q5', Date.now() - 3_000);
      for (let i = 0; i < 50; i++) setNode(A.ydoc, `k${i}`, i);   // 每帧独立事务（~20B）
      await pollUntil(async () => (await counterOf('collab_quota_fastpath_total')) - f0 >= 49, 5_000);   // 帧落定（到达异步）
      expect((await counterOf('collab_quota_truth_measured_total')) - m0).toBe(1);   // 首帧实测 1 次（P0-1：冷却窗内不重测）
      expect((await counterOf('collab_quota_fastpath_total')) - f0).toBe(49);        // 其后 49 帧全快路径
      expect(g.quotaFrozenHas('q5')).toBe(false);   // 实测回落真值——不冻结
    } finally { await kit.dispose(); }
  }, 30_000);

  it('编码成本⑥：冻结态 50 帧——truth_measured===0（over 短路零编码拒绝）+writes_dropped{quota}+50', async () => {
    const kit = await startDualClientServer({}, 300, undefined, undefined, QUOTA_SMALL);
    try {
      const A = kit.connect('project:q6');
      await A.synced; await settle();
      await freezeDoc(kit.gateway, 'q6');
      const m0 = await counterOf('collab_quota_truth_measured_total');
      const d0 = await counterOf('collab_quota_writes_dropped_total', { reason: 'quota' });
      for (let i = 0; i < 50; i++) setNode(A.ydoc, `k${i}`, i);
      await pollUntil(async () => (await counterOf('collab_quota_writes_dropped_total', { reason: 'quota' })) - d0 >= 50, 5_000);
      expect((await counterOf('collab_quota_truth_measured_total')) - m0).toBe(0);   // 判据② over 短路——冻结面零编码
      expect((await counterOf('collab_quota_writes_dropped_total', { reason: 'quota' })) - d0).toBe(50);   // readOnly 早退逐帧计数（帧间隔<10s 窗——不升级 4404）
    } finally { await kit.dispose(); }
  }, 30_000);

  it('误冻结归零：账面触阈（freezePending 排程）→确认实测<soft → truth 校准+broadcast(ok)+放行；G-1：确认窗内帧闸照常拒（非放行）', async () => {
    const kit = await startDualClientServer({}, 300, undefined, undefined, QUOTA_SMALL);
    try {
      const g = gatewayFacade(kit.gateway);
      const A = kit.connect('project:q8');
      await A.synced;
      const stateless: any[] = [];
      A.provider.on('stateless', ({ payload }: { payload: string }) => stateless.push(JSON.parse(payload)));
      // 账面 stale-high + 冷却窗内：帧走 cooled 分支 → 账面>MAX → freezePending（不立即冻结）
      g.seedDocTruth('q8', QUOTA_SMALL.maxDocBytes - 50);
      g.seedTruthMeasuredAt('q8', Date.now());
      g.seedDocDelta('q8', 0);
      setNode(A.ydoc, 'mid', 'm'.repeat(200));
      await pollUntil(() => stateless.some((m) => m?.type === 'doc-status' && m?.quota?.state === 'over'), 3_000);   // over 先通告
      await pollUntil(() => serverDoc(kit.gateway, 'q8').getMap('nodes').has('mid'), 3_000);   // 触发帧照常放行
      expect(g.quotaFrozenHas('q8')).toBe(false);                               // 两态分离——pending≠frozen
      // G-1 红门：确认窗内帧闸照常拒（pending 态不进判据②短路——②只认 quotaFrozenDocs）
      const C = connectWithCloseSpy(kit, 'project:q8');
      await C.synced;
      setNode(C.ydoc, 'huge', 'z'.repeat(9000));                          // >2×maxTxBytes=8192
      await pollUntil(() => C.closeInfo() !== null, 5_000);
      expect(C.closeInfo()).toEqual({ code: 1009, reason: 'frame-too-large' });
      await C.provider.destroy(); kit.forget(C.provider);
      // 2s 确认定时器：实测（豁免 truthBudget）回落真值 <soft → broadcast(ok)+truth 校准
      await pollUntil(() => stateless.some((m) => m?.type === 'doc-status' && m?.quota?.state === 'ok'), 5_000);
      expect(g.docTruthOf('q8')).toBeLessThan(SOFT);
      expect(g.quotaFrozenHas('q8')).toBe(false);
      setNode(A.ydoc, 'after', 'ok');
      await pollUntil(() => serverDoc(kit.gateway, 'q8').getMap('nodes').has('after'), 3_000); // 校准后放行如常
    } finally { await kit.dispose(); }
  }, 30_000);

  it('overPush idle-reset：帧间隔>5s 的 20 帧 →不升级 4404；间隔<5s 且跨 10s →升级（v6 报告1 P2-2）', async () => {
    const kit = await startDualClientServer({}, 300, undefined, undefined, QUOTA_SMALL);
    try {
      const g = gatewayFacade(kit.gateway);
      const A = connectWithCloseSpy(kit, 'project:q9');
      await A.synced; await settle();
      await freezeDoc(kit.gateway, 'q9');
      for (let i = 0; i < 20; i++) setNode(A.ydoc, `k${i}`, i);
      await pollUntil(() => g.overPushStates().some((s) => s.count >= 20), 5_000);
      // idle-reset 臂：lastAt 距今>5s（休眠恢复/慢速持续形态）→计数重置——不升级
      const st = g.overPushStates()[0];
      st.firstAt -= 10_000; st.lastAt -= 6_000;
      setNode(A.ydoc, 'wake', 1);
      await sleep(600);
      expect(A.closeInfo()).toBeNull();                              // idle-reset 生效——不升级（计数已清零）
      // 持续形态臂：重新积累 20 帧（帧间隔<5s——无 idle-reset）+firstAt 跨 10s →升级
      for (let i = 100; i < 120; i++) setNode(A.ydoc, `k${i}`, i);
      await pollUntil(() => g.overPushStates().some((s) => s.count >= 20), 5_000);
      const st2 = g.overPushStates()[0];
      st2.firstAt = Date.now() - 10_500;   // lastAt 近期（刚写）——持续形态
      setNode(A.ydoc, 'final', 1);
      await pollUntil(() => A.closeInfo() !== null, 5_000);
      expect(A.closeInfo()).toEqual({ code: 4404, reason: 'doc-over-quota' });
    } finally { await kit.dispose(); }
  }, 30_000);

  it('真红门③：冻结期本地写（库吞+计数）→thaw SyncStep1→回灌 SyncStep2→对端可见（静默分叉=红相）', async () => {
    const kit = await startDualClientServer({}, 300, undefined, undefined, QUOTA_SMALL);
    try {
      const g = gatewayFacade(kit.gateway);
      const A = kit.connect('project:q3');
      const B = kit.connect('project:q3');
      await A.synced; await B.synced; await settle();
      await freezeDoc(kit.gateway, 'q3');
      const d0 = await counterOf('collab_quota_writes_dropped_total', { reason: 'quota' });
      setNode(A.ydoc, 'fk', 'frozen-edit');
      await pollUntil(async () => (await counterOf('collab_quota_writes_dropped_total', { reason: 'quota' })) - d0 >= 1, 5_000);
      expect((await counterOf('collab_quota_writes_dropped_total', { reason: 'quota' })) - d0).toBe(1);   // 库吞+计数
      await sleep(500);
      expect(serverDoc(kit.gateway, 'q3').getMap('nodes').has('fk')).toBe(false);   // 库吞（SyncStatus(false)——静默分叉形态）
      expect(B.ydoc.getMap('nodes').has('fk')).toBe(false);
      kit.gateway.thawQuota('q3');
      await pollUntil(() => serverDoc(kit.gateway, 'q3').getMap('nodes').has('fk'), 5_000);   // 回灌 SyncStep2 落库
      await pollUntil(() => B.ydoc.getMap('nodes').has('fk'), 5_000);               // 对端可见——回灌无损
      expect(g.quotaFrozenHas('q3')).toBe(false);
    } finally { await kit.dispose(); }
  }, 30_000);

  it('writeFreeze 单源：VIEWER 冻结期加入→thaw 后仍只读（viewer 原因保留）+解冻广播无 readOnly 字段（B-1 红相）', async () => {
    const kit = await startDualClientServer({}, 300, undefined, undefined, QUOTA_SMALL);
    try {
      const g = gatewayFacade(kit.gateway);
      const A = kit.connect('project:qwf');
      await A.synced;
      await freezeDoc(kit.gateway, 'qwf');
      kit.permSvc.resolveWithTeam.mockResolvedValue({ role: 'PROJECT_VIEWER', teamId: 't1' });
      const V = kit.connect('project:qwf');
      const vStateless: any[] = [];
      V.provider.on('stateless', ({ payload }: { payload: string }) => vStateless.push(JSON.parse(payload)));
      await V.synced;
      kit.permSvc.resolveWithTeam.mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' });
      const doc = serverDoc(kit.gateway, 'qwf');
      const vConn = [...doc.connections.keys()].find((c: any) => c.socketId !== [...doc.connections.keys()][0].socketId) as any;
      const aConn = [...doc.connections.keys()].find((c: any) => c !== vConn) as any;
      expect(vConn.readOnly).toBe(true);
      expect(g.hasWriteFreezeReason(vConn, 'viewer')).toBe(true);    // auth 意图登记（connected 补推）
      expect(g.hasWriteFreezeReason(vConn, 'quota')).toBe(true);     // 冻结期加入
      kit.gateway.thawQuota('qwf');
      await new Promise<void>((r) => setImmediate(() => r()));
      expect(vConn.readOnly).toBe(true);                                    // viewer 原因保留——不误解除
      expect(aConn.readOnly).toBe(false);                                   // EDITOR 解除
      await pollUntil(() => vStateless.some((m) => m?.type === 'doc-status' && m?.quota?.state === 'ok'), 3_000);
      const ok = vStateless.find((m) => m?.type === 'doc-status' && m?.quota?.state === 'ok');
      expect(isCollabDocStatusPayload(ok)).toBe(true);
      expect(Object.keys(ok)).not.toContain('readOnly');                    // per-doc 广播无 per-conn 量（Q-A v4）
    } finally { await kit.dispose(); }
  }, 30_000);

  it('authenticated 复位 rev：doc 卸载重连后 rev 从 1 重来+翻转自增（不因旧 rev 持续爬升）——T4 最小形态', async () => {
    const kit = await startDualClientServer({}, 300, undefined, undefined, QUOTA_SMALL);
    try {
      const g = gatewayFacade(kit.gateway);
      const A = kit.connect('project:qrev');
      await A.synced;
      await freezeDoc(kit.gateway, 'qrev'); kit.gateway.thawQuota('qrev'); await freezeDoc(kit.gateway, 'qrev');   // over→ok→over 三次翻转
      expect(g.docStatusRevOf('qrev')).toBe(4);           // 播种 1+三次翻转
      await A.provider.destroy(); kit.forget(A.provider);
      await pollUntil(() => serverDoc(kit.gateway, 'qrev') === undefined, 6_000);   // 真卸载（unloadImmediately）
      expect(g.docStatusRevOf('qrev')).toBeUndefined();    // 卸载清理
      const A2 = kit.connect('project:qrev');
      const stateless: any[] = [];
      A2.provider.on('stateless', ({ payload }: { payload: string }) => stateless.push(JSON.parse(payload)));
      await A2.synced;
      expect(g.docStatusRevOf('qrev')).toBe(1);            // 重装载播种 1（客户端 lastDocStatusRev 复位归 T10）
      await freezeDoc(kit.gateway, 'qrev');
      await pollUntil(() => stateless.some((m) => m?.type === 'doc-status' && m?.quota?.state === 'over'), 3_000);
      const over = stateless.find((m) => m?.type === 'doc-status' && m?.quota?.state === 'over');
      expect(over.rev).toBe(2);                              // 复位后自增——新 epoch 从 1 起步
      expect(over.writeFrozen).toBe(true);
    } finally { await kit.dispose(); }
  }, 30_000);
});

describe('Y0b-4 T5 connected 双补推+beginDraining 并轨 doc-status（rev 生命周期）', () => {
  it('connected 即时补推：连接建立 <500ms 收到 doc-status+conn-status 双补推（VIEWER——探针②竞态废除，Q-A v5）', async () => {
    const kit = await startDualClientServer({}, 300, undefined, undefined, QUOTA_SMALL);
    try {
      kit.permSvc.resolveWithTeam.mockResolvedValue({ role: 'PROJECT_VIEWER', teamId: 't1' });
      let openedAt = 0;
      const arrivals: { msg: any; at: number }[] = [];
      const entry = kit.connect('project:qpush', 'tok', {
        onSocket: (ws) => { ws.once('open', () => { openedAt = Date.now(); }); },
      });
      entry.provider.on('stateless', ({ payload }: { payload: string }) => {
        arrivals.push({ msg: JSON.parse(payload), at: Date.now() });
      });
      await entry.synced;
      const docAt = arrivals.find((a) => a.msg?.type === 'doc-status');
      const connAt = arrivals.find((a) => a.msg?.type === 'conn-status');
      expect(docAt).toBeTruthy();                                        // doc-status 即时补推（rev 不自增=装载播种 1）
      expect(docAt!.msg.rev).toBe(1);
      expect(docAt!.at - openedAt).toBeLessThan(500);                    // 探针②竞态废除——首快照不依赖首次翻转
      expect(connAt).toBeTruthy();                                      // conn-status 双补推（viewer 意图登记同点）
      expect(isCollabConnStatusPayload(connAt!.msg)).toBe(true);
      expect(connAt!.msg.readOnly).toBe(true);
      expect(connAt!.at - openedAt).toBeLessThan(500);
    } finally { await kit.dispose(); }
  }, 30_000);

  it('beginDraining 改发 doc-status（writeFrozen:true+rev++，quota.state 不变）——type:write-frozen 退役（census ⑧：服务端清零）', async () => {
    const kit = await startDualClientServer({}, 300, undefined, undefined, QUOTA_SMALL);
    try {
      const g = gatewayFacade(kit.gateway);
      const A = kit.connect('project:qdr');
      await A.synced;
      const stateless: any[] = [];
      A.provider.on('stateless', ({ payload }: { payload: string }) => stateless.push(JSON.parse(payload)));
      const rev0 = g.docStatusRevOf('qdr')!;                            // 装载播种 1
      const r = kit.gateway.beginDraining();
      expect(r.draining).toBe(true);
      await pollUntil(() => stateless.some((m) => m?.type === 'doc-status' && m?.writeFrozen === true), 3_000);
      const frozen = stateless.find((m) => m?.type === 'doc-status' && m?.writeFrozen === true);
      expect(isCollabDocStatusPayload(frozen)).toBe(true);
      expect(frozen.rev).toBe(rev0 + 1);                                // 翻转自增（writeFrozen 维度翻转）
      expect(frozen.quota.state).toBe('ok');                            // drain 冻结≠quota over（两维度独立）
      expect(stateless.some((m) => m?.type === 'write-frozen')).toBe(false);   // 退役——生产 stateless 产生清零
    } finally { await kit.dispose(); }
  }, 30_000);

  it('快照无 readOnly 字段+quota 五键含 maxTxBytes+softLimitBytes（Q-A v5——与 T1 键集断言逐字一致）+顶层可选 generation（有则合法——T9a 产生）', async () => {
    const kit = await startDualClientServer({}, 300, undefined, undefined, QUOTA_SMALL);
    try {
      const A = kit.connect('project:qshape');
      const stateless: any[] = [];
      A.provider.on('stateless', ({ payload }: { payload: string }) => stateless.push(JSON.parse(payload)));
      await A.synced;
      const snap = stateless.find((m) => m?.type === 'doc-status');
      expect(snap).toBeTruthy();                                        // connected 补推（首快照=装载播种 rev 1）
      expect(Object.keys(snap)).not.toContain('readOnly');              // per-conn 量不进 per-doc 广播（Q-A v4）
      expect(Object.keys(snap.quota).sort()).toEqual(['bytes', 'limit', 'maxTxBytes', 'softLimitBytes', 'state']);   // 五键
      expect(snap.quota.limit).toBe(QUOTA_SMALL.maxDocBytes);
      expect(snap.quota.maxTxBytes).toBe(QUOTA_SMALL.maxTxBytes);
      expect(snap.quota.softLimitBytes).toBe(SOFT);
      expect(isCollabDocStatusPayload({ ...snap, generation: 7 })).toBe(true);   // 顶层可选 generation——T9a 产生即合法
    } finally { await kit.dispose(); }
  }, 30_000);
});

// ===== Y0b-4 T9a（Q-U v6）：SV 代际门+terminal close+serving 门（真连形态） =====

/** maintenance harness prisma mock（Y1c T27 真连 kit 委托面——collab-shrink.spec buildMaintenancePrisma
 *  同款最小面：maintenanceOperation 行存储+行级关闸/countInFlight 双 $queryRaw+审计行存储）。 */
function buildMaintenancePrisma() {
  const ops: Array<Record<string, any>> = [];
  const audits: Array<Record<string, any>> = [];
  const applyData = (row: Record<string, any>, data: Record<string, any>) => {
    for (const [k, v] of Object.entries(data)) {
      if (v != null && typeof v === 'object' && 'increment' in (v as Record<string, unknown>)) row[k] = (row[k] ?? 0) + (v as { increment: number }).increment;
      else if (k === 'drainedAt') row[k] = new Date();
      else row[k] = v;
    }
  };
  const prisma: any = {
    maintenanceOperation: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.idempotencyKey != null) return ops.find((o) => o.idempotencyKey === where.idempotencyKey) ?? null;
        return ops.find((o) => o.maintenanceId === where.maintenanceId) ?? null;
      }),
      findFirst: vi.fn(async ({ where }: any) => ops.find((o) => o.projectId === where.projectId) ?? null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: any) => { ops.push({ ...data }); return data; }),
      update: vi.fn(async ({ where, data }: any) => { const r = ops.find((o) => o.maintenanceId === where.maintenanceId); if (r) applyData(r, data); return r; }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const o of ops) {
          if (o.maintenanceId !== where.maintenanceId) continue;
          if (where.stage != null) {
            const w = where.stage as { in?: string[] } | string;
            if (typeof w === 'string' ? o.stage !== w : !(w.in ?? []).includes(o.stage)) continue;
          }
          applyData(o, data); count += 1;
        }
        return { count };
      }),
    },
    canvasDoc: {
      findUnique: vi.fn(async () => ({ generation: 0 })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    docAuditEvent: {
      create: vi.fn(async ({ data }: any) => { audits.push({ ...data }); return data; }),
      findFirst: vi.fn(async ({ where }: any) => [...audits].reverse().find((a) => a.requestId === where.requestId) ?? null),
    },
    $transaction: null as unknown,
    $queryRaw: vi.fn(async (...args: unknown[]) => {
      const sql = String(args[0]);
      if (sql.includes('UPDATE "CanvasDoc"')) return [{ generation: 0, pgSeq: 0n, schemaVersion: 3 }];
      if (sql.includes('COUNT(*)')) return [{ n: 0 }];
      return [];
    }),
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma, ops };
}

/** vacuum service 直构（真连 kit 上）：repo mock（④ 装载读+⑥ 代际替换——契约 1/10 单源）+
 *  Y1c T27 maintenance 委托面（gateway 生产接线形态 adapter——freeze 4413/SWITCHING 后 4410 投递）。 */
function buildVacuumSvc(kit: DualClientKit, repo: any) {
  const perm = { assertEditorWithTeam: vi.fn(async () => ({ role: 'PROJECT_EDITOR', teamId: 't1' })) };
  const docs = {
    withDoc: vi.fn(),
    invalidateSnapshotCache: vi.fn(),
  };
  const m = buildMaintenancePrisma();
  const maintenance = new CollabMaintenanceService(m.prisma as any, repo as any, null, null, null);
  const gw = kit.gateway;   // 型化访问（façade 门禁：禁 as any 别名——公有面直读+façade 单点缝）
  // gateway 生产接线形态复刻（kit 直构不注 maintenance 尾参——actor freeze 面经 façade 后置接线缝；
  // 生产=gateway bindHost 时闭包引 maintenanceService.freezeInfo，同源）
  gatewayFacade(gw).bindActorMaintenanceFreeze(maintenance);
  maintenance.bindHost({
    logger: { log: () => {}, warn: () => {}, error: () => {}, debug: () => {}, verbose: () => {}, fatal: () => {} } as never,
    docConnections: (pid: string) => [...(gw.server.hocuspocus.documents.get(gw.docRegistry.liveDocName(pid))?.connections.keys() ?? [])],
    hardClose: (conn, code, reason) => gw.sessionGuard.hardClose(conn as never, code, reason),
    thawQuotaAndWait: async (pid: string) => { if (gw.docRegistry.isQuotaFrozen(pid)) gw.docRegistry.thawQuota(pid); },
    isQuotaFrozen: (pid: string) => gw.docRegistry.isQuotaFrozen(pid),
    releaseResidentDoc: async (pid: string) => {
      await gw.docRegistry.tryReleaseResidentSession(pid, 'maintenance').catch(() => {});
      gw.docRegistry.purgeDocState(pid);
    },
    switchWalGeneration: (pid: string, generation: number) => gw.switchWalGeneration(pid, generation),
  });
  return new CollabShrinkService(perm as any, docs as any, kit.gateway, {} as any, {} as any, repo, maintenance);
}

/** 挂起式 repo（④ loadForHydration 挂起——vacuum 停在④前的 serving 门窗口保持）+释放后 ⑥ 直透 */
function makeHangingVacuumRepo(kit: DualClientKit, pid: string) {
  let releaseRead!: (v: Buffer | null) => void;
  const readGate = new Promise<Buffer | null>((r) => { releaseRead = r; });
  const repo = {
    loadForHydration: vi.fn(() => readGate.then((state) => ({ state, updates: [] as Buffer[], stateSeq: 0n }))),
    vacuumReplace: vi.fn(async () => ({ generation: 1 })),
  };
  return {
    repo,
    /** 释放④：用服务端现行 doc 编码做源 state（null=空源——doc 已卸载时） */
    release: () => {
      const doc = (kit.gateway as any).server.hocuspocus.documents.get(`project:${pid}`);
      releaseRead(doc ? Buffer.from(Y.encodeStateAsUpdate(doc)) : null);
    },
  };
}

describe('Y0b-4 T9a vacuum——SV 代际门三向/terminal close/serving 门（Q-U v6）', () => {
  it('freeze close（T27 委托形态）：vacuum=维护状态机 FREEZING——存量连接收 close 4413 maintenance-freeze（附言①完整投递：stateless retryAfterMs 载荷+码权威 close；4410 doc-vacuuming 归 SWITCHING 提交后）——完成后新连接正常（新代）', async () => {
    const kit = await startDualClientServer({}, 300, undefined, undefined, QUOTA_SMALL);
    try {
      const A = connectWithCloseSpy(kit, 'project:vt1');
      await A.synced;
      setNode(A.ydoc, 'n1', 'x'.repeat(100));
      await pollUntil(() => serverDoc(kit.gateway as any, 'vt1').getMap('nodes').has('n1'), 3_000);
      const hang = makeHangingVacuumRepo(kit, 'vt1');
      const svc = buildVacuumSvc(kit, hang.repo);
      const vac = svc.vacuum('vt1', 'u1');
      await pollUntil(() => A.closeInfo() !== null, 5_000);   // FREEZING 段全连接 4413 完整 close（裸 ws 观测）
      expect(A.closeInfo()).toEqual({ code: 4413, reason: 'maintenance-freeze' });
      await A.provider.destroy(); kit.forget(A.provider);
      hang.release();                                          // EXPORTING/REBUILDING 放行 → SWITCHING → ok
      const r = await vac;
      expect(r.result).toBe('ok');
      const C = kit.connect('project:vt1');                    // 完成后解除——新连接正常（新代）
      await C.synced;
      setNode(C.ydoc, 'after', 'ok');
      await pollUntil(() => serverDoc(kit.gateway as any, 'vt1').getMap('nodes').has('after'), 3_000);
    } finally { await kit.dispose(); }
  }, 30_000);

  it('freeze 执法面（T27 委托形态——旧 vacuumingDocs 装载 serving 门随单换代入口退役）：维护窗口新连接可 synced（读面开放——doc 稳态）但**写帧 4413 完整 close**（执法=actor 准入链 freeze 检查非装载门）；完成后写恢复', async () => {
    const kit = await startDualClientServer({}, 300, undefined, undefined, QUOTA_SMALL);
    try {
      const A = connectWithCloseSpy(kit, 'project:vg1');
      await A.synced;
      const hang = makeHangingVacuumRepo(kit, 'vg1');
      const svc = buildVacuumSvc(kit, hang.repo);
      const vac = svc.vacuum('vg1', 'u1');
      await pollUntil(() => A.closeInfo() !== null, 5_000);   // FREEZING 4413（存量连接）
      await A.provider.destroy(); kit.forget(A.provider);
      await sleep(300);                                        // 维护窗口（EXPORTING 挂起中）
      // 新 WS 连接：读面开放——synced 达成（装载照常；freeze 执法归帧准入非装载门）
      const B = connectWithCloseSpy(kit, 'project:vg1');
      await B.synced;
      // 写帧：freeze 执法——4413 完整 close（红① 同款：新连接帧拒+码权威投递）
      setNode(B.ydoc, 'frozen-write', 'x'.repeat(50));
      await pollUntil(() => B.closeInfo() !== null, 5_000);
      expect(B.closeInfo()).toEqual({ code: 4413, reason: 'maintenance-freeze' });
      await B.provider.destroy(); kit.forget(B.provider);
      // REST withDoc 读面维持（freeze 不拦读——旧 503 serving 门语义随 vacuumingDocs 退役）
      await expect(kit.docService.withDoc('vg1', () => 'read-ok')).resolves.toBe('read-ok');
      hang.release();
      const r = await vac;
      expect(r.result).toBe('ok');
      // 完成后写恢复：新连接 setNode 落地（freeze 解除）
      const C = kit.connect('project:vg1');
      await C.synced;
      setNode(C.ydoc, 'after', 'ok');
      await pollUntil(() => serverDoc(kit.gateway as any, 'vg1').getMap('nodes').has('after'), 3_000);
    } finally { await kit.dispose(); }
  }, 30_000);

  it('世代准入三向（Y1c T12 偏离 27——docName 世代段 auth/load 双校验取代 SV 代际门）：①陈旧世代名（gen=1 下裸名≡旧代）⇒ authenticationFailed generation-stale（不装载不 SS1 不上行）；②canonical #g1 名 ⇒ 放行且全量同步；③新 clientID 新编辑 ⇒ 放行——reload 不循环', async () => {
    const kit = await startDualClientServer({}, 300, undefined, undefined, QUOTA_SMALL);
    try {
      const g = kit.gateway as any;
      // ① vacuum 前在线客户端产生历史（旧代 gen0 内容）——历史面与旧测试同源（SV clock 形态不再是判据）
      const A = kit.connect('project:gen1');
      await A.synced;
      setNode(A.ydoc, 'old-a', 'x'.repeat(50));
      await pollUntil(() => serverDoc(g, 'gen1').getMap('nodes').has('old-a'), 3_000);
      const vacuumedState = Buffer.from(Y.encodeStateAsUpdate(serverDoc(g, 'gen1')));
      // 模拟 vacuum ⑥ 落库后新代（generation=1；preVacuumSv 列已随 SV 代际门退役删除——迁移 20261024160000）
      kit.repo.hydrateWithRecovery.mockResolvedValue({ state: vacuumedState, updates: [] as Buffer[], stateSeq: 0n, generation: 1 });
      kit.repo.readGeneration.mockResolvedValue(1);   // auth 面世代准入真值（E23 双校验①——repository.readGeneration 单源）
      await A.provider.destroy(); kit.forget(A.provider);
      await pollUntil(() => serverDoc(g, 'gen1') === undefined, 6_000);   // 真卸载（unloadImmediately）
      // 带同 ydoc（旧历史）以旧世代名（裸名≡g0）重连——auth 面准入拒（admitDocNameForGeneration：
      // 不装载/不 SS1/不上行旧 structs——S2 复活链关闭）；客户端观测=authenticationFailed{reason}
      let authFail: { reason: string } | null = null;
      const staleProvider = new HocuspocusProvider({
        url: `${kit.url}?csv=${CLIENT_PROTOCOL_VERSION}&sv=${CANVAS_DOC_SCHEMA_VERSION}`,
        name: 'project:gen1',
        document: A.ydoc,                                        // 带 vacuum 前历史的 doc
        WebSocketPolyfill: makeHeaderWs({ origin: 'http://localhost:5173', cookie: 'flowweb.session_token=tok' }, () => {}),
      } as any);
      staleProvider.on('authenticationFailed', (e: { reason: string }) => { if (!authFail) authFail = { reason: e.reason }; });
      await pollUntil(() => authFail !== null, 5_000);
      expect(authFail).toEqual({ reason: 'generation-stale' });
      await staleProvider.destroy();
      await pollUntil(() => serverDoc(g, 'gen1') === undefined, 6_000);

      // ② canonical #g1 名（全新空 doc）⇒ 放行且全量同步（canonical wire 名=库 documents Map 键）
      const B = kit.connect('project:gen1#g1');
      await B.synced;                                            // 无 close（放行）
      expect(serverDocNamed(g, 'project:gen1#g1').getMap('nodes').has('old-a')).toBe(true);   // 全量同步（新代装载含内容——canonical Map 键）
      // ③ vacuum 后 reload 新建编辑（新 clientID——世代准入与 clientID 无关）⇒ 放行——reload 不循环
      setNode(B.ydoc, 'post-vac', 'y');
      await pollUntil(() => serverDocNamed(g, 'project:gen1#g1').getMap('nodes').has('post-vac'), 3_000);
      expect(serverDocNamed(g, 'project:gen1#g1').connections.size).toBe(1);     // B 连接存活（未被世代准入误杀）
    } finally { await kit.dispose(); }
  }, 45_000);
});
