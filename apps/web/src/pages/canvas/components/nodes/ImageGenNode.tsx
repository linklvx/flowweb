import { memo, useEffect, useState, useCallback, useRef } from 'react';
import { type NodeProps, useViewport, useReactFlow, useInternalNode } from '@xyflow/react';
import { NodeHandle } from './NodeHandle';
import { io } from 'socket.io-client';
import { useNodeStore } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useConfirmModalStore } from '@/stores/confirmModalStore';
import { ImageConfigPanel } from './ImageConfigPanel';
import { ImageNodeToolbar } from './ImageNodeToolbar';
import { TransformToolbar } from './TransformToolbar';
import { EditToolbar } from './EditToolbar';
import { CropOverlay } from './CropOverlay';
import { EraseCanvas, type EraseCanvasHandle, type EraseTool } from './EraseCanvas';
import { OutpaintSelectionOverlay, type OutpaintRect } from './OutpaintSelectionOverlay';
import { createPortal } from 'react-dom';
import { EraseBottomToolbar } from './EraseBottomToolbar';
import { useMediaUrl } from '@/hooks/useMediaUrl';
import { presignUpload, confirmUpload } from '@/api/storageApi';
import { transformImage } from '@/utils/imageTransform';
import { cropImage, type CropRect } from '@/utils/imageCrop';
import axios from 'axios';

const MAX_WIDTH = 548;
const MAX_HEIGHT = 500;
const MIN_WIDTH = 200;
const MIN_HEIGHT = 100;

function calcConstrainedSize(naturalW: number, naturalH: number) {
  let w = naturalW;
  let h = naturalH;

  // Scale down to max dimensions maintaining aspect ratio
  if (w > MAX_WIDTH) {
    h = Math.round(h * (MAX_WIDTH / w));
    w = MAX_WIDTH;
  }
  if (h > MAX_HEIGHT) {
    w = Math.round(w * (MAX_HEIGHT / h));
    h = MAX_HEIGHT;
  }
  // Enforce minimum dimensions
  if (w < MIN_WIDTH) w = MIN_WIDTH;
  if (h < MIN_HEIGHT) h = MIN_HEIGHT;

  return { w, h };
}

function ratioDimensions(ratio: string) {
  const [rw, rh] = ratio.split(':').map(Number);
  if (!rw || !rh) return { w: 548, h: 306 };
  // Use a large base to compute aspect ratio accurately, then constrain
  const base = 1000;
  const w = rw >= rh ? base : Math.round(base * (rw / rh));
  const h = rh >= rw ? base : Math.round(base * (rh / rw));
  return calcConstrainedSize(w, h);
}

