import { Check, Clock, FileText, X } from 'lucide-react';
import type { CallUpForAthlete } from '@/lib/callups/tipos';
import { PLACE_TYPE_LABEL } from '@/lib/callups/tipos';
import { cn, formatDateRangeEs, formatDateTimeEs, titular } from '@/lib/utils';

/**
 * Convocatorias pasadas, con lo que se respondió en su día.
 *
 * Es un registro, no una tarjeta: va apretado y sin oro. El oro significa
 * "tienes que hacer algo con esto" y aquí ya no hay nada que hacer. Se guarda
 * porque en una reclamación o en una revisión de criterios lo primero que se
 * pregunta es quién fue convocado a qué y qué contestó.
 */
export function Historico({
  convocatorias,
  mostrarNombre,
}: {
  convocatorias: CallUpForAthlete[];
  mostrarNombre: boolean;
}) {
  return (
    <ul className="flex flex-col">
      {convocatorias.map((c) => (
        <li
          key={c.id}
          className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b py-3 last:border-b-0"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {titular(c.eventName)}
              {mostrarNombre ? (
                <span className="font-normal text-muted-foreground">
                  {' '}
                  — {c.athleteName}
                </span>
              ) : null}
            </p>
            {/* Cada dato con su hueco, no encadenados con puntos medios. */}
            <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              <span>{formatDateRangeEs(c.eventStartDate, c.eventEndDate)}</span>
              {c.competition ? <span>{c.competition}</span> : null}
              <span>{PLACE_TYPE_LABEL[c.placeType].toLowerCase()}</span>
            </p>
            {c.rejectionReason ? (
              <p className="medida mt-0.5 text-xs text-muted-foreground">
                Motivo: {c.rejectionReason}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {c.pdfUrl ? (
              <a
                href={c.pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground transition-colors hover:text-foreground"
                aria-label={`PDF de ${c.eventName}`}
              >
                <FileText className="size-4" aria-hidden />
              </a>
            ) : null}
            <Respuesta convocatoria={c} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Respuesta({ convocatoria: c }: { convocatoria: CallUpForAthlete }) {
  const estilo = {
    confirmado: { clase: 'text-ok', icono: Check, texto: 'Fue' },
    rechazado: { clase: 'text-danger', icono: X, texto: 'No fue' },
    pendiente: { clase: 'text-muted-foreground', icono: Clock, texto: 'Sin responder' },
  }[c.status];

  const Icono = estilo.icono;

  return (
    <span className={cn('flex items-center gap-1.5 text-xs', estilo.clase)}>
      <Icono className="size-3.5" aria-hidden />
      {estilo.texto}
      {c.respondedAt ? (
        <span className="hidden text-muted-foreground sm:inline">
          {formatDateTimeEs(c.respondedAt).slice(0, 10)}
        </span>
      ) : null}
    </span>
  );
}
