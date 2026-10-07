/**
 * Una pasada de la ingesta automática de resultados (cron `/api/cron/resultados`).
 *
 *  1. Interruptor, migración 0017, topes del día y margen del libro de capacidad: si queda poco,
 *     no escribe, deja una entrada `ledger_bajo` en la cola de revisión y responde ok:false.
 *  2. Lease global de escritura sport_* (el mismo del incremento deportivo y del lote remoto).
 *  3. Descubre pruebas en el catálogo FIE y en el índice de resultados de Skermo (RFEE), como
 *     mucho una lectura de índice por pasada.
 *  4. Procesa las unidades que tocan (las más antiguas primero) dentro del tiempo, las peticiones
 *     y las filas de la pasada. Una fuente igual a la ya escrita (misma huella) no escribe nada.
 *  5. Libera el lease y suma el consumo del día.
 *
 * Idempotente y reanudable: todo se escribe por claves naturales y una unidad cortada a medias se
 * vuelve a leer entera en la siguiente pasada sin duplicar.
 */
import type { Db } from '@/db';
import { reclamarSportLease, type SportLease } from '../sport-incremental/lease';
import { temporadasActuales } from '../sport-incremental/policy';
import type { HechosPrueba } from '../hechos/formato';
import { jsonCanonico, sha256Texto, estadoCobertura, mejorEstado } from '../hechos/reglas-carga';
import { docIdDeUrl } from '../sources/rfee-pdf/lectura';
import type { SkermoResultsIndexRow } from '../sources/skermo-results';
import { casarConSkermo, nombresDeHechos } from '../hechos/engarde';
import type { PruebaFecha } from '../hechos/fechas-catalogo';
import type { ConfigResultadosAuto } from './config';
import { planCobertura, planCoberturaDocumento, planificarCarga, type PlanCarga } from './cargar';
import { crearBaseResultados, type BaseResultados, type Sentencia } from './sql';
import { crearRed, RedDetenida, type Red, type Transporte } from './red';
import {
  enlaceEngarde, leerCatalogoFie, leerClasificacionSkermo, leerEngardeDeSkermo, leerIndiceSkermo, leerPdfAuto,
  leerPruebaFieAuto, resolverDocIdD1, type FilaCatalogoPdf, type LecturaPdfAuto,
} from './fuentes';
import {
  consumoDelDia, DIA, HORA, leerUnidad, margenLedger, migracionAplicada, NUNCA, sentenciaCierre, sentenciaRevision,
  sentenciaAjusteConsumo, sentenciasAlta, sentenciasConsumo, tablaExiste, unidadesPendientes, type EstadoUnidad, type Unidad,
} from './estado';
import { sentenciasEventos, sentenciasIndiceExplorar, sentenciasPerfil } from './posteriores';
import { extraerPdfConIa, type ClienteIa } from './ia';
import { sanearAsaltos } from './validacion-estricta';

export type DepsResultadosAuto = {
  db: Db;
  config: ConfigResultadosAuto;
  presupuestoBytes: number;
  ahora?: () => number;
  transporte?: Transporte;
  clienteIa?: () => ClienteIa | null;
  registro?: Pick<Console, 'log' | 'warn'>;
  uuid?: () => string;
  /** Pausa mínima entre peticiones (ms). En pruebas, 0. */
  pausaMs?: number;
};

export type ResumenResultadosAuto = {
  ok: boolean;
  status: string;
  unidades: { procesadas: number; escritas: number; sinCambios: number; esperando: number; revision: number; errores: number; descubiertas: number };
  filas: number;
  bytesLedger: number;
  peticiones: number;
  ia: { llamadas: number; neuronas: number; aceptadas: number };
  eventos: number;
  detalle: { clave: string; estado: string; motivo: string | null; filas: number }[];
};

class Diferir extends Error { constructor(public readonly motivo: string) { super(motivo); } }
class Parar extends Error { constructor(public readonly motivo: string) { super(motivo); } }

/** Huella de lo que se escribiría: sin notas ni huella de la fuente, que no llegan a la base. */
export function huellaHechos(hechos: readonly HechosPrueba[]): string {
  return sha256Texto(jsonCanonico(hechos.map((h) => ({ ...h, sourceSha256: '', status: { ...h.status, notes: [] } }))));
}

const BYTES_POR_FILA = 1_024 + 4 * 420;

