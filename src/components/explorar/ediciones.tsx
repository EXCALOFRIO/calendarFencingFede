import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  GitFork,
  Grid3x3,
  ListOrdered,
  MapPin,
  Medal,
  SearchX,
  TriangleAlert,
} from 'lucide-react';
import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ETIQUETA_SERIE,
  type SerieComplementaria,
} from '@/lib/ingest/series-complementarias';
import type { Clasificacion, EdicionDetalle, EdicionResumen, PruebaDeEdicion } from '@/lib/sport/explorar/edicion-modelo';
import {
  RUTA_EDICIONES,
  construirUrlEdicion,
  rutaEdicion,
  urlExplorarDePrueba,
  type CriteriosEdicion,
} from '@/lib/sport/explorar/edicion-url';
import type { EdicionConAsaltos } from '@/lib/sport/explorar/ediciones';
import type { VistaEdicion, VistaSeries } from '@/lib/sport/explorar/ediciones-pantalla';
import { fuenteResultado } from '@/lib/sport/explorar/etiquetas';
import { rutaFichaConRetorno } from '@/lib/sport/explorar/ficha-url';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { WEAPON_LABEL, cn, titular } from '@/lib/utils';
import { CuadroDePrueba, PoulesDePrueba } from './asaltos-prueba';
import { Aclaracion, Bloque, Nota, fechaLegible } from './piezas';
import { EnlacesResultados, EstadoResultadosPrueba, nombreDePrueba } from './prueba-resultados';

const ENLACE =
  'inline-flex min-h-11 items-center gap-1.5 text-sm text-primary-text underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none';
const ENLACE_VOLVER =
  'inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none';

/** Entrada a las ediciones desde Explorar, sin ocupar sitio en la barra. */
export function EnlaceEdiciones({ className }: { className?: string }) {
  return (
    <Link href={RUTA_EDICIONES} prefetch={false} className={cn(ENLACE, className)}>
      <Medal className="size-4" aria-hidden />
      Ediciones y series
    </Link>
  );
}

/** Vuelta a las ediciones desde Explorar cuando la búsqueda está acotada a una. */
export function EnlaceVolverAEdicion({ edicionId }: { edicionId: string }) {
  return (
    <Link href={rutaEdicion(edicionId)} prefetch={false} className={ENLACE}>
      <Medal className="size-4" aria-hidden />
      Ver la edición y su clasificación
    </Link>
  );
}

function periodo(inicio: string | null, fin: string | null): string | null {
  if (!inicio) return null;
  return fin && fin !== inicio ? `${fechaLegible(inicio)} – ${fechaLegible(fin)}` : fechaLegible(inicio);
}

function Aviso({
  icono,
  titulo,
  children,
  alerta = false,
}: {
  icono: React.ReactNode;
  titulo: string;
  children: React.ReactNode;
  alerta?: boolean;
}) {
  return (
    <section
      role={alerta ? 'alert' : 'status'}
      className="flex flex-col items-start gap-2 rounded-md border bg-card px-4 py-5"
    >
      <div className="flex items-center gap-2">
        {icono}
        <h2 className="text-xl">{titulo}</h2>
      </div>
      <div className="flex flex-col items-start gap-3 text-sm text-muted-foreground medida">{children}</div>
    </section>
  );
}

/* --------------------------------------------------------------------- series */

/** Color del organismo que publica, no de la fuente técnica: Skermo y los PDF son de la RFEE. */
const COLOR_FUENTE: Record<string, string> = {
  fie: 'bg-org-fie-tinte text-org-fie',
  skermo_rfee: 'bg-org-rfee-tinte text-org-rfee',
  rfee_pdf: 'bg-org-rfee-tinte text-org-rfee',
};

export function InsigniaFuente({ fuente, className }: { fuente: string; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn('border-transparent font-semibold', COLOR_FUENTE[fuente] ?? 'bg-secondary text-foreground', className)}
    >
      {fuenteResultado(fuente)}
    </Badge>
  );
}

