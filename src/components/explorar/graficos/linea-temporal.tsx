import { cn } from '@/lib/utils';
import { camino, decimal, indicesRotulo, marcasRedondas, tinte, tramos, xColumna, yPercentil } from './comun';
import { ALTO, EjeX, Guias, Leyenda, Lienzo, Punto, type Alto } from './eje';
import { Lectura } from './lectura';

export type SerieLinea = {
  clave: string;
  nombre: string;
  /** Variable CSS del tema (`var(--…)`). */
  color: string;
  /** Un valor por columna; `null` deja hueco. */
  valores: (number | null)[];
  area?: boolean;
  discontinua?: boolean;
  /** Texto de lectura de cada punto. */
  lecturas?: (string | null)[];
};

/**
 * Líneas por columnas (temporadas). Cada valor cae en el centro de su
 * columna, igual que las barras, para que dos gráficas apiladas casen.
 *
 * `escala='percentil'` pinta valores 0–1 con 0 arriba y raíz cuadrada (puesto
 * relativo: arriba es mejor); `lineal` va de `min` (abajo) a `max` (arriba).
 */
export function LineaTemporal({
  etiquetas,
  series,
  titulo,
  escala = 'lineal',
  min = 0,
  max,
  marcas = [],
  alto = 'md',
  inicial,
  leyenda = series.length > 1,
  className,
}: {
  etiquetas: string[];
  series: SerieLinea[];
  /** Resumen corto para lectores de pantalla. */
  titulo: string;
  escala?: 'lineal' | 'percentil';
  min?: number;
  max?: number;
  marcas?: { valor: number; rotulo?: string }[];
  alto?: Alto;
  inicial?: string | null;
  leyenda?: boolean;
  className?: string;
}) {
  const n = etiquetas.length;
  const todos = series.flatMap((s) => s.valores.filter((v): v is number => v !== null));
  const tope = max ?? Math.max(min + 1, ...todos) * 1.08;
  const y = (v: number) =>
    escala === 'percentil' ? yPercentil(v) : 100 - ((Math.min(tope, Math.max(min, v)) - min) / (tope - min)) * 100;
  const rotulos = indicesRotulo(n);
  // Sin guías pedidas, un eje lineal lleva dos o tres valores redondos para poder leerlo.
  const guias = marcas.length > 0 || escala === 'percentil'
    ? marcas
    : marcasRedondas(min, tope).map((v) => ({ valor: v, rotulo: decimal(v).replace(/,0$/, '') }));
  return (
    <Lectura inicial={inicial} datos={series.flatMap((s) => s.lecturas ?? [])} className={className}>
      <div role="img" aria-label={titulo} className="flex min-w-0 flex-col gap-1">
        <div className={cn('relative mt-3', ALTO[alto])}>
          <Guias
            marcas={[
              ...guias.map((m) => ({ y: y(m.valor), rotulo: m.rotulo })),
              { y: escala === 'percentil' ? 100 : y(min), fuerte: true },
            ]}
          />
          <Lienzo>
            {series.map((s) => {
              const ps = s.valores.map((v, i) => (v === null ? null : { x: xColumna(i, n), y: y(v) }));
              return tramos(ps).map((t, j) => (
                <g key={`${s.clave}-${j}`}>
                  {s.area && t.length > 1 ? (
                    <path
                      d={`${camino(t)} L${t[t.length - 1].x.toFixed(2)} 100 L${t[0].x.toFixed(2)} 100 Z`}
                      style={{ fill: tinte(s.color, 9) }}
                    />
                  ) : null}
                  {/* Color por `style`: una variable CSS no vale en un atributo de presentación SVG. */}
                  <path
                    d={camino(t)}
                    fill="none"
                    style={{ stroke: s.color }}
                    strokeWidth={s.discontinua ? 1.5 : 2}
                    strokeDasharray={s.discontinua ? '4 3' : undefined}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              ));
            })}
          </Lienzo>
          {series.map((s) =>
            s.valores.map((v, i) =>
              v === null ? null : (
                <Punto
                  key={`${s.clave}-${i}`}
                  x={xColumna(i, n)}
                  y={y(v)}
                  color={s.color}
                  tamano={s.discontinua ? 5 : 6}
                  lectura={s.lecturas?.[i] ?? null}
                />
              ),
            ),
          )}
        </div>
        <EjeX rotulos={etiquetas.map((t, i) => ({ x: xColumna(i, n), texto: t })).filter((_, i) => rotulos.has(i))} />
      </div>
      {leyenda ? <Leyenda items={series.map((s) => ({ color: s.color, texto: s.nombre, forma: 'linea' as const }))} /> : null}
    </Lectura>
  );
}
