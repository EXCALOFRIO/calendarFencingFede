'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useFichaPropia } from '@/components/explorar/perfil/ficha-propia';
import { DESTINOS_APP, hayBusqueda, pestanaDeRuta } from '@/components/navegacion-app';
import { BarraInferior } from '@/components/sistema/barra-inferior';
import { urlActual, useRecordadas } from '@/components/sistema/memoria-pestanas';
import { hrefDePestana, toquePestana, type DestinoBarra } from '@/components/sistema/navegacion';
import type { Role } from '@/lib/auth/session';
import { cn } from '@/lib/utils';

/**
 * Navegación de la aplicación: una sola barra, la misma para todos los
 * papeles y en todas las pantallas (`docs/diseno-sistema.md` § 1.1). En el
 * móvil es `BarraInferior`; desde 1024 px, los mismos cinco destinos en la
 * cabecera (§ 1.6). Lo que depende del papel (Mi estado, Tiradores,
 * Gestión) son filas de «Tú».
 *
 * Calendario y Explorar son dos pestañas de la misma barra: no hay un «modo
 * Explorar» con barra propia ni un botón de volver al calendario.
 */

/**
 * Marcado de los controles que eligen un valor (segmentos de `admin` y de
 * los filtros de Explorar). La barra ya no lo usa: se marca por trazo y color.
 */
export const ACTIVO =
  'bg-marcado font-semibold text-primary-text ring-1 ring-primary-text ring-inset';
export const INACTIVO = 'text-muted-foreground hover:bg-accent hover:text-foreground';

/** Mientras no se conoce la consulta (`useSearchParams` sin resolver), sólo cuenta la ruta. */
function useUbicacion(): { pathname: string; busqueda: string; activa: string | null } {
  const pathname = usePathname() ?? '/';
  const params = useSearchParams();
  const propia = useFichaPropia();
  return { pathname, busqueda: params?.toString() ?? '', activa: pestanaDeRuta(pathname, hayBusqueda(params), propia) };
}

function BarraViva() {
  const { busqueda, activa } = useUbicacion();
  return <BarraInferior destinos={DESTINOS_APP} activa={activa} busqueda={busqueda} />;
}

function BarraSinConsulta() {
  const pathname = usePathname() ?? '/';
  const propia = useFichaPropia();
  return <BarraInferior destinos={DESTINOS_APP} activa={pestanaDeRuta(pathname, false, propia)} />;
}

/** Barra inferior del móvil. `role` se acepta por compatibilidad: la barra es igual para todos. */
export function NavMovil(_props: { role?: Role }) {
  return (
    <Suspense fallback={<BarraSinConsulta />}>
      <BarraViva />
    </Suspense>
  );
}

/**
 * Los cinco destinos en la cabecera del escritorio: pastillas de 34 px con
 * icono de 18 y rótulo de 13. Mismas reglas que la barra del móvil (memoria
 * por pestaña, tocar la activa vuelve a su raíz o sube, precarga por
 * intención) y el mismo marcado: texto en `--foreground` semibold sobre
 * `--secondary`, sin contorno rojo.
 */
export function NavEscritorio(_props: { role?: Role }) {
  return (
    <Suspense fallback={<PastillasEscritorio pathname={null} busqueda="" activa={null} />}>
      <PastillasVivas />
    </Suspense>
  );
}

function PastillasVivas() {
  const u = useUbicacion();
  return <PastillasEscritorio {...u} />;
}

function PastillasEscritorio({ pathname, busqueda, activa }: { pathname: string | null; busqueda: string; activa: string | null }) {
  const ruta = usePathname() ?? '/';
  const propia = useFichaPropia();
  const marcada = pathname === null ? pestanaDeRuta(ruta, false, propia) : activa;
  const [recordadas, guardar] = useRecordadas();

  useEffect(() => {
    if (marcada) guardar(marcada, urlActual());
  }, [ruta, busqueda, marcada, guardar]);

  return (
    <nav aria-label="Secciones" data-barra="escritorio" className="hidden items-center gap-[2px] lg:flex">
      {DESTINOS_APP.map((d) => (
        <PastillaEscritorio
          key={d.clave}
          destino={d}
          href={hrefDePestana(d, marcada, recordadas)}
          activa={marcada}
          pathname={ruta}
          alSalir={() => {
            if (marcada) guardar(marcada, urlActual());
          }}
        />
      ))}
    </nav>
  );
}

function PastillaEscritorio({
  destino,
  href,
  activa,
  pathname,
  alSalir,
}: {
  destino: DestinoBarra;
  href: string;
  activa: string | null;
  pathname: string;
  alSalir: () => void;
}) {
  const [intencion, setIntencion] = useState(false);
  const es = destino.clave === activa;
  const toque = toquePestana(pathname, destino, activa);
  const avisar = () => setIntencion(true);
  return (
    <Link
      href={href}
      prefetch={intencion}
      transitionTypes={toque.accion === 'navegar' ? toque.tipos : undefined}
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
      className="group relative flex h-[44px] items-center rounded-full outline-none [-webkit-tap-highlight-color:transparent]"
    >
      <ContenidoPastilla destino={destino} es={es} />
    </Link>
  );
}

/** Dentro del `Link` para que `useLinkStatus` marque la pastilla tocada al instante. */
function ContenidoPastilla({ destino, es }: { destino: DestinoBarra; es: boolean }) {
  const { pending } = useLinkStatus();
  const marcada = es || pending;
  const Icono = destino.icono;
  return (
    <span
      data-pendiente={pending || undefined}
      className={cn(
        'inline-flex h-[34px] items-center gap-[6px] rounded-full px-[12px] text-[13px] transition-colors duration-150 ease-out group-focus-visible:ring-2 group-focus-visible:ring-ring',
        marcada ? 'bg-secondary font-semibold text-foreground' : 'font-medium text-muted-foreground group-hover:bg-accent group-hover:text-foreground',
      )}
    >
      <Icono className="size-[18px]" strokeWidth={marcada ? 2.4 : 2} aria-hidden />
      {destino.etiqueta}
    </span>
  );
}
