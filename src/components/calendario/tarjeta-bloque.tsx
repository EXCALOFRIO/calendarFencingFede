'use client';

import { CalendarClock, Check, MapPin } from 'lucide-react';
import * as React from 'react';
import { BanderaPais } from '@/components/bandera';
import { EtiquetaArma } from '@/components/calendario/iconos-arma';
import {
  LETRAS_SEMANA,
  capsulaDeFecha,
  diasSemanaOcupados,
  esEntreSemana,
  type Bloque,
} from '@/lib/calendario/bloques';
import {
  armasDe,
  categoriasDe,
  generosDe,
  pastillaDeCircuito,
  plazoDe,
  sedeDe,
} from '@/lib/calendario/rotulos';
import { colorDeOrganismo, type ColorOrganismo } from '@/lib/colores';
import type { EventView } from '@/lib/queries/calendar';
import { cn, organismoDe, titularTorneo } from '@/lib/utils';

/**
 * ===========================================================================
 * LA TARJETA MAESTRA: UN SOLO CONTENEDOR PARA TODOS LOS EVENTOS
 * ===========================================================================
 *
 * QUÉ PROBLEMA RESUELVE
 * ---------------------------------------------------------------------------
 * Había **tres** estilos de evento conviviendo en la misma aplicación: la
 * barra de la rejilla del mes, la tarjeta de la agenda del móvil y la fila de
 * «lo próximo». Tres formas para la misma cosa, y esa es exactamente la
 * mecánica de la queja que el usuario repite: *«es como una interfaz muy poco
 * cuidada»*. No es que ninguna estuviera mal; es que eran tres.
 *
 * Aquí hay una. Una caja redondeada (`rounded-lg`), superficie de nivel 1
 * (`--card`, `REFERENCIAS.md` §1) y **dos zonas separadas por un filete
 * vertical**, no la fecha flotando fuera de la tarjeta:
 *
 *   ┌─┬──────────┬──────────────────────────────────────────┐
 *   │▌│  03 - 04 │ Eurofence League Barcelona    ✓ Inscrito │
 *   │▌│    OCT   │ 📍 Barcelona, ES  ·  [FIE · Copa Mundo]  │
 *   │▌│ SÁB-DOM  │ FLO · M F · Abs      Cierra en 12 días   │
 *   │▌│ LMXJV·S·D│                                          │
 *   └─┴──────────┴──────────────────────────────────────────┘
 *    ↑  cápsula     cuerpo
 *    filete del organismo, 3 px
 *
 * NADA DE TRANSPARENCIAS, Y ESTO NO ES NEGOCIABLE
 * ---------------------------------------------------------------------------
 * La tarjeta va sobre el lienzo texturado (cuña + retícula de cruces + grano,
 * ver `REFERENCIAS.md` §1 y §10). Cualquier alfa —`bg-card/60`,
 * `bg-org-fie/10`— deja pasar el dibujo por dentro de la tarjeta, y eso es lo
 * que el usuario rechazó por escrito **dos veces**: *«cuidado, no te pases de
 * transparencia en el calendario, que queda medio raro»*. Todo lo de aquí es
 * opaco, incluidas las pastillas teñidas, que se calculan con `color-mix`
 * dentro de `--card` en vez de con un alfa (ver `globals.css`).
 *
 * DOS VARIANTES, UN COMPONENTE
 * ---------------------------------------------------------------------------
 * `zonas` para el escritorio (las dos columnas de arriba) y `apilada` para el
 * móvil, donde el ancho útil son ~380 px y la fecha manda a la izquierda de
 * una fila superior en vez de ocupar una columna entera. Es la misma tarjeta,
 * los mismos datos y las mismas piezas; lo que cambia es el reparto.
 *
 * Las dos se pintan siempre y la que sobra se apaga con CSS, no con
 * `matchMedia`: un interruptor en JavaScript no sabe el tamaño de la pantalla
 * hasta después del primer pintado, así que la primera pasada saldría con la
 * variante equivocada. Esta pantalla ya peleó ese salto una vez.
 */

export type VarianteTarjeta = 'zonas' | 'apilada';

