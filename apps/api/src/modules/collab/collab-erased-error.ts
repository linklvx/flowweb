// TD-33/C1b T13：项目擦除终态错误识别单源（四形状）。消费=persistence 退避梯/收割面终态短路
// （终态族不排梯不 confirm 不进熔断）；Y2 契约重构时归 CollabTerminalWriteRejection union。
import { CollabCloseCode, PROJECT_ERASED_TERMINAL_REASON } from '@flowweb/shared';
import { SpoolProjectBlockedError } from './collab-spool.service';
import { ProjectErasingError } from './project-lock';

export function isProjectErasedError(e: unknown): boolean {
  if (e instanceof SpoolProjectBlockedError) return true;          // spool 写拒绝（ERASING/ERASED 两 state）
  if (e instanceof ProjectErasingError) return true;               // PG fence 终态族（actor 既有消费面）
  const x = e as { code?: unknown; reason?: unknown } | null | undefined;
  if (x?.code === CollabCloseCode.PROJECT_ERASED) return true;     // FrameRejectError 4414（生产 sink 路径）
  return x?.reason === PROJECT_ERASED_TERMINAL_REASON;             // 关闭原因形态（跨进程/序列化面）
}
