'use client';

import { Clock } from 'lucide-react';
import type { EventView } from '@/lib/queries/calendar';
import {
  cambiaLaHora,
  convertirHora,
  enHuso,
  mismoReloj,
  siglasHuso,
  useHusoDispositivo,
} from '@/lib/huso-dispositivo';
import { cn, titular } from '@/lib/utils';

/**
 * Una hora de la sede pasada a la hora del dispositivo: «02:00 tu hora».
 *
 * Si con el cambio el día ya no es el mismo se dice con palabras —«día
 * antes»—: las 07:00 del jueves en Tokio son las 00:00 del jueves en Madrid,
 * pero las 06:30 son las 23:30 del miércoles, y quien mira la hora de llamada
 * para poner el despertador tiene que saberlo.
 */
export function HoraEnTuHuso({
  fecha,
  hora,
  husoSede,
  className,
}: {
  fecha: string;
  hora: string;
  husoSede: string;
  className?: string;
}) {
  const huso = useHusoDispositivo();
  const tuya = convertirHora(fecha, hora, husoSede, huso);
  if (!tuya) return <span className={className} />;

  return (
    <span
      className={cn(
        'flex flex-col items-end text-right leading-none whitespace-nowrap',
        className,
      )}
    >
      <span className="cifra text-base text-foreground/80 sm:text-sm">
        {tuya.hora}
        <span className="sr-only"> tu hora</span>
      </span>
      {/* «tu hora» ya lo dice la cabecera de la columna; aquí solo el día cuando cambia. */}
      {tuya.dias !== 0 ? (
        <span className="pt-0.5 text-[11px] text-warn">
          {tuya.dias < 0 ? 'día antes' : 'día después'}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Qué hora es ahora en la sede y en el dispositivo, en una línea.
 *
 * Sustituye a «7 horas más que en España (allí van adelantados)», que obligaba
 * a hacer la cuenta y daba por hecho que quien mira está en España. Cuando los
 * dos relojes coinciden no hay nada que decir y la línea no sale, salvo que
 * ese fin de semana cambie la hora.
 */
export function RelojSede({ evento }: { evento: EventView }) {
  const huso = useHusoDispositivo();
  const husoSede = evento.timezone;
  if (!husoSede) return null;

  const mismo = mismoReloj(husoSede, huso, evento.startDate);
  const cambiaAlli = cambiaLaHora(husoSede, evento.startDate, evento.endDate);
  const cambiaAqui = cambiaLaHora(huso, evento.startDate, evento.endDate);
  if (mismo && !cambiaAlli && !cambiaAqui) return null;

  const ahora = new Date();
  /*
    «Takamatsu», no «Takamatsu City»: la FIE escribe así el nombre de la
    ciudad y en una línea de reloj el «City» solo ocupa sitio.
  */
  const ciudad = evento.city ? titular(evento.city).replace(/\s+city$/i, '') : null;

  // Dos o tres palabras: el porqué se entiende solo.
  const aviso =
    cambiaAlli && !cambiaAqui && !mismo
      ? 'Cambio de hora en la sede'
      : cambiaAqui && !cambiaAlli && !mismo
        ? 'Cambio de hora aquí'
        : 'Cambio de hora ese fin de semana';

  return (
    <div className="flex flex-col gap-1 text-sm text-muted-foreground">
      {mismo ? null : (
        <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5" title={siglasHuso(husoSede, evento.startDate)}>
          <Clock className="size-3.5 shrink-0 self-center" aria-hidden />
          {/*
            La hora de ahora es un reloj, y un reloj no coincide entre el HTML
            del servidor y la hidratación si cae justo en el cambio de minuto.
            `suppressHydrationWarning` es la salida que React documenta para
            marcas de tiempo: se queda con la del servidor y no rehace el
            árbol. Que el minuto vaya un segundo atrasado da igual.
          */}
          <span suppressHydrationWarning className="cifra text-base text-foreground">
            {enHuso(ahora, husoSede).hora}
          </span>
          <span>{ciudad ? `en ${ciudad}` : 'allí'}</span>
          <span aria-hidden>·</span>
          <span suppressHydrationWarning className="cifra text-base text-foreground/80">
            {enHuso(ahora, huso).hora}
          </span>
          <span>tu hora</span>
        </p>
      )}
      {cambiaAlli || cambiaAqui ? <p className="text-xs text-warn">{aviso}</p> : null}
    </div>
  );
}