export function TarjetaBloque({
  bloque,
  variante,
  inscripciones,
  resaltados,
  proximo,
  mostrarArma,
  mostrarGenero,
  mostrarCategoria,
  onAbrir,
}: {
  bloque: Bloque;
  variante: VarianteTarjeta;
  /** competitionId -> estado legible de la inscripción de esta cuenta. */
  inscripciones: Record<string, string>;
  /** Ids resaltados por la búsqueda. */
  resaltados: Set<string>;
  /** Id del torneo que es «lo próximo». */
  proximo: string | null;
  mostrarArma: boolean;
  mostrarGenero: boolean;
  mostrarCategoria: boolean;
  onAbrir: (e: EventView) => void;
}) {
  const principal = bloque.eventos[0];
  const color = colorDe(principal);
  const capsula = capsulaDeFecha(bloque.rango);
  const ocupa = diasSemanaOcupados(bloque.rango);
  const entreSemana = esEntreSemana(bloque.rango);
  const multiple = bloque.eventos.length > 1;

  const resaltado = bloque.eventos.some((e) => resaltados.has(e.id));
  const esProximo = bloque.eventos.some((e) => e.id === proximo);

  const comun = {
    inscripciones,
    mostrarArma,
    mostrarGenero,
    mostrarCategoria,
    onAbrir,
  };

  /*
    UNA SOLA CAJA, Y EL FILETE DENTRO DE ELLA.

    El filete del organismo va como un hijo absoluto y no como `border-l-4`:
    con borde, el radio de la esquina recorta el color y el filete aparece
    despuntado arriba y abajo. Con `overflow-hidden` en la caja y una barra
    absoluta pegada al canto, el filete llega hasta el borde y el radio lo
    redondea, que es lo que hace que se lea como parte de la tarjeta y no como
    una línea pegada al lado.

    `bg-card` sólido, `border` de 1 px y NADA de sombra de color: la
    profundidad la da el lienzo texturado que hay detrás, no un resplandor.
  */
  return (
    <article
      data-bloque={bloque.clave}
      data-multiple={multiple || undefined}
      className={cn(
        'relative overflow-hidden rounded-lg border bg-card transition-colors',
        // El resaltado de la búsqueda: el mismo aro blanco de siempre, para
        // que el guion de capturas (`tests/ui/ficha.mts`) siga reconociéndolo.
        resaltado && 'ring-2 ring-foreground',
        esProximo && !resaltado && 'ring-1 ring-primary-text',
      )}
    >
      {/*
        EL FILETE, PARTIDO CUANDO EL BLOQUE MEZCLA ORGANISMOS.

        Era del color del primer torneo, y eso pintaba de turquesa —«Europeo
        (EFC)», según la leyenda— una tarjeta en la que tres de las cuatro
        competiciones son de la RFEE. Es el mismo fallo que la bandera del
        titular, del que viene todo este cambio: el resumen de arriba
        contradecía el contenido de abajo.

        Con un organismo, una barra. Con varios, un tramo por organismo en el
        orden en que aparecen: se ve de un vistazo que ahí hay de dos sitios, y
        cuál pesa más. Las etiquetas de cada fila siguen diciéndolo con letras.
      */}
      <span aria-hidden className="absolute inset-y-0 left-0 flex w-[3px] flex-col">
        {organismosDelBloque(bloque).map((c, i) => (
          <span key={i} className={cn('flex-1', c.punto)} />
        ))}
      </span>

      {variante === 'zonas' ? (
        <div className="flex min-w-0 items-stretch pl-[3px]">
          <Capsula
            capsula={capsula}
            ocupa={ocupa}
            color={color}
            entreSemana={entreSemana}
          />
          {/* El filete vertical que separa las dos zonas. Tenue a propósito:
              divide, no encierra. */}
          <div className="min-w-0 flex-1 border-l border-filete">
            {multiple ? (
              <CuerpoMultiple bloque={bloque} {...comun} />
            ) : (
              <CuerpoUnico evento={principal} {...comun} />
            )}
          </div>
        </div>
      ) : (
        <div className="min-w-0 pl-[3px]">
          {multiple ? (
            <ApiladaMultiple
              bloque={bloque}
              capsula={capsula}
              ocupa={ocupa}
              color={color}
              entreSemana={entreSemana}
              {...comun}
            />
          ) : (
            <ApiladaUnica
              evento={principal}
              capsula={capsula}
              ocupa={ocupa}
              color={color}
              entreSemana={entreSemana}
              {...comun}
            />
          )}
        </div>
      )}
    </article>
  );
}

/**
 * Los colores de organismo del bloque, sin repetir y en el orden en que
 * aparecen las competiciones. Casi siempre devuelve uno solo.
 */
