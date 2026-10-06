import { Rss, Search, TriangleAlert, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import { Button } from '@/components/ui/button';
import { rutaEdicion } from '@/lib/sport/explorar/edicion-url';
import { NOMBRE_SECCION } from '@/lib/sport/explorar/nombre-seccion';
import { CLASES_MEDALLA, categoriaVisible, medallaDe, nombrePrueba } from '@/lib/sport/explorar/presentacion';
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
import { CLASE_LISTA_PERFILES, CLASE_VER_MAS, FilaPerfil } from './buscador-social-fila';
import { BotonSeguirCompacto } from './buscador-social-seguir';
import { EtiquetaTipoCompeticion } from './etiqueta-competicion';
import { partesFecha } from './perfil/piezas-perfil';

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
  return `${arma} ${genero}${p.formato === 'EQUIPOS' ? ' por equipos' : ''}`.trim();
}

/** Día y mes; el año sólo si no es el actual, para que el nombre quepa en la misma línea. */
function Fecha({ iso }: { iso: string | null }) {
  if (!iso) return <span>Sin fecha</span>;
  const f = partesFecha(iso);
  return f ? (
    <time dateTime={iso} title={`${f.dia} ${f.mes} ${f.anio}`}>
      {f.dia} {f.mes}{f.anio === String(new Date().getFullYear()) ? '' : ` ${f.anio}`}
    </time>
  ) : (
    <span>{iso.slice(0, 10)}</span>
  );
}

/** Puesto en un disco del color de su medalla; fuera del podio, neutro. */
function DiscoPuesto({ e }: { e: EntradaSiguiendo }) {
  const medalla = medallaDe(e.puesto);
  return (
    <span
      className={cn(
        'flex size-11 shrink-0 items-center justify-center rounded-full border text-sm leading-none font-semibold tabular-nums',
        medalla ? CLASES_MEDALLA[medalla] : 'border-filete-alto bg-secondary text-foreground',
      )}
    >
      {e.puesto !== null ? (
        <>
          <span aria-hidden="true">{e.puesto}.º</span>
          <span className="sr-only">Puesto {e.puesto}{e.participantes > 0 ? ` de ${e.participantes}` : ''}</span>
        </>
      ) : (
        <>
          <span aria-hidden="true">–</span>
          <span className="sr-only">{e.puestoLiteral ?? 'Sin puesto publicado'}</span>
        </>
      )}
    </span>
  );
}

const ENLACE_FILA = 'min-w-0 truncate rounded-sm underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none';

