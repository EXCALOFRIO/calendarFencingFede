/**
 * Límites de la ingesta automática de resultados. Todos se pueden cambiar con
 * variables del Worker (`wrangler.jsonc` → `vars`) sin desplegar código nuevo.
 *
 * Los valores por defecto están pensados para el plan Workers Paid de 5 $:
 *  - una pasada por hora (fuera de 03:00-07:59 UTC, donde corren los diarios);
 *  - ≤45 s de reloj, ≤40 peticiones a fuentes y ≤1.500 filas sport_* por pasada;
 *  - ≤6.000 filas y ≤48 MiB de libro de capacidad por día;
 *  - IA sólo para PDF que el lector determinista no lee entero: ≤4 llamadas y
 *    ≤6.000 neuronas estimadas al día (la capa gratuita son 10.000 al día).
 */
export type ConfigResultadosAuto = {
  habilitado: boolean;
  iaHabilitada: boolean;
  maxMs: number;
  maxPeticiones: number;
  maxFilasPasada: number;
  maxFilasDia: number;
  maxBytesLedgerDia: number;
  /** Margen mínimo que debe quedar en el libro (8 GiB menos lo contabilizado) para escribir. */
  margenLedgerMinBytes: number;
  maxUnidadesPasada: number;
  iaMaxLlamadasDia: number;
  iaMaxNeuronasDia: number;
  /** Tope del texto de PDF que se envía a la IA (caracteres). */
  iaMaxCaracteres: number;
  /** Horas tras la fecha de la prueba antes de pedir resultados. */
  esperaHoras: number;
  /** Días tras la fecha de la prueba durante los que se sigue mirando. */
  ventanaDias: number;
  maxPdfBytes: number;
  maxPdfPaginas: number;
};

const MIB = 1024 * 1024;

export const POR_DEFECTO: ConfigResultadosAuto = Object.freeze({
  habilitado: false,
  iaHabilitada: false,
  maxMs: 45_000,
  maxPeticiones: 40,
  maxFilasPasada: 1_500,
  maxFilasDia: 6_000,
  maxBytesLedgerDia: 48 * MIB,
  margenLedgerMinBytes: 512 * MIB,
  maxUnidadesPasada: 6,
  iaMaxLlamadasDia: 4,
  iaMaxNeuronasDia: 6_000,
  iaMaxCaracteres: 60_000,
  esperaHoras: 20,
  ventanaDias: 21,
  maxPdfBytes: 4 * MIB,
  // National ranking events print 70-90 pages; the Worker CPU limit (cpu_ms) is the real cap.
  maxPdfPaginas: 100,
});

type Env = Readonly<Record<string, string | undefined>>;

function entero(env: Env, nombre: string, defecto: number, min: number, max: number): number {
  const v = env[nombre];
  if (v === undefined || v.trim() === '') return defecto;
  const n = Number(v);
  if (!/^\d+$/.test(v.trim()) || !Number.isSafeInteger(n) || n < min || n > max) return defecto;
  return n;
}

export function leerConfigResultadosAuto(env: Env = process.env): ConfigResultadosAuto {
  const p = POR_DEFECTO;
  return {
    habilitado: env.RESULTADOS_AUTO_ENABLED === 'true',
    // Sin interruptor propio la IA sigue al de la extracción de circulares.
    iaHabilitada: (env.RESULTADOS_AUTO_IA_ENABLED ?? env.AI_EXTRACTION_ENABLED) === 'true',
    maxMs: entero(env, 'RESULTADOS_AUTO_MAX_MS', p.maxMs, 5_000, 600_000),
    maxPeticiones: entero(env, 'RESULTADOS_AUTO_MAX_PETICIONES', p.maxPeticiones, 1, 500),
    maxFilasPasada: entero(env, 'RESULTADOS_AUTO_MAX_FILAS_PASADA', p.maxFilasPasada, 50, 20_000),
    maxFilasDia: entero(env, 'RESULTADOS_AUTO_MAX_FILAS_DIA', p.maxFilasDia, 50, 200_000),
    maxBytesLedgerDia: entero(env, 'RESULTADOS_AUTO_MAX_BYTES_DIA', p.maxBytesLedgerDia, MIB, 2048 * MIB),
    margenLedgerMinBytes: entero(env, 'RESULTADOS_AUTO_MARGEN_MIN_BYTES', p.margenLedgerMinBytes, 16 * MIB, 4096 * MIB),
    maxUnidadesPasada: entero(env, 'RESULTADOS_AUTO_MAX_UNIDADES', p.maxUnidadesPasada, 1, 100),
    iaMaxLlamadasDia: entero(env, 'RESULTADOS_AUTO_IA_MAX_LLAMADAS_DIA', p.iaMaxLlamadasDia, 0, 200),
    iaMaxNeuronasDia: entero(env, 'RESULTADOS_AUTO_IA_MAX_NEURONAS_DIA', p.iaMaxNeuronasDia, 0, 1_000_000),
    iaMaxCaracteres: entero(env, 'RESULTADOS_AUTO_IA_MAX_CARACTERES', p.iaMaxCaracteres, 1_000, 400_000),
    esperaHoras: entero(env, 'RESULTADOS_AUTO_ESPERA_HORAS', p.esperaHoras, 0, 96),
    ventanaDias: entero(env, 'RESULTADOS_AUTO_VENTANA_DIAS', p.ventanaDias, 1, 120),
    maxPdfBytes: p.maxPdfBytes,
    maxPdfPaginas: p.maxPdfPaginas,
  };
}
