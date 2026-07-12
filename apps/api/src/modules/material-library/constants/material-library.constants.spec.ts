import { describe, it, expect } from 'vitest';
import { DEFAULT_FOLDER_NAMES } from './material-library.constants';

describe('material-library.constants', () => {
  describe('DEFAULT_FOLDER_NAMES', () => {
    it('should contain only 5 folders (生成历史 removed, duplicates history page)', () => {
      expect(DEFAULT_FOLDER_NAMES).toHaveLength(5);
    });

    it('should not include 生成历史', () => {
      expect(DEFAULT_FOLDER_NAMES).not.toContain('生成历史');
    });

    it('should include the expected folders', () => {
      expect(DEFAULT_FOLDER_NAMES).toEqual(['角色', '场景', '道具', '风格', '音效']);
    });
  });
});
