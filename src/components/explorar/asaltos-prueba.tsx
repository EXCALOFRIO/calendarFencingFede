'use client';

import { ChevronLeft, ChevronRight, Repeat2 } from 'lucide-react';
import Link from 'next/link';
import { memo, useId, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { BanderaPais } from '@/components/bandera';
import { TIPO_TRANSICION } from '@/components/sistema/navegacion';
import { construirUrlCaraACara } from '@/lib/sport/explorar/cara-a-cara-url';
import type {
  AsaltoDePrueba,
  FilaPoule,
  PouleDePrueba,
  RondaCuadro,
  TiradorAsalto,
} from '@/lib/sport/explorar/tipos-busqueda';
import { nombreCompacto, nombreVisible } from '@/lib/sport/nombre-visible';
import { cn } from '@/lib/utils';
import type { EnlaceFicha } from './prueba/enlaces';
import {
  huecosCuadro,
  inicioPorDefecto,
  puestosPoule,
  resaltado,
  separarRondas,
  ventanaRondas,
  type Filtro,
  type Ventana,
} from './prueba/logica';
import { ANCHO_AMPLIO, altoPoule, columnasPoule, conLetra } from './prueba/medidas-poule';

/**
 * Poules y cuadro de una prueba. La vista de la prueba decide qué rondas se
 * ven y a quién se resalta. Cada cosa se pinta una sola vez (nada de una
 * versión de móvil y otra de escritorio ocultas con CSS) y nada desborda en
 * horizontal: la poule se gira en su sitio entre resumen y asaltos, y el
 * cuadro enseña dos rondas en móvil y tres desde `sm`.
 */

const ENLACE_NOMBRE =
  'rounded-sm underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none';

const SIN_FILTRO: Filtro = { consulta: '' };

const AVANZAR = [TIPO_TRANSICION.avanzar];

function Nombre({
  t,
  enlace,
  corto = false,
  tactil = false,
  className,
}: {
  t: { personaId: string | null; nombre: string };
  enlace?: EnlaceFicha;
  corto?: boolean;
  /** El enlace llena su hueco y mide al menos 44 px de alto, con el texto recortado dentro. */
  tactil?: boolean;
  className?: string;
}) {
  const completo = nombreVisible(t.nombre);
  const texto = corto ? nombreCompacto(t.nombre) : completo;
  const titulo = texto === completo ? undefined : completo;
  if (!t.personaId || !enlace) {
    return (
      <span title={titulo} className={cn('truncate', className)}>
        {texto}
        {titulo ? <span className="sr-only">: {completo}</span> : null}
      </span>
    );
  }
  return (
    <Link
      href={enlace(t.personaId)}
      prefetch={false}
      transitionTypes={AVANZAR}
      title={titulo}
      className={cn(ENLACE_NOMBRE, tactil ? 'flex min-h-[44px] flex-1 items-center' : 'truncate', className)}
    >
      {tactil ? <span className="min-w-0 truncate">{texto}</span> : texto}
      {titulo ? <span className="sr-only">: {completo}</span> : null}
    </Link>
  );
}

/* --------------------------------------------------------------------- poules */

const firma = (n: number) => (n > 0 ? `+${n}` : String(n));

export function idPoule(ronda: string): string {
  return `poule-${ronda.replace(/[^A-Za-z0-9_-]/g, '')}`;
}

export type CaraPoule = 'resumen' | 'asaltos';

/*
 * Una sola rejilla por fila con tres plantillas (variables CSS de
 * `columnasPoule`): la tarjeta es un contenedor y, por debajo de 480 px de
 * ancho, `data-cara` elige entre resumen y asaltos; desde 480 px van juntos.
 * Las dos condiciones son excluyentes (`@max-` / `@min-`) para que el orden
 * de las reglas no importe.
 */
const COLUMNAS =
  'grid grid-cols-(--c-r) @max-[480px]:group-data-[cara=asaltos]/poule:grid-cols-(--c-a) @min-[480px]:grid-cols-(--c-w)';
/** Sólo con el resumen a la vista en una tarjeta estrecha. */
const SIN_ASALTOS = '@max-[480px]:group-data-[cara=asaltos]/poule:hidden';
/** Casillas de la matriz: con los asaltos a la vista o en una tarjeta ancha. */
const CON_ASALTOS = 'hidden group-data-[cara=asaltos]/poule:flex @min-[480px]:flex';
const NUMERO_CON_MATRIZ = 'hidden group-data-[cara=asaltos]/poule:inline @min-[480px]:inline';
const PUESTO_CON_MATRIZ = '@max-[480px]:group-data-[cara=asaltos]/poule:hidden @min-[480px]:hidden';
/** La columna de victorias se separa de la matriz con una línea, sólo cuando hay matriz. */
const BORDE_CON_ASALTOS = 'group-data-[cara=asaltos]/poule:border-l @min-[480px]:border-l';

/** Gira la tarjeta en 280 ms en total: media vuelta, cambio de cara y la otra media. */
const MEDIA_VUELTA_MS = 140;

function animarGiro(el: HTMLElement, cambiar: () => void, fin: () => void) {
  const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tresD = typeof CSS !== 'undefined' && CSS.supports?.('transform', 'perspective(1px) rotateY(1deg)');
  if (typeof el.animate !== 'function' || (!quieto && !tresD)) {
    cambiar();
    fin();
    return;
  }
  const [ida, vuelta]: Keyframe[][] = quieto
    ? [[{ opacity: 1 }, { opacity: 0 }], [{ opacity: 0 }, { opacity: 1 }]]
    : [
        [{ transform: 'perspective(1200px) rotateY(0deg)' }, { transform: 'perspective(1200px) rotateY(90deg)' }],
        [{ transform: 'perspective(1200px) rotateY(-90deg)' }, { transform: 'perspective(1200px) rotateY(0deg)' }],
      ];
  // Una sola cara pintada: a media vuelta (de canto, sin nada que ver) se cambia el contenido y se termina de girar.
  const primera = el.animate(ida, { duration: MEDIA_VUELTA_MS, easing: 'ease-in', fill: 'forwards' });
  primera.oncancel = fin;
  primera.onfinish = () => {
    primera.oncancel = null;
    cambiar();
    const segunda = el.animate(vuelta, { duration: MEDIA_VUELTA_MS, easing: 'ease-out' });
    segunda.onfinish = fin;
    segunda.oncancel = fin;
    primera.cancel();
  };
}

function Celda({ c, propia, columnaMarcada, letra, rival }: {
  c: FilaPoule['celdas'][number];
  propia: boolean;
  columnaMarcada: boolean;
  letra: boolean;
  rival: number;
}) {
  return (
    <span
      className={cn(
        CON_ASALTOS,
        'cifra items-center justify-center self-stretch border-l text-xs',
        propia ? 'bg-muted' : columnaMarcada ? 'bg-marcado' : null,
        c ? (c.victoria ? 'font-semibold text-ok' : 'text-danger') : 'text-muted-foreground',
      )}
    >
      {propia ? (
        <span className="sr-only">—</span>
      ) : c ? (
        <>
          <span className="sr-only">contra el {rival}: {c.victoria ? 'victoria' : 'derrota'} </span>
          {letra ? <span aria-hidden>{c.victoria ? 'V' : 'D'}</span> : null}
          {c.tantos}
        </>
      ) : (
        <>
          <span className="sr-only">contra el {rival}: sin asalto</span>
          <span aria-hidden>·</span>
        </>
      )}
    </span>
  );
}

const Poule = memo(function Poule({
  poule,
  enlace,
  marcas,
  caraInicial = 'resumen',
}: {
  poule: PouleDePrueba;
  enlace?: EnlaceFicha;
  /** Una letra por fila, `1` si está resaltada: así la poule sólo se repinta si cambia algo suyo. */
  marcas: string;
  caraInicial?: CaraPoule;
}) {
  const id = idPoule(poule.ronda);
  const cuerpoId = `${id}-cuerpo`;
  const [cara, setCara] = useState<CaraPoule>(caraInicial);
  // Las casillas no se montan hasta el primer giro o en una pantalla ancha, donde se ven siempre.
  const [girada, setGirada] = useState(caraInicial === 'asaltos');
  const ancha = usePantallaAncha(POULE_ANCHA);
  const matriz = girada || ancha;
  const tarjeta = useRef<HTMLElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const girando = useRef(false);

  const n = poule.filas.length;
  const puestos = puestosPoule(poule.filas);
  const marcadas = poule.filas.map((_, i) => marcas[i] === '1');
  const marcada = marcadas.some(Boolean);
  const letra = conLetra(n);
  const columnas = columnasPoule(n, matriz);
  const asaltos = cara === 'asaltos';

  function girar() {
    const el = tarjeta.current;
    if (girando.current) return;
    const siguiente: CaraPoule = asaltos ? 'resumen' : 'asaltos';
    if (!el) {
      setGirada(true);
      setCara(siguiente);
      return;
    }
    girando.current = true;
    setGirada(true);
    animarGiro(
      el,
      () => flushSync(() => setCara(siguiente)),
      () => {
        girando.current = false;
      },
    );
  }

  const estilo = {
    '--c-r': columnas.resumen,
    '--c-a': columnas.asaltos,
    '--c-w': columnas.amplia,
    containIntrinsicSize: `auto ${altoPoule(n)}px`,
  } as CSSProperties;

  // En la columna del puesto: el puesto con el resumen y el número (el de las columnas) con la matriz.
  const conPuesto = matriz ? PUESTO_CON_MATRIZ : undefined;

  return (
    <section
      ref={tarjeta}
      id={id}
      aria-label={poule.etiqueta}
      data-cara={cara}
      data-resaltado={marcada ? 'true' : undefined}
      style={estilo}
      className={cn(
        'group/poule @container relative flex min-w-0 scroll-mt-24 flex-col overflow-hidden rounded-lg border bg-card [content-visibility:auto] backface-hidden',
        marcada && 'border-primary ring-1 ring-primary',
      )}
    >
      <h3 id={`${id}-titulo`} className="border-b text-base leading-tight">
        <button
          ref={boton}
          type="button"
          aria-expanded={asaltos}
          aria-controls={cuerpoId}
          onClick={girar}
          className="flex min-h-[44px] w-full items-center gap-2 px-3 text-left transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset motion-reduce:transition-none @min-[480px]:hidden"
        >
          <span className="min-w-0 truncate">{poule.etiqueta}</span>
          <span className="text-xs text-muted-foreground">
            {n}
            <span className="sr-only"> tiradores. {asaltos ? 'Ver resumen' : 'Ver asaltos'}</span>
          </span>
          <span aria-hidden className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <Repeat2 className="size-4" />
            {asaltos ? 'Resumen' : 'Asaltos'}
          </span>
        </button>
        <span className="hidden min-h-[44px] items-center gap-2 px-3 @min-[480px]:flex">
          <span className="min-w-0 truncate">{poule.etiqueta}</span>
          <span className="text-xs text-muted-foreground">
            {n}
            <span className="sr-only"> tiradores</span>
          </span>
        </span>
      </h3>

      {/* Tocar la tarjeta también la gira; los nombres siguen siendo enlaces. */}
      <div
        id={cuerpoId}
        onClick={(e) => {
          if ((e.target as Element).closest('a, button')) return;
          if (boton.current && boton.current.getClientRects().length > 0) girar();
        }}
        className="@max-[480px]:cursor-pointer"
      >
        {/* Alto fijo: con resumen o con asaltos, la tarjeta mide lo mismo. */}
        <div aria-hidden className={cn(COLUMNAS, 'h-6 items-end px-2 text-xs leading-4 text-muted-foreground')}>
          <span />
          <span />
          {matriz
            ? poule.filas.map((f, j) => (
                <span
                  key={f.clave}
                  className={cn(CON_ASALTOS, 'justify-center', marcadas[j] && 'font-semibold text-primary-text')}
                >
                  {j + 1}
                </span>
              ))
            : null}
          <span className="text-center">V</span>
          <span className={cn(SIN_ASALTOS, 'text-center')}>TD</span>
          <span className={cn(SIN_ASALTOS, 'text-center')}>TR</span>
          <span className={cn(SIN_ASALTOS, 'text-right')}>Ind</span>
        </div>
        <ol className="divide-y" aria-label={poule.etiqueta}>
          {poule.filas.map((f, i) => (
            <li
              key={f.clave}
              className={cn(COLUMNAS, 'min-h-[44px] items-center px-2 text-sm', marcadas[i] && 'bg-marcado')}
            >
              <span className="cifra pr-1 text-right text-muted-foreground">
                <span className={conPuesto}>
                  <span className="sr-only">Puesto </span>
                  {puestos[i]}
                </span>
                {matriz ? (
                  <span className={NUMERO_CON_MATRIZ}>
                    <span className="sr-only">Número </span>
                    {i + 1}
                  </span>
                ) : null}
              </span>
              <span className="flex min-w-0 items-center gap-1 pr-1">
                {f.pais ? (
                  <span className={cn(SIN_ASALTOS, 'shrink-0')}>
                    <BanderaPais pais={f.pais} soloBandera />
                  </span>
                ) : null}
                {/* Con la matriz en 360 px quedan 66 px: «Salcedo M.» cabe en `text-xs`, no en `text-sm`. */}
                <Nombre
                  t={f}
                  enlace={enlace}
                  corto
                  tactil
                  className="min-w-0 font-medium @max-[480px]:group-data-[cara=asaltos]/poule:text-xs"
                />
              </span>
              {matriz
                ? f.celdas.map((c, j) => (
                    <Celda
                      key={j}
                      c={c}
                      propia={i === j}
                      columnaMarcada={marcadas[j] && !marcadas[i]}
                      letra={letra}
                      rival={j + 1}
                    />
                  ))
                : null}
              <span
                className={cn(
                  'cifra flex items-center justify-center self-stretch font-semibold',
                  matriz && BORDE_CON_ASALTOS,
                )}
              >
                {f.victorias}
                <span className="sr-only"> victorias de {f.asaltos},</span>
              </span>
              <span className={cn(SIN_ASALTOS, 'cifra text-center')}>
                <span className="sr-only">tocados dados </span>
                {f.tocados}
              </span>
              <span className={cn(SIN_ASALTOS, 'cifra text-center text-muted-foreground')}>
                <span className="sr-only">tocados recibidos </span>
                {f.recibidos}
              </span>
              <span className={cn(SIN_ASALTOS, 'cifra text-right')}>
                <span className="sr-only">índice </span>
                {firma(f.tocados - f.recibidos)}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
});

/** `1`/`0` por fila: si la persona resaltada está en ella. */
export function marcasPoule(poule: PouleDePrueba, filtro: Filtro): string {
  let s = '';
  for (const f of poule.filas) s += resaltado(f, filtro) ? '1' : '0';
  return s;
}

export function PoulesDePrueba({
  poules,
  enlace,
  filtro = SIN_FILTRO,
  caraInicial,
}: {
  poules: PouleDePrueba[];
  enlace?: EnlaceFicha;
  filtro?: Filtro;
  /** Cara con la que se abre cada poule en una tarjeta estrecha; por defecto, el resumen. */
  caraInicial?: CaraPoule;
}) {
  if (poules.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin poules.</p>;
  }
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {poules.map((p) => (
        <Poule key={p.ronda} poule={p} enlace={enlace} marcas={marcasPoule(p, filtro)} caraInicial={caraInicial} />
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- anchura */

function consultaDeAncho(consulta: string) {
  return {
    suscribir(avisar: () => void) {
      const mq = window.matchMedia(consulta);
      mq.addEventListener('change', avisar);
      return () => mq.removeEventListener('change', avisar);
    },
    ahora: () => window.matchMedia(consulta).matches,
  };
}

/** Desde `sm`: tres rondas del cuadro. */
const CUADRO_ANCHO = consultaDeAncho('(min-width: 640px)');
/**
 * Pantalla en la que la tarjeta de poule pasa de `ANCHO_AMPLIO` (480 px más
 * los 16 px de margen por lado): ahí la matriz se ve siempre y se monta ya.
 */
const POULE_ANCHA = consultaDeAncho(`(min-width: ${ANCHO_AMPLIO + 32}px)`);

/**
 * En el servidor (y al hidratar) la pantalla es la del móvil: la página se
 * diseña para él y el escritorio se ajusta tras hidratar.
 */
function usePantallaAncha(consulta: ReturnType<typeof consultaDeAncho>): boolean {
  return useSyncExternalStore(consulta.suscribir, consulta.ahora, () => false);
}

/* --------------------------------------------------------------------- cuadro */

/** Columnas del cuadro: dos en móvil, tres desde `sm`. */
export const COLUMNAS_CUADRO = { movil: 2, escritorio: 3 } as const;

function Lado({ t, gana, enlace, marcado }: { t: TiradorAsalto; gana: boolean; enlace?: EnlaceFicha; marcado: boolean }) {
  return (
    <div
      className={cn(
        'flex min-h-[40px] min-w-0 items-center gap-1 pl-2',
        gana ? 'font-semibold text-foreground' : 'text-muted-foreground',
        marcado && 'bg-marcado',
      )}
    >
      {t.pais ? <BanderaPais pais={t.pais} soloBandera /> : null}
      <Nombre t={t} enlace={enlace} corto tactil className="min-h-[40px] min-w-0 flex-1 text-sm" />
    </div>
  );
}

function Tantos({ t, gana, marcado }: { t: TiradorAsalto; gana: boolean; marcado: boolean }) {
  return (
    <span
      className={cn(
        'cifra flex min-h-[40px] items-center justify-end pr-2 text-sm tabular-nums',
        gana ? 'font-semibold text-foreground' : 'text-muted-foreground',
        marcado && 'bg-marcado',
      )}
    >
      {gana ? <span className="sr-only">ganó con </span> : null}
      {t.tantos}
    </span>
  );
}

export function idAsalto(id: string): string {
  return `asalto-${id}`;
}

/**
 * Cara a cara de los dos tiradores de un asalto, desde quien esté resaltado
 * (si es uno de ellos) o desde el de arriba. `null` si a alguno le falta ficha.
 */
export function caraACaraDeAsalto(a: Pick<AsaltoDePrueba, 'a' | 'b'>, filtro: Pick<Filtro, 'persona'>): string | null {
  const { a: x, b: y } = a;
  if (!x.personaId || !y.personaId || x.personaId === y.personaId) return null;
  const [yo, rival] = filtro.persona && y.personaId === filtro.persona ? [y.personaId, x.personaId] : [x.personaId, y.personaId];
  return construirUrlCaraACara(yo, { rival });
}

const Asalto = memo(function Asalto({
  a,
  enlace,
  persona,
  marcadoA,
  marcadoB,
  ronda,
}: {
  a: AsaltoDePrueba;
  enlace?: EnlaceFicha;
  persona?: string;
  marcadoA: boolean;
  marcadoB: boolean;
  ronda: string;
}) {
  const ganaA = a.a.tantos > a.b.tantos;
  const ganaB = a.b.tantos > a.a.tantos;
  const duelo = caraACaraDeAsalto(a, { persona });
  // Los tantos son el enlace al cara a cara: una columna de 44 px que se toca en las dos filas.
  const tantos = (
    <>
      <Tantos t={a.a} gana={ganaA} marcado={marcadoA} />
      <Tantos t={a.b} gana={ganaB} marcado={marcadoB} />
    </>
  );
  return (
    <div
      id={idAsalto(a.id)}
      data-resaltado={marcadoA || marcadoB ? 'true' : undefined}
      className={cn(
        'grid min-w-0 scroll-mt-24 grid-cols-[minmax(0,1fr)_44px] overflow-hidden rounded-md border bg-card',
        (marcadoA || marcadoB) && 'border-primary ring-1 ring-primary',
      )}
    >
      <span className="sr-only">{ronda}: </span>
      <div className="min-w-0 divide-y">
        <Lado t={a.a} gana={ganaA} enlace={enlace} marcado={marcadoA} />
        <Lado t={a.b} gana={ganaB} enlace={enlace} marcado={marcadoB} />
      </div>
      {duelo ? (
        <Link
          href={duelo}
          prefetch={false}
          transitionTypes={AVANZAR}
          data-enlace="cara-a-cara"
          aria-label={`${a.a.tantos} a ${a.b.tantos}. Cara a cara de ${nombreVisible(a.a.nombre)} y ${nombreVisible(a.b.nombre)}`}
          className="flex min-w-0 flex-col divide-y transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset motion-reduce:transition-none"
        >
          {tantos}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-col divide-y">{tantos}</div>
      )}
    </div>
  );
});

function AsaltoMarcado({ a, enlace, filtro, ronda }: { a: AsaltoDePrueba; enlace?: EnlaceFicha; filtro: Filtro; ronda: string }) {
  return (
    <Asalto
      a={a}
      enlace={enlace}
      persona={filtro.persona}
      marcadoA={resaltado(a.a, filtro)}
      marcadoB={resaltado(a.b, filtro)}
      ronda={ronda}
    />
  );
}

/** Botón redondo de 36 px a la vista con 44 px de área táctil. */
const FLECHA =
  'group inline-flex size-[44px] items-center justify-center rounded-full focus-visible:outline-none disabled:pointer-events-none';
const FLECHA_VISIBLE =
  'inline-flex size-[36px] items-center justify-center rounded-full border border-input bg-secondary text-foreground transition-colors group-hover:bg-accent group-focus-visible:ring-[3px] group-focus-visible:ring-ring group-disabled:opacity-35 motion-reduce:transition-none';

function Flechas({ desde, puedeAtras, puedeAdelante, onInicio }: Ventana & { onInicio?: (inicio: number) => void }) {
  return (
    <div className="-mr-1 flex items-center">
      <button type="button" className={FLECHA} disabled={!puedeAtras} onClick={() => onInicio?.(desde - 1)} aria-label="Ronda anterior">
        <span className={FLECHA_VISIBLE}>
          <ChevronLeft className="size-4" aria-hidden />
        </span>
      </button>
      <button type="button" className={FLECHA} disabled={!puedeAdelante} onClick={() => onInicio?.(desde + 1)} aria-label="Ronda siguiente">
        <span className={FLECHA_VISIBLE}>
          <ChevronRight className="size-4" aria-hidden />
        </span>
      </button>
    </div>
  );
}

const COLUMNAS_REJILLA = ['grid-cols-1', 'grid-cols-1', 'grid-cols-2', 'grid-cols-3'] as const;

/**
 * Dónde va la casilla `k` de la ronda `i` en la ventana: cada ronda ocupa el
 * doble de filas que la anterior y se centra en ellas, así el asalto queda a
 * la altura del par del que sale. La fila 1 es la de los rótulos.
 */
function sitio(v: Ventana, i: number, k: number): CSSProperties {
  const alto = 2 ** (i - v.desde);
  return { gridColumn: i - v.desde + 1, gridRow: `${2 + k * alto} / span ${alto}` };
}

/**
 * Cuadro de eliminación directa por ventanas de rondas, de la mayor a la
 * final, en una sola rejilla: las filas se ajustan a lo que contienen, así un
 * exento de la primera columna visible ocupa poco y el cuadro sigue alineado.
 * Sólo se pintan las rondas de la ventana.
 */
export function CuadroDePrueba({
  cuadro,
  enlace,
  filtro = SIN_FILTRO,
  inicio: pedido,
  onInicio,
}: {
  cuadro: RondaCuadro[];
  enlace?: EnlaceFicha;
  filtro?: Filtro;
  /**
   * Primera ronda visible (0 = la mayor); sin dar, la mayor del cuadro
   * principal. Se recorta para no pasar de la final.
   */
  inicio?: number;
  onInicio?: (inicio: number) => void;
}) {
  const ancha = usePantallaAncha(CUADRO_ANCHO);
  const rotuloId = useId();
  if (cuadro.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin directas.</p>;
  }
  const { principales, otras } = separarRondas(cuadro);
  const huecos = huecosCuadro(principales);
  const inicio = pedido ?? inicioPorDefecto(principales);
  const v = ventanaRondas(principales.length, inicio, ancha ? COLUMNAS_CUADRO.escritorio : COLUMNAS_CUADRO.movil);
  const visibles = principales.slice(v.desde, v.hasta);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {visibles.length > 0 ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <p id={rotuloId} className="min-w-0 truncate text-sm text-muted-foreground" aria-live="polite">
              {visibles[0].etiqueta} – {visibles[visibles.length - 1].etiqueta}
            </p>
            <Flechas {...v} onInicio={onInicio} />
          </div>
          <div
            role="list"
            aria-labelledby={rotuloId}
            className={cn('grid gap-x-2 gap-y-2 sm:gap-x-4', COLUMNAS_REJILLA[visibles.length])}
          >
            {visibles.map((r, c) => (
              <h3
                key={`rotulo-${r.ronda}`}
                aria-hidden
                style={{ gridColumn: c + 1, gridRow: 1 }}
                className="flex items-baseline justify-between gap-2 border-b pb-1 text-sm leading-tight"
              >
                <span className="truncate">{r.etiqueta}</span>
              </h3>
            ))}
            {visibles.flatMap((r, c) => {
              const i = v.desde + c;
              return huecos[i].map((a, k) => {
                if (!a) {
                  // Sólo la primera columna marca el hueco; en las demás, la rejilla ya deja su sitio.
                  return c === 0 ? <div key={`hueco-${r.ronda}-${k}`} aria-hidden style={sitio(v, i, k)} className="h-4 self-center" /> : null;
                }
                return (
                  <div key={a.id} role="listitem" style={sitio(v, i, k)} className="min-w-0 self-center">
                    <AsaltoMarcado a={a} enlace={enlace} filtro={filtro} ronda={r.etiqueta} />
                  </div>
                );
              });
            })}
          </div>
        </>
      ) : null}
      {otras.map((r) => (
        <section key={r.ronda} aria-label={r.etiqueta} className="flex flex-col gap-2">
          <h3 className="border-b pb-1 text-sm">{r.etiqueta}</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            {r.asaltos.map((a) => (
              <AsaltoMarcado key={a.id} a={a} enlace={enlace} filtro={filtro} ronda={r.etiqueta} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
