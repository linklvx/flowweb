interface Props {
  onStartCreate?: () => void;
}

export function HeroSection({ onStartCreate }: Props) {
  return (
    <section className="bg-gradient-to-br from-[#0f0f23] to-[#1a1a3e] py-16">
      <div className="mx-auto max-w-[1640px] px-5 md:px-10 lg:px-[120px] text-center">
        <h1 className="text-4xl font-bold text-[#e2e8f0] mb-3">
          AI 多模态内容创作平台
        </h1>
        <p className="text-sm text-[#94a3b8] mb-8">
          文生文 · 文生图 · 图生图 · 图生视频 · 文生视频
        </p>
        <button
          onClick={onStartCreate}
          className="bg-[#4ade80] text-black font-bold text-lg px-12 py-3 rounded-lg cursor-pointer hover:bg-[#22c55e] transition-colors border-none"
        >
          开始创作
        </button>
      </div>
    </section>
  );
}
