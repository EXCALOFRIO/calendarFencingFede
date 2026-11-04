'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import type { ToasterProps } from 'sonner';

/**
 * Se emite justo antes de un `toast()`: quien avisa pide `sonner` con
 * `await import('sonner')` y dispara este evento para que el avisador se
 * monte con el trozo ya caliente. Los avisos quedan en el almacén de la
 * librería y se pintan al montar.
 */
export const EVENTO_AVISO = 'calendarfencing:aviso';

/** Antes de `toast.success/error`: monta el avisador y luego avisa. */
export async function avisar(tipo: 'success' | 'error', mensaje: string): Promise<void> {
  window.dispatchEvent(new Event(EVENTO_AVISO));
  const { toast } = await import('sonner');
  toast[tipo](mensaje);
}

/**
 * El avisador (`sonner`, ~40 KB con `next-themes`) en su propio trozo.
 *
 * - `alPrimerAviso` (la aplicación): no se descarga ni se monta hasta que
 *   algo avisa (`avisar` / `EVENTO_AVISO`). Casi ninguna visita manda un
 *   aviso, así que son 40 KB que no se piden ni se evalúan.
 * - Sin ella (la gestión, donde los paneles ya traen `sonner` en su
 *   bundle): se monta al hidratar, en un rato libre, fuera de la carga
 *   inicial gracias al `dynamic`.
 */
const ToasterDiferido = dynamic<ToasterProps>(
  () => import('./sonner').then((m) => m.Toaster),
  { ssr: false },
);

export function AvisosApp({
  alPrimerAviso = false,
  ...props
}: ToasterProps & { alPrimerAviso?: boolean }) {
  const [necesario, setNecesario] = useState(!alPrimerAviso);

  useEffect(() => {
    if (!alPrimerAviso) return;
    const montar = () => setNecesario(true);
    window.addEventListener(EVENTO_AVISO, montar);
    return () => window.removeEventListener(EVENTO_AVISO, montar);
  }, [alPrimerAviso]);

  return necesario ? <ToasterDiferido {...props} /> : null;
}
