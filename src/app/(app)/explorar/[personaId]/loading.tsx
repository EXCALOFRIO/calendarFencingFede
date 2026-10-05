import { Skeleton } from '@/components/ui/skeleton';

/** Misma silueta que la ficha: cabecera con retrato, fila de cifras y lista de resultados. */
export default function Cargando() {
  return (
    <div role="status" aria-live="polite" className="flex min-w-0 flex-col gap-8">
      <span className="sr-only">Cargando la ficha deportiva…</span>
      <div className="flex flex-col" aria-hidden>
        <div className="flex items-start gap-4 border-y bg-card px-4 pt-5 pb-4 sm:gap-6 sm:px-6 sm:pt-6">
          <Skeleton className="size-[120px] shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Skeleton className="h-10 w-4/5" />
            <Skeleton className="h-7 w-1/2" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px border-b bg-border sm:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2 bg-card px-4 py-4 sm:px-5 sm:py-5">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-12 w-1/2" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col divide-y border-y bg-card" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="px-4 py-4">
            <Skeleton className="h-5 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}
