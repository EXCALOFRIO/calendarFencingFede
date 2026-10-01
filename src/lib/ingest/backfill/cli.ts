import { formatoBytes, type Ocupacion, type PlanNeon } from './capacidad';
import type { FiltroFilasPlan, ReferenciasHistoricas } from './cobertura-db';
import { ETIQUETA_ESTADO, ESTADOS_HECHO, HECHOS, lecturaDeHecho, resumirCoberturaPorHecho, type FilaCoberturaAgregada } from './estado';
import {
  ejecutarLote,
  LIMITES_POR_DEFECTO,
  type InformeLote,
  type ResultadoTarea,
  type Tarea,
} from './orquestador';
import { planificarDesdeCobertura, type FilaPlan, type PlanBackfill, type UnidadDescubierta } from './plan';

/**
 * Núcleo del comando `npm run backfill`: lectura de argumentos, plan, ejecución
 * acotada e informe. No toca red ni base por sí mismo: todo entra por
 * dependencias, y sin `--aplicar` no se construye ningún ejecutor, así que una
 * simulación no puede hacer peticiones a proveedores ni escribir.
 */

export const TOPE_TAREAS = 200;
export const TOPE_PETICIONES = 2000;
export const TOPE_MINUTOS = 30;
export const TOPE_RELEER = 50;
export const TOPE_UNIDADES = 50;

const FUENTES_UNIDAD = new Set(['fie', 'skermo_rfee', 'skermo_regional', 'engarde', 'enlaces_fie']);
const FUENTE_VALIDA = /^[a-z][a-z0-9_]{1,30}$/;
const TEMPORADA_VALIDA = /^\d{4}(-\d{4})?$/;
const CLAVE_VALIDA = /^[A-Za-z0-9._:/|-]{1,120}$/;

export type OpcionesCli = {
  aplicar: boolean;
  fuentes: string[];
  temporadas: string[];
  maxTareas: number;
  maxPeticiones: number;
  maxMinutos: number;
  maxIntentos: number;
  horasEntreRelecturas: number;
  limiteFilas: number;
  releer: { claves: string[]; temporadas: string[] };
  maxReleer: number;
  unidades: UnidadDescubierta[];
  planNeon: PlanNeon;
};

export const USO_BACKFILL = [
  'Uso: npm run backfill -- [opciones]            (sin --aplicar: simulación, sólo lee la base)',
  '  --aplicar                       ejecuta el lote acotado y escribe (exige migración 0017)',
  '  --fuentes fie,skermo_rfee,...   limita las fuentes del plan',
  '  --temporadas 2027,2022-2023     limita las temporadas del plan',
  `  --max-tareas N                  tareas por lote (por defecto ${LIMITES_POR_DEFECTO.maxTareas}, tope ${TOPE_TAREAS})`,
  `  --max-peticiones N              peticiones externas por lote (por defecto ${LIMITES_POR_DEFECTO.maxPeticiones}, tope ${TOPE_PETICIONES})`,
  `  --max-minutos N                 duración máxima (por defecto ${LIMITES_POR_DEFECTO.maxMs / 60_000}, tope ${TOPE_MINUTOS})`,
  '  --releer clave,...              relee unidades concretas ya completas (p. ej. fie|2027|1478)',
  '  --releer-temporadas 2022-2023   relee unidades completas de esas temporadas, hasta --max-releer',
  `  --max-releer N                  tope de relecturas (por defecto 5, tope ${TOPE_RELEER})`,
  '  --unidad fuente:temporada:clave añade una unidad aún no inventariada (fie, skermo_*, engarde, enlaces_fie)',
  '  --plan-neon desconocido|free    plan de Neon (por defecto desconocido: umbral conservador 0,4 GiB)',
  '  --neon-umbral-gib N --neon-verificado-en AAAA-MM-DD   umbral de un plan verificado por el propietario',
].join('\n');

type ResultadoArgs = { ok: true; opciones: OpcionesCli } | { ok: false; error: string };

function entero(valor: string | undefined, nombre: string, min: number, max: number): number | string {
  const n = Number(valor);
  if (valor === undefined || !Number.isInteger(n) || n < min) return `${nombre} necesita un entero ≥ ${min}`;
  if (n > max) return `${nombre} no puede superar ${max}: el lote está acotado`;
  return n;
}

