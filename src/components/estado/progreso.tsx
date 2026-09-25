import {
  ENTRY_PROGRESS,
  ENTRY_STATUS_LABEL,
  type EntryStatus,
  progressIndex,
} from '@/lib/entries/state-machine';
import { cn } from '@/lib/utils';

/**
 * Etiqueta corta de cada paso.
 *
 * Debajo de la barra solo cabe una palabra en un iPhone, así que el nombre
 * completo del estado ("Validada por tu club") va en la frase que hay justo
 * debajo de la línea de progreso y en el `aria-label`: la abreviatura nunca
 * es la única forma de enterarse.
 */
const CORTO: Partial<Record<EntryStatus, string>> = {
  pending_club: 'Solicitada',
  club_approved: 'Tu club',
  federation_approved: 'La RFEE',
  submitted: 'Enviada',
};

/**
 * En qué punto está la inscripción: cuatro pasos y dónde está ahora.
 *
 * Es la pregunta que hoy se responde llamando por teléfono, así que se
 * contesta con una línea de progreso y no con una pastilla de estado suelta:
 * lo que importa no es solo dónde está, sino cuánto le queda.
 */
export function ProgresoInscripcion({ estado }: { estado: EntryStatus }) {
  const actual = progressIndex(estado);
  // Rechazada, retirada o en borrador no están en la línea: se explican con
  // una frase, que es lo que hace falta ahí.
  if (actual < 0) return null;

  return (
    <ol
      // Con más ancho los tramos se convierten en una barra gigante que no
      // dice nada: la línea de progreso se lee de un vistazo o no sirve.
      className="flex max-w-sm items-start gap-1.5"
      aria-label={`Inscripción: ${ENTRY_STATUS_LABEL[estado]}, paso ${actual + 1} de ${ENTRY_PROGRESS.length}`}
    >
      {ENTRY_PROGRESS.map((paso, i) => (
        <li key={paso} className="flex min-w-0 flex-1 flex-col gap-1">
          <span
            aria-hidden
            className={cn(
              'h-1 rounded-full',
              i <= actual ? 'bg-primary' : 'bg-muted',
            )}
          />
          <span
            className={cn(
              'truncate text-xs',
              i === actual
                ? 'font-medium text-primary-text'
                : 'text-muted-foreground',
            )}
          >
            {CORTO[paso] ?? ENTRY_STATUS_LABEL[paso]}
          </span>
        </li>
      ))}
    </ol>
  );
}
