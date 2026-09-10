import { describe, it, expect } from 'vitest';
import { createHistory, pushHistory, undoHistory, redoHistory } from './history';
import type { ProjectData } from '../types';

const snap = (v: number): ProjectData => ({
  version: 1, fps: 30, tracks: [], clips: {},
  ...( { __v: v } as any), // 测试标记字段——克隆隔离断言用
});
const readV = (d: ProjectData) => (d as any).__v as number;

describe('历史栈（快照结构化克隆/上限 50/事务语义）', () => {
  it('push → undo → redo 往返', () => {
    let h = createHistory<ProjectData>();
    let cur = snap(1);
    h = pushHistory(h, cur); cur = snap(2);
    const u = undoHistory(h, cur)!;
    expect(readV(u.state)).toBe(1);
    const r = redoHistory(u.history, u.state)!;
    expect(readV(r.state)).toBe(2);
  });
  it('快照克隆隔离——push 后修改原对象不影响栈内', () => {
    let h = createHistory<ProjectData>();
    const original = snap(1);
    h = pushHistory(h, original);
    (original as any).__v = 999; // 引用仍可变
    const u = undoHistory(h, snap(2))!;
    expect(readV(u.state)).toBe(1); // 栈内快照未被污染
  });
  it('上限 50：超过丢最老', () => {
    let h = createHistory<ProjectData>(50);
    for (let i = 0; i < 55; i++) h = pushHistory(h, snap(i));
    expect(h.past.length).toBe(50);
    let cur = snap(999);
    for (let i = 0; i < 50; i++) { const u = undoHistory(h, cur)!; cur = u.state; h = u.history; }
    expect(readV(cur)).toBe(5); // 执行期修正：55 次 push 丢 i=0..4 共 5 个，past=[5..54]，50 次 undo 终值 5（计划原值 4 与自身账目矛盾）
  });
  it('新操作清空 redo 栈', () => {
    let h = createHistory<ProjectData>();
    const s1 = snap(1);
    h = pushHistory(h, s1);
    const u = undoHistory(h, snap(2))!;
    const h2 = pushHistory(u.history, u.state);
    expect(h2.future).toHaveLength(0);
  });
  it('空栈 undo/redo 返回 null', () => {
    const h = createHistory<ProjectData>();
    expect(undoHistory(h, snap(1))).toBeNull();
    expect(redoHistory(h, snap(1))).toBeNull();
  });
});
