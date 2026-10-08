import type {
  AnotacionOlimpica,
  CaminoOlimpico,
  EstadoOlimpico,
  MotivoPendiente,
  ZonaFie,
} from '@/lib/ranking/olimpica';
import { fechaCorta as fechaCortaComun } from '@/lib/fechas';

export const ZONA_CORTA: Record<ZonaFie, string> = {
  EUROPA: 'Europa',
  ASIA_OCEANIA: 'Asia-Oceanía',
  AMERICA: 'América',
  AFRICA: 'África',
};

export const ESTADO_TEXTO: Record<EstadoOlimpico, string> = {
  clasificado: 'Clasificado',
  cerca: 'Por asegurar',
  pendiente: 'Pendiente',
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

/** Rótulo corto del camino. «Internacional», nunca «Mundial». */
export function textoCamino(camino: CaminoOlimpico, zona: ZonaFie | null): string {
  switch (camino) {
    case 'EQUIPO_TOP':
      return '4 primeros equipos';
    case 'EQUIPO_ZONA':
      return zona ? `Equipo de ${ZONA_CORTA[zona]}` : 'Equipo por zona';
    case 'EQUIPO_SIGUIENTE':
      return 'Plaza libre';
    case 'POR_EQUIPO':
      return 'Con su equipo';
    case 'AOR':
      return '2 primeros individuales';
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
