'use client';

import { useLinkStatus } from 'next/link';
import { EnlacePrecarga } from './enlace-precarga';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useRecordadas } from './memoria-pestanas';
import { hrefDePestana, pestanaActiva, toquePestana, type DestinoBarra } from './navegacion';
import { redHolgada } from './red-cliente';
import { SIN_MINIMO } from './tactil';
import { recordarSiEsSuya, resolverToque, useRouterOpcional, type DeLaPestana } from './toque-pestana';

/**
 * Barra inferior única de la aplicación (`docs/diseno-sistema.md` § 1.1).
 *
 * 50 px de iconos más el área segura del iPhone. Sin rótulos por defecto: el
 * nombre va en `aria-label`. La pestaña marcada se distingue por el trazo
 * (2,4 frente a 1,7) y por el color, no por una pastilla de fondo. Un
 * destino con `retrato` pinta esa foto (24 px) en vez del icono en cuanto
 * carga, con un aro fino cuando está marcado.
 *
 * Precarga (§ 5.4): por intención (ratón detenido, foco de teclado y al
 * poner el dedo en una pestaña) y, una vez por sesión y solo en 4G sin
 * ahorro de datos, las raíces de las demás pestañas cuando el navegador
 * está ocioso. Nunca al pintar: son pantallas dinámicas.
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
  /**
   * `cristal` (por defecto): el cristal del sistema (`.cristal`), sólido sin
   * soporte o con transparencia reducida. `solido` para muestras y arneses.
   */
  fondo?: 'solido' | 'cristal';
  /** `visibles` añade un rótulo de 12 px bajo cada icono. */
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
  /**
   * Qué ruta es de qué pestaña con lo que se sabe en el momento (la ficha
   * propia, la pestaña heredada). Se usa al guardar la memoria (para no
   * guardar una dirección bajo una pestaña ajena) y al volver a la raíz.
   */
  deLaPestana?: DeLaPestana;
  className?: string;
};

const FONDO = {
  solido: 'bg-background border-filete-alto',
  cristal: 'cristal',
} as const;

const CLAVE_PRECARGA_OCIOSA = 'sistema:pestanas-precargadas';

type OpcionesPrecarga = Parameters<ReturnType<typeof useRouter>['prefetch']>[1];
// `router.prefetch` por defecto solo trae la parte estática, que en estas rutas dinámicas es casi nada.
const PRECARGA_COMPLETA = { kind: 'full' } as unknown as OpcionesPrecarga;

