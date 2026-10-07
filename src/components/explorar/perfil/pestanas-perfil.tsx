'use client';

import { ChartColumn, ListOrdered, Medal, Sparkles, Users, type LucideIcon } from 'lucide-react';
import { useSelectedLayoutSegment } from 'next/navigation';
import { useState } from 'react';
import { EnlacePrecarga } from '@/components/sistema/enlace-precarga';
import { rutaSeccionPerfil, seccionDeSegmento, SECCIONES_PERFIL, type SeccionPerfil } from '@/lib/sport/explorar/perfil-secciones';
import { cn } from '@/lib/utils';

const ICONO: Record<SeccionPerfil, LucideIcon> = {
  resultados: ListOrdered,
  estadisticas: ChartColumn,
  rivales: Users,
  curiosidades: Sparkles,
  ranking: Medal,
};

/**
 * Pestañas de sección del perfil, como las de un perfil de Instagram: un
 * icono de 20 px y, desde `sm`, el rótulo al lado. Cada una es un enlace a su
 * ruta, así que se ve una sección cada vez y la URL la recuerda.
 *
 * Sin `loading.tsx` ni esqueletos: la sección anterior se queda a la vista
 * hasta que llega la nueva, pero la pestaña pulsada se marca al instante.
 * Cada sección se precarga sólo con intención (puntero encima, dedo o foco):
 * precargarlas todas al ver el perfil serían cuatro renderizados de servidor
 * por visita. La activa sale del segmento bajo el layout del perfil
 * (`activa` sólo la fuerza para pintar sin router).
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
  return (
    <nav aria-label="Secciones del perfil" className="min-w-0 border-b">
      <ul className="flex min-w-0">
        {lista.map(({ clave, rotulo }) => {
          const Icono = ICONO[clave];
          const activo = clave === marcada;
          return (
            <li key={clave} className="flex min-w-0 flex-1 sm:flex-none">
              <EnlacePrecarga
                href={rutaSeccionPerfil(personaId, clave)}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  setPulsada(clave === actual ? null : { desde: actual, a: clave });
                }}
                aria-current={clave === actual ? 'page' : undefined}
                title={rotulo}
                data-seccion={clave}
                data-marcada={activo || undefined}
                className={cn(
                  // 44 px de alto táctil con el icono de 20 px, en px para que la raíz de 18 px no los agrande; el subrayado de la activa va pegado al filete.
                  'relative -mb-px flex h-[44px] min-w-0 flex-1 items-center justify-center gap-[6px] border-b-2 px-[8px] text-[13px] font-medium sm:px-[16px]',
                  'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                  activo ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <Icono className="size-[20px] shrink-0" strokeWidth={activo ? 2.25 : 1.75} aria-hidden />
                <span className="sr-only sm:not-sr-only sm:truncate">{rotulo}</span>
              </EnlacePrecarga>
            </li>
          );
        })}
      </ul>
    </nav>
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
