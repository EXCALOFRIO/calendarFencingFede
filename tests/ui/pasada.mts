/**
 * Opciones comunes de los arneses de capturas para la pasada visual global.
 * Con PASADA=1 cada arnés escribe en `capturas/pasada-global/<carpeta>/` y
 * añade el ancho de 320 px a los suyos (393 y 1440).
 */
import path from 'node:path';

export const PASADA = Boolean(process.env.PASADA);

export function carpetaCapturas(raiz: string, carpeta: string): string {
  return PASADA ? path.join(raiz, 'capturas', 'pasada-global', carpeta) : path.join(raiz, 'capturas', carpeta);
}

type Ancho = { sufijo: string; viewport: { width: number; height: number }; escala: number };

export function anchosCapturas<T extends Ancho>(anchos: T[]): T[] {
  if (!PASADA) return anchos;
  const base = anchos[0]!;
  return [...anchos, { ...base, sufijo: '320', viewport: { width: 320, height: 700 } }];
}

/** Ancho a partir del cual ya no se exige que no haya desplazamiento horizontal. */
export const ES_MOVIL = (ancho: number) => ancho < 768;
