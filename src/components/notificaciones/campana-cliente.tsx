'use client';

import { Bell } from 'lucide-react';
import { EnlacePrecarga } from '@/components/sistema/enlace-precarga';
import { usePathname } from 'next/navigation';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { CAJA_TACTIL, clasesCirculo } from './control';
import { consultarAlVolver, crearContadorAvisos, INTERVALO_AVISOS_MS } from './contador-cliente';

const RUTA = '/notificaciones';

export function etiquetaCampana(n: number): string {
  return n === 0 ? 'Notificaciones' : `Notificaciones, ${n} sin leer`;
}

/*
 * El contador es uno por pestaña del navegador aunque haya dos campanas
 * montadas (la de la cabecera del móvil y la del escritorio; una de las dos
 * está oculta por CSS): una sola petición en vuelo, un solo temporizador.
 */
let suscripciones = 0;
let parar: (() => void) | null = null;
const contador = crearContadorAvisos({
  async obtener(signal) {
    const r = await fetch('/api/notificaciones', { cache: 'no-store', credentials: 'same-origin', signal });
    if (!r.ok) return null;
    const datos = await r.json() as { noLeidas?: unknown };
    return typeof datos.noLeidas === 'number' ? datos.noLeidas : null;
  },
});

function arrancar(): () => void {
  let temporizador: ReturnType<typeof setInterval> | null = null;
  let ocultaDesde: number | null = document.visibilityState === 'visible' ? null : Date.now();
  const refrescar = (forzar = false) => {
    if (document.visibilityState === 'visible' && navigator.onLine !== false) void contador.refrescar(forzar);
  };
  const programar = () => {
    if (temporizador) clearInterval(temporizador);
    temporizador = document.visibilityState === 'visible' ? setInterval(() => refrescar(), INTERVALO_AVISOS_MS) : null;
  };
  const alCambiar = () => {
    if (document.visibilityState === 'visible') {
      refrescar(consultarAlVolver(ocultaDesde, Date.now()));
      ocultaDesde = null;
    } else {
      ocultaDesde ??= Date.now();
    }
    programar();
  };
  const alMensaje = (e: MessageEvent) => {
    if ((e.data as { tipo?: string } | null)?.tipo === 'notificacion') refrescar(true);
  };
  const alVolver = () => refrescar(true);
  programar();
  document.addEventListener('visibilitychange', alCambiar);
  window.addEventListener('online', alVolver);
  navigator.serviceWorker?.addEventListener('message', alMensaje);
  return () => {
    if (temporizador) clearInterval(temporizador);
    document.removeEventListener('visibilitychange', alCambiar);
    window.removeEventListener('online', alVolver);
    navigator.serviceWorker?.removeEventListener('message', alMensaje);
  };
}

/**
 * El botón de la campana con su punto. Arranca con el número que pinta el
 * servidor y se mantiene al día al volver a la pestaña tras un minuto oculta,
 * cada cinco minutos mientras se ve y cuando llega un push. Cambiar de ruta no repite la consulta.
 */
export function CampanaCliente({ inicial, cuenta, lectura = 0, className }: {
  inicial: number;
  /** Sin cuenta (maquetas SSR) no se hace ninguna petición. */
  cuenta?: string;
  lectura?: number;
  className?: string;
}) {
  const [noLeidas, setNoLeidas] = React.useState(inicial);
  const pathname = usePathname();

  React.useEffect(() => {
    setNoLeidas(inicial);
    if (cuenta) contador.lecturaServidor(cuenta, { numero: inicial, revision: lectura });
  }, [inicial, lectura, cuenta]);

  React.useEffect(() => {
    if (!cuenta) return;
    const quitar = contador.suscribir(cuenta, { numero: inicial, revision: lectura }, setNoLeidas);
    suscripciones += 1;
    if (suscripciones === 1) parar = arrancar();
    return () => {
      quitar();
      suscripciones -= 1;
      if (suscripciones === 0) {
        parar?.();
        parar = null;
      }
    };
  }, [cuenta, inicial, lectura]);

  const activa = pathname === RUTA;
  return (
    <EnlacePrecarga
      href={RUTA}
      // Por intención: la campana se pinta en todas las cabeceras y precargarla al verla sería un render de servidor por pantalla.
      aria-label={etiquetaCampana(noLeidas)}
      aria-current={activa ? 'page' : undefined}
      data-no-leidas={noLeidas}
      data-slot="campana"
      className={cn(CAJA_TACTIL, className)}
    >
      {/* Se ve como `BotonIcono` lg (36 px); la caja del enlace mide 44 (ver `control.tsx`). */}
      <span className={clasesCirculo('fantasma', activa ? 'bg-accent' : undefined)}>
        <Bell aria-hidden strokeWidth={2} />
        {/* Un punto, nunca un número (`docs/diseno-sistema.md` § 1.1); la cifra va en la etiqueta accesible. */}
        {noLeidas > 0 ? (
          <span aria-hidden data-punto className="absolute top-[6px] right-[7px] size-[7px] rounded-full bg-primary ring-2 ring-background" />
        ) : null}
      </span>
    </EnlacePrecarga>
  );
}
