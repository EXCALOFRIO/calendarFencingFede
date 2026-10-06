import { ArrowLeftRight, ChevronDown, SearchX, TriangleAlert, UserRoundSearch, Users, X } from 'lucide-react';
import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import type { EncuentroCaraACara, MarcadorEncuentro, ResumenEncuentros } from '@/lib/sport/explorar/cara-a-cara';
import { rutaEdicion } from '@/lib/sport/explorar/edicion-url';
import { etiquetaRonda } from '@/lib/sport/explorar/ediciones-asaltos';
import { CLASES_MEDALLA, categoriaVisible, medallaDe, nombrePrueba } from '@/lib/sport/explorar/presentacion';
import { inicialesVisibles, nombreVisible } from '@/lib/sport/nombre-visible';
import {
  chipsCaraACara,
  construirUrlCaraACara,
  rutaCaraACara,
  urlElegirRival,
  urlVistaDelRival,
  type CriteriosCaraACara,
} from '@/lib/sport/explorar/cara-a-cara-url';
import type {
  DatosCaraACara,
  OtrosVista,
  PersonaCaraACara,
  RivalesVista,
  VistaCaraACara,
} from '@/lib/sport/explorar/cara-a-cara-pantalla';
import type { DeportistaResumen } from '@/lib/sport/explorar/tipos';
import { etiquetaTemporada, rutaFicha } from '@/lib/sport/explorar/url';
import { WEAPON_LABEL, cn, titular } from '@/lib/utils';
import { EtiquetaTipoCompeticion } from './etiqueta-competicion';
import { FotoDeportista } from './foto-deportista';
import { Bloque, Nota } from './piezas';

/**
 * Cara a cara individual. Sólo lleva lo que traen los DTO de `cara-a-cara.ts`:
 * asaltos individuales con marcador publicado entre dos personas confirmadas,
 * orientados a la persona consultada, y las pruebas en las que coincidieron.
 * Ningún texto afirma que dos personas «nunca se enfrentaron»: un conjunto
 * vacío sólo describe lo importado.
 *
 * Las frases para lector de pantalla van en `aria-label` y no en `sr-only`:
 * así no aparecen al copiar el texto de la página.
 */

const ENLACE_CLASES =
  'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset';

/** El mismo nombre en toda la pantalla: «Juan Zabala», nunca «ZABALA Juan». */
function visible(nombre: string): string {
  return nombreVisible(nombre) || titular(nombre);
}

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

