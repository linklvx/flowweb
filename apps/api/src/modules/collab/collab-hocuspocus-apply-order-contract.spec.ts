// apps/api/src/modules/collab/collab-hocuspocus-apply-order-contract.spec.ts
// Y1c T0-S1（plan v1.7 Task 0 spike S1）：Hocuspocus 4.6.0 apply 顺序契约测试（九验收+行为锁）。
//
// 【定位】锁定 @hocuspocus/server 4.6.0 的库级时序行为（Y1c 四平面 doc-model 架构所依赖的前提），
// 今日对最小插桩 harness 全绿；T9 落地 CollabProjectActor（gate pre-apply 所有权）后本套件原样
// 复用为其回归面；任何 4.7.x 升级若改变下列任一时序=本套件先红（行为锁）。
//
// 【九验收 → 测试映射】（⑧=静态 census 门，非运行时面——见结论文档）
//  ① 合法帧：无 gate 基线（库自 apply=connection 档恰一）+T9 形态 gate 预 apply（beforeSync 内
//    apply，origin={source:'connection',connection,gate:true}）→库内重放幂等零额外 update 事件
//    +恰一次 SyncStatus(true)。
//  ② 广播到全部连接恰一次（含发送者回声——broadcastUpdate 不传 filter，esm:689-691）；echo 字节
//    数=连接数×单帧字节；发送者收自身 update 后 apply=no-op 零 doc 事件（零 UI 副作用）。
//  ③ 坏帧（malformed update）三面：gate 拒（解析失败→hardClose 4411+throw）=无 SyncStatus(true)
//    +doc 不变+WAL 零追加+零广播；库基线（无 gate）=y-protocols readUpdate（=readSyncStep2）
//    内建 try/catch 吞 apply 错误+照发 SyncStatus(true)——【spike 发现 F-1：库不可拒坏帧】；
//    库裸 throw 路径（③″）=app 级 CLOSE 消息仅携 reason 串、raw ws 不关（close code 被丢弃）
//    ——【spike 发现 F-2：码权威投递必须 webSocket.close 先行（生产 hardClose 形态根因）】。
//  ④ 重复帧：applied 后同字节重放=零新 update 事件+零二次广播+WAL 零追加（SHA-256 命中）+恰一
//    SyncStatus(true)；并发同字节双连接=单 update 事件（一个 walSeq）+双 ACK+单次广播。
//    （in-flight promise map/fsync 后放行=T9 actor 语义——库侧前提由本测试锁定，见结论文档。）
//  ⑤ readOnly 短路：VIEWER 连接发 Update→beforeSync 已被调用（库 readOnly 检查在 beforeSync 后）
//    +库短路=零 apply+SyncStatus(false)+doc 不变+零广播；SS1 路径零 WAL 帧；SS2 与 Update 双路径
//    均入账（gate 预 apply 经 beforeSync:ss2 / beforeSync:update 两形态）。
//  ⑥ awareness 路径不受影响（真 provider 双端）：beforeSync/doc update/WAL/onStoreDocument 全零增量。
//  ⑦ onLoadDocument 产 update 但零 WAL 帧：装载经库回调 applyUpdate（origin=null→load 档）；
//    onChange/onStoreDocument 零调用（handleDocumentUpdate 装载后才接线 esm:1487）；
//    顺序锁 update:load 先于首个 beforeSync；⑦′ server-direct（openDirectConnection）=local 档
//    （census ⑧ 运行时对照面：local 档写触发防抖 store——skipStoreHooks 缺省 false）。
//  ⑧ 静态 census 门（allowlist=load/replay/maintenance/readCanvas/withDoc 读路径）——本套件零
//    运行时断言；⑦′ 提供 DirectConnection 写的运行时对照事实（见结论文档 §⑧）。
//  ⑨ onStoreDocument×connection-origin：**库基线=防抖恰一次触发**（connection 档不跳过 store 钩子
//    ——esm:60-67+1414-1423；T0 真值=TODAY 分支）+skipStoreHooks 逃生舱实证（local 档+true=零
//    store）+T9 翻转点常量（所有权切换后旧链 telemetry-only→改断零调用）。
//
// 【装置】最小插桩真 Server（@hocuspocus/server 4.6.0 直接构造——不经生产 CollabGateway；钩子=
// telemetry-only 计数器，模型化 T9 目标接线：无 store 调用）+真 ws 客户端两形态：
//  · RawSyncClient：裸 ws+真 y-protocols wire 帧（frame-encoder 单源——collab-rate-gate.spec 同款
//    先例；Auth/SS1/SS2/Update 全链路手走）——字节级/SyncStatus 计数/注入精确重复帧与坏帧的仪器。
//  · HocuspocusProvider（4.6.0）：⑥ awareness 真客户端（kit makeHeaderWs 注入式 ws 形态）。
// 「WAL 帧」在 T0 harness 语义=「gate 受理且产生状态变化的帧」（harness 台账计数——T9 actor 落地前
// 的替身；崩溃恢复「截断至 appliedSeq」属 actor 管线，见结论文档）。
//
// 【层级选择】主池（vitest.config.ts 默认集）：真 Server+真 ws 先例=collab.gateway.spec（主池），
// 本套件零 DB、freePort() 真空闲端口（net listen(0)——collab.behavior-anchors.gate.spec:33-38 先例，
// 主池文件级并行下随机段抽取有碰撞面）——int 池=e2e/DB 前提、heavy 池=实时等待≥10s 级（本套件单测
// 0.4-2s）均不适用。
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createHash } from 'node:crypto';
import * as net from 'node:net';
import WebSocket from 'ws';
import { Server } from '@hocuspocus/server';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { messageYjsSyncStep1, messageYjsSyncStep2, messageYjsUpdate } from 'y-protocols/sync';
import { makeFrame } from '../../test-utils/frame-encoder';
import { pollUntil } from '../../test-utils/poll-until';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha256 = (u: Uint8Array) => createHash('sha256').update(u).digest('hex');

/** 库 MessageType（server/provider dist 同值枚举的手抄常量——@hocuspocus/common 未出口） */
const MT = { Sync: 0, Auth: 2, Close: 7, SyncStatus: 8 } as const;
/** @hocuspocus/common AuthMessageType（auth wire 面——dist 实证 Token=0/Authenticated=2） */
const AUTH = { Token: 0, PermissionDenied: 1, Authenticated: 2 } as const;

/** T9 origin 枚举的 T0 子集（gate|connection|load|local；import/maintenance=T9-only 档——结论文档 §⑦） */
type OriginClass = 'gate' | 'connection' | 'load' | 'local' | 'other';

/** origin 分类：{source:'connection'}+gate:true=gate 档；{source:'connection'}=connection 档（库自
 * apply——readUpdate/readSyncStep2 传 {source:'connection',connection}，esm:277-291）；{source:'local'}
 * =local 档（DirectConnection.transact esm:1138-1143）；非 TransactionOrigin（origin=null——库装载
 * 回调 applyUpdate 缺省 origin，yjs transact(doc,f,origin=null)）=load 档（服务端唯一 null 源=装载）。 */
