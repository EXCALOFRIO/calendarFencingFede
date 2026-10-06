import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HechosPrueba } from '../src/lib/ingest/hechos/formato';
import type { FilaInventario } from '../scripts/indexado/engarde-descargar';
import { EscritorHechos } from '../scripts/indexado/lote7-faltan-comun';
import { documentoArchivado } from '../scripts/indexado/lote7-faltan-engarde-wayback';
import { armaGeneroDeCodigo, divisionLiga, esNacional, Existentes, fasesDeUnaPrueba, validarAtributos } from '../scripts/indexado/lote7-faltan-engarde';
import { asignar, candidatos, instanciasEquipos, tipoEvento } from '../scripts/indexado/lote7-faltan-fie-equipos';
import { clasificarFila, compatibles, idPdf, type PruebaBase } from '../scripts/indexado/lote7-faltan-huecos';
import type { Objetivo } from '../scripts/indexado/fie-huecos-objetivos';
import type { SeccionOphardt, TorneoOphardt } from '../scripts/indexado/fie-huecos-ophardt';

const dia = (f: string) => Math.round(Date.parse(`${f}T00:00:00Z`) / 86_400_000);

const objetivo = (o: Partial<Objetivo>): Objetivo => ({
  id: 'x', season: '2012', competitionKey: '1', weapon: 'ESPADA', gender: 'M', category: 'M17', categoryRaw: null, format: 'EQUIPOS',
  date: '2012-03-01', tournamentKey: 'competition:1', editionName: "Championnats d'Europe Cadets", startDate: '2012-03-01',
  endDate: '2012-03-01', city: 'Porec', countryCode: 'CRO', sourceUrl: null, ...o,
});

const torneo = (t: Partial<TorneoOphardt>): TorneoOphardt => ({ id: '1', desde: '2012-02-28', nacion: 'CRO', ciudad: 'Porec', titulo: '2012 European Championships U17', edades: 'U17', ...t });

const seccion = (s: Partial<SeccionOphardt>): SeccionOphardt => ({
  titulo: "Epee Men's U17 Team", weapon: 'ESPADA', gender: 'M', category: 'M17', format: 'EQUIPOS', individuales: [],
  equipos: [
    { claveFuente: 'ophardt:team:ITA', name: 'Italy', countryCode: 'ITA', club: null, position: 1, positionRaw: '1' },
    { claveFuente: 'ophardt:team:FRA', name: 'France', countryCode: 'FRA', club: null, position: 2, positionRaw: '2' },
  ],
  ...s,
});

