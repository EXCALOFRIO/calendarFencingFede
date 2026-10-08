import { CalendarDays, ExternalLink, MapPin, Medal, SearchX, Swords, TriangleAlert } from 'lucide-react';
import type { VistaConjunta } from '@/lib/sport/explorar/conjunta-edicion';
import { ETIQUETA_PRUEBA_CONJUNTA } from '@/lib/sport/explorar/pruebas-conjuntas';
import { EnlaceIntencion } from '@/components/enlace-intencion';
import { TIPO_TRANSICION } from '@/components/sistema/navegacion';
import { BanderaPais, codigoPais } from '@/components/bandera';
import { Button } from '@/components/ui/button';
import {
  ETIQUETA_SERIE,
  type SerieComplementaria,
} from '@/lib/ingest/series-complementarias';
import {
  ETIQUETA_FUENTE,
  ETIQUETA_PROVEEDOR,
  eleccionDelEvento,
  pruebaDeId,
  riquezaDe,
  type Clasificacion,
  type EdicionDetalle,
  type EdicionResumen,
  type PruebaDeEdicion,
  type PruebaHermana,
} from '@/lib/sport/explorar/edicion-modelo';
import {
  RUTA_EDICIONES,
  construirUrlEdicion,
  rutaEdicion,
  type CriteriosEdicion,
  type VistaPrueba,
} from '@/lib/sport/explorar/edicion-url';
import type { EdicionConAsaltos } from '@/lib/sport/explorar/ediciones';
import type { VistaEdicion, VistaSeries } from '@/lib/sport/explorar/ediciones-pantalla';
import { nombrePrueba } from '@/lib/sport/explorar/presentacion';
import { clasificarCompeticion } from '@/lib/sport/explorar/tipo-competicion';
import { organizadorDe } from '@/lib/sport/explorar/organizador';
import { InsigniaOrganismo } from '@/components/insignia-organismo';
import { BloqueFecha } from '@/components/sistema/bloque-fecha';
import { ORDEN_ARMA, SEPARADOR, rotuloArma, rotuloCategoria, rotuloFormato, rotuloPrueba } from '@/lib/sport/rotulos';
import { filasSelectorPruebas } from '@/lib/sport/selector-pruebas';
import { cn, titular } from '@/lib/utils';
import { EtiquetaTipoCompeticion } from './etiqueta-competicion';
import { EnlacePais, Nota, fechaLegible } from './piezas';
import { ListaClasificacion } from './prueba/clasificacion';
import { enlaceFichaDePrueba } from './prueba/enlaces';
import { SelectorPruebaPorNiveles } from './prueba/selector-prueba';
import { VistaPrueba as VistaDePrueba } from './prueba/vista-prueba';
import { nombreDePrueba } from './prueba-resultados';

const AVANZAR = [TIPO_TRANSICION.avanzar];

const ENLACE =
  'inline-flex min-h-[44px] items-center gap-2 text-sm text-primary-text underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none';

/** Entrada a las ediciones desde Explorar, sin ocupar sitio en la barra. */
export function EnlaceEdiciones({ className }: { className?: string }) {
  return (
    <EnlaceIntencion href={RUTA_EDICIONES} className={cn(ENLACE, className)}>
      <Medal className="size-4" aria-hidden />
      Ediciones y series
    </EnlaceIntencion>
  );
}

/** Vuelta a las ediciones desde Explorar cuando la búsqueda está acotada a una. */
export function EnlaceVolverAEdicion({ edicionId }: { edicionId: string }) {
  return (
    <EnlaceIntencion href={rutaEdicion(edicionId)} className={ENLACE}>
      <Medal className="size-4" aria-hidden />
      Ver la edición y su clasificación
    </EnlaceIntencion>
  );
}

function periodo(inicio: string | null, fin: string | null): string | null {
  if (!inicio) return null;
  return fin && fin !== inicio ? `${fechaLegible(inicio)} – ${fechaLegible(fin)}` : fechaLegible(inicio);
}