function classifyOrigin(origin: unknown): OriginClass {
  if (typeof origin === 'object' && origin !== null && 'source' in origin) {
    const src = (origin as { source: unknown; gate?: boolean }).source;
    if (src === 'connection') return (origin as { gate?: boolean }).gate ? 'gate' : 'connection';
    if (src === 'local') return 'local';
    if (src === 'redis') return 'other';
  }
  return 'load';
}

type SyncTypeName = 'ss1' | 'ss2' | 'update';
const syncTypeName = (t: number): SyncTypeName =>
  t === messageYjsSyncStep1 ? 'ss1' : t === messageYjsSyncStep2 ? 'ss2' : 'update';

/** gate 受理帧台账条目（T9 actor WAL 的 T0 替身：仅状态变化帧入账+SHA-256 去重命中计数） */
interface WalEntry { seq: number; kind: SyncTypeName; bytes: number; sha256: string; }

interface HarnessCounters {
  hooks: {
    onConnect: number; onAuthenticate: number; connected: number;
    onLoadDocument: number; afterLoadDocument: number;
    beforeSync: Record<SyncTypeName, number>;
    beforeHandleMessage: number; afterHandleMessage: number;
    onChange: Record<OriginClass, number>;
    onStoreDocument: number; afterStoreDocument: number;
    onAwarenessUpdate: number; beforeHandleAwareness: number;
    onDisconnect: number; beforeUnloadDocument: number; afterUnloadDocument: number;
  };
  /** 服务端 Y.Doc 'update' 事件按 origin 分类（onLoadDocument 期挂表——此后一切 apply 均计数） */
  docUpdates: Record<OriginClass, number>;
  /** SHA-256 命中已 applied 帧的重复帧数（T9 actor 去重台账模型） */
  walDuplicates: number;
  /** 无新内容且未见过哈希的帧（如空客户端的空 SS2）——幂等 no-op 不入账 */
  walNoops: number;
  /** gate 受理且产生状态变化的帧（=「WAL 帧」的 T0 语义） */
  wal: WalEntry[];
  /** 顺序锁：关键事件序列（beforeSync:…/update:…/onChange:…/onStoreDocument/gate-reject…） */
  log: string[];
}

interface HarnessOpts {
  /** T9 目标形态：beforeSync 内 gate 预 apply（缺省 true；false=无 gate 纯库基线） */
  gatePreApply?: boolean;
  /** ③：gate 解析失败→hardClose(4411)+throw（生产 guardSyncFrame「码权威投递=webSocket.close 先行」形态） */
  rejectMalformed?: boolean;
  /** ③″：拒帧 throw 但**不** hardClose——锁库裸 throw 路径（app 级 CLOSE 消息+raw ws 不关） */
  rejectWithoutHardClose?: boolean;
  /** ⑤：这些 token 的连接在 onAuthenticate 置 readOnly（生产 SessionGuard :587 VIEWER 形态） */
  readOnlyTokens?: Set<string>;
  /** ⑦：docName→装载源 doc（onLoadDocument 返回 Y.Doc——库回调 applyUpdate 装载） */
  loadDocs?: Map<string, Y.Doc>;
}

const zeroOrigin = (): Record<OriginClass, number> => ({ gate: 0, connection: 0, load: 0, local: 0, other: 0 });

/** 真空闲端口（net listen(0)——collab.behavior-anchors.gate.spec:33-38 先例；主池文件级并行下随机段
 *  抽取有碰撞面，OS 分配零竞争）。 */
function freePort(): Promise<number> {
  return new Promise((r) => {
    const n = net.createServer();
    n.listen(0, () => { const p = (n.address() as net.AddressInfo).port; n.close(() => r(p)); });
  });
}

