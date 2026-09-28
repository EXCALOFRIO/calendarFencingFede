import { z } from 'zod';

/**
 * LA FÓRMULA DE PUNTOS DEL RANKING NACIONAL DE LA RFEE
 *
 * DE DÓNDE SALE
 * -------------
 * «NORMATIVA PARA RANKINGS NACIONALES_26-27_V1», punto 1.4.1. Viene escrita
 * como una fórmula de hoja de cálculo en español, tal cual:
 *
 *   =((MAX(SI(L5=1;1414;0);SI(L5=2;1212;0);SI(L5<5;1010;0);SI(L5<9;808;0);
 *     SI(L5<17;606;0);SI(L5<33;404;0);SI(L5<65;202;0);SI(L5<129;101;0))
 *     +(1000*(1,01-(LOG10(L5)/LOG10(L$3))))))*L$2
 *
 * EL PDF SE CONTRADICE, Y SE HA RESUELTO CON NÚMEROS
 * --------------------------------------------------
 * Justo debajo, el documento describe sus propias variables así: «Dónde L3
 * corresponde a la posición real (1, 2, 3, …..) y L2 al número de
 * participantes». Eso NO encaja con la fórmula, donde `L5` es la que lleva los
 * cortes de puesto (=1, =2, <5, <9…) y `L$3` está dentro de un logaritmo
 * haciendo de base.
 *
 * Hay dos razones para leerlo al revés de lo que dice el texto, y la segunda
 * es la que decide:
 *
 *  1. ESTRUCTURA. `L$2` y `L$3` llevan `$` en la fila y `L5` no. En una hoja de
 *     cálculo eso significa que 2 y 3 son filas de cabecera fijas (una por
 *     competición: su coeficiente y su número de participantes) y que la fila 5
 *     es la primera de datos, una por tirador. Además, si `L$2` fuera el número
 *     de participantes multiplicando al final, una prueba de 100 tiradores
 *     daría cien veces más puntos que una de uno, que es absurdo.
 *  2. COMPROBACIÓN NUMÉRICA, que es la que manda. Se ha cotejado contra los
 *     puntos oficiales que ya están en la base (`result.official_points` del
 *     TNR M20 de espada femenina del 20/09/2026, 80 filas con puesto y puntos
 *     publicados por la fuente). Con la lectura de abajo:
 *
 *        80 de 80 aciertos AL CÉNTIMO. Desvío máximo: 0,0000.
 *
 *     Y no es una casualidad ajustable: con 80 participantes en vez de 84 no
 *     acierta ni uno (desvío de hasta 11,13 puntos) y con 85 tampoco (2,66).
 *     Solo cuadra con la lectura correcta y con el número de participantes
 *     correcto, lo que hace de esto una prueba y no un encaje.
 *
 * Conclusión: **`L5` es el PUESTO, `L$3` el NÚMERO DE PARTICIPANTES (base del
 * logaritmo) y `L$2` el COEFICIENTE.** La frase del PDF está equivocada.
 *
 * CUIDADO CON EL NÚMERO DE PARTICIPANTES
 * --------------------------------------
 * Es el tamaño real del cuadro, no los inscritos. En la prueba comprobada,
 * `event_competition.registration_count` dice 80 y la fórmula solo cuadra con
 * 84, que es el puesto más alto de la clasificación. Tiene sentido: la lista de
 * inscritos se cierra antes y luego se agregan tiradores fuera de plazo (lo
 * permite el punto 3.3.2 de la misma normativa). Así que se usa el número de
 * clasificados, y si no se sabe, NO se calcula: se dice que falta el dato.
 *
 * NINGÚN NÚMERO DE ESTOS ESTÁ ESCRITO AQUÍ
 * ----------------------------------------
 * Ni los escalones (1414, 1212, 1010…), ni la escala (1000), ni el techo
 * (1,01), ni los coeficientes. Todo entra por parámetro desde `ranking_rule`:
 * los escalones en `points_table` (que ya admitía tramos como `"9-16"`), y la
 * escala y el techo en `points_formula`. Este fichero solo sabe aritmética.
 */

/** Cómo se llama la única fórmula que hoy conocemos. */
export const TIPO_FORMULA_RFEE = 'rfee_log10' as const;

/**
 * Parámetros de la parte continua de la fórmula, tal como se guardan en
 * `ranking_rule.points_formula`.
 *
 * `tipo` existe para que el día que la RFEE cambie de método no haya que
 * migrar nada: se guarda con otro `tipo` y el código elige. Hoy solo hay uno.
 */
export const esquemaFormulaPuntos = z.object({
  tipo: z.literal(TIPO_FORMULA_RFEE),
  /** El 1000 del «1000 * (1,01 − …)». */
  escala: z.coerce.number().positive(),
  /** El 1,01. Es lo que hace que el último clasificado no saque cero. */
  techo: z.coerce.number().positive(),
});

