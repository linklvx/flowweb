/** Y0b-5 T0（spec §5.6 冻结契约 11）：遥测白名单 ≤12 + detail 受控键域——无 PII=无自由文本
 *  （受控枚举/数值不是 PII）；禁 projectId/docName/query/hash。E40 经 ws_status.detail.reason='unsynced-lag' 携带。 */
import { CollabCloseCode } from './collab-close-code';
import { COLLAB_AUTH_REASONS } from './collab-auth-reason';

export const COLLAB_TELEMETRY_EVENT_TYPES = [
  'ws_status', 'recover_triggered', 'watchdog_fire', 'hydration_fail',
  'auth_reject', 'write_reject', 'invariant_violation', 'sync_pending_retry', 'conn_scope',
  'close_code', 'unsynced_close', 'projection_duration',
] as const;
export type CollabTelemetryEventType = (typeof COLLAB_TELEMETRY_EVENT_TYPES)[number];

/** Y0b-5 T0（裁定 25⑴）：QuotaRejectReason 上移 shared 单源（客户端产出与服务端 sanitize 同类型）
 *  ——apps/web canvasIntents.ts 改 re-export，使用面零变动。 */
export const QUOTA_REJECT_REASONS = ['key-too-large', 'tx-too-large', 'too-many-nodes', 'doc-over-budget'] as const;
export type QuotaRejectReason = (typeof QUOTA_REJECT_REASONS)[number];

export type CollabTelemetryEvent = { type: CollabTelemetryEventType; at: number; n?: number; ms?: number;
  code?: number | 'other'; reason?: string };
export const MAX_TELEMETRY_EVENTS_PER_BATCH = 12;
export const MAX_TELEMETRY_EVENT_BYTES = 512;
export const isKnownTelemetryType = (t: string): t is CollabTelemetryEventType =>
  (COLLAB_TELEMETRY_EVENT_TYPES as readonly string[]).includes(t);

/** detail 键规格三列（裁定 25⑵：允许键∪值域∪ sink）：sink=metric:<name>{label}｜log-only 逐键必填
 *  （无 sink 的允许键=过 sanitize 仍被指标层丢弃——T1 指标消费面四族：close/auth/ws_reason/projection）。 */
export interface TelemetryDetailKeySpec {
  readonly sink: string;
  /** 受控字符串值域——越界折 'other'（防 label 基数）；undefined=非枚举键（数值/布尔） */
  readonly values?: readonly string[];
  /** 受控数值值域（close_code.code——CollabCloseCode 值域）——越界折 'other' */
  readonly numericValues?: readonly number[];
  /** 数值类型守卫（metric 数值键 projection_duration.ms——非 number 剥键，T1 直方图 observe 防炸） */
  readonly numeric?: boolean;
  /** 值域校验放行 null（conn_scope.scope——authenticated 载荷 scope 缺失折 null，runtime:955） */
  readonly nullable?: boolean;
}

const CLOSE_CODE_VALUES: readonly number[] = Object.values(CollabCloseCode);

/** 裁定 24⑹/25⑵ 逐 type detail schema 表——detail 键域唯一来源（四键白名单常量已删——禁第二真源）。
 *  允许键 ⊇ 仓内既有 recordCollabDiag 调用点实测形状（grep 全调用点派生，禁凭记忆——census 锚起始必须绿）：
 *  ws_status{from,to}（runtime:946）∪ reason（'unsynced-lag'/'local-cache-degraded'——E40/T8 受控值，T2 接线）/
 *  recover_triggered{level}（runtime:197）/watchdog_fire{executed}（runtime:1200）∪ reason('stalled')（裁定 24⑩）/
 *  hydration_fail{}（runtime:1234 无 detail）/auth_reject{reason,terminal}（runtime:1012——reason∈CollabAuthReason）/
 *  write_reject{reason,via}（awareness:111 'selection-too-large'+runtime:1002 'quota-soft'+canvasIntents:327
 *  +canvasStore:1900/:2892+canvasUndo:100——值域=QuotaRejectReason∪{selection-too-large,quota-soft}
 *  ∪Y1c T15 容器规则四值{container-missing,container-type-mismatch,value-form-mismatch,data-map-missing}
 *  （via='text-domain'——canvasIntents Y.Text 域写 seam）；msg-rate-exceeded/doc-over-quota 系服务端
 *  词表客户端零产生〔裁定 25⑴〕）/
 *  invariant_violation{where}（runtime:1267 'applyRemote'——值域含 T2 'applyBootstrap'/'react-boundary'）/
 *  sync_pending_retry{n}（executionApi:43 现无 detail）/conn_scope{scope|null}（runtime:955——scope∈
 *  {read-write,readonly}，库 L23 authenticated 载荷）/close_code{code}（T2 接线）/
 *  projection_duration{ms}/unsynced_close{n}（T2 接线）。表外键一律剥除。 */
