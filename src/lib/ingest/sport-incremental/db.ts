import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/db';
import { sportCompetition, sportExternalId, sportPerson, sportResult, sportIncrementalTask } from '@/db/schema';
import type { DepsEvidencia } from '@/lib/entries/evidencia';
import { enLista, fueraDeLista, lotesDeInsercion } from '@/lib/sqlite';
import { crearDepsPersistenciaFieDb, escribirCobertura } from '../fie-resultados-db';
import { persistirLecturaFie } from '../fie-resultados-persist';
import { crearDepsPersistenciaSkermoDb } from '../skermo-finales-db';
import { persistirLecturaSkermo } from '../skermo-finales-persist';
import { crearDepsPersistenciaRankingDb, MAX_RANKING_ENTRIES_D1 } from '../ranking-oficial-db';
import { persistirLecturaRanking } from '../ranking-oficial-persist';
import { crearDepsPersistenciaPdfDb } from '../backfill/pdf-db';
import { persistirLecturaPdf } from '../backfill/pdf-persist';
import type { EstimacionLote } from '../backfill/capacidad';
import { comprobarCapacidadD1 } from '../backfill/capacidad-db';
import { leerPruebaFie } from '../sources/fie-resultados';
import { filaCatalogoFie, urlPruebasFie } from '../sources/historico-indice';
import { leerFinalSkermo } from '../sources/skermo-finales';
import { parseSkermoResultsIndex, parseSkermoSeasons, skermoResultsUrl, type SkermoResultsIndexRow } from '../sources/skermo-results';
import { parseSkermoRankingCategories, skermoRankingFormUrl, type RankingCombo } from '../sources/ranking-rfee';
import { claveRanking, combinacionesRfee, leerRankingFie, leerRankingRfee, tareasRankingFie, type TareaRankingFie } from '../sources/ranking-oficial-historico';
import { docIdDeUrl, leerBytesPdf, PdfNoLeible } from '../sources/rfee-pdf/lectura';
import { DB_NOW, dbConSportLease, reclamarSportLease, type SportLease } from './lease';
import { redIncremento } from './http';
import { DAY, IncrementoDetenido, LIMITES_INCREMENTO, UnidadIncrementalDiferida, type Outcome, type Task, type Kind, type PresupuestoIncremento } from './policy';
import type { DepsIncremento } from './runner';
import { guardarCooldownD1 } from './cooldown';

const pageSchema = z.object({ totalFound: z.number().int().nonnegative(), items: z.array(z.unknown()).max(100) });
const armas = { E: 'ESPADA', F: 'FLORETE', S: 'SABLE' } as const;
const key = (kind: Kind, season: string, ref = '') => `${kind}|${season}|${ref}`;

