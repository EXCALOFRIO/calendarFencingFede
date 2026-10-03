'use client';

import { ChevronsDown, ChevronsUp, Minus } from 'lucide-react';
import * as React from 'react';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel';
import { cn } from '@/lib/utils';
import { puntos as formatoPuntos } from './formato';

/**
 * ===========================================================================
 * SEGUIMIENTO POR TEMPORADAS
 * ===========================================================================
 *
 * Copiado del «World Ranking Tracker» de `fie.org/athletes/39653`, que es la
 * referencia 3.2 y la que había que copiar con más ganas: resuelve una
 * petición que el usuario ha hecho dos veces —ver su evolución y poder cambiar
 * de ranking— y la resuelve mejor que una tabla.
 *
 * Lo que se copia, mirado en la captura y no de memoria
 * (`capturas/ref/fie-escritorio-tira.png`):
 *
 * - Una **tira horizontal de tarjetas, una por temporada**, de la más reciente
 *   a la más vieja. No una tabla: una tabla de 19 filas de dos números cada
 *   una no se lee, y la tira se recorre con el pulgar.
 * - El **puesto en grande** arriba con la almohadilla pequeña delante, y la
 *   **categoría debajo en pequeño** con la barra apagada delante (`/ Absoluto`).
 * - Una **flecha de tendencia**: verde hacia arriba si mejoró, ámbar hacia
 *   abajo si empeoró.
 * - La **temporada abajo a la derecha**, apagada.
 * - **Botones redondos de anterior y siguiente** arriba a la derecha.
 *
 * ---------------------------------------------------------------------------
 * EL TERCER ESTADO, QUE ES LA PARTE LISTA
 * ---------------------------------------------------------------------------
 * Cuando no hay temporada anterior con la que comparar, la FIE pone un
 * **círculo de puntos** en lugar de una flecha. Eso es no inventarse una
 * tendencia, y encaja exactamente con la regla del proyecto: un dato que no se
 * sabe se dice. Se copia tal cual.
 *
 * Y se añade un cuarto caso que la FIE no distingue y aquí sí, porque
 * `ranking.ts` ya lo distingue en su tipo `change`: **quedarse igual** no es lo
 * mismo que **no tener con qué comparar**. El primero lleva una raya, el
 * segundo el círculo de puntos. Las dos son formas neutras, sin color.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ LA FLECHA VA PEGADA AL PUESTO Y NO A LOS PUNTOS
 * ---------------------------------------------------------------------------
 * Es la única desviación deliberada de la referencia. La FIE pone la flecha al
 * lado de los puntos, y eso deja el cartel ambiguo: el titular de la tarjeta es
 * el puesto, así que la flecha se lee como «he subido de puesto» aunque esté
 * midiendo puntos. Se pueden mover en direcciones contrarias —ganar puntos y
 * perder puesto porque los de delante ganaron más— y entonces la tarjeta
 * mentiría. Aquí la flecha va junto al puesto, con los puestos ganados o
 * perdidos escritos al lado, y los puntos quedan debajo como cifra
 * secundaria. Misma composición, sin la ambigüedad.
 *
 * El color **nunca es la única señal**: va la flecha, que es forma, y va el
 * número de puestos, que es texto. Requisito de accesibilidad del proyecto.
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

type Tendencia =
  | { tipo: 'mejor'; puestos: number }
  | { tipo: 'peor'; puestos: number }
  | { tipo: 'igual' }
  | { tipo: 'sin-referencia' };

/**
 * Tendencia de una temporada respecto a la siguiente de la lista, que es la
 * anterior en el tiempo (la tira va de más reciente a más vieja).
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
  if (temporadas.length === 0) return null;

  return (
    <Carousel
      opts={{ align: 'start', dragFree: true, containScroll: 'trimSnaps' }}
      className={cn('flex min-w-0 flex-col gap-3', className)}
      aria-label={titulo}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-lg sm:text-xl">{titulo}</h3>
          {contexto ? (
            <p className="medida text-xs text-muted-foreground">{contexto}</p>
          ) : null}
        </div>
        {/*
          Los botones redondos van aquí arriba y no flotando a los lados de la
          tira, que es donde los pone shadcn por defecto: a la izquierda se
          saldrían del ancho de la aplicación y en un móvil taparían la
          primera tarjeta. Es también donde los pone la FIE.
        */}
        <div className="flex shrink-0 gap-2">
          <CarouselPrevious className="static size-11 translate-y-0 rounded-full" aria-label="Temporadas anteriores en la tira" />
          <CarouselNext className="static size-11 translate-y-0 rounded-full" aria-label="Temporadas siguientes en la tira" />
        </div>
      </div>

      <CarouselContent className="-ml-2">
        {temporadas.map((t, i) => (
          <CarouselItem
            key={t.id}
            /*
              Anchos en fracciones, no fijos: en un iPhone se ven dos tarjetas
              y un trozo de la tercera, que es lo que dice «esto se arrastra»
              sin necesidad de explicarlo.
            */
            className="basis-[44%] pl-2 sm:basis-[30%] md:basis-[22%] lg:basis-[16.6%]"
          >
            <Tarjeta
              temporada={t}
              tendencia={tendenciaDe(t, temporadas[i + 1])}
              destacada={i === 0}
            />
          </CarouselItem>
        ))}
      </CarouselContent>
    </Carousel>
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
        // Filete de luz arriba, como el canto de una chapa. No sombra.
        'flex h-full min-h-40 flex-col gap-2 border-t bg-secondary px-3 py-3',
        destacada ? 'border-t-primary/60' : 'border-t-filete',
      )}
    >
      <span className="sr-only">{frase(temporada, tendencia)}</span>

      <div aria-hidden className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
          <span className="flex items-baseline">
            <span className="text-sm text-muted-foreground">#</span>
            <span className="cifra text-4xl">{temporada.puesto ?? '—'}</span>
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
        <span className="size-4 rounded-full border-2 border-dashed border-muted-foreground/70" />
      </span>
    );
  }

  if (tendencia.tipo === 'igual') {
    return (
      <span
        title="Mismo puesto que la temporada anterior"
        className="inline-flex items-center gap-0.5 text-muted-foreground"
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
        'inline-flex items-center gap-0.5',
        mejor ? 'text-ok' : 'text-warn',
      )}
    >
      <Icono className="size-4 shrink-0" strokeWidth={2.5} />
      <span className="cifra text-sm">{tendencia.puestos}</span>
    </span>
  );
}
