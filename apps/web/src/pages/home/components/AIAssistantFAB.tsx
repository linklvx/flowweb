import { CustomerServiceOutlined } from '@ant-design/icons';

interface Props {
  onClick?: () => void;
}

export function AIAssistantFAB({ onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-8 right-8 w-14 h-14 rounded-full bg-[#4ade80] text-black shadow-lg hover:bg-[#22c55e] hover:scale-110 transition-all duration-200 flex items-center justify-center cursor-pointer border-none z-50"
      aria-label="AI 助手"
    >
      <CustomerServiceOutlined className="text-2xl" />
    </button>
  );
}
