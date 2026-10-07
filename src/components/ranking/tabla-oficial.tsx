'use client';

import { ChevronRight, ExternalLink, Scissors } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { HojaInferior } from '@/components/sistema/hoja-inferior';
import type {
  BreakdownEntry,
  FilaOficial,
  RankingGroupKey,
  RankingRowView,
  TablaOficial,
} from '@/lib/queries/ranking';
import type { Weapon } from '@/lib/auth/session';
import { puedeVerInterno } from '@/lib/ranking/acceso-interno';
import type { CutoffStatus } from '@/lib/ranking/compute';
import { nombreCasa } from '@/lib/nombres';
import { temporadaCorta } from '@/lib/ranking/url-nacional';
import { cn, formatDateEs } from '@/lib/utils';
import { Desglose } from './desglose';
import { escribirUrl, urlDeGrupo, useRanking } from './estado-ranking';
import { FilaLinea } from './fila-linea';
import { Procedencia, VerMas } from './piezas';
import { BarraFiltrosRanking } from './selectores-grupo';
import { clave, etiquetaGrupo, grupoMasParecido, puntos } from './formato';

type Grupo = RankingGroupKey & { tiradores: number };

/**
 * Los datos de la tabla, tal cual los arma el servidor (`armarDatosNacional`).
 * `grupos` son todos los que tienen clasificación; `tablas` (y lo que cuelga
 * de cada grupo) sólo los que ya se han pedido: de entrada, uno.
 */
export type DatosTablaOficial = {
  grupos: Grupo[];
  /** El grupo que trae esta respuesta (`groupKey`). */
  grupoCargado?: string | null;
  tablas: Record<string, TablaOficial>;
  cortes: Record<string, Record<string, CutoffStatus>>;
  desgloses: Record<string, BreakdownEntry[]>;
  internos: Record<string, RankingRowView>;
  mios: string[];
  armasAutorizadas: readonly Weapon[];
  personas: Record<string, string>;
};

/**
 * Cuántas filas de la clasificación se pintan de golpe.
 *
 * -------------------------------------------------------------------------
 * POR QUÉ SE PAGINA, CON EL NÚMERO DELANTE
 * -------------------------------------------------------------------------
 * La decisión de no paginar estaba tomada a propósito y era razonable: en una
 * clasificación, encontrarte en la lista es la mitad del valor, y paginar te
 * puede mandar a una página en la que no estás.
 *
 * Lo que cambia la decisión es el tamaño real de los grupos, medido en la
 * base y no supuesto: el más grande NO tiene 89 filas, tiene **259** (espada
 * masculina absoluta), y detrás van 131, 109 y 107. A 88 px por fila en un
 * móvil eso son más de 22.000 px de tabla, o sea veintiocho pantallas de
 * desplazamiento por debajo de los controles. Nadie llega al puesto 200
 * bajando con el pulgar.
 *
 * Y el motivo para no paginar se resuelve aparte, sin renunciar al recorte:
 *
 *  · si eres tú, tu fila ya está ARRIBA, fuera de la tabla, en el bloque de
 *    «tu puesto oficial» con la distancia al corte. No hay que buscarse;
 *  · **si estás más allá del tope, la tabla se abre en tu página**, no en la
 *    primera. Eso es lo que un recorte a secas rompía;
 *  · el corte de convocatoria manda: si el tope caería antes del corte, se
 *    baja el tope hasta pasarlo, porque cortar la lista justo antes de la
 *    línea de tijera esconde justo lo que se viene a mirar.
 *
 * Cincuenta filas son las que se recorren de una sentada y dejan la tabla en
 * unos 4.400 px, del mismo orden que el resto de las pantallas largas.
 */
const PASO = 50;

