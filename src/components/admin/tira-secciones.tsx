'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PANTALLAS_ADMIN, TITULO_CORTO } from '@/components/admin/admin-screens';
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

  const enlaces = [{ href: '/admin' }, ...PANTALLAS_ADMIN];

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
            aria-current={activo ? 'page' : undefined}
            className={cn(
              'shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              activo
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {TITULO_CORTO[href] ?? href}
          </Link>
        );
      })}
    </nav>
  );
}