describe('FIE por equipos desde Ophardt', () => {
  it('reconoce el tipo de campeonato y descarta los que no tienen correspondencia', () => {
    expect(tipoEvento("Championnats d'Europe Cadets", 'Porec')?.tipo).toBe('Europeos');
    expect(tipoEvento('Champ du monde juniors-cadets', 'Plovdiv')?.tipo).toBe('Mundiales');
    expect(tipoEvento('Jeux Asiatiques', 'Busan')?.tipo).toBe('Juegos Asiáticos');
    expect(tipoEvento('Championnats asiatiques juniors-Team', 'Bali')?.tipo).toBe('Asiáticos');
    expect(tipoEvento('Coupe du Monde par équipes', 'Leszno')?.mismaNacion).toBe(true);
    expect(tipoEvento('EM-EQ', 'Pekin')?.tipo).toBe('Juegos Olímpicos');
    expect(tipoEvento('ME-TEAM', 'RANKING FIE')).toBeNull();
    expect(tipoEvento('JOJ 2018 Mixed team event', 'Buenos Aires')).toBeNull();
  });

  it('agrupa por edición, aparta los marcadores de la temporada siguiente y abre la ventana por tipo', () => {
    const r = instanciasEquipos([
      objetivo({ competitionKey: '1' }),
      objetivo({ competitionKey: '2', weapon: 'SABLE' }),
      objetivo({ competitionKey: '3', season: '2027', date: '2026-02-26', startDate: '2026-02-26', city: 'TBD' }),
      objetivo({ competitionKey: '4', editionName: 'ME-TEAM', city: 'RANKING FIE' }),
    ]);
    expect(r.instancias).toHaveLength(1);
    expect(r.instancias[0].objetivos).toHaveLength(2);
    expect(r.instancias[0].desde).toBe('2012-01-16');
    expect(r.marcadores.map((o) => o.competitionKey)).toEqual(['3']);
    expect(r.sinTipo.map((o) => o.competitionKey)).toEqual(['4']);
  });

  it('filtra candidatos por título, veteranos y, en Copas del Mundo, por nación', () => {
    const inst = instanciasEquipos([objetivo({})]).instancias[0];
    const c = candidatos(inst, [torneo({ id: 'a' }), torneo({ id: 'b', titulo: 'European Championships Veterans' }), torneo({ id: 'c', titulo: 'Coupe d Europe' })]);
    expect(c.map((t) => t.id)).toEqual(['a']);
    const copa = instanciasEquipos([objetivo({ editionName: 'Coupe du Monde par équipes', countryCode: 'POL', city: 'Leszno' })]).instancias[0];
    expect(candidatos(copa, [torneo({ id: 'x', titulo: 'World Cup', nacion: 'GER' }), torneo({ id: 'y', titulo: 'World Cup', nacion: 'POL' })]).map((t) => t.id)).toEqual(['y']);
  });

  it('asigna sólo la sección única con arma, género, categoría y equipos; si hay varias, decide el país de la edición', () => {
    const o = objetivo({});
    const cand = (id: string, nacion: string, secciones: SeccionOphardt[]) => ({ torneo: torneo({ id, nacion }), secciones, url: `u${id}`, sha256: 'f'.repeat(64) });
    expect(asignar(o, [cand('1', 'CRO', [seccion({}), seccion({ category: 'M20' })])]).ok).toBe(true);
    expect(asignar(o, [cand('1', 'CRO', [seccion({ category: 'M20' })])])).toEqual({ ok: false, motivo: 'ninguna_seccion_casa' });
    expect(asignar(o, [])).toEqual({ ok: false, motivo: 'sin_torneo_ophardt' });
    const dos = asignar(o, [cand('1', 'CRO', [seccion({})]), cand('2', 'SLO', [seccion({})])]);
    expect(dos.ok && dos.candidato.torneo.id).toBe('1');
    expect(asignar(o, [cand('1', 'SLO', [seccion({})]), cand('2', 'AUT', [seccion({})])]).ok).toBe(false);
    expect(asignar(o, [cand('1', 'CRO', [seccion({ equipos: seccion({}).equipos.slice(0, 1) })])]).ok).toBe(false);
  });
});

const prueba = (p: Partial<PruebaBase>): PruebaBase => ({
  source: 'rfee_pdf', key: 'k', weapon: 'ESPADA', gender: 'M', category: 'M17', format: 'INDIVIDUAL', d: dia('2019-03-23'), url: null, resultados: 1, ...p,
});

const fila = (f: Partial<FilaInventario>): FilaInventario => ({
  fuente: 'skermo_rfee', temporada: '2018-2019', claveCatalogo: 'c1', nombre: 'TNR M-17', fecha: '2019-03-23', arma: 'ESPADA', genero: 'M',
  categoria: 'M17', formato: 'INDIVIDUAL', enlaces: [], ...f,
});