const lista = (valor: string | undefined): string[] =>
  (valor ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

export function parsearArgsBackfill(argv: readonly string[]): ResultadoArgs {
  const con = new Map<string, string>();
  let aplicar = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--aplicar') {
      aplicar = true;
      continue;
    }
    if (!a.startsWith('--')) return { ok: false, error: `Argumento no reconocido: ${a}` };
    const valor = argv[i + 1];
    if (valor === undefined || valor.startsWith('--')) return { ok: false, error: `${a} necesita un valor` };
    if (con.has(a) && a !== '--unidad') return { ok: false, error: `${a} repetido` };
    con.set(a === '--unidad' && con.has(a) ? `${a}\u0000${i}` : a, valor);
    i += 1;
  }
  const conocidos = new Set([
    '--fuentes',
    '--temporadas',
    '--max-tareas',
    '--max-peticiones',
    '--max-minutos',
    '--releer',
    '--releer-temporadas',
    '--max-releer',
    '--unidad',
    '--plan-neon',
    '--neon-umbral-gib',
    '--neon-verificado-en',
    '--max-intentos',
    '--horas-entre-relecturas',
    '--limite-filas',
  ]);
  for (const k of con.keys()) {
    if (!conocidos.has(k.split('\u0000')[0])) return { ok: false, error: `Opción no reconocida: ${k}` };
  }

  const numeros = {
    maxTareas: entero(con.get('--max-tareas') ?? String(LIMITES_POR_DEFECTO.maxTareas), '--max-tareas', 1, TOPE_TAREAS),
    maxPeticiones: entero(
      con.get('--max-peticiones') ?? String(LIMITES_POR_DEFECTO.maxPeticiones),
      '--max-peticiones',
      1,
      TOPE_PETICIONES,
    ),
    maxMinutos: entero(con.get('--max-minutos') ?? String(LIMITES_POR_DEFECTO.maxMs / 60_000), '--max-minutos', 1, TOPE_MINUTOS),
    maxReleer: entero(con.get('--max-releer') ?? '5', '--max-releer', 0, TOPE_RELEER),
    maxIntentos: entero(con.get('--max-intentos') ?? '5', '--max-intentos', 1, 20),
    horas: entero(con.get('--horas-entre-relecturas') ?? '12', '--horas-entre-relecturas', 1, 24 * 14),
    limiteFilas: entero(con.get('--limite-filas') ?? '5000', '--limite-filas', 1, 20_000),
  };
  for (const v of Object.values(numeros)) if (typeof v === 'string') return { ok: false, error: v };

  const fuentes = lista(con.get('--fuentes'));
  for (const f of fuentes) if (!FUENTE_VALIDA.test(f)) return { ok: false, error: `Fuente no válida: ${f}` };
  const temporadas = lista(con.get('--temporadas'));
  const temporadasReleer = lista(con.get('--releer-temporadas'));
  for (const t of [...temporadas, ...temporadasReleer]) {
    if (!TEMPORADA_VALIDA.test(t)) return { ok: false, error: `Temporada no válida: ${t}` };
  }
  const claves = lista(con.get('--releer'));
  for (const c of claves) if (!CLAVE_VALIDA.test(c)) return { ok: false, error: `Clave de relectura no válida: ${c}` };

  const unidades: UnidadDescubierta[] = [];
  for (const [k, v] of con) {
    if (k.split('\u0000')[0] !== '--unidad') continue;
    const [fuente, season, ...resto] = v.split(':');
    const competitionKey = resto.join(':');
    if (!fuente || !FUENTES_UNIDAD.has(fuente)) {
      return { ok: false, error: `--unidad admite fie, skermo_rfee, skermo_regional, engarde o enlaces_fie (recibido: ${fuente ?? ''})` };
    }
    if (!season || !TEMPORADA_VALIDA.test(season) || !competitionKey || !CLAVE_VALIDA.test(competitionKey)) {
      return { ok: false, error: `--unidad ${v} no tiene la forma fuente:temporada:clave` };
    }
    unidades.push({ fuente, season, competitionKey, sourceUrl: null });
  }
  if (unidades.length > TOPE_UNIDADES) return { ok: false, error: `Máximo ${TOPE_UNIDADES} unidades con --unidad` };

  let planNeon: PlanNeon = { tipo: 'desconocido' };
  const plan = con.get('--plan-neon');
  if (plan !== undefined && plan !== 'desconocido' && plan !== 'free') {
    return { ok: false, error: '--plan-neon admite desconocido o free; un plan verificado se indica con --neon-umbral-gib' };
  }
  if (plan === 'free') planNeon = { tipo: 'free' };
  const gib = con.get('--neon-umbral-gib');
  const verificado = con.get('--neon-verificado-en');
  if (gib !== undefined || verificado !== undefined) {
    const g = Number(gib);
    if (!Number.isFinite(g) || g <= 0 || !verificado || !/^\d{4}-\d{2}-\d{2}$/.test(verificado)) {
      return { ok: false, error: 'Un plan verificado necesita --neon-umbral-gib N y --neon-verificado-en AAAA-MM-DD' };
    }
    planNeon = { tipo: 'otro', umbralVerificadoBytes: Math.round(g * 1024 ** 3), verificadoEn: verificado };
  }

  return {
    ok: true,
    opciones: {
      aplicar,
      fuentes,
      temporadas,
      maxTareas: numeros.maxTareas as number,
      maxPeticiones: numeros.maxPeticiones as number,
      maxMinutos: numeros.maxMinutos as number,
      maxIntentos: numeros.maxIntentos as number,
      horasEntreRelecturas: numeros.horas as number,
      limiteFilas: numeros.limiteFilas as number,
      releer: { claves, temporadas: temporadasReleer },
      maxReleer: numeros.maxReleer as number,
      unidades,
      planNeon,
    },
  };
}

