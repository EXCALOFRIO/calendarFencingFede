import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { normalizarNombre, quitarGuardia } from '../scripts/indexado/comun';
import {
  aplicarCalidad, auditarCalidad, BASES_PROTEGIDAS, edadImposible, generoDeClave, huecosClasificacion, marcadorImposible,
  repararMojibake,
} from '../scripts/indexado/lote12-calidad';

function crearBase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0000_aplicacion.sql', '0001_auth.sql', '0002_guardia_deportiva.sql', '0003_vinculos_revisados.sql', '0005_presupuesto_8gib.sql']) {
    db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
  }
  quitarGuardia(db);
  return db;
}

type OpPersona = { genero?: string | null; pais?: string | null; anio?: number | null; fundida?: string };
function persona(db: DatabaseSync, id: string, nombre: string, o: OpPersona = {}) {
  db.prepare(`INSERT INTO sport_person (id, display_name, name_normalized, gender, country_code, birth_year, merged_into_person_id) VALUES (?,?,?,?,?,?,?)`)
    .run(id, nombre, normalizarNombre(nombre), o.genero === undefined ? 'F' : o.genero, o.pais ?? null, o.anio ?? null, o.fundida ?? null);
}

let ed = 0;
function prueba(db: DatabaseSync, id: string, o: { clave?: string; genero?: string; arma?: string; cat?: string; season?: string; fecha?: string; fuente?: string } = {}) {
  ed += 1;
  const fuente = o.fuente ?? 'engarde';
  db.prepare(`INSERT INTO sport_edition (id, source, season, tournament_key, name) VALUES (?, ?, ?, ?, ?)`).run(`ed-${id}`, fuente, o.season ?? '2019-2020', `t${ed}`, `Torneo ${ed}`);
  db.prepare(`INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, format, competition_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'INDIVIDUAL', ?)`)
    .run(id, `ed-${id}`, fuente, o.season ?? '2019-2020', o.clave ?? `clave-${id}`, o.arma ?? 'SABLE', o.genero ?? 'F', o.cat ?? 'ABS', o.fecha ?? `2019-${String(10 + (ed % 2)).padStart(2, '0')}-${String(ed % 28 + 1).padStart(2, '0')}`);
}

function puesto(db: DatabaseSync, c: string, p: string | null, pos: number, nombre: string, o: { fuente?: string; clave?: string } = {}) {
  db.prepare(`INSERT INTO sport_result (competition_id, source, source_fact_key, person_id, source_name, position, content_hash) VALUES (?,?,?,?,?,?, 'h')`)
    .run(c, o.fuente ?? 'engarde', o.clave ?? `k:${nombre}`, p, nombre, pos);
}

function asalto(db: DatabaseSync, c: string, ronda: string, a: [string, string | null, string], b: [string, string | null, string], sa: number, sb: number) {
  const [x, y, s1, s2] = a[0] < b[0] ? [a, b, sa, sb] : [b, a, sb, sa];
  db.prepare(`INSERT INTO sport_bout (competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref, fencer_a_person_id, fencer_b_person_id,
      fencer_a_name, fencer_b_name, score_a, score_b, content_hash) VALUES (?, 'rfee_pdf', 'TABLEAU', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'h')`)
    .run(c, ronda, x[0], y[0], x[1], y[1], x[2], y[2], s1, s2);
}

const SFABS = 'c0000000-0000-4000-8000-00000000sfab';
const ANA = 'a0000000-0000-4000-8000-000000000001';
const BEA = 'a0000000-0000-4000-8000-000000000002';
const CLARA = 'a0000000-0000-4000-8000-000000000003';
const LOLA_M = 'a0000000-0000-4000-8000-000000000004';
const EFC_A = 'b0000000-0000-4000-8000-000000000001';
const EFC_B = 'b0000000-0000-4000-8000-000000000002';
const VIEJO = 'd0000000-0000-4000-8000-000000000001';
const MAR = 'e0000000-0000-4000-8000-000000000001';
const NEREA = 'e0000000-0000-4000-8000-000000000002';
const PDF = 'c0000000-0000-4000-8000-000000000pdf';