/** Un estado sin datos: icono, una frase corta y, si hace falta, una acción. */
function Aviso({
  icono,
  titulo,
  children,
  alerta = false,
}: {
  icono: React.ReactNode;
  titulo: string;
  children?: React.ReactNode;
  alerta?: boolean;
}) {
  return (
    <section role={alerta ? 'alert' : 'status'} className="flex flex-col items-start gap-3 border-y py-6">
      <p className="flex items-center gap-2 text-base font-medium">
        {icono}
        {titulo}
      </p>
      {children}
    </section>
  );
}

/* --------------------------------------------------------------------- series */

const plegar = (texto: string) => texto.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es').trim();

/**
 * Lo que tiene un evento, en pocas palabras: «Espada», «Florete · Sable» o
 * «3 armas», y «Equipos» si hay pruebas por equipos.
 */
export function marcasDeEdicion(e: Pick<EdicionResumen, 'armas' | 'formatos'>): string[] {
  const armas = ORDEN_ARMA.filter((a) => e.armas.includes(a));
  const marcas = armas.length === ORDEN_ARMA.length ? [`${armas.length} armas`] : armas.map((a) => rotuloArma(a));
  if (e.formatos.includes('EQUIPOS')) marcas.push(rotuloFormato('EQUIPOS'));
  return marcas;
}

/**
 * Un evento en una fila: fecha en bloque, nombre (o la sede, si el nombre es
 * el tipo de competición), bandera, año y lo que tiene; a la derecha, el tipo.
 * Un evento con varias ediciones (un Mundial publicado prueba a prueba) sale
 * una vez, con las fechas y armas de todas (`resumenDeIndice`).
 */
