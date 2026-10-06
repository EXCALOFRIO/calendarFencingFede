import { CalendarDays, ExternalLink, MapPin, Medal, SearchX, Swords, TriangleAlert } from 'lucide-react';
import type { VistaConjunta } from '@/lib/sport/explorar/conjunta-edicion';
import { ETIQUETA_PRUEBA_CONJUNTA } from '@/lib/sport/explorar/pruebas-conjuntas';
import Link from 'next/link';
import { BanderaPais, codigoPais } from '@/components/bandera';
import { Button } from '@/components/ui/button';
import {
  ETIQUETA_SERIE,
  type SerieComplementaria,
} from '@/lib/ingest/series-complementarias';
import {
  ETIQUETA_PROVEEDOR,
  pruebaDeId,
  selectorDePruebas,
  type Clasificacion,
  type EdicionDetalle,
  type EdicionResumen,
  type PruebaDeEdicion,
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
import { categoriaVisible, nombrePrueba, ordenCategoriaVisible } from '@/lib/sport/explorar/presentacion';
import { clasificarCompeticion } from '@/lib/sport/explorar/tipo-competicion';
import { organizadorDe } from '@/lib/sport/explorar/organizador';
import { InsigniaOrganismo } from '@/components/insignia-organismo';
import { cn, titular } from '@/lib/utils';
import { EtiquetaTipoCompeticion } from './etiqueta-competicion';
import { Nota, fechaLegible } from './piezas';
import { ListaClasificacion } from './prueba/clasificacion';
import { enlaceFichaDePrueba } from './prueba/enlaces';
import { SelectorPrueba, type GrupoDePruebas, type OpcionFormato } from './prueba/selector-prueba';
import { VistaPrueba as VistaDePrueba } from './prueba/vista-prueba';
import { armaYGenero, nombreDePrueba } from './prueba-resultados';

const ENLACE =
  'inline-flex min-h-11 items-center gap-1.5 text-sm text-primary-text underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none';

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

/** Una edición en una línea: fecha, nombre y sede, bandera y tipo de competición. */
/** «2026-09-25» → «25/09/26»: cabe en una columna estrecha y se ordena a la vista. */
function fechaCorta(iso: string | null): string | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : null;
}

const plegar = (texto: string) => texto.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es').trim();