function decimal(n: number): string {
  return n.toLocaleString('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
}

/* --------------------------------------------------------------------- cabecera */

function BotonIcono({
  href,
  etiqueta,
  titulo,
  children,
}: {
  href: string;
  etiqueta: string;
  titulo?: string;
  children: React.ReactNode;
}) {
  // El área táctil es la del botón (44 px); el círculo visible, 36 px.
  return (
    <Button asChild variant="ghost" size="icon" className="group rounded-full text-muted-foreground hover:bg-transparent hover:text-foreground">
      <Link href={href} prefetch={false} aria-label={etiqueta} title={titulo ?? etiqueta}>
        <span className="inline-flex size-9 items-center justify-center rounded-full border border-filete-alto transition-colors group-hover:bg-secondary">
          {children}
        </span>
      </Link>
    </Button>
  );
}

function Contendiente({
  persona,
  nombre,
  bandera,
  className,
}: {
  persona: PersonaCaraACara;
  nombre: string;
  bandera: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col items-center gap-2 text-center', className)}>
      <FotoDeportista personaId={persona.id} nombre={nombre} tamano="heroe" />
      <Link
        href={rutaFicha(persona.id)}
        prefetch={false}
        aria-label={`Ficha de ${nombre}`}
        className={cn(
          'max-w-full rounded-sm font-display text-xl leading-tight font-semibold break-words underline-offset-4 hover:underline sm:text-3xl',
          ENLACE_CLASES,
        )}
      >
        {nombre}
      </Link>
      {bandera && persona.pais ? <BanderaPais pais={persona.pais} /> : null}
    </div>
  );
}

/** Barra partida: la parte de la persona consultada en carmesí, la del rival apagada. */
function BarraPartida({ yo, rival, className }: { yo: number; rival: number; className?: string }) {
  const total = yo + rival;
  const pct = total > 0 ? (yo / total) * 100 : 50;
  return (
    <span aria-hidden className={cn('flex h-1.5 w-full gap-0.5', className)}>
      {pct > 0 ? <span className="rounded-full bg-primary" style={{ width: `${pct}%` }} /> : null}
      {pct < 100 ? <span className="flex-1 rounded-full bg-muted-foreground/35" /> : null}
    </span>
  );
}

/**
 * Cabecera: las dos personas, el balance de asaltos en grande, el reparto de
 * victorias y los últimos resultados. En móvil el marcador baja a su propia
 * fila para que los retratos no lo estrujen.
 */
export function CabeceraCaraACara({
  datos,
  criterios,
}: {
  datos: DatosCaraACara;
  criterios: CriteriosCaraACara;
}) {
  const { yo, rival } = datos.personas;
  const nYo = visible(yo.nombre);
  const nRival = visible(rival.nombre);
  // La cabecera también se pinta sólo con las personas (sin resumen ni asaltos).
  const r = datos.resumen;
  const conBalance = Boolean(r && r.asaltos > 0);
  const decididos = r ? r.victorias + r.derrotas : 0;
  const pctYo = decididos > 0 && r ? Math.round((r.victorias / decididos) * 100) : null;
  // Los últimos asaltos sólo son los últimos en la primera página.
  const ultimos = !criterios.cursor ? (datos.items ?? []).slice(0, 8) : [];
  const cambiar = construirUrlCaraACara(yo.id, { temporada: criterios.temporada, arma: criterios.arma, fase: criterios.fase });
  // Dos banderas iguales no dicen nada: sólo se pintan si los países difieren.
  const banderas = Boolean(yo.pais || rival.pais) && yo.pais !== rival.pais;

  return (
    <header className="flex min-w-0 flex-col gap-5 overflow-hidden rounded-md border border-t-filete-alto bg-linear-to-b from-marcado/70 via-card to-card px-3 pt-1 pb-5 sm:px-8 sm:pb-7">
      <div className="-mx-1 flex items-center justify-between gap-2">
        <h1 className="pl-1 text-sm text-muted-foreground">Cara a cara</h1>
        <span className="flex">
          <BotonIcono href={urlVistaDelRival(yo.id, rival.id, criterios)} etiqueta={`Verlo desde ${nRival}`} titulo="Invertir perspectiva">
            <ArrowLeftRight className="size-4" aria-hidden />
          </BotonIcono>
          <BotonIcono href={cambiar} etiqueta="Cambiar de rival">
            <UserRoundSearch className="size-4" aria-hidden />
          </BotonIcono>
        </span>
      </div>

      <div className="grid grid-cols-2 items-start gap-x-3 gap-y-5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-x-8">
        <Contendiente persona={yo} nombre={nYo} bandera={banderas} className="col-start-1 row-start-1" />
        <div className="col-span-2 row-start-2 flex flex-col items-center gap-1.5 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:pt-8">
          {conBalance && r ? (
            <>
              <p
                role="img"
                aria-label={`${plural(r.victorias, 'victoria', 'victorias')} y ${plural(r.derrotas, 'derrota', 'derrotas')} de ${nYo}`}
                className="cifra flex items-center gap-3 text-7xl leading-none sm:gap-5 sm:text-8xl"
              >
                <span className={r.victorias >= r.derrotas ? 'text-foreground' : 'text-muted-foreground'}>{r.victorias}</span>
                <span aria-hidden className="h-1.5 w-5 rounded-full bg-muted-foreground/40 sm:w-7" />
                <span className={r.derrotas >= r.victorias ? 'text-foreground' : 'text-muted-foreground'}>{r.derrotas}</span>
              </p>
              <p className="flex gap-3 text-xs text-muted-foreground">
                <span>{plural(r.asaltos, 'asalto', 'asaltos')}</span>
                {r.sinDecidir > 0 ? <span>{plural(r.sinDecidir, 'igualado', 'igualados')}</span> : null}
              </p>
            </>
          ) : (
            <p className="font-display text-4xl text-muted-foreground/70 sm:text-5xl">vs</p>
          )}
        </div>
        <Contendiente persona={rival} nombre={nRival} bandera={banderas} className="col-start-2 row-start-1 sm:col-start-3" />
      </div>

      {pctYo !== null ? (
        <div className="flex items-center gap-3" role="img" aria-label={`${nYo} gana el ${pctYo} % de los asaltos decididos`}>
          <span aria-hidden className="cifra w-11 text-lg">{pctYo}%</span>
          <BarraPartida yo={pctYo} rival={100 - pctYo} className="h-2" />
          <span aria-hidden className="cifra w-11 text-right text-lg text-muted-foreground">{100 - pctYo}%</span>
        </div>
      ) : null}

      {ultimos.length > 0 ? (
        <div className="flex items-center justify-center gap-2.5">
          <span className="text-xs text-muted-foreground">Últimos</span>
          <p
            role="img"
            aria-label={`Últimos asaltos, del más reciente: ${ultimos.map((a) => (a.resultado === 'victoria' ? 'victoria' : 'derrota')).join(', ')}`}
            className="flex gap-1.5"
          >
            {ultimos.map((a) => (
              <span
                key={a.id}
                aria-hidden
                className={cn(
                  'inline-flex size-6 items-center justify-center rounded-full text-[0.6875rem] font-bold text-background',
                  a.resultado === 'victoria' ? 'bg-ok' : 'bg-danger',
                )}
              >
                {a.resultado === 'victoria' ? 'V' : 'D'}
              </span>
            ))}
          </p>
        </div>
      ) : null}
    </header>
  );
}

/* --------------------------------------------------------------------- cifras */

type Comparada = {
  clave: string;
  rotulo: string;
  yo: number;
  rival: number;
  textoYo?: string;
  textoRival?: string;
  detalle?: string;
};

function TarjetaComparada({ c, nYo, nRival, className }: { c: Comparada; nYo: string; nRival: string; className?: string }) {
  return (
    <div
      role="group"
      aria-label={`${c.rotulo}: ${nYo} ${c.textoYo ?? c.yo}, ${nRival} ${c.textoRival ?? c.rival}${c.detalle ? `, ${c.detalle}` : ''}`}
      className={cn('flex min-w-0 flex-col gap-2 bg-card px-3.5 py-3', className)}
    >
      <span aria-hidden className="truncate text-xs text-muted-foreground">{c.rotulo}</span>
      <span aria-hidden className="flex items-baseline justify-between gap-2">
        <span className={cn('cifra text-3xl leading-none', c.yo >= c.rival ? 'text-foreground' : 'text-muted-foreground')}>
          {c.textoYo ?? c.yo}
        </span>
        {c.detalle ? <span className="truncate text-[0.6875rem] text-muted-foreground">{c.detalle}</span> : null}
        <span className={cn('cifra text-3xl leading-none', c.rival >= c.yo ? 'text-foreground' : 'text-muted-foreground')}>
          {c.textoRival ?? c.rival}
        </span>
      </span>
      <BarraPartida yo={c.yo} rival={c.rival} className="h-1" />
    </div>
  );
}

/**
 * Las cifras del duelo en una banda partida por filetes, cada una con la
 * persona consultada a la izquierda: quién terminó por delante en la clasificación,
 * tocados, media por asalto y el balance de poule frente al de directa.
 */
export function ResumenEncuentrosVista({
  datos,
  resumen,
  criterios,
}: {
  datos: DatosCaraACara;
  resumen?: ResumenEncuentros;
  criterios?: CriteriosCaraACara;
}) {
  const r = datos.resumen;
  const nYo = visible(datos.personas.yo.nombre);
  const nRival = visible(datos.personas.rival.nombre);
  const tarjetas: Comparada[] = [];
  if (resumen && resumen.conAmbosPuestos > 0) {
    tarjetas.push({
      clave: 'delante',
      yo: resumen.delanteYo,
      rival: resumen.delanteRival,
      detalle: `de ${resumen.conAmbosPuestos}`,
      rotulo: 'Por delante',
    });
  }
  if (r && r.asaltos > 0) {
    tarjetas.push(
      { clave: 'tocados', rotulo: 'Tocados', yo: r.tantosFavor, rival: r.tantosContra },
      {
        clave: 'media', rotulo: 'Media',
        yo: r.tantosFavor / r.asaltos, rival: r.tantosContra / r.asaltos,
        textoYo: decimal(r.tantosFavor / r.asaltos), textoRival: decimal(r.tantosContra / r.asaltos),
      },
    );
  }
  if (resumen) {
    const fase = criterios?.fase ?? '';
    const poule = resumen.poule.victorias + resumen.poule.derrotas;
    const directa = resumen.directa.victorias + resumen.directa.derrotas;
    if (poule > 0 && fase !== 'TABLEAU') {
      tarjetas.push({ clave: 'poule', rotulo: 'Poule', yo: resumen.poule.victorias, rival: resumen.poule.derrotas });
    }
    if (directa > 0 && fase !== 'POULE') {
      tarjetas.push({ clave: 'directa', rotulo: 'Directa', yo: resumen.directa.victorias, rival: resumen.directa.derrotas });
    }
  }
  if (tarjetas.length === 0) return null;
  // En móvil van de dos en dos y la primera ocupa la fila entera; si sobra
  // una al final, también se estira para no dejar un hueco. Desde `sm`, todas
  // en una fila.
  const sobra = (tarjetas.length - 1) % 2 === 1;
  return (
    <section aria-label="Cifras del cara a cara" className="grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-md border bg-border sm:auto-cols-fr sm:grid-flow-col sm:grid-cols-none">
      {tarjetas.map((c, i) => (
        <TarjetaComparada
          key={c.clave}
          c={c}
          nYo={nYo}
          nRival={nRival}
          className={cn((i === 0 || (sobra && i === tarjetas.length - 1)) && 'col-span-2 sm:col-span-1')}
        />
      ))}
    </section>
  );
}

export function CaraACaraCompleto({
  datos,
  criterios,
  rendimiento,
}: {
  datos: DatosCaraACara;
  criterios: CriteriosCaraACara;
  /** Gráficos de rendimiento del duelo, debajo de las cifras. */
  rendimiento?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <ResumenEncuentrosVista datos={datos} resumen={datos.resumenEncuentros} criterios={criterios} />
      {rendimiento}
      <EncuentrosCaraACara datos={datos} encuentros={datos.encuentros ?? []} />
    </div>
  );
}

/* ------------------------------------------------------------------- cruces */

const CORTA: Record<string, string> = {
  'Cuartos de final': 'Cuartos',
  Semifinales: 'Semifinal',
};

/** «Poule», «Tabla de 32», «Cuartos», «Semifinal», «Final»: nunca la clave publicada. */
export function rotuloMarcador(m: Pick<MarcadorEncuentro, 'fase' | 'ronda'>): string {
  if (m.fase === 'POULE') return 'Poule';
  const etiqueta = m.ronda ? etiquetaRonda('TABLEAU', m.ronda) : '';
  if (!etiqueta || etiqueta.startsWith('Ronda ')) return 'Directa';
  return CORTA[etiqueta] ?? etiqueta;
}

const DIA = new Intl.DateTimeFormat('es-ES', { day: '2-digit', timeZone: 'UTC' });
const MES = new Intl.DateTimeFormat('es-ES', { month: 'short', timeZone: 'UTC' });
const FECHA_LARGA = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

function fechaDe(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Enlace a la prueba dentro de su edición, abierta en la persona consultada. */
export function urlCruce(e: Pick<EncuentroCaraACara, 'edicionId' | 'pruebaId'>, personaId: string): string {
  const params = new URLSearchParams({ prueba: e.pruebaId, persona: personaId });
  return `${rutaEdicion(e.edicionId)}?${params.toString()}`;
}

function Puesto({ puesto, delante }: { puesto: number | null; delante: boolean }) {
  const medalla = medallaDe(puesto);
  return (
    <span
      aria-hidden
      className={cn(
        'cifra inline-flex h-8 w-9 items-center justify-center rounded-md border text-base',
        medalla
          ? CLASES_MEDALLA[medalla]
          : delante
            ? 'border-filete-alto bg-secondary text-foreground'
            : 'border-transparent text-muted-foreground',
      )}
    >
      {puesto}
    </span>
  );
}

function ChipMarcador({ m }: { m: MarcadorEncuentro }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-filete-alto px-2 text-xs whitespace-nowrap">
      <span className="text-muted-foreground">{rotuloMarcador(m)}</span>
      <span
        className={cn(
          'cifra text-sm',
          m.mios > m.rival ? 'text-ok' : m.mios < m.rival ? 'text-danger' : 'text-foreground',
        )}
      >
        {m.mios}–{m.rival}
      </span>
    </span>
  );
}

const FILA = 'grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-start gap-x-3 px-3 sm:grid-cols-[2.75rem_minmax(0,1fr)_auto] sm:px-4';

function FilaCruce({
  e,
  yo,
  nYo,
  nRival,
  armaHabitual,
}: {
  e: EncuentroCaraACara;
  yo: string;
  nYo: string;
  nRival: string;
  /** Arma de casi todas las pruebas: sólo se escribe en las que no la tienen. */
  armaHabitual: string;
}) {
  const nombre = nombrePrueba({ nombre: e.torneo, formato: e.formato, fuente: e.fuente });
  const fecha = fechaDe(e.fecha);
  const detalle = [e.arma !== armaHabitual ? WEAPON_LABEL[e.arma] : null, categoriaVisible(e.categoria), e.ciudad ? titular(e.ciudad) : null]
    .filter((x): x is string => Boolean(x));
  const puesto = (n: number | null) => (n === null ? 'sin puesto' : `${n}º`);
  const etiqueta = [
    nombre,
    fecha ? FECHA_LARGA.format(fecha) : null,
    `${nYo} ${puesto(e.puestos.yo)}, ${nRival} ${puesto(e.puestos.rival)}`,
    ...e.marcadores.map((m) => `${rotuloMarcador(m)} ${m.mios}–${m.rival}`),
  ]
    .filter(Boolean)
    .join('. ');
  const contenido = (
    <>
      {fecha ? (
        <time dateTime={e.fecha!.slice(0, 10)} aria-hidden className="flex flex-col items-center pt-0.5 leading-none">
          <span className="cifra text-xl">{DIA.format(fecha)}</span>
          <span className="text-[0.6875rem] text-muted-foreground">{MES.format(fecha).replace('.', '')}</span>
        </time>
      ) : (
        <span aria-hidden className="pt-1 text-center text-xs text-muted-foreground">–</span>
      )}
      <span aria-hidden className="flex min-w-0 flex-col gap-1">
        <span className="line-clamp-2 text-sm leading-snug font-medium">{nombre}</span>
        <span className="flex min-w-0 items-center gap-2 overflow-hidden text-xs whitespace-nowrap text-muted-foreground">
          <EtiquetaTipoCompeticion clasificacion={e.clasificacion} className="h-5 px-2 text-[0.625rem]" />
          {detalle.map((d, i) => (
            <span key={d} className={cn(i === detalle.length - 1 && 'min-w-0 truncate')}>{d}</span>
          ))}
        </span>
        {e.marcadores.length > 0 ? (
          <span className="mt-0.5 flex flex-wrap gap-1.5">
            {e.marcadores.map((m, i) => <ChipMarcador key={i} m={m} />)}
          </span>
        ) : null}
      </span>
      <span aria-hidden className="flex gap-1">
        <Puesto puesto={e.puestos.yo} delante={e.delante === 'yo' || e.delante === 'empate'} />
        <Puesto puesto={e.puestos.rival} delante={e.delante === 'rival' || e.delante === 'empate'} />
      </span>
    </>
  );
  return (
    <li>
      {e.edicionId ? (
        <Link
          href={urlCruce(e, yo)}
          prefetch={false}
          aria-label={etiqueta}
          className={cn(FILA, 'py-3 transition-colors hover:bg-secondary/60', ENLACE_CLASES)}
        >
          {contenido}
        </Link>
      ) : (
        <div aria-label={etiqueta} role="group" className={cn(FILA, 'py-3')}>
          {contenido}
        </div>
      )}
    </li>
  );
}

type Anio = { anio: string; encuentros: EncuentroCaraACara[] };

function porAnio(encuentros: readonly EncuentroCaraACara[]): Anio[] {
  const grupos: Anio[] = [];
  for (const e of encuentros) {
    const anio = e.fecha?.slice(0, 4) ?? 'Sin fecha';
    const ultimo = grupos.at(-1);
    if (ultimo && ultimo.anio === anio) ultimo.encuentros.push(e);
    else grupos.push({ anio, encuentros: [e] });
  }
  return grupos;
}

function ListaCruces({
  encuentros,
  ...fila
}: {
  encuentros: readonly EncuentroCaraACara[];
  yo: string;
  nYo: string;
  nRival: string;
  armaHabitual: string;
}) {
  return porAnio(encuentros).map((g, i) => (
    <div key={`${g.anio}-${i}`} className="min-w-0">
      <h3 className="border-y border-filete bg-secondary/50 px-3 py-1 text-xs font-semibold text-muted-foreground sm:px-4">
        {g.anio}
      </h3>
      <ol className="divide-y divide-filete">
        {g.encuentros.map((e) => <FilaCruce key={e.pruebaId} e={e} {...fila} />)}
      </ol>
    </div>
  ));
}

const CRUCES_VISIBLES = 12;

function armaMasComun(encuentros: readonly EncuentroCaraACara[]): string {
  const cuenta = new Map<string, number>();
  for (const e of encuentros) cuenta.set(e.arma, (cuenta.get(e.arma) ?? 0) + 1);
  return [...cuenta].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

/**
 * Todas las pruebas individuales en las que coincidieron, de la más reciente:
 * fecha, prueba, los dos puestos (persona consultada primero) y, si se
 * enfrentaron, cada asalto con su ronda. Cada fila abre la prueba.
 */
export function EncuentrosCaraACara({ datos, encuentros }: { datos: DatosCaraACara; encuentros: EncuentroCaraACara[] }) {
  const { yo, rival } = datos.personas;
  const fila = {
    yo: yo.id,
    nYo: visible(yo.nombre),
    nRival: visible(rival.nombre),
    armaHabitual: armaMasComun(encuentros),
  };
  const conAsaltos = encuentros.filter((e) => e.marcadores.length > 0).length;
  return (
    <section aria-labelledby="h2h-cruces" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id="h2h-cruces" className="flex items-baseline gap-2 text-xl">
          Cruces
          {encuentros.length > 0 ? <span className="cifra text-lg text-muted-foreground">{encuentros.length}</span> : null}
        </h2>
        <p className="text-xs text-muted-foreground">
          {encuentros.length === 0
            ? 'Sin pruebas comunes importadas con estos filtros.'
            : `Asaltos disponibles en ${conAsaltos} de ${plural(encuentros.length, 'prueba común', 'pruebas comunes')}${datos.resumenEncuentros?.truncado ? ' (las más recientes)' : ''}`}
        </p>
      </div>
      {encuentros.length > 0 ? (
        <div className="min-w-0 overflow-hidden rounded-md border border-t-filete-alto bg-card">
          <div aria-hidden className={cn(FILA, 'items-center py-2 text-[0.625rem] font-semibold text-muted-foreground')}>
            <span />
            <span />
            <span className="flex gap-1">
              <span className="w-9 truncate text-center" title={fila.nYo}>{inicialesVisibles(yo.nombre)}</span>
              <span className="w-9 truncate text-center" title={fila.nRival}>{inicialesVisibles(rival.nombre)}</span>
            </span>
          </div>
          <ListaCruces encuentros={encuentros.slice(0, CRUCES_VISIBLES)} {...fila} />
          {encuentros.length > CRUCES_VISIBLES ? (
            <details className="group min-w-0">
              <summary
                className={cn(
                  'flex min-h-11 cursor-pointer list-none items-center justify-center gap-1.5 border-t border-filete text-sm font-medium text-primary-text hover:bg-secondary/60 [&::-webkit-details-marker]:hidden',
                  ENLACE_CLASES,
                )}
              >
                <span className="group-open:hidden">Ver {encuentros.length - CRUCES_VISIBLES} más</span>
                <span className="hidden group-open:inline">Ver menos</span>
                <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <ListaCruces encuentros={encuentros.slice(CRUCES_VISIBLES)} {...fila} />
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/* ----------------------------------------------------------------- elegir rival */

function FilaPersona({
  href,
  nombre,
  pais,
  detalle,
  aviso,
}: {
  href: string;
  nombre: string;
  pais: string | null;
  detalle: React.ReactNode;
  aviso?: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        prefetch={false}
        className={cn(
          'grid min-h-11 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-4 hover:bg-accent focus-visible:bg-accent md:grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)] md:items-center',
          ENLACE_CLASES,
        )}
      >
        <Avatar className="row-span-3 size-10 md:row-span-1">
          <AvatarFallback>{inicialesVisibles(nombre)}</AvatarFallback>
        </Avatar>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="font-medium break-words">{visible(nombre)}</span>
          {aviso}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          {pais ? (
            <BanderaPais pais={pais} conNombre />
          ) : (
            <span className="text-sm text-muted-foreground">País no publicado</span>
          )}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">{detalle}</span>
      </Link>
    </li>
  );
}

function OtrosCoincidentes({
  otros,
  persona,
  excluidos,
  criterios,
}: {
  otros: OtrosVista;
  persona: PersonaCaraACara;
  excluidos: ReadonlySet<string>;
  criterios: CriteriosCaraACara;
}) {
  if (otros.tipo === 'error') {
    return (
      <p role="alert" className="flex items-start gap-2 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
        <span className="medida">
          No se ha podido buscar a otras personas indexadas por ese nombre. Ha fallado la consulta; no es
          que no haya coincidencias.
        </span>
      </p>
    );
  }
  const items = otros.items.filter((d: DeportistaResumen) => d.id !== persona.id && !excluidos.has(d.id));
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 id="h2h-otros" className="text-lg">
        Otras personas indexadas que coinciden
      </h3>
      {/* La lista confirmada filtra por nombre canónico y esta búsqueda también casa alias: que una persona
          no figure arriba no prueba que no tenga asaltos con la consultada, ni siquiera con la lista leída. */}
      <Nota>
        Son personas indexadas que coinciden con el nombre o un alias. No se afirma que tengan o no asaltos
        con {visible(persona.nombre)}: su cobertura se determina al abrirlo, y ahí se muestra qué cubre la
        lectura, no un balance.
      </Nota>
      <ul aria-labelledby="h2h-otros" className="divide-y rounded-md border bg-card">
        {items.map((d) => (
          <FilaPersona
            key={d.id}
            href={urlElegirRival(persona.id, d.id, criterios)}
            nombre={d.nombre}
            pais={d.pais}
            aviso={
              d.mismoNombre > 1 ? (
                <span className="inline-flex items-start gap-1.5 text-xs text-warn">
                  <Users className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>{d.mismoNombre} personas con este nombre: comprueba país, año y armas.</span>
                </span>
              ) : d.alias ? (
                <span className="text-xs text-muted-foreground">Coincide con el alias «{d.alias}»</span>
              ) : undefined
            }
            detalle={
              <>
                <span className="text-sm">
                  {d.armas.length > 0 ? d.armas.map((a) => WEAPON_LABEL[a]).join(', ') : 'Sin pruebas importadas'}
                </span>
                {d.anioNacimiento !== null && d.mismoNombre > 1 ? (
                  <span className="text-xs text-muted-foreground">Nacimiento {d.anioNacimiento}</span>
                ) : null}
              </>
            }
          />
        ))}
      </ul>
    </div>
  );
}

const MENSAJES_RIVALES: Record<'cursor_invalido' | 'entrada_invalida' | 'no_disponible' | 'error', string> = {
  cursor_invalido:
    'Esta página de rivales es de otra búsqueda o ha caducado. Vuelve a la primera página.',
  entrada_invalida:
    'Algún valor de la dirección no se entiende (por ejemplo la temporada), así que no se ha listado a nadie. No significa que no haya rivales.',
  no_disponible:
    'Los datos deportivos todavía no están preparados en esta instalación. No significa que no haya rivales.',
  error: 'Ha fallado la consulta; no es que no haya rivales. Inténtalo de nuevo.',
};

export function ElegirRival({
  persona,
  rivales,
  otros,
  criterios,
}: {
  persona: PersonaCaraACara;
  rivales: RivalesVista;
  otros: OtrosVista | null;
  criterios: CriteriosCaraACara;
}) {
  const base = { ...criterios, cursor: '' };
  const idsRivales = new Set(rivales.tipo === 'ok' ? rivales.items.map((r) => r.id) : []);
  return (
    <div className="flex flex-col gap-6">
      <Bloque id="h2h-rivales" titulo="Rivales con asaltos confirmados" nivel="pagina">
        <Nota>
          Personas con las que {visible(persona.nombre)} tiene al menos un asalto individual con marcador
          publicado ya importado, de más a menos asaltos.
          {criterios.temporada ? ` Sólo de ${etiquetaTemporada(criterios.temporada)}.` : ''}
        </Nota>
        {rivales.tipo === 'ok' ? (
          rivales.sinResultados ? (
            <p role="status" className="medida text-sm text-muted-foreground">
              {criterios.q || criterios.temporada
                ? 'Ningún rival con asaltos importados coincide con estos criterios. '
                : 'Todavía no hay asaltos individuales importados de esta persona. '}
              Puede faltar por importar; no significa que no haya competido. Busca por nombre para abrir el
              cara a cara con cualquier persona y ver qué cubre.
            </p>
          ) : (
            <>
              <ul className="divide-y rounded-md border bg-card" aria-label="Rivales con asaltos confirmados">
                {rivales.items.map((r) => (
                  <FilaPersona
                    key={r.id}
                    href={urlElegirRival(persona.id, r.id, criterios)}
                    nombre={r.nombre}
                    pais={r.pais}
                    detalle={
                      <span className="flex items-baseline gap-1.5">
                        <span className="cifra text-2xl leading-none">{r.asaltos}</span>
                        <span className="text-xs text-muted-foreground">
                          {r.asaltos === 1 ? 'asalto importado' : 'asaltos importados'}
                        </span>
                      </span>
                    }
                  />
                ))}
              </ul>
              <nav aria-label="Páginas de rivales" className="flex flex-wrap items-center gap-3">
                {criterios.cursor ? (
                  <Button asChild variant="outline">
                    <Link href={construirUrlCaraACara(persona.id, base)} prefetch={false}>
                      Volver a la primera página
                    </Link>
                  </Button>
                ) : null}
                {rivales.siguiente ? (
                  <Button asChild variant="outline">
                    <Link
                      href={construirUrlCaraACara(persona.id, { ...base, cursor: rivales.siguiente })}
                      prefetch={false}
                      rel="next"
                    >
                      Ver más rivales
                    </Link>
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">No hay más rivales con estos criterios.</p>
                )}
              </nav>
            </>
          )
        ) : (
          <div role="alert" className="flex items-start gap-2 rounded-md border bg-card px-4 py-4 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
            <div className="flex flex-col items-start gap-2">
              <p className="medida">{MENSAJES_RIVALES[rivales.tipo]}</p>
              {rivales.tipo === 'cursor_invalido' ? (
                <Button asChild variant="outline">
                  <Link href={construirUrlCaraACara(persona.id, base)} prefetch={false}>
                    Volver a la primera página
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </Bloque>

      {otros ? (
        <OtrosCoincidentes
          otros={otros}
          persona={persona}
          excluidos={idsRivales}
          criterios={criterios}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------- chips */

/** Filtros activos como enlaces que los quitan uno a uno. */
export function ChipsCaraACara({
  personaId,
  criterios,
}: {
  personaId: string;
  criterios: CriteriosCaraACara;
}) {
  const chips = chipsCaraACara(personaId, criterios);
  if (chips.length === 0) return null;
  return (
    <ul aria-label="Filtros activos" className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <li key={chip.clave} className="min-w-0 max-w-full">
          <Link
            href={chip.quitar}
            prefetch={false}
            aria-label={`Quitar filtro ${chip.etiqueta}: ${chip.valor}`}
            className={cn(
              'inline-flex min-h-11 max-w-full flex-wrap items-center gap-1.5 rounded-full border bg-secondary px-3 text-sm hover:bg-accent',
              ENLACE_CLASES,
            )}
          >
            <span className="text-muted-foreground">{chip.etiqueta}</span>
            <span className="max-w-48 min-w-0 py-1 font-medium break-words">{chip.valor}</span>
            <X className="size-3.5" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------- estados */

function Aviso({
  titulo,
  children,
  alerta = false,
}: {
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
        {alerta ? (
          <TriangleAlert className="size-5 text-warn" aria-hidden />
        ) : (
          <SearchX className="size-5 text-muted-foreground" aria-hidden />
        )}
        <h2 className="text-xl">{titulo}</h2>
      </div>
      <div className="flex flex-col items-start gap-3 text-sm text-muted-foreground medida">{children}</div>
    </section>
  );
}

export function EstadoCaraACara({
  vista,
  personaId,
  criterios,
}: {
  vista: Exclude<VistaCaraACara, { tipo: 'ok' } | { tipo: 'elegir' } | { tipo: 'sin_sesion' }>;
  personaId: string | null;
  criterios: CriteriosCaraACara;
}) {
  const buscar = (
    <Button asChild variant="outline">
      <Link href="/explorar" prefetch={false}>
        Buscar en Explorar
      </Link>
    </Button>
  );
  const empezar = personaId ? (
    <Button asChild variant="outline">
      <Link href={rutaCaraACara(personaId)} prefetch={false}>
        Empezar de nuevo
      </Link>
    </Button>
  ) : (
    buscar
  );
  switch (vista.tipo) {
    case 'entrada_invalida':
      return (
        <Aviso alerta titulo="El enlace no es válido">
          <p>
            Alguno de los valores de la dirección no se entiende (una persona, una temporada, un arma o
            una fase), por eso no se ha hecho el cara a cara. Esto no significa que no haya asaltos.
          </p>
          {empezar}
        </Aviso>
      );
    case 'cursor_invalido':
      return (
        <Aviso alerta titulo="Esta página ya no corresponde a la consulta">
          <p>El enlace de página es de otro cara a cara o de otros filtros. Vuelve a los asaltos más recientes.</p>
          {personaId ? (
            <Button asChild variant="outline">
              <Link href={construirUrlCaraACara(personaId, { ...criterios, cursor: '' })} prefetch={false}>
                Volver a los más recientes
              </Link>
            </Button>
          ) : null}
        </Aviso>
      );
    case 'no_encontrada':
      return (
        <Aviso titulo="No se encuentra a una de las personas">
          <p>No hay ninguna persona deportiva con ese identificador. Puede que el enlace sea antiguo.</p>
          {buscar}
        </Aviso>
      );
    case 'misma_persona':
      return (
        <Aviso titulo="Es la misma persona">
          <p>
            Las dos direcciones apuntan a la misma persona (puede ser una ficha fusionada con otra). Elige
            un rival distinto.
          </p>
          {empezar}
        </Aviso>
      );
    case 'no_disponible':
      return (
        <Aviso alerta titulo="El cara a cara aún no está activo">
          <p>
            Los datos deportivos todavía no están preparados en esta instalación. No es que no haya
            asaltos.
          </p>
        </Aviso>
      );
    default:
      return (
        <Aviso alerta titulo="No se ha podido abrir el cara a cara">
          <p>
            Ha fallado la consulta; no es que no haya asaltos. Inténtalo de nuevo; si sigue fallando,
            avisa a la dirección técnica.
          </p>
          {empezar}
        </Aviso>
      );
  }
}
