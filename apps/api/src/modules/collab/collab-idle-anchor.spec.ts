// apps/api/src/modules/collab/collab-idle-anchor.spec.ts
// Y0b-3 T10：空闲保活证伪性验证锚（plan v3.1 钉死——只读锚，零生产代码改动，今日即绿）。
// 价值=用行为级证据钉死"本仓不需要应用层保活（ping/pong/stateless 心跳）"，防未来回潮。
//
// ===== P-T 四环+第五环实证（本仓 node_modules 实测行号——防回潮的机制依据，勿删）=====
// ① y-protocols `dist/awareness.cjs`（outdatedTimeout=30000，:39）：`setInterval(..., floor(outdatedTimeout/10))`
//    =**3s tick**（:85）+ `:87` 15s 门限（outdatedTimeout/2）触发 `:89 setLocalState(getLocalState())` 续期——
//    机制=3s 轮询+15s 门限（净效果 ~15s 一帧）；`setLocalState`（:127-161）**clock 无条件 +1（:130）且
//    无条件 emit 'update'（:160）**（equalityDeep 过滤只在 'change' :158——续期帧必发非"可能发"）；
//    Awareness 构造器尾 `:107 setLocalState({})` 使 `getLocalState()!==null` 恒成立（远端清场删不掉
//    本地态——applyAwarenessUpdate "never let a remote client remove local state" 分支）。
//    ⚠ **P-T 成立前提=本地态非 null（构造器 :107 播种保证+本仓 runtime apps/web/src/collab/awareness.ts
//    replayLocalUser 显式播种冗余）——禁引入 `setLocalState(null)` 清场调用**（会使续期分支永 false=
//    静默废掉保活）。
// ② provider `dist/hocuspocus-provider.esm.js` `:776-780`：续期帧 origin='local'（字符串）≠provider 实例
//    ⇒ `if (origin === this) return` 不命中 ⇒ 发送。**第五环**：handler 挂 **'update'** 事件
//    （`:686 on("update", boundAwarenessUpdateHandler)` 注册面/`:905 off("update")` 对称实证）——若挂
//    'change' 则续期帧被 equalityDeep 过滤=P-T 全塌，实际挂 'update' ⇒ 必发。
// ③ server `dist/hocuspocus-server.esm.js` `:671-673`：`broadcastAwarenessUpdate` 无 origin 过滤 ⇒
//    回显发送者（solo 单连接也收）。
// ④ provider `:305-307`：`onMessage` 首行 `lastMessageReceived = getUnixTime()`——每入站帧（含回显）刷新
//    ⇒ 客户端 30s messageReconnectTimeout（`:138` 默认 3e4/`:185` 3s checker/超时 `:349` code 4408）恒满足。
// ⇒ **空闲连接每 ~15s 有双向 awareness 帧**，两侧 lastMessage 计时器恒被刷新——spec §5.2"空闲零应用层
//    消息⇒30-60s 判死四害"前提在本仓不成立（前提勘误=plan §0.4 偏离 11，spec 侧 T11 统一回填）。
//
// ===== Step 0 探针三发现（2026-10-11 真连实测——本锚装置形态据此裁定）=====
// 1. **前提精化：本地态须为非空对象，仅"非 null"不够。** bare 连接（本地态=构造器种子 `{}`）的续期帧
//    空 state 撞 gateway guardAwareness scratch 幽灵判据（collab.gateway.ts:1717 首 见∧空态∧doc
//    awareness 无此 id ⇒ 剔除不广播）⇒ 零回显 ⇒ 客户端计时器断粮 ⇒ 45s 内实测重连 1 次
//    （closes=[1005]，socket 构造计数 2）——④环"回显刷新客户端计时器"对空态帧被服务端 guard 截断。
//    生产对型=runtime cursor 写入面（CanvasView setAwarenessField('cursor')，帧必非空）⇒ 本锚连接后
//    播种 cursor 一次（镜像 runtime 形态——plan"装置形态探针后定"授权）。
// 2. **server 端无自续期腿：** server Document 构造器（server esm:508）`new Awareness(this)` 后紧跟
//    `this.awareness.setLocalState(null)` ⇒ 服务端 doc awareness 恒 null 态 ⇒ y-protocols 自续期分支
//    永 false ⇒ 服务端从不自发 awareness 帧（空载保活帧全部由客户端续期驱动）。此为库自身设计
//    （server 无 presence 态），与客户端侧"禁 setLocalState(null)"禁令不冲突。
// 3. **lastMessageReceivedAt 字段可达性：** 服务端帧时刻字段在 **ClientConnection**（ws 级，esm:822/
//    :953），不在 document.connections 的 Connection 实例（文档级 Connection 类无此字段，亦无注册表
//    可达 ClientConnection——crossws peer._hocuspocus 私有挂载）⇒ 服务端帧时刻证据改用
//    `doc.awareness.meta.get(clientID).lastUpdated`（每次入站 awareness 帧过 guard 后 apply 时刷新——
//    plan Step 0 预告的旁证源；apply 发生=入站帧真实到达且通过改写）。
//
// **后台标签**：pageHide 删本地态（provider esm:733-735 removeAwarenessStates([document.clientID])——
// awareness `:75 clientID=doc.clientID` 命中生效）⇒ 续期停 ⇒ 30s 判死 ⇒ 回前台重连=**正常预期非缺陷**。
// **P14 向量随 onStateless 不注册归零**（库默认 `onStateless: () => null` 不抛——provider esm:641）；
// T1 unhandledRejection 兜底独立保留。`forceSyncInterval` 零配置（续期帧即保活+补传兜底已有
// forceSyncAndWaitUnsynced 按需）。
import { describe, it, expect, afterEach } from 'vitest';
import { startDualClientServer, type DualClientKit } from '../../test-utils/dual-client-server';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let kit: DualClientKit;
afterEach(async () => {
  await kit.dispose();
});