function ImageGenNodeComponent({ id, selected }: NodeProps) {
  const nodeData = useNodeStore((s) => s.nodes[id]?.data) as any;
  const node = useNodeStore((s) => s.nodes[id]);
  const updateConfig = useNodeStore((s) => s.updateConfig);
  const addNodeWithEdge = useCanvasStore((s) => s.addNodeWithEdge);
  const { zoom, x: vpX, y: vpY } = useViewport();
  const { fitView } = useReactFlow();
  const internalNode = useInternalNode(id);
  const status = nodeData?.status ?? 'idle';
  const fileId = nodeData?.fileId;
  const referenceImage = nodeData?.referenceImage;
  const { url: resultUrl } = useMediaUrl(fileId);
  const { url: refPreviewUrl } = useMediaUrl(referenceImage);

  const displayUrl = resultUrl || refPreviewUrl;

  // Transform mode data
  const transformMode = nodeData?.transformMode ?? false;
  const imageRotation = (nodeData?.imageRotation ?? 0) as 0 | 90 | 180 | 270;
  const flipH = nodeData?.flipH ?? false;
  const flipV = nodeData?.flipV ?? false;

  // Save/cancel state
  const [isSaving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Edit mode state
  const editMode = nodeData?.editMode ?? null;
  const eraseRef = useRef<EraseCanvasHandle>(null);
  const [brushSize, setBrushSize] = useState(20);
  const [eraseTool, setEraseTool] = useState<EraseTool>('brush');
  const [isProcessing, setProcessing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const cropRectRef = useRef<CropRect>({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
  const [outpaintRect, setOutpaintRect] = useState<OutpaintRect>({ x: 0, y: 0, width: 0, height: 0 });
  const [redrawPrompt, setRedrawPrompt] = useState('');
  const [strength, setStrength] = useState(50);

  // Dynamic sizing based on image aspect ratio
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);

  // Editable title (same pattern as TextInputNode)
  const [label, setLabel] = useState('Image');
  const [draft, setDraft] = useState(label);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef(label);

  const saveTitle = useCallback(() => {
    const trimmed = draftRef.current.trim();
    if (trimmed) setLabel(trimmed);
    else {
      setDraft(label);
      draftRef.current = label;
    }
  }, [label]);

  const startEdit = useCallback(() => {
    setDraft(label);
    draftRef.current = label;
  }, [label]);

  const titleText = label || 'Image';

  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const size = calcConstrainedSize(img.naturalWidth, img.naturalHeight);
    setImgSize(size);
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
  }, []);

  // Reset dimensions when image URL changes
  useEffect(() => {
    setImgSize(null);
    setNaturalSize(null);
  }, [displayUrl]);

  const ratio = nodeData?.ratio ?? '16:9';
  const ratioSize = ratioDimensions(ratio);
  const baseWidth = imgSize ? imgSize.w : ratioSize.w;
  const baseHeight = imgSize ? imgSize.h : ratioSize.h;
  let containerWidth = baseWidth;
  let containerHeight = baseHeight;

  // Swap dimensions for 90°/270° rotation in transform mode
  if (transformMode && (imageRotation === 90 || imageRotation === 270)) {
    [containerWidth, containerHeight] = [containerHeight, containerWidth];
  }

  // CSS transform for image preview in transform mode
  const previewTransform = transformMode
    ? `rotate(${imageRotation}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`
    : undefined;

  useEffect(() => {
    const socket = io('/execution', { transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
      console.log('[ImageGenNode] socket connected, joining default');
      socket.emit('join', 'default');
    });

    socket.on('connect_error', (err: any) => {
      console.error('[ImageGenNode] socket connect error:', err.message);
    });

    socket.on('node:status', (data: any) => {
      console.log('[ImageGenNode] received node:status:', data);
      if (data.nodeId !== id) return;
      if (data.status === 'loading') {
        useNodeStore.getState().setStatus(id, 'loading');
      } else if (data.status === 'done' && data.fileId) {
        console.log('[ImageGenNode] setting fileId:', data.fileId);
        useNodeStore.getState().setFileResult(id, data.fileId);
      } else if (data.status === 'error') {
        useNodeStore.getState().setStatus(id, 'error');
      }
      if (data.credits !== undefined) {
        window.dispatchEvent(new CustomEvent('credits:update', { detail: data.credits }));
      }
    });

    return () => { socket.removeAllListeners() };
  }, [id]);

  // ---- Floating upload button ----

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const handleUploadFile = useCallback(async (file: File) => {
    setUploading(true);
    setUploadProgress(0);

    try {
      const { fileId, uploadUrl, key, fields } = await presignUpload({
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        type: 'uploaded',
      });

      const formData = new FormData();
      Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
      formData.append('file', file);

      const proxyUrl = import.meta.env.DEV
        ? uploadUrl.replace(/^http:\/\/[^/]+\/flowai/, '/minio-storage')
        : uploadUrl;

      await axios.post(proxyUrl, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (e.total) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        },
      });

      await confirmUpload({ fileId, key, fileSize: file.size });

      updateConfig(id, { referenceImage: fileId });
    } catch (err: any) {
      console.error('[ImageGenNode] upload error:', err.message);
    } finally {
      setUploading(false);
    }
  }, [id, updateConfig]);

  // ── Save handler ──

  const handleSave = useCallback(async () => {
    setErrorMessage(null);
    setSaving(true);
    try {
      const imgUrl = displayUrl;
      if (!imgUrl) throw new Error('No image to save');

      const blob = await transformImage(imgUrl, imageRotation, flipH, flipV, 2048);
      const file = new File([blob], `transformed-${Date.now()}.webp`, { type: 'image/webp' });

      const { fileId: newId, uploadUrl, key, fields } = await presignUpload({
        fileName: file.name, fileSize: file.size, fileType: 'image/webp', type: 'uploaded',
      });

      const formData = new FormData();
      Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
      formData.append('file', file);
      const proxyUrl = import.meta.env.DEV
        ? uploadUrl.replace(/^http:\/\/[^/]+\/flowai/, '/minio-storage')
        : uploadUrl;
      await axios.post(proxyUrl, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 30000,
      });

      await confirmUpload({ fileId: newId, key, fileSize: file.size });

      updateConfig(id, {
        fileId: newId, referenceImage: undefined,
        imageRotation: 0, flipH: false, flipV: false,
        transformMode: false, isSaving: false,
      });
      useNodeStore.getState().setActiveTransformNodeId(null);
    } catch (err) {
      console.error('保存变换失败:', err);
      setSaving(false);
      setErrorMessage('保存失败，请检查网络后重试');
    }
  }, [id, displayUrl, imageRotation, flipH, flipV, updateConfig]);

  // ── Cancel handler ──

  const handleCancel = useCallback(() => {
    setErrorMessage(null);
    if (isSaving) return;

    const hasChanges = imageRotation !== 0 || flipH || flipV;
    if (!hasChanges) {
      useCanvasStore.getState().deleteTransformNode(id);
      useNodeStore.getState().setActiveTransformNodeId(null);
      return;
    }

    useConfirmModalStore.getState().show({
      title: '放弃未保存的更改？',
      content: '当前变换尚未保存，请选择如何处理。',
      cancelText: '取消',
      secondaryText: '保留节点',
      primaryText: '放弃并删除',
      primaryType: 'danger',
      onClose: () => useConfirmModalStore.getState().close(),
      onSecondary: () => {
        updateConfig(id, { transformMode: false });
        useNodeStore.getState().setActiveTransformNodeId(null);
        useConfirmModalStore.getState().close();
      },
      onPrimary: () => {
        useCanvasStore.getState().deleteTransformNode(id);
        useNodeStore.getState().setActiveTransformNodeId(null);
        useConfirmModalStore.getState().close();
      },
    });
  }, [id, imageRotation, flipH, flipV, isSaving, updateConfig]);

  // ── RotateMirror handler (Phase 4: mutual exclusion before creating node) ──

  const handleRotateMirror = useCallback(async () => {
    const ns = useNodeStore.getState();
    const cs = useCanvasStore.getState();
    const activeId = ns.activeTransformNodeId;

    if (activeId) {
      const activeNode = ns.nodes[activeId];
      const d = activeNode?.data as any;
      const hasChanges = d?.imageRotation !== 0 || d?.flipH || d?.flipV;

      if (hasChanges) {
        const result = await new Promise<'cancel' | 'secondary' | 'primary'>((resolve) => {
          useConfirmModalStore.getState().show({
            title: '是否保存当前节点的更改？',
            content: '切换到新节点将丢失未保存的修改。',
            cancelText: '取消',
            secondaryText: '放弃并切换',
            primaryText: '保存并切换',
            primaryType: 'primary',
            onClose: () => resolve('cancel'),
            onSecondary: () => resolve('secondary'),
            onPrimary: () => resolve('primary'),
          });
        });

        if (result === 'cancel') return;
        if (result === 'primary') await ns.saveTransformNode(activeId);
      }
      cs.deleteTransformNode(activeId);
    }

    const newNodeId = cs.addNodeWithEdge(id);
    ns.setActiveTransformNodeId(newNodeId);
  }, [id]);

  // ── Edit mode handlers ──

  const enterEditMode = useCallback((mode: 'crop' | 'outpaint' | 'erase' | 'redraw') => {
    const ns = useNodeStore.getState();
    if (ns.activeTransformNodeId) {
      ns.triggerCancelTransform();
      setTimeout(() => {
        updateConfig(id, { editMode: mode });
        ns.setActiveEditNodeId(id);
      }, 100);
      return;
    }
    setEditError(null);
    updateConfig(id, { editMode: mode });
    ns.setActiveEditNodeId(id);
  }, [id, updateConfig]);

  const handleEditCancel = useCallback(() => {
    setEditError(null);
    if (isProcessing) return;
    updateConfig(id, { editMode: null });
    useNodeStore.getState().setActiveEditNodeId(null);
  }, [id, isProcessing, updateConfig]);

  const handleCropSave = useCallback(async () => {
    setProcessing(true);
    setEditError(null);
    try {
      const rect = cropRectRef.current;
      const blob = await cropImage(displayUrl!, rect, 2048);
      const file = new File([blob], `crop-${Date.now()}.webp`, { type: 'image/webp' });

      const { fileId: newId, uploadUrl, key, fields } = await presignUpload({
        fileName: file.name, fileSize: file.size, fileType: 'image/webp', type: 'uploaded',
      });
      const formData = new FormData();
      Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
      formData.append('file', file);
      const proxyUrl = import.meta.env.DEV
        ? uploadUrl.replace(/^http:\/\/[^/]+\/flowai/, '/minio-storage')
        : uploadUrl;
      await axios.post(proxyUrl, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }, timeout: 30000,
      });
      await confirmUpload({ fileId: newId, key, fileSize: file.size });

      updateConfig(id, { fileId: newId, referenceImage: undefined, editMode: null });
      useNodeStore.getState().setActiveEditNodeId(null);
    } catch (err) {
      console.error('裁剪失败:', err);
      setEditError('保存失败，请重试');
    } finally {
      setProcessing(false);
    }
  }, [id, displayUrl, updateConfig]);

  const handleGenerate = useCallback(async () => {
    setProcessing(true);
    setEditError(null);
    try {
      let endpoint = '';
      const body: any = { fileId, nodeId: id };

      if (editMode === 'outpaint') {
        endpoint = '/api/image-edit/outpaint';
        body.rect = outpaintRect;
        body.imageWidth = imgSize?.w ?? baseWidth;
        body.imageHeight = imgSize?.h ?? baseHeight;
      } else if (editMode === 'erase' || editMode === 'redraw') {
        endpoint = editMode === 'erase' ? '/api/image-edit/erase' : '/api/image-edit/redraw';
        const maskBlob = await eraseRef.current!.getMaskBlob(
          imgSize?.w ?? baseWidth,
          imgSize?.h ?? baseHeight,
        );
        const maskFile = new File([maskBlob], 'mask.png', { type: 'image/png' });
        const { fileId: maskId, uploadUrl, key, fields } = await presignUpload({
          fileName: maskFile.name, fileSize: maskFile.size, fileType: 'image/png', type: 'uploaded',
        });
        const fd = new FormData();
        Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
        fd.append('file', maskFile);
        const proxy = import.meta.env.DEV ? uploadUrl.replace(/^http:\/\/[^/]+\/flowai/, '/minio-storage') : uploadUrl;
        await axios.post(proxy, fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 30000 });
        await confirmUpload({ fileId: maskId, key, fileSize: maskFile.size });
        body.maskFileId = maskId;
        if (editMode === 'redraw') {
          body.prompt = redrawPrompt;
          body.strength = strength;
        }
      }

      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.error('AI 编辑失败:', err);
      setEditError('提交失败，请重试');
      setProcessing(false);
    }
  }, [id, editMode, fileId, imgSize, baseWidth, outpaintRect, redrawPrompt, strength]);

  // ── Effects ──

  // Register save handler for cross-node invocation
  useEffect(() => {
    if (!transformMode) return;
    useNodeStore.getState().registerSaveHandler(id, handleSave);
    return () => { useNodeStore.getState().unregisterSaveHandler(id); };
  }, [id, transformMode, handleSave]);

  // Set/clear activeTransformNodeId
  useEffect(() => {
    if (transformMode) {
      useNodeStore.getState().setActiveTransformNodeId(id);
    }
    return () => {
      const ns = useNodeStore.getState();
      if (ns.activeTransformNodeId === id) {
        ns.setActiveTransformNodeId(null);
      }
    };
  }, [transformMode, id]);

  // beforeunload
  useEffect(() => {
    if (!transformMode || (imageRotation === 0 && !flipH && !flipV)) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '您有未保存的更改，确定要离开吗？';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [transformMode, imageRotation, flipH, flipV]);

  // Keyboard shortcuts (only when this node is the active transform)
  useEffect(() => {
    if (!transformMode) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (useNodeStore.getState().activeTransformNodeId !== id) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;

      if (e.key === 'Escape') { e.stopPropagation(); handleCancel(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSave(); }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [id, transformMode, handleSave, handleCancel]);

  // cancelRequestedAt watcher
  useEffect(() => {
    const unsub = useNodeStore.subscribe((state, prev) => {
      if (state.cancelRequestedAt !== prev.cancelRequestedAt && state.cancelRequestedAt > 0) {
        if (state.activeTransformNodeId === id) handleCancel();
        if (state.activeEditNodeId === id) handleEditCancel();
      }
    });
    return unsub;
  }, [id, handleCancel, handleEditCancel]);

  // Edit mode keyboard shortcuts
  useEffect(() => {
    if (!editMode) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (useNodeStore.getState().activeEditNodeId !== id) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;

      if (e.key === 'Escape') { e.stopPropagation(); handleEditCancel(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && editMode === 'crop') { e.preventDefault(); handleCropSave(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && (editMode === 'erase' || editMode === 'redraw')) { e.preventDefault(); eraseRef.current?.undo(); }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [id, editMode, handleEditCancel, handleCropSave]);

  const didFitView = useRef(false);
  const didInitOutpaint = useRef(false);

  // Initialize outpaintRect once when entering outpaint mode
  useEffect(() => {
    if (editMode === 'outpaint' && displayUrl && baseWidth > 0 && baseHeight > 0 && !didInitOutpaint.current) {
      didInitOutpaint.current = true;
      const defaultX = -(baseWidth * 0.1);
      const defaultY = -(baseHeight * 0.1);
      const defaultW = baseWidth * 1.2;
      const defaultH = baseHeight * 1.2;
      setOutpaintRect({ x: defaultX, y: defaultY, width: defaultW, height: defaultH });
      if (!didFitView.current) {
        didFitView.current = true;
        setTimeout(() => {
          fitView({
            nodes: [{ id }],
            duration: 300,
            maxZoom: 0.8,
            minZoom: 0.8,
            padding: 0.3,
          });
        }, 50);
      }
    }
    if (editMode !== 'outpaint') {
      didInitOutpaint.current = false;
      didFitView.current = false;
      setOutpaintRect({ x: 0, y: 0, width: 0, height: 0 });
    }
  }, [editMode, displayUrl, baseWidth, baseHeight, id, fitView]);

  // Edit mode node locking
  useEffect(() => {
    if (editMode !== null) {
      useCanvasStore.getState().setNodeDraggable(id, false);
    }
    return () => {
      useCanvasStore.getState().setNodeDraggable(id, true);
    };
  }, [editMode, id]);

  // Socket.io edit result handlers
  useEffect(() => {
    if (!editMode) return;
    const socket = io('/execution', { transports: ['websocket', 'polling'] });
    socket.on('connect', () => socket.emit('join', 'default'));
    socket.on('node:edit-result', (data: any) => {
      if (data.nodeId !== id) return;
      updateConfig(id, { fileId: data.fileId, editMode: null });
      useNodeStore.getState().setActiveEditNodeId(null);
      setProcessing(false);
    });
    socket.on('node:edit-failed', (data: any) => {
      if (data.nodeId !== id) return;
      setEditError(data.error || 'AI 处理失败');
      setProcessing(false);
    });
    return () => { socket.removeAllListeners(); };
  }, [editMode, id, updateConfig]);

  const showReplaceButton = !resultUrl && !!referenceImage && !!displayUrl;

  return (
    <div className="relative canvas-node">
      {/* Hidden file input — shared by floating upload + replace buttons */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUploadFile(file);
        }}
      />

      {/* Floating toolbar — EditToolbar > TransformToolbar > ImageNodeToolbar */}
      {editMode ? (
        <EditToolbar
          nodeId={id}
          editMode={editMode}
          isSaving={isProcessing}
          errorMessage={editError}
          onSave={editMode === 'crop' ? handleCropSave : undefined}
          onCancel={handleEditCancel}
          onUndo={editMode === 'erase' || editMode === 'redraw' ? () => eraseRef.current?.undo() : undefined}
          onRedo={editMode === 'erase' || editMode === 'redraw' ? () => eraseRef.current?.redo() : undefined}
          onClear={editMode === 'erase' || editMode === 'redraw' ? () => eraseRef.current?.clear() : undefined}
          onGenerate={editMode !== 'crop' ? handleGenerate : undefined}
          brushSize={brushSize}
          onBrushSizeChange={setBrushSize}
          eraseTool={eraseTool}
          onEraseToolChange={(t) => setEraseTool(t as EraseTool)}
          outpaintRect={editMode === 'outpaint' ? outpaintRect : undefined}
          onOutpaintRatioChange={editMode === 'outpaint' ? setOutpaintRect : undefined}
          imageW={editMode === 'outpaint' ? baseWidth : undefined}
          imageH={editMode === 'outpaint' ? baseHeight : undefined}
          frameVpBottom={editMode === 'outpaint' && outpaintRect.width > 0 ? (internalNode?.position.y ?? node.position.y) * zoom + vpY + (outpaintRect.y + outpaintRect.height) * zoom : undefined}
          frameVpCenterX={editMode === 'outpaint' && outpaintRect.width > 0 ? (internalNode?.position.x ?? node.position.x) * zoom + vpX + (outpaintRect.x + outpaintRect.width / 2) * zoom : undefined}
        />
      ) : transformMode ? (
        <TransformToolbar
          nodeId={id}
          rotation={imageRotation}
          flipH={flipH}
          flipV={flipV}
          selected={selected ?? false}
          isSaving={isSaving}
          errorMessage={errorMessage}
          onRotate={() => {
            setErrorMessage(null);
            updateConfig(id, { imageRotation: ((imageRotation + 90) % 360) as 0 | 90 | 180 | 270 });
          }}
          onFlipH={() => {
            setErrorMessage(null);
            updateConfig(id, { flipH: !flipH });
          }}
          onFlipV={() => {
            setErrorMessage(null);
            updateConfig(id, { flipV: !flipV });
          }}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      ) : (
        <ImageNodeToolbar
          nodeId={id}
          fileId={fileId}
          referenceImage={referenceImage}
          selected={selected ?? false}
          onUpload={() => fileInputRef.current?.click()}
          onRotateMirror={handleRotateMirror}
          onCrop={() => enterEditMode('crop')}
          onOutpaint={() => enterEditMode('outpaint')}
          onErase={() => enterEditMode('erase')}
          onRedraw={() => enterEditMode('redraw')}
        />
      )}

      <div
        className="absolute z-[1] pointer-events-auto -translate-y-full left-1 -top-0 pb-2 overflow-hidden whitespace-nowrap flex items-center gap-1 text-[#999]"
        style={{ width: containerWidth, lineHeight: '18px' }}
      >
        <span className="shrink-0 flex items-center" style={{ width: 12, height: 12 }}>
          <svg width="12" height="12" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <g opacity="1">
              <path fillRule="evenodd" clipRule="evenodd" d="M31.7998 3C33.727 3 35.293 2.998 36.5606 3.10157C37.8514 3.20704 39.0084 3.43147 40.0859 3.98047C41.7794 4.84333 43.1567 6.22061 44.0195 7.91407C44.5685 8.99162 44.793 10.1486 44.8984 11.4395C45.002 12.7071 45 14.273 45 16.2002V31.7998C45 33.727 45.002 35.293 44.8984 36.5606C44.793 37.8514 44.5685 39.0084 44.0195 40.0859C43.1567 41.7794 41.7794 43.1567 40.0859 44.0195C39.0084 44.5685 37.8514 44.793 36.5606 44.8984C35.293 45.002 33.727 45 31.7998 45H16.2002C14.273 45 12.7071 45.002 11.4395 44.8984C10.1486 44.793 8.99162 44.5685 7.91407 44.0195C6.22061 43.1567 4.84333 41.7794 3.98047 40.0859C3.43147 39.0084 3.20704 37.8514 3.10157 36.5606C2.998 35.293 3 33.727 3 31.7998V16.2002C3 14.273 2.998 12.7071 3.10157 11.4395C3.20704 10.1486 3.43147 8.99162 3.98047 7.91407C4.84333 6.22061 6.22061 4.84333 7.91407 3.98047C8.99162 3.43147 10.1486 3.20704 11.4395 3.10157C12.7071 2.998 14.273 3 16.2002 3H31.7998ZM16.6064 24.0537C16.0437 23.8709 15.4378 23.871 14.875 24.0537C14.6778 24.1178 14.3958 24.2616 13.8779 24.7012C13.3422 25.156 12.6948 25.8003 11.7207 26.7744L7 31.4951V31.7998C7 33.7928 7.00173 35.1675 7.08887 36.2344C7.17411 37.2777 7.33114 37.8498 7.54492 38.2695C8.02429 39.2103 8.78967 39.9757 9.73047 40.4551C10.1502 40.6689 10.7223 40.8259 11.7656 40.9111C12.8325 40.9983 14.2072 41 16.2002 41H31.7998C32.6238 41 33.342 40.9977 33.9766 40.9912L19.7598 26.7744C18.7856 25.8003 18.1383 25.155 17.6025 24.7002C17.085 24.2609 16.8036 24.1178 16.6064 24.0537ZM16.2002 7C14.2072 7 12.8325 7.00173 11.7656 7.08887C10.7223 7.17411 10.1502 7.33114 9.73047 7.54492C8.78967 8.02429 8.02429 8.78967 7.54492 9.73047C7.33114 10.1502 7.17411 10.7223 7.08887 11.7656C7.00173 12.8325 7 14.2072 7 16.2002V25.8389L8.89258 23.9463C9.82018 23.0187 10.5998 22.2365 11.2891 21.6514C11.9961 21.0511 12.7385 20.5413 13.6377 20.249C15.004 19.8051 16.4765 19.8042 17.8428 20.248C18.742 20.5402 19.4843 21.0511 20.1914 21.6514C20.8807 22.2366 21.6612 23.0186 22.5889 23.9463L38.79 40.1484C39.4929 39.6756 40.0676 39.0301 40.4551 38.2695C40.6689 37.8498 40.8259 37.2777 40.9111 36.2344C40.9983 35.1675 41 33.7928 41 31.7998V16.2002C41 14.2072 40.9983 12.8325 40.9111 11.7656C40.8259 10.7223 40.6689 10.1502 40.4551 9.73047C39.9757 8.78967 39.2103 8.02429 38.2695 7.54492C37.8498 7.33114 37.2777 7.17411 36.2344 7.08887C35.1675 7.00173 33.7928 7 31.7998 7H16.2002ZM31 13C33.2091 13 35 14.7909 35 17C35 19.2091 33.2091 21 31 21C28.7909 21 27 19.2091 27 17C27 14.7909 28.7909 13 31 13Z" fill="currentColor" />
            </g>
          </svg>
        </span>
        <div className="relative min-w-0 max-w-full w-max shrink">
          <span
            className="invisible whitespace-pre inline-block pointer-events-none select-none align-top"
            aria-hidden="true"
            style={{ fontSize: 12, lineHeight: '18px' }}
          >
            {(draft || titleText) + ' '}
          </span>
          <input
            ref={titleInputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              draftRef.current = e.target.value;
            }}
            onFocus={startEdit}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') titleInputRef.current?.blur();
              if (e.key === 'Escape') {
                setDraft(label);
                draftRef.current = label;
                titleInputRef.current?.blur();
              }
            }}
            placeholder="请输入标题"
            className="nodrag absolute inset-0 box-border w-full p-0 h-auto bg-transparent text-inherit border-none outline-none"
            style={{ fontSize: 12, lineHeight: '18px', minWidth: 0 }}
            aria-label="节点标题"
            maxLength={20}
          />
        </div>
        {naturalSize && (
          <span className="shrink-0 ml-auto" style={{ fontSize: 10, color: '#777' }}>
            {naturalSize.w} × {naturalSize.h}
          </span>
        )}
      </div>
      <div
        className="bg-[#222222] rounded-lg overflow-hidden"
        style={{
          width: containerWidth,
          border: '1px solid #3F3F46',
          ...(editMode === 'outpaint'
            ? { border: 'none', borderRadius: 0 }
            : selected
              ? { border: '1px solid transparent', boxShadow: '0 0 0 3px #9CA3AF' }
              : {}),
        }}
      >
        {!editMode && <NodeHandle type="target" testId="target-handle" />}
        <div
          className="flex items-center justify-center overflow-hidden transition-all duration-300 relative group"
          style={{
            width: containerWidth,
            height: containerHeight,
            borderRadius: editMode === 'outpaint' ? 0 : undefined,
          }}
        >
          {displayUrl ? (
            <div className="relative" style={{ width: baseWidth, height: baseHeight }}>
              <img
                src={displayUrl}
                alt="preview"
                className="max-w-full max-h-full object-contain"
                style={{
                  width: baseWidth,
                  height: baseHeight,
                  maxWidth: 'none',
                  maxHeight: 'none',
                  ...(previewTransform ? { transform: previewTransform } : {}),
                }}
                onLoad={handleImageLoad}
              />
              {/* Edit mode overlays */}
              {editMode === 'crop' && (
                <CropOverlay
                  imageDisplayWidth={baseWidth}
                  imageDisplayHeight={baseHeight}
                  imageNaturalWidth={imgSize?.w ?? baseWidth}
                  imageNaturalHeight={imgSize?.h ?? baseHeight}
                  onCropChange={(r) => { cropRectRef.current = r; }}
                />
              )}
              {(editMode === 'erase') && (
                <EraseCanvas ref={eraseRef} width={baseWidth} height={baseHeight} brushSize={brushSize} tool={eraseTool} />
              )}
              {editMode === 'outpaint' && displayUrl && baseWidth > 0 && createPortal(
                <OutpaintSelectionOverlay
                  imageVpX={(internalNode?.position.x ?? node.position.x) * zoom + vpX}
                  imageVpY={(internalNode?.position.y ?? node.position.y) * zoom + vpY}
                  imageVpW={baseWidth * zoom}
                  imageVpH={baseHeight * zoom}
                  value={outpaintRect.width > 0 ? outpaintRect : { x: -(baseWidth * 0.1), y: -(baseHeight * 0.1), width: baseWidth * 1.2, height: baseHeight * 1.2 }}
                  onChange={setOutpaintRect}
                  bottomReserve={72}
                />,
                document.getElementById('node-toolbar-portal')!,
              )}
              {editMode === 'redraw' && (
                <EraseCanvas ref={eraseRef} width={baseWidth} height={baseHeight} brushSize={brushSize} tool={eraseTool} />
              )}
            </div>
          ) : status === 'loading' ? (
            <span className="text-yellow-400 text-xs">⏳ 生成中...</span>
          ) : (
            <svg width="72" height="72" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[#888]">
              <g opacity="0.35">
                <path fillRule="evenodd" clipRule="evenodd" d="M31.7998 3C33.727 3 35.293 2.998 36.5606 3.10157C37.8514 3.20704 39.0084 3.43147 40.0859 3.98047C41.7794 4.84333 43.1567 6.22061 44.0195 7.91407C44.5685 8.99162 44.793 10.1486 44.8984 11.4395C45.002 12.7071 45 14.273 45 16.2002V31.7998C45 33.727 45.002 35.293 44.8984 36.5606C44.793 37.8514 44.5685 39.0084 44.0195 40.0859C43.1567 41.7794 41.7794 43.1567 40.0859 44.0195C39.0084 44.5685 37.8514 44.793 36.5606 44.8984C35.293 45.002 33.727 45 31.7998 45H16.2002C14.273 45 12.7071 45.002 11.4395 44.8984C10.1486 44.793 8.99162 44.5685 7.91407 44.0195C6.22061 43.1567 4.84333 41.7794 3.98047 40.0859C3.43147 39.0084 3.20704 37.8514 3.10157 36.5606C2.998 35.293 3 33.727 3 31.7998V16.2002C3 14.273 2.998 12.7071 3.10157 11.4395C3.20704 10.1486 3.43147 8.99162 3.98047 7.91407C4.84333 6.22061 6.22061 4.84333 7.91407 3.98047C8.99162 3.43147 10.1486 3.20704 11.4395 3.10157C12.7071 2.998 14.273 3 16.2002 3H31.7998ZM16.6064 24.0537C16.0437 23.8709 15.4378 23.871 14.875 24.0537C14.6778 24.1178 14.3958 24.2616 13.8779 24.7012C13.3422 25.156 12.6948 25.8003 11.7207 26.7744L7 31.4951V31.7998C7 33.7928 7.00173 35.1675 7.08887 36.2344C7.17411 37.2777 7.33114 37.8498 7.54492 38.2695C8.02429 39.2103 8.78967 39.9757 9.73047 40.4551C10.1502 40.6689 10.7223 40.8259 11.7656 40.9111C12.8325 40.9983 14.2072 41 16.2002 41H31.7998C32.6238 41 33.342 40.9977 33.9766 40.9912L19.7598 26.7744C18.7856 25.8003 18.1383 25.155 17.6025 24.7002C17.085 24.2609 16.8036 24.1178 16.6064 24.0537ZM16.2002 7C14.2072 7 12.8325 7.00173 11.7656 7.08887C10.7223 7.17411 10.1502 7.33114 9.73047 7.54492C8.78967 8.02429 8.02429 8.78967 7.54492 9.73047C7.33114 10.1502 7.17411 10.7223 7.08887 11.7656C7.00173 12.8325 7 14.2072 7 16.2002V25.8389L8.89258 23.9463C9.82018 23.0187 10.5998 22.2365 11.2891 21.6514C11.9961 21.0511 12.7385 20.5413 13.6377 20.249C15.004 19.8051 16.4765 19.8042 17.8428 20.248C18.742 20.5402 19.4843 21.0511 20.1914 21.6514C20.8807 22.2366 21.6612 23.0186 22.5889 23.9463L38.79 40.1484C39.4929 39.6756 40.0676 39.0301 40.4551 38.2695C40.6689 37.8498 40.8259 37.2777 40.9111 36.2344C40.9983 35.1675 41 33.7928 41 31.7998V16.2002C41 14.2072 40.9983 12.8325 40.9111 11.7656C40.8259 10.7223 40.6689 10.1502 40.4551 9.73047C39.9757 8.78967 39.2103 8.02429 38.2695 7.54492C37.8498 7.33114 37.2777 7.17411 36.2344 7.08887C35.1675 7.00173 33.7928 7 31.7998 7H16.2002ZM31 13C33.2091 13 35 14.7909 35 17C35 19.2091 33.2091 21 31 21C28.7909 21 27 19.2091 27 17C27 14.7909 28.7909 13 31 13Z" fill="currentColor" />
              </g>
            </svg>
          )}

          {/* Replace button — only for user-uploaded images (not AI-generated) */}
          {showReplaceButton && (
            <button
              className="nodrag nopan absolute top-2 right-2 z-5 flex items-center gap-2 w-fit h-9 px-4 py-2 text-white text-sm font-medium rounded-[10px] bg-white/10 hover:bg-white/20 cursor-pointer border border-white/10 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" />
                <path d="M7 9l5 -5l5 5" />
                <path d="M12 4l0 12" />
              </svg>
              替换
            </button>
          )}
        </div>
        {!editMode && <NodeHandle type="source" testId="source-handle" />}
      </div>
      {selected && editMode !== 'outpaint' && editMode !== 'erase' && editMode !== 'redraw' && !fileId && !referenceImage && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 z-50 pt-4">
          <ImageConfigPanel nodeId={id} />
        </div>
      )}
      {(editMode === 'erase' || editMode === 'redraw') && (
        <div
          className="absolute top-full left-1/2 z-50 pt-4"
          style={{
            transform: `translateX(-50%) scale(${1 / zoom})`,
            transformOrigin: 'top center',
            willChange: 'transform',
          }}
        >
          <EraseBottomToolbar
            nodeId={id}
            editMode={editMode === 'redraw' ? 'redraw' : 'erase'}
            onGenerate={handleGenerate}
            isProcessing={isProcessing}
            prompt={redrawPrompt}
            onPromptChange={setRedrawPrompt}
            strength={strength}
            onStrengthChange={setStrength}
          />
        </div>
      )}
    </div>
  );
}

export const ImageGenNode = memo(ImageGenNodeComponent);
