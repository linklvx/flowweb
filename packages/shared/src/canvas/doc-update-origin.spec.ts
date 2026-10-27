// packages/shared/src/canvas/doc-update-origin.spec.ts
// Y1c T24：origin 枚举分类器（doc_update_origin_total{origin} label 单源——spec §3.2 v5.4⑤）。
import { describe, it, expect } from 'vitest';
import { DOC_UPDATE_ORIGINS, classifyDocUpdateOrigin } from './doc-update-origin';

describe('Y1c T24 classifyDocUpdateOrigin（closed 六值+fail-closed 未知桶）', () => {
  it('六值词表冻结（gate|connection|load|import|maintenance|server-direct）', () => {
    expect(DOC_UPDATE_ORIGINS).toEqual(['gate', 'connection', 'load', 'import', 'maintenance', 'server-direct']);
  });

  it('归类：gate（gate 标记）/connection（库重放形态）/maintenance（SERVER_TRANSACT_ORIGIN）', () => {
    expect(classifyDocUpdateOrigin({ source: 'connection', connection: {}, gate: true })).toBe('gate');
    expect(classifyDocUpdateOrigin({ source: 'connection', connection: {} })).toBe('connection');
    expect(classifyDocUpdateOrigin('server')).toBe('maintenance');
  });

  it('load=重放抑制窗内 undefined origin；未知/窗外 undefined=server-direct（fail-closed 告警桶）', () => {
    expect(classifyDocUpdateOrigin(undefined, { replaying: true })).toBe('load');
    expect(classifyDocUpdateOrigin(undefined, { replaying: false })).toBe('server-direct');
    expect(classifyDocUpdateOrigin('weird-origin')).toBe('server-direct');
    expect(classifyDocUpdateOrigin('import')).toBe('import');
  });
});