/** 最小插桩 harness：真 Server（freePort 空闲端口）+telemetry-only 钩子+T9 形态 gate（beforeSync 预 apply）。 */
async function startContractServer(opts: HarnessOpts = {}) {
  const c: HarnessCounters = {
    hooks: {
      onConnect: 0, onAuthenticate: 0, connected: 0, onLoadDocument: 0, afterLoadDocument: 0,
      beforeSync: { ss1: 0, ss2: 0, update: 0 },
      beforeHandleMessage: 0, afterHandleMessage: 0,
      onChange: zeroOrigin(), onStoreDocument: 0, afterStoreDocument: 0,
      onAwarenessUpdate: 0, beforeHandleAwareness: 0,
      onDisconnect: 0, beforeUnloadDocument: 0, afterUnloadDocument: 0,
    },
    docUpdates: zeroOrigin(), walDuplicates: 0, walNoops: 0, wal: [], log: [],
  };
  let walSeq = 0;
  const port = await freePort();
  // 防抖 50/75ms（⑨ 可等窗落地）；flush 族/timeout/stopOnSignals/address 与生产工厂 pin 同值
  // （collab-server.factory.ts:34-80——flushDelay:0+flushMaxBytes:1MiB=库默认原值 pin）。
  const server = new Server({
    port, address: '127.0.0.1', quiet: true, stopOnSignals: false,
    debounce: 50, maxDebounce: 75, timeout: 30_000,
    flushDelay: 0, flushMaxBytes: 1_048_576,
    onConnect: async () => { c.hooks.onConnect++; },
    onAuthenticate: async (p) => {
      c.hooks.onAuthenticate++; c.log.push('onAuthenticate');
      if (opts.readOnlyTokens?.has(String(p.token))) p.connectionConfig.readOnly = true;   // 生产 :587 同款
    },
    connected: async () => { c.hooks.connected++; },
    beforeHandleMessage: async () => { c.hooks.beforeHandleMessage++; },
    afterHandleMessage: async () => { c.hooks.afterHandleMessage++; },
    // 装载：挂 origin 分类 update 计数器（先于库回调 applyUpdate——装载事件入 load 档）+可选返回源 doc
    onLoadDocument: async (p) => {
      c.hooks.onLoadDocument++; c.log.push('onLoadDocument');
      p.document.on('update', (_u: Uint8Array, origin: unknown) => {
        const cls = classifyOrigin(origin);
        c.docUpdates[cls]++; c.log.push(`update:${cls}`);
      });
      const src = opts.loadDocs?.get(p.documentName);
      if (src) return src;   // 库回调 applyUpdate(document, encodeStateAsUpdate(src))——origin=null（esm:1477-1480）
      return undefined;
    },
    afterLoadDocument: async () => { c.hooks.afterLoadDocument++; },
    // ===== T9 目标形态 gate：beforeSync 预 apply（telemetry-only——无 store 调用） =====
    // 分层序镜像生产 guardSyncFrame（collab-doc-registry.service.ts:676-745）：SS1 零判→readOnly 短路
    // →坏帧拒（③）→预 apply+台账。库侧事实：beforeSync 先于库 readOnly 检查（esm:251 vs 284）——⑤ 实证。
    beforeSync: async (p) => {
      const t = syncTypeName(p.type);
      c.hooks.beforeSync[t]++; c.log.push(`beforeSync:${t}`);
      if (p.type === messageYjsSyncStep1) return;   // SS1=读路径零判（⑤ 零 WAL 面）
      const conn = p.connection as unknown as {
        readOnly?: boolean;
        webSocket?: { close(code?: number, reason?: string): void };
      };
      if (conn?.readOnly) return;   // readOnly 短路在 gate 侧先行（T9 gate 必须自判——库检查在其后）
      if (opts.rejectMalformed) {
        const scratch = new Y.Doc();
        try {
          Y.applyUpdate(scratch, p.payload);   // 真解析验证（gate 的帧合法性判据）
        } catch {
          scratch.destroy();
          c.log.push('gate-reject');
          // 生产 hardClose 形态：码权威投递=webSocket.close 先行，throw 仅兜底中止帧+清队列
          //（collab-session-guard.service.ts:707-714——throw.code 被库 Connection.close 丢弃的先例）
          // ③″ 模式省略 webSocket.close——锁库裸 throw 路径事实。
          if (!opts.rejectWithoutHardClose) conn?.webSocket?.close(4411, 'frame-malformed');
          throw Object.assign(new Error('frame malformed'), { code: 4411, reason: 'frame-malformed' });
        }
        scratch.destroy();
      }
      if (opts.gatePreApply !== false) {
        const before = c.docUpdates.gate;
        Y.applyUpdate(p.document, p.payload, { source: 'connection', connection: p.connection, gate: true });
        const h = sha256(p.payload);
        const seen = c.wal.some((w) => w.sha256 === h);
        if (c.docUpdates.gate > before) {
          c.wal.push({ seq: ++walSeq, kind: t, bytes: p.payload.byteLength, sha256: h });
        } else if (seen) {
          c.walDuplicates++;   // SHA-256 命中已 applied 帧（T9 actor 去重台账模型）
        } else {
          c.walNoops++;        // 空帧/无新内容（全新客户端的空 SS2）——幂等 no-op 不入账
        }
        c.log.push('gate-apply');
      }
    },
    beforeHandleAwareness: async () => { c.hooks.beforeHandleAwareness++; },
    onAwarenessUpdate: async () => { c.hooks.onAwarenessUpdate++; },
    onChange: async (p) => {
      const cls = classifyOrigin(p.transactionOrigin);
      c.hooks.onChange[cls]++; c.log.push(`onChange:${cls}`);
    },
    onStoreDocument: async () => { c.hooks.onStoreDocument++; c.log.push('onStoreDocument'); },
    afterStoreDocument: async () => { c.hooks.afterStoreDocument++; },
    onDisconnect: async () => { c.hooks.onDisconnect++; },
    beforeUnloadDocument: async () => { c.hooks.beforeUnloadDocument++; },
    afterUnloadDocument: async () => { c.hooks.afterUnloadDocument++; },
  });
  await server.listen(port);
  const url = `ws://127.0.0.1:${port}`;
  const clients: Array<{ destroy: () => void }> = [];
  return {
    server, counters: c, url,
    /** 服务端在役 doc（读面断言用——rate-gate.spec :95 documents.get 先例） */
    liveDoc: (name: string) => server.hocuspocus.documents.get(name),
    track(cl: { destroy: () => void }) { clients.push(cl); },
    async dispose() {
      for (const cl of clients.splice(0)) cl.destroy();
      await sleep(50);   // 服务端 onClose→unload 链落定
      const destroyed = server.destroy().catch(() => {});   // 悬挂兜底 race 尾——rejection 先行消解防 unhandled
      await Promise.race([destroyed, sleep(3_000)]);
    },
  };
}

/** 裸 ws varint 读（lib0 非 api 直依赖——frame-encoder 头注先例；只读面手抄） */
class WireReader {
  private pos = 0;
  constructor(private readonly data: Uint8Array) {}
  varUint(): number {
    let num = 0, mult = 1;
    while (this.pos < this.data.length) {
      const r = this.data[this.pos++];
      num += (r & 0x7f) * mult;
      mult *= 128;
      if (r < 0x80) return num;
    }
    throw new Error('varuint eof');
  }
  varString(): string {
    const len = this.varUint();
    const s = new TextDecoder().decode(this.data.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }
  varUint8Array(): Uint8Array {
    const len = this.varUint();
    const u = this.data.subarray(this.pos, this.pos + len);
    this.pos += len;
    return u;
  }
}

interface RawUpdateMsg { totalBytes: number; payload: Uint8Array; }

/** 裸 ws 真客户端：Auth→SS1→SS2 交换全链路（真 y-protocols wire 形——provider 等价握手），
 *  +字节级收包分类计数+本地用户写（transact 捕获 update 字节即发——provider documentUpdateHandler
 *  esm:762-775 等价形态）+任意帧注入（重复/坏帧仪器）。 */
class RawSyncClient {
  readonly doc = new Y.Doc();
  private readonly userOrigin = { s1User: true };
  private readonly remoteOrigin = { s1Remote: true };
  docLocalUpdates = 0;        // 本地用户写产生的 doc update 事件（用户 origin）
  remoteApplies = 0;          // 远端新内容 apply 产生的事件（echo no-op 零事件——yjs hasContent=false）
  syncStatusTrue = 0; syncStatusFalse = 0;
  updateMessages: RawUpdateMsg[] = [];   // 收到的 Sync/Update（广播回声）——totalBytes=整帧 ws 字节
  closeReasons: string[] = [];
  private ws: WebSocket;
  private authenticated = false;
  private gotSS2 = false;
  private resolveReady: () => void = () => {};
  readonly ready: Promise<void> = new Promise((r) => { this.resolveReady = r; });
  private closeEvent: { code: number; reason: string } | null = null;

  constructor(
    private readonly url: string,
    readonly name: string,
    private readonly token = 's1-token',
    seed?: (doc: Y.Doc) => void,
  ) {
    this.doc.on('update', (_u: Uint8Array, origin: unknown) => {
      if (origin === this.userOrigin) this.docLocalUpdates++;
      else if (origin === this.remoteOrigin) this.remoteApplies++;
    });
    if (seed) this.doc.transact(() => seed(this.doc), this.userOrigin);
    this.ws = new WebSocket(url, { headers: { origin: 'http://localhost:5173' } });
    this.ws.on('error', () => { /* 关闭握手期 error 无人消费会抛——吞（rate-gate 同款） */ });
    this.ws.once('close', (code: number, reason: Buffer) => {
      if (this.closeEvent === null) this.closeEvent = { code, reason: reason.toString() };
    });
    this.ws.on('message', (data: import('ws').RawData) => this.handleMessage(new Uint8Array(data as Buffer)));
    this.ws.once('open', () => {
      // provider 握手形态（provider esm:851-872）：onOpen→sendToken+startSync——Auth 与 SS1 同发
      //（服务端 pre-auth 队列缓冲：认证完成后重放——ClientConnection esm:872-876）
      this.ws.send(makeFrame(name, MT.Auth, AUTH.Token, token));          // varString(name)+varUint(2)+varUint(0)+varString(token)
      this.ws.send(makeFrame(name, MT.Sync, messageYjsSyncStep1, Y.encodeStateVector(this.doc)));
    });
  }

