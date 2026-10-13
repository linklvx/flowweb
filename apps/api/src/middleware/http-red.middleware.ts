// apps/api/src/middleware/http-red.middleware.ts —— Y0b-5 T13 HTTP RED
// 计时（performance.now→duration_seconds）+在飞 gauge inc/finally 语义 dec+path 归一（route 标签防基数）。
// WS 帧不进 HTTP RED：本中间件只挂主 app express request 链——collab 独立端口服务（hocuspocus 自管
// http server）结构性不经此；socket.io WS 帧非 HTTP 请求。connectionId=T11 独立观测，两者不相干。
import type { NextFunction, Request, Response } from 'express';
import { httpRequestDurationSeconds, httpRequestsInFlight } from './http-red.metrics';

/** prisma cuid 主键路径段（c+≥16 位 base36）。 */
const CUID_RE = /^c[0-9a-z]{16,}$/;
/** uuid 路径段兜底（本仓 schema 全 cuid——形态预留防未来引入）。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** path→route 归一：plan 明示 /\d+→:id；评估补充——本仓 @Param 路径段全为 prisma cuid（非 uuid/[0-9a-f-]{36}），
 *  cuid 每实体唯一⇒不归一则 label 基数随实体数线性爆炸（同 uuid 等价问题），故 cuid/uuid/长数字嵌入段
 *  （task-<毫秒戳>）同归一为 :id；静态段保留。 */
export function normalizeRoute(path: string): string {
  return path
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      if (/^\d+$/.test(seg)) return ':id';                      // 纯数字段（plan 明示）
      if (/\d{10,}/.test(seg)) return ':id';                    // 长数字嵌入段（task-<毫秒戳>）
      if (CUID_RE.test(seg) || UUID_RE.test(seg)) return ':id'; // cuid 主键/uuid 兜底
      return seg;
    })
    .join('/');
}

export function httpRedMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = performance.now();
  httpRequestsInFlight.inc();
  // finish（正常完成）与 close（客户端 abort）双事件去重——inc/dec 严格配对（双 dec 即负值 gauge）
  let done = false;
  const record = (status: number) => {
    if (done) return;
    done = true;
    httpRequestsInFlight.dec();
    httpRequestDurationSeconds.observe(
      { method: req.method, route: normalizeRoute(req.path), status: String(status) },
      (performance.now() - start) / 1000,
    );
  };
  res.on('finish', () => record(res.statusCode));
  // close-only（finish 未先发）＝客户端 abort——statusCode 停留默认 200 计为成功即失真，记 499（nginx 惯例）；
  // 正常路径 finish 先记后 close 被 done 短路——499 不生效。
  res.on('close', () => record(499));
  next();
}
