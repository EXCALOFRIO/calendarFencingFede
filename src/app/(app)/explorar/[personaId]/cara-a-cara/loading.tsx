import { Skeleton } from '@/components/ui/skeleton';

export default function Cargando() {
  return (
    <div role="status" aria-live="polite" className="flex min-w-0 flex-col gap-4">
      <span className="sr-only">Cargando el cara a cara…</span>
      <div aria-hidden className="flex flex-col items-center gap-5 rounded-2xl border bg-card px-4 py-6">
        <Skeleton className="h-3 w-24" />
        <div className="flex w-full items-center justify-around">
          <Skeleton className="size-20 rounded-full sm:size-36" />
          <Skeleton className="h-16 w-28" />
          <Skeleton className="size-20 rounded-full sm:size-36" />
        </div>
        <Skeleton className="h-2 w-full" />
      </div>
      <div aria-hidden className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <div aria-hidden className="flex flex-col divide-y rounded-xl border bg-card">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="px-3 py-4">
            <Skeleton className="h-5 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}
