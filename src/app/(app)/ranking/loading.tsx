import { Skeleton } from '@/components/ui/skeleton';

export default function Cargando() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-5">
      <span className="sr-only">Cargando la clasificación…</span>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl sm:text-3xl">Ranking</h1>
      </div>
      <div aria-hidden className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-11 w-48" />
          <Skeleton className="h-11 w-24" />
          <Skeleton className="h-11 w-40" />
        </div>
        <div className="flex flex-col divide-y">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 py-3">
              <Skeleton className="h-6 w-8" />
              <Skeleton className="h-5 flex-1" />
              <Skeleton className="h-5 w-12" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
