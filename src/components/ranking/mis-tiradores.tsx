'use client';

import { Escudo } from '@/components/escudo';
import { AvatarAnillo } from '@/components/explorar/avatar-anillo';
import { FotoDeportista } from '@/components/explorar/foto-deportista';
import { cn } from '@/lib/utils';
import type { Federacion } from '@/components/escudo';

export type TiradorPropio = {
  athleteId: string;
  apellidos: string;
  nombre: string;
  personaId: string | null;
  lados: LadoCompacto[];
};

/** Un lado (nacional o internacional) con su mejor puesto de la temporada. */
export type LadoCompacto = {
  federacion: Federacion;
  etiqueta: string;
  motivoVacio?: string;
  mejor: { etiqueta: string; puesto: number | null } | null;
};

/**
 * Tus tiradores, arriba y en poco sitio: retrato, nombre y su mejor puesto
 * nacional e internacional de la temporada, cada uno en una pastilla. Tocar
 * una pastilla cambia la tabla de abajo a ese ranking. El detalle largo (pares,
 * tira de temporadas) vive en la ficha de cada uno en Explorar.
 */
export function MisTiradores({
  tiradores,
  elegida,
  onElegir,
}: {
  tiradores: readonly TiradorPropio[];
  elegida: 'RFEE' | 'FIE';
  onElegir: (f: 'RFEE' | 'FIE') => void;
}) {
  if (tiradores.length === 0) return null;
  return (
    <section aria-label="Tus tiradores" className="grid min-w-0 gap-2 sm:grid-cols-2">
      {tiradores.map((t) => {
        const nombre = `${t.nombre} ${t.apellidos}`.trim();
        return (
          <article
            key={t.athleteId}
            data-tirador-propio={t.athleteId}
            className="flex min-w-0 items-center gap-3 rounded-xl border bg-card px-3 py-2.5"
          >
            {t.personaId ? (
              <FotoDeportista personaId={t.personaId} nombre={nombre} tamano="lista" />
            ) : (
              <AvatarAnillo nombre={nombre} tamano="sm" />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <p className="truncate text-sm font-semibold">{nombre}</p>
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {t.lados.map((lado) => {
                  const fed = lado.federacion === 'FIE' ? 'FIE' : 'RFEE';
                  const mejor = lado.mejor;
                  const puesto = mejor?.puesto ?? null;
                  return (
                    <button
                      key={lado.federacion}
                      type="button"
                      aria-pressed={elegida === fed}
                      disabled={!mejor}
                      title={mejor ? `${lado.etiqueta}: ${mejor.etiqueta}` : lado.motivoVacio}
                      onClick={() => onElegir(fed)}
                      className={cn(
                        'inline-flex h-11 min-w-0 max-w-full items-center gap-1.5 rounded-full border border-filete-alto px-3 text-xs',
                        'hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                        // Sin puesto se atenúa con el color de texto secundario, no con opacidad: el contraste sigue en 4,5:1.
                        'disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-transparent',
                        'aria-pressed:border-primary/50 aria-pressed:bg-marcado aria-pressed:text-primary-text',
                      )}
                    >
                      <Escudo federacion={lado.federacion} tamano="nota" decorativo />
                      <span className="shrink-0">{lado.etiqueta}</span>
                      <span className="cifra shrink-0 text-sm leading-none">{puesto !== null ? `${puesto}º` : '—'}</span>
                      {mejor ? <span className="min-w-0 truncate text-muted-foreground">{mejor.etiqueta}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}
