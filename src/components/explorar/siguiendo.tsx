import { Rss, Search, TriangleAlert, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { AREA_TACTIL, PULSACION } from '@/components/sistema/tactil';
import { Button } from '@/components/ui/button';
import { construirUrlInicio } from '@/lib/sport/explorar/inicio-url';
import type { PersonaParaSeguir, VistaSiguiendo } from '@/lib/sport/explorar/siguiendo-pantalla';
import { RUTA_SIGUIENDO, type CriteriosSiguiendo } from '@/lib/sport/explorar/siguiendo-url';
import type { EntradaSiguiendo } from '@/lib/sport/explorar/tipos-social';
import { RUTA_BUSCAR } from '@/lib/sport/explorar/url';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { cn } from '@/lib/utils';
import { CLASE_LISTA_PERFILES, FilaPerfil } from './buscador-social-fila';
import { BotonSeguirCompacto } from './buscador-social-seguir';
import { FeedIncremental } from './feed-incremental';

export { TarjetaSiguiendo } from './tarjeta-feed';

/**
 * Inicio de Explorar: el feed con los últimos resultados publicados de las
 * personas que sigue la cuenta. Seguir es el favorito privado de siempre:
 * nadie recibe un aviso y nada de esto es visible para la persona seguida.
 */

const ENLACE =
  'inline-flex min-h-[44px] items-center gap-1.5 text-[14px] text-primary-text underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none';

export const ID_ENCABEZADO_SIGUIENDO = 'siguiendo-resultados';

/** Enlace a la lista de personas seguidas, con su número si se conoce. */
export function EnlaceSiguiendo({ siguiendo, className }: { siguiendo?: number | null; className?: string }) {
  return (
    <Link href={RUTA_SIGUIENDO} prefetch={false} className={cn(ENLACE, className)}>
      <Rss className="size-[16px]" aria-hidden />
      Siguiendo
      {typeof siguiendo === 'number' ? (
        <span className="cifra text-base leading-none text-foreground">{siguiendo.toLocaleString('es-ES')}</span>
      ) : null}
    </Link>
  );
}

/**
 * Todo / Medallas como enlaces: funciona sin JavaScript y queda en la URL. Se
 * ven como chips de 32 px (el elegido, invertido) y se tocan en 44 con el
 * `::after` invisible del sistema.
 */
function FiltroMedallas({ soloMedallas }: { soloMedallas: boolean }) {
  const opcion = (activa: boolean, href: string, texto: string) => (
    <Link
      href={href}
      prefetch={false}
      aria-current={activa ? 'page' : undefined}
      className={cn(
        'inline-flex h-[32px] items-center rounded-full px-[12px] text-[13px] whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring',
        AREA_TACTIL,
        PULSACION,
        activa ? 'bg-foreground font-semibold text-background' : 'bg-secondary font-medium text-foreground hover:bg-accent',
      )}
    >
      {texto}
    </Link>
  );
  return (
    <nav aria-label="Filtrar el feed" className="flex shrink-0 items-center gap-[8px] py-[6px]">
      {opcion(!soloMedallas, construirUrlInicio(), 'Todo')}
      {opcion(soloMedallas, construirUrlInicio({ soloMedallas: true }), 'Medallas')}
    </nav>
  );
}

/**
 * Fila de filtros de Explorar. El título («Explorar») y la campana están en
 * la cabecera compacta de la aplicación, así que aquí no hay `<h1>`.
 */
export function CabeceraInicio({ criterios }: { criterios: CriteriosSiguiendo }) {
  return (
    <div className="flex min-w-0 items-center gap-3 lg:max-w-2xl">
      <FiltroMedallas soloMedallas={criterios.soloMedallas} />
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
        <Link href={construirUrlInicio({ soloMedallas: criterios.soloMedallas })} prefetch={false} className={cn(ENLACE, 'self-start')}>
          Lo más reciente
        </Link>
      ) : null}
      <FeedIncremental items={items} siguiente={siguiente} soloMedallas={criterios.soloMedallas} limite={limite} />
    </section>
  );
}

