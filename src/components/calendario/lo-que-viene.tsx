'use client';

import { CircleCheck } from 'lucide-react';
import * as React from 'react';
import { colorDeOrganismo } from '@/lib/colores';
import type { EventView } from '@/lib/queries/calendar';
import {
  cn,
  formatDateRangeEs,
  organismoDe,
  titular,
  titularTorneo,
} from '@/lib/utils';
import { hoyMadrid } from '@/lib/callups/fechas';

/**
 * LO PRÓXIMO, EN EL SITIO QUE EL MES NO USA.
 *
 * -------------------------------------------------------------------------
 * POR QUÉ EXISTE ESTO
 * -------------------------------------------------------------------------
 * Una tiradora filtrada por su arma y su género ve **una** competición en la
 * mayoría de los meses. Medido en producción: septiembre de espada femenina
 * tiene un torneo, la rejilla acaba a los 190 px y debajo quedaban 121 px de
 * nada en un iPhone y **463 en un escritorio**, con la leyenda descolgada al
 * fondo de la pantalla. Es la queja original del usuario —«no aprovechas nada
 * bien los espacios»— por el otro lado.
 *
 * Y no se arregla estirando: repartir el sobrante entre las filas de la
 * rejilla ya se probó y dejaba un socavón de 480 px dentro del recuadro, que
 * parecía un fallo de dibujado. Una fila de calendario no mejora por ser más
 * alta; lo que mejora es que en ese sitio haya algo que responda a una
 * pregunta.
 *
 * La pregunta, cuando el mes que estás mirando está vacío, es una sola: **¿y
 * entonces cuándo compito?**. Eso es lo que hay aquí: las siguientes
 * competiciones que **no** se ven en la rejilla, con los días que faltan, el
 * plazo y la sede, que es lo que hace falta para pedir días y mirar billetes.
 *
 * Tres condiciones, para que no sea relleno:
 *
 * 1. **No repite nada de lo que ya está en pantalla.** Se excluye lo que cae
 *    dentro de las semanas que pinta la rejilla —que llega hasta el domingo
 *    siguiente al fin de mes— y el torneo del marcador de arriba.
 * 2. **Solo aparece si sobra sitio de verdad.** Quien decide cuántas filas
 *    caben es el hueco medido, no esta lista; con el mes lleno no se pinta.
 * 3. **Ningún dato inventado.** Sin sede publicada dice «sede sin publicar»,
 *    y sin plazo no dice nada: un «cierra pronto» de adorno hace perder
 *    inscripciones.
 */
