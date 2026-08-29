import { useEffect, useRef, useCallback, useState } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useNodeStore } from '@/stores/nodeStore';
import { presignUpload, confirmUpload } from '@/api/storageApi';
import { canvasProjectId } from '@/utils/uploadContext';
import axios from 'axios';

// --- Icons ---

function TextIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 16 16">
      <g transform="translate(0 1.8) scale(0.8)">
        <path d="M13.6006 14C13.8213 14.0002 14 14.1796 14 14.4004V15.1006C13.9999 15.3213 13.8213 15.4998 13.6006 15.5H0.400391C0.17953 15.5 8.56988e-05 15.3214 0 15.1006V14.4004C1.97655e-05 14.1795 0.179489 14 0.400391 14H13.6006ZM13.6006 7.0791C13.8213 7.07929 14 7.25871 14 7.47949V8.17969C13.9999 8.40041 13.8213 8.57892 13.6006 8.5791H0.400391C0.17953 8.5791 8.56988e-05 8.40053 0 8.17969V7.47949C1.97655e-05 7.2586 0.179489 7.0791 0.400391 7.0791H13.6006ZM19.6006 0C19.8213 0.000184198 20 0.179607 20 0.400391V1.10059C19.9999 1.32131 19.8213 1.49982 19.6006 1.5H0.400391C0.17953 1.5 8.56986e-05 1.32143 0 1.10059V0.400391C1.97655e-05 0.179494 0.179489 0 0.400391 0H19.6006Z" fill="currentColor"/>
      </g>
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 16 16">
      <g transform="translate(0.0149 0.0149)">
        <path d="M7.60059 0.970298C7.82137 0.970376 7.9999 1.14893 8 1.36971V1.86971C7.99999 2.09057 7.82143 2.27003 7.60059 2.2701H2.27246C1.73573 2.27053 1.30001 2.70598 1.2998 3.24276V13.6978C1.29984 13.7499 1.30459 13.8013 1.3125 13.8512L8.03711 8.62167C9.49012 7.49165 11.5578 7.6199 12.8594 8.92147L13.7002 9.76229V8.80233C13.7002 8.58143 13.8797 8.40197 14.1006 8.40194H14.6006C14.8214 8.40202 15 8.58146 15 8.80233V13.6978L14.9883 13.9303C14.8793 14.9994 14.0292 15.8498 12.96 15.9586L12.7275 15.9703H2.27246C1.0963 15.9699 0.128385 15.0757 0.0117188 13.9303L0 13.6978V3.24276C0.000207217 1.988 1.01776 0.970723 2.27246 0.970298H7.60059ZM11.9395 9.84042C11.1014 9.00268 9.77036 8.91963 8.83496 9.64706L2.37695 14.6705H12.7275C13.2644 14.6703 13.6998 14.2347 13.7002 13.6978V11.6012L11.9395 9.84042ZM5 4.4703C5.8284 4.4703 6.49995 5.14191 6.5 5.9703C6.49978 6.79854 5.82829 7.4703 5 7.4703C4.17191 7.47006 3.50022 6.79839 3.5 5.9703C3.50005 5.14206 4.17181 4.47054 5 4.4703ZM12.4023 0.145103C12.4739 -0.0483677 12.7477 -0.0483677 12.8193 0.145103L13.6318 2.33944L15.8252 3.15096C16.0187 3.22255 16.0187 3.49636 15.8252 3.56795L13.6318 4.37948L12.8193 6.57381C12.7475 6.76671 12.474 6.76691 12.4023 6.57381L11.5908 4.37948L9.39648 3.56795C9.20347 3.49629 9.20369 3.22286 9.39648 3.15096L11.5908 2.33944L12.4023 0.145103Z" fill="currentColor"/>
      </g>
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 16 16">
      <g transform="translate(0.1814 0.0149)">
        <path d="M7.59961 0.970298C7.82047 0.970298 7.99992 1.14887 8 1.36971V1.86971C7.99998 2.09061 7.82051 2.2701 7.59961 2.2701H2.27246C1.73568 2.27048 1.30001 2.70594 1.2998 3.24276V13.6978C1.30018 14.2345 1.73579 14.6701 2.27246 14.6705H12.7275C13.2644 14.6703 13.6998 14.2346 13.7002 13.6978V9.25838C13.7003 9.03754 13.8797 8.85897 14.1006 8.85897H14.5996C14.8205 8.85897 14.9999 9.03754 15 9.25838V13.6978L14.9883 13.9303C14.8793 14.9994 14.0292 15.8498 12.96 15.9586L12.7275 15.9703H2.27246C1.09628 15.9699 0.128424 15.0757 0.0117188 13.9303L0 13.6978V3.24276C0.000207303 1.98797 1.01772 0.970673 2.27246 0.970298H7.59961ZM4.84961 5.50643C4.84979 4.54404 5.97299 4.01874 6.71191 4.63534L10.4512 7.75643L10.5488 7.84823C10.9742 8.29679 10.9595 9.01079 10.5156 9.441L10.4131 9.52889L6.6748 12.3902C5.92827 12.9613 4.85004 12.4287 4.84961 11.4889V5.50643ZM6.15039 11.1549L9.45996 8.62167L6.15039 5.85995V11.1549ZM12.0693 0.145103C12.1409 -0.0483677 12.4147 -0.0483677 12.4863 0.145103L13.2979 2.33944L15.4922 3.15096C15.6855 3.22263 15.6856 3.49638 15.4922 3.56795L13.2979 4.37948L12.4863 6.57381C12.4146 6.76677 12.1411 6.76677 12.0693 6.57381L11.2578 4.37948L9.06348 3.56795C8.87005 3.49638 8.87015 3.22263 9.06348 3.15096L11.2578 2.33944L12.0693 0.145103Z" fill="currentColor"/>
      </g>
    </svg>
  );
}

function CompositeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
        <circle cx="6" cy="6" r="3"/>
        <path d="M8.12 8.12L12 12m8-8L8.12 15.88"/>
        <circle cx="6" cy="18" r="3"/>
        <path d="M14.8 14.8L20 20"/>
      </g>
    </svg>
  );
}

function AudioIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
      <path d="M8.33301 1.74982C8.74714 1.74982 9.08385 2.08572 9.08398 2.49982V17.4998C9.08398 17.914 8.74722 18.2498 8.33301 18.2498C7.91894 18.2496 7.58301 17.9139 7.58301 17.4998V2.49982C7.58314 2.08583 7.91903 1.75 8.33301 1.74982ZM15 8.83283C15.414 8.83283 15.7497 9.16888 15.75 9.58283V14.9998C15.75 15.414 15.4142 15.7498 15 15.7498C14.5858 15.7498 14.25 15.414 14.25 14.9998V9.58283C14.2503 9.16888 14.586 8.83283 15 8.83283ZM5 4.24982C5.41413 4.24982 5.74987 4.58572 5.75 4.99982V14.1668C5.74985 14.5809 5.41412 14.9168 5 14.9168C4.58588 14.9168 4.25015 14.5809 4.25 14.1668V4.99982C4.25013 4.58572 4.58587 4.24982 5 4.24982ZM11.667 5.91584C12.081 5.91601 12.4169 6.2528 12.417 6.66681V12.4998C12.417 12.9139 12.0811 13.2496 11.667 13.2498C11.2528 13.2498 10.916 12.914 10.916 12.4998V6.66681C10.9161 6.25269 11.2528 5.91584 11.667 5.91584ZM1.66699 7.58283C2.08087 7.58301 2.41668 7.91899 2.41699 8.33283V10.8328C2.41699 11.2469 2.08106 11.5836 1.66699 11.5838C1.25278 11.5838 0.916016 11.247 0.916016 10.8328V8.33283C0.916326 7.91888 1.25297 7.58283 1.66699 7.58283ZM18.333 7.58283C18.747 7.58283 19.0837 7.91888 19.084 8.33283V10.8328C19.084 11.247 18.7472 11.5838 18.333 11.5838C17.9189 11.5836 17.583 11.2469 17.583 10.8328V8.33283C17.5833 7.91899 17.9191 7.58301 18.333 7.58283ZM15.5205 0.843571C15.6281 0.554024 16.0378 0.554168 16.1455 0.843571L16.9062 2.89728C16.9401 2.98808 17.0117 3.05982 17.1025 3.09357L19.1553 3.85334C19.4453 3.96075 19.4452 4.37084 19.1553 4.47834L17.1025 5.2381C17.0114 5.2719 16.94 5.34421 16.9062 5.43537L16.1455 7.4881C16.0379 7.77771 15.628 7.77786 15.5205 7.4881L14.7607 5.43537C14.727 5.34414 14.6547 5.27186 14.5635 5.2381L12.5117 4.47834C12.2218 4.37083 12.2216 3.96073 12.5117 3.85334L14.5635 3.09357C14.6545 3.05987 14.7269 2.98827 14.7607 2.89728L15.5205 0.843571Z" fill="currentColor"/>
    </svg>
  );
}

function StackedImageIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5">
        <rect x="3" y="3" width="14" height="14" rx="2" />
        <rect x="7" y="7" width="14" height="14" rx="2" />
      </g>
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 19.8008 19.8006">
      <path d="M1.80078 16.9003C1.80087 17.1919 1.91684 17.4714 2.12305 17.6776C2.32932 17.8838 2.60874 17.9999 2.90039 17.9999H16.9004C17.192 17.9999 17.4715 17.8838 17.6777 17.6776C17.8839 17.4714 17.9999 17.1919 18 16.9003V11.9999H19.8008V16.9003C19.8007 17.6693 19.4949 18.4073 18.9512 18.951C18.4073 19.4948 17.6694 19.8006 16.9004 19.8006H2.90039C2.13135 19.8006 1.39345 19.4948 0.849609 18.951C0.305837 18.4073 9.33702e-05 17.6693 0 16.9003V11.9999H1.80078V16.9003ZM9.33203 0.202009C9.68553 -0.086443 10.2076 -0.0660213 10.5371 0.263533L16.1729 5.90025L14.9004 7.17271L10.8008 3.07408V13.8006H9V3.07408L4.90039 7.17271L3.62793 5.90025L9.26367 0.263533L9.33203 0.202009Z" fill="currentColor"/>
    </svg>
  );
}

// --- Menu item definitions ---

interface MenuItem {
  type: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
  badge?: string;
}

const ADD_NODE_ITEMS: MenuItem[] = [
  { type: 'text', label: '文本', desc: '剧本、广告词、品牌文案', icon: <TextIcon /> },
  { type: 'image', label: '图片', desc: '海报、分镜、角色设计', icon: <ImageIcon /> },
  { type: 'imageExt', label: '扩展图片', desc: '图片扩展节点', icon: <ImageIcon /> },
  { type: 'video', label: '视频', desc: '创意广告、动画、电影', icon: <VideoIcon /> },
  { type: 'composite', label: '视频合成', desc: '多个视频片段合为一个', icon: <CompositeIcon />, badge: 'Beta' },
  { type: 'audio', label: '音频', desc: '音效、配音、音乐', icon: <AudioIcon /> },
  { type: 'multiImage', label: '堆叠图片', desc: '生成或上传一组风格统一的图片', icon: <StackedImageIcon /> },
];

const ADD_RESOURCE_ITEMS: MenuItem[] = [
  { type: 'upload', label: '上传', desc: '可上传图片、视频、音频', icon: <UploadIcon /> },
];

const MENU_ITEM_CLASS =
  'group flex h-[50px] w-full items-center gap-2 border-0 bg-transparent rounded-xl px-2 py-1 text-left transition-colors duration-200 cursor-pointer';

