'use client';

import {
  CalendarDays,
  ChevronDown,
  Ellipsis,
  FileText,
  Gauge,
  Medal,
  Settings,
  Trophy,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { Role } from '@/lib/auth/session';
import { cn } from '@/lib/utils';

type Destino = {
  href: string;
  etiqueta: string;
  icono: React.ComponentType<{ className?: string }>;
  /** Una línea de explicación. Solo se pinta en «Más», que tiene sitio. */
  detalle: string;
  /** Sin `roles`, lo ve todo el mundo. */
  roles?: Role[];
};

/**
 * ===========================================================================
 * NAVEGACIÓN
 * ===========================================================================
 *
 * La aplicación **es el calendario**. Todo lo demás es secundario, y el menú
 * tiene que decirlo. Antes había siete pestañas para todo el mundo: una barra
 * de siete destinos no es navegación, es un índice, y obliga a leer siete
 * palabras para encontrar la única que se usa.
 *
 * Dos niveles, y nada más:
 *
 * - **Principales**: lo que se abre varias veces por semana. Como mucho
 *   cuatro, y dependen del papel de cada uno. Un tirador ve tres.
 * - **«Más»**: lo que se consulta de vez en cuando (el ranking, la
 *   normativa) y lo que no cabe en la barra del móvil. Nunca se esconde
 *   nada sin decirlo: si un destino no está en la barra, está aquí.
 *
 * Qué NO es esto: ni una hamburguesa con todo dentro —esconder el calendario
 * detrás de tres rayas en una aplicación cuya única pantalla importante es el
 * calendario— ni una barra superior de enlaces en el móvil.
 *
 * Por qué «Mi estado» solo es de tirador y tutor: enseña el estado de TUS
 * inscripciones. Un seleccionador no se inscribe en nada; lo suyo es
 * «Tiradores». La dirección técnica igual. Las dos rutas siguen abiertas por
 * URL para quien tenga sesión, simplemente no ocupan un sitio en la barra de
 * quien no las va a tocar.
 */
const PRINCIPALES: Destino[] = [
  {
    href: '/',
    etiqueta: 'Calendario',
    icono: CalendarDays,
    detalle: 'La temporada entera, filtrada por tu arma y tu categoría.',
  },
  {
    href: '/estado',
    etiqueta: 'Mi estado',
    icono: Gauge,
    detalle: 'En qué punto está cada inscripción y qué te falta.',
    roles: ['athlete', 'guardian'],
  },
  {
    href: '/convocatorias',
    etiqueta: 'Selección',
    icono: Medal,
    detalle: 'Convocatorias de la selección española y su respuesta.',
  },
  {
    href: '/tiradores',
    etiqueta: 'Tiradores',
    icono: Users,
    detalle: 'Quién va a cada competición, arma por arma.',
    roles: ['coach', 'admin'],
  },
  {
    href: '/admin',
    etiqueta: 'Gestión',
    icono: Settings,
    detalle: 'Usuarios, cargas de datos, cuarentena y emparejado.',
    roles: ['admin'],
  },
];

/** Consulta ocasional: no merece un sitio fijo en la barra. */
const SECUNDARIOS: Destino[] = [
  {
    href: '/ranking',
    etiqueta: 'Ranking',
    icono: Trophy,
    detalle: 'Puestos y puntos de la temporada, con su desglose.',
  },
  {
    href: '/documentos',
    etiqueta: 'Normativa',
    icono: FileText,
    detalle: 'Circulares de la RFEE, con buscador.',
  },
];

/**
 * Cuántos destinos caben en la barra del móvil antes de «Más».
 *
 * Tres más «Más» son cuatro celdas: a 390 px salen a 97 px cada una, que es
 * donde «Calendario» todavía cabe en una línea. Con cinco se parten las
 * palabras y empiezan las abreviaturas tipo «Convoca.».
 */
const TOPE_MOVIL = 3;

function activo(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

function repartir(role: Role): { barra: Destino[]; mas: Destino[] } {
  const principales = PRINCIPALES.filter((d) => !d.roles || d.roles.includes(role));
  const secundarios = SECUNDARIOS.filter((d) => !d.roles || d.roles.includes(role));
  return { barra: principales, mas: secundarios };
}

/**
 * Barra superior, a partir de 1024 px.
 *
 * Los principales como pestañas y un «Más» con el resto. Para la dirección
 * técnica son cuatro pestañas y un desplegable; para un tirador, tres.
 */
export function NavEscritorio({ role }: { role: Role }) {
  const pathname = usePathname();
  const { barra, mas } = repartir(role);
  const masActivo = mas.some((d) => activo(pathname, d.href));

  return (
    <nav aria-label="Secciones" className="hidden items-center gap-1 lg:flex">
      {barra.map((destino) => {
        const es = activo(pathname, destino.href);
        return (
          <Link
            key={destino.href}
            href={destino.href}
            aria-current={es ? 'page' : undefined}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              es
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {destino.etiqueta}
          </Link>
        );
      })}

      {mas.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              'flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors outline-none',
              'focus-visible:ring-[3px] focus-visible:ring-ring/50',
              masActivo
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            Más
            <ChevronDown className="size-3.5" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            {mas.map((destino) => {
              const Icono = destino.icono;
              const es = activo(pathname, destino.href);
              return (
                <DropdownMenuItem key={destino.href} asChild>
                  <Link
                    href={destino.href}
                    aria-current={es ? 'page' : undefined}
                    className="items-start gap-2.5 py-2"
                  >
                    <Icono className={cn('mt-0.5', es && 'text-primary-text')} />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span
                        className={cn('font-medium', es && 'text-primary-text')}
                      >
                        {destino.etiqueta}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {destino.detalle}
                      </span>
                    </span>
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </nav>
  );
}

/**
 * Barra inferior del móvil.
 *
 * Antes cortaba la lista con `slice(0, 5)`: a la dirección técnica le
 * desaparecían destinos de la barra sin ningún aviso, y en el móvil la barra
 * era la única navegación que había. Ahora lo que no cabe cae en «Más», que
 * abre una hoja con el resto y con lo secundario, cada cosa con una línea de
 * qué es.
 */
export function NavMovil({ role }: { role: Role }) {
  const pathname = usePathname();
  const [abierto, setAbierto] = useState(false);
  const hoja = useRef<HTMLDivElement>(null);

  const { barra, mas } = repartir(role);
  const visibles = barra.slice(0, TOPE_MOVIL);
  const restantes = [...barra.slice(TOPE_MOVIL), ...mas];
  const masActivo = restantes.some((d) => activo(pathname, d.href));
  const celdas = visibles.length + (restantes.length > 0 ? 1 : 0);

  // Al navegar desde la hoja, la hoja sobra.
  useEffect(() => {
    setAbierto(false);
  }, [pathname]);

  return (
    <>
      <nav
        aria-label="Secciones"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <ul
          className="mx-auto grid max-w-lg"
          style={{ gridTemplateColumns: `repeat(${celdas}, 1fr)` }}
        >
          {visibles.map((destino) => {
            const es = activo(pathname, destino.href);
            const Icono = destino.icono;
            return (
              <li key={destino.href}>
                <Link
                  href={destino.href}
                  aria-current={es ? 'page' : undefined}
                  className={cn(
                    'flex h-14 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium transition-colors',
                    es ? 'text-primary-text' : 'text-muted-foreground',
                  )}
                >
                  <Icono className="size-5" />
                  {destino.etiqueta}
                </Link>
              </li>
            );
          })}

          {restantes.length > 0 ? (
            <li>
              <button
                type="button"
                onClick={() => setAbierto(true)}
                aria-haspopup="dialog"
                aria-expanded={abierto}
                className={cn(
                  'flex h-14 w-full flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium transition-colors',
                  masActivo ? 'text-primary-text' : 'text-muted-foreground',
                )}
              >
                <Ellipsis className="size-5" />
                Más
              </button>
            </li>
          ) : null}
        </ul>
      </nav>

      <Sheet open={abierto} onOpenChange={setAbierto}>
        <SheetContent
          ref={hoja}
          /*
           * Al abrirse, la hoja enfocaba sola su aspa de cerrar, y el aro de
           * foco carmesí en la esquina era lo primero que veías: parecía un
           * aviso. El foco va a la hoja —que es lo que anuncia el lector de
           * pantalla— y el tabulador ya lleva al primer destino.
           */
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            hoja.current?.focus();
          }}
          side="bottom"
          className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-xl pb-[calc(1.5rem+env(safe-area-inset-bottom))] lg:hidden"
        >
          <SheetHeader className="pb-1">
            <SheetTitle className="text-base">Más secciones</SheetTitle>
            <SheetDescription>Lo que no se mira todos los días.</SheetDescription>
          </SheetHeader>

          <ul className="px-2">
            {restantes.map((destino) => {
              const es = activo(pathname, destino.href);
              const Icono = destino.icono;
              return (
                <li key={destino.href}>
                  <Link
                    href={destino.href}
                    aria-current={es ? 'page' : undefined}
                    className={cn(
                      'flex min-h-14 items-start gap-3 rounded-lg px-2 py-3 transition-colors active:bg-accent',
                      es && 'bg-secondary',
                    )}
                  >
                    <Icono
                      className={cn(
                        'mt-0.5 size-5 shrink-0',
                        es ? 'text-primary-text' : 'text-muted-foreground',
                      )}
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span
                        className={cn(
                          'text-sm font-medium',
                          es && 'text-primary-text',
                        )}
                      >
                        {destino.etiqueta}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {destino.detalle}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
