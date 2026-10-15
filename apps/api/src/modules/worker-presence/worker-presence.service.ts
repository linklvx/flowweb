// apps/api/src/modules/worker-presence/worker-presence.service.ts
// Y0c T29-II（Z130/Z148②）：付费三队列 worker 存活探测——「侦测→动作」闭环的动作半载体。
// 两读面：getPresence（缓存数据——/api/ready workers 维度消费）+assertAdmittable（enqueue
// fail-closed 门——无消费者 ⇒ 503 WORKER_ABSENT+计数）。
//
// 裁决①现状如实记录（非假声明）：api 进程现自装全部 processor 消费面（processor 注册门缺位——
// BullExplorer 无条件 new Worker，门必须与 ecosystem 双进程编排同 commit，归 T30 前置缺口）。
// 因此**当前单进程拓扑下 registered 恒 ≥1、fail-closed 不可实际触发**；本服务产物的语义在两种
// 拓扑下均真实——「registered≥1=存在消费者」，T30 补门后自动成为 worker 专属信号（本文件零改动）。
//
// 裁决②（偏离 39）：bullmq 5.75.1 getWorkers()=CLIENT LIST 形态（运行时实测返回完整 client 条目
// {id,addr,name,age,idle,flags,cmd,rawname}，d.ts 声明 {name,concurrency}[]——以运行时为准但只取
// length），该版本无 lastSeen 数据源（worker 注册=连接命名 SETNAME，无 bull:<queue>:workers hash）。
// **registered 即活性信号**：进程死 ⇒ TCP 断 ⇒ CLIENT LIST 立即除名（秒级），无需 lastSeen 陈旧度。
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../config/queue.constants';
import { collabWorkerAbsentTotal } from './worker-presence.metrics';

/** 付费三队列（Z130① 字面 execution/ai-image-edit/ai-download——名单单源 QUEUE_NAMES）。 */
export const PAID_QUEUE_NAMES = [
  QUEUE_NAMES.EXECUTION,
  QUEUE_NAMES.AI_IMAGE_EDIT,
  QUEUE_NAMES.AI_DOWNLOAD,
] as const;
export type PaidQueueName = (typeof PAID_QUEUE_NAMES)[number];

/** 维度两键（裁决②/偏离 39——无 lastSeen 数据源，registered 即活性信号）。 */
export interface WorkerPresence {
  registered: number;
  waiting: number;
}

/** 探测缓存 TTL=5s（Z148② 硬约束：getWorkers/getWaitingCount 是 Redis 异步调用，付费路径禁加
 *  RTT——5-10s 窗取内值；陈旧上界 5s 对「worker 整进程死亡」面可接受〔秒级除名+缓存窗=最坏 5s
 *  内漏拒，enqueue 后作业留队待 worker 恢复即被消费，非资损面〕）。 */
export const PRESENCE_CACHE_TTL_MS = 5_000;

@Injectable()
export class WorkerPresenceService {
  private readonly queues: Record<PaidQueueName, Queue>;
  private readonly cache = new Map<PaidQueueName, { at: number; v: WorkerPresence }>();

  constructor(
    @InjectQueue(QUEUE_NAMES.EXECUTION) executionQueue: Queue,
    @InjectQueue(QUEUE_NAMES.AI_IMAGE_EDIT) imageEditQueue: Queue,
    @InjectQueue(QUEUE_NAMES.AI_DOWNLOAD) downloadQueue: Queue,
  ) {
    this.queues = {
      [QUEUE_NAMES.EXECUTION]: executionQueue,
      [QUEUE_NAMES.AI_IMAGE_EDIT]: imageEditQueue,
      [QUEUE_NAMES.AI_DOWNLOAD]: downloadQueue,
    };
  }

  /** 读面①：队列 presence（5s TTL 缓存）。返回 null=unknown（探测失败——调用侧降级语义各自定：
   *  ready 维度值 null 透传/assertAdmittable 放行）。失败不写缓存——下轮重探（Redis 恢复即自愈；
   *  失败窗内每次调用重探属预期：enqueue 自身紧接着也会失败暴露真因，探测风暴不成立）。 */
  async getPresence(queue: PaidQueueName): Promise<WorkerPresence | null> {
    const hit = this.cache.get(queue);
    if (hit && Date.now() - hit.at < PRESENCE_CACHE_TTL_MS) return hit.v;
    try {
      const q = this.queues[queue];
      const [workers, waiting] = await Promise.all([q.getWorkers(), q.getWaitingCount()]);
      const v: WorkerPresence = { registered: workers.length, waiting };
      this.cache.set(queue, { at: Date.now(), v });
      return v;
    } catch {
      return null;   // 探测失败（Redis 错）⇒ unknown——不做双重失败（注释见 assertAdmittable）
    }
  }

  /** 读面②：enqueue 准入门（Z148②——用户准入点专用；内部 best-effort enqueue 豁免见偏离 38）。
   *  registered=0 ⇒ inc collab_worker_absent_total{queue}+503 WORKER_ABSENT（Retry-After: 30 由
   *  CollabNotServingFilter 附——F11 同源：宁可明确告知不可服务也不收注定退款的作业）。
   *  unknown（null）⇒ 放行：enqueue 自身会失败暴露真因（Redis 真断时 add 必抛），不做双重失败。 */
  async assertAdmittable(queue: PaidQueueName): Promise<void> {
    const p = await this.getPresence(queue);
    if (p === null) return;
    if (p.registered === 0) {
      collabWorkerAbsentTotal.inc({ queue });
      throw new ServiceUnavailableException({
        code: 'WORKER_ABSENT',
        message: `队列 ${queue} 当前无 worker 消费，请稍后重试`,
      });
    }
  }
}
