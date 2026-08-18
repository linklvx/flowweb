const FALLBACK = 'linear-gradient(#CCCCCC 0%, #939E9E 100%)';

// 错位参数还原参考效果图：left%, top%, rotate deg
const POSITIONS = [
  { left: '5.6%', top: '37.9%', rotate: -15, z: 1 },
  { left: '31.3%', top: '18.5%', rotate: 0, z: 2 },
  { left: '58.5%', top: '24.6%', rotate: 15, z: 3 },
];

// 花瓣图标（参考效果图，stroke #646464）
const PetalIcon = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" style={{ stroke: '#646464' }}>
    <path d="M11.2077 11.0832C13.7219 11.0832 15.7601 9.04507 15.7601 6.53088C15.7601 4.01668 13.7219 1.97852 11.2077 1.97852C8.6935 1.97852 6.65533 4.01668 6.65533 6.53088C6.65533 9.04507 8.6935 11.0832 11.2077 11.0832Z" strokeWidth="1.06" />
    <path d="M2.05883 7.07063C2.40649 5.06634 4.30083 3.70985 6.31403 4.03225C8.31238 4.35169 9.68225 6.2074 9.41481 8.20129C9.41481 8.34911 9.51357 8.81255 9.57973 9.03629C9.77436 9.69448 10.1844 10.6335 11.015 11.721C12.2615 13.3554 11.948 15.691 10.3152 16.9375C8.68085 18.1841 6.34524 17.8721 5.09869 16.2378C2.41541 12.7239 1.71413 9.22201 2.0514 7.11817L2.05883 7.07063Z" strokeWidth="1.06" />
    <path d="M8.52786 8.98262L7.26662 12.7829C6.82516 14.1131 7.54561 15.5493 8.87578 15.9907L12.6761 17.252C14.0062 17.6934 15.4424 16.973 15.8839 15.6428L17.1451 11.8425C17.5866 10.5124 16.8662 9.07616 15.536 8.6347L11.7357 7.37346C10.4055 6.932 8.96932 7.65244 8.52786 8.98262Z" strokeWidth="1.06" />
  </svg>
);

interface FolderStackPreviewProps {
  thumbnails: string[]; // 合法 CSS background 值
}

export function FolderStackPreview({ thumbnails }: FolderStackPreviewProps) {
  return (
    <div className="relative w-full overflow-hidden" style={{ aspectRatio: '4 / 3', background: 'linear-gradient(136deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0) 100%), rgb(29, 36, 42)', borderRadius: 12 }}>
      <div className="absolute inset-0" style={{ perspective: '400px' }}>
        {POSITIONS.map((p, i) => (
          <div key={i} className="absolute rounded-xl outline outline-1 outline-[#CCCCCC]/50 shadow-[-2px_-1px_10.5px_rgba(0,0,0,0.4)]" data-testid="stack-card"
            style={{ width: '37.3%', left: p.left, top: p.top, zIndex: p.z, transform: `rotate(${p.rotate}deg)`, aspectRatio: '100 / 134', background: thumbnails[i] ?? FALLBACK }}>
            <div className="absolute left-2 top-2"><PetalIcon /></div>
          </div>
        ))}
      </div>
      {/* 底部玻璃凹槽（口袋造型 mask + 模糊） */}
      <div className="absolute left-0 right-0 bottom-0 z-10 pointer-events-none"
        style={{
          height: '45%',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          maskImage: `url("data:image/svg+xml,%3Csvg width='284' height='116' viewBox='0 0 284 116' preserveAspectRatio='none' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 12C0 5.37258 5.37258 0 12 0H97.5617C103.047 0 108.435 1.4556 113.174 4.2182L137.578 18.4446C141.095 20.4942 145.092 21.5742 149.162 21.5742H272C278.627 21.5742 284 26.9468 284 33.5742V100C284 108.837 276.837 116 268 116H16C7.16345 116 0 108.837 0 100V12Z' fill='black'/%3E%3C/svg%3E")`,
          maskSize: '100% 100%',
          maskRepeat: 'no-repeat',
          background: 'rgba(89, 103, 107, 0.3)',
        }} />
    </div>
  );
}