export function FilaEdicion({ e, catalogo }: { e: EdicionResumen & { clasificados?: number }; catalogo?: string }) {
  const fechas = periodo(e.inicio, e.fin);
  return (
    <li>
      <Link
        href={construirUrlEdicion(e.id, { catalogo })}
        prefetch={false}
        className="group grid min-h-11 gap-x-6 gap-y-3 px-4 py-4 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset motion-reduce:transition-none sm:px-5 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto] md:items-center"
      >
        <span className="flex min-w-0 flex-col gap-2">
          <span className="flex flex-wrap items-center gap-2">
            <InsigniaFuente fuente={e.fuente} />
            <span className="text-xs text-muted-foreground">Temporada {e.temporada}</span>
          </span>
          <span className="text-base leading-snug font-semibold break-words">{titular(e.nombre)}</span>
          <span className="flex flex-wrap items-center gap-1.5">
            {e.armas.length > 0 ? (
              e.armas.map((a) => <Badge key={a} variant="secondary">{WEAPON_LABEL[a]}</Badge>)
            ) : (
              <span className="text-xs text-muted-foreground">Sin armas indicadas</span>
            )}
            {e.formatos.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                {e.formatos.map((f) => (f === 'EQUIPOS' ? 'equipos' : 'individual')).join(' y ')}
              </span>
            ) : null}
          </span>
        </span>
        <span className="flex min-w-0 flex-col gap-1.5 text-sm">
          <span className="flex items-start gap-2">
            <CalendarDays aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            {fechas ?? <span className="text-muted-foreground">Fechas no publicadas</span>}
          </span>
          {e.ciudad || e.pais ? (
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <MapPin aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              {e.ciudad ? <span className="break-words">{e.ciudad}</span> : null}
              {e.pais ? <BanderaPais pais={e.pais} /> : null}
            </span>
          ) : null}
        </span>
        <span className="flex gap-6 text-sm md:flex-col md:gap-1">
          <span>
            <span className="cifra text-2xl leading-none">{e.pruebas}</span>{' '}
            <span className="text-xs text-muted-foreground">{e.pruebas === 1 ? 'prueba publicada' : 'pruebas publicadas'}</span>
          </span>
          {typeof e.clasificados === 'number' && e.clasificados > 0 ? (
            <span>
              <span className="cifra text-2xl leading-none">{e.clasificados}</span>{' '}
              <span className="text-xs text-muted-foreground">{e.clasificados === 1 ? 'clasificado' : 'clasificados'}</span>
            </span>
          ) : null}
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-text">
          Ver edición
          <ArrowRight aria-hidden className="size-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
        </span>
      </Link>
    </li>
  );
}

export function ListaSeries({ series }: { series: { serie: SerieComplementaria; ediciones: EdicionResumen[] }[] }) {
  return (
    <div className="flex flex-col gap-8">
      {series.map(({ serie, ediciones }) => {
        const id = `serie-${serie}`;
        return (
          <Bloque key={serie} id={id} titulo={ETIQUETA_SERIE[serie]} nivel="pagina">
            {ediciones.length === 0 ? (
              <Nota>
                Ninguna edición de esta serie está importada todavía. No se muestran pruebas que la fuente no haya
                publicado ni se completa la serie con otras.
              </Nota>
            ) : (
              <ul className="divide-y rounded-md border bg-card" aria-label={`Ediciones: ${ETIQUETA_SERIE[serie]}`}>
                {ediciones.map((e) => (
                  <FilaEdicion key={e.id} e={e} />
                ))}
              </ul>
            )}
          </Bloque>
        );
      })}
      <Aclaracion titulo="Criterios de estas series">
        <Nota>
          La serie se reconoce por el nombre publicado de la edición. Las categorías y modalidades son las que cada
          fuente publica; los Juegos Olímpicos de la Juventud no se incluyen.
        </Nota>
      </Aclaracion>
    </div>
  );
}

export function EstadoSeries({ vista }: { vista: Exclude<VistaSeries, { tipo: 'ok' } | { tipo: 'sin_sesion' }> }) {
  return vista.tipo === 'no_disponible' ? (
    <Aviso
      alerta
      icono={<TriangleAlert className="size-5 text-warn" aria-hidden />}
      titulo="Las ediciones aún no están activas"
    >
      <p>
        Los datos deportivos todavía no están preparados en esta instalación. No es que no haya ediciones.
      </p>
    </Aviso>
  ) : (
    <Aviso
      alerta
      icono={<TriangleAlert className="size-5 text-danger" aria-hidden />}
      titulo="No se han podido leer las ediciones"
    >
      <p>Ha fallado la consulta, no es que no haya ediciones. Inténtalo de nuevo.</p>
      <Button asChild variant="outline">
        <Link href={RUTA_EDICIONES} prefetch={false}>
          Reintentar
        </Link>
      </Button>
    </Aviso>
  );
}