/** 装置形态（Step 0 探针后定）：solo 连接+静置。cursor 播种=P-T 前提的 runtime 镜像（发现 1——
 *  本地态非空对象）；captureEpoch=socket 构造计数（重连检测——provider 无 sessionEpoch 字段，装置层
 *  ws 构造计数为 plan 授权替代：重连路径必经 createWebSocketConnection `new WebSocketPolyfill(url)`）；
 *  serverLastMessageAt=服务端 doc.awareness.meta.lastUpdated（发现 3——ClientConnection 字段不可达）。
 *  Y0b-4 T6 追加 VIEWER 臂：readOnly 剔字段（cursor/selection 剥离+条目不删）下回显保活链不破——
 *  同一次 90s 等待内观测（plan T6"回归锚并入同一次等待——追加断言非新 describe"）。 */
async function connectIdle(docName: string): Promise<{
  captureEpoch: () => number;
  serverLastMessageAt: (name: string) => number;
  viewerEpoch: () => number;
  viewerServerState: () => Record<string, any>;
  soloServerState: () => Record<string, any>;
}> {
  kit = await startDualClientServer({}, 300);
  let sockets = 0;
  const { provider, synced } = kit.connect(docName, 'tok', { onSocket: () => { sockets += 1; } });
  await synced;
  provider.setAwarenessField('cursor', { x: 0, y: 0 });   // 非空本地态（空态=回显断链面——头注发现 1）
  const clientId = (provider.awareness as any).clientID as number;
  // Y0b-4 T6：VIEWER 单连臂（独立 doc——solo 语义），cursor 播种同款（剔字段治理的保活回归锚）
  kit.permSvc.resolveWithTeam.mockResolvedValue({ role: 'PROJECT_VIEWER', teamId: 't1' });
  let viewerSockets = 0;
  const viewer = kit.connect('project:idle-viewer', 'tok', { onSocket: () => { viewerSockets += 1; } });
  await viewer.synced;
  kit.permSvc.resolveWithTeam.mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' });
  viewer.provider.setAwarenessField('cursor', { x: 1, y: 1 });   // readOnly 连接的 cursor 帧=剥离对象（guardAwareness 顶部剔字段）
  const viewerClientId = (viewer.provider.awareness as any).clientID as number;
  return {
    captureEpoch: () => sockets,
    serverLastMessageAt: (name: string): number => {
      const doc = kit.gateway.server.hocuspocus.documents.get(name) as any;
      const meta = doc.awareness.meta.get(clientId) as { lastUpdated: number };
      if (!meta) throw new Error(`server doc awareness 未登记 ${clientId}——客户端帧从未过 guard`);
      return meta.lastUpdated;
    },
    viewerEpoch: () => viewerSockets,
    viewerServerState: (): Record<string, any> => {
      const doc = kit.gateway.server.hocuspocus.documents.get('project:idle-viewer') as any;
      return doc.awareness.states.get(viewerClientId) ?? null;
    },
    // Y0b-4 T13：solo 单连臂状态读取（主 doc——单人剥离后 user/presence 仍在断言）
    soloServerState: (): Record<string, any> => {
      const doc = kit.gateway.server.hocuspocus.documents.get(docName) as any;
      return doc.awareness.states.get(clientId) ?? null;
    },
  };
}