function useRouterPrecarga() {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

/**
 * Una vez por sesión, con el navegador ocioso y en 4G sin ahorro de datos,
 * precarga las raíces de las pestañas que no están a la vista. Así el primer
 * cambio de pestaña no espera al servidor.
 */
function usePrecargaOciosa(destinos: readonly DestinoBarra[], marcada: string | null, activa: boolean) {
  const router = useRouterPrecarga();
  useEffect(() => {
    if (!activa || !router || !redHolgada()) return;
    try {
      if (sessionStorage.getItem(CLAVE_PRECARGA_OCIOSA)) return;
    } catch {
      return;
    }
    const precargar = () => {
      if (!redHolgada()) return;
      try {
        sessionStorage.setItem(CLAVE_PRECARGA_OCIOSA, '1');
      } catch {
        return;
      }
      for (const d of destinos) if (d.clave !== marcada) router.prefetch(d.href, PRECARGA_COMPLETA);
    };
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(precargar, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(precargar, 2000);
    return () => clearTimeout(t);
  }, [activa, router, destinos, marcada]);
}

export function BarraInferior({
  destinos,
  activa,
  etiqueta = 'Secciones',
  fondo = 'cristal',
  rotulos = 'ocultos',
  posicion = 'fija',
  soloMovil = true,
  busqueda,
  deLaPestana,
  className,
}: PropsBarraInferior) {
  const pathname = usePathname() ?? '/';
  const marcada = activa === undefined ? pestanaActiva(pathname, destinos) : activa;
  const fija = posicion === 'fija';
  const [recordadas] = useRecordadas();

  // Al llegar a una pantalla (y al cambiar la consulta, si se conoce); lo demás se guarda al salir por la barra.
  useEffect(() => {
    if (fija) recordarSiEsSuya(destinos, marcada, deLaPestana);
  }, [pathname, busqueda, marcada, fija, destinos, deLaPestana]);

  usePrecargaOciosa(destinos, marcada, fija);

  return (
    <nav
      aria-label={etiqueta}
      data-slot="sistema-barra-inferior"
      data-barra="app"
      className={cn(
        'border-t pb-[env(safe-area-inset-bottom)]',
        FONDO[fondo],
        // Capa propia y quieta: sin ella iOS la repinta con la página al desplazar y se ve temblar.
        fija && 'fixed inset-x-0 bottom-0 z-40 [transform:translateZ(0)] [backface-visibility:hidden]',
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
              deLaPestana={deLaPestana}
              alSalir={() => {
                if (fija) recordarSiEsSuya(destinos, marcada, deLaPestana);
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
  deLaPestana,
  alSalir,
}: {
  destino: DestinoBarra;
  href: string;
  activa: string | null;
  pathname: string;
  conRotulo: boolean;
  deLaPestana?: DeLaPestana;
  alSalir: () => void;
}) {
  const router = useRouterOpcional();
  const es = destino.clave === activa;
  const toque = toquePestana(pathname, destino, activa);
  const nombre = destino.insignia ? `${destino.etiqueta}, con novedades` : destino.etiqueta;

  return (
    <EnlacePrecarga
      href={href}
      alPulsar={!es}
      transitionTypes={toque.accion === 'navegar' ? toque.tipos : undefined}
      aria-label={conRotulo ? undefined : nombre}
      aria-current={es ? 'page' : undefined}
      data-pestana={destino.clave}
      onClick={(e) => {
        if (!es) alSalir();
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        if (resolverToque({ toque, destino, href, deLaPestana, router })) e.preventDefault();
      }}
      className={cn(
        'group flex h-[50px] w-full flex-col items-center justify-center gap-1 outline-none select-none [-webkit-tap-highlight-color:transparent]',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        SIN_MINIMO,
      )}
    >
      <IconoPestana destino={destino} es={es} />
      {conRotulo ? (
        <span className={cn('text-xs leading-none font-medium', es ? 'text-foreground' : 'text-muted-foreground')}>
          {destino.etiqueta}
        </span>
      ) : null}
    </EnlacePrecarga>
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
  const [retratoListo, setRetratoListo] = useState<string | null>(null);
  const conRetrato = !!destino.retrato && retratoListo === destino.retrato;
  return (
    <span
      data-pendiente={pending || undefined}
      data-marcada={marcada || undefined}
      className={cn(
        'relative flex size-[24px] items-center justify-center transition-[color,scale] duration-150 ease-out',
        'group-active:scale-[0.86]',
        marcada ? 'text-foreground sis-marcar' : 'text-muted-foreground',
        pending && 'scale-[0.92]',
      )}
    >
      {conRetrato ? null : <Icono className="size-[22px]" strokeWidth={marcada ? 2.4 : 1.7} aria-hidden />}
      {destino.retrato ? (
        // Imagen nativa a propósito: las fotos son de la FIE y Next no debe copiarlas.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={destino.retrato}
          alt=""
          width={24}
          height={24}
          decoding="async"
          referrerPolicy="no-referrer"
          data-retrato=""
          onLoad={() => setRetratoListo(destino.retrato ?? null)}
          onError={() => setRetratoListo(null)}
          className={cn(
            'absolute inset-0 size-[24px] rounded-full bg-secondary object-cover transition-[opacity,box-shadow] duration-150 ease-out',
            conRetrato ? 'opacity-100' : 'opacity-0',
            // El aro fino de Instagram: 1,5 px del color del texto con 1,5 px de aire.
            marcada && conRetrato && 'shadow-[0_0_0_1.5px_var(--background),0_0_0_3px_var(--foreground)]',
          )}
        />
      ) : null}
      {destino.insignia ? (
        <span aria-hidden className="absolute -top-[1px] -right-[3px] size-[7px] rounded-full bg-primary ring-2 ring-background" />
      ) : null}
    </span>
  );
}
