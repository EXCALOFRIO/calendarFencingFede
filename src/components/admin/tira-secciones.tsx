'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';
import { PANTALLAS_ADMIN, TITULO_CORTO } from '@/components/admin/admin-screens';
import { ACTIVO, INACTIVO } from '@/components/nav';
import { cn } from '@/lib/utils';

/**
 * Tira de secciones del panel.
 *
 * En el móvil la barra inferior no llega hasta aquí (solo caben cinco
 * secciones y «Gestión» es la séptima), así que esta tira es la única forma
 * de moverse entre las secciones del panel desde un teléfono. Por eso va en
 * el layout y no en la portada.
 *
 * Se desplaza en horizontal en vez de apilarse en tres pisos: un menú de
 * ocho elementos envuelto ocupa media pantalla de un iPhone antes de que se
 * vea ni un dato.
 */
export function TiraSecciones() {
  const pathname = usePathname();

  const delMenu = ['/admin', ...PANTALLAS_ADMIN.map((p) => p.href)];

  /**
   * Las secciones del menú, más la de ahora si no está en el menú.
   *
   * `/admin/inscripciones` se sacó del índice pero sigue viva por URL. Sin
   * este añadido, al entrar en ella la tira no marcaba nada como activo y no
   * había forma de saber en qué sección estabas: pintaba ocho pestañas y
   * ninguna encendida.
   */
  const enlaces = delMenu.includes(pathname)
    ? delMenu.map((href) => ({ href }))
    : [...delMenu, pathname].map((href) => ({ href }));

  /**
   * La pestaña de ahora se trae a la vista.
   *
   * Son nueve y la tira se desplaza en horizontal: en un iPhone caben tres y
   * media, así que al entrar en «Ajustes» —o en «Inscripciones», que va al
   * final por no estar en el menú— la pestaña encendida quedaba fuera de
   * pantalla y la tira mentía: parecía que estabas en la portada. Se comprobó
   * en captura.
   *
   * `block: 'nearest'` es lo que evita que el navegador desplace también la
   * página en vertical para centrar la tira.
   */
  const activa = React.useRef<HTMLAnchorElement | null>(null);
  React.useEffect(() => {
    activa.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pathname]);

  return (
    <nav
      aria-label="Secciones de gestión"
      className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 pb-1"
    >
      {enlaces.map(({ href }) => {
        const activo = href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            ref={activo ? activa : undefined}
            aria-current={activo ? 'page' : undefined}
            /*
              El par activo/inactivo se importa de la barra de navegación en
              vez de repetirse aquí. Estaba copiado letra por letra, y una
              convención escrita dos veces son dos convenciones en cuanto
              alguien toca una: la barra de arriba y esta tira se ven seguidas
              en la misma pantalla de gestión.
            */
            className={cn(
              'shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              activo ? ACTIVO : INACTIVO,
            )}
          >
            {TITULO_CORTO[href] ?? href}
          </Link>
        );
      })}
    </nav>
  );
}
