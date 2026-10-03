import { getTableColumns, sql, type SQL, type SQLWrapper, type Table } from 'drizzle-orm';

type ValorLista = string | number | boolean | null;
const MAX_BYTES_LISTA = 1_000_000;

/**
 * Una lista ocupa un parámetro, no uno por fila. D1 admite 100 parámetros por
 * sentencia; los identificadores de un calendario pueden superar ese número.
 */
export function enLista(
  columna: SQLWrapper,
  valores: readonly ValorLista[] | SQLWrapper,
): SQL {
  if (!Array.isArray(valores)) {
    return sql`${columna} in ${valores}`;
  }
  if (valores.length === 0) return sql`false`;
  for (const valor of valores) {
    if (
      valor !== null &&
      typeof valor !== 'string' &&
      typeof valor !== 'boolean' &&
      !(typeof valor === 'number' && Number.isFinite(valor))
    ) {
      throw new Error('La lista SQL contiene un valor no válido.');
    }
  }
  const texto = JSON.stringify(valores);
  if (new TextEncoder().encode(texto).byteLength > MAX_BYTES_LISTA) {
    throw new Error('La lista SQL supera el tamaño permitido; divídela en lotes.');
  }
  return sql`${columna} in (select value from json_each(${texto}))`;
}

export function fueraDeLista(
  columna: SQLWrapper,
  valores: readonly ValorLista[] | SQLWrapper,
): SQL {
  return sql`not (${enLista(columna, valores)})`;
}

/** SQLite lower() no transforma por sí solo las mayúsculas con acentos. */
export function contieneSinMayusculas(columna: SQLWrapper, patron: string): SQL {
  let texto: SQL = sql`${columna}`;
  for (const [mayuscula, minuscula] of [
    ['Á', 'á'], ['À', 'à'], ['Â', 'â'], ['Ä', 'ä'], ['Ã', 'ã'],
    ['É', 'é'], ['È', 'è'], ['Ê', 'ê'], ['Ë', 'ë'],
    ['Í', 'í'], ['Ì', 'ì'], ['Î', 'î'], ['Ï', 'ï'],
    ['Ó', 'ó'], ['Ò', 'ò'], ['Ô', 'ô'], ['Ö', 'ö'], ['Õ', 'õ'],
    ['Ú', 'ú'], ['Ù', 'ù'], ['Û', 'û'], ['Ü', 'ü'], ['Ñ', 'ñ'], ['Ç', 'ç'],
  ]) {
    // Literales fijos: no consumen dos parámetros por cada pareja.
    texto = sql`replace(${texto}, ${sql.raw(`'${mayuscula}'`)}, ${sql.raw(`'${minuscula}'`)})`;
  }
  return sql`lower(${texto}) like ${patron.normalize('NFC').toLowerCase()}`;
}

/** Misma equivalencia de acentos que el buscador de nombres, sin translate(). */
export function textoSinAcentos(columna: SQLWrapper): SQL {
  let texto: SQL = sql`${columna}`;
  const acentos = 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ';
  const llanos = 'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC';
  for (let i = 0; i < acentos.length; i += 1) {
    texto = sql`replace(${texto}, ${sql.raw(`'${acentos[i]}'`)}, ${sql.raw(`'${llanos[i]}'`)})`;
  }
  return sql`lower(${texto})`;
}

/** Reloj de la base, en el mismo formato que las columnas Date de D1. */
export const AHORA_SQL = sql`cast(round((julianday('now') - 2440587.5) * 86400000) as integer)`;

/**
 * Presupuesto conservador de parámetros de un INSERT. Cuenta también las
 * columnas con defaults de cliente y reserva margen para ON CONFLICT.
 */
export function lotesDeInsercion<T>(filas: readonly T[], tabla: Table): T[][] {
  const columnas = Object.keys(getTableColumns(tabla)).length;
  if (columnas === 0 || columnas > 90) {
    throw new Error('El esquema requiere un presupuesto de parámetros explícito.');
  }
  const tamano = Math.max(1, Math.floor(90 / columnas));
  const lotes: T[][] = [];
  for (let i = 0; i < filas.length; i += tamano) {
    lotes.push(filas.slice(i, i + tamano));
  }
  return lotes;
}