function fixture() {
  const db = crearBase();
  // Prueba femenina cargada como masculina (código «sfabs»): tres tiradoras con otras pruebas F y una ficha creada M desde ella.
  prueba(db, SFABS, { clave: 'engarde:rfee/191026tnrsable/sfabs', genero: 'M' });
  for (const [id, n] of [[ANA, 'ALBA ARIAS Ana'], [BEA, 'BLANCO BUENO Bea'], [CLARA, 'CANO CRUZ Clara']] as const) {
    persona(db, id, n);
    puesto(db, SFABS, id, 1 + [ANA, BEA, CLARA].indexOf(id), n);
    for (let i = 0; i < 2; i += 1) {
      const c = `${id.slice(-4)}-f${i}`;
      prueba(db, c, { genero: 'F', season: '2018-2019' });
      puesto(db, c, id, 1, n);
    }
  }
  persona(db, LOLA_M, 'DIAZ DIEZ Lola', { genero: 'M' });
  puesto(db, SFABS, LOLA_M, 4, 'DIAZ DIEZ Lola');

  // Misma licencia EFC en dos raíces que nunca coinciden, una con mojibake.
  persona(db, EFC_A, 'SAGARDI DIAZ David', { genero: 'M', pais: 'ESP', anio: 2006 });
  persona(db, EFC_B, 'SAGARDÄ° DÄ°AZ David', { genero: 'M' });
  prueba(db, 'efc-1', { genero: 'M', arma: 'ESPADA', cat: 'M20', fuente: 'efc', season: '2022-2023' });
  prueba(db, 'efc-2', { genero: 'M', arma: 'ESPADA', cat: 'M20', fuente: 'efc', season: '2023-2024' });
  puesto(db, 'efc-1', EFC_A, 3, 'SAGARDI DIAZ David', { fuente: 'efc', clave: 'efc:lic:00854660' });
  puesto(db, 'efc-2', EFC_B, 5, 'SAGARDÄ° DÄ°AZ David', { fuente: 'efc', clave: 'efc:lic:00854660' });

  // Año comodín de la FIE con un M20 en 2005.
  persona(db, VIEJO, 'SOLANO Ismael', { genero: 'M', pais: 'VEN', anio: 1920 });
  prueba(db, 'fie-m20', { genero: 'M', cat: 'M20', fuente: 'fie', season: '2005' });
  puesto(db, 'fie-m20', VIEJO, 4, 'SOLANO Ismael', { fuente: 'fie', clave: '12345' });

  // Cuadro de PDF leído dos veces (la segunda con los nombres recortados).
  persona(db, MAR, 'MARTIN MORA Mar');
  persona(db, NEREA, 'NUÑEZ NIETO Nerea');
  prueba(db, PDF, { genero: 'F', arma: 'ESPADA', fuente: 'rfee_pdf' });
  puesto(db, PDF, MAR, 1, 'MARTIN MORA Mar', { fuente: 'rfee_pdf' });
  puesto(db, PDF, NEREA, 2, 'NUÑEZ NIETO Nerea', { fuente: 'rfee_pdf' });
  asalto(db, PDF, 'T2', ['pdf:n:MARTIN-MORA-MAR', MAR, 'MARTIN MORA Mar'], ['pdf:n:NUNEZ-NIETO-NEREA', NEREA, 'NUÑEZ NIETO Nerea'], 15, 9);
  asalto(db, PDF, 'T2', ['pdf:n:MARTIN-MORA-M', MAR, 'MARTIN MORA M'], ['pdf:n:NUNEZ-NIETO-N', NEREA, 'NUÑEZ NIETO N'], 15, 9);
  return db;
}

