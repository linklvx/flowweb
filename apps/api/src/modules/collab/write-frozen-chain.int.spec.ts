// apps/api/src/modules/collab/write-frozen-chain.int.spec.ts
// Y0b-5 T9：write-frozen 全链断言链 ①-⑥ 的 collab-core int 等价用例（plan T9 Files 第二件）。
// 载体=startDualClientServer（collab-core 既有惯例——in-process 真实 gateway+Hocuspocus listener）；
// 与 scripts/write-frozen-drill.mjs 分工：本套件覆盖 ①②④⑤⑥ 的机制断言（drain/quota 双维度冻结、
// 权威快照重放、shrink 解除+物化），跨进程面（close(1012) 关停链/PG 落行/真实 30s recheck 时序/
// kill9 RPO 档 ⑦）归 drill 脚本（CI collab-core 同 job 演练步骤）——不重复造。
// ⚠ 两个 int 后门（均附机制注记）：①(gateway as any).transition('serving')——真实 drain 解除=
// 60s auto-release/关停重启，int 内不等 60s（drill 断言 close(1012) 真实链）；
// ②(gateway as any).recheckFrozenDocs()——真实解除=frozenRecheckTimer 30s 周期，int 直调同一
// 方法消真实等待（drill 断言真实 30s 时序）。〔Y0b-5 偏离 §0.4d-8 shrink thaw 已由 Y0c T13 根修〕
// 删除档 thaw 判据改用影子预演 shrunk（GC 已执行口径——活 doc truth 含墓碑壳偏大只作 watermark/
// 校准口径），thaw 即时化；recheck 直调保留=已解冻态再 recheck 为 no-op（无害）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as Y from 'yjs';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { startDualClientServer, type DualClientKit } from '../../test-utils/dual-client-server';
import { pollUntil } from '../../test-utils/poll-until';
import { CollabShrinkService } from './collab-shrink.service';
import { DOC_STATUS_REV_SEED } from '@flowweb/shared';

const BIG_BYTES = 50 * 1024;
const SHRINK_RELEASE_N_MS = 5_000;   // spec:594 <N> 具象化（int 内 thawQuota@shrink 出口广播同步发出——RTT 余量上界；真实 30s 时序归 drill）

/** 连接+stateless 捕获原子化（捕获必须先于 synced——connected 钩子首快照在 sync 完成前送达） */
function connectCaptured(kit: DualClientKit, pid: string, tag: string) {
  const c = kit.connect(`project:${pid}`);
  const status: any[] = [];
  const connStatus: any[] = [];
  c.provider.on('stateless', ({ payload }: any) => {
    try {
      const m = JSON.parse(payload);
      if (m.type === 'doc-status') status.push(m);
      else if (m.type === 'conn-status') connStatus.push(m);
    } catch { /* 非 JSON stateless——忽略 */ }
  });
  return { ...c, tag, status, connStatus };
}