export type FormulaPuntos = z.infer<typeof esquemaFormulaPuntos>;

export type EntradaPuntos = {
  /** Puesto en la clasificación final. 1 es el primero. */
  puesto: number;
  /** Cuántos tiradores acabaron clasificados en la prueba. */
  participantes: number;
  /** El de la normativa según la categoría y el tipo de prueba. */
  coeficiente: number;
  /** Tabla de escalones, de `ranking_rule.points_table`. */
  escalones: Record<string, number>;
  formula: FormulaPuntos;
};

/**
 * El desglose completo, no solo el número.
 *
 * La pantalla tiene que poder enseñar el cálculo abierto: un ranking que no se
 * puede auditar genera más discusiones con los padres que la hoja de cálculo
 * que venía a sustituir. Así que se devuelven las tres piezas por separado y no
 * el total a secas.
 */
export type PuntosDesglosados = {
  /** El escalón del puesto: 1414 el primero, 1212 el segundo… */
  escalon: number;
  /** El término continuo, que premia ganar a más gente. */
  continuo: number;
  /** Escalón + continuo, antes de aplicar el coeficiente. */
  base: number;
  coeficiente: number;
  /** Lo que suma de verdad, redondeado a dos decimales. */
  puntos: number;
};

/** Redondeo a dos decimales, que es como la RFEE publica los puntos. */
function dos(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

/**
 * El escalón de un puesto.
 *
 * Reutiliza el formato de `points_table` que ya existía: claves de puesto
 * exacto (`"1"`) y de tramo (`"3-4"`). La normativa de la RFEE es justo eso:
 * 1 → 1414, 2 → 1212, 3-4 → 1010, 5-8 → 808, 9-16 → 606, 17-32 → 404,
 * 33-64 → 202, 65-128 → 101. Del 129 para abajo la fórmula da 0 de escalón, y
 * eso no es un hueco: es lo que dice el `MAX(...)` cuando ningún `SI` acierta.
 */
export function escalonDePuesto(
  escalones: Record<string, number>,
  puesto: number,
): number {
  const exacto = escalones[String(puesto)];
  if (exacto !== undefined) return exacto;

  let mejor = 0;
  for (const [clave, valor] of Object.entries(escalones)) {
    const tramo = clave.match(/^(\d+)-(\d+)$/);
    if (!tramo) continue;
    const desde = Number.parseInt(tramo[1], 10);
    const hasta = Number.parseInt(tramo[2], 10);
    // `MAX` en la fórmula original: si dos tramos solaparan, gana el mayor.
    if (puesto >= desde && puesto <= hasta) mejor = Math.max(mejor, valor);
  }
  return mejor;
}

/**
 * Los puntos de una prueba, desglosados.
 *
 * Devuelve `null` cuando faltan datos para calcular, y nunca un cero
 * disfrazado: «no sé cuántos participantes hubo» y «has sacado cero puntos»
 * son cosas distintas y la pantalla las cuenta distinto.
 *
 * Dos casos de borde que la fórmula tiene de verdad, y no son erratas:
 *  · Con UN participante, `log10(1) = 0` y la división sería entre cero. La
 *    normativa no contempla una prueba de un tirador; se devuelve null.
 *  · El primero saca `log10(1) = 0`, así que se lleva el techo entero: 1414 +
 *    1000 × 1,01 = 2424 con coeficiente 1. Eso es correcto y está comprobado.
 */
export function puntosRfee(entrada: EntradaPuntos): PuntosDesglosados | null {
  const { puesto, participantes, coeficiente, escalones, formula } = entrada;

  if (!Number.isFinite(puesto) || puesto < 1) return null;
  if (!Number.isFinite(participantes) || participantes < 2) return null;
  // Un puesto por detrás del número de participantes no tiene sentido físico y
  // haría negativo el término continuo. Es señal de datos mal leídos.
  if (puesto > participantes) return null;

  const escalon = escalonDePuesto(escalones, puesto);
  const continuo =
    formula.escala *
    (formula.techo - Math.log10(puesto) / Math.log10(participantes));
  const base = escalon + continuo;

  return {
    escalon,
    continuo: dos(continuo),
    base: dos(base),
    coeficiente,
    puntos: dos(base * coeficiente),
  };
}

/**
 * La frase que se enseña debajo de cada prueba en el desglose.
 *
 * Se escribe aquí y no en el componente porque es parte de la explicación del
 * cálculo, y tiene que decir lo mismo en la pantalla del ranking, en «Mi
 * estado» y en el panel de admin.
 */
export function explicarPuntos(
  d: PuntosDesglosados,
  contexto: { puesto: number; participantes: number },
): string {
  const n = (v: number) =>
    new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(v);

  return (
    `Puesto ${contexto.puesto} de ${contexto.participantes}. ` +
    `El puesto da ${n(d.escalon)} puntos de escalón y ganar a ` +
    `${contexto.participantes - contexto.puesto} tiradores añade ${n(d.continuo)}, ` +
    `o sea ${n(d.base)}. Por el coeficiente ${n(d.coeficiente)} de la normativa: ` +
    `${n(d.puntos)} puntos.`
  );
}

/**
 * COEFICIENTE DE UNA PRUEBA CONCRETA.
 *
 * POR QUÉ NO BASTA CON LA CLAVE DEL CIRCUITO
 * ------------------------------------------
 * `ranking_rule.coefficients` se indexaba solo por circuito (`{"TNR": 1,
 * "CTO_ESPANA": 1.25}`), y eso no puede expresar lo que dice el punto 1.2 de la
 * normativa, que depende de DOS cosas: el circuito Y en qué categoría se
 * celebra la prueba respecto a la del ranking.
 *
 *   · competición de MI categoría ................ 1
 *   · competición de la categoría INMEDIATAMENTE SUPERIOR ... 1,25
 *   · Campeonato de España de MI categoría ....... 1,25
 *   · Campeonato de España de la SUPERIOR ........ 1,50
 *
 * O sea: para el ranking cadete, un TNR cadete vale 1 y un TNR júnior vale
 * 1,25, y los dos son circuito `TNR`. Con una clave por circuito los dos
 * cobrarían lo mismo y el ranking cadete saldría mal.
 *
 * LA SOLUCIÓN, SIN MIGRAR NADA
 * ----------------------------
 * Se admite una clave más específica, `CIRCUITO:CATEGORÍA` («TNR:M20»), y se
 * busca de lo más concreto a lo más general:
 *
 *   1. `TNR:M20`  (este circuito en esta categoría)
 *   2. `TNR`      (este circuito, cualquier categoría)
 *   3. `*`        (todo lo demás)
 *
 * Es aditivo: las filas que ya estaban escritas con claves de circuito a secas
 * siguen funcionando igual, porque caen en el paso 2. Y `coefficients` es un
 * `jsonb` validado con `z.record(z.string(), number)`, así que la clave nueva
 * no necesita ninguna columna nueva ni ninguna migración.
 *
 * Devuelve `null` —no 1— cuando la normativa no cubre el caso. Poner un 1 por
 * defecto sería inventarse un coeficiente, y la regla del proyecto es que lo
 * que no está configurado no puntúa y se dice por qué.
 */
export function coeficienteDePrueba(
  coeficientes: Record<string, number>,
  circuito: string,
  categoriaPrueba: string | null,
): number | null {
  if (categoriaPrueba) {
    const concreto = coeficientes[`${circuito}:${categoriaPrueba}`];
    if (concreto !== undefined) return concreto;
  }
  const porCircuito = coeficientes[circuito];
  if (porCircuito !== undefined) return porCircuito;
  const comodin = coeficientes['*'];
  return comodin !== undefined ? comodin : null;
}

/**
 * ARRASTRE DE LA TEMPORADA ANTERIOR (punto 1.1 de la normativa).
 *
 * El ranking «no es vivo»: arranca con un porcentaje de los puntos de la
 * temporada pasada. Cadete 10 %, júnior 15 %, sénior 20 %, sub-23 0 %.
 *
 * Un detalle que importa y que no está en el punto 1.1: el 0 % de sub-23 sale
 * de SU tabla del punto 1.3, no del cuadro del 1.1, que solo trae cadete,
 * júnior y sénior. Y M13 y M15 no tienen fila de arrastre en ninguna parte, por
 * lo que su porcentaje es `null` —no cero— y esta función devuelve null: «la
 * normativa no lo dice» no es «la normativa dice cero».
 */
export function arrastreTemporadaAnterior(
  puntosTemporadaAnterior: number | null,
  porcentaje: number | null,
): { puntos: number; explicacion: string } | null {
  if (porcentaje === null) return null;
  if (puntosTemporadaAnterior === null) return null;

  const puntos = dos(puntosTemporadaAnterior * porcentaje);
  const pct = new Intl.NumberFormat('es-ES', {
    style: 'percent',
    maximumFractionDigits: 2,
  }).format(porcentaje);
  const n = (v: number) =>
    new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(v);

  return {
    puntos,
    explicacion:
      `Arrastre de la temporada anterior: el ${pct} de ` +
      `${n(puntosTemporadaAnterior)} puntos son ${n(puntos)}. ` +
      'El ranking no es vivo: empieza con esta base antes de la primera prueba.',
  };
}
