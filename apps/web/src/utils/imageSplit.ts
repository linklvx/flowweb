/** Split total into `count` roughly equal parts. First N-1 are floor(total/count), last absorbs remainder. */
export function computeGridSizes(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) =>
    i < count - 1 ? base : total - base * (count - 1),
  );
}

/** Grid params must be in [2, 5]. */
export function validateGridParams(rows: number, cols: number): boolean {
  return rows >= 2 && rows <= 5 && cols >= 2 && cols <= 5;
}

/** Scale dimensions so long edge ≤ maxSize, maintaining aspect ratio. */
export function scaleToMaxSize(
  width: number,
  height: number,
  maxSize: number,
): { width: number; height: number } {
  if (width <= maxSize && height <= maxSize) return { width, height };
  const ratio = maxSize / Math.max(width, height);
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
}

export const MIN_SUB_IMAGE_PX = 10;

/** True if any cell's long edge is smaller than minSize. */
export function isSubImageTooSmall(
  imageWidth: number,
  imageHeight: number,
  rows: number,
  cols: number,
  minSize: number = MIN_SUB_IMAGE_PX,
): boolean {
  const cellW = Math.floor(imageWidth / cols);
  const cellH = Math.floor(imageHeight / rows);
  return Math.max(cellW, cellH) < minSize;
}

/**
 * Load an image from a URL with crossOrigin. AbortSignal support.
 * Timeout is controlled by the caller via AbortSignal — this function has no internal timer.
 */
export function loadImage(
  url: string,
  signal?: AbortSignal,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const img = new Image();
    img.crossOrigin = 'anonymous'; // must be set BEFORE src

    const onDone = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
    };

    const onLoad = () => {
      onDone();
      if (img.naturalWidth === 0 || img.naturalHeight === 0) {
        reject(new Error('图片损坏，无法切分'));
      } else {
        resolve(img);
      }
    };

    const onError = () => {
      onDone();
      reject(new Error('图片加载失败'));
    };

    const onAbort = () => {
      onDone();
      img.src = '';
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    img.onload = onLoad;
    img.onerror = onError;
    img.src = url;
  });
}

/**
 * Split a loaded image into grid cells.
 * Returns all cells with their original index, including nulls for failed crops.
 * Setting canvas.width/height auto-clears the canvas.
 */
export async function splitImageToBlobs(
  img: HTMLImageElement,
  imageWidth: number,
  imageHeight: number,
  rows: number,
  cols: number,
): Promise<Array<{ blob: Blob | null; index: number }>> {
  const cellWidths = computeGridSizes(imageWidth, cols);
  const cellHeights = computeGridSizes(imageHeight, rows);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const results: Array<{ blob: Blob | null; index: number }> = [];
  let index = 0;
  let offsetY = 0;

  for (let r = 0; r < rows; r++) {
    const ch = cellHeights[r];
    let offsetX = 0;
    for (let c = 0; c < cols; c++) {
      const cw = cellWidths[c];

      // Setting width/height auto-clears the canvas
      canvas.width = cw;
      canvas.height = ch;

      ctx.drawImage(
        img,
        offsetX, offsetY, cw, ch, // source
        0, 0, cw, ch,              // dest
      );

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', 0.9),
      );

      results.push({ blob, index });

      offsetX += cw;
      index++;
    }
    offsetY += ch;
  }

  // Release canvas
  canvas.width = 0;
  canvas.height = 0;

  return results;
}
