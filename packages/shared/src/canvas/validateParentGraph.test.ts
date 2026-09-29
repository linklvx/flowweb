import { describe, it, expect } from 'vitest';
import { validateParentGraph } from './validateParentGraph';

const n = (id: string, parentId?: string | null, type = 't') =>
  ({ id, type, parentId: parentId ?? undefined, position: { x: 0, y: 0 }, data: {} });

describe('validateParentGraph（F39 两档）', () => {
  it('导入档：dangling/cycle/nested-group/non-group-parent 各 violation', () => {
    expect(validateParentGraph([n('a', 'ghost')], 'import').violations.some((v) => v.kind === 'dangling')).toBe(true);
    expect(validateParentGraph([n('a', 'b'), n('b', 'a')], 'import').violations.some((v) => v.kind === 'cycle')).toBe(true);
    expect(validateParentGraph([n('g2', 'g1', 'group'), n('g1', undefined, 'group')], 'import').violations.some((v) => v.kind === 'nested-group')).toBe(true);
    expect(validateParentGraph([n('c1', 'n0'), n('n0')], 'import').violations.some((v) => v.kind === 'non-group-parent')).toBe(true);
  });

  it('导入档：cells 引用完整性（悬空 cell→violation；null 占位合法）', () => {
    const nodes = [
      { ...n('g1', undefined, 'group'), data: { cells: ['ok', 'ghost', null] } },
      n('ok', 'g1'),
    ] as any;
    const v = validateParentGraph(nodes, 'import').violations;
    expect(v.some((x) => x.kind === 'dangling-cell')).toBe(true);
    expect(validateParentGraph([{ ...n('g2', undefined, 'group'), data: { cells: [null] } } as any], 'import').violations).toEqual([]);
  });

  it('导入档：边端点悬空→violation', () => {
    const r = validateParentGraph([n('a')], 'import', [{ id: 'e1', source: 'a', target: 'ghost' } as any]);
    expect(r.violations.some((v) => v.kind === 'dangling-edge')).toBe(true);
  });

  it('环去重：N 节点一个环 = 1 条 violation（v3——原设计整链各报一条）', () => {
    const v = validateParentGraph([n('a', 'b'), n('b', 'c'), n('c', 'a')], 'import').violations;
    expect(v.filter((x) => x.kind === 'cycle')).toHaveLength(1);
  });

  it('clone 档：只报 cycle——悬空/嵌套不报（红线行为锁）；合法图零 violations', () => {
    expect(validateParentGraph([n('a', 'ghost')], 'clone').violations).toEqual([]);
    expect(validateParentGraph([n('g1', undefined, 'group'), n('c1', 'g1')], 'import').violations).toEqual([]);
    // 边检查被 mode 门禁：clone 档即使传悬空边也不报（防边循环被移出门禁的回潮锁）
    expect(validateParentGraph([n('a')], 'clone', [{ id: 'e1', source: 'a', target: 'ghost' } as any]).violations).toEqual([]);
  });
});
