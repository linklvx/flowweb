import { useNodeStore, isImageNode, type ImageItem, type ImageNodeData, type VideoNodeData } from '@/stores/nodeStore';
import { presignUpload, confirmUpload } from '@/api/storageApi';
import { getMediaUrl } from '@/api/mediaApi';
import { compressAccurately } from 'image-conversion';
import axios from 'axios';

export function useImageUpload(nodeId: string) {
  const node = useNodeStore((s) => s.nodes[nodeId]);

  function getLatestAllImages(): ImageItem[] {
    const data = useNodeStore.getState().nodes[nodeId]?.data as
      | ImageNodeData
      | VideoNodeData
      | undefined;
    return data?.allImages ?? [];
  }

  const updatePromptImages = (allImages: ImageItem[]) => {
    useNodeStore.getState().updatePromptImages(nodeId, allImages);
  };

  async function uploadSingleImage(
    file: File,
    onProgress?: (p: number) => void,
  ): Promise<ImageItem | null> {
    // Type guard: image nodes and video nodes (both support prompt images)
    if (!node || (!isImageNode(node) && node.type !== 'videoGen' && node.type !== 'video')) return null;

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const tempUrl = URL.createObjectURL(file);

    const tempItem: ImageItem = {
      id: tempId,
      url: tempUrl,
      name: file.name,
      status: 'uploading',
      progress: 0,
    };

    try {
      // Add temp item to store
      updatePromptImages([...getLatestAllImages(), tempItem]);

      // Compress if > 2MB
      let uploadFile: Blob = file;
      if (file.size > 2 * 1024 * 1024) {
        uploadFile = await compressAccurately(file, 2 * 1024 * 1024);
      }

      // Presign — 压缩产物是裸 Blob（无 name），文件名一律取原始 file
      const presign = await presignUpload({
        fileName: file.name,
        fileSize: uploadFile.size,
        fileType: uploadFile.type || 'image/png',
        type: 'uploaded',
      });

      // Build FormData
      const formData = new FormData();
      Object.entries(presign.fields).forEach(([k, v]) => formData.append(k, v));
      formData.append('file', uploadFile, file.name);

      // Proxy URL rewrite for dev
      const proxyUrl = presign.uploadUrl.replace(/^https?:\/\/[^/]+\/flowai/, '/flowai');

      // Upload with progress (throttle: only update store when >= 10% change)
      let lastProgress = 0;
      await axios.post(proxyUrl, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e: { loaded: number; total?: number }) => {
          if (e.total) {
            const pct = Math.round((e.loaded / e.total) * 100);
            onProgress?.(pct);

            if (pct - lastProgress >= 10 || pct === 100) {
              lastProgress = pct;
              // Always read fresh from store — do NOT use a stale closure variable
              const latestImages = getLatestAllImages();
              const updated = latestImages.map((img) =>
                img.id === tempId ? { ...img, progress: pct } : img,
              );
              updatePromptImages(updated);
            }
          }
        },
      });

      // Confirm
      await confirmUpload({
        fileId: presign.fileId,
        key: presign.key,
        fileSize: uploadFile.size,
      });

      // Replace temp with real item
      // Resolve the real presigned URL for display
      const { url: realUrl } = await getMediaUrl(presign.fileId);

      const realItem: ImageItem = {
        id: presign.fileId,
        url: realUrl,
        name: file.name,
        status: 'success',
        progress: 100,
      };

      const latestImages = getLatestAllImages();
      const finalImages = latestImages.map((img) =>
        img.id === tempId ? realItem : img,
      );
      updatePromptImages(finalImages);

      return realItem;
    } catch {
      // Mark temp item as error
      try {
        const latestImages = getLatestAllImages();
        const errorImages = latestImages.map((img) =>
          img.id === tempId ? { ...img, status: 'error' as const } : img,
        );
        updatePromptImages(errorImages);
      } catch {
        // Ignore store update errors in error handler
      }
      return null;
    } finally {
      URL.revokeObjectURL(tempUrl);
    }
  }

  async function uploadBatchImages(
    files: File[],
    maxCount?: number,
  ): Promise<ImageItem[]> {
    if (!node || (!isImageNode(node) && node.type !== 'videoGen' && node.type !== 'video')) return [];

    // Get existing images to calculate remaining slots
    const existingImages = getLatestAllImages();
    const remainingSlots =
      maxCount !== undefined
        ? Math.max(0, maxCount - existingImages.length)
        : files.length;

    const filesToUpload = files.slice(0, remainingSlots);
    if (filesToUpload.length === 0) return [];

    // Concurrency-limited upload
    const results: (ImageItem | null)[] = [];
    const concurrency = 3;
    let index = 0;

    async function worker(): Promise<void> {
      while (index < filesToUpload.length) {
        const i = index++;
        if (i >= filesToUpload.length) break;
        const result = await uploadSingleImage(filesToUpload[i]);
        results[i] = result;
      }
    }

    // Start workers up to concurrency limit
    const workers = Array.from(
      { length: Math.min(concurrency, filesToUpload.length) },
      () => worker(),
    );
    await Promise.all(workers);

    // Filter out failed (null) results
    return results.filter((r): r is ImageItem => r !== null);
  }

  async function deleteImage(imageId: string): Promise<void> {
    // Remove from store
    const currentImages = getLatestAllImages();
    const filtered = currentImages.filter((img) => img.id !== imageId);
    updatePromptImages(filtered);

    // DELETE from server
    try {
      await fetch(`/api/storage/files/${imageId}`, { method: 'DELETE' });
    } catch {
      // Server deletion is best-effort; don't throw
    }
  }

  return {
    uploadSingleImage,
    uploadBatchImages,
    deleteImage,
  };
}
