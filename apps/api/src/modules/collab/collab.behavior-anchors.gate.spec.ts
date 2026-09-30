// 批1-7（G24）——库行为锚 5 条 fixture 回放：真协议观测 → JSON fixture 手写落库 → 本测试双向锁。
// 先例：health-carrier.gate.spec.ts（真 Server + 真 provider 同进程、无 Prisma——onAuthenticate 直接放行）。
// 五锚（spec v5.8 ⑫ 真协议组）：
//   A1 onClose 不 emit 'close'——库 websocket 层 onClose（4408 强关分支直调入口，checkConnection 同款）只发
//      status:disconnected+disconnect；provider 'close' 仅经 forwardClose 链（服务端 CLOSE 控制消息/原生 socket close）。
//   A2 destroy 序列推 clock 两次（仅首帧发布）——removeAwarenessStates +1 已发布（off('update') 之前）→
//      awareness.destroy() 内 setLocalState(null) +1 未发布；旧实例本地终值 N+2；服务端 meta 停在 M
//      （N+1 纯删除帧被服务端 scratch 重编码丢弃——㉖ 终裁，实测一致；服务端清理靠关停驱动自有路径）。
//   A3 send() 在 !isAttached 静默 return（哑连接形态）——detach 后 doc 更新仍走 documentUpdateHandler
//      （unsyncedChanges 事件照发）但零出站帧、服务端零变更。
//   A4 SS1 应答帧序：先 SS1 后 SS2（两帧）——SRV case 内 connection.send 直发 SS1、SS2 由 apply 尾部 flush（⑨勘正定案）。
//   A5 synced 时计数=1+decrement 归零置 synced=true——resetUnsyncedChanges 置 1、首个 synced 由 SS2 驱动
//      （计数恒 1——G2 定案：服务端对 SS1 不回 SyncStatus，ack 至少晚一个 RTT）、归零由 SyncStatus 驱动。
// fixture：collab.behavior-anchors.fixture.json（手写落库；测试逐锚 toEqual 校验——库升级行为漂移即时红）。
// 注意：每用例 try/finally 保证 server/provider 销毁——否则失败路径句柄泄漏会挂住 vitest 退出。
import { describe, it, expect } from 'vitest';
import * as net from 'net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Server } from '@hocuspocus/server';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

// cwd=包根（vitest api 环境既定事实，queue-options.spec 同款）
const fixture = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), 'src/modules/collab/collab.behavior-anchors.fixture.json'),
    'utf8',
  ),
) as Record<string, string[]>;

function freePort(): Promise<number> {
  return new Promise((r) => {
    const n = net.createServer();
    n.listen(0, () => { const p = (n.address() as any).port; n.close(() => r(p)); });
  });
}

