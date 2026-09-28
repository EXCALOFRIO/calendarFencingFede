'use client';

import { CircleCheck } from 'lucide-react';
import * as React from 'react';
import { colorDeOrganismo, jerarquiaDeCircuito } from '@/lib/colores';
import type { EventView } from '@/lib/queries/calendar';
import {
  CATEGORY_LABEL,
  GENDER_SHORT,
  cn,
  formatDateRangeEs,
  organismoDe,
  titular,
  titularTorneo,
} from '@/lib/utils';
import { MarcaArma } from './iconos-arma';
import { diasHasta, plazoDelEvento } from './lo-que-viene';
import { hoyMadrid } from '@/lib/callups/fechas';

/**
 * EL MES EN EL MÓVIL: MAPA ARRIBA, AGENDA DEBAJO.
 *
 * -------------------------------------------------------------------------
 * POR QUÉ NO VALE LA REJILLA DE SIETE COLUMNAS EN UN TELÉFONO
 * -------------------------------------------------------------------------
 * Medido en un iPhone 14 Pro (393 px) con la dirección técnica y las tres
 * armas puestas, en noviembre, que es el mes más cargado de la temporada:
 *
 *   alto disponible para el mes ......... 291,8 px
 *   torneos visibles ....................  3
 *   torneos escondidos tras un «+N» ..... 33, en cinco franjas
 *   alto de cada barra .................. 12,8 px  ← el suelo absoluto
 *   nombres cortados .................... «Circuito Europ…»
 *
 * O sea: la rejilla enseñaba **tres competiciones de treinta y seis**, con
 * las barras en el suelo de 12,8 px y cinco franjas de puntos diciendo «+5
 * +9 +6 +2 +6». Eso no es un calendario denso: es un calendario vacío con
 * cinco avisos de que hay algo detrás. Y el nombre, que es lo único que
 * distingue una Copa del Mundo de Samsun de una de San Salvador, no cabe: en
 * una columna de 45 px no cabe **ninguna** abreviatura, porque lo que se come
 * el ancho son las insignias antes que el texto.
 *
 * La regla que se estaba rompiendo está escrita y es de severidad crítica:
 * los **nombres que distinguen** necesitan acceso completo, y la salida es
 * «apilar, envolver o dar un camino visible al detalle». Un `…` en el sitio
 * donde está la única diferencia entre dos filas no informa de nada.
 *
 * -------------------------------------------------------------------------
 * LO QUE SE PONE EN SU LUGAR, Y QUÉ CONSERVA DE LA REJILLA
 * -------------------------------------------------------------------------
 * Dos piezas, y la de arriba existe justamente para no perder lo que la
 * rejilla sí daba:
 *
 * 1. **El mapa del mes** (`MapaMes`): las cinco o seis semanas en 7×N celdas
 *    de 22 px, con el número del día y debajo un filete por competición, del
 *    color de quien organiza. No lleva texto —a 45 px no cabe— así que no
 *    pierde nada: lo que da es **la forma del mes**, que es lo que se echaría
 *    de menos con una agenda sola. De un golpe se ve que el 12 al 15 está
 *    cargado y que del 16 al 22 no hay nada, que es la pregunta de quien
 *    planifica. Cuesta 128 px de los 500 que hay.
 *
 * 2. **La agenda**: las competiciones del mes en tarjetas **a ancho
 *    completo**, en orden. Al nombre le quedan 306 px medidos, y «Liga
 *    Nacional Iberdrola 1ª Jornada» —el nombre más largo de la temporada—
 *    mide 255. Entero, sin abreviar y sin puntos suspensivos.
 *
 * -------------------------------------------------------------------------
 * TRES COSAS QUE SE DESCARTARON
 * -------------------------------------------------------------------------
 * - **La tira de una semana** que proponía la auditoría. Enseña siete días y
 *   pierde justo lo que se viene a buscar: si el mes que viene tengo un fin
 *   de semana libre. El mapa del mes cuesta lo mismo y contesta a eso.
 * - **Agrupar la agenda por días**, con un rótulo de fecha por grupo. Ocho
 *   rótulos son 160 px, y la pastilla de fechas que cada tarjeta ya lleva
 *   dice lo mismo sin gastar un renglón.
 * - **Tocar un día del mapa para saltar a su tarjeta.** Una celda mide 56×22
 *   px, así que serían cuarenta objetivos táctiles pequeños encima de una
 *   lista que ya se recorre con el pulgar. El mapa se queda como resumen y la
 *   agenda es la parte que se toca.
 */

const DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/** Filetes que caben en una celda de 22 px sin apretar el número. */
const FILETES_POR_DIA = 3;

/** La misma tabla que la rejilla: «Absoluto» no cabe en una pastilla. */
const CORTA_CATEGORIA: Record<string, string> = { ABS: 'Abs', VET: 'Vet' };

export function AgendaMes({
  ancla,
  eventos,
  desde,
  hasta,
  fuera,
  inscripciones,
  resaltados,
  proximo,
  mostrarArma,
  mostrarGenero,
  mostrarCategoria,
  onAbrirEvento,
}: {
  ancla: Date;
  /** Ya filtrados por arma, género y categoría. */
  eventos: EventView[];
  /** Primer día del mapa: el lunes anterior al día 1. */
  desde: string;
  /** Último día del mapa: el domingo de la última semana. */
  hasta: string;
  /**
   * Lo próximo que hay **fuera** de este mes. Solo se pinta cuando el mes
   * está flojo: es la misma pregunta que responde `LoQueViene` en el
   * escritorio —«¿y entonces cuándo compito?»— y la misma condición, que solo
   * salga si de verdad hace falta.
   */
  fuera: EventView[];
  inscripciones: Record<string, string>;
  resaltados?: Set<string>;
  proximo?: string | null;
  /**
   * Arma, género y categoría en la tarjeta: solo cuando el filtro abarca más
   * de uno. Es la misma regla que en las barras de la rejilla y por el mismo
   * motivo, medido aquí otra vez: con las tres pastillas puestas, el renglón
   * de datos **envolvía a un segundo renglón en las 36 tarjetas** de noviembre
   * y cada tarjeta pasaba de 48 a 66 px. Para una tiradora de espada femenina
   * absoluto, «ESP F Abs» en cada tarjeta es el 100 % de lo que está mirando:
   * no informa de nada y le cuesta una tarjeta y media de pantalla.
   */
  mostrarArma: boolean;
  mostrarGenero: boolean;
  mostrarCategoria: boolean;
  onAbrirEvento: (e: EventView) => void;
}) {
  const semanas = React.useMemo(
    () => construirMapa(desde, hasta, ancla.getMonth(), eventos),
    [desde, hasta, ancla, eventos],
  );

  /** Lo que se tira en el tramo que pinta el mapa, en orden. */
  const delMes = React.useMemo(
    () =>
      eventos
        .filter((e) => e.startDate <= hasta && e.endDate >= desde)
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name)),
    [eventos, desde, hasta],
  );

  /*
    «Flojo» es medido, no a ojo: por debajo de cuatro tarjetas queda sitio en
    la pantalla de un teléfono, y entonces el hueco se llena con lo próximo
    de fuera del mes en vez de dejarlo en blanco. Con cuatro o más, la agenda
    ya no cabe entera y añadir nada sería empujar el mes hacia arriba.
  */
  const rellena = delMes.length < 4 && fuera.length > 0;

  const nombreDelMes = React.useMemo(
    () =>
      new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(ancla),
    [ancla],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <MapaMes semanas={semanas} nombreDelMes={nombreDelMes} />

      {delMes.length === 0 && fuera.length === 0 ? (
        <p className="shrink-0 rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
          Ninguna competición en {nombreDelMes} con estos filtros. Pasa de mes
          con las flechas o abre los filtros.
        </p>
      ) : (
        /*
          DOS CAPAS, Y POR EL MISMO MOTIVO QUE LA REJILLA.

          Primera versión: la lista en el flujo normal con `flex-1 min-h-0
          overflow-y-auto`. Medido en un iPhone: **la página pasó a medir 3135
          px**. La lista no se recortaba, crecía, y con ella el documento; el
          mapa del mes se iba hacia arriba al desplazarse y la leyenda acababa
          a tres pantallas de distancia.

          La causa es la misma que ya está explicada en `rejilla-mes.tsx`: el
          armazón de la aplicación es `min-h-dvh`, no `h-dvh`, así que la
          altura del contenedor es indefinida y un `flex-1` con `overflow`
          dentro no recorta nada —crece—. La rejilla lo resolvió con una capa
          `relative` que mide y una `absolute inset-0` dentro, que no puede
          estirar a su padre. Aquí vale igual y no hace falta inventar nada:
          el mapa se queda quieto arriba y **la lista se desplaza dentro de su
          hueco**, que es lo que hace cualquier calendario de teléfono.

          `overscroll-contain` para que al llegar al final no arrastre la
          página entera, que es el tirón que hace que una lista dentro de otra
          se sienta rota.
        */
        <div className="relative min-h-0 flex-1">
          <ol className="absolute inset-0 flex flex-col gap-1.5 overflow-y-auto overscroll-contain">
            {delMes.map((evento) => (
              /*
                `content-visibility: auto` con su tamaño de reserva: octubre
                tiene 48 tarjetas y la guía de interfaz pide no pintar listas
                largas de golpe. Con el tamaño reservado el desplazamiento no
                salta, que es el fallo típico de hacerlo sin él.
              */
              <li
                key={evento.id}
                className="[content-visibility:auto] [contain-intrinsic-size:auto_3rem]"
              >
                <TarjetaAgenda
                  evento={evento}
                  inscrito={evento.competitions.some((c) => inscripciones[c.id])}
                  resaltado={resaltados?.has(evento.id) ?? false}
                  atenuado={Boolean(resaltados?.size) && !resaltados?.has(evento.id)}
                  esProximo={evento.id === proximo}
                  mostrarArma={mostrarArma}
                  mostrarGenero={mostrarGenero}
                  mostrarCategoria={mostrarCategoria}
                  onAbrir={onAbrirEvento}
                />
              </li>
            ))}

            {rellena ? (
              <>
                {/* El mismo rótulo con filete de luz que en el escritorio:
                    dice que esto ya no es de este mes, porque si no parecería
                    que la agenda se ha dejado torneos dentro. */}
                <li className="border-t border-filete pt-1.5 text-xs text-muted-foreground">
                  Lo próximo, fuera de este mes
                </li>
                {fuera.map((evento) => (
                  <li key={evento.id}>
                    <TarjetaAgenda
                      evento={evento}
                      inscrito={evento.competitions.some((c) => inscripciones[c.id])}
                      resaltado={false}
                      atenuado={false}
                      esProximo={evento.id === proximo}
                      mostrarArma={mostrarArma}
                      mostrarGenero={mostrarGenero}
                      mostrarCategoria={mostrarCategoria}
                      onAbrir={onAbrirEvento}
                    />
                  </li>
                ))}
              </>
            ) : null}
          </ol>
        </div>
      )}
    </div>
  );
}

