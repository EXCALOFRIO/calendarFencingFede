import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { BanderaPais } from '@/components/bandera';
import { TIPO_TRANSICION } from '@/components/sistema/navegacion';
import { construirUrlCaraACara } from '@/lib/sport/explorar/cara-a-cara-url';
import { etiquetaCortaRonda } from '@/lib/sport/explorar/ediciones-asaltos';
import type {
  AsaltoDePrueba,
  PouleDePrueba,
  RondaCuadro,
  TiradorAsalto,
} from '@/lib/sport/explorar/tipos-busqueda';
import { nombreCompacto, nombreVisible } from '@/lib/sport/nombre-visible';
import { cn } from '@/lib/utils';
import type { EnlaceFicha } from './prueba/enlaces';
import { HojaPoule } from './prueba/hoja-poule';
import {
  huecosCuadro,
  inicioPorDefecto,
  resaltado,
  separarRondas,
  ventanaRondas,
  type Filtro,
  type Ventana,
} from './prueba/logica';

/**
 * Poules y cuadro de una prueba, sin estado propio: la vista de la prueba
 * decide qué rondas se ven y a quién se resalta. Nada desborda en horizontal:
 * en móvil la poule es una lista (la hoja de poule se abre a pantalla completa) y el
 * cuadro enseña dos rondas en lugar de tres.
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
  /**
   * El enlace llena su hueco y mide al menos 44 px de alto (en px: `min-h-11`
   * serían 49,5 con la raíz de 18 px del móvil), con el texto recortado dentro.
   */
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

// En px: en rem, con el texto grande del sistema las cifras se comían la columna del nombre (24 px a 320 px).
const COLUMNAS_LISTA = 'grid-cols-[16px_minmax(0,1fr)_repeat(3,24px)_32px]';

