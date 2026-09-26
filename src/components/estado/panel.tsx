'use client';

import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  ExternalLink,
  TriangleAlert,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import type {
  CompeticionElegible,
  PuestoTemporada,
  PuntosDePrueba,
} from '@/app/(app)/estado/consultas';
import { puntos as formatoPuntos } from '@/components/ranking/formato';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { MyStatus } from '@/lib/queries/my-status';
import type { PuestoOficial } from '@/lib/queries/ranking';
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
  oficiales,
  puntosPorPrueba,
  elegibles,
  temporada,
  hoy,
  responderConvocatoria,
  solicitarInscripcion,
}: {
  estado: MyStatus;
  /** Cálculo INTERNO de la aplicación (`ranking_snapshot`). */
  puestos: PuestoTemporada[];
  /** Clasificación OFICIAL de la RFEE. Son dos números distintos, a la vista. */
  oficiales: PuestoOficial[];
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
  const misOficiales = mio(oficiales);
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

  /**
   * El puesto que va al marcador es el OFICIAL de la RFEE.
   *
   * Es el que la gente reconoce y el que decide convocatorias. Antes la celda
   * leía solo el cálculo interno y le decía «— sin puesto en el ranking» a un
   * 3.º de España, que es lo contrario de lo que se le pidió a esta pantalla.
   * El cálculo interno sigue estando, más abajo y con su nombre.
   */
  const mejorOficial = misOficiales.find((o) => o.position !== null) ?? null;
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
            valor={mejorOficial?.position ?? mejorPuesto?.position ?? '—'}
            /* «en espada M20» a secas se lee como un recuento; la palabra
               tiene que decir que es un puesto, y de qué ranking. */
            palabra={
              mejorOficial
                ? `puesto oficial en ${etiquetaRanking(mejorOficial)}`
                : mejorPuesto
                  ? `puesto en el cálculo interno de ${etiquetaRanking(mejorPuesto)}`
                  : 'sin puesto en la clasificación oficial'
            }
            tono={mejorOficial || mejorPuesto ? 'normal' : 'apagado'}
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
            oficiales={misOficiales}
            tiradores={tiradores.map((a) => ({ id: a.id, nombre: a.fullName }))}
            conNombre={conNombre}
          />

          <CalculoInterno
            puestos={misPuestos}
            tiradores={tiradores.map((a) => ({ id: a.id, nombre: a.fullName }))}
            conNombre={conNombre}
          />
        </aside>
      </div>
    </div>
  );
}

/**
 * «espada M20», «florete absoluto»: para las palabras del marcador, que van en
 * mitad de una frase y por tanto en minúscula.
 *
 * La categoría solo se pasa a minúscula si es una PALABRA. «M20» y «VET» son
 * códigos y en minúscula se leen como una errata: el marcador decía «puesto
 * oficial en florete m20».
 */
function etiquetaRanking(p: {
  weapon: keyof typeof WEAPON_LABEL;
  category: string;
}): string {
  const etiqueta =
    CATEGORY_LABEL[p.category as keyof typeof CATEGORY_LABEL] ?? p.category;
  // Si la etiqueta es igual al código («M20»), es un código; si es distinta
  // («ABS» -> «Absoluto»), es una palabra y va en minúscula.
  const categoria = etiqueta === p.category ? etiqueta : etiqueta.toLowerCase();
  return `${WEAPON_LABEL[p.weapon].toLowerCase()} ${categoria}`;
}

/**
 * Tu temporada: el puesto y los puntos de la CLASIFICACIÓN OFICIAL de la RFEE.
 *
 * Es el número que la gente reconoce, el que decide convocatorias y el que se
 * pidió para esta pantalla. El cálculo interno de la aplicación es otra cosa y
 * va en su propia sección, con su propio nombre: los dos juntos y sin etiqueta
 * serían peor que ninguno.
 *
 * Si alguien aparece en varias clasificaciones —absoluto y sub-23, o dos
 * armas— salen todas: quedarse con una es esconderle media temporada.
 */
