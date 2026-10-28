// packages/shared/src/collab/read-model-census.spec.ts
// Y1c T5c（plan v1.7 Task 5 客户端/恢复段；plan T19 census 形态）：read-model-census.json 形态类型+
// canonical shape 纯函数+形态校验器的契约测试——本卡只冻形态（27 fixture 由 T19 填充）。先红→绿。
import { describe, expect, it } from 'vitest';
import {
  ReadModelCensusEntry, READ_MODEL_CENSUS_FILENAME, READ_MODEL_CENSUS_FIXTURE_COUNT,
  canonicalReadModelShapePayload, validateReadModelCensusEntry,
} from './read-model-census';

const entry = (over: Partial<ReadModelCensusEntry> = {}): ReadModelCensusEntry => ({
  id: 'census-001',
  file: 'apps/web/src/stores/nodeStore.ts',
  fields: ['id', 'type', 'position', 'data'],
  testAnchor: 'packages/shared/src/canvas/docShape.toDocRecords.test.ts',
  shapeHash: 'a'.repeat(64),
  fixtures: ['fixture-27-01', 'fixture-27-02'],
  ...over,
});

describe('Y1c T5c 契约冻结：T19 census 形态类型', () => {
  it('ReadModelCensusEntry 键集精确冻结：id/file/fields/testAnchor/shapeHash/fixtures 六键', () => {
    const e = entry();
    expect(Object.keys(e).sort()).toEqual(['fields', 'file', 'fixtures', 'id', 'shapeHash', 'testAnchor']);
  });
  it('census 文件名+fixture 计数冻结：read-model-census.json / 27 fixture（T19 填充）', () => {
    expect(READ_MODEL_CENSUS_FILENAME).toBe('read-model-census.json');
    expect(READ_MODEL_CENSUS_FIXTURE_COUNT).toBe(29);   // T25b 微批 C-1：+1（api-canvas-read-user-face）→Y1c T27：+1（api-maintenance-export——维护 EXPORTING/VERIFYING records 真值读面）
  });
});

describe('Y1c T5c 契约冻结：canonical shape 纯函数（shapeHash 输入单源——sha256 调用点归 T19）', () => {
  it('确定性：同形状同输出；fields 排序归一（字段序漂移不改变 payload——canonical）', () => {
    const a = canonicalReadModelShapePayload(entry({ fields: ['id', 'type', 'data'] }));
    const b = canonicalReadModelShapePayload(entry({ fields: ['data', 'id', 'type'] }));
    expect(a).toBe(b);
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
  });
  it('区分性：id/file/fields/testAnchor 任一实质变化 → payload 变化', () => {
    const base = canonicalReadModelShapePayload(entry());
    expect(canonicalReadModelShapePayload(entry({ id: 'census-002' }))).not.toBe(base);
    expect(canonicalReadModelShapePayload(entry({ file: 'apps/api/src/x.ts' }))).not.toBe(base);
    expect(canonicalReadModelShapePayload(entry({ fields: [...entry().fields, 'parentId'] }))).not.toBe(base);
    expect(canonicalReadModelShapePayload(entry({ testAnchor: 'other.test.ts' }))).not.toBe(base);
  });
});

describe('Y1c T5c 契约冻结：形态校验器（T19 写入前自检——fixtures 数量门在 T19 侧）', () => {
  it('合法形态零问题', () => {
    expect(validateReadModelCensusEntry(entry())).toEqual([]);
  });
  it('非法形态逐项报红：空 id/file/testAnchor、空 fields、shapeHash 非 64hex、fixtures 空数组', () => {
    const problems = validateReadModelCensusEntry(entry({
      id: '', file: '', fields: [], testAnchor: '', shapeHash: 'xyz', fixtures: [],
    }));
    expect(problems.length).toBeGreaterThanOrEqual(6);
    expect(problems.some((p) => p.includes('id'))).toBe(true);
    expect(problems.some((p) => p.includes('file'))).toBe(true);
    expect(problems.some((p) => p.includes('fields'))).toBe(true);
    expect(problems.some((p) => p.includes('testAnchor'))).toBe(true);
    expect(problems.some((p) => p.includes('shapeHash'))).toBe(true);
    expect(problems.some((p) => p.includes('fixtures'))).toBe(true);
  });
});
