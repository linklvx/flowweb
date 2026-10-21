export const EXECUTION_QUEUE_NAME = 'execution';
export const EXECUTION_CONNECTION_NAME = 'default';

/** Y1a T9：同 job 重排续跑延迟（processor skip→moveToDelayed 的 grace 窗）——短于心跳新鲜判据
 *  （EXEC_SAME_JOB_ALIVE_MS），重排后重进 claim 三态：旧 worker 仍活→再让位/已死（心跳超窗）→takeover。 */
export const EXEC_SAME_JOB_RETRY_DELAY_MS = 30_000;
