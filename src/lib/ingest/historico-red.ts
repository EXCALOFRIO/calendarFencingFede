import { fetchJson, fetchText } from './fetcher';
import type { DepsInventarioFie, DepsInventarioSkermo, FederacionSkermo } from './sources/historico-indice';
import { SKERMO_FEDERATIONS } from './sources/skermo';
import type { DepsLecturaSkermo } from './sources/skermo-finales';
import {
  parseSkermoResultsIndex,
  parseSkermoSeasons,
  skermoResultsUrl,
} from './sources/skermo-results';

/**
 * Lectura HTTP real (sólo GET públicos) para el inventario y los puestos de
 * Skermo/FIE. Es para lotes y CLI: ninguna búsqueda de usuario debe llegar
 * aquí. El fetcher compartido ya identifica el cliente y reintenta una vez.
 */

export const depsInventarioSkermoRed: DepsInventarioSkermo = {
  indice: async (federacion, temporadaId) =>
    (
      await fetchText(skermoResultsUrl(federacion, temporadaId ? { season: temporadaId } : {}), {
        timeoutMs: 120_000,
      })
    ).body,
  temporadas: parseSkermoSeasons,
  parsear: (html, federacion) => parseSkermoResultsIndex(html, { federationCode: federacion }),
};

export const depsInventarioFieRed: DepsInventarioFie = {
  json: (url) => fetchJson<unknown>(url, { timeoutMs: 60_000 }),
};

export const depsLecturaSkermoRed: DepsLecturaSkermo = {
  html: async (url) => (await fetchText(url, { timeoutMs: 60_000 })).body,
};

/**
 * Índices autonómicos de Skermo. `SKERMO_FEDERATIONS` son los códigos que el
 * proyecto ya verificó (los inválidos devuelven HTTP 500); un código extra
 * pasado a mano se informa como `no_verificado` y no se pide.
 */
export function federacionesSkermo(extra: readonly string[] = []): FederacionSkermo[] {
  const verificadas = Object.keys(SKERMO_FEDERATIONS);
  return [
    ...verificadas.map((codigo) => ({ codigo, verificada: true })),
    ...extra.filter((c) => !verificadas.includes(c)).map((codigo) => ({ codigo, verificada: false })),
  ];
}
