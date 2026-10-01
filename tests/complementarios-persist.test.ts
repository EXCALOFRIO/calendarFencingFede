import { describe, expect, it } from 'vitest';
import type { AsaltoComplementario } from '@/lib/ingest/asaltos-complementarios';
import type {
  CandidatoComplementario,
  PlanAsaltos,
  PlanComplementario,
  PruebaCanonica,
} from '@/lib/ingest/conciliar-complementario';
import {
  persistirAsaltosComplemento,
  persistirComplemento,
  persistirEnlaces,
  type DepsAsaltosComplemento,
  type DepsComplemento,
} from '@/lib/ingest/complementarios-persist';
import type { ResultadoEnlace } from '@/lib/ingest/enlaces-resultados';
import type { FilaCoberturaGenerica } from '@/lib/ingest/fie-resultados-db';
import type { FilaAsalto, FilaResultado } from '@/lib/ingest/fie-resultados-persist';

const prueba: PruebaCanonica = {
  fuente: 'skermo_rfee',
  season: '2024',
  clave: 'm1',
  serie: 'campeonato_mediterraneo',
  nombreEdicion: 'Campeonato del Mediterráneo',
  ciudad: 'La Nucía',
  fecha: '2024-02-03',
  arma: 'ESPADA',
  genero: 'M',
  categoria: 'M17',
  formato: 'INDIVIDUAL',
};
const candidato: CandidatoComplementario = {
  proveedor: 'engarde',
  url: 'https://engarde-service.com/competition/rfee/med2024/em17',
  clave: 'rfee/med2024/em17',
  nombreTorneo: 'MEDITERRANEAN CHAMPIONSHIP 2024',
  ciudad: 'LA NUCIA',
  fecha: '2024-02-03',
  fechaPagina: null,
  arma: 'ESPADA',
  genero: 'M',
  categoria: 'M17',
  formato: 'INDIVIDUAL',
  formatoPagina: null,
  serie: 'campeonato_mediterraneo',
};

function falsas(identidad = true) {
  const escritos: { competitionId: string; source: string; filas: FilaResultado[] }[] = [];
  const coberturas: { source: string; fila: FilaCoberturaGenerica }[] = [];
  const deps: DepsComplemento = {
    esquema: async () => ({ identidad, referencias: identidad }),
    upsertResultados: async (competitionId, source, filas) => {
      escritos.push({ competitionId, source, filas });
      return { nuevos: filas.length, revisados: 0, sinCambios: 0 };
    },
    upsertCobertura: async (source, fila) => {
      coberturas.push({ source, fila });
    },
  };
  return { deps, escritos, coberturas };
}

const puestos = [
  { clave: 'engarde:a|ESP', nombre: 'A Uno', pais: 'ESP', club: null, posicion: 1, posicionRaw: '1', equipo: false },
  { clave: 'engarde:b|ITA', nombre: 'B Dos', pais: 'ITA', club: null, posicion: 3, posicionRaw: '3', equipo: false },
  { clave: 'engarde:c|FRA', nombre: 'C Tres', pais: 'FRA', club: null, posicion: 3, posicionRaw: '3', equipo: false },
];
const escribir: PlanComplementario = { accion: 'escribir', cobertura: 'completo', puestos };