/* -------------------------------------------------------------------- edición */

function FilaPrueba({
  edicion,
  p,
  elegida,
  origen,
  catalogo,
}: {
  edicion: EdicionResumen;
  p: PruebaDeEdicion;
  elegida: boolean;
  origen?: string;
  catalogo?: string;
}) {
  return (
    <li
      aria-current={elegida ? 'true' : undefined}
      className={cn('grid gap-x-6 gap-y-3 px-4 py-4 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.5fr)]', elegida && 'bg-marcado')}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="text-xl leading-tight break-words">{nombreDePrueba(p)}</h3>
        {p.fecha ? <span className="text-xs text-muted-foreground">{fechaLegible(p.fecha)}</span> : null}
        <EstadoResultadosPrueba estado={p.resultados.estado} importados={p.resultados.importados} />
      </div>
      <EnlacesResultados enlaces={p.enlaces} />
      <div className="flex flex-col items-start">
        {p.resultados.importados > 0 ? (
          <Link
            href={construirUrlEdicion(edicion.id, { prueba: p.id, origen, catalogo })}
            prefetch={false}
            aria-label={`Ver la clasificación: ${nombreDePrueba(p)}`}
            className={ENLACE}
          >
            Ver la clasificación
          </Link>
        ) : null}
        <Link
          href={urlExplorarDePrueba(edicion.id, p)}
          prefetch={false}
          aria-label={`Buscar en Explorar a quienes compitieron en: ${nombreDePrueba(p)}`}
          className={ENLACE}
        >
          Buscar en Explorar
        </Link>
      </div>
    </li>
  );
}

