'use client';

import { CircleCheck, ExternalLink, FileText, Navigation, Radio } from 'lucide-react';
import * as React from 'react';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { Boton } from '@/components/sistema/boton';
import { VerMas } from '@/components/sistema/cabecera-seccion';
import { Pastilla } from '@/components/sistema/pastilla';
import { SelectorNiveles } from '@/components/sistema/selector-niveles';
import type {
  CompetitionView,
  DatoExtraidoView,
  EventView,
} from '@/lib/queries/calendar';
import { mapsLinks } from '@/lib/travel';
import { fechaCorta, hoyMadrid } from '@/lib/fechas';
import { resumenPlazo } from '@/lib/deadlines';
import { esEnlaceDeResultados } from '@/lib/calendario/enlaces-directo';
import { rotuloCategoria, rotuloPrueba } from '@/lib/sport/rotulos';
import { filasSelectorPruebas } from '@/lib/sport/selector-pruebas';

import { BarraPlazos } from './barra-plazos';
import { FilaInscrito } from './fila-inscrito';
import { PastillaDirectoDePrueba } from './enlace-directo';
import { HorariosTorneo, accesoVisible, horariosDelTorneo, tituloDeDia } from './horarios-torneo';
import {
  enlacesDeConvocatoria,
  nombreDeEnlace,
  plazosDeConvocatoria,
} from './datos-convocatoria';
import {
  FilasDatos,
  LineaDireccion,
  OtrosDatos,
  Tarjeta,
  TarjetaOrganiza,
  inscripcionDe,
  organizaDe,
  otrosDatosDe,
  sedeDe,
  type LineaDato,
} from './ficha/datos-ficha';
import { SegunConvocatoria, citasDe } from './ficha/segun-convocatoria';
import { RelojSede } from './ficha/horas';
import { sinDuplicadosEnPantalla } from '@/lib/entries/duplicados-pantalla';
import { ResultadosTorneo } from './ficha/resultados-torneo';
import { torneoTerminado } from './ficha/terminado';
import { SOURCE_LABEL, titular, titularDocumento } from '@/lib/utils';
import type { QuienVa as QuienVaDatos } from '@/app/(app)/inscritos';
import { fichaRecibida, leerFicha } from './ficha/precarga';
import type { TiradorOpcion } from './vista';

/**
 * ===========================================================================
 * LA FICHA DE UN TORNEO
 * ===========================================================================
 *
 * Arriba, el selector de la prueba (arma, género, modalidad y, si varía,
 * categoría) y una línea con su nombre. Debajo, cuatro bandas, cada una la
 * respuesta a una pregunta entera:
 *
 *   1. **Inscripción** — cuánto queda (pastilla en la cabecera), la barra de
 *      tramos con su lista y las condiciones: cuota, cupos, edad mínima,
 *      forma de pago y requisitos.
 *   2. **Dónde y cuándo** — la sede con su mapa, la hora de allí y la tuya, y
 *      el horario día a día.
 *   3. **¿Estás dentro?** — la lista oficial de inscritos.
 *   4. **Convocatoria** — documentos, retransmisión, quién organiza, enlaces
 *      del PDF y procedencia.
 *
 * Cuando el torneo ya se ha tirado la inscripción no le importa a nadie y
 * arriba van los **Resultados**.
 *
 * Todos los datos van en pares rótulo–valor, sin nada pegado detrás del valor.
 * Lo leído de un PDF se comprueba desde UN botón por banda, «Según la
 * convocatoria», que abre las frases literales (`ficha/segun-convocatoria.tsx`).
 *
 * Ya no se inscribe nadie desde aquí (*«solo ver calendario, si estoy o no»*):
 * lo que queda es de consulta, y el color de acento es de «cómo llegar».
 */

