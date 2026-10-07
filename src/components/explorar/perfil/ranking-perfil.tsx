import { ChevronsDown, ChevronsUp, Minus } from 'lucide-react';
import Link from 'next/link';
import { puntos as formatoPuntos } from '@/components/ranking/formato';
import { categoriaRanking } from '@/lib/ranking/categoria-nacional';
import { rutaRankingNacional, temporadaCorta } from '@/lib/ranking/url-nacional';
import { CLASES_MEDALLA, CONTORNO_MEDALLA, medallaDe } from '@/lib/sport/explorar/presentacion';
import type { ListaRankingNacional, PuntoRanking, RankingNacional } from '@/lib/sport/explorar/ranking-nacional';
import type { EntradaRankingOficial } from '@/lib/sport/explorar/tipos';
import { WEAPON_LABEL, cn } from '@/lib/utils';
import { fraccionDelante, MARCAS_PERCENTIL } from '../graficos/comun';
import { LineaTemporal, type SerieLinea } from '../graficos/linea-temporal';
import { Rejilla, Subtitulo } from '../graficos/piezas-graficos';
import { Bloque, type Nivel } from '../piezas';
import { PuntoMedalla } from './medallas';

/**
 * Pestaña «Ranking» del perfil: ranking nacional RFEE de la última temporada
 * en que figura (tarjetas con puesto y cambio), su evolución por temporadas
 * y el historial enlazado a la clasificación de cada temporada. Debajo, el
 * internacional (FIE) si lo tiene. Nunca el cálculo interno.
 */

const COLORES = ['var(--primary-text)', 'var(--org-fie)', 'var(--org-rfee)', 'var(--org-aut)', 'var(--org-efc)'];
const MAX_SERIES = 4;
const TEMPORADAS_VISIBLES = 5;

/** «Florete M20»; con una sola arma en todo su ranking, basta la categoría. */
export function nombreLista(l: Pick<ListaRankingNacional, 'arma' | 'categoria' | 'categoriaRaw'>, conArma = true): string {
  const categoria = categoriaRanking(l.categoria, l.categoriaRaw);
  return conArma ? `${WEAPON_LABEL[l.arma]} ${categoria}` : categoria;
}

const variasArmas = (r: RankingNacional) => new Set(r.listas.map((l) => l.arma)).size > 1;

const enlace = (l: ListaRankingNacional, temporada: string) =>
  rutaRankingNacional({ temporada, arma: l.arma, genero: l.genero === 'MIXTO' ? null : l.genero, categoria: l.categoriaRaw });

/** Temporadas consecutivas entre la primera y la última («2019-2020» … «2024-2025»). */
export function rangoTemporadas(temporadas: readonly string[]): string[] {
  const anios = temporadas.map((t) => Number(t.slice(0, 4))).filter(Number.isFinite);
  if (anios.length === 0) return [];
  const salida: string[] = [];
  for (let a = Math.min(...anios); a <= Math.max(...anios); a += 1) salida.push(`${a}-${a + 1}`);
  return salida;
}

export function Cambio({ lista }: { lista: Pick<ListaRankingNacional, 'cambio' | 'nueva'> }) {
  if (lista.cambio === null) {
    return lista.nueva ? (
      <span className="rounded-full border border-filete-alto px-1.5 text-[12px] leading-4 text-muted-foreground">Nuevo</span>
    ) : null;
  }
  if (lista.cambio === 0) {
    return (
      <span className="inline-flex items-center text-muted-foreground" title="Igual que la temporada anterior">
        <Minus className="size-3.5" aria-hidden />
        <span className="sr-only">Igual que la temporada anterior</span>
      </span>
    );
  }
  const sube = lista.cambio > 0;
  const Icono = sube ? ChevronsUp : ChevronsDown;
  const n = Math.abs(lista.cambio);
  const texto = `${n} ${n === 1 ? 'puesto' : 'puestos'} ${sube ? 'mejor' : 'peor'} que la temporada anterior`;
  return (
    <span className={cn('inline-flex items-center gap-0.5', sube ? 'text-ok' : 'text-warn')} title={texto}>
      <Icono className="size-4 shrink-0" strokeWidth={2.5} aria-hidden />
      <span className="cifra text-sm leading-none" aria-hidden>{n}</span>
      <span className="sr-only">{texto}</span>
    </span>
  );
}

/** Cifra grande con su rótulo debajo, como los contadores de la cabecera. */
function Cifra({ valor, rotulo, detalle }: { valor: string; rotulo: string; detalle?: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1 bg-card px-2 py-3 text-center">
      <span className="cifra text-3xl leading-none sm:text-4xl">{valor}</span>
      <span className="max-w-full truncate text-[12px] leading-none text-muted-foreground">{rotulo}</span>
      {detalle ? <span className="line-clamp-2 max-w-full text-[12px] leading-tight text-muted-foreground">{detalle}</span> : null}
    </div>
  );
}

