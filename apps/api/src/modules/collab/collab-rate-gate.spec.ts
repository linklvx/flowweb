// apps/api/src/modules/collab/collab-rate-gate.spec.ts
// Y0b-4 T6 真红门——速率闸三桶（Q-E v5）+awareness 治理（Q-L）。
// 红相锚：①consume 无 cost 参（token-bucket.spec 红）②bytesBuckets 缺失（红门⑧ 白盒排空断言 TypeError）
// ③三桶 close 1008 永不发生（pollUntil 超时）④stripped 指标未定义（counterOf throw）⑤awareness 帧闸缺失
// （>64KB 帧解码失败折 1012≠1009）。装置=dual-client-server 真连+裸 ws 手编帧（T4 :140 先例）。
// 【史】报告1 P0-2 红相留档：v4 形态（信用+1MB 桶）下 >1MB 合法离线合并帧第二次结构性永拒——
// v5 桶容量=maxDocBytes（"桶容量≥最大合法帧"不变量）+信用整删（首帧突发由容量吸收）修复。
// 【Y1c 收口迁移】T9（e8c892f3）actor 管线新增 P1 shape 根白名单（nodes/edges/exec/meta——
// validateP1Shape 准入链 ①）：夹具旧用 `m` 根的帧被 4411 unknown-root:m 拒+全连接关闭=帧永不
// apply（本文件 5 例红的共同根因）。判别结论=闸面功能（⓪帧闸/⓪′bytes 桶/msg 桶/冻结族/close
// 码投递）在 T9 管线下完好（探针实证：nodes 根下 8MB+30B SS2 落库/1008/1009 全投递）——本文件
// 迁移=T9 对默认池 quota-gate 的同款收编迁移（m 根换 nodes——commit e8c892f3 先例），断言面
// （桶算术/close 码/冻结落地/writes_dropped）逐字保持，非放松。
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { register } from 'prom-client';
import { startDualClientServer, makeHeaderWs, type DualClientKit } from '../../test-utils/dual-client-server';
import { pollUntil } from '../../test-utils/poll-until';
import { gatewayFacade } from './test-utils/collab-gateway-test-facade';   // Y0c T39b 波 2：内部状态访问经 façade（check-collab-test-facade 门禁）
import { makeFrame as frame, makeAwarenessUpdateBody } from '../../test-utils/frame-encoder';   // T6 外审 M1：varint 手编单源
import { AWARENESS_FRAME_LIMIT_BYTES } from './collab.gateway';   // T6 外审 M4：帧闸阈值常量绑定（改值本测试红）
import { CLIENT_PROTOCOL_VERSION, FRAME_ALLOWANCE_BYTES } from '@flowweb/shared';