const tipos = (inf: ReturnType<typeof auditarCalidad>) =>
  inf.correcciones.reduce<Record<string, number>>((a, c) => ({ ...a, [c.tipo]: (a[c.tipo] ?? 0) + 1 }), {});

describe('lote 12: reglas puras', () => {
  it('edad imposible con tolerancia', () => {
    expect(edadImposible('M13', 30)).toBe('edad_30_en_M13');
    expect(edadImposible('M17', 19)).toBeNull();
    expect(edadImposible('M17', 20)).toBe('edad_20_en_M17');
    expect(edadImposible('VET', 20)).toBe('edad_20_en_VET');
    expect(edadImposible('VET', 40)).toBeNull();
    expect(edadImposible('ABS', 3)).toBe('menor_de_5');
  });

  it('marcadores imposibles por formato y fase', () => {
    expect(marcadorImposible('INDIVIDUAL', 'POULE', 6, 5)).toBe('poule_mas_de_5');
    expect(marcadorImposible('INDIVIDUAL', 'TABLEAU', 0, 1512)).toBe('directa_mas_de_15');
    expect(marcadorImposible('INDIVIDUAL', 'TABLEAU', 13, 13)).toBe('empate');
    expect(marcadorImposible('INDIVIDUAL', 'POULE', 0, 0)).toBe('cero_a_cero');
    expect(marcadorImposible('EQUIPOS', 'TABLEAU', 45, 40)).toBeNull();
    expect(marcadorImposible('INDIVIDUAL', 'TABLEAU', 15, 14)).toBeNull();
  });

  it('huecos de clasificación tras empates', () => {
    expect(huecosClasificacion([1, 2, 3, 3, 5])).toEqual({ primera: 1, huecos: 0, ganadores: 1 });
    expect(huecosClasificacion([1, 2, 3, 3, 7])).toEqual({ primera: 1, huecos: 2, ganadores: 1 });
    expect(huecosClasificacion([2, 3, 4, 1, 1]).ganadores).toBe(2);
  });

  it('género del código de la prueba sólo con la letra de su arma', () => {
    expect(generoDeClave('engarde:rfee/191026tnrsable/sfabs', 'SABLE')).toBe('F');
    expect(generoDeClave('rfee-wayback:824/FIESTA_SF-12', 'SABLE')).toBe('F');
    expect(generoDeClave('rfee-wayback:619/CTOESP-EFCATI(2011-05-14)', 'ESPADA')).toBe('F');
    expect(generoDeClave('engarde:fecyl/tnr/tnr_valladolid_21-22_em2', 'ESPADA')).toBe('M');
    expect(generoDeClave('engarde:rfee/191026tnrsable/sfabs', 'ESPADA')).toBeNull();
    expect(generoDeClave('RFEE:9836', 'SABLE')).toBeNull();
  });

  it('repara el mojibake de UTF-8 leído como Latin-1', () => {
    expect(repararMojibake('SAGARDÄ° DÄ°AZ David')).toBe('SAGARDİ DİAZ David');
    expect(repararMojibake('MONIN AngÃ¨le')).toBe('MONIN Angèle');
    expect(repararMojibake('IBAÑEZ Celia')).toBe('IBAÑEZ Celia');
  });

  it('protege las copias de producción', () => {
    for (const b of ['nuevo11.sqlite', 'nuevo12.sqlite', 'base.sqlite', 'remoto.sqlite']) expect(BASES_PROTEGIDAS.has(b)).toBe(true);
  });
});

