export function transformImage(
  imageUrl: string,
  rotation: 0 | 90 | 180 | 270,
  flipH: boolean,
  flipV: boolean,
  maxSize: number = 2048,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      // Scale down if exceeds maxSize
      const scale = Math.min(maxSize / width, maxSize / height, 1);
      width = Math.round(width * scale);
      height = Math.round(height * scale);

      const isRotated90 = rotation === 90 || rotation === 270;
      const canvasWidth = isRotated90 ? height : width;
      const canvasHeight = isRotated90 ? width : height;

      const canvas = document.createElement('canvas');
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      const ctx = canvas.getContext('2d')!;

      // Transform sequence: translate → rotate → scale
      ctx.translate(canvasWidth / 2, canvasHeight / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      ctx.drawImage(img, -width / 2, -height / 2, width, height);

      canvas.toBlob(
        (blob) => {
          // Release memory
          img.src = '';
          canvas.width = 0;
          canvas.height = 0;

          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Canvas导出失败'));
          }
        },
        'image/webp', 0.92,
      );
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = imageUrl;
  });
}
