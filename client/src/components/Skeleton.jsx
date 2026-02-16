export function SkeletonLine({ className = "" }) {
  return <div className={`skeleton h-4 ${className}`} />;
}

export function SkeletonCard() {
  return (
    <div className="card" style={{ cursor: "default" }}>
      <div className="flex items-center gap-3">
        <div className="skeleton w-10 h-10 rounded-full shrink-0" />
        <div className="flex-1 space-y-2">
          <SkeletonLine className="w-2/3" />
          <SkeletonLine className="w-1/2 h-3" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonList({ count = 4 }) {
  return (
    <div className="page-enter">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonDetail() {
  return (
    <div className="page-enter space-y-4">
      <div className="flex items-center gap-3 mb-4">
        <div className="skeleton w-12 h-12 rounded-full shrink-0" />
        <SkeletonLine className="w-1/2 h-6" />
      </div>
      <div className="card" style={{ cursor: "default" }}>
        <div className="space-y-3">
          <SkeletonLine className="w-full" />
          <SkeletonLine className="w-5/6" />
          <SkeletonLine className="w-3/4" />
        </div>
      </div>
      <div className="card" style={{ cursor: "default" }}>
        <div className="space-y-3">
          <SkeletonLine className="w-2/3" />
          <SkeletonLine className="w-1/2" />
        </div>
      </div>
    </div>
  );
}
