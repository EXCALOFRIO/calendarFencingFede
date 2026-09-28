'use client';

import {
  ChevronDown,
  CircleCheck,
  ExternalLink,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import type {
  CortePropio,
  PuestoTemporada,
} from '@/app/(app)/estado/consultas';
import { Escudo } from '@/components/escudo';
import { puntos as formatoPuntos } from '@/components/ranking/formato';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { PuestoOficial } from '@/lib/queries/ranking';
import {
  CATEGORY_LABEL,
  GENDER_LABEL,
  WEAPON_LABEL,
  cn,
  formatDateEs,
} from '@/lib/utils';
import { CeldaMarcador, Marcador, Rotulos, Seccion } from './piezas';

/**
 * ===========================================================================
 * «¿CÓMO VOY?»: EL PUESTO, LOS PUNTOS Y —POR FIN— LA DISTANCIA AL CORTE
 * ===========================================================================
 *
 * El hueco que cierra este bloque estaba medido: `/ranking` decía «a cuántos
 * puntos estás del corte» y esta pantalla no, aunque es la que abre un tirador
 * (o su padre) para saber cómo va. Y es el dato que convierte un puesto en una
 * decisión: a dos puntos del corte se va al siguiente torneo, a doscientos se
 * planifica la temporada.
 *
 * Dos números y se dice cuál es cuál, igual que en `/ranking`:
 *
 *   - **el OFICIAL** de la RFEE, que es el que la gente reconoce y el que
 *     decide convocatorias. Es lo que se enseña abierto.
 *   - **el cálculo de la aplicación**, que es lo único auditable prueba a
 *     prueba. Va plegado, porque no se usa para decidir nada: se usa para
 *     contestar «¿por qué no me cuenta aquella prueba?».
 *
 * Presentarlos juntos y sin etiqueta sería peor que no tener ninguno.
 */
export function ComoVoy({
  oficiales,
  cortes,
  internos,
  tiradores,
  conNombre,
}: {
  /** Clasificación OFICIAL de la RFEE. */
  oficiales: PuestoOficial[];
  /** A cuánto del corte, calculado con la misma función que `/ranking`. */
  cortes: CortePropio[];
  /** Cálculo INTERNO de la aplicación (`ranking_snapshot`). */
  internos: PuestoTemporada[];
  tiradores: { id: string; nombre: string }[];
  conNombre: boolean;
}) {
  const leidoEl = oficiales[0]?.actualizadoEl ?? null;

  return (
    <Seccion
      titulo="Cómo voy"
      contexto={
        oficiales.length > 0
          ? `Clasificación oficial de la RFEE ${oficiales[0].seasonLabel}`
          : 'Clasificación oficial de la RFEE'
      }
    >
      {oficiales.length === 0 ? (
        <p className="medida py-4 text-sm text-muted-foreground">
          {/*
            «No apareces todavía», no «no hay ranking»: el ranking oficial
            existe y tiene cientos de tiradores. Lo que falta es una fila suya
            emparejada con su licencia, que es otra cosa y se arregla de otra
            forma.
          */}
          {conNombre
            ? 'Ninguno de tus tiradores aparece todavía en la clasificación oficial de la RFEE. '
            : 'Todavía no apareces en la clasificación oficial de la RFEE. '}
          Pasa cuando no se ha puntuado esta temporada, o cuando la licencia de
          la ficha no coincide con la que publica la federación.{' '}
          <Link href="/ranking" className="underline underline-offset-2 transition-colors hover:text-foreground">
            Ver la clasificación
          </Link>
          .
        </p>
      ) : (
        <div className="flex flex-col gap-5 pt-4">
          {oficiales.map((p) => (
            <Clasificacion
              key={`${p.athleteId}-${p.weapon}-${p.gender}-${p.categoryRaw}`}
              puesto={p}
              corte={
                cortes.find(
                  (c) =>
                    c.athleteId === p.athleteId &&
                    c.weapon === p.weapon &&
                    c.gender === p.gender &&
                    c.category === p.category,
                ) ?? null
              }
              nombre={
                conNombre
                  ? (tiradores.find((t) => t.id === p.athleteId)?.nombre ?? null)
                  : null
              }
            />
          ))}

          {leidoEl ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <Escudo federacion="RFEE" tamano="nota" decorativo />
              <span className="medida">
                Leído de la fuente oficial el {formatDateEs(leidoEl)}. No lo
                calcula esta aplicación: se copia tal cual.
              </span>
            </p>
          ) : null}
        </div>
      )}

      <CalculoInterno
        puestos={internos}
        tiradores={tiradores}
        conNombre={conNombre}
      />
    </Seccion>
  );
}

