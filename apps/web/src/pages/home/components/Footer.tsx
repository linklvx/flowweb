const ICP_NUMBER = '鲁ICP备2026030119号';

export function Footer() {
  return (
    <footer className="border-t border-[#262626] py-6">
      <div className="flex flex-wrap items-center justify-center gap-3 text-xs">
        <span className="text-[#888]">AI 多模态内容创作平台</span>
        <span className="text-[#333] hidden sm:inline">|</span>
        <span className="text-[#666]">文生文·文生图·图生图·图生视频·文生视频</span>
        <span className="text-[#333] hidden sm:inline">|</span>
        <a
          href="https://beian.miit.gov.cn"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#666] no-underline hover:text-[#888] hover:underline"
        >
          {ICP_NUMBER}
        </a>
      </div>
    </footer>
  );
}
