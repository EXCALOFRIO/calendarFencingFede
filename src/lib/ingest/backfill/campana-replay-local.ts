/** Finite offline campaign policy. Sources and the existing local target remain explicit. */
import { isAbsolute } from 'node:path';
import { hashArchivo } from '../archivo-r2';
import { leerManifiestoArchivoLocal } from '../archivo-local';
import type { CacheManifest } from './cache-local';
import type { ManifiestoCacheNacional } from './cache-nacional';
import {
  ejecutarReplayLocal, LIMITES_REPLAY_LOCAL,
  type DepsReplayLocal, type OpcionesReplayLocal, type SeleccionReplay, type ResumenReplayLocal,
} from './replay-local';

export const LIMITES_CAMPANA_REPLAY = { unidades: 6_000, milisegundos: 1_800_000, sentencias: 500_000 } as const;
export type FuenteCampanaReplay = 'fie' | 'html' | 'pdf' | 'nacional' | 'todo';
export type PlanCampanaReplay = Pick<OpcionesReplayLocal,
  'cacheFie' | 'cacheNacional' | 'cacheFieSha256' | 'cacheNacionalSha256'> & { selecciones: SeleccionReplay[] };
export type ResumenCampanaReplay = {
  modo: 'simulacion' | 'aplicar'; seleccionadas: number; procesadas: number; persistidas: number;
  hechosLeidos: { puestos: number; asaltos: number }; sentenciasReservadas: number;
  incidencias: ResumenReplayLocal['incidencias']; escrituraIncompletaPosible: boolean;
  motivoParada: 'inventario_procesado' | 'limite_unidades' | 'limite_tiempo' | 'limite_sentencias' | 'replay_detenido';
};
export async function prepararCampanaReplay(fuente: FuenteCampanaReplay, cacheFie?: string, cacheNacional?: string): Promise<PlanCampanaReplay> {
  if (!['fie', 'html', 'pdf', 'nacional', 'todo'].includes(fuente)) throw new Error('replay_campaign_arguments');
  const plan: PlanCampanaReplay = { selecciones: [] };
  async function manifest(root: string) {
    if (!isAbsolute(root)) throw new Error('replay_campaign_absolute_cache');
    // The source digest is pinned again by every selected bounded preflight.
    const bytes = await leerManifiestoArchivoLocal(root);
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), hash: hashArchivo(bytes) };
  }
  if (fuente === 'fie' || fuente === 'todo') {
    if (!cacheFie) throw new Error('replay_campaign_cache_required');
    const { value: m, hash } = await manifest(cacheFie) as { value: CacheManifest; hash: string };
    if (m.version !== 1 || !m.units || !m.endpoints) throw new Error('replay_campaign_manifest_invalid');
    const units = Object.values(m.units).filter((u) => u.competitionId !== null)
      .map((u): SeleccionReplay => {
        if (!Number.isSafeInteger(u.competitionId) || Number(u.competitionId) < 1 ||
          !Number.isSafeInteger(u.season) || u.season < 2000 || u.season > 2100) throw new Error('replay_campaign_manifest_invalid');
        return { tipo: 'fie', season: u.season, competitionId: u.competitionId! };
      });
    units.sort((a, b) => a.tipo === 'fie' && b.tipo === 'fie' ? a.season - b.season || a.competitionId - b.competitionId : 0);
    plan.selecciones.push(...units); plan.cacheFie = cacheFie; plan.cacheFieSha256 = hash;
  }
  if (fuente !== 'fie') {
    if (!cacheNacional) throw new Error('replay_campaign_cache_required');
    const { value: m, hash } = await manifest(cacheNacional) as { value: ManifiestoCacheNacional; hash: string };
    if (m.version !== 1 || !Array.isArray(m.unidades)) throw new Error('replay_campaign_manifest_invalid');
    for (const u of m.unidades) {
      if (!['html', 'pdf'].includes(u.tipo) || !new RegExp(`^${u.tipo}-[a-f0-9]{64}$`).test(u.id)) {
        throw new Error('replay_campaign_manifest_invalid');
      }
      if (fuente === 'html' && u.tipo !== 'html' || fuente === 'pdf' && u.tipo !== 'pdf') continue;
      plan.selecciones.push({ tipo: u.tipo, id: u.id });
    }
    plan.cacheNacional = cacheNacional; plan.cacheNacionalSha256 = hash;
  }
  const keys = plan.selecciones.map((s) => s.tipo === 'fie' ? `fie:${s.season}:${s.competitionId}` : s.id);
  if (!keys.length || keys.length > LIMITES_CAMPANA_REPLAY.unidades || new Set(keys).size !== keys.length) {
    throw new Error('replay_campaign_selection_limit');
  }
  return plan;
}

