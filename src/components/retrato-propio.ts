'use client';

import { useEffect, useState } from 'react';
import { fotoDe } from '@/components/explorar/foto-deportista';
import { anchoRetratoPara, retratoAncho } from '@/lib/sport/explorar/foto-contrato';

/**
 * Foto de la ficha deportiva de la cuenta, para la pestaña «Tú» de la barra.
 *
 * No va en el layout: resolver la ficha propia son varias lecturas en D1 y
 * la barra se pinta en todas las pantallas. Se pide después de pintar, una
 * vez por visita (y una hora en la caché privada del navegador). No se fía
 * de `useFichaPropia`, que vive en la pestaña del navegador y puede ser de
 * otra cuenta que entró antes. Sin ficha, sin foto o con un fallo, la
 * pestaña se queda con su icono.
 */
const personas = new Map<string, Promise<string | null>>();

async function pedirPersona(cuenta: string): Promise<string | null> {
  try {
    const r = await fetch(`/api/explorar/yo/retrato?cuenta=${encodeURIComponent(cuenta)}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) throw new Error('retrato');
    const valor = (await r.json()) as { estado?: unknown; personaId?: unknown };
    return valor.estado === 'ok' && typeof valor.personaId === 'string' ? valor.personaId : null;
  } catch {
    // Un fallo pasajero se olvida: la próxima pantalla lo vuelve a intentar.
    personas.delete(cuenta);
    return null;
  }
}

function personaDe(cuenta: string): Promise<string | null> {
  let p = personas.get(cuenta);
  if (!p) {
    p = pedirPersona(cuenta);
    personas.set(cuenta, p);
  }
  return p;
}

function despuesDePintar(tarea: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(tarea, { timeout: 2500 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(tarea, 800);
  return () => window.clearTimeout(id);
}

const MEDIDA = 24;

/** URL del retrato de 24 px, o `null` mientras no se sepa o si no hay. */
export function useRetratoPropio(cuenta: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!cuenta) return;
    let vigente = true;
    const cancelar = despuesDePintar(() => {
      void personaDe(cuenta)
        .then((id) => (id ? fotoDe(id, true) : null))
        .then((foto) => {
          if (!vigente) return;
          setSrc(foto ? (retratoAncho(foto.src, anchoRetratoPara(MEDIDA)) ?? foto.src) : null);
        });
    });
    return () => {
      vigente = false;
      cancelar();
    };
  }, [cuenta]);

  return src;
}
