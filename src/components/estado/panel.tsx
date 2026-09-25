'use client';

import { ArrowDownRight, ArrowUpRight, ChevronRight, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import type {
  PuestoTemporada,
  PuntosDePrueba,
} from '@/app/(app)/estado/consultas';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { MyStatus } from '@/lib/queries/my-status';
import {
  CATEGORY_LABEL,
  GENDER_SHORT,
  WEAPON_LABEL,
  cn,
  formatDateEs,
} from '@/lib/utils';
import { type Respuesta, FilaConvocatoria } from './convocatoria';
import { FilaInscripcion, FilaPasada, PanelHoy } from './inscripcion';

const TODOS = 'todos';

/**
 * "Mi estado": ¿cómo voy?
 *
 * Todo lo de la cuenta se carga de una vez en el servidor y el cambio de
 * tirador ocurre aquí, sin volver a la red: una cuenta gestiona uno o dos
 * tiradores, así que cabe de sobra, y así un padre con dos hijos alterna
 * entre ellos sin esperar.
 */
export function PanelEstado({
  estado,
  puestos,
  puntosPorPrueba,
  temporada,
  hoy,
  responderConvocatoria,
}: {
  estado: MyStatus;
  puestos: PuestoTemporada[];
  /** `athleteId|eventCompetitionId` -> puntos de ranking de esa prueba. */
  puntosPorPrueba: Record<string, PuntosDePrueba>;
  temporada: string | null;
  /** Fecha de hoy en ISO, calculada en el servidor. */
  hoy: string;
  responderConvocatoria: Respuesta;
}) {
  const varios = estado.athletes.length > 1;
  const [quien, setQuien] = React.useState(() =>
    varios ? TODOS : (estado.athletes[0]?.id ?? TODOS),
  );

  const mio = <T extends { athleteId: string }>(filas: T[]) =>
    quien === TODOS ? filas : filas.filter((f) => f.athleteId === quien);

  const tiradores =
    quien === TODOS
      ? estado.athletes
      : estado.athletes.filter((a) => a.id === quien);

  const pasadas = mio(estado.pastEntries);
  const hoyMismo = mio(estado.today);
  // Las de hoy tienen su propio panel arriba, con los horarios del día: en la
  // lista de próximas volverían a salir diciendo lo mismo.
  const enJuego = new Set(hoyMismo.map((e) => e.entryId));
  const proximas = mio(estado.upcomingEntries).filter(
    (e) => !enJuego.has(e.entryId),
  );
  const convocatorias = mio(estado.callUps);
  const pendientes = tiradores.flatMap((a) =>
    a.pending.map((p) => ({ ...p, quien: a.fullName })),
  );
  const misPuestos = mio(puestos);

  const conNombre = quien === TODOS && varios;

  const enMarcha = mio(estado.upcomingEntries).filter(
    (e) => e.status !== 'rejected' && e.status !== 'withdrawn',
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl sm:text-3xl">Mi estado</h1>
        <p className="text-sm text-muted-foreground">
          <span className="cifra text-base text-foreground">{enMarcha}</span>{' '}
          {enMarcha === 1 ? 'inscripción en marcha' : 'inscripciones en marcha'}
          {temporada ? ` · temporada ${temporada}` : ''}
        </p>
      </div>

      {varios ? (
        <ToggleGroup
          type="single"
          value={quien}
          onValueChange={(v) => v && setQuien(v)}
          variant="outline"
          spacing={2}
          className="flex-wrap"
          aria-label="Ver el estado de"
        >
          <ToggleGroupItem value={TODOS}>Todos</ToggleGroupItem>
          {estado.athletes.map((a) => (
            <ToggleGroupItem key={a.id} value={a.id}>
              {a.firstName}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      ) : null}

      {/*
        En el móvil manda el orden del DOM: hoy, la foto de la temporada y lo
        que te falta, y después la lista. En pantalla ancha lo secundario se
        va a una columna de la derecha y la lista ocupa el resto.
      */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        {hoyMismo.length > 0 ? (
          <section className="flex flex-col gap-3 lg:col-start-1 lg:row-start-1">
            <h2 className="text-xl">Hoy compites</h2>
            {hoyMismo.map((e) => (
              <PanelHoy key={e.entryId} entrada={e} conNombre={conNombre} />
            ))}
          </section>
        ) : null}

        <aside
          className={cn(
            'flex flex-col gap-6 lg:col-start-2 lg:row-start-1',
            hoyMismo.length > 0 && 'lg:row-span-2',
          )}
        >
          <SituacionTemporada
            puestos={misPuestos}
            tiradores={tiradores.map((a) => ({ id: a.id, nombre: a.fullName }))}
            conNombre={conNombre}
          />

          {pendientes.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-xl">Qué te falta</h2>
              <ul className="flex flex-col divide-y">
                {pendientes.map((p) => (
                  <li key={`${p.quien}-${p.label}`}>
                    <Link
                      href={p.href}
                      className="flex items-start gap-2.5 py-3 hover:text-primary-text"
                    >
                      <TriangleAlert
                        className="mt-0.5 size-4 shrink-0 text-warn"
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {p.label}
                          {conNombre ? ` · ${p.quien}` : ''}
                        </span>
                        <span className="block text-sm text-muted-foreground">
                          {p.detail}
                        </span>
                      </span>
                      <ChevronRight
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>

        <div
          className={cn(
            'flex min-w-0 flex-col gap-6 lg:col-start-1',
            hoyMismo.length > 0 ? 'lg:row-start-2' : 'lg:row-start-1',
          )}
        >
          {convocatorias.length > 0 ? (
            <section className="flex flex-col gap-1">
              <h2 className="text-xl">Selección</h2>
              <ul className="flex flex-col divide-y">
                {convocatorias.map((c) => (
                  <FilaConvocatoria
                    key={c.id}
                    convocatoria={c}
                    responder={responderConvocatoria}
                    conNombre={conNombre}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          <section className="flex flex-col gap-1">
            <h2 className="text-xl">Próximas inscripciones</h2>
            {proximas.length > 0 ? (
              <ul className="flex flex-col divide-y">
                {proximas.map((e) => (
                  <FilaInscripcion
                    key={e.entryId}
                    entrada={e}
                    esHoy={e.startDate <= hoy && e.endDate >= hoy}
                    conNombre={conNombre}
                  />
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-start gap-3 py-3">
                <p className="medida text-sm text-muted-foreground">
                  Aquí aparece cada inscripción que pidas, con el paso en el que
                  está y los días que quedan de plazo. Todavía no has pedido
                  ninguna.
                </p>
                <Button variant="outline" asChild>
                  <Link href="/">Buscar competición en el calendario</Link>
                </Button>
              </div>
            )}
          </section>

          {pasadas.length > 0 ? (
            <section className="flex flex-col gap-1">
              <h2 className="text-xl">Ya celebradas</h2>
              <ul className="flex flex-col divide-y">
                {pasadas.map((e) => (
                  <FilaPasada
                    key={e.entryId}
                    entrada={e}
                    puntos={
                      puntosPorPrueba[
                        `${e.athleteId}|${e.eventCompetitionId}`
                      ] ?? null
                    }
                    conNombre={conNombre}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Puesto y puntos en el ranking, que es la foto de la temporada. */
function SituacionTemporada({
  puestos,
  tiradores,
  conNombre,
}: {
  puestos: PuestoTemporada[];
  tiradores: { id: string; nombre: string }[];
  conNombre: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl">Tu temporada</h2>

      {puestos.length === 0 ? (
        <p className="medida text-sm text-muted-foreground">
          {/*
            Se dice «tu arma y tu categoría», no «esta temporada»: puede
            haber ranking calculado en otros grupos y entonces la frase
            general se contradice con lo que se ve al abrir el ranking.
          */}
          Todavía no hay ranking calculado en tu arma y tu categoría. Aquí
          verás tu puesto y tus puntos en cuanto haya resultados oficiales
          emparejados con tu licencia.{' '}
          <Link href="/ranking" className="underline underline-offset-2">
            Ver el ranking
          </Link>
          .
        </p>
      ) : (
        <ul className="flex flex-col divide-y">
          {puestos.map((p) => {
            const nombre = tiradores.find((t) => t.id === p.athleteId)?.nombre;
            const categoria =
              CATEGORY_LABEL[p.category as keyof typeof CATEGORY_LABEL] ??
              p.category;
            return (
              <li
                key={`${p.athleteId}-${p.weapon}-${p.gender}-${p.category}`}
                className="flex items-baseline gap-3 py-3"
              >
                <span className="cifra text-4xl">{p.position}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm">
                    en {WEAPON_LABEL[p.weapon]} {GENDER_SHORT[p.gender]}{' '}
                    {categoria}
                    {conNombre && nombre ? ` · ${nombre}` : ''}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    <span className="cifra text-base text-foreground">
                      {p.totalPoints}
                    </span>{' '}
                    puntos de{' '}
                    <span className="cifra text-base text-foreground">
                      {p.pruebasContadas}
                    </span>{' '}
                    {p.pruebasContadas === 1 ? 'prueba' : 'pruebas'}
                  </span>
                  <Variacion valor={p.variacion} />
                  <span className="text-xs text-muted-foreground">
                    Calculado el {formatDateEs(p.calculadoEl)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Movimiento desde el cálculo anterior. "Sin comparación" no es "igual". */
function Variacion({ valor }: { valor: number | null }) {
  if (valor === null) {
    return (
      <span className="text-sm text-muted-foreground">
        Es el primer cálculo de la temporada: todavía no hay con qué comparar.
      </span>
    );
  }
  if (valor === 0) {
    return (
      <span className="text-sm text-muted-foreground">
        Mismo puesto que en el cálculo anterior.
      </span>
    );
  }
  const sube = valor > 0;
  const Icono = sube ? ArrowUpRight : ArrowDownRight;
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
