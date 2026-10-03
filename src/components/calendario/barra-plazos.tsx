import type { ComputedDeadline, DeadlineStatus } from '@/lib/deadlines';
import { cn, formatEur } from '@/lib/utils';

/**
 * ===========================================================================
 * EL PLAZO, DIBUJADO
 * ===========================================================================
 *
 * Antes esto era una cifra enorme —«6 días»— y debajo una lista de hitos con
 * su fecha. Se sabía cuánto faltaba, pero no lo que de verdad se pregunta
 * alguien que llega tarde: **¿en qué tramo estoy y qué me cuesta a partir de
 * aquí?** Eso estaba repartido entre tres líneas de texto y había que
 * reconstruirlo mentalmente.
 *
 * Así que el plazo se dibuja. Una barra con un tramo por ventana, el tramo en
 * el que estás encendido y los demás apagados, y el importe dentro del tramo
 * que lo tiene. La cifra de días sigue estando, pero pequeña y al lado: es el
 * detalle, no el titular.
 *
 * POR QUÉ LA BARRA NO ES UN EJE DE TIEMPO
 * ---------------------------------------
 * Es un esquema, como el plano de un metro: todos los tramos miden parecido y
 * las fechas van escritas en las paradas. Se probó proporcional al tiempo real
 * y no vale, por los dos extremos:
 *
 *   - En lo nacional las ventanas son de 3 días, 1 día y 1 día. Proporcional,
 *     las dos últimas —las caras, las que hay que ver— quedaban en cuatro
 *     píxeles en un móvil.
 *   - En lo internacional el plazo ordinario abre meses antes. Proporcional,
 *     todo lo demás se aplastaba contra el borde derecho.
 *
 * Un esquema con las fechas escritas no engaña a nadie y se lee a 360 px, que
 * es donde se mira esto. Lo que sí es proporcional de verdad es la posición de
 * la marca de HOY dentro de su propio tramo.
 *
 * LAS VENTANAS, Y POR QUÉ SON N+1
 * -------------------------------
 * `deadline_rule.surcharge_eur` es *lo que cuesta una vez que ese hito ha
 * vencido*. O sea que cada hito abre una ventana, y antes del primero hay una
 * más: la ventana en la que todavía no cuesta nada, que es donde debería estar
 * todo el mundo. Tres hitos son cuatro tramos.
 */

type Props = {
  plazos: ComputedDeadline[];
  estado: DeadlineStatus;
  /**
   * Escribir el estado debajo de la barra.
   *
   * Por defecto sí, porque el contrato de diseño dice que un estado no se
   * comunica solo por color y quien use lector de pantalla no ve la barra. La
   * ficha del torneo lo apaga cuando el estado ya está escrito —con su palabra
   * y su color— en el marcador de la banda: la misma frase dos veces en cuatro
   * centímetros no informa, ocupa. Lo que nunca se apaga es el aviso de las
   * fechas estimadas, que es otra cosa.
   */
  conEstado?: boolean;
};

type Tramo = {
  /** Qué cuesta inscribirse DENTRO de este tramo. Null = nada. */
  importe: string | null;
  /** El hito que lo cierra. Null en el último, que ya no cierra con fecha. */
  cierra: ComputedDeadline | null;
  estado: 'pasado' | 'actual' | 'futuro';
  /** Solo en el tramo actual: 0–1, dónde cae hoy dentro de él. */
  avance: number | null;
};

const PINTA: Record<'pasado' | 'actual' | 'futuro', { barra: string; texto: string }> = {
  // Lo ya vencido se apaga: está ahí para situarte, no para leerlo.
  pasado: { barra: 'bg-muted-foreground/25', texto: 'text-muted-foreground' },
  actual: { barra: 'bg-current', texto: '' },
  futuro: { barra: 'bg-muted-foreground/15', texto: 'text-muted-foreground' },
};

/** El color del tramo encendido sale del semáforo, que ya lo decide una vez. */
const TONO_ESTADO: Record<DeadlineStatus['state'], string> = {
  verde: 'text-ok',
  ambar: 'text-warn',
  rojo: 'text-danger',
  cerrado: 'text-muted-foreground',
  sin_datos: 'text-muted-foreground',
};