async function waitUntil(cond: () => boolean, timeoutMs = 5000, what = ''): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`waitUntil timeout: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** clientID 每次运行随机——fixture 序列统一归一为 <client>。 */
const norm = (lines: string[], clientID: number) => lines.map((l) => l.split(String(clientID)).join('<client>'));

// —— 真协议 wire 解码（lib0 变长整数/字符串；@hocuspocus/common MessageType 数值）——
// Sync=0 Awareness=1 Auth=2 QueryAwareness=3 SyncReply=4 Stateless=5 BroadcastStateless=6 CLOSE=7 SyncStatus=8 Ping=9 Pong=10
const TYPE_NAMES: Record<number, string> = {
  0: 'Sync', 1: 'Awareness', 2: 'Auth', 3: 'QueryAwareness', 4: 'SyncReply',
  5: 'Stateless', 6: 'BroadcastStateless', 7: 'CLOSE', 8: 'SyncStatus', 9: 'Ping', 10: 'Pong',
};
const SYNC_STEPS: Record<number, string> = { 0: 'SS1', 1: 'SS2', 2: 'Update' };

function decodeFrame(bytes: Uint8Array): string {
  let pos = 0;
  const readVarUint = () => {
    let num = 0; let mult = 1;
    // r===undefined 时 (undefined < 0x80) 恒 false——不抛会无限循环（守卫必须有）
    for (;;) { const r = bytes[pos++]; if (r === undefined) throw new Error('varuint past end'); num += (r & 0x7f) * mult; if (r < 0x80) return num; mult *= 128; }
  };
  const readVarStr = () => {
    const len = readVarUint();
    const s = new TextDecoder().decode(bytes.subarray(pos, pos + len));
    pos += len;
    return s;
  };
  readVarStr(); // docName（单文档测试，恒同名——不入 fixture）
  const type = readVarUint();
  const t = TYPE_NAMES[type] ?? `type${type}`;
  if (type === 0 || type === 4) return `${t}/${SYNC_STEPS[readVarUint()] ?? '?'}`;
  if (type === 1) { // awareness：varuint8Array 外层字节长 + 条目数 + { clientID, clock, state }*
    const payloadLen = readVarUint();
    const end = pos + payloadLen;
    const len = readVarUint();
    const parts: string[] = [];
    for (let i = 0; i < len; i++) {
      const c = readVarUint(); const clock = readVarUint(); const state = readVarStr();
      parts.push(`${c}@${clock}:${state === 'null' ? 'null' : 'state'}`);
    }
    pos = end;
    return `Awareness[${parts.join(',')}]`;
  }
  if (type === 2) return `Auth(${['Token', 'PermissionDenied', 'Authenticated'][readVarUint()] ?? '?'})`;
  if (type === 8) return `SyncStatus(applied=${readVarUint()})`;
  if (type === 7) return `CLOSE(${readVarStr()})`;
  return t;
}

/** 双向 wire 观测（字节副本存储，事后统一解码）。
 *  出站：补丁 ws 层实例 send（观测透传，不改传输——不注入 polyfill，㉔ 无涉）；
 *  入站：provider 'message'。⚠ 解码必须在两会话栈之外做：decodeFrame 在补丁 send 栈内同步执行
 *  会使本仓 vitest(2.1.9)/tinypool 子进程直接退出（Worker exited unexpectedly——纯 node 同代码无恙，
 *  逐帧面包屑证实 4 帧全部解码完成后才崩，栈/时序敏感）——故只存副本，观测窗口关闭后解码。 */
interface WireFrame { dir: string; bytes: Uint8Array }

function patchWsLayerSend(ws: any, wire: WireFrame[]) {
  const orig = ws.send.bind(ws);
  ws.send = (message: Uint8Array) => {
    wire.push({ dir: '->', bytes: message instanceof Uint8Array ? new Uint8Array(message) : new Uint8Array(message) });
    orig(message);
  };
}

const decodeWire = (wire: WireFrame[]): string[] =>
  wire.map((f) => `${f.dir} ${(() => { try { return decodeFrame(f.bytes); } catch { return '<undecodable>'; } })()}`);

function makeProvider(port: number, name: string, doc: Y.Doc, extra: any = {}) {
  return new HocuspocusProvider({ url: `ws://127.0.0.1:${port}`, name, document: doc, token: 'anchor', ...extra });
}