export function crearDepsIncrementoDb(rawDb: Db, budget: PresupuestoIncremento): DepsIncremento {
  let lease: SportLease | null = null;
  let db: Db;
  let usedFacts = 0;
  let usedUnits = 0;
  // Cooldown metadata is the only write allowed after a source failure.
  const controlDb = () => {
    if (!lease) throw new Error('sport_lease_required');
    return dbConSportLease(rawDb, lease);
  };
  const esquema = async () => ({ identidad: true, referencias: true });
  const evidencia: DepsEvidencia = {
    esquema,
    // Resolve only already-confirmed sport IDs; never match/create a person by name.
    atletasPorLicencia: async () => [],
    fichasFie: async () => [],
    externos: async (values) => rawDb.select().from(sportExternalId)
      .where(enLista(sportExternalId.value, values)),
    personas: async (ids) => {
      const rows = await rawDb.select({
        id: sportPerson.id, athleteId: sportPerson.athleteId, mergedIntoPersonId: sportPerson.mergedIntoPersonId,
      }).from(sportPerson).where(enLista(sportPerson.id, ids));
      return new Map(rows.map((r) => [r.id, r]));
    },
  };
  async function capacidad(estimate: EstimacionLote = { puestos: 0, asaltos: 0, documentos: 0, unidades: 2 }) {
    return (await comprobarCapacidadD1(rawDb, estimate)).continuar;
  }
  async function guardarHechos(estimate: EstimacionLote) {
    budget.comprobar();
    const facts = estimate.puestos + estimate.asaltos;
    if (facts + usedFacts > LIMITES_INCREMENTO.maxFacts ||
      estimate.unidades + usedUnits > LIMITES_INCREMENTO.maxUnits) throw new UnidadIncrementalDiferida();
    if (!(await capacidad(estimate))) throw new IncrementoDetenido('capacidad');
    usedFacts += facts;
    usedUnits += estimate.unidades;
  }
  async function sembrar(tasks: Task[]) {
    // Shared PDFs can be linked by several rows of the same index.
    tasks = [...new Map(tasks.map((t) => [t.key, t])).values()];
    if (!tasks.length) return;
    if (tasks.length > LIMITES_INCREMENTO.maxSeed || !(await capacidad({
      puestos: 0, asaltos: 0, documentos: 0, unidades: tasks.length,
    }))) throw new IncrementoDetenido('capacidad');
    for (const lote of lotesDeInsercion(tasks, sportIncrementalTask)) await db.insert(sportIncrementalTask).values(lote).onConflictDoUpdate({
      target: sportIncrementalTask.key,
      set: {
        payload: sql`excluded.payload`,
        nextCheckAt: sql`case when ${sportIncrementalTask.payload} is not excluded.payload
          then ${DB_NOW} else ${sportIncrementalTask.nextCheckAt} end`,
      },
    });
  }
  async function reconciliarResultados(source: string, competitionId: string, facts: string[]) {
    // Only invoked for a COMPLETE source read, never partial/error/empty. Stable
    // source keys retire disappeared rows honestly; no cross-source deletion.
    if (!facts.length) return;
    await db.delete(sportResult).where(and(eq(sportResult.source, source),
      eq(sportResult.competitionId, competitionId),
      fueraDeLista(sportResult.sourceFactKey, facts)));
  }
  async function vacioTrasPublicado(source: string, task: Task, ref: string, factKind: string, sourceUrl: string) {
    const [old] = await rawDb.select({ competitionId: sportCompetition.id }).from(sportResult)
      .innerJoin(sportCompetition, eq(sportCompetition.id, sportResult.competitionId))
      .where(and(eq(sportCompetition.source, source), eq(sportCompetition.season, task.season),
        eq(sportCompetition.competitionKey, ref), eq(sportResult.source, source))).limit(1);
    if (!old) return false;
    await escribirCobertura(db, source, { season: task.season, factKind, competitionKey: ref,
      competitionId: old.competitionId, status: 'conflicto', sourceUrl,
      lastError: 'empty_after_published_results' }); // preserve previous counts and facts
    return true;
  }
  return {
    now: () => new Date(),
    claim: async () => {
      // reclamarSportLease checks the native schema and exact fence definitions.
      lease = await reclamarSportLease(rawDb);
      if (!lease) return null;
      db = dbConSportLease(rawDb, lease, budget.comprobar, budget.reservarEscrituras);
      return { release: lease.liberar };
    },
    capacity: capacidad,
    seed: async (seasons) => {
      const seeds: Task[] = [
        { key: key('fie_index', seasons.fie), season: seasons.fie, kind: 'fie_index', payload: { page: 1 } },
        { key: key('rfee_index', seasons.rfee), season: seasons.rfee, kind: 'rfee_index', payload: { offset: 0 } },
        ...tareasRankingFie(Number(seasons.fie)).map((t) => ({
          key: key('fie_standing', seasons.fie, claveRanking(armas[t.weapon as keyof typeof armas], t.gender, t.category,
            t.tipo === 'E' ? 'EQUIPOS' : 'INDIVIDUAL')),
          season: seasons.fie, kind: 'fie_standing' as const, payload: { task: t },
        })),
      ];
      if (!(await capacidad({ puestos: 0, asaltos: 0, documentos: 0, unidades: seeds.length }))) {
        throw new IncrementoDetenido('capacidad');
      }
      // Seeds never reset index continuation or freshness.
      for (const lote of lotesDeInsercion(seeds, sportIncrementalTask)) {
        await db.insert(sportIncrementalTask).values(lote).onConflictDoNothing();
      }
    },
    due: async (seasons, limit) => {
      const [cooldown] = await rawDb.select({ until: sportIncrementalTask.nextCheckAt })
        .from(sportIncrementalTask).where(and(eq(sportIncrementalTask.key, 'global_cooldown'),
          gt(sportIncrementalTask.nextCheckAt, DB_NOW))).limit(1);
      if (cooldown) return [];
      return await rawDb.select().from(sportIncrementalTask).where(and(
        enLista(sportIncrementalTask.season, [seasons.fie, seasons.rfee]),
        lte(sportIncrementalTask.nextCheckAt, DB_NOW),
      )).orderBy(asc(sportIncrementalTask.nextCheckAt), asc(sportIncrementalTask.key)).limit(limit) as Task[];
    },
    finish: async (task, outcome, next) => {
      await db.update(sportIncrementalTask).set({
        status: outcome.status, lastCheckedAt: DB_NOW, nextCheckAt: next,
        attempts: sql`${sportIncrementalTask.attempts} + 1`,
        ...(outcome.payload ? { payload: outcome.payload } : {}),
      }).where(eq(sportIncrementalTask.key, task.key));
    },
    cooldown: async (until) => {
      await guardarCooldownD1(controlDb(), until);
    },
    execute: async (task): Promise<Outcome> => {
      const red = redIncremento(budget);
      const hoy = new Date().toISOString().slice(0, 10);
      if (task.kind === 'fie_index') {
        const page = Number(task.payload.page ?? 1);
        if (!Number.isInteger(page) || page < 1 || page > 1_000) throw new Error('sport_index_cursor_invalid');
        const parsed = pageSchema.safeParse(await red.json(urlPruebasFie(Number(task.season), page)));
        if (!parsed.success) return { status: 'conflicto', facts: 0 };
        const response = parsed.data;
        const rows = response.items.map((item) => filaCatalogoFie(item));
        if (rows.some((row) => !row || row.temporada !== task.season)) return { status: 'conflicto', facts: 0 };
        await sembrar(rows.map((row) => ({
          key: key('fie_result', task.season, row!.clavePrueba!), season: task.season, kind: 'fie_result',
          payload: { competitionId: Number(row!.clavePrueba), date: row!.fecha },
        })));
        const more = page * 100 < response.totalFound;
        if (more && response.items.length === 0) return { status: 'parcial', facts: 0 };
        return { status: 'completo', facts: 0, payload: { page: more ? page + 1 : 1 }, nextMs: more ? 0 : DAY };
      }
      if (task.kind === 'rfee_index') {
        // ONLY RFEE; no regional federation list and no owa/other federation links.
        const base = await red.html(skermoResultsUrl('RFEE', { includePrevious: false }));
        const season = parseSkermoSeasons(base).find((s) => s.label === task.season);
        if (!season) return { status: 'pendiente', facts: 0 };
        const html = season.selected ? base : await red.html(skermoResultsUrl('RFEE', {
          season: season.value, includePrevious: false,
        }));
        if (!parseSkermoSeasons(html).some((s) => s.label === task.season && s.selected)) {
          return { status: 'conflicto', facts: 0 };
        }
        const index = parseSkermoResultsIndex(html, { federationCode: 'RFEE' });
        if (index.mismatches) return { status: 'parcial', facts: 0 };
        const seeds: Task[] = [];
        for (const row of index.rows) {
          if (row.competitionId) seeds.push({
            key: key('rfee_result', task.season, row.competitionId), season: task.season, kind: 'rfee_result',
            payload: { row, date: row.date },
          });
          for (const doc of row.documents) {
            if (new URL(doc.url).hostname !== 'app.skermo.org') continue;
            seeds.push({
              key: key('rfee_pdf', task.season, docIdDeUrl(doc.url)), season: task.season, kind: 'rfee_pdf',
              payload: { url: doc.url, date: row.date },
            });
          }
        }
        const form = await red.html(skermoRankingFormUrl('RFEE'));
        const rankingSeason = parseSkermoSeasons(form).find((s) => s.label === task.season);
        if (rankingSeason) seeds.push(...combinacionesRfee(parseSkermoRankingCategories(form)).map((combo) => ({
          key: key('rfee_standing', task.season, claveRanking(combo.weapon, combo.gender, combo.categoryRaw, 'INDIVIDUAL')),
          season: task.season, kind: 'rfee_standing' as const, payload: { season: rankingSeason, combo },
        })));
        const unique = [...new Map(seeds.map((t) => [t.key, t])).values()];
        const offset = Number(task.payload.offset ?? 0);
        if (!Number.isInteger(offset) || offset < 0) throw new Error('sport_index_cursor_invalid');
        await sembrar(unique.slice(offset, offset + LIMITES_INCREMENTO.maxSeed));
        const more = offset + LIMITES_INCREMENTO.maxSeed < unique.length;
        return { status: 'completo', facts: 0, payload: { offset: more ? offset + LIMITES_INCREMENTO.maxSeed : 0 },
          nextMs: more ? 0 : DAY };
      }
      if (task.kind === 'fie_standing' || task.kind === 'rfee_standing') {
        const lectura = task.kind === 'fie_standing'
          ? await leerRankingFie(task.payload.task as TareaRankingFie, hoy, red)
          : await leerRankingRfee({ season: task.payload.season as { value: string; label: string },
            combo: task.payload.combo as RankingCombo, hoy }, {
            html: async (url) => {
              const html = await red.html(url);
              if (!/<table\b/i.test(html)) throw new Error('sport_source_shape_invalid');
              return html;
            },
          });
        budget.comprobar();
        if ((lectura.publicacion?.entradas.length ?? 0) > MAX_RANKING_ENTRIES_D1) {
          throw new UnidadIncrementalDiferida();
        }
        await guardarHechos({ puestos: lectura.publicacion?.entradas.length ?? 0, asaltos: 0, documentos: 0, unidades: 1 });
        const persistence = crearDepsPersistenciaRankingDb(db);
        const r = await persistirLecturaRanking({ ...persistence, esquema, evidencia, categoriasHistoricas: async () => true }, lectura);
        return { status: r.cobertura ?? 'pendiente', facts: r.entradas };
      }
      if (task.kind === 'fie_result') {
        const lectura = await leerPruebaFie(Number(task.season), Number(task.payload.competitionId),
          { fetchJson: red.json }, { maxPaginas: 3, tamanoPagina: 200, omitirAsaltos: true });
        budget.comprobar();
        // No mixed old/new page snapshots in the short runner. Large/incomplete
        // lists remain explicitly partial and require the bounded local backfill.
        if (lectura.ranking?.siguientePagina || lectura.ranking?.cobertura.estado === 'parcial') {
          return { status: 'parcial', facts: 0 };
        }
        // Do not call a same-day/ongoing competition final. Missing dates stay
        // unknown; the endpoint is revisited after its published end/start day.
        if (lectura.prueba && (!(lectura.prueba.fin ?? lectura.prueba.fecha) ||
          (lectura.prueba.fin ?? lectura.prueba.fecha)! >= hoy)) return { status: 'pendiente', facts: 0 };
        await guardarHechos({ puestos: lectura.ranking?.puestos.length ?? 0, asaltos: 0, documentos: 0, unidades: 2 });
        if (lectura.ranking?.cobertura.estado === 'sin_resultados' &&
          await vacioTrasPublicado('fie', task, String(task.payload.competitionId), 'ranking', lectura.ranking.url)) {
          return { status: 'conflicto', facts: 0 };
        }
        const persistence = crearDepsPersistenciaFieDb(db);
        const completed: Parameters<typeof persistence.upsertCobertura>[0][] = [];
        const r = await persistirLecturaFie({ ...persistence, esquema, evidencia, crearIdentidades: false,
          upsertCobertura: async (f) => {
            if (f.factKind === 'ranking' && f.status === 'completo') completed.push(f);
            else await persistence.upsertCobertura(f);
          },
        }, lectura);
        if (r.competitionId && lectura.ranking?.cobertura.estado === 'completo') {
          await reconciliarResultados('fie', r.competitionId, lectura.ranking.puestos.map((p) =>
            lectura.prueba?.formato === 'EQUIPOS' ? `team:${p.fieId}` : String(p.fieId)));
        }
        for (const f of completed) await persistence.upsertCobertura({ ...f,
          importedTotal: lectura.ranking?.puestos.length ?? 0 });
        return { status: r.cobertura.ranking ?? 'pendiente', facts: lectura.ranking?.puestos.length ?? 0 };
      }
      if (task.kind === 'rfee_result') {
        const lectura = await leerFinalSkermo(task.payload.row as SkermoResultsIndexRow,
          { season: task.season, federacion: 'RFEE' }, {
            html: async (url) => {
              const html = await red.html(url);
              if (!/<table\b/i.test(html)) throw new Error('sport_source_shape_invalid');
              return html;
            },
          });
        budget.comprobar();
        if (lectura.prueba?.fecha && lectura.prueba.fecha >= hoy) return { status: 'pendiente', facts: 0 };
        await guardarHechos({ puestos: lectura.puestos.length, asaltos: 0, documentos: 0, unidades: 2 });
        if (lectura.cobertura.estado === 'sin_resultados' &&
          await vacioTrasPublicado('skermo_rfee', task, lectura.competitionKey, 'results', lectura.url)) {
          return { status: 'conflicto', facts: 0 };
        }
        const persistence = crearDepsPersistenciaSkermoDb(db);
        const completed: Parameters<typeof persistence.upsertCobertura>[0][] = [];
        const r = await persistirLecturaSkermo({ ...persistence, esquema, evidencia,
          categoriasHistoricas: async () => true, crearIdentidades: false,
          upsertCobertura: async (f) => {
            if (f.factKind === 'results' && f.status === 'completo') completed.push(f);
            else await persistence.upsertCobertura(f);
          },
        }, lectura);
        if (r.competitionId && lectura.cobertura.estado === 'completo') {
          await reconciliarResultados('skermo_rfee', r.competitionId, lectura.puestos.map((p) => p.sourceFactKey));
        }
        for (const f of completed) await persistence.upsertCobertura({ ...f, importedTotal: lectura.puestos.length });
        return { status: r.cobertura ?? 'pendiente', facts: lectura.puestos.length };
      }
      if (task.kind === 'rfee_pdf') {
        const url = String(task.payload.url);
        // Download allowlist additionally restricted to the national index host.
        if (new URL(url).hostname !== 'app.skermo.org') return { status: 'pendiente', facts: 0 };
        let lectura;
        try {
          lectura = await leerBytesPdf(await red.bytes(url), { url, docId: docIdDeUrl(url) }, {
            maxBytes: LIMITES_INCREMENTO.maxPdfBytes, maxPaginas: LIMITES_INCREMENTO.maxPdfPages,
            maxItemsPagina: 10_000, comprobar: budget.comprobar,
          });
        } catch (error) {
          if (error instanceof PdfNoLeible) throw new UnidadIncrementalDiferida();
          throw error;
        }
        const puestos = lectura.pruebas.reduce((n, p) => n + p.puestos.length, 0);
        const asaltos = lectura.pruebas.reduce((n, p) => n + p.asaltos.length, 0);
        await guardarHechos({ puestos, asaltos, documentos: 1, unidades: Math.max(1, lectura.pruebas.length) });
        const persistence = crearDepsPersistenciaPdfDb(db);
        const r = await persistirLecturaPdf({ ...persistence, esquema, categoriasHistoricas: async () => true },
          lectura, { season: task.season, sourceUrl: url });
        return { status: r.documento ?? 'pendiente', facts: puestos + asaltos };
      }
      return { status: 'pendiente', facts: 0 };
    },
  };
}