/**
 * La clasificación OFICIAL de la RFEE, que es la que la gente reconoce.
 *
 * -------------------------------------------------------------------------
 * POR QUÉ UNA SOLA TABLA Y NO DOS PESTAÑAS
 * -------------------------------------------------------------------------
 * Aquí conviven dos números distintos: el ranking que publica la federación
 * (1.235 filas, 808 tiradores) y el cálculo interno de esta aplicación, que
 * existe solo para los tiradores cuyos resultados están emparejados. La
 * tentación era ponerlos en dos pestañas, y se ha descartado por dos motivos.
 *
 * El primero es el contrato de interfaz: «cero submenús», y si una sección
 * necesita pestañas internas probablemente son dos secciones o ninguna. El
 * segundo es más importante: en dos tablas, la misma persona aparecería dos
 * veces con dos puestos distintos y sin nada que explique por qué. Eso no es
 * enseñar dos datos, es sembrar una duda.
 *
 * Así que hay UNA lista —la oficial, en el orden en que la publica la
 * federación— y el cálculo interno entra por donde vale de verdad: **el
 * desglose**. Al tocar la fila de un tirador con ficha se abre su panel con el
 * puesto oficial arriba y, debajo y con su nombre puesto, de dónde sale cada
 * punto según la normativa. Lo que se pierde es el «puesto interno» como
 * número, que sobre tres tiradores emparejados no significaba nada.
 *
 * En móvil NO se hace scroll horizontal: cada tirador es una sola línea
 * (`FilaLinea`) con puesto, retrato, nombre recortado, código de club y
 * puntos; el año de nacimiento queda en el panel de la fila.
 *
 * -------------------------------------------------------------------------
 * POR QUÉ AQUÍ NO HAY BANDERAS, Y SÍ CÓDIGO DE CLUB
 * -------------------------------------------------------------------------
 * Son dos rankings distintos y cada uno tiene el dato que tiene:
 *
 *  · ESTE, el NACIONAL de la RFEE, son todos españoles. `official_ranking_entry`
 *    no tiene ni columna de país, y con razón: una bandera sería el mismo icono
 *    repetido en las 1.235 filas, o sea ruido con forma de dato. Lo que
 *    distingue a un tirador de otro aquí es el CLUB, y por eso el club está y
 *    la bandera no.
 *  · El MUNDIAL de la FIE sí tiene país por tirador, pero **lo que se guarda
 *    es el censo ESPAÑOL** —343 tiradores, 433 filas de `fie_world_ranking`—,
 *    así que también son todos `ESP`. No es una carencia que se arregle
 *    raspando más: el censo se pide por país a propósito, para no bajarse el
 *    ranking internacional de los otros once mil (ver la cabecera de
 *    `src/lib/ingest/sources/fie-tiradores.ts`).
 *
 * O sea que hoy una bandera no distinguiría nada en ninguno de los dos, y el
 * sitio donde el país SÍ informa —en qué país se celebra cada torneo— ya lo
 * pinta el calendario. Si algún día se guardan rivales extranjeros con su país,
 * el sitio es `fie_fencer.country_code`, que es `ESP` de tres letras y habría
 * que pasarlo a dos para cualquier solución de bandera.
 */