type DiaMapa = {
  iso: string;
  dia: number;
  delMes: boolean;
  esHoy: boolean;
  pasado: boolean;
  /** Un filete por competición del día, con la clase de color de su organismo. */
  filetes: string[];
  /** Cuántas hay en total, que puede pasar de los filetes que caben. */
  cuantas: number;
};

function construirMapa(
  desde: string,
  hasta: string,
  /** El mes que se está mirando, 0-11. Los días de fuera se apagan. */
  mes: number,
  eventos: EventView[],
): DiaMapa[][] {
  // Hoy en hora española, no en la del que ejecuta: ver `hoyMadrid`.
  const hoy = hoyMadrid();

  const dias: DiaMapa[] = [];
  for (const d = new Date(`${desde}T12:00:00`); isoLocal(d) <= hasta; d.setDate(d.getDate() + 1)) {
    const iso = isoLocal(d);
    const delDia = eventos.filter((e) => e.startDate <= iso && e.endDate >= iso);
    dias.push({
      iso,
      dia: d.getDate(),
      delMes: d.getMonth() === mes,
      esHoy: iso === hoy,
      pasado: iso < hoy,
      filetes: delDia
        .slice(0, FILETES_POR_DIA)
        .map((e) => colorDeOrganismo(organismoDe(e.source, e.scope, e.circuit)).punto),
      cuantas: delDia.length,
    });
  }

  const semanas: DiaMapa[][] = [];
  for (let i = 0; i < dias.length; i += 7) semanas.push(dias.slice(i, i + 7));
  return semanas;
}

