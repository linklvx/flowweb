// components/CardGridSkeleton.tsx
export function CardGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4" data-testid="card-grid-skeleton">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="rounded-2xl bg-[#1F1F1F] p-2 animate-pulse">
          <div className="w-full rounded-xl bg-white/10" style={{ aspectRatio: '4 / 3' }} />
          <div className="mt-2 h-4 w-2/3 rounded bg-white/10" />
          <div className="mt-1.5 h-3 w-1/3 rounded bg-white/10" />
        </div>
      ))}
    </div>
  );
}
