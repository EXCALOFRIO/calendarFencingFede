'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { RUTA_EXPLORAR } from '@/lib/sport/explorar/url';

/**
 * Qué ficha es la de la cuenta, para que la barra marque «Tú» (de donde se
 * abre como «Mi perfil deportivo») y no Explorar. La ruta es la misma que la
 * de cualquier otra ficha, así que la cabecera del perfil lo apunta aquí al
 * pintarse y se recuerda en la pestaña del navegador (`sessionStorage`): la
 * siguiente vez la barra ya lo sabe antes de que llegue la ficha.
 */
const CLAVE = 'perfil:ficha-propia';
let actual: string | null | undefined;
const oyentes = new Set<() => void>();

function leer(): string | null {
  if (actual === undefined) {
    try {
      actual = window.sessionStorage.getItem(CLAVE);
    } catch {
      actual = null;
    }
  }
  return actual ?? null;
}

function suscribir(oyente: () => void) {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

function apuntar(ruta: string, propia: boolean) {
  const antes = leer();
  // Una ficha ajena sólo borra lo apuntado si era esa misma (otra cuenta en la misma pestaña).
  const nueva = propia ? ruta : antes === ruta ? null : antes;
  if (nueva === antes) return;
  actual = nueva;
  try {
    if (nueva) window.sessionStorage.setItem(CLAVE, nueva);
    else window.sessionStorage.removeItem(CLAVE);
  } catch {
    /* sin almacenamiento: vale para esta visita */
  }
  for (const o of oyentes) o();
}

/** Ruta de la ficha propia (`/explorar/<id>`) o `null` si no se conoce. */
export function useFichaPropia(): string | null {
  return useSyncExternalStore(suscribir, leer, () => null);
}

/** Lo pinta la cabecera del perfil: no se ve. */
export function MarcaFichaPropia({ personaId, propia }: { personaId: string; propia: boolean }) {
  useEffect(() => {
    apuntar(`${RUTA_EXPLORAR}/${personaId}`, propia);
  }, [personaId, propia]);
  return null;
}