function organismosDelBloque(bloque: Bloque): ColorOrganismo[] {
  const vistos = new Map<string, ColorOrganismo>();
  for (const e of bloque.eventos) {
    const c = colorDe(e);
    if (!vistos.has(c.punto)) vistos.set(c.punto, c);
  }
  return [...vistos.values()];
}

function colorDe(evento: EventView): ColorOrganismo {
  return colorDeOrganismo(organismoDe(evento.source, evento.scope, evento.circuit));
}

/**
 * LA CÁPSULA DE FECHA.
 *
 * El rango en grande, el mes en pequeño, los días de la semana debajo y las
 * píldoras al final. Es lo que convierte «una fila de una lista» en «un bloque
 * de competición»: se lee la fecha antes que el nombre, que es el orden en que
 * se mira un calendario.
 *
 * El ancho es fijo (`w-[6.75rem]`) y no elástico. Con ancho automático, las
 * cápsulas de «03 - 04» y de «14 - 15 NOV» medían distinto y los nombres de
 * los torneos de una misma columna arrancaban en sitios distintos: una lista
 * de diez tarjetas con el título desalineado se lee como diez cosas sueltas.
 */
function Capsula({
  capsula,
  ocupa,
  color,
  entreSemana,
}: {
  capsula: { dias: string; mes: string; semana: string };
  ocupa: boolean[];
  color: ColorOrganismo;
  entreSemana: boolean;
}) {
  return (
    <div className="flex w-[6.75rem] shrink-0 flex-col items-center justify-center gap-1 px-1.5 py-2">
      <span className="cifra text-2xl leading-none text-foreground">
        {capsula.dias}
      </span>
      <span className="cifra text-[0.7rem] font-semibold leading-none tracking-widest text-muted-foreground">
        {capsula.mes}
      </span>
      <span className="cifra text-[0.62rem] leading-none tracking-wide text-muted-foreground">
        {capsula.semana}
      </span>
      <PildorasSemana ocupa={ocupa} color={color} />
      {entreSemana ? <EntreSemana /> : null}
    </div>
  );
}

/**
 * LAS SIETE PÍLDORAS DE DÍA DE LA SEMANA.
 *
 * Siete micro-chips `L M X J V S D`. Los que ocupa el torneo van rellenos con
 * el color del organismo; los demás, apagados sobre la superficie de nivel 0.
 *
 * **Son chips, no texto entre corchetes.** El usuario lo pidió así, y tiene
 * razón por un motivo concreto: lo que se quiere leer aquí no son las letras,
 * es **la forma**. Dos rectángulos al final de la fila significan «fin de
 * semana» sin leer nada; un rectángulo en el medio significa «tengo que pedir
 * permiso». Con texto plano hay que leerlo, y entonces ya es más rápido mirar
 * la fecha.
 *
 * 14 px y no 16: siete chips a 16 px con separación son 124 px, y la columna
 * del trimestre mide 425 px en un escritorio de 1320. A 14 px son 107 y al
 * cuerpo le quedan 290, que es lo que necesita el nombre de un torneo entero.
 *
 * El color no va solo: las letras siguen ahí, la cápsula dice «SÁB - DOM`
 * encima y el rango de días está justo arriba. Es requisito del proyecto
 * (`UI.md`, regla 6) y aquí se cumple tres veces.
 */
function PildorasSemana({ ocupa, color }: { ocupa: boolean[]; color: ColorOrganismo }) {
  return (
    <span className="flex items-center gap-[2px]" aria-hidden>
      {LETRAS_SEMANA.map((letra, i) => (
        <span
          key={i}
          className={cn(
            'cifra flex size-[14px] items-center justify-center rounded-[3px] text-[0.58rem] leading-none',
            ocupa[i]
              ? cn(color.superficie, color.textoSobreSuperficie, 'font-semibold')
              : 'bg-secondary text-off',
          )}
        >
          {letra}
        </span>
      ))}
    </span>
  );
}

