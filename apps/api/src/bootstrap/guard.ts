// apps/api/src/bootstrap/guard.ts
// Y0b-3 T1（P14）：进程级 unhandledRejection 全局兜底——计数不退出。
// 函数化实证：main.ts 直 import 即 listen——bootstrap 副作用不可测，必须函数化供 guard.spec 直调。
// Y0b-5 T11：①补 uncaughtException handler（原缺——Node 默认崩溃，计数+capture 同哲学不退出）；
// ②除计数外加 Sentry capture（SENTRY_DSN 未设/未 init 时 SDK 侧 no-op）；③安装提前到
// NestFactory.create 之前（main.ts bootstrap 首行——preloadDbConfig/引号窗全程覆盖，原 :99 装
// 在 create :77 之后=引导期窗口裸奔）。
import * as Sentry from '@sentry/nestjs';
import { collabUnhandledRejectionTotal } from '../modules/collab/store.metrics';

export function installProcessErrorGuards(): void {
  process.on('unhandledRejection', (reason: unknown) => {
    try {
      collabUnhandledRejectionTotal.inc({ source: 'process' });
      Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
      console.error(`[unhandledRejection] 兜底计数（进程不退出）: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
    } catch { /* 兜底自身禁抛 */ }
  });
  process.on('uncaughtException', (err: Error) => {
    try {
      collabUnhandledRejectionTotal.inc({ source: 'uncaught' });
      Sentry.captureException(err);
      console.error(`[uncaughtException] 兜底计数（进程不退出）: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    } catch { /* 兜底自身禁抛 */ }
  });
}
