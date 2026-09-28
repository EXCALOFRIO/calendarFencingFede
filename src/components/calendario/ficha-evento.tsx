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
import { ButtonGroup } from '@/components/ui/button-group';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { BanderaPais } from '@/components/bandera';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type {
  CompetitionView,
  DatoExtraidoView,
  EventView,
} from '@/lib/queries/calendar';
import { mapsLinks, timezoneInfo } from '@/lib/travel';
import { BarraPlazos } from './barra-plazos';
import { AccesoAlPabellon, HorariosTorneo } from './horarios-torneo';
import {
  CitaConvocatoria,
  MarcaConvocatoria,
  contradiccion,
  enlacesDeConvocatoria,
  esImporte,
  huecoDe,
  nombreDeEnlace,
  plazosDeConvocatoria,
} from './datos-convocatoria';
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
  formatEur,
  titular,
  titularDocumento,
} from '@/lib/utils';
import type { QuienVa as QuienVaDatos } from '@/app/(app)/inscritos';
import { detalleDelEvento } from '@/app/(app)/detalle-evento';
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
 *   1. **Plazo de inscripción** — la barra de tramos, la cuota y los importes
 *      del papel. Antes: «Plazo» + la cuota perdida dentro de «La prueba».
 *      Cuánto queda y cuánto cuesta son la misma decisión.
 *   2. **Dónde y cuándo** — pabellón, dirección, mapa, diferencia horaria y la
 *      línea del día con las horas. Antes: «Cómo llegar» + «Horario». Las dos
 *      son lo mismo: dónde tengo que estar y a qué hora.
 *   3. **¿Estás dentro?** — la lista oficial de inscritos. Antes «Quién va»,
 *      con un rótulo que no era la pregunta que se viene a hacer.
 *   4. **Convocatoria y fuentes** — documentos, retransmisión, enlaces del
 *      PDF y procedencia. Antes: «Documentos» + «En directo» + «De dónde
 *      sale», tres bandas de una línea cada una.
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
 * mejora.
 */