  private checkReady() { if (this.authenticated && this.gotSS2) this.resolveReady(); }

  private handleMessage(data: Uint8Array): void {
    const r = new WireReader(data);
    r.varString();                       // routing key（文档名）
    const type = r.varUint();
    if (type === MT.Auth) {
      const sub = r.varUint();
      if (sub === AUTH.Authenticated) { r.varString(); this.authenticated = true; this.checkReady(); }
    } else if (type === MT.Sync) {
      const syncType = r.varUint();
      if (syncType === messageYjsSyncStep1) {
        const sv = r.varUint8Array();
        const reply = Y.encodeStateAsUpdate(this.doc, sv);
        this.ws.send(makeFrame(this.name, MT.Sync, messageYjsSyncStep2, reply));
      } else if (syncType === messageYjsSyncStep2 || syncType === messageYjsUpdate) {
        const payload = r.varUint8Array();
        if (syncType === messageYjsSyncStep2) this.gotSS2 = true;
        else this.updateMessages.push({ totalBytes: data.byteLength, payload });
        try { Y.applyUpdate(this.doc, payload, this.remoteOrigin); } catch { /* 坏帧客户端容错——服务端才是受测面 */ }
        this.checkReady();
      }
    } else if (type === MT.SyncStatus) {
      if (r.varUint() === 1) this.syncStatusTrue++; else this.syncStatusFalse++;
    } else if (type === MT.Close) {
      this.closeReasons.push(r.varString());
    }
  }

  /** 连接+握手+首个 ack（自身 SS2 的 SyncStatus——空客户端亦 1 次）落定 */
  async firstAcked(): Promise<void> {
    await this.ready;
    await pollUntil(() => this.syncStatusTrue + this.syncStatusFalse >= 1);
  }

  /** 本地用户写一帧：transact 捕获 doc update 事件字节即发（provider documentUpdateHandler 等价） */
  transactWrite(fn: (doc: Y.Doc) => void): Uint8Array {
    let captured: Uint8Array | null = null;
    const listener = (u: Uint8Array, origin: unknown) => { if (origin === this.userOrigin && !captured) captured = u; };
    this.doc.on('update', listener);
    try {
      this.doc.transact(() => fn(this.doc), this.userOrigin);   // transact 回调收 Transaction——用户 fn 收 doc
    } finally {
      this.doc.off('update', listener);
    }
    const u = captured;
    if (!u) throw new Error('transactWrite 回调零写（transact 无变更→无 update 事件）——拒绝发空体帧（防伪断言源）');
    this.ws.send(makeFrame(this.name, MT.Sync, messageYjsUpdate, u));
    return u;
  }

  /** 任意 update 帧注入（精确字节重复/坏帧——不本地 apply） */
  sendRawUpdate(update: Uint8Array): void {
    this.ws.send(makeFrame(this.name, MT.Sync, messageYjsUpdate, update));
  }

  closeInfo(): { code: number; reason: string } | null { return this.closeEvent; }

