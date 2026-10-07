'use client';

import { useLinkStatus } from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo } from 'react';
import { EnlacePrecarga } from '@/components/sistema/enlace-precarga';
import { leerFichaPropia, useFichaPropia } from '@/components/explorar/perfil/ficha-propia';
import { DESTINOS_APP, esRutaNeutra, hayBusqueda, pestanaDeRuta } from '@/components/navegacion-app';
import { useRetratoPropio } from '@/components/retrato-propio';
import { BarraInferior } from '@/components/sistema/barra-inferior';
import { confirmarPestana, pestanaAnotada, pestanaHeredada, useHerenciaLista } from '@/components/sistema/herencia-pestanas';
import { useRecordadas } from '@/components/sistema/memoria-pestanas';
import { hrefDePestana, toquePestana, type DestinoBarra } from '@/components/sistema/navegacion';
import { recordarSiEsSuya, resolverToque, useRouterOpcional } from '@/components/sistema/toque-pestana';
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

/**
 * La pestaña de una ruta con lo que se sabe AHORA, fuera del render: la ficha
 * propia ya apuntada y la pestaña heredada (la de la ruta actual) o anotada
 * (la de otra entrada del historial). La barra lo usa al guardar su memoria y
 * al volver a la raíz.
 */
export function deLaPestanaApp(clave: string, url: string): boolean {
  const [ruta, consulta = ''] = url.split('#')[0].split('?');
  const neutra = esRutaNeutra(ruta);
  const actual = typeof window !== 'undefined' && window.location.pathname === ruta;
  const heredada = actual ? pestanaHeredada(ruta, neutra) : pestanaAnotada(ruta);
  return pestanaDeRuta(ruta, hayBusqueda(new URLSearchParams(consulta)), leerFichaPropia(), heredada) === clave;
}

/**
 * Pestaña marcada: la de la ruta, la ficha propia en «Tú» y, en una ruta
 * neutra (persona, edición, país), la pestaña desde la que se abrió. Al
 * pintarse se confirma (sólo una vez hidratada: antes lo heredado no cuenta y
 * confirmar el prefijo borraría lo anotado).
 */
function usePestanaMarcada(pathname: string, conBusqueda: boolean, confirmar: boolean): string | null {
  const propia = useFichaPropia();
  const lista = useHerenciaLista();
  const neutra = esRutaNeutra(pathname);
  const activa = pestanaDeRuta(pathname, conBusqueda, propia, lista ? pestanaHeredada(pathname, neutra) : null);
  useEffect(() => {
    if (confirmar && lista) confirmarPestana(pathname, activa, neutra);
  }, [confirmar, lista, pathname, activa, neutra]);
  return activa;
}

/** Mientras no se conoce la consulta (`useSearchParams` sin resolver), sólo cuenta la ruta. */
function useUbicacion(confirmar: boolean): { pathname: string; busqueda: string; activa: string | null } {
  const pathname = usePathname() ?? '/';
  const params = useSearchParams();
  const activa = usePestanaMarcada(pathname, hayBusqueda(params), confirmar);
  return { pathname, busqueda: params?.toString() ?? '', activa };
}

/** «Tú» lleva la foto de la ficha propia en vez del icono, cuando la hay. */
function useDestinos(cuenta: string | undefined): readonly DestinoBarra[] {
  const retrato = useRetratoPropio(cuenta);
  return useMemo(
    () => (retrato ? DESTINOS_APP.map((d) => (d.clave === 'tu' ? { ...d, retrato } : d)) : DESTINOS_APP),
    [retrato],
  );
}

function BarraViva({ destinos }: { destinos: readonly DestinoBarra[] }) {
  // La barra del móvil es la que confirma la pestaña: está montada siempre (en escritorio, oculta por CSS).
  const { busqueda, activa } = useUbicacion(true);
  return <BarraInferior destinos={destinos} activa={activa} busqueda={busqueda} deLaPestana={deLaPestanaApp} />;
}

function BarraSinConsulta({ destinos }: { destinos: readonly DestinoBarra[] }) {
  const pathname = usePathname() ?? '/';
  const activa = usePestanaMarcada(pathname, false, false);
  return <BarraInferior destinos={destinos} activa={activa} deLaPestana={deLaPestanaApp} />;
}

/**
 * Barra inferior del móvil. `role` se acepta por compatibilidad: la barra es
 * igual para todos. `cuenta` (el `profileId` de la sesión) sólo sirve para
 * pedir la foto propia después de pintar; sin ella, «Tú» lleva el icono.
 */
export function NavMovil({ cuenta }: { role?: Role; cuenta?: string }) {
  const destinos = useDestinos(cuenta);
  return (
    <Suspense fallback={<BarraSinConsulta destinos={destinos} />}>
      <BarraViva destinos={destinos} />
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
  const u = useUbicacion(false);
  return <PastillasEscritorio {...u} />;
}

function PastillasEscritorio({ pathname, busqueda, activa }: { pathname: string | null; busqueda: string; activa: string | null }) {
  const ruta = usePathname() ?? '/';
  const sinConsulta = usePestanaMarcada(ruta, false, false);
  const marcada = pathname === null ? sinConsulta : activa;
  const [recordadas] = useRecordadas();

  useEffect(() => {
    recordarSiEsSuya(DESTINOS_APP, marcada, deLaPestanaApp);
  }, [ruta, busqueda, marcada]);

  return (
    <nav aria-label="Secciones" data-barra="escritorio" className="hidden items-center gap-[2px] lg:flex">
      {DESTINOS_APP.map((d) => (
        <PastillaEscritorio
          key={d.clave}
          destino={d}
          href={hrefDePestana(d, marcada, recordadas)}
          activa={marcada}
          pathname={ruta}
          alSalir={() => recordarSiEsSuya(DESTINOS_APP, marcada, deLaPestanaApp)}
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
  const router = useRouterOpcional();
  const es = destino.clave === activa;
  const toque = toquePestana(pathname, destino, activa);
  return (
    <EnlacePrecarga
      href={href}
      transitionTypes={toque.accion === 'navegar' ? toque.tipos : undefined}
      aria-current={es ? 'page' : undefined}
      data-pestana={destino.clave}
      onClick={(e) => {
        if (!es) alSalir();
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        if (resolverToque({ toque, destino, href, deLaPestana: deLaPestanaApp, router })) e.preventDefault();
      }}
      className="group relative flex h-[44px] items-center rounded-full outline-none [-webkit-tap-highlight-color:transparent]"
    >
      <ContenidoPastilla destino={destino} es={es} />
    </EnlacePrecarga>
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
        'inline-flex h-[34px] items-center gap-[6px] rounded-full px-[12px] text-[13px] transition-[color,background-color,scale] duration-150 ease-out group-active:scale-[0.96] group-focus-visible:ring-2 group-focus-visible:ring-ring',
        marcada ? 'bg-secondary font-semibold text-foreground' : 'font-medium text-muted-foreground group-hover:bg-accent group-hover:text-foreground',
      )}
    >
      <Icono className="size-[18px]" strokeWidth={marcada ? 2.4 : 2} aria-hidden />
      {destino.etiqueta}
    </span>
  );
}
