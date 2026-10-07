/**
 * Versiones de los datos compartidos. Cada clave de caché lleva la versión de
 * las dependencias de su valor; cuando una cambia, la clave cambia y la
 * entrada vieja deja de usarse en todos los centros de datos a la vez.
 *
 * - `deporte` (perfiles, pruebas, cara a cara, Explorar): la marca la pone
 *   sola cualquier escritura en las tablas `sport_*`, porque sus triggers
 *   suben `sport_capacity_ledger.accounted_bytes`, que nunca baja. Así no
 *   depende de que cada carga se acuerde de invalidar. Más la época explícita.
 * - `calendario`, `ranking` (RFEE), `ranking-fie`: tablas sin ledger; sólo la
 *   época explícita de `cache_epoch` (0016), que sube `invalidarCache`.
 *
 * Se lee una vez cada `ttlMs` por isolate (por defecto 30 s): 2-5 filas, no
 * una consulta por petición. Sin la tabla `cache_epoch` sigue funcionando con
 * el ledger, y lo demás caduca por tiempo.
 */
export const DEPENDENCIAS = ['deporte', 'calendario', 'ranking', 'ranking-fie'] as const;
export type Dependencia = (typeof DEPENDENCIAS)[number];

export type Epocas = Partial<Record<Dependencia | 'ledger', number>>;
export type FuenteEpocas = () => Promise<Epocas>;
export type Ejecutar = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const CON_TABLA = `SELECT 'ledger' AS n, accounted_bytes AS e FROM sport_capacity_ledger WHERE key = 'global'
  UNION ALL SELECT namespace, epoch FROM cache_epoch`;
const SIN_TABLA = `SELECT 'ledger' AS n, accounted_bytes AS e FROM sport_capacity_ledger WHERE key = 'global'`;

export function fuenteEpocasD1(ejecutar: Ejecutar, ahora: () => number = Date.now): FuenteEpocas {
  let sinTablaHasta = 0;
  return async () => {
    let filas: Record<string, unknown>[];
    if (ahora() < sinTablaHasta) {
      filas = await ejecutar(SIN_TABLA);
    } else {
      try {
        filas = await ejecutar(CON_TABLA);
      } catch (error) {
        if (!/no such table/i.test(String(error instanceof Error ? error.message : error))) throw error;
        sinTablaHasta = ahora() + 60_000;
        filas = await ejecutar(SIN_TABLA);
      }
    }
    const epocas: Epocas = {};
    for (const f of filas) {
      const n = String(f.n);
      const e = Number(f.e);
      if (Number.isSafeInteger(e) && (n === 'ledger' || (DEPENDENCIAS as readonly string[]).includes(n))) {
        epocas[n as Dependencia | 'ledger'] = e;
      }
    }
    return epocas;
  };
}

const INICIAL: Record<Dependencia, string> = { deporte: 'd', calendario: 'c', ranking: 'r', 'ranking-fie': 'f' };

export function versionDe(epocas: Epocas, deps: readonly Dependencia[]): string {
  if (deps.length === 0) return 'fija';
  return [...new Set(deps)].sort().map((d) =>
    d === 'deporte' ? `d${epocas.ledger ?? 0}.${epocas.deporte ?? 0}` : `${INICIAL[d]}${epocas[d] ?? 0}`,
  ).join('-');
}

export type Versiones = {
  de(deps: readonly Dependencia[]): Promise<string>;
  /** Olvida lo memorizado: la siguiente lectura va a la base (tras invalidar en este isolate). */
  olvidar(): void;
};

export function crearVersiones({ fuente, ttlMs = 30_000, ahora = Date.now }: { fuente: FuenteEpocas; ttlMs?: number; ahora?: () => number }): Versiones {
  let memo: { hasta: number; epocas: Promise<Epocas> } | null = null;
  const epocas = () => {
    if (memo && memo.hasta > ahora()) return memo.epocas;
    const actual = { hasta: ahora() + ttlMs, epocas: fuente() };
    memo = actual;
    // Un fallo no se recuerda: la siguiente petición vuelve a intentarlo.
    actual.epocas.catch(() => { if (memo === actual) memo = null; });
    return actual.epocas;
  };
  return {
    async de(deps) {
      return versionDe(await epocas(), deps);
    },
    olvidar() {
      memo = null;
    },
  };
}
