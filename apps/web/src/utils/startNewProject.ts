import type { NavigateFunction } from 'react-router';

export function startNewProject(navigate: NavigateFunction): void {
  localStorage.removeItem('flowweb_projectId');
  navigate('/canvas');
}
