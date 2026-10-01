import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DepsEvidencia } from '@/lib/entries/evidencia';
import type { ExternalIdRow } from '@/lib/identity/resolver';
import {
  persistirLecturaFie,
  type DepsPersistenciaFie,
  type FilaAsalto,
  type FilaCobertura,
  type FilaResultado,
  type ResumenEscritura,
} from '@/lib/ingest/fie-resultados-persist';
import {
  leerPruebaFie,
  urlCuadro,
  urlPoules,
  urlRanking,
  type DepsLecturaFie,
} from '@/lib/ingest/sources/fie-resultados';
import { conflictosDeConfirmacion, type DepsGuardConfirmacion } from '@/lib/sport/id-guard';

/**
 * La persistencia se prueba con un almacén EN MEMORIA que imita el contrato de
 * `fie-resultados-db.ts` (clave natural, revisión sólo si cambia el hash,
 * persona rellenada si llega después). Es una simulación: no demuestra SQL
 * contra Neon, sólo que la orquestación (identidad, guard, cobertura,
 * idempotencia) hace lo que debe con ese contrato.
 */

type Fixture = { respuestas: Record<string, unknown> };
const cargar = (nombre: string): Fixture =>
  JSON.parse(readFileSync(new URL(`./fixtures/fie-resultados/${nombre}.json`, import.meta.url), 'utf8'));

function lector(fx: Fixture, fallos: Record<string, string> = {}): DepsLecturaFie {
  return {
    async fetchJson(url) {
      if (fallos[url]) throw new Error(fallos[url]);
      if (!(url in fx.respuestas)) throw new Error(`HTTP 404 al pedir ${url}`);
      return structuredClone(fx.respuestas[url]);
    },
  };
}

function almacen(opciones: { esquema?: boolean; externosPrevios?: ExternalIdRow[] } = {}) {
  const externos: ExternalIdRow[] = [...(opciones.externosPrevios ?? [])];
  const personasCreadas: { id: string; nombre: string; pais: string | null; genero: string | null }[] = [];
  const resultados = new Map<string, FilaResultado & { revision: number }>();
  const asaltos = new Map<string, FilaAsalto & { revision: number }>();
  const cobertura = new Map<string, FilaCobertura & { intentos: number }>();
  const escrituras: string[] = [];
  let pruebas = 0;
  let n = 0;

  const evidencia: DepsEvidencia = {
    esquema: async () => ({ identidad: true, referencias: true }),
    atletasPorLicencia: async () => [],
    fichasFie: async () => [],
    externos: async (valores) => externos.filter((e) => valores.includes(e.value)),
    personas: async (ids) =>
      new Map(ids.map((id) => [id, { athleteId: null, mergedIntoPersonId: null }])),
  };

  const guard: DepsGuardConfirmacion = {
    async confirmar(c, persona) {
      if (conflictosDeConfirmacion(externos, c).length > 0) return false;
      if (persona) {
        personasCreadas.push({
          id: persona.id,
          nombre: persona.displayName,
          pais: persona.countryCode,
          genero: persona.gender,
        });
      }
      externos.push({ ...c, linkStatus: 'CONFIRMADO' });
      return true;
    },
    async conflictos(c) {
      return conflictosDeConfirmacion(externos, c);
    },
  };

  function escribir<T extends { contentHash: string; personId?: string | null }>(
    mapa: Map<string, T & { revision: number }>,
    clave: string,
    fila: T,
    res: ResumenEscritura,
  ) {
    const previa = mapa.get(clave);
    if (!previa) {
      mapa.set(clave, { ...fila, revision: 1 });
      res.nuevos += 1;
    } else if (previa.contentHash !== fila.contentHash) {
      mapa.set(clave, { ...fila, revision: previa.revision + 1 });
      res.revisados += 1;
    } else {
      res.sinCambios += 1;
    }
  }

  const deps: DepsPersistenciaFie = {
    esquema: async () => ({ identidad: opciones.esquema ?? true, referencias: true }),
    evidencia,
    guard,
    nuevoId: () => `persona-${(n += 1)}`,
    async upsertPrueba() {
      pruebas += 1;
      escrituras.push('prueba');
      return 'comp-1';
    },
    async upsertResultados(_c, filas) {
      escrituras.push('resultados');
      const res = { nuevos: 0, revisados: 0, sinCambios: 0 };
      for (const f of filas) escribir(resultados, f.sourceFactKey, f, res);
      return res;
    },
    async upsertAsaltos(_c, filas) {
      escrituras.push('asaltos');
      const res = { nuevos: 0, revisados: 0, sinCambios: 0 };
      for (const f of filas) {
        escribir(asaltos, `${f.phase}|${f.roundKey}|${f.fencerARef}|${f.fencerBRef}`, f, res);
      }
      return res;
    },
    async upsertCobertura(f) {
      escrituras.push(`cobertura:${f.factKind}`);
      const clave = `${f.season}|${f.factKind}|${f.competitionKey}`;
      const previa = cobertura.get(clave);
      cobertura.set(clave, {
        ...f,
        // Una lectura fallida no pisa las cifras anteriores.
        publishedTotal: f.publishedTotal === undefined ? previa?.publishedTotal : f.publishedTotal,
        importedTotal: f.importedTotal === undefined ? previa?.importedTotal : f.importedTotal,
        intentos: (previa?.intentos ?? 0) + 1,
      });
    },
  };
  return { deps, externos, personasCreadas, resultados, asaltos, cobertura, escrituras, pruebas: () => pruebas };
}

