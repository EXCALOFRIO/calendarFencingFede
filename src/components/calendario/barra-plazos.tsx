import { FileText } from 'lucide-react';
import { Pastilla, type TonoPastilla } from '@/components/sistema/pastilla';
import { AREA_TACTIL } from '@/components/sistema/tactil';
import type { ComputedDeadline, DeadlineStatus } from '@/lib/deadlines';
import { fechaCorta, HUSO_MADRID } from '@/lib/fechas';
import { cn, formatEur } from '@/lib/utils';

/**
 * ===========================================================================
 * EL PLAZO, DIBUJADO
 * ===========================================================================
 *
 * Lo que se pregunta quien llega tarde es **en qué tramo estoy y qué me cuesta
 * a partir de aquí**. Por eso hay dos piezas:
 *
 *   1. Una barra continua con una marca por hito y la de HOY. Es un esquema,
 *      como el plano de un metro: los tramos miden lo mismo. Proporcional al
 *      tiempo real no vale: en lo nacional las ventanas son de 3, 1 y 1 días
 *      (las caras quedaban en cuatro píxeles) y en lo internacional el plazo
 *      ordinario abre meses antes. Lo único proporcional es dónde cae hoy
 *      dentro de su propio tramo.
 *   2. Debajo, una lista rígida de tramos: «Hasta mié 30 sept · 18:00 | +15 €».
 *      Una fila por tramo, siempre con la misma altura, la fecha a la
 *      izquierda y el estado a la derecha. Antes las fechas iban debajo de
 *      cada trozo de barra, a 60 px por columna, y partían en dos o tres
 *      renglones distintos según el día.
 *
 * LAS VENTANAS, Y POR QUÉ SON N+1
 * -------------------------------
 * `surcharge_eur` es *lo que cuesta una vez que ese hito ha vencido*. Cada
 * hito abre una ventana y antes del primero hay una más, sin recargo. Tres
 * hitos son cuatro tramos; el último es «Después».
 */

type Props = {
  plazos: ComputedDeadline[];
  estado: DeadlineStatus;
  /**
   * Escribir el estado completo debajo («Quedan 5 días para…»). Por defecto
   * sí: quien usa lector de pantalla no ve la barra. La ficha lo apaga porque
   * ya lo dice la pastilla de su cabecera.
   */
  conEstado?: boolean;
};

export type EstadoTramo = 'pasado' | 'actual' | 'futuro';

export type Tramo = {
  /** Recargo que se paga DENTRO de este tramo. `null` = no publicado. */
  importe: string | null;
  /** El hito que lo cierra. `null` en el último, «Después». */
  cierra: ComputedDeadline | null;
  estado: EstadoTramo;
  /** Sólo en el tramo actual: 0–1, dónde cae hoy dentro de él. */
  avance: number | null;
};

const TONO_ESTADO: Record<DeadlineStatus['state'], string> = {
  verde: 'text-ok',
  ambar: 'text-warn',
  rojo: 'text-danger',
  cerrado: 'text-muted-foreground',
  sin_datos: 'text-muted-foreground',
};

const PASTILLA_ESTADO: Record<DeadlineStatus['state'], TonoPastilla> = {
  verde: 'ok',
  ambar: 'aviso',
  rojo: 'peligro',
  cerrado: 'neutro',
  sin_datos: 'neutro',
};

export function construirTramos(plazos: ComputedDeadline[], ahora: Date): Tramo[] {
  const ordenados = [...plazos].sort((a, b) => a.deadlineAt.getTime() - b.deadlineAt.getTime());
  const importes: (string | null)[] = [null, ...ordenados.map((d) => d.surchargeEur)];
  const cierres: (ComputedDeadline | null)[] = [...ordenados, null];

  const indiceActual = ordenados.findIndex((d) => d.deadlineAt.getTime() > ahora.getTime());
  const actual = indiceActual === -1 ? ordenados.length : indiceActual;

  return importes.map((importe, i) => {
    const cierra = cierres[i];
    const estado: EstadoTramo = i < actual ? 'pasado' : i === actual ? 'actual' : 'futuro';

    let avance: number | null = null;
    if (estado === 'actual' && cierra) {
      const abre = i === 0 ? null : ordenados[i - 1].deadlineAt.getTime();
      const cierraEn = cierra.deadlineAt.getTime();
      if (abre !== null && cierraEn > abre) {
        avance = (ahora.getTime() - abre) / (cierraEn - abre);
      } else {
        // El primer tramo no tiene apertura: se mide contra la última semana,
        // que es cuando mirar la marca sirve para algo.
        const semana = 7 * 86_400_000;
        avance = Math.max(0, 1 - (cierraEn - ahora.getTime()) / semana);
      }
      avance = Math.min(1, Math.max(0, avance));
    }
    return { importe, cierra, estado, avance };
  });
}

/**
 * Posiciones en la barra, en tanto por ciento. Cada tramo con cierre mide una
 * unidad y el último, media: existe para que se vea que la escalera termina.
 */
export function geometria(tramos: Tramo[]): { hitos: number[]; hoy: number } {
  const n = tramos.length - 1;
  const total = n + 0.5;
  const hitos = tramos.slice(0, n).map((_, i) => ((i + 1) / total) * 100);
  const i = Math.max(0, tramos.findIndex((t) => t.estado === 'actual'));
  const dentro = tramos[i]?.cierra ? (tramos[i].avance ?? 0) : 0.5;
  const ancho = tramos[i]?.cierra ? 1 : 0.5;
  return { hitos, hoy: ((i + dentro * ancho) / total) * 100 };
}

function recargo(importe: string | null): string | null {
  if (importe === null || importe === '') return null;
  const n = Number(importe);
  if (!Number.isFinite(n)) return null;
  return n > 0 ? `+${formatEur(importe)}` : 'Sin recargo';
}

