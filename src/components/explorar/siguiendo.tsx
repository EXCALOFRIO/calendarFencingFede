import { Flag, Medal, Rss, Trophy, TriangleAlert, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { Boton } from '@/components/sistema/boton';
import { EstadoVacio } from '@/components/sistema/estado-vacio';
import { SelectorSegmentado } from '@/components/sistema/selector-segmentado';
import { AREA_TACTIL, FOCO, SIN_MINIMO } from '@/components/sistema/tactil';
import { TransicionContenido } from '@/components/sistema/transicion';
import { urlAmbito } from '@/lib/sport/explorar/ambitos-url';
import { construirUrlInicio } from '@/lib/sport/explorar/inicio-url';
import type { PersonaParaSeguir, VistaSiguiendo } from '@/lib/sport/explorar/siguiendo-pantalla';
import { RUTA_SIGUIENDO, type CriteriosSiguiendo } from '@/lib/sport/explorar/siguiendo-url';
import type { EntradaSiguiendo } from '@/lib/sport/explorar/tipos-social';
import { cn } from '@/lib/utils';
import { PropuestasBuscador } from './buscador-social-fila';
import { FeedIncremental } from './feed-incremental';

export { TarjetaSiguiendo } from './tarjeta-feed';

/**
 * «Para ti» de Explorar: los últimos resultados publicados de las personas
 * que sigue la cuenta y, si no sigue a nadie, a quién seguir y por dónde
 * empezar. Seguir es el favorito privado de siempre: nadie recibe un aviso y
 * nada de esto es visible para la persona seguida.
 */

const ENLACE =
  'inline-flex min-h-[44px] items-center gap-2 text-sm text-primary-text underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none';

export const ID_ENCABEZADO_SIGUIENDO = 'siguiendo-resultados';

/** Entrada a la lista de personas seguidas, con su número si se conoce. */
export function EnlaceSiguiendo({ siguiendo, className }: { siguiendo?: number | null; className?: string }) {
  return (
    <Link
      href={RUTA_SIGUIENDO}
      prefetch={false}
      className={cn(SIN_MINIMO, AREA_TACTIL, FOCO, 'inline-flex h-9 min-w-0 items-center gap-2 rounded-full text-sm font-semibold text-foreground', className)}
    >
      <Rss className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">Siguiendo</span>
      {typeof siguiendo === 'number' ? (
        <span className="cifra text-base leading-none text-muted-foreground tabular-nums">{siguiendo.toLocaleString('es-ES')}</span>
      ) : null}
    </Link>
  );
}

/**
 * Siguiendo y, a la derecha, Todo / Medallas. Los dos valores son enlaces que
 * sustituyen la entrada del historial: alternar no apila nada y Atrás sale de
 * Explorar de una vez. Sin personas seguidas no hay nada que filtrar.
 */
export function CabeceraInicio({
  criterios,
  enlace,
  conFiltro = true,
}: {
  criterios: CriteriosSiguiendo;
  /** El enlace a Siguiendo con su número (que puede llegar en diferido). */
  enlace?: React.ReactNode;
  conFiltro?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 lg:max-w-2xl">
      {enlace ?? <EnlaceSiguiendo />}
      {conFiltro ? (
        <SelectorSegmentado
          etiqueta="Qué resultados"
          tamano="sm"
          anchoMinimo={5}
          replace
          scroll={false}
          className="w-44 shrink-0"
          valor={criterios.soloMedallas ? 'medallas' : 'todo'}
          opciones={[
            { valor: 'todo', etiqueta: 'Todo', href: construirUrlInicio() },
            { valor: 'medallas', etiqueta: 'Medallas', href: construirUrlInicio({ soloMedallas: true }) },
          ]}
        />
      ) : null}
    </div>
  );
}

export function FeedSiguiendo({
  items,
  siguiente,
  criterios,
  limite = 20,
}: {
  items: EntradaSiguiendo[];
  siguiente: string | null;
  criterios: CriteriosSiguiendo;
  limite?: number;
}) {
  return (
    <section aria-labelledby={ID_ENCABEZADO_SIGUIENDO} className="flex min-w-0 flex-col lg:max-w-2xl">
      <h2 id={ID_ENCABEZADO_SIGUIENDO} className="sr-only">
        {criterios.soloMedallas ? 'Medallas de las personas que sigues' : 'Últimos resultados de las personas que sigues'}
      </h2>
      {criterios.cursor ? (
        <Link href={construirUrlInicio({ soloMedallas: criterios.soloMedallas })} prefetch={false} replace className={cn(ENLACE, 'self-start')}>
          Lo más reciente
        </Link>
      ) : null}
      <TransicionContenido clave={criterios.soloMedallas ? 'medallas' : 'todo'} nombre="explorar-resultados-seguidos">
        <div className="min-w-0">
          <FeedIncremental items={items} siguiente={siguiente} soloMedallas={criterios.soloMedallas} limite={limite} />
        </div>
      </TransicionContenido>
    </section>
  );
}

/** Propuestas para un «Para ti» o una lista de Siguiendo vacíos, como filas de perfil con «Seguir». */
export function PropuestasParaSeguir({ sugeridos }: { sugeridos: PersonaParaSeguir[] | null | undefined }) {
  if (sugeridos === undefined) return null;
  return <PropuestasBuscador propuestas={sugeridos} className="lg:max-w-2xl" />;
}

/** Por dónde seguir explorando cuando aún no hay resultados que enseñar. */
function AtajosExplorar() {
  return (
    <>
      <Boton asChild variante="contorno">
        <Link href={urlAmbito('competiciones')} prefetch={false} replace>
          <Trophy aria-hidden />
          Torneos
        </Link>
      </Boton>
      <Boton asChild variante="contorno">
        <Link href={urlAmbito('paises')} prefetch={false} replace>
          <Flag aria-hidden />
          Países
        </Link>
      </Boton>
    </>
  );
}

function Reintentar({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Boton asChild variante="contorno">
      <Link href={href} prefetch={false} replace>{children}</Link>
    </Boton>
  );
}

/** Todo lo que no es una página con resultados: vacíos y errores, siempre distintos. */
export function EstadoSiguiendo({
  vista,
  criterios,
  siguiendo,
}: {
  vista: Exclude<VistaSiguiendo, { tipo: 'sin_sesion' }>;
  criterios: CriteriosSiguiendo;
  siguiendo: number | null;
}) {
  const primera = construirUrlInicio({ soloMedallas: criterios.soloMedallas });
  switch (vista.tipo) {
    case 'ok': {
      if (criterios.cursor) {
        return <EstadoVacio icono={Rss} titulo="No hay más resultados" accion={<Reintentar href={primera}>Lo más reciente</Reintentar>} />;
      }
      const nadie = siguiendo === 0;
      return (
        <div className="flex min-w-0 flex-col gap-3">
          <EstadoVacio
            icono={nadie ? UserPlus : criterios.soloMedallas ? Medal : Users}
            titulo={nadie ? 'Aún no sigues a nadie' : criterios.soloMedallas ? 'Ninguna medalla todavía' : 'Sin resultados todavía'}
            descripcion={nadie ? 'Aquí saldrán sus resultados.' : undefined}
            accion={nadie ? <AtajosExplorar /> : undefined}
          />
          <PropuestasParaSeguir sugeridos={vista.sugeridos} />
        </div>
      );
    }
    case 'cursor_invalido':
      return <EstadoVacio tipo="error" icono={TriangleAlert} titulo="Página caducada" accion={<Reintentar href={primera}>Lo más reciente</Reintentar>} />;
    case 'no_disponible':
      return <EstadoVacio tipo="error" icono={TriangleAlert} titulo="Siguiendo aún no está activo" descripcion="Aún no está activo en esta instalación." />;
    case 'entrada_invalida':
    case 'error':
      return (
        <EstadoVacio
          tipo="error"
          icono={TriangleAlert}
          titulo="No se han podido leer los resultados"
          accion={<Reintentar href={construirUrlInicio(criterios)}>Reintentar</Reintentar>}
        />
      );
  }
}
