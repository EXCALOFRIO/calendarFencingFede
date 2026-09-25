import { CalendarClock, MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DEADLINE_TYPE_LABEL, etiquetaRecargo } from '@/lib/deadlines';
import { ENTRY_STATUS_LABEL } from '@/lib/entries/state-machine';
import type { MyEntry } from '@/lib/queries/my-status';
import {
  CATEGORY_LABEL,
  GENDER_SHORT,
  WEAPON_LABEL,
  cn,
  formatDateEs,
  formatDateRangeEs,
  titular,
} from '@/lib/utils';
import type { PuntosDePrueba } from '@/app/(app)/estado/consultas';
import { ProgresoInscripcion } from './progreso';

/** Color del semáforo de plazos. Nunca va solo: siempre lleva su palabra. */
const TONO = {
  verde: 'text-ok',
  ambar: 'text-warn',
  rojo: 'text-danger',
  cerrado: 'text-muted-foreground',
  sin_datos: 'text-muted-foreground',
} as const;

export function nombrePrueba(e: MyEntry): string {
  const categoria =
    CATEGORY_LABEL[e.category as keyof typeof CATEGORY_LABEL] ?? e.category;
  return `${WEAPON_LABEL[e.weapon]} ${GENDER_SHORT[e.gender]} ${categoria}`;
}

/**
 * En quién está la pelota, dicho con todas las letras y con la fecha desde la
 * que está parada ahí. Sin la fecha, "pendiente de tu club" no dice si hay
 * que preocuparse o no.
 */
function enQuienEsta(e: MyEntry): string {
  const fecha = e.since ? formatDateEs(e.since) : null;
  switch (e.status) {
    case 'draft':
      return 'Está en borrador: todavía no la has solicitado.';
    case 'pending_club':
      return fecha
        ? `Esperando a que tu club la valide desde el ${fecha}.`
        : 'Esperando a que tu club la valide.';
    case 'club_approved':
      return `Tu club la validó${fecha ? ` el ${fecha}` : ''}. Ahora la tiene que aceptar la RFEE.`;
    case 'federation_approved':
      return `La RFEE la aceptó${fecha ? ` el ${fecha}` : ''}. Falta enviarla a la organización.`;
    case 'submitted':
      return 'Enviada a la organización. No tienes que hacer nada más.';
    case 'rejected':
      return e.reason
        ? `Rechazada. Motivo: ${e.reason}`
        : 'Rechazada, sin motivo anotado. Pregunta en tu club.';
    case 'withdrawn':
      return e.reason ? `Retirada. Motivo: ${e.reason}` : 'Retirada.';
  }
}

/**
 * El próximo hito y qué pasa al pasarlo, en una línea.
 *
 * El recargo se dice como lo dice `etiquetaRecargo`: si la fuente no lo
 * publica se escribe "recargo no publicado", nunca "sin recargo". En la base
 * real las 382 fechas límite tienen el importe vacío, así que la diferencia
 * entre las dos frases es la diferencia entre informar y mentir.
 */
function proximoHito(e: MyEntry): string | null {
  const siguiente = e.deadlineStatus.next;
  if (!siguiente) return null;

  const etiqueta =
    siguiente.label || DEADLINE_TYPE_LABEL[siguiente.type] || 'Próximo plazo';
  const cuando = formatDateEs(siguiente.deadlineAt);
  const estimado = siguiente.origin === 'CALCULADO' ? ' (estimado)' : '';

  const recargo = etiquetaRecargo(siguiente.surchargeEur);
  const despues = siguiente.blocking
    ? 'después no se puede inscribir'
    : recargo.tono === 'warn'
      ? `después, ${recargo.texto}`
      : 'recargo posterior no publicado';

  return `${etiqueta}: ${cuando}${estimado} · ${despues}`;
}

/** Columna izquierda: la cifra manda, y al lado la palabra pequeña. */
function Cuenta({
  entrada,
  esHoy,
  fuera,
}: {
  entrada: MyEntry;
  esHoy: boolean;
  fuera: boolean;
}) {
  const estado = entrada.deadlineStatus;

  // En una rechazada o retirada, los días de plazo ya no significan nada: el
  // hueco se deja vacío para que las filas sigan alineadas.
  if (fuera) return <div className="w-14 shrink-0" />;

  if (esHoy) {
    return (
      <div className="w-14 shrink-0">
        <span className="cifra block text-2xl text-primary-text">Hoy</span>
        <span className="block text-xs text-muted-foreground">compites</span>
      </div>
    );
  }

  if (estado.daysLeft !== null) {
    return (
      <div className="w-14 shrink-0">
        <span className={cn('cifra block text-4xl', TONO[estado.state])}>
          {estado.daysLeft}
        </span>
        <span className="block text-xs text-muted-foreground">
          {estado.daysLeft === 1 ? 'día' : 'días'}
        </span>
      </div>
    );
  }

  return (
    <div className="w-14 shrink-0">
      <span className="block text-sm text-muted-foreground">
        {estado.closed ? 'Plazo cerrado' : 'Plazo no publicado'}
      </span>
    </div>
  );
}

