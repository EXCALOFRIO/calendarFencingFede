import { puntos as formatoPuntos } from '@/components/ranking/formato';
import { categoriaRanking } from '@/lib/ranking/categoria-nacional';
import { temporadaCorta } from '@/lib/ranking/url-nacional';
import { CLASES_MEDALLA, CONTORNO_MEDALLA, medallaDe } from '@/lib/sport/explorar/presentacion';
import type {
  BloqueRankingInternacional,
  PuestoInternacional,
  SerieInternacional,
} from '@/lib/sport/explorar/ranking-internacional';
import { WEAPON_LABEL, cn } from '@/lib/utils';
import { Subtitulo } from '../graficos/piezas-graficos';
import type { Nivel } from '../piezas';
import { PuntoMedalla } from './medallas';

/**
 * Un bloque de la pestaña «Ranking» con lo que publica un organismo de fuera
 * (FIE, EFC o la federación de un extranjero): puestos de la temporada
 * vigente, o el mejor de su carrera si ya no figura, y una fila por lista con
 * sus temporadas. Compacto: sin gráfica.
 */

const SERIES_VISIBLES = 3;
const TEMPORADAS_POR_SERIE = 6;

/** «2024» (FIE) y «2023-2024» se leen igual: «23-24». */
const temporadaDe = (p: Pick<PuestoInternacional, 'anioFin'>) => temporadaCorta(`${p.anioFin - 1}-${p.anioFin}`);

const nombreSerie = (s: Pick<SerieInternacional, 'arma' | 'categoria'>, conArma: boolean) => {
  const categoria = categoriaRanking(s.categoria, s.categoria);
  return conArma ? `${WEAPON_LABEL[s.arma]} ${categoria}` : categoria;
};

export function SeccionRanking({
  titulo,
  detalle,
  nivel,
  children,
}: {
  titulo: string;
  detalle?: string;
  nivel: Nivel;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={titulo} data-bloque-ranking={titulo} className="flex min-w-0 flex-col gap-3">
      <Subtitulo nivel={nivel} className="flex items-center gap-2">
        {titulo}
        {detalle ? <span className="font-sans text-xs font-normal text-muted-foreground">{detalle}</span> : null}
      </Subtitulo>
      {children}
    </section>
  );
}

function TarjetaPuesto({ p, conArma }: { p: PuestoInternacional; conArma: boolean }) {
  const medalla = medallaDe(p.puesto);
  return (
    <li className={cn('flex min-w-0 flex-col gap-1 rounded-xl border bg-card px-3 py-2', medalla && CONTORNO_MEDALLA[medalla])}>
      <span className="truncate text-xs font-medium">{nombreSerie(p, conArma)}</span>
      <span className="flex items-center gap-1.5">
        {medalla ? <PuntoMedalla medalla={medalla} className="size-2.5" /> : null}
        <span className="cifra text-3xl leading-none">{p.puesto}º</span>
      </span>
      <span className="flex min-w-0 flex-wrap gap-x-2 text-[0.6875rem] leading-tight text-muted-foreground">
        {p.de ? <span>de {p.de}</span> : null}
        {p.puntos !== null ? <span className="truncate">{formatoPuntos(p.puntos)} pts</span> : null}
      </span>
    </li>
  );
}

function FilaSerie({ s, conArma }: { s: SerieInternacional; conArma: boolean }) {
  const puestos = [...s.serie].filter((p) => p.puesto !== null).reverse();
  if (puestos.length === 0) return null;
  const visibles = puestos.slice(0, TEMPORADAS_POR_SERIE);
  return (
    <li className="flex min-w-0 flex-col gap-1.5 bg-card px-3 py-2.5 sm:flex-row sm:items-start sm:gap-3">
      <span className="min-w-0 truncate pt-1 text-xs font-medium sm:w-36 sm:shrink-0">
        {nombreSerie(s, conArma)}
        {s.mejor?.puesto ? <span className="font-normal text-muted-foreground"> · mejor {s.mejor.puesto}º</span> : null}
      </span>
      <ul className="flex min-w-0 flex-1 flex-wrap gap-1">
        {visibles.map((p) => {
          const medalla = medallaDe(p.puesto);
          return (
            <li
              key={`${p.fuente}-${p.anioFin}`}
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-full border border-filete-alto px-2 text-[0.6875rem]',
                medalla && CLASES_MEDALLA[medalla],
              )}
            >
              <span className="text-muted-foreground">{temporadaDe(p)}</span>
              <span className="cifra text-xs leading-none">{p.puesto}º</span>
            </li>
          );
        })}
        {puestos.length > visibles.length ? (
          <li className="inline-flex h-6 items-center px-1 text-[0.6875rem] text-muted-foreground">+{puestos.length - visibles.length}</li>
        ) : null}
      </ul>
    </li>
  );
}

export function RankingAmbitoPerfil({
  titulo,
  bloque,
  nivel,
}: {
  titulo: string;
  bloque: BloqueRankingInternacional;
  nivel: Nivel;
}) {
  const series = bloque.series.filter((s) => s.serie.some((p) => p.puesto !== null));
  const actual = bloque.actual.filter((p) => p.puesto !== null).slice(0, 4);
  const mejor = bloque.mejor?.puesto != null ? bloque.mejor : null;
  if (series.length === 0 && actual.length === 0 && !mejor) return null;
  const conArma = new Set([...series, ...actual].map((s) => s.arma)).size > 1;
  const visibles = series.slice(0, SERIES_VISIBLES);
  const resto = series.slice(SERIES_VISIBLES);
  return (
    <SeccionRanking titulo={titulo} detalle={bloque.organismos.join(' · ')} nivel={nivel}>
      {actual.length > 0 ? (
        <ul aria-label={`Actual ${temporadaDe(actual[0])}`} className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {actual.map((p) => <TarjetaPuesto key={`${p.fuente}-${p.arma}-${p.categoriaRaw}`} p={p} conArma={conArma} />)}
        </ul>
      ) : mejor ? (
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm" data-mejor-ranking>
          <span className="text-muted-foreground">Mejor</span>
          <span className="cifra text-lg leading-none">{mejor.puesto}º</span>
          <span className="text-muted-foreground">{nombreSerie(mejor, true)} · {temporadaDe(mejor)}</span>
        </p>
      ) : null}
      {visibles.length > 0 ? (
        <ol aria-label="Temporadas" className="grid min-w-0 gap-px overflow-hidden rounded-xl border bg-border">
          {visibles.map((s) => <FilaSerie key={s.clave} s={s} conArma={conArma} />)}
        </ol>
      ) : null}
      {resto.length > 0 ? (
        <details className="group min-w-0">
          <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-sm text-primary-text group-open:hidden">
            Ver más listas
          </summary>
          <ol className="grid min-w-0 gap-px overflow-hidden rounded-xl border bg-border">
            {resto.map((s) => <FilaSerie key={s.clave} s={s} conArma={conArma} />)}
          </ol>
        </details>
      ) : null}
    </SeccionRanking>
  );
}

/** Europeo (EFC): llega en diferido, no lo necesita la cabecera. */
export async function EuropeoDiferido({
  promesa,
  nivel,
  vacio = null,
}: {
  promesa: Promise<BloqueRankingInternacional | null>;
  nivel: Nivel;
  /** Lo que sale si no llega el bloque (cuando la pestaña sólo tenía el europeo). */
  vacio?: React.ReactNode;
}) {
  const bloque = await promesa;
  return bloque ? <RankingAmbitoPerfil titulo="Europeo" bloque={bloque} nivel={nivel} /> : vacio;
}
