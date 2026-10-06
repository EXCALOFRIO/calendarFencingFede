/**
 * Qué tramo de fechas pasadas hay que pedir para lo que se está mirando, y cómo
 * se llega a un mes lejano desde el buscador. Sin imports: lo usan la página
 * (servidor), la vista (cliente) y la acción.
 */

const DIA = 86_400_000;
const msDe = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);

/** Lo más largo que se pide de una vez: un trimestre con su margen. */
export const MAXIMO_DIAS_TRAMO = 100;

/** Del día 1 del primer mes al último día del último, en ISO. */
export function tramoDeMeses(anio: number, mes: number, cuantos: number): { desde: string; hasta: string } {
  const desde = new Date(Date.UTC(anio, mes, 1)).toISOString().slice(0, 10);
  const hasta = new Date(Date.UTC(anio, mes + cuantos, 0)).toISOString().slice(0, 10);
  return { desde, hasta };
}

/**
 * La parte ya pasada de un tramo: del primer día pedido a ayer. `null` si todo
 * el tramo es de hoy en adelante, que ya lo trae la carga normal.
 */
export function tramoPasadoDe(
  desde: string,
  hasta: string,
  hoy: string,
): { desde: string; hasta: string } | null {
  if (desde >= hoy) return null;
  const ayer = new Date(msDe(hoy) - DIA).toISOString().slice(0, 10);
  return { desde, hasta: hasta < ayer ? hasta : ayer };
}

/** Nombres de mes en minúscula y sin acentos, para leer «marzo 2019» del buscador. */
const MESES_ES = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat('es-ES', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(2000, i, 15)))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''),
);

/**
 * «2019», «marzo 2019», «marzo de 2019», «03/2019» o «2019-03» → el mes al que
 * ir (`mes` de 0 a 11). Solo años de cuatro cifras entre 1950 y el que viene, y
 * el texto entero tiene que ser la fecha: el «2026» dentro del nombre de un
 * torneo no es un salto.
 */
export function leerSaltoDeMes(
  texto: string,
  anioActual: number,
): { anio: number; mes: number } | null {
  const t = texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  let anio: number | null = null;
  let mes = 0;
  let m = /^(\d{4})(?:-(\d{1,2}))?$/.exec(t);
  if (m) {
    anio = Number(m[1]);
    if (m[2]) mes = Number(m[2]) - 1;
  } else if ((m = /^(\d{1,2})\/(\d{4})$/.exec(t))) {
    anio = Number(m[2]);
    mes = Number(m[1]) - 1;
  } else if ((m = /^([a-z]{3,})\s+(?:de\s+)?(\d{4})$/.exec(t))) {
    const prefijo = m[1];
    const i = MESES_ES.findIndex((nombre) => nombre.startsWith(prefijo));
    if (i < 0) return null;
    anio = Number(m[2]);
    mes = i;
  }
  if (anio === null || anio < 1950 || anio > anioActual + 1 || mes < 0 || mes > 11) return null;
  return { anio, mes };
}

/** Clave estable de un tramo, para no pedir dos veces lo mismo. */
export function claveDeTramo(t: { desde: string; hasta: string }): string {
  return `${t.desde}_${t.hasta}`;
}
