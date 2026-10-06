import { cn } from '@/lib/utils';
import { indicesRotulo, xColumna } from './comun';
import { ALTO, EjeX, Leyenda, type Alto } from './eje';
import { Lectura } from './lectura';

export type SerieBarra = { clave: string; nombre: string; color: string };
export type ColumnaBarra = {
  etiqueta: string;
  /** Valor de cada serie, por clave; lo que falta cuenta 0. */
  valores: Record<string, number>;
  lectura?: string | null;
};

/**
 * Barras verticales apiladas por columna (temporadas). Las series se apilan
 * de abajo arriba en el orden dado; la cifra total va encima de cada barra
 * cuando caben (hasta 24 columnas), y una columna a cero deja una marca en la
 * base para que el hueco se lea como hueco.
 */
export function BarrasApiladas({
  columnas,
  series,
  titulo,
  alto = 'md',
  max,
  totales = true,
  leyenda = series.length > 1,
  inicial,
  className,
}: {
  columnas: ColumnaBarra[];
  series: SerieBarra[];
  titulo: string;
  alto?: Alto;
  max?: number;
  totales?: boolean;
  leyenda?: boolean;
  inicial?: string | null;
  className?: string;
}) {
  const n = columnas.length;
  const suma = (c: ColumnaBarra) => series.reduce((s, x) => s + (c.valores[x.clave] ?? 0), 0);
  const tope = Math.max(1, max ?? Math.max(0, ...columnas.map(suma)));
  const rotulos = indicesRotulo(n);
  const conTotales = totales && n <= 24;
  return (
    <Lectura inicial={inicial} className={className}>
      <div role="img" aria-label={titulo} className="flex min-w-0 flex-col gap-1">
        <div className={cn('relative flex items-stretch gap-px border-b border-filete-alto pt-4', ALTO[alto])}>
          {columnas.map((c, i) => {
            const total = suma(c);
            return (
              <div
                key={`${c.etiqueta}-${i}`}
                data-lectura={c.lectura ?? undefined}
                className="group/col flex min-w-0 flex-1 flex-col items-center justify-end"
              >
                {conTotales && total > 0 ? (
                  <span className="cifra mb-0.5 text-[0.6875rem] leading-none text-muted-foreground group-hover/col:text-foreground">
                    {total}
                  </span>
                ) : null}
                <div
                  className="flex w-full max-w-6 shrink-0 flex-col-reverse overflow-hidden rounded-t-[2px]"
                  style={{ height: `${(total / tope) * 100}%` }}
                >
                  {series.map((s) => {
                    const v = c.valores[s.clave] ?? 0;
                    return v > 0 ? (
                      <span key={s.clave} className="block w-full shrink-0" style={{ height: `${(v / total) * 100}%`, background: s.color }} />
                    ) : null;
                  })}
                </div>
                {total === 0 ? <span aria-hidden className="block h-px w-2 bg-off" /> : null}
              </div>
            );
          })}
        </div>
        <EjeX rotulos={columnas.map((c, i) => ({ x: xColumna(i, n), texto: c.etiqueta })).filter((_, i) => rotulos.has(i))} />
      </div>
      {leyenda ? <Leyenda items={series.map((s) => ({ color: s.color, texto: s.nombre, forma: 'barra' as const }))} /> : null}
    </Lectura>
  );
}
