/** Y0b-4 T1：画布配额常量+doc-status/conn-status 快照类型（shared 契约地基）。
 * QUOTA_DEFAULTS 七值锁定——T4/T5 服务端执法消费；softEnter/softExit 双阈值滞回（0.8 进 0.6 出：
 * bytes/limit ≥0.8 冻结写、回落的 <0.6 才解冻——防阈值附近抖动反复冻结/解冻）。
 * 类型将被 T5 服务端产生/T10 客户端消费——四处键集逐字一致纪律（字段一致矩阵：键名漂移=执行卡死）。 */

/** 配额默认值（单一事实来源——服务端禁止散落字面量；调整只动此处） */
export const QUOTA_DEFAULTS = {
  maxDocBytes: 8_388_608,       // 8MB——doc 编码全量上限
  maxTxBytes: 262_144,          // 256KB——单笔 update 上限
  maxKeyBytes: 262_144,         // 256KB——单 key 上限
  maxNodesPerTx: 2000,          // 单笔 update 节点数上限
  softEnterRatio: 0.8,          // 滞回进入（冻结写）
  softExitRatio: 0.6,           // 滞回退出（解冻写）
  awarenessLimitBytes: 4096,    // 4KB——awareness 单帧上限
} as const;

/** Y0b-5 T8（裁定 24⑧）：SS2 帧包装余量——SS2 帧闸=maxDocBytes+本值（离线合并回灌合法帧≠DoS：
 * 本地持有 ≥8MB 服务端没有的内容经合并必然超配额=超限落 4404 doc-over-quota 非 1009）。
 * bytes 速率桶容量同式同步（token-bucket cost>capacity 结构性恒 false——只抬闸不同步桶=(闸,闸+本值]
 * 帧被 ⓪′ 恒拒→1008→重连重发无限循环=裁定 24⑵）。shared 落点=web E36 不可达性断言（回放帧
 * byteLength<服务端闸）与服务端闸三方同源，禁第二字面量。 */
export const FRAME_ALLOWANCE_BYTES = 64 * 1024;

/** rev=per-doc 单调计数器，装载播种 1——初值 0 会被客户端 rev<=last 守卫丢掉首快照
 * =limit 来源恒丢（报告2 F）；T5 装载时以此起步递增。 */
export const DOC_STATUS_REV_SEED = 1 as const;

/** doc-status 快照（per-doc 广播）：顶层 generation 可选（vacuum 代际——Q-U v6：T5 产生/T9a 递增/
 * T11 消费四处对齐）；quota.residueBytes 可选第六键（T11「重建画布历史」入口数据源）；
 * 顶层 connectionId 可选（Y0b-5 T11：onAuthenticate 生成的 WS 连接标识——per-conn 推送面带上
 * 回传客户端，遥测 join 通道；per-doc 广播面缺省）。
 * 无 readOnly/无 deletedIds（Q-A v4：per-conn 量走 conn-status 每连接推送形态——字段集合断言防复活）。 */
export interface CollabDocStatusPayload {
  type: 'doc-status';
  rev: number;
  writeFrozen: boolean;
  generation?: number;
  connectionId?: string;
  quota: {
    state: 'over' | 'ok';
    bytes: number;
    limit: number;
    maxTxBytes: number;
    softLimitBytes: number;
    residueBytes?: number;
  };
}

/** conn-status（每连接推送——Q-A v4）：readOnly 与 doc-status 分离（per-conn 量不进 per-doc 广播）。 */
export interface CollabConnStatusPayload {
  type: 'conn-status';
  readOnly: boolean;
}

/** doc-status 逐字段校验（unknown→boolean：quota 五键必选缺一即 false；顶层 generation/quota.residueBytes
 * 可选缺省=valid、带错型=拒）。"额外字段不破坏"是通用校验哲学——本函数只验必选集合（v6 报告3 P0-2A）。 */
export function isCollabDocStatusPayload(msg: unknown): msg is CollabDocStatusPayload {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  if (m.type !== 'doc-status') return false;
  if (typeof m.rev !== 'number' || !Number.isFinite(m.rev)) return false;
  if (typeof m.writeFrozen !== 'boolean') return false;
  if (m.generation !== undefined && (typeof m.generation !== 'number' || !Number.isFinite(m.generation))) return false;
  if (m.connectionId !== undefined && typeof m.connectionId !== 'string') return false;
  if (typeof m.quota !== 'object' || m.quota === null) return false;
  const q = m.quota as Record<string, unknown>;
  if (q.state !== 'over' && q.state !== 'ok') return false;
  if (typeof q.bytes !== 'number' || !Number.isFinite(q.bytes)) return false;
  if (typeof q.limit !== 'number' || !Number.isFinite(q.limit)) return false;
  if (typeof q.maxTxBytes !== 'number' || !Number.isFinite(q.maxTxBytes)) return false;
  if (typeof q.softLimitBytes !== 'number' || !Number.isFinite(q.softLimitBytes)) return false;
  if (q.residueBytes !== undefined && (typeof q.residueBytes !== 'number' || !Number.isFinite(q.residueBytes))) return false;
  return true;
}

/** conn-status 逐字段校验（T5 消费——type 分型与 doc-status 互斥）。 */
export function isCollabConnStatusPayload(msg: unknown): msg is CollabConnStatusPayload {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return m.type === 'conn-status' && typeof m.readOnly === 'boolean';
}