function TarjetaActual({ lista, conArma }: { lista: ListaRankingNacional; conArma: boolean }) {
  const p = lista.ultimo;
  const medalla = medallaDe(p.puesto);
  return (
    <li className="min-w-0">
      <Link
        href={enlace(lista, p.temporada)}
        prefetch={false}
        data-lista={lista.clave}
        className={cn(
          'flex h-full min-w-0 flex-col gap-1.5 rounded-xl border bg-card px-3 py-2.5 transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none',
          medalla && CONTORNO_MEDALLA[medalla],
        )}
      >
        <span className="truncate text-xs font-medium text-foreground">{nombreLista(lista, conArma)}</span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="cifra text-4xl leading-none">{p.puesto}º</span>
          <Cambio lista={lista} />
        </span>
        <span className="flex min-w-0 flex-wrap gap-x-2 text-[12px] leading-tight text-muted-foreground">
          {p.de > 0 ? <span>de {p.de}</span> : null}
          {p.puntos !== null ? <span className="truncate">{formatoPuntos(p.puntos)} pts</span> : null}
        </span>
      </Link>
    </li>
  );
}

function lectura(l: ListaRankingNacional, p: PuntoRanking, conArma: boolean): string {
  return `${temporadaCorta(p.temporada)}  ${nombreLista(l, conArma)}  ${p.puesto}º${p.de > 0 ? ` de ${p.de}` : ''}`;
}

function Evolucion({ ranking, nivel }: { ranking: RankingNacional; nivel: Nivel }) {
  const conArma = variasArmas(ranking);
  const columnas = rangoTemporadas(ranking.temporadas);
  if (columnas.length < 2) return null;
  const elegidas = ranking.listas.filter((l) => l.serie.some((p) => p.puesto !== null)).slice(0, MAX_SERIES);
  const series: SerieLinea[] = elegidas.map((l, i) => {
    const porTemporada = new Map(l.serie.map((p) => [p.temporada, p]));
    const puntos = columnas.map((t) => porTemporada.get(t) ?? null);
    return {
      clave: l.clave,
      nombre: nombreLista(l, conArma),
      color: COLORES[i % COLORES.length],
      valores: puntos.map((p) => (p?.puesto != null ? fraccionDelante(p.puesto, p.de) ?? 0 : null)),
      lecturas: puntos.map((p) => (p?.puesto != null ? lectura(l, p, conArma) : null)),
    };
  });
  const primera = elegidas[0];
  return (
    <section aria-label="Evolución" className="flex min-w-0 flex-col gap-2">
      <Subtitulo nivel={nivel}>Evolución</Subtitulo>
      <LineaTemporal
        etiquetas={columnas.map(temporadaCorta)}
        series={series}
        escala="percentil"
        marcas={MARCAS_PERCENTIL.map((m) => ({ valor: m.p, rotulo: m.rotulo }))}
        titulo={`Puesto en el ranking nacional por temporada: ${elegidas.map((l) => nombreLista(l)).join(', ')}`}
        alto="lg"
        leyenda={series.length > 1}
        inicial={primera ? lectura(primera, primera.ultimo.puesto !== null ? primera.ultimo : primera.mejor ?? primera.ultimo, conArma) : null}
      />
    </section>
  );
}