/**
 * «Entre semana», en ámbar.
 *
 * Es información real y con consecuencia: si el torneo no cae en sábado ni en
 * domingo, hay que pedir permiso en el trabajo o faltar al instituto, y eso
 * decide si vas. En el calendario español es la excepción, así que solo
 * aparece cuando pasa.
 *
 * AVISO, PORQUE VA CONTRA UNA REGLA DEL PROYECTO: `REFERENCIAS.md` §9.3 dice
 * que verde, ámbar y rojo están cogidos por el semáforo de plazos. Esto usa
 * ámbar para otra cosa. Se hace porque el usuario lo pidió expresamente y
 * porque el riesgo de confusión es bajo —el texto dice literalmente «Entre
 * semana», no un plazo, y el plazo vive en la otra esquina de la tarjeta—,
 * pero conviene saberlo: si alguna vez se lee como una alarma de plazo, la
 * solución es quitarle el color y dejar la forma, no cambiar el semáforo.
 */
function EntreSemana() {
  return (
    <span className="cifra mt-0.5 rounded-[3px] bg-secondary px-1 py-px text-[0.58rem] leading-none tracking-tight text-warn">
      Entre semana
    </span>
  );
}

/** La pastilla verde de «ya estás inscrito». El dato existe: `inscripciones`. */
function Inscrito({ clase }: { clase?: string }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-0.5 rounded-[3px] bg-secondary px-1 py-px text-[0.62rem] font-medium leading-none text-ok',
        clase,
      )}
    >
      <Check className="size-3" aria-hidden />
      Inscrito
    </span>
  );
}

/**
 * LA PASTILLA DE CIRCUITO, TEÑIDA.
 *
 * «RFEE · Nacional», «FIE · Copa del Mundo», «EFC · Liga Europea». Fondo del
 * color del organismo al 14 % —mezclado dentro de `--card`, opaco— y texto en
 * el color de identidad.
 *
 * Antes era texto plano y por eso el usuario decía que está *«todo demasiado
 * gris sobre negro»*: los tres organismos se leían idénticos y el color solo
 * existía en un filete de 3 px en el canto. Con la pastilla teñida, el tipo de
 * competición se reconoce sin leer.
 */
function PastillaCircuito({ evento }: { evento: EventView }) {
  const color = colorDe(evento);
  const circuito = pastillaDeCircuito(evento);
  return (
    <span
      className={cn(
        'cifra shrink-0 rounded-[3px] px-1.5 py-px text-[0.65rem] font-medium leading-[1.3] tracking-tight',
        color.tintePastilla,
        color.texto,
      )}
    >
      {color.corto}
      {circuito ? ` · ${circuito}` : ''}
    </span>
  );
}