interface AddNodeMenuProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  position?: { x: number; y: number };
}

export function AddNodeMenu({ isOpen, onClose, triggerRef, position }: AddNodeMenuProps) {
  const addNode = useCanvasStore((s) => s.addNode);
  const viewport = useCanvasStore((s) => s.viewport);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  const [uploading, setUploading] = useState(false);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);


  // Cleanup: prevent setState on unmounted component
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);


  // Dynamic positioning: triggerRef-based (left of button) or position-based (right-click)
  useEffect(() => {
    if (!isOpen || !menuRef.current) return;
    // Need either triggerRef or position
    if (!triggerRef?.current && !position) return;

    const menuEl = menuRef.current;

    const place = () => {
      let left: number;
      let top: number;

      if (position) {
        // Right-click mode: menu at bottom-right of cursor
        left = position.x + 8;
        top = position.y + 8;
      } else {
        // + button trigger mode: align to the right of the button
        const triggerRect = triggerRef!.current!.getBoundingClientRect();
        left = triggerRect.right + 19;
        top = triggerRect.top + triggerRect.height / 2 - menuEl.offsetHeight / 2 + 180;
      }

      const menuHeight = menuEl.offsetHeight;
      const menuWidth = menuEl.offsetWidth;

      // Boundary clamping
      const menuBottom = top + menuHeight;
      if (menuBottom > window.innerHeight) {
        top = window.innerHeight - menuHeight - 8;
      }
      if (top < 8) top = 8;

      const menuRight = left + menuWidth;
      if (menuRight > window.innerWidth) {
        left = window.innerWidth - menuWidth - 8;
      }
      if (left < 8) left = 8;

      menuEl.style.left = `${left}px`;
      menuEl.style.top = `${top}px`;
    };

    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [isOpen, triggerRef, position]);

  const handleItemClick = useCallback(
    (item: MenuItem) => {
      if (item.type === 'upload') {
        fileInputRef.current?.click();
        return;
      }
      const centerX = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
      const centerY = (window.innerHeight / 2 - viewport.y) / viewport.zoom;
      // TODO: 后端支持 videoComposite 类型后改为 item.type 直接映射
      addNode(item.type, { x: centerX - 125, y: centerY - 30 });
      onClose();
    },
    [addNode, viewport, onClose],
  );

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return; // 用户取消选择，菜单保持打开

    setUploading(true);
    let success = false;
    try {
      // 1. 获取预签名 URL
      const { fileId, uploadUrl, key, fields } = await presignUpload({
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        type: 'uploaded',
        projectId: canvasProjectId(),
      });

      // 2. 上传到 MinIO
      const formData = new FormData();
      Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
      formData.append('file', file);

      const proxyUrl = uploadUrl.replace(/^https?:\/\/[^/]+\/flowai/, '/flowai');

      await axios.post(proxyUrl, formData);

      // 3. 确认上传
      await confirmUpload({ fileId, key, fileSize: file.size });

      // 4. 确定节点类型
      const nodeType = file.type.startsWith('image/') ? 'image'
        : file.type.startsWith('video/') ? 'video'
        : file.type.startsWith('audio/') ? 'audio'
        : null;
      if (!nodeType) throw new Error(`Unsupported file type: ${file.type}`);

      // 5. 计算视口中心位置
      const centerX = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
      const centerY = (window.innerHeight / 2 - viewport.y) / viewport.zoom;

      // 6. 创建画布节点
      const nodeId = addNode(nodeType, { x: centerX - 125, y: centerY - 30 });

      // 7. 设置文件引用到节点数据
      const refField =
        nodeType === 'image' ? 'referenceImage'
        : nodeType === 'video' ? 'referenceVideo'
        : 'referenceAudio';
      useNodeStore.getState().updateConfig(nodeId, { [refField]: fileId });

      success = true;
    } catch (err: any) {
      console.error('[AddNodeMenu] upload error:', err.message);
    } finally {
      if (!cancelledRef.current) {
        setUploading(false);
      }
      // 清除 input，允许重复选择同一文件
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
    // 上传成功 → 关闭菜单（放在 finally 之后，确保先清理状态再卸载组件）
    if (success) {
      onClose();
    }
  }, [viewport, addNode, onClose]);

  // 菜单每次打开时重置上传状态（防御性，防止异常情况下状态残留）
  useEffect(() => {
    if (isOpen) {
      setUploading(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[calc(var(--z-panel)-1)]"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {/* Hidden file input for upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,audio/*"
        className="hidden"
        onChange={handleFileChange}
        onClick={(e) => e.stopPropagation()}
      />

      <div
        ref={menuRef}
        id="add-node-menu"
        role="menu"
        aria-label="添加节点菜单"
        className="fixed z-[var(--z-panel)] flex w-[200px] flex-col gap-0.5 rounded-2xl p-2 border"
        style={{
          backgroundColor: 'var(--canvas-controls-bg)',
          borderColor: 'var(--canvas-controls-border)',
          boxShadow: 'var(--canvas-shadow-menu)',
          backdropFilter: 'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
      <h4
        className="-mt-1 mb-1 mx-1 px-2 py-1 text-sm font-medium leading-5 opacity-60"
        style={{ color: 'var(--canvas-controls-text)' }}
      >
        添加节点
      </h4>

      {ADD_NODE_ITEMS.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={MENU_ITEM_CLASS}
          style={{ color: 'var(--canvas-controls-text)' }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--canvas-controls-hover)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
          }}
          onMouseDown={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--canvas-controls-active)';
          }}
          onMouseUp={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--canvas-controls-hover)';
          }}
          onClick={() => handleItemClick(item)}
        >
          <div
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: 'var(--canvas-controls-hover)' }}
          >
            {item.icon}
          </div>
          <div className="h-full flex-1 overflow-hidden">
            <div className="flex h-full translate-y-2 flex-col justify-start transition-transform duration-200 group-hover:translate-y-0">
              <span className="flex items-center gap-1.5 text-sm font-medium leading-5">
                {item.label}
                {item.badge && (
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] leading-3 opacity-60"
                    style={{ backgroundColor: 'var(--canvas-controls-active)' }}
                  >
                    {item.badge}
                  </span>
                )}
              </span>
              <span className="mt-0.5 truncate text-xs leading-4 opacity-0 transition-opacity duration-200 group-hover:opacity-60">
                {item.desc}
              </span>
            </div>
          </div>
        </button>
      ))}

      <h4
        className="m-1 px-2 py-1 text-sm font-medium leading-5 opacity-60"
        style={{ color: 'var(--canvas-controls-text)' }}
      >
        添加资源
      </h4>

      {ADD_RESOURCE_ITEMS.map((item) => {
        const isUploadItem = item.type === 'upload';
        return (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={MENU_ITEM_CLASS}
            disabled={isUploadItem && uploading}
            style={{
              color: 'var(--canvas-controls-text)',
              ...(isUploadItem && uploading ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
            }}
            onMouseEnter={(e) => {
              if (!uploading) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--canvas-controls-hover)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
            }}
            onMouseDown={(e) => {
              if (!uploading) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--canvas-controls-active)';
            }}
            onMouseUp={(e) => {
              if (!uploading) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--canvas-controls-hover)';
            }}
            onClick={() => handleItemClick(item)}
          >
            <div
              className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: 'var(--canvas-controls-hover)' }}
            >
              {item.icon}
            </div>
            <div className="h-full flex-1 overflow-hidden">
              <div className="flex h-full translate-y-2 flex-col justify-start transition-transform duration-200 group-hover:translate-y-0">
                <span className="text-sm font-medium leading-5">
                  {isUploadItem && uploading ? '上传中...' : item.label}
                </span>
                <span className="mt-0.5 text-xs leading-4 opacity-0 transition-opacity duration-200 group-hover:opacity-60">
                  {item.desc}
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
    </div>
  );
}
