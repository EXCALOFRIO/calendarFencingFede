'use client';

import { CircleCheck } from 'lucide-react';
import * as React from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { EventView, Weapon } from '@/lib/queries/calendar';
import {
  CATEGORY_LABEL,
  CIRCUIT_LABEL,
  cn,
  formatDateRangeEs,
  organismoDe,
  titular,
  titularTorneo,
  type Organismo,
} from '@/lib/utils';
import { IconoArma } from './iconos-arma';
import { NOMBRE_ARMA } from './marca-arma';

/**
 * Rejilla de un mes con barras continuas.
 *
 * El problema que resuelve: un mes de esgrima tiene tres o cuatro fines de
 * semana con competición y veintitantos días vacíos. Pintando una pastilla
 * por día, un torneo de cuatro días salía cuatro veces repetido y el resto
 * de la rejilla era hueco. Así no hay forma de que se lea bien.
 *
 * Aquí un torneo es UNA barra que cruza los días que dura, con su nombre y
 * su ciudad, como en cualquier calendario. Y las semanas sin nada se quedan
 * en una tira fina: siguen estando —hay que poder ver que el puente está
 * libre— pero no se comen la pantalla.
 *
 * Las barras se colocan por carriles: se ordenan por fecha de inicio y
 * duración, y cada una entra en el primer carril libre de esa semana.
 *
 * El alto de las barras **se calcula a partir del alto disponible**, no es
 * una constante. Antes lo era, y pasaban las dos cosas malas a la vez: en el
 * trimestre, con tres torneos el mismo fin de semana, las barras se salían
 * de su semana y pisaban la de abajo; y en un mes tranquilo sobraba media
 * pantalla. Ahora se mide la caja y se reparte.
 */

const DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

const COLOR: Record<Organismo, { barra: string; punto: string }> = {
  RFEE: { barra: 'bg-org-rfee/22 text-org-rfee', punto: 'bg-org-rfee' },
  FIE: { barra: 'bg-org-fie/20 text-org-fie', punto: 'bg-org-fie' },
  EFC: { barra: 'bg-org-efc/22 text-org-efc', punto: 'bg-org-efc' },
  AUT: { barra: 'bg-muted text-muted-foreground', punto: 'bg-org-aut' },
};

/** Separación vertical entre carriles, en píxeles. */
const HUECO_BARRA = 3;
/** Sitio reservado arriba de cada semana para el número del día. */
const CABECERA = 22;