/**
 * EL MAPA DEL MES: la forma, sin una letra.
 *
 * Es lo que la agenda sola no da. No intenta ser la rejilla en pequeño: no
 * hay nombres, ni insignias, ni plazos, porque a 45 px de columna no caben y
 * fingir que sí es lo que producía «C. Mun… / C. Mun…». Lo que hay es el
 * número del día y **un filete por competición**, del color de quien
 * organiza: con eso se lee de un golpe dónde está la carga del mes y qué
 * semanas están libres.
 *
 * Va con su tabla accesible por debajo —la lista de la agenda— así que el
 * mapa se anuncia como resumen y no obliga a nadie a descifrar puntos.
 */
function MapaMes({ semanas, nombreDelMes }: { semanas: DiaMapa[][]; nombreDelMes: string }) {
  const idRotulo = React.useId();
  const total = semanas.flat().reduce((n, d) => n + (d.cuantas > 0 ? 1 : 0), 0);

  return (
    <section aria-labelledby={idRotulo} className="shrink-0">
      <h2 id={idRotulo} className="sr-only">
        Mapa de {nombreDelMes}: {total} {total === 1 ? 'día' : 'días'} con competición
      </h2>

      {/* Cabecera de días: la misma convención que la rejilla —superficie,
          filete, negrita y el fin de semana destacado— y unida al recuadro
          con `rounded-t-lg` y `border-b-0`. */}
      <div
        className="grid grid-cols-7 rounded-t-lg border border-b-0 border-border/50 bg-card pt-1 pb-1"
        aria-hidden
      >
        {DIAS.map((d, i) => (
          <div
            key={d}
            className={cn(
              'text-center text-[0.7rem] font-semibold leading-none',
              i >= 5 ? 'text-foreground/85' : 'text-muted-foreground',
            )}
          >
            {d}
          </div>
        ))}
      </div>

      <div
        className="overflow-hidden rounded-b-lg border border-t-0 border-border/50 bg-card"
        aria-hidden
      >
        {semanas.map((semana, s) => (
          <div
            key={semana[0].iso}
            className={cn('grid grid-cols-7', s < semanas.length - 1 && 'border-b border-border/40')}
          >
            {semana.map((d, col) => (
              <div
                key={d.iso}
                className={cn(
                  'flex h-[22px] flex-col items-center justify-center gap-[3px]',
                  col < 6 && 'border-r border-border/25',
                  !d.delMes && 'bg-background',
                  d.pasado && !d.esHoy && 'opacity-45',
                  d.esHoy && 'bg-secondary',
                )}
              >
                <span
                  className={cn(
                    'cifra text-[0.68rem] leading-none',
                    d.esHoy
                      ? 'font-semibold text-primary-text'
                      : !d.delMes
                        ? 'text-muted-foreground/40'
                        : d.cuantas > 0
                          ? 'text-foreground'
                          : 'text-muted-foreground/70',
                  )}
                >
                  {d.dia}
                </span>
                {/* Los filetes, del color de quien organiza. Alto fijo para
                    que un día con tres y uno con cero midan lo mismo: si la
                    celda creciera, la forma del mes dejaría de leerse como
                    una rejilla. */}
                <span className="flex h-[3px] items-center gap-[2px]">
                  {d.filetes.map((clase, i) => (
                    <span
                      key={`${d.iso}-${i}`}
                      className={cn('h-[3px] w-[5px] rounded-full', clase)}
                    />
                  ))}
                  {d.cuantas > FILETES_POR_DIA ? (
                    <span className="h-[3px] w-[3px] rounded-full bg-foreground/50" />
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Una competición, a ancho completo.
 *
 * El reparto es el de la casa: la cifra grande con la palabra diminuta al
 * lado —los días que faltan— y a su derecha el nombre **entero**, que es lo
 * que no cabía en la rejilla. Debajo, en un solo renglón, lo que hace falta
 * para decidir: quién organiza, de qué es, cuándo, dónde y cuánto queda de
 * plazo.
 */
function TarjetaAgenda({
  evento,
  inscrito,
  resaltado,
  atenuado,
  esProximo,
  mostrarArma,
  mostrarGenero,
  mostrarCategoria,
  onAbrir,
}: {
  evento: EventView;
  inscrito: boolean;
  resaltado: boolean;
  atenuado: boolean;
  esProximo: boolean;
  mostrarArma: boolean;
  mostrarGenero: boolean;
  mostrarCategoria: boolean;
  onAbrir: (e: EventView) => void;
}) {
  const dias = diasHasta(evento.startDate);
  const enMarcha = dias <= 0;
  const organismo = organismoDe(evento.source, evento.scope, evento.circuit);
  const color = colorDeOrganismo(organismo);
  const plazo = plazoDelEvento(evento);
  const jerarquia = jerarquiaDeCircuito(evento.circuit);

  const armas = [...new Set(evento.competitions.map((c) => c.weapon))];
  const generos = ['M', 'F', 'MIXTO'].filter((g) =>
    evento.competitions.some((c) => c.gender === g),
  );
  const categorias = [...new Set(evento.competitions.map((c) => c.category))];

  return (
    <button
      type="button"
      /*
        El identificador va en el marcado a propósito: es lo que deja contar
        desde fuera **a cuántos torneos distintos se puede llegar**, que es el
        criterio que se nos escapó cuando el móvil enseñaba 7 de 39. Contarlo
        por el nombre no vale: en octubre hay seis «Copa del Mundo» y se
        distinguen por la sede.
      */
      data-agenda="tarjeta"
      data-evento={evento.id}
      onClick={() => onAbrir(evento)}
      className={cn(
        /*
          Superficie sólida y el color del organismo en el canto, no en el
          relleno. Es la misma decisión que en las barras de la rejilla: el
          relleno de color con el nombre encima se leía como «estado
          desactivado», y aquí hay más sitio todavía para que el nombre vaya
          en blanco sobre gris, que es donde el contraste está medido.
        */
        'flex w-full min-w-0 cursor-pointer items-stretch gap-0 overflow-hidden rounded-md border border-border/50 bg-card text-left transition-colors',
        'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        inscrito && 'border-foreground/35',
        esProximo && !inscrito && 'border-foreground/25',
        resaltado && 'ring-2 ring-inset ring-foreground',
        atenuado && 'opacity-40',
      )}
      aria-label={[
        enMarcha
          ? `${titularTorneo(evento.name)}, en marcha`
          : `Faltan ${dias} ${dias === 1 ? 'día' : 'días'} para ${titularTorneo(evento.name)}`,
        plazo ? plazo.texto : null,
        inscrito ? 'ya estás inscrito' : null,
        'Abrir la ficha.',
      ]
        .filter(Boolean)
        .join('. ')}
    >
      {/* El canto de color de quien organiza, a todo el alto de la tarjeta. */}
      <span className={cn('w-[3px] shrink-0', color.punto)} aria-hidden />

      <span className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1">
        {/* El marcador: la cifra manda y la palabra acompaña. */}
        <span className="flex min-w-[2.2rem] shrink-0 flex-col items-start leading-none">
          {enMarcha ? (
            <>
              <span className="cifra text-lg leading-none text-primary-text">Ahora</span>
              <span className="text-[0.6rem] leading-none text-muted-foreground">en marcha</span>
            </>
          ) : (
            <>
              <span className="cifra text-xl leading-none text-foreground">{dias}</span>
              <span className="text-[0.6rem] leading-none text-muted-foreground">
                {dias === 1 ? 'día' : 'días'}
              </span>
            </>
          )}
        </span>

        <span className="min-w-0 flex-1">
          {/*
            EL NOMBRE ENTERO, QUE ES TODO EL MOTIVO DE ESTA PANTALLA.
            306 px medidos para el texto y 255 el nombre más largo de la
            temporada. `line-clamp-2` es el guarda para un nombre que algún
            día venga más largo de la fuente: envolver se entiende, y dos
            líneas caben en la tarjeta.
          */}
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span
              className={cn(
                'min-w-0 flex-1 text-sm leading-tight text-foreground',
                jerarquia === 1 ? 'font-bold' : jerarquia === 4 ? 'font-medium' : 'font-semibold',
                'line-clamp-2',
              )}
            >
              {titularTorneo(evento.name)}
            </span>
            {inscrito ? (
              <CircleCheck className="size-3.5 shrink-0 self-center" aria-label="Ya estás inscrito" />
            ) : null}
            {plazo ? (
              <span className={cn('shrink-0 text-[0.7rem]', plazo.tono)}>{plazo.texto}</span>
            ) : null}
          </span>

          {/*
            LA SEDE NO COMPITE CON LAS INSIGNIAS, Y ESTO ERA UN FALLO MÍO.

            Primera versión de la tarjeta: la sede iba al final del renglón,
            en `flex-1 truncate`, detrás de la pastilla del organismo, las
            armas, los géneros, las categorías y la fecha —todos `shrink-0`—.
            Resultado medido en un iPhone: **las 36 tarjetas del mes con la
            sede cortada**. O sea que había arreglado el nombre y reventado
            justo el otro dato que distingue una tarjeta de otra: en noviembre
            hay siete «Copa del Mundo Cadete» y lo que las separa es Manama,
            Budapest, Dormagen o Aix.

            Ahora la sede va **primera y sin encoger**, y las insignias
            envuelven detrás. Envolver cuesta un renglón cuando de verdad no
            caben, y solo entonces; cortar cuesta el dato siempre. Y se cae el
            circuito, que era el que sobraba: «Copa del Mundo Cadete» con la
            etiqueta «C. Mundo Cadete» al lado es la misma frase dos veces, y
            quién organiza ya lo dice su pastilla.
          */}
          {/*
            `text-[0.65rem]` EN EL CONTENEDOR, Y ESTO ERA UN DESCUIDO VISIBLE.

            `MarcaArma` por debajo de 22 px pinta la abreviatura con un `<abbr
            className="font-bold uppercase">` que **no lleva tamaño**: hereda.
            En la rejilla siempre hereda de un `span` con su `text-[0.7rem]`,
            así que nunca se notó; aquí heredaba del texto base y «ESP» y «SAB»
            salían a 18 px en negrita, más grandes que el nombre del torneo y
            del doble de alto que las pastillas de al lado. Se ve en
            `capturas/arq/despues-cargado-iphone.png`: la insignia del arma era
            lo que más pesaba de la tarjeta. Con el tamaño puesto en el
            renglón, todas las insignias miden lo mismo y la tercera línea
            deja de aparecer.
          */}
          <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.65rem] leading-[1.35]">
            <span className="shrink-0 text-[0.7rem] text-foreground/90">
              {evento.city ? titular(evento.city) : 'Sede sin publicar'}
              {evento.country ? `, ${evento.country}` : ''}
            </span>
            <span className="cifra shrink-0 rounded-full bg-secondary px-1.5 py-px text-[0.7rem] text-foreground">
              {formatDateRangeEs(evento.startDate, evento.endDate)}
            </span>
            <Insignia clase={cn(color.punto, 'text-background')}>{color.corto}</Insignia>
            {mostrarArma ? (
              <MarcaArma armas={armas} px={14} className="text-foreground/90" />
            ) : null}
            {mostrarGenero
              ? generos.map((g) => (
                  <Insignia key={g}>{GENDER_SHORT[g as keyof typeof GENDER_SHORT]}</Insignia>
                ))
              : null}
            {mostrarCategoria
              ? categorias
                  .slice(0, 2)
                  .map((c) => (
                    <Insignia key={c}>
                      {CORTA_CATEGORIA[c] ?? CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL] ?? c}
                    </Insignia>
                  ))
              : null}
          </span>
        </span>
      </span>
    </button>
  );
}

/** La misma pastilla de la rejilla: sólida, sin alfa, `cifra` y apretada. */
function Insignia({ children, clase }: { children: React.ReactNode; clase?: string }) {
  return (
    <span
      className={cn(
        'cifra shrink-0 rounded-[3px] px-1 py-px text-[0.65rem] leading-[1.25] tracking-tight',
        clase ?? 'bg-secondary text-secondary-foreground',
      )}
    >
      {children}
    </span>
  );
}

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}
