/**
 * Tipos públicos de las lecturas «sociales» del explorador (rivales,
 * estadísticas por ámbito y Siguiendo). Sin SQL ni dependencias de servidor:
 * los componentes cliente pueden importarlos.
 */

export type RivalBasico = { id: string; nombre: string; pais: string | null };

/** Victorias, derrotas y tocados de un conjunto de asaltos individuales. */
export type RegistroAsaltos = {
  asaltos: number;
  victorias: number;
  derrotas: number;
  /** Marcador igualado (no hay ganador publicado): no suma victoria ni derrota. */
  empates: number;
  tocadosDados: number;
  tocadosRecibidos: number;
  /** Victorias / (victorias + derrotas), 0..1; `null` sin asaltos decididos. */
  porcentajeVictorias: number | null;
};

export type BalanceRival = RegistroAsaltos & {
  rival: RivalBasico;
  /** Asaltos decididos por un solo tocado (5-4, 15-14…). */
  decididosPorUno: number;
  ganadosPorUno: number;
  /** Victorias seguidas más larga contra este rival, por orden de fecha. */
  mejorRacha: number;
  ultimaFecha: string | null;
};

export type ClaveCuriosidad =
  | 'rivalMasHabitual'
  | 'masTocadosDados'
  | 'masTocadosPorAsalto'
  | 'masTocadosRecibidos'
  | 'rivalMasDificil'
  | 'masVictoriasContra'
  | 'duelosMasAjustados'
  | 'mayorVictoria'
  | 'mejorRacha';

export type MarcadorDestacado = {
  favor: number;
  contra: number;
  fecha: string | null;
  pruebaId: string;
  torneo: string;
};

export type Curiosidad = {
  clave: ClaveCuriosidad;
  /** Título corto y neutro para la tarjeta. */
  etiqueta: string;
  /** Frase lista para mostrar, en tercera persona. */
  descripcion: string;
  rival: RivalBasico;
  /** Cifra principal de la curiosidad (asaltos, tocados, derrotas, racha…). */
  valor: number;
  balance: BalanceRival;
  /** Sólo en `mayorVictoria`: el asalto concreto. */
  marcador: MarcadorDestacado | null;
};

export type EstadisticasRivales = {
  total: RegistroAsaltos;
  /** Asaltos de poule (normalmente a 5 tocados). */
  poule: RegistroAsaltos;
  /** Asaltos de eliminación directa (normalmente a 15, o a 10 en algunas categorías). */
  eliminacion: RegistroAsaltos;
  /** Asaltos decididos por un tocado y cuántos se ganaron. */
  sangreFria: { asaltos: number; victorias: number; porcentaje: number | null };
  rivalesDistintos: number;
  /** Rivales con más asaltos (máximo `LIMITE_RIVALES_STATS`). */
  rivales: BalanceRival[];
  rivalesTruncado: boolean;
  curiosidades: Curiosidad[];
};

export type ResultadoEstadisticasRivales =
  | { estado: 'ok'; personaId: string; datos: EstadisticasRivales }
  | { estado: 'entrada_invalida' | 'no_encontrada' | 'no_disponible' | 'error' };

/* ---------- Ámbito, categoría y tipo de competición ---------- */

export type AmbitoCompeticion = 'internacional' | 'nacional';

export type TipoCompeticion =
  | 'JUEGOS_OLIMPICOS'
  | 'CTO_MUNDO'
  | 'CTO_EUROPA'
  | 'CTO_CONTINENTAL'
  | 'JUEGOS_MULTIDEPORTE'
  | 'COPA_MUNDO'
  | 'GRAN_PREMIO'
  | 'SATELITE'
  | 'CIRCUITO_EUROPEO'
  | 'INTERNACIONAL_OTRO'
  | 'CTO_ESPANA'
  | 'TNR'
  | 'LIGA_CLUBES'
  | 'LIGA_MASTER'
  | 'CRITERIUM'
  | 'NACIONAL_OTRO'
  | 'AUTONOMICO'
  | 'OTRO';

/**
 * Nombre de un token de color de `globals.css` (sin `--` ni `color-`): la UI
 * usa `text-${tono}`, `bg-${tono}`, y para los `org-*` también
 * `bg-${tono}-tinte` / `bg-${tono}-relleno`.
 */
export type TonoTipo = 'gold' | 'primary' | 'org-fie' | 'org-efc' | 'org-rfee' | 'org-aut' | 'off';

export type ClasificacionCompeticion = {
  tipo: TipoCompeticion;
  etiqueta: string;
  /** Versión corta para pastillas. */
  corta: string;
  tono: TonoTipo;
  ambito: AmbitoCompeticion;
  /** Orden de importancia para listar tipos (menor primero). */
  orden: number;
};

export type ResumenCompeticiones = {
  clave: string;
  etiqueta: string;
  competiciones: number;
  oros: number;
  platas: number;
  bronces: number;
  medallas: number;
  /** Puesto entre 1 y 8. */
  finales: number;
  mejorPuesto: number | null;
  asaltos: number;
  victorias: number;
  derrotas: number;
  porcentajeVictorias: number | null;
  tocadosDados: number;
  tocadosRecibidos: number;
  /** Tocados dados menos recibidos. */
  indiceTocados: number;
};

export type ResumenAmbito = ResumenCompeticiones & {
  clave: AmbitoCompeticion;
  porCategoria: ResumenCompeticiones[];
};

export type EstadisticasPorAmbito = {
  total: ResumenCompeticiones;
  internacional: ResumenAmbito;
  nacional: ResumenAmbito;
  porCategoria: ResumenCompeticiones[];
  /** `clave` es un `TipoCompeticion`; incluye `tono` para pintar la pastilla. */
  porTipo: (ResumenCompeticiones & { tono: TonoTipo })[];
  /** Hay más pruebas que el máximo leído: las cifras son parciales. */
  truncado: boolean;
};

export type ResultadoEstadisticasAmbito =
  | { estado: 'ok'; personaId: string; datos: EstadisticasPorAmbito }
  | { estado: 'entrada_invalida' | 'no_encontrada' | 'no_disponible' | 'error' };

/* ---------- Siguiendo ---------- */

export type Medalla = 'oro' | 'plata' | 'bronce';

export type EntradaSiguiendo = {
  /** ID del resultado (clave estable para React). */
  id: string;
  persona: RivalBasico;
  fecha: string | null;
  puesto: number | null;
  puestoLiteral: string | null;
  medalla: Medalla | null;
  participantes: number;
  prueba: {
    id: string;
    edicionId: string;
    torneo: string;
    ciudad: string | null;
    arma: string;
    genero: string;
    categoria: string;
    formato: string;
    fuente: string;
  };
  clasificacion: ClasificacionCompeticion;
};

export type ResultadoSiguiendo =
  | { estado: 'ok'; items: EntradaSiguiendo[]; siguiente: string | null; sinResultados: boolean }
  | { estado: 'entrada_invalida' | 'cursor_invalido' | 'no_disponible' };

export type ResultadoConteoSiguiendo =
  | { estado: 'ok'; siguiendo: number }
  | { estado: 'no_disponible' };