function SituacionTemporada({
  oficiales,
  tiradores,
  conNombre,
}: {
  oficiales: PuestoOficial[];
  tiradores: { id: string; nombre: string }[];
  conNombre: boolean;
}) {
  const leidoEl = oficiales[0]?.actualizadoEl ?? null;

  return (
    <Seccion
      titulo="Tu temporada"
      contexto={
        oficiales.length > 0
          ? `Clasificación oficial de la RFEE ${oficiales[0].seasonLabel}`
          : 'Clasificación oficial de la RFEE'
      }
    >
      {oficiales.length === 0 ? (
        <p className="medida py-4 text-sm text-muted-foreground">
          {/*
            Se dice «no apareces todavía», no «no hay ranking»: el ranking
            oficial existe y tiene cientos de tiradores. Lo que falta es una
            fila suya emparejada con su licencia, que es otra cosa y se
            arregla de otra forma.
          */}
          Todavía no apareces en la clasificación oficial de la RFEE. Pasa
          cuando no se ha puntuado esta temporada, o cuando la licencia de tu
          ficha no coincide con la que publica la federación.{' '}
          <Link href="/ranking" className="underline underline-offset-2">
            Ver la clasificación
          </Link>
          .
        </p>
      ) : (
        <ul className="flex flex-col divide-y">
          {oficiales.map((p) => {
            const nombre = tiradores.find((t) => t.id === p.athleteId)?.nombre;
            return (
              <li
                key={`${p.athleteId}-${p.weapon}-${p.gender}-${p.categoryRaw}`}
                className="flex flex-col gap-3 py-4"
              >
                <div className="flex items-baseline gap-3">
                  <span className="cifra text-5xl">{p.position ?? '—'}</span>
                  <span className="text-xs leading-tight text-muted-foreground">
                    {p.position
                      ? p.deCuantos > 0
                        ? `puesto de ${p.deCuantos}`
                        : 'puesto'
                      : 'sin clasificar todavía'}
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
                    [
                      'Categoría',
                      CATEGORY_LABEL[p.category as keyof typeof CATEGORY_LABEL] ??
                        p.category,
                    ],
                    [
                      'Puntos',
                      <span key="p" className="cifra text-base">
                        {p.totalPoints === null
                          ? 'no publicado'
                          : formatoPuntos(p.totalPoints)}
                      </span>,
                    ],
                  ]}
                />

                {p.sourceUrl ? (
                  <a
                    href={p.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex w-fit items-center gap-1 text-xs text-primary-text underline underline-offset-4"
                  >
                    Verlo en la página de la RFEE
                    <ExternalLink className="size-3 shrink-0" aria-hidden />
                  </a>
                ) : null}
              </li>
            );
          })}
          {leidoEl ? (
            <li className="pt-3 text-xs text-muted-foreground">
              Leído de la fuente oficial el {formatDateEs(leidoEl)}. No lo
              calcula esta aplicación: se copia tal cual.
            </li>
          ) : null}
        </ul>
      )}
    </Seccion>
  );
}

/**
 * El cálculo propio de la aplicación, con su nombre puesto.
 *
 * Va aparte de «Tu temporada» a propósito. Son dos números distintos —el
 * oficial lo publica la federación y decide convocatorias; este se calcula aquí
 * y se puede auditar prueba a prueba— y presentarlos juntos sin decir cuál es
 * cuál sería peor que no tener ninguno. Solo aparece si existe: una sección que
 * explica un cálculo que no se ha hecho es ruido.
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
    <Seccion titulo="Cálculo de la aplicación" contexto="auditable prueba a prueba">
      <p className="medida pt-3 text-xs text-muted-foreground">
        No es el ranking de la federación: es lo que sale de aplicar la
        normativa a los resultados que esta aplicación tiene emparejados, y
        sirve para ver de dónde sale cada punto y por qué una prueba no cuenta.
      </p>
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
                <span className="cifra text-4xl">{p.position}</span>
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