function construirTramos(plazos: ComputedDeadline[], ahora: Date): Tramo[] {
  const ordenados = [...plazos].sort(
    (a, b) => a.deadlineAt.getTime() - b.deadlineAt.getTime(),
  );

  // Una ventana por hito, más la de antes del primero.
  const importes: (string | null)[] = [
    null,
    ...ordenados.map((d) => d.surchargeEur),
  ];
  const cierres: (ComputedDeadline | null)[] = [...ordenados, null];

  const indiceActual = ordenados.findIndex(
    (d) => d.deadlineAt.getTime() > ahora.getTime(),
  );
  // Si ninguno queda por vencer, el tramo vivo es el último.
  const actual = indiceActual === -1 ? ordenados.length : indiceActual;

  return importes.map((importe, i) => {
    const cierra = cierres[i];
    const estado = i < actual ? 'pasado' : i === actual ? 'actual' : 'futuro';

    let avance: number | null = null;
    if (estado === 'actual' && cierra) {
      // Desde el hito anterior (o el propio arranque) hasta el que lo cierra.
      const abre = i === 0 ? null : ordenados[i - 1].deadlineAt.getTime();
      const cierraEn = cierra.deadlineAt.getTime();
      if (abre !== null && cierraEn > abre) {
        avance = (ahora.getTime() - abre) / (cierraEn - abre);
      } else {
        /**
         * El primer tramo no tiene apertura: empieza «desde siempre». Se toma
         * la última semana como referencia para que la marca se despegue del
         * borde solo cuando el cierre está de verdad encima, que es cuando
         * mirarla sirve para algo.
         */
        const semana = 7 * 86_400_000;
        avance = Math.max(0, 1 - (cierraEn - ahora.getTime()) / semana);
      }
      avance = Math.min(1, Math.max(0, avance));
    }

    return { importe, cierra, estado, avance };
  });
}

/** «mar 29 sept · 23:59», y sin la hora cuando es el final del día. */
function fechaHito(d: Date): { dia: string; hora: string | null } {
  const dia = new Intl.DateTimeFormat('es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Madrid',
  }).format(d);
  const hora = new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
  }).format(d);
  return { dia, hora: hora === '23:59' ? null : hora };
}

