import { describe, it, expect } from 'vitest';
import { validateTemplateData } from './template.validation';

describe('validateTemplateData', () => {
  const validData = {
    version: 1,
    nodes: [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { text: 'hello' } }],
    edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  it('should pass for valid template data', () => {
    expect(() => validateTemplateData(validData)).not.toThrow();
  });

  it('should throw for missing nodes', () => {
    const data = { ...validData, nodes: undefined };
    expect(() => validateTemplateData(data)).toThrow();
  });

  it('should throw for missing viewport', () => {
    const data = { ...validData, viewport: undefined };
    expect(() => validateTemplateData(data)).toThrow();
  });

  it('should throw for invalid node position', () => {
    const data = {
      ...validData,
      nodes: [{ id: 'n1', type: 'text', position: { x: 'invalid', y: 0 }, data: {} }],
    };
    expect(() => validateTemplateData(data)).toThrow();
  });

  it('should throw for empty data', () => {
    expect(() => validateTemplateData({})).toThrow();
  });

  it('should throw for null', () => {
    expect(() => validateTemplateData(null)).toThrow();
  });

  it('可选三键三态：缺失过 / 有值过 / 显式 null 拒（归一保证模板 JSON 无 null）', () => {
    const base = { version: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    expect(() => validateTemplateData(base)).not.toThrow(); // 缺失过
    expect(() => validateTemplateData({ ...base, nodes: [{ id: 'n', type: 't', position: { x: 0, y: 0 }, data: {}, parentId: 'p', width: 1, height: 1 }] })).not.toThrow(); // 有值过
    expect(() => validateTemplateData({ ...base, nodes: [{ id: 'n', type: 't', position: { x: 0, y: 0 }, data: {}, width: null }] })).toThrow(); // null 拒
  });

  it('version 缺失或非 1 → fail-closed 拒收（schemaVersion）', () => {
    const base = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    expect(() => validateTemplateData(base)).toThrow();
    expect(() => validateTemplateData({ ...base, version: 2 })).toThrow();
  });
});