describe('persistirComplemento', () => {
  it('escribe los puestos con la fuente del proveedor, sin persona y con el día de la prueba', async () => {
    const { deps, escritos, coberturas } = falsas();
    const r = await persistirComplemento(deps, { competitionId: 'c-1', prueba, candidato, plan: escribir, publicado: 3 });
    expect(r).toMatchObject({ estado: 'aplicado', accion: 'escribir', cobertura: 'completo', puestos: { nuevos: 3 } });
    expect(escritos).toHaveLength(1);
    expect(escritos[0]).toMatchObject({ competitionId: 'c-1', source: 'engarde' });
    expect(escritos[0].filas.every((f) => f.personId === null && f.occurredOn === '2024-02-03')).toBe(true);
    expect(new Set(escritos[0].filas.map((f) => f.sourceFactKey)).size).toBe(3);
    expect(new Set(escritos[0].filas.map((f) => f.contentHash)).size).toBe(3);
    expect(coberturas[0]).toMatchObject({
      source: 'engarde',
      fila: { factKind: 'results', competitionKey: 'rfee/med2024/em17', status: 'completo', publishedTotal: 3, importedTotal: 3 },
    });
  });

  it('sin hechos distingue sin_resultados (cero publicado), no_publicado (pendiente) y error, sin escribir puestos', async () => {
    for (const [estado, status] of [['sin_resultados', 'sin_resultados'], ['no_publicado', 'pendiente'], ['error', 'error']] as const) {
      const { deps, escritos, coberturas } = falsas();
      await persistirComplemento(deps, {
        competitionId: 'c-1',
        prueba,
        candidato,
        plan: { accion: 'sin_hechos', estado, motivo: estado === 'sin_resultados' ? null : 'motivo' },
        publicado: null,
      });
      expect(escritos).toEqual([]);
      expect(coberturas[0].fila.status).toBe(status);
      expect(coberturas[0].fila.cursor).toBe(estado);
      if (estado === 'sin_resultados') expect(coberturas[0].fila).toMatchObject({ publishedTotal: 0, importedTotal: 0 });
      // Un fallo no pisa las cifras anteriores.
      else expect(coberturas[0].fila.publishedTotal).toBeUndefined();
    }
  });

  it('rechazar, revisión, diferir, sin cambios y conflicto no escriben nada', async () => {
    const planes: PlanComplementario[] = [
      { accion: 'rechazar', motivos: ['otra_edicion'] },
      { accion: 'revision', motivos: ['fecha_difiere'] },
      { accion: 'diferir', motivo: 'primaria_pendiente' },
      { accion: 'sin_cambios', motivo: 'ya_canonico' },
      { accion: 'conflicto', motivo: 'x' },
    ];
    for (const plan of planes) {
      const { deps, escritos, coberturas } = falsas();
      const r = await persistirComplemento(deps, { competitionId: 'c-1', prueba, candidato, plan, publicado: null });
      expect(r.estado).toBe('aplicado');
      expect(escritos).toEqual([]);
      expect(coberturas).toEqual([]);
    }
  });

  it('sin el esquema deportivo no escribe', async () => {
    const { deps, escritos, coberturas } = falsas(false);
    const r = await persistirComplemento(deps, { competitionId: 'c-1', prueba, candidato, plan: escribir, publicado: 3 });
    expect(r.estado).toBe('esquema_no_aplicado');
    expect(escritos).toEqual([]);
    expect(coberturas).toEqual([]);
  });
});

describe('persistirEnlaces', () => {
  const base = { resultadosImportados: false } as const;
  const enlaces: Record<'engarde' | 'fww' | 'ftl', ResultadoEnlace> = {
    engarde: { ...base, proveedor: 'engarde', estado: 'no_publicado', url: null, motivos: ['sin_enlace_especifico'] },
    fww: { ...base, proveedor: 'fww', estado: 'rechazado', url: null, motivos: ['otro_anio'] },
    ftl: { ...base, proveedor: 'ftl', estado: 'solo_enlace', url: 'https://www.fencingtimelive.com/tournaments/eventSchedule/abc', motivos: [] },
  };

  it('guarda un estado por proveedor; FTL queda solo_enlace con cero importados', async () => {
    const { deps, coberturas } = falsas();
    const r = await persistirEnlaces(deps, { fuente: 'fie', season: '2027', clave: '1387' }, enlaces);
    expect(r).toEqual({ engarde: 'pendiente', fww: 'conflicto', ftl: 'completo' });
    const ftl = coberturas.find((c) => c.source === 'enlace:ftl')!.fila;
    expect(ftl).toMatchObject({
      factKind: 'link',
      competitionKey: 'fie:1387',
      season: '2027',
      importedTotal: 0,
      cursor: 'solo_enlace',
      sourceUrl: 'https://www.fencingtimelive.com/tournaments/eventSchedule/abc',
    });
    const engarde = coberturas.find((c) => c.source === 'enlace:engarde')!.fila;
    expect(engarde).toMatchObject({ status: 'pendiente', cursor: 'no_publicado', sourceUrl: null });
    expect(coberturas.find((c) => c.source === 'enlace:fww')!.fila.lastError).toBe('otro_anio');
  });

  it('un error al comprobar queda como error, distinto de no publicado', async () => {
    const { deps, coberturas } = falsas();
    await persistirEnlaces(
      deps,
      { fuente: 'fie', season: '2027', clave: '1387' },
      { ...enlaces, engarde: { ...base, proveedor: 'engarde', estado: 'error', url: null, motivos: ['no_comprobable'] } },
    );
    expect(coberturas.find((c) => c.source === 'enlace:engarde')!.fila).toMatchObject({ status: 'error', cursor: 'error' });
  });
});