export function BarraPlazos({ plazos, estado, conEstado = true }: Props) {
  if (plazos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        La fuente no publica plazo para esta prueba.
      </p>
    );
  }

  const tramos = construirTramos(plazos, new Date());
  const tono = TONO_ESTADO[estado.state];
  const grita = estado.state === 'rojo' || estado.state === 'cerrado';

  return (
    <div className={cn('flex flex-col gap-2', tono)}>
      {/*
        La barra. Los tramos van en una rejilla de fracciones iguales, con el
        de «cerrado» a media anchura: existe para que se vea que la escalera
        termina, no para compararlo con los demás.
      */}
      <div
        className="grid gap-[3px]"
        /*
          La cola de «cerrado» lleva ancho MÍNIMO además de su media fracción.
          Con `0.5fr` a secas, en un iPhone la columna se quedaba en 45 px y la
          palabra «cerrado» —que va alineada a la derecha, como todas— acababa
          pegada a la fecha del tramo anterior: se leía «sáb, 24 octcerrado».
          Medido en la captura, no deducido.
        */
        style={{
          gridTemplateColumns: tramos
            .map((t) => (t.cierra ? 'minmax(0, 1fr)' : 'minmax(3.5rem, 0.5fr)'))
            .join(' '),
        }}
      >
        {tramos.map((t, i) => {
          const pinta = PINTA[t.estado];
          const { dia, hora } = t.cierra
            ? fechaHito(t.cierra.deadlineAt)
            : { dia: 'cerrado', hora: null };

          return (
            <div
              key={t.cierra?.type ?? 'cierre'}
              className="flex min-w-0 flex-col gap-1"
            >
              {/* Importe del tramo, encima de su trozo de barra. */}
              <div
                data-plazo="importe"
                className={cn(
                  'break-words text-[0.68rem] leading-tight font-medium tabular-nums sm:text-xs',
                  t.estado === 'pasado'
                    ? 'text-muted-foreground'
                    : t.estado === 'actual'
                      ? ''
                      : 'text-muted-foreground',
                )}
              >
                {/*
                  Un recargo de cero NO es un recargo. El circuito europeo
                  publica `surcharge_eur = 0.00` en sus hitos, y la barra
                  pintaba «+0 €» encima de tres tramos seguidos: tres cifras
                  que no dicen nada al lado de la única que sí dice algo, la
                  del tramo que cuesta dinero. Se dice lo mismo que en el
                  primero: dentro de este tramo no cuesta más.
                */}
                {t.importe !== null && Number(t.importe) > 0
                  ? `+${formatEur(t.importe)}`
                  : i === 0
                    ? 'sin recargo'
                    : /* La cola de «cerrado» ya se explica sola; un guion
                         encima solo parecería un dato que falta. */
                      ' '}
              </div>

              {/* El trozo de barra, con la marca de hoy dentro si toca. */}
              <div
                className={cn(
                  'relative h-2 overflow-hidden rounded-full',
                  pinta.barra,
                )}
              >
                {t.avance !== null ? (
                  /*
                    Dónde cae HOY dentro de su tramo. Es lo único de la barra
                    que sí es proporcional al tiempo real.
                    El desplazamiento va acotado a los bordes: con `left: -1.5px`
                    la mitad de la marca quedaba recortada por el `overflow` y
                    parecía el remate redondeado de la barra, no una marca.
                  */
                  <span
                    aria-hidden
                    className="absolute inset-y-0 w-[3px] rounded-full bg-background/90"
                    style={{
                      left: `clamp(0px, calc(${(t.avance * 100).toFixed(1)}% - 1.5px), calc(100% - 3px))`,
                    }}
                  />
                ) : null}
              </div>

              {/*
                La parada, alineada a la DERECHA a propósito: es la fecha en la
                que se cierra este tramo, así que va en el borde que cierra. Con
                la fecha centrada bajo su trozo parecía la fecha «del tramo», y
                entonces «vie 2 oct» se leía como el día en que empieza a costar
                dinero en vez del último día en que es gratis.
              */}
              <div
                className={cn(
                  'flex min-w-0 flex-col items-end pl-1.5 text-right text-[0.68rem] leading-tight tabular-nums sm:text-xs',
                  t.estado === 'pasado'
                    ? 'text-muted-foreground'
                    : 'text-muted-foreground',
                )}
              >
                {/*
                  Un plazo DEDUCIDO de la normativa no se pinta igual que uno
                  PUBLICADO por la federación: va subrayado de puntos, y debajo
                  se explica qué significa el subrayado. Es la misma regla que
                  el resto de la aplicación —dato publicado y dato calculado
                  nunca se presentan igual— y aquí importa especialmente,
                  porque en lo nacional la fuente publica el cierre ordinario y
                  los dos límites de agregación salen de la circular.
                */}
                <span
                  data-plazo="fecha"
                  className={cn(
                    'max-w-full break-words',
                    t.cierra?.origin === 'CALCULADO' &&
                      'underline decoration-dotted decoration-from-font underline-offset-2',
                  )}
                >
                  {dia}
                </span>
                {hora ? <span data-plazo="hora" className="max-w-full break-words">{hora}</span> : null}
              </div>
            </div>
          );
        })}
      </div>

      {/*
        El mismo estado, escrito. No se quita nunca: el contrato de diseño dice
        que un estado no se comunica solo por color, y quien use lector de
        pantalla no ve la barra.
        Lo que sí cambia es el peso. Cuando todo va bien la barra ya lo cuenta y
        la frase sobra como titular, así que se queda en letra pequeña. Cuando
        hay un problema —cerrado, o un plazo vencido sin cierre publicado— la
        frase es la información y manda ella.
      */}
      {/*
        Cuando la ficha ya escribe el estado en su marcador, aquí solo queda lo
        que el marcador NO puede decir: qué significa el subrayado de puntos. Y
        si hay un problema, la frase vuelve entera, porque entonces es la
        información y no el adorno.
      */}
      {conEstado || estado.hasEstimates ? (
        <p
          className={cn(
            'text-xs text-muted-foreground',
            conEstado && grita && 'text-sm font-medium text-current sm:text-xs',
          )}
        >
          {conEstado ? estado.label : null}
          {estado.hasEstimates ? (
            <span className="text-muted-foreground">
              {/*
                Sin la frase de estado delante, esto abre la línea y abre con
                mayúscula.

                Y dice «subrayadas de puntos», no «de puntos» a secas: en una
                aplicación de esgrima **«puntos» son los del ranking**, así que
                «las fechas de puntos» se leía como si hablara de la
                puntuación. Visto en la captura de la ficha, no deducido.
              */}
              {conEstado ? '. Las ' : 'Las '}
              fechas subrayadas de puntos son estimadas según la normativa, no
              publicadas
            </span>
          ) : null}
        </p>
      ) : null}

      {/*
        De qué circular sale el importe. Sin esto, «+15 €» es una cifra que
        alguien se ha inventado; con el documento delante, es una norma.
      */}
      {plazos[0]?.sourceDocument ? (
        <p className="text-xs text-muted-foreground">
          {plazos[0].sourceUrl ? (
            <a
              href={plazos[0].sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-dotted underline-offset-2 hover:text-foreground"
            >
              {plazos[0].sourceDocument}
            </a>
          ) : (
            plazos[0].sourceDocument
          )}
        </p>
      ) : null}
    </div>
  );
}