function Poule({ poule, enlace, filtro }: { poule: PouleDePrueba; enlace?: EnlaceFicha; filtro: Filtro }) {
  const id = idPoule(poule.ronda);
  const marcada = poule.filas.some((f) => resaltado(f, filtro));
  return (
    <section
      id={id}
      aria-labelledby={`${id}-titulo`}
      data-resaltado={marcada ? 'true' : undefined}
      className={cn(
        'relative flex min-w-0 scroll-mt-24 flex-col overflow-hidden rounded-lg border bg-card',
        marcada && 'border-primary ring-1 ring-primary',
      )}
    >
      <header className="flex min-h-[44px] items-center justify-between gap-2 border-b px-3 py-1.5">
        <span className="flex min-w-0 items-baseline gap-2">
          <h3 id={`${id}-titulo`} className="truncate text-base leading-tight">{poule.etiqueta}</h3>
          <span className="text-xs text-muted-foreground">
            {poule.filas.length}
            <span className="sr-only"> tiradores</span>
          </span>
        </span>
        <HojaPoule poule={poule} enlace={enlace} filtro={filtro} className="sm:hidden" />
      </header>

      {/* Móvil: una fila por tirador con sus cifras; la hoja de poule se abre aparte. */}
      <div className="sm:hidden">
        <div aria-hidden className={cn('grid gap-x-[6px] px-[12px] pt-1.5 text-[12px] text-muted-foreground', COLUMNAS_LISTA)}>
          <span />
          <span />
          <span className="text-center">V</span>
          <span className="text-center">TD</span>
          <span className="text-center">TR</span>
          <span className="text-right">Ind</span>
        </div>
        <ol className="divide-y" aria-label={poule.etiqueta}>
          {poule.filas.map((f, i) => (
            <li
              key={f.clave}
              className={cn(
                'grid min-h-[44px] items-center gap-x-[6px] px-[12px] text-sm',
                COLUMNAS_LISTA,
                resaltado(f, filtro) && 'bg-marcado',
              )}
            >
              <span className="cifra text-right text-muted-foreground">{i + 1}</span>
              <span className="flex min-w-0 items-center gap-1.5">
                {f.pais ? <BanderaPais pais={f.pais} soloBandera /> : null}
                {/* Por encima del área táctil del botón de la hoja de poule, que cubre la tarjeta. */}
                <Nombre t={f} enlace={enlace} corto tactil className="relative z-[1] min-w-0 font-medium" />
              </span>
              <span className="cifra text-center font-semibold">
                {f.victorias}
                <span className="sr-only"> victorias de {f.asaltos},</span>
              </span>
              <span className="cifra text-center">
                <span className="sr-only">tocados dados </span>
                {f.tocados}
              </span>
              <span className="cifra text-center text-muted-foreground">
                <span className="sr-only">tocados recibidos </span>
                {f.recibidos}
              </span>
              <span className="cifra text-right">
                <span className="sr-only">índice </span>
                {firma(f.tocados - f.recibidos)}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* Desde sm: la hoja de poule completa, con columnas fijas para que nunca se salga. */}
      <table className="hidden w-full table-fixed border-collapse text-sm sm:table">
        <caption className="sr-only">
          {poule.etiqueta}: tantos de cada fila contra cada columna. V indica victoria.
        </caption>
        <colgroup>
          <col className="w-7" />
          <col />
          {poule.filas.map((f) => (
            <col key={f.clave} className="w-8" />
          ))}
          <col className="w-8" />
          <col className="w-9" />
          <col className="w-9" />
          <col className="w-10" />
        </colgroup>
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th scope="col" className="py-1.5 pr-1 text-right font-medium">#</th>
            <th scope="col" className="px-2 py-1.5 text-left font-medium"><span className="sr-only">Tirador</span></th>
            {poule.filas.map((f, i) => (
              <th key={f.clave} scope="col" className="py-1.5 text-center font-medium">
                <span className="sr-only">Contra el </span>{i + 1}
              </th>
            ))}
            <th scope="col" className="py-1.5 text-center font-medium"><abbr title="Victorias" aria-hidden>V</abbr><span className="sr-only">Victorias</span></th>
            <th scope="col" className="py-1.5 text-center font-medium"><abbr title="Tocados dados" aria-hidden>TD</abbr><span className="sr-only">Tocados dados</span></th>
            <th scope="col" className="py-1.5 text-center font-medium"><abbr title="Tocados recibidos" aria-hidden>TR</abbr><span className="sr-only">Tocados recibidos</span></th>
            <th scope="col" className="py-1.5 pr-2 text-right font-medium"><abbr title="Índice (TD − TR)" aria-hidden>Ind</abbr><span className="sr-only">Índice</span></th>
          </tr>
        </thead>
        <tbody>
          {poule.filas.map((f, i) => (
            <tr key={f.clave} className={cn('border-t', resaltado(f, filtro) && 'bg-marcado')}>
              <td className="cifra py-1.5 pr-1 text-right text-muted-foreground">{i + 1}</td>
              <th scope="row" className="px-2 py-0 text-left font-normal">
                <span className="flex min-w-0 items-center gap-1.5">
                  {f.pais ? <BanderaPais pais={f.pais} /> : null}
                  {/* El enlace llena la casilla: la fila mide un toque, 44 px. */}
                  <Nombre t={f} enlace={enlace} tactil className="min-w-0 font-medium" />
                </span>
              </th>
              {f.celdas.map((c, j) => (
                <td
                  key={j}
                  className={cn(
                    'cifra border-l py-1.5 text-center text-xs',
                    i === j && 'bg-muted',
                    c?.victoria ? 'font-semibold text-ok' : 'text-muted-foreground',
                  )}
                >
                  {i === j ? <span className="sr-only">—</span> : c ? `${c.victoria ? 'V' : ''}${c.tantos}` : '·'}
                </td>
              ))}
              <td className="cifra border-l py-1.5 text-center font-semibold">{f.victorias}</td>
              <td className="cifra py-1.5 text-center">{f.tocados}</td>
              <td className="cifra py-1.5 text-center text-muted-foreground">{f.recibidos}</td>
              <td className="cifra py-1.5 pr-2 text-right">{firma(f.tocados - f.recibidos)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function PoulesDePrueba({
  poules,
  enlace,
  filtro = SIN_FILTRO,
}: {
  poules: PouleDePrueba[];
  enlace?: EnlaceFicha;
  filtro?: Filtro;
}) {
  if (poules.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin poules.</p>;
  }
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {poules.map((p) => (
        <Poule key={p.ronda} poule={p} enlace={enlace} filtro={filtro} />
      ))}
    </div>
  );
}

/* --------------------------------------------------------------------- cuadro */

/** Columnas del cuadro: dos en móvil, tres desde `sm`. */
export const COLUMNAS_CUADRO = { movil: 2, escritorio: 3 } as const;

function Lado({ t, gana, enlace, marcado }: { t: TiradorAsalto; gana: boolean; enlace?: EnlaceFicha; marcado: boolean }) {
  return (
    <div
      className={cn(
        'flex min-h-[40px] min-w-0 items-center gap-1.5 pl-2',
        gana ? 'font-semibold text-foreground' : 'text-muted-foreground',
        marcado && 'bg-marcado',
      )}
    >
      {t.pais ? <BanderaPais pais={t.pais} soloBandera /> : null}
      <Nombre t={t} enlace={enlace} corto tactil className="min-h-[40px] min-w-0 flex-1 text-[13px]" />
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
export function caraACaraDeAsalto(a: Pick<AsaltoDePrueba, 'a' | 'b'>, filtro: Filtro): string | null {
  const { a: x, b: y } = a;
  if (!x.personaId || !y.personaId || x.personaId === y.personaId) return null;
  const [yo, rival] = filtro.persona && y.personaId === filtro.persona ? [y.personaId, x.personaId] : [x.personaId, y.personaId];
  return construirUrlCaraACara(yo, { rival });
}

function Asalto({ a, enlace, filtro, ronda }: { a: AsaltoDePrueba; enlace?: EnlaceFicha; filtro: Filtro; ronda: string }) {
  const marcadoA = resaltado(a.a, filtro);
  const marcadoB = resaltado(a.b, filtro);
  const ganaA = a.a.tantos > a.b.tantos;
  const ganaB = a.b.tantos > a.a.tantos;
  const duelo = caraACaraDeAsalto(a, filtro);
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
}

/** Botón redondo de 36 px a la vista con 44 px de área táctil. */
const FLECHA =
  'group inline-flex size-[44px] items-center justify-center rounded-full focus-visible:outline-none disabled:pointer-events-none';
const FLECHA_VISIBLE =
  'inline-flex size-[36px] items-center justify-center rounded-full border border-input bg-secondary text-foreground transition-colors group-hover:bg-accent group-focus-visible:ring-[3px] group-focus-visible:ring-ring group-disabled:opacity-35 motion-reduce:transition-none';

function Flechas({
  desde,
  puedeAtras,
  puedeAdelante,
  onInicio,
  className,
}: Ventana & { onInicio?: (inicio: number) => void; className?: string }) {
  return (
    <div className={cn('-mr-1 items-center', className)}>
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

const COLUMNAS_MOVIL = ['grid-cols-1', 'grid-cols-1', 'grid-cols-2'] as const;
const COLUMNAS_ESCRITORIO = ['sm:grid-cols-1', 'sm:grid-cols-1', 'sm:grid-cols-2', 'sm:grid-cols-3'] as const;

type Sitio = { columna: number; fila: string } | null;

/**
 * Dónde va la casilla `k` de la ronda `i` en una ventana: cada ronda ocupa el
 * doble de filas que la anterior y se centra en ellas, así el asalto queda a
 * la altura del par del que sale. La fila 1 es la de los rótulos.
 */
function sitio(v: Ventana, i: number, k: number): Sitio {
  if (i < v.desde || i >= v.hasta) return null;
  const alto = 2 ** (i - v.desde);
  return { columna: i - v.desde + 1, fila: `${2 + k * alto} / span ${alto}` };
}

/** Posición por anchura con variables CSS: las clases son fijas, los números no. */
const POSICION =
  'self-center [grid-column:var(--col-m)] [grid-row:var(--fila-m)] sm:[grid-column:var(--col-e)] sm:[grid-row:var(--fila-e)]';

function visibilidad(m: Sitio, e: Sitio): string {
  return cn(m ? 'block' : 'hidden', e ? 'sm:block' : 'sm:hidden');
}

function estilo(m: Sitio, e: Sitio): CSSProperties {
  return {
    '--col-m': m?.columna,
    '--fila-m': m?.fila,
    '--col-e': e?.columna,
    '--fila-e': e?.fila,
  } as CSSProperties;
}

/**
 * Cuadro de eliminación directa por ventanas de rondas, de la mayor a la
 * final, en una sola rejilla: las filas se ajustan a lo que contienen, así un
 * exento de la primera columna visible ocupa poco y el cuadro sigue alineado.
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
  if (cuadro.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin directas.</p>;
  }
  const { principales, otras } = separarRondas(cuadro);
  const huecos = huecosCuadro(principales);
  const inicio = pedido ?? inicioPorDefecto(principales);
  const movil = ventanaRondas(principales.length, inicio, COLUMNAS_CUADRO.movil);
  const escritorio = ventanaRondas(principales.length, inicio, COLUMNAS_CUADRO.escritorio);
  const rotulo = (v: Ventana) =>
    `${etiquetaCortaRonda(principales[v.desde])} – ${etiquetaCortaRonda(principales[v.hasta - 1])}`;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {principales.length > 0 ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm text-muted-foreground" aria-live="polite">
              <span className="sm:hidden">{rotulo(movil)}</span>
              <span className="hidden sm:inline">{rotulo(escritorio)}</span>
            </p>
            <Flechas {...movil} onInicio={onInicio} className="flex sm:hidden" />
            <Flechas {...escritorio} onInicio={onInicio} className="hidden sm:flex" />
          </div>
          <div
            role="list"
            aria-label="Cuadro de eliminación directa"
            className={cn(
              'grid gap-x-2 gap-y-1.5 sm:gap-x-4 sm:gap-y-2',
              COLUMNAS_MOVIL[Math.min(principales.length, 2)],
              COLUMNAS_ESCRITORIO[Math.min(principales.length, 3)],
            )}
          >
            {principales.map((r, i) => {
              const m = sitio(movil, i, 0) && { columna: i - movil.desde + 1, fila: '1' };
              const e = sitio(escritorio, i, 0) && { columna: i - escritorio.desde + 1, fila: '1' };
              return (
                <h3
                  key={`rotulo-${r.ronda}`}
                  aria-hidden
                  style={estilo(m, e)}
                  className={cn(
                    'flex items-baseline justify-between gap-2 border-b pb-1 text-sm leading-tight',
                    visibilidad(m, e),
                    '[grid-column:var(--col-m)] [grid-row:1] sm:[grid-column:var(--col-e)]',
                  )}
                >
                  <span className="truncate">{etiquetaCortaRonda(r)}</span>
                </h3>
              );
            })}
            {principales.flatMap((r, i) =>
              huecos[i].map((a, k) => {
                const m = sitio(movil, i, k);
                const e = sitio(escritorio, i, k);
                if (!m && !e) return null;
                if (!a) {
                  // Sólo la primera columna visible necesita marcar el hueco; en
                  // las demás, la rejilla ya deja su sitio.
                  const primeraM = m && i === movil.desde ? m : null;
                  const primeraE = e && i === escritorio.desde ? e : null;
                  if (!primeraM && !primeraE) return null;
                  return (
                    <div
                      key={`hueco-${r.ronda}-${k}`}
                      aria-hidden
                      style={estilo(primeraM, primeraE)}
                      className={cn('h-4', visibilidad(primeraM, primeraE), POSICION)}
                    />
                  );
                }
                return (
                  <div
                    key={a.id}
                    role="listitem"
                    style={estilo(m, e)}
                    className={cn('min-w-0', visibilidad(m, e), POSICION)}
                  >
                    <Asalto a={a} enlace={enlace} filtro={filtro} ronda={r.etiqueta} />
                  </div>
                );
              }),
            )}
          </div>
        </>
      ) : null}
      {otras.map((r) => (
        <section key={r.ronda} aria-label={r.etiqueta} className="flex flex-col gap-1.5">
          <h3 className="border-b pb-1 text-sm">{r.etiqueta}</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            {r.asaltos.map((a) => (
              <Asalto key={a.id} a={a} enlace={enlace} filtro={filtro} ronda={r.etiqueta} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
