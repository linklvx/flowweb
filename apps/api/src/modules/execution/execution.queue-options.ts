/** 批0c：付费任务队列禁自动重试（全局 defaultJobOptions attempts:3 继承链下 processor 内扣费后抛错
 *  会自动重试再扣——重复扣费今天就在发生）。语义：部署杀在飞任务的恢复出口=用户显式重跑（意图表幂等保证只扣一次）。 */
export const EXECUTION_JOB_OPTIONS = { attempts: 1 } as const;
