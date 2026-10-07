import { categoriaVisible, ordenCategoriaVisible } from '@/lib/sport/explorar/presentacion';
import { Bloque, type Nivel } from '../piezas';
import { Medallero } from './medallas';

/** Lo mínimo de cada categoría para su tarjeta; sirve tanto a la lectura por prueba como al desglose antiguo. */
export type ResumenCategoria = {
  /** Código normalizado (`ABS`, `M20`…), nunca el literal de la fuente. */
  clave: string;
  competiciones: number;
  mejorPuesto: number | null;
  finales?: number | null;
  oros: number;
  /** `null` si la lectura no separa platas y bronces (sólo trae podios). */
  platas: number | null;
  bronces: number | null;
  podios?: number;
};

/**
 * Una tarjeta por categoría deportiva, agrupada por el código normalizado:
 * «S», «SENIOR» o «ABS» son la misma categoría Absoluto. Pruebas, mejor
 * puesto, finales y medallas con su color.
 */
export function CategoriasPerfil({ categorias, nivel }: { categorias: readonly ResumenCategoria[]; nivel: Nivel }) {
  const lista = [...categorias]
    .filter((c) => c.competiciones > 0)
    .sort((a, b) => ordenCategoriaVisible(a.clave) - ordenCategoriaVisible(b.clave));
  if (lista.length === 0) return null;
  return (
    <Bloque id="ficha-categorias" titulo="Por categoría" nivel={nivel}>
      <ul className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" aria-label="Resultados por categoría">
        {lista.map((c) => (
          <li key={c.clave} data-categoria={c.clave} className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-3 sm:p-4">
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
              <span className="min-w-0 break-words text-sm font-semibold">{categoriaVisible(c.clave)}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                <span className="cifra text-lg text-foreground">{c.competiciones}</span> {c.competiciones === 1 ? 'prueba' : 'pruebas'}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-2">
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-[12px] leading-none text-muted-foreground">Mejor</dt>
                <dd className="cifra text-3xl leading-none">{c.mejorPuesto !== null ? `${c.mejorPuesto}º` : '—'}</dd>
              </div>
              {c.finales != null ? (
                <div className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-[12px] leading-none text-muted-foreground">Top 8</dt>
                  <dd className="cifra text-3xl leading-none">{c.finales}</dd>
                </div>
              ) : c.podios != null ? (
                <div className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-[12px] leading-none text-muted-foreground">Podios</dt>
                  <dd className="cifra text-3xl leading-none">{c.podios}</dd>
                </div>
              ) : null}
            </dl>
            {c.platas !== null && c.bronces !== null ? (
              <Medallero oros={c.oros} platas={c.platas} bronces={c.bronces} />
            ) : null}
          </li>
        ))}
      </ul>
    </Bloque>
  );
}
