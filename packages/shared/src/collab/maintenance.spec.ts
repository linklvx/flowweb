// packages/shared/src/collab/maintenance.spec.ts
// Y1c T5b（plan v1.7 Task 5 业务 DDL 段；spec v5.4 §6.6——T10-lite）：维护窗口契约冻结的契约测试——
// MAINTENANCE_STAGES 11 值（9 主段+2 终态）精确冻结、转移表全对角线真值表（手写期望矩阵双向冻结：
// forward 单步✓/跳步✗/回退✗/FAILED 自任意非终态✓/ABORTED 仅 SWITCHING 前✓/终态无出边）、
// 行级关闸（REQUESTED 同事务写 CanvasDoc.maintenanceId+受理读 IS NULL）、in-flight 范围五面、
// SWITCHING 事务后 close 4410。本文件=T27（维护执行）+T12（vacuum 委托）的消费契约锁。
import { describe, expect, it } from 'vitest';
import {
  canTransitionMaintenanceStage, MAINTENANCE_IN_FLIGHT_SCOPE, MAINTENANCE_MAIN_STAGES,
  MAINTENANCE_ROW_GATE_CONTRACT, MAINTENANCE_STAGES, MAINTENANCE_TERMINAL_STAGES,
  MaintenanceOperationRow, MaintenanceStage,
} from './maintenance';

describe('Y1c T5b 契约冻结：MAINTENANCE_STAGES 11 值（Prisma enum 非裸 string——v5.4 措辞修正）', () => {
  it('九主段次序冻结：REQUESTED→FREEZING→DRAINING→DRAINED→EXPORTING→REBUILDING→SWITCHING→VERIFYING→COMPLETED', () => {
    expect([...MAINTENANCE_MAIN_STAGES]).toEqual([
      'REQUESTED', 'FREEZING', 'DRAINING', 'DRAINED', 'EXPORTING', 'REBUILDING',
      'SWITCHING', 'VERIFYING', 'COMPLETED',
    ]);
  });
  it('两终态：FAILED/ABORTED；11 值=主段+终态拼接（双向冻结）；无第三终态', () => {
    expect([...MAINTENANCE_TERMINAL_STAGES]).toEqual(['FAILED', 'ABORTED']);
    expect([...MAINTENANCE_STAGES]).toEqual([...MAINTENANCE_MAIN_STAGES, ...MAINTENANCE_TERMINAL_STAGES]);
    expect(MAINTENANCE_STAGES.length).toBe(11);
    expect(new Set(MAINTENANCE_STAGES).size).toBe(11);
  });
});

describe('Y1c T5b 契约冻结：转移表全对角线真值表（手写期望矩阵——SWITCHING=唯一不可回退点）', () => {
  /** 期望矩阵（from→允许 to 集——与实现独立手写，双向冻结） */
  const EXPECTED: Record<MaintenanceStage, MaintenanceStage[]> = {
    REQUESTED: ['FREEZING', 'FAILED', 'ABORTED'],
    FREEZING: ['DRAINING', 'FAILED', 'ABORTED'],
    DRAINING: ['DRAINED', 'FAILED', 'ABORTED'],
    DRAINED: ['EXPORTING', 'FAILED', 'ABORTED'],
    EXPORTING: ['REBUILDING', 'FAILED', 'ABORTED'],
    REBUILDING: ['SWITCHING', 'FAILED', 'ABORTED'],
    SWITCHING: ['VERIFYING', 'FAILED'],
    VERIFYING: ['COMPLETED', 'FAILED'],
    COMPLETED: [],
    FAILED: [],
    ABORTED: [],
  };
  it('11×11 全对角线：canTransitionMaintenanceStage ≡ 手写期望矩阵', () => {
    for (const from of MAINTENANCE_STAGES) {
      for (const to of MAINTENANCE_STAGES) {
        expect(canTransitionMaintenanceStage(from, to)).toBe(EXPECTED[from]!.includes(to));
      }
    }
  });
  it('forward 单步✓（九条主链边全真）；自环✗（幂等重入不在转移表——stage 持久化幂等是动作面语义）', () => {
    for (let i = 0; i + 1 < MAINTENANCE_MAIN_STAGES.length; i++) {
      expect(canTransitionMaintenanceStage(MAINTENANCE_MAIN_STAGES[i]!, MAINTENANCE_MAIN_STAGES[i + 1]!)).toBe(true);
    }
    for (const s of MAINTENANCE_STAGES) expect(canTransitionMaintenanceStage(s, s)).toBe(false);
  });
  it('跳步✗回退✗：REQUESTED→DRAINING（跳）/VERIFYING（远跳）/FREEZING→REQUESTED（回退）全 false', () => {
    expect(canTransitionMaintenanceStage('REQUESTED', 'DRAINING')).toBe(false);
    expect(canTransitionMaintenanceStage('REQUESTED', 'VERIFYING')).toBe(false);
    expect(canTransitionMaintenanceStage('FREEZING', 'REQUESTED')).toBe(false);
    expect(canTransitionMaintenanceStage('VERIFYING', 'REBUILDING')).toBe(false);
  });
  it('FAILED 自任意非终态✓（REQUESTED..VERIFYING 八段——COMPLETED=成功终态无出边，spec 表失败列「—」）；自 FAILED/ABORTED ✗', () => {
    const nonTerminal = MAINTENANCE_MAIN_STAGES.slice(0, 8);   // REQUESTED..VERIFYING
    for (const s of nonTerminal) expect(canTransitionMaintenanceStage(s, 'FAILED')).toBe(true);
    expect(canTransitionMaintenanceStage('COMPLETED', 'FAILED')).toBe(false);
    for (const s of MAINTENANCE_TERMINAL_STAGES) expect(canTransitionMaintenanceStage(s, 'FAILED')).toBe(false);
  });
  it('ABORTED 仅 SWITCHING（第七段）之前✓——前六段全可；SWITCHING 起全✗（已提交=只许 roll-forward）', () => {
    const beforeSwitching = MAINTENANCE_MAIN_STAGES.slice(0, 6);   // REQUESTED..REBUILDING
    for (const s of beforeSwitching) expect(canTransitionMaintenanceStage(s, 'ABORTED')).toBe(true);
    for (const s of ['SWITCHING', 'VERIFYING', 'COMPLETED'] as const) {
      expect(canTransitionMaintenanceStage(s, 'ABORTED')).toBe(false);
    }
    for (const s of MAINTENANCE_TERMINAL_STAGES) expect(canTransitionMaintenanceStage(s, 'ABORTED')).toBe(false);
  });
  it('终态无出边：FAILED/ABORTED/COMPLETED × 11 目标全 false', () => {
    for (const from of ['FAILED', 'ABORTED', 'COMPLETED'] as const) {
      for (const to of MAINTENANCE_STAGES) expect(canTransitionMaintenanceStage(from, to)).toBe(false);
    }
  });
});

