import { NonRetryableError } from './video-separate.types';

/**
 * 媒体处理任务通用重试策略（BullMQ retryStrategy）。
 *
 * - NonRetryableError（业务错误：无音频轨 / 文件损坏 / 编码不支持）：
 *   throw → retryStrategy 返回 -1 → BullMQ 直接标记 Job 为 failed，不重试。
 *
 * - 普通 Error（基础设施错误：MinIO 超时 / 下载失败 / FFmpeg 僵死）：
 *   throw → retryStrategy 返回指数退避延迟 → BullMQ 最多重试至 attempts=3。
 *
 * - 正常完成：
 *   return result → BullMQ 标记 Job 为 completed。
 *
 * 此方案完全由 BullMQ 框架管理 Job 状态，无手动 moveToFailed 导致的状态冲突风险。
 *
 * 注意：attempts 参数为 BullMQ 传入的「当前已尝试次数」（含初始执行）。
 * 配合 defaultJobOptions.attempts: 3，实际行为：1 次初始 + 最多 2 次重试 = 总计 3 次。
 */
export const defaultMediaRetryStrategy = (attempts: number, error: Error): number => {
  if (error instanceof NonRetryableError) return -1;
  if (attempts >= 3) return -1;
  return 2000 * Math.pow(2, attempts - 1);
};
