import { memo, useRef } from 'react';
import { AddNodeMenu } from './AddNodeMenu';
import { useMenuOpen } from '../hooks/useMenuOpen';

function NodePaletteComponent() {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { isOpen, toggle, close } = useMenuOpen();

  return (
    <>
      <div className="absolute top-1/2 -translate-y-1/2 left-4 z-40 w-14 bg-[#1a1a1a] border border-[#333] rounded-xl p-2 flex flex-col items-center shadow-2xl">
        <button
          ref={triggerRef}
          type="button"
          data-sidebar-btn="add-node"
          className="flex items-center justify-center rounded-lg transition-colors h-10 w-10 bg-[#f7f7f7] hover:bg-[#e0e0e0] border-0 cursor-pointer"
          aria-label="添加节点"
          aria-expanded={isOpen}
          aria-controls="add-node-menu"
          onClick={toggle}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            xmlnsXlink="http://www.w3.org/1999/xlink"
            aria-hidden="true"
            role="img"
            className="pointer-events-none transition-transform duration-200"
            width="16"
            height="16"
            viewBox="0 0 17 17"
            style={{ color: '#0f0f0f', transform: isOpen ? 'rotate(45deg)' : 'none' }}
          >
            <path
              d="M8.5 0C8.99705 8.57272e-06 9.40039 0.475703 9.40039 1.0625V7.59961H15.9375C16.5243 7.59961 17 8.00294 17 8.5C17 8.99706 16.5243 9.40039 15.9375 9.40039H9.40039V15.9375C9.40039 16.5243 8.99705 17 8.5 17C8.00294 17 7.59961 16.5243 7.59961 15.9375V9.40039H1.0625C0.475698 9.40039 7.60586e-08 8.99706 0 8.5C0 8.00294 0.475698 7.59961 1.0625 7.59961H7.59961V1.0625C7.59961 0.475697 8.00294 2.1727e-08 8.5 0Z"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>
      <AddNodeMenu isOpen={isOpen} onClose={close} triggerRef={triggerRef} />
    </>
  );
}

export const NodePalette = memo(NodePaletteComponent);