function Aviso({
  titulo,
  icono,
  children,
  alerta = false,
}: {
  titulo: string;
  icono: React.ReactNode;
  children: React.ReactNode;
  alerta?: boolean;
}) {
  return (
    <section role={alerta ? 'alert' : 'status'} className="flex min-w-0 flex-col items-start gap-1 py-2 lg:max-w-2xl">
      <div className="flex min-w-0 items-center gap-2">
        {icono}
        <h2 id={ID_ENCABEZADO_SIGUIENDO} className="text-[16px] leading-tight font-semibold tracking-normal">{titulo}</h2>
      </div>
      <div className="flex min-w-0 flex-col items-start gap-1 text-[14px] text-muted-foreground medida">{children}</div>
    </section>
  );
}

const BUSCAR = (
  <Link href={RUTA_BUSCAR} prefetch={false} className={ENLACE}>
    <Search className="size-[16px]" aria-hidden />
    Buscar tiradores
  </Link>
);

/** Propuestas para un feed o una lista vacíos, como filas de perfil con «Seguir». */
export function PropuestasParaSeguir({ sugeridos }: { sugeridos: PersonaParaSeguir[] | null | undefined }) {
  if (sugeridos === undefined) return null;
  if (sugeridos === null) {
    return <p className="text-sm text-muted-foreground">No se han podido leer las sugerencias.</p>;
  }
  if (sugeridos.length === 0) return null;
  return (
    <section aria-labelledby="siguiendo-propuestas" className="flex min-w-0 flex-col lg:max-w-2xl">
      <h2 id="siguiendo-propuestas" className="flex min-h-[40px] items-center px-0.5 text-[15px] font-semibold tracking-normal sm:px-3">
        Sugerencias
      </h2>
      <ul className={CLASE_LISTA_PERFILES} aria-label="Tiradores para seguir">
        {sugeridos.map((p) => (
          <FilaPerfil
            key={p.id}
            p={p}
            accion={<BotonSeguirCompacto personaId={p.id} nombre={nombreVisible(p.nombre) || p.nombre} inicial={false} lectura={p} />}
          />
        ))}
      </ul>
    </section>
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
  const icono = 'size-[18px] shrink-0';
  switch (vista.tipo) {
    case 'ok': {
      if (criterios.cursor) {
        return (
          <Aviso icono={<Rss className={cn(icono, 'text-muted-foreground')} aria-hidden />} titulo="No hay más resultados">
            <Link href={primera} prefetch={false} className={ENLACE}>Lo más reciente</Link>
          </Aviso>
        );
      }
      const nadie = siguiendo === 0;
      return (
        <div className="flex min-w-0 flex-col gap-3">
          <Aviso
            icono={nadie ? <UserPlus className={cn(icono, 'text-muted-foreground')} aria-hidden /> : <Users className={cn(icono, 'text-muted-foreground')} aria-hidden />}
            titulo={nadie
              ? 'Aún no sigues a nadie'
              : criterios.soloMedallas
                ? 'Ninguna medalla todavía'
                : 'Sin resultados'}
          >
            {nadie ? <p>Sigue a tiradores y aquí verás sus resultados.</p> : null}
            {criterios.soloMedallas && !nadie ? (
              <Link href={construirUrlInicio()} prefetch={false} className={ENLACE}>Ver todo</Link>
            ) : BUSCAR}
          </Aviso>
          <PropuestasParaSeguir sugeridos={vista.sugeridos} />
        </div>
      );
    }
    case 'cursor_invalido':
      return (
        <Aviso alerta icono={<TriangleAlert className={cn(icono, 'text-warn')} aria-hidden />} titulo="Página caducada">
          <Link href={primera} prefetch={false} className={ENLACE}>Lo más reciente</Link>
        </Aviso>
      );
    case 'no_disponible':
      return (
        <Aviso alerta icono={<TriangleAlert className={cn(icono, 'text-warn')} aria-hidden />} titulo="Siguiendo aún no está activo">
          <p>Aún no está activo en esta instalación.</p>
        </Aviso>
      );
    case 'entrada_invalida':
    case 'error':
      return (
        <Aviso alerta icono={<TriangleAlert className={cn(icono, 'text-danger')} aria-hidden />} titulo="No se ha podido abrir el feed">
          <Button asChild variant="outline" size="sm" className="rounded-full">
            <Link href={construirUrlInicio(criterios)} prefetch={false}>Reintentar</Link>
          </Button>
        </Aviso>
      );
  }
}
