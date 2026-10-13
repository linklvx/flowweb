import { Gauge, Histogram, register } from 'prom-client';

/** Y0b-5 T13：HTTP RED（全站 HTTP 面）独立单文件——spec §10 metric-names 块同 commit 同步
 *  （check-spec-consistency glob *.metrics.ts 双向核——middleware 内联定义=静默逃逸禁）。
 *  WS 帧不进本族：只计量 HTTP（express request 链）——collab 独立端口服务（hocuspocus 自管）
 *  不经主 app（connectionId=T11 独立观测）。 */

/** route 经 normalizeRoute 归一（数字段/cuid/uuid→:id 防基数爆炸）。 */
export const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Y0b-5 T13：HTTP 请求时长（秒）——route 归一防基数（method/route/status）',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.3, 1, 3, 10, 30, 60, 300, 1800],
  registers: [register],
});

/** 在飞请求数（inc 入口 / dec finish∧close 去重——严格配对防悬挂）。 */
export const httpRequestsInFlight = new Gauge({
  name: 'http_requests_in_flight',
  help: 'Y0b-5 T13：HTTP 在飞请求数（inc/dec 配对——finish/close 去重兜底）',
  registers: [register],
});
