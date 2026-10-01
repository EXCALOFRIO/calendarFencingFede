import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { DepsEvidencia } from '@/lib/entries/evidencia';
import type { ExternalIdRow } from '@/lib/identity/resolver';
import type { FilaResultado, ResumenEscritura } from '@/lib/ingest/fie-resultados-persist';
import {
  persistirLecturaSkermo,
  vigenciaDeTemporada,
  type DepsPersistenciaSkermo,
  type FilaCoberturaSkermo,
} from '@/lib/ingest/skermo-finales-persist';
import { leerFinalSkermo, type LecturaSkermo } from '@/lib/ingest/sources/skermo-finales';
import type { SkermoResultsIndexRow } from '@/lib/ingest/sources/skermo-results';
import {
  conflictosDeConfirmacion,
  filaConfirmadaPropia,
  type DepsGuardConfirmacion,
} from '@/lib/sport/id-guard';

/**
 * Almacén EN MEMORIA que imita el contrato de `skermo-finales-db.ts` y del
 * guard (incluida la clave `confirmed_key`, que no mira person_id). Es una
 * simulación: prueba la orquestación de identidad, guard y cobertura, no SQL
 * contra Neon.
 */

const CLASIFICACION = gunzipSync(
  readFileSync(fileURLToPath(new URL('./fixtures/historico/skermo-clasificacion-4612-anonimizada.html.gz', import.meta.url))),
).toString('utf8');

const filaIndice: SkermoResultsIndexRow = {
  competitionId: '4612',
  resultsUrl: null,
  date: '2022-06-25',
  name: 'CAMPEONATO DE ESPAÑA SENIOR',
  weapon: 'FLORETE',
  gender: 'M',
  category: 'ABS',
  categoryRaw: 'ABS',
  format: 'INDIVIDUAL',
  city: 'Valencia',
  country: 'ES',
  documents: [],
  liveLinks: [],
  externalUrls: [],
};

const leer = (season = '2021-2022', cuerpo = CLASIFICACION, fila = filaIndice): Promise<LecturaSkermo> =>
  leerFinalSkermo(fila, { federacion: 'RFEE', season }, { html: async () => cuerpo });

function almacen(opciones: { esquema?: boolean; externos?: ExternalIdRow[]; fusiones?: Record<string, string> } = {}) {
  const externos: ExternalIdRow[] = [...(opciones.externos ?? [])];
  const fusiones = opciones.fusiones ?? {};
  const canonica = (id: string) => fusiones[id] ?? id;
  const personas: { id: string; nombre: string; genero: string | null }[] = [];
  const resultados = new Map<string, FilaResultado & { revision: number }>();
  const cobertura = new Map<string, FilaCoberturaSkermo>();
  const pruebas: string[] = [];
  let n = 0;

  const evidencia: DepsEvidencia = {
    esquema: async () => ({ identidad: true, referencias: true }),
    atletasPorLicencia: async () => [],
    fichasFie: async () => [],
    externos: async (valores) => externos.filter((e) => valores.includes(e.value)),
    personas: async (ids) =>
      new Map(ids.map((id) => [id, { athleteId: null, mergedIntoPersonId: fusiones[id] ?? null }])),
  };

  const guard: DepsGuardConfirmacion = {
    async confirmar(c, persona) {
      if (conflictosDeConfirmacion(externos, c, canonica).length > 0) return false;
      const propia = filaConfirmadaPropia(externos, c, canonica);
      if (propia) return true;
      if (persona) personas.push({ id: persona.id, nombre: persona.displayName, genero: persona.gender });
      externos.push({ ...c, linkStatus: 'CONFIRMADO' });
      return true;
    },
    async conflictos(c) {
      return conflictosDeConfirmacion(externos, c, canonica);
    },
  };

  const deps: DepsPersistenciaSkermo = {
    esquema: async () => ({ identidad: opciones.esquema ?? true, referencias: true }),
    evidencia,
    guard,
    nuevoId: () => `persona-${(n += 1)}`,
    async upsertPrueba(p) {
      pruebas.push(`${p.fuente}|${p.season}|${p.competitionKey}`);
      return 'comp-1';
    },
    async upsertResultados(source, _c, filas) {
      const res: ResumenEscritura = { nuevos: 0, revisados: 0, sinCambios: 0 };
      for (const f of filas) {
        const clave = `${source}|${f.sourceFactKey}`;
        const previa = resultados.get(clave);
        if (!previa) {
          resultados.set(clave, { ...f, revision: 1 });
          res.nuevos += 1;
        } else if (previa.contentHash !== f.contentHash) {
          resultados.set(clave, { ...f, personId: f.personId ?? previa.personId, revision: previa.revision + 1 });
          res.revisados += 1;
        } else {
          res.sinCambios += 1;
        }
      }
      return res;
    },
    async upsertCobertura(f) {
      const clave = `${f.source}|${f.season}|${f.factKind}|${f.competitionKey}`;
      const previa = cobertura.get(clave);
      cobertura.set(clave, {
        ...f,
        publishedTotal: f.publishedTotal === undefined ? previa?.publishedTotal : f.publishedTotal,
        importedTotal: f.importedTotal === undefined ? previa?.importedTotal : f.importedTotal,
      });
    },
  };
  return { deps, externos, personas, resultados, cobertura, pruebas };
}