describe('inventario de huecos del catálogo', () => {
  it('compara arma, categoría, modalidad, género (el mixto vale para ambos) y fecha a ±2 días', () => {
    const f = { arma: 'FLORETE', genero: 'F', categoria: 'VET', formato: 'INDIVIDUAL', fecha: '2019-06-22' };
    expect(compatibles(prueba({ weapon: 'FLORETE', gender: 'MIXTO', category: 'VET', d: dia('2019-06-22') }), f)).toBe(true);
    expect(compatibles(prueba({ weapon: 'FLORETE', gender: 'M', category: 'VET', d: dia('2019-06-22') }), f)).toBe(false);
    expect(compatibles(prueba({ weapon: 'FLORETE', gender: 'F', category: 'VET', d: dia('2019-06-25') }), f)).toBe(false);
    expect(compatibles(prueba({ weapon: 'FLORETE', gender: 'F', category: 'VET', d: dia('2019-06-24') }), f)).toBe(true);
  });

  it('clasifica cada hueco por su causa', () => {
    const pdf = 'https://app.skermo.org/client/1/48ee2076179a5cc851abd57d3a71e0f9.pdf';
    expect(idPdf(pdf)).toBe('48ee2076179a5cc851abd57d3a71e0f9');
    const equipos = prueba({ format: 'EQUIPOS', key: 'pdf:48ee2076179a5cc851abd57d3a71e0f9:x' });
    const docs = new Map([['48ee2076179a5cc851abd57d3a71e0f9', [equipos]]]);
    expect(clasificarFila(fila({}), [prueba({})], new Map(), [], new Set()).clase).toBe('cubierta');
    expect(clasificarFila(fila({}), [prueba({ source: 'fie' })], new Map(), [], new Set()).clase).toBe('cubierta_fie');
    expect(clasificarFila(fila({}), [], new Map(), [prueba({ source: 'engarde' })], new Set()).clase).toBe('recuperada_lote7');
    expect(clasificarFila(fila({ enlaces: [{ tipo: 'pdf', url: pdf }] }), [equipos], docs, [], new Set()).clase).toBe('documento_en_otra_prueba');
    const eg = fila({ enlaces: [{ tipo: 'externo', url: 'https://engarde-service.com/files/bhc/capespinf/' }] });
    expect(clasificarFila(eg, [], new Map(), [], new Set(['bhc/capespinf'])).clase).toBe('engarde_sin_datos');
    expect(clasificarFila(eg, [], new Map(), [], new Set()).clase).toBe('pendiente');
    expect(clasificarFila(fila({}), [], new Map(), [], new Set()).clase).toBe('sin_documento');
  });
});

