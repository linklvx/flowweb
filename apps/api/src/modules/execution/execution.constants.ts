export const EXECUTION_QUEUE_NAME = 'execution';
export const EXECUTION_CONNECTION_NAME = 'default';

/** Y1a T9：同 job 重排续跑延迟（processor skip→moveToDelayed 的 grace 窗）——短于心跳新鲜判据
 *  （EXEC_SAME_JOB_ALIVE_MS），重排后重进 claim 三态：旧 worker 仍活→再让位/已死（心跳超窗）→takeover。
 *  重排轮次上界 ≈ deadlineMsForKind(kind)/本值（每轮一次三态收敛机会；默认档：text=90s/30s≈3 轮、
 *  image/edit=300s/30s≈10 轮、video=900s/30s≈30 轮、lighting=1800s/30s≈60 轮——轮数有限不空转，
 *  deadline 到点由 reaper 收敛兜底）。 */
export const EXEC_SAME_JOB_RETRY_DELAY_MS = 30_000;