describe('vigencia de la licencia por temporada', () => {
  it('cubre la temporada septiembre–agosto y se amplía si la prueba cae fuera', () => {
    expect(vigenciaDeTemporada('2021-2022', '2022-06-25')).toEqual({ validFrom: '2021-09-01', validTo: '2022-08-31' });
    expect(vigenciaDeTemporada('2021-2022', '2022-09-03')).toEqual({ validFrom: '2021-09-01', validTo: '2022-09-03' });
    expect(vigenciaDeTemporada('2021-2022', '2021-08-20')).toEqual({ validFrom: '2021-08-20', validTo: '2022-08-31' });
    expect(vigenciaDeTemporada('Histórico', '2022-06-25')).toBeNull();
  });
});

describe('persistencia de puestos finales de Skermo', () => {
  it('crea cada persona con su licencia confirmada por el guard, con ámbito de temporada', async () => {
    const a = almacen();
    const r = await persistirLecturaSkermo(a.deps, await leer());
    expect(r.estado).toBe('aplicado');
    expect(r.personas).toEqual({ confirmadas: 0, creadas: 12, enRevision: 0, conflictos: 0 });
    expect(a.externos).toHaveLength(12);
    expect(a.externos[0]).toMatchObject({
      scheme: 'rfee_license',
      value: 'TST00001',
      scopeSource: 'skermo_rfee',
      scopeFederation: 'RFEE',
      scopeSeason: '2021-2022',
      scopeWeapon: '',
      validFrom: '2021-09-01',
      validTo: '2022-08-31',
      linkStatus: 'CONFIRMADO',
    });
    // La persona nueva toma el género de la prueba individual y nunca se une por nombre.
    expect(a.personas.every((p) => p.genero === 'M')).toBe(true);
    expect(a.pruebas).toEqual(['skermo_rfee|2021-2022|RFEE:4612']);
  });

  it('guarda los puestos publicados, con el empate en el 3.º y sin renumerar, y la cobertura completa', async () => {
    const a = almacen();
    await persistirLecturaSkermo(a.deps, await leer());
    const posiciones = [...a.resultados.values()].map((f) => f.position);
    expect(posiciones).toEqual([1, 2, 3, 3, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect([...a.resultados.values()].every((f) => f.personId !== null)).toBe(true);
    expect([...a.resultados.values()][0].sourceClub).toBe('CLUB-X');
    expect(a.cobertura.get('skermo_rfee|2021-2022|results|RFEE:4612')).toMatchObject({
      status: 'completo',
      publishedTotal: 12,
      importedTotal: 12,
      lastError: null,
    });
  });

  it('repetir la lectura es idempotente: ni personas, ni IDs ni puestos nuevos', async () => {
    const a = almacen();
    await persistirLecturaSkermo(a.deps, await leer());
    const r = await persistirLecturaSkermo(a.deps, await leer());
    expect(r.puestos).toEqual({ nuevos: 0, revisados: 0, sinCambios: 12 });
    expect(r.personas).toEqual({ confirmadas: 12, creadas: 0, enRevision: 0, conflictos: 0 });
    expect(a.externos).toHaveLength(12);
    expect(a.personas).toHaveLength(12);
  });

  it('una corrección del puesto revisa el hecho sin duplicarlo', async () => {
    const a = almacen();
    await persistirLecturaSkermo(a.deps, await leer());
    const corregida = CLASIFICACION.replace(/(<td[^>]*>\s*)5(\s*<\/td>)/, '$17$2');
    const r = await persistirLecturaSkermo(a.deps, await leer('2021-2022', corregida));
    expect(r.puestos.revisados).toBe(1);
    expect(a.resultados.size).toBe(12);
  });

  it('la misma licencia en otra temporada es otro ID de otra persona, hasta que alguien las funda', async () => {
    const a = almacen();
    await persistirLecturaSkermo(a.deps, await leer());
    const siguiente = CLASIFICACION.replaceAll('2021-2022', '2022-2023').replace('2022-06-25', '2023-06-24');
    const r = await persistirLecturaSkermo(a.deps, await leer('2022-2023', siguiente, { ...filaIndice, date: '2023-06-24' }));
    expect(r.personas).toMatchObject({ creadas: 12, conflictos: 0 });
    expect(a.externos).toHaveLength(24);
    expect(new Set(a.personas.map((p) => p.id)).size).toBe(24);
  });

  it('una persona fusionada A→B se reutiliza como B y no se vuelve a crear', async () => {
    const previa: ExternalIdRow = {
      personId: 'A',
      scheme: 'rfee_license',
      value: 'TST00001',
      scopeSource: 'skermo_rfee',
      scopeFederation: 'RFEE',
      scopeSeason: '2021-2022',
      scopeWeapon: '',
      validFrom: '2021-09-01',
      validTo: '2022-08-31',
      linkStatus: 'CONFIRMADO',
    };
    const a = almacen({ externos: [previa], fusiones: { A: 'B' } });
    const r = await persistirLecturaSkermo(a.deps, await leer());
    expect(r.personas).toMatchObject({ confirmadas: 1, creadas: 11, conflictos: 0 });
    expect(a.resultados.get('skermo_rfee|lic:TST00001')?.personId).toBe('B');
    expect(a.externos.filter((e) => e.value === 'TST00001')).toHaveLength(1);
  });

  it('dos personas confirmadas para la misma licencia es conflicto: no se crea ni se atribuye', async () => {
    const base = {
      scheme: 'rfee_license',
      value: 'TST00001',
      scopeSource: 'skermo_rfee',
      scopeFederation: 'RFEE',
      scopeSeason: '',
      scopeWeapon: '',
      validTo: null,
      linkStatus: 'CONFIRMADO' as const,
    };
    const a = almacen({
      externos: [
        { ...base, personId: 'X', validFrom: '1900-01-01' },
        { ...base, personId: 'Y', validFrom: '2020-01-01' },
      ],
    });
    const r = await persistirLecturaSkermo(a.deps, await leer());
    expect(r.personas).toMatchObject({ conflictos: 1, creadas: 11 });
    expect(a.resultados.get('skermo_rfee|lic:TST00001')?.personId).toBeNull();
    // El puesto se conserva, y la cobertura no se declara completa.
    expect(a.resultados.get('skermo_rfee|lic:TST00001')?.position).toBe(1);
    expect(a.cobertura.get('skermo_rfee|2021-2022|results|RFEE:4612')?.status).toBe('conflicto');
  });

  it('un equipo sólo guarda su clasificación: ninguna persona ni ID', async () => {
    const a = almacen();
    const equipos = await leer('2021-2022', CLASIFICACION.replace('<h3>Individual</h3>', '<h3>Equipos</h3>'), {
      ...filaIndice,
      format: 'EQUIPOS',
    });
    const r = await persistirLecturaSkermo(a.deps, equipos);
    expect(r.personas).toEqual({ confirmadas: 0, creadas: 0, enRevision: 0, conflictos: 0 });
    expect(a.externos).toEqual([]);
    expect(a.resultados.size).toBe(12);
    expect([...a.resultados.values()].every((f) => f.personId === null)).toBe(true);
  });

  it('sin el esquema migrado no escribe nada', async () => {
    const a = almacen({ esquema: false });
    const r = await persistirLecturaSkermo(a.deps, await leer());
    expect(r.estado).toBe('esquema_no_aplicado');
    expect([a.pruebas.length, a.resultados.size, a.cobertura.size, a.externos.length]).toEqual([0, 0, 0, 0]);
  });

  it('una lectura fallida sólo toca la cobertura y no pisa las cifras ya importadas', async () => {
    const a = almacen();
    await persistirLecturaSkermo(a.deps, await leer());
    const fallida = await leerFinalSkermo(filaIndice, { federacion: 'RFEE', season: '2021-2022' }, {
      html: async () => {
        throw new Error('HTTP 503');
      },
    });
    await persistirLecturaSkermo(a.deps, fallida);
    expect(a.resultados.size).toBe(12);
    expect(a.cobertura.get('skermo_rfee|2021-2022|results|RFEE:4612')).toMatchObject({
      status: 'error',
      publishedTotal: 12,
      importedTotal: 12,
      lastError: 'HTTP 503',
    });
  });

  it('una fila sin clasificación HTML no registra ninguna unidad', async () => {
    const a = almacen();
    const pendiente = await leerFinalSkermo(
      { ...filaIndice, competitionId: null },
      { federacion: 'RFEE', season: '2021-2022' },
      { html: async () => CLASIFICACION },
    );
    await persistirLecturaSkermo(a.deps, pendiente);
    expect(a.cobertura.size).toBe(0);
    expect(a.pruebas).toEqual([]);
  });
});
