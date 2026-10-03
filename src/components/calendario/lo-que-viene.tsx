'use client';

import * as React from 'react';
import { agruparEnBloques } from '@/lib/calendario/bloques';
import type { EventView } from '@/lib/queries/calendar';
import { cn } from '@/lib/utils';
import { hoyMadrid } from '@/lib/callups/fechas';
import { TarjetaBloque, type VarianteTarjeta } from './tarjeta-bloque';

/**
 * LO PRÓXIMO, EN EL SITIO QUE EL MES NO USA.
 *
 * Y ES LA MISMA TARJETA QUE EL CALENDARIO, NO UNA TERCERA
 * -------------------------------------------------------------------------
 * Esto tenía su propio maquetado: una fila con la cifra de los días en grande,
 * el nombre, la sede y el plazo. Era el **tercer** estilo de evento de la
 * aplicación, detrás de la barra de la rejilla y de la tarjeta de la agenda, y
 * eso es exactamente la mecánica de la queja del usuario: *«es como una
 * interfaz muy poco cuidada»*. No es que ninguno estuviera mal; es que eran
 * tres.
 *
 * Ahora pinta `TarjetaBloque`, la misma del calendario, con la misma variante
 * que la vista que tiene encima. Lo único propio que queda es el rótulo, que
 * es lo único que esta sección tiene que decir: que esto **no** es de este mes.
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
  variante,
  enRejilla = false,
  inscripciones,
  onAbrir,
}: {
  eventos: EventView[];
  /** La misma que la del calendario que hay encima. */
  variante: VarianteTarjeta;
  /**
   * En tres columnas en vez de en una.
   *
   * Es para la vista de trimestre, donde esta sección va **debajo** de los
   * tres meses y a lo ancho de la página. En una sola columna, las tarjetas
   * medirían los 1288 px de la página y el plazo acabaría a 900 px del nombre
   * del torneo del que habla, que es el fallo que el usuario rodeó con un
   * círculo. En tres, cada una mide lo mismo que una columna de mes y la
   * sección se lee como la continuación del calendario que tiene encima.
   */
  enRejilla?: boolean;
  /** competitionId -> estado, para marcar en qué estás inscrito. */
  inscripciones: Record<string, string>;
  onAbrir: (e: EventView) => void;
}) {
  /* El rótulo nombra la sección para quien navega con lector de pantalla, en
     vez de repetir la frase en un `aria-label`. */
  const idRotulo = React.useId();
  const bloques = React.useMemo(() => agruparEnBloques(eventos), [eventos]);
  const vacio = React.useMemo(() => new Set<string>(), []);

  if (eventos.length === 0) return null;

  return (
    <section aria-labelledby={idRotulo} className="flex min-h-0 flex-col gap-1.5">
      {/*
        El rótulo va con el filete de luz arriba, como la banda del marcador:
        es otra banda de la misma pantalla, no una tarjeta nueva. Y dice lo
        único que hay que aclarar —que esto no es de este mes—, porque si no
        parecería que el calendario se ha dejado torneos sin pintar.
      */}
      <p
        id={idRotulo}
        className="shrink-0 border-t border-filete pt-1.5 text-xs text-muted-foreground"
      >
        Lo próximo, fuera de este mes
      </p>

      <ul
        className={cn(
          'min-w-0',
          enRejilla ? 'grid gap-x-4 lg:grid-cols-3' : 'flex flex-col',
        )}
      >
        {bloques.map((bloque) => (
          <li key={bloque.clave}>
            <TarjetaBloque
              bloque={bloque}
              variante={variante}
              inscripciones={inscripciones}
              /*
                Aquí no se resalta nada ni se marca «lo próximo»: el resaltado
                de la búsqueda salta al mes del torneo, y el marcador de arriba
                excluye a propósito su propio evento de esta lista para no
                enseñarlo dos veces en la misma pantalla.
              */
              resaltados={vacio}
              proximo={null}
              /*
                Arma, género y categoría SIEMPRE en esta lista, aunque el filtro
                sea de una sola. Esto no es el mes que se está mirando: son
                torneos de dentro de dos meses, y el contexto que da la cabecera
                («Florete M») queda muy arriba.
              */
              mostrarArma
              mostrarGenero
              mostrarCategoria
              onAbrir={onAbrir}
            />
          </li>
        ))}
      </ul>
    </section>
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