function Historial({ ranking, nivel }: { ranking: RankingNacional; nivel: Nivel }) {
  const conArma = variasArmas(ranking);
  const temporadas = [...ranking.temporadas].reverse();
  const fila = (t: string) => {
    const chips = ranking.listas
      .flatMap((l) => l.serie.filter((p) => p.temporada === t && p.puesto !== null).map((p) => ({ l, p })))
      .sort((a, b) => (a.p.puesto ?? 0) - (b.p.puesto ?? 0));
    if (chips.length === 0) return null;
    return (
      <li key={t} className="flex min-w-0 items-start gap-3 bg-card px-3 py-2.5 sm:px-4">
        <span className="cifra w-11 shrink-0 pt-3.5 text-lg leading-none text-muted-foreground">{temporadaCorta(t)}</span>
        <ul className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {chips.map(({ l, p }) => {
            const medalla = medallaDe(p.puesto);
            return (
              <li key={l.clave} className="min-w-0">
                <Link
                  href={enlace(l, t)}
                  prefetch={false}
                  className={cn(
                    'inline-flex h-[40px] max-w-full min-w-0 items-center gap-1.5 rounded-full border border-filete-alto px-3 text-xs hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none',
                    medalla && CLASES_MEDALLA[medalla],
                  )}
                >
                  <span className="truncate">{nombreLista(l, conArma)}</span>
                  <span className="cifra text-sm leading-none">{p.puesto}º</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </li>
    );
  };
  const visibles = temporadas.slice(0, TEMPORADAS_VISIBLES);
  const resto = temporadas.slice(TEMPORADAS_VISIBLES);
  return (
    <section aria-label="Temporadas" className="flex min-w-0 flex-col gap-2">
      <Subtitulo nivel={nivel}>Temporadas</Subtitulo>
      <ol className="grid min-w-0 gap-px overflow-hidden rounded-xl border bg-border">{visibles.map(fila)}</ol>
      {resto.length > 0 ? (
        <details className="group min-w-0">
          <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-sm text-primary-text group-open:hidden">
            Ver más
          </summary>
          <ol className="grid min-w-0 gap-px overflow-hidden rounded-xl border bg-border">{resto.map(fila)}</ol>
        </details>
      ) : null}
    </section>
  );
}

export function RankingNacionalPerfil({ ranking, nivel }: { ranking: RankingNacional; nivel: Nivel }) {
  const actuales = ranking.actuales.filter((l) => l.ultimo.puesto !== null);
  if (ranking.listas.length === 0 || !ranking.mejor) return null;
  const temporadaActual = actuales[0]?.ultimo.temporada ?? null;
  const mejor = ranking.mejor;
  const conArma = variasArmas(ranking);
  return (
    <Bloque id="ficha-ranking-nacional" titulo="Ranking nacional" nivel={nivel} tituloOculto>
      <Rejilla className="grid-cols-3">
        <Cifra valor={`${mejor.puesto}º`} rotulo="Mejor" detalle={`${nombreLista(mejor.lista, conArma)} ${temporadaCorta(mejor.temporada)}`} />
        <Cifra valor={String(ranking.temporadas.length)} rotulo="Temporadas" />
        <Cifra valor={String(ranking.top10)} rotulo="Top 10" />
      </Rejilla>

      {actuales.length > 0 && temporadaActual ? (
        <section aria-label="Actual" className="flex min-w-0 flex-col gap-2">
          <Subtitulo nivel={nivel} className="flex items-center gap-2">
            {temporadaActual === ranking.vigente ? 'Actual' : 'Último'}
            <span className="font-sans text-xs font-normal text-muted-foreground">{temporadaCorta(temporadaActual)}</span>
          </Subtitulo>
          <ul className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {actuales.map((l) => <TarjetaActual key={l.clave} lista={l} conArma={conArma} />)}
          </ul>
        </section>
      ) : null}

      <Evolucion ranking={ranking} nivel={nivel} />
      <Historial ranking={ranking} nivel={nivel} />
    </Bloque>
  );
}

/** Puestos en el ranking internacional de la FIE de su última temporada. */
export function RankingMundialPerfil({ entradas, nivel }: { entradas: readonly EntradaRankingOficial[]; nivel: Nivel }) {
  const lista = entradas.filter((e) => e.puesto !== null);
  if (lista.length === 0) return null;
  return (
    <section aria-label="Ranking internacional" className="flex min-w-0 flex-col gap-2">
      <Subtitulo nivel={nivel} className="flex items-center gap-2">
        Internacional
        <span className="font-sans text-xs font-normal text-muted-foreground">
          {/^\d{4}$/.test(lista[0].temporada) ? temporadaCorta(`${Number(lista[0].temporada) - 1}-${lista[0].temporada}`) : lista[0].temporada}
        </span>
      </Subtitulo>
      <ul className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {lista.map((e) => {
          const medalla = medallaDe(e.puesto);
          return (
            <li
              key={`${e.arma}-${e.genero}-${e.categoria.raw}`}
              className={cn('flex min-w-0 flex-col gap-1.5 rounded-xl border bg-card px-3 py-2.5', medalla && CONTORNO_MEDALLA[medalla])}
            >
              <span className="truncate text-xs font-medium">{WEAPON_LABEL[e.arma]} {categoriaRanking(e.categoria.codigo, e.categoria.codigo)}</span>
              <span className="flex items-center gap-1.5">
                {medalla ? <PuntoMedalla medalla={medalla} className="size-2.5" /> : null}
                <span className="cifra text-4xl leading-none">{e.puesto}º</span>
              </span>
              {e.puntos !== null && Number.isFinite(Number(e.puntos)) ? (
                <span className="text-[12px] leading-tight text-muted-foreground">{formatoPuntos(Number(e.puntos))} pts</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
