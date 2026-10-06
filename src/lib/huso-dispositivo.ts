import * as React from 'react';

/**
 * ===========================================================================
 * LA HORA DE LA SEDE Y LA HORA DE QUIEN MIRA
 * ===========================================================================
 *
 * La ficha decía «7 horas más que en España (allí van adelantados). Allí son
 * las 05:36.»: una cuenta que hay que hacer de cabeza, con España como
 * referencia fija aunque el móvil esté en Lima. Ahora cada hora se enseña
 * dos veces —la de la sede, que es la que escribe la convocatoria, y la del
 * dispositivo, ya convertida— y la cuenta la hace la máquina.
 *
 * El huso del dispositivo sale de `Intl.DateTimeFormat().resolvedOptions()`,
 * que es el del sistema operativo. En el servidor no existe, así que el
 * primer pintado usa el de España y el cliente lo corrige al hidratar (ver
 * `useHusoDispositivo`).
 *
 * Aquí no hay React salvo ese gancho: las conversiones son funciones puras y
 * se prueban sin navegador.
 */

export const HUSO_POR_DEFECTO = 'Europe/Madrid';

/** Minutos que el huso va por delante de UTC en ese instante, o `null` si no se conoce. */
export function desfaseMinutos(huso: string, instante: Date): number | null {
  try {
    const texto = new Intl.DateTimeFormat('en-US', {
      timeZone: huso,
      timeZoneName: 'longOffset',
    }).format(instante);
    const m = texto.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return 0;
    return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  } catch {
    return null;
  }
}

/** «09:00», «9:00», «9.00», «09h00», «9:00h» → `[9, 0]`. Lo demás no es una hora. */
export function leerHora(texto: string): [number, number] | null {
  const m = texto.trim().match(/^(\d{1,2})\s*[:.hH]\s*(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? [h, min] : null;
}

/**
 * El instante en que en `huso` son las `hora` del día `fecha`.
 *
 * Se calcula el desfase en una primera aproximación y se vuelve a calcular en
 * el instante resultante: si entre medias hay un cambio de hora, la segunda
 * pasada lo recoge.
 */
export function instanteDeHoraLocal(
  fecha: string,
  hora: string,
  huso: string,
): Date | null {
  const hm = leerHora(hora);
  const dia = fecha.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!hm || !dia) return null;
  const base = Date.UTC(Number(dia[1]), Number(dia[2]) - 1, Number(dia[3]), hm[0], hm[1]);
  const primero = desfaseMinutos(huso, new Date(base));
  if (primero === null) return null;
  const segundo = desfaseMinutos(huso, new Date(base - primero * 60_000)) ?? primero;
  return new Date(base - segundo * 60_000);
}

const relojes = new Map<string, Intl.DateTimeFormat>();
function reloj(huso: string): Intl.DateTimeFormat {
  let f = relojes.get(huso);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: huso,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    relojes.set(huso, f);
  }
  return f;
}

/** La hora y el día de un instante en un huso: `{ hora: '02:00', fecha: '2026-10-16' }`. */
export function enHuso(instante: Date, huso: string): { hora: string; fecha: string } {
  const partes = Object.fromEntries(
    reloj(huso)
      .formatToParts(instante)
      .map((p) => [p.type, p.value]),
  );
  return {
    hora: `${partes.hour}:${partes.minute}`,
    fecha: `${partes.year}-${partes.month}-${partes.day}`,
  };
}

export type HoraConvertida = {
  hora: string;
  /** −1 si en el dispositivo todavía es el día anterior, +1 si ya es el siguiente. */
  dias: number;
};

/** Una hora de la sede pasada al huso del dispositivo, o `null` si no se puede. */
export function convertirHora(
  fecha: string,
  hora: string,
  husoSede: string,
  husoDestino: string,
): HoraConvertida | null {
  const instante = instanteDeHoraLocal(fecha, hora, husoSede);
  if (!instante) return null;
  const destino = enHuso(instante, husoDestino);
  const dias = Math.round(
    (Date.parse(`${destino.fecha}T00:00:00Z`) - Date.parse(`${fecha.slice(0, 10)}T00:00:00Z`)) /
      86_400_000,
  );
  return { hora: destino.hora, dias };
}

/**
 * ¿Los dos husos dan la misma hora ese día?
 *
 * Se comparan relojes, no nombres: `Europe/Paris` y `Europe/Madrid` son dos
 * husos y un mismo reloj, y enseñar «09:00 · 09:00 tu hora» sería ruido.
 */
export function mismoReloj(a: string, b: string, fecha: string): boolean {
  if (a === b) return true;
  const enDia = new Date(`${fecha.slice(0, 10)}T12:00:00Z`);
  const da = desfaseMinutos(a, enDia);
  const db = desfaseMinutos(b, enDia);
  return da !== null && da === db;
}

/**
 * Abreviaturas que `Intl` no conoce.
 *
 * Con cualquier idioma, `Intl` escribe «GMT+9» para Tokio: las siglas solo
 * las tiene para los husos de Europa y América. Estas son las de las sedes
 * asiáticas del circuito, que es donde la diferencia horaria es grande.
 */
const SIGLAS: Record<string, string> = {
  'Asia/Tokyo': 'JST',
  'Asia/Seoul': 'KST',
  'Asia/Hong_Kong': 'HKT',
  'Asia/Shanghai': 'CST',
  'Asia/Singapore': 'SGT',
};

/** «JST», «CEST», «UTC−5». Nunca cadena vacía. */
export function siglasHuso(huso: string, fecha: string): string {
  if (SIGLAS[huso]) return SIGLAS[huso];
  try {
    const texto =
      new Intl.DateTimeFormat('en-GB', { timeZone: huso, timeZoneName: 'short' })
        .formatToParts(new Date(`${fecha.slice(0, 10)}T12:00:00Z`))
        .find((p) => p.type === 'timeZoneName')?.value ?? '';
    if (!texto) return huso;
    return texto.replace(/^GMT$/, 'UTC').replace(/^GMT/, 'UTC').replace('-', '−');
  } catch {
    return huso;
  }
}

/** ¿Cambia la hora en ese huso entre la víspera y el día después del torneo? */
export function cambiaLaHora(huso: string, inicio: string, fin: string): boolean {
  const antes = new Date(`${inicio}T12:00:00Z`);
  antes.setUTCDate(antes.getUTCDate() - 1);
  const despues = new Date(`${fin}T12:00:00Z`);
  despues.setUTCDate(despues.getUTCDate() + 1);
  return desfaseMinutos(huso, antes) !== desfaseMinutos(huso, despues);
}

function husoDelSistema(): string {
  try {
    const huso = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return huso && desfaseMinutos(huso, new Date()) !== null ? huso : HUSO_POR_DEFECTO;
  } catch {
    return HUSO_POR_DEFECTO;
  }
}

const sinSuscripcion = () => () => {};

/**
 * El huso del dispositivo, sin romper la hidratación.
 *
 * `useSyncExternalStore` con instantánea de servidor es la forma que tiene
 * React de leer algo que solo existe en el navegador: el HTML del servidor y
 * el primer pintado del cliente usan los dos `Europe/Madrid`, así que
 * coinciden, y justo después React repinta con el huso de verdad. Leerlo en
 * el cuerpo del componente daría «el texto del servidor no coincide» (#418)
 * en cuanto alguien abra la ficha desde fuera de España.
 */
export function useHusoDispositivo(): string {
  return React.useSyncExternalStore(sinSuscripcion, husoDelSistema, () => HUSO_POR_DEFECTO);
}
