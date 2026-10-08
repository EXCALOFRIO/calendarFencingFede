import * as React from 'react';
import { HUSO_MADRID } from '@/lib/fechas';
import { convertirHora, mismoReloj, type HoraConvertida } from '@/lib/huso-dispositivo';
import { cn } from '@/lib/utils';

/**
 * El horario de una prueba con dos relojes: el oficial (el de la sede, el que
 * escribe la convocatoria) a la izquierda y el de España a la derecha, con
 * una marca si en España ya es otro día.
 */

export type { HoraConvertida };

/**
 * La hora `hora` del día `fecha` en `husoSede`, pasada a Madrid. `null` si la
 * hora no se lee o los dos husos dan la misma hora ese día (no hay nada que
 * convertir).
 */
export function horaEnMadrid(fecha: string, hora: string, husoSede: string | null | undefined): HoraConvertida | null {
  if (!husoSede || mismoReloj(husoSede, HUSO_MADRID, fecha)) return null;
  return convertirHora(fecha, hora, husoSede, HUSO_MADRID);
}

/** Días de diferencia entre la sede y Madrid para esa hora: −1, 0 o +1. */
export function desfaseDiasMadrid(fecha: string, hora: string, husoSede: string | null | undefined): number {
  return horaEnMadrid(fecha, hora, husoSede)?.dias ?? 0;
}

export function textoMarcaDia(dias: number): string {
  if (!dias) return '';
  const n = Math.abs(dias);
  return `${dias < 0 ? '−' : '+'}${n} ${n === 1 ? 'día' : 'días'}`;
}

/** «−1 día» / «+1 día» en pequeño. No pinta nada si es el mismo día. */
export function MarcaDia({ dias, className }: { dias: number; className?: string }) {
  const texto = textoMarcaDia(dias);
  if (!texto) return null;
  return (
    <span
      data-slot="sistema-marca-dia"
      className={cn('inline-flex h-4 items-center rounded-sm bg-secondary px-1 text-xs leading-none font-medium whitespace-nowrap text-foreground tabular-nums', className)}
    >
      <span aria-hidden>{texto}</span>
      <span className="sr-only">{dias < 0 ? `, el día anterior` : `, el día siguiente`}</span>
    </span>
  );
}

/**
 * Una fila del horario, siempre con las mismas tres columnas:
 *
 *   09:00 | Fase de grupos           | 16:00
 *         | Pabellón 2               | −1 día
 */
export function FilaHorario({
  hora,
  titulo,
  subtitulo,
  local,
  etiquetaLocal = 'en España',
  className,
}: {
  /** Hora oficial («09:00»). */
  hora: string;
  titulo: React.ReactNode;
  subtitulo?: React.ReactNode;
  /** La hora ya convertida (`horaEnMadrid`); sin ella la columna queda vacía pero ocupa su sitio. */
  local?: HoraConvertida | null;
  /** Lo que oye el lector tras la hora local. */
  etiquetaLocal?: string;
  className?: string;
}) {
  return (
    <div
      data-slot="sistema-fila-horario"
      className={cn('grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)_3.5rem] items-start gap-x-3 py-3', className)}
    >
      <span className="text-base font-semibold text-foreground tabular-nums">{hora}</span>
      <div className="flex min-w-0 flex-col">
        <span className="min-w-0 text-base text-foreground">{titulo}</span>
        {subtitulo ? <span className="min-w-0 text-sm text-muted-foreground">{subtitulo}</span> : null}
      </div>
      <div className="flex flex-col items-end gap-1">
        {local ? (
          <>
            <span className="text-sm text-muted-foreground tabular-nums">
              {local.hora}
              <span className="sr-only"> {etiquetaLocal}</span>
            </span>
            <MarcaDia dias={local.dias} />
          </>
        ) : null}
      </div>
    </div>
  );
}