describe('Y1c T5b 契约冻结：行级关闸+in-flight 范围+SWITCHING 纪律（spec §6.6 v5.4⑯）', () => {
  it('行级关闸：REQUESTED=同一 PG 事务写 MaintenanceOperation+CanvasDoc.maintenanceId（先关入口再查/等 in-flight——非 check-then-act）+受理读 IS NULL', () => {
    expect(MAINTENANCE_ROW_GATE_CONTRACT.requestedTx).toContain('同一 PG 事务');
    expect(MAINTENANCE_ROW_GATE_CONTRACT.requestedTx).toContain('CanvasDoc.maintenanceId');
    expect(MAINTENANCE_ROW_GATE_CONTRACT.admissionRead).toContain('IS NULL');
  });
  it('in-flight 判定范围五面：GenerationIntent/ExecutionNodePlan/ExecutionOutbox/delivery·materialize 在飞/退款义务（drain 到终态或 generation fence 拒绝）', () => {
    expect([...MAINTENANCE_IN_FLIGHT_SCOPE]).toEqual([
      'GenerationIntent', 'ExecutionNodePlan', 'ExecutionOutbox', 'delivery/materialize 在飞', '退款义务',
    ]);
  });
  it('SWITCHING：单 PG 事务只做 DB 变更——提交成功后 close 4410（事务内禁 close——网络关闭非事务性）；FAILED=只读显式 resume；切代前置=无在飞执行', () => {
    expect(MAINTENANCE_ROW_GATE_CONTRACT.switchingTx).toContain('只做 DB 变更');
    expect(MAINTENANCE_ROW_GATE_CONTRACT.switchingClose).toContain('4410');
    expect(MAINTENANCE_ROW_GATE_CONTRACT.switchingClose).toContain('事务内禁 close');
    expect(MAINTENANCE_ROW_GATE_CONTRACT.failedPolicy).toContain('显式 resume');
    expect(MAINTENANCE_ROW_GATE_CONTRACT.vacuumDelegation).toContain('无在飞执行');
  });
  it('MaintenanceOperationRow 列集冻结：stage 单源在本表（CanvasDoc 只存 maintenanceId）+idempotencyKey 唯一+租约列', () => {
    const row: MaintenanceOperationRow = {
      maintenanceId: 'mo-1', projectId: 'p1', stage: 'FREEZING', status: 'RUNNING', attempt: 1,
      sourceGeneration: 3, targetGeneration: 4, schemaVersion: 3, cutoffPgSeq: 42n,
      drainedAtMs: 1, error: 'x', idempotencyKey: 'idem-1', leaseOwner: 'lease-1',
      createdAtMs: 1, updatedAtMs: 1,
    };
    expect(Object.keys(row).sort()).toEqual([
      'attempt', 'createdAtMs', 'cutoffPgSeq', 'drainedAtMs', 'error', 'idempotencyKey',
      'leaseOwner', 'maintenanceId', 'projectId', 'schemaVersion', 'sourceGeneration',
      'stage', 'status', 'targetGeneration', 'updatedAtMs',
    ]);
  });
});
