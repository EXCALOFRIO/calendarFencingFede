'use client';

import { ChevronsDown, ChevronsUp, Minus } from 'lucide-react';
import * as React from 'react';
import { CabeceraSeccion, VerMas } from '@/components/sistema/cabecera-seccion';
import { cn } from '@/lib/utils';
import { puntos as formatoPuntos } from './formato';

/**
 * ===========================================================================
 * SEGUIMIENTO POR TEMPORADAS
 * ===========================================================================
 *
 * Inspirado en el «World Ranking Tracker» de `fie.org/athletes/39653`
 * (`capturas/ref/fie-escritorio-tira.png`): una tarjeta por temporada, de la
 * más reciente a la más vieja, con el **puesto en grande**, la **categoría
 * debajo** (`/ Absoluto`), una **flecha de tendencia** y la temporada abajo.
 *
 * La FIE las pone en una tira que se arrastra en horizontal; aquí van en una
 * rejilla de dos o tres columnas, porque en la aplicación nada se desplaza en
 * horizontal (en un móvil de 360 px lo escondido a la derecha no se
 * descubre). Se ven las seis más recientes y el resto detrás de «Ver más».
 *
 * ---------------------------------------------------------------------------
 * EL TERCER ESTADO
 * ---------------------------------------------------------------------------
 * Sin temporada anterior con la que comparar, la FIE pone un **círculo de
 * puntos** en lugar de una flecha: no se inventa una tendencia. Y se añade un
 * cuarto caso que la FIE no distingue: **quedarse igual** (una raya) no es lo
 * mismo que **no tener con qué comparar** (el círculo). Las dos, sin color.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ LA FLECHA VA PEGADA AL PUESTO Y NO A LOS PUNTOS
 * ---------------------------------------------------------------------------
 * La FIE pone la flecha al lado de los puntos, y el titular de la tarjeta es
 * el puesto: se lee «he subido de puesto» aunque mida puntos, y los dos pueden
 * moverse en sentidos contrarios. Aquí la flecha va junto al puesto, con los
 * puestos ganados o perdidos escritos al lado.
 *
 * El color **nunca es la única señal**: va la flecha, que es forma, y el
 * número de puestos, que es texto.
 */

export type TemporadaRanking = {
  /** Clave estable para React. */
  id: string;
  /** Como lo publica la fuente: «2026/2027» o «2026». */
  temporada: string;
  /** `null` cuando aparece en la lista pero sin clasificar. */
  puesto: number | null;
  /** Nombre legible de la categoría: «Absoluto», «Júnior». */
  categoria: string;
  /** `null` cuando la fuente no publica puntos. */
  puntos: number | null;
  /** Nº de pruebas que le puntuaron. `null` si la fuente no lo da. */
  pruebas?: number | null;
};

/** Las temporadas que se ven sin tocar «Ver más»: dos filas de tres, tres de dos. */
const VISIBLES = 6;

type Tendencia =
  | { tipo: 'mejor'; puestos: number }
  | { tipo: 'peor'; puestos: number }
  | { tipo: 'igual' }
  | { tipo: 'sin-referencia' };

/**
 * Tendencia de una temporada respecto a la siguiente de la lista, que es la
 * anterior en el tiempo (la lista va de más reciente a más vieja).
 *
 * Subir en el ranking es bajar de número, así que la resta se hace al revés
 * para que «mejor» signifique lo que la gente espera. Es la misma inversión
 * que ya hace `change` en `src/lib/queries/ranking.ts`.
 */
function tendenciaDe(
  actual: TemporadaRanking,
  anterior: TemporadaRanking | undefined,
): Tendencia {
  if (!anterior || actual.puesto === null || anterior.puesto === null) {
    return { tipo: 'sin-referencia' };
  }
  const diferencia = anterior.puesto - actual.puesto;
  if (diferencia > 0) return { tipo: 'mejor', puestos: diferencia };
  if (diferencia < 0) return { tipo: 'peor', puestos: -diferencia };
  return { tipo: 'igual' };
}

/** Frase entera de una tarjeta, para quien la escuche en vez de verla. */
function frase(t: TemporadaRanking, tendencia: Tendencia): string {
  const puesto =
    t.puesto === null
      ? 'sin clasificar'
      : `puesto ${t.puesto} en ${t.categoria.toLowerCase()}`;

  const movimiento =
    tendencia.tipo === 'mejor'
      ? `, ${tendencia.puestos} ${tendencia.puestos === 1 ? 'puesto' : 'puestos'} mejor que la temporada anterior`
      : tendencia.tipo === 'peor'
        ? `, ${tendencia.puestos} ${tendencia.puestos === 1 ? 'puesto' : 'puestos'} peor que la temporada anterior`
        : tendencia.tipo === 'igual'
          ? ', igual que la temporada anterior'
          : ', sin temporada anterior con la que comparar';

  const marcador =
    t.puntos === null ? ', puntos no publicados' : `, ${formatoPuntos(t.puntos)} puntos`;

  return `Temporada ${t.temporada}: ${puesto}${movimiento}${marcador}.`;
}

