import { ArrowLeftRight, ChevronDown, SearchX, Users, X } from 'lucide-react';
import { EnlaceIntencion } from '@/components/enlace-intencion';
import { BloqueFecha } from '@/components/sistema/bloque-fecha';
import { Boton, BotonIcono } from '@/components/sistema/boton';
import { CabeceraSeccion, textoVerMas } from '@/components/sistema/cabecera-seccion';
import { EstadoVacio } from '@/components/sistema/estado-vacio';
import { FilaPersona } from '@/components/sistema/fila-persona';
import { TIPO_TRANSICION } from '@/components/sistema/navegacion';
import { Pastilla, Puesto } from '@/components/sistema/pastilla';
import { fechaCorta } from '@/lib/fechas';
import type { EncuentroCaraACara, MarcadorEncuentro, ResumenEncuentros } from '@/lib/sport/explorar/cara-a-cara';
import { rutaEdicion } from '@/lib/sport/explorar/edicion-url';
import { rotuloRonda } from '@/lib/sport/explorar/ediciones-asaltos';
import { categoriaVisible, nombrePrueba, nombrePruebaCorto } from '@/lib/sport/explorar/presentacion';
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
import { rutaFicha } from '@/lib/sport/explorar/url';
import { WEAPON_LABEL, cn, titular } from '@/lib/utils';
import { BarraVictorias } from './barra-victorias';
import { EtiquetaTipoCompeticion } from './etiqueta-competicion';
import { FotoDeportista } from './foto-deportista';
import { CaraACaraHoja } from './perfil/elegir-rival-hoja';
import { Bloque, EnlacePais } from './piezas';

/**
 * Cara a cara individual. Sólo lleva lo que traen los DTO de `cara-a-cara.ts`:
 * asaltos individuales con marcador publicado entre dos personas confirmadas,
 * orientados a la persona consultada, y las pruebas en las que coincidieron.
 * Ningún texto afirma que dos personas «nunca se enfrentaron»: un conjunto
 * vacío sólo describe lo importado.
 *
 * Las frases para lector de pantalla van en `aria-label` y no en `sr-only`
 * (así no aparecen al copiar el texto) salvo en enlaces y botones con texto
 * visible: ahí un `aria-label` taparía lo que se ve (WCAG 2.5.3), así que
 * la frase va en `sr-only` y lo visible, oculto al lector.
 */

const ENLACE_CLASES =
  'focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset';

/** Entrar en una ficha, en una prueba o en un duelo desliza hacia delante (`docs/diseno-sistema.md` § 4). */
const AVANZAR = [TIPO_TRANSICION.avanzar];

/** Tinte opaco de la parte del rival en las barras: el gris apagado al 35 % sobre la tarjeta. */
const RELLENO_RIVAL = 'bg-[color-mix(in_oklab,var(--muted-foreground)_35%,var(--card))]';

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
      {/* El nombre es el enlace accesible; el retrato repite el destino sin otra parada de tabulador. */}
      <EnlaceIntencion href={rutaFicha(persona.id)} transitionTypes={AVANZAR} tabIndex={-1} aria-hidden className="block rounded-full">
        <FotoDeportista personaId={persona.id} nombre={nombre} tamano="heroe" />
      </EnlaceIntencion>
      <EnlaceIntencion
        href={rutaFicha(persona.id)}
        transitionTypes={AVANZAR}
        title={nombre}
        className={cn(
          // 44 px de área táctil aunque el nombre ocupe una línea; un nombre largo, dos como mucho.
          'inline-flex min-h-[44px] max-w-full items-center justify-center rounded-sm font-display text-xl leading-tight font-semibold underline-offset-4 hover:underline sm:text-3xl',
          ENLACE_CLASES,
        )}
      >
        <span className="line-clamp-2 break-words">{nombre}</span>
      </EnlaceIntencion>
      {bandera && persona.pais ? <EnlacePais pais={persona.pais} soloBandera={false} className="-my-2" /> : null}
    </div>
  );
}

