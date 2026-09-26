'use client';

import {
  CalendarDays,
  FileText,
  Gauge,
  Medal,
  Settings,
  Trophy,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Role } from '@/lib/auth/session';
import { cn } from '@/lib/utils';

type Destino = {
  href: string;
  etiqueta: string;
  /** Etiqueta más corta para la barra del móvil, cuando la larga no cabe. */
  corta?: string;
  icono: React.ComponentType<{ className?: string }>;
  /** Sin `roles`, lo ve todo el mundo. */
  roles?: Role[];
};

/**
 * ===========================================================================
 * NAVEGACIÓN
 * ===========================================================================
 *
 * La aplicación **es el calendario**. Todo lo demás es secundario.
 *
 * **Todos los destinos están a la vista, sin desplegables.** Había un menú
 * «Más» con el ranking y la normativa dentro, y el usuario lo rechazó por lo
 * mismo que se rechaza cualquier submenú: para llegar al ranking hacían falta
 * dos toques y uno de ellos era abrir una cosa que no dice qué hay dentro.
 * Petición literal: *«no me gusta lo de Más, mételo directo»*.
 *
 * Cuántos hay, por papel:
 *
 *   tirador y tutor     Calendario · Mi estado · Selección · Ranking · Normativa
 *   club                Calendario · Selección · Ranking · Normativa
 *   seleccionador       Calendario · Selección · Tiradores · Ranking · Normativa
 *   dirección técnica   + Gestión
 *
 * Cinco caben en la barra del móvil a 393 px con la etiqueta entera. La
 * dirección técnica llega a seis y por eso tiene etiquetas cortas: es la
 * única que lo necesita, y prefiere ver «Gestión» a que se lo esconda un
 * menú.
 *
 * Qué NO es esto: ni una hamburguesa con todo dentro —esconder el calendario
 * detrás de tres rayas en una aplicación cuya única pantalla importante es el
 * calendario— ni una barra superior de enlaces en el móvil.
 *
 * Por qué «Mi estado» solo es de tirador y tutor: enseña el estado de TUS
 * inscripciones. Un seleccionador no se inscribe en nada; lo suyo es
 * «Tiradores». Las rutas siguen abiertas por URL para quien tenga sesión,
 * simplemente no ocupan un sitio en la barra de quien no las va a tocar.
 */
const DESTINOS: Destino[] = [
  {
    href: '/',
    etiqueta: 'Calendario',
    corta: 'Calendario',
    icono: CalendarDays,
  },
  {
    href: '/estado',
    etiqueta: 'Mi estado',
    corta: 'Estado',
    icono: Gauge,
    roles: ['athlete', 'guardian'],
  },
  {
    href: '/convocatorias',
    etiqueta: 'Selección',
    corta: 'Selección',
    icono: Medal,
  },
  {
    href: '/tiradores',
    etiqueta: 'Tiradores',
    corta: 'Tiradores',
    icono: Users,
    roles: ['coach', 'admin'],
  },
  {
    href: '/ranking',
    etiqueta: 'Ranking',
    corta: 'Ranking',
    icono: Trophy,
  },
  {
    href: '/documentos',
    etiqueta: 'Normativa',
    corta: 'Normativa',
    icono: FileText,
  },
  {
    href: '/admin',
    etiqueta: 'Gestión',
    corta: 'Gestión',
    icono: Settings,
    roles: ['admin'],
  },
];

function activo(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

function visibles(role: Role): Destino[] {
  return DESTINOS.filter((d) => !d.roles || d.roles.includes(role));
}

/** Barra superior, a partir de 1024 px. Todos los destinos, sin desplegables. */
export function NavEscritorio({ role }: { role: Role }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Secciones" className="hidden items-center gap-0.5 lg:flex">
      {visibles(role).map((destino) => {
        const es = activo(pathname, destino.href);
        return (
          <Link
            key={destino.href}
            href={destino.href}
            aria-current={es ? 'page' : undefined}
            className={cn(
              'rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
              es
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {destino.etiqueta}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Barra inferior del móvil.
 *
 * Fija abajo, que es donde llega el pulgar, y con el hueco del área segura
 * del iPhone. Cada celda es icono + palabra: el icono solo no se entiende
 * —«Gauge» no significa «mi estado» para nadie— y la palabra sola en una
 * barra de seis se lee mal.
 *
 * El tamaño de la letra baja un punto cuando hay seis destinos, que solo le
 * pasa a la dirección técnica. Se mide, no se adivina: `npm run barrido`
 * falla si algo desborda.
 */
export function NavMovil({ role }: { role: Role }) {
  const pathname = usePathname();
  const destinos = visibles(role);
  const apretada = destinos.length > 5;

  return (
    <nav
      aria-label="Secciones"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul
        className="mx-auto grid max-w-xl"
        style={{ gridTemplateColumns: `repeat(${destinos.length}, minmax(0, 1fr))` }}
      >
        {destinos.map((destino) => {
          const es = activo(pathname, destino.href);
          const Icono = destino.icono;
          return (
            <li key={destino.href} className="min-w-0">
              <Link
                href={destino.href}
                aria-current={es ? 'page' : undefined}
                className={cn(
                  'flex h-14 flex-col items-center justify-center gap-0.5 px-0.5 font-medium transition-colors',
                  apretada ? 'text-[0.6rem]' : 'text-[0.68rem]',
                  es ? 'text-primary-text' : 'text-muted-foreground',
                )}
              >
                <Icono className={apretada ? 'size-4' : 'size-5'} />
                <span className="w-full truncate text-center">
                  {destino.corta ?? destino.etiqueta}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
