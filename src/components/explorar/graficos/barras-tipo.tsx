import type { ResumenRendimiento } from '@/lib/sport/explorar/rendimiento';
import type { TonoTipo } from '@/lib/sport/explorar/tipos-social';
import { cn } from '@/lib/utils';
import { CLASES_TONO } from '../etiqueta-competicion';
import { COLOR, MEDALLAS, pct } from './comun';

export type FilaDesglose = Pick<ResumenRendimiento, 'competiciones' | 'oros' | 'platas' | 'bronces' | 'mejor' | 'asaltos' | 'poule' | 'directa'> & {
  clave: string;
  etiqueta: string;
  /** Con tono, el rótulo es la pastilla del tipo; sin él, una pastilla neutra (categoría). */
  tono?: TonoTipo;
};

function Barra({ valor, rotulo, color }: { valor: number | null; rotulo: string; color: string }) {
  const p = pct(valor);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className="w-[3.25rem] shrink-0 text-[12px] leading-none text-muted-foreground">{rotulo}</span>
      <span aria-hidden className="relative h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        {p !== null ? <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${p}%`, background: color }} /> : null}
      </span>
      {/* Un mínimo en `ch` y no un ancho fijo: «100%» cabe sin recortarse. */}
      <span className="min-w-[4.5ch] shrink-0 text-right text-[12px] leading-none whitespace-nowrap tabular-nums text-foreground">{p === null ? '–' : `${p}%`}</span>
    </span>
  );
}

/**
 * Desglose por tipo de competición o por categoría: una fila por grupo con
 * la cifra que manda (asaltos ganados) grande a la derecha, competiciones,
 * medallas y mejor puesto pequeños, y poule frente a directa en dos barras.
 */
export function BarrasTipo({
  filas,
  titulo,
  className,
}: {
  filas: FilaDesglose[];
  /** Resumen corto para lectores de pantalla. */
  titulo: string;
  className?: string;
}) {
  if (filas.length === 0) return null;
  return (
    <ul aria-label={titulo} className={cn('grid min-w-0 gap-px overflow-hidden border-y bg-border lg:grid-cols-2', className)}>
      {filas.map((f) => {
        const p = pct(f.asaltos.porcentaje);
        const medallas = MEDALLAS.map((m) => ({ ...m, n: f[m.clave === 'oro' ? 'oros' : m.clave === 'plata' ? 'platas' : 'bronces'] }))
          .filter((m) => m.n > 0);
        return (
          <li key={f.clave} className="flex min-w-0 flex-col gap-2.5 bg-card px-3 py-3 sm:px-4 lg:odd:last:col-span-2">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col items-start gap-1.5">
                <span
                  title={f.etiqueta}
                  className={cn(
                    'inline-flex h-6 max-w-full items-center rounded-full border px-2.5 text-xs leading-none font-semibold whitespace-nowrap',
                    f.tono ? CLASES_TONO[f.tono] : 'border-filete-alto bg-card text-foreground',
                  )}
                >
                  <span className="truncate">{f.etiqueta}</span>
                </span>
                <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] leading-none text-muted-foreground">
                  {medallas.map((m) => (
                    <span key={m.clave} className="inline-flex items-center gap-1" title={m.nombre}>
                      <span aria-hidden className="size-2 rounded-full" style={{ background: COLOR[m.clave] }} />
                      <span className="sr-only">{m.nombre}</span>
                      <span className="cifra text-sm text-foreground">{m.n}</span>
                    </span>
                  ))}
                  {f.mejor !== null ? (
                    <span>
                      Mejor <strong className="cifra text-sm font-semibold text-foreground">{f.mejor}º</strong>
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="flex shrink-0 items-start gap-4 text-right">
                <span className="flex flex-col items-end gap-0.5">
                  <span className="cifra text-2xl leading-none">{f.competiciones}</span>
                  <span className="text-[12px] leading-none text-muted-foreground">comp.</span>
                </span>
                {p !== null ? (
                  <span className="flex w-12 flex-col items-end gap-0.5">
                    <span className="cifra text-2xl leading-none">
                      {p}
                      <span className="text-sm">%</span>
                    </span>
                    <span className="text-[12px] leading-none text-muted-foreground">ganados</span>
                  </span>
                ) : null}
              </div>
            </div>
            {/* Sólo las fases con asaltos importados: una barra sin dato sería una fila vacía. */}
            {f.poule.porcentaje !== null || f.directa.porcentaje !== null ? (
              <div className="flex min-w-0 gap-4">
                {f.poule.porcentaje !== null ? <Barra valor={f.poule.porcentaje} rotulo="Poule" color={COLOR.marca} /> : null}
                {f.directa.porcentaje !== null ? <Barra valor={f.directa.porcentaje} rotulo="Directa" color={COLOR.texto} /> : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