/** Barra partida: la parte de la persona consultada en carmesí, la del rival apagada. */
function BarraPartida({ yo, rival, className }: { yo: number; rival: number; className?: string }) {
  const total = yo + rival;
  const pct = total > 0 ? (yo / total) * 100 : 50;
  return (
    <span aria-hidden className={cn('flex h-1.5 w-full gap-px', className)}>
      {pct > 0 ? <span className="rounded-full bg-primary" style={{ width: `${pct}%` }} /> : null}
      {pct < 100 ? <span className={cn('flex-1 rounded-full', RELLENO_RIVAL)} /> : null}
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
  // Dos banderas iguales no dicen nada: sólo se pintan si los países difieren.
  const banderas = Boolean(yo.pais || rival.pais) && yo.pais !== rival.pais;

  // Superficie lisa con filete, sin degradado detrás del texto.
  return (
    <header className="flex min-w-0 flex-col gap-5 rounded-xl border bg-card px-3 pt-2 pb-5 sm:px-8 sm:pb-8">
      {/* «Cara a cara», en la cabecera compacta, es un rótulo; el `<h1>` dice quiénes. Los nombres ya se ven abajo. */}
      <h1 className="sr-only">
        {nYo} y {nRival}
      </h1>
      <div className="flex items-center justify-end gap-2">
        <BotonIcono asChild variante="secundario" tamano="lg" etiqueta={`Verlo desde ${nRival}`}>
          <EnlaceIntencion href={urlVistaDelRival(yo.id, rival.id, criterios)} title="Invertir perspectiva">
            <ArrowLeftRight aria-hidden />
          </EnlaceIntencion>
        </BotonIcono>
        <CaraACaraHoja personaId={yo.id} nombre={nYo} icono />
      </div>

      <div className="grid grid-cols-2 items-start gap-x-3 gap-y-5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-x-8">
        <Contendiente persona={yo} nombre={nYo} bandera={banderas} className="col-start-1 row-start-1" />
        <div className="col-span-2 row-start-2 flex flex-col items-center gap-2 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:pt-8">
          {conBalance && r ? (
            <>
              <p
                role="img"
                aria-label={`${plural(r.victorias, 'victoria', 'victorias')} y ${plural(r.derrotas, 'derrota', 'derrotas')} de ${nYo}`}
                className="cifra flex items-center gap-3 text-7xl leading-none sm:gap-5 sm:text-8xl"
              >
                <span className={r.victorias >= r.derrotas ? 'text-foreground' : 'text-muted-foreground'}>{r.victorias}</span>
                <span aria-hidden className={cn('h-1.5 w-5 rounded-full sm:w-7', RELLENO_RIVAL)} />
                <span className={r.derrotas >= r.victorias ? 'text-foreground' : 'text-muted-foreground'}>{r.derrotas}</span>
              </p>
              <p className="flex gap-3 text-xs text-muted-foreground">
                <span>{plural(r.asaltos, 'asalto', 'asaltos')}</span>
                {r.sinDecidir > 0 ? <span>{plural(r.sinDecidir, 'igualado', 'igualados')}</span> : null}
              </p>
            </>
          ) : (
            <p className="font-display text-4xl text-muted-foreground sm:text-5xl">vs</p>
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
        <div className="flex flex-wrap items-center justify-center gap-3">
          <span className="shrink-0 text-xs text-muted-foreground">Últimos</span>
          <p
            role="img"
            aria-label={`Últimos asaltos, del más reciente: ${ultimos.map((a) => (a.resultado === 'victoria' ? 'victoria' : 'derrota')).join(', ')}`}
            className="flex gap-1"
          >
            {ultimos.map((a) => (
              <span
                key={a.id}
                aria-hidden
                className={cn(
                  'inline-flex size-6 items-center justify-center rounded-full text-xs font-bold text-background',
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
      className={cn('flex min-w-0 flex-col gap-2 bg-card px-4 py-3', className)}
    >
      <span aria-hidden className="truncate text-xs text-muted-foreground">{c.rotulo}</span>
      <span aria-hidden className="flex items-baseline justify-between gap-2">
        <span className={cn('cifra text-3xl leading-none', c.yo >= c.rival ? 'text-foreground' : 'text-muted-foreground')}>
          {c.textoYo ?? c.yo}
        </span>
        {c.detalle ? <span className="truncate text-xs text-muted-foreground">{c.detalle}</span> : null}
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
    <section aria-label="Cifras del cara a cara" className="grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:auto-cols-fr sm:grid-flow-col sm:grid-cols-none">
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
      <AsaltosCaraACara datos={datos} encuentros={datos.encuentros ?? []} />
      {rendimiento}
      <EncuentrosCaraACara datos={datos} encuentros={datos.encuentros ?? []} />
    </div>
  );
}

/* ------------------------------------------------------------------- cruces */

/**
 * «Poule», «Tablón de 32», «Cuartos», «Semifinal», «Final»: el rótulo común
 * de las rondas (`rotuloRonda`), nunca la clave publicada. Una clave que no
 * se reconoce queda en «Directa».
 */
export function rotuloMarcador(m: Pick<MarcadorEncuentro, 'fase' | 'ronda'>): string {
  if (m.fase === 'POULE') return 'Poule';
  const etiqueta = m.ronda ? rotuloRonda('TABLEAU', m.ronda) : '';
  return !etiqueta || etiqueta.startsWith('Ronda ') ? 'Directa' : etiqueta;
}

/** «5 oct 2025» para el lector: en una lista de varios años el año siempre hace falta. */
function fechaLectura(iso: string | null): string | null {
  return iso ? fechaCorta(iso.slice(0, 10), { anio: 'siempre' }) || null : null;
}

/** Enlace a la prueba dentro de su edición, abierta en la persona consultada. */
export function urlCruce(e: Pick<EncuentroCaraACara, 'edicionId' | 'pruebaId'>, personaId: string): string {
  const params = new URLSearchParams({ prueba: e.pruebaId, persona: personaId });
  return `${rutaEdicion(e.edicionId)}?${params.toString()}`;
}

/** Puesto de cada uno en la prueba: el `Puesto` del sistema; el de quien terminó por delante, en blanco. */
function PuestoCruce({ puesto, delante }: { puesto: number | null; delante: boolean }) {
  return (
    <span aria-hidden className="inline-flex w-9 justify-center">
      <Puesto puesto={puesto} tamano="md" className={delante ? 'font-semibold text-foreground' : undefined} />
    </span>
  );
}

function Marcador({ mios, rival }: { mios: number; rival: number }) {
  return (
    <span className={cn('cifra text-sm', mios > rival ? 'text-ok' : mios < rival ? 'text-danger' : 'text-foreground')}>
      {mios}–{rival}
    </span>
  );
}

function ChipMarcador({ m }: { m: MarcadorEncuentro }) {
  return (
    <Pastilla tono="neutro">
      <span className="font-normal text-muted-foreground">{rotuloMarcador(m)}</span>
      <Marcador mios={m.mios} rival={m.rival} />
    </Pastilla>
  );
}

/** Columnas fijas: fecha en bloque (48 px), prueba y, a la derecha, puestos o marcador. */
const FILA = 'grid grid-cols-[3rem_minmax(0,1fr)_auto] items-start gap-x-3 px-3 sm:px-4';

function FechaFila({ iso }: { iso: string | null }) {
  // El bloque ya se oye en la frase `sr-only` de la fila.
  return iso ? (
    <span aria-hidden className="contents">
      <BloqueFecha desde={iso.slice(0, 10)} />
    </span>
  ) : (
    <span aria-hidden className="pt-1 text-center text-xs text-muted-foreground">–</span>
  );
}

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
  const datosNombre = { nombre: e.torneo, formato: e.formato, fuente: e.fuente };
  const nombre = nombrePrueba(datosNombre);
  const corto = nombrePruebaCorto(datosNombre);
  const detalle = [e.arma !== armaHabitual ? WEAPON_LABEL[e.arma] : null, categoriaVisible(e.categoria), e.ciudad ? titular(e.ciudad) : null]
    .filter((x): x is string => Boolean(x));
  const puesto = (n: number | null) => (n === null ? 'sin puesto' : `${n}º`);
  const etiqueta = [
    nombre,
    fechaLectura(e.fecha),
    `${nYo} ${puesto(e.puestos.yo)}, ${nRival} ${puesto(e.puestos.rival)}`,
    ...e.marcadores.map((m) => `${rotuloMarcador(m)} ${m.mios}–${m.rival}`),
  ]
    .filter(Boolean)
    .join('. ');
  // Lo visible va oculto al lector y la frase entera en `sr-only`: sin `aria-label` que tape el contenido (WCAG 2.5.3).
  const contenido = (
    <>
      <span className="sr-only">{etiqueta}</span>
      <FechaFila iso={e.fecha} />
      <span aria-hidden className="flex min-w-0 flex-col gap-1">
        <span className="line-clamp-2 text-sm leading-snug font-medium" title={corto === nombre ? undefined : nombre}>{corto}</span>
        {/* Envuelve en vez de recortar: a 320 px la pastilla y la categoría no caben en una línea. */}
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs whitespace-nowrap text-muted-foreground">
          <EtiquetaTipoCompeticion clasificacion={e.clasificacion} tamano="sm" />
          {detalle.map((d, i) => (
            <span key={d} className={cn(i === detalle.length - 1 && 'min-w-0 truncate')}>{d}</span>
          ))}
        </span>
        {e.marcadores.length > 0 ? (
          <span className="mt-1 flex flex-wrap gap-1">
            {e.marcadores.map((m, i) => <ChipMarcador key={i} m={m} />)}
          </span>
        ) : null}
      </span>
      <span aria-hidden className="flex gap-1">
        <PuestoCruce puesto={e.puestos.yo} delante={e.delante === 'yo' || e.delante === 'empate'} />
        <PuestoCruce puesto={e.puestos.rival} delante={e.delante === 'rival' || e.delante === 'empate'} />
      </span>
    </>
  );
  return (
    <li>
      {e.edicionId ? (
        <EnlaceIntencion
          href={urlCruce(e, yo)}
          transitionTypes={AVANZAR}
          className={cn(FILA, 'py-3 transition-colors hover:bg-secondary', ENLACE_CLASES)}
        >
          {contenido}
        </EnlaceIntencion>
      ) : (
        <div className={cn(FILA, 'py-3')}>
          {contenido}
        </div>
      )}
    </li>
  );
}

type Anio<T> = { anio: string; filas: T[] };

/** Agrupa por año, en el orden que llegan (del más reciente): el bloque de fecha no lleva año. */
function porAnio<T>(filas: readonly T[], fecha: (f: T) => string | null): Anio<T>[] {
  const grupos: Anio<T>[] = [];
  for (const f of filas) {
    const anio = fecha(f)?.slice(0, 4) ?? 'Sin fecha';
    const ultimo = grupos.at(-1);
    if (ultimo && ultimo.anio === anio) ultimo.filas.push(f);
    else grupos.push({ anio, filas: [f] });
  }
  return grupos;
}

function CabeceraAnio({ anio }: { anio: string }) {
  return (
    <h3 className="border-y border-filete bg-secondary px-3 py-1 text-xs font-semibold text-muted-foreground sm:px-4">
      {anio}
    </h3>
  );
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
  return porAnio(encuentros, (e) => e.fecha).map((g, i) => (
    <div key={`${g.anio}-${i}`} className="min-w-0">
      <CabeceraAnio anio={g.anio} />
      <ol className="divide-y divide-filete">
        {g.filas.map((e) => <FilaCruce key={e.pruebaId} e={e} {...fila} />)}
      </ol>
    </div>
  ));
}

/** «Ver más (N)» que despliega el resto de una lista sin JavaScript. */
function Desplegar({ resto, children }: { resto: number; children: React.ReactNode }) {
  return (
    <details className="group min-w-0">
      <summary
        className={cn(
          'flex min-h-11 cursor-pointer list-none items-center justify-center gap-1 border-t border-filete text-sm font-medium text-primary-text hover:bg-secondary [&::-webkit-details-marker]:hidden',
          ENLACE_CLASES,
        )}
      >
        <span className="group-open:hidden">{textoVerMas(resto)}</span>
        <span className="hidden group-open:inline">Ver menos</span>
        <ChevronDown className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      {children}
    </details>
  );
}

/* ------------------------------------------------------------------- asaltos */

export type AsaltoDirecto = { clave: string; encuentro: EncuentroCaraACara; marcador: MarcadorEncuentro };

/**
 * Cada asalto entre las dos, del más reciente: las pruebas ya vienen de la más
 * reciente y, dentro de una, la final se tiró después que la poule. Sale de los
 * marcadores de las pruebas comunes (ya sin lecturas repetidas), no de la
 * página de `items`, para que estén todos.
 */
export function asaltosDirectos(encuentros: readonly EncuentroCaraACara[]): AsaltoDirecto[] {
  return encuentros.flatMap((e) =>
    [...e.marcadores].reverse().map((m, i) => ({ clave: `${e.pruebaId}-${i}`, encuentro: e, marcador: m })),
  );
}

const FILA_ASALTO = 'grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-3 sm:px-4';

function FilaAsaltoDirecto({ a, yo, nYo, nRival }: { a: AsaltoDirecto; yo: string; nYo: string; nRival: string }) {
  const { encuentro: e, marcador: m } = a;
  const datosNombre = { nombre: e.torneo, formato: e.formato, fuente: e.fuente };
  const nombre = nombrePrueba(datosNombre);
  const corto = nombrePruebaCorto(datosNombre);
  const ronda = rotuloMarcador(m);
  const gana = m.mios > m.rival ? 'yo' : m.mios < m.rival ? 'rival' : null;
  const etiqueta = [
    fechaLectura(e.fecha),
    nombre,
    ronda,
    `${nYo} ${m.mios}, ${nRival} ${m.rival}`,
    gana === 'yo' ? `gana ${nYo}` : gana === 'rival' ? `gana ${nRival}` : null,
  ]
    .filter(Boolean)
    .join('. ');
  const contenido = (
    <>
      <span className="sr-only">{etiqueta}</span>
      <FechaFila iso={e.fecha} />
      <span aria-hidden className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-sm leading-tight font-medium" title={corto === nombre ? undefined : nombre}>{corto}</span>
        <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <Pastilla tono="neutro">{ronda}</Pastilla>
          {e.categoria ? <span className="truncate">{categoriaVisible(e.categoria)}</span> : null}
        </span>
      </span>
      <span aria-hidden className="flex items-center gap-2">
        <span className="cifra flex items-baseline gap-1 text-xl leading-none">
          <span className={gana === 'yo' ? 'text-ok' : 'text-muted-foreground'}>{m.mios}</span>
          <span className="text-sm text-muted-foreground">–</span>
          <span className={gana === 'rival' ? 'text-danger' : 'text-muted-foreground'}>{m.rival}</span>
        </span>
        {gana ? (
          <span
            className={cn(
              'inline-flex size-6 items-center justify-center rounded-full text-xs font-bold text-background',
              gana === 'yo' ? 'bg-ok' : 'bg-danger',
            )}
          >
            {gana === 'yo' ? 'V' : 'D'}
          </span>
        ) : null}
      </span>
    </>
  );
  return (
    <li>
      {e.edicionId ? (
        <EnlaceIntencion
          href={urlCruce(e, yo)}
          transitionTypes={AVANZAR}
          className={cn(FILA_ASALTO, 'transition-colors hover:bg-secondary', ENLACE_CLASES)}
        >
          {contenido}
        </EnlaceIntencion>
      ) : (
        <div className={FILA_ASALTO}>
          {contenido}
        </div>
      )}
    </li>
  );
}

const ASALTOS_VISIBLES = 8;

/**
 * Los asaltos directos entre las dos, antes que las pruebas comunes: fecha,
 * prueba, ronda y marcador con el ganador marcado (V/D desde la persona
 * consultada), agrupados por año. Cada fila abre la prueba en esa persona.
 */
export function AsaltosCaraACara({ datos, encuentros }: { datos: DatosCaraACara; encuentros: readonly EncuentroCaraACara[] }) {
  const asaltos = asaltosDirectos(encuentros);
  if (asaltos.length === 0) return null;
  const { yo, rival } = datos.personas;
  const fila = { yo: yo.id, nYo: visible(yo.nombre), nRival: visible(rival.nombre) };
  const lista = (xs: AsaltoDirecto[]) =>
    porAnio(xs, (a) => a.encuentro.fecha).map((g, i) => (
      <div key={`${g.anio}-${i}`} className="min-w-0">
        <CabeceraAnio anio={g.anio} />
        <ol className="divide-y divide-filete">
          {g.filas.map((a) => <FilaAsaltoDirecto key={a.clave} a={a} {...fila} />)}
        </ol>
      </div>
    ));
  return (
    <section aria-labelledby="h2h-asaltos" className="flex min-w-0 flex-col gap-3">
      <CabeceraSeccion id="h2h-asaltos" titulo={<>Asaltos <span className="cifra text-muted-foreground">{asaltos.length}</span></>} />
      <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
        {lista(asaltos.slice(0, ASALTOS_VISIBLES))}
        {asaltos.length > ASALTOS_VISIBLES ? (
          <Desplegar resto={asaltos.length - ASALTOS_VISIBLES}>{lista(asaltos.slice(ASALTOS_VISIBLES))}</Desplegar>
        ) : null}
      </div>
    </section>
  );
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
      <CabeceraSeccion
        id="h2h-cruces"
        titulo={<>Cruces {encuentros.length > 0 ? <span className="cifra text-muted-foreground">{encuentros.length}</span> : null}</>}
        contexto={
          encuentros.length > 0
            ? `${conAsaltos} con asaltos${datos.resumenEncuentros?.truncado ? ' · las más recientes' : ''}`
            : undefined
        }
      />
      {encuentros.length === 0 ? (
        <EstadoVacio titulo="Sin pruebas comunes" descripcion="Prueba a quitar algún filtro." className="rounded-xl border bg-card" />
      ) : (
        <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
          <div aria-hidden className={cn(FILA, 'items-center py-2 text-xs font-semibold text-muted-foreground')}>
            <span />
            <span />
            <span className="flex gap-1">
              <span className="w-9 truncate text-center" title={fila.nYo}>{inicialesVisibles(yo.nombre)}</span>
              <span className="w-9 truncate text-center" title={fila.nRival}>{inicialesVisibles(rival.nombre)}</span>
            </span>
          </div>
          <ListaCruces encuentros={encuentros.slice(0, CRUCES_VISIBLES)} {...fila} />
          {encuentros.length > CRUCES_VISIBLES ? (
            <Desplegar resto={encuentros.length - CRUCES_VISIBLES}>
              <ListaCruces encuentros={encuentros.slice(CRUCES_VISIBLES)} {...fila} />
            </Desplegar>
          ) : null}
        </div>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------- elegir rival */

function OtrosCoincidentes({
  otros,
  persona,
  excluidos,
}: {
  otros: OtrosVista;
  persona: PersonaCaraACara;
  excluidos: ReadonlySet<string>;
}) {
  if (otros.tipo === 'error') {
    return (
      <EstadoVacio
        tipo="error"
        titulo="No se ha podido buscar"
        descripcion="Falló la búsqueda de otras personas indexadas; no es que no haya coincidencias."
      />
    );
  }
  const items = otros.items.filter((d: DeportistaResumen) => d.id !== persona.id && !excluidos.has(d.id));
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="h2h-otros" className="flex flex-col gap-2">
      <CabeceraSeccion id="h2h-otros" titulo="Otras personas" />
      {/* La lista confirmada filtra por nombre canónico y esta búsqueda también casa alias: que una persona
          no figure arriba no prueba que no tenga asaltos con la consultada, ni siquiera con la lista leída. */}
      <ul aria-labelledby="h2h-otros" className="divide-y rounded-xl border bg-card">
        {items.map((d) => (
          <li key={d.id} className="px-4">
            <FilaPersona
              persona={{ id: d.id, nombre: visible(d.nombre), pais: d.pais }}
              href={urlElegirRival(persona.id, d.id)}
              meta={
                d.mismoNombre > 1 ? (
                  <span className="inline-flex items-center gap-1 text-warn">
                    <Users className="size-4 shrink-0" aria-hidden />
                    {d.mismoNombre} personas con este nombre{d.anioNacimiento !== null ? ` · ${d.anioNacimiento}` : ''}
                  </span>
                ) : d.alias ? (
                  `Alias «${d.alias}»`
                ) : d.armas.length > 0 ? (
                  d.armas.map((a) => WEAPON_LABEL[a]).join(', ')
                ) : undefined
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

const MENSAJES_RIVALES: Record<'cursor_invalido' | 'entrada_invalida' | 'no_disponible' | 'error', { titulo: string; descripcion: string }> = {
  cursor_invalido: { titulo: 'Página caducada', descripcion: 'Vuelve a la primera.' },
  entrada_invalida: { titulo: 'Enlace no válido', descripcion: 'Revisa la dirección.' },
  no_disponible: { titulo: 'Aún no está activo', descripcion: 'Los datos deportivos aún no están listos.' },
  error: { titulo: 'No se han podido cargar', descripcion: 'Ha fallado la consulta; no es que no haya rivales.' },
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
  // La elección de rival sólo busca por nombre: los filtros del duelo no viajan con la página.
  const base = { q: criterios.q };
  const idsRivales = new Set(rivales.tipo === 'ok' ? rivales.items.map((r) => r.id) : []);
  return (
    <div className="flex flex-col gap-6">
      <Bloque id="h2h-rivales" titulo="Rivales" nivel="pagina">
        {rivales.tipo === 'ok' ? (
          rivales.sinResultados ? (
            <EstadoVacio titulo={criterios.q ? 'Sin coincidencias' : 'Sin rivales con asaltos'} />
          ) : (
            <>
              <ul className="divide-y rounded-xl border bg-card" aria-label="Rivales, de más a menos asaltos">
                {rivales.items.map((r) => (
                  <li key={r.id} className="px-4">
                    <FilaPersona
                      persona={{ id: r.id, nombre: visible(r.nombre), pais: r.pais }}
                      href={urlElegirRival(persona.id, r.id)}
                      insignias={<BarraVictorias victorias={r.victorias} derrotas={r.derrotas} className="w-24 sm:w-48" />}
                    />
                  </li>
                ))}
              </ul>
              <nav aria-label="Páginas de rivales" className="flex flex-wrap items-center gap-3">
                {criterios.cursor ? (
                  <Boton asChild variante="contorno" tamano="lg">
                    <EnlaceIntencion href={construirUrlCaraACara(persona.id, base)}>
                      Primera página
                    </EnlaceIntencion>
                  </Boton>
                ) : null}
                {rivales.siguiente ? (
                  <Boton asChild variante="contorno" tamano="lg">
                    <EnlaceIntencion
                      href={construirUrlCaraACara(persona.id, { ...base, cursor: rivales.siguiente })}
                      rel="next"
                    >
                      Ver más
                    </EnlaceIntencion>
                  </Boton>
                ) : null}
              </nav>
            </>
          )
        ) : (
          <EstadoVacio
            tipo="error"
            titulo={MENSAJES_RIVALES[rivales.tipo].titulo}
            descripcion={MENSAJES_RIVALES[rivales.tipo].descripcion}
            accion={
              rivales.tipo === 'cursor_invalido' ? (
                <Boton asChild variante="contorno" tamano="lg">
                  <EnlaceIntencion href={construirUrlCaraACara(persona.id, base)}>
                    Primera página
                  </EnlaceIntencion>
                </Boton>
              ) : undefined
            }
          />
        )}
      </Bloque>

      {otros ? (
        <OtrosCoincidentes
          otros={otros}
          persona={persona}
          excluidos={idsRivales}
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
          <EnlaceIntencion
            href={chip.quitar}
            aria-label={`Quitar filtro ${chip.etiqueta}: ${chip.valor}`}
            className={cn(
              'inline-flex min-h-11 max-w-full flex-wrap items-center gap-2 rounded-full border bg-secondary px-3 text-sm hover:bg-accent',
              ENLACE_CLASES,
            )}
          >
            <span className="text-muted-foreground">{chip.etiqueta}</span>
            <span className="max-w-48 min-w-0 py-1 font-medium break-words">{chip.valor}</span>
            <X className="size-3.5" aria-hidden />
          </EnlaceIntencion>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------- estados */

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
    <Boton asChild variante="contorno" tamano="lg">
      <EnlaceIntencion href="/explorar">
        Buscar en Explorar
      </EnlaceIntencion>
    </Boton>
  );
  const empezar = personaId ? (
    <Boton asChild variante="contorno" tamano="lg">
      <EnlaceIntencion href={rutaCaraACara(personaId)}>
        Empezar de nuevo
      </EnlaceIntencion>
    </Boton>
  ) : (
    buscar
  );
  switch (vista.tipo) {
    case 'entrada_invalida':
      return <EstadoVacio tipo="error" titulo="Enlace no válido" descripcion="Revisa la dirección o empieza de nuevo." accion={empezar} />;
    case 'cursor_invalido':
      return (
        <EstadoVacio
          tipo="error"
          titulo="Página caducada"
          descripcion="Vuelve a los asaltos más recientes."
          accion={
            personaId ? (
              <Boton asChild variante="contorno" tamano="lg">
                <EnlaceIntencion href={construirUrlCaraACara(personaId, { ...criterios, cursor: '' })}>
                  Volver a los más recientes
                </EnlaceIntencion>
              </Boton>
            ) : undefined
          }
        />
      );
    case 'no_encontrada':
      return <EstadoVacio icono={SearchX} titulo="Persona no encontrada" descripcion="Puede que el enlace sea antiguo." accion={buscar} />;
    case 'misma_persona':
      return <EstadoVacio icono={SearchX} titulo="Es la misma persona" descripcion="Elige otro rival." accion={empezar} />;
    case 'no_disponible':
      return <EstadoVacio tipo="error" titulo="Aún no está activo" descripcion="Los datos deportivos aún no están listos." />;
    default:
      return <EstadoVacio tipo="error" titulo="No se ha podido abrir" descripcion="Ha fallado la consulta; no es que no haya asaltos." accion={empezar} />;
  }
}