/**
 * El mismo torneo, con lo que dicen sus PDFs.
 *
 * El evento de `props` viene de `listEvents`, que no pide lo extraído ni los
 * plazos (son 250 eventos por carga). Aquí se pide el detalle al abrir la
 * ficha y se le pegan esos campos al evento que ya tenemos, sin sustituirlo:
 * `getEvent` devuelve TODAS las pruebas y el calendario puede estar filtrado.
 *
 * Mientras llega no hay ni esqueleto ni espera: la ficha se pinta con lo que
 * ya se sabe. Casi nunca hay que esperar: el detalle se pide al mostrar
 * intención de abrir la tarjeta (`ficha/precarga.ts`).
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
      // Que no se puedan leer los PDFs no puede tumbar la ficha.
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [base.id]);

  return React.useMemo(() => {
    if (!leidos) return base;
    const porPrueba = new Map(leidos.competitions.map((c) => [c.id, c.datosExtraidos]));
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
 * Una banda de la ficha: titular a la izquierda y, a la derecha, una cifra
 * con su rótulo (inscritos) o una pastilla de estado (plazo).
 */
function Banda({
  titulo,
  cifra,
  rotulo,
  accion,
  children,
}: {
  titulo: string;
  cifra?: number | null;
  rotulo?: string;
  accion?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-t border-filete pt-4">
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 className="text-xl leading-tight">{titulo}</h3>
        {cifra !== undefined && cifra !== null ? (
          <p className="flex shrink-0 items-baseline gap-2">
            <span className="cifra text-2xl leading-none">{cifra}</span>
            {rotulo ? <span className="text-sm text-muted-foreground">{rotulo}</span> : null}
          </p>
        ) : null}
        {accion}
      </header>
      {children}
    </section>
  );
}

