'use client';

import {
  ChevronDown,
  CircleCheck,
  ExternalLink,
  FileText,
  Navigation,
  Radio,
} from 'lucide-react';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { BanderaPais } from '@/components/bandera';
import { ChipFiltro, FilaChips } from '@/components/sistema/chip-filtro';
import type {
  CompetitionView,
  DatoExtraidoView,
  EventView,
} from '@/lib/queries/calendar';
import { mapsLinks } from '@/lib/travel';
import { hoyMadrid } from '@/lib/callups/fechas';
import { esEnlaceDeResultados } from '@/lib/calendario/enlaces-directo';

import { BarraPlazos } from './barra-plazos';
import { PastillaDirectoDePrueba } from './enlace-directo';
import { AccesoAlPabellon, HorariosTorneo, horariosDelTorneo } from './horarios-torneo';
import {
  CitaConvocatoria,
  MarcaConvocatoria,
  enlacesDeConvocatoria,
  nombreDeEnlace,
  plazosDeConvocatoria,
} from './datos-convocatoria';
import {
  LineaDireccion,
  OtrosDatos,
  ParDato,
  Tarjeta,
  TarjetaInscripcion,
  TarjetaOrganiza,
  organizaDe,
  otrosDatosDe,
  sedeDe,
} from './ficha/datos-ficha';
import { RelojSede } from './ficha/horas';
import { ResultadosTorneo } from './ficha/resultados-torneo';
import { torneoTerminado } from './ficha/terminado';
import {
  CATEGORY_LABEL,
  CATEGORY_SHORT,
  GENDER_LABEL,
  GENDER_SHORT,
  SOURCE_LABEL,
  WEAPON_LABEL,
  WEAPON_SHORT,
  cn,
  formatDateEs,
  titular,
  titularDocumento,
} from '@/lib/utils';
import type { QuienVa as QuienVaDatos } from '@/app/(app)/inscritos';
import { fichaRecibida, leerFicha } from './ficha/precarga';
import type { TiradorOpcion } from './vista';

/**
 * ===========================================================================
 * LA FICHA DE UN TORNEO
 * ===========================================================================
 *
 * DE NUEVE APARTADOS A CUATRO BANDAS
 * ----------------------------------
 * Esta ficha tenía nueve secciones con rótulo —cómo llegar, pruebas, plazo,
 * horario, la prueba, quién va, documentos, en directo, de dónde sale—, todas
 * con el mismo rótulo de 13 px a la izquierda y el mismo filete encima. Era
 * ordenado y era **plano**: nada pesaba más que nada, así que la mirada no
 * tenía a dónde ir y en un móvil había que recorrer tres pantallas para
 * encontrar la hora de llamada. Petición literal: *«menos secciones y más
 * minimalista, moderno y simple»* y *«que no se vea muy plano»*.
 *
 * Quedan **cuatro bandas**, y cada fusión responde a una pregunta entera en
 * vez de a un campo:
 *
 *   1. **Inscripción** — la barra de tramos y, debajo, las condiciones: cuotas,
 *      cupos, edad mínima, forma de pago y requisitos. Antes: «Plazo» + la
 *      cuota perdida dentro de «La prueba». Cuánto queda y cuánto cuesta son
 *      la misma decisión.
 *   2. **Dónde y cuándo** — la sede con su mapa, la hora de allí y la tuya, y
 *      el horario día a día. Antes: «Cómo llegar» + «Horario». Las dos son lo
 *      mismo: dónde tengo que estar y a qué hora.
 *   3. **¿Estás dentro?** — la lista oficial de inscritos. Antes «Quién va»,
 *      con un rótulo que no era la pregunta que se viene a hacer.
 *   4. **Convocatoria y fuentes** — documentos, retransmisión, quién organiza,
 *      enlaces del PDF y procedencia. Antes: «Documentos» + «En directo» +
 *      «De dónde sale», tres bandas de una línea cada una.
 *
 * Cuando el torneo ya se ha tirado, la inscripción no le importa a nadie y
 * arriba van los **Resultados**, con el podio de cada prueba.
 *
 * Y desaparecieron dos apartados sin perder información: «Pruebas» es ahora el
 * selector de arriba, que es un control y no una sección; y «La prueba»
 * (género, categoría, formato) ya se lee en la pastilla que se toca.
 *
 * DE DÓNDE SALE LA JERARQUÍA
 * -------------------------
 * Del marcador de una pista, que es lo que manda `UI.md`: cada banda tiene un
 * **titular en condensada** y, a su derecha, **una cifra grande con un rótulo
 * diminuto** —días que faltan, inscritos en la lista—. El contraste entre las
 * dos ES la jerarquía. No hay sombras, ni degradados, ni una tarjeta por dato:
 * bandas horizontales separadas por un filete de un píxel.
 *
 * ESTO NO ES UNA PANTALLA DE TRÁMITE
 * ----------------------------------
 * Ya no se inscribe nadie desde aquí (*«solo ver calendario, si estoy o no»*),
 * así que se fueron el botón de solicitar, su estado de envío y la lista de
 * solicitudes sin validar. Lo que queda es de consulta, y el color de acento
 * —que antes se llevaba el botón de inscribirse— es ahora de **«cómo
 * llegar»**, que es lo único que de verdad se pulsa.
 */