export function TiraTemporadas({
  temporadas,
  titulo = 'Seguimiento por temporadas',
  /** Se pinta debajo del título: de dónde salen estos puestos. */
  contexto,
  className,
}: {
  /** De la más reciente a la más vieja. */
  temporadas: TemporadaRanking[];
  titulo?: string;
  contexto?: React.ReactNode;
  className?: string;
}) {
  const [todas, setTodas] = React.useState(false);
  if (temporadas.length === 0) return null;
  const visibles = todas ? temporadas : temporadas.slice(0, VISIBLES);
  const quedan = temporadas.length - visibles.length;

  return (
    <section aria-label={titulo} className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <CabeceraSeccion titulo={titulo} como="h3" />
        {contexto ? <p className="medida text-xs text-muted-foreground">{contexto}</p> : null}
      </div>

      <ol className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
        {visibles.map((t, i) => (
          <li key={t.id} className="min-w-0">
            <Tarjeta
              temporada={t}
              tendencia={tendenciaDe(t, temporadas[i + 1])}
              destacada={i === 0}
            />
          </li>
        ))}
      </ol>

      {quedan > 0 ? (
        <VerMas onClick={() => setTodas(true)} cuenta={quedan} detalle="temporadas" className="self-center" />
      ) : null}
    </section>
  );
}

function Tarjeta({
  temporada,
  tendencia,
  destacada,
}: {
  temporada: TemporadaRanking;
  tendencia: Tendencia;
  /** La temporada en curso, que es la que se mira primero. */
  destacada: boolean;
}) {
  return (
    <article
      className={cn(
        'flex h-full min-h-40 flex-col gap-2 rounded-xl border bg-card p-3',
        destacada ? 'border-primary' : 'border-border',
      )}
    >
      <span className="sr-only">{frase(temporada, tendencia)}</span>

      <div aria-hidden className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="flex items-baseline">
            <span className="text-sm text-muted-foreground">#</span>
            <span className="cifra text-3xl">{temporada.puesto ?? '—'}</span>
          </span>
          <Flecha tendencia={tendencia} />
        </div>

        <p className="flex min-w-0 items-baseline gap-1 text-xs text-muted-foreground">
          <span aria-hidden>/</span>
          <span className="min-w-0 break-words">{temporada.categoria}</span>
        </p>
      </div>

      {/* Los puntos, empujados abajo: la cifra secundaria de la tarjeta. */}
      <div aria-hidden className="mt-auto flex flex-col">
        <span className="cifra text-lg">
          {temporada.puntos === null ? '—' : formatoPuntos(temporada.puntos)}
        </span>
        <span className="text-xs text-muted-foreground">
          {temporada.puntos === null ? 'puntos no publicados' : 'puntos'}
          {temporada.pruebas !== null && temporada.pruebas !== undefined ? (
            <span className="block">{temporada.pruebas} pruebas</span>
          ) : null}
        </span>
      </div>

      <p aria-hidden className="mt-1 text-right text-xs text-muted-foreground">
        {temporada.temporada}
      </p>
    </article>
  );
}

/**
 * La tendencia, en forma y en color a la vez.
 *
 * Las cuatro salidas tienen **forma distinta**, así que se distinguen en
 * escala de grises y con daltonismo: flecha doble arriba, flecha doble abajo,
 * raya, y círculo de puntos.
 */
function Flecha({ tendencia }: { tendencia: Tendencia }) {
  if (tendencia.tipo === 'sin-referencia') {
    return (
      <span
        title="Sin temporada anterior con la que comparar"
        className="inline-flex items-center"
      >
        {/* El círculo de puntos de la FIE: no hay tendencia que enseñar. */}
        <span className="size-4 rounded-full border-2 border-dashed border-muted-foreground" />
      </span>
    );
  }

  if (tendencia.tipo === 'igual') {
    return (
      <span
        title="Mismo puesto que la temporada anterior"
        className="inline-flex items-center gap-1 text-muted-foreground"
      >
        <Minus className="size-4 shrink-0" />
        <span className="text-xs">igual</span>
      </span>
    );
  }

  const mejor = tendencia.tipo === 'mejor';
  const Icono = mejor ? ChevronsUp : ChevronsDown;

  return (
    <span
      title={
        mejor
          ? `${tendencia.puestos} puestos mejor que la temporada anterior`
          : `${tendencia.puestos} puestos peor que la temporada anterior`
      }
      className={cn(
        'inline-flex items-center gap-1',
        mejor ? 'text-ok' : 'text-warn',
      )}
    >
      <Icono className="size-4 shrink-0" strokeWidth={2.5} />
      <span className="cifra text-sm">{tendencia.puestos}</span>
    </span>
  );
}
