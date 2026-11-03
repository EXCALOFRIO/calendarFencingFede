/**
 * Parámetros del sistema de clasificación de esgrima de LA 2028.
 *
 * Salen del documento oficial COI/FIE, versión del 17 de septiembre de 2026
 * (resumen y enlaces en `docs/clasificacion-olimpica-la2028.md`). Las reglas
 * son definitivas; lo provisional es el ranking con el que se aplican, que
 * hasta el 1 de abril de 2028 no es el que decide.
 *
 * ---------------------------------------------------------------------------
 * UMBRALES Y CUOTAS, SIN NÚMEROS FIJOS EN EL MOTOR
 * ---------------------------------------------------------------------------
 * Ningún «4 primeros», «5.º a 24.º», «2 plazas» o «una por zona» está
 * escrito en el cálculo: todo sale de `ReglasOlimpicas`. Los motores
 * (`calcularDetalleOlimpico`, `anotarRankingOlimpico`) aceptan
 * `opciones.reglas` —un `Partial` sobre esta tabla— para aplicar otra
 * versión del sistema o un escenario hipotético (por ejemplo, otra cuota
 * si el COI la cambia o si una readmisión mueve plazas). La composición del
 * ranking tampoco se supone: los tramos se cuentan sobre el orden efectivo
 * tras quitar los CON no elegibles, así que un país que entra o sale de la
 * lista (RUS, BLR, neutrales) solo cambia de sitio al resto.
 */
export type ReglasOlimpicas = {
  juegos: string;
  versionDocumento: string;
  documentoUrl: string;
  inicioPeriodo: string;
  /** Fecha de los rankings FIE sénior que deciden las plazas. */
  fechaRankingDecisivo: string;
  finPeriodo: string;

  /** Equipos por prueba según B.3 (informativo: los que entran se calculan). */
  equiposPorPrueba: number;
  /** D.1: los N primeros del ranking por equipos, sin mirar la zona. */
  equiposTop: number;
  /** D.1: tramo (incluido) donde se busca el mejor equipo de cada zona. */
  tramoZonaEquipos: { desde: number; hasta: number };
  tiradoresPorEquipo: number;

  /** D.2: plazas por el AOR mundial, máximo una por CON. */
  plazasAorMundial: number;
  /** D.2: plazas por el AOR por zona. */
  plazasAorPorZona: number;
  /** D.2: plazas por torneo zonal, una por zona. No se calculan aquí. */
  plazasTorneoZonalPorZona: number;
  /** D.2: máximo absoluto de tiradores de un CON en un arma. */
  maximoPorNocYArma: number;
  maximoIndividualSinEquipo: number;
  maximoTiradoresPorPrueba: number;

  anfitrion: string;
  /** D.3: a repartir por el CON anfitrión entre todas las pruebas. */
  plazasAnfitrion: number;
};

export const REGLAS_LA2028: ReglasOlimpicas = {
  juegos: 'LA28',
  versionDocumento: '2026-09-17',
  documentoUrl:
    'https://stillmed.olympics.com/media/Documents/Olympic-Games/LA28/FEN-LA28-Qualification-System.pdf',
  inicioPeriodo: '2027-04-01',
  fechaRankingDecisivo: '2028-04-01',
  finPeriodo: '2028-04-30',

  equiposPorPrueba: 8,
  equiposTop: 4,
  tramoZonaEquipos: { desde: 5, hasta: 24 },
  tiradoresPorEquipo: 3,

  plazasAorMundial: 2,
  plazasAorPorZona: 1,
  plazasTorneoZonalPorZona: 1,
  maximoPorNocYArma: 3,
  maximoIndividualSinEquipo: 1,
  maximoTiradoresPorPrueba: 37,

  anfitrion: 'USA',
  plazasAnfitrion: 6,
};

/** Las reglas efectivas: LA 2028 con lo que se pida cambiar encima. */
export function resolverReglas(parcial: Partial<ReglasOlimpicas> | undefined): ReglasOlimpicas {
  return { ...REGLAS_LA2028, ...parcial };
}

export type MotivoPendiente = 'PARTICIPACION_SIN_DECIDIR' | 'NEUTRAL';

/**
 * Filas que se enseñan pero no ocupan plaza.
 *
 * RUS y BLR: su participación en LA 2028 no está decidida, así que se calcula
 * como si no estuvieran y sus filas se marcan «pendiente», con lo que
 * tendrían si contaran. **Readmisión:** el día que el COI o la FIE la
 * decidan no hay que tocar el motor ni las cuotas — basta quitar el código
 * de esta tabla (o pasar otro mapa en `opciones.pendientes` /
 * `opciones.nocsNoElegibles`) y sus filas vuelven a contar con el ranking
 * que tengan ese día.
 *
 * «FIE» es como la FIE publica a los tiradores neutrales, y «AIN» es el
 * código con el que podrían volver los neutrales individualmente
 * («Individual Neutral Athlete»): ninguno es un CON y no suman plazas.
 */
export const PENDIENTES_LA2028: Readonly<Record<string, MotivoPendiente>> = {
  RUS: 'PARTICIPACION_SIN_DECIDIR',
  BLR: 'PARTICIPACION_SIN_DECIDIR',
  FIE: 'NEUTRAL',
  AIN: 'NEUTRAL',
};

export const NOCS_NO_ELEGIBLES_POR_DEFECTO: readonly string[] = Object.keys(PENDIENTES_LA2028);
