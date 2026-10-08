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
import { ListaDatos, ParDato } from '@/components/sistema/lista-datos';
import { Pastilla, Puesto } from '@/components/sistema/pastilla';
import { fechaCorta, frescura } from '@/lib/fechas';
import type { PuestoOficial } from '@/lib/queries/ranking';
import { rotuloPrueba } from '@/lib/sport/rotulos';
import { cn } from '@/lib/utils';
import { CeldaMarcador, Marcador, Seccion } from './piezas';

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
          ? `Ranking oficial RFEE · ${oficiales[0].seasonLabel}`
          : 'Ranking oficial RFEE'
      }
    >
      {oficiales.length === 0 ? (
        <p className="medida py-4 text-sm text-muted-foreground">
          {/*
            «No apareces todavía», no «no hay ranking»: el ranking oficial
            existe. Lo que falta es una fila emparejada con la licencia.
          */}
          {conNombre
            ? 'Ninguno de tus tiradores sale aún en el ranking oficial. '
            : 'Aún no sales en el ranking oficial. '}
          Pasa si no has puntuado esta temporada o si la licencia de la ficha no
          coincide con la de la federación.{' '}
          <Link href="/ranking" className="font-medium text-primary-text hover:text-foreground">
            Ver el ranking
          </Link>
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
              <span className="medida">{frescura(leidoEl)} · Copiado de la RFEE, sin cálculos propios</span>
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
  const c = corte?.corte ?? null;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="flex min-w-0 flex-wrap items-center gap-2">
        <Pastilla tamano="md">
          {rotuloPrueba({ arma: p.weapon, genero: p.gender, categoria: p.category }, { categoria: 'siempre' })}
        </Pastilla>
        {nombre ? <span className="text-sm font-medium">{nombre}</span> : null}
      </p>

      <Marcador>
        <CeldaMarcador
          valor={
            p.totalPoints === null ? (
              <span className="text-base text-muted-foreground">Sin publicar</span>
            ) : (
              formatoPuntos(p.totalPoints)
            )
          }
          palabra="puntos oficiales"
          tono={p.totalPoints === null ? 'apagado' : 'normal'}
          tamano="compacto"
        />
        <CeldaMarcador
          valor={p.position === null ? '—' : p.position}
          palabra={
            p.position === null
              ? 'sin clasificar aún'
              : p.deCuantos > 0
                ? `puesto de ${p.deCuantos}`
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
          <CeldaMarcador valor={c.rankingPlaces} palabra="plazas por ranking: dentro" tono="ok" />
        ) : (
          <CeldaMarcador
            valor={c.placesAway}
            palabra={c.placesAway === 1 ? 'puesto del corte' : 'puestos del corte'}
            tono="aviso"
          />
        )}
      </Marcador>

      <Corte corte={c} />

      {p.sourceUrl ? (
        <a
          href={p.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 w-fit items-center gap-1 text-sm font-medium text-primary-text hover:text-foreground"
        >
          Ver en la RFEE
          <ExternalLink className="size-4 shrink-0" aria-hidden />
        </a>
      ) : null}
    </div>
  );
}

/**
 * La distancia al corte, escrita: los puntos que faltan (tres puestos pueden
 * ser dos puntos o doscientos) y las plazas técnicas, que no dependen del
 * ranking y son la letra pequeña que más malentendidos genera.
 */