const bogota = () => cargar('bogota-2027-1478');
const confirmado = (over: Partial<ExternalIdRow>): ExternalIdRow => ({
  personId: 'previa',
  scheme: 'fie_addr_id',
  value: '70490',
  scopeSource: 'fie',
  scopeFederation: '',
  scopeSeason: '',
  scopeWeapon: '',
  validFrom: '1900-01-01',
  validTo: null,
  linkStatus: 'CONFIRMADO',
  ...over,
});

describe('persistencia de resultados FIE (almacén simulado)', () => {
  it('con el esquema sin aplicar no escribe nada', async () => {
    const a = almacen({ esquema: false });
    const lectura = await leerPruebaFie(2027, 1478, lector(bogota()));
    const r = await persistirLecturaFie(a.deps, lectura);
    expect(r.estado).toBe('esquema_no_aplicado');
    expect(a.escrituras).toEqual([]);
  });

  it('Bogotá: 28 puestos, 84 asaltos de poule y 21 de cuadro, con cobertura completa', async () => {
    const a = almacen();
    const lectura = await leerPruebaFie(2027, 1478, lector(bogota()));
    const r = await persistirLecturaFie(a.deps, lectura);
    expect(r.puestos).toEqual({ nuevos: 28, revisados: 0, sinCambios: 0 });
    expect(r.poules.nuevos).toBe(84);
    expect(r.cuadro.nuevos).toBe(21);
    expect(a.resultados.size).toBe(28);
    expect(a.asaltos.size).toBe(105);
    expect(r.cobertura).toEqual({ ranking: 'completo', pools: 'completo', tableau: 'completo' });
    expect(a.cobertura.get('2027|ranking|1478')).toMatchObject({ publishedTotal: 28, importedTotal: 28 });
  });

  it('guarda el puesto de la prueba y el ID FIE como clave del hecho, no el nombre', async () => {
    const a = almacen();
    const lectura = await leerPruebaFie(2027, 1478, lector(bogota()));
    await persistirLecturaFie(a.deps, lectura);
    const primero = lectura.ranking!.puestos[0];
    const fila = a.resultados.get(String(primero.fieId))!;
    expect(fila.position).toBe(primero.posicion);
    expect(fila.sourceUrl).toBe('https://fie.org/api/fie/competition/2027/1478/results/ranking');
    expect(fila.sourceFactKey).toBe(String(primero.fieId));
  });

  it('repetir la lectura no duplica ni revisa nada', async () => {
    const a = almacen();
    const lectura = await leerPruebaFie(2027, 1478, lector(bogota()));
    await persistirLecturaFie(a.deps, lectura);
    const segunda = await persistirLecturaFie(a.deps, lectura);
    expect(segunda.puestos).toEqual({ nuevos: 0, revisados: 0, sinCambios: 28 });
    expect(segunda.poules).toEqual({ nuevos: 0, revisados: 0, sinCambios: 84 });
    expect(segunda.cuadro).toEqual({ nuevos: 0, revisados: 0, sinCambios: 21 });
    expect(a.resultados.size).toBe(28);
    expect(a.asaltos.size).toBe(105);
    expect(a.personasCreadas).toHaveLength(28);
    expect([...a.resultados.values()].every((f) => f.revision === 1)).toBe(true);
  });

  it('una corrección de puesto o de marcador revisa la fila en vez de duplicarla', async () => {
    const a = almacen();
    await persistirLecturaFie(a.deps, await leerPruebaFie(2027, 1478, lector(bogota())));
    const fx = bogota();
    const pagina = fx.respuestas[urlRanking(2027, 1478, 1)] as { items: { rank: number }[] };
    // Los puestos 6 y 7 se intercambian.
    expect(pagina.items.slice(5, 7).map((i) => i.rank)).toEqual([6, 7]);
    pagina.items[5].rank = 7;
    pagina.items[6].rank = 6;
    const cuadro = fx.respuestas[urlCuadro(2027, 1478)] as {
      tableau: { rounds: { A2: { fencer2: { score: number } }[] } }[];
    };
    cuadro.tableau[0].rounds.A2[0].fencer2.score = 13;
    const r = await persistirLecturaFie(a.deps, await leerPruebaFie(2027, 1478, lector(fx)));
    expect(r.puestos).toMatchObject({ nuevos: 0, revisados: 2 });
    expect(r.cuadro).toMatchObject({ nuevos: 0, revisados: 1 });
    expect(a.resultados.size).toBe(28);
    expect(a.asaltos.size).toBe(105);
  });

  it('crea una persona por ID FIE con el ID confirmado a través del guard, sin biografía', async () => {
    const a = almacen();
    const lectura = await leerPruebaFie(2027, 1478, lector(bogota()));
    const r = await persistirLecturaFie(a.deps, lectura);
    expect(r.personas).toEqual({ confirmadas: 0, creadas: 28, enRevision: 0, conflictos: 0 });
    expect(a.externos).toHaveLength(28);
    expect(a.externos.every((e) => e.scheme === 'fie_addr_id' && e.scopeSource === 'fie')).toBe(true);
    expect(a.externos.every((e) => e.validFrom === '1900-01-01' && e.validTo === null)).toBe(true);
    const volcado = JSON.stringify(a.personasCreadas[0]);
    expect(Object.keys(JSON.parse(volcado)).sort()).toEqual(['genero', 'id', 'nombre', 'pais']);
  });

  it('reutiliza la persona ya confirmada para ese ID FIE y atribuye sus hechos', async () => {
    const a = almacen({ externosPrevios: [confirmado({ personId: 'previa', value: '70490' })] });
    const lectura = await leerPruebaFie(2027, 1478, lector(bogota()));
    const r = await persistirLecturaFie(a.deps, lectura);
    expect(r.personas).toMatchObject({ confirmadas: 1, creadas: 27 });
    expect(a.resultados.get('70490')?.personId).toBe('previa');
    const conElla = [...a.asaltos.values()].filter((x) => x.fencerAPersonId === 'previa' || x.fencerBPersonId === 'previa');
    expect(conElla.length).toBeGreaterThan(0);
    expect(a.personasCreadas.some((p) => p.nombre === 'FIE 70490')).toBe(false);
  });

  it('un ID FIE sólo propuesto no se promueve: el hecho se guarda con su ID y sin persona', async () => {
    const a = almacen({
      externosPrevios: [confirmado({ personId: 'candidata', value: '70490', linkStatus: 'PROPUESTO' })],
    });
    const r = await persistirLecturaFie(a.deps, await leerPruebaFie(2027, 1478, lector(bogota())));
    expect(r.personas).toMatchObject({ enRevision: 1, creadas: 27 });
    expect(a.resultados.get('70490')).toMatchObject({ personId: null, sourceFactKey: '70490' });
    expect(a.externos.some((e) => e.value === '70490' && e.personId === 'candidata' && e.linkStatus === 'CONFIRMADO')).toBe(false);
    expect(r.cobertura.ranking).toBe('conflicto');
  });

  it('el guard impide confirmar un ID FIE que se solapa con otra persona fuera de la fecha leída', async () => {
    // El resolvedor no ve esta fila (vigente desde 2030), pero la nueva [1900, ∞) la pisaría.
    const a = almacen({
      externosPrevios: [confirmado({ personId: 'futura', value: '70490', validFrom: '2030-01-01' })],
    });
    const r = await persistirLecturaFie(a.deps, await leerPruebaFie(2027, 1478, lector(bogota())));
    expect(r.personas).toMatchObject({ conflictos: 1, creadas: 27 });
    expect(a.resultados.get('70490')?.personId).toBeNull();
    expect(a.personasCreadas.some((p) => p.nombre === 'FIE 70490')).toBe(false);
    expect(a.externos.filter((e) => e.value === '70490')).toHaveLength(1);
  });

  it('París: 34 puestos y 34 duelos de cuadro con las poules vacías como «sin resultados»', async () => {
    const a = almacen();
    const r = await persistirLecturaFie(a.deps, await leerPruebaFie(2024, 246, lector(cargar('paris-2024-246'))));
    expect(r.puestos.nuevos).toBe(34);
    expect(r.poules).toEqual({ nuevos: 0, revisados: 0, sinCambios: 0 });
    expect(r.cuadro.nuevos).toBe(34);
    expect(r.cobertura).toEqual({ ranking: 'completo', pools: 'sin_resultados', tableau: 'completo' });
    expect(a.escrituras).not.toContain('asaltos:pools');
    expect(a.cobertura.get('2024|pools|246')).toMatchObject({ publishedTotal: 0, importedTotal: 0 });
  });

  it('equipos: se guarda la clasificación con clave de equipo, sin personas ni asaltos', async () => {
    const a = almacen();
    const r = await persistirLecturaFie(a.deps, await leerPruebaFie(2024, 250, lector(cargar('paris-2024-250-equipos'))));
    expect(r.puestos.nuevos).toBe(8);
    expect(r.personas).toEqual({ confirmadas: 0, creadas: 0, enRevision: 0, conflictos: 0 });
    expect(a.personasCreadas).toEqual([]);
    expect(a.externos).toEqual([]);
    expect(a.asaltos.size).toBe(0);
    expect([...a.resultados.keys()].every((k) => k.startsWith('team:'))).toBe(true);
    expect([...a.resultados.values()].every((f) => f.personId === null)).toBe(true);
    expect(Object.keys(r.cobertura)).toEqual(['ranking']);
  });

  it('una lectura fallida sólo toca la cobertura y conserva lo ya importado', async () => {
    const a = almacen();
    await persistirLecturaFie(a.deps, await leerPruebaFie(2027, 1478, lector(bogota())));
    const fallos = {
      [urlRanking(2027, 1478, 1)]: 'HTTP 503 al pedir ranking',
      [urlPoules(2027, 1478)]: 'HTTP 429 al pedir poules',
      [urlCuadro(2027, 1478)]: 'HTTP 500 al pedir cuadro',
    };
    const r = await persistirLecturaFie(a.deps, await leerPruebaFie(2027, 1478, lector(bogota(), fallos)));
    expect(r.puestos).toEqual({ nuevos: 0, revisados: 0, sinCambios: 0 });
    expect(r.cobertura).toEqual({ ranking: 'error', pools: 'error', tableau: 'error' });
    expect(a.resultados.size).toBe(28);
    expect(a.asaltos.size).toBe(105);
    const ranking = a.cobertura.get('2027|ranking|1478')!;
    expect(ranking).toMatchObject({ status: 'error', publishedTotal: 28, importedTotal: 28, intentos: 2 });
    expect(ranking.lastError).toMatch(/503/);
  });

  it('una segunda página fallida guarda los 24 leídos como parcial', async () => {
    const a = almacen();
    const fallos = { [urlRanking(2027, 1478, 2)]: 'HTTP 502 al pedir la página 2' };
    const r = await persistirLecturaFie(a.deps, await leerPruebaFie(2027, 1478, lector(bogota(), fallos)));
    expect(r.puestos.nuevos).toBe(24);
    expect(r.cobertura.ranking).toBe('parcial');
    expect(a.cobertura.get('2027|ranking|1478')).toMatchObject({ publishedTotal: 28, importedTotal: 24 });
  });

  it('si la metadata no se lee, sólo se anota el error de la prueba', async () => {
    const a = almacen();
    const fallos = { 'https://fie.org/api/fie/competition/2027/1478': 'HTTP 500 al pedir la prueba' };
    const r = await persistirLecturaFie(a.deps, await leerPruebaFie(2027, 1478, lector(bogota(), fallos)));
    expect(r.competitionId).toBeNull();
    expect(a.pruebas()).toBe(0);
    expect(a.escrituras).toEqual(['cobertura:competitions']);
    expect(a.cobertura.get('2027|competitions|1478')).toMatchObject({ status: 'error' });
  });
});
