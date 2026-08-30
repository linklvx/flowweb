import { PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router';
import { startNewProject } from '@/utils/startNewProject';

export function CreateCanvasCard() {
  const navigate = useNavigate();
  return (
    <div
      data-testid="create-canvas-card"
      onClick={() => startNewProject(navigate)}
      className="group relative h-[200px] w-full mb-8 rounded-xl border-[0.5px] border-[rgba(8,182,221,0.5)] hover:border-[rgba(8,182,221,0.8)] bg-[#1a1a1a] hover:bg-[#1e1e1e] hover:-translate-y-0.5 transition-all duration-200 cursor-pointer overflow-hidden flex flex-col items-center justify-center gap-4"
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(to bottom, rgba(4,202,246,0.04), rgba(4,202,246,0.1))',
          filter: 'blur(8px)',
        }}
      />
      <button
        aria-label="新建画布"
        onClick={(e) => { e.stopPropagation(); startNewProject(navigate); }}
        className="w-[120px] h-[56px] rounded-2xl bg-white hover:bg-[#f0f0f0] hover:scale-105 active:scale-95 shadow-[0_4px_24px_rgba(0,0,0,0.3)] flex items-center justify-center border-none cursor-pointer transition-all duration-200"
      >
        <PlusOutlined className="text-[24px] text-black" />
      </button>
      <span className="text-[15px] font-medium leading-6 text-[#d0d0d0] group-hover:scale-105 transition-transform duration-200">
        新建画布创作
      </span>
    </div>
  );
}