/** Límites del alto de barra. Por debajo del mínimo no cabe el texto. */
const LIMITES = {
  normal: { min: 18, max: 40 },
  compacta: { min: 13, max: 24 },
};

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function sumarDias(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

type Barra = {
  evento: EventView;
  /** Columna 0-6 donde empieza dentro de esta semana. */
  desde: number;
  /** Cuántas columnas ocupa. */
  ancho: number;
  carril: number;
  /** Si el torneo viene de la semana anterior o sigue en la siguiente. */
  continuaAntes: boolean;
  continuaDespues: boolean;
};

type Semana = {
  dias: { iso: string; dia: number; delMes: boolean; esHoy: boolean }[];
  barras: Barra[];
  carriles: number;
};

/**
 * Reparte los eventos de una semana en carriles.
 *
 * Se ordenan por inicio y, a igualdad, por duración descendente: los torneos
 * largos se llevan el carril de arriba y los cortos rellenan los huecos, que
 * es como se lee mejor.
 */
function repartirEnCarriles(
  eventos: EventView[],
  inicioSemana: Date,
  finSemana: Date,
): { barras: Barra[]; carriles: number } {
  const isoInicio = isoLocal(inicioSemana);
  const isoFin = isoLocal(finSemana);

  const enLaSemana = eventos
    .filter((e) => e.startDate <= isoFin && e.endDate >= isoInicio)
    .sort((a, b) => {
      if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
      const durA = a.endDate.localeCompare(a.startDate);
      const durB = b.endDate.localeCompare(b.startDate);
      return durB - durA;
    });

  const ocupacion: boolean[][] = [];
  const barras: Barra[] = [];

  for (const evento of enLaSemana) {
    const desde = Math.max(
      0,
      Math.round(
        (new Date(`${evento.startDate}T12:00:00`).getTime() -
          new Date(`${isoInicio}T12:00:00`).getTime()) /
          86_400_000,
      ),
    );
    const hasta = Math.min(
      6,
      Math.round(
        (new Date(`${evento.endDate}T12:00:00`).getTime() -
          new Date(`${isoInicio}T12:00:00`).getTime()) /
          86_400_000,
      ),
    );
    const ancho = Math.max(1, hasta - desde + 1);

    let carril = 0;
    for (;;) {
      ocupacion[carril] ??= Array.from({ length: 7 }, () => false);
      const libre = ocupacion[carril]
        .slice(desde, desde + ancho)
        .every((ocupado) => !ocupado);
      if (libre) break;
      carril += 1;
    }
    for (let i = desde; i < desde + ancho; i += 1) ocupacion[carril][i] = true;

    barras.push({
      evento,
      desde,
      ancho,
      carril,
      continuaAntes: evento.startDate < isoInicio,
      continuaDespues: evento.endDate > isoFin,
    });
  }

  return { barras, carriles: ocupacion.length };
}

function construirSemanas(ancla: Date, eventos: EventView[]): Semana[] {
  const hoy = isoLocal(new Date());
  const primero = new Date(ancla.getFullYear(), ancla.getMonth(), 1);
  // getDay() da 0 para domingo; aquí la semana empieza en lunes.
  const inicio = sumarDias(primero, -((primero.getDay() + 6) % 7));

  const semanas: Semana[] = [];
  for (let s = 0; s < 6; s += 1) {
    const inicioSemana = sumarDias(inicio, s * 7);
    const finSemana = sumarDias(inicioSemana, 6);

    const dias = Array.from({ length: 7 }, (_, i) => {
      const d = sumarDias(inicioSemana, i);
      const iso = isoLocal(d);
      return {
        iso,
        dia: d.getDate(),
        delMes: d.getMonth() === ancla.getMonth(),
        esHoy: iso === hoy,
      };
    });

    // Una sexta semana entera fuera del mes no aporta nada y obliga a hacer
    // scroll en el móvil.
    if (s === 5 && dias.every((d) => !d.delMes)) break;

    const { barras, carriles } = repartirEnCarriles(eventos, inicioSemana, finSemana);
    semanas.push({ dias, barras, carriles });
  }

  return semanas;
}

/**
 * Mide una caja y devuelve su alto en píxeles.
 *
 * Hace falta para repartir el espacio: sin medir no hay forma de saber si
 * caben barras de 28 px o si hay que apretarlas a 18. Devuelve 0 hasta el
 * primer dibujado, y con 0 se usa el mínimo, que es el comportamiento de
 * antes; así no hay salto feo en la primera pintada.
 */
function useAltoDisponible<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  const [alto, setAlto] = React.useState(0);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entrada]) => {
      setAlto(entrada.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, alto] as const;
}

/**
 * Decide cuánto mide cada barra y cuántos carriles caben por semana.
 *
 * Se resuelve la ecuación al revés: dado el alto de la caja, cuánto puede
 * medir cada barra para que la suma de todas las semanas no se pase.
 *
 * Y si ni siquiera con la barra en su mínimo cabe todo —un trimestre con las
 * tres armas y los dos géneros puede tener doce torneos el mismo fin de
 * semana—, entonces **se recortan carriles**, empezando por las semanas más
 * cargadas, y lo que no cabe se resume en un «+N» por día que se despliega
 * al tocarlo. Es lo que hacen Google Calendar y el calendario del iPhone, y
 * es mucho mejor que la alternativa: que la rejilla crezca hacia abajo y el
 * mes deje de verse de un vistazo, que es justo lo que la hace útil.
 */