export function LoQueViene({
  eventos,
  inscripciones,
  onAbrir,
}: {
  eventos: EventView[];
  /** competitionId -> estado, para marcar en qué estás inscrito. */
  inscripciones: Record<string, string>;
  onAbrir: (e: EventView) => void;
}) {
  /* El rótulo nombra la sección para quien navega con lector de pantalla, en
     vez de repetir la frase en un `aria-label`. */
  const idRotulo = React.useId();

  if (eventos.length === 0) return null;

  return (
    <section aria-labelledby={idRotulo} className="flex h-full min-h-0 flex-col gap-1">
      {/*
        El rótulo va con el filete de luz arriba, como la banda del marcador:
        es otra banda de la misma pantalla, no una tarjeta nueva. Y dice lo
        único que hay que aclarar —que esto no es de este mes—, porque si no
        parecería que la rejilla se ha dejado torneos sin pintar.
      */}
      <p
        id={idRotulo}
        className="shrink-0 border-t border-filete pt-1.5 text-xs text-muted-foreground"
      >
        Lo próximo, fuera de este mes
      </p>

      {/*
        `max-w` a la lista y no a la fila: en un escritorio de 1440 la fila
        mide 1288 px y el plazo se iba al otro extremo de la pantalla, a 900
        px del nombre al que se refiere. Acotada, las seis filas forman un
        bloque con su columna de plazos alineada, que es lo que se puede
        recorrer de un vistazo.

        Y el alto de cada fila está acotado por arriba: sin tope, seis filas
        repartiéndose 450 px salían a 75 px cada una y la lista parecía
        estirada para tapar un hueco, que es justo de lo que se venía.
      */}
      <ul className="flex min-h-0 w-full max-w-[46rem] flex-1 flex-col gap-1">
        {eventos.map((evento) => (
          <li key={evento.id} className="flex min-h-11 min-w-0 max-h-14 flex-1">
            <Fila
              evento={evento}
              inscrito={evento.competitions.some((c) => inscripciones[c.id])}
              onAbrir={onAbrir}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Fila({
  evento,
  inscrito,
  onAbrir,
}: {
  evento: EventView;
  inscrito: boolean;
  onAbrir: (e: EventView) => void;
}) {
  const dias = diasHasta(evento.startDate);
  const color = colorDeOrganismo(
    organismoDe(evento.source, evento.scope, evento.circuit),
  );
  const plazo = plazoDelEvento(evento);

  return (
    <button
      type="button"
      onClick={() => onAbrir(evento)}
      /* `text-left`: un `<button>` centra su texto y arrastra a los hijos. */
      /* Sin `objetivo-libre`: esto no es una barra del calendario con el alto
         calculado al píxel, así que se queda con los 44 px de objetivo táctil
         que fuerza `globals.css` para un puntero grueso. */
      className="flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-1 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      /*
        El `aria-label` sustituye al contenido de la fila, así que tiene que
        decirlo TODO: si se queda en el nombre y los días, el plazo y el «ya
        estás inscrito» —que van dentro y se ven— desaparecen para quien usa un
        lector de pantalla.
      */
      aria-label={[
        `Faltan ${dias} ${dias === 1 ? 'día' : 'días'} para ${titularTorneo(evento.name)}`,
        plazo ? plazo.texto : null,
        inscrito ? 'ya estás inscrito' : null,
        'Abrir la ficha.',
      ]
        .filter(Boolean)
        .join('. ')}
    >
      {/* El canto de color del organismo, el mismo de las barras del mes. */}
      <span
        className={cn('h-[1.9rem] w-[3px] shrink-0 rounded-full', color.punto)}
        aria-hidden
      />

      {/*
        El marcador, en pequeño: la cifra grande con la palabra diminuta
        debajo. Es el mismo recurso de jerarquía de la banda de arriba, y es lo
        que hace que esta lista se lea de un vistazo en vez de leerse.
      */}
      <span className="flex min-w-[2.1rem] shrink-0 flex-col items-start leading-none">
        <span className="cifra text-xl text-foreground sm:text-2xl">{dias}</span>
        {/* El mismo `0.65rem` del rótulo de la banda de arriba: dos tamaños
            distintos para la misma palabra se notan aunque no se sepa por qué. */}
        <span className="text-[0.65rem] text-muted-foreground">
          {dias === 1 ? 'día' : 'días'}
        </span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          {/*
            El nombre y el «ya estás inscrito» van en su propia caja para que
            el icono quede **pegado al nombre**. Con el nombre en `flex-1`, la
            caja se estiraba y el icono aparecía flotando en medio de la fila,
            lejos de aquello a lo que se refiere.
          */}
          <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
            <span className="min-w-0 truncate text-sm font-semibold">
              {titularTorneo(evento.name)}
            </span>
            {inscrito ? (
              <CircleCheck
                className="size-3.5 shrink-0 self-center"
                aria-label="Ya estás inscrito"
              />
            ) : null}
          </span>
          {plazo ? (
            <span className={cn('shrink-0 text-xs', plazo.tono)}>{plazo.texto}</span>
          ) : null}
        </span>
        <span className="mt-0.5 flex min-w-0 items-baseline gap-2 text-xs text-muted-foreground">
          {/* Sólida, como la de la banda de arriba: esta lista va sobre el
              lienzo con textura y el alfa la dejaba pasar por dentro. */}
          <span className="cifra shrink-0 rounded-full bg-secondary px-1.5 py-px text-foreground">
            {formatDateRangeEs(evento.startDate, evento.endDate)}
          </span>
          <span className="min-w-0 truncate">
            {evento.city ? titular(evento.city) : 'Sede sin publicar'}
            {evento.country ? `, ${evento.country}` : ''}
          </span>
        </span>
      </span>
    </button>
  );
}

/** Días naturales hasta una fecha ISO. Cero o menos = ya empezó. */
export function diasHasta(iso: string): number {
  /*
    Los dos extremos a mediodía UTC y la resta en milisegundos: así el cambio
    de hora no puede restar ni sumar un día, y «hoy» sale de `hoyMadrid()` en
    vez de las partes locales de `new Date()`, que en el Worker son UTC y en el
    navegador españolas (ver `hoyMadrid`).
  */
  const a = Date.parse(`${hoyMadrid()}T12:00:00Z`);
  const b = Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Cuánto queda de plazo, con su tono del semáforo.
 *
 * Si la fuente no publica plazo **no se dice nada**. Un «cierra pronto»
 * inventado sería peor que el silencio: con eso se pierden inscripciones.
 */
export function plazoDelEvento(
  evento: EventView,
): { texto: string; tono: string } | null {
  const abiertas = evento.competitions.filter((c) => !c.status.closed);
  const dias = abiertas
    .map((c) => c.status.daysLeft)
    .filter((d): d is number => d !== null && d >= 0)
    .sort((a, b) => a - b)[0];

  if (dias === undefined) {
    if (abiertas.length === 0 && evento.competitions.length > 0) {
      return { texto: 'Inscripción cerrada', tono: 'text-muted-foreground' };
    }
    return null;
  }
  if (dias === 0) return { texto: 'la inscripción cierra hoy', tono: 'text-danger' };
  const tono = dias <= 3 ? 'text-danger' : dias <= 10 ? 'text-warn' : 'text-ok';
  return {
    texto: `cierra en ${dias} ${dias === 1 ? 'día' : 'días'}`,
    tono,
  };
}
