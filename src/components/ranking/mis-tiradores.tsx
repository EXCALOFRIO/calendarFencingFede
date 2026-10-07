'use client';

import { Escudo } from '@/components/escudo';
import { ANILLO } from '@/components/explorar/avatar-anillo';
import { FotoDeportista } from '@/components/explorar/foto-deportista';
import { inicialesVisibles } from '@/lib/sport/nombre-visible';
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
  onIntencion,
}: {
  tiradores: readonly TiradorPropio[];
  /** El ranking que se ve; con el europeo no se marca ninguna pastilla. */
  elegida: 'RFEE' | 'FIE' | 'EFC';
  onElegir: (f: 'RFEE' | 'FIE') => void;
  /** El dedo llega a una pastilla: se puede adelantar la tabla de ese ranking. */
  onIntencion?: (f: 'RFEE' | 'FIE') => void;
}) {
  if (tiradores.length === 0) return null;
  return (
    <section aria-label="Tus tiradores" className="flex min-w-0 flex-col gap-1.5">
      <h2 className="text-[12px] font-medium text-muted-foreground">
        {tiradores.length === 1 ? 'Tu tirador' : 'Tus tiradores'}
      </h2>
      <div className={cn('grid min-w-0 max-w-3xl gap-px overflow-hidden rounded-xl border bg-border', tiradores.length > 1 && 'sm:grid-cols-2')}>
      {tiradores.map((t) => {
        const nombre = `${t.nombre} ${t.apellidos}`.trim();
        return (
          <article
            key={t.athleteId}
            data-tirador-propio={t.athleteId}
            className="flex min-w-0 items-center gap-2.5 bg-card px-2.5 py-2"
          >
            {t.personaId ? (
              <FotoDeportista personaId={t.personaId} nombre={nombre} tamano="lista" />
            ) : (
              <span aria-hidden className={cn(ANILLO, 'inline-flex shrink-0')}>
                <span className="grid size-10 place-items-center rounded-full bg-card font-display text-[14px] text-foreground">
                  {inicialesVisibles(nombre) || '—'}
                </span>
              </span>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="truncate text-[14px] leading-tight font-semibold">{nombre}</p>
              <div className="flex min-w-0 gap-1">
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
                      onPointerEnter={() => onIntencion?.(fed)}
                      onPointerDown={() => onIntencion?.(fed)}
                      onFocus={() => onIntencion?.(fed)}
                      className={cn(
                        // Se ve de 26 px; el pseudoelemento lleva el área táctil a 44.
                        "relative min-h-0! min-w-0! after:absolute after:inset-x-0 after:-inset-y-[9px] after:content-['']",
                        'inline-flex h-[26px] min-w-0 max-w-full items-center gap-1.5 rounded-full border border-filete-alto px-2 text-[12px] leading-none',
                        'hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none',
                        // Sin puesto se atenúa con el color de texto secundario, no con opacidad: el contraste sigue en 4,5:1.
                        'disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-transparent',
                        'aria-pressed:border-primary/50 aria-pressed:bg-marcado aria-pressed:text-primary-text',
                      )}
                    >
                      <Escudo federacion={lado.federacion} tamano="nota" decorativo />
                      {/* En el móvil el escudo ya dice cuál es; el nombre queda para el lector de pantalla. */}
                      <span className="shrink-0 max-sm:sr-only">{lado.etiqueta}</span>
                      <span className="cifra shrink-0 text-[14px] leading-none">{puesto !== null ? `${puesto}º` : '—'}</span>
                      {mejor ? <span className="min-w-0 truncate text-muted-foreground">{mejor.etiqueta}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </article>
        );
      })}
      </div>
    </section>
  );
}
