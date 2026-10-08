'use client';

import { useSelectedLayoutSegment } from 'next/navigation';
import { useLayoutEffect, useRef, useState } from 'react';
import { SelectorSegmentado } from '@/components/sistema/selector-segmentado';
import { rutaSeccionPerfil, seccionDeSegmento, SECCIONES_PERFIL, type SeccionPerfil } from '@/lib/sport/explorar/perfil-secciones';

/**
 * Desplazamiento de cada sección ya vista, por persona. Vive en el módulo y
 * no en el estado: el layout del perfil no se desmonta entre secciones, pero
 * volver a la misma ficha desde otra pantalla también debe recordarlo.
 */
const DESPLAZAMIENTO = new Map<string, number>();

/**
 * Pestañas de sección del perfil, con rótulo. Cada una es un enlace a su
 * ruta que sustituye la entrada del historial (`replace`): cambiar de
 * sección no apila entradas y un solo Atrás sale del perfil. Con
 * `scroll={false}` Next no salta arriba; al volver a una sección ya vista se
 * recupera su desplazamiento y, en una nueva, la página sube como mucho
 * hasta las pestañas.
 *
 * Sin `loading.tsx` ni esqueletos: la sección anterior se queda a la vista
 * hasta que llega la nueva, pero la pestaña pulsada se marca al instante.
 * Cada sección se precarga sólo con intención (`EnlacePrecarga`). La activa
 * sale del segmento bajo el layout (`activa` sólo la fuerza para pintar sin
 * router).
 */
export function PestanasPerfil({
  personaId,
  secciones,
  activa,
}: {
  personaId: string;
  secciones: readonly SeccionPerfil[];
  activa?: SeccionPerfil;
}) {
  const segmento = useSelectedLayoutSegment();
  const actual = activa ?? seccionDeSegmento(segmento);
  // La pulsada vale mientras la URL no cambie; al llegar la sección nueva manda otra vez la URL.
  const [pulsada, setPulsada] = useState<{ desde: SeccionPerfil; a: SeccionPerfil } | null>(null);
  const marcada = pulsada && pulsada.desde === actual ? pulsada.a : actual;
  const lista = SECCIONES_PERFIL.filter((s) => secciones.includes(s.clave) || s.clave === actual);
  const caja = useRef<HTMLDivElement>(null);
  const anterior = useRef(actual);

  useLayoutEffect(() => {
    if (anterior.current === actual) return;
    anterior.current = actual;
    const guardado = DESPLAZAMIENTO.get(`${personaId}:${actual}`);
    if (guardado !== undefined) {
      window.scrollTo({ top: guardado, behavior: 'instant' });
      return;
    }
    // Sección nueva: si las pestañas quedaban por encima de la pantalla, se vuelve a ellas.
    if (caja.current && caja.current.getBoundingClientRect().top < 0) {
      caja.current.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }, [actual, personaId]);

  return (
    <div
      ref={caja}
      // El margen de arriba deja sitio a la cabecera fija; a lo ancho, las pestañas llegan al borde en el móvil.
      className="-mx-4 min-w-0 scroll-mt-16 sm:mx-0"
      onClickCapture={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        const enlace = (e.target as HTMLElement).closest('a');
        const destino = lista.find((s) => enlace?.getAttribute('href') === rutaSeccionPerfil(personaId, s.clave));
        if (!destino) return;
        DESPLAZAMIENTO.set(`${personaId}:${actual}`, window.scrollY);
        setPulsada(destino.clave === actual ? null : { desde: actual, a: destino.clave });
      }}
    >
      <SelectorSegmentado
        etiqueta="Secciones del perfil"
        variante="subrayado"
        anchoMinimo={4}
        replace
        scroll={false}
        valor={marcada}
        opciones={lista.map(({ clave, rotulo }) => ({
          valor: clave,
          etiqueta: rotulo,
          href: rutaSeccionPerfil(personaId, clave),
        }))}
      />
    </div>
  );
}

/**
 * Lo que el layout ya tiene leído y sólo se enseña en una sección (la tarjeta
 * de cifras en Estadísticas): así esa sección no vuelve a leer la ficha. Va
 * por el segmento real, no por la pestaña pulsada, para salir a la vez que el
 * resto de la sección.
 */
export function SoloEnSeccion({
  seccion,
  activa,
  children,
}: {
  seccion: SeccionPerfil;
  activa?: SeccionPerfil;
  children: React.ReactNode;
}) {
  const segmento = useSelectedLayoutSegment();
  return (activa ?? seccionDeSegmento(segmento)) === seccion ? <>{children}</> : null;
}
