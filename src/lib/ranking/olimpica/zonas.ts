/**
 * Zona FIE de cada país, por código de tres letras de la FIE (= COI).
 *
 * La FIE agrupa a sus federaciones en cuatro confederaciones continentales y
 * el sistema de clasificación olímpica usa esas cuatro zonas: EFC → Europa,
 * CPE → América, CAE → África, FCA + Oceanía → Asia-Oceanía.
 *
 * No coincide con la geografía en varios casos que importan: Israel, Turquía,
 * Chipre, Armenia, Azerbaiyán y Georgia son de la EFC (Europa); Kazajistán,
 * Kirguistán y el resto de Asia central son de la FCA (Asia-Oceanía).
 *
 * «FIE» (tiradores neutrales) no tiene zona a propósito: no es un CON.
 */

export type ZonaFie = 'EUROPA' | 'ASIA_OCEANIA' | 'AMERICA' | 'AFRICA';

export const ZONAS_FIE: readonly ZonaFie[] = [
  'EUROPA',
  'ASIA_OCEANIA',
  'AMERICA',
  'AFRICA',
];

const EUROPA = [
  'ALB', 'AND', 'ARM', 'AUT', 'AZE', 'BEL', 'BIH', 'BLR', 'BUL', 'CRO',
  'CYP', 'CZE', 'DEN', 'ESP', 'EST', 'FIN', 'FRA', 'GBR', 'GEO', 'GER',
  'GRE', 'HUN', 'IRL', 'ISL', 'ISR', 'ITA', 'KOS', 'LAT', 'LIE', 'LTU',
  'LUX', 'MDA', 'MKD', 'MLT', 'MNE', 'MON', 'NED', 'NOR', 'POL', 'POR',
  'ROU', 'RUS', 'SLO', 'SMR', 'SRB', 'SUI', 'SVK', 'SWE', 'TUR', 'UKR',
];

const ASIA_OCEANIA = [
  'AFG', 'BAN', 'BHU', 'BRN', 'BRU', 'CAM', 'CHN', 'HKG', 'INA', 'IND',
  'IRI', 'IRQ', 'JOR', 'JPN', 'KAZ', 'KGZ', 'KOR', 'KSA', 'KUW', 'LAO',
  'LBN', 'MAC', 'MAS', 'MDV', 'MGL', 'MYA', 'NEP', 'OMA', 'PAK', 'PHI',
  'PLE', 'PRK', 'QAT', 'SGP', 'SRI', 'SYR', 'THA', 'TJK', 'TKM', 'TLS',
  'TPE', 'UAE', 'UZB', 'VIE', 'YEM',
  // Oceanía
  'AUS', 'COK', 'FIJ', 'FSM', 'GUM', 'KIR', 'MHL', 'NRU', 'NZL', 'PLW',
  'PNG', 'SAM', 'SOL', 'TGA', 'TUV', 'VAN', 'ASA',
];

const AMERICA = [
  'ANT', 'ARG', 'ARU', 'BAH', 'BAR', 'BER', 'BIZ', 'BOL', 'BRA', 'CAN',
  'CAY', 'CHI', 'COL', 'CRC', 'CUB', 'DMA', 'DOM', 'ECU', 'ESA', 'GRN',
  'GUA', 'GUY', 'HAI', 'HON', 'ISV', 'IVB', 'JAM', 'LCA', 'MEX', 'NCA',
  'PAN', 'PAR', 'PER', 'PUR', 'SKN', 'SUR', 'TTO', 'URU', 'USA', 'VEN',
  'VIN',
];

const AFRICA = [
  'ALG', 'ANG', 'BDI', 'BEN', 'BOT', 'BUR', 'CAF', 'CHA', 'CGO', 'CIV',
  'CMR', 'COD', 'COM', 'CPV', 'DJI', 'EGY', 'ERI', 'ETH', 'GAB', 'GAM',
  'GBS', 'GEQ', 'GHA', 'GUI', 'KEN', 'LBA', 'LBR', 'LES', 'MAD', 'MAR',
  'MAW', 'MLI', 'MOZ', 'MRI', 'MTN', 'NAM', 'NGR', 'NIG', 'RSA', 'RWA',
  'SEN', 'SEY', 'SLE', 'SOM', 'SSD', 'STP', 'SUD', 'SWZ', 'TAN', 'TOG',
  'TUN', 'UGA', 'ZAM', 'ZIM',
];

const ZONA_POR_NOC: ReadonlyMap<string, ZonaFie> = new Map([
  ...EUROPA.map((c) => [c, 'EUROPA'] as const),
  ...ASIA_OCEANIA.map((c) => [c, 'ASIA_OCEANIA'] as const),
  ...AMERICA.map((c) => [c, 'AMERICA'] as const),
  ...AFRICA.map((c) => [c, 'AFRICA'] as const),
]);

/** `null` si el código no es de ningún CON conocido (por ejemplo «FIE»). */
export function zonaDe(noc: string | null | undefined): ZonaFie | null {
  if (!noc) return null;
  return ZONA_POR_NOC.get(noc.trim().toUpperCase()) ?? null;
}