describe('Engarde nacional que falta', () => {
  it('considera nacionales los torneos de la RFEE, los enlazados y los de título nacional', () => {
    const enlazados = new Set(['fce/opensabadell2019']);
    expect(esNacional({ org: 'rfee', evt: 'x', titulo: 'Lo que sea' }, enlazados)).toBe(true);
    expect(esNacional({ org: 'fce', evt: 'opensabadell2019', titulo: 'International Open' }, enlazados)).toBe(true);
    expect(esNacional({ org: 'fecyl', evt: 'z', titulo: 'TORNEO NACIONAL DE RANKING M-20 ZARATÁN' }, enlazados)).toBe(true);
    expect(esNacional({ org: 'fme', evt: 'y', titulo: 'Campeonato de España M-15' }, enlazados)).toBe(true);
    expect(esNacional({ org: 'fme', evt: 'y', titulo: 'Liga M-17 Sable Masculino 18/19' }, enlazados)).toBe(false);
    expect(esNacional({ org: 'fce', evt: 'y', titulo: 'Lliga Catalana 1 - Floret i Sabre' }, enlazados)).toBe(false);
  });

  it('una prueba existe si cualquier fuente tiene una equivalente a ±2 días o su misma clave', () => {
    const ex = new Existentes([{ source: 'skermo_rfee', weapon: 'ESPADA', gender: 'M', category: 'M17', format: 'INDIVIDUAL', d: dia('2026-10-03') }], ['engarde:a/b/c']);
    expect(ex.hay({ weapon: 'ESPADA', gender: 'M', category: 'M17', format: 'INDIVIDUAL', fecha: '2026-10-05' })).toBe(true);
    expect(ex.hay({ weapon: 'ESPADA', gender: 'MIXTO', category: 'M17', format: 'INDIVIDUAL', fecha: '2026-10-03' })).toBe(true);
    expect(ex.hay({ weapon: 'ESPADA', gender: 'F', category: 'M17', format: 'INDIVIDUAL', fecha: '2026-10-03' })).toBe(false);
    expect(ex.hay({ weapon: 'ESPADA', gender: 'M', category: 'M17', format: 'EQUIPOS', fecha: '2026-10-03' })).toBe(false);
    expect(ex.tieneClave('engarde:a/b/c')).toBe(true);
  });

  it('contrasta los atributos del índice con el código y el título de la prueba', () => {
    expect(armaGeneroDeCodigo('ffind')).toEqual({ weapon: 'FLORETE', gender: 'F' });
    expect(armaGeneroDeCodigo('sm_eq')).toEqual({ weapon: 'SABLE', gender: 'M' });
    expect(armaGeneroDeCodigo('fm20eq')).toEqual({ weapon: 'FLORETE', gender: 'M' });
    expect(armaGeneroDeCodigo('smaplata')).toBeNull();
    const base = { compe: 'x', titulo: '', arma: 'ESPADA' as const, generoFinal: 'F' as const, categoriaFinal: 'M20' as const, individual: true, fecha: '2020-12-08' };
    // El título y el código coinciden: mandan sobre el índice.
    const r = validarAtributos({ ...base, compe: 'ffind', titulo: 'CAMPEONATO DE ESPAÑA JUNIOR FLORETE FEM.' });
    expect(r.ok && r.atributos.weapon).toBe('FLORETE');
    expect(r.ok && r.corregido).toBe(true);
    // Título y código se contradicen: no se atribuye.
    expect(validarAtributos({ ...base, compe: 'fm20eq', titulo: 'Sable Masculino', arma: 'SABLE', generoFinal: 'M', individual: false }).ok).toBe(false);
    // Sin título, el código sólo confirma: si contradice al índice, no se atribuye.
    expect(validarAtributos({ ...base, compe: 'sf_ind', titulo: 'CTO ESPAÑA SUB23 SM EQ', arma: 'SABLE', generoFinal: 'M', individual: false }).ok).toBe(false);
    const igual = validarAtributos({ ...base, compe: 'efi', titulo: 'Espada Femenina Individual' });
    expect(igual.ok && igual.corregido).toBe(false);
    expect(validarAtributos({ ...base, fecha: null }).ok).toBe(false);
  });

  it('aparta las pruebas de un torneo que no se distinguen entre sí (fases de una misma prueba)', () => {
    const a = (gender: string, category = 'M11', fecha = '2023-06-10') => ({ weapon: 'FLORETE', gender, category, format: 'INDIVIDUAL', fecha });
    expect([...fasesDeUnaPrueba([a('MIXTO'), a('M'), a('F', 'M13'), a('F', 'M11', '2023-06-20')])].sort()).toEqual([0, 1]);
    expect(fasesDeUnaPrueba([a('M'), a('F')]).size).toBe(0);
    // Las divisiones de la liga de clubes son pruebas distintas aunque compartan atributos.
    const liga = (division: string | null) => ({ weapon: 'SABLE', gender: 'M', category: 'ABS', format: 'EQUIPOS', fecha: '2024-04-06', division });
    expect(fasesDeUnaPrueba([liga('ORO'), liga('PLATA')]).size).toBe(0);
    expect(fasesDeUnaPrueba([liga('ORO'), liga(null)]).size).toBe(2);
  });

  it('reconoce la división de liga en títulos y códigos', () => {
    expect(divisionLiga('LIGA PLATA 3ª JORNADA')).toBe('PLATA');
    expect(divisionLiga('ema_liga_oro')).toBe('ORO');
    expect(divisionLiga('LIGA MASCULINA. 4º DIVISIÓN')).toBe('4DIV');
    expect(divisionLiga('Liga Iberdrola Florete Femenino')).toBe('IBERDROLA');
    expect(divisionLiga('TNR ABS Madrid')).toBeNull();
    const ex = new Existentes([{ source: 'rfee_pdf', weapon: 'SABLE', gender: 'M', category: 'ABS', format: 'EQUIPOS', d: dia('2024-04-06'), division: 'ORO' }], []);
    const p = { weapon: 'SABLE', gender: 'M', category: 'ABS', format: 'EQUIPOS', fecha: '2024-04-06' };
    expect(ex.hay({ ...p, division: 'PLATA' })).toBe(false);
    expect(ex.hay({ ...p, division: 'ORO' })).toBe(true);
    expect(ex.hay({ ...p, division: null })).toBe(true);
  });

  it('lee la ruta de un documento estático archivado', () => {
    expect(documentoArchivado('https://www.engarde-service.com/files/riojana/tnrcadete2019/tnrcadeteemindi/index.php?page=clasfinal.htm', 'riojana', 'tnrcadete2019'))
      .toEqual({ compe: 'tnrcadeteemindi', fichero: 'clasfinal.htm' });
    expect(documentoArchivado('http://www.engarde-service.com:80/files/cccm/100te/fmeq/tableau_a8.htm', 'cccm', '100te')).toEqual({ compe: 'fmeq', fichero: 'tableau_a8.htm' });
    expect(documentoArchivado('https://engarde-service.com/files/bhc/capespinf/', 'bhc', 'capespinf')).toBeNull();
    expect(documentoArchivado('https://engarde-service.com/files/otro/torneo/x/clasfinal.htm', 'bhc', 'capespinf')).toBeNull();
  });
});

