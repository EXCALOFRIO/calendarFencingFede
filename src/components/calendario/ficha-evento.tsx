'use client';

import { ExternalLink, FileText, Navigation } from 'lucide-react';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { CompetitionView, EventView } from '@/lib/queries/calendar';
import { mapsLinks, timezoneInfo } from '@/lib/travel';
import { IconoArma } from './iconos-arma';
import {
  CATEGORY_LABEL,
  GENDER_LABEL,
  SOURCE_LABEL,
  WEAPON_LABEL,
  cn,
  formatDateEs,
  formatDateTimeEs,
  formatEur,
} from '@/lib/utils';
import type { Inscrito } from '@/app/(app)/inscritos';
import { ENTRY_STATUS_LABEL } from '@/lib/entries/state-machine';
import type { TiradorOpcion } from './vista';

const TONO = {
  verde: { texto: 'text-ok', palabra: 'A tiempo' },
  ambar: { texto: 'text-warn', palabra: 'Atención' },
  rojo: { texto: 'text-danger', palabra: 'Urgente' },
  cerrado: { texto: 'text-muted-foreground', palabra: 'Cerrado' },
  sin_datos: { texto: 'text-muted-foreground', palabra: 'Sin plazo' },
} as const;

/**
 * Contenido de la ficha de un torneo.
 *
 * Se elige una prueba con las pastillas de arriba y debajo se ve solo esa:
 * un torneo tiene hasta ocho pruebas y enseñarlas todas desplegadas obliga a
 * desplazarse por cosas que no te tocan. La prueba que te corresponde va
 * marcada; las demás se pueden mirar igual, pero no inscribirse.
 */
