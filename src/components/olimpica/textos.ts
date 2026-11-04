import {
  REGLAS_LA2028,
  type AnotacionOlimpica,
  type CaminoOlimpico,
  type EstadoOlimpico,
  type MotivoPendiente,
  type ReglasOlimpicas,
  type ZonaFie,
} from '@/lib/ranking/olimpica';
import { fechaCorta as fechaCortaComun } from '@/lib/fechas';

export const ZONA_CORTA: Record<ZonaFie, string> = {
  EUROPA: 'Europa',
  ASIA_OCEANIA: 'Asia-Oceanía',
  AMERICA: 'América',
  AFRICA: 'África',
};

/**
 * El estado dicho, no solo pintado. «Cerca» es la palabra que usa todo el
 * mundo («¿está cerca de clasificar?»), mejor que «por asegurar»: un seleccionador
 * tiene que entenderlo sin abrir la burbuja.
 */
export const ESTADO_TEXTO: Record<EstadoOlimpico, string> = {
  clasificado: 'Clasificado',
  cerca: 'Cerca de clasificar',
  pendiente: 'Sin decidir',
};

/** En los caminos de equipo el puesto y los puntos son del ranking por equipos. */
export function esCaminoDeEquipo(camino: CaminoOlimpico | null): boolean {
  return camino === 'EQUIPO_TOP' || camino === 'EQUIPO_ZONA' || camino === 'EQUIPO_SIGUIENTE' || camino === 'POR_EQUIPO';
}

export const plural = (n: number, uno: string, varios: string) => `${puntos(n)} ${n === 1 ? uno : varios}`;

export const MOTIVO_TEXTO: Record<MotivoPendiente, string> = {
  PARTICIPACION_SIN_DECIDIR: 'Participación sin decidir',
  NEUTRAL: 'Neutral',
};

/**
 * Lo que se lee en la etiqueta junto al nombre, al lado de los aros:
 *
 *   clasificado              «Clasificado»; si es por su equipo, «Con su equipo»
 *                            —la misma vía que explica la burbuja, más corta que
 *                            «Clasificado · equipo» para que no opaque el nombre.
 *   cerca                    «A 30 pts» —lo que falta—, «Equipo a 30 pts» cuando la
 *                            distancia es de su equipo, «Anfitrión» si depende de EE. UU.
 *   pendiente                «Sin decidir».
 *
 * El color sigue acompañando (verde/amarillo/gris), pero ya nadie tiene que
 * deducirlo de un aro amarillo suelto.
 */
export function textoPastilla(a: AnotacionOlimpica): string {
  switch (a.estado) {
    case 'clasificado':
      return a.camino === 'POR_EQUIPO' ? 'Con su equipo' : 'Clasificado';
    case 'cerca': {
      if (a.camino === 'ANFITRION') return 'Anfitrión';
      if (a.faltan === null) return 'Cerca';
      return a.camino === 'POR_EQUIPO'
        ? `Equipo a ${puntos(a.faltan)} pts`
        : `A ${puntos(a.faltan)} pts`;
    }
    case 'pendiente':
      return 'Sin decidir';
    default:
      return '';
  }
}

/** El formato de la plaza dicho —individual o por equipos— para la burbuja. */
export function textoFormato(camino: CaminoOlimpico | null): string | null {
  switch (camino) {
    case 'EQUIPO_TOP':
    case 'EQUIPO_ZONA':
    case 'EQUIPO_SIGUIENTE':
    case 'POR_EQUIPO':
      return 'Por equipos';
    case 'AOR':
    case 'AOR_ZONA':
    case 'ANFITRION':
    case 'TORNEO_ZONAL':
      return 'Individual';
    default:
      return null;
  }
}

/**
 * Rótulo corto del camino. «Internacional», nunca «Mundial». Las cifras
 * salen de las reglas aplicadas para no escribir «4» o «2» a mano; sin
 * `reglas`, las de LA 2028.
 */
export function textoCamino(
  camino: CaminoOlimpico,
  zona: ZonaFie | null,
  reglas: Pick<ReglasOlimpicas, 'equiposTop' | 'plazasAorMundial'> = REGLAS_LA2028,
): string {
  switch (camino) {
    case 'EQUIPO_TOP':
      return `${reglas.equiposTop} primeros equipos`;
    case 'EQUIPO_ZONA':
      return zona ? `Equipo de ${ZONA_CORTA[zona]}` : 'Equipo por zona';
    case 'EQUIPO_SIGUIENTE':
      return 'Plaza libre';
    case 'POR_EQUIPO':
      return 'Con su equipo';
    case 'AOR':
      return `${reglas.plazasAorMundial} primeros individuales`;
    case 'AOR_ZONA':
      return zona ? `Mejor de ${ZONA_CORTA[zona]}` : 'Mejor de su zona';
    case 'ANFITRION':
      return 'Plaza de anfitrión';
    case 'TORNEO_ZONAL':
      return 'Torneo zonal';
  }
}

/** «28 sept», con el año sólo si no es el de hoy. */
export function fechaCorta(iso: string | null): string | null {
  if (!iso) return null;
  return fechaCortaComun(iso) || null;
}

const numero = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
export const puntos = (n: number) => numero.format(n);

export function etiquetaAccesible(a: AnotacionOlimpica): string {
  if (!a.estado) return '';
  const partes = [`JJOO LA 2028: ${ESTADO_TEXTO[a.estado].toLowerCase()}`];
  if (a.camino) partes.push(textoCamino(a.camino, a.zona));
  if (a.estado === 'cerca' && a.faltan !== null) partes.push(`le faltan ${plural(a.faltan, 'punto', 'puntos')}`);
  if (a.estado === 'clasificado' && a.margen !== null) partes.push(`${plural(a.margen, 'punto', 'puntos')} de margen`);
  if (a.estado === 'pendiente' && a.motivo) partes.push(MOTIVO_TEXTO[a.motivo]);
  return partes.join(', ');
}
