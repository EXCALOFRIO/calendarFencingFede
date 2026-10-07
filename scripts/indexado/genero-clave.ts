/**
 * Género de una prueba de Engarde contrastado con el código de su clave.
 *
 * El fichero de Engarde trae el sexo de la prueba (`sexe`), pero a veces mal: cinco pruebas se
 * cargaron con el género al revés (`rfee-wayback:619/CTOESP-EFCATI`, `rfee-wayback:824/FIESTA_SF-12`,
 * `engarde:rfee/191026tnrsable/sfabs`, `engarde:fecyl/cespabs2016/fmind` y `…/smind`). El código de
 * la prueba en el último segmento de la clave (`ef`, `em`, `sf`, `sm`, `ff`, `fm`: arma y sexo) lo
 * suele decir bien, pero no siempre: en `fce/20160213lliga` el organizador llamó `ef` a la masculina
 * y `em` a la femenina, y en `fce/fm17/fm17f` «fm17» es florete M17 (el sexo es la `f` final).
 *
 * Por eso el código sólo manda cuando los nombres lo confirman (`decidirGeneroClave`):
 *  - sin código reconocible, con el arma del código distinta de la de la prueba, o con la prueba
 *    mixta: no se toca (`sin_codigo`, `mixta`);
 *  - código y fichero dicen lo mismo: `coincide`;
 *  - se contradicen: votan los nombres de pila conocidos de la clasificación (`generoDeNombre`
 *    con el diccionario aprendido de la base). Con al menos `minimo` nombres conocidos (y un
 *    tercio de la clasificación), si el 80 % son del género del código → `corregido` (se usa el
 *    del código y se anota); si el 80 % son del del fichero → `desmentido` (se deja, el código
 *    está mal); si no → `dudoso` (se deja y se avisa).
 */
import type { DatabaseSync } from 'node:sqlite';
import { diccionarioGenero, generoDeNombre, type Genero } from './separar-genero';

export type ArmaClave = 'ESPADA' | 'FLORETE' | 'SABLE';
export type CodigoClave = { arma: ArmaClave; genero: Genero; codigo: string };

const ARMA: Record<string, ArmaClave> = { e: 'ESPADA', f: 'FLORETE', s: 'SABLE' };
const PREFIJO = '(?:tnr|ctoesp|cesp|cto|ce)?';
/** `fm17f`, `em15m`, `sm20`: arma + categoría M-nn (+ sexo). Sin sexo detrás no hay código de sexo. */
const CON_CATEGORIA = new RegExp(`^${PREFIJO}([efs])m\\d{1,2}([mf])?$`);
/** `ef`, `smind`, `sfabs`, `efcati`, `emeq`: arma + sexo + (como mucho) cuatro letras. */
const ARMA_SEXO = new RegExp(`^${PREFIJO}([efs])([mf])([a-z]{0,4})$`);

/**
 * Código de arma y sexo del último segmento de la clave (`engarde:org/evt/compe`,
 * `rfee-wayback:619/CTOESP-EFCATI(2011-05-14)`). Se mira cada trozo separado por `-`, `_` o
 * espacio; si dos trozos dan códigos distintos no hay código.
 */
export function codigoGeneroDeClave(competitionKey: string): CodigoClave | null {
  const sinFuente = competitionKey.replace(/^[a-z-]+:/i, '');
  const ultimo = (sinFuente.split('/').pop() ?? '').replace(/\(.*$/, '').toLowerCase();
  const hallados: CodigoClave[] = [];
  for (const trozo of ultimo.split(/[-_\s.]+/).filter(Boolean)) {
    const c = CON_CATEGORIA.exec(trozo);
    if (c) {
      if (c[2]) hallados.push({ arma: ARMA[c[1]], genero: c[2] === 'm' ? 'M' : 'F', codigo: trozo });
      continue;
    }
    const m = ARMA_SEXO.exec(trozo);
    if (m) hallados.push({ arma: ARMA[m[1]], genero: m[2] === 'm' ? 'M' : 'F', codigo: trozo });
  }
  if (hallados.length === 0) return null;
  const distintos = new Set(hallados.map((h) => `${h.arma}|${h.genero}`));
  return distintos.size === 1 ? hallados[0] : null;
}

export type AccionGeneroClave = 'sin_codigo' | 'mixta' | 'coincide' | 'corregido' | 'desmentido' | 'dudoso';
export type DecisionGeneroClave = {
  accion: AccionGeneroClave;
  /** Género que se usa: el del código sólo con `corregido`. */
  genero: string;
  fichero: string;
  codigo: CodigoClave | null;
  votos: { M: number; F: number; conocidos: number; total: number };
};

export type EntradaGeneroClave = { competitionKey: string; weapon: string; gender: string; nombres: readonly string[] };

export function decidirGeneroClave(
  e: EntradaGeneroClave, dic: ReadonlyMap<string, Genero>, opciones: { minimo?: number; cuota?: number } = {},
): DecisionGeneroClave {
  const minimo = opciones.minimo ?? 3;
  const cuota = opciones.cuota ?? 0.8;
  const votos = { M: 0, F: 0, conocidos: 0, total: e.nombres.length };
  const base = { genero: e.gender, fichero: e.gender, votos };
  const codigo = codigoGeneroDeClave(e.competitionKey);
  if (!codigo || codigo.arma !== e.weapon) return { ...base, accion: 'sin_codigo', codigo };
  if (e.gender !== 'M' && e.gender !== 'F') return { ...base, accion: 'mixta', codigo };
  if (codigo.genero === e.gender) return { ...base, accion: 'coincide', codigo };
  for (const n of new Set(e.nombres)) {
    const g = generoDeNombre(n, dic);
    if (g) votos[g] += 1;
  }
  votos.conocidos = votos.M + votos.F;
  if (votos.conocidos < Math.max(minimo, Math.ceil(votos.total / 3))) return { ...base, accion: 'dudoso', codigo };
  if (votos[codigo.genero] >= cuota * votos.conocidos) return { ...base, accion: 'corregido', genero: codigo.genero, codigo };
  if (votos[e.gender] >= cuota * votos.conocidos) return { ...base, accion: 'desmentido', codigo };
  return { ...base, accion: 'dudoso', codigo };
}

/**
 * Diccionario de nombres de pila con género claro, aprendido de los puestos individuales de
 * pruebas M o F de la base (un voto por nombre publicado y género de prueba).
 */
export function diccionarioGeneroDeBase(db: DatabaseSync): Map<string, Genero> {
  const filas = db.prepare(
    `SELECT DISTINCT r.source_name n, c.gender g FROM sport_result r JOIN sport_competition c ON c.id = r.competition_id
      WHERE c.gender IN ('M','F') AND c.format = 'INDIVIDUAL'`,
  ).iterate() as Iterable<{ n: string | null; g: Genero }>;
  return diccionarioGenero((function* () {
    for (const f of filas) if (f.n) yield { nombre: f.n, genero: f.g };
  })());
}