/** 小值配额（bytes 桶容量=maxDocBytes+ALLOWANCE；bytesRate 1024B/s——滴灌几帧即超） */
const QUOTA_SMALL = { maxDocBytes: 8192, maxTxBytes: 4096, msgRate: 200, bytesRate: 1024 };
/** 红门⑧ 配额：maxDocBytes 默认 8MB（SS2 帧闸上界=桶容量=maxDocBytes+ALLOWANCE）+bytesRate 100MB/s（refill 即时——plan 推荐注入） */
const QUOTA_BIG = { maxDocBytes: 8_388_608, maxTxBytes: 1_048_576, msgRate: 200, bytesRate: 100_000_000 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** prom-client 计数现值（pollUntil 判据用——帧到达服务端异步，断言前等计数落定；quota-gate 同款） */
async function counterOf(name: string, labels: Record<string, string> = {}): Promise<number> {
  const metric: any = register.getSingleMetric(name);
  if (!metric) throw new Error(`metric ${name} 未定义（T6 未实现——红相）`);
  return (await metric.get()).values.find((s: any) => Object.entries(labels).every(([k, v]) => s.labels[k] === v))?.value ?? 0;
}
async function metricDelta(name: string, labels: Record<string, string>, fn: () => Promise<unknown> | unknown): Promise<number> {
  const before = await counterOf(name, labels);
  await fn();
  return (await counterOf(name, labels)) - before;
}

/** 连接并捕获裸 ws close（code+reason）——1008/1009 断连观测（T4 connectWithCloseSpy 同款） */
function connectWithCloseSpy(kit: DualClientKit, name: string) {
  let closeInfo: { code: number; reason: string } | null = null;
  const onClose = (ws: import('ws')) => ws.once('close', (code: number, reason: Buffer) => {
    if (!closeInfo) closeInfo = { code, reason: reason.toString() };
  });
  const entry = kit.connect(name, 'tok', { onSocket: onClose });
  return { ...entry, closeInfo: () => closeInfo };
}

// ---------- 裸 ws 帧构造：frame-encoder 单源（T6 外审 M1——varuint/frame/awarenessUpdate 三拷贝收口） ----------
/** awareness update 体（单条）：count=1 {client, clock, state(JSON)}（y-protocols encodeAwarenessUpdate 形） */
function awarenessUpdate(clientId: number, clock: number, state: object): Buffer {
  return Buffer.from(makeAwarenessUpdateBody([{ clientId, clock, state }]));
}

/** 裸 ws：开连+Auth+等回执（authenticated 连接——后续帧走全链路钩子） */
async function openAuthedWs(kit: DualClientKit, docName: string) {
  const client = new (makeHeaderWs({ origin: 'http://localhost:5173', cookie: 'flowweb.session_token=tok' }))(
    `${kit.url}?csv=${CLIENT_PROTOCOL_VERSION}`,
  );
  await new Promise<void>((resolve, reject) => { client.once('open', resolve); client.once('error', reject); });
  client.on('error', () => { /* 关闭握手期 error 无人消费会抛——吞 */ });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    client.once('close', (code: number, reason: Buffer) => resolve({ code, reason: reason.toString() }));
  });
  let closeInfo: { code: number; reason: string } | null = null;
  closed.then((info) => { closeInfo = info; });
  client.send(frame(docName, 2 /* Auth */, 0 /* Token */, 'tok'));
  await new Promise<void>((resolve) => client.once('message', () => resolve()));
  return { client, closeInfo: () => closeInfo };
}

