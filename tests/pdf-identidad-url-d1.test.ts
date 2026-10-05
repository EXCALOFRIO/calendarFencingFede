import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { localD1 } from '@/db/d1/testing';
import { createD1Database, type Db } from '@/db';
import { sportImportCoverage } from '@/db/schema';
import { crearDepsPersistenciaPdfDb } from '@/lib/ingest/backfill/pdf-db';
import { persistirLecturaPdf } from '@/lib/ingest/backfill/pdf-persist';
import { docIdDeUrl, docIdLegadoDeUrl } from '@/lib/ingest/sources/rfee-pdf/lectura';
import type { AsaltoPdf, LecturaPdf, PruebaPdf } from '@/lib/ingest/sources/rfee-pdf/tipos';
import { reclamarSportLease, dbConSportLease, type SportLease } from '@/lib/ingest/sport-incremental/lease';

const season = '2026-2027';
const first = 'https://app.skermo.org/client/1/results.pdf';
const second = 'https://app.skermo.org/client/2/results.pdf';
let local: ReturnType<typeof localD1>;
let deps: ReturnType<typeof crearDepsPersistenciaPdfDb>;
let writer: Db;
let lease: SportLease | null;
beforeEach(async () => {
  local = localD1();
  local.sqlite.exec(readFileSync(new URL('../drizzle-d1/0002_guardia_deportiva.sql', import.meta.url), 'utf8'));
  local.sqlite.exec(readFileSync(new URL('../drizzle-d1/0005_presupuesto_8gib.sql', import.meta.url), 'utf8'));
  const raw = createD1Database(local.binding);
  lease = await reclamarSportLease(raw);
  writer = dbConSportLease(raw, lease!);
  deps = crearDepsPersistenciaPdfDb(writer);
});
afterEach(async () => { await lease?.liberar(); local.close(); });

function reading(url: string, options: { docId?: string; revision?: boolean } = {}): LecturaPdf {
  const docId = options.docId ?? docIdDeUrl(url);
  const coverage = (importado: number) => ({ estado: 'completo' as const, publicado: importado, importado, motivo: null });
  const test: PruebaPdf = {
    clave: `${docId}:ESPADA:M:INDIVIDUAL:ABS:`, cabecera: ['SYNTHETIC EVENT', 'ESPADA M ABS'],
    arma: 'ESPADA', genero: 'M', formato: 'INDIVIDUAL', categoria: 'ABS', categoriaOriginal: 'ABS',
    cohorte: null, categoriaPublicada: 'ABS', fecha: '2026-10-01', paginas: [1],
    puestos: [{
      sourceFactKey: 'p1:y500', ref: 'p0001', posicion: 1, posicionRaw: null,
      nombre: options.revision ? 'SYNTHETIC CORRECTED' : 'SYNTHETIC PRIVATE ATHLETE',
      club: null, region: { pagina: 1, yMin: 490, yMax: 510 },
    }], asaltos: [],
    excluidos: { equipo: 0, bye: 0, sinMarcador: 0, sinGanador: 0, incoherente: 0,
      identidadNoConfirmada: 0, conflicto: 0, duplicado: 0 }, rechazos: [],
    cobertura: { puestos: coverage(1), poules: coverage(0), cuadro: coverage(0) }, estado: 'completo',
  };
  return {
    url, docId, sha256: (options.revision ? 'b' : 'a').repeat(64),
    perfil: { bytes: 100, paginas: 1, items: 5, ms: 1, heapMb: 0 }, paginas: [],
    pruebas: [test], rechazos: [], ocr: { necesario: false, paginas: [], ejecutado: false, motivo: null },
    estado: 'completo', error: null,
  };
}
function count(table: string) { return Number(local.sqlite.prepare(`select count(*) as n from ${table}`).get()!.n); }
function facts() {
  return local.sqlite.prepare('select competition_id,source_fact_key,source_name,source_url from sport_result order by source_url').all();
}