function planificar(
  semanas: Semana[],
  disponible: number,
  compacta: boolean,
): { alto: number; tope: number[] } {
  const { min, max } = compacta ? LIMITES.compacta : LIMITES.normal;
  const sinTope = semanas.map((s) => s.carriles);
  const totalCarriles = sinTope.reduce((n, c) => n + c, 0);
  if (disponible <= 0 || totalCarriles === 0) {
    return { alto: min, tope: sinTope };
  }

  const altoVacia = compacta ? 22 : 30;
  const fijoDe = (carriles: number) =>
    carriles === 0 ? altoVacia : CABECERA + carriles * HUECO_BARRA + 4;
  const fijo = sinTope.reduce((n, c) => n + fijoDe(c), 0);

  const alto = Math.max(min, Math.min(max, (disponible - fijo) / totalCarriles));

  // Con la barra por encima del mínimo, todo cabe: no hay nada que recortar.
  if (alto > min) return { alto, tope: sinTope };

  const tope = [...sinTope];
  const ocupado = () =>
    tope.reduce((n, c) => n + fijoDe(c) + c * min, 0);

  // Se quita un carril cada vez a la semana que más tiene: así el recorte se
  // reparte y ninguna semana se queda en un único torneo mientras otra
  // enseña ocho.
  let guarda = 0;
  while (ocupado() > disponible && guarda < 500) {
    guarda += 1;
    let peor = -1;
    for (let i = 0; i < tope.length; i += 1) {
      // Nunca por debajo de dos: uno para una barra y otro para el «+N».
      if (tope[i] > 2 && (peor === -1 || tope[i] > tope[peor])) peor = i;
    }
    if (peor === -1) break;
    tope[peor] -= 1;
  }

  return { alto: min, tope };
}