/**
 * Una clasificación suya: la chapa de tres cifras y la distancia al corte.
 *
 * El puesto no sale en la chapa a propósito: ya está en el marcador de arriba,
 * y repetir el mismo «3» dos veces en la misma pantalla no jerarquiza nada.
 * Aquí manda lo que el marcador no puede decir: los puntos, de cuántos, y lo
 * que falta para entrar en una convocatoria.
 */
function Clasificacion({
  puesto: p,
  corte,
  nombre,
}: {
  puesto: PuestoOficial;
  corte: CortePropio | null;
  nombre: string | null;
}) {
  const categoria =
    CATEGORY_LABEL[p.category as keyof typeof CATEGORY_LABEL] ?? p.category;
  const c = corte?.corte ?? null;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {nombre ? (
        <p className="text-sm font-medium">{nombre}</p>
      ) : null}

      <Marcador>
        <CeldaMarcador
          valor={
            p.totalPoints === null ? (
              <span className="text-base text-muted-foreground">no publicado</span>
            ) : (
              formatoPuntos(p.totalPoints)
            )
          }
          palabra="puntos oficiales"
          tono={p.totalPoints === null ? 'apagado' : 'normal'}
          tamano="compacto"
        />
        <CeldaMarcador
          valor={
            p.position === null ? (
              '—'
            ) : (
              <>
                {p.position}
                <span className="text-xl">.º</span>
              </>
            )
          }
          palabra={
            p.position === null
              ? 'sin clasificar todavía'
              : p.deCuantos > 0
                ? `de ${p.deCuantos} clasificados`
                : 'puesto oficial'
          }
          tono={p.position === null ? 'apagado' : 'normal'}
        />
        {/*
          La tercera celda ES la novedad de la pantalla. Dentro del corte se
          escribe el número de plazas, que es el listón; fuera, los puestos que
          faltan, que es la distancia.
        */}
        {c === null || c.rankingPlaces === 0 ? (
          <CeldaMarcador valor="—" palabra="sin plazas por ranking" tono="apagado" />
        ) : c.inside ? (
          <CeldaMarcador
            valor={c.rankingPlaces}
            palabra="plazas por ranking, y estás dentro"
            tono="ok"
          />
        ) : (
          <CeldaMarcador
            valor={c.placesAway}
            palabra={c.placesAway === 1 ? 'puesto del corte' : 'puestos del corte'}
            tono="aviso"
          />
        )}
      </Marcador>

      <Rotulos
        disposicion="linea"
        datos={[
          ['Arma', WEAPON_LABEL[p.weapon]],
          ['Género', GENDER_LABEL[p.gender]],
          ['Categoría', categoria],
        ]}
      />

      <Corte corte={c} />

      {p.sourceUrl ? (
        <a
          href={p.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1 text-xs text-primary-text underline underline-offset-4 transition-colors hover:text-foreground"
        >
          Verlo en la página de la RFEE
          <ExternalLink className="size-3 shrink-0" aria-hidden />
        </a>
      ) : null}
    </div>
  );
}

/**
 * La distancia al corte, escrita.
 *
 * La celda del marcador da la cifra; esta frase da las dos mitades que una
 * cifra no puede dar: los PUNTOS que faltan —tres puestos pueden ser dos puntos
 * o doscientos— y el aviso de las plazas técnicas, que es la letra pequeña que
 * más malentendidos genera. Si de seis plazas dos son técnicas, ir undécimo no
 * significa estar a cinco puestos de ir convocado.
 */
function Corte({ corte }: { corte: CortePropio['corte'] | null }) {
  if (!corte || corte.rankingPlaces === 0) {
    return (
      <p className="medida text-sm text-muted-foreground">
        La normativa de la temporada no fija plazas por ranking en esta
        categoría, así que no se puede decir dónde está el corte.
      </p>
    );
  }

  const tecnicas =
    corte.technicalPlaces > 0
      ? corte.technicalPlaces === 1
        ? ' Además hay 1 plaza de criterio técnico, que no depende del ranking.'
        : ` Además hay ${corte.technicalPlaces} plazas de criterio técnico, que no dependen del ranking.`
      : '';

  const fecha = corte.cutoffDate
    ? corte.cutoffPassed
      ? ` La fecha de corte (${formatDateEs(corte.cutoffDate)}) ya pasó: este ranking ya no se mueve.`
      : ` El corte se hace el ${formatDateEs(corte.cutoffDate)}.`
    : ' La normativa no fija fecha de corte para esta categoría.';

  if (corte.inside) {
    return (
      <p className="medida flex items-start gap-2 text-sm text-ok">
        <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Estás dentro de las {corte.rankingPlaces} plazas que salen por
          ranking.
          <span className="text-muted-foreground">
            {tecnicas}
            {fecha}
          </span>
        </span>
      </p>
    );
  }

  return (
    <p className="medida text-sm">
      A <span className="cifra text-base text-warn">{corte.placesAway}</span>{' '}
      {corte.placesAway === 1 ? 'puesto' : 'puestos'}
      {corte.pointsAway !== null ? (
        <>
          {' '}
          y{' '}
          <span className="cifra text-base text-warn">
            {formatoPuntos(corte.pointsAway)}
          </span>{' '}
          puntos
        </>
      ) : null}{' '}
      del corte, que está en el puesto {corte.rankingPlaces}.
      <span className="text-muted-foreground">
        {tecnicas}
        {fecha}
      </span>
    </p>
  );
}

