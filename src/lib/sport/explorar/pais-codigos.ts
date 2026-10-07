import { ISO2_A_FIE } from '@/components/bandera';

/**
 * Países de la FIE que cuentan en las fichas de país. Son los de la tabla de
 * banderas más los históricos y los que la FIE publica sin bandera en el
 * repositorio. No entran «FIE», «AIN» (neutrales), «MIX» ni «EFC»: no son
 * países. Los códigos de club que Engarde pone en la columna del país en las
 * pruebas nacionales («CET», «SAM») tampoco, porque no están aquí.
 */
const OTROS: Record<string, string> = {
  URS: 'Unión Soviética',
  EUN: 'Equipo Unificado',
  CEI: 'Equipo Unificado',
  GDR: 'Alemania Oriental',
  FRG: 'Alemania Occidental',
  TCH: 'Checoslovaquia',
  YUG: 'Yugoslavia',
  SCG: 'Serbia y Montenegro',
  AHO: 'Antillas Neerlandesas',
  RHO: 'Rodesia',
  SIN: 'Singapur',
  PLE: 'Palestina',
  ARU: 'Aruba',
  DMA: 'Dominica',
  MYA: 'Myanmar',
  LAO: 'Laos',
  SAM: 'Samoa',
  PRK: 'Corea del Norte',
  BAH: 'Bahamas',
  GEQ: 'Guinea Ecuatorial',
  BIZ: 'Belice',
  AFG: 'Afganistán',
  ASA: 'Samoa Americana',
  GUM: 'Guam',
  ENG: 'Inglaterra',
  SCO: 'Escocia',
  WAL: 'Gales',
  NIR: 'Irlanda del Norte',
  JER: 'Jersey',
};

const FIE_A_ISO2: Record<string, string> = Object.fromEntries(
  Object.entries(ISO2_A_FIE).map(([dos, tres]) => [tres, dos]),
);

export const CODIGOS_PAIS: readonly string[] = [...new Set([...Object.values(ISO2_A_FIE), ...Object.keys(OTROS)])].sort();

const VALIDOS = new Set(CODIGOS_PAIS);

const CODIGO_RE = /^[A-Z]{3}$/;

/** El código de la URL en mayúsculas (`esp` → `ESP`) si es un país; si no, `null`. */
export function codigoPaisDeRuta(segmento: string | undefined | null): string | null {
  if (typeof segmento !== 'string') return null;
  let valor: string;
  try {
    valor = decodeURIComponent(segmento).trim().toUpperCase();
  } catch {
    return null;
  }
  return CODIGO_RE.test(valor) && VALIDOS.has(valor) ? valor : null;
}

export function esCodigoPais(valor: string): boolean {
  return VALIDOS.has(valor);
}

/** ISO de dos letras para `BanderaPais` (que pinta la bandera con él); el código si no hay. */
export function paisParaBandera(codigo: string): string {
  return FIE_A_ISO2[codigo] ?? codigo;
}

const nombres = new Map<string, string>();

/** Nombre en castellano del país; el código si el runtime no lo sabe. */
export function nombrePaisFie(codigo: string): string {
  const memo = nombres.get(codigo);
  if (memo) return memo;
  let nombre = OTROS[codigo] ?? codigo;
  const iso = FIE_A_ISO2[codigo];
  if (iso) {
    try {
      nombre = new Intl.DisplayNames(['es'], { type: 'region' }).of(iso) ?? nombre;
    } catch {
      // Sin datos de idioma en el runtime se queda el código.
    }
  }
  nombres.set(codigo, nombre);
  return nombre;
}
