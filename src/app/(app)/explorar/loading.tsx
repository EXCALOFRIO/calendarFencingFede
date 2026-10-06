import { Skeleton } from '@/components/ui/skeleton';
import { NOMBRE_SECCION } from '@/lib/sport/explorar/nombre-seccion';

export default function Cargando() {
  return (
    <div role="status" aria-live="polite" className="flex min-w-0 flex-col gap-4">
      <span className="sr-only">Cargando {NOMBRE_SECCION}…</span>
      <h1 className="text-3xl leading-none sm:text-4xl">{NOMBRE_SECCION}</h1>
      <div className="flex gap-2" aria-hidden>
        {['w-32', 'w-28', 'w-28'].map((w, i) => <Skeleton key={i} className={`h-9 rounded-full ${w}`} />)}
      </div>
      <Skeleton className="h-12 w-full rounded-full lg:max-w-2xl" />
      <div className="flex flex-col lg:max-w-2xl" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex min-h-14 items-center gap-3 px-0.5 py-1.5 sm:px-3">
            <Skeleton className="size-12 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
