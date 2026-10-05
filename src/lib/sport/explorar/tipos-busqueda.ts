/**
 * DTO de la búsqueda de personas, de las sugerencias y de los asaltos de una
 * prueba. Igual que `tipos.ts`: se construyen campo a campo y no llevan ni
 * datos de cuenta, ni licencias, ni fotos, ni ranking interno.
 */

import type { SugerenciaPersona } from './sugerencias-modelo';
import type { Arma, DeportistaResumen } from './tipos';

/**
 * Lo que una persona ha hecho según los resultados ya importados de todo su
 * grupo de fusión. Las medallas y el mejor puesto sólo cuentan pruebas
 * individuales con puesto numérico: un puesto por equipos no es de la persona.
 */
export type TrayectoriaPersona = {
  /** Última clasificación importada, la más reciente por fecha conocida. */
  ultima: { edicionId: string; torneo: string; fecha: string | null } | null;
  mejorPuesto: number | null;
  oros: number;
  platas: number;
  bronces: number;
};

export const TRAYECTORIA_VACIA: TrayectoriaPersona = {
  ultima: null,
  mejorPuesto: null,
  oros: 0,
  platas: 0,
  bronces: 0,
};

export type DeportistaBuscado = DeportistaResumen & { trayectoria: TrayectoriaPersona };

/** Resumen de una sugerencia: sólo cuántas clasificaciones y de qué armas. */
export type ResumenSugerencia = { resultados: number; armas: Arma[] };

export type SugerenciaConResumen = SugerenciaPersona & ResumenSugerencia;

/* ------------------------------------------------------- asaltos de una prueba */

export type TiradorAsalto = {
  /** Persona deportiva vinculada; `null` = sin ficha, nunca deducida por nombre. */
  personaId: string | null;
  nombre: string;
  pais: string | null;
  tantos: number;
};

export type AsaltoDePrueba = {
  id: string;
  ronda: string;
  a: TiradorAsalto;
  b: TiradorAsalto;
};

export type FilaPoule = {
  clave: string;
  personaId: string | null;
  nombre: string;
  pais: string | null;
  /** Tantos de esta fila contra cada columna, en el orden de `filas`; `null` = sin asalto importado. */
  celdas: ({ tantos: number; victoria: boolean } | null)[];
  victorias: number;
  asaltos: number;
  tocados: number;
  recibidos: number;
};

export type PouleDePrueba = { ronda: string; etiqueta: string; filas: FilaPoule[] };

export type RondaCuadro = {
  ronda: string;
  etiqueta: string;
  /** Tiradores al empezar la ronda (64, 32… 2), o `null` si la clave no lo dice. */
  tamano: number | null;
  asaltos: AsaltoDePrueba[];
};

export type AsaltosDePrueba = {
  fuente: string;
  poules: PouleDePrueba[];
  cuadro: RondaCuadro[];
  /** Se leyó el máximo de asaltos permitido: puede haber más sin mostrar. */
  truncado: boolean;
};