describe('URL-owned native PDF namespaces', () => {
  it('keeps identical filenames in different directories separate and idempotent', async () => {
    await persistirLecturaPdf(deps, reading(first), { season });
    await persistirLecturaPdf(deps, reading(second), { season });
    const before = facts();
    expect(count('sport_competition')).toBe(2);
    expect(count('sport_edition')).toBe(2);
    expect(before).toHaveLength(2);
    expect(before[0].competition_id).not.toBe(before[1].competition_id);
    expect(before[0].source_fact_key).not.toBe(before[1].source_fact_key);
    expect((await persistirLecturaPdf(deps, reading(second), { season })).estado).toBe('sin_cambios');
    expect(facts()).toEqual(before);
  });
  it('preserves legacy namespaces and nested test keys only for the same exact URL', async () => {
    const legacy = docIdLegadoDeUrl(first);
    await persistirLecturaPdf(deps, reading(first, { docId: legacy }), { season });
    const before = facts();
    expect(await deps.resolverDocumento!(season, first, docIdDeUrl(first))).toBe(legacy);
    expect((await persistirLecturaPdf(deps, reading(first), { season })).estado).toBe('sin_cambios');
    expect(facts()).toEqual(before);
    expect((await persistirLecturaPdf(deps, reading(first, { revision: true }), { season })).estado).toBe('aplicado');
    const revised = facts();
    expect(count('sport_competition')).toBe(1);
    expect(revised).toHaveLength(1);
    expect(revised[0].competition_id).toBe(before[0].competition_id);
    expect(revised[0].source_fact_key).toBe(before[0].source_fact_key);
    expect(revised[0].source_name).toBe('SYNTHETIC CORRECTED');
  });
  it('does not adopt a legacy filename already owned by another URL', async () => {
    await persistirLecturaPdf(deps, reading(first, { docId: docIdLegadoDeUrl(first) }), { season });
    const before = facts()[0];
    expect(await deps.resolverDocumento!(season, second, docIdDeUrl(second))).toBe(docIdDeUrl(second));
    await persistirLecturaPdf(deps, reading(second), { season });
    expect(count('sport_result')).toBe(2);
    expect(facts().find((r) => r.source_url === `${first}#page=1`)).toEqual(before);
  });
  it('fails before writing a checkpoint, edition or fact into an occupied namespace', async () => {
    const id = docIdDeUrl(first);
    await persistirLecturaPdf(deps, reading(first), { season });
    const before = facts();
    const changes = local.sqlite.prepare('select total_changes() as n').get()!.n;
    await expect(persistirLecturaPdf(deps, reading(second, { docId: id }), { season }))
      .rejects.toThrow('pdf_document_namespace_conflict');
    await expect(persistirLecturaPdf(deps, {
      ...reading(second, { docId: id }), estado: 'error', sha256: null, pruebas: [],
    }, { season })).rejects.toThrow('pdf_document_namespace_conflict');
    expect(facts()).toEqual(before);
    expect(local.sqlite.prepare('select total_changes() as n').get()!.n).toBe(changes);
  });
  it('does not infer URL ownership from a checkpoint with missing provenance', async () => {
    await writer.insert(sportImportCoverage).values({
      source: 'rfee_pdf', season, factKind: 'pdf', competitionKey: `doc:${docIdLegadoDeUrl(first)}`,
    });
    expect(await deps.resolverDocumento!(season, first, docIdDeUrl(first))).toBe(docIdDeUrl(first));
    await writer.insert(sportImportCoverage).values({
      source: 'rfee_pdf', season, factKind: 'pdf', competitionKey: `doc:${docIdDeUrl(first)}`,
    });
    await expect(deps.resolverDocumento!(season, first, docIdDeUrl(first))).rejects.toThrow('pdf_document_namespace_conflict');
  });
  it.each([
    ['poules', 'conflicto'], ['cuadro', 'conflicto'],
    ['poules', 'parcial'], ['cuadro', 'parcial'],
  ] as const)('preserves published bouts when corrected %s coverage is %s', async (phase, status) => {
    const original = reading(first);
    const bout = (a: string, b: string): AsaltoPdf => ({
      fase: phase === 'poules' ? 'POULE' : 'TABLEAU', ronda: 'P1', rondaOriginal: 'P1',
      refA: a, refB: b, nombreA: 'SYNTHETIC A', nombreB: 'SYNTHETIC B',
      puntosA: 5, puntosB: 3, marcador: 'explicito', region: { pagina: 1, yMin: 100, yMax: 120 },
    });
    original.pruebas[0].asaltos = [bout('p1', 'p2'), bout('p1', 'p3')];
    original.pruebas[0].cobertura[phase] = { estado: 'completo', publicado: 2, importado: 2, motivo: null };
    await persistirLecturaPdf(deps, original, { season });
    const before = local.sqlite.prepare('select * from sport_bout order by id').all();
    const corrected = reading(first, { revision: true });
    corrected.estado = status; corrected.pruebas[0].estado = status;
    corrected.pruebas[0].asaltos = [bout('p1', 'p2')];
    corrected.pruebas[0].excluidos.conflicto = status === 'conflicto' ? 1 : 0;
    corrected.pruebas[0].cobertura[phase] = { estado: status, publicado: 2, importado: 1, motivo: 'excluded_bout' };
    expect((await persistirLecturaPdf(deps, corrected, { season })).estado).toBe('correccion_en_revision');
    expect(local.sqlite.prepare('select * from sport_bout order by id').all()).toEqual(before);
    expect(facts()[0].source_name).toBe('SYNTHETIC PRIVATE ATHLETE');
    const checkpoint = await deps.leerCheckpoint(season, `doc:${original.docId}`);
    expect(checkpoint?.status).toBe('conflicto');
    expect(JSON.parse(checkpoint!.cursor!).sha256).toBeNull();
  });
  it('recovers an initial import interrupted before its final checkpoint when the PDF changes', async () => {
    const original = reading(first);
    original.pruebas[0].puestos.push({
      ...original.pruebas[0].puestos[0], sourceFactKey: 'p1:y450', ref: 'p0002', posicion: 2,
    });
    original.pruebas[0].cobertura.puestos = { estado: 'completo', publicado: 2, importado: 2, motivo: null };
    await expect(persistirLecturaPdf({
      ...deps, upsertPrueba: async (p) => {
        const pending = await deps.leerCheckpoint(season, `doc:${original.docId}`);
        expect(pending?.status).toBe('pendiente');
        expect(JSON.parse(pending!.cursor!).sha256).toBeNull();
        return deps.upsertPrueba(p);
      }, upsertCobertura: async (f) => {
        if (f.factKind === 'pdf' && f.status === 'completo') throw new Error('fixture_checkpoint_failure');
        await deps.upsertCobertura(f);
      },
    }, original, { season })).rejects.toThrow('fixture_checkpoint_failure');
    expect(count('sport_result')).toBe(2);
    const checkpoint = await deps.leerCheckpoint(season, `doc:${original.docId}`);
    expect(JSON.parse(checkpoint!.cursor!).sha256).toBeNull();
    expect(JSON.parse(checkpoint!.cursor!).correccion.shaNuevo).toBe(original.sha256);
    const recovered = await persistirLecturaPdf(deps, reading(first, { revision: true }), { season });
    expect(recovered.retirados.puestos).toBe(1);
    expect(count('sport_result')).toBe(1);
    expect((await deps.leerCheckpoint(season, `doc:${original.docId}`))?.status).toBe('completo');
  });
});
