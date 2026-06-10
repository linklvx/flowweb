export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function cropImage(
  imageUrl: string,
  cropRect: CropRect,
  maxSize: number = 2048,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const srcX = Math.round(img.width * cropRect.x);
      const srcY = Math.round(img.height * cropRect.y);
      const srcW = Math.round(img.width * cropRect.width);
      const srcH = Math.round(img.height * cropRect.height);

      let dstW = srcW;
      let dstH = srcH;
      const scale = Math.min(maxSize / dstW, maxSize / dstH, 1);
      dstW = Math.round(dstW * scale);
      dstH = Math.round(dstH * scale);

      const canvas = document.createElement('canvas');
      canvas.width = dstW;
      canvas.height = dstH;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, dstW, dstH);

      canvas.toBlob(
        (blob) => {
          img.src = '';
          canvas.width = 0;
          canvas.height = 0;
          if (blob) resolve(blob);
          else reject(new Error('Canvas导出失败'));
        },
        'image/webp',
        0.92,
      );
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = imageUrl;
  });
}