export function TablaRankingOficial({
  grupos,
  tablas,
  cortes,
  desgloses,
  internos,
  mios,
  grupoInicial,
  conMiFicha = false,
  armasAutorizadas = [],
  personas = {},
  selectorTemporada = null,
  cargarGrupo,
}: {
  /**
   * Trae un grupo que no ha venido en la primera carga. Mientras llega, se
   * sigue viendo la tabla de antes (sin esqueleto) y el filtro ya marca el
   * grupo pedido.
   */
  cargarGrupo?: (grupo: RankingGroupKey) => Promise<DatosTablaOficial>;
  /** Fila (`official_ranking_entry.id`) → persona deportiva, para el retrato y el enlace. */
  personas?: Record<string, string>;
  /** El selector de temporada, primero en la fila de filtros. */
  selectorTemporada?: React.ReactNode;
  /**
   * Armas cuyo cálculo interno puede ver esta cuenta (`armasInternas`). El
   * bloque y las promesas del cálculo salen por el ARMA seleccionada: sin
   * permiso no se confunde la falta de acceso con la falta de resultados.
   */
  armasAutorizadas?: readonly Weapon[];
  grupos: Grupo[];
  tablas: Record<string, TablaOficial>;
  /** `grupo` -> `athleteId` -> distancia al corte, medida sobre el puesto oficial. */
  cortes: Record<string, Record<string, CutoffStatus>>;
  /** `grupo|athleteId` -> desglose del cálculo interno, donde exista. */
  desgloses: Record<string, BreakdownEntry[]>;
  /** `grupo|athleteId` -> fila del cálculo interno, para poder decir su puesto. */
  internos: Record<string, RankingRowView>;
  mios: string[];
  grupoInicial: string;
  /**
   * `true` cuando la pantalla ya enseña la ficha del tirador arriba
   * (`FichaRanking`), con su foto y el puesto como insignia.
   *
   * Entonces este bloque **no repite la cifra gigante**: el mismo «3» dos
   * veces en la misma pantalla se lee como un fallo, no como énfasis. Se queda
   * con lo que la ficha no dice, que es la distancia al corte de convocatoria,
   * y con el enlace al desglose del cálculo.
   */
  conMiFicha?: boolean;
}) {
  const ranking = useRanking();
  // Fuera del enrutador (pruebas, capturas sin servidor) no hay parámetros.
  const parametros = useSearchParams() as URLSearchParams | null;

  /**
   * El grupo más parecido al pedido que tenga datos. Al cambiar de arma se
   * conservan género y categoría SI existen para la nueva arma; si no, se cae
   * al primer grupo que sí exista: hoy hay espada femenina M17 y M20 pero no
   * absoluta, y el selector no puede quedarse apuntando a una combinación vacía.
   */
  const masParecido = (deseado: RankingGroupKey) => grupoMasParecido(grupos, deseado) ?? grupos[0];

  /** Lo pedido después de la primera carga, cosido a lo que vino del servidor. */
  const [pedidos, setPedidos] = React.useState<Pick<DatosTablaOficial, 'tablas' | 'cortes' | 'desgloses' | 'internos' | 'personas'>>(
    () => ({ tablas: {}, cortes: {}, desgloses: {}, internos: {}, personas: {} }),
  );
  const todasLasTablas = { ...tablas, ...pedidos.tablas };
  const todosLosCortes = { ...cortes, ...pedidos.cortes };

  // Si se viene de otra tabla, se abre en el mismo grupo (si ya está; si no, se pide).
  const [claveActual, setClaveActual] = React.useState(() => {
    const recordado = ranking?.memoria.current.grupo;
    const k = recordado ? clave(masParecido(recordado)) : grupoInicial;
    return tablas[k] ? k : grupoInicial;
  });
  const [pendiente, setPendiente] = React.useState<RankingGroupKey | null>(null);
  const peticion = React.useRef(0);
  const [abierto, setAbierto] = React.useState<string | null>(null);
  const [tope, setTope] = React.useState(PASO);
  const [busqueda, setBusqueda] = React.useState(() => ranking?.memoria.current.q ?? parametros?.get('q') ?? '');

  const grupo = grupos.find((g) => clave(g) === claveActual) ?? grupos[0];
  const tabla: TablaOficial = todasLasTablas[clave(grupo)] ?? {
    group: grupo, seasonLabel: '', rows: [], clasificados: 0, actualizadoEl: null, sourceUrl: null, rule: null,
  };
  const corteDelGrupo = todosLosCortes[clave(grupo)] ?? {};
  const verCalculo = puedeVerInterno(armasAutorizadas, grupo.weapon);
  const personaDe = (id: string) => personas[id] ?? pedidos.personas[id] ?? null;
  const desgloseDe = (k: string) => desgloses[k] ?? pedidos.desgloses[k];
  const internoDe = (k: string) => internos[k] ?? pedidos.internos[k];

  const mostrar = (destino: RankingGroupKey) => {
    setClaveActual(clave(destino));
    setPendiente(null);
    setTope(PASO);
  };

  /**
   * Al cambiar de grupo se vuelve al tope de partida y se vacía el buscador:
   * arrastrar «ver más» de una categoría de 259 filas a una de 32 pintaría la
   * lista entera sin que nadie lo haya pedido. Si el grupo no ha llegado, se
   * pide y la tabla de antes sigue a la vista; gana la última petición.
   */
  function elegir(cambio: Partial<RankingGroupKey>) {
    const destino = masParecido({ ...(pendiente ?? grupo), ...cambio });
    const mia = ++peticion.current;
    setBusqueda('');
    if (ranking) ranking.memoria.current = { ...ranking.memoria.current, grupo: destino, q: '' };
    escribirUrl({ ...urlDeGrupo(destino), q: null });
    if (todasLasTablas[clave(destino)] || !cargarGrupo) {
      mostrar(destino);
      return;
    }
    setPendiente(destino);
    cargarGrupo(destino)
      .then((d) => {
        setPedidos((p) => ({
          tablas: { ...p.tablas, ...d.tablas },
          cortes: { ...p.cortes, ...d.cortes },
          desgloses: { ...p.desgloses, ...d.desgloses },
          internos: { ...p.internos, ...d.internos },
          personas: { ...p.personas, ...d.personas },
        }));
        if (peticion.current === mia) mostrar(destino);
      })
      .catch(() => {
        if (peticion.current === mia) setPendiente(null);
      });
  }

  function buscar(q: string) {
    setBusqueda(q);
    if (ranking) ranking.memoria.current = { ...ranking.memoria.current, q };
    escribirUrl({ q });
  }

  const misFilas = tabla.rows.filter(
    (r) => r.athleteId !== null && mios.includes(r.athleteId),
  );
  const filaAbierta = abierto
    ? (tabla.rows.find((r) => r.athleteId === abierto) ?? null)
    : null;

  const plazas = tabla.rule?.rankingPlaces ?? 0;
  const hayCorte = plazas > 0 && tabla.clasificados > plazas;
  const conFicha = tabla.rows.filter((r) => r.athleteId !== null).length;

  /**
   * Cuántas filas se enseñan, con las dos excepciones que hacen que recortar
   * no esconda nada importante.
   */
  const minimo = React.useMemo(() => {
    let suelo = PASO;

    // 1. Si el corte de convocatoria cae más allá, se estira hasta pasarlo:
    //    una lista que acaba en el puesto 50 con el corte en el 38 está bien,
    //    pero con el corte en el 64 dejaría fuera la línea de tijera, que es
    //    la razón por la que un seleccionador abre esta pantalla.
    if (hayCorte && plazas > 0) suelo = Math.max(suelo, plazas + 5);

    // 2. Si una de tus filas está más abajo, se estira hasta incluirla. Nadie
    //    tiene que pulsar «ver más» para encontrarse a sí mismo.
    for (const fila of tabla.rows) {
      if (fila.athleteId && mios.includes(fila.athleteId)) {
        const donde = tabla.rows.indexOf(fila) + 1;
        suelo = Math.max(suelo, donde + 3);
      }
    }

    return suelo;
  }, [hayCorte, plazas, tabla.rows, mios]);

  /**
   * El buscador filtra y, mientras hay algo escrito, NO se recorta: quien
   * escribe un nombre quiere ese nombre, y esconderlo detrás de «ver más»
   * porque va en el puesto 180 convierte el buscador en un adorno.
   */
  const filtradas = busqueda
    ? tabla.rows.filter((f) => nombreCasa(f.nombre, busqueda))
    : tabla.rows;
  const limite = Math.max(tope, minimo);
  const filasVisibles = busqueda ? filtradas : filtradas.slice(0, limite);
  const quedan = filtradas.length - filasVisibles.length;

  return (
    <div className="ranking flex min-w-0 flex-col gap-3">
      {/*
        Los controles, compartidos con la tabla internacional
        (`selectores-grupo.tsx`): dos juegos de selectores que se eligen igual
        acaban siendo distintos el día que se toca uno. La temporada va dentro
        de la hoja, primera.
      */}
      <BarraFiltrosRanking
        grupos={grupos}
        grupo={pendiente ?? grupo}
        onElegir={elegir}
        busqueda={busqueda}
        onBuscar={buscar}
        antesEnHoja={selectorTemporada}
        resultados={`Ver ${filtradas.length} ${filtradas.length === 1 ? 'tirador' : 'tiradores'}`}
      />

      {/*
        Dónde estás tú, y a cuánto del corte.

        Es la única razón por la que un tirador abre esta pantalla, así que el
        puesto va en cifra de marcador: la tabla de abajo tiene doscientos
        números del mismo tamaño y, sin este contraste, el tuyo se pierde.
      */}
      {misFilas.map((fila) => (
        <button
          key={fila.id}
          type="button"
          onClick={() => setAbierto(fila.athleteId)}
          className="flex min-h-0! min-w-0 cursor-pointer items-start gap-3 rounded-xl border border-filete-alto bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
        >
          {conMiFicha ? null : (
            <span className="flex w-12 shrink-0 flex-col">
              <span className="cifra text-4xl leading-none text-primary-text">
                {fila.position ?? '—'}
              </span>
              <span className="mt-1 text-[12px] leading-tight text-muted-foreground">
                {fila.position ? 'tu puesto oficial' : 'sin clasificar todavía'}
              </span>
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[14px] font-medium">
              {conMiFicha ? 'A cuánto estás del corte' : fila.nombre}
            </span>
            <span className="medida text-[13px] text-muted-foreground">
              <Corte
                corte={fila.athleteId ? (corteDelGrupo[fila.athleteId] ?? null) : null}
                puntosTotales={fila.totalPoints}
                deCuantos={tabla.clasificados}
              />
            </span>
            <span className="mt-0.5 inline-flex items-center gap-1 text-[13px] text-primary-text">
              {verCalculo ? 'Ver tus datos y el cálculo' : 'Ver tus datos'}
              <ChevronRight className="size-4 shrink-0" aria-hidden />
            </span>
          </span>
        </button>
      ))}

      {/*
        DE DÓNDE SALE LA TABLA, EN UNA LÍNEA.

        Eran siete líneas de texto gris: cuántas filas hay, cuántas tienen
        puesto, que no la calcula esta aplicación, las plazas de la normativa,
        y un párrafo aparte explicando que el club es un código. El usuario lo
        señaló entero: *«hay mucho texto que no quiero, como todo esto»*.

        Se queda lo que responde «¿me puedo fiar de esto?»: **qué es, de qué
        temporada, cuándo se leyó y el enlace al original**. Los recuentos se
        ven contando la tabla que hay justo debajo, y lo del código de club lo
        dice ya la cabecera de su columna, «Club (código)», que es donde hace
        falta y no obliga a leer un párrafo para entender una celda.
      */}
      {/*
        Y NO SE REPITE LO QUE YA DICE LA CABECERA.

        Visto en la captura de producción: el subtítulo de la pantalla dice
        «Clasificación oficial de la RFEE, temporada 2026-2027» y esta línea lo
        repetía palabra por palabra dos renglones más abajo. Dicho dos veces es
        otra vez el «mucho texto» de la queja. Aquí queda solo lo que el
        subtítulo no dice: cuándo se leyó y dónde está el original.
      */}
      <Procedencia
        temporada={tabla.seasonLabel ? `Temporada ${temporadaCorta(tabla.seasonLabel)}` : null}
        leida={tabla.actualizadoEl ? formatDateEs(tabla.actualizadoEl) : null}
        url={tabla.sourceUrl}
      />

      <p role="status" className="sr-only">
        {filtradas.length} {filtradas.length === 1 ? 'tirador' : 'tiradores'}
      </p>

      {filasVisibles.length === 0 ? (
        <p className="border-y border-filete-alto py-6 text-sm text-muted-foreground">
          {busqueda ? 'Ningún tirador coincide. Prueba otro nombre.' : 'Sin puestos publicados en este grupo.'}
        </p>
      ) : null}

      {/*
        Una línea por tirador (`FilaLinea`): puesto, retrato, nombre, código
        de club y puntos. El año de nacimiento y el detalle quedan en el panel
        de la fila; el código de club lo explica su `title`.
      */}
      {filasVisibles.length > 0 ? (
        <ol
          aria-label={`Ranking nacional, ${etiquetaGrupo(grupo)}`}
          aria-busy={pendiente ? true : undefined}
          className={cn('grid w-full min-w-0 max-w-3xl gap-px overflow-hidden rounded-xl border bg-border transition-opacity duration-150', pendiente && 'opacity-60')}
        >
          {filasVisibles.map((fila) => {
            const esMia = fila.athleteId !== null && mios.includes(fila.athleteId);
            return (
              <React.Fragment key={fila.id}>
                <FilaLinea
                  puesto={fila.position}
                  nombre={fila.nombre}
                  personaId={personaDe(fila.id)}
                  club={fila.club}
                  puntos={fila.totalPoints}
                  mio={esMia}
                  accion={
                    fila.athleteId ? (
                      <button
                        type="button"
                        onClick={() => setAbierto(fila.athleteId)}
                        aria-label={`Ver los datos de ${fila.nombre}`}
                        className="relative -mr-1 inline-flex size-7 min-h-0! min-w-0! items-center justify-center rounded-full text-muted-foreground after:absolute after:-inset-2 after:content-[''] hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <ChevronRight className="size-4" aria-hidden />
                      </button>
                    ) : null
                  }
                />
                {hayCorte && fila.position === plazas ? (
                  <li className="flex items-center gap-2 border-y border-gold bg-[color-mix(in_oklab,var(--color-gold)_7%,var(--card))] px-2 py-1.5 text-xs text-gold">
                    <Scissors className="size-3.5 shrink-0" aria-hidden />
                    <span>
                      Corte de convocatoria: las {plazas} primeras plazas salen por ranking
                      {tabla.rule && tabla.rule.technicalPlaces > 0
                        ? `; otras ${tabla.rule.technicalPlaces} las decide el criterio técnico`
                        : ''}
                      .
                    </span>
                  </li>
                ) : null}
              </React.Fragment>
            );
          })}
        </ol>
      ) : null}

      {/*
        «Ver más», con el número de lo que falta: «ver 50 más» de «209»
        informa de dónde estás; «ver más» a secas, no. Ancho completo porque
        se toca con el pulgar al final de una lista larga.
      */}
      {quedan > 0 ? (
        <VerMas onClick={() => setTope(limite + PASO)}>
          Ver {Math.min(quedan, PASO)} más
          <span className="cifra text-[12px] text-muted-foreground">de {filtradas.length}</span>
        </VerMas>
      ) : null}

      {conFicha < tabla.rows.length ? (
        <p
          className="text-xs text-muted-foreground"
          title={`Sin ficha vinculada: solo sus datos publicados por la RFEE, sin plazos ni inscripciones${verCalculo ? ' ni cálculo interno' : ''}.`}
        >
          <span className="cifra text-sm">{tabla.rows.length - conFicha}</span> sin ficha
        </p>
      ) : null}

      <HojaInferior
        abierta={filaAbierta !== null}
        alCambiar={(v) => {
          if (!v) setAbierto(null);
        }}
        titulo={filaAbierta?.nombre ?? ''}
        descripcion={filaAbierta ? `${etiquetaGrupo(grupo)}${filaAbierta.club ? ` · ${filaAbierta.club}` : ''}` : undefined}
      >
        {filaAbierta ? (
          <DetalleFilaOficial
            fila={filaAbierta}
            tabla={tabla}
            corte={filaAbierta.athleteId ? (corteDelGrupo[filaAbierta.athleteId] ?? null) : null}
            desglose={filaAbierta.athleteId ? (desgloseDe(`${clave(grupo)}|${filaAbierta.athleteId}`) ?? null) : null}
            interno={filaAbierta.athleteId ? (internoDe(`${clave(grupo)}|${filaAbierta.athleteId}`) ?? null) : null}
            esTuyo={filaAbierta.athleteId !== null && mios.includes(filaAbierta.athleteId)}
            verCalculo={verCalculo}
          />
        ) : null}
      </HojaInferior>
    </div>
  );
}

/**
 * Cuerpo del panel de una fila oficial: el dato de la federación siempre y,
 * debajo y con su nombre puesto, el cálculo interno solo si esta cuenta puede
 * verlo para el arma de la tabla.
 *
 * Sin permiso no se pinta ni el bloque ni la frase «sin cálculo propio»:
 * decirla confundiría la falta de acceso con la falta de resultados.
 */
export function DetalleFilaOficial({
  fila,
  tabla,
  corte,
  desglose,
  interno,
  esTuyo,
  verCalculo,
}: {
  fila: FilaOficial;
  tabla: TablaOficial;
  corte: CutoffStatus | null;
  desglose: BreakdownEntry[] | null;
  interno: RankingRowView | null;
  esTuyo: boolean;
  verCalculo: boolean;
}) {
  return (
    <div className="flex flex-col gap-6 pt-2">
      <Oficial
        fila={fila}
        temporada={tabla.seasonLabel}
        deCuantos={tabla.clasificados}
        corte={corte}
        urlFuente={tabla.sourceUrl}
      />

      {verCalculo ? (
        /*
          El cálculo interno, con su nombre puesto y debajo del oficial.
          Nunca al lado sin etiqueta: son dos números distintos y
          confundirlos sería peor que no enseñar ninguno.
        */
        <div className="flex flex-col gap-3 border-t pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-lg">Cálculo de esta aplicación</h3>
            <p className="text-xs text-muted-foreground">
              No es el ranking de la federación
            </p>
          </div>

          {fila.athleteId && desglose ? (
            <Desglose
              puesto={interno?.position ?? 0}
              total={interno?.totalPoints ?? 0}
              pruebas={desglose}
              corte={null}
              regla={tabla.rule}
              esTuyo={esTuyo}
            />
          ) : (
            <p className="medida text-sm text-muted-foreground">
              Sin resultados de esta temporada con su licencia.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Los datos oficiales del tirador, que son la cabecera del panel. */
function Oficial({
  fila,
  temporada,
  deCuantos,
  corte,
  urlFuente,
}: {
  fila: FilaOficial;
  temporada: string;
  deCuantos: number;
  corte: CutoffStatus | null;
  urlFuente: string | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <span className="flex items-baseline gap-2">
          <span className="cifra text-4xl">
            {fila.position ? `${fila.position}.º` : '—'}
          </span>
          <span className="max-w-28 text-xs leading-tight text-muted-foreground">
            {fila.position
              ? `de ${deCuantos} en la clasificación oficial`
              : 'sin clasificar en la oficial'}
          </span>
        </span>
        <span className="flex items-baseline gap-2">
          <span className="cifra text-4xl">
            {fila.totalPoints === null ? '—' : puntos(fila.totalPoints)}
          </span>
          <span className="max-w-24 text-xs leading-tight text-muted-foreground">
            puntos oficiales
          </span>
        </span>
        {fila.anioNacimiento ? (
          <span className="flex items-baseline gap-2">
            <span className="cifra text-2xl">{fila.anioNacimiento}</span>
            <span className="max-w-24 text-xs leading-tight text-muted-foreground">
              año de nacimiento
            </span>
          </span>
        ) : null}
      </div>

      {corte ? (
        <p
          className={cn(
            'medida rounded-lg border px-3 py-2.5 text-sm',
            corte.inside ? 'border-ok/40 text-ok' : 'text-muted-foreground',
          )}
        >
          {corte.explanation}
        </p>
      ) : null}

      <p className="medida text-xs text-muted-foreground">
        Temporada {temporada}, leído de la clasificación que publica la RFEE.
        {urlFuente ? (
          <>
            {' '}
            <a
              href={urlFuente}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary-text underline underline-offset-4"
            >
              Verlo allí
              <ExternalLink className="size-3 shrink-0" aria-hidden />
            </a>
          </>
        ) : null}
      </p>
    </div>
  );
}

/**
 * Distancia al corte, en una línea.
 *
 * Medida sobre los puestos OFICIALES, que es la corrección que faltaba: el
 * corte de convocatoria lo decide la clasificación de la federación, no la
 * nuestra. La normativa (cuántas plazas y en qué fecha) sigue siendo la misma.
 */
function Corte({
  corte,
  puntosTotales,
  deCuantos,
}: {
  corte: CutoffStatus | null;
  puntosTotales: number | null;
  deCuantos: number;
}) {
  const conPuntos =
    puntosTotales === null ? 'sin puntos publicados' : `${puntos(puntosTotales)} puntos`;

  if (!corte || corte.rankingPlaces === 0) {
    return (
      <>
        {conPuntos} entre {deCuantos} tiradores. La normativa de la temporada no
        fija plazas por ranking en esta categoría, así que no se puede decir
        dónde está el corte.
      </>
    );
  }

  const tecnicas =
    corte.technicalPlaces > 0
      ? ` Otras ${corte.technicalPlaces} plazas las decide el criterio técnico.`
      : '';

  if (corte.inside) {
    return (
      <>
        {conPuntos}. Dentro de las {corte.rankingPlaces} plazas que salen por
        ranking.{tecnicas}
      </>
    );
  }

  return (
    <>
      A <span className="cifra text-sm text-foreground">{corte.placesAway}</span>{' '}
      {corte.placesAway === 1 ? 'puesto' : 'puestos'}
      {corte.pointsAway !== null ? (
        <>
          {' '}
          y{' '}
          <span className="cifra text-sm text-foreground">
            {puntos(corte.pointsAway)}
          </span>{' '}
          puntos
        </>
      ) : null}{' '}
      del corte, que está en el puesto {corte.rankingPlaces}.{tecnicas}
    </>
  );
}
