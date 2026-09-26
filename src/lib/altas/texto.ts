/**
 * Las piezas de texto del alta desde el ranking: normalizar un nombre para
 * buscarlo y normalizar una licencia para compararla.
 *
 * Viven aquí y no en `desde-ranking.ts` por el mismo motivo por el que existe
 * `src/components/ranking/formato.ts`: ese fichero abre la conexión a la base
 * de datos en cuanto se importa, así que cualquiera que quisiera solo estas dos
 * funciones —una prueba unitaria, por ejemplo— se llevaba por delante el
 * módulo de Neon y reventaba con «Falta DATABASE_URL». Son las dos piezas
 * puras del alta y son justo las que merece la pena probar sueltas.
 */

/**
 * Acentos fuera, para poder buscar «Hector Rivas» y encontrar a «HÉCTOR RIVAS
 * JIMÉNEZ». La fuente sí publica acentos, y quien teclea su propio apellido en
 * un móvil muchas veces no.
 *
 * El equivalente en SQL son las dos listas de abajo, y tienen que decir lo
 * mismo que esto: si se toca una, se toca la otra.
 */
export function sinAcentos(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/** Lo que `translate()` de Postgres tiene que convertir, y en qué. */
export const ACENTOS = 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ';
export const LLANOS = 'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC';

/**
 * Una licencia se compara siempre así: sin espacios y en mayúsculas.
 *
 * Lo que NO hace es quitar guiones ni ceros de más. «DEMO-0001» y «DEMO0001»
 * son licencias distintas, y adivinar equivalencias es la forma de que dos
 * fichas acaben peleándose por la misma clave única.
 */
export function normalizarLicencia(licencia: string): string {
  return licencia.replace(/\s+/g, '').toUpperCase();
}
