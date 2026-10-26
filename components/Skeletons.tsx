// Placeholders shown the moment a screen is tapped, while its data loads (app/**/loading.tsx).
export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-[fadein_.2s_ease-out]">
      <div className="skeleton h-9 w-48" />
      <div className="skeleton mt-3 h-4 w-72 max-w-full" />
      <div className="panel mt-6 divide-y divide-line overflow-hidden">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 p-4">
            <div className="skeleton h-10 w-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2"><div className="skeleton h-4 w-2/3" /><div className="skeleton h-3 w-1/2" /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChatSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the chat">
      <div className="mb-4 flex items-center gap-3"><div className="skeleton h-10 w-10 rounded-full" /><div className="skeleton h-11 w-11 rounded-full" /><div className="flex-1 space-y-2"><div className="skeleton h-5 w-40" /><div className="skeleton h-3 w-28" /></div></div>
      <div className="space-y-3">
        {[60, 40, 70, 50, 35].map((w, i) => <div key={i} className={`flex ${i % 2 ? "justify-end" : ""}`}><div className="skeleton h-12 rounded-[20px]" style={{ width: `${w}%` }} /></div>)}
      </div>
      <div className="skeleton mt-6 h-14 w-full rounded-[22px]" />
    </div>
  );
}
