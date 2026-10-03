/** Spec B B6-1：handle 可用性单源谓词（取代组件内 !editMode 直判——防双轨）。
 * imageGen/imageExtGen（同组件族，ImageExtNode 包 ImageGenNode）：isEditMode=!!editMode||!!transformMode
 * ⇒ 双侧无（transformMode 调整中同样收双侧）；videoGen 现状保留=无 editMode 门、双侧常开。 */

export type HandleSide = 'source' | 'target';

export function getAvailableHandles(
  nodeType: string | undefined,
  data: { editMode?: string | null; transformMode?: boolean } | null | undefined,
): HandleSide[] {
  if (nodeType === 'imageGen' || nodeType === 'imageExtGen') {
    const isEditMode = !!data?.editMode || !!data?.transformMode;
    return isEditMode ? [] : ['source', 'target'];
  }
  return ['source', 'target'];
}
