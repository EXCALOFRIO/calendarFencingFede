'use client';

import {
  CalendarDays,
  ClipboardCheck,
  ListOrdered,
  Settings,
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
 * Cuántos hay, por papel (sin «Normativa», ver más abajo):
 *
 *   tirador             Calendario · Mi estado · Ranking
 *   seleccionador       Calendario · Ranking
 *   dirección técnica   + Gestión
 *
 * Cuatro o cinco caben en la barra del móvil a 393 px con la etiqueta
 * entera, y desde que «Normativa» salió de la barra ya nadie llega a seis:
 * las etiquetas cortas se quedan por si vuelve a crecer.
 *
 * Qué NO es esto: ni una hamburguesa con todo dentro —esconder el calendario
 * detrás de tres rayas en una aplicación cuya única pantalla importante es el
 * calendario— ni una barra superior de enlaces en el móvil.
 *
 * Por qué «Mi estado» solo es de tirador y tutor: enseña el estado de TUS
 * inscripciones. Un seleccionador no se inscribe en nada; lo suyo es
 * «Tiradores». Las rutas siguen abiertas por URL para quien tenga sesión,
 * simplemente no ocupan un sitio en la barra de quien no las va a tocar.
 *
 * ---------------------------------------------------------------------------
 * LOS ICONOS: POR QUÉ ESTOS Y NO LOS DE ANTES
 * ---------------------------------------------------------------------------
 *
 * Dos cambiaron, y los dos por el mismo motivo: decían otra cosa.
 *
 *   «Mi estado»   era `Gauge`, un cuentakilómetros. Un cuentakilómetros no
 *                 significa «mi estado» para nadie; sugiere un medidor, una
 *                 velocidad, un porcentaje de algo. La pantalla enseña **tus
 *                 inscripciones y en qué punto está cada una**, así que va
 *                 `ClipboardCheck`: una lista de cosas tuyas, comprobada.
 *
 *   «Ranking»     era `Trophy`. Un ranking no es un trofeo: es una lista
 *                 ordenada por puntos, así que va `ListOrdered`, que es
 *                 literalmente eso. (Y mientras «Selección» estuvo en la
 *                 barra con su medalla, eran dos metáforas de premio pegadas
 *                 que el ojo agrupaba en vez de separar.)
 *
 * Los demás se quedan porque ya dicen lo que hay detrás: `CalendarDays` para
 * el calendario y `Settings` para la gestión.
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
    icono: ClipboardCheck,
    roles: ['athlete'],
  },
  /*
    «SELECCIÓN» Y «TIRADORES» YA NO OCUPAN SITIO EN LA BARRA.

    Petición literal: *«lo de selección habrá que quitarlo, no lo entiendo,
    ok? y tiradores también, esas secciones fuera, no las entiendo. Tiene que
    ser automático, tipo el seleccionador de florete ve a los de florete, el
    de sable a los de sable»*.

    Se hace lo mismo que con «Normativa» y por el mismo motivo: **las rutas
    siguen abiertas por URL y no se borra nada**, simplemente dejan de gastar
    uno de los huecos de la barra del móvil. Si alguna vuelve a hacer falta,
    es una entrada en esta lista.

    Y la segunda mitad de la petición, la del «automático», está hecha donde
    de verdad se notaba: el ranking abre por el arma del seleccionador que
    mira, no por la primera de la lista (ver `src/app/(app)/ranking/page.tsx`).
    Era eso lo que obligaba a navegar a una sección para llegar a lo suyo.
  */
  {
    href: '/ranking',
    etiqueta: 'Ranking',
    corta: 'Ranking',
    icono: ListOrdered,
  },
  /*
    «Normativa» YA NO OCUPA SITIO EN LA BARRA.

    Petición literal: *«lo de normativa ocúltalo, es irrelevante para este
    proyecto; solo se verán los documentos de cada competición, un enlace,
    pero eso en la competición de cada una»*.

    Y tiene razón: un listado de circulares suelto no resuelve nada. El
    documento que importa es la convocatoria DE un torneo, y ese sitio es la
    ficha del torneo, no una sección aparte. La ruta `/documentos` sigue
    abierta por URL —no se borra nada— simplemente deja de gastar uno de los
    cinco huecos de la barra del móvil.
  */
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

