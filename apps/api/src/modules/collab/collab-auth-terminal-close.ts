// apps/api/src/modules/collab/collab-auth-terminal-close.ts
// Y1c T24（W3b 域随 SG 拆出——C4-b 行数锚 1405 收口）：auth 期 terminal close 投递器。
// 库行为（hocuspocus 4.6.0 esm:938-942）：onAuthenticate throw → writePermissionDenied 消息+簿记
// 清理，**socket 保持打开**——客户端无从得知终态=重试无限循环撞同一硬门。码权威投递=P7 先例
// （webSocket.close 形态）——auth 期 Connection 未建（esm:1054 new 在 hook 后），经升级 socket
// 反查原始 socket 直写 RFC6455 close 帧（0x88+2B code BE+reason UTF-8≤123B；server→client 帧
// 不掩码）后 end。throw 照旧（库簿记清理面保持）；close 已先行抵达。
//
// 反查双轨（T30b P-2 实弹发现）：同对象（直构测试/同引用形态）→sec-websocket-key（live 路径
// NodeReqProxy 身份断链形态——hocuspocus 4.6.0/crossws 0.4.4 实测 onUpgrade 收裸 IncomingMessage
// 而 onAuthenticate 收 NodeReqProxy〔StubRequest 包装，不留 raw 引用〕⇒ WeakMap request 键控恒
// miss=close 帧静默不投递）。项带时戳：插入时清扫 >60s 陈旧项（握手→认证窗秒级；有界防泄漏）。
// 命中即删（单次投递语义）。C4-b 消费面：4406 版本门×2+**4414 PROJECT_ERASED（WS fast-path 拒帧）
// +(NORMAL,'team disbanded') 团队终态**（session-guard authenticateInner）。
import { collabWsCloseTotal } from './store.metrics';

/** 升级 socket 台账（WeakMap request 键控——随连接消亡；registerUpgradeSocket 登记面）。 */
const upgradeSockets = new WeakMap<object, unknown>();

/** live 路径 request 身份断链台账：sec-websocket-key 键控+时戳（T30b P-2）。 */
const upgradeSocketsByKey = new Map<string, { socket: { write?: (b: Buffer) => void; end?: () => void }; at: number }>();
const UPGRADE_KEY_TTL_MS = 60_000;

/** request 头读取双形态（裸 req=plain object / NodeReqProxy=Headers 实例）。 */
function headerOf(req: unknown, name: string): string | null {
  const h = (req as { headers?: unknown } | null)?.headers;
  if (h == null) return null;
  if (typeof (h as Headers).get === 'function') return (h as Headers).get(name);
  const v = (h as Record<string, unknown>)[name];
  return typeof v === 'string' ? v : null;
}

/** handleUpgrade 登记（request+wsKey 双轨——session-guard.handleUpgrade 调用；原 SG 私有台账迁出）。 */
export function registerUpgradeSocket(request: unknown, socket: unknown): void {
  upgradeSockets.set(request as object, socket);
  const wsKey = headerOf(request, 'sec-websocket-key');
  if (wsKey) {
    const now = Date.now();
    for (const [k, v] of upgradeSocketsByKey) if (now - v.at > UPGRADE_KEY_TTL_MS) upgradeSocketsByKey.delete(k);
    upgradeSocketsByKey.set(wsKey, { socket: socket as never, at: now });
  }
}

/** terminal close 投递（反查双轨→RFC6455 close 帧直写→end+close 分布计数；未登记=throw 面兜底）。 */
export function closeUpgradeTerminal(request: unknown, code: number, reason: string): void {
  let socket = (request != null ? upgradeSockets.get(request as object) : undefined) as
    | { write?: (b: Buffer) => void; end?: () => void }
    | undefined;
  if (socket == null) {
    const wsKey = headerOf(request, 'sec-websocket-key');
    if (wsKey != null) {
      const hit = upgradeSocketsByKey.get(wsKey);
      if (hit) { socket = hit.socket; upgradeSocketsByKey.delete(wsKey); }   // 命中即删（单次投递）
    }
  }
  if (socket == null) return;   // 未登记（直构测试/非升级路径）——denyAuth throw 面兜底
  try {
    const reasonBuf = Buffer.from(reason, 'utf8').subarray(0, 123);
    const payload = Buffer.alloc(2 + reasonBuf.byteLength);
    payload.writeUInt16BE(code, 0);
    reasonBuf.copy(payload, 2);
    const closeFrame = Buffer.alloc(2 + payload.byteLength);
    closeFrame[0] = 0x88;   // FIN+opcode 8（Connection Close）
    closeFrame[1] = payload.byteLength;
    payload.copy(closeFrame, 2);
    socket.write?.(closeFrame);
    socket.end?.();
    collabWsCloseTotal.inc({ code: String(code), reason });
  } catch { /* 已断 */ }
}