export type DepsBackfillCli = {
  leerFilas: (filtro: FiltroFilasPlan) => Promise<{ filas: FilaPlan[]; truncado: boolean }>;
  leerAgregada: () => Promise<FilaCoberturaAgregada[]>;
  leerReferencias: () => Promise<ReferenciasHistoricas>;
  esquema: () => Promise<{ identidad: boolean }>;
  categoriasAmpliadas: () => Promise<boolean>;
  medir: () => Promise<Ocupacion>;
  /** Sólo se invoca con `--aplicar`: aquí es donde se construyen los clientes de red y de escritura. */
  crearEjecutor: () => Promise<(t: Tarea) => Promise<ResultadoTarea>>;
  ahora: () => Date;
  dormir: (ms: number) => Promise<void>;
};

export type ResultadoCli = {
  codigo: number;
  lineas: string[];
  plan: PlanBackfill | null;
  informe: InformeLote | null;
};

const CODIGO_ESQUEMA = 2;
const CODIGO_CAPACIDAD = 3;
const CODIGO_LIMITE_REMOTO = 4;

export async function ejecutarBackfillCli(deps: DepsBackfillCli, o: OpcionesCli): Promise<ResultadoCli> {
  const lineas: string[] = [];
  const salida = (codigo: number, plan: PlanBackfill | null = null, informe: InformeLote | null = null): ResultadoCli => ({
    codigo,
    lineas,
    plan,
    informe,
  });

  lineas.push(
    o.aplicar
      ? 'BACKFILL HISTÓRICO · modo APLICAR (lote acotado, escribe en la base)'
      : 'BACKFILL HISTÓRICO · SIMULACIÓN: no se hace ninguna petición a proveedores ni se escribe nada',
  );

  // Sin las tablas de la 0017 no hay cobertura que leer ni dónde escribir: se dice y se mide, sin consultar lo inexistente.
  if (!(await deps.esquema()).identidad) {
    lineas.push('El esquema deportivo (migración 0017) no está aplicado: no hay cobertura que planificar y no se escribió nada.');
    try {
      const o = await deps.medir();
      lineas.push(`Ocupación lógica actual: ${formatoBytes(o.logicoBytes)} (medida con SELECT de sólo lectura)`);
    } catch {
      lineas.push('No se pudo medir la ocupación.');
    }
    return salida(CODIGO_ESQUEMA);
  }

  const { filas, truncado } = await deps.leerFilas({
    fuentes: o.fuentes.length ? o.fuentes : undefined,
    temporadas: o.temporadas.length ? o.temporadas : undefined,
    limite: o.limiteFilas,
  });
  const ahora = deps.ahora();
  const plan = planificarDesdeCobertura(filas, o.unidades, {
    ahora,
    categoriasAmpliadas: await deps.categoriasAmpliadas(),
    releer: o.releer.claves.length || o.releer.temporadas.length ? { claves: o.releer.claves, temporadas: o.releer.temporadas } : undefined,
    maxReleer: o.maxReleer,
    maxIntentos: o.maxIntentos,
    horasEntreRelecturas: o.horasEntreRelecturas,
  });

  const porMotivo = new Map<string, number>();
  for (const t of plan.tareas) porMotivo.set(t.motivo, (porMotivo.get(t.motivo) ?? 0) + 1);
  lineas.push(
    `Plan: ${plan.tareas.length} unidades [${[...porMotivo].map(([k, n]) => `${k}=${n}`).join(' ') || 'ninguna'}] · ` +
      `omitidas: completas=${plan.omitidas.completas} agotadas=${plan.omitidas.agotadas.length} ` +
      `en_revision=${plan.omitidas.enRevision.length} espera_0019=${plan.omitidas.esperaCategorias.length} ` +
      `releer_diferidas=${plan.omitidas.releerDiferidas.length}`,
  );
  if (truncado) {
    lineas.push(`AVISO: el listado de cobertura se cortó en ${o.limiteFilas} filas; lo que no se ve no se da por completo.`);
  }
  if (plan.omitidas.agotadas.length > 0) {
    lineas.push(`Con reintentos agotados (requieren revisión): ${plan.omitidas.agotadas.slice(0, 10).join(', ')}`);
  }

  const agregada = await deps.leerAgregada();
  const cobertura = resumirCoberturaPorHecho(agregada);
  for (const h of HECHOS) {
    const r = cobertura[h];
    if (r.unidades === 0) continue;
    const estados = ESTADOS_HECHO.filter((e) => r.porEstado[e] > 0)
      .map((e) => `${ETIQUETA_ESTADO[e]}=${r.porEstado[e]}`)
      .join(' ');
    lineas.push(
      `Cobertura ${h}: unidades=${r.unidades} publicado=${r.publicado} importado=${r.importado} [${estados}] ` +
        `lectura=${lecturaDeHecho(r)} (sin inventario completo no se acredita «completo»)`,
    );
  }

  const refs = await deps.leerReferencias();
  lineas.push(
    refs.tablaDisponible
      ? `Referencias de inscripción FIE (0018): históricas sin referencia=${refs.historicasSinReferencia} de ${refs.inscripcionesFieHistoricas} ` +
          `históricas (con referencia en total=${refs.conReferencia}); se cuentan aparte y NO se hidratan desde este comando`
      : 'Referencias de inscripción FIE: la migración 0018 no está aplicada; no hay nada que contar',
  );

  const inicio = Date.now();
  const informe = await ejecutarLote({
    tareas: plan.tareas,
    ejecutar: o.aplicar
      ? await deps.crearEjecutor()
      : async () => {
          throw new Error('Una simulación no ejecuta tareas');
        },
    limites: {
      ...LIMITES_POR_DEFECTO,
      maxTareas: o.maxTareas,
      maxPeticiones: o.maxPeticiones,
      maxMs: o.maxMinutos * 60_000,
    },
    aplicar: o.aplicar,
    ahora: () => Date.now() - inicio,
    dormir: deps.dormir,
    capacidad: { plan: o.planNeon, medir: deps.medir },
  });

  lineas.push(
    `Lote ${informe.modo}: ejecutadas=${informe.ejecutadas.length} pendientes=${informe.pendientes.length} ` +
      `peticiones=${informe.peticiones} parada=${informe.parada ?? 'ninguna'}` +
      (informe.duplicadas.length ? ` duplicadas_omitidas=${informe.duplicadas.length}` : ''),
  );
  if (!o.aplicar) {
    lineas.push(`Crecimiento proyectado del lote (supuesto, no medido): ${formatoBytes(informe.proyectadoBytes)}`);
    for (const t of informe.pendientes.slice(0, o.maxTareas)) lineas.push(`  - ${t.clave} [${t.motivo}${t.fase === 'complementaria' ? ', complementaria' : ''}]`);
  }
  for (const e of informe.ejecutadas) {
    lineas.push(
      `  ${e.tarea.clave}: ${e.resultado.estado}` +
        (e.reintentos ? ` reintentos=${e.reintentos}` : '') +
        (e.resultado.mensaje ? ` · ${e.resultado.mensaje.slice(0, 160)}` : ''),
    );
  }

  const cap = informe.capacidad;
  if (cap) {
    lineas.push(`Capacidad: ${cap.decision.mensaje}`);
    if (cap.antes) lineas.push(`  antes: ${formatoBytes(cap.antes.logicoBytes)} lógicos`);
    if (cap.despues && cap.diferencia) {
      lineas.push(`  después: ${formatoBytes(cap.despues.logicoBytes)} lógicos (Δ ${formatoBytes(cap.diferencia.logicoDeltaBytes)})`);
      for (const t of cap.diferencia.porTabla.filter((x) => x.totalDelta !== 0).sort((a, b) => b.totalDelta - a.totalDelta).slice(0, 8)) {
        lineas.push(`    ${t.tabla}: tabla Δ${t.tablaDelta} B, índices Δ${t.indicesDelta} B, filas Δ${t.filasDelta}`);
      }
    }
  }

  if (informe.parada === 'esquema_no_aplicado') return salida(CODIGO_ESQUEMA, plan, informe);
  if (informe.parada === 'capacidad') return salida(CODIGO_CAPACIDAD, plan, informe);
  if (informe.parada === 'limite_remoto') return salida(CODIGO_LIMITE_REMOTO, plan, informe);
  return salida(0, plan, informe);
}
