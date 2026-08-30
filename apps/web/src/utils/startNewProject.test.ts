import { describe, it, expect, vi } from 'vitest';
import { startNewProject } from './startNewProject';

describe('startNewProject', () => {
  it('先清 flowweb_projectId 再跳 /canvas', () => {
    localStorage.setItem('flowweb_projectId', 'old-project');
    const navigate = vi.fn();
    startNewProject(navigate);
    expect(localStorage.getItem('flowweb_projectId')).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/canvas');
  });

  it('无残留 projectId 时也正常跳转', () => {
    localStorage.removeItem('flowweb_projectId');
    const navigate = vi.fn();
    startNewProject(navigate);
    expect(navigate).toHaveBeenCalledWith('/canvas');
  });
});
