'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { urlActual, useRecordadas } from './memoria-pestanas';
import { hrefDePestana, pestanaActiva, toquePestana, type DestinoBarra } from './navegacion';
import { SIN_MINIMO } from './tactil';

/**
 * Barra inferior única de la aplicación (`docs/diseno-sistema.md` § 1.1).
 *
 * 50 px de iconos más el área segura del iPhone. Sin rótulos por defecto: el
 * nombre va en `aria-label`. La pestaña marcada se distingue por el trazo
 * (2,4 frente a 1,7) y por el color, no por una pastilla de fondo.
 *
 * La precarga es por intención (puntero encima, dedo abajo o foco): las
 * pantallas son dinámicas y precargarlas todas al pintar la barra serían
 * cuatro renderizados de servidor por visita.
 *
 * Cada pestaña recuerda su última URL en sessionStorage (como Instagram):
 * volver al calendario desde Explorar lo deja en el mes y los filtros que
 * tenía. Se lee después de hidratar, así que el HTML del servidor siempre
 * apunta a las raíces.
 */
export type PropsBarraInferior = {
  destinos: readonly DestinoBarra[];
  /** Por defecto se deduce de la ruta. `null` no marca ninguna. */
  activa?: string | null;
  etiqueta?: string;
  /** `material`: translúcida con desenfoque real; sin soporte, sólida. */
  fondo?: 'solido' | 'material';
  /** `visibles` añade un rótulo de 10 px bajo cada icono. */
  rotulos?: 'ocultos' | 'visibles';
  /** `estatica` sólo para la página de muestra y los arneses. */
  posicion?: 'fija' | 'estatica';
  /** Desde 1024 px la navegación va en la cabecera. */
  soloMovil?: boolean;
  /**
   * La consulta de la URL (`useSearchParams().toString()`), si quien pinta la
   * barra la conoce: así los filtros que cambian sin cambiar de ruta también
   * se recuerdan al salir por un enlace que no es de la barra.
   */
  busqueda?: string;
  className?: string;
};

const FONDO = {
  solido: 'bg-background',
  material: cn(
    'bg-background',
    'supports-[backdrop-filter:blur(1px)]:bg-[color-mix(in_oklab,var(--background)_82%,transparent)]',
    'supports-[backdrop-filter:blur(1px)]:backdrop-blur-[20px] supports-[backdrop-filter:blur(1px)]:backdrop-saturate-[1.6]',
  ),
} as const;

export function BarraInferior({
  destinos,
  activa,
  etiqueta = 'Secciones',
  fondo = 'solido',
  rotulos = 'ocultos',
  posicion = 'fija',
  soloMovil = true,
  busqueda,
  className,
}: PropsBarraInferior) {
  const pathname = usePathname() ?? '/';
  const marcada = activa === undefined ? pestanaActiva(pathname, destinos) : activa;
  const fija = posicion === 'fija';
  const [recordadas, guardar] = useRecordadas();

  // Al llegar a una pantalla (y al cambiar la consulta, si se conoce); lo demás se guarda al salir por la barra.
  useEffect(() => {
    if (marcada && fija) guardar(marcada, urlActual());
  }, [pathname, busqueda, marcada, fija, guardar]);

  return (
    <nav
      aria-label={etiqueta}
      data-slot="sistema-barra-inferior"
      data-barra="app"
      className={cn(
        'border-t border-filete-alto pb-[env(safe-area-inset-bottom)]',
        FONDO[fondo],
        fija && 'fixed inset-x-0 bottom-0 z-40',
        soloMovil && 'lg:hidden',
        className,
      )}
      style={fija ? { viewTransitionName: 'barra-inferior' } : undefined}
    >
      <ul
        className="mx-auto grid h-[50px] max-w-[480px]"
        style={{ gridTemplateColumns: `repeat(${destinos.length}, minmax(0, 1fr))` }}
      >
        {destinos.map((d) => (
          <li key={d.clave} className="min-w-0">
            <Pestana
              destino={d}
              href={hrefDePestana(d, marcada, recordadas)}
              activa={marcada}
              pathname={pathname}
              conRotulo={rotulos === 'visibles'}
              alSalir={() => {
                if (marcada && fija) guardar(marcada, urlActual());
              }}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Pestana({
  destino,
  href,
  activa,
  pathname,
  conRotulo,
  alSalir,
}: {
  destino: DestinoBarra;
  href: string;
  activa: string | null;
  pathname: string;
  conRotulo: boolean;
  alSalir: () => void;
}) {
  const [intencion, setIntencion] = useState(false);
  const es = destino.clave === activa;
  const toque = toquePestana(pathname, destino, activa);
  const nombre = destino.insignia ? `${destino.etiqueta}, con novedades` : destino.etiqueta;
  const avisar = () => setIntencion(true);

  return (
    <Link
      href={href}
      prefetch={intencion}
      transitionTypes={toque.accion === 'navegar' ? toque.tipos : undefined}
      aria-label={conRotulo ? undefined : nombre}
      aria-current={es ? 'page' : undefined}
      data-pestana={destino.clave}
      onPointerEnter={avisar}
      onPointerDown={avisar}
      onFocus={avisar}
      onClick={(e) => {
        if (!es) alSalir();
        if (toque.accion !== 'subir') return;
        e.preventDefault();
        const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: 0, behavior: quieto ? 'auto' : 'smooth' });
      }}
      className={cn(
        'flex h-[50px] w-full flex-col items-center justify-center gap-[2px] outline-none select-none [-webkit-tap-highlight-color:transparent]',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        SIN_MINIMO,
      )}
    >
      <IconoPestana destino={destino} es={es} />
      {conRotulo ? (
        <span className={cn('text-[10px] leading-[12px] font-medium', es ? 'text-foreground' : 'text-muted-foreground')}>
          {destino.etiqueta}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * `useLinkStatus` sólo funciona dentro del `Link`. Mientras la pantalla nueva
 * se prepara, la pestaña tocada ya se pinta marcada: la respuesta al toque es
 * inmediata aunque la pantalla anterior siga a la vista.
 */
function IconoPestana({ destino, es }: { destino: DestinoBarra; es: boolean }) {
  const { pending } = useLinkStatus();
  const marcada = es || pending;
  const Icono = destino.icono;
  return (
    <span
      data-pendiente={pending || undefined}
      className={cn(
        'relative flex transition-[color,scale] duration-150 ease-out',
        marcada ? 'text-foreground' : 'text-muted-foreground',
        pending && 'scale-[0.92]',
      )}
    >
      <Icono className="size-[22px]" strokeWidth={marcada ? 2.4 : 1.7} aria-hidden />
      {destino.insignia ? (
        <span aria-hidden className="absolute -top-[1px] -right-[3px] size-[7px] rounded-full bg-primary ring-2 ring-background" />
      ) : null}
    </span>
  );
}