async function startKit(): Promise<{ kit: DualClientKit; shrink: CollabShrinkService; pid: string }> {
  const kit = await startDualClientServer({}, 300, undefined, undefined, { maxDocBytes: 40_000, maxTxBytes: 262_144, msgRate: 200, bytesRate: 2_097_152 });   // 冻结档配额（softEnter=32KB/softExit=24KB；maxTx/msg/bytes 保持默认量纲）
  const shrink = new CollabShrinkService(
    { assertEditorWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' }) } as any,
    kit.docService,
    kit.gateway,
    {} as any,   // canvas——shrink 不触（exportFresh 专用）
    kit.prisma as any,
    kit.repo as any,
  );
  return { kit, shrink, pid: 'p1' };
}

describe('Y0b-5 T9：write-frozen 断言链 ①②A（drain 冻结+拒不物化）', () => {
  let kit: DualClientKit;
  beforeAll(async () => { kit = (await startKit()).kit; });
  afterAll(() => kit.dispose());

  it('①connected 首快照 rev=DOC_STATUS_REV_SEED 播种→②drain 后两 client 收 writeFrozen=true（quota.state 恒 ok）+conn-status readOnly→断言A:新编辑帧拒不物化', async () => {
    const a = connectCaptured(kit, 'p1', 'A');
    const b = connectCaptured(kit, 'p1', 'B');
    await Promise.all([a.synced, b.synced]);
    // ① rev 播种（初值 0 会被客户端 rev<=last 守卫丢首快照——Y0b-4 T5 修复的存在性验证）
    await pollUntil(() => a.status.length > 0 && b.status.length > 0, 5_000);
    for (const c of [a, b]) {
      const m = c.status[0];
      expect(m.rev).toBe(DOC_STATUS_REV_SEED);
      expect(m.writeFrozen).toBe(false);
      expect(m.quota.state).toBe('ok');
    }
    // 基线编辑对端可见
    a.ydoc.transact(() => a.ydoc.getMap('nodes').set('base-node', new Y.Map([['v', 1]])));
    await pollUntil(() => b.ydoc.getMap('nodes').has('base-node'), 5_000);
    // ② drain（in-process 直调——REST 面 POST /api/drain 归脚本 drill）
    (kit.gateway as any).beginDraining();
    await pollUntil(() => a.status.some((m) => m.writeFrozen === true) && b.status.some((m) => m.writeFrozen === true), 5_000);
    for (const c of [a, b]) {
      const m = c.status.find((x) => x.writeFrozen === true);
      expect(m.quota.state).toBe('ok');   // drain/quota 两维度独立——drain 冻结不得冒充 quota over
      expect(c.connStatus.some((x) => x.readOnly === true)).toBe(true);   // applyWriteFreeze 单源
    }
    // 断言A：冻结期新编辑帧 readOnly 拒不物化（对端不可见——PG 落行归脚本 drill 重放断言）
    a.ydoc.transact(() => a.ydoc.getMap('nodes').set('frozen-node', new Y.Map([['v', 1]])));
    await new Promise((r) => setTimeout(r, 1_500));
    expect(b.ydoc.getMap('nodes').has('frozen-node')).toBe(false);
  }, 20_000);   // 真实 timer 窗（连接+1.5s 拒绝窗+pollUntil 上界）——默认 5s 不够
});

describe('Y0b-5 T9：write-frozen 断言链 ④⑤B（断线期 quota 翻转→重连权威快照重放）+⑥C（shrink 解除+物化）', () => {
  it('④C 突发大帧触发真实冻结链（freezePending 广播 over→2s 冷却实测→freezeQuota）→④b recalibrate force 定影权威快照→⑤断言B:重连首快照逐字段=权威值→⑥断言C:shrink 出口即时 thaw（shrunk 判据）+编辑放行物化对端可见', async () => {
    const { kit, shrink, pid } = await startKit();
    try {
      // ④ 断线期间服务端 quota 状态翻转（docTruth/docDelta 进程内 Map 无 DB 表可 SQL 直改——机制等价形态：
      // 临时 client C 突发大帧走真实配额冻结链，翻转发生在 A/B 不在场窗口）
      const c = connectCaptured(kit, pid, 'C');
      await c.synced;
      c.ydoc.transact(() => c.ydoc.getMap('nodes').set('big-node', new Y.Map([['blob', 'x'.repeat(BIG_BYTES)]])));
      await pollUntil(() => c.status.some((m) => m.quota?.state === 'over'), 10_000);   // scheduleFreezePending 广播（≤2s 冷却+余量）
      await pollUntil(() => c.connStatus.some((x) => x.readOnly === true), 8_000);      // freezeQuota 落地（setImmediate 同 turn）
      // ④b 权威快照定影：recalibrate 纯校准→force 广播（T8 偏差③——dedup 键不含 bytes）携带最新 truth
      const rec = await shrink.shrink(pid, 'u1', { recalibrate: true });
      expect(rec.result).toBe('recalibrated');
      expect(rec.thawed).toBe(false);   // truth 越 softExit——不解冻（假冻结出口防护）
      // force 广播经 ws 宏任务送达——await shrink 返回≠已入捕获数组，轮询到带新 bytes 的 over 快照
      await pollUntil(() => c.status.some((m) => m.quota?.state === 'over' && m.quota.bytes === rec.watermark), 5_000);
      const authoritative = c.status.filter((m) => m.quota?.state === 'over').at(-1);
      expect(authoritative.quota.bytes).toBe(rec.watermark);
      // ⑤ 断言B：重连 authenticated 后首 doc-status 快照=服务端权威值（幂等快照重放——rev 连续+bytes 精确）
      const a2 = connectCaptured(kit, pid, 'A2');
      const b2 = connectCaptured(kit, pid, 'B2');
      await Promise.all([a2.synced, b2.synced]);
      for (const cc of [a2, b2]) {
        await pollUntil(() => cc.status.length > 0, 5_000);
        // T11：重连首快照走 per-conn 推送面——多出顶层 connectionId（各自 WS 连接标识），
        // 权威快照（per-doc 广播面）无此字段——toEqual 补 expect.any(String) 对齐（逐字段重放语义不变）
        expect(cc.status[0]).toEqual({ ...authoritative, connectionId: expect.any(String) });
        expect(cc.connStatus.some((x) => x.readOnly === true)).toBe(true);   // 冻结期加入
      }
      // ⑥ 断言C：shrink 成功 thaw 即时化（Y0c T13 根修——删除档 thaw 判据用影子预演 shrunk，
      // 活 doc truth 含墓碑壳只作 watermark/校准/force 口径）→ <N 秒客户端收 writeFrozen=false+
      // 编辑放行物化对端可见（thawQuota 内部广播链；真实 30s 周期归 drill）
      const rec2 = await shrink.shrink(pid, 'u1', { deleteNodeIds: ['big-node'] });
      expect(rec2.result).toBe('ok');
      expect(rec2.thawed).toBe(true);   // Y0c T13 根修：删除档判据=shrunk（GC 已执行口径）<softExit→即时 thaw
      kit.gateway.docRegistry.recheckFrozenDocs();   // int 后门②：已解冻态再 recheck=no-op（保留——drill 走真实 30s 周期同款路径）；W3a：DR 公有化直调（cast 消失）
      await pollUntil(
        () => [a2, b2].every((cc) => cc.status.some((m) => m.writeFrozen === false && m.quota?.state === 'ok')),
        SHRINK_RELEASE_N_MS,
      );
      for (const cc of [a2, b2]) expect(cc.connStatus.some((x) => x.readOnly === false)).toBe(true);
      const appendsBefore = kit.repo.appendBatch.mock.calls.length;
      a2.ydoc.transact(() => a2.ydoc.getMap('nodes').set('thaw-marker', new Y.Map([['v', 1]])));
      await pollUntil(() => b2.ydoc.getMap('nodes').has('thaw-marker'), 5_000);   // 编辑放行+对端可见
      await pollUntil(() => kit.repo.appendBatch.mock.calls.length > appendsBefore, 5_000);   // 物化（store 链路发生——debounce 窗后落 repo）
    } finally {
      await kit.dispose();
    }
  }, 30_000);
});
