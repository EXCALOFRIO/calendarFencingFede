import { Rss, TriangleAlert, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import { Button } from '@/components/ui/button';
import { rutaEdicion } from '@/lib/sport/explorar/edicion-url';
import type { PersonaParaSeguir, VistaSiguiendo } from '@/lib/sport/explorar/siguiendo-pantalla';
import {
  RUTA_SIGUIENDO,
  construirUrlSiguiendo,
  type CriteriosSiguiendo,
} from '@/lib/sport/explorar/siguiendo-url';
import type { EntradaSiguiendo } from '@/lib/sport/explorar/tipos-social';
import { RUTA_EXPLORAR, rutaFicha } from '@/lib/sport/explorar/url';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { GENDER_LABEL, WEAPON_LABEL, cn, titular } from '@/lib/utils';
import { AvatarAnillo } from './avatar-anillo';
import { BotonFavorito } from './boton-favorito';
import { EtiquetasCompeticion } from './etiqueta-competicion';
import { Aclaracion, Nota } from './piezas';
import { InsigniaPuesto, partesFecha } from './perfil/piezas-perfil';

/**
 * Feed «Siguiendo»: los últimos resultados publicados de las personas que
 * sigue la cuenta. Seguir es el favorito privado de siempre: nadie recibe un
 * aviso y nada de esto es visible para la persona seguida.
 */

const ENLACE =
  'inline-flex min-h-11 items-center gap-1.5 text-sm text-primary-text underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none';

export const ID_ENCABEZADO_SIGUIENDO = 'siguiendo-resultados';

/** Entrada al feed desde Explorar, con el número de personas seguidas si se conoce. */
export function EnlaceSiguiendo({ siguiendo, className }: { siguiendo?: number | null; className?: string }) {
  return (
    <Link href={RUTA_SIGUIENDO} prefetch={false} className={cn(ENLACE, className)}>
      <Rss className="size-4" aria-hidden />
      Siguiendo
      {typeof siguiendo === 'number' ? (
        <span className="cifra text-base leading-none text-foreground">{siguiendo.toLocaleString('es-ES')}</span>
      ) : null}
    </Link>
  );
}

const PRUEBA_GENERO: Record<string, string> = { M: 'masculina', F: 'femenina', MIXTO: 'mixta' };

function textoPrueba(p: EntradaSiguiendo['prueba']): string {
  const arma = WEAPON_LABEL[p.arma as keyof typeof WEAPON_LABEL] ?? p.arma;
  const genero = PRUEBA_GENERO[p.genero] ?? GENDER_LABEL[p.genero as keyof typeof GENDER_LABEL]?.toLowerCase() ?? '';
  return `${arma} ${genero}${p.formato === 'EQUIPOS' ? ', equipos' : ''}`.trim();
}

function Fecha({ iso }: { iso: string | null }) {
  if (!iso) return <span>Fecha no publicada</span>;
  const f = partesFecha(iso);
  return f ? (
    <time dateTime={iso}>{f.dia} {f.mes} {f.anio}</time>
  ) : (
    <span className="break-all">{iso}</span>
  );
}

export function TarjetaSiguiendo({ e }: { e: EntradaSiguiendo }) {
  const nombre = nombreVisible(e.persona.nombre) || e.persona.nombre;
  return (
    <li className="min-w-0">
      <article className="flex h-full min-w-0 flex-col gap-3 rounded-md border bg-card px-4 py-4 sm:px-5" aria-label={`${nombre}, ${e.prueba.torneo}`}>
        <header className="flex min-w-0 items-center gap-3">
          <Link
            href={rutaFicha(e.persona.id)}
            prefetch={false}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-sm underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <AvatarAnillo nombre={nombre} tamano="sm" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-semibold">{nombre}</span>
              {e.persona.pais ? <BanderaPais pais={e.persona.pais} /> : null}
            </span>
          </Link>
          <span className="shrink-0 text-xs text-muted-foreground">
            <Fecha iso={e.fecha} />
          </span>
        </header>

        <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 border-t pt-3">
          <InsigniaPuesto puesto={e.puesto} puestoPublicado={e.puestoLiteral} />
          <div className="flex min-w-0 flex-col gap-1.5">
            {/* El disco ya dice la medalla con texto; aquí va el puesto entre cuántos. */}
            <span className="text-sm">
              {e.puesto !== null ? (
                <>
                  Puesto <strong className="cifra text-lg">{e.puesto}</strong>
                  {e.participantes > 0 ? <> de <strong className="cifra text-lg">{e.participantes}</strong></> : null}
                </>
              ) : e.puestoLiteral ?? 'Sin puesto publicado'}
            </span>
            <Link
              href={rutaEdicion(e.prueba.edicionId)}
              prefetch={false}
              className="w-fit max-w-full leading-snug font-medium break-words underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {titular(e.prueba.torneo)}
            </Link>
            <span className="text-xs text-muted-foreground break-words">
              {textoPrueba(e.prueba)}
              {e.prueba.ciudad ? `, ${titular(e.prueba.ciudad)}` : ''}
            </span>
          </div>
        </div>
        <EtiquetasCompeticion clasificacion={e.clasificacion} categoria={e.prueba.categoria} />
      </article>
    </li>
  );
}

/** Todos / Sólo medallas, como enlaces: funciona sin JavaScript y queda en la URL. */
function FiltroMedallas({ soloMedallas }: { soloMedallas: boolean }) {
  const opcion = (activa: boolean, href: string, texto: string) => (
    <Link
      href={href}
      prefetch={false}
      aria-current={activa ? 'page' : undefined}
      className={cn(
        'inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        activa && 'bg-marcado font-semibold text-primary-text hover:text-primary-text',
      )}
    >
      {texto}
    </Link>
  );
  return (
    <nav aria-label="Filtrar el feed" className="inline-flex w-fit gap-1 rounded-full border bg-card p-1">
      {opcion(!soloMedallas, construirUrlSiguiendo(), 'Todos los resultados')}
      {opcion(soloMedallas, construirUrlSiguiendo({ soloMedallas: true }), 'Solo medallas')}
    </nav>
  );
}

export function FeedSiguiendo({
  items,
  siguiente,
  criterios,
}: {
  items: EntradaSiguiendo[];
  siguiente: string | null;
  criterios: CriteriosSiguiendo;
}) {
  return (
    <section aria-labelledby={ID_ENCABEZADO_SIGUIENDO} className="flex min-w-0 flex-col gap-4">
      <h2 id={ID_ENCABEZADO_SIGUIENDO} className="sr-only">
        {criterios.soloMedallas ? 'Medallas de las personas que sigues' : 'Últimos resultados de las personas que sigues'}
      </h2>
      <ol className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Resultados, del más reciente al más antiguo">
        {items.map((e) => <TarjetaSiguiendo key={e.id} e={e} />)}
      </ol>
      <nav aria-label="Páginas del feed" className="flex flex-wrap items-center gap-3">
        {criterios.cursor ? (
          <Button asChild variant="outline">
            <Link href={construirUrlSiguiendo({ soloMedallas: criterios.soloMedallas })} prefetch={false}>
              Volver a lo más reciente
            </Link>
          </Button>
        ) : null}
        {siguiente ? (
          <Button asChild variant="outline">
            <Link
              href={construirUrlSiguiendo({ soloMedallas: criterios.soloMedallas, cursor: siguiente })}
              prefetch={false}
              rel="next"
            >
              Cargar más
            </Link>
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">No hay más resultados importados.</p>
        )}
      </nav>
    </section>
  );
}

function TarjetaPropuesta({ p }: { p: PersonaParaSeguir }) {
  const nombre = nombreVisible(p.nombre) || p.nombre;
  return (
    <li className="w-[9.5rem] shrink-0 snap-start sm:w-44">
      {/* `relative`: los textos `sr-only` del botón son absolutos y, sin un
          ancestro posicionado, ensanchan la página fuera del carrusel. */}
      <article className="relative flex h-full min-w-0 flex-col items-center gap-2 rounded-md border bg-card px-3 pt-4 pb-3 text-center">
        <Link
          href={rutaFicha(p.id)}
          prefetch={false}
          className="flex min-h-11 w-full min-w-0 flex-col items-center gap-2 rounded-md underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <AvatarAnillo nombre={nombre} tamano="md" />
          <span className="line-clamp-2 min-h-10 text-sm leading-5 font-medium break-words">{nombre}</span>
        </Link>
        <span className="flex min-h-5 items-center justify-center">{p.pais ? <BanderaPais pais={p.pais} /> : null}</span>
        <span className="text-xs leading-snug text-muted-foreground">{p.motivo}</span>
        <div className="mt-auto w-full">
          <BotonFavorito personaId={p.id} nombre={nombre} inicial={false} lectura={p} variante="perfil" />
        </div>
      </article>
    </li>
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
    <section role={alerta ? 'alert' : 'status'} className="flex flex-col items-start gap-2 rounded-md border bg-card px-4 py-5">
      <div className="flex items-center gap-2">
        {icono}
        <h2 id={ID_ENCABEZADO_SIGUIENDO} className="text-xl">{titulo}</h2>
      </div>
      <div className="flex flex-col items-start gap-3 text-sm text-muted-foreground medida">{children}</div>
    </section>
  );
}

const BUSCAR = (
  <Button asChild variant="outline">
    <Link href={RUTA_EXPLORAR} prefetch={false}>
      Buscar en Explorar
    </Link>
  </Button>
);

export function PropuestasParaSeguir({ sugeridos }: { sugeridos: PersonaParaSeguir[] | null | undefined }) {
  if (sugeridos === undefined) return null;
  if (sugeridos === null) {
    return <p className="text-sm text-muted-foreground">No se han podido leer las propuestas. Busca a quien quieras en Explorar.</p>;
  }
  if (sugeridos.length === 0) return null;
  return (
    <section aria-labelledby="siguiendo-propuestas" className="flex min-w-0 flex-col gap-3">
      <h2 id="siguiendo-propuestas" className="text-xl">Tiradores para empezar</h2>
      <ul
        className="-mx-4 flex min-w-0 snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
        aria-label="Tiradores para seguir"
      >
        {sugeridos.map((p) => <TarjetaPropuesta key={p.id} p={p} />)}
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
  const primera = construirUrlSiguiendo({ soloMedallas: criterios.soloMedallas });
  switch (vista.tipo) {
    case 'ok': {
      if (criterios.cursor) {
        return (
          <Aviso icono={<Rss className="size-5 text-muted-foreground" aria-hidden />} titulo="No hay más resultados">
            <p>Esta página ya no tiene resultados. Puede que hayas dejado de seguir a alguien.</p>
            <Button asChild variant="outline">
              <Link href={primera} prefetch={false}>Volver a lo más reciente</Link>
            </Button>
          </Aviso>
        );
      }
      const nadie = siguiendo === 0;
      return (
        <div className="flex min-w-0 flex-col gap-6">
          <Aviso
            icono={nadie ? <UserPlus className="size-5 text-muted-foreground" aria-hidden /> : <Users className="size-5 text-muted-foreground" aria-hidden />}
            titulo={nadie
              ? 'Aún no sigues a nadie'
              : criterios.soloMedallas
                ? 'Ninguna medalla todavía'
                : 'Sin resultados importados'}
          >
            <p>
              {nadie
                ? 'Sigue a tiradores desde su ficha y aquí verás sus últimos resultados. Es privado: nadie recibe un aviso.'
                : criterios.soloMedallas
                  ? 'Las personas que sigues no tienen medallas importadas. Prueba con todos los resultados.'
                  : 'Las personas que sigues todavía no tienen resultados importados. No significa que no compitan.'}
            </p>
            {criterios.soloMedallas && !nadie ? (
              <Button asChild variant="outline">
                <Link href={construirUrlSiguiendo()} prefetch={false}>Ver todos los resultados</Link>
              </Button>
            ) : BUSCAR}
          </Aviso>
          <PropuestasParaSeguir sugeridos={vista.sugeridos} />
        </div>
      );
    }
    case 'cursor_invalido':
      return (
        <Aviso alerta icono={<TriangleAlert className="size-5 text-warn" aria-hidden />} titulo="Esta página ya no corresponde a tu feed">
          <p>El enlace de página ha caducado o es de otro filtro. No se ha tocado nada.</p>
          <Button asChild variant="outline">
            <Link href={primera} prefetch={false}>Volver a lo más reciente</Link>
          </Button>
        </Aviso>
      );
    case 'no_disponible':
      return (
        <Aviso alerta icono={<TriangleAlert className="size-5 text-warn" aria-hidden />} titulo="Siguiendo aún no está activo">
          <p>
            Los datos deportivos todavía no están preparados en esta instalación, así que no se ha
            podido leer el feed. No significa que esté vacío.
          </p>
        </Aviso>
      );
    case 'entrada_invalida':
    case 'error':
      return (
        <Aviso alerta icono={<TriangleAlert className="size-5 text-danger" aria-hidden />} titulo="No se ha podido abrir el feed">
          <p>Ha fallado la consulta; no significa que no haya resultados. Inténtalo de nuevo.</p>
          <Button asChild variant="outline">
            <Link href={construirUrlSiguiendo(criterios)} prefetch={false}>Reintentar</Link>
          </Button>
        </Aviso>
      );
  }
}

/** Cabecera común del feed: título, número de seguidas y filtro. */
export function CabeceraSiguiendo({ siguiendo, criterios }: { siguiendo: number | null; criterios: CriteriosSiguiendo }) {
  return (
    <header className="flex min-w-0 flex-col gap-4 border-b pb-4">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h1 className="text-3xl leading-tight sm:text-4xl">Siguiendo</h1>
        {siguiendo !== null ? (
          <p className="text-sm text-muted-foreground">
            <strong className="cifra text-xl text-foreground">{siguiendo.toLocaleString('es-ES')}</strong>{' '}
            {siguiendo === 1 ? 'persona seguida' : 'personas seguidas'}
          </p>
        ) : null}
      </div>
      <p className="medida text-sm text-muted-foreground">
        Los últimos resultados publicados de los tiradores que sigues, del más reciente al más antiguo.
      </p>
      <FiltroMedallas soloMedallas={criterios.soloMedallas} />
      <Aclaracion titulo="Privacidad de Siguiendo">
        <Nota>
          Seguir es privado y sólo lo ves tú: la persona no recibe ningún aviso y no aparece en ninguna
          lista pública. Son los mismos que tienes en Mis favoritos.
        </Nota>
      </Aclaracion>
    </header>
  );
}
