import { useEffect, useRef } from 'react';
import { App } from 'antd';
import { useMaterialLibraryStore } from '../../../stores/materialLibraryStore';
import type { MaterialFolder } from '@flowweb/shared';

interface Props {
  x: number;
  y: number;
  folder: MaterialFolder;
  onClose: () => void;
  onCreateSub: () => void;
  onRename: () => void;
}

/* SVG icons extracted from reference design */
function PlusIcon() {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center">
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/90">
        <path d="M12 5l0 14" /><path d="M5 12l14 0" />
      </svg>
    </span>
  );
}

function PencilIcon() {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/90">
        <path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4" /><path d="M13.5 6.5l4 4" />
      </svg>
    </span>
  );
}

function ArrowUpIcon() {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center">
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-white/90">
        <g transform="translate(3.5, 2)">
          <path d="M11.8047 14.3749C12.1498 14.3749 12.4297 14.6548 12.4297 14.9999C12.4297 15.3451 12.1499 15.6249 11.8047 15.6249H0.625C0.279822 15.6249 0 15.3451 0 14.9999C3.33704e-05 14.6548 0.279843 14.3749 0.625 14.3749H11.8047ZM5.82031 0.139581C6.06579 -0.0604387 6.42848 -0.0452234 6.65723 0.183527L11.4482 4.97454C11.6922 5.2186 11.6922 5.61427 11.4482 5.85833C11.2042 6.10234 10.8085 6.10233 10.5645 5.85833L6.83984 2.13372V11.8056C6.83975 12.1506 6.5599 12.4305 6.21484 12.4306C5.8698 12.4305 5.58994 12.1506 5.58984 11.8056V2.13372L1.86523 5.85833C1.62118 6.10239 1.22553 6.10234 0.981445 5.85833C0.737475 5.61424 0.737403 5.21858 0.981445 4.97454L5.77344 0.183527L5.82031 0.139581Z" fill="currentColor" />
        </g>
      </svg>
    </span>
  );
}

function TrashIcon() {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-red-400">
        <g transform="translate(2.5, 1.7365)">
          <path d="M9.02832 0C9.59908 0.000143641 10.1462 0.227263 10.5498 0.630859C10.9533 1.03449 11.1806 1.58159 11.1807 2.15234V3.05566H14.375C14.7201 3.05566 14.9999 3.33555 15 3.68066C14.9997 4.02563 14.72 4.30566 14.375 4.30566H13.4717V14.375C13.4716 14.9458 13.2454 15.4938 12.8418 15.8975C12.4381 16.301 11.8901 16.5273 11.3193 16.5273H3.68066C3.10987 16.5273 2.56187 16.301 2.1582 15.8975C1.75457 15.4938 1.52838 14.9458 1.52832 14.375V4.30566H0.625C0.279977 4.30566 0.000251287 4.02563 0 3.68066C7.33262e-05 3.33555 0.279867 3.05566 0.625 3.05566H3.81934V2.15234C3.81943 1.58159 4.04666 1.03449 4.4502 0.630859C4.85379 0.227263 5.40092 0.000143756 5.97168 0H9.02832ZM2.77832 14.375C2.77838 14.6143 2.87278 14.8444 3.04199 15.0137C3.21124 15.1828 3.44139 15.2773 3.68066 15.2773H11.3193C11.5586 15.2773 11.7888 15.1828 11.958 15.0137C12.1272 14.8444 12.2216 14.6143 12.2217 14.375V4.30566H2.77832V14.375ZM5.97168 1.25C5.73248 1.25014 5.50315 1.34551 5.33398 1.51465C5.16491 1.68385 5.06943 1.91315 5.06934 2.15234V3.05566H9.93066V2.15234C9.93057 1.91312 9.83513 1.68385 9.66602 1.51465C9.49684 1.34547 9.26756 1.25014 9.02832 1.25H5.97168Z" fill="currentColor" />
        </g>
      </svg>
    </span>
  );
}

const menuItemClass =
  'hover:bg-white/10 relative flex cursor-pointer items-center rounded-sm px-2 outline-hidden select-none gap-1.5 py-1.5 pl-2 pr-1 text-sm font-medium leading-5 text-white/90';

const destructiveItemClass =
  'hover:bg-red-400/10 relative flex cursor-pointer items-center rounded-sm px-2 outline-hidden select-none gap-1.5 py-1.5 pl-2 pr-1 text-sm font-medium leading-5 text-red-400';

export default function FolderContextMenu({ x, y, folder, onClose, onCreateSub, onRename }: Props) {
  const { modal } = App.useApp();
  const deleteFolder = useMaterialLibraryStore((s) => s.deleteFolder);
  const moveFolderUp = useMaterialLibraryStore((s) => s.moveFolderUp);

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleDelete = () => {
    modal.confirm({
      title: '删除文件夹',
      content: `确定删除文件夹"${folder.name}"及其所有子文件夹？此操作不可恢复。`,
      okType: 'danger',
      onOk: async () => {
        try {
          await deleteFolder(folder.id);
        } catch (e) {
          // error handled in store
        }
      },
    });
    onClose();
  };

  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - 230);

  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 w-[180px] gap-1 rounded-2xl bg-[#2F2F2F] p-2 px-1 border border-white/10 shadow-[0_0.5px_0_0_rgba(255,255,255,0.16)_inset,0_4px_16px_0_rgba(0,0,0,0.16)] backdrop-blur-[28px]"
      style={{ left: adjustedX, top: adjustedY }}
      tabIndex={-1}
    >
      <div
        role="menuitem"
        className={menuItemClass}
        onClick={() => { onCreateSub(); onClose(); }}
      >
        <PlusIcon />新建子文件夹
      </div>
      <div
        role="menuitem"
        className={menuItemClass}
        onClick={() => { onRename(); onClose(); }}
      >
        <PencilIcon />重命名
      </div>
      <div
        role="menuitem"
        className={menuItemClass}
        onClick={() => { moveFolderUp(folder.id); onClose(); }}
      >
        <ArrowUpIcon />向上移动
      </div>
      <div role="separator" className="bg-white/10 -mx-1 my-1 h-px" />
      <div
        role="menuitem"
        data-variant="destructive"
        className={destructiveItemClass}
        onClick={handleDelete}
      >
        <TrashIcon />删除
      </div>
    </div>
  );
}