/**
 * Lo que se escribe a la derecha del tramo. El primero no tiene recargo por
 * definición; en los demás, un recargo no publicado no se escribe (no es
 * «sin recargo»: ver `etiquetaRecargo`). Tras un cierre duro, «Cerrada».
 */
export function estadoDeTramo(t: Tramo, i: number, ultimo: ComputedDeadline | null): string | null {
  if (!t.cierra) {
    if (ultimo?.blocking) return 'Cerrada';
    return recargo(t.importe) ?? 'Sin confirmar';
  }
  if (i === 0) return 'Sin recargo';
  return recargo(t.importe);
}

const SEMANA = new Intl.DateTimeFormat('es-ES', { weekday: 'short', timeZone: HUSO_MADRID });
const HORA = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: HUSO_MADRID });

/** «mié 30 sept · 18:00», sin la hora cuando es el final del día. */
export function fechaHito(d: Date): string {
  const hora = HORA.format(d);
  const dia = `${SEMANA.format(d).replace('.', '')} ${fechaCorta(d)}`;
  return hora === '23:59' ? dia : `${dia} · ${hora}`;
}

export function BarraPlazos({ plazos, estado, conEstado = true }: Props) {
  // Sin plazo publicado no se pinta nada (`UI.md`, 2 bis).
  if (plazos.length === 0) return null;

  const tramos = construirTramos(plazos, new Date());
  const ultimo = tramos[tramos.length - 2]?.cierra ?? null;
  const { hitos, hoy } = geometria(tramos);
  const urgente = estado.state === 'rojo' && !estado.closed;
  const grita = estado.state === 'rojo' || estado.state === 'cerrado';

  return (
    <div data-slot="barra-plazos" className={cn('flex flex-col gap-3', TONO_ESTADO[estado.state])}>
      {/* El dibujo: la lista de debajo dice lo mismo con palabras. */}
      <div aria-hidden className="relative px-2 pt-2 pb-6">
        <div className="relative h-2 rounded-full bg-secondary">
          <div className="absolute inset-y-0 left-0 rounded-full bg-current" style={{ width: `${hoy.toFixed(1)}%` }} />
          {hitos.map((x, i) => (
            <span
              key={tramos[i].cierra?.type ?? i}
              className={cn(
                'absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background',
                tramos[i].estado === 'pasado' ? 'bg-current' : 'bg-muted-foreground',
              )}
              style={{ left: `${x.toFixed(1)}%` }}
            />
          ))}
          <span
            className="absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded-full bg-foreground"
            style={{ left: `clamp(0px, calc(${hoy.toFixed(1)}% - 2px), calc(100% - 4px))` }}
          />
          <span
            className="absolute top-full mt-1 w-12 text-center text-xs font-medium text-foreground"
            style={{ left: `clamp(-0.5rem, calc(${hoy.toFixed(1)}% - 1.5rem), calc(100% - 2.5rem))` }}
          >
            Hoy
          </span>
        </div>
      </div>

      <ol data-slot="tramos-plazo" className="flex flex-col gap-1">
        {tramos.map((t, i) => {
          const actual = t.estado === 'actual';
          const texto = estadoDeTramo(t, i, ultimo);
          const estimada = t.cierra?.origin === 'CALCULADO';
          return (
            <li
              key={t.cierra?.type ?? 'despues'}
              data-plazo="tramo"
              data-estado={t.estado}
              aria-current={actual ? 'step' : undefined}
              className={cn(
                'grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2',
                actual && 'bg-marcado',
              )}
            >
              <span
                data-plazo="fecha"
                className={cn(
                  'min-w-0 text-sm tabular-nums',
                  actual ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                {t.cierra ? (
                  <>
                    Hasta{' '}
                    {/*
                      Un plazo DEDUCIDO de la normativa no se pinta igual que
                      uno PUBLICADO: va subrayado de puntos, con su porqué en el
                      `title` y dicho al lector.
                    */}
                    <span
                      title={estimada ? 'Fechas estimadas según la normativa, no publicadas' : undefined}
                      className={cn(
                        estimada && 'underline decoration-dotted decoration-from-font underline-offset-2',
                      )}
                    >
                      {fechaHito(t.cierra.deadlineAt)}
                    </span>
                    {t.cierra?.origin === 'CALCULADO' ? <span className="sr-only"> (estimada)</span> : null}
                  </>
                ) : (
                  'Después'
                )}
              </span>
              <span className="flex shrink-0 items-center justify-end gap-1">
                {actual && urgente ? <Pastilla tono="peligro">Urgente</Pastilla> : null}
                {texto ? (
                  <Pastilla
                    data-plazo="importe"
                    tono={actual && !urgente ? PASTILLA_ESTADO[estado.state] : 'neutro'}
                    className={cn(t.estado === 'pasado' && 'text-muted-foreground')}
                  >
                    {texto}
                  </Pastilla>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>

      {conEstado ? (
        <p className={cn('text-xs text-muted-foreground', grita && 'text-sm font-medium text-current')}>
          {estado.label}
        </p>
      ) : null}

      {/* De qué circular sale el importe: sin el documento, «+15 €» es una cifra sin dueño. */}
      {plazos[0]?.sourceUrl ? (
        <a
          href={plazos[0].sourceUrl}
          target="_blank"
          rel="noreferrer"
          title={plazos[0].sourceDocument ?? undefined}
          className={cn(
            'inline-flex size-[32px] items-center justify-center self-start rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            AREA_TACTIL,
          )}
        >
          <FileText className="size-4" aria-hidden />
          <span className="sr-only">{plazos[0].sourceDocument ?? 'Circular'}</span>
        </a>
      ) : null}
    </div>
  );
}
