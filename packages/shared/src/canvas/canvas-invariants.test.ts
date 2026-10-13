// packages/shared/src/canvas/canvas-invariants.test.ts
// Y0c T4（E68 不变量登记表——形态冻结+逐条现状核对）：编译断言的运行时面。
// 登记表非执法器（执法缺口项移交 Y1c-3）——本测试只锁表结构完整性：五条全在+三列全填+铁律行。
import { describe, expect, it } from 'vitest';
import { CANVAS_INVARIANTS, CANVAS_INVARIANT_IRON_RULES, type CanvasInvariantId } from './canvas-invariants';

describe('Y0c T4 不变量登记表（E68——五条三列+现状标注）', () => {
  it('五条全在（Record<CanvasInvariantId,…> 穷尽——缺条即 tsc 红）', () => {
    const expected: readonly CanvasInvariantId[] = [
      'parentExistsAcyclic',
      'edgeEndpointsExist',
      'storyboardRefExists',
      'clipSourceNodeExists',
      'execWithoutNodeVoid',
    ];
    expect(Object.keys(CANVAS_INVARIANTS).sort()).toEqual([...expected].sort());
  });

  it('三列全填（判据/读侧行为/写侧行为非空）+现状标注与锚注合法', () => {
    for (const [id, entry] of Object.entries(CANVAS_INVARIANTS)) {
      expect(entry.criterion.length, `${id} 判据空`).toBeGreaterThan(0);
      expect(entry.readSide.length, `${id} 读侧空`).toBeGreaterThan(0);
      expect(entry.writeSide.length, `${id} 写侧空`).toBeGreaterThan(0);
      expect(['enforced', 'partial', 'gap'], `${id} 现状标注非法`).toContain(entry.status);
      expect(entry.anchors.length, `${id} 锚注空`).toBeGreaterThan(0);
    }
  });

  it('铁律行恰三条：读侧全函数/写侧显式拒绝/禁修复写回 doc', () => {
    expect(CANVAS_INVARIANT_IRON_RULES).toHaveLength(3);
    expect(CANVAS_INVARIANT_IRON_RULES[0]).toContain('读侧全函数');
    expect(CANVAS_INVARIANT_IRON_RULES[1]).toContain('写侧显式拒绝');
    expect(CANVAS_INVARIANT_IRON_RULES[2]).toContain('禁修复写回');
  });
});
