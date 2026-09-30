import Redis, { type RedisOptions } from 'ioredis';

/** 批3-2 B6：统一 Redis 工厂 token（沿用仓内 'REDIS_CLIENT' 字符串 token 惯例——
 *  auth/media/video-work/recharge/sms/subscription/execution/app 原即此串，仅收敛工厂形态） */
export const REDIS_CLIENT = 'REDIS_CLIENT';

export type ManagedRedis = Redis & { onApplicationShutdown(): void };

/** 批3-2 B6：受管 Redis 工厂。Nest 对 factory 产物 duck-typing 调用生命周期钩子
 *  （@nestjs/core hooks/on-app-shutdown.hook.js：hasOnAppShutdownHook = isFunction(instance.
 *  onApplicationShutdown)，遍历 provider 实例）——裸 new Redis 不收口则 ioredis 保活
 *  event loop，collab shutdown 8s race 超时后进程退不出 → pm2 SIGKILL → stash 丢。
 *  env 兜底串保证不裸 new Redis(undefined)（video-work C2 Task 1.3 注释同源）。 */
export function createManagedRedis(url?: string, options?: RedisOptions): ManagedRedis {
  const resolvedUrl = url ?? process.env.REDIS_URL ?? 'redis://localhost:6379/0';
  const client = options ? new Redis(resolvedUrl, options) : new Redis(resolvedUrl);
  return Object.assign(client, {
    onApplicationShutdown() { client.disconnect(); },
  });
}