export function PruebasDeEdicion({
  edicion,
  seleccionada,
  origen,
  catalogo,
}: {
  edicion: EdicionDetalle;
  seleccionada: string;
  /** Calendario del que se llegó; sus enlaces de clasificación lo conservan. */
  origen?: string;
  catalogo?: string;
}) {
  if (edicion.pruebasDetalle.length === 0) {
    return (
      <Nota>
        Esta edición no tiene pruebas importadas. No se inventan pruebas que la fuente no haya publicado.
      </Nota>
    );
  }
  const grupos = (['INDIVIDUAL', 'EQUIPOS'] as const)
    .map((formato) => ({ formato, pruebas: edicion.pruebasDetalle.filter((p) => p.formato === formato) }))
    .filter((g) => g.pruebas.length > 0);
  return (
    <div className="flex flex-col gap-5">
      {grupos.map((g) => (
        <section key={g.formato} aria-label={g.formato === 'EQUIPOS' ? 'Pruebas por equipos' : 'Pruebas individuales'}>
          <h3 className="pb-2 text-lg">{g.formato === 'EQUIPOS' ? 'Por equipos' : 'Individuales'}</h3>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {g.pruebas.map((p) => (
              <FilaPrueba key={p.id} edicion={edicion} p={p} elegida={p.id === seleccionada} origen={origen} catalogo={catalogo} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** El metal va escrito: el color no puede ser la única señal y `gold` está reservado a otra cosa. */
const METAL_PODIO: Record<number, string> = { 1: 'Oro', 2: 'Plata', 3: 'Bronce' };

function FilaPuesto({
  fila,
  volver,
}: {
  fila: Clasificacion['filas'][number];
  volver: string;
}) {
  const metal = fila.puesto !== null ? METAL_PODIO[fila.puesto] : undefined;
  const contenido = (
    <>
      <span
        className={cn(
          'cifra self-start leading-none md:self-center md:justify-self-end',
          metal
            ? 'inline-flex size-11 items-center justify-center rounded-full border-2 border-foreground/80 text-2xl'
            : 'text-3xl md:text-right',
        )}
      >
        <span className="sr-only">{fila.puesto === null ? 'Sin puesto numérico: ' : 'Puesto '}</span>
        {fila.puesto ?? '—'}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className={cn('font-semibold break-words', metal && 'text-lg leading-tight')}>{nombreVisible(fila.nombre)}</span>
          {metal ? (
            <Badge variant="outline" className="gap-1">
              <Medal className="size-3" aria-hidden />
              {metal}
            </Badge>
          ) : null}
        </span>
        {fila.puesto === null && fila.puestoPublicado ? (
          <span className="text-xs text-muted-foreground">Publicado como «{fila.puestoPublicado}»</span>
        ) : null}
        {fila.personaId ? null : (
          <span className="text-xs text-muted-foreground">Sin ficha deportiva vinculada</span>
        )}
      </span>
      <span className="col-start-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm md:col-start-3">
        {fila.pais ? <BanderaPais pais={fila.pais} /> : <span className="text-muted-foreground">País no publicado</span>}
        {fila.club ? <span className="min-w-0 text-xs text-muted-foreground break-words">{fila.club}</span> : null}
      </span>
    </>
  );
  const rejilla =
    'grid min-h-11 grid-cols-[3rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2 px-4 py-4 md:grid-cols-[3rem_minmax(0,2fr)_minmax(0,1.5fr)]';
  return (
    <li className={metal ? 'bg-secondary/60' : undefined}>
      {fila.personaId ? (
        <Link
          href={rutaFichaConRetorno(fila.personaId, volver)}
          prefetch={false}
          aria-label={`Abrir la ficha deportiva de ${nombreVisible(fila.nombre)}`}
          className={cn(
            rejilla,
            'hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset',
          )}
        >
          {contenido}
        </Link>
      ) : (
        <div className={rejilla}>{contenido}</div>
      )}
    </li>
  );
}

export function ClasificacionDePrueba({
  edicion,
  prueba,
  clasificacion,
  criterios,
}: {
  edicion: EdicionResumen;
  prueba: PruebaDeEdicion;
  clasificacion: Clasificacion;
  criterios: CriteriosEdicion;
}) {
  // La ficha vuelve a esta misma página de esta misma clasificación.
  const origen = criterios.origen;
  const catalogo = criterios.catalogo;
  const volver = construirUrlEdicion(edicion.id, { prueba: prueba.id, cursor: criterios.cursor, origen, catalogo });
  return (
    <Bloque id="edicion-clasificacion" titulo={`Clasificación: ${nombreDePrueba(prueba)}`} nivel="pagina">
      {clasificacion.filas.length === 0 ? (
        <p role="status" className="medida text-sm text-muted-foreground">
          No hay puestos importados para esta prueba. No significa que no se haya disputado.
        </p>
      ) : (
        <>
          <p role="status" className="text-sm text-muted-foreground">
            {clasificacion.filas.length === 1 ? '1 puesto' : `${clasificacion.filas.length} puestos`} en esta página
            {clasificacion.siguiente ? ', hay más' : ''}. Fuente: {fuenteResultado(clasificacion.fuente)}.
          </p>
          <div className="overflow-hidden rounded-xl border bg-card">
            <div aria-hidden className="hidden grid-cols-[3rem_minmax(0,2fr)_minmax(0,1.5fr)] gap-x-4 border-b bg-secondary px-4 py-3 text-xs font-medium text-muted-foreground md:grid">
              <span className="text-right">Puesto</span><span>Participante</span><span>País y club</span>
            </div>
            <ul className="divide-y" aria-label="Clasificación">
              {clasificacion.filas.map((f) => (
                <FilaPuesto key={f.id} fila={f} volver={volver} />
              ))}
            </ul>
          </div>
          <nav aria-label="Páginas de la clasificación" className="flex flex-wrap items-center gap-3">
            {criterios.cursor ? (
              <Button asChild variant="outline" className="min-h-11">
                <Link href={construirUrlEdicion(edicion.id, { prueba: prueba.id, origen, catalogo })} prefetch={false}>
                  Volver al principio
                </Link>
              </Button>
            ) : null}
            {clasificacion.siguiente ? (
              <Button asChild variant="outline" className="min-h-11">
                <Link
                  href={construirUrlEdicion(edicion.id, { prueba: prueba.id, cursor: clasificacion.siguiente, origen, catalogo })}
                  prefetch={false}
                  rel="next"
                >
                  Ver más puestos
                </Link>
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">No hay más puestos importados.</p>
            )}
          </nav>
        </>
      )}
      {clasificacion.otrasFuentes.length > 0 ? (
        <Nota>
          Hay puestos de otras fuentes para esta prueba que no se mezclan aquí:{' '}
          {clasificacion.otrasFuentes
            .map((o) => `${fuenteResultado(o.fuente)} (${o.filas})`)
            .join(', ')}
          .
        </Nota>
      ) : null}
      <Aclaracion titulo="Cómo abrir una ficha desde la clasificación">
        <Nota>
          Sólo las filas vinculadas a una persona deportiva abren su ficha. Una fila sin vínculo se conserva tal y
          como la publicó la fuente: no se asigna a nadie por parecido de nombre.
        </Nota>
      </Aclaracion>
    </Bloque>
  );
}

export function EdicionCompleta({
  edicion,
  criterios,
}: {
  edicion: EdicionConAsaltos;
  criterios: CriteriosEdicion;
}) {
  const fechas = periodo(edicion.inicio, edicion.fin);
  const elegida = edicion.pruebasDetalle.find((p) => p.id === criterios.prueba) ?? null;
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Volver" className="flex flex-wrap items-center gap-x-5">
        {criterios.origen ? (
          <Link href={criterios.origen} prefetch={false} className={ENLACE_VOLVER}>
            <ArrowLeft className="size-4" aria-hidden />
            Volver al calendario
          </Link>
        ) : null}
        <Link href={criterios.catalogo || RUTA_EDICIONES} prefetch={false} className={ENLACE_VOLVER}>
          <ArrowLeft className="size-4" aria-hidden />
          Volver a las ediciones
        </Link>
      </nav>

      <header className="flex min-w-0 flex-col gap-5 rounded-xl border border-l-2 border-l-primary bg-card px-4 py-5 sm:px-6 sm:py-6">
        <h1 className="text-3xl leading-tight break-words sm:text-4xl">{titular(edicion.nombre)}</h1>
        {edicion.serie ? <p className="text-sm text-muted-foreground">{ETIQUETA_SERIE[edicion.serie]}</p> : null}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-10">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Temporada</dt>
            <dd className="text-sm">{edicion.temporada}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Sede</dt>
            <dd className="flex flex-wrap items-center gap-2 text-sm break-words">
              <span>{edicion.ciudad ?? 'Ciudad no publicada'}</span>
              {edicion.pais ? <BanderaPais pais={edicion.pais} /> : <span className="text-muted-foreground">País no publicado</span>}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Fechas</dt>
            <dd className="text-sm">{fechas ?? <span className="text-muted-foreground">No publicadas</span>}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Fuente</dt>
            <dd className="text-sm">{fuenteResultado(edicion.fuente)}</dd>
          </div>
        </dl>
      </header>

      {edicion.pruebaDesconocida ? (
        <p role="alert" className="medida text-sm text-warn">
          La prueba pedida no pertenece a esta edición. Elige una de las de abajo.
        </p>
      ) : null}

      <Bloque id="edicion-pruebas" titulo="Pruebas publicadas" nivel="pagina">
        <PruebasDeEdicion edicion={edicion} seleccionada={criterios.prueba} origen={criterios.origen} catalogo={criterios.catalogo} />
      </Bloque>

      {elegida && edicion.clasificacion ? (
        <ResultadosDePrueba edicion={edicion} prueba={elegida} clasificacion={edicion.clasificacion} criterios={criterios} />
      ) : null}
    </div>
  );
}

/**
 * Clasificación y, si hay asaltos importados, poules y cuadro en pestañas. Sin
 * asaltos no hay pestañas: una pestaña vacía parecería un fallo de la fuente.
 */
function ResultadosDePrueba({
  edicion,
  prueba,
  clasificacion,
  criterios,
}: {
  edicion: EdicionConAsaltos;
  prueba: PruebaDeEdicion;
  clasificacion: Clasificacion;
  criterios: CriteriosEdicion;
}) {
  const tabla = <ClasificacionDePrueba edicion={edicion} prueba={prueba} clasificacion={clasificacion} criterios={criterios} />;
  const asaltos = edicion.asaltos;
  if (asaltos === 'error') {
    return (
      <div className="flex flex-col gap-3">
        {tabla}
        <p role="status" className="medida text-sm text-warn">
          Las poules y el cuadro de esta prueba no se han podido leer ahora. La clasificación sí es la importada.
        </p>
      </div>
    );
  }
  if (!asaltos || (asaltos.poules.length === 0 && asaltos.cuadro.length === 0)) return tabla;

  const volver = construirUrlEdicion(edicion.id, { prueba: prueba.id, origen: criterios.origen, catalogo: criterios.catalogo });
  const nAsaltos = (n: number) => (n === 1 ? '1 asalto' : `${n} asaltos`);
  return (
    <Tabs defaultValue="clasificacion" className="gap-4">
      <TabsList variant="line" aria-label="Resultados de la prueba" className="w-full justify-start overflow-x-auto border-b">
        <TabsTrigger value="clasificacion" className="min-h-11 flex-none px-3">
          <ListOrdered aria-hidden />
          Clasificación
        </TabsTrigger>
        {asaltos.poules.length > 0 ? (
          <TabsTrigger value="poules" className="min-h-11 flex-none px-3">
            <Grid3x3 aria-hidden />
            Poules
            <span className="text-xs text-muted-foreground">{asaltos.poules.length}</span>
          </TabsTrigger>
        ) : null}
        {asaltos.cuadro.length > 0 ? (
          <TabsTrigger value="cuadro" className="min-h-11 flex-none px-3">
            <GitFork aria-hidden className="rotate-90" />
            Cuadro
          </TabsTrigger>
        ) : null}
      </TabsList>
      <TabsContent value="clasificacion">{tabla}</TabsContent>
      {asaltos.poules.length > 0 ? (
        <TabsContent value="poules" className="flex flex-col gap-4">
          <Nota>
            {nAsaltos(asaltos.poules.reduce((n, p) => n + p.filas.reduce((m, f) => m + f.asaltos, 0) / 2, 0))} de
            poule importados de {fuenteResultado(asaltos.fuente)}. Victorias, tocados e índice se calculan con esos
            asaltos.
          </Nota>
          <PoulesDePrueba poules={asaltos.poules} volver={volver} />
        </TabsContent>
      ) : null}
      {asaltos.cuadro.length > 0 ? (
        <TabsContent value="cuadro" className="flex flex-col gap-4">
          <Nota>
            Eliminación directa importada de {fuenteResultado(asaltos.fuente)}, desde la primera ronda publicada
            hasta la final.
          </Nota>
          <CuadroDePrueba cuadro={asaltos.cuadro} volver={volver} />
        </TabsContent>
      ) : null}
      {asaltos.truncado ? (
        <Nota>Se muestran los primeros asaltos importados de esta prueba; hay más que no caben en esta vista.</Nota>
      ) : null}
    </Tabs>
  );
}

export function EstadoEdicion({ vista }: { vista: Exclude<VistaEdicion, { tipo: 'ok' } | { tipo: 'sin_sesion' }> }) {
  const volver = (
    <Button asChild variant="outline">
      <Link href={RUTA_EDICIONES} prefetch={false}>
        Ver las ediciones
      </Link>
    </Button>
  );
  switch (vista.tipo) {
    case 'no_encontrada':
      return (
        <Aviso icono={<SearchX className="size-5 text-muted-foreground" aria-hidden />} titulo="Esta edición no existe">
          <p>No hay ninguna edición con ese identificador. Puede que el enlace sea antiguo.</p>
          {volver}
        </Aviso>
      );
    case 'entrada_invalida':
      return (
        <Aviso alerta icono={<TriangleAlert className="size-5 text-warn" aria-hidden />} titulo="Dirección no válida">
          <p>El identificador de la edición no se entiende, así que no se ha consultado nada.</p>
          {volver}
        </Aviso>
      );
    case 'cursor_invalido':
      return (
        <Aviso
          alerta
          icono={<TriangleAlert className="size-5 text-warn" aria-hidden />}
          titulo="Esta página ya no corresponde a la clasificación"
        >
          <p>El enlace de página es de otra prueba o ha caducado. Vuelve a la edición para elegirla de nuevo.</p>
          {volver}
        </Aviso>
      );
    case 'no_disponible':
      return (
        <Aviso
          alerta
          icono={<TriangleAlert className="size-5 text-warn" aria-hidden />}
          titulo="Las ediciones aún no están activas"
        >
          <p>Los datos deportivos todavía no están preparados en esta instalación. No es que no haya resultados.</p>
        </Aviso>
      );
    default:
      return (
        <Aviso
          alerta
          icono={<TriangleAlert className="size-5 text-danger" aria-hidden />}
          titulo="No se ha podido leer la edición"
        >
          <p>Ha fallado la consulta, no es que no haya resultados. Inténtalo de nuevo.</p>
          {volver}
        </Aviso>
      );
  }
}
