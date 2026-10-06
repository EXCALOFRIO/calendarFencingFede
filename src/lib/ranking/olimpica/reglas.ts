/**
 * Parámetros del sistema de clasificación de esgrima de LA 2028.
 *
 * Salen del documento oficial COI/FIE, versión del 17 de septiembre de 2026
 * (resumen y enlaces en `docs/clasificacion-olimpica-la2028.md`). Las reglas
 * son definitivas; lo provisional es el ranking con el que se aplican, que
 * hasta el 1 de abril de 2028 no es el que decide.
 */
export const REGLAS_LA2028 = {
  juegos: 'LA28',
  versionDocumento: '2026-09-17',
  documentoUrl:
    'https://stillmed.olympics.com/media/Documents/Olympic-Games/LA28/FEN-LA28-Qualification-System.pdf',
  inicioPeriodo: '2027-04-01',
  /** Fecha de los rankings FIE sénior que deciden las plazas. */
  fechaRankingDecisivo: '2028-04-01',
  finPeriodo: '2028-04-30',

  equiposPorPrueba: 8,
  /** D.1: los N primeros del ranking por equipos, sin mirar la zona. */
  equiposTop: 4,
  /** D.1: tramo (incluido) donde se busca el mejor equipo de cada zona. */
  tramoZonaEquipos: { desde: 5, hasta: 24 },
  tiradoresPorEquipo: 3,

  /** D.2: plazas por el AOR mundial, máximo una por CON. */
  plazasAorMundial: 2,
  /** D.2: plazas por el AOR por zona, una por zona. */
  plazasAorPorZona: 1,
  /** D.2: plazas por torneo zonal, una por zona. No se calculan aquí. */
  plazasTorneoZonalPorZona: 1,
  /** D.2: máximo absoluto de tiradores de un CON en un arma. */
  maximoPorNocYArma: 3,
  maximoIndividualSinEquipo: 1,
  maximoTiradoresPorPrueba: 37,

  anfitrion: 'USA',
  /** D.3: a repartir por el CON anfitrión entre todas las pruebas. */
  plazasAnfitrion: 6,
} as const;

export type MotivoPendiente = 'PARTICIPACION_SIN_DECIDIR' | 'NEUTRAL';

/**
 * Filas que se enseñan pero no ocupan plaza.
 *
 * RUS y BLR: su participación en LA 2028 no está decidida, así que se calcula
 * como si no estuvieran y sus filas se marcan «pendiente». «FIE» es como la FIE
 * publica a los tiradores neutrales: no son un CON y no suman plazas.
 */
export const PENDIENTES_LA2028: Readonly<Record<string, MotivoPendiente>> = {
  RUS: 'PARTICIPACION_SIN_DECIDIR',
  BLR: 'PARTICIPACION_SIN_DECIDIR',
  FIE: 'NEUTRAL',
};

export const NOCS_NO_ELEGIBLES_POR_DEFECTO: readonly string[] = Object.keys(PENDIENTES_LA2028);