/**
 * El cálculo propio de la aplicación, plegado y con su nombre puesto.
 *
 * Va plegado porque no sirve para decidir: sirve para auditar. Y va aquí dentro
 * y no en su propia sección porque son el mismo asunto —cómo voy— y dos bandas
 * seguidas con dos puestos distintos del mismo tirador es exactamente la
 * confusión que hay que evitar. Solo aparece si el cálculo existe: un desplegable
 * que explica algo que no se ha calculado es ruido.
 */
function CalculoInterno({
  puestos,
  tiradores,
  conNombre,
}: {
  puestos: PuestoTemporada[];
  tiradores: { id: string; nombre: string }[];
  conNombre: boolean;
}) {
  if (puestos.length === 0) return null;

  return (
    <Collapsible className="mt-4 border-t border-filete pt-3">
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-2 text-left text-sm text-muted-foreground hover:text-foreground">
        <ChevronDown
          className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180"
          aria-hidden
        />
        Ver el cálculo de la aplicación, auditable prueba a prueba
      </CollapsibleTrigger>

      <CollapsibleContent className="flex flex-col gap-4 pt-3">
        <p className="medida text-xs text-muted-foreground">
          No es el ranking de la federación: es lo que sale de aplicar la
          normativa a los resultados que esta aplicación tiene emparejados, y
          sirve para ver de dónde sale cada punto y por qué una prueba no cuenta.
        </p>

        {puestos.map((p) => {
          const nombre = tiradores.find((t) => t.id === p.athleteId)?.nombre;
          const categoria =
            CATEGORY_LABEL[p.category as keyof typeof CATEGORY_LABEL] ??
            p.category;
          return (
            <div
              key={`${p.athleteId}-${p.weapon}-${p.gender}-${p.category}`}
              className="flex flex-col gap-2"
            >
              <div className="flex items-baseline gap-3">
                <span className="cifra text-3xl">
                  {p.position}
                  <span className="text-lg">.º</span>
                </span>
                <span className="text-xs leading-tight text-muted-foreground">
                  puesto calculado
                  {conNombre && nombre ? (
                    <span className="mt-0.5 block text-foreground">{nombre}</span>
                  ) : null}
                </span>
              </div>

              <Rotulos
                disposicion="linea"
                datos={[
                  ['Arma', WEAPON_LABEL[p.weapon]],
                  ['Categoría', categoria],
                  [
                    'Puntos',
                    <span key="p" className="cifra text-base">
                      {formatoPuntos(p.totalPoints)}
                    </span>,
                  ],
                  [
                    p.pruebasContadas === 1 ? 'Prueba contada' : 'Pruebas contadas',
                    <span key="n" className="cifra text-base">
                      {p.pruebasContadas}
                    </span>,
                  ],
                ]}
              />

              <Variacion valor={p.variacion} />
              <span className="text-xs text-muted-foreground">
                Calculado el {formatDateEs(p.calculadoEl)}
              </span>
            </div>
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Movimiento desde el cálculo anterior. "Sin comparación" no es "igual". */
function Variacion({ valor }: { valor: number | null }) {
  if (valor === null) {
    return (
      <span className="text-xs text-muted-foreground">
        Es el primer cálculo de la temporada: todavía no hay con qué comparar.
      </span>
    );
  }
  if (valor === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        Mismo puesto que en el cálculo anterior.
      </span>
    );
  }
  const sube = valor > 0;
  // Mismo par que en `tabla-ranking.tsx`: una idea, un icono.
  const Icono = sube ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-sm',
        sube ? 'text-ok' : 'text-danger',
      )}
    >
      <Icono className="size-4 shrink-0" aria-hidden />
      {sube ? 'Sube' : 'Baja'}{' '}
      <span className="cifra text-base">{Math.abs(valor)}</span>{' '}
      {Math.abs(valor) === 1 ? 'puesto' : 'puestos'}
    </span>
  );
}