describe('Y0b-3 T10 空闲保活证伪性锚（P-T 四环+第五环行为级证据——头注=防回潮机制依据）', () => {
  it('【证伪性锚】空闲 90s：零应用层保活配置下连接存活——无 4408 close/无重连（socket 构造计数不变）/doc 常驻（无新物化）+服务端 awareness 帧时刻 15s 尺度被刷新（awareness 自续期双向帧——P-T 四环的行为级证据）；Y0b-4 T6 VIEWER 臂：readOnly 剔字段后 90s 无 4408+服务端 user/presence 仍在（剥离回显保活链不破）', async () => {
    // 前台/可见标签语义下断言（后台标签 pageHide 清场触发一次重连=正常预期——头注第 1 条禁令背景）
    const { captureEpoch, serverLastMessageAt, viewerEpoch, viewerServerState, soloServerState } = await connectIdle('project:idle');
    const epoch0 = captureEpoch();
    const viewerEpoch0 = viewerEpoch();
    await sleep(90_000); // 真实等待（真连装置——禁 fake timers）；90s 覆盖 spec §5.2 死亡区间 30-60s 全谱
    expect(captureEpoch()).toBe(epoch0);                       // 未重连（无 4408/无新 socket——重连即构造计数+1）
    expect(serverLastMessageAt('project:idle')).toBeGreaterThan(Date.now() - 20_000); // ≤20s 内服务端应用过入站 awareness 帧（~15s 续期节律）
    expect(kit.gateway.server.hocuspocus.documents.has('project:idle')).toBe(true);   // 常驻无重装载
    // Y0b-4 T13：solo 臂（单人画布 distinct=1——主 doc 唯一连接）：剥离后 user/presence 仍在
    //（成员表/身份注入面不受剔字段影响——plan"单人剥离后 user/presence 仍在"并入同一等待）
    const sState = soloServerState();
    expect(sState?.user?.id).toBe('u1');
    expect(sState && 'cursor' in sState).toBe(false);          // cursor 已剥离（solo 档——服务端零 cursor 广播）
    // Y0b-4 T6：VIEWER 单连 90s 无 4408（socket 构造计数不变=重连检测——剥字段若误删条目则回显断链→30-45s 判死重连，T10 探针同款形态）
    expect(viewerEpoch()).toBe(viewerEpoch0);
    const vState = viewerServerState();
    expect(vState?.user?.id).toBe('u1');                       // 剥离后 user/presence 仍在（身份注入面不受剔字段影响）
    expect(vState && 'cursor' in vState).toBe(false);          // cursor 已剥离（readOnly 帧——服务端零 cursor 广播）
  }, 120_000); // 显式 timeout 必须——vitest 默认 5s 必挂（90s 真实等待是设计要求，45s 压缩已被 v3.1 驳回）
});