export async function ejecutarResultadosAuto(d: DepsResultadosAuto): Promise<ResumenResultadosAuto> {
  const cfg = d.config;
  const reloj = d.ahora ?? Date.now;
  const inicio = Math.floor(reloj());
  const uuid = d.uuid ?? (() => crypto.randomUUID());
  const registro = d.registro ?? console;
  const r: ResumenResultadosAuto = {
    ok: true, status: 'deshabilitado', filas: 0, bytesLedger: 0, peticiones: 0, eventos: 0,
    unidades: { procesadas: 0, escritas: 0, sinCambios: 0, esperando: 0, revision: 0, errores: 0, descubiertas: 0 },
    ia: { llamadas: 0, neuronas: 0, aceptadas: 0 }, detalle: [],
  };
  if (!cfg.habilitado) return r;

  let filasPasada = 0;
  const presupuesto = {
    comprobar: () => { if (reloj() - inicio > cfg.maxMs) throw new Parar('tiempo'); },
    reservarFilas: (n: number) => {
      if (filasPasada > 0 && filasPasada + n > cfg.maxFilasPasada) throw new Diferir('tope_filas_pasada');
      filasPasada += n;
    },
  };
  const lectura = crearBaseResultados(d.db, null, presupuesto);
  if (!(await migracionAplicada(lectura))) return { ...r, ok: false, status: 'migracion_pendiente' };
  const consumo = await consumoDelDia(lectura, inicio);
  if (consumo.filas >= cfg.maxFilasDia || consumo.bytes_ledger >= cfg.maxBytesLedgerDia) return { ...r, status: 'tope_diario' };
  const ledger0 = await margenLedger(lectura, d.presupuestoBytes);
  if (ledger0.bloqueado || ledger0.margen < cfg.margenLedgerMinBytes) {
    registro.warn(`[resultados-auto] libro de capacidad ${ledger0.bloqueado ? 'bloqueado' : 'casi lleno'}: margen ${ledger0.margen} bytes; no se escribe.`);
    await lectura.escribirPropias([sentenciaRevision('global', 'ledger_bajo', { margen: ledger0.margen, contabilizado: ledger0.contabilizado,
      minimo: cfg.margenLedgerMinBytes, bloqueado: ledger0.bloqueado, escrito: false }, inicio)]);
    return { ...r, ok: false, status: 'ledger_bajo' };
  }

  let lease: SportLease | null = null;
  try {
    lease = await reclamarSportLease(d.db);
  } catch {
    return { ...r, ok: false, status: 'esquema_deportivo' };
  }
  if (!lease) return { ...r, status: 'ocupado' };
  const base = crearBaseResultados(d.db, lease, presupuesto);
  const red = crearRed({ maxPeticiones: cfg.maxPeticiones, restanteMs: () => cfg.maxMs - (reloj() - inicio), transporte: d.transporte, pausaMs: d.pausaMs });
  const hoy = new Date(inicio).toISOString().slice(0, 10);
  const conPerfil = await tablaExiste(lectura, 'perfil_deportista');
  const conExplorar = await tablaExiste(lectura, 'explorar_persona');
  const iaCliente = cfg.iaHabilitada && d.clienteIa ? d.clienteIa() : null;
  let iaLlamadasHoy = consumo.ia_llamadas;
  let iaNeuronasHoy = consumo.ia_neuronas;
  const filasDia = () => consumo.filas + base.filasEscritas;
  r.status = 'ok';

  const ctx: Ctx = {
    cfg, base, lectura, red, hoy, ahora: inicio, reloj, uuid, conPerfil, conExplorar, presupuestoBytes: d.presupuestoBytes,
    filasDia, resumen: r,
    ia: iaCliente ? {
      cliente: iaCliente,
      puede: () => iaLlamadasHoy < cfg.iaMaxLlamadasDia && iaNeuronasHoy < cfg.iaMaxNeuronasDia,
      disponibles: () => cfg.iaMaxNeuronasDia - iaNeuronasHoy,
      // La llamada y el peor caso de neuronas se apuntan en D1 antes de llamar; tras la respuesta
      // solo se corrige la diferencia. El resumen final ya no vuelve a sumar la IA.
      reservar: async (peorCaso: number) => {
        try {
          await lectura.escribirPropias(sentenciasConsumo(inicio, { ia_llamadas: 1, ia_neuronas: peorCaso }));
        } catch {
          return false;
        }
        iaLlamadasHoy += 1; iaNeuronasHoy += peorCaso; r.ia.llamadas += 1; r.ia.neuronas += peorCaso;
        return true;
      },
      ajustar: async (reservadas: number, reales: number) => {
        const delta = Math.trunc(reales) - reservadas;
        if (delta === 0) return;
        iaNeuronasHoy += delta; r.ia.neuronas += delta;
        try {
          await lectura.escribirPropias([sentenciaAjusteConsumo(inicio, 'ia_neuronas', delta)]);
        } catch { /* queda apuntado el peor caso: de más, nunca de menos */ }
      },
    } : null,
  };
  try {
    await anclarCursorAvisos(lectura, inicio, registro);
    try {
      await descubrir(ctx);
    } catch (e) {
      if (e instanceof RedDetenida || e instanceof Parar) throw e;
      registro.warn(`[resultados-auto] índice no leído: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    }
    const unidades = await unidadesPendientes(lectura, inicio, cfg.maxUnidadesPasada * 3);
    for (const u of unidades) {
      if (r.unidades.procesadas >= cfg.maxUnidadesPasada) break;
      if (reloj() - inicio > cfg.maxMs - 8_000) { r.status = 'tiempo'; break; }
      if (filasDia() >= cfg.maxFilasDia) { r.status = 'tope_diario'; break; }
      const res = await procesar(ctx, u);
      if (res === 'parar') break;
    }
  } catch (e) {
    if (e instanceof RedDetenida) r.status = `red_${e.motivo}`;
    else if (e instanceof Parar) r.status = e.motivo;
    else { r.ok = false; r.status = 'error'; registro.warn(`[resultados-auto] ${String((e as Error)?.message ?? e).slice(0, 160)}`); }
  } finally {
    try { await lease.liberar(); } catch { /* the lease expires by itself in 120 s */ }
    r.filas = base.filasEscritas;
    r.peticiones = red.peticiones;
    try {
      const ledger1 = await margenLedger(lectura, d.presupuestoBytes);
      r.bytesLedger = Math.max(0, ledger1.contabilizado - ledger0.contabilizado);
      await lectura.escribirPropias(sentenciasConsumo(inicio, {
        filas: r.filas, bytes_ledger: r.bytesLedger, peticiones: r.peticiones,
      }));
      await lectura.escribirPropias([{ sql: `delete from resultado_auto_evento where creado_en < ?`, params: [inicio - 120 * DIA] }]);
    } catch { /* counters are best effort; caps are re-read next pass */ }
  }
  return r;
}

/**
 * The notifier starts its cursor at max(id) the first time it runs, and it runs after the pass
 * (trasIngesta). Without a cursor in place before this pass writes, the events of the first pass
 * that writes anything would be skipped and never notified.
 */
export async function anclarCursorAvisos(lectura: BaseResultados, ahora: number, registro: Pick<Console, 'warn'>) {
  try {
    if (!(await tablaExiste(lectura, 'notificacion_cursor'))) return;
    await lectura.escribirPropias([{
      sql: `insert into notificacion_cursor (fuente, ultimo_id, actualizado_en)
        select 'resultado_auto_evento', coalesce(max(id), 0), ? from resultado_auto_evento where true
        on conflict (fuente) do nothing`,
      params: [ahora],
    }]);
  } catch (e) {
    registro.warn(`[resultados-auto] cursor de avisos no anclado: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
  }
}

type Ctx = {
  cfg: ConfigResultadosAuto;
  base: BaseResultados;
  lectura: BaseResultados;
  red: Red;
  hoy: string;
  ahora: number;
  reloj: () => number;
  uuid: () => string;
  conPerfil: boolean;
  conExplorar: boolean;
  presupuestoBytes: number;
  filasDia: () => number;
  resumen: ResumenResultadosAuto;
  ia: {
    cliente: ClienteIa; puede: () => boolean; disponibles: () => number;
    reservar: (peorCaso: number) => Promise<boolean>; ajustar: (reservadas: number, reales: number) => Promise<void>;
  } | null;
};

const msDe = (fecha: string) => Date.parse(`${fecha}T00:00:00Z`);

/** Cuándo volver a mirar una unidad que todavía no tiene todo publicado. */
export function proximaEspera(fecha: string | null, ahora: number, cfg: Pick<ConfigResultadosAuto, 'ventanaDias'>): number | null {
  const f = fecha ? msDe(fecha) : ahora;
  if (ahora > f + cfg.ventanaDias * DIA) return null;
  if (ahora < f + 2 * DIA) return ahora + HORA;
  if (ahora < f + 7 * DIA) return ahora + 6 * HORA;
  return ahora + DIA;
}

/** Unidad completa: una sola revisión de correcciones dos días después, si la prueba es reciente. */
export function proximaHecha(fecha: string | null, ahora: number): number {
  const f = fecha ? msDe(fecha) : ahora;
  return ahora < f + 5 * DIA ? ahora + 2 * DIA : NUNCA;
}

// ------------------------------------------------------------------ descubrimiento

async function descubrir(c: Ctx) {
  const temporadas = temporadasActuales(new Date(c.ahora));
  const septiembre = new Date(c.ahora).getUTCMonth() === 8 && new Date(c.ahora).getUTCDate() <= c.cfg.ventanaDias;
  const indices = [
    { clave: `indice|skermo|${temporadas.rfee}`, tipo: 'skermo' as const, season: temporadas.rfee },
    { clave: `indice|fie|${temporadas.fie}`, tipo: 'fie' as const, season: temporadas.fie },
    ...(septiembre ? [
      { clave: `indice|skermo|${Number(temporadas.rfee.slice(0, 4)) - 1}-${temporadas.rfee.slice(0, 4)}`, tipo: 'skermo' as const,
        season: `${Number(temporadas.rfee.slice(0, 4)) - 1}-${temporadas.rfee.slice(0, 4)}` },
      { clave: `indice|fie|${Number(temporadas.fie) - 1}`, tipo: 'fie' as const, season: String(Number(temporadas.fie) - 1) },
    ] : []),
  ];
  for (const ix of indices) {
    const u = await c.lectura.leer<{ proxima: number; datos: string | null }>(`select proxima, datos from resultado_auto_unidad where clave=?`, [ix.clave]);
    if (u[0] && Number(u[0].proxima) > c.ahora) continue;
    const datos = u[0]?.datos ? JSON.parse(String(u[0].datos)) as { pagina?: number } : {};
    if (ix.tipo === 'skermo') await descubrirSkermo(c, ix.season);
    else await descubrirFie(c, Number(ix.season), datos.pagina ?? 1, ix.clave);
    if (ix.tipo === 'skermo') {
      await c.lectura.escribirPropias([{
        sql: `insert into resultado_auto_unidad (clave, fuente, temporada, estado, intentos, proxima, ultima) values (?,'indice',?,'hecho',0,?,?)
          on conflict (clave) do update set proxima=excluded.proxima, ultima=excluded.ultima, intentos=0`,
        params: [ix.clave, ix.season, c.ahora + 3 * HORA, c.ahora],
      }]);
    }
    return; // one index read per pass
  }
}

const enVentana = (fecha: string | null, c: Ctx) =>
  !!fecha && fecha <= c.hoy && msDe(fecha) >= c.ahora - c.cfg.ventanaDias * DIA;

async function descubrirFie(c: Ctx, season: number, pagina: number, clave: string) {
  // The FIE catalog is not sorted by date: read every page, a few per pass, and loop.
  const { filas, total } = await leerCatalogoFie(c.red, season, pagina);
  const altas = filas.filter((f) => enVentana(f.fecha, c)).map((f) => ({
    clave: `fie|${season}|${f.competitionId}`, fuente: 'fie' as const, temporada: String(season), fecha: f.fecha,
    proxima: Math.max(c.ahora, msDe(f.fecha!) + c.cfg.esperaHoras * HORA), datos: { competitionId: f.competitionId },
  }));
  if (altas.length) await c.lectura.escribirPropias(sentenciasAlta(altas));
  c.resumen.unidades.descubiertas += altas.length;
  const paginas = Math.max(1, Math.ceil(total / 100));
  const siguiente = pagina >= paginas ? 1 : pagina + 1;
  await c.lectura.escribirPropias([{
    sql: `insert into resultado_auto_unidad (clave, fuente, temporada, estado, intentos, proxima, ultima, datos) values (?,'indice',?,'hecho',0,?,?,?)
      on conflict (clave) do update set proxima=excluded.proxima, ultima=excluded.ultima, datos=excluded.datos`,
    params: [clave, String(season), siguiente === 1 ? c.ahora + 6 * HORA : c.ahora, c.ahora, JSON.stringify({ pagina: siguiente })],
  }]);
}

async function descubrirSkermo(c: Ctx, season: string) {
  const filas = await leerIndiceSkermo(c.red, season);
  if (!filas) return;
  const altas: Parameters<typeof sentenciasAlta>[0][number][] = [];
  const pdfs = new Map<string, { url: string; fecha: string; filas: FilaCatalogoPdf[] }>();
  // One Engarde tournament usually holds the whole weekend, but Skermo links it from one row only.
  const hermanos = (f: SkermoResultsIndexRow) => [...new Set(filas.filter((g) => g !== f && g.date && f.date &&
    Math.abs(msDe(g.date) - msDe(f.date)) <= DIA &&
    ((g.city && f.city && g.city.trim().toUpperCase() === f.city.trim().toUpperCase()) || g.name === f.name))
    .flatMap((g) => g.liveLinks.map((l) => l.url)).filter((u) => enlaceEngarde(u) !== null))].slice(0, 4);
  for (const f of filas) {
    if (!enVentana(f.date, c)) continue;
    const proxima = Math.max(c.ahora, msDe(f.date!) + c.cfg.esperaHoras * HORA);
    if (f.competitionId) {
      const extra = hermanos(f);
      altas.push({ clave: `skermo|${season}|${f.competitionId}`, fuente: 'skermo', temporada: season, fecha: f.date, proxima,
        datos: extra.length ? { fila: f, enlacesHermanos: extra } : { fila: f } });
      continue;
    }
    // Without a Skermo classification the PDF is the source of the competition itself.
    for (const doc of f.documents) {
      let host = '';
      try { host = new URL(doc.url).hostname; } catch { continue; }
      if (host !== 'app.skermo.org') continue;
      const p = pdfs.get(doc.url) ?? { url: doc.url, fecha: f.date!, filas: [] };
      p.filas.push({ fecha: f.date!, arma: f.weapon, genero: f.gender, categoria: f.category, formato: f.format });
      if (f.date! < p.fecha) p.fecha = f.date!;
      pdfs.set(doc.url, p);
    }
  }
  for (const p of pdfs.values()) {
    altas.push({ clave: `pdf|${season}|${docIdDeUrl(p.url)}`, fuente: 'pdf', temporada: season, fecha: p.fecha,
      proxima: Math.max(c.ahora, msDe(p.fecha) + c.cfg.esperaHoras * HORA), datos: { url: p.url, filas: p.filas } });
  }
  if (altas.length) await c.lectura.escribirPropias(sentenciasAlta(altas));
  c.resumen.unidades.descubiertas += altas.length;
}

// ------------------------------------------------------------------ unidades

type Resultado = {
  estado: EstadoUnidad; motivo: string | null; huella?: string | null; escrito?: string | null; proxima: number; filas: number; intento: boolean;
};

async function procesar(c: Ctx, u: Unidad): Promise<'seguir' | 'parar'> {
  c.resumen.unidades.procesadas += 1;
  const filasAntes = c.base.filasEscritas;
  let res: Resultado;
  try {
    res = u.fuente === 'fie' ? await procesarFie(c, u)
      : u.fuente === 'skermo' ? await procesarSkermo(c, u)
      : await procesarPdf(c, u);
  } catch (e) {
    const filas = c.base.filasEscritas - filasAntes;
    if (e instanceof Diferir) {
      c.resumen.detalle.push({ clave: u.clave, estado: u.estado, motivo: e.motivo, filas });
      return e.motivo === 'tope_filas_pasada' ? 'parar' : 'seguir';
    }
    if (e instanceof RedDetenida && (e.motivo === 'peticiones' || e.motivo === 'tiempo')) {
      c.resumen.detalle.push({ clave: u.clave, estado: u.estado, motivo: `red_${e.motivo}`, filas });
      c.resumen.status = `red_${e.motivo}`;
      return 'parar';
    }
    if (e instanceof Parar) {
      c.resumen.status = e.motivo;
      c.resumen.detalle.push({ clave: u.clave, estado: u.estado, motivo: e.motivo, filas });
      if (e.motivo === 'ledger_bajo') c.resumen.ok = false;
      return 'parar';
    }
    const remoto = e instanceof RedDetenida && e.motivo !== 'tamano';
    const motivo = e instanceof RedDetenida ? `red_${e.motivo}` : String((e as Error)?.message ?? e).slice(0, 120);
    const agotada = u.intentos + 1 >= 5;
    res = {
      estado: agotada ? 'revision' : 'error', motivo, filas, intento: true,
      proxima: agotada ? NUNCA : c.ahora + Math.max(HORA, remoto ? (e as RedDetenida).retryAfterMs ?? HORA : 2 * HORA),
    };
    c.resumen.unidades.errores += 1;
    if (agotada) await c.lectura.escribirPropias([sentenciaRevision(u.clave, 'errores_repetidos', { motivo, escrito: filas > 0 }, c.ahora)]);
    await c.lectura.escribirPropias([sentenciaCierre(u, { ...res, detalle: motivo, ahora: c.ahora })]);
    c.resumen.detalle.push({ clave: u.clave, estado: res.estado, motivo, filas });
    if (remoto) c.resumen.status = motivo;
    return remoto ? 'parar' : 'seguir';
  }
  await c.lectura.escribirPropias([sentenciaCierre(u, { ...res, detalle: res.motivo, ahora: c.ahora })]);
  if (res.filas > 0) c.resumen.unidades.escritas += 1;
  else if (res.estado === 'hecho') c.resumen.unidades.sinCambios += 1;
  if (res.estado === 'esperando') c.resumen.unidades.esperando += 1;
  if (res.estado === 'revision') c.resumen.unidades.revision += 1;
  c.resumen.detalle.push({ clave: u.clave, estado: res.estado, motivo: res.motivo, filas: res.filas });
  return 'seguir';
}

function esperar(c: Ctx, u: Unidad, motivo: string): Resultado {
  const p = proximaEspera(u.fecha, c.ahora, c.cfg);
  return p === null
    ? { estado: 'descartada', motivo: `${motivo}_fuera_de_ventana`, proxima: NUNCA, filas: 0, intento: true }
    : { estado: 'esperando', motivo, proxima: p, filas: 0, intento: true };
}

/** Planifica y escribe una prueba, con todos los topes comprobados antes de la primera sentencia. */
async function aplicar(c: Ctx, h: HechosPrueba, opciones: { destino?: { competitionId: string; season: string }; usadas?: Set<string> } = {}): Promise<PlanCarga> {
  const plan = await planificarCarga(c.base, h, { ahora: c.ahora, uuid: c.uuid, destino: opciones.destino, usadas: opciones.usadas });
  if (plan.estado === 'conflicto') return plan;
  const filas = plan.sentencias.reduce((n, s) => n + s.filas, 0);
  if (filas === 0) return plan;
  if (c.filasDia() + filas > c.cfg.maxFilasDia) throw new Diferir('tope_filas_dia');
  const ledger = await margenLedger(c.lectura, c.presupuestoBytes);
  if (ledger.bloqueado || ledger.margen - filas * BYTES_POR_FILA < c.cfg.margenLedgerMinBytes) {
    await c.lectura.escribirPropias([sentenciaRevision('global', 'ledger_bajo', { margen: ledger.margen, filas, escrito: false }, c.ahora)]);
    throw new Parar('ledger_bajo');
  }
  await c.base.escribirDeporte(plan.sentencias);
  const propias: Omit<Sentencia, 'filas'>[] = [];
  if (c.conPerfil) propias.push(...sentenciasPerfil(h, plan, c.ahora));
  if (c.conExplorar) propias.push(...sentenciasIndiceExplorar(h, plan, c.hoy));
  const eventos = sentenciasEventos(h, plan, c.ahora, h.edition.name);
  c.resumen.eventos += eventos.length;
  propias.push(...eventos);
  await c.lectura.escribirPropias(propias);
  return plan;
}

const terminado = (e: string) => e === 'completo' || e === 'sin_resultados';

async function procesarFie(c: Ctx, u: Unidad): Promise<Resultado> {
  const [, season, id] = u.clave.split('|');
  const l = await leerPruebaFieAuto(c.red, Number(season), Number(id), c.hoy);
  if (!l.hechos.length) return esperar(c, u, l.esperar ?? 'fie_sin_datos');
  const huella = huellaHechos(l.hechos);
  if (huella === u.huella) return cerrarHecha(c, u, l.final, huella, 0, 'sin_cambios');
  const antes = c.base.filasEscritas;
  const plan = await aplicar(c, l.hechos[0]);
  if (plan.estado === 'conflicto') return revisar(c, u, plan.motivo ?? 'conflicto', {});
  return cerrarHecha(c, u, l.final, huella, c.base.filasEscritas - antes, null);
}

function cerrarHecha(c: Ctx, u: Unidad, final: boolean, huella: string, filas: number, motivo: string | null): Resultado {
  if (final) return { estado: 'hecho', motivo, huella, proxima: proximaHecha(u.fecha, c.ahora), filas, intento: true };
  const p = proximaEspera(u.fecha, c.ahora, c.cfg);
  return { estado: p === null ? 'hecho' : 'esperando', motivo: motivo ?? 'parcial', huella, proxima: p ?? NUNCA, filas, intento: true };
}

async function revisar(c: Ctx, u: Unidad, motivo: string, datos: Record<string, unknown>, escrito = false): Promise<Resultado> {
  await c.lectura.escribirPropias([sentenciaRevision(u.clave, motivo, { ...datos, escrito }, c.ahora)]);
  return { estado: 'revision', motivo, proxima: NUNCA, filas: 0, intento: true };
}

/** Enlaces de Engarde de una prueba de Skermo: los del índice y los del calendario (live_source). */
async function enlacesEngarde(c: Ctx, fila: SkermoResultsIndexRow, hermanos: readonly string[]): Promise<string[]> {
  const urls = new Set(fila.liveLinks.filter((l) => /engarde-service\.com/i.test(l.url)).map((l) => l.url));
  for (const url of hermanos) urls.add(url);
  if (fila.competitionId) {
    // Links of sibling competitions count too: one Engarde tournament holds every event of the
    // weekend, and leerEngardeDeSkermo picks the right one by weapon, gender, date and names.
    const filas = await c.lectura.leer<{ url: string }>(
      `select l.url from live_source l join event_competition ec on ec.event_id = l.event_id join event e on e.id = ec.event_id
        where e.source = 'skermo_rfee' and ec.source_id = ? and l.url like '%engarde-service.com/%'
        order by (l.event_competition_id = ec.id) desc limit 6`, [fila.competitionId]);
    for (const f of filas) urls.add(f.url);
  }
  const vistos = new Set<string>();
  return [...urls].filter((url) => {
    const e = enlaceEngarde(url);
    if (!e) return false;
    const k = `${e.org}/${e.evt}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

async function procesarSkermo(c: Ctx, u: Unidad): Promise<Resultado> {
  const fila = (u.datos?.fila ?? null) as SkermoResultsIndexRow | null;
  if (!fila?.competitionId) return revisar(c, u, 'unidad_sin_datos', {});
  const l = await leerClasificacionSkermo(c.red, fila.competitionId, c.hoy);
  if (!l.hechos.length) return esperar(c, u, l.esperar ?? 'skermo_sin_datos');
  const hs = l.hechos[0];
  const individual = hs.competition.format === 'INDIVIDUAL';
  // Bouts: Engarde first (the RFEE publishes pools and tableau there), else the row's PDF.
  let asaltos: { h: HechosPrueba; final: boolean; fuente: 'engarde' | 'pdf'; pdf?: LecturaPdfAuto } | null = null;
  const notas: string[] = [];
  // Bouts loaded under another key (a manual batch) are never re-read nor replaced: a second
  // reading would duplicate or rewrite them under other refs. Own bouts are re-read until complete.
  const previos = individual ? await asaltosPrevios(c, hs.competition.competitionKey) : [];
  const ajenos = previos.some((p) => p.clave !== u.escrito);
  const completos = previos.length > 0 && previos.every((p) => p.estado === 'completo');
  if (individual && !ajenos && !completos) {
    const objetivo = {
      id: fila.competitionId, weapon: hs.competition.weapon, gender: hs.competition.gender, category: hs.competition.category,
      fecha: hs.competition.date ?? fila.date ?? c.hoy, hechos: hs,
    };
    const hermanos = Array.isArray(u.datos?.enlacesHermanos) ? (u.datos.enlacesHermanos as unknown[]).map(String) : [];
    for (const url of await enlacesEngarde(c, fila, hermanos)) {
      const e = await leerEngardeDeSkermo(c.red, enlaceEngarde(url)!, objetivo);
      if (e.hechos && e.hechos.bouts.length) {
        const s = sanearAsaltos(e.hechos);
        asaltos = { h: s.hechos, final: e.terminada && !s.poulesQuitadas.length && !s.cuadroQuitados, fuente: 'engarde' };
        break;
      }
      notas.push(e.motivo);
    }
    if (!asaltos) {
      const doc = fila.documents.find((d) => { try { return new URL(d.url).hostname === 'app.skermo.org'; } catch { return false; } });
      if (doc) {
        const p = await leerPdfAuto(c.red, c.base, doc.url, u.temporada,
          [{ fecha: fila.date!, arma: fila.weapon, genero: fila.gender, categoria: fila.category, formato: fila.format }],
          { maxBytes: c.cfg.maxPdfBytes, maxPaginas: c.cfg.maxPdfPaginas, comprobar: () => {
            if (c.reloj() - c.ahora > c.cfg.maxMs) throw new Parar('tiempo'); } });
        let candidatas = p.hechos.filter((h) => h.competition.format === 'INDIVIDUAL' && h.competition.weapon === hs.competition.weapon &&
          (h.competition.gender === hs.competition.gender || h.competition.gender === 'MIXTO'));
        let elegida = elegirPorNombres(candidatas, objetivo);
        if (elegida) elegida = sanearAsaltos(elegida).hechos;
        const incompleta = !elegida || !terminado(elegida.status.pools) || !terminado(elegida.status.tableau) || elegida.bouts.length === 0;
        if (incompleta && c.ia && !p.ocr) {
          const ia = await conIa(c, u, p, [{ weapon: hs.competition.weapon, gender: hs.competition.gender, category: hs.competition.category,
            format: 'INDIVIDUAL', fecha: fila.date! }]);
          if (ia) {
            candidatas = ia.filter((h) => h.competition.format === 'INDIVIDUAL' && h.competition.weapon === hs.competition.weapon);
            const elegidaIa = elegirPorNombres(candidatas, objetivo);
            if (elegidaIa) elegida = elegidaIa;
          }
        }
        if (elegida && elegida.bouts.length) {
          asaltos = { h: elegida, final: terminado(elegida.status.pools) && terminado(elegida.status.tableau), fuente: 'pdf', pdf: p };
        } else notas.push('pdf_sin_prueba_que_case');
      }
    }
  }
  const hechos = asaltos ? [hs, asaltos.h] : [hs];
  const huella = huellaHechos(hechos);
  if (huella === u.huella) return cerrarHecha(c, u, l.final && (asaltos?.final ?? true), huella, 0, 'sin_cambios');
  const antes = c.base.filasEscritas;
  const plan = await aplicar(c, hs);
  if (plan.estado === 'conflicto') return revisar(c, u, plan.motivo ?? 'conflicto', {});
  if (asaltos) {
    // Same rule as dedupe-pruebas: the Skermo classification wins; the reading only brings bouts.
    const sinPuestos = { ...asaltos.h, results: [], status: { ...asaltos.h.status, results: 'sin_resultados' as const } };
    const pa = await aplicar(c, sinPuestos, { destino: { competitionId: plan.competitionId, season: hs.edition.season } });
    if (pa.estado === 'conflicto') return revisar(c, u, pa.motivo ?? 'conflicto_asaltos', {}, true);
    if (asaltos.fuente === 'pdf' && asaltos.pdf) {
      // Document coverage like the batch: counted at load time (its own results plus bouts).
      const filasDoc = asaltos.h.results.length + asaltos.h.bouts.length;
      const fichero = /\/([^/?#]+?)(\.pdf)?(?:[?#].*)?$/i.exec(asaltos.h.sourceUrl)?.[1];
      if (fichero) {
        const cob = await planCobertura(c.base, 'rfee_pdf', hs.edition.season, 'pdf', `doc:${fichero}`, null,
          (previo) => mejorEstado(previo, estadoCobertura(asaltos!.h.status.results === 'completo' ? 'completo' : asaltos!.h.status.results)),
          null, filasDoc, asaltos.h.sourceUrl, c.ahora, c.uuid);
        await c.base.escribirDeporte(cob.sentencias);
      }
    }
  }
  const filas = c.base.filasEscritas - antes;
  const final = l.final && (asaltos ? asaltos.final : !individual || notas.length === 0);
  const r = cerrarHecha(c, u, final, huella, filas, notas.length ? notas.join(',').slice(0, 200) : null);
  return asaltos ? { ...r, escrito: asaltos.h.competition.competitionKey } : r;
}

/** Cobertura de poules y cuadro que otras lecturas (Engarde, PDF) ya dejaron en esta prueba de Skermo. */
async function asaltosPrevios(c: Ctx, competitionKey: string): Promise<{ clave: string; estado: string }[]> {
  const filas = await c.lectura.leer<{ k: string; s: string }>(
    `select v.competition_key k, v.status s from sport_competition sc join sport_import_coverage v on v.competition_id = sc.id
      where sc.source = 'skermo_rfee' and sc.competition_key = ? and v.source <> 'skermo_rfee'
        and v.fact_kind in ('pools','tableau')`, [competitionKey]);
  return filas.map((f) => ({ clave: String(f.k), estado: String(f.s) }));
}

function elegirPorNombres(candidatas: readonly HechosPrueba[], objetivo: { id: string; weapon: string; gender: string; fecha: string; hechos: HechosPrueba }) {
  const casan = candidatas.filter((h) => casarConSkermo(
    { weapon: h.competition.weapon, gender: h.competition.gender, fecha: h.competition.date ?? objetivo.fecha, nombres: nombresDeHechos(h) },
    [{ id: objetivo.id, source: 'skermo_rfee', weapon: objetivo.weapon, gender: objetivo.gender, fecha: objetivo.fecha, nombres: nombresDeHechos(objetivo.hechos) }],
  ).casan.length === 1);
  return casan.length === 1 ? casan[0] : null;
}

/** IA sobre el texto del PDF; null si no se llamó o no pasó la validación estricta (queda en revisión). */
async function conIa(c: Ctx, u: Unidad, p: LecturaPdfAuto, pruebas: (PruebaFecha & { fecha: string })[]): Promise<HechosPrueba[] | null> {
  if (!c.ia || !c.ia.puede()) return null;
  const ia = c.ia;
  const fechaCatalogo = (x: PruebaFecha) => pruebas.find((q) => q.weapon === x.weapon && q.gender === x.gender && q.category === x.category && q.format === x.format)?.fecha ?? null;
  const reserva: { neuronas: number | null } = { neuronas: null };
  const res = await extraerPdfConIa(ia.cliente, {
    url: p.lectura.url, sha256: p.lectura.sha256 ?? '', docId: p.docId, season: u.temporada, textos: p.textos,
    editionName: p.hechos[0]?.edition.name ?? null, editionStart: p.hechos[0]?.edition.startDate ?? null,
    editionEnd: p.hechos[0]?.edition.endDate ?? null, fechaCatalogo, maxCaracteres: c.cfg.iaMaxCaracteres,
    neuronasDisponibles: ia.disponibles(),
    reservar: async (peorCaso) => {
      const ok = await ia.reservar(peorCaso);
      if (ok) reserva.neuronas = peorCaso;
      return ok;
    },
  });
  if (reserva.neuronas !== null && (res.ok || res.llamada)) await ia.ajustar(reserva.neuronas, res.neuronas);
  if (res.ok) {
    c.resumen.ia.aceptadas += 1;
    return res.validacion.hechos;
  }
  if (res.llamada) {
    await c.lectura.escribirPropias([sentenciaRevision(u.clave, 'ia_no_valida', {
      motivo: res.motivo, fallos: res.fallos.slice(0, 40), escrito: false, modelo: c.ia.cliente.modelo,
    }, c.ahora)]);
  }
  return null;
}

async function procesarPdf(c: Ctx, u: Unidad): Promise<Resultado> {
  const url = String(u.datos?.url ?? '');
  const filasCat = (u.datos?.filas ?? []) as FilaCatalogoPdf[];
  if (!url) return revisar(c, u, 'unidad_sin_datos', {});
  if (!u.escrito) {
    // A document a manual batch already loaded is its data, not ours: never re-read nor rewritten.
    const docId = await resolverDocIdD1(c.base, u.temporada, url);
    const cargado = await c.lectura.leer(`select 1 from sport_import_coverage where source='rfee_pdf' and fact_kind='pdf'
      and season=? and competition_key=? limit 1`, [u.temporada, `doc:${docId}`]);
    if (cargado.length) return { estado: 'hecho', motivo: 'cargado_por_lote', proxima: NUNCA, filas: 0, intento: true };
  }
  const p = await leerPdfAuto(c.red, c.base, url, u.temporada, filasCat,
    { maxBytes: c.cfg.maxPdfBytes, maxPaginas: c.cfg.maxPdfPaginas, comprobar: () => { if (c.reloj() - c.ahora > c.cfg.maxMs) throw new Parar('tiempo'); } });
  if (p.ocr && p.hechos.length === 0) return revisar(c, u, 'pdf_sin_texto', { paginas: p.textos.length });
  let hechos = p.hechos.map((h) => sanearAsaltos(h).hechos);
  // Team pool sheets carry club codes, not fencers: nothing for sport_* and not worth AI neurons.
  const soloEquipos = filasCat.length > 0 && filasCat.every((f) => f.formato === 'EQUIPOS');
  const incompletas = hechos.filter((h) => h.status.results !== 'completo' && h.status.results !== 'sin_resultados' ||
    !terminado(h.status.pools) || !terminado(h.status.tableau));
  if ((hechos.length === 0 || incompletas.length > 0 || p.descartadas > 0) && c.ia && !p.ocr && !soloEquipos) {
    const ia = await conIa(c, u, p, filasCat.map((f) => ({
      weapon: f.arma ?? '', gender: f.genero ?? '', category: f.categoria ?? '', format: f.formato ?? '', fecha: f.fecha,
    })));
    if (ia) {
      // Per section, a complete deterministic reading wins; the validated AI reading fills the rest.
      const porClave = new Map(hechos.map((h) => [h.competition.competitionKey, h]));
      const deIa = new Set(ia.map((x) => x.competition.competitionKey));
      const soloDeterministas = hechos.filter((h) => !deIa.has(h.competition.competitionKey));
      hechos = [...soloDeterministas, ...ia.map((x) => {
        const det = porClave.get(x.competition.competitionKey);
        if (!det) return x;
        const res = det.status.results === 'completo' ? det : x;
        const pools = terminado(det.status.pools) && det.status.pools === 'completo' ? det : x;
        const tab = terminado(det.status.tableau) && det.status.tableau === 'completo' ? det : x;
        return {
          ...x,
          results: res.results,
          bouts: [...pools.bouts.filter((b) => b.phase === 'POULE'), ...tab.bouts.filter((b) => b.phase === 'TABLEAU')],
          status: { ...x.status, results: res.status.results, pools: pools.status.pools, tableau: tab.status.tableau },
        };
      })];
    }
  }
  if (hechos.length === 0) {
    if (soloEquipos) return { estado: 'descartada', motivo: 'pdf_equipos_sin_clasificacion', proxima: NUNCA, filas: 0, intento: true };
    // The document is already published: re-reading the same bytes would give the same answer.
    return revisar(c, u, 'pdf_no_atribuible', { descartes: p.motivosDescarte.slice(0, 20), paginas: p.textos.length });
  }
  const huella = huellaHechos(hechos);
  const final = hechos.every((h) => terminado(h.status.results) && terminado(h.status.pools) && terminado(h.status.tableau));
  if (huella === u.huella) return cerrarHecha(c, u, final, huella, 0, 'sin_cambios');
  const antes = c.base.filasEscritas;
  const usadas = new Set<string>();
  let edicionId: string | null = null;
  for (const h of hechos) {
    const plan = await aplicar(c, h, { usadas });
    if (plan.estado === 'conflicto') return revisar(c, u, plan.motivo ?? 'conflicto', { prueba: h.competition.competitionKey }, c.base.filasEscritas > antes);
    edicionId ??= plan.edicionId;
  }
  if (edicionId) await c.base.escribirDeporte(await planCoberturaDocumento(c.base, edicionId, u.temporada, url, c.ahora, c.uuid));
  const filas = c.base.filasEscritas - antes;
  if (!final) {
    await c.lectura.escribirPropias([sentenciaRevision(u.clave, 'pdf_parcial', {
      pruebas: hechos.map((h) => ({ k: h.competition.competitionKey, s: h.status })).slice(0, 20), escrito: filas > 0,
    }, c.ahora)]);
  }
  return { ...cerrarHecha(c, u, final, huella, filas, final ? null : 'pdf_parcial'), escrito: `doc:${p.docId}` };
}

export { leerUnidad };
