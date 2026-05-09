import { type NodeTypeData } from '@/api/adminApi';

interface Props {
  nodeTypes: NodeTypeData[];
  activeId: string;
  onChange: (id: string) => void;
}

export function NodeTypeTabs({ nodeTypes, activeId, onChange }: Props) {
  return (
    <div className="flex gap-2 mb-6">
      {nodeTypes.map((nt) => (
        <button
          key={nt.id}
          onClick={() => onChange(nt.id)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            nt.id === activeId
              ? 'bg-[#4ade80] text-black'
              : 'bg-[#1a1a1a] text-[#ccc] border border-[#333] hover:border-[#4ade80]'
          }`}
        >
          {nt.name}
        </button>
      ))}
    </div>
  );
}
