// TD-33/C1b T14：manifest spoolSegs 单调并集（旧值∪新采集，只增不减）。
import { describe, it, expect } from 'vitest';
import { mergeSpoolSegs } from './project-erasure.manifest';

const seg = (name: string, dir = 'owner-a', projectId = 'p1') => ({ projectId, dir, name });

describe('TD-33 T14：mergeSpoolSegs', () => {
  it('单调保留：spool 已清（新采集空）→旧值全保留（审计证据链不因清理时点丢）', () => {
    const prev = [seg('p1.g1.0.spool'), seg('p1.g1.1.spool')];
    expect(mergeSpoolSegs(prev, [])).toEqual(prev);
  });

  it('并集去重：同段重复不重复记；新段追加', () => {
    const merged = mergeSpoolSegs([seg('a.spool')], [seg('a.spool'), seg('b.spool')]);
    expect(merged.map((s) => s.name).sort()).toEqual(['a.spool', 'b.spool']);
  });

  it('键含 projectId/dir：同名段不同目录不误并', () => {
    const merged = mergeSpoolSegs([seg('a.spool', 'owner-a')], [seg('a.spool', 'owner-b')]);
    expect(merged).toHaveLength(2);
  });
});