/**
 * Contenido de la ficha de un torneo.
 *
 * Se elige una prueba y debajo se ve solo esa: un torneo tiene hasta ocho
 * pruebas y enseñarlas todas obliga a desplazarse por cosas que no te tocan.
 * La que te corresponde viene ya elegida.
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
   * `vista.tsx`: la ficha ya no tramita inscripciones y no los usa. Se quitan
   * de los dos sitios a la vez, no antes.
   */
  inscripciones?: Record<string, string>;
  onSolicitar?: (competitionId: string) => Promise<void>;
  /** Quién va, por prueba. `null` mientras se está pidiendo. */
  inscritos: QuienVaDatos | null;
  /** La última lectura falló: no es lo mismo que una lista vacía. */
  falloInscritos?: boolean;
}) {
  const evento = useConDatosDeLosPdfs(delCalendario);

  // Con qué prueba se abre: la del tirador que está mirando.
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
  const filas = React.useMemo(
    () =>
      filasSelectorPruebas(
        evento.competitions.map((c) => ({
          id: c.id,
          arma: c.weapon,
          genero: c.gender,
          categoria: c.category,
          formato: c.format,
        })),
        elegida,
      ),
    [evento.competitions, elegida],
  );
  const terminado = torneoTerminado(evento);
  const hoy = hoyMadrid();

  return (
    <div className="flex flex-col gap-4 px-4 pt-2 pb-10">
      {/*
        Un control, no una sección: una fila por dimensión que varía entre las
        pruebas del torneo, y nunca una combinación que no existe. Antes eran
        chips hechos a mano («FLO F, equipos») con otra forma de rotular que la
        cabecera de un torneo de una sola prueba.
      */}
      <SelectorNiveles filas={filas} onSeleccion={setElegida} />

      {prueba ? <CabeceraPrueba evento={evento} prueba={prueba} hoy={hoy} /> : null}

      {terminado ? (
        <ResultadosTorneo
          eventoId={evento.id}
          retorno={retornoCalendario}
          pruebaElegida={prueba?.id ?? null}
          competicion={prueba}
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

/**
 * La prueba que se está mirando, en una línea: «Espada femenina · Equipos»
 * con la categoría en pastilla y, si lo hay, el directo a la derecha.
 */
function CabeceraPrueba({ evento, prueba, hoy }: { evento: EventView; prueba: CompetitionView; hoy: string }) {
  const nombre = rotuloPrueba(
    { arma: prueba.weapon, genero: prueba.gender, formato: prueba.format },
    { categoria: 'nunca', formato: 'siempre' },
  );
  const categoria = rotuloCategoria(prueba.category);
  return (
    <div data-slot="cabecera-prueba" className="flex min-h-11 min-w-0 items-center justify-between gap-3">
      <p className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-base font-semibold text-foreground">{nombre}</span>
        {categoria ? <Pastilla tamano="md">{categoria}</Pastilla> : null}
      </p>
      <PastillaDirectoDePrueba
        enlace={prueba.enlaceDirecto ?? evento.enlaceDirecto}
        fecha={prueba.competitionDate}
        evento={evento}
        hoy={hoy}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1 · Inscripción
// ---------------------------------------------------------------------------

/**
 * Cuánto queda, cuánto cuesta y qué piden, juntos: si me paso de hoy, ¿cuánto
 * me cuesta? Con «+15 €» en la barra y la cuota fuera de la pantalla no se
 * podía sumar.
 */
function BandaPlazo({
  evento,
  prueba,
}: {
  evento: EventView;
  prueba: CompetitionView;
}) {
  const { cuotas, condiciones, requisitos } = inscripcionDe(evento, prueba);
  /*
    Un plazo que sólo dice la convocatoria no entra en la barra —la barra son
    los plazos oficiales de inscripción— pero es información: en las
    concentraciones el límite para pedir alojamiento va antes que todo.
  */
  const papel: LineaDato[] = [
    ...plazosDeConvocatoria(prueba.datosExtraidos),
    ...plazosDeConvocatoria(evento.datosExtraidos),
  ].map((d) => ({
    clave: d.id,
    rotulo: conceptoDe(d) ? `Plazo · ${conceptoDe(d)}` : 'Otro plazo',
    valor: fechaSuelta(d.valor),
    dato: d,
  }));
  const lineas = [...cuotas, ...condiciones, ...requisitos, ...papel];
  if (prueba.deadlines.length === 0 && lineas.length === 0) return null;

  const resumen = prueba.deadlines.length > 0 ? resumenPlazo(prueba.status) : null;

  return (
    <Banda
      titulo="Inscripción"
      accion={
        resumen ? (
          <Pastilla tamano="md" tono={resumen.tono} data-slot="estado-plazo">
            {resumen.texto}
          </Pastilla>
        ) : null
      }
    >
      {/* El estado completo ya lo dice la pastilla de la cabecera. */}
      <BarraPlazos plazos={prueba.deadlines} estado={prueba.status} conEstado={false} />

      {lineas.length > 0 ? (
        <Tarjeta titulo="Condiciones">
          <FilasDatos lineas={lineas} />
        </Tarjeta>
      ) : null}

      <SegunConvocatoria citas={citasDe(lineas)} />
    </Banda>
  );
}

/**
 * El trozo de después del punto en `deadline.alojamiento`, legible. Vacío
 * cuando el sufijo es un código interno (`deadline.L1`): «(L1)» no significa
 * nada para nadie y delata la columna de la base de datos.
 */
function conceptoDe(d: DatoExtraidoView): string {
  const resto = d.campo.split('.').slice(1).join(' ').replace(/[-_]+/g, ' ').trim();
  if (/^(l\d|fie d\d+|d\d+)$/i.test(resto)) return '';
  return resto;
}

/** Una fecha que llega como texto del PDF: se formatea si se puede. */
function fechaSuelta(valor: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(valor) ? fechaCorta(valor.slice(0, 10)) : valor;
}

// ---------------------------------------------------------------------------
// 2 · Dónde y cuándo
// ---------------------------------------------------------------------------

/**
 * El pabellón y el horario, en la misma banda: dónde tengo que estar y a qué
 * hora. De 274 eventos, 246 no traen pabellón y de 484 pruebas solo 23 traen
 * hora; las dos cosas están en el PDF, así que el pabellón leído va donde iría
 * el publicado.
 */
function BandaDondeYCuando({
  evento,
  prueba,
  principal,
}: {
  evento: EventView;
  prueba: CompetitionView;
  /** ¿«Mapa» es la acción principal de la ficha? Solo si está por venir. */
  principal: boolean;
}) {
  const { sede, sedeLeida, direccion, direccionLeida, otraSede, extras } = sedeDe(evento);
  const horario = horariosDelTorneo(evento);

  // Los mapas se calculan con la sede QUE SE ENSEÑA, incluida la leída del PDF.
  const mapas = mapsLinks({
    venue: sede,
    venueAddress: direccion,
    city: evento.city,
    country: evento.country,
    geoLat: evento.geoLat,
    geoLon: evento.geoLon,
  });

  const acceso = accesoVisible(evento, direccion);
  const lineas: LineaDato[] = [
    ...(acceso ? [{ clave: acceso.id, rotulo: 'Acceso', valor: acceso.valor, dato: acceso }] : []),
    ...(otraSede ? [{ clave: otraSede.id, rotulo: 'Otra sede', valor: titular(otraSede.valor), dato: otraSede }] : []),
    ...extras,
  ];

  const haySede = Boolean(sede || direccion || mapas || evento.officialSite);
  if (!haySede && !evento.timezone && horario.dias.length === 0) return null;

  const citas = citasDe([
    sedeLeida ? { dato: sedeLeida, rotulo: 'Sede', valor: titular(sedeLeida.valor) } : null,
    direccionLeida ? { dato: direccionLeida, rotulo: 'Dirección', valor: titular(direccionLeida.valor) } : null,
    ...lineas,
    ...horario.dias.flatMap((d) =>
      [d.apertura, ...d.hitos].flatMap((h) =>
        h?.dato ? [{ dato: h.dato, rotulo: `${h.rotulo} · ${tituloDeDia(d.fecha)}`, valor: h.hora }] : [],
      ),
    ),
  ]);

  return (
    <Banda titulo="Dónde y cuándo">
      {haySede ? (
        <Tarjeta titulo="Sede" className="pb-3">
          {sede ? <p className="text-base font-medium text-foreground">{titular(sede)}</p> : null}

          {/*
            La dirección en una línea, con la bandera delante, y es el enlace al
            mapa. Sin pabellón ni dirección sería repetir la ciudad de la cabecera.
          */}
          {sede || direccion ? (
            <LineaDireccion
              pais={evento.country}
              texto={direccion ? titular(direccion) : evento.city ? titular(evento.city) : ''}
              mapa={mapas?.google ?? null}
            />
          ) : null}

          <FilasDatos lineas={lineas} />

          {/*
            Sin pabellón ni dirección queda «Mapa», que lleva a la ciudad:
            prometer «Cómo llegar» al centro de una ciudad extranjera es peor
            que no tener botón.
          */}
          {(mapas && !sede && !direccion) || evento.officialSite ? (
            <div className="flex flex-wrap items-center gap-2">
              {mapas && !sede && !direccion ? (
                <Boton asChild variante={principal ? 'primario' : 'contorno'}>
                  <a href={mapas.google} target="_blank" rel="noreferrer">
                    <Navigation aria-hidden />
                    Mapa
                  </a>
                </Boton>
              ) : null}
              {evento.officialSite ? (
                <Boton asChild variante="contorno">
                  <a href={evento.officialSite} target="_blank" rel="noreferrer">
                    <ExternalLink aria-hidden />
                    Web
                  </a>
                </Boton>
              ) : null}
            </div>
          ) : null}
        </Tarjeta>
      ) : null}

      {/* Qué hora es allí y qué hora es donde estás, ya convertida (`ficha/horas.tsx`). */}
      <RelojSede evento={evento} />

      {/* El torneo entero, día a día, con la prueba elegida destacada. */}
      <HorariosTorneo evento={evento} prueba={prueba} />

      <SegunConvocatoria citas={citas} />
    </Banda>
  );
}

// ---------------------------------------------------------------------------
// 3 · ¿Estás dentro?
// ---------------------------------------------------------------------------

/**
 * La lista oficial de inscritos, que es la pregunta del usuario con sus
 * palabras: *«si estoy o no»*. Es la lista que **publica la organización** y
 * es la única que se enseña: una solicitud sin validar no es estar dentro.
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
  // Plegada: un TNR absoluto tiene 107 inscritos y enterraría el resto de la ficha.
  const [todos, setTodos] = React.useState(false);
  React.useEffect(() => setTodos(false), [prueba.id]);

  // La copia de Skermo de quien ya sale enlazado por la FIE no se pinta ni se cuenta dos veces.
  const oficiales = sinDuplicadosEnPantalla(
    (inscritos?.oficiales ?? []).filter((i) => i.competitionId === prueba.id),
  );
  const estasDentro = oficiales.some((o) => o.esMio);

  const ASOMAN = 6;
  // Los tuyos primero: es lo que se viene a mirar.
  const ordenados = [...oficiales].sort((a, b) => Number(b.esMio) - Number(a.esMio));
  const visibles = todos ? ordenados : ordenados.slice(0, ASOMAN);
  const ocultos = ordenados.length - visibles.length;

  /*
    La cifra sólo cuando hay a quien contar: un «0» al lado de «Todavía no
    hay lista» es lo mismo dicho dos veces, y el cero de la organización
    significa «todavía no han abierto», no «no va nadie».
  */
  const conteo =
    inscritos === null
      ? null
      : oficiales.length > 0
        ? oficiales.length
        : prueba.registrationCount && prueba.registrationCount > 0
          ? prueba.registrationCount
          : null;

  // Depende de «hay lectura retenida y la última falló», no de las filas de esta prueba.
  const avisoDeFallo =
    inscritos !== null && fallo ? (
      <p role="alert" className="text-sm text-warn">
        La última lectura falló.
      </p>
    ) : null;

  // Sin lista publicada la banda entera sobra.
  const sinLista =
    inscritos !== null && !fallo && oficiales.length === 0 && inscritos.estados[prueba.id] !== 'vacia';
  if (sinLista) return null;
  // Mientras llega tampoco se reserva su hueco ni se pinta un esqueleto.
  if (inscritos === null && !fallo) return null;

  return (
    <Banda titulo="¿Estás dentro?" cifra={conteo} rotulo={conteo !== null ? 'inscritos' : undefined}>
      {inscritos === null ? (
        <p role="alert" className="text-sm text-warn">
          No se ha podido leer la lista de inscritos.
        </p>
      ) : oficiales.length === 0 ? (
        <>
          <p className="text-sm text-muted-foreground">
            {inscritos?.estados[prueba.id] === 'vacia' ? 'Lista vacía' : 'Todavía no hay lista'}
          </p>
          {avisoDeFallo}
        </>
      ) : (
        <>
          {estasDentro ? (
            <p className="flex items-center gap-2 text-sm font-medium text-ok">
              <CircleCheck className="size-4 shrink-0" aria-hidden />
              Estás en la lista oficial.
            </p>
          ) : null}

          <ul data-slot="inscritos" className="flex flex-col divide-y divide-border">
            {visibles.map((i, n) => (
              <li key={`${i.competitionId}-${i.equipo ?? ''}-${i.nombre}-${n}`}>
                <FilaInscrito inscrito={i} />
              </li>
            ))}
          </ul>

          {ocultos > 0 ? (
            <VerMas onClick={() => setTodos(true)} cuenta={oficiales.length} detalle="de inscritos" className="self-start" />
          ) : null}

          {avisoDeFallo}
        </>
      )}
    </Banda>
  );
}

// ---------------------------------------------------------------------------
// 4 · Convocatoria
// ---------------------------------------------------------------------------

/**
 * Los papeles del torneo y de dónde sale todo esto: documentos y
 * retransmisiones en filas iguales con su icono, quién organiza, los enlaces
 * del PDF como botones con su dominio y, plegado, lo que se leyó y no tiene
 * sitio en ningún otro grupo. Ningún dato extraído desaparece y ninguno sale
 * dos veces (ver `ficha/datos-ficha.tsx`).
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

  const citas = citasDe([
    organiza.quien ? { dato: organiza.quien, rotulo: 'Organiza', valor: titular(organiza.quien.valor) } : null,
    organiza.direccion ? { dato: organiza.direccion, rotulo: 'Dirección de quien organiza', valor: titular(organiza.direccion.valor) } : null,
    ...enlaces.map((d) => ({ dato: d, rotulo: nombreDeEnlace(d), valor: d.valor })),
    ...otros,
  ]);

  return (
    <Banda titulo="Convocatoria">
      {evento.documents.length > 0 || retransmisiones.length > 0 ? (
        <ItemGroup className="gap-1">
          {evento.documents.map((d) => (
            // `ItemGroup` es `role="list"`: cada enlace va dentro de su `listitem`.
            <div key={d.id} role="listitem">
              <Item asChild size="sm" variant="outline" className={FILA_ENLACE}>
                <a href={d.url} target="_blank" rel="noreferrer">
                  <ItemMedia variant="icon" className="size-8">
                    <FileText />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="text-sm">{titularDocumento(d.title)}</ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <ExternalLink className="size-4 text-muted-foreground" aria-hidden />
                    <span className="sr-only">(se abre en otra pestaña)</span>
                  </ItemActions>
                </a>
              </Item>
            </div>
          ))}

          {retransmisiones.map((l) => (
            <div key={l.id} role="listitem">
              <Item asChild size="sm" variant="outline" className={FILA_ENLACE}>
                <a href={l.url} target="_blank" rel="noreferrer">
                  <ItemMedia variant="icon" className="size-8 text-ok">
                    <Radio />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="text-sm">
                      {l.label ? titular(l.label) : titular(l.platform)}
                    </ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <ExternalLink className="size-4 text-muted-foreground" aria-hidden />
                    <span className="sr-only">(se abre en otra pestaña)</span>
                  </ItemActions>
                </a>
              </Item>
            </div>
          ))}
        </ItemGroup>
      ) : null}

      <TarjetaOrganiza evento={evento} />

      {/*
        Los enlaces que trae el PDF, en botones con el nombre del destino y no
        en URLs pegadas. En pastilla pequeña: son de la convocatoria y sin
        verificar, no pueden pesar lo mismo que el documento oficial.
      */}
      {enlaces.length > 0 ? (
        <Tarjeta titulo="Enlaces" className="pb-3">
          <ul className="flex flex-wrap items-center gap-2">
            {enlaces.map((d) => (
              <li key={d.id} className="flex min-w-0 max-w-full">
                <Boton asChild variante="contorno" tamano="sm" className="min-w-0 max-w-full shrink">
                  <a href={urlAbsoluta(d.valor)} target="_blank" rel="noreferrer" title={d.valor}>
                    <ExternalLink aria-hidden />
                    <span className="truncate">{nombreDeEnlace(d)}</span>
                  </a>
                </Boton>
              </li>
            ))}
          </ul>
        </Tarjeta>
      ) : null}

      <OtrosDatos datos={otros} />

      {/*
        Procedencia, en pastillas calladas con el nombre de la fuente. Las DOS
        cuando el torneo llega por dos caminos: Skermo porque es donde se
        inscribe un español, y la FIE porque sus condiciones exigen enlazar al
        original.
      */}
      {fuentes.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {fuentes.map((f) => (
            <Boton key={f.source} asChild variante="fantasma" tamano="sm" className="text-muted-foreground">
              <a href={f.url} target="_blank" rel="noreferrer" title={evento.name}>
                <ExternalLink aria-hidden />
                {SOURCE_LABEL[f.source] ?? f.source}
              </a>
            </Boton>
          ))}
        </div>
      ) : null}

      <SegunConvocatoria citas={citas} />
    </Banda>
  );
}

/** Documentos y retransmisiones en filas de 44 px. */
const FILA_ENLACE = 'min-h-11 gap-3 px-3 py-1';

/** Los enlaces del PDF llegan a veces sin esquema («www.uvehoteles.com»). */
function urlAbsoluta(valor: string): string {
  return /^https?:\/\//i.test(valor) ? valor : `https://${valor}`;
}

/**
 * Un enlace por fuente, no uno por fila: la FIE publica una página por prueba
 * y un torneo con cuatro armas traía cuatro enlaces «Ver en FIE» seguidos.
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
