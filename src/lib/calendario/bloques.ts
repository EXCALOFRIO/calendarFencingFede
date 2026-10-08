import type { EventView } from '@/lib/queries/calendar';
import { jerarquiaDeCircuito } from '@/lib/colores';
import { nombreMes, rangoFechas } from '@/lib/fechas';
import { organismoDe } from '@/lib/utils';

/**
 * ===========================================================================
 * BLOQUES DE COMPETICIÓN: LA UNIDAD DEL CALENDARIO YA NO ES EL DÍA
 * ===========================================================================
 *
 * POR QUÉ EXISTE ESTE FICHERO
 * ---------------------------------------------------------------------------
 * El calendario era una rejilla de 7×5 casillas por mes. Razonamiento del
 * usuario, literal: *«como son siempre casi siempre en findes las
 * competiciones»*. Y es verdad, y se puede medir: sobre la base real, de los
 * 274 eventos la inmensa mayoría empieza en sábado. Una rejilla obliga a
 * pintar 31 casillas para enseñar cuatro eventos, así que el 87 % de la
 * superficie del mes es hueco negro, y además cada mes tiene un número
 * distinto de semanas, así que las tres columnas del trimestre nunca salían
 * equilibradas.
 *
 * La unidad pasa a ser **el evento con su rango de fechas**. Y como lo que se
 * pinta es una lista de bloques y no una cuadrícula, el hueco entre dos
 * bloques deja de ser superficie y pasa a ser **un dato**: «2 semanas libres».
 *
 * TODO LO QUE HAY AQUÍ ES UNA FUNCIÓN NORMAL, A PROPÓSITO
 * ---------------------------------------------------------------------------
 * El reparto en carriles de la rejilla vieja vivía dentro del componente y no
 * se podía probar sin un navegador. Aquí no hay ni un `useState`: entra una
 * lista de eventos y sale una lista de bloques y de huecos. Lo prueba
 * `tests/bloques.test.ts`, que es lo que impide que vuelva el fallo que el
 * usuario marcó en el boceto —«1 semana libre (15 oct - 27 oct)» repetido dos
 * veces y en sitios donde no tocaba—.
 */

/** Un rango de días, los dos extremos incluidos, en ISO `YYYY-MM-DD`. */
export type RangoISO = { desde: string; hasta: string };

/**
 * Milisegundos de un día ISO, leído a mediodía UTC.
 *
 * A mediodía y en UTC por el mismo motivo que `diasHasta()` en
 * `lo-que-viene.tsx`: los dos cambios de hora del año no pueden sumar ni
 * restar un día, y el resultado no depende de si esto corre en el Worker
 * (UTC) o en un navegador español.
 */
function ms(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);
}