export function FilaEdicion({ e, catalogo }: { e: EdicionResumen & { clasificados?: number }; catalogo?: string }) {
  const nombre = nombrePrueba({ nombre: e.nombre, fuente: e.fuente });
  const tipo = clasificarCompeticion({ nombre: e.nombre, fuente: e.fuente, pais: e.pais ? codigoPais(e.pais) : null });
  // «Copa del Mundo» junto a la pastilla «Copa del Mundo» no dice nada: entonces manda la sede.
  const generico = [tipo.etiqueta, tipo.corta].some((t) => plegar(nombre).startsWith(plegar(t)));
  const ciudad = e.ciudad && !plegar(nombre).includes(plegar(e.ciudad)) ? titular(e.ciudad) : null;
  const principal = generico && ciudad ? ciudad : nombre;
  const secundario = generico && ciudad ? null : ciudad;
  return (
    <li>
      <Link
        href={construirUrlEdicion(e.id, { catalogo })}
        prefetch={false}
        title={generico && ciudad ? `${nombre} ${ciudad}` : undefined}
        className="grid min-h-12 grid-cols-[3.75rem_minmax(0,1fr)_auto] items-center gap-x-3 px-1 py-2 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset motion-reduce:transition-none"
      >
        <span className="text-xs tabular-nums text-muted-foreground">{fechaCorta(e.inicio)}</span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate">
            <span className="font-medium">{principal}</span>
            {secundario ? <span className="text-sm text-muted-foreground"> {secundario}</span> : null}
          </span>
          {e.pais ? <BanderaPais pais={e.pais} soloBandera /> : null}
        </span>
        <EtiquetaTipoCompeticion clasificacion={tipo} />
      </Link>
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
        <Link href={RUTA_EDICIONES} prefetch={false}>
          Reintentar
        </Link>
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
function etiquetasVariante(pruebas: readonly PruebaDeEdicion[]): string[] {
  const raws = pruebas.map((p) => p.categoria.raw?.trim() ?? '');
  if (new Set(raws).size === pruebas.length && raws.every((r) => r && r.length <= 12)) return raws;
  const fechas = pruebas.map((p) => p.fecha ?? '');
  if (new Set(fechas).size === pruebas.length && fechas.every(Boolean)) return fechas.map((f) => fechaLegible(f));
  return pruebas.map((_, i) => `Grupo ${i + 1}`);
}

const clave = (p: PruebaDeEdicion) => `${p.formato}|${p.arma}|${p.genero}|${p.categoria.codigo}`;

/** Variante de cada prueba que comparte formato, arma, género y categoría con otra. */
function variantes(pruebas: readonly PruebaDeEdicion[]): Map<string, string> {
  const porClave = new Map<string, PruebaDeEdicion[]>();
  for (const p of pruebas) porClave.set(clave(p), [...(porClave.get(clave(p)) ?? []), p]);
  const salida = new Map<string, string>();
  for (const grupo of porClave.values()) {
    if (grupo.length < 2) continue;
    etiquetasVariante(grupo).forEach((e, i) => salida.set(grupo[i].id, e));
  }
  return salida;
}

const ORDEN_ARMA = ['ESPADA', 'FLORETE', 'SABLE'];
const ORDEN_GENERO = ['M', 'F', 'MIXTO'];

/**
 * Selector de prueba: individual o equipos, y una pastilla con la prueba
 * elegida que abre las demás del mismo formato agrupadas por arma y género.
 * Con una sola prueba la pastilla sólo dice cuál es.
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
  const href = (id: string) => construirUrlEdicion(edicion.id, { prueba: id, origen, catalogo, persona });
  const filaFormato = selectorDePruebas(edicion.pruebasDetalle, elegida, ordenCategoriaVisible).find(
    (f) => f.dimension === 'formato',
  );
  const formatos: OpcionFormato[] = (filaFormato?.opciones ?? []).map((o) => ({
    valor: o.valor,
    etiqueta: o.valor === 'EQUIPOS' ? 'Equipos' : 'Individual',
    href: href(o.pruebaId),
    activa: o.activa,
  }));

  const delFormato = edicion.pruebasDetalle.filter((p) => p.formato === elegida.formato);
  const variante = variantes(delFormato);
  const ordenadas = [...delFormato].sort(
    (x, y) =>
      ORDEN_ARMA.indexOf(x.arma) - ORDEN_ARMA.indexOf(y.arma) ||
      ORDEN_GENERO.indexOf(x.genero) - ORDEN_GENERO.indexOf(y.genero) ||
      ordenCategoriaVisible(x.categoria.codigo) - ordenCategoriaVisible(y.categoria.codigo) ||
      (x.fecha ?? '').localeCompare(y.fecha ?? ''),
  );
  const grupos: GrupoDePruebas[] = [];
  for (const p of ordenadas) {
    const k = `${p.arma}|${p.genero}`;
    let grupo = grupos.find((g) => g.clave === k);
    if (!grupo) {
      grupo = { clave: k, titulo: armaYGenero(p), opciones: [] };
      grupos.push(grupo);
    }
    grupo.opciones.push({
      id: p.id,
      href: href(p.id),
      activa: p.id === elegida.id,
      etiqueta: categoriaVisible(p.categoria.codigo),
      variante: variante.get(p.id),
    });
  }
  return (
    <SelectorPrueba
      formatos={formatos}
      actual={{
        titulo: armaYGenero(elegida),
        categoria: categoriaVisible(elegida.categoria.codigo),
        variante: variante.get(elegida.id),
      }}
      grupos={grupos}
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
              <Link href={construirUrlEdicion(edicionId, { prueba: prueba.id, origen, catalogo, persona })} prefetch={false}>
                Primeros puestos
              </Link>
            </Button>
          ) : null}
          {clasificacion.siguiente ? (
            <Button asChild variant="outline" size="sm" className="rounded-full px-5">
              <Link
                href={construirUrlEdicion(edicionId, { prueba: prueba.id, cursor: clasificacion.siguiente, origen, catalogo, persona })}
                prefetch={false}
                rel="next"
              >
                Ver más
              </Link>
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
      <Link
        data-conjunta="parte"
        href={construirUrlEdicion(conjunta.conjunta.edicionId, { prueba: conjunta.conjunta.pruebaId, vista: 'poules', origen, catalogo, persona })}
        prefetch={false}
        className={cn(ENLACE, 'self-start')}
      >
        <Swords className="size-4" aria-hidden />
        {ETIQUETA_PRUEBA_CONJUNTA}
      </Link>
    );
  }
  if (conjunta.partes.length === 0) return null;
  return (
    <p data-conjunta="conjunta" className="flex min-w-0 flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
      <span>Clasificación oficial:</span>
      {conjunta.partes.map((p) => (
        <Link
          key={p.pruebaId}
          href={construirUrlEdicion(p.edicionId, { prueba: p.pruebaId, origen, catalogo, persona })}
          prefetch={false}
          className={ENLACE}
        >
          {p.etiqueta}
        </Link>
      ))}
    </p>
  );
}

export function EdicionCompleta({
  edicion,
  criterios,
  conjunta = null,
}: {
  edicion: EdicionConAsaltos;
  criterios: CriteriosEdicion;
  /** Prueba conjunta de la elegida (ver `conjunta-edicion.ts`). */
  conjunta?: VistaConjunta | null;
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
          <h1 className="min-w-0 text-3xl leading-tight break-words sm:text-4xl">{titulo}</h1>
          {oficial ? (
            <a
              href={oficial.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Resultados oficiales en ${oficial.proveedor}`}
              title={`Resultados oficiales en ${oficial.proveedor}`}
              className="group -m-1 inline-flex size-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-none"
            >
              <span className="inline-flex size-9 items-center justify-center rounded-full border border-input bg-card text-muted-foreground transition-colors group-hover:bg-accent group-hover:text-foreground group-focus-visible:ring-[3px] group-focus-visible:ring-ring/50">
                <ExternalLink className="size-4" aria-hidden />
              </span>
            </a>
          ) : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {organizador !== 'OTRO' ? (
            <span className="inline-flex items-center gap-1.5">
              <InsigniaOrganismo organismo={organizador} />
              <EtiquetaTipoCompeticion clasificacion={tipo} />
            </span>
          ) : null}
          {fechas ? (
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays aria-hidden className="size-4" />
              {fechas}
            </span>
          ) : null}
          {edicion.ciudad || edicion.pais ? (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <MapPin aria-hidden className="size-4 shrink-0" />
              {edicion.ciudad ? <span className="break-words">{titular(edicion.ciudad)}</span> : null}
              {edicion.pais ? <BanderaPais pais={edicion.pais} soloBandera /> : null}
            </span>
          ) : null}
          {edicion.serie ? <span>{ETIQUETA_SERIE[edicion.serie]}</span> : null}
          {fechas ? null : <span>{edicion.temporada}</span>}
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
