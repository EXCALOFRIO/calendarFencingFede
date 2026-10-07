'use client';

import {
  CalendarSearch,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Flag,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { toast } from 'sonner';
import { Boton, BotonIcono } from '@/components/sistema/boton';
import { ChipFiltro, FilaChips } from '@/components/sistema/chip-filtro';
import { HojaInferior } from '@/components/sistema/hoja-inferior';
import { TransicionContenido } from '@/components/sistema/transicion';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { Item, ItemContent, ItemMedia } from '@/components/ui/item';
import { COLOR_ORGANISMO } from '@/lib/colores';
import type { EventView, Weapon } from '@/lib/queries/calendar';
import {
  ARMAS,
  GENEROS as CODIGOS_GENERO,
  esArma,
  arranqueDelCalendario,
  ordenarCategorias,
  type PerfilAmbito,
} from '@/lib/ambito';
import {
  CATEGORY_LABEL,
  CIRCUIT_LABEL,
  CIRCUIT_SHORT,
  GENDER_LABEL,
  WEAPON_LABEL,
  WEAPON_SHORT,
  capitalizar,
  cn,
  formatDateRangeEs,
  organismoDe,
  titular,
  titularTorneo,
} from '@/lib/utils';
import type { QuienVa } from '@/app/(app)/inscritos';
import {
  SIN_EVENTO,
  datosVigentes,
  iniciarLectura,
  lecturaDelEvento,
  type LecturaDeEvento,
} from '@/lib/entries/lectura';
import type { PruebaPasada, TramoPasado } from '@/lib/queries/calendario-pasado-modelo';
import {
  claveDeTramo,
  leerSaltoDeMes,
  tramoDeMeses,
  tramoPasadoDe,
} from '@/lib/queries/calendario-pasado-tramo';
import { CabeceraFicha } from './cabecera-ficha';
import { FichaEvento } from './ficha-evento';
import { PantallaFicha, useEntradaDeHistorial } from './pantalla-ficha';
import { fichaRecibida, leerFicha, precargarFicha } from './ficha/precarga';
import { LoQueViene, diasHasta, plazoDelEvento } from './lo-que-viene';
import { ResultadosPasados } from './pasado/resultados-pasados';
import { ColumnaMes, FeedMovil, type EstadoDelMes } from './timeline';
import type { PasadoDeTarjeta } from './tarjeta-bloque';
import { agruparEnBloques, rangoRealDeEvento } from '@/lib/calendario/bloques';
import {
  construirUrlCalendario,
  type Ambito,
  type ContextoCalendarioLeido,
  type Vista,
} from '@/lib/calendario/contexto-url';
import { hoyMadrid } from '@/lib/callups/fechas';

export type TiradorOpcion = {
  id: string;
  fullName: string;
  gender: 'M' | 'F' | 'MIXTO';
  weapons: string[];
  eligibleCategories: string[];
};

/**
 * Cuántas competiciones se enseñan en «lo próximo, fuera de este mes».
 *
 * Antes esto era un cálculo: la rejilla **medía** el hueco que le sobraba en
 * pantalla (`onHueco`) y de ahí salía un número de filas, porque un mes de una
 * sola tiradora dejaba 463 px de nada en un escritorio y había que decidir qué
 * poner sin empujar el calendario.
 *
 * Con bloques de competición ese cálculo sobra, y se ha ido entero. La
 * diferencia es estructural: la rejilla repartía un alto fijo entre sus filas,
 * así que cualquier cosa que se pusiera debajo le quitaba sitio; un timeline
 * mide lo que miden sus tarjetas y se desplaza. O sea que «lo próximo» ya no
 * compite con el mes por los mismos píxeles y puede ser una constante.
 *
 * Seis, y no más: esto es «lo próximo», no el calendario entero. Pasadas seis
 * competiciones lo que hace falta es cambiar de mes.
 */
const CUANTO_DESPUES = 6;

const GENEROS: { v: 'M' | 'F'; largo: string }[] = [
  { v: 'M', largo: GENDER_LABEL.M },
  { v: 'F', largo: GENDER_LABEL.F },
];

/**
 * ===========================================================================
 * EL ÁMBITO: TODO, NACIONAL O INTERNACIONAL
 * ===========================================================================
 *
 * Tres valores y no un interruptor de dos, porque «todo» **no es** un estado
 * intermedio entre nacional e internacional: es lo que se quiere ver la
 * mayoría de las veces, y tiene que poder elegirse a la vuelta. Con un
 * interruptor de dos posiciones no hay forma de volver al calendario
 * completo sin recordar cuál era el estado de antes.
 *
 * Y arranca en `TODO` a propósito: el calendario de esta aplicación es «todo
 * lo tuyo en un sitio», que es de lo que se quejaba el usuario al principio
 * —mirar en tres webs distintas—. Arrancar ya partido sería volver a eso.
 */
const AMBITOS: { v: Ambito; largo: string }[] = [
  { v: 'TODO', largo: 'Todo' },
  { v: 'NACIONAL', largo: 'Nacional' },
  { v: 'INTERNACIONAL', largo: 'Internacional' },
];

/**
 * Si un torneo entra o no en el ámbito elegido.
 *
 * Se apoya en `organismoDe()` y no en `event.scope`. El motivo está escrito
 * en esa función y es un caso real: el calendario de la RFEE en Skermo
 * republica las Copas del Mundo, así que por `scope` salen como NACIONAL. Un
 * filtro «solo nacional» que enseñe la Copa del Mundo de Takamatsu no es un
 * filtro, es una trampa.
 */
function encajaEnElAmbito(evento: EventView, ambito: Ambito): boolean {
  if (ambito === 'TODO') return true;
  const organismo = organismoDe(evento.source, evento.scope, evento.circuit);
  const internacional = organismo === 'FIE' || organismo === 'EFC';
  return ambito === 'INTERNACIONAL' ? internacional : !internacional;
}

/**
 * El calendario, que es la aplicación.
 *
 * -------------------------------------------------------------------------
 * LA PANTALLA ES UNA BANDA Y UNA REJILLA. NADA MÁS.
 * -------------------------------------------------------------------------
 * Antes eran cuatro bloques: título, tres renglones de controles, rejilla y
 * dos renglones de leyenda. Medido en un iPhone: 260 px de los 500
 * disponibles se los llevaba lo que NO es el calendario, así que a la rejilla
 * le quedaban 240 px, una semana con cuatro torneos no cabía y la última
 * semana salía rebanada por el `overflow`.
 *
 * Ahora hay **una banda** con dos renglones —el mes con su navegación arriba,
 * y debajo lo único que de verdad se quiere saber: **cuánto queda para la
 * próxima competición**— y la rejilla se lleva el resto. Los filtros, que se
 * tocan una vez y se dejan puestos, viven detrás de un botón que dice en su
 * etiqueta qué está filtrando; el buscador es un icono que abre una paleta en
 * vez de un campo siempre vacío que se comía media anchura.
 *
 * -------------------------------------------------------------------------
 * UNA SOLA CONVENCIÓN DE ESTADO MARCADO
 * -------------------------------------------------------------------------
 * El usuario cazó el primer fallo de un vistazo: `Florete` salía relleno de
 * rojo por estar activo y `M` y `F` salían **los dos** rellenos, así que la
 * misma señal significaba dos cosas en la misma línea. Se quitó el acento y
 * se marcó con fondo secundario, y entonces vino la segunda queja, que es la
 * de ahora: *«es tan gris que ni se nota»*.
 *
 * La distinción no es «acento sí / acento no»: es **relleno frente a
 * contorno**. En toda la pantalla, y en toda la aplicación:
 *
 *   acción principal    relleno sólido de acento + texto blanco. Una.
 *   control marcado      contorno rojo + superficie `--marcado` + rótulo
 *                        rojo y en negrita. Igual para arma, género,
 *                        categoría, vista y tirador.
 *   control sin marcar   borde `--input`, superficie de su nivel, apagado.
 *
 * Las medidas y el por qué del token están en `globals.css` («EL CONTROL
 * MARCADO»). La selección múltiple sigue en `ToggleGroup`, elegir-uno en
 * `Select` y la navegación en un `ButtonGroup` de botones fantasma.
 *
 * Todas las herramientas tienen al menos 44 × 44 px, también en escritorio.
 */
export function VistaCalendario({
  eventos,
  perfil,
  tiradores,
  sinFicha = false,
  inscripciones,
  temporada,
  actualizado,
  solicitarInscripcion,
  cargarInscritos,
  inicial,
  pasadoInicial = null,
  cargarPasado,
}: {
  /**
   * Lo ya celebrado del tramo con el que se abre, leído en el servidor. El de
   * cualquier otro tramo se pide con `cargarPasado` al llegar a él.
   */
  pasadoInicial?: TramoPasado | null;
  /** Lo ya celebrado de un tramo, con sus resultados de Explorar. */
  cargarPasado?: (desde: string, hasta: string) => Promise<TramoPasado | null>;
  /**
   * Periodo y filtros con los que se reabre el calendario al volver de una
   * edición o una persona (ver `contexto-url.ts`). Sin él, se abre con lo suyo.
   */
  inicial?: ContextoCalendarioLeido;
  eventos: EventView[];
  /**
   * Quién está mirando. Solo el papel y las armas: es lo que decide con qué
   * filtros se abre la pantalla (ver `src/lib/ambito.ts`).
   */
  perfil: PerfilAmbito;
  tiradores: TiradorOpcion[];
  /** La cuenta es de tirador o tutor y todavía no tiene ficha vinculada. */
  sinFicha?: boolean;
  /** competitionId -> estado legible de la inscripción de esta cuenta. */
  inscripciones: Record<string, string>;
  temporada: string | null;
  actualizado: string | null;
  solicitarInscripcion: (
    competitionId: string,
    athleteId: string,
  ) => Promise<{ ok: true; message: string } | { ok: false; error: string }>;
  /**
   * Quién va a un torneo. Sin él (lo normal) sale de la lectura única de la
   * ficha (`ficha/precarga.ts`), que se lanza ya con la intención de abrirla.
   */
  cargarInscritos?: (eventId: string) => Promise<QuienVa>;
}) {
  /**
   * Con quién se está mirando el calendario.
   *
   * Una cuenta de tutor lleva a dos hijos, y cada uno tira de un arma y en
   * una categoría distinta. Antes se cogía siempre `tiradores[0]`: el
   * calendario salía filtrado por el arma del mayor y, peor, el botón de
   * inscribir mandaba SIEMPRE al mayor.
   */
  const [tiradorId, setTiradorId] = React.useState<string | null>(
    () =>
      tiradores.find((t) => t.id === inicial?.tiradorId)?.id ??
      tiradores[0]?.id ??
      null,
  );
  const tirador = tiradores.find((t) => t.id === tiradorId) ?? tiradores[0] ?? null;

  /**
   * Categorías que hay DE VERDAD en el calendario.
   *
   * No se ofrece M9 si esta temporada no hay ninguna prueba M9: un filtro con
   * opciones que no cambian nada es ruido.
   */
  const categoriasDisponibles = React.useMemo(
    () =>
      ordenarCategorias([
        ...new Set(eventos.flatMap((e) => e.competitions.map((c) => c.category))),
      ]),
    [eventos],
  );

  /**
   * Filtros de arranque: **lo tuyo**.
   *
   * Al entrar, un tirador ve su arma, su género y las categorías en las que
   * de verdad puede tirar; un seleccionador, su arma con los dos géneros y
   * absoluto. Quién ve qué se decide en `src/lib/ambito.ts`, que es una
   * función normal y está probada.
   *
   * No se guardan entre visitas a propósito: recargar devuelve a lo suyo.
   */
  const propio = React.useMemo(
    () => arranqueDelCalendario(perfil, tirador, categoriasDisponibles),
    [perfil, tirador, categoriasDisponibles],
  );

  /*
    ARRANCA EN TRES MESES, no en uno. Petición literal: *«pon por defecto
    siempre 3 meses vista»*. Y tiene sentido con los bloques: una temporada de
    esgrima se planifica por trimestres —hay que pedir vuelos y pedir días—, y
    un mes solo deja fuera justo lo que se está decidiendo.
  */
  /*
    Lo PEDIDO (`vistaPedida`, `anclaPedida`) y lo que SE PINTA (`vista`,
    `ancla`, más abajo) son dos cosas: un tramo ya celebrado que aún no ha
    llegado no se pinta a medias con un aviso de carga; se sigue viendo el
    anterior hasta que llega entero, como una navegación sin esqueleto.
  */
  const [vistaPedida, setVista] = React.useState<Vista>(
    inicial?.vista ?? 'trimestre',
  );
  const [anclaPedida, setAncla] = React.useState(() => {
    if (!inicial?.mes) return new Date();
    const [anio, mes] = inicial.mes.split('-').map(Number);
    return new Date(anio, mes - 1, 1);
  });
  /*
    EL ÁMBITO: NACIONAL O INTERNACIONAL.

    Es la pregunta que más se hace y la que peor se respondía. Un floretista
    absoluto ve en el mismo mes las Copas del Mundo, el circuito europeo, los
    TNR y las ligas, y la decisión que está tomando casi siempre es de un
    lado o del otro: o mira a qué internacionales va —que son las que llevan
    billete, visado y convocatoria— o mira el calendario de casa.

    NO sale de `event.scope`, y esto importa. El calendario de la RFEE en
    Skermo **republica las Copas del Mundo**, así que por `scope` medio
    calendario internacional está marcado como nacional. Sale de
    `organismoDe()`, que es la función que ya resuelve ese enredo para pintar
    los colores: FIE y EFC son internacional; RFEE y autonómico, nacional.
    Si se separasen las dos reglas, un día dirían cosas distintas y la
    tarjeta tendría un color y el filtro otro.
  */
  const [ambito, setAmbito] = React.useState<Ambito>(inicial?.ambito ?? 'TODO');
  /*
    Lo recordado manda sobre lo de arranque, pero sólo si aún significa algo:
    una selección vacía o categorías que ya no existen en el calendario dejarían
    la pantalla sin torneos, así que en ese caso se arranca con lo suyo.
  */
  const [armas, setArmas] = React.useState<Weapon[]>(
    inicial?.armas?.length ? inicial.armas : propio.armas,
  );
  const [generos, setGeneros] = React.useState<('M' | 'F')[]>(
    inicial?.generos?.length ? inicial.generos : propio.generos,
  );
  const [categorias, setCategorias] = React.useState<string[]>(() => {
    const recordadas = (inicial?.categorias ?? []).filter((c) =>
      categoriasDisponibles.includes(c),
    );
    return recordadas.length > 0 ? recordadas : propio.categorias;
  });
  const [busqueda, setBusqueda] = React.useState(inicial?.busqueda ?? '');
  const [buscando, setBuscando] = React.useState(false);
  /**
   * Hacia dónde se movió la última vez.
   *
   * El único movimiento no pedido de esta pantalla: al cambiar de mes, la
   * rejilla entra por el lado del que viene. Dice si vas hacia delante o hacia
   * atrás en la temporada, que en un calendario es la orientación básica, y
   * dura 200 ms.
   */
  const [, setDireccion] = React.useState<-1 | 0 | 1>(0);
  const [abierto, setAbierto] = React.useState<EventView | null>(null);
  /** El torneo pasado cuya hoja de resultados está abierta. */
  const [abiertoPasado, setAbiertoPasado] = React.useState<EventView | null>(null);
  const cerrarFichas = React.useCallback(() => {
    setAbierto(null);
    setAbiertoPasado(null);
  }, []);
  useEntradaDeHistorial(abierto !== null || abiertoPasado !== null, cerrarFichas);

  /**
   * ===========================================================================
   * LO YA CELEBRADO, POR TRAMOS
   * ===========================================================================
   *
   * `eventos` es de hoy en adelante. Lo anterior —los torneos del calendario
   * ya tirados y lo que Explorar sabe de años en los que el calendario no
   * existía— se pide al servidor por el tramo que se está mirando, una vez, y
   * se guarda aquí: volver a septiembre después de mirar noviembre no vuelve a
   * la red.
   *
   * Un tramo que falla se queda marcado como fallo, se dice en pantalla, y se
   * reintenta la próxima vez que se llega a él.
   *
   * Y no se espera a llegar: el tramo de al lado se pide en cuanto hay
   * intención (el puntero sobre una flecha, un toque, el foco), y mientras el
   * pedido no ha llegado se sigue pintando el que había.
   */
  const hoy = isoDeHoy();
  const [tramos, setTramos] = React.useState<
    Record<string, { estado: EstadoDelMes; datos: TramoPasado | null }>
  >(() =>
    pasadoInicial
      ? { [claveDeTramo(pasadoInicial)]: { estado: 'listo', datos: pasadoInicial } }
      : {},
  );
  const tramoDe = React.useCallback(
    (a: Date, v: Vista) => {
      const t = tramoDeMeses(a.getFullYear(), a.getMonth(), v === 'mes' ? 1 : 3);
      return tramoPasadoDe(t.desde, t.hasta, hoy);
    },
    [hoy],
  );

  /** El tramo guardado que ya cubre `t`, si lo hay: un mes dentro de un trimestre ya leído. */
  const cubiertoPor = React.useCallback(
    (t: { desde: string; hasta: string }) =>
      Object.values(tramos).find(
        (x) => x.estado === 'listo' && x.datos && x.datos.desde <= t.desde && x.datos.hasta >= t.hasta,
      ) ?? null,
    [tramos],
  );

  // Lo último de `tramos` para las peticiones lanzadas desde un evento, y lo que ya va en camino.
  const tramosVistos = React.useRef(tramos);
  React.useEffect(() => {
    tramosVistos.current = tramos;
  }, [tramos]);
  const enCamino = React.useRef(new Set<string>());
  const pedirTramo = React.useCallback(
    (t: { desde: string; hasta: string } | null) => {
      if (!t || !cargarPasado) return;
      const clave = claveDeTramo(t);
      const guardados = tramosVistos.current;
      if (enCamino.current.has(clave) || guardados[clave]?.estado === 'listo') return;
      const cubre = Object.values(guardados).some(
        (x) => x.estado === 'listo' && x.datos && x.datos.desde <= t.desde && x.datos.hasta >= t.hasta,
      );
      if (cubre) return;
      enCamino.current.add(clave);
      setTramos((x) => ({ ...x, [clave]: { estado: 'cargando', datos: x[clave]?.datos ?? null } }));
      cargarPasado(t.desde, t.hasta)
        // En una Transition: si el periodo pedido esperaba este tramo, el cambio entra con fundido.
        .then((datos) =>
          enTransicion(() => setTramos((x) => ({ ...x, [clave]: { estado: 'listo', datos } }))),
        )
        .catch(() => setTramos((x) => ({ ...x, [clave]: { estado: 'fallo', datos: null } })))
        .finally(() => enCamino.current.delete(clave));
    },
    [cargarPasado],
  );

  const tramoPedido = React.useMemo(
    () => tramoDe(anclaPedida, vistaPedida),
    [tramoDe, anclaPedida, vistaPedida],
  );
  const clavePedida = tramoPedido ? claveDeTramo(tramoPedido) : null;
  React.useEffect(() => {
    pedirTramo(tramoPedido);
    // Solo al pedir otro tramo: el propio `tramoPedido` es un objeto nuevo en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clavePedida, pedirTramo]);

  /** Lo pedido ya se puede pintar: no tiene pasado, ya llegó, o falló (y el fallo se dice). */
  const pedidaLista =
    !tramoPedido ||
    !cargarPasado ||
    Boolean(cubiertoPor(tramoPedido)) ||
    tramos[clavePedida!]?.estado === 'fallo';
  const [mostrada, setMostrada] = React.useState({ ancla: anclaPedida, vista: vistaPedida });
  if (pedidaLista && (mostrada.ancla !== anclaPedida || mostrada.vista !== vistaPedida)) {
    setMostrada({ ancla: anclaPedida, vista: vistaPedida });
  }
  const ancla = pedidaLista ? anclaPedida : mostrada.ancla;
  const vista = pedidaLista ? vistaPedida : mostrada.vista;
  /** Hay un tramo pedido en camino y se sigue pintando el anterior. */
  const esperando = !pedidaLista;

  const tramoActual = React.useMemo(() => tramoDe(ancla, vista), [tramoDe, ancla, vista]);
  const claveActual = tramoActual ? claveDeTramo(tramoActual) : null;

  const estadoActual: EstadoDelMes =
    !tramoActual || cubiertoPor(tramoActual) || !cargarPasado
      ? 'listo'
      : (tramos[claveActual!]?.estado ?? 'cargando');

  /** Un mes del tramo se da por leído si empieza hoy o después, o si el tramo ya llegó. */
  const estadoDelMes = React.useCallback(
    (mes: string): EstadoDelMes => (`${mes}-01` >= hoy ? 'listo' : estadoActual),
    [hoy, estadoActual],
  );

  /** Lo de hoy en adelante y todo lo ya celebrado que se ha ido leyendo, sin repetir. */
  const { todos, resultadosPasados, importados } = React.useMemo(() => {
    const vistos = new Set(eventos.map((e) => e.id));
    const lista = [...eventos];
    const resultados: Record<string, PruebaPasada[]> = {};
    const deExplorar = new Set<string>();
    for (const { datos } of Object.values(tramos)) {
      if (!datos) continue;
      Object.assign(resultados, datos.resultados);
      for (const id of datos.importados) deExplorar.add(id);
      for (const e of datos.eventos) {
        if (vistos.has(e.id)) continue;
        vistos.add(e.id);
        lista.push(e);
      }
    }
    return { todos: lista, resultadosPasados: resultados, importados: deExplorar };
  }, [eventos, tramos]);

  /** Un torneo que solo existe en Explorar se abre por sus resultados, no por una ficha de inscripción. */
  const abrir = React.useCallback(
    (e: EventView) => (importados.has(e.id) ? setAbiertoPasado(e) : setAbierto(e)),
    [importados],
  );

  /**
   * Quién va al torneo abierto.
   *
   * Se pide al abrir la ficha y no con el calendario: son cientos de torneos y
   * traerse las inscripciones de todos para enseñar las de uno sería un viaje
   * de red enorme a cambio de nada.
   */
  const [lecturaInscritos, setLecturaInscritos] = React.useState<
    LecturaDeEvento<QuienVa>
  >(SIN_EVENTO);
  const abiertoId = abierto?.id ?? null;
  const abiertoFin = abierto?.endDate ?? null;
  const lecturaAbierta = lecturaDelEvento(lecturaInscritos, abiertoId);
  // Lo precargado con la intención de abrir la ficha se pinta ya en la primera vuelta.
  const inscritos =
    datosVigentes(lecturaAbierta) ?? (abierto ? (fichaRecibida(abierto)?.inscritos ?? null) : null);
  const falloInscritos = lecturaAbierta.tipo === 'error';

  // Depende del id y no del objeto del evento: reabrir el mismo torneo no
  // borra lo leído, y un fallo se señala aparte sin disfrazarse de lista vacía.
  React.useEffect(() => {
    if (!abiertoId || !abiertoFin) return;
    return iniciarLectura({
      eventoId: abiertoId,
      cargar: cargarInscritos
        ?? ((id) =>
          leerFicha({ id, endDate: abiertoFin }).then((f) => {
            if (!f.inscritos) throw new Error('inscritos');
            return f.inscritos;
          })),
      actualizar: setLecturaInscritos,
    });
  }, [abiertoId, abiertoFin, cargarInscritos]);

  /**
   * INTENCIÓN DE ABRIR UNA FICHA: se pide antes de que llegue el toque.
   *
   * Un solo manejador para toda la pantalla, por delegación: cada tarjeta lleva
   * `data-evento`. Con ratón espera a que el puntero se pare un instante sobre
   * la tarjeta (pasar por encima de diez no pide diez fichas); con el dedo y el
   * teclado, al momento.
   */
  const porId = React.useMemo(() => new Map(todos.map((e) => [e.id, e])), [todos]);
  const temporizadorFicha = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const intencionDeFicha = React.useCallback(
    (destino: EventTarget | null, esperaMs: number) => {
      if (temporizadorFicha.current) clearTimeout(temporizadorFicha.current);
      temporizadorFicha.current = null;
      const id = destino instanceof Element ? destino.closest('[data-evento]')?.getAttribute('data-evento') : null;
      const evento = id ? porId.get(id) : undefined;
      if (!evento || importados.has(evento.id)) return;
      if (esperaMs === 0) precargarFicha(evento);
      else temporizadorFicha.current = setTimeout(() => precargarFicha(evento), esperaMs);
    },
    [porId, importados],
  );
  React.useEffect(
    () => () => {
      if (temporizadorFicha.current) clearTimeout(temporizadorFicha.current);
    },
    [],
  );

  const todoPuesto =
    armas.length === ARMAS.length &&
    generos.length === GENEROS.length &&
    categorias.length === categoriasDisponibles.length;

  const verTodo = () => {
    setArmas([...ARMAS]);
    setGeneros([...CODIGOS_GENERO]);
    setCategorias(categoriasDisponibles);
  };
  const verLoMio = () => {
    setArmas(propio.armas);
    setGeneros(propio.generos);
    setCategorias(propio.categorias);
  };

  /**
   * Al cambiar de tirador, los filtros se van con él.
   *
   * Si no, se queda uno mirando el calendario de espada femenino con el hijo
   * de sable seleccionado, que es la forma más rápida de inscribir a quien no
   * era.
   */
  const cambiarTirador = (id: string) => {
    const nuevo = tiradores.find((t) => t.id === id);
    if (!nuevo) return;
    setTiradorId(id);
    const suyo = arranqueDelCalendario(perfil, nuevo, categoriasDisponibles);
    setArmas(suyo.armas);
    setGeneros(suyo.generos);
    setCategorias(suyo.categorias);
  };

  /**
   * Los torneos que se pintan.
   *
   * Aquí ya NO entra la búsqueda: buscar no esconde nada. Ver más abajo.
   */
  const filtrados = React.useMemo(() => {
    /*
      Con todas las categorías marcadas no se filtra por categoría. Lo de otros
      años trae categorías que la temporada actual no tiene (M23, M14…) y no
      salen en el filtro; «todas» tiene que querer decir todas.
    */
    const todasLasCategorias = categorias.length >= categoriasDisponibles.length;
    return todos
      .filter((e) => encajaEnElAmbito(e, ambito))
      .map((e) => ({
        ...e,
        competitions: e.competitions.filter(
          (c) =>
            armas.includes(c.weapon) &&
            // Las pruebas por equipos mixtos no tienen género propio: se ven
            // siempre, porque descartarlas sería esconder competiciones.
            (c.gender === 'MIXTO' || generos.includes(c.gender as 'M' | 'F')) &&
            (todasLasCategorias || categorias.includes(c.category)),
        ),
      }))
      .filter((e) => e.competitions.length > 0);
  }, [todos, ambito, armas, generos, categorias, categoriasDisponibles]);

  /**
   * BUSCAR TE LLEVA, NO TE ESCONDE.
   *
   * Antes el buscador era un filtro: al escribir «mundial» desaparecía todo lo
   * demás y había que acordarse de vaciar la caja. Y no respondía a la
   * pregunta que se estaba haciendo, que no es «qué torneos se llaman mundial»
   * sino **cuándo es el mundial**.
   *
   * Sigue llevando al mes del torneo y resaltándolo. Lo único que cambia es el
   * envoltorio: el campo de la cabecera, que estaba siempre vacío y se llevaba
   * media anchura, es ahora un icono que abre una paleta (`Command`). Al
   * elegir una coincidencia se salta a su mes; la banda de arriba pasa a
   * enseñar ese torneo, con flechas para pasar de una coincidencia a otra y un
   * aspa para volver a lo normal. Así el estado de búsqueda **se ve**, que era
   * el riesgo de esconder la caja.
   */
  const coincidencias = React.useMemo(() => {
    const t = busqueda.trim().toLowerCase();
    if (!t) return [];
    return filtrados
      .filter((e) =>
        `${e.name} ${e.city ?? ''} ${e.country ?? ''}`.toLowerCase().includes(t),
      )
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  }, [filtrados, busqueda]);

  const resaltados = React.useMemo(
    () => new Set(coincidencias.map((e) => e.id)),
    [coincidencias],
  );

  const [cual, setCual] = React.useState(0);

  // Al cambiar lo escrito se vuelve a la primera coincidencia.
  React.useEffect(() => setCual(0), [busqueda]);

  const irA = React.useCallback((iso: string) => {
    const d = new Date(`${iso}T12:00:00`);
    enTransicion(() => setAncla((previa) => {
      if (
        previa.getFullYear() === d.getFullYear() &&
        previa.getMonth() === d.getMonth()
      ) {
        return previa;
      }
      setDireccion(
        d.getTime() > new Date(previa.getFullYear(), previa.getMonth(), 1).getTime()
          ? 1
          : -1,
      );
      return new Date(d.getFullYear(), d.getMonth(), 1);
    }));
  }, []);

  // El salto de mes va en un efecto y no en el `onSelect` para que también
  // funcione al cambiar de coincidencia con las flechas.
  const encontrado = coincidencias[cual] ?? null;
  /*
    Al volver con una búsqueda recordada, el periodo recordado manda: saltar al
    mes de la primera coincidencia deshacería justo lo que se vuelve a ver.
    Sólo se omite ese primer salto, y se libera en cuanto hay uno propio.
  */
  const [sinSaltoDe] = React.useState<string | null>(() =>
    inicial?.mes && inicial.busqueda ? (encontrado?.id ?? null) : null,
  );
  const yaSalto = React.useRef(false);
  React.useEffect(() => {
    if (!encontrado) return;
    if (!yaSalto.current && encontrado.id === sinSaltoDe) return;
    yaSalto.current = true;
    irA(encontrado.startDate);
  }, [encontrado, irA, sinSaltoDe]);

  /**
   * El calendario tal y como se está mirando, como dirección acotada: es lo que
   * llevan los enlaces a una edición para que volver desde ella, una persona o
   * los favoritos reabra este mismo periodo y estos filtros.
   */
  const retornoCalendario = React.useMemo(
    () =>
      construirUrlCalendario({
        vista,
        mes: `${ancla.getFullYear()}-${String(ancla.getMonth() + 1).padStart(2, '0')}`,
        ambito,
        armas,
        generos,
        categorias,
        busqueda,
        tiradorId: tirador?.id,
      }),
    [vista, ancla, ambito, armas, generos, categorias, busqueda, tirador?.id],
  );

  /** Lo que las tarjetas necesitan para decir «Terminada» y enlazar sus resultados. */
  const pasadoDeTarjeta = React.useMemo<PasadoDeTarjeta>(
    () => ({
      hoy,
      resultados: resultadosPasados,
      retorno: retornoCalendario,
      onVer: setAbiertoPasado,
    }),
    [hoy, resultadosPasados, retornoCalendario],
  );

  /** Se cuentan pruebas, no torneos: es lo que de verdad se puede tirar. */
  const numPruebas = React.useMemo(
    () => filtrados.reduce((n, e) => n + e.competitions.length, 0),
    [filtrados],
  );

  /**
   * Lo próximo que hay, de lo que se está mirando.
   *
   * Es la respuesta a la única pregunta que trae a nadie a esta pantalla:
   * «¿cuándo compito y cuánto me queda?». Antes no estaba en ninguna parte:
   * había que contar días en la rejilla a ojo. Se calcula sobre lo filtrado,
   * así que para una tiradora es su próxima competición y para la dirección
   * técnica el próximo torneo del calendario que esté mirando.
   */
  const proximo = React.useMemo(() => {
    const hoy = isoDeHoy();
    return (
      [...filtrados]
        .filter((e) => e.endDate >= hoy)
        .sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null
    );
  }, [filtrados]);

  const meses = React.useMemo(
    () =>
      Array.from(
        { length: vista === 'mes' ? 1 : 3 },
        (_, i) => new Date(ancla.getFullYear(), ancla.getMonth() + i, 1),
      ),
    [ancla, vista],
  );

  /**
   * LOS BLOQUES DE COMPETICIÓN, QUE SON LA UNIDAD DE LA PANTALLA.
   *
   * Se calculan una vez para todo lo que se está mirando y cada columna se
   * queda con los de su mes (`itemsDelMes`). No se agrupa por mes primero: dos
   * eventos que se solapan a caballo entre octubre y noviembre son el mismo
   * bloque, y partirlo por el mes lo rompería en dos medias tarjetas.
   *
   * Toda la lógica es una función normal y está probada en
   * `tests/bloques.test.ts`.
   */
  const bloques = React.useMemo(() => agruparEnBloques(filtrados), [filtrados]);

  /** El último día del tramo que se está pintando. */
  const finDelTramo = React.useMemo(() => {
    const ultimo = meses[meses.length - 1];
    const d = new Date(ultimo.getFullYear(), ultimo.getMonth() + 1, 0);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  }, [meses]);

  /**
   * Lo próximo que hay **fuera** del tramo que se está pintando.
   *
   * La misma respuesta a la misma pregunta en los dos sitios donde acaba: al
   * final de la columna en escritorio y al final del feed en el móvil, detrás
   * del calendario, que es lo que pidió el usuario.
   *
   * Se compara con el rango REAL (el de las pruebas), no con `startDate`: si
   * el cartel de un torneo empieza el 30 de noviembre pero solo se tira el 1 y
   * el 2 de diciembre, su bloque está en diciembre y aquí tiene que salir.
   */
  const fuera = React.useMemo(() => {
    const hoy = isoDeHoy();
    return filtrados
      .filter((e) => {
        const r = rangoRealDeEvento(e);
        return r.desde > finDelTramo && r.hasta >= hoy;
      })
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .slice(0, CUANTO_DESPUES);
    /*
      AQUÍ SE QUITÓ UNA EXCLUSIÓN, Y ESTA ES LA RAZÓN.

      Esta lista descartaba el torneo del marcador de arriba, «para no enseñar
      la misma tarjeta dos veces». Tenía sentido cuando las dos eran tarjetas
      parecidas; ahora hace daño por dos sitios, y los dos se ven en la
      captura de septiembre en un iPhone:

      1. **En el móvil el marcador NO existe.** Va `hidden sm:flex` porque no
         cabe. Así que descartar su torneo no evitaba una repetición: lo
         escondía. La primera competición de la temporada desaparecía del
         teléfono.
      2. **Rompía la cuenta de un bloque múltiple.** El fin de semana del 3 de
         octubre tiene cuatro torneos de florete y la tarjeta decía
         «Competición múltiple · 3 torneos», porque el cuarto era el del
         marcador. Un número que no cuadra al contar es peor que no ponerlo.

      Y la repetición que se temía ya no lo es: el marcador es un renglón de
      44 px con el nombre y los días, no una tarjeta. Que lo próximo salga
      arriba en una línea y abajo con su fecha y su sede no es decir dos veces
      lo mismo; es el titular y la ficha.
    */
  }, [filtrados, finDelTramo]);

  /** Torneos que caen en el tramo que pinta la vista. El denominador. */
  const enElTramo = React.useMemo(() => {
    const primero = meses[0];
    const desde = `${primero.getFullYear()}-${String(
      primero.getMonth() + 1,
    ).padStart(2, '0')}-01`;
    return bloques
      .filter((b) => b.rango.desde >= desde && b.rango.desde <= finDelTramo)
      .reduce((n, b) => n + b.eventos.length, 0);
  }, [bloques, meses, finDelTramo]);

  const mover = (paso: number) => {
    setDireccion(paso > 0 ? 1 : -1);
    enTransicion(() =>
      setAncla(
        (p) => new Date(p.getFullYear(), p.getMonth() + paso * (vistaPedida === 'mes' ? 1 : 3), 1),
      ),
    );
  };
  /** Intención de ir al tramo de al lado (o al de hoy): se pide ya, para que al pulsar esté. */
  const precargarPaso = (paso: number) =>
    pedirTramo(
      tramoDe(
        paso === 0
          ? new Date()
          : new Date(
              anclaPedida.getFullYear(),
              anclaPedida.getMonth() + paso * (vistaPedida === 'mes' ? 1 : 3),
              1,
            ),
        vistaPedida,
      ),
    );
  const intencionDePaso = (paso: number) => ({
    onPointerEnter: () => precargarPaso(paso),
    onTouchStart: () => precargarPaso(paso),
    onFocus: () => precargarPaso(paso),
  });

  // El mes de hoy en hora española: el día 1 a la una de la mañana, el huso
  // del servidor y el del navegador no coinciden ni en el mes.
  const [anioHoy, mesHoy] = hoyMadrid().split('-').map(Number);
  const enElMesActual =
    ancla.getFullYear() === anioHoy && ancla.getMonth() === mesHoy - 1;

  /** «marzo 2019» escrito en el buscador: se ofrece ir a ese mes. */
  const saltoDeMes = React.useMemo(
    () => leerSaltoDeMes(busqueda, anioHoy),
    [busqueda, anioHoy],
  );

  /** ⌘K / Ctrl+K abre la paleta, como en cualquier herramienta de hoy. */
  React.useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setBuscando(true);
      }
    };
    document.addEventListener('keydown', alPulsar);
    return () => document.removeEventListener('keydown', alPulsar);
  }, []);

  /**
   * Arma y género en las barras, solo cuando el filtro abarca más de uno.
   *
   * Con el calendario filtrado por florete femenino, «FLO F» en cada barra es
   * el 100 % de lo que se está mirando: no informa y se come 45 px del nombre
   * justo donde menos sitio hay.
   */
  const mostrarArma = armas.length > 1;
  const mostrarGenero = generos.length > 1;
  const mostrarCategoria = categorias.length > 1;

  return (
    <div
      className="calendario flex min-h-0 min-w-0 flex-1 flex-col gap-3"
      onPointerOver={(e) => intencionDeFicha(e.target, e.pointerType === 'touch' ? 0 : 120)}
      onFocus={(e) => intencionDeFicha(e.target, 0)}
    >
      {/*
        EL TÍTULO DE LA PANTALLA ESTÁ EN LA CABECERA COMPACTA.

        La cabecera de la aplicación pinta la marca en la raíz del Calendario
        (`cabeceraDeRuta`); aquí queda el periodo que se mira, como `<h2>`, con
        las flechas y la lupa en la misma fila, y debajo los filtros en una
        fila de chips (`docs/diseno-sistema.md` § 1.2 y § 7).
      */}
      <h1 className="sr-only">Calendario</h1>
      <div className="flex shrink-0 flex-col gap-[8px]">
        <div className="flex min-h-[36px] items-center gap-[4px]">
          {/*
            El año se calla en el móvil cuando es el de hoy; si se mira otro
            año, sale, que es cuando hace falta saberlo.
          */}
          <h2 className="min-w-0 flex-1 truncate text-[20px] leading-[24px]">
            {vista === 'mes' ? (
              <>
                {nombreMes(ancla, false)}{' '}
                <span
                  className={cn(
                    'cifra font-normal text-muted-foreground',
                    ancla.getFullYear() === anioHoy && 'hidden sm:inline',
                  )}
                >
                  {ancla.getFullYear()}
                </span>
              </>
            ) : (
              <>
                <span className="sm:hidden">
                  {nombreMes(meses[0], false).slice(0, 3)} –{' '}
                  {nombreMes(meses[2], false).slice(0, 3)}{' '}
                </span>
                <span className="hidden sm:inline">
                  {nombreMes(meses[0], false)} – {nombreMes(meses[2], false)}{' '}
                </span>
                <span className="cifra font-normal text-muted-foreground">
                  {meses[2].getFullYear()}
                </span>
              </>
            )}
          </h2>

          {/* Con un tramo pedido en camino se sigue viendo el anterior; sólo cambia el cursor. */}
          <div
            className={cn('flex shrink-0 items-center gap-[4px]', esperando && 'cursor-progress')}
            aria-busy={esperando || undefined}
          >
            <BotonIcono
              etiqueta={vista === 'mes' ? 'Mes anterior' : 'Trimestre anterior'}
              tamano="md"
              onClick={() => mover(-1)}
              {...intencionDePaso(-1)}
            >
              <ChevronLeft aria-hidden />
            </BotonIcono>
            {/* «Hoy» solo cuando lleva a otro sitio. */}
            {!enElMesActual ? (
              <Boton
                tamano="sm"
                aria-label="Ir al mes actual"
                {...intencionDePaso(0)}
                onClick={() => {
                  setDireccion(0);
                  enTransicion(() => setAncla(new Date()));
                }}
              >
                Hoy
              </Boton>
            ) : null}
            <BotonIcono
              etiqueta={vista === 'mes' ? 'Mes siguiente' : 'Trimestre siguiente'}
              tamano="md"
              onClick={() => mover(1)}
              {...intencionDePaso(1)}
            >
              <ChevronRight aria-hidden />
            </BotonIcono>
            <BotonIcono
              etiqueta="Buscar un torneo o una sede"
              tamano="md"
              onClick={() => setBuscando(true)}
            >
              <Search aria-hidden />
            </BotonIcono>
          </div>
        </div>

        <FiltrosCalendario
          ambito={ambito}
          setAmbito={setAmbito}
          // Lo pedido: el conmutador responde al toque aunque el trimestre aún esté llegando.
          vista={vistaPedida}
          setVista={setVista}
          armas={armas}
          setArmas={setArmas}
          generos={generos}
          setGeneros={setGeneros}
          categorias={categorias}
          setCategorias={setCategorias}
          categoriasDisponibles={categoriasDisponibles}
          tiradores={tiradores}
          tiradorId={tirador?.id ?? null}
          cambiarTirador={cambiarTirador}
          propio={propio}
          todoPuesto={todoPuesto}
          verTodo={verTodo}
          verLoMio={verLoMio}
          numPruebas={numPruebas}
          numTorneos={filtrados.length}
          temporada={temporada}
          actualizado={actualizado}
        />

        {/*
          El marcador: lo próximo o, buscando, la coincidencia en la que se
          está. En el móvil solo buscando: ahí la primera tarjeta del feed ya
          es lo próximo.
        */}
        <FranjaDestacada
          clase={cn('w-full min-w-0', !busqueda.trim() && 'hidden sm:flex')}
          evento={encontrado ?? proximo}
          buscando={Boolean(busqueda.trim())}
          cual={cual}
          total={coincidencias.length}
          hayTiradores={tiradores.length > 0}
          onAnterior={() =>
            setCual((p) => (p - 1 + coincidencias.length) % coincidencias.length)
          }
          onSiguiente={() => setCual((p) => (p + 1) % coincidencias.length)}
          onLimpiar={() => setBusqueda('')}
          onAbrir={abrir}
        />
      </div>

      {/*
        Sin ficha, el calendario no sabe tu arma ni tu categoría, así que lo
        que se ve es «todo» y no sirve para organizarse. El aviso va aquí y no
        en un menú porque es justo aquí donde se nota el hueco, y desaparece
        solo en cuanto la ficha existe.
      */}
      {sinFicha ? (
        <Link
          href="/alta"
          /*
            Superficie sólida y el rojo donde se lee.
            El aviso iba con `bg-primary/10`, que sobre el lienzo texturado
            deja pasar la cuña y la retícula: un rojo sucio con dibujos
            dentro. Ahora la superficie es `bg-card` y la señal de marca la
            dan el borde y el título en `text-primary-text`, que es el rojo
            medido para texto (5,60:1). Mismo aviso, sin velo.
          */
          className="flex min-h-[44px] shrink-0 items-center gap-[12px] rounded-[12px] border border-primary-text bg-card px-[12px] py-[8px] text-[14px] leading-[20px] transition-colors hover:bg-accent"
        >
          <span className="min-w-0 flex-1">
            <span className="font-medium text-primary-text">Vincula tu ficha</span>{' '}
            <span className="text-muted-foreground">para ver tu arma y categoría</span>
          </span>
          <ChevronRight className="size-[18px] shrink-0" aria-hidden />
        </Link>
      ) : null}

      {filtrados.length === 0 ? (
        <Empty className="flex-1 border border-dashed">
          <EmptyHeader>
            <EmptyTitle>Sin pruebas</EmptyTitle>
            <EmptyDescription>Ninguna encaja con estos filtros.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Boton tamano="lg" variante="claro" onClick={verTodo}>
              Ver todo
            </Boton>
          </EmptyContent>
        </Empty>
      ) : (
        <TransicionContenido
          // El periodo pintado: al cambiar de mes o de trimestre, fundido (§ 4).
          clave={`${vista}-${ancla.getFullYear()}-${ancla.getMonth()}`}
          nombre="calendario-periodo"
        >
        <div className="flex min-h-0 flex-1 flex-col">
          {/*
            ===============================================================
            EL MÓVIL: UNA SOLA COLUMNA, LAS DOS VISTAS IGUAL
            ===============================================================

            Y aquí se arregla el fallo que el usuario mandó con captura: en la
            vista de «1 mes» salía una mini-rejilla comprimida de números sin
            barras y debajo la lista de próximos días. *«la vista de 1 mes no
            se ve nada… debería verse como lo de 3 meses, y si quieres haciendo
            scroll luego lo de los próximos días»*.

            Así que en el móvil **no hay dos vistas**: hay un feed de una
            columna con uno o tres meses dentro, según el conmutador, y «lo
            próximo» al final. La única diferencia entre «1 mes» y «3 meses» en
            un teléfono es cuántos meses trae el feed, que es exactamente lo
            que el conmutador debería significar.

            El árbol del móvil y el del escritorio existen los dos y se apagan
            con CSS, no con `matchMedia`: un interruptor en JavaScript no sabe
            el tamaño de la pantalla hasta después del primer pintado. Esta
            pantalla ya peleó ese salto una vez.
          */}
          <div className="flex min-h-0 flex-1 flex-col sm:hidden">
            <FeedMovil
              meses={meses.map((m) => ({ anio: m.getFullYear(), mes: m.getMonth() }))}
              bloques={bloques}
              inscripciones={inscripciones}
              resaltados={resaltados}
              proximo={proximo?.id ?? null}
              mostrarArma={mostrarArma}
              mostrarGenero={mostrarGenero}
              mostrarCategoria={mostrarCategoria}
              onAbrir={abrir}
              pasado={pasadoDeTarjeta}
              estadoDelMes={estadoDelMes}
              /*
                «Lo próximo, fuera de este mes» SOLO en la vista de un mes.
                En el trimestre no tiene sentido y era la queja: la sección
                existe para responder «¿y entonces cuándo compito?» cuando el
                mes que miras está flojo. Con tres meses delante esa pregunta
                ya está contestada arriba, y lo que hacía era empujar hacia
                abajo torneos que sí estaban en el tramo.
              */
              pie={
                vista === 'mes' ? (
                  <LoQueViene
                    eventos={fuera}
                    variante="apilada"
                    inscripciones={inscripciones}
                    onAbrir={abrir}
                  />
                ) : null
              }
            />
          </div>

          {/*
            ===============================================================
            EL ESCRITORIO: UNA COLUMNA POR MES
            ===============================================================

            Y ahora las tres columnas del trimestre salen **equilibradas**, que
            es lo que no podía pasar con la rejilla: un mes tiene cinco semanas
            y el siguiente seis, así que las cuadrículas nunca medían igual.
            El alto de una columna de bloques es el de sus competiciones.
            Medido en el navegador a 1440 px con el calendario de florete
            absoluto —septiembre con 0 bloques, octubre con 2, noviembre con
            2—: las tres columnas miden **273 px exactas** y 419 de ancho. Con
            la rejilla, septiembre gastaba seis semanas de cuadrícula para
            enseñar cero torneos y octubre cinco para enseñar dos, así que no
            había forma de que coincidieran.

            Y EL ANCHO: NI UNA TARJETA DE 1288 px, NI MEDIA PANTALLA EN NEGRO
            ---------------------------------------------------------------
            Estirar una tarjeta a los 1288 px de la página deja el plazo a 900
            px del nombre del torneo del que habla, que es exactamente el fallo
            que el usuario rodeó con un círculo en la banda del marcador. Pero
            acotarla a 46 rem y dejar el resto vacío es la otra queja del mismo
            usuario: *«no aprovechas nada bien los espacios»*.

            Así que en la vista de un mes el escritorio son **dos columnas**: el
            mes a la izquierda y «lo próximo, fuera de este mes» a la derecha, a
            unos 640 px cada una. Son dos secciones distintas con su rótulo, no
            un relleno: la segunda responde a la única pregunta que deja un mes
            flojo, que es «y entonces cuándo compito».

            En trimestre no hay «lo próximo» en absoluto. Estuvo debajo, a lo
            ancho, y sobraba: la sección contesta «¿y entonces cuándo compito?»
            para un mes flojo, y con tres meses delante eso ya se ve. Además
            repetía torneos que estaban dos columnas más allá.
          */}
          <div
            /*
              Cuántos torneos hay DE VERDAD en el tramo que se está pintando.
              Es el denominador del único criterio que importa aquí: a cuántos
              se puede llegar sin cambiar de mes. Se publica en el marcado
              porque medirlo desde fuera es la forma de que no se vuelva a
              colar un mes que enseña 7 de 39 y pasa el barrido.
            */
            data-torneos={enElTramo}
            className="hidden min-h-0 flex-1 flex-col gap-3 overflow-y-auto sm:flex"
          >
            <div
              className={cn(
                'grid min-w-0 gap-x-4 gap-y-2',
                vista === 'trimestre' ? 'lg:grid-cols-3' : 'lg:grid-cols-2',
              )}
            >
              {meses.map((m) => (
                <div key={`${m.getFullYear()}-${m.getMonth()}`} className="flex min-w-0 flex-col">
                  <ColumnaMes
                    anio={m.getFullYear()}
                    mes={m.getMonth()}
                    bloques={bloques}
                    // Solo en trimestre: con un mes, su nombre ya está en el título del periodo.
                    conTitulo={vista === 'trimestre'}
                    inscripciones={inscripciones}
                    resaltados={resaltados}
                    proximo={proximo?.id ?? null}
                    mostrarArma={mostrarArma}
                    mostrarGenero={mostrarGenero}
                    mostrarCategoria={mostrarCategoria}
                    onAbrir={abrir}
                    pasado={pasadoDeTarjeta}
                    estado={estadoDelMes(
                      `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`,
                    )}
                  />
                </div>
              ))}

              {/* En la vista de un mes, la segunda columna. */}
              {vista === 'mes' ? (
                <LoQueViene
                  eventos={fuera}
                  variante="zonas"
                  inscripciones={inscripciones}
                  onAbrir={abrir}
                />
              ) : null}
            </div>

          </div>
        </div>
        </TransicionContenido>
      )}

      {filtrados.length > 0 ? <Leyenda /> : null}

      {/*
        La paleta de búsqueda.

        No filtra el calendario: lleva a él. Cada resultado dice de qué es
        —arma, género, categoría, circuito— y cuándo y dónde, que es justo lo
        que hace falta para reconocer el que se buscaba entre cuatro «Copa del
        Mundo Cadete» del mismo mes.
      */}
      <Dialog open={buscando} onOpenChange={setBuscando}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-lg" showCloseButton={false}>
          <DialogTitle className="sr-only">Buscar un torneo o una sede</DialogTitle>
          <Command shouldFilter={false}>
            <CommandInput
              value={busqueda}
              onValueChange={setBusqueda}
              placeholder="Buscar un torneo o una sede"
            />
            <CommandList>
              {/*
                IR A UN MES CUALQUIERA, TAMBIÉN DE HACE AÑOS.

                El calendario llega hacia atrás hasta donde llega Explorar, y
                eso son décadas: a marzo de 2019 había que dar más de ochenta
                toques a la flecha. Escribir «2019» o «marzo 2019» ofrece ir
                directamente. Va arriba y aparte de las coincidencias.
              */}
              {saltoDeMes ? (
                <CommandItem
                  value={`ir-a-${saltoDeMes.anio}-${saltoDeMes.mes}`}
                  onSelect={() => {
                    const destino = new Date(saltoDeMes.anio, saltoDeMes.mes, 1);
                    setDireccion(destino.getTime() > ancla.getTime() ? 1 : -1);
                    enTransicion(() => setAncla(destino));
                    setBusqueda('');
                    setBuscando(false);
                  }}
                  className="min-h-[44px] gap-2 py-3 text-[14px] font-medium"
                >
                  <CalendarSearch className="size-[16px]" aria-hidden />
                  Ir a {nombreMes(new Date(saltoDeMes.anio, saltoDeMes.mes, 1)).toLowerCase()}
                </CommandItem>
              ) : null}
              {busqueda.trim() === '' ? (
                <p className="px-[16px] py-[24px] text-center text-[14px] text-muted-foreground">
                  Torneo, ciudad o mes («marzo 2019»)
                </p>
              ) : saltoDeMes && coincidencias.length === 0 ? null : coincidencias.length === 0 ? (
                <CommandEmpty>Sin coincidencias</CommandEmpty>
              ) : (
                coincidencias.slice(0, 40).map((e, i) => (
                  <CommandItem
                    key={e.id}
                    value={e.id}
                    onSelect={() => {
                      setCual(i);
                      irA(e.startDate);
                      setBuscando(false);
                    }}
                    className="min-h-[44px] flex-col items-start gap-1 py-3"
                  >
                    <span className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="min-w-0 flex-1 break-words text-[14px] leading-[20px] font-medium">
                        {titularTorneo(e.name)}
                      </span>
                      <span className="cifra shrink-0 text-[13px] text-muted-foreground">
                        {formatDateRangeEs(e.startDate, e.endDate)}
                      </span>
                    </span>
                    {/* Dos datos y no tres: el circuito ya dice de quién es. */}
                    <span className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-1 text-[12px] leading-[16px] text-muted-foreground">
                      <span className="min-w-0 break-words">
                        {CIRCUIT_SHORT[e.circuit] ?? CIRCUIT_LABEL[e.circuit] ?? e.circuit}
                      </span>
                      {e.city ? (
                        <span className="min-w-0 break-words">
                          {titular(e.city)}
                          {e.country ? `, ${e.country}` : ''}
                        </span>
                      ) : null}
                    </span>
                  </CommandItem>
                ))
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>

      {/*
        La ficha del torneo y la hoja de resultados de un torneo pasado, como
        subpantalla. Las dos comparten la entrada del historial: pasar de los
        resultados a la ficha del mismo torneo no apila otra.
      */}
      <PantallaFicha
        abierta={abierto !== null}
        alCerrar={() => setAbierto(null)}
        titulo={abierto ? titularTorneo(abierto.name) : ''}
      >
        {abierto ? <CabeceraFicha evento={abierto} /> : null}
        {abierto ? (
          <FichaEvento
            evento={abierto}
            tirador={tirador}
            inscripciones={inscripciones}
            inscritos={inscritos}
            falloInscritos={falloInscritos}
            retornoCalendario={retornoCalendario}
            onSolicitar={async (competitionId) => {
              if (!tirador) return;
              const r = await solicitarInscripcion(competitionId, tirador.id);
              setAbierto(null);
              // A un aviso flotante: una fila nueva movería el calendario justo al volver de la ficha.
              if (r.ok) toast.success(r.message);
              else toast.error(r.error);
            }}
          />
        ) : null}
      </PantallaFicha>

      <PantallaFicha
        abierta={abiertoPasado !== null}
        alCerrar={() => setAbiertoPasado(null)}
        titulo={abiertoPasado ? titularTorneo(abiertoPasado.name) : ''}
      >
        {abiertoPasado ? <CabeceraFicha evento={abiertoPasado} /> : null}
        {abiertoPasado ? (
          <ResultadosPasados
            evento={abiertoPasado}
            pruebas={resultadosPasados[abiertoPasado.id] ?? []}
            retorno={retornoCalendario}
            onAbrirFicha={
              importados.has(abiertoPasado.id)
                ? undefined
                : () => {
                    const evento = abiertoPasado;
                    setAbiertoPasado(null);
                    setAbierto(evento);
                  }
            }
          />
        ) : null}
      </PantallaFicha>
    </div>
  );
}

/**
 * EL MARCADOR: la cifra grande con lo que queda, en UN renglón.
 *
 * Es lo que arregla «se ve plano». Plano quiere decir que todo pesa igual; la
 * cura no es una sombra, es que **una cosa pese mucho más que las demás**. La
 * cifra de los días va en condensada a 32 px y su rótulo a 12: la jerarquía
 * se lee sola, y viene del marcador de un asalto.
 *
 * Toda la franja es el botón que abre la ficha, así que hay **una** acción
 * principal en la pantalla y está donde se mira primero.
 *
 * -------------------------------------------------------------------------
 * DOS COSAS CAMBIADAS, Y LAS DOS LAS MARCÓ EL USUARIO
 * -------------------------------------------------------------------------
 * 1. **De banda a renglón.** Era una banda propia de dos líneas —nombre
 *    arriba, fecha y sede abajo— debajo de la fila de controles: 52 px más
 *    los 6 del filete y el aire. Ahora es la parte elástica de la fila de
 *    controles y todo va en una línea.
 *
 * 2. **El plazo pegado al nombre.** «Inscripción cerrada» iba en la línea del
 *    título pero con el nombre en `flex-1`, así que el plazo se iba al canto
 *    derecho de la fila: en un escritorio de 1440, **a 900 px del torneo del
 *    que hablaba**. Eso es lo que el usuario rodeó con un círculo. Ahora va
 *    justo detrás del nombre y se lee como una frase: «Copa del Mundo Cadete
 *    — Inscripción cerrada». Lo que ahora se estira es la cola —fecha y
 *    sede—, que sí puede irse al canto sin que nadie la eche de menos.
 */
function FranjaDestacada({
  clase,
  evento,
  buscando,
  cual,
  total,
  hayTiradores,
  onAnterior,
  onSiguiente,
  onLimpiar,
  onAbrir,
}: {
  clase?: string;
  evento: EventView | null;
  buscando: boolean;
  cual: number;
  total: number;
  hayTiradores: boolean;
  onAnterior: () => void;
  onSiguiente: () => void;
  onLimpiar: () => void;
  onAbrir: (e: EventView) => void;
}) {
  if (buscando && total === 0) {
    return (
      <div
        className={cn(
          'flex min-h-[44px] min-w-0 items-center gap-[8px] text-[14px] text-muted-foreground',
          clase,
        )}
      >
        <span className="min-w-0 flex-1">Sin coincidencias</span>
        <Boton tamano="sm" onClick={onLimpiar}>
          Quitar búsqueda
        </Boton>
      </div>
    );
  }

  if (!evento) {
    return (
      // El mismo alto que el marcador: quedarse sin competiciones por delante no mueve la rejilla.
      <p
        className={cn(
          'flex min-h-[44px] min-w-0 items-center text-[14px] text-muted-foreground',
          clase,
        )}
      >
        {hayTiradores ? 'Sin próximas competiciones' : 'Sin próximos torneos'}
      </p>
    );
  }

  const dias = diasHasta(evento.startDate);
  // Buscando, la coincidencia puede ser de hace años: no está «en marcha» por haber empezado antes de hoy.
  const terminado = diasHasta(evento.endDate) < 0;
  const enMarcha = dias <= 0 && !terminado;
  const plazo = terminado ? null : plazoDelEvento(evento);

  return (
    // Alto fijo: la cifra es Barlow con `font-display: swap` y su métrica no debe mover la rejilla al llegar.
    <div className={cn('flex min-h-[44px] items-center gap-[8px]', clase)}>
      <Item
        asChild
        size="sm"
        className="min-h-[44px] min-w-0 flex-1 cursor-pointer gap-[12px] rounded-[12px] px-[8px] py-[6px] hover:bg-accent"
      >
        <button
          type="button"
          // Un `<button>` centra su texto por defecto y arrastra a todos sus hijos.
          className="text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          data-evento={evento.id}
          onClick={() => onAbrir(evento)}
          aria-label={
            terminado
              ? `${titularTorneo(evento.name)}, terminada. Abrir.`
              : enMarcha
                ? `${titularTorneo(evento.name)}, en marcha. Abrir la ficha.`
                : `Faltan ${dias} ${dias === 1 ? 'día' : 'días'} para ${titularTorneo(
                    evento.name,
                  )}. Abrir la ficha.`
          }
        >
          <ItemMedia className="min-w-[40px] flex-col items-start gap-0 self-center">
            {terminado ? (
              <>
                <Flag className="size-[18px] text-muted-foreground" aria-hidden />
                <span className="text-[12px] leading-[16px] text-muted-foreground">terminada</span>
              </>
            ) : enMarcha ? (
              // «Ahora» y no «Hoy»: a dos dedos está el botón «Hoy», que lleva al mes en curso.
              <>
                <span className="cifra text-[24px] leading-none text-primary-text">Ahora</span>
                <span className="text-[12px] leading-[16px] text-muted-foreground">en marcha</span>
              </>
            ) : (
              <>
                <span className="cifra text-[32px] leading-none text-foreground">{dias}</span>
                <span className="text-[12px] leading-[16px] text-muted-foreground">
                  {dias === 1 ? 'día' : 'días'}
                </span>
              </>
            )}
          </ItemMedia>

          {/*
            El nombre y su plazo van juntos; detrás, dos datos como mucho
            (fecha y sede), que se apagan por anchura.
          */}
          <ItemContent className="min-w-0 flex-row flex-wrap items-baseline gap-x-[8px] gap-y-[2px]">
            <span className="min-w-0 basis-full break-words text-[14px] leading-[20px] font-semibold">
              {titularTorneo(evento.name)}
            </span>
            {plazo ? (
              <span className={cn('shrink-0 text-[13px] font-medium', plazo.tono)}>{plazo.texto}</span>
            ) : null}
            <span className="cifra hidden shrink-0 rounded-full bg-secondary px-[6px] text-[13px] text-foreground sm:inline">
              {formatDateRangeEs(evento.startDate, evento.endDate)}
            </span>
            {evento.city ? (
              <span className="hidden min-w-0 break-words text-[13px] text-muted-foreground sm:inline">
                {titular(evento.city)}
                {evento.country ? `, ${evento.country}` : ''}
              </span>
            ) : null}
          </ItemContent>
        </button>
      </Item>

      {/* Buscando: contador y flechas, como el buscar de un navegador; el aspa vuelve a lo normal. */}
      {buscando ? (
        <div className="flex shrink-0 items-center gap-[4px]">
          <span className="cifra px-[4px] text-[13px] text-muted-foreground">
            {cual + 1}/{total}
          </span>
          <BotonIcono etiqueta="Coincidencia anterior" tamano="md" onClick={onAnterior}>
            <ChevronLeft aria-hidden />
          </BotonIcono>
          <BotonIcono etiqueta="Coincidencia siguiente" tamano="md" onClick={onSiguiente}>
            <ChevronRight aria-hidden />
          </BotonIcono>
          <BotonIcono etiqueta="Quitar la búsqueda" tamano="md" onClick={onLimpiar}>
            <X aria-hidden />
          </BotonIcono>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Los filtros, en una fila de chips (`docs/diseno-sistema.md` § 1.4 y § 7).
 *
 * Lo que se cambia a menudo va a la vista: el ámbito, el arma y el género.
 * Lo demás (vista de uno o tres meses, categorías, tirador) va en la hoja de
 * «Filtros», que es la misma en el móvil y en el escritorio.
 *
 * Un grupo con todo puesto no marca ningún chip: sin marcar quiere decir «sin
 * filtro». Tocar un chip estando todo puesto deja sólo ese; quitar el último
 * vuelve a ponerlo todo, porque un calendario en blanco no responde nada.
 */
function FiltrosCalendario({
  ambito,
  setAmbito,
  vista,
  setVista,
  armas,
  setArmas,
  generos,
  setGeneros,
  categorias,
  setCategorias,
  categoriasDisponibles,
  tiradores,
  tiradorId,
  cambiarTirador,
  propio,
  todoPuesto,
  verTodo,
  verLoMio,
  numPruebas,
  numTorneos,
  temporada,
  actualizado,
}: {
  ambito: Ambito;
  setAmbito: (a: Ambito) => void;
  vista: Vista;
  setVista: (v: Vista) => void;
  armas: Weapon[];
  setArmas: (a: Weapon[]) => void;
  generos: ('M' | 'F')[];
  setGeneros: (g: ('M' | 'F')[]) => void;
  categorias: string[];
  setCategorias: React.Dispatch<React.SetStateAction<string[]>>;
  categoriasDisponibles: string[];
  tiradores: TiradorOpcion[];
  tiradorId: string | null;
  cambiarTirador: (id: string) => void;
  propio: { propio: boolean; armas: Weapon[]; generos: ('M' | 'F')[]; categorias: string[] };
  todoPuesto: boolean;
  verTodo: () => void;
  verLoMio: () => void;
  numPruebas: number;
  numTorneos: number;
  temporada: string | null;
  actualizado: string | null;
}) {
  const [abierta, setAbierta] = React.useState(false);
  const todasLasArmas = armas.length === ARMAS.length;
  const ambosGeneros = generos.length === GENEROS.length;
  const todasLasCategorias = categorias.length === categoriasDisponibles.length;
  const enLaHoja = todasLasCategorias ? 0 : 1;

  const alternar = <T extends string>(todos: readonly T[], puestos: T[], valor: T): T[] => {
    if (puestos.length === todos.length) return [valor];
    if (puestos.includes(valor)) {
      return puestos.length === 1 ? [...todos] : puestos.filter((x) => x !== valor);
    }
    return todos.filter((x) => x === valor || puestos.includes(x));
  };

  return (
    <>
      <FilaChips etiqueta="Filtros del calendario">
        <ChipFiltro
          tipo="menu"
          icono={SlidersHorizontal}
          marcado={enLaHoja > 0}
          contador={enLaHoja}
          aria-label={`Filtros del calendario${enLaHoja > 0 ? `: ${categorias.length} categorías` : ''}`}
          onClick={() => setAbierta(true)}
        >
          Filtros
        </ChipFiltro>
        {AMBITOS.filter((a) => a.v !== 'TODO').map((a) => (
          <ChipFiltro
            key={a.v}
            marcado={ambito === a.v}
            onClick={() => setAmbito(ambito === a.v ? 'TODO' : a.v)}
          >
            {a.largo}
          </ChipFiltro>
        ))}
        {ARMAS.map((a) => (
          <ChipFiltro
            key={a}
            marcado={!todasLasArmas && armas.includes(a)}
            onClick={() => setArmas(alternar(ARMAS, armas, a))}
          >
            {WEAPON_LABEL[a]}
          </ChipFiltro>
        ))}
        {GENEROS.map((g) => (
          <ChipFiltro
            key={g.v}
            marcado={!ambosGeneros && generos.includes(g.v)}
            onClick={() =>
              setGeneros(
                alternar(
                  GENEROS.map((x) => x.v),
                  generos,
                  g.v,
                ),
              )
            }
          >
            {g.largo}
          </ChipFiltro>
        ))}
      </FilaChips>

      <HojaInferior
        abierta={abierta}
        alCambiar={setAbierta}
        titulo="Filtros"
        pie={
          <Boton variante="claro" tamano="lg" ancho="completo" onClick={() => setAbierta(false)}>
            Ver {numTorneos} {numTorneos === 1 ? 'torneo' : 'torneos'}
          </Boton>
        }
      >
        <div className="flex flex-col gap-[24px] pt-[4px]">
          <div className="flex flex-wrap items-center justify-between gap-[8px]">
            <p className="text-[13px] text-muted-foreground">
              <span className="cifra text-[28px] leading-none text-foreground">{numPruebas}</span>{' '}
              {numPruebas === 1 ? 'prueba' : 'pruebas'}
            </p>
            {propio.propio ? (
              <Boton tamano="md" onClick={todoPuesto ? verLoMio : verTodo}>
                {todoPuesto ? 'Solo lo mío' : 'Ver todo'}
              </Boton>
            ) : (
              <Boton tamano="md" onClick={verTodo} disabled={todoPuesto}>
                Ver todo
              </Boton>
            )}
          </div>

          <GrupoHoja titulo="Vista">
            <ChipFiltro marcado={vista === 'mes'} onClick={() => setVista('mes')}>
              1 mes
            </ChipFiltro>
            <ChipFiltro marcado={vista === 'trimestre'} onClick={() => setVista('trimestre')}>
              3 meses
            </ChipFiltro>
          </GrupoHoja>

          <GrupoHoja
            titulo="Categoría"
            cola={todasLasCategorias ? 'todas' : `${categorias.length} de ${categoriasDisponibles.length}`}
          >
            {categoriasDisponibles.map((c) => {
              const puesta = !todasLasCategorias && categorias.includes(c);
              return (
                <ChipFiltro
                  key={c}
                  marcado={puesta}
                  onClick={() =>
                    setCategorias((previas) =>
                      ordenarCategorias(alternar(categoriasDisponibles, previas, c)),
                    )
                  }
                >
                  {CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL] ?? c}
                </ChipFiltro>
              );
            })}
          </GrupoHoja>

          {/* Solo cuando la cuenta lleva a más de un tirador. */}
          {tiradores.length > 1 ? (
            <GrupoHoja titulo="Tirador">
              {tiradores.map((t) => (
                <ChipFiltro key={t.id} marcado={t.id === tiradorId} onClick={() => cambiarTirador(t.id)}>
                  {t.fullName}
                </ChipFiltro>
              ))}
            </GrupoHoja>
          ) : null}

          {temporada || actualizado ? (
            <p className="text-[12px] leading-[16px] text-muted-foreground">
              {temporada ? `Temporada ${temporada}` : null}
              {temporada && actualizado ? ' · ' : null}
              {actualizado ? `Actualizado ${actualizado}` : null}
            </p>
          ) : null}
        </div>
      </HojaInferior>
    </>
  );
}

function GrupoHoja({
  titulo,
  cola,
  children,
}: {
  titulo: string;
  cola?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-[8px]">
      <legend className="mb-[8px] text-[13px] leading-[16px] font-semibold">
        {titulo}
        {cola ? <span className="ml-[6px] font-normal text-muted-foreground">{cola}</span> : null}
      </legend>
      <FilaChips etiqueta={titulo} envolver>
        {children}
      </FilaChips>
    </fieldset>
  );
}

/**
 * Leyenda, en un solo renglón.
 *
 * Antes eran dos renglones y ocho entradas: los tres organismos, las tres
 * armas, los dos géneros y el «ya estás inscrito». Dos renglones de leyenda
 * son dos renglones menos de calendario, y seis de esas ocho entradas
 * explicaban letras que ahora van **escritas en la propia barra** —F/E/S para
 * el arma, M/F para el género—, así que explicarlas aparte era gastar sitio
 * en repetir.
 *
 * Queda lo único que el color no puede decir por sí mismo. En las tarjetas
 * grandes el organismo va además escrito en su pastilla; esta línea es para
 * las barras de una línea de un mes cargado, donde solo cabe el color.
 */
function Leyenda() {
  return (
    <ul className="flex shrink-0 flex-wrap items-center gap-x-[12px] gap-y-[4px] text-[12px] leading-[16px] text-muted-foreground sm:gap-x-[16px]">
      {(['RFEE', 'FIE', 'EFC'] as const).map((o) => {
        const c = COLOR_ORGANISMO[o];
        return (
          <li key={o} className="flex items-center gap-1.5">
            <span className={cn('h-2.5 w-[3px] shrink-0 rounded-full', c.punto)} aria-hidden />
            <span className="sm:hidden">{c.corto}</span>
            <span className="hidden sm:inline">{c.largo}</span>
          </li>
        );
      })}
      <li className="flex items-center gap-1.5 text-ok">
        <CircleCheck className="size-3.5 shrink-0" aria-hidden />
        <span className="sm:hidden">inscrito</span>
        <span className="hidden sm:inline">Ya estás inscrito</span>
      </li>
      {/*
        Las dos señales nuevas de la tarjeta de bloque. Van aquí y no en un
        globo porque las píldoras de día de la semana son siete cuadrados de 14
        px y el «Entre semana» es un color: las dos se entienden de golpe, pero
        solo si alguien ha dicho una vez qué significan.
      */}
      <li className="hidden items-center gap-1.5 sm:flex">
        <span className="flex items-center gap-[2px]" aria-hidden>
          <span className="size-2.5 rounded-[2px] bg-secondary" />
          <span className="size-2.5 rounded-[2px] bg-org-rfee-relleno" />
          <span className="size-2.5 rounded-[2px] bg-org-rfee-relleno" />
        </span>
        <span>Los días que se tira</span>
      </li>
      <li className="flex items-center gap-1.5 text-warn">
        <span className="h-2.5 w-[3px] shrink-0 rounded-full bg-warn" aria-hidden />
        <span>Entre semana</span>
      </li>
    </ul>
  );
}

/** `<ViewTransition>` sólo anima lo que llega en una Transition; un `setState` suelto cambia sin fundido. */
function enTransicion(cambio: () => void) {
  React.startTransition(cambio);
}

function nombreMes(d: Date, conAnio = true): string {
  return capitalizar(
    new Intl.DateTimeFormat('es-ES', {
      month: 'long',
      ...(conAnio ? { year: 'numeric' } : {}),
    })
      .format(d)
      .replace(' de ', ' '),
  );
}

function isoDeHoy(): string {
  // En hora española, no en la del que ejecuta: ver `hoyMadrid`.
  return hoyMadrid();
}