function iso(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

const DIA = 86_400_000;

/** Días naturales entre dos ISO, contando los dos extremos. */
export function largoEnDias(r: RangoISO): number {
  return Math.round((ms(r.hasta) - ms(r.desde)) / DIA) + 1;
}

/** Día de la semana 0 = lunes … 6 = domingo. Nunca el 0 = domingo de JS. */
export function indiceDeDiaSemana(isoDia: string): number {
  return (new Date(ms(isoDia)).getUTCDay() + 6) % 7;
}

/**
 * EL RANGO HONESTO DE UN TORNEO: EL DE SUS PRUEBAS, NO EL DEL EVENTO.
 *
 * Esto arregla un fallo que el usuario cazó en el boceto: una Copa del Mundo
 * salía como «09 - 15 · LUN - DOM» cuando lo que se tira es el sábado y el
 * domingo. El rango del evento (`startDate`/`endDate`) es el del cartel entero
 * —incluye la acreditación, el congreso y el día de viaje— y decirle a un
 * tirador «lunes a domingo» le hace pensar que compite siete días y que tiene
 * que pedir la semana entera en el trabajo.
 *
 * Así que manda `competitionDate` de las pruebas. Dos matices que importan:
 *
 * - Se usan **las pruebas que quedan tras el filtro**, no todas. Mirando el
 *   calendario de florete femenino, el rango que interesa es el de las pruebas
 *   de florete femenino; el sable de ese mismo torneo no ocupa días de nadie.
 * - Si **ninguna** prueba tiene fecha (pasa: la fuente no siempre la publica)
 *   se cae al rango del evento. No se inventa: se dice lo que hay.
 */
export function rangoRealDeEvento(evento: EventView): RangoISO {
  const fechas = evento.competitions
    .map((c) => c.competitionDate?.slice(0, 10))
    .filter((f): f is string => Boolean(f))
    .sort();

  if (fechas.length === 0) {
    return { desde: evento.startDate.slice(0, 10), hasta: evento.endDate.slice(0, 10) };
  }

  /*
    Acotado al rango del evento por si una prueba trae una fecha absurda: un
    torneo de octubre con una prueba fechada en 1970 estiraría la cápsula a
    cincuenta años. Ha pasado con datos de la FIE mal normalizados.
  */
  const desde = maximo(fechas[0], evento.startDate.slice(0, 10));
  const hasta = minimo(fechas[fechas.length - 1], evento.endDate.slice(0, 10));
  return desde <= hasta
    ? { desde, hasta }
    : { desde: evento.startDate.slice(0, 10), hasta: evento.endDate.slice(0, 10) };
}

const maximo = (a: string, b: string) => (a >= b ? a : b);
const minimo = (a: string, b: string) => (a <= b ? a : b);

/** Qué días de la semana ocupa un rango. Siete posiciones, de lunes a domingo. */
export function diasSemanaOcupados(r: RangoISO): boolean[] {
  const ocupa = [false, false, false, false, false, false, false];
  const largo = Math.min(largoEnDias(r), 7);
  for (let i = 0; i < largo; i += 1) {
    ocupa[indiceDeDiaSemana(iso(ms(r.desde) + i * DIA))] = true;
  }
  return ocupa;
}

/**
 * ¿Cae fuera del fin de semana?
 *
 * Es información real y con consecuencia práctica: un torneo en miércoles
 * significa pedir permiso en el trabajo o falta en el instituto, y eso cambia
 * si vas o no. En el calendario español es la excepción —la mayoría son
 * sábado y domingo—, así que se marca solo cuando pasa.
 */
export function esEntreSemana(r: RangoISO): boolean {
  const ocupa = diasSemanaOcupados(r);
  return !ocupa[5] && !ocupa[6];
}

/** El lunes de la semana ISO de un día. Sirve para agrupar «por fin de semana». */
export function lunesDeLaSemana(isoDia: string): string {
  return iso(ms(isoDia) - indiceDeDiaSemana(isoDia) * DIA);
}

/**
 * UN FIN DE SEMANA, UNA TARJETA.
 *
 * El caso que lo motiva está en la base y el usuario lo señaló: el 3 y 4 de
 * octubre de 2026 coinciden **cinco** competiciones —Eurofence League, Liga
 * Iberdrola, Liga de Oro, Liga de Plata y el TNR absoluto—. En la rejilla eran
 * cinco barras flotando en la misma casilla, que descuadraban el mes entero y
 * se leían como cinco cosas sin relación cuando en realidad son «el fin de
 * semana del 3 y 4».
 *
 * La regla para fundir dos eventos en el mismo bloque, y es deliberadamente
 * estrecha:
 *
 *   1. **Sus rangos reales se solapan.** Si no comparten ni un día no
 *      coinciden, y decir que sí sería mentir.
 *   2. **Los dos empiezan en la misma semana ISO** (lunes a domingo).
 *   3. **El bloque resultante no pasa de cuatro días.** Esta es la que de
 *      verdad acota, y sale de la frase del usuario: *«son casi siempre en
 *      findes»*. Un bloque es un fin de semana, como mucho un puente.
 *
 * La tercera condición existe porque sin ella la prueba de
 * `tests/bloques.test.ts` falla con un caso real: un campeonato del mundo del
 * lunes 5 al martes 13 de octubre y una Liga de Oro el sábado 10 y domingo 11
 * empiezan en la misma semana y se solapan, así que se fundían. Y eso está
 * mal por un motivo concreto y medible: la cápsula del bloque diría «05 - 13»
 * y la Liga de Oro **se tira dos días**, no nueve. Fundirlos convertía la
 * tarjeta en un dato falso sobre la competición pequeña, que es justo el fallo
 * del que venimos.
 *
 * Con el tope de cuatro días, un torneo largo se queda solo —con su rango
 * entero, que es verdad— y lo que se funde son los fines de semana, que es
 * para lo que se pidió.
 *
 * Los eventos de dentro vienen ordenados por importancia (`jerarquiaDeCircuito`
 * y luego el organismo internacional antes que el nacional), que es el orden en
 * que los pide el diseño: primero el internacional, después los nacionales.
 */
export type Bloque = {
  /** Estable entre repintados: sirve de `key` y de destino de un ancla. */
  clave: string;
  rango: RangoISO;
  /** Uno o varios. Ordenados de más a menos importante. */
  eventos: EventView[];
};

/** Lo más largo que puede llegar a medir un bloque fundido. Un puente. */
export const MAXIMO_BLOQUE_DIAS = 4;

export function agruparEnBloques(eventos: EventView[]): Bloque[] {
  const conRango = eventos
    .map((evento) => ({ evento, rango: rangoRealDeEvento(evento) }))
    .sort(
      (a, b) =>
        a.rango.desde.localeCompare(b.rango.desde) ||
        a.rango.hasta.localeCompare(b.rango.hasta) ||
        a.evento.id.localeCompare(b.evento.id),
    );

  const bloques: Bloque[] = [];

  for (const { evento, rango } of conRango) {
    const ultimo = bloques[bloques.length - 1];
    const cabe =
      ultimo &&
      // (1) se solapan
      rango.desde <= ultimo.rango.hasta &&
      // (2) empiezan en la misma semana
      lunesDeLaSemana(rango.desde) === lunesDeLaSemana(ultimo.rango.desde) &&
      // (3) y el bloque fundido sigue siendo un fin de semana o un puente
      largoEnDias({
        desde: ultimo.rango.desde,
        hasta: maximo(rango.hasta, ultimo.rango.hasta),
      }) <= MAXIMO_BLOQUE_DIAS;

    if (cabe) {
      ultimo.eventos.push(evento);
      if (rango.hasta > ultimo.rango.hasta) ultimo.rango.hasta = rango.hasta;
    } else {
      bloques.push({
        clave: `${rango.desde}_${evento.id}`,
        rango: { ...rango },
        eventos: [evento],
      });
    }
  }

  for (const b of bloques) b.eventos.sort(porImportancia);
  return bloques;
}

/**
 * De más a menos importante.
 *
 * Primero el internacional —es lo que pide el diseño y es también lo que
 * decide un viaje—, y dentro de cada nivel el circuito de más rango: un
 * campeonato del mundo por delante de una copa del mundo, y esa por delante de
 * una liga. Con el nombre como último criterio para que el orden no cambie
 * entre dos pintados.
 */
function porImportancia(a: EventView, b: EventView): number {
  const rango = (e: EventView) =>
    organismoDe(e.source, e.scope, e.circuit) === 'RFEE' ||
    organismoDe(e.source, e.scope, e.circuit) === 'AUT'
      ? 1
      : 0;
  return (
    rango(a) - rango(b) ||
    jerarquiaDeCircuito(a.circuit) - jerarquiaDeCircuito(b.circuit) ||
    a.name.localeCompare(b.name, 'es')
  );
}

/**
 * EL HUECO ENTRE DOS BLOQUES, CONTADO Y NO REPETIDO.
 *
 * Donde la rejilla dejaba 400 px de negro, aquí va una línea de 1 px que dice
 * cuánto dura el parón. Eso convierte el vacío en información: un tirador que
 * ve «3 semanas libres» sabe que ahí mete una concentración o unas
 * vacaciones.
 *
 * DOS COSAS QUE EL USUARIO MARCÓ COMO FALLO EN EL BOCETO, Y POR QUÉ NO PUEDEN
 * VOLVER:
 *
 * 1. **El rango sale de los datos.** En el boceto aparecía «1 semana libre
 *    (15 oct - 27 oct)» dos veces seguidas, y ni el número ni las fechas
 *    cuadraban con nada. Aquí el hueco es, literalmente, del día siguiente al
 *    fin del bloque anterior al día anterior al inicio del siguiente. No hay
 *    otra fuente.
 *
 * 2. **El número de semanas es honesto.** «1 semana» para nueve días es
 *    mentira y se nota: quien cuenta los días en el calendario ve que no
 *    cuadra y deja de creerse el resto. La regla, en una línea: **se habla de
 *    semanas solo cuando el hueco es múltiplo de siete con una tolerancia de
 *    un día**, y de días en cualquier otro caso.
 *
 *      menos de 7 días   no se dice nada. Un parón de cuatro días no es un
 *                        parón, y un divisor cada dos tarjetas es ruido.
 *      7 u 8 días        «1 semana libre»
 *      9 a 12 días       «N días libres», con el número exacto
 *      13, 14 o 15       «2 semanas libres»
 *      16 a 19           «N días libres»
 *      20, 21, 22        «3 semanas libres»   …y así.
 *
 *    Así nunca se lee un número que no cuadre al contar en el calendario, que
 *    es lo único que se le pide a este texto.
 */
export type Hueco = {
  /** Días libres, los dos extremos incluidos. */
  dias: number;
  desde: string;
  hasta: string;
  /** Ya redactado: «2 semanas libres», «9 días libres». */
  texto: string;
};

/** Cuántos días libres se exige para pintar un divisor. */
export const MINIMO_HUECO = 7;

export function huecoEntre(
  finPrevio: string,
  inicioSiguiente: string,
): Hueco | null {
  const desde = iso(ms(finPrevio) + DIA);
  const hasta = iso(ms(inicioSiguiente) - DIA);
  if (desde > hasta) return null;

  const dias = Math.round((ms(hasta) - ms(desde)) / DIA) + 1;
  if (dias < MINIMO_HUECO) return null;

  return { dias, desde, hasta, texto: textoDeHueco(dias) };
}

/** «1 semana libre», «2 semanas libres», «9 días libres»: el adjetivo concuerda. */
export function textoDeHueco(dias: number): string {
  const duracion = textoDeDuracion(dias);
  const singular = duracion === '1 semana' || duracion === '1 día';
  return `${duracion} ${singular ? 'libre' : 'libres'}`;
}

/** «2 semanas» / «9 días». Sin el «libres», que lo pone quien lo usa. */
export function textoDeDuracion(dias: number): string {
  const semanas = Math.round(dias / 7);
  // Tolerancia de un día: 6-8 días son «1 semana», 13-15 «2 semanas».
  if (semanas >= 1 && Math.abs(dias - semanas * 7) <= 1) {
    return semanas === 1 ? '1 semana' : `${semanas} semanas`;
  }
  return dias === 1 ? '1 día' : `${dias} días`;
}

/**
 * Los bloques de un mes, con el hueco que les precede ya calculado.
 *
 * Un bloque cae en el mes cuyo **primer día** le pertenece: un torneo del 30
 * de octubre al 1 de noviembre sale una vez, en octubre, y no medio en cada
 * columna. Es lo contrario de lo que hacía la rejilla, que partía la barra en
 * dos, y es a propósito: media tarjeta no se puede leer y la fecha entera ya
 * dice que se mete en noviembre.
 */
export type ItemMes =
  | { tipo: 'bloque'; bloque: Bloque }
  | { tipo: 'hueco'; hueco: Hueco };

export function itemsDelMes(bloques: Bloque[], anio: number, mes: number): ItemMes[] {
  const prefijo = `${anio}-${String(mes + 1).padStart(2, '0')}`;
  const delMes = bloques.filter((b) => b.rango.desde.startsWith(prefijo));

  const items: ItemMes[] = [];
  for (let i = 0; i < delMes.length; i += 1) {
    if (i > 0) {
      const hueco = huecoEntre(delMes[i - 1].rango.hasta, delMes[i].rango.desde);
      if (hueco) items.push({ tipo: 'hueco', hueco });
    }
    items.push({ tipo: 'bloque', bloque: delMes[i] });
  }
  return items;
}

/** «15–27 oct», «28 oct–3 nov»: el formato de rango de toda la aplicación. */
export function rangoCorto(r: RangoISO): string {
  return rangoFechas(r.desde, r.hasta, 'linea');
}

/** `AAAA-MM-01` de un mes (0–11), sin pasar por la hora local. */
export function primerDiaDeMes(anio: number, mes: number): string {
  const d = new Date(Date.UTC(anio, mes, 1, 12));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** «Octubre 2026»; sin año, «Octubre». */
export function nombreDeMes(anio: number, mes: number, conAnio = true): string {
  return nombreMes(primerDiaDeMes(anio, mes), { anio: conAnio });
}

/*
  `esPretemporada()` vivía aquí y se ha ido entera.

  Servía para que un septiembre vacío dijera «mes de pretemporada y descanso».
  Era falso, y lo corrigió el usuario: en septiembre hay satélites y otras
  pruebas; lo que pasa es que no las hemos ingerido. La función afirmaba algo
  sobre el calendario español a partir de lo que tenemos en la base, que son
  dos cosas distintas. El estado vacío ahora no explica nada.
*/
