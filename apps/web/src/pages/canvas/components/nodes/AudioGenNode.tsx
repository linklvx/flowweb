import { memo, useEffect, useState, useCallback, useRef } from 'react';
import { type NodeProps } from '@xyflow/react';
import { useIsSingleSelected } from '@/hooks/useIsSingleSelected';
import { NodeHandle } from './NodeHandle';
import { io } from 'socket.io-client';
import { useNodeStore } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { AudioConfigPanel } from './AudioConfigPanel';
import { AudioWaveform } from './AudioWaveform';
import { useMediaUrl } from '@/hooks/useMediaUrl';
import { presignUpload, confirmUpload } from '@/api/storageApi';
import { canvasProjectId } from '@/utils/uploadContext';
import axios from 'axios';

const NODE_WIDTH = 548;
const NODE_HEIGHT = 280;

function AudioGenNodeComponent({ id, selected }: NodeProps) {
  const nodeData = useNodeStore((s) => s.nodes[id]?.data) as any;
  const updateConfig = useNodeStore((s) => s.updateConfig);
  const isSingleSelected = useIsSingleSelected(selected);
  const status = nodeData?.status ?? 'idle';
  const fileId = nodeData?.fileId;
  const referenceAudio = nodeData?.referenceAudio;
  const { url: resultUrl } = useMediaUrl(fileId);
  const { url: refAudioUrl } = useMediaUrl(referenceAudio);

  const displayUrl = resultUrl || refAudioUrl;

  // Editable title
  const [label, setLabel] = useState('Audio');
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

  const titleText = label || 'Audio';

  // Socket.io for real-time audio generation status updates
  useEffect(() => {
    const socket = io('/execution', { transports: ['websocket', 'polling'] });

    const projectId = useCanvasStore.getState().projectId;

    const joinRoom = () => {
      if (projectId) socket.emit('join', projectId);
    };

    socket.on('connect', () => {
      console.log('[AudioGenNode] socket connected, joining', projectId || '(no projectId, skipping)');
      joinRoom();
    });

    socket.on('reconnect', () => {
      console.log('[AudioGenNode] socket reconnected, re-joining', projectId || '(no projectId, skipping)');
      joinRoom();
    });

    socket.on('connect_error', (err: any) => {
      console.error('[AudioGenNode] socket connect error:', err.message);
    });

    socket.on('node:status', (data: any) => {
      console.log('[AudioGenNode] received node:status:', data);
      if (data.nodeId !== id) return;
      if (data.status === 'loading') {
        useNodeStore.getState().setStatus(id, 'loading');
      } else if (data.status === 'done' && data.fileId) {
        console.log('[AudioGenNode] setting fileId:', data.fileId);
        useNodeStore.getState().setFileResult(id, data.fileId);
      } else if (data.status === 'error') {
        useNodeStore.getState().setStatus(id, 'error');
      }
      if (data.credits !== undefined) {
        window.dispatchEvent(new CustomEvent('credits:update', { detail: data.credits }));
      }
    });

    return () => {
      if (projectId) socket.emit('leave', projectId);
      socket.removeAllListeners();
    };
  }, [id]);

  // ---- Floating upload button ----

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [useFallback, setUseFallback] = useState(false);

  const handleUploadFile = useCallback(async (file: File) => {
    setUploading(true);
    setUploadProgress(0);

    try {
      const { fileId: fid, uploadUrl, key, fields } = await presignUpload({
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        type: 'uploaded',
        projectId: canvasProjectId(),
      });

      const formData = new FormData();
      Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
      formData.append('file', file);

      const proxyUrl = uploadUrl.replace(/^https?:\/\/[^/]+\/flowai/, '/flowai');

      await axios.post(proxyUrl, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (e.total) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        },
      });

      await confirmUpload({ fileId: fid, key, fileSize: file.size });

      updateConfig(id, { referenceAudio: fid });
    } catch (err: any) {
      console.error('[AudioGenNode] upload error:', err.message);
    } finally {
      setUploading(false);
    }
  }, [id, updateConfig]);

  const showReplaceButton = !resultUrl && !!referenceAudio && !!displayUrl;

  return (
    <div className="relative canvas-node">
      {/* Hidden file input — for uploading audio */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUploadFile(file);
        }}
      />

      {/* Floating upload button — only when selected */}
      {isSingleSelected && (
        <button
          className="nodrag nopan absolute left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full border border-white/10 bg-[#222222]/80 backdrop-blur-lg text-[#ccc] px-3 py-2"
          style={{ bottom: 'calc(100% + 28px)' }}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <>
              <span className="inline-block w-3.5 h-3.5 border-2 border-[#ccc] border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">{uploadProgress}%</span>
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" />
                <path d="M7 9l5 -5l5 5" />
                <path d="M12 4l0 12" />
              </svg>
              <span className="text-sm">上传</span>
            </>
          )}
        </button>
      )}

      {/* Title bar */}
      <div
        className="absolute z-[1] pointer-events-auto -translate-y-full left-1 -top-0 pb-2 overflow-hidden whitespace-nowrap flex items-center gap-1 text-[#999]"
        style={{ width: NODE_WIDTH, lineHeight: '18px' }}
      >
        <span className="shrink-0 flex items-center" style={{ width: 12, height: 12 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 18V5l12-2v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="2" />
            <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="2" />
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
      </div>

      {/* Node body */}
      <div
        className="bg-[#222222] rounded-lg"
        style={{
          width: NODE_WIDTH,
          border: '1px solid #3F3F46',
          margin: 2,
          ...(selected
            ? { border: '1px solid transparent', boxShadow: '0 0 0 3px #9CA3AF' }
            : {}),
        }}
      >
        <NodeHandle type="target" testId="target-handle" />
        <div
          className="flex items-center justify-center overflow-hidden rounded-lg transition-all duration-300 relative group"
          style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
        >
          {displayUrl && !useFallback ? (
            <AudioWaveform
              nodeId={id}
              audioUrl={displayUrl}
              waveformUrl={undefined}
              onError={() => setUseFallback(true)}
            />
          ) : displayUrl ? (
            <audio
              src={displayUrl}
              controls
              className="max-w-[90%]"
            />
          ) : status === 'loading' ? (
            <span className="text-yellow-400 text-xs">⏳ 生成中...</span>
          ) : (
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[#888]">
              <g opacity="0.35">
                <path d="M9 18V5l12-2v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="2" />
                <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="2" />
              </g>
            </svg>
          )}

          {/* Replace button — only for user-uploaded audio (not AI-generated) */}
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
        <NodeHandle type="source" testId="source-handle" />
      </div>

      {/* Bottom config panel */}
      {isSingleSelected && !fileId && !referenceAudio && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 z-50 pt-4">
          <AudioConfigPanel nodeId={id} />
        </div>
      )}
    </div>
  );
}

export const AudioGenNode = memo(AudioGenNodeComponent);
