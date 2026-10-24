// apps/api/src/modules/collab/collab-server.factory.ts
// Y0c T42（B3 手段①）：Server 构造 options 块单源工厂——自 collab.gateway 构造器机械提取
// （canvas-doc.factory 同址先例；options 逐字平移含全部文档锚注释——collab-gateway.options.spec
// 「直构 gateway 读回 server.configuration」消费面零触碰，库构造 spread 保留全部传入键语义不变）。
// resolveCollabDebounce 随构造参数迁本文件（COLLAB_DEBOUNCE/NODE_ENV 解析单点——gateway 再导出块
// 保既有 import 面：collab.module.ts useFactory/env.spec 消费方零触碰，B1 COMPACT_INTERVAL_MS 同款先例）。
// census 同批（Z24）：㉒ env 裸读表 gateway 条目拆分（COLLAB_PORT/TIMEOUT/BIND_ADDR×1/DEBOUNCE/
// NODE_ENV → 本文件条目；BIND_ADDR×1 留 gateway=listenCollab 日志）+⑮ worker 闭包
// hocuspocus-server-import 换宿主（gateway 2→1 〔Server 并入 type-only 行〕/本文件 n=1 登记）。
import { Server } from '@hocuspocus/server';
import type { CollabGateway } from './collab.gateway';   // type-only 零运行时边（FreezeReason/W3a 同款先例——hooks 签名面类型单源）
import { WS_MAX_PAYLOAD_BYTES } from './collab-limits';   // R4b'：maxPayload 值单源（B16）

/** 批3-4：COLLAB_DEBOUNCE 接线——显式注入（测试缝）> env > dev 1000 / prod 2000（原硬编码 5000
 *  收紧——连续编辑丢失窗口 prod ≤3s 闭环）；maxDebounce 写死 ≤ debounce×1.5（独立配置则窗口仍为旧值）。 */
export function resolveCollabDebounce(explicit?: number): number {
  if (explicit && explicit > 0) return explicit;
  const fromEnv = Number(process.env.COLLAB_DEBOUNCE);
  if (fromEnv > 0) return fromEnv;
  return process.env.NODE_ENV === 'development' ? 1000 : 2000;
}

/** Server 构造单源（B3 手段①）：入参=gateway 构造器注入三值原样直通+hooks 只读签名面
 *  （this.hooks 构造完成后传入——接线序不变：hooks 赋值先于 Server 构造）。options 键集/值/
 *  注释逐字保持（库选项 pin 断言面=options.spec 三组，读回形态零变化）。 */
