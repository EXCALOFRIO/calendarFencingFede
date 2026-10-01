import { describe, expect, it } from 'vitest';
import type { CandidatoComplementario, PlanComplementario, PruebaCanonica } from '@/lib/ingest/conciliar-complementario';
import {
  persistirComplemento,
  persistirEnlaces,
  type DepsComplemento,
} from '@/lib/ingest/complementarios-persist';
import type { ResultadoEnlace } from '@/lib/ingest/enlaces-resultados';
import type { FilaCoberturaGenerica } from '@/lib/ingest/fie-resultados-db';
import type { FilaResultado } from '@/lib/ingest/fie-resultados-persist';

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
const escribir: PlanComplementario = { accion: 'escribir', cobertura: 'completo', puestos, asaltos: 'no_importados' };

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