describe('lote 12: auditoría y correcciones', () => {
  it('el ensayo propone las correcciones decisivas sin escribir', () => {
    const db = fixture();
    const inf = auditarCalidad(db, 'fixture');
    expect(inf.aplicado).toBe(false);
    expect(tipos(inf)).toEqual({ genero_prueba: 1, genero_ficha: 1, union_misma_licencia: 1, anio_comodin: 1, asalto_leido_dos_veces: 1 });
    expect(inf.correcciones.find((c) => c.tipo === 'genero_ficha')).toMatchObject({ fila: LOLA_M, valor: 'F', antes: 'M' });
    expect(inf.correcciones.find((c) => c.tipo === 'union_misma_licencia')).toMatchObject({ fila: EFC_B, valor: EFC_A, motivo: 'misma_licencia_efc:00854660' });
    const dup = inf.correcciones.find((c) => c.tipo === 'asalto_leido_dos_veces')!;
    expect((db.prepare(`SELECT fencer_a_name n FROM sport_bout WHERE id = ?`).get(dup.fila) as { n: string }).n).toBe('MARTIN MORA M');
    expect(inf.hallazgos.find((h) => h.id === '2c_prueba_contra_sus_tiradores')).toMatchObject({ recuento: 1, decisivos: 1 });
    expect(db.prepare(`SELECT gender g FROM sport_competition WHERE id = ?`).get(SFABS)).toEqual({ g: 'M' });
  });

  it('aplica en una copia de trabajo y es idempotente', () => {
    const db = fixture();
    const inf = aplicarCalidad(db, 'fixture');
    expect(inf.aplicado).toBe(true);
    expect(inf.aplicadas).toEqual({ genero_prueba: 1, genero_ficha: 1, union_misma_licencia: 1, anio_comodin: 1, asalto_leido_dos_veces: 1 });
    expect(db.prepare(`SELECT gender g FROM sport_competition WHERE id = ?`).get(SFABS)).toEqual({ g: 'F' });
    expect(db.prepare(`SELECT gender g FROM sport_person WHERE id = ?`).get(LOLA_M)).toEqual({ g: 'F' });
    expect(db.prepare(`SELECT merged_into_person_id m FROM sport_person WHERE id = ?`).get(EFC_B)).toEqual({ m: EFC_A });
    expect(db.prepare(`SELECT status s, evidence e FROM sport_link_candidate WHERE source = 'fusion_calidad' AND source_ref = ?`).get(EFC_B))
      .toEqual({ s: 'CONFIRMADO', e: 'misma_licencia_efc:00854660' });
    expect(db.prepare(`SELECT birth_year a FROM sport_person WHERE id = ?`).get(VIEJO)).toEqual({ a: null });
    expect(db.prepare(`SELECT count(*) n FROM sport_bout WHERE competition_id = ?`).get(PDF)).toEqual({ n: 1 });
    const otra = aplicarCalidad(db, 'fixture');
    expect(otra.correcciones).toEqual([]);
  });

  it('no une dos raíces con la misma licencia que coinciden en una prueba', () => {
    const db = fixture();
    puesto(db, 'efc-1', EFC_B, 6, 'SAGARDÄ° DÄ°AZ David', { fuente: 'efc', clave: 'efc:lic:00854660#2' });
    const inf = auditarCalidad(db);
    expect(inf.correcciones.some((c) => c.tipo === 'union_misma_licencia')).toBe(false);
    const h = inf.hallazgos.find((x) => x.id === '1a_licencia_efc_en_varias_raices')!;
    expect(h.ejemplos[0].texto).toContain('coinciden_en_prueba');
  });

  it('un asalto contra sí mismo pierde la persona del lado que no casa con su puesto', () => {
    const db = fixture();
    persona(db, 'f0000000-0000-4000-8000-000000000001', 'MARTIN MORA Maria', { fundida: MAR });
    asalto(db, PDF, 'T4', ['pdf:n:MARTIN-MORA-MAR', MAR, 'MARTIN MORA Mar'], ['pdf:n:MARTIN-MORA-MARIA', 'f0000000-0000-4000-8000-000000000001', 'MARTIN MORA Maria'], 15, 3);
    const inf = auditarCalidad(db);
    const c = inf.correcciones.filter((x) => x.tipo === 'asalto_contra_si_mismo');
    expect(c).toHaveLength(1);
    expect(c[0].antes).toBe('f0000000-0000-4000-8000-000000000001');
  });
});