export function createCollabServer(opts: {
  port: number | undefined;
  debounce: number | undefined;
  timeout: number | undefined;
  hooks: CollabGateway['hooks'];
}): Server {
  const { port, debounce, timeout, hooks } = opts;
  const debounceMs = resolveCollabDebounce(debounce);
  return new Server({
    port: port ?? (Number(process.env.COLLAB_PORT) || 3001),
    debounce: debounceMs,
    maxDebounce: Math.ceil(debounceMs * 1.5),
    // 批3-4 COLLAB_TIMEOUT：双语义——同一值既驱动握手/空闲超时，也驱动 ClientConnection 的
    // 检查周期（库构造 setInterval(check, timeout)）——注入小值测 60s 死线时两者一起变小
    timeout: timeout ?? (Number(process.env.COLLAB_TIMEOUT) || 30_000),
    // 批3-2：库默认 stopOnSignals:true 在 listen() 注册信号 handler → destroy 后 process.exit(0)
    // 抢跑 Nest drain 链（hocuspocus-server.esm.js:1684-1690）——信号统一交 app.enableShutdownHooks()
    stopOnSignals: false,
    // Y0a-4/P25 + Y0b-3 T2：绑定面默认收口 127.0.0.1（对外暴露必须显式 COLLAB_BIND_ADDR——
    // ecosystem:27 已注入同值，翻转对部署零差异；本地 dev 直连 localhost 不受影响）。
    // 键随读者：COLLAB_BIND_ADDR 同批进 config/env.ts（T1 结构锚方向二防死键）。
    address: process.env.COLLAB_BIND_ADDR ?? '127.0.0.1',
    // Y0a-4/P24 显式 pin 双旋钮 Server 级（B20/B26：库 defaultConfiguration 即 true/false——
    // 文档锚防升级翻转，非行为修复）。Z82a（Y0c T21）：残存价值=护无会话 doc 的关页立即
    // store（常驻路径「关页即 flush」已结构性失效，但无会话 doc 仍走库谓词卸载链）——
    // 禁以「谓词已拦」为由关掉；断言锚=options.spec T21 组
    unloadImmediately: true,
    quiet: false,
    connected: hooks.connected,   // Y0b-3 T6：寿命台账播种钩子接线
    onAuthenticate: hooks.onAuthenticate,
    onLoadDocument: hooks.onLoadDocument,
    onStoreDocument: hooks.onStoreDocument,   // Y1c T9（偏离 38①）：telemetry-only 探针（旧 store 链已拆——connection 帧恒触发库防抖钩子 S1-F-3，保留 store 调用=双写；帧持久化归 actor）
    afterStoreDocument: hooks.afterStoreDocument,   // Y0a-2 V22：最小对账钩子接线（构造 Server 配置同步——同 T3 onStoreDocument 直通位置）
    beforeHandleAwareness: hooks.beforeHandleAwareness,   // Y0b-3 T7：awareness states 三分支覆写钩子接线（scratch Map 改写=重编码广播——esm:197-207）
    beforeHandleMessage: hooks.beforeHandleMessage,   // Y0b-4 T6：msg 桶+awareness 帧闸钩子接线（ClientConnection.processMessages 每帧必经）
    beforeSync: hooks.beforeSync,   // Y0b-4 T4：beforeSync 配额判据钩子接线（type=y-protocols 内层常量 0/1/2——非库 MessageType）
    onStateless: hooks.onStateless,   // Y1c T10（偏离 37⑦+38⑳）：save barrier 接线——{nonce,clientSeq} wire 载体（返回值被库丢弃 esm:219-224——回执=显式 connection.sendStateless）
    onDisconnect: hooks.onDisconnect,
    beforeUnloadDocument: hooks.beforeUnloadDocument,   // Y0a-2 Task 7：卸载清理钩子接线（v4.6.0 Server 配置）
    afterUnloadDocument: hooks.afterUnloadDocument,   // Y0b-4 T3 外审修复（I-1）：真卸载终态清理钩子接线（v4.6.0 Server 配置）
    onUpgrade: hooks.onUpgrade,   // Y0b-3 T2：Origin 403+升级限流钩子接线（hook resolve 后库才 crossws.handleUpgrade）
    // Y0a-3 T5/T6：跨实例扩展挂载删除（多实例权威=PG 租约 fence——单写者由租约保证，跨实例
    // 消息同步退役；其固定断开延迟借道语义随之消失，service 本体已删）。
    // Y0b-3 T1：库选项四 pin——文档锚防升级回落（断言在 collab-gateway.options.spec）。
    websocketOptions: { maxPayload: WS_MAX_PAYLOAD_BYTES }, // §7.2 禁回落 ws 默认 100MiB；键集 ⊆ {maxPayload}（T1 断言）
    // R4b'：flush 族显式 pin（B7——顶层键；库默认值 0/1MiB 原值，pin 语义非改值——顶层断言
    // 在 options.spec；maxPayload 值单源=collab-limits WS_MAX_PAYLOAD_BYTES）
    flushDelay: 0,
    flushMaxBytes: 1_048_576,
    maxUnauthenticatedQueueMessages: 256, // §3.1bis 4 pre-auth 三 pin（库默认 1e3）
    maxUnauthenticatedQueueSize: 1024 * 1024, // 库默认 5MiB
    maxPendingDocuments: 100, // 库默认即同值——显式 pin 防升级翻转（P24 先例）
    // Y0b-4 T8（spec §4.1④/裁定 21）：gc pin——瘦身语义前提（gc:false=删除不收壳=Yjs 删除后
    // 编码字节不回落=瘦身静默失效）。库默认即 true——显式声明防升级翻转（P24 文档锚先例）。
    yDocOptions: { gc: true, gcFilter: () => true },
  });
}