/**
 * El mismo torneo, con lo que dicen sus PDFs.
 *
 * El objeto que llega por `props` es el de la pantalla del calendario, y ese
 * viene de `listEvents`, que **no pide lo extraído** a propósito: son 250
 * eventos por carga. Así que aquí se pide el detalle al abrir la ficha —igual
 * que ya se pedía quién va— y se le pegan los dos campos al evento que ya
 * tenemos.
 *
 * Se pegan los campos en vez de sustituir el objeto entero, y no es lo mismo:
 * `getEvent` devuelve TODAS las pruebas del torneo y el calendario puede estar
 * filtrado por arma o por categoría. Cambiar el objeto haría aparecer pruebas
 * que el filtro había quitado, que es un cambio de comportamiento que aquí no
 * toca decidir.
 *
 * Mientras llega no hay ni esqueleto ni espera: la ficha se pinta entera con
 * lo que ya se sabe y los datos del papel entran cuando entran. Bloquear la
 * ficha entera por el pabellón sería cambiar lo que funciona por lo que
 * mejora. Casi nunca hay que esperar: el detalle se pide al mostrar intención
 * de abrir la tarjeta (`ficha/precarga.ts`) y aquí se usa lo ya recibido.
 */
function useConDatosDeLosPdfs(base: EventView): EventView {
  const [leidos, setLeidos] = React.useState<EventView | null>(
    () => fichaRecibida(base)?.detalle ?? null,
  );

  React.useEffect(() => {
    let vigente = true;
    setLeidos(fichaRecibida(base)?.detalle ?? null);
    leerFicha(base)
      .then((r) => {
        if (vigente) setLeidos(r.detalle);
      })
      // Que no se puedan leer los PDFs no puede tumbar la ficha: se queda sin
      // esa parte y todo lo demás sigue estando.
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [base.id]);

  return React.useMemo(() => {
    if (!leidos) return base;
    const porPrueba = new Map(
      leidos.competitions.map((c) => [c.id, c.datosExtraidos]),
    );
    /**
     * Y de aquí salen también LOS PLAZOS.
     *
     * El calendario ya no los manda: son 433 kB de los 1.200 que pesaba la
     * pantalla principal, para una barra que solo se ve al abrir una ficha
     * (ver `conPlazos` en `src/lib/queries/calendar.ts`). Así que llegan con
     * el detalle, que es esta misma petición, y hasta entonces la barra se
     * pinta con lo que hay. No se bloquea la ficha por ellos.
     */
    const detalle = new Map(
      leidos.competitions.map((c) => [c.id, { plazos: c.deadlines, estado: c.status }]),
    );
    return {
      ...base,
      datosExtraidos: leidos.datosExtraidos,
      competitions: base.competitions.map((c) => {
        const d = detalle.get(c.id);
        return {
          ...c,
          datosExtraidos: porPrueba.get(c.id) ?? [],
          deadlines: d?.plazos ?? c.deadlines,
          status: d?.estado ?? c.status,
        };
      }),
    };
  }, [base, leidos]);
}

/**
 * Una banda de la ficha.
 *
 * El titular va en condensada y grande (lo aplica `globals.css` a `h3`) y el
 * marcador a la derecha, alineado por la línea base para que la cifra y el
 * rótulo se lean como una sola cosa. En el móvil todo sube un paso de tamaño:
 * esto se mira de pie en la puerta de un pabellón.
 */
function Banda({
  titulo,
  cifra,
  rotulo,
  tono,
  children,
}: {
  titulo: string;
  /** La cifra del marcador. Se omite cuando no hay un número que importe. */
  cifra?: string | number | null;
  /** Lo que acompaña a la cifra, o el texto suelto si no hay cifra. */
  rotulo?: string;
  tono?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-t border-t-filete pt-4 pb-1 first:border-t-0 first:pt-0">
      <header className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <h3 className="text-[20px] leading-[24px]">{titulo}</h3>
        {cifra !== undefined || rotulo ? (
          <p className={cn('flex shrink-0 items-baseline gap-1.5', tono)}>
            {cifra !== undefined && cifra !== null ? (
              <span className="cifra text-[28px] leading-none">{cifra}</span>
            ) : null}
            {rotulo ? (
              <span
                className={cn(
                  'text-[13px]',
                  tono ? '' : 'text-muted-foreground',
                )}
              >
                {rotulo}
              </span>
            ) : null}
          </p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

const TONO = {
  verde: { texto: 'text-ok', palabra: 'a tiempo' },
  ambar: { texto: 'text-warn', palabra: 'atención' },
  rojo: { texto: 'text-danger', palabra: 'urgente' },
  cerrado: { texto: 'text-muted-foreground', palabra: 'cerrado' },
  sin_datos: { texto: 'text-muted-foreground', palabra: 'sin plazo' },
} as const;

/**
 * Contenido de la ficha de un torneo.
 *
 * Se elige una prueba con las pastillas de arriba y debajo se ve solo esa: un
 * torneo tiene hasta ocho pruebas y enseñarlas todas desplegadas obliga a
 * desplazarse por cosas que no te tocan. La que te corresponde viene ya
 * elegida.
 */
export function FichaEvento({
  evento: delCalendario,
  tirador,
  inscritos,
  falloInscritos = false,
  retornoCalendario,
}: {
  evento: EventView;
  tirador: TiradorOpcion | null;
  /** Dirección del calendario con su periodo y filtros, para volver a él desde los resultados. */
  retornoCalendario?: string;
  /**
   * `inscripciones` y `onSolicitar` siguen en el tipo porque los pasa
   * `vista.tsx`, que es de otro agente: la ficha ya no tramita inscripciones
   * y no los usa. Se quitan de los dos sitios a la vez, no antes.
   */
  inscripciones?: Record<string, string>;
  onSolicitar?: (competitionId: string) => Promise<void>;
  /** Quién va, por prueba. `null` mientras se está pidiendo. */
  inscritos: QuienVaDatos | null;
  /** La última lectura falló: no es lo mismo que una lista vacía. */
  falloInscritos?: boolean;
}) {
  const evento = useConDatosDeLosPdfs(delCalendario);

  /**
   * Con qué prueba se abre: la del tirador que está mirando. Ya no decide si
   * puede inscribirse —eso se fue de aquí—, solo a qué mira primero.
   */
  const suya = React.useMemo(
    () =>
      evento.competitions.find(
        (c) =>
          tirador &&
          (tirador.weapons.length === 0 || tirador.weapons.includes(c.weapon)) &&
          (tirador.gender === 'MIXTO' || c.gender === tirador.gender) &&
          (tirador.eligibleCategories.length === 0 ||
            tirador.eligibleCategories.includes(c.category)),
      ) ?? null,
    [evento.competitions, tirador],
  );

  const [elegida, setElegida] = React.useState<string>(
    () => (suya ?? evento.competitions[0])?.id ?? '',
  );
  React.useEffect(() => {
    setElegida((suya ?? evento.competitions[0])?.id ?? '');
  }, [suya, evento.competitions]);

  const prueba = evento.competitions.find((c) => c.id === elegida) ?? null;
  // La categoría común ya la dice el torneo; repetida en cada pastilla no cabía en dos columnas a 320 px.
  const variasCategorias = new Set(evento.competitions.map((c) => c.category)).size > 1;
  const terminado = torneoTerminado(evento);
  const hoy = hoyMadrid();

  return (
    <div className="flex flex-col gap-4 px-4 pt-2 pb-10">
      {/*
        Las pruebas del torneo, que antes eran una sección con rótulo, y antes
        de eso la banda «La prueba» con el género, la categoría y el formato en
        una rejilla de pares. Las dos cosas son esto.

        Es un control, no información: va arriba, sin filete ni titular, y se
        marca con fondo secundario y borde. El relleno del color de acento se
        reserva para la acción principal de la pantalla (ver `REFERENCIAS.md`
        9.1): una pastilla de selección que compite con un botón que hace algo
        es justo lo que hace que una interfaz parezca descuidada.

        Con UNA sola prueba no hay nada que elegir, así que son pastillas de
        etiqueta —arma, género, categoría, formato—, que es lo que hace la
        ficha de torneo de la FIE debajo del título. Sin esto, un torneo de una
        prueba perdía el género y la categoría al desaparecer «La prueba»: se
        quedaba sin decir si es masculino o femenino.

        Y va la abreviatura del arma, no el icono: por debajo de 22 px el
        dibujo de un florete y el de un sable son la misma línea con un bulto.
      */}
      {evento.competitions.length === 1 && prueba ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="gap-1.5 px-2.5 py-1">
            <span className="cifra text-sm leading-none">
              {WEAPON_SHORT[prueba.weapon]}
            </span>
            <span className="leading-none">{WEAPON_LABEL[prueba.weapon]}</span>
          </Badge>
          <Badge variant="outline" className="px-2.5 py-1">
            {GENDER_LABEL[prueba.gender]}
          </Badge>
          <Badge variant="outline" className="px-2.5 py-1">
            {CATEGORY_LABEL[prueba.category as keyof typeof CATEGORY_LABEL] ??
              prueba.category}
          </Badge>
          <Badge variant="outline" className="px-2.5 py-1">
            {prueba.format === 'EQUIPOS' ? 'Equipos' : 'Individual'}
          </Badge>
          <PastillaDirectoDePrueba
            enlace={prueba.enlaceDirecto ?? evento.enlaceDirecto}
            fecha={prueba.competitionDate}
            evento={evento}
            hoy={hoy}
            clase="-my-2.5 ml-auto"
          />
        </div>
      ) : null}

      {evento.competitions.length > 1 ? (
        /*
          Chips de 32 px que se parten en líneas: un carril que se desplaza
          de lado dejaba la última prueba cortada y sin aviso de que había
          más. Se elige una y sólo una, así que cada chip es un botón con
          `aria-pressed` y el marcado es el del sistema (invertido).

          En el móvil van dos por fila, fijas: con `flex-wrap` el reparto
          cambiaba al llegar la condensada y la ficha entera saltaba (CLS
          0,18 a 393 y 412 px).
        */
        <FilaChips etiqueta="Prueba del torneo" envolver className="grid grid-cols-2 sm:flex">
          {evento.competitions.map((c) => (
            <ChipFiltro
              key={c.id}
              marcado={c.id === elegida}
              onClick={() => setElegida(c.id)}
              className="w-full justify-center sm:w-auto"
            >
              <span className="cifra text-[14px] leading-none">{WEAPON_SHORT[c.weapon]}</span>{' '}
              <span>
                {GENDER_SHORT[c.gender]}
                {variasCategorias
                  ? ` ${CATEGORY_SHORT[c.category] ??
                    CATEGORY_LABEL[c.category as keyof typeof CATEGORY_LABEL] ??
                    c.category}`
                  : ''}
                {c.format === 'EQUIPOS' ? ', equipos' : ''}
              </span>
            </ChipFiltro>
          ))}
        </FilaChips>
      ) : null}

      {evento.competitions.length > 1 && prueba && (prueba.enlaceDirecto ?? evento.enlaceDirecto) ? (
        <div className="-mt-3 -mb-2 flex justify-end">
          <PastillaDirectoDePrueba
            enlace={prueba.enlaceDirecto ?? evento.enlaceDirecto}
            fecha={prueba.competitionDate}
            evento={evento}
            hoy={hoy}
          />
        </div>
      ) : null}

      {/*
        Solo en un torneo ya tirado, y la banda se pinta sola o no se pinta:
        sin podio ni enlace oficial no existe (ver `ficha/resultados-torneo.tsx`).
        Antes iba al final para todos los torneos con «sin edición vinculada»,
        que era una frase en cada ficha y nunca un resultado.
      */}
      {terminado ? (
        <ResultadosTorneo
          eventoId={evento.id}
          retorno={retornoCalendario}
          pruebaElegida={prueba?.id ?? null}
        />
      ) : null}

      {prueba ? (
        <>
          {terminado ? null : <BandaPlazo evento={evento} prueba={prueba} />}
          <BandaDondeYCuando evento={evento} prueba={prueba} principal={!terminado} />
          <BandaEstasDentro
            evento={evento}
            prueba={prueba}
            inscritos={inscritos}
            fallo={falloInscritos}
          />
        </>
      ) : null}

      <BandaConvocatoria evento={evento} prueba={prueba} />
    </div>
  );
}


// ---------------------------------------------------------------------------
// 1 · El plazo, que es lo que se viene a mirar
// ---------------------------------------------------------------------------

/**
 * Cuánto queda, cuánto cuesta y qué piden, juntos.
 *
 * La cuota vivía en «La prueba», cuatro bandas más abajo, con la misma letra
 * que el formato y el género. Y es la otra mitad de la pregunta del plazo: si
 * me paso de hoy, ¿cuánto me cuesta? Con `+15 €` dibujado en la barra y la
 * cuota base fuera de la pantalla no se podía sumar. Por eso la banda se llama
 * «Inscripción» y no «Plazo»: lleva el plazo y las condiciones.
 */
function BandaPlazo({
  evento,
  prueba,
}: {
  evento: EventView;
  prueba: CompetitionView;
}) {
  const tono = TONO[prueba.status.state];
  const dias = prueba.status.daysLeft;

  const plazosDelPapel = [
    ...plazosDeConvocatoria(prueba.datosExtraidos),
    ...plazosDeConvocatoria(evento.datosExtraidos),
  ];

  /**
   * El marcador solo aparece cuando hay una cuenta atrás.
   *
   * Con el plazo cerrado decía «cerrado» arriba a la derecha y la cola de la
   * barra decía «cerrado» justo debajo: la misma palabra dos veces en dos
   * centímetros. Cuando no hay cuenta atrás, el estado lo escribe la barra,
   * que es donde se ve por qué (toda gris, con la cola encendida).
   */
  const hayCuenta = dias !== null && !prueba.status.closed;

  return (
    <Banda
      titulo="Inscripción"
      cifra={hayCuenta ? dias : undefined}
      rotulo={
        hayCuenta ? `${dias === 1 ? 'día' : 'días'}, ${tono.palabra}` : undefined
      }
      tono={tono.texto}
    >
      {/*
        La barra de tramos. No es un eje de tiempo y no debe serlo: lee su
        cabecera antes de tocarla.
        El estado escrito se apaga aquí porque ya está en el marcador de la
        banda, con su palabra y su color; dejarlo en los dos sitios era la
        misma frase dos veces en cuatro centímetros.
      */}
      <BarraPlazos
        plazos={prueba.deadlines}
        estado={prueba.status}
        conEstado={!hayCuenta}
      />

      {/*
        Cuotas, cupos, edad mínima, forma de pago y requisitos, juntos: es lo
        que hay que saber antes de apuntarse, y venía repartido entre esta
        banda y una lista de frases del PDF al final de la ficha.
      */}
      <TarjetaInscripcion evento={evento} prueba={prueba} />

      {/*
        Un plazo que aparece en la convocatoria y no en el calendario. No entra
        en la barra —la barra son los plazos oficiales de inscripción— pero
        decirlo es información: en las concentraciones el límite para pedir
        alojamiento va antes que todo lo demás.
      */}
      {plazosDelPapel.map((d) => (
        <ParDato
          key={d.id}
          linea={{
            clave: d.id,
            rotulo: conceptoDe(d) ? `Plazo · ${conceptoDe(d)}` : 'Otro plazo',
            valor: fechaSuelta(d.valor),
            dato: d,
          }}
        />
      ))}
    </Banda>
  );
}

/**
 * El trozo de después del punto en `fee_eur.alojamiento`, legible.
 *
 * Devuelve cadena vacía cuando el sufijo es un código interno (`deadline.L1`,
 * `deadline.FIE_D7`): «(L1)» en pantalla no significa nada para nadie y
 * además delata la columna de la base de datos. La cita explica de qué plazo
 * habla el documento, que es lo que hace falta.
 */
function conceptoDe(d: DatoExtraidoView): string {
  const resto = d.campo.split('.').slice(1).join(' ').replace(/[-_]+/g, ' ').trim();
  if (/^(l\d|fie d\d+|d\d+)$/i.test(resto)) return '';
  return resto;
}

/** Una fecha que llega como texto del PDF: se formatea si se puede. */
function fechaSuelta(valor: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(valor) ? formatDateEs(valor) : valor;
}

// ---------------------------------------------------------------------------
// 2 · Dónde y cuándo
// ---------------------------------------------------------------------------

/**
 * El pabellón y la línea del día, en la misma banda.
 *
 * QUÉ ARREGLA ESTO, con los números de la base: de 274 eventos, 246 no traen
 * pabellón y de 484 pruebas solo 23 traen hora de inicio. Las dos cosas están
 * en el PDF de la convocatoria y ya se han extraído. Así que esta banda es
 * casi siempre la que gana algo, y por eso el pabellón leído del papel va
 * donde iría el publicado, y no en una lista aparte de «campos extraídos».
 */
function BandaDondeYCuando({
  evento,
  prueba,
  principal,
}: {
  evento: EventView;
  prueba: CompetitionView;
  /** ¿«Cómo llegar» es la acción principal de la ficha? Solo si está por venir. */
  principal: boolean;
}) {
  const { sede, sedeLeida, direccion, direccionLeida, otraSede, extras } = sedeDe(evento);

  /**
   * Los mapas se calculan con la sede QUE SE ESTÁ ENSEÑANDO, incluida la que
   * salió del PDF: si la ficha dice «Polideportivo Benimaclet» y el botón
   * abre el centro de Valencia, el botón está roto.
   */
  const mapas = mapsLinks({
    venue: sede,
    venueAddress: direccion,
    city: evento.city,
    country: evento.country,
    geoLat: evento.geoLat,
    geoLon: evento.geoLon,
  });

  const haySede = Boolean(sede || direccion || mapas || evento.officialSite);
  // Sin sede, sin horario y sin huso no queda nada que enseñar: ni el titular.
  if (!haySede && !evento.timezone && horariosDelTorneo(evento).dias.length === 0) return null;

  return (
    <Banda titulo="Dónde y cuándo">
      {haySede ? (
      <Tarjeta titulo="Sede">
        {sede ? (
          <CitaConvocatoria dato={sedeLeida}>
            <span className="text-[16px] leading-[20px] font-medium">
              {titular(sede)}
              {sedeLeida ? (
                <MarcaConvocatoria className="ml-1.5 size-3.5 text-muted-foreground" />
              ) : null}
            </span>
          </CitaConvocatoria>
        ) : null}

        {/*
          La dirección en una línea, con la bandera delante, y es el enlace al
          mapa: en el móvil la dirección entera ocupaba tres renglones y debajo
          iba otro botón para lo mismo. Completa, en el `title` y en el mapa.
          Solo aparece cuando hay pabellón o dirección; sin eso sería repetir
          la ciudad que la cabecera ya escribe.
        */}
        {sede || direccion ? (
          <LineaDireccion
            pais={evento.country}
            texto={direccion ? titular(direccion) : evento.city ? titular(evento.city) : ''}
            mapa={mapas?.google ?? null}
            leida={direccionLeida}
          />
        ) : null}

        {/*
          Si el PDF nombra otra sede, manda la publicada; la otra queda como
          un dato más, sin frase que explique de dónde sale.
        */}
        {otraSede ? (
          <ParDato
            linea={{ clave: otraSede.id, rotulo: 'Otra sede', valor: titular(otraSede.valor), dato: otraSede }}
          />
        ) : null}

        {/*
          POR DÓNDE SE ENTRA, que no es la dirección del recinto. Petición
          literal: *«si sabemos ya por dónde es el acceso, ponlo directo»*. En
          Lima el pabellón es «VELODROMO - CAR VIDENA (GATE 7)» y la entrada
          está en otra calle.
        */}
        <AccesoAlPabellon evento={evento} direccion={direccion} />

        {extras.length > 0 ? (
          <div className="grid grid-cols-2 items-start gap-x-4 gap-y-2">
            {extras.map((l) => (
              <ParDato key={l.clave} linea={l} />
            ))}
          </div>
        ) : null}

        {/*
          Con dirección, el mapa se abre desde ella. Sin pabellón ni dirección
          queda el botón «Mapa», que lleva a la ciudad: prometer «Cómo llegar»
          al centro de una ciudad extranjera es peor que no tener botón.
        */}
        {(mapas && !sede && !direccion) || evento.officialSite ? (
          <div className="flex flex-wrap items-center gap-2">
            {mapas && !sede && !direccion ? (
              <Button
                size={principal ? 'default' : 'sm'}
                variant={principal ? 'default' : 'outline'}
                className={cn(principal ? 'w-full sm:w-fit' : 'rounded-full')}
                asChild
              >
                <a href={mapas.google} target="_blank" rel="noreferrer">
                  <Navigation />
                  Mapa
                </a>
              </Button>
            ) : null}
            {evento.officialSite ? (
              <Button variant="outline" size="sm" className="rounded-full" asChild>
                <a href={evento.officialSite} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Web
                </a>
              </Button>
            ) : null}
          </div>
        ) : null}
      </Tarjeta>
      ) : null}

      {/*
        Qué hora es allí y qué hora es donde estás, ya convertida. Sustituye a
        «7 horas más que en España (allí van adelantados)», que obligaba a
        hacer la cuenta y daba por hecho que quien mira está en España. Ver
        `ficha/horas.tsx`.
      */}
      <RelojSede evento={evento} />

      {/*
        LOS HORARIOS, DÍA A DÍA. El torneo entero, con todos los hitos que se
        sepan de cada prueba y de cada día, en hora de la sede y en la tuya; la
        prueba que se está mirando va destacada. Ver `horarios-torneo.tsx`.
      */}
      <HorariosTorneo evento={evento} prueba={prueba} />
    </Banda>
  );
}


// ---------------------------------------------------------------------------
// 3 · ¿Estás dentro?
// ---------------------------------------------------------------------------

/**
 * La lista oficial de inscritos, que es la pregunta del usuario con sus
 * palabras: *«si estoy o no»*, *«porque igual le ha inscrito otra persona»*.
 *
 * Es la lista que **publica la organización**, y es la única que se enseña.
 * Las solicitudes tramitadas desde aquí se fueron con el flujo de inscripción:
 * una solicitud sin validar no es estar dentro, y enseñarla al lado de la
 * oficial hacía que alguien cogiese un vuelo creyendo que sí.
 *
 * El recuento va de marcador, grande, y es nuestro equivalente del «52
 * nations, 477 athletes» de la ficha de torneo de la FIE: un número real que
 * le da peso a la pantalla sin inventar nada.
 */
export function BandaEstasDentro({
  evento,
  prueba,
  inscritos,
  fallo = false,
}: {
  evento: EventView;
  prueba: CompetitionView;
  inscritos: QuienVaDatos | null;
  fallo?: boolean;
}) {
  /**
   * La lista completa va plegada. Un TNR absoluto tiene 107 inscritos, y
   * ciento siete nombres seguidos entierran el resto de la ficha.
   */
  const [todos, setTodos] = React.useState(false);
  React.useEffect(() => setTodos(false), [prueba.id]);

  const oficiales = (inscritos?.oficiales ?? []).filter(
    (i) => i.competitionId === prueba.id,
  );
  const estasDentro = oficiales.some((o) => o.esMio);

  const ASOMAN = 6;
  // Los tuyos primero: es lo que se viene a mirar.
  const ordenados = [...oficiales].sort(
    (a, b) => Number(b.esMio) - Number(a.esMio),
  );
  const visibles = todos ? ordenados : ordenados.slice(0, ASOMAN);
  const ocultos = ordenados.length - visibles.length;

  /**
   * El marcador, y solo cuando hay a quien contar.
   *
   * Un «0» gigante al lado de «Todavía no hay lista» es la misma cosa dicha
   * dos veces, y además el cero de la organización no significa «no va nadie»
   * sino «todavía no han abierto». Cuando no hay nadie, lo cuenta el estado
   * vacío con palabras.
   */
  const conteo =
    inscritos === null
      ? null
      : oficiales.length > 0
        ? { n: oficiales.length, rotulo: 'inscritos' }
        : prueba.registrationCount && prueba.registrationCount > 0
          ? { n: prueba.registrationCount, rotulo: 'inscritos' }
          : null;

  /**
   * Depende de «hay lectura retenida y la última falló», no de las filas de
   * esta prueba: una lista válida pero vacía que no se pudo refrescar tampoco
   * debe pasar por «vacía» sin matiz.
   */
  const avisoDeFallo =
    inscritos !== null && fallo ? (
      <p role="alert" className="text-[13px] text-warn">
        La última lectura falló.
      </p>
    ) : null;

  // Sin lista publicada la banda entera sobra: no hay nada que mirar todavía.
  const sinLista =
    inscritos !== null && !fallo && oficiales.length === 0 && inscritos.estados[prueba.id] !== 'vacia';
  if (sinLista) return null;
  // Mientras llega tampoco se reserva su hueco ni se pinta un esqueleto: la
  // lista se pide al mostrar intención de abrir la ficha y casi siempre ya está.
  if (inscritos === null && !fallo) return null;

  return (
    <Banda
      titulo="¿Estás dentro?"
      cifra={conteo?.n}
      rotulo={conteo?.rotulo}
    >
      {inscritos === null ? (
        <p role="alert" className="text-[14px] text-warn">
          No se ha podido leer la lista de inscritos.
        </p>
      ) : oficiales.length === 0 ? (
        <>
          {/*
            Vacío en una línea y sin explicar por qué: `UI.md`, 2 bis. Lo que
            importa es la respuesta —no hay lista, o está vacía—, no quién la
            publica ni cuándo.
          */}
          <p className="text-[14px] text-muted-foreground">
            {inscritos?.estados[prueba.id] === 'vacia' ? 'Lista vacía' : 'Todavía no hay lista'}
          </p>
        {avisoDeFallo}
        </>
      ) : (
        <>
          {estasDentro ? (
            <p className="flex items-center gap-2 text-[14px] font-medium text-ok">
              <CircleCheck className="size-[16px] shrink-0" aria-hidden />
              Estás en la lista oficial.
            </p>
          ) : null}

          <ItemGroup className="divide-y overflow-hidden rounded-md border">
            {visibles.map((i, n) => (
              <Item
                key={`${i.competitionId}-${i.equipo ?? ''}-${i.nombre}-${n}`}
                size="sm"
                className={cn(
                  'rounded-none px-3 py-1.5',
                  i.esMio && 'bg-marcado',
                )}
              >
                <ItemContent className="min-w-0">
                  <ItemTitle className="w-full min-w-0 flex-wrap text-[14px] leading-[20px]">
                    <span className="min-w-0 break-words">{titular(i.nombre)}</span>
                    {i.esMio ? (
                      <Badge variant="secondary" className="ml-1">
                        tú
                      </Badge>
                    ) : null}
                  </ItemTitle>
                </ItemContent>
                {i.club ? (
                  <ItemActions className="min-w-0 basis-full break-words text-[13px] text-muted-foreground sm:basis-auto">
                    {titular(i.club)}
                  </ItemActions>
                ) : null}
              </Item>
            ))}
          </ItemGroup>

          {ocultos > 0 ? (
            <Button
              variant="outline"
              size="sm"
              className="self-start rounded-full"
              onClick={() => setTodos(true)}
            >
              <ChevronDown />
              Ver todos ({oficiales.length})
            </Button>
          ) : null}

          {avisoDeFallo}
        </>
      )}
    </Banda>
  );
}

// ---------------------------------------------------------------------------
// 4 · Convocatoria y fuentes
// ---------------------------------------------------------------------------

/**
 * Los papeles del torneo y de dónde sale todo esto.
 *
 * Tres bandas de una línea cada una —«Documentos», «En directo», «De dónde
 * sale»— eran tres filetes y tres rótulos para enseñar dos enlaces. Aquí van
 * juntos, en filas iguales con su icono, que es lo que son: cosas que se
 * abren. Quién organiza y los enlaces que trae el PDF van debajo, los
 * enlaces **como botones con su dominio**, no como URLs pegadas.
 *
 * Al final, plegado, lo que se leyó de la convocatoria y no tiene sitio en
 * ningún otro grupo de la ficha. Es la red de seguridad: ningún dato extraído
 * desaparece, y ninguno sale dos veces (ver `ficha/datos-ficha.tsx`).
 */
function BandaConvocatoria({
  evento,
  prueba,
}: {
  evento: EventView;
  prueba: CompetitionView | null;
}) {
  const enlaces = enlacesDeConvocatoria(evento.datosExtraidos);
  const otros = otrosDatosDe(evento, prueba);
  const fuentes = enlacesDeFuente(evento);
  const organiza = organizaDe(evento);
  // Los de resultados van como pastilla junto a la prueba; aquí sólo las retransmisiones.
  const retransmisiones = evento.liveLinks.filter((l) => !esEnlaceDeResultados(l.kind));
  const hayAlgo =
    evento.documents.length > 0 ||
    retransmisiones.length > 0 ||
    enlaces.length > 0 ||
    otros.length > 0 ||
    fuentes.length > 0 ||
    organiza.quien !== null ||
    organiza.direccion !== null;
  if (!hayAlgo) return null;

  return (
    <Banda titulo="Convocatoria">
      {evento.documents.length > 0 || retransmisiones.length > 0 ? (
        <ItemGroup className="gap-1">
          {evento.documents.map((d) => (
            <Item key={d.id} asChild size="sm" variant="outline" className={FILA_ENLACE}>
              <a href={d.url} target="_blank" rel="noreferrer">
                <ItemMedia variant="icon" className="size-[32px]">
                  <FileText />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="text-[14px] leading-[20px]">
                    {titularDocumento(d.title)}
                  </ItemTitle>
                </ItemContent>
                <ItemActions>
                  <ExternalLink className="size-4 text-muted-foreground" />
                </ItemActions>
              </a>
            </Item>
          ))}

          {/*
            Retransmisiones (vídeo). Los resultados en directo de Engarde o
            Fencing Time Live van como pastilla junto a la prueba elegida.
          */}
          {retransmisiones.map((l) => (
            <Item key={l.id} asChild size="sm" variant="outline" className={FILA_ENLACE}>
              <a href={l.url} target="_blank" rel="noreferrer">
                <ItemMedia variant="icon" className="size-[32px] text-ok">
                  <Radio />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="text-[14px] leading-[20px]">
                    {l.label ? titular(l.label) : titular(l.platform)}
                  </ItemTitle>
                </ItemContent>
                <ItemActions>
                  <ExternalLink className="size-4 text-muted-foreground" />
                </ItemActions>
              </a>
            </Item>
          ))}

        </ItemGroup>
      ) : null}

      <TarjetaOrganiza evento={evento} />

      {/*
        Los enlaces que trae el PDF, en botones con el nombre del destino y no
        en URLs pegadas: «kotoden.co.jp», no
        «https://www.kotoden.co.jp/publichtm/bus/limousine/index-en.html». Van
        en pastilla pequeña y no en fila completa: son de la convocatoria y sin
        verificar, así que no pueden pesar lo mismo que el documento oficial
        que está justo encima. Al tocar la marca sale la frase del PDF.
      */}
      {enlaces.length > 0 ? (
        <Tarjeta titulo="Enlaces">
          <ul className="flex flex-wrap items-center gap-1.5">
            {enlaces.map((d) => (
              // El enlace cede y la marca de la cita no: juntos nunca pasan del ancho de la tarjeta.
              <li key={d.id} className="flex min-w-0 max-w-full items-center">
                <Button variant="outline" size="sm" className="min-w-0 shrink rounded-full" asChild>
                  <a
                    href={urlAbsoluta(d.valor)}
                    target="_blank"
                    rel="noreferrer"
                    title={d.valor}
                  >
                    <ExternalLink />
                    <span className="truncate">{nombreDeEnlace(d)}</span>
                  </a>
                </Button>
                <CitaConvocatoria dato={d} className="mx-0 shrink-0 px-[4px]">
                  <span className="flex size-[32px] items-center justify-center text-muted-foreground">
                    <MarcaConvocatoria />
                  </span>
                </CitaConvocatoria>
              </li>
            ))}
          </ul>
        </Tarjeta>
      ) : null}

      <OtrosDatos datos={otros} />

      {/*
        Procedencia, en pastillas calladas con el nombre de la fuente y nada
        más (`UI.md`, 2 bis: sin «Ver en…» ni «Publicado como…»; el nombre
        tal y como lo publica va en el `title`). Las DOS fuentes cuando el
        torneo llega por dos caminos:
        una Copa del Mundo aparece en el calendario de la RFEE y en el de la
        FIE y aquí se enseña como una sola tarjeta. Los dos enlaces tienen que
        estar: el de Skermo porque es donde se inscribe un español, y el de la
        FIE porque sus condiciones exigen enlazar al original de lo que se
        muestra.
        Cuando exista `src/components/escudo.tsx` (es de otro agente), el
        nombre de la fuente lleva delante su escudo y esto no cambia más.
      */}
      {fuentes.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {fuentes.map((f) => (
            <Button
              key={f.source}
              variant="ghost"
              size="sm"
              className="rounded-full text-muted-foreground"
              asChild
            >
              <a href={f.url} target="_blank" rel="noreferrer" title={evento.name}>
                <ExternalLink />
                {SOURCE_LABEL[f.source] ?? f.source}
              </a>
            </Button>
          ))}
        </div>
      ) : null}
    </Banda>
  );
}

/** Documentos y retransmisiones en filas de 44 px: con `size="sm"` en rem y la raíz de 18 px medían 65. */
const FILA_ENLACE = 'min-h-[44px] gap-[12px] px-[12px] py-[6px]';

/** Los enlaces del PDF llegan a veces sin esquema («www.uvehoteles.com»). */
function urlAbsoluta(valor: string): string {
  return /^https?:\/\//i.test(valor) ? valor : `https://${valor}`;
}

/**
 * Un enlace por fuente, no uno por fila.
 *
 * La FIE publica una página por prueba, así que un torneo con cuatro armas
 * traía cuatro enlaces «Ver en FIE» seguidos, todos con el mismo aspecto. Se
 * queda el primero de cada fuente: lo que se le ofrece a la persona es «mira
 * esto en el original», no un índice de la base de datos.
 */
function enlacesDeFuente(evento: EventView): { source: string; url: string }[] {
  const brutos =
    evento.sources.length > 0
      ? evento.sources
      : evento.sourceUrl
        ? [{ source: evento.source, url: evento.sourceUrl }]
        : [];

  const vistas = new Set<string>();
  const salida: { source: string; url: string }[] = [];
  for (const f of brutos) {
    if (!f.url || vistas.has(f.source)) continue;
    vistas.add(f.source);
    salida.push({ source: f.source, url: f.url });
  }
  return salida;
}
