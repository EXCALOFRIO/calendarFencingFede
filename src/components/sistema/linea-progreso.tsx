'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

/**
 * Línea de progreso de 2 px bajo la cabecera (`docs/diseno-sistema.md` § 5.3).
 *
 * Sin esqueletos ni `loading.tsx`: mientras la navegación está en curso la
 * pantalla anterior sigue a la vista y la pestaña tocada ya se pintó marcada.
 * Si la espera pasa de 300 ms sale esta línea; antes, nunca — y al llegar la
 * pantalla nueva se apaga sola.
 *
 * Se arma con la History API: `pushState`/`replaceState` los llama el
 * enrutador para TODA navegación (enlace o `router.push`/`replace`) y
 * `popstate` cubre atrás/adelante. Se apaga cuando cambian
 * `usePathname`+`useSearchParams`, que es cuando la pantalla nueva se pinta.
 */
const RETARDO_MS = 300;

function LineaViva() {
  const pathname = usePathname() ?? '/';
  const params = useSearchParams();
  const ubicacion = `${pathname}?${params?.toString() ?? ''}`;
  const [visible, setVisible] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // La ubicación nueva ya está: apaga. Si la espera fue corta, el
  // temporizador se cancela antes de salir y la línea no llega a verse.
  useEffect(() => {
    clearTimeout(temporizador.current);
    setVisible(false);
  }, [ubicacion]);

  useEffect(() => {
    const armar = () => {
      clearTimeout(temporizador.current);
      temporizador.current = setTimeout(() => setVisible(true), RETARDO_MS);
    };
    const push = history.pushState;
    const replace = history.replaceState;
    /*
      La URL nueva se compara con la actual: el enrutador también escribe el
      mismo estado (scroll, árbol interno) sin que sea navegación, y un
      cambio de hash tampoco lo es — sólo arma una ruta o consulta distinta.
    */
    const vigilar = (original: History['pushState']) =>
      function (this: History, data: unknown, unused: string, url?: string | URL | null) {
        const destino = url == null ? null : new URL(url, location.href);
        if (destino && (destino.pathname !== location.pathname || destino.search !== location.search)) armar();
        return original.apply(this, [data, unused, url] as Parameters<History['pushState']>);
      };
    history.pushState = vigilar(push);
    history.replaceState = vigilar(replace);
    window.addEventListener('popstate', armar);
    return () => {
      history.pushState = push;
      history.replaceState = replace;
      window.removeEventListener('popstate', armar);
      clearTimeout(temporizador.current);
    };
  }, []);

  return visible ? <div aria-hidden className="sis-linea" /> : null;
}

/** `useSearchParams` dentro del Suspense, igual que la barra (`nav.tsx`). */
export function LineaProgreso() {
  return (
    <Suspense fallback={null}>
      <LineaViva />
    </Suspense>
  );
}