  destroy(): void { try { this.ws.close(); } catch { /* 已关 */ } }
}

/** ⑥ 用真 provider 客户端（kit makeHeaderWs 注入式形态——URL 无 query token，token 走 Auth 面） */
function connectProvider(url: string, name: string): { provider: HocuspocusProvider; doc: Y.Doc; synced: Promise<void> } {
  const doc = new Y.Doc();
  class HeaderWs extends WebSocket {
    constructor(u: string | URL) { super(u as string, { headers: { origin: 'http://localhost:5173' } }); }
  }
  const provider = new HocuspocusProvider({
    url, name, document: doc, token: 's1-token',
    WebSocketPolyfill: HeaderWs,   // WebSocketPolyfill 运行时透传（ws-polyfill.gate.spec 先例）
  } as any);
  const synced = new Promise<void>((resolve) => provider.on('synced', () => resolve()));
  return { provider, doc, synced };
}

/** 坏帧：真 update 字节截尾（探针实证 Y.applyUpdate 抛 'Unexpected end of array'） */
function malformedUpdate(): Uint8Array {
  const src = new Y.Doc();
  src.getMap('nodes').set('bad', 'frame');
  const good = Y.encodeStateAsUpdate(src);
  return good.slice(0, good.byteLength - 3);
}

describe('Y1c T0-S1 Hocuspocus 4.6.0 apply 顺序契约（九验收+行为锁）', () => {
  it('① 合法帧双形态：无 gate 基线（库自 apply=connection 档恰一+恰一 SyncStatus(true)）+T9 gate 预 apply 形态（update:gate 恰一+库内重放零额外 update 事件+WAL 入账+顺序锁 beforeSync<update:gate<onChange:gate）', async () => {
    // —— 臂一：无 gate 基线（纯库路径——锁定 gate 缺席时的库自 apply 行为）——
    {
      const h = await startContractServer({ gatePreApply: false });
      try {
        const a = new RawSyncClient(h.url, 'project:c1');
        h.track(a);
        await a.firstAcked();
        const st0 = a.syncStatusTrue;
        a.transactWrite((d) => d.getMap('nodes').set('n1', 'v1'));
        await pollUntil(() => a.syncStatusTrue >= st0 + 1);
        expect(a.syncStatusTrue).toBe(st0 + 1);                      // 恰一次 SyncStatus(true)（esm:292）
        expect(h.counters.docUpdates.connection).toBe(1);            // 库自 apply=connection 档恰一（esm:288-291）
        expect(h.counters.docUpdates.gate).toBe(0);
        expect(h.counters.hooks.onChange.connection).toBe(1);
        expect(h.counters.wal).toHaveLength(0);                      // 无 gate=受理面缺席（T0 无 actor）
        expect(h.liveDoc('project:c1')?.getMap('nodes').get('n1')).toBe('v1');
      } finally { await h.dispose(); }
    }
    // —— 臂二：T9 目标形态（gate 预 apply——beforeSync 内 apply，库 apply 变幂等重放）——
    {
      const h = await startContractServer({});
      try {
        const a = new RawSyncClient(h.url, 'project:c1');
        h.track(a);
        await a.firstAcked();
        const st0 = a.syncStatusTrue;
        const u = a.transactWrite((d) => d.getMap('nodes').set('n1', 'v1'));
        await pollUntil(() => a.syncStatusTrue >= st0 + 1);
        expect(h.counters.docUpdates.gate).toBe(1);                  // gate 预 apply 产恰一 update 事件
        expect(h.counters.docUpdates.connection).toBe(0);            // 库内重放=幂等 no-op 零额外 update 事件（yjs hasContent=false）
        expect(h.counters.hooks.onChange.gate).toBe(1);
        expect(a.syncStatusTrue).toBe(st0 + 1);                      // 恰一次 SyncStatus(true)——重放 no-op 不影响 ACK
        expect(h.counters.wal).toHaveLength(1);                      // 受理恰一帧
        expect(h.counters.wal[0]).toMatchObject({ kind: 'update', bytes: u.byteLength, sha256: sha256(u) });
        expect(h.liveDoc('project:c1')?.getMap('nodes').get('n1')).toBe('v1');
        // 顺序锁：beforeSync 内预 apply→事件序 beforeSync:update < update:gate < onChange:gate
        const li = (s: string) => h.counters.log.indexOf(s);
        expect(li('beforeSync:update')).toBeGreaterThanOrEqual(0);
        expect(li('beforeSync:update')).toBeLessThan(li('update:gate'));
        expect(li('update:gate')).toBeLessThan(li('onChange:gate'));
      } finally { await h.dispose(); }
    }
  }, 20_000);

  it('② 广播到全部连接恰一次（含发送者回声）+echo 字节数=连接数×单帧字节+发送者回声 apply=no-op 零 doc 事件', async () => {
    const h = await startContractServer({});   // gate 形态（T9 目标——广播回声由 gate apply 的 update 事件面发出）
    try {
      const A = new RawSyncClient(h.url, 'project:c2');
      const B = new RawSyncClient(h.url, 'project:c2');
      const C = new RawSyncClient(h.url, 'project:c2');
      h.track(A); h.track(B); h.track(C);
      await Promise.all([A.firstAcked(), B.firstAcked(), C.firstAcked()]);
      await sleep(100);   // 连接期尾包结算窗

      const u = A.transactWrite((d) => d.getMap('nodes').set('n2', 'v2'));
      await pollUntil(() => B.updateMessages.length >= 1 && C.updateMessages.length >= 1 && A.updateMessages.length >= 1);
      await sleep(150);   // 结算窗——「恰一次」断言（无第二条）

      // 广播到全部连接恰一次（含发送者回声——broadcastUpdate 无 filter，esm:689-691）
      for (const cl of [A, B, C]) expect(cl.updateMessages).toHaveLength(1);
      // 三连接收到字节等值（同 messageAddress 单缓冲广播——broadcast 缓存 esm:658-670）
      const perMsg = A.updateMessages[0].totalBytes;
      expect(B.updateMessages[0].totalBytes).toBe(perMsg);
      expect(C.updateMessages[0].totalBytes).toBe(perMsg);
      // echo 字节数=连接数×单帧字节（3 连接全量回声总字节）
      const totalEchoBytes = A.updateMessages[0].totalBytes + B.updateMessages[0].totalBytes + C.updateMessages[0].totalBytes;
      expect(totalEchoBytes).toBe(3 * perMsg);
      // 回声载荷语义=源帧内容（应用到新 doc 复现）
      const fresh = new Y.Doc();
      Y.applyUpdate(fresh, A.updateMessages[0].payload);
      expect(fresh.getMap('nodes').get('n2')).toBe('v2');
      // 发送者回声 apply=no-op：A 本地事件=1（仅用户写）+远端事件 0（回声幂等——零 UI 副作用）；B/C=远端+1
      expect(A.docLocalUpdates).toBe(1);
      expect(A.remoteApplies).toBe(0);
      expect(B.remoteApplies).toBe(1);
      expect(C.remoteApplies).toBe(1);
      // 服务端面：单 update 事件（gate 档）+恰一广播窗（每连接恰一条）
      expect(h.counters.docUpdates.gate).toBe(1);
      expect(h.counters.hooks.onChange.gate).toBe(1);
      expect(u.byteLength).toBeGreaterThan(0);   // 帧字节非空（防伪断言）
    } finally { await h.dispose(); }
  }, 20_000);

  it('③ 坏帧 gate 拒：解析失败→hardClose 4411+throw 兜底——close 4411 无 SyncStatus(true)+doc 不变+WAL 零追加+零广播+顺序锁（拒在 beforeSync 内）', async () => {
    const h = await startContractServer({ rejectMalformed: true });
    try {
      const a = new RawSyncClient(h.url, 'project:c3');
      const b = new RawSyncClient(h.url, 'project:c3');   // 广播观察者
      h.track(a); h.track(b);
      await Promise.all([a.firstAcked(), b.firstAcked()]);
      await sleep(100);
      const st0 = a.syncStatusTrue;

      a.sendRawUpdate(malformedUpdate());
      await pollUntil(() => a.closeInfo() !== null, 8_000);
      expect(a.closeInfo()).toEqual({ code: 4411, reason: 'frame-malformed' });   // 生产 hardClose 形态的码投递实证
      expect(a.syncStatusTrue).toBe(st0);               // 无 SyncStatus(true)——beforeSync 抛先于库 apply/ACK（esm:251 vs 288-292）
      expect(h.counters.docUpdates.gate + h.counters.docUpdates.connection).toBe(0);   // doc 不变（零 apply）
      expect(h.counters.wal).toHaveLength(0);           // 坏帧不入账（「截断至 appliedSeq」的 T0 结构等价——台账只含受理帧）
      await sleep(150);
      expect(b.updateMessages).toHaveLength(0);         // 零广播
      // 顺序锁：拒帧发生在 beforeSync 内（gate-reject 紧随 beforeSync:update）
      const li = (s: string) => h.counters.log.indexOf(s);
      expect(li('beforeSync:update')).toBeGreaterThanOrEqual(0);
      expect(li('beforeSync:update')).toBeLessThan(li('gate-reject'));
    } finally { await h.dispose(); }
  }, 20_000);

  it('③′ 库基线（无 gate）：坏帧 apply 错误被 y-protocols 内吞（readUpdate=readSyncStep2 内建 try/catch）→连接不关+SyncStatus(true) 照发+doc 不变——【spike 发现 F-1：库不可拒坏帧，gate 必须自解析】', async () => {
    const h = await startContractServer({ gatePreApply: false, rejectMalformed: false });
    try {
      const a = new RawSyncClient(h.url, 'project:c3b');
      const b = new RawSyncClient(h.url, 'project:c3b');
      h.track(a); h.track(b);
      await Promise.all([a.firstAcked(), b.firstAcked()]);
      await sleep(100);
      const st0 = a.syncStatusTrue;

      a.sendRawUpdate(malformedUpdate());
      await pollUntil(() => a.syncStatusTrue >= st0 + 1);
      expect(a.syncStatusTrue).toBe(st0 + 1);           // 库仍发 SyncStatus(true)——readUpdate 吞错后无条件 ACK（esm:288-292）
      expect(a.closeInfo()).toBeNull();                 // 连接存活（错误不上抛）
      expect(h.counters.docUpdates.connection).toBe(0); // doc 不变（apply 抛错被吞——yjs 零事件）
      await sleep(150);
      expect(b.updateMessages).toHaveLength(0);         // 零广播（无 update 事件）
    } finally { await h.dispose(); }
  }, 20_000);

  it('③″ 库裸 throw 路径（无 hardClose）：beforeSync throw→Connection.close 发 app 级 CLOSE 消息（仅 reason 串）——raw ws 不关（close code 丢弃）+队列清空——生产「码权威投递=webSocket.close 先行」的库侧根因锁', async () => {
    const h = await startContractServer({ rejectMalformed: true, rejectWithoutHardClose: true });
    try {
      const a = new RawSyncClient(h.url, 'project:c3c');
      const b = new RawSyncClient(h.url, 'project:c3c');
      h.track(a); h.track(b);
      await Promise.all([a.firstAcked(), b.firstAcked()]);
      await sleep(100);
      const st0 = a.syncStatusTrue;

      a.sendRawUpdate(malformedUpdate());
      await pollUntil(() => a.closeReasons.length >= 1, 8_000);   // app 级 CLOSE 消息到达（MessageType.CLOSE——esm:418-426）
      expect(a.closeReasons).toEqual(['frame-malformed']);        // 消息体只携带 reason 串（e.reason——writeCloseMessage）
      await sleep(1_500);   // ws 级关闭观测窗——库不关 raw ws（close code 被 Connection.close 丢弃）
      expect(a.closeInfo()).toBeNull();                           // 无 ws close 帧（「30s 僵尸」形态的库侧根因）
      expect(a.syncStatusTrue).toBe(st0);                         // 无 SyncStatus(true)（throw 先于 ACK——esm:251 vs 292）
      expect(h.counters.wal).toHaveLength(0);                     // 坏帧不入账
      expect(h.counters.hooks.onDisconnect).toBe(1);              // doc 级连接已拆（onClose 回调→onDisconnect——esm:1055-1069）
    } finally { await h.dispose(); }
  }, 20_000);

  it('④ 重复帧（applied 后同字节重放）：SHA-256 命中=零新 update 事件+零二次广播+WAL 零追加+恰一 SyncStatus(true)（库对重复帧无条件 ACK）', async () => {
    const h = await startContractServer({});
    try {
      const a = new RawSyncClient(h.url, 'project:c4');
      const b = new RawSyncClient(h.url, 'project:c4');
      h.track(a); h.track(b);
      await Promise.all([a.firstAcked(), b.firstAcked()]);
      await sleep(100);

      const u = a.transactWrite((d) => d.getMap('nodes').set('n4', 'v4'));
      await pollUntil(() => b.updateMessages.length >= 1 && a.updateMessages.length >= 1);
      const st0 = a.syncStatusTrue;
      const gate0 = h.counters.docUpdates.gate;
      const wal0 = h.counters.wal.length;

      a.sendRawUpdate(u);   // 原字节精确重放（重复帧）
      await pollUntil(() => a.syncStatusTrue >= st0 + 1);
      expect(a.syncStatusTrue).toBe(st0 + 1);           // ACK 恰一（esm:292 无条件）
      expect(h.counters.docUpdates.gate).toBe(gate0);   // 幂等重放=零新 update 事件
      expect(h.counters.wal).toHaveLength(wal0);        // WAL 零追加（SHA-256 命中）
      expect(h.counters.walDuplicates).toBe(1);
      await sleep(150);
      expect(b.updateMessages).toHaveLength(1);         // 零二次广播（观察者仍恰一条）
      expect(a.updateMessages).toHaveLength(1);
    } finally { await h.dispose(); }
  }, 20_000);

  it('④′ 并发同字节双连接：恰一 update 事件（=T9「一个 walSeq」的库侧前提）+双 ACK（各自 SyncStatus(true)）+单次广播（每连接恰一条）', async () => {
    const h = await startContractServer({});
    try {
      const a = new RawSyncClient(h.url, 'project:c4b');
      const b = new RawSyncClient(h.url, 'project:c4b');
      h.track(a); h.track(b);
      await Promise.all([a.firstAcked(), b.firstAcked()]);
      await sleep(100);
      const stA = a.syncStatusTrue, stB = b.syncStatusTrue;

      // 同字节帧双连接同 tick 连发（均不本地 apply——纯注入；先到者真 apply、后到者幂等 no-op）
      const src = new Y.Doc();
      src.getMap('nodes').set('n5', 'v5');
      const u = Y.encodeStateAsUpdate(src);
      a.sendRawUpdate(u);
      b.sendRawUpdate(u);
      await pollUntil(() => a.syncStatusTrue >= stA + 1 && b.syncStatusTrue >= stB + 1);
      await sleep(150);

      expect(h.counters.docUpdates.gate).toBe(1);        // 恰一 update 事件（首帧真 apply、次帧 no-op——序无关同果）
      expect(h.counters.wal).toHaveLength(1);            // 一个 walSeq（受理台账恰一条）
      expect(h.counters.walDuplicates).toBe(1);
      expect(a.syncStatusTrue).toBe(stA + 1);            // 双 ACK：各自连接恰一 SyncStatus(true)
      expect(b.syncStatusTrue).toBe(stB + 1);
      expect(a.updateMessages).toHaveLength(1);          // 单次广播：每连接恰一条（第二帧无 update 事件→零追加广播）
      expect(b.updateMessages).toHaveLength(1);
      expect(h.liveDoc('project:c4b')?.getMap('nodes').get('n5')).toBe('v5');
      // 「两 ACK 均在 fsync 后」=T9 actor in-flight promise map 语义（fsync=actor 管线）——库侧前提
      //（单 apply/单广播/双 ACK）由本测试锁定；actor 侧补=SHA-256 去重+walSeq 单发+fsync 后 resolve。
    } finally { await h.dispose(); }
  }, 20_000);

  it('⑤ readOnly 短路：VIEWER 发 Update→beforeSync 已被调用（库检查在 beforeSync 后）+库短路=零 apply+SyncStatus(false)+doc 不变+零广播；VIEWER 带新内容 SS2 连接→SyncStatus(false)+doc 不变', async () => {
    const h = await startContractServer({ readOnlyTokens: new Set(['viewer-token']) });
    try {
      const v = new RawSyncClient(h.url, 'project:c5', 'viewer-token');
      const e = new RawSyncClient(h.url, 'project:c5', 's1-token');   // 同 doc 编辑者（广播观察者）
      h.track(v); h.track(e);
      await Promise.all([v.firstAcked(), e.firstAcked()]);
      await sleep(100);
      const bsUpdate0 = h.counters.hooks.beforeSync.update;

      const src = new Y.Doc();
      src.getMap('nodes').set('v5', 'x');
      v.sendRawUpdate(Y.encodeStateAsUpdate(src));   // VIEWER 发合法 Update 帧
      await pollUntil(() => v.syncStatusFalse >= 1);
      expect(v.syncStatusFalse).toBe(1);                 // 库 readOnly 短路 ACK=false（esm:284-286）
      expect(v.syncStatusTrue).toBeLessThanOrEqual(1);   // 无新增 true（连接期空 SS2 的 1 次外零）
      expect(h.counters.hooks.beforeSync.update).toBe(bsUpdate0 + 1);   // beforeSync 已被调用——库 readOnly 检查在其后（esm:251 vs 284）
      expect(h.counters.docUpdates.gate + h.counters.docUpdates.connection).toBe(0);   // 零 apply（gate 侧短路+库侧短路）
      expect(h.counters.wal).toHaveLength(0);            // 零 WAL 帧
      await sleep(150);
      expect(e.updateMessages).toHaveLength(0);          // 零广播
      expect(h.liveDoc('project:c5')?.getMap('nodes').get('v5')).toBeUndefined();   // doc 不变

      // SS2 面：VIEWER 带新内容连接（seed 后握手——SS2 携带服务端缺失内容）→SyncStatus(false)+doc 不变
      const v2 = new RawSyncClient(h.url, 'project:c5', 'viewer-token', (d) => d.getMap('nodes').set('novel', 'y'));
      h.track(v2);
      await pollUntil(() => v2.syncStatusFalse >= 1);
      expect(v2.syncStatusFalse).toBeGreaterThanOrEqual(1);   // readOnly SS2 分支（esm:265-275）
      expect(h.liveDoc('project:c5')?.getMap('nodes').get('novel')).toBeUndefined();   // doc 不变（零 apply）
    } finally { await h.dispose(); }
  }, 20_000);

  it('⑤′ SS1 零 WAL 帧+SS2/Update 双路径：空客户端全握手零入账（空 SS2=noop 档）；带内容客户端经 SS2 路径入账（update:gate+广播达他端）；已同步连接经 Update 路径入账', async () => {
    const h = await startContractServer({});
    try {
      const a = new RawSyncClient(h.url, 'project:c5b');
      h.track(a);
      await a.firstAcked();
      await sleep(100);

      // SS1 零 WAL：空客户端全握手（SS1/SV 往返+空 SS2）后受理台账恒空
      expect(h.counters.hooks.beforeSync.ss1).toBeGreaterThanOrEqual(1);   // SS1 帧确实到达 gate（零判放行）
      expect(h.counters.wal).toHaveLength(0);                              // 零 WAL 帧
      expect(h.counters.walNoops).toBe(1);                                 // 空 SS2=无新内容幂等 no-op（不入账不计数重复）
      expect(h.counters.docUpdates.gate).toBe(0);

      // SS2 路径：带内容客户端连接（seed→握手 SS2 携带内容）→gate 预 apply 入账+广播达 a
      const bs0 = h.counters.hooks.beforeSync.ss2;
      const b = new RawSyncClient(h.url, 'project:c5b', 's1-token', (d) => d.getMap('nodes').set('ss2n', 'v'));
      h.track(b);
      await pollUntil(() => b.syncStatusTrue >= 1);
      await pollUntil(() => a.updateMessages.length >= 1);
      expect(h.counters.hooks.beforeSync.ss2).toBe(bs0 + 1);   // SS2 帧经 gate
      expect(h.counters.docUpdates.gate).toBe(1);              // SS2 路径 apply 恰一
      expect(h.counters.wal).toHaveLength(1);                  // SS2 路径入账
      expect(h.counters.wal[0].kind).toBe('ss2');
      expect(h.liveDoc('project:c5b')?.getMap('nodes').get('ss2n')).toBe('v');

      // Update 路径：已同步连接的增量帧入账
      const bu0 = h.counters.hooks.beforeSync.update;
      a.transactWrite((d) => d.getMap('nodes').set('updn', 'v'));
      await pollUntil(() => h.counters.wal.length >= 2);
      expect(h.counters.hooks.beforeSync.update).toBe(bu0 + 1);   // Update 帧经 gate
      expect(h.counters.wal).toHaveLength(2);
      expect(h.counters.wal[1].kind).toBe('update');
      expect(h.liveDoc('project:c5b')?.getMap('nodes').get('updn')).toBe('v');
    } finally { await h.dispose(); }
  }, 20_000);

  it('⑥ awareness 路径不受影响（真 provider 双端）：A setAwarenessField→B 收到+onAwarenessUpdate 触发+beforeSync/doc update/WAL/onStoreDocument 全零增量', async () => {
    const h = await startContractServer({});
    try {
      const A = connectProvider(h.url, 'project:c6');
      const B = connectProvider(h.url, 'project:c6');
      h.track({ destroy: () => A.provider.destroy() });
      h.track({ destroy: () => B.provider.destroy() });
      await Promise.all([A.synced, B.synced]);
      await sleep(100);
      const bs = h.counters.hooks.beforeSync.ss1 + h.counters.hooks.beforeSync.ss2 + h.counters.hooks.beforeSync.update;
      const du = h.counters.docUpdates.gate + h.counters.docUpdates.connection + h.counters.docUpdates.load + h.counters.docUpdates.local;

      A.provider.setAwarenessField('user', { name: 'a' });
      const aClient = A.doc.clientID;
      await pollUntil(() => {
        const st = B.provider.awareness?.getStates().get(aClient);
        return (st as { user?: { name?: string } } | undefined)?.user?.name === 'a';
      });
      expect(h.counters.hooks.onAwarenessUpdate).toBeGreaterThanOrEqual(1);   // 服务端 awareness 钩子触发（esm:1518-1529）
      expect(h.counters.hooks.beforeHandleAwareness).toBeGreaterThanOrEqual(1);   // beforeHandleAwareness 钩子触发（esm:206——awareness 入站必经）
      const bsAfter = h.counters.hooks.beforeSync.ss1 + h.counters.hooks.beforeSync.ss2 + h.counters.hooks.beforeSync.update;
      expect(bsAfter).toBe(bs);   // awareness 不经 sync gate
      const duAfter = h.counters.docUpdates.gate + h.counters.docUpdates.connection + h.counters.docUpdates.load + h.counters.docUpdates.local;
      expect(duAfter).toBe(du);   // 零 doc update
      expect(h.counters.wal).toHaveLength(0);   // 零 WAL 帧
      await sleep(200);   // 防抖窗+裕量
      expect(h.counters.hooks.onStoreDocument).toBe(0);   // awareness 不触发 store 链
    } finally { await h.dispose(); }
  }, 20_000);

  it('⑦ onLoadDocument 产 update 但零 WAL 帧：装载内容经库回调 applyUpdate（load 档恰一）→客户端收到；onChange/onStoreDocument 零调用（装载期 handleDocumentUpdate 未接线）；顺序锁 update:load 先于首个 beforeSync', async () => {
    const loadSrc = new Y.Doc();
    loadSrc.getMap('nodes').set('loaded', 'v7');
    const h = await startContractServer({ loadDocs: new Map([['project:c7', loadSrc]]) });
    try {
      const a = new RawSyncClient(h.url, 'project:c7');
      h.track(a);
      await a.firstAcked();
      await sleep(100);

      expect(h.counters.hooks.onLoadDocument).toBe(1);
      expect(h.counters.docUpdates.load).toBe(1);        // 装载产 update（origin=null→load 档——库回调缺省 origin）
      expect(a.doc.getMap('nodes').get('loaded')).toBe('v7');   // 装载内容达客户端（SS2 内容面/装载广播任一路径）
      // 装载期零钩子面：onChange/onStoreDocument 零调用（handleDocumentUpdate 装载后才接线 esm:1487——
      // 库结构性保证：装载 update 不触发 store 链=「零 WAL 帧」的库侧对应事实）
      expect(h.counters.hooks.onChange.gate + h.counters.hooks.onChange.connection + h.counters.hooks.onChange.load + h.counters.hooks.onChange.local).toBe(0);
      expect(h.counters.hooks.onStoreDocument).toBe(0);
      expect(h.counters.wal).toHaveLength(0);            // 零 WAL 帧（装载不经 sync 帧/gate）
      await sleep(200);   // 防抖窗+裕量——store 链仍零
      expect(h.counters.hooks.onStoreDocument).toBe(0);
      // 顺序锁：装载先于任何 sync 帧处理（setUpNewConnection：createDocument 先于队列重放 esm:830-874）
      const firstBeforeSync = h.counters.log.findIndex((s) => s.startsWith('beforeSync:'));
      expect(h.counters.log.indexOf('update:load')).toBeGreaterThanOrEqual(0);
      expect(h.counters.log.indexOf('update:load')).toBeLessThan(firstBeforeSync);
    } finally { await h.dispose(); }
  }, 20_000);

  it('⑦′ server-direct（openDirectConnection）写=local 档：onChange:local+防抖 store 触发（skipStoreHooks 缺省 false）+gate/WAL 零——census ⑧ 运行时对照面', async () => {
    const h = await startContractServer({});
    try {
      const direct = await h.server.hocuspocus.openDirectConnection('project:c7d');
      await direct.transact((d) => { d.getMap('nodes').set('d1', 'direct'); });
      expect(h.counters.docUpdates.local).toBe(1);       // DirectConnection.transact origin={source:'local'}（esm:1138-1143）
      expect(h.counters.hooks.onChange.local).toBe(1);   // onChange 恒发（esm:1413——skip 判定之前）
      expect(h.counters.hooks.beforeSync.ss1 + h.counters.hooks.beforeSync.ss2 + h.counters.hooks.beforeSync.update).toBe(0);   // 不经 sync 帧
      expect(h.counters.wal).toHaveLength(0);            // 零 WAL 帧（gate 面缺席）
      await pollUntil(() => h.counters.hooks.onStoreDocument >= 1);   // local 档写触发防抖 store（esm:60-67 skipStoreHooks 缺省 false）
      expect(h.liveDoc('project:c7d')?.getMap('nodes').get('d1')).toBe('direct');
      await direct.disconnect();
      await sleep(50);   // disconnect→storeDocumentHooks(immediately)+unload 链落定（dispose 前静置）
    } finally { await h.dispose(); }
  }, 20_000);

  // ===== ⑨ T9 翻转点（所有权切换验收） =====
  // T0 真值：库对 connection-origin update **不跳过** store 钩子（shouldSkipStoreHooks esm:60-67：
  // 'connection'→false）→ gate 预 apply（origin={source:'connection',...,gate:true}——不走 local 逃生舱）
  // 触发库防抖 store=T9 必须拆生产 onStoreDocument 链（telemetry-only）的根因。
  // T9 翻 true 时本用例断「零调用」——翻转完整前置（F-3 推论）：库对**任何** {source:'connection'}
  // origin 都会调防抖 store 钩子，本 harness 的 onStoreDocument 计数器只要还注册就恒 ≥1；零调用在
  // T9 成立须同步 harness 改造：(i) 摘除 store 钩子注册（断言退化为结构性沉默——弱形态）或
  // (ii) 计数器改接旧链探针（onStoreDocument→storeDocumentUnlocked('debounce') 生产链 spy——零调用
  // =旧链确已拆，强形态推荐）。翻转≠只改常量（计数面改造随 T9 所有权切换切片同卡——doc §5.2）。
  const T9_OWNERSHIP_SWITCHED = false;

  it('⑨ onStoreDocument×connection-origin：库基线=突发三帧防抖恰一次+顺序锁（onChange 先于 store）+skipStoreHooks 逃生舱实证（local+true=零 store、onChange 照发）——T9 翻转点已标记', async () => {
    const h = await startContractServer({});
    try {
      const a = new RawSyncClient(h.url, 'project:c9');
      h.track(a);
      await a.firstAcked();
      await sleep(100);

      // 突发三帧（同一防抖窗内）
      a.transactWrite((d) => d.getMap('nodes').set('b1', 1));
      a.transactWrite((d) => d.getMap('nodes').set('b2', 2));
      a.transactWrite((d) => d.getMap('nodes').set('b3', 3));
      // origin 无关落定判据（gate 档计数）——翻转态 onStoreDocument 恒 0 不可作判据（防 5s 假超时红）
      await pollUntil(() => h.counters.docUpdates.gate >= 3);
      expect(h.counters.wal).toHaveLength(3);            // 三帧均受理入账
      expect(h.counters.docUpdates.gate).toBe(3);        // gate 档恰三（翻转无关不变量）
      if (T9_OWNERSHIP_SWITCHED) {
        await sleep(300);   // 有界观测窗——防抖窗（50/75ms）×裕量后再断零
        expect(h.counters.hooks.onStoreDocument).toBe(0);   // T9：旧链 telemetry-only——connection 档零调用（前置见上注：计数器须改接旧链探针/摘注册）
      } else {
        await pollUntil(() => h.counters.hooks.onStoreDocument >= 1);   // TODAY 判据——仅未翻转分支（翻转态恒 0 会 5s 假超时）
        await sleep(200);   // 结算窗——防抖合并后无第二发
        expect(h.counters.hooks.onStoreDocument).toBe(1);   // TODAY：防抖恰一次（三帧合并单 store）
        expect(h.counters.hooks.afterStoreDocument).toBe(1);
        // 顺序锁：全部 onChange 落定先于 store（update 事件同步面 vs 防抖 50ms）——onStoreDocument
        // 在场才可比（翻转态 indexOf=-1 恒真=伪断言）——故置未翻转分支内
        expect(h.counters.log.lastIndexOf('onChange:gate')).toBeGreaterThanOrEqual(0);
        expect(h.counters.log.lastIndexOf('onChange:gate')).toBeLessThan(h.counters.log.indexOf('onStoreDocument'));
      }

      // 机制面（T9 设计依据）：local 档+skipStoreHooks:true=零 store（库逃生舱 esm:65-66）——onChange 照发
      const store0 = h.counters.hooks.onStoreDocument;
      const serverDoc = h.liveDoc('project:c9')!;
      serverDoc.transact(() => { serverDoc.getMap('nodes').set('skip', 1); }, { source: 'local', skipStoreHooks: true });
      await sleep(200);
      expect(h.counters.hooks.onChange.local).toBe(1);   // onChange 恒发（skip 判定前——esm:1413-1414）
      expect(h.counters.hooks.onStoreDocument).toBe(store0);   // 零 store（逃生舱实证）
      // 注：T9 gate 预 apply origin={source:'connection'}——connection 档恒不跳过（esm:63）→逃生舱不可用，
      //所有权切换唯一路径=拆生产 onStoreDocument→storeDocumentUnlocked('debounce') 链（gateway:340）。
    } finally { await h.dispose(); }
  }, 20_000);
});