export const TELEMETRY_DETAIL_SCHEMA: Readonly<Record<CollabTelemetryEventType, Readonly<Record<string, TelemetryDetailKeySpec>>>> = {
  ws_status: {
    // from/to 值域=runtime:134 库 status 机三值闭集（T0 审查 I-1：sink 是 metric label——无 values 域则任意串穿 sanitize 直达 label）
    from: { sink: 'metric:collab_telemetry_ws_transition_total{from,to}', values: ['connecting', 'connected', 'disconnected'] },
    to: { sink: 'metric:collab_telemetry_ws_transition_total{from,to}', values: ['connecting', 'connected', 'disconnected'] },
    reason: { sink: 'metric:collab_telemetry_ws_reason_total{reason}', values: ['unsynced-lag', 'local-cache-degraded', 'local-cache-preserved-foreign-dirty'] },
    // Y0b-5 T2（控制器裁决——裁定 24 SLO 通道）：hydration/reconnect 时长经 ws_status detail 扩键上送
    // （仅随迁移事件携带：hydration={from:'connecting',to:'connected'}=initCollab→ready /
    //  reconnect={from:'disconnected',to:'connected'}=掉线→authenticated——12 值封闭不新增 type）。
    ms: { sink: 'metric:collab_telemetry_hydration_ms|collab_telemetry_reconnect_ms', numeric: true },
    // Y0b-5 T8（E33 指定的 E26 重建触发源）：本地 doc 编码字节随批量上送——服务端
    // collab_telemetry_client_doc_bytes 直方图消费（记录点=最近一次快照尺寸，零新增 encode）。
    docBytes: { sink: 'metric:collab_telemetry_client_doc_bytes', numeric: true },
  },
  recover_triggered: {
    level: { sink: 'log-only', values: ['terminal', 'transient'] },
  },
  watchdog_fire: {
    executed: { sink: 'log-only' },
    reason: { sink: 'log-only', values: ['stalled'] },
  },
  hydration_fail: {},
  auth_reject: {
    reason: { sink: 'metric:collab_telemetry_auth_reject_total{reason}', values: COLLAB_AUTH_REASONS },
    terminal: { sink: 'log-only' },
  },
  write_reject: {
    reason: { sink: 'log-only', values: [...QUOTA_REJECT_REASONS, 'selection-too-large', 'quota-soft',
      // Y1c T15 容器规则拒写（text-domains 拒绝词表——canvasIntents 写 seam 唯一产生面）
      'container-missing', 'container-type-mismatch', 'value-form-mismatch', 'data-map-missing',
      // Y1c T16：XmlFragment 域拒写（编辑器直绑容器——整串写=容器替换对抗面 G17b）
      'xml-fragment-domain-editor-bound', 'xml-container-missing'] },
    via: { sink: 'log-only', values: ['dispatch-fallback', 'redo-precheck', 'canEditCommand', 'text-domain',
      // Y1c T16 增两 via（xml 域 seam 拒/容器解析结构错误面）
      'xml-domain', 'prompt-input'] },   // T17 只读门 via（T18 顺修：T17 落地漏 schema 登记——census ⑬ 红根因）；Y1c T15 增 text-domain（Y.Text 域 seam 拒）
    command: { sink: 'log-only' },   // T17 七命令名（EditableCommandName 7 值域归 web 单源，log-only 无 label 基数面不枚举〔name/frame 先例〕）
  },
  invariant_violation: {
    where: { sink: 'log-only', values: ['applyRemote', 'applyBootstrap', 'react-boundary'] },
    // Y0b-5 T2 ErrorBoundary 受控栈键（log-only——无 label 基数面）：name=error.name /
    // frame=error.stack 首帧 file:line（仅此字符串无整栈——受控枚举纪律，Y5 前可诊断非只知崩了）
    name: { sink: 'log-only' },
    frame: { sink: 'log-only' },
  },
  sync_pending_retry: {
    n: { sink: 'log-only' },
  },
  conn_scope: {
    scope: { sink: 'log-only', values: ['read-write', 'readonly'], nullable: true },
  },
  close_code: {
    code: { sink: 'metric:collab_telemetry_close_total{code}', numericValues: CLOSE_CODE_VALUES },
  },
  unsynced_close: {
    n: { sink: 'log-only' },
  },
  projection_duration: {
    ms: { sink: 'metric:collab_telemetry_projection_ms', numeric: true },
  },
};

/** detail 受控 sanitize（服务端 T1 执行——客户端无感，键域漂移靠 census 锚守）：
 *  表外键剥除；枚举键越界折 'other'；数值守卫键非 number 剥键；其余（executed/terminal/n）原样保留。 */
export function sanitizeTelemetryDetail(
  type: CollabTelemetryEventType,
  detail: Record<string, unknown> = {},
): Record<string, unknown> {
  const schema = TELEMETRY_DETAIL_SCHEMA[type];
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    const spec = schema[key];
    if (!spec) continue; // 表外键一律剥除（projectId/docName/query/hash 等自由键）
    if (spec.numericValues) {
      out[key] = typeof value === 'number' && spec.numericValues.includes(value) ? value : 'other';
    } else if (spec.values) {
      if (typeof value === 'string' && spec.values.includes(value)) out[key] = value;
      else if (value === null && spec.nullable) out[key] = value;
      else out[key] = 'other';
    } else {
      if (spec.numeric && typeof value !== 'number') continue; // 非 number 剥键（与表外键同语义——T1 直方图 observe 防炸）
      out[key] = value;
    }
  }
  return out;
}