describe('批1-7 库行为锚（G24 fixture 回放）', () => {
  // 锚①拆两用例（vitest 环境下 kick 后库自持重连到不了第二个 synced——纯 node 同代码 0.5s 即愈，
  // 与 A4 解码崩溃同族的 vitest(2.1.9)/tinypool 环境特异问题；重连自愈域已由 health-carrier ㉝ 锁定，
  // 本锚只需事件集对照——两半边各自干净会话）。
  it('A1 库 websocket 层 onClose（4408 强关入口）只发 status:disconnected+disconnect 不发 close（布尔陈旧）', async () => {
    const port = await freePort();
    const server = new Server({ port, async onAuthenticate() { return {}; } });
    await server.listen();
    let provider: HocuspocusProvider | null = null;
    try {
      provider = makeProvider(port, 'anchor:1a', new Y.Doc());
      await new Promise<void>((r) => provider!.on('synced', r));
      const ws: any = (provider as any).configuration.websocketProvider;
      const events: string[] = [];
      provider.on('status', (e: any) => events.push(`status:${e.status}`));
      provider.on('disconnect', () => events.push('disconnect'));
      provider.on('close', () => events.push('close'));

      // 4408 强关分支直调（checkConnection 强关同款入口，不经 forwardClose）
      ws.onClose({ event: { code: 4408, reason: 'anchor1-forced' } });
      await new Promise((r) => setTimeout(r, 300));
      const staleIsSynced = provider.isSynced; // 强关未经 provider.onClose ⇒ 布尔陈旧（L13 家族）
      const lines = [
        `events=${JSON.stringify(events)}`,
        `isSynced-stale=${staleIsSynced}`,
      ];
      console.log(lines.join('\n'));
      // 锚①语义：只 status:disconnected+disconnect，无 close；且布尔陈旧 true
      expect(events).toEqual(['status:disconnected', 'disconnect']);
      expect(staleIsSynced).toBe(true);
      expect(lines).toEqual(fixture.anchor1);
    } finally {
      provider?.destroy();
      await server.destroy().catch(() => {});
    }
  }, 30000);

  it('A1b 服务端关停走 close（forwardClose 链）不走库 websocket 层 onClose（无 disconnect）', async () => {
    const port = await freePort();
    const server = new Server({ port, async onAuthenticate() { return {}; } });
    await server.listen();
    let provider: HocuspocusProvider | null = null;
    try {
      provider = makeProvider(port, 'anchor:1b', new Y.Doc());
      await new Promise<void>((r) => provider!.on('synced', r));
      const events: string[] = [];
      provider.on('status', (e: any) => events.push(`status:${e.status}`));
      provider.on('disconnect', () => events.push('disconnect'));
      provider.on('close', (e: any) => events.push(`close(${e?.event?.code ?? e?.code ?? '?'})`));

      // 服务端真关停：Connection.close 先发 CLOSE 控制消息 → provider.onClose()+forwardClose。
      // 不 await destroy：它等"全部连接关闭"才 resolve，而客户端收 CLOSE 控制消息后不关 socket
      // ——await 必挂起（finally 先 provider.destroy() 关 socket 后 destroy 才 resolve）。
      void server.destroy();
      await new Promise((r) => setTimeout(r, 800));
      const lines = [
        `events=${JSON.stringify(events)}`,
        `isSynced=${provider.isSynced}`,
      ];
      console.log(lines.join('\n'));
      // 锚①反向语义：'close' 只在真关停路径出现；CLOSE 分支走 provider.onClose() 复位布尔（isSynced=false），
      // 但不走库 websocket 层 onClose ⇒ 无 status/disconnect
      expect(events).toContain('close(1000)');
      expect(events.filter((e) => e === 'disconnect' || e.startsWith('status:'))).toEqual([]);
      expect(provider.isSynced).toBe(false);
      expect(lines).toEqual(fixture.anchor1b);
    } finally {
      provider?.destroy();
      await server.destroy().catch(() => {});
    }
  }, 30000);

  it('A2 destroy 双推 clock：removeAwarenessStates +1 已发布 → off(update) → destroy() 内 setLocalState(null) +1 未发布', async () => {
    const serverAwareness: string[] = [];
    const port = await freePort();
    const server = new Server({
      port,
      async onAuthenticate() { return {}; },
      async onAwarenessUpdate({ awareness, added, updated, removed }: any) {
        // 只记远端 client 的 meta（服务端自身 awareness clientID 每次运行随机——过滤保 fixture 稳定）
        const clocks = [...awareness.meta.entries()]
          .filter(([c]: any) => c !== awareness.clientID)
          .map(([c, m]: any) => `${c}@${m.clock}`)
          .join(',');
        serverAwareness.push(
          `server added=${JSON.stringify(added)} updated=${JSON.stringify(updated)} removed=${JSON.stringify(removed)} meta={${clocks}} states=${awareness.states.size}`,
        );
      },
    });
    await server.listen();
    let provider: HocuspocusProvider | null = null;
    try {
      const doc = new Y.Doc();
      provider = makeProvider(port, 'anchor:2', doc);
      await new Promise<void>((r) => provider!.on('synced', r));
      const clientID = doc.clientID;
      const awareness: any = provider.awareness;

      provider.setAwarenessField('user', { name: 'anchor2' }); // 本地 clock：构造 {}=0 → user=1（N=1）
      await waitUntil(() => serverAwareness.some((l) => l.includes(`${clientID}@1`)), 5000, 'server saw clock 1');
      const preDestroyLocalClock = awareness.meta.get(clientID).clock;

      const awarenessUpdates: string[] = [];
      awareness.on('update', ({ added, updated, removed }: any, origin: any) => {
        awarenessUpdates.push(
          `update origin=${String(origin)} a/u/r=${added.length}/${updated.length}/${removed.length} clock=${awareness.meta.get(clientID)?.clock}`,
        );
      });
      let outgoingAwareness = 0;
      provider.on('outgoingMessage', ({ message }: any) => {
        if (message?.description === 'Awareness states update') outgoingAwareness++;
      });

      provider.destroy(); // ①removeAwarenessStates(+1, 已发布) ②off(update) ③awareness.destroy()→setLocalState(null)(+1, 未发布)
      const postDestroyLocalClock = awareness.meta.get(clientID).clock;

      // 服务端收不到 N+1 删除帧：入站 awareness 先解码进 scratch 再按 states 键重编码——纯删除条目被丢弃
      // （㉖ 终裁"服务端 meta 停在 M"）。等服务端关停驱动的自有清理行（removed 含本 client 且 states=0——对远端 clientID 不 bump clock）。
      await waitUntil(() => serverAwareness.some((l) => l.includes(`removed=[${clientID}]`)), 5000, 'server close-driven cleanup');
      await new Promise((r) => setTimeout(r, 300)); // 文档卸载侧后续（若有）落齐
      const cleanupLine = serverAwareness.find((l) => l.includes(`removed=[${clientID}]`))!;
      const serverSawN1Clock = serverAwareness.some((l) => l.includes(`${clientID}@2`));

      const lines = norm([
        `preDestroyLocalClock=${preDestroyLocalClock}`,
        ...awarenessUpdates,
        `outgoingAwarenessFramesDuringDestroy=${outgoingAwareness}`,
        `postDestroyLocalClock=${postDestroyLocalClock}`,
        `serverCleanup=${cleanupLine}`,
        `serverSawRemovalFrameClockN1=${serverSawN1Clock}`,
      ], clientID);
      console.log([...lines, ...norm(serverAwareness.map((l, i) => `raw[${i}] ${l}`), clientID)].join('\n'));
      // 锚②语义：本地双推 clock（origin 依次 provider destroy/local——N+1 已发布、N+2 未发布仅 1 帧出站）；
      // 服务端：N+1 删除帧被 scratch 重编码丢弃（meta 停在 M=1），终态=关停驱动自有清理（removed、不 bump clock、states=0）
      expect(preDestroyLocalClock).toBe(1);
      expect(outgoingAwareness).toBe(1);
      expect(postDestroyLocalClock).toBe(3);
      expect(serverSawN1Clock).toBe(false);
      expect(cleanupLine).toContain(`${clientID}@1`);
      expect(cleanupLine).toContain('states=0');
      expect(lines).toEqual(fixture.anchor2);
    } finally {
      provider?.destroy();
      await server.destroy().catch(() => {});
    }
  }, 30000);

  it('A3 send() 在 !isAttached 静默 return：detach 后 doc 更新零出站帧、服务端零变更', async () => {
    let serverChanges = 0;
    const port = await freePort();
    const server = new Server({
      port,
      async onAuthenticate() { return {}; },
      async onChange() { serverChanges++; },
    });
    await server.listen();
    let provider: HocuspocusProvider | null = null;
    try {
      const doc = new Y.Doc();
      provider = makeProvider(port, 'anchor:3', doc);
      const outgoing: string[] = [];
      provider.on('outgoingMessage', ({ message }: any) => outgoing.push(message?.description ?? 'raw'));
      const unsynced: number[] = [];
      provider.on('unsyncedChanges', ({ number }: any) => unsynced.push(number));
      await new Promise<void>((r) => provider!.on('synced', r));
      // 首同步计数序列 [1,0]：startSync 置 1 → SyncStatus ack 归零（A5 同机制，此处作确定性栅极）
      await waitUntil(() => JSON.stringify(unsynced) === '[1,0]', 5000, 'first-sync counter [1,0]');

      // 阳性对照：attach 态 doc 更新正常发布（Update 帧 + 服务端 onChange + ack 归零）
      doc.getMap('m').set('k', 'v1');
      await waitUntil(() => JSON.stringify(unsynced) === '[1,0,1,0]', 5000, 'edit1 inc+ack');
      await waitUntil(() => serverChanges === 1, 5000, 'server saw edit1');
      const attachedOutgoing = outgoing.length;

      provider.detach();
      doc.getMap('m').set('k', 'v2');
      await new Promise((r) => setTimeout(r, 800)); // 足够 RTT——若 send 未静默必达
      const lines = [
        `edit1 isAttached=true outgoing=[${outgoing.slice(0, attachedOutgoing).join(',')}] serverChanges=${serverChanges} unsynced=${JSON.stringify(unsynced.slice(0, 4))}`,
        `detach isAttached=${provider.isAttached}`,
        `edit2 outgoingDelta=${outgoing.length - attachedOutgoing} outgoingAfter=[${outgoing.slice(attachedOutgoing).join(',')}] serverChanges=${serverChanges} unsynced=${JSON.stringify(unsynced)}`,
      ];
      console.log(lines.join('\n'));
      // 锚③语义：edit2 的 Update 零出站（send() 首行静默 return）、服务端零变更、handler 照跑（unsyncedChanges 再 +1）。
      // detach 后唯一出站=ws 层 detach(provider) 代发的 farewell CLOSE 帧（provider.send 时 _isAttached 尚真——库设计）。
      expect(provider.isAttached).toBe(false);
      expect(outgoing.slice(attachedOutgoing)).toEqual(['Ask the server to close the connection']);
      expect(serverChanges).toBe(1);
      expect(unsynced).toEqual([1, 0, 1, 0, 1]);
      expect(lines).toEqual(fixture.anchor3);
    } finally {
      provider?.destroy();
      await server.destroy().catch(() => {});
    }
  }, 30000);

  it('A4 SS1 应答帧序：先 SS1 后 SS2（两帧）', async () => {
    const port = await freePort();
    const server = new Server({ port, async onAuthenticate() { return {}; } });
    await server.listen();
    let provider: HocuspocusProvider | null = null;
    try {
      const wire: WireFrame[] = [];
      const doc = new Y.Doc();
      provider = makeProvider(port, 'anchor:4', doc);
      patchWsLayerSend((provider as any).configuration.websocketProvider, wire);
      provider.on('message', ({ event }: any) => {
        wire.push({ dir: '<-', bytes: new Uint8Array(event.data) });
      });
      await new Promise<void>((r) => provider!.on('synced', r));
      await new Promise((r) => setTimeout(r, 400)); // SyncStatus ack 落齐
      const wireNorm = norm(decodeWire(wire), doc.clientID);
      console.log(wireNorm.join('\n'));
      // 锚④语义：客户端 SS1 的应答=两帧且序为先 SS1（case 内直发）后 SS2（apply 尾部 flush）；客户端对 SS1 回 SS2
      expect(wireNorm.filter((l) => l.startsWith('<- Sync/')).slice(0, 2)).toEqual(['<- Sync/SS1', '<- Sync/SS2']);
      expect(wireNorm.filter((l) => l.startsWith('-> Sync/'))).toEqual(['-> Sync/SS1', '-> Sync/SS2']);
      expect(wireNorm).toEqual(fixture.anchor4);
    } finally {
      provider?.destroy();
      await server.destroy().catch(() => {});
    }
  }, 30000);

  it('A5 首个 synced 时计数恒 1；decrement 归零置 synced=true（SyncStatus 驱动）', async () => {
    const port = await freePort();
    const server = new Server({ port, async onAuthenticate() { return {}; } });
    await server.listen();
    let provider: HocuspocusProvider | null = null;
    try {
      const doc = new Y.Doc();
      provider = makeProvider(port, 'anchor:5', doc);
      const lines: string[] = [];
      let syncedCount = 0;
      provider.on('unsyncedChanges', ({ number }: any) => lines.push(`unsyncedChanges=${number} isSynced=${provider!.isSynced}`));
      provider.on('synced', () => {
        syncedCount++;
        lines.push(`synced#${syncedCount} counterAtSynced=${provider!.unsyncedChanges}`);
      });
      await new Promise<void>((r) => provider!.on('synced', r));
      await waitUntil(() => lines.includes('unsyncedChanges=0 isSynced=true'), 5000, 'ack decrement to 0');
      doc.getText('t').insert(0, 'x'); // 编辑路径：0→1（增量）→ ack →0
      await waitUntil(() => lines.filter((l) => l === 'unsyncedChanges=1 isSynced=true').length === 1, 5000, 'edit increment');
      await waitUntil(() => lines[lines.length - 1] === 'unsyncedChanges=0 isSynced=true', 5000, 'edit ack');
      await new Promise((r) => setTimeout(r, 200));
      console.log(lines.join('\n'));
      // 锚⑤语义：首个 synced 事件时计数恒 1（G2：SS2 驱动 synced、ack 至少晚一个 RTT）；归零由 SyncStatus decrement 达成
      expect(syncedCount).toBe(1);
      expect(lines[1]).toBe('synced#1 counterAtSynced=1');
      expect(provider.hasUnsyncedChanges).toBe(false);
      expect(lines).toEqual(fixture.anchor5);
    } finally {
      provider?.destroy();
      await server.destroy().catch(() => {});
    }
  }, 30000);
});