describe('Y0b-4 T6 速率闸（Q-E v5）+awareness 治理（Q-L）', () => {
  it('桶容量≥最大合法帧不变量：bytesBuckets capacity===maxDocBytes+FRAME_ALLOWANCE_BYTES（=SS2 闸上界〔maxDocBytes+ALLOWANCE〕——Y0b-5 T8 裁定 24⑵ 同步）+cost>capacity 结构性恒 false（报告1 P0-2——1MB 容量下 >1MB 合法帧永拒形态防复发）', async () => {
    const kit = await startDualClientServer({}, 300, undefined, undefined, QUOTA_SMALL);
    try {
      const g = gatewayFacade(kit.gateway);
      expect(g.bytesBucketCapacity()).toBe(QUOTA_SMALL.maxDocBytes + FRAME_ALLOWANCE_BYTES);   // ===SS2 闸上界（最大合法帧恰可被容量吸收——只抬闸不同步桶=(闸,闸+ALLOWANCE] 帧 ⓪′ 恒拒→1008 重连重发循环）
      expect(g.consumeBytesBucket('cap-struct', QUOTA_SMALL.maxDocBytes + FRAME_ALLOWANCE_BYTES + 1)).toBe(false);   // 结构性恒 false（tokens≤capacity<cost）——v4 形态防复发断言（须 capacity+1——探针低于容量则恒真假断言）
    } finally { await kit.dispose(); }
  }, 30_000);

  it('成对用例（Y0b-5 T8 裁定 24⑧/⑵）：maxDocBytes+30B SS2 帧**同时过 ⓪ 与 ⓪′**（〔maxDocBytes, maxDocBytes+ALLOWANCE〕区间合法——离线合并回灌带包装余量）；`2×maxDocBytes+ALLOWANCE` Update 帧仍 1009（放宽未顺带放宽 Update 闸）', async () => {
    const kit = await startDualClientServer({}, 300, undefined, undefined, QUOTA_BIG);
    try {
      const g = kit.gateway;
      // 臂一：SS2 帧 ∈ (maxDocBytes, maxDocBytes+ALLOWANCE]——过 ⓪（≤闸+ALLOWANCE）且过 ⓪′（桶容量吸收）
      const big = new Y.Doc();
      big.getMap('nodes').set('blob', 'x'.repeat(8_388_608 + 30));   // Y1c 迁移：m→nodes 根（T9 P1 白名单——夹具根非断言面）
      const bigUpdate = Y.encodeStateAsUpdate(big);
      expect(bigUpdate.byteLength).toBeGreaterThan(QUOTA_BIG.maxDocBytes);                                  // >maxDocBytes——旧闸（1009 形态）下必拒
      expect(bigUpdate.byteLength).toBeLessThanOrEqual(QUOTA_BIG.maxDocBytes + FRAME_ALLOWANCE_BYTES);      // ≤新闸——合法帧
      const { client, closeInfo } = await openAuthedWs(kit, 'project:pair');
      const slow0 = await counterOf('collab_slow_consumer_disconnect_total');   // v3：基线必须在 send 前（后置取基线=假绿〔1011 在 ack send 同 tick +1，后取的 slow0 已含该次〕）
      let msgs = 0;
      client.on('message', () => { msgs += 1; });   // v3：监听也前置（echo 后置挂会漏第一条）
      client.send(frame('project:pair', 0 /* Sync */, 1 /* SyncStep2 */, bigUpdate));
      const doc = () => g.server.hocuspocus.documents.get('project:pair');
      const BLOB_LEN = 8_388_638;   // R4a'：长度锚（O(1) 零分配——每轮 8MB churn 根除）
      await pollUntil(() => (doc()?.getMap('nodes').get('blob') as string | undefined)?.length === BLOB_LEN, 30_000);   // 落库=⓪与⓪′双过
      expect(doc()?.getMap('nodes').get('blob')).toBe('x'.repeat(BLOB_LEN));   // 一次性全等（单次分配）
      await pollUntil(() => msgs >= 2, 5_000);   // echo（回显）+SyncStatus ack 两帧序已落
      await sleep(200);   // close 事件冒泡窗
      expect(await counterOf('collab_slow_consumer_disconnect_total')).toBe(slow0);   // 零 1011（计数器基线正确）
      expect(closeInfo()).toBeNull();   // 帧面复核
      client.terminate();
      // 臂二：Update 帧仍 1009——3MB 帧处于「若 Update 闸被错误放宽到 SS2 闸则放行」的区间
      //（3MB>2×maxTxBytes=2MB 仍拒=闸未顺带放宽；<SS2 新闸 8MB+64KB）。规模上界注：ws 库
      // maxPayload=16MB——2×maxDocBytes+ALLOWANCE(~16.8MB) 形态被 ws 层 1009('')先行截胡，不可达应用闸。
      const { client: c2, closeInfo: close2 } = await openAuthedWs(kit, 'project:pair-u');
      c2.send(frame('project:pair-u', 0 /* Sync */, 2 /* Update */, new Uint8Array(3_000_000)));
      await pollUntil(() => close2() !== null, 8_000);
      expect(close2()).toEqual({ code: 1009, reason: 'frame-too-large' });
    } finally { await kit.dispose(); }
  }, 60_000);

  it('红门⑧（v3 勘正）：8MB 回灌——第一次入桶并 apply 后软阈冻结；等冻结落地后第二次仍入桶（refill 后通过=桶容量断言）但 readOnly 拒 apply（writes_dropped 计数）+零 1008/1011', async () => {
    const kit = await startDualClientServer({}, 300, undefined, undefined, QUOTA_BIG);
    try {
      const gw = kit.gateway;
      const g = gatewayFacade(gw);
      const big = new Y.Doc();
      big.getMap('nodes').set('blob', 'x'.repeat(8_388_000));   // Y1c 迁移：m→nodes 根（T9 P1 白名单）
      const bigUpdate = Y.encodeStateAsUpdate(big);
      expect(bigUpdate.byteLength).toBeLessThanOrEqual(QUOTA_BIG.maxDocBytes);
      // Y1c 迁移（T9 ③ 去重契约）：第二帧=**异字节**（新 clientID 独立 doc——'y' 载荷）。原「重发同
      // bigUpdate」在 T9 下命中 actor SHA-256 applied 去重=幂等 no-op ACK（红组不变量「同字节恰一
      // walSeq」），readOnly 丢帧计数面（actor ⓪）不执行=writes_dropped 恒不增。异字节帧走真实
      // ⓪ readOnly 拒写路径——本用例断言语义（冻结后入桶但拒 apply+计数）原样钉住，非放松。
      const big2 = new Y.Doc();
      big2.getMap('nodes').set('blob2', 'y'.repeat(8_388_000));
      const bigUpdate2 = Y.encodeStateAsUpdate(big2);
      const { client, closeInfo } = await openAuthedWs(kit, 'project:gate8');
      await sleep(2_100);   // 逃装载冷却窗（loadDocument :423 播种 truthMeasuredAt+TRUTH_COOLDOWN_MS=2s——窗内④走账面上界决策：0+0+8,388,063≯maxDocBytes 即快路径不冻结；窗外首帧走实测腿 measured+bytes≥softEnter → freezeQuota〔触发帧本身照常 apply=Q-S「禁静默丢合法帧」——T9 actor 化后不变：gate admitFrameQuota 的 freezeQuota setImmediate 落地晚于 actor drain 微任务准入，触发帧照常入 WAL+apply〕——plan v3 时序实况适配）
      const b0 = await counterOf('collab_bytes_rate_exceeded_total');
      client.send(frame('project:gate8', 0 /* Sync */, 1 /* SyncStep2 */, bigUpdate));
      const doc = () => gw.server.hocuspocus.documents.get('project:gate8');
      const BLOB_LEN = 8_388_000;   // R4a' 长度锚
      await pollUntil(() => (doc()?.getMap('nodes').get('blob') as string | undefined)?.length === BLOB_LEN, 30_000);   // 第一次：入桶+apply
      // 白盒排空证据（红相锚：bytesBuckets 缺失=TypeError）——首扣后 tokens≈capacity-cost ≪ 容量一半
      const sid = [...doc()!.connections.keys()][0].socketId as string;
      const tokensAfterFirst = g.bytesBucketTokens(sid);
      expect(tokensAfterFirst).toBeLessThan(QUOTA_BIG.maxDocBytes / 2);   // 桶容量断言（有效——B9 v3 勘正保留；DR.guardSyncFrame 顺序=⓪帧闸→SS2闸→⓪′consumeBytesBucket→①readOnly 早退——通过=桶通过≠doc 应用）
      // v3：等冻结落地=确定性读面（freezeQuota→quotaFrozenDocs——façade quotaFrozenHas 既有读面，弃 (gw as any) 撞 façade 门禁）
      const dropped0 = await counterOf('collab_quota_writes_dropped_total', { reason: 'quota' });
      await pollUntil(() => g.quotaFrozenHas('gate8'), 10_000);   // 键=裸 projectId（parseDocName 剥 project: 前缀——quotaFrozenDocs 台账口径；plan 代码块 'project:gate8' 系键笔误勘正）
      await pollUntil(() => { g.consumeBytesBucket(sid, 0); return (g.bytesBucketTokens(sid) ?? 0) >= Math.max(bigUpdate.byteLength, bigUpdate2.byteLength); }, 5_000);   // T7 评审顺手项：refill 确定性等满（bytesRate 100MB/s；目标=两帧 max——第二帧异字节可能略大，防 1B 级窗内误拒）。桶 refill 惰性结算只于 consume 内推进（纯读 tokens 不增长）——cost 0 零扣减纯结算，与后续真实 consume 的结算步语义同构
      client.send(frame('project:gate8', 0 /* Sync */, 1 /* SyncStep2 */, bigUpdate2));   // 第二次：仍入桶（DR ⓪′ 先于 ① readOnly——B9）→ readOnly 拒 apply
      await pollUntil(async () => (await counterOf('collab_quota_writes_dropped_total', { reason: 'quota' })) > dropped0, 8_000);   // readOnly 拒写计数
      await pollUntil(() => g.bytesBucketTokens(sid)! < tokensAfterFirst! + 1_000, 5_000);   // v2：第二次桶消费直接断言（refill 后再扣 ~8MB——tokens 回落；! = sid/桶键已在前文实证存在）
      expect(closeInfo()).toBeNull();                                          // 零 1008（桶容量吸收）/零 1011（R4b' 前瞻+回显不误杀）
      expect(await counterOf('collab_bytes_rate_exceeded_total')).toBe(b0);    // 全程零速率拒
      client.terminate();
    } finally { await kit.dispose(); }
  }, 60_000);

  it('红门⑧-b（v3 新增/v2 重写）：128KB 档真 refill——60KB 帧——冻结与否取决于装载冷却窗状态（窗内账面/窗外实测腿），用例断言对两分支钝感——两次入桶：第一次 apply、第二次 refill 后过桶再 apply（同键覆盖——doc 尺寸不增长）', async () => {
    const Q = { maxDocBytes: 131_072, maxTxBytes: 16_384, msgRate: 200, bytesRate: 10_000_000 };
    const kit = await startDualClientServer({}, 300, undefined, undefined, Q);
    try {
      const gw = kit.gateway;
      const g = gatewayFacade(gw);
      const mk = () => { const d = new Y.Doc(); d.getMap('nodes').set('blob', 'x'.repeat(60_000)); return Y.encodeStateAsUpdate(d); };   // Y1c 迁移：m→nodes 根
      const { client, closeInfo } = await openAuthedWs(kit, 'project:gate8b');
      client.send(frame('project:gate8b', 0, 1, mk()));
      const doc = () => gw.server.hocuspocus.documents.get('project:gate8b');
      await pollUntil(() => (doc()?.getMap('nodes').get('blob') as string | undefined)?.length === 60_000, 10_000);   // 第一次 apply
      const sid = [...doc()!.connections.keys()][0].socketId as string;
      const tokens1 = g.bytesBucketTokens(sid);   // 首扣后 ~196,608−~60,0xx≈136.5KB（容量 131,072+65,536=196,608；T7 勘正原「≈192KB-60KB=132KB」算术）
      expect(tokens1).toBeLessThan(131_072 + 65_536 - 60_000 + 1);   // 桶已扣（容量=131,072+65,536）
      await sleep(300);   // refill 10MB/s → ≥3MB（capped 桶容量 196,608）——「积满」
      client.send(frame('project:gate8b', 0, 1, mk()));   // 第二帧：同键覆盖（LWW）——refill 后过桶
      await pollUntil(() => g.bytesBucketTokens(sid)! < tokens1! + 1_000, 10_000);   // v2：第二次桶消费直接断言（再扣 ~60KB；! = sid/桶键已在前文实证存在）
      expect(doc()?.getMap('nodes').get('blob')).toHaveLength(60_000);   // 同键覆盖——doc 尺寸不增长（配额语义自洽）
      expect(closeInfo()).toBeNull();
      client.terminate();
    } finally { await kit.dispose(); }
  }, 30_000);

  it('bytes 桶：持续超速率滴灌（注入 bytesRate=1KB/s；3 帧×~26KB——桶容量=maxDocBytes+ALLOWANCE=73_728，Y0b-5 T8 同步后算术）→ close 1008 bytes-rate-exceeded（裸 ws 观测；P0-2 红相=v2 consume 无 cost 字节桶空转）', async () => {
    // maxTxBytes=16KB（Update 闸=32KB——~26KB 帧过帧闸进桶判据）
    const kit = await startDualClientServer({}, 300, undefined, undefined, { maxDocBytes: 8192, maxTxBytes: 16_384, msgRate: 200, bytesRate: 1024 });
    try {
      const A = connectWithCloseSpy(kit, 'project:drip');
      await A.synced;
      await sleep(200);   // 初始 Step2（~2B）安置窗
      const exceeded = await metricDelta('collab_bytes_rate_exceeded_total', {}, async () => {
        A.ydoc.getMap('nodes').set('k0', 'z'.repeat(26_000));   // Y1c 迁移：m→nodes 根（T9 P1 白名单）——~26KB/帧：73_728→~47_728
        A.ydoc.getMap('nodes').set('k1', 'z'.repeat(26_000));   // ~47_728→~21_728
        A.ydoc.getMap('nodes').set('k2', 'z'.repeat(26_000));   // ~21_728+refill(ε)<26_000 → 拒
        await pollUntil(() => A.closeInfo() !== null, 8_000);
      });
      expect(exceeded).toBe(1);
      expect(A.closeInfo()).toEqual({ code: 1008, reason: 'bytes-rate-exceeded' });
    } finally { await kit.dispose(); }
  }, 30_000);

  it('msg 桶超限：瞬时 >400 帧（注入 msgRate=1/s）→ close 1008 msg-rate-exceeded（裸 ws）', async () => {
    const kit = await startDualClientServer({}, 300, undefined, undefined, { maxDocBytes: 8_388_608, maxTxBytes: 1_048_576, msgRate: 1, bytesRate: 100_000_000 });
    try {
      const A = connectWithCloseSpy(kit, 'project:msg400');
      await A.synced;
      await sleep(200);
      const exceeded = await metricDelta('collab_msg_rate_exceeded_total', {}, async () => {
        for (let i = 0; i < 460; i++) A.ydoc.getMap('nodes').set(`k${i}`, i);   // 400 容量+~1/s 补充 <460 → 必拒（m→nodes 根迁移——T9 P1 白名单）
        await pollUntil(() => A.closeInfo() !== null, 10_000);
      });
      expect(exceeded).toBeGreaterThanOrEqual(1);
      expect(A.closeInfo()).toEqual({ code: 1008, reason: 'msg-rate-exceeded' });
    } finally { await kit.dispose(); }
  }, 30_000);

  it('readOnly 剔字段：VIEWER 发 cursor 帧——对端收 user 无 cursor+发送者本地 cursor 保留（等时钟回显不覆盖——保活链前提）+stripped{read-only}+1', async () => {
    const kit = await startDualClientServer({}, 300);
    try {
      const B = kit.connect('project:strip');
      await B.synced;
      kit.permSvc.resolveWithTeam.mockResolvedValue({ role: 'PROJECT_VIEWER', teamId: 't1' });
      const V = kit.connect('project:strip');
      await V.synced;
      kit.permSvc.resolveWithTeam.mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' });
      const vCid = (V.provider.awareness as any).clientID as number;
      const stripped = await metricDelta('collab_awareness_stripped_total', { reason: 'read-only' }, async () => {
        V.provider.setAwarenessField('cursor', { x: 10, y: 20 });
        await pollUntil(() => {
          const st = (B.provider.awareness as any).states.get(vCid);
          return !!st?.user?.id;
        }, 5_000);
      });
      expect(stripped).toBeGreaterThanOrEqual(1);
      const st = (B.provider.awareness as any).states.get(vCid) as Record<string, any>;
      expect(st.user.id).toBe('u1');                    // 身份注入保留（成员表 presence 面）
      expect('cursor' in st).toBe(false);               // 剔字段（undefined JSON 序列化丢键——对端零 cursor）
      expect(((V.provider.awareness as any)?.getLocalState() as any)?.cursor).toEqual({ x: 10, y: 20 });   // 发送者本地不被等时钟回显覆盖（回显=保活链前提，条目永不删）
    } finally { await kit.dispose(); }
  }, 30_000);

  it('awareness 独立限速 >30 帧/s（capacity 60）→ 1008（共享桶+键前缀 aware:${sid}）；onDisconnect 全桶清理（Map 泄漏防）', async () => {
    const kit = await startDualClientServer({}, 300);
    try {
      const gw = kit.gateway;
      const g = gatewayFacade(gw);
      const { client, closeInfo } = await openAuthedWs(kit, 'project:awrate');
      const doc = () => gw.server.hocuspocus.documents.get('project:awrate');
      await pollUntil(() => (doc()?.connections?.size ?? 0) >= 1, 5_000);
      const sid = [...doc()!.connections.keys()][0].socketId as string;
      const upd = awarenessUpdate(555, 1, { tag: 'flood' });
      const exceeded = await metricDelta('collab_awareness_rate_exceeded_total', {}, async () => {
        for (let i = 0; i < 70; i++) client.send(frame('project:awrate', 1 /* Awareness */, null, upd));   // 61 帧/零 refill 窗 → 必拒
        await pollUntil(() => closeInfo() !== null, 8_000);
      });
      expect(exceeded).toBeGreaterThanOrEqual(1);
      expect(closeInfo()).toEqual({ code: 1008, reason: 'awareness-rate-exceeded' });
      // onDisconnect 三桶清理（socketId 键+aware: 前缀键——断连重置=DoS 兜底语义）
      await pollUntil(() =>
        !g.rateBucketHasKey('msg', sid) && !g.rateBucketHasKey('bytes', sid) && !g.rateBucketHasKey('aware', `aware:${sid}`),
      5_000);
    } finally { await kit.dispose(); }
  }, 30_000);

  it('awareness 入站帧闸：伪造 >64KB awareness 帧 → 1009（beforeHandleMessage 判型——库 IncomingMessage 解析非字节猜型；30/s×16MB=480MB/s 解码路径封死）；<64KB 正常帧通过', async () => {
    const kit = await startDualClientServer({}, 300);
    try {
      // 臂一：>64KB（帧总长=常量+余量 > AWARENESS_FRAME_LIMIT_BYTES——M4 常量绑定：闸值改小本测试红）
      const big = await openAuthedWs(kit, 'project:awgate');
      const rejected = await metricDelta('collab_quota_frame_rejected_total', { reason: 'frame-too-large' }, async () => {
        big.client.send(frame('project:awgate', 1 /* Awareness */, null, awarenessUpdate(999, 1, { pad: 'a'.repeat(AWARENESS_FRAME_LIMIT_BYTES + 64) })));
        await pollUntil(() => big.closeInfo() !== null, 8_000);
      });
      expect(rejected).toBeGreaterThanOrEqual(1);
      expect(big.closeInfo()).toEqual({ code: 1009, reason: 'frame-too-large' });
      // 臂二：<64KB 正常 awareness 帧——判型放行+解码+guard 全链路通过（服务端 states 登记=落库证据）
      const ok = await openAuthedWs(kit, 'project:awgate');
      ok.client.send(frame('project:awgate', 1 /* Awareness */, null, awarenessUpdate(777, 1, { tag: 'ok' })));
      const g = kit.gateway as any;
      await pollUntil(() => g.server.hocuspocus.documents.get('project:awgate')?.awareness?.states?.has(777), 5_000);
      await sleep(600);   // 边界观察窗——放行帧不得触发 close
      expect(ok.closeInfo()).toBeNull();
      ok.client.terminate();
    } finally { await kit.dispose(); }
  }, 30_000);
});
