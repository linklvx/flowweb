import { describe, it, expect } from 'vitest';
import { getAvailableHandles } from './handles';

// Spec B B6-1：handle 可用性单源谓词。
// imageGen/imageExtGen（同组件族）：isEditMode=!!editMode||!!transformMode ⇒ 双侧无；
// videoGen：现状保留=无 editMode 门，双侧常开。
describe('getAvailableHandles', () => {
  it('imageGen 无 editMode/transformMode → 双侧可用', () => {
    expect(getAvailableHandles('imageGen', {})).toEqual(['source', 'target']);
    expect(getAvailableHandles('imageGen', undefined)).toEqual(['source', 'target']);
  });

  it('imageGen+editMode ⇒ 双侧无（谓词单源——取代组件内 !editMode 直判）', () => {
    expect(getAvailableHandles('imageGen', { editMode: 'crop' })).toEqual([]);
    expect(getAvailableHandles('imageGen', { editMode: 'outpaint' })).toEqual([]);
  });

  it('imageGen+transformMode ⇒ 双侧无（isEditMode 覆盖 transformMode——B6-1 防双轨）', () => {
    expect(getAvailableHandles('imageGen', { transformMode: true })).toEqual([]);
  });

  it('imageExtGen 同组件族同门（editMode/transformMode 任一 ⇒ 双侧无）', () => {
    expect(getAvailableHandles('imageExtGen', { editMode: 'erase' })).toEqual([]);
    expect(getAvailableHandles('imageExtGen', { transformMode: true })).toEqual([]);
    expect(getAvailableHandles('imageExtGen', {})).toEqual(['source', 'target']);
  });

  it('videoGen 现状保留：无 editMode 门，双侧常开（含 editMode 键存在时）', () => {
    expect(getAvailableHandles('videoGen', {})).toEqual(['source', 'target']);
    expect(getAvailableHandles('videoGen', { editMode: 'crop' })).toEqual(['source', 'target']);
  });

  it('type 缺省（防御）→ 双侧可用（与旧 !editMode 直判默认态一致）', () => {
    expect(getAvailableHandles(undefined, { editMode: null })).toEqual(['source', 'target']);
  });
});