describe('persistirAsaltosComplemento', () => {
  function falsasAsaltos(identidad = true) {
    const escritos: { competitionId: string; source: string; filas: FilaAsalto[] }[] = [];
    const coberturas: { source: string; fila: FilaCoberturaGenerica }[] = [];
    const deps: DepsAsaltosComplemento = {
      esquema: async () => ({ identidad, referencias: identidad }),
      upsertAsaltos: async (competitionId, source, filas) => {
        escritos.push({ competitionId, source, filas });
        return { nuevos: filas.length, revisados: 0, sinCambios: 0 };
      },
      upsertCobertura: async (source, fila) => {
        coberturas.push({ source, fila });
      },
    };
    return { deps, escritos, coberturas };
  }

  const cuadroUrl = 'https://engarde-service.com/competition/rfee/med2024/em17/tableau16.htm';
  const asalto = (extra: Partial<AsaltoComplementario> = {}): AsaltoComplementario => ({
    fase: 'TABLEAU',
    ronda: 'T16',
    refA: 'engarde:garcia ana|ESP',
    refB: 'engarde:lopez beatriz|ESP',
    nombreA: 'GARCIA Ana',
    nombreB: 'LOPEZ Beatriz',
    puntosA: 15,
    puntosB: 11,
    url: cuadroUrl,
    ...extra,
  });
  const escribirAsaltos = (asaltos: AsaltoComplementario[], extra: Partial<Extract<PlanAsaltos, { accion: 'escribir' }>> = {}): PlanAsaltos => ({
    accion: 'escribir',
    fase: 'TABLEAU',
    cobertura: 'completo',
    publicado: asaltos.length,
    asaltos,
    ...extra,
  });
  const entrada = (plan: PlanAsaltos, fase: 'POULE' | 'TABLEAU' = 'TABLEAU') => ({ competitionId: 'c-1', prueba, candidato, fase, plan });

  it('escribe cada asalto con la fuente del proveedor, sin persona, con origen y el día de la prueba', async () => {
    const { deps, escritos, coberturas } = falsasAsaltos();
    const r = await persistirAsaltosComplemento(deps, entrada(escribirAsaltos([asalto()])));
    expect(r).toMatchObject({ estado: 'aplicado', accion: 'escribir', cobertura: 'completo', asaltos: { nuevos: 1 } });
    expect(escritos).toHaveLength(1);
    expect(escritos[0]).toMatchObject({ competitionId: 'c-1', source: 'engarde' });
    const f = escritos[0].filas[0];
    expect(f).toMatchObject({
      phase: 'TABLEAU',
      roundKey: 'T16',
      fencerAPersonId: null,
      fencerBPersonId: null,
      occurredOn: '2024-02-03',
      sourceUrl: cuadroUrl,
    });
    expect([f.fencerAName, f.fencerBName].sort()).toEqual(['GARCIA Ana', 'LOPEZ Beatriz']);
    expect(coberturas[0]).toMatchObject({
      source: 'engarde',
      fila: { factKind: 'tableau', competitionKey: 'rfee/med2024/em17', status: 'completo', publishedTotal: 1, importedTotal: 1 },
    });
  });

  it('las referencias de Engarde se guardan con orden independiente de la collation y el tanteo sigue a su tirador', async () => {
    const { deps, escritos } = falsasAsaltos();
    // En JS «á» ordena después de «z»; en una collation de diccionario, no. El hash fija un orden único.
    const a = asalto({ refA: 'engarde:álvarez ana|ESP', refB: 'engarde:zuñiga eva|ESP', nombreA: 'ÁLVAREZ Ana', nombreB: 'ZUÑIGA Eva', puntosA: 15, puntosB: 3 });
    await persistirAsaltosComplemento(deps, entrada(escribirAsaltos([a])));
    const f = escritos[0].filas[0];
    expect(f.fencerARef).toMatch(/^engarde:[0-9a-f]{32}$/);
    expect(f.fencerBRef).toMatch(/^engarde:[0-9a-f]{32}$/);
    expect(f.fencerARef < f.fencerBRef).toBe(true);
    const porNombre = new Map([[f.fencerAName, f.scoreA], [f.fencerBName, f.scoreB]]);
    expect(porNombre.get('ÁLVAREZ Ana')).toBe(15);
    expect(porNombre.get('ZUÑIGA Eva')).toBe(3);
  });

  it('un duelo publicado desde las dos perspectivas es un solo asalto', async () => {
    const { deps, escritos, coberturas } = falsasAsaltos();
    const a = asalto();
    const inverso = asalto({ refA: a.refB, refB: a.refA, nombreA: a.nombreB, nombreB: a.nombreA, puntosA: a.puntosB, puntosB: a.puntosA });
    await persistirAsaltosComplemento(deps, entrada(escribirAsaltos([a, inverso], { publicado: 1 })));
    expect(escritos[0].filas).toHaveLength(1);
    expect(coberturas[0].fila).toMatchObject({ publishedTotal: 1, importedTotal: 1 });
  });

  it('conserva la referencia FWW publicada y no confirma ninguna persona', async () => {
    const { deps, escritos } = falsasAsaltos();
    const fww = { ...candidato, proveedor: 'fww' as const, clave: '926885-2025', url: 'https://www.fencingworldwide.com/en/926885-2025/pools/1' };
    const pool = asalto({ fase: 'POULE', ronda: 'R1P1', refA: 'fww:athlete:90101', refB: 'fww:athlete:90102', url: fww.url });
    await persistirAsaltosComplemento(
      deps,
      { competitionId: 'c-1', prueba, candidato: fww, fase: 'POULE', plan: escribirAsaltos([pool], { fase: 'POULE' }) },
    );
    expect(escritos[0].source).toBe('fww');
    expect(escritos[0].filas[0]).toMatchObject({
      phase: 'POULE',
      fencerARef: 'fww:athlete:90101',
      fencerBRef: 'fww:athlete:90102',
      fencerAPersonId: null,
      fencerBPersonId: null,
      sourceUrl: fww.url,
    });
  });

  it('poules y cuadro tienen cobertura propia (pools / tableau), distinta de la de los finales', async () => {
    const poules = falsasAsaltos();
    await persistirAsaltosComplemento(poules.deps, entrada(escribirAsaltos([asalto({ fase: 'POULE', ronda: 'R1P1' })], { fase: 'POULE', cobertura: 'parcial', publicado: 3 }), 'POULE'));
    expect(poules.coberturas[0].fila).toMatchObject({ factKind: 'pools', status: 'parcial', publishedTotal: 3, importedTotal: 1, cursor: 'parcial' });
  });

  it('sin hechos distingue sin_resultados, no_publicado y error sin escribir asaltos ni pisar cifras', async () => {
    for (const [estado, status] of [['sin_resultados', 'sin_resultados'], ['no_publicado', 'pendiente'], ['error', 'error']] as const) {
      const { deps, escritos, coberturas } = falsasAsaltos();
      await persistirAsaltosComplemento(
        deps,
        entrada({ accion: 'sin_hechos', estado, motivo: estado === 'sin_resultados' ? null : 'motivo' }),
      );
      expect(escritos).toEqual([]);
      expect(coberturas[0].fila).toMatchObject({ factKind: 'tableau', status, cursor: estado });
      if (estado === 'sin_resultados') expect(coberturas[0].fila).toMatchObject({ publishedTotal: 0, importedTotal: 0 });
      else expect(coberturas[0].fila.publishedTotal).toBeUndefined();
    }
  });

  it('rechazar, revisión, diferir y sin cambios no escriben nada, ni un plan de otra fase', async () => {
    const planes: PlanAsaltos[] = [
      { accion: 'rechazar', motivos: ['sin_asaltos_equipos'] },
      { accion: 'revision', motivos: ['edicion_no_verificable'] },
      { accion: 'diferir', motivo: 'primaria_pendiente' },
      { accion: 'sin_cambios', motivo: 'primaria_publica' },
      escribirAsaltos([asalto()], { fase: 'POULE' }),
    ];
    for (const plan of planes) {
      const { deps, escritos, coberturas } = falsasAsaltos();
      const r = await persistirAsaltosComplemento(deps, entrada(plan));
      expect(r.estado).toBe('aplicado');
      expect(escritos).toEqual([]);
      expect(coberturas).toEqual([]);
    }
  });

  it('sin el esquema deportivo no escribe', async () => {
    const { deps, escritos, coberturas } = falsasAsaltos(false);
    const r = await persistirAsaltosComplemento(deps, entrada(escribirAsaltos([asalto()])));
    expect(r.estado).toBe('esquema_no_aplicado');
    expect(escritos).toEqual([]);
    expect(coberturas).toEqual([]);
  });
});
