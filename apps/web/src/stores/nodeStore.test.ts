import { describe, it, expect, beforeEach } from 'vitest';
import { useNodeStore } from './nodeStore';

describe('nodeStore', () => {
  beforeEach(() => {
    useNodeStore.setState({ nodes: {} });
  });

  it('should initialize with empty map', () => {
    expect(useNodeStore.getState().nodes).toEqual({});
  });

  it('should update text node content', () => {
    useNodeStore.getState().updateText('n1', 'hello world');
    const data = useNodeStore.getState().nodes['n1'];
    expect(data.type).toBe('text');
    expect((data as any).content).toBe('hello world');
  });

  it('should update image node config with defaults', () => {
    useNodeStore.getState().updateConfig('img1', {});
    const data = useNodeStore.getState().nodes['img1'] as any;
    expect(data.type).toBe('image');
    expect(data.style).toBe('写实');
    expect(data.model).toBe('SD XL');
    expect(data.resolution).toBe('1024×1024');
    expect(data.count).toBe(1);
    expect(data.status).toBe('idle');
  });

  it('should update image node config with custom values', () => {
    useNodeStore.getState().updateConfig('img1', {
      style: '动漫',
      extraPrompt: 'more details',
      model: 'DALL-E 3',
      resolution: '512×512',
      count: 4,
    });
    const data = useNodeStore.getState().nodes['img1'] as any;
    expect(data.style).toBe('动漫');
    expect(data.extraPrompt).toBe('more details');
    expect(data.model).toBe('DALL-E 3');
    expect(data.resolution).toBe('512×512');
    expect(data.count).toBe(4);
  });

  it('should preserve existing config on partial update', () => {
    useNodeStore.getState().updateConfig('img1', { style: '写实', model: 'SD XL' });
    useNodeStore.getState().updateConfig('img1', { style: '油画' });
    const data = useNodeStore.getState().nodes['img1'] as any;
    expect(data.style).toBe('油画');
    expect(data.model).toBe('SD XL'); // preserved
  });

  it('should set image node status', () => {
    useNodeStore.getState().updateConfig('img1', {});
    useNodeStore.getState().setStatus('img1', 'loading');
    expect((useNodeStore.getState().nodes['img1'] as any).status).toBe('loading');
  });

  it('should set image node result and mark done', () => {
    useNodeStore.getState().updateConfig('img1', {});
    useNodeStore.getState().setResult('img1', '/generated/cat.jpg');
    const data = useNodeStore.getState().nodes['img1'] as any;
    expect(data.resultUrl).toBe('/generated/cat.jpg');
    expect(data.status).toBe('done');
  });

  it('should return node data by id', () => {
    useNodeStore.getState().updateText('n1', 'test');
    const data = useNodeStore.getState().getNodeData('n1');
    expect(data.type).toBe('text');
  });

  it('should return undefined for unknown id', () => {
    expect(useNodeStore.getState().getNodeData('does-not-exist')).toBeUndefined();
  });
});
