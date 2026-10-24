// Y1c T7 Controller 裁定 3：MaintenanceStage Prisma 枚举值集合与 T5b 冻结
// MAINTENANCE_STAGES（packages/shared/src/collab/maintenance.ts）setEqual 防漂移锚——
// Prisma enum 无法 import shared 常量，用测试锚定单源（漂移=红，禁手改一侧）。
import { describe, it, expect } from 'vitest';
import { MaintenanceStage as PrismaMaintenanceStage } from '@prisma/client';
import { MAINTENANCE_STAGES, MAINTENANCE_MAIN_STAGES, MAINTENANCE_TERMINAL_STAGES } from '@flowweb/shared';

describe('Y1c T7 载体契约锚：MaintenanceStage Prisma enum ≡ shared 冻结常量', () => {
  it('值集合 setEqual（11 值=9 主段+2 终态——逐字对照）', () => {
    const prismaValues = Object.values(PrismaMaintenanceStage);
    const frozen = [...MAINTENANCE_STAGES];
    expect(new Set(prismaValues)).toEqual(new Set(frozen));
    expect(prismaValues).toHaveLength(11);
  });

  it('主段次序冻结（REQUESTED→…→COMPLETED——SWITCHING=唯一不可回退点的前置序）', () => {
    expect([...MAINTENANCE_MAIN_STAGES]).toEqual([
      'REQUESTED', 'FREEZING', 'DRAINING', 'DRAINED', 'EXPORTING', 'REBUILDING',
      'SWITCHING', 'VERIFYING', 'COMPLETED',
    ]);
    expect([...MAINTENANCE_TERMINAL_STAGES]).toEqual(['FAILED', 'ABORTED']);
  });
});
