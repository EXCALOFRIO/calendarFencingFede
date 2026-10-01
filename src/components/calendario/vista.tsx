'use client';

import {
  CalendarSearch,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
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
import { FieldGroup, FieldLegend, FieldSet } from '@/components/ui/field';
import { Item, ItemContent, ItemMedia } from '@/components/ui/item';
import { Kbd } from '@/components/ui/kbd';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTrigger,
  SheetTitle,
} from '@/components/ui/sheet';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
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
import { CabeceraFicha } from './cabecera-ficha';
import { FichaEvento } from './ficha-evento';
import { LoQueViene, diasHasta, plazoDelEvento } from './lo-que-viene';
import { ColumnaMes, FeedMovil } from './timeline';
import { agruparEnBloques, rangoRealDeEvento } from '@/lib/calendario/bloques';
import { hoyMadrid } from '@/lib/callups/fechas';

export type TiradorOpcion = {
  id: string;
  fullName: string;
  gender: 'M' | 'F' | 'MIXTO';
  weapons: string[];
  eligibleCategories: string[];
};

type Vista = 'mes' | 'trimestre';

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
type Ambito = 'TODO' | 'NACIONAL' | 'INTERNACIONAL';

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
 * Y **una altura para toda la fila de herramientas: `h-8`** (32 px). Eran
 * tres alturas distintas y el botón de filtros sobresalía 4 px por abajo del
 * buscador con el que comparte grupo; medido en el navegador, no a ojo.
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
}: {
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
  /** Quién va a un torneo. Se pide al abrir la ficha, no antes. */
  cargarInscritos: (eventId: string) => Promise<QuienVa>;
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
    tiradores[0]?.id ?? null,
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
  const [vista, setVista] = React.useState<Vista>('trimestre');
  const [ancla, setAncla] = React.useState(() => new Date());
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
  const [ambito, setAmbito] = React.useState<Ambito>('TODO');
  const [armas, setArmas] = React.useState<Weapon[]>(propio.armas);
  const [generos, setGeneros] = React.useState<('M' | 'F')[]>(propio.generos);
  const [categorias, setCategorias] = React.useState<string[]>(propio.categorias);
  const [busqueda, setBusqueda] = React.useState('');
  const [buscando, setBuscando] = React.useState(false);
  /**
   * Hacia dónde se movió la última vez.
   *
   * El único movimiento no pedido de esta pantalla: al cambiar de mes, la
   * rejilla entra por el lado del que viene. Dice si vas hacia delante o hacia
   * atrás en la temporada, que en un calendario es la orientación básica, y
   * dura 200 ms.
   */
  const [direccion, setDireccion] = React.useState<-1 | 0 | 1>(0);
  const [abierto, setAbierto] = React.useState<EventView | null>(null);

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
  const lecturaAbierta = lecturaDelEvento(lecturaInscritos, abiertoId);
  const inscritos = datosVigentes(lecturaAbierta);
  const falloInscritos = lecturaAbierta.tipo === 'error';

  // Depende del id y no del objeto del evento: reabrir el mismo torneo no
  // borra lo leído, y un fallo se señala aparte sin disfrazarse de lista vacía.
  React.useEffect(() => {
    if (!abiertoId) return;
    return iniciarLectura({
      eventoId: abiertoId,
      cargar: cargarInscritos,
      actualizar: setLecturaInscritos,
    });
  }, [abiertoId, cargarInscritos]);

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
    return eventos
      .filter((e) => encajaEnElAmbito(e, ambito))
      .map((e) => ({
        ...e,
        competitions: e.competitions.filter(
          (c) =>
            armas.includes(c.weapon) &&
            // Las pruebas por equipos mixtos no tienen género propio: se ven
            // siempre, porque descartarlas sería esconder competiciones.
            (c.gender === 'MIXTO' || generos.includes(c.gender as 'M' | 'F')) &&
            categorias.includes(c.category),
        ),
      }))
      .filter((e) => e.competitions.length > 0);
  }, [eventos, ambito, armas, generos, categorias]);

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
    setAncla((previa) => {
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
    });
  }, []);

  // El salto de mes va en un efecto y no en el `onSelect` para que también
  // funcione al cambiar de coincidencia con las flechas.
  const encontrado = coincidencias[cual] ?? null;
  React.useEffect(() => {
    if (encontrado) irA(encontrado.startDate);
  }, [encontrado, irA]);

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
    setAncla(
      (p) => new Date(p.getFullYear(), p.getMonth() + paso * (vista === 'mes' ? 1 : 3), 1),
    );
  };

  // El mes de hoy en hora española: el día 1 a la una de la mañana, el huso
  // del servidor y el del navegador no coinciden ni en el mes.
  const [anioHoy, mesHoy] = hoyMadrid().split('-').map(Number);
  const enElMesActual =
    ancla.getFullYear() === anioHoy && ancla.getMonth() === mesHoy - 1;

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
    <div className="flex min-h-0 flex-1 flex-col gap-2 sm:gap-3">
      {/*
        UNA FILA. NO CUATRO.
        ---------------------------------------------------------------------
        Esto es el encargo del usuario, marcado a mano sobre una captura: una
        flecha que sube desde «Noviembre 2026» hasta la barra de herramientas
        —o sea, «júntalo»—, una flecha de doble punta en el hueco entre la
        cabecera y la rejilla —«esto sobra»— y un círculo alrededor de la
        barra y del «Inscripción cerrada» que flotaba solo en la esquina.

        Antes había cuatro pisos antes de ver un día del mes: el título en un
        renglón, la navegación y los filtros en otro, el marcador en un
        tercero y sus datos —fecha y sede— en un cuarto. Medido:

          iPhone 14 Pro   144,9 px de cabecera de los 500 útiles (29 %)
          1440×900        130,0 px
          2560×1400       130,0 px

        Ahora es **una fila**: mes, navegación, marcador y herramientas. El
        marcador deja de ser una banda propia y pasa a ser la parte elástica
        del medio, con el plazo pegado al nombre del torneo del que habla en
        vez de en el otro extremo de la pantalla.

        Por debajo de `lg` el marcador baja a un renglón propio porque no
        cabe, y por debajo de `sm` **desaparece**: ahí manda el feed
        (`timeline.tsx`) y su primera tarjeta ya es lo próximo, con su fecha
        grande y además tocable. Cuando se está buscando vuelve, porque
        entonces lleva el contador de coincidencias y las flechas, y el estado
        de búsqueda tiene que verse.
      */}
      <div className="shrink-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {/*
            El mes en dos pesos en la misma línea: el nombre golpea y el año
            acompaña. Se lee «octubre» de un tirón y el año si te fijas. Es el
            recurso de la ficha de tirador de la FIE, donde el apellido va
            grueso y el nombre fino.

            Y el año se calla en el móvil cuando es el de hoy: son 57 px, y
            eran justo los que hacían caer el botón de filtros a un renglón
            propio en cuanto aparecía «Hoy». Si estás mirando otro año, el año
            sale, que es cuando de verdad hace falta saberlo.
          */}
          <h1 className="order-1 shrink-0 text-xl leading-none sm:text-3xl">
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
              /*
                LA CABECERA TIENE QUE CABER EN UNA LÍNEA. MEDIDO Y ARREGLADO.

                El usuario lo marcó con captura: en un iPhone el título
                «Septiembre – Noviembre 2026» y los dos botones —buscar y
                filtros— se partían en dos filas.

                Medido en el navegador a 393 px, con las piezas de esta misma
                fila:

                  título entero    242 px      título abreviado   121 px
                  flechas           72 px
                  herramientas     132 px
                  dos huecos        18 px
                  ------------------------------------------------------
                  con el entero    464 px      con el abreviado   343 px
                  y caben          366 px (393 menos el margen de la página)

                O sea que con el nombre entero **sobraban 98 px** y la fila se
                partía; abreviado sobran 23 de sitio, que es lo que hace falta
                para que quepa también «Hoy» cuando aparece. Comprobado: la
                fila mide 44 px de alto, o sea un renglón.

                De `sm` para arriba el nombre entero, que es lo que se prefiere
                cuando hay sitio.
              */
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
          </h1>

          {/* Navegación: botones fantasma pegados, una altura, un radio. */}
          <ButtonGroup className="order-2 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => mover(-1)}
              aria-label="Anterior"
            >
              <ChevronLeft />
            </Button>
            {/*
              «Hoy» solo cuando lleva a otro sitio. Estando en el mes en curso
              es un botón que no hace nada, y en un iPhone son 44 px que le
              quita a la rejilla.
            */}
            {!enElMesActual ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                onClick={() => {
                  setDireccion(0);
                  setAncla(new Date());
                }}
              >
                Hoy
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => mover(1)}
              aria-label="Siguiente"
            >
              <ChevronRight />
            </Button>
          </ButtonGroup>

          {/*
            El buscador es un icono, no un campo. Y va pegado a los filtros:
            las dos son herramientas de la pantalla, no contenido, así que
            comparten grupo y se leen como un bloque en vez de como dos trastos
            sueltos de formas distintas.

            El campo medía media anchura de la cabecera y estaba vacío el 99 %
            del tiempo. Ese sitio se lo queda la rejilla. En escritorio se
            anuncia el atajo con su `Kbd`; en el móvil, solo el icono.

            `ml-auto` hasta `lg` para que las herramientas se peguen al canto
            derecho cuando el marcador está en su propio renglón; a partir de
            `lg` sobra, porque el marcador lleva `flex-1` y es él quien empuja.
          */}
          <ButtonGroup className="order-3 ml-auto shrink-0 lg:order-4 lg:ml-0">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-2 px-2 text-muted-foreground"
              onClick={() => setBuscando(true)}
              aria-label="Buscar un torneo o una sede"
            >
              <CalendarSearch className="size-4" />
              <span className="hidden sm:inline">Buscar</span>
              <Kbd className="ml-1 hidden sm:inline-flex">⌘K</Kbd>
            </Button>

            <PanelFiltros
            ambito={ambito}
            setAmbito={setAmbito}
            vista={vista}
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
          </ButtonGroup>

          {/*
            EL MARCADOR, DENTRO DE LA MISMA FILA.

            Cuando no se está buscando enseña lo próximo; cuando se está
            buscando, la coincidencia en la que se está. Es el mismo sitio con
            dos contenidos en vez de dos secciones: buscar no añade una barra
            de estado, se apropia de esta.

            Y es la parte elástica: `flex-1` a partir de `lg`, renglón propio
            por debajo, y callado del todo por debajo de `sm` salvo buscando.
          */}
          <FranjaDestacada
            clase={cn(
              'order-4 w-full min-w-0 lg:order-3 lg:w-auto lg:flex-1',
              !busqueda.trim() && 'hidden sm:flex',
            )}
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
            onAbrir={setAbierto}
          />
        </div>
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
          className="flex shrink-0 items-center gap-3 rounded-md border border-primary/40 bg-card px-3 py-2 text-sm transition-colors hover:bg-accent"
        >
          <span className="min-w-0 flex-1">
            <span className="font-medium text-primary-text">Vincula tu ficha</span>{' '}
            <span className="text-muted-foreground">
              y el calendario se filtrará por tu arma y tu categoría. Se busca
              en el ranking oficial de la RFEE.
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0" aria-hidden />
        </Link>
      ) : null}

      {filtrados.length === 0 ? (
        <Empty className="flex-1 border border-dashed">
          <EmptyHeader>
            <EmptyTitle>Ninguna prueba con estos filtros</EmptyTitle>
            <EmptyDescription>
              La combinación de arma, género y categoría que hay puesta no
              existe en esta temporada. Abre los filtros o mira el calendario
              entero.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={verTodo}>Ver el calendario entero</Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
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
              onAbrir={setAbierto}
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
                    onAbrir={setAbierto}
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
                <div
                  key={`${m.getFullYear()}-${m.getMonth()}`}
                  className={cn(
                    'flex min-w-0 flex-col',
                    'animate-in fade-in-0 duration-200',
                    direccion === 1 && 'slide-in-from-right-6',
                    direccion === -1 && 'slide-in-from-left-6',
                  )}
                >
                  <ColumnaMes
                    anio={m.getFullYear()}
                    mes={m.getMonth()}
                    bloques={bloques}
                    /*
                      El título del mes solo en trimestre. En la vista de un mes
                      el nombre ya está en el `<h1>` de la cabecera, a 40 px de
                      distancia: repetirlo es gastar un renglón en decir lo
                      mismo.
                    */
                    conTitulo={vista === 'trimestre'}
                    inscripciones={inscripciones}
                    resaltados={resaltados}
                    proximo={proximo?.id ?? null}
                    mostrarArma={mostrarArma}
                    mostrarGenero={mostrarGenero}
                    mostrarCategoria={mostrarCategoria}
                    onAbrir={setAbierto}
                  />
                </div>
              ))}

              {/* En la vista de un mes, la segunda columna. */}
              {vista === 'mes' ? (
                <LoQueViene
                  eventos={fuera}
                  variante="zonas"
                  inscripciones={inscripciones}
                  onAbrir={setAbierto}
                />
              ) : null}
            </div>

          </div>

          <Leyenda />
        </>
      )}

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
              {busqueda.trim() === '' ? (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Escribe el nombre de un torneo o de una ciudad. El calendario
                  salta a su mes y lo resalta; no se esconde nada.
                </div>
              ) : coincidencias.length === 0 ? (
                <CommandEmpty>
                  Ningún torneo se llama así, ni se tira en esa ciudad.
                </CommandEmpty>
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
                    className="flex-col items-start gap-0.5"
                  >
                    <span className="flex w-full items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {titularTorneo(e.name)}
                      </span>
                      <span className="cifra shrink-0 text-xs text-muted-foreground">
                        {formatDateRangeEs(e.startDate, e.endDate)}
                      </span>
                    </span>
                    <span className="flex w-full items-baseline gap-2 text-xs text-muted-foreground">
                      <span className="shrink-0">
                        {organismoDe(e.source, e.scope, e.circuit)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {CIRCUIT_SHORT[e.circuit] ?? CIRCUIT_LABEL[e.circuit] ?? e.circuit}
                      </span>
                      <span className="shrink-0 truncate">
                        {e.city ? titular(e.city) : 'Sede sin publicar'}
                        {e.country ? `, ${e.country}` : ''}
                      </span>
                    </span>
                  </CommandItem>
                ))
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>

      <Sheet open={abierto !== null} onOpenChange={(o) => !o && setAbierto(null)}>
        <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl">
          {abierto ? <CabeceraFicha evento={abierto} /> : null}
          {abierto ? (
            <FichaEvento
              evento={abierto}
              tirador={tirador}
              inscripciones={inscripciones}
              inscritos={inscritos}
              falloInscritos={falloInscritos}
              onSolicitar={async (competitionId) => {
                if (!tirador) return;
                const r = await solicitarInscripcion(competitionId, tirador.id);
                setAbierto(null);
                /*
                  El resultado va a un aviso flotante y no a un renglón dentro
                  de la pantalla. Antes aparecía una fila entre los controles y
                  la rejilla: el calendario daba un salto de 40 px justo al
                  volver de la ficha, que es el peor momento para moverle la
                  pantalla a nadie.
                */
                if (r.ok) toast.success(r.message);
                else toast.error(r.error);
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/**
 * EL MARCADOR: la cifra grande con lo que queda, en UN renglón.
 *
 * Es lo que arregla «se ve plano». Plano quiere decir que todo pesa igual; la
 * cura no es una sombra, es que **una cosa pese mucho más que las demás**. La
 * cifra de los días va en condensada a `text-3xl` y el rótulo de al lado a
 * `0.6rem`: cinco veces, que es de sobra para que la jerarquía se lea, y viene
 * del marcador de un asalto.
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
 *    controles y todo va en una línea; la cifra baja de `text-4xl/5xl` a
 *    `text-3xl`, que es lo que cabe al lado de un control de 32 px sin
 *    estirar la fila.
 *
 * 2. **El plazo pegado al nombre.** «Inscripción cerrada» iba en la línea del
 *    título pero con el nombre en `flex-1`, así que el plazo se iba al canto
 *    derecho de la fila: en un escritorio de 1440, **a 900 px del torneo del
 *    que hablaba**. Eso es lo que el usuario rodeó con un círculo. Ahora va
 *    justo detrás del nombre y se lee como una frase: «Copa del Mundo Cadete
 *    — Inscripción cerrada». Lo que ahora se estira es la cola —fecha, sede y
 *    organismo—, que sí puede irse al canto sin que nadie la eche de menos.
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
          'flex h-11 min-w-0 items-center gap-2 text-sm text-muted-foreground',
          clase,
        )}
      >
        {/*
          La segunda frase se calla en el móvil. Con las dos y el botón al
          lado, en 393 px se leía «Ningún torneo coincide. …»: el `truncate`
          se comía justo la parte tranquilizadora y dejaba unos puntos
          suspensivos que parecen un fallo. Lo que hay que saber cabe en la
          primera frase.
        */}
        <span className="min-w-0 flex-1 truncate">
          Ningún torneo coincide.
          <span className="hidden sm:inline"> El calendario sigue como estaba.</span>
        </span>
        <Button variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-xs" onClick={onLimpiar}>
          Quitar la búsqueda
        </Button>
      </div>
    );
  }

  if (!evento) {
    return (
      /* El mismo `h-11` que el marcador: si el renglón midiera lo que mide su
         texto, quedarse sin competiciones por delante movería la rejilla. */
      <p
        className={cn(
          'flex h-11 min-w-0 items-center truncate text-sm text-muted-foreground',
          clase,
        )}
      >
        {hayTiradores
          ? 'No te queda ninguna competición por delante con estos filtros.'
          : 'No queda ningún torneo por delante con estos filtros.'}{' '}
        Mira otro mes o abre los filtros.
      </p>
    );
  }

  const dias = diasHasta(evento.startDate);
  const enMarcha = dias <= 0;
  const organismo = organismoDe(evento.source, evento.scope, evento.circuit);
  const plazo = plazoDelEvento(evento);
  const circuito = CIRCUIT_SHORT[evento.circuit] ?? CIRCUIT_LABEL[evento.circuit] ?? null;

  return (
    /*
      ALTO FIJO: LA FILA NO DEPENDE DE UNA FUENTE QUE LLEGA TARDE.
      -----------------------------------------------------------------------
      La cifra del marcador es `.cifra`, o sea Barlow Condensed, y entra con
      `font-display: swap`. Siendo el elemento más alto de la fila, su métrica
      decidía el alto de la cabecera, y el alto de la cabecera decide el hueco
      que mide la rejilla: al llegar la fuente, `planificar()` volvía a
      repartir el mes entero. Con `h-11` eso ya no puede pasar, y se comprobó
      midiendo los nodos de cada `layout-shift`: el de la fila del marcador
      pasó a mover **0,000** (cambia de ancho, 836→825 px, y no de alto).

      Lo que sigue moviendo la rejilla es otra cosa, y está medido: la caja del
      mes pasa de 572 a 1197 px a los 3,3 s, cuando empieza a aplicar el
      estirado a `min-h-dvh`. En `next dev` la hoja de estilos llega como
      recurso a los 2,64 s —Turbopack la inyecta después de hidratar— así que
      **hay que volver a medirlo sobre una compilación de producción** antes de
      tocar nada por esto: en producción el `<link>` es bloqueante y esta causa
      no existe. Está en el informe.

      Y 44 px no es un número redondo: es el objetivo táctil mínimo, y esta
      fila entera es la acción principal de la pantalla.
    */
    <div className={cn('flex h-11 items-center gap-1 overflow-hidden', clase)}>
      <Item
        asChild
        size="sm"
        className="h-full min-w-0 flex-1 cursor-pointer gap-2.5 rounded-md px-1 py-0 hover:bg-accent"
      >
        <button
          type="button"
          /* `text-left`: un `<button>` centra su texto por defecto y arrastra a
             todos sus hijos. Sin esto, el nombre del torneo salía centrado
             sobre su propia línea de datos y la franja parecía un cartel. */
          className="text-left"
          onClick={() => onAbrir(evento)}
          aria-label={
            enMarcha
              ? `${titularTorneo(evento.name)}, en marcha. Abrir la ficha.`
              : `Faltan ${dias} ${dias === 1 ? 'día' : 'días'} para ${titularTorneo(
                  evento.name,
                )}. Abrir la ficha.`
          }
        >
          <ItemMedia className="min-w-[2.4rem] flex-col items-start gap-0 self-center">
            {enMarcha ? (
              /*
                «Ahora» y no «Hoy»: a dos dedos hay un botón que dice «Hoy» y
                lleva al mes en curso. Dos «Hoy» en la misma fila significando
                cosas distintas es el mismo fallo que el usuario cazó en la
                fila de filtros, en pequeño.
              */
              <>
                <span className="cifra text-2xl leading-none text-primary-text">
                  Ahora
                </span>
                <span className="text-[0.6rem] leading-none text-muted-foreground">
                  en marcha
                </span>
              </>
            ) : (
              <>
                <span className="cifra text-3xl leading-none text-foreground">
                  {dias}
                </span>
                <span className="text-[0.6rem] leading-none text-muted-foreground">
                  {dias === 1 ? 'día' : 'días'}
                </span>
              </>
            )}
          </ItemMedia>

          {/*
            Todo en una línea: `flex-row` y `flex-nowrap`, y lo que cede es la
            cola. El nombre y su plazo van juntos y no se separan nunca; la
            fecha, la sede y el organismo se apagan por orden según el ancho
            que haya, que es el orden en que dejan de hacer falta.
          */}
          <ItemContent className="min-w-0 flex-row flex-nowrap items-baseline gap-x-2">
            <span className="min-w-0 max-w-full truncate text-sm font-semibold sm:text-base">
              {titularTorneo(evento.name)}
            </span>
            {plazo ? (
              <span className={cn('shrink-0 text-xs font-medium', plazo.tono)}>
                {plazo.texto}
              </span>
            ) : null}
            {/* La fecha en pastilla, como la ficha de la FIE: se lee como un
                dato con forma propia y no como una cadena más. Sólida
                (`bg-secondary`): esta fila va sobre el lienzo con textura y un
                blanco al 10 % dejaba la retícula de cruces dentro de la
                pastilla. */}
            <span className="cifra hidden shrink-0 rounded-full bg-secondary px-1.5 py-px text-xs text-foreground sm:inline">
              {formatDateRangeEs(evento.startDate, evento.endDate)}
            </span>
            <span className="hidden min-w-0 shrink truncate text-xs text-muted-foreground sm:inline">
              {evento.city ? titular(evento.city) : 'Sede sin publicar'}
              {evento.country ? `, ${evento.country}` : ''}
            </span>
            <span className="hidden min-w-0 shrink truncate text-xs text-muted-foreground xl:inline">
              {organismo}
              {circuito ? ` · ${circuito}` : ''}
            </span>
          </ItemContent>
        </button>
      </Item>

      {/*
        Con búsqueda puesta, aquí van el contador y las flechas: se pasa de una
        coincidencia a otra como en el buscar de un navegador, y el aspa
        devuelve el calendario a lo normal.
      */}
      {buscando ? (
        <div className="flex shrink-0 items-center gap-0.5">
          <span className="cifra px-1 text-xs text-muted-foreground">
            {cual + 1}/{total}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Coincidencia anterior"
            onClick={onAnterior}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Coincidencia siguiente"
            onClick={onSiguiente}
          >
            <ChevronRight />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Quitar la búsqueda"
            onClick={onLimpiar}
          >
            <X />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Todos los filtros detrás de UN botón.
 *
 * Por qué no van a la vista: se tocan una vez y se dejan puestos. Medido en un
 * iPhone, la fila con el buscador, las pestañas, la navegación, tres armas,
 * dos géneros, la categoría y el tirador necesitaba tres renglones y 140 px,
 * que es media rejilla. El botón dice en su propia etiqueta qué está filtrando
 * —«Florete», «2 armas», «Todo»— así que no hay que abrirlo para saberlo, y
 * eso es lo que distingue esto de un submenú.
 *
 * Y una sola convención dentro: selección múltiple con `ToggleGroup` marcado
 * en fondo secundario, elegir-uno con `Select`, y la lista larga de categorías
 * con búsqueda, que es lo que pide `Combobox` cuando hay más de cuatro
 * opciones.
 */
function PanelFiltros({
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
  const todasLasCategorias = categorias.length === categoriasDisponibles.length;

  /** Qué dice el botón sin abrirlo. */
  const rotulo = todoPuesto
    ? 'Todo'
    : armas.length === 1
      ? WEAPON_SHORT[armas[0]]
      : `${armas.length} armas`;

  /*
    ========================================================================
    EN EL MÓVIL ES UNA HOJA DE ABAJO, NO UN MENÚ COLGADO DEL BOTÓN
    ========================================================================

    Medido, que es de donde sale esto. Con las seis secciones el contenido
    mide 571 px. Como menú anclado al botón, el hueco que queda por debajo
    es de 470 px en un iPhone 14 Pro y de **327 px en un iPhone SE**, porque
    el botón está a media pantalla y Radix solo puede usar lo que hay
    debajo. O sea que por mucho que se recorte, un panel de seis filtros
    colgado de ese botón no cabe: el problema no es el contenido, es el
    anclaje.

    Una hoja que sube desde abajo no está anclada a nada y dispone de la
    pantalla entera menos un margen. Además cae donde está el pulgar, que es
    lo que hace cualquier aplicación con los filtros en el móvil.

    En escritorio se queda el menú: ahí sobra sitio (el contenido mide 495 px
    en una ventana de 900) y una hoja a pantalla completa para cambiar un
    arma sería aparatosa.

    Son dos disparadores y no uno con una consulta de medios en JavaScript:
    `useMediaQuery` devuelve algo distinto en el servidor y en el navegador y
    eso es un desajuste de hidratación garantizado. Con CSS, el que no toca
    ni existe para un lector de pantalla.
  */
  const cuerpo = (
<FieldGroup className="gap-2.5">
          {/*
            Lo que se está mirando, en cifras. Va aquí y no en la cabecera:
            «126 pruebas en 70 torneos» no cambia ninguna decisión, así que no
            merece un renglón de la pantalla, pero sí saberlo al tocar los
            filtros, que es cuando se está preguntando cuánto hay.
          */}
          {/*
            En un renglón, y la temporada abajo con la fecha de los datos.

            Decía «410 pruebas en 178 torneos · temporada 2026-2027» y en un
            móvil estrecho eso son dos renglones: 28 px de cabecera para un
            dato que no cambia ninguna decisión. Las cifras responden «cuánto
            estoy viendo» y se quedan arriba; la temporada y la fecha son
            procedencia y van al pie, que es donde se mira cuando se duda.

            Y fuera el filete: el hueco ya separa, y eran 25 px con el suyo.
          */}
          {/*
            LAS CIFRAS Y «VER TODO», EN LA MISMA FILA.

            «Ver todo» estaba abajo del todo, detrás de un filete y en un
            renglón propio: 73 px para un botón. Y aquí encaja mejor de lo que
            encajaba allí, porque las dos cosas responden a la misma pregunta
            —cuánto estoy viendo, y cómo vuelvo a verlo todo—. El renglón que
            se ahorra es el que necesitan Género y Vista para no pisarse.
          */}
          {/*
            Pegado a las cifras y NO al borde derecho: ahí, en la hoja del
            móvil, está la ✕ de cerrar, y «Ver todo» se le montaba encima
            (45×37 px de solape, medido). En el menú del escritorio no hay ✕,
            pero un solo sitio para las dos formas es una regla menos que
            recordar.
          */}
          <div className="flex items-center gap-3 pr-10">
            <p className="min-w-0 text-xs text-muted-foreground">
              <span className="cifra text-base text-foreground">{numPruebas}</span>{' '}
              {numPruebas === 1 ? 'prueba' : 'pruebas'} ·{' '}
              <span className="cifra text-base text-foreground">{numTorneos}</span>{' '}
              {numTorneos === 1 ? 'torneo' : 'torneos'}
            </p>

            {/*
              «Solo lo mío» únicamente cuando «lo mío» y «todo» son cosas
              distintas: para la dirección técnica lo suyo ES todo.
            */}
            {propio.propio ? (
              <Button
                variant="secondary"
                size="sm"
                className="h-8 shrink-0 px-2 text-xs"
                onClick={todoPuesto ? verLoMio : verTodo}
              >
                {todoPuesto ? 'Solo lo mío' : 'Ver todo'}
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                className="h-8 shrink-0 px-2 text-xs"
                onClick={verTodo}
                disabled={todoPuesto}
              >
                Ver todo
              </Button>
            )}
          </div>

          {/*
            EL ÁMBITO VA EL PRIMERO porque es la decisión más gruesa: parte
            el calendario en dos mitades y cambia el sentido de todo lo de
            abajo. Elegir «internacional» y después el arma es el orden en
            que se piensa; al revés hay que volver a subir.
          */}
          <FieldSet>
            <FieldLegend variant="label" className="mb-1 text-xs">
              Calendario
            </FieldLegend>
            <ToggleGroup
              type="single"
              value={ambito}
              onValueChange={(v) => v && setAmbito(v as Ambito)}
              variant="outline"
              className="w-full"
            >
              {AMBITOS.map((a) => (
                <ToggleGroupItem key={a.v} value={a.v} className="h-9 flex-1 text-sm">
                  {a.largo}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </FieldSet>

          <FieldSet>
            <FieldLegend variant="label" className="mb-1 text-xs">
              Armas
            </FieldLegend>
            {/*
              Nunca se queda vacío: un calendario en blanco no es una
              respuesta útil, así que al intentar quitar la última se ignora.
              Y aquí van los nombres enteros, no los iconos: a 14 px las tres
              armas son la misma línea con un bulto, y en un panel hay sitio
              para la palabra.
            */}
            <ToggleGroup
              type="multiple"
              value={armas}
              onValueChange={(v) => v.length > 0 && setArmas(v.filter(esArma))}
              variant="outline"
              className="w-full"
            >
              {ARMAS.map((a) => (
                <ToggleGroupItem key={a} value={a} className="h-9 flex-1 text-sm">
                  {WEAPON_LABEL[a]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </FieldSet>

          {/*
            GÉNERO Y VISTA, CADA UNO A LO ANCHO.

            Estuvieron media columna cada uno, para ahorrar un renglón. No
            cabían: «Masculino / Femenino» necesita más de la mitad del panel
            a cualquier anchura, y el grupo se pintaba **encima** del selector
            de vista. Medido: 33 px de solape en el escritorio (panel de 304)
            y 10 px en un iPhone 14 Pro. Los 10 px casi no se ven en una
            captura, que es justo por lo que se me pasó y por lo que el guion
            de medida ahora compara los rectángulos de todos los controles en
            vez de fiarse del alto.

            El renglón que se ahorraba se recupera arriba: «Ver todo» se ha
            ido a la fila de las cifras, donde además está mejor.
          */}
          <FieldSet>
            <FieldLegend variant="label" className="mb-1 text-xs">
              Género
            </FieldLegend>
            <ToggleGroup
              type="multiple"
              value={generos}
              onValueChange={(v) =>
                v.length > 0 &&
                setGeneros(v.filter((g): g is 'M' | 'F' => g === 'M' || g === 'F'))
              }
              variant="outline"
              className="w-full"
            >
              {GENEROS.map((g) => (
                <ToggleGroupItem key={g.v} value={g.v} className="h-9 flex-1 text-sm">
                  {g.largo}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </FieldSet>

          <FieldSet>
            {/*
              El rótulo, solo para quien no ve la pantalla.

              «Un mes / Tres meses» dice lo que es sin que nadie se lo
              explique, y ese renglón de rótulo son 22 px que en un iPhone SE
              deciden si el panel cabe o hay que desplazarlo. Los de Armas y
              Género se quedan visibles: ahí «Florete» o «Masculino» sí
              podrían leerse como otra cosa en una lista de pastillas.

              `sr-only` y no borrarlo: el grupo sigue teniendo nombre para un
              lector de pantalla, que es lo que no se puede perder.
            */}
            <FieldLegend variant="label" className="sr-only">
              Vista
            </FieldLegend>
            <ToggleGroup
              type="single"
              value={vista}
              onValueChange={(v) => v && setVista(v as Vista)}
              variant="outline"
              className="w-full"
            >
              <ToggleGroupItem value="mes" className="h-9 flex-1 text-sm">
                Un mes
              </ToggleGroupItem>
              <ToggleGroupItem value="trimestre" className="h-9 flex-1 text-sm">
                Tres meses
              </ToggleGroupItem>
            </ToggleGroup>
          </FieldSet>

          <FieldSet>
            <FieldLegend variant="label" className="mb-1 text-xs">
              Categoría
              <span className="ml-1.5 font-normal text-muted-foreground">
                {todasLasCategorias
                  ? 'todas'
                  : `${categorias.length} de ${categoriasDisponibles.length}`}
              </span>
            </FieldLegend>
            {/*
              PASTILLAS, NO UNA LISTA CON BUSCADOR DENTRO DE UNA CAJA QUE SE
              DESPLAZA.

              Eran diez opciones dentro de un `Command` con su `CommandInput`
              y un `ScrollArea` de 128 px. O sea: una barra de desplazamiento
              **dentro** de un panel que ya se desplazaba, en 304 px de
              ancho. Arrastrando con el pulgar encima de las categorías se
              movía una; un dedo más allá, la otra.

              Y el buscador no ganaba nada: filtrar diez etiquetas de cuatro
              caracteres escribiendo es más trabajo que mirarlas. Son
              `M9 M11 M13 M15 M17 M20 ABS VET` — en pastillas que envuelven
              caben en tres renglones y se ven todas a la vez, que es lo que
              hace falta para elegir varias.

              Se marcan con fondo y con el icono, no solo con color: la regla
              de que el estado nunca se comunique únicamente por color vale
              también aquí.
            */}
            <div className="flex flex-wrap gap-1.5">
              {categoriasDisponibles.map((c) => {
                const puesta = categorias.includes(c);
                const nombre = CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL] ?? c;
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={puesta}
                    onClick={() =>
                      setCategorias((previas) => {
                        const siguientes = puesta
                          ? previas.filter((x) => x !== c)
                          : ordenarCategorias([...previas, c]);
                        // Nunca vacío: un calendario en blanco no responde a
                        // ninguna pregunta.
                        return siguientes.length > 0 ? siguientes : previas;
                      })
                    }
                    className={cn(
                      'objetivo-libre inline-flex h-8 items-center gap-1 rounded-md border px-2 text-sm transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      puesta
                        ? 'border-primary/50 bg-primary/15 text-primary-text'
                        : 'border-border text-muted-foreground hover:bg-accent',
                    )}
                  >
                    <CircleCheck
                      className={cn('size-3.5', puesta ? 'opacity-100' : 'opacity-25')}
                      aria-hidden
                    />
                    {nombre}
                  </button>
                );
              })}
            </div>
          </FieldSet>

          {/*
            Selector de tirador: solo cuando la cuenta lleva a más de uno. Con
            un solo tirador sería un control que nunca cambia nada.
          */}
          {tiradores.length > 1 ? (
            <FieldSet>
              <FieldLegend variant="label" className="mb-1.5">
                Tirador
              </FieldLegend>
              <ToggleGroup
                type="single"
                value={tiradorId ?? ''}
                onValueChange={(v) => v && cambiarTirador(v)}
                variant="outline"
                className="w-full"
              >
                {tiradores.map((t) => (
                  <ToggleGroupItem key={t.id} value={t.id} className="h-9 flex-1 text-sm">
                    {nombreCorto(t.fullName)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </FieldSet>
          ) : null}

          {temporada || actualizado ? (
            <p className="text-[0.7rem] text-muted-foreground">
              {temporada ? `Temporada ${temporada}` : ''}
              {temporada && actualizado ? ' · ' : ''}
              {actualizado ? `datos del ${actualizado}` : ''}
            </p>
          ) : null}
        </FieldGroup>
  );

  /*          UNA ALTURA PARA TODA LA FILA, y este botón era el que se salía.

          Medido en el navegador a 1440 px, la fila tenía tres cantos de
          arriba y tres de abajo distintos:

            grupo de flechas   75 → 107   (32 px)
            botón «Buscar»     73 → 105   (32 px)
            botón de filtros   73 → 109   (36 px)   ← este

          O sea que dentro del MISMO `ButtonGroup` la mitad derecha sobresalía
          **4 px por abajo** de la izquierda, y el grupo de flechas quedaba
          descolgado 2 px de las dos. Es lo que se ve en
          `capturas/lupa/A-barra-antes.png`: un escalón en la costura.

          La causa es tonta y no se arregla con `items-stretch`, que es lo que
          ya lleva `ButtonGroup`: un elemento con alto explícito (`h-8`) no se
          estira. Había que igualar el número. `h-8` en los tres, y el radio
          ya era el mismo (4 px) en toda la fila.
        */
  const disparador = (
    <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5 px-2.5">
          <SlidersHorizontal className="size-4" aria-hidden />
          <span className="cifra text-sm leading-none tracking-tight">{rotulo}</span>
          {generos.length === 1 ? (
            /*
              LA PASTILLA DEL GÉNERO EXISTÍA Y NO SE VEÍA.

              Iba con `bg-secondary` **dentro de un botón que también es
              `bg-secondary`** (`variant="outline"`), así que la pastilla y el
              botón eran exactamente el mismo color: la «M» quedaba como una
              letra suelta flotando al lado de «FLO», sin caja y a otro
              tamaño. Eso es la mitad del desalineado que se ve en la captura.

              Ahora sube un nivel (`--accent`, el realce) para que la caja
              exista, y lleva `py-0.5` y `leading-none`: sin aire vertical la
              pastilla medía 9,6 px de alto dentro de un botón de 32 y no se
              leía como pastilla ni con lupa.
            */
            <span className="cifra rounded-[3px] bg-accent px-1 py-0.5 text-[0.65rem] leading-none">
              {generos[0]}
            </span>
          ) : null}
          <span className="sr-only">Filtros del calendario</span>
        </Button>
  );

  return (
    <>
      <Sheet>
        <SheetTrigger asChild className="sm:hidden">
          {disparador}
        </SheetTrigger>
        <SheetContent
          side="bottom"
          className="max-h-[94dvh] overflow-y-auto rounded-t-xl px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Filtros del calendario</SheetTitle>
            <SheetDescription>
              Qué competiciones se enseñan y cómo.
            </SheetDescription>
          </SheetHeader>
          {cuerpo}
        </SheetContent>
      </Sheet>

      <Popover>
        <PopoverTrigger asChild className="hidden sm:inline-flex">
          {disparador}
        </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[var(--radix-popover-content-available-height)] w-[19rem] overflow-y-auto p-3"
      >
        {cuerpo}
      </PopoverContent>
      </Popover>
    </>
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
    <ul className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-[0.7rem] text-muted-foreground sm:gap-x-4">
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

/** El nombre de pila basta para distinguir a dos hermanos en un botón. */
function nombreCorto(nombre: string): string {
  return nombre.replace(/^DEMO\s+/i, '').split(/\s+/)[0] ?? nombre;
}
