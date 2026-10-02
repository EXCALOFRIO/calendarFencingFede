import { Skeleton } from '@/components/ui/skeleton';

export default function Cargando() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Cargando tus favoritos…</span>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl sm:text-3xl">Mis favoritos</h1>
      </div>
      <div className="flex flex-col divide-y rounded-md border bg-card" aria-hidden>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="px-3 py-4">
            <Skeleton className="h-5 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
