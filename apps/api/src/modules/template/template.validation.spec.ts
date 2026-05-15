import { describe, it, expect } from 'vitest';
import { validateTemplateData } from './template.validation';

describe('validateTemplateData', () => {
  const validData = {
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
});