/** Pastilla neutra: arma, género, categoría. Gris con nombre, nunca un alfa. */
function Pastilla({
  children,
  clase,
  titulo,
}: {
  children: React.ReactNode;
  clase?: string;
  titulo?: string;
}) {
  return (
    <span
      title={titulo}
      className={cn(
        'cifra shrink-0 rounded-[3px] bg-secondary px-1 py-px text-[0.65rem] leading-[1.3] tracking-tight text-secondary-foreground',
        clase,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Arma, género y categoría, y **solo cuando el filtro abarca más de uno**.
 *
 * Con el calendario filtrado por florete femenino, «FLO F» en cada tarjeta es
 * el 100 % de lo que se está mirando: no informa y se come el sitio del
 * nombre justo donde menos hay.
 *
 * Los dos géneros del mismo torneo van en la MISMA tarjeta, uno al lado del
 * otro: `M` `F`. Es lo que el usuario señaló expresamente y por eso vive en
 * `generosDe()`, que devuelve la lista de un evento en vez de partirlo.
 */
function PastillasPrueba({
  evento,
  mostrarArma,
  mostrarGenero,
  mostrarCategoria,
}: {
  evento: EventView;
  mostrarArma: boolean;
  mostrarGenero: boolean;
  mostrarCategoria: boolean;
}) {
  const armas = mostrarArma ? armasDe(evento) : [];
  const generos = mostrarGenero ? generosDe(evento) : [];
  const categorias = mostrarCategoria ? categoriasDe(evento) : [];
  if (armas.length + generos.length + categorias.length === 0) return null;

  return (
    <>
      {armas.map((a) => (
        <EtiquetaArma
          key={a}
          arma={a}
          className="cifra text-[0.65rem] leading-[1.3] text-muted-foreground"
        />
      ))}
      {generos.map((g) => (
        <Pastilla key={g.codigo} titulo={g.largo}>
          {g.codigo}
        </Pastilla>
      ))}
      {categorias.map((c) => (
        <Pastilla key={c}>{c}</Pastilla>
      ))}
    </>
  );
}

/** Sede con su bandera. Si no hay ciudad, lo dice: «Sede sin publicar». */
function Sede({ evento, clase }: { evento: EventView; clase?: string }) {
  const hay = Boolean(evento.city);
  return (
    <span
      className={cn(
        'flex min-w-0 items-center gap-1 text-xs text-muted-foreground',
        clase,
      )}
    >
      {evento.country ? (
        <BanderaPais pais={evento.country} className="shrink-0" />
      ) : (
        <MapPin className="size-3 shrink-0 opacity-60" aria-hidden />
      )}
      <span className={cn('min-w-0 truncate', !hay && 'italic')}>
        {sedeDe(evento, false)}
      </span>
    </span>
  );
}

/** El plazo, ya redactado y con su tono. Si no hay dato, no dice nada. */
/**
 * El plazo, pegado a lo que describe.
 *
 * Sin `ml-auto`, y esto es una corrección: iba empujado al canto derecho de la
 * tarjeta, así que en la vista de un mes a 1440 px «Cierra en 4 días» quedaba a
 * 400 px del torneo del que hablaba. Es el mismo fallo que el usuario rodeó con
 * un círculo en la banda del marcador, en pequeño. Ahora va detrás de las
 * pastillas y se lee como una frase.
 */
function Plazo({ evento, clase }: { evento: EventView; clase?: string }) {
  const plazo = plazoDe(evento);
  if (!plazo) return null;
  return (
    <span className={cn('shrink-0 text-[0.68rem] font-medium', plazo.tono, clase)}>
      {plazo.texto}
    </span>
  );
}

function estaInscrito(evento: EventView, inscripciones: Record<string, string>) {
  return evento.competitions.some((c) => inscripciones[c.id]);
}

type Comun = {
  inscripciones: Record<string, string>;
  mostrarArma: boolean;
  mostrarGenero: boolean;
  mostrarCategoria: boolean;
  onAbrir: (e: EventView) => void;
};

/**
 * El cuerpo de una tarjeta de un solo torneo, en la variante de dos zonas.
 *
 * Toda la zona es el botón que abre la ficha: un objetivo de 96 px de ancho
 * por 72 de alto, no un enlace de 12 px dentro de una tarjeta.
 */
function CuerpoUnico({
  evento,
  inscripciones,
  mostrarArma,
  mostrarGenero,
  mostrarCategoria,
  onAbrir,
}: { evento: EventView } & Comun) {
  const inscrito = estaInscrito(evento, inscripciones);
  return (
    <button
      type="button"
      data-barra="torneo"
      onClick={() => onAbrir(evento)}
      className="flex w-full min-w-0 cursor-pointer flex-col gap-1 px-2.5 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      aria-label={`${titularTorneo(evento.name)}. Abrir la ficha.`}
    >
      <span className="flex w-full min-w-0 items-start gap-2">
        <span className="min-w-0 flex-1 text-sm font-semibold leading-snug">
          {titularTorneo(evento.name)}
        </span>
        {inscrito ? <Inscrito clase="mt-px" /> : null}
      </span>

      <Sede evento={evento} />

      <span className="flex w-full min-w-0 flex-wrap items-center gap-1">
        <PastillaCircuito evento={evento} />
        <PastillasPrueba
          evento={evento}
          mostrarArma={mostrarArma}
          mostrarGenero={mostrarGenero}
          mostrarCategoria={mostrarCategoria}
        />
        <Plazo evento={evento} />
      </span>
    </button>
  );
}

/**
 * ===========================================================================
 * UN FIN DE SEMANA CON CINCO COMPETICIONES: UNA TARJETA, NO CINCO
 * ===========================================================================
 *
 * El caso real, y es el que el usuario señaló: el 3 y 4 de octubre de 2026
 * coinciden Eurofence League, Liga Iberdrola, Liga de Oro, Liga de Plata y el
 * TNR absoluto. En la rejilla eran cinco barras en la misma casilla, cinco
 * bloques flotantes que descuadraban el mes entero y que se leían como cinco
 * cosas sin relación.
 *
 * Son una: **el fin de semana del 3 y 4**. Así que una tarjeta, con jerarquía
 * dentro:
 *
 *   1. Una etiqueta pequeña arriba, `Competición múltiple`, para que no
 *      parezca que la tarjeta se ha comido datos.
 *   2. Y debajo **una sección por competición**, cada una completa: nombre,
 *      bandera, sede, organismo, prueba y plazo, separadas por un filete.
 *
 * Cada sección abre SU ficha. El agrupamiento es visual, no destruye el
 * acceso a nada.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ YA NO HAY UN TORNEO ASCENDIDO A TITULAR Y EL RESTO EN CHIPS
 * ---------------------------------------------------------------------------
 * Esto estaba mal, y el usuario lo pilló con el caso exacto: el sábado 3 de
 * octubre la tarjeta ponía arriba «Eurofence League · Antony» **con la bandera
 * de Francia**, y el TNR absoluto de Sabadell quedaba abajo como un chip sin
 * bandera ni ciudad. Sus palabras: *«me estaba volviendo loco viendo la
 * bandera francesa, que no veía que era el TNR que es en España, en Sabadell,
 * y no lo veo visualmente»*.
 *
 * O sea que el resumen no era neutro: **la cápsula entera parecía francesa**.
 * Con una sola bandera arriba, el chip no es «menos detalle», es detalle
 * contradicho — y el dato que más se busca de un vistazo en este calendario es
 * precisamente si el torneo es en España.
 *
 * Así que ya no se asciende a nadie. Todas las competiciones van iguales, con
 * su fila entera. Ocupa más, y es lo correcto: *«aunque ocupe más, pero es
 * normal, porque son 4 competiciones»*.
 *
 * El único límite es `TOPE`, y no es para ahorrar sitio sino para el caso sin
 * filtros de la dirección técnica, donde un fin de semana junta diez torneos y
 * una columna de mes se convertiría en una sola tarjeta. Pasado el tope, los
 * que faltan **no se enseñan a medias**: se cuentan y se despliegan con un
 * toque, que es honesto de las dos maneras.
 */

/**
 * Cuántas secciones enteras caben antes de plegar el resto.
 *
 * Cuatro porque es el caso que se señaló y porque cuatro filas de nombre+sede
 * son ~150 px: la tarjeta sigue siendo una tarjeta dentro de la columna del
 * mes. A partir de ahí manda el contador.
 */
const TOPE = 4;
function CuerpoMultiple({
  bloque,
  inscripciones,
  mostrarArma,
  mostrarGenero,
  mostrarCategoria,
  onAbrir,
}: { bloque: Bloque } & Comun) {
  const [todos, setTodos] = React.useState(false);
  const visibles = todos ? bloque.eventos : bloque.eventos.slice(0, TOPE);
  const ocultos = bloque.eventos.length - visibles.length;

  return (
    <div className="flex min-w-0 flex-col px-2.5 py-2">
      <span className="cifra pb-1 text-[0.6rem] uppercase leading-none tracking-widest text-muted-foreground">
        Competición múltiple · {bloque.eventos.length} torneos
      </span>

      {visibles.map((evento, i) => (
        <FilaEvento
          key={evento.id}
          evento={evento}
          conFilete={i > 0}
          inscrito={estaInscrito(evento, inscripciones)}
          mostrarArma={mostrarArma}
          mostrarGenero={mostrarGenero}
          mostrarCategoria={mostrarCategoria}
          onAbrir={onAbrir}
        />
      ))}

      {ocultos > 0 ? (
        <button
          type="button"
          onClick={() => setTodos(true)}
          className="objetivo-libre mt-1.5 w-full border-t border-filete pt-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          Ver {ocultos === 1 ? 'el otro torneo' : `los otros ${ocultos} torneos`}
        </button>
      ) : null}
    </div>
  );
}

/*
  `repartir()` vivía aquí y se ha ido: era la función que ascendía un torneo a
  titular y mandaba el resto a chips. Ver el comentario de `CuerpoMultiple`:
  el ascenso hacía que un bloque con un TNR español pareciera francés.
*/

/** Una fila con nombre entero, sede y pastillas, dentro de un bloque múltiple. */
function FilaEvento({
  evento,
  conFilete,
  inscrito,
  mostrarArma,
  mostrarGenero,
  mostrarCategoria,
  onAbrir,
}: {
  evento: EventView;
  conFilete: boolean;
  inscrito: boolean;
  mostrarArma: boolean;
  mostrarGenero: boolean;
  mostrarCategoria: boolean;
  onAbrir: (e: EventView) => void;
}) {
  return (
    <button
      type="button"
      data-barra="torneo"
      onClick={() => onAbrir(evento)}
      className={cn(
        'flex w-full min-w-0 cursor-pointer flex-col gap-0.5 rounded-sm px-1 py-1 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        conFilete && 'mt-1 border-t border-filete pt-1.5',
      )}
      aria-label={`${titularTorneo(evento.name)}. Abrir la ficha.`}
    >
      <span className="flex w-full min-w-0 items-start gap-2">
        <span className="min-w-0 flex-1 text-sm font-semibold leading-snug">
          {titularTorneo(evento.name)}
        </span>
        {inscrito ? <Inscrito clase="mt-px" /> : null}
      </span>
      <span className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Sede evento={evento} />
        <PastillaCircuito evento={evento} />
        <PastillasPrueba
          evento={evento}
          mostrarArma={mostrarArma}
          mostrarGenero={mostrarGenero}
          mostrarCategoria={mostrarCategoria}
        />
        <Plazo evento={evento} />
      </span>
    </button>
  );
}

/*
  `ChipTorneo` vivía aquí y se ha ido con el reparto en titular + chips. Los
  chips eran el síntoma: un torneo sin bandera ni ciudad debajo de otro que sí
  las tenía. Ahora todas las competiciones de un bloque van con su fila
  entera; ver `CuerpoMultiple`.
*/

/**
 * ===========================================================================
 * LA VARIANTE DEL MÓVIL: LA MISMA TARJETA, APILADA
 * ===========================================================================
 *
 * En 380 px de ancho una cápsula de 108 px se lleva el 28 % de la tarjeta y al
 * nombre del torneo le quedan 250. Así que la fecha sube a una fila superior,
 * en horizontal —`13 - 14 OCT · MAR-MIÉ`— con el estado de inscripción al otro
 * extremo, y el nombre se queda con el ancho entero.
 *
 * Las píldoras de día de la semana bajan a la última fila, con los chips: ahí
 * hay sitio y siguen contando lo mismo.
 */
function FilaFecha({
  capsula,
  clase,
  children,
}: {
  capsula: { dias: string; mes: string; semana: string };
  clase?: string;
  children?: React.ReactNode;
}) {
  return (
    <span className={cn('flex w-full min-w-0 items-center gap-2', clase)}>
      <span className="flex min-w-0 shrink items-baseline gap-1.5">
        <span className="cifra text-lg leading-none text-foreground">
          {capsula.dias}
        </span>
        <span className="cifra text-[0.7rem] font-semibold leading-none tracking-widest text-muted-foreground">
          {capsula.mes}
        </span>
        <span className="cifra truncate text-[0.62rem] leading-none tracking-wide text-muted-foreground">
          · {capsula.semana}
        </span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">{children}</span>
    </span>
  );
}

function ApiladaUnica({
  evento,
  capsula,
  ocupa,
  color,
  entreSemana,
  inscripciones,
  mostrarArma,
  mostrarGenero,
  mostrarCategoria,
  onAbrir,
}: {
  evento: EventView;
  capsula: { dias: string; mes: string; semana: string };
  ocupa: boolean[];
  color: ColorOrganismo;
  entreSemana: boolean;
} & Comun) {
  const inscrito = estaInscrito(evento, inscripciones);
  return (
    <button
      type="button"
      data-agenda="tarjeta"
      data-barra="torneo"
      onClick={() => onAbrir(evento)}
      className="flex w-full min-w-0 cursor-pointer flex-col gap-1.5 px-2.5 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      aria-label={`${titularTorneo(evento.name)}. Abrir la ficha.`}
    >
      <FilaFecha capsula={capsula}>
        {inscrito ? <Inscrito /> : <Plazo evento={evento} />}
        {entreSemana ? <EntreSemana /> : null}
      </FilaFecha>

      <span className="w-full min-w-0 text-sm font-semibold leading-snug">
        {titularTorneo(evento.name)}
      </span>

      <Sede evento={evento} />

      <span className="flex w-full min-w-0 flex-wrap items-center gap-1">
        <PastillaCircuito evento={evento} />
        <PastillasPrueba
          evento={evento}
          mostrarArma={mostrarArma}
          mostrarGenero={mostrarGenero}
          mostrarCategoria={mostrarCategoria}
        />
        <span className="ml-auto">
          <PildorasSemana ocupa={ocupa} color={color} />
        </span>
      </span>
    </button>
  );
}

/**
 * El fin de semana múltiple en el móvil: una sección por competición.
 *
 * Aquí había un torneo con nombre, bandera y sede, y el resto como chips.
 * Mismo fallo que en el escritorio y por el mismo motivo: con una sola
 * bandera arriba, un fin de semana que incluye el TNR de Sabadell se lee como
 * francés. En una pantalla de 390 px, donde solo caben dos o tres tarjetas,
 * eso es peor todavía.
 *
 * Ahora todas las competiciones llevan su fila entera, plegadas a partir de
 * `TOPE`. Ver el comentario largo de `CuerpoMultiple`.
 */
function ApiladaMultiple({
  bloque,
  capsula,
  ocupa,
  color,
  entreSemana,
  inscripciones,
  mostrarArma,
  mostrarGenero,
  mostrarCategoria,
  onAbrir,
}: {
  bloque: Bloque;
  capsula: { dias: string; mes: string; semana: string };
  ocupa: boolean[];
  color: ColorOrganismo;
  entreSemana: boolean;
} & Comun) {
  const [todos, setTodos] = React.useState(false);
  const visibles = todos ? bloque.eventos : bloque.eventos.slice(0, TOPE);
  const ocultos = bloque.eventos.length - visibles.length;

  return (
    <div className="flex min-w-0 flex-col gap-1.5 px-2.5 py-2">
      <FilaFecha capsula={capsula}>
        {entreSemana ? <EntreSemana /> : null}
        <PildorasSemana ocupa={ocupa} color={color} />
      </FilaFecha>

      <span className="cifra text-[0.6rem] uppercase leading-none tracking-widest text-muted-foreground">
        Competición múltiple · {bloque.eventos.length} torneos
      </span>

      {visibles.map((evento, k) => (
        <button
          key={evento.id}
          type="button"
          data-agenda="tarjeta"
          data-barra="torneo"
          onClick={() => onAbrir(evento)}
          className={cn(
            'flex w-full min-w-0 cursor-pointer flex-col gap-1 rounded-sm text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            k > 0 && 'border-t border-filete pt-1.5',
          )}
          aria-label={`${titularTorneo(evento.name)}. Abrir la ficha.`}
        >
          <span className="flex w-full min-w-0 items-start gap-2">
            <span className="min-w-0 flex-1 text-sm font-semibold leading-snug">
              {titularTorneo(evento.name)}
            </span>
            {estaInscrito(evento, inscripciones) ? <Inscrito clase="mt-px" /> : null}
          </span>
          <Sede evento={evento} />
          <span className="flex w-full min-w-0 flex-wrap items-center gap-1">
            <PastillaCircuito evento={evento} />
            <PastillasPrueba
              evento={evento}
              mostrarArma={mostrarArma}
              mostrarGenero={mostrarGenero}
              mostrarCategoria={mostrarCategoria}
            />
            <Plazo evento={evento} />
          </span>
        </button>
      ))}

      {ocultos > 0 ? (
        <button
          type="button"
          onClick={() => setTodos(true)}
          className="objetivo-libre w-full border-t border-filete pt-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          Ver {ocultos === 1 ? 'el otro torneo' : `los otros ${ocultos} torneos`}
        </button>
      ) : null}
    </div>
  );
}

/**
 * EL HUECO, COMO DIVISOR FINO.
 *
 * Donde la rejilla dejaba 400 px de negro va una línea de 1 px con el texto
 * centrado: `──── 2 semanas libres (15 – 27 oct) ────`. El vacío deja de ser
 * superficie y pasa a ser un dato, que es lo único que hace que valga la pena
 * pintarlo.
 *
 * El texto y el número los calcula `huecoEntre()` a partir de las fechas
 * reales, y eso es lo que impide que vuelva el fallo del boceto: allí salía «1
 * semana libre (15 oct - 27 oct)» dos veces seguidas y en sitios donde no
 * tocaba, porque el texto era fijo.
 */
export function DivisorHueco({
  texto,
  rango,
  compacto = false,
}: {
  texto: string;
  rango: string;
  compacto?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 text-[0.65rem] text-muted-foreground',
        compacto ? 'py-1' : 'py-1.5',
      )}
    >
      <span className="h-px flex-1 bg-filete-alto" aria-hidden />
      <CalendarClock className="size-3 shrink-0 opacity-50" aria-hidden />
      <span className="cifra shrink-0 tracking-tight">
        {texto} <span className="text-off">({rango})</span>
      </span>
      <span className="h-px flex-1 bg-filete-alto" aria-hidden />
    </div>
  );
}