/**
 * «Estás aquí», con la misma señal en las dos barras.
 *
 * Antes no lo era: en escritorio el destino activo se marcaba con
 * `bg-secondary` y en el móvil con `text-primary-text`. Dos señales para un
 * solo significado, y en dos sitios que se ven seguidos si alguien gira el
 * portátil. El usuario cazó el mismo fallo en los filtros del calendario
 * —«malos los selectores»— y era exactamente esto: la misma idea contada de
 * dos formas, o la misma forma contando dos ideas.
 *
 * Se unificó en `bg-secondary`, y eso resolvió la incoherencia y dejó otro
 * problema, que es el que el usuario ve ahora: *«es tan gris que ni se
 * nota»*. Medido, `--secondary` sobre la cabecera son 0,099 de distancia
 * OKLab **de pura luminosidad**. Se ve si lo buscas; no se ve de un vistazo.
 *
 * La convención de la aplicación, rehecha (no deshecha), es **relleno frente
 * a contorno**:
 *
 *  - **El relleno sólido de acento sigue reservado a la acción principal**
 *    de una pantalla, y una barra de navegación no hace nada: lleva a un
 *    sitio. Así que aquí no hay relleno rojo.
 *  - Marcado = **contorno rojo + superficie teñida + rótulo rojo y en
 *    negrita** (`--marcado`, ver `globals.css`). Sin marcar = texto apagado.
 *    Un radio, una altura, y el mismo aspecto que cualquier otro control
 *    marcado de la aplicación.
 *  - El contorno va en `ring-inset`, no en `border`: un borde de 1 px le
 *    sumaría 2 px al enlace y movería la barra entera al cambiar de sección.
 *  - Y el color no va solo: además del contorno y del peso de la letra, el
 *    activo lleva `aria-current="page"`, que es lo que oye quien no ve nada
 *    de esto.
 *
 * Se exportan porque `admin/tira-secciones.tsx` las tenía copiadas letra por
 * letra. Dos copias de una convención son dos convenciones en cuanto alguien
 * toca una.
 */
export const ACTIVO =
  'bg-marcado font-semibold text-primary-text ring-1 ring-primary-text ring-inset';
export const INACTIVO = 'text-muted-foreground hover:bg-accent hover:text-foreground';

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
              es ? ACTIVO : INACTIVO,
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
 * —un cuentakilómetros no significa «mi estado» para nadie, y por eso ya no
 * está— y la palabra sola en una barra de seis se lee mal.
 *
 * El tamaño de la letra baja un punto cuando hay seis destinos, que solo le
 * pasa a la dirección técnica. Se mide, no se adivina: `npm run barrido`
 * falla si algo desborda.
 *
 * ---------------------------------------------------------------------------
 * EL ALTO: 44 px CLAVADOS, Y NI UNO MÁS
 * ---------------------------------------------------------------------------
 *
 * Petición del usuario, con captura: *«la barra inferior de navegación es
 * demasiado alta y come alto vertical, que es lo que más falta en el
 * calendario»*. Y tiene razón en el diagnóstico completo, no solo en la queja:
 * lo que más escasea en esta aplicación es alto, porque la pantalla principal
 * es un calendario y un calendario es una lista vertical.
 *
 * CUIDADO CON LOS NÚMEROS: por debajo de 640 px la raíz de la aplicación va a
 * **18 px**, no a 16 (`globals.css`, «la letra grande»), así que `h-11` no son
 * 44 px en un teléfono sino 49,5. Medido en el navegador, en un iPhone 14 Pro:
 *
 *   antes   h-12 (54 px) + 4 de aire arriba + 4 abajo + 1 de filete = 63 px
 *   ahora   h-11 (49,5)  + 2 de aire arriba + 2 abajo + 1 de filete = 55 px
 *
 * Ocho píxeles. No parecen nada hasta que se traducen: son el 1,6 % de la
 * pantalla útil, y en el feed del calendario son **la tarjeta entera de un mes
 * vacío** (mide 63 px) o el divisor de semanas libres que antes quedaba
 * cortado por abajo.
 *
 * El suelo son los 44 px del objetivo táctil que exige `UI.md`, y con 49,5 se
 * cumple de sobra; en un escritorio, donde la raíz sí son 16, `h-11` da los 44
 * exactos y tampoco se baja de ahí. Lo que se ha quitado es relleno, no área:
 * el `gap` entre el icono y la palabra baja de 2 px a 0, que es gratis porque
 * el icono y el rótulo suman 36 px y sobran trece.
 *
 * El marcado sigue siendo **la misma pastilla redondeada que en escritorio** y
 * no un bloque gris de lado a lado, que es lo que justificaba el aire de antes;
 * con 2 px sigue habiendo pastilla.
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
            <li key={destino.href} className="min-w-0 p-0.5">
              <Link
                href={destino.href}
                aria-current={es ? 'page' : undefined}
                className={cn(
                  'flex h-11 flex-col items-center justify-center rounded-md px-0.5 font-medium leading-tight transition-colors',
                  apretada ? 'text-[0.6rem]' : 'text-[0.68rem]',
                  /* El mismo par que en escritorio, incluido el `hover`: el
                     móvil se quedaba sin él y perdía la respuesta al toque. */
                  es ? ACTIVO : INACTIVO,
                )}
              >
                <Icono className={apretada ? 'size-4' : 'size-5'} aria-hidden />
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