export function FilaEdicion({ e, catalogo }: { e: EdicionResumen & { clasificados?: number }; catalogo?: string }) {
  const nombre = nombrePrueba({ nombre: e.nombre, fuente: e.fuente });
  const tipo = clasificarCompeticion({ nombre: e.nombre, fuente: e.fuente, pais: e.pais ? codigoPais(e.pais) : null });
  // «Copa del Mundo» junto a la pastilla «Copa del Mundo» no dice nada: entonces manda la sede.
  const generico = [tipo.etiqueta, tipo.corta].some((t) => plegar(nombre).startsWith(plegar(t)));
  const ciudad = e.ciudad && !plegar(nombre).includes(plegar(e.ciudad)) ? titular(e.ciudad) : null;
  const principal = generico && ciudad ? ciudad : nombre;
  const sede = generico && ciudad ? null : ciudad;
  const detalle = [e.inicio?.slice(0, 4) || e.temporada, ...marcasDeEdicion(e)].filter(Boolean).join(SEPARADOR);
  return (
    <li>
      <EnlaceIntencion
        href={construirUrlEdicion(e.id, { catalogo })}
        transitionTypes={AVANZAR}
        title={generico && ciudad ? `${nombre} ${ciudad}` : undefined}
        className="flex min-h-16 items-center gap-3 px-1 py-2 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset motion-reduce:transition-none"
      >
        {e.inicio ? (
          <BloqueFecha desde={e.inicio} hasta={e.fin} />
        ) : (
          <span className="w-12 shrink-0 text-center text-xs text-muted-foreground">—</span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate font-medium">{principal}</span>
          <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            {sede ? <span className="min-w-0 shrink truncate">{sede}</span> : null}
            {e.pais ? <BanderaPais pais={e.pais} soloBandera /> : null}
            <span className="min-w-0 truncate tabular-nums">{detalle}</span>
          </span>
        </span>
        {/* Con el texto al 200 % la pastilla se recorta (lleva `title`) en vez de sacar la fila de la pantalla. */}
        <EtiquetaTipoCompeticion clasificacion={tipo} className="max-w-[30vw]" />
      </EnlaceIntencion>
    </li>
  );
}

export function ListaSeries({ series }: { series: { serie: SerieComplementaria; ediciones: EdicionResumen[] }[] }) {
  return (
    <div className="flex flex-col gap-5">
      {series.map(({ serie, ediciones }) => (
        <section key={serie} id={`serie-${serie}`} aria-labelledby={`serie-${serie}-titulo`} className="flex flex-col gap-1">
          <h3 id={`serie-${serie}-titulo`} className="text-lg leading-tight">{ETIQUETA_SERIE[serie]}</h3>
          {ediciones.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin ediciones.</p>
          ) : (
            <ul className="divide-y border-y" aria-label={`Ediciones: ${ETIQUETA_SERIE[serie]}`}>
              {ediciones.map((e) => (
                <FilaEdicion key={e.id} e={e} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

export function EstadoSeries({ vista }: { vista: Exclude<VistaSeries, { tipo: 'ok' } | { tipo: 'sin_sesion' }> }) {
  return vista.tipo === 'no_disponible' ? (
    <Aviso alerta icono={<TriangleAlert className="size-5 text-warn" aria-hidden />} titulo="Las series aún no están activas" />
  ) : (
    <Aviso alerta icono={<TriangleAlert className="size-5 text-danger" aria-hidden />} titulo="No se han podido leer las series">
      <Button asChild variant="outline" size="sm" className="rounded-full">
        <EnlaceIntencion href={RUTA_EDICIONES}>
          Reintentar
        </EnlaceIntencion>
      </Button>
    </Aviso>
  );
}

/* -------------------------------------------------------------------- edición */

/**
 * Rótulos de pruebas gemelas (mismo arma, género, categoría y formato): el
 * literal de la fuente si es corto y las distingue («+40», «+50»), el día si
 * son de días distintos y, si no, un número.
 */
function etiquetasVariante(pruebas: readonly Pick<PruebaDeEdicion, 'categoria' | 'fecha'>[]): string[] {
  const raws = pruebas.map((p) => p.categoria.raw?.trim() ?? '');
  if (new Set(raws).size === pruebas.length && raws.every((r) => r && r.length <= 12)) return raws;
  const fechas = pruebas.map((p) => p.fecha ?? '');
  if (new Set(fechas).size === pruebas.length && fechas.every(Boolean)) return fechas.map((f) => fechaLegible(f));
  return pruebas.map((_, i) => `Grupo ${i + 1}`);
}

/**
 * Selector de prueba, el mismo para todo evento: una fila por arma, género,
 * modalidad y, si cambian, categoría, grupo y fuente, con las pruebas de la
 * edición y, si el evento se publicó en varias ediciones (un Mundial prueba a
 * prueba, un campeonato de España leído de Skermo y de un PDF), de todas
 * ellas. Lo que no cambia se dice en una línea encima. Cada opción es un
 * enlace a `?prueba=` en su edición que sustituye la entrada del historial.
 */
export function PruebasDeEdicion({
  edicion,
  seleccionada,
  origen,
  catalogo,
  persona,
}: {
  edicion: EdicionDetalle;
  seleccionada: string;
  /** Calendario del que se llegó; los enlaces lo conservan. */
  origen?: string;
  catalogo?: string;
  persona?: string;
}) {
  if (edicion.pruebasDetalle.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin pruebas.</p>;
  }
  const elegida = pruebaDeId(edicion.pruebasDetalle, seleccionada) ?? edicion.pruebasDetalle[0];
  const hermanas: PruebaHermana[] = edicion.hermanas?.length
    ? edicion.hermanas
    : edicion.pruebasDetalle.map((p) => ({
        id: p.id, edicionId: edicion.id, arma: p.arma, genero: p.genero, categoria: p.categoria,
        formato: p.formato, fecha: p.fecha, fuente: p.fuente, riqueza: riquezaDe(p),
      }));
  const actualId = hermanas.some((h) => h.id === elegida.id)
    ? elegida.id
    : (hermanas.find((h) => elegida.miembros?.includes(h.id))?.id ?? elegida.id);
  const eleccion = eleccionDelEvento(hermanas, actualId);
  if (!eleccion) return null;
  const href = (h: PruebaHermana) => construirUrlEdicion(h.edicionId, { prueba: h.id, origen, catalogo, persona });
  const filas = filasSelectorPruebas(
    eleccion.principales.map((h) => ({ id: h.id, href: href(h), arma: h.arma, genero: h.genero, categoria: h.categoria, formato: h.formato })),
    eleccion.actual.id,
  );
  const etiquetasGrupo = eleccion.grupos.length ? etiquetasVariante(eleccion.grupos) : [];
  const fijas = new Set(filas.map((f) => f.dimension));
  const { actual } = eleccion;
  const resumen = [
    rotuloPrueba(
      { arma: fijas.has('arma') ? null : actual.arma, genero: fijas.has('genero') ? null : actual.genero },
      { categoria: 'nunca', formato: 'nunca' },
    ),
    fijas.has('categoria') ? '' : rotuloCategoria(actual.categoria.codigo),
    fijas.has('formato') || actual.formato !== 'EQUIPOS' ? '' : rotuloFormato(actual.formato),
  ].filter(Boolean);
  return (
    <SelectorPruebaPorNiveles
      resumen={resumen}
      filas={filas}
      grupos={eleccion.grupos.length
        ? { activa: actual.id, opciones: eleccion.grupos.map((h, i) => ({ valor: h.id, etiqueta: etiquetasGrupo[i] ?? '', href: href(h) })) }
        : undefined}
      fuentes={eleccion.fuentes.length
        ? { activa: actual.id, opciones: eleccion.fuentes.map((h) => ({ valor: h.id, etiqueta: ETIQUETA_FUENTE[h.fuente] ?? h.fuente, href: href(h) })) }
        : undefined}
    />
  );
}

function enlaceDesdeCriterios(edicionId: string, criterios: CriteriosEdicion, pruebaId: string, vista: VistaPrueba = 'clasificacion') {
  return enlaceFichaDePrueba(
    edicionId,
    { prueba: pruebaId, cursor: criterios.cursor, origen: criterios.origen, catalogo: criterios.catalogo },
    vista,
  );
}

/** Paginación (sólo por encima de mil puestos) y aviso de clasificación parcial. */
function PieClasificacion({
  edicionId,
  prueba,
  clasificacion,
  criterios,
}: {
  edicionId: string;
  prueba: PruebaDeEdicion;
  clasificacion: Clasificacion;
  criterios: CriteriosEdicion;
}) {
  const { origen, catalogo, persona } = criterios;
  const paginas = criterios.cursor || clasificacion.siguiente;
  const parcial = prueba.resultados.estado === 'parcial' && clasificacion.filas.length > 0;
  if (!paginas && !parcial) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      {paginas ? (
        <nav aria-label="Páginas de la clasificación" className="flex flex-wrap items-center gap-2">
          {criterios.cursor ? (
            <Button asChild variant="ghost" size="sm" className="rounded-full text-muted-foreground">
              <EnlaceIntencion href={construirUrlEdicion(edicionId, { prueba: prueba.id, origen, catalogo, persona })}>
                Primeros puestos
              </EnlaceIntencion>
            </Button>
          ) : null}
          {clasificacion.siguiente ? (
            <Button asChild variant="outline" size="sm" className="rounded-full px-5">
              <EnlaceIntencion
                href={construirUrlEdicion(edicionId, { prueba: prueba.id, cursor: clasificacion.siguiente, origen, catalogo, persona })}
                rel="next"
              >
                Ver más
              </EnlaceIntencion>
            </Button>
          ) : null}
        </nav>
      ) : null}
      {parcial ? <Nota>Clasificación parcial</Nota> : null}
    </div>
  );
}

/**
 * La clasificación sola, pintada en el servidor (sin buscador ni vistas). La
 * página usa `VistaPrueba`; esto queda para quien enseña sólo los puestos.
 */
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
  return (
    <section aria-label={`Clasificación: ${nombreDePrueba(prueba)}`} className="flex min-w-0 flex-col gap-3">
      <ListaClasificacion
        filas={clasificacion.filas}
        enlace={enlaceDesdeCriterios(edicion.id, criterios, prueba.id)}
        filtro={{ consulta: '', persona: criterios.persona }}
      />
      <PieClasificacion edicionId={edicion.id} prueba={prueba} clasificacion={clasificacion} criterios={criterios} />
    </section>
  );
}

/** El enlace de resultados oficiales de la prueba, si hay uno comprobado. */
function enlaceOficial(p: PruebaDeEdicion | null) {
  if (!p) return null;
  const e = p.enlaces.find((x) => x.tipo === 'verificado') ?? p.enlaces.find((x) => x.tipo === 'solo_enlace');
  return e ? { url: e.url, proveedor: ETIQUETA_PROVEEDOR[e.proveedor] } : null;
}

/**
 * Prueba partida ↔ prueba conjunta: desde una parte, el enlace a las poules y
 * el cuadro; desde la conjunta, las clasificaciones oficiales que agrupa.
 */
export function EnlaceConjunta({ conjunta, criterios }: { conjunta: VistaConjunta; criterios: CriteriosEdicion }) {
  const { origen, catalogo, persona } = criterios;
  if (!conjunta.esConjunta) {
    return (
      <EnlaceIntencion
        data-conjunta="parte"
        href={construirUrlEdicion(conjunta.conjunta.edicionId, { prueba: conjunta.conjunta.pruebaId, vista: 'poules', origen, catalogo, persona })}
        className={cn(ENLACE, 'self-start')}
      >
        <Swords className="size-4" aria-hidden />
        {ETIQUETA_PRUEBA_CONJUNTA}
      </EnlaceIntencion>
    );
  }
  if (conjunta.partes.length === 0) return null;
  return (
    <p data-conjunta="conjunta" className="flex min-w-0 flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
      <span>Clasificación oficial:</span>
      {conjunta.partes.map((p) => (
        <EnlaceIntencion
          key={p.pruebaId}
          href={construirUrlEdicion(p.edicionId, { prueba: p.pruebaId, origen, catalogo, persona })}
          className={ENLACE}
        >
          {p.etiqueta}
        </EnlaceIntencion>
      ))}
    </p>
  );
}

export function EdicionCompleta({
  edicion,
  criterios,
  conjunta = null,
  calendario = null,
}: {
  edicion: EdicionConAsaltos;
  criterios: CriteriosEdicion;
  /** Prueba conjunta de la elegida (ver `conjunta-edicion.ts`). */
  conjunta?: VistaConjunta | null;
  /** El torneo en el calendario (`urlEventoCalendario`), si la edición es uno de sus torneos. */
  calendario?: string | null;
}) {
  const idElegida = edicion.pruebaElegida ?? criterios.prueba;
  const elegida = idElegida ? (pruebaDeId(edicion.pruebasDetalle, idElegida) ?? null) : null;
  const fechas = elegida?.fecha ? fechaLegible(elegida.fecha) : periodo(edicion.inicio, edicion.fin);
  const titulo = nombrePrueba({ nombre: edicion.nombre, formato: elegida?.formato, fuente: edicion.fuente });
  const oficial = enlaceOficial(elegida);
  const tipo = clasificarCompeticion({ nombre: edicion.nombre, fuente: edicion.fuente, pais: edicion.pais ? codigoPais(edicion.pais) : null });
  const organizador = organizadorDe(tipo, edicion.fuente);
  return (
    <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-4">
      <header className="flex min-w-0 flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <h1 className="min-w-0 text-3xl leading-8 break-words sm:text-4xl sm:leading-10">{titulo}</h1>
          {oficial ? (
            <a
              href={oficial.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Resultados oficiales en ${oficial.proveedor} (se abre en otra pestaña)`}
              title={`Resultados oficiales en ${oficial.proveedor}`}
              className="group -m-1 inline-flex size-[44px] shrink-0 items-center justify-center rounded-full focus-visible:outline-none"
            >
              <span className="inline-flex size-[36px] items-center justify-center rounded-full border border-input bg-card text-muted-foreground transition-colors group-hover:bg-accent group-hover:text-foreground group-focus-visible:ring-[3px] group-focus-visible:ring-ring">
                <ExternalLink className="size-4" aria-hidden />
              </span>
            </a>
          ) : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {organizador !== 'OTRO' ? (
            <span className="inline-flex items-center gap-2">
              <InsigniaOrganismo organismo={organizador} />
              <EtiquetaTipoCompeticion clasificacion={tipo} />
            </span>
          ) : null}
          {fechas && calendario ? (
            <EnlaceIntencion
              href={calendario}
              data-enlace="calendario"
              aria-label={`${fechas}. Ver el torneo en el calendario`}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-sm text-primary-text underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
            >
              <CalendarDays aria-hidden className="size-4" />
              {fechas}
            </EnlaceIntencion>
          ) : fechas ? (
            <span className="inline-flex items-center gap-2">
              <CalendarDays aria-hidden className="size-4" />
              {fechas}
            </span>
          ) : null}
          {edicion.ciudad || edicion.pais ? (
            <span className="inline-flex min-w-0 items-center gap-2">
              <MapPin aria-hidden className="size-4 shrink-0" />
              {edicion.ciudad ? <span className="break-words">{titular(edicion.ciudad)}</span> : null}
              {edicion.pais ? <EnlacePais pais={edicion.pais} /> : null}
            </span>
          ) : null}
          {edicion.serie ? <span>{ETIQUETA_SERIE[edicion.serie]}</span> : null}
          {fechas ? null : <span>{edicion.temporada}</span>}
          {conjunta?.esConjunta && conjunta.partes.length > 0 ? (
            <span data-conjunta="titulo" className="inline-flex items-center gap-2">
              <Swords aria-hidden className="size-4" />
              Prueba conjunta
            </span>
          ) : null}
        </p>
      </header>

      {edicion.pruebaDesconocida ? (
        <p role="alert" className="text-sm text-warn">
          Esa prueba no es de esta edición.
        </p>
      ) : null}

      <PruebasDeEdicion
        edicion={edicion}
        seleccionada={elegida?.id ?? ''}
        origen={criterios.origen}
        catalogo={criterios.catalogo}
        persona={criterios.persona}
      />

      {conjunta && elegida ? <EnlaceConjunta conjunta={conjunta} criterios={criterios} /> : null}

      {elegida ? (
        <ResultadosDePrueba
          key={elegida.id}
          edicion={edicion}
          prueba={elegida}
          clasificacion={edicion.clasificacion}
          criterios={criterios}
        />
      ) : null}
    </div>
  );
}

/** Clasificación, poules y directas de la prueba elegida, con buscador. */
function ResultadosDePrueba({
  edicion,
  prueba,
  clasificacion,
  criterios,
}: {
  edicion: EdicionConAsaltos;
  prueba: PruebaDeEdicion;
  clasificacion: Clasificacion | null;
  criterios: CriteriosEdicion;
}) {
  const asaltos = edicion.asaltos ?? null;
  const filas = clasificacion?.filas ?? [];
  if (filas.length === 0 && (asaltos === null || (asaltos !== 'error' && asaltos.poules.length === 0 && asaltos.cuadro.length === 0))) {
    return (
      <p role="status" className="border-y py-6 text-center text-sm text-muted-foreground">
        Sin resultados.
      </p>
    );
  }
  const avisoAsaltos =
    asaltos === 'error' ? (
      <Nota className="text-warn">No se han podido leer las poules ni las directas.</Nota>
    ) : asaltos?.truncado ? (
      <Nota>Faltan asaltos por mostrar.</Nota>
    ) : null;
  return (
    <>
      <VistaDePrueba
        edicionId={edicion.id}
        base={{ prueba: prueba.id, cursor: criterios.cursor, origen: criterios.origen, catalogo: criterios.catalogo }}
        persona={criterios.persona}
        vista={criterios.vista}
        clasificacion={filas}
        asaltos={asaltos}
        avisoAsaltos={avisoAsaltos}
        pieClasificacion={
          clasificacion ? (
            <PieClasificacion edicionId={edicion.id} prueba={prueba} clasificacion={clasificacion} criterios={criterios} />
          ) : null
        }
      />
      {asaltos === 'error' ? avisoAsaltos : null}
    </>
  );
}

export function EstadoEdicion({ vista }: { vista: Exclude<VistaEdicion, { tipo: 'ok' } | { tipo: 'sin_sesion' }> }) {
  switch (vista.tipo) {
    case 'no_encontrada':
      return <Aviso icono={<SearchX className="size-5 text-muted-foreground" aria-hidden />} titulo="Esta edición no existe" />;
    case 'entrada_invalida':
      return <Aviso alerta icono={<TriangleAlert className="size-5 text-warn" aria-hidden />} titulo="Dirección no válida" />;
    case 'cursor_invalido':
      return (
        <Aviso alerta icono={<TriangleAlert className="size-5 text-warn" aria-hidden />} titulo="Esa página de la clasificación ya no vale" />
      );
    case 'no_disponible':
      return (
        <Aviso alerta icono={<TriangleAlert className="size-5 text-warn" aria-hidden />} titulo="Las ediciones aún no están activas" />
      );
    default:
      return (
        <Aviso alerta icono={<TriangleAlert className="size-5 text-danger" aria-hidden />} titulo="No se ha podido leer la edición" />
      );
  }
}