export function RejillaMes({
  ancla,
  eventos,
  compacta = false,
  inscripciones,
  onAbrirEvento,
}: {
  ancla: Date;
  eventos: EventView[];
  /** En trimestre las barras son más bajas, pero siguen llevando texto. */
  compacta?: boolean;
  /** competitionId -> estado, para marcar en qué estás inscrito. */
  inscripciones: Record<string, string>;
  onAbrirEvento: (e: EventView) => void;
}) {
  const semanas = React.useMemo(
    () => construirSemanas(ancla, eventos),
    [ancla, eventos],
  );

  const [caja, disponible] = useAltoDisponible<HTMLDivElement>();
  const { alto: altoBarra, tope } = planificar(semanas, disponible, compacta);

  return (
    <TooltipProvider delayDuration={180} skipDelayDuration={400}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="grid grid-cols-7 pb-1.5">
          {DIAS.map((d, i) => (
            <div
              key={d}
              className={cn(
                'pb-1 text-center text-xs font-medium',
                i >= 5 ? 'text-muted-foreground/60' : 'text-muted-foreground',
              )}
            >
              {d}
            </div>
          ))}
        </div>

        {/*
          Dos capas a propósito.

          La de fuera es la que MIDE: como las semanas van dentro de una capa
          absoluta, no pueden estirarla, y por eso su alto es el hueco de
          verdad que hay en pantalla. En la versión anterior se medía la caja
          que contenía las semanas, y las semanas la estiraban: cada vez que
          se pedía más sitio, la medida crecía, así que nunca se llegaba a la
          conclusión de que no cabía y el mes se salía por abajo.
        */}
        <div
          ref={caja}
          className="relative min-h-0 flex-1 overflow-hidden rounded-lg border"
        >
          <div className="absolute inset-0 flex flex-col">
          {semanas.map((semana, i) => (
            <FilaSemana
              key={semana.dias[0].iso}
              semana={semana}
              compacta={compacta}
              altoBarra={altoBarra}
              tope={tope[i]}
              ultima={i === semanas.length - 1}
              inscripciones={inscripciones}
              onAbrirEvento={onAbrirEvento}
            />
          ))}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

function FilaSemana({
  semana,
  compacta,
  altoBarra,
  tope,
  ultima,
  inscripciones,
  onAbrirEvento,
}: {
  semana: Semana;
  compacta: boolean;
  altoBarra: number;
  /** Carriles que caben. Lo que pase de aquí se resume en un «+N». */
  tope: number;
  ultima: boolean;
  inscripciones: Record<string, string>;
  onAbrirEvento: (e: EventView) => void;
}) {
  const vacia = semana.barras.length === 0;
  const recorta = semana.carriles > tope;
  // Si hay recorte, el último carril se reserva para el «+N».
  const carrilesPintados = recorta ? Math.max(1, tope - 1) : semana.carriles;

  const visibles = semana.barras.filter((b) => b.carril < carrilesPintados);
  const ocultas = semana.barras.filter((b) => b.carril >= carrilesPintados);

  /**
   * Alto de la fila.
   *
   * El **suelo** es exactamente lo que ocupan sus barras con el alto que se
   * acaba de calcular, así que una barra nunca se sale de su semana. Una
   * semana sin competición se queda en una tira fina: sigue viéndose —hay
   * que poder ver que el puente está libre— pero no se come la pantalla.
   *
   * El **sobrante** se reparte con `flex-grow` en proporción a lo que pasa
   * esa semana, para que el calendario llene el alto de la pantalla en vez
   * de dejar un hueco debajo.
   *
   * El reparto entre semanas llenas y vacías está **calibrado**, no puesto a
   * ojo. Con la primera proporción (0,3 contra 1,6) pasaba lo contrario del
   * problema que resolvía: en un mes tranquilo, la semana con dos torneos se
   * llevaba 230 px para pintar 90 y quedaba un boquete debajo de las barras
   * que parecía un fallo de dibujado. Ahora una semana vacía sigue siendo
   * claramente más baja —se ve de un vistazo que ese fin de semana está
   * libre— pero no se aplasta, y el sobrante se reparte con la carga.
   */
  const filas = carrilesPintados + (recorta ? 1 : 0);
  const altoMinimo = vacia
    ? compacta
      ? 22
      : 30
    : CABECERA + filas * (altoBarra + HUECO_BARRA) + 4;

  const peso = vacia ? 0.8 : 1.5 + (filas - 1) * 0.55;

  return (
    <div
      className={cn('relative grid grid-cols-7', !ultima && 'border-b')}
      style={{ minHeight: altoMinimo, flex: `${peso} 1 0%` }}
    >
      {semana.dias.map((d) => (
        <div
          key={d.iso}
          className={cn(
            'relative border-r last:border-r-0',
            // Una semana sin competicion se hunde: fondo mas oscuro y
            // numeros apagados. Antes tenia el mismo fondo que una semana
            // llena y solo era mas baja, asi que parecia una fila cortada
            // por un fallo de dibujado en vez de «aqui no hay nada».
            vacia && 'bg-black/25',
            !d.delMes && 'bg-background/40',
          )}
        >
          <span
            className={cn(
              'cifra absolute left-1.5 top-0.5 text-sm',
              d.esHoy
                ? 'flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground'
                : !d.delMes
                  ? 'text-muted-foreground/40'
                  : vacia
                    ? 'text-muted-foreground/70'
                    : 'text-foreground',
            )}
          >
            {d.dia}
          </span>
        </div>
      ))}

      {/* Las barras van por encima de la rejilla de días, no dentro. */}
      {visibles.map((barra) => (
        <BarraTorneo
          key={`${barra.evento.id}-${barra.desde}`}
          barra={barra}
          compacta={compacta}
          alto={altoBarra}
          inscripciones={inscripciones}
          onAbrir={onAbrirEvento}
        />
      ))}

      {recorta
        ? semana.dias.map((d, col) => {
            const delDia = ocultas.filter(
              (b) => b.desde <= col && col < b.desde + b.ancho,
            );
            if (delDia.length === 0) return null;
            return (
              <MasDelDia
                key={`mas-${d.iso}`}
                columna={col}
                barras={delDia}
                alto={altoBarra}
                carril={carrilesPintados}
                inscripciones={inscripciones}
                onAbrir={onAbrirEvento}
              />
            );
          })
        : null}
    </div>
  );
}

/**
 * «+N» de un día.
 *
 * Los torneos que no caben en la semana no desaparecen: se cuentan por día
 * y se despliegan al tocar. Se pintan por columna, no por barra, porque lo
 * que le interesa a quien mira es «ese sábado hay cuatro cosas más», no qué
 * carril ocupaban.
 */
function MasDelDia({
  columna,
  barras,
  alto,
  carril,
  inscripciones,
  onAbrir,
}: {
  columna: number;
  barras: Barra[];
  alto: number;
  carril: number;
  inscripciones: Record<string, string>;
  onAbrir: (e: EventView) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Ver ${barras.length} torneos más de este día`}
          className="objetivo-libre absolute flex cursor-pointer items-center justify-center rounded-sm text-[0.68rem] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{
            left: `calc(${(columna / 7) * 100}% + 3px)`,
            width: `calc(${(1 / 7) * 100}% - 6px)`,
            top: CABECERA + carril * (alto + HUECO_BARRA),
            height: alto,
          }}
        >
          +{barras.length}
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-64 p-1.5">
        <ul className="flex flex-col gap-0.5">
          {barras.map((b) => {
            const o = organismoDe(b.evento.source, b.evento.scope, b.evento.circuit);
            const armas = [...new Set(b.evento.competitions.map((c) => c.weapon))];
            const inscrito = b.evento.competitions.some((c) => inscripciones[c.id]);
            return (
              <li key={b.evento.id}>
                <button
                  type="button"
                  onClick={() => onAbrir(b.evento)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent',
                    COLOR[o].barra.split(' ')[1],
                  )}
                >
                  {armas.slice(0, 2).map((a) => (
                    <IconoArma key={a} arma={a} className="size-4 shrink-0" />
                  ))}
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {titularTorneo(b.evento.name)}
                  </span>
                  {b.evento.city ? (
                    <span className="shrink-0 truncate text-muted-foreground">
                      {titular(b.evento.city)}
                    </span>
                  ) : null}
                  {inscrito ? <CircleCheck className="size-3 shrink-0" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function BarraTorneo({
  barra,
  compacta,
  alto,
  inscripciones,
  onAbrir,
}: {
  barra: Barra;
  compacta: boolean;
  alto: number;
  inscripciones: Record<string, string>;
  onAbrir: (e: EventView) => void;
}) {
  const evento = barra.evento;
  const color = COLOR[organismoDe(evento.source, evento.scope, evento.circuit)];

  const armas = [...new Set(evento.competitions.map((c) => c.weapon))];
  const inscrito = evento.competitions.some((c) => inscripciones[c.id]);

  // Con la barra muy baja el texto no cabe en su caja: se reduce la fuente.
  const apretada = alto < 17;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onAbrir(evento)}
          className={cn(
            'objetivo-libre absolute flex cursor-pointer items-center overflow-hidden text-left font-medium',
            'transition-[filter] duration-150 hover:brightness-125',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            compacta ? 'gap-[3px] px-1' : 'gap-1.5 px-1.5',
            apretada ? 'text-[0.6rem]' : compacta ? 'text-[0.68rem]' : 'text-xs',
            color.barra,
            // Si viene de antes o sigue después, ese lado se queda recto:
            // se ve que el torneo continúa.
            barra.continuaAntes ? 'rounded-l-none' : 'rounded-l-sm',
            barra.continuaDespues ? 'rounded-r-none' : 'rounded-r-sm',
            // Inscrito: filete del color del texto. No es solo color: va
            // también el icono de la derecha y el texto del globo.
            inscrito && 'ring-1 ring-inset ring-current',
          )}
          style={{
            left: `calc(${(barra.desde / 7) * 100}% + ${barra.continuaAntes ? 0 : 3}px)`,
            width: `calc(${(barra.ancho / 7) * 100}% - ${
              (barra.continuaAntes ? 0 : 3) + (barra.continuaDespues ? 0 : 3)
            }px)`,
            top: CABECERA + barra.carril * (alto + HUECO_BARRA),
            height: alto,
          }}
        >
          {/* Iconos de arma: es lo que distingue una prueba de otra sin
              leer. Como mucho dos; con tres el nombre ya no cabe. */}
          <span className="flex shrink-0 items-center gap-0.5">
            {armas.slice(0, 2).map((a) => (
              <IconoArma
                key={a}
                arma={a}
                title={NOMBRE_ARMA[a]}
                className={apretada ? 'size-3' : 'size-4'}
              />
            ))}
          </span>

          <span className="truncate">{titularTorneo(evento.name)}</span>

          {/*
            La ciudad también en trimestre. Sin ella, en un fin de semana con
            cuatro Copas del Mundo se veían cuatro barras que ponían lo mismo
            y no había forma de distinguirlas: la ciudad es el dato que las
            separa. Si no cabe, se corta, y el globo la da entera.
          */}
          {barra.ancho >= 3 && evento.city ? (
            <span className="truncate opacity-70">{titular(evento.city)}</span>
          ) : null}

          {inscrito ? (
            <CircleCheck
              className={cn('ml-auto shrink-0', apretada ? 'size-2.5' : 'size-3.5')}
              aria-label="Ya estás inscrito"
            />
          ) : null}
        </button>
      </TooltipTrigger>

      <ContenidoGlobo evento={evento} inscrito={inscrito} />
    </Tooltip>
  );
}

/**
 * Globo de información.
 *
 * En la barra caben el nombre y poco más, así que al pasar por encima se
 * enseña lo que de verdad hace falta para decidir si abrir la ficha: dónde
 * es, qué pruebas hay y cuánto queda de plazo. Antes esto era un `title` del
 * navegador: tardaba un segundo largo en salir, se veía con el estilo del
 * sistema operativo y no cabía más de una línea.
 */
function ContenidoGlobo({
  evento,
  inscrito,
}: {
  evento: EventView;
  inscrito: boolean;
}) {
  // El plazo que antes cierra de todas las pruebas: es el que aprieta.
  const dias = evento.competitions
    .map((c) => c.status.daysLeft)
    .filter((d): d is number => d !== null && d >= 0)
    .sort((a, b) => a - b)[0];

  const porArma = new Map<Weapon, Set<string>>();
  for (const c of evento.competitions) {
    const clave = `${c.gender === 'M' ? 'M' : c.gender === 'F' ? 'F' : 'Mixto'} ${
      CATEGORY_LABEL[c.category as keyof typeof CATEGORY_LABEL] ?? c.category
    }`;
    const set = porArma.get(c.weapon) ?? new Set<string>();
    set.add(clave);
    porArma.set(c.weapon, set);
  }

  return (
    <TooltipContent side="top" className="max-w-72 flex-col items-start gap-1.5 p-2.5">
      <p className="text-sm font-semibold leading-tight">{titularTorneo(evento.name)}</p>

      <p className="text-xs opacity-80">
        {evento.city ? titular(evento.city) : 'Sede sin publicar'}
        {evento.country ? `, ${evento.country}` : ''} ·{' '}
        {formatDateRangeEs(evento.startDate, evento.endDate)}
      </p>

      <ul className="flex flex-col gap-0.5 text-xs">
        {[...porArma.entries()].map(([arma, claves]) => (
          <li key={arma} className="flex items-center gap-2">
            <IconoArma arma={arma} className="size-4 shrink-0" />
            <span className="font-medium">{NOMBRE_ARMA[arma]}</span>
            <span className="opacity-70">{[...claves].sort().join(', ')}</span>
          </li>
        ))}
      </ul>

      <p className="text-xs opacity-80">
        {CIRCUIT_LABEL[evento.circuit] ?? evento.circuit}
        {dias !== undefined
          ? ` · cierra en ${dias} ${dias === 1 ? 'día' : 'días'}`
          : ''}
      </p>

      {inscrito ? (
        <p className="flex items-center gap-1 text-xs font-medium">
          <CircleCheck className="size-3" aria-hidden /> Ya estás inscrito
        </p>
      ) : null}
    </TooltipContent>
  );
}
