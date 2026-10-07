import { cn } from '@/lib/utils';
import { indicesRotulo, xColumna } from './comun';
import { ALTO, EjeX, Leyenda, type Alto } from './eje';
import { Lectura } from './lectura';

export type ColumnaDivergente = {
  etiqueta: string;
  arriba: number;
  abajo: number;
  lectura?: string | null;
};

/**
 * Dos cantidades enfrentadas por columna: una crece hacia arriba desde el
 * eje y la otra hacia abajo (victorias frente a derrotas por temporada). Las
 * cifras van en el extremo de cada barra.
 */
export function BarrasDivergentes({
  columnas,
  titulo,
  arriba,
  abajo,
  alto = 'md',
  inicial,
  className,
}: {
  columnas: ColumnaDivergente[];
  titulo: string;
  arriba: { nombre: string; color: string };
  abajo: { nombre: string; color: string };
  alto?: Alto;
  inicial?: string | null;
  className?: string;
}) {
  const n = columnas.length;
  if (n === 0) return null;
  const tope = Math.max(1, ...columnas.flatMap((c) => [c.arriba, c.abajo]));
  const rotulos = indicesRotulo(n);
  const cifras = n <= 24;
  return (
    <Lectura inicial={inicial} className={className}>
      <div role="img" aria-label={titulo} className="flex min-w-0 flex-col gap-1">
        <div className={cn('relative flex gap-px py-3.5', ALTO[alto])}>
          <div aria-hidden className="absolute inset-x-0 top-1/2 border-t border-filete-alto" />
          {columnas.map((c, i) => (
            <div key={`${c.etiqueta}-${i}`} data-lectura={c.lectura ?? undefined} className="relative flex min-w-0 flex-1 flex-col items-center">
              <div className="flex w-full flex-1 flex-col items-center justify-end">
                {cifras && c.arriba > 0 ? <span className="cifra mb-0.5 text-[12px] leading-none">{c.arriba}</span> : null}
                <span className="block w-full max-w-6 shrink-0 rounded-t-[2px]" style={{ height: `${(c.arriba / tope) * 100}%`, background: arriba.color }} />
              </div>
              <div className="flex w-full flex-1 flex-col items-center justify-start">
                <span className="block w-full max-w-6 shrink-0 rounded-b-[2px]" style={{ height: `${(c.abajo / tope) * 100}%`, background: abajo.color }} />
                {cifras && c.abajo > 0 ? <span className="cifra mt-0.5 text-[12px] leading-none text-muted-foreground">{c.abajo}</span> : null}
              </div>
            </div>
          ))}
        </div>
        <EjeX rotulos={columnas.map((c, i) => ({ x: xColumna(i, n), texto: c.etiqueta })).filter((_, i) => rotulos.has(i))} />
      </div>
      <Leyenda items={[{ ...arriba, texto: arriba.nombre, forma: 'barra' }, { ...abajo, texto: abajo.nombre, forma: 'barra' }]} />
    </Lectura>
  );
}
