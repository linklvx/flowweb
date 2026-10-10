// apps/api/src/bootstrap/guard.ts
// Y0b-3 T1（P14）：进程级 unhandledRejection 全局兜底——计数不退出。
// 函数化实证：main.ts 直 import 即 listen——bootstrap 副作用不可测，必须函数化供 guard.spec 直调。
import { collabUnhandledRejectionTotal } from '../modules/collab/store.metrics';

export function installUnhandledRejectionGuard(): void {
  process.on('unhandledRejection', (reason: unknown) => {
    try {
      collabUnhandledRejectionTotal.inc({ source: 'process' });
      console.error(`[unhandledRejection] 兜底计数（进程不退出）: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
    } catch { /* 兜底自身禁抛 */ }
  });
}
