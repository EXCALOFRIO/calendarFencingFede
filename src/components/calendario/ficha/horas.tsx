'use client';

import { Clock } from 'lucide-react';
import type { EventView } from '@/lib/queries/calendar';
import {
  cambiaLaHora,
  enHuso,
  mismoReloj,
  siglasHuso,
  useHusoDispositivo,
} from '@/lib/huso-dispositivo';
import { titular } from '@/lib/utils';

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
  // «Takamatsu», no «Takamatsu City»: en una línea de reloj el «City» solo ocupa sitio.
  const ciudad = evento.city ? titular(evento.city).replace(/\s+city$/i, '') : null;

  const aviso =
    cambiaAlli && !cambiaAqui && !mismo
      ? 'Cambio de hora en la sede'
      : cambiaAqui && !cambiaAlli && !mismo
        ? 'Cambio de hora aquí'
        : 'Cambio de hora ese fin de semana';

  return (
    <div className="flex flex-col gap-1 text-sm text-muted-foreground">
      {mismo ? null : (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1" title={siglasHuso(husoSede, evento.startDate)}>
          <Clock className="size-4 shrink-0" aria-hidden />
          {/*
            Un reloj no coincide entre el HTML del servidor y la hidratación si
            cae en el cambio de minuto; `suppressHydrationWarning` es la salida
            que React documenta para marcas de tiempo.
          */}
          <span suppressHydrationWarning className="font-semibold text-foreground tabular-nums">
            {enHuso(ahora, husoSede).hora}
          </span>
          <span>{ciudad ? `en ${ciudad}` : 'allí'}</span>
          <span aria-hidden>·</span>
          <span suppressHydrationWarning className="tabular-nums">
            {enHuso(ahora, huso).hora}
          </span>
          <span>tu hora</span>
        </p>
      )}
      {cambiaAlli || cambiaAqui ? <p className="text-xs text-warn">{aviso}</p> : null}
    </div>
  );
}
