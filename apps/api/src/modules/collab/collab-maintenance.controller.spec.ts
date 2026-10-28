// apps/api/src/modules/collab/collab-maintenance.controller.spec.ts
// Y1c T27 收尾微批 M-c（quality）：FAILED_RESUME_REQUIRED REST 映射 404→409（conflict——post-SWITCHING
// FAILED 在档=项目维护态冲突需 resume roll-forward，非「项目不存在」；消费面=运维重试判定）。控制器域
// 单测（maintenance 服务边界桩——映射表行为面；服务全链归 t27 int 套件）。
import { describe, it, expect } from 'vitest';
import { CollabMaintenanceController } from './collab-maintenance.controller';
import type { CollabMaintenanceService } from './collab-maintenance.service';

function buildController(requestResult: unknown): CollabMaintenanceController {
  const stub = {
    request: async () => requestResult,
    run: async () => ({ result: 'completed', generation: 1 }),
    operationOf: async () => null,
    abort: async () => ({ ok: true }),
    resume: async () => ({ ok: true }),
  };
  return new CollabMaintenanceController(stub as unknown as CollabMaintenanceService);
}

const REQ = { headers: { 'x-idempotency-key': 'k-12345678' }, user: { id: 'u1' } } as never;

describe('Y1c T27 收尾 M-c：start 拒绝码 REST 映射（FAILED_RESUME_REQUIRED 409）', () => {
  it('红：post-SWITCHING FAILED 再 start → 409 Conflict+code 透传（修前=404 误报「项目不存在」——resume 指引被吞）', async () => {
    const controller = buildController({ ok: false, code: 'FAILED_RESUME_REQUIRED', maintenanceId: 'mt-x' });
    await expect(controller.start('p1', REQ)).rejects.toMatchObject({
      status: 409,
      response: { code: 'FAILED_RESUME_REQUIRED', maintenanceId: 'mt-x' },
    });
  });

  it('负控：PROJECT_NOT_FOUND 维持 404；MAINTENANCE_ACTIVE/IN_FLIGHT_EXECUTIONS 维持 409（映射表不回归）', async () => {
    await expect(buildController({ ok: false, code: 'PROJECT_NOT_FOUND' }).start('p1', REQ)).rejects.toMatchObject({ status: 404 });
    await expect(buildController({ ok: false, code: 'MAINTENANCE_ACTIVE', maintenanceId: 'mt-a' }).start('p1', REQ)).rejects.toMatchObject({ status: 409 });
    await expect(buildController({ ok: false, code: 'IN_FLIGHT_EXECUTIONS' }).start('p1', REQ)).rejects.toMatchObject({ status: 409 });
  });
});
