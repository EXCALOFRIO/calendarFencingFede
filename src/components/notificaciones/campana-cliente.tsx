'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { CAJA_TACTIL, clasesCirculo } from './control';

const RUTA = '/notificaciones';
/** Con la pestaña visible; oculta no se pregunta nada. */
const CADA_MS = 60_000;

export function etiquetaCampana(n: number): string {
  return n === 0 ? 'Notificaciones' : `Notificaciones, ${n} sin leer`;
}

/*
 * El contador es uno por pestaña del navegador aunque haya dos campanas
 * montadas (la de la cabecera del móvil y la del escritorio; una de las dos
 * está oculta por CSS): una sola petición en vuelo, un solo temporizador.
 */
const oyentes = new Set<(n: number) => void>();
let enVuelo: Promise<void> | null = null;
let ultimaPeticion = 0;
let parar: (() => void) | null = null;
/** Dos campanas que se montan a la vez piden una vez. */
const ENTRE_PETICIONES_MS = 1_500;

function refrescar(): Promise<void> {
  if (enVuelo) return enVuelo;
  if (Date.now() - ultimaPeticion < ENTRE_PETICIONES_MS) return Promise.resolve();
  enVuelo = (async () => {
    try {
      const r = await fetch('/api/notificaciones', { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) return;
      const datos = (await r.json()) as { noLeidas?: unknown };
      if (typeof datos.noLeidas === 'number' && Number.isFinite(datos.noLeidas)) {
        for (const o of oyentes) o(datos.noLeidas as number);
      }
    } catch {
      // Sin red se queda el último número conocido.
    } finally {
      ultimaPeticion = Date.now();
      enVuelo = null;
    }
  })();
  return enVuelo;
}

function arrancar(): () => void {
  let temporizador: ReturnType<typeof setInterval> | null = null;
  const programar = () => {
    if (temporizador) clearInterval(temporizador);
    temporizador = document.visibilityState === 'visible' ? setInterval(() => void refrescar(), CADA_MS) : null;
  };
  const alCambiar = () => {
    if (document.visibilityState === 'visible') void refrescar();
    programar();
  };
  const alMensaje = (e: MessageEvent) => {
    if ((e.data as { tipo?: string } | null)?.tipo === 'notificacion') {
      ultimaPeticion = 0;
      void refrescar();
    }
  };
  programar();
  document.addEventListener('visibilitychange', alCambiar);
  navigator.serviceWorker?.addEventListener('message', alMensaje);
  return () => {
    if (temporizador) clearInterval(temporizador);
    document.removeEventListener('visibilitychange', alCambiar);
    navigator.serviceWorker?.removeEventListener('message', alMensaje);
  };
}

/**
 * El botón de la campana con su punto. Arranca con el número que pinta el
 * servidor y se mantiene al día solo: al volver a la pestaña, cada minuto
 * mientras se ve, al cambiar de pantalla y cuando el trabajador de servicio
 * avisa de que ha llegado un push.
 */
export function CampanaCliente({ inicial, className }: { inicial: number; className?: string }) {
  const [noLeidas, setNoLeidas] = React.useState(inicial);
  const [intencion, setIntencion] = React.useState(false);
  const avisar = () => setIntencion(true);
  const pathname = usePathname();

  React.useEffect(() => {
    setNoLeidas(inicial);
  }, [inicial]);

  React.useEffect(() => {
    oyentes.add(setNoLeidas);
    if (oyentes.size === 1) parar = arrancar();
    return () => {
      oyentes.delete(setNoLeidas);
      if (oyentes.size === 0) {
        parar?.();
        parar = null;
      }
    };
  }, []);

  React.useEffect(() => {
    void refrescar();
  }, [pathname]);

  const activa = pathname === RUTA;
  return (
    <Link
      href={RUTA}
      // Por intención: la campana se pinta en todas las cabeceras y precargarla al verla sería un render de servidor por pantalla.
      prefetch={intencion}
      onPointerEnter={avisar}
      onPointerDown={avisar}
      onFocus={avisar}
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
    </Link>
  );
}
