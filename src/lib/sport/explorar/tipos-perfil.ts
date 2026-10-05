import type { Arma, FichaDeportiva } from './tipos';
import type { EstadisticasPorAmbito, EstadisticasRivales } from './tipos-social';

/**
 * DTO del perfil deportivo (cabecera, cifras, año a año, mano a mano).
 *
 * Igual que `tipos.ts`: todo se construye campo a campo y nada lleva datos de
 * cuenta, licencias, fecha de nacimiento ni la foto. La foto la pide el
 * navegador por su propia ruta autenticada, nunca viaja en este DTO.
 */

/** Puestos 1, 2 y 3 publicados (en la FIE los dos semifinalistas son terceros) y puestos 1 a 8. */
export type Medallero = {
  oros: number;
  platas: number;
  bronces: number;
  /** Puestos 1 a 8: el cuadro final de ocho. */
  finales: number;
};

/** Asaltos individuales vistos desde esta persona. Un empate no es victoria ni derrota. */
export type BalanceAsaltos = {
  asaltos: number;
  victorias: number;
  derrotas: number;
  empates: number;
  tocadosDados: number;
  tocadosRecibidos: number;
};

export type TemporadaPerfil = {
  /** Temporada deportiva `AAAA-AAAA`; la FIE etiqueta con el año final y se junta con la RFEE equivalente. */
  temporada: string;
  pruebas: number;
  conPuesto: number;
  mejorPuesto: number | null;
  medallero: Medallero;
  /** `null` cuando esa temporada no tiene ningún asalto importado. */
  asaltos: BalanceAsaltos | null;
};

export type RivalFrecuente = {
  id: string;
  nombre: string;
  pais: string | null;
  asaltos: number;
  victorias: number;
  derrotas: number;
  ultimo: { fecha: string | null; favor: number; contra: number; torneo: string };
};

/**
 * Persona sugerida desde una ficha, por hechos importados: asaltos entre las
 * dos, pruebas recientes compartidas o el mismo club publicado en alguna de
 * ellas. Sin año de nacimiento ni foto: la tarjeta sólo lleva iniciales.
 */
export type TiradorSugerido = {
  id: string;
  nombre: string;
  pais: string | null;
  /** Club legible publicado en la prueba compartida más reciente; un código de Skermo no cuenta. */
  club: string | null;
  asaltos: number;
  victorias: number;
  derrotas: number;
  /** Pruebas compartidas dentro de las más recientes de la ficha, no de toda la carrera. */
  pruebas: number;
  mismoClub: boolean;
  motivo: 'rival_frecuente' | 'mismo_club' | 'asaltos' | 'pruebas';
};

export type PuestoRanking = {
  puesto: number;
  totalPublicado: number | null;
  fuente: string;
  temporada: string;
  arma: Arma;
  categoria: { codigo: string; raw: string | null };
};

export type PerfilDeportivo = {
  /** Armas con alguna clasificación individual importada, de más a menos pruebas. */
  armas: Arma[];
  /** Último club publicado con nombre legible; un código de Skermo no cuenta como nombre. */
  club: { nombre: string; fuente: string; fecha: string | null } | null;
  /** Ficha pública de la FIE. Nunca para una persona posiblemente menor. */
  enlaceFie: string | null;
  resumen: Medallero & { pruebas: number; conPuesto: number; mejorPuesto: number | null };
  /** `null` = no se pudo leer (fallo de consulta), distinto de «ningún asalto importado». */
  asaltos: {
    total: BalanceAsaltos;
    poule: BalanceAsaltos;
    eliminacion: BalanceAsaltos;
    /** Rivales distintos identificados; ausente si la lectura no lo trae. */
    rivales?: number | null;
  } | null;
  /** Más reciente primero. */
  temporadas: TemporadaPerfil[];
  /** `null` = no se pudo leer. */
  rivales: RivalFrecuente[] | null;
  /** `null` = no se pudo leer; ausente en DTO anteriores a las sugerencias. */
  sugeridos?: TiradorSugerido[] | null;
  ranking: { actual: PuestoRanking | null; mejor: PuestoRanking | null };
  /** Balance por rival y curiosidades. `null` = no se pudo leer; ausente en DTO anteriores. */
  rivalesStats?: EstadisticasRivales | null;
  /** Internacional, nacional, por categoría y por tipo. `null` = no se pudo leer; ausente en DTO anteriores. */
  ambito?: EstadisticasPorAmbito | null;
};

export type FichaConPerfil = FichaDeportiva & {
  /** Ausente en consumidores anteriores del DTO o si la lectura del perfil falló entera. */
  perfil?: PerfilDeportivo;
};