export function FichaEvento({
  evento,
  tirador,
  inscripciones,
  inscritos,
  onSolicitar,
}: {
  evento: EventView;
  tirador: TiradorOpcion | null;
  inscripciones: Record<string, string>;
  /** Quién va, por prueba. `null` mientras se está pidiendo. */
  inscritos: Inscrito[] | null;
  onSolicitar: (competitionId: string) => Promise<void>;
}) {
  const elegibles = React.useMemo(
    () =>
      evento.competitions.filter(
        (c) =>
          tirador &&
          (tirador.weapons.length === 0 || tirador.weapons.includes(c.weapon)) &&
          (tirador.gender === 'MIXTO' || c.gender === tirador.gender) &&
          (tirador.eligibleCategories.length === 0 ||
            tirador.eligibleCategories.includes(c.category)),
      ),
    [evento.competitions, tirador],
  );

  const [elegida, setElegida] = React.useState<string>(
    () => (elegibles[0] ?? evento.competitions[0])?.id ?? '',
  );
  const [enviando, setEnviando] = React.useState(false);

  const prueba = evento.competitions.find((c) => c.id === elegida) ?? null;
  const mapas = mapsLinks(evento);
  const huso = timezoneInfo(evento.timezone, evento.startDate, evento.endDate);

  /**
   * ¿Hay sede de verdad, o el campo «sede» repite la ciudad?
   *
   * Varias fuentes rellenan la sede con el nombre de la ciudad cuando
   * todavía no se sabe el pabellón. Si se toma al pie de la letra, la ficha
   * pone «San Salvador» dos veces seguidas y el botón promete llevarte a un
   * pabellón que no existe. Se compara sin acentos ni mayúsculas.
   */
  const normaliza = (v: string) =>
    v
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .trim()
      .toLowerCase();
  const sede =
    evento.venue && (!evento.city || normaliza(evento.venue) !== normaliza(evento.city))
      ? evento.venue
      : null;

  return (
    <div className="flex flex-col gap-4 px-4 pb-8">
      {/*
        Cómo llegar. Una sola acción: el móvil ya sabe qué mapa abrir.

        Muchos torneos se publican meses antes de que se sepa el pabellón, y
        entonces el enlace lleva solo a la ciudad. Eso **se dice**: un botón
        que promete el pabellón y abre el centro de una ciudad extranjera es
        peor que no tener botón.
      */}
      {mapas || huso ? (
        <div className="flex flex-col gap-2">
          {sede ? (
            <p className="text-sm">
              {sede}
              {evento.venueAddress ? (
                <span className="block text-muted-foreground">
                  {evento.venueAddress}
                </span>
              ) : null}
            </p>
          ) : null}

          {mapas ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Button variant="outline" size="sm" className="w-fit" asChild>
                <a href={mapas.google} target="_blank" rel="noreferrer">
                  <Navigation />
                  {sede ? 'Cómo llegar al pabellón' : 'Abrir la ciudad en el mapa'}
                </a>
              </Button>
              {!sede ? (
                <span className="text-xs text-muted-foreground">
                  {/*
                    Medido contra la base: de 274 eventos vigentes, solo 16
                    tienen pabellón, y son todos nacionales. Ni la FIE ni el
                    circuito europeo lo publican nunca. Decir «todavía no
                    está publicada» en una Copa del Mundo hace pensar que
                    falla la aplicación; lo honesto es decir quién no lo
                    publica.
                  */}
                  {evento.scope === 'INTERNACIONAL'
                    ? 'La organización internacional no publica el pabellón.'
                    : 'La sede todavía no está publicada.'}
                </span>
              ) : null}
            </div>
          ) : null}

          {huso && (huso.diffHours !== 0 || huso.dstChangeDuringTrip) ? (
            <p className="text-sm text-muted-foreground">
              {huso.label}. Allí son las {huso.localTimeNow}.
              {huso.dstNote ? (
                <span className="mt-1 block text-warn">{huso.dstNote}</span>
              ) : null}
            </p>
          ) : null}
        </div>
      ) : null}

      <Separator />

      {/* Pruebas del torneo. */}
      <div className="flex flex-col gap-3">
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {evento.competitions.map((c) => {
            const puede = elegibles.some((e) => e.id === c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setElegida(c.id)}
                aria-pressed={c.id === elegida}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  c.id === elegida
                    ? 'border-primary bg-primary/15 text-primary-text'
                    : 'text-muted-foreground hover:bg-accent',
                  !puede && 'opacity-60',
                )}
              >
                <IconoArma arma={c.weapon} className="size-4 shrink-0" />
                {WEAPON_LABEL[c.weapon]} {c.gender === 'M' ? 'M' : 'F'}{' '}
                {CATEGORY_LABEL[c.category as keyof typeof CATEGORY_LABEL] ??
                  c.category}
              </button>
            );
          })}
        </div>

        {prueba ? (
          <DetallePrueba
            prueba={prueba}
            inscritos={inscritos}
            puedeInscribirse={elegibles.some((e) => e.id === prueba.id)}
            estadoInscripcion={inscripciones[prueba.id] ?? null}
            enviando={enviando}
            onSolicitar={async () => {
              setEnviando(true);
              await onSolicitar(prueba.id);
              setEnviando(false);
            }}
          />
        ) : null}
      </div>

      {evento.documents.length > 0 ? (
        <>
          <Separator />
          <ul className="flex flex-col gap-1">
            {evento.documents.map((d) => (
              <li key={d.id}>
                <a
                  href={d.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent"
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{d.title}</span>
                  <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <Separator />

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <p>
          Fuente: {SOURCE_LABEL[evento.source] ?? evento.source} · leído{' '}
          {formatDateTimeEs(evento.lastSeenAt)}
        </p>
        {/*
          Las DOS fuentes cuando el torneo llega por dos caminos.

          Una Copa del Mundo aparece en el calendario de la RFEE y en el de
          la FIE, y aquí se enseña como una sola tarjeta. Los dos enlaces
          tienen que estar: el de Skermo porque es donde se inscribe un
          español, y el de la FIE porque sus condiciones exigen enlazar
          siempre al original de lo que se muestra.
        */}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {enlacesDeFuente(evento).map((f) => (
            <a
              key={f.source}
              href={f.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-1 underline underline-offset-2"
            >
              Ver en {SOURCE_LABEL[f.source] ?? f.source}{' '}
              <ExternalLink className="size-3" />
            </a>
          ))}
        </div>
        <p>Publicado como «{evento.name}»</p>
      </div>
    </div>
  );
}

function DetallePrueba({
  prueba,
  inscritos,
  puedeInscribirse,
  estadoInscripcion,
  enviando,
  onSolicitar,
}: {
  prueba: CompetitionView;
  inscritos: Inscrito[] | null;
  puedeInscribirse: boolean;
  estadoInscripcion: string | null;
  enviando: boolean;
  onSolicitar: () => void;
}) {
  const tono = TONO[prueba.status.state];
  const horarios: [string, string][] = (
    [
      ['Apertura', prueba.installationOpen],
      ['Llamada', prueba.callTime],
      ['Scratch', prueba.scratchTime],
      ['Inicio', prueba.startTime],
    ] as [string, string | null][]
  ).filter((h): h is [string, string] => Boolean(h[1]));

  return (
    <div className="flex flex-col gap-3">
      {/* El plazo manda: cifra grande y la palabra al lado. */}
      <div className="flex items-baseline gap-2">
        {prueba.status.daysLeft !== null ? (
          <>
            <span className={cn('cifra text-6xl', tono.texto)}>
              {prueba.status.daysLeft}
            </span>
            <span className="text-sm text-muted-foreground">
              {prueba.status.daysLeft === 1 ? 'día' : 'días'} para el cierre
              {prueba.status.next?.origin === 'CALCULADO' ? ' (estimado)' : ''}
            </span>
          </>
        ) : (
          <span className={cn('text-sm font-medium', tono.texto)}>{tono.palabra}</span>
        )}
      </div>

      {prueba.deadlines.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {prueba.deadlines.map((d) => (
            <li
              key={`${d.type}-${d.deadlineAt.toISOString()}`}
              className="flex items-baseline justify-between gap-3"
            >
              <span className="text-muted-foreground">
                {d.label}
                {d.origin === 'CALCULADO' ? ' · estimado' : ' · publicado'}
              </span>
              <span className="tabular-nums">{formatDateEs(d.deadlineAt)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          La fuente no publica plazo para esta prueba.
        </p>
      )}

      {horarios.length > 0 ? (
        <dl className="grid grid-cols-4 gap-px overflow-hidden rounded-md bg-border">
          {horarios.map(([k, v]) => (
            <div key={k} className="flex flex-col items-center bg-card py-2">
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="cifra text-xl">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>Cuota: {formatEur(prueba.feeEur)}</span>
        {/* Los inscritos que publica la organización, que no son los mismos
            que los de esta aplicación: se distinguen a propósito. */}
        {prueba.registrationCount !== null ? (
          <span>{prueba.registrationCount} inscritos en la organización</span>
        ) : null}
        <span>{GENDER_LABEL[prueba.gender]}</span>
      </div>

      <QuienVa inscritos={inscritos} competitionId={prueba.id} />

      {estadoInscripcion ? (
        <Badge variant="secondary" className="w-fit">
          {estadoInscripcion}
        </Badge>
      ) : puedeInscribirse ? (
        <Button
          onClick={onSolicitar}
          disabled={enviando || prueba.status.closed}
          className="w-full"
        >
          {prueba.status.closed
            ? 'Inscripción cerrada'
            : enviando
              ? 'Enviando…'
              : 'Solicitar inscripción'}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          Esta prueba no es de tu arma, género o categoría. Puedes consultarla,
          pero no inscribirte.
        </p>
      )}
    </div>
  );
}

/**
 * Un enlace por fuente, no uno por fila.
 *
 * La FIE publica una página por prueba, así que un torneo con cuatro armas
 * traía cuatro enlaces «Ver en FIE» seguidos, todos con el mismo aspecto.
 * Se queda el primero de cada fuente: lo que se le ofrece a la persona es
 * «mira esto en el original», no un índice de la base de datos.
 */
function enlacesDeFuente(
  evento: EventView,
): { source: string; url: string }[] {
  const brutos =
    evento.sources.length > 0
      ? evento.sources
      : evento.sourceUrl
        ? [{ source: evento.source, url: evento.sourceUrl }]
        : [];

  const vistas = new Set<string>();
  const salida: { source: string; url: string }[] = [];
  for (const f of brutos) {
    if (!f.url || vistas.has(f.source)) continue;
    vistas.add(f.source);
    salida.push({ source: f.source, url: f.url });
  }
  return salida;
}

/**
 * Quién va a esta prueba.
 *
 * La pregunta que hoy se resuelve por WhatsApp. Son las inscripciones de
 * esta aplicación, no las de la organización: por eso lo dice, y por eso
 * cada nombre lleva en qué punto está su trámite. Si alguien se apuntó por
 * su cuenta en Skermo, aquí no sale, y prometer lo contrario sería peor que
 * no enseñar nada.
 */
function QuienVa({
  inscritos,
  competitionId,
}: {
  inscritos: Inscrito[] | null;
  competitionId: string;
}) {
  if (inscritos === null) {
    return <p className="text-sm text-muted-foreground">Mirando quién va…</p>;
  }

  const suyos = inscritos.filter((i) => i.competitionId === competitionId);

  if (suyos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Todavía no se ha apuntado nadie desde aquí.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm">
        <span className="cifra text-base">{suyos.length}</span>{' '}
        {suyos.length === 1 ? 'tirador apuntado' : 'tiradores apuntados'} desde esta
        aplicación
      </p>
      <ul className="flex flex-col gap-1">
        {suyos.map((i) => (
          <li
            key={`${i.nombre}-${i.competitionId}`}
            className="flex items-baseline justify-between gap-3 text-sm"
          >
            <span className="min-w-0 truncate">
              {i.nombre}
              {i.club ? (
                <span className="text-muted-foreground"> · {i.club}</span>
              ) : null}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {ENTRY_STATUS_LABEL[i.estado]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