function Corte({ corte }: { corte: CortePropio['corte'] | null }) {
  if (!corte || corte.rankingPlaces === 0) {
    return (
      <p className="medida text-sm text-muted-foreground">
        La normativa no fija plazas por ranking en esta categoría.
      </p>
    );
  }

  const tecnicas =
    corte.technicalPlaces > 0
      ? corte.technicalPlaces === 1
        ? ' Hay además 1 plaza técnica, fuera del ranking.'
        : ` Hay además ${corte.technicalPlaces} plazas técnicas, fuera del ranking.`
      : '';

  const fecha = corte.cutoffDate
    ? corte.cutoffPassed
      ? ` El corte fue el ${fechaCorta(corte.cutoffDate)}: ya no se mueve.`
      : ` El corte es el ${fechaCorta(corte.cutoffDate)}.`
    : ' Sin fecha de corte en la normativa.';

  if (corte.inside) {
    return (
      <p className="medida flex items-start gap-2 text-sm text-ok">
        <CircleCheck className="mt-1 size-4 shrink-0" aria-hidden />
        <span>
          Dentro de las {corte.rankingPlaces} plazas por ranking.
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
      A <span className="font-semibold text-warn tabular-nums">{corte.placesAway}</span>{' '}
      {corte.placesAway === 1 ? 'puesto' : 'puestos'}
      {corte.pointsAway !== null ? (
        <>
          {' '}
          y <span className="font-semibold text-warn tabular-nums">{formatoPuntos(corte.pointsAway)}</span>{' '}
          puntos
        </>
      ) : null}{' '}
      del corte (puesto {corte.rankingPlaces}).
      <span className="text-muted-foreground">
        {tecnicas}
        {fecha}
      </span>
    </p>
  );
}

/**
 * El cálculo propio de la aplicación, plegado: no sirve para decidir, sirve
 * para auditar de dónde sale cada punto. Va dentro de «Cómo voy» porque dos
 * bandas seguidas con dos puestos del mismo tirador confundirían.
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
    <Collapsible className="mt-4 border-t border-border pt-2">
      <CollapsibleTrigger className="group flex min-h-11 w-full cursor-pointer items-center gap-2 text-left text-sm text-muted-foreground hover:text-foreground">
        <ChevronDown
          className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
          aria-hidden
        />
        Ver el cálculo de la aplicación
      </CollapsibleTrigger>

      <CollapsibleContent className="flex flex-col gap-4 pt-2">
        <p className="medida text-xs text-muted-foreground">
          No es el ranking oficial: es la normativa aplicada a los resultados que tenemos.
        </p>

        {puestos.map((p) => {
          const nombre = tiradores.find((t) => t.id === p.athleteId)?.nombre;
          return (
            <div key={`${p.athleteId}-${p.weapon}-${p.gender}-${p.category}`} className="flex flex-col gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Puesto puesto={p.position} tamano="md" />
                <Pastilla>
                  {rotuloPrueba({ arma: p.weapon, genero: p.gender, categoria: p.category }, { categoria: 'siempre' })}
                </Pastilla>
                {conNombre && nombre ? <span className="text-sm font-medium">{nombre}</span> : null}
              </div>

              <ListaDatos disposicion="rejilla">
                <ParDato etiqueta="Puntos">
                  <span className="tabular-nums">{formatoPuntos(p.totalPoints)}</span>
                </ParDato>
                <ParDato etiqueta={p.pruebasContadas === 1 ? 'Prueba contada' : 'Pruebas contadas'}>
                  <span className="tabular-nums">{p.pruebasContadas}</span>
                </ParDato>
              </ListaDatos>

              <Variacion valor={p.variacion} />
              <span className="text-xs text-muted-foreground">{frescura(p.calculadoEl)}</span>
            </div>
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Movimiento desde el cálculo anterior. «Sin comparación» no es «igual». */
function Variacion({ valor }: { valor: number | null }) {
  if (valor === null) {
    return <span className="text-xs text-muted-foreground">Primer cálculo de la temporada</span>;
  }
  if (valor === 0) {
    return <span className="text-xs text-muted-foreground">Mismo puesto que en el cálculo anterior</span>;
  }
  const sube = valor > 0;
  // Mismo par que en `tabla-ranking.tsx`: una idea, un icono.
  const Icono = sube ? TrendingUp : TrendingDown;
  return (
    <span className={cn('inline-flex items-center gap-1 text-sm', sube ? 'text-ok' : 'text-danger')}>
      <Icono className="size-4 shrink-0" aria-hidden />
      {sube ? 'Sube' : 'Baja'} <span className="font-semibold tabular-nums">{Math.abs(valor)}</span>{' '}
      {Math.abs(valor) === 1 ? 'puesto' : 'puestos'}
    </span>
  );
}
