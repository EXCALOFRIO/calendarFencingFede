import { Skeleton } from '@/components/ui/skeleton';

export default function Cargando() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Cargando la ficha deportiva…</span>
      <h1 className="text-2xl sm:text-3xl">Ficha deportiva</h1>
      <Skeleton className="h-12 w-2/3" />
      <div className="flex flex-col divide-y rounded-md border bg-card" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="px-3 py-4">
            <Skeleton className="h-5 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}