export function FilaInscripcion({
  entrada,
  esHoy,
  conNombre,
}: {
  entrada: MyEntry;
  esHoy: boolean;
  /** El nombre del tirador solo hace falta si se están viendo varios. */
  conNombre: boolean;
}) {
  const hito = proximoHito(entrada);
  const fuera = entrada.status === 'rejected' || entrada.status === 'withdrawn';
  const recargoVigente = entrada.deadlineStatus.currentSurchargeEur
    ? etiquetaRecargo(entrada.deadlineStatus.currentSurchargeEur)
    : null;

  return (
    <li className="flex gap-4 py-4">
      <Cuenta entrada={entrada} esHoy={esHoy} fuera={fuera} />

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-1">
          <h3 className="text-lg">{titular(entrada.eventName)}</h3>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="size-3.5 shrink-0" aria-hidden />
              {formatDateRangeEs(entrada.startDate, entrada.endDate)}
            </span>
            {entrada.city ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{titular(entrada.city)}</span>
              </span>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{nombrePrueba(entrada)}</Badge>
          {entrada.format === 'EQUIPOS' ? (
            <Badge variant="outline">Equipos</Badge>
          ) : null}
          {conNombre ? (
            <span className="text-sm text-muted-foreground">
              {entrada.athleteName}
            </span>
          ) : null}
        </div>

        {fuera ? (
          <p className="text-sm text-danger">{enQuienEsta(entrada)}</p>
        ) : (
          <>
            <ProgresoInscripcion estado={entrada.status} />
            <p className="text-sm">{enQuienEsta(entrada)}</p>
          </>
        )}

        {hito && !fuera ? (
          <p className="text-sm text-muted-foreground">{hito}</p>
        ) : null}

        {/* Solo si hay un importe publicado de verdad: "Sin recargo" es una
            afirmación que casi nunca hace la fuente, y aquí no se hace. */}
        {recargoVigente?.tono === 'warn' ? (
          <p className="text-sm text-warn">
            Inscribirse ahora ya lleva {recargoVigente.texto} de recargo.
          </p>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Panel del día de competición: lo único que importa cuando ya estás en el
 * pabellón son las horas que publica la organización.
 */
export function PanelHoy({
  entrada,
  conNombre,
}: {
  entrada: MyEntry;
  conNombre: boolean;
}) {
  const horarios = (
    [
      ['Apertura', entrada.installationOpen],
      ['Llamada', entrada.callTime],
      ['Scratch', entrada.scratchTime],
      ['Inicio', entrada.startTime],
    ] as [string, string | null][]
  ).filter((h): h is [string, string] => Boolean(h[1]));

  return (
    <div className="flex max-w-2xl flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg">{titular(entrada.eventName)}</h3>
        <p className="text-sm text-muted-foreground">
          {nombrePrueba(entrada)}
          {entrada.city ? ` · ${titular(entrada.city)}` : ''}
          {conNombre ? ` · ${entrada.athleteName}` : ''}
        </p>
      </div>

      {horarios.length > 0 ? (
        <dl className="grid grid-cols-4 gap-2 text-center">
          {horarios.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="cifra text-lg">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">
          La organización no ha publicado los horarios de esta prueba.
        </p>
      )}

      <p className="text-sm">
        Tu inscripción está en «{ENTRY_STATUS_LABEL[entrada.status]}».
      </p>
    </div>
  );
}

/** Competición ya celebrada: resultado y lo que dejó en el ranking. */
export function FilaPasada({
  entrada,
  puntos,
  conNombre,
}: {
  entrada: MyEntry;
  puntos: PuntosDePrueba | null;
  conNombre: boolean;
}) {
  return (
    <li className="flex gap-4 py-4">
      <div className="w-14 shrink-0">
        {entrada.resultPosition !== null ? (
          <>
            <span className="cifra block text-4xl">{entrada.resultPosition}</span>
            <span className="block text-xs text-muted-foreground">puesto</span>
          </>
        ) : (
          <span className="block text-sm text-muted-foreground">
            Sin resultado
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="text-base">{titular(entrada.eventName)}</h3>
        <p className="text-sm text-muted-foreground">
          {formatDateRangeEs(entrada.startDate, entrada.endDate)} ·{' '}
          {nombrePrueba(entrada)}
          {conNombre ? ` · ${entrada.athleteName}` : ''}
        </p>

        {entrada.resultPosition === null ? (
          <p className="text-sm text-muted-foreground">
            La fuente todavía no ha publicado el resultado de esta prueba.
          </p>
        ) : null}

        {puntos ? (
          <p className="text-sm">
            <span className="cifra text-base">{puntos.finalPoints}</span> puntos
            para el ranking
            {puntos.cuenta
              ? ', y entran en tu total de la temporada.'
              : ', pero no entran en tu total: tienes mejores resultados.'}
          </p>
        ) : entrada.resultPoints ? (
          <p className="text-sm text-muted-foreground">
            Puntos oficiales de la fuente:{' '}
            <span className="cifra text-base text-foreground">
              {entrada.resultPoints}
            </span>
          </p>
        ) : null}
      </div>
    </li>
  );
}
