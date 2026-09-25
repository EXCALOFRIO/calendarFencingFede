'use client';

import { ArrowDownRight, ArrowUpRight, ChevronRight, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import type {
  CompeticionElegible,
  PuestoTemporada,
  PuntosDePrueba,
} from '@/app/(app)/estado/consultas';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { MyStatus } from '@/lib/queries/my-status';
import {
  CATEGORY_LABEL,
  GENDER_LABEL,
  WEAPON_LABEL,
  cn,
  formatDateEs,
} from '@/lib/utils';
import { type Respuesta, FilaConvocatoria } from './convocatoria';
import { FilaInscripcion, FilaPasada, PanelHoy } from './inscripcion';
import { CeldaMarcador, Marcador, Rotulos, Seccion } from './piezas';
import { type Solicitar, SinInscribir } from './sin-inscribir';

const TODOS = 'todos';

/**
 * "Mi estado": ¿cómo voy?
 *
 * Todo lo de la cuenta se carga de una vez en el servidor y el cambio de
 * tirador ocurre aquí, sin volver a la red: una cuenta gestiona uno o dos
 * tiradores, así que cabe de sobra, y así un padre con dos hijos alterna
 * entre ellos sin esperar.
 *
 * -------------------------------------------------------------------------
 * EL ORDEN DE LA PANTALLA ES EL ORDEN DE LA URGENCIA
 * -------------------------------------------------------------------------
 * Arriba del todo, el marcador: de dos a cuatro cifras que contestan «¿cómo
 * voy?» sin tocar nada ni bajar. Debajo, en este orden y sin excepciones:
 * lo que pasa hoy, lo que hay que contestar, lo que se cierra pronto y en lo
 * que todavía no estás, lo que ya está en marcha, y por último lo que solo
 * se consulta.
 *
 * En el móvil manda el orden del DOM. En pantalla ancha, lo que solo se
 * consulta —el puesto en el ranking y los trámites pendientes— se va a una
 * columna estrecha de la derecha, pero SIGUE DESPUÉS en el marcado para que
 * en el móvil no se cuele por delante de lo urgente.
 */
export function PanelEstado({
  estado,
  puestos,
  puntosPorPrueba,
  elegibles,
  temporada,
  hoy,
  responderConvocatoria,
  solicitarInscripcion,
}: {
  estado: MyStatus;
  puestos: PuestoTemporada[];
  /** `athleteId|eventCompetitionId` -> puntos de ranking de esa prueba. */
  puntosPorPrueba: Record<string, PuntosDePrueba>;
  /** Pruebas abiertas que le corresponden y en las que todavía no está. */
  elegibles: CompeticionElegible[];
  temporada: string | null;
  /** Fecha de hoy en ISO, calculada en el servidor. */
  hoy: string;
  responderConvocatoria: Respuesta;
  solicitarInscripcion: Solicitar;
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
  const misElegibles = mio(elegibles);

  const conNombre = quien === TODOS && varios;

  const enMarcha = mio(estado.upcomingEntries).filter(
    (e) => e.status !== 'rejected' && e.status !== 'withdrawn',
  );

  const sinResponder = convocatorias.filter(
    (c) => c.status === 'pendiente',
  ).length;

  /**
   * El plazo más apretado de todos los que le afectan: los de lo que ya pidió
   * y los de aquello en lo que todavía no está. Es la cifra por la que se
   * entra a esta pantalla desde la puerta de un pabellón.
   */
  const plazoMasCorto = Math.min(
    ...enMarcha
      .map((e) => e.deadlineStatus.daysLeft)
      .filter((d): d is number => d !== null),
    ...misElegibles.map((c) => c.diasRestantes),
  );
  const hayPlazo = Number.isFinite(plazoMasCorto);

  const mejorPuesto = misPuestos[0] ?? null;
  const hayTiradorSinArma = tiradores.some(
    (a) => a.weapons.length === 0 || a.eligibleCategories.length === 0,
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl sm:text-3xl">Mi estado</h1>
        {temporada ? (
          <p className="text-sm text-muted-foreground">Temporada {temporada}</p>
        ) : null}
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

      {/* El marcador. Cuatro cifras y ninguna frase: lo que se mira de pie. */}
      <Marcador>
        <CeldaMarcador
          valor={hayPlazo ? plazoMasCorto : '—'}
          palabra={
            hayPlazo
              ? plazoMasCorto === 1
                ? 'día para el plazo más corto'
                : 'días para el plazo más corto'
              : 'plazos abiertos'
          }
          tono={
            !hayPlazo
              ? 'apagado'
              : plazoMasCorto <= 3
                ? 'urgente'
                : plazoMasCorto <= 10
                  ? 'aviso'
                  : 'ok'
          }
        />
        <CeldaMarcador
          valor={enMarcha.length}
          palabra={
            enMarcha.length === 1
              ? 'inscripción en marcha'
              : 'inscripciones en marcha'
          }
          tono={enMarcha.length > 0 ? 'normal' : 'apagado'}
        />
        <CeldaMarcador
          valor={misElegibles.length}
          palabra={
            misElegibles.length === 1
              ? 'prueba abierta en la que no estás'
              : 'pruebas abiertas en las que no estás'
          }
          /* Blanco, no carmesí: el rojo de esta pantalla es el del plazo que
             se acaba, y dos rojos seguidos no jerarquizan nada. */
          tono={misElegibles.length > 0 ? 'normal' : 'apagado'}
        />
        {sinResponder > 0 ? (
          <CeldaMarcador
            valor={sinResponder}
            palabra={
              sinResponder === 1
                ? 'convocatoria sin contestar'
                : 'convocatorias sin contestar'
            }
            tono="oro"
          />
        ) : (
          <CeldaMarcador
            valor={mejorPuesto ? mejorPuesto.position : '—'}
            /* «en espada M20» a secas se lee como un recuento; la palabra
               tiene que decir que es un puesto. */
            palabra={
              mejorPuesto
                ? `puesto en ${WEAPON_LABEL[mejorPuesto.weapon].toLowerCase()} ${
                    CATEGORY_LABEL[
                      mejorPuesto.category as keyof typeof CATEGORY_LABEL
                    ] ?? mejorPuesto.category
                  }`
                : 'sin puesto en el ranking'
            }
            tono={mejorPuesto ? 'normal' : 'apagado'}
          />
        )}
      </Marcador>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-start-1">
          {hoyMismo.length > 0 ? (
            <Seccion titulo="Hoy compites">
              <div className="flex flex-col gap-3 pt-3">
                {hoyMismo.map((e) => (
                  <PanelHoy key={e.entryId} entrada={e} conNombre={conNombre} />
                ))}
              </div>
            </Seccion>
          ) : null}

          {convocatorias.length > 0 ? (
            <Seccion
              titulo="Selección"
              contexto={
                sinResponder > 0
                  ? sinResponder === 1
                    ? 'falta tu respuesta'
                    : `faltan ${sinResponder} respuestas`
                  : undefined
              }
            >
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
            </Seccion>
          ) : null}

          <SinInscribir
            competiciones={misElegibles}
            solicitar={solicitarInscripcion}
            conNombre={conNombre}
            hayTiradorSinArma={hayTiradorSinArma}
          />

          <Seccion
            titulo="Lo que ya has pedido"
            contexto={
              proximas.length > 0
                ? `${proximas.length} ${proximas.length === 1 ? 'inscripción' : 'inscripciones'}`
                : undefined
            }
          >
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
              <div className="flex flex-col items-start gap-3 py-4">
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
          </Seccion>

          {pasadas.length > 0 ? (
            <Seccion titulo="Ya celebradas" contexto={`${pasadas.length}`}>
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
            </Seccion>
          ) : null}
        </div>

        <aside className="flex min-w-0 flex-col gap-6 lg:col-start-2 lg:row-start-1">
          {pendientes.length > 0 ? (
            <Seccion titulo="Qué te falta">
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
                        </span>
                        <span className="block text-sm text-muted-foreground">
                          {p.detail}
                          {conNombre ? ` (${p.quien})` : ''}
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
            </Seccion>
          ) : null}

          <SituacionTemporada
            puestos={misPuestos}
            tiradores={tiradores.map((a) => ({ id: a.id, nombre: a.fullName }))}
            conNombre={conNombre}
          />
        </aside>
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
    <Seccion titulo="Tu temporada">
      {puestos.length === 0 ? (
        <p className="medida py-4 text-sm text-muted-foreground">
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
                className="flex flex-col gap-3 py-4"
              >
                <div className="flex items-baseline gap-3">
                  <span className="cifra text-5xl">{p.position}</span>
                  <span className="text-xs leading-tight text-muted-foreground">
                    puesto
                    {conNombre && nombre ? (
                      <span className="mt-0.5 block text-foreground">
                        {nombre}
                      </span>
                    ) : null}
                  </span>
                </div>

                <Rotulos
                  datos={[
                    ['Arma', WEAPON_LABEL[p.weapon]],
                    ['Género', GENDER_LABEL[p.gender]],
                    ['Categoría', categoria],
                    [
                      'Puntos',
                      <span key="p" className="cifra text-base">
                        {p.totalPoints}
                      </span>,
                    ],
                    [
                      p.pruebasContadas === 1
                        ? 'Prueba contada'
                        : 'Pruebas contadas',
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
              </li>
            );
          })}
        </ul>
      )}
    </Seccion>
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