export async function ejecutarCampanaReplay(
  plan: PlanCampanaReplay,
  options: { aplicar: boolean; soloHechos: boolean; maxUnidades: number; maxMs: number; maxSentencias: number; offset?: number },
  deps: DepsReplayLocal & { checkpoint?: (indice: number, resultado: ResumenReplayLocal) => Promise<void> },
): Promise<ResumenCampanaReplay> {
  const offset = options.offset ?? 0;
  if (!Number.isInteger(options.maxUnidades) || options.maxUnidades < 1 || options.maxUnidades > LIMITES_CAMPANA_REPLAY.unidades ||
    !Number.isInteger(options.maxMs) || options.maxMs < 1 || options.maxMs > LIMITES_CAMPANA_REPLAY.milisegundos ||
    !Number.isInteger(options.maxSentencias) || options.maxSentencias < LIMITES_REPLAY_LOCAL.sentencias ||
    options.maxSentencias > LIMITES_CAMPANA_REPLAY.sentencias || !Number.isSafeInteger(offset) || offset < 0 || offset >= plan.selecciones.length) {
    throw new Error('replay_campaign_arguments');
  }
  const now = deps.ahora ?? Date.now, deadline = now() + options.maxMs;
  const selected = plan.selecciones.slice(offset, offset + options.maxUnidades);
  const r: ResumenCampanaReplay = {
    modo: options.aplicar ? 'aplicar' : 'simulacion', seleccionadas: selected.length,
    procesadas: 0, persistidas: 0, hechosLeidos: { puestos: 0, asaltos: 0 },
    sentenciasReservadas: 0, incidencias: {}, escrituraIncompletaPosible: false,
    motivoParada: offset + selected.length < plan.selecciones.length ? 'limite_unidades' : 'inventario_procesado',
  };
  for (const s of selected) {
    const remaining = Math.floor(deadline - now());
    if (remaining < 1) { r.motivoParada = 'limite_tiempo'; break; }
    if (r.sentenciasReservadas + LIMITES_REPLAY_LOCAL.sentencias > options.maxSentencias) {
      r.motivoParada = 'limite_sentencias'; break;
    }
    const unit = await ejecutarReplayLocal({
      ...plan, selecciones: [s], aplicar: options.aplicar, soloHechos: options.soloHechos,
      maxUnidades: 1, maxMs: Math.min(remaining, LIMITES_REPLAY_LOCAL.milisegundos),
    }, deps);
    r.procesadas++; r.persistidas += unit.persistidas;
    r.hechosLeidos.puestos += unit.hechosLeidos.puestos; r.hechosLeidos.asaltos += unit.hechosLeidos.asaltos;
    r.sentenciasReservadas += unit.sentenciasReservadas;
    r.escrituraIncompletaPosible ||= unit.escrituraIncompletaPosible;
    for (const [code, count] of Object.entries(unit.incidencias)) {
      const key = code as keyof ResumenReplayLocal['incidencias'];
      r.incidencias[key] = (r.incidencias[key] ?? 0) + count!;
    }
    await deps.checkpoint?.(offset + r.procesadas - 1, unit);
    if (unit.detenido) { r.motivoParada = 'replay_detenido'; break; }
  }
  return r;
}
