// ratio = width / height
// O0b-2（Spec B）：adaptCustomSize 随 customSize 并入 envelope 删除（contain-fit 单源=shared
// adaptToFit——新名独立纯函数，终裁 75；round→ceil 单源 normalizeSize，终裁 59③）。
export const RESIZE_CONFIG = {
  minSide: 100,
  maxSide: 3000,
} as const;

export const HANDLE_STYLE = {
  width: 24,
  height: 24,
  background: 'transparent',
  border: 'none',
  zIndex: 9999,
} as const;

export const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

export type CornerPosition = (typeof CORNERS)[number];

/**
 * Clamp width/height to minSide/maxSide while maintaining aspect ratio.
 * ratio = width / height
 * Priority: minSide (hard) > maxSide (soft)
 */
export function clampWithAspectRatio(
  w: number,
  h: number,
  ratio: number,
  min: number,
  max: number,
): { w: number; h: number } {
  // Step 1: inner-fit within max
  if (w > max) {
    w = max;
    h = Math.round(max / ratio);
  }
  if (h > max) {
    h = max;
    w = Math.round(max * ratio);
  }
  // Step 2: min hard constraint (can exceed max)
  if (w < min) {
    w = min;
    h = Math.round(min / ratio);
  }
  if (h < min) {
    h = min;
    w = Math.round(min * ratio);
  }
  return { w, h };
}

/**
 * Calculate anchor-compensated position based on which corner is being dragged.
 * Uses delta from current node position — does NOT depend on onResize callback x/y.
 */
export function calcAnchorCompensation(
  handle: CornerPosition,
  nodeX: number,
  nodeY: number,
  deltaW: number,
  deltaH: number,
): { x: number; y: number } {
  switch (handle) {
    case 'top-left':
      return { x: nodeX - deltaW, y: nodeY - deltaH };
    case 'top-right':
      return { x: nodeX, y: nodeY - deltaH };
    case 'bottom-left':
      return { x: nodeX - deltaW, y: nodeY };
    case 'bottom-right':
    default:
      return { x: nodeX, y: nodeY };
  }
}