describe('escritor de hechos del lote', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  const hechos = (clave: string, extractor: string): HechosPrueba => ({
    version: 1, source: 'engarde', extractor, sourceUrl: 'https://engarde-service.com/competition/a/b/c', sourceSha256: 'a'.repeat(64),
    edition: { season: '2026-2027', tournamentKey: 'engarde:a/b', name: 'T', startDate: '2026-10-03', endDate: '2026-10-03', city: null, countryCode: null },
    competition: { competitionKey: clave, weapon: 'ESPADA', gender: 'M', category: 'M17', categoryRaw: null, format: 'INDIVIDUAL', date: '2026-10-03' },
    status: { results: 'completo', pools: 'sin_resultados', tableau: 'sin_resultados', publishedParticipants: 1, notes: [] },
    results: [{ factKey: 'engarde:x|', name: 'X Y', countryCode: null, club: null, position: 1, positionRaw: '1', points: null, fieId: null, license: null, birthYear: null }],
    bouts: [],
  });

  it('valida, no repite fichero y sólo limpia lo antiguo de su propio extractor', () => {
    dir = mkdtempSync(join(tmpdir(), 'lote7-faltan-'));
    const otro = new EscritorHechos('lector_engarde_wayback', dir);
    otro.escribir(hechos('engarde:a/b/w', 'lector_engarde_wayback'));
    writeFileSync(join(dir, 'engarde__2026-2027__viejo.json'), JSON.stringify(hechos('engarde:a/b/v', 'lector_engarde')));
    const e = new EscritorHechos('lector_engarde', dir);
    e.escribir(hechos('engarde:a/b/c', 'lector_engarde'));
    expect(() => e.escribir(hechos('engarde:a/b/c', 'lector_engarde'))).toThrow(/repetido/);
    expect(() => e.escribir({ ...hechos('engarde:a/b/d', 'lector_engarde'), sourceSha256: 'no' })).toThrow();
    expect(e.limpiarAntiguos()).toBe(1);
    const quedan = readdirSync(dir).sort();
    expect(quedan).toEqual(['engarde__2026-2027__engarde_a_b_c.json', 'engarde__2026-2027__engarde_a_b_w.json']);
    expect(JSON.parse(readFileSync(join(dir, quedan[1]), 'utf8')).extractor).toBe('lector_engarde_wayback');
  });
});