function useConDatosDeLosPdfs(base: EventView): EventView {
  const [leidos, setLeidos] = React.useState<EventView | null>(null);

  React.useEffect(() => {
    let vigente = true;
    setLeidos(null);
    detalleDelEvento(base.id)
      .then((r) => {
        if (vigente) setLeidos(r);
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
    return {
      ...base,
      datosExtraidos: leidos.datosExtraidos,
      competitions: base.competitions.map((c) => ({
        ...c,
        datosExtraidos: porPrueba.get(c.id) ?? [],
      })),
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
      <header className="flex items-end justify-between gap-3">
        <h3 className="text-xl leading-none sm:text-lg">{titulo}</h3>
        {cifra !== undefined || rotulo ? (
          <p className={cn('flex shrink-0 items-baseline gap-1.5', tono)}>
            {cifra !== undefined && cifra !== null ? (
              <span className="cifra text-3xl sm:text-2xl">{cifra}</span>
            ) : null}
            {rotulo ? (
              <span
                className={cn(
                  'text-sm sm:text-xs',
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

/**
 * Un par rótulo/valor de la ficha: rótulo apagado y pequeño encima, valor en
 * blanco y grande debajo. Nunca al revés — es la jerarquía de cualquier ficha
 * de deportista que funcione.
 *
 * Cuando el valor viene de un PDF, `dato` lo convierte en tocable y sale la
 * frase literal de la que se sacó.
 */
function Par({
  rotulo,
  valor,
  dato,
  className,
}: {
  rotulo: string;
  valor: React.ReactNode;
  dato?: DatoExtraidoView | null;
  className?: string;
}) {
  return (
    <CitaConvocatoria dato={dato ?? null} className={cn('py-0.5', className)}>
      <div className="flex min-w-0 flex-col">
        <span className="text-sm text-muted-foreground sm:text-xs">{rotulo}</span>
        <span
          className={cn(
            'text-base font-medium sm:text-sm',
            dato && dato.estado !== 'aprobado' && 'text-muted-foreground',
          )}
        >
          {dato ? <MarcaConvocatoria className="mr-1.5 opacity-70" /> : null}
          {valor}
        </span>
      </div>
    </CitaConvocatoria>
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
}: {
  evento: EventView;
  tirador: TiradorOpcion | null;
  /**
   * `inscripciones` y `onSolicitar` siguen en el tipo porque los pasa
   * `vista.tsx`, que es de otro agente: la ficha ya no tramita inscripciones
   * y no los usa. Se quitan de los dos sitios a la vez, no antes.
   */
  inscripciones?: Record<string, string>;
  onSolicitar?: (competitionId: string) => Promise<void>;
  /** Quién va, por prueba. `null` mientras se está pidiendo. */
  inscritos: QuienVaDatos | null;
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
        </div>
      ) : null}

      {evento.competitions.length > 1 ? (
        <ToggleGroup
          type="single"
          value={elegida}
          onValueChange={(v) => v && setElegida(v)}
          variant="outline"
          spacing={1.5}
          aria-label="Prueba del torneo"
          /*
            SE PARTE EN VARIAS LÍNEAS, NO SE DESPLAZA DE LADO.
            Era un carril con `overflow-x-auto` y `no-scrollbar`: con dos
            pastillas cabía, y desde que la tarjeta enseña también las pruebas
            por equipos son cuatro (seis en veinte torneos), así que la última
            quedaba cortada a media palabra y sin nada que dijera que había
            más a la derecha. Un contenido escondido sin aviso no existe.
            Partido en líneas se lee entero, que es la regla de la casa.
          */
          className="w-full max-w-full flex-wrap justify-start py-0.5"
        >
          {evento.competitions.map((c) => (
            <ToggleGroupItem
              key={c.id}
              value={c.id}
              /*
                Solo la forma. El estado marcado lo pone `toggleVariants`, y
                aquí NO se repite a propósito.

                Había tres clases de `data-[state=on]` escritas a mano
                —borde tenue, fondo secundario, texto normal— y con
                `tailwind-merge` **ganaban a la convención de la casa**, así que
                cuando lo marcado pasó a llevar el rojo de la aplicación, esta
                pastilla se quedó siendo **el único control marcado de toda la
                interfaz que seguía en gris**. Un caso particular escrito a mano
                no se nota el día que se escribe; se nota el día que se cambia
                la regla general y este sitio no se entera.
              */
              className="h-auto gap-1.5 rounded-full px-3 py-1.5"
            >
              <span className="cifra text-base leading-none sm:text-sm">
                {WEAPON_SHORT[c.weapon]}
              </span>
              <span className="text-sm leading-none sm:text-xs">
                {GENDER_SHORT[c.gender]}{' '}
                {CATEGORY_SHORT[c.category] ??
                  CATEGORY_LABEL[c.category as keyof typeof CATEGORY_LABEL] ??
                  c.category}
                {c.format === 'EQUIPOS' ? ' · equipos' : ''}
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      ) : null}

      {prueba ? (
        <>
          <BandaPlazo evento={evento} prueba={prueba} />
          <BandaDondeYCuando evento={evento} prueba={prueba} />
          <BandaEstasDentro
            evento={evento}
            prueba={prueba}
            inscritos={inscritos}
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
 * Cuánto queda y cuánto cuesta, juntos.
 *
 * La cuota vivía en «La prueba», cuatro bandas más abajo, con la misma letra
 * que el formato y el género. Y es la otra mitad de la pregunta del plazo: si
 * me paso de hoy, ¿cuánto me cuesta? Con `+15 €` dibujado en la barra y la
 * cuota base fuera de la pantalla no se podía sumar.
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
      titulo="Plazo de inscripción"
      cifra={hayCuenta ? dias : undefined}
      rotulo={
        hayCuenta ? `${dias === 1 ? 'día' : 'días'} · ${tono.palabra}` : undefined
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
        AQUÍ IBA LA CUOTA Y SE HA IDO DE LA TARJETA.

        Estaban la cuota de inscripción de marcador, las pastillas de los otros
        importes (equipos, cadete, júnior, extranjeros) y, en la lista de lo
        leído del PDF, la multa por árbitro que falte y los tramos de árbitros
        obligatorios. Petición literal del usuario, sobre la ficha de Lima:
        *«lo del precio porfa quítalo que no lo quiero mostrar, lo de la
        inscripción y lo de los equipos cuánto cuesta, ni el árbitro; lo de
        cuotas ocúltalo de las tarjetas»*.

        NO se deja de extraer ni se borra nada: los importes siguen leyéndose,
        guardados con su cita y visibles en Gestión › Extracción, que es donde
        los mira quien tramita. Lo que se quita es enseñárselos al tirador.
        El filtro está en `esImporte`, un sitio, para que valga igual aquí y en
        la lista de frases del PDF.
      */}

      {/*
        Un plazo que aparece en la convocatoria y no en el calendario. No entra
        en la barra —la barra son los plazos oficiales de inscripción— pero
        decirlo es información: en las concentraciones el límite para pedir
        alojamiento va antes que todo lo demás.
      */}
      {plazosDelPapel.map((d) => (
        <CitaConvocatoria key={d.id} dato={d}>
          <p className="text-sm text-muted-foreground">
            <MarcaConvocatoria className="mr-1.5 opacity-70" />
            La convocatoria menciona otra fecha límite:{' '}
            <span className="tabular-nums">{fechaSuelta(d.valor)}</span>
            {conceptoDe(d) ? ` (${conceptoDe(d)})` : ''}.
          </p>
        </CitaConvocatoria>
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
}: {
  evento: EventView;
  prueba: CompetitionView;
}) {
  /**
   * ¿Hay sede de verdad, o el campo «sede» repite la ciudad?
   *
   * Varias fuentes rellenan la sede con el nombre de la ciudad cuando todavía
   * no se sabe el pabellón. Si se toma al pie de la letra, la ficha pone «San
   * Salvador» dos veces seguidas y el botón promete llevarte a un pabellón que
   * no existe.
   */
  const normaliza = (v: string) =>
    v
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .trim()
      .toLowerCase();
  const sedePublicada =
    evento.venue && (!evento.city || normaliza(evento.venue) !== normaliza(evento.city))
      ? evento.venue
      : null;

  const sedeLeida = sedePublicada
    ? null
    : huecoDe(evento.datosExtraidos, 'venue', evento.city);
  const sede = sedePublicada ?? sedeLeida?.valor ?? null;

  const direccionLeida = evento.venueAddress
    ? null
    : huecoDe(evento.datosExtraidos, 'venue_address', evento.city);
  const direccion = evento.venueAddress ?? direccionLeida?.valor ?? null;

  // Cuando la fuente ya publica la sede pero el papel dice otra, se dice.
  const otraSede = contradiccion(evento.datosExtraidos, 'venue', sedePublicada);

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
  const huso = timezoneInfo(evento.timezone, evento.startDate, evento.endDate);


  return (
    <Banda titulo="Dónde y cuándo">
      {/*
        El pabellón. Valor grande, rótulo pequeño encima, y la ciudad con su
        código de país al lado: cuando exista `src/components/bandera.tsx` (es
        de otro agente) el código se cambia por la bandera y aquí no hay que
        tocar nada más.
      */}
      {sede ? (
        <CitaConvocatoria dato={sedeLeida}>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm text-muted-foreground sm:text-xs">
              Pabellón
            </span>
            <span
              className={cn(
                'text-lg leading-tight font-medium sm:text-base',
                sedeLeida && sedeLeida.estado !== 'aprobado'
                  ? 'text-muted-foreground'
                  : '',
              )}
            >
              {sedeLeida ? (
                <MarcaConvocatoria className="mr-1.5 opacity-70" />
              ) : null}
              {titular(sede)}
            </span>
          </div>
        </CitaConvocatoria>
      ) : (
        /*
          Sin pabellón NO se rellena el hueco. Y se dice quién no lo publica:
          «todavía no está publicada» en una Copa del Mundo hace pensar que
          falla la aplicación, cuando lo que pasa es que la FIE no lo publica
          nunca.
        */
        <p className="text-sm text-muted-foreground">
          {evento.scope === 'INTERNACIONAL'
            ? 'La organización internacional no publica el pabellón.'
            : 'La sede todavía no está publicada.'}
        </p>
      )}

      {/*
        Dónde está eso, con la bandera delante.

        Es el patrón de la ficha de torneo de la FIE —«bandera + ciudad,
        país»— y lo pidió el usuario con esas palabras. La bandera es de otro
        agente (`src/components/bandera.tsx`) y **no es un emoji**: en Windows
        los indicadores regionales se pintan como dos letras sueltas, así que
        es el código de tres de la FIE en pastilla, que se lee igual en las
        tres plataformas.

        Esta línea solo aparece cuando hay pabellón o dirección, o sea cuando
        de verdad es «la dirección de la sede». Sin eso sería repetir la
        ciudad que la cabecera ya escribe.
      */}
      {sede || direccion ? (
        <CitaConvocatoria dato={direccionLeida}>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <BanderaPais pais={evento.country} tamaño="ficha" />
            <span className="min-w-0">
              {evento.city ? titular(evento.city) : null}
              {/*
                `titular()` también en la dirección: las convocatorias la
                escriben en mayúsculas («CARRER DE DANIEL BALACIART S/N») y en
                pantalla eso se lee como un grito, no como una calle.
              */}
              {direccion ? (
                <>
                  {evento.city ? ' · ' : null}
                  {direccionLeida ? (
                    <MarcaConvocatoria className="mr-1 opacity-70" />
                  ) : null}
                  {titular(direccion)}
                </>
              ) : null}
            </span>
          </p>
        </CitaConvocatoria>
      ) : null}

      {otraSede ? (
        <CitaConvocatoria dato={otraSede}>
          <p className="text-sm text-muted-foreground">
            <MarcaConvocatoria className="mr-1.5 opacity-70" />
            La convocatoria dice «{otraSede.valor}». Manda lo que publica la
            fuente.
          </p>
        </CitaConvocatoria>
      ) : null}

      {/*
        POR DÓNDE SE ENTRA, que no es la dirección del recinto.

        Se estaba leyendo del PDF y se quedaba en la lista de frases del final,
        plegada. Petición literal: *«si sabemos ya por dónde es el acceso,
        ponlo directo»*. Y no es un adorno: en Lima el pabellón es «VELODROMO -
        CAR VIDENA (GATE 7)» y la entrada está en otra calle.
      */}
      <AccesoAlPabellon evento={evento} />

      {/*
        La acción principal de la ficha, y la única con el color de acento.
        Cuando no hay pabellón el botón lleva a la ciudad y lo dice en su
        propio texto: un botón que promete el pabellón y abre el centro de una
        ciudad extranjera es peor que no tener botón.
      */}
      {mapas || evento.officialSite ? (
        <ButtonGroup className="w-full max-w-md">
          {mapas ? (
            <Button className="flex-1" asChild>
              <a href={mapas.google} target="_blank" rel="noreferrer">
                <Navigation />
                {sede ? 'Cómo llegar' : 'Abrir la ciudad en el mapa'}
              </a>
            </Button>
          ) : null}
          {evento.officialSite ? (
            <Button variant="outline" asChild>
              <a href={evento.officialSite} target="_blank" rel="noreferrer">
                Web del torneo
                <ExternalLink />
              </a>
            </Button>
          ) : null}
        </ButtonGroup>
      ) : null}

      {huso && (huso.diffHours !== 0 || huso.dstChangeDuringTrip) ? (
        <p className="text-sm text-muted-foreground">
          {huso.label}. Allí son las{' '}
          {/*
            La hora de allí es un reloj, y un reloj rompe la hidratación: el
            servidor pinta «00:48», el navegador hidrata un segundo después y
            puede leer «00:49». React lo cazaba como error #418 —«el texto del
            servidor no coincide»— en producción, y al no coincidir **rehace
            ese trozo del árbol ya pintado**, que es de donde salen saltos de
            maquetación tardíos.

            `suppressHydrationWarning` es la salida que React documenta justo
            para marcas de tiempo: se queda con la del servidor y no rehace
            nada. Que el minuto pueda ir un segundo atrasado da igual; lo que
            se quiere saber es si allí es de noche.
          */}
          <span
            suppressHydrationWarning
            className="tabular-nums text-foreground"
          >
            {huso.localTimeNow}
          </span>
          .
          {huso.dstNote ? (
            <span className="mt-1 block text-warn">{huso.dstNote}</span>
          ) : null}
        </p>
      ) : null}
      {/*
        LOS HORARIOS, DÍA A DÍA Y PRUEBA A PRUEBA.

        Aquí había UNA línea con los cuatro hitos de la prueba seleccionada, y
        se quedaba corta en cuanto el torneo dura más de un día, que es
        siempre: en las Copas del Mundo y en muchos TNR la individual es
        viernes y sábado y los equipos el domingo. Ahora se enseña el torneo
        entero, con todos los hitos que se sepan de cada prueba y de cada día,
        y la prueba que se está mirando va destacada. Ver `horarios-torneo.tsx`.
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
function BandaEstasDentro({
  evento,
  prueba,
  inscritos,
}: {
  evento: EventView;
  prueba: CompetitionView;
  inscritos: QuienVaDatos | null;
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
        ? { n: oficiales.length, rotulo: 'en la lista oficial' }
        : prueba.registrationCount && prueba.registrationCount > 0
          ? { n: prueba.registrationCount, rotulo: 'según la organización' }
          : null;

  return (
    <Banda
      titulo="¿Estás dentro?"
      cifra={conteo?.n}
      rotulo={conteo?.rotulo}
    >
      {inscritos === null ? (
        <div className="flex flex-col gap-2" aria-busy>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-4/5" />
          <span className="text-sm text-muted-foreground">
            Mirando quién va…
          </span>
        </div>
      ) : oficiales.length === 0 ? (
        /*
          El estado vacío, a la izquierda y compacto. Centrado medía 190 px en
          un iPhone para decir dos frases, y además era el único bloque
          centrado de una ficha entera alineada a la izquierda: se leía como
          pegado de otra pantalla.
        */
        /*
          `text-pretty` a mano: `Empty` trae `text-balance`, que iguala el
          largo de las líneas y en un panel estrecho parte la frase en cuatro
          renglones cortos con la caja medio vacía. Balancear sirve para un
          titular de tres palabras, no para dos frases.
        */
        <Empty className="items-start border p-4 text-left text-pretty md:p-4">
          <EmptyHeader className="max-w-none items-start gap-1 text-left">
            <EmptyTitle className="text-base">Todavía no hay lista</EmptyTitle>
            <EmptyDescription>
              {SOURCE_LABEL[evento.source] ?? evento.source} publica los
              inscritos cuando se cierra el plazo. En cuanto la publique, aquí
              sale tu nombre aunque te haya apuntado otra persona.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {estasDentro ? (
            <p className="flex items-center gap-2 text-base font-medium text-ok sm:text-sm">
              <CircleCheck className="size-5 shrink-0 sm:size-4" aria-hidden />
              Estás en la lista oficial.
            </p>
          ) : null}

          <ItemGroup className="divide-y overflow-hidden rounded-md border">
            {visibles.map((i) => (
              <Item
                key={`${i.competitionId}-${i.nombre}`}
                size="sm"
                className={cn(
                  'rounded-none px-3 py-1.5',
                  i.esMio && 'bg-primary/10',
                )}
              >
                <ItemContent>
                  <ItemTitle className="text-base sm:text-sm">
                    {titular(i.nombre)}
                    {i.esMio ? (
                      <Badge variant="secondary" className="ml-1">
                        tú
                      </Badge>
                    ) : null}
                  </ItemTitle>
                </ItemContent>
                {i.club ? (
                  <ItemActions className="text-sm text-muted-foreground sm:text-xs">
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
              className="w-full sm:w-fit"
              onClick={() => setTodos(true)}
            >
              Ver los {oficiales.length} inscritos
            </Button>
          ) : null}

          <p className="text-sm text-muted-foreground sm:text-xs">
            Lista publicada por{' '}
            {SOURCE_LABEL[oficiales[0].fuente] ?? oficiales[0].fuente}.
          </p>
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
 * abren. Los enlaces que trae el PDF entran en la misma lista **como
 * botones**, no como URLs pegadas.
 *
 * Al final, plegado, todo lo que se leyó de la convocatoria con su cita. Es la
 * red de seguridad del apartado: cualquier dato extraído que no tenga hueco
 * propio en la ficha sigue estando aquí, comprobable, y nada se enseña sin la
 * frase de la que sale.
 */
function BandaConvocatoria({
  evento,
  prueba,
}: {
  evento: EventView;
  prueba: CompetitionView | null;
}) {
  /**
   * Todo lo leído del PDF **menos el dinero**.
   *
   * Aquí salían la cuota de equipos, las de cadete y júnior, la multa de mil
   * euros por árbitro que falte y los tramos de árbitros obligatorios, que es
   * lo que el usuario señaló en la ficha de Lima y pidió ocultar. Se siguen
   * extrayendo y se ven en Gestión › Extracción; lo que no hacen es ocupar la
   * ficha del tirador.
   */
  const leidos = [
    ...evento.datosExtraidos,
    ...(prueba?.datosExtraidos ?? []),
  ].filter((d) => !esImporte(d.campo));
  const enlaces = enlacesDeConvocatoria(evento.datosExtraidos);
  const fuentes = enlacesDeFuente(evento);

  return (
    <Banda
      titulo="Convocatoria"
      cifra={leidos.length > 0 ? leidos.length : undefined}
      rotulo={leidos.length > 0 ? 'datos leídos del PDF' : undefined}
    >
      {evento.documents.length > 0 || evento.liveLinks.length > 0 ? (
        <ItemGroup className="gap-1">
          {evento.documents.map((d) => (
            <Item key={d.id} asChild size="sm" variant="outline">
              <a href={d.url} target="_blank" rel="noreferrer">
                <ItemMedia variant="icon">
                  <FileText />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="text-base sm:text-sm">
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
            Retransmisión y resultados en directo. Casi nunca hay: la RFEE
            publica los enlaces de Engarde cuando la competición está encima.
            Cuando aparecen, es lo único que se mira ese día, así que van con
            el verde del semáforo y su icono, no en una banda aparte.
          */}
          {evento.liveLinks.map((l) => (
            <Item key={l.id} asChild size="sm" variant="outline">
              <a href={l.url} target="_blank" rel="noreferrer">
                <ItemMedia variant="icon" className="text-ok">
                  <Radio />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="text-base sm:text-sm">
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
      ) : (
        <p className="text-sm text-muted-foreground">
          Esta fuente no publica convocatoria ni dossier para este torneo.
        </p>
      )}

      {/*
        Los enlaces que trae el PDF, en botones y no en URLs pegadas. Van en
        pastilla pequeña y no en fila completa: son de la convocatoria y sin
        verificar, así que no pueden pesar lo mismo que el documento oficial
        que está justo encima.
      */}
      {enlaces.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {enlaces.map((d) => (
            <Button
              key={d.id}
              variant="outline"
              size="sm"
              className="text-muted-foreground"
              asChild
            >
              <a href={urlAbsoluta(d.valor)} target="_blank" rel="noreferrer">
                <MarcaConvocatoria />
                {nombreDeEnlace(d)}
                <ExternalLink />
              </a>
            </Button>
          ))}
        </div>
      ) : null}

      {leidos.length > 0 ? (
        <Collapsible className="group/collapsible">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-start px-2">
              <MarcaConvocatoria />
              Ver las {leidos.length} frases del PDF
              <ChevronDown className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1">
            <ul className="flex flex-col divide-y rounded-md border">
              {leidos.map((d) => (
                <li key={d.id} className="flex flex-col gap-1 px-3 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="text-sm text-muted-foreground sm:text-xs">
                      {d.etiqueta}
                      {d.prueba ? ` · ${titular(d.prueba)}` : ''}
                    </span>
                    {/*
                      El VALOR pasa por `titular()` y la CITA no. Suena a
                      incoherencia y es justo lo contrario: el valor es un dato
                      que se va a leer, y las convocatorias lo escriben todo en
                      mayúsculas; la cita es la prueba de que el dato existe, y
                      una prueba retocada no prueba nada.
                    */}
                    <span
                      className={cn(
                        'min-w-0 text-base font-medium sm:text-sm',
                        d.estado === 'aprobado' ? '' : 'text-muted-foreground',
                      )}
                    >
                      {titular(d.valor)}
                    </span>
                  </div>
                  <blockquote className="border-l-2 pl-2 text-xs leading-snug text-muted-foreground">
                    «{d.cita.trim()}»
                  </blockquote>
                  {d.pisadoPorPublicado ? (
                    <p className="text-xs text-muted-foreground">
                      La fuente ya publica este dato; manda el publicado.
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="medida pt-2 text-sm text-muted-foreground sm:text-xs">
              Cada dato va con la frase original del PDF para poder mirarlo en
              el documento.
            </p>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      {/*
        Procedencia. Las DOS fuentes cuando el torneo llega por dos caminos:
        una Copa del Mundo aparece en el calendario de la RFEE y en el de la
        FIE y aquí se enseña como una sola tarjeta. Los dos enlaces tienen que
        estar: el de Skermo porque es donde se inscribe un español, y el de la
        FIE porque sus condiciones exigen enlazar al original de lo que se
        muestra.
        Cuando exista `src/components/escudo.tsx` (es de otro agente), el
        nombre de la fuente lleva delante su escudo y esto no cambia más.
      */}
      {fuentes.length > 0 ? (
        <ButtonGroup className="flex-wrap">
          {fuentes.map((f) => (
            <Button key={f.source} variant="outline" size="sm" asChild>
              <a href={f.url} target="_blank" rel="noreferrer">
                Ver en {SOURCE_LABEL[f.source] ?? f.source}
                <ExternalLink />
              </a>
            </Button>
          ))}
        </ButtonGroup>
      ) : null}

      {/*
        El nombre tal y como lo publica la fuente, en mayúsculas y sin
        retocar: es lo que hay que buscar si alguien va al original. Va en la
        letra más pequeña de la ficha porque es procedencia, no información.
      */}
      <p className="text-xs text-muted-foreground">
        Publicado como «{evento.name}» en{' '}
        {SOURCE_LABEL[evento.source] ?? evento.source}.
      </p>
    </Banda>
  );
}

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
