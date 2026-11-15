// apps/api/src/modules/collab/collab-import-tracker.spec.ts
// C3a-8 修复批 C1（卡①）：ImportCoverageTracker 状态机自证——纯布尔矩阵 7 例
// （真正行为锁=T2 wiring + 既有 C1/int；本文件验证 tracker 自身的释放语义）。
import { describe, it, expect } from 'vitest';
import { ImportCoverageTracker } from './collab-import-tracker';

const PID = 'p1';
const OTHER = 'p2';

describe('ImportCoverageTracker（进程内 import 覆盖标记状态机）', () => {
  it('初始未标记：isUncovered=false；release(true) 返回 false 且不清除任何状态', () => {
    const t = new ImportCoverageTracker();
    expect(t.isUncovered(PID)).toBe(false);
    expect(t.release(PID, true)).toBe(false);
    expect(t.isUncovered(PID)).toBe(false);
  });

  it('mark 幂等：重复标记仍为未覆盖状态', () => {
    const t = new ImportCoverageTracker();
    t.mark(PID);
    t.mark(PID);
    expect(t.isUncovered(PID)).toBe(true);
  });

  it('landed=false：release 返回 false 且标记保持', () => {
    const t = new ImportCoverageTracker();
    t.mark(PID);
    expect(t.release(PID, false)).toBe(false);
    expect(t.isUncovered(PID)).toBe(true);
  });

  it('landed=true：release 返回 true 且标记清除', () => {
    const t = new ImportCoverageTracker();
    t.mark(PID);
    expect(t.release(PID, true)).toBe(true);
    expect(t.isUncovered(PID)).toBe(false);
  });

  it('恰一次：清除后二次 release(true)=false；forget 后再武装可再次 release', () => {
    const t = new ImportCoverageTracker();
    t.mark(PID);
    expect(t.release(PID, true)).toBe(true);
    expect(t.release(PID, true)).toBe(false);   // 已清除——恰一次语义
    t.forget(PID);
    t.mark(PID);                                 // forget 后再武装
    expect(t.release(PID, true)).toBe(true);
  });

  it('forget 终态：未标记时 no-op', () => {
    const t = new ImportCoverageTracker();
    t.forget(PID);
    expect(t.isUncovered(PID)).toBe(false);
    expect(t.release(PID, true)).toBe(false);
  });

  it('跨项目隔离：A 的 release 不影响 B', () => {
    const t = new ImportCoverageTracker();
    t.mark(PID);
    t.mark(OTHER);
    expect(t.release(PID, true)).toBe(true);
    expect(t.isUncovered(OTHER)).toBe(true);
    expect(t.release(OTHER, false)).toBe(false);
    expect(t.isUncovered(OTHER)).toBe(true);
  });
});
