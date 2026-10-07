/**
 * Invalidación: sube la época de las dependencias en `cache_epoch` (0016). La
 * versión de las claves cambia y, como mucho `ttlMs` de `versiones.ts`
 * después (30 s), ningún isolate vuelve a usar las entradas viejas; hasta que
 * se recalculan se sirve la última conocida (stale-while-revalidate).
 *
 * Las escrituras en `sport_*` no necesitan llamarla: el ledger ya cambia la
 * versión de `deporte`. Se llama igualmente tras cada ingesta para cubrir el
 * calendario y los rankings, que no tienen ledger.
 */
import { DEPENDENCIAS, type Dependencia, type Ejecutar, type Versiones } from './versiones';

export const SQL_INVALIDAR = `INSERT INTO cache_epoch (namespace, epoch, updated_at)
  SELECT value, 1, ? FROM json_each(?)
  WHERE true
  ON CONFLICT (namespace) DO UPDATE SET epoch = epoch + 1, updated_at = excluded.updated_at`;

/**
 * Qué invalida cada fuente de `runIngest` (y `resultados_auto`, la ingesta
 * automática de resultados). Una fuente desconocida lo invalida todo.
 */
export const DEPENDENCIAS_POR_FUENTE: Readonly<Record<string, readonly Dependencia[]>> = {
  // Solo escribe sport_* y lo que cuelga de ellas; el calendario que muestra resultados depende de `deporte`.
  resultados_auto: ['deporte'],
  fie: ['calendario', 'deporte'],
  efc: ['calendario', 'deporte'],
  skermo_rfee: ['calendario', 'deporte'],
  skermo_regional: ['calendario'],
  rfee_wp: ['calendario'],
  skermo_ranking: ['ranking', 'deporte'],
  fie_tiradores: ['ranking-fie', 'deporte'],
};

export function dependenciasDeFuente(fuente: string): readonly Dependencia[] {
  return DEPENDENCIAS_POR_FUENTE[fuente] ?? DEPENDENCIAS;
}

export async function invalidarCache(
  deps: readonly Dependencia[],
  { ejecutar, versiones, ahora = Date.now }: { ejecutar: Ejecutar; versiones?: Versiones; ahora?: () => number },
): Promise<void> {
  const validas = [...new Set(deps)].filter((d) => (DEPENDENCIAS as readonly string[]).includes(d));
  if (validas.length === 0) return;
  await ejecutar(SQL_INVALIDAR, [ahora(), JSON.stringify(validas)]);
  versiones?.olvidar();
}
