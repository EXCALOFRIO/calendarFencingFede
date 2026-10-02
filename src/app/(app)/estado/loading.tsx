import { Skeleton } from '@/components/ui/skeleton';

export default function Cargando() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Cargando tu estado…</span>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl sm:text-3xl">Mi estado</h1>
      </div>
      <div aria-hidden className="flex flex-col divide-y">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex gap-3 py-4">
            <Skeleton className="h-10 w-16 shrink-0" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
