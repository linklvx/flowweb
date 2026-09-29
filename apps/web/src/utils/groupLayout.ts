// apps/web/src/utils/groupLayout.ts
// R1b Task 16：实现整模块下沉至 @flowweb/shared（src/canvas/geometry.ts）——本文件降为具名 re-export
// （v5 C4：`export *` 兜底面过宽；具名列全，消费面零改动）。
export {
  CELL_WIDTH, CELL_GAP, CONVERT_GAP, GROUP_PADDING, GROUP_PADDING_TOP,
  ASPECT_RATIO_MAP, RATIO_MAP, STITCH_WIDTH_MAP,
  calcDefaultGrid, calcStoryboardSize, calcStitchSize, sortNodesByPosition,
  calcGroupBounds, clampPositionToPadding, calcGroupMinSize,
  DEFAULT_CHILD_SIZE, COLLAPSED_SIZE, refitGroupGeometry, shouldAutoRefit, clampChildIntoGroup,
} from '@flowweb/shared';