/** Una entrada del feed: puesto, persona y fecha, prueba y una línea con tipo, arma y categoría. */
export function TarjetaSiguiendo({ e }: { e: EntradaSiguiendo }) {
  const nombre = nombreVisible(e.persona.nombre) || e.persona.nombre;
  const torneo = nombrePrueba({ nombre: e.prueba.torneo, formato: e.prueba.formato, fuente: e.prueba.fuente });
  const detalle = [
    textoPrueba(e.prueba),
    e.prueba.categoria ? categoriaVisible(e.prueba.categoria) : null,
    e.puesto !== null && e.participantes > 0 ? `de ${e.participantes}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <li className="min-w-0">
      <article className="flex min-w-0 items-start gap-3 px-3 py-3 sm:px-4" aria-label={`${nombre}, ${torneo}`}>
        <DiscoPuesto e={e} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <Link href={rutaFicha(e.persona.id)} prefetch={false} className={cn(ENLACE_FILA, 'py-0.5 text-[0.9375rem] leading-tight font-semibold')}>
              {nombre}
            </Link>
            {e.persona.pais ? <BanderaPais pais={e.persona.pais} className="shrink-0" /> : null}
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              <Fecha iso={e.fecha} />
            </span>
          </div>
          <Link href={rutaEdicion(e.prueba.edicionId)} prefetch={false} className={cn(ENLACE_FILA, 'py-0.5 text-sm leading-snug')}>
            {torneo}
            {e.prueba.ciudad ? <span className="text-muted-foreground"> · {titular(e.prueba.ciudad)}</span> : null}
          </Link>
          <div className="flex min-w-0 items-center gap-1.5 pt-0.5 text-xs whitespace-nowrap text-muted-foreground">
            <EtiquetaTipoCompeticion clasificacion={e.clasificacion} className="h-5 px-2 text-[0.6875rem]" />
            <span className="min-w-0 truncate">{detalle}</span>
          </div>
        </div>
      </article>
    </li>
  );
}

/** Todos / Solo medallas, como enlaces: funciona sin JavaScript y queda en la URL. */
function FiltroMedallas({ soloMedallas }: { soloMedallas: boolean }) {
  const opcion = (activa: boolean, href: string, texto: string) => (
    <Link
      href={href}
      prefetch={false}
      aria-current={activa ? 'page' : undefined}
      className={cn(
        'inline-flex h-9 min-w-0 flex-1 items-center justify-center rounded-full px-4 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        activa && 'bg-secondary font-semibold text-foreground',
      )}
    >
      {texto}
    </Link>
  );
  return (
    <nav aria-label="Filtrar el feed" className="flex w-full max-w-xs gap-1 rounded-full border bg-card p-1">
      {opcion(!soloMedallas, construirUrlSiguiendo(), 'Todos')}
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
    <section aria-labelledby={ID_ENCABEZADO_SIGUIENDO} className="flex min-w-0 flex-col gap-3 lg:max-w-2xl">
      <h2 id={ID_ENCABEZADO_SIGUIENDO} className="sr-only">
        {criterios.soloMedallas ? 'Medallas de las personas que sigues' : 'Últimos resultados de las personas que sigues'}
      </h2>
      <ol className="flex min-w-0 flex-col divide-y overflow-hidden rounded-2xl border bg-card" aria-label="Resultados, del más reciente al más antiguo">
        {items.map((e) => <TarjetaSiguiendo key={e.id} e={e} />)}
      </ol>
      <nav aria-label="Páginas del feed" className="flex min-w-0 flex-col items-center gap-2">
        {siguiente ? (
          <Button asChild variant="secondary" className={cn(CLASE_VER_MAS, 'self-center')}>
            <Link
              href={construirUrlSiguiendo({ soloMedallas: criterios.soloMedallas, cursor: siguiente })}
              prefetch={false}
              rel="next"
            >
              Ver más
            </Link>
          </Button>
        ) : null}
        {criterios.cursor ? (
          <Link href={construirUrlSiguiendo({ soloMedallas: criterios.soloMedallas })} prefetch={false} className={cn(ENLACE, 'self-center')}>
            Lo más reciente
          </Link>
        ) : null}
      </nav>
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
    <section role={alerta ? 'alert' : 'status'} className="flex min-w-0 flex-col items-start gap-2 rounded-2xl border bg-card px-4 py-5 lg:max-w-2xl">
      <div className="flex min-w-0 items-center gap-2">
        {icono}
        <h2 id={ID_ENCABEZADO_SIGUIENDO} className="text-lg leading-tight">{titulo}</h2>
      </div>
      <div className="flex min-w-0 flex-col items-start gap-3 text-sm text-muted-foreground medida">{children}</div>
    </section>
  );
}

const BUSCAR = (
  <Button asChild variant="outline">
    <Link href={RUTA_EXPLORAR} prefetch={false}>
      <Search aria-hidden />
      {NOMBRE_SECCION}
    </Link>
  </Button>
);

/** Propuestas para un feed vacío, como filas de perfil con «Seguir» (sin carrusel). */
export function PropuestasParaSeguir({ sugeridos }: { sugeridos: PersonaParaSeguir[] | null | undefined }) {
  if (sugeridos === undefined) return null;
  if (sugeridos === null) {
    return <p className="text-sm text-muted-foreground">No se han podido leer las sugerencias.</p>;
  }
  if (sugeridos.length === 0) return null;
  return (
    <section aria-labelledby="siguiendo-propuestas" className="flex min-w-0 flex-col gap-1 lg:max-w-2xl">
      <h2 id="siguiendo-propuestas" className="flex min-h-11 items-center px-0.5 text-base font-semibold tracking-normal sm:px-3">
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
  const primera = construirUrlSiguiendo({ soloMedallas: criterios.soloMedallas });
  switch (vista.tipo) {
    case 'ok': {
      if (criterios.cursor) {
        return (
          <Aviso icono={<Rss className="size-5 shrink-0 text-muted-foreground" aria-hidden />} titulo="No hay más resultados">
            <Button asChild variant="outline">
              <Link href={primera} prefetch={false}>Lo más reciente</Link>
            </Button>
          </Aviso>
        );
      }
      const nadie = siguiendo === 0;
      return (
        <div className="flex min-w-0 flex-col gap-4">
          <Aviso
            icono={nadie ? <UserPlus className="size-5 shrink-0 text-muted-foreground" aria-hidden /> : <Users className="size-5 shrink-0 text-muted-foreground" aria-hidden />}
            titulo={nadie
              ? 'Aún no sigues a nadie'
              : criterios.soloMedallas
                ? 'Ninguna medalla todavía'
                : 'Sin resultados'}
          >
            {criterios.soloMedallas && !nadie ? (
              <Button asChild variant="outline">
                <Link href={construirUrlSiguiendo()} prefetch={false}>Ver todos</Link>
              </Button>
            ) : BUSCAR}
          </Aviso>
          <PropuestasParaSeguir sugeridos={vista.sugeridos} />
        </div>
      );
    }
    case 'cursor_invalido':
      return (
        <Aviso alerta icono={<TriangleAlert className="size-5 shrink-0 text-warn" aria-hidden />} titulo="Página caducada">
          <Button asChild variant="outline">
            <Link href={primera} prefetch={false}>Lo más reciente</Link>
          </Button>
        </Aviso>
      );
    case 'no_disponible':
      return (
        <Aviso alerta icono={<TriangleAlert className="size-5 shrink-0 text-warn" aria-hidden />} titulo="Siguiendo aún no está activo">
          <p>Aún no está activo en esta instalación.</p>
        </Aviso>
      );
    case 'entrada_invalida':
    case 'error':
      return (
        <Aviso alerta icono={<TriangleAlert className="size-5 shrink-0 text-danger" aria-hidden />} titulo="No se ha podido abrir el feed">
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
    <header className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <h1 className="text-3xl leading-none sm:text-4xl">Siguiendo</h1>
        {siguiendo !== null ? (
          <p className="shrink-0 text-sm text-muted-foreground">
            <strong className="font-semibold text-foreground tabular-nums">{siguiendo.toLocaleString('es-ES')}</strong>{' '}
            {siguiendo === 1 ? 'seguida' : 'seguidas'}
          </p>
        ) : null}
      </div>
      <FiltroMedallas soloMedallas={criterios.soloMedallas} />
    </header>
  );
}
