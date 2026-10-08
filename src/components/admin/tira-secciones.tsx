'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { PANTALLAS_ADMIN, TITULO_CORTO } from '@/components/admin/admin-screens';
import { ACTIVO, INACTIVO } from '@/components/nav';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * Secciones del panel.
 *
 * En el móvil la barra inferior no llega hasta aquí (solo caben cinco
 * secciones y «Gestión» es la séptima), así que esto es la única forma de
 * moverse entre las secciones del panel desde un teléfono. Por eso va en el
 * layout y no en la portada.
 *
 * Son nueve: envueltas ocuparían tres pisos de un iPhone antes del primer
 * dato, y una tira que se desplaza de lado escondía la sección activa. En el
 * móvil van en un desplegable de una línea; desde 640 px, en filas que saltan.
 */
export function TiraSecciones() {
  const pathname = usePathname();
  const router = useRouter();

  const delMenu = ['/admin', ...PANTALLAS_ADMIN.map((p) => p.href)];

  /*
    `/admin/inscripciones` se sacó del índice pero sigue viva por URL: si la
    sección de ahora no está en el menú se añade, o nada saldría como activo.
  */
  const enlaces = delMenu.includes(pathname) ? delMenu : [...delMenu, pathname];
  const esActivo = (href: string) => (href === '/admin' ? pathname === '/admin' : pathname.startsWith(href));
  const actual = enlaces.filter(esActivo).sort((a, b) => b.length - a.length)[0] ?? '/admin';

  return (
    <nav aria-label="Secciones de gestión">
      <div className="sm:hidden">
        <Select value={actual} onValueChange={(href) => router.push(href)}>
          <SelectTrigger aria-label="Sección de gestión" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {enlaces.map((href) => (
              <SelectItem key={href} value={href}>
                {TITULO_CORTO[href] ?? href}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ul className="hidden flex-wrap gap-1 sm:flex">
        {enlaces.map((href) => {
          const activo = esActivo(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={activo ? 'page' : undefined}
                className={cn('block rounded-md px-3 py-2 text-sm font-medium transition-colors', activo ? ACTIVO : INACTIVO)}
              >
                {TITULO_CORTO[href] ?? href}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